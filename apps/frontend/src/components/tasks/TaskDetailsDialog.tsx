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
    agentId?: string;
    teamId?: string;
    agentName?: string;
    agentAvatarUrl?: string;
    agentColor?: string;
    createdAt?: string;
    maxRuns?: number;
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
    if (status === 'reported') return '已生成聊天回执';
    return '待汇报';
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
    const navigate = useNavigate();

    const resolvedTask = task ?? (chatTaskCard ? buildFallbackTask(chatTaskCard, sourceMessageId) : null);
    if (!resolvedTask) return null;

    const runCountFromTask = Number.isFinite(resolvedTask.runInfo.runCount) ? Number(resolvedTask.runInfo.runCount) : 0;
    const runCount = Math.max(runCountFromTask, runs.length);
    const lifecycle = resolveTaskLifecycle({
        enabled: resolvedTask.enabled,
        maxRuns: resolvedTask.maxRuns,
        runInfo: {
            lastStatus: resolvedTask.runInfo.lastStatus,
            runCount,
        },
    });

    const finalSummaryText = (finalSummary?.content || chatTaskCard?.finalSummaryText || '').trim();
    const finalSummaryCreatedAt = finalSummary?.createdAt || chatTaskCard?.latestReportAt;
    const finalSummaryRunCount = finalSummary?.runCount ?? chatTaskCard?.runCount ?? 0;
    const timeline = (chatTaskCard?.timeline ?? []).slice().sort((left, right) => Date.parse(right.at) - Date.parse(left.at));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col p-0 rounded-2xl border border-border/60">
                <DialogHeader className="p-5 pb-3">
                    <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="rounded-full text-[10px] uppercase">
                            {resolvedTask.jobType}
                        </Badge>
                        <Badge variant="outline" className="rounded-full text-[10px] font-mono">
                            {resolvedTask.id}
                        </Badge>
                    </div>
                    <DialogTitle className="text-xl font-bold">{resolvedTask.name}</DialogTitle>
                </DialogHeader>

                <ScrollArea className="flex-1 px-5 pb-5">
                    <div className="space-y-5 py-2">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div className="p-3 border border-border/50 rounded-lg bg-muted/20 space-y-1">
                                <p className="text-[10px] text-muted-foreground">{t('tasks.list.id')}</p>
                                <p className="text-xs font-mono truncate">{resolvedTask.id}</p>
                            </div>
                            <div className="p-3 border border-border/50 rounded-lg bg-muted/20 space-y-1">
                                <p className="text-[10px] text-muted-foreground">{t('tasks.details.status')}</p>
                                <Badge
                                    className={cn(
                                        'rounded-full text-[10px] px-2',
                                        lifecycle === 'success'
                                            ? 'bg-success'
                                            : lifecycle === 'failed'
                                                ? 'bg-destructive'
                                                : lifecycle === 'running'
                                                    ? 'bg-primary'
                                                    : 'bg-muted',
                                    )}
                                >
                                    {taskLifecycleLabel(lifecycle)}
                                </Badge>
                            </div>
                            <div className="p-3 border border-border/50 rounded-lg bg-muted/20 space-y-1">
                                <p className="text-[10px] text-muted-foreground">{t('tasks.list.loopLimit')}</p>
                                <p className="text-xs font-semibold truncate">
                                    {resolvedTask.maxRuns && resolvedTask.maxRuns > 0 ? `${runCount} / ${resolvedTask.maxRuns}` : t('tasks.list.infinite')}
                                </p>
                            </div>
                            <div className="p-3 border border-border/50 rounded-lg bg-muted/20 space-y-1">
                                <p className="text-[10px] text-muted-foreground">{t('tasks.list.createdAt')}</p>
                                <p className="text-xs font-semibold truncate">{formatDateDisplay(resolvedTask.createdAt)}</p>
                            </div>
                        </div>

                        <div className="p-3 border border-border/50 rounded-lg bg-muted/20">
                            <p className="text-[10px] text-muted-foreground mb-2">执行智能体</p>
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <AgentAvatar
                                        name={resolvedTask.agentName || resolvedTask.teamId || 'Agent'}
                                        avatarUrl={resolvedTask.agentAvatarUrl}
                                        color={resolvedTask.agentColor}
                                        size="sm"
                                    />
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold truncate">{resolvedTask.agentName || resolvedTask.teamId || '-'}</p>
                                        <p className="text-[10px] text-muted-foreground truncate">{resolvedTask.agentId || resolvedTask.teamId || '-'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2.5 text-[10px] gap-1"
                                        disabled={!resolvedTask.agentId}
                                        onClick={() => {
                                            if (!resolvedTask.agentId) return;
                                            navigate(`/chat/${encodeURIComponent(resolvedTask.agentId)}`);
                                        }}
                                    >
                                        <MessageSquare className="w-3 h-3" />
                                        聊天
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2.5 text-[10px] gap-1"
                                        disabled={!resolvedTask.agentId}
                                        onClick={() => {
                                            if (!resolvedTask.agentId) return;
                                            navigate(`/edit/${encodeURIComponent(resolvedTask.agentId)}`);
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
                                        <RefreshCcw className="w-4 h-4 text-primary" />
                                        会话闭环
                                    </h4>
                                    <Badge variant="outline" className="rounded-full text-[10px]">
                                        {taskReportStatusLabel(chatTaskCard.reportStatus)}
                                    </Badge>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs leading-6">
                                    <div><span className="font-semibold">任务类型：</span>{taskKindLabel(chatTaskCard.taskKind)}</div>
                                    <div><span className="font-semibold">调度计划：</span>{chatTaskCard.scheduleText || '-'}</div>
                                    <div><span className="font-semibold">任务目标：</span>{chatTaskCard.objective || '-'}</div>
                                    <div><span className="font-semibold">执行进度：</span>{chatTaskCard.maxRuns > 0 ? `${chatTaskCard.runCount}/${chatTaskCard.maxRuns}` : `${chatTaskCard.runCount} 次`}</div>
                                    <div><span className="font-semibold">当前会话：</span>{chatTaskCard.bindingSessionId || '-'}</div>
                                    <div><span className="font-semibold">来源消息：</span>{chatTaskCard.bindingSourceMessageId || sourceMessageId || '-'}</div>
                                    <div><span className="font-semibold">最近汇报：</span>{chatTaskCard.latestReportAt ? formatTimeDisplay(chatTaskCard.latestReportAt) : '-'}</div>
                                    <div><span className="font-semibold">异常摘要：</span>{chatTaskCard.errorSummary || '-'}</div>
                                </div>
                            </div>
                        ) : null}

                        <div className="space-y-3">
                            <h4 className="font-semibold text-sm flex items-center gap-2">
                                <MessageSquare className="w-5 h-5 text-primary" />
                                最终汇报
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
                                    暂无最终汇报。任务完成后会自动生成并在此处展示。
                                </div>
                            )}
                        </div>

                        {timeline.length > 0 ? (
                            <div className="space-y-3">
                                <h4 className="font-semibold text-sm flex items-center gap-2">
                                    <RefreshCcw className="w-5 h-5 text-primary" />
                                    闭环时间线
                                </h4>
                                <div className="space-y-2">
                                    {timeline.map((item) => (
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
                            </div>
                        ) : null}

                        <div className="space-y-3">
                            <h4 className="font-semibold text-sm flex items-center gap-2">
                                <Clock className="w-5 h-5 text-primary" />
                                {t('tasks.details.history')}
                            </h4>
                            {runCount > runs.length ? (
                                <p className="text-[11px] text-muted-foreground">
                                    已执行 {runCount} 次，当前已保存 {runs.length} 条历史日志。
                                </p>
                            ) : null}
                            <div className="space-y-2">
                                {runs.length === 0 ? (
                                    <div className="p-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                                        {t('tasks.details.historyEmpty')}
                                    </div>
                                ) : (
                                    runs.map((run) => {
                                        const runStatus = normalizeRunStatus(run.status);
                                        return (
                                            <div
                                                key={run.id}
                                                className="group p-3 bg-card rounded-lg border border-border/60"
                                            >
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
                                                            onClick={async () => {
                                                                try {
                                                                    await navigator.clipboard.writeText(run.output || '');
                                                                } catch {
                                                                    // ignore
                                                                }
                                                            }}
                                                        >
                                                            <FileText className="w-3 h-3" /> {t('common.copy')}
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
                    </div>
                </ScrollArea>

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
    const { t } = useTranslation();
    const navigate = useNavigate();

    const resolvedTask = task ?? (chatTaskCard ? buildFallbackTask(chatTaskCard, sourceMessageId) : null);
    if (!resolvedTask) return null;

    const runCountFromTask = Number.isFinite(resolvedTask.runInfo.runCount) ? Number(resolvedTask.runInfo.runCount) : 0;
    const runCount = Math.max(runCountFromTask, runs.length);
    const lifecycle = resolveTaskLifecycle({
        enabled: resolvedTask.enabled,
        maxRuns: resolvedTask.maxRuns,
        runInfo: {
            lastStatus: resolvedTask.runInfo.lastStatus,
            runCount,
        },
    });

    const finalSummaryText = (finalSummary?.content || chatTaskCard?.finalSummaryText || '').trim();
    const finalSummaryCreatedAt = finalSummary?.createdAt || chatTaskCard?.latestReportAt;
    const finalSummaryRunCount = finalSummary?.runCount ?? chatTaskCard?.runCount ?? 0;
    const timeline = (chatTaskCard?.timeline ?? []).slice().sort((left, right) => Date.parse(right.at) - Date.parse(left.at));

    return (
        <div className={cn('h-full max-h-full overflow-hidden flex flex-col', className)}>
            {showHeader ? (
                <div className="p-5 pb-3 border-b border-border/50 bg-background/60">
                    <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="rounded-full text-[10px] uppercase">
                            {resolvedTask.jobType}
                        </Badge>
                        <Badge variant="outline" className="rounded-full text-[10px] font-mono">
                            {resolvedTask.id}
                        </Badge>
                    </div>
                    <div className="text-xl font-bold truncate">{resolvedTask.name}</div>
                </div>
            ) : null}

            <ScrollArea className="flex-1 px-5 pb-5">
                <div className="space-y-5 py-2">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="p-3 border border-border/50 rounded-lg bg-muted/20 space-y-1">
                            <p className="text-[10px] text-muted-foreground">{t('tasks.list.id')}</p>
                            <p className="text-xs font-mono truncate">{resolvedTask.id}</p>
                        </div>
                        <div className="p-3 border border-border/50 rounded-lg bg-muted/20 space-y-1">
                            <p className="text-[10px] text-muted-foreground">{t('tasks.details.status')}</p>
                            <Badge
                                className={cn(
                                    'rounded-full text-[10px] px-2',
                                    lifecycle === 'success'
                                        ? 'bg-success'
                                        : lifecycle === 'failed'
                                            ? 'bg-destructive'
                                            : lifecycle === 'running'
                                                ? 'bg-primary'
                                                : 'bg-muted',
                                )}
                            >
                                {taskLifecycleLabel(lifecycle)}
                            </Badge>
                        </div>
                        <div className="p-3 border border-border/50 rounded-lg bg-muted/20 space-y-1">
                            <p className="text-[10px] text-muted-foreground">{t('tasks.list.loopLimit')}</p>
                            <p className="text-xs font-semibold truncate">
                                {resolvedTask.maxRuns && resolvedTask.maxRuns > 0 ? `${runCount} / ${resolvedTask.maxRuns}` : t('tasks.list.infinite')}
                            </p>
                        </div>
                        <div className="p-3 border border-border/50 rounded-lg bg-muted/20 space-y-1">
                            <p className="text-[10px] text-muted-foreground">{t('tasks.list.createdAt')}</p>
                            <p className="text-xs font-semibold truncate">{formatDateDisplay(resolvedTask.createdAt)}</p>
                        </div>
                    </div>

                    <div className="p-3 border border-border/50 rounded-lg bg-muted/20">
                        <p className="text-[10px] text-muted-foreground mb-2">执行智能体</p>
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <AgentAvatar
                                    name={resolvedTask.agentName || resolvedTask.teamId || 'Agent'}
                                    avatarUrl={resolvedTask.agentAvatarUrl}
                                    color={resolvedTask.agentColor}
                                    size="sm"
                                />
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold truncate">{resolvedTask.agentName || resolvedTask.teamId || '-'}</p>
                                    <p className="text-[10px] text-muted-foreground truncate">{resolvedTask.agentId || resolvedTask.teamId || '-'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2.5 text-[10px] gap-1"
                                    disabled={!resolvedTask.agentId}
                                    onClick={() => {
                                        if (!resolvedTask.agentId) return;
                                        navigate(`/chat/${encodeURIComponent(resolvedTask.agentId)}`);
                                    }}
                                >
                                    <MessageSquare className="w-3 h-3" />
                                    聊天
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2.5 text-[10px] gap-1"
                                    disabled={!resolvedTask.agentId}
                                    onClick={() => {
                                        if (!resolvedTask.agentId) return;
                                        navigate(`/edit/${encodeURIComponent(resolvedTask.agentId)}`);
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
                                    <RefreshCcw className="w-4 h-4 text-primary" />
                                    会话闭环
                                </h4>
                                <Badge variant="outline" className="rounded-full text-[10px]">
                                    {taskReportStatusLabel(chatTaskCard.reportStatus)}
                                </Badge>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs leading-6">
                                <div><span className="font-semibold">任务类型：</span>{taskKindLabel(chatTaskCard.taskKind)}</div>
                                <div><span className="font-semibold">调度计划：</span>{chatTaskCard.scheduleText || '-'}</div>
                                <div><span className="font-semibold">任务目标：</span>{chatTaskCard.objective || '-'}</div>
                                <div><span className="font-semibold">执行进度：</span>{chatTaskCard.maxRuns > 0 ? `${chatTaskCard.runCount}/${chatTaskCard.maxRuns}` : `${chatTaskCard.runCount} 次`}</div>
                                <div><span className="font-semibold">当前会话：</span>{chatTaskCard.bindingSessionId || '-'}</div>
                                <div><span className="font-semibold">来源消息：</span>{chatTaskCard.bindingSourceMessageId || sourceMessageId || '-'}</div>
                                <div><span className="font-semibold">最近汇报：</span>{chatTaskCard.latestReportAt ? formatTimeDisplay(chatTaskCard.latestReportAt) : '-'}</div>
                                <div><span className="font-semibold">异常摘要：</span>{chatTaskCard.errorSummary || '-'}</div>
                            </div>
                        </div>
                    ) : null}

                    <div className="space-y-3">
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                            <MessageSquare className="w-5 h-5 text-primary" />
                            最终汇报
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
                                暂无最终汇报。任务完成后会自动生成并在此处展示。
                            </div>
                        )}
                    </div>

                    {timeline.length > 0 ? (
                        <div className="space-y-3">
                            <h4 className="font-semibold text-sm flex items-center gap-2">
                                <RefreshCcw className="w-5 h-5 text-primary" />
                                闭环时间线
                            </h4>
                            <div className="space-y-2">
                                {timeline.map((item) => (
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
                        </div>
                    ) : null}

                    <div className="space-y-3">
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                            <Clock className="w-5 h-5 text-primary" />
                            {t('tasks.details.history')}
                        </h4>
                        {runCount > runs.length ? (
                            <p className="text-[11px] text-muted-foreground">
                                已执行 {runCount} 次，当前已保存 {runs.length} 条历史日志。
                            </p>
                        ) : null}
                        <div className="space-y-2">
                            {runs.length === 0 ? (
                                <div className="p-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                                    {t('tasks.details.historyEmpty')}
                                </div>
                            ) : (
                                runs.map((run) => {
                                    const runStatus = normalizeRunStatus(run.status);
                                    return (
                                        <div
                                            key={run.id}
                                            className="group p-3 bg-card rounded-lg border border-border/60"
                                        >
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
                                                        onClick={async () => {
                                                            try {
                                                                await navigator.clipboard.writeText(run.output || '');
                                                            } catch {
                                                                // ignore
                                                            }
                                                        }}
                                                    >
                                                        <FileText className="w-3 h-3" /> {t('common.copy')}
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
                </div>
            </ScrollArea>
        </div>
    );
}
