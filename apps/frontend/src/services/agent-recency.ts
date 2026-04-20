import { loadAgentChatState, type StoredChatSession } from '@/services/chat-session-store';

const CHAT_TASK_RUNTIME_SESSION_PREFIX = '__task_runtime__::chat-task';
const LEGACY_CHAT_TASK_RUNTIME_SESSION_PREFIX = 'chat-task::';

function isVisibleAgentSession(session: StoredChatSession): boolean {
  const label = (session.sessionLabel || '').trim().toLowerCase();
  if (!label) {
    return true;
  }
  return !label.startsWith(CHAT_TASK_RUNTIME_SESSION_PREFIX)
    && !label.startsWith(LEGACY_CHAT_TASK_RUNTIME_SESSION_PREFIX);
}

function compareAgentLabel(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

export function buildAgentLastUsedMap(agentIds: readonly string[]): Record<string, number> {
  const output: Record<string, number> = {};
  for (const rawAgentId of agentIds) {
    const agentId = rawAgentId.trim();
    if (!agentId) continue;
    const state = loadAgentChatState(agentId);
    const lastUsedAt = state?.sessions?.reduce((max, session) => {
      if (!isVisibleAgentSession(session)) {
        return max;
      }
      return Math.max(max, session.updatedAt || 0);
    }, 0) ?? 0;
    output[agentId] = Number.isFinite(lastUsedAt) ? lastUsedAt : 0;
  }
  return output;
}

export function sortAgentsByLastUsed<T extends { id: string; name?: string; title?: string }>(
  items: readonly T[],
  lastUsedAtMap: Record<string, number> = {},
): T[] {
  return [...items].sort((left, right) => {
    const timeDiff = (lastUsedAtMap[right.id] ?? 0) - (lastUsedAtMap[left.id] ?? 0);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    const leftLabel = (left.name || left.title || left.id).trim();
    const rightLabel = (right.name || right.title || right.id).trim();
    const labelDiff = compareAgentLabel(leftLabel, rightLabel);
    if (labelDiff !== 0) {
      return labelDiff;
    }
    return compareAgentLabel(left.id, right.id);
  });
}
