import os from 'node:os';
import path from 'node:path';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';

import type { AgentWorkspacePaths, SharedWorkspacePaths } from './types';

const WEBOT_HOME_DIR_NAME = '.webot';
const WORKSPACES_DIR_NAME = 'workspaces';
const LEGACY_AGENTS_DIR_NAME = 'agents';

async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function migrateLegacyAgentsToWorkspaces(
  legacyAgentsRoot: string,
  workspacesRoot: string,
): Promise<void> {
  if (legacyAgentsRoot === workspacesRoot) {
    return;
  }
  if (!(await pathExists(legacyAgentsRoot))) {
    return;
  }

  const entries = await readdir(legacyAgentsRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(legacyAgentsRoot, entry.name);
    const targetPath = path.join(workspacesRoot, entry.name);
    if (await pathExists(targetPath)) {
      continue;
    }
    await cp(sourcePath, targetPath, { recursive: entry.isDirectory(), force: false });
  }
}

async function migrateLegacySharedMcpToSharedData(
  legacySharedMcpRoot: string,
  sharedMcpRoot: string,
): Promise<void> {
  if (legacySharedMcpRoot === sharedMcpRoot) {
    return;
  }

  if (!(await pathExists(legacySharedMcpRoot))) {
    return;
  }

  const legacyServersPath = path.join(legacySharedMcpRoot, 'servers.json');
  const targetServersPath = path.join(sharedMcpRoot, 'servers.json');

  if (await pathExists(legacyServersPath)) {
    await ensureDirectory(sharedMcpRoot);
    if (!(await pathExists(targetServersPath))) {
      await cp(legacyServersPath, targetServersPath, { force: false });
    }
  }

  await rm(legacySharedMcpRoot, { recursive: true, force: true });
}

async function normalizeLegacyWorkspaceMetadata(workspacesRoot: string): Promise<void> {
  if (!(await pathExists(workspacesRoot))) {
    return;
  }

  const entries = await readdir(workspacesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspaceDir = path.join(workspacesRoot, entry.name);
    const manifestPath = path.join(workspaceDir, 'AGENT.json');

    if (await pathExists(manifestPath)) {
      try {
        const raw = await readFile(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const currentWorkspace = typeof parsed.workspace === 'string' ? parsed.workspace.trim() : '';
        if (currentWorkspace !== workspaceDir) {
          const next = {
            ...parsed,
            workspace: workspaceDir,
          };
          await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
        }
      } catch {
        const fallback = {
          created_at: new Date().toISOString(),
          workspace: workspaceDir,
        };
        await writeFile(manifestPath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf-8');
      }
    }

  }
}

function normalizeAgentId(agentId: string): string {
  const normalized = agentId.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-');

  if (normalized.length === 0) {
    throw new Error('智能体 ID 非法：不能为空或全是特殊字符。');
  }

  return normalized;
}

export function resolveWeBotHomeRoot(homeDirOverride?: string): string {
  const homeRoot = homeDirOverride ?? os.homedir();
  return path.join(homeRoot, WEBOT_HOME_DIR_NAME);
}

export async function ensureSharedWorkspace(homeDirOverride?: string): Promise<SharedWorkspacePaths> {
  const webotHomeRoot = resolveWeBotHomeRoot(homeDirOverride);
  const sharedRoot = path.join(webotHomeRoot, 'shared');
  const legacyAgentsRoot = path.join(webotHomeRoot, LEGACY_AGENTS_DIR_NAME);
  const legacySharedMcpRoot = path.join(webotHomeRoot, 'mcp');
  const agentsRoot = path.join(webotHomeRoot, WORKSPACES_DIR_NAME);
  const sharedSkillsRoot = path.join(webotHomeRoot, 'skills');
  const sharedDataRoot = path.join(sharedRoot, 'data');
  // MCP 配置统一归档到 shared/data，下线 ~/.webot/mcp 旧目录。
  const sharedMcpRoot = sharedDataRoot;
  const sharedMediaRoot = path.join(sharedRoot, 'media');
  const sharedModelsRoot = path.join(sharedRoot, 'models');

  await ensureDirectory(webotHomeRoot);
  await ensureDirectory(sharedRoot);
  await ensureDirectory(agentsRoot);
  await ensureDirectory(sharedSkillsRoot);
  await ensureDirectory(sharedDataRoot);
  await ensureDirectory(sharedMediaRoot);
  await ensureDirectory(sharedModelsRoot);
  await migrateLegacyAgentsToWorkspaces(legacyAgentsRoot, agentsRoot);
  await migrateLegacySharedMcpToSharedData(legacySharedMcpRoot, sharedMcpRoot);
  await normalizeLegacyWorkspaceMetadata(agentsRoot);

  return {
    webotHomeRoot,
    sharedRoot,
    agentsRoot,
    sharedSkillsRoot,
    sharedMcpRoot,
    sharedDataRoot,
    sharedMediaRoot,
    sharedModelsRoot,
  };
}

export async function ensureAgentWorkspace(
  agentId: string,
  homeDirOverride?: string,
): Promise<AgentWorkspacePaths> {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const normalizedAgentId = normalizeAgentId(agentId);
  const agentRoot = path.join(shared.agentsRoot, normalizedAgentId);
  const privateSkillsRoot = path.join(agentRoot, 'skills');
  const privateMemoryRoot = path.join(agentRoot, 'memory');
  const privateDataRoot = path.join(agentRoot, 'data');
  const privateMcpRoot = privateDataRoot;
  const privateLogsRoot = path.join(agentRoot, 'logs');

  await ensureDirectory(agentRoot);
  await ensureDirectory(privateMemoryRoot);
  await ensureDirectory(privateDataRoot);
  await ensureDirectory(privateLogsRoot);

  return {
    agentId: normalizedAgentId,
    agentRoot,
    privateSkillsRoot,
    privateMcpRoot,
    privateMemoryRoot,
    privateDataRoot,
    privateLogsRoot,
  };
}
