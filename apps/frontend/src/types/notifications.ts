export type NotificationSourceDomain =
  | 'chat_task'
  | 'manual_task'
  | 'video_job'
  | 'a2a_task'
  | 'agent_workflow'
  | 'system';

export type NotificationType =
  | 'progress'
  | 'completed'
  | 'summary'
  | 'anomaly'
  | 'failed'
  | 'system';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export type NotificationChannelType =
  | 'system'
  | 'telegram'
  | 'feishu'
  | 'qqbot'
  | 'whatsapp';

export interface NotificationRecord {
  id: string;
  sourceKey: string;
  sourceDomain: NotificationSourceDomain | string;
  sourceRecordId: string;
  notificationType: NotificationType | string;
  severity: NotificationSeverity | string;
  title: string;
  summary?: string;
  detail?: string;
  agentId?: string;
  agentName?: string;
  taskId?: string;
  taskName?: string;
  sessionId?: string;
  sourceRunId?: string;
  payload?: Record<string, unknown>;
  deliveryStatus?: Record<string, unknown>;
  readAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSettings {
  version: number;
  enabledChannels: NotificationChannelType[];
  targets: Partial<Record<Exclude<NotificationChannelType, 'system'>, string>>;
  fallbackToSystem: boolean;
}

export interface NotificationListQuery {
  unreadOnly?: boolean;
  includeArchived?: boolean;
  notificationType?: NotificationType | string;
  sourceDomain?: NotificationSourceDomain | string;
  agentId?: string;
  q?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
}
