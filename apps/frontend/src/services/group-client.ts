import { requestJson } from '@/services/transport';
import { DEFAULT_GROUP_LIMITS, type ChatGroup, type ChatGroupLimits, type ChatGroupMode } from '@/types/group';

interface RawChatGroup {
  group_id?: string;
  name?: string;
  description?: string;
  tags?: unknown;
  leader_agent_id?: string;
  system_prompt?: string;
  admin_agent_ids?: unknown;
  member_agent_ids?: unknown;
  mode?: unknown;
  group_mode?: unknown;
  limits?: unknown;
  created_at?: string;
  updated_at?: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeMode(value: unknown): ChatGroupMode {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'free_talk') return 'free_talk';
  return 'leader_dispatch';
}

function mapLimits(value: unknown): ChatGroupLimits {
  const base = DEFAULT_GROUP_LIMITS;
  if (!value || typeof value !== 'object') return base;
  const obj = value as Record<string, unknown>;
  const MAX_GROUP_SPEAKERS = 64;
  const MAX_GROUP_MENTIONS = 64;
  const MAX_GROUP_MENTION_DEPTH = 16;
  const clampInt = (raw: number | undefined, min: number, max: number): number => {
    if (!Number.isFinite(raw ?? NaN)) return min;
    return Math.min(max, Math.max(min, Math.round(raw ?? min)));
  };
  const clampFloat = (raw: number | undefined, min: number, max: number): number => {
    if (!Number.isFinite(raw ?? NaN)) return min;
    return Math.min(max, Math.max(min, raw ?? min));
  };

  const maxSpeakers = clampInt(asNumber(obj.maxSpeakers ?? obj.max_speakers), 1, MAX_GROUP_SPEAKERS);
  const maxMentions = clampInt(asNumber(obj.maxMentions ?? obj.max_mentions), 1, MAX_GROUP_MENTIONS);
  const mentionMaxDepth = clampInt(asNumber(obj.mentionMaxDepth ?? obj.mention_max_depth), 1, MAX_GROUP_MENTION_DEPTH);
  const cooldownMs = Math.max(base.cooldownMs, asNumber(obj.cooldownMs ?? obj.cooldown_ms) ?? base.cooldownMs);
  const duplicateThreshold = Math.max(
    base.duplicateThreshold,
    clampFloat(asNumber(obj.duplicateThreshold ?? obj.duplicate_threshold), 0, 1),
  );

  return {
    maxSpeakers,
    maxMentions,
    cooldownMs,
    duplicateThreshold,
    mentionMaxDepth,
  };
}

function mapRawChatGroup(raw: RawChatGroup): ChatGroup | null {
  const groupId = asString(raw.group_id).trim();
  const name = asString(raw.name).trim();
  if (!groupId || !name) return null;
  return {
    groupId,
    name,
    description: asString(raw.description),
    tags: Array.isArray(raw.tags) ? asStringArray(raw.tags) : [],
    leaderAgentId: asString(raw.leader_agent_id),
    systemPrompt: asString(raw.system_prompt),
    adminAgentIds: asStringArray(raw.admin_agent_ids),
    memberAgentIds: asStringArray(raw.member_agent_ids),
    groupMode: normalizeMode(raw.mode ?? raw.group_mode),
    limits: mapLimits(raw.limits),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
  };
}

export interface CreateChatGroupInput {
  groupId?: string;
  name: string;
  description?: string;
  tags?: string[];
  leaderAgentId?: string;
  memberAgentIds: string[];
  adminAgentIds?: string[];
  groupMode?: ChatGroupMode;
  limits?: ChatGroupLimits;
  applyCollaborationAcl?: boolean;
}

export interface UpdateChatGroupInput {
  name: string;
  description?: string;
  tags?: string[];
  leaderAgentId?: string;
  memberAgentIds: string[];
  adminAgentIds?: string[];
  groupMode?: ChatGroupMode;
  limits?: ChatGroupLimits;
  applyCollaborationAcl?: boolean;
}

export async function listChatGroups(): Promise<ChatGroup[]> {
  const payload = await requestJson<unknown>('/api/groups');
  if (!payload || typeof payload !== 'object') return [];
  const object = payload as { groups?: unknown };
  const groups = Array.isArray(object.groups) ? (object.groups as RawChatGroup[]) : [];
  return groups.map(mapRawChatGroup).filter((item): item is ChatGroup => Boolean(item));
}

export async function getChatGroup(groupId: string): Promise<ChatGroup> {
  const payload = await requestJson<unknown>(`/api/groups/${encodeURIComponent(groupId)}`);
  if (!payload || typeof payload !== 'object') {
    throw new Error('群信息加载失败');
  }
  const object = payload as { group?: RawChatGroup };
  const mapped = object.group ? mapRawChatGroup(object.group) : null;
  if (!mapped) {
    throw new Error('群不存在或数据格式错误');
  }
  return mapped;
}

export async function createChatGroup(input: CreateChatGroupInput): Promise<ChatGroup> {
  const payload = await requestJson<unknown>('/api/groups', {
    method: 'POST',
    body: {
      group_id: input.groupId,
      name: input.name,
      description: input.description ?? '',
      tags: input.tags ?? [],
      leader_agent_id: input.leaderAgentId,
      member_agent_ids: input.memberAgentIds,
      admin_agent_ids: input.adminAgentIds ?? [],
      mode: input.groupMode ?? 'leader_dispatch',
      limits: input.limits ?? DEFAULT_GROUP_LIMITS,
      apply_collaboration_acl: input.applyCollaborationAcl,
    },
  });
  if (!payload || typeof payload !== 'object') {
    throw new Error('创建群失败');
  }
  const object = payload as { group?: RawChatGroup | null };
  const group = object.group ? mapRawChatGroup(object.group) : null;
  if (!group) {
    throw new Error('创建群失败：返回数据不完整');
  }
  return group;
}

export async function updateChatGroup(groupId: string, input: UpdateChatGroupInput): Promise<ChatGroup> {
  const id = groupId.trim();
  if (!id) {
    throw new Error('群ID不能为空');
  }
  const payload = await requestJson<unknown>(`/api/groups/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: {
      name: input.name,
      description: input.description ?? '',
      tags: input.tags ?? [],
      leader_agent_id: input.leaderAgentId,
      member_agent_ids: input.memberAgentIds,
      admin_agent_ids: input.adminAgentIds ?? [],
      mode: input.groupMode ?? 'leader_dispatch',
      limits: input.limits ?? DEFAULT_GROUP_LIMITS,
      apply_collaboration_acl: input.applyCollaborationAcl,
    },
  });
  if (!payload || typeof payload !== 'object') {
    throw new Error('群更新失败');
  }
  const object = payload as { group?: RawChatGroup | null };
  const group = object.group ? mapRawChatGroup(object.group) : null;
  if (!group) {
    throw new Error('群更新失败：返回数据不完整');
  }
  return group;
}

export async function deleteChatGroup(groupId: string): Promise<void> {
  const id = groupId.trim();
  if (!id) {
    throw new Error('群ID不能为空');
  }
  const payload = await requestJson<unknown>(`/api/groups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!payload || typeof payload !== 'object') {
    throw new Error('群删除失败');
  }
}
