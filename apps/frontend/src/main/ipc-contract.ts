import type {
  AgentProfile,
  GetAgentInput,
  ListAgentsInput,
  SaveAgentInput,
  SaveAgentResult,
  StartAgentInput,
  StartAgentResult,
  StopAgentInput,
  StopAgentResult,
  AgentRuntimeStatus,
  AgentLogTail,
  AgentCollaborationEvent,
  AgentTaskCreateInput,
  AgentTaskCreateResult,
  AgentTaskDeleteInput,
  AgentTaskDeleteResult,
  AgentTaskListInput,
  AgentTaskListResult,
  AgentTaskProgressInput,
  AgentTaskProgressResult,
  AgentNotificationListInput,
  AgentNotificationListResult,
  AgentNotificationMarkReadInput,
  AgentNotificationMarkReadResult,
  GetAgentLogTailInput,
  GetAgentCollaborationEventsInput,
  AgentChatInput,
  AgentChatResult,
  CancelAgentChatInput,
  CancelAgentChatResult,
} from './types';

export const AGENT_IPC_CHANNELS = {
  saveAgent: 'agent:save',
  getAgent: 'agent:get',
  listAgents: 'agent:list',
  startAgent: 'agent:start',
  stopAgent: 'agent:stop',
  agentStatus: 'agent:status',
  agentLogTail: 'agent:log-tail',
  agentCollaborationEvents: 'agent:collaboration-events',
  agentChat: 'agent:chat',
  agentChatStream: 'agent:chat-stream',
  agentChatCancel: 'agent:chat-cancel',
  agentTaskList: 'agent:task-list',
  agentTaskCreate: 'agent:task-create',
  agentTaskDelete: 'agent:task-delete',
  agentTaskProgress: 'agent:task-progress',
  agentNotificationList: 'agent:notification-list',
  agentNotificationMarkRead: 'agent:notification-mark-read',
} as const;

export interface AgentIpcContract {
  [AGENT_IPC_CHANNELS.saveAgent]: {
    req: SaveAgentInput;
    res: SaveAgentResult;
  };
  [AGENT_IPC_CHANNELS.getAgent]: {
    req: GetAgentInput;
    res: AgentProfile;
  };
  [AGENT_IPC_CHANNELS.listAgents]: {
    req: ListAgentsInput | undefined;
    res: readonly AgentProfile[];
  };
  [AGENT_IPC_CHANNELS.startAgent]: {
    req: StartAgentInput;
    res: StartAgentResult;
  };
  [AGENT_IPC_CHANNELS.stopAgent]: {
    req: StopAgentInput;
    res: StopAgentResult;
  };
  [AGENT_IPC_CHANNELS.agentStatus]: {
    req: { agentId: string };
    res: AgentRuntimeStatus;
  };
  [AGENT_IPC_CHANNELS.agentLogTail]: {
    req: GetAgentLogTailInput;
    res: AgentLogTail;
  };
  [AGENT_IPC_CHANNELS.agentCollaborationEvents]: {
    req: GetAgentCollaborationEventsInput;
    res: readonly AgentCollaborationEvent[];
  };
  [AGENT_IPC_CHANNELS.agentChat]: {
    req: AgentChatInput;
    res: AgentChatResult;
  };
  [AGENT_IPC_CHANNELS.agentChatCancel]: {
    req: CancelAgentChatInput;
    res: CancelAgentChatResult;
  };
  [AGENT_IPC_CHANNELS.agentTaskList]: {
    req: AgentTaskListInput;
    res: AgentTaskListResult;
  };
  [AGENT_IPC_CHANNELS.agentTaskCreate]: {
    req: AgentTaskCreateInput;
    res: AgentTaskCreateResult;
  };
  [AGENT_IPC_CHANNELS.agentTaskDelete]: {
    req: AgentTaskDeleteInput;
    res: AgentTaskDeleteResult;
  };
  [AGENT_IPC_CHANNELS.agentTaskProgress]: {
    req: AgentTaskProgressInput;
    res: AgentTaskProgressResult;
  };
  [AGENT_IPC_CHANNELS.agentNotificationList]: {
    req: AgentNotificationListInput;
    res: AgentNotificationListResult;
  };
  [AGENT_IPC_CHANNELS.agentNotificationMarkRead]: {
    req: AgentNotificationMarkReadInput;
    res: AgentNotificationMarkReadResult;
  };
}

export const LIVE2D_IPC_CHANNELS = {
  importModel: 'live2d:import-model',
  listModels: 'live2d:list-models',
  saveConfig: 'live2d:save-config',
  downloadGithub: 'live2d:download-github',
} as const;

export interface Live2dIpcContract {
  [LIVE2D_IPC_CHANNELS.importModel]: {
    req: undefined;
    res: import('./types').ImportLive2dModelResult;
  };
  [LIVE2D_IPC_CHANNELS.listModels]: {
    req: undefined;
    res: readonly import('./types').Live2dModelConfig[];
  };
  [LIVE2D_IPC_CHANNELS.saveConfig]: {
    req: import('./types').SaveLive2dConfigInput;
    res: import('./types').SaveLive2dConfigResult;
  };
  [LIVE2D_IPC_CHANNELS.downloadGithub]: {
    req: { url: string };
    res: import('./types').ImportLive2dModelResult;
  };
}
