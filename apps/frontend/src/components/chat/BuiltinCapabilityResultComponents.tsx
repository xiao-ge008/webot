import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, FilePenLine, ShieldAlert, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { analyzeSelfUpgradePayload } from '@/components/chat/self-upgrade-guards';

type JsonRecord = Record<string, unknown>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object');
}

function buildRiskLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'high') return '高风险';
  if (normalized === 'low') return '低风险';
  return '中风险';
}

function buildChangeSummary(item: JsonRecord, index: number): string {
  const summary = normalizeText(item.summary);
  if (summary) return summary;
  const kind = normalizeText(item.kind) || normalizeText(item.type);
  const target = normalizeText(item.target);
  if (kind || target) {
    return [kind || `变更 ${index + 1}`, target].filter(Boolean).join(' · ');
  }
  return `变更 ${index + 1}`;
}

interface ReviewResultCardProps {
  title?: string;
  summary?: string;
  targetScope?: string;
  riskLevel?: string;
  reviewId?: string;
  reason?: string;
  requiresConfirmation?: boolean;
  proposedChanges?: unknown;
  confirmAction?: string;
  cancelAction?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  payload?: unknown;
  __onAction?: (actionId: string, payload?: unknown) => void;
}

interface ConfirmResultCardProps {
  title?: string;
  summary?: string;
  description?: string;
  riskLevel?: string;
  confirmAction?: string;
  cancelAction?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  payload?: unknown;
  __onAction?: (actionId: string, payload?: unknown) => void;
}

interface PatchResultCardProps {
  title?: string;
  summary?: string;
  targetScope?: string;
  riskLevel?: string;
  reviewId?: string;
  appliedChanges?: unknown;
}

function ReviewBadge({ riskLevel }: { riskLevel: string }) {
  const normalized = riskLevel.trim().toLowerCase();
  if (normalized === 'high') {
    return <Badge variant="destructive">{buildRiskLabel(riskLevel)}</Badge>;
  }
  if (normalized === 'low') {
    return <Badge variant="secondary">{buildRiskLabel(riskLevel)}</Badge>;
  }
  return <Badge variant="outline">{buildRiskLabel(riskLevel)}</Badge>;
}

export function GenUIReviewResultCard(ctx: unknown) {
  const props = (ctx && typeof ctx === 'object' && 'props' in ctx && typeof (ctx as { props?: unknown }).props === 'object')
    ? (ctx as { props: ReviewResultCardProps }).props
    : {} as ReviewResultCardProps;
  const onAction = typeof props.__onAction === 'function' ? props.__onAction : undefined;
  const [status, setStatus] = useState<'idle' | 'confirmed' | 'cancelled'>('idle');
  const title = normalizeText(props.title) || '升级审查';
  const summary = normalizeText(props.summary) || '当前变更已进入结构化审查阶段。';
  const riskLevel = normalizeText(props.riskLevel) || 'medium';
  const targetScope = normalizeText(props.targetScope);
  const reviewId = normalizeText(props.reviewId);
  const reason = normalizeText(props.reason);
  const requiresConfirmation = props.requiresConfirmation !== false;
  const proposedChanges = useMemo(
    () => normalizeArray(props.proposedChanges).map(buildChangeSummary),
    [props.proposedChanges],
  );
  const upgradeGuard = useMemo(
    () => analyzeSelfUpgradePayload(props.payload),
    [props.payload],
  );
  const confirmDisabled = status !== 'idle' || !upgradeGuard.canConfirm;

  return (
    <Card className="mt-2 overflow-hidden border-border/60 bg-card/80 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600">
              <FilePenLine className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm">{title}</CardTitle>
              <div className="mt-1 text-xs leading-5 text-muted-foreground whitespace-pre-wrap">{summary}</div>
            </div>
          </div>
          <ReviewBadge riskLevel={riskLevel} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap gap-2 text-xs">
          {targetScope ? <Badge variant="outline">范围：{targetScope}</Badge> : null}
          {reviewId ? <Badge variant="outline">Review ID：{reviewId}</Badge> : null}
          <Badge variant={requiresConfirmation ? 'secondary' : 'outline'}>
            {requiresConfirmation ? '需确认' : '可直接执行'}
          </Badge>
        </div>
        {reason ? (
          <div className="rounded-2xl border border-border/50 bg-background/60 px-3 py-2 text-xs leading-5 text-foreground-secondary">
            审查原因：{reason}
          </div>
        ) : null}
        {proposedChanges.length > 0 ? (
          <div className="grid gap-2 rounded-2xl border border-border/50 bg-background/60 p-3">
            {proposedChanges.map((item, index) => (
              <div key={`${item}-${index}`} className="flex items-start gap-2 text-[13px] leading-5 text-foreground/90">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="break-words">{item}</span>
              </div>
            ))}
          </div>
        ) : null}
        {!upgradeGuard.canConfirm ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
            {upgradeGuard.reason}
          </div>
        ) : null}
      </CardContent>
      {requiresConfirmation && onAction ? (
        <CardFooter className="flex items-center gap-2 pt-0">
          <Button
            size="sm"
            disabled={confirmDisabled}
            onClick={() => {
              setStatus('confirmed');
              onAction(props.confirmAction || 'confirm_self_upgrade', props.payload ?? props);
            }}
          >
            {status === 'confirmed' ? '已确认' : normalizeText(props.confirmLabel) || '确认升级'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={status !== 'idle'}
            onClick={() => {
              setStatus('cancelled');
              onAction(props.cancelAction || 'cancel_self_upgrade', props.payload ?? props);
            }}
          >
            {status === 'cancelled' ? '已取消' : normalizeText(props.cancelLabel) || '暂不升级'}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function GenUIConfirmResultCard(ctx: unknown) {
  const props = (ctx && typeof ctx === 'object' && 'props' in ctx && typeof (ctx as { props?: unknown }).props === 'object')
    ? (ctx as { props: ConfirmResultCardProps }).props
    : {} as ConfirmResultCardProps;
  const onAction = typeof props.__onAction === 'function' ? props.__onAction : undefined;
  const [status, setStatus] = useState<'idle' | 'confirmed' | 'cancelled'>('idle');
  const riskLevel = normalizeText(props.riskLevel) || 'medium';
  const upgradeGuard = useMemo(
    () => analyzeSelfUpgradePayload(props.payload),
    [props.payload],
  );
  const confirmDisabled = status !== 'idle' || !upgradeGuard.canConfirm;

  return (
    <Card className="mt-2 overflow-hidden border-border/60 bg-card/78 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm">{normalizeText(props.title) || '等待确认'}</CardTitle>
              <div className="mt-1 text-xs leading-5 text-muted-foreground whitespace-pre-wrap">
                {normalizeText(props.summary) || normalizeText(props.description) || '该操作需要用户确认后才能继续。'}
              </div>
            </div>
          </div>
          <ReviewBadge riskLevel={riskLevel} />
        </div>
      </CardHeader>
      {(normalizeText(props.description) || !upgradeGuard.canConfirm) ? (
        <CardContent className="space-y-3 pt-0">
          {normalizeText(props.description) ? (
            <div className="text-xs leading-5 text-foreground-secondary">
              {normalizeText(props.description)}
            </div>
          ) : null}
          {!upgradeGuard.canConfirm ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
              {upgradeGuard.reason}
            </div>
          ) : null}
        </CardContent>
      ) : null}
      {onAction ? (
        <CardFooter className="flex items-center gap-2 pt-0">
          <Button
            size="sm"
            disabled={confirmDisabled}
            onClick={() => {
              setStatus('confirmed');
              onAction(props.confirmAction || 'confirm_self_upgrade', props.payload ?? props);
            }}
          >
            {status === 'confirmed' ? '已确认' : normalizeText(props.confirmLabel) || '确认'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={status !== 'idle'}
            onClick={() => {
              setStatus('cancelled');
              onAction(props.cancelAction || 'cancel_self_upgrade', props.payload ?? props);
            }}
          >
            {status === 'cancelled' ? '已取消' : normalizeText(props.cancelLabel) || '取消'}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function GenUIPatchResultCard(ctx: unknown) {
  const props = (ctx && typeof ctx === 'object' && 'props' in ctx && typeof (ctx as { props?: unknown }).props === 'object')
    ? (ctx as { props: PatchResultCardProps }).props
    : {} as PatchResultCardProps;
  const title = normalizeText(props.title) || '变更已应用';
  const summary = normalizeText(props.summary) || '本次能力变更已完成。';
  const riskLevel = normalizeText(props.riskLevel) || 'medium';
  const targetScope = normalizeText(props.targetScope);
  const reviewId = normalizeText(props.reviewId);
  const appliedChanges = useMemo(
    () => normalizeArray(props.appliedChanges).map(buildChangeSummary).concat(
      Array.isArray(props.appliedChanges)
        ? []
        : typeof props.appliedChanges === 'string'
          ? [normalizeText(props.appliedChanges)]
          : [],
    ).filter(Boolean),
    [props.appliedChanges],
  );

  return (
    <Card className="mt-2 overflow-hidden border-border/60 bg-card/82 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm">{title}</CardTitle>
              <div className="mt-1 text-xs leading-5 text-muted-foreground whitespace-pre-wrap">{summary}</div>
            </div>
          </div>
          <ReviewBadge riskLevel={riskLevel} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap gap-2 text-xs">
          {targetScope ? <Badge variant="outline">范围：{targetScope}</Badge> : null}
          {reviewId ? <Badge variant="outline">Review ID：{reviewId}</Badge> : null}
        </div>
        {appliedChanges.length > 0 ? (
          <div className="grid gap-2 rounded-2xl border border-border/50 bg-background/60 p-3">
            {appliedChanges.map((item, index) => (
              <div key={`${item}-${index}`} className="flex items-start gap-2 text-[13px] leading-5 text-foreground/90">
                <ClipboardCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="break-words">{item}</span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
