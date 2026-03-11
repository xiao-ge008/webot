import type {
  SkillItem,
  McpServerConfig,
  SkillScopeInput,
  SkillDeleteInput,
  SkillImportInput,
  SkillImportResult,
  McpServerCreateInput,
  McpServerScopeInput,
  McpServerDeleteInput,
  McpServerUpdateInput,
  McpServerCreateResult,
  McpServerImportInput,
  McpServerImportResult,
  McpServerDeleteResult,
} from '@/main/skills-mcp-types';
import { SKILLS_MCP_CHANNELS } from '@/main/skills-mcp-types';

interface IpcInvoker {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
}

function resolveIpcInvoker(): IpcInvoker | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const globalWindow = window as unknown as {
    webotIpc?: IpcInvoker;
    electron?: { ipcRenderer?: IpcInvoker };
  };

  if (globalWindow.webotIpc?.invoke) {
    return globalWindow.webotIpc;
  }

  if (globalWindow.electron?.ipcRenderer?.invoke) {
    return globalWindow.electron.ipcRenderer;
  }

  return null;
}

async function invokeIpc<TResponse>(channel: string, payload?: unknown): Promise<TResponse> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    throw new Error('IPC 未就绪');
  }

  return (await ipc.invoke(channel, payload)) as TResponse;
}

function fallbackError<TResponse>(message: string): TResponse {
  throw new Error(message);
}

function withScope<T extends object>(
  payload: T,
  scope?: SkillScopeInput | McpServerScopeInput,
): T & SkillScopeInput {
  return {
    ...payload,
    agentId: scope?.agentId,
    homeDirOverride: scope?.homeDirOverride,
  };
}

// ==================== Skills ====================

export async function listSkills(scope?: SkillScopeInput): Promise<SkillItem[]> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return [];
  }
  return invokeIpc<SkillItem[]>(SKILLS_MCP_CHANNELS.SKILLS_LIST, scope ?? {});
}

export async function deleteSkill(
  skillId: string,
  scope?: SkillScopeInput,
): Promise<{ success: boolean; message?: string }> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return { success: false, message: 'IPC 未就绪' };
  }
  const payload: SkillDeleteInput = {
    skillId,
    agentId: scope?.agentId,
    homeDirOverride: scope?.homeDirOverride,
  };
  return invokeIpc<{ success: boolean; message?: string }>(SKILLS_MCP_CHANNELS.SKILLS_DELETE, payload);
}

export async function refreshSkills(scope?: SkillScopeInput): Promise<SkillItem[]> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return [];
  }
  return invokeIpc<SkillItem[]>(SKILLS_MCP_CHANNELS.SKILLS_REFRESH, scope ?? {});
}

export async function importSkill(
  input?: SkillImportInput,
): Promise<SkillImportResult> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return { success: false, message: 'IPC 未就绪' };
  }
  return invokeIpc<SkillImportResult>(SKILLS_MCP_CHANNELS.SKILLS_IMPORT, input ?? {});
}

// ==================== MCP ====================

export async function listMcpServers(scope?: McpServerScopeInput): Promise<McpServerConfig[]> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return fallbackError('IPC 未就绪');
  }
  return invokeIpc<McpServerConfig[]>(SKILLS_MCP_CHANNELS.MCP_LIST, scope ?? {});
}

export async function createMcpServer(
  input: McpServerCreateInput,
  scope?: McpServerScopeInput,
): Promise<McpServerCreateResult> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return { success: false, message: 'IPC 未就绪' };
  }
  return invokeIpc<McpServerCreateResult>(SKILLS_MCP_CHANNELS.MCP_CREATE, withScope(input, scope));
}

export async function importMcpServers(
  input: McpServerImportInput,
  scope?: McpServerScopeInput,
): Promise<McpServerImportResult> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return { success: false, message: 'IPC 未就绪' };
  }
  return invokeIpc<McpServerImportResult>(SKILLS_MCP_CHANNELS.MCP_IMPORT, withScope(input, scope));
}

export async function deleteMcpServer(
  serverId: string,
  scope?: McpServerScopeInput,
): Promise<McpServerDeleteResult> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return { success: false, message: 'IPC 未就绪' };
  }
  const payload: McpServerDeleteInput = {
    serverId,
    agentId: scope?.agentId,
    homeDirOverride: scope?.homeDirOverride,
  };
  return invokeIpc<McpServerDeleteResult>(SKILLS_MCP_CHANNELS.MCP_DELETE, payload);
}

export async function updateMcpServer(
  serverId: string,
  updates: Partial<McpServerConfig>,
  scope?: McpServerScopeInput,
): Promise<{ success: boolean; message?: string }> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return { success: false, message: 'IPC 未就绪' };
  }
  const payload: McpServerUpdateInput = {
    serverId,
    updates,
    agentId: scope?.agentId,
    homeDirOverride: scope?.homeDirOverride,
  };
  return invokeIpc<{ success: boolean; message?: string }>(SKILLS_MCP_CHANNELS.MCP_UPDATE, {
    ...payload,
  });
}

export async function refreshMcpServers(scope?: McpServerScopeInput): Promise<McpServerConfig[]> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    return fallbackError('IPC 未就绪');
  }
  return invokeIpc<McpServerConfig[]>(SKILLS_MCP_CHANNELS.MCP_REFRESH, scope ?? {});
}
