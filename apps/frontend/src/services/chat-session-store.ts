import type { ChatAttachment, Message, MessageToolCall, MessageTrace } from '@/data/mock-chats';
import type { A2AWorkCardData, A2AWorkLogItem } from '@/types/a2a';
import type { ChatTaskLifecycleItem } from '@/types/chat-task';
import { isHiddenSystemPromptText } from '@/lib/chat-message-filter';
import type { GroupMemoryDigest, GroupQueueItem, GroupSessionRuntime } from '@/types/group';

const STORAGE_KEY = 'webot-chat-sessions-v1';
const A2A_PLACEHOLDER_AGENT_ID = 'unknown-agent';
const A2A_PLACEHOLDER_AGENT_NAME = '子智能体';
let webStoragePurged = false;

export interface StoredChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  remoteSessionId?: string;
  remoteSessionOwnerAgentId?: string;
  remoteContextOffset?: number;
  contextDigest?: {
    summary: string;
    lastUserIntent?: string;
    updatedAt: string;
  };
  lastCompactedAt?: string;
  groupRuntime?: GroupSessionRuntime;
  sessionLabel?: string;
  sessionSource?: 'app' | 'web' | 'unknown';
  autoTitle?: boolean;
  streamState?: 'idle' | 'streaming' | 'waiting';
}

export interface StoredAgentChatState {
  sessions: StoredChatSession[];
  activeSessionId: string;
}

interface StoredRootState {
  version: '1.0';
  agents: Record<string, StoredAgentChatState>;
}

let memoryStore: StoredRootState | null = null;
let cachedRootState: StoredRootState | null = null;
let cachedSerializedRoot: string | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const globalWindow = window as unknown as { __TAURI_INTERNALS__?: unknown };
  return Boolean(globalWindow.__TAURI_INTERNALS__);
}

function canUsePersistentBrowserStorage(): boolean {
  return isTauriRuntime();
}

function purgeWebSessionStorageIfNeeded(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined' || webStoragePurged) {
    return;
  }
  if (canUsePersistentBrowserStorage()) {
    return;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore cleanup errors in web runtime
  }
  webStoragePurged = true;
}

function createSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneMessage(message: Message): Message {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    tools: message.tools?.map((tool) => ({ ...tool, running: false })),
    thinkingTrace: message.thinkingTrace?.map((trace) => ({ ...trace })),
    toolTrace: message.toolTrace?.map((trace) => ({ ...trace })),
    taskCard: message.taskCard ? {
      ...message.taskCard,
      timeline: message.taskCard.timeline?.map((entry) => ({ ...entry })),
    } : undefined,
    a2aCards: message.a2aCards?.map((card) => ({
      ...card,
      logs: card.logs.map((log) => ({ ...log })),
    })),
    streaming: false,
    cardPending: false,
    uiStreamState: message.spec != null || (message.uiRawText || '').trim() ? 'ready' : 'idle',
    generationStartedAt: undefined,
    generationElapsedMs: undefined,
    debugRawStream: undefined,
    debugNativeFrames: undefined,
    debugDonePayload: undefined,
    debugPromptChannel: undefined,
    debugRenderMode: undefined,
    debugHasUiJson: undefined,
    debugSpecSource: undefined,
    debugChunkCount: undefined,
    debugReceivedDone: undefined,
    debugReceivedError: undefined,
    debugWatchdogTriggered: undefined,
    debugLastChunkKind: undefined,
    debugLastEvent: undefined,
  };
}

function normalizeGroupQueueItem(raw: unknown): GroupQueueItem | null {
  const item = isRecord(raw) ? raw : null;
  if (!item) return null;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const agentId = typeof item.agentId === 'string' ? item.agentId.trim() : '';
  const createdAt = typeof item.createdAt === 'string' ? item.createdAt.trim() : '';
  if (!id || !agentId || !createdAt) {
    return null;
  }
  const statusRaw = typeof item.status === 'string' ? item.status.trim() : '';
  const status = statusRaw === 'queued'
    || statusRaw === 'running'
    || statusRaw === 'done'
    || statusRaw === 'skipped'
    || statusRaw === 'cancelled'
    ? statusRaw
    : 'queued';
  const reasonRaw = typeof item.reason === 'string' ? item.reason.trim() : '';
  const reason = reasonRaw === 'user_primary'
    || reasonRaw === 'user_followup'
    || reasonRaw === 'user_mention'
    || reasonRaw === 'mention_handoff'
    || reasonRaw === 'leader_wrapup'
    || reasonRaw === 'idle_prompt'
    || reasonRaw === 'task_report'
    ? reasonRaw
    : 'user_followup';
  return {
    id,
    agentId,
    agentName: typeof item.agentName === 'string' && item.agentName.trim() ? item.agentName.trim() : undefined,
    status,
    reason,
    depth: typeof item.depth === 'number' && Number.isFinite(item.depth) ? Math.max(0, Math.floor(item.depth)) : undefined,
    sourceMessageId: typeof item.sourceMessageId === 'string' && item.sourceMessageId.trim() ? item.sourceMessageId.trim() : undefined,
    note: typeof item.note === 'string' && item.note.trim() ? item.note.trim() : undefined,
    createdAt,
    startedAt: typeof item.startedAt === 'string' && item.startedAt.trim() ? item.startedAt.trim() : undefined,
    finishedAt: typeof item.finishedAt === 'string' && item.finishedAt.trim() ? item.finishedAt.trim() : undefined,
  };
}

function normalizeGroupMemoryDigest(raw: unknown): GroupMemoryDigest | undefined {
  const item = isRecord(raw) ? raw : null;
  if (!item) return undefined;
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  const updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt.trim() : '';
  if (!summary || !updatedAt) {
    return undefined;
  }
  return {
    summary,
    speakerLine: typeof item.speakerLine === 'string' && item.speakerLine.trim() ? item.speakerLine.trim() : undefined,
    pendingLine: typeof item.pendingLine === 'string' && item.pendingLine.trim() ? item.pendingLine.trim() : undefined,
    lastUserIntent: typeof item.lastUserIntent === 'string' && item.lastUserIntent.trim() ? item.lastUserIntent.trim() : undefined,
    updatedAt,
  };
}

function normalizeGroupRuntime(raw: unknown): GroupSessionRuntime | undefined {
  const item = isRecord(raw) ? raw : null;
  if (!item) return undefined;
  const version = item.version === '1.0' ? '1.0' : '1.0';
  const statusRaw = typeof item.status === 'string' ? item.status.trim() : '';
  const status = statusRaw === 'running' || statusRaw === 'stopped' || statusRaw === 'idle'
    ? statusRaw
    : 'idle';
  const queue = Array.isArray(item.queue)
    ? item.queue.map(normalizeGroupQueueItem).filter((row): row is GroupQueueItem => row != null).slice(-24)
    : [];
  return {
    version,
    status,
    leaderAgentId: typeof item.leaderAgentId === 'string' && item.leaderAgentId.trim() ? item.leaderAgentId.trim() : undefined,
    currentSpeakerId: typeof item.currentSpeakerId === 'string' && item.currentSpeakerId.trim() ? item.currentSpeakerId.trim() : undefined,
    lastCompletedSpeakerId: typeof item.lastCompletedSpeakerId === 'string' && item.lastCompletedSpeakerId.trim() ? item.lastCompletedSpeakerId.trim() : undefined,
    queueVersion: typeof item.queueVersion === 'number' && Number.isFinite(item.queueVersion) ? Math.max(0, Math.floor(item.queueVersion)) : 0,
    queue,
    stopRequested: item.stopRequested === true,
    stopReason: typeof item.stopReason === 'string' && item.stopReason.trim() ? item.stopReason.trim() : undefined,
    lastCompactedAt: typeof item.lastCompactedAt === 'string' && item.lastCompactedAt.trim() ? item.lastCompactedAt.trim() : undefined,
    lastEventAt: typeof item.lastEventAt === 'string' && item.lastEventAt.trim() ? item.lastEventAt.trim() : undefined,
    memoryDigest: normalizeGroupMemoryDigest(item.memoryDigest),
  };
}

function cloneGroupRuntime(runtime?: GroupSessionRuntime): GroupSessionRuntime | undefined {
  if (!runtime) return undefined;
  return {
    ...runtime,
    queue: runtime.queue.map((item) => ({ ...item })),
    memoryDigest: runtime.memoryDigest ? { ...runtime.memoryDigest } : undefined,
  };
}

function normalizeContextDigest(raw: unknown): StoredChatSession['contextDigest'] {
  const item = isRecord(raw) ? raw : null;
  if (!item) return undefined;
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  const updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt.trim() : '';
  if (!summary || !updatedAt) {
    return undefined;
  }
  return {
    summary,
    lastUserIntent: typeof item.lastUserIntent === 'string' && item.lastUserIntent.trim() ? item.lastUserIntent.trim() : undefined,
    updatedAt,
  };
}

function normalizeAttachment(raw: unknown, index: number): ChatAttachment | null {
  const item = isRecord(raw) ? raw : null;
  if (!item) return null;
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const relativePath = typeof item.relativePath === 'string' ? item.relativePath.trim() : '';
  if (!name || !relativePath) {
    return null;
  }
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : `attachment_${Date.now()}_${index}`,
    kind: item.kind === 'image' ? 'image' : 'file',
    name,
    relativePath,
    savedPath: typeof item.savedPath === 'string' ? item.savedPath : undefined,
    assetUrl: typeof item.assetUrl === 'string' ? item.assetUrl : undefined,
    mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
    size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : undefined,
    upstreamFileId: typeof item.upstreamFileId === 'string' ? item.upstreamFileId : undefined,
  };
}

function normalizeA2aLog(raw: unknown, index: number): A2AWorkLogItem | null {
  const item = isRecord(raw) ? raw : null;
  if (!item) return null;
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '';
  if (!title) return null;
  const id = typeof item.id === 'string' && item.id.trim() ? item.id : `a2a_log_${Date.now()}_${index}`;
  const at = typeof item.at === 'string' && item.at.trim() ? item.at : new Date().toISOString();
  return {
    id,
    at,
    title,
    detail: typeof item.detail === 'string' ? item.detail : undefined,
  };
}

function normalizeA2aCard(raw: unknown, index: number): A2AWorkCardData | null {
  const item = isRecord(raw) ? raw : null;
  if (!item) return null;
  const id = typeof item.id === 'string' && item.id.trim() ? item.id : `a2a_${Date.now()}_${index}`;
  const agentId = typeof item.agentId === 'string' && item.agentId.trim() ? item.agentId.trim() : A2A_PLACEHOLDER_AGENT_ID;
  const rawAgentName = typeof item.agentName === 'string' ? item.agentName.trim() : '';
  const agentName = rawAgentName === A2A_PLACEHOLDER_AGENT_NAME ? '' : rawAgentName;
  const status =
    item.status === 'working' || item.status === 'completed' || item.status === 'failed'
      ? item.status
      : 'working';
  const startedAt =
    typeof item.startedAt === 'string' && item.startedAt.trim()
      ? item.startedAt
      : new Date().toISOString();
  const logsRaw = Array.isArray(item.logs) ? item.logs : [];
  const logs = logsRaw
    .map((log, logIndex) => normalizeA2aLog(log, logIndex))
    .filter((log): log is A2AWorkLogItem => log != null)
    .slice(-80);

  return {
    id,
    agentId,
    agentName,
    agentAvatarUrl: typeof item.agentAvatarUrl === 'string' ? item.agentAvatarUrl : undefined,
    agentColor: typeof item.agentColor === 'string' ? item.agentColor : undefined,
    status,
    summary: typeof item.summary === 'string' ? item.summary : undefined,
    objective: typeof item.objective === 'string' ? item.objective : undefined,
    requestPayloadText: typeof item.requestPayloadText === 'string' ? item.requestPayloadText : undefined,
    startedAt,
    finishedAt: typeof item.finishedAt === 'string' ? item.finishedAt : undefined,
    finalReportText: typeof item.finalReportText === 'string' ? item.finalReportText : undefined,
    latestEventAt: typeof item.latestEventAt === 'string' ? item.latestEventAt : undefined,
    latestEventTitle: typeof item.latestEventTitle === 'string' ? item.latestEventTitle : undefined,
    latestEventKind:
      item.latestEventKind === 'started'
      || item.latestEventKind === 'progress'
      || item.latestEventKind === 'final'
      || item.latestEventKind === 'failed'
        ? item.latestEventKind
        : undefined,
    bindingSessionId: typeof item.bindingSessionId === 'string' ? item.bindingSessionId : undefined,
    bindingSourceMessageId: typeof item.bindingSourceMessageId === 'string' ? item.bindingSourceMessageId : undefined,
    logs,
  };
}

function normalizeToolCall(raw: unknown, index: number): MessageToolCall | null {
  const item = isRecord(raw) ? raw : null;
  if (!item) return null;
  const name = typeof item.name === 'string' && item.name.trim() ? item.name : '';
  if (!name) return null;
  const id = typeof item.id === 'string' && item.id.trim() ? item.id : `tool_${Date.now()}_${index}`;
  return {
    id,
    name,
    running: Boolean(item.running),
    expanded: typeof item.expanded === 'boolean' ? item.expanded : undefined,
    input: typeof item.input === 'string' ? item.input : undefined,
    result: typeof item.result === 'string' ? item.result : undefined,
    is_error: typeof item.is_error === 'boolean' ? item.is_error : undefined,
  };
}

function normalizeTrace(raw: unknown, index: number): MessageTrace | null {
  const item = isRecord(raw) ? raw : null;
  if (!item) return null;
  const title = typeof item.title === 'string' && item.title.trim() ? item.title : '';
  if (!title) return null;
  const id = typeof item.id === 'string' && item.id.trim() ? item.id : `trace_${Date.now()}_${index}`;
  const at = typeof item.at === 'string' && item.at.trim() ? item.at : new Date().toISOString();
  return {
    id,
    title,
    detail: typeof item.detail === 'string' ? item.detail : undefined,
    at,
  };
}

function normalizeMessage(raw: unknown, index: number): Message | null {
  const item = isRecord(raw) ? raw : null;
  if (!item) return null;
  const role = item.role === 'user' || item.role === 'agent' || item.role === 'system' ? item.role : null;
  if (!role) return null;

  const id = typeof item.id === 'string' && item.id.trim() ? item.id : `msg_${Date.now()}_${index}`;
  const rawText = typeof item.text === 'string' ? item.text : '';
  const text = isHiddenSystemPromptText(rawText) ? '' : rawText;
  const timestamp = typeof item.timestamp === 'string' && item.timestamp.trim()
    ? item.timestamp
    : new Date().toISOString();
  const message: Message = {
    id,
    role,
    text,
    timestamp,
  };

  if (typeof item.meta === 'string') {
    message.meta = item.meta;
  }
  if (Array.isArray(item.attachments)) {
    const attachments = item.attachments
      .map((attachment, attachmentIndex) => normalizeAttachment(attachment, attachmentIndex))
      .filter((attachment): attachment is ChatAttachment => attachment != null);
    if (attachments.length > 0) {
      message.attachments = attachments;
    }
  }
  if (typeof item.thinking === 'boolean') {
    message.thinking = item.thinking;
  }
  if (item.spec !== undefined) {
    message.spec = item.spec;
  }
  if (typeof item.uiRawText === 'string') {
    message.uiRawText = item.uiRawText;
  }
  if (item.uiStreamState === 'idle' || item.uiStreamState === 'streaming' || item.uiStreamState === 'ready') {
    message.uiStreamState = item.uiStreamState;
  }
  if (Array.isArray(item.tools)) {
    const tools = item.tools
      .map((tool, toolIndex) => normalizeToolCall(tool, toolIndex))
      .filter((tool): tool is MessageToolCall => tool != null);
    if (tools.length > 0) {
      message.tools = tools;
    }
  }
  if (Array.isArray(item.thinkingTrace)) {
    const traces = item.thinkingTrace
      .map((trace, traceIndex) => normalizeTrace(trace, traceIndex))
      .filter((trace): trace is MessageTrace => trace != null);
    if (traces.length > 0) {
      message.thinkingTrace = traces;
    }
  }
  if (Array.isArray(item.toolTrace)) {
    const traces = item.toolTrace
      .map((trace, traceIndex) => normalizeTrace(trace, traceIndex))
      .filter((trace): trace is MessageTrace => trace != null);
    if (traces.length > 0) {
      message.toolTrace = traces;
    }
  }
  if (isRecord(item.taskCard)) {
    const stageRaw = typeof item.taskCard.stage === 'string' ? item.taskCard.stage.trim() : '';
    const stage =
      stageRaw === 'proposal'
      || stageRaw === 'scheduled'
      || stageRaw === 'running'
      || stageRaw === 'completed'
      || stageRaw === 'cancelled'
      || stageRaw === 'failed'
        ? stageRaw
        : 'proposal';
    message.taskCard = {
      taskName: typeof item.taskCard.taskName === 'string' ? item.taskCard.taskName : '任务定时器',
      objective: typeof item.taskCard.objective === 'string' ? item.taskCard.objective : '',
      scheduleText: typeof item.taskCard.scheduleText === 'string' ? item.taskCard.scheduleText : '',
      everyMs:
        typeof item.taskCard.everyMs === 'number' && Number.isFinite(item.taskCard.everyMs)
          ? item.taskCard.everyMs
          : 60000,
      maxRuns:
        typeof item.taskCard.maxRuns === 'number' && Number.isFinite(item.taskCard.maxRuns)
          ? item.taskCard.maxRuns
          : 0,
      runCount:
        typeof item.taskCard.runCount === 'number' && Number.isFinite(item.taskCard.runCount)
          ? item.taskCard.runCount
          : 0,
      executionPrompt: typeof item.taskCard.executionPrompt === 'string' ? item.taskCard.executionPrompt : '',
      sourceMessageText: typeof item.taskCard.sourceMessageText === 'string' ? item.taskCard.sourceMessageText : '',
      stage,
      createdAt:
        typeof item.taskCard.createdAt === 'string' && item.taskCard.createdAt.trim()
          ? item.taskCard.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof item.taskCard.updatedAt === 'string' && item.taskCard.updatedAt.trim()
          ? item.taskCard.updatedAt
          : new Date().toISOString(),
      taskId: typeof item.taskCard.taskId === 'string' ? item.taskCard.taskId : undefined,
      agentId: typeof item.taskCard.agentId === 'string' ? item.taskCard.agentId : undefined,
      nextRun: typeof item.taskCard.nextRun === 'string' ? item.taskCard.nextRun : undefined,
      lastRun: typeof item.taskCard.lastRun === 'string' ? item.taskCard.lastRun : undefined,
      lastStatus:
        item.taskCard.lastStatus === 'idle'
        || item.taskCard.lastStatus === 'running'
        || item.taskCard.lastStatus === 'ok'
        || item.taskCard.lastStatus === 'error'
        || item.taskCard.lastStatus === 'cancelled'
          ? item.taskCard.lastStatus
          : undefined,
      canCreate: typeof item.taskCard.canCreate === 'boolean' ? item.taskCard.canCreate : undefined,
      canCancel: typeof item.taskCard.canCancel === 'boolean' ? item.taskCard.canCancel : undefined,
      canDelete: typeof item.taskCard.canDelete === 'boolean' ? item.taskCard.canDelete : undefined,
      notifyOnComplete:
        typeof item.taskCard.notifyOnComplete === 'boolean'
          ? item.taskCard.notifyOnComplete
          : undefined,
      completedNotified:
        typeof item.taskCard.completedNotified === 'boolean'
          ? item.taskCard.completedNotified
          : undefined,
      taskKind:
        item.taskCard.taskKind === 'chat_async'
        || item.taskCard.taskKind === 'chat_schedule'
        || item.taskCard.taskKind === 'manual_schedule'
        || item.taskCard.taskKind === 'a2a_delegate'
          ? item.taskCard.taskKind
          : undefined,
      creatorParticipantName:
        typeof item.taskCard.creatorParticipantName === 'string'
          ? item.taskCard.creatorParticipantName
          : undefined,
      executorAgentName:
        typeof item.taskCard.executorAgentName === 'string'
          ? item.taskCard.executorAgentName
          : undefined,
      reportActorName:
        typeof item.taskCard.reportActorName === 'string'
          ? item.taskCard.reportActorName
          : undefined,
      reportStatus:
        item.taskCard.reportStatus === 'pending'
        || item.taskCard.reportStatus === 'reported'
        || item.taskCard.reportStatus === 'acknowledged'
          ? item.taskCard.reportStatus
          : undefined,
      progressPercent:
        typeof item.taskCard.progressPercent === 'number' && Number.isFinite(item.taskCard.progressPercent)
          ? item.taskCard.progressPercent
          : undefined,
      errorSummary:
        typeof item.taskCard.errorSummary === 'string'
          ? item.taskCard.errorSummary
          : undefined,
      finalSummaryText:
        typeof item.taskCard.finalSummaryText === 'string'
          ? item.taskCard.finalSummaryText
          : undefined,
      latestReportAt:
        typeof item.taskCard.latestReportAt === 'string'
          ? item.taskCard.latestReportAt
          : undefined,
      latestReportKind:
        item.taskCard.latestReportKind === 'progress'
        || item.taskCard.latestReportKind === 'anomaly'
        || item.taskCard.latestReportKind === 'final'
        || item.taskCard.latestReportKind === 'failed'
        || item.taskCard.latestReportKind === 'started'
          ? item.taskCard.latestReportKind
          : undefined,
      bindingSessionId:
        typeof item.taskCard.bindingSessionId === 'string'
          ? item.taskCard.bindingSessionId
          : undefined,
      bindingSourceMessageId:
        typeof item.taskCard.bindingSourceMessageId === 'string'
          ? item.taskCard.bindingSourceMessageId
          : undefined,
      timeline: Array.isArray(item.taskCard.timeline)
        ? item.taskCard.timeline
          .map((entry, entryIndex) => {
            const row = isRecord(entry) ? entry : null;
            if (!row) return null;
            const title = typeof row.title === 'string' ? row.title.trim() : '';
            const at = typeof row.at === 'string' && row.at.trim() ? row.at : '';
            if (!title || !at) return null;
            const kind =
              row.kind === 'created'
              || row.kind === 'started'
              || row.kind === 'progress'
              || row.kind === 'anomaly'
              || row.kind === 'final'
              || row.kind === 'failed'
              || row.kind === 'cancelled'
                ? row.kind
                : 'progress';
            const level =
              row.level === 'info'
              || row.level === 'success'
              || row.level === 'error'
                ? row.level
                : undefined;
            const normalizedEntry: ChatTaskLifecycleItem = {
              id:
                typeof row.id === 'string' && row.id.trim()
                  ? row.id
                  : `task_timeline_${Date.now()}_${entryIndex}`,
              kind,
              title,
              at,
              ...(typeof row.detail === 'string' ? { detail: row.detail } : {}),
              ...(typeof row.runCount === 'number' && Number.isFinite(row.runCount)
                ? { runCount: row.runCount }
                : {}),
              ...(level ? { level } : {}),
            };
            return normalizedEntry;
          })
          .filter((entry): entry is ChatTaskLifecycleItem => entry != null)
        : undefined,
    };
  }
  if (Array.isArray(item.a2aCards)) {
    const cards = item.a2aCards
      .map((card, cardIndex) => normalizeA2aCard(card, cardIndex))
      .filter((card): card is A2AWorkCardData => card != null);
    if (cards.length > 0) {
      message.a2aCards = cards;
    }
  }

  const hasRenderableText = Boolean(message.text.trim());
  const hasRenderablePayload =
    message.spec !== undefined
    || Boolean(message.uiRawText?.trim())
    || Boolean(message.taskCard)
    || Boolean(message.a2aCards?.length)
    || Boolean(message.attachments?.length)
    || Boolean(message.tools?.length)
    || Boolean(message.toolTrace?.length)
    || Boolean(message.thinkingTrace?.length);
  if (!hasRenderableText && !hasRenderablePayload) {
    return null;
  }

  return cloneMessage(message);
}

function normalizeSession(raw: unknown, index: number): StoredChatSession {
  const item = isRecord(raw) ? raw : {};
  const id = typeof item.id === 'string' && item.id.trim() ? item.id : createSessionId();
  const remoteSessionId = typeof item.remoteSessionId === 'string' && item.remoteSessionId.trim()
    ? item.remoteSessionId.trim()
    : undefined;
  const remoteSessionOwnerAgentId = typeof item.remoteSessionOwnerAgentId === 'string' && item.remoteSessionOwnerAgentId.trim()
    ? item.remoteSessionOwnerAgentId.trim()
    : undefined;
  const remoteContextOffset = typeof item.remoteContextOffset === 'number' && Number.isFinite(item.remoteContextOffset)
    ? Math.max(0, Math.floor(item.remoteContextOffset))
    : undefined;
  const contextDigest = normalizeContextDigest(item.contextDigest);
  const lastCompactedAt = typeof item.lastCompactedAt === 'string' && item.lastCompactedAt.trim()
    ? item.lastCompactedAt.trim()
    : undefined;
  const groupRuntime = normalizeGroupRuntime(item.groupRuntime);
  const sessionLabel = typeof item.sessionLabel === 'string' && item.sessionLabel.trim()
    ? item.sessionLabel.trim()
    : undefined;
  const sessionSourceRaw = typeof item.sessionSource === 'string' ? item.sessionSource.trim() : '';
  const sessionSource = sessionSourceRaw === 'app' || sessionSourceRaw === 'web' || sessionSourceRaw === 'unknown'
    ? sessionSourceRaw
    : undefined;
  const titleRaw = typeof item.title === 'string' ? item.title.trim() : '';
  const title = titleRaw || `新对话 ${index + 1}`;
  const updatedAt = typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now();
  const messagesRaw = Array.isArray(item.messages) ? item.messages : [];
  const messages = messagesRaw
    .map((message, messageIndex) => normalizeMessage(message, messageIndex))
    .filter((message): message is Message => message != null);
  const autoTitle = item.autoTitle === true;
  const streamStateRaw = typeof item.streamState === 'string' ? item.streamState : '';
  const streamState = streamStateRaw === 'streaming' || streamStateRaw === 'waiting' || streamStateRaw === 'idle'
    ? streamStateRaw
    : 'idle';
  return {
    id,
    title,
    updatedAt,
    messages,
    remoteSessionId,
    remoteSessionOwnerAgentId,
    remoteContextOffset,
    contextDigest,
    lastCompactedAt,
    groupRuntime,
    sessionLabel,
    sessionSource,
    autoTitle: autoTitle || undefined,
    streamState,
  };
}

function normalizeAgentState(raw: unknown): StoredAgentChatState | null {
  const state = isRecord(raw) ? raw : null;
  if (!state) return null;

  const sessionsRaw = Array.isArray(state.sessions) ? state.sessions : [];
  const sessions = sessionsRaw.map((session, index) => normalizeSession(session, index));
  if (sessions.length === 0) {
    return null;
  }

  const activeSessionIdRaw = typeof state.activeSessionId === 'string' ? state.activeSessionId : '';
  const hasActive = sessions.some((session) => session.id === activeSessionIdRaw);
  const activeSessionId = hasActive ? activeSessionIdRaw : sessions[0].id;

  return { sessions, activeSessionId };
}

function createEmptyRoot(): StoredRootState {
  return {
    version: '1.0',
    agents: {},
  };
}

function readRootState(): StoredRootState {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined' || !canUsePersistentBrowserStorage()) {
    purgeWebSessionStorageIfNeeded();
    if (memoryStore == null) {
      memoryStore = createEmptyRoot();
    }
    return memoryStore;
  }

  if (cachedRootState) {
    return cachedRootState;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const empty = createEmptyRoot();
    cachedRootState = empty;
    cachedSerializedRoot = null;
    return empty;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      const empty = createEmptyRoot();
      cachedRootState = empty;
      cachedSerializedRoot = null;
      return empty;
    }
    const agents = isRecord(parsed.agents) ? parsed.agents : {};
    const root: StoredRootState = {
      version: '1.0',
      agents: {},
    };
    for (const [agentId, state] of Object.entries(agents)) {
      if (!agentId.trim()) continue;
      const normalized = normalizeAgentState(state);
      if (normalized) {
        root.agents[agentId] = normalized;
      }
    }
    cachedRootState = root;
    cachedSerializedRoot = raw;
    return root;
  } catch {
    const empty = createEmptyRoot();
    cachedRootState = empty;
    cachedSerializedRoot = null;
    return empty;
  }
}

function writeRootState(root: StoredRootState): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined' || !canUsePersistentBrowserStorage()) {
    purgeWebSessionStorageIfNeeded();
    memoryStore = root;
    cachedRootState = root;
    return;
  }
  const serialized = JSON.stringify(root);
  if (serialized === cachedSerializedRoot) {
    cachedRootState = root;
    return;
  }
  localStorage.setItem(STORAGE_KEY, serialized);
  cachedSerializedRoot = serialized;
  cachedRootState = root;
}

function cloneState(state: StoredAgentChatState): StoredAgentChatState {
  return {
    activeSessionId: state.activeSessionId,
    sessions: state.sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) => cloneMessage(message)),
      contextDigest: session.contextDigest ? { ...session.contextDigest } : undefined,
      lastCompactedAt: session.lastCompactedAt,
      groupRuntime: cloneGroupRuntime(session.groupRuntime),
    })),
  };
}

export function loadAgentChatState(agentId: string): StoredAgentChatState | null {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) return null;

  const root = readRootState();
  const state = root.agents[normalizedAgentId];
  if (!state) return null;
  return cloneState(state);
}

export function saveAgentChatState(agentId: string, state: StoredAgentChatState): void {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) return;

  const normalized = normalizeAgentState(state);
  if (!normalized) return;

  const root = readRootState();
  root.agents[normalizedAgentId] = normalized;
  writeRootState(root);
}

export function deleteAgentChatState(agentId: string): void {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) return;
  const root = readRootState();
  if (!root.agents[normalizedAgentId]) return;
  delete root.agents[normalizedAgentId];
  writeRootState(root);
}
