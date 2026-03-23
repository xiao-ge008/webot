import { requestJson } from '@/services/transport';
import {
  type AgentTtsSynthesisResult,
  DEFAULT_APP_TTS_SETTINGS,
  type AppTtsSettings,
  type LocalTtsStatus,
  type RemoteTtsProviderConfig,
  type RemoteTtsProviderId,
  type TtsManagementStatus,
  type TtsModelFileStatus,
} from '@/types/tts';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function asOptionalString(value: unknown): string | undefined {
  const text = asString(value).trim();
  return text || undefined;
}

function normalizeProviderConfig(value: unknown, fallback: RemoteTtsProviderConfig): RemoteTtsProviderConfig {
  const record = isRecord(value) ? value : {};
  return {
    enabled: asBool(record.enabled, fallback.enabled),
    baseUrl: asString(record.baseUrl, fallback.baseUrl),
    apiKeyEnv: asString(record.apiKeyEnv, fallback.apiKeyEnv) || undefined,
    model: asString(record.model, fallback.model) || undefined,
    voice: asString(record.voice, fallback.voice) || undefined,
    format: asString(record.format, fallback.format) || undefined,
    timeoutSecs:
      typeof record.timeoutSecs === 'number'
        ? asNumber(record.timeoutSecs)
        : fallback.timeoutSecs,
  };
}

export function normalizeAppTtsSettings(value: unknown): AppTtsSettings {
  const record = isRecord(value) ? value : {};
  const local = isRecord(record.local) ? record.local : {};
  const remote = isRecord(record.remote) ? record.remote : {};
  const statusValue = asString(local.status, DEFAULT_APP_TTS_SETTINGS.local.status);
  const localStatus: LocalTtsStatus = (
    ['not_installed', 'downloading', 'downloaded', 'loading', 'loaded', 'failed'] as const
  ).includes(statusValue as LocalTtsStatus)
    ? (statusValue as LocalTtsStatus)
    : DEFAULT_APP_TTS_SETTINGS.local.status;
  const activeProviderValue = asString(remote.activeProvider, DEFAULT_APP_TTS_SETTINGS.remote.activeProvider);
  const activeProvider: RemoteTtsProviderId = (
    ['openai', 'cosyvoice3', 'indextts', 'qwen_tts'] as const
  ).includes(activeProviderValue as RemoteTtsProviderId)
    ? (activeProviderValue as RemoteTtsProviderId)
    : DEFAULT_APP_TTS_SETTINGS.remote.activeProvider;

  return {
    enabled: asBool(record.enabled, DEFAULT_APP_TTS_SETTINGS.enabled),
    mode: asString(record.mode, DEFAULT_APP_TTS_SETTINGS.mode) === 'remote' ? 'remote' : 'local',
    activeLocalEngine: 'f5-tts-onnx',
    local: {
      enabled: asBool(local.enabled, DEFAULT_APP_TTS_SETTINGS.local.enabled),
      engine: 'f5-tts-onnx',
      modelDir: asString(local.modelDir, DEFAULT_APP_TTS_SETTINGS.local.modelDir),
      autoDownload: asBool(local.autoDownload, DEFAULT_APP_TTS_SETTINGS.local.autoDownload),
      autoLoad: asBool(local.autoLoad, DEFAULT_APP_TTS_SETTINGS.local.autoLoad),
      device:
        asString(local.device, DEFAULT_APP_TTS_SETTINGS.local.device) === 'cpu'
          ? 'cpu'
          : asString(local.device, DEFAULT_APP_TTS_SETTINGS.local.device) === 'directml'
            ? 'directml'
            : asString(local.device, DEFAULT_APP_TTS_SETTINGS.local.device) === 'openvino'
              ? 'openvino'
              : 'auto',
      status: localStatus,
      modelVersion: asString(local.modelVersion, DEFAULT_APP_TTS_SETTINGS.local.modelVersion) || undefined,
      lastError: asString(local.lastError) || undefined,
    },
    remote: {
      activeProvider,
      openai: normalizeProviderConfig(remote.openai, DEFAULT_APP_TTS_SETTINGS.remote.openai),
      cosyvoice3: normalizeProviderConfig(remote.cosyvoice3, DEFAULT_APP_TTS_SETTINGS.remote.cosyvoice3),
      indextts: normalizeProviderConfig(remote.indextts, DEFAULT_APP_TTS_SETTINGS.remote.indextts),
      qwenTts: normalizeProviderConfig(remote.qwenTts, DEFAULT_APP_TTS_SETTINGS.remote.qwenTts),
    },
  };
}

function normalizeFileStatus(value: unknown): TtsModelFileStatus {
  const record = isRecord(value) ? value : {};
  return {
    relativePath: asString(record.relativePath),
    expectedSize: typeof record.expectedSize === 'number' ? record.expectedSize : undefined,
    present: asBool(record.present),
    size: typeof record.size === 'number' ? record.size : undefined,
  };
}

export function normalizeTtsManagementStatus(value: unknown): TtsManagementStatus {
  const record = isRecord(value) ? value : {};
  return {
    config: normalizeAppTtsSettings(record.config),
    providerAvailable: asBool(record.providerAvailable, true),
    modelReady: asBool(record.modelReady),
    downloadActive: asBool(record.downloadActive),
    downloadedBytes: asNumber(record.downloadedBytes),
    totalBytes: asNumber(record.totalBytes),
    progressPercent: asNumber(record.progressPercent),
    currentFile: asString(record.currentFile) || undefined,
    lastError: asString(record.lastError) || undefined,
    modelRootDir: asString(record.modelRootDir),
    modelDir: asString(record.modelDir),
    missingFiles: asStringArray(record.missingFiles),
    files: Array.isArray(record.files) ? record.files.map(normalizeFileStatus) : [],
    updatedAtMs: asNumber(record.updatedAtMs),
  };
}

export async function getTtsConfig(): Promise<AppTtsSettings> {
  const payload = await requestJson<unknown>('/api/management/tts/config');
  if (!isRecord(payload)) {
    return DEFAULT_APP_TTS_SETTINGS;
  }
  return normalizeAppTtsSettings(payload.config);
}

export async function setTtsConfig(config: AppTtsSettings): Promise<AppTtsSettings> {
  const payload = await requestJson<unknown>('/api/management/tts/config', {
    method: 'PUT',
    body: config,
  });
  if (!isRecord(payload)) {
    return config;
  }
  return normalizeAppTtsSettings(payload.config);
}

export async function getTtsStatus(): Promise<TtsManagementStatus> {
  const payload = await requestJson<unknown>('/api/management/tts/status');
  if (!isRecord(payload)) {
    return normalizeTtsManagementStatus({});
  }
  return normalizeTtsManagementStatus(payload.status);
}

export async function startTtsDownload(): Promise<TtsManagementStatus> {
  const payload = await requestJson<unknown>('/api/management/tts/download', {
    method: 'POST',
  });
  if (!isRecord(payload)) {
    return normalizeTtsManagementStatus({});
  }
  return normalizeTtsManagementStatus(payload.status);
}

export async function installTtsRuntime(): Promise<TtsManagementStatus> {
  const payload = await requestJson<unknown>('/api/management/tts/install-runtime', {
    method: 'POST',
  });
  if (!isRecord(payload)) {
    return normalizeTtsManagementStatus({});
  }
  return normalizeTtsManagementStatus(payload.status);
}

export async function loadTtsEngine(): Promise<TtsManagementStatus> {
  const payload = await requestJson<unknown>('/api/management/tts/load', {
    method: 'POST',
  });
  if (!isRecord(payload)) {
    return normalizeTtsManagementStatus({});
  }
  return normalizeTtsManagementStatus(payload.status);
}

export async function unloadTtsEngine(): Promise<TtsManagementStatus> {
  const payload = await requestJson<unknown>('/api/management/tts/unload', {
    method: 'POST',
  });
  if (!isRecord(payload)) {
    return normalizeTtsManagementStatus({});
  }
  return normalizeTtsManagementStatus(payload.status);
}

export interface AgentTtsSynthesisInput {
  text: string;
  speakerProfileId?: string;
  format?: 'wav';
  messageId?: string;
  signal?: AbortSignal;
}

function normalizeAgentTtsSynthesisResult(value: unknown): AgentTtsSynthesisResult {
  const record = isRecord(value) ? value : {};
  return {
    assetUrl: asString(record.asset_url, asString(record.assetUrl)),
    filename: asString(record.filename),
    relativePath: asString(record.relative_path, asString(record.relativePath)),
    savedPath: asString(record.saved_path, asString(record.savedPath)),
    mimeType: asString(record.mime_type, asString(record.mimeType, 'audio/wav')),
    size: asNumber(record.size),
    durationSecs: asNumber(record.duration_secs, asNumber(record.durationSecs)),
    sampleRate: asNumber(record.sample_rate, asNumber(record.sampleRate, 24000)),
    provider: asString(record.provider, 'local'),
    engine: asString(record.engine, 'f5-tts-onnx'),
    speakerProfileId: asString(record.speaker_profile_id, asString(record.speakerProfileId)),
    speakerName: asString(record.speaker_name, asString(record.speakerName)),
    device: asString(record.device),
    requestedText: asString(record.requested_text, asString(record.requestedText)),
    chunkCount: asNumber(record.chunk_count, asNumber(record.chunkCount, 1)),
    messageId: asOptionalString(record.message_id ?? record.messageId),
    upstreamFileId: asOptionalString(record.upstream_file_id ?? record.upstreamFileId),
    sha256: asOptionalString(record.sha256),
    warnings: asStringArray(record.warnings),
  };
}

export async function synthesizeAgentTts(
  agentId: string,
  input: AgentTtsSynthesisInput,
): Promise<AgentTtsSynthesisResult> {
  const payload = await requestJson<unknown>(`/api/management/agents/${encodeURIComponent(agentId)}/tts/synthesize`, {
    method: 'POST',
    body: {
      text: input.text,
      speakerProfileId: input.speakerProfileId,
      format: input.format ?? 'wav',
      messageId: input.messageId,
    },
    signal: input.signal,
  });
  return normalizeAgentTtsSynthesisResult(payload);
}
