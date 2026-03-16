import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    Search,
    RefreshCcw,
    Play,
    Trash2,
    AlertCircle,
    Clock,
    CheckCircle2,
    Filter,
    CalendarDays,
    Square
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveTaskLifecycle, taskLifecycleLabel, type TaskLifecycleState } from '@/lib/task-lifecycle';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Task, TaskRunRecord, DeliveryMode } from '@/types/tasks';
import { TaskDetailsDialog } from '@/components/tasks/TaskDetailsDialog';
import type { ManagementAgentSummary } from '@/services/management-client';
import { listManagementAgents } from '@/services/management-client';
import {
    canDeleteTask,
    createTask,
    deleteTask,
    getTaskDetail,
    getTaskFinalSummary,
    listTaskRuns,
    listTasks,
    pauseTask,
    runTaskNow,
    setTaskCenterAgentId,
} from '@/services/task-client';
import { pushInAppNotice } from '@/services/in-app-notifier';
import { parseChatTaskIntent } from '@/services/chat-task-intent';
import { useGlobalAlert } from '@/providers/GlobalAlertProvider';

const TASK_CENTER_AGENT_KEY = 'webot-task-center-agent-id';

/** 顶部统计卡片 */
function StatsCard({ title, value, icon: Icon, colorClass }: { title: string; value: number | string; icon: React.ComponentType<{ className?: string }>; colorClass: string }) {
    return (
        <Card className="border-none bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-all">
            <CardContent className="p-6 flex items-center gap-4">
                <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner", colorClass)}>
                    <Icon className="w-6 h-6" />
                </div>
                <div className="space-y-0.5">
                    <p className="text-sm text-muted-foreground font-medium">{title}</p>
                    <p className="text-2xl font-black tracking-tight">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function lifecycleBadgeLabel(state: TaskLifecycleState): string {
    return taskLifecycleLabel(state);
}

function lifecycleBadgeClass(state: TaskLifecycleState): string {
    if (state === 'running') return 'bg-primary shadow-primary/20';
    if (state === 'success') return 'bg-success shadow-success/20';
    if (state === 'failed') return 'bg-destructive shadow-destructive/20';
    return 'bg-muted shadow-none text-foreground';
}

export function TaskCenterPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { t } = useTranslation();
    const { showConfirm } = useGlobalAlert();
    const [agentOptions, setAgentOptions] = useState<readonly ManagementAgentSummary[]>([]);
    const [selectedAgentId, setSelectedAgentId] = useState('');
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
    const [clearingAll, setClearingAll] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [taskRuns, setTaskRuns] = useState<TaskRunRecord[]>([]);
    const [taskFinalSummary, setTaskFinalSummary] = useState<{ runCount: number; content: string; createdAt: string } | null>(null);
    const [activeSourceTab, setActiveSourceTab] = useState<'custom' | 'templates'>('custom');

    const refreshTasks = useCallback(async (agentId: string, options?: { silent?: boolean }) => {
        if (!agentId) {
            setTasks([]);
            return;
        }
        if (!options?.silent) {
            setLoading(true);
        }
        try {
            setTaskCenterAgentId(agentId);
            const rows = await listTasks(agentId);
            setTasks(rows);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            alert(t('tasks.list.loadFailed', { message }));
        } finally {
            if (!options?.silent) {
                setLoading(false);
            }
        }
    }, [t]);

    const loadAgents = useCallback(async () => {
        const allAgents = await listManagementAgents();
        setAgentOptions(allAgents);
        return allAgents;
    }, []);

    useEffect(() => {
        let cancelled = false;

        const bootstrap = async () => {
            setLoading(true);
            try {
                const agents = await loadAgents();
                if (cancelled) return;

                const requestedAgentId = searchParams.get('agentId') || '';
                const rememberedAgentId =
                    typeof window !== 'undefined' ? (window.localStorage.getItem(TASK_CENTER_AGENT_KEY) || '') : '';
                const fallbackAgentId = agents[0]?.id || '';
                const initialAgentId = [requestedAgentId, rememberedAgentId, fallbackAgentId]
                    .find((agentId) => agentId && agents.some((agent) => agent.id === agentId)) || fallbackAgentId;

                setSelectedAgentId(initialAgentId);
                if (initialAgentId) {
                    await refreshTasks(initialAgentId);
                } else {
                    setTasks([]);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                alert(t('tasks.list.loadFailed', { message }));
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void bootstrap();
        return () => {
            cancelled = true;
        };
    }, [loadAgents, refreshTasks, searchParams, t]);

    useEffect(() => {
        const create = searchParams.get('create');
        const promptParam = searchParams.get('prompt');
        if (create === 'true') {
            // Use setTimeout to avoid synchronous setState during render/effect
            setTimeout(() => {
                setEditingTask(null);
                setInitialPrompt(promptParam || undefined);
                setIsFormOpen(true);

                // Clear params
                const newParams = new URLSearchParams(searchParams);
                newParams.delete('create');
                newParams.delete('prompt');
                setSearchParams(newParams, { replace: true });
            }, 0);
        }
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        if (!selectedAgentId) {
            return;
        }
        const timer = window.setInterval(() => {
            void refreshTasks(selectedAgentId, { silent: true });
        }, 10000);
        return () => {
            window.clearInterval(timer);
        };
    }, [refreshTasks, selectedAgentId]);

    useEffect(() => {
        if (!isDetailsOpen || !selectedTask?.id) {
            return;
        }
        const taskId = selectedTask.id;
        const timer = window.setInterval(() => {
            void Promise.all([
                getTaskDetail(taskId),
                listTaskRuns(taskId),
            ]).then(([detail, runs]) => {
                setSelectedTask((prev) => {
                    if (!prev || prev.id !== taskId) {
                        return prev;
                    }
                    return detail || prev;
                });
                setTaskRuns(runs);
                setTaskFinalSummary(getTaskFinalSummary(taskId));
            }).catch(() => {
                // ignore polling error
            });
        }, 10000);
        return () => {
            window.clearInterval(timer);
        };
    }, [isDetailsOpen, selectedTask?.id]);

    const handleAgentChange = async (agentId: string) => {
        setSelectedAgentId(agentId);
        await refreshTasks(agentId);
    };

    const handleRefresh = async () => {
        try {
            const agents = await loadAgents();
            const activeAgent = selectedAgentId && agents.some((item) => item.id === selectedAgentId)
                ? selectedAgentId
                : agents[0]?.id || '';
            setSelectedAgentId(activeAgent);
            await refreshTasks(activeAgent);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            alert(t('tasks.list.loadFailed', { message }));
        }
    };

    const runTaskAction = useCallback(async (
        taskId: string,
        action: () => Promise<{ success: boolean; message?: string }>,
    ): Promise<boolean> => {
        setBusyTaskId(taskId);
        try {
            const result = await action();
            if (!result.success) {
                alert(t('tasks.list.operationFailed', { message: result.message || '-' }));
                return false;
            }
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            alert(t('tasks.list.operationFailed', { message }));
            return false;
        } finally {
            setBusyTaskId(null);
        }
    }, [t]);

    const handleClearAllTasks = async () => {
        const manualTasks = tasks.filter((task) => task.sourceType !== 'chat');
        if (!selectedAgentId || manualTasks.length === 0) {
            return;
        }

        const confirmed = await showConfirm(t('tasks.list.clearAllConfirm'), {
            title: '确认操作',
            confirmText: '确认',
            cancelText: '取消',
        });
        if (!confirmed) {
            return;
        }

        setClearingAll(true);
        try {
            let success = 0;
            let failed = 0;
            const deletable = manualTasks.filter((task) => canDeleteTask(task));
            for (const task of deletable) {
                const result = await deleteTask(task.id);
                if (result.success) success += 1;
                else failed += 1;
            }
            if (manualTasks.length > deletable.length) {
                failed += manualTasks.length - deletable.length;
            }
            alert(t('tasks.list.clearAllResult', { success, failed }));
            await refreshTasks(selectedAgentId);
        } finally {
            setClearingAll(false);
        }
    };

    const manualTasks = tasks.filter((task) => task.sourceType !== 'chat');

    const filteredTasks = manualTasks.filter(task => {
        const tab = activeSourceTab as string;

        // 分类过滤
        if (tab === 'templates') return !!task.isTemplate;
        if (task.isTemplate && tab !== 'templates') return false; // 模板仅在模板页展示
        if (tab === 'custom' && task.sourceType !== 'custom') return false;

        // 搜索过滤
        if (searchQuery && !task.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;

        return true;
    });

    const lifecycleStats = manualTasks.reduce(
        (acc, task) => {
            const state = resolveTaskLifecycle(task);
            acc[state] += 1;
            return acc;
        },
        { pending: 0, running: 0, success: 0, failed: 0 } as Record<TaskLifecycleState, number>,
    );
    const stats = {
        total: manualTasks.length,
        pending: lifecycleStats.pending,
        running: lifecycleStats.running,
        success: lifecycleStats.success,
        failed: lifecycleStats.failed,
    };

    return (
        <div className="max-w-6xl mx-auto p-8 space-y-8 animate-fade-in pb-20">
            {/* 标题区域 */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-2">
                    <h1 className="text-4xl font-black tracking-tight text-foreground">
                        {t('tasks.title')}
                    </h1>
                    <p className="text-muted-foreground font-medium">
                        {t('tasks.subtitle')}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="w-56">
                        <Select value={selectedAgentId} onValueChange={(value) => { void handleAgentChange(value); }}>
                            <SelectTrigger className="h-10 rounded-full bg-card border-none shadow-sm">
                                <SelectValue placeholder={t('tasks.list.agentSelectPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-none shadow-xl">
                                {agentOptions.length === 0 ? (
                                    <SelectItem value="__empty__" disabled>{t('tasks.list.noAgents')}</SelectItem>
                                ) : (
                                    agentOptions.map((agent) => (
                                        <SelectItem key={agent.id} value={agent.id}>
                                            {agent.name}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full gap-2 font-bold px-5 h-10"
                        onClick={() => { void handleRefresh(); }}
                        disabled={loading}
                    >
                        <RefreshCcw className="w-4 h-4" />
                        {t('settings.refresh')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full gap-2 font-bold px-5 h-10 bg-card text-foreground hover:bg-muted/70 border-border/30"
                        onClick={() => { void handleClearAllTasks(); }}
                        disabled={manualTasks.length === 0 || clearingAll}
                    >
                        <Trash2 className="w-4 h-4" />
                        {t('tasks.list.clearAll')}
                    </Button>
                    <Button size="sm" className="rounded-full gap-2 font-bold px-6 h-10 shadow-lg shadow-primary/20" onClick={() => { setEditingTask(null); setIsFormOpen(true); }}>
                        <Plus className="w-4 h-4" />
                        {t('tasks.form.create')}
                    </Button>
                </div>
            </div>

            {/* 统计卡片 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <StatsCard
                    title={t('tasks.stats.total')}
                    value={stats.total}
                    icon={Clock}
                    colorClass="bg-primary/10 text-primary"
                />
                <StatsCard
                    title="待执行"
                    value={stats.pending}
                    icon={CalendarDays}
                    colorClass="bg-warning/10 text-warning"
                />
                <StatsCard
                    title={t('tasks.stats.running')}
                    value={stats.running}
                    icon={RefreshCcw}
                    colorClass="bg-success/10 text-success"
                />
                <StatsCard
                    title="执行成功"
                    value={stats.success}
                    icon={CheckCircle2}
                    colorClass="bg-success/10 text-success"
                />
                <StatsCard
                    title="执行失败"
                    value={stats.failed}
                    icon={AlertCircle}
                    colorClass="bg-destructive/10 text-destructive"
                />
            </div>

            {/* 分类选项卡 */}
            <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-2xl w-fit self-center md:self-start">
                <Button
                    variant={activeSourceTab === 'custom' ? 'default' : 'ghost'}
                    size="sm"
                    className="rounded-xl px-6 font-bold"
                    onClick={() => setActiveSourceTab('custom')}
                >
                    {t('tasks.tabs.custom')}
                </Button>
                <Button
                    variant={activeSourceTab === 'templates' ? 'default' : 'ghost'}
                    size="sm"
                    className="rounded-xl px-6 font-bold"
                    onClick={() => setActiveSourceTab('templates')}
                >
                    {t('tasks.tabs.templates')}
                </Button>
            </div>

            {/* 搜索与筛选 */}
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1 group">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                        placeholder={t('tasks.list.search')}
                        className="pl-10 h-11 rounded-xl bg-card border-none shadow-sm focus-visible:ring-2 focus-visible:ring-primary/20 transition-all font-medium"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="icon" className="h-11 w-11 rounded-xl bg-card shadow-sm border-none">
                        <Filter className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* 任务列表 */}
            <div className="space-y-4">
                {loading ? (
                    <div className="py-20 text-center text-muted-foreground font-bold animate-pulse">
                        {t('settings.loading')}
                    </div>
                ) : filteredTasks.length === 0 ? (
                    <div className="py-20 text-center space-y-4 bg-card/40 rounded-3xl border-2 border-dashed border-muted-foreground/10">
                        <div className="w-16 h-16 rounded-full bg-muted mx-auto flex items-center justify-center">
                            <Clock className="w-8 h-8 text-muted-foreground/40" />
                        </div>
                        <p className="text-muted-foreground font-bold">{t('tasks.list.noResults')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredTasks.map((task) => (
                            <TaskCard
                                key={task.id}
                                task={task}
                                onEdit={() => {
                                    setEditingTask(task);
                                    setIsFormOpen(true);
                                }}
                                onViewDetails={async () => {
                                    const [detail, runs] = await Promise.all([
                                        getTaskDetail(task.id),
                                        listTaskRuns(task.id),
                                    ]);
                                    setSelectedTask(detail || task);
                                    setTaskRuns(runs);
                                    setTaskFinalSummary(getTaskFinalSummary(task.id));
                                    setIsDetailsOpen(true);
                                }}
                                onRunNow={async () => {
                                    const ok = await runTaskAction(task.id, async () => runTaskNow(task.id));
                                    if (ok) {
                                        await refreshTasks(selectedAgentId);
                                    }
                                }}
                                onStopNow={async () => {
                                    const ok = await runTaskAction(task.id, async () => pauseTask(task.id));
                                    if (ok) {
                                        await refreshTasks(selectedAgentId);
                                    }
                                }}
                                onDelete={async () => {
                                    const confirmed = await showConfirm(t('tasks.list.deleteConfirm', { name: task.name }), {
                                        title: '确认删除任务',
                                        confirmText: '删除',
                                        cancelText: '取消',
                                    });
                                    if (!confirmed) {
                                        return;
                                    }
                                    const ok = await runTaskAction(task.id, async () => deleteTask(task.id));
                                    if (ok) {
                                        await refreshTasks(selectedAgentId);
                                    }
                                }}
                                busy={busyTaskId === task.id}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* 编辑/创建表单 */}
            <TaskFormDialog
                open={isFormOpen}
                onOpenChange={(open) => {
                    setIsFormOpen(open);
                    if (!open) {
                        setEditingTask(null);
                        setInitialPrompt(undefined);
                    }
                }}
                task={editingTask}
                tasks={tasks}
                agentId={selectedAgentId}
                agents={agentOptions}
                initialPrompt={initialPrompt}
                onSuccess={() => {
                    setIsFormOpen(false);
                    setEditingTask(null);
                    setInitialPrompt(undefined);
                    void refreshTasks(selectedAgentId);
                }}
            />

            {/* 详情查看 */}
            <TaskDetailsDialog
                open={isDetailsOpen}
                onOpenChange={setIsDetailsOpen}
                task={selectedTask ? (() => {
                    const agent = agentOptions.find((item) => item.id === selectedTask.teamId);
                    return {
                        ...selectedTask,
                        agentId: selectedTask.teamId,
                        agentName: agent?.name || selectedTask.teamId,
                        agentAvatarUrl: agent?.identity?.avatar_url,
                        agentColor: agent?.identity?.color,
                    };
                })() : null}
                runs={taskRuns}
                finalSummary={taskFinalSummary}
            />
        </div>
    );
}
/** 任务卡片组件 */
function TaskCard({
    task,
    onEdit,
    onViewDetails,
    onRunNow,
    onStopNow,
    onDelete,
    busy
}: {
    task: Task;
    onEdit: () => void;
    onViewDetails: () => void;
    onRunNow: () => Promise<void>;
    onStopNow: () => Promise<void>;
    onDelete: () => Promise<void>;
    busy: boolean;
}) {
    const { t } = useTranslation();

    const lifecycle = resolveTaskLifecycle(task);
    const statusColor = lifecycleBadgeClass(lifecycle);
    const statusLabel = lifecycleBadgeLabel(lifecycle);
    const canDelete = canDeleteTask(task);
    const canPublish = lifecycle === 'pending' && !task.enabled && task.sourceType !== 'chat';
    const canTerminate = task.enabled && lifecycle === 'running';
    const canEdit = lifecycle === 'pending' && !task.enabled;

    // 进度计算
    const hasLimit = task.maxRuns && task.maxRuns > 0;
    const progress = hasLimit ? Math.min(100, Math.floor((task.runInfo.runCount / task.maxRuns!) * 100)) : 0;

    return (
        <Card className="group relative overflow-hidden border-border/40 bg-card/40 hover:bg-card/60 hover:border-primary/20 transition-all duration-300 rounded-3xl shadow-sm hover:shadow-xl hover:shadow-primary/5 cursor-pointer" onClick={onViewDetails}>
            <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-6">
                {/* ... 内容保持不变，只需在按钮上处理点击 ... */}
                {/* 左侧：状态与来源 */}
                <div className="flex flex-row md:flex-col items-center md:items-start justify-between md:justify-center gap-4 shrink-0 min-w-[120px]">
                    <div className="flex flex-col items-center md:items-start gap-1">
                        <Badge className={cn("rounded-full px-3 py-1 font-black text-[10px] uppercase tracking-wider border-none shadow-lg", statusColor)}>
                            {statusLabel}
                        </Badge>
                        <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mt-1">
                            {task.enabled ? t('tasks.list.statusEnabled') : t('tasks.list.statusPaused')}
                        </span>
                    </div>
                    <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[9px] font-bold border-muted-foreground/20 text-muted-foreground/80 lowercase">
                        #{task.sourceType === 'chat' ? t('tasks.list.sourceChat') : t('tasks.list.sourceCustom')}
                    </Badge>
                    {task.isTemplate ? (
                        <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-[9px] font-bold">
                            模板
                        </Badge>
                    ) : null}
                </div>

                {/* 中间：基本信息 */}
                <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                        <h4 className="text-lg font-black tracking-tight group-hover:text-primary transition-colors">{task.name}</h4>
                        <span className="text-[10px] bg-muted/50 px-2 py-0.5 rounded-full font-mono text-muted-foreground border border-border/20">
                            {task.id}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 md:gap-8 text-xs font-bold text-muted-foreground/70">
                        {/* 调度信息 */}
                        <div className="flex items-center gap-2 bg-primary/5 px-3 py-1 rounded-full border border-primary/10">
                            <Clock className="w-3.5 h-3.5 text-primary opacity-70" />
                            <span className="text-primary font-black uppercase text-[9px] tracking-wider">
                                {task.schedule.kind === 'cron' ? `CRON: ${task.schedule.expr}` :
                                    task.schedule.kind === 'at' ? `AT: ${task.schedule.at}` : `EVERY: ${task.schedule.everyMs}ms`}
                            </span>
                        </div>

                        {/* 循环次数/进度 */}
                        <div className="flex items-center gap-2 px-3 py-1 bg-muted/30 rounded-full border border-border/10">
                            <RefreshCcw className={cn("w-3.5 h-3.5 opacity-70", task.runInfo.lastStatus === 'running' && "animate-spin")} />
                            {hasLimit ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] uppercase tracking-widest font-black">
                                        {t('tasks.list.progress')}: {task.runInfo.runCount}/{task.maxRuns}
                                    </span>
                                    <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-primary transition-all duration-500"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <span className="text-[9px] uppercase tracking-widest font-black flex items-center gap-1">
                                    {t('tasks.list.infinite')} <span className="text-[12px]">∞</span>
                                    <span className="opacity-70">· 已运行 {Math.max(0, task.runInfo.runCount)} 次</span>
                                </span>
                            )}
                        </div>
                        {task.enabled && task.runInfo.lastStatus !== 'ok' && task.runInfo.lastStatus !== 'error' && (
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-success/5 rounded-full border border-success/10 text-success/80">
                                <CalendarDays className="w-3.5 h-3.5" />
                                <span className="text-[10px] uppercase tracking-widest">
                                    {t('tasks.list.nextRun')}: {task.runInfo.nextRun ? new Date(task.runInfo.nextRun).toLocaleString() : '-'}
                                </span>
                            </div>
                        )}
                        {task.runInfo.lastRun && (
                            <div className="flex items-center gap-1.5 opacity-60">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>{t('tasks.list.lastRun')}: {new Date(task.runInfo.lastRun).toLocaleString()}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 右侧：状态切换与操作 */}
                <div className="flex flex-col md:flex-row items-center gap-6" onClick={e => e.stopPropagation()}>
                    <div className="flex md:flex-col items-center gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0">
                        <div className="flex gap-2">
                            {canEdit && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-9 px-4 rounded-xl gap-2 font-bold"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onEdit();
                                    }}
                                    disabled={busy}
                                >
                                    修改
                                </Button>
                            )}

                            {/* 执行中/已发布 -> 终止 */}
                            {canTerminate && (
                                <Button
                                    variant="default"
                                    size="sm"
                                    className="h-9 px-4 rounded-xl gap-2 font-black shadow-lg shadow-foreground/20 bg-foreground hover:bg-foreground/90 text-background transition-all"
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        await onStopNow();
                                    }}
                                    disabled={busy}
                                >
                                    <Square className="w-3 h-3 fill-current" />
                                    {t('tasks.list.stopNow')}
                                </Button>
                            )}

                            {/* 待执行(未发布) -> 运行 */}
                            {canPublish && (
                                <Button
                                    variant="default"
                                    size="sm"
                                    className="h-9 px-4 rounded-xl gap-2 font-black shadow-lg shadow-primary/20 bg-primary text-primary-foreground hover:scale-105 transition-all"
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        await onRunNow();
                                    }}
                                    disabled={busy}
                                >
                                    <Play className="w-4 h-4" />
                                    {t('tasks.list.runNow')}
                                </Button>
                            )}

                            <Button
                                variant="secondary"
                                size="sm"
                                className="h-9 px-4 rounded-xl gap-2 font-bold hover:bg-destructive/10 hover:text-destructive border-none shadow-sm transition-all disabled:opacity-30 disabled:hover:bg-secondary"
                                disabled={!canDelete}
                                title={!canDelete ? (task.runInfo.lastStatus === 'running' ? t('tasks.list.deleteRunningError') : t('tasks.list.deleteHistoryError')) : ''}
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    await onDelete();
                                }}
                            >
                                <Trash2 className="w-4 h-4" />
                                {t('tasks.list.delete')}
                            </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground font-bold flex items-center gap-1 pr-2">
                            <AlertCircle className="w-3 h-3" />
                            {t('tasks.list.immutableHint')}
                        </p>
                    </div>
                </div>
            </CardContent>

            {/* 装饰边条 */}
            <div className={cn("absolute left-0 top-0 bottom-0 w-1",
                lifecycle === 'success' ? "bg-success" :
                    lifecycle === 'failed' ? "bg-destructive" :
                        lifecycle === 'running' ? "bg-primary" : "bg-muted"
            )} />
        </Card>
    );
}

/** 任务表单弹窗 */
const CRON_DEFAULT_EXPR = '*/5 * * * *';
const DEFAULT_FINAL_SUMMARY_PROMPT = '请基于全部执行日志，输出最终总结报告：总体结论、关键变化、异常与建议。';
const CRON_PRESETS: ReadonlyArray<{ label: string; expr: string }> = [
    { label: '每分钟', expr: '* * * * *' },
    { label: '每5分钟', expr: '*/5 * * * *' },
    { label: '每15分钟', expr: '*/15 * * * *' },
    { label: '每30分钟', expr: '*/30 * * * *' },
    { label: '每小时', expr: '0 * * * *' },
    { label: '工作日 9 点', expr: '0 9 * * 1-5' },
];
type ScheduleBuildMode = 'ai' | 'manual';
type ManualRuleKind = 'every_n_minutes' | 'hourly' | 'daily' | 'weekly';

const WEEKDAY_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
    { label: '周一', value: '1' },
    { label: '周二', value: '2' },
    { label: '周三', value: '3' },
    { label: '周四', value: '4' },
    { label: '周五', value: '5' },
    { label: '周六', value: '6' },
    { label: '周日', value: '0' },
];

function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseTimeText(raw: string, fallbackHour = 9, fallbackMinute = 0): { hour: number; minute: number } {
    const text = raw.trim();
    if (!text) {
        return { hour: fallbackHour, minute: fallbackMinute };
    }

    const hm = text.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
    if (hm) {
        return {
            hour: clampNumber(Number(hm[1]), 0, 23, fallbackHour),
            minute: clampNumber(Number(hm[2]), 0, 59, fallbackMinute),
        };
    }

    const chinese = text.match(/(\d{1,2})\s*点(?:\s*(\d{1,2})\s*分?)?/);
    if (chinese) {
        let hour = clampNumber(Number(chinese[1]), 0, 23, fallbackHour);
        const minute = clampNumber(Number(chinese[2] || fallbackMinute), 0, 59, fallbackMinute);
        if (/(下午|晚上)/.test(text) && hour < 12) {
            hour += 12;
        }
        if (/凌晨/.test(text) && hour === 12) {
            hour = 0;
        }
        return { hour, minute };
    }

    return { hour: fallbackHour, minute: fallbackMinute };
}

function everyMsToCron(everyMs: number): string {
    const safeMs = Math.max(60_000, Math.floor(everyMs));
    if (safeMs % 60_000 !== 0) {
        return '*/1 * * * *';
    }
    const minutes = safeMs / 60_000;
    if (minutes <= 1) return '* * * * *';
    if (minutes < 60) return `*/${minutes} * * * *`;
    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        if (hours <= 1) return '0 * * * *';
        if (hours < 24) return `0 */${hours} * * *`;
        if (hours === 24) return '0 9 * * *';
    }
    return '*/30 * * * *';
}

function inferCronFromSemantic(text: string): string | null {
    const raw = text.trim();
    if (!raw) return null;

    const parsed = parseChatTaskIntent(raw);
    if (parsed?.everyMs) {
        return everyMsToCron(parsed.everyMs);
    }

    if (/工作日/.test(raw)) {
        const { hour, minute } = parseTimeText(raw, 9, 0);
        return `${minute} ${hour} * * 1-5`;
    }

    if (/每\s*周|每周/.test(raw)) {
        const dayMatch = raw.match(/周([一二三四五六日天])/);
        const dayMap: Record<string, string> = {
            一: '1',
            二: '2',
            三: '3',
            四: '4',
            五: '5',
            六: '6',
            日: '0',
            天: '0',
        };
        const day = dayMatch ? dayMap[dayMatch[1]] : '1';
        const { hour, minute } = parseTimeText(raw, 9, 0);
        return `${minute} ${hour} * * ${day}`;
    }

    if (/每\s*天|每天/.test(raw)) {
        const { hour, minute } = parseTimeText(raw, 9, 0);
        return `${minute} ${hour} * * *`;
    }

    if (/每\s*小时/.test(raw)) {
        const minuteMatch = raw.match(/(\d{1,2})\s*分/);
        const minute = clampNumber(Number(minuteMatch?.[1] || 0), 0, 59, 0);
        return `${minute} * * * *`;
    }

    return null;
}

function normalizeCronExpression(raw: string): string {
    const trimmed = raw.trim().replace(/^[`'"]+|[`'"]+$/g, '').trim();
    if (!trimmed) return '';
    const compact = trimmed.replace(/\s+/g, ' ');
    const fields = compact.split(' ');
    if (fields.length === 6) {
        // 兼容旧输入含 seconds 的 6 段 cron，后端只接受 5 段
        return fields.slice(1).join(' ');
    }
    return compact;
}

function cronFromSchedule(schedule: Task['schedule']): string {
    if (schedule.kind === 'cron') {
        return normalizeCronExpression(schedule.expr || '') || CRON_DEFAULT_EXPR;
    }
    if (schedule.kind === 'every') {
        const everyMs = Math.max(60_000, schedule.everyMs || 60_000);
        const minutes = Math.max(1, Math.round(everyMs / 60_000));
        if (minutes === 1) return '* * * * *';
        if (minutes < 60) return `*/${minutes} * * * *`;
        if (minutes % 60 === 0) return `0 */${Math.round(minutes / 60)} * * *`;
        return '*/30 * * * *';
    }
    if (schedule.kind === 'at' && schedule.at) {
        const date = new Date(schedule.at);
        if (!Number.isNaN(date.getTime())) {
            return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
        }
    }
    return CRON_DEFAULT_EXPR;
}

function TaskFormDialog({
    open,
    onOpenChange,
    task,
    tasks,
    agentId,
    agents,
    initialPrompt,
    onSuccess
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    task: Task | null;
    tasks: Task[];
    agentId: string;
    agents: readonly ManagementAgentSummary[];
    initialPrompt?: string;
    onSuccess: () => void;
}) {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [prompt, setPrompt] = useState('');
    const [cronExpr, setCronExpr] = useState(CRON_DEFAULT_EXPR);
    const [scheduleBuildMode, setScheduleBuildMode] = useState<ScheduleBuildMode>('manual');
    const [semanticScheduleText, setSemanticScheduleText] = useState('');
    const [manualRuleKind, setManualRuleKind] = useState<ManualRuleKind>('every_n_minutes');
    const [manualEveryMinutes, setManualEveryMinutes] = useState(5);
    const [manualHourlyMinute, setManualHourlyMinute] = useState(0);
    const [manualDailyTime, setManualDailyTime] = useState('09:00');
    const [manualWeeklyDay, setManualWeeklyDay] = useState('1');
    const [manualWeeklyTime, setManualWeeklyTime] = useState('09:00');
    const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('none');
    const [finalSummaryPrompt, setFinalSummaryPrompt] = useState(DEFAULT_FINAL_SUMMARY_PROMPT);
    const [maxRuns, setMaxRuns] = useState<number>(0);
    const [targetAgentId, setTargetAgentId] = useState('');
    const [saveAsTemplate, setSaveAsTemplate] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;

        // Use setTimeout to avoid synchronous setState during effect
        setTimeout(() => {
            if (task) {
                setName(task.name);
                setPrompt(task.prompt || task.command || '');
                setCronExpr(cronFromSchedule(task.schedule));
                setScheduleBuildMode('manual');
                setSemanticScheduleText('');
                setManualRuleKind('every_n_minutes');
                setManualEveryMinutes(5);
                setManualHourlyMinute(0);
                setManualDailyTime('09:00');
                setManualWeeklyDay('1');
                setManualWeeklyTime('09:00');
                setDeliveryMode(task.delivery.mode);
                setFinalSummaryPrompt(task.delivery.finalSummaryPrompt || DEFAULT_FINAL_SUMMARY_PROMPT);
                setMaxRuns(task.maxRuns || 0);
                setTargetAgentId(task.teamId);
                setSaveAsTemplate(Boolean(task.isTemplate));
            } else {
                setName('');
                setPrompt(initialPrompt || '');
                setCronExpr(CRON_DEFAULT_EXPR);
                setScheduleBuildMode('manual');
                setSemanticScheduleText('');
                setManualRuleKind('every_n_minutes');
                setManualEveryMinutes(5);
                setManualHourlyMinute(0);
                setManualDailyTime('09:00');
                setManualWeeklyDay('1');
                setManualWeeklyTime('09:00');
                setDeliveryMode('none');
                setFinalSummaryPrompt(DEFAULT_FINAL_SUMMARY_PROMPT);
                setMaxRuns(0);
                setTargetAgentId(agentId);
                setSaveAsTemplate(false);
            }
        }, 0);
    }, [task, open, initialPrompt, agentId, setName, setPrompt, setCronExpr, setDeliveryMode, setMaxRuns]);

    const buildCronFromManual = (): string => {
        if (manualRuleKind === 'every_n_minutes') {
            const step = clampNumber(manualEveryMinutes, 1, 59, 5);
            return step === 1 ? '* * * * *' : `*/${step} * * * *`;
        }
        if (manualRuleKind === 'hourly') {
            const minute = clampNumber(manualHourlyMinute, 0, 59, 0);
            return `${minute} * * * *`;
        }
        if (manualRuleKind === 'daily') {
            const { hour, minute } = parseTimeText(manualDailyTime, 9, 0);
            return `${minute} ${hour} * * *`;
        }
        const weekday = clampNumber(Number(manualWeeklyDay), 0, 6, 1);
        const { hour, minute } = parseTimeText(manualWeeklyTime, 9, 0);
        return `${minute} ${hour} * * ${weekday}`;
    };

    const handleGenerateBySemantic = () => {
        const cron = inferCronFromSemantic(semanticScheduleText);
        if (!cron) {
            pushInAppNotice({
                title: '语义解析失败',
                message: '未识别出明确调度，请改写描述或使用手动规则。',
                level: 'error',
            });
            return;
        }
        setCronExpr(cron);
        pushInAppNotice({
            title: '已生成表达式',
            message: cron,
            level: 'success',
        });
    };

    const handleGenerateByManual = () => {
        const cron = buildCronFromManual();
        setCronExpr(cron);
        pushInAppNotice({
            title: '已生成表达式',
            message: cron,
            level: 'success',
        });
    };

    const handleSubmit = async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
            if (!targetAgentId) {
                alert(t('tasks.form.agentRequired'));
                return;
            }
            if (!name.trim()) {
                alert(t('tasks.form.namePlaceholder'));
                return;
            }
            const normalizedCronExpr = normalizeCronExpression(cronExpr);
            if (!normalizedCronExpr) {
                alert(t('tasks.form.cronPlaceholder'));
                return;
            }
            if (normalizedCronExpr.split(' ').length !== 5) {
                alert('CRON 表达式必须是 5 段：minute hour day-of-month month day-of-week');
                return;
            }

            const createInput: Partial<Task> = {
                teamId: targetAgentId,
                sourceType: 'custom',
                name: name.trim(),
                schedule: { kind: 'cron', expr: normalizedCronExpr },
                jobType: 'agent',
                prompt: prompt.trim() || undefined,
                isTemplate: saveAsTemplate,
                delivery: deliveryMode === 'announce'
                    ? {
                        mode: 'announce',
                        channel: 'system',
                        finalSummaryPrompt: finalSummaryPrompt.trim() || DEFAULT_FINAL_SUMMARY_PROMPT,
                        notifyOnFinal: true,
                    }
                    : { mode: 'none' },
                maxRuns,
            };

            // 编辑模式：当前后端不支持完整更新，采用“删除重建”策略
            if (task?.id) {
                const removed = await deleteTask(task.id);
                if (!removed.success) {
                    pushInAppNotice({
                        title: '任务更新失败',
                        message: removed.message || '旧任务删除失败，无法保存修改。',
                        level: 'error',
                    });
                    return;
                }
            }

            const created = await createTask(createInput);

            if (!created.success) {
                pushInAppNotice({
                    title: '任务创建失败',
                    message: created.message || '未知错误',
                    level: 'error',
                });
                return;
            }

            pushInAppNotice({
                title: '任务创建成功',
                message: task ? `${name.trim()}（已更新）` : name.trim(),
                level: 'success',
            });
            onSuccess();
        } catch (error) {
            pushInAppNotice({
                title: '任务创建失败',
                message: error instanceof Error ? error.message : String(error),
                level: 'error',
            });
        } finally {
            setSubmitting(false);
        }
    };

    // 任务中心列表里会混入 chat 触发的任务；表单里只允许基于“手动/自定义”任务做模板选择
    const manualTasks = tasks.filter((taskItem) => taskItem.sourceType !== 'chat');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="z-[70] w-[min(960px,calc(100vw-24px))] max-w-2xl max-h-[92vh] overflow-hidden flex flex-col min-h-0 p-0 rounded-3xl border-none shadow-2xl">
                <DialogHeader className="p-8 pb-4">
                    <DialogTitle className="text-2xl font-black tracking-tight">
                        {task ? '编辑任务' : t('tasks.form.create')}
                    </DialogTitle>
                    <DialogDescription className="font-medium text-muted-foreground">
                        {t('tasks.form.basicInfo')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8">
                    {!task && (
                        <div className="space-y-2 p-4 bg-primary/5 rounded-2xl border border-primary/10 mb-4">
                            <Label className="font-bold text-xs uppercase tracking-widest text-primary/60">{t('tasks.form.templateSelect')}</Label>
                            <Select onValueChange={(taskId) => {
                                const found = tasks.find(t => t.id === taskId);
                                if (found) {
                                    setName(found.name + ' (Copy)');
                                    setPrompt(found.prompt || found.command || '');
                                    setCronExpr(cronFromSchedule(found.schedule));
                                    setDeliveryMode(found.delivery.mode);
                                    setFinalSummaryPrompt(found.delivery.finalSummaryPrompt || DEFAULT_FINAL_SUMMARY_PROMPT);
                                    setSaveAsTemplate(Boolean(found.isTemplate));
                                }
                            }}>
                                <SelectTrigger className="rounded-xl h-10 bg-background border-none shadow-sm">
                                    <SelectValue placeholder={t('tasks.form.templateSelectLabel')} />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-none shadow-xl">
                                    <SelectItem value="none">{t('common.none')}</SelectItem>
                                    {manualTasks.filter(t => t.isTemplate).map(t => (
                                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="space-y-8 py-4">
                        {/* 基础信息 */}
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground/80">{t('tasks.form.name')}</Label>
                                <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('tasks.form.namePlaceholder')} className="rounded-xl h-11 border-muted-foreground/10 focus-visible:ring-primary/20" />
                            </div>
                            <div className="space-y-2">
                                <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground/80">{t('tasks.form.ownerAgent')}</Label>
                                <Select value={targetAgentId} onValueChange={setTargetAgentId}>
                                    <SelectTrigger className="rounded-xl h-11 border-muted-foreground/10">
                                        <SelectValue placeholder={t('tasks.form.agentPlaceholder')} />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-none shadow-xl">
                                        {agents.map((agent) => (
                                            <SelectItem key={agent.id} value={agent.id}>
                                                {agent.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground/80">{t('tasks.form.jobType')}</Label>
                                    <Select value="agent" disabled>
                                        <SelectTrigger className="rounded-xl h-11 border-muted-foreground/10">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-none shadow-xl">
                                            <SelectItem value="agent">{t('tasks.form.jobAgent')}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                调度方式可在下方“CRON EXPRESSION”区域选择：`AI 语义生成` 或 `手动规则生成`。
                            </p>
                        </div>

                        {/* 调度设置 */}
                        <div className="space-y-4 p-6 bg-primary/5 rounded-3xl border border-primary/10">
                            <h4 className="font-black text-sm text-primary">CRON EXPRESSION</h4>
                            <div className="space-y-2">
                                <p className="text-[11px] font-bold uppercase tracking-widest text-primary/70">生成方式</p>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className={cn(
                                            'h-8 rounded-lg px-3 text-[11px] font-semibold border-muted-foreground/20',
                                            scheduleBuildMode === 'ai'
                                                ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                                                : 'bg-background hover:bg-muted/70',
                                        )}
                                        onClick={() => setScheduleBuildMode('ai')}
                                    >
                                        AI 语义生成
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className={cn(
                                            'h-8 rounded-lg px-3 text-[11px] font-semibold border-muted-foreground/20',
                                            scheduleBuildMode === 'manual'
                                                ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                                                : 'bg-background hover:bg-muted/70',
                                        )}
                                        onClick={() => setScheduleBuildMode('manual')}
                                    >
                                        手动规则生成
                                    </Button>
                                </div>
                            </div>

                            {scheduleBuildMode === 'ai' ? (
                                <div className="space-y-3 rounded-2xl border border-primary/10 bg-background/70 p-4">
                                    <Label className="font-bold text-xs uppercase tracking-widest text-primary/70">语义描述</Label>
                                    <Textarea
                                        value={semanticScheduleText}
                                        onChange={(e) => setSemanticScheduleText(e.target.value)}
                                        placeholder="例如：每小时 30 分执行一次；每天 9 点提醒；每周一上午 10 点运行"
                                        className="rounded-xl min-h-[84px] border-none bg-background shadow-sm"
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-lg px-3 text-[11px] font-semibold border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                                        onClick={handleGenerateBySemantic}
                                    >
                                        AI 理解并生成表达式
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-3 rounded-2xl border border-primary/10 bg-background/70 p-4">
                                    <Label className="font-bold text-xs uppercase tracking-widest text-primary/70">手动规则</Label>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <Select value={manualRuleKind} onValueChange={(value: ManualRuleKind) => setManualRuleKind(value)}>
                                            <SelectTrigger className="rounded-xl h-10 border-muted-foreground/10">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-xl border-none shadow-xl">
                                                <SelectItem value="every_n_minutes">每 N 分钟</SelectItem>
                                                <SelectItem value="hourly">每小时</SelectItem>
                                                <SelectItem value="daily">每天</SelectItem>
                                                <SelectItem value="weekly">每周</SelectItem>
                                            </SelectContent>
                                        </Select>

                                        {manualRuleKind === 'every_n_minutes' ? (
                                            <Input
                                                type="number"
                                                min={1}
                                                max={59}
                                                value={manualEveryMinutes}
                                                onChange={(e) => setManualEveryMinutes(Number(e.target.value))}
                                                className="rounded-xl h-10 border-muted-foreground/10"
                                                placeholder="间隔分钟"
                                            />
                                        ) : null}

                                        {manualRuleKind === 'hourly' ? (
                                            <Input
                                                type="number"
                                                min={0}
                                                max={59}
                                                value={manualHourlyMinute}
                                                onChange={(e) => setManualHourlyMinute(Number(e.target.value))}
                                                className="rounded-xl h-10 border-muted-foreground/10"
                                                placeholder="每小时第几分钟执行"
                                            />
                                        ) : null}

                                        {manualRuleKind === 'daily' ? (
                                            <Input
                                                type="time"
                                                value={manualDailyTime}
                                                onChange={(e) => setManualDailyTime(e.target.value)}
                                                className="rounded-xl h-10 border-muted-foreground/10"
                                            />
                                        ) : null}

                                        {manualRuleKind === 'weekly' ? (
                                            <div className="grid grid-cols-2 gap-2">
                                                <Select value={manualWeeklyDay} onValueChange={setManualWeeklyDay}>
                                                    <SelectTrigger className="rounded-xl h-10 border-muted-foreground/10">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xl border-none shadow-xl">
                                                        {WEEKDAY_OPTIONS.map((weekday) => (
                                                            <SelectItem key={weekday.value} value={weekday.value}>
                                                                {weekday.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Input
                                                    type="time"
                                                    value={manualWeeklyTime}
                                                    onChange={(e) => setManualWeeklyTime(e.target.value)}
                                                    className="rounded-xl h-10 border-muted-foreground/10"
                                                />
                                            </div>
                                        ) : null}
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-lg px-3 text-[11px] font-semibold border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                                        onClick={handleGenerateByManual}
                                    >
                                        生成表达式
                                    </Button>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Input
                                    value={cronExpr}
                                    onChange={e => setCronExpr(e.target.value)}
                                    placeholder={t('tasks.form.cronPlaceholder')}
                                    className="rounded-xl h-11 bg-background border-none shadow-sm font-mono"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Format: minute hour day-of-month month day-of-week
                                </p>
                            </div>
                            <div className="space-y-2">
                                <p className="text-[11px] font-bold uppercase tracking-widest text-primary/70">Quick Presets</p>
                                <div className="flex flex-wrap gap-2">
                                    {CRON_PRESETS.map((preset) => {
                                        const active = normalizeCronExpression(cronExpr) === preset.expr;
                                        return (
                                            <Button
                                                key={preset.expr}
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className={cn(
                                                    'h-8 rounded-lg px-3 text-[11px] font-semibold border-muted-foreground/20',
                                                    active
                                                        ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                                                        : 'bg-background hover:bg-muted/70',
                                                )}
                                                onClick={() => setCronExpr(preset.expr)}
                                            >
                                                {preset.label}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* 任务内容 */}
                        <div className="space-y-4 p-6 bg-muted/30 rounded-3xl border border-muted-foreground/5">
                            <h4 className="font-black text-sm">{t('tasks.form.jobInfo')}</h4>
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground/80">{t('tasks.form.prompt')}</Label>
                                    <Textarea
                                        value={prompt}
                                        onChange={e => setPrompt(e.target.value)}
                                        placeholder={t('tasks.form.promptPlaceholder')}
                                        className="rounded-2xl min-h-[120px] bg-background border-none shadow-sm focus-visible:ring-primary/20"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 循环次数设置 */}
                        <div className="space-y-4 p-6 bg-muted/20 rounded-3xl border border-muted-foreground/5">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="font-bold text-sm">{t('tasks.list.loopLimit')}</Label>
                                    <p className="text-[10px] text-muted-foreground font-medium">{t('tasks.list.maxRuns')}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Input
                                        type="number"
                                        value={maxRuns}
                                        onChange={e => setMaxRuns(Math.max(0, Number(e.target.value)))}
                                        className="w-24 h-10 rounded-xl bg-background border-none shadow-sm text-center font-black"
                                        placeholder="0=∞"
                                    />
                                    <span className="text-[10px] font-black opacity-40 uppercase tracking-widest">{maxRuns > 0 ? 'times' : 'infinite'}</span>
                                </div>
                            </div>
                        </div>

                        {/* 模板设置 */}
                        <div className="space-y-4 p-6 bg-muted/20 rounded-3xl border border-muted-foreground/5">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="font-bold text-sm">保存为模板</Label>
                                    <p className="text-[10px] text-muted-foreground font-medium">模板可在下次新建任务时直接套用并填充字段</p>
                                </div>
                                <Switch
                                    checked={saveAsTemplate}
                                    onCheckedChange={setSaveAsTemplate}
                                />
                            </div>
                        </div>

                        {/* 交付设置 */}
                        <div className="space-y-4">
                            <h4 className="font-black text-sm">{t('tasks.form.deliveryTitle')}</h4>
                            <div className="flex items-center justify-between p-4 bg-muted/20 rounded-2xl">
                                <div className="space-y-0.5">
                                    <Label className="font-bold">{t('tasks.form.delivery')}</Label>
                                    <p className="text-[10px] text-muted-foreground font-medium">任务完成后发送系统通知（右下角）。后续可扩展 WhatsApp/Message。</p>
                                </div>
                                <Switch
                                    checked={deliveryMode === 'announce'}
                                    onCheckedChange={checked => setDeliveryMode(checked ? 'announce' : 'none')}
                                />
                            </div>
                            {deliveryMode === 'announce' ? (
                                <div className="space-y-3 rounded-2xl border border-primary/10 bg-primary/5 p-4">
                                    <div className="space-y-1">
                                        <Label className="font-bold text-xs uppercase tracking-widest text-primary/70">通知通道</Label>
                                        <Input
                                            value="system (托盘通知)"
                                            readOnly
                                            className="rounded-xl h-10 bg-background border-none shadow-sm text-muted-foreground"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="font-bold text-xs uppercase tracking-widest text-primary/70">最终总结提示词</Label>
                                        <Textarea
                                            value={finalSummaryPrompt}
                                            onChange={(e) => setFinalSummaryPrompt(e.target.value)}
                                            placeholder={DEFAULT_FINAL_SUMMARY_PROMPT}
                                            className="rounded-xl min-h-[84px] bg-background border-none shadow-sm"
                                        />
                                        <p className="text-[10px] text-muted-foreground">
                                            达到最大运行次数后，系统会把全部执行日志交给 AI 按此提示词生成总结，并发送通知。
                                        </p>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-8 pt-4 bg-muted/10">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full font-bold px-8">
                        {t('common.cancel')}
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="rounded-full font-black px-10 shadow-lg shadow-primary/20 bg-primary text-primary-foreground"
                    >
                        {submitting ? t('common.saving') : (task ? '保存修改' : t('common.save'))}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

