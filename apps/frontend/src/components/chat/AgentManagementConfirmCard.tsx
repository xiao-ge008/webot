import { useMemo, useState } from 'react';
import { Bot, FolderLock, ShieldAlert, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

interface AgentManagementConfirmCardProps {
  mode?: 'create' | 'update' | 'delete';
  title?: string;
  description?: string;
  agentId?: string;
  targetName?: string;
  englishName?: string;
  nickname?: string;
  tags?: string[];
  workspaces?: string[];
  deleteMode?: 'purge' | 'local_only';
  summaryItems?: string[];
  payload?: unknown;
  confirmAction?: string;
  cancelAction?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  disabledAfterSubmit?: boolean;
  __onAction?: (actionId: string, payload?: unknown) => void;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function resolveModeLabel(mode: string): string {
  if (mode === 'update') return '修改';
  if (mode === 'delete') return '删除';
  return '创建';
}

function resolveDefaultTitle(mode: string): string {
  if (mode === 'update') return '确认修改智能体';
  if (mode === 'delete') return '确认删除智能体';
  return '确认创建智能体';
}

function resolveDefaultConfirmLabel(mode: string): string {
  if (mode === 'update') return '确认修改';
  if (mode === 'delete') return '确认删除';
  return '确认创建';
}

export function GenUIAgentManagementConfirmCard(ctx: unknown) {
  const props = (ctx && typeof ctx === 'object' && 'props' in ctx && typeof (ctx as { props?: unknown }).props === 'object')
    ? (ctx as { props: AgentManagementConfirmCardProps }).props
    : {} as AgentManagementConfirmCardProps;
  const onAction = typeof props.__onAction === 'function' ? props.__onAction : undefined;
  const mode = normalizeText(props.mode) || 'create';
  const disabledAfterSubmit = props.disabledAfterSubmit !== false;
  const confirmAction = normalizeText(props.confirmAction) || 'confirm_agent_management';
  const cancelAction = normalizeText(props.cancelAction) || 'cancel_agent_management';
  const confirmLabel = normalizeText(props.confirmLabel) || resolveDefaultConfirmLabel(mode);
  const cancelLabel = normalizeText(props.cancelLabel) || '取消';
  const [status, setStatus] = useState<'idle' | 'confirmed' | 'cancelled'>('idle');

  const summaryItems = useMemo(() => {
    const explicit = normalizeStringArray(props.summaryItems);
    if (explicit.length > 0) {
      return explicit;
    }
    const next: string[] = [];
    const displayName = normalizeText(props.nickname) || normalizeText(props.targetName);
    const englishName = normalizeText(props.englishName);
    const agentId = normalizeText(props.agentId);
    const tags = normalizeStringArray(props.tags);
    const workspaces = normalizeStringArray(props.workspaces);
    if (displayName) next.push(`名称：${displayName}`);
    if (englishName) next.push(`英文名：${englishName}`);
    if (agentId) next.push(`目标 ID：${agentId}`);
    if (tags.length > 0) next.push(`标签：${tags.join(' / ')}`);
    if (workspaces.length > 0) next.push(`工作区：${workspaces.join('；')}`);
    if (mode === 'delete') {
      next.push(`删除模式：${normalizeText(props.deleteMode) === 'local_only' ? '仅本地移除' : '彻底删除'}`);
    }
    return next;
  }, [mode, props.agentId, props.deleteMode, props.englishName, props.nickname, props.summaryItems, props.tags, props.targetName, props.workspaces]);

  const handleConfirm = () => {
    if (disabledAfterSubmit && status !== 'idle') return;
    setStatus('confirmed');
    onAction?.(confirmAction, props.payload ?? props);
  };

  const handleCancel = () => {
    if (disabledAfterSubmit && status !== 'idle') return;
    setStatus('cancelled');
    onAction?.(cancelAction, props.payload ?? props);
  };

  const danger = mode === 'delete';

  return (
    <Card className="mt-2 overflow-hidden border-border/60 bg-card/75 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${danger ? 'bg-destructive/12 text-destructive' : 'bg-amber-500/12 text-amber-600'}`}>
              {danger ? <ShieldAlert className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm">{normalizeText(props.title) || resolveDefaultTitle(mode)}</CardTitle>
              {normalizeText(props.description) ? (
                <div className="mt-1 text-xs leading-5 text-muted-foreground whitespace-pre-wrap">
                  {normalizeText(props.description)}
                </div>
              ) : null}
            </div>
          </div>
          <Badge variant={danger ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
            {resolveModeLabel(mode)}操作
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-sm">
        <div className="grid gap-2 rounded-2xl border border-border/50 bg-background/60 p-3">
          {summaryItems.map((item, index) => (
            <div key={`${item}-${index}`} className="flex items-start gap-2 text-[13px] leading-5 text-foreground/90">
              <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="break-words">{item}</span>
            </div>
          ))}
        </div>
        {normalizeStringArray(props.workspaces).length > 0 ? (
          <div className="flex items-start gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <FolderLock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>确认后将同步写入工作区权限，并生成基础人格文件。</span>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex items-center gap-2 pt-0">
        <Button size="sm" variant={danger ? 'destructive' : 'default'} disabled={disabledAfterSubmit && status !== 'idle'} onClick={handleConfirm}>
          {status === 'confirmed' && disabledAfterSubmit ? '已确认' : confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={disabledAfterSubmit && status !== 'idle'} onClick={handleCancel}>
          {status === 'cancelled' && disabledAfterSubmit ? '已取消' : cancelLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}
