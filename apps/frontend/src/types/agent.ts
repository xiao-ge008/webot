/** 智能体角色定义 */
export interface Agent {
  id: string;
  name: string;
  title: string;
  /** 头像图片 URL，为空时取 name 首字作为降级显示 */
  avatarUrl?: string;
  /** 立绘图片 URL，用于聊天右栏背景展示 */
  portraitUrl?: string;
  description: string;
  expertise: string[];
  status: 'online' | 'offline' | 'busy';
  personality: string;
  mcpTools: string[];
  model: string;
  ttsModel?: string; // 语音合成模型
  ttsVoice?: string; // 音色参数
  ttsSpeed?: number; // 语速 (例如 0.5 - 2.0)
  ttsPitch?: number; // 音调
  createdAt: string;
  messagesCount: number;
  color: string;
}

/** 创建智能体的表单数据 */
export interface CreateAgentForm {
  name: string;
  title: string;
  description: string;
  personality: string;
  expertise: string[];
  model: string;
  ttsModel?: string;
  ttsVoice?: string;
  ttsSpeed?: number;
  ttsPitch?: number;
  avatarUrl?: string;
  color: string;
}

/** 智能体分类 */
export type AgentCategory = 'all' | 'development' | 'business' | 'creative' | 'research';

/** 分类标签映射 */
export const CATEGORY_LABELS: Record<AgentCategory, string> = {
  all: '全部',
  development: '开发',
  business: '商务',
  creative: '创意',
  research: '研究',
};
