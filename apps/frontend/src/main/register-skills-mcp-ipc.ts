import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import {
  getAllSkills,
  deleteSkill,
  importSkillFromFolder,
  getAllMcpServers,
  createMcpServer,
  importMcpServers,
  deleteMcpServer,
  updateMcpServerState,
} from './skills-mcp-service';
import {
  SKILLS_MCP_CHANNELS,
  type SkillScopeInput,
  type SkillDeleteInput,
  type SkillImportInput,
  type McpServerConfig,
  type McpServerScopeInput,
  type McpServerDeleteInput,
  type McpServerUpdateInput,
  type McpServerCreateInput,
  type McpServerImportInput,
} from './skills-mcp-types';

function toSkillScope(payload?: unknown): SkillScopeInput {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const record = payload as Record<string, unknown>;
  return {
    agentId: typeof record.agentId === 'string' ? record.agentId : undefined,
    homeDirOverride: typeof record.homeDirOverride === 'string' ? record.homeDirOverride : undefined,
  };
}

function toMcpScope(payload?: unknown): McpServerScopeInput {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const record = payload as Record<string, unknown>;
  return {
    agentId: typeof record.agentId === 'string' ? record.agentId : undefined,
    homeDirOverride: typeof record.homeDirOverride === 'string' ? record.homeDirOverride : undefined,
  };
}

// ==================== IPC Handlers ====================

/**
 * 创建 Skills 和 MCP 的 IPC handlers
 */
export function createSkillsMcpIpcHandlers() {
  return {
    // ==================== Skills ====================

    [SKILLS_MCP_CHANNELS.SKILLS_LIST]: async (_event: IpcMainInvokeEvent, payload?: SkillScopeInput) => {
      return await getAllSkills(toSkillScope(payload));
    },

    [SKILLS_MCP_CHANNELS.SKILLS_DELETE]: async (_event: IpcMainInvokeEvent, payload: SkillDeleteInput | string) => {
      if (typeof payload === 'string') {
        return await deleteSkill(payload, {});
      }
      return await deleteSkill(payload.skillId, toSkillScope(payload));
    },

    [SKILLS_MCP_CHANNELS.SKILLS_REFRESH]: async (_event: IpcMainInvokeEvent, payload?: SkillScopeInput) => {
      return await getAllSkills(toSkillScope(payload));
    },

    [SKILLS_MCP_CHANNELS.SKILLS_IMPORT]: async (
      event: IpcMainInvokeEvent,
      input?: SkillImportInput,
    ) => {
      const scope = toSkillScope(input);
      let sourcePath = input?.sourcePath;
      if (!sourcePath) {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const result = browserWindow
          ? await dialog.showOpenDialog(browserWindow, { properties: ['openDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory'] });
        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, message: '已取消' };
        }
        sourcePath = result.filePaths[0];
      }
      if (!sourcePath) {
        return { success: false, message: '未选择路径' };
      }
      return await importSkillFromFolder(sourcePath, scope);
    },

    // ==================== MCP ====================

    [SKILLS_MCP_CHANNELS.MCP_LIST]: async (_event: IpcMainInvokeEvent, payload?: McpServerScopeInput) => {
      return await getAllMcpServers(toMcpScope(payload));
    },

    [SKILLS_MCP_CHANNELS.MCP_CREATE]: async (
      _event: IpcMainInvokeEvent,
      payload: McpServerCreateInput & McpServerScopeInput,
    ) => {
      const { agentId, homeDirOverride, ...input } = payload;
      return await createMcpServer(input, { agentId, homeDirOverride });
    },

    [SKILLS_MCP_CHANNELS.MCP_IMPORT]: async (
      _event: IpcMainInvokeEvent,
      input: McpServerImportInput,
    ) => {
      const { agentId, homeDirOverride, ...rest } = input;
      return await importMcpServers(rest as McpServerImportInput, { agentId, homeDirOverride });
    },

    [SKILLS_MCP_CHANNELS.MCP_DELETE]: async (
      _event: IpcMainInvokeEvent,
      payload: McpServerDeleteInput | string,
    ) => {
      if (typeof payload === 'string') {
        return await deleteMcpServer(payload, {});
      }
      return await deleteMcpServer(payload.serverId, toMcpScope(payload));
    },

    [SKILLS_MCP_CHANNELS.MCP_UPDATE]: async (
      _event: IpcMainInvokeEvent,
      payload: McpServerUpdateInput | { serverId: string; updates: Partial<McpServerConfig> }
    ) => {
      return await updateMcpServerState(payload.serverId, payload.updates, toMcpScope(payload));
    },

    [SKILLS_MCP_CHANNELS.MCP_REFRESH]: async (_event: IpcMainInvokeEvent, payload?: McpServerScopeInput) => {
      return await getAllMcpServers(toMcpScope(payload));
    },
  };
}

/**
 * 注册 Skills 和 MCP 的 IPC handlers
 */
export function registerSkillsMcpIpcHandlers() {
  const handlers = createSkillsMcpIpcHandlers();

  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler as any);
  });

  console.log('[Skills-MCP] IPC handlers 已注册');
}
