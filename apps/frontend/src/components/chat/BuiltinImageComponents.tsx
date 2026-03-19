import * as React from 'react';
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Send, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { getApiBaseUrl } from '@/services/transport';
import { requestJson } from '@/services/transport';

interface GalleryImageItem {
  src: string;
  rawSrc: string;
  title: string;
  description: string;
  alt: string;
}

const IMAGE_ACTION_DEFAULT = 'insert_image';
const IMAGE_CLICK_ACTIONS = new Set(['preview', 'send', 'sendandpreview']);
const IMAGE_CARD_STAGE_MIN_HEIGHT = 'min-h-[224px] md:min-h-[248px]';

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
  const windowsDrivePath = /^[a-zA-Z]:[\\/]/.test(source);
  if (windowsDrivePath) {
    const normalized = source.replace(/\\/g, '/');
    return encodeURI(`file:///${normalized}`);
  }
  if (source.startsWith('\\\\')) {
    const normalized = source.replace(/\\/g, '/');
    return encodeURI(`file:${normalized}`);
  }
  if (source.startsWith('/')) {
    return source;
  }
  return source;
}

function shouldProxyRemoteImage(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function shouldResolveBackendRelativeImage(url: string): boolean {
  const value = url.trim();
  return value.startsWith('/') || value.startsWith('api/');
}

function buildImageProxyUrl(baseUrl: string, rawUrl: string): string {
  return `${baseUrl}/api/management/media/image-proxy?url=${encodeURIComponent(rawUrl)}`;
}

function buildBackendImageUrl(baseUrl: string, rawPath: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `${normalizedBase}${normalizedPath}`;
}

function useResolvedImageSrc(src: string): string {
  const [resolved, setResolved] = React.useState(src);

  React.useEffect(() => {
    let cancelled = false;
    const raw = src.trim();
    if (!raw) {
      setResolved(src);
      return () => {
        cancelled = true;
      };
    }

    if (!shouldProxyRemoteImage(raw) && !shouldResolveBackendRelativeImage(raw)) {
      setResolved(src);
      return () => {
        cancelled = true;
      };
    }

    getApiBaseUrl()
      .then((baseUrl) => {
        if (cancelled) return;
        if (shouldResolveBackendRelativeImage(raw)) {
          setResolved(buildBackendImageUrl(baseUrl, raw));
          return;
        }
        setResolved(buildImageProxyUrl(baseUrl, raw));
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

function ProxyImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const src = typeof props.src === 'string' ? props.src : '';
  const resolvedSrc = useResolvedImageSrc(src);
  return <img {...props} src={resolvedSrc} />;
}

function normalizeGalleryItems(props: Record<string, unknown>): GalleryImageItem[] {
  const candidates = Array.isArray(props.images)
    ? props.images
    : Array.isArray(props.items)
      ? props.items
      : [];

  const normalized = candidates
    .map((item, index): GalleryImageItem | null => {
      if (typeof item === 'string') {
        const rawSrc = item.trim();
        if (!rawSrc) return null;
        return {
          src: normalizeFileLikeUrl(rawSrc),
          rawSrc,
          title: '',
          description: '',
          alt: `image-${index + 1}`,
        };
      }

      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const rawSrc = toSafeText(record.src) || toSafeText(record.url) || toSafeText(record.path) || toSafeText(record.image);
      if (!rawSrc) {
        return null;
      }

      return {
        src: normalizeFileLikeUrl(rawSrc),
        rawSrc,
        title: toSafeText(record.title),
        description: toSafeText(record.description) || toSafeText(record.subtitle),
        alt: toSafeText(record.alt) || toSafeText(record.title) || `image-${index + 1}`,
      };
    })
    .filter((item): item is GalleryImageItem => Boolean(item?.src));

  if (normalized.length > 0) {
    return normalized;
  }

  const rawSingle = toSafeText(props.src) || toSafeText(props.url) || toSafeText(props.path) || toSafeText(props.image);
  if (!rawSingle) {
    return [];
  }

  return [{
    src: normalizeFileLikeUrl(rawSingle),
    rawSrc: rawSingle,
    title: toSafeText(props.title),
    description: toSafeText(props.description),
    alt: toSafeText(props.alt) || toSafeText(props.title) || 'image',
  }];
}

function extractGalleryItemsFromResult(result: unknown): GalleryImageItem[] {
  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return normalizeGalleryItems({ items: result });
  }

  if (typeof result !== 'object') {
    return [];
  }

  const record = result as Record<string, unknown>;
  const direct = normalizeGalleryItems(record);
  if (direct.length > 0) {
    return direct;
  }

  if (record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)) {
    const fromRaw = normalizeGalleryItems(record.raw as Record<string, unknown>);
    if (fromRaw.length > 0) {
      return fromRaw;
    }
  }

  if (Array.isArray(record.raw)) {
    const fromRawArray = normalizeGalleryItems({ items: record.raw });
    if (fromRawArray.length > 0) {
      return fromRawArray;
    }
  }

  return [];
}

function parseClickAction(value: unknown): 'preview' | 'send' | 'sendAndPreview' {
  const normalized = toSafeText(value, 'sendAndPreview').toLowerCase();
  if (!IMAGE_CLICK_ACTIONS.has(normalized)) {
    return 'sendAndPreview';
  }
  if (normalized === 'sendandpreview') {
    return 'sendAndPreview';
  }
  return normalized as 'preview' | 'send';
}

function resolveAspectRatio(value: unknown, fallback = 4 / 3): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return fallback;
    if (text.includes('/')) {
      const [left, right] = text.split('/');
      const num = Number(left);
      const den = Number(right);
      if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
        return num / den;
      }
      return fallback;
    }
    const ratio = Number(text);
    if (Number.isFinite(ratio) && ratio > 0) {
      return ratio;
    }
  }
  return fallback;
}

function useHorizontalScrollArrows(enabled: boolean, stepPx: number, watchKey: number) {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);

  const updateScrollState = React.useCallback(() => {
    const node = scrollerRef.current;
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
    if (!enabled) {
      setCanScrollPrev(false);
      setCanScrollNext(false);
      return;
    }

    updateScrollState();
    const node = scrollerRef.current;
    if (!node) return;

    const onScroll = () => updateScrollState();
    node.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateScrollState())
      : null;
    observer?.observe(node);

    return () => {
      node.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [enabled, updateScrollState, watchKey]);

  const scrollByStep = React.useCallback((direction: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) return;
    const step = Math.max(120, stepPx);
    node.scrollBy({ left: direction * step, behavior: 'smooth' });
  }, [stepPx]);

  return {
    scrollerRef,
    canScrollPrev,
    canScrollNext,
    scrollByStep,
  };
}

function ImagePreviewDialog({
  open,
  onOpenChange,
  images,
  index,
  onIndexChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: GalleryImageItem[];
  index: number;
  onIndexChange: (next: number) => void;
}) {
  const current = images[index];
  const hasMultiple = images.length > 1;

  const goPrev = React.useCallback(() => {
    if (images.length <= 1) return;
    onIndexChange((index - 1 + images.length) % images.length);
  }, [images.length, index, onIndexChange]);

  const goNext = React.useCallback(() => {
    if (images.length <= 1) return;
    onIndexChange((index + 1) % images.length);
  }, [images.length, index, onIndexChange]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev, open]);

  if (!current) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[96vh] w-[96vw] max-w-none overflow-hidden border-0 bg-black/96 p-0 shadow-none [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">
          {current.title || current.alt || `图片预览 ${index + 1}`}
        </DialogTitle>
        <div className="relative h-full w-full overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center p-2 md:p-4">
            <ProxyImage
              src={current.src}
              alt={current.alt}
              draggable={false}
              className="h-full w-full select-none object-contain"
            />
          </div>

          <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
            {hasMultiple ? (
              <Badge variant="secondary" className="h-7 rounded-full border-0 bg-white/10 px-3 text-[11px] text-white backdrop-blur-sm">
                {index + 1} / {images.length}
              </Badge>
            ) : null}
          </div>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-3 top-3 z-20 h-9 w-9 rounded-full border-0 bg-white/10 text-white backdrop-blur-sm hover:bg-white/16 hover:text-white focus-visible:ring-0"
            onClick={() => onOpenChange(false)}
            aria-label="关闭预览"
          >
            <X className="h-4 w-4" />
          </Button>

          {hasMultiple ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute left-3 top-1/2 z-20 h-11 w-11 -translate-y-1/2 rounded-full border-0 bg-white/10 text-white backdrop-blur-sm hover:bg-white/16 hover:text-white focus-visible:ring-0"
                onClick={goPrev}
                aria-label="上一张"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute right-3 top-1/2 z-20 h-11 w-11 -translate-y-1/2 rounded-full border-0 bg-white/10 text-white backdrop-blur-sm hover:bg-white/16 hover:text-white focus-visible:ring-0"
                onClick={goNext}
                aria-label="下一张"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : null}

          {hasMultiple ? (
            <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
              <div className="flex max-w-full gap-2 overflow-x-auto rounded-full bg-white/8 px-2 py-2 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {images.map((item, itemIndex) => (
                  <button
                    key={`${item.src}-${itemIndex}`}
                    type="button"
                    className={cn(
                      'relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl transition-all focus-visible:ring-0 md:h-16 md:w-16',
                      itemIndex === index
                        ? 'ring-2 ring-white/90'
                        : 'opacity-55 hover:opacity-100',
                    )}
                    onClick={() => onIndexChange(itemIndex)}
                    aria-label={`查看第 ${itemIndex + 1} 张图片`}
                  >
                    <ProxyImage src={item.src} alt={item.alt} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function useGalleryActions(ctx: { props: Record<string, unknown>; emit?: (name: string, payload?: unknown) => void }) {
  const images = React.useMemo(() => normalizeGalleryItems(ctx.props), [ctx.props]);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const sendAction = toSafeText(ctx.props.sendAction, IMAGE_ACTION_DEFAULT) || IMAGE_ACTION_DEFAULT;
  const clickAction = parseClickAction(ctx.props.clickAction);

  const emitImage = React.useCallback((item: GalleryImageItem) => {
    ctx.emit?.(sendAction, {
      src: item.rawSrc || item.src,
      previewSrc: item.src,
      alt: item.alt,
      title: item.title,
      description: item.description,
    });
  }, [ctx, sendAction]);

  const openViewer = React.useCallback((index: number) => {
    setActiveIndex(index);
    setOpen(true);
  }, []);

  const handleClick = React.useCallback((item: GalleryImageItem, index: number) => {
    if (clickAction === 'send') {
      emitImage(item);
      return;
    }
    if (clickAction === 'preview') {
      openViewer(index);
      return;
    }
    emitImage(item);
    openViewer(index);
  }, [clickAction, emitImage, openViewer]);

  return {
    images,
    open,
    setOpen,
    activeIndex,
    setActiveIndex,
    emitImage,
    handleClick,
  };
}

function EmptyImageState({ title }: { title: string }) {
  return (
    <div className="w-full rounded-xl border border-dashed border-border/70 bg-muted/20 text-muted-foreground px-4 py-6 text-sm">
      {title}
    </div>
  );
}

interface ComponentImageParameterMapping {
  id: string;
  parameterName: string;
  label: string;
  valueType: string;
  description: string;
  defaultValue: unknown;
  required: boolean;
  options: unknown[];
}

interface ComponentImageDefinition {
  name: string;
  englishName: string;
  description: string;
  workflow: {
    parameterMappings: ComponentImageParameterMapping[];
  };
}

interface ComponentImageRunSnapshot {
  result?: unknown;
  elapsedSeconds?: number;
  values?: Record<string, unknown>;
  error?: string;
}

interface ComponentImageInflightRun {
  startedAt: number;
  values: Record<string, unknown>;
  promise: Promise<ComponentImageRunSnapshot>;
}

const componentImageRuntimeSnapshots = new Map<string, ComponentImageRunSnapshot>();
const componentImageInflightRuns = new Map<string, ComponentImageInflightRun>();

function safeStorageGet(key: string) {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

function safeStorageRemove(key: string) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function buildComponentImageCacheKey(
  componentName: string,
  messageId: string | undefined,
  initialValues: Record<string, unknown>,
) {
  if (messageId && messageId.trim()) {
    return `webot:component-image:${componentName}:message:${messageId.trim()}`;
  }
  return `webot:component-image:${componentName}:props:${stableStringify(initialValues)}`;
}

function buildComponentInitialValues(
  mappings: ComponentImageParameterMapping[],
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

function hasMissingRequiredValues(
  mappings: ComponentImageParameterMapping[],
  values: Record<string, unknown>,
): boolean {
  return mappings.some((mapping) => {
    if (!mapping?.required) return false;
    const value = values[mapping.parameterName];
    return value === '' || value === null || value === undefined;
  });
}

function buildInvokePayload(
  mappings: ComponentImageParameterMapping[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, raw]) => {
      const mapping = mappings.find((item) => item.parameterName === key);
      return [key, normalizeComponentParamValue(raw, mapping?.valueType || 'string')];
    }),
  );
}

function normalizeComponentParamValue(raw: unknown, valueType: string) {
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

function ComponentImageSettingsDialog({
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
  mappings: ComponentImageParameterMapping[];
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
            <DialogTitle>{title || '图片生成设置'}</DialogTitle>
          </div>
          <DialogDescription>{description || '调整参数后重新生成图片。'}</DialogDescription>
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
              const fieldId = `component-image-setting-${String(mapping.id || key)}`;

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
                        {options.map((option, index) => {
                          const optionRecord = typeof option === 'object' && option !== null
                            ? option as Record<string, unknown>
                            : null;
                          const optionValue = optionRecord
                            ? (optionRecord.value ?? optionRecord.index ?? optionRecord.name ?? optionRecord.label ?? String(index))
                            : option;
                          const optionLabel = optionRecord
                            ? (optionRecord.label ?? optionRecord.name ?? optionRecord.description ?? optionValue)
                            : optionValue;
                          return (
                            <SelectItem key={String(optionValue)} value={String(optionValue)}>
                              {String(optionLabel)}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  ) : valueType === 'boolean' ? (
                    <div className="flex min-h-11 items-center justify-between rounded-lg border px-3 py-2">
                      <span className="text-sm text-muted-foreground">
                        {Boolean(currentValue) ? '已启用' : '未启用'}
                      </span>
                      <Switch
                        checked={Boolean(currentValue)}
                        onCheckedChange={(checked) => onChange(key, checked)}
                        disabled={submitting}
                      />
                    </div>
                  ) : valueType === 'number' ? (
                    <Input
                      id={fieldId}
                      type="number"
                      value={currentValue as any}
                      onChange={(event) => onChange(key, event.target.value)}
                      disabled={submitting}
                      className={`h-11 ${quietFieldClassName}`}
                    />
                  ) : valueType === 'json' ? (
                    <Textarea
                      id={fieldId}
                      value={typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue ?? '', null, 2)}
                      onChange={(event) => onChange(key, event.target.value)}
                      disabled={submitting}
                      rows={5}
                      className={`min-h-28 resize-y ${quietFieldClassName}`}
                    />
                  ) : (
                    <Textarea
                      id={fieldId}
                      value={String(currentValue ?? '')}
                      onChange={(event) => onChange(key, event.target.value)}
                      disabled={submitting}
                      rows={key.toLowerCase().includes('prompt') ? 6 : 3}
                      className={cn(
                        quietFieldClassName,
                        key.toLowerCase().includes('prompt') ? 'min-h-40 resize-y leading-7' : 'min-h-24 resize-y',
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t px-6 py-4 sm:justify-stretch">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            关闭
          </Button>
          <Button type="button" onClick={onSubmit} disabled={submitting} className="h-11 min-w-32">
            {submitting ? '生成中...' : '重新生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComponentImageGallery({
  images,
  onOpen,
  overlay,
}: {
  images: GalleryImageItem[];
  onOpen: (index: number) => void;
  overlay?: React.ReactNode;
}) {
  if (images.length === 0) return null;

  const renderTile = (
    item: GalleryImageItem,
    index: number,
    className: string,
    overlay?: React.ReactNode,
  ) => (
    <button
      key={`${item.src}-${index}`}
      type="button"
      onClick={() => onOpen(index)}
      className={cn(
        'group relative block overflow-hidden rounded-[26px] bg-muted/25 text-left shadow-sm outline-none transition-transform duration-300 focus-visible:ring-0',
        className,
      )}
    >
      <ProxyImage
        src={item.src}
        alt={item.alt}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/18 via-transparent to-transparent opacity-80 transition-opacity duration-300 group-hover:opacity-100" />
      {overlay}
    </button>
  );

  if (images.length === 1) {
    return (
      <div className={cn('flex items-center', IMAGE_CARD_STAGE_MIN_HEIGHT)}>
        <div className="relative mx-auto w-full max-w-[720px]">
          {overlay}
          {renderTile(images[0], 0, 'aspect-[4/5] rounded-[30px]')}
        </div>
      </div>
    );
  }

  if (images.length === 2) {
    return (
      <div className={cn('flex items-center', IMAGE_CARD_STAGE_MIN_HEIGHT)}>
        <div className="relative mx-auto w-full max-w-[860px]">
          {overlay}
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            {images.map((item, index) => renderTile(item, index, 'aspect-[4/5] rounded-[28px]'))}
          </div>
        </div>
      </div>
    );
  }

  if (images.length === 3) {
    return (
      <div className={cn('flex items-center', IMAGE_CARD_STAGE_MIN_HEIGHT)}>
        <div className="relative mx-auto w-full max-w-[980px]">
          {overlay}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:grid-rows-2 md:gap-4">
            {renderTile(images[0], 0, 'aspect-[4/5] md:row-span-2 md:h-full md:aspect-auto rounded-[30px]')}
            {renderTile(images[1], 1, 'aspect-[4/3] md:h-full rounded-[24px]')}
            {renderTile(images[2], 2, 'aspect-[4/3] md:h-full rounded-[24px]')}
          </div>
        </div>
      </div>
    );
  }

  if (images.length === 4) {
    return (
      <div className={cn('flex items-center', IMAGE_CARD_STAGE_MIN_HEIGHT)}>
        <div className="relative mx-auto w-full max-w-[1180px]">
          {overlay}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {images.map((item, index) => renderTile(item, index, 'aspect-[4/5] rounded-[24px] md:rounded-[22px]'))}
          </div>
        </div>
      </div>
    );
  }

  const visibleImages = images.slice(0, 5);
  const hiddenCount = Math.max(0, images.length - visibleImages.length);

  return (
    <div className={cn('flex items-center', IMAGE_CARD_STAGE_MIN_HEIGHT)}>
      <div className="relative mx-auto w-full max-w-[1180px]">
        {overlay}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:grid-rows-2 md:gap-4">
          {renderTile(visibleImages[0], 0, 'col-span-2 aspect-[16/10] md:row-span-2 md:h-full md:aspect-auto rounded-[30px]')}
          {visibleImages[1] ? renderTile(visibleImages[1], 1, 'aspect-[4/3] rounded-[24px]') : null}
          {visibleImages[2] ? renderTile(visibleImages[2], 2, 'aspect-[4/3] rounded-[24px]') : null}
          {visibleImages[3] ? renderTile(visibleImages[3], 3, 'aspect-[4/3] rounded-[24px]') : null}
          {visibleImages[4] ? renderTile(
            visibleImages[4],
            4,
            'aspect-[4/3] rounded-[24px]',
            hiddenCount > 0 ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/42">
                <div className="rounded-full bg-background/90 px-3 py-1 text-sm font-medium text-foreground shadow-sm">
                  +{hiddenCount}
                </div>
              </div>
            ) : null,
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function GenUIComponentImageCard(ctx: any) {
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
    () => buildComponentImageCacheKey(componentName, messageId || undefined, initialValues),
    [componentName, initialValues, messageId],
  );
  const [definition, setDefinition] = React.useState<ComponentImageDefinition | null>(null);
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState<unknown>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [runStartedAt, setRunStartedAt] = React.useState<number | null>(null);
  const [finishedElapsedSeconds, setFinishedElapsedSeconds] = React.useState(0);
  const [clockMs, setClockMs] = React.useState(() => Date.now());
  const autoRanRef = React.useRef(false);

  const invokeWith = React.useCallback(async (
    definitionArg: ComponentImageDefinition,
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
    const runTask = (async (): Promise<ComponentImageRunSnapshot> => {
      const payload = buildInvokePayload(mappings, nextValues);
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
    componentImageInflightRuns.set(cacheKey, {
      startedAt,
      values: nextValues,
      promise: runTask,
    });
    try {
      const snapshot = await runTask;
      setFinishedElapsedSeconds(snapshot.elapsedSeconds ?? 0);
      setResult(snapshot.result ?? null);
      componentImageRuntimeSnapshots.set(cacheKey, snapshot);
      safeStorageSet(cacheKey, JSON.stringify({
        elapsedSeconds: snapshot.elapsedSeconds ?? 0,
        result: snapshot.result,
        values: nextValues,
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err || '调用失败');
      setError(errorMessage);
      componentImageRuntimeSnapshots.set(cacheKey, {
        error: errorMessage,
        values: nextValues,
      });
      autoRanRef.current = false;
    } finally {
      const inflight = componentImageInflightRuns.get(cacheKey);
      if (inflight?.promise === runTask) {
        componentImageInflightRuns.delete(cacheKey);
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
    const runtimeSnapshot = componentImageRuntimeSnapshots.get(cacheKey);
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

    const inflight = componentImageInflightRuns.get(cacheKey);
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
    const cached = safeStorageGet(cacheKey);
    if (!cached) return;
    try {
      const parsed = JSON.parse(cached) as {
        result?: unknown;
        elapsedSeconds?: number;
        values?: Record<string, unknown>;
      };
      if (parsed.result) {
        const cachedImages = extractGalleryItemsFromResult(parsed.result);
        if (cachedImages.length > 0) {
          setResult(parsed.result);
          autoRanRef.current = true;
          componentImageRuntimeSnapshots.set(cacheKey, {
            result: parsed.result,
            elapsedSeconds: parsed.elapsedSeconds,
            values: parsed.values,
          });
        } else {
          safeStorageRemove(cacheKey);
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
    requestJson<{ item?: ComponentImageDefinition }>(`/api/management/components/${encodeURIComponent(componentName)}`)
      .then((payload) => {
        if (!active) return;
        const item = payload?.item ?? null;
        setDefinition(item);
        const mappings = Array.isArray(item?.workflow?.parameterMappings) ? item.workflow.parameterMappings : [];
        const nextValues = {
          ...buildComponentInitialValues(mappings, initialValues),
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
            && !hasMissingRequiredValues(mappings, merged)
          ) {
            autoRanRef.current = true;
            void invokeWith(item, merged);
          }
          return merged;
        });
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err || '加载组件失败'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [autoRun, componentName, initialValues, invokeWith]);

  React.useEffect(() => {
    if (!loading && !submitting) return undefined;
    const timer = window.setInterval(() => {
      setClockMs(Date.now());
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [loading, submitting]);

  React.useEffect(() => {
    if (!autoRun || !definition || autoRanRef.current) return;
    const mappings = Array.isArray(definition.workflow?.parameterMappings) ? definition.workflow.parameterMappings : [];
    if (hasMissingRequiredValues(mappings, values)) return;
    autoRanRef.current = true;
    void invoke();
  }, [autoRun, definition, invoke, values]);

  const images = React.useMemo(() => {
    return extractGalleryItemsFromResult(result);
  }, [result]);
  const elapsedSeconds = submitting && runStartedAt != null
    ? Math.max(0, Math.floor((clockMs - runStartedAt) / 1000))
    : finishedElapsedSeconds;
  const effectiveTitle = title || definition?.name || componentName;
  const effectiveDescription = description || definition?.description || '';

  if (!componentName) {
    return <div className="p-2 text-sm text-destructive">组件配置缺少 `componentName`。</div>;
  }

  if (loading) {
    return (
      <div className={cn(IMAGE_CARD_STAGE_MIN_HEIGHT, 'animate-pulse rounded-[28px] bg-muted/40')} />
    );
  }

  if (error && !definition) {
    return <div className="p-2 text-sm text-destructive">{error}</div>;
  }

  const elapsedLabel = submitting
    ? formatDurationLabel(elapsedSeconds)
    : finishedElapsedSeconds > 0
      ? formatDurationLabel(finishedElapsedSeconds)
      : '';
  const galleryOverlay = (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-2 opacity-90 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
      {elapsedLabel ? (
        <div className="rounded-full border-0 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm">
          {elapsedLabel}
        </div>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 rounded-full border-0 bg-white/10 text-white shadow-sm backdrop-blur-sm hover:bg-white/16 hover:text-white focus-visible:ring-0"
        onClick={() => setSettingsOpen(true)}
      >
        <Settings2 className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div className="relative">
      {images.length > 0 ? (
        <div className={cn('group relative', IMAGE_CARD_STAGE_MIN_HEIGHT)}>
          <ComponentImageGallery
            images={images}
            overlay={galleryOverlay}
            onOpen={(index) => {
              setViewerIndex(index);
              setViewerOpen(true);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={cn(
            IMAGE_CARD_STAGE_MIN_HEIGHT,
            'flex w-full flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground',
          )}
        >
          {submitting ? <Loader2 className="h-7 w-7 animate-spin" /> : <Settings2 className="h-6 w-6" />}
          <span>{submitting ? `生成中 ${formatDurationLabel(elapsedSeconds)}` : '点击设置开始生成'}</span>
        </button>
      )}

      {error ? <div className="mt-3 text-sm text-destructive">{error}</div> : null}

      <ComponentImageSettingsDialog
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

      <ImagePreviewDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        images={images}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
      />
    </div>
  );
}

export function GenUIImageCover(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  const { images, open, setOpen, activeIndex, setActiveIndex, emitImage, handleClick } = useGalleryActions({
    props,
    emit: ctx?.emit,
  });
  const item = images[0];
  if (!item) {
    return <EmptyImageState title="ImageCover 未收到可用图片，请传入 props.src/url/path 或 props.images。" />;
  }

  const compact = props.compact !== false;
  const hasMultiple = images.length > 1;
  const height = toNumber(props.height, hasMultiple ? 132 : 156);
  const width = toNumber(props.width, 0);
  const itemWidth = clamp(toNumber(props.itemWidth, 168), 96, 280);
  const radius = toNumber(props.radius, 16);
  const fit = toSafeText(props.fit, 'cover') || 'cover';
  const showCaption = props.showCaption !== false;
  const {
    scrollerRef: compactScrollerRef,
    canScrollPrev,
    canScrollNext,
    scrollByStep,
  } = useHorizontalScrollArrows(compact && hasMultiple, itemWidth + 28, images.length);

  if (hasMultiple && compact) {
    return (
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="text-xs text-muted-foreground">图片相册</div>
          <Badge variant="secondary" className="text-[10px] h-5 px-2">
            {images.length} 张
          </Badge>
        </div>
        <div className="relative group/image-cover-strip">
          <div ref={compactScrollerRef} className="overflow-x-auto pb-1 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max items-stretch gap-2 pr-1">
              {images.map((entry, index) => (
                <button
                  key={`${entry.src}-${index}`}
                  type="button"
                  className="group relative shrink-0 overflow-hidden rounded-lg border border-border/60 bg-card/40 hover:border-border transition-all text-left"
                  style={{
                    width: `${itemWidth}px`,
                    height: `${Math.max(92, height)}px`,
                    borderRadius: `${Math.max(6, radius - 2)}px`,
                  }}
                  onClick={() => handleClick(entry, index)}
                >
                  <ProxyImage
                    src={entry.src}
                    alt={entry.alt}
                    className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
                    style={{ objectFit: fit as any }}
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
                  {(entry.title || entry.description) && showCaption ? (
                    <div className="absolute inset-x-0 bottom-0 px-2 py-1.5">
                      {entry.title ? <div className="text-[11px] font-semibold text-white truncate">{entry.title}</div> : null}
                      {entry.description ? <div className="text-[10px] text-white/80 truncate">{entry.description}</div> : null}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className={cn(
              'absolute left-1 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-black/35 text-white border-white/15 shadow-sm transition-opacity',
              canScrollPrev ? 'opacity-0 group-hover/image-cover-strip:opacity-100' : 'opacity-0 pointer-events-none',
            )}
            onClick={() => scrollByStep(-1)}
            title="向左滚动"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className={cn(
              'absolute right-1 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-black/35 text-white border-white/15 shadow-sm transition-opacity',
              canScrollNext ? 'opacity-0 group-hover/image-cover-strip:opacity-100' : 'opacity-0 pointer-events-none',
            )}
            onClick={() => scrollByStep(1)}
            title="向右滚动"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <ImagePreviewDialog
          open={open}
          onOpenChange={setOpen}
          images={images}
          index={activeIndex}
          onIndexChange={setActiveIndex}
        />
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      <button
        type="button"
        className="group relative w-full overflow-hidden border border-border/60 bg-card/40 hover:border-border transition-all"
        style={{
          height: `${Math.max(92, height)}px`,
          width: width > 0 ? `${width}px` : '100%',
          borderRadius: `${Math.max(6, radius)}px`,
        }}
        onClick={() => handleClick(item, 0)}
      >
        <img
          src={item.src}
          alt={item.alt}
          className="h-full w-full transition-transform duration-300 group-hover:scale-[1.02]"
          style={{ objectFit: fit as any }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent opacity-90" />
        <div className="absolute right-2 top-2 flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-7 w-7 bg-black/45 text-white border-white/15 hover:bg-black/65"
            onClick={(event) => {
              event.stopPropagation();
              emitImage(item);
            }}
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-7 w-7 bg-black/45 text-white border-white/15 hover:bg-black/65"
            onClick={(event) => {
              event.stopPropagation();
              setActiveIndex(0);
              setOpen(true);
            }}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        {(item.title || item.description) && showCaption ? (
          <div className="absolute left-0 right-0 bottom-0 px-3 py-2 text-left">
            {item.title ? <div className="text-xs font-semibold text-white truncate">{item.title}</div> : null}
            {item.description ? <div className="text-[11px] text-white/80 truncate">{item.description}</div> : null}
          </div>
        ) : null}
      </button>

      <ImagePreviewDialog
        open={open}
        onOpenChange={setOpen}
        images={images}
        index={activeIndex}
        onIndexChange={setActiveIndex}
      />
    </div>
  );
}

export function GenUIImageAlbum(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  const { images, open, setOpen, activeIndex, setActiveIndex, emitImage, handleClick } = useGalleryActions({
    props,
    emit: ctx?.emit,
  });
  if (images.length === 0) {
    return <EmptyImageState title="ImageAlbum 未收到图片数组，请传入 props.images 或 props.items。" />;
  }

  const compact = props.compact !== false;
  const compactItemWidth = clamp(toNumber(props.itemWidth, 172), 96, 320);
  const compactHeight = clamp(toNumber(props.itemHeight, 118), 84, 240);
  const {
    scrollerRef: albumScrollerRef,
    canScrollPrev: canAlbumScrollPrev,
    canScrollNext: canAlbumScrollNext,
    scrollByStep: scrollAlbumByStep,
  } = useHorizontalScrollArrows(compact && images.length > 1, compactItemWidth + 24, images.length);

  const rawColumns = Math.round(toNumber(props.columns, 0));
  const columns = rawColumns <= 0 ? 0 : clamp(rawColumns, 1, 6);
  const gap = clamp(toNumber(props.gap, 10), 4, 24);
  const minWidth = clamp(toNumber(props.minItemWidth, 140), 96, 360);
  const ratio = resolveAspectRatio(props.aspectRatio, 4 / 3);
  const showCaption = props.showCaption !== false;
  const fit = toSafeText(props.fit, 'cover') || 'cover';

  if (compact) {
    return (
      <div className="w-full space-y-2">
        <div className="relative group/image-album-strip">
          <div ref={albumScrollerRef} className="overflow-x-auto pb-1 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max items-stretch gap-2 pr-1">
              {images.map((item, index) => (
                <button
                  key={`${item.src}-${index}`}
                  type="button"
                  className="group relative shrink-0 overflow-hidden rounded-lg border border-border/60 bg-card/45 hover:border-border transition-colors text-left"
                  style={{ width: `${compactItemWidth}px`, height: `${compactHeight}px` }}
                  onClick={() => handleClick(item, index)}
                >
                  <ProxyImage
                    src={item.src}
                    alt={item.alt}
                    className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
                    style={{ objectFit: fit as any }}
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
                  {(item.title || item.description) && showCaption ? (
                    <div className="absolute inset-x-0 bottom-0 px-2 py-1.5">
                      {item.title ? <div className="text-[11px] font-semibold text-white truncate">{item.title}</div> : null}
                      {item.description ? <div className="text-[10px] text-white/80 truncate">{item.description}</div> : null}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className={cn(
              'absolute left-1 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-black/35 text-white border-white/15 shadow-sm transition-opacity',
              canAlbumScrollPrev ? 'opacity-0 group-hover/image-album-strip:opacity-100' : 'opacity-0 pointer-events-none',
            )}
            onClick={() => scrollAlbumByStep(-1)}
            title="向左滚动"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className={cn(
              'absolute right-1 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-black/35 text-white border-white/15 shadow-sm transition-opacity',
              canAlbumScrollNext ? 'opacity-0 group-hover/image-album-strip:opacity-100' : 'opacity-0 pointer-events-none',
            )}
            onClick={() => scrollAlbumByStep(1)}
            title="向右滚动"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <ImagePreviewDialog
          open={open}
          onOpenChange={setOpen}
          images={images}
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
        {images.map((item, index) => (
          <button
            key={`${item.src}-${index}`}
            type="button"
            className="group relative overflow-hidden rounded-xl border border-border/60 bg-card/50 hover:border-border transition-colors text-left"
            style={{ aspectRatio: `${ratio}` }}
            onClick={() => handleClick(item, index)}
          >
            <img
              src={item.src}
              alt={item.alt}
              className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
              style={{ objectFit: fit as any }}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-transparent" />
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="absolute right-2 top-2 h-7 w-7 bg-black/45 text-white border-white/15 hover:bg-black/65"
              onClick={(event) => {
                event.stopPropagation();
                emitImage(item);
              }}
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
            {(item.title || item.description) && showCaption ? (
              <div className="absolute inset-x-0 bottom-0 p-2">
                {item.title ? <div className="text-xs font-semibold text-white truncate">{item.title}</div> : null}
                {item.description ? <div className="text-[11px] text-white/80 truncate">{item.description}</div> : null}
              </div>
            ) : null}
          </button>
        ))}
      </div>

      <ImagePreviewDialog
        open={open}
        onOpenChange={setOpen}
        images={images}
        index={activeIndex}
        onIndexChange={setActiveIndex}
      />
    </div>
  );
}

export function GenUIImageCarousel(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  const { images, open, setOpen, activeIndex, setActiveIndex, emitImage, handleClick } = useGalleryActions({
    props,
    emit: ctx?.emit,
  });
  const [current, setCurrent] = React.useState(0);

  React.useEffect(() => {
    if (current >= images.length) {
      setCurrent(0);
    }
  }, [current, images.length]);

  const autoplayMs = Math.max(0, toNumber(props.autoplayMs, 0));
  React.useEffect(() => {
    if (autoplayMs <= 0 || images.length <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      setCurrent((prev) => (prev + 1) % images.length);
    }, autoplayMs);
    return () => window.clearInterval(timer);
  }, [autoplayMs, images.length]);

  if (images.length === 0) {
    return <EmptyImageState title="ImageCarousel 未收到图片数组，请传入 props.images 或 props.items。" />;
  }

  const item = images[current];
  const height = clamp(toNumber(props.height, 260), 140, 640);
  const fit = toSafeText(props.fit, 'cover') || 'cover';
  const showThumbs = props.showThumbs !== false;

  return (
    <div className="w-full space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/40" style={{ height: `${height}px` }}>
        <button type="button" className="h-full w-full text-left" onClick={() => handleClick(item, current)}>
          <ProxyImage src={item.src} alt={item.alt} className="h-full w-full" style={{ objectFit: fit as any }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
          {(item.title || item.description) ? (
            <div className="absolute left-0 right-0 bottom-0 p-3">
              {item.title ? <div className="text-sm font-semibold text-white">{item.title}</div> : null}
              {item.description ? <div className="text-xs text-white/80">{item.description}</div> : null}
            </div>
          ) : null}
        </button>

        <div className="absolute left-2 top-2">
          <Badge variant="secondary" className="bg-black/45 text-white border-white/15">
            {current + 1} / {images.length}
          </Badge>
        </div>

        <div className="absolute right-2 top-2 flex gap-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-7 w-7 bg-black/45 text-white border-white/15 hover:bg-black/65"
            onClick={() => emitImage(item)}
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-7 w-7 bg-black/45 text-white border-white/15 hover:bg-black/65"
            onClick={() => {
              setActiveIndex(current);
              setOpen(true);
            }}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        {images.length > 1 ? (
          <>
            <Button
              size="icon"
              variant="secondary"
              className="absolute left-2 top-1/2 h-8 w-8 -translate-y-1/2 bg-black/45 text-white border-white/15 hover:bg-black/65"
              onClick={() => setCurrent((prev) => (prev - 1 + images.length) % images.length)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 bg-black/45 text-white border-white/15 hover:bg-black/65"
              onClick={() => setCurrent((prev) => (prev + 1) % images.length)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </>
        ) : null}
      </div>

      {showThumbs && images.length > 1 ? (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {images.map((entry, index) => (
            <button
              key={`${entry.src}-${index}`}
              type="button"
              className={cn(
                'h-14 w-20 shrink-0 overflow-hidden rounded-md border transition-all',
                index === current ? 'border-foreground/50 ring-1 ring-foreground/20' : 'border-border/60 opacity-80 hover:opacity-100',
              )}
              onClick={() => setCurrent(index)}
            >
              <ProxyImage src={entry.src} alt={entry.alt} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}

      <ImagePreviewDialog
        open={open}
        onOpenChange={setOpen}
        images={images}
        index={activeIndex}
        onIndexChange={setActiveIndex}
      />
    </div>
  );
}

