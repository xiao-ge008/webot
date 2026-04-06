import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, FileText, MessageSquare, RefreshCcw, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveTaskLifecycle, taskLifecycleLabel } from '@/lib/task-lifecycle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import type { ChatTaskCardData, ChatTaskLifecycleItem } from '@/types/chat-task';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface TaskDetailsTask {
    id: string;
    name: string;
    jobType: string;
    enabled?: boolean;
    runtimeState?: string;
    agentId?: string;
    teamId?: string;
    agentName?: string;
    agentAvatarUrl?: string;
    agentColor?: string;
    createdAt?: string;
    maxRuns?: number;
    finalSummary?: { runCount: number; content: string; createdAt: string } | null;
    timeline?: Array<{
        id: string;
        sourceKind?: string;
        status?: string;
        summary: string;
        createdAt: string;
    }>;
    runInfo: {
        lastStatus?: string;
        runCount?: number;
    };
}

export interface TaskDetailsRun {
    id: string;
    taskId?: string;
    startTime: string;
    endTime?: string;
    status: string;
    output: string;
}

interface TaskDetailsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    task: TaskDetailsTask | null;
    runs: readonly TaskDetailsRun[];
    finalSummary?: { runCount: number; content: string; createdAt: string } | null;
    chatTaskCard?: ChatTaskCardData | null;
    sourceMessageId?: string | null;
}

interface TaskDetailsPanelProps {
    task: TaskDetailsTask | null;
    runs: readonly TaskDetailsRun[];
    finalSummary?: { runCount: number; content: string; createdAt: string } | null;
    chatTaskCard?: ChatTaskCardData | null;
    sourceMessageId?: string | null;
    showHeader?: boolean;
    className?: string;
}

type TaskFinalSummary = { runCount: number; content: string; createdAt: string } | null;

type TaskDetailsResolved = {
    task: TaskDetailsTask;
    lifecycle: ReturnType<typeof resolveTaskLifecycle>;
    runCount: number;
    timeline: ChatTaskLifecycleItem[];
    processTimeline: ChatTaskLifecycleItem[];
    anomalyTimeline: ChatTaskLifecycleItem[];
    finalSummary: TaskFinalSummary;
    finalSummaryText: string;
    finalSummaryCreatedAt?: string;
    finalSummaryRunCount: number;
};

function normalizeRunStatus(status?: string): 'ok' | 'error' | 'running' | 'idle' {
    if (!status) {
        return 'idle';
    }
    const raw = status.trim().toLowerCase();
    if (['ok', 'success', 'done', 'completed'].includes(raw)) return 'ok';
    if (['error', 'failed', 'fail'].includes(raw)) return 'error';
    if (['running', 'in_progress', 'processing'].includes(raw)) return 'running';
    if (['idle', 'pending', 'paused', 'disabled'].includes(raw)) return 'idle';
    return 'idle';
}

function formatDateDisplay(raw?: string): string {
    if (!raw) return '-';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString();
}

function formatTimeDisplay(raw: string): string {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString();
}

function formatDuration(start?: string, end?: string): string {
    if (!start || !end) return '-';
    const startAt = new Date(start).getTime();
    const endAt = new Date(end).getTime();
    if (Number.isNaN(startAt) || Number.isNaN(endAt)) return '-';
    const diff = Math.max(0, endAt - startAt);
    if (diff < 1000) return `${diff}ms`;
    if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`;
    return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
}

function taskKindLabel(kind?: ChatTaskCardData['taskKind']): string {
    if (kind === 'chat_async') return '聊天长任务';
    if (kind === 'manual_schedule') return '任务中心定时任务';
    if (kind === 'a2a_delegate') return '协作委派任务';
    return '聊天定时任务';
}

function taskReportStatusLabel(status?: ChatTaskCardData['reportStatus']): string {
    if (status === 'acknowledged') return '已在当前会话汇报';
    return '待汇报';
}

function taskStageLabel(stage?: ChatTaskCardData['stage']): string {
    if (stage === 'proposal') return '待确认';
    if (stage === 'scheduled') return '等待执行';
    if (stage === 'running') return '执行中';
    if (stage === 'completed') return '已完成';
    if (stage === 'cancelled') return '已取消';
    if (stage === 'failed') return '失败';
    return '未知';
}

function taskTimelineLabel(kind: ChatTaskLifecycleItem['kind']): string {
    if (kind === 'created') return '已创建';
    if (kind === 'started') return '已启动';
    if (kind === 'progress') return '进度';
    if (kind === 'anomaly') return '异常';
    if (kind === 'final') return '总结';
    if (kind === 'failed') return '失败';
    return '已取消';
}

function taskTimelineClass(item: ChatTaskLifecycleItem): string {
    if (item.kind === 'anomaly' || item.kind === 'failed' || item.level === 'error') {
        return 'text-destructive';
    }
    if (item.kind === 'final' || item.level === 'success') {
        return 'text-success';
    }
    return 'text-primary';
}

function lifecycleBadgeClass(lifecycle: ReturnType<typeof resolveTaskLifecycle>): string {
    if (lifecycle === 'success') return 'bg-success';
    if (lifecycle === 'failed') return 'bg-destructive';
    if (lifecycle === 'running') return 'bg-primary';
    return 'bg-muted';
}

function mapServerTimelineKind(sourceKind?: string, status?: string): ChatTaskLifecycleItem['kind'] {
    const normalizedStatus = (status || '').trim().toLowerCase();
    if (normalizedStatus.includes('failed') || normalizedStatus.includes('error')) return 'failed';
    if (normalizedStatus.includes('completed') || normalizedStatus.includes('succeeded') || normalizedStatus.includes('sent')) return 'final';
    if (normalizedStatus.includes('anomaly')) return 'anomaly';
    if (normalizedStatus.includes('started') || normalizedStatus.includes('running')) return 'started';
    if ((sourceKind || '').trim().toLowerCase() === 'delivery_attempt') return 'progress';
    return 'created';
}

function mapServerTimeline(timeline?: TaskDetailsTask['timeline']): ChatTaskLifecycleItem[] {
    return (timeline || [])
        .map((item) => ({
            id: item.id,
            kind: mapServerTimelineKind(item.sourceKind, item.status),
            title: item.summary,
            detail: item.summary,
            at: item.createdAt,
            level: item.status?.includes('failed') || item.status?.includes('error')
                ? 'error'
                : item.status?.includes('completed') || item.status?.includes('succeeded') || item.status?.includes('sent')
                    ? 'success'
                    : 'info',
        } satisfies ChatTaskLifecycleItem))
        .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

function buildFallbackTask(card: ChatTaskCardData, sourceMessageId?: string | null): TaskDetailsTask {
    return {
        id: card.taskId || sourceMessageId || `chat_task_${card.createdAt}`,
        name: card.taskName || '聊天异步任务',
        jobType: taskKindLabel(card.taskKind),
        enabled: card.stage !== 'cancelled',
        agentId: card.agentId,
        agentName: card.executorAgentName || card.reportActorName || '当前智能体',
        createdAt: card.createdAt,
        maxRuns: card.maxRuns,
        runInfo: {
            lastStatus: card.lastStatus,
            runCount: card.runCount,
        },
    };
}

function resolveTaskDetailsModel(
    task: TaskDetailsTask | null,
    runs: readonly TaskDetailsRun[],
    finalSummary: TaskFinalSummary | undefined,
    chatTaskCard?: ChatTaskCardData | null,
    sourceMessageId?: string | null,
): TaskDetailsResolved | null {
    const resolvedTask = task ?? (chatTaskCard ? buildFallbackTask(chatTaskCard, sourceMessageId) : null);
    if (!resolvedTask) {
        return null;
    }
    const runCountFromTask = Number.isFinite(resolvedTask.runInfo.runCount)
        ? Number(resolvedTask.runInfo.runCount)
        : 0;
    const runCount = Math.max(runCountFromTask, runs.length);
    const lifecycle = resolveTaskLifecycle({
        enabled: resolvedTask.enabled,
        runtimeState: resolvedTask.runtimeState,
        maxRuns: resolvedTask.maxRuns,
        runInfo: {
            lastStatus: resolvedTask.runInfo.lastStatus,
            runCount,
        },
    });
    const timeline = resolvedTask.timeline?.length
        ? mapServerTimeline(resolvedTask.timeline)
        : (chatTaskCard?.timeline ?? []).slice().sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
    const timelineFinal = timeline.find((item) => item.kind === 'final');
    const resolvedFinalSummary = finalSummary ?? resolvedTask.finalSummary ?? null;
    const finalSummaryText = (
        resolvedFinalSummary?.content
        || chatTaskCard?.finalSummaryText
        || timelineFinal?.detail
        || ''
    ).trim();
    const finalSummaryCreatedAt = resolvedFinalSummary?.createdAt || timelineFinal?.at || chatTaskCard?.latestReportAt;
    const finalSummaryRunCount = resolvedFinalSummary?.runCount ?? timelineFinal?.runCount ?? chatTaskCard?.runCount ?? 0;
    const fallbackAnomaly = chatTaskCard?.errorSummary?.trim()
        ? [{
            id: `${chatTaskCard.taskId || sourceMessageId || 'chat-task'}:latest-anomaly`,
            kind: 'anomaly',
            title: '最近异常摘要',
            detail: chatTaskCard.errorSummary.trim(),
            at: chatTaskCard.latestReportAt || chatTaskCard.updatedAt,
            level: 'error',
        } satisfies ChatTaskLifecycleItem]
        : [];
    const anomalyTimeline = timeline.filter((item) => item.kind === 'anomaly' || item.kind === 'failed');
    const processTimeline = timeline.filter((item) => item.kind !== 'anomaly' && item.kind !== 'failed' && item.kind !== 'final');
    return {
        task: resolvedTask,
        lifecycle,
        runCount,
        timeline,
        processTimeline,
        anomalyTimeline: anomalyTimeline.length > 0 ? anomalyTimeline : fallbackAnomaly,
        finalSummary: resolvedFinalSummary,
        finalSummaryText,
        finalSummaryCreatedAt,
        finalSummaryRunCount,
    };
}

async function copyText(value: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        // ignore
    }
}

function TaskHeader({
    task,
    lifecycle,
    showDivider = false,
}: {
    task: TaskDetailsTask;
    lifecycle: ReturnType<typeof resolveTaskLifecycle>;
    showDivider?: boolean;
}) {
    return (
        <div className={cn('p-5 pb-3', showDivider ? 'border-b border-border/50 bg-background/60' : '')}>
            <div className="flex items-center gap-2 mb-1">
                <Badge variant="secondary" className="rounded-full text-[10px] uppercase">
                    {task.jobType}
                </Badge>
                <Badge variant="outline" className="rounded-full text-[10px] font-mono">
                    {task.id}
                </Badge>
                <Badge className={cn('rounded-full text-[10px] px-2', lifecycleBadgeClass(lifecycle))}>
                    {taskLifecycleLabel(lifecycle)}
                </Badge>
            </div>
            <div className="text-xl font-bold truncate">{task.name}</div>
        </div>
    );
}

function OverviewCard({
    label,
    value,
    className,
}: {
    label: string;
    value: string;
    className?: string;
}) {
    return (
        <div className={cn('p-3 border border-border/50 rounded-lg bg-muted/20 space-y-1', className)}>
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <p className="text-xs font-semibold leading-5 whitespace-pre-wrap break-words">{value || '-'}</p>
        </div>
    );
}

function TimelineList({
    title,
    items,
    emptyText,
    icon,
}: {
    title: string;
    items: readonly ChatTaskLifecycleItem[];
    emptyText: string;
    icon: React.ComponentType<{ className?: string }>;
}) {
    const Icon = icon;
    return (
        <div className="space-y-3">
            <h4 className="font-semibold text-sm flex items-center gap-2">
                <Icon className="w-5 h-5 text-primary" />
                {title}
            </h4>
            {items.length === 0 ? (
                <div className="p-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                    {emptyText}
                </div>
            ) : (
                <div className="space-y-2">
                    {items.map((item) => (
                        <div key={item.id} className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className={cn('text-xs font-semibold', taskTimelineClass(item))}>
                                        {taskTimelineLabel(item.kind)} · {item.title}
                                    </p>
                                    {typeof item.runCount === 'number' ? (
                                        <p className="text-[10px] text-muted-foreground mt-1">run={item.runCount}</p>
                                    ) : null}
                                </div>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                    {formatTimeDisplay(item.at)}
                                </span>
                            </div>
                            {item.detail ? (
                                <div className="mt-2 text-[11px] whitespace-pre-wrap break-words leading-relaxed text-foreground/85">
                                    {item.detail}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function RunHistorySection({
    runs,
    runCount,
    title,
    emptyText,
}: {
    runs: readonly TaskDetailsRun[];
    runCount: number;
    title: string;
    emptyText: string;
}) {
    return (
        <div className="space-y-3">
            <h4 className="font-semibold text-sm flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                {title}
            </h4>
            {runCount > runs.length ? (
                <p className="text-[11px] text-muted-foreground">
                    已执行 {runCount} 次，当前已保存 {runs.length} 条历史日志。
                </p>
            ) : null}
            <div className="space-y-2">
                {runs.length === 0 ? (
                    <div className="p-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                        {emptyText}
                    </div>
                ) : (
                    runs.map((run) => {
                        const runStatus = normalizeRunStatus(run.status);
                        return (
                            <div key={run.id} className="group p-3 bg-card rounded-lg border border-border/60">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        {runStatus === 'ok' ? (
                                            <CheckCircle2 className="w-4 h-4 text-success" />
                                        ) : runStatus === 'running' ? (
                                            <RefreshCcw className="w-4 h-4 text-primary animate-spin" />
                                        ) : runStatus === 'idle' ? (
                                            <Clock className="w-4 h-4 text-muted-foreground" />
                                        ) : (
                                            <AlertCircle className="w-4 h-4 text-destructive" />
                                        )}
                                        <span className="text-xs font-black">{formatTimeDisplay(run.startTime)}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {formatDuration(run.startTime, run.endTime)}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 px-2 text-[10px] rounded-md text-primary gap-1"
                                            onClick={() => void copyText(run.output || '')}
                                        >
                                            <FileText className="w-3 h-3" /> 复制
                                        </Button>
                                    </div>
                                </div>
                                <ScrollArea className="max-h-48 rounded-md border border-border/50 bg-muted/20 p-2">
                                    <pre className="font-mono text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
                                        {run.output}
                                    </pre>
                                </ScrollArea>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

function TaskDetailsContent({
    model,
    runs,
    chatTaskCard,
    sourceMessageId,
}: {
    model: TaskDetailsResolved;
    runs: readonly TaskDetailsRun[];
    chatTaskCard?: ChatTaskCardData | null;
    sourceMessageId?: string | null;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { task, lifecycle, runCount, processTimeline, anomalyTimeline, finalSummaryText, finalSummaryCreatedAt, finalSummaryRunCount } = model;
    return (
        <ScrollArea className="flex-1 px-5 pb-5">
            <div className="space-y-5 py-2">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <OverviewCard label={t('tasks.list.id')} value={task.id} />
                    <OverviewCard label={t('tasks.details.status')} value={taskLifecycleLabel(lifecycle)} />
                    <OverviewCard
                        label={t('tasks.list.loopLimit')}
                        value={task.maxRuns && task.maxRuns > 0 ? `${runCount} / ${task.maxRuns}` : t('tasks.list.infinite')}
                    />
                    <OverviewCard label={t('tasks.list.createdAt')} value={formatDateDisplay(task.createdAt)} />
                </div>

                <div className="p-3 border border-border/50 rounded-lg bg-muted/20">
                    <p className="text-[10px] text-muted-foreground mb-2">执行智能体</p>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                            <AgentAvatar
                                name={task.agentName || task.teamId || 'Agent'}
                                avatarUrl={task.agentAvatarUrl}
                                color={task.agentColor}
                                size="sm"
                            />
                            <div className="min-w-0">
                                <p className="text-xs font-semibold truncate">{task.agentName || task.teamId || '-'}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{task.agentId || task.teamId || '-'}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-[10px] gap-1"
                                disabled={!task.agentId}
                                onClick={() => {
                                    if (!task.agentId) return;
                                    navigate(`/chat/${encodeURIComponent(task.agentId)}`);
                                }}
                            >
                                <MessageSquare className="w-3 h-3" />
                                聊天
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-[10px] gap-1"
                                disabled={!task.agentId}
                                onClick={() => {
                                    if (!task.agentId) return;
                                    navigate(`/edit/${encodeURIComponent(task.agentId)}`);
                                }}
                            >
                                <Settings2 className="w-3 h-3" />
                                编辑
                            </Button>
                        </div>
                    </div>
                </div>

                {chatTaskCard ? (
                    <div className="p-3 border border-border/50 rounded-lg bg-muted/20 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <h4 className="font-semibold text-sm flex items-center gap-2">
                                <MessageSquare className="w-4 h-4 text-primary" />
                                闭环总览
                            </h4>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="rounded-full text-[10px]">
                                    {taskStageLabel(chatTaskCard.stage)}
                                </Badge>
                                <Badge variant="outline" className="rounded-full text-[10px]">
                                    {taskReportStatusLabel(chatTaskCard.reportStatus)}
                                </Badge>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <OverviewCard label="任务类型" value={taskKindLabel(chatTaskCard.taskKind)} />
                            <OverviewCard
                                label="执行进度"
                                value={chatTaskCard.maxRuns > 0
                                    ? `${chatTaskCard.runCount}/${chatTaskCard.maxRuns}${typeof chatTaskCard.progressPercent === 'number' ? ` · ${chatTaskCard.progressPercent}%` : ''}`
                                    : `${chatTaskCard.runCount} 次`}
                            />
                            <OverviewCard label="调度计划" value={chatTaskCard.scheduleText || '-'} />
                            <OverviewCard label="最近汇报" value={chatTaskCard.latestReportAt ? formatTimeDisplay(chatTaskCard.latestReportAt) : '-'} />
                            <OverviewCard label="当前会话" value={chatTaskCard.bindingSessionId || '-'} />
                            <OverviewCard label="来源消息" value={chatTaskCard.bindingSourceMessageId || sourceMessageId || '-'} />
                        </div>
                        <div className="rounded-lg border border-border/60 bg-card p-3">
                            <p className="text-[10px] text-muted-foreground mb-1">任务目标</p>
                            <div className="text-xs leading-6 whitespace-pre-wrap break-words">
                                {chatTaskCard.objective || '-'}
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-primary" />
                        最终总结
                    </h4>
                    {finalSummaryText ? (
                        <div className="p-3 bg-card rounded-lg border border-border/60 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] text-muted-foreground">
                                    {finalSummaryCreatedAt ? `生成时间：${formatTimeDisplay(finalSummaryCreatedAt)}` : '生成时间：-'}
                                </p>
                                <Badge variant="secondary" className="text-[10px] rounded-full">
                                    run={finalSummaryRunCount}
                                </Badge>
                            </div>
                            <ScrollArea className="max-h-48 rounded-md border border-border/50 bg-muted/20 p-2">
                                <pre className="font-mono text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
                                    {finalSummaryText}
                                </pre>
                            </ScrollArea>
                        </div>
                    ) : (
                        <div className="p-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                            暂无最终总结。任务完成后会自动生成并在此处展示。
                        </div>
                    )}
                </div>

                <TimelineList
                    title={`异常汇报${anomalyTimeline.length > 0 ? `（${anomalyTimeline.length}）` : ''}`}
                    items={anomalyTimeline}
                    emptyText="当前没有异常汇报。若执行过程中出现错误或异常，会在这里聚合展示。"
                    icon={AlertCircle}
                />

                <TimelineList
                    title={`过程记录${processTimeline.length > 0 ? `（${processTimeline.length}）` : ''}`}
                    items={processTimeline}
                    emptyText="当前还没有过程记录。任务启动、进度推进和取消等事件会按时间写入这里。"
                    icon={RefreshCcw}
                />

                <RunHistorySection
                    runs={runs}
                    runCount={runCount}
                    title={t('tasks.details.history')}
                    emptyText={t('tasks.details.historyEmpty')}
                />
            </div>
        </ScrollArea>
    );
}

export function TaskDetailsDialog({
    open,
    onOpenChange,
    task,
    runs,
    finalSummary,
    chatTaskCard,
    sourceMessageId,
}: TaskDetailsDialogProps) {
    const { t } = useTranslation();
    const model = resolveTaskDetailsModel(task, runs, finalSummary, chatTaskCard, sourceMessageId);
    if (!model) return null;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col p-0 rounded-2xl border border-border/60">
                <DialogHeader className="sr-only">
                    <DialogTitle>{model.task.name}</DialogTitle>
                </DialogHeader>
                <TaskHeader task={model.task} lifecycle={model.lifecycle} />
                <TaskDetailsContent
                    model={model}
                    runs={runs}
                    chatTaskCard={chatTaskCard}
                    sourceMessageId={sourceMessageId}
                />
                <DialogFooter className="p-4 pt-2 bg-muted/10">
                    <DialogClose asChild>
                        <Button className="rounded-full px-6">{t('common.ok')}</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function TaskDetailsPanel({
    task,
    runs,
    finalSummary,
    chatTaskCard,
    sourceMessageId,
    showHeader = true,
    className,
}: TaskDetailsPanelProps) {
    const model = resolveTaskDetailsModel(task, runs, finalSummary, chatTaskCard, sourceMessageId);
    if (!model) return null;
    return (
        <div className={cn('h-full max-h-full overflow-hidden flex flex-col', className)}>
            {showHeader ? <TaskHeader task={model.task} lifecycle={model.lifecycle} showDivider /> : null}
            <TaskDetailsContent
                model={model}
                runs={runs}
                chatTaskCard={chatTaskCard}
                sourceMessageId={sourceMessageId}
            />
        </div>
    );
}
