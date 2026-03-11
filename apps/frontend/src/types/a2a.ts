export type A2AWorkStatus = 'working' | 'completed' | 'failed';

export interface A2AWorkLogItem {
  id: string;
  at: string;
  title: string;
  detail?: string;
}

export interface A2AWorkCardData {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatarUrl?: string;
  agentColor?: string;
  status: A2AWorkStatus;
  summary?: string;
  startedAt: string;
  finishedAt?: string;
  logs: A2AWorkLogItem[];
}
