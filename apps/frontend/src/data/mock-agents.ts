import type { Agent } from '@/types';

/**
 * 模拟智能体数据
 * avatarUrl 为空时，UI 自动取 name 首字 + color 背景显示
 */
export const mockAgents: Agent[] = [
  {
    id: 'agent-luna',
    name: 'Luna',
    title: '全能助手',
    avatarUrl: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Luna',
    description:
      '你的日常智能伙伴，擅长回答问题、撰写内容和头脑风暴，是最通用的 AI 助手。',
    expertise: ['通用对话', '内容创作', '知识问答'],
    status: 'online',
    personality: '温暖亲切，善于倾听，回答全面',
    mcpTools: ['web-search', 'notion-mcp'],
    model: 'Claude Opus 4',
    ttsModel: 'edge-tts',
    ttsVoice: 'zh-CN-XiaoxiaoNeural',
    ttsSpeed: 1.0,
    ttsPitch: 1.0,
    createdAt: '2026-01-15',
    messagesCount: 2341,
    color: '#60a5fa',
  },
  {
    id: 'agent-atlas',
    name: 'Atlas',
    title: '首席架构师',
    avatarUrl: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Atlas',
    description:
      '精通系统架构设计与技术选型，将复杂业务拆解为可落地方案，代码审查一丝不苟。',
    expertise: ['系统架构', 'TypeScript', 'DevOps'],
    status: 'online',
    personality: '严谨务实，注重工程规范',
    mcpTools: ['github-mcp', 'bash-mcp', 'code-review-mcp'],
    model: 'Claude Opus 4',
    ttsModel: 'edge-tts',
    ttsVoice: 'zh-CN-YunxiNeural',
    ttsSpeed: 1.2,
    ttsPitch: 0.9,
    createdAt: '2026-01-20',
    messagesCount: 1247,
    color: '#3b82f6',
  },
  {
    id: 'agent-sage',
    name: 'Sage',
    title: '研究分析师',
    description:
      '擅长深度调研与竞品分析，能快速消化海量信息并提炼为结构化研究报告。',
    expertise: ['市场调研', '论文检索', '趋势分析'],
    status: 'online',
    personality: '好奇心旺盛，逻辑清晰',
    mcpTools: ['web-search', 'arxiv-mcp', 'notion-mcp'],
    model: 'Gemini 2.5 Pro',
    createdAt: '2026-01-25',
    messagesCount: 856,
    color: '#34d399',
  },
  {
    id: 'agent-nova',
    name: 'Nova',
    title: '财务顾问',
    description:
      '精通财务分析与预算规划，通过数据驱动决策，快速生成可视化报表与预测模型。',
    expertise: ['财务分析', '预算管理', '数据可视化'],
    status: 'busy',
    personality: '理性冷静，数据导向',
    mcpTools: ['excel-mcp', 'web-search', 'chart-mcp'],
    model: 'GPT-4o',
    createdAt: '2026-02-01',
    messagesCount: 643,
    color: '#fb923c',
  },
  {
    id: 'agent-echo',
    name: 'Echo',
    title: '创意设计师',
    avatarUrl: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Echo',
    description:
      '拥有极致审美品位与交互直觉，擅长苹果风格简约设计，快速产出高保真原型。',
    expertise: ['UI 设计', 'UX 研究', '设计系统'],
    status: 'offline',
    personality: '充满创意，追求像素级完美',
    mcpTools: ['image-gen-mcp', 'figma-mcp'],
    model: 'Claude Opus 4',
    createdAt: '2026-02-05',
    messagesCount: 412,
    color: '#f472b6',
  },
  {
    id: 'agent-zen',
    name: 'Zen',
    title: '文案策划',
    description:
      '精通中英双语写作，擅长品牌文案与营销话术，文风可在简约、热情、专业间切换。',
    expertise: ['品牌文案', '营销策划', 'SEO'],
    status: 'online',
    personality: '文字感极强，善于捕捉情绪',
    mcpTools: ['web-search', 'notion-mcp'],
    model: 'Claude Sonnet 4',
    createdAt: '2026-02-10',
    messagesCount: 298,
    color: '#2dd4bf',
  },
];

/** 获取智能体按分类筛选 */
export function getAgentsByCategory(category: string): Agent[] {
  if (category === 'all') return mockAgents;

  const categoryMap: Record<string, string[]> = {
    development: ['agent-atlas'],
    business: ['agent-nova'],
    creative: ['agent-echo', 'agent-zen'],
    research: ['agent-sage'],
  };

  const ids = categoryMap[category] ?? [];
  return mockAgents.filter((a) => ids.includes(a.id));
}

/** 根据 ID 获取单个智能体 */
export function getAgentById(id: string): Agent | undefined {
  return mockAgents.find((a) => a.id === id);
}

/** 模拟可用 LLM 模型列表 */
export const availableModels = [
  'Claude Opus 4',
  'Claude Sonnet 4',
  'GPT-4o',
  'Gemini 2.5 Pro',
  'DeepSeek R1',
  'Qwen 3',
];

/** 模拟可选颜色 */
export const availableColors = [
  '#60a5fa',
  '#3b82f6',
  '#34d399',
  '#fb923c',
  '#f472b6',
  '#2dd4bf',
  '#a78bfa',
  '#f87171',
  '#fbbf24',
  '#6ee7b7',
];
