import type { AgentProfile } from '@/main/types';
import type { Agent } from '@/types';

const FALLBACK_COLORS = ['#60a5fa', '#34d399', '#f472b6', '#fb923c', '#2dd4bf'];

function pickColor(agentId: string, preferred?: string): string {
  if (preferred && preferred.trim().length > 0) {
    return preferred;
  }
  const hash = agentId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function mapProfileToAgent(profile: AgentProfile): Agent {
  return {
    id: profile.agentId,
    name: profile.name,
    title: profile.title ?? '智能体',
    avatarUrl: profile.appearance.avatarUrl,
    description: profile.summary ?? '',
    expertise: [...profile.tags],
    status: 'offline',
    personality: profile.soul ?? '',
    mcpTools: [...profile.mcp.privateServers],
    model: profile.defaultLlm.modelName,
    ttsModel: profile.voice?.ttsModel,
    ttsVoice: profile.voice?.ttsVoice,
    ttsSpeed: profile.voice?.ttsSpeed,
    ttsPitch: profile.voice?.ttsPitch,
    createdAt: profile.createdAt,
    messagesCount: 0,
    color: pickColor(profile.agentId, profile.appearance.color),
  };
}
