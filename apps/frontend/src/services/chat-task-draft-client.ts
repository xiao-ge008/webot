import { requestJson } from '@/services/transport';
import type { ChatTaskCardData, ChatTaskLifecycleItem } from '@/types/chat-task';

const CHAT_TASK_DRAFT_ANALYZE_TIMEOUT_MS = 5000;

export type ChatTaskDraftMissingSlot = 'objective' | 'check_frequency' | 'report_condition';

export interface ChatTaskDraftStatePayload {
  objective?: string;
  reportCondition?: string;
  everyMs?: number;
  maxRuns?: number;
  durationMs?: number;
  scheduleText?: string;
  sourceMessageText?: string;
  createdAt?: string;
  missingSlots?: ChatTaskDraftMissingSlot[];
  readyToConfirm?: boolean;
}

export interface AnalyzeChatTaskDraftInput {
  agentId: string;
  message: string;
  currentDraft?: ChatTaskDraftStatePayload | null;
}

export interface AnalyzeChatTaskDraftResult {
  matched: boolean;
  cancelled: boolean;
  readyToConfirm: boolean;
  draft?: ChatTaskDraftStatePayload;
  promptText?: string;
  taskName?: string;
  scheduleText?: string;
  executionPrompt?: string;
  taskCard?: ChatTaskCardData;
}

interface AnalyzeChatTaskDraftResponse {
  matched?: unknown;
  cancelled?: unknown;
  ready_to_confirm?: unknown;
  draft?: Record<string, unknown>;
  prompt_text?: unknown;
  task_name?: unknown;
  schedule_text?: unknown;
  execution_prompt?: unknown;
  task_card?: Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asTimeline(value: unknown): ChatTaskLifecycleItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rows = value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item != null)
    .map((item) => {
      const kind = asString(item.kind);
      const at = asString(item.at);
      const title = asString(item.title);
      if (!kind || !at || !title) {
        return null;
      }
      return {
        id: asString(item.id) || `${kind}-${at}`,
        kind: (
          kind === 'created'
          || kind === 'started'
          || kind === 'progress'
          || kind === 'anomaly'
          || kind === 'final'
          || kind === 'failed'
          || kind === 'cancelled'
        ) ? kind : 'progress',
        title,
        detail: asString(item.detail),
        at,
        runCount: asNumber(item.run_count ?? item.runCount),
        level: (() => {
          const level = asString(item.level);
          return level === 'info' || level === 'success' || level === 'error' ? level : undefined;
        })(),
      } satisfies ChatTaskLifecycleItem;
    })
    .filter((item): item is ChatTaskLifecycleItem => item != null);
  return rows.length > 0 ? rows : undefined;
}

export function normalizeChatTaskDraftTaskCard(value: unknown): ChatTaskCardData | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const card = value as Record<string, unknown>;
  const taskName = asString(card.task_name ?? card.taskName);
  const objective = asString(card.objective);
  const scheduleText = asString(card.schedule_text ?? card.scheduleText);
  const executionPrompt = asString(card.execution_prompt ?? card.executionPrompt);
  const sourceMessageText = asString(card.source_message_text ?? card.sourceMessageText);
  const stage = asString(card.stage);
  const createdAt = asString(card.created_at ?? card.createdAt);
  const updatedAt = asString(card.updated_at ?? card.updatedAt);
  if (!taskName || !objective || !scheduleText || !executionPrompt || !sourceMessageText || !stage || !createdAt || !updatedAt) {
    return undefined;
  }
  const lastStatus = asString(card.last_status ?? card.lastStatus);
  const reportStatus = asString(card.report_status ?? card.reportStatus);
  const taskKind = asString(card.task_kind ?? card.taskKind);
  return {
    taskName,
    objective,
    reportCondition: asString(card.report_condition ?? card.reportCondition),
    scheduleText,
    everyMs: asNumber(card.every_ms ?? card.everyMs) ?? 0,
    maxRuns: asNumber(card.max_runs ?? card.maxRuns) ?? 0,
    runCount: asNumber(card.run_count ?? card.runCount) ?? 0,
    logCount: asNumber(card.log_count ?? card.logCount),
    errorCount: asNumber(card.error_count ?? card.errorCount),
    finalSummaryReady: asBoolean(card.final_summary_ready ?? card.finalSummaryReady),
    executionPrompt,
    sourceMessageText,
    stage: (
      stage === 'proposal'
      || stage === 'scheduled'
      || stage === 'running'
      || stage === 'completed'
      || stage === 'cancelled'
      || stage === 'failed'
    ) ? stage : 'proposal',
    createdAt,
    updatedAt,
    taskId: asString(card.task_id ?? card.taskId),
    agentId: asString(card.agent_id ?? card.agentId),
    nextRun: asString(card.next_run ?? card.nextRun),
    lastRun: asString(card.last_run ?? card.lastRun),
    lastStatus: (
      lastStatus === 'idle'
      || lastStatus === 'running'
      || lastStatus === 'ok'
      || lastStatus === 'error'
      || lastStatus === 'cancelled'
    ) ? lastStatus : undefined,
    canCreate: asBoolean(card.can_create ?? card.canCreate),
    canCancel: asBoolean(card.can_cancel ?? card.canCancel),
    canDelete: asBoolean(card.can_delete ?? card.canDelete),
    notifyOnComplete: asBoolean(card.notify_on_complete ?? card.notifyOnComplete),
    completedNotified: asBoolean(card.completed_notified ?? card.completedNotified),
    taskKind: (
      taskKind === 'chat_async'
      || taskKind === 'chat_schedule'
      || taskKind === 'manual_schedule'
      || taskKind === 'a2a_delegate'
    ) ? taskKind : undefined,
    creatorParticipantName: asString(card.creator_participant_name ?? card.creatorParticipantName),
    executorAgentName: asString(card.executor_agent_name ?? card.executorAgentName),
    reportActorName: asString(card.report_actor_name ?? card.reportActorName),
    reportStatus: reportStatus === 'pending' || reportStatus === 'acknowledged' ? reportStatus : undefined,
    progressPercent: asNumber(card.progress_percent ?? card.progressPercent),
    errorSummary: asString(card.error_summary ?? card.errorSummary),
    finalSummaryText: asString(card.final_summary_text ?? card.finalSummaryText),
    latestReportAt: asString(card.latest_report_at ?? card.latestReportAt),
    latestReportKind: (() => {
      const value = asString(card.latest_report_kind ?? card.latestReportKind);
      return value === 'progress' || value === 'anomaly' || value === 'final' || value === 'failed' || value === 'started'
        ? value
        : undefined;
    })(),
    bindingSessionId: asString(card.binding_session_id ?? card.bindingSessionId),
    bindingSourceMessageId: asString(card.binding_source_message_id ?? card.bindingSourceMessageId),
    timeline: asTimeline(card.timeline),
  };
}

export function normalizeChatTaskDraftState(value: unknown): ChatTaskDraftStatePayload | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const draft = value as Record<string, unknown>;
  const missingSlots = Array.isArray(draft.missing_slots)
    ? draft.missing_slots
      .filter((item): item is ChatTaskDraftMissingSlot => (
        item === 'objective' || item === 'check_frequency' || item === 'report_condition'
      ))
    : undefined;
  return {
    objective: asString(draft.objective),
    reportCondition: asString(draft.report_condition),
    everyMs: asNumber(draft.every_ms),
    maxRuns: asNumber(draft.max_runs),
    durationMs: asNumber(draft.duration_ms),
    scheduleText: asString(draft.schedule_text),
    sourceMessageText: asString(draft.source_message_text),
    createdAt: asString(draft.created_at),
    missingSlots,
    readyToConfirm: typeof draft.ready_to_confirm === 'boolean' ? draft.ready_to_confirm : undefined,
  };
}

export async function analyzeChatTaskDraft(input: AnalyzeChatTaskDraftInput): Promise<AnalyzeChatTaskDraftResult> {
  const agentId = input.agentId.trim();
  if (!agentId) {
    return {
      matched: false,
      cancelled: false,
      readyToConfirm: false,
    };
  }
  const payload = await requestJson<AnalyzeChatTaskDraftResponse>(
    `/api/chat/${encodeURIComponent(agentId)}/task-draft`,
    {
      method: 'POST',
      timeoutMs: CHAT_TASK_DRAFT_ANALYZE_TIMEOUT_MS,
      body: {
        message: input.message,
        current_draft: input.currentDraft ? {
          objective: input.currentDraft.objective,
          report_condition: input.currentDraft.reportCondition,
          every_ms: input.currentDraft.everyMs,
          max_runs: input.currentDraft.maxRuns,
          duration_ms: input.currentDraft.durationMs,
          schedule_text: input.currentDraft.scheduleText,
          source_message_text: input.currentDraft.sourceMessageText,
          created_at: input.currentDraft.createdAt,
          missing_slots: input.currentDraft.missingSlots,
          ready_to_confirm: input.currentDraft.readyToConfirm,
        } : undefined,
      },
    },
  );

  return {
    matched: payload.matched === true,
    cancelled: payload.cancelled === true,
    readyToConfirm: payload.ready_to_confirm === true,
    draft: normalizeChatTaskDraftState(payload.draft),
    promptText: asString(payload.prompt_text),
    taskName: asString(payload.task_name),
    scheduleText: asString(payload.schedule_text),
    executionPrompt: asString(payload.execution_prompt),
    taskCard: normalizeChatTaskDraftTaskCard(payload.task_card),
  };
}
