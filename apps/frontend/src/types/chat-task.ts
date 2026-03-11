export type ChatTaskCardStage =
  | 'proposal'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type ChatTaskCardLastStatus = 'idle' | 'running' | 'ok' | 'error' | 'cancelled';

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
}
