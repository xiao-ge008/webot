import type { Message, MessageTrace } from '@/data/mock-chats';
import type { ComponentDefinition, ComponentParameterMapping } from '@/services/component-client';
import { getComponentDefinition } from '@/services/component-client';
import { invokeManagementComponent } from '@/services/management-client';
import { chatRuntimeStore } from '@/services/chat-runtime-store';
import {
  buildComponentInvokeSummaryText,
  buildRenderableSpecFromComponentInvokeResult,
  cleanupAssistantText,
  extractComponentInvokeActionFromSpec,
  generateId,
  pushTrace,
  type ComponentInvokeActionPayload,
} from '@/components/chat/chat-page-helpers';

export const COMPONENT_INVOKE_PENDING_TEXT = '组件调用中，请稍候...';

interface ComponentInvokeExecutionOutcome {
  ok: boolean;
  trace: MessageTrace;
  renderSpec?: unknown;
  summaryText?: string;
}

const inflightTasks = new Map<string, Promise<void>>();
const sessionPendingCounts = new Map<string, number>();

function isMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function isDescriptiveMapping(mapping: ComponentParameterMapping): boolean {
  const semanticText = [
    mapping.parameterName,
    mapping.fieldName,
    mapping.label,
    mapping.description,
  ]
    .join(' ')
    .trim()
    .toLowerCase();
  return /tag|prompt|style|theme|mood|desc|description|text|message|content|instruction|note/.test(semanticText)
    || /(提示词|风格|主题|氛围|描述|文案|标签|说明)/.test(semanticText);
}

function buildMappingSemanticText(mapping: ComponentParameterMapping): string {
  return [
    mapping.parameterName,
    mapping.fieldName,
    mapping.label,
    mapping.description,
  ]
    .join(' ')
    .trim()
    .toLowerCase();
}

function isImageSourceMapping(mapping: ComponentParameterMapping): boolean {
  if (isDescriptiveMapping(mapping)) return false;
  const semanticText = buildMappingSemanticText(mapping);
  return /(^|[^a-z])(image|photo|portrait|avatar|mask|reference)([^a-z]|$)/.test(semanticText)
    || /(图片|照片|立绘|头像|遮罩|参考图)/.test(semanticText);
}

function isVideoSourceMapping(mapping: ComponentParameterMapping): boolean {
  if (isDescriptiveMapping(mapping)) return false;
  const semanticText = buildMappingSemanticText(mapping);
  return /(^|[^a-z])(video|clip)([^a-z]|$)/.test(semanticText)
    || /(视频|片段)/.test(semanticText);
}

function isAudioSourceMapping(mapping: ComponentParameterMapping): boolean {
  if (isDescriptiveMapping(mapping)) return false;
  const semanticText = buildMappingSemanticText(mapping);
  return /(^|[^a-z])(audio|voice|sound)([^a-z]|$)/.test(semanticText)
    || /(音频|声音|语音)/.test(semanticText);
}

function isFileSourceMapping(mapping: ComponentParameterMapping): boolean {
  if (isDescriptiveMapping(mapping)) return false;
  const semanticText = buildMappingSemanticText(mapping);
  return /(^|[^a-z])(file|upload|attachment|document)([^a-z]|$)/.test(semanticText)
    || /(文件|附件|上传)/.test(semanticText);
}

function aliasCandidatesForMapping(mapping: ComponentParameterMapping): string[] {
  const key = mapping.parameterName.trim().toLowerCase();
  if (isImageSourceMapping(mapping)) {
    return ['image', 'image_url', 'imageUrl', 'image_path', 'imagePath', 'src', 'url', 'path', 'photo', 'photo_url', 'photoUrl', 'reference', 'referenceImage', 'reference_image', 'mask'];
  }
  if (isVideoSourceMapping(mapping)) {
    return ['video', 'video_url', 'videoUrl', 'video_path', 'videoPath', 'src', 'url', 'path', 'file', 'file_url', 'fileUrl'];
  }
  if (isAudioSourceMapping(mapping)) {
    return ['audio', 'audio_url', 'audioUrl', 'audio_path', 'audioPath', 'src', 'url', 'path', 'file', 'file_url', 'fileUrl', 'voice'];
  }
  if (isFileSourceMapping(mapping)) {
    return ['file', 'file_url', 'fileUrl', 'src', 'url', 'path', 'attachment', 'attachment_url'];
  }
  if (key.includes('lyrics') || key.includes('lyric')) {
    return ['lyric', 'lyricsText', 'lyrics_text', 'lyricText', 'songLyrics', 'song_lyrics'];
  }
  if (key === 'language' || key === 'lang') {
    return ['lang', 'lyricsLanguage', 'lyrics_language', 'languageCode', 'language_code'];
  }
  if (key.includes('second') || key.includes('duration')) {
    return ['duration', 'durationSeconds', 'duration_seconds', 'second', 'seconds', 'length'];
  }
  if (key.includes('tag')) {
    return ['tag', 'tags', 'prompt', 'style', 'theme', 'mood', 'description', 'desc', 'vocal', 'voice', 'tempo', 'bpm', 'genre'];
  }
  if (isDescriptiveMapping(mapping)) {
    return ['prompt', 'style', 'theme', 'mood', 'description', 'desc', 'text', 'message', 'note', 'notes'];
  }
  return [];
}

function readParamValue(
  params: Record<string, unknown>,
  keys: string[],
  consumed: Set<string>,
): unknown {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      continue;
    }
    const value = params[key];
    if (!isMeaningfulValue(value)) {
      continue;
    }
    consumed.add(key);
    return value;
  }
  return undefined;
}

function shouldMergeIntoDescriptiveBucket(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return /prompt|style|theme|mood|description|desc|text|message|note|notes|vocal|voice|tempo|bpm|genre|instrument|instrumentation/.test(normalized);
}

function buildDescriptiveTextFromValue(key: string, value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    const label = key.trim();
    return label ? `${label}: ${String(value)}` : String(value);
  }
  return '';
}

function mergeDescriptiveStrings(parts: string[]): string {
  const seen = new Set<string>();
  const normalized = parts
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
  return normalized.join('\n');
}

async function normalizeComponentInvokePayload(
  payload: ComponentInvokeActionPayload,
): Promise<ComponentInvokeActionPayload> {
  const componentName = payload.componentName.trim();
  if (!componentName) {
    return payload;
  }

  let definition: ComponentDefinition | null = null;
  try {
    definition = await getComponentDefinition(componentName);
  } catch {
    return payload;
  }
  if (!definition || definition.workflow.parameterMappings.length === 0) {
    return payload;
  }

  const params = payload.params || {};
  const consumed = new Set<string>();
  const nextParams: Record<string, unknown> = {};

  for (const mapping of definition.workflow.parameterMappings) {
    const value = readParamValue(
      params,
      [mapping.parameterName, ...aliasCandidatesForMapping(mapping)],
      consumed,
    );
    if (!isMeaningfulValue(value)) {
      continue;
    }
    nextParams[mapping.parameterName] = value;
  }

  const descriptiveTarget = definition.workflow.parameterMappings.find((mapping) => isDescriptiveMapping(mapping));
  if (descriptiveTarget) {
    const currentValue = typeof nextParams[descriptiveTarget.parameterName] === 'string'
      ? String(nextParams[descriptiveTarget.parameterName]).trim()
      : '';
    const extraParts = Object.entries(params)
      .filter(([key, value]) => !consumed.has(key) && isMeaningfulValue(value) && shouldMergeIntoDescriptiveBucket(key))
      .map(([key, value]) => buildDescriptiveTextFromValue(key, value))
      .filter(Boolean);
    const merged = mergeDescriptiveStrings([
      currentValue,
      ...extraParts,
    ]);
    if (merged) {
      nextParams[descriptiveTarget.parameterName] = merged;
    }
  }

  return {
    ...payload,
    params: nextParams,
  };
}

function pickPreviewUrlFromPayload(payload: ComponentInvokeActionPayload): string | undefined {
  const params = payload.params;
  const candidates = [
    params.image,
    params.image_url,
    params.imageUrl,
    params.src,
    params.cover,
    params.poster,
    params.thumbnail,
    params.path,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function inferPendingJobType(payload: ComponentInvokeActionPayload): string {
  const name = payload.componentName.trim().toLowerCase();
  if (name.includes('video')) return 'video';
  if (name.includes('image') || name.includes('img')) return 'image';
  if (name.includes('audio') || name.includes('voice') || name.includes('speech')) return 'audio';
  if (name.includes('text') || name.includes('markdown')) return 'text';
  return 'generic';
}

function buildComponentInvokeJobSpec(
  messageId: string,
  payload: ComponentInvokeActionPayload,
  options?: {
    status?: string;
    stage?: string;
    summary?: string;
  },
): unknown {
  const componentName = payload.componentName.trim() || '组件任务';
  const previewUrl = pickPreviewUrlFromPayload(payload);
  return {
    type: 'JobProgressCard',
    props: {
      title: componentName,
      summary: options?.summary || `${componentName} 已提交，正在处理中。`,
      status: options?.status || 'running',
      stage: options?.stage || 'submitting',
      jobType: inferPendingJobType(payload),
      jobId: `component-invoke:${messageId.trim() || 'pending'}`,
      capabilityKey: 'component_invoke',
      capabilityScope: 'generic',
      providerType: 'component_skill',
      route: 'component_invoke',
      ...(previewUrl ? { previewUrl } : {}),
      ...(previewUrl ? { resultPayload: { previewUrl } } : {}),
      metadata: {
        componentName: payload.componentName,
        localOnly: true,
        ...(previewUrl ? { previewUrl } : {}),
      },
    },
  };
}

function buildTaskKey(
  runtimeAgentId: string,
  sessionId: string,
  messageId: string,
  componentName: string,
): string {
  return [
    runtimeAgentId.trim(),
    sessionId.trim(),
    messageId.trim(),
    componentName.trim(),
  ].join('::');
}

function buildSessionKey(runtimeAgentId: string, sessionId: string): string {
  return `${runtimeAgentId.trim()}::${sessionId.trim()}`;
}

function buildComponentInvokeTraceDetail(
  payload: ComponentInvokeActionPayload,
  result: unknown,
  options?: { error?: string; summaryText?: string },
): string {
  try {
    return JSON.stringify({
      tool: 'component_invoke',
      component_name: payload.componentName,
      input: {
        params: payload.params,
        render_result: payload.renderResult === true,
        expose_to_agent: payload.exposeToAgent !== false,
      },
      summary: options?.summaryText || '',
      result,
      is_error: Boolean(options?.error),
      error: options?.error || undefined,
    });
  } catch {
    return JSON.stringify({
      tool: 'component_invoke',
      component_name: payload.componentName,
      summary: options?.summaryText || '',
      is_error: Boolean(options?.error),
      error: options?.error || undefined,
    });
  }
}

async function invokeComponentActionPayload(
  payload: ComponentInvokeActionPayload,
  ctx?: { agentId?: string },
): Promise<ComponentInvokeExecutionOutcome> {
  const normalizedPayload = await normalizeComponentInvokePayload(payload);
  const componentName = normalizedPayload.componentName.trim();
  try {
    const result = await invokeManagementComponent(componentName, normalizedPayload.params, {
      agentId: ctx?.agentId,
    });
    const summaryText = buildComponentInvokeSummaryText(componentName, result, { includeUrls: false })
      || `组件 ${componentName} 已完成调用。`;
    return {
      ok: true,
      trace: {
        id: generateId(),
        title: `组件调用 ${componentName} 完成`,
        detail: buildComponentInvokeTraceDetail(normalizedPayload, result, { summaryText }),
        at: new Date().toISOString(),
      },
      renderSpec: normalizedPayload.renderResult
        ? buildRenderableSpecFromComponentInvokeResult(result, normalizedPayload.resultTitle || componentName, {
          posterUrl: pickPreviewUrlFromPayload(normalizedPayload),
        })
        : undefined,
      summaryText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '组件调用失败';
    return {
      ok: false,
      trace: {
        id: generateId(),
        title: `组件调用 ${componentName} 失败`,
        detail: buildComponentInvokeTraceDetail(normalizedPayload, null, { error: message, summaryText: message }),
        at: new Date().toISOString(),
      },
      summaryText: `组件 ${componentName} 调用失败：${message}`,
    };
  }
}

function mergeComponentInvokeOutcomeIntoMessage(
  message: Message,
  payload: ComponentInvokeActionPayload,
  outcome: ComponentInvokeExecutionOutcome,
): Message {
  const next: Message = {
    ...message,
    thinking: false,
    streaming: false,
    cardPending: false,
    toolTrace: pushTrace(message.toolTrace, outcome.trace),
  };
  const lingeringAction = extractComponentInvokeActionFromSpec(next.spec);
  if (lingeringAction) {
    next.spec = lingeringAction.strippedSpec;
    next.uiRawText = '';
  }
  if (outcome.ok && payload.renderResult && outcome.renderSpec != null) {
    next.spec = outcome.renderSpec;
    next.debugSpecSource = next.debugSpecSource === 'none' ? 'tool_result' : next.debugSpecSource;
  } else if (outcome.summaryText) {
    next.spec = buildComponentInvokeJobSpec(next.id, payload, {
      status: outcome.ok ? 'completed' : 'failed',
      stage: outcome.ok ? 'completed' : 'failed',
      summary: outcome.summaryText,
    });
  }
  if ((!(next.text || '').trim() || (next.text || '').trim() === COMPONENT_INVOKE_PENDING_TEXT) && outcome.summaryText) {
    next.text = outcome.summaryText;
  }
  next.text = cleanupAssistantText(next.text || '', next.spec);
  next.uiStreamState = next.spec != null || (next.uiRawText || '').trim()
    ? 'ready'
    : 'idle';
  return next;
}

function markSessionComponentPending(runtimeAgentId: string, sessionId: string): void {
  const agentKey = runtimeAgentId.trim();
  const sessionKey = sessionId.trim();
  if (!agentKey || !sessionKey) {
    return;
  }
  const key = buildSessionKey(agentKey, sessionKey);
  const nextCount = (sessionPendingCounts.get(key) ?? 0) + 1;
  sessionPendingCounts.set(key, nextCount);
  if (nextCount !== 1) {
    return;
  }
  const state = chatRuntimeStore.getAgentState(agentKey);
  const session = state.sessions.find((item) => item.id === sessionKey);
  if ((session?.streamState ?? 'idle') === 'idle') {
    chatRuntimeStore.setSessionStreamState(agentKey, sessionKey, 'waiting', false);
  }
}

function clearSessionComponentPending(runtimeAgentId: string, sessionId: string): void {
  const agentKey = runtimeAgentId.trim();
  const sessionKey = sessionId.trim();
  if (!agentKey || !sessionKey) {
    return;
  }
  const key = buildSessionKey(agentKey, sessionKey);
  const current = sessionPendingCounts.get(key) ?? 0;
  if (current <= 1) {
    sessionPendingCounts.delete(key);
  } else {
    sessionPendingCounts.set(key, current - 1);
    return;
  }
  const state = chatRuntimeStore.getAgentState(agentKey);
  const session = state.sessions.find((item) => item.id === sessionKey);
  if ((session?.streamState ?? 'idle') === 'waiting') {
    chatRuntimeStore.setSessionStreamState(agentKey, sessionKey, 'idle', false);
  }
}

export function prepareMessageForComponentInvokeAction(
  message: Message,
  payload: ComponentInvokeActionPayload,
): Message {
  const next: Message = {
    ...message,
    thinking: false,
    streaming: false,
    cardPending: false,
    generationStartedAt: message.generationStartedAt ?? Date.now(),
  };
  const lingeringAction = extractComponentInvokeActionFromSpec(next.spec);
  if (lingeringAction) {
    next.spec = lingeringAction.strippedSpec;
    next.uiRawText = '';
  }
  next.spec = buildComponentInvokeJobSpec(message.id, payload);
  next.text = cleanupAssistantText(next.text || '', next.spec);
  if (!(next.text || '').trim() && next.spec == null) {
    next.text = COMPONENT_INVOKE_PENDING_TEXT;
  }
  next.uiStreamState = next.spec != null || (next.uiRawText || '').trim()
    ? 'ready'
    : 'idle';
  return next;
}

export function enqueueComponentInvokeForMessage(args: {
  runtimeAgentId: string;
  sessionId: string;
  messageId: string;
  payload: ComponentInvokeActionPayload;
  agentId?: string;
}): Promise<void> {
  const runtimeAgentId = args.runtimeAgentId.trim();
  const sessionId = args.sessionId.trim();
  const messageId = args.messageId.trim();
  const componentName = args.payload.componentName.trim();
  if (!runtimeAgentId || !sessionId || !messageId || !componentName) {
    return Promise.resolve();
  }

  const taskKey = buildTaskKey(runtimeAgentId, sessionId, messageId, componentName);
  const existing = inflightTasks.get(taskKey);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    markSessionComponentPending(runtimeAgentId, sessionId);
    chatRuntimeStore.patchSessionMessage(runtimeAgentId, sessionId, messageId, (message) =>
      prepareMessageForComponentInvokeAction(message, args.payload),
    );
    const outcome = await invokeComponentActionPayload(args.payload, { agentId: args.agentId });
    chatRuntimeStore.patchSessionMessage(runtimeAgentId, sessionId, messageId, (message) =>
      mergeComponentInvokeOutcomeIntoMessage(message, args.payload, outcome),
    );
  })().finally(() => {
    inflightTasks.delete(taskKey);
    clearSessionComponentPending(runtimeAgentId, sessionId);
  });

  inflightTasks.set(taskKey, task);
  return task;
}
