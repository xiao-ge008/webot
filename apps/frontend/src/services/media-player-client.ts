interface TauriWindowLike {
  __TAURI_INTERNALS__?: unknown;
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean((window as unknown as TauriWindowLike).__TAURI_INTERNALS__);
}

export function isDesktopMediaRuntime(): boolean {
  return isTauriRuntime();
}

function toSafeLabel(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized) {
    return normalized;
  }
  return 'media';
}

function randomLabelSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function openMediaWebviewWindow(url: string, title?: string): Promise<boolean> {
  const target = url.trim();
  if (!target) {
    return false;
  }
  if (!isTauriRuntime()) {
    return false;
  }

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const label = `media-${toSafeLabel(title || target)}-${randomLabelSuffix()}`;
    const webview = new WebviewWindow(label, {
      url: target,
      title: title?.trim() || '媒体播放器',
      width: 1320,
      height: 860,
      minWidth: 960,
      minHeight: 640,
      center: true,
      focus: true,
      resizable: true,
      visible: true,
      decorations: true,
    });
    webview.once('tauri://created', () => {});
    webview.once('tauri://error', () => {});
    return true;
  } catch {
    return false;
  }
}

export async function launchMpvPlayer(url: string): Promise<{ ok: boolean; message?: string }> {
  const target = url.trim();
  if (!target) {
    return { ok: false, message: '视频地址为空' };
  }
  if (!isTauriRuntime()) {
    return { ok: false, message: '当前环境不支持 MPV 启动' };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('launch_mpv', { url: target });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message || '启动 MPV 失败' };
  }
}

export function openMediaExternal(url: string): void {
  const target = url.trim();
  if (!target) return;
  if (typeof window === 'undefined') return;
  window.open(target, '_blank', 'noopener,noreferrer');
}
