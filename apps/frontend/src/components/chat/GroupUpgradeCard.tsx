import { useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface GroupUpgradeMember {
  id?: string;
  name?: string;
  role?: string;
  description?: string;
}

export interface GroupUpgradeCardProps {
  title?: string;
  reason?: string;
  description?: string;
  note?: string;
  groupName?: string;
  leaderAgentId?: string;
  memberAgentIds?: string[];
  members?: GroupUpgradeMember[];
  tags?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  confirmAction?: string;
  cancelAction?: string;
  disabledAfterSubmit?: boolean;
  __onAction?: (actionId: string, payload?: unknown) => void;
}

function normalizeMemberIds(props: GroupUpgradeCardProps): string[] {
  const direct = Array.isArray(props.memberAgentIds)
    ? props.memberAgentIds
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
  const fromMembers = Array.isArray(props.members)
    ? props.members
      .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
      .filter(Boolean)
    : [];
  const merged = [...direct, ...fromMembers];
  return [...new Set(merged)];
}

function buildPayload(props: GroupUpgradeCardProps) {
  const memberAgentIds = normalizeMemberIds(props);
  return {
    groupName: typeof props.groupName === 'string' ? props.groupName.trim() : undefined,
    reason: typeof props.reason === 'string' ? props.reason.trim() : undefined,
    description: typeof props.description === 'string' ? props.description.trim() : undefined,
    leaderAgentId: typeof props.leaderAgentId === 'string' ? props.leaderAgentId.trim() : undefined,
    memberAgentIds,
    members: Array.isArray(props.members) ? props.members : undefined,
    tags: Array.isArray(props.tags) ? props.tags : undefined,
  };
}

function buildMemberBadges(props: GroupUpgradeCardProps): GroupUpgradeMember[] {
  if (Array.isArray(props.members) && props.members.length > 0) {
    return props.members;
  }
  if (Array.isArray(props.memberAgentIds)) {
    return props.memberAgentIds.map((id) => ({ id }));
  }
  return [];
}

export function GenUIGroupUpgradeCard(ctx: unknown) {
  const props = (ctx && typeof ctx === 'object' && 'props' in ctx && typeof (ctx as { props?: unknown }).props === 'object')
    ? ((ctx as { props: GroupUpgradeCardProps }).props)
    : {} as GroupUpgradeCardProps;
  const onAction = typeof props.__onAction === 'function' ? props.__onAction : undefined;
  const confirmAction = typeof props.confirmAction === 'string' && props.confirmAction.trim()
    ? props.confirmAction.trim()
    : 'confirm_group_upgrade';
  const cancelAction = typeof props.cancelAction === 'string' && props.cancelAction.trim()
    ? props.cancelAction.trim()
    : 'cancel_group_upgrade';
  const confirmLabel = typeof props.confirmLabel === 'string' && props.confirmLabel.trim()
    ? props.confirmLabel.trim()
    : '同意拉群';
  const cancelLabel = typeof props.cancelLabel === 'string' && props.cancelLabel.trim()
    ? props.cancelLabel.trim()
    : '暂不需要';
  const disabledAfterSubmit = props.disabledAfterSubmit !== false;
  const [status, setStatus] = useState<'idle' | 'confirmed' | 'cancelled'>('idle');

  const members = useMemo(() => buildMemberBadges(props), [props]);
  const memberCount = members.length;
  const reason = (props.reason || props.description || '').trim();
  const note = (props.note || '').trim();
  const groupName = (props.groupName || '').trim();

  const handleConfirm = () => {
    if (disabledAfterSubmit && status !== 'idle') return;
    setStatus('confirmed');
    onAction?.(confirmAction, buildPayload(props));
  };

  const handleCancel = () => {
    if (disabledAfterSubmit && status !== 'idle') return;
    setStatus('cancelled');
    onAction?.(cancelAction, buildPayload(props));
  };

  return (
    <Card className="mt-2 border-border/60 bg-card/60 shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{props.title || '建议升级为临时群聊'}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">需用户确认</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-sm">
        {reason ? <div className="text-foreground/85 whitespace-pre-wrap">{reason}</div> : null}
        {groupName ? (
          <div className="text-xs text-muted-foreground">
            建议群名称：<span className="font-semibold text-foreground">{groupName}</span>
          </div>
        ) : null}
        {memberCount > 0 ? (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">拟邀请成员：</div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((member, index) => (
                <Badge key={`${member.id || member.name || 'member'}-${index}`} variant="secondary" className="text-[10px]">
                  {member.name || member.id || '未知成员'}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">未提供成员列表，请在确认前补充。</div>
        )}
        {note ? <div className="text-xs text-muted-foreground whitespace-pre-wrap">{note}</div> : null}
      </CardContent>
      <CardFooter className="pt-0 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabledAfterSubmit && status !== 'idle'}
          onClick={handleConfirm}
        >
          {status === 'confirmed' && disabledAfterSubmit ? '已同意' : confirmLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabledAfterSubmit && status !== 'idle'}
          onClick={handleCancel}
        >
          {status === 'cancelled' && disabledAfterSubmit ? '已拒绝' : cancelLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}
