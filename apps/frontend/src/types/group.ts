export type ChatGroupMode = 'leader_dispatch' | 'free_talk';

export type GroupQueueStatus = 'queued' | 'running' | 'done' | 'skipped' | 'cancelled';
export type GroupQueueReason =
  | 'user_primary'
  | 'user_followup'
  | 'user_mention'
  | 'mention_handoff'
  | 'leader_wrapup'
  | 'idle_prompt'
  | 'task_report';

export interface GroupQueueItem {
  id: string;
  agentId: string;
  agentName?: string;
  status: GroupQueueStatus;
  reason: GroupQueueReason;
  depth?: number;
  sourceMessageId?: string;
  note?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface GroupMemoryDigest {
  summary: string;
  goal?: string;
  decisions?: string[];
  openQuestions?: string[];
  speakerLine?: string;
  pendingLine?: string;
  lastUserIntent?: string;
  updatedAt: string;
}

export interface GroupAgentContextDigest {
  agentId: string;
  summary: string;
  ownRecentLine?: string;
  mentionLine?: string;
  todoLine?: string;
  updatedAt: string;
}

export interface GroupSessionRuntime {
  version: '1.0';
  status: 'idle' | 'running' | 'stopped';
  leaderAgentId?: string;
  currentSpeakerId?: string;
  lastCompletedSpeakerId?: string;
  queueVersion: number;
  queue: GroupQueueItem[];
  stopRequested: boolean;
  stopReason?: string;
  lastCompactedAt?: string;
  lastEventAt?: string;
  memoryDigestManual?: boolean;
  memoryDigest?: GroupMemoryDigest;
  agentContextDigestsManualIds?: string[];
  agentContextDigests?: Record<string, GroupAgentContextDigest>;
}

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
