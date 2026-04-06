import type { AgentSpeakerProfile, AgentTtsConfig } from '@/types/tts';

export type EmbodimentAssetSource = 'managed_asset' | 'managed_identity' | 'external_url';
export type EmbodimentAssetKind = 'avatar' | 'portrait' | 'self_photo' | 'video_source';
export type EmbodimentVoiceMode = 'speaker_profile' | 'provider_voice';

export interface EmbodimentAssetRef {
  source: EmbodimentAssetSource;
  kind: EmbodimentAssetKind;
  assetId?: string;
  url: string;
  label?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface EmbodimentVoiceRef {
  mode: EmbodimentVoiceMode;
  speakerProfileId?: string;
  provider?: string;
  voice?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentEmbodimentConfig {
  version: 1;
  assets: {
    defaultAvatar?: EmbodimentAssetRef;
    defaultPortrait?: EmbodimentAssetRef;
    defaultVideoSource?: EmbodimentAssetRef;
    selfPhotos?: EmbodimentAssetRef[];
  };
  voice?: {
    defaultVoice?: EmbodimentVoiceRef;
  };
}

export interface ModelProviderTemplate {
  id: string;
  displayName: string;
  apiBase: string;
  defaultModels: readonly string[];
  apiKeyEnv: string;
}

export type ProviderBadge = 'api_key' | 'custom' | 'config';

export type ProviderConnectType = 'oauth' | 'api_key' | 'config';

export interface ModelCapabilities {
  text: true;
  imageInput: boolean;
  imageOutput: boolean;
  audioInput: boolean;
  toolCall: boolean;
}

export interface SharedWorkspacePaths {
  webotHomeRoot: string;
  sharedRoot: string;
  agentsRoot: string;
  sharedSkillsRoot: string;
  sharedMcpRoot: string;
  sharedDataRoot: string;
  sharedMediaRoot: string;
  sharedModelsRoot: string;
}

export interface AgentWorkspacePaths {
  agentId: string;
  agentRoot: string;
  privateSkillsRoot: string;
  privateMcpRoot: string;
  privateMemoryRoot: string;
  privateDataRoot: string;
  privateLogsRoot: string;
}

export interface AgentRuntimeConfig {
  version: '1.0';
  agentId: string;
  displayName: string;
  generatedAt: string;
  model: {
    providerId: string;
    modelName: string;
  };
  prompt: {
    systemPrompt: string;
  };
  paths: {
    privateRoot: string;
    sharedRoot: string;
    privateSkillsRoot: string;
    privateMcpRoot: string;
    privateMemoryRoot: string;
    privateDataRoot: string;
    privateLogsRoot: string;
    sharedSkillsRoot: string;
    sharedMcpRoot: string;
    sharedDataRoot: string;
    sharedMediaRoot: string;
  };
  skills: {
    privateSkills: readonly string[];
    sharedSkills: readonly string[];
  };
  mcp: {
    privateServers: readonly string[];
    sharedServers: readonly string[];
  };
  team: {
    members: readonly AgentTeamMember[];
  };
}

export interface ConnectedProviderItem {
  connectionId: string;
  providerId: string;
  displayName: string;
  icon: string;
  badge: ProviderBadge;
  canDisconnect: boolean;
  connectedAt: string;
  modelCount: number;
  health: 'ok' | 'warning' | 'error';
  apiBase: string;
  hasApiKey: boolean;
}

export interface HotProviderItem {
  providerId: string;
  displayName: string;
  icon: string;
  subtitle: string;
  recommended: boolean;
  connectType: ProviderConnectType;
}

export interface ProviderSettingsResponse {
  connectedProviders: readonly ConnectedProviderItem[];
  hotProviders: readonly HotProviderItem[];
}

export interface ProviderModelItem {
  modelId: string;
  providerId: string;
  displayName: string;
  supportsImageInput: boolean;
  supportsToolCall: boolean;
  enabled: boolean;
  isDefault: boolean;
}

export interface ModelSettingsProviderItem {
  connectionId: string;
  providerId: string;
  displayName: string;
  enabled: boolean;
}

export interface ModelSettingsResponse {
  providers: readonly ModelSettingsProviderItem[];
  models: readonly ProviderModelItem[];
}

export interface ConnectProviderInput {
  providerId: string;
  connectType: ProviderConnectType;
  alias?: string;
  apiKey?: string;
  apiBase?: string;
  autoDiscoverModels?: boolean;
  homeDirOverride?: string;
}

export interface ConnectCustomProviderInput {
  displayName: string;
  apiBase: string;
  models: readonly string[];
  apiKey?: string;
  alias?: string;
  autoDiscoverModels?: boolean;
  homeDirOverride?: string;
}

export interface DisconnectProviderInput {
  connectionId: string;
  homeDirOverride?: string;
}

export interface SetDefaultModelInput {
  modelId: string;
  homeDirOverride?: string;
}

export interface ToggleProviderEnabledInput {
  providerId: string;
  enabled: boolean;
  homeDirOverride?: string;
}

export interface ToggleModelEnabledInput {
  modelId: string;
  enabled: boolean;
  homeDirOverride?: string;
}

export interface RefreshProviderModelsInput {
  providerId: string;
  homeDirOverride?: string;
}

export interface UpdateProviderConnectionInput {
  connectionId: string;
  apiBase?: string;
  apiKey?: string;
  alias?: string;
  autoDiscoverModels?: boolean;
  homeDirOverride?: string;
}

export interface RefreshProviderModelsResult {
  providerId: string;
  modelCount: number;
  source: 'catalog' | 'live';
}

export interface SaveAgentInput {
  agentId?: string;
  name: string;
  title?: string;
  tags: readonly string[];
  summary: string;
  soul: string;
  systemPrompt: string;
  privateSkills: readonly string[];
  sharedSkills: readonly string[];
  privateMcpServers: readonly string[];
  sharedMcpServers: readonly string[];
  defaultProviderId: string;
  defaultModelName: string;
  ttsModel?: string;
  ttsVoice?: string;
  ttsSpeed?: number;
  ttsPitch?: number;
  ttsConfig?: AgentTtsConfig;
  speakerProfiles?: AgentSpeakerProfile[];
  avatarUrl?: string;
  color?: string;
  teamMembers?: readonly AgentTeamMember[];
  homeDirOverride?: string;
}

export interface AgentTeamToolPermission {
  id: string;
  name: string;
  enabled: boolean;
}

export interface AgentTeamMember {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string;
  systemPrompt: string;
  providerId: string;
  modelName: string;
  allowedTools: readonly string[];
  toolPermissions?: readonly AgentTeamToolPermission[];
}

export interface AgentProfile {
  version: '1.0';
  agentId: string;
  resolvedAgentId?: string;
  name: string;
  title?: string;
  tags: readonly string[];
  summary: string;
  soul: string;
  systemPrompt: string;
  defaultLlm: {
    providerId: string;
    modelName: string;
  };
  skills: {
    privateSkills: readonly string[];
    sharedSkills: readonly string[];
  };
  mcp: {
    privateServers: readonly string[];
    sharedServers: readonly string[];
  };
  team: {
    members: readonly AgentTeamMember[];
  };
  appearance: {
    avatarUrl?: string;
    portraitUrl?: string;
    color?: string;
  };
  embodiment?: AgentEmbodimentConfig;
  voice?: {
    ttsModel?: string;
    ttsVoice?: string;
    ttsSpeed?: number;
    ttsPitch?: number;
    ttsConfig?: AgentTtsConfig;
    speakerProfiles?: AgentSpeakerProfile[];
  };
  paths: {
    agentRoot: string;
    privateSkillsRoot: string;
    privateMcpRoot: string;
    privateMemoryRoot: string;
    privateDataRoot: string;
    privateLogsRoot: string;
    profilePath: string;
    runtimeConfigPath: string;
    systemPromptPath: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentIndexItem {
  agentId: string;
  name: string;
  title?: string;
  tags: readonly string[];
  summary: string;
  defaultProviderId: string;
  defaultModelName: string;
  profilePath: string;
  agentRoot: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentsIndexFile {
  version: '1.0';
  updatedAt: string;
  agents: readonly AgentIndexItem[];
}

export interface SaveAgentResult {
  profile: AgentProfile;
  runtimeConfig: AgentRuntimeConfig;
}

export interface StartAgentInput {
  agentId: string;
  homeDirOverride?: string;
}

export interface StartAgentResult {
  success: boolean;
  message?: string;
  pid?: number;
  contextPath?: string;
  logPath?: string;
}

export interface StopAgentInput {
  agentId: string;
  homeDirOverride?: string;
}

export interface StopAgentResult {
  success: boolean;
  message?: string;
}

export interface AgentRuntimeStatus {
  agentId: string;
  status: 'offline' | 'starting' | 'online' | 'error';
  pid?: number;
  startedAt?: string;
  message?: string;
  lastOutputAt?: string;
  logPath?: string;
}

export interface AgentLogTail {
  agentId: string;
  logPath?: string;
  content: string;
  updatedAt?: string;
}

export interface AgentCollaborationEvent {
  eventId: string;
  agentId: string;
  requestId: string;
  kind: 'chat_started' | 'runtime_log' | 'tool_call' | 'delegate_call' | 'ipc_call' | 'chat_done' | 'chat_error';
  message: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface GetAgentCollaborationEventsInput {
  agentId: string;
  limit?: number;
  homeDirOverride?: string;
}

export interface AgentChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AgentChatAttachmentInput {
  id?: string;
  kind?: 'image' | 'file';
  filename: string;
  fileId?: string;
  contentType?: string;
  relativePath?: string;
  savedPath?: string;
  assetUrl?: string;
  size?: number;
  sha256?: string;
  localVisionSummary?: string;
  localVisionProvider?: string;
  localVisionModel?: string;
}

export const CHAT_CHANNELS = {
  app: 'app',
  web: 'web',
  gui: 'gui',
  desktop: 'desktop',
  task: 'task',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  email: 'email',
  webhook: 'webhook',
  sms: 'sms',
} as const;

export const CHAT_RENDER_MODES = {
  jsonRender: 'json-render',
  gui: 'gui',
  markdown: 'markdown',
  plainText: 'plain-text',
} as const;

export interface AgentChatInput {
  agentId: string;
  agentName?: string;
  message: string;
  history?: readonly AgentChatMessage[];
  attachments?: readonly AgentChatAttachmentInput[];
  stream?: boolean;
  requestId?: string;
  channel?: string;
  renderMode?: (typeof CHAT_RENDER_MODES)[keyof typeof CHAT_RENDER_MODES] | string;
  sessionId?: string;
  sessionLabel?: string;
  requestOrigin?: 'group_auto';
  systemPreamble?: string;
  homeDirOverride?: string;
  currentTaskDraft?: unknown;
  timeoutMs?: number;
}

export interface AgentAppearanceUpdated {
  agentId?: string;
  resolvedAgentId?: string;
  avatarUrl?: string;
  portraitUrl?: string;
  reason?: string;
  updatedFields?: Array<'avatar' | 'portrait'>;
}

export interface AgentChatResult {
  success: boolean;
  content: string;
  text?: string;
  uiRawText?: string;
  spec?: unknown;
  taskCard?: unknown;
  taskDraftState?: unknown;
  taskDraftMatched?: boolean;
  taskDraftCancelled?: boolean;
  taskDraftReadyToConfirm?: boolean;
  appearanceUpdated?: AgentAppearanceUpdated;
  error?: string;
  usedFallback?: boolean;
  sessionId?: string;
  sessionLabel?: string;
  recoveredSessionLabel?: string;
  recoveredRemoteSessionId?: string;
  recoveryReason?: 'session_conflict' | 'context_overflow' | 'quota_exceeded';
}

export interface AgentChatStreamChunk {
  requestId: string;
  kind: 'text' | 'patch' | 'log' | 'done' | 'error';
  value?: string;
  text?: string;
  spec?: unknown;
  event?: string;
  meta?: (Record<string, unknown> & {
    appearanceUpdated?: AgentAppearanceUpdated;
    taskCard?: unknown;
    taskDraftState?: unknown;
    taskDraftMatched?: boolean;
    taskDraftCancelled?: boolean;
    taskDraftReadyToConfirm?: boolean;
  });
}

export interface AgentTask {
  id: string;
  name: string;
  sourceType: 'chat' | 'custom';
  scheduleKind: 'cron' | 'at' | 'every';
  scheduleExpression?: string;
  runAt?: string;
  everyMs?: number;
  timezone?: string;
  jobType: 'shell' | 'agent';
  command?: string;
  prompt?: string;
  sessionTarget?: 'isolated' | 'main';
  enabled: boolean;
  nextRun?: string;
  lastRun?: string;
  lastStatus?: string;
}

export interface AgentTaskListInput {
  agentId: string;
  homeDirOverride?: string;
}

export interface AgentTaskListResult {
  success: boolean;
  message?: string;
  tasks: readonly AgentTask[];
}

export interface AgentTaskCreateInput {
  agentId: string;
  name?: string;
  sourceType?: 'chat' | 'custom';
  sourceMessageId?: string;
  enabled?: boolean;
  scheduleKind: 'cron' | 'at' | 'every';
  scheduleExpression?: string;
  runAt?: string;
  everyMs?: number;
  timezone?: string;
  jobType: 'shell' | 'agent';
  command?: string;
  prompt?: string;
  sessionTarget?: 'isolated' | 'main';
  model?: string;
  timeoutSecs?: number;
  deliveryMode?: 'none' | 'announce';
  deliveryChannel?: string;
  deliveryTarget?: string;
  deliveryBestEffort?: boolean;
  homeDirOverride?: string;
}

export interface AgentTaskCreateResult {
  success: boolean;
  message?: string;
  task?: AgentTask;
  raw?: string;
}

export interface AgentTaskDeleteInput {
  agentId: string;
  taskId: string;
  homeDirOverride?: string;
}

export interface AgentTaskDeleteResult {
  success: boolean;
  message?: string;
}

export interface AgentTaskProgressInput {
  agentId: string;
  taskId: string;
  homeDirOverride?: string;
}

export interface AgentTaskLogItem {
  eventId: string;
  createdAt: string;
  kind: string;
  message: string;
}

export interface AgentTaskProgressResult {
  success: boolean;
  message?: string;
  task?: AgentTask;
  runCountHint?: number;
  logs: readonly AgentTaskLogItem[];
}

export interface AgentNotification {
  notificationId: string;
  agentId: string;
  requestId?: string;
  kind: 'request_done' | 'request_error' | 'scheduled_task_update';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  meta?: Record<string, unknown>;
}

export interface AgentNotificationListInput {
  agentId: string;
  limit?: number;
  unreadOnly?: boolean;
  homeDirOverride?: string;
}

export interface AgentNotificationListResult {
  success: boolean;
  message?: string;
  notifications: readonly AgentNotification[];
}

export interface AgentNotificationMarkReadInput {
  agentId: string;
  notificationIds?: readonly string[];
  markAll?: boolean;
  homeDirOverride?: string;
}

export interface AgentNotificationMarkReadResult {
  success: boolean;
  message?: string;
  updatedCount: number;
}

export interface CancelAgentChatInput {
  requestId: string;
}

export interface CancelAgentChatResult {
  success: boolean;
  message?: string;
}

export interface GetAgentLogTailInput {
  agentId: string;
  linesCount?: number;
  homeDirOverride?: string;
}

export interface GetAgentInput {
  agentId: string;
  homeDirOverride?: string;
}

export interface ListAgentsInput {
  homeDirOverride?: string;
}

export interface SettingsApiSuccess<T> {
  ok: true;
  data: T;
}

export interface SettingsApiFailure {
  ok: false;
  error: {
    code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR';
    message: string;
  };
}

export type SettingsApiResult<T> = SettingsApiSuccess<T> | SettingsApiFailure;

export interface AppSettings {
  autoLaunch: boolean;
}

export interface SetAutoLaunchInput {
  enabled: boolean;
}

export interface BuildAgentConfigInput {
  agentId: string;
  displayName: string;
  providerId: string;
  modelName: string;
  systemPrompt: string;
  privateSkills?: readonly string[];
  sharedSkills?: readonly string[];
  privateMcpServers?: readonly string[];
  sharedMcpServers?: readonly string[];
  teamMembers?: readonly AgentTeamMember[];
  homeDirOverride?: string;
}

export interface BootstrapAgentInput {
  agentId: string;
  displayName: string;
  providerId: string;
  modelName: string;
  systemPrompt: string;
  privateSkills?: readonly string[];
  sharedSkills?: readonly string[];
  privateMcpServers?: readonly string[];
  sharedMcpServers?: readonly string[];
  teamMembers?: readonly AgentTeamMember[];
}

export interface BootstrapWorkspaceInput {
  enabledProviderIds: readonly string[];
  primaryProviderId?: string;
  agents: readonly BootstrapAgentInput[];
  homeDirOverride?: string;
}

export interface BootstrapWorkspaceResult {
  shared: SharedWorkspacePaths;
  zeroClawConfigPath: string;
  agentConfigPaths: readonly string[];
}

// Live2D Types
export interface Live2dMotion {
  group: string;
  name: string; // Usually index or key within the group
  file: string;
  descriptionCh?: string;
  descriptionEn?: string;
}

export interface Live2dExpression {
  name: string;
  file: string;
  descriptionCh?: string;
  descriptionEn?: string;
}

export interface Live2dModelConfig {
  id: string; // Folder name
  name: string;
  modelJsonFile: string;
  motions: Live2dMotion[];
  expressions: Live2dExpression[];
}

export interface ImportLive2dModelResult {
  success: boolean;
  message?: string;
  model?: Live2dModelConfig;
}

export interface SaveLive2dConfigInput {
  modelId: string;
  motions: Live2dMotion[];
  expressions: Live2dExpression[];
}

export interface SaveLive2dConfigResult {
  success: boolean;
  message?: string;
}
