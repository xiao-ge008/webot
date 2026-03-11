interface TauriWindowLike {
  __TAURI_INTERNALS__?: unknown;
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean((window as unknown as TauriWindowLike).__TAURI_INTERNALS__);
}

export function isMarkdownPreviewSupported(): boolean {
  return isTauriRuntime();
}

export async function readMarkdownFile(path: string): Promise<{ ok: true; content: string } | { ok: false; message: string }> {
  const target = path.trim();
  if (!target) {
    return { ok: false, message: '未提供文件路径' };
  }
  if (!isTauriRuntime()) {
    return { ok: false, message: '当前环境不支持本地文件读取' };
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const content = await invoke<string>('read_markdown_file', { path: target });
    return { ok: true, content: typeof content === 'string' ? content : '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message || '读取 Markdown 文件失败' };
  }
}

export async function saveMarkdownAs(
  content: string,
  suggestedName?: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (!isTauriRuntime()) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { ok: false, message: '当前环境不支持另存为' };
    }
    try {
      const filename = (suggestedName || 'preview.md').trim() || 'preview.md';
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename.toLowerCase().endsWith('.md') ? filename : `${filename}.md`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      return { ok: true, path: anchor.download };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: message || '浏览器下载失败' };
    }
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const savedPath = await invoke<string>('save_markdown_as', {
      content,
      suggestedName: (suggestedName || '').trim() || undefined,
    });
    return { ok: true, path: savedPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message || '另存为失败' };
  }
}
