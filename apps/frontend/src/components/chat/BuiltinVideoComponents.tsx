import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Maximize2,
  MonitorPlay,
  Play,
  Settings2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  isDesktopMediaRuntime,
  launchMpvPlayer,
  openMediaExternal,
  openMediaWebviewWindow,
} from '@/services/media-player-client';
import { getApiBaseUrl, requestJson } from '@/services/transport';

interface VideoItem {
  src: string;
  rawSrc: string;
  embedSrc?: string;
  kind: 'direct' | 'stream';
  provider: string;
  poster: string;
  title: string;
  description: string;
  duration: string;
}

const VIDEO_SEND_ACTION_DEFAULT = 'insert_video';
const VIDEO_CARD_STAGE_MIN_HEIGHT = 'min-h-[224px] md:min-h-[248px]';

function toSafeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDurationLabel(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function normalizeFileLikeUrl(raw: string): string {
  const source = raw.trim();
  if (!source) return '';
  if (/^(https?:|data:|blob:|file:)/i.test(source)) {
    return source;
  }
  if (/^[a-zA-Z]:[\\/]/.test(source)) {
    return encodeURI(`file:///${source.replace(/\\/g, '/')}`);
  }
  if (source.startsWith('\\\\')) {
    return encodeURI(`file:${source.replace(/\\/g, '/')}`);
  }
  if (source.startsWith('/')) {
    return source;
  }
  return source;
}

function shouldResolveBackendRelativeMedia(url: string): boolean {
  const source = url.trim();
  return source.startsWith('/') || source.startsWith('api/');
}

function buildBackendMediaUrl(baseUrl: string, rawPath: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `${normalizedBase}${normalizedPath}`;
}

function useResolvedMediaSrc(src: string): string {
  const [resolved, setResolved] = React.useState(src);

  React.useEffect(() => {
    let cancelled = false;
    const raw = src.trim();
    if (!raw || !shouldResolveBackendRelativeMedia(raw)) {
      setResolved(src);
      return () => {
        cancelled = true;
      };
    }

    getApiBaseUrl()
      .then((baseUrl) => {
        if (cancelled) return;
        setResolved(buildBackendMediaUrl(baseUrl, raw));
      })
      .catch(() => {
        if (cancelled) return;
        setResolved(src);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved;
}

function formatDuration(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const total = Math.floor(value);
    const hour = Math.floor(total / 3600);
    const minute = Math.floor((total % 3600) / 60);
    const second = total % 60;
    if (hour > 0) {
      return `${hour}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`;
    }
    return `${minute}:${second.toString().padStart(2, '0')}`;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

function parseUrlSafely(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function extractYoutubeId(url: string): string {
  const parsed = parseUrlSafely(url);
  if (parsed) {
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0] || '';
      if (id) return id;
    }
    if (host.includes('youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return v;

      const parts = parsed.pathname.split('/').filter(Boolean);
      const type = parts[0]?.toLowerCase();
      if ((type === 'shorts' || type === 'live' || type === 'embed') && parts[1]) {
        return parts[1];
      }
    }
  }
  const match = url.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i);
  return match?.[1] ?? '';
}

function extractTiktokId(url: string): string {
  const parsed = parseUrlSafely(url);
  if (parsed && parsed.hostname.toLowerCase().includes('tiktok.com')) {
    const parts = parsed.pathname.split('/').filter(Boolean);
    const videoIndex = parts.findIndex((part) => part.toLowerCase() === 'video');
    if (videoIndex >= 0 && parts[videoIndex + 1]) {
      return parts[videoIndex + 1];
    }
  }
  const match = url.match(/tiktok\.com\/.*\/video\/(\d+)/i);
  return match?.[1] ?? '';
}

function extractBilibiliBvid(url: string): string {
  const bvid = url.match(/\/video\/(BV[a-zA-Z0-9]+)/i)?.[1];
  if (bvid) return bvid;
  const search = url.match(/[?&]bvid=(BV[a-zA-Z0-9]+)/i)?.[1];
  return search ?? '';
}

function resolveEmbedSource(rawSrc: string): { provider: string; embedSrc?: string } {
  const source = rawSrc.trim();
  if (!source) {
    return { provider: 'unknown' };
  }

  const lower = source.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    const parsed = parseUrlSafely(source);
    if (parsed && parsed.hostname.toLowerCase().includes('youtube.com')) {
      const path = parsed.pathname.toLowerCase();
      const searchQuery = parsed.searchParams.get('search_query')?.trim();
      if (path === '/results' && searchQuery) {
        return {
          provider: 'youtube',
          embedSrc: `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(searchQuery)}&autoplay=1`,
        };
      }
      const listId = parsed.searchParams.get('list')?.trim();
      if (path === '/playlist' && listId) {
        return {
          provider: 'youtube',
          embedSrc: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}&autoplay=1`,
        };
      }
    }

    const id = extractYoutubeId(source);
    return {
      provider: 'youtube',
      embedSrc: id ? `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1` : undefined,
    };
  }

  if (lower.includes('tiktok.com')) {
    const id = extractTiktokId(source);
    return {
      provider: 'tiktok',
      embedSrc: id ? `https://www.tiktok.com/embed/v2/${id}` : undefined,
    };
  }

  if (lower.includes('bilibili.com')) {
    const bvid = extractBilibiliBvid(source);
    return {
      provider: 'bilibili',
      embedSrc: bvid ? `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&autoplay=1` : undefined,
    };
  }

  if (/^https?:\/\//i.test(source)) {
    return { provider: 'web', embedSrc: sourceToEmbed(source) };
  }

  return { provider: 'unknown' };
}

function inferVideoKind(rawSrc: string, explicit?: string): { kind: 'direct' | 'stream'; provider: string; embedSrc?: string } {
  const normalizedExplicit = explicit?.trim().toLowerCase();
  if (normalizedExplicit === 'direct') {
    return { kind: 'direct', provider: 'direct' };
  }
  if (normalizedExplicit === 'stream') {
    const embed = resolveEmbedSource(rawSrc);
    return {
      kind: 'stream',
      provider: embed.provider === 'unknown' ? 'web' : embed.provider,
      embedSrc: embed.embedSrc || (/^https?:\/\//i.test(rawSrc.trim()) ? sourceToEmbed(rawSrc) : undefined),
    };
  }

  const src = rawSrc.trim().toLowerCase();
  const directFile =
    src.startsWith('file://')
    || /^[a-z]:[\\/]/i.test(rawSrc.trim())
    || /\.(mp4|webm|ogg|mov|mkv|m4v|flv|avi|m3u8)(\?.*)?$/i.test(src);

  if (directFile) {
    return { kind: 'direct', provider: 'direct' };
  }

  const embed = resolveEmbedSource(rawSrc);
  if (embed.provider !== 'unknown' || embed.embedSrc) {
    return { kind: 'stream', provider: embed.provider, embedSrc: embed.embedSrc };
  }

  if (/^https?:\/\//i.test(src)) {
    return { kind: 'stream', provider: 'web', embedSrc: sourceToEmbed(rawSrc) };
  }

  return { kind: 'direct', provider: 'direct' };
}

function sourceToEmbed(rawSrc: string): string {
  const source = rawSrc.trim();
  if (!source) return '';
  return source;
}

function normalizeVideoCandidate(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const nestedProps = (record.props && typeof record.props === 'object')
    ? record.props as Record<string, unknown>
    : null;
  if (!nestedProps) {
    return record;
  }

  const type = toSafeText(record.type).toLowerCase();
  const isVideoLikeType = (
    !type
    || type === 'videocover'
    || type === 'video_cover'
    || type === 'video.cover'
    || type === 'video'
  );
  if (!isVideoLikeType) {
    return record;
  }

  return {
    ...record,
    ...nestedProps,
  };
}

function normalizeVideoItems(props: Record<string, unknown>): VideoItem[] {
  const candidates = Array.isArray(props.videos)
    ? props.videos
    : Array.isArray(props.items)
      ? props.items
      : [];

  const normalized = candidates
    .map((item): VideoItem | null => {
      if (typeof item === 'string') {
        const rawSrc = item.trim();
        if (!rawSrc) return null;
        const resolved = inferVideoKind(rawSrc);
        return {
          src: normalizeFileLikeUrl(rawSrc),
          rawSrc,
          kind: resolved.kind,
          provider: resolved.provider,
          embedSrc: resolved.embedSrc,
          poster: '',
          title: '',
          description: '',
          duration: '',
        };
      }

      const record = normalizeVideoCandidate(item);
      if (!record) return null;
      const rawSrc = toSafeText(record.src) || toSafeText(record.url) || toSafeText(record.path) || toSafeText(record.video);
      if (!rawSrc) return null;
      const resolved = inferVideoKind(rawSrc, toSafeText(record.kind) || toSafeText(record.sourceType));
      return {
        src: normalizeFileLikeUrl(rawSrc),
        rawSrc,
        kind: resolved.kind,
        provider: resolved.provider,
        embedSrc: resolved.embedSrc,
        poster: normalizeFileLikeUrl(toSafeText(record.poster) || toSafeText(record.cover) || toSafeText(record.thumbnail)),
        title: toSafeText(record.title) || toSafeText(record.name),
        description: toSafeText(record.description) || toSafeText(record.subtitle),
        duration: formatDuration(record.duration),
      };
    })
    .filter((item): item is VideoItem => Boolean(item?.src));

  if (normalized.length > 0) {
    return normalized;
  }

  const rawSingle = toSafeText(props.src) || toSafeText(props.url) || toSafeText(props.path) || toSafeText(props.video);
  if (!rawSingle) {
    return [];
  }

  const resolved = inferVideoKind(rawSingle, toSafeText(props.kind) || toSafeText(props.sourceType));
  return [{
    src: normalizeFileLikeUrl(rawSingle),
    rawSrc: rawSingle,
    kind: resolved.kind,
    provider: resolved.provider,
    embedSrc: resolved.embedSrc,
    poster: normalizeFileLikeUrl(toSafeText(props.poster) || toSafeText(props.cover) || toSafeText(props.thumbnail)),
    title: toSafeText(props.title),
    description: toSafeText(props.description) || toSafeText(props.subtitle),
    duration: formatDuration(props.duration),
  }];
}

type VideoOpenMode = 'dialog' | 'webview' | 'external';

function parseOpenMode(raw: unknown): VideoOpenMode {
  const value = toSafeText(raw).toLowerCase();
  if (value === 'dialog' || value === 'webview' || value === 'external') {
    return value;
  }
  return 'dialog';
}

function EmptyVideoState({ title }: { title: string }) {
  return (
    <div className="w-full rounded-xl border border-dashed border-border/70 bg-muted/20 text-muted-foreground px-4 py-6 text-sm">
      {title}
    </div>
  );
}

interface ComponentVideoParameterMapping {
  id: string;
  parameterName: string;
  label: string;
  valueType: string;
  description: string;
  defaultValue: unknown;
  required: boolean;
  options: unknown[];
}

interface ComponentVideoDefinition {
  name: string;
  englishName: string;
  description: string;
  workflow: {
    parameterMappings: ComponentVideoParameterMapping[];
  };
}

interface ComponentVideoRunSnapshot {
  result?: unknown;
  elapsedSeconds?: number;
  values?: Record<string, unknown>;
  error?: string;
}

interface ComponentVideoInflightRun {
  startedAt: number;
  values: Record<string, unknown>;
  promise: Promise<ComponentVideoRunSnapshot>;
}

const componentVideoRuntimeSnapshots = new Map<string, ComponentVideoRunSnapshot>();
const componentVideoInflightRuns = new Map<string, ComponentVideoInflightRun>();

function safeVideoStorageGet(key: string) {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeVideoStorageSet(key: string, value: string) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

function safeVideoStorageRemove(key: string) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

function stableVideoStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableVideoStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableVideoStringify(record[key])}`).join(',')}}`;
}

function buildComponentVideoCacheKey(
  componentName: string,
  messageId: string | undefined,
  initialValues: Record<string, unknown>,
) {
  if (messageId && messageId.trim()) {
    return `webot:component-video:${componentName}:message:${messageId.trim()}`;
  }
  return `webot:component-video:${componentName}:props:${stableVideoStringify(initialValues)}`;
}

function buildComponentVideoInitialValues(
  mappings: ComponentVideoParameterMapping[],
  presetValues: Record<string, unknown>,
) {
  const output: Record<string, unknown> = {};
  for (const mapping of mappings) {
    const key = typeof mapping?.parameterName === 'string' ? mapping.parameterName : '';
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(presetValues, key)) {
      output[key] = presetValues[key];
      continue;
    }
    if (mapping.defaultValue !== undefined && mapping.defaultValue !== null) {
      output[key] = mapping.defaultValue;
      continue;
    }
    output[key] = mapping.valueType === 'boolean' ? false : '';
  }
  return output;
}

function normalizeComponentVideoParamValue(raw: unknown, valueType: string) {
  if (valueType === 'number') {
    if (raw === '' || raw === null || raw === undefined) return '';
    const next = Number(raw);
    return Number.isFinite(next) ? next : raw;
  }
  if (valueType === 'boolean') {
    return Boolean(raw);
  }
  if (valueType === 'json') {
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return raw;
      }
    }
    return raw;
  }
  return raw ?? '';
}

function hasMissingRequiredVideoValues(
  mappings: ComponentVideoParameterMapping[],
  values: Record<string, unknown>,
): boolean {
  return mappings.some((mapping) => {
    if (!mapping?.required) return false;
    const value = values[mapping.parameterName];
    return value === '' || value === null || value === undefined;
  });
}

function buildVideoInvokePayload(
  mappings: ComponentVideoParameterMapping[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, raw]) => {
      const mapping = mappings.find((item) => item.parameterName === key);
      return [key, normalizeComponentVideoParamValue(raw, mapping?.valueType || 'string')];
    }),
  );
}

function extractVideoItemsFromResult(result: unknown): VideoItem[] {
  if (!result) return [];
  if (Array.isArray(result)) {
    return normalizeVideoItems({ items: result });
  }
  if (typeof result !== 'object') {
    return [];
  }
  const record = result as Record<string, unknown>;
  const direct = normalizeVideoItems(record);
  if (direct.length > 0) {
    return direct;
  }
  if (record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)) {
    const fromRaw = normalizeVideoItems(record.raw as Record<string, unknown>);
    if (fromRaw.length > 0) {
      return fromRaw;
    }
  }
  if (Array.isArray(record.raw)) {
    const fromRawArray = normalizeVideoItems({ items: record.raw });
    if (fromRawArray.length > 0) {
      return fromRawArray;
    }
  }
  return [];
}

function ComponentVideoSettingsDialog({
  open,
  title,
  description,
  mappings,
  values,
  submitting,
  elapsedSeconds,
  onOpenChange,
  onChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  mappings: ComponentVideoParameterMapping[];
  values: Record<string, unknown>;
  submitting: boolean;
  elapsedSeconds: number;
  onOpenChange: (nextOpen: boolean) => void;
  onChange: (key: string, value: unknown) => void;
  onSubmit: () => void;
}) {
  const quietFieldClassName =
    'focus:outline-none focus:ring-0 focus:ring-transparent focus-visible:ring-0 focus-visible:ring-transparent focus-visible:border-input';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-none"
        style={{
          width: 'min(920px, calc(100vw - 24px))',
          maxWidth: '920px',
          maxHeight: 'min(820px, calc(100vh - 48px))',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr) auto',
        }}
      >
        <DialogHeader className="border-b px-6 py-5 text-left">
          <div className="inline-flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-muted/60 text-foreground-secondary">
              <Settings2 className="h-4 w-4" />
            </span>
            <DialogTitle>{title || '视频生成设置'}</DialogTitle>
          </div>
          <DialogDescription>{description || '调整参数后重新生成视频。'}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 px-6 py-5">
          {submitting ? (
            <div className="mb-5 rounded-2xl border border-border/70 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
              生成中，已等待 {formatDurationLabel(elapsedSeconds)}
            </div>
          ) : null}

          <div className="grid gap-5 pb-2">
            {mappings.map((mapping) => {
              const key = mapping.parameterName;
              const label = mapping.label?.trim() || key;
              const options = Array.isArray(mapping.options) ? mapping.options : [];
              const valueType = mapping.valueType || 'string';
              const currentValue = values[key] ?? (valueType === 'boolean' ? false : '');
              const fieldId = `component-video-setting-${String(mapping.id || key)}`;

              return (
                <div key={mapping.id || key} className="grid gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor={fieldId} className="text-sm">
                      {label}
                      {mapping.required ? <span className="ml-1 text-destructive">*</span> : null}
                    </Label>
                    {mapping.description ? (
                      <p className="text-xs text-muted-foreground">{mapping.description}</p>
                    ) : null}
                  </div>

                  {options.length > 0 ? (
                    <Select
                      value={String(currentValue ?? '')}
                      onValueChange={(value) => onChange(key, value)}
                      disabled={submitting}
                    >
                      <SelectTrigger id={fieldId} className={`h-11 ${quietFieldClassName}`}>
                        <SelectValue placeholder={`选择 ${label}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((option, optionIndex) => {
                          const optionValue = typeof option === 'string' ? option : JSON.stringify(option);
                          const optionLabel = typeof option === 'string'
                            ? option
                            : toSafeText((option as Record<string, unknown>)?.label) || optionValue;
                          return (
                            <SelectItem key={`${fieldId}-${optionValue}-${optionIndex}`} value={optionValue}>
                              {optionLabel}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  ) : valueType === 'boolean' ? (
                    <div className="flex min-h-[44px] items-center rounded-xl border border-input bg-background px-4">
                      <Switch
                        id={fieldId}
                        checked={Boolean(currentValue)}
                        onCheckedChange={(checked) => onChange(key, checked)}
                        disabled={submitting}
                      />
                    </div>
                  ) : valueType === 'json' ? (
                    <Textarea
                      id={fieldId}
                      value={typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue, null, 2)}
                      onChange={(event) => onChange(key, event.target.value)}
                      disabled={submitting}
                      rows={6}
                      className={quietFieldClassName}
                    />
                  ) : valueType === 'number' ? (
                    <Input
                      id={fieldId}
                      type="number"
                      value={currentValue as string | number}
                      onChange={(event) => onChange(key, event.target.value)}
                      disabled={submitting}
                      className={`h-11 ${quietFieldClassName}`}
                    />
                  ) : (
                    <Textarea
                      id={fieldId}
                      value={String(currentValue ?? '')}
                      onChange={(event) => onChange(key, event.target.value)}
                      disabled={submitting}
                      rows={typeof currentValue === 'string' && String(currentValue).length > 120 ? 5 : 3}
                      className={quietFieldClassName}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            关闭
          </Button>
          <Button type="button" onClick={onSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                重新生成
              </>
            ) : (
              '重新生成'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VideoPoster({
  item,
  className,
}: {
  item: VideoItem;
  className?: string;
}) {
  const posterSrc = useResolvedMediaSrc(item.poster);
  if (item.poster) {
    return <img src={posterSrc} alt={item.title || 'video-poster'} className={className} />;
  }
  return (
    <div className={cn('bg-gradient-to-br from-zinc-800 via-zinc-700 to-zinc-900', className)}>
      <div className="h-full w-full flex items-center justify-center text-white/90">
        <Play className="w-10 h-10" />
      </div>
    </div>
  );
}

function VideoPlayerDialog({
  open,
  onOpenChange,
  videos,
  index,
  onIndexChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videos: VideoItem[];
  index: number;
  onIndexChange: (next: number) => void;
}) {
  const [statusText, setStatusText] = React.useState('');
  const isDesktopRuntime = isDesktopMediaRuntime();
  const current = videos[index];
  const hasMultiple = videos.length > 1;
  const resolvedCurrentSrc = useResolvedMediaSrc(current?.src ?? '');
  const resolvedPosterSrc = useResolvedMediaSrc(current?.poster ?? '');

  React.useEffect(() => {
    if (open) {
      setStatusText('');
    }
  }, [open, index]);

  if (!current) return null;

  const openWebviewWindow = async () => {
    try {
      const ok = await openMediaWebviewWindow(resolvedCurrentSrc || current.rawSrc || current.src, current.title || '媒体播放器');
      if (!ok) {
        openMediaExternal(resolvedCurrentSrc || current.rawSrc || current.src);
        setStatusText('独立窗口不可用，已回退浏览器播放。');
        return;
      }
      setStatusText('已在独立窗口打开。');
    } catch {
      openMediaExternal(resolvedCurrentSrc || current.rawSrc || current.src);
      setStatusText('独立窗口打开失败，已回退浏览器播放。');
    }
  };

  const openInBrowser = () => {
    openMediaExternal(resolvedCurrentSrc || current.rawSrc || current.src);
    setStatusText('已在当前浏览器打开。');
  };

  const openMpv = async () => {
    const result = await launchMpvPlayer(resolvedCurrentSrc || current.rawSrc || current.src);
    if (!result.ok) {
      setStatusText(result.message || 'MPV 启动失败');
    } else {
      setStatusText('已调用 MPV 播放器。');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 border-border/50 bg-black/95 overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">
          {current.title || `视频预览 ${index + 1}`}
        </DialogTitle>
        <div className="absolute left-3 top-3 z-20 inline-flex items-center gap-2">
          <Badge variant="secondary" className="bg-white/15 text-white border-white/20">
            {index + 1} / {videos.length}
          </Badge>
          {current.title ? <span className="text-xs text-white/90 truncate max-w-[45vw]">{current.title}</span> : null}
          {current.duration ? (
            <Badge variant="secondary" className="bg-black/45 text-white border-white/20">{current.duration}</Badge>
          ) : null}
        </div>

        <div className="absolute right-3 top-3 z-20 inline-flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
            onClick={openInBrowser}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" />
            浏览器打开
          </Button>
          {isDesktopRuntime ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
              onClick={openWebviewWindow}
            >
              <MonitorPlay className="w-3.5 h-3.5 mr-1" />
              独立窗口
            </Button>
          ) : null}
          {isDesktopRuntime && current.kind === 'direct' ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
              onClick={openMpv}
            >
              MPV
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
            onClick={() => onOpenChange(false)}
            title="关闭"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="h-full w-full flex items-center justify-center overflow-hidden px-4 py-14">
          {current.kind === 'direct' ? (
            <video
              src={resolvedCurrentSrc}
              poster={resolvedPosterSrc || undefined}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full object-contain"
            />
          ) : current.embedSrc ? (
            <iframe
              src={current.embedSrc}
              title={current.title || 'stream-player'}
              className="h-full w-full rounded-md border border-white/10 bg-black"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/85">
              当前链接不支持内嵌，请使用右上角“浏览器打开”。
            </div>
          )}
        </div>

        {hasMultiple ? (
          <>
            <Button
              size="icon"
              variant="secondary"
              className="absolute left-3 top-1/2 z-20 h-9 w-9 -translate-y-1/2 bg-white/15 text-white hover:bg-white/25 border-white/20"
              onClick={() => onIndexChange((index - 1 + videos.length) % videos.length)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="absolute right-3 top-1/2 z-20 h-9 w-9 -translate-y-1/2 bg-white/15 text-white hover:bg-white/25 border-white/20"
              onClick={() => onIndexChange((index + 1) % videos.length)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </>
        ) : null}

        {current.description || statusText ? (
          <div className="absolute bottom-3 left-3 right-3 z-20 rounded-md bg-black/50 text-white/90 text-xs px-3 py-2 border border-white/10">
            {current.description ? <div>{current.description}</div> : null}
            {statusText ? <div className={cn(current.description ? 'mt-1' : '', 'text-emerald-200/95')}>{statusText}</div> : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function useVideoActions(ctx: { props: Record<string, unknown>; emit?: (name: string, payload?: unknown) => void }) {
  const videos = React.useMemo(() => normalizeVideoItems(ctx.props), [ctx.props]);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const sendAction = toSafeText(ctx.props.sendAction, VIDEO_SEND_ACTION_DEFAULT) || VIDEO_SEND_ACTION_DEFAULT;
  const clickAction = toSafeText(ctx.props.clickAction, 'open').toLowerCase();

  const emitVideo = React.useCallback((item: VideoItem) => {
    ctx.emit?.(sendAction, {
      src: item.rawSrc || item.src,
      previewSrc: item.poster,
      title: item.title,
      description: item.description,
      duration: item.duration,
      provider: item.provider,
      kind: item.kind,
    });
  }, [ctx, sendAction]);

  const openVideo = React.useCallback(async (item: VideoItem, index: number) => {
    const mode = parseOpenMode(ctx.props.openMode);
    if (mode === 'external') {
      openMediaExternal(item.rawSrc || item.src);
      return;
    }
    if (mode === 'webview') {
      const ok = await openMediaWebviewWindow(item.rawSrc || item.src, item.title || '媒体播放器');
      if (ok) {
        return;
      }
      if (!isDesktopMediaRuntime()) {
        setActiveIndex(index);
        setOpen(true);
        return;
      }
    }
    setActiveIndex(index);
    setOpen(true);
  }, [ctx.props.openMode]);

  const handleCardClick = React.useCallback(async (item: VideoItem, index: number) => {
    if (clickAction === 'send') {
      emitVideo(item);
      return;
    }
    if (clickAction === 'sendandopen') {
      emitVideo(item);
      await openVideo(item, index);
      return;
    }
    await openVideo(item, index);
  }, [clickAction, emitVideo, openVideo]);

  return {
    videos,
    open,
    setOpen,
    activeIndex,
    setActiveIndex,
    emitVideo,
    handleCardClick,
  };
}

function VideoMeta({ item }: { item: VideoItem }) {
  return (
    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 via-black/25 to-transparent">
      <div className="flex items-center justify-between gap-2">
        {item.title ? <div className="text-sm font-semibold text-white truncate">{item.title}</div> : <div />}
        {item.duration ? <Badge variant="secondary" className="bg-black/45 text-white border-white/20">{item.duration}</Badge> : null}
      </div>
      {item.description ? <div className="mt-1 text-[11px] text-white/80 truncate">{item.description}</div> : null}
    </div>
  );
}

export function GenUIComponentVideoCard(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  const componentName = toSafeText(props.componentName) || toSafeText(props.englishName) || toSafeText(props.skillName);
  const initialValues = (props.initialValues && typeof props.initialValues === 'object' && !Array.isArray(props.initialValues))
    ? props.initialValues as Record<string, unknown>
    : {};
  const title = toSafeText(props.title);
  const description = toSafeText(props.description);
  const autoRun = props.autoRun !== false;
  const agentId = toSafeText(props.__agentId) || toSafeText(ctx?.agentId);
  const messageId = toSafeText(props.__messageId);
  const cacheKey = React.useMemo(
    () => buildComponentVideoCacheKey(componentName, messageId || undefined, initialValues),
    [componentName, initialValues, messageId],
  );
  const [definition, setDefinition] = React.useState<ComponentVideoDefinition | null>(null);
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState<unknown>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);
  const [finishedElapsedSeconds, setFinishedElapsedSeconds] = React.useState(0);
  const [clockMs, setClockMs] = React.useState(() => Date.now());
  const autoRanRef = React.useRef(false);

  const invokeWith = React.useCallback(async (
    definitionArg: ComponentVideoDefinition,
    nextValues: Record<string, unknown>,
  ) => {
    if (!componentName) return;
    const startedAt = Date.now();
    const mappings = Array.isArray(definitionArg.workflow?.parameterMappings) ? definitionArg.workflow.parameterMappings : [];
    setSubmitting(true);
    setError('');
    setRunStartedAt(startedAt);
    setFinishedElapsedSeconds(0);
    setSettingsOpen(false);
    const runTask = (async (): Promise<ComponentVideoRunSnapshot> => {
      const payload = buildVideoInvokePayload(mappings, nextValues);
      const response = await requestJson<unknown>(`/api/management/components/${encodeURIComponent(componentName)}/invoke`, {
        method: 'POST',
        body: {
          params: payload,
          ...(agentId ? { agentId } : {}),
        },
      });
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      return {
        result: response,
        elapsedSeconds: elapsed,
        values: nextValues,
      };
    })();
    componentVideoInflightRuns.set(cacheKey, {
      startedAt,
      values: nextValues,
      promise: runTask,
    });
    try {
      const snapshot = await runTask;
      setFinishedElapsedSeconds(snapshot.elapsedSeconds ?? 0);
      setResult(snapshot.result ?? null);
      componentVideoRuntimeSnapshots.set(cacheKey, snapshot);
      safeVideoStorageSet(cacheKey, JSON.stringify({
        elapsedSeconds: snapshot.elapsedSeconds ?? 0,
        result: snapshot.result,
        values: nextValues,
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err || '调用失败');
      setError(errorMessage);
      componentVideoRuntimeSnapshots.set(cacheKey, {
        error: errorMessage,
        values: nextValues,
      });
      autoRanRef.current = false;
    } finally {
      const inflight = componentVideoInflightRuns.get(cacheKey);
      if (inflight?.promise === runTask) {
        componentVideoInflightRuns.delete(cacheKey);
      }
      setSubmitting(false);
    }
  }, [agentId, cacheKey, componentName]);

  const invoke = React.useCallback(async (overrideValues?: Record<string, unknown>) => {
    if (!definition) return;
    await invokeWith(definition, overrideValues ?? values);
  }, [definition, invokeWith, values]);

  React.useEffect(() => {
    if (!componentName) return;
    const runtimeSnapshot = componentVideoRuntimeSnapshots.get(cacheKey);
    if (runtimeSnapshot?.result) {
      setResult(runtimeSnapshot.result);
      setFinishedElapsedSeconds(Math.max(0, Math.floor(runtimeSnapshot.elapsedSeconds ?? 0)));
      if (runtimeSnapshot.values && typeof runtimeSnapshot.values === 'object') {
        setValues((prev) => ({ ...prev, ...runtimeSnapshot.values }));
      }
      autoRanRef.current = true;
    } else if (runtimeSnapshot?.error) {
      setError(runtimeSnapshot.error);
      if (runtimeSnapshot.values && typeof runtimeSnapshot.values === 'object') {
        setValues((prev) => ({ ...prev, ...runtimeSnapshot.values }));
      }
    }

    const inflight = componentVideoInflightRuns.get(cacheKey);
    if (!inflight) return;
    let active = true;
    setSubmitting(true);
    setRunStartedAt(inflight.startedAt);
    setFinishedElapsedSeconds(0);
    setValues((prev) => ({ ...inflight.values, ...prev }));
    inflight.promise
      .then((snapshot) => {
        if (!active) return;
        if (snapshot.result !== undefined) {
          setResult(snapshot.result);
          setFinishedElapsedSeconds(Math.max(0, Math.floor(snapshot.elapsedSeconds ?? 0)));
          autoRanRef.current = true;
        }
        if (snapshot.error) {
          setError(snapshot.error);
          autoRanRef.current = false;
        }
      })
      .finally(() => {
        if (!active) return;
        setSubmitting(false);
      });
    return () => {
      active = false;
    };
  }, [cacheKey, componentName]);

  React.useEffect(() => {
    if (!componentName) return;
    const cached = safeVideoStorageGet(cacheKey);
    if (!cached) return;
    try {
      const parsed = JSON.parse(cached) as {
        result?: unknown;
        elapsedSeconds?: number;
        values?: Record<string, unknown>;
      };
      if (parsed.result) {
        const cachedVideos = extractVideoItemsFromResult(parsed.result);
        if (cachedVideos.length > 0) {
          setResult(parsed.result);
          autoRanRef.current = true;
          componentVideoRuntimeSnapshots.set(cacheKey, {
            result: parsed.result,
            elapsedSeconds: parsed.elapsedSeconds,
            values: parsed.values,
          });
        } else {
          safeVideoStorageRemove(cacheKey);
        }
      }
      if (typeof parsed.elapsedSeconds === 'number' && Number.isFinite(parsed.elapsedSeconds)) {
        setFinishedElapsedSeconds(Math.max(0, Math.floor(parsed.elapsedSeconds)));
      }
      if (parsed.values && typeof parsed.values === 'object') {
        setValues((prev) => ({ ...prev, ...parsed.values }));
      }
    } catch {
      // ignore broken cache
    }
  }, [cacheKey, componentName]);

  React.useEffect(() => {
    if (!componentName) {
      setLoading(false);
      setError('缺少 componentName');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    requestJson<{ item?: ComponentVideoDefinition }>(`/api/management/components/${encodeURIComponent(componentName)}`)
      .then((payload) => {
        if (!active) return;
        const item = payload?.item ?? null;
        setDefinition(item);
        const mappings = Array.isArray(item?.workflow?.parameterMappings) ? item.workflow.parameterMappings : [];
        const nextValues = {
          ...buildComponentVideoInitialValues(mappings, initialValues),
        };
        setValues((prev) => {
          const merged = {
            ...nextValues,
            ...prev,
          };
          if (
            autoRun
            && item
            && !autoRanRef.current
            && !hasMissingRequiredVideoValues(mappings, merged)
          ) {
            autoRanRef.current = true;
            void invokeWith(item, merged);
          }
          return merged;
        });
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err || '加载组件定义失败'));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [autoRun, componentName, initialValues, invokeWith]);

  React.useEffect(() => {
    if (!autoRun || !definition || autoRanRef.current) return;
    const mappings = Array.isArray(definition.workflow?.parameterMappings) ? definition.workflow.parameterMappings : [];
    if (hasMissingRequiredVideoValues(mappings, values)) return;
    autoRanRef.current = true;
    void invoke();
  }, [autoRun, definition, invoke, values]);

  React.useEffect(() => {
    if (!submitting || runStartedAt == null) return undefined;
    const timer = window.setInterval(() => {
      setClockMs(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, [runStartedAt, submitting]);

  const videos = React.useMemo(() => extractVideoItemsFromResult(result), [result]);
  const elapsedSeconds = submitting && runStartedAt != null
    ? Math.max(0, Math.floor((clockMs - runStartedAt) / 1000))
    : finishedElapsedSeconds;
  const effectiveTitle = title || definition?.name || componentName;
  const effectiveDescription = description || definition?.description || '';
  const elapsedLabel = submitting
    ? formatDurationLabel(elapsedSeconds)
    : finishedElapsedSeconds > 0
      ? formatDurationLabel(finishedElapsedSeconds)
      : '';

  const overlay = (
    <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2 opacity-90 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
      {elapsedLabel ? (
        <div className="rounded-full border-0 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm">
          {elapsedLabel}
        </div>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="pointer-events-auto h-9 w-9 rounded-full border-0 bg-white/10 text-white backdrop-blur-sm hover:bg-white/16 hover:text-white focus-visible:ring-0"
        onClick={() => setSettingsOpen(true)}
        aria-label="打开视频生成设置"
      >
        <Settings2 className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div className="relative">
      {loading ? (
        <div className={cn(VIDEO_CARD_STAGE_MIN_HEIGHT, 'flex items-center justify-center rounded-[28px] border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground')}>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载视频组件…
        </div>
      ) : null}

      {!loading && videos.length > 0 ? (
        <div className={cn('group relative', VIDEO_CARD_STAGE_MIN_HEIGHT)}>
          {overlay}
          {videos.length === 1 ? (
            <GenUIVideoCover
              props={{
                src: videos[0].src,
                poster: videos[0].poster,
                title: videos[0].title,
                description: videos[0].description,
                duration: videos[0].duration,
                kind: videos[0].kind,
                openMode: 'dialog',
                clickAction: 'open',
                height: 248,
              }}
              emit={ctx?.emit}
            />
          ) : (
            <GenUIVideoGallery
              props={{
                items: videos,
                compact: true,
                openMode: 'dialog',
                clickAction: 'open',
              }}
              emit={ctx?.emit}
            />
          )}
        </div>
      ) : null}

      {!loading && videos.length === 0 ? (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={cn(
            VIDEO_CARD_STAGE_MIN_HEIGHT,
            'flex w-full flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground',
          )}
        >
          {submitting ? <Loader2 className="h-7 w-7 animate-spin" /> : <Settings2 className="h-6 w-6" />}
          <span>{submitting ? `生成中 ${formatDurationLabel(elapsedSeconds)}` : '点击设置开始生成'}</span>
        </button>
      ) : null}

      {error ? <div className="mt-3 text-sm text-destructive">{error}</div> : null}

      <ComponentVideoSettingsDialog
        open={settingsOpen}
        title={effectiveTitle}
        description={effectiveDescription}
        mappings={definition?.workflow?.parameterMappings ?? []}
        values={values}
        submitting={submitting}
        elapsedSeconds={elapsedSeconds}
        onOpenChange={setSettingsOpen}
        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
        onSubmit={() => void invoke()}
      />
    </div>
  );
}

export function GenUIVideoCover(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  const { videos, open, setOpen, activeIndex, setActiveIndex, handleCardClick } = useVideoActions({
    props,
    emit: ctx?.emit,
  });

  const item = videos[0];
  if (!item) {
    return <EmptyVideoState title="VideoCover 未收到可用视频，请传入 props.src/url/path 或 props.videos。" />;
  }

  const height = clamp(toNumber(props.height, 240), 140, 640);
  const width = toNumber(props.width, 0);
  const radius = clamp(toNumber(props.radius, 16), 8, 32);

  return (
    <div className="w-full space-y-2">
      <button
        type="button"
        className="group relative w-full overflow-hidden border border-border/60 bg-card/40 hover:border-border transition-all text-left"
        style={{ height: `${height}px`, width: width > 0 ? `${width}px` : '100%', borderRadius: `${radius}px` }}
        onClick={() => void handleCardClick(item, 0)}
      >
        <VideoPoster item={item} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-14 w-14 rounded-full bg-black/45 border border-white/20 text-white flex items-center justify-center group-hover:scale-105 transition-transform">
            <Play className="w-6 h-6 ml-0.5" />
          </div>
        </div>
        <div className="absolute right-2 top-2 flex gap-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-7 w-7 bg-black/45 text-white border-white/20 hover:bg-black/65"
            onClick={(event) => {
              event.stopPropagation();
              setActiveIndex(0);
              setOpen(true);
            }}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        <VideoMeta item={item} />
      </button>

      <VideoPlayerDialog
        open={open}
        onOpenChange={setOpen}
        videos={videos}
        index={activeIndex}
        onIndexChange={setActiveIndex}
      />
    </div>
  );
}

export function GenUIVideoGallery(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  const { videos, open, setOpen, activeIndex, setActiveIndex, handleCardClick } = useVideoActions({
    props,
    emit: ctx?.emit,
  });
  if (videos.length === 0) {
    return <EmptyVideoState title="VideoGallery 未收到视频数组，请传入 props.videos 或 props.items。" />;
  }

  const columns = clamp(Math.round(toNumber(props.columns, 0)), 1, 5);
  const gap = clamp(toNumber(props.gap, 10), 4, 24);
  const minWidth = clamp(toNumber(props.minItemWidth, 220), 160, 420);
  const aspectRatio = toSafeText(props.aspectRatio, '16/9') || '16/9';
  const compact = props.compact !== false;
  const compactItemWidth = clamp(toNumber(props.itemWidth, 236), 160, 420);
  const compactMainWidth = clamp(toNumber(props.mainItemWidth, compactItemWidth + 36), compactItemWidth, 520);
  const compactHeight = clamp(toNumber(props.itemHeight, 136), 96, 280);
  const compactScrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);

  const updateCompactScrollState = React.useCallback(() => {
    const node = compactScrollerRef.current;
    if (!node) {
      setCanScrollPrev(false);
      setCanScrollNext(false);
      return;
    }
    const maxLeft = Math.max(0, node.scrollWidth - node.clientWidth - 1);
    setCanScrollPrev(node.scrollLeft > 1);
    setCanScrollNext(node.scrollLeft < maxLeft);
  }, []);

  React.useEffect(() => {
    if (!compact) return;
    updateCompactScrollState();
    const node = compactScrollerRef.current;
    if (!node) return;
    const onScroll = () => updateCompactScrollState();
    node.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateCompactScrollState())
      : null;
    observer?.observe(node);
    return () => {
      node.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [compact, updateCompactScrollState, videos.length]);

  const scrollCompact = (direction: -1 | 1) => {
    const node = compactScrollerRef.current;
    if (!node) return;
    const step = Math.max(180, compactItemWidth + 32);
    node.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  if (compact) {
    return (
      <div className="w-full space-y-2">
        <div className="relative group/compact-gallery">
          <div ref={compactScrollerRef} className="overflow-x-auto pb-1 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-stretch gap-2 pr-1">
            {videos.map((item, index) => (
              <button
                key={`${item.src}-${index}`}
                type="button"
                className="group relative shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/40 hover:border-border transition-colors text-left"
                style={{
                  width: `${index === 0 ? compactMainWidth : compactItemWidth}px`,
                  height: `${compactHeight}px`,
                }}
                onClick={() => void handleCardClick(item, index)}
              >
                <VideoPoster item={item} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-10 w-10 rounded-full bg-black/45 border border-white/20 text-white flex items-center justify-center">
                    <Play className="w-4.5 h-4.5 ml-0.5" />
                  </div>
                </div>
                <VideoMeta item={item} />
              </button>
            ))}
          </div>
          </div>
          {videos.length > 1 ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className={cn(
                  'absolute left-1 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-black/35 text-white border-white/15 shadow-sm transition-opacity',
                  canScrollPrev ? 'opacity-0 group-hover/compact-gallery:opacity-100' : 'opacity-0 pointer-events-none',
                )}
                onClick={() => scrollCompact(-1)}
                title="向左滑动"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className={cn(
                  'absolute right-1 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-black/35 text-white border-white/15 shadow-sm transition-opacity',
                  canScrollNext ? 'opacity-0 group-hover/compact-gallery:opacity-100' : 'opacity-0 pointer-events-none',
                )}
                onClick={() => scrollCompact(1)}
                title="向右滑动"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </>
          ) : null}
        </div>

        <VideoPlayerDialog
          open={open}
          onOpenChange={setOpen}
          videos={videos}
          index={activeIndex}
          onIndexChange={setActiveIndex}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        className="grid"
        style={{
          gap: `${gap}px`,
          gridTemplateColumns: columns > 0
            ? `repeat(${columns}, minmax(0, 1fr))`
            : `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
        }}
      >
        {videos.map((item, index) => (
          <button
            key={`${item.src}-${index}`}
            type="button"
            className="group relative overflow-hidden rounded-xl border border-border/60 bg-card/40 hover:border-border transition-colors text-left"
            style={{ aspectRatio }}
            onClick={() => void handleCardClick(item, index)}
          >
            <VideoPoster item={item} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-11 w-11 rounded-full bg-black/45 border border-white/20 text-white flex items-center justify-center">
                <Play className="w-5 h-5 ml-0.5" />
              </div>
            </div>
            <VideoMeta item={item} />
          </button>
        ))}
      </div>

      <VideoPlayerDialog
        open={open}
        onOpenChange={setOpen}
        videos={videos}
        index={activeIndex}
        onIndexChange={setActiveIndex}
      />
    </div>
  );
}

export function GenUIVideoCarousel(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  const { videos, open, setOpen, activeIndex, setActiveIndex, handleCardClick } = useVideoActions({
    props,
    emit: ctx?.emit,
  });
  const [current, setCurrent] = React.useState(0);

  React.useEffect(() => {
    if (current >= videos.length) {
      setCurrent(0);
    }
  }, [current, videos.length]);

  const autoplayMs = Math.max(0, toNumber(props.autoplayMs, 0));
  React.useEffect(() => {
    if (autoplayMs <= 0 || videos.length <= 1) return;
    const timer = window.setInterval(() => {
      setCurrent((prev) => (prev + 1) % videos.length);
    }, autoplayMs);
    return () => window.clearInterval(timer);
  }, [autoplayMs, videos.length]);

  if (videos.length === 0) {
    return <EmptyVideoState title="VideoCarousel 未收到视频数组，请传入 props.videos 或 props.items。" />;
  }

  const item = videos[current];
  const height = clamp(toNumber(props.height, 280), 160, 680);
  const showThumbs = props.showThumbs !== false;

  return (
    <div className="w-full space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/40" style={{ height: `${height}px` }}>
        <button type="button" className="h-full w-full text-left" onClick={() => void handleCardClick(item, current)}>
          <VideoPoster item={item} className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-14 w-14 rounded-full bg-black/45 border border-white/20 text-white flex items-center justify-center">
              <Play className="w-6 h-6 ml-0.5" />
            </div>
          </div>
          <VideoMeta item={item} />
        </button>

        <div className="absolute left-2 top-2">
          <Badge variant="secondary" className="bg-black/45 text-white border-white/20">
            {current + 1} / {videos.length}
          </Badge>
        </div>

        <div className="absolute right-2 top-2 flex gap-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-7 w-7 bg-black/45 text-white border-white/20 hover:bg-black/65"
            onClick={() => {
              setActiveIndex(current);
              setOpen(true);
            }}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        {videos.length > 1 ? (
          <>
            <Button
              size="icon"
              variant="secondary"
              className="absolute left-2 top-1/2 h-8 w-8 -translate-y-1/2 bg-black/45 text-white border-white/20 hover:bg-black/65"
              onClick={() => setCurrent((prev) => (prev - 1 + videos.length) % videos.length)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 bg-black/45 text-white border-white/20 hover:bg-black/65"
              onClick={() => setCurrent((prev) => (prev + 1) % videos.length)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </>
        ) : null}
      </div>

      {showThumbs && videos.length > 1 ? (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {videos.map((entry, index) => (
            <button
              key={`${entry.src}-${index}`}
              type="button"
              className={cn(
                'h-16 w-28 shrink-0 overflow-hidden rounded-md border transition-all text-left',
                index === current ? 'border-foreground/60 ring-1 ring-foreground/25' : 'border-border/60 opacity-80 hover:opacity-100',
              )}
              onClick={() => setCurrent(index)}
            >
              <VideoPoster item={entry} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}

      <VideoPlayerDialog
        open={open}
        onOpenChange={setOpen}
        videos={videos}
        index={activeIndex}
        onIndexChange={setActiveIndex}
      />
    </div>
  );
}
