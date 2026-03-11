import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import { ensureAgentWorkspace, ensureSharedWorkspace } from './shared-workspace-manager';
import type { AgentRuntimeConfig, BuildAgentConfigInput } from './types';

export async function buildAgentRuntimeConfig(
  input: BuildAgentConfigInput,
): Promise<AgentRuntimeConfig> {
  const shared = await ensureSharedWorkspace(input.homeDirOverride);
  const agent = await ensureAgentWorkspace(input.agentId, input.homeDirOverride);

  return {
    version: '1.0',
    agentId: agent.agentId,
    displayName: input.displayName,
    generatedAt: new Date().toISOString(),
    model: {
      providerId: input.providerId,
      modelName: input.modelName,
    },
    prompt: {
      systemPrompt: input.systemPrompt,
    },
    paths: {
      privateRoot: agent.agentRoot,
      sharedRoot: shared.sharedRoot,
      privateSkillsRoot: agent.privateSkillsRoot,
      privateMcpRoot: agent.privateMcpRoot,
      privateMemoryRoot: agent.privateMemoryRoot,
      privateDataRoot: agent.privateDataRoot,
      privateLogsRoot: agent.privateLogsRoot,
      sharedSkillsRoot: shared.sharedSkillsRoot,
      sharedMcpRoot: shared.sharedMcpRoot,
      sharedDataRoot: shared.sharedDataRoot,
      sharedMediaRoot: shared.sharedMediaRoot,
    },
    skills: {
      privateSkills: input.privateSkills ?? [],
      // 统一使用全局技能池，智能体仅记录启用列表；shared 字段保留兼容。
      sharedSkills: [],
    },
    mcp: {
      privateServers: input.privateMcpServers ?? [],
      // 统一使用全局 MCP 池，智能体仅记录启用列表；shared 字段保留兼容。
      sharedServers: [],
    },
    team: {
      members: input.teamMembers ?? [],
    },
  };
}

export async function writeAgentRuntimeConfigFile(
  config: AgentRuntimeConfig,
  homeDirOverride?: string,
  targetFilePath?: string,
): Promise<string> {
  const agentWorkspace = await ensureAgentWorkspace(config.agentId, homeDirOverride);
  const outputPath = targetFilePath ?? path.join(agentWorkspace.agentRoot, 'agent.config.json');

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(config, null, 2), 'utf-8');

  return outputPath;
}
