export type NoticeLevel = 'info' | 'success' | 'error';

export interface InAppNotice {
  id: string;
  title: string;
  message: string;
  level: NoticeLevel;
  createdAt: number;
  durationMs?: number;
}

const NOTICE_EVENT_NAME = 'webot:in-app-notice';

function createNoticeId(): string {
  return `notice_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function pushInAppNotice(input: Omit<InAppNotice, 'id' | 'createdAt'>): InAppNotice {
  const notice: InAppNotice = {
    id: createNoticeId(),
    createdAt: Date.now(),
    durationMs: input.durationMs ?? 4500,
    ...input,
  };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<InAppNotice>(NOTICE_EVENT_NAME, { detail: notice }));
  }
  return notice;
}

export function subscribeInAppNotice(handler: (notice: InAppNotice) => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const custom = event as CustomEvent<InAppNotice>;
    if (!custom.detail) return;
    handler(custom.detail);
  };

  window.addEventListener(NOTICE_EVENT_NAME, listener as EventListener);
  return () => {
    window.removeEventListener(NOTICE_EVENT_NAME, listener as EventListener);
  };
}
