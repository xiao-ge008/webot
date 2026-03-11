export type TaskSourceType = 'chat' | 'custom';
export type ScheduleKind = 'cron' | 'at' | 'every';
export type JobType = 'agent' | 'shell';
export type SessionTarget = 'isolated' | 'main';
export type DeliveryMode = 'none' | 'announce';
export type RunStatus = 'ok' | 'error' | 'running' | 'idle';

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
