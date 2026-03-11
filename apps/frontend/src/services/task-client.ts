import type { AgentTask, AgentTaskLogItem, AgentTaskProgressResult } from '@/main/types';
import { requestJson } from '@/services/transport';
import {
  createAgentTask,
  deleteAgentTask,
  getAgentSession,
  getAgentTaskProgress,
  listAgentTasks,
  listAgents,
  type AgentSessionMessage,
} from '@/services/agent-client';
import type { Task, TaskRunRecord } from '@/types/tasks';

const TASK_CLIENT_AGENT_ID_KEY = 'webot-task-center-agent-id';
const TASK_LOCAL_META_KEY = 'webot-task-local-meta-v1';

const taskAgentIndex = new Map<string, string>();

interface TaskLocalMeta {
  taskId: string;
  agentId: string;
  runtimeKey?: string; // chatRuntimeStore 的 key（群聊等场景不等于 agentId）
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
  if (/黄金|金价|xau|xauusd|gold/i.test(raw)) {
    return '监控黄金价格';
  }
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
  if (/黄金|金价|xau|xauusd|gold/i.test(candidate)) {
    return '监控黄金价格';
  }
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
    runtimeKey: patch.runtimeKey ?? existing?.runtimeKey,
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

function isHttp404Message(message?: string): boolean {
  return /HTTP\s*404/i.test((message || '').trim());
}

function mapAgentTaskToTask(
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

function mapLogsToRuns(taskId: string, logs: readonly AgentTaskLogItem[]): TaskRunRecord[] {
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

function backfillMissingSummaryLogs(logs: readonly TaskLocalRunLog[]): TaskLocalRunLog[] {
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

async function enrichLogsFromAgentSession(
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

function mergeTaskLogs(
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

function toAgentTaskLogs(localLogs?: readonly TaskLocalRunLog[]): AgentTaskLogItem[] {
  return (localLogs || []).map((item) => ({
    eventId: item.eventId,
    createdAt: item.createdAt,
    kind: item.kind,
    message: item.message,
  }));
}

function calculateRunCount(
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

export function bindTaskChatMeta(
  taskId: string,
  patch: {
    agentId?: string;
    runtimeKey?: string;
    sourceRef?: string;
    maxRuns?: number;
    sourceType?: Task['sourceType'];
  },
): void {
  const id = taskId.trim();
  if (!id) return;
  const safeMaxRuns = typeof patch.maxRuns === 'number' && Number.isFinite(patch.maxRuns) && patch.maxRuns > 0
    ? Math.min(1000, Math.floor(patch.maxRuns))
    : undefined;
  upsertTaskMeta(id, {
    agentId: patch.agentId,
    runtimeKey: patch.runtimeKey,
    sourceRef: patch.sourceRef,
    maxRuns: safeMaxRuns,
    sourceType: patch.sourceType,
  });
}

export function resolveTaskChatRuntimeKey(taskId: string, fallbackKey: string): string {
  const meta = getTaskMeta(taskId.trim());
  const key = (meta?.runtimeKey || '').trim();
  return key || fallbackKey.trim();
}

export function hasTaskEverStarted(task: Task): boolean {
  return Boolean(task.runInfo.lastRun) || task.runInfo.runCount > 0;
}

export function canDeleteTask(task: Task): boolean {
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
  const attempts: Array<{
    path: string;
    method: 'PATCH' | 'PUT' | 'POST';
    body: Record<string, unknown>;
  }> = [
      { path: `/api/management/cron/jobs/${encoded}`, method: 'PATCH', body: { enabled } },
      { path: `/api/management/cron/jobs/${encoded}`, method: 'PUT', body: { enabled } },
      { path: `/api/management/cron/jobs/${encoded}`, method: 'PATCH', body: { patch: { enabled } } },
      { path: `/api/management/cron/jobs/${encoded}`, method: 'PUT', body: { patch: { enabled } } },
      { path: `/api/management/cron/jobs/${encoded}/enable`, method: 'PUT', body: { enabled } },
      { path: `/api/management/cron/jobs/${encoded}/enable`, method: 'POST', body: { enabled } },
      { path: `/api/management/cron/jobs/${encoded}/enabled`, method: 'POST', body: { enabled } },
    ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      await requestJson<unknown>(attempt.path, {
        method: attempt.method,
        body: attempt.body,
      });
      return { success: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { success: false, message: lastError || '更新任务状态失败。' };
}

async function applyRunLimitIfNeeded(task: Task): Promise<void> {
  if (!task.id || !task.enabled) return;
  if (!task.maxRuns || task.maxRuns <= 0) return;
  if (task.runInfo.runCount < task.maxRuns) return;
  await updateTask(task.id, { enabled: false, teamId: task.teamId });
}

export async function listTasks(scope: string): Promise<Task[]> {
  const agentIds = await resolveAgentIds(scope);
  if (agentIds.length === 0) {
    return [];
  }

  const buckets = await Promise.all(
    agentIds.map(async (agentId) => {
      const result = await listAgentTasks({ agentId });
      if (!result.success) return [];

      const rows = await Promise.all(
        result.tasks.map(async (task) => {
          const progress = await getAgentTaskProgress({ agentId, taskId: task.id });
          const incomingLogs = progress.success ? progress.logs : [];
          const meta = getTaskMeta(task.id);
          const sourceType = meta?.sourceType || task.sourceType || 'custom';
          const inferredDisplayName = sourceType === 'chat' ? inferChatTaskDisplayName(task.prompt) : undefined;
          const inferredMaxRuns = parseMaxRunsFromPrompt(task.prompt);
          const mergedLogs = mergeTaskLogs(meta?.runLogs, incomingLogs, {
            maxRuns: meta?.maxRuns,
            lastRun: task.lastRun,
            enabled: task.enabled,
          });
          const enrichedLogs = await enrichLogsFromAgentSession(agentId, task, mergedLogs);
          const logs = toAgentTaskLogs(backfillMissingSummaryLogs(enrichedLogs));
          const preview = logs[0]?.message || '';
          const runCount = calculateRunCount(meta, task, logs, progress.success ? progress.runCountHint : undefined);
          const nextMeta = upsertTaskMeta(task.id, {
            agentId,
            sourceType,
            displayName: meta?.displayName || inferredDisplayName,
            manualStartRequired:
              task.lastRun && task.lastRun.trim()
                ? false
                : meta?.manualStartRequired,
            maxRuns: meta?.maxRuns && meta.maxRuns > 0 ? meta.maxRuns : inferredMaxRuns,
            isTemplate: meta?.isTemplate,
            runCountCache: runCount,
            lastRunToken: task.lastRun || meta?.lastRunToken,
            runLogs: enrichedLogs,
          });
          const mapped = mapAgentTaskToTask(task, agentId, nextMeta, runCount, preview);
          return mapped;
        }),
      );
      return rows;
    }),
  );

  const tasks = buckets
    .flat()
    .sort((a, b) => {
      const ta = Date.parse(a.runInfo.nextRun || a.runInfo.lastRun || a.updatedAt);
      const tb = Date.parse(b.runInfo.nextRun || b.runInfo.lastRun || b.updatedAt);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

  await Promise.all(
    tasks.map(async (task) => {
      try {
        await applyRunLimitIfNeeded(task);
      } catch {
        // ignore auto-limit failures
      }
    }),
  );

  return tasks;
}

export async function createTask(
  task: Partial<Task> & { runtimeKey?: string },
): Promise<{ success: boolean; data?: Task; message?: string }> {
  const agentId = task.teamId || (await resolveAgentIds(undefined))[0];
  if (!agentId) {
    return { success: false, message: '没有可用智能体。' };
  }

  const scheduleKind = task.schedule?.kind || 'cron';
  const sourceType: Task['sourceType'] = task.sourceType || 'custom';
  const inputName = task.name || '未命名任务';
  const persistedName = toBackendSafeTaskName(inputName, sourceType);

  const created = await createAgentTask({
    agentId,
    sourceType,
    name: persistedName,
    scheduleKind,
    scheduleExpression: scheduleKind === 'cron' ? task.schedule?.expr : undefined,
    runAt: scheduleKind === 'at' ? task.schedule?.at : undefined,
    everyMs: scheduleKind === 'every' ? task.schedule?.everyMs : undefined,
    timezone: task.schedule?.tz,
    jobType: task.jobType || 'agent',
    prompt: task.prompt,
    command: task.command,
    sessionTarget: task.sessionTarget,
    deliveryMode: task.delivery?.mode === 'announce' ? 'announce' : 'none',
    deliveryChannel: task.delivery?.channel,
    deliveryTarget: task.delivery?.to,
    deliveryBestEffort: task.delivery?.bestEffort,
    enabled: false,
  });

  if (!created.success || !created.task) {
    return {
      success: false,
      message: created.message || '创建任务失败。',
    };
  }

  const localMeta = upsertTaskMeta(created.task.id, {
    agentId,
    runtimeKey: task.runtimeKey,
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
    lastRunToken: created.task.lastRun,
    runLogs: [],
  });
  const mapped = mapAgentTaskToTask(created.task, agentId, localMeta, 0, '');

  // 新建后默认处于“待执行”，必要时补一次禁用调用
  const disableResult = mapped.enabled
    ? await updateTaskEnabledByApi(created.task.id, false)
    : { success: true as const };
  const disabledMapped: Task = { ...mapped, enabled: false };
  return {
    success: true,
    data: disabledMapped,
    message:
      disableResult.success
        ? created.message
        : `任务已创建，但禁用发布接口失败，已按待执行展示：${disableResult.message || '-'}`,
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

  const latest = await listAgentTasks({ agentId });
  if (!latest.success) {
    return { success: true, message: '任务状态已更新。' };
  }
  const hit = latest.tasks.find((item) => item.id === taskId);
  if (!hit) {
    return { success: true, message: '任务状态已更新。' };
  }

  const progress = await getAgentTaskProgress({ agentId, taskId });
  const existingMeta = getTaskMeta(taskId);
  const sourceType = existingMeta?.sourceType || hit.sourceType || 'custom';
  const inferredDisplayName = sourceType === 'chat' ? inferChatTaskDisplayName(hit.prompt) : undefined;
  const inferredMaxRuns = parseMaxRunsFromPrompt(hit.prompt);
  let mergedLogs = mergeTaskLogs(existingMeta?.runLogs, progress.success ? progress.logs : [], {
    maxRuns: existingMeta?.maxRuns,
    lastRun: hit.lastRun,
    enabled: hit.enabled,
  });
  mergedLogs = await enrichLogsFromAgentSession(agentId, hit, mergedLogs);
  const logs = toAgentTaskLogs(backfillMissingSummaryLogs(mergedLogs));
  const meta = upsertTaskMeta(taskId, {
    agentId,
    sourceType,
    displayName: existingMeta?.displayName || inferredDisplayName,
    maxRuns: existingMeta?.maxRuns && existingMeta.maxRuns > 0 ? existingMeta.maxRuns : inferredMaxRuns,
    manualStartRequired:
      typeof updates.enabled === 'boolean' && updates.enabled ? false : getTaskMeta(taskId)?.manualStartRequired,
    runCountCache: calculateRunCount(getTaskMeta(taskId), hit, logs, progress.success ? progress.runCountHint : undefined),
    lastRunToken: hit.lastRun,
    runLogs: mergedLogs,
  });
  const mapped = mapAgentTaskToTask(hit, agentId, meta, meta.runCountCache || 0, logs[0]?.message || '');
  return {
    success: true,
    data: mapped,
  };
}

export async function deleteTask(taskId: string): Promise<{ success: boolean; message?: string }> {
  const detail = await getTaskDetail(taskId);
  if (detail && !canDeleteTask(detail)) {
    return { success: false, message: '任务已运行过，不能删除。' };
  }

  const agentId = await findTaskAgentId(taskId);
  if (!agentId) {
    return { success: false, message: `未找到任务所属智能体：${taskId}` };
  }
  const result = await deleteAgentTask({ agentId, taskId });
  if (result.success) {
    removeTaskMeta(taskId);
  }
  return { success: result.success, message: result.message };
}

export async function runTaskNow(taskId: string): Promise<{ success: boolean; message?: string; activeTaskId?: string }> {
  // “运行”语义改为发布任务（enabled=true）
  const updated = await updateTask(taskId, { enabled: true });
  if (updated.success || !isHttp404Message(updated.message)) {
    return {
      ...updated,
      activeTaskId: updated.success ? (updated.data?.id || taskId) : undefined,
    };
  }

  // 兼容部分后端未暴露启停接口：通过“重建为已发布”回退启动
  const detail = await getTaskDetail(taskId);
  if (!detail) {
    return updated;
  }
  const agentId = detail.teamId || (await findTaskAgentId(taskId));
  if (!agentId) {
    return updated;
  }
  const sourceType: Task['sourceType'] = detail.sourceType || 'custom';
  const persistedName = toBackendSafeTaskName(detail.name, sourceType);

  const scheduleKind = detail.schedule.kind;
  const created = await createAgentTask({
    agentId,
    sourceType,
    name: persistedName,
    scheduleKind,
    scheduleExpression: scheduleKind === 'cron' ? detail.schedule.expr : undefined,
    runAt: scheduleKind === 'at' ? detail.schedule.at : undefined,
    everyMs: scheduleKind === 'every' ? detail.schedule.everyMs : undefined,
    timezone: detail.schedule.tz,
    jobType: detail.jobType || 'agent',
    prompt: detail.prompt,
    command: detail.command,
    sessionTarget: detail.sessionTarget,
    deliveryMode: detail.delivery?.mode === 'announce' ? 'announce' : 'none',
    deliveryChannel: detail.delivery?.channel,
    deliveryTarget: detail.delivery?.to,
    deliveryBestEffort: detail.delivery?.bestEffort,
    enabled: true,
  });

  if (!created.success || !created.task) {
    return {
      success: false,
      message: `${updated.message || '任务状态更新失败。'}；回退启动失败：${created.message || '-'}`,
    };
  }

  const nextMeta = upsertTaskMeta(created.task.id, {
    agentId,
    sourceType,
    displayName: detail.name,
    manualStartRequired: false,
    isTemplate: Boolean(detail.isTemplate),
    sourceRef: detail.sourceRef,
    maxRuns: detail.maxRuns,
    deliveryMode: detail.delivery?.mode,
    deliveryChannel: detail.delivery?.channel,
    deliveryTarget: detail.delivery?.to,
    deliveryBestEffort: detail.delivery?.bestEffort,
    finalSummaryPrompt: detail.delivery?.finalSummaryPrompt,
    notifyOnFinal: detail.delivery?.notifyOnFinal,
    runCountCache: detail.runInfo.runCount,
    lastRunToken: created.task.lastRun,
    runLogs: getTaskMeta(taskId)?.runLogs || [],
  });
  mapAgentTaskToTask(created.task, agentId, nextMeta, nextMeta.runCountCache || 0, '');

  const removed = await deleteTask(taskId);
  if (!removed.success) {
    return {
      success: true,
      activeTaskId: created.task.id,
      message: '任务已通过回退方式发布运行，但旧任务删除失败，请手动清理。',
    };
  }
  return {
    success: true,
    activeTaskId: created.task.id,
    message: '任务已通过回退方式发布运行。',
  };
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

export async function listTaskRuns(taskId: string): Promise<TaskRunRecord[]> {
  const agentId = await findTaskAgentId(taskId);
  if (!agentId) return [];
  const progress: AgentTaskProgressResult = await getAgentTaskProgress({ agentId, taskId });
  const meta = getTaskMeta(taskId);
  let mergedLogs = mergeTaskLogs(meta?.runLogs, progress.success ? progress.logs : [], {
    maxRuns: meta?.maxRuns,
    lastRun: progress.task?.lastRun,
    enabled: progress.task?.enabled,
  });
  if (progress.task) {
    mergedLogs = await enrichLogsFromAgentSession(agentId, progress.task, mergedLogs);
  }
  if (mergedLogs.length > 0) {
    upsertTaskMeta(taskId, { agentId, runLogs: mergedLogs });
  }
  return mapLogsToRuns(taskId, toAgentTaskLogs(backfillMissingSummaryLogs(mergedLogs)));
}

export async function getTaskDetail(taskId: string): Promise<Task | undefined> {
  const agentId = await findTaskAgentId(taskId);
  if (!agentId) return undefined;

  const listed = await listAgentTasks({ agentId });
  if (!listed.success) return undefined;
  const task = listed.tasks.find((item) => item.id === taskId);
  if (!task) return undefined;
  const progress = await getAgentTaskProgress({ agentId, taskId });
  const existingMeta = getTaskMeta(taskId);
  const sourceType = existingMeta?.sourceType || task.sourceType || 'custom';
  const inferredDisplayName = sourceType === 'chat' ? inferChatTaskDisplayName(task.prompt) : undefined;
  const inferredMaxRuns = parseMaxRunsFromPrompt(task.prompt);
  let logsMerged = mergeTaskLogs(existingMeta?.runLogs, progress.success ? progress.logs : [], {
    maxRuns: existingMeta?.maxRuns,
    lastRun: task.lastRun,
    enabled: task.enabled,
  });
  logsMerged = await enrichLogsFromAgentSession(agentId, task, logsMerged);
  const logs = toAgentTaskLogs(backfillMissingSummaryLogs(logsMerged));
  const runCount = calculateRunCount(existingMeta, task, logs, progress.success ? progress.runCountHint : undefined);
  const meta = upsertTaskMeta(taskId, {
    agentId,
    sourceType,
    displayName: existingMeta?.displayName || inferredDisplayName,
    maxRuns: existingMeta?.maxRuns && existingMeta.maxRuns > 0 ? existingMeta.maxRuns : inferredMaxRuns,
    manualStartRequired:
      task.lastRun && task.lastRun.trim()
        ? false
        : existingMeta?.manualStartRequired,
    runCountCache: runCount,
    lastRunToken: task.lastRun || existingMeta?.lastRunToken,
    runLogs: logsMerged,
  });
  return mapAgentTaskToTask(task, agentId, meta, runCount, logs[0]?.message || '');
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
    completionNotifiedRunCount: safeRunCount,
    finalSummary: {
      runCount: safeRunCount,
      content: text,
      createdAt: nowIso(),
    },
  });
}

export function getTaskFinalSummary(taskId: string): { runCount: number; content: string; createdAt: string } | null {
  const meta = getTaskMeta(taskId);
  if (!meta?.finalSummary) return null;
  const safeRunCount = Math.max(0, Math.floor(meta.finalSummary.runCount ?? 0));
  const content = (meta.finalSummary.content || '').trim();
  const createdAt = (meta.finalSummary.createdAt || '').trim();
  if (!content) return null;
  return {
    runCount: safeRunCount,
    content,
    createdAt: createdAt || nowIso(),
  };
}
