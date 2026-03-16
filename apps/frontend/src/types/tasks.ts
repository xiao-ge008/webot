export type TaskSourceType = 'chat' | 'custom';
export type ScheduleKind = 'cron' | 'at' | 'every';
export type JobType = 'agent' | 'shell';
export type SessionTarget = 'isolated' | 'main';
export type DeliveryMode = 'none' | 'announce';
export type RunStatus = 'ok' | 'error' | 'running' | 'idle';
export type TaskConversationType = 'dm' | 'group';
export type TaskDeliveryKind = 'progress' | 'final' | 'anomaly';
export type TaskDeliveryStatus = 'pending' | 'reported' | 'acknowledged';

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
    createdAt: string;
    updatedAt: string;
    reportedAt?: string;
    acknowledgedAt?: string;
}
