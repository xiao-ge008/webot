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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const normalized = base64.includes(',') ? base64.split(',').at(-1) || '' : base64;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function getDownloadName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'office-preview-file';
  return trimmed;
}

async function downloadInBrowser(blob: Blob, fileName: string): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { ok: false, message: '当前环境不支持下载' };
  }
  try {
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = getDownloadName(fileName);
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(href);
    return { ok: true, path: anchor.download };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message || '浏览器下载失败' };
  }
}

export function isOfficeLocalRuntimeSupported(): boolean {
  return isTauriRuntime();
}

export async function readOfficeFile(path: string): Promise<
  { ok: true; data: ArrayBuffer } | { ok: false; message: string }
> {
  const target = normalizeFileUrlPath(path);
  if (!target) {
    return { ok: false, message: '未提供文件路径' };
  }
  if (!isTauriRuntime()) {
    return { ok: false, message: '当前环境不支持本地文件读取' };
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const base64 = await invoke<string>('read_binary_file_base64', { path: target });
    return { ok: true, data: base64ToArrayBuffer(base64 || '') };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message || '读取文件失败' };
  }
}

export async function fetchOfficeUrlAsArrayBuffer(url: string): Promise<
  { ok: true; data: ArrayBuffer } | { ok: false; message: string }
> {
  const target = url.trim();
  if (!target) {
    return { ok: false, message: '未提供网络地址' };
  }
  try {
    const response = await fetch(target);
    if (!response.ok) {
      return { ok: false, message: `文件下载失败（${response.status}）` };
    }
    const data = await response.arrayBuffer();
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message || '下载文件失败' };
  }
}

export async function saveOfficeBinaryAs(
  data: ArrayBuffer,
  suggestedName: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (data.byteLength <= 0) {
    return { ok: false, message: '无可保存内容' };
  }
  const fileName = getDownloadName(suggestedName);

  if (!isTauriRuntime()) {
    return downloadInBrowser(
      new Blob([data], { type: 'application/octet-stream' }),
      fileName,
    );
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const base64Content = arrayBufferToBase64(data);
    const savedPath = await invoke<string>('save_binary_file_as', {
      base64Content,
      suggestedName: fileName,
    });
    return { ok: true, path: savedPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: message || '保存失败' };
  }
}

export async function saveOfficeFromUrl(
  url: string,
  suggestedName: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const fetched = await fetchOfficeUrlAsArrayBuffer(url);
  if (!fetched.ok) {
    return fetched;
  }
  return saveOfficeBinaryAs(fetched.data, suggestedName);
}
