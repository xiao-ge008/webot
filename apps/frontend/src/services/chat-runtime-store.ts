import { useRef, useSyncExternalStore } from 'react';
import type { Message } from '@/data/mock-chats';
import { deleteAgentChatState, loadAgentChatState, saveAgentChatState, type StoredChatSession } from '@/services/chat-session-store';

export type ChatStreamState = 'idle' | 'streaming' | 'waiting';

export interface ChatRuntimeRequestBinding {
  agentId: string;
  sessionId: string;
  messageId: string;
  processor?: 'local' | 'global';
}

export interface ChatRuntimeAgentState {
  sessions: StoredChatSession[];
  activeSessionId: string;
  sessionsReady: boolean;
  hydrated: boolean;
}

interface ChatRuntimeSnapshot {
  agents: Record<string, ChatRuntimeAgentState>;
  requests: Record<string, ChatRuntimeRequestBinding>;
}

interface InitializePayload {
  sessions: StoredChatSession[];
  activeSessionId: string;
}

const EMPTY_AGENT_STATE: ChatRuntimeAgentState = Object.freeze({
  sessions: [],
  activeSessionId: '',
  sessionsReady: false,
  hydrated: false,
});

function hasStreamingSession(sessions: StoredChatSession[]): boolean {
  return sessions.some((session) => (session.streamState ?? 'idle') !== 'idle');
}

function resolveActiveSessionId(sessions: StoredChatSession[], activeSessionId: string): string {
  if (!sessions.length) return '';
  if (sessions.some((session) => session.id === activeSessionId)) {
    return activeSessionId;
  }
  return sessions[0].id;
}

function shortenSessionTitle(raw: string): string {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 18) return normalized;
  return `${normalized.slice(0, 18)}...`;
}

class ChatRuntimeStore {
  private snapshot: ChatRuntimeSnapshot = {
    agents: {},
    requests: {},
  };

  private listeners = new Set<() => void>();
  private persistTimers = new Map<string, number>();
  private streamFlags = new Map<string, boolean>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getAgentState(agentId: string): ChatRuntimeAgentState {
    const key = agentId.trim();
    if (!key) return EMPTY_AGENT_STATE;
    return this.snapshot.agents[key] ?? EMPTY_AGENT_STATE;
  }

  getRequest(requestId: string): ChatRuntimeRequestBinding | null {
    const key = requestId.trim();
    if (!key) return null;
    return this.snapshot.requests[key] ?? null;
  }

  ensureAgentState(agentId: string, initializer: () => InitializePayload): ChatRuntimeAgentState {
    const key = agentId.trim();
    if (!key) return EMPTY_AGENT_STATE;
    const existing = this.snapshot.agents[key];
    if (existing?.hydrated) {
      return existing;
    }
    const initialized = initializer();
    const sessions = initialized.sessions;
    const activeSessionId = resolveActiveSessionId(sessions, initialized.activeSessionId);
    const next: ChatRuntimeAgentState = {
      sessions,
      activeSessionId,
      sessionsReady: true,
      hydrated: true,
    };
    this.replaceAgentState(key, next);
    this.schedulePersist(key, existing ?? EMPTY_AGENT_STATE, next);
    return next;
  }

  updateSessions(agentId: string, updater: StoredChatSession[] | ((prev: StoredChatSession[]) => StoredChatSession[])): void {
    const key = agentId.trim();
    if (!key) return;
    this.updateAgentState(key, (prev) => {
      const nextSessions = typeof updater === 'function'
        ? (updater as (items: StoredChatSession[]) => StoredChatSession[])(prev.sessions)
        : updater;
      if (nextSessions === prev.sessions) {
        return prev;
      }
      const activeSessionId = resolveActiveSessionId(nextSessions, prev.activeSessionId);
      return {
        ...prev,
        sessions: nextSessions,
        activeSessionId,
      };
    });
  }

  setActiveSessionId(agentId: string, activeSessionId: string): void {
    const key = agentId.trim();
    if (!key) return;
    this.updateAgentState(key, (prev) => {
      if (prev.activeSessionId === activeSessionId) {
        return prev;
      }
      return {
        ...prev,
        activeSessionId,
      };
    });
  }

  setSessionsReady(agentId: string, sessionsReady: boolean): void {
    const key = agentId.trim();
    if (!key) return;
    this.updateAgentState(key, (prev) => {
      if (prev.sessionsReady === sessionsReady) {
        return prev;
      }
      return {
        ...prev,
        sessionsReady,
      };
    });
  }

  patchSessionMessage(
    agentId: string,
    sessionId: string,
    messageId: string,
    updater: (message: Message) => Message,
  ): void {
    const key = agentId.trim();
    if (!key) return;
    this.updateAgentState(key, (prev) => {
      const sessionIdx = prev.sessions.findIndex((session) => session.id === sessionId);
      if (sessionIdx < 0) return prev;
      const session = prev.sessions[sessionIdx];
      const messageIdx = session.messages.findIndex((message) => message.id === messageId);
      if (messageIdx < 0) return prev;
      const currentMessage = session.messages[messageIdx];
      const nextMessage = updater(currentMessage);
      if (nextMessage === currentMessage) return prev;
      const nextMessages = [...session.messages];
      nextMessages[messageIdx] = nextMessage;

      const firstUserText = nextMessages.find((item) => item.role === 'user' && item.text.trim())?.text ?? '';
      const shouldFinalizeAutoTitle = Boolean(session.autoTitle && firstUserText.trim());
      const nextSession: StoredChatSession = {
        ...session,
        title: shouldFinalizeAutoTitle ? shortenSessionTitle(firstUserText) : session.title,
        autoTitle: shouldFinalizeAutoTitle ? false : session.autoTitle,
        messages: nextMessages,
      };
      const nextSessions = [...prev.sessions];
      nextSessions[sessionIdx] = nextSession;
      return {
        ...prev,
        sessions: nextSessions,
      };
    });
  }

  setSessionStreamState(
    agentId: string,
    sessionId: string,
    nextState: ChatStreamState,
    touchUpdatedAt = true,
  ): void {
    const key = agentId.trim();
    if (!key) return;
    this.updateAgentState(key, (prev) => {
      const idx = prev.sessions.findIndex((session) => session.id === sessionId);
      if (idx < 0) return prev;
      const current = prev.sessions[idx];
      const currentState = current.streamState ?? 'idle';
      if (currentState === nextState) return prev;

      const nextSession: StoredChatSession = {
        ...current,
        streamState: nextState,
        updatedAt: touchUpdatedAt ? Date.now() : current.updatedAt,
      };
      const nextSessions = [...prev.sessions];
      nextSessions[idx] = nextSession;
      if (touchUpdatedAt && idx !== 0) {
        nextSessions.sort((a, b) => b.updatedAt - a.updatedAt);
      }
      return {
        ...prev,
        sessions: nextSessions,
      };
    });
  }

  bindRequest(requestId: string, binding: ChatRuntimeRequestBinding): void {
    const key = requestId.trim();
    if (!key) return;
    const current = this.snapshot.requests[key];
    if (
      current
      && current.agentId === binding.agentId
      && current.sessionId === binding.sessionId
      && current.messageId === binding.messageId
      && current.processor === binding.processor
    ) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      requests: {
        ...this.snapshot.requests,
        [key]: binding,
      },
    };
    this.emit();
  }

  setRequestProcessor(requestId: string, processor: 'local' | 'global'): void {
    const key = requestId.trim();
    if (!key) return;
    const current = this.snapshot.requests[key];
    if (!current || current.processor === processor) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      requests: {
        ...this.snapshot.requests,
        [key]: {
          ...current,
          processor,
        },
      },
    };
    this.emit();
  }

  unbindRequest(requestId: string): void {
    const key = requestId.trim();
    if (!key || !this.snapshot.requests[key]) return;
    const next = { ...this.snapshot.requests };
    delete next[key];
    this.snapshot = {
      ...this.snapshot,
      requests: next,
    };
    this.emit();
  }

  clearAgentState(agentId: string): void {
    const key = agentId.trim();
    if (!key) return;
    const nextAgents = { ...this.snapshot.agents };
    if (!nextAgents[key]) {
      deleteAgentChatState(key);
      return;
    }
    delete nextAgents[key];
    this.snapshot = {
      ...this.snapshot,
      agents: nextAgents,
    };
    this.emit();
    const timer = this.persistTimers.get(key);
    if (timer != null) {
      window.clearTimeout(timer);
      this.persistTimers.delete(key);
    }
    this.streamFlags.delete(key);
    deleteAgentChatState(key);
  }

  loadAgentFromStorage(agentId: string): InitializePayload | null {
    const key = agentId.trim();
    if (!key) return null;
    const loaded = loadAgentChatState(key);
    if (!loaded?.sessions?.length) {
      return null;
    }
    return {
      sessions: loaded.sessions,
      activeSessionId: loaded.activeSessionId,
    };
  }

  private updateAgentState(agentId: string, updater: (prev: ChatRuntimeAgentState) => ChatRuntimeAgentState): void {
    const prev = this.snapshot.agents[agentId] ?? EMPTY_AGENT_STATE;
    const next = updater(prev);
    if (next === prev) {
      return;
    }
    this.replaceAgentState(agentId, next);
    this.schedulePersist(agentId, prev, next);
  }

  private replaceAgentState(agentId: string, next: ChatRuntimeAgentState): void {
    this.snapshot = {
      ...this.snapshot,
      agents: {
        ...this.snapshot.agents,
        [agentId]: next,
      },
    };
    this.emit();
  }

  private schedulePersist(agentId: string, prev: ChatRuntimeAgentState, next: ChatRuntimeAgentState): void {
    if (!next.sessionsReady || next.sessions.length === 0) {
      return;
    }
    const resolvedActive = resolveActiveSessionId(next.sessions, next.activeSessionId);
    const wasStreaming = this.streamFlags.get(agentId) ?? hasStreamingSession(prev.sessions);
    const isStreaming = hasStreamingSession(next.sessions);
    this.streamFlags.set(agentId, isStreaming);

    const timer = this.persistTimers.get(agentId);
    if (timer != null) {
      window.clearTimeout(timer);
      this.persistTimers.delete(agentId);
    }

    if (wasStreaming && !isStreaming) {
      saveAgentChatState(agentId, {
        sessions: next.sessions,
        activeSessionId: resolvedActive,
      });
      return;
    }

    const delay = isStreaming ? 1200 : 500;
    const timeoutId = window.setTimeout(() => {
      this.persistTimers.delete(agentId);
      saveAgentChatState(agentId, {
        sessions: next.sessions,
        activeSessionId: resolvedActive,
      });
    }, delay);
    this.persistTimers.set(agentId, timeoutId);
  }

  flushAgentState(agentId: string): void {
    const key = agentId.trim();
    if (!key) return;
    const state = this.snapshot.agents[key];
    if (!state || !state.sessionsReady || state.sessions.length === 0) {
      return;
    }
    const resolvedActive = resolveActiveSessionId(state.sessions, state.activeSessionId);
    saveAgentChatState(key, {
      sessions: state.sessions,
      activeSessionId: resolvedActive,
    });
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const chatRuntimeStore = new ChatRuntimeStore();

export function useChatRuntimeAgentState(agentId: string): ChatRuntimeAgentState {
  const key = agentId.trim();
  return useSyncExternalStore(
    chatRuntimeStore.subscribe,
    () => chatRuntimeStore.getAgentState(key),
    () => chatRuntimeStore.getAgentState(key),
  );
}

export function useChatRuntimeSelector<T>(
  agentId: string,
  selector: (state: ChatRuntimeAgentState) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const key = agentId.trim();
  const cacheRef = useRef<{
    hasValue: boolean;
    snapshot: ChatRuntimeAgentState | null;
    value: T | undefined;
  }>({
    hasValue: false,
    snapshot: null,
    value: undefined,
  });

  const getSelection = () => {
    const snapshot = chatRuntimeStore.getAgentState(key);
    const cache = cacheRef.current;
    if (cache.hasValue && cache.snapshot === snapshot) {
      return cache.value as T;
    }
    const nextValue = selector(snapshot);
    if (cache.hasValue && isEqual(cache.value as T, nextValue)) {
      cache.snapshot = snapshot;
      return cache.value as T;
    }
    cache.hasValue = true;
    cache.snapshot = snapshot;
    cache.value = nextValue;
    return nextValue;
  };

  return useSyncExternalStore(
    chatRuntimeStore.subscribe,
    getSelection,
    getSelection,
  );
}
