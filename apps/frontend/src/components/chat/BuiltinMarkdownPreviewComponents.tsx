import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Loader2, Save, SquareArrowOutUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  isMarkdownPreviewSupported,
  readMarkdownFile,
  saveMarkdownAs,
} from '@/services/markdown-file-client';

function toSafeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function inferTitle(props: Record<string, unknown>, path: string): string {
  const explicit = toSafeText(props.title);
  if (explicit) return explicit;
  if (path) {
    const normalized = path.replace(/\\/g, '/');
    const fileName = normalized.split('/').filter(Boolean).at(-1);
    if (fileName) return fileName;
  }
  return 'Markdown 预览';
}

function inferSuggestedName(title: string, path: string): string {
  if (path) {
    const normalized = path.replace(/\\/g, '/');
    const fileName = normalized.split('/').filter(Boolean).at(-1);
    if (fileName) return fileName;
  }
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!safe) return 'preview.md';
  return safe.toLowerCase().endsWith('.md') ? safe : `${safe}.md`;
}

function createPreviewText(markdown: string, lines: number): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[>#*_~\-`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) return '点击查看完整 Markdown 预览';

  const maxLength = clamp(lines, 2, 10) * 48;
  return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
}

export function GenUIMarkdownPreviewCard(ctx: any) {
  const props = (ctx?.props && typeof ctx.props === 'object') ? ctx.props as Record<string, unknown> : {};
  const runtimeSupported = isMarkdownPreviewSupported();

  const filePath = toSafeText(props.filePath) || toSafeText(props.path) || toSafeText(props.file);
  const inlineMarkdown = toSafeText(props.markdown) || toSafeText(props.content) || toSafeText(props.text);
  const title = inferTitle(props, filePath);
  const description = toSafeText(props.description) || toSafeText(props.subtitle);
  const previewLines = clamp(Math.round(toNumber(props.previewLines, 3)), 2, 8);
  const dialogHeight = clamp(toNumber(props.dialogHeight, 820), 420, 1200);

  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [markdown, setMarkdown] = React.useState(inlineMarkdown);
  const [error, setError] = React.useState('');
  const [saveStatus, setSaveStatus] = React.useState('');

  React.useEffect(() => {
    setMarkdown(inlineMarkdown);
  }, [inlineMarkdown]);

  const ensureMarkdown = React.useCallback(async () => {
    if (inlineMarkdown) {
      setMarkdown(inlineMarkdown);
      setError('');
      return;
    }
    if (!filePath) {
      setMarkdown('');
      setError('未提供 Markdown 内容或文件路径');
      return;
    }
    if (!runtimeSupported) {
      setMarkdown('');
      setError('Web 环境不支持本地 Markdown 文件读取，请直接传入 markdown 文本内容。');
      return;
    }

    setLoading(true);
    setError('');
    const result = await readMarkdownFile(filePath);
    if (result.ok) {
      setMarkdown(result.content || '');
      if (!result.content.trim()) {
        setError('文件内容为空');
      }
    } else {
      setError(result.message || '读取 Markdown 文件失败');
    }
    setLoading(false);
  }, [filePath, inlineMarkdown, runtimeSupported]);

  const openPreview = async () => {
    setSaveStatus('');
    setOpen(true);
    await ensureMarkdown();
  };

  const handleSaveAs = async () => {
    const content = markdown.trim();
    if (!content) {
      setSaveStatus('当前无可保存内容');
      return;
    }
    const result = await saveMarkdownAs(content, inferSuggestedName(title, filePath));
    if (result.ok) {
      setSaveStatus(`已保存：${result.path}`);
    } else {
      setSaveStatus(result.message || '另存为失败');
    }
  };

  const previewText = createPreviewText(markdown || inlineMarkdown, previewLines);
  const sourceLabel = inlineMarkdown
    ? '来源：AI Markdown'
    : filePath
      ? `文件：${filePath}`
      : '来源：Markdown';

  return (
    <div className="w-full space-y-2">
      <button
        type="button"
        className={cn(
          'group w-full rounded-xl border border-border/60 bg-card/50 text-left px-3 py-3 transition-colors',
          runtimeSupported ? 'hover:border-border' : 'opacity-95',
        )}
        onClick={openPreview}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-foreground truncate">{title}</span>
              <Badge variant="secondary" className="text-[10px]">Markdown</Badge>
              {!runtimeSupported && !inlineMarkdown && filePath ? (
                <Badge variant="secondary" className="text-[10px] text-amber-600 border-amber-500/30 bg-amber-500/10">Web 不支持本地文件</Badge>
              ) : null}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground truncate">{sourceLabel}</div>
            {description ? <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{description}</div> : null}
            <div className="mt-2 text-xs text-foreground/85 line-clamp-3 whitespace-pre-wrap">{previewText}</div>
            {!runtimeSupported && !inlineMarkdown && filePath ? (
              <div className="mt-2 text-[11px] text-amber-600">
                Web 环境请改为传入 markdown 文本，才能预览与保存。
              </div>
            ) : null}
            {runtimeSupported && error ? (
              <div className="mt-2 text-[11px] text-amber-600">{error}</div>
            ) : null}
          </div>
          <div className="h-8 w-8 rounded-full bg-muted/50 border border-border/50 flex items-center justify-center text-muted-foreground shrink-0">
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
                <div className="text-sm font-semibold truncate">{title}</div>
                <div className="text-[11px] text-muted-foreground truncate">{sourceLabel}</div>
              </div>
              <div className="inline-flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={handleSaveAs}>
                  <Save className="w-3.5 h-3.5 mr-1" />
                  另存为
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {loading ? (
                <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  正在加载 Markdown…
                </div>
              ) : null}

              {!loading && error ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  {error}
                </div>
              ) : null}

              {!loading && markdown ? (
                <div className="chat-markdown chat-markdown-agent max-w-none prose prose-sm dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                </div>
              ) : null}

              {!loading && !markdown && !error ? (
                <div className="text-sm text-muted-foreground">暂无可预览内容。</div>
              ) : null}
            </div>

            {saveStatus ? (
              <div className="px-4 py-2 border-t border-border/50 text-xs text-muted-foreground truncate">{saveStatus}</div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
