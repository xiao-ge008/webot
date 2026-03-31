import { compileSpecStream } from '@json-render/core';
import type { MessageTrace, Message } from '@/data/mock-chats';
import type { Agent } from '@/types';
import type { AgentChatMessage, AgentChatStreamChunk } from '@/main/types';
import type {
  ManagementAgentDetail,
  ManagementAgentSummary,
  ManagementComponentInvokeResult,
  ManagementRendererBindingRecord,
} from '@/services/management-client';
import { isHiddenSystemPromptText } from '@/lib/chat-message-filter';

const HIDDEN_COLLAB_TAGS = new Set(['webot:collab_discoverable', 'webot:collab_dispatcher']);
const rendererBindingCache = new Map<string, ManagementRendererBindingRecord>();

function buildRendererBindingCacheKey(
  channel: string,
  resultKind: string,
  mediaType?: string,
  documentType?: string,
): string {
  return [
    channel.trim().toLowerCase(),
    resultKind.trim().toLowerCase(),
    (mediaType || '').trim().toLowerCase(),
    (documentType || '').trim().toLowerCase(),
  ].join('::');
}

function normalizeRendererBindingRecord(
  binding: ManagementRendererBindingRecord,
): ManagementRendererBindingRecord {
  return {
    ...binding,
    channel: binding.channel.trim().toLowerCase(),
    result_kind: binding.result_kind.trim().toLowerCase(),
    media_type: binding.media_type?.trim().toLowerCase() || undefined,
    document_type: binding.document_type?.trim().toLowerCase() || undefined,
    renderer_key: binding.renderer_key.trim(),
    fallback_channel: binding.fallback_channel?.trim().toLowerCase() || undefined,
  };
}

export function primeRendererBindingCache(
  bindings: readonly ManagementRendererBindingRecord[],
): void {
  rendererBindingCache.clear();
  bindings.forEach((binding) => {
    const normalized = normalizeRendererBindingRecord(binding);
    rendererBindingCache.set(
      buildRendererBindingCacheKey(
        normalized.channel,
        normalized.result_kind,
        normalized.media_type,
        normalized.document_type,
      ),
      normalized,
    );
  });
}

function resolveDesktopRendererBinding(
  resultKind: string,
  options: {
    mediaType?: string;
    documentType?: string;
  } = {},
): ManagementRendererBindingRecord | undefined {
  const normalizedResultKind = resultKind.trim().toLowerCase();
  const normalizedMediaType = options.mediaType?.trim().toLowerCase() || undefined;
  const normalizedDocumentType = options.documentType?.trim().toLowerCase() || undefined;
  const candidates = [
    buildRendererBindingCacheKey('desktop', normalizedResultKind, normalizedMediaType, normalizedDocumentType),
    buildRendererBindingCacheKey('desktop', normalizedResultKind, normalizedMediaType, undefined),
    buildRendererBindingCacheKey('desktop', normalizedResultKind, undefined, normalizedDocumentType),
    buildRendererBindingCacheKey('desktop', normalizedResultKind, undefined, undefined),
  ];
  for (const key of candidates) {
    const binding = rendererBindingCache.get(key);
    if (binding) {
      return binding;
    }
  }
  return undefined;
}

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

export interface ComponentInvokeActionPayload {
  componentName: string;
  params: Record<string, unknown>;
  renderResult?: boolean;
  exposeToAgent?: boolean;
  resultTitle?: string;
  reason?: string;
}

interface ComponentInvokeNormalizedItem {
  kind: string;
  url: string;
  text: string;
  mimeType: string;
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
  jobprogresscard: 'JobProgressCard',
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
const TOOL_CALL_TAG_PATTERN = /<\/?(?:[a-z0-9_.-]+:)?tool_call\b[^>]*>/gi;
const TOOL_CALL_OPEN_WITH_CONTENT_PATTERN = /<(?:[a-z0-9_.-]+:)?tool_call>\s*=?\s*[^\n\r]*/gi;
const LEGACY_COMPONENT_TAG_PATTERN = /<([a-z][a-z0-9_-]*)(\s+[\s\S]*?)(?:>|(?=\s*<\/\1>))\s*<\/\1>/gi;
const LEGACY_COMPONENT_ATTRIBUTE_PATTERN = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s"'=<>`]+))/g;
const COMMON_HTML_TAG_NAMES = new Set([
  'a',
  'article',
  'audio',
  'blockquote',
  'body',
  'br',
  'button',
  'code',
  'details',
  'div',
  'em',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'iframe',
  'img',
  'input',
  'label',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'picture',
  'pre',
  'section',
  'select',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'video',
]);

type LegacyComponentTagMatch = {
  attributesText: string;
  end: number;
  fullMatch: string;
  start: number;
  tagName: string;
};

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function containsUiJsonTag(raw: string): boolean {
  return UI_JSON_OPEN_TAG_PATTERN.test(raw);
}

function isLikelyLegacyComponentTagName(tagName: string): boolean {
  const normalized = tagName.trim().toLowerCase();
  if (!normalized) return false;
  if (COMMON_HTML_TAG_NAMES.has(normalized)) return false;
  return /^[a-z][a-z0-9_-]*$/.test(normalized);
}

function decodeLegacyAttributeValue(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\(["'\\])/g, '$1');
}

function coerceLegacyAttributeValue(raw: string): unknown {
  const trimmed = decodeLegacyAttributeValue(raw.trim());
  if (/^(?:true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return trimmed;
}

function parseLegacyComponentAttributes(attributesText: string): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  let match: RegExpExecArray | null;
  LEGACY_COMPONENT_ATTRIBUTE_PATTERN.lastIndex = 0;

  while ((match = LEGACY_COMPONENT_ATTRIBUTE_PATTERN.exec(attributesText)) !== null) {
    const rawName = (match[1] || '').trim();
    if (!rawName) continue;

    const attributeName = rawName.replace(/[:.-]+([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase());
    const attributeValue = match[3] ?? match[4] ?? match[5] ?? '';
    attributes[attributeName] = coerceLegacyAttributeValue(attributeValue);
  }

  return attributes;
}

function legacyTagNameToComponentType(tagName: string): string {
  const segments = tagName
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);

  if (segments.length === 0) return '';
  if (segments.length === 1) {
    const [single] = segments;
    return `${single[0]?.toUpperCase() || ''}${single.slice(1)}`;
  }

  return segments
    .map((segment) => `${segment[0]?.toUpperCase() || ''}${segment.slice(1)}`)
    .join('');
}

function normalizeLegacyInitialValues(attributes: Record<string, unknown>): Record<string, unknown> {
  const next = { ...attributes };
  if (next.text == null && typeof next.prompt === 'string' && next.prompt.trim()) {
    next.text = next.prompt.trim();
  }
  if (next.image == null && typeof next.src === 'string' && next.src.trim()) {
    next.image = next.src.trim();
  }
  delete next.prompt;
  delete next.src;
  return next;
}

function findLegacyComponentTagMatches(raw: string): LegacyComponentTagMatch[] {
  const matches: LegacyComponentTagMatch[] = [];
  let match: RegExpExecArray | null;
  LEGACY_COMPONENT_TAG_PATTERN.lastIndex = 0;

  while ((match = LEGACY_COMPONENT_TAG_PATTERN.exec(raw)) !== null) {
    const tagName = (match[1] || '').trim();
    if (!isLikelyLegacyComponentTagName(tagName)) {
      continue;
    }
    const fullMatch = match[0] || '';
    const start = match.index;
    matches.push({
      attributesText: match[2] || '',
      end: start + fullMatch.length,
      fullMatch,
      start,
      tagName,
    });
  }

  return matches;
}

function buildLegacyComponentSpec(tagName: string, attributesText: string): unknown | undefined {
  const type = canonicalizeComponentType(legacyTagNameToComponentType(tagName));
  if (!type || NON_UI_TYPES.has(type.toLowerCase())) {
    return undefined;
  }

  const initialValues = normalizeLegacyInitialValues(parseLegacyComponentAttributes(attributesText));
  return {
    type,
    props: {
      autoRun: true,
      initialValues,
    },
  };
}

function extractLegacyComponentSpecs(raw: string): { matches: LegacyComponentTagMatch[]; specs: unknown[] } {
  const matches = findLegacyComponentTagMatches(raw);
  if (matches.length === 0) {
    return { matches: [], specs: [] };
  }

  const specs = matches
    .map((match) => normalizeUiSpecCandidate(buildLegacyComponentSpec(match.tagName, match.attributesText)))
    .filter((item): item is unknown => item !== undefined);

  return { matches, specs };
}

function stripLegacyComponentTags(raw: string): string {
  const matches = findLegacyComponentTagMatches(raw);
  if (matches.length === 0) {
    return raw;
  }

  let cursor = 0;
  let output = '';
  for (const match of matches) {
    output += raw.slice(cursor, match.start);
    cursor = match.end;
  }
  output += raw.slice(cursor);
  return output;
}

function normalizeHiddenActionType(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.-]+/g, '');
}

export function isAgentSelfAppearanceActionType(value: unknown): boolean {
  return typeof value === 'string' && normalizeHiddenActionType(value) === 'agentselfappearanceaction';
}

export function isComponentInvokeActionType(value: unknown): boolean {
  return typeof value === 'string' && normalizeHiddenActionType(value) === 'componentinvokeaction';
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

export function normalizeComponentInvokeActionPayload(raw: unknown): ComponentInvokeActionPayload | null {
  if (!isRecordValue(raw)) {
    return null;
  }

  const componentName = typeof raw.componentName === 'string'
    ? raw.componentName.trim()
    : typeof raw.component_name === 'string'
      ? raw.component_name.trim()
      : typeof raw.name === 'string'
        ? raw.name.trim()
        : typeof raw.component === 'string'
          ? raw.component.trim()
          : '';
  if (!componentName) {
    return null;
  }

  const readParamsCandidate = (value: unknown): Record<string, unknown> | null => {
    if (!isRecordValue(value)) {
      return null;
    }
    return { ...value };
  };

  const params = readParamsCandidate(raw.params)
    ?? readParamsCandidate(raw.parameters)
    ?? readParamsCandidate(raw.arguments)
    ?? readParamsCandidate(raw.input)
    ?? readParamsCandidate(raw.values)
    ?? readParamsCandidate(raw.initialValues)
    ?? (() => {
      const reserved = new Set([
        'componentName',
        'component_name',
        'name',
        'component',
        'params',
        'parameters',
        'arguments',
        'input',
        'values',
        'initialValues',
        'initial_values',
        'renderResult',
        'render_result',
        'exposeToAgent',
        'expose_to_agent',
        'resultTitle',
        'result_title',
        'title',
        'reason',
        'description',
      ]);
      const collected = Object.entries(raw).reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (!reserved.has(key)) {
          acc[key] = value;
        }
        return acc;
      }, {});
      return Object.keys(collected).length > 0 ? collected : {};
    })();

  const renderResult = typeof raw.renderResult === 'boolean'
    ? raw.renderResult
    : typeof raw.render_result === 'boolean'
      ? raw.render_result
      : false;
  const exposeToAgent = typeof raw.exposeToAgent === 'boolean'
    ? raw.exposeToAgent
    : typeof raw.expose_to_agent === 'boolean'
      ? raw.expose_to_agent
      : true;
  const resultTitle = typeof raw.resultTitle === 'string'
    ? raw.resultTitle.trim()
    : typeof raw.result_title === 'string'
      ? raw.result_title.trim()
      : typeof raw.title === 'string'
        ? raw.title.trim()
        : '';
  const reason = typeof raw.reason === 'string'
    ? raw.reason.trim()
    : typeof raw.description === 'string'
      ? raw.description.trim()
      : '';

  return {
    componentName,
    params,
    renderResult,
    exposeToAgent,
    resultTitle: resultTitle || undefined,
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

function escapeRawControlCharsInJsonStrings(value: string): string {
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
      result += current;
      inString = false;
      continue;
    }

    if (current === '\r') {
      if (value[index + 1] === '\n') {
        index += 1;
      }
      result += '\\n';
      continue;
    }

    if (current === '\n') {
      result += '\\n';
      continue;
    }

    if (current === '\t') {
      result += '\\t';
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

  repaired = escapeRawControlCharsInJsonStrings(repaired);
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

function buildComponentInvokeHistorySupplement(message: Message): string {
  if (message.role !== 'agent' || !message.toolTrace || message.toolTrace.length === 0) {
    return '';
  }
  for (let index = message.toolTrace.length - 1; index >= 0; index -= 1) {
    const detail = (message.toolTrace[index]?.detail || '').trim();
    const payload = parseToolLogPayload(detail);
    if (!payload || getToolNameFromLogPayload(payload).toLowerCase() !== 'component_invoke') {
      continue;
    }
    const componentName = typeof payload.component_name === 'string'
      ? payload.component_name.trim()
      : typeof payload.componentName === 'string'
        ? payload.componentName.trim()
        : '组件';
    const summary = buildComponentInvokeSummaryText(
      componentName,
      pickNestedToolResultPayload(payload) ?? payload.result,
      { includeUrls: true },
    );
    if (!summary) {
      continue;
    }
    return [
      '组件调用结果摘要：',
      summary,
    ].join('\n');
  }
  return '';
}

export function buildHistory(messages: Message[]): AgentChatMessage[] {
  return messages
    .filter((msg) => msg.role === 'user' || msg.role === 'agent')
    .map<AgentChatMessage>((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: (() => {
        const text = (msg.text || '').trim();
        if (msg.role === 'agent') {
          const componentSupplement = buildComponentInvokeHistorySupplement(msg);
          return [text, componentSupplement]
            .filter((item) => item.trim().length > 0)
            .join('\n\n');
        }
        if (!msg.attachments || msg.attachments.length === 0) {
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
    const normalizedPhase = String(phase).trim().toLowerCase();
    const fallbackPhaseDetail: Record<string, string> = {
      streaming: '模型已开始处理本轮请求，正在等待首个内容块。',
      thinking: '模型正在思考并组织回复。',
      typing: '模型正在整理输出内容。',
      done: '本轮流式输出已结束。',
      session_prepare: '正在准备并切换目标会话。',
      session_ready: '目标会话已准备完成。',
      upstream_connecting: '正在连接上游模型流。',
      upstream_connected: '已建立上游流式连接，等待首个内容块。',
    };
    const detail = payload && typeof payload.detail === 'string' && payload.detail.trim()
      ? payload.detail.trim()
      : (fallbackPhaseDetail[normalizedPhase] || '');
    if (normalizedPhase === 'semantic_memory_recall' || normalizedPhase === 'unified_memory_recall') {
      return { target: 'tool', title: '记忆召回', detail };
    }
    if (normalizedPhase === 'unified_memory_debug') {
      return { target: 'tool', title: '记忆调试', detail };
    }
    if (normalizedPhase === 'thinking' && detail) {
      return { target: 'thinking', title: '深度思考', detail };
    }
    if (normalizedPhase === 'session_prepare') {
      return { target: 'tool', title: '会话准备', detail };
    }
    if (normalizedPhase === 'session_ready') {
      return { target: 'tool', title: '会话就绪', detail };
    }
    if (normalizedPhase === 'upstream_connecting') {
      return { target: 'tool', title: '连接模型', detail };
    }
    if (normalizedPhase === 'upstream_connected') {
      return { target: 'tool', title: '模型连接已建立', detail };
    }
    if (normalizedPhase === 'streaming') {
      return { target: 'thinking', title: '开始生成', detail };
    }
    if (normalizedPhase === 'typing') {
      return { target: 'thinking', title: '整理输出', detail };
    }
    if (normalizedPhase === 'done') {
      return { target: 'thinking', title: '生成完成', detail };
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
    .replace(TOOL_CALL_OPEN_WITH_CONTENT_PATTERN, '')
    .replace(TOOL_CALL_TAG_PATTERN, '')
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
    const matched = line.match(/<(?:[a-z0-9_.-]+:)?tool_call>\s*=?\s*(.+)$/i);
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

  const legacyMatches = findLegacyComponentTagMatches(raw);
  if (legacyMatches.length > 0) {
    implicitCandidates.push(legacyMatches[0].start);
  }

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
  const slicedByBoundary = spec ? stripLegacyComponentTags(withoutUiBlock) : withoutUiBlock;
  const text = sanitizeAssistantText(slicedByBoundary);
  if (!text) return '';
  if (!spec) return text;

  const parsed = parseJsonSafely<unknown>(text);
  if (parsed && typeof parsed === 'object') {
    return '';
  }

  const fencedJsonPattern = /```(?:json)?\s*[\s\S]*?\{[\s\S]*?"type"\s*:\s*"[^"]+"[\s\S]*?\}\s*```/g;
  const cleaned = sanitizeAssistantText(slicedByBoundary.replace(fencedJsonPattern, ''));
  if (!cleaned) return '';
  const normalizedSpec = normalizeUiSpecCandidate(spec);
  const specType = isRecordValue(normalizedSpec) && typeof normalizedSpec.type === 'string'
    ? normalizedSpec.type.trim().toLowerCase()
    : '';
  const shouldStripAssetMarkdown = new Set([
    'imagecover',
    'imagecarousel',
    'videocover',
    'videogallery',
    'audioplayer',
    'audioplaylist',
    'officepreviewcard',
    'markdownpreviewcard',
    'jobprogresscard',
  ]).has(specType);
  if (!shouldStripAssetMarkdown) {
    return cleaned;
  }
  const filtered = cleaned
    .replace(/!\[[^\]]*\]\((?:\/api\/uploads\/|\/api\/management\/|https?:\/\/)[^)]+\)/gi, '')
    .replace(/\[[^\]]*\]\((?:\/api\/uploads\/|\/api\/management\/|https?:\/\/)[^)]+\)/gi, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const normalizedLine = line.trim().toLowerCase();
      if (!normalizedLine) return false;
      if (normalizedLine.includes('/api/uploads/')) return false;
      if (normalizedLine.includes('/api/management/agents/')) return false;
      if (/^(图片地址|图片链接|视频地址|视频链接|文档地址|文件地址|下载地址|链接)\s*[:：]/i.test(normalizedLine)) return false;
      if (/^(音频在这|音频地址|语音地址)\s*[:：]/i.test(normalizedLine)) return false;
      return true;
    })
    .join('\n');
  const sanitizedFiltered = sanitizeAssistantText(filtered);
  if (specType !== 'jobprogresscard') {
    return sanitizedFiltered;
  }
  const nonEmptyLines = sanitizedFiltered
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines.length === 0) {
    return '';
  }
  const jobProgressBoilerplatePattern = /生成中|处理中|排队|提交|等待|出结果|回填|占位|源图|时长|内容|当前状态|查看|问安视频|状态[:：]|status\s*:|source\s+image|duration\s*:|queued|submitted|pending|processing|fill in|placeholder/i;
  const matchedBoilerplateLines = nonEmptyLines.filter((line) => jobProgressBoilerplatePattern.test(line)).length;
  if (matchedBoilerplateLines >= Math.max(1, Math.ceil(nonEmptyLines.length * 0.6))) {
    return '';
  }
  return sanitizedFiltered;
}

function isRenderableMarkdownAssetSource(value: string): boolean {
  const source = value.trim();
  if (!source) {
    return false;
  }
  return /^https?:\/\//i.test(source)
    || /^\/?api\/uploads\//i.test(source)
    || /^\/?api\/management\/agents\//i.test(source);
}

export function buildRenderableSpecFromMarkdownMedia(rawText: string): unknown | undefined {
  const text = unwrapResponseEnvelopeText(rawText).trim();
  if (!text) {
    return undefined;
  }

  const matches = Array.from(
    text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g),
  );
  const images = matches
    .map((match, index) => {
      const rawSrc = (match[2] || '').trim();
      if (!isRenderableMarkdownAssetSource(rawSrc)) {
        return null;
      }
      const alt = (match[1] || '').trim() || `图片 ${index + 1}`;
      return {
        src: rawSrc,
        alt,
        title: alt,
      };
    })
    .filter((item): item is { src: string; alt: string; title: string } => item != null);

  if (images.length === 0) {
    return undefined;
  }
  if (images.length === 1) {
    return {
      type: 'ImageCover',
      props: images[0],
    };
  }
  return {
    type: 'ImageCarousel',
    props: {
      images,
      title: '图片结果',
      showThumbs: true,
    },
  };
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

  const legacyComponents = extractLegacyComponentSpecs(segment);
  if (legacyComponents.specs.length > 0) {
    const mergedLegacy = mergeUiSpecs(legacyComponents.specs);
    if (mergedLegacy) {
      return mergedLegacy;
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
  const markdownMediaSpec = normalizeUiSpecCandidate(buildRenderableSpecFromMarkdownMedia(text));
  if (markdownMediaSpec) {
    return markdownMediaSpec;
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

function extractHiddenActionFromSpec<T>(spec: unknown, options: {
  isActionType: (value: unknown) => boolean;
  normalizePayload: (raw: unknown) => T | null;
}): {
  payload: T;
  strippedSpec: unknown | undefined;
} | null {
  let payload: T | null = null;

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
      if (!isRecordValue(element) || !options.isActionType(element.type)) {
        continue;
      }
      if (!payload) {
        payload = options.normalizePayload(element.props);
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

    if (options.isActionType(node.type)) {
      if (!payload) {
        payload = options.normalizePayload(node.props);
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

export function mergeRenderableUiSpecs(...specs: Array<unknown | undefined | null>): unknown | undefined {
  const normalized = specs
    .map((item) => normalizeIncomingSpec(item))
    .filter((item): item is unknown => item !== undefined);
  return mergeUiSpecs(normalized);
}

export function extractAgentSelfAppearanceActionFromSpec(spec: unknown): {
  payload: AgentSelfAppearanceActionPayload;
  strippedSpec: unknown | undefined;
} | null {
  return extractHiddenActionFromSpec(spec, {
    isActionType: isAgentSelfAppearanceActionType,
    normalizePayload: normalizeAgentSelfAppearanceActionPayload,
  });
}

export function extractComponentInvokeActionFromSpec(spec: unknown): {
  payload: ComponentInvokeActionPayload;
  strippedSpec: unknown | undefined;
} | null {
  return extractHiddenActionFromSpec(spec, {
    isActionType: isComponentInvokeActionType,
    normalizePayload: normalizeComponentInvokeActionPayload,
  });
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

function pickNestedToolResultPayload(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  return parseNestedToolPayload(payload.structured_result)
    || parseNestedToolPayload(payload.structuredResult)
    || parseNestedToolPayload(payload.result)
    || parseNestedToolPayload(payload.output)
    || parseNestedToolPayload(payload.response)
    || parseNestedToolPayload(payload.data);
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

function pickStringCandidates(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return pickStringArray(value);
}

function normalizeComponentInvokeItems(result: unknown): ComponentInvokeNormalizedItem[] {
  if (!isRecordValue(result) || !Array.isArray(result.items)) {
    return [];
  }
  return result.items
    .filter(isRecordValue)
    .map((item) => {
      const kind = typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
      const url = typeof item.url === 'string'
        ? item.url.trim()
        : typeof item.src === 'string'
          ? item.src.trim()
          : typeof item.path === 'string'
            ? item.path.trim()
            : '';
      const text = typeof item.text === 'string'
        ? item.text.trim()
        : typeof item.title === 'string'
          ? item.title.trim()
          : '';
      const mimeType = typeof item.mimeType === 'string'
        ? item.mimeType.trim()
        : typeof item.mime_type === 'string'
          ? item.mime_type.trim()
          : '';
      return {
        kind,
        url,
        text,
        mimeType,
      };
    })
    .filter((item) => item.url.length > 0);
}

function normalizeComponentInvokeResult(result: unknown): ManagementComponentInvokeResult | null {
  if (!isRecordValue(result)) {
    return null;
  }
  return {
    outputType: typeof result.outputType === 'string'
      ? result.outputType.trim()
      : typeof result.output_type === 'string'
        ? result.output_type.trim()
        : undefined,
    text: typeof result.text === 'string' ? result.text.trim() : undefined,
    items: normalizeComponentInvokeItems(result),
    raw: result.raw,
    presentableResult: isRecordValue(result.presentableResult)
      ? result.presentableResult
      : isRecordValue(result.presentable_result)
        ? result.presentable_result
        : undefined,
    providerMeta: isRecordValue(result.providerMeta)
      ? result.providerMeta
      : isRecordValue(result.provider_meta)
        ? result.provider_meta
        : undefined,
  };
}

function inferPresentableAssetKind(uri: string): string {
  const normalized = uri.trim().toLowerCase();
  if (!normalized) {
    return 'remote_url';
  }
  if (normalized.startsWith('data:')) {
    return 'data_url';
  }
  if (normalized.startsWith('/api/uploads/')) {
    return 'upload_url';
  }
  if (normalized.startsWith('/api/management/')) {
    return 'management_media_url';
  }
  if (/^https?:\/\//.test(normalized)) {
    return 'remote_url';
  }
  if (/^[a-z]:[\\/]/i.test(uri.trim()) || normalized.startsWith('file://') || normalized.startsWith('/')) {
    return 'absolute_file';
  }
  return 'workspace_file';
}

function inferFileNameFromUri(uri: string): string | undefined {
  const normalized = uri.trim();
  if (!normalized) {
    return undefined;
  }
  const withoutQuery = normalized.split(/[?#]/, 1)[0] || normalized;
  const segments = withoutQuery.split(/[\\/]/).filter(Boolean);
  const last = segments[segments.length - 1]?.trim();
  return last || undefined;
}

function buildPresentableAssetRef(
  uri: string,
  options?: {
    durationMs?: number;
    fileName?: string;
    metadata?: Record<string, unknown>;
    mimeType?: string;
  },
): Record<string, unknown> {
  const asset: Record<string, unknown> = {
    kind: inferPresentableAssetKind(uri),
    uri: uri.trim(),
  };
  if (options?.mimeType?.trim()) {
    asset.mimeType = options.mimeType.trim();
  }
  const fileName = options?.fileName?.trim() || inferFileNameFromUri(uri);
  if (fileName) {
    asset.fileName = fileName;
  }
  if (typeof options?.durationMs === 'number' && Number.isFinite(options.durationMs)) {
    asset.durationMs = Math.max(0, options.durationMs);
  }
  if (options?.metadata && Object.keys(options.metadata).length > 0) {
    asset.metadata = options.metadata;
  }
  return asset;
}

function pickFirstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function pickAssetUriCandidates(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => pickAssetUriCandidates(item));
  }
  if (!isRecordValue(value)) {
    return [];
  }
  return [
    ...pickStringCandidates(value.uri),
    ...pickStringCandidates(value.url),
    ...pickStringCandidates(value.src),
    ...pickStringCandidates(value.path),
    ...pickStringCandidates(value.file),
    ...pickStringCandidates(value.filePath),
    ...pickStringCandidates(value.assetUrl),
    ...pickStringCandidates(value.asset_url),
    ...pickStringCandidates(value.downloadUrl),
    ...pickStringCandidates(value.download_url),
  ];
}

function inferDocumentTypeFromUri(uri: string): string | undefined {
  const fileName = inferFileNameFromUri(uri)?.toLowerCase() || '';
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : '';
  if (!ext) {
    return undefined;
  }
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md', 'json'].includes(ext)) {
    return ext;
  }
  return undefined;
}

function inferDocumentTypeFromRecord(value: Record<string, unknown>): string {
  const explicit = pickFirstString(value.documentType, value.document_type, value.fileType, value.file_type, value.mimeType, value.mime_type);
  if (explicit) {
    const normalized = explicit.toLowerCase();
    if (normalized.includes('pdf')) return 'pdf';
    if (normalized.includes('docx')) return 'docx';
    if (normalized === 'doc' || normalized.includes('msword')) return 'doc';
    if (normalized.includes('xlsx')) return 'xlsx';
    if (normalized === 'xls') return 'xls';
    if (normalized.includes('csv')) return 'csv';
    if (normalized.includes('pptx')) return 'pptx';
    if (normalized === 'ppt') return 'ppt';
    if (normalized.includes('markdown') || normalized === 'md') return 'md';
    if (normalized.includes('json')) return 'json';
    if (normalized.includes('text') || normalized === 'txt') return 'txt';
    if (['compare', 'convert', 'unknown'].includes(normalized)) return normalized;
  }

  const candidates = [
    ...pickAssetUriCandidates(value.sourceAsset),
    ...pickAssetUriCandidates(value.source_asset),
    ...pickAssetUriCandidates(value.previewAsset),
    ...pickAssetUriCandidates(value.preview_asset),
    ...pickAssetUriCandidates(value.downloadAsset),
    ...pickAssetUriCandidates(value.download_asset),
    ...pickAssetUriCandidates(value.url),
    ...pickAssetUriCandidates(value.path),
    ...pickAssetUriCandidates(value.file),
  ];
  for (const candidate of candidates) {
    const detected = inferDocumentTypeFromUri(candidate);
    if (detected) {
      return detected;
    }
  }
  return 'unknown';
}

function extractReadableTextFromPresentableResult(result: unknown): string | undefined {
  if (!isRecordValue(result)) {
    return undefined;
  }
  const kind = typeof result.kind === 'string' ? result.kind.trim().toLowerCase() : '';
  if (kind === 'text_result') {
    return pickFirstString(result.markdown, result.text, result.summary, result.title);
  }
  if (kind === 'media_result') {
    const itemSummaries = Array.isArray(result.items)
      ? result.items
        .filter(isRecordValue)
        .map((item) => pickFirstString(item.transcript, item.caption, item.title))
        .filter((item): item is string => Boolean(item))
      : [];
    return pickFirstString(result.summary, ...itemSummaries, result.title);
  }
  if (kind === 'document_result') {
    return pickFirstString(result.summaryText, result.summary_text, result.summary, result.extractedText, result.extracted_text, result.title);
  }
  if (kind === 'patch_result' || kind === 'review_result' || kind === 'confirm_result') {
    return pickFirstString(result.summary, result.title) || buildDocumentPreviewMarkdown(result);
  }
  if (kind === 'error_result') {
    return pickFirstString(result.message, result.summary, result.title);
  }
  if (kind === 'job_result') {
    return pickFirstString(result.summary, result.title);
  }
  return pickFirstString(result.summary, result.title);
}

export function buildPresentableResultFromComponentInvokeResult(
  result: unknown,
  fallbackTitle = '组件结果',
  options?: { posterUrl?: string },
): Record<string, unknown> | undefined {
  const normalized = normalizeComponentInvokeResult(result);
  if (!normalized) {
    return undefined;
  }
  if (isRecordValue(normalized.presentableResult)) {
    return normalized.presentableResult;
  }

  const items = Array.isArray(normalized.items) ? normalized.items : [];
  const title = (normalized.text || fallbackTitle || '组件结果').trim().slice(0, 48) || '组件结果';
  const summary = normalized.text?.trim() || undefined;
  const providerMeta = isRecordValue(normalized.providerMeta) ? normalized.providerMeta : undefined;
  const images = items.filter((item) => item.kind === 'image' || (item.mimeType || '').startsWith('image/'));
  const preferredPosterUrl = options?.posterUrl?.trim() || images[0]?.url || undefined;
  const videos = items.filter((item) => item.kind === 'video' || (item.mimeType || '').startsWith('video/'));
  if (videos.length > 0) {
    return {
      kind: 'media_result',
      mediaType: 'video',
      title,
      ...(summary ? { summary } : {}),
      ...(providerMeta ? { providerMeta } : {}),
      items: videos
        .map((item, index) => {
          const assetUrl = item.url || '';
          if (!assetUrl) return null;
          return {
            mediaType: 'video',
            asset: buildPresentableAssetRef(assetUrl, {
              mimeType: item.mimeType || 'video/mp4',
              metadata: { source: 'component_invoke' },
            }),
            ...(preferredPosterUrl ? { posterAsset: buildPresentableAssetRef(preferredPosterUrl, { mimeType: 'image/png' }) } : {}),
            caption: item.text || `${title} ${index + 1}`,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    };
  }
  const audios = items.filter((item) => item.kind === 'audio' || (item.mimeType || '').startsWith('audio/'));
  if (audios.length > 0) {
    return {
      kind: 'media_result',
      mediaType: 'audio',
      title,
      ...(summary ? { summary } : {}),
      ...(providerMeta ? { providerMeta } : {}),
      items: audios
        .map((item, index) => {
          const assetUrl = item.url || '';
          if (!assetUrl) return null;
          return {
            mediaType: 'audio',
            asset: buildPresentableAssetRef(assetUrl, {
              mimeType: item.mimeType || 'audio/mpeg',
              metadata: { source: 'component_invoke' },
            }),
            caption: item.text || `${title} ${index + 1}`,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    };
  }
  if (images.length > 0) {
    return {
      kind: 'media_result',
      mediaType: 'image',
      title,
      ...(summary ? { summary } : {}),
      ...(providerMeta ? { providerMeta } : {}),
      items: images
        .map((item, index) => {
          const assetUrl = item.url || '';
          if (!assetUrl) return null;
          return {
            mediaType: 'image',
            asset: buildPresentableAssetRef(assetUrl, {
              mimeType: item.mimeType || 'image/png',
              metadata: { source: 'component_invoke' },
            }),
            caption: item.text || `${title} ${index + 1}`,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    };
  }

  if ((normalized.outputType || '').trim().toLowerCase() === 'text' && normalized.text) {
    return {
      kind: 'text_result',
      title,
      text: normalized.text,
      ...(providerMeta ? { providerMeta } : {}),
    };
  }

  return undefined;
}

function formatComponentInvokeKindLabel(kind: string): string {
  switch (kind) {
    case 'image':
      return '图片';
    case 'video':
      return '视频';
    case 'audio':
      return '音频';
    case 'text':
      return '文本';
    default:
      return kind || '结果';
  }
}

export function buildComponentInvokeSummaryText(
  componentName: string,
  result: unknown,
  options?: { includeUrls?: boolean },
): string | undefined {
  const normalized = normalizeComponentInvokeResult(result);
  if (!normalized) {
    return undefined;
  }
  const presentableResult = buildPresentableResultFromComponentInvokeResult(result, componentName);
  const presentableText = extractReadableTextFromPresentableResult(presentableResult);
  const items = Array.isArray(normalized.items) ? normalized.items : [];
  const lines: string[] = [];
  const header = componentName.trim() || '组件';
  const mediaItems = items.filter((item) => item.kind !== 'text');
  if (mediaItems.length > 0) {
    const counts = mediaItems.reduce<Record<string, number>>((acc, item) => {
      const key = item.kind || 'result';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts)
      .map(([kind, count]) => `${count} 个${formatComponentInvokeKindLabel(kind)}`)
      .join('，');
    if (summary) {
      lines.push(`组件 ${header} 已返回 ${summary}。`);
    }
  }
  if (presentableText) {
    lines.push(presentableText);
  } else if (normalized.text) {
    lines.push(normalized.text);
  }
  if (options?.includeUrls) {
    items.slice(0, 4).forEach((item, index) => {
      lines.push(`${index + 1}. ${formatComponentInvokeKindLabel(item.kind || 'file')}：${item.url}`);
      if (item.text) {
        lines.push(`- 说明：${item.text}`);
      }
    });
  }
  const joined = lines
    .map((line) => sanitizeAssistantText(line))
    .filter(Boolean)
    .join('\n')
    .trim();
  return joined || undefined;
}

export function buildRenderableSpecFromComponentInvokeResult(
  result: unknown,
  fallbackTitle = '组件结果',
  options?: { posterUrl?: string },
): unknown | undefined {
  const presentableResult = buildPresentableResultFromComponentInvokeResult(result, fallbackTitle, options);
  if (presentableResult) {
    return buildRenderableSpecFromPresentableResult(presentableResult);
  }
  const normalized = normalizeComponentInvokeResult(result);
  if (!normalized) {
    return undefined;
  }
  const items = Array.isArray(normalized.items) ? normalized.items : [];
  const title = (normalized.text || fallbackTitle || '组件结果').trim().slice(0, 48) || '组件结果';
  const images = items.filter((item) => item.kind === 'image' || (item.mimeType || '').startsWith('image/'));
  const preferredPosterUrl = options?.posterUrl?.trim() || images[0]?.url || undefined;
  const videos = items.filter((item) => item.kind === 'video' || (item.mimeType || '').startsWith('video/'));
  if (videos.length > 0) {
    const videoItems = videos.map((item, index) => ({
      src: item.url,
      poster: preferredPosterUrl,
      title: item.text || `${title} ${index + 1}`,
      description: normalized.text || undefined,
    }));
    if (videoItems.length === 1) {
      return {
        type: 'VideoCover',
        props: {
          src: videoItems[0].src,
          poster: videoItems[0].poster,
          title: videoItems[0].title,
          description: videoItems[0].description,
        },
      };
    }
    return {
      type: 'VideoGallery',
      props: {
        items: videoItems,
        title,
        compact: true,
      },
    };
  }
  const audios = items.filter((item) => item.kind === 'audio' || (item.mimeType || '').startsWith('audio/'));
  if (audios.length > 0) {
    const audioItems = audios.map((item, index) => ({
      src: item.url,
      title: item.text || `${title} ${index + 1}`,
      subtitle: normalized.text || undefined,
    }));
    if (audioItems.length === 1) {
      return {
        type: 'AudioPlayer',
        props: {
          src: audioItems[0].src,
          title: audioItems[0].title,
          subtitle: audioItems[0].subtitle,
        },
      };
    }
    return {
      type: 'AudioPlaylist',
      props: {
        items: audioItems,
        title,
        description: normalized.text || undefined,
        showQueue: true,
      },
    };
  }
  if (images.length > 0) {
    const imageItems = images.map((item, index) => ({
      src: item.url,
      alt: item.text || `${title} ${index + 1}`,
      title: item.text || `${title} ${index + 1}`,
      description: normalized.text || undefined,
    }));
    if (imageItems.length === 1) {
      return {
        type: 'ImageCover',
        props: {
          src: imageItems[0].src,
          alt: imageItems[0].alt,
          title: imageItems[0].title,
          description: imageItems[0].description,
        },
      };
    }
    return {
      type: 'ImageCarousel',
      props: {
        images: imageItems.map((item) => ({
          src: item.src,
          alt: item.alt,
          title: item.title,
          description: item.description,
        })),
        title,
        showThumbs: true,
      },
    };
  }

  return undefined;
}

function readPresentableAssetUrl(value: unknown): string | undefined {
  if (!isRecordValue(value)) {
    return undefined;
  }
  const direct = typeof value.uri === 'string' ? value.uri.trim() : '';
  if (direct) {
    return direct;
  }
  const metadata = isRecordValue(value.metadata) ? value.metadata : {};
  const fallbacks = [
    metadata.url,
    metadata.src,
    metadata.path,
    metadata.filePath,
  ];
  for (const candidate of fallbacks) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function readPresentableAssetMimeType(value: unknown): string | undefined {
  if (!isRecordValue(value)) {
    return undefined;
  }
  const direct = typeof value.mimeType === 'string' ? value.mimeType.trim() : '';
  if (direct) {
    return direct;
  }
  const metadata = isRecordValue(value.metadata) ? value.metadata : {};
  const fallbacks = [
    metadata.mimeType,
    metadata.mime_type,
    metadata.contentType,
    metadata.content_type,
  ];
  for (const candidate of fallbacks) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function looksLikePresentableAssetUrl(url: string | undefined, pattern: RegExp): boolean {
  if (!url) {
    return false;
  }
  const normalized = url.trim().toLowerCase();
  return pattern.test(normalized);
}

function isPresentableVideoAsset(value: unknown): boolean {
  const mimeType = readPresentableAssetMimeType(value)?.toLowerCase();
  if (mimeType?.startsWith('video/')) {
    return true;
  }
  return looksLikePresentableAssetUrl(
    readPresentableAssetUrl(value),
    /\.(mp4|webm|mov|m4v|avi|mkv|gif)(?:[?#].*)?$/,
  );
}

function isPresentableImageAsset(value: unknown): boolean {
  const mimeType = readPresentableAssetMimeType(value)?.toLowerCase();
  if (mimeType?.startsWith('image/')) {
    return true;
  }
  return looksLikePresentableAssetUrl(
    readPresentableAssetUrl(value),
    /\.(png|jpe?g|webp|gif|bmp|svg)(?:[?#].*)?$/,
  );
}

function readPresentableAssetName(value: unknown): string | undefined {
  if (!isRecordValue(value)) {
    return undefined;
  }
  const direct = typeof value.fileName === 'string' ? value.fileName.trim() : '';
  return direct || undefined;
}

function buildDocumentPreviewMarkdown(result: Record<string, unknown>): string {
  const lines: string[] = [];
  const summary = typeof result.summaryText === 'string'
    ? result.summaryText.trim()
    : typeof result.summary === 'string'
      ? result.summary.trim()
      : '';
  if (summary) {
    lines.push(summary);
  }
  const extractedText = typeof result.extractedText === 'string'
    ? result.extractedText.trim()
    : typeof result.extracted_text === 'string'
      ? result.extracted_text.trim()
      : '';
  if (extractedText) {
    lines.push('');
    lines.push('```text');
    lines.push(extractedText.slice(0, 2000));
    lines.push('```');
  }
  const compareDiff = isRecordValue(result.compareDiff)
    ? result.compareDiff
    : isRecordValue(result.compare_diff)
      ? result.compare_diff
      : null;
  if (compareDiff) {
    const markdown = typeof compareDiff.markdown === 'string' ? compareDiff.markdown.trim() : '';
    const diffSummary = typeof compareDiff.summary === 'string' ? compareDiff.summary.trim() : '';
    if (diffSummary) {
      lines.push('');
      lines.push(`差异摘要：${diffSummary}`);
    }
    if (markdown) {
      lines.push('');
      lines.push(markdown);
    }
  }
  const conversionOutputs = Array.isArray(result.conversionOutputs)
    ? result.conversionOutputs
    : Array.isArray(result.conversion_outputs)
      ? result.conversion_outputs
      : [];
  if (conversionOutputs.length > 0) {
    lines.push('');
    lines.push('转换产物：');
    conversionOutputs.forEach((item, index) => {
      if (!isRecordValue(item)) {
        return;
      }
      const format = typeof item.format === 'string' ? item.format.trim() : `output-${index + 1}`;
      const assetUrl = readPresentableAssetUrl(item.asset);
      if (assetUrl) {
        lines.push(`${index + 1}. [${format}](${assetUrl})`);
      } else {
        lines.push(`${index + 1}. ${format}`);
      }
    });
  }
  return lines.join('\n').trim();
}

function buildMediaPreviewMarkdown(
  result: Record<string, unknown>,
  mediaType: string,
  title: string,
): string {
  const lines: string[] = [];
  const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
  if (summary) {
    lines.push(summary);
  }
  const items = Array.isArray(result.items) ? result.items.filter(isRecordValue) : [];
  if (items.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`${title}资源：`);
    items.forEach((item, index) => {
      const assetUrl = readPresentableAssetUrl(item.asset);
      const label = typeof item.caption === 'string' && item.caption.trim()
        ? item.caption.trim()
        : typeof item.title === 'string' && item.title.trim()
          ? item.title.trim()
          : `${title} ${index + 1}`;
      const linePrefix = `${index + 1}. `;
      if (assetUrl) {
        lines.push(`${linePrefix}[${label}](${assetUrl})`);
        return;
      }
      const assetName = readPresentableAssetName(item.asset);
      if (assetName) {
        lines.push(`${linePrefix}${label} (${assetName})`);
        return;
      }
      lines.push(`${linePrefix}${label}`);
    });
  }
  if (lines.length === 0) {
    lines.push(`${mediaType} 结果已生成，但当前渲染器已降级为文本模式。`);
  }
  return lines.join('\n').trim();
}

function buildPlainTextFallbackCard(
  title: string,
  markdown: string,
  description?: string,
): unknown | undefined {
  const normalizedMarkdown = markdown.trim();
  if (!normalizedMarkdown) {
    return undefined;
  }
  return {
    type: 'MarkdownPreviewCard',
    props: {
      title,
      markdown: normalizedMarkdown,
      description,
    },
  };
}

function shouldUsePlainTextRenderer(
  binding: ManagementRendererBindingRecord | undefined,
): boolean {
  if (!binding) {
    return false;
  }
  return !binding.enabled || binding.renderer_key.trim().toLowerCase() === 'plain_text';
}

function pickJobResultNumber(result: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = result[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function pickJobPreviewUrlFromRecord(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined;
  }
  return pickFirstString(
    record.previewUrl,
    record.preview_url,
    record.poster,
    record.posterUrl,
    record.poster_url,
    record.cover,
    record.coverUrl,
    record.cover_url,
    record.thumbnail,
    record.thumbnailUrl,
    record.thumbnail_url,
    record.image,
    record.imageUrl,
    record.image_url,
    record.sourceImage,
    record.source_image,
    record.sourceVideo,
    record.source_video,
    record.src,
    record.url,
    record.path,
    record.autoInjectedVideoSourceUrl,
    record.auto_injected_video_source_url,
  );
}

function readJobPreviewUrl(result: Record<string, unknown>): string | undefined {
  const metadata = isRecordValue(result.metadata) ? result.metadata : undefined;
  const providerMeta = isRecordValue(result.providerMeta)
    ? result.providerMeta
    : isRecordValue(result.provider_meta)
      ? result.provider_meta
      : undefined;
  const resultPayload = isRecordValue(result.resultPayload)
    ? result.resultPayload
    : isRecordValue(result.result_payload)
      ? result.result_payload
      : undefined;
  const requestPayload = resultPayload && isRecordValue(resultPayload.request_payload)
    ? resultPayload.request_payload
    : resultPayload && isRecordValue(resultPayload.requestPayload)
      ? resultPayload.requestPayload
      : undefined;
  const inputPayload = resultPayload && isRecordValue(resultPayload.input_payload)
    ? resultPayload.input_payload
    : resultPayload && isRecordValue(resultPayload.inputPayload)
      ? resultPayload.inputPayload
      : undefined;

  return pickJobPreviewUrlFromRecord(metadata)
    || pickJobPreviewUrlFromRecord(providerMeta)
    || pickJobPreviewUrlFromRecord(requestPayload)
    || pickJobPreviewUrlFromRecord(inputPayload)
    || pickJobPreviewUrlFromRecord(resultPayload)
    || pickJobPreviewUrlFromRecord(result);
}

function buildJobResultMarkdown(result: Record<string, unknown>, title: string): string {
  const lines: string[] = [`# ${title}`];
  const status = pickFirstString(result.status, result.state);
  const summary = pickFirstString(result.summary, result.description);
  const stage = pickFirstString(result.stage, result.currentStage, result.current_stage);
  const jobType = pickFirstString(result.jobType, result.job_type, result.mediaType, result.media_type);
  const etaText = pickFirstString(result.etaText, result.eta_text, result.eta);
  const jobId = pickFirstString(result.jobId, result.job_id, result.id);
  const progress = pickJobResultNumber(result, 'progressPercent', 'progress_percent', 'progress', 'percent', 'value');

  if (summary) lines.push('', summary);
  if (status) lines.push('', `- 状态：${status}`);
  if (stage) lines.push(`- 阶段：${stage}`);
  if (typeof progress === 'number') lines.push(`- 进度：${Math.max(0, Math.min(100, Math.round(progress)))}%`);
  if (jobType) lines.push(`- 任务类型：${jobType}`);
  if (etaText) lines.push(`- 预计完成：${etaText}`);
  if (jobId) lines.push(`- 任务 ID：${jobId}`);

  if (Array.isArray(result.steps)) {
    const stepLines = result.steps
      .filter(isRecordValue)
      .map((step) => {
        const label = pickFirstString(step.label, step.title, step.name);
        if (!label) return undefined;
        const stepStatus = pickFirstString(step.status, step.state);
        return stepStatus ? `- ${label}：${stepStatus}` : `- ${label}`;
      })
      .filter((item): item is string => Boolean(item));
    if (stepLines.length > 0) {
      lines.push('', '## 步骤', ...stepLines);
    }
  }

  return lines.join('\n').trim();
}

export function buildRenderableSpecFromPresentableResult(
  result: unknown,
): unknown | undefined {
  if (!isRecordValue(result)) {
    return undefined;
  }
  const kind = typeof result.kind === 'string' ? result.kind.trim().toLowerCase() : '';
  const title = typeof result.title === 'string' && result.title.trim()
    ? result.title.trim()
    : typeof result.summary === 'string' && result.summary.trim()
      ? result.summary.trim().slice(0, 48)
      : '结果';

  if (kind === 'media_result') {
    const mediaType = typeof result.mediaType === 'string'
      ? result.mediaType.trim().toLowerCase()
      : typeof result.media_type === 'string'
        ? result.media_type.trim().toLowerCase()
        : '';
    const items = Array.isArray(result.items) ? result.items : [];
    const rendererBinding = resolveDesktopRendererBinding('media_result', { mediaType });
    if (shouldUsePlainTextRenderer(rendererBinding)) {
      return buildPlainTextFallbackCard(
        title,
        buildMediaPreviewMarkdown(result, mediaType || 'media', title),
        typeof result.summary === 'string' ? result.summary.trim() : undefined,
      );
    }
    const rendererKey = rendererBinding?.renderer_key.trim().toLowerCase() || '';
    if (mediaType === 'image') {
      const images = items
        .filter(isRecordValue)
        .map((item, index) => {
          const src = readPresentableAssetUrl(item.asset);
          if (!src) return null;
          const label = typeof item.caption === 'string' && item.caption.trim()
            ? item.caption.trim()
            : typeof item.title === 'string' && item.title.trim()
              ? item.title.trim()
              : `${title} ${index + 1}`;
          return {
            src,
            alt: label,
            title: label,
            description: typeof result.summary === 'string' ? result.summary.trim() : undefined,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (images.length === 1 && rendererKey !== 'imagecarousel' && rendererKey !== 'imagealbum') {
        return {
          type: 'ImageCover',
          props: images[0],
        };
      }
      if (images.length > 1) {
        return {
          type: 'ImageCarousel',
          props: {
            images,
            title,
            showThumbs: true,
          },
        };
      }
    }

    if (mediaType === 'video') {
      const normalizedItems = items.filter(isRecordValue);
      const posterCandidates = normalizedItems
        .flatMap((item) => {
          const explicitPoster = readPresentableAssetUrl(item.posterAsset);
          if (explicitPoster) {
            return [explicitPoster];
          }
          if (isPresentableImageAsset(item.asset)) {
            const imageAssetUrl = readPresentableAssetUrl(item.asset);
            return imageAssetUrl ? [imageAssetUrl] : [];
          }
          return [];
        });
      const videos = normalizedItems
        .filter((item) => isPresentableVideoAsset(item.asset))
        .map((item, index) => {
          const src = readPresentableAssetUrl(item.asset);
          if (!src) return null;
          return {
            src,
            poster: readPresentableAssetUrl(item.posterAsset) || posterCandidates[index] || posterCandidates[0],
            title: typeof item.caption === 'string' && item.caption.trim()
              ? item.caption.trim()
              : `${title} ${index + 1}`,
            description: typeof result.summary === 'string' ? result.summary.trim() : undefined,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (videos.length === 1 && rendererKey !== 'videogallery' && rendererKey !== 'videocarousel') {
        return {
          type: 'VideoCover',
          props: videos[0],
        };
      }
      if (videos.length > 1) {
        return {
          type: 'VideoGallery',
          props: {
            items: videos,
            title,
            compact: true,
          },
        };
      }
    }

    if (mediaType === 'audio') {
      const audios = items
        .filter(isRecordValue)
        .map((item, index) => {
          const src = readPresentableAssetUrl(item.asset);
          if (!src) return null;
          return {
            src,
            title: typeof item.caption === 'string' && item.caption.trim()
              ? item.caption.trim()
              : `${title} ${index + 1}`,
            subtitle: typeof result.summary === 'string' ? result.summary.trim() : undefined,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (audios.length === 1 && rendererKey !== 'audioplaylist') {
        return {
          type: 'AudioPlayer',
          props: audios[0],
        };
      }
      if (audios.length > 1) {
        return {
          type: 'AudioPlaylist',
          props: {
            items: audios,
            title,
            description: typeof result.summary === 'string' ? result.summary.trim() : undefined,
            showQueue: true,
          },
        };
      }
    }
  }

  if (kind === 'document_result') {
    const documentType = typeof result.documentType === 'string'
      ? result.documentType.trim().toLowerCase()
      : typeof result.document_type === 'string'
        ? result.document_type.trim().toLowerCase()
        : 'unknown';
    const rendererBinding = resolveDesktopRendererBinding('document_result', { documentType });
    const sourceAsset = readPresentableAssetUrl(result.previewAsset)
      ?? readPresentableAssetUrl(result.preview_asset)
      ?? readPresentableAssetUrl(result.downloadAsset)
      ?? readPresentableAssetUrl(result.download_asset)
      ?? readPresentableAssetUrl(result.sourceAsset)
      ?? readPresentableAssetUrl(result.source_asset);
    const fileName = readPresentableAssetName(result.sourceAsset)
      ?? readPresentableAssetName(result.source_asset)
      ?? title;
    const description = typeof result.summaryText === 'string'
      ? result.summaryText.trim()
      : typeof result.summary === 'string'
        ? result.summary.trim()
        : undefined;
    const markdown = buildDocumentPreviewMarkdown(result);

    if (shouldUsePlainTextRenderer(rendererBinding)) {
      return buildPlainTextFallbackCard(title, markdown || description || '', description);
    }

    const rendererKey = rendererBinding?.renderer_key.trim().toLowerCase() || '';

    if (
      rendererKey === 'officepreviewcard'
      && sourceAsset
    ) {
      return {
        type: 'OfficePreviewCard',
        props: {
          src: sourceAsset,
          fileName,
          fileType: documentType,
          title,
          description,
        },
      };
    }

    if (rendererKey === 'markdownpreviewcard') {
      if (markdown) {
        return {
          type: 'MarkdownPreviewCard',
          props: {
            title,
            markdown,
            description,
          },
        };
      }
    }

    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'].includes(documentType) && sourceAsset) {
      return {
        type: 'OfficePreviewCard',
        props: {
          src: sourceAsset,
          fileName,
          fileType: documentType,
          title,
          description,
        },
      };
    }

    if (['txt', 'md', 'json', 'compare', 'convert', 'unknown'].includes(documentType)) {
      if (markdown) {
        return {
          type: 'MarkdownPreviewCard',
          props: {
            title,
            markdown,
            description,
          },
        };
      }
    }
  }

  if (kind === 'review_result') {
    const rendererBinding = resolveDesktopRendererBinding('review_result');
    const markdown = buildDocumentPreviewMarkdown(result);
    if (shouldUsePlainTextRenderer(rendererBinding)) {
      return buildPlainTextFallbackCard(title, markdown, typeof result.summary === 'string' ? result.summary.trim() : undefined);
    }
    return {
      type: 'ReviewResultCard',
      props: {
        title,
        summary: pickFirstString(result.summary, result.description),
        targetScope: pickFirstString(result.targetScope, result.target_scope),
        riskLevel: pickFirstString(result.riskLevel, result.risk_level),
        reviewId: pickFirstString(result.reviewId, result.review_id),
        reason: pickFirstString(result.reason),
        requiresConfirmation: typeof result.requiresConfirmation === 'boolean'
          ? result.requiresConfirmation
          : typeof result.requires_confirmation === 'boolean'
            ? result.requires_confirmation
            : true,
        proposedChanges: Array.isArray(result.proposedChanges)
          ? result.proposedChanges
          : Array.isArray(result.proposed_changes)
            ? result.proposed_changes
            : [],
        confirmAction: pickFirstString(result.confirmAction, result.confirm_action),
        cancelAction: pickFirstString(result.cancelAction, result.cancel_action),
        confirmLabel: pickFirstString(result.confirmLabel, result.confirm_label),
        cancelLabel: pickFirstString(result.cancelLabel, result.cancel_label),
        payload: isRecordValue(result.payload) ? result.payload : undefined,
      },
    };
  }

  if (kind === 'confirm_result') {
    const rendererBinding = resolveDesktopRendererBinding('confirm_result');
    const markdown = buildDocumentPreviewMarkdown(result);
    if (shouldUsePlainTextRenderer(rendererBinding)) {
      return buildPlainTextFallbackCard(title, markdown, typeof result.summary === 'string' ? result.summary.trim() : undefined);
    }
    return {
      type: 'ConfirmResultCard',
      props: {
        title,
        summary: pickFirstString(result.summary, result.description),
        description: pickFirstString(result.description),
        riskLevel: pickFirstString(result.riskLevel, result.risk_level),
        confirmAction: pickFirstString(result.confirmAction, result.confirm_action),
        cancelAction: pickFirstString(result.cancelAction, result.cancel_action),
        confirmLabel: pickFirstString(result.confirmLabel, result.confirm_label),
        cancelLabel: pickFirstString(result.cancelLabel, result.cancel_label),
        payload: isRecordValue(result.payload) ? result.payload : undefined,
      },
    };
  }

  if (kind === 'patch_result') {
    const rendererBinding = resolveDesktopRendererBinding('patch_result');
    const markdown = buildDocumentPreviewMarkdown(result);
    if (shouldUsePlainTextRenderer(rendererBinding)) {
      return buildPlainTextFallbackCard(title, markdown, typeof result.summary === 'string' ? result.summary.trim() : undefined);
    }
    return {
      type: 'PatchResultCard',
      props: {
        title,
        summary: pickFirstString(result.summary, result.description),
        targetScope: pickFirstString(result.targetScope, result.target_scope),
        riskLevel: pickFirstString(result.riskLevel, result.risk_level),
        reviewId: pickFirstString(result.reviewId, result.review_id),
        appliedChanges: Array.isArray(result.appliedChanges)
          ? result.appliedChanges
          : Array.isArray(result.applied_changes)
            ? result.applied_changes
            : [],
      },
    };
  }

  if (kind === 'error_result') {
    const message = typeof result.message === 'string' ? result.message.trim() : '能力暂不可用';
    return {
      type: 'card',
      props: {
        title: title || '能力错误',
        content: message,
        footer: typeof result.code === 'string' && result.code.trim()
          ? `错误码：${result.code.trim()}`
          : '来源：presentable_result',
      },
    };
  }

  if (kind === 'job_result') {
    const rendererBinding = resolveDesktopRendererBinding('job_result');
    const summary = typeof result.summary === 'string' ? result.summary.trim() : undefined;
    const markdown = buildJobResultMarkdown(result, title);
    if (shouldUsePlainTextRenderer(rendererBinding)) {
      return buildPlainTextFallbackCard(title, markdown, summary);
    }
    const rendererKey = rendererBinding?.renderer_key.trim().toLowerCase() || '';
    const progress = pickJobResultNumber(result, 'progressPercent', 'progress_percent', 'progress', 'percent', 'value');
    const steps = Array.isArray(result.steps)
      ? result.steps
        .filter(isRecordValue)
        .map((step) => {
          const label = pickFirstString(step.label, step.title, step.name);
          if (!label) return null;
          const stepStatus = pickFirstString(step.status, step.state);
          return {
            label,
            ...(stepStatus ? { status: stepStatus } : {}),
          };
        })
        .filter((step): step is { label: string; status?: string } => Boolean(step))
      : [];
    if (rendererKey === 'jobprogresscard' || !rendererKey) {
      const previewUrl = readJobPreviewUrl(result);
      return {
        type: 'JobProgressCard',
        props: {
          title,
          ...(summary ? { summary } : {}),
          ...(pickFirstString(result.status, result.state) ? { status: pickFirstString(result.status, result.state) } : {}),
          ...(pickFirstString(result.stage, result.currentStage, result.current_stage) ? { stage: pickFirstString(result.stage, result.currentStage, result.current_stage) } : {}),
          ...(pickFirstString(result.jobType, result.job_type, result.mediaType, result.media_type) ? { jobType: pickFirstString(result.jobType, result.job_type, result.mediaType, result.media_type) } : {}),
          ...(pickFirstString(result.etaText, result.eta_text, result.eta) ? { etaText: pickFirstString(result.etaText, result.eta_text, result.eta) } : {}),
          ...(pickFirstString(result.jobId, result.job_id, result.id) ? { jobId: pickFirstString(result.jobId, result.job_id, result.id) } : {}),
          ...(pickFirstString(result.capabilityKey, result.capability_key) ? { capabilityKey: pickFirstString(result.capabilityKey, result.capability_key) } : {}),
          ...(pickFirstString(result.capabilityScope, result.capability_scope) ? { capabilityScope: pickFirstString(result.capabilityScope, result.capability_scope) } : {}),
          ...(pickFirstString(result.providerId, result.provider_id) ? { providerId: pickFirstString(result.providerId, result.provider_id) } : {}),
          ...(pickFirstString(result.providerType, result.provider_type) ? { providerType: pickFirstString(result.providerType, result.provider_type) } : {}),
          ...(pickFirstString(result.route) ? { route: pickFirstString(result.route) } : {}),
          ...(typeof result.metadata === 'object' && result.metadata !== null ? { metadata: result.metadata } : {}),
          ...(typeof result.resultPayload === 'object' && result.resultPayload !== null
            ? { resultPayload: result.resultPayload }
            : typeof result.result_payload === 'object' && result.result_payload !== null
              ? { resultPayload: result.result_payload }
              : {}),
          ...(previewUrl ? { previewUrl } : {}),
          ...(typeof progress === 'number' ? { progressPercent: progress } : {}),
          ...(steps.length > 0 ? { steps } : {}),
        },
      };
    }
    return buildPlainTextFallbackCard(title, markdown, summary);
  }

  if (kind === 'text_result') {
    const markdown = typeof result.markdown === 'string' ? result.markdown.trim() : '';
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    if (markdown || text) {
      return {
        type: 'MarkdownPreviewCard',
        props: {
          title,
          markdown: markdown || text,
          description: typeof result.summary === 'string' ? result.summary.trim() : undefined,
        },
      };
    }
  }

  return undefined;
}

function buildComponentInvokeFallbackSpec(payload: Record<string, unknown>): unknown | undefined {
  if (getToolNameFromLogPayload(payload).toLowerCase() !== 'component_invoke' || payload.is_error === true) {
    return undefined;
  }
  const componentName = typeof payload.component_name === 'string'
    ? payload.component_name.trim()
    : typeof payload.componentName === 'string'
      ? payload.componentName.trim()
      : '组件';
  const resultPayload = pickNestedToolResultPayload(payload) || payload.result;
  const title = typeof payload.summary === 'string' && payload.summary.trim()
    ? payload.summary.trim()
    : componentName;
  return buildRenderableSpecFromComponentInvokeResult(resultPayload, title);
}

function buildImagePresentableResult(payload: Record<string, unknown>, toolName: string): Record<string, unknown> | undefined {
  const resultPayload = pickNestedToolResultPayload(payload) || payload;
  const imageUrls = pickStringArray(resultPayload.image_urls ?? resultPayload.imageUrls);
  const savedPaths = pickStringArray(resultPayload.saved_to ?? resultPayload.savedTo);
  const sources = imageUrls.length > 0 ? imageUrls : savedPaths;
  if (sources.length === 0) {
    return undefined;
  }

  const model = pickFirstString(resultPayload.model, resultPayload.engine, resultPayload.provider);
  const prompt = parseNestedToolPayload(payload.input)?.prompt;
  const title = typeof prompt === 'string' && prompt.trim()
    ? prompt.trim().slice(0, 48)
    : toolName === 'image_edit' || toolName === 'my_photo_edit'
      ? '图片修改结果'
      : toolName === 'my_photo_generate'
        ? '自我照片生成结果'
        : '图片生成结果';

  return {
    kind: 'media_result',
    mediaType: 'image',
    title,
    ...(model ? { summary: model } : {}),
    items: sources.map((src, index) => ({
      mediaType: 'image',
      asset: buildPresentableAssetRef(src, {
        mimeType: 'image/png',
        metadata: {
          tool: toolName,
          source: imageUrls.includes(src) ? 'url' : 'saved_path',
        },
      }),
      caption: `${title} ${index + 1}`,
    })),
  };
}

function buildVideoPresentableResult(payload: Record<string, unknown>, toolName: string): Record<string, unknown> | undefined {
  const resultPayload = pickNestedToolResultPayload(payload) || payload;
  const videoUrls = pickStringArray(resultPayload.video_urls ?? resultPayload.videoUrls);
  const savedPaths = pickStringArray(resultPayload.saved_to ?? resultPayload.savedTo);
  const posterUrls = pickStringArray(resultPayload.poster_urls ?? resultPayload.posterUrls);
  const sources = videoUrls.length > 0 ? videoUrls : savedPaths;
  const inputPayload = parseNestedToolPayload(payload.input);
  const prompt = typeof inputPayload?.prompt === 'string' ? inputPayload.prompt.trim() : '';
  const title = prompt
    ? prompt.slice(0, 48)
    : toolName === 'video_edit'
      ? '视频编辑结果'
      : '视频生成结果';
  if (sources.length === 0) {
    return buildPresentableResultFromComponentInvokeResult(resultPayload, title, {
      posterUrl: posterUrls[0],
    });
  }
  const summary = pickFirstString(
    resultPayload.summary,
    resultPayload.model,
    resultPayload.provider,
    resultPayload.route,
  );
  const providerMeta = isRecordValue(resultPayload.provider_meta)
    ? resultPayload.provider_meta
    : isRecordValue(resultPayload.providerMeta)
      ? resultPayload.providerMeta
      : undefined;
  return {
    kind: 'media_result',
    mediaType: 'video',
    title,
    ...(summary ? { summary } : {}),
    ...(providerMeta ? { providerMeta } : {}),
    items: sources.map((src, index) => ({
      mediaType: 'video',
      asset: buildPresentableAssetRef(src, {
        mimeType: 'video/mp4',
        metadata: {
          tool: toolName,
          source: videoUrls.includes(src) ? 'url' : 'saved_path',
        },
      }),
      ...(posterUrls[index] || posterUrls[0]
        ? {
          posterAsset: buildPresentableAssetRef(posterUrls[index] || posterUrls[0], {
            mimeType: 'image/png',
            metadata: { tool: toolName, source: 'poster' },
          }),
        }
        : {}),
      caption: sources.length === 1 ? title : `${title} ${index + 1}`,
    })),
  };
}

function buildTextToSpeechPresentableResult(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const resultPayload = pickNestedToolResultPayload(payload) || payload;
  const sources = [
    ...pickStringCandidates(resultPayload.asset_url ?? resultPayload.assetUrl),
    ...pickStringCandidates(resultPayload.saved_to ?? resultPayload.savedTo),
  ];
  const uniqueSources = Array.from(new Set(sources));
  if (uniqueSources.length === 0) {
    return undefined;
  }

  const inputPayload = parseNestedToolPayload(payload.input);
  const rawText = typeof inputPayload?.text === 'string'
    ? inputPayload.text.trim()
    : typeof resultPayload.requested_text === 'string'
      ? resultPayload.requested_text.trim()
      : '';
  const title = rawText
    ? `语音: ${rawText.slice(0, 32)}${rawText.length > 32 ? '…' : ''}`
    : '语音合成结果';
  const engine = pickFirstString(resultPayload.engine, resultPayload.provider, resultPayload.device);
  const durationEstimateMs = typeof resultPayload.duration_estimate_ms === 'number'
    ? resultPayload.duration_estimate_ms
    : typeof resultPayload.durationEstimateMs === 'number'
      ? resultPayload.durationEstimateMs
      : typeof resultPayload.duration_secs === 'number'
        ? resultPayload.duration_secs * 1000
        : typeof resultPayload.durationSecs === 'number'
          ? resultPayload.durationSecs * 1000
          : undefined;

  return {
    kind: 'media_result',
    mediaType: 'audio',
    title,
    ...(engine ? { summary: engine } : {}),
    items: uniqueSources.map((src, index) => ({
      mediaType: 'audio',
      asset: buildPresentableAssetRef(src, {
        mimeType: 'audio/mpeg',
        durationMs: durationEstimateMs,
        metadata: { tool: 'text_to_speech' },
      }),
      caption: uniqueSources.length === 1 ? title : `${title} ${index + 1}`,
      ...(rawText ? { transcript: rawText } : {}),
      ...(typeof durationEstimateMs === 'number' ? { durationMs: durationEstimateMs } : {}),
    })),
  };
}

function buildSpeechToTextPresentableResult(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const resultPayload = pickNestedToolResultPayload(payload) || payload;
  const transcript = pickFirstString(resultPayload.transcript, resultPayload.text, resultPayload.content, resultPayload.output);
  if (!transcript) {
    return undefined;
  }
  const summary = [pickFirstString(resultPayload.provider), pickFirstString(resultPayload.model)]
    .filter(Boolean)
    .join(' · ');
  const sourceAsset = isRecordValue(resultPayload.sourceAsset)
    ? resultPayload.sourceAsset
    : isRecordValue(resultPayload.source_asset)
      ? resultPayload.source_asset
      : undefined;
  return {
    kind: 'text_result',
    title: '语音转文本结果',
    text: transcript,
    ...(summary ? { summary } : {}),
    ...(sourceAsset
      ? {
        metadata: {
          sourceAsset,
        },
      }
      : {}),
  };
}

function buildMediaDescribePresentableResult(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const resultPayload = pickNestedToolResultPayload(payload) || payload;
  const text = extractReadableText(resultPayload);
  if (!text) {
    return undefined;
  }
  const mediaType = pickFirstString(resultPayload.mediaType, resultPayload.media_type)?.toLowerCase() || 'media';
  const title = mediaType === 'image'
    ? '图片理解结果'
    : mediaType === 'audio'
      ? '音频理解结果'
      : mediaType === 'video'
        ? '视频理解结果'
        : '媒体理解结果';
  const sourceAsset = isRecordValue(resultPayload.sourceAsset)
    ? resultPayload.sourceAsset
    : isRecordValue(resultPayload.source_asset)
      ? resultPayload.source_asset
      : undefined;
  return {
    kind: 'text_result',
    title,
    text,
    ...(pickFirstString(resultPayload.provider, resultPayload.model) ? { summary: pickFirstString(resultPayload.provider, resultPayload.model) } : {}),
    ...(sourceAsset
      ? {
        metadata: {
          sourceAsset,
          mediaType,
        },
      }
      : {}),
  };
}

function buildDocumentPresentableResult(payload: Record<string, unknown>, toolName: string): Record<string, unknown> | undefined {
  const resultPayload = pickNestedToolResultPayload(payload) || payload;
  const inputPayload = parseNestedToolPayload(payload.input);
  const sourceUri = pickFirstString(
    ...pickAssetUriCandidates(resultPayload.sourceAsset),
    ...pickAssetUriCandidates(resultPayload.source_asset),
    ...pickAssetUriCandidates(resultPayload.document),
    ...pickAssetUriCandidates(resultPayload.file),
    ...pickAssetUriCandidates(resultPayload.path),
    ...pickAssetUriCandidates(resultPayload.url),
    ...pickAssetUriCandidates(inputPayload?.file),
    ...pickAssetUriCandidates(inputPayload?.path),
    ...pickAssetUriCandidates(inputPayload?.url),
  );
  const previewUri = pickFirstString(
    ...pickAssetUriCandidates(resultPayload.previewAsset),
    ...pickAssetUriCandidates(resultPayload.preview_asset),
    ...pickAssetUriCandidates(resultPayload.previewUrl),
    ...pickAssetUriCandidates(resultPayload.preview_url),
  );
  const downloadUri = pickFirstString(
    ...pickAssetUriCandidates(resultPayload.downloadAsset),
    ...pickAssetUriCandidates(resultPayload.download_asset),
    ...pickAssetUriCandidates(resultPayload.downloadUrl),
    ...pickAssetUriCandidates(resultPayload.download_url),
    ...pickAssetUriCandidates(resultPayload.outputFile),
    ...pickAssetUriCandidates(resultPayload.output_file),
  );
  const documentType = toolName === 'document_compare'
    ? 'compare'
    : toolName === 'document_convert'
      ? 'convert'
      : inferDocumentTypeFromRecord(resultPayload);
  const summaryText = pickFirstString(resultPayload.summaryText, resultPayload.summary_text, resultPayload.summary, resultPayload.description);
  const extractedText = pickFirstString(resultPayload.extractedText, resultPayload.extracted_text, resultPayload.text, resultPayload.content);
  const compareDiff = isRecordValue(resultPayload.compareDiff)
    ? resultPayload.compareDiff
    : isRecordValue(resultPayload.compare_diff)
      ? resultPayload.compare_diff
      : undefined;
  const rawConversionOutputs = Array.isArray(resultPayload.conversionOutputs)
    ? resultPayload.conversionOutputs
    : Array.isArray(resultPayload.conversion_outputs)
      ? resultPayload.conversion_outputs
      : [];
  const conversionOutputs = rawConversionOutputs
    .filter(isRecordValue)
    .map((item, index) => {
      const assetUri = pickFirstString(
        ...pickAssetUriCandidates(item.asset),
        ...pickAssetUriCandidates(item.url),
        ...pickAssetUriCandidates(item.path),
        ...pickAssetUriCandidates(item.downloadUrl),
      );
      if (!assetUri) {
        return null;
      }
      const format = pickFirstString(item.format, item.type, item.label) || `output-${index + 1}`;
      return {
        format,
        asset: buildPresentableAssetRef(assetUri, {
          mimeType: pickFirstString(item.mimeType, item.mime_type),
          fileName: pickFirstString(item.fileName, item.file_name),
        }),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!sourceUri && !previewUri && !downloadUri && !summaryText && !extractedText && !compareDiff && conversionOutputs.length === 0) {
    return undefined;
  }

  const title = pickFirstString(resultPayload.title, resultPayload.fileName, resultPayload.file_name)
    || (toolName === 'document_compare'
      ? '文档对比结果'
      : toolName === 'document_convert'
        ? '文档转换结果'
        : toolName === 'document_preview'
          ? '文档预览结果'
          : '文档处理结果');
  const bestSourceUri = sourceUri || previewUri || downloadUri || '';
  const sourceAsset = bestSourceUri
    ? buildPresentableAssetRef(bestSourceUri, {
      mimeType: pickFirstString(resultPayload.mimeType, resultPayload.mime_type),
      fileName: pickFirstString(resultPayload.fileName, resultPayload.file_name),
    })
    : undefined;

  return {
    kind: 'document_result',
    title,
    documentType,
    ...(sourceAsset ? { sourceAsset } : {}),
    ...(previewUri ? { previewAsset: buildPresentableAssetRef(previewUri) } : {}),
    ...(downloadUri ? { downloadAsset: buildPresentableAssetRef(downloadUri) } : {}),
    ...(typeof resultPayload.pageCount === 'number' ? { pageCount: resultPayload.pageCount } : typeof resultPayload.page_count === 'number' ? { pageCount: resultPayload.page_count } : {}),
    ...(summaryText ? { summaryText } : {}),
    ...(extractedText ? { extractedText } : {}),
    ...(compareDiff ? { compareDiff } : {}),
    ...(conversionOutputs.length > 0 ? { conversionOutputs } : {}),
  };
}

export function buildPresentableResultFromToolLog(raw: string): Record<string, unknown> | undefined {
  const payload = parseToolLogPayload(raw);
  if (!payload) {
    return undefined;
  }
  if (isRecordValue(payload.presentableResult)) {
    return payload.presentableResult;
  }
  if (isRecordValue(payload.presentable_result)) {
    return payload.presentable_result;
  }
  if (isRecordValue(payload.jobResult)) {
    return payload.jobResult;
  }
  if (isRecordValue(payload.job_result)) {
    return payload.job_result;
  }
  const nestedResult = pickNestedToolResultPayload(payload);
  if (isRecordValue(nestedResult?.presentableResult)) {
    return nestedResult.presentableResult;
  }
  if (isRecordValue(nestedResult?.presentable_result)) {
    return nestedResult.presentable_result;
  }
  if (isRecordValue(nestedResult?.jobResult)) {
    return nestedResult.jobResult;
  }
  if (isRecordValue(nestedResult?.job_result)) {
    return nestedResult.job_result;
  }
  if (isRecordValue(nestedResult) && typeof nestedResult.kind === 'string') {
    return nestedResult;
  }

  const toolName = getToolNameFromLogPayload(payload).toLowerCase();
  if (payload.is_error === true) {
    const message = extractReadableText(pickNestedToolResultPayload(payload) || payload);
    if (!message) {
      return undefined;
    }
    return {
      kind: 'error_result',
      title: toolName || '工具错误',
      code: `${toolName || 'tool'}_failed`,
      message,
    };
  }

  switch (toolName) {
    case 'image_generate':
    case 'image_edit':
    case 'my_photo_generate':
    case 'my_photo_edit':
      return buildImagePresentableResult(payload, toolName);
    case 'video_generate':
    case 'video_edit':
      return buildVideoPresentableResult(payload, toolName);
    case 'text_to_speech':
      return buildTextToSpeechPresentableResult(payload);
    case 'speech_to_text':
      return buildSpeechToTextPresentableResult(payload);
    case 'media_describe':
      return buildMediaDescribePresentableResult(payload);
    case 'component_invoke': {
      const componentName = pickFirstString(payload.component_name, payload.componentName) || '组件';
      const title = pickFirstString(payload.summary) || componentName;
      return buildPresentableResultFromComponentInvokeResult(
        pickNestedToolResultPayload(payload) ?? payload.result,
        title,
      );
    }
    case 'document_parse':
    case 'document_extract':
    case 'document_summarize':
    case 'document_convert':
    case 'document_compare':
    case 'document_preview':
    case 'document_chunk':
      return buildDocumentPresentableResult(payload, toolName);
    default:
      return undefined;
  }
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
  const presentableResult = buildPresentableResultFromToolLog(raw);
  const presentableText = extractReadableTextFromPresentableResult(presentableResult);
  if (presentableText) {
    return presentableText.slice(0, 2400);
  }
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

  const resultPayload = pickNestedToolResultPayload(payload) || payload;
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

function buildTextToSpeechFallbackSpec(payload: Record<string, unknown>): unknown | undefined {
  const toolName = getToolNameFromLogPayload(payload).toLowerCase();
  if (toolName !== 'text_to_speech' || payload.is_error === true) {
    return undefined;
  }

  const resultPayload = pickNestedToolResultPayload(payload) || payload;
  const sources = [
    ...pickStringCandidates(resultPayload.asset_url ?? resultPayload.assetUrl),
    ...pickStringCandidates(resultPayload.saved_to ?? resultPayload.savedTo),
  ];
  const uniqueSources = Array.from(new Set(sources));
  if (uniqueSources.length === 0) {
    return undefined;
  }

  const inputPayload = parseNestedToolPayload(payload.input);
  const rawText = typeof inputPayload?.text === 'string'
    ? inputPayload.text.trim()
    : typeof resultPayload.requested_text === 'string'
      ? resultPayload.requested_text.trim()
      : '';
  const title = rawText
    ? `语音: ${rawText.slice(0, 32)}${rawText.length > 32 ? '…' : ''}`
    : '语音合成结果';
  const engine = typeof resultPayload.engine === 'string' ? resultPayload.engine.trim() : '';
  const provider = typeof resultPayload.provider === 'string' ? resultPayload.provider.trim() : '';
  const device = typeof resultPayload.device === 'string' ? resultPayload.device.trim() : '';
  const subtitle = [engine, provider, device].filter(Boolean).join(' · ') || undefined;
  const durationEstimateMs = typeof resultPayload.duration_estimate_ms === 'number'
    ? resultPayload.duration_estimate_ms
    : typeof resultPayload.durationEstimateMs === 'number'
      ? resultPayload.durationEstimateMs
      : typeof resultPayload.duration_secs === 'number'
        ? resultPayload.duration_secs * 1000
        : typeof resultPayload.durationSecs === 'number'
          ? resultPayload.durationSecs * 1000
          : undefined;
  const durationSeconds = typeof durationEstimateMs === 'number' && Number.isFinite(durationEstimateMs)
    ? Math.max(0, durationEstimateMs / 1000)
    : undefined;

  if (uniqueSources.length === 1) {
    return {
      type: 'AudioPlayer',
      props: {
        src: uniqueSources[0],
        title,
        subtitle,
        duration: durationSeconds,
      },
    };
  }

  return {
    type: 'AudioPlaylist',
    props: {
      items: uniqueSources.map((src, index) => ({
        src,
        title: `${title} ${index + 1}`,
        subtitle,
        duration: durationSeconds,
      })),
      title,
      description: subtitle,
      showQueue: true,
    },
  };
}

export function buildRenderableSpecFromToolLog(raw: string): unknown | undefined {
  const presentableResult = buildPresentableResultFromToolLog(raw);
  if (presentableResult) {
    return buildRenderableSpecFromPresentableResult(presentableResult);
  }
  const payload = parseToolLogPayload(raw);
  if (!payload) {
    return undefined;
  }
  return buildTextToSpeechFallbackSpec(payload)
    ?? buildImageFallbackSpec(payload)
    ?? buildComponentInvokeFallbackSpec(payload);
}

export function buildFallbackSpecFromToolTrace(rows: MessageTrace[] | undefined): unknown | undefined {
  if (!rows || rows.length === 0) return undefined;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const detail = (rows[index]?.detail || '').trim();
    if (!detail) {
      continue;
    }
    const renderableSpec = buildRenderableSpecFromToolLog(detail);
    if (renderableSpec != null) {
      return renderableSpec;
    }
  }

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
  const payloadToolName = getToolNameFromLogPayload(payload);
  const readable = extractReadableTextFromLog(detail);

  const queryMatch = detail.match(/(?:^|\n)\s*query\s*:\s*(.+)$/im);
  const toolMatch = detail.match(/<(?:[a-z0-9_.-]+:)?tool_call>\s*=?\s*([^\n\r]+)/i);

  const query = queryMatch?.[1]?.trim();
  const toolName = toolMatch?.[1]?.trim() || payloadToolName;
  if (toolName.toLowerCase() === 'memory_recall') {
    return undefined;
  }
  const fallbackDetail = hasMeaningfulToolLogContent(payload || {})
    ? detail.replace(TOOL_CALL_OPEN_WITH_CONTENT_PATTERN, '').replace(TOOL_CALL_TAG_PATTERN, '').trim()
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
  if (/^<(?:[a-z0-9_.-]+:)?tool_call\b/im.test(normalized)) return true;
  if (/^```(?:json)?[\s\S]*```$/i.test(normalized) && /"type"\s*:|"root"\s*:/i.test(normalized)) return true;
  if (/^\{[\s\S]*\}$/i.test(normalized) && /"type"\s*:|"root"\s*:/i.test(normalized)) return true;
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0 && lines.every((line) => /^(query|tool|args?|name|id|type)\s*:/i.test(line))) {
    return true;
  }
  return false;
}
