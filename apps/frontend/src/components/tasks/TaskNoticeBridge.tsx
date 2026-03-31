import { useEffect, useRef } from 'react';
import { requestJson } from '@/services/transport';
import { pushSystemNotice } from '@/services/system-notifier';

type PendingPcDelivery = {
  id?: string;
  title?: string;
  body?: string;
  created_at?: string;
  payload?: Record<string, unknown> | null;
};

const POLL_INTERVAL_MS = 8000;
const NOTICE_POLL_TIMEOUT_MS = 3000;

function unwrapPendingPcDeliveries(input: unknown): PendingPcDelivery[] {
  if (typeof input !== 'object' || input == null) {
    return [];
  }
  const record = input as { notices?: unknown };
  return Array.isArray(record.notices)
    ? record.notices.filter((item): item is PendingPcDelivery => typeof item === 'object' && item != null)
    : [];
}

function resolveNoticeLevel(row: PendingPcDelivery): 'info' | 'success' | 'error' {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : null;
  const deliveryKind = typeof payload?.delivery_kind === 'string'
    ? payload.delivery_kind.trim().toLowerCase()
    : '';
  const status = typeof payload?.status === 'string'
    ? payload.status.trim().toLowerCase()
    : '';
  const title = `${row.title || ''} ${row.body || ''}`.toLowerCase();
  if (deliveryKind === 'anomaly' || status.includes('failed') || title.includes('异常') || title.includes('失败')) {
    return 'error';
  }
  if (deliveryKind === 'final' || status.includes('completed') || title.includes('完成') || title.includes('总结')) {
    return 'success';
  }
  return 'info';
}

export function TaskNoticeBridge() {
  const seenRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const consume = async () => {
      if (cancelled || runningRef.current) return;
      runningRef.current = true;
      try {
        const payload = await requestJson<unknown>(
          '/api/compose/tasks/notices/pending',
          {
            timeoutMs: NOTICE_POLL_TIMEOUT_MS,
          },
        );
        const rows = unwrapPendingPcDeliveries(payload);
        if (rows.length === 0) return;

        for (const item of rows) {
          if (cancelled || typeof item !== 'object' || item == null) continue;
          const row = item as PendingPcDelivery;
          const id = (row.id || '').trim();
          if (!id || seenRef.current.has(id)) continue;

          const title = (row.title || '').trim() || '任务状态通知';
          const message = (row.body || '').trim() || '任务状态已更新。';
          seenRef.current.add(id);
          try {
            await pushSystemNotice({
              title,
              message,
              tag: `task-pc-notice:${id}`,
              level: resolveNoticeLevel(row),
            });
            await requestJson(`/api/management/tasks/deliveries/${encodeURIComponent(id)}/status`, {
              method: 'POST',
              body: { status: 'acknowledged' },
              timeoutMs: NOTICE_POLL_TIMEOUT_MS,
            });
          } catch {
            seenRef.current.delete(id);
          }
        }
      } catch {
        // ignore polling failures
      } finally {
        runningRef.current = false;
      }
    };

    void consume();
    const timer = window.setInterval(() => {
      void consume();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
