import { requestJson } from '@/services/transport';

export type ServicePowerStatus = 'online' | 'offline' | 'error';

export interface ServicePowerState {
  status: ServicePowerStatus;
  online: boolean;
  error?: string;
  openfangBaseUrl?: string;
}

function normalizePowerState(payload: unknown): ServicePowerState {
  if (!payload || typeof payload !== 'object') {
    return { status: 'offline', online: false };
  }

  const data = payload as Record<string, unknown>;
  const statusRaw = typeof data.status === 'string' ? data.status : 'offline';
  const status: ServicePowerStatus =
    statusRaw === 'online' || statusRaw === 'error' || statusRaw === 'offline' ? statusRaw : 'offline';
  return {
    status,
    online: Boolean(data.online),
    error: typeof data.error === 'string' ? data.error : undefined,
    openfangBaseUrl: typeof data.openfangBaseUrl === 'string' ? data.openfangBaseUrl : undefined,
  };
}

export async function getServicePowerState(): Promise<ServicePowerState> {
  const payload = await requestJson<unknown>('/api/service/power/status');
  return normalizePowerState(payload);
}

export async function startServicePower(): Promise<ServicePowerState> {
  const payload = await requestJson<unknown>('/api/service/power/start', {
    method: 'POST',
    body: {},
  });
  return normalizePowerState(payload);
}

export async function stopServicePower(): Promise<ServicePowerState> {
  const payload = await requestJson<unknown>('/api/service/power/stop', {
    method: 'POST',
    body: {},
  });
  return normalizePowerState(payload);
}
