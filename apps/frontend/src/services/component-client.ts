import { requestJson } from '@/services/transport';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readRawValue(row: JsonRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null;
}

export type ComponentProviderType = 'comfyui' | 'runninghub';
export type ComponentReturnType = 'image' | 'text' | 'video' | 'audio';
export type ComponentParamValueType = 'string' | 'number' | 'boolean' | 'json';

export interface ComponentCapabilityBinding {
  capabilityKey: string;
  capabilityScope: string;
  baseTool: string;
  toolMode: string;
  sourcePolicy: string;
  fallbackPolicy: string;
  enabled: boolean;
  priority: number;
}

export interface ComponentSelectorMeta {
  specialization: string;
  intentTags: string[];
  subjectPolicy: string;
  supportsTextOnly: boolean;
  requiresSlots: string[];
  optionalSlots: string[];
  preferredMimeTypes: string[];
}

export interface ComponentServiceConfig {
  serverUrl: string;
  apiKey: string;
}

export interface ComponentProviderConfigs {
  comfyui: ComponentServiceConfig;
  runninghub: ComponentServiceConfig;
}

export interface WorkflowNodeField {
  fieldName: string;
  label: string;
  valueType: ComponentParamValueType;
  description: string;
  defaultValue: unknown;
  options: unknown[];
}

export interface WorkflowNode {
  nodeId: string;
  title: string;
  nodeType: string;
  fields: WorkflowNodeField[];
  raw: unknown;
}

export interface ComponentParameterMapping {
  id: string;
  nodeId: string;
  fieldName: string;
  parameterName: string;
  label: string;
  valueType: ComponentParamValueType;
  description: string;
  defaultValue: unknown;
  required: boolean;
  options: unknown[];
}

export interface ComponentWorkflowConfig {
  requestUrl: string;
  appId: string;
  rawPayload: unknown;
  nodes: WorkflowNode[];
  parameterMappings: ComponentParameterMapping[];
  runninghubInstanceType: string;
  runninghubUsePersonalQueue: boolean;
}

export interface ComponentDefinition {
  providerType: ComponentProviderType;
  name: string;
  englishName: string;
  componentType: string;
  description: string;
  returnType: ComponentReturnType;
  capabilityBinding: ComponentCapabilityBinding;
  selectorMeta: ComponentSelectorMeta;
  workflow: ComponentWorkflowConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentInvokeItem {
  kind: string;
  url: string;
  text: string;
  mimeType: string;
}

export interface ComponentInvokeResult {
  outputType: ComponentReturnType;
  text: string;
  items: ComponentInvokeItem[];
  raw: unknown;
}

const DEFAULT_PROVIDER_CONFIGS: ComponentProviderConfigs = {
  comfyui: {
    serverUrl: 'http://127.0.0.1:8188',
    apiKey: '',
  },
  runninghub: {
    serverUrl: 'https://www.runninghub.ai',
    apiKey: '',
  },
};

function normalizeNodeField(value: unknown): WorkflowNodeField {
  const row = isRecord(value) ? value : {};
  return {
    fieldName: asString(row.fieldName),
    label: asString(row.label),
    valueType: (asString(row.valueType, 'string') as ComponentParamValueType) || 'string',
    description: asString(row.description),
    defaultValue: readRawValue(row, 'defaultValue'),
    options: asArray(row.options),
  };
}

function normalizeNode(value: unknown): WorkflowNode {
  const row = isRecord(value) ? value : {};
  return {
    nodeId: asString(row.nodeId),
    title: asString(row.title),
    nodeType: asString(row.nodeType),
    fields: asArray(row.fields).map(normalizeNodeField),
    raw: row.raw ?? null,
  };
}

function normalizeMapping(value: unknown): ComponentParameterMapping {
  const row = isRecord(value) ? value : {};
  return {
    id: asString(row.id),
    nodeId: asString(row.nodeId),
    fieldName: asString(row.fieldName),
    parameterName: asString(row.parameterName),
    label: asString(row.label),
    valueType: (asString(row.valueType, 'string') as ComponentParamValueType) || 'string',
    description: asString(row.description),
    defaultValue: readRawValue(row, 'defaultValue'),
    required: asBoolean(row.required),
    options: asArray(row.options),
  };
}

function normalizeWorkflow(value: unknown): ComponentWorkflowConfig {
  const row = isRecord(value) ? value : {};
  return {
    requestUrl: asString(row.requestUrl),
    appId: asString(row.appId),
    rawPayload: row.rawPayload ?? null,
    nodes: asArray(row.nodes).map(normalizeNode),
    parameterMappings: asArray(row.parameterMappings).map(normalizeMapping),
    runninghubInstanceType: asString(row.runninghubInstanceType, 'default'),
    runninghubUsePersonalQueue: asBoolean(row.runninghubUsePersonalQueue),
  };
}

function normalizeDefinition(value: unknown): ComponentDefinition {
  const row = isRecord(value) ? value : {};
  const capabilityBinding = isRecord(row.capabilityBinding) ? row.capabilityBinding : {};
  const selectorMeta = isRecord(row.selectorMeta) ? row.selectorMeta : {};
  return {
    providerType: (asString(row.providerType, 'comfyui') as ComponentProviderType) || 'comfyui',
    name: asString(row.name),
    englishName: asString(row.englishName),
    componentType: asString(row.componentType),
    description: asString(row.description),
    returnType: (asString(row.returnType, 'image') as ComponentReturnType) || 'image',
    capabilityBinding: {
      capabilityKey: asString(capabilityBinding.capabilityKey),
      capabilityScope: asString(capabilityBinding.capabilityScope, 'generic'),
      baseTool: asString(capabilityBinding.baseTool),
      toolMode: asString(capabilityBinding.toolMode, 'generate'),
      sourcePolicy: asString(capabilityBinding.sourcePolicy, 'optional'),
      fallbackPolicy: asString(capabilityBinding.fallbackPolicy, 'allow_generic_provider'),
      enabled: typeof capabilityBinding.enabled === 'boolean' ? capabilityBinding.enabled : true,
      priority: typeof capabilityBinding.priority === 'number' ? capabilityBinding.priority : 100,
    },
    selectorMeta: {
      specialization: asString(selectorMeta.specialization, 'general'),
      intentTags: asArray<string>(selectorMeta.intentTags).map((item) => asString(item)).filter(Boolean),
      subjectPolicy: asString(selectorMeta.subjectPolicy, 'generic'),
      supportsTextOnly: typeof selectorMeta.supportsTextOnly === 'boolean' ? selectorMeta.supportsTextOnly : false,
      requiresSlots: asArray<string>(selectorMeta.requiresSlots).map((item) => asString(item)).filter(Boolean),
      optionalSlots: asArray<string>(selectorMeta.optionalSlots).map((item) => asString(item)).filter(Boolean),
      preferredMimeTypes: asArray<string>(selectorMeta.preferredMimeTypes).map((item) => asString(item)).filter(Boolean),
    },
    workflow: normalizeWorkflow(row.workflow),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt),
  };
}

export function createEmptyComponentDefinition(providerType: ComponentProviderType = 'comfyui'): ComponentDefinition {
  return {
    providerType,
    name: '',
    englishName: '',
    componentType: '',
    description: '',
    returnType: 'image',
    capabilityBinding: {
      capabilityKey: 'generate.image',
      capabilityScope: 'generic',
      baseTool: 'image_generate',
      toolMode: 'generate',
      sourcePolicy: 'optional',
      fallbackPolicy: 'allow_generic_provider',
      enabled: true,
      priority: 100,
    },
    selectorMeta: {
      specialization: 'general',
      intentTags: [],
      subjectPolicy: 'generic',
      supportsTextOnly: true,
      requiresSlots: ['prompt'],
      optionalSlots: [],
      preferredMimeTypes: ['image/*'],
    },
    workflow: {
      requestUrl: '',
      appId: '',
      rawPayload: null,
      nodes: [],
      parameterMappings: [],
      runninghubInstanceType: 'default',
      runninghubUsePersonalQueue: false,
    },
    createdAt: '',
    updatedAt: '',
  };
}

export async function getComponentProviderConfigs(): Promise<ComponentProviderConfigs> {
  const payload = await requestJson<unknown>('/api/management/components/config');
  if (!isRecord(payload) || !isRecord(payload.config)) {
    return DEFAULT_PROVIDER_CONFIGS;
  }
  const config = payload.config;
  return {
    comfyui: {
      serverUrl: asString((isRecord(config.comfyui) ? config.comfyui.serverUrl : ''), DEFAULT_PROVIDER_CONFIGS.comfyui.serverUrl),
      apiKey: asString(isRecord(config.comfyui) ? config.comfyui.apiKey : ''),
    },
    runninghub: {
      serverUrl: asString((isRecord(config.runninghub) ? config.runninghub.serverUrl : ''), DEFAULT_PROVIDER_CONFIGS.runninghub.serverUrl),
      apiKey: asString(isRecord(config.runninghub) ? config.runninghub.apiKey : ''),
    },
  };
}

export async function setComponentProviderConfigs(config: ComponentProviderConfigs): Promise<ComponentProviderConfigs> {
  const payload = await requestJson<unknown>('/api/management/components/config', {
    method: 'PUT',
    body: config,
  });
  if (!isRecord(payload) || !isRecord(payload.config)) {
    return config;
  }
  return getComponentProviderConfigs();
}

export async function listComponentDefinitions(): Promise<ComponentDefinition[]> {
  const payload = await requestJson<unknown>('/api/management/components');
  if (!isRecord(payload)) {
    return [];
  }
  return asArray(payload.items).map(normalizeDefinition);
}

export async function getComponentDefinition(englishName: string): Promise<ComponentDefinition | null> {
  const payload = await requestJson<unknown>(`/api/management/components/${encodeURIComponent(englishName)}`);
  if (!isRecord(payload) || !payload.item) {
    return null;
  }
  return normalizeDefinition(payload.item);
}

export async function createComponentDefinition(input: ComponentDefinition): Promise<ComponentDefinition> {
  const payload = await requestJson<unknown>('/api/management/components', {
    method: 'POST',
    body: input,
  });
  if (!isRecord(payload) || !payload.item) {
    return input;
  }
  return normalizeDefinition(payload.item);
}

export async function updateComponentDefinition(
  englishName: string,
  input: ComponentDefinition,
): Promise<ComponentDefinition> {
  const payload = await requestJson<unknown>(`/api/management/components/${encodeURIComponent(englishName)}`, {
    method: 'PUT',
    body: input,
  });
  if (!isRecord(payload) || !payload.item) {
    return input;
  }
  return normalizeDefinition(payload.item);
}

export async function deleteComponentDefinition(englishName: string): Promise<void> {
  await requestJson(`/api/management/components/${encodeURIComponent(englishName)}`, {
    method: 'DELETE',
  });
}

export async function invokeComponentDefinition(
  englishName: string,
  params: Record<string, unknown>,
): Promise<ComponentInvokeResult> {
  const payload = await requestJson<unknown>(`/api/management/components/${encodeURIComponent(englishName)}/invoke`, {
    method: 'POST',
    body: { params },
  });
  const row = isRecord(payload) ? payload : {};
  return {
    outputType: (asString(row.outputType, 'image') as ComponentReturnType) || 'image',
    text: asString(row.text),
    items: asArray(row.items).map((item) => {
      const value = isRecord(item) ? item : {};
      return {
        kind: asString(value.kind),
        url: asString(value.url),
        text: asString(value.text),
        mimeType: asString(value.mimeType),
      };
    }),
    raw: row.raw ?? null,
  };
}
