export type TaskSourceType = 'chat' | 'manual' | 'custom';
export type ScheduleKind = 'cron' | 'at' | 'every';
export type JobType = 'agent' | 'shell';
export type SessionTarget = 'isolated' | 'main';
export type DeliveryMode = 'none' | 'announce';
export type RunStatus = 'ok' | 'error' | 'running' | 'idle';
export type TaskConversationType = 'dm' | 'group';
export type TaskDeliveryKind = 'progress' | 'final' | 'anomaly';
export type TaskDeliveryStatus = 'pending' | 'reported' | 'acknowledged' | 'failed';
export type TaskRuntimeState = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed' | 'disabled';
export type TaskDeliveryAttemptStatus = 'succeeded' | 'failed';

export interface TaskSchedule {
    kind: ScheduleKind;
    expr?: string; // for cron
    tz?: string;   // for cron
    at?: string;   // ISO string for at
    everyMs?: number; // for every
}

export interface TaskDelivery {
    mode: DeliveryMode;
    channel?: string;
    to?: string;
    bestEffort?: boolean;
    finalSummaryPrompt?: string;
    notifyOnFinal?: boolean;
}

export interface TaskCapabilities {
    publish: boolean;
    pause: boolean;
    runOnce: boolean;
    delete: boolean;
}

export interface TaskDeliveryStats {
    total: number;
    pending: number;
    reported: number;
    acknowledged: number;
    failed: number;
    attempts: number;
    attemptFailures: number;
}

export interface TaskFinalSummary {
    runCount: number;
    status?: string;
    content: string;
    createdAt: string;
    runId?: string;
    eventId?: string;
}

export interface TaskTimelineEntry {
    id: string;
    sourceKind: string;
    sourceId: string;
    taskId: string;
    runId?: string;
    eventId?: string;
    targetKind?: string;
    status?: string;
    summary: string;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
}

export interface TaskDeliveryAttempt {
    id: string;
    deliveryId: string;
    taskId: string;
    runId?: string;
    eventId?: string;
    targetKind: string;
    consumerKind: string;
    status: TaskDeliveryAttemptStatus;
    error?: string;
    metadata?: Record<string, unknown> | null;
    startedAt: string;
    finishedAt?: string;
}

export interface Task {
    id: string;
    teamId: string;
    name: string;
    sourceType: TaskSourceType;
    sourceRef?: string; // e.g. message ID
    enabled: boolean;
    createdAt: string;
    updatedAt: string;

    schedule: TaskSchedule;
    jobType: JobType;
    prompt?: string;  // for agent
    command?: string; // for shell
    sessionTarget?: SessionTarget;

    delivery: TaskDelivery;

    isTemplate?: boolean;
    maxRuns?: number; // 0 or undefined for infinite
    runtimeState?: TaskRuntimeState;
    capabilities?: TaskCapabilities;
    deliveryStats?: TaskDeliveryStats;
    finalSummary?: TaskFinalSummary | null;
    timeline?: TaskTimelineEntry[];
    runInfo: {
        nextRun?: string;
        lastRun?: string;
        lastStatus: RunStatus;
        lastOutputPreview?: string;
        runCount: number;
    };
}

export interface TaskRunRecord {
    id: string;
    taskId: string;
    startTime: string;
    endTime?: string;
    status: RunStatus;
    output: string;
}

export interface TaskReportDelivery {
    id: string;
    taskId: string;
    ownerAgentId: string;
    runtimeKey?: string;
    deliveryKind: TaskDeliveryKind;
    status: TaskDeliveryStatus;
    originConversationType?: TaskConversationType;
    originConversationId?: string;
    originChatSessionId?: string;
    originMessageId?: string;
    creatorParticipantId?: string;
    creatorParticipantName?: string;
    executorAgentId?: string;
    executorAgentName?: string;
    reportActorAgentId?: string;
    reportActorAgentName?: string;
    taskName?: string;
    runCount?: number;
    summaryText?: string;
    errorText?: string;
    payload?: Record<string, unknown>;
    attemptStatus?: TaskDeliveryAttemptStatus;
    attemptCount?: number;
    createdAt: string;
    updatedAt: string;
    reportedAt?: string;
    acknowledgedAt?: string;
}
