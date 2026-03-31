import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Camera,
  Database,
  FileText,
  Hammer,
  Loader2,
  Plus,
  Server,
  Sparkles,
  User,
  X,
} from 'lucide-react';

import { AgentVisualEditor } from '@/components/agent/AgentVisualEditor';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatModelLabel } from '@/lib/model-label';
import {
  type AgentConfigPatchInput,
  patchManagementAgentConfig,
  createAgentFromManifest,
  getGlobalSkills,
  getManagementMcpServers,
  listManagementModels,
  type ManagementContextFileName,
  optimizePromptWithDefaultModel,
  setAgentMcpAssignments,
  setAgentSkillAssignments,
  setManagementAgentContextFile,
  updateManagementAgentModel,
  uploadManagementAgentAvatar,
  uploadManagementAgentPortrait,
} from '@/services/management-client';

interface ModelOption {
  modelId: string;
  providerId: string;
  modelName: string;
  displayName: string;
  enabled?: boolean;
  isDefault?: boolean;
}

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
    `display_name=${JSON.stringify(trimmedNickname)}`,
    'identity_reply.preferred_field=display_name',
    'identity_reply.forbid=["agent_id","english_name","model_name"]',
    '[WEBOT_NICKNAME_END]',
  ].join('\n');
  return `${nicknameBlock}\n\n${base}`.trim();
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
  component: string[];
  systemUi: string[];
  descriptions: Record<string, string>;
}

type SkillViewTab = 'system' | 'component' | 'custom';

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function buildGlobalSkillCatalog(payload: Awaited<ReturnType<typeof getGlobalSkills>>): SkillCatalog {
  if (payload.items.length > 0) {
    const builtin: string[] = [];
    const custom: string[] = [];
    const component: string[] = [];
    const systemUi: string[] = [];
    const all: string[] = [];
    const descriptions: Record<string, string> = {};

    for (const item of payload.items) {
      const name = item.name.trim();
      if (!name) {
        continue;
      }
      all.push(name);
      if (item.description?.trim()) {
        descriptions[name] = item.description.trim();
      }
      if (item.category === 'system_ui') {
        systemUi.push(name);
        continue;
      }
      if (item.category === 'builtin') {
        builtin.push(name);
        continue;
      }
      if (item.category === 'component') {
        component.push(name);
        continue;
      }
      custom.push(name);
    }

    return {
      all: uniqueSorted(all),
      custom: uniqueSorted(custom),
      builtin: uniqueSorted(builtin),
      component: uniqueSorted(component),
      systemUi: uniqueSorted(systemUi),
      descriptions,
    };
  }

  const runtimeNames: string[] = [];
  const runtimeBuiltin: string[] = [];
  const runtimeCustom: string[] = [];
  const runtimeComponent: string[] = [];
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
      continue;
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
  const component = uniqueSorted(runtimeComponent);
  const systemUi = uniqueSorted(runtimeUi);
  const all = uniqueSorted([...runtimeNames, ...importedNames, ...localNames]);
  for (const imported of payload.imported) {
    pushDescription(imported.name, imported.description);
  }
  return { all, custom, builtin, component, systemUi, descriptions };
}

export function CreateAgentPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('basic');
  const [editorTab, setEditorTab] = useState<EditorTab>('identity');
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [draft, setDraft] = useState<ContextDraft>(EMPTY_DRAFT);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
  const [portraitPreviewUrl, setPortraitPreviewUrl] = useState('');
  const [hasPortrait, setHasPortrait] = useState(false);
  const [hasLive2D, setHasLive2D] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [builtinSkills, setBuiltinSkills] = useState<string[]>([]);
  const [componentSkills, setComponentSkills] = useState<string[]>([]);
  const [customSkills, setCustomSkills] = useState<string[]>([]);
  const [systemUiSkills, setSystemUiSkills] = useState<string[]>([]);
  const [skillDescriptions, setSkillDescriptions] = useState<Record<string, string>>({});
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillViewTab, setSkillViewTab] = useState<SkillViewTab>('system');
  const [availableMcpServers, setAvailableMcpServers] = useState<string[]>([]);
  const [connectedMcpServers, setConnectedMcpServers] = useState<string[]>([]);
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);

  const generatedAgentId = useMemo(() => previewAgentId(name), [name]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const loaded = await listManagementModels();
        const enabledModels = loaded.models.filter((item) => item.enabled);
        const options = enabledModels.length > 0 ? enabledModels : loaded.models;
        setModelOptions(options);
        if (options.length > 0) {
          const preferred = options.find((item) => item.isDefault) ?? options[0];
          setSelectedProviderId(preferred.providerId);
          setSelectedModelId(preferred.modelId);
        }
      } catch (error) {
        console.error('[CreateAgent] 加载模型失败:', error);
      }
    };

    loadModels();
  }, []);

  useEffect(() => {
    const loadCapabilities = async () => {
      setSkillsLoading(true);
      setMcpLoading(true);
      try {
        const [skillsPayload, mcpPayload] = await Promise.all([
          getGlobalSkills(),
          getManagementMcpServers(),
        ]);
        const skillCatalog = buildGlobalSkillCatalog(skillsPayload);
        setAvailableSkills(skillCatalog.all);
        setBuiltinSkills(skillCatalog.builtin);
        setComponentSkills(skillCatalog.component);
        setCustomSkills(skillCatalog.custom);
        setSystemUiSkills(skillCatalog.systemUi);
        setSkillDescriptions(skillCatalog.descriptions);

        const configured = uniqueSorted(mcpPayload.configured.map((item) => item.name));
        const connected = uniqueSorted(mcpPayload.connected.map((item) => item.name));
        setAvailableMcpServers(uniqueSorted([...configured, ...connected]));
        setConnectedMcpServers(connected);
      } catch (error) {
        console.error('[CreateAgent] 加载 Skill/MCP 失败:', error);
      } finally {
        setSkillsLoading(false);
        setMcpLoading(false);
      }
    };

    loadCapabilities();
  }, []);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
      if (portraitPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(portraitPreviewUrl);
      }
    };
  }, [avatarPreviewUrl, portraitPreviewUrl]);

  const selectedModel = useMemo(
    () => modelOptions.find((item) => item.modelId === selectedModelId) ?? null,
    [modelOptions, selectedModelId],
  );

  const providerOptions = useMemo(() => {
    const providers = uniqueSorted(modelOptions.map((item) => item.providerId).filter(Boolean));
    if (selectedProviderId && !providers.includes(selectedProviderId)) {
      return uniqueSorted([selectedProviderId, ...providers]);
    }
    return providers;
  }, [modelOptions, selectedProviderId]);

  const filteredModelOptions = useMemo(() => {
    if (!selectedProviderId) {
      return modelOptions;
    }
    return modelOptions.filter((item) => item.providerId === selectedProviderId);
  }, [modelOptions, selectedProviderId]);

  useEffect(() => {
    if (!selectedProviderId) {
      return;
    }
    if (filteredModelOptions.length === 0) {
      return;
    }
    if (filteredModelOptions.some((item) => item.modelId === selectedModelId)) {
      return;
    }
    const preferred = filteredModelOptions.find((item) => item.isDefault) ?? filteredModelOptions[0];
    if (preferred) {
      setSelectedModelId(preferred.modelId);
    }
  }, [filteredModelOptions, selectedModelId, selectedProviderId]);

  const pickPreferredModel = (options: ModelOption[]): ModelOption | null => {
    if (options.length === 0) {
      return null;
    }
    const bySelected = options.find((item) => item.modelId === selectedModelId);
    if (bySelected) {
      return bySelected;
    }
    const byDefault = options.find((item) => item.isDefault);
    if (byDefault) {
      return byDefault;
    }
    const enabled = options.filter((item) => item.enabled);
    return (enabled[0] ?? options[0]) || null;
  };
  const systemSkillGroup = useMemo(
    () => uniqueSorted([...systemUiSkills, ...builtinSkills]),
    [builtinSkills, systemUiSkills],
  );
  const componentSkillGroup = useMemo(
    () => uniqueSorted(componentSkills),
    [componentSkills],
  );
  const customSkillGroup = useMemo(() => {
    const systemSet = new Set(systemSkillGroup);
    const componentSet = new Set(componentSkillGroup);
    const customSet = new Set(customSkills);
    const uncategorized = availableSkills.filter(
      (item) => !systemSet.has(item) && !componentSet.has(item) && !customSet.has(item),
    );
    return uniqueSorted([...customSkills, ...uncategorized]);
  }, [availableSkills, componentSkillGroup, customSkills, systemSkillGroup]);
  const skillSections = [
    {
      key: 'system' as const,
      label: `系统内置 (${systemSkillGroup.length})`,
      title: '系统内置 Skill',
      description: '包含系统默认能力与 ui-skill。这里只能给当前智能体开启或关闭，不能删除、不能修改。',
      empty: '当前没有系统内置 skill。',
      skills: systemSkillGroup,
    },
    {
      key: 'component' as const,
      label: `组件 Skill (${componentSkillGroup.length})`,
      title: '组件 Skill',
      description: '来自组件中心生成的 ComfyUI / RunningHub 等 skill。删除或修改请前往组件中心，这里只做启停。',
      empty: '当前还没有组件 skill，可先去组件中心创建。',
      skills: componentSkillGroup,
    },
    {
      key: 'custom' as const,
      label: `自定义 Skill (${customSkillGroup.length})`,
      title: '自定义 Skill',
      description: '由设置页全局管理。这里仅决定新建智能体默认是否启用，不负责新增和删除。',
      empty: '当前没有自定义 skill，可在设置里的“自定义SKILL”中导入。',
      skills: customSkillGroup,
    },
  ];

  const navItems = [
    { id: 'basic', label: t('edit.nav.basic'), icon: User },
    { id: 'visual', label: t('edit.nav.visual'), icon: Camera },
    { id: 'model', label: '模型设定', icon: Bot },
    { id: 'skills', label: t('edit.nav.skills'), icon: Hammer },
    { id: 'mcp', label: t('edit.nav.mcp'), icon: Database },
  ];

  const updateDraft = (key: keyof ContextDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const pickLocalImage = (accept: string, handler: (file: File) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        handler(file);
      }
    };
    input.click();
  };

  const handlePickAvatar = (file: File) => {
    setAvatarFile(file);
    setAvatarPreviewUrl((prev) => {
      if (prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });
  };

  const handlePickPortrait = (file: File) => {
    setPortraitFile(file);
    setPortraitPreviewUrl((prev) => {
      if (prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });
    setHasPortrait(true);
  };

  const toggleSkillSelection = (skillName: string, enabled: boolean) => {
    setSelectedSkills((prev) => {
      if (enabled) {
        return uniqueSorted([...prev, skillName]);
      }
      return prev.filter((item) => item !== skillName);
    });
  };

  const toggleMcpSelection = (serverName: string, enabled: boolean) => {
    setSelectedMcpServers((prev) => {
      if (enabled) {
        return uniqueSorted([...prev, serverName]);
      }
      return prev.filter((item) => item !== serverName);
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

  const handleCreate = async () => {
    const normalizedName = normalizeEnglishNameInput(name.trim());
    if (!normalizedName) {
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedName)) {
      alert('英文名称仅支持小写英文、数字和中杠（-），且不能以中杠开头或结尾');
      return;
    }
    setSaving(true);
    try {
      let effectiveModel = selectedModel;
      if (!effectiveModel) {
        const loaded = await listManagementModels();
        const enabledModels = loaded.models.filter((item) => item.enabled);
        const options = enabledModels.length > 0 ? enabledModels : loaded.models;
        setModelOptions(options);
        effectiveModel = pickPreferredModel(options);
        if (effectiveModel) {
          setSelectedProviderId(effectiveModel.providerId);
          setSelectedModelId(effectiveModel.modelId);
        }
      }
      if (!effectiveModel) {
        alert('未找到可用模型，请先在设置中配置并启用默认模型');
        return;
      }

      const manifestToml = buildAgentManifestToml({
        name: normalizedName,
        description: bio,
        tags,
        provider: effectiveModel.providerId,
        model: effectiveModel.modelName,
        systemPrompt: buildPromptWithNickname(draft.system, nickname.trim()),
      });
      const created = await createAgentFromManifest(manifestToml);
      await updateManagementAgentModel(created.agentId, {
        provider: effectiveModel.providerId,
        model: effectiveModel.modelName,
      });
      let uploadedAvatarUrl = avatarPreviewUrl;
      let uploadedPortraitUrl = portraitPreviewUrl;

      if (avatarFile) {
        const avatarResult = await uploadManagementAgentAvatar(created.agentId, avatarFile);
        uploadedAvatarUrl = avatarResult.avatarUrl;
      }
      if (portraitFile) {
        const portraitResult = await uploadManagementAgentPortrait(created.agentId, portraitFile);
        uploadedPortraitUrl = portraitResult.portraitUrl;
      }

      if (selectedSkills.length > 0) {
        await setAgentSkillAssignments(created.agentId, selectedSkills);
      }
      if (selectedMcpServers.length > 0) {
        await setAgentMcpAssignments(created.agentId, selectedMcpServers);
      }

      const configPatch: AgentConfigPatchInput = {};
      configPatch.english_name = normalizedName;
      const normalizedNickname = nickname.trim();
      if (normalizedNickname) {
        configPatch.nickname = normalizedNickname;
      }
      if (uploadedAvatarUrl.trim()) {
        configPatch.avatar_url = uploadedAvatarUrl.trim();
      }
      if (uploadedPortraitUrl.trim()) {
        configPatch.portrait_url = uploadedPortraitUrl.trim();
      }
      if (Object.keys(configPatch).length > 0) {
        await patchManagementAgentConfig(created.agentId, configPatch);
      }

      const contextEntries: Array<[ManagementContextFileName, string]> = [
        ['IDENTITY.md', draft.identity],
        ['SOUL.md', draft.soul],
        ['USER.md', draft.user],
        ['MEMORY.md', draft.memory],
        ['TOOLS.md', draft.tools],
        ['AGENTS.md', draft.agents],
        ['BOOTSTRAP.md', draft.bootstrap],
        ['HEARTBEAT.md', draft.heartbeat],
      ];
      for (const [fileName, content] of contextEntries) {
        const normalizedContent = content.trim();
        if (normalizedContent) {
          await setManagementAgentContextFile(created.agentId, fileName, content);
        }
      }

      navigate(`/edit/${created.agentId}`, {
        state: {
          initialContextFiles: {
            'IDENTITY.md': draft.identity,
            'SOUL.md': draft.soul,
            'USER.md': draft.user,
            'MEMORY.md': draft.memory,
            'TOOLS.md': draft.tools,
            'AGENTS.md': draft.agents,
            'BOOTSTRAP.md': draft.bootstrap,
            'HEARTBEAT.md': draft.heartbeat,
          },
          initialSystemPrompt: draft.system,
          initialAvatarUrl: uploadedAvatarUrl,
          initialPortraitUrl: uploadedPortraitUrl,
        },
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : t('edit.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

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
            <span className="font-semibold text-[13px] tracking-tight text-foreground">{t('create.title')}</span>
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
            <h1 className="text-lg font-black tracking-tight">{t('create.title')}</h1>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Agent ID：{generatedAgentId}</p>
          </div>
          <Button size="sm" className="gap-2" onClick={handleCreate} disabled={!name || saving}>
            <Plus className="w-4 h-4" />
            {saving ? '保存中...' : t('create.submit')}
          </Button>
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
                    按 OpenFang 上下文文件拆分编辑：每个文件一个 Tab，并单独维护系统提示词。
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-8">
                  <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-8">
                    <div className="rounded-3xl border border-border/60 bg-muted/20 p-6 flex flex-col items-center text-center gap-4 h-fit">
                      <AgentAvatar
                        name={nickname || name || 'A'}
                        avatarUrl={avatarPreviewUrl || undefined}
                        size="xl"
                      />
                      <div className="space-y-1">
                        <div className="text-sm font-black tracking-tight">{nickname || name || '未命名智能体'}</div>
                        <div className="text-[11px] text-muted-foreground font-medium break-all">{generatedAgentId}</div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">英文名称</Label>
                          <Input
                            value={name}
                            onChange={(e) => setName(normalizeEnglishNameInput(e.target.value))}
                            placeholder="例如：star-assistant"
                            className="rounded-xl h-12 bg-muted/20 border-border shadow-inner font-mono text-sm"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            创建后会自动生成固定私有工作空间：`C:\Users\Administrator\.webot\workspaces\英文名称`，并接入共享空间 `C:\Users\Administrator\.webot\shared`。
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            仅允许：小写英文（a-z）/ 数字（0-9）/ 中杠（-）。
                          </p>
                        </div>
                        <div className="space-y-3">
                          <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">显示昵称</Label>
                          <Input
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            placeholder="例如：小米"
                            className="rounded-xl h-12 bg-muted/20 border-border shadow-inner text-sm"
                          />
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
                      </div>

                      <div className="space-y-3">
                        <Label className="text-xs font-black uppercase tracking-widest text-foreground/50 ml-1">简介 / 目标</Label>
                        <Textarea
                          value={bio}
                          onChange={(e) => setBio(e.target.value)}
                          className="min-h-[96px] rounded-2xl bg-muted/20 border-border shadow-inner resize-y"
                        />
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
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={handleOptimize}
                              disabled={optimizing}
                            >
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
                </CardContent>
              </Card>
            )}

            {activeTab === 'visual' && (
              <AgentVisualEditor
                agentName={nickname || name || 'A'}
                avatarUrl={avatarPreviewUrl || undefined}
                portraitUrl={portraitPreviewUrl || undefined}
                portraitEnabled={hasPortrait}
                onPortraitEnabledChange={setHasPortrait}
                live2dEnabled={hasLive2D}
                onLive2dEnabledChange={setHasLive2D}
                onUploadAvatar={() => pickLocalImage('image/*', handlePickAvatar)}
                onUploadPortrait={() => pickLocalImage('image/*', handlePickPortrait)}
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
                          <SelectItem key={option.modelId} value={option.modelId}>
                            {formatModelLabel(option.providerId, option.modelName, option.displayName)}
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
                    <Hammer className="w-6 h-6 text-primary" /> Skill 选择
                  </CardTitle>
                  <CardDescription className="text-sm font-medium">
                    预设智能体可用 Skill（创建后自动写入分配）。已按系统内置、组件、自定义三类整理。
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
                      <Tabs value={skillViewTab} onValueChange={(value) => setSkillViewTab(value as SkillViewTab)} className="space-y-4">
                        <TabsList className="grid h-auto grid-cols-3 rounded-2xl bg-muted/30 p-1">
                          {skillSections.map((section) => (
                            <TabsTrigger
                              key={section.key}
                              value={section.key}
                              className="rounded-xl px-3 py-2 text-xs font-black tracking-wide"
                            >
                              {section.label}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>

                      {skillSections.map((section) => (
                        section.key === skillViewTab ? (
                          <div key={section.key} className="rounded-2xl border overflow-hidden bg-background">
                            <div className="border-b bg-muted/20 px-4 py-3">
                              <div className="text-sm font-semibold text-foreground">{section.title}</div>
                              <div className="mt-1 text-xs leading-5 text-muted-foreground">{section.description}</div>
                            </div>
                            {section.skills.length === 0 ? (
                              <div className="px-4 py-8 text-sm text-muted-foreground">{section.empty}</div>
                            ) : (
                              section.skills.map((skill, index) => {
                                const enabled = selectedSkills.includes(skill);
                                return (
                                  <div
                                    key={`${section.key}-${skill}`}
                                    className={cn(
                                      'px-4 py-3 flex items-center justify-between gap-4',
                                      index !== section.skills.length - 1 && 'border-b',
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
                                    <Switch
                                      checked={enabled}
                                      onCheckedChange={(checked) => toggleSkillSelection(skill, checked)}
                                    />
                                  </div>
                                );
                              })
                            )}
                          </div>
                        ) : null
                      ))}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === 'mcp' && (
              <Card className="rounded-3xl shadow-none border-muted-foreground/10 overflow-hidden bg-card/50 animate-fade-in">
                <CardHeader className="p-8 pb-4">
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-3">
                    <Database className="w-6 h-6 text-primary" /> MCP 连接
                  </CardTitle>
                  <CardDescription className="text-sm font-medium">
                    预设智能体可用 MCP 服务器（创建后自动写入分配）。
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
                            <Switch checked={enabled} onCheckedChange={(checked) => toggleMcpSelection(serverName, checked)} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}

interface ManifestTomlInput {
  name: string;
  description: string;
  tags: string[];
  provider: string;
  model: string;
  systemPrompt: string;
}

function buildAgentManifestToml(input: ManifestTomlInput): string {
  const tags = input.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  const safePrompt = input.systemPrompt.trim().length > 0 ? input.systemPrompt.trim() : 'You are a helpful AI agent.';
  const lines = [
    `name = "${escapeTomlString(input.name.trim())}"`,
    `description = "${escapeTomlString(input.description.trim())}"`,
    'profile = "full"',
    '',
    '[model]',
    `provider = "${escapeTomlString(input.provider)}"`,
    `model = "${escapeTomlString(input.model)}"`,
    `system_prompt = "${escapeTomlString(safePrompt)}"`,
  ];
  if (tags.length > 0) {
    lines.push('', `tags = [${tags.map((tag) => `"${escapeTomlString(tag)}"`).join(', ')}]`);
  }
  return lines.join('\n');
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

function normalizeEnglishNameInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
}

function previewAgentId(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const compacted = normalized.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return compacted || '创建后自动生成';
}
