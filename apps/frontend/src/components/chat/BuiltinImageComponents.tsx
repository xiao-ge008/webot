import * as React from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Maximize2, Minus, Plus, RotateCcw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getApiBaseUrl } from '@/services/transport';

interface GalleryImageItem {
  src: string;
  rawSrc: string;
  title: string;
  description: string;
  alt: string;
}

const IMAGE_ACTION_DEFAULT = 'insert_image';
const IMAGE_CLICK_ACTIONS = new Set(['preview', 'send', 'sendandpreview']);

function toSafeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
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
    return encodeURI(`file://${source}`);
  }
  return source;
}

function shouldProxyRemoteImage(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function buildImageProxyUrl(baseUrl: string, rawUrl: string): string {
  return `${baseUrl}/api/management/media/image-proxy?url=${encodeURIComponent(rawUrl)}`;
}

function useResolvedImageSrc(src: string): string {
  const [resolved, setResolved] = React.useState(src);

  React.useEffect(() => {
    let cancelled = false;
    const raw = src.trim();
    if (!raw || !shouldProxyRemoteImage(raw)) {
      setResolved(src);
      return () => {
        cancelled = true;
      };
    }

    getApiBaseUrl()
      .then((baseUrl) => {
        if (cancelled) return;
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
  onSendImage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: GalleryImageItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onSendImage: (item: GalleryImageItem) => void;
}) {
  const [zoom, setZoom] = React.useState(1);
  const [copied, setCopied] = React.useState(false);
  const copyResetTimerRef = React.useRef<number | null>(null);
  const current = images[index];
  const hasMultiple = images.length > 1;

  React.useEffect(() => {
    setZoom(1);
    setCopied(false);
  }, [index, open]);

  React.useEffect(() => () => {
    if (copyResetTimerRef.current != null) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
  }, []);

  const goPrev = React.useCallback(() => {
    if (images.length <= 1) return;
    onIndexChange((index - 1 + images.length) % images.length);
  }, [images.length, index, onIndexChange]);

  const goNext = React.useCallback(() => {
    if (images.length <= 1) return;
    onIndexChange((index + 1) % images.length);
  }, [images.length, index, onIndexChange]);

  if (!current) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 border-border/50 bg-black/90 overflow-hidden">
        <div className="absolute left-3 top-3 z-20 inline-flex items-center gap-2">
          <Badge variant="secondary" className="bg-white/15 text-white border-white/20">
            {index + 1} / {images.length}
          </Badge>
          {current.title ? <span className="text-xs text-white/90">{current.title}</span> : null}
        </div>

        <div className="absolute right-3 top-3 z-20 inline-flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
            onClick={async () => {
              const ok = await copyTextToClipboard(current.rawSrc || current.src);
              setCopied(ok);
              if (copyResetTimerRef.current != null) {
                window.clearTimeout(copyResetTimerRef.current);
              }
              copyResetTimerRef.current = window.setTimeout(() => {
                setCopied(false);
                copyResetTimerRef.current = null;
              }, 1600);
            }}
          >
            {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
            {copied ? '已复制' : '复制图片链接'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
            onClick={() => onSendImage(current)}
          >
            <Send className="w-3.5 h-3.5 mr-1" />
            发送到输入框
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
            onClick={() => setZoom((prev) => clamp(prev - 0.2, 0.4, 4))}
          >
            <Minus className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
            onClick={() => setZoom((prev) => clamp(prev + 0.2, 0.4, 4))}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
            onClick={() => setZoom(1)}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="h-full w-full flex items-center justify-center overflow-hidden px-4 py-14">
          <img
            src={current.src}
            alt={current.alt}
            draggable={false}
            style={{ transform: `scale(${zoom})` }}
            className="max-h-full max-w-full object-contain select-none transition-transform duration-150"
          />
        </div>

        {hasMultiple ? (
          <>
            <Button
              size="icon"
              variant="secondary"
              className="absolute left-3 top-1/2 z-20 h-9 w-9 -translate-y-1/2 bg-white/15 text-white hover:bg-white/25 border-white/20"
              onClick={goPrev}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="absolute right-3 top-1/2 z-20 h-9 w-9 -translate-y-1/2 bg-white/15 text-white hover:bg-white/25 border-white/20"
              onClick={goNext}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </>
        ) : null}

        {current.description ? (
          <div className="absolute bottom-3 left-3 right-3 z-20 rounded-md bg-black/45 text-white/90 text-xs px-3 py-2 border border-white/10">
            {current.description}
          </div>
        ) : null}
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
          onSendImage={emitImage}
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
        onSendImage={emitImage}
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
          onSendImage={emitImage}
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
        onSendImage={emitImage}
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
        onSendImage={emitImage}
      />
    </div>
  );
}

