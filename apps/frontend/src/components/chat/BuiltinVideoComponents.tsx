import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize2,
  MonitorPlay,
  Play,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  isDesktopMediaRuntime,
  launchMpvPlayer,
  openMediaExternal,
  openMediaWebviewWindow,
} from '@/services/media-player-client';

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

function toSafeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
    return encodeURI(`file://${source}`);
  }
  return source;
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

function VideoPoster({
  item,
  className,
}: {
  item: VideoItem;
  className?: string;
}) {
  if (item.poster) {
    return <img src={item.poster} alt={item.title || 'video-poster'} className={className} />;
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

  React.useEffect(() => {
    if (open) {
      setStatusText('');
    }
  }, [open, index]);

  if (!current) return null;

  const openWebviewWindow = async () => {
    try {
      const ok = await openMediaWebviewWindow(current.rawSrc, current.title || '媒体播放器');
      if (!ok) {
        openMediaExternal(current.rawSrc || current.src);
        setStatusText('独立窗口不可用，已回退浏览器播放。');
        return;
      }
      setStatusText('已在独立窗口打开。');
    } catch {
      openMediaExternal(current.rawSrc || current.src);
      setStatusText('独立窗口打开失败，已回退浏览器播放。');
    }
  };

  const openInBrowser = () => {
    openMediaExternal(current.rawSrc || current.src);
    setStatusText('已在当前浏览器打开。');
  };

  const openMpv = async () => {
    const result = await launchMpvPlayer(current.rawSrc || current.src);
    if (!result.ok) {
      setStatusText(result.message || 'MPV 启动失败');
    } else {
      setStatusText('已调用 MPV 播放器。');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 border-border/50 bg-black/95 overflow-hidden [&>button]:hidden">
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
              src={current.src}
              poster={current.poster || undefined}
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
