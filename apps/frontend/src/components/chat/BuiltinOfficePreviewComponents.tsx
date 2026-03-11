import * as React from 'react';
import {
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileUp,
  Loader2,
  Save,
  SquareArrowOutUpRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  fetchOfficeUrlAsArrayBuffer,
  isOfficeLocalRuntimeSupported,
  readOfficeFile,
  saveOfficeBinaryAs,
  saveOfficeFromUrl,
} from '@/services/office-file-client';

import '@js-preview/docx/lib/index.css';
import '@js-preview/excel/lib/index.css';

type OfficeFileKind = 'docx' | 'excel' | 'pdf' | 'pptx' | 'unknown';
type PreviewSource =
  | { mode: 'buffer'; value: ArrayBuffer }
  | { mode: 'url'; value: string };

interface OfficeItem {
  rawSrc: string;
  resolvedSrc: string;
  title: string;
  description: string;
  fileName: string;
  fileType: OfficeFileKind;
  isLocal: boolean;
}

interface JsPreviewLike {
  preview: (src: string | ArrayBuffer | Blob) => Promise<unknown>;
  save?: (fileName?: string) => void;
  destroy?: () => void;
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

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function isLikelyLocalPath(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (isRemoteUrl(text) || /^data:/i.test(text) || /^blob:/i.test(text)) return false;
  if (/^file:/i.test(text)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(text)) return true;
  if (text.startsWith('\\\\')) return true;
  if (text.startsWith('/')) return true;
  return !/^[a-z]+:\/\//i.test(text);
}

function inferFileName(source: string): string {
  const normalized = source.replace(/\\/g, '/');
  const tail = normalized.split('/').filter(Boolean).at(-1);
  if (tail) {
    return decodeURIComponent(tail.split('?')[0].split('#')[0]);
  }
  return 'office-document';
}

function inferFileType(rawType: string, source: string): OfficeFileKind {
  const explicit = rawType.trim().toLowerCase();
  if (explicit === 'word' || explicit === 'doc' || explicit === 'docx') return 'docx';
  if (explicit === 'excel' || explicit === 'xls' || explicit === 'xlsx') return 'excel';
  if (explicit === 'pdf') return 'pdf';
  if (explicit === 'ppt' || explicit === 'pptx') return 'pptx';

  const name = inferFileName(source).toLowerCase();
  if (name.endsWith('.docx') || name.endsWith('.doc')) return 'docx';
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) return 'excel';
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.pptx') || name.endsWith('.ppt')) return 'pptx';
  return 'unknown';
}

function inferTitle(props: Record<string, unknown>, fileName: string): string {
  const title = toSafeText(props.title);
  if (title) return title;
  return fileName || '办公文档预览';
}

function inferSuggestedName(item: OfficeItem): string {
  const explicit = toSafeText(item.title);
  if (item.fileName) {
    return item.fileName;
  }
  const safe = explicit
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'office-document';
}

function getFileTypeLabel(type: OfficeFileKind): string {
  if (type === 'docx') return 'Word';
  if (type === 'excel') return 'Excel';
  if (type === 'pdf') return 'PDF';
  if (type === 'pptx') return 'PPTX';
  return 'Office';
}

function renderFileTypeIcon(type: OfficeFileKind) {
  if (type === 'excel') return <FileSpreadsheet className="w-4 h-4 text-emerald-500" />;
  if (type === 'pdf') return <FileText className="w-4 h-4 text-rose-500" />;
  if (type === 'pptx') return <FileUp className="w-4 h-4 text-orange-500" />;
  if (type === 'docx') return <FileType2 className="w-4 h-4 text-sky-500" />;
  return <FileText className="w-4 h-4 text-primary" />;
}

function normalizeOfficeItem(props: Record<string, unknown>): OfficeItem | null {
  const rawSrc =
    toSafeText(props.src)
    || toSafeText(props.url)
    || toSafeText(props.path)
    || toSafeText(props.file)
    || '';
  if (!rawSrc) {
    return null;
  }

  const fileName = toSafeText(props.fileName) || inferFileName(rawSrc);
  const fileType = inferFileType(toSafeText(props.fileType) || toSafeText(props.type), fileName || rawSrc);

  return {
    rawSrc,
    resolvedSrc: normalizeFileLikeUrl(rawSrc),
    title: inferTitle(props, fileName),
    description: toSafeText(props.description) || toSafeText(props.subtitle),
    fileName: fileName || 'office-document',
    fileType,
    isLocal: isLikelyLocalPath(rawSrc),
  };
}

async function resolvePreviewSource(item: OfficeItem): Promise<{ ok: true; data: PreviewSource } | { ok: false; message: string }> {
  if (item.isLocal) {
    if (!isOfficeLocalRuntimeSupported()) {
      return { ok: false, message: 'Web 环境不支持本地文件读取，请改用网络 URL。' };
    }
    const readResult = await readOfficeFile(item.rawSrc);
    if (!readResult.ok) {
      return readResult;
    }
    return { ok: true, data: { mode: 'buffer', value: readResult.data } };
  }

  if (item.fileType === 'pptx') {
    const fetched = await fetchOfficeUrlAsArrayBuffer(item.resolvedSrc);
    if (!fetched.ok) {
      return fetched;
    }
    return { ok: true, data: { mode: 'buffer', value: fetched.data } };
  }

  return { ok: true, data: { mode: 'url', value: item.resolvedSrc } };
}

async function mountOfficePreview(
  container: HTMLDivElement,
  fileType: OfficeFileKind,
  source: PreviewSource,
): Promise<{ save?: (fileName?: string) => void; destroy?: () => void }> {
  container.innerHTML = '';

  if (fileType === 'docx') {
    const module = await import('@js-preview/docx');
    const previewer = module.default.init(container, { className: 'office-docx-preview' }) as JsPreviewLike;
    await previewer.preview(source.value);
    return {
      save: previewer.save?.bind(previewer),
      destroy: previewer.destroy?.bind(previewer),
    };
  }

  if (fileType === 'excel') {
    const module = await import('@js-preview/excel');
    const previewer = module.default.init(container, { showContextmenu: false }) as JsPreviewLike;
    await previewer.preview(source.value);
    return {
      save: previewer.save?.bind(previewer),
      destroy: previewer.destroy?.bind(previewer),
    };
  }

  if (fileType === 'pdf') {
    const module = await import('@js-preview/pdf');
    const previewer = module.default.init(container, { onError: () => {} }) as JsPreviewLike;
    await previewer.preview(source.value);
    return {
      save: previewer.save?.bind(previewer),
      destroy: previewer.destroy?.bind(previewer),
    };
  }

  if (fileType === 'pptx') {
    if (source.mode !== 'buffer') {
      throw new Error('PPTX 仅支持二进制预览源');
    }
    const module = await import('pptx-preview');
    const width = Math.max(container.clientWidth - 24, 960);
    const height = Math.max(Math.round(width * 9 / 16), 540);
    const previewer = module.init(container, { width, height, mode: 'list' });
    await previewer.preview(source.value);
    return {
      destroy: previewer.destroy?.bind(previewer),
    };
  }

  throw new Error('暂不支持该文件类型，请传入 docx/xlsx/pdf/pptx。');
}

export function GenUIOfficePreviewCard(ctx: unknown) {
  const props = (ctx && typeof ctx === 'object' && 'props' in ctx && typeof (ctx as { props?: unknown }).props === 'object')
    ? ((ctx as { props: Record<string, unknown> }).props)
    : {};
  const office = React.useMemo(() => normalizeOfficeItem(props), [props]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [statusText, setStatusText] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const sourceRef = React.useRef<PreviewSource | null>(null);
  const previewerRef = React.useRef<{ save?: (fileName?: string) => void; destroy?: () => void } | null>(null);

  const dialogHeight = clamp(toNumber(props.dialogHeight, 820), 420, 1200);

  const destroyPreviewer = React.useCallback(() => {
    previewerRef.current?.destroy?.();
    previewerRef.current = null;
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
  }, []);

  React.useEffect(() => () => {
    destroyPreviewer();
  }, [destroyPreviewer]);

  React.useEffect(() => {
    if (!open || !office) return;
    let canceled = false;

    const run = async () => {
      setLoading(true);
      setError('');
      setStatusText('');
      destroyPreviewer();

      const sourceResult = await resolvePreviewSource(office);
      if (!sourceResult.ok) {
        if (!canceled) {
          setError(sourceResult.message || '文档加载失败');
          setLoading(false);
        }
        return;
      }

      if (canceled) return;
      sourceRef.current = sourceResult.data;

      if (!containerRef.current) {
        setError('预览容器不可用');
        setLoading(false);
        return;
      }

      try {
        const previewer = await mountOfficePreview(containerRef.current, office.fileType, sourceResult.data);
        if (canceled) {
          previewer.destroy?.();
          return;
        }
        previewerRef.current = previewer;
      } catch (mountError) {
        const message = mountError instanceof Error ? mountError.message : String(mountError);
        if (!canceled) {
          setError(message || '文档预览失败');
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [destroyPreviewer, office, open]);

  if (!office) {
    return (
      <div className="w-full rounded-xl border border-dashed border-border/70 bg-muted/20 text-muted-foreground px-4 py-6 text-sm">
        OfficePreviewCard 未收到可用文件，请传入 `props.src/url/path/file`。
      </div>
    );
  }

  const sourceLabel = office.isLocal ? '来源：本地文件' : '来源：网络 URL';
  const suggestedName = inferSuggestedName(office);
  const canOpenExternal = isRemoteUrl(office.rawSrc);

  const handleSave = async () => {
    setStatusText('');
    const activeSource = sourceRef.current;
    if (!activeSource) {
      setStatusText('请先打开并加载文档后再保存。');
      return;
    }

    if (previewerRef.current?.save) {
      try {
        previewerRef.current.save(suggestedName);
        setStatusText('已触发文件保存。');
        return;
      } catch {
        // fallback below
      }
    }

    if (activeSource.mode === 'buffer') {
      const result = await saveOfficeBinaryAs(activeSource.value, suggestedName);
      setStatusText(result.ok ? `已保存：${result.path}` : (result.message || '保存失败'));
      return;
    }

    const result = await saveOfficeFromUrl(activeSource.value, suggestedName);
    setStatusText(result.ok ? `已保存：${result.path}` : (result.message || '保存失败'));
  };

  return (
    <div className="w-full space-y-2">
      <button
        type="button"
        className={cn(
          'group w-full rounded-xl border border-border/60 bg-card/50 px-3 py-3 text-left transition-colors hover:border-border',
        )}
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {renderFileTypeIcon(office.fileType)}
              <span className="text-sm font-semibold text-foreground truncate">{office.title}</span>
              <Badge variant="secondary" className="text-[10px]">{getFileTypeLabel(office.fileType)}</Badge>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground truncate">{office.fileName}</div>
            {office.description ? <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{office.description}</div> : null}
            <div className="mt-1 text-[11px] text-muted-foreground">{sourceLabel}</div>
          </div>
          <div className="h-8 w-8 shrink-0 rounded-full border border-border/50 bg-muted/50 text-muted-foreground flex items-center justify-center">
            <SquareArrowOutUpRight className="w-4 h-4" />
          </div>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[96vw] w-[96vw] p-0 border-border/50 bg-background overflow-hidden"
          style={{ height: `${dialogHeight}px` }}
        >
          <div className="h-full w-full flex flex-col">
            <div className="h-14 px-4 border-b border-border/60 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{office.title}</div>
                <div className="text-[11px] text-muted-foreground truncate">{office.fileName}</div>
              </div>
              <div className="inline-flex items-center gap-2">
                {canOpenExternal ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => window.open(office.rawSrc, '_blank', 'noopener,noreferrer')}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    浏览器打开
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => void handleSave()}>
                  <Save className="w-3.5 h-3.5 mr-1" />
                  保存
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden bg-muted/10 p-3">
              {loading ? (
                <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  正在加载文档预览…
                </div>
              ) : null}

              {!loading && error ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  {error}
                </div>
              ) : null}

              {!loading && !error ? (
                <div ref={containerRef} className="h-full w-full overflow-auto rounded-md border border-border/40 bg-white" />
              ) : null}
            </div>

            {statusText ? (
              <div className="px-4 py-2 border-t border-border/50 text-xs text-muted-foreground truncate">{statusText}</div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
