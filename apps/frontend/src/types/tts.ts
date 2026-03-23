export type TtsMode = 'local' | 'remote';
export type LocalTtsEngine = 'f5-tts-onnx';
export type LocalTtsDevice = 'auto' | 'cpu' | 'directml' | 'openvino';
export type LocalTtsStatus =
  | 'not_installed'
  | 'downloading'
  | 'downloaded'
  | 'loading'
  | 'loaded'
  | 'failed';

export type RemoteTtsServiceMode =
  | 'inherit_global'
  | 'local_f5'
  | 'remote_openai'
  | 'remote_cosyvoice3'
  | 'remote_indextts'
  | 'remote_qwen_tts';

export type TtsSplitStrategy = 'auto' | 'sentence' | 'paragraph';
export type AgentTtsPlaybackMode = 'manual' | 'auto';
export type RemoteTtsProviderId = 'openai' | 'cosyvoice3' | 'indextts' | 'qwen_tts';

export interface RemoteTtsProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKeyEnv?: string;
  model?: string;
  voice?: string;
  format?: string;
  timeoutSecs?: number;
}

export interface RemoteTtsSettings {
  activeProvider: RemoteTtsProviderId;
  openai: RemoteTtsProviderConfig;
  cosyvoice3: RemoteTtsProviderConfig;
  indextts: RemoteTtsProviderConfig;
  qwenTts: RemoteTtsProviderConfig;
}

export interface LocalTtsSettings {
  enabled: boolean;
  engine: LocalTtsEngine;
  modelDir: string;
  autoDownload: boolean;
  autoLoad: boolean;
  device: LocalTtsDevice;
  status: LocalTtsStatus;
  modelVersion?: string;
  lastError?: string;
}

export interface AppTtsSettings {
  enabled: boolean;
  mode: TtsMode;
  activeLocalEngine: LocalTtsEngine;
  local: LocalTtsSettings;
  remote: RemoteTtsSettings;
}

export interface AgentTtsConfig {
  enabled: boolean;
  serviceMode: RemoteTtsServiceMode;
  speakerProfileId?: string;
  messageTag?: string;
  playbackMode?: AgentTtsPlaybackMode;
  speed?: number;
  pitch?: number;
  splitStrategy?: TtsSplitStrategy;
  maxChunkChars?: number;
}

export interface AgentSpeakerProfile {
  id: string;
  name: string;
  engine: LocalTtsEngine;
  refAudioPath?: string;
  refText?: string;
  language?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TtsModelFileStatus {
  relativePath: string;
  expectedSize?: number;
  present: boolean;
  size?: number;
}

export interface TtsManagementStatus {
  config: AppTtsSettings;
  providerAvailable: boolean;
  modelReady: boolean;
  downloadActive: boolean;
  downloadedBytes: number;
  totalBytes: number;
  progressPercent: number;
  currentFile?: string;
  lastError?: string;
  modelRootDir: string;
  modelDir: string;
  missingFiles: string[];
  files: TtsModelFileStatus[];
  updatedAtMs: number;
}

export interface AgentTtsSynthesisResult {
  assetUrl: string;
  filename: string;
  relativePath: string;
  savedPath: string;
  mimeType: string;
  size: number;
  durationSecs: number;
  sampleRate: number;
  provider: string;
  engine: string;
  speakerProfileId: string;
  speakerName: string;
  device: string;
  requestedText: string;
  chunkCount: number;
  messageId?: string;
  upstreamFileId?: string;
  sha256?: string;
  warnings: string[];
}

export const DEFAULT_REMOTE_TTS_PROVIDER_CONFIG: RemoteTtsProviderConfig = {
  enabled: false,
  baseUrl: '',
  apiKeyEnv: undefined,
  model: undefined,
  voice: undefined,
  format: undefined,
  timeoutSecs: 30,
};

export const DEFAULT_APP_TTS_SETTINGS: AppTtsSettings = {
  enabled: false,
  mode: 'local',
  activeLocalEngine: 'f5-tts-onnx',
  local: {
    enabled: false,
    engine: 'f5-tts-onnx',
    modelDir: '',
    autoDownload: true,
    autoLoad: true,
    device: 'auto',
    status: 'not_installed',
    modelVersion: 'dakeqq-f5-tts-onnx',
    lastError: undefined,
  },
  remote: {
    activeProvider: 'openai',
    openai: {
      ...DEFAULT_REMOTE_TTS_PROVIDER_CONFIG,
      apiKeyEnv: 'OPENAI_API_KEY',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      format: 'mp3',
    },
    cosyvoice3: { ...DEFAULT_REMOTE_TTS_PROVIDER_CONFIG },
    indextts: { ...DEFAULT_REMOTE_TTS_PROVIDER_CONFIG },
    qwenTts: { ...DEFAULT_REMOTE_TTS_PROVIDER_CONFIG },
  },
};

export const DEFAULT_AGENT_TTS_CONFIG: AgentTtsConfig = {
  enabled: false,
  serviceMode: 'inherit_global',
  speakerProfileId: undefined,
  messageTag: 'speaker',
  playbackMode: 'manual',
  speed: 1,
  pitch: 1,
  splitStrategy: 'sentence',
  maxChunkChars: 180,
};
