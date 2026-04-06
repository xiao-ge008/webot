export type TaskLifecycleState = 'pending' | 'running' | 'success' | 'failed';

type RunStatusLike = 'ok' | 'error' | 'running' | 'idle';

export interface TaskLifecycleInput {
  enabled?: boolean;
  runtimeState?: string;
  maxRuns?: number;
  runInfo?: {
    lastStatus?: string;
    runCount?: number;
  };
}

function normalizeRunStatus(status?: string): RunStatusLike {
  const raw = (status || '').trim().toLowerCase();
  if (['ok', 'success', 'done', 'completed'].includes(raw)) return 'ok';
  if (['error', 'failed', 'fail'].includes(raw)) return 'error';
  if (['running', 'processing', 'in_progress'].includes(raw)) return 'running';
  return 'idle';
}

export function resolveTaskLifecycle(task: TaskLifecycleInput): TaskLifecycleState {
  const hasLimit = Boolean(task.maxRuns && task.maxRuns > 0);
  const runCount = Math.max(0, Number(task.runInfo?.runCount || 0));
  const lastStatus = normalizeRunStatus(task.runInfo?.lastStatus);
  const runtimeState = (task.runtimeState || '').trim().toLowerCase();

  if (runtimeState === 'completed') {
    return lastStatus === 'error' ? 'failed' : 'success';
  }
  if (runtimeState === 'failed') {
    return 'failed';
  }
  if (runtimeState === 'paused' || runtimeState === 'disabled' || runtimeState === 'draft') {
    return 'pending';
  }
  if (runtimeState === 'scheduled' || runtimeState === 'running') {
    return 'running';
  }

  if (hasLimit) {
    const reachedFinal = runCount >= (task.maxRuns || 0);
    if (reachedFinal) {
      return lastStatus === 'error' ? 'failed' : 'success';
    }
  }

  if (task.enabled || lastStatus === 'running') {
    return 'running';
  }
  return 'pending';
}

export function taskLifecycleLabel(state: TaskLifecycleState): string {
  if (state === 'running') return '执行中';
  if (state === 'success') return '执行成功';
  if (state === 'failed') return '执行失败';
  return '待执行';
}
