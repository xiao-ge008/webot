import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { A2AWorkCardData } from '@/types/a2a';
import { CheckCircle2, CircleDashed, Loader2, MessageSquare, TerminalSquare, XCircle } from 'lucide-react';

interface A2AWorkDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: A2AWorkCardData | null;
}

function formatStatus(status: A2AWorkCardData['status']): string {
  if (status === 'working') return '工作中';
  if (status === 'completed') return '已完成';
  return '失败';
}

function statusClass(status: A2AWorkCardData['status']): string {
  if (status === 'working') return 'border border-amber-200 bg-amber-100 text-amber-700';
  if (status === 'completed') return 'border border-emerald-200 bg-emerald-100 text-emerald-700';
  return 'border border-rose-200 bg-rose-100 text-rose-700';
}

function formatTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function eventLabel(kind?: A2AWorkCardData['latestEventKind']): string {
  if (kind === 'started') return '已启动';
  if (kind === 'final') return '最终汇报';
  if (kind === 'failed') return '执行失败';
  return '进度回传';
}

function eventClass(card: A2AWorkCardData): string {
  if (card.status === 'failed' || card.latestEventKind === 'failed') return 'text-rose-600';
  if (card.status === 'completed' || card.latestEventKind === 'final') return 'text-emerald-600';
  return 'text-primary';
}

function pickLatestDetail(card: A2AWorkCardData): string {
  return (card.finalReportText || card.logs[card.logs.length - 1]?.detail || card.summary || '').trim();
}

export function A2AWorkDetailsDialog({ open, onOpenChange, card }: A2AWorkDetailsDialogProps) {
  if (!card) return null;
  const finalLog = card.logs.length > 0 ? card.logs[card.logs.length - 1] : null;
  const latestDetail = pickLatestDetail(card);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0 rounded-2xl border border-border/60 bg-background">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          <div className="space-y-3">
            <div className="rounded-xl border border-border/60 bg-muted/15 px-3 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <AgentAvatar
                    name={card.agentName}
                    avatarUrl={card.agentAvatarUrl}
                    color={card.agentColor}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{card.agentName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{card.agentId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {card.status === 'working' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" /> : null}
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', statusClass(card.status))}>
                    {formatStatus(card.status)}
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-muted-foreground sm:grid-cols-3">
                <div><span className="font-medium">开始：</span>{formatTime(card.startedAt)}</div>
                <div><span className="font-medium">结束：</span>{formatTime(card.finishedAt)}</div>
                <div><span className="font-medium">说明：</span>{card.summary || (card.status === 'working' ? '工作中' : formatStatus(card.status))}</div>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/15 px-3 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  当前会话绑定
                </p>
                <span className={cn('text-xs font-semibold', eventClass(card))}>
                  {eventLabel(card.latestEventKind)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-xs leading-6 text-muted-foreground sm:grid-cols-2">
                <div><span className="font-medium">绑定会话：</span>{card.bindingSessionId || '-'}</div>
                <div><span className="font-medium">来源消息：</span>{card.bindingSourceMessageId || '-'}</div>
                <div><span className="font-medium">最近事件：</span>{card.latestEventTitle || '-'}</div>
                <div><span className="font-medium">最近时间：</span>{formatTime(card.latestEventAt)}</div>
              </div>
              {card.objective ? (
                <div className="mt-3 rounded-lg border border-border/50 bg-background/80 px-3 py-2.5 text-xs leading-6 text-foreground/85">
                  <span className="font-medium">任务目标：</span>{card.objective}
                </div>
              ) : null}
            </div>

            {card.requestPayloadText ? (
              <div className="rounded-xl border border-border/60 bg-card">
                <div className="px-3 py-3">
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                    <p className="text-xs font-bold truncate flex items-center gap-2">
                      <TerminalSquare className="w-4 h-4 text-primary" />
                      调用请求
                    </p>
                    <p className="text-[10px] text-muted-foreground shrink-0">{formatTime(card.startedAt)}</p>
                  </div>
                  <ScrollArea className="mt-2 max-h-36 rounded-md border border-border/50 bg-muted/20 p-2">
                    <pre className="font-mono text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
                      {card.requestPayloadText}
                    </pre>
                  </ScrollArea>
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-border/60 bg-card">
              {finalLog == null ? (
                <div className="p-3 text-xs text-muted-foreground">
                  暂无结果
                </div>
              ) : (
                <div key={finalLog.id} className="px-3 py-3">
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                    <p className="text-xs font-bold truncate">最终结果</p>
                    <p className="text-[10px] text-muted-foreground shrink-0">{formatTime(finalLog.at)}</p>
                  </div>
                  <div className="mt-2 max-h-[48vh] overflow-y-auto rounded-md bg-muted/20 px-3 py-2.5 text-[13px] leading-7 text-foreground whitespace-pre-wrap break-words">
                    {finalLog.detail || '暂无结果'}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border/60 bg-card">
              <div className="px-3 py-3">
                <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                  <p className="text-xs font-bold truncate">执行时间线</p>
                  <p className="text-[10px] text-muted-foreground shrink-0">{card.logs.length} 条</p>
                </div>
                {card.logs.length === 0 ? (
                  <div className="pt-3 text-xs text-muted-foreground">暂无调用日志</div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {[...card.logs].reverse().map((log) => {
                      const icon = log.title.includes('失败')
                        ? <XCircle className="h-4 w-4 text-rose-500" />
                        : log.title.includes('最终')
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          : log.title.includes('开始')
                            ? <CircleDashed className="h-4 w-4 text-primary" />
                            : <Loader2 className="h-4 w-4 text-primary" />;
                      return (
                        <div key={log.id} className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2">
                              {icon}
                              <p className="truncate text-xs font-semibold">{log.title}</p>
                            </div>
                            <span className="shrink-0 text-[10px] text-muted-foreground">{formatTime(log.at)}</span>
                          </div>
                          {log.detail ? (
                            <div className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-6 text-foreground/80">
                              {log.detail}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {latestDetail && !finalLog?.detail ? (
              <div className="rounded-xl border border-border/60 bg-card px-3 py-3 text-[12px] leading-6 text-foreground/85">
                <span className="font-semibold">最近回执：</span>{latestDetail}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-border/50 bg-background/95 px-4 py-3">
          <DialogClose asChild>
            <Button variant="outline" className="rounded-full px-6">关闭</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
