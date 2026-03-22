export interface AgentAppearanceUpdatedPayload {
  agentId: string;
  avatarUrl?: string;
  portraitUrl?: string;
}

const AGENT_APPEARANCE_UPDATED_EVENT = 'webot:agent-appearance-updated';

function normalizePayload(raw: unknown): AgentAppearanceUpdatedPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const payload = raw as Record<string, unknown>;
  const agentId = typeof payload.agentId === 'string' ? payload.agentId.trim() : '';
  const avatarUrl = typeof payload.avatarUrl === 'string' ? payload.avatarUrl.trim() : '';
  const portraitUrl = typeof payload.portraitUrl === 'string' ? payload.portraitUrl.trim() : '';
  if (!agentId || (!avatarUrl && !portraitUrl)) {
    return null;
  }
  return {
    agentId,
    avatarUrl: avatarUrl || undefined,
    portraitUrl: portraitUrl || undefined,
  };
}

export function emitAgentAppearanceUpdated(payload: AgentAppearanceUpdatedPayload): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') {
    return;
  }
  const normalized = normalizePayload(payload);
  if (!normalized) {
    return;
  }
  window.dispatchEvent(new CustomEvent(AGENT_APPEARANCE_UPDATED_EVENT, {
    detail: normalized,
  }));
}

export function subscribeAgentAppearanceUpdated(
  listener: (payload: AgentAppearanceUpdatedPayload) => void,
): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<unknown>;
    const normalized = normalizePayload(customEvent.detail);
    if (!normalized) {
      return;
    }
    listener(normalized);
  };

  window.addEventListener(AGENT_APPEARANCE_UPDATED_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(AGENT_APPEARANCE_UPDATED_EVENT, handler as EventListener);
  };
}
