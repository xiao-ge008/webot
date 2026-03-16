import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { CHAT_CHANNELS, CHAT_RENDER_MODES } from '@/main/types';
import { sendAgentChat, withChatRenderContext } from '@/services/agent-client';
import { chatRuntimeStore } from '@/services/chat-runtime-store';
import type { StoredChatSession } from '@/services/chat-session-store';
import {
  bindTaskChatMeta,
  createTaskReportDelivery,
  hasTaskFinalSummaryDelivered,
  listTaskRuns,
  listTasks,
  loadTaskRuntimeMeta,
  markTaskFinalSummaryDelivered,
  storeTaskFinalSummary,
} from '@/services/task-client';
import { pushTaskNoticeRouted } from '@/services/task-notice-router';
import type { Task, TaskRunRecord } from '@/types/tasks';

const DEFAULT_FINAL_SUMMARY_PROMPT = '请基于全部执行日志，输出最终总结报告：总体结论、关键变化、异常与建议。';
const POLL_INTERVAL_MS = 5_000;
const SEND_TIMEOUT_MS = 25_000;
const RUN_POLL_FALLBACK_INTERVAL_MS = 12_000;
const MAX_TRACKED_RUNS_PER_TASK = 600;
const MAX_TRACKED_ANOMALIES_PER_TASK = 600;
const MAX_PROGRESS_DELIVERY_ATTEMPTS = 8;
const MAX_FINAL_DELIVERY_ATTEMPTS = 30;

type DispatchPriority = 'high' | 'normal';

interface TaskAnomalyEvent {
  kind: 'anomaly';
  task: Task;
  runs: TaskRunRecord[];
  createdAt: number;
  dedupeKey: string;
  priority: DispatchPriority;
  attempts: number;
}

interface TaskFinalEvent {
  kind: 'final';
  task: Task;
  runCount: number;
  runs: TaskRunRecord[];
  createdAt: number;
  dedupeKey: string;
  priority: DispatchPriority;
  attempts: number;
}

interface TaskProgressEvent {
  kind: 'progress';
  task: Task;
  rows: Array<{ runNo: number; run: TaskRunRecord }>;
  createdAt: number;
  dedupeKey: string;
  priority: DispatchPriority;
  attempts: number;
}

type TaskDispatchEvent = TaskAnomalyEvent | TaskFinalEvent | TaskProgressEvent;

interface TaskDispatchRuntime {
  queue: TaskDispatchEvent[];
  running: boolean;
  initialized: boolean;
  seenRunSignatures: Set<string>;
  seenAnomalyKeys: Set<string>;
  seenDispatchKeys: Set<string>;
  lastRunCount: number;
  lastRunToken: string;
  pendingFinalRunCount?: number;
  lastRunsPollAt: number;
}

interface TaskChatInference {
  sessionId: string;
  messageId: string;
  maxRuns?: number;
}

function isTaskCompletedByLimit(task: Task): boolean {
  if (!task.maxRuns || task.maxRuns <= 0) return false;
  if (task.runInfo.lastStatus === 'running') return false;
  return task.runInfo.runCount >= task.maxRuns;
}

function formatRunsForPrompt(runs: readonly TaskRunRecord[]): string {
  if (runs.length === 0) return '暂无执行日志。';
  const ordered = [...runs].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  return ordered
    .map((run, index) => {
      const time = new Date(run.startTime).toLocaleString();
      const prevOutput = index > 0 ? (ordered[index - 1]?.output || '').trim() : '';
      const deltaHint = prevOutput
        ? `相对上次变化：${(run.output || '').trim() === prevOutput ? '无明显变化' : '有变化'}`
        : '相对上次变化：首轮执行';
      return [
        `第 ${index + 1} 次执行`,
        `时间：${time}`,
        `状态：${run.status}`,
        deltaHint,
        '执行输出：',
        run.output || '-',
      ].join('\n');
    })
    .join('\n\n');
}

function fallbackSummary(task: Task, runs: readonly TaskRunRecord[]): string {
  const latest = runs[0];
  const latestOutput = (latest?.output || '').trim();
  const preview = latestOutput ? `最近一次输出：${latestOutput.slice(0, 80)}` : '无最近输出。';
  return `任务已完成，共执行 ${task.runInfo.runCount} 次。${preview}`;
}

function toEventMeta(prefix: string, taskId: string, token: string): string {
  return `${prefix}:${taskId}:${token}`;
}

function parseTaskSourceRef(sourceRef?: string): { sessionId?: string; messageId?: string } {
  const raw = (sourceRef || '').trim();
  if (!raw) return {};
  const separatorIndex = raw.indexOf('::');
  if (separatorIndex < 0) {
    return { messageId: raw };
  }
  const sessionId = raw.slice(0, separatorIndex).trim();
  const messageId = raw.slice(separatorIndex + 2).trim();
  return {
    sessionId: sessionId || undefined,
    messageId: messageId || undefined,
  };
}

function buildProgressSummary(task: Task, rows: readonly { runNo: number; run: TaskRunRecord }[]): string {
  const latest = rows[rows.length - 1];
  if (!latest) {
    return `任务「${task.name}」产生了新的执行进度。`;
  }
  const output = normalizeRunOutput(latest.run.output).replace(/\s+/g, ' ').trim();
  const preview = output.length > 140 ? `${output.slice(0, 140)}...` : output;
  return [
    `第 ${latest.runNo} 轮执行状态：${latest.run.status}`,
    preview ? `输出摘要：${preview}` : '',
  ].filter(Boolean).join('\n');
}

function simpleHash(raw: string): string {
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeRunOutput(raw?: string): string {
  return (raw || '').replace(/\s+/g, ' ').trim();
}

function runSignature(run: TaskRunRecord): string {
  const text = normalizeRunOutput(run.output).slice(0, 220);
  return `${run.startTime}|${run.status}|${text}`;
}

function keepSetSize(set: Set<string>, maxSize: number): void {
  while (set.size > maxSize) {
    const first = set.values().next();
    if (first.done) return;
    set.delete(first.value);
  }
}

function parseChatSourceRef(sourceRef?: string): { sessionId?: string; messageId?: string } {
  const raw = (sourceRef || '').trim();
  if (!raw) return {};
  const idx = raw.indexOf('::');
  if (idx <= 0) return { messageId: raw };
  const sessionId = raw.slice(0, idx).trim();
  const messageId = raw.slice(idx + 2).trim();
  return {
    sessionId: sessionId || undefined,
    messageId: messageId || undefined,
  };
}

function isChatSourcedTask(task: Task): boolean {
  if (task.sourceType === 'chat') return true;
  const parsedRef = parseChatSourceRef(task.sourceRef);
  if (parsedRef.sessionId || parsedRef.messageId) return true;
  return false;
}

function parseChatAgentIdFromPath(pathname: string): string {
  const raw = (pathname || '').trim();
  if (!raw) return '';
  const chatPrefix = '/chat/';
  if (raw.startsWith(chatPrefix)) {
    const rest = raw.slice(chatPrefix.length);
    return rest.split('/')[0]?.trim() || '';
  }
  return '';
}

function parseRunLimitFromText(raw: string): number | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const patterns: RegExp[] = [
    /总执行(?:次数|轮次)?\s*[：:]\s*(\d+)\s*次/i,
    /总次数\s*[：:]\s*(\d+)\s*次/i,
    /任务执行\s*(\d+)\s*次/i,
    /(?:总共|一共|共|连续)\s*(\d+)\s*次/i,
    /(\d+)\s*次/i,
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

function normalizeLooseText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？；：、“”‘’"'\-_.:,!?;()[\]{}]/g, '');
}

function extractTaskObjectiveHint(task: Task): string {
  const rows = (task.prompt || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('你是任务执行助手'))
    .filter((line) => !line.startsWith('任务总执行次数上限'))
    .filter((line) => !line.startsWith('要求'));
  return rows[0] || '';
}

function computeTaskMessageMatchScore(task: Task, messageText: string): number {
  const text = messageText.trim();
  if (!text) return 0;
  const normalizedText = normalizeLooseText(text);
  let score = 0;

  const taskId = (task.id || '').trim().toLowerCase();
  if (taskId && text.toLowerCase().includes(taskId)) {
    score += 8;
  }

  const taskName = normalizeLooseText(task.name || '');
  if (taskName && taskName.length >= 2 && normalizedText.includes(taskName)) {
    score += 4;
  }
  if (taskName.length >= 6 && normalizedText.includes(taskName.slice(0, 6))) {
    score += 3;
  } else if (taskName.length >= 4 && normalizedText.includes(taskName.slice(0, 4))) {
    score += 2;
  }

  const objectiveHint = normalizeLooseText(extractTaskObjectiveHint(task));
  if (objectiveHint && objectiveHint.length >= 4 && normalizedText.includes(objectiveHint)) {
    score += 3;
  }
  if (objectiveHint.length >= 8 && normalizedText.includes(objectiveHint.slice(0, 8))) {
    score += 2;
  } else if (objectiveHint.length >= 5 && normalizedText.includes(objectiveHint.slice(0, 5))) {
    score += 1;
  }

  const scheduleHint = /(定时任务|执行间隔|总执行次数|总次数|每\d+分钟|每\d+分|每\d+秒|每\d+小时)/i.test(text);
  if (scheduleHint) {
    score += 2;
  }

  const createdHint = /(任务已创建|创建成功|自动执行|后续\d+次)/i.test(text);
  if (createdHint) {
    score += 1;
  }

  return score;
}

function inferTaskFromSessions(task: Task, sessions: readonly StoredChatSession[]): TaskChatInference | null {
  const taskId = (task.id || '').trim().toLowerCase();
  let best: { score: number; sessionId: string; messageId: string; maxRuns?: number } | null = null;
  for (const session of sessions) {
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      const row = session.messages[index];
      const text = (row.text || '').trim();
      if (!text) continue;
      const score = computeTaskMessageMatchScore(task, text);
      if (score < 3) continue;
      const from = Math.max(0, index - 4);
      const to = Math.min(session.messages.length, index + 3);
      let maxRuns: number | undefined;
      for (let idx = from; idx < to; idx += 1) {
        const hint = parseRunLimitFromText(session.messages[idx]?.text || '');
        if (hint && hint > 0) {
          maxRuns = hint;
          break;
        }
      }
      if (
        !best
        || score > best.score
        || (score === best.score && index > 0)
      ) {
        best = {
          score,
          sessionId: session.id,
          messageId: row.id,
          maxRuns,
        };
      }
      if (taskId && text.toLowerCase().includes(taskId)) {
        // 明确命中任务 ID 时可提前返回，避免误匹配。
        return {
          sessionId: session.id,
          messageId: row.id,
          maxRuns,
        };
      }
    }
  }
  if (!best) return null;
  return {
    sessionId: best.sessionId,
    messageId: best.messageId,
    maxRuns: best.maxRuns,
  };
}

function inferTaskFromActiveSessionFallback(
  task: Task,
  sessions: readonly StoredChatSession[],
  activeSessionId: string,
): TaskChatInference | null {
  if (sessions.length === 0) return null;
  const target =
    sessions.find((session) => session.id === activeSessionId)
    || sessions[0];

  let best: { score: number; messageId: string; maxRuns?: number } | null = null;
  for (let index = target.messages.length - 1; index >= 0; index -= 1) {
    const row = target.messages[index];
    const text = (row.text || '').trim();
    if (!text) continue;
    const score = computeTaskMessageMatchScore(task, text);
    if (score < 2) continue;

    const from = Math.max(0, index - 4);
    const to = Math.min(target.messages.length, index + 3);
    let maxRuns: number | undefined;
    for (let idx = from; idx < to; idx += 1) {
      const hint = parseRunLimitFromText(target.messages[idx]?.text || '');
      if (hint && hint > 0) {
        maxRuns = hint;
        break;
      }
    }

    if (!best || score > best.score) {
      best = { score, messageId: row.id, maxRuns };
    }

    // 找到足够强的线索就提前结束，减少误判。
    if (score >= 4) break;
  }

  if (!best) return null;
  return {
    sessionId: target.id,
    messageId: best.messageId,
    maxRuns: best.maxRuns,
  };
}

function isAlertLikeTask(task: Task): boolean {
  const text = `${task.name}\n${task.prompt || ''}`.toLowerCase();
  return /(监控|告警|报警|阈值|高于|低于|超过|跌破|突破|alert|monitor)/i.test(text);
}

function isAnomalyRun(task: Task, run: TaskRunRecord): boolean {
  if (run.status === 'error') return true;
  if (!isAlertLikeTask(task)) return false;
  const output = normalizeRunOutput(run.output).toLowerCase();
  if (!output) return false;
  const hit = /(告警|报警|alert|触发|超过|高于|低于|跌破|突破|阈值)/i.test(output);
  const negation = /(未触发|未超过|未高于|未低于|未跌破|未达到|not triggered|no alert)/i.test(output);
  return hit && !negation;
}

function buildAnomalyText(task: Task, runs: readonly TaskRunRecord[]): string {
  const ordered = [...runs].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const lines = ordered.map((run, index) => {
    const time = new Date(run.startTime).toLocaleString();
    const brief = normalizeRunOutput(run.output).slice(0, 220) || '未返回可读输出';
    return [
      `第 ${index + 1} 条异常`,
      `时间：${time}`,
      `状态：${run.status}`,
      `输出：${brief}`,
    ].join('\n');
  });
  return [
    `任务「${task.name}」检测到异常，已即时通知：`,
    '',
    ...lines,
    '',
    '系统将继续按原计划监控，若后续恢复或再次异常会继续推送。',
  ].join('\n');
}

function buildAnomalyNotice(task: Task, runs: readonly TaskRunRecord[]): string {
  const latest = runs[runs.length - 1];
  const brief = normalizeRunOutput(latest?.output).slice(0, 140) || '未返回可读输出';
  return `任务「${task.name}」异常：${brief}`;
}

function buildNoticePreviewFromText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}

function buildTaskSummarySessionLabel(taskId: string): string {
  const normalized = taskId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `task_summary_${normalized || 'unknown'}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
    return result;
  } catch {
    return fallback;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function buildFinalSummary(task: Task, runs: readonly TaskRunRecord[]): Promise<string> {
  const summaryPrompt = task.delivery.finalSummaryPrompt?.trim() || DEFAULT_FINAL_SUMMARY_PROMPT;
  const userPrompt = [
    '你是任务报告助手，请根据完整执行上下文输出最终总结。',
    `任务名称：${task.name}`,
    `任务ID：${task.id}`,
    `执行次数：${task.runInfo.runCount}${task.maxRuns ? `/${task.maxRuns}` : ''}`,
    `调度信息：${task.schedule.kind === 'every' ? `每 ${Math.max(1, Math.round((task.schedule.everyMs || 60_000) / 60_000))} 分钟` : task.schedule.kind}`,
    `用户总结要求：${summaryPrompt}`,
    '',
    '以下是每次执行的完整上下文：',
    formatRunsForPrompt(runs),
    '',
    '请输出最终总结，至少包含：',
    '1) 每次执行结果概览（第几次、是否成功、关键数据）。',
    '2) 调用链路与数据来源稳定性。',
    '3) 异常与风险。',
    '4) 最终结论与后续建议。',
  ].join('\n');

  const response = await sendAgentChat(withChatRenderContext({
    agentId: task.teamId,
    message: userPrompt,
    history: [],
    stream: false,
    sessionLabel: buildTaskSummarySessionLabel(task.id),
  }, {
    channel: CHAT_CHANNELS.task,
    renderMode: CHAT_RENDER_MODES.plainText,
  }));

  if (!response.success) {
    return fallbackSummary(task, runs);
  }
  const text = (response.content || '').trim();
  return text || fallbackSummary(task, runs);
}

function createRuntime(): TaskDispatchRuntime {
  return {
    queue: [],
    running: false,
    initialized: false,
    seenRunSignatures: new Set<string>(),
    seenAnomalyKeys: new Set<string>(),
    seenDispatchKeys: new Set<string>(),
    lastRunCount: 0,
    lastRunToken: '',
    pendingFinalRunCount: undefined,
    lastRunsPollAt: 0,
  };
}

export function TaskDeliveryWatcher() {
  const pollingRef = useRef(false);
  const runtimesRef = useRef<Map<string, TaskDispatchRuntime>>(new Map());
  const location = useLocation();
  const activeChatAgentId = useMemo(() => parseChatAgentIdFromPath(location.pathname), [location.pathname]);

  useEffect(() => {
    let cancelled = false;

    const getRuntime = (taskId: string): TaskDispatchRuntime => {
      const found = runtimesRef.current.get(taskId);
      if (found) return found;
      const created = createRuntime();
      runtimesRef.current.set(taskId, created);
      return created;
    };

    const enqueue = (taskId: string, event: TaskDispatchEvent) => {
      const runtime = getRuntime(taskId);
      if (runtime.seenDispatchKeys.has(event.dedupeKey)) {
        return;
      }
      if (runtime.queue.some((item) => item.dedupeKey === event.dedupeKey)) {
        return;
      }
      runtime.queue.push(event);
      void drain(taskId);
    };

    const pushTaskNotice = async (
      task: Task,
      input: { title: string; message: string; level: 'info' | 'success' | 'error'; tag: string },
    ) => {
      const text = input.message.trim();
      if (!text) return;
      await pushTaskNoticeRouted(task, {
        title: input.title,
        message: text,
        level: input.level,
        tag: input.tag,
      });
    };

    const allowFallbackToActiveChat = (task: Task): boolean => {
      const agentId = (task.teamId || '').trim();
      return Boolean(agentId) && agentId === activeChatAgentId;
    };

    const deliverAnomaly = async (event: TaskAnomalyEvent) => {
      const meta = await loadTaskRuntimeMeta(event.task.id);
      const latestToken = event.runs.map((run) => run.startTime).join('|');
      const token = simpleHash(`${latestToken}|${event.task.runInfo.runCount}`);
      const anomalyText = buildAnomalyText(event.task, event.runs);
      const noticeMessage = buildNoticePreviewFromText(anomalyText)
        || buildAnomalyNotice(event.task, event.runs);
      await createTaskReportDelivery({
        taskId: event.task.id,
        ownerAgentId: event.task.teamId,
        runtimeKey: meta?.runtimeKey || undefined,
        deliveryKind: 'anomaly',
        dedupeKey: `task-anomaly:${event.task.id}:${token}`,
        originConversationType: meta?.originConversationType,
        originConversationId: meta?.originConversationId,
        originChatSessionId: meta?.originChatSessionId,
        originMessageId: meta?.originMessageId,
        creatorParticipantId: meta?.creatorParticipantId,
        creatorParticipantName: meta?.creatorParticipantName,
        executorAgentId: meta?.executorAgentId || event.task.teamId,
        executorAgentName: meta?.executorAgentName,
        reportActorAgentId: meta?.reportActorAgentId || meta?.executorAgentId || event.task.teamId,
        reportActorAgentName: meta?.reportActorAgentName || meta?.executorAgentName,
        taskName: event.task.name,
        runCount: event.task.runInfo.runCount,
        summaryText: anomalyText,
        errorText: noticeMessage,
        payload: {
          status: 'alert',
          taskName: event.task.name,
          ownerAgentId: event.task.teamId,
          latestRunAt: event.runs[event.runs.length - 1]?.startTime,
          alertText: anomalyText,
        },
      });
      await pushTaskNotice(event.task, {
        title: `任务异常：${event.task.name}`,
        message: noticeMessage,
        level: 'error',
        tag: `task-alert-${event.task.id}-${token}`,
      });
    };

    const deliverProgress = async (event: TaskProgressEvent) => {
      const meta = await loadTaskRuntimeMeta(event.task.id);
      const latest = event.rows[event.rows.length - 1];
      if (!latest) return;
      const summaryText = buildProgressSummary(event.task, event.rows);
      await createTaskReportDelivery({
        taskId: event.task.id,
        ownerAgentId: event.task.teamId,
        runtimeKey: meta?.runtimeKey || undefined,
        deliveryKind: 'progress',
        dedupeKey: event.dedupeKey,
        originConversationType: meta?.originConversationType,
        originConversationId: meta?.originConversationId,
        originChatSessionId: meta?.originChatSessionId,
        originMessageId: meta?.originMessageId,
        creatorParticipantId: meta?.creatorParticipantId,
        creatorParticipantName: meta?.creatorParticipantName,
        executorAgentId: meta?.executorAgentId || event.task.teamId,
        executorAgentName: meta?.executorAgentName,
        reportActorAgentId: meta?.reportActorAgentId || meta?.executorAgentId || event.task.teamId,
        reportActorAgentName: meta?.reportActorAgentName || meta?.executorAgentName,
        taskName: event.task.name,
        runCount: latest.runNo,
        summaryText,
        payload: {
          status: 'running',
          runCount: latest.runNo,
          maxRuns: event.task.maxRuns,
          taskName: event.task.name,
          ownerAgentId: event.task.teamId,
          latestRunAt: latest.run.startTime,
        },
      });
    };

    const deliverFinal = async (runtime: TaskDispatchRuntime, event: TaskFinalEvent) => {
      const meta = await loadTaskRuntimeMeta(event.task.id);
      const summaryFallback = fallbackSummary(event.task, event.runs);
      const summary = await withTimeout(
        buildFinalSummary(event.task, event.runs),
        SEND_TIMEOUT_MS,
        summaryFallback,
      );
      const finalText = summary.trim() || summaryFallback;
      const failed = event.task.runInfo.lastStatus === 'error' || event.runs.some((run) => run.status === 'error');
      storeTaskFinalSummary(event.task.id, event.runCount, finalText);
      await createTaskReportDelivery({
        taskId: event.task.id,
        ownerAgentId: event.task.teamId,
        runtimeKey: meta?.runtimeKey || undefined,
        deliveryKind: 'final',
        dedupeKey: `task-final:${event.task.id}:${event.runCount}`,
        originConversationType: meta?.originConversationType,
        originConversationId: meta?.originConversationId,
        originChatSessionId: meta?.originChatSessionId,
        originMessageId: meta?.originMessageId,
        creatorParticipantId: meta?.creatorParticipantId,
        creatorParticipantName: meta?.creatorParticipantName,
        executorAgentId: meta?.executorAgentId || event.task.teamId,
        executorAgentName: meta?.executorAgentName,
        reportActorAgentId: meta?.reportActorAgentId || meta?.executorAgentId || event.task.teamId,
        reportActorAgentName: meta?.reportActorAgentName || meta?.executorAgentName,
        taskName: event.task.name,
        runCount: event.runCount,
        summaryText: finalText,
        errorText: failed ? finalText : undefined,
        payload: {
          status: failed ? 'failed' : 'succeeded',
          runCount: event.runCount,
          maxRuns: event.task.maxRuns,
          taskName: event.task.name,
          ownerAgentId: event.task.teamId,
        },
      });
      await pushTaskNotice(event.task, {
        title: `任务完成：${event.task.name}`,
        message: finalText,
        level: failed ? 'error' : 'success',
        tag: `task-final-${event.task.id}`,
      });
      markTaskFinalSummaryDelivered(event.task.id, event.runCount);
      if (runtime.pendingFinalRunCount === event.runCount) {
        runtime.pendingFinalRunCount = undefined;
      }
    };

    const drain = async (taskId: string) => {
      const runtime = getRuntime(taskId);
      if (runtime.running) return;
      runtime.running = true;
      try {
        while (!cancelled && runtime.queue.length > 0) {
          let nextIndex = runtime.queue.findIndex((item) => item.priority === 'high');
          if (nextIndex < 0) nextIndex = 0;
          const [event] = runtime.queue.splice(nextIndex, 1);
          if (!event) continue;
          try {
            if (event.kind === 'anomaly') {
              await deliverAnomaly(event);
            } else if (event.kind === 'progress') {
              await deliverProgress(event);
            } else {
              await deliverFinal(runtime, event);
            }
            runtime.seenDispatchKeys.add(event.dedupeKey);
            keepSetSize(runtime.seenDispatchKeys, MAX_TRACKED_ANOMALIES_PER_TASK);
          } catch (error) {
            const nextAttempts = event.attempts + 1;
            if (event.kind === 'final' && runtime.pendingFinalRunCount === event.runCount) {
              runtime.pendingFinalRunCount = undefined;
            }
            const maxAttempts =
              event.kind === 'final'
                ? MAX_FINAL_DELIVERY_ATTEMPTS
                : MAX_PROGRESS_DELIVERY_ATTEMPTS;
            console.warn('[TaskDeliveryWatcher] 任务回执投递失败，准备重试', {
              taskId,
              kind: event.kind,
              attempts: nextAttempts,
              maxAttempts,
              error: error instanceof Error ? error.message : String(error),
            });
            if (nextAttempts < maxAttempts) {
              runtime.queue.push({
                ...event,
                attempts: nextAttempts,
                createdAt: Date.now(),
              });
            }
          }
        }
      } finally {
        runtime.running = false;
      }
    };

    const tick = async () => {
      if (cancelled || pollingRef.current) {
        return;
      }
      pollingRef.current = true;
      try {
        const tasks = await listTasks('all');
        for (const rawTask of tasks) {
          const taskAgentId = (rawTask.teamId || '').trim();
          const agentRuntime = taskAgentId ? chatRuntimeStore.getAgentState(taskAgentId) : null;
          const inferred = agentRuntime
            ? (
              inferTaskFromSessions(rawTask, agentRuntime.sessions)
              || (allowFallbackToActiveChat(rawTask)
                ? inferTaskFromActiveSessionFallback(rawTask, agentRuntime.sessions, agentRuntime.activeSessionId)
                : null)
            )
            : null;
          const task: Task = inferred
            ? {
              ...rawTask,
              sourceType: 'chat',
              sourceRef: rawTask.sourceRef || `${inferred.sessionId}::${inferred.messageId}`,
              maxRuns: rawTask.maxRuns && rawTask.maxRuns > 0 ? rawTask.maxRuns : inferred.maxRuns,
            }
            : rawTask;
          if (inferred) {
            const sourceMeta = parseTaskSourceRef(task.sourceRef);
            bindTaskChatMeta(task.id, {
              agentId: taskAgentId,
              runtimeKey: taskAgentId || undefined,
              sourceType: 'chat',
              sourceRef: task.sourceRef,
              maxRuns: task.maxRuns,
              originConversationType: 'dm',
              originConversationId: taskAgentId || undefined,
              originChatSessionId: sourceMeta.sessionId,
              originMessageId: sourceMeta.messageId,
            });
          }
          const runtime = getRuntime(task.id);
          const runCount = Math.max(0, task.runInfo.runCount);
          const lastRunToken = (task.runInfo.lastRun || '').trim();
          if (!runtime.initialized) {
            runtime.initialized = true;
            runtime.lastRunCount = runCount;
            runtime.lastRunToken = lastRunToken;
            runtime.lastRunsPollAt = Date.now();
          }
          const prevRunCount = runtime.lastRunCount;
          const advancedByCount = runCount > prevRunCount;
          const advancedByToken = Boolean(lastRunToken) && lastRunToken !== runtime.lastRunToken;
          const advanced = advancedByCount || advancedByToken;
          const finalDueFromTask = isTaskCompletedByLimit(task)
            && task.delivery.notifyOnFinal !== false
            && !hasTaskFinalSummaryDelivered(task.id, runCount)
            && runtime.pendingFinalRunCount !== runCount;
          const fallbackPollAllowed = isChatSourcedTask(task) || allowFallbackToActiveChat(task);
          const shouldFallbackPollRuns =
            fallbackPollAllowed
            && task.enabled
            && Boolean(task.maxRuns && task.maxRuns > 0)
            && prevRunCount < (task.maxRuns || 0)
            && !hasTaskFinalSummaryDelivered(task.id, prevRunCount)
            && (Date.now() - runtime.lastRunsPollAt) >= RUN_POLL_FALLBACK_INTERVAL_MS;

          const needRuns = advanced || finalDueFromTask || shouldFallbackPollRuns;
          if (!needRuns) {
            if (runCount < runtime.lastRunCount) {
              runtime.lastRunCount = runCount;
            }
            if (lastRunToken) {
              runtime.lastRunToken = lastRunToken;
            }
            continue;
          }

          if (shouldFallbackPollRuns) {
            runtime.lastRunsPollAt = Date.now();
          }
          const runs = await listTaskRuns(task.id);

          let seenAdvanced = 0;
          let maxProgressRunNo = 0;
          if ((advanced || shouldFallbackPollRuns) && runs.length > 0) {
            const ordered = [...runs].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
            const delta = Math.max(1, runCount - prevRunCount);
            const windowSize = Math.max(8, Math.min(ordered.length, delta + 6));
            const inspectRows = ordered.slice(-windowSize);
            const baseIndex = Math.max(0, ordered.length - inspectRows.length);
            const anomalyRows: TaskRunRecord[] = [];
            const progressRows: Array<{ runNo: number; run: TaskRunRecord }> = [];
            for (let idx = 0; idx < inspectRows.length; idx += 1) {
              const run = inspectRows[idx];
              const signature = run.id ? `id:${run.id}` : runSignature(run);
              if (runtime.seenRunSignatures.has(signature)) continue;
              runtime.seenRunSignatures.add(signature);
              keepSetSize(runtime.seenRunSignatures, MAX_TRACKED_RUNS_PER_TASK);
              seenAdvanced += 1;
              const runNo = Math.max(1, baseIndex + idx + 1);
              maxProgressRunNo = Math.max(maxProgressRunNo, runNo);
              progressRows.push({ runNo, run });
              if (!isAnomalyRun(task, run)) continue;
              const anomalyKey = `${task.id}|${signature}`;
              if (runtime.seenAnomalyKeys.has(anomalyKey)) continue;
              runtime.seenAnomalyKeys.add(anomalyKey);
              keepSetSize(runtime.seenAnomalyKeys, MAX_TRACKED_ANOMALIES_PER_TASK);
              anomalyRows.push(run);
            }
            if (progressRows.length > 0 && (isChatSourcedTask(task) || allowFallbackToActiveChat(task))) {
              const latestProgress = progressRows.slice(-Math.max(1, Math.min(3, progressRows.length)));
              const dedupeToken = latestProgress.map((item) => `${item.runNo}:${item.run.startTime}`).join('|');
              enqueue(task.id, {
                kind: 'progress',
                task,
                rows: latestProgress,
                createdAt: Date.now(),
                dedupeKey: toEventMeta('task-run', task.id, simpleHash(dedupeToken)),
                priority: 'normal',
                attempts: 0,
              });
            }
            if (anomalyRows.length > 0) {
              for (const run of anomalyRows.slice(-3)) {
                const dedupeToken = `${run.startTime}|${run.status}|${normalizeRunOutput(run.output).slice(0, 120)}`;
                enqueue(task.id, {
                  kind: 'anomaly',
                  task,
                  runs: [run],
                  createdAt: Date.now(),
                  dedupeKey: toEventMeta('task-alert', task.id, simpleHash(dedupeToken)),
                  priority: 'high',
                  attempts: 0,
                });
              }
            }
          }

          const explicitRunCount = Math.max(runCount, runs.length, maxProgressRunNo);
          let effectiveRunCount = Math.max(prevRunCount, explicitRunCount);
          if (advancedByToken && effectiveRunCount <= prevRunCount) {
            effectiveRunCount = prevRunCount + 1;
          }
          runtime.lastRunCount = effectiveRunCount;
          if (lastRunToken) {
            runtime.lastRunToken = lastRunToken;
          }

          const finalRunCount = effectiveRunCount;
          const lastStatusStable =
            task.runInfo.lastStatus !== 'running'
            || runs.every((run) => run.status !== 'running');
          const finalDue =
            Boolean(task.maxRuns && task.maxRuns > 0)
            && finalRunCount >= (task.maxRuns || 0)
            && lastStatusStable
            && task.delivery.notifyOnFinal !== false
            && !hasTaskFinalSummaryDelivered(task.id, finalRunCount)
            && runtime.pendingFinalRunCount !== finalRunCount;

          if (finalDue) {
            runtime.pendingFinalRunCount = finalRunCount;
            enqueue(task.id, {
              kind: 'final',
              task,
              runCount: finalRunCount,
              runs,
              createdAt: Date.now(),
              dedupeKey: toEventMeta('task-final', task.id, `${finalRunCount}`),
              priority: 'normal',
              attempts: 0,
            });
          }
        }
      } catch (error) {
        console.warn('[TaskDeliveryWatcher] 轮询任务状态失败', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        pollingRef.current = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
