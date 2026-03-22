import { compileSpecStream } from '@json-render/core';
import type { MessageTrace, Message } from '@/data/mock-chats';
import type { Agent } from '@/types';
import type { AgentChatMessage, AgentChatStreamChunk } from '@/main/types';
import type { ManagementAgentDetail, ManagementAgentSummary } from '@/services/management-client';
import { isHiddenSystemPromptText } from '@/lib/chat-message-filter';

const HIDDEN_COLLAB_TAGS = new Set(['webot:collab_discoverable', 'webot:collab_dispatcher']);

function filterCollaborationTags(tags: string[]): string[] {
  return tags.filter((tag) => !HIDDEN_COLLAB_TAGS.has(tag.trim().toLowerCase()));
}

export interface ParsedTrace {
  target: 'thinking' | 'tool';
  title: string;
  detail?: string;
}

export interface AgentSelfAppearanceActionPayload {
  avatarUrl?: string;
  portraitUrl?: string;
  reason?: string;
}

const NON_UI_TYPES = new Set([
  'tool_result',
  'tool_use',
  'phase',
  'typing',
  'done',
  'response',
  'response_fallback',
  'response_tool_fallback',
  'response_retry_fallback',
  'error',
]);

const COMPONENT_TYPE_ALIASES: Record<string, string> = {
  container: 'div',
  text: 'Text',
  option: 'OptionSelector',
  optionselector: 'OptionSelector',
  option_selector: 'OptionSelector',
  'option.selector': 'OptionSelector',
  imagecover: 'ImageCover',
  imagealbum: 'ImageAlbum',
  imagecarousel: 'ImageCarousel',
  video: 'VideoCover',
  videocover: 'VideoCover',
  videogallery: 'VideoGallery',
  videocarousel: 'VideoCarousel',
  webviewcard: 'WebViewCard',
  audioplayer: 'AudioPlayer',
  audioplaylist: 'AudioPlaylist',
  markdownpreviewcard: 'MarkdownPreviewCard',
  officepreviewcard: 'OfficePreviewCard',
  chart: 'ChartCard',
  chartcard: 'ChartCard',
  piechart: 'PieChartCard',
  piechartcard: 'PieChartCard',
  barchart: 'BarChartCard',
  barchartcard: 'BarChartCard',
  linechart: 'LineChartCard',
  linechartcard: 'LineChartCard',
  areachart: 'AreaChartCard',
  areachartcard: 'AreaChartCard',
  radarchart: 'RadarChartCard',
  radarchartcard: 'RadarChartCard',
  profileintrocard: 'ProfileIntroCard',
  profilecard: 'ProfileIntroCard',
  profile_intro_card: 'ProfileIntroCard',
  profile_intro: 'ProfileIntroCard',
};

const RESPONSE_WRAPPER_TYPES = new Set(['response', 'done', 'response_fallback', 'response_tool_fallback', 'response_retry_fallback']);
const UI_JSON_OPEN_TAG_PATTERN = /<ui[-_]json>/i;
const UI_JSON_BLOCK_PATTERN = /<ui[-_]json>\s*([\s\S]*?)\s*<\/ui[-_]json>/gi;

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function containsUiJsonTag(raw: string): boolean {
  return UI_JSON_OPEN_TAG_PATTERN.test(raw);
}

function normalizeAppearanceActionType(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.-]+/g, '');
}

export function isAgentSelfAppearanceActionType(value: unknown): boolean {
  return typeof value === 'string' && normalizeAppearanceActionType(value) === 'agentselfappearanceaction';
}

export function normalizeAgentSelfAppearanceActionPayload(raw: unknown): AgentSelfAppearanceActionPayload | null {
  if (!isRecordValue(raw)) {
    return null;
  }
  const avatarUrl = typeof raw.avatarUrl === 'string'
    ? raw.avatarUrl.trim()
    : typeof raw.avatar_url === 'string'
      ? raw.avatar_url.trim()
      : '';
  const portraitUrl = typeof raw.portraitUrl === 'string'
    ? raw.portraitUrl.trim()
    : typeof raw.portrait_url === 'string'
      ? raw.portrait_url.trim()
      : '';
  const reason = typeof raw.reason === 'string'
    ? raw.reason.trim()
    : typeof raw.description === 'string'
      ? raw.description.trim()
      : '';
  if (!avatarUrl && !portraitUrl) {
    return null;
  }
  return {
    avatarUrl: avatarUrl || undefined,
    portraitUrl: portraitUrl || undefined,
    reason: reason || undefined,
  };
}

function unwrapResponseEnvelopeText(raw: string): string {
  let text = raw.trim();
  if (!text) return '';

  for (let i = 0; i < 3; i += 1) {
    const parsed = parseJsonSafely<unknown>(text);
    if (typeof parsed === 'string') {
      const next = parsed.trim();
      if (!next || next === text) break;
      text = next;
      continue;
    }
    if (!parsed || typeof parsed !== 'object') break;

    const obj = parsed as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : '';
    const hasResponseMeta = (
      RESPONSE_WRAPPER_TYPES.has(type)
      || Object.prototype.hasOwnProperty.call(obj, 'context_pressure')
      || Object.prototype.hasOwnProperty.call(obj, 'output_tokens')
      || Object.prototype.hasOwnProperty.call(obj, 'iterations')
      || Object.prototype.hasOwnProperty.call(obj, 'input_tokens')
    );
    if (!hasResponseMeta) {
      break;
    }

    const contentCandidate = (
      (typeof obj.content === 'string' && obj.content)
      || (typeof obj.text === 'string' && obj.text)
      || (typeof obj.response === 'string' && obj.response)
      || ''
    ).trim();
    if (!contentCandidate || contentCandidate === text) {
      break;
    }
    text = contentCandidate;
  }

  return text;
}

function normalizeCommonJsonPunctuation(value: string): string {
  return value
    .replace(/\uFEFF/g, '')
    .replace(/[\uFF1A\uFE55]/g, ':')
    .replace(/[\uFF0C\uFE50]/g, ',')
    .replace(/[\uFF1B\uFE54]/g, ';')
    .replace(/[\uFF08]/g, '(')
    .replace(/[\uFF09]/g, ')')
    .replace(/[\u3010]/g, '[')
    .replace(/[\u3011]/g, ']')
    .replace(/[\uFF5B]/g, '{')
    .replace(/[\uFF5D]/g, '}')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

function escapeBareQuotesInJsonStrings(value: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];

    if (!inString) {
      result += current;
      if (current === '"') {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      result += current;
      escaped = false;
      continue;
    }

    if (current === '\\') {
      result += current;
      escaped = true;
      continue;
    }

    if (current === '"') {
      let cursor = index + 1;
      while (cursor < value.length && /\s/.test(value[cursor])) {
        cursor += 1;
      }
      const next = value[cursor];
      if (next === ',' || next === '}' || next === ']' || next === ':' || next == null) {
        result += current;
        inString = false;
      } else {
        result += '\"';
      }
      continue;
    }

    result += current;
  }

  return result;
}

export function repairUiJsonString(raw: string): string {
  let repaired = normalizeCommonJsonPunctuation(raw.trim());
  repaired = repaired
    .replace(/(^|[\{,]\s*)'([^'\r\n]+?)'\s*:/g, '$1"$2":')
    .replace(/:\s*'([^'\r\n]*?)'(?=\s*[,}\]])/g, ': "$1"')
    .replace(/,\s*([}\]])/g, '$1');

  repaired = escapeBareQuotesInJsonStrings(repaired);
  return repaired;
}

export function parseJsonSafely<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    try {
      const normalized = normalizeCommonJsonPunctuation(value);
      if (normalized !== value) {
        return JSON.parse(normalized) as T;
      }
    } catch {
      // ignore
    }
    try {
      const repaired = repairUiJsonString(value);
      if (repaired !== value) {
        return JSON.parse(repaired) as T;
      }
    } catch {
      // ignore
    }
    return null;
  }
}

function canonicalizeComponentType(type: string): string {
  const raw = type.trim();
  if (!raw) return raw;
  const normalized = raw.toLowerCase().replace(/[\s_.-]+/g, '');
  return COMPONENT_TYPE_ALIASES[normalized] || raw;
}

function normalizeComponentTypeKey(type: string): string {
  return type.trim().toLowerCase().replace(/[\s_.-]+/g, '');
}

function readComponentOutputName(props: Record<string, unknown>): string {
  const candidates = [props.componentName, props.englishName, props.skillName];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function coerceBuiltinMediaComponentType(
  type: string,
  props: Record<string, unknown>,
): string {
  const componentName = readComponentOutputName(props);
  if (!componentName) {
    return type;
  }

  const normalizedType = normalizeComponentTypeKey(type);
  const imageLikeTypes = new Set([
    'image',
    'imagecover',
    'imagealbum',
    'imagecarousel',
    'componentimagecard',
    'comfyuiimagecard',
    'componentimage',
    'comfyuiimage',
  ]);
  const videoLikeTypes = new Set([
    'video',
    'videocover',
    'videogallery',
    'videocarousel',
    'componentvideocard',
    'comfyuivideocard',
    'componentvideo',
    'comfyuivideo',
  ]);

  if (imageLikeTypes.has(normalizedType)) {
    return 'ComfyUIImageCard';
  }
  if (videoLikeTypes.has(normalizedType)) {
    return 'ComfyUIVideoCard';
  }
  return type;
}

const PROFILE_INTRO_ALLOWED_PROPS = new Set([
  'name',
  'title',
  'subtitle',
  'summary',
  'avatar',
  'coverImage',
  'cover',
  'image',
  'tags',
  'highlights',
  'sections',
]);

const PROFILE_INTRO_PROP_ALIASES: Record<string, keyof Record<string, unknown>> = {
  description: 'summary',
  content: 'summary',
  desc: 'subtitle',
  avatarUrl: 'avatar',
  avatar_url: 'avatar',
  emoji: 'avatar',
  icon: 'avatar',
  cover: 'coverImage',
  image: 'coverImage',
  imageUrl: 'coverImage',
  image_url: 'coverImage',
  labels: 'tags',
  chips: 'tags',
  bullets: 'highlights',
  points: 'highlights',
  groups: 'sections',
  group: 'sections',
  panels: 'sections',
  panel: 'sections',
  list: 'sections',
  rows: 'sections',
};

const PROFILE_INTRO_SECTION_ALIASES: Record<string, string> = {
  heading: 'title',
  name: 'title',
  label: 'title',
  rows: 'items',
  list: 'items',
  entries: 'items',
  fields: 'items',
};

const PROFILE_INTRO_ITEM_ALIASES: Record<string, string> = {
  key: 'label',
  name: 'label',
  title: 'label',
  text: 'value',
  content: 'value',
  desc: 'value',
  description: 'value',
};

function withAliasKeys(input: Record<string, unknown>, aliases: Record<string, string>): Record<string, unknown> {
  const next = { ...input };
  for (const [from, to] of Object.entries(aliases)) {
    if (next[to] == null && next[from] != null) {
      next[to] = next[from];
    }
  }
  return next;
}

function sanitizeProfileIntroSections(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((section) => {
      const normalizedSection = withAliasKeys(section, PROFILE_INTRO_SECTION_ALIASES);
      const title = typeof normalizedSection.title === 'string' ? normalizedSection.title : '';
      const rawItems = Array.isArray(normalizedSection.items) ? normalizedSection.items : [];
      const items = rawItems
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
        .map((row) => {
          const normalizedRow = withAliasKeys(row, PROFILE_INTRO_ITEM_ALIASES);
          return {
            label: typeof normalizedRow.label === 'string' ? normalizedRow.label : '',
            value:
              typeof normalizedRow.value === 'string'
                ? normalizedRow.value
                : typeof normalizedRow.value === 'number' || typeof normalizedRow.value === 'boolean'
                  ? String(normalizedRow.value)
                  : '',
          };
        })
        .filter((row) => row.label || row.value);
      return { title, items };
    })
    .filter((section) => section.title || section.items.length > 0);
}

function patchProfileIntroFallbacks(props: Record<string, unknown>): Record<string, unknown> {
  const next = { ...props };

  const name = typeof next.name === 'string' ? next.name.trim() : '';
  const title = typeof next.title === 'string' ? next.title.trim() : '';
  const subtitle = typeof next.subtitle === 'string' ? next.subtitle.trim() : '';
  const summary = typeof next.summary === 'string' ? next.summary.trim() : '';
  const tags = Array.isArray(next.tags) ? next.tags.filter((item): item is string => typeof item === 'string') : [];
  const highlights = Array.isArray(next.highlights) ? next.highlights.filter((item): item is string => typeof item === 'string') : [];
  const sections = Array.isArray(next.sections) ? next.sections as Array<Record<string, unknown>> : [];

  if (!name) {
    if (title) next.name = title;
    else if (subtitle) next.name = subtitle;
    else next.name = '?????';
  }

  if (!next.title && subtitle) {
    next.title = subtitle;
  }

  if (!summary && highlights.length > 0) {
    next.summary = highlights.slice(0, 3).join('?');
  }

  if (sections.length === 0) {
    const fallbackItems: Array<{ label: string; value: string }> = [];
    if (title) fallbackItems.push({ label: '??', value: title });
    if (subtitle && subtitle !== title) fallbackItems.push({ label: '??', value: subtitle });
    if (tags.length > 0) fallbackItems.push({ label: '??', value: tags.join(' / ') });
    if (highlights.length > 0) fallbackItems.push({ label: '??', value: highlights.join('?') });
    if (summary) fallbackItems.push({ label: '??', value: summary });
    if (fallbackItems.length > 0) {
      next.sections = [{ title: '????', items: fallbackItems }];
    }
  }

  return next;
}

function sanitizeProfileIntroProps(props: Record<string, unknown>): Record<string, unknown> {
  const normalizedProps = withAliasKeys(props, PROFILE_INTRO_PROP_ALIASES);
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalizedProps)) {
    if (!PROFILE_INTRO_ALLOWED_PROPS.has(key)) {
      continue;
    }
    if (key === 'tags' || key === 'highlights') {
      next[key] = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string').slice(0, key === 'tags' ? 12 : 8)
        : [];
      continue;
    }
    if (key === 'sections') {
      next.sections = sanitizeProfileIntroSections(value);
      continue;
    }
    next[key] = value;
  }

  return patchProfileIntroFallbacks(next);
}

type LegacyComponentSanitizer = (props: Record<string, unknown>) => Record<string, unknown>;

const LEGACY_COMPONENT_SANITIZERS: Record<string, LegacyComponentSanitizer> = {
  ProfileIntroCard: sanitizeProfileIntroProps,
};

const MANIFEST_SCHEMA_CACHE = new Map<string, unknown>();

export function primeManifestSchemaCache(componentType: string, schema: unknown): void {
  const normalized = canonicalizeComponentType(componentType);
  if (!normalized) return;
  MANIFEST_SCHEMA_CACHE.set(normalized, schema);
}

export function getManifestSchemaFromCache(componentType: string): unknown {
  const normalized = canonicalizeComponentType(componentType);
  if (!normalized) return undefined;
  return MANIFEST_SCHEMA_CACHE.get(normalized);
}

function coerceSchemaString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function sanitizeByManifestSchema(props: Record<string, unknown>, schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return props;
  }

  const schemaObj = schema as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const [key, descriptor] of Object.entries(schemaObj)) {
    const raw = props[key];
    if (raw == null) continue;

    if (typeof descriptor === 'string') {
      if (descriptor.includes('string[]')) {
        next[key] = Array.isArray(raw)
          ? raw.map((item) => coerceSchemaString(item)).filter(Boolean)
          : [];
        continue;
      }
      if (descriptor.includes('string')) {
        next[key] = coerceSchemaString(raw);
        continue;
      }
      next[key] = raw;
      continue;
    }

    if (Array.isArray(descriptor)) {
      const first = descriptor[0];
      if (!Array.isArray(raw)) {
        next[key] = [];
        continue;
      }
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        next[key] = raw
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
          .map((item) => sanitizeByManifestSchema(item, first));
        continue;
      }
      next[key] = raw;
      continue;
    }

    if (descriptor && typeof descriptor === 'object') {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        next[key] = sanitizeByManifestSchema(raw as Record<string, unknown>, descriptor);
      }
      continue;
    }

    next[key] = raw;
  }

  return next;
}

function sanitizeComponentEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const rawType = typeof entry.type === 'string' ? entry.type : '';
  const rawProps = entry.props && typeof entry.props === 'object'
    ? entry.props as Record<string, unknown>
    : {};
  const type = coerceBuiltinMediaComponentType(canonicalizeComponentType(rawType), rawProps);
  const manifestSchema = getManifestSchemaFromCache(type);
  if (manifestSchema) {
    const schemaSanitized = sanitizeByManifestSchema(rawProps, manifestSchema);
    return {
      ...entry,
      type,
      props: type === 'ProfileIntroCard'
        ? patchProfileIntroFallbacks(schemaSanitized)
        : schemaSanitized,
    };
  }

  const sanitizer = LEGACY_COMPONENT_SANITIZERS[type];
  if (!sanitizer) {
    return rawType !== type ? { ...entry, type } : entry;
  }
  return {
    ...entry,
    type,
    props: sanitizer(rawProps),
  };
}

function canonicalizeFlatSpecTypes(value: Record<string, unknown>): Record<string, unknown> {
  if (!(typeof value.root === 'string' && value.elements && typeof value.elements === 'object')) {
    return value;
  }
  const elements = value.elements as Record<string, unknown>;
  let changed = false;
  const nextElements: Record<string, unknown> = {};

  for (const [key, element] of Object.entries(elements)) {
    if (!element || typeof element !== 'object') {
      nextElements[key] = element;
      continue;
    }
    const entry = element as Record<string, unknown>;
    const rawType = typeof entry.type === 'string' ? entry.type : '';
    if (!rawType) {
      nextElements[key] = element;
      continue;
    }
    const sanitizedEntry = sanitizeComponentEntry(entry);
    const mapped = typeof sanitizedEntry.type === 'string' ? sanitizedEntry.type : rawType;
    if (mapped !== rawType || sanitizedEntry !== entry) {
      changed = true;
      nextElements[key] = sanitizedEntry;
    } else {
      nextElements[key] = element;
    }
  }

  if (!changed) return value;
  return {
    ...value,
    elements: nextElements,
  };
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 9);
}

export function mapStateToStatus(state: string): Agent['status'] {
  const normalized = state.trim().toLowerCase();
  if (normalized.includes('busy')) return 'busy';
  if (normalized.includes('run') || normalized.includes('online') || normalized.includes('idle')) return 'online';
  return 'offline';
}

export function mapManagementAgentToUi(agent: ManagementAgentSummary | ManagementAgentDetail): Agent {
  const displayName = agent.nickname?.trim() || agent.name || agent.english_name || agent.id;
  const rawTags = Array.isArray(agent.tags) ? agent.tags : [];
  const visibleTags = filterCollaborationTags(rawTags);
  return {
    id: agent.id,
    name: displayName,
    title: displayName,
    avatarUrl: agent.identity.avatar_url,
    portraitUrl: agent.identity.portrait_url,
    description: agent.description || 'No description',
    expertise:
      visibleTags.length > 0
        ? visibleTags
        : rawTags.length === 0
          ? ['general']
          : [],
    status: mapStateToStatus(agent.state),
    personality: 'default',
    mcpTools: [],
    model: agent.model.model || 'unknown',
    createdAt: new Date().toISOString(),
    messagesCount: 0,
    color: agent.identity.color || '#64748b',
  };
}

export function buildInitialMessages(_agentName: string): Message[] {
  return [];
}

export function buildHistory(messages: Message[]): AgentChatMessage[] {
  return messages
    .filter((msg) => msg.role === 'user' || msg.role === 'agent')
    .map<AgentChatMessage>((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: (() => {
        const text = (msg.text || '').trim();
        if (msg.role !== 'user' || !msg.attachments || msg.attachments.length === 0) {
          return text;
        }
        const attachmentLines = msg.attachments.map((attachment, index) => {
          const parts = [
            `${index + 1}. ${attachment.kind === 'image' ? '图片' : '附件'}：${attachment.name}`,
            `- 相对路径：${attachment.relativePath}`,
          ];
          if (attachment.savedPath?.trim()) {
            parts.push(`- 绝对路径：${attachment.savedPath.trim()}`);
          }
          return parts.join('\n');
        });
        return [text, '附件记录：', ...attachmentLines]
          .filter((item) => item.trim().length > 0)
          .join('\n');
      })(),
    }))
    .filter((msg) => msg.content.length > 0 && !isHiddenSystemPromptText(msg.content))
    .slice(-20);
}

export function pushTrace(list: MessageTrace[] | undefined, row: MessageTrace): MessageTrace[] {
  const next = list ? [...list] : [];
  const last = next[next.length - 1];
  if (last && last.title === row.title && last.detail === row.detail) {
    return next;
  }
  next.push(row);
  return next.slice(-40);
}

export function parseTraceFromLog(chunk: AgentChatStreamChunk): ParsedTrace | null {
  const raw = (chunk.value || '').trim();
  if (!raw) return null;

  const event = (chunk.event || '').trim().toLowerCase();
  const payload = parseJsonSafely<Record<string, unknown>>(raw);
  const payloadTool = payload ? (payload.tool || payload.name || payload.tool_name) : undefined;
  const payloadPhase = payload ? (payload.phase || payload.stage || payload.type) : undefined;

  if (event === 'tool_use' || event === 'tool_result') {
    const toolName = typeof payloadTool === 'string' ? payloadTool : 'unknown_tool';
    const status = event === 'tool_use' ? '开始' : '完成';
    return { target: 'tool', title: `${toolName} ${status}`, detail: raw };
  }

  if (event === 'phase') {
    const phase = typeof payloadPhase === 'string' ? payloadPhase : raw;
    const detail = payload && typeof payload.detail === 'string' ? payload.detail : '';
    const normalizedPhase = String(phase).trim().toLowerCase();
    if (!detail && /^(streaming|done|typing)$/i.test(normalizedPhase)) {
      return null;
    }
    if (normalizedPhase === 'semantic_memory_recall' || normalizedPhase === 'unified_memory_recall') {
      return { target: 'tool', title: '记忆召回', detail };
    }
    if (normalizedPhase === 'unified_memory_debug') {
      return { target: 'tool', title: '记忆调试', detail };
    }
    if (normalizedPhase === 'thinking' && detail) {
      return { target: 'thinking', title: '深度思考', detail };
    }
    return { target: 'thinking', title: `阶段: ${phase}`, detail };
  }

  if (typeof payloadTool === 'string' && payloadTool.trim()) {
    return { target: 'tool', title: payloadTool.trim(), detail: raw };
  }

  if (typeof payloadPhase === 'string' && payloadPhase.trim()) {
    return { target: 'thinking', title: payloadPhase.trim(), detail: '' };
  }

  if (/^\[tool/i.test(raw) || /tool_call|delegate_call|agent_find|agent_send/i.test(raw)) {
    return { target: 'tool', title: raw.split('\n')[0].slice(0, 120), detail: raw };
  }

  if (/\[phase\]|thinking|reasoning|analysis|思考|推理/i.test(raw)) {
    return { target: 'thinking', title: raw.split('\n')[0].slice(0, 120), detail: raw };
  }

  return null;
}

export function sanitizeAssistantText(text: string): string {
  return text
    .replace(/<\/?think>/gi, '')
    .replace(/<\|im_end\|>/gi, '')
    .replace(/<tool_call>\s*=?\s*[^\n\r]*/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripThinkingBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<thinking>[\s\S]*$/gi, '');
}

export function extractThinkingFromTaggedText(raw: string): string {
  if (!raw) return '';

  const parts: string[] = [];
  const closedPattern = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = closedPattern.exec(raw)) != null) {
    if (match[1]?.trim()) {
      parts.push(match[1]);
    }
  }

  const lower = raw.toLowerCase();
  const openThink = lower.lastIndexOf('<think>');
  const closeThink = lower.lastIndexOf('</think>');
  const openThinking = lower.lastIndexOf('<thinking>');
  const closeThinking = lower.lastIndexOf('</thinking>');

  let tailStart = -1;
  if (openThink > closeThink) {
    tailStart = Math.max(tailStart, openThink + '<think>'.length);
  }
  if (openThinking > closeThinking) {
    tailStart = Math.max(tailStart, openThinking + '<thinking>'.length);
  }

  if (tailStart >= 0 && tailStart < raw.length) {
    parts.push(raw.slice(tailStart));
  }

  if (parts.length === 0) return '';
  return sanitizeAssistantText(parts.join('\n'));
}

export function extractToolCallTitles(delta: string): string[] {
  const lines = delta.split(/\r?\n/);
  const hits: string[] = [];
  for (const line of lines) {
    const matched = line.match(/<tool_call>\s*=?\s*(.+)$/i);
    if (matched?.[1]) {
      hits.push(matched[1].trim().slice(0, 160));
    }
  }
  return hits;
}

export function findUiBoundary(raw: string): number {
  const tagMatch = raw.match(UI_JSON_OPEN_TAG_PATTERN);
  if (tagMatch && typeof tagMatch.index === 'number') return tagMatch.index;

  const implicitCandidates = [
    raw.search(/```(?:json)?\s*\{/i),
    raw.search(/\{\s*"type"\s*:/),
    raw.search(/\{\s*"root"\s*:/),
  ].filter((idx) => idx >= 0);

  if (implicitCandidates.length === 0) return -1;
  const best = Math.min(...implicitCandidates);
  if (raw.slice(best, best + 3) === '```') {
    return raw.indexOf('{', best);
  }
  return best;
}

export function extractFirstJsonObject(input: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          return input.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

export function extractUiRawText(rawText: string): string {
  const normalized = unwrapResponseEnvelopeText(rawText);
  const boundary = findUiBoundary(normalized);
  if (boundary < 0) return '';
  return normalized.slice(boundary).trim();
}

export function sanitizeAiUiOutput(rawText: string): string {
  const normalized = unwrapResponseEnvelopeText(rawText).trim();
  if (!normalized) return '';

  return normalized
    .replace(/```xml\s*(<ui[-_]json>[\s\S]*?<\/ui[-_]json>)\s*```/gi, '$1')
    .replace(/```json\s*(<ui[-_]json>[\s\S]*?<\/ui[-_]json>)\s*```/gi, '$1')
    .replace(/```\s*(<ui[-_]json>[\s\S]*?<\/ui[-_]json>)\s*```/gi, '$1')
    .trim();
}

type ExtractedUiJsonBlock = {
  fullMatch: string;
  payload: string;
  start: number;
  end: number;
};

function extractUiJsonBlocks(rawText: string): ExtractedUiJsonBlock[] {
  const normalized = sanitizeAiUiOutput(rawText);
  const blocks: ExtractedUiJsonBlock[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = UI_JSON_BLOCK_PATTERN.exec(normalized)) !== null) {
    blocks.push({
      fullMatch: match[0] || '',
      payload: (match[1] || '').trim(),
      start: match.index,
      end: UI_JSON_BLOCK_PATTERN.lastIndex,
    });
  }
  UI_JSON_BLOCK_PATTERN.lastIndex = 0;
  return blocks;
}

function trimToLastBalancedJsonObject(input: string): string {
  const text = input.trim();
  if (!text) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;
  let bestEnd = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0) {
          bestEnd = i + 1;
        }
      }
    }
  }

  if (bestEnd > 0) {
    return text.slice(0, bestEnd).trim();
  }

  const firstObject = extractFirstJsonObject(text);
  return firstObject?.trim() || '';
}

function recoverUiJsonPayload(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) return '';

  const repaired = repairUiJsonString(trimmed).trim();
  if (parseJsonSafely<unknown>(repaired) != null) {
    return repaired;
  }

  const trimmedBalanced = trimToLastBalancedJsonObject(repaired);
  if (trimmedBalanced && parseJsonSafely<unknown>(trimmedBalanced) != null) {
    return trimmedBalanced;
  }

  const firstObject = extractFirstJsonObject(repaired);
  if (firstObject) {
    const repairedFirst = repairUiJsonString(firstObject).trim();
    if (parseJsonSafely<unknown>(repairedFirst) != null) {
      return repairedFirst;
    }
  }

  return '';
}

function parseRecoveredUiJson(payload: string): unknown | undefined {
  const recovered = recoverUiJsonPayload(payload);
  if (!recovered) return undefined;
  return parseJsonSafely<unknown>(recovered) ?? undefined;
}

export function getBestEffortUiJsonBlocks(rawText: string): ExtractedUiJsonBlock[] {
  const blocks = extractUiJsonBlocks(rawText);
  if (blocks.length === 0) return [];

  return blocks
    .map((block) => {
      const recoveredPayload = recoverUiJsonPayload(block.payload);
      return recoveredPayload
        ? { ...block, payload: recoveredPayload }
        : null;
    })
    .filter((block): block is ExtractedUiJsonBlock => block !== null);
}

export function hasValidUiJsonBlock(rawText: string): boolean {
  return getBestEffortUiJsonBlocks(rawText).length > 0;
}

function buildShorthandSpecFromTypeObject(value: Record<string, unknown>): unknown | undefined {
  const rawType = typeof value.type === 'string' ? canonicalizeComponentType(value.type) : '';
  if (!rawType) return undefined;
  if (NON_UI_TYPES.has(rawType.toLowerCase())) return undefined;

  if (
    (value.props && typeof value.props === 'object')
    || Object.prototype.hasOwnProperty.call(value, 'children')
    || Object.prototype.hasOwnProperty.call(value, 'slots')
    || Object.prototype.hasOwnProperty.call(value, 'elements')
  ) {
    return value;
  }

  const rest = { ...value };
  delete rest.type;
  const restKeys = Object.keys(rest);
  if (restKeys.length === 0) {
    return {
      type: rawType,
      props: {},
    };
  }
  if (rawType === 'ProfileIntroCard') {
    return {
      type: rawType,
      props: sanitizeProfileIntroProps(rest),
    };
  }
  return {
    type: rawType,
    props: rest,
  };
}

function normalizeUiSpecCandidate(value: unknown): unknown | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const obj = value as Record<string, unknown>;
  const rawType = typeof obj.type === 'string' ? canonicalizeComponentType(obj.type) : '';
  if (rawType) {
    if (NON_UI_TYPES.has(rawType.toLowerCase())) return undefined;

    if (rawType === 'ProfileIntroCard') {
      const baseProps = (obj.props && typeof obj.props === 'object')
        ? { ...(obj.props as Record<string, unknown>) }
        : {};
      for (const [key, val] of Object.entries(obj)) {
        if (key === 'type' || key === 'props' || key === 'children' || key === 'slots' || key === 'elements') {
          continue;
        }
        baseProps[key] = val;
      }
      return {
        type: rawType,
        props: sanitizeProfileIntroProps(baseProps),
      };
    }

    const directItems = Array.isArray(obj.items) ? obj.items : undefined;
    const baseProps = (obj.props && typeof obj.props === 'object')
      ? { ...(obj.props as Record<string, unknown>) }
      : {};
    if (
      !Object.prototype.hasOwnProperty.call(obj, 'props')
      && !Object.prototype.hasOwnProperty.call(obj, 'children')
      && !Object.prototype.hasOwnProperty.call(obj, 'slots')
      && !Object.prototype.hasOwnProperty.call(obj, 'elements')
      && Object.keys(obj).length === 1
    ) {
      return {
        type: rawType,
        props: {},
      };
    }
    const propsItems = Array.isArray(baseProps.items) ? baseProps.items : undefined;
    const itemCandidates = directItems ?? propsItems;

    const rawTypeLower = rawType.trim().toLowerCase();
    const isContainerLike = rawTypeLower === 'div' || rawTypeLower === 'container' || rawTypeLower === 'box';
    if (itemCandidates && isContainerLike) {
      delete baseProps.items;
      const children = itemCandidates
        .map((item) => normalizeUiSpecCandidate(item))
        .filter((item): item is unknown => item !== undefined);

      for (const [key, val] of Object.entries(obj)) {
        if (key === 'type' || key === 'props' || key === 'items' || key === 'children' || key === 'slots' || key === 'elements') {
          continue;
        }
        baseProps[key] = val;
      }

      const normalized: Record<string, unknown> = {
        type: rawType,
        props: baseProps,
      };
      if (children.length > 0) {
        normalized.children = children;
      }
      return normalized;
    }
  }

  if (typeof obj.root === 'string' && obj.elements && typeof obj.elements === 'object') {
    return canonicalizeFlatSpecTypes(obj);
  }

  if (Array.isArray(value)) {
    const children = value
      .map((item) => normalizeUiSpecCandidate(item))
      .filter((item): item is unknown => item !== undefined);
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return {
      type: 'div',
      props: {},
      children,
    };
  }

  const shorthand = buildShorthandSpecFromTypeObject(obj);
  if (shorthand && typeof shorthand === 'object') {
    return shorthand as Record<string, unknown>;
  }
  return shorthand;
}

function mergeUiSpecs(specs: unknown[]): unknown | undefined {
  if (specs.length === 0) return undefined;
  if (specs.length === 1) return specs[0];
  return {
    type: 'div',
    props: {},
    children: specs,
  };
}

function extractJsonValues(input: string): unknown[] {
  const values: unknown[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          const raw = input.slice(start, i + 1);
          const parsed = parseJsonSafely<unknown>(raw);
          if (parsed !== null) {
            values.push(parsed);
          }
          start = -1;
        }
      }
    }
  }

  return values;
}

export function isLikelyUiSpec(value: unknown): boolean {
  return normalizeUiSpecCandidate(value) !== undefined;
}

export function appendThinkingStream(list: MessageTrace[] | undefined, delta: string): MessageTrace[] {
  const text = delta.trim();
  if (!text) return list ? [...list] : [];
  const next = list ? [...list] : [];
  const now = new Date().toISOString();
  const markerIndex = next.findIndex((row) => row.id === '__thinking_stream__');
  if (markerIndex < 0) {
    next.unshift({ id: '__thinking_stream__', title: '深度思考', detail: text, at: now });
    return next.slice(0, 40);
  }
  const current = next[markerIndex];
  const prev = current.detail || '';
  const merged = prev ? `${prev}${prev.endsWith('\n') ? '' : '\n'}${text}` : text;
  next[markerIndex] = { ...current, detail: merged, at: now };
  return next.slice(0, 40);
}

export function cleanupAssistantText(rawText: string, spec?: unknown): string {
  const normalizedRaw = unwrapResponseEnvelopeText(rawText);
  const withoutThinking = stripThinkingBlocks(normalizedRaw);
  const withoutUiBlock = withoutThinking
    .replace(/<ui[-_]json>[\s\S]*?<\/ui[-_]json>/gi, '')
    .replace(/<ui[-_]json>[\s\S]*$/gi, '');
  const slicedByBoundary = withoutUiBlock;
  const text = sanitizeAssistantText(slicedByBoundary);
  if (!text) return '';
  if (!spec) return text;

  const parsed = parseJsonSafely<unknown>(text);
  if (parsed && typeof parsed === 'object') {
    return '';
  }

  const fencedJsonPattern = /```(?:json)?\s*[\s\S]*?\{[\s\S]*?"type"\s*:\s*"[^"]+"[\s\S]*?\}\s*```/g;
  const cleaned = sanitizeAssistantText(slicedByBoundary.replace(fencedJsonPattern, ''));
  return cleaned;
}

export function tryParseInlineSpecFromText(rawText: string): unknown | undefined {
  const text = unwrapResponseEnvelopeText(rawText).trim();
  if (!text) return undefined;
  const direct = parseJsonSafely<unknown>(text);
  const normalizedDirect = normalizeUiSpecCandidate(direct);
  if (normalizedDirect) {
    return normalizedDirect;
  }

  const boundary = findUiBoundary(text);
  const segment = boundary >= 0 ? text.slice(boundary) : text;

  const uiBlocks = getBestEffortUiJsonBlocks(segment);
  if (uiBlocks.length > 0) {
    const taggedSpecs = uiBlocks
      .map((block) => normalizeUiSpecCandidate(parseRecoveredUiJson(block.payload)))
      .filter((item): item is unknown => item !== undefined);
    const mergedTagged = mergeUiSpecs(taggedSpecs);
    if (mergedTagged) {
      return mergedTagged;
    }

    for (let index = uiBlocks.length - 1; index >= 0; index -= 1) {
      const parsed = normalizeUiSpecCandidate(parseRecoveredUiJson(uiBlocks[index].payload));
      if (parsed) {
        return parsed;
      }
    }
  }

  const firstJson = extractFirstJsonObject(segment);
  const firstNormalized = firstJson ? normalizeUiSpecCandidate(parseJsonSafely<unknown>(firstJson)) : undefined;
  if (firstNormalized) {
    return firstNormalized;
  }

  const allCandidates = extractJsonValues(segment)
    .map((candidate) => normalizeUiSpecCandidate(candidate))
    .filter((item): item is unknown => item !== undefined);
  const mergedAll = mergeUiSpecs(allCandidates);
  if (mergedAll) {
    return mergedAll;
  }
  return undefined;
}

export function normalizeIncomingSpec(spec: unknown): unknown | undefined {
  if (spec == null) return undefined;
  if (typeof spec === 'object') {
    return normalizeUiSpecCandidate(spec);
  }
  if (typeof spec !== 'string') return undefined;

  const text = unwrapResponseEnvelopeText(spec).trim();
  if (!text) return undefined;
  const direct = parseJsonSafely<unknown>(repairUiJsonString(text));
  const normalizedDirect = normalizeUiSpecCandidate(direct);
  if (normalizedDirect) {
    return normalizedDirect;
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every((line) => line.startsWith('{') && line.endsWith('}'))) {
    try {
      return compileSpecStream(lines.join('\n'));
    } catch {
      // ignore invalid patch stream
    }
  }

  return tryParseInlineSpecFromText(text);
}

export function extractAgentSelfAppearanceActionFromSpec(spec: unknown): {
  payload: AgentSelfAppearanceActionPayload;
  strippedSpec: unknown | undefined;
} | null {
  let payload: AgentSelfAppearanceActionPayload | null = null;

  const stripFlatRefValue = (
    value: unknown,
    removedIds: Set<string>,
  ): unknown | undefined => {
    if (typeof value === 'string') {
      return removedIds.has(value) ? undefined : value;
    }
    if (Array.isArray(value)) {
      const nextItems = value
        .map((item) => stripFlatRefValue(item, removedIds))
        .filter((item): item is unknown => item !== undefined);
      return nextItems;
    }
    if (!isRecordValue(value)) {
      return value;
    }
    let changed = false;
    const nextValue: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const strippedEntry = stripFlatRefValue(entry, removedIds);
      if (strippedEntry !== entry) {
        changed = true;
      }
      if (strippedEntry !== undefined) {
        nextValue[key] = strippedEntry;
      }
    }
    return changed ? nextValue : value;
  };

  const stripFlatSpec = (node: Record<string, unknown>): unknown | undefined => {
    if (typeof node.root !== 'string' || !isRecordValue(node.elements)) {
      return undefined;
    }

    const removedIds = new Set<string>();
    const sourceElements = node.elements as Record<string, unknown>;
    for (const [key, element] of Object.entries(sourceElements)) {
      if (!isRecordValue(element) || !isAgentSelfAppearanceActionType(element.type)) {
        continue;
      }
      if (!payload) {
        payload = normalizeAgentSelfAppearanceActionPayload(element.props);
      }
      removedIds.add(key);
    }

    if (removedIds.size === 0) {
      return node;
    }

    const nextElements: Record<string, unknown> = {};
    for (const [key, element] of Object.entries(sourceElements)) {
      if (removedIds.has(key)) {
        continue;
      }
      if (!isRecordValue(element)) {
        nextElements[key] = element;
        continue;
      }

      let changed = false;
      let nextElement: Record<string, unknown> = element;

      if (Object.prototype.hasOwnProperty.call(element, 'children')) {
        const strippedChildren = stripFlatRefValue(element.children, removedIds);
        if (strippedChildren !== element.children) {
          changed = true;
          nextElement = { ...nextElement };
          if (strippedChildren === undefined) {
            delete nextElement.children;
          } else {
            nextElement.children = strippedChildren;
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(element, 'slots')) {
        const strippedSlots = stripFlatRefValue(element.slots, removedIds);
        if (strippedSlots !== element.slots) {
          changed = true;
          nextElement = nextElement === element ? { ...nextElement } : nextElement;
          if (strippedSlots === undefined) {
            delete nextElement.slots;
          } else {
            nextElement.slots = strippedSlots;
          }
        }
      }

      nextElements[key] = changed ? nextElement : element;
    }

    const nextRoot = !removedIds.has(node.root) && Object.prototype.hasOwnProperty.call(nextElements, node.root)
      ? node.root
      : Object.keys(nextElements)[0];
    if (!nextRoot) {
      return undefined;
    }

    return {
      ...node,
      root: nextRoot,
      elements: nextElements,
    };
  };

  const stripNode = (node: unknown): unknown | undefined => {
    if (Array.isArray(node)) {
      const nextChildren = node
        .map((item) => stripNode(item))
        .filter((item): item is unknown => item !== undefined);
      return nextChildren.length > 0 ? nextChildren : undefined;
    }
    if (!isRecordValue(node)) {
      return node;
    }

    const strippedFlatSpec = stripFlatSpec(node);
    if (strippedFlatSpec !== undefined || (typeof node.root === 'string' && isRecordValue(node.elements))) {
      return strippedFlatSpec;
    }

    if (isAgentSelfAppearanceActionType(node.type)) {
      if (!payload) {
        payload = normalizeAgentSelfAppearanceActionPayload(node.props);
      }
      return undefined;
    }

    if (Array.isArray(node.children)) {
      const nextChildren = node.children
        .map((item) => stripNode(item))
        .filter((item): item is unknown => item !== undefined);
      if (nextChildren.length === 0) {
        return undefined;
      }
      return {
        ...node,
        children: nextChildren,
      };
    }

    return node;
  };

  const strippedSpec = stripNode(spec);
  if (!payload) {
    return null;
  }
  return {
    payload,
    strippedSpec,
  };
}

export function extractReadableText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = sanitizeAssistantText(value);
    return text || undefined;
  }
  if (Array.isArray(value)) {
    const lines = value.map((item) => extractReadableText(item)).filter((item): item is string => Boolean(item));
    if (lines.length === 0) return undefined;
    return lines.join('\n').slice(0, 2400);
  }
  if (!value || typeof value !== 'object') return undefined;

  const obj = value as Record<string, unknown>;
  const preferredKeys = ['final_answer', 'answer', 'output', 'result', 'content', 'text', 'message', 'summary', 'observation', 'value'];
  for (const key of preferredKeys) {
    const picked = extractReadableText(obj[key]);
    if (picked) return picked;
  }
  for (const val of Object.values(obj)) {
    const picked = extractReadableText(val);
    if (picked) return picked;
  }
  return undefined;
}

function parseToolLogPayload(raw: string): Record<string, unknown> | undefined {
  const payload = parseJsonSafely<Record<string, unknown>>(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  return payload;
}

function parseNestedToolPayload(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = parseJsonSafely<unknown>(value.trim());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getToolNameFromLogPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  const candidate = payload.tool || payload.name || payload.tool_name;
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function hasMeaningfulToolLogContent(payload: Record<string, unknown>): boolean {
  const ignoredKeys = new Set(['tool', 'input', 'args', 'arguments', 'name', 'id', 'type']);
  return Object.keys(payload).some((key) => {
    if (ignoredKeys.has(key)) return false;
    const value = payload[key];
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  });
}

export function extractReadableTextFromLog(raw: string): string | undefined {
  const payload = parseToolLogPayload(raw);
  if (!payload) return undefined;
  if (!hasMeaningfulToolLogContent(payload)) return undefined;
  const text = extractReadableText(payload);
  if (!text) return undefined;
  return text.slice(0, 2400);
}

export function extractLatestToolReadableText(rows: MessageTrace[] | undefined): string | undefined {
  if (!rows || rows.length === 0) return undefined;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const detail = rows[i]?.detail;
    if (!detail) continue;
    const picked = extractReadableTextFromLog(detail);
    if (picked && !looksLikeProtocolOnlyText(picked)) {
      return picked;
    }
  }
  return undefined;
}

function buildImageFallbackSpec(payload: Record<string, unknown>): unknown | undefined {
  const toolName = getToolNameFromLogPayload(payload).toLowerCase();
  if ((toolName !== 'image_generate' && toolName !== 'image_edit') || payload.is_error === true) {
    return undefined;
  }

  const resultPayload = parseNestedToolPayload(payload.result) || payload;
  const imageUrls = pickStringArray(resultPayload.image_urls ?? resultPayload.imageUrls);
  const savedPaths = pickStringArray(resultPayload.saved_to ?? resultPayload.savedTo);
  const sources = imageUrls.length > 0 ? imageUrls : savedPaths;
  if (sources.length === 0) {
    return undefined;
  }

  const model = typeof resultPayload.model === 'string' ? resultPayload.model.trim() : '';
  const prompt = parseNestedToolPayload(payload.input)?.prompt;
  const title = typeof prompt === 'string' && prompt.trim()
    ? prompt.trim().slice(0, 48)
    : toolName === 'image_edit' ? '图片修改结果' : '图片生成结果';
  const images = sources.map((src, index) => ({
    src,
    alt: `${title} ${index + 1}`,
  }));

  if (images.length === 1) {
    return {
      type: 'ImageCover',
      props: {
        src: images[0].src,
        alt: images[0].alt,
        title,
        description: model || undefined,
      },
    };
  }

  return {
    type: 'ImageCarousel',
    props: {
      images,
      title,
      showThumbs: true,
    },
  };
}

export function buildRenderableSpecFromToolLog(raw: string): unknown | undefined {
  const payload = parseToolLogPayload(raw);
  if (!payload) {
    return undefined;
  }
  return buildImageFallbackSpec(payload);
}

export function buildFallbackSpecFromToolTrace(rows: MessageTrace[] | undefined): unknown | undefined {
  if (!rows || rows.length === 0) return undefined;

  const latestTool = [...rows]
    .reverse()
    .find((row) => /web_search|tool|delegate|搜索|天气/i.test(`${row.title}
${row.detail || ''}`));

  if (!latestTool) {
    return undefined;
  }

  const detail = (latestTool.detail || '').trim();
  const title = latestTool.title.trim() || '工具结果';
  const payload = parseToolLogPayload(detail);
  const renderableSpec = payload ? buildImageFallbackSpec(payload) : undefined;
  if (renderableSpec != null) {
    return renderableSpec;
  }
  const payloadToolName = getToolNameFromLogPayload(payload);
  const readable = extractReadableTextFromLog(detail);

  const queryMatch = detail.match(/(?:^|\n)\s*query\s*:\s*(.+)$/im);
  const toolMatch = detail.match(/<tool_call>\s*=?\s*([^\n\r]+)/i);

  const query = queryMatch?.[1]?.trim();
  const toolName = toolMatch?.[1]?.trim() || payloadToolName;
  if (toolName.toLowerCase() === 'memory_recall') {
    return undefined;
  }
  const fallbackDetail = hasMeaningfulToolLogContent(payload || {})
    ? detail.replace(/<tool_call>\s*=?\s*/gi, '').trim()
    : '';

  const weatherLike = query && /天气|气温|温度|降雨|下雨|预报/i.test(query);
  if (weatherLike) {
    const cityMatch = query.match(/([\u4e00-\u9fa5]{2,10})(?:明天|今天|后天|天气|气温|温度|预报)/);
    const dateMatch = query.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
    const dayHint = query.match(/今天|明天|后天/)?.[0];
    const city = cityMatch?.[1]?.trim() || '目标城市';
    const when = dateMatch?.[1] || dayHint || '目标日期';
    return {
      type: 'card',
      props: {
        title: `${city}天气查询`,
        content: `已发起天气检索：${city} · ${when}。当前上游尚未返回结构化天气结果，请查看后续搜索结果或切换到普通聊天模式重试。`,
        footer: '来源：web_search 查询卡片',
      },
    };
  }

  const content = readable
    || query
    || fallbackDetail
    || '本次工具已执行，但后端未返回可解析的最终展示内容。';

  return {
    type: 'card',
    props: {
      title: query ? `工具调用：${query}` : title,
      content,
      footer: toolName ? `来源：${toolName}` : '来源：工具调用日志兜底',
    },
  };
}

export function looksLikeProtocolOnlyText(text: string): boolean {
  const normalized = unwrapResponseEnvelopeText(text).trim();
  if (!normalized) return true;
  if (isHiddenSystemPromptText(normalized)) return true;
  if (/^<tool_call>/im.test(normalized)) return true;
  if (/^```(?:json)?[\s\S]*```$/i.test(normalized) && /"type"\s*:|"root"\s*:/i.test(normalized)) return true;
  if (/^\{[\s\S]*\}$/i.test(normalized) && /"type"\s*:|"root"\s*:/i.test(normalized)) return true;
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every((line) => /^(query|tool|args?|name|id|type)\s*:/i.test(line))) {
    return true;
  }
  return false;
}
