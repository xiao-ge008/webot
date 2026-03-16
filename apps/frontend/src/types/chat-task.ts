export type ChatTaskCardStage =
  | 'proposal'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type ChatTaskCardLastStatus = 'idle' | 'running' | 'ok' | 'error' | 'cancelled';
export type ChatTaskLifecycleKind =
  | 'created'
  | 'started'
  | 'progress'
  | 'anomaly'
  | 'final'
  | 'failed'
  | 'cancelled';

export interface ChatTaskLifecycleItem {
  id: string;
  kind: ChatTaskLifecycleKind;
  title: string;
  detail?: string;
  at: string;
  runCount?: number;
  level?: 'info' | 'success' | 'error';
}

export interface ChatTaskCardData {
  taskName: string;
  objective: string;
  scheduleText: string;
  everyMs: number;
  maxRuns: number;
  runCount: number;
  logCount?: number;
  errorCount?: number;
  finalSummaryReady?: boolean;
  executionPrompt: string;
  sourceMessageText: string;
  stage: ChatTaskCardStage;
  createdAt: string;
  updatedAt: string;
  taskId?: string;
  agentId?: string;
  nextRun?: string;
  lastRun?: string;
  lastStatus?: ChatTaskCardLastStatus;
  canCreate?: boolean;
  canCancel?: boolean;
  canDelete?: boolean;
  notifyOnComplete?: boolean;
  completedNotified?: boolean;
  taskKind?: 'chat_async' | 'chat_schedule' | 'manual_schedule' | 'a2a_delegate';
  creatorParticipantName?: string;
  executorAgentName?: string;
  reportActorName?: string;
  reportStatus?: 'pending' | 'reported' | 'acknowledged';
  progressPercent?: number;
  errorSummary?: string;
  finalSummaryText?: string;
  latestReportAt?: string;
  latestReportKind?: 'progress' | 'anomaly' | 'final' | 'failed' | 'started';
  bindingSessionId?: string;
  bindingSourceMessageId?: string;
  timeline?: ChatTaskLifecycleItem[];
}
