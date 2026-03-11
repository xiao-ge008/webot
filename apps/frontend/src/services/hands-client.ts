import { requestOpenFangJson } from '@/services/transport';
import type {
  HandBrowserState,
  HandChatMessage,
  HandDefinitionDetail,
  HandDefinitionSummary,
  HandInstallResponse,
  HandInstance,
  HandRequirement,
  HandStatsResponse,
} from '@/types';

interface HandsListResponse {
  hands?: HandDefinitionSummary[];
}

interface HandsActiveResponse {
  instances?: HandInstance[];
}

interface HandDepsResponse {
  requirements?: HandRequirement[];
  requirements_met?: boolean;
  server_platform?: string;
}

interface HandActivateResponse {
  instance_id?: string;
  agent_id?: string;
  agent_name?: string;
}

interface HandSessionResponse {
  messages?: Array<{ role?: string; content?: string }>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeHandList(raw: unknown): HandDefinitionSummary[] {
  const data = asRecord(raw);
  const rows = data ? asArray<HandDefinitionSummary>(data.hands) : [];
  return rows.map((item) => ({
    id: toStringValue(item.id),
    name: toStringValue(item.name),
    description: toStringValue(item.description),
    category: toStringValue(item.category),
    icon: toStringValue(item.icon),
    tools: asArray<string>(item.tools),
    requirements_met: Boolean(item.requirements_met),
    requirements: asArray<HandRequirement>(item.requirements),
    dashboard_metrics: typeof item.dashboard_metrics === 'number' ? item.dashboard_metrics : 0,
    has_settings: Boolean(item.has_settings),
    settings_count: typeof item.settings_count === 'number' ? item.settings_count : 0,
  }));
}

function normalizeActiveList(raw: unknown): HandInstance[] {
  const data = asRecord(raw);
  const rows = data ? asArray<HandInstance>(data.instances) : [];
  return rows.map((item) => ({
    instance_id: toStringValue(item.instance_id),
    hand_id: toStringValue(item.hand_id),
    status: toStringValue(item.status),
    agent_id: typeof item.agent_id === 'string' ? item.agent_id : null,
    agent_name: typeof item.agent_name === 'string' ? item.agent_name : null,
    activated_at: toStringValue(item.activated_at),
    updated_at: toStringValue(item.updated_at),
  }));
}

export async function listHands(): Promise<HandDefinitionSummary[]> {
  const raw = await requestOpenFangJson<HandsListResponse>('/api/hands');
  return normalizeHandList(raw);
}

export async function listActiveHands(): Promise<HandInstance[]> {
  const raw = await requestOpenFangJson<HandsActiveResponse>('/api/hands/active');
  return normalizeActiveList(raw);
}

export async function getHandDetail(handId: string): Promise<HandDefinitionDetail> {
  const raw = await requestOpenFangJson<HandDefinitionDetail>(`/api/hands/${encodeURIComponent(handId)}`);
  return raw;
}

export async function checkHandDeps(handId: string): Promise<HandDepsResponse> {
  return requestOpenFangJson<HandDepsResponse>(`/api/hands/${encodeURIComponent(handId)}/check-deps`, {
    method: 'POST',
    body: {},
  });
}

export async function installHandDeps(handId: string): Promise<HandInstallResponse> {
  return requestOpenFangJson<HandInstallResponse>(`/api/hands/${encodeURIComponent(handId)}/install-deps`, {
    method: 'POST',
    body: {},
  });
}

export async function activateHand(handId: string, config: Record<string, unknown>): Promise<HandActivateResponse> {
  return requestOpenFangJson<HandActivateResponse>(`/api/hands/${encodeURIComponent(handId)}/activate`, {
    method: 'POST',
    body: { config },
  });
}

export async function pauseHandInstance(instanceId: string): Promise<void> {
  await requestOpenFangJson(`/api/hands/instances/${encodeURIComponent(instanceId)}/pause`, {
    method: 'POST',
    body: {},
  });
}

export async function resumeHandInstance(instanceId: string): Promise<void> {
  await requestOpenFangJson(`/api/hands/instances/${encodeURIComponent(instanceId)}/resume`, {
    method: 'POST',
    body: {},
  });
}

export async function deactivateHandInstance(instanceId: string): Promise<void> {
  await requestOpenFangJson(`/api/hands/instances/${encodeURIComponent(instanceId)}`, {
    method: 'DELETE',
  });
}

export async function getHandStats(instanceId: string): Promise<HandStatsResponse> {
  return requestOpenFangJson<HandStatsResponse>(`/api/hands/instances/${encodeURIComponent(instanceId)}/stats`);
}

export async function getHandBrowserState(instanceId: string): Promise<HandBrowserState> {
  return requestOpenFangJson<HandBrowserState>(`/api/hands/instances/${encodeURIComponent(instanceId)}/browser`);
}

export async function getHandSession(agentId: string): Promise<HandChatMessage[]> {
  const raw = await requestOpenFangJson<HandSessionResponse>(`/api/agents/${encodeURIComponent(agentId)}/session`);
  const rows = raw?.messages ?? [];
  return rows
    .map((item) => ({
      role: ['user', 'assistant', 'system'].includes((item.role || '').toLowerCase())
        ? (item.role || '').toLowerCase() as HandChatMessage['role']
        : 'unknown',
      content: toStringValue(item.content).trim(),
    }))
    .filter((item) => item.content.length > 0);
}

export async function sendHandMessage(agentId: string, message: string): Promise<string> {
  const raw = await requestOpenFangJson<Record<string, unknown>>(`/api/agents/${encodeURIComponent(agentId)}/message`, {
    method: 'POST',
    body: { message },
  });
  return toStringValue(raw.response, toStringValue(raw.content));
}
