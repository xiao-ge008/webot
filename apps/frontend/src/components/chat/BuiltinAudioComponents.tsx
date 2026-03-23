import * as React from 'react';
import {
  ExternalLink,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  Send,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isDesktopMediaRuntime, launchMpvPlayer, openMediaExternal } from '@/services/media-player-client';
import { getApiBaseUrl } from '@/services/transport';

interface AudioItem {
  src: string;
  rawSrc: string;
  title: string;
  subtitle: string;
  artist: string;
  album: string;
  cover: string;
  durationText: string;
  live: boolean;
}

const AUDIO_SEND_ACTION_DEFAULT = 'insert_audio';
const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2];
const LOCAL_MANAGEMENT_ASSET_URL_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/api\/management\/agents\/.+)$/i;

function toSafeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toFunction<T extends (...args: any[]) => unknown>(value: unknown): T | undefined {
  return typeof value === 'function' ? value as T : undefined;
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
  if (source.startsWith('/api/')) {
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

function normalizeLocalManagementAssetUrl(baseUrl: string | undefined, assetUrl: string | undefined): string | undefined {
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, '');
  const normalizedAssetUrl = assetUrl?.trim();
  if (!normalizedAssetUrl) {
    return normalizedAssetUrl;
  }
  if (!normalizedBaseUrl) {
    return normalizedAssetUrl;
  }
  const localMatch = normalizedAssetUrl.match(LOCAL_MANAGEMENT_ASSET_URL_PATTERN);
  if (localMatch) {
    return `${normalizedBaseUrl}${localMatch[1]}`;
  }
  if (normalizedAssetUrl.startsWith('/api/management/')) {
    return `${normalizedBaseUrl}${normalizedAssetUrl}`;
  }
  return normalizedAssetUrl;
}

function formatDuration(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const seconds = Math.floor(value);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

function secondsToText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function looksLikeLiveStream(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return /(\.m3u8(\?.*)?$)|radio|stream|fm|live/.test(lower);
}

function normalizeAudioItems(props: Record<string, unknown>): AudioItem[] {
  const list = Array.isArray(props.audios)
    ? props.audios
    : Array.isArray(props.items)
      ? props.items
      : Array.isArray(props.playlist)
        ? props.playlist
        : [];

  const normalized = list
    .map((item, index): AudioItem | null => {
      if (typeof item === 'string') {
        const rawSrc = item.trim();
        if (!rawSrc) return null;
        return {
          src: normalizeFileLikeUrl(rawSrc),
          rawSrc,
          title: '',
          subtitle: '',
          artist: '',
          album: '',
          cover: '',
          durationText: '',
          live: looksLikeLiveStream(rawSrc),
        };
      }

      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const rawSrc = toSafeText(record.src) || toSafeText(record.url) || toSafeText(record.path) || toSafeText(record.audio);
      if (!rawSrc) return null;
      return {
        src: normalizeFileLikeUrl(rawSrc),
        rawSrc,
        title: toSafeText(record.title) || toSafeText(record.name) || `音频 ${index + 1}`,
        subtitle: toSafeText(record.subtitle) || toSafeText(record.description),
        artist: toSafeText(record.artist),
        album: toSafeText(record.album),
        cover: normalizeFileLikeUrl(toSafeText(record.cover) || toSafeText(record.poster) || toSafeText(record.thumbnail)),
        durationText: formatDuration(record.duration),
        live: toBoolean(record.live, looksLikeLiveStream(rawSrc)),
      };
    })
    .filter((item): item is AudioItem => Boolean(item?.src));

  if (normalized.length > 0) {
    return normalized;
  }

  const rawSingle = toSafeText(props.src) || toSafeText(props.url) || toSafeText(props.path) || toSafeText(props.audio);
  if (!rawSingle) {
    return [];
  }
  return [{
    src: normalizeFileLikeUrl(rawSingle),
    rawSrc: rawSingle,
    title: toSafeText(props.title) || '语音音频',
    subtitle: toSafeText(props.subtitle) || toSafeText(props.description),
    artist: toSafeText(props.artist),
    album: toSafeText(props.album),
    cover: normalizeFileLikeUrl(toSafeText(props.cover) || toSafeText(props.poster) || toSafeText(props.thumbnail)),
    durationText: formatDuration(props.duration),
    live: toBoolean(props.live, looksLikeLiveStream(rawSingle)),
  }];
}

function CoverArt({ current }: { current: AudioItem }) {
  if (current.cover) {
    return <img src={current.cover} alt={current.title || 'audio-cover'} className="h-full w-full object-cover" />;
  }
  return (
    <div className="h-full w-full bg-gradient-to-br from-zinc-800 via-zinc-700 to-zinc-900 flex items-center justify-center">
      {current.live ? <Radio className="w-8 h-8 text-white/90" /> : <Volume2 className="w-8 h-8 text-white/90" />}
    </div>
  );
}

function AudioPlayerCore({
  props,
  emit,
  forceShowQueue = false,
}: {
  props: Record<string, unknown>;
  emit?: (name: string, payload?: unknown) => void;
  forceShowQueue?: boolean;
}) {
  const tracks = React.useMemo(() => normalizeAudioItems(props), [props]);
  const [resolvedTracks, setResolvedTracks] = React.useState(tracks);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(toBoolean(props.autoplay, false));
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(clamp(toNumber(props.volume, 0.9), 0, 1));
  const [muted, setMuted] = React.useState(false);
  const [speed, setSpeed] = React.useState(
    SPEED_PRESETS.includes(toNumber(props.speed, 1)) ? toNumber(props.speed, 1) : 1,
  );
  const [draggingSeek, setDraggingSeek] = React.useState(false);
  const [seekValue, setSeekValue] = React.useState(0);
  const [statusText, setStatusText] = React.useState('');
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const resolveTrackSources = async () => {
      const needsResolve = tracks.some((item) => {
        const raw = item.rawSrc.trim();
        return raw.startsWith('/api/management/') || LOCAL_MANAGEMENT_ASSET_URL_PATTERN.test(raw);
      });
      if (!needsResolve) {
        setResolvedTracks(tracks);
        return;
      }

      let baseUrl: string | undefined;
      try {
        baseUrl = await getApiBaseUrl();
      } catch {
        baseUrl = undefined;
      }

      const nextTracks = tracks.map((item) => {
        const normalizedAssetUrl = normalizeLocalManagementAssetUrl(baseUrl, item.rawSrc) || item.src;
        const normalizedCover = normalizeLocalManagementAssetUrl(baseUrl, item.cover) || item.cover;
        if (normalizedAssetUrl === item.src && normalizedCover === item.cover) {
          return item;
        }
        return {
          ...item,
          src: normalizeFileLikeUrl(normalizedAssetUrl),
          cover: normalizeFileLikeUrl(normalizedCover),
        };
      });

      if (!cancelled) {
        setResolvedTracks(nextTracks);
      }
    };

    void resolveTrackSources();
    return () => {
      cancelled = true;
    };
  }, [tracks]);

  React.useEffect(() => {
    if (currentIndex >= resolvedTracks.length) {
      setCurrentIndex(0);
    }
  }, [currentIndex, resolvedTracks.length]);

  const current = resolvedTracks[currentIndex];
  const showQueue = forceShowQueue || (resolvedTracks.length > 1 && props.showQueue !== false);
  const isDesktopRuntime = isDesktopMediaRuntime();
  const showMpvButton = isDesktopRuntime && props.showMpv !== false;
  const sendAction = toSafeText(props.sendAction, AUDIO_SEND_ACTION_DEFAULT) || AUDIO_SEND_ACTION_DEFAULT;
  const minimalMode = toBoolean(props.minimal, false) || toSafeText(props.variant) === 'minimal';
  const onPlaybackChange = toFunction<(playing: boolean) => void>(props.onPlaybackChange);
  const playSignal = toNumber(props.playSignal, 0);
  const stopSignal = toNumber(props.stopSignal, 0);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
  }, [speed, currentIndex]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      void audio.play().catch(() => {
        setPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [playing, currentIndex]);

  React.useEffect(() => {
    onPlaybackChange?.(playing);
  }, [onPlaybackChange, playing]);

  React.useEffect(() => {
    if (playSignal <= 0) {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = 0;
    setCurrentTime(0);
    setSeekValue(0);
    setPlaying(true);
    void audio.play().catch(() => {
      setPlaying(false);
    });
  }, [playSignal]);

  React.useEffect(() => {
    if (stopSignal <= 0) {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setSeekValue(0);
    setPlaying(false);
  }, [stopSignal]);

  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !current) {
      return;
    }
    try {
      (navigator as any).mediaSession.metadata = new MediaMetadata({
        title: current.title || '音频播放',
        artist: current.artist || current.subtitle || '',
        album: current.album || '',
        artwork: current.cover ? [{ src: current.cover }] : [],
      });
    } catch {
      // ignore
    }
  }, [current]);

  const emitAudio = React.useCallback((item: AudioItem) => {
    if (typeof emit === 'function') {
      emit(sendAction, {
        src: item.rawSrc || item.src,
        title: item.title,
        duration: item.durationText || secondsToText(duration),
        live: item.live,
      });
    }
  }, [duration, emit, sendAction]);

  if (!current) {
    return (
      <div className="w-full rounded-xl border border-dashed border-border/70 bg-muted/20 text-muted-foreground px-4 py-6 text-sm">
        AudioPlayer 未收到可用音频，请传入 `props.src/url/path` 或 `props.audios/playlist/items`。
      </div>
    );
  }

  const liveMode = current.live || !Number.isFinite(duration) || duration <= 0;
  const progressPercent = liveMode ? 0 : clamp((currentTime / Math.max(duration, 1)) * 100, 0, 100);

  const goPrev = () => {
    if (resolvedTracks.length <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + resolvedTracks.length) % resolvedTracks.length);
    setCurrentTime(0);
    setDuration(0);
  };

  const goNext = () => {
    if (resolvedTracks.length <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % resolvedTracks.length);
    setCurrentTime(0);
    setDuration(0);
  };

  const handleEnded = () => {
    const loop = toBoolean(props.loop, false);
    if (resolvedTracks.length > 1) {
      if (currentIndex < resolvedTracks.length - 1) {
        goNext();
        return;
      }
      if (loop) {
        setCurrentIndex(0);
        return;
      }
    } else if (loop) {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
      }
      return;
    }
    setPlaying(false);
    onPlaybackChange?.(false);
  };

  const openWithMpv = async () => {
    const result = await launchMpvPlayer(current.src || current.rawSrc);
    setStatusText(result.ok ? '已调用 MPV 播放。' : (result.message || 'MPV 启动失败'));
  };

  const cycleSpeed = () => {
    const idx = SPEED_PRESETS.indexOf(speed);
    const next = SPEED_PRESETS[(idx + 1) % SPEED_PRESETS.length];
    setSpeed(next);
  };

  if (minimalMode) {
    return (
      <div className="w-full rounded-2xl border border-border/60 bg-background/95 px-3 py-3">
        <audio
          ref={audioRef}
          src={current.src}
          preload={toSafeText(props.preload, 'metadata') || 'metadata'}
          onLoadedMetadata={(event) => {
            const media = event.currentTarget;
            const d = media.duration;
            setDuration(Number.isFinite(d) && d > 0 ? d : 0);
          }}
          onTimeUpdate={(event) => {
            const media = event.currentTarget;
            if (!draggingSeek) {
              setCurrentTime(media.currentTime || 0);
            }
          }}
          onEnded={handleEnded}
        />

        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full"
            onClick={() => setPlaying((prev) => !prev)}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </Button>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {current.title || '语音回复'}
                </div>
                {current.subtitle ? (
                  <div className="truncate text-[11px] text-muted-foreground">{current.subtitle}</div>
                ) : null}
              </div>
              <div className="shrink-0 text-[11px] text-muted-foreground">
                {liveMode ? 'LIVE' : secondsToText(duration)}
              </div>
            </div>

            <div className="space-y-1.5">
              <input
                type="range"
                min={0}
                max={liveMode ? 100 : Math.max(duration, 1)}
                step={0.1}
                disabled={liveMode}
                value={liveMode ? 0 : (draggingSeek ? seekValue : currentTime)}
                onMouseDown={() => setDraggingSeek(true)}
                onMouseUp={() => setDraggingSeek(false)}
                onChange={(event) => {
                  if (liveMode) return;
                  const value = Number(event.target.value);
                  setSeekValue(value);
                  const audio = audioRef.current;
                  if (audio) {
                    audio.currentTime = value;
                  }
                  setCurrentTime(value);
                }}
                className="w-full accent-primary disabled:opacity-50"
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{liveMode ? 'LIVE' : secondsToText(currentTime)}</span>
                <span>{liveMode ? '实时流' : secondsToText(duration)}</span>
              </div>
            </div>
          </div>
        </div>

        {statusText ? <div className="mt-2 text-[11px] text-emerald-600">{statusText}</div> : null}
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-border/60 bg-card/50 p-3 space-y-3">
      <audio
        ref={audioRef}
        src={current.src}
        preload={toSafeText(props.preload, 'metadata') || 'metadata'}
        onLoadedMetadata={(event) => {
          const media = event.currentTarget;
          const d = media.duration;
          setDuration(Number.isFinite(d) && d > 0 ? d : 0);
        }}
        onTimeUpdate={(event) => {
          const media = event.currentTarget;
          if (!draggingSeek) {
            setCurrentTime(media.currentTime || 0);
          }
        }}
        onEnded={handleEnded}
      />

      <div className="flex items-start gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/50">
          <CoverArt current={current} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {current.title || '音频播放'}
              </div>
              {current.artist || current.subtitle ? (
                <div className="mt-0.5 text-xs text-muted-foreground truncate">
                  {current.artist || current.subtitle}
                </div>
              ) : null}
              {current.album ? (
                <div className="text-[11px] text-muted-foreground/85 truncate">{current.album}</div>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              {current.live ? (
                <Badge variant="secondary" className="bg-red-500/15 text-red-500 border-red-500/30">LIVE</Badge>
              ) : null}
              {current.durationText ? (
                <Badge variant="secondary" className="text-xs">{current.durationText}</Badge>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={liveMode ? 100 : Math.max(duration, 1)}
          step={0.1}
          disabled={liveMode}
          value={liveMode ? 0 : (draggingSeek ? seekValue : currentTime)}
          onMouseDown={() => setDraggingSeek(true)}
          onMouseUp={() => setDraggingSeek(false)}
          onChange={(event) => {
            if (liveMode) return;
            const value = Number(event.target.value);
            setSeekValue(value);
            const audio = audioRef.current;
            if (audio) {
              audio.currentTime = value;
            }
            setCurrentTime(value);
          }}
          className="w-full accent-primary disabled:opacity-50"
        />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{liveMode ? 'LIVE' : secondsToText(currentTime)}</span>
          <span>{liveMode ? '实时流' : secondsToText(duration)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="secondary" className="h-8 w-8" onClick={goPrev} disabled={resolvedTracks.length <= 1}>
          <SkipBack className="w-4 h-4" />
        </Button>
        <Button
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={() => setPlaying((prev) => !prev)}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </Button>
        <Button size="icon" variant="secondary" className="h-8 w-8" onClick={goNext} disabled={resolvedTracks.length <= 1}>
          <SkipForward className="w-4 h-4" />
        </Button>

        <div className="ml-1 inline-flex items-center gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setMuted((prev) => !prev)}
          >
            {muted || volume <= 0.01 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(event) => {
              const val = Number(event.target.value);
              setVolume(val);
              if (val > 0 && muted) setMuted(false);
            }}
            className="w-20 accent-primary"
          />
        </div>

        <Button variant="secondary" className="h-8 px-2.5 text-xs" onClick={cycleSpeed}>
          <RefreshCcw className="w-3.5 h-3.5 mr-1" />
          {speed.toFixed(2).replace(/\.00$/, '')}x
        </Button>

        <Button
          variant="secondary"
          className="h-8 px-2.5 text-xs"
          onClick={() => emitAudio(current)}
        >
          <Send className="w-3.5 h-3.5 mr-1" />
          发送到输入框
        </Button>

        <Button
          variant="secondary"
          className="h-8 px-2.5 text-xs"
          onClick={() => openMediaExternal(current.src || current.rawSrc)}
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1" />
          浏览器
        </Button>

        {showMpvButton ? (
          <Button variant="secondary" className="h-8 px-2.5 text-xs" onClick={openWithMpv}>
            MPV
          </Button>
        ) : null}
      </div>

      {statusText ? <div className="text-[11px] text-emerald-600">{statusText}</div> : null}

      {showQueue ? (
        <div className="space-y-1.5 border-t border-border/50 pt-2">
          {resolvedTracks.map((item, idx) => (
            <button
              key={`${item.src}-${idx}`}
              type="button"
              className={cn(
                'w-full rounded-md border px-2 py-1.5 text-left transition-colors',
                idx === currentIndex ? 'border-primary/30 bg-primary/10' : 'border-border/40 hover:bg-muted/40',
              )}
              onClick={() => {
                setCurrentIndex(idx);
                setCurrentTime(0);
                setDuration(0);
                if (!playing && toBoolean(props.autoPlayOnSelect, true)) {
                  setPlaying(true);
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-xs font-medium text-foreground truncate">
                  {item.title || `音频 ${idx + 1}`}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {item.live ? 'LIVE' : (item.durationText || '')}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GenUIAudioPlayer(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  return <AudioPlayerCore props={props} emit={ctx?.emit} forceShowQueue={false} />;
}

export function GenUIAudioPlaylist(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  return <AudioPlayerCore props={props} emit={ctx?.emit} forceShowQueue />;
}
