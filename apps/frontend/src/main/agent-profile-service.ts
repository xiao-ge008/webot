import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

import { buildAgentRuntimeConfig, writeAgentRuntimeConfigFile } from './agent-config-manager';
import { ensureAgentWorkspace, ensureSharedWorkspace } from './shared-workspace-manager';
import type {
  AgentIndexItem,
  AgentProfile,
  AgentTeamMember,
  AgentTeamToolPermission,
  AgentsIndexFile,
  GetAgentInput,
  ListAgentsInput,
  SaveAgentInput,
  SaveAgentResult,
} from './types';

const AGENTS_INDEX_FILE = 'agents.index.json';
const AGENT_PROFILE_FILE = 'agent.profile.json';
const AGENT_PROMPT_FILE = 'system-prompt.md';
const DEFAULT_NUWA_AVATAR_URL = '/agent_profile/avatar.png';

interface DefaultAgentSeed {
  agentId: string;
  name: string;
  title: string;
  tags: string[];
  summary: string;
  soul: string;
  systemPrompt: string;
  color: string;
}

const TEAM_TOOL_NAME_MAP: Record<string, string> = {
  sys_search: '系统搜索',
  web_request: '网络请求',
  file_read: '文件读取',
  file_write: '文件写入',
  file_delete: '文件删除',
  mcp_tools: 'MCP 工具',
};

function normalizeStringList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const normalized = values.map((item) => item.trim()).filter((item) => item.length > 0);
  return Array.from(new Set(normalized));
}

function normalizeTeamMemberId(input: string, fallbackIndex: number): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `member-${fallbackIndex + 1}`;
}

function normalizeToolPermissions(
  permissions: readonly AgentTeamToolPermission[] | undefined,
): AgentTeamToolPermission[] {
  if (!permissions) return [];
  const normalized = permissions
    .map((item) => ({
      id: item.id.trim(),
      name: item.name.trim() || TEAM_TOOL_NAME_MAP[item.id.trim()] || item.id.trim(),
      enabled: item.enabled !== false,
    }))
    .filter((item) => item.id.length > 0);
  const unique = new Map<string, AgentTeamToolPermission>();
  for (const item of normalized) {
    unique.set(item.id, item);
  }
  return Array.from(unique.values());
}

function normalizeTeamMembers(
  members: readonly AgentTeamMember[] | undefined,
  fallbackProviderId: string,
  fallbackModelName: string,
): AgentTeamMember[] {
  if (!members || members.length === 0) return [];

  const result: AgentTeamMember[] = [];
  const usedIds = new Set<string>();

  members.forEach((member, index) => {
    const memberIdBase = normalizeTeamMemberId(member.id || member.name || '', index);
    let memberId = memberIdBase;
    let suffix = 2;
    while (usedIds.has(memberId)) {
      memberId = `${memberIdBase}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(memberId);

    const allowedTools = normalizeStringList(member.allowedTools);
    const toolPermissions = normalizeToolPermissions(member.toolPermissions);
    const mergedAllowedTools = allowedTools.length > 0
      ? allowedTools
      : toolPermissions.filter((item) => item.enabled).map((item) => item.id);

    result.push({
      id: memberId,
      name: member.name?.trim() || `成员 ${index + 1}`,
      role: member.role?.trim() || '子智能体',
      avatarUrl: member.avatarUrl?.trim() || undefined,
      systemPrompt: member.systemPrompt?.trim() || '',
      providerId: member.providerId?.trim() || fallbackProviderId,
      modelName: member.modelName?.trim() || fallbackModelName,
      allowedTools: mergedAllowedTools,
      toolPermissions,
    });
  });

  return result;
}

function createDefaultTeamMembers(providerId: string, modelName: string): AgentTeamMember[] {
  return [
    {
      id: 'developer-executor',
      name: '开发执行',
      role: '子智能体',
      systemPrompt: '你是执行开发成员，负责按照负责人拆解的任务实现代码并汇报结果。',
      providerId,
      modelName,
      allowedTools: ['sys_search', 'web_request', 'file_read', 'file_write', 'mcp_tools'],
      toolPermissions: [
        { id: 'sys_search', name: TEAM_TOOL_NAME_MAP.sys_search, enabled: true },
        { id: 'web_request', name: TEAM_TOOL_NAME_MAP.web_request, enabled: true },
        { id: 'file_read', name: TEAM_TOOL_NAME_MAP.file_read, enabled: true },
        { id: 'file_write', name: TEAM_TOOL_NAME_MAP.file_write, enabled: true },
        { id: 'file_delete', name: TEAM_TOOL_NAME_MAP.file_delete, enabled: false },
        { id: 'mcp_tools', name: TEAM_TOOL_NAME_MAP.mcp_tools, enabled: true },
      ],
    },
    {
      id: 'qa-reviewer',
      name: '测试评审',
      role: '子智能体',
      systemPrompt: '你是测试与评审成员，负责验证交付质量、识别风险并给出回归建议。',
      providerId,
      modelName,
      allowedTools: ['sys_search', 'file_read', 'mcp_tools'],
      toolPermissions: [
        { id: 'sys_search', name: TEAM_TOOL_NAME_MAP.sys_search, enabled: true },
        { id: 'web_request', name: TEAM_TOOL_NAME_MAP.web_request, enabled: false },
        { id: 'file_read', name: TEAM_TOOL_NAME_MAP.file_read, enabled: true },
        { id: 'file_write', name: TEAM_TOOL_NAME_MAP.file_write, enabled: false },
        { id: 'file_delete', name: TEAM_TOOL_NAME_MAP.file_delete, enabled: false },
        { id: 'mcp_tools', name: TEAM_TOOL_NAME_MAP.mcp_tools, enabled: true },
      ],
    },
  ];
}

function slugify(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
  return normalized.length > 0 ? normalized : 'agent';
}

function resolveAgentId(input: SaveAgentInput): string {
  if (typeof input.agentId === 'string' && input.agentId.trim().length > 0) {
    return slugify(input.agentId);
  }

  const suffix = Date.now().toString(36);
  return `${slugify(input.name)}-${suffix}`;
}

async function resolveDefaultModel(homeDirOverride?: string): Promise<{
  providerId: string;
  modelName: string;
}> {
  void homeDirOverride;
  return {
    providerId: 'openai',
    modelName: 'gpt-4o-mini',
  };
}

function getDefaultAgentSeeds(): DefaultAgentSeed[] {
  return [
    {
      agentId: 'nuwa',
      name: '女娲',
      title: '默认智能体管理与创作助手',
      tags: ['默认', '智能体管理', '本地接口'],
      summary: '负责通过本地管理接口引导用户创建和修改智能体，并在确认后同步身份文件与属性。',
      soul: '善于塑形与引导，既能满足创作需求，也重视确认与边界。',
      systemPrompt: [
        '你是女娲，默认内置的智能体管理与创作助手。',
        '你的职责只包括：创建智能体、修改本地智能体配置与身份文件。',
        '严禁执行删除操作。若用户想删除智能体，只能明确告知用户去界面 UI 手动删除。',
        '你的本地管理能力包括：创建智能体；修改 nickname / english_name / description / tags / provider / model / avatar_url / portrait_url / color / extra workspaces；修改 IDENTITY.md / SOUL.md / USER.md / MEMORY.md / TOOLS.md / AGENTS.md / BOOTSTRAP.md / HEARTBEAT.md；修改 system prompt。',
        '你必须分多轮询问，逐步补齐信息。每轮最多追问 1 到 2 个关键缺失项。',
        '创建前至少确认：显示昵称、英文名称、角色简介或目标、标签，以及人格语气、世界观、服务对象、记忆策略、工具边界、协作方式、首次会话流程、周期巡检任务中的关键设定；如涉及工作区、模型、身份文件，也要单独确认。',
        '修改前至少确认：目标智能体是谁、要改哪些属性、是否改身份文件、最终变更摘要；若角色核心设定变化，必须确认是否重写整套身份文件。',
        '在用户明确确认之前，你只能继续提问、整理摘要、展示确认信息，不能执行任何写入。',
        '一旦信息齐备，必须先输出 AgentManagementConfirmCard 确认卡，再等待用户点击确认。',
        '确认卡必须放在 <UI_JSON>{"type":"AgentManagementConfirmCard","props":{...}}</UI_JSON> 中；不要只输出“现在输出确认卡，请确认是否创建”之类的纯文本。',
        '确认卡要求：confirmAction=confirm_agent_management，cancelAction=cancel_agent_management，mode 只能是 create 或 update。',
        '确认卡 payload 允许字段：mode / agentId / targetName / englishName / nickname / description / tags / workspaces / provider / model / avatarUrl / portraitUrl / color / rewriteContextFiles / contextFiles。',
        '如果一次要创建多个智能体，必须在 payload.items 中按数组逐个给出每个智能体的 nickname / englishName / description / tags / workspaces / provider / model / contextFiles，不要把多个角色混成一个智能体，也不要使用未声明字段。',
        'payload.nickname 只能填写一个最终显示昵称；多个别名请写进 IDENTITY.md，不要把别名串直接塞进 nickname。',
        '若要修改系统提示词，请放到 payload.contextFiles.SYSTEM_PROMPT；若要修改身份文件，请把对应文件内容放进 payload.contextFiles。',
        '创建智能体或整套重写身份文件时，你必须直接在 payload.contextFiles 或 payload.items[].contextFiles 中给出完整的 IDENTITY / SOUL / USER / MEMORY / TOOLS / AGENTS / BOOTSTRAP / HEARTBEAT 与 SYSTEM_PROMPT；不要依赖后续再调用模型生成。',
        '如果身份文件内容还没准备完整，就继续追问，不要输出确认卡。',
      ].join('\n'),
      color: '#d97706',
    },
  ];
}

async function seedDefaultAgents(homeDirOverride?: string): Promise<AgentProfile[]> {
  const { providerId, modelName } = await resolveDefaultModel(homeDirOverride);
  const seeds = getDefaultAgentSeeds();
  const profiles: AgentProfile[] = [];

  for (const seed of seeds) {
    const result = await saveAgentProfile({
      agentId: seed.agentId,
      name: seed.name,
      title: seed.title,
      tags: seed.tags,
      summary: seed.summary,
      soul: seed.soul,
      systemPrompt: seed.systemPrompt,
      privateSkills: [],
      sharedSkills: [],
      privateMcpServers: [],
      sharedMcpServers: [],
      teamMembers: [],
      defaultProviderId: providerId,
      defaultModelName: modelName,
      avatarUrl: seed.agentId === 'nuwa' ? DEFAULT_NUWA_AVATAR_URL : undefined,
      color: seed.color,
      homeDirOverride,
    });
    profiles.push(result.profile);
  }

  return profiles;
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function toAgentIndexItem(profile: AgentProfile): AgentIndexItem {
  return {
    agentId: profile.agentId,
    name: profile.name,
    title: profile.title,
    tags: profile.tags,
    summary: profile.summary,
    defaultProviderId: profile.defaultLlm.providerId,
    defaultModelName: profile.defaultLlm.modelName,
    profilePath: profile.paths.profilePath,
    agentRoot: profile.paths.agentRoot,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

async function readAgentsIndexFile(homeDirOverride?: string): Promise<AgentsIndexFile | undefined> {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const indexPath = path.join(shared.agentsRoot, AGENTS_INDEX_FILE);
  return readJsonFile<AgentsIndexFile>(indexPath);
}

async function writeAgentsIndexFile(
  agents: readonly AgentIndexItem[],
  homeDirOverride?: string,
): Promise<void> {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const indexPath = path.join(shared.agentsRoot, AGENTS_INDEX_FILE);

  const payload: AgentsIndexFile = {
    version: '1.0',
    updatedAt: new Date().toISOString(),
    agents,
  };

  await writeJsonFile(indexPath, payload);
}

async function upsertAgentsIndex(profile: AgentProfile, homeDirOverride?: string): Promise<void> {
  const current = await readAgentsIndexFile(homeDirOverride);
  const nextItem = toAgentIndexItem(profile);

  if (!current) {
    await writeAgentsIndexFile([nextItem], homeDirOverride);
    return;
  }

  const existed = current.agents.some((item) => item.agentId === profile.agentId);
  const nextAgents = existed
    ? current.agents.map((item) => (item.agentId === profile.agentId ? nextItem : item))
    : [...current.agents, nextItem];

  await writeAgentsIndexFile(nextAgents, homeDirOverride);
}

async function ensureProfileTeamData(
  profile: AgentProfile,
  profilePath: string,
): Promise<AgentProfile> {
  const teamRaw = (profile as unknown as { team?: { members?: readonly AgentTeamMember[] } }).team?.members;
  const normalizedTeam = normalizeTeamMembers(
    teamRaw,
    profile.defaultLlm.providerId,
    profile.defaultLlm.modelName,
  );

  const shouldBackfillDefaults = false;
  const nextTeam = shouldBackfillDefaults
    ? createDefaultTeamMembers(profile.defaultLlm.providerId, profile.defaultLlm.modelName)
    : normalizedTeam;

  const nextProfile: AgentProfile = {
    ...profile,
    team: {
      members: nextTeam,
    },
  };

  const currentSerialized = JSON.stringify((profile as unknown as { team?: unknown }).team ?? null);
  const nextSerialized = JSON.stringify(nextProfile.team);
  if (currentSerialized !== nextSerialized) {
    await writeJsonFile(profilePath, nextProfile);
  }

  return nextProfile;
}

export async function saveAgentProfile(input: SaveAgentInput): Promise<SaveAgentResult> {
  const agentId = resolveAgentId(input);
  const now = new Date().toISOString();
  const workspace = await ensureAgentWorkspace(agentId, input.homeDirOverride);
  const existingProfilePath = path.join(workspace.agentRoot, AGENT_PROFILE_FILE);
  const existing = await readJsonFile<AgentProfile>(existingProfilePath);
  const privateSkills = normalizeStringList(input.privateSkills);
  const privateMcpServers = normalizeStringList(input.privateMcpServers);
  const currentTeamMembers = (existing as unknown as { team?: { members?: readonly AgentTeamMember[] } })?.team?.members;
  const teamInput = input.teamMembers ?? currentTeamMembers;
  const teamMembers = normalizeTeamMembers(
    teamInput,
    input.defaultProviderId,
    input.defaultModelName,
  );

  const runtimeConfig = await buildAgentRuntimeConfig({
    agentId,
    displayName: input.name,
    providerId: input.defaultProviderId,
    modelName: input.defaultModelName,
    systemPrompt: input.systemPrompt,
    privateSkills,
    sharedSkills: [],
    privateMcpServers,
    sharedMcpServers: [],
    teamMembers,
    homeDirOverride: input.homeDirOverride,
  });

  const runtimeConfigPath = await writeAgentRuntimeConfigFile(runtimeConfig, input.homeDirOverride);
  const systemPromptPath = path.join(workspace.agentRoot, AGENT_PROMPT_FILE);
  await writeFile(systemPromptPath, input.systemPrompt, 'utf-8');

  const profile: AgentProfile = {
    version: '1.0',
    agentId,
    name: input.name,
    title: input.title,
    tags: input.tags,
    summary: input.summary,
    soul: input.soul,
    systemPrompt: input.systemPrompt,
    defaultLlm: {
      providerId: input.defaultProviderId,
      modelName: input.defaultModelName,
    },
    skills: {
      privateSkills,
      // 统一使用全局技能池，智能体仅记录启用列表；shared 字段保留兼容。
      sharedSkills: [],
    },
    mcp: {
      privateServers: privateMcpServers,
      // 统一使用全局 MCP 池，智能体仅记录启用列表；shared 字段保留兼容。
      sharedServers: [],
    },
    team: {
      members: teamMembers,
    },
    appearance: {
      avatarUrl: input.avatarUrl,
      color: input.color,
    },
    voice: {
      ttsModel: input.ttsModel,
      ttsVoice: input.ttsVoice,
      ttsSpeed: input.ttsSpeed,
      ttsPitch: input.ttsPitch,
    },
    paths: {
      agentRoot: workspace.agentRoot,
      privateSkillsRoot: workspace.privateSkillsRoot,
      privateMcpRoot: workspace.privateMcpRoot,
      privateMemoryRoot: workspace.privateMemoryRoot,
      privateDataRoot: workspace.privateDataRoot,
      privateLogsRoot: workspace.privateLogsRoot,
      profilePath: existingProfilePath,
      runtimeConfigPath,
      systemPromptPath,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await writeJsonFile(existingProfilePath, profile);
  await upsertAgentsIndex(profile, input.homeDirOverride);

  return {
    profile,
    runtimeConfig,
  };
}

export async function getAgentProfile(input: GetAgentInput): Promise<AgentProfile> {
  const workspace = await ensureAgentWorkspace(input.agentId, input.homeDirOverride);
  const profilePath = path.join(workspace.agentRoot, AGENT_PROFILE_FILE);
  const profile = await readJsonFile<AgentProfile>(profilePath);

  if (!profile) {
    throw new Error(`智能体不存在：${input.agentId}`);
  }

  return ensureProfileTeamData(profile, profilePath);
}

async function scanAgentProfiles(homeDirOverride?: string): Promise<AgentProfile[]> {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const dirs = await readdir(shared.agentsRoot, { withFileTypes: true });
  const profiles: AgentProfile[] = [];

  for (const entry of dirs) {
    if (!entry.isDirectory()) {
      continue;
    }

    const profilePath = path.join(shared.agentsRoot, entry.name, AGENT_PROFILE_FILE);
    const profile = await readJsonFile<AgentProfile>(profilePath);

    if (profile) {
      profiles.push(await ensureProfileTeamData(profile, profilePath));
    }
  }

  return profiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listAgentProfiles(input?: ListAgentsInput): Promise<readonly AgentProfile[]> {
  const index = await readAgentsIndexFile(input?.homeDirOverride);

  if (!index || index.agents.length === 0) {
    const scanned = await scanAgentProfiles(input?.homeDirOverride);
    if (scanned.length > 0) {
      return scanned;
    }

    return seedDefaultAgents(input?.homeDirOverride);
  }

  const profiles: AgentProfile[] = [];

  for (const item of index.agents) {
    const profile = await readJsonFile<AgentProfile>(item.profilePath);

    if (profile) {
      profiles.push(await ensureProfileTeamData(profile, item.profilePath));
    }
  }

  if (profiles.length === 0) {
    const scanned = await scanAgentProfiles(input?.homeDirOverride);
    if (scanned.length > 0) {
      return scanned;
    }

    return seedDefaultAgents(input?.homeDirOverride);
  }

  return profiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
