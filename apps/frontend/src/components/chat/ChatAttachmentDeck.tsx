import { memo, useState } from 'react';
import { Expand, ExternalLink, FileText, Image as ImageIcon } from 'lucide-react';
import type { ChatAttachment } from '@/data/mock-chats';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ChatAttachmentDeckProps {
  attachments?: readonly ChatAttachment[];
  isUser: boolean;
  desktopFileOpenSupported: boolean;
  canOpenFile: (attachment: ChatAttachment) => boolean;
  onOpenFile: (attachment: ChatAttachment) => void;
}

function formatAttachmentSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function getFileBadge(attachment: ChatAttachment): string {
  const extension = attachment.name.trim().split('.').pop()?.trim();
  if (extension) {
    return extension.toUpperCase().slice(0, 8);
  }
  const mimeSubtype = attachment.mimeType?.split('/').pop()?.trim();
  if (mimeSubtype) {
    return mimeSubtype.toUpperCase().slice(0, 8);
  }
  return 'FILE';
}

function ChatAttachmentDeckInner({
  attachments,
  isUser,
  desktopFileOpenSupported,
  canOpenFile,
  onOpenFile,
}: ChatAttachmentDeckProps) {
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const items = attachments?.filter(Boolean) ?? [];
  if (items.length === 0) {
    return null;
  }

  const imageAttachments = items.filter((attachment) => attachment.kind === 'image');
  const fileAttachments = items.filter((attachment) => attachment.kind !== 'image');

  return (
    <>
      <div className={cn('flex max-w-full flex-col gap-2.5', isUser ? 'items-end' : 'items-start')}>
        {imageAttachments.length > 0 ? (
          <div className={cn('flex max-w-full flex-wrap gap-2.5', isUser ? 'justify-end' : 'justify-start')}>
            {imageAttachments.map((attachment) => (
              <button
                key={attachment.id}
                type="button"
                className={cn(
                  'group relative h-32 w-32 overflow-hidden rounded-2xl border border-border/60 bg-card/80 text-left shadow-sm transition',
                  'hover:-translate-y-0.5 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                onClick={() => setPreviewAttachment(attachment)}
                title={attachment.name}
              >
                {attachment.assetUrl ? (
                  <img
                    src={attachment.assetUrl}
                    alt={attachment.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/78 via-black/28 to-transparent px-2.5 pb-2 pt-6">
                  <div className="line-clamp-2 text-[11px] font-medium leading-4 text-white">
                    {attachment.name}
                  </div>
                </div>
                <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/90 backdrop-blur-sm">
                  <Expand className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {fileAttachments.length > 0 ? (
          <div className="flex w-full max-w-[360px] flex-col gap-2">
            {fileAttachments.map((attachment) => {
              const canOpen = canOpenFile(attachment);
              const fileSize = formatAttachmentSize(attachment.size);
              return (
                <div
                  key={attachment.id}
                  role={canOpen ? 'button' : undefined}
                  tabIndex={canOpen ? 0 : undefined}
                  className={cn(
                    'w-full rounded-2xl border border-border/60 bg-card/78 px-3.5 py-3 text-left shadow-sm backdrop-blur-sm transition',
                    canOpen
                      ? 'cursor-pointer hover:-translate-y-0.5 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      : 'cursor-default',
                  )}
                  onClick={canOpen ? () => onOpenFile(attachment) : undefined}
                  onKeyDown={canOpen ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenFile(attachment);
                    }
                  } : undefined}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04] text-muted-foreground">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {attachment.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border/60 px-1.5 py-0.5 font-medium tracking-[0.08em]">
                          {getFileBadge(attachment)}
                        </span>
                        {fileSize ? <span>{fileSize}</span> : null}
                      </div>
                      <div className="mt-1.5 break-all text-[11px] leading-5 text-muted-foreground/90">
                        {attachment.relativePath}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-muted-foreground">
                      {canOpen
                        ? '点击卡片后用系统默认程序打开'
                        : desktopFileOpenSupported
                          ? '当前附件缺少本地路径'
                          : '仅桌面端支持直接打开文件'}
                    </span>
                    {canOpen ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 rounded-full px-2.5 text-[11px]"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenFile(attachment);
                        }}
                      >
                        系统打开
                        <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewAttachment(null);
          }
        }}
      >
        <DialogContent className="w-[min(96vw,1100px)] max-w-[1100px] border-none bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">
            {previewAttachment?.name || '图片预览'}
          </DialogTitle>
          <div className="overflow-hidden rounded-[28px] border border-white/12 bg-black/92 p-3 shadow-2xl sm:p-4">
            {previewAttachment?.assetUrl ? (
              <img
                src={previewAttachment.assetUrl}
                alt={previewAttachment.name}
                className="max-h-[86vh] w-full rounded-[20px] object-contain"
              />
            ) : (
              <div className="flex min-h-[50vh] items-center justify-center rounded-[20px] bg-white/6 text-white/72">
                <ImageIcon className="h-8 w-8" />
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-3 px-1">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">
                  {previewAttachment?.name}
                </div>
                <div className="text-[11px] text-white/55">
                  点击空白处或右上角关闭
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const ChatAttachmentDeck = memo(ChatAttachmentDeckInner);
