type JsonRecord = Record<string, unknown>;

const DEFAULT_WEB_API_BASE_URL = 'http://127.0.0.1:4310';
const API_BASE_ENV_KEYS = ['VITE_WEBOT_API_BASE_URL', 'VITE_API_BASE_URL'] as const;

let apiBaseUrlPromise: Promise<string> | null = null;

function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, '');
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const globalWindow = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
  };

  return Boolean(globalWindow.__TAURI_INTERNALS__);
}

function resolveWebBaseUrl(): string {
  for (const key of API_BASE_ENV_KEYS) {
    const value = (import.meta.env as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return normalizeBaseUrl(value);
    }
  }

  return DEFAULT_WEB_API_BASE_URL;
}

async function resolveTauriBaseUrl(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const value = await invoke<string>('get_api_base_url');
    if (typeof value === 'string' && value.trim().length > 0) {
      return normalizeBaseUrl(value);
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveTauriOpenFangBaseUrl(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const value = await invoke<string>('get_openfang_base_url');
    if (typeof value === 'string' && value.trim().length > 0) {
      return normalizeBaseUrl(value);
    }
    return null;
  } catch {
    return null;
  }
}

export async function getApiBaseUrl(options?: { forceRefresh?: boolean }): Promise<string> {
  if (options?.forceRefresh) {
    apiBaseUrlPromise = null;
  }

  if (isTauriRuntime()) {
    const tauriBaseUrl = await resolveTauriBaseUrl();
    if (tauriBaseUrl) {
      apiBaseUrlPromise = Promise.resolve(tauriBaseUrl);
      return tauriBaseUrl;
    }
  }

  if (!apiBaseUrlPromise) {
    apiBaseUrlPromise = Promise.resolve(resolveWebBaseUrl());
  }

  return apiBaseUrlPromise;
}

function isFetchNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = error.message.toLowerCase();
  return text.includes('failed to fetch') || text.includes('fetch failed') || text.includes('networkerror');
}

function buildApiUrl(baseUrl: string, path: string): string {
  if (!path.startsWith('/')) {
    return `${baseUrl}/${path}`;
  }

  return `${baseUrl}${path}`;
}

function makeErrorMessage(status: number, bodyText: string): string {
  const raw = bodyText.trim();
  if (!raw) {
    return `HTTP ${status}`;
  }

  try {
    const parsed = JSON.parse(raw) as JsonRecord;
    const message = parsed.message ?? parsed.error;
    if (typeof message === 'string' && message.trim().length > 0) {
      return `HTTP ${status}: ${message}`;
    }
    return `HTTP ${status}: ${raw}`;
  } catch {
    return `HTTP ${status}: ${raw}`;
  }
}

export interface RequestJsonOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function prepareAbortSignal(
  signal?: AbortSignal,
  timeoutMs?: number,
): {
  signal?: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  if (!signal && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    return {
      signal: undefined,
      cleanup: () => {},
      didTimeout: () => false,
    };
  }

  const controller = new AbortController();
  let timeoutHandle: number | null = null;
  let timeoutTriggered = false;

  const abortFromParent = () => {
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', abortFromParent);
    }
  }

  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutHandle = window.setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutHandle != null) {
        window.clearTimeout(timeoutHandle);
      }
      if (signal) {
        signal.removeEventListener('abort', abortFromParent);
      }
    },
    didTimeout: () => timeoutTriggered,
  };
}

async function requestJsonWithBaseUrl<TResponse>(
  baseUrl: string,
  path: string,
  options?: RequestJsonOptions,
): Promise<TResponse> {
  const url = buildApiUrl(baseUrl, path);
  const method = options?.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options?.headers ?? {}),
  };
  let bodyText: string | undefined;

  if (options?.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    bodyText = JSON.stringify(options.body);
  }

  const abortState = prepareAbortSignal(options?.signal, options?.timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: bodyText,
      signal: abortState.signal,
    });
  } catch (error) {
    abortState.cleanup();
    if (abortState.didTimeout() && isAbortError(error)) {
      throw new Error(`Request timed out after ${Math.round(options?.timeoutMs || 0)}ms`);
    }
    throw error;
  }

  try {
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(makeErrorMessage(response.status, responseText));
    }

    if (!responseText.trim()) {
      return undefined as TResponse;
    }

    return JSON.parse(responseText) as TResponse;
  } finally {
    abortState.cleanup();
  }
}

export async function getOpenFangBaseUrl(): Promise<string> {
  const tauriOpenFangBase = await resolveTauriOpenFangBaseUrl();
  if (tauriOpenFangBase) {
    return tauriOpenFangBase;
  }
  return getApiBaseUrl();
}

export async function requestJson<TResponse>(
  path: string,
  options?: RequestJsonOptions,
): Promise<TResponse> {
  const firstBaseUrl = await getApiBaseUrl();
  try {
    return await requestJsonWithBaseUrl<TResponse>(firstBaseUrl, path, options);
  } catch (error) {
    if (!isFetchNetworkError(error)) {
      throw error;
    }
    const retryBaseUrl = await getApiBaseUrl({ forceRefresh: true });
    return requestJsonWithBaseUrl<TResponse>(retryBaseUrl, path, options);
  }
}

export async function requestOpenFangJson<TResponse>(
  path: string,
  options?: RequestJsonOptions,
): Promise<TResponse> {
  const baseUrl = await getOpenFangBaseUrl();
  return requestJsonWithBaseUrl<TResponse>(baseUrl, path, options);
}

export interface RequestSseOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface WebSocketMessageFrame {
  data: string;
}

export interface RequestWebSocketOptions {
  signal?: AbortSignal;
  protocols?: string | string[];
}

export interface SseEventFrame {
  event: string;
  data: string;
}

function parseSseFrame(frameText: string): SseEventFrame | null {
  const lines = frameText.replace(/\r\n/g, '\n').split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim() || 'message';
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: dataLines.join('\n'),
  };
}

export async function requestWebSocket(
  path: string,
  onMessage: (frame: WebSocketMessageFrame) => boolean | void,
  body?: unknown,
  options?: RequestWebSocketOptions,
): Promise<void> {
  const preferredBaseUrl = (await resolveTauriOpenFangBaseUrl()) ?? (await getApiBaseUrl());
  const wsBaseUrl = preferredBaseUrl.replace(/^http/i, 'ws');
  const url = buildApiUrl(wsBaseUrl, path);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url, options?.protocols);

    const cleanup = () => {
      if (options?.signal) {
        options.signal.removeEventListener('abort', handleAbort);
      }
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const handleAbort = () => {
      try {
        socket.close(1000, 'aborted');
      } catch {
        // ignore
      }
      finish(new Error('WebSocket 请求已取消'));
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        handleAbort();
        return;
      }
      options.signal.addEventListener('abort', handleAbort);
    }

    socket.onopen = () => {
      if (body !== undefined) {
        socket.send(JSON.stringify(body));
      }
    };

    socket.onmessage = (event) => {
      if (settled) return;
      const shouldFinish = onMessage({ data: typeof event.data === 'string' ? event.data : '' });
      if (shouldFinish) {
        try {
          socket.close(1000, 'completed');
        } catch {
          // ignore
        }
        finish();
      }
    };

    socket.onerror = () => {
      finish(new Error('WebSocket 连接失败'));
    };

    socket.onclose = (event) => {
      if (settled) return;
      if (event.code === 1000) {
        finish();
        return;
      }
      finish(new Error(event.reason || `WebSocket 已关闭 (${event.code})`));
    };
  });
}

export async function requestSse(
  path: string,
  onEvent: (frame: SseEventFrame) => void,
  options?: RequestSseOptions,
): Promise<void> {
  const baseUrl = await getApiBaseUrl();
  const url = buildApiUrl(baseUrl, path);
  const method = options?.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    ...(options?.headers ?? {}),
  };
  let bodyText: string | undefined;

  if (options?.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    bodyText = JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    method,
    headers,
    body: bodyText,
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(makeErrorMessage(response.status, errorText));
  }

  if (!response.body) {
    throw new Error('SSE 响应无可读数据流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const delimiterIndex = buffer.search(/\r?\n\r?\n/);
      if (delimiterIndex < 0) {
        break;
      }

      const frameText = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + (buffer[delimiterIndex] === '\r' ? 4 : 2));

      const frame = parseSseFrame(frameText);
      if (frame) {
        onEvent(frame);
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const frame = parseSseFrame(tail);
    if (frame) {
      onEvent(frame);
    }
  }
}
