import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { resolveTaskLifecycle, taskLifecycleLabel, type TaskLifecycleState } from '@/lib/task-lifecycle';
import type { Task, TaskRunRecord } from '@/types/tasks';
import type { TaskDetailsTask } from '@/components/tasks/TaskDetailsDialog';
import { TaskDetailsPanel } from '@/components/tasks/TaskDetailsDialog';
import { pushInAppNotice } from '@/services/in-app-notifier';
import { getManagementAgentDetail } from '@/services/management-client';
import {
  canDeleteTask,
  deleteTask,
  getTaskDetail,
  getTaskFinalSummary,
  listTaskRuns,
  listTasks,
  pauseTask,
} from '@/services/task-client';
import { AlertCircle, CheckCircle2, RefreshCcw, Search, Square, Trash2 } from 'lucide-react';

const POLL_INTERVAL_MS = 10_000;

function lifecycleState(task: Task, runsCount?: number): TaskLifecycleState {
  const runCount = Math.max(
    Number.isFinite(task.runInfo.runCount) ? task.runInfo.runCount : 0,
    typeof runsCount === 'number' ? runsCount : 0,
  );
  return resolveTaskLifecycle({
    enabled: task.enabled,
    runtimeState: task.runtimeState,
    maxRuns: task.maxRuns,
    runInfo: {
      lastStatus: task.runInfo.lastStatus,
      runCount,
    },
  });
}

function lifecycleBadgeClass(state: TaskLifecycleState): string {
  if (state === 'running') return 'bg-primary text-primary-foreground';
  if (state === 'success') return 'bg-success text-white';
  if (state === 'failed') return 'bg-destructive text-white';
  return 'bg-muted text-foreground';
}

function displayTaskTitle(task: Task): string {
  const raw = (task.name || '').trim();
  return raw || task.id;
}

export function AgentTaskManagerPage() {
  const { t } = useTranslation();
  const { id } = useParams();

  const agentId = (id || '').trim();
  const [agentName, setAgentName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [keyword, setKeyword] = useState('');
  const keywordNormalized = keyword.trim().toLowerCase();

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedRuns, setSelectedRuns] = useState<TaskRunRecord[]>([]);
  const [selectedFinalSummary, setSelectedFinalSummary] = useState<{ runCount: number; content: string; createdAt: string } | null>(null);

  const pollTokenRef = useRef(0);

  const refreshTasks = useCallback(async (options?: { silent?: boolean }) => {
    if (!agentId) return;
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const rows = (await listTasks(agentId)).filter((task) => task.sourceType === 'chat');
      setTasks(rows);
      setSelectedTaskId((prev) => {
        if (prev && rows.some((task) => task.id === prev)) {
          return prev;
        }
        return rows[0]?.id || null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushInAppNotice({
        title: '任务加载失败',
        message,
        level: 'error',
      });
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [agentId, selectedTaskId]);

  const refreshSelectedTask = useCallback(async (taskId: string, options?: { silent?: boolean }) => {
    const normalized = (taskId || '').trim();
    if (!normalized || !agentId) return;
    const token = pollTokenRef.current + 1;
    pollTokenRef.current = token;
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [detail, runs] = await Promise.all([
        getTaskDetail(normalized),
        listTaskRuns(normalized),
      ]);
      if (pollTokenRef.current !== token) return;
      if (detail?.sourceType === 'chat') {
        setSelectedTask(detail);
      } else {
        setSelectedTask(null);
      }
      setSelectedRuns(runs);
      setSelectedFinalSummary(getTaskFinalSummary(normalized));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushInAppNotice({
        title: '任务详情加载失败',
        message,
        level: 'error',
      });
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [agentId]);

  const refreshAll = useCallback(async () => {
    await refreshTasks({ silent: true });
    if (selectedTaskId) {
      await refreshSelectedTask(selectedTaskId, { silent: true });
    }
  }, [refreshSelectedTask, refreshTasks, selectedTaskId]);

  useEffect(() => {
    let cancelled = false;
    if (!agentId) {
      setTasks([]);
      setSelectedTaskId(null);
      setSelectedTask(null);
      setSelectedRuns([]);
      setSelectedFinalSummary(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const detail = await getManagementAgentDetail(agentId);
        if (!cancelled) {
          setAgentName(detail.nickname?.trim() || detail.name || agentId);
        }
      } catch {
        if (!cancelled) setAgentName(agentId);
      }
      await refreshTasks({ silent: true });
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, refreshTasks]);

  useEffect(() => {
    if (!agentId) return;
    const timer = window.setInterval(() => {
      void refreshTasks({ silent: true });
      if (selectedTaskId) {
        void refreshSelectedTask(selectedTaskId, { silent: true });
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [agentId, refreshSelectedTask, refreshTasks, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTask(null);
      setSelectedRuns([]);
      setSelectedFinalSummary(null);
      return;
    }
    void refreshSelectedTask(selectedTaskId);
  }, [refreshSelectedTask, selectedTaskId]);

  const filteredTasks = useMemo(() => {
    const rows = tasks.slice();
    const sorted = rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    if (!keywordNormalized) return sorted;
    return sorted.filter((task) => {
      const hay = `${task.id} ${task.name} ${task.prompt || ''}`.toLowerCase();
      return hay.includes(keywordNormalized);
    });
  }, [keywordNormalized, tasks]);

  const groupedTasks = useMemo(() => {
    const running: Task[] = [];
    const completed: Task[] = [];
    for (const task of filteredTasks) {
      const state = lifecycleState(task);
      if (state === 'running') {
        running.push(task);
      } else {
        completed.push(task);
      }
    }
    return { running, completed };
  }, [filteredTasks]);

  const handleStopTask = useCallback(async (taskId: string) => {
    const normalized = (taskId || '').trim();
    if (!normalized || busyTaskId) return;
    setBusyTaskId(normalized);
    try {
      const result = await pauseTask(normalized);
      if (!result.success) {
        pushInAppNotice({
          title: '停止失败',
          message: result.message || '无法停止任务',
          level: 'error',
        });
        return;
      }
      pushInAppNotice({
        title: '已停止',
        message: '任务已停止执行。',
        level: 'success',
      });
      await refreshTasks({ silent: true });
      if (selectedTaskId === normalized) {
        await refreshSelectedTask(normalized, { silent: true });
      }
    } finally {
      setBusyTaskId(null);
    }
  }, [busyTaskId, refreshSelectedTask, refreshTasks, selectedTaskId]);

  const handleDeleteTask = useCallback(async (task: Task) => {
    const normalized = (task?.id || '').trim();
    if (!normalized || busyTaskId) return;
    setBusyTaskId(normalized);
    try {
      const result = await deleteTask(normalized);
      if (!result.success) {
        pushInAppNotice({
          title: '删除失败',
          message: result.message || '无法删除任务',
          level: 'error',
        });
        return;
      }
      pushInAppNotice({
        title: '已删除',
        message: '任务已删除。',
        level: 'success',
      });
      setSelectedTaskId((prev) => (prev === normalized ? null : prev));
      await refreshTasks({ silent: true });
    } finally {
      setBusyTaskId(null);
    }
  }, [busyTaskId, refreshTasks]);

  const detailsTask: TaskDetailsTask | null = useMemo(() => {
    if (!selectedTask) return null;
    return {
      id: selectedTask.id,
      name: selectedTask.name,
      jobType: selectedTask.jobType,
      enabled: selectedTask.enabled,
      agentId: selectedTask.teamId,
      teamId: selectedTask.teamId,
      agentName: agentName || selectedTask.teamId,
      createdAt: selectedTask.createdAt,
      maxRuns: selectedTask.maxRuns,
      runInfo: {
        lastStatus: selectedTask.runInfo.lastStatus,
        runCount: selectedTask.runInfo.runCount,
      },
    };
  }, [agentName, selectedTask]);

  const renderTaskRow = (task: Task) => {
    const selected = task.id === selectedTaskId;
    const state = lifecycleState(task);
    const deletable = canDeleteTask(task);
    const stopDisabled = busyTaskId === task.id || state !== 'running';
    const deleteDisabled = busyTaskId === task.id || !deletable;
    return (
      <div
        key={task.id}
        className={cn(
          'group flex items-start justify-between gap-2 rounded-xl border border-border/60 bg-background/70 px-3 py-2.5 transition-all',
          selected ? 'border-primary/40 bg-primary/5 shadow-sm' : 'hover:border-primary/25 hover:bg-background',
        )}
      >
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setSelectedTaskId(task.id)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-semibold">{displayTaskTitle(task)}</span>
            <Badge className={cn('rounded-full text-[10px] px-2', lifecycleBadgeClass(state))}>
              {taskLifecycleLabel(state)}
            </Badge>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground truncate">
            {task.maxRuns && task.maxRuns > 0 ? `${task.runInfo.runCount}/${task.maxRuns}` : `${task.runInfo.runCount} 次`}
            {task.runInfo.nextRun ? ` · 下次：${new Date(task.runInfo.nextRun).toLocaleString()}` : ''}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8 rounded-lg"
            title="停止"
            disabled={stopDisabled}
            onClick={() => void handleStopTask(task.id)}
          >
            <Square className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8 rounded-lg"
            title={deletable ? '删除' : '不可删除（任务执行中时请先停止）'}
            disabled={deleteDisabled}
            onClick={() => void handleDeleteTask(task)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-56px)] min-h-0">
      <div className="mx-auto flex h-full max-w-6xl flex-col px-4 py-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-black tracking-tight">任务管理</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {(() => {
                const displayName = agentName || agentId || '-';
                const showId = Boolean(agentId) && displayName !== agentId;
                return (
                  <>
                    智能体：{displayName}
                    {showId ? (
                <span className="ml-2 font-mono text-[12px] text-muted-foreground/70">{agentId}</span>
                    ) : null}
                  </>
                );
              })()}
              <span className="ml-2 text-[12px] text-muted-foreground/70">自动刷新 {Math.round(POLL_INTERVAL_MS / 1000)}s</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              disabled={!agentId || loading}
              onClick={() => void refreshAll()}
              title="刷新"
            >
              <RefreshCcw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
              刷新
            </Button>
          </div>
        </div>

        <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[360px_1fr]">
          <div className="min-h-0 rounded-2xl border border-border/60 bg-muted/10 p-3">
            <div className="mb-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={t('tasks.search.placeholder', { defaultValue: '搜索任务...' })}
                  className="pl-8"
                />
              </div>
              <Badge variant="outline" className="rounded-full font-mono text-[10px]">
                {filteredTasks.length}
              </Badge>
            </div>

            <ScrollArea className="h-[calc(100%-44px)] pr-2">
              <div className="space-y-3">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                      <AlertCircle className="h-4 w-4 text-primary" />
                      运行中
                    </div>
                    <Badge variant="secondary" className="rounded-full text-[10px]">{groupedTasks.running.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {groupedTasks.running.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-3 text-xs text-muted-foreground">
                        暂无运行中的任务
                      </div>
                    ) : groupedTasks.running.map(renderTaskRow)}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      运行完成
                    </div>
                    <Badge variant="secondary" className="rounded-full text-[10px]">{groupedTasks.completed.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {groupedTasks.completed.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 bg-background/50 px-3 py-3 text-xs text-muted-foreground">
                        暂无已完成任务
                      </div>
                    ) : groupedTasks.completed.map(renderTaskRow)}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>

          <div className="min-h-0 rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
            {!selectedTask ? (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                {loading ? '加载中...' : '请选择左侧任务查看详情'}
              </div>
            ) : (
              <TaskDetailsPanel
                task={detailsTask}
                runs={selectedRuns}
                finalSummary={selectedFinalSummary}
                chatTaskCard={null}
                sourceMessageId={null}
                showHeader={false}
                className="h-full"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
