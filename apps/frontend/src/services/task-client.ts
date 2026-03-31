import type { AgentTask, AgentTaskLogItem } from '@/main/types';
import { requestJson } from '@/services/transport';
import {
  getAgentSession,
  listAgentTasks,
  listAgents,
  type AgentSessionMessage,
} from '@/services/agent-client';
import type { Task, TaskConversationType, TaskReportDelivery, TaskRunRecord } from '@/types/tasks';

const TASK_CLIENT_AGENT_ID_KEY = 'webot-task-center-agent-id';
const TASK_LOCAL_META_KEY = 'webot-task-local-meta-v1';
const TASK_LIST_TIMEOUT_MS = 4_500;
const TASK_DELIVERY_TIMEOUT_MS = 3_500;

const taskAgentIndex = new Map<string, string>();
const taskSnapshotCache = new Map<string, Task>();

interface TaskLocalMeta {
  taskId: string;
  agentId: string;
  sourceType: Task['sourceType'];
  displayName?: string;
  manualStartRequired?: boolean;
  isTemplate?: boolean;
  sourceRef?: string;
  maxRuns?: number;
  runCountCache?: number;
  lastRunToken?: string;
  deliveryMode?: Task['delivery']['mode'];
  deliveryChannel?: string;
  deliveryTarget?: string;
  deliveryBestEffort?: boolean;
  finalSummaryPrompt?: string;
  notifyOnFinal?: boolean;
  completionNotifiedRunCount?: number;
  finalSummary?: {
    runCount: number;
    content: string;
    createdAt: string;
  };
  runLogs?: TaskLocalRunLog[];
  createdAt: string;
  updatedAt: string;
}

interface TaskLocalRunLog {
  eventId: string;
  createdAt: string;
  kind: string;
  message: string;
}

function normalizeStatus(status?: string): 'ok' | 'error' | 'running' | 'idle' {
  const raw = (status || '').trim().toLowerCase();
  if (['ok', 'success', 'done', 'completed'].includes(raw)) return 'ok';
  if (['error', 'failed', 'fail'].includes(raw)) return 'error';
  if (['running', 'processing', 'in_progress'].includes(raw)) return 'running';
  return 'idle';
}

function toTaskSchedule(task: AgentTask): Task['schedule'] {
  if (task.scheduleKind === 'every') {
    return {
      kind: 'every',
      everyMs: task.everyMs ?? 60000,
    };
  }
  if (task.scheduleKind === 'at') {
    return {
      kind: 'at',
      at: task.runAt,
    };
  }
  return {
    kind: 'cron',
    expr: task.scheduleExpression || '* * * * *',
    tz: task.timezone,
  };
}

function sanitizeTaskName(name: string): string {
  return name.replace(/^\s*聊天任务[:：]\s*/i, '').trim() || name.trim() || '未命名任务';
}

function inferChatTaskDisplayName(prompt?: string): string | undefined {
  const raw = (prompt || '').trim();
  if (!raw) return undefined;
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^你是任务执行助手/.test(line))
    .filter((line) => !/^要求[:：]?/.test(line))
    .filter((line) => !/^\d+\)/.test(line))
    .filter((line) => !/^\d+\./.test(line));
  const candidate = lines[0] || '';
  if (!candidate) return undefined;
  return candidate.length > 18 ? `${candidate.slice(0, 18)}...` : candidate;
}

function parseMaxRunsFromPrompt(prompt?: string): number | undefined {
  const text = (prompt || '').trim();
  if (!text) return undefined;
  const patterns: RegExp[] = [
    /任务总执行次数上限[:：]\s*(\d+)\s*次/i,
    /总执行(?:次数|轮次)?[:：]\s*(\d+)\s*次/i,
    /任务执行\s*(\d+)\s*次/i,
    /(?:总共|一共|共|连续)\s*(\d+)\s*次/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return Math.min(1000, Math.floor(value));
    }
  }
  return undefined;
}

function toBackendSafeTaskName(displayName: string, sourceType: Task['sourceType']): string {
  const normalized = displayName
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const compact = normalized
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const base = compact || `task-${Date.now()}`;
  return sourceType === 'chat' ? `chat-task-${base}` : base;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimToUndefined(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeConversationType(
  value?: string | null,
): TaskConversationType | undefined {
  return value === 'group' || value === 'dm' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mapTaskDelivery(input: unknown): TaskReportDelivery | null {
  const row = isRecord(input) ? input : null;
  if (!row) return null;
  const id = trimToUndefined(typeof row.id === 'string' ? row.id : undefined);
  const taskId = trimToUndefined(typeof row.task_id === 'string' ? row.task_id : (typeof row.taskId === 'string' ? row.taskId : undefined));
  const ownerAgentId = trimToUndefined(
    typeof row.owner_agent_id === 'string' ? row.owner_agent_id : (typeof row.ownerAgentId === 'string' ? row.ownerAgentId : undefined),
  ) || (taskId ? (getTaskMeta(taskId)?.agentId || taskAgentIndex.get(taskId) || '') : '');
  const deliveryKindRaw = trimToUndefined(
    typeof row.delivery_kind === 'string'
      ? row.delivery_kind
      : (typeof row.deliveryKind === 'string'
        ? row.deliveryKind
        : (isRecord(row.payload) && typeof row.payload.delivery_kind === 'string'
          ? row.payload.delivery_kind
          : undefined)),
  );
  const statusRaw = trimToUndefined(typeof row.status === 'string' ? row.status : undefined);
  const createdAt = trimToUndefined(typeof row.created_at === 'string' ? row.created_at : (typeof row.createdAt === 'string' ? row.createdAt : undefined));
  const updatedAt = trimToUndefined(typeof row.updated_at === 'string' ? row.updated_at : (typeof row.updatedAt === 'string' ? row.updatedAt : undefined));
  if (!id || !taskId || !statusRaw || !createdAt || !updatedAt) {
    return null;
  }
  const targetKind = trimToUndefined(
    typeof row.target_kind === 'string' ? row.target_kind : (typeof row.targetKind === 'string' ? row.targetKind : undefined),
  );
  const deliveryKind = deliveryKindRaw === 'progress' || deliveryKindRaw === 'anomaly'
    ? deliveryKindRaw
    : (deliveryKindRaw === 'final'
      ? 'final'
      : (targetKind === 'pc_notice' ? 'anomaly' : 'final'));
  const status = statusRaw === 'reported' || statusRaw === 'acknowledged' || statusRaw === 'failed'
    ? statusRaw
    : 'pending';
  const payload = isRecord(row.payload) ? row.payload : (isRecord(row.payload_json) ? row.payload_json : undefined);
  const runCountRaw = typeof row.run_count === 'number'
    ? row.run_count
    : (typeof row.runCount === 'number' ? row.runCount : undefined);
  return {
    id,
    taskId,
    ownerAgentId,
    runtimeKey: trimToUndefined(typeof row.runtime_key === 'string' ? row.runtime_key : (typeof row.runtimeKey === 'string' ? row.runtimeKey : undefined)),
    deliveryKind,
    status,
    originConversationType: normalizeConversationType(
      typeof row.origin_conversation_type === 'string'
        ? row.origin_conversation_type
        : (typeof row.originConversationType === 'string' ? row.originConversationType : undefined),
    ),
    originConversationId: trimToUndefined(
      typeof row.origin_conversation_id === 'string'
        ? row.origin_conversation_id
        : (typeof row.originConversationId === 'string' ? row.originConversationId : undefined),
    ),
    originChatSessionId: trimToUndefined(
      typeof row.origin_chat_session_id === 'string'
        ? row.origin_chat_session_id
        : (typeof row.originChatSessionId === 'string' ? row.originChatSessionId : undefined),
    ),
    originMessageId: trimToUndefined(
      typeof row.origin_message_id === 'string'
        ? row.origin_message_id
        : (typeof row.originMessageId === 'string' ? row.originMessageId : undefined),
    ),
    creatorParticipantId: trimToUndefined(
      typeof row.creator_participant_id === 'string'
        ? row.creator_participant_id
        : (typeof row.creatorParticipantId === 'string' ? row.creatorParticipantId : undefined),
    ),
    creatorParticipantName: trimToUndefined(
      typeof row.creator_participant_name === 'string'
        ? row.creator_participant_name
        : (typeof row.creatorParticipantName === 'string' ? row.creatorParticipantName : undefined),
    ),
    executorAgentId: trimToUndefined(
      typeof row.executor_agent_id === 'string'
        ? row.executor_agent_id
        : (typeof row.executorAgentId === 'string' ? row.executorAgentId : undefined),
    ),
    executorAgentName: trimToUndefined(
      typeof row.executor_agent_name === 'string'
        ? row.executor_agent_name
        : (typeof row.executorAgentName === 'string' ? row.executorAgentName : undefined),
    ),
    reportActorAgentId: trimToUndefined(
      typeof row.report_actor_agent_id === 'string'
        ? row.report_actor_agent_id
        : (typeof row.reportActorAgentId === 'string' ? row.reportActorAgentId : undefined),
    ),
    reportActorAgentName: trimToUndefined(
      typeof row.report_actor_agent_name === 'string'
        ? row.report_actor_agent_name
        : (typeof row.reportActorAgentName === 'string' ? row.reportActorAgentName : undefined),
    ),
    taskName: trimToUndefined(typeof row.task_name === 'string' ? row.task_name : (typeof row.taskName === 'string' ? row.taskName : undefined)),
    runCount: typeof runCountRaw === 'number' && Number.isFinite(runCountRaw) ? Math.max(0, Math.floor(runCountRaw)) : undefined,
    attemptStatus: trimToUndefined(
      typeof row.attempt_status === 'string' ? row.attempt_status : (typeof row.attemptStatus === 'string' ? row.attemptStatus : undefined),
    ) as TaskReportDelivery['attemptStatus'],
    attemptCount: typeof row.attempt_count === 'number'
      ? Math.max(0, Math.floor(row.attempt_count))
      : (typeof row.attemptCount === 'number' ? Math.max(0, Math.floor(row.attemptCount)) : undefined),
    summaryText: trimToUndefined(
      typeof row.summary_text === 'string'
        ? row.summary_text
        : (typeof row.summaryText === 'string'
          ? row.summaryText
          : (typeof row.body === 'string' ? row.body : undefined)),
    ),
    errorText: trimToUndefined(
      typeof row.error_text === 'string' ? row.error_text : (typeof row.errorText === 'string' ? row.errorText : undefined),
    ),
    payload,
    createdAt,
    updatedAt,
    reportedAt: trimToUndefined(typeof row.reported_at === 'string' ? row.reported_at : (typeof row.reportedAt === 'string' ? row.reportedAt : undefined)),
    acknowledgedAt: trimToUndefined(typeof row.acknowledged_at === 'string' ? row.acknowledged_at : (typeof row.acknowledgedAt === 'string' ? row.acknowledgedAt : undefined)),
  };
}

function unwrapTaskDeliveryRows(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!isRecord(input)) return [];
  const rows = input.deliveries;
  return Array.isArray(rows) ? rows : [];
}

function unwrapTaskDeliveryItem(input: unknown): unknown {
  if (!isRecord(input)) return input;
  return 'delivery' in input ? input.delivery : input;
}

function mapManagedTaskSchedule(input: Record<string, unknown>): Task['schedule'] {
  const kind = trimToUndefined(typeof input.kind === 'string' ? input.kind : undefined);
  if (kind === 'at') {
    return {
      kind: 'at',
      at: trimToUndefined(typeof input.at === 'string' ? input.at : undefined),
    };
  }
  if (kind === 'every') {
    const everySecs = typeof input.every_secs === 'number'
      ? input.every_secs
      : (typeof input.everySecs === 'number' ? input.everySecs : undefined);
    return {
      kind: 'every',
      everyMs: typeof everySecs === 'number' && Number.isFinite(everySecs)
        ? Math.max(1000, Math.floor(everySecs * 1000))
        : 60_000,
    };
  }
  return {
    kind: 'cron',
    expr: trimToUndefined(typeof input.expr === 'string' ? input.expr : undefined) || '* * * * *',
    tz: trimToUndefined(typeof input.tz === 'string' ? input.tz : undefined),
  };
}

function toFinitePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

function mapTaskCapabilities(input: unknown): Task['capabilities'] | undefined {
  if (!isRecord(input)) return undefined;
  return {
    publish: Boolean(input.publish),
    pause: Boolean(input.pause),
    runOnce: Boolean(input.run_once ?? input.runOnce),
    delete: Boolean(input.delete),
  };
}

function mapTaskDeliveryStats(input: unknown): Task['deliveryStats'] | undefined {
  if (!isRecord(input)) return undefined;
  return {
    total: toFinitePositiveInt(input.total) ?? 0,
    pending: toFinitePositiveInt(input.pending) ?? 0,
    reported: toFinitePositiveInt(input.reported) ?? 0,
    acknowledged: toFinitePositiveInt(input.acknowledged) ?? 0,
    failed: toFinitePositiveInt(input.failed) ?? 0,
    attempts: toFinitePositiveInt(input.attempts) ?? 0,
    attemptFailures: toFinitePositiveInt(input.attempt_failures ?? input.attemptFailures) ?? 0,
  };
}

function mapTaskFinalSummary(input: unknown): Task['finalSummary'] | null | undefined {
  if (!isRecord(input)) return undefined;
  const content = trimToUndefined(typeof input.content === 'string' ? input.content : undefined);
  const createdAt = trimToUndefined(typeof input.created_at === 'string' ? input.created_at : (typeof input.createdAt === 'string' ? input.createdAt : undefined));
  if (!content || !createdAt) return null;
  return {
    runCount: toFinitePositiveInt(input.run_count ?? input.runCount) ?? 0,
    status: trimToUndefined(typeof input.status === 'string' ? input.status : undefined),
    content,
    createdAt,
    runId: trimToUndefined(typeof input.run_id === 'string' ? input.run_id : (typeof input.runId === 'string' ? input.runId : undefined)),
    eventId: trimToUndefined(typeof input.event_id === 'string' ? input.event_id : (typeof input.eventId === 'string' ? input.eventId : undefined)),
  };
}

function mapTaskTimelineEntry(input: unknown): Task['timeline'][number] | null {
  if (!isRecord(input)) return null;
  const id = trimToUndefined(typeof input.id === 'string' ? input.id : undefined);
  const sourceKind = trimToUndefined(typeof input.source_kind === 'string' ? input.source_kind : (typeof input.sourceKind === 'string' ? input.sourceKind : undefined));
  const sourceId = trimToUndefined(typeof input.source_id === 'string' ? input.source_id : (typeof input.sourceId === 'string' ? input.sourceId : undefined));
  const taskId = trimToUndefined(typeof input.task_id === 'string' ? input.task_id : (typeof input.taskId === 'string' ? input.taskId : undefined));
  const createdAt = trimToUndefined(typeof input.created_at === 'string' ? input.created_at : (typeof input.createdAt === 'string' ? input.createdAt : undefined));
  const summary = trimToUndefined(typeof input.summary === 'string' ? input.summary : undefined);
  if (!id || !sourceKind || !sourceId || !taskId || !createdAt || !summary) return null;
  return {
    id,
    sourceKind,
    sourceId,
    taskId,
    runId: trimToUndefined(typeof input.run_id === 'string' ? input.run_id : (typeof input.runId === 'string' ? input.runId : undefined)),
    eventId: trimToUndefined(typeof input.event_id === 'string' ? input.event_id : (typeof input.eventId === 'string' ? input.eventId : undefined)),
    targetKind: trimToUndefined(typeof input.target_kind === 'string' ? input.target_kind : (typeof input.targetKind === 'string' ? input.targetKind : undefined)),
    status: trimToUndefined(typeof input.status === 'string' ? input.status : undefined),
    summary,
    metadata: isRecord(input.metadata) ? input.metadata : null,
    createdAt,
  };
}

function mapManagedTaskDetail(input: unknown): Task | null {
  const row = isRecord(input) ? input : null;
  const spec = row && isRecord(row.spec) ? row.spec : null;
  const runtime = row && isRecord(row.runtime) ? row.runtime : null;
  if (!spec || !runtime) return null;

  const id = trimToUndefined(typeof spec.id === 'string' ? spec.id : undefined);
  const agentId = trimToUndefined(typeof spec.agent_id === 'string' ? spec.agent_id : undefined);
  const name = trimToUndefined(typeof spec.name === 'string' ? spec.name : undefined);
  if (!id || !agentId || !name) return null;

  taskAgentIndex.set(id, agentId);
  const meta = getTaskMeta(id);
  const schedule = isRecord(spec.schedule) ? mapManagedTaskSchedule(spec.schedule) : { kind: 'cron' as const, expr: '* * * * *' };
  const action = isRecord(spec.action) ? spec.action : {};
  const delivery = isRecord(spec.delivery) ? spec.delivery : {};
  const runtimeStateRaw = trimToUndefined(typeof runtime.state === 'string' ? runtime.state : undefined);
  const runtimeState: Task['runtimeState'] = runtimeStateRaw === 'draft'
    || runtimeStateRaw === 'scheduled'
    || runtimeStateRaw === 'running'
    || runtimeStateRaw === 'paused'
    || runtimeStateRaw === 'completed'
    || runtimeStateRaw === 'failed'
    || runtimeStateRaw === 'disabled'
    ? runtimeStateRaw
    : undefined;
  const sourceTypeRaw = trimToUndefined(typeof spec.source_type === 'string' ? spec.source_type : undefined);
  const sourceType: Task['sourceType'] = sourceTypeRaw === 'chat' || sourceTypeRaw === 'manual'
    ? sourceTypeRaw
    : 'custom';
  const maxRunsRaw = typeof spec.max_runs === 'number' ? spec.max_runs : undefined;
  const runCountRaw = typeof runtime.run_count === 'number' ? runtime.run_count : 0;
  const preview = trimToUndefined(
    typeof runtime.latest_summary === 'string'
      ? runtime.latest_summary
      : (typeof runtime.last_output === 'string' ? runtime.last_output : undefined),
  );
  const mapped: Task = {
    id,
    teamId: agentId,
    name: meta?.displayName?.trim() || sanitizeTaskName(name),
    sourceType,
    sourceRef: trimToUndefined(typeof spec.source_ref === 'string' ? spec.source_ref : undefined) || meta?.sourceRef,
    enabled: Boolean(spec.enabled),
    createdAt: trimToUndefined(typeof spec.created_at === 'string' ? spec.created_at : undefined) || nowIso(),
    updatedAt: trimToUndefined(typeof spec.updated_at === 'string' ? spec.updated_at : undefined) || nowIso(),
    schedule,
    jobType:
      trimToUndefined(typeof action.job_type === 'string' ? action.job_type : undefined) === 'shell'
        ? 'shell'
        : 'agent',
    prompt: trimToUndefined(typeof action.prompt === 'string' ? action.prompt : undefined),
    command: trimToUndefined(typeof action.command === 'string' ? action.command : undefined),
    sessionTarget:
      trimToUndefined(typeof action.session_target === 'string' ? action.session_target : undefined) === 'main'
        ? 'main'
        : 'isolated',
    delivery: {
      mode:
        trimToUndefined(typeof delivery.mode === 'string' ? delivery.mode : undefined) === 'announce'
          ? 'announce'
          : 'none',
      channel: trimToUndefined(typeof delivery.channel === 'string' ? delivery.channel : undefined),
      to: trimToUndefined(typeof delivery.to === 'string' ? delivery.to : undefined),
      bestEffort:
        typeof delivery.best_effort === 'boolean'
          ? delivery.best_effort
          : (typeof delivery.bestEffort === 'boolean' ? delivery.bestEffort : undefined),
      finalSummaryPrompt: trimToUndefined(
        typeof delivery.final_summary_prompt === 'string'
          ? delivery.final_summary_prompt
          : (typeof delivery.finalSummaryPrompt === 'string' ? delivery.finalSummaryPrompt : undefined),
      ),
      notifyOnFinal:
        typeof delivery.notify_on_final === 'boolean'
          ? delivery.notify_on_final
          : (typeof delivery.notifyOnFinal === 'boolean' ? delivery.notifyOnFinal : undefined),
    },
    isTemplate: Boolean(meta?.isTemplate),
    maxRuns: typeof maxRunsRaw === 'number' && Number.isFinite(maxRunsRaw) && maxRunsRaw > 0
      ? Math.max(1, Math.floor(maxRunsRaw))
      : undefined,
    runtimeState,
    capabilities: mapTaskCapabilities(row.capabilities),
    deliveryStats: mapTaskDeliveryStats(row.delivery_stats ?? row.deliveryStats),
    finalSummary: mapTaskFinalSummary(row.final_summary ?? row.finalSummary) ?? null,
    timeline: Array.isArray(row.timeline)
      ? row.timeline.map((item) => mapTaskTimelineEntry(item)).filter((item): item is NonNullable<Task['timeline']>[number] => item != null)
      : [],
    runInfo: {
      nextRun: trimToUndefined(typeof runtime.next_run === 'string' ? runtime.next_run : undefined),
      lastRun: trimToUndefined(typeof runtime.last_run === 'string' ? runtime.last_run : undefined),
      lastStatus: normalizeStatus(typeof runtime.last_status === 'string' ? runtime.last_status : undefined),
      lastOutputPreview: preview,
      runCount: typeof runCountRaw === 'number' && Number.isFinite(runCountRaw)
        ? Math.max(0, Math.floor(runCountRaw))
        : 0,
    },
  };
  taskSnapshotCache.set(id, mapped);
  return mapped;
}

function mapManagedTaskRun(input: unknown): TaskRunRecord | null {
  const row = isRecord(input) ? input : null;
  if (!row) return null;
  const id = trimToUndefined(typeof row.id === 'string' ? row.id : undefined);
  const taskId = trimToUndefined(typeof row.task_id === 'string' ? row.task_id : (typeof row.taskId === 'string' ? row.taskId : undefined));
  const startTime = trimToUndefined(
    typeof row.start_time === 'string' ? row.start_time : (typeof row.startTime === 'string' ? row.startTime : undefined),
  );
  if (!id || !taskId || !startTime) return null;
  const output = trimToUndefined(
    typeof row.summary === 'string'
      ? row.summary
      : (typeof row.output === 'string'
        ? row.output
        : (typeof row.error === 'string' ? row.error : undefined)),
  ) || '';
  return {
    id,
    taskId,
    startTime,
    endTime: trimToUndefined(
      typeof row.end_time === 'string' ? row.end_time : (typeof row.endTime === 'string' ? row.endTime : undefined),
    ),
    status: normalizeStatus(typeof row.status === 'string' ? row.status : undefined),
    output,
  };
}

function readTaskMetaMap(): Record<string, TaskLocalMeta> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(TASK_LOCAL_META_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, TaskLocalMeta>;
  } catch {
    return {};
  }
}

function writeTaskMetaMap(next: Record<string, TaskLocalMeta>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TASK_LOCAL_META_KEY, JSON.stringify(next));
}

function getTaskMeta(taskId: string): TaskLocalMeta | undefined {
  const map = readTaskMetaMap();
  return map[taskId];
}

function upsertTaskMeta(taskId: string, patch: Partial<TaskLocalMeta>): TaskLocalMeta {
  const map = readTaskMetaMap();
  const existing = map[taskId];
  const next: TaskLocalMeta = {
    taskId,
    agentId: patch.agentId || existing?.agentId || '',
    sourceType: patch.sourceType || existing?.sourceType || 'custom',
    displayName: patch.displayName ?? existing?.displayName,
    manualStartRequired: patch.manualStartRequired ?? existing?.manualStartRequired,
    isTemplate: patch.isTemplate ?? existing?.isTemplate,
    sourceRef: patch.sourceRef ?? existing?.sourceRef,
    maxRuns: patch.maxRuns ?? existing?.maxRuns,
    runCountCache: patch.runCountCache ?? existing?.runCountCache,
    lastRunToken: patch.lastRunToken ?? existing?.lastRunToken,
    deliveryMode: patch.deliveryMode ?? existing?.deliveryMode,
    deliveryChannel: patch.deliveryChannel ?? existing?.deliveryChannel,
    deliveryTarget: patch.deliveryTarget ?? existing?.deliveryTarget,
    deliveryBestEffort: patch.deliveryBestEffort ?? existing?.deliveryBestEffort,
    finalSummaryPrompt: patch.finalSummaryPrompt ?? existing?.finalSummaryPrompt,
    notifyOnFinal: patch.notifyOnFinal ?? existing?.notifyOnFinal,
    completionNotifiedRunCount:
      patch.completionNotifiedRunCount ?? existing?.completionNotifiedRunCount,
    runLogs: patch.runLogs ?? existing?.runLogs,
    createdAt: existing?.createdAt || patch.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  map[taskId] = next;
  writeTaskMetaMap(map);
  return next;
}

function removeTaskMeta(taskId: string): void {
  const map = readTaskMetaMap();
  if (!map[taskId]) return;
  delete map[taskId];
  writeTaskMetaMap(map);
}

export function isHttp404Message(message?: string): boolean {
  return /HTTP\s*404/i.test((message || '').trim());
}

export function mapAgentTaskToTask(
  task: AgentTask,
  agentId: string,
  meta: TaskLocalMeta | undefined,
  runCount = 0,
  preview = '',
): Task {
  taskAgentIndex.set(task.id, agentId);
  const sourceType = meta?.sourceType || task.sourceType || 'custom';
  const inferredDisplayName = sourceType === 'chat' ? inferChatTaskDisplayName(task.prompt) : undefined;
  const inferredMaxRuns = parseMaxRunsFromPrompt(task.prompt);
  const resolvedMaxRuns = meta?.maxRuns && meta.maxRuns > 0 ? meta.maxRuns : inferredMaxRuns;
  const enforcePending = Boolean(meta?.manualStartRequired) && !(task.lastRun && task.lastRun.trim());
  return {
    id: task.id,
    teamId: agentId,
    name: meta?.displayName?.trim() || inferredDisplayName || sanitizeTaskName(task.name),
    sourceType,
    isTemplate: Boolean(meta?.isTemplate),
    sourceRef: meta?.sourceRef,
    enabled: enforcePending ? false : task.enabled,
    createdAt: task.lastRun || task.nextRun || nowIso(),
    updatedAt: nowIso(),
    schedule: toTaskSchedule(task),
    jobType: task.jobType,
    prompt: task.prompt,
    command: task.command,
    sessionTarget: task.sessionTarget,
    delivery: {
      mode: meta?.deliveryMode || 'none',
      channel: meta?.deliveryChannel,
      to: meta?.deliveryTarget,
      bestEffort: meta?.deliveryBestEffort,
      finalSummaryPrompt: meta?.finalSummaryPrompt,
      notifyOnFinal: meta?.notifyOnFinal,
    },
    maxRuns: resolvedMaxRuns && resolvedMaxRuns > 0 ? resolvedMaxRuns : undefined,
    runInfo: {
      nextRun: task.nextRun,
      lastRun: task.lastRun,
      lastStatus: normalizeStatus(task.lastStatus),
      lastOutputPreview: preview || undefined,
      runCount,
    },
  };
}

async function resolveAgentIds(scope?: string): Promise<string[]> {
  const all = await listAgents();
  const ids = all.map((item) => item.agentId).filter(Boolean);
  if (ids.length === 0) return [];

  if (scope && scope !== 'team-001' && scope !== 'all') {
    return ids.includes(scope) ? [scope] : [];
  }
  if (scope === 'all') {
    return ids;
  }

  const remembered =
    (typeof window !== 'undefined' ? window.localStorage.getItem(TASK_CLIENT_AGENT_ID_KEY) : '') || '';
  if (remembered && ids.includes(remembered)) {
    return [remembered];
  }
  return [ids[0]];
}

async function findTaskAgentId(taskId: string): Promise<string | null> {
  const fromCache = taskAgentIndex.get(taskId);
  if (fromCache) return fromCache;
  const meta = getTaskMeta(taskId);
  if (meta?.agentId) return meta.agentId;

  try {
    const detail = await requestJson<unknown>(
      `/api/management/tasks/${encodeURIComponent(taskId)}`,
    );
    const mapped = mapManagedTaskDetail(detail);
    if (mapped?.teamId) {
      taskAgentIndex.set(taskId, mapped.teamId);
      upsertTaskMeta(taskId, { agentId: mapped.teamId });
      return mapped.teamId;
    }
  } catch {
    // ignore and fallback
  }

  const agentIds = await resolveAgentIds('all');
  for (const agentId of agentIds) {
    const listed = await listAgentTasks({ agentId });
    if (!listed.success) continue;
    if (listed.tasks.some((task) => task.id === taskId)) {
      taskAgentIndex.set(taskId, agentId);
      upsertTaskMeta(taskId, { agentId });
      return agentId;
    }
  }
  return null;
}

export function mapLogsToRuns(taskId: string, logs: readonly AgentTaskLogItem[]): TaskRunRecord[] {
  return logs.map((log, index) => ({
    id: `${taskId}-${index}-${log.createdAt}`,
    taskId,
    startTime: log.createdAt,
    endTime: log.createdAt,
    status: normalizeStatus(log.kind),
    output: log.message,
  }));
}

function normalizeTaskLog(input: AgentTaskLogItem | TaskLocalRunLog): TaskLocalRunLog | null {
  const createdAt = (input.createdAt || '').trim();
  const kind = (input.kind || '').trim();
  const message = (input.message || '').trim();
  if (!createdAt || (!kind && !message)) {
    return null;
  }
  const eventId = (input.eventId || '').trim() || `${createdAt}-${kind}-${message.slice(0, 120)}`;
  return {
    eventId,
    createdAt,
    kind: kind || 'status',
    message: message || kind || 'status',
  };
}

function taskLogUniqueKey(log: TaskLocalRunLog): string {
  const eventId = log.eventId.trim();
  if (eventId) {
    return `id:${eventId}`;
  }
  const createdAt = log.createdAt.trim();
  const kind = log.kind.trim();
  if (createdAt) {
    return `ck:${createdAt}|${kind}`;
  }
  return `msg:${log.message.slice(0, 200)}`;
}

function parseTaskLogTime(raw: string): number {
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeTextForMatch(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function isMissingSummaryPlaceholder(text: string): boolean {
  return /did not produce a text summary/i.test(text.trim());
}

function isGenericLogMessage(log: TaskLocalRunLog): boolean {
  const message = log.message.trim().toLowerCase();
  const kind = log.kind.trim().toLowerCase();
  if (!message) return true;
  if (isMissingSummaryPlaceholder(message)) return true;
  if (message.startsWith('该次执行未直接返回文本摘要')) return true;
  if (message.startsWith('该次执行成功，但上游未返回文本摘要')) return true;
  if (message.startsWith('该次执行未返回文本摘要')) return true;
  if (message === kind) return true;
  return ['ok', 'success', 'done', 'completed', 'running', 'status'].includes(message);
}

function logMessageScore(log: TaskLocalRunLog): number {
  const message = log.message.trim();
  if (!message) return 0;
  if (isMissingSummaryPlaceholder(message)) return 1;
  if (isGenericLogMessage(log)) return 1;
  if (message.startsWith('```json')) return 6;
  if (message.includes('\n') || message.includes('{') || message.includes('}')) return 5;
  if (message.length >= 48) return 4;
  return 3;
}

function pickBetterLog(current: TaskLocalRunLog | undefined, next: TaskLocalRunLog): TaskLocalRunLog {
  if (!current) return next;
  const currentScore = logMessageScore(current);
  const nextScore = logMessageScore(next);
  if (nextScore > currentScore) {
    return {
      ...current,
      ...next,
      eventId: current.eventId || next.eventId,
      createdAt: current.createdAt || next.createdAt,
    };
  }
  return {
    ...current,
    eventId: current.eventId || next.eventId,
    kind: current.kind || next.kind,
    message: current.message || next.message,
    createdAt: current.createdAt || next.createdAt,
  };
}

function extractTaskOutputsFromSession(
  messages: readonly AgentSessionMessage[],
  taskPrompt: string,
  limit: number,
): string[] {
  const normalizedPrompt = normalizeTextForMatch(taskPrompt);
  if (!normalizedPrompt) return [];

  const outputs: string[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const row = messages[index];
    if (row.role !== 'user') continue;
    const normalizedUserContent = normalizeTextForMatch(row.content);
    const matched =
      normalizedUserContent === normalizedPrompt
      || normalizedUserContent.includes(normalizedPrompt)
      || normalizedPrompt.includes(normalizedUserContent);
    if (!matched) continue;

    let assistantText = '';
    for (let lookahead = index + 1; lookahead < messages.length; lookahead += 1) {
      const next = messages[lookahead];
      if (next.role === 'user') break;
      if (next.role === 'assistant' && next.content.trim()) {
        assistantText = next.content.trim();
        break;
      }
    }
    if (assistantText) {
      outputs.push(assistantText);
    }
  }

  if (limit > 0 && outputs.length > limit) {
    return outputs.slice(outputs.length - limit);
  }
  return outputs;
}

function applyOutputsToLogs(logs: readonly TaskLocalRunLog[], outputs: readonly string[]): TaskLocalRunLog[] {
  if (outputs.length === 0) {
    return [...logs];
  }
  const ordered = [...logs].sort((a, b) => parseTaskLogTime(a.createdAt) - parseTaskLogTime(b.createdAt));
  const start = Math.max(0, ordered.length - outputs.length);

  for (let index = 0; index < outputs.length; index += 1) {
    const targetIndex = start + index;
    if (targetIndex < 0 || targetIndex >= ordered.length) continue;
    const output = outputs[index].trim();
    if (!output) continue;
    const current = ordered[targetIndex];
    if (isGenericLogMessage(current) || current.message.trim().length <= 16) {
      ordered[targetIndex] = {
        ...current,
        message: output,
        kind: current.kind || 'ok',
      };
    }
  }

  if (outputs.length > ordered.length) {
    const base = Date.now();
    for (let index = ordered.length; index < outputs.length; index += 1) {
      const output = outputs[index].trim();
      if (!output) continue;
      ordered.push({
        eventId: `session-backfill-${base}-${index}`,
        createdAt: new Date(base + index * 1000).toISOString(),
        kind: 'ok',
        message: output,
      });
    }
  }

  return ordered.sort((a, b) => parseTaskLogTime(b.createdAt) - parseTaskLogTime(a.createdAt));
}

function buildNoSummaryFallbackMessage(log: TaskLocalRunLog): string {
  const status = normalizeStatus(log.kind);
  if (status === 'ok') {
    return '该次执行成功，但上游未返回文本摘要。请在智能体会话中查看原始输出。';
  }
  if (status === 'error') {
    return '该次执行失败，且未返回可读错误摘要。请在智能体会话中查看原始输出。';
  }
  return '该次执行未返回文本摘要。请在智能体会话中查看原始输出。';
}

export function backfillMissingSummaryLogs(logs: readonly TaskLocalRunLog[]): TaskLocalRunLog[] {
  if (logs.length === 0) return [];
  const fallback = logs.find((row) => !isGenericLogMessage(row))?.message?.trim();
  if (!fallback) {
    return logs.map((row) => {
      if (!isGenericLogMessage(row)) return row;
      return {
        ...row,
        message: buildNoSummaryFallbackMessage(row),
      };
    });
  }

  return logs.map((row) => {
    if (isGenericLogMessage(row)) {
      return {
        ...row,
        message: `该次执行未直接返回文本摘要，已回填最近一次有效结果：\n${fallback}`,
      };
    }
    return row;
  });
}

export async function enrichLogsFromAgentSession(
  agentId: string,
  task: AgentTask,
  logs: readonly TaskLocalRunLog[],
): Promise<TaskLocalRunLog[]> {
  if (!agentId) return [...logs];
  const prompt = (task.prompt || '').trim();
  if (!prompt) return [...logs];

  const session = await getAgentSession(agentId);
  if (!session.success || session.messages.length === 0) {
    return [...logs];
  }
  const outputs = extractTaskOutputsFromSession(session.messages, prompt, Math.max(logs.length, 600));
  if (outputs.length === 0) {
    return [...logs];
  }
  return applyOutputsToLogs(logs, outputs);
}

export function mergeTaskLogs(
  existing?: readonly TaskLocalRunLog[],
  incoming?: readonly AgentTaskLogItem[],
  options?: {
    maxRuns?: number;
    lastRun?: string;
    enabled?: boolean;
  },
): TaskLocalRunLog[] {
  const merged = new Map<string, TaskLocalRunLog>();

  for (const row of existing || []) {
    const normalized = normalizeTaskLog(row);
    if (!normalized) continue;
    const key = taskLogUniqueKey(normalized);
    merged.set(key, pickBetterLog(merged.get(key), normalized));
  }
  for (const row of incoming || []) {
    const normalized = normalizeTaskLog(row);
    if (!normalized) continue;
    const key = taskLogUniqueKey(normalized);
    merged.set(key, pickBetterLog(merged.get(key), normalized));
  }

  let rows = [...merged.values()]
    .sort((a, b) => parseTaskLogTime(b.createdAt) - parseTaskLogTime(a.createdAt));

  // 历史污染修复：旧版本可能在任务已停止后重复追加“当前时间”日志。
  // 当任务已禁用且 last_run 已知时，过滤掉晚于 last_run 的异常条目。
  const lastRunTs = parseTaskLogTime(options?.lastRun || '');
  if (options?.enabled === false && lastRunTs > 0) {
    const repaired = rows.filter((item) => {
      const ts = parseTaskLogTime(item.createdAt);
      return ts > 0 && ts <= lastRunTs + 3000;
    });
    if (repaired.length > 0) {
      rows = repaired;
    }
  }

  const maxRuns = typeof options?.maxRuns === 'number' && options.maxRuns > 0
    ? Math.floor(options.maxRuns)
    : 0;
  if (maxRuns > 0 && rows.length > maxRuns) {
    rows = rows.slice(0, maxRuns);
  }
  return rows;
}

export function toAgentTaskLogs(localLogs?: readonly TaskLocalRunLog[]): AgentTaskLogItem[] {
  return (localLogs || []).map((item) => ({
    eventId: item.eventId,
    createdAt: item.createdAt,
    kind: item.kind,
    message: item.message,
  }));
}

export function calculateRunCount(
  meta: TaskLocalMeta | undefined,
  task: AgentTask,
  logs: readonly AgentTaskLogItem[],
  runCountHint?: number,
): number {
  const fromLogs = logs.length;
  const cached = meta?.runCountCache ?? 0;
  const maxRuns = typeof meta?.maxRuns === 'number' && meta.maxRuns > 0
    ? Math.floor(meta.maxRuns)
    : 0;
  const normalizeWithLimit = (count: number): number => {
    if (maxRuns > 0 && task.enabled === false) {
      return Math.min(count, maxRuns);
    }
    return count;
  };
  if (typeof runCountHint === 'number' && Number.isFinite(runCountHint) && runCountHint > 0) {
    return normalizeWithLimit(Math.max(Math.floor(runCountHint), fromLogs, cached));
  }
  const hasLastRun = Boolean(task.lastRun && task.lastRun.trim());
  if (!hasLastRun) {
    return normalizeWithLimit(Math.max(0, fromLogs, cached));
  }
  // 某些后端状态接口仅返回最近一次日志，不能直接用 logs.length 代表总次数；
  // 这里优先基于 last_run token 变化做本地增量累计。
  const tokenChanged = task.lastRun !== meta?.lastRunToken;
  const inferredByToken = tokenChanged
    ? Math.max(1, cached + 1)
    : Math.max(1, cached);
  if (fromLogs > 0) {
    return normalizeWithLimit(Math.max(fromLogs, inferredByToken));
  }
  return normalizeWithLimit(inferredByToken);
}

export function setTaskCenterAgentId(agentId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TASK_CLIENT_AGENT_ID_KEY, agentId);
}

export function hasTaskEverStarted(task: Task): boolean {
  return Boolean(task.runInfo.lastRun) || task.runInfo.runCount > 0;
}

export function canDeleteTask(task: Task): boolean {
  if (typeof task.capabilities?.delete === 'boolean') {
    return task.capabilities.delete;
  }
  if (task.runInfo.lastStatus === 'running') return false;
  const hasLimit = Boolean(task.maxRuns && task.maxRuns > 0);
  const reachedFinal = hasLimit && task.runInfo.runCount >= (task.maxRuns || 0);
  if (reachedFinal && (task.runInfo.lastStatus === 'ok' || task.runInfo.lastStatus === 'error')) {
    return true;
  }
  return !task.enabled;
}

async function updateTaskEnabledByApi(taskId: string, enabled: boolean): Promise<{ success: boolean; message?: string }> {
  const encoded = encodeURIComponent(taskId);
  try {
    await requestJson<unknown>(
      enabled
        ? `/api/management/tasks/${encoded}/publish`
        : `/api/management/tasks/${encoded}/pause`,
      {
        method: 'POST',
        body: {},
      },
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '更新任务状态失败。',
    };
  }
}

export async function listTasks(scope: string): Promise<Task[]> {
  const agentIds = await resolveAgentIds(scope);
  if (agentIds.length === 0) {
    return [];
  }

  const buckets = await Promise.allSettled(
    agentIds.map(async (agentId) => {
      const rows = await requestJson<unknown[]>(
        `/api/compose/tasks/overview?agent_id=${encodeURIComponent(agentId)}`,
        {
          timeoutMs: TASK_LIST_TIMEOUT_MS,
        },
      );
      return Array.isArray(rows)
        ? rows.map((item) => mapManagedTaskDetail(item)).filter((item): item is Task => item != null)
        : [];
    }),
  );
  const fulfilledBuckets = buckets
    .filter((result): result is PromiseFulfilledResult<Task[]> => result.status === 'fulfilled')
    .map((result) => result.value);
  if (fulfilledBuckets.length === 0) {
    const rejected = buckets.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    throw rejected?.reason instanceof Error
      ? rejected.reason
      : new Error('任务列表读取失败。');
  }
  buckets
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .forEach((result) => {
      console.warn('[TaskClient] listTasks partial failure:', result.reason);
    });

  const tasks = fulfilledBuckets
    .flat()
    .sort((a, b) => {
      const ta = Date.parse(a.runInfo.nextRun || a.runInfo.lastRun || a.updatedAt);
      const tb = Date.parse(b.runInfo.nextRun || b.runInfo.lastRun || b.updatedAt);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

  return tasks;
}

export async function createTask(
  task: Partial<Task> & {
    remoteChatSessionId?: string;
    remoteChatSessionOwnerAgentId?: string;
    reportCondition?: string;
    summaryStyle?: string;
    originConversationType?: TaskConversationType;
    originConversationId?: string;
    originChatSessionId?: string;
    originMessageId?: string;
    creatorParticipantId?: string;
    creatorParticipantName?: string;
    executorAgentId?: string;
    executorAgentName?: string;
    reportActorAgentId?: string;
    reportActorAgentName?: string;
  },
): Promise<{ success: boolean; data?: Task; message?: string }> {
  const agentId = task.teamId || (await resolveAgentIds(undefined))[0];
  if (!agentId) {
    return { success: false, message: '没有可用智能体。' };
  }

  const scheduleKind = task.schedule?.kind || 'cron';
  const sourceType: Task['sourceType'] = task.sourceType || 'custom';
  const inputName = task.name || '未命名任务';
  const persistedName = toBackendSafeTaskName(inputName, sourceType);
  let createdTask: Task | null = null;
  try {
    const created = await requestJson<unknown>('/api/management/tasks', {
      method: 'POST',
      body: {
        agent_id: agentId,
        name: persistedName,
        source_type: sourceType === 'chat' ? 'chat' : (sourceType === 'manual' ? 'manual' : 'custom'),
        source_ref: trimToUndefined(task.sourceRef),
        report_condition: trimToUndefined(task.reportCondition),
        summary_style: trimToUndefined(task.summaryStyle),
        schedule: {
          kind: scheduleKind,
          expr: scheduleKind === 'cron' ? trimToUndefined(task.schedule?.expr) : undefined,
          tz: trimToUndefined(task.schedule?.tz),
          at: scheduleKind === 'at' ? trimToUndefined(task.schedule?.at) : undefined,
          every_secs:
            scheduleKind === 'every' && typeof task.schedule?.everyMs === 'number'
              ? Math.max(1, Math.floor(task.schedule.everyMs / 1000))
              : undefined,
        },
        action: {
          job_type: task.jobType || 'agent',
          prompt: trimToUndefined(task.prompt),
          command: trimToUndefined(task.command),
          session_target: task.sessionTarget,
        },
        delivery: {
          mode: task.delivery?.mode === 'announce' ? 'announce' : 'none',
          channel: trimToUndefined(task.delivery?.channel),
          to: trimToUndefined(task.delivery?.to),
          best_effort: task.delivery?.bestEffort,
          final_summary_prompt: trimToUndefined(task.delivery?.finalSummaryPrompt),
          notify_on_final: task.delivery?.notifyOnFinal,
        },
        max_runs:
          typeof task.maxRuns === 'number' && Number.isFinite(task.maxRuns) && task.maxRuns > 0
            ? Math.floor(task.maxRuns)
            : undefined,
        binding: {
          origin_conversation_type: task.originConversationType,
          origin_conversation_id: trimToUndefined(task.originConversationId),
          origin_chat_session_id: trimToUndefined(task.originChatSessionId),
          origin_message_id: trimToUndefined(task.originMessageId),
          remote_chat_session_id: trimToUndefined(task.remoteChatSessionId),
          remote_chat_session_owner_agent_id: trimToUndefined(task.remoteChatSessionOwnerAgentId),
          creator_participant_id: trimToUndefined(task.creatorParticipantId),
          creator_participant_name: trimToUndefined(task.creatorParticipantName),
          executor_agent_id: trimToUndefined(task.executorAgentId),
          executor_agent_name: trimToUndefined(task.executorAgentName),
          report_actor_agent_id: trimToUndefined(task.reportActorAgentId),
          report_actor_agent_name: trimToUndefined(task.reportActorAgentName),
        },
        enabled: false,
      },
    });
    createdTask = mapManagedTaskDetail(created);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '创建任务失败。',
    };
  }
  if (!createdTask) {
    return { success: false, message: '创建任务失败。' };
  }

  const localMeta = upsertTaskMeta(createdTask.id, {
    agentId,
    sourceType,
    displayName: inputName,
    manualStartRequired: true,
    isTemplate: Boolean(task.isTemplate),
    sourceRef: task.sourceRef,
    maxRuns: task.maxRuns,
    deliveryMode: task.delivery?.mode,
    deliveryChannel: task.delivery?.channel,
    deliveryTarget: task.delivery?.to,
    deliveryBestEffort: task.delivery?.bestEffort,
    finalSummaryPrompt: task.delivery?.finalSummaryPrompt,
    notifyOnFinal: task.delivery?.notifyOnFinal,
    runCountCache: 0,
    lastRunToken: createdTask.runInfo.lastRun,
    runLogs: [],
  });
  return {
    success: true,
    data: {
      ...createdTask,
      name: localMeta.displayName?.trim() || createdTask.name,
      enabled: false,
    },
    message: '任务已创建。',
  };
}

export async function updateTask(
  taskId: string,
  updates: Partial<Task>,
): Promise<{ success: boolean; data?: Task; message?: string }> {
  const agentId = updates.teamId || (await findTaskAgentId(taskId));
  if (!agentId) {
    return { success: false, message: `未找到任务所属智能体：${taskId}` };
  }

  if (typeof updates.enabled === 'boolean') {
    const enabled = updates.enabled;
    const updated = await updateTaskEnabledByApi(taskId, enabled);
    if (!updated.success) {
      return { success: false, message: updated.message || '任务状态更新失败。' };
    }
    if (enabled) {
      upsertTaskMeta(taskId, { agentId, manualStartRequired: false });
    }
  } else {
    return { success: false, message: '当前仅支持更新任务启停状态。' };
  }
  const mapped = await getTaskDetail(taskId);
  return {
    success: true,
    data: mapped,
    message: mapped ? undefined : '任务状态已更新。',
  };
}

export async function deleteTask(taskId: string): Promise<{ success: boolean; message?: string }> {
  const detail = await getTaskDetail(taskId);
  if (detail && !canDeleteTask(detail)) {
    return { success: false, message: '任务已运行过，不能删除。' };
  }
  try {
    await requestJson<unknown>(`/api/management/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
    taskSnapshotCache.delete(taskId);
    removeTaskMeta(taskId);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '删除任务失败。',
    };
  }
}

export async function publishTask(taskId: string): Promise<{ success: boolean; message?: string; activeTaskId?: string }> {
  const updated = await updateTask(taskId, { enabled: true });
  return {
    success: updated.success,
    message: updated.message,
    activeTaskId: updated.success ? taskId : undefined,
  };
}

export async function runTaskOnce(taskId: string): Promise<{ success: boolean; message?: string }> {
  try {
    await requestJson<unknown>(`/api/management/tasks/${encodeURIComponent(taskId)}/run-once`, {
      method: 'POST',
      body: {},
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '立即执行失败。',
    };
  }
}

export async function pauseTask(taskId: string): Promise<{ success: boolean; message?: string }> {
  return updateTask(taskId, { enabled: false });
}

export async function resumeTask(taskId: string): Promise<{ success: boolean; message?: string }> {
  const detail = await getTaskDetail(taskId);
  if (detail && hasTaskEverStarted(detail)) {
    return { success: false, message: '任务已开跑，不能恢复为可删除状态，只能取消并查看日志。' };
  }
  return updateTask(taskId, { enabled: true });
}

export async function writeTaskDeliveryToChatSession(input: {
  deliveryId: string;
  taskId: string;
  messageText: string;
}): Promise<{ success: boolean; message?: string }> {
  const deliveryId = input.deliveryId.trim();
  const taskId = input.taskId.trim();
  const messageText = input.messageText.trim();
  if (!deliveryId || !taskId || !messageText) {
    return { success: false, message: '任务回写参数不完整。' };
  }
  try {
    await requestJson<unknown>(
      `/api/management/tasks/deliveries/${encodeURIComponent(deliveryId)}/chat-writeback`,
      {
        method: 'POST',
        body: {
          task_id: taskId,
          message_text: messageText,
        },
      },
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '任务回写失败。',
    };
  }
}

export async function listTaskRuns(taskId: string): Promise<TaskRunRecord[]> {
  try {
    const full = await requestJson<{ runs?: unknown[] }>(
      `/api/compose/tasks/${encodeURIComponent(taskId)}/full`,
    );
    return Array.isArray(full?.runs)
      ? full.runs.map((item) => mapManagedTaskRun(item)).filter((item): item is TaskRunRecord => item != null)
      : [];
  } catch {
    return [];
  }
}

export async function getTaskDetail(taskId: string): Promise<Task | undefined> {
  try {
    const full = await requestJson<{ task?: unknown }>(
      `/api/compose/tasks/${encodeURIComponent(taskId)}/full`,
    );
    return mapManagedTaskDetail(full?.task) || undefined;
  } catch {
    return undefined;
  }
}

export async function listPendingTaskReportDeliveries(input: {
  chatSessionId?: string;
}): Promise<TaskReportDelivery[]> {
  const params = new URLSearchParams();
  const chatSessionId = trimToUndefined(input.chatSessionId);
  params.set('target_kind', 'chat_message');
  if (chatSessionId) params.set('origin_chat_session_id', chatSessionId);
  const suffix = params.toString();
  const result = await requestJson<unknown>(
    `/api/management/tasks/deliveries/pending${suffix ? `?${suffix}` : ''}`,
    {
      timeoutMs: TASK_DELIVERY_TIMEOUT_MS,
    },
  );
  return unwrapTaskDeliveryRows(result)
    .map((item) => mapTaskDelivery(item))
    .filter((item): item is TaskReportDelivery => item != null);
}

export async function updateTaskReportDeliveryStatus(
  deliveryId: string,
  status: 'pending' | 'reported' | 'acknowledged' | 'failed',
): Promise<TaskReportDelivery | null> {
  const id = deliveryId.trim();
  if (!id) return null;
  const result = await requestJson<unknown>(
    `/api/management/tasks/deliveries/${encodeURIComponent(id)}/status`,
    {
      method: 'POST',
      body: { status },
      timeoutMs: TASK_DELIVERY_TIMEOUT_MS,
    },
  );
  return mapTaskDelivery(unwrapTaskDeliveryItem(result));
}

export function hasTaskFinalSummaryDelivered(taskId: string, runCount: number): boolean {
  const meta = getTaskMeta(taskId);
  if (!meta) return false;
  const delivered = meta.completionNotifiedRunCount ?? 0;
  return delivered >= runCount && runCount > 0;
}

export function markTaskFinalSummaryDelivered(taskId: string, runCount: number): void {
  upsertTaskMeta(taskId, {
    completionNotifiedRunCount: Math.max(0, Math.floor(runCount)),
  });
}

export function storeTaskFinalSummary(taskId: string, runCount: number, content: string): void {
  const safeRunCount = Math.max(0, Math.floor(runCount));
  const text = (content || '').trim();
  upsertTaskMeta(taskId, {
    finalSummary: {
      runCount: safeRunCount,
      content: text,
      createdAt: nowIso(),
    },
  });
}

export function getTaskFinalSummary(taskId: string): { runCount: number; content: string; createdAt: string } | null {
  const task = taskSnapshotCache.get(taskId);
  const summary = task?.finalSummary;
  if (!summary?.content?.trim()) return null;
  return {
    runCount: summary.runCount,
    content: summary.content,
    createdAt: summary.createdAt || nowIso(),
  };
}
