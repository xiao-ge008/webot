import {
  createAgentFromManifest,
  getManagementAgentContextFiles,
  getManagementAgentDetail,
  listManagementAgents,
  listManagementModels,
  patchManagementAgentConfig,
  setManagementAgentContextFile,
  setManagementAgentWorkspaces,
  uploadManagementAgentAvatar,
  uploadManagementAgentPortrait,
  updateManagementAgentModel,
  type AgentConfigPatchInput,
  type ManagementContextFileName,
  type ManagementModelOption,
  type ManagementAgentSummary,
} from '@/services/management-client';

export type AgentManagementMode = 'create' | 'update' | 'delete';

export interface AgentManagementPayload {
  mode?: AgentManagementMode;
  agentId?: string;
  name?: string;
  targetName?: string;
  englishName?: string;
  nickname?: string;
  description?: string;
  tags?: string[];
  workspaces?: string[];
  provider?: string;
  model?: string;
  avatarUrl?: string;
  portraitUrl?: string;
  color?: string;
  rewriteContextFiles?: boolean;
  contextFiles?: Partial<Record<AgentContextKey, string>>;
  items?: unknown[];
  agents?: unknown[];
}

export interface AgentManagementResult {
  mode: AgentManagementMode;
  agentId: string;
  displayName: string;
  summary: string;
}

export interface AgentManagementProgressEvent {
  progressPercent?: number;
  title: string;
  detail?: string;
}

interface ExecuteAgentManagementOptions {
  onProgress?: (event: AgentManagementProgressEvent) => void;
}

type AgentContextKey = ManagementContextFileName | 'SYSTEM_PROMPT';

interface AgentIdentityBundle {
  systemPrompt: string;
  contextFiles: Partial<Record<ManagementContextFileName, string>>;
}

export interface AgentIdentityBundleInput {
  displayName: string;
  englishName: string;
  description: string;
  tags: string[];
  workspaces?: string[];
  provider?: string;
  model?: string;
  aliases?: string[];
  persona?: string;
  worldview?: string;
  serviceTarget?: string;
  guardrails?: string;
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

const LOCAL_MANAGEMENT_ASSET_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/api\/management\/agents\/.+)$/i;

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

function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function splitAliases(value: unknown): string[] {
  const text = normalizeText(value);
  if (!text) return [];
  return Array.from(new Set(
    text
      .split(/[\/|、，,；;\n]+/g)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function normalizeDisplayNickname(value: unknown): string {
  const aliases = splitAliases(value);
  return aliases[0] || normalizeText(value);
}

function isManagedAssetForAgent(agentId: string, rawUrl: string): boolean {
  const normalizedAgentId = encodeURIComponent(agentId);
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith(`/api/management/agents/${normalizedAgentId}/`)) {
    return true;
  }
  const localMatch = trimmed.match(LOCAL_MANAGEMENT_ASSET_PATTERN);
  return Boolean(localMatch?.[1]?.startsWith(`/api/management/agents/${normalizedAgentId}/`));
}

function inferAssetFilename(rawUrl: string, fallbackBaseName: 'avatar' | 'portrait', mimeType: string): string {
  const cleaned = rawUrl.split('#')[0]?.split('?')[0] ?? '';
  const lastSegment = cleaned.split('/').filter(Boolean).pop() ?? '';
  if (lastSegment && /\.[a-z0-9]+$/i.test(lastSegment)) {
    return lastSegment;
  }
  const extension = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('jpeg') || mimeType.includes('jpg')
      ? 'jpg'
      : mimeType.includes('webp')
        ? 'webp'
        : 'bin';
  return `${fallbackBaseName}.${extension}`;
}

async function materializeManagedAsset(
  agentId: string,
  rawUrl: string | undefined,
  kind: 'avatar' | 'portrait',
): Promise<string | undefined> {
  const source = rawUrl?.trim();
  if (!source) {
    return undefined;
  }
  if (isManagedAssetForAgent(agentId, source)) {
    return source;
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`下载${kind === 'avatar' ? '头像' : '立绘'}失败：HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const file = new File(
    [blob],
    inferAssetFilename(source, kind, blob.type || ''),
    { type: blob.type || (kind === 'avatar' ? 'image/png' : 'image/png') },
  );
  if (kind === 'avatar') {
    const uploaded = await uploadManagementAgentAvatar(agentId, file);
    return uploaded.avatarUrl;
  }
  const uploaded = await uploadManagementAgentPortrait(agentId, file);
  return uploaded.portraitUrl;
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

export function buildIdentityBundle(input: AgentIdentityBundleInput): AgentIdentityBundle {
  const displayName = normalizeDisplayNickname(input.displayName || '未命名智能体');
  const englishName = normalizeEnglishName(input.englishName || displayName || 'agent');
  const description = normalizeText(input.description) || '围绕用户目标提供长期陪伴、创作和执行支持的专属智能体';
  const tags = input.tags.length > 0 ? input.tags : ['专属助手'];
  const tagLine = tags.join(' / ');
  const aliases = Array.from(new Set([displayName, ...(input.aliases || []).map((item) => normalizeText(item)).filter(Boolean)]));
  const worldview = normalizeText(input.worldview)
    || (tags.some((item) => item.includes('学院')) ? '现代学院与角色扮演并存的日常世界' : '以用户当前生活和任务场景为中心的现实世界');
  const serviceTarget = normalizeText(input.serviceTarget) || '主人';
  const persona = normalizeText(input.persona)
    || (tags.some((item) => item.includes('姐姐')) ? '成熟稳重、温柔克制、会主动照顾节奏'
      : tags.some((item) => item.includes('妹妹')) ? '轻盈亲近、反应灵动、善于提供情绪价值'
        : '稳定、清晰、主动推进，不拖泥带水');
  const guardrails = normalizeText(input.guardrails) || '避免空泛模板、避免自相矛盾、避免脱离设定胡乱发挥，始终围绕用户当前目标推进。';
  const workspaceLine = input.workspaces && input.workspaces.length > 0 ? input.workspaces.join(' / ') : englishName;
  const modelLine = input.provider && input.model ? `${input.provider}/${input.model}` : '继承当前已确认模型';

  return {
    systemPrompt: [
      `你是「${displayName}」；英文工作区名是「${englishName}」。`,
      `你的身份定位：${description}。`,
      `你的主要人格与语气：${persona}。`,
      `你的世界观：${worldview}。`,
      `你的服务对象是：${serviceTarget}。`,
      '回答时必须先贴合当前身份，再输出自然、稳定、可持续的互动内容。',
      '遇到信息不足时先补最关键的一点，不编造硬事实，不跳出设定。',
      `执行边界：${guardrails}`,
    ].join('\n'),
    contextFiles: {
      'IDENTITY.md': [
        '# IDENTITY.md',
        '',
        '## 名片',
        `- 显示昵称：${displayName}`,
        `- 英文名称：${englishName}`,
        `- 别名：${aliases.join(' / ')}`,
        `- 角色简介：${description}`,
        `- 关键词：${tagLine}`,
        `- 服务对象：${serviceTarget}`,
        `- 工作区目录：${workspaceLine}`,
        '',
        '## 形象与气质',
        `- 外在气质：${persona}`,
        '- 第一印象：让用户一开口就能感到你有明确身份，而不是泛化模板助手。',
        '- 交流方式：优先用自然口语组织内容，必要时再切成结构化要点。',
        '',
        '## 角色目标',
        '- 让用户在与你交互时，持续感到设定稳定、口吻统一、行动有推进。',
        '- 任何回答都不能只剩抽象原则，必须落到当前场景、当前对象、当前动作。',
      ].join('\n'),
      'SOUL.md': [
        '# SOUL.md',
        '',
        '## 核心人格',
        `- 人格底色：${persona}`,
        '- 价值取向：先理解用户真实意图，再用符合身份的方式回应，不做空洞说教。',
        '- 回应风格：自然、稳定、持续在线；该温柔时温柔，该利落时利落。',
        '',
        '## 世界观',
        `- 你的默认世界观是：${worldview}`,
        '- 你要把世界观落到措辞、称呼、习惯动作与场景细节里，而不是只在设定文件里出现一次。',
        '',
        '## 行为原则',
        '- 不要突然失忆式换人设，不要前后口吻飘忽。',
        '- 不要把用户已经确认过的昵称、关系、边界重新问一遍。',
        `- 硬边界：${guardrails}`,
      ].join('\n'),
      'USER.md': [
        '# USER.md',
        '',
        '## 服务对象',
        `- 默认服务对象：${serviceTarget}`,
        '- 你要把用户当作长期互动对象，而不是一次性问答请求。',
        '- 你需要主动适配用户已经确认的称呼、节奏、喜好与禁忌。',
        '',
        '## 偏好理解',
        '- 用户更在意角色稳定性、设定完整度、称呼准确度与执行结果是否真正落盘。',
        '- 如果用户明确指定了昵称、英文名、工作区、标签、世界观或边界，后续必须持续沿用。',
        '- 若用户要求修改设定，优先明确变更点，再局部更新，不要把整个人设洗回模板。',
      ].join('\n'),
      'MEMORY.md': [
        '# MEMORY.md',
        '',
        '## 长期记忆策略',
        '- 记录用户确认过的昵称、身份关系、常用称呼、核心世界观、禁忌与验收标准。',
        '- 记录重要决策：为什么这样设定、哪些内容被用户否决、哪些表达最符合角色。',
        '- 当新信息与旧信息冲突时，以最新明确确认为准，并标记旧信息失效。',
        '',
        '## 决策备忘',
        `- 当前角色：${displayName} / ${englishName}`,
        `- 当前定位：${description}`,
        `- 当前标签：${tagLine}`,
      ].join('\n'),
      'TOOLS.md': [
        '# TOOLS.md',
        '',
        '## 工具使用原则',
        '- 能直接确认事实时优先查证，不能确认时明确说明不确定点。',
        '- 调用工具的目标是为当前任务服务，不为了展示工具而调用工具。',
        '- 输出给用户前先整理结果，避免原始工具噪音直接暴露。',
        '',
        '## 本地环境约束',
        `- 当前默认模型：${modelLine}`,
        `- 当前工作区：${workspaceLine}`,
        '- 写文件时要保证内容完整、名称准确、路径正确，不得写成空模板。',
      ].join('\n'),
      'AGENTS.md': [
        '# AGENTS.md',
        '',
        '## 协作方式',
        '- 多智能体场景下，先分清自己负责的角色边界，再决定是否需要协作。',
        '- 若存在同系列角色，要保持人设差异，不要把多个角色写成同一份模板。',
        '- 协作输出时统一口径，但保留各自语气与职责差异。',
        '',
        '## 对外承诺',
        '- 自己能完成的内容就直接给结果。',
        '- 需要他人配合时，先说明需要什么信息、为什么需要、交付后会得到什么。',
      ].join('\n'),
      'BOOTSTRAP.md': [
        '# BOOTSTRAP.md',
        '',
        '## 首次会话流程',
        '1. 先用符合身份的方式打招呼，并确认当前用户想推进的主题。',
        `2. 用一句话把自己的角色定位说清：${description}`,
        '3. 若用户目标明确，直接进入执行；若仍缺关键信息，只追问 1 到 2 个最必要项。',
        '4. 第一轮回答必须给用户一个可继续的抓手，例如方案、提纲、下一步动作或确认项。',
      ].join('\n'),
      'HEARTBEAT.md': [
        '# HEARTBEAT.md',
        '',
        '## 周期巡检清单',
        '- 检查当前回应是否还符合既定昵称、语气、关系和世界观。',
        '- 检查是否出现模板味、空话过多、角色细节缺失的问题。',
        '- 检查是否忘记沿用用户最近一次确认的约束与偏好。',
        '- 检查输出是否真正能推动当前目标，而不是只做形式化回应。',
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

function pickExplicitContextFiles(
  input: Partial<Record<AgentContextKey, string>> | undefined,
): Partial<Record<ManagementContextFileName, string>> {
  if (!input) {
    return {};
  }

  const output: Partial<Record<ManagementContextFileName, string>> = {};
  for (const fileName of CONTEXT_FILE_NAMES) {
    const value = normalizeText(input[fileName]);
    if (value) {
      output[fileName] = value;
    }
  }
  return output;
}

function countContextFiles(files: Partial<Record<ManagementContextFileName, string>>): number {
  return CONTEXT_FILE_NAMES.filter((fileName) => Boolean(normalizeText(files[fileName]))).length;
}


interface NormalizedAgentBatchItem {
  mode: AgentManagementMode;
  agentId?: string;
  name?: string;
  targetName?: string;
  englishName?: string;
  nickname?: string;
  description?: string;
  tags?: string[];
  workspaces?: string[];
  provider?: string;
  model?: string;
  avatarUrl?: string;
  portraitUrl?: string;
  color?: string;
  rewriteContextFiles?: boolean;
  contextFiles?: Partial<Record<AgentContextKey, string>>;
}

function normalizeBatchItems(payload: AgentManagementPayload): NormalizedAgentBatchItem[] {
  const source = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.agents)
      ? payload.agents
      : [];
  return source.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const raw = item as Record<string, unknown>;
    const normalized: NormalizedAgentBatchItem = {
      mode: normalizeMode(raw.mode ?? payload.mode),
      agentId: normalizeOptionalText(raw.agentId),
      name: normalizeOptionalText(raw.name),
      targetName: normalizeOptionalText(raw.targetName),
      englishName: normalizeOptionalText(raw.englishName ?? raw.english_name ?? raw.englishNickname ?? raw.english_nickname),
      nickname: normalizeOptionalText(raw.nickname ?? raw.displayName ?? raw.display_name),
      description: normalizeOptionalText(raw.description ?? raw.summary),
      tags: Array.isArray(raw.tags) ? normalizeTags(raw.tags) : undefined,
      workspaces: Array.isArray(raw.workspaces) ? normalizeWorkspaces(raw.workspaces) : undefined,
      provider: normalizeOptionalText(raw.provider),
      model: normalizeOptionalText(raw.model),
      avatarUrl: normalizeOptionalText(raw.avatarUrl ?? raw.avatar_url),
      portraitUrl: normalizeOptionalText(raw.portraitUrl ?? raw.portrait_url),
      color: normalizeOptionalText(raw.color),
      rewriteContextFiles: raw.rewriteContextFiles === true || payload.rewriteContextFiles === true,
      contextFiles: (raw.contextFiles && typeof raw.contextFiles === 'object')
        ? raw.contextFiles as Partial<Record<AgentContextKey, string>>
        : undefined,
    };
    return [normalized];
  });
}

function buildCreateSummary(input: {
  displayName: string;
  agentId: string;
  contextFileCount: number;
  workspacesChanged: boolean;
}): string {
  const segments = [`已创建智能体「${input.displayName}」`];
  segments.push(`ID：${input.agentId}`);
  segments.push(`已写入 ${Math.max(input.contextFileCount, CONTEXT_FILE_NAMES.length)} 份身份文件`);
  if (input.workspacesChanged) {
    segments.push('已同步工作区权限');
  }
  return segments.join('，');
}

function buildUpdateSummary(input: {
  displayName: string;
  changedFields: string[];
  changedFiles: string[];
  workspacesChanged: boolean;
  modelChanged: boolean;
}): string {
  const segments = [`已更新智能体「${input.displayName}」`];
  if (input.changedFields.length > 0) {
    segments.push(`属性：${input.changedFields.join(' / ')}`);
  }
  if (input.modelChanged) {
    segments.push('模型配置已同步');
  }
  if (input.changedFiles.length > 0) {
    segments.push(`身份文件：${input.changedFiles.join(' / ')}`);
  }
  if (input.workspacesChanged) {
    segments.push('工作区权限已同步');
  }
  return segments.join('，');
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

export async function executeAgentManagementAction(
  rawPayload: unknown,
  options?: ExecuteAgentManagementOptions,
): Promise<AgentManagementResult> {
  const payload = (rawPayload && typeof rawPayload === 'object') ? rawPayload as AgentManagementPayload : {};
  const mode = normalizeMode(payload.mode);
  const batchItems = normalizeBatchItems(payload);
  const reportProgress = (event: AgentManagementProgressEvent) => {
    options?.onProgress?.(event);
  };

  if (mode === 'delete') {
    throw new Error('女娲不能执行删除操作；如需删除智能体，请让用户到界面 UI 中手动删除。');
  }

  if (batchItems.length > 0) {
    if (mode !== 'create' && batchItems.some((item) => item.mode === 'create')) {
      throw new Error('当前确认卡包含多个创建项，必须使用 create 模式执行。');
    }
    const results: AgentManagementResult[] = [];
    for (const item of batchItems) {
      reportProgress({
        progressPercent: 8 + Math.floor((results.length / Math.max(1, batchItems.length)) * 12),
        title: `准备处理第 ${results.length + 1} 项`,
        detail: item.nickname || item.name || item.targetName || item.agentId || '未命名智能体',
      });
      const childPayload: AgentManagementPayload = {
        mode: item.mode,
        agentId: item.agentId,
        name: item.name || item.targetName || item.nickname,
        targetName: item.targetName || item.name || item.nickname,
        englishName: item.englishName,
        nickname: item.nickname || item.name || item.targetName,
        description: item.description,
        tags: item.tags,
        workspaces: item.workspaces,
        provider: item.provider ?? payload.provider,
        model: item.model ?? payload.model,
        avatarUrl: item.avatarUrl ?? payload.avatarUrl,
        portraitUrl: item.portraitUrl ?? payload.portraitUrl,
        color: item.color ?? payload.color,
        rewriteContextFiles: item.rewriteContextFiles,
        contextFiles: item.contextFiles,
      };
      results.push(await executeAgentManagementAction(childPayload, options));
    }
    return {
      mode: 'create',
      agentId: results.map((item) => item.agentId).join(', '),
      displayName: `共 ${results.length} 个智能体`,
      summary: results.map((item) => item.summary).join('\n'),
    };
  }

  const agents = await listManagementAgents();
  const defaultModel = await resolveDefaultModel();
  const explicitName = normalizeText(payload.name);
  const explicitTargetName = normalizeText(payload.targetName);
  const explicitNickname = normalizeDisplayNickname(payload.nickname);
  const explicitEnglishName = normalizeText(payload.englishName);
  const requestedDescription = normalizeText(payload.description);
  const tags = normalizeTags(payload.tags);
  const workspaces = normalizeWorkspaces(payload.workspaces);
  const hasExplicitWorkspaces = Array.isArray(payload.workspaces);
  const requestedProvider = normalizeText(payload.provider);
  const requestedModel = normalizeText(payload.model);
  const requestedAvatarUrl = normalizeOptionalText(payload.avatarUrl);
  const requestedPortraitUrl = normalizeOptionalText(payload.portraitUrl);
  const requestedColor = normalizeOptionalText(payload.color);
  const explicitContextFiles = pickExplicitContextFiles(payload.contextFiles);
  const explicitSystemPrompt = normalizeText(payload.contextFiles?.SYSTEM_PROMPT);
  const shouldRewriteAllContextFiles = payload.rewriteContextFiles === true;

  if (requestedProvider && !requestedModel) {
    throw new Error('设置模型时必须同时提供 provider 和 model。');
  }

  if (mode === 'create') {
    reportProgress({
      progressPercent: 12,
      title: '正在校验创建参数',
      detail: explicitNickname || explicitTargetName || explicitName || '新智能体',
    });
    const requestedDisplayName = explicitNickname || explicitTargetName || explicitName || '新智能体';
    if (!explicitEnglishName) {
      throw new Error('创建智能体时必须明确提供英文名称，不能再退回随机名称。');
    }
    if (!normalizeText(explicitNickname || explicitTargetName || explicitName)) {
      throw new Error('创建智能体时必须明确提供显示昵称或名称。');
    }
    const englishName = ensureUniqueEnglishName(explicitEnglishName, agents);
    const description = requestedDescription || '通用创作型智能体';
    const selectedModel = requestedModel
      ? { providerId: requestedProvider || defaultModel.providerId, modelName: requestedModel }
      : { providerId: defaultModel.providerId, modelName: defaultModel.modelName };
    const generated = buildIdentityBundle({
      displayName: requestedDisplayName,
      englishName,
      description,
      tags,
      workspaces,
      provider: selectedModel.providerId,
      model: selectedModel.modelName,
      aliases: splitAliases(payload.nickname),
    });
    const bundle = mergeContextFiles(generated, payload.contextFiles);
    const manifestToml = buildAgentManifestToml({
      name: englishName,
      description,
      tags,
      provider: selectedModel.providerId,
      model: selectedModel.modelName,
      systemPrompt: bundle.systemPrompt,
    });

    reportProgress({
      progressPercent: 30,
      title: '正在创建智能体基础档案',
      detail: `${requestedDisplayName} / ${englishName}`,
    });
    const created = await createAgentFromManifest(manifestToml);
    reportProgress({
      progressPercent: 50,
      title: '正在同步头像、模型与配置',
      detail: created.agentId,
    });
    const materializedAvatarUrl = await materializeManagedAsset(created.agentId, requestedAvatarUrl, 'avatar');
    const materializedPortraitUrl = await materializeManagedAsset(created.agentId, requestedPortraitUrl, 'portrait');
    await updateManagementAgentModel(created.agentId, {
      provider: selectedModel.providerId,
      model: selectedModel.modelName,
    });
    await patchManagementAgentConfig(created.agentId, {
      name: explicitName || undefined,
      english_name: englishName,
      nickname: requestedDisplayName,
      description,
      tags,
      system_prompt: bundle.systemPrompt,
      avatar_url: materializedAvatarUrl,
      portrait_url: materializedPortraitUrl,
      color: requestedColor,
    });
    if (hasExplicitWorkspaces) {
      await setManagementAgentWorkspaces(created.agentId, workspaces);
    }
    reportProgress({
      progressPercent: 72,
      title: '正在写入上下文文件',
      detail: `${countContextFiles(bundle.contextFiles)} 个文件`,
    });
    for (const fileName of CONTEXT_FILE_NAMES) {
      const content = normalizeText(bundle.contextFiles[fileName]);
      if (content) {
        await setManagementAgentContextFile(created.agentId, fileName, content);
      }
    }
    reportProgress({
      progressPercent: 100,
      title: '智能体创建完成',
      detail: `${requestedDisplayName} (${created.agentId})`,
    });

    return {
      mode,
      agentId: created.agentId,
      displayName: requestedDisplayName,
      summary: buildCreateSummary({
        displayName: requestedDisplayName,
        agentId: created.agentId,
        contextFileCount: countContextFiles(bundle.contextFiles),
        workspacesChanged: hasExplicitWorkspaces,
      }),
    };
  }

  reportProgress({
    progressPercent: 15,
    title: '正在读取智能体当前配置',
    detail: payload.agentId || explicitTargetName || explicitName || '目标智能体',
  });
  const target = await resolveTargetAgent(payload);
  const detail = await getManagementAgentDetail(target.id);
  const contextFiles = (shouldRewriteAllContextFiles || countContextFiles(explicitContextFiles) > 0)
    ? await getManagementAgentContextFiles(target.id)
    : [];
  const existingContextFileMap = new Map(contextFiles.map((item) => [item.name, item.content]));
  const nextDisplayName = explicitNickname || explicitTargetName || detail.nickname?.trim() || detail.name || target.id;
  const nextEnglishName = explicitEnglishName
    ? normalizeEnglishName(explicitEnglishName)
    : normalizeText(detail.english_name) || target.id;
  const nextDescription = requestedDescription || normalizeText(detail.description) || '通用创作型智能体';
  const nextTags = Array.isArray(payload.tags) ? tags : (detail.tags || []);
  const rewrittenBundle = buildIdentityBundle({
    displayName: nextDisplayName,
    englishName: nextEnglishName,
    description: nextDescription,
    tags: nextTags,
    workspaces,
    provider: requestedProvider || detail.model.provider || defaultModel.providerId,
    model: requestedModel || detail.model.model,
    aliases: splitAliases(payload.nickname),
  });
  const mergedBundle = mergeContextFiles(rewrittenBundle, payload.contextFiles);
  const patch: AgentConfigPatchInput = {};
  const changedFields: string[] = [];
  const changedFiles: string[] = [];
  const materializedAvatarUrl = requestedAvatarUrl
    ? await materializeManagedAsset(target.id, requestedAvatarUrl, 'avatar')
    : undefined;
  const materializedPortraitUrl = requestedPortraitUrl
    ? await materializeManagedAsset(target.id, requestedPortraitUrl, 'portrait')
    : undefined;
  reportProgress({
    progressPercent: 42,
    title: '正在计算本次变更',
    detail: nextDisplayName,
  });

  if (explicitName) {
    patch.name = explicitName;
    changedFields.push('名称');
  }
  if (explicitEnglishName) {
    patch.english_name = nextEnglishName;
    changedFields.push('英文名');
  }
  if (explicitNickname || explicitTargetName) {
    patch.nickname = nextDisplayName;
    changedFields.push('昵称');
  }
  if (requestedDescription) {
    patch.description = nextDescription;
    changedFields.push('简介');
  }
  if (Array.isArray(payload.tags)) {
    patch.tags = nextTags;
    changedFields.push('标签');
  }
  if (materializedAvatarUrl) {
    patch.avatar_url = materializedAvatarUrl;
    changedFields.push('头像');
  }
  if (materializedPortraitUrl) {
    patch.portrait_url = materializedPortraitUrl;
    changedFields.push('立绘');
  }
  if (requestedColor) {
    patch.color = requestedColor;
    changedFields.push('主题色');
  }
  if ((explicitSystemPrompt && !shouldRewriteAllContextFiles) || shouldRewriteAllContextFiles) {
    patch.system_prompt = shouldRewriteAllContextFiles ? mergedBundle.systemPrompt : explicitSystemPrompt;
    changedFields.push('系统提示词');
  }

  if (Object.keys(patch).length > 0) {
    await patchManagementAgentConfig(target.id, patch);
  }

  reportProgress({
    progressPercent: 70,
    title: '正在写入配置与上下文',
    detail: target.id,
  });
  let modelChanged = false;
  if (requestedModel) {
    await updateManagementAgentModel(target.id, {
      provider: requestedProvider || detail.model.provider || defaultModel.providerId,
      model: requestedModel,
    });
    modelChanged = true;
  }

  if (shouldRewriteAllContextFiles) {
    for (const fileName of CONTEXT_FILE_NAMES) {
      const current = normalizeText(mergedBundle.contextFiles[fileName]);
      const previous = normalizeText(existingContextFileMap.get(fileName));
      if (current !== previous) {
        if (current) {
          await setManagementAgentContextFile(target.id, fileName, current);
        }
        changedFiles.push(fileName);
      }
    }
    if (!changedFields.includes('系统提示词')) {
      changedFields.push('系统提示词');
    }
  } else {
    for (const fileName of CONTEXT_FILE_NAMES) {
      const content = normalizeText(explicitContextFiles[fileName]);
      if (!content) {
        continue;
      }
      const previous = normalizeText(existingContextFileMap.get(fileName));
      if (content === previous) {
        continue;
      }
      await setManagementAgentContextFile(target.id, fileName, content);
      changedFiles.push(fileName);
    }
  }
  if (hasExplicitWorkspaces) {
    await setManagementAgentWorkspaces(target.id, workspaces);
  }
  reportProgress({
    progressPercent: 100,
    title: '智能体更新完成',
    detail: `${nextDisplayName} (${target.id})`,
  });

  return {
    mode,
    agentId: target.id,
    displayName: nextDisplayName,
    summary: buildUpdateSummary({
      displayName: nextDisplayName,
      changedFields,
      changedFiles,
      workspacesChanged: hasExplicitWorkspaces,
      modelChanged,
    }),
  };
}
