import * as React from 'react';
import { Code2, ExternalLink, Globe, MonitorPlay, SquareArrowOutUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { isDesktopMediaRuntime, openMediaExternal, openMediaWebviewWindow } from '@/services/media-player-client';

interface WebPreviewPayload {
  title: string;
  description: string;
  siteName: string;
  domain: string;
  image: string;
  favicon: string;
}

function toSafeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ensureHtmlDocument(raw: string): string {
  const source = raw.trim();
  if (!source) {
    return '<!doctype html><html><body><div style="font-family:sans-serif;padding:12px;color:#888">Empty HTML</div></body></html>';
  }

  if (/<html[\s>]/i.test(source)) {
    return source;
  }

  const safeBody = source;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; padding: 12px; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff; color: #111; }
      * { box-sizing: border-box; max-width: 100%; }
      img, video, iframe { max-width: 100%; height: auto; }
    </style>
  </head>
  <body>${safeBody}</body>
</html>`;
}

function deriveDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return '';
  }
}

function deriveTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname && parsed.pathname !== '/') {
      const segments = parsed.pathname.split('/').filter(Boolean);
      const tail = segments.at(-1) || parsed.host;
      return decodeURIComponent(tail).slice(0, 80);
    }
    return parsed.host;
  } catch {
    return '网页内容';
  }
}

function deriveFavicon(url: string): string {
  const domain = deriveDomain(url);
  if (!domain) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function normalizePreview(props: Record<string, unknown>, url: string): WebPreviewPayload {
  const preview = props.preview && typeof props.preview === 'object' ? props.preview as Record<string, unknown> : {};

  const domain = toSafeText(preview.domain) || toSafeText(props.domain) || deriveDomain(url);
  const title = toSafeText(preview.title) || toSafeText(props.title) || (url ? deriveTitleFromUrl(url) : 'HTML 片段');
  const description = toSafeText(preview.description) || toSafeText(props.description) || toSafeText(props.subtitle);
  const siteName = toSafeText(preview.siteName) || toSafeText(props.siteName) || domain;
  const image = toSafeText(preview.image) || toSafeText(props.image) || toSafeText(props.cover);
  const favicon = toSafeText(preview.favicon) || toSafeText(props.favicon) || deriveFavicon(url);

  return {
    title,
    description,
    siteName,
    domain,
    image,
    favicon,
  };
}

function HtmlFragmentView({ html }: { html: string }) {
  const srcDoc = React.useMemo(() => ensureHtmlDocument(html), [html]);
  return (
    <iframe
      title="html-fragment-viewer"
      srcDoc={srcDoc}
      className="h-full w-full bg-white"
      sandbox="allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox"
    />
  );
}

function UrlWebView({
  url,
  title,
}: {
  url: string;
  title: string;
}) {
  const [loaded, setLoaded] = React.useState(false);
  return (
    <div className="relative h-full w-full">
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/20 text-muted-foreground text-sm z-10">
          正在加载网页…
        </div>
      ) : null}
      <iframe
        src={url}
        title={title || 'webview'}
        className="h-full w-full bg-background"
        referrerPolicy="no-referrer"
        allow="clipboard-read; clipboard-write; fullscreen"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

export function GenUIWebViewCard(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  const url = toSafeText(props.url) || toSafeText(props.href) || toSafeText(props.src);
  const html = toSafeText(props.html) || toSafeText(props.fragment) || toSafeText(props.content);
  const hasUrl = Boolean(url);
  const hasHtml = Boolean(html);
  const mode = hasUrl ? 'url' : hasHtml ? 'html' : 'empty';
  const [open, setOpen] = React.useState(false);
  const preview = React.useMemo(() => normalizePreview(props, url), [props, url]);
  const isDesktopRuntime = isDesktopMediaRuntime();

  if (mode === 'empty') {
    return (
      <div className="w-full rounded-xl border border-dashed border-border/70 bg-muted/20 text-muted-foreground px-4 py-6 text-sm">
        WebViewCard 未收到可用数据，请传入 `props.url` 或 `props.html`。
      </div>
    );
  }

  const previewHeight = clamp(toNumber(props.previewHeight, 180), 120, 420);
  const dialogHeight = clamp(toNumber(props.dialogHeight, 760), 420, 1200);
  const showExternalOpen = hasUrl && props.showExternalOpen !== false;
  const showDesktopWindowOpen = hasUrl && isDesktopRuntime && props.showDesktopWindowOpen !== false;

  const openDesktopWebview = async () => {
    if (!hasUrl) return;
    const ok = await openMediaWebviewWindow(url, preview.title || '网页浏览');
    if (!ok) {
      openMediaExternal(url);
    }
  };

  return (
    <div className="w-full space-y-2">
      <button
        type="button"
        className="group w-full overflow-hidden rounded-xl border border-border/60 bg-card/40 text-left hover:border-border transition-colors"
        onClick={() => setOpen(true)}
      >
        <div className="relative" style={{ height: `${previewHeight}px` }}>
          {preview.image ? (
            <img src={preview.image} alt={preview.title || 'web-preview'} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-zinc-800 via-zinc-700 to-zinc-900 flex items-center justify-center">
              {hasUrl ? <Globe className="w-10 h-10 text-white/90" /> : <Code2 className="w-10 h-10 text-white/90" />}
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute right-2 top-2 flex items-center gap-2">
            <Badge variant="secondary" className="bg-black/45 text-white border-white/20">
              {hasUrl ? 'URL' : 'HTML'}
            </Badge>
            <div className="h-8 w-8 rounded-full bg-black/45 border border-white/20 flex items-center justify-center text-white">
              <SquareArrowOutUpRight className="w-4 h-4" />
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-3">
            <div className="flex items-center gap-2">
              {preview.favicon ? (
                <img src={preview.favicon} alt="site-icon" className="w-4 h-4 rounded-sm bg-white/90" />
              ) : null}
              <div className="text-white text-sm font-semibold truncate">{preview.title || '网页内容'}</div>
            </div>
            {preview.description ? <div className="mt-1 text-xs text-white/80 line-clamp-2">{preview.description}</div> : null}
            {(preview.siteName || preview.domain) ? (
              <div className="mt-1 text-[11px] text-white/70 truncate">{preview.siteName || preview.domain}</div>
            ) : null}
          </div>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[96vw] w-[96vw] p-0 border-border/50 bg-black/95 overflow-hidden" style={{ height: `${dialogHeight}px` }}>
          <div className="absolute left-3 top-3 z-20 inline-flex items-center gap-2">
            <Badge variant="secondary" className="bg-white/15 text-white border-white/20">
              {hasUrl ? '网页' : 'HTML'}
            </Badge>
            <span className="text-xs text-white/90 truncate max-w-[45vw]">{preview.title || (hasUrl ? url : 'HTML 片段')}</span>
          </div>

          <div className="absolute right-3 top-3 z-20 inline-flex items-center gap-2">
            {showDesktopWindowOpen ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
                onClick={openDesktopWebview}
              >
                <MonitorPlay className="w-3.5 h-3.5 mr-1" />
                无头窗口
              </Button>
            ) : null}
            {showExternalOpen ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-8 bg-white/15 text-white hover:bg-white/25 border-white/20"
                onClick={() => hasUrl && openMediaExternal(url)}
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                当前浏览器打开
              </Button>
            ) : null}
          </div>

          <div className={cn('h-full w-full pt-14', hasUrl ? 'bg-background' : 'bg-white')}>
            {hasUrl ? <UrlWebView url={url} title={preview.title} /> : <HtmlFragmentView html={html} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
