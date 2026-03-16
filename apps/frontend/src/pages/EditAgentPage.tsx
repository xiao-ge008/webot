import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  BrainCircuit,
  Camera,
  Database,
  Expand,
  FileText,
  FolderOpen,
  Hammer,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Share2,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';

import { AgentVisualEditor } from '@/components/agent/AgentVisualEditor';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatCurrentModelLabel, formatModelLabel } from '@/lib/model-label';
import { pushInAppNotice } from '@/services/in-app-notifier';
import {
  type AgentConfigPatchInput,
  type DiscordChannelConfig,
  deleteManagementAgentMemoryItem,
  deleteManagementAgent,
  type EmailChannelConfig,
  feedbackManagementAgentMemory,
  type FeishuChannelConfig,
  type QqbotChannelConfig,
  type ManagementChannelStatusItem,
  getAgentMcpAssignments,
  getAgentSkillAssignments,
  getGlobalSkills,
  type ManagementChannelBinding,
  getManagementAgentMemoryItem,
  getManagementAgentMemoryFile,
  getManagementAgentWorkspaces,
  type ManagementAgentMemoryItem,
  type ManagementContextFileName,
  type TelegramChannelConfig,
  getManagementAgentContextFiles,
  getManagementAgentDetail,
  listManagementAgentMemoryFiles,
  listManagementAgents,
  getManagementChannelStatuses,
  getManagementMcpServers,
  downloadManagementAgentExport,
  type ManagementAgentExportOptions,
  listManagementModels,
  type ManagementModelsPayload,
  type ManagementMemoryFileItem,
  optimizePromptWithDefaultModel,
  patchManagementAgentConfig,
  searchManagementAgentMemories,
  setManagementAgentMemoryFile,
  setManagementAgentWorkspaces,
  setManagementAgentContextFile,
  testManagementChannelConnection,
  toggleAgentMcpServer,
  toggleAgentSkill,
  updateManagementAgentModel,
  uploadManagementAgentAvatar,
  uploadManagementAgentPortrait,
} from '@/services/management-client';

interface ModelOption {
  modelId: string;
  providerId: string;
  modelName: string;
  displayName: string;
}

const GLOBAL_CACHE_TTL_MS = 30_000;

type EditorTab =
  | 'identity'
  | 'soul'
  | 'user'
  | 'memory'
  | 'tools'
  | 'agents'
  | 'bootstrap'
  | 'heartbeat'
  | 'system'
  | 'preview'
  | 'info';

interface ContextDraft {
  identity: string;
  soul: string;
  user: string;
  memory: string;
  tools: string;
  agents: string;
  bootstrap: string;
  heartbeat: string;
  system: string;
}

interface ShareExportOptions {
  includeProfile: boolean;
  includeContextFiles: boolean;
  includeMemoryFiles: boolean;
  includeMediaFiles: boolean;
  includeAssignments: boolean;
}

interface CollaborationWorkerCandidate {
  key: string;
  source: 'local' | 'a2a';
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
}

interface CollaborationConfigPayload {
  discoverable: boolean;
  dispatchEnabled: boolean;
  selectedWorkers: string[];
}

type ChannelBindingType = ManagementChannelBinding['type'];

type ChannelConfigMap = {
  telegram: TelegramChannelConfig;
  discord: DiscordChannelConfig;
  email: EmailChannelConfig;
  feishu: FeishuChannelConfig;
  qqbot: QqbotChannelConfig;
};

interface ChannelBindingOption {
  type: ChannelBindingType;
  label: string;
  description: string;
  envHint: string;
}

type ChannelStatusTone = 'ok' | 'warn' | 'error' | 'idle';

const CHANNEL_BINDING_OPTIONS: ChannelBindingOption[] = [
  {
    type: 'telegram',
    label: 'Telegram',
    description: 'Bot API 长轮询',
    envHint: 'TELEGRAM_BOT_TOKEN',
  },
  {
    type: 'discord',
    label: 'Discord',
    description: 'Gateway WebSocket',
    envHint: 'DISCORD_BOT_TOKEN',
  },
  {
    type: 'email',
    label: 'Email',
    description: 'IMAP + SMTP',
    envHint: 'EMAIL_PASSWORD',
  },
  {
    type: 'feishu',
    label: '飞书',
    description: '开放平台回调',
    envHint: 'FEISHU_APP_SECRET',
  },
  {
    type: 'qqbot',
    label: 'QQ',
    description: 'QQ 机器人 (API v2)',
    envHint: 'AppSecret',
  },
];

function summarizeChannelStatus(
  status: ManagementChannelStatusItem | undefined,
): { label: string; tone: ChannelStatusTone } {
  if (!status) {
    return { label: '未检测', tone: 'idle' };
  }
  if (status.type === 'qqbot') {
    if (status.bridge_connected === false) {
      return { label: '桥接未连接', tone: 'warn' };
    }
    if (status.bridge_connected === true && status.status === 'ok') {
      return { label: '桥接已连接', tone: 'ok' };
    }
  }
  switch (status.status) {
    case 'ok':
      return { label: '可用', tone: 'ok' };
    case 'unconfigured':
      return { label: '未配置', tone: 'idle' };
    case 'missing_env':
      return { label: '缺少环境变量', tone: 'warn' };
    case 'not_applied':
      return { label: '未写入配置', tone: 'warn' };
    case 'runtime_offline':
      return { label: '运行时离线', tone: 'warn' };
    default:
      return { label: '异常', tone: 'error' };
  }
}

function parseListInput(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatListInput(values: string[]): string {
  return values.join('\n');
}

function buildDefaultChannelBinding(
  type: ChannelBindingType,
  agentId: string,
): ManagementChannelBinding {
  switch (type) {
    case 'telegram':
      return {
        type,
        config: {
          bot_token_env: 'TELEGRAM_BOT_TOKEN',
          allowed_users: [],
          poll_interval_secs: 1,
          default_agent: agentId,
        },
      };
    case 'discord':
      return {
        type,
        config: {
          bot_token_env: 'DISCORD_BOT_TOKEN',
          allowed_guilds: [],
          intents: 33280,
          default_agent: agentId,
        },
      };
    case 'email':
      return {
        type,
        config: {
          imap_host: 'imap.gmail.com',
          imap_port: 993,
          smtp_host: 'smtp.gmail.com',
          smtp_port: 587,
          username: '',
          password_env: 'EMAIL_PASSWORD',
          poll_interval_secs: 30,
          folders: ['INBOX'],
          allowed_senders: [],
          default_agent: agentId,
        },
      };
    case 'feishu':
      return {
        type,
        config: {
          app_id: '',
          app_secret_env: 'FEISHU_APP_SECRET',
          webhook_port: 8453,
          default_agent: agentId,
        },
      };
    case 'qqbot':
      return {
        type,
        config: {
          app_id: '',
          client_secret: '',
          default_agent: agentId,
        },
      };
    default:
      return {
        type: 'telegram',
        config: {
          bot_token_env: 'TELEGRAM_BOT_TOKEN',
          allowed_users: [],
          poll_interval_secs: 1,
          default_agent: agentId,
        },
      };
  }
}

function applyChannelBindingDefaults(
  binding: ManagementChannelBinding | undefined,
  agentId: string,
): ManagementChannelBinding | null {
  if (!binding) {
    return null;
  }
  switch (binding.type) {
    case 'telegram': {
      const baseline = buildDefaultChannelBinding('telegram', agentId).config;
      return {
        type: 'telegram',
        config: {
          ...baseline,
          ...binding.config,
          default_agent: binding.config.default_agent || agentId,
        },
      };
    }
    case 'discord': {
      const baseline = buildDefaultChannelBinding('discord', agentId).config;
      return {
        type: 'discord',
        config: {
          ...baseline,
          ...binding.config,
          default_agent: binding.config.default_agent || agentId,
        },
      };
    }
    case 'email': {
      const baseline = buildDefaultChannelBinding('email', agentId).config;
      return {
        type: 'email',
        config: {
          ...baseline,
          ...binding.config,
          default_agent: binding.config.default_agent || agentId,
        },
      };
    }
    case 'feishu': {
      const baseline = buildDefaultChannelBinding('feishu', agentId).config;
      return {
        type: 'feishu',
        config: {
          ...baseline,
          ...binding.config,
          default_agent: binding.config.default_agent || agentId,
        },
      };
    }
    case 'qqbot': {
      const baseline = buildDefaultChannelBinding('qqbot', agentId).config;
      return {
        type: 'qqbot',
        config: {
          ...baseline,
          ...binding.config,
          default_agent: binding.config.default_agent || agentId,
        },
      };
    }
    default:
      return binding;
  }
}

function normalizeChannelBindingForSave(
  binding: ManagementChannelBinding | null,
  agentId: string,
): ManagementChannelBinding | null {
  if (!binding) {
    return null;
  }
  switch (binding.type) {
    case 'telegram':
      return {
        type: 'telegram',
        config: {
          ...binding.config,
          default_agent: agentId,
        },
      };
    case 'discord':
      return {
        type: 'discord',
        config: {
          ...binding.config,
          default_agent: agentId,
        },
      };
    case 'email':
      return {
        type: 'email',
        config: {
          ...binding.config,
          default_agent: agentId,
        },
      };
    case 'feishu':
      return {
        type: 'feishu',
        config: {
          ...binding.config,
          default_agent: agentId,
        },
      };
    case 'qqbot':
      return {
        type: 'qqbot',
        config: {
          ...binding.config,
          default_agent: agentId,
        },
      };
    default:
      return binding;
  }
}

const EMPTY_DRAFT: ContextDraft = {
  identity: '',
  soul: '',
  user: '',
  memory: '',
  tools: '',
  agents: '',
  bootstrap: '',
  heartbeat: '',
  system: '',
};

const DEFAULT_SHARE_EXPORT_OPTIONS: ShareExportOptions = {
  includeProfile: true,
  includeContextFiles: true,
  includeMemoryFiles: true,
  includeMediaFiles: true,
  includeAssignments: true,
};

const EDITOR_TAB_ITEMS: Array<{ id: EditorTab; label: string }> = [
  { id: 'identity', label: 'IDENTITY.md' },
  { id: 'soul', label: 'SOUL.md' },
  { id: 'user', label: 'USER.md' },
  { id: 'memory', label: 'MEMORY.md' },
  { id: 'tools', label: 'TOOLS.md' },
  { id: 'agents', label: 'AGENTS.md' },
  { id: 'bootstrap', label: 'BOOTSTRAP.md' },
  { id: 'heartbeat', label: 'HEARTBEAT.md（周期性任务提示词）' },
  { id: 'system', label: '系统提示词' },
  { id: 'preview', label: '预览' },
  { id: 'info', label: '填写说明' },
];

const EDITABLE_CONTEXT_FILES: readonly ManagementContextFileName[] = [
  'IDENTITY.md',
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
  'TOOLS.md',
  'AGENTS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
];

const COLLAB_TAG_DISCOVERABLE = 'webot:collab_discoverable';
const COLLAB_TAG_DISPATCH = 'webot:collab_dispatcher';
const COLLAB_CONFIG_BEGIN = '[WEBOT_COLLAB_CONFIG_BEGIN]';
const COLLAB_CONFIG_END = '[WEBOT_COLLAB_CONFIG_END]';
const COLLAB_PROMPT_BEGIN = '[WEBOT_COLLAB_PROMPT_BEGIN]';
const COLLAB_PROMPT_END = '[WEBOT_COLLAB_PROMPT_END]';

function escapeRegexText(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTaggedBlock(text: string, beginTag: string, endTag: string): string {
  const pattern = new RegExp(
    `${escapeRegexText(beginTag)}[\\s\\S]*?${escapeRegexText(endTag)}[\\r\\n]*`,
    'g',
  );
  return text.replace(pattern, '').trim();
}

function parseCollaborationConfigFromText(rawText: string): CollaborationConfigPayload | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }
  const pattern = new RegExp(
    `${escapeRegexText(COLLAB_CONFIG_BEGIN)}\\s*([\\s\\S]*?)\\s*${escapeRegexText(COLLAB_CONFIG_END)}`,
    'm',
  );
  const matched = pattern.exec(text);
  if (!matched?.[1]) {
    return null;
  }
  try {
    const parsed = JSON.parse(matched[1]);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const selectedWorkers = Array.isArray(record.selectedWorkers)
      ? record.selectedWorkers.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    return {
      discoverable: Boolean(record.discoverable),
      dispatchEnabled: Boolean(record.dispatchEnabled),
      selectedWorkers,
    };
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function toLocalCandidateKey(agentId: string): string {
  return `local:${agentId}`;
}

function normalizeCollaborationWorkerKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('local:') || trimmed.startsWith('a2a:')) {
    return trimmed;
  }
  return toLocalCandidateKey(trimmed);
}

function normalizeCollaborationWorkerKeys(values: string[]): string[] {
  return uniqueStrings(values.map(normalizeCollaborationWorkerKey).filter(Boolean));
}

function stripCollaborationTags(currentTags: string[]): string[] {
  return uniqueStrings(
    currentTags.filter((tag) => {
    const normalized = tag.trim().toLowerCase();
    return normalized !== COLLAB_TAG_DISCOVERABLE && normalized !== COLLAB_TAG_DISPATCH;
    }),
  );
}

function hasTag(tags: string[], target: string): boolean {
  const normalizedTarget = target.trim().toLowerCase();
  return tags.some((tag) => tag.trim().toLowerCase() === normalizedTarget);
}

function modelOptionValue(option: Pick<ModelOption, 'providerId' | 'modelName'>): string {
  return `${option.providerId}::${option.modelName}`;
}

function isValidEnglishName(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim());
}

function stripNicknamePromptBlock(prompt: string): string {
  return prompt.replace(/\[WEBOT_NICKNAME_BEGIN\][\s\S]*?\[WEBOT_NICKNAME_END\][\r\n]*/gim, '').trim();
}

function buildPromptWithNickname(prompt: string, nickname: string): string {
  const base = stripNicknamePromptBlock(prompt);
  const trimmedNickname = nickname.trim();
  if (!trimmedNickname) {
    return base;
  }
  const nicknameBlock = [
    '[WEBOT_NICKNAME_BEGIN]',
    `你的显示称呼是「${trimmedNickname}」。`,
    `当用户询问你是谁、你叫什么时，优先使用「${trimmedNickname}」回答。`,
    '回答身份问题时不要使用智能体ID、英文昵称或模型名。',
    '[WEBOT_NICKNAME_END]',
  ].join('\n');
  return `${nicknameBlock}\n\n${base}`.trim();
}

function buildPreviewMarkdown(draft: ContextDraft): string {
  const blocks: Array<[string, string]> = [
    ['IDENTITY.md', draft.identity],
    ['SOUL.md', draft.soul],
    ['USER.md', draft.user],
    ['MEMORY.md', draft.memory],
    ['TOOLS.md', draft.tools],
    ['AGENTS.md', draft.agents],
    ['BOOTSTRAP.md', draft.bootstrap],
    ['HEARTBEAT.md（周期性任务提示词）', draft.heartbeat],
    ['系统提示词', draft.system],
  ];
  return blocks.map(([title, content]) => `# ${title}\n${content.trim()}`).join('\n\n').trim();
}

function normalizeHeading(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[：:]/g, '')
    .replace(/\s+/g, '')
    .replace(/（.*?）|\(.*?\)/g, '');
}

function splitMarkdownSections(text: string): Record<string, string> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const sections: Record<string, string> = {};
  if (!normalized) {
    return sections;
  }

  const lines = normalized.split('\n');
  let currentHeading = '';
  let buffer: string[] = [];

  const flush = () => {
    if (currentHeading) {
      sections[currentHeading] = buffer.join('\n').trim();
    }
  };

  for (const line of lines) {
    const match = line.match(/^#{1,3}\s*(.+?)\s*$/);
    if (match) {
      flush();
      currentHeading = normalizeHeading(match[1]);
      buffer = [];
      continue;
    }
    if (currentHeading) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function readSection(
  sections: Record<string, string>,
  aliases: string[],
): string {
  for (const alias of aliases) {
    const key = normalizeHeading(alias);
    if (sections[key]) {
      return sections[key];
    }
  }
  return '';
}

function buildOptimizationSeed(bio: string, draft: ContextDraft): string {
  return [
    '请按 OpenFang 身份文件规范生成内容，输出必须是中文 Markdown，且必须包含以下一级标题：# IDENTITY.md、# SOUL.md、# USER.md、# MEMORY.md、# TOOLS.md、# AGENTS.md、# BOOTSTRAP.md、# HEARTBEAT.md、# 系统提示词。',
    '风格要求：可执行、简洁、可直接落地；规则尽量用条目；不要解释过程、不要代码块。',
    '文件职责要求：IDENTITY 含可编辑前言(如 name/archetype/vibe/avatar_url/greeting_style/color)与身份概述；SOUL 定义人格边界；USER 定义用户关系与称呼；MEMORY 定义记忆策略；TOOLS 定义工具调用协议；AGENTS 定义多智能体协作规范；BOOTSTRAP 定义首次会话流程；HEARTBEAT 定义周期巡检清单；系统提示词定义运行时硬约束。',
    `智能体简介：\n${bio.trim() || '（空）'}`,
    `已有草稿：\n${buildPreviewMarkdown(draft) || '（空）'}`,
  ].join('\n\n');
}

function buildLocalIdentityBundleMarkdown(bio: string, draft: ContextDraft): string {
  const profile = bio.trim() || '通用助手型智能体';
  return [
    '# IDENTITY.md',
    draft.identity.trim() ||
      `- name: 未命名智能体\n- archetype: assistant\n- vibe: professional\n- avatar_url:\n- greeting_style: concise\n- color:\n\n## 身份概述\n- 角色定位：${profile}\n- 目标：围绕用户需求输出可执行方案。`,
    '# SOUL.md',
    draft.soul.trim() || '## 核心人格\n- 先结论后解释。\n- 不编造，信息不足时明确说明。',
    '# USER.md',
    draft.user.trim() || '## 用户关系\n- 保持协作式沟通。\n- 默认使用中性、尊重称呼。',
    '# MEMORY.md',
    draft.memory.trim() || '## 记忆策略\n- 记录长期偏好与关键目标。\n- 定期清理过期记忆。',
    '# TOOLS.md',
    draft.tools.trim() || '## 工具调用协议\n- 能调用工具则优先调用。\n- 连续操作尽量批量执行。',
    '# AGENTS.md',
    draft.agents.trim() || '## 多智能体协作\n- 按职责拆分任务。\n- 汇总时统一输出结构。',
    '# BOOTSTRAP.md',
    draft.bootstrap.trim() || '## 首次会话流程\n1. 确认目标\n2. 识别约束\n3. 给出首个可执行步骤',
    '# HEARTBEAT.md',
    draft.heartbeat.trim() || '## 周期性任务提示词\n- 检查待办与阻塞项\n- 每日输出进展摘要',
    '# 系统提示词',
    draft.system.trim() ||
      '你是一个务实、可靠的智能体。输出简洁、结构化，优先给出可执行建议。',
  ].join('\n\n');
}

function parseOptimizedContent(text: string, current: ContextDraft): ContextDraft {
  const next: ContextDraft = { ...current };
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const sections = splitMarkdownSections(normalized);
  let parsedCount = 0;

  const identity = readSection(sections, ['IDENTITY.md', '身份设定']);
  const soul = readSection(sections, ['SOUL.md', '灵魂规则']);
  const user = readSection(sections, ['USER.md', '用户关系']);
  const memory = readSection(sections, ['MEMORY.md', '记忆规则', '长期记忆']);
  const tools = readSection(sections, ['TOOLS.md', '工具规范']);
  const agents = readSection(sections, ['AGENTS.md', '多智能体协作']);
  const bootstrap = readSection(sections, ['BOOTSTRAP.md', '首次运行流程', '首次会话流程']);
  const heartbeat = readSection(sections, ['HEARTBEAT.md', '周期性任务提示词', 'heartbeatchecklist']);
  const system = readSection(sections, ['系统提示词', 'SYSTEM']);

  if (identity) {
    next.identity = identity;
    parsedCount += 1;
  }
  if (soul) {
    next.soul = soul;
    parsedCount += 1;
  }
  if (user) {
    next.user = user;
    parsedCount += 1;
  }
  if (memory) {
    next.memory = memory;
    parsedCount += 1;
  }
  if (tools) {
    next.tools = tools;
    parsedCount += 1;
  }
  if (agents) {
    next.agents = agents;
    parsedCount += 1;
  }
  if (bootstrap) {
    next.bootstrap = bootstrap;
    parsedCount += 1;
  }
  if (heartbeat) {
    next.heartbeat = heartbeat;
    parsedCount += 1;
  }
  if (system) {
    next.system = system;
    parsedCount += 1;
  }

  if (parsedCount === 0 && normalized) {
    next.identity = normalized;
  }

  return next;
}

function hasAnyDraftContent(draft: ContextDraft): boolean {
  return (
    draft.identity.trim().length > 0 ||
    draft.soul.trim().length > 0 ||
    draft.user.trim().length > 0 ||
    draft.memory.trim().length > 0 ||
    draft.tools.trim().length > 0 ||
    draft.agents.trim().length > 0 ||
    draft.bootstrap.trim().length > 0 ||
    draft.heartbeat.trim().length > 0 ||
    draft.system.trim().length > 0
  );
}

function resolveUpdatedEditorTab(previous: ContextDraft, next: ContextDraft): EditorTab {
  const order: Array<[keyof ContextDraft, EditorTab]> = [
    ['identity', 'identity'],
    ['soul', 'soul'],
    ['user', 'user'],
    ['memory', 'memory'],
    ['tools', 'tools'],
    ['agents', 'agents'],
    ['bootstrap', 'bootstrap'],
    ['heartbeat', 'heartbeat'],
    ['system', 'system'],
  ];
  for (const [key, tab] of order) {
    if (previous[key] !== next[key] && next[key].trim().length > 0) {
      return tab;
    }
  }
  return 'identity';
}

interface SkillCatalog {
  all: string[];
  custom: string[];
  builtin: string[];
  systemUi: string[];
  descriptions: Record<string, string>;
}

let cachedGlobalSkillCatalog: SkillCatalog | null = null;
let cachedGlobalSkillCatalogAt = 0;
let cachedMcpServers: Awaited<ReturnType<typeof getManagementMcpServers>> | null = null;
let cachedMcpServersAt = 0;
let cachedModelsPayload: ManagementModelsPayload | null = null;
let cachedModelsPayloadAt = 0;

function isCacheFresh(timestamp: number): boolean {
  return Date.now() - timestamp < GLOBAL_CACHE_TTL_MS;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function buildGlobalSkillCatalog(payload: Awaited<ReturnType<typeof getGlobalSkills>>): SkillCatalog {
  const runtimeNames: string[] = [];
  const runtimeBuiltin: string[] = [];
  const runtimeCustom: string[] = [];
  const runtimeUi: string[] = [];
  const descriptions: Record<string, string> = { ...payload.descriptions };

  const pushDescription = (name: string, value?: string) => {
    const next = (value ?? '').trim();
    if (!next) {
      return;
    }
    descriptions[name] = next;
  };

  for (const skill of payload.runtime.skills) {
    const name = skill.name?.trim();
    if (!name) {
      continue;
    }
    runtimeNames.push(name);
    pushDescription(name, skill.description);
    const sourceType = (skill.source?.type || '').toLowerCase();
    const looksLikeUi = sourceType.includes('ui') || /(^ui[-_])|([-_]ui$)|(^system-ui$)/i.test(name);
    if (looksLikeUi) {
      runtimeUi.push(name);
    }
    if (sourceType.includes('bundled') || sourceType.includes('builtin') || sourceType.includes('system')) {
      runtimeBuiltin.push(name);
      continue;
    }
    runtimeCustom.push(name);
  }

  const importedNames = payload.imported.map((item) => item.name);
  const localNames = payload.localFolders;
  const custom = uniqueSorted([...runtimeCustom, ...importedNames, ...localNames]);
  const builtin = uniqueSorted(runtimeBuiltin);
  const systemUi = uniqueSorted(runtimeUi);
  const all = uniqueSorted([...runtimeNames, ...importedNames, ...localNames]);
  for (const imported of payload.imported) {
    pushDescription(imported.name, imported.description);
  }
  return { all, custom, builtin, systemUi, descriptions };
}

function mergeSkillCatalog(
  assignment: Awaited<ReturnType<typeof getAgentSkillAssignments>>,
  globalCatalog: SkillCatalog,
): SkillCatalog {
  return {
    all: uniqueSorted([...globalCatalog.all, ...assignment.available, ...assignment.assigned]),
    custom: uniqueSorted([...globalCatalog.custom, ...(assignment.custom_available || [])]),
    builtin: uniqueSorted([...globalCatalog.builtin, ...(assignment.builtin_available || [])]),
    systemUi: uniqueSorted(globalCatalog.systemUi),
    descriptions: globalCatalog.descriptions,
  };
}

function draftFromContextFiles(files: Partial<Record<ManagementContextFileName, string>>, systemPrompt: string): ContextDraft {
  return {
    identity: files['IDENTITY.md'] || '',
    soul: files['SOUL.md'] || '',
    user: files['USER.md'] || '',
    memory: files['MEMORY.md'] || '',
    tools: files['TOOLS.md'] || '',
    agents: stripTaggedBlock(files['AGENTS.md'] || '', COLLAB_CONFIG_BEGIN, COLLAB_CONFIG_END),
    bootstrap: files['BOOTSTRAP.md'] || '',
    heartbeat: files['HEARTBEAT.md'] || '',
    system: stripTaggedBlock(systemPrompt, COLLAB_PROMPT_BEGIN, COLLAB_PROMPT_END),
  };
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return '-';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimeLabel(timestampMs: number): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) {
    return '-';
  }
  return new Date(timestampMs).toLocaleString('zh-CN', { hour12: false });
}

function formatIsoTimeLabel(value?: string): string {
  const text = (value || '').trim();
  if (!text) {
    return '-';
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    return text;
  }
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildLastWeekDateRange(): { start: string; end: string } {
  const now = new Date();
  const end = toDateInputValue(now);
  const startDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const start = toDateInputValue(startDate);
  return { start, end };
}

function workspacePathKey(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
}

function dedupeWorkspacePaths(paths: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const key = workspacePathKey(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }
  return output;
}

type SemanticFeedbackAction = 'confirm' | 'weaken' | 'outdated' | 'revoke' | 'reject';

export function EditAgentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('basic');
  const [editorTab, setEditorTab] = useState<EditorTab>('identity');
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [agentId, setAgentId] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [modelOptionsLoaded, setModelOptionsLoaded] = useState(false);
  const [modelOptionsLoading, setModelOptionsLoading] = useState(false);
  const [currentModel, setCurrentModel] = useState<{ providerId: string; modelName: string } | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [portraitUrl, setPortraitUrl] = useState('');
  const [hasPortrait, setHasPortrait] = useState(false);
  const [hasLive2D, setHasLive2D] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingPortrait, setUploadingPortrait] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [loadingContextFiles, setLoadingContextFiles] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [draft, setDraft] = useState<ContextDraft>(EMPTY_DRAFT);
  const [contextFiles, setContextFiles] = useState<Partial<Record<ManagementContextFileName, string>>>({});
  const [initialContextFiles, setInitialContextFiles] = useState<Partial<Record<ManagementContextFileName, string>>>({});
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [skillsMcpLoaded, setSkillsMcpLoaded] = useState(false);
  const [savingSkillName, setSavingSkillName] = useState<string | null>(null);
  const [savingMcpName, setSavingMcpName] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [builtinSkills, setBuiltinSkills] = useState<string[]>([]);
  const [customSkills, setCustomSkills] = useState<string[]>([]);
  const [systemUiSkills, setSystemUiSkills] = useState<string[]>([]);
  const [skillDescriptions, setSkillDescriptions] = useState<Record<string, string>>({});
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<string[]>([]);
  const [connectedMcpServers, setConnectedMcpServers] = useState<string[]>([]);
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);
  const [memoryFiles, setMemoryFiles] = useState<ManagementMemoryFileItem[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryPage, setMemoryPage] = useState(1);
  const [memoryPageSize, setMemoryPageSize] = useState(10);
  const [memoryTotal, setMemoryTotal] = useState(0);
  const [memoryTotalPages, setMemoryTotalPages] = useState(0);
  const [memoryKeyword, setMemoryKeyword] = useState('');
  const [memoryQueryKeyword, setMemoryQueryKeyword] = useState('');
  const [memoryStartDate, setMemoryStartDate] = useState(() => buildLastWeekDateRange().start);
  const [memoryEndDate, setMemoryEndDate] = useState(() => buildLastWeekDateRange().end);
  const [memoryEditorOpen, setMemoryEditorOpen] = useState(false);
  const [memoryEditorLoading, setMemoryEditorLoading] = useState(false);
  const [memoryEditorSaving, setMemoryEditorSaving] = useState(false);
  const [memoryEditorPath, setMemoryEditorPath] = useState('');
  const [memoryEditorContent, setMemoryEditorContent] = useState('');
  const [semanticMemories, setSemanticMemories] = useState<ManagementAgentMemoryItem[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticQuery, setSemanticQuery] = useState('');
  const [semanticScope, setSemanticScope] = useState('');
  const [semanticMemoryType, setSemanticMemoryType] = useState('');
  const [semanticMinConfidence, setSemanticMinConfidence] = useState('');
  const [semanticLimit, setSemanticLimit] = useState('10');
  const [semanticSupported, setSemanticSupported] = useState(true);
  const [semanticFeedbackKey, setSemanticFeedbackKey] = useState('');
  const [semanticDetailOpen, setSemanticDetailOpen] = useState(false);
  const [semanticDetailLoading, setSemanticDetailLoading] = useState(false);
  const [semanticDetailItem, setSemanticDetailItem] = useState<ManagementAgentMemoryItem | null>(null);
  const [semanticCorrectOpen, setSemanticCorrectOpen] = useState(false);
  const [semanticCorrectSubmitting, setSemanticCorrectSubmitting] = useState(false);
  const [semanticCorrectReason, setSemanticCorrectReason] = useState('');
  const [semanticCorrectContent, setSemanticCorrectContent] = useState('');
  const [semanticCorrectTarget, setSemanticCorrectTarget] = useState<ManagementAgentMemoryItem | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [workspacePrivatePath, setWorkspacePrivatePath] = useState('');
  const [workspaceSharedPath, setWorkspaceSharedPath] = useState('');
  const [workspaceExtraPaths, setWorkspaceExtraPaths] = useState<string[]>([]);
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [collaborationDiscoverable, setCollaborationDiscoverable] = useState(false);
  const [collaborationDispatchEnabled, setCollaborationDispatchEnabled] = useState(false);
  const [collaborationCandidates, setCollaborationCandidates] = useState<CollaborationWorkerCandidate[]>([]);
  const [collaborationSelectedWorkers, setCollaborationSelectedWorkers] = useState<string[]>([]);
  const [collaborationLoading, setCollaborationLoading] = useState(false);
  const [collaborationLoadedAt, setCollaborationLoadedAt] = useState<number | null>(null);
  const [collaborationLoaded, setCollaborationLoaded] = useState(false);
  const [channelBinding, setChannelBinding] = useState<ManagementChannelBinding | null>(null);
  const [channelStatuses, setChannelStatuses] = useState<ManagementChannelStatusItem[]>([]);
  const [channelStatusLoading, setChannelStatusLoading] = useState(false);
  const [channelTestLoading, setChannelTestLoading] = useState<ChannelBindingType | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [exportingBundle, setExportingBundle] = useState(false);
  const [shareExportOptions, setShareExportOptions] = useState<ShareExportOptions>(
    DEFAULT_SHARE_EXPORT_OPTIONS,
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'purge' | 'local_only'>('purge');
  const [deletingAgent, setDeletingAgent] = useState(false);

  const navItems = [
    { id: 'basic', label: t('edit.nav.basic'), icon: User },
    { id: 'visual', label: t('edit.nav.visual'), icon: Camera },
    { id: 'model', label: '模型设定', icon: Bot },
    { id: 'skills', label: t('edit.nav.skills'), icon: Hammer },
    { id: 'mcp', label: t('edit.nav.mcp'), icon: Database },
    { id: 'channel', label: '渠道绑定', icon: MessageSquare },
    { id: 'collaboration', label: '协同办公', icon: Users },
    { id: 'memory', label: t('edit.nav.memory'), icon: BrainCircuit },
    { id: 'workspace', label: t('edit.nav.workspace'), icon: Settings2 },
  ];

  const selectedModel = useMemo(
    () => modelOptions.find((item) => modelOptionValue(item) === selectedModelId) ?? null,
    [modelOptions, selectedModelId],
  );

  const providerOptions = useMemo(() => {
    const providers = uniqueSorted(modelOptions.map((item) => item.providerId).filter(Boolean));
    const currentProvider = currentModel?.providerId?.trim() || '';
    const withCurrent =
      currentProvider && !providers.includes(currentProvider) ? uniqueSorted([currentProvider, ...providers]) : providers;
    if (selectedProviderId && !withCurrent.includes(selectedProviderId)) {
      return uniqueSorted([selectedProviderId, ...withCurrent]);
    }
    return withCurrent;
  }, [currentModel?.providerId, modelOptions, selectedProviderId]);

  const filteredModelOptions = useMemo(() => {
    if (!selectedProviderId) {
      return modelOptions;
    }
    return modelOptions.filter((item) => item.providerId === selectedProviderId);
  }, [modelOptions, selectedProviderId]);

  useEffect(() => {
    // 当用户切换供应商时，确保模型下拉的 value 一定落在当前供应商的候选集中。
    if (!selectedProviderId) {
      return;
    }
    if (filteredModelOptions.length === 0) {
      return;
    }
    const hasSelected = filteredModelOptions.some((item) => modelOptionValue(item) === selectedModelId);
    if (hasSelected) {
      return;
    }
    const preferred =
      filteredModelOptions.find(
        (item) => currentModel && item.providerId === currentModel.providerId && item.modelName === currentModel.modelName,
      ) ?? filteredModelOptions[0];
    if (preferred) {
      setSelectedModelId(modelOptionValue(preferred));
    }
  }, [currentModel, filteredModelOptions, selectedModelId, selectedProviderId]);

  useEffect(() => {
    // 首次进入时用当前模型的 provider 作为默认供应商选择。
    if (selectedProviderId) {
      return;
    }
    if (currentModel?.providerId) {
      setSelectedProviderId(currentModel.providerId);
    } else if (selectedModel?.providerId) {
      setSelectedProviderId(selectedModel.providerId);
    }
  }, [currentModel?.providerId, selectedModel?.providerId, selectedProviderId]);

  const otherSkills = useMemo(() => {
    const grouped = new Set([...builtinSkills, ...customSkills, ...systemUiSkills]);
    return uniqueSorted(availableSkills.filter((item) => !grouped.has(item)));
  }, [availableSkills, builtinSkills, customSkills, systemUiSkills]);
  const hideHeaderSaveButton = activeTab === 'memory' || activeTab === 'workspace';
  const isRealtimeToggleTab = activeTab === 'skills' || activeTab === 'mcp';
  const realtimeSaving = savingSkillName !== null || savingMcpName !== null;
  const hasSelectedShareExportOptions = useMemo(
    () => Object.values(shareExportOptions).some(Boolean),
    [shareExportOptions],
  );
  const collaborationCandidateMap = useMemo(() => {
    return new Map(collaborationCandidates.map((item) => [item.key, item]));
  }, [collaborationCandidates]);
  const selectedCollaborationWorkers = useMemo(() => {
    return collaborationSelectedWorkers
      .map((key) => collaborationCandidateMap.get(key))
      .filter((item): item is CollaborationWorkerCandidate => Boolean(item));
  }, [collaborationCandidateMap, collaborationSelectedWorkers]);
  const channelStatusMap = useMemo(() => {
    return new Map(channelStatuses.map((item) => [item.type, item]));
  }, [channelStatuses]);
  const selectedChannelStatus = channelBinding ? channelStatusMap.get(channelBinding.type) : undefined;

  const updateDraft = (key: keyof ContextDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateChannelBindingConfig = <T extends ChannelBindingType>(
    type: T,
    patch: Partial<ChannelConfigMap[T]>,
  ) => {
    setChannelBinding((prev) => {
      if (!prev || prev.type !== type) {
        return prev;
      }
      return {
        ...prev,
        config: {
          ...prev.config,
          ...patch,
        },
      } as ManagementChannelBinding;
    });
  };

  const handleSelectChannelBinding = (type: ChannelBindingType) => {
    const resolvedAgentId = agentId || id || '';
    setChannelBinding((prev) => {
      if (prev?.type === type) {
        return prev;
      }
      return buildDefaultChannelBinding(type, resolvedAgentId);
    });
  };

  const handleClearChannelBinding = () => {
    setChannelBinding(null);
  };

  const handleTestChannelBinding = async (type: ChannelBindingType) => {
    setChannelTestLoading(type);
    try {
      const result = await testManagementChannelConnection(type);
      pushInAppNotice({
        title: result.ok ? '连接测试通过' : '连接测试失败',
        message: result.message || '未返回详细信息',
        level: result.ok ? 'success' : 'error',
      });
      await loadChannelStatuses();
    } catch (error) {
      pushInAppNotice({
        title: '连接测试失败',
        message: error instanceof Error ? error.message : '测试请求失败',
        level: 'error',
      });
    } finally {
      setChannelTestLoading(null);
    }
  };

  const loadContextFiles = async (targetId: string): Promise<Partial<Record<ManagementContextFileName, string>>> => {
    const files = await getManagementAgentContextFiles(targetId);
    const map: Partial<Record<ManagementContextFileName, string>> = {};
    for (const file of files) {
      map[file.name] = file.content || '';
    }
    return map;
  };

  const loadSkillAndMcpData = async (targetId: string) => {
    setSkillsLoading(true);
    setMcpLoading(true);
    try {
      const [skillAssignment, mcpAssignment] = await Promise.all([
        getAgentSkillAssignments(targetId),
        getAgentMcpAssignments(targetId),
      ]);

      const globalCatalog =
        cachedGlobalSkillCatalog && isCacheFresh(cachedGlobalSkillCatalogAt)
          ? cachedGlobalSkillCatalog
          : buildGlobalSkillCatalog(await getGlobalSkills());
      cachedGlobalSkillCatalog = globalCatalog;
      cachedGlobalSkillCatalogAt = Date.now();

      const mcpPayload =
        cachedMcpServers && isCacheFresh(cachedMcpServersAt)
          ? cachedMcpServers
          : await getManagementMcpServers();
      cachedMcpServers = mcpPayload;
      cachedMcpServersAt = Date.now();

      const mergedCatalog = mergeSkillCatalog(skillAssignment, globalCatalog);
      setAvailableSkills(mergedCatalog.all);
      setCustomSkills(mergedCatalog.custom);
      setBuiltinSkills(mergedCatalog.builtin);
      setSystemUiSkills(mergedCatalog.systemUi);
      setSkillDescriptions(mergedCatalog.descriptions);
      setSelectedSkills(uniqueSorted(skillAssignment.assigned));

      const configured = uniqueSorted(mcpPayload.configured.map((item) => item.name));
      const connected = uniqueSorted(mcpPayload.connected.map((item) => item.name));
      setConnectedMcpServers(connected);
      setAvailableMcpServers(
        uniqueSorted([
          ...configured,
          ...connected,
          ...mcpAssignment.available,
          ...(mcpAssignment.runtime_available || []),
          ...mcpAssignment.assigned,
        ]),
      );
      setSelectedMcpServers(uniqueSorted(mcpAssignment.assigned));
      setSkillsMcpLoaded(true);
    } catch (error) {
      console.error('[EditAgent] 加载 Skill/MCP 失败:', error);
    } finally {
      setSkillsLoading(false);
      setMcpLoading(false);
    }
  };

  const loadChannelStatuses = async () => {
    setChannelStatusLoading(true);
    try {
      const statuses = await getManagementChannelStatuses();
      setChannelStatuses(statuses);
    } catch (error) {
      console.error('[EditAgent] 加载渠道状态失败:', error);
    } finally {
      setChannelStatusLoading(false);
    }
  };

  const applyWorkspacePayload = (payload: {
    privateWorkspace: string;
    sharedWorkspace: string;
    extraWorkspaces: string[];
    workspaceMcpServer?: string;
  }) => {
    setWorkspacePrivatePath(payload.privateWorkspace);
    setWorkspaceSharedPath(payload.sharedWorkspace);
    setWorkspaceExtraPaths(dedupeWorkspacePaths(payload.extraWorkspaces));
  };

  const loadWorkspaceData = async (targetId: string) => {
    setWorkspaceLoading(true);
    try {
      const payload = await getManagementAgentWorkspaces(targetId);
      applyWorkspacePayload(payload);
      setWorkspaceLoaded(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : '加载工作空间失败');
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const persistWorkspaceExtras = async (nextExtras: string[]) => {
    if (!id) {
      return;
    }
    setWorkspaceSaving(true);
    try {
      const payload = await setManagementAgentWorkspaces(id, dedupeWorkspacePaths(nextExtras));
      applyWorkspacePayload(payload);
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存工作空间失败');
    } finally {
      setWorkspaceSaving(false);
    }
  };

  const loadCollaborationCandidates = async (targetId: string) => {
    setCollaborationLoading(true);
    try {
      const localAgents = await listManagementAgents();
      const peerAgents = localAgents.filter((item) => item.id !== targetId);
      const selfAliases = new Set(
        [targetId, agentId, name, nickname]
          .map((value) => (value || '').trim().toLowerCase())
          .filter(Boolean),
      );
      const localCandidates: CollaborationWorkerCandidate[] = peerAgents
        .filter((item) => hasTag(item.tags || [], COLLAB_TAG_DISCOVERABLE))
        .filter((item) => {
          const aliases = [item.id, item.name, item.nickname, item.english_name]
            .map((value) => (value || '').trim().toLowerCase())
            .filter(Boolean);
          return !aliases.some((alias) => selfAliases.has(alias));
        })
        .map((entry) => ({
          key: toLocalCandidateKey(entry.id),
          source: 'local',
          id: entry.id,
          name: entry.nickname?.trim() || entry.name || entry.id,
          description: (entry.description || '').trim(),
          avatarUrl: entry.identity.avatar_url || entry.identity.portrait_url,
        }));
      const merged = localCandidates;
      const uniqueMap = new Map<string, CollaborationWorkerCandidate>();
      for (const candidate of merged) {
        uniqueMap.set(candidate.key, candidate);
      }
      const deduped = Array.from(uniqueMap.values());
      setCollaborationCandidates(deduped);
      setCollaborationLoadedAt(Date.now());
      setCollaborationLoaded(true);
      const validKeys = new Set(deduped.map((item) => item.key));
      setCollaborationSelectedWorkers((prev) =>
        normalizeCollaborationWorkerKeys(prev).filter((key) => validKeys.has(key)),
      );
    } catch (error) {
      console.error('[EditAgent] 加载协同员工失败:', error);
      alert(error instanceof Error ? error.message : '加载协同员工失败');
    } finally {
      setCollaborationLoading(false);
    }
  };

  const loadMemoryFiles = async (options?: {
    page?: number;
    pageSize?: number;
    startDate?: string;
    endDate?: string;
    keyword?: string;
  }) => {
    if (!id) {
      return;
    }
    const targetPage = options?.page ?? memoryPage;
    const targetPageSize = options?.pageSize ?? memoryPageSize;
    const targetStartDate = options?.startDate ?? memoryStartDate;
    const targetEndDate = options?.endDate ?? memoryEndDate;
    const targetKeyword = options?.keyword ?? memoryQueryKeyword;
    setMemoryLoading(true);
    try {
      const startMs = targetStartDate
        ? new Date(`${targetStartDate}T00:00:00`).getTime()
        : undefined;
      const endMs = targetEndDate
        ? new Date(`${targetEndDate}T23:59:59.999`).getTime()
        : undefined;
      const response = await listManagementAgentMemoryFiles(id, {
        page: targetPage,
        pageSize: targetPageSize,
        startMs: Number.isFinite(startMs) ? startMs : undefined,
        endMs: Number.isFinite(endMs) ? endMs : undefined,
        keyword: targetKeyword.trim() || undefined,
      });
      setMemoryFiles(response.items);
      setMemoryTotal(response.pagination.total);
      setMemoryTotalPages(response.pagination.totalPages);
      setMemoryPage(response.pagination.page);
      setMemoryPageSize(response.pagination.pageSize);
    } catch (error) {
      alert(error instanceof Error ? error.message : '加载记忆文件失败');
    } finally {
      setMemoryLoading(false);
    }
  };

  const openMemoryEditor = async (path: string) => {
    if (!id) {
      return;
    }
    setMemoryEditorPath(path);
    setMemoryEditorOpen(true);
    setMemoryEditorLoading(true);
    try {
      const detail = await getManagementAgentMemoryFile(id, path);
      setMemoryEditorContent(detail.content);
    } catch (error) {
      alert(error instanceof Error ? error.message : '读取记忆文件失败');
      setMemoryEditorOpen(false);
      setMemoryEditorPath('');
      setMemoryEditorContent('');
    } finally {
      setMemoryEditorLoading(false);
    }
  };

  const handleSaveMemoryFile = async () => {
    if (!id || !memoryEditorPath) {
      return;
    }
    setMemoryEditorSaving(true);
    try {
      await setManagementAgentMemoryFile(id, memoryEditorPath, memoryEditorContent);
      await loadMemoryFiles({ page: memoryPage, pageSize: memoryPageSize });
      alert('记忆文件已保存');
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存记忆文件失败');
    } finally {
      setMemoryEditorSaving(false);
    }
  };

  const loadSemanticMemories = async (options?: {
    q?: string;
    scope?: string;
    memoryType?: string;
    minConfidence?: string;
    limit?: string;
  }) => {
    if (!id) {
      return;
    }
    const q = (options?.q ?? semanticQuery).trim();
    const scope = (options?.scope ?? semanticScope).trim();
    const memoryType = (options?.memoryType ?? semanticMemoryType).trim();
    const limitInput = (options?.limit ?? semanticLimit).trim();
    const minConfidenceInput = (options?.minConfidence ?? semanticMinConfidence).trim();

    const parsedLimit = Number.parseInt(limitInput, 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(10, parsedLimit) : 10;

    const parsedMinConfidence = Number.parseFloat(minConfidenceInput);
    const minConfidence =
      Number.isFinite(parsedMinConfidence)
        ? Math.max(0, Math.min(1, parsedMinConfidence))
        : undefined;

    setSemanticLoading(true);
    try {
      const response = await searchManagementAgentMemories(id, {
        q: q || undefined,
        scope: scope || undefined,
        memoryType: memoryType || undefined,
        minConfidence,
        limit,
      });
      const supported = response.supported !== false;
      setSemanticSupported(supported);
      if (!supported) {
        setSemanticMemories([]);
        setSemanticDetailOpen(false);
        setSemanticDetailItem(null);
        return;
      }
      const sorted = [...response.memories].sort((a, b) => {
        const aTime = Date.parse(a.createdAt ?? '');
        const bTime = Date.parse(b.createdAt ?? '');
        if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
        if (!Number.isFinite(aTime)) return 1;
        if (!Number.isFinite(bTime)) return -1;
        return bTime - aTime;
      });
      setSemanticMemories(sorted.slice(0, 10));
    } catch (error) {
      alert(error instanceof Error ? error.message : t('edit.memory.semanticLoadFailed'));
    } finally {
      setSemanticLoading(false);
    }
  };

  const openSemanticMemoryDetail = async (memoryId: string) => {
    if (!id || !semanticSupported) {
      return;
    }
    setSemanticDetailOpen(true);
    setSemanticDetailLoading(true);
    try {
      const item = await getManagementAgentMemoryItem(id, memoryId);
      setSemanticDetailItem(item);
    } catch (error) {
      alert(error instanceof Error ? error.message : t('edit.memory.semanticDetailFailed'));
      setSemanticDetailOpen(false);
      setSemanticDetailItem(null);
    } finally {
      setSemanticDetailLoading(false);
    }
  };

  const handleSemanticFeedback = async (memoryId: string, action: SemanticFeedbackAction) => {
    if (!id || !semanticSupported) {
      return;
    }
    const key = `${memoryId}:${action}`;
    setSemanticFeedbackKey(key);
    try {
      await feedbackManagementAgentMemory(id, {
        memoryId,
        action,
      });
      await loadSemanticMemories();
      if (semanticDetailItem?.id === memoryId) {
        await openSemanticMemoryDetail(memoryId);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : t('edit.memory.semanticFeedbackFailed'));
    } finally {
      setSemanticFeedbackKey('');
    }
  };

  const handleDeleteSemanticMemory = async (memoryId: string) => {
    if (!id || !semanticSupported) {
      return;
    }
    if (!window.confirm(t('edit.memory.semanticDeleteConfirm'))) {
      return;
    }
    const key = `${memoryId}:delete`;
    setSemanticFeedbackKey(key);
    try {
      await deleteManagementAgentMemoryItem(id, memoryId);
      if (semanticDetailItem?.id === memoryId) {
        setSemanticDetailOpen(false);
        setSemanticDetailItem(null);
      }
      await loadSemanticMemories();
    } catch (error) {
      alert(error instanceof Error ? error.message : t('edit.memory.semanticDeleteFailed'));
    } finally {
      setSemanticFeedbackKey('');
    }
  };

  const openSemanticCorrectDialog = (item: ManagementAgentMemoryItem) => {
    setSemanticCorrectTarget(item);
    setSemanticCorrectReason('');
    setSemanticCorrectContent(item.content || '');
    setSemanticCorrectOpen(true);
  };

  const handleSubmitSemanticCorrection = async () => {
    if (!id || !semanticCorrectTarget || !semanticSupported) {
      return;
    }
    const correctedContent = semanticCorrectContent.trim();
    if (!correctedContent) {
      alert(t('edit.memory.semanticCorrectContentRequired'));
      return;
    }
    setSemanticCorrectSubmitting(true);
    try {
      const response = await feedbackManagementAgentMemory(id, {
        memoryId: semanticCorrectTarget.id,
        action: 'correct',
        reason: semanticCorrectReason.trim() || undefined,
        correctedContent,
      });
      const nextId = response.correctedMemoryId || semanticCorrectTarget.id;
      setSemanticCorrectOpen(false);
      setSemanticCorrectTarget(null);
      await loadSemanticMemories();
      await openSemanticMemoryDetail(nextId);
    } catch (error) {
      alert(error instanceof Error ? error.message : t('edit.memory.semanticCorrectFailed'));
    } finally {
      setSemanticCorrectSubmitting(false);
    }
  };

  const loadModelOptions = async (
    detailModel: { providerId: string; modelName: string },
    currentSelected: string,
  ) => {
    if (modelOptionsLoading) {
      return;
    }
    setModelOptionsLoading(true);
    try {
      const modelsPayload =
        cachedModelsPayload && isCacheFresh(cachedModelsPayloadAt)
          ? cachedModelsPayload
          : await listManagementModels();
      cachedModelsPayload = modelsPayload;
      cachedModelsPayloadAt = Date.now();

      const enabledModels = modelsPayload.models.filter((item) => item.enabled);
      const options = enabledModels.length > 0 ? enabledModels : modelsPayload.models;
      let nextOptions: ModelOption[] = options.map((item) => ({
        modelId: item.modelId,
        providerId: item.providerId,
        modelName: item.modelName,
        displayName: formatModelLabel(item.providerId, item.modelName, item.displayName),
      }));
      const hit = nextOptions.find(
        (item) => item.providerId === detailModel.providerId && item.modelName === detailModel.modelName,
      );
      if (!hit && detailModel.modelName.trim()) {
        const synthetic: ModelOption = {
          modelId: `current::${detailModel.providerId}::${detailModel.modelName}`,
          providerId: detailModel.providerId,
          modelName: detailModel.modelName,
          displayName: formatCurrentModelLabel(detailModel.providerId, detailModel.modelName),
        };
        nextOptions = [synthetic, ...nextOptions];
      }

      setModelOptions(nextOptions);
      const resolvedSelected =
        nextOptions.find((item) => modelOptionValue(item) === currentSelected) ??
        nextOptions.find(
          (item) => item.providerId === detailModel.providerId && item.modelName === detailModel.modelName,
        ) ??
        nextOptions[0] ??
        null;
      if (resolvedSelected) {
        setSelectedModelId(modelOptionValue(resolvedSelected));
      }
      setModelOptionsLoaded(true);
    } catch (error) {
      console.error('[EditAgent] 加载模型列表失败:', error);
    } finally {
      setModelOptionsLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!id) {
        return;
      }
      setLoading(true);
      setSkillsMcpLoaded(false);
      setWorkspaceLoaded(false);
      setCollaborationLoaded(false);
      setModelOptionsLoaded(false);
      setAvailableSkills([]);
      setCustomSkills([]);
      setBuiltinSkills([]);
      setSystemUiSkills([]);
      setSelectedSkills([]);
      setAvailableMcpServers([]);
      setConnectedMcpServers([]);
      setSelectedMcpServers([]);
      setWorkspacePrivatePath('');
      setWorkspaceSharedPath('');
      setWorkspaceExtraPaths([]);
      setCollaborationCandidates([]);
      setCollaborationLoadedAt(null);
      try {
        const [detail, fileMap] = await Promise.all([
          getManagementAgentDetail(id),
          loadContextFiles(id),
        ]);

        const resolvedEnglishName = detail.english_name?.trim();
        const fallbackFromName = isValidEnglishName(detail.name) ? detail.name.trim() : '';
        setName(resolvedEnglishName || fallbackFromName || '');
        setNickname(detail.nickname || '');
        setAgentId(detail.id);
        const detailTags = detail.tags || [];
        setTags(stripCollaborationTags(detailTags));
        setBio(detail.description || '');
        setHasLive2D(false);

        const detailModel = {
          providerId: detail.model.provider,
          modelName: detail.model.model,
        };
        setCurrentModel(detailModel);
        setSelectedProviderId(detailModel.providerId);
        const synthetic: ModelOption = {
          modelId: `current::${detailModel.providerId}::${detailModel.modelName}`,
          providerId: detailModel.providerId,
          modelName: detailModel.modelName,
          displayName: formatCurrentModelLabel(detailModel.providerId, detailModel.modelName),
        };
        setModelOptions([synthetic]);
        setSelectedModelId(modelOptionValue(synthetic));

        const statePayload = location.state as
          | {
            initialContextFiles?: Partial<Record<ManagementContextFileName, string>>;
            initialSystemPrompt?: string;
            initialAvatarUrl?: string;
            initialPortraitUrl?: string;
          }
          | null;

        const resolvedAvatarUrl = (statePayload?.initialAvatarUrl || detail.identity.avatar_url || '').trim();
        const resolvedPortraitUrl = (statePayload?.initialPortraitUrl || detail.identity.portrait_url || '').trim();
        setAvatarUrl(resolvedAvatarUrl);
        setPortraitUrl(resolvedPortraitUrl);
        setHasPortrait(Boolean(resolvedPortraitUrl));

        const mergedFiles = {
          ...fileMap,
          ...(statePayload?.initialContextFiles ?? {}),
        };
        const rawAgentsText = mergedFiles['AGENTS.md'] || '';
        const rawSystemPromptForConfig = detail.system_prompt || '';
        const parsedCollaborationFromDb = detail.collaboration || parseCollaborationConfigFromText(rawSystemPromptForConfig);
        const parsedCollaborationFromFile = parseCollaborationConfigFromText(rawAgentsText);
        const parsedCollaboration = parsedCollaborationFromDb || parsedCollaborationFromFile;
        setCollaborationDiscoverable(
          parsedCollaboration ? parsedCollaboration.discoverable : hasTag(detailTags, COLLAB_TAG_DISCOVERABLE),
        );
        setCollaborationDispatchEnabled(
          parsedCollaboration ? parsedCollaboration.dispatchEnabled : hasTag(detailTags, COLLAB_TAG_DISPATCH),
        );
        setCollaborationSelectedWorkers(normalizeCollaborationWorkerKeys(parsedCollaboration?.selectedWorkers || []));
        setChannelBinding(applyChannelBindingDefaults(detail.channel_binding, detail.id || id || ''));
        await loadChannelStatuses();

        const initialSystemPrompt = statePayload?.initialSystemPrompt
          ? statePayload.initialSystemPrompt
          : stripNicknamePromptBlock(detail.system_prompt || '');

        setContextFiles(mergedFiles);
        setInitialContextFiles(mergedFiles);
        setDraft(draftFromContextFiles(mergedFiles, initialSystemPrompt));
      } catch (error) {
        console.error('[EditAgent] 加载失败:', error);
        alert(error instanceof Error ? error.message : '加载智能体失败，请返回列表重试');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, location.state]);

  useEffect(() => {
    if (activeTab !== 'memory' || !id) {
      return;
    }
    void loadMemoryFiles({ page: memoryPage, pageSize: memoryPageSize });
    void loadSemanticMemories();
  }, [activeTab, id]);

  useEffect(() => {
    if (!id) {
      return;
    }
    if ((activeTab === 'skills' || activeTab === 'mcp') && !skillsMcpLoaded) {
      void loadSkillAndMcpData(id);
    }
    if (activeTab === 'workspace' && !workspaceLoaded) {
      void loadWorkspaceData(id);
    }
    if (activeTab === 'collaboration' && !collaborationLoaded) {
      void loadCollaborationCandidates(id);
    }
    if (activeTab === 'model' && !modelOptionsLoaded && currentModel) {
      void loadModelOptions(currentModel, selectedModelId);
    }
  }, [
    activeTab,
    id,
    skillsMcpLoaded,
    workspaceLoaded,
    collaborationLoaded,
    modelOptionsLoaded,
    currentModel,
    selectedModelId,
  ]);

  const reloadContextFiles = async () => {
    if (!id) {
      return;
    }
    setLoadingContextFiles(true);
    try {
      const files = await loadContextFiles(id);
      const parsedCollaboration = parseCollaborationConfigFromText(files['AGENTS.md'] || '');
      if (parsedCollaboration) {
        setCollaborationDiscoverable(parsedCollaboration.discoverable);
        setCollaborationDispatchEnabled(parsedCollaboration.dispatchEnabled);
        setCollaborationSelectedWorkers(normalizeCollaborationWorkerKeys(parsedCollaboration.selectedWorkers));
      } else {
        setCollaborationSelectedWorkers([]);
      }
      setContextFiles(files);
      setInitialContextFiles(files);
      setDraft((prev) => draftFromContextFiles(files, prev.system));
    } finally {
      setLoadingContextFiles(false);
    }
  };

  const pickAndUpload = (accept: string, handler: (file: File) => Promise<void>) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        try {
          await handler(file);
        } catch (error) {
          const message = error instanceof Error ? error.message : '上传失败';
          if (message.includes('Failed to fetch')) {
            alert('无法连接本地管理服务（网络断开或端口已变更），请重启应用后重试上传。');
            return;
          }
          alert(message);
        }
      }
    };
    input.click();
  };

  const handleUploadAvatar = async (file: File) => {
    if (!id) {
      return;
    }
    const previousUrl = avatarUrl;
    const localPreviewUrl = URL.createObjectURL(file);
    setAvatarUrl(localPreviewUrl);
    setUploadingAvatar(true);
    try {
      const result = await uploadManagementAgentAvatar(id, file);
      setAvatarUrl(result.avatarUrl);
      try {
        await patchManagementAgentConfig(id, { avatar_url: result.avatarUrl });
      } catch (syncError) {
        console.warn('[EditAgent] 头像已上传，但配置同步失败，将在保存时重试', syncError);
      }
    } catch (error) {
      setAvatarUrl(previousUrl);
      throw error;
    } finally {
      URL.revokeObjectURL(localPreviewUrl);
      setUploadingAvatar(false);
    }
  };

  const handleUploadPortrait = async (file: File) => {
    if (!id) {
      return;
    }
    const previousUrl = portraitUrl;
    const localPreviewUrl = URL.createObjectURL(file);
    setPortraitUrl(localPreviewUrl);
    setHasPortrait(true);
    setUploadingPortrait(true);
    try {
      const result = await uploadManagementAgentPortrait(id, file);
      setPortraitUrl(result.portraitUrl);
      setHasPortrait(Boolean(result.portraitUrl));
      try {
        await patchManagementAgentConfig(id, { portrait_url: result.portraitUrl });
      } catch (syncError) {
        console.warn('[EditAgent] 立绘已上传，但配置同步失败，将在保存时重试', syncError);
      }
    } catch (error) {
      setPortraitUrl(previousUrl);
      setHasPortrait(Boolean(previousUrl));
      throw error;
    } finally {
      URL.revokeObjectURL(localPreviewUrl);
      setUploadingPortrait(false);
    }
  };

  const handleToggleSkill = async (skillName: string, enabled: boolean) => {
    if (!id) {
      return;
    }
    setSavingSkillName(skillName);
    try {
      const assigned = await toggleAgentSkill(id, skillName, enabled);
      setSelectedSkills(uniqueSorted(assigned));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Skill 保存失败');
    } finally {
      setSavingSkillName(null);
    }
  };

  const handleToggleMcp = async (serverName: string, enabled: boolean) => {
    if (!id) {
      return;
    }
    setSavingMcpName(serverName);
    try {
      const assigned = await toggleAgentMcpServer(id, serverName, enabled);
      setSelectedMcpServers(uniqueSorted(assigned));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'MCP 保存失败');
    } finally {
      setSavingMcpName(null);
    }
  };

  const handleToggleCollaborationWorker = (workerKey: string) => {
    setCollaborationSelectedWorkers((prev) => {
      if (prev.includes(workerKey)) {
        return prev.filter((item) => item !== workerKey);
      }
      return uniqueStrings([...prev, workerKey]);
    });
  };

  const handleOptimize = async () => {
    if (!bio.trim() && !buildPreviewMarkdown(draft).trim()) {
      alert('请先输入简介或已有内容');
      return;
    }
    const seed = buildOptimizationSeed(bio, draft);

    setOptimizing(true);
    try {
      const result = await optimizePromptWithDefaultModel({
        input: seed,
        target: 'identity_bundle',
        provider: selectedModel?.providerId,
        model: selectedModel?.modelName,
        agentId: id,
      });
      const optimized = parseOptimizedContent(typeof result.content === 'string' ? result.content : '', draft);
      if (!hasAnyDraftContent(optimized)) {
        const fallbackMarkdown = buildLocalIdentityBundleMarkdown(bio, draft);
        const fallback = parseOptimizedContent(fallbackMarkdown, draft);
        setDraft(fallback);
        setEditorTab(resolveUpdatedEditorTab(draft, fallback));
        alert('模型未返回可解析内容，已自动使用本地模板生成。');
      } else {
        setDraft(optimized);
        setEditorTab(resolveUpdatedEditorTab(draft, optimized));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '智能生成失败';
      const fallbackMarkdown = buildLocalIdentityBundleMarkdown(bio, draft);
      const fallback = parseOptimizedContent(fallbackMarkdown, draft);
      setDraft(fallback);
      setEditorTab(resolveUpdatedEditorTab(draft, fallback));
      const notice =
        message.includes('超时') || message.includes('AbortError')
          ? '在线智能生成超时，已自动使用本地模板生成。'
          : `在线智能生成失败，已自动使用本地模板生成：${message}`;
      alert(notice);
    } finally {
      setOptimizing(false);
    }
  };

  const handleSave = async () => {
    if (!id || !selectedModel) {
      return;
    }

    const normalizedEnglishName = name.trim();
    if (normalizedEnglishName && !isValidEnglishName(normalizedEnglishName)) {
      alert('英文名称仅支持小写英文、数字和中杠（-）');
      return;
    }
    setSaving(true);
    try {
      const modelUpdate = await updateManagementAgentModel(id, {
        provider: selectedModel.providerId,
        model: selectedModel.modelName,
      });
      if (modelUpdate.model?.provider && modelUpdate.model?.model) {
        const nextProviderId = modelUpdate.model.provider;
        const nextModelName = modelUpdate.model.model;
        const nextCurrentModel = { providerId: nextProviderId, modelName: nextModelName };
        setCurrentModel(nextCurrentModel);
        setSelectedProviderId(nextProviderId);

        const synthetic: ModelOption = {
          modelId: `current:${nextProviderId}::${nextModelName}`,
          providerId: nextProviderId,
          modelName: nextModelName,
          displayName: formatCurrentModelLabel(nextProviderId, nextModelName),
        };
        setModelOptions((prev) => {
          const next: ModelOption[] = [];
          const seen = new Set<string>();
          const pushUnique = (item: ModelOption) => {
            const key = modelOptionValue(item);
            if (seen.has(key)) return;
            seen.add(key);
            next.push(item);
          };
          pushUnique(synthetic);
          prev.forEach(pushUnique);
          return next;
        });
        setSelectedModelId(modelOptionValue(synthetic));
      }

      const normalizedWorkerKeys = normalizeCollaborationWorkerKeys(collaborationSelectedWorkers);
      const effectiveWorkerKeys = normalizedWorkerKeys.filter((key) => {
        const candidate = collaborationCandidateMap.get(key);
        if (candidate) {
          return !(candidate.source === 'local' && candidate.id === id);
        }
        if (key.startsWith('local:')) {
          const localId = key.slice('local:'.length).trim();
          return localId.length > 0 && localId !== id;
        }
        return true;
      });
      if (collaborationDispatchEnabled && effectiveWorkerKeys.length === 0) {
        setActiveTab('collaboration');
        alert('请至少选择 1 个可调度员工后再保存。');
        return;
      }
      const collaborationPayload: CollaborationConfigPayload = {
        discoverable: collaborationDiscoverable,
        dispatchEnabled: collaborationDispatchEnabled,
        selectedWorkers: effectiveWorkerKeys,
      };
      const nextTags = stripCollaborationTags(tags);
      const channelBindingPayload = normalizeChannelBindingForSave(
        channelBinding,
        agentId || id || normalizedEnglishName,
      );

      const configPatch: AgentConfigPatchInput = {
        english_name: normalizedEnglishName || undefined,
        nickname: nickname.trim(),
        description: bio,
        tags: nextTags,
        collaboration: collaborationPayload,
        channel_binding: channelBindingPayload,
        system_prompt: buildPromptWithNickname(draft.system, nickname.trim()),
        avatar_url: avatarUrl || undefined,
        portrait_url: portraitUrl || undefined,
      };
      await patchManagementAgentConfig(id, configPatch);

      const nextContextFiles: Partial<Record<ManagementContextFileName, string>> = {
        ...contextFiles,
        'IDENTITY.md': draft.identity,
        'SOUL.md': draft.soul,
        'USER.md': draft.user,
        'MEMORY.md': draft.memory,
        'TOOLS.md': draft.tools,
        'AGENTS.md': draft.agents,
        'BOOTSTRAP.md': draft.bootstrap,
        'HEARTBEAT.md': draft.heartbeat,
      };

      const pendingContextSaves: Array<Promise<unknown>> = [];
      for (const fileName of EDITABLE_CONTEXT_FILES) {
        const nextValue = nextContextFiles[fileName] ?? '';
        const prevValue = initialContextFiles[fileName] ?? '';
        if (nextValue !== prevValue) {
          pendingContextSaves.push(setManagementAgentContextFile(id, fileName, nextValue));
        }
      }
      if (pendingContextSaves.length > 0) {
        await Promise.all(pendingContextSaves);
      }

      setContextFiles(nextContextFiles);
      setInitialContextFiles(nextContextFiles);
      setTags(stripCollaborationTags(nextTags));
        setDraft((prev) => ({ ...prev }));
        setCollaborationSelectedWorkers(effectiveWorkerKeys);
        await loadChannelStatuses();
        pushInAppNotice({
          title: '保存成功',
          message: '智能体配置已更新。',
          level: 'success',
        });
      } catch (error) {
        alert(error instanceof Error ? error.message : t('edit.saveFailed'));
      } finally {
        setSaving(false);
      }
  };

  const handleSearchMemoryFiles = async () => {
    const keyword = memoryKeyword.trim();
    setMemoryQueryKeyword(keyword);
    setMemoryPage(1);
    await loadMemoryFiles({
      page: 1,
      pageSize: memoryPageSize,
      startDate: memoryStartDate,
      endDate: memoryEndDate,
      keyword,
    });
  };

  const handleResetMemoryFilters = async () => {
    const range = buildLastWeekDateRange();
    setMemoryStartDate(range.start);
    setMemoryEndDate(range.end);
    setMemoryKeyword('');
    setMemoryQueryKeyword('');
    setMemoryPage(1);
    await loadMemoryFiles({
      page: 1,
      pageSize: memoryPageSize,
      startDate: range.start,
      endDate: range.end,
      keyword: '',
    });
  };

  const handleChangeMemoryPage = async (nextPage: number) => {
    const page = Math.max(1, nextPage);
    setMemoryPage(page);
    await loadMemoryFiles({ page, pageSize: memoryPageSize });
  };

  const handleChangeMemoryPageSize = async (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    setMemoryPageSize(parsed);
    setMemoryPage(1);
    await loadMemoryFiles({ page: 1, pageSize: parsed });
  };

  const handleSearchSemanticMemories = async () => {
    await loadSemanticMemories();
  };

  const handleResetSemanticMemories = async () => {
    setSemanticQuery('');
    setSemanticScope('');
    setSemanticMemoryType('');
    setSemanticMinConfidence('');
    setSemanticLimit('20');
    await loadSemanticMemories({
      q: '',
      scope: '',
      memoryType: '',
      minConfidence: '',
      limit: '20',
    });
  };

  const handleAddWorkspace = async () => {
    const value = workspaceInput.trim();
    if (!value) {
      return;
    }
    setWorkspaceInput('');
    await persistWorkspaceExtras([...workspaceExtraPaths, value]);
  };

  const handleRemoveWorkspace = async (targetPath: string) => {
    const targetKey = workspacePathKey(targetPath);
    const next = workspaceExtraPaths.filter((item) => workspacePathKey(item) !== targetKey);
    await persistWorkspaceExtras(next);
  };

  const handleDeleteAgent = async () => {
    if (!id) {
      return;
    }
    setDeletingAgent(true);
    try {
      await deleteManagementAgent(id, deleteMode);
      setDeleteDialogOpen(false);
      navigate('/agents');
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除智能体失败');
    } finally {
      setDeletingAgent(false);
    }
  };

  const handleToggleShareExportOption = (key: keyof ShareExportOptions, value: boolean) => {
    setShareExportOptions((prev) => ({ ...prev, [key]: value }));
  };

  const handleExportAgentBundle = async () => {
    if (!id) {
      return;
    }
    if (!hasSelectedShareExportOptions) {
      alert('请至少选择 1 项导出内容');
      return;
    }
    const payload: ManagementAgentExportOptions = {
      include_profile: shareExportOptions.includeProfile,
      include_context_files: shareExportOptions.includeContextFiles,
      include_memory_files: shareExportOptions.includeMemoryFiles,
      include_media_files: shareExportOptions.includeMediaFiles,
      include_assignments: shareExportOptions.includeAssignments,
    };
    setExportingBundle(true);
    try {
      const result = await downloadManagementAgentExport(id, payload);
      setShareDialogOpen(false);
      alert(`导出成功：${result.filename}（${formatBytes(result.size)}）`);
    } catch (error) {
      alert(error instanceof Error ? error.message : '导出压缩包失败');
    } finally {
      setExportingBundle(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background font-sans">
      <aside
        className="w-56 shrink-0 border-r bg-card flex flex-col z-20 overflow-hidden"
        onWheel={(event) => event.preventDefault()}
      >
        <div className="p-5 border-b">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Bot className="text-primary-foreground w-4.5 h-4.5" />
            </div>
            <span className="font-semibold text-[13px] tracking-tight text-foreground">编辑智能体</span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant={activeTab === item.id ? 'secondary' : 'ghost'}
              className={cn(
                'w-full justify-start gap-3 h-11 rounded-xl px-3 text-sm font-semibold transition-all',
                activeTab === item.id ? 'shadow-sm' : 'opacity-75 hover:opacity-100',
              )}
              onClick={() => setActiveTab(item.id)}
            >
              <item.icon className={cn('w-4 h-4', activeTab === item.id ? 'opacity-100' : 'opacity-50')} />
              {item.label}
            </Button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="h-16 shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm">
          <div>
            <h1 className="text-lg font-black tracking-tight">编辑智能体</h1>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Agent ID：{agentId || id}</p>
          </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setShareDialogOpen(true)}
                disabled={exportingBundle}
              >
                {exportingBundle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                {exportingBundle ? '导出中...' : '分享智能体'}
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => id && navigate(`/chat/${id}`)}
                disabled={!id}
              >
                <MessageSquare className="w-4 h-4" />
                进入聊天
              </Button>
              {hideHeaderSaveButton
                ? null
                : isRealtimeToggleTab ? (
                <Button variant="secondary" className="gap-2" disabled>
                  {realtimeSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {realtimeSaving ? '开关保存中...' : '开关即保存（无需点保存修改）'}
                </Button>
              ) : (
                <Button className="gap-2" onClick={handleSave} disabled={saving}>
                  <Save className="w-4 h-4" />
                  {saving ? '保存中...' : '保存修改'}
                </Button>
              )}
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto pb-20">
          <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
            {activeTab === 'basic' && (
              <Card className="rounded-3xl shadow-none border-muted-foreground/10 overflow-hidden bg-card/50">
                <CardHeader className="p-8 pb-4">
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-3">
                    <User className="w-6 h-6 text-primary" /> 基本信息
                  </CardTitle>
                  <CardDescription className="text-sm font-medium">
                    采用 OpenFang 文件级编辑模式：IDENTITY/SOUL/USER/MEMORY/TOOLS/AGENTS/BOOTSTRAP/HEARTBEAT + 系统提示词。
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-8">
                  <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-8">
                    <div className="rounded-3xl border border-border/60 bg-muted/20 p-6 flex flex-col items-center text-center gap-4 h-fit">
                      <AgentAvatar name={nickname || name || 'A'} avatarUrl={avatarUrl || undefined} size="xl" />
                      <div className="space-y-1">
                        <div className="text-sm font-black tracking-tight">{nickname || name || '未命名智能体'}</div>
                        <div className="text-[11px] text-muted-foreground font-medium break-all">{agentId || id}</div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">英文名称</Label>
                          <Input
                            value={name}
                            readOnly
                            disabled
                            className="rounded-xl h-12 bg-muted/30 border-border shadow-inner font-mono text-sm cursor-not-allowed opacity-80"
                          />
                          <p className="text-[11px] text-muted-foreground">英文名称创建后锁定，不可修改（涉及工作区路径）。</p>
                        </div>
                        <div className="space-y-3">
                          <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">显示昵称</Label>
                          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} className="rounded-xl h-12 bg-muted/20 border-border shadow-inner text-sm" />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">标签</Label>
                        <div className="min-h-12 rounded-xl bg-muted/20 border border-border shadow-inner px-3 py-2 flex flex-wrap items-center gap-2">
                          {tags.map((tag) => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="h-7 px-2.5 gap-1 rounded-lg text-xs font-bold cursor-pointer"
                              onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}
                            >
                              {tag}
                              <X className="w-3 h-3 opacity-60" />
                            </Badge>
                          ))}
                          {showTagInput ? (
                            <input
                              autoFocus
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ',') {
                                  e.preventDefault();
                                  const value = tagInput.trim();
                                  if (value && !tags.includes(value)) {
                                    setTags((prev) => [...prev, value]);
                                  }
                                  setTagInput('');
                                  setShowTagInput(false);
                                }
                              }}
                              onBlur={() => {
                                const value = tagInput.trim();
                                if (value && !tags.includes(value)) {
                                  setTags((prev) => [...prev, value]);
                                }
                                setTagInput('');
                                setShowTagInput(false);
                              }}
                              className="h-7 min-w-24 bg-background border border-primary/30 rounded-lg px-2.5 text-xs outline-none"
                            />
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs font-bold rounded-lg"
                              onClick={() => setShowTagInput(true)}
                            >
                              添加标签
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">简介 / 目标</Label>
                        <Textarea value={bio} onChange={(e) => setBio(e.target.value)} className="min-h-[96px] rounded-2xl bg-muted/20 border-border shadow-inner resize-y" />
                      </div>

                      <div className="rounded-3xl border border-border/60 overflow-hidden bg-background">
                        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20 gap-2">
                          <Tabs value={editorTab} onValueChange={(value) => setEditorTab(value as EditorTab)}>
                            <TabsList className="bg-transparent p-0 h-auto gap-1 flex-wrap">
                              {EDITOR_TAB_ITEMS.map((item) => (
                                <TabsTrigger key={item.id} value={item.id} className="data-[state=active]:bg-background rounded-lg text-sm">
                                  {item.label}
                                </TabsTrigger>
                              ))}
                            </TabsList>
                          </Tabs>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-[10px] font-bold">Markdown</Badge>
                            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={reloadContextFiles} disabled={loadingContextFiles}>
                              <RefreshCw className={cn('w-4 h-4', loadingContextFiles && 'animate-spin')} />
                              刷新
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleOptimize} disabled={optimizing}>
                              <Sparkles className={cn('w-4 h-4', optimizing && 'animate-pulse')} />
                              {optimizing ? '智能生成中...' : '智能生成'}
                            </Button>
                          </div>
                        </div>

                        <div className="p-4">
                          {editorTab === 'identity' && (
                            <Textarea
                              value={draft.identity}
                              onChange={(e) => updateDraft('identity', e.target.value)}
                              className="min-h-[620px] rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-y text-sm leading-7"
                              placeholder="填写 IDENTITY.md：定义智能体是谁、身份定位、基础个性。"
                            />
                          )}
                          {editorTab === 'soul' && (
                            <Textarea
                              value={draft.soul}
                              onChange={(e) => updateDraft('soul', e.target.value)}
                              className="min-h-[620px] rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-y text-sm leading-7"
                              placeholder="填写 SOUL.md：定义长期人格原则、行为边界、风格。"
                            />
                          )}
                          {editorTab === 'user' && (
                            <Textarea
                              value={draft.user}
                              onChange={(e) => updateDraft('user', e.target.value)}
                              className="min-h-[620px] rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-y text-sm leading-7"
                              placeholder="填写 USER.md：定义对用户的称呼、关系、互动方式。"
                            />
                          )}
                          {editorTab === 'memory' && (
                            <Textarea
                              value={draft.memory}
                              onChange={(e) => updateDraft('memory', e.target.value)}
                              className="min-h-[620px] rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-y text-sm leading-7"
                              placeholder="填写 MEMORY.md：定义长期记忆规则、记录策略。"
                            />
                          )}
                          {editorTab === 'tools' && (
                            <Textarea
                              value={draft.tools}
                              onChange={(e) => updateDraft('tools', e.target.value)}
                              className="min-h-[620px] rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-y text-sm leading-7"
                              placeholder="填写 TOOLS.md：定义工具使用规范、优先级和调用约束。"
                            />
                          )}
                          {editorTab === 'agents' && (
                            <Textarea
                              value={draft.agents}
                              onChange={(e) => updateDraft('agents', e.target.value)}
                              className="min-h-[620px] rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-y text-sm leading-7"
                              placeholder="填写 AGENTS.md：定义多智能体协作角色和分工规则。"
                            />
                          )}
                          {editorTab === 'bootstrap' && (
                            <Textarea
                              value={draft.bootstrap}
                              onChange={(e) => updateDraft('bootstrap', e.target.value)}
                              className="min-h-[620px] rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-y text-sm leading-7"
                              placeholder="填写 BOOTSTRAP.md：定义首次运行流程和初始化行为。"
                            />
                          )}
                          {editorTab === 'heartbeat' && (
                            <Textarea
                              value={draft.heartbeat}
                              onChange={(e) => updateDraft('heartbeat', e.target.value)}
                              className="min-h-[620px] rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-y text-sm leading-7"
                              placeholder="填写 HEARTBEAT.md（周期性任务提示词）：定义定时巡检/主动任务周期行为。"
                            />
                          )}
                          {editorTab === 'system' && (
                            <Textarea
                              value={draft.system}
                              onChange={(e) => updateDraft('system', e.target.value)}
                              className="min-h-[620px] rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-y text-sm leading-7"
                              placeholder="填写系统提示词：定义运行时任务边界、输出格式、约束。"
                            />
                          )}
                          {editorTab === 'preview' && (
                            <div className="min-h-[620px] rounded-2xl bg-muted/20 border border-muted-foreground/10 p-5 text-sm leading-7 whitespace-pre-wrap">
                              {buildPreviewMarkdown(draft) || '暂无内容'}
                            </div>
                          )}
                          {editorTab === 'info' && (
                            <div className="min-h-[620px] rounded-2xl bg-muted/20 border border-muted-foreground/10 p-5 space-y-3 text-sm leading-7">
                              <div><strong>IDENTITY.md</strong>：角色身份与基础形象。</div>
                              <div><strong>SOUL.md</strong>：长期人格规则和行为风格。</div>
                              <div><strong>USER.md</strong>：面向用户的关系定义与称呼策略。</div>
                              <div><strong>MEMORY.md</strong>：记忆记录范围与清理原则。</div>
                              <div><strong>TOOLS.md</strong>：工具调用规范、优先级与安全约束。</div>
                              <div><strong>AGENTS.md</strong>：多智能体协作分工与调用约束。</div>
                              <div><strong>BOOTSTRAP.md</strong>：首次运行阶段的初始化协议。</div>
                              <div><strong>HEARTBEAT.md</strong>：周期性任务提示词，用于自主巡检和定时提醒场景。</div>
                              <div><strong>系统提示词</strong>：运行时即时规则，优先影响当前任务表现。</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/60">
                    <div className="rounded-2xl border bg-muted/10 px-4 py-4 flex items-center justify-between gap-4">
                      <div className="text-sm text-muted-foreground">
                        删除操作支持“清空并删除”与“仅删除本地记录”两种模式。
                      </div>
                      <Button
                        type="button"
                        variant="default"
                        className="gap-2 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        onClick={() => setDeleteDialogOpen(true)}
                      >
                        <Trash2 className="w-4 h-4" />
                        删除智能体
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'visual' && (
              <AgentVisualEditor
                agentName={nickname || name || 'A'}
                avatarUrl={avatarUrl}
                portraitUrl={portraitUrl}
                portraitEnabled={hasPortrait}
                onPortraitEnabledChange={setHasPortrait}
                live2dEnabled={hasLive2D}
                onLive2dEnabledChange={setHasLive2D}
                onUploadAvatar={() => pickAndUpload('image/*', handleUploadAvatar)}
                onUploadPortrait={() => pickAndUpload('image/*', handleUploadPortrait)}
                uploadingAvatar={uploadingAvatar}
                uploadingPortrait={uploadingPortrait}
              />
            )}

            {activeTab === 'model' && (
              <Card className="rounded-3xl shadow-none border-muted-foreground/10 overflow-hidden bg-card/50 animate-fade-in">
                <CardHeader className="p-8 pb-4">
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-3">
                    <Bot className="w-6 h-6 text-primary" /> 模型设定
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-6">
                  <div className="space-y-3">
                    <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">供应商</Label>
                    <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                      <SelectTrigger className="h-12 rounded-xl bg-muted/20 border-border shadow-inner">
                        <SelectValue placeholder="请选择供应商" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {providerOptions.map((providerId) => (
                          <SelectItem key={providerId} value={providerId}>
                            {providerId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3">
                    <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">对话模型</Label>
                    <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                      <SelectTrigger className="h-12 rounded-xl bg-muted/20 border-border shadow-inner">
                        <SelectValue placeholder={t('edit.modelRequired')} />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {filteredModelOptions.map((option) => (
                          <SelectItem key={option.modelId} value={modelOptionValue(option)}>
                            {option.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'skills' && (
              <Card className="rounded-3xl shadow-none border-muted-foreground/10 overflow-hidden bg-card/50 animate-fade-in">
                <CardHeader className="p-8 pb-4">
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-3">
                    <Hammer className="w-6 h-6 text-primary" /> Skill 分配
                  </CardTitle>
                  <CardDescription className="text-sm font-medium">
                    已恢复真实数据加载：全局 Skill / 自定义 Skill / 系统 UI Skill，可直接为当前智能体启停。
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-6">
                  {skillsLoading ? (
                    <div className="h-36 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> 正在加载 Skill 列表...
                    </div>
                  ) : availableSkills.length === 0 ? (
                    <div className="h-36 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">
                      暂无 Skill 数据，请检查服务连接。
                    </div>
                  ) : (
                    <>
                      <div className="rounded-2xl border overflow-hidden bg-background">
                        <div className="px-4 py-2 text-xs font-black uppercase tracking-widest text-foreground/50 bg-muted/20 border-b">系统 UI Skills</div>
                        {systemUiSkills.length === 0 ? (
                          <div className="px-4 py-6 text-xs text-muted-foreground">无</div>
                        ) : (
                          systemUiSkills.map((skill, index) => {
                            const enabled = selectedSkills.includes(skill);
                            const processing = savingSkillName === skill;
                            return (
                              <div
                                key={`ui-${skill}`}
                                className={cn(
                                  'px-4 py-3 flex items-center justify-between gap-4',
                                  index !== systemUiSkills.length - 1 && 'border-b',
                                )}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                    <FileText className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{skill}</div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {skillDescriptions[skill] || '未提供功能描述'}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {processing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                                  <Switch
                                    checked={enabled}
                                    disabled={processing}
                                    onCheckedChange={(checked) => handleToggleSkill(skill, checked)}
                                  />
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="rounded-2xl border overflow-hidden bg-background">
                        <div className="px-4 py-2 text-xs font-black uppercase tracking-widest text-foreground/50 bg-muted/20 border-b">全局/自定义 Skills</div>
                        {customSkills.length === 0 ? (
                          <div className="px-4 py-6 text-xs text-muted-foreground">无</div>
                        ) : (
                          customSkills.map((skill, index) => {
                            const enabled = selectedSkills.includes(skill);
                            const processing = savingSkillName === skill;
                            return (
                              <div
                                key={`custom-${skill}`}
                                className={cn(
                                  'px-4 py-3 flex items-center justify-between gap-4',
                                  index !== customSkills.length - 1 && 'border-b',
                                )}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                    <FileText className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{skill}</div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {skillDescriptions[skill] || '未提供功能描述'}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {processing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                                  <Switch
                                    checked={enabled}
                                    disabled={processing}
                                    onCheckedChange={(checked) => handleToggleSkill(skill, checked)}
                                  />
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="rounded-2xl border overflow-hidden bg-background">
                        <div className="px-4 py-2 text-xs font-black uppercase tracking-widest text-foreground/50 bg-muted/20 border-b">系统内置 Skills</div>
                        {builtinSkills.length === 0 ? (
                          <div className="px-4 py-6 text-xs text-muted-foreground">无</div>
                        ) : (
                          builtinSkills.map((skill, index) => {
                            const enabled = selectedSkills.includes(skill);
                            const processing = savingSkillName === skill;
                            return (
                              <div
                                key={`builtin-${skill}`}
                                className={cn(
                                  'px-4 py-3 flex items-center justify-between gap-4',
                                  index !== builtinSkills.length - 1 && 'border-b',
                                )}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                    <FileText className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{skill}</div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {skillDescriptions[skill] || '未提供功能描述'}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {processing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                                  <Switch
                                    checked={enabled}
                                    disabled={processing}
                                    onCheckedChange={(checked) => handleToggleSkill(skill, checked)}
                                  />
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {otherSkills.length > 0 && (
                        <div className="rounded-2xl border overflow-hidden bg-background">
                          <div className="px-4 py-2 text-xs font-black uppercase tracking-widest text-foreground/50 bg-muted/20 border-b">其他可用 Skills</div>
                          {otherSkills.map((skill, index) => {
                            const enabled = selectedSkills.includes(skill);
                            const processing = savingSkillName === skill;
                            return (
                              <div
                                key={`other-${skill}`}
                                className={cn(
                                  'px-4 py-3 flex items-center justify-between gap-4',
                                  index !== otherSkills.length - 1 && 'border-b',
                                )}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                    <FileText className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{skill}</div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {skillDescriptions[skill] || '未提供功能描述'}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {processing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                                  <Switch
                                    checked={enabled}
                                    disabled={processing}
                                    onCheckedChange={(checked) => handleToggleSkill(skill, checked)}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === 'mcp' && (
              <Card className="rounded-3xl shadow-none border-muted-foreground/10 overflow-hidden bg-card/50 animate-fade-in">
                <CardHeader className="p-8 pb-4">
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-3">
                    <Database className="w-6 h-6 text-primary" /> MCP 分配
                  </CardTitle>
                  <CardDescription className="text-sm font-medium">
                    已恢复真实数据加载：显示在线状态并支持即时启停。
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-4">
                  {mcpLoading ? (
                    <div className="h-36 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> 正在加载 MCP 列表...
                    </div>
                  ) : availableMcpServers.length === 0 ? (
                    <div className="h-36 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">
                      暂无 MCP 数据，请检查服务连接。
                    </div>
                  ) : (
                    <div className="rounded-2xl border overflow-hidden bg-background">
                      {availableMcpServers.map((serverName, index) => {
                        const enabled = selectedMcpServers.includes(serverName);
                        const connected = connectedMcpServers.includes(serverName);
                        const processing = savingMcpName === serverName;
                        return (
                          <div
                            key={serverName}
                            className={cn(
                              'px-4 py-3 flex items-center justify-between gap-4',
                              index !== availableMcpServers.length - 1 && 'border-b',
                            )}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                <Server className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold truncate flex items-center gap-2">
                                  <span className="truncate">{serverName}</span>
                                  {connected && <Badge className="h-5">在线</Badge>}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {connected ? '已连接到运行时' : '当前未连接，启用后按需加载'}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {processing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                              <Switch
                                checked={enabled}
                                disabled={processing}
                                onCheckedChange={(checked) => handleToggleMcp(serverName, checked)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === 'channel' && (
              <Card className="rounded-3xl shadow-none border-muted-foreground/10 overflow-hidden bg-card/50 animate-fade-in">
                <CardHeader className="p-8 pb-4">
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-3">
                    <MessageSquare className="w-6 h-6 text-primary" /> 渠道绑定
                  </CardTitle>
                  <CardDescription className="text-sm font-medium">
                    仅允许绑定一个渠道。保存后会记录到智能体配置覆盖，后续用于生成 OpenFang 渠道配置。
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {CHANNEL_BINDING_OPTIONS.map((option) => {
                      const selected = channelBinding?.type === option.type;
                      const status = channelStatusMap.get(option.type);
                      const summary = summarizeChannelStatus(status);
                      const toneClass =
                        summary.tone === 'ok'
                          ? 'text-emerald-600'
                          : summary.tone === 'warn'
                            ? 'text-amber-600'
                            : summary.tone === 'error'
                              ? 'text-rose-600'
                              : 'text-muted-foreground';
                      return (
                        <button
                          key={option.type}
                          type="button"
                          onClick={() => handleSelectChannelBinding(option.type)}
                          className={cn(
                            'text-left rounded-2xl border px-4 py-3 transition-colors bg-background',
                            selected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold">{option.label}</div>
                              <div className="text-xs text-muted-foreground">{option.description}</div>
                            </div>
                            {selected && <Badge className="h-5">已选</Badge>}
                          </div>
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            环境变量：{option.envHint}
                          </div>
                          <div className={cn('mt-2 text-[11px] font-semibold', toneClass)}>
                            状态：{summary.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {!channelBinding ? (
                    <div className="rounded-2xl border bg-muted/20 px-4 py-6 text-sm text-muted-foreground text-center">
                      请选择一个渠道开始配置。
                    </div>
                  ) : (
                    <div className="rounded-2xl border bg-background p-5 space-y-6">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">当前绑定渠道：{channelBinding.type}</div>
                          <div className="text-xs text-muted-foreground">
                            默认路由智能体：{agentId || id || '未载入'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={channelStatusLoading}
                            onClick={loadChannelStatuses}
                          >
                            {channelStatusLoading ? '刷新中' : '刷新状态'}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={channelTestLoading === channelBinding.type}
                            onClick={() => handleTestChannelBinding(channelBinding.type)}
                          >
                            {channelTestLoading === channelBinding.type ? '测试中...' : '测试连接'}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={handleClearChannelBinding}>
                            解除绑定
                          </Button>
                        </div>
                      </div>

                      {selectedChannelStatus && (
                        <div className="rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1">
                          <div>状态：{summarizeChannelStatus(selectedChannelStatus).label}</div>
                          <div>配置完整：{selectedChannelStatus.configured ? '是' : '否'}</div>
                          <div>密钥就绪：{selectedChannelStatus.secrets_ready ? '是' : '否'}</div>
                          <div>已写入配置：{selectedChannelStatus.applied ? '是' : '否'}</div>
                          <div>运行时在线：{selectedChannelStatus.runtime_online ? '是' : '否'}</div>
                          {selectedChannelStatus.type === 'qqbot' && (
                            <>
                              <div>桥接连接：{selectedChannelStatus.bridge_connected ? '是' : '否'}</div>
                              {selectedChannelStatus.bridge_last_error && (
                                <div>桥接异常：{selectedChannelStatus.bridge_last_error}</div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {channelBinding.type === 'telegram' && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">Bot Token 环境变量</Label>
                              <Input
                                value={channelBinding.config.bot_token_env}
                                onChange={(e) => updateChannelBindingConfig('telegram', { bot_token_env: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">长轮询间隔（秒）</Label>
                              <Input
                                type="number"
                                value={channelBinding.config.poll_interval_secs}
                                onChange={(e) => {
                                  const next = Number.parseInt(e.target.value, 10);
                                  updateChannelBindingConfig('telegram', {
                                    poll_interval_secs: Number.isFinite(next) ? next : 1,
                                  });
                                }}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">允许用户 ID（每行一个）</Label>
                              <Textarea
                                value={formatListInput(channelBinding.config.allowed_users)}
                                onChange={(e) => updateChannelBindingConfig('telegram', { allowed_users: parseListInput(e.target.value) })}
                                className="min-h-[90px] rounded-2xl bg-muted/20 border-border shadow-inner resize-y"
                                placeholder="留空表示允许所有用户"
                              />
                            </div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1">
                            <div>绑定流程：在 Telegram 创建 Bot，获取 Bot Token。</div>
                            <div>将 Token 写入环境变量（如 `TELEGRAM_BOT_TOKEN`），名称需与上方一致。</div>
                            <div>保存后会写入 `config.toml` 的 `[channels.telegram]` 并触发 OpenFang 配置重载。</div>
                          </div>
                        </div>
                      )}

                      {channelBinding.type === 'discord' && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">Bot Token 环境变量</Label>
                              <Input
                                value={channelBinding.config.bot_token_env}
                                onChange={(e) => updateChannelBindingConfig('discord', { bot_token_env: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">Gateway Intents</Label>
                              <Input
                                type="number"
                                value={channelBinding.config.intents}
                                onChange={(e) => {
                                  const next = Number.parseInt(e.target.value, 10);
                                  updateChannelBindingConfig('discord', { intents: Number.isFinite(next) ? next : 33280 });
                                }}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">允许服务器 ID（每行一个）</Label>
                              <Textarea
                                value={formatListInput(channelBinding.config.allowed_guilds)}
                                onChange={(e) => updateChannelBindingConfig('discord', { allowed_guilds: parseListInput(e.target.value) })}
                                className="min-h-[90px] rounded-2xl bg-muted/20 border-border shadow-inner resize-y"
                                placeholder="留空表示允许所有服务器"
                              />
                            </div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1">
                            <div>绑定流程：在 Discord Developer Portal 创建应用与 Bot。</div>
                            <div>开启 Message Content Intent，并将 Bot Token 写入环境变量（如 `DISCORD_BOT_TOKEN`）。</div>
                            <div>保存后写入 `config.toml` 的 `[channels.discord]` 并触发配置重载。</div>
                          </div>
                        </div>
                      )}

                      {channelBinding.type === 'email' && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">IMAP Host</Label>
                              <Input
                                value={channelBinding.config.imap_host}
                                onChange={(e) => updateChannelBindingConfig('email', { imap_host: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">IMAP 端口</Label>
                              <Input
                                type="number"
                                value={channelBinding.config.imap_port}
                                onChange={(e) => {
                                  const next = Number.parseInt(e.target.value, 10);
                                  updateChannelBindingConfig('email', { imap_port: Number.isFinite(next) ? next : 993 });
                                }}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">SMTP Host</Label>
                              <Input
                                value={channelBinding.config.smtp_host}
                                onChange={(e) => updateChannelBindingConfig('email', { smtp_host: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">SMTP 端口</Label>
                              <Input
                                type="number"
                                value={channelBinding.config.smtp_port}
                                onChange={(e) => {
                                  const next = Number.parseInt(e.target.value, 10);
                                  updateChannelBindingConfig('email', { smtp_port: Number.isFinite(next) ? next : 587 });
                                }}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">邮箱账号</Label>
                              <Input
                                value={channelBinding.config.username}
                                onChange={(e) => updateChannelBindingConfig('email', { username: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">密码环境变量</Label>
                              <Input
                                value={channelBinding.config.password_env}
                                onChange={(e) => updateChannelBindingConfig('email', { password_env: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">轮询间隔（秒）</Label>
                              <Input
                                type="number"
                                value={channelBinding.config.poll_interval_secs}
                                onChange={(e) => {
                                  const next = Number.parseInt(e.target.value, 10);
                                  updateChannelBindingConfig('email', { poll_interval_secs: Number.isFinite(next) ? next : 30 });
                                }}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">监听文件夹（每行一个）</Label>
                              <Textarea
                                value={formatListInput(channelBinding.config.folders)}
                                onChange={(e) => updateChannelBindingConfig('email', { folders: parseListInput(e.target.value) })}
                                className="min-h-[90px] rounded-2xl bg-muted/20 border-border shadow-inner resize-y"
                                placeholder="默认 INBOX"
                              />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">允许发件人（每行一个）</Label>
                              <Textarea
                                value={formatListInput(channelBinding.config.allowed_senders)}
                                onChange={(e) => updateChannelBindingConfig('email', { allowed_senders: parseListInput(e.target.value) })}
                                className="min-h-[90px] rounded-2xl bg-muted/20 border-border shadow-inner resize-y"
                                placeholder="留空表示允许所有发件人"
                              />
                            </div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1">
                            <div>绑定流程：准备支持 IMAP/SMTP 的邮箱账号（如 Gmail 需 App Password）。</div>
                            <div>把邮箱密码写入环境变量（如 `EMAIL_PASSWORD`），名称需与上方一致。</div>
                            <div>保存后会写入 `config.toml` 的 `[channels.email]` 并触发配置重载。</div>
                          </div>
                        </div>
                      )}

                      {channelBinding.type === 'feishu' && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">App ID</Label>
                              <Input
                                value={channelBinding.config.app_id}
                                onChange={(e) => updateChannelBindingConfig('feishu', { app_id: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">App Secret 环境变量</Label>
                              <Input
                                value={channelBinding.config.app_secret_env}
                                onChange={(e) => updateChannelBindingConfig('feishu', { app_secret_env: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">Webhook 端口</Label>
                              <Input
                                type="number"
                                value={channelBinding.config.webhook_port}
                                onChange={(e) => {
                                  const next = Number.parseInt(e.target.value, 10);
                                  updateChannelBindingConfig('feishu', { webhook_port: Number.isFinite(next) ? next : 8453 });
                                }}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1">
                            <div>绑定流程：在飞书开放平台创建应用，获取 App ID 与 App Secret。</div>
                            <div>将 Secret 写入环境变量（如 `FEISHU_APP_SECRET`），名称需与上方一致。</div>
                            <div>保存后会写入 `config.toml` 的 `[channels.feishu]` 并触发配置重载。</div>
                          </div>
                        </div>
                      )}

                      {channelBinding.type === 'qqbot' && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">App ID</Label>
                              <Input
                                value={channelBinding.config.app_id}
                                onChange={(e) => updateChannelBindingConfig('qqbot', { app_id: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">App Secret</Label>
                              <Input
                                type="password"
                                value={channelBinding.config.client_secret}
                                onChange={(e) => updateChannelBindingConfig('qqbot', { client_secret: e.target.value })}
                                className="rounded-xl h-11 bg-muted/20 border-border shadow-inner"
                              />
                            </div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1">
                            <div>绑定流程：在 QQ 开放平台创建机器人，获取 AppID 与 AppSecret。</div>
                            <div>保存后会写入 `config.toml` 的 `[channels.qqbot]`（`appId`/`clientSecret`）并触发配置重载。</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === 'collaboration' && (
              <Card className="rounded-3xl shadow-none border-muted-foreground/10 overflow-hidden bg-card/50 animate-fade-in">
                <CardHeader className="p-8 pb-4">
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-3">
                    <Users className="w-6 h-6 text-primary" /> 协同办公
                  </CardTitle>
                  <CardDescription className="text-sm font-medium">
                    仅编辑页提供协同管理。保存时系统会自动生成并注入协同调度提示词，不需要手动编辑提示词文件。
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl border bg-background px-4 py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">开启被调度（被发现）</div>
                        <div className="text-xs text-muted-foreground">开启后会出现在其他调度者的“可调度员工”列表中。</div>
                      </div>
                      <Switch checked={collaborationDiscoverable} onCheckedChange={setCollaborationDiscoverable} />
                    </div>
                    <div className="rounded-2xl border bg-background px-4 py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">开启调度</div>
                        <div className="text-xs text-muted-foreground">开启后可以选择员工并在运行时委派子任务。</div>
                      </div>
                      <Switch checked={collaborationDispatchEnabled} onCheckedChange={setCollaborationDispatchEnabled} />
                    </div>
                  </div>

                  <div className="rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                    协同配置会在保存时写入 AGENTS.md 与系统提示词中的系统标记块，运行时自动加载生效。
                  </div>

                  {collaborationDispatchEnabled && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">发现可调度智能体</div>
                        <div className="text-xs text-muted-foreground">
                            只展示已开启“被调度（被发现）”的本地员工，不会出现当前智能体自身。
                        </div>
                      </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => id && void loadCollaborationCandidates(id)}
                          disabled={collaborationLoading || !id}
                        >
                          <RefreshCw className={cn('w-4 h-4', collaborationLoading && 'animate-spin')} />
                          刷新发现
                        </Button>
                      </div>

                      {collaborationLoadedAt ? (
                        <div className="text-xs text-muted-foreground">最近刷新：{formatTimeLabel(collaborationLoadedAt)}</div>
                      ) : null}

                      {collaborationLoading ? (
                        <div className="h-36 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> 正在发现可调度智能体...
                        </div>
                      ) : collaborationCandidates.length === 0 ? (
                        <div className="h-36 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">
                          暂无可调度智能体，请先在员工智能体中开启“被调度（被发现）”。
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {collaborationCandidates.map((candidate) => {
                            const selected = collaborationSelectedWorkers.includes(candidate.key);
                            return (
                              <button
                                key={candidate.key}
                                type="button"
                                onClick={() => handleToggleCollaborationWorker(candidate.key)}
                                className={cn(
                                  'text-left rounded-2xl border bg-background p-4 transition-colors',
                                  selected
                                    ? 'border-primary ring-2 ring-primary/20'
                                    : 'border-border hover:border-primary/40',
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <AgentAvatar name={candidate.name} avatarUrl={candidate.avatarUrl} size="md" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold truncate">{candidate.name}</div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {candidate.description || '暂无简介'}
                                    </div>
                                  </div>
                                  <Badge variant={selected ? 'default' : 'outline'} className="h-5">
                                    {candidate.source === 'local' ? '本地' : 'A2A'}
                                  </Badge>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="rounded-2xl border overflow-hidden bg-background">
                        <div className="px-4 py-2 text-xs font-black uppercase tracking-widest text-foreground/50 bg-muted/20 border-b">
                          已选员工
                        </div>
                        <div className="px-4 py-3 flex flex-wrap gap-2 min-h-12">
                          {selectedCollaborationWorkers.length === 0 ? (
                            <span className="text-xs text-muted-foreground">尚未选择员工</span>
                          ) : (
                            selectedCollaborationWorkers.map((worker) => (
                              <Badge
                                key={worker.key}
                                variant="secondary"
                                className="h-7 px-2.5 gap-1 rounded-lg text-xs font-bold cursor-pointer"
                                onClick={() => handleToggleCollaborationWorker(worker.key)}
                              >
                                {worker.name}
                                <X className="w-3 h-3 opacity-60" />
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === 'memory' && (
              <Card className="rounded-3xl shadow-none border-muted-foreground/10 overflow-hidden bg-card/50 animate-fade-in">
                <CardHeader className="p-8 pb-4">
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-3">
                    <BrainCircuit className="w-6 h-6 text-primary" /> 记忆管理
                  </CardTitle>
                  <CardDescription className="text-sm font-medium">
                    加载并管理 `memory` 目录下的 Markdown 文件。默认查询最近 7 天，支持分页与全屏编辑保存。
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">开始日期</Label>
                      <Input
                        type="date"
                        value={memoryStartDate}
                        onChange={(event) => setMemoryStartDate(event.target.value)}
                        className="h-10 rounded-xl bg-muted/20 border-border shadow-inner"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">结束日期</Label>
                      <Input
                        type="date"
                        value={memoryEndDate}
                        onChange={(event) => setMemoryEndDate(event.target.value)}
                        className="h-10 rounded-xl bg-muted/20 border-border shadow-inner"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">关键词</Label>
                      <Input
                        value={memoryKeyword}
                        onChange={(event) => setMemoryKeyword(event.target.value)}
                        placeholder="按文件名/路径筛选"
                        className="h-10 rounded-xl bg-muted/20 border-border shadow-inner"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">每页条数</Label>
                      <Select value={`${memoryPageSize}`} onValueChange={(value) => void handleChangeMemoryPageSize(value)}>
                        <SelectTrigger className="h-10 rounded-xl bg-muted/20 border-border shadow-inner">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="20">20</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button type="button" variant="default" onClick={() => void handleSearchMemoryFiles()} disabled={memoryLoading}>
                      查询
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void handleResetMemoryFilters()} disabled={memoryLoading}>
                      默认一周
                    </Button>
                    <div className="text-xs text-muted-foreground">共 {memoryTotal} 条</div>
                  </div>

                  {memoryLoading ? (
                    <div className="h-44 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> 正在加载记忆文件...
                    </div>
                  ) : memoryFiles.length === 0 ? (
                    <div className="h-44 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">
                      当前筛选条件下暂无记忆文件。
                    </div>
                  ) : (
                    <div className="rounded-2xl border overflow-hidden bg-background">
                      {memoryFiles.map((file, index) => (
                        <div
                          key={file.path}
                          className={cn(
                            'px-4 py-3 flex items-center justify-between gap-4',
                            index !== memoryFiles.length - 1 && 'border-b',
                          )}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{file.path}</div>
                            <div className="text-xs text-muted-foreground">
                              更新时间：{formatTimeLabel(file.modifiedMs)} · 大小：{formatBytes(file.size)}
                            </div>
                          </div>
                          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void openMemoryEditor(file.path)}>
                            <Expand className="w-4 h-4" /> 全屏编辑
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={memoryLoading || memoryPage <= 1}
                      onClick={() => void handleChangeMemoryPage(memoryPage - 1)}
                    >
                      上一页
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      第 {Math.max(1, memoryPage)} / {Math.max(1, memoryTotalPages)} 页
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={memoryLoading || memoryTotalPages === 0 || memoryPage >= memoryTotalPages}
                      onClick={() => void handleChangeMemoryPage(memoryPage + 1)}
                    >
                      下一页
                    </Button>
                  </div>

                  <div className="pt-2">
                    <div className="h-px bg-border/80 mb-6" />

                    <div className="space-y-5">
                      <div>
                        <div className="text-base font-semibold flex items-center gap-2">
                          <Database className="w-4 h-4 text-primary" />
                          {t('edit.memory.semanticTitle')}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {t('edit.memory.semanticDesc')}
                        </div>
                      </div>

                      {!semanticSupported && (
                        <div className="rounded-xl border border-amber-400/40 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                          {t('edit.memory.semanticUnsupported')}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                        <div className="space-y-2 md:col-span-2">
                          <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">
                            {t('edit.memory.semanticQuery')}
                          </Label>
                          <Input
                            value={semanticQuery}
                            onChange={(event) => setSemanticQuery(event.target.value)}
                            placeholder={t('edit.memory.semanticQueryPlaceholder')}
                            className="h-10 rounded-xl bg-muted/20 border-border shadow-inner"
                            disabled={!semanticSupported}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">
                            {t('edit.memory.semanticScope')}
                          </Label>
                          <Input
                            value={semanticScope}
                            onChange={(event) => setSemanticScope(event.target.value)}
                            placeholder={t('edit.memory.semanticScopePlaceholder')}
                            className="h-10 rounded-xl bg-muted/20 border-border shadow-inner"
                            disabled={!semanticSupported}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">
                            {t('edit.memory.semanticType')}
                          </Label>
                          <Input
                            value={semanticMemoryType}
                            onChange={(event) => setSemanticMemoryType(event.target.value)}
                            placeholder={t('edit.memory.semanticTypePlaceholder')}
                            className="h-10 rounded-xl bg-muted/20 border-border shadow-inner"
                            disabled={!semanticSupported}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">
                            {t('edit.memory.semanticMinConfidence')}
                          </Label>
                          <Input
                            value={semanticMinConfidence}
                            onChange={(event) => setSemanticMinConfidence(event.target.value)}
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            placeholder="0 - 1"
                            className="h-10 rounded-xl bg-muted/20 border-border shadow-inner"
                            disabled={!semanticSupported}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">
                            {t('edit.memory.semanticLimit')}
                          </Label>
                          <Input
                            value={semanticLimit}
                            onChange={(event) => setSemanticLimit(event.target.value)}
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            className="h-10 rounded-xl bg-muted/20 border-border shadow-inner"
                            disabled={!semanticSupported}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="default"
                          onClick={() => void handleSearchSemanticMemories()}
                          disabled={semanticLoading || !semanticSupported}
                        >
                          {t('edit.memory.semanticSearch')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleResetSemanticMemories()}
                          disabled={semanticLoading || !semanticSupported}
                        >
                          {t('edit.memory.semanticReset')}
                        </Button>
                        <div className="text-xs text-muted-foreground">
                          {t('edit.memory.semanticResultCount', { count: semanticMemories.length })}
                        </div>
                      </div>

                      {semanticLoading ? (
                        <div className="h-36 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> {t('edit.memory.semanticLoading')}
                        </div>
                      ) : semanticMemories.length === 0 ? (
                        <div className="h-36 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground">
                          {semanticSupported ? t('edit.memory.semanticEmpty') : t('edit.memory.semanticUnsupported')}
                        </div>
                      ) : (
                        <div className="rounded-2xl border overflow-hidden bg-background">
                          {semanticMemories.map((item, index) => (
                            <button
                              type="button"
                              key={item.id}
                              className={cn(
                                'w-full px-4 py-3 text-left transition-colors hover:bg-muted/20',
                                index !== semanticMemories.length - 1 && 'border-b',
                              )}
                              onClick={() => void openSemanticMemoryDetail(item.id)}
                            >
                              <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline">{item.memoryType || '-'}</Badge>
                                <Badge variant="secondary">{item.status || '-'}</Badge>
                                <span>{t('edit.memory.semanticConfidence', { value: item.confidence.toFixed(3) })}</span>
                                <span>{t('edit.memory.semanticCreatedAt', { value: formatIsoTimeLabel(item.createdAt) })}</span>
                              </div>
                              <div className="mt-2 text-sm whitespace-pre-wrap break-words line-clamp-2">
                                {item.content || '-'}
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {([
                                  'confirm',
                                  'weaken',
                                  'outdated',
                                  'revoke',
                                  'reject',
                                ] as SemanticFeedbackAction[]).map((action) => {
                                  const actionKey = `${item.id}:${action}`;
                                  const submitting = semanticFeedbackKey === actionKey;
                                  return (
                                    <Button
                                      key={action}
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-xs"
                                      disabled={!semanticSupported || Boolean(semanticFeedbackKey)}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleSemanticFeedback(item.id, action);
                                      }}
                                    >
                                      {submitting ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        t(`edit.memory.semanticActions.${action}`)
                                      )}
                                    </Button>
                                  );
                                })}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  disabled={!semanticSupported || Boolean(semanticFeedbackKey)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openSemanticCorrectDialog(item);
                                  }}
                                >
                                  {t('edit.memory.semanticActions.correct')}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 px-2 text-xs"
                                  disabled={!semanticSupported || Boolean(semanticFeedbackKey)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteSemanticMemory(item.id);
                                  }}
                                >
                                  {semanticFeedbackKey === `${item.id}:delete` ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    t('edit.memory.semanticActions.delete')
                                  )}
                                </Button>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'workspace' && (
              <Card className="rounded-3xl shadow-none border-muted-foreground/10 overflow-hidden bg-card/50 animate-fade-in">
                <CardHeader className="p-8 pb-4">
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-3">
                    <Settings2 className="w-6 h-6 text-primary" /> 工作空间
                  </CardTitle>
                  <CardDescription className="text-sm font-medium">
                    固定私有目录与共享目录不可修改；可追加额外目录。新增/删除后立即保存并通过 MCP 生效。
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-5">
                  {workspaceLoading ? (
                    <div className="h-40 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> 正在加载工作空间...
                    </div>
                  ) : (
                    <>
                      <div className="rounded-2xl border overflow-hidden bg-background">
                        <div className="px-4 py-2 text-xs font-black uppercase tracking-widest text-foreground/50 bg-muted/20 border-b">
                          固定工作空间（只读）
                        </div>
                        <div className="px-4 py-3 border-b">
                          <div className="text-xs text-muted-foreground mb-1">私有工作空间（固定）</div>
                          <div className="text-sm font-mono break-all">{workspacePrivatePath || '-'}</div>
                        </div>
                        <div className="px-4 py-3">
                          <div className="text-xs text-muted-foreground mb-1">共享工作空间（固定）</div>
                          <div className="text-sm font-mono break-all">{workspaceSharedPath || '-'}</div>
                        </div>
                      </div>

                      <div className="rounded-2xl border overflow-hidden bg-background">
                        <div className="px-4 py-2 text-xs font-black uppercase tracking-widest text-foreground/50 bg-muted/20 border-b">
                          额外工作空间（可编辑）
                        </div>
                        <div className="p-4 flex flex-col md:flex-row gap-3">
                          <Input
                            value={workspaceInput}
                            onChange={(event) => setWorkspaceInput(event.target.value)}
                            placeholder="请输入绝对路径，例如：D:\\datasets\\project-a"
                            className="h-10 rounded-xl bg-muted/20 border-border shadow-inner font-mono text-xs"
                            disabled={workspaceSaving || workspaceLoading}
                          />
                          <Button
                            type="button"
                            variant="default"
                            className="gap-2 shrink-0"
                            onClick={() => void handleAddWorkspace()}
                            disabled={workspaceSaving || workspaceLoading || !workspaceInput.trim()}
                          >
                            <Plus className="w-4 h-4" /> 添加目录
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="gap-2 shrink-0"
                            onClick={() => id && void loadWorkspaceData(id)}
                            disabled={workspaceSaving || workspaceLoading}
                          >
                            <RefreshCw className={cn('w-4 h-4', workspaceLoading && 'animate-spin')} /> 刷新
                          </Button>
                        </div>
                        <div className="border-t">
                          {workspaceExtraPaths.length === 0 ? (
                            <div className="px-4 py-6 text-sm text-muted-foreground">
                              暂无额外目录。默认已自动包含私有与共享工作空间。
                            </div>
                          ) : (
                            workspaceExtraPaths.map((item, index) => (
                              <div
                                key={item}
                                className={cn(
                                  'px-4 py-3 flex items-center justify-between gap-3',
                                  index !== workspaceExtraPaths.length - 1 && 'border-b',
                                )}
                              >
                                <div className="min-w-0 flex items-center gap-2">
                                  <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                                  <div className="text-sm font-mono break-all">{item}</div>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => void handleRemoveWorkspace(item)}
                                  disabled={workspaceSaving || workspaceLoading}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1">
                        <div>规则：工作空间能力由系统自动维护并强制启用，无需手动配置 MCP。</div>
                        <div>新增/删除目录后会自动同步生效。</div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>

      <Dialog
        open={memoryEditorOpen}
        onOpenChange={(open) => {
          setMemoryEditorOpen(open);
          if (!open) {
            setMemoryEditorPath('');
            setMemoryEditorContent('');
          }
        }}
      >
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle>全屏编辑记忆文件</DialogTitle>
            <DialogDescription className="text-xs font-mono break-all">{memoryEditorPath || '未选择文件'}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 p-4">
            {memoryEditorLoading ? (
              <div className="h-full rounded-2xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> 正在加载文件内容...
              </div>
            ) : (
              <Textarea
                value={memoryEditorContent}
                onChange={(event) => setMemoryEditorContent(event.target.value)}
                className="h-full min-h-full rounded-2xl bg-muted/20 border-muted-foreground/10 shadow-inner resize-none text-sm leading-7 font-mono"
                placeholder="在这里编辑完整 Markdown 记忆内容..."
              />
            )}
          </div>

          <div className="px-6 py-3 border-t flex items-center justify-between shrink-0 bg-background/95">
            <div className="text-xs text-muted-foreground">支持 Markdown 全量编辑，保存后直接写入 memory 文件。</div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMemoryEditorOpen(false)}
                disabled={memoryEditorSaving}
              >
                关闭
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveMemoryFile()}
                disabled={memoryEditorLoading || memoryEditorSaving || !memoryEditorPath}
              >
                {memoryEditorSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    保存到文件
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={semanticDetailOpen}
        onOpenChange={(open) => {
          setSemanticDetailOpen(open);
          if (!open) {
            setSemanticDetailItem(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('edit.memory.semanticDetailTitle')}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">
              {semanticDetailItem?.id || '-'}
            </DialogDescription>
          </DialogHeader>

          {semanticDetailLoading ? (
            <div className="h-44 rounded-xl border bg-muted/20 flex items-center justify-center text-sm text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('edit.memory.semanticDetailLoading')}
            </div>
          ) : semanticDetailItem ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{semanticDetailItem.memoryType || '-'}</Badge>
                <Badge variant="secondary">{semanticDetailItem.status || '-'}</Badge>
                <span>{t('edit.memory.semanticConfidence', { value: semanticDetailItem.confidence.toFixed(3) })}</span>
                <span>{t('edit.memory.semanticCreatedAt', { value: formatIsoTimeLabel(semanticDetailItem.createdAt) })}</span>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4 text-sm whitespace-pre-wrap break-words max-h-[42vh] overflow-y-auto">
                {semanticDetailItem.content || '-'}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('edit.memory.semanticEntityKey', { value: semanticDetailItem.entityKey || '-' })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{t('edit.memory.semanticDetailEmpty')}</div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={semanticCorrectOpen}
        onOpenChange={(open) => {
          if (semanticCorrectSubmitting) {
            return;
          }
          setSemanticCorrectOpen(open);
          if (!open) {
            setSemanticCorrectTarget(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('edit.memory.semanticCorrectTitle')}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">
              {semanticCorrectTarget?.id || '-'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('edit.memory.semanticCorrectReason')}</Label>
              <Input
                value={semanticCorrectReason}
                onChange={(event) => setSemanticCorrectReason(event.target.value)}
                placeholder={t('edit.memory.semanticCorrectReasonPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('edit.memory.semanticCorrectContent')}</Label>
              <Textarea
                value={semanticCorrectContent}
                onChange={(event) => setSemanticCorrectContent(event.target.value)}
                className="min-h-52"
                placeholder={t('edit.memory.semanticCorrectContentPlaceholder')}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={semanticCorrectSubmitting}
              onClick={() => setSemanticCorrectOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={semanticCorrectSubmitting || !semanticCorrectTarget}
              onClick={() => void handleSubmitSemanticCorrection()}
            >
              {semanticCorrectSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('edit.memory.semanticCorrectSubmitting')}
                </>
              ) : (
                t('edit.memory.semanticCorrectSubmit')
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shareDialogOpen} onOpenChange={(open) => !exportingBundle && setShareDialogOpen(open)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>分享智能体</DialogTitle>
            <DialogDescription>
              选择需要导出的信息后，将自动生成 ZIP 压缩包，便于在其他电脑导入恢复。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-xl border p-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">基础资料</div>
                <div className="text-xs text-muted-foreground mt-1">包含智能体详情、模型配置、本地 profile 覆盖。</div>
              </div>
              <Switch
                checked={shareExportOptions.includeProfile}
                onCheckedChange={(checked) => handleToggleShareExportOption('includeProfile', checked)}
                disabled={exportingBundle}
              />
            </div>
            <div className="rounded-xl border p-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">身份文件</div>
                <div className="text-xs text-muted-foreground mt-1">导出 IDENTITY/SOUL/USER/MEMORY/TOOLS/AGENTS/BOOTSTRAP/HEARTBEAT。</div>
              </div>
              <Switch
                checked={shareExportOptions.includeContextFiles}
                onCheckedChange={(checked) => handleToggleShareExportOption('includeContextFiles', checked)}
                disabled={exportingBundle}
              />
            </div>
            <div className="rounded-xl border p-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">记忆文件</div>
                <div className="text-xs text-muted-foreground mt-1">导出智能体工作区 memory 目录下的文件。</div>
              </div>
              <Switch
                checked={shareExportOptions.includeMemoryFiles}
                onCheckedChange={(checked) => handleToggleShareExportOption('includeMemoryFiles', checked)}
                disabled={exportingBundle}
              />
            </div>
            <div className="rounded-xl border p-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">头像与立绘</div>
                <div className="text-xs text-muted-foreground mt-1">导出智能体 `agent_profile` 下的头像和立绘资源。</div>
              </div>
              <Switch
                checked={shareExportOptions.includeMediaFiles}
                onCheckedChange={(checked) => handleToggleShareExportOption('includeMediaFiles', checked)}
                disabled={exportingBundle}
              />
            </div>
            <div className="rounded-xl border p-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">分配与关联配置</div>
                <div className="text-xs text-muted-foreground mt-1">导出 skills/mcp/workspaces/协同 ACL 等本地分配信息。</div>
              </div>
              <Switch
                checked={shareExportOptions.includeAssignments}
                onCheckedChange={(checked) => handleToggleShareExportOption('includeAssignments', checked)}
                disabled={exportingBundle}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShareDialogOpen(false)}
              disabled={exportingBundle}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void handleExportAgentBundle()}
              disabled={exportingBundle || !hasSelectedShareExportOptions}
            >
              {exportingBundle ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4 mr-2" />
                  生成压缩包并下载
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={(open) => !deletingAgent && setDeleteDialogOpen(open)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>删除智能体</DialogTitle>
            <DialogDescription>
              请选择删除方式。执行后立即生效，请确认后再操作。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <button
              type="button"
              className={cn(
                'w-full text-left rounded-xl border p-4 transition-colors',
                deleteMode === 'purge' ? 'border-zinc-900 bg-zinc-900/5 dark:border-zinc-100 dark:bg-zinc-100/10' : 'border-border hover:bg-muted/20',
              )}
              onClick={() => setDeleteMode('purge')}
              disabled={deletingAgent}
            >
              <div className="text-sm font-semibold text-foreground">清空并删除（workspace + sqlite + openfang）</div>
              <div className="text-xs text-muted-foreground mt-1">
                删除 OpenFang 智能体、清理该智能体本地数据库记录，并删除该智能体工作空间目录。
              </div>
            </button>
            <button
              type="button"
              className={cn(
                'w-full text-left rounded-xl border p-4 transition-colors',
                deleteMode === 'local_only' ? 'border-zinc-900 bg-zinc-900/5 dark:border-zinc-100 dark:bg-zinc-100/10' : 'border-border hover:bg-muted/20',
              )}
              onClick={() => setDeleteMode('local_only')}
              disabled={deletingAgent}
            >
              <div className="text-sm font-semibold text-foreground">仅删除本地记录（sqlite）</div>
              <div className="text-xs text-muted-foreground mt-1">
                不删除 workspace 文件夹，不删除 OpenFang；仅从首页列表移除（后续可再导入）。
              </div>
            </button>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deletingAgent}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="default"
              className="bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              onClick={() => void handleDeleteAgent()}
              disabled={deletingAgent}
            >
              {deletingAgent ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  删除中...
                </>
              ) : deleteMode === 'purge' ? (
                '清空并删除'
              ) : (
                '仅删除本地记录'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
