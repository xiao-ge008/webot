import {
  createAgentFromManifest,
  deleteManagementAgent,
  listManagementAgents,
  listManagementModels,
  patchManagementAgentConfig,
  setManagementAgentContextFile,
  setManagementAgentWorkspaces,
  updateManagementAgentModel,
  type DeleteManagementAgentMode,
  type ManagementContextFileName,
  type ManagementModelOption,
  type ManagementAgentSummary,
} from '@/services/management-client';

export type AgentManagementMode = 'create' | 'update' | 'delete';

export interface AgentManagementPayload {
  mode?: AgentManagementMode;
  agentId?: string;
  targetName?: string;
  englishName?: string;
  nickname?: string;
  description?: string;
  tags?: string[];
  workspaces?: string[];
  deleteMode?: DeleteManagementAgentMode;
  rewriteContextFiles?: boolean;
  contextFiles?: Partial<Record<AgentContextKey, string>>;
}

export interface AgentManagementResult {
  mode: AgentManagementMode;
  agentId: string;
  displayName: string;
  summary: string;
}

type AgentContextKey = ManagementContextFileName | 'SYSTEM_PROMPT';

interface AgentIdentityBundle {
  systemPrompt: string;
  contextFiles: Partial<Record<ManagementContextFileName, string>>;
}

const CONTEXT_FILE_NAMES: ManagementContextFileName[] = [
  'IDENTITY.md',
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
  'TOOLS.md',
  'AGENTS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
];

function normalizeMode(value: unknown): AgentManagementMode {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'update' || raw === 'edit' || raw === 'modify') return 'update';
  if (raw === 'delete' || raw === 'remove') return 'delete';
  return 'create';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean)));
}

function normalizeWorkspaces(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const normalized = raw.map((item) => normalizeText(item)).filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeEnglishName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildTimestampSuffix(): string {
  return Date.now().toString(36).slice(-6);
}

function ensureUniqueEnglishName(raw: string, agents: ManagementAgentSummary[]): string {
  const base = normalizeEnglishName(raw) || `agent-${buildTimestampSuffix()}`;
  const used = new Set(
    agents
      .map((item) => normalizeEnglishName(item.english_name || item.id || item.name || ''))
      .filter(Boolean),
  );
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function buildAgentManifestToml(input: {
  name: string;
  description: string;
  tags: string[];
  provider: string;
  model: string;
  systemPrompt: string;
}): string {
  const safePrompt = input.systemPrompt.trim() || 'You are a helpful AI agent.';
  const lines = [
    `name = "${escapeTomlString(input.name)}"`,
    `description = "${escapeTomlString(input.description)}"`,
    'profile = "full"',
    '',
    '[model]',
    `provider = "${escapeTomlString(input.provider)}"`,
    `model = "${escapeTomlString(input.model)}"`,
    `system_prompt = "${escapeTomlString(safePrompt)}"`,
  ];
  if (input.tags.length > 0) {
    lines.push('', `tags = [${input.tags.map((tag) => `"${escapeTomlString(tag)}"`).join(', ')}]`);
  }
  return lines.join('\n');
}

function pickPreferredModel(models: ManagementModelOption[]): ManagementModelOption | undefined {
  const enabled = models.filter((item) => item.enabled && item.available);
  const pool = enabled.length > 0 ? enabled : models;
  return pool.find((item) => item.isDefault) ?? pool[0];
}

function buildIdentityBundle(input: {
  displayName: string;
  englishName: string;
  description: string;
  tags: string[];
}): AgentIdentityBundle {
  const displayName = input.displayName || '未命名智能体';
  const description = input.description || '通用创作与协作型智能体';
  const tagLine = input.tags.length > 0 ? input.tags.join(' / ') : '通用助手';

  return {
    systemPrompt: [
      `你是「${displayName}」。`,
      `你的核心定位是：${description}。`,
      '默认先理解用户目标，再给出结构化、可执行的回应。',
      '遇到信息不足时先补齐关键上下文，不编造事实。',
    ].join('\n'),
    contextFiles: {
      'IDENTITY.md': [
        `- name: ${displayName}`,
        '- archetype: creator',
        '- vibe: intentional',
        '- avatar_url:',
        '- greeting_style: concise',
        '- color: #d97706',
        '',
        '## 身份概述',
        `- 英文名称：${input.englishName}`,
        `- 角色定位：${description}`,
        `- 能力标签：${tagLine}`,
        '- 核心目标：围绕用户目标持续输出可执行结果。',
      ].join('\n'),
      'SOUL.md': [
        '## 核心人格',
        '- 先落地，再展开。',
        '- 先判断风险，再执行。',
        '- 不编造、不敷衍，必要时明确说明缺失信息。',
      ].join('\n'),
      'USER.md': [
        '## 用户关系',
        '- relation: 长期协作伙伴',
        '- user_address:',
        '- tone_preference: 简洁、清晰、可执行',
      ].join('\n'),
      'MEMORY.md': [
        '## 记忆策略',
        '- 记录用户的长期目标、内容风格、禁忌与验收标准。',
        '- 对过期信息做降权，不让旧规则覆盖新要求。',
      ].join('\n'),
      'TOOLS.md': [
        '## 工具调用协议',
        '- 能用工具确认的事实，优先调用工具。',
        '- 多步骤操作尽量合并执行，减少往返。',
        '- 失败时保留上下文并给出回退方案。',
      ].join('\n'),
      'AGENTS.md': [
        '## 多智能体协作',
        '- 复杂任务先拆角色，再汇总结果。',
        '- 汇总时统一口径，避免重复和冲突。',
      ].join('\n'),
      'BOOTSTRAP.md': [
        '## 首次会话流程',
        '1. 确认用户的目标、对象与边界。',
        '2. 复述你将承担的角色与交付方式。',
        '3. 给出第一个可执行动作并立即开始。',
      ].join('\n'),
      'HEARTBEAT.md': [
        '## 周期巡检',
        '- 检查是否仍遵循最新用户偏好。',
        '- 检查是否有可复用的模板、规范或知识。',
        '- 检查下一步是否可以继续推进。',
      ].join('\n'),
    },
  };
}

function mergeContextFiles(
  generated: AgentIdentityBundle,
  custom?: Partial<Record<AgentContextKey, string>>,
): AgentIdentityBundle {
  const next: AgentIdentityBundle = {
    systemPrompt: normalizeText(custom?.SYSTEM_PROMPT) || generated.systemPrompt,
    contextFiles: { ...generated.contextFiles },
  };
  for (const fileName of CONTEXT_FILE_NAMES) {
    const customValue = normalizeText(custom?.[fileName]);
    if (customValue) {
      next.contextFiles[fileName] = customValue;
    }
  }
  return next;
}

async function resolveTargetAgent(payload: AgentManagementPayload): Promise<ManagementAgentSummary> {
  const agents = await listManagementAgents();
  const explicitId = normalizeText(payload.agentId);
  if (explicitId) {
    const direct = agents.find((item) => item.id === explicitId);
    if (direct) return direct;
  }
  const candidate = [payload.targetName, payload.nickname, payload.englishName]
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean);
  const matched = agents.find((item) => {
    const aliases = [item.id, item.name, item.nickname, item.english_name]
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean);
    return candidate.some((value) => aliases.includes(value));
  });
  if (!matched) {
    throw new Error('未找到目标智能体，请在确认卡片中补充正确的智能体 ID 或名称');
  }
  return matched;
}

async function resolveDefaultModel(): Promise<ManagementModelOption> {
  const loaded = await listManagementModels();
  const picked = pickPreferredModel(loaded.models);
  if (!picked) {
    throw new Error('未找到可用默认模型，请先在设置里配置默认模型');
  }
  return picked;
}

export async function executeAgentManagementAction(rawPayload: unknown): Promise<AgentManagementResult> {
  const payload = (rawPayload && typeof rawPayload === 'object') ? rawPayload as AgentManagementPayload : {};
  const mode = normalizeMode(payload.mode);

  if (mode === 'delete') {
    const target = await resolveTargetAgent(payload);
    await deleteManagementAgent(target.id, payload.deleteMode === 'local_only' ? 'local_only' : 'purge');
    return {
      mode,
      agentId: target.id,
      displayName: target.nickname?.trim() || target.name || target.id,
      summary: `已删除智能体「${target.nickname?.trim() || target.name || target.id}」`,
    };
  }

  const agents = await listManagementAgents();
  const model = await resolveDefaultModel();
  const requestedDisplayName = normalizeText(payload.nickname) || normalizeText(payload.targetName) || '新智能体';
  const requestedDescription = normalizeText(payload.description);
  const tags = normalizeTags(payload.tags);
  const workspaces = normalizeWorkspaces(payload.workspaces);
  const hasExplicitWorkspaces = Array.isArray(payload.workspaces);
  const rewriteContextFiles = payload.rewriteContextFiles !== false;

  if (mode === 'create') {
    const englishName = ensureUniqueEnglishName(normalizeText(payload.englishName), agents);
    const description = requestedDescription || '通用创作型智能体';
    const generated = buildIdentityBundle({
      displayName: requestedDisplayName,
      englishName,
      description,
      tags,
    });
    const bundle = mergeContextFiles(generated, payload.contextFiles);
    const manifestToml = buildAgentManifestToml({
      name: englishName,
      description,
      tags,
      provider: model.providerId,
      model: model.modelName,
      systemPrompt: bundle.systemPrompt,
    });

    const created = await createAgentFromManifest(manifestToml);
    await updateManagementAgentModel(created.agentId, {
      provider: model.providerId,
      model: model.modelName,
    });
    await patchManagementAgentConfig(created.agentId, {
      english_name: englishName,
      nickname: requestedDisplayName,
      description,
      tags,
      system_prompt: bundle.systemPrompt,
    });
    for (const fileName of CONTEXT_FILE_NAMES) {
      const content = normalizeText(bundle.contextFiles[fileName]);
      if (content) {
        await setManagementAgentContextFile(created.agentId, fileName, content);
      }
    }
    if (hasExplicitWorkspaces) {
      await setManagementAgentWorkspaces(created.agentId, workspaces);
    }

    return {
      mode,
      agentId: created.agentId,
      displayName: requestedDisplayName,
      summary: `已创建智能体「${requestedDisplayName}」，已生成人格文件、基础工作区并绑定默认模型`,
    };
  }

  const target = await resolveTargetAgent(payload);
  const description = requestedDescription || normalizeText(target.description) || '通用创作型智能体';
  const nextDisplayName = requestedDisplayName || target.nickname?.trim() || target.name || target.id;
  const nextEnglishName = normalizeText(target.english_name) || target.id;
  const generated = buildIdentityBundle({
    displayName: nextDisplayName,
    englishName: nextEnglishName,
    description,
    tags: tags.length > 0 ? tags : (target.tags || []),
  });
  const bundle = mergeContextFiles(generated, payload.contextFiles);

  await patchManagementAgentConfig(target.id, {
    nickname: nextDisplayName,
    description,
    tags: tags.length > 0 ? tags : target.tags,
    system_prompt: bundle.systemPrompt,
  });
  if (rewriteContextFiles) {
    for (const fileName of CONTEXT_FILE_NAMES) {
      const content = normalizeText(bundle.contextFiles[fileName]);
      if (content) {
        await setManagementAgentContextFile(target.id, fileName, content);
      }
    }
  }
  if (hasExplicitWorkspaces) {
    await setManagementAgentWorkspaces(target.id, workspaces);
  }

  return {
    mode,
    agentId: target.id,
    displayName: nextDisplayName,
    summary: `已更新智能体「${nextDisplayName}」的基础信息、人格文件与工作区权限`,
  };
}
