import type { Task } from '@/types/tasks';

export const mockTasks: Task[] = [
    {
        id: 'task-101',
        name: 'Weekly Data Processing',
        jobType: 'agent',
        prompt: 'Process the weekly metrics from the database and generate a PDF report.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        teamId: 'team-001',
        sourceType: 'custom',
        enabled: true,
        isTemplate: false,
        schedule: { kind: 'cron', expr: '0 0 * * 0' },
        delivery: { mode: 'none' },
        runInfo: {
            lastRun: new Date(Date.now() - 3600000).toISOString(),
            lastStatus: 'ok',
            runCount: 15
        }
    },
    {
        id: 'task-102',
        name: 'Sync Emails',
        jobType: 'shell',
        command: 'node sync-email.js',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        teamId: 'team-001',
        sourceType: 'custom',
        enabled: true,
        isTemplate: false,
        schedule: { kind: 'every', everyMs: 3600000 },
        delivery: { mode: 'none' },
        runInfo: {
            lastRun: new Date(Date.now() - 300000).toISOString(),
            lastStatus: 'running',
            runCount: 42
        }
    },
    {
        id: 'task-103',
        name: 'Backup Database',
        jobType: 'shell',
        command: 'sh backup.sh',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        teamId: 'team-001',
        sourceType: 'custom',
        enabled: true,
        isTemplate: false,
        schedule: { kind: 'at', at: new Date(Date.now() + 86400000).toISOString() },
        delivery: { mode: 'none' },
        runInfo: {
            lastStatus: 'idle',
            runCount: 0
        }
    }
];
