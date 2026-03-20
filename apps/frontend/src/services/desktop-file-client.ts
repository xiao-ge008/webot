import type { ChatAttachment } from '@/data/mock-chats';

interface TauriWindowLike {
  __TAURI_INTERNALS__?: unknown;
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean((window as unknown as TauriWindowLike).__TAURI_INTERNALS__);
}

function normalizeFileUrlPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (!trimmed.toLowerCase().startsWith('file://')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    let pathname = decodeURIComponent(parsed.pathname || '');
    if (/^\/[a-zA-Z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    if (parsed.host) {
      return `\\\\${parsed.host}${pathname.replace(/\//g, '\\')}`;
    }
    return pathname;
  } catch {
    return trimmed.replace(/^file:\/\//i, '');
  }
}

export function isDesktopFileOpenSupported(): boolean {
  return isTauriRuntime();
}

export function resolveAttachmentOpenPath(
  attachment: Pick<ChatAttachment, 'savedPath' | 'assetUrl'>,
): string {
  const savedPath = typeof attachment.savedPath === 'string'
    ? normalizeFileUrlPath(attachment.savedPath)
    : '';
  if (savedPath) {
    return savedPath;
  }

  const assetUrl = typeof attachment.assetUrl === 'string'
    ? normalizeFileUrlPath(attachment.assetUrl)
    : '';
  if (assetUrl && !/^https?:\/\//i.test(assetUrl)) {
    return assetUrl;
  }

  return '';
}

export function canOpenAttachmentWithSystem(
  attachment: Pick<ChatAttachment, 'savedPath' | 'assetUrl'>,
): boolean {
  return Boolean(resolveAttachmentOpenPath(attachment));
}

export async function openFileWithSystem(
  path: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const target = normalizeFileUrlPath(path);
  if (!target) {
    return { ok: false, message: '未找到可打开的本地文件路径' };
  }
  if (!isTauriRuntime()) {
    return { ok: false, message: '当前环境不支持调用系统程序打开文件' };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_file_with_system', { path: target });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message || '调用系统打开文件失败' };
  }
}

export async function openAttachmentWithSystem(
  attachment: Pick<ChatAttachment, 'savedPath' | 'assetUrl'>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const target = resolveAttachmentOpenPath(attachment);
  if (!target) {
    return { ok: false, message: '当前附件缺少本地文件路径，无法直接打开' };
  }
  return openFileWithSystem(target);
}
