import { Loader2, CheckCircle2, AlertTriangle, Clock3, Clapperboard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampPercent(value: unknown): number | undefined {
  const numeric = asNumber(value);
  if (numeric == null) return undefined;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase();
}

function statusLabel(status: string): string {
  switch (normalizeStatus(status)) {
    case 'queued':
      return '排队中';
    case 'pending':
      return '待处理';
    case 'running':
    case 'processing':
    case 'progress':
      return '执行中';
    case 'completed':
    case 'done':
    case 'success':
      return '已完成';
    case 'failed':
    case 'error':
      return '失败';
    case 'cancelled':
    case 'canceled':
      return '已取消';
    default:
      return status.trim() || '处理中';
  }
}

function statusBadgeClass(status: string): string {
  switch (normalizeStatus(status)) {
    case 'completed':
    case 'done':
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
    case 'failed':
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'cancelled':
    case 'canceled':
      return 'border-muted-foreground/20 bg-muted text-muted-foreground';
    default:
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700';
  }
}

function statusIcon(status: string) {
  switch (normalizeStatus(status)) {
    case 'completed':
    case 'done':
    case 'success':
      return <CheckCircle2 className="h-4 w-4" />;
    case 'failed':
    case 'error':
      return <AlertTriangle className="h-4 w-4" />;
    case 'queued':
    case 'pending':
      return <Clock3 className="h-4 w-4" />;
    default:
      return <Loader2 className="h-4 w-4 animate-spin" />;
  }
}

function normalizeSteps(value: unknown): Array<{ label: string; status?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): { label: string; status?: string } | null => {
      const record = asRecord(item);
      const label = asText(record.label) || asText(record.title) || asText(record.name);
      if (!label) return null;
      return {
        label,
        status: asText(record.status) || undefined,
      };
    })
    .filter((item): item is { label: string; status?: string } => item != null);
}

function isVideoJobType(jobType: string): boolean {
  const normalized = jobType.trim().toLowerCase();
  return normalized.includes('video') || normalized.includes('视频');
}

export function GenUIJobProgressCard(ctx: any) {
  const props = asRecord(ctx?.props);
  const title = asText(props.title) || '任务进度';
  const summary = asText(props.summary) || asText(props.description);
  const status = asText(props.status) || 'running';
  const progressPercent = clampPercent(props.progressPercent ?? props.progress ?? props.percent ?? props.value);
  const stage = asText(props.stage);
  const jobType = asText(props.jobType ?? props.job_type ?? props.kind);
  const etaText = asText(props.etaText ?? props.eta_text ?? props.eta);
  const jobId = asText(props.jobId ?? props.job_id ?? props.id);
  const previewUrl = asText(props.previewUrl ?? props.preview_url);
  const steps = normalizeSteps(props.steps);
  const videoJob = isVideoJobType(jobType);

  return (
    <Card className="border-border/60 bg-background/95 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-sm">{title}</CardTitle>
            {summary ? (
              <p className="text-xs leading-5 text-muted-foreground">{summary}</p>
            ) : null}
          </div>
          <Badge variant="outline" className={cn('flex items-center gap-1.5', statusBadgeClass(status))}>
            {statusIcon(status)}
            <span>{statusLabel(status)}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {videoJob ? (
          <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-4 text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(125,211,252,0.2),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(148,163,184,0.18),transparent_30%)]" />
            <div className="relative flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur-sm">
                {normalizeStatus(status) === 'completed' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                ) : normalizeStatus(status) === 'failed' || normalizeStatus(status) === 'error' ? (
                  <AlertTriangle className="h-5 w-5 text-rose-300" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-sky-200" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-300/90">
                  <Clapperboard className="h-3.5 w-3.5" />
                  <span>视频任务</span>
                </div>
                <div className="mt-1 text-sm font-medium">
                  {normalizeStatus(status) === 'completed'
                    ? '视频已生成完成'
                    : normalizeStatus(status) === 'failed' || normalizeStatus(status) === 'error'
                      ? '视频生成失败'
                      : '视频正在生成中'}
                </div>
                <div className="mt-1 text-xs text-slate-300/80">
                  {stage || summary || '生成完成后会自动回填到当前消息。'}
                </div>
              </div>
            </div>
            <div className="relative mt-4">
              {previewUrl ? (
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/60">
                  <img
                    src={previewUrl}
                    alt={title || 'video-job-preview'}
                    className="h-44 w-full object-cover opacity-75"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-2 rounded-full border border-white/20 bg-black/45 px-4 py-2 text-sm text-white shadow-sm backdrop-blur-sm">
                      {normalizeStatus(status) === 'completed' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : normalizeStatus(status) === 'failed' || normalizeStatus(status) === 'error' ? (
                        <AlertTriangle className="h-4 w-4 text-rose-300" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      <span>{statusLabel(status)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="aspect-[4/5] rounded-xl border border-white/10 bg-white/6"
                    >
                      <div className="flex h-full items-center justify-center">
                        <div className="h-8 w-8 rounded-full border border-white/10 bg-white/10" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {progressPercent != null ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{stage || '当前进度'}</span>
              <span>{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        ) : null}

        {(jobType || etaText || jobId) ? (
          <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
            {jobType ? <div><span className="font-medium text-foreground/80">任务类型：</span>{jobType}</div> : null}
            {etaText ? <div><span className="font-medium text-foreground/80">预计完成：</span>{etaText}</div> : null}
            {jobId ? <div><span className="font-medium text-foreground/80">任务 ID：</span>{jobId}</div> : null}
          </div>
        ) : null}

        {steps.length > 0 ? (
          <div className="space-y-1.5">
            {steps.map((step, index) => (
              <div
                key={`${step.label}-${index}`}
                className="flex items-center justify-between rounded-md border border-border/50 bg-muted/25 px-2.5 py-2 text-xs"
              >
                <span className="text-foreground/85">{step.label}</span>
                {step.status ? (
                  <span className="text-muted-foreground">{statusLabel(step.status)}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
