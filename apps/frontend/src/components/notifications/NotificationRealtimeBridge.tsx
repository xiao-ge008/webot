import { useEffect, useRef } from 'react';
import { listNotifications } from '@/services/notification-client';
import { pushSystemNotice } from '@/services/system-notifier';
import type { NotificationRecord } from '@/types/notifications';

const POLL_INTERVAL_MS = 6000;

function buildMessage(record: NotificationRecord): string {
  const lines = [
    record.agentName || record.agentId ? `智能体：${record.agentName || record.agentId}` : '',
    record.taskName || record.taskId ? `任务：${record.taskName || record.taskId}` : '',
    record.summary || record.detail || '',
  ].filter(Boolean);
  return lines.join('\n').trim();
}

function toNoticeLevel(record: NotificationRecord): 'info' | 'success' | 'error' {
  if (record.notificationType === 'failed' || record.notificationType === 'anomaly') {
    return 'error';
  }
  if (record.notificationType === 'completed' || record.notificationType === 'summary') {
    return 'success';
  }
  return 'info';
}

export function NotificationRealtimeBridge() {
  const seenRef = useRef<Set<string>>(new Set());
  const mountedAtRef = useRef<number>(Date.now());
  const runningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const consume = async () => {
      if (cancelled || runningRef.current) return;
      runningRef.current = true;
      try {
        const rows = await listNotifications({ unreadOnly: true, limit: 20 });
        for (const row of rows) {
          if (cancelled || seenRef.current.has(row.id)) continue;
          const createdAt = Date.parse(row.createdAt);
          if (Number.isFinite(createdAt) && createdAt < mountedAtRef.current) {
            continue;
          }
          seenRef.current.add(row.id);
          const message = buildMessage(row);
          if (!message) continue;
          await pushSystemNotice({
            title: row.title,
            message,
            level: toNoticeLevel(row),
            tag: `notification:${row.id}`,
          });
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
