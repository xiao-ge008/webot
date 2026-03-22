import { saveOfficeBinaryAs } from '@/services/office-file-client';
import { getApiBaseUrl, getOpenFangBaseUrl, requestJson } from '@/services/transport';

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function asStringArrayLoose(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) {
        output.push(trimmed);
      }
      continue;
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      output.push(String(item));
    }
  }
  return output;
}

function isSemanticMemoryUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  const lower = message.toLowerCase();
  if (message.includes('HTTP 501')) {
    return message.includes('语义记忆接口') || lower.includes('semantic memory');
  }
  if (!message.includes('HTTP 404')) {
    return false;
  }
  if (!message.includes('/api/memory/agents/')) {
    return false;
  }
  return !lower.includes('memory not found') && !message.includes('记忆不存在');
}

function semanticMemoryUnsupportedClientError(): Error {
  return new Error('当前 OpenFang 运行时未启用语义记忆接口，请升级并重启 OpenFang 后重试。');
}

function pickDescription(primary: unknown, fallbackA?: unknown, fallbackB?: unknown): string {
  const values = [primary, fallbackA, fallbackB];
  for (const value of values) {
    const text = asString(value).trim();
    if (text.length > 0) {
      return text;
    }
  }
  return '';
}

const LOCAL_MANAGEMENT_PATH_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/api\/management\/agents\/.+)$/i;
export const MANAGEMENT_CONTEXT_FILE_NAMES = [
  'SOUL.md',
  'USER.md',
  'TOOLS.md',
  'MEMORY.md',
  'AGENTS.md',
  'BOOTSTRAP.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
] as const;
export type ManagementContextFileName = typeof MANAGEMENT_CONTEXT_FILE_NAMES[number];

function normalizeManagementAssetUrl(raw: unknown, baseUrl: string): string | undefined {
  const value = asString(raw).trim();
  if (!value) {
    return undefined;
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const localMatch = value.match(LOCAL_MANAGEMENT_PATH_PATTERN);
  if (localMatch) {
    return `${normalizedBase}${localMatch[1]}`;
  }
  if (value.startsWith('/api/management/')) {
    return `${normalizedBase}${value}`;
  }
  return value;
}

function parseManagementChannelBinding(value: unknown): ManagementChannelBinding | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const type = asString(value.type).trim().toLowerCase();
  const rawConfig = isRecord(value.config) ? value.config : {};
  switch (type) {
    case 'telegram':
      return {
        type: 'telegram',
        config: {
          bot_token_env: asString(rawConfig.bot_token_env, 'TELEGRAM_BOT_TOKEN').trim() || 'TELEGRAM_BOT_TOKEN',
          allowed_users: asStringArrayLoose(rawConfig.allowed_users),
          poll_interval_secs: asNumber(rawConfig.poll_interval_secs, 1),
          default_agent: asString(rawConfig.default_agent) || undefined,
        },
      };
    case 'discord':
      return {
        type: 'discord',
        config: {
          bot_token_env: asString(rawConfig.bot_token_env, 'DISCORD_BOT_TOKEN').trim() || 'DISCORD_BOT_TOKEN',
          allowed_guilds: asStringArrayLoose(rawConfig.allowed_guilds),
          intents: asNumber(rawConfig.intents, 33280),
          default_agent: asString(rawConfig.default_agent) || undefined,
        },
      };
    case 'email':
      return {
        type: 'email',
        config: {
          imap_host: asString(rawConfig.imap_host).trim(),
          imap_port: asNumber(rawConfig.imap_port, 993),
          smtp_host: asString(rawConfig.smtp_host).trim(),
          smtp_port: asNumber(rawConfig.smtp_port, 587),
          username: asString(rawConfig.username).trim(),
          password_env: asString(rawConfig.password_env, 'EMAIL_PASSWORD').trim() || 'EMAIL_PASSWORD',
          poll_interval_secs: asNumber(rawConfig.poll_interval_secs, 30),
          folders: asStringArrayLoose(rawConfig.folders),
          allowed_senders: asStringArrayLoose(rawConfig.allowed_senders),
          default_agent: asString(rawConfig.default_agent) || undefined,
        },
      };
    case 'feishu':
      return {
        type: 'feishu',
        config: {
          app_id: asString(rawConfig.app_id).trim(),
          app_secret_env: asString(rawConfig.app_secret_env, 'FEISHU_APP_SECRET').trim() || 'FEISHU_APP_SECRET',
          webhook_port: asNumber(rawConfig.webhook_port, 8453),
          default_agent: asString(rawConfig.default_agent) || undefined,
        },
      };
    case 'qqbot':
      return {
        type: 'qqbot',
        config: {
          app_id: asString(rawConfig.app_id, asString(rawConfig.appId)).trim(),
          client_secret: asString(rawConfig.client_secret, asString(rawConfig.clientSecret)).trim(),
          default_agent: asString(rawConfig.default_agent) || undefined,
        },
      };
    default:
      return undefined;
  }
}

export interface ManagementModelOption {
  modelId: string;
  providerId: string;
  modelName: string;
  displayName: string;
  available: boolean;
  enabled: boolean;
  isDefault: boolean;
  supportsVision: boolean;
  source?: string;
}

export interface ManagementModelsPayload {
  models: ManagementModelOption[];
  defaultModelId?: string;
  defaultModelValid: boolean;
  defaultModelReason?: string;
}

export async function listManagementModels(): Promise<ManagementModelsPayload> {
  const payload = await requestJson<unknown>('/api/management/models');
  const rows = isRecord(payload) && Array.isArray(payload.models) ? payload.models : [];
  const defaultModelId = isRecord(payload) ? asString(payload.default_model_id) : '';

  const models = rows
    .filter(isRecord)
    .map((row) => {
      const modelId = asString(row.id, asString(row.model));
      const providerId = asString(row.provider, 'unknown');
      const modelName = asString(row.model, modelId);
      const displayName = asString(row.display_name, modelId || 'Unknown Model');
      const available = typeof row.available === 'boolean' ? row.available : true;
      const enabled = typeof row.enabled === 'boolean' ? row.enabled : true;
      const isDefault =
        typeof row.is_default === 'boolean' ? row.is_default : defaultModelId === modelId;
      return {
        modelId,
        providerId,
        modelName,
        displayName,
        available,
        enabled,
        isDefault,
        supportsVision: asBool(row.supports_vision),
        source: asString(row.source) || undefined,
      };
    })
    .filter((item) => item.modelId.length > 0);

  return {
    models,
    defaultModelId: defaultModelId || undefined,
    defaultModelValid: isRecord(payload) ? asBool(payload.default_model_valid, Boolean(defaultModelId)) : Boolean(defaultModelId),
    defaultModelReason: isRecord(payload) ? asString(payload.default_model_reason) || undefined : undefined,
  };
}

export interface ManagementProviderOption {
  providerId: string;
  displayName: string;
  authStatus: string;
  baseUrl: string;
  modelCount: number;
  enabled: boolean;
  linked: boolean;
  hasApiKey: boolean;
  hasBaseUrl: boolean;
  configured: boolean;
  runtimeLoaded: boolean;
  modelDiscovered: boolean;
  healthy: boolean;
  healthStatus?: string;
  source?: string;
  protocol?: string;
  isCustom?: boolean;
  connectionStatus?: string;
  connectionMessage?: string;
}

function scoreManagementProviderOption(item: ManagementProviderOption): number {
  let score = 0;
  if (item.healthy) score += 32;
  if (item.configured) score += 16;
  if (item.hasApiKey) score += 8;
  if (item.runtimeLoaded) score += 4;
  if (item.modelDiscovered) score += 2;
  if (item.modelCount > 0) score += 1;
  return score;
}

function mergeManagementProviderOption(
  current: ManagementProviderOption,
  incoming: ManagementProviderOption,
): ManagementProviderOption {
  const preferIncoming =
    scoreManagementProviderOption(incoming) >= scoreManagementProviderOption(current);
  const primary = preferIncoming ? incoming : current;
  const secondary = preferIncoming ? current : incoming;
  return {
    ...primary,
    displayName: primary.displayName || secondary.displayName,
    authStatus: primary.authStatus || secondary.authStatus,
    baseUrl: primary.baseUrl || secondary.baseUrl,
    modelCount: Math.max(primary.modelCount, secondary.modelCount),
    enabled: primary.enabled,
    linked: primary.linked || secondary.linked,
    hasApiKey: primary.hasApiKey || secondary.hasApiKey,
    hasBaseUrl: primary.hasBaseUrl || secondary.hasBaseUrl,
    configured: primary.configured || secondary.configured,
    runtimeLoaded: primary.runtimeLoaded || secondary.runtimeLoaded,
    modelDiscovered: primary.modelDiscovered || secondary.modelDiscovered,
    healthy: primary.healthy || secondary.healthy,
    healthStatus:
      primary.healthStatus ||
      secondary.healthStatus ||
      (primary.healthy || secondary.healthy ? 'healthy' : undefined),
    source: primary.source || secondary.source,
    protocol: primary.protocol || secondary.protocol,
    isCustom: primary.isCustom ?? secondary.isCustom,
    connectionStatus: primary.connectionStatus || secondary.connectionStatus,
    connectionMessage: primary.connectionMessage || secondary.connectionMessage,
  };
}

export async function listManagementProviders(): Promise<ManagementProviderOption[]> {
  const payload = await requestJson<unknown>('/api/management/providers');
  const rows = isRecord(payload) && Array.isArray(payload.providers) ? payload.providers : [];
  const parsedRows = rows
    .filter(isRecord)
    .map((row) => ({
      providerId: asString(row.id),
      displayName: asString(row.display_name, asString(row.id)),
      authStatus: asString(row.auth_status),
      baseUrl: asString(row.base_url),
      modelCount: typeof row.model_count === 'number' ? row.model_count : 0,
      enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
      linked: typeof row.linked === 'boolean' ? row.linked : true,
      hasApiKey: Boolean(row.has_api_key),
      hasBaseUrl: Boolean(row.has_base_url),
      configured: typeof row.configured === 'boolean' ? row.configured : Boolean(row.has_api_key),
      runtimeLoaded: typeof row.runtime_loaded === 'boolean' ? row.runtime_loaded : false,
      modelDiscovered: typeof row.model_discovered === 'boolean' ? row.model_discovered : false,
      healthy: typeof row.healthy === 'boolean' ? row.healthy : false,
      healthStatus: asString(row.health_status) || undefined,
      source: asString(row.source) || undefined,
      protocol: asString(row.protocol) || undefined,
      isCustom: typeof row.is_custom === 'boolean' ? row.is_custom : undefined,
      connectionStatus: asString(row.connection_status) || undefined,
      connectionMessage: asString(row.connection_message) || undefined,
    }))
    .filter((item) => item.providerId.length > 0);
  const merged = new Map<string, ManagementProviderOption>();
  for (const item of parsedRows) {
    const existing = merged.get(item.providerId);
    if (existing) {
      merged.set(item.providerId, mergeManagementProviderOption(existing, item));
      continue;
    }
    merged.set(item.providerId, item);
  }
  return Array.from(merged.values());
}

export interface ManagementProviderTestResult {
  ok: boolean;
  status: string;
  message: string;
  model_count?: number;
}

export interface ManagementProviderDiscoverResult {
  ok: boolean;
  status: string;
  message: string;
  model_count?: number;
  models: string[];
}

export async function testManagementProviderConnection(
  providerId: string,
): Promise<ManagementProviderTestResult> {
  const payload = await requestJson<unknown>('/api/management/providers/test', {
    method: 'POST',
    body: {
      provider_id: providerId,
    },
  });
  if (!isRecord(payload)) {
    return {
      ok: false,
      status: 'invalid_response',
      message: '供应商检测返回格式异常',
    };
  }
  return {
    ok: asBool(payload.ok),
    status: asString(payload.status),
    message: asString(payload.message, '供应商检测失败'),
    model_count:
      typeof payload.model_count === 'number' && Number.isFinite(payload.model_count)
        ? payload.model_count
        : undefined,
  };
}

export async function toggleManagementProviderEnabled(
  providerId: string,
  enabled: boolean,
): Promise<void> {
  await requestJson(`/api/management/providers/${encodeURIComponent(providerId)}/enabled`, {
    method: 'PUT',
    body: { enabled },
  });
}

export async function toggleManagementModelEnabled(modelId: string, enabled: boolean): Promise<void> {
  await requestJson(`/api/management/models/${encodeURIComponent(modelId)}/enabled`, {
    method: 'PUT',
    body: { enabled },
  });
}

export async function setManagementDefaultModel(modelId: string): Promise<void> {
  await requestJson(`/api/management/models/${encodeURIComponent(modelId)}/default`, {
    method: 'PUT',
    body: {},
  });
}

export async function discoverManagementProviderModels(
  providerId: string,
): Promise<ManagementProviderDiscoverResult> {
  const payload = await requestJson<unknown>(
    `/api/management/providers/${encodeURIComponent(providerId)}/discover-models`,
    {
      method: 'POST',
      body: {},
    },
  );
  if (!isRecord(payload)) {
    return {
      ok: false,
      status: 'invalid_response',
      message: '获取模型返回格式异常',
      models: [],
    };
  }
  return {
    ok: asBool(payload.ok),
    status: asString(payload.status),
    message: asString(payload.message, '获取模型失败'),
    model_count:
      typeof payload.model_count === 'number' && Number.isFinite(payload.model_count)
        ? payload.model_count
        : undefined,
    models: asStringArray(payload.models),
  };
}

export async function updateManagementCustomModelVision(input: {
  modelId: string;
  providerId: string;
  modelName: string;
  supportsVision: boolean;
}): Promise<void> {
  await requestJson(`/api/management/models/${encodeURIComponent(input.modelId)}/vision`, {
    method: 'PUT',
    body: {
      provider: input.providerId,
      model: input.modelName,
      supports_vision: input.supportsVision,
    },
  });
}

export interface ManagementModelTestResult {
  ok: boolean;
  status: string;
  message: string;
  model_id?: string;
}

function isHttp404Error(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /HTTP\s+404\b/i.test(error.message);
}

export async function testManagementModelConnection(input: {
  provider: string;
  model: string;
  modelId?: string;
}): Promise<ManagementModelTestResult> {
  try {
    const payload = await requestJson<unknown>('/api/management/models/test', {
      method: 'POST',
      body: {
        provider: input.provider,
        model: input.model,
        model_id: input.modelId,
      },
    });
    if (!isRecord(payload)) {
      return { ok: false, status: 'invalid_response', message: '模型测试返回格式异常' };
    }
    return {
      ok: asBool(payload.ok),
      status: asString(payload.status),
      message: asString(payload.message, '模型测试失败'),
      model_id: asString(payload.model_id) || undefined,
    };
  } catch (error) {
    if (!isHttp404Error(error)) {
      throw error;
    }
    // 兼容旧后端：新接口不存在时，回退到已有的 optimize 路径做真实模型通信探测。
    const fallbackPayload = await requestJson<unknown>('/api/management/models/optimize-prompt', {
      method: 'POST',
      body: {
        input: '请只回复：OK',
        target: 'agent_profile',
        provider: input.provider,
        model: input.model,
      },
    });
    if (!isRecord(fallbackPayload)) {
      return { ok: false, status: 'invalid_response', message: '模型测试返回格式异常' };
    }
    const isFallback = asBool(fallbackPayload.fallback);
    const upstreamError = asString(fallbackPayload.error).trim();
    const content = asString(fallbackPayload.content).trim();
    if (!isFallback && content.length > 0) {
      return {
        ok: true,
        status: 'ok',
        message: '连接正常，模型通信可用',
        model_id: input.modelId,
      };
    }
    return {
      ok: false,
      status: 'connection_error',
      message: upstreamError || '模型通信失败，请检查 Base URL / API Key / 模型名',
      model_id: input.modelId,
    };
  }
}

export type DeleteManagementAgentMode = 'purge' | 'local_only';

export interface DeleteManagementAgentResult {
  status?: string;
  agent_id?: string;
  mode?: DeleteManagementAgentMode;
  deleted_openfang?: boolean;
  deleted_workspace_dirs?: string[];
}

export async function deleteManagementAgent(
  agentId: string,
  mode: DeleteManagementAgentMode = 'purge',
): Promise<DeleteManagementAgentResult> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}?mode=${encodeURIComponent(mode)}`,
    {
      method: 'DELETE',
    },
  );
  if (!isRecord(payload)) {
    return {};
  }
  return {
    status: asString(payload.status) || undefined,
    agent_id: asString(payload.agent_id) || undefined,
    mode: (asString(payload.mode) as DeleteManagementAgentMode) || undefined,
    deleted_openfang: typeof payload.deleted_openfang === 'boolean' ? payload.deleted_openfang : undefined,
    deleted_workspace_dirs: asStringArray(payload.deleted_workspace_dirs),
  };
}

export interface ManagementAgentExportOptions {
  include_profile?: boolean;
  include_context_files?: boolean;
  include_memory_files?: boolean;
  include_media_files?: boolean;
  include_assignments?: boolean;
  include_chat_history?: boolean;
}

function parseDownloadFilenameFromDisposition(disposition: string | null): string | undefined {
  if (!disposition) {
    return undefined;
  }
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"+|"+$/g, ''));
    } catch {
      // ignore and fallback
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }
  return undefined;
}

export async function downloadManagementAgentExport(
  agentId: string,
  options: ManagementAgentExportOptions = {},
): Promise<{ filename: string; size: number }> {
  const buildExportQueryString = (value: ManagementAgentExportOptions): string => {
    const query = new URLSearchParams();
    const appendBoolean = (key: keyof ManagementAgentExportOptions) => {
      const current = value[key];
      if (typeof current === 'boolean') {
        query.set(key, String(current));
      }
    };
    appendBoolean('include_profile');
    appendBoolean('include_context_files');
    appendBoolean('include_memory_files');
    appendBoolean('include_media_files');
    appendBoolean('include_assignments');
    appendBoolean('include_chat_history');
    const encoded = query.toString();
    return encoded ? `?${encoded}` : '';
  };

  const isRetryableExportError = (error: unknown): boolean => {
    if (isFailedToFetchError(error)) {
      return true;
    }
    if (!(error instanceof Error)) {
      return false;
    }
    const text = error.message.toLowerCase();
    return text.includes('http 404') || text.includes('接口不存在（404）') || text.includes('not found');
  };

  const tryFetchExportByPost = async (baseUrl: string): Promise<Response> => {
    const url = buildApiUrl(baseUrl, `/api/management/agents/${encodeURIComponent(agentId)}/export`);
    return fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/zip, application/octet-stream, application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options ?? {}),
    });
  };

  const tryFetchExportByGet = async (baseUrl: string): Promise<Response> => {
    const query = buildExportQueryString(options);
    const url = buildApiUrl(
      baseUrl,
      `/api/management/agents/${encodeURIComponent(agentId)}/export${query}`,
    );
    return fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/zip, application/octet-stream, application/json',
      },
    });
  };

  const attempt = async (baseUrl: string): Promise<{ filename: string; size: number }> => {
    await ensureManagementApiReady(baseUrl);
    let response = await tryFetchExportByPost(baseUrl);
    if (!response.ok && (response.status === 404 || response.status === 405)) {
      // 某些运行环境对 POST 下载兼容性较差，降级到 GET 保持导出可用。
      response = await tryFetchExportByGet(baseUrl);
    }

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404) {
        throw new Error(
          '导出接口不存在（404）。请先重启 App/后端到最新版本后重试，或确认当前连接地址是新版 webot-service-rs。',
        );
      }
      throw parseHttpError(response.status, text);
    }

    const blob = await response.blob();
    if (blob.size <= 0) {
      throw new Error('导出文件为空');
    }

    const filename =
      parseDownloadFilenameFromDisposition(response.headers.get('content-disposition')) ||
      `agent-export-${agentId}.zip`;

    const buffer = await blob.arrayBuffer();
    const saved = await saveOfficeBinaryAs(buffer, filename);
    if (!saved.ok) {
      throw new Error(saved.message || '导出文件保存失败');
    }
    return { filename, size: blob.size };
  };

  const firstBase = await getApiBaseUrl();
  try {
    return await attempt(firstBase);
  } catch (error) {
    if (!isRetryableExportError(error)) {
      throw error;
    }
    const secondBase = await getApiBaseUrl({ forceRefresh: true });
    return attempt(secondBase);
  }
}

export interface ManagementAgentImportResult {
  agent_id: string;
  source_agent_id?: string;
  source_workspace_name?: string;
  source_filename?: string;
  chat_session?: unknown;
  warnings?: string[];
}

const MAX_AGENT_IMPORT_BUNDLE_BYTES = 128 * 1024 * 1024;

export async function importManagementAgentBundle(file: File): Promise<ManagementAgentImportResult> {
  if (!file || file.size <= 0) {
    throw new Error('请选择有效的导入文件');
  }
  if (file.size > MAX_AGENT_IMPORT_BUNDLE_BYTES) {
    const currentSizeMb = (file.size / (1024 * 1024)).toFixed(1);
    const maxSizeMb = (MAX_AGENT_IMPORT_BUNDLE_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`导入包过大（当前 ${currentSizeMb} MB，最大 ${maxSizeMb} MB）`);
  }

  const attempt = async (baseUrl: string): Promise<ManagementAgentImportResult> => {
    await ensureManagementApiReady(baseUrl);
    const query = new URLSearchParams();
    query.set('filename', file.name || 'agent-bundle.zip');
    const url = buildApiUrl(baseUrl, `/api/management/agents/import/upload?${query.toString()}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': file.type || 'application/zip',
      },
      body: file,
    });

    const text = await response.text();
    if (!response.ok) {
      throw parseHttpError(response.status, text);
    }

    const payload = text.trim().length > 0 ? (JSON.parse(text) as unknown) : {};
    if (!isRecord(payload)) {
      throw new Error('导入接口返回格式异常');
    }
    const agentId = asString(payload.agent_id);
    if (!agentId) {
      throw new Error('导入成功但未返回 agent_id');
    }
    return {
      agent_id: agentId,
      source_agent_id: asString(payload.source_agent_id) || undefined,
      source_workspace_name: asString(payload.source_workspace_name) || undefined,
      source_filename: asString(payload.source_filename) || undefined,
      chat_session: payload.chat_session,
      warnings: Array.isArray(payload.warnings)
        ? payload.warnings.filter((item): item is string => typeof item === 'string')
        : undefined,
    };
  };

  const firstBase = await getApiBaseUrl();
  try {
    return await attempt(firstBase);
  } catch (error) {
    if (!isFailedToFetchError(error)) {
      throw error;
    }
    const secondBase = await getApiBaseUrl({ forceRefresh: true });
    return attempt(secondBase);
  }
}

export interface ProviderConfigItem {
  provider_id: string;
  display_name?: string;
  protocol: 'openai' | 'claude' | string;
  base_url?: string;
  has_api_key: boolean;
  api_key_masked?: string;
  models: string[];
  is_custom: boolean;
  updated_at?: string;
}

export async function listManagementProviderConfigs(): Promise<ProviderConfigItem[]> {
  const payload = await requestJson<unknown>('/api/management/providers/configs');
  const rows = isRecord(payload) && Array.isArray(payload.providers) ? payload.providers : [];
  return rows
    .filter(isRecord)
    .map((row) => ({
      provider_id: asString(row.provider_id),
      display_name: asString(row.display_name) || undefined,
      protocol: asString(row.protocol, 'openai'),
      base_url: asString(row.base_url) || undefined,
      has_api_key: Boolean(row.has_api_key),
      api_key_masked: asString(row.api_key_masked) || undefined,
      models: asStringArray(row.models),
      is_custom: Boolean(row.is_custom),
      updated_at: asString(row.updated_at) || undefined,
    }))
    .filter((item) => item.provider_id.length > 0);
}

export interface UpsertProviderConfigInput {
  display_name?: string;
  protocol?: 'openai' | 'claude';
  base_url?: string;
  api_key?: string;
  clear_api_key?: boolean;
  models?: string[];
  is_custom?: boolean;
}

export async function updateManagementProviderConfig(
  providerId: string,
  input: UpsertProviderConfigInput,
): Promise<void> {
  await requestJson(`/api/management/providers/${encodeURIComponent(providerId)}/config`, {
    method: 'PUT',
    body: input,
  });
}

export async function deleteManagementProviderConfig(providerId: string): Promise<void> {
  await requestJson(`/api/management/providers/${encodeURIComponent(providerId)}/config`, {
    method: 'DELETE',
  });
}

export interface CreateCustomProviderInput {
  id: string;
  display_name: string;
  protocol: 'openai' | 'claude';
  base_url?: string;
  api_key?: string;
  models: string[];
  enabled?: boolean;
}

export async function createManagementCustomProvider(input: CreateCustomProviderInput): Promise<void> {
  await requestJson('/api/management/providers/custom', {
    method: 'POST',
    body: input,
  });
}

export async function createAgentFromManifest(
  manifestToml: string,
): Promise<{ agentId: string; name: string }> {
  const payload = await requestJson<unknown>('/api/management/agents', {
    method: 'POST',
    body: {
      manifest_toml: manifestToml,
    },
  });

  if (!isRecord(payload)) {
    throw new Error('创建智能体返回异常');
  }
  const agentId = asString(payload.agent_id, asString(payload.id));
  if (!agentId) {
    throw new Error('创建智能体成功但缺少 agent_id');
  }
  return {
    agentId,
    name: asString(payload.name, agentId),
  };
}

export async function getManagementChannelStatuses(): Promise<ManagementChannelStatusItem[]> {
  const payload = await requestJson<unknown>('/api/management/channels/status');
  if (!isRecord(payload)) {
    return [];
  }
  const rows = Array.isArray(payload.channels) ? payload.channels : [];
  return rows
    .filter(isRecord)
    .map((row) => ({
      type: asString(row.type) as ManagementChannelBindingType,
      configured: asBool(row.configured),
      secrets_ready: asBool(row.secrets_ready),
      applied: asBool(row.applied),
      runtime_online: asBool(row.runtime_online),
      bridge_connected: typeof row.bridge_connected === 'boolean' ? row.bridge_connected : undefined,
      bridge_last_event_at: typeof row.bridge_last_event_at === 'number' ? row.bridge_last_event_at : undefined,
      bridge_last_error: asString(row.bridge_last_error) || undefined,
      missing: asStringArrayLoose(row.missing),
      missing_env: asStringArrayLoose(row.missing_env),
      source_agent: asString(row.source_agent) || null,
      status: asString(row.status),
    }))
    .filter((item) => item.type.length > 0);
}

export async function testManagementChannelConnection(
  channel: ManagementChannelBindingType,
): Promise<ManagementChannelTestResult> {
  const payload = await requestJson<unknown>('/api/management/channels/test', {
    method: 'POST',
    body: { channel },
  });
  if (!isRecord(payload)) {
    return { ok: false, status: 'error', message: '测试连接返回异常' };
  }
  return {
    ok: asBool(payload.ok),
    status: asString(payload.status),
    message: asString(payload.message, '未知错误'),
    missing: asStringArrayLoose(payload.missing),
    missing_env: asStringArrayLoose(payload.missing_env),
  };
}

export type ManagementChannelBindingType = 'telegram' | 'discord' | 'email' | 'feishu' | 'qqbot';

export interface TelegramChannelConfig {
  bot_token_env: string;
  allowed_users: string[];
  poll_interval_secs: number;
  default_agent?: string;
}

export interface DiscordChannelConfig {
  bot_token_env: string;
  allowed_guilds: string[];
  intents: number;
  default_agent?: string;
}

export interface EmailChannelConfig {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  password_env: string;
  poll_interval_secs: number;
  folders: string[];
  allowed_senders: string[];
  default_agent?: string;
}

export interface FeishuChannelConfig {
  app_id: string;
  app_secret_env: string;
  webhook_port: number;
  default_agent?: string;
}

export interface QqbotChannelConfig {
  app_id: string;
  client_secret: string;
  default_agent?: string;
}

export interface ManagementChannelStatusItem {
  type: ManagementChannelBindingType;
  configured: boolean;
  secrets_ready: boolean;
  applied: boolean;
  runtime_online: boolean;
  bridge_connected?: boolean;
  bridge_last_event_at?: number;
  bridge_last_error?: string;
  missing?: string[];
  missing_env?: string[];
  source_agent?: string | null;
  status: string;
}

export interface ManagementChannelTestResult {
  ok: boolean;
  status: string;
  message: string;
  missing?: string[];
  missing_env?: string[];
}

export type ManagementChannelBinding =
  | { type: 'telegram'; config: TelegramChannelConfig }
  | { type: 'discord'; config: DiscordChannelConfig }
  | { type: 'email'; config: EmailChannelConfig }
  | { type: 'feishu'; config: FeishuChannelConfig }
  | { type: 'qqbot'; config: QqbotChannelConfig };

export interface ManagementAgentDetail {
  id: string;
  name: string;
  english_name?: string;
  nickname?: string;
  description: string;
  tags: string[];
  state: string;
  authStatus?: string;
  ready?: boolean;
  system_prompt?: string;
  collaboration?: {
    discoverable: boolean;
    dispatchEnabled: boolean;
    selectedWorkers: string[];
  };
  channel_binding?: ManagementChannelBinding;
  model: {
    provider: string;
    model: string;
    apiKeyEnv?: string;
  };
  identity: {
    avatar_url?: string;
    portrait_url?: string;
    color?: string;
  };
}

export interface ManagementAgentSummary {
  id: string;
  name: string;
  english_name?: string;
  nickname?: string;
  description: string;
  tags: string[];
  state: string;
  authStatus?: string;
  ready?: boolean;
  collaboration?: {
    discoverable: boolean;
    dispatchEnabled: boolean;
    selectedWorkers: string[];
  };
  model: {
    provider: string;
    model: string;
    apiKeyEnv?: string;
  };
  identity: {
    avatar_url?: string;
    portrait_url?: string;
    color?: string;
  };
}

export interface ManagementAgentContextFile {
  name: ManagementContextFileName;
  content: string;
  exists: boolean;
  source?: string;
  updated_at?: string;
}

export interface ManagementA2aAgentSkill {
  id?: string;
  name?: string;
  description?: string;
}

export interface ManagementA2aAgentCard {
  name: string;
  description?: string;
  url?: string;
  version?: string;
  skills: ManagementA2aAgentSkill[];
}

export async function listManagementAgents(): Promise<ManagementAgentSummary[]> {
  const baseUrl = await getApiBaseUrl();
  const payload = await requestJson<unknown>('/api/management/agents');
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .filter(isRecord)
    .map((row) => {
      const model = isRecord(row.model) ? row.model : {};
      const identity = isRecord(row.identity) ? row.identity : {};
      const collaboration = isRecord(row.collaboration) ? row.collaboration : {};
      return {
        id: asString(row.id),
        name: asString(row.name, asString(row.id)),
        english_name: asString(row.english_name) || undefined,
        nickname: asString(row.nickname) || undefined,
        description: pickDescription(row.description, row.profile, row.summary),
        tags: asStringArray(row.tags),
        state: asString(row.state, 'offline'),
        authStatus: asString(row.auth_status) || undefined,
        ready: typeof row.ready === 'boolean' ? row.ready : undefined,
        collaboration: isRecord(row.collaboration)
          ? {
              discoverable: Boolean(collaboration.discoverable),
              dispatchEnabled: Boolean(collaboration.dispatchEnabled ?? collaboration.dispatch_enabled),
              selectedWorkers: asStringArray(collaboration.selectedWorkers ?? collaboration.selected_workers),
            }
          : undefined,
        model: {
          provider: asString(model.provider, asString(row.model_provider, 'unknown')),
          model: asString(model.model, asString(row.model_name)),
          apiKeyEnv: asString(model.api_key_env, asString(row.model_api_key_env)) || undefined,
        },
        identity: {
          avatar_url: normalizeManagementAssetUrl(identity.avatar_url, baseUrl),
          portrait_url: normalizeManagementAssetUrl(identity.portrait_url, baseUrl),
          color: asString(identity.color) || undefined,
        },
      };
    })
    .filter((item) => item.id.length > 0);
}

export async function listManagementA2aAgents(): Promise<ManagementA2aAgentCard[]> {
  const payload = await requestJson<unknown>('/api/management/a2a/agents');
  const rows = isRecord(payload) && Array.isArray(payload.agents) ? payload.agents : [];
  return rows
    .filter(isRecord)
    .map((row) => {
      const skills = Array.isArray(row.skills)
        ? row.skills
          .filter(isRecord)
          .map((skill) => ({
            id: asString(skill.id) || undefined,
            name: asString(skill.name) || undefined,
            description: asString(skill.description) || undefined,
          }))
        : [];
      return {
        name: asString(row.name, 'unknown'),
        description: asString(row.description) || undefined,
        url: asString(row.url) || undefined,
        version: asString(row.version) || undefined,
        skills,
      };
    })
    .filter((item) => item.name.trim().length > 0);
}

export async function getManagementAgentDetail(agentId: string): Promise<ManagementAgentDetail> {
  const baseUrl = await getApiBaseUrl();
  const payload = await requestJson<unknown>(`/api/management/agents/${encodeURIComponent(agentId)}`);
  if (!isRecord(payload)) {
    throw new Error('读取智能体详情失败');
  }
  const model = isRecord(payload.model) ? payload.model : {};
  const identity = isRecord(payload.identity) ? payload.identity : {};
  const collaboration = isRecord(payload.collaboration) ? payload.collaboration : {};
  const channelBinding = parseManagementChannelBinding(payload.channel_binding);
  // 尝试从多个字段路径读取 system_prompt（兼容不同版本后端的字段命名）
  const configObj = isRecord(payload.config) ? payload.config : payload;
  const systemPrompt =
    asString(payload.system_prompt) ||
    asString(configObj.system_prompt) ||
    asString(model.system_prompt) ||
    undefined;
  return {
    id: asString(payload.id),
    name: asString(payload.name),
    english_name: asString(payload.english_name) || undefined,
    nickname: asString(payload.nickname) || undefined,
    description: pickDescription(payload.description, payload.profile, payload.summary),
    tags: asStringArray(payload.tags),
    state: asString(payload.state, 'offline'),
    authStatus: asString(payload.auth_status) || undefined,
    ready: typeof payload.ready === 'boolean' ? payload.ready : undefined,
    system_prompt: systemPrompt,
    collaboration: isRecord(payload.collaboration)
      ? {
          discoverable: Boolean(collaboration.discoverable),
          dispatchEnabled: Boolean(collaboration.dispatchEnabled ?? collaboration.dispatch_enabled),
          selectedWorkers: asStringArray(collaboration.selectedWorkers ?? collaboration.selected_workers),
        }
      : undefined,
    channel_binding: channelBinding,
    model: {
      provider: asString(model.provider, 'unknown'),
      model: asString(model.model),
      apiKeyEnv: asString(model.api_key_env) || undefined,
    },
    identity: {
      avatar_url: normalizeManagementAssetUrl(identity.avatar_url, baseUrl),
      portrait_url: normalizeManagementAssetUrl(identity.portrait_url, baseUrl),
      color: asString(identity.color) || undefined,
    },
  };
}

function isManagementContextFileName(value: string): value is ManagementContextFileName {
  return (MANAGEMENT_CONTEXT_FILE_NAMES as readonly string[]).includes(value);
}

export async function getManagementAgentContextFiles(
  agentId: string,
): Promise<ManagementAgentContextFile[]> {
  const payload = await requestJson<unknown>(`/api/management/agents/${encodeURIComponent(agentId)}/context-files`);
  const rows = isRecord(payload) && Array.isArray(payload.files) ? payload.files : [];
  const output: ManagementAgentContextFile[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const fileName = asString(row.name);
    if (!isManagementContextFileName(fileName)) {
      continue;
    }
    output.push({
      name: fileName,
      content: asString(row.content),
      exists: Boolean(row.exists),
      source: asString(row.source) || undefined,
      updated_at: asString(row.updated_at) || undefined,
    });
  }
  return output;
}

export async function setManagementAgentContextFile(
  agentId: string,
  fileName: ManagementContextFileName,
  content: string,
): Promise<ManagementAgentContextFile> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/context-files/${encodeURIComponent(fileName)}`,
    {
      method: 'PUT',
      body: { content },
    },
  );
  if (!isRecord(payload)) {
    throw new Error('保存身份文件失败：返回数据异常');
  }
  const name = asString(payload.name);
  if (!isManagementContextFileName(name)) {
    throw new Error('保存身份文件失败：文件名非法');
  }
  return {
    name,
    content: asString(payload.content),
    exists: Boolean(payload.exists ?? true),
    source: asString(payload.source) || undefined,
    updated_at: asString(payload.updated_at) || undefined,
  };
}

export interface GenerateManagementAgentContextBundleInput {
  input: string;
  provider?: string;
  model?: string;
}

export interface GenerateManagementAgentContextBundleResult {
  status?: string;
  agent_id?: string;
  provider: string;
  model: string;
  target: string;
  fallback?: boolean;
  error?: string;
  content: string;
  system_prompt: string;
  files: ManagementAgentContextFile[];
}

export async function generateAndApplyManagementAgentContextBundle(
  agentId: string,
  input: GenerateManagementAgentContextBundleInput,
): Promise<GenerateManagementAgentContextBundleResult> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/context-files`,
    {
      method: 'POST',
      body: input,
    },
  );
  if (!isRecord(payload)) {
    throw new Error('生成身份文件失败：返回数据异常');
  }
  const rows = Array.isArray(payload.files) ? payload.files : [];
  const files: ManagementAgentContextFile[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const fileName = asString(row.name);
    if (!isManagementContextFileName(fileName)) {
      continue;
    }
    files.push({
      name: fileName,
      content: asString(row.content),
      exists: Boolean(row.exists ?? true),
      source: asString(row.source) || undefined,
      updated_at: asString(row.updated_at) || undefined,
    });
  }
  return {
    status: asString(payload.status) || undefined,
    agent_id: asString(payload.agent_id) || undefined,
    provider: asString(payload.provider),
    model: asString(payload.model),
    target: asString(payload.target),
    fallback: typeof payload.fallback === 'boolean' ? payload.fallback : undefined,
    error: asString(payload.error) || undefined,
    content: asString(payload.content),
    system_prompt: asString(payload.system_prompt),
    files,
  };
}

export interface ManagementAgentWorkspaceInfo {
  privateWorkspace: string;
  sharedWorkspace: string;
  extraWorkspaces: string[];
  allWorkspaces: string[];
  workspaceMcpServer?: string;
  workspaceMcpManaged: boolean;
}

function parseManagementAgentWorkspaceInfo(payload: unknown): ManagementAgentWorkspaceInfo {
  const object = isRecord(payload) ? payload : {};
  return {
    privateWorkspace: asString(object.private_workspace),
    sharedWorkspace: asString(object.shared_workspace),
    extraWorkspaces: asStringArray(object.extra_workspaces),
    allWorkspaces: asStringArray(object.all_workspaces),
    workspaceMcpServer: asString(object.workspace_mcp_server) || undefined,
    workspaceMcpManaged: typeof object.workspace_mcp_managed === 'boolean' ? object.workspace_mcp_managed : true,
  };
}

export async function getManagementAgentWorkspaces(agentId: string): Promise<ManagementAgentWorkspaceInfo> {
  const payload = await requestJson<unknown>(`/api/management/agents/${encodeURIComponent(agentId)}/workspaces`);
  return parseManagementAgentWorkspaceInfo(payload);
}

export async function setManagementAgentWorkspaces(
  agentId: string,
  extraWorkspaces: string[],
): Promise<ManagementAgentWorkspaceInfo> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/workspaces`,
    {
      method: 'PUT',
      body: {
        extra_workspaces: extraWorkspaces,
      },
    },
  );
  return parseManagementAgentWorkspaceInfo(payload);
}

export interface ManagementMemoryFileItem {
  path: string;
  name: string;
  size: number;
  modifiedMs: number;
}

export interface ManagementMemoryFileListResult {
  items: ManagementMemoryFileItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  filter: {
    startMs: number;
    endMs: number;
    defaultDays: number;
  };
}

export interface ManagementMemoryFileListQuery {
  startMs?: number;
  endMs?: number;
  days?: number;
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export async function listManagementAgentMemoryFiles(
  agentId: string,
  query: ManagementMemoryFileListQuery = {},
): Promise<ManagementMemoryFileListResult> {
  const searchParams = new URLSearchParams();
  if (typeof query.startMs === 'number' && Number.isFinite(query.startMs)) {
    searchParams.set('start_ms', String(Math.trunc(query.startMs)));
  }
  if (typeof query.endMs === 'number' && Number.isFinite(query.endMs)) {
    searchParams.set('end_ms', String(Math.trunc(query.endMs)));
  }
  if (typeof query.days === 'number' && Number.isFinite(query.days)) {
    searchParams.set('days', String(Math.trunc(query.days)));
  }
  if (typeof query.page === 'number' && Number.isFinite(query.page)) {
    searchParams.set('page', String(Math.trunc(query.page)));
  }
  if (typeof query.pageSize === 'number' && Number.isFinite(query.pageSize)) {
    searchParams.set('page_size', String(Math.trunc(query.pageSize)));
  }
  if (typeof query.keyword === 'string' && query.keyword.trim().length > 0) {
    searchParams.set('keyword', query.keyword.trim());
  }

  const suffix = searchParams.toString();
  let payload: unknown;
  try {
    payload = await requestJson<unknown>(
      `/api/management/agents/${encodeURIComponent(agentId)}/memory/files${suffix ? `?${suffix}` : ''}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('HTTP 404')) {
      throw new Error('记忆管理接口不存在（404）：请重启 webot-service-rs 到最新版本后重试。');
    }
    throw error;
  }
  const object = isRecord(payload) ? payload : {};
  const rows = Array.isArray(object.items) ? object.items : [];
  const pagination = isRecord(object.pagination) ? object.pagination : {};
  const filter = isRecord(object.filter) ? object.filter : {};
  return {
    items: rows
      .filter(isRecord)
      .map((row) => ({
        path: asString(row.path),
        name: asString(row.name),
        size: asNumber(row.size, 0),
        modifiedMs: asNumber(row.modified_ms, 0),
      }))
      .filter((item) => item.path.length > 0),
    pagination: {
      page: asNumber(pagination.page, 1),
      pageSize: asNumber(pagination.page_size, 20),
      total: asNumber(pagination.total, 0),
      totalPages: asNumber(pagination.total_pages, 0),
    },
    filter: {
      startMs: asNumber(filter.start_ms, 0),
      endMs: asNumber(filter.end_ms, 0),
      defaultDays: asNumber(filter.default_days, 7),
    },
  };
}

export interface ManagementMemoryFileContent {
  path: string;
  content: string;
  size: number;
  modifiedMs: number;
}

export async function getManagementAgentMemoryFile(
  agentId: string,
  relativePath: string,
): Promise<ManagementMemoryFileContent> {
  const searchParams = new URLSearchParams({ path: relativePath });
  let payload: unknown;
  try {
    payload = await requestJson<unknown>(
      `/api/management/agents/${encodeURIComponent(agentId)}/memory/file?${searchParams.toString()}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('HTTP 404')) {
      throw new Error('记忆管理接口不存在（404）：请重启 webot-service-rs 到最新版本后重试。');
    }
    throw error;
  }
  if (!isRecord(payload)) {
    throw new Error('读取记忆文件失败：返回数据异常');
  }
  return {
    path: asString(payload.path, relativePath),
    content: asString(payload.content),
    size: asNumber(payload.size, 0),
    modifiedMs: asNumber(payload.modified_ms, 0),
  };
}

export async function setManagementAgentMemoryFile(
  agentId: string,
  relativePath: string,
  content: string,
): Promise<ManagementMemoryFileContent> {
  let payload: unknown;
  try {
    payload = await requestJson<unknown>(
      `/api/management/agents/${encodeURIComponent(agentId)}/memory/file`,
      {
        method: 'PUT',
        body: {
          path: relativePath,
          content,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('HTTP 404')) {
      throw new Error('记忆管理接口不存在（404）：请重启 webot-service-rs 到最新版本后重试。');
    }
    throw error;
  }
  if (!isRecord(payload)) {
    throw new Error('保存记忆文件失败：返回数据异常');
  }
  return {
    path: asString(payload.path, relativePath),
    content,
    size: asNumber(payload.size, 0),
    modifiedMs: asNumber(payload.modified_ms, 0),
  };
}

export interface ManagementAgentMemorySearchQuery {
  q?: string;
  limit?: number;
  scope?: string;
  memoryType?: string;
  minConfidence?: number;
}

export interface ManagementAgentMemoryItem {
  id: string;
  agentId: string;
  content: string;
  source: unknown;
  scope: string;
  confidence: number;
  createdAt: string;
  accessedAt: string;
  accessCount: number;
  memoryType?: string;
  importance?: number;
  status?: string;
  entityKey?: string;
  supersedesId?: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
}

function parseManagementMemoryItem(payload: unknown): ManagementAgentMemoryItem | null {
  if (!isRecord(payload)) {
    return null;
  }
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  return {
    id: asString(payload.id),
    agentId: asString(payload.agent_id),
    content: asString(payload.content),
    source: payload.source,
    scope: asString(payload.scope),
    confidence: asNumber(payload.confidence, 0),
    createdAt: asString(payload.created_at),
    accessedAt: asString(payload.accessed_at),
    accessCount: asNumber(payload.access_count, 0),
    memoryType:
      asString(payload.memory_type) ||
      asString(metadata.memory_type) ||
      undefined,
    importance:
      typeof payload.importance === 'number'
        ? asNumber(payload.importance)
        : typeof metadata.importance === 'number'
          ? asNumber(metadata.importance)
          : undefined,
    status:
      asString(payload.status) ||
      asString(metadata.status) ||
      undefined,
    entityKey:
      asString(payload.entity_key) ||
      asString(metadata.entity_key) ||
      undefined,
    supersedesId:
      asString(payload.supersedes_id) ||
      asString(metadata.supersedes_id) ||
      undefined,
    expiresAt:
      asString(payload.expires_at) ||
      asString(metadata.expires_at) ||
      undefined,
    metadata,
  };
}

export async function searchManagementAgentMemories(
  agentId: string,
  query: ManagementAgentMemorySearchQuery = {},
): Promise<{
  query: string;
  limit: number;
  memories: ManagementAgentMemoryItem[];
  supported: boolean;
}> {
  const searchParams = new URLSearchParams();
  if (typeof query.q === 'string' && query.q.trim().length > 0) {
    searchParams.set('q', query.q.trim());
  }
  if (typeof query.limit === 'number' && Number.isFinite(query.limit)) {
    searchParams.set('limit', String(Math.trunc(query.limit)));
  }
  if (typeof query.scope === 'string' && query.scope.trim().length > 0) {
    searchParams.set('scope', query.scope.trim());
  }
  if (typeof query.memoryType === 'string' && query.memoryType.trim().length > 0) {
    searchParams.set('memory_type', query.memoryType.trim());
  }
  if (typeof query.minConfidence === 'number' && Number.isFinite(query.minConfidence)) {
    searchParams.set('min_confidence', String(query.minConfidence));
  }

  const suffix = searchParams.toString();
  let payload: unknown;
  try {
    payload = await requestJson<unknown>(
      `/api/management/agents/${encodeURIComponent(agentId)}/memory/search${suffix ? `?${suffix}` : ''}`,
    );
  } catch (error) {
    if (isSemanticMemoryUnsupportedError(error)) {
      const fallbackLimit =
        typeof query.limit === 'number' && Number.isFinite(query.limit)
          ? Math.max(1, Math.min(100, Math.trunc(query.limit)))
          : 20;
      return {
        query: typeof query.q === 'string' ? query.q.trim() : '',
        limit: fallbackLimit,
        memories: [],
        supported: false,
      };
    }
    throw error;
  }
  const object = isRecord(payload) ? payload : {};
  const rows = Array.isArray(object.memories) ? object.memories : [];
  const memories = rows
    .map(parseManagementMemoryItem)
    .filter((item): item is ManagementAgentMemoryItem => item !== null && item.id.length > 0);
  return {
    query: asString(object.query),
    limit: asNumber(object.limit, memories.length),
    memories,
    supported: typeof object.semantic_memory_supported === 'boolean' ? object.semantic_memory_supported : true,
  };
}

export async function getManagementAgentMemoryItem(
  agentId: string,
  memoryId: string,
): Promise<ManagementAgentMemoryItem> {
  let payload: unknown;
  try {
    payload = await requestJson<unknown>(
      `/api/management/agents/${encodeURIComponent(agentId)}/memory/items/${encodeURIComponent(memoryId)}`,
    );
  } catch (error) {
    if (isSemanticMemoryUnsupportedError(error)) {
      throw semanticMemoryUnsupportedClientError();
    }
    throw error;
  }
  const object = isRecord(payload) ? payload : {};
  const parsed = parseManagementMemoryItem(object.memory);
  if (!parsed || !parsed.id) {
    throw new Error('读取记忆条目失败：返回数据异常');
  }
  return parsed;
}

export type ManagementAgentMemoryFeedbackAction =
  | 'confirm'
  | 'weaken'
  | 'outdated'
  | 'revoke'
  | 'delete'
  | 'reject'
  | 'correct';

export interface ManagementAgentMemoryFeedbackInput {
  memoryId: string;
  action: ManagementAgentMemoryFeedbackAction;
  reason?: string;
  correctedContent?: string;
}

export async function feedbackManagementAgentMemory(
  agentId: string,
  input: ManagementAgentMemoryFeedbackInput,
): Promise<{
  status?: string;
  memoryId?: string;
  action?: string;
  correctedMemoryId?: string;
}> {
  let payload: unknown;
  try {
    payload = await requestJson<unknown>(
      `/api/management/agents/${encodeURIComponent(agentId)}/memory/feedback`,
      {
        method: 'POST',
        body: {
          memory_id: input.memoryId,
          action: input.action,
          reason: input.reason,
          corrected_content: input.correctedContent,
        },
      },
    );
  } catch (error) {
    if (isSemanticMemoryUnsupportedError(error)) {
      throw semanticMemoryUnsupportedClientError();
    }
    throw error;
  }
  const object = isRecord(payload) ? payload : {};
  return {
    status: asString(object.status) || undefined,
    memoryId: asString(object.memory_id) || undefined,
    action: asString(object.action) || undefined,
    correctedMemoryId: asString(object.corrected_memory_id) || undefined,
  };
}

export async function deleteManagementAgentMemoryItem(
  agentId: string,
  memoryId: string,
): Promise<{ status?: string; memoryId?: string }> {
  let payload: unknown;
  try {
    payload = await requestJson<unknown>(
      `/api/management/agents/${encodeURIComponent(agentId)}/memory/items/${encodeURIComponent(memoryId)}`,
      { method: 'DELETE' },
    );
  } catch (error) {
    if (isSemanticMemoryUnsupportedError(error)) {
      throw semanticMemoryUnsupportedClientError();
    }
    throw error;
  }
  const object = isRecord(payload) ? payload : {};
  return {
    status: asString(object.status) || undefined,
    memoryId: asString(object.memory_id) || undefined,
  };
}

export interface AgentConfigPatchInput {
  name?: string;
  english_name?: string;
  nickname?: string;
  description?: string;
  tags?: string[];
  system_prompt?: string;
  collaboration?: {
    discoverable: boolean;
    dispatchEnabled: boolean;
    selectedWorkers: string[];
  };
  channel_binding?: ManagementChannelBinding | null;
  model?: string;
  provider?: string;
  avatar_url?: string;
  portrait_url?: string;
  color?: string;
}

export async function patchManagementAgentConfig(
  agentId: string,
  input: AgentConfigPatchInput,
): Promise<unknown> {
  return requestJson(`/api/management/agents/${encodeURIComponent(agentId)}/config`, {
    method: 'PATCH',
    body: input,
  });
}

export async function updateManagementAgentModel(
  agentId: string,
  input: { provider: string; model: string },
): Promise<{ model?: { provider: string; model: string } }> {
  const payload = await requestJson<unknown>(`/api/management/agents/${encodeURIComponent(agentId)}/model`, {
    method: 'PUT',
    body: input,
  });
  if (!isRecord(payload)) {
    throw new Error('更新智能体模型失败：返回数据异常');
  }
  const model = isRecord(payload.model) ? payload.model : {};
  const provider = asString(model.provider).trim();
  const name = asString(model.model).trim();
  if (provider && name) {
    return { model: { provider, model: name } };
  }
  return {};
}

export interface OptimizePromptInput {
  input: string;
  target?: 'agent_profile' | 'identity_bundle';
  provider?: string;
  model?: string;
  agentId?: string;
}

export interface OptimizePromptResult {
  content: string;
  provider: string;
  model: string;
  target: string;
}

export async function optimizePromptWithDefaultModel(
  input: OptimizePromptInput,
): Promise<OptimizePromptResult> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 35000);
  try {
    return await requestJson<OptimizePromptResult>('/api/management/models/optimize-prompt', {
      method: 'POST',
      body: input,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('智能生成请求超时（35秒），已中止');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export interface AgentAvatarUploadResult {
  avatarUrl: string;
  filename?: string;
  savedPath?: string;
  size?: number;
}

export interface AgentPortraitUploadResult {
  portraitUrl: string;
  filename?: string;
  savedPath?: string;
  size?: number;
}

export interface ManagementPhotoAsset {
  assetId: string;
  agentId?: string;
  ownerScope: string;
  assetFamily: string;
  mediaKind: string;
  sourceTool?: string;
  purpose?: string;
  promptText?: string;
  negativePrompt?: string;
  model?: string;
  mimeType: string;
  sha256: string;
  width?: number;
  height?: number;
  byteSize: number;
  fileName?: string;
  savedPath?: string;
  imageUrl?: string;
  relativePath?: string;
  visionSummary?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ListManagementAgentPhotoLibraryParams {
  ownerScope?: 'self' | 'other' | 'shared' | 'all';
  q?: string;
  limit?: number;
}

export interface ApplyManagementAgentAvatarInput {
  sourceUrl: string;
}

export interface ApplyManagementAgentPortraitInput {
  sourceUrl: string;
}

export interface ApplyManagementAgentAppearanceInput {
  avatarUrl?: string;
  portraitUrl?: string;
}

export interface ApplyManagementAgentAppearanceResult {
  avatarUrl?: string;
  portraitUrl?: string;
  updatedFields: Array<'avatar' | 'portrait'>;
}

export interface AgentChatAssetUploadResult {
  assetUrl: string;
  filename: string;
  relativePath: string;
  savedPath?: string;
  kind: 'image' | 'file';
  mimeType?: string;
  size?: number;
  upstreamFileId?: string;
  sha256?: string;
  // 历史字段名，当前实际承载的是“本地视觉结果文本”。
  localVisionSummary?: string;
  localVisionProvider?: string;
  localVisionModel?: string;
}

const VISION_IMAGE_MAX_EDGE = 1568;
const VISION_IMAGE_REENCODE_MIN_BYTES = 900 * 1024;
const VISION_IMAGE_QUALITY = 0.82;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function buildOptimizedImageName(fileName: string, mimeType: string): string {
  const safeBase = fileName.replace(/\.[^.]+$/, '') || 'upload';
  if (mimeType === 'image/webp') {
    return `${safeBase}.webp`;
  }
  if (mimeType === 'image/jpeg') {
    return `${safeBase}.jpg`;
  }
  if (mimeType === 'image/png') {
    return `${safeBase}.png`;
  }
  return fileName || 'upload';
}

async function loadImageElement(file: File): Promise<{ image: HTMLImageElement; dispose: () => void }> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = objectUrl;
  });
  return {
    image,
    dispose: () => URL.revokeObjectURL(objectUrl),
  };
}

async function optimizeChatImageForVision(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }
  if (typeof document === 'undefined') {
    return file;
  }

  let width = 0;
  let height = 0;
  let drawToCanvas: ((ctx: CanvasRenderingContext2D, targetWidth: number, targetHeight: number) => void) | null = null;
  let dispose: (() => void) | null = null;

  try {
    if (typeof createImageBitmap === 'function' && file.type !== 'image/svg+xml') {
      const bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      drawToCanvas = (ctx, targetWidth, targetHeight) => {
        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      };
      dispose = () => bitmap.close();
    } else {
      const loaded = await loadImageElement(file);
      const image = loaded.image;
      width = image.naturalWidth || image.width;
      height = image.naturalHeight || image.height;
      drawToCanvas = (ctx, targetWidth, targetHeight) => {
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
      };
      dispose = loaded.dispose;
    }

    if (!drawToCanvas || width <= 0 || height <= 0) {
      return file;
    }

    const maxEdge = Math.max(width, height);
    const needsResize = maxEdge > VISION_IMAGE_MAX_EDGE;
    const needsReencode = file.size > VISION_IMAGE_REENCODE_MIN_BYTES;
    if (!needsResize && !needsReencode) {
      return file;
    }

    const scale = needsResize ? VISION_IMAGE_MAX_EDGE / maxEdge : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawToCanvas(ctx, targetWidth, targetHeight);

    const mimeCandidates = file.type === 'image/png'
      ? ['image/webp', 'image/png']
      : ['image/webp', 'image/jpeg'];

    let blob: Blob | null = null;
    let usedMimeType = file.type;
    for (const mimeType of mimeCandidates) {
      const nextBlob = await canvasToBlob(
        canvas,
        mimeType,
        mimeType === 'image/png' ? undefined : VISION_IMAGE_QUALITY,
      );
      if (nextBlob && nextBlob.size > 0) {
        blob = nextBlob;
        usedMimeType = nextBlob.type || mimeType;
        break;
      }
    }

    if (!blob) {
      return file;
    }
    if (!needsResize && blob.size >= file.size * 0.95) {
      return file;
    }

    return new File(
      [blob],
      buildOptimizedImageName(file.name || 'upload', usedMimeType),
      {
        type: usedMimeType,
        lastModified: Date.now(),
      },
    );
  } catch {
    return file;
  } finally {
    dispose?.();
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isFailedToFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = error.message.toLowerCase();
  return text.includes('failed to fetch') || text.includes('fetch failed') || text.includes('networkerror');
}

function toUploadFriendlyError(error: unknown): Error {
  if (isFailedToFetchError(error)) {
    return new Error('无法连接本地管理服务（上传链路中断）。请稍后重试；若持续失败请重启应用。');
  }
  return error instanceof Error ? error : new Error('上传失败');
}

function shouldRetryAppearanceInlineUpload(
  error: unknown,
  kind: 'avatar' | 'portrait',
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  if (message.includes('HTTP 404')) {
    return true;
  }
  if (!message.includes('HTTP 400')) {
    return false;
  }
  return kind === 'avatar'
    ? message.includes('不支持的头像格式')
    : message.includes('不支持的立绘格式');
}

async function postMultipartJson(
  path: string,
  formData: FormData,
): Promise<unknown> {
  const attempt = async (baseUrl: string): Promise<unknown> => {
    const url = buildApiUrl(baseUrl, path);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: formData,
    });

    const text = await response.text();
    if (!response.ok) {
      throw parseHttpError(response.status, text);
    }
    if (!text.trim()) {
      throw new Error('上传返回为空');
    }
    return JSON.parse(text) as unknown;
  };

  const firstBase = await getApiBaseUrl();
  try {
    return await attempt(firstBase);
  } catch (error) {
    if (!isFailedToFetchError(error)) {
      throw error;
    }
    const secondBase = await getApiBaseUrl({ forceRefresh: true });
    try {
      return await attempt(secondBase);
    } catch (secondError) {
      throw toUploadFriendlyError(secondError);
    }
  }
}

function parseAgentAvatarUploadResult(
  payload: unknown,
  baseUrl?: string,
): AgentAvatarUploadResult {
  if (!isRecord(payload)) {
    throw new Error('头像上传返回异常');
  }
  const avatarRaw = asString(payload.avatar_url).trim();
  const avatarUrl = baseUrl
    ? normalizeManagementAssetUrl(avatarRaw, baseUrl) || avatarRaw
    : avatarRaw;
  if (!avatarUrl) {
    throw new Error('头像上传成功但未返回 avatar_url');
  }
  return {
    avatarUrl,
    filename: asString(payload.filename) || undefined,
    savedPath: asString(payload.saved_path) || undefined,
    size: typeof payload.size === 'number' ? payload.size : undefined,
  };
}

function parseAgentPortraitUploadResult(
  payload: unknown,
  baseUrl?: string,
): AgentPortraitUploadResult {
  if (!isRecord(payload)) {
    throw new Error('立绘上传返回异常');
  }
  const portraitRaw = asString(payload.portrait_url).trim();
  const portraitUrl = baseUrl
    ? normalizeManagementAssetUrl(portraitRaw, baseUrl) || portraitRaw
    : portraitRaw;
  if (!portraitUrl) {
    throw new Error('立绘上传成功但未返回 portrait_url');
  }
  return {
    portraitUrl,
    filename: asString(payload.filename) || undefined,
    savedPath: asString(payload.saved_path) || undefined,
    size: typeof payload.size === 'number' ? payload.size : undefined,
  };
}

function parseManagementPhotoAsset(payload: unknown, baseUrl?: string): ManagementPhotoAsset {
  if (!isRecord(payload)) {
    throw new Error('照片库返回异常');
  }
  const imageRaw = asString(payload.image_url).trim();
  const imageUrl = baseUrl
    ? normalizeManagementAssetUrl(imageRaw, baseUrl) || imageRaw || undefined
    : imageRaw || undefined;
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  return {
    assetId: asString(payload.asset_id),
    agentId: asString(payload.agent_id) || undefined,
    ownerScope: asString(payload.owner_scope, 'other'),
    assetFamily: asString(payload.asset_family, 'photo'),
    mediaKind: asString(payload.media_kind, 'image'),
    sourceTool: asString(payload.source_tool) || undefined,
    purpose: asString(payload.purpose) || undefined,
    promptText: asString(payload.prompt_text) || undefined,
    negativePrompt: asString(payload.negative_prompt) || undefined,
    model: asString(payload.model) || undefined,
    mimeType: asString(payload.mime_type, 'image/png'),
    sha256: asString(payload.sha256),
    width: typeof payload.width === 'number' ? payload.width : undefined,
    height: typeof payload.height === 'number' ? payload.height : undefined,
    byteSize: asNumber(payload.byte_size),
    fileName: asString(payload.file_name) || undefined,
    savedPath: asString(payload.saved_path) || undefined,
    imageUrl,
    relativePath: asString(payload.relative_path) || undefined,
    visionSummary: asString(payload.vision_summary) || undefined,
    tags: asStringArray(payload.tags),
    metadata,
    createdAt: asString(payload.created_at),
    updatedAt: asString(payload.updated_at),
  };
}

export async function listManagementAgentPhotoLibrary(
  agentId: string,
  params: ListManagementAgentPhotoLibraryParams = {},
): Promise<ManagementPhotoAsset[]> {
  const baseUrl = await getApiBaseUrl();
  const query = new URLSearchParams();
  if (params.ownerScope) {
    query.set('ownerScope', params.ownerScope);
  }
  if (params.q?.trim()) {
    query.set('q', params.q.trim());
  }
  if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
    query.set('limit', String(Math.max(1, Math.min(500, Math.floor(params.limit)))));
  }
  const suffix = query.toString();
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/photo-library${suffix ? `?${suffix}` : ''}`,
  );
  const rows = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
  return rows.map((item) => parseManagementPhotoAsset(item, baseUrl));
}

const LOCAL_MANAGEMENT_ASSET_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/api\/management\/agents\/.+)$/i;

function isManagedAppearanceAssetForAgent(agentId: string, rawUrl: string): boolean {
  const normalizedAgentId = encodeURIComponent(agentId);
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith(`/api/management/agents/${normalizedAgentId}/`)) {
    return true;
  }
  const localMatch = trimmed.match(LOCAL_MANAGEMENT_ASSET_PATTERN);
  return Boolean(localMatch?.[1]?.startsWith(`/api/management/agents/${normalizedAgentId}/`));
}

function inferManagedAppearanceFilename(
  rawUrl: string,
  fallbackBaseName: 'avatar' | 'portrait',
  mimeType: string,
): string {
  const cleaned = rawUrl.split('#')[0]?.split('?')[0] ?? '';
  const lastSegment = cleaned.split('/').filter(Boolean).pop() ?? '';
  if (lastSegment && /\.[a-z0-9]+$/i.test(lastSegment)) {
    return lastSegment;
  }
  const extension = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('jpeg') || mimeType.includes('jpg')
      ? 'jpg'
      : mimeType.includes('webp')
        ? 'webp'
        : 'bin';
  return `${fallbackBaseName}.${extension}`;
}

async function materializeManagedAppearanceAsset(
  agentId: string,
  rawUrl: string,
  kind: 'avatar' | 'portrait',
): Promise<string> {
  const source = rawUrl.trim();
  if (!source) {
    throw new Error(`缺少${kind === 'avatar' ? '头像' : '立绘'}来源 URL`);
  }
  if (isManagedAppearanceAssetForAgent(agentId, source)) {
    return source;
  }

  const resolvedSource = await (async (): Promise<string> => {
    if (/^(?:https?:|data:|blob:|file:)/i.test(source)) {
      return source;
    }
    if (/^\/?api\/uploads\//i.test(source)) {
      const baseUrl = await getOpenFangBaseUrl();
      return new URL(source.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`).toString();
    }
    if (source.startsWith('/')) {
      const baseUrl = await getApiBaseUrl();
      return new URL(source, `${baseUrl.replace(/\/+$/, '')}/`).toString();
    }
    return source;
  })();

  const response = await fetch(resolvedSource);
  if (!response.ok) {
    throw new Error(`下载${kind === 'avatar' ? '头像' : '立绘'}失败：HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const responseContentType = response.headers.get('content-type')?.trim() ?? '';
  const contentType = blob.type || responseContentType || 'image/png';
  const file = new File(
    [blob],
    inferManagedAppearanceFilename(source, kind, contentType),
    { type: contentType },
  );

  if (kind === 'avatar') {
    const uploaded = await uploadManagementAgentAvatar(agentId, file);
    return uploaded.avatarUrl;
  }
  const uploaded = await uploadManagementAgentPortrait(agentId, file);
  return uploaded.portraitUrl;
}

function parseAgentChatAssetUploadResult(
  payload: unknown,
  baseUrl?: string,
): AgentChatAssetUploadResult {
  if (!isRecord(payload)) {
    throw new Error('聊天附件上传返回异常');
  }
  const assetRaw = asString(payload.asset_url).trim();
  const assetUrl = baseUrl
    ? normalizeManagementAssetUrl(assetRaw, baseUrl) || assetRaw
    : assetRaw;
  const filename = asString(payload.filename).trim();
  const relativePath = asString(payload.relative_path).trim();
  const kind = asString(payload.kind).trim().toLowerCase() === 'image' ? 'image' : 'file';
  if (!assetUrl || !filename || !relativePath) {
    throw new Error('聊天附件上传成功但返回字段不完整');
  }
  return {
    assetUrl,
    filename,
    relativePath,
    savedPath: asString(payload.saved_path) || undefined,
    kind,
    mimeType: asString(payload.mime_type) || undefined,
    size: typeof payload.size === 'number' ? payload.size : undefined,
    upstreamFileId: asString(payload.upstream_file_id) || undefined,
    sha256: asString(payload.sha256) || undefined,
  };
}

export async function importManagementAgentAvatar(
  agentId: string,
  sourcePath: string,
): Promise<AgentAvatarUploadResult> {
  const baseUrl = await getApiBaseUrl();
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/avatar/import`,
    {
      method: 'POST',
      body: {
        source_path: sourcePath,
      },
    },
  );
  return parseAgentAvatarUploadResult(payload, baseUrl);
}

export async function uploadManagementAgentAvatar(
  agentId: string,
  file: File,
): Promise<AgentAvatarUploadResult> {
  let payload: unknown;
  try {
    const contentBase64 = await fileToBase64(file);
    payload = await requestJson<unknown>(`/api/management/agents/${encodeURIComponent(agentId)}/avatar/upload-inline`, {
      method: 'POST',
      body: {
        filename: file.name || 'avatar',
        content_base64: contentBase64,
        content_type: file.type || undefined,
      },
    });
  } catch (inlineError) {
    if (!shouldRetryAppearanceInlineUpload(inlineError, 'avatar')) {
      throw toUploadFriendlyError(inlineError);
    }
    const formData = new FormData();
    formData.append('file', file, file.name || 'avatar');
    payload = await postMultipartJson(
      `/api/management/agents/${encodeURIComponent(agentId)}/avatar/upload`,
      formData,
    );
  }
  const baseUrl = await getApiBaseUrl({ forceRefresh: true });
  return parseAgentAvatarUploadResult(payload, baseUrl);
}

export async function importManagementAgentPortrait(
  agentId: string,
  sourcePath: string,
): Promise<AgentPortraitUploadResult> {
  const baseUrl = await getApiBaseUrl();
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/portrait/import`,
    {
      method: 'POST',
      body: {
        source_path: sourcePath,
      },
    },
  );
  return parseAgentPortraitUploadResult(payload, baseUrl);
}

export async function uploadManagementAgentPortrait(
  agentId: string,
  file: File,
): Promise<AgentPortraitUploadResult> {
  let payload: unknown;
  try {
    const contentBase64 = await fileToBase64(file);
    payload = await requestJson<unknown>(`/api/management/agents/${encodeURIComponent(agentId)}/portrait/upload-inline`, {
      method: 'POST',
      body: {
        filename: file.name || 'portrait',
        content_base64: contentBase64,
        content_type: file.type || undefined,
      },
    });
  } catch (inlineError) {
    if (!shouldRetryAppearanceInlineUpload(inlineError, 'portrait')) {
      throw toUploadFriendlyError(inlineError);
    }
    const formData = new FormData();
    formData.append('file', file, file.name || 'portrait');
    payload = await postMultipartJson(
      `/api/management/agents/${encodeURIComponent(agentId)}/portrait/upload`,
      formData,
    );
  }
  const baseUrl = await getApiBaseUrl({ forceRefresh: true });
  return parseAgentPortraitUploadResult(payload, baseUrl);
}

export async function applyManagementAgentAvatarFromUrl(
  agentId: string,
  input: ApplyManagementAgentAvatarInput,
): Promise<AgentAvatarUploadResult> {
  const avatarUrl = await materializeManagedAppearanceAsset(agentId, input.sourceUrl, 'avatar');
  await patchManagementAgentConfig(agentId, {
    avatar_url: avatarUrl,
  });
  return { avatarUrl };
}

export async function applyManagementAgentPortraitFromUrl(
  agentId: string,
  input: ApplyManagementAgentPortraitInput,
): Promise<AgentPortraitUploadResult> {
  const portraitUrl = await materializeManagedAppearanceAsset(agentId, input.sourceUrl, 'portrait');
  await patchManagementAgentConfig(agentId, {
    portrait_url: portraitUrl,
  });
  return { portraitUrl };
}

export async function applyManagementAgentAppearance(
  agentId: string,
  input: ApplyManagementAgentAppearanceInput,
): Promise<ApplyManagementAgentAppearanceResult> {
  const avatarSource = asString(input.avatarUrl).trim();
  const portraitSource = asString(input.portraitUrl).trim();
  if (!avatarSource && !portraitSource) {
    throw new Error('至少需要提供 avatarUrl 或 portraitUrl');
  }

  const [avatarUrl, portraitUrl] = await Promise.all([
    avatarSource ? materializeManagedAppearanceAsset(agentId, avatarSource, 'avatar') : Promise.resolve(undefined),
    portraitSource ? materializeManagedAppearanceAsset(agentId, portraitSource, 'portrait') : Promise.resolve(undefined),
  ]);

  const patch: AgentConfigPatchInput = {};
  const updatedFields: Array<'avatar' | 'portrait'> = [];
  if (avatarUrl) {
    patch.avatar_url = avatarUrl;
    updatedFields.push('avatar');
  }
  if (portraitUrl) {
    patch.portrait_url = portraitUrl;
    updatedFields.push('portrait');
  }
  await patchManagementAgentConfig(agentId, patch);

  return {
    avatarUrl,
    portraitUrl,
    updatedFields,
  };
}

export async function uploadManagementAgentChatAsset(
  agentId: string,
  file: File,
): Promise<AgentChatAssetUploadResult> {
  const uploadFile = await optimizeChatImageForVision(file);
  let payload: unknown;
  try {
    const contentBase64 = await fileToBase64(uploadFile);
    payload = await requestJson<unknown>(`/api/management/agents/${encodeURIComponent(agentId)}/chat-assets/upload-inline`, {
      method: 'POST',
      body: {
        filename: uploadFile.name || file.name || 'upload.bin',
        content_base64: contentBase64,
      },
    });
  } catch (inlineError) {
    const message = inlineError instanceof Error ? inlineError.message : '';
    if (!message.includes('HTTP 404')) {
      throw toUploadFriendlyError(inlineError);
    }
    const formData = new FormData();
    formData.append('file', uploadFile, uploadFile.name || file.name || 'upload.bin');
    payload = await postMultipartJson(
      `/api/management/agents/${encodeURIComponent(agentId)}/chat-assets/upload`,
      formData,
    );
  }
  const baseUrl = await getApiBaseUrl({ forceRefresh: true });
  return parseAgentChatAssetUploadResult(payload, baseUrl);
}

export interface AgentAssignmentInfo {
  assigned: string[];
  available: string[];
  mode: 'all' | 'allowlist' | string;
  runtime_available?: string[];
  custom_available?: string[];
  component_available?: string[];
  builtin_available?: string[];
}

export async function getAgentSkillAssignments(agentId: string): Promise<AgentAssignmentInfo> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/skills`,
  );
  if (!isRecord(payload)) {
    return { assigned: [], available: [], mode: 'all' };
  }
  return {
    assigned: asStringArray(payload.assigned),
    available: asStringArray(payload.available),
    mode: asString(payload.mode, 'all'),
    runtime_available: asStringArray(payload.runtime_available),
    custom_available: asStringArray(payload.custom_available),
    component_available: asStringArray(payload.component_available),
    builtin_available: asStringArray(payload.builtin_available),
  };
}

export async function getAgentMcpAssignments(agentId: string): Promise<AgentAssignmentInfo> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/mcp_servers`,
  );
  if (!isRecord(payload)) {
    return { assigned: [], available: [], mode: 'all' };
  }
  return {
    assigned: asStringArray(payload.assigned),
    available: asStringArray(payload.available),
    mode: asString(payload.mode, 'all'),
    runtime_available: asStringArray(payload.runtime_available),
    custom_available: asStringArray(payload.custom_available),
    builtin_available: asStringArray(payload.builtin_available),
  };
}

export async function toggleAgentSkill(
  agentId: string,
  skill: string,
  enabled: boolean,
): Promise<string[]> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/assignments/skill`,
    {
      method: 'PUT',
      body: { skill, enabled },
    },
  );
  if (!isRecord(payload) || !isRecord(payload.desired)) {
    return [];
  }
  return asStringArray(payload.desired.skills);
}

export async function toggleAgentMcpServer(
  agentId: string,
  mcpServer: string,
  enabled: boolean,
): Promise<string[]> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/assignments/mcp_server`,
    {
      method: 'PUT',
      body: { mcp_server: mcpServer, enabled },
    },
  );
  if (!isRecord(payload) || !isRecord(payload.desired)) {
    return [];
  }
  return asStringArray(payload.desired.mcp_servers);
}

export async function setAgentSkillAssignments(
  agentId: string,
  skills: string[],
): Promise<string[]> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/skills`,
    {
      method: 'PUT',
      body: {
        mode: 'allowlist',
        assigned: skills,
      },
    },
  );
  if (!isRecord(payload) || !isRecord(payload.desired)) {
    return [];
  }
  return asStringArray(payload.desired.skills);
}

export async function setAgentMcpAssignments(
  agentId: string,
  mcpServers: string[],
): Promise<string[]> {
  const payload = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}/mcp_servers`,
    {
      method: 'PUT',
      body: {
        mode: 'allowlist',
        assigned: mcpServers,
      },
    },
  );
  if (!isRecord(payload) || !isRecord(payload.desired)) {
    return [];
  }
  return asStringArray(payload.desired.mcp_servers);
}

export interface GlobalImportedSkill {
  name: string;
  source_path: string;
  installed_path: string;
  description?: string;
  updated_at: string;
}

export interface GlobalSkillListItem {
  id: string;
  name: string;
  folderName?: string;
  description?: string;
  path: string;
  sourceType: string;
  category: GlobalSkillCategory;
  isSystem: boolean;
  isImported: boolean;
  canDelete: boolean;
}

export type GlobalSkillCategory = 'system_ui' | 'builtin' | 'component' | 'custom';

function normalizeGlobalSkillCategory(row: JsonRecord): GlobalSkillCategory {
  const category = asString(row.category).trim().toLowerCase();
  if (
    category === 'system_ui' ||
    category === 'builtin' ||
    category === 'component' ||
    category === 'custom'
  ) {
    return category;
  }

  const sourceType = asString(row.sourceType).trim().toLowerCase();
  const isSystem = Boolean(row.isSystem) || sourceType === 'ui';
  if (isSystem) {
    return 'system_ui';
  }
  if (sourceType === 'bundled' || sourceType === 'builtin' || sourceType === 'system') {
    return 'builtin';
  }

  const canDelete =
    typeof row.canDelete === 'boolean' ? row.canDelete : !Boolean(row.isSystem);
  if (!canDelete) {
    return 'component';
  }
  return 'custom';
}

export interface GlobalSkillsPayload {
  storage: {
    dbPath: string;
    skillsRoot: string;
  };
  descriptions: Record<string, string>;
  items: GlobalSkillListItem[];
  imported: GlobalImportedSkill[];
  localFolders: string[];
  runtime: {
    skills: Array<{
      name?: string;
      description?: string;
      source?: { type?: string };
    }>;
    total?: number;
  };
}

export async function getGlobalSkills(): Promise<GlobalSkillsPayload> {
  const payload = await requestJson<unknown>('/api/management/global/skills');
  if (!isRecord(payload)) {
    return {
      storage: { dbPath: '', skillsRoot: '' },
      descriptions: {},
      items: [],
      imported: [],
      localFolders: [],
      runtime: { skills: [], total: 0 },
    };
  }
  const storage = isRecord(payload.storage) ? payload.storage : {};
  const runtime = isRecord(payload.runtime) ? payload.runtime : {};
  const imported = Array.isArray(payload.imported)
    ? payload.imported.filter(isRecord).map((row) => ({
      name: asString(row.name),
      source_path: asString(row.source_path),
      installed_path: asString(row.installed_path),
      description: asString(row.description) || undefined,
      updated_at: asString(row.updated_at),
    }))
    : [];
  const descriptions = isRecord(payload.descriptions)
    ? Object.fromEntries(
      Object.entries(payload.descriptions)
        .filter(([key, value]) => key.trim().length > 0 && typeof value === 'string')
        .map(([key, value]) => [key, value as string]),
    )
    : {};
  const items = Array.isArray(payload.items)
    ? payload.items
      .filter(isRecord)
      .map((row) => ({
        id: asString(row.id),
        name: asString(row.name),
        folderName: asString(row.folderName) || undefined,
        description: asString(row.description) || undefined,
        path: asString(row.path),
        sourceType: asString(row.sourceType),
        category: normalizeGlobalSkillCategory(row),
        isSystem: Boolean(row.isSystem),
        isImported: Boolean(row.isImported),
        canDelete: typeof row.canDelete === 'boolean' ? row.canDelete : !Boolean(row.isSystem),
      }))
      .filter((row) => row.id.trim().length > 0 && row.name.trim().length > 0)
    : [];
  const runtimeSkills = Array.isArray(runtime.skills)
    ? runtime.skills
      .filter(isRecord)
      .map((row) => ({
        name: asString(row.name) || undefined,
        description: asString(row.description) || undefined,
        source: isRecord(row.source) ? { type: asString(row.source.type) || undefined } : undefined,
      }))
    : [];

  return {
    storage: {
      dbPath: asString(storage.dbPath),
      skillsRoot: asString(storage.skillsRoot),
    },
    descriptions,
    items,
    imported,
    localFolders: asStringArray(payload.localFolders),
    runtime: {
      skills: runtimeSkills,
      total: typeof runtime.total === 'number' ? runtime.total : runtimeSkills.length,
    },
  };
}

export async function importGlobalSkill(sourcePath: string, overwrite = true): Promise<unknown> {
  return requestJson('/api/management/global/skills/import', {
    method: 'POST',
    body: {
      source_path: sourcePath,
      overwrite,
    },
  });
}

function buildApiUrl(baseUrl: string, path: string): string {
  if (!path.startsWith('/')) {
    return `${baseUrl}/${path}`;
  }
  return `${baseUrl}${path}`;
}

function parseHttpError(status: number, bodyText: string): Error {
  const raw = bodyText.trim();
  const lower = raw.toLowerCase();
  if (status === 404 && (lower.startsWith('<!doctype html') || lower.startsWith('<html'))) {
    return new Error(
      '管理接口不存在（404）。当前连接的后端可能不是最新版 webot-service-rs，请重启服务后重试。',
    );
  }
  if (!raw) {
    return new Error(`HTTP ${status}`);
  }
  try {
    const parsed = JSON.parse(raw) as JsonRecord;
    const message = parsed.message ?? parsed.error;
    if (typeof message === 'string' && message.trim().length > 0) {
      return new Error(`HTTP ${status}: ${message}`);
    }
  } catch {
    // ignore
  }
  return new Error(`HTTP ${status}: ${raw}`);
}

async function ensureManagementApiReady(baseUrl: string): Promise<void> {
  const url = buildApiUrl(baseUrl, '/api/health');
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`无法连接管理后端（${resp.status}）`);
  }
  const text = await resp.text();
  if (!text.trim()) {
    throw new Error('管理后端健康检查返回为空');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('管理后端健康检查返回非 JSON，请确认 API 地址');
  }
  if (!isRecord(payload) || asString(payload.service) !== 'webot-service-rs') {
    throw new Error('当前连接的不是 webot-service-rs 管理服务，请检查 API 地址配置');
  }
}

export async function importGlobalSkillArchive(
  file: File,
  options?: { overwrite?: boolean; name?: string },
): Promise<unknown> {
  const baseUrl = await getApiBaseUrl();
  await ensureManagementApiReady(baseUrl);
  const query = new URLSearchParams();
  if (options?.name && options.name.trim().length > 0) {
    query.set('name', options.name.trim());
  }
  query.set('overwrite', String(options?.overwrite ?? true));
  query.set('filename', file.name || 'skill.zip');
  const url = buildApiUrl(
    baseUrl,
    `/api/management/global/skills/import/upload?${query.toString()}`,
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': file.type || 'application/zip',
    },
    body: file,
  });

  const text = await response.text();
  if (!response.ok) {
    throw parseHttpError(response.status, text);
  }
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text) as unknown;
}

export async function importGlobalSkillFolder(
  files: File[],
  options?: { overwrite?: boolean; name?: string },
): Promise<unknown> {
  if (files.length === 0) {
    throw new Error('未选择任何文件');
  }

  const baseUrl = await getApiBaseUrl();
  await ensureManagementApiReady(baseUrl);
  const url = buildApiUrl(baseUrl, '/api/management/global/skills/import/files');
  const formData = new FormData();
  for (const file of files) {
    const withRelativePath = file as File & { webkitRelativePath?: string };
    const relName =
      (withRelativePath.webkitRelativePath && withRelativePath.webkitRelativePath.trim()) ||
      file.name;
    formData.append('files', file, relName.replace(/\\/g, '/'));
  }
  formData.append('overwrite', String(options?.overwrite ?? true));
  if (options?.name && options.name.trim().length > 0) {
    formData.append('name', options.name.trim());
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  });
  const text = await response.text();
  if (!response.ok) {
    throw parseHttpError(response.status, text);
  }
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text) as unknown;
}

export async function deleteGlobalSkill(name: string): Promise<unknown> {
  return requestJson(`/api/management/global/skills/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

export interface McpServerSummary {
  name: string;
  transport?: {
    type?: string;
    command?: string;
    args?: string[];
    url?: string;
  };
  timeout_secs?: number;
}

export async function getManagementMcpServers(): Promise<{
  configured: McpServerSummary[];
  connected: McpServerSummary[];
}> {
  const payload = await requestJson<unknown>('/api/management/mcp/servers');
  if (!isRecord(payload)) {
    return { configured: [], connected: [] };
  }
  const mapRows = (rows: unknown): McpServerSummary[] =>
    Array.isArray(rows)
      ? rows
        .filter(isRecord)
        .map((row) => ({
          name: asString(row.name),
          transport: isRecord(row.transport)
            ? {
              type: asString(row.transport.type) || undefined,
              command: asString(row.transport.command) || undefined,
              args: asStringArray(row.transport.args),
              url: asString(row.transport.url) || undefined,
            }
            : undefined,
          timeout_secs: typeof row.timeout_secs === 'number' ? row.timeout_secs : undefined,
        }))
      : [];
  return {
    configured: mapRows(payload.configured),
    connected: mapRows(payload.connected),
  };
}

export interface GlobalMcpConfigPayload {
  config: unknown;
}

export async function getGlobalMcpConfig(): Promise<GlobalMcpConfigPayload> {
  const payload = await requestJson<unknown>('/api/management/global/mcp/config');
  if (!isRecord(payload) || payload.config === null || payload.config === undefined) {
    return { config: null };
  }
  if (isRecord(payload.config) && 'config' in payload.config) {
    return { config: (payload.config as JsonRecord).config ?? null };
  }
  return { config: payload.config };
}

export async function setGlobalMcpConfig(config: unknown): Promise<unknown> {
  return requestJson('/api/management/global/mcp/config', {
    method: 'PUT',
    body: config ?? {},
  });
}

export async function clearGlobalMcpConfig(): Promise<unknown> {
  return requestJson('/api/management/global/mcp/config', {
    method: 'DELETE',
  });
}

export interface MemoryEnhancementModelConfig {
  provider: string;
  api_base: string;
  api_key: string;
  model: string;
  dimension?: number;
}

export interface MemoryEnhancementConfig {
  enabled: boolean;
  mode: string;
  base_url: string;
  api_key: string;
  agent_id: string;
  timeout_ms: number;
  target_uri: string;
  recall_limit: number;
  recall_score_threshold: number;
  auto_recall: boolean;
  auto_capture: boolean;
  embedding: MemoryEnhancementModelConfig;
  llm: MemoryEnhancementModelConfig;
}

export interface ManagementMemoryEnhancementPayload {
  config: MemoryEnhancementConfig;
  configured?: boolean;
  source?: string;
}

function createDefaultMemoryEnhancementConfig(): MemoryEnhancementConfig {
  return {
    enabled: false,
    mode: 'remote',
    base_url: '',
    api_key: '',
    agent_id: '',
    timeout_ms: 60000,
    target_uri: 'viking://user/memories',
    recall_limit: 8,
    recall_score_threshold: 0.45,
    auto_recall: true,
    auto_capture: true,
    embedding: {
      provider: 'openai',
      api_base: '',
      api_key: '',
      model: '',
      dimension: 1536,
    },
    llm: {
      provider: 'openai',
      api_base: '',
      api_key: '',
      model: '',
    },
  };
}

function normalizeMemoryEnhancementModelConfig(
  value: unknown,
  fallback: MemoryEnhancementModelConfig,
  withDimension: boolean,
): MemoryEnhancementModelConfig {
  const defaultDimension =
    typeof fallback.dimension === 'number' && Number.isFinite(fallback.dimension)
      ? fallback.dimension
      : 1536;
  if (!isRecord(value)) {
    return withDimension ? { ...fallback, dimension: defaultDimension } : { ...fallback };
  }
  const output: MemoryEnhancementModelConfig = {
    provider: asString(value.provider, fallback.provider),
    api_base: asString(value.api_base, fallback.api_base),
    api_key: asString(value.api_key, fallback.api_key),
    model: asString(value.model, fallback.model),
  };
  if (withDimension) {
    const current = asNumber(value.dimension, defaultDimension);
    output.dimension = current > 0 ? current : defaultDimension;
  }
  return output;
}

function normalizeMemoryEnhancementConfig(value: unknown): MemoryEnhancementConfig {
  const defaults = createDefaultMemoryEnhancementConfig();
  if (!isRecord(value)) {
    return defaults;
  }
  const timeoutMs = asNumber(value.timeout_ms, defaults.timeout_ms);
  const recallLimit = asNumber(value.recall_limit, defaults.recall_limit);
  const recallScore = asNumber(value.recall_score_threshold, defaults.recall_score_threshold);
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled,
    mode: asString(value.mode, defaults.mode),
    base_url: asString(value.base_url, defaults.base_url),
    api_key: asString(value.api_key, defaults.api_key),
    agent_id: asString(value.agent_id, defaults.agent_id),
    timeout_ms: timeoutMs > 0 ? timeoutMs : defaults.timeout_ms,
    target_uri: asString(value.target_uri, defaults.target_uri),
    recall_limit: recallLimit > 0 ? recallLimit : defaults.recall_limit,
    recall_score_threshold:
      recallScore >= 0 && recallScore <= 1 ? recallScore : defaults.recall_score_threshold,
    auto_recall: typeof value.auto_recall === 'boolean' ? value.auto_recall : defaults.auto_recall,
    auto_capture:
      typeof value.auto_capture === 'boolean' ? value.auto_capture : defaults.auto_capture,
    embedding: normalizeMemoryEnhancementModelConfig(
      value.embedding,
      defaults.embedding,
      true,
    ),
    llm: normalizeMemoryEnhancementModelConfig(value.llm, defaults.llm, false),
  };
}

export async function getManagementMemoryEnhancementConfig(): Promise<ManagementMemoryEnhancementPayload> {
  const payload = await requestJson<unknown>('/api/management/memory-enhancement');
  if (!isRecord(payload)) {
    return { config: createDefaultMemoryEnhancementConfig() };
  }
  let configValue: unknown = payload.config;
  if (isRecord(configValue) && 'config' in configValue) {
    configValue = (configValue as JsonRecord).config;
  }
  return {
    config: normalizeMemoryEnhancementConfig(configValue),
    configured: typeof payload.configured === 'boolean' ? payload.configured : undefined,
    source: asString(payload.source) || undefined,
  };
}

export async function setManagementMemoryEnhancementConfig(
  config: MemoryEnhancementConfig,
): Promise<ManagementMemoryEnhancementPayload> {
  const payload = await requestJson<unknown>('/api/management/memory-enhancement', {
    method: 'PUT',
    body: config,
  });
  if (!isRecord(payload)) {
    return { config: normalizeMemoryEnhancementConfig(config) };
  }
  return {
    config: normalizeMemoryEnhancementConfig(payload.config ?? config),
    configured: true,
    source: 'stored',
  };
}
