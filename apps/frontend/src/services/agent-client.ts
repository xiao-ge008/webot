import { AGENT_IPC_CHANNELS } from "@/main/ipc-contract";
import { compileSpecStream } from "@json-render/core";
import type {
  AgentProfile,
  AgentRuntimeStatus,
  AgentLogTail,
  AgentCollaborationEvent,
  GetAgentCollaborationEventsInput,
  GetAgentLogTailInput,
  SaveAgentInput,
  SaveAgentResult,
  StartAgentInput,
  StartAgentResult,
  StopAgentInput,
  StopAgentResult,
  ListAgentsInput,
  AgentChatInput,
  AgentChatResult,
  AgentChatStreamChunk,
  AgentAppearanceUpdated,
  CancelAgentChatInput,
  CancelAgentChatResult,
  AgentTaskCreateInput,
  AgentTaskCreateResult,
  AgentTaskDeleteInput,
  AgentTaskDeleteResult,
  AgentTaskListInput,
  AgentTaskListResult,
  AgentTaskProgressInput,
  AgentTaskProgressResult,
  AgentTaskLogItem,
  AgentNotificationListInput,
  AgentNotificationListResult,
  AgentNotificationMarkReadInput,
  AgentNotificationMarkReadResult,
  AgentTask,
} from "@/main/types";
import { CHAT_CHANNELS, CHAT_RENDER_MODES } from "@/main/types";
import { primeManifestSchemaCache } from "@/components/chat/chat-page-helpers";
import {
  requestJson,
  requestOpenFangJson,
  requestSse,
  requestWebSocket,
} from "@/services/transport";
import {
  getAgentSkillAssignments,
  getManagementAgentDetail,
  listManagementA2aAgents,
  listManagementAgents,
} from "@/services/management-client";

interface SettingsApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

interface IpcInvoker {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
}

interface IpcEmitter {
  on: (
    channel: string,
    listener: (payload: unknown) => void,
  ) => void | (() => void);
  off: (channel: string, listener: (payload: unknown) => void) => void;
}

interface OpenFangAgentSummary {
  id?: string;
  name?: string;
  english_name?: string;
  nickname?: string;
  state?: string;
  created_at?: string;
  model_provider?: string;
  model_name?: string;
  profile?: string;
  model?: {
    provider?: string;
    model?: string;
  };
  description?: string;
  tags?: string[];
  identity?: {
    avatar_url?: string;
    color?: string;
  };
}

interface OpenFangAgentDetail extends OpenFangAgentSummary {}

interface OpenFangCronJob {
  id?: string;
  agent_id?: string;
  name?: string;
  enabled?: boolean;
  schedule?: {
    kind?: string;
    expr?: string;
    tz?: string;
    at?: string;
    every_secs?: number;
  };
  action?: {
    kind?: string;
    message?: string;
    text?: string;
  };
  next_run?: string;
  last_run?: string;
  last_status?: string;
  last_output?: string;
  output?: string;
  status?: string;
}

export interface AgentSessionMessage {
  role: string;
  content: string;
}

export interface AgentSessionResult {
  success: boolean;
  sessionId?: string;
  messages: AgentSessionMessage[];
  message?: string;
}

export interface DeleteAgentSessionInput {
  agentId: string;
  sessionId?: string;
  sessionLabel?: string;
}

export interface DeleteAgentSessionResult {
  success: boolean;
  deleted: boolean;
  sessionId?: string;
  message?: string;
}

export interface CompactAgentSessionInput {
  agentId: string;
  sessionId?: string;
  sessionLabel?: string;
}

export interface CompactAgentSessionResult {
  success: boolean;
  sessionId?: string;
  message?: string;
}

export interface EditableAgentSessionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface UpdateAgentSessionContentInput {
  agentId: string;
  sessionId?: string;
  sessionLabel?: string;
  messages: readonly EditableAgentSessionMessage[];
}

export interface UpdateAgentSessionContentResult {
  success: boolean;
  sessionId?: string;
  message?: string;
}

const streamSubscribers = new Set<(chunk: AgentChatStreamChunk) => void>();
const requestToAgentId = new Map<string, string>();
const requestAbortControllers = new Map<string, AbortController>();
const skillPromptContextCache = new Map<string, string>();
const availableSkillComponentsCache = new Map<string, string[]>();
const skillComponentManifestCache = new Map<
  string,
  {
    description: string;
    propsSchema: unknown;
    example: unknown;
    invokeExample: unknown;
  }
>();
const managementComponentInvokeContextCache = new Map<string, string>();
const collaborationHintCache = new Map<
  string,
  { expiresAt: number; hint: string }
>();
const COLLABORATION_HINT_TTL_MS = 5_000;
const STREAM_FIRST_EVENT_TIMEOUT_MS = 20_000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;
const STREAM_TOOL_IDLE_TIMEOUT_MS = 10 * 60_000;
const STREAM_IMAGE_TOOL_IDLE_TIMEOUT_MS = 20 * 60_000;
const STREAM_MAX_TIMEOUT_MS = 3_600_000;
const CHAT_RECOVERY_SETTLE_MS = 500;
const COLLAB_TAG_DISPATCH = "webot:collab_dispatcher";
const COLLAB_CONFIG_BEGIN = "[WEBOT_COLLAB_CONFIG_BEGIN]";
const COLLAB_CONFIG_END = "[WEBOT_COLLAB_CONFIG_END]";

function normalizeStreamToolName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isLikelyLongRunningImageTool(toolName: string): boolean {
  const normalized = normalizeStreamToolName(toolName);
  if (!normalized) {
    return false;
  }
  if (
    normalized === "image_generate" ||
    normalized === "image_edit" ||
    normalized === "my_photo_generate" ||
    normalized === "my_photo_edit"
  ) {
    return true;
  }
  const hasImageScope =
    /(image|photo|avatar|portrait|poster|cover)/.test(normalized);
  const hasGenerationVerb =
    /(generate|edit|render|upscale|inpaint|outpaint|variation)/.test(
      normalized,
    );
  return hasImageScope && hasGenerationVerb;
}

export function invalidateComponentSkillRuntimeCaches(): void {
  skillPromptContextCache.clear();
  availableSkillComponentsCache.clear();
  skillComponentManifestCache.clear();
  managementComponentInvokeContextCache.clear();
}

interface CollaborationConfigPayload {
  discoverable: boolean;
  dispatchEnabled: boolean;
  selectedWorkers: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function isStrictSourceParamName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^(image|image_url|imageurl|src|url|path|photo|mask|reference|input_image|inputimage|lyrics)$/.test(normalized);
}

function isPromptLikeParamName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /prompt|style|theme|mood|description|desc|text|message|content|instruction|note|script|story|tag/.test(normalized);
}

function buildComponentMappingSemanticText(mapping: Record<string, unknown>): string {
  return [
    toStringValue(mapping.parameterName),
    toStringValue(mapping.fieldName),
    toStringValue(mapping.label),
    toStringValue(mapping.description),
  ]
    .join(' ')
    .trim()
    .toLowerCase();
}

function isStrictSourceComponentMapping(mapping: Record<string, unknown>): boolean {
  const parameterName = toStringValue(mapping.parameterName).trim();
  if (!parameterName) {
    return false;
  }
  if (isPromptLikeParamName(parameterName)) {
    return false;
  }
  if (isStrictSourceParamName(parameterName)) {
    return true;
  }
  const semanticText = buildComponentMappingSemanticText(mapping);
  if (!semanticText) {
    return false;
  }
  if (/(图片|照片|立绘|头像|遮罩|参考图|歌词|音频|声音文件|视频源|上传文件|附件)/.test(semanticText)) {
    return true;
  }
  return /(^|[^a-z])(image|photo|portrait|avatar|mask|reference|audio|video|file|upload|attachment)([^a-z]|$)/.test(semanticText);
}

function isDescriptiveComponentMapping(mapping: Record<string, unknown>): boolean {
  const semanticText = buildComponentMappingSemanticText(mapping);
  return /prompt|style|theme|mood|description|desc|text|message|content|instruction|note|script|story|tag/.test(semanticText)
    || /(提示词|风格|主题|氛围|描述|文案|脚本|剧情|标签|说明)/.test(semanticText);
}

function toBooleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const globalWindow = window as unknown as { __TAURI_INTERNALS__?: unknown };
  return Boolean(globalWindow.__TAURI_INTERNALS__);
}

function toNumberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseAgentAppearanceUpdated(
  value: unknown,
): AgentAppearanceUpdated | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const agentId = toStringValue(
    value.agentId,
    toStringValue(value.agent_id),
  ).trim();
  const resolvedAgentId = toStringValue(
    value.resolvedAgentId,
    toStringValue(value.resolved_agent_id),
  ).trim();
  const avatarUrl = toStringValue(
    value.avatarUrl,
    toStringValue(value.avatar_url),
  ).trim();
  const portraitUrl = toStringValue(
    value.portraitUrl,
    toStringValue(value.portrait_url),
  ).trim();
  const reason = toStringValue(value.reason).trim();
  const updatedFields = asArray<unknown>(
    value.updatedFields ?? value.updated_fields,
  )
    .map((item) => toStringValue(item).trim().toLowerCase())
    .filter(
      (item): item is "avatar" | "portrait" =>
        item === "avatar" || item === "portrait",
    );
  if (
    !agentId &&
    !resolvedAgentId &&
    !avatarUrl &&
    !portraitUrl &&
    !reason &&
    updatedFields.length === 0
  ) {
    return undefined;
  }
  return {
    agentId: agentId || undefined,
    resolvedAgentId: resolvedAgentId || undefined,
    avatarUrl: avatarUrl || undefined,
    portraitUrl: portraitUrl || undefined,
    reason: reason || undefined,
    updatedFields: updatedFields.length > 0 ? updatedFields : undefined,
  };
}

function parseAgentAppearanceUpdatedFromPayload(
  payload: unknown,
): AgentAppearanceUpdated | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  return parseAgentAppearanceUpdated(
    payload.appearanceUpdated ?? payload.appearance_updated,
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function escapeRegexText(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCollaborationConfigFromText(
  rawText: string,
): CollaborationConfigPayload | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }
  const pattern = new RegExp(
    `${escapeRegexText(COLLAB_CONFIG_BEGIN)}\\s*([\\s\\S]*?)\\s*${escapeRegexText(COLLAB_CONFIG_END)}`,
    "m",
  );
  const matched = pattern.exec(text);
  if (!matched?.[1]) {
    return null;
  }
  try {
    const parsed = JSON.parse(matched[1]);
    if (!isRecord(parsed)) {
      return null;
    }
    const selectedWorkers = Array.isArray(parsed.selectedWorkers)
      ? parsed.selectedWorkers.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];
    return {
      discoverable: Boolean(parsed.discoverable),
      dispatchEnabled: Boolean(parsed.dispatchEnabled),
      selectedWorkers,
    };
  } catch {
    return null;
  }
}

function hasTag(tags: string[], target: string): boolean {
  const normalizedTarget = target.trim().toLowerCase();
  return tags.some((tag) => tag.trim().toLowerCase() === normalizedTarget);
}

function normalizeCollaborationWorkerKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("local:") || trimmed.startsWith("a2a:")) {
    return trimmed;
  }
  return `local:${trimmed}`;
}

function normalizeCollaborationWorkerKeys(values: string[]): string[] {
  return uniqueStrings(
    values.map(normalizeCollaborationWorkerKey).filter(Boolean),
  );
}

function parseJsonSafely<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function unwrapResponseEnvelopeText(raw: string): string {
  let text = raw.trim();
  if (!text) return "";

  for (let i = 0; i < 3; i += 1) {
    const parsed = parseJsonSafely<unknown>(text);
    if (!parsed || typeof parsed !== "object") break;
    const obj = parsed as Record<string, unknown>;
    const content = (
      (typeof obj.content === "string" && obj.content) ||
      (typeof obj.text === "string" && obj.text) ||
      (typeof obj.response === "string" && obj.response) ||
      ""
    ).trim();
    if (!content || content === text) break;
    text = content;
  }

  return text;
}

function extractUiRawText(raw: string): string {
  const text = unwrapResponseEnvelopeText(raw);
  const match = text.match(/<ui[-_]json>/i);
  return match && typeof match.index === "number" ? text.slice(match.index).trim() : "";
}

function extractLeadingSpecStreamPatch(buffer: string): {
  consumed: string;
  remaining: string;
  patches: string[];
} {
  const patches: string[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    while (cursor < buffer.length && /\s/.test(buffer[cursor])) {
      cursor += 1;
    }
    if (cursor >= buffer.length || buffer[cursor] !== "{") {
      break;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let index = cursor; index < buffer.length; index += 1) {
      const char = buffer[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
        continue;
      }

      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }

    if (end < 0) {
      break;
    }

    const candidate = buffer.slice(cursor, end).trim();
    const parsed = parseJsonSafely<Record<string, unknown>>(candidate);
    if (!parsed || !looksLikeGenUiPatch(parsed)) {
      break;
    }

    patches.push(candidate);
    cursor = end;
  }

  return {
    consumed: buffer.slice(0, cursor),
    remaining: buffer.slice(cursor),
    patches,
  };
}

function extractJsonBlocks(
  text: string,
): Array<{ raw: string; value: unknown }> {
  const blocks: Array<{ raw: string; value: unknown }> = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          const raw = text.slice(start, i + 1);
          const parsed = parseJsonSafely<unknown>(raw);
          if (parsed !== null) {
            blocks.push({ raw, value: parsed });
          }
          start = -1;
        }
      }
    }
  }

  return blocks;
}

function looksLikeGenUiSpec(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "object") return false;
  const obj = candidate as Record<string, unknown>;
  if (
    typeof obj.root === "string" &&
    obj.elements &&
    typeof obj.elements === "object"
  ) {
    const elements = Object.values(obj.elements as Record<string, unknown>);
    return elements.some(
      (el) =>
        typeof el === "object" &&
        el !== null &&
        typeof (el as any).type === "string",
    );
  }
  if (typeof obj.type === "string" && (obj.props || obj.children)) {
    return true;
  }
  return false;
}

function looksLikeGenUiPatch(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "object") return false;
  const obj = candidate as Record<string, unknown>;
  if (typeof obj.op !== "string" || typeof obj.path !== "string") return false;
  return (
    ["add", "remove", "replace", "move", "copy", "test"].includes(obj.op) &&
    obj.path.startsWith("/")
  );
}

const NON_UI_EVENT_TYPES = new Set([
  "typing",
  "phase",
  "response",
  "done",
  "error",
  "tool_result",
  "tool_use",
]);

function normalizeGenUiSpec(spec: unknown): unknown | undefined {
  if (!spec) return undefined;

  if (looksLikeGenUiSpec(spec)) return spec;

  if (Array.isArray(spec)) {
    const children = spec
      .map((item) => normalizeGenUiSpec(item))
      .filter((item): item is unknown => item !== undefined);
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { type: "div", props: {}, children };
  }

  if (typeof spec !== "object") return undefined;
  const obj = spec as Record<string, unknown>;

  if (Array.isArray(obj.children)) {
    return { type: "div", props: {}, children: obj.children };
  }

  if (typeof obj.type === "string") {
    const rawType = obj.type.trim();
    if (!rawType) return undefined;
    if (NON_UI_EVENT_TYPES.has(rawType.toLowerCase())) return undefined;

    if (
      !Object.prototype.hasOwnProperty.call(obj, "props") &&
      !Object.prototype.hasOwnProperty.call(obj, "children") &&
      !Object.prototype.hasOwnProperty.call(obj, "slots") &&
      !Object.prototype.hasOwnProperty.call(obj, "elements") &&
      Object.keys(obj).length === 1
    ) {
      return {
        type: rawType,
        props: {},
      };
    }

    if (
      (obj.props && typeof obj.props === "object") ||
      Object.prototype.hasOwnProperty.call(obj, "children") ||
      Object.prototype.hasOwnProperty.call(obj, "slots") ||
      Object.prototype.hasOwnProperty.call(obj, "elements")
    ) {
      return obj;
    }

    const rest = { ...obj };
    delete rest.type;
    if (Object.keys(rest).length === 0) {
      return {
        type: rawType,
        props: {},
      };
    }
    return {
      type: rawType,
      props: rest,
    };
  }

  return undefined;
}

function mergeGenUiSpecs(specs: unknown[]): unknown | undefined {
  if (specs.length === 0) return undefined;
  if (specs.length === 1) return specs[0];
  return {
    type: "div",
    props: {},
    children: specs,
  };
}

function parseSpecFromText(text: string): unknown | undefined {
  const uiTagMatches = Array.from(
    text.matchAll(/<ui[-_]json>\s*([\s\S]*?)\s*<\/ui[-_]json>/gi),
  );
  if (uiTagMatches.length > 0) {
    const taggedSpecs = uiTagMatches
      .map((match) =>
        normalizeGenUiSpec(parseJsonSafely<unknown>((match[1] || "").trim())),
      )
      .filter((item): item is unknown => item !== undefined);
    const mergedTagged = mergeGenUiSpecs(taggedSpecs);
    if (mergedTagged) {
      return mergedTagged;
    }
  }

  const blocks = extractJsonBlocks(text);
  if (blocks.length === 0) return undefined;

  const normalizedSpecs = blocks
    .map((item) => normalizeGenUiSpec(item.value))
    .filter((item): item is unknown => item !== undefined);
  const mergedSpecs = mergeGenUiSpecs(normalizedSpecs);
  if (mergedSpecs) {
    return mergedSpecs;
  }

  const patchLines = blocks
    .filter((item) => looksLikeGenUiPatch(item.value))
    .map((item) => item.raw.trim());
  if (patchLines.length > 0) {
    try {
      const patchSpec = compileSpecStream(patchLines.join("\n"));
      const normalizedPatch = normalizeGenUiSpec(patchSpec);
      if (normalizedPatch) {
        return normalizedPatch;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseSpecFromEventPayload(
  payload: Record<string, unknown>,
): unknown | undefined {
  const candidates = [
    payload.spec,
    payload.ui,
    payload.schema,
    payload.component,
    payload.render,
  ];
  for (const item of candidates) {
    const normalized = normalizeGenUiSpec(item);
    if (normalized) {
      return normalized;
    }
  }

  const textCandidate =
    toStringValue(payload.text) ||
    toStringValue(payload.content) ||
    toStringValue(payload.message);
  if (!textCandidate) return undefined;
  return parseSpecFromText(textCandidate);
}

function parseTaskDraftMetaFromPayload(
  payload: Record<string, unknown> | null | undefined,
): {
  taskCard?: unknown;
  taskDraftState?: unknown;
  taskDraftMatched?: boolean;
  taskDraftCancelled?: boolean;
  taskDraftReadyToConfirm?: boolean;
} {
  if (!payload) {
    return {};
  }
  const taskDraftMatched = toBooleanValue(
    payload.task_draft_matched,
    toBooleanValue(payload.taskDraftMatched, false),
  );
  const taskDraftCancelled = toBooleanValue(
    payload.task_draft_cancelled,
    toBooleanValue(payload.taskDraftCancelled, false),
  );
  const taskDraftReadyToConfirm = toBooleanValue(
    payload.task_draft_ready_to_confirm,
    toBooleanValue(payload.taskDraftReadyToConfirm, false),
  );
  const taskDraftState = payload.task_draft ?? payload.taskDraftState;
  const taskCard = payload.task_card ?? payload.taskCard;
  return {
    ...(taskCard !== undefined ? { taskCard } : {}),
    ...(taskDraftState !== undefined ? { taskDraftState } : {}),
    ...(taskDraftMatched ? { taskDraftMatched } : {}),
    ...(taskDraftCancelled ? { taskDraftCancelled } : {}),
    ...(taskDraftReadyToConfirm ? { taskDraftReadyToConfirm } : {}),
  };
}

function createRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasLocalVisionText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function buildOutgoingAttachmentRefs(
  attachments: AgentChatInput["attachments"] | undefined,
): Array<{ file_id: string; filename: string; content_type: string }> {
  return (attachments ?? [])
    .filter(
      (item) =>
        !hasLocalVisionText(item.localVisionSummary)
        && typeof item.fileId === "string"
        && item.fileId.trim().length > 0,
    )
    .map((item) => ({
      file_id: (item.fileId || "").trim(),
      filename: (item.filename || "").trim(),
      content_type: (item.contentType || "").trim(),
    }));
}

function normalizeSessionLabelComponent(raw: string, maxLen: number): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let out = "";
  for (const ch of trimmed) {
    if (out.length >= maxLen) break;
    if (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "-" ||
      ch === "_"
    ) {
      out += ch;
    } else {
      out += "_";
    }
  }
  return out.replace(/^_+|_+$/g, "");
}

function buildRecoveredSessionLabel(
  baseLabel: string,
  agentId: string,
): string {
  const base =
    normalizeSessionLabelComponent(baseLabel || agentId || "chat", 72) ||
    "chat";
  const stamp = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}_recover_${stamp}_${suffix}`;
}

type ChatRecoveryReason =
  | "session_conflict"
  | "context_overflow"
  | "quota_exceeded";

function isQuotaExceededFailure(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes("resource quota exceeded") ||
    text.includes("quota exceeded") ||
    text.includes("rate limit exceeded") ||
    (text.includes("http 429") && text.includes("token limit exceeded"))
  );
}

function isRecoverableStreamingFailure(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  if (text.includes("no stream events received within")) return false;
  if (
    text.includes("session conflict") ||
    text.includes("already running") ||
    text.includes("another request") ||
    text.includes("active request")
  ) {
    return true;
  }
  if (text.includes("response failed") && text.includes("500")) return true;
  return (
    text.includes("http 500") &&
    (text.includes("/message/stream") ||
      text.includes("openfang") ||
      text.includes("sse"))
  );
}

function isContextOverflowFailure(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes("token limit exceeded") ||
    text.includes("context length") ||
    text.includes("context window") ||
    text.includes("context_length_exceeded") ||
    text.includes("prompt is too long") ||
    text.includes("input too long") ||
    text.includes("max tokens exceeded") ||
    text.includes("too many tokens")
  );
}

function resolveChatRecoveryReason(
  result: AgentChatResult,
): ChatRecoveryReason | null {
  if (result.success) return null;
  const message = result.error || result.content || "";
  if ((result.content || "").trim()) return null;
  if (isQuotaExceededFailure(message)) {
    return "quota_exceeded";
  }
  if (isContextOverflowFailure(message)) {
    return "context_overflow";
  }
  if (isRecoverableStreamingFailure(message)) {
    return "session_conflict";
  }
  return null;
}

async function waitForChatRecoverySettle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, CHAT_RECOVERY_SETTLE_MS);
  });
}

async function recoverAgentChatSession(
  input: AgentChatInput,
  reason: ChatRecoveryReason,
): Promise<{ recoveredInput: AgentChatInput; recoveredSessionLabel: string }> {
  const recoveredSessionLabel = buildRecoveredSessionLabel(
    typeof input.sessionLabel === "string" ? input.sessionLabel.trim() : "",
    input.agentId,
  );
  if (reason === "session_conflict") {
    await stopAgent({ agentId: input.agentId });
    await waitForChatRecoverySettle();
  }
  return {
    recoveredSessionLabel,
    recoveredInput: {
      ...input,
      sessionId: undefined,
      sessionLabel: recoveredSessionLabel,
    },
  };
}

async function buildCollaborationAgentHint(
  currentAgentId: string,
): Promise<string> {
  const cacheHit = collaborationHintCache.get(currentAgentId);
  const now = Date.now();
  if (cacheHit && cacheHit.expiresAt > now) {
    return cacheHit.hint;
  }

  let hint = "";
  try {
    const [currentAgent, agents] = await Promise.all([
      getManagementAgentDetail(currentAgentId),
      listManagementAgents(),
    ]);
    const parsedConfig =
      currentAgent.collaboration ||
      parseCollaborationConfigFromText(currentAgent.system_prompt || "");
    const dispatchEnabled = parsedConfig
      ? parsedConfig.dispatchEnabled
      : hasTag(currentAgent.tags || [], COLLAB_TAG_DISPATCH);
    if (!dispatchEnabled) {
      hint = "";
    } else {
      const selectedWorkerKeys = normalizeCollaborationWorkerKeys(
        parsedConfig?.selectedWorkers || [],
      );
      const hasA2aWorkers = selectedWorkerKeys.some((key) =>
        key.startsWith("a2a:"),
      );
      const a2aCards = hasA2aWorkers
        ? await listManagementA2aAgents().catch(() => [])
        : [];
      const selectedLines = selectedWorkerKeys.map((key) => {
        if (key.startsWith("local:")) {
          const id = key.slice("local:".length).trim();
          const hit = agents.find((item) => item.id === id);
          const alias =
            hit?.nickname?.trim() || hit?.name || id || "unknown-local-worker";
          const profile = (hit?.description || "").trim().replace(/\s+/g, " ");
          return `- local worker: agent_id=${id}; display_name=${alias}${profile ? `; profile=${profile.slice(0, 120)}` : ""}`;
        }
        if (key.startsWith("a2a:")) {
          const name = key.slice("a2a:".length).trim();
          const hit = a2aCards.find((item) => item.name === name);
          const skillNames = (hit?.skills || [])
            .map((skill) => (skill.name || skill.id || "").trim())
            .filter((item) => item.length > 0)
            .slice(0, 4);
          const skillsText =
            skillNames.length > 0 ? `；skills=${skillNames.join(", ")}` : "";
          return `- external a2a worker: exact_name=${name || "unknown-a2a-worker"}${skillsText}`;
        }
        return `- ${key}`;
      });
      hint = [
        "[multi-agent-hints]",
        "你当前可调度的白名单如下（仅以下对象允许委派）：",
        selectedLines.length > 0 ? selectedLines.join("\n") : "- 无",
        "严格规则：当用户询问“你有几个小伙伴/可调度对象”时，只能按上述白名单数量回答。",
        "强制规则：调用本地智能体时，agent_find / agent_send 的参数必须使用 agent_id，绝对不能使用昵称、中文名、display_name 或口头称呼。",
        "如果是 external a2a worker，只有在白名单未提供 id 时，才允许使用 exact_name，而且必须原样填写。",
        "委派策略：当任务可拆分或需专长时，优先执行 agent_find，再执行 agent_send，并在最终回复汇总每个子智能体的结果。",
      ].join("\n");
    }
  } catch {
    hint = "";
  }

  collaborationHintCache.set(currentAgentId, {
    expiresAt: now + COLLABORATION_HINT_TTL_MS,
    hint,
  });
  return hint;
}

function parseWsMessageFrame(data: string): Record<string, unknown> | null {
  return parseJsonSafely<Record<string, unknown>>(data);
}

function toToolJsonString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function getToolResultPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const tool = toStringValue(payload.tool);
  const input = payload.input;
  const result =
    payload.output ??
    payload.result ??
    payload.content ??
    payload.message ??
    payload.data ??
    payload.response ??
    payload.value;

  const serialized: Record<string, unknown> = {};
  if (tool) serialized.tool = tool;
  if (input !== undefined) serialized.input = input;
  if (result !== undefined) {
    serialized.output = result;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === "type" || key === "tool" || key === "input") continue;
    if (key === "result" && result !== undefined) continue;
    if (key === "output" && result !== undefined) continue;
    serialized[key] = value;
  }
  return serialized;
}

interface ParsedTextToolCall {
  tool: string;
  input: Record<string, unknown>;
}

const READONLY_TEXT_TOOL_FALLBACKS = new Set(["web_search", "web_fetch"]);

function cleanToolArgValue(value: string): string {
  return value
    .replace(/<\/?arg_value>/gi, "")
    .replace(/<\/?arg_name>/gi, "")
    .trim()
    .replace(/^["'`]|["'`]$/g, "");
}

function parseTextToolCallPayload(text: string): ParsedTextToolCall | null {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  const firstLineMatch = lines[0].match(/^<(?:[a-z0-9_.-]+:)?tool_call>\s*([a-zA-Z0-9_.:-]+)/i);
  if (!firstLineMatch?.[1]) {
    return null;
  }

  const tool = firstLineMatch[1].trim();
  if (!tool) {
    return null;
  }

  const input: Record<string, unknown> = {};
  let pendingArgName = "";

  for (const line of lines.slice(1)) {
    const argNameMatch = line.match(
      /^<arg_name>\s*([^<]+)\s*<\/arg_name>\s*$/i,
    );
    if (argNameMatch?.[1]) {
      pendingArgName = argNameMatch[1].trim();
      continue;
    }

    const argValueMatch = line.match(
      /^<arg_value>\s*([\s\S]*?)\s*<\/arg_value>\s*$/i,
    );
    if (argValueMatch) {
      const value = cleanToolArgValue(argValueMatch[1] ?? "");
      if (pendingArgName && value) {
        input[pendingArgName] = value;
      }
      pendingArgName = "";
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex > 0) {
      const key = cleanToolArgValue(line.slice(0, separatorIndex));
      const value = cleanToolArgValue(line.slice(separatorIndex + 1));
      if (key && value) {
        input[key] = value;
      }
      continue;
    }

    if (pendingArgName) {
      const value = cleanToolArgValue(line);
      if (value) {
        input[pendingArgName] = value;
      }
      pendingArgName = "";
      continue;
    }
  }

  if (Object.keys(input).length === 0) {
    const remainder = cleanToolArgValue(lines.slice(1).join(" "));
    if (remainder) {
      input.query = remainder;
    }
  }

  if (Object.keys(input).length === 0) {
    return null;
  }

  return { tool, input };
}

function looksLikeTextToolCallOnly(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return /^<(?:[a-z0-9_.-]+:)?tool_call\b/i.test(normalized)
    || /<(?:[a-z0-9_.-]+:)?tool_call\b/i.test(normalized);
}

function extractMcpToolCallText(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  const result = isRecord(payload.result) ? payload.result : null;
  if (!result) {
    return "";
  }

  const content = asArray<Record<string, unknown>>(result.content);
  const textLines = content
    .map((item) => toStringValue(item.text))
    .filter((line) => line.trim().length > 0);

  if (textLines.length > 0) {
    return textLines.join("\n").trim();
  }

  return toStringValue(result.text).trim();
}

async function runTextToolCallFallback(
  text: string,
): Promise<{
  text: string;
  tool: string;
  input: Record<string, unknown>;
} | null> {
  const parsed = parseTextToolCallPayload(text);
  if (!parsed) {
    return null;
  }

  if (!READONLY_TEXT_TOOL_FALLBACKS.has(parsed.tool)) {
    return null;
  }

  const requestBody = {
    jsonrpc: "2.0",
    id: `webot-${Date.now()}`,
    method: "tools/call",
    params: {
      name: parsed.tool,
      arguments: parsed.input,
    },
  };
  const paths = ["/mcp", "/api/mcp"];

  for (const path of paths) {
    try {
      const mcpResponse = await requestOpenFangJson<unknown>(path, {
        method: "POST",
        body: requestBody,
      });
      const toolText = extractMcpToolCallText(mcpResponse);
      if (!toolText) {
        continue;
      }
      return {
        text: toolText,
        tool: parsed.tool,
        input: parsed.input,
      };
    } catch {
      // try next path
    }
  }

  return null;
}

async function buildUiEnvironmentSystemPrompt(
  input: AgentChatInput,
): Promise<string> {
  const channel = toStringValue(input.channel, CHAT_CHANNELS.app);
  const renderMode = toStringValue(
    input.renderMode,
    CHAT_RENDER_MODES.jsonRender,
  );
  const normalizedAgentId = toStringValue(input.agentId).trim().toLowerCase();
  const normalizedAgentName = toStringValue(input.agentName)
    .trim()
    .toLowerCase();
  const isNuwaManagementAgent =
    normalizedAgentId === "nuwa" || normalizedAgentName === "女娲";
  const supportsSelfManagementAgent =
    !isNuwaManagementAgent && normalizedAgentId.length > 0;
  let components: string[] = [];
  try {
    const assignments = await getAgentSkillAssignments(input.agentId);
    const skillNames = Array.from(
      new Set(
        [
          ...(assignments.assigned ?? []),
          ...(assignments.custom_available ?? []),
        ]
          .filter((item): item is string =>
            typeof item === "string" && item.trim().length > 0,
          )
          .map((item) => item.trim()),
      ),
    ).sort();
    if (skillNames.length > 0) {
      components = await listAvailableSkillComponents(
        input.agentId,
        skillNames,
      );
    }
  } catch {
    components = [];
  }
  const skillContexts = await Promise.all(
    components.map((name) => loadSkillPromptContext(name, input.agentId)),
  );
  const manifestContexts = await Promise.all(
    components.map((name) => loadSkillComponentManifest(name, input.agentId)),
  );
  const componentInvokeContexts = await Promise.all(
    components.map((name, index) =>
      loadManagementComponentInvokeContext(
        resolveManifestInvokeComponentName(name, manifestContexts[index]),
      ),
    ),
  );
  manifestContexts.forEach((item, index) => {
    if (item?.propsSchema) {
      primeManifestSchemaCache(components[index], item.propsSchema);
    }
  });
  const injectedSkillContexts = skillContexts.filter(Boolean);
  const injectedManifestContexts = manifestContexts
    .map((item, index) => {
      if (!item) return "";
      return [
        `[component:${components[index]}]`,
        item.description ? `description: ${item.description}` : "",
        item.propsSchema
          ? `propsSchema: ${JSON.stringify(item.propsSchema)}`
          : "",
        item.example ? `example: ${JSON.stringify(item.example)}` : "",
        item.invokeExample
          ? `invokeExample: ${JSON.stringify(item.invokeExample)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean);
  const injectedComponentInvokeContexts = componentInvokeContexts.filter(Boolean);
  const collaborationHint = await buildCollaborationAgentHint(input.agentId);

  return [
    "[system:ui-environment]",
    `Current UI environment: channel=${channel}, renderMode=${renderMode}, A2UI rendering is available.`,
    "You are replying in chat mode for a json-render capable client, not a pure generation-only mode.",
    components.length > 0
      ? `Available custom dynamic components right now: ${components.join(", ")}.`
      : "No custom dynamic component is currently available.",
    "Use plain Markdown unless a valid UI block is required.",
    "Custom dynamic UI components are compatibility-only local render helpers; they are not the primary capability protocol.",
    "Prefer runtime tools and standardized `presentable_result` / `job_result`; only use UI_JSON when an explicit local interactive card is truly required.",
    "Standard media/document outputs are provided by runtime `presentable_result`; do not synthesize preview cards in UI_JSON.",
    "[system:video-tool-routing]",
    "For video creation, prefer runtime `video_generate` / `video_edit` and let the runtime own the placeholder -> job_result -> media_result(video) chain.",
    "When the user asks for the current agent itself to appear in the video, call `video_generate` with the prompt and `source_mode=\"self_default\"`; do not manually pass image/video source fields unless the user explicitly supplied a different source asset. The runtime will inject the current agent default portrait/video source automatically.",
    "When the user supplied a source image or wants image-to-video, call `video_generate` with `source_mode=\"image_to_video\"` and pass exactly one of `image_path`, `image_url`, or `image_base64` (`mime_type` is required for base64).",
    "When the user wants pure text-to-video, call `video_generate` with `source_mode=\"text_to_video\"` and do not pass any image/video source fields.",
    "Use `video_edit` only when transforming an existing source video or a source-image-conditioned edit flow; in that case pass the matching `video_*` or `image_*` source field.",
    "Only use `save_target=\"agent_profile_meta\"` for the current agent's own personal media; ordinary user-requested videos should stay on the default `output` path. `meta_label` is only needed for agent personal media labeling.",
    "[system:image-tool-routing]",
    "For image creation, distinguish three workflows clearly: text-only new image, single-image edit, and base-plus-reference merge.",
    "Use `image_generate` only for pure text-to-image requests where a brand-new picture is needed and identity continuity with an existing image is not required.",
    "Use `image_edit` with exactly one image when the user wants to modify that same image. The first image is always the base image that must remain the main subject.",
    "Use `image_edit` with a second `reference_image` / `reference_image_path` / `reference_image_url` / `reference_image_base64` only when the user wants to merge elements from another picture into the first picture. In that case, the first image stays the base, and the second image is only a reference/material source.",
    "Never let the second reference image replace the identity, framing, or ownership of the first base image unless the user explicitly asked for that replacement.",
    "For requests about the current agent itself, prefer `my_photo_generate` or `my_photo_edit` instead of the generic image tools.",
    "If the user wants the current agent to wear, hold, or adopt something from another image, keep the current agent default portrait/self photo as the identity anchor and pass the external picture only as `reference_image*`.",
    "When using UI_JSON, each block must contain exactly one complete valid JSON object and nothing else.",
    "Never output response envelopes, result JSON, tool_call XML, YAML, comments, explanations about the schema, or any wrapper object around the UI object.",
    "If you output UI_JSON, it must be directly parseable by JSON.parse without any preprocessing and must use ASCII punctuation.",
    "Never wrap the whole reply as response JSON.",
    "Never put <UI_JSON> inside a fenced code block.",
    "If valid JSON cannot be guaranteed, fall back to pure Markdown.",
    supportsSelfManagementAgent ? "[system:self-management-protocol]" : "",
    supportsSelfManagementAgent
      ? `selfAgentId=${input.agentId}`
      : "",
    supportsSelfManagementAgent
      ? "selfManagement.scope=self_only"
      : "",
    supportsSelfManagementAgent
      ? 'selfManagement.resultKinds=["review_result","confirm_result","patch_result"]'
      : "",
    supportsSelfManagementAgent
      ? "selfManagement.upgradeFlow=review_then_confirm_then_apply"
      : "",
    supportsSelfManagementAgent
      ? "identityWrites.requireConfirmCard=true"
      : "",
    supportsSelfManagementAgent
      ? 'managementConfirm.type=AgentManagementConfirmCard'
      : "",
    supportsSelfManagementAgent
      ? 'managementConfirm.actions=["confirm_agent_management","cancel_agent_management"]'
      : "",
    isNuwaManagementAgent ? "[system:nuwa-management-protocol]" : "",
    isNuwaManagementAgent
      ? 'managementConfirm.type=AgentManagementConfirmCard'
      : "",
    isNuwaManagementAgent
      ? 'managementConfirm.actions=["confirm_agent_management","cancel_agent_management"]'
      : "",
    isNuwaManagementAgent
      ? 'managementConfirm.mode=["create","update"]'
      : "",
    isNuwaManagementAgent
      ? 'managementConfirm.allowedFields=["mode","agentId","targetName","englishName","nickname","description","tags","workspaces","provider","model","avatarUrl","portraitUrl","color","rewriteContextFiles","contextFiles","items"]'
      : "",
    isNuwaManagementAgent
      ? 'managementConfirm.requiredContextFiles=["IDENTITY.md","SOUL.md","USER.md","MEMORY.md","TOOLS.md","AGENTS.md","BOOTSTRAP.md","HEARTBEAT.md","SYSTEM_PROMPT"]'
      : "",
    collaborationHint ? "[system:multi-agent-collaboration]" : "",
    collaborationHint,
    injectedManifestContexts.length > 0
      ? "[system:skill-component-manifests]"
      : "",
    ...injectedManifestContexts,
    injectedComponentInvokeContexts.length > 0
      ? "[system:component-invoke-params]"
      : "",
    ...injectedComponentInvokeContexts,
    injectedSkillContexts.length > 0
      ? "[system:skill-local-component-context]"
      : "",
    ...injectedSkillContexts,
  ]
    .filter(Boolean)
    .join("\n");
}

function shouldInjectUiRenderHint(input: AgentChatInput): boolean {
  const renderMode = toStringValue(input.renderMode).trim().toLowerCase();
  const channel = toStringValue(input.channel).trim().toLowerCase();

  if (
    renderMode === CHAT_RENDER_MODES.jsonRender ||
    renderMode === CHAT_RENDER_MODES.gui
  ) {
    return true;
  }
  if (
    renderMode === CHAT_RENDER_MODES.markdown ||
    renderMode === CHAT_RENDER_MODES.plainText
  ) {
    return false;
  }

  return (
    channel === CHAT_CHANNELS.app ||
    channel === CHAT_CHANNELS.gui ||
    channel === CHAT_CHANNELS.desktop ||
    channel === CHAT_CHANNELS.web
  );
}

async function buildOutgoingMessage(input: AgentChatInput): Promise<string> {
  const message = input.message;
  if (!shouldInjectUiRenderHint(input)) {
    return message;
  }
  if (message.includes("[system:ui-environment]")) {
    return message;
  }
  const systemPreamble =
    typeof input.systemPreamble === "string" ? input.systemPreamble.trim() : "";
  return [
    await buildUiEnvironmentSystemPrompt(input),
    systemPreamble,
    "[user]",
    message,
  ].join("\n\n");
}

export function withChatRenderContext(
  input: AgentChatInput,
  overrides?: Partial<Pick<AgentChatInput, "channel" | "renderMode">>,
): AgentChatInput {
  return {
    ...input,
    channel: overrides?.channel ?? input.channel ?? CHAT_CHANNELS.app,
    renderMode:
      overrides?.renderMode ?? input.renderMode ?? CHAT_RENDER_MODES.jsonRender,
  };
}

function emitChunk(chunk: AgentChatStreamChunk): void {
  for (const handler of streamSubscribers) {
    try {
      handler(chunk);
    } catch {
      // ignore subscriber errors
    }
  }
}

async function loadSkillPromptContext(
  componentName: string,
  agentId?: string,
): Promise<string> {
  const normalized = componentName.trim();
  if (!normalized) return "";
  const cacheKey = `${agentId || ""}::${normalized}`;
  const cached = skillPromptContextCache.get(cacheKey);
  if (cached != null) {
    return cached;
  }

  try {
    const invoke = resolveIpcInvoker();
    if (!invoke) return "";
    const payload = (await invoke.invoke("load_skill_prompt_context", {
      componentName: normalized,
      agentId: agentId ?? null,
    })) as { content?: unknown };
    const content =
      typeof payload?.content === "string" ? payload.content.trim() : "";
    skillPromptContextCache.set(cacheKey, content);
    return content;
  } catch {
    skillPromptContextCache.set(cacheKey, "");
    return "";
  }
}

async function listAvailableSkillComponents(
  agentId: string,
  skillNames: string[],
): Promise<string[]> {
  const normalizedSkills = skillNames
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
  const cacheKey = `${agentId}::${normalizedSkills.join("|")}`;
  const cached = availableSkillComponentsCache.get(cacheKey);
  if (cached) return cached;

  try {
    const invoke = resolveIpcInvoker();
    if (!invoke) return [];
    const payload = (await invoke.invoke("list_available_skill_components", {
      skillNames: normalizedSkills,
      agentId,
    })) as { components?: unknown };
    const components = Array.isArray(payload?.components)
      ? payload.components.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];
    availableSkillComponentsCache.set(cacheKey, components);
    return components;
  } catch {
    availableSkillComponentsCache.set(cacheKey, []);
    return [];
  }
}

async function loadSkillComponentManifest(
  componentName: string,
  agentId?: string,
): Promise<{
  description: string;
  propsSchema: unknown;
  example: unknown;
  invokeExample: unknown;
} | null> {
  const normalized = componentName.trim();
  if (!normalized) return null;
  const cacheKey = `${agentId || ""}::${normalized}`;
  const cached = skillComponentManifestCache.get(cacheKey);
  if (cached) return cached;

  try {
    const invoke = resolveIpcInvoker();
    if (!invoke) return null;
    const payload = (await invoke.invoke("load_skill_component_manifest", {
      componentName: normalized,
      agentId: agentId ?? null,
    })) as {
      description?: unknown;
      props_schema?: unknown;
      propsSchema?: unknown;
      example?: unknown;
      invoke_example?: unknown;
      invokeExample?: unknown;
    };
    const manifest = {
      description:
        typeof payload?.description === "string"
          ? payload.description.trim()
          : "",
      propsSchema: payload?.propsSchema ?? payload?.props_schema ?? null,
      example: payload?.example ?? null,
      invokeExample: payload?.invokeExample ?? payload?.invoke_example ?? null,
    };
    skillComponentManifestCache.set(cacheKey, manifest);
    return manifest;
  } catch {
    return null;
  }
}

function resolveManifestInvokeComponentName(
  componentType: string,
  manifest:
    | {
        invokeExample: unknown;
      }
    | null,
): string {
  if (
    manifest
    && isRecord(manifest.invokeExample)
    && isRecord(manifest.invokeExample.props)
  ) {
    const invokeName = toStringValue(
      manifest.invokeExample.props.componentName,
    ).trim();
    if (invokeName) {
      return invokeName;
    }
  }
  return componentType.trim();
}

async function loadManagementComponentInvokeContext(
  componentName: string,
): Promise<string> {
  const normalized = componentName.trim();
  if (!normalized) return "";
  const cached = managementComponentInvokeContextCache.get(normalized);
  if (cached != null) {
    return cached;
  }

  try {
    const payload = await requestJson<unknown>(
      `/api/management/components/${encodeURIComponent(normalized)}`,
    );
    const item = isRecord(payload) && isRecord(payload.item) ? payload.item : null;
    const workflow = item && isRecord(item.workflow) ? item.workflow : null;
    const returnType = toStringValue(item?.returnType).trim().toLowerCase();
    const capabilityBinding = item && isRecord(item.capabilityBinding) ? item.capabilityBinding : null;
    const selectorMeta = item && isRecord(item.selectorMeta) ? item.selectorMeta : null;
    const baseTool = toStringValue(capabilityBinding?.baseTool).trim();
    const capabilityKey = toStringValue(capabilityBinding?.capabilityKey).trim();
    const specialization = toStringValue(selectorMeta?.specialization).trim();
    const parameterMappings = Array.isArray(workflow?.parameterMappings)
      ? workflow.parameterMappings.filter(isRecord)
      : [];
    if (parameterMappings.length === 0) {
      managementComponentInvokeContextCache.set(normalized, "");
      return "";
    }
    const requiredParams = parameterMappings
      .filter((mapping) => Boolean(mapping.required))
      .map((mapping) => toStringValue(mapping.parameterName).trim())
      .filter(Boolean);
    const declaredParams = parameterMappings
      .map((mapping) => toStringValue(mapping.parameterName).trim())
      .filter(Boolean);
    const descriptiveParams = parameterMappings
      .filter((mapping) =>
        toStringValue(mapping.valueType).trim().toLowerCase() === "string"
        && isDescriptiveComponentMapping(mapping),
      )
      .map((mapping) => toStringValue(mapping.parameterName).trim())
      .filter(Boolean);
    const strictSourceParams = parameterMappings
      .filter((mapping) => isStrictSourceComponentMapping(mapping))
      .map((mapping) => toStringValue(mapping.parameterName).trim())
      .filter(Boolean);
    const capabilityLine = [
      returnType ? `returnType=${returnType}` : '',
      capabilityKey ? `capability=${capabilityKey}` : '',
      baseTool ? `baseTool=${baseTool}` : '',
      specialization ? `specialization=${specialization}` : '',
    ].filter(Boolean).join(', ');
    const lines = parameterMappings.map((mapping) =>
      JSON.stringify({
        parameterName: toStringValue(mapping.parameterName).trim(),
        fieldName: toStringValue(mapping.fieldName).trim(),
        valueType: toStringValue(mapping.valueType).trim(),
        required: Boolean(mapping.required),
        description: toStringValue(mapping.description).trim(),
        defaultValue: mapping.defaultValue ?? null,
      }),
    );
    const context = [
      `[component-invoke:${normalized}]`,
      capabilityLine ? `Component capability for ${normalized}: ${capabilityLine}.` : '',
      `componentName=${normalized}`,
      `declaredParams: ${JSON.stringify(declaredParams)}`,
      requiredParams.length > 0
        ? `requiredParams: ${JSON.stringify(requiredParams)}`
        : "requiredParams: []",
      strictSourceParams.length > 0
        ? `sourceParams: ${JSON.stringify(strictSourceParams)}`
        : "",
      descriptiveParams.length > 0
        ? `descriptiveParams: ${JSON.stringify(descriptiveParams)}`
        : "",
      ...lines,
    ].join("\n");
    managementComponentInvokeContextCache.set(normalized, context);
    return context;
  } catch {
    managementComponentInvokeContextCache.set(normalized, "");
    return "";
  }
}

function toRuntimeStatus(state: string): AgentRuntimeStatus["status"] {
  const normalized = state.trim().toLowerCase();
  if (normalized.includes("error") || normalized.includes("crash"))
    return "error";
  if (normalized.includes("start")) return "starting";
  if (
    normalized.includes("run") ||
    normalized.includes("online") ||
    normalized.includes("idle")
  )
    return "online";
  return "offline";
}

function emptyProfilePaths() {
  return {
    agentRoot: "",
    privateSkillsRoot: "",
    privateMcpRoot: "",
    privateMemoryRoot: "",
    privateDataRoot: "",
    privateLogsRoot: "",
    profilePath: "",
    runtimeConfigPath: "",
    systemPromptPath: "",
  };
}

function mapAgentToProfile(
  agent: OpenFangAgentSummary | OpenFangAgentDetail,
): AgentProfile {
  const createdAt = toStringValue(agent.created_at, new Date().toISOString());
  const provider =
    isRecord(agent) && isRecord(agent.model)
      ? toStringValue(
          agent.model.provider,
          toStringValue(agent.model_provider, "unknown"),
        )
      : toStringValue(agent.model_provider, "unknown");
  const model =
    isRecord(agent) && isRecord(agent.model)
      ? toStringValue(
          agent.model.model,
          toStringValue(agent.model_name, "unknown"),
        )
      : toStringValue(agent.model_name, "unknown");

  return {
    version: "1.0",
    agentId: toStringValue(agent.id),
    name: toStringValue(
      agent.nickname,
      toStringValue(
        agent.name,
        toStringValue(
          agent.english_name,
          toStringValue(agent.id, "鏈懡鍚嶆櫤鑳戒綋"),
        ),
      ),
    ),
    title: toStringValue(agent.profile),
    tags: Array.isArray(agent.tags)
      ? agent.tags.filter((item): item is string => typeof item === "string")
      : [],
    summary: toStringValue((agent as { description?: unknown }).description),
    soul: "",
    systemPrompt: "",
    defaultLlm: {
      providerId: provider,
      modelName: model,
    },
    skills: {
      privateSkills: [],
      sharedSkills: [],
    },
    mcp: {
      privateServers: [],
      sharedServers: [],
    },
    team: {
      members: [],
    },
    appearance: {
      avatarUrl: toStringValue(agent.identity?.avatar_url),
      color: toStringValue(agent.identity?.color),
    },
    paths: emptyProfilePaths(),
    createdAt,
    updatedAt: new Date().toISOString(),
  };
}

function mapOpenFangCronJobToAgentTask(job: OpenFangCronJob): AgentTask {
  const scheduleKindRaw = toStringValue(
    job.schedule?.kind,
    "cron",
  ).toLowerCase();
  const scheduleKind: AgentTask["scheduleKind"] =
    scheduleKindRaw === "every" || scheduleKindRaw === "at"
      ? scheduleKindRaw
      : "cron";

  const actionKind = toStringValue(job.action?.kind).toLowerCase();
  const jobType: AgentTask["jobType"] =
    actionKind === "system_event" ? "shell" : "agent";
  const prompt = toStringValue(
    job.action?.message,
    toStringValue(job.action?.text),
  );
  const command = actionKind === "system_event" ? prompt : undefined;
  const normalizedName = toStringValue(job.name, "Untitled Task").trim();
  const normalizedPrompt = prompt.toLowerCase();
  const isChatTaskName =
    /^\s*聊天任务[:：]/.test(normalizedName) ||
    /^\s*chat[-_ ]?task[-_:]/i.test(normalizedName);
  const chatPromptMarkers = [
    "你是任务执行助手",
    "禁止输出“是否创建任务",
    "禁止复述调度信息",
  ];
  const isChatTaskPrompt =
    chatPromptMarkers.filter((marker) => normalizedPrompt.includes(marker))
      .length >= 2;
  const sourceType: AgentTask["sourceType"] =
    isChatTaskName || isChatTaskPrompt ? "chat" : "custom";

  return {
    id: toStringValue(job.id),
    name: normalizedName || "Untitled Task",
    sourceType,
    scheduleKind,
    scheduleExpression:
      scheduleKind === "cron" ? toStringValue(job.schedule?.expr) : undefined,
    runAt: scheduleKind === "at" ? toStringValue(job.schedule?.at) : undefined,
    everyMs:
      scheduleKind === "every"
        ? Math.max(1, toNumberValue(job.schedule?.every_secs, 60)) * 1000
        : undefined,
    timezone: toStringValue(job.schedule?.tz),
    jobType,
    command,
    prompt: jobType === "agent" ? prompt : undefined,
    sessionTarget: "main",
    enabled: toBooleanValue(job.enabled, true),
    nextRun: toStringValue(job.next_run),
    lastRun: toStringValue(job.last_run),
    lastStatus: toStringValue(
      job.last_status,
      toStringValue(job.status, "idle"),
    ),
  };
}

function resolveIpcInvoker(): IpcInvoker | null {
  if (typeof window === "undefined") {
    return null;
  }

  const globalWindow = window as unknown as {
    webotIpc?: IpcInvoker;
    electron?: { ipcRenderer?: IpcInvoker };
  };

  if (globalWindow.webotIpc?.invoke) {
    return globalWindow.webotIpc;
  }

  if (globalWindow.electron?.ipcRenderer?.invoke) {
    return globalWindow.electron.ipcRenderer;
  }

  return null;
}

function resolveIpcEmitter(): IpcEmitter | null {
  if (typeof window === "undefined") {
    return null;
  }

  const globalWindow = window as unknown as {
    webotIpc?: IpcInvoker & IpcEmitter;
    electron?: { ipcRenderer?: IpcInvoker & IpcEmitter };
  };

  if (globalWindow.webotIpc?.on) {
    return globalWindow.webotIpc;
  }

  if (globalWindow.electron?.ipcRenderer?.on) {
    return globalWindow.electron.ipcRenderer;
  }

  return null;
}

async function invokeIpc<TResponse>(
  channel: string,
  payload?: unknown,
): Promise<TResponse> {
  const ipc = resolveIpcInvoker();
  if (!ipc) {
    throw new Error("IPC unavailable");
  }

  const result = (await ipc.invoke(channel, payload)) as
    | SettingsApiResult<TResponse>
    | TResponse;

  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok) {
      return result.data as TResponse;
    }
    throw new Error(result.error?.message ?? "鏈煡閿欒");
  }

  return result as TResponse;
}

export async function saveAgent(
  input: SaveAgentInput,
): Promise<SaveAgentResult> {
  return invokeIpc<SaveAgentResult>(AGENT_IPC_CHANNELS.saveAgent, input);
}

export async function getAgent(agentId: string): Promise<AgentProfile> {
  const data = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}`,
  );
  return mapAgentToProfile((data ?? {}) as OpenFangAgentDetail);
}

export async function listAgents(
  _input?: ListAgentsInput,
): Promise<readonly AgentProfile[]> {
  const data = await requestJson<unknown>("/api/management/agents");
  const rows = asArray<OpenFangAgentSummary>(data);
  return rows.map(mapAgentToProfile);
}

export async function startAgent(
  input: StartAgentInput,
): Promise<StartAgentResult> {
  await getAgent(input.agentId);
  return {
    success: true,
    message: "OpenFang unified runtime mode does not require separate startup.",
  };
}

export async function stopAgent(
  input: StopAgentInput,
): Promise<StopAgentResult> {
  try {
    await requestJson<unknown>(
      `/api/management/agents/${encodeURIComponent(input.agentId)}/stop`,
      {
        method: "POST",
        body: {},
      },
    );
    return { success: true, message: "Stop request sent." };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Stop failed",
    };
  }
}

export async function getAgentStatus(
  agentId: string,
): Promise<AgentRuntimeStatus> {
  const detail = await requestJson<unknown>(
    `/api/management/agents/${encodeURIComponent(agentId)}`,
  );
  const record = isRecord(detail) ? detail : {};
  const state = toStringValue(record.state, "offline");

  return {
    agentId,
    status: toRuntimeStatus(state),
    message: state,
  };
}

export async function getAgentLogTail(
  input: GetAgentLogTailInput,
): Promise<AgentLogTail> {
  try {
    return await invokeIpc<AgentLogTail>(
      AGENT_IPC_CHANNELS.agentLogTail,
      input,
    );
  } catch {
    return {
      agentId: input.agentId,
      content: "",
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function getAgentCollaborationEvents(
  input: GetAgentCollaborationEventsInput,
): Promise<readonly AgentCollaborationEvent[]> {
  try {
    return await invokeIpc<readonly AgentCollaborationEvent[]>(
      AGENT_IPC_CHANNELS.agentCollaborationEvents,
      input,
    );
  } catch {
    return [];
  }
}

async function sendAgentChatStreamOnce(
  input: AgentChatInput,
): Promise<AgentChatResult> {
  const requestId = input.requestId || createRequestId();
  const agentId = input.agentId;
  const controller = new AbortController();
  let outgoingMessage = await buildOutgoingMessage(input);
  const attachmentRefs = buildOutgoingAttachmentRefs(input.attachments);

  requestToAgentId.set(requestId, agentId);
  requestAbortControllers.set(requestId, controller);

  let fullText = "";
  let patchDeltaBuffer = "";
  let doneSpec: unknown;
  let donePayload: Record<string, unknown> | null = null;
  let appearanceUpdated: AgentAppearanceUpdated | undefined;
  let resolvedSessionId = "";
  let resolvedSessionLabel = "";
  let streamErrorMessage = "";
  let sawTerminalEvent = false;
  let sawPhaseDone = false;
  let sawTypingStop = false;
  let sawToolResultEvent = false;
  let sawAnyStreamEvent = false;
  let firstEventTimeoutTriggered = false;
  let idleTimeoutTriggered = false;
  let maxTimeoutTriggered = false;
  let activeToolName = "";
  let currentIdleTimeoutMs = STREAM_IDLE_TIMEOUT_MS;
  let completionAbortTimer: ReturnType<typeof setTimeout> | null = null;
  let firstEventAbortTimer: ReturnType<typeof setTimeout> | null = null;
  let idleAbortTimer: ReturnType<typeof setTimeout> | null = null;
  let maxAbortTimer: ReturnType<typeof setTimeout> | null = null;

  const clearCompletionAbortTimer = () => {
    if (completionAbortTimer != null) {
      clearTimeout(completionAbortTimer);
      completionAbortTimer = null;
    }
  };

  const ensureCompletionAbortTimer = () => {
    if (completionAbortTimer != null) {
      return;
    }
    completionAbortTimer = setTimeout(() => {
      if (!sawTerminalEvent && sawPhaseDone && sawTypingStop) {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }
    }, 2500);
  };

  const clearIdleAbortTimer = () => {
    if (idleAbortTimer != null) {
      clearTimeout(idleAbortTimer);
      idleAbortTimer = null;
    }
  };

  const clearFirstEventAbortTimer = () => {
    if (firstEventAbortTimer != null) {
      clearTimeout(firstEventAbortTimer);
      firstEventAbortTimer = null;
    }
  };

  const markFirstStreamEvent = () => {
    if (sawAnyStreamEvent) {
      return;
    }
    sawAnyStreamEvent = true;
    clearFirstEventAbortTimer();
  };

  const touchStreamActivity = () => {
    clearIdleAbortTimer();
    if (sawTerminalEvent) {
      return;
    }
    const idleWindowMs = currentIdleTimeoutMs;
    idleAbortTimer = setTimeout(() => {
      if (sawTerminalEvent) {
        return;
      }
      idleTimeoutTriggered = true;
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, idleWindowMs);
  };

  const extendIdleWindowForTool = (toolName?: string) => {
    const normalized = normalizeStreamToolName(toolName);
    activeToolName = normalized;
    currentIdleTimeoutMs = normalized
      ? isLikelyLongRunningImageTool(normalized)
        ? STREAM_IMAGE_TOOL_IDLE_TIMEOUT_MS
        : STREAM_TOOL_IDLE_TIMEOUT_MS
      : STREAM_TOOL_IDLE_TIMEOUT_MS;
    touchStreamActivity();
  };

  const restoreDefaultIdleWindow = () => {
    activeToolName = "";
    currentIdleTimeoutMs = STREAM_IDLE_TIMEOUT_MS;
    touchStreamActivity();
  };

  maxAbortTimer = setTimeout(() => {
    if (sawTerminalEvent) {
      return;
    }
    maxTimeoutTriggered = true;
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }, STREAM_MAX_TIMEOUT_MS);

  firstEventAbortTimer = setTimeout(() => {
    if (sawTerminalEvent || sawAnyStreamEvent) {
      return;
    }
    firstEventTimeoutTriggered = true;
  }, STREAM_FIRST_EVENT_TIMEOUT_MS);

  touchStreamActivity();

  try {
    if (import.meta.env.DEV) {
      console.debug("[Chat] outgoing message prepared", {
        agentId,
        outgoingMessage,
      });
    }

    const sessionId =
      typeof input.sessionId === "string" ? input.sessionId.trim() : "";
    const sessionLabel =
      typeof input.sessionLabel === "string" ? input.sessionLabel.trim() : "";
    const requestOrigin = input.requestOrigin;
    const currentTaskDraft = input.currentTaskDraft;
    let taskDraftMeta: ReturnType<typeof parseTaskDraftMetaFromPayload> = {};

    // 聊天统一走 service-rs SSE 代理，避免桌面端直连 OpenFang WS 时绕过
    // blocked_tools、聊天安全守卫与会话绑定逻辑。
    const forceServiceRsChatProxy = true;
    if (forceServiceRsChatProxy) {
      try {
        await requestSse(
          `/api/chat/${encodeURIComponent(agentId)}/message/stream`,
          (frame) => {
            if (sawTerminalEvent) {
              return;
            }
            markFirstStreamEvent();
            touchStreamActivity();

            const eventName = toStringValue(frame.event, "message")
              .trim()
              .toLowerCase();
            const parsedPayload = parseJsonSafely<unknown>(frame.data);
            const payload = isRecord(parsedPayload) ? parsedPayload : null;

            if (eventName === "chunk" || eventName === "message") {
              const textDelta = payload
                ? toStringValue(payload.content)
                : frame.data;
              if (textDelta) {
                fullText += textDelta;
                emitChunk({
                  requestId,
                  kind: "text",
                  value: textDelta,
                  meta: {
                    rawEvent: eventName,
                    rawPayload: frame.data,
                  },
                });
              }
              if (payload && payload.done === true) {
                sawTerminalEvent = true;
                clearCompletionAbortTimer();
                donePayload = payload;
              }
              return;
            }

            if (eventName === "spec_patch") {
              const patchText = payload
                ? toStringValue(payload.patch, toStringValue(payload.content))
                : frame.data;
              if (patchText) {
                emitChunk({
                  requestId,
                  kind: "patch",
                  value: patchText,
                  event: "spec_patch",
                  meta: {
                    rawEvent: eventName,
                    rawPayload: frame.data,
                  },
                });
              }
              return;
            }

            if (
              eventName === "phase" ||
              eventName === "typing" ||
              eventName === "tool_use" ||
              eventName === "tool_result" ||
              eventName === "delegate_call" ||
              eventName === "ipc_call" ||
              eventName === "runtime_log"
            ) {
              if (
                eventName === "phase" &&
                payload &&
                toStringValue(payload.phase).trim().toLowerCase() === "done"
              ) {
                sawPhaseDone = true;
                restoreDefaultIdleWindow();
              }
              if (
                eventName === "phase" &&
                payload &&
                toStringValue(payload.phase).trim().toLowerCase() === "tool_use"
              ) {
                extendIdleWindowForTool();
              }
              if (
                eventName === "typing" &&
                payload &&
                toStringValue(payload.state).trim().toLowerCase() === "stop"
              ) {
                sawTypingStop = true;
              }
              if (payload) {
                resolvedSessionId =
                  toStringValue(payload.session_id, resolvedSessionId).trim() ||
                  resolvedSessionId;
                resolvedSessionLabel =
                  toStringValue(
                    payload.session_label,
                    resolvedSessionLabel,
                  ).trim() || resolvedSessionLabel;
              }
              if (eventName === "tool_result") {
                sawToolResultEvent = true;
                restoreDefaultIdleWindow();
              }
              if (eventName === "tool_use") {
                extendIdleWindowForTool(
                  payload ? toStringValue(payload.tool) : "",
                );
              }
              emitChunk({
                requestId,
                kind: "log",
                value: frame.data,
                event: eventName,
                meta: {
                  rawEvent: eventName,
                  rawPayload: frame.data,
                },
              });
              if (!sawTerminalEvent && sawPhaseDone && sawTypingStop) {
                ensureCompletionAbortTimer();
              }
              return;
            }

            if (eventName === "appearance_updated") {
              appearanceUpdated =
                parseAgentAppearanceUpdated(payload) ?? appearanceUpdated;
              return;
            }

            if (eventName === "done") {
              sawTerminalEvent = true;
              clearCompletionAbortTimer();
              restoreDefaultIdleWindow();
              donePayload = payload ?? {};
              taskDraftMeta = parseTaskDraftMetaFromPayload(payload);
              if (payload) {
                resolvedSessionId =
                  toStringValue(payload.session_id, resolvedSessionId).trim() ||
                  resolvedSessionId;
                resolvedSessionLabel =
                  toStringValue(
                    payload.session_label,
                    resolvedSessionLabel,
                  ).trim() || resolvedSessionLabel;
              }
              const responseText = payload
                ? toStringValue(payload.content).trim()
                : "";
              if (responseText) {
                fullText = responseText;
              }
              doneSpec = parseSpecFromEventPayload(payload ?? {});
              if (!doneSpec) {
                doneSpec = parseSpecFromText(fullText);
              }
              return;
            }

            if (eventName === "error") {
              sawTerminalEvent = true;
              clearCompletionAbortTimer();
              restoreDefaultIdleWindow();
              streamErrorMessage = payload
                ? toStringValue(
                    payload.error,
                    toStringValue(
                      payload.message,
                      toStringValue(payload.content),
                    ),
                  )
                : frame.data;
              return;
            }

            emitChunk({
              requestId,
              kind: "log",
              value: frame.data,
              event: eventName || "message",
              meta: {
                rawEvent: eventName,
                rawPayload: frame.data,
              },
            });
          },
          {
            method: "POST",
              body: {
                message: outgoingMessage,
                attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
                session_id: sessionId || undefined,
                session_label: sessionLabel || undefined,
                request_origin: requestOrigin,
                current_task_draft: currentTaskDraft ?? undefined,
              },
              signal: controller.signal,
            },
        );
      } catch (sseError) {
        const abortedForCompletion =
          controller.signal.aborted &&
          sawPhaseDone &&
          sawTypingStop &&
          !sawTerminalEvent;
        const abortedByFirstEventTimeout =
          controller.signal.aborted &&
          firstEventTimeoutTriggered &&
          !sawTerminalEvent;
        const abortedByIdleTimeout =
          controller.signal.aborted &&
          idleTimeoutTriggered &&
          !sawTerminalEvent;
        const abortedByMaxTimeout =
          controller.signal.aborted &&
          maxTimeoutTriggered &&
          !sawTerminalEvent;
        if (
          !abortedForCompletion &&
          !abortedByFirstEventTimeout &&
          !abortedByIdleTimeout &&
          !abortedByMaxTimeout
        ) {
          throw sseError;
        }
      }

      if (!sawTerminalEvent && fullText.trim()) {
        donePayload = {
          type: "response_fallback",
          content: fullText,
          fallback: "sse_eof",
        };
      }
    } else {
      try {
        await requestWebSocket(
          `/api/agents/${encodeURIComponent(agentId)}/ws`,
          (frame) => {
            const payload = parseWsMessageFrame(frame.data);
            if (!payload) return false;
            markFirstStreamEvent();
            touchStreamActivity();

            const type = toStringValue(payload.type).trim().toLowerCase();
            if (!type || type === "connected" || type === "agents_updated") {
              return false;
            }

            if (type === "text_delta") {
              const textDelta = toStringValue(payload.content);
              if (!textDelta) return false;
              const trimmedDelta = textDelta.trimStart();
              const looksLikePatchStart =
                trimmedDelta.startsWith("{") ||
                patchDeltaBuffer.trimStart().startsWith("{");

              if (!looksLikePatchStart) {
                fullText += textDelta;
                emitChunk({
                  requestId,
                  kind: "text",
                  value: textDelta,
                  meta: {
                    rawEvent: type,
                    rawPayload: frame.data,
                  },
                });
                return false;
              }

              patchDeltaBuffer += textDelta;
              const extracted = extractLeadingSpecStreamPatch(patchDeltaBuffer);
              patchDeltaBuffer = extracted.remaining;

              if (extracted.patches.length > 0) {
                emitChunk({
                  requestId,
                  kind: "patch",
                  value: extracted.patches.join("\n"),
                  event: "spec_patch",
                  meta: {
                    rawEvent: type,
                    rawPayload: frame.data,
                  },
                });
              }

              return false;
            }

            if (type === "typing" || type === "phase") {
              if (
                type === "phase" &&
                toStringValue(payload.phase).trim().toLowerCase() === "done"
              ) {
                sawPhaseDone = true;
                restoreDefaultIdleWindow();
              }
              if (
                type === "phase" &&
                toStringValue(payload.phase).trim().toLowerCase() === "tool_use"
              ) {
                extendIdleWindowForTool();
              }
              if (
                type === "typing" &&
                toStringValue(payload.state).trim().toLowerCase() === "stop"
              ) {
                sawTypingStop = true;
              }
              emitChunk({
                requestId,
                kind: "log",
                value: frame.data,
                event: "phase",
                meta: {
                  rawEvent: type,
                  rawPayload: frame.data,
                },
              });
              if (!sawTerminalEvent && sawPhaseDone && sawTypingStop) {
                ensureCompletionAbortTimer();
              }
              return false;
            }

            if (type === "tool_start") {
              extendIdleWindowForTool(toStringValue(payload.tool));
              emitChunk({
                requestId,
                kind: "log",
                value: JSON.stringify({ tool: toStringValue(payload.tool) }),
                event: "tool_use",
                meta: {
                  rawEvent: type,
                  rawPayload: frame.data,
                },
              });
              return false;
            }

            if (type === "tool_end") {
              sawToolResultEvent = true;
              restoreDefaultIdleWindow();
              emitChunk({
                requestId,
                kind: "log",
                value: toToolJsonString(getToolResultPayload(payload)),
                event: "tool_result",
                meta: {
                  rawEvent: type,
                  rawPayload: frame.data,
                },
              });
              return false;
            }

            if (type === "tool_result") {
              sawToolResultEvent = true;
              restoreDefaultIdleWindow();
              emitChunk({
                requestId,
                kind: "log",
                value: frame.data,
                event: "tool_result",
                meta: {
                  rawEvent: type,
                  rawPayload: frame.data,
                },
              });
              return false;
            }

            if (type === "response") {
              sawTerminalEvent = true;
              clearCompletionAbortTimer();
              restoreDefaultIdleWindow();
              donePayload = payload;
              taskDraftMeta = parseTaskDraftMetaFromPayload(payload);
              const responseText = toStringValue(payload.content).trim();
              if (responseText) {
                fullText = responseText;
              }
              doneSpec = parseSpecFromEventPayload(payload);
              if (!doneSpec) {
                doneSpec = parseSpecFromText(fullText);
              }
              return true;
            }

            if (type === "silent_complete") {
              sawTerminalEvent = true;
              clearCompletionAbortTimer();
              restoreDefaultIdleWindow();
              donePayload = payload;
              return true;
            }

            if (type === "error") {
              sawTerminalEvent = true;
              clearCompletionAbortTimer();
              restoreDefaultIdleWindow();
              streamErrorMessage =
                toStringValue(payload.content) ||
                toStringValue(payload.message) ||
                "WebSocket 瀵硅瘽澶辫触";
              return true;
            }

            return false;
          },
          {
            type: "message",
            content: outgoingMessage,
            attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
          },
          { signal: controller.signal },
        );
      } catch (wsError) {
        const abortedForCompletion =
          controller.signal.aborted &&
          sawPhaseDone &&
          sawTypingStop &&
          !sawTerminalEvent;
        const abortedByFirstEventTimeout =
          controller.signal.aborted &&
          firstEventTimeoutTriggered &&
          !sawTerminalEvent;
        const abortedByIdleTimeout =
          controller.signal.aborted &&
          idleTimeoutTriggered &&
          !sawTerminalEvent;
        const abortedByMaxTimeout =
          controller.signal.aborted && maxTimeoutTriggered && !sawTerminalEvent;
        if (
          !abortedForCompletion &&
          !abortedByFirstEventTimeout &&
          !abortedByIdleTimeout &&
          !abortedByMaxTimeout
        ) {
          emitChunk({
            requestId,
            kind: "log",
            value:
              wsError instanceof Error
                ? wsError.message
                : "WebSocket 杩炴帴澶辫触",
            event: "phase",
          });

          const response = await requestJson<Record<string, unknown>>(
            `/api/chat/${encodeURIComponent(agentId)}/message`,
            {
              method: "POST",
              body: {
                message: outgoingMessage,
                attachments:
                  attachmentRefs.length > 0 ? attachmentRefs : undefined,
                current_task_draft: currentTaskDraft ?? undefined,
              },
              signal: controller.signal,
            },
          );

          fullText = toStringValue(
            response.response,
            toStringValue(response.content),
          );
          donePayload = response;
          taskDraftMeta = parseTaskDraftMetaFromPayload(response);
          doneSpec = parseSpecFromEventPayload(response);
        }
      }
    }

    if (!sawTerminalEvent && (idleTimeoutTriggered || maxTimeoutTriggered)) {
      if (!fullText.trim()) {
        fullText = idleTimeoutTriggered
          ? activeToolName
            ? `Tool "${activeToolName}" was still running with no new stream events for too long. Please retry.`
            : "Streaming request ended after a long idle period. Please retry."
          : "This task timed out after 60 minutes and was ended automatically.";
      }
      donePayload = {
        type: "response_fallback",
        content: fullText,
        fallback: idleTimeoutTriggered
          ? activeToolName
            ? `stream_idle_timeout:${activeToolName}`
            : "stream_idle_timeout"
          : "stream_max_timeout",
      };
    }

    if (!sawTerminalEvent && sawPhaseDone && sawTypingStop) {
      donePayload = {
        type: "response_fallback",
        content: fullText,
        fallback: "phase_typing_stop",
      };
    }

    if (streamErrorMessage) {
      return {
        success: false,
        content: fullText,
        error: streamErrorMessage,
      };
    }

    if (!doneSpec) {
      if (patchDeltaBuffer.trim()) {
        fullText += patchDeltaBuffer;
        patchDeltaBuffer = "";
      }
      doneSpec = parseSpecFromText(fullText);
    }

    if (!sawToolResultEvent && looksLikeTextToolCallOnly(fullText)) {
      const fallback = await runTextToolCallFallback(fullText);
      if (fallback) {
        emitChunk({
          requestId,
          kind: "log",
          value: JSON.stringify({
            tool: fallback.tool,
            input: fallback.input,
            source: "text_tool_call_fallback",
          }),
          event: "tool_use",
        });
        emitChunk({
          requestId,
          kind: "log",
          value: fallback.text,
          event: "tool_result",
        });
        fullText = fallback.text;
        donePayload = {
          ...(donePayload ?? {}),
          type: "response_tool_fallback",
          tool: fallback.tool,
          input: fallback.input,
          content: fullText,
        };
        if (!doneSpec) {
          doneSpec = parseSpecFromText(fullText);
        }
      } else {
        try {
          const retryResponse = await requestJson<Record<string, unknown>>(
            `/api/chat/${encodeURIComponent(agentId)}/message`,
            {
              method: "POST",
              body: {
                message: outgoingMessage,
                current_task_draft: currentTaskDraft ?? undefined,
              },
              signal: controller.signal,
            },
          );
          taskDraftMeta = parseTaskDraftMetaFromPayload(retryResponse);
          const retryText = toStringValue(
            retryResponse.response,
            toStringValue(retryResponse.content),
          ).trim();
          if (retryText && !looksLikeTextToolCallOnly(retryText)) {
            fullText = retryText;
            donePayload = {
              ...(donePayload ?? {}),
              type: "response_retry_fallback",
              content: fullText,
            };
            if (!doneSpec) {
              doneSpec = parseSpecFromText(fullText);
            }
          }
        } catch {
          // ignore retry fallback error
        }
      }
    }

    if (!donePayload && fullText.trim()) {
      donePayload = {
        type: "response_fallback",
        content: fullText,
        fallback: "text_only",
      };
    }

    appearanceUpdated =
      appearanceUpdated ??
      parseAgentAppearanceUpdatedFromPayload(donePayload);

    resolvedSessionId =
      toStringValue(donePayload?.session_id, resolvedSessionId).trim() ||
      resolvedSessionId;
    resolvedSessionLabel =
      toStringValue(
        donePayload?.session_label,
        resolvedSessionLabel,
      ).trim() || resolvedSessionLabel;

    emitChunk({
      requestId,
      kind: "done",
      text: fullText,
      spec: doneSpec,
      event: "done",
      meta: {
        rawEvent: "done",
        rawPayload: JSON.stringify(
          donePayload ?? { text: fullText, spec: doneSpec ?? null },
        ),
        ...taskDraftMeta,
        ...(appearanceUpdated ? { appearanceUpdated } : {}),
      },
    });

    return {
      success: true,
      content: fullText,
      text: fullText,
      uiRawText: extractUiRawText(fullText),
      spec: doneSpec,
      ...taskDraftMeta,
      appearanceUpdated,
      sessionId: resolvedSessionId || undefined,
      sessionLabel: resolvedSessionLabel || undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "娴佸紡瀵硅瘽澶辫触";
    return {
      success: false,
      content: fullText,
      error: message,
    };
  } finally {
    clearCompletionAbortTimer();
    clearFirstEventAbortTimer();
    clearIdleAbortTimer();
    if (maxAbortTimer != null) {
      clearTimeout(maxAbortTimer);
      maxAbortTimer = null;
    }
    requestAbortControllers.delete(requestId);
    requestToAgentId.delete(requestId);
  }
}

async function sendAgentChatStream(
  input: AgentChatInput,
): Promise<AgentChatResult> {
  const firstResult = await sendAgentChatStreamOnce(input);
  const recoveryReason = resolveChatRecoveryReason(firstResult);
  if (!recoveryReason) {
    return firstResult;
  }
  if (
    recoveryReason === "context_overflow" ||
    recoveryReason === "quota_exceeded"
  ) {
    return {
      ...firstResult,
      recoveryReason,
    };
  }

  const requestId = input.requestId || createRequestId();
  emitChunk({
    requestId,
    kind: "log",
    value: JSON.stringify({
      phase: "recovering_session",
      recovery_reason: recoveryReason,
      reason:
        firstResult.error || firstResult.content || "streaming_message_failed",
    }),
    event: "phase",
  });

  try {
    const { recoveredInput, recoveredSessionLabel } =
      await recoverAgentChatSession(
        {
          ...input,
          requestId,
        },
        recoveryReason,
      );
    const retried = await sendAgentChatStreamOnce(recoveredInput);
    return {
      ...retried,
      recoveredSessionLabel,
      recoveryReason,
    };
  } catch (error) {
    return {
      success: false,
      content: "",
      error: error instanceof Error ? error.message : "会话恢复失败",
    };
  }
}

export async function sendAgentChat(
  input: AgentChatInput,
): Promise<AgentChatResult> {
  if (input.stream) {
    const requestId = input.requestId || createRequestId();
    const streamInput: AgentChatInput = {
      ...input,
      requestId,
      stream: true,
    };
    // 缁熶竴浣跨敤 management 鍚庣娴佸紡閾捐矾銆?
    return sendAgentChatStream(streamInput);
  }

  const requestId = input.requestId || createRequestId();
  const controller = new AbortController();
  requestToAgentId.set(requestId, input.agentId);
  requestAbortControllers.set(requestId, controller);

  try {
    const outgoingMessage = input.message;
    const attachmentRefs = buildOutgoingAttachmentRefs(input.attachments);
    if (import.meta.env.DEV) {
      console.debug("[Chat] non-stream outgoing message prepared", {
        agentId: input.agentId,
        outgoingMessage,
      });
    }
    const sendOnce = async (
      requestInput: AgentChatInput,
    ): Promise<AgentChatResult> => {
      const nextSessionId =
        typeof requestInput.sessionId === "string"
          ? requestInput.sessionId.trim()
          : "";
      const nextSessionLabel =
        typeof requestInput.sessionLabel === "string"
          ? requestInput.sessionLabel.trim()
          : "";
      const requestOrigin = requestInput.requestOrigin;
      const result = await requestJson<unknown>(
        `/api/chat/${encodeURIComponent(requestInput.agentId)}/message`,
        {
          method: "POST",
          body: {
            message: outgoingMessage,
            attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
            session_id: nextSessionId || undefined,
            session_label: nextSessionLabel || undefined,
            request_origin: requestOrigin,
            current_task_draft: requestInput.currentTaskDraft ?? undefined,
          },
          signal: controller.signal,
        },
      );
      const body = isRecord(result) ? result : {};
      const content = toStringValue(body.response, toStringValue(body.content));
      const taskDraftMeta = parseTaskDraftMetaFromPayload(body);
      return {
        success: true,
        content,
        text: content,
        ...taskDraftMeta,
        sessionId: toStringValue(body.session_id) || undefined,
        sessionLabel: toStringValue(body.session_label) || undefined,
        recoveredRemoteSessionId: toStringValue(body.session_id) || undefined,
      };
    };

    try {
      return await sendOnce(input);
    } catch (error) {
      const aborted =
        error instanceof DOMException && error.name === "AbortError";
      if (aborted) {
        return {
          success: false,
          content: "",
          error: "请求已取消",
        };
      }

      const message = error instanceof Error ? error.message : "瀵硅瘽澶辫触";
      const failed: AgentChatResult = {
        success: false,
        content: "",
        error: message,
      };
      const recoveryReason = resolveChatRecoveryReason(failed);
      if (!recoveryReason) {
        return failed;
      }
      if (
        recoveryReason === "context_overflow" ||
        recoveryReason === "quota_exceeded"
      ) {
        return {
          ...failed,
          recoveryReason,
        };
      }

      let recoveredSessionLabel = "";
      try {
        const recovered = await recoverAgentChatSession(
          {
            ...input,
            requestId,
          },
          recoveryReason,
        );
        recoveredSessionLabel = recovered.recoveredSessionLabel;
        const retried = await sendOnce(recovered.recoveredInput);
        return {
          ...retried,
          recoveredSessionLabel,
          recoveryReason,
        };
      } catch (recoverError) {
        return {
          success: false,
          content: "",
          error: recoverError instanceof Error ? recoverError.message : message,
          recoveredSessionLabel: recoveredSessionLabel || undefined,
        };
      }
    }
  } catch (error) {
    const aborted =
      error instanceof DOMException && error.name === "AbortError";
    return {
      success: false,
      content: "",
      error: aborted
        ? "请求已取消"
        : error instanceof Error
          ? error.message
          : "瀵硅瘽澶辫触",
    };
  } finally {
    requestAbortControllers.delete(requestId);
    requestToAgentId.delete(requestId);
  }
}

export async function cancelAgentChat(
  input: CancelAgentChatInput,
): Promise<CancelAgentChatResult> {
  const requestId = input.requestId;
  const controller = requestAbortControllers.get(requestId);
  if (controller) {
    controller.abort();
  }

  const agentId = requestToAgentId.get(requestId);
  requestAbortControllers.delete(requestId);
  requestToAgentId.delete(requestId);

  if (!agentId) {
    return {
      success: true,
      message: "Request cancelled.",
    };
  }

  try {
    await requestJson<unknown>(
      `/api/management/agents/${encodeURIComponent(agentId)}/stop`,
      {
        method: "POST",
        body: {},
      },
    );
    return {
      success: true,
      message: "Current run stopped.",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "鍙栨秷澶辫触",
    };
  }
}

function normalizeSessionRole(value: unknown): string {
  const raw = toStringValue(value, "").trim().toLowerCase();
  if (raw === "user") return "user";
  if (raw === "assistant") return "assistant";
  if (raw === "system") return "system";
  return raw || "unknown";
}

export async function getAgentSession(
  agentId: string,
): Promise<AgentSessionResult> {
  try {
    const data = await requestJson<unknown>(
      `/api/chat/${encodeURIComponent(agentId)}/session`,
    );
    if (!isRecord(data)) {
      return {
        success: true,
        messages: [],
      };
    }
    const rows = asArray<Record<string, unknown>>(data.messages);
    const messages: AgentSessionMessage[] = rows
      .map((row) => ({
        role: normalizeSessionRole(row.role),
        content: toStringValue(row.content).trim(),
      }))
      .filter((row) => row.content.length > 0);

    return {
      success: true,
      sessionId: toStringValue(data.session_id),
      messages,
    };
  } catch (error) {
    return {
      success: false,
      messages: [],
      message: error instanceof Error ? error.message : "会话读取失败",
    };
  }
}

export async function deleteAgentSession(
  input: DeleteAgentSessionInput,
): Promise<DeleteAgentSessionResult> {
  const agentId = input.agentId.trim();
  const sessionId = input.sessionId?.trim() || "";
  const sessionLabel = input.sessionLabel?.trim() || "";
  if (!agentId) {
    return {
      success: false,
      deleted: false,
      message: "agentId 不能为空",
    };
  }
  if (!sessionId && !sessionLabel) {
    return {
      success: false,
      deleted: false,
      message: "sessionId 或 sessionLabel 至少需要一个",
    };
  }

  const query = new URLSearchParams();
  if (sessionId) {
    query.set("session_id", sessionId);
  }
  if (sessionLabel) {
    query.set("session_label", sessionLabel);
  }

  try {
    const data = await requestJson<Record<string, unknown>>(
      `/api/chat/${encodeURIComponent(agentId)}/session?${query.toString()}`,
      { method: "DELETE" },
    );
    return {
      success: true,
      deleted: data.deleted !== false,
      sessionId:
        typeof data.session_id === "string"
          ? data.session_id
          : sessionId || undefined,
    };
  } catch (error) {
    return {
      success: false,
      deleted: false,
      sessionId: sessionId || undefined,
      message: error instanceof Error ? error.message : "会话删除失败",
    };
  }
}

export async function compactAgentSession(
  input: CompactAgentSessionInput,
): Promise<CompactAgentSessionResult> {
  const agentId = input.agentId.trim();
  if (!agentId) {
    return {
      success: false,
      message: "agentId 不能为空",
    };
  }
  try {
    const payload = await requestJson<unknown>(
      `/api/chat/${encodeURIComponent(agentId)}/session/compact`,
      {
        method: "POST",
        body: {
          session_id:
            typeof input.sessionId === "string"
              ? input.sessionId.trim() || undefined
              : undefined,
          session_label:
            typeof input.sessionLabel === "string"
              ? input.sessionLabel.trim() || undefined
              : undefined,
        },
      },
    );
    const data = isRecord(payload) ? payload : {};
    const result = isRecord(data.result) ? data.result : {};
    return {
      success: true,
      sessionId: toStringValue(data.session_id),
      message: toStringValue(
        result.message,
        toStringValue(data.message, "会话已压缩"),
      ),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "会话压缩失败",
    };
  }
}

export async function updateAgentSessionContent(
  input: UpdateAgentSessionContentInput,
): Promise<UpdateAgentSessionContentResult> {
  const agentId = input.agentId.trim();
  if (!agentId) {
    return {
      success: false,
      message: "agentId 不能为空",
    };
  }

  try {
    const payload = await requestJson<unknown>(
      `/api/chat/${encodeURIComponent(agentId)}/session/content`,
      {
        method: "PUT",
        body: {
          session_id:
            typeof input.sessionId === "string"
              ? input.sessionId.trim() || undefined
              : undefined,
          session_label:
            typeof input.sessionLabel === "string"
              ? input.sessionLabel.trim() || undefined
              : undefined,
          messages: input.messages.map((item) => ({
            role: item.role,
            content: item.content,
          })),
        },
      },
    );
    const data = isRecord(payload) ? payload : {};
    const result = isRecord(data.result) ? data.result : {};
    return {
      success: true,
      sessionId: toStringValue(data.session_id),
      message: toStringValue(result.status, "会话上下文已更新"),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "会话上下文更新失败",
    };
  }
}

export async function listAgentTasks(
  input: AgentTaskListInput,
): Promise<AgentTaskListResult> {
  try {
    const query = `?agent_id=${encodeURIComponent(input.agentId)}`;
    const data = await requestJson<unknown>(
      `/api/management/cron/jobs${query}`,
    );
    const jobs = isRecord(data) ? asArray<OpenFangCronJob>(data.jobs) : [];
    return {
      success: true,
      tasks: jobs.map((job) => mapOpenFangCronJobToAgentTask(job)),
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "浠诲姟鍒楄〃鑾峰彇澶辫触",
      tasks: [],
    };
  }
}

function buildCreateCronPayload(
  input: AgentTaskCreateInput,
): Record<string, unknown> {
  const timeoutSecs = (() => {
    if (
      typeof input.timeoutSecs !== "number" ||
      !Number.isFinite(input.timeoutSecs)
    ) {
      return 180;
    }
    return Math.max(60, Math.min(1800, Math.round(input.timeoutSecs)));
  })();

  const normalizeCronExpr = (raw?: string): string => {
    const trimmed = toStringValue(raw)
      .trim()
      .replace(/^[`'"]+|[`'"]+$/g, "")
      .trim();
    if (!trimmed) {
      return "";
    }
    const compact = trimmed.replace(/\s+/g, " ");
    const fields = compact.split(" ");
    if (fields.length === 6) {
      return fields.slice(1).join(" ");
    }
    return compact;
  };

  const cronExpr = normalizeCronExpr(input.scheduleExpression || "* * * * *");
  if (input.scheduleKind === "cron" && cronExpr.split(" ").length !== 5) {
    throw new Error(
      "CRON 表达式必须是 5 段：minute hour day-of-month month day-of-week",
    );
  }

  const schedule =
    input.scheduleKind === "at"
      ? {
          kind: "at",
          at: input.runAt || new Date(Date.now() + 60_000).toISOString(),
        }
      : input.scheduleKind === "every"
        ? {
            kind: "every",
            every_secs: Math.max(
              60,
              Math.round((input.everyMs ?? 60_000) / 1000),
            ),
          }
        : {
            kind: "cron",
            expr: cronExpr || "* * * * *",
            tz: input.timezone || null,
          };

  const action =
    input.jobType === "shell"
      ? {
          kind: "system_event",
          text: input.command || input.prompt || input.name || "scheduled task",
        }
      : {
          kind: "agent_turn",
          message:
            input.prompt || input.command || input.name || "scheduled task",
          model_override: input.model || null,
          timeout_secs: timeoutSecs,
        };

  const delivery =
    input.deliveryMode === "announce"
      ? (() => {
          const channel = toStringValue(input.deliveryChannel, "system").trim();
          const fallbackTarget = channel === "system" ? "system" : "";
          const target = toStringValue(
            input.deliveryTarget,
            fallbackTarget,
          ).trim();
          if (channel && target) {
            return {
              kind: "channel",
              channel,
              to: target,
            };
          }
          return { kind: "last_channel" };
        })()
      : { kind: "none" };

  const payload: Record<string, unknown> = {
    agent_id: input.agentId,
    name: input.name || "Untitled Task",
    schedule,
    action,
    delivery,
    one_shot: input.scheduleKind === "at",
  };
  if (typeof input.enabled === "boolean") {
    payload.enabled = input.enabled;
  }
  return payload;
}

function extractCreatedJobId(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  const result = data.result;
  if (typeof result !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    return toStringValue(parsed.job_id) || undefined;
  } catch {
    return undefined;
  }
}

export async function createAgentTask(
  input: AgentTaskCreateInput,
): Promise<AgentTaskCreateResult> {
  try {
    const payload = buildCreateCronPayload(input);
    const created = await requestJson<unknown>("/api/management/cron/jobs", {
      method: "POST",
      body: payload,
    });

    const jobId = extractCreatedJobId(created);
    const listed = await listAgentTasks({ agentId: input.agentId });
    const task = jobId
      ? listed.tasks.find((item) => item.id === jobId)
      : listed.tasks[0];

    return {
      success: true,
      message: "Task created",
      task,
      raw: isRecord(created) ? JSON.stringify(created) : undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "浠诲姟鍒涘缓澶辫触",
    };
  }
}

export async function deleteAgentTask(
  input: AgentTaskDeleteInput,
): Promise<AgentTaskDeleteResult> {
  try {
    await requestJson<unknown>(
      `/api/management/cron/jobs/${encodeURIComponent(input.taskId)}`,
      {
        method: "DELETE",
      },
    );
    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "浠诲姟鍒犻櫎澶辫触",
    };
  }
}

export async function getAgentTaskProgress(
  input: AgentTaskProgressInput,
): Promise<AgentTaskProgressResult> {
  try {
    const status = await requestJson<unknown>(
      `/api/management/cron/jobs/${encodeURIComponent(input.taskId)}/status`,
    );
    const listed = await listAgentTasks({ agentId: input.agentId });
    const task = listed.tasks.find((item) => item.id === input.taskId);

    const logs: AgentTaskLogItem[] = [];
    let runCountHint: number | undefined;
    const readRunCountHint = (
      obj: Record<string, unknown>,
    ): number | undefined => {
      const directKeys = [
        "run_count",
        "runCount",
        "total_runs",
        "totalRuns",
        "executed",
        "executed_count",
        "count",
      ];
      for (const key of directKeys) {
        const value = obj[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          return Math.floor(value);
        }
      }
      const nestedKeys = ["summary", "stats", "meta"];
      for (const key of nestedKeys) {
        const value = obj[key];
        if (!isRecord(value)) continue;
        const nested = readRunCountHint(value);
        if (typeof nested === "number") return nested;
      }
      return undefined;
    };
    const pushLog = (row: AgentTaskLogItem) => {
      if (!row.message.trim()) return;
      if (logs.some((item) => item.eventId === row.eventId)) return;
      logs.push(row);
    };

    if (isRecord(status)) {
      runCountHint = readRunCountHint(status);
      const candidates = [
        status.logs,
        status.history,
        status.runs,
        status.items,
      ];

      for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        for (let index = 0; index < candidate.length; index += 1) {
          const item = candidate[index];
          if (!isRecord(item)) continue;
          const createdAt =
            toStringValue(item.created_at) ||
            toStringValue(item.started_at) ||
            toStringValue(item.timestamp) ||
            toStringValue(item.time) ||
            new Date().toISOString();
          const kind =
            toStringValue(item.kind) ||
            toStringValue(item.status) ||
            toStringValue(item.result) ||
            "status";
          const message =
            toStringValue(item.message) ||
            toStringValue(item.output) ||
            toStringValue(item.last_output) ||
            toStringValue(item.text) ||
            kind;
          const eventId =
            toStringValue(item.event_id) ||
            toStringValue(item.id) ||
            `${input.taskId}-${createdAt}-${index}`;
          pushLog({
            eventId,
            createdAt,
            kind,
            message,
          });
        }
      }

      if (logs.length === 0) {
        const fallbackStatus =
          toStringValue(status.last_status) ||
          toStringValue(status.status) ||
          toStringValue(status.state);
        const fallbackOutput =
          toStringValue(status.last_output) ||
          toStringValue(status.output) ||
          toStringValue(status.message);
        if (fallbackStatus || fallbackOutput) {
          const fallbackCreatedAt =
            toStringValue(status.last_run) ||
            (isRecord(status.job) ? toStringValue(status.job.last_run) : "") ||
            toStringValue(status.updated_at) ||
            new Date().toISOString();
          pushLog({
            eventId:
              toStringValue(status.last_event_id) ||
              toStringValue(status.event_id) ||
              `${input.taskId}-${fallbackCreatedAt}`,
            createdAt: fallbackCreatedAt,
            kind: fallbackStatus || "status",
            message: fallbackOutput || fallbackStatus || "status",
          });
        }
      }
    }

    logs.sort((a, b) => {
      const ta = Date.parse(a.createdAt);
      const tb = Date.parse(b.createdAt);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

    return {
      success: true,
      task,
      runCountHint:
        typeof runCountHint === "number" && runCountHint > 0
          ? runCountHint
          : undefined,
      logs,
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "浠诲姟杩涘害鏌ヨ澶辫触",
      logs: [],
    };
  }
}

export async function listAgentNotifications(
  _input: AgentNotificationListInput,
): Promise<AgentNotificationListResult> {
  return {
    success: true,
    notifications: [],
  };
}

export async function markAgentNotificationsRead(
  _input: AgentNotificationMarkReadInput,
): Promise<AgentNotificationMarkReadResult> {
  return {
    success: true,
    updatedCount: 0,
  };
}

export function subscribeAgentChatStream(
  handler: (chunk: AgentChatStreamChunk) => void,
): () => void {
  streamSubscribers.add(handler);

  const emitter = resolveIpcEmitter();
  const listener = (payload: unknown) =>
    handler(payload as AgentChatStreamChunk);
  const unsubscribe = emitter?.on?.(
    AGENT_IPC_CHANNELS.agentChatStream,
    listener,
  );

  return () => {
    streamSubscribers.delete(handler);
    if (typeof unsubscribe === "function") {
      unsubscribe();
      return;
    }
    emitter?.off?.(AGENT_IPC_CHANNELS.agentChatStream, listener);
  };
}
