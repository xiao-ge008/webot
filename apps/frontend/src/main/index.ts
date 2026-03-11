export { ensureAgentWorkspace, ensureSharedWorkspace, resolveWeBotHomeRoot } from './shared-workspace-manager';

export { buildAgentRuntimeConfig, writeAgentRuntimeConfigFile } from './agent-config-manager';

export { getAgentProfile, listAgentProfiles, saveAgentProfile } from './agent-profile-service';

export { AGENT_IPC_CHANNELS, LIVE2D_IPC_CHANNELS } from './ipc-contract';
export { registerLive2dIpcHandlers } from './register-live2d-ipc';

export type { AgentIpcContract } from './ipc-contract';

export type {
  AgentRuntimeConfig,
  AgentWorkspacePaths,
  BuildAgentConfigInput,
  AgentIndexItem,
  AgentProfile,
  AgentsIndexFile,
  ModelCapabilities,
  ModelProviderTemplate,
  ProviderBadge,
  ProviderConnectType,
  SaveAgentInput,
  SaveAgentResult,
  SettingsApiFailure,
  SettingsApiResult,
  SettingsApiSuccess,
  GetAgentInput,
  ListAgentsInput,
  SharedWorkspacePaths,
  ImportLive2dModelResult,
  Live2dExpression,
  Live2dModelConfig,
  Live2dMotion,
  SaveLive2dConfigInput,
  SaveLive2dConfigResult,
} from './types';
