import { requestJson } from '@/services/transport';
import type {
  NotificationListQuery,
  NotificationRecord,
  NotificationSettings,
} from '@/types/notifications';

type NotificationStateListener = () => void;

const notificationStateListeners = new Set<NotificationStateListener>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapNotificationRecord(input: unknown): NotificationRecord | null {
  const row = isRecord(input) ? input : null;
  if (!row) return null;
  const id = trimToUndefined(row.id);
  const sourceKey = trimToUndefined(row.source_key ?? row.sourceKey);
  const sourceDomain = trimToUndefined(row.source_domain ?? row.sourceDomain);
  const sourceRecordId = trimToUndefined(row.source_record_id ?? row.sourceRecordId);
  const notificationType = trimToUndefined(row.notification_type ?? row.notificationType);
  const severity = trimToUndefined(row.severity);
  const title = trimToUndefined(row.title);
  const createdAt = trimToUndefined(row.created_at ?? row.createdAt);
  const updatedAt = trimToUndefined(row.updated_at ?? row.updatedAt);
  if (!id || !sourceKey || !sourceDomain || !sourceRecordId || !notificationType || !severity || !title || !createdAt || !updatedAt) {
    return null;
  }
  return {
    id,
    sourceKey,
    sourceDomain,
    sourceRecordId,
    notificationType,
    severity,
    title,
    summary: trimToUndefined(row.summary),
    detail: trimToUndefined(row.detail),
    agentId: trimToUndefined(row.agent_id ?? row.agentId),
    agentName: trimToUndefined(row.agent_name ?? row.agentName),
    taskId: trimToUndefined(row.task_id ?? row.taskId),
    taskName: trimToUndefined(row.task_name ?? row.taskName),
    sessionId: trimToUndefined(row.session_id ?? row.sessionId),
    sourceRunId: trimToUndefined(row.source_run_id ?? row.sourceRunId),
    payload: isRecord(row.payload) ? row.payload : undefined,
    deliveryStatus: isRecord(row.delivery_status ?? row.deliveryStatus)
      ? (row.delivery_status ?? row.deliveryStatus) as Record<string, unknown>
      : undefined,
    readAt: trimToUndefined(row.read_at ?? row.readAt),
    archivedAt: trimToUndefined(row.archived_at ?? row.archivedAt),
    createdAt,
    updatedAt,
  };
}

function mapNotificationSettings(input: unknown): NotificationSettings {
  const row = isRecord(input) ? input : {};
  const targetsRaw = isRecord(row.targets) ? row.targets : {};
  return {
    version: typeof row.version === 'number' && Number.isFinite(row.version) ? row.version : 1,
    enabledChannels: asStringArray(row.enabled_channels ?? row.enabledChannels) as NotificationSettings['enabledChannels'],
    targets: {
      telegram: trimToUndefined(targetsRaw.telegram),
      feishu: trimToUndefined(targetsRaw.feishu),
      qqbot: trimToUndefined(targetsRaw.qqbot),
      whatsapp: trimToUndefined(targetsRaw.whatsapp),
    },
    fallbackToSystem: typeof row.fallback_to_system === 'boolean'
      ? row.fallback_to_system
      : (typeof row.fallbackToSystem === 'boolean' ? row.fallbackToSystem : true),
  };
}

function toQueryString(query: NotificationListQuery): string {
  const params = new URLSearchParams();
  if (query.unreadOnly) params.set('unread_only', 'true');
  if (query.includeArchived) params.set('include_archived', 'true');
  if (query.notificationType) params.set('notification_type', query.notificationType);
  if (query.sourceDomain) params.set('source_domain', query.sourceDomain);
  if (query.agentId) params.set('agent_id', query.agentId);
  if (query.q) params.set('q', query.q);
  if (query.createdFrom) params.set('created_from', query.createdFrom);
  if (query.createdTo) params.set('created_to', query.createdTo);
  if (typeof query.limit === 'number' && Number.isFinite(query.limit)) {
    params.set('limit', String(Math.max(1, Math.floor(query.limit))));
  }
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

export function subscribeNotificationState(handler: NotificationStateListener): () => void {
  notificationStateListeners.add(handler);
  return () => {
    notificationStateListeners.delete(handler);
  };
}

export function emitNotificationStateChanged(): void {
  for (const listener of notificationStateListeners) {
    listener();
  }
}

export async function listNotifications(query: NotificationListQuery = {}): Promise<NotificationRecord[]> {
  const result = await requestJson<{ notifications?: unknown[] }>(
    `/api/management/notifications${toQueryString(query)}`,
  );
  return Array.isArray(result.notifications)
    ? result.notifications
      .map((item) => mapNotificationRecord(item))
      .filter((item): item is NotificationRecord => item != null)
    : [];
}

export async function getNotification(notificationId: string): Promise<NotificationRecord | null> {
  const result = await requestJson<{ notification?: unknown }>(
    `/api/management/notifications/${encodeURIComponent(notificationId)}`,
  );
  return mapNotificationRecord(result.notification);
}

export async function markNotificationRead(notificationId: string): Promise<NotificationRecord | null> {
  const result = await requestJson<{ notification?: unknown }>(
    `/api/management/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'POST', body: {} },
  );
  emitNotificationStateChanged();
  return mapNotificationRecord(result.notification);
}

export async function markAllNotificationsRead(): Promise<number> {
  const result = await requestJson<{ updated_count?: number }>(
    '/api/management/notifications/read-all',
    { method: 'POST', body: {} },
  );
  emitNotificationStateChanged();
  return typeof result.updated_count === 'number' && Number.isFinite(result.updated_count)
    ? result.updated_count
    : 0;
}

export async function archiveNotification(notificationId: string): Promise<NotificationRecord | null> {
  const result = await requestJson<{ notification?: unknown }>(
    `/api/management/notifications/${encodeURIComponent(notificationId)}/archive`,
    { method: 'POST', body: {} },
  );
  emitNotificationStateChanged();
  return mapNotificationRecord(result.notification);
}

export async function deleteNotification(notificationId: string): Promise<void> {
  await requestJson(
    `/api/management/notifications/${encodeURIComponent(notificationId)}`,
    { method: 'DELETE' },
  );
  emitNotificationStateChanged();
}

export async function getUnreadNotificationCount(): Promise<number> {
  const result = await requestJson<{ unread_count?: number }>(
    '/api/management/notifications/unread-count',
  );
  return typeof result.unread_count === 'number' && Number.isFinite(result.unread_count)
    ? Math.max(0, Math.floor(result.unread_count))
    : 0;
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const result = await requestJson<unknown>('/api/management/notifications/settings');
  return mapNotificationSettings(result);
}

export async function updateNotificationSettings(
  settings: NotificationSettings,
): Promise<NotificationSettings> {
  const result = await requestJson<unknown>('/api/management/notifications/settings', {
    method: 'PUT',
    body: {
      version: settings.version,
      enabled_channels: settings.enabledChannels,
      targets: settings.targets,
      fallback_to_system: settings.fallbackToSystem,
    },
  });
  emitNotificationStateChanged();
  return mapNotificationSettings(result);
}
