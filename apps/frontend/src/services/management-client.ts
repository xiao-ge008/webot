import { saveOfficeBinaryAs } from '@/services/office-file-client';
import { getApiBaseUrl, requestJson } from '@/services/transport';

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
  source?: string;
}

export async function listManagementModels(): Promise<ManagementModelOption[]> {
  const payload = await requestJson<unknown>('/api/management/models');
  const rows = isRecord(payload) && Array.isArray(payload.models) ? payload.models : [];
  const defaultModelId = isRecord(payload) ? asString(payload.default_model_id) : '';

  return rows
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
        source: asString(row.source) || undefined,
      };
    })
    .filter((item) => item.modelId.length > 0);
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
  source?: string;
  protocol?: string;
  isCustom?: boolean;
}

export async function listManagementProviders(): Promise<ManagementProviderOption[]> {
  const payload = await requestJson<unknown>('/api/management/providers');
  const rows = isRecord(payload) && Array.isArray(payload.providers) ? payload.providers : [];
  return rows
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
      source: asString(row.source) || undefined,
      protocol: asString(row.protocol) || undefined,
      isCustom: typeof row.is_custom === 'boolean' ? row.is_custom : undefined,
    }))
    .filter((item) => item.providerId.length > 0);
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
): Promise<unknown> {
  return requestJson(`/api/management/agents/${encodeURIComponent(agentId)}/model`, {
    method: 'PUT',
    body: input,
  });
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
      },
    });
  } catch (inlineError) {
    const message = inlineError instanceof Error ? inlineError.message : '';
    if (!message.includes('HTTP 404')) {
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
      },
    });
  } catch (inlineError) {
    const message = inlineError instanceof Error ? inlineError.message : '';
    if (!message.includes('HTTP 404')) {
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

export interface AgentAssignmentInfo {
  assigned: string[];
  available: string[];
  mode: 'all' | 'allowlist' | string;
  runtime_available?: string[];
  custom_available?: string[];
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

export interface GlobalSkillsPayload {
  storage: {
    dbPath: string;
    skillsRoot: string;
  };
  descriptions: Record<string, string>;
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
