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
  objective?: string;
  requestPayloadText?: string;
  startedAt: string;
  finishedAt?: string;
  finalReportText?: string;
  latestEventAt?: string;
  latestEventTitle?: string;
  latestEventKind?: 'started' | 'progress' | 'final' | 'failed';
  bindingSessionId?: string;
  bindingSourceMessageId?: string;
  logs: A2AWorkLogItem[];
}
