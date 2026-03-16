import { pushSystemNotice } from '@/services/system-notifier';
import { requestJson } from '@/services/transport';
import type { Task } from '@/types/tasks';

type RoutedNoticeLevel = 'info' | 'success' | 'error';

interface ChannelNoticeResponse {
  ok?: boolean;
  delivered?: boolean;
  resolved_channel?: string;
  resolved_target?: string;
  reason?: string;
  message?: string;
}

export interface RoutedTaskNoticeResult {
  deliveredVia: 'channel' | 'system' | 'none';
  channel?: string;
  target?: string;
  reason?: string;
}

function trimToUndefined(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function pushTaskNoticeRouted(
  task: Task,
  input: { title: string; message: string; level: RoutedNoticeLevel; tag: string },
): Promise<RoutedTaskNoticeResult> {
  const text = input.message.trim();
  if (!text) {
    return { deliveredVia: 'none' };
  }

  const ownerAgentId = trimToUndefined(task.teamId);
  const preferredChannel = trimToUndefined(task.delivery.channel);
  const preferredTarget = trimToUndefined(task.delivery.to);
  const strictChannelOnly = task.delivery.bestEffort === false;
  const shouldTryChannel = Boolean(
    ownerAgentId || (preferredChannel && preferredChannel.toLowerCase() !== 'system'),
  );

  if (shouldTryChannel) {
    try {
      const result = await requestJson<ChannelNoticeResponse>('/api/management/channels/notify', {
        method: 'POST',
        body: {
          agent_id: ownerAgentId,
          preferred_channel:
            preferredChannel && preferredChannel.toLowerCase() !== 'system'
              ? preferredChannel
              : undefined,
          target: preferredTarget,
          title: input.title,
          message: text,
          tag: input.tag,
          level: input.level,
        },
      });

      if (result.ok && result.delivered) {
        return {
          deliveredVia: 'channel',
          channel: trimToUndefined(result.resolved_channel),
          target: trimToUndefined(result.resolved_target),
        };
      }

      const resolvedChannel = trimToUndefined(result.resolved_channel);
      const failureReason = trimToUndefined(result.message) || trimToUndefined(result.reason);
      if (resolvedChannel && strictChannelOnly) {
        console.warn('[task-notice-router] 渠道通知失败且已禁用系统回退', {
          taskId: task.id,
          channel: resolvedChannel,
          reason: failureReason || 'unknown',
        });
        return {
          deliveredVia: 'none',
          channel: resolvedChannel,
          target: trimToUndefined(result.resolved_target),
          reason: failureReason,
        };
      }

      await pushSystemNotice({
        title: input.title,
        message: text,
        level: input.level,
        tag: input.tag,
      });
      return {
        deliveredVia: 'system',
        channel: resolvedChannel,
        target: trimToUndefined(result.resolved_target),
        reason: failureReason,
      };
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error);
      if (strictChannelOnly && preferredChannel && preferredChannel.toLowerCase() !== 'system') {
        console.warn('[task-notice-router] 渠道通知请求失败且已禁用系统回退', {
          taskId: task.id,
          channel: preferredChannel,
          reason: failureReason,
        });
        return {
          deliveredVia: 'none',
          channel: preferredChannel,
          target: preferredTarget,
          reason: failureReason,
        };
      }
      await pushSystemNotice({
        title: input.title,
        message: text,
        level: input.level,
        tag: input.tag,
      });
      return {
        deliveredVia: 'system',
        channel: preferredChannel,
        target: preferredTarget,
        reason: failureReason,
      };
    }
  }

  await pushSystemNotice({
    title: input.title,
    message: text,
    level: input.level,
    tag: input.tag,
  });
  return {
    deliveredVia: 'system',
  };
}
