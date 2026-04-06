import { useEffect, useRef } from 'react';
import {
  listPendingTaskReportDeliveries,
  updateTaskReportDeliveryStatus,
  writebackTaskReportDeliveryToChat,
} from '@/services/task-client';
import type { TaskReportDelivery } from '@/types/tasks';

const POLL_INTERVAL_MS = 3000;

function readTaskDeliveryProgressPercent(payload?: Record<string, unknown>): number | undefined {
  if (!payload) return undefined;
  const candidates = [
    payload.progressPercent,
    payload.progress_percent,
    payload.progress,
    payload.percent,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.max(0, Math.min(100, Math.floor(candidate)));
    }
  }
  return undefined;
}

function readTaskDeliverySummary(delivery: TaskReportDelivery): string {
  const direct = (delivery.summaryText || delivery.errorText || '').trim();
  if (direct) {
    return direct;
  }
  const payload = delivery.payload;
  if (!payload) {
    return '';
  }
  const candidates = [
    payload.summaryText,
    payload.summary_text,
    payload.summary,
    payload.title,
    payload.message,
    payload.error,
    payload.errorText,
    payload.error_text,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function buildTaskDeliveryWritebackMessage(
  delivery: TaskReportDelivery,
  summary: string,
  progressPercent?: number,
): string {
  const taskName = (delivery.taskName || '未命名任务').trim();
  const lines: string[] = [];
  if (delivery.deliveryKind === 'progress') {
    lines.push(`任务进展：${taskName}`);
    if (typeof progressPercent === 'number') {
      lines.push(`当前进度：${progressPercent}%`);
    } else if (typeof delivery.runCount === 'number' && delivery.runCount > 0) {
      lines.push(`已执行：第 ${delivery.runCount} 次`);
    }
    if (summary.trim()) {
      lines.push(summary.trim());
    }
  } else if (delivery.deliveryKind === 'anomaly') {
    lines.push(`任务异常：${taskName}`);
    if (typeof delivery.runCount === 'number' && delivery.runCount > 0) {
      lines.push(`异常轮次：第 ${delivery.runCount} 次`);
    }
    if (summary.trim()) {
      lines.push(summary.trim());
    }
  } else if (delivery.deliveryKind === 'final') {
    lines.push(`任务完成：${taskName}`);
    if (typeof delivery.runCount === 'number' && delivery.runCount > 0) {
      lines.push(`总执行次数：${delivery.runCount} 次`);
    }
    if (summary.trim()) {
      lines.push(summary.trim());
    }
  }
  return lines.map((line) => line.trim()).filter(Boolean).join('\n');
}

function isTerminalWritebackError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.startsWith('HTTP 404') || error.message.startsWith('HTTP 409');
}

export function TaskChatDeliveryBridge() {
  const seenRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const consume = async () => {
      if (cancelled || runningRef.current) return;
      runningRef.current = true;
      try {
        const deliveries = await listPendingTaskReportDeliveries({});
        if (deliveries.length === 0) return;

        const ordered = deliveries
          .slice()
          .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));

        for (const delivery of ordered) {
          if (cancelled) return;
          const deliveryId = delivery.id.trim();
          const taskId = delivery.taskId.trim();
          if (!deliveryId || !taskId || seenRef.current.has(deliveryId)) {
            continue;
          }
          seenRef.current.add(deliveryId);
          try {
            const summary = readTaskDeliverySummary(delivery);
            const progressPercent = readTaskDeliveryProgressPercent(delivery.payload);
            const messageText = buildTaskDeliveryWritebackMessage(delivery, summary, progressPercent);
            if (!messageText.trim()) {
              await updateTaskReportDeliveryStatus(deliveryId, 'acknowledged');
              continue;
            }
            await writebackTaskReportDeliveryToChat(deliveryId, {
              taskId,
              messageText,
            });
          } catch (error) {
            if (isTerminalWritebackError(error)) {
              try {
                await updateTaskReportDeliveryStatus(deliveryId, 'failed');
              } catch {
                // ignore secondary failures
              }
              continue;
            }
            seenRef.current.delete(deliveryId);
          }
        }
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
