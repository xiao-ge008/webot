export type ChatGroupMode = 'leader_dispatch' | 'free_talk';

export interface ChatGroupLimits {
  maxSpeakers: number;
  maxMentions: number;
  cooldownMs: number;
  duplicateThreshold: number;
  mentionMaxDepth: number;
}

export const DEFAULT_GROUP_LIMITS: ChatGroupLimits = {
  maxSpeakers: 2,
  maxMentions: 2,
  cooldownMs: 10_000,
  duplicateThreshold: 0.92,
  mentionMaxDepth: 2,
};

export interface ChatGroup {
  groupId: string;
  name: string;
  description: string;
  tags: string[];
  leaderAgentId: string;
  systemPrompt: string;
  adminAgentIds: string[];
  memberAgentIds: string[];
  groupMode: ChatGroupMode;
  limits: ChatGroupLimits;
  createdAt: string;
  updatedAt: string;
}
