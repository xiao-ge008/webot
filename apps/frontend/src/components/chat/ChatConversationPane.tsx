import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import {
  PanelLeft,
  PanelRight,
  Send,
  Square,
  Loader2,
  ChevronDown,
  Image as ImageIcon,
  Paperclip,
  X,
  Copy,
  Check,
  Zap,
  Clock3,
  Trash2,
  ListChecks,
  Gauge,
  Volume2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isHiddenSystemPromptText } from '@/lib/chat-message-filter';
import {
  cleanupAssistantText,
  containsUiJsonTag,
  extractAgentSelfAppearanceActionFromSpec,
  extractComponentInvokeActionFromSpec,
  extractUiRawText,
  getBestEffortUiJsonBlocks,
  looksLikeProtocolOnlyText,
  normalizeIncomingSpec,
  parseJsonSafely,
  repairUiJsonString,
  sanitizeAiUiOutput,
} from '@/components/chat/chat-page-helpers';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { ChatAttachmentDeck } from '@/components/chat/ChatAttachmentDeck';
import { GenUIAudioPlayer } from '@/components/chat/BuiltinAudioComponents';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Agent } from '@/types';
import type { ChatAttachment, Message, MessageToolCall, MessageTrace } from '@/data/mock-chats';
import type { ChatTaskCardData, ChatTaskLifecycleItem } from '@/types/chat-task';
import type { A2AWorkCardData } from '@/types/a2a';
import type { AgentTtsSynthesisResult } from '@/types/tts';
import { DynamicUIRenderer } from '@/components/chat/DynamicUIRenderer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { uploadManagementAgentChatAsset } from '@/services/management-client';
import { getTtsStatus, synthesizeAgentTts } from '@/services/tts-client';
import { useGlobalAlert } from '@/providers/GlobalAlertProvider';
import { canOpenAttachmentWithSystem, isDesktopFileOpenSupported, openAttachmentWithSystem } from '@/services/desktop-file-client';
import { getApiBaseUrl } from '@/services/transport';

type UserActivitySource = 'input' | 'send' | 'focus' | 'keydown' | 'ui_action';

const WEB_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const APP_FILE_MAX_BYTES = 32 * 1024 * 1024;
const A2A_PLACEHOLDER_AGENT_ID = 'unknown-agent';
const A2A_PLACEHOLDER_AGENT_NAME = '子智能体';
const CLIPBOARD_IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};

const LOCAL_MANAGEMENT_ASSET_URL_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/api\/management\/agents\/.+)$/i;

function buildStableChatAttachmentAssetUrl(baseUrl: string | undefined, agentId: string | undefined, relativePath: string): string | undefined {
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, '');
  const normalizedAgentId = agentId?.trim();
  const normalizedPath = relativePath.trim();
  if (!normalizedBaseUrl || !normalizedAgentId || !normalizedPath) {
    return undefined;
  }
  const searchParams = new URLSearchParams({ path: normalizedPath });
  return `${normalizedBaseUrl}/api/management/agents/${encodeURIComponent(normalizedAgentId)}/chat-assets/file?${searchParams.toString()}`;
}

function normalizeLocalManagementAssetUrl(baseUrl: string | undefined, assetUrl: string | undefined): string | undefined {
  const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, '');
  const normalizedAssetUrl = assetUrl?.trim();
  if (!normalizedBaseUrl || !normalizedAssetUrl) {
    return normalizedAssetUrl;
  }
  const localMatch = normalizedAssetUrl.match(LOCAL_MANAGEMENT_ASSET_URL_PATTERN);
  if (localMatch) {
    return `${normalizedBaseUrl}${localMatch[1]}`;
  }
  if (normalizedAssetUrl.startsWith('/api/management/')) {
    return `${normalizedBaseUrl}${normalizedAssetUrl}`;
  }
  return normalizedAssetUrl;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)));
}

const WATCHDOG_WARNING_TEXT = '响应较慢，仍在等待。';

function getVisibleMessageMeta(meta?: string): string {
  if (!meta) return '';
  return meta
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== WATCHDOG_WARNING_TEXT)
    .join('\n');
}

function normalizeLogText(value: string): string {
  return value.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

function clampLogText(value: string, maxLength = 180): string {
  const normalized = normalizeLogText(value);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function asLogRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function pickLogString(record: Record<string, unknown> | null, ...keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function pickLogBoolean(record: Record<string, unknown> | null, ...keys: string[]): boolean | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function pickLogStringArray(record: Record<string, unknown> | null, ...keys: string[]): string[] {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function summarizeToolDetail(title: string, detail?: string): string | undefined {
  const normalizedDetail = detail?.trim();
  if (!normalizedDetail) {
    return undefined;
  }
  const normalizedTitle = title.trim().toLowerCase();
  const parsed = parseJsonSafely<unknown>(normalizedDetail);
  if (parsed && typeof parsed === 'object') {
    const record = asLogRecord(parsed);
    const tool = pickLogString(record, 'tool', 'name', 'tool_name');
    const input = asLogRecord(record?.input);
    const prompt = pickLogString(input, 'prompt');
    const model = pickLogString(input, 'model');
    const provider = pickLogString(input, 'provider');
    const route = pickLogString(record, 'route');
    const providerId = pickLogString(record, 'provider_id', 'providerId');
    const providerType = pickLogString(record, 'provider_type', 'providerType');
    const providerTool = pickLogString(record, 'provider_tool', 'providerTool');
    const summary = pickLogString(record, 'summary');
    const hint = pickLogString(record, 'hint');
    const attempts = pickLogStringArray(record, 'attempts');
    const autoInjectedVideoSource = pickLogBoolean(record, 'auto_injected_video_source')
      ?? pickLogBoolean(input, 'webot_auto_injected_video_source');
    const autoInjectedVideoSourceUrl = pickLogString(
      record,
      'auto_injected_video_source_url',
      'autoInjectedVideoSourceUrl',
    ) || pickLogString(input, 'webot_auto_injected_video_source_url');
    const selfExpression = pickLogBoolean(record, 'self_expression')
      ?? pickLogBoolean(input, 'webot_self_expression_request');
    const promptSummary = prompt ? `提示词：${clampLogText(prompt, 96)}` : '';
    const providerSummary = model || provider ? `模型：${model || provider}` : '';
    if (tool && !input) {
      return `已开始调用 ${tool}`;
    }
    const structuredLines = [
      route ? `路径：${route}` : '',
      providerId ? `Provider：${providerId}${providerType ? ` (${providerType})` : ''}` : '',
      providerTool ? `命中能力：${providerTool}` : '',
      autoInjectedVideoSource
        ? `默认视频源图：已自动注入${autoInjectedVideoSourceUrl ? ` · ${clampLogText(autoInjectedVideoSourceUrl, 88)}` : ''}`
        : selfExpression && normalizedTitle.includes('video')
          ? '默认视频源图：未自动注入'
          : '',
      summary ? `摘要：${clampLogText(summary, 120)}` : '',
      promptSummary,
      providerSummary,
      attempts.length > 0 ? `尝试路径：${attempts.join(' -> ')}` : '',
      hint ? `排查建议：${clampLogText(hint, 120)}` : '',
    ].filter(Boolean);
    if (structuredLines.length > 0) {
      return structuredLines.join('\n');
    }
    if (promptSummary || providerSummary) {
      return [providerSummary, promptSummary].filter(Boolean).join('，');
    }
  }
  const query = normalizedDetail.match(/(?:^|\n)\s*query\s*:\s*(.+)$/im)?.[1]?.trim();
  const hits = normalizedDetail.match(/(?:^|\n)\s*hits\s*:\s*(\d+)/im)?.[1]?.trim();
  const toolName = normalizedDetail.match(/<(?:[a-z0-9_.-]+:)?tool_call>\s*=?\s*([^\n\r]+)/i)?.[1]?.trim();
  if (normalizedTitle.includes('记忆')) {
    return clampLogText([
      query ? `检索：${query}` : '已执行记忆召回',
      hits ? `命中 ${hits} 条` : '',
    ].filter(Boolean).join('，'));
  }
  if (toolName) {
    return clampLogText(query ? `${toolName} · ${query}` : toolName);
  }
  if (/^[a-z0-9_-]+:/i.test(normalizedDetail)) {
    return `模型：${clampLogText(normalizedDetail, 120)}`;
  }
  return clampLogText(query || normalizedDetail);
}

function summarizeThinkingDetail(detail?: string): string | undefined {
  if (!detail?.trim()) {
    return undefined;
  }
  return clampLogText(detail);
}

function summarizeFinalOutput(msg: Message): string | undefined {
  const text = cleanupAssistantText(msg.text || '', msg.spec).trim();
  if (text && !looksLikeProtocolOnlyText(text)) {
    return clampLogText(text, 220);
  }
  const spec = msg.spec && typeof msg.spec === 'object' ? msg.spec as Record<string, unknown> : null;
  const specType = typeof spec?.type === 'string' ? spec.type.trim().toLowerCase() : '';
  if (specType === 'imagecover' || specType === 'imagecarousel') {
    const title = typeof spec?.props === 'object' && spec.props && typeof (spec.props as Record<string, unknown>).title === 'string'
      ? ((spec.props as Record<string, unknown>).title as string).trim()
      : '';
    return title ? `已生成图片结果：${title}` : '已生成图片结果。';
  }
  if (specType) {
    return '已生成结果卡片。';
  }
  return undefined;
}

function isMemoryTraceRow(row: MessageTrace): boolean {
  const haystack = `${row.title}\n${row.detail || ''}`.toLowerCase();
  return /记忆|memory|semantic_memory|unified_memory/.test(haystack);
}

function isIdentityThinkingRow(row: MessageTrace): boolean {
  const haystack = `${row.title}\n${row.detail || ''}`.toLowerCase();
  return /身份|角色|roleplay|persona|identity|真实世界|互动边界|边界/.test(haystack);
}

function isRenderDecisionThinkingRow(row: MessageTrace): boolean {
  const haystack = `${row.title}\n${row.detail || ''}`.toLowerCase();
  return /a2ui|json-render|render|渲染|客户端|格式|markdown|ui_json|卡片|输出/.test(haystack);
}

function isConnectionToolRow(row: MessageTrace): boolean {
  const title = row.title.trim().toLowerCase();
  return /会话准备|会话就绪|连接模型|模型连接已建立|upstream|session/i.test(title);
}

function isGenericProgressThinkingRow(row: MessageTrace): boolean {
  const detail = (row.detail || '').trim().toLowerCase();
  if (/开始生成|整理输出|生成完成|阶段:/.test(row.title.trim())) {
    return true;
  }
  return (
    detail.includes('模型已开始处理本轮请求')
    || detail.includes('正在等待首个内容块')
    || detail.includes('模型正在思考并组织回复')
    || detail.includes('模型正在整理输出内容')
    || detail.includes('本轮流式输出已结束')
  );
}

function hasSubstantiveThinkingDetail(row: MessageTrace): boolean {
  return Boolean(summarizeThinkingDetail(row.detail)) && !isGenericProgressThinkingRow(row);
}

function summarizeTraceDetails(
  rows: MessageTrace[],
  summarize: (row: MessageTrace) => string | undefined,
  fallback: string,
  maxItems = 3,
): string {
  const picked = Array.from(new Set(
    rows
      .map((row) => summarize(row)?.trim())
      .filter((item): item is string => Boolean(item)),
  )).slice(0, maxItems);
  if (picked.length === 0) {
    return fallback;
  }
  return picked.join('\n');
}

function summarizeThinkingStageEvidence(
  primaryRows: MessageTrace[],
): string {
  return summarizeTraceDetails(primaryRows, (row) => summarizeThinkingDetail(row.detail), '', 3);
}

function extractToolNames(rows: MessageTrace[]): string[] {
  return Array.from(new Set(
    rows
      .map((row) => row.title
        .replace(/^工具调用\s*[·:：-]?\s*/i, '')
        .replace(/\s+(开始|完成|运行中)$/u, '')
        .trim())
      .filter(Boolean),
  ));
}

function summarizeMemoryStageEvidence(rows: MessageTrace[]): string {
  if (rows.length === 0) {
    return '当前未显式命中长期记忆，继续依赖本轮上下文与短期会话状态。';
  }
  const hits = rows.length;
  const details = summarizeTraceDetails(
    rows,
    (row) => summarizeToolDetail(row.title, row.detail),
    '',
    3,
  );
  return [
    `本轮已触发记忆召回，共返回 ${hits} 段记忆线索。`,
    details,
  ].filter(Boolean).join('\n');
}

function summarizeToolStageEvidence(rows: MessageTrace[]): string {
  if (rows.length === 0) {
    return '本轮未触发额外工具，答案主要基于现有上下文直接生成。';
  }
  const toolNames = extractToolNames(rows);
  const head = toolNames.length > 0
    ? `本轮已调用 ${toolNames.length} 个工具：${toolNames.join('、')}。`
    : `本轮已产生 ${rows.length} 条工具调用记录。`;
  const details = summarizeTraceDetails(
    rows,
    (row) => summarizeToolDetail(row.title, row.detail) || row.title,
    '',
    4,
  );
  return [head, details].filter(Boolean).join('\n');
}

function summarizeConnectionEvidence(msg: Message, rows: MessageTrace[]): string {
  const channel = (msg.debugPromptChannel || 'app').trim();
  const renderMode = (msg.debugRenderMode || 'json-render').trim();
  const streamState = (msg.uiStreamState || 'idle').trim();
  const connectionLines = summarizeTraceDetails(
    rows,
    (row) => summarizeToolDetail(row.title, row.detail) || clampLogText(row.detail || row.title, 96),
    '',
    4,
  );
  const header = `channel=${channel} · render=${renderMode}${streamState ? ` · ${streamState}` : ''}`;
  return [header, connectionLines].filter(Boolean).join('\n');
}

function summarizeConnectionStage(msg: Message): string {
  const channel = (msg.debugPromptChannel || 'app').trim();
  const renderMode = (msg.debugRenderMode || 'json-render').trim();
  const streamState = (msg.uiStreamState || 'idle').trim();
  const extra: string[] = [
    `已开始连接本轮请求，前端按 channel=${channel}、renderMode=${renderMode} 建立聊天上下文。`,
  ];
  if (msg.generationStartedAt) {
    extra.push('已创建流式消息草稿并开始接收模型事件。');
  }
  if (msg.debugHasUiJson) {
    extra.push(`检测到结构化 UI 数据流，当前 UI 状态：${streamState}。`);
  }
  return extra.join('\n');
}

function summarizePromptDebugSlotEvidence(msg: Message): string | undefined {
  const slots = msg.promptDebug?.promptSlots ?? [];
  const promptSources = msg.promptDebug?.promptSources ?? [];
  const host = msg.promptDebug?.hostPolicyLoaded;
  const parts: string[] = [];
  if (slots.length > 0) {
    parts.push(`结构化上下文已装配：${slots.join(' -> ')}。`);
  }
  if (host === true) {
    parts.push('宿主级 AGENTS 已优先加载。');
  } else if (host === false) {
    parts.push('宿主级 AGENTS 未加载或内容为空。');
  }
  if (promptSources.length > 0) {
    parts.push(`来源：${promptSources.slice(0, 6).join('、')}。`);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function summarizePromptDebugCapabilityEvidence(msg: Message): string | undefined {
  const skills = msg.promptDebug?.availableSkills ?? [];
  const mcps = msg.promptDebug?.availableMcpServers ?? [];
  const capabilities = msg.promptDebug?.availableCapabilities ?? [];
  const blockedTools = msg.promptDebug?.blockedTools ?? [];
  const parts: string[] = [];
  if (skills.length > 0) {
    parts.push(`skills：${skills.join('、')}。`);
  }
  if (mcps.length > 0) {
    parts.push(`MCP：${mcps.join('、')}。`);
  }
  if (capabilities.length > 0) {
    parts.push(`capabilities：${capabilities.slice(0, 4).join('；')}。`);
  }
  if (blockedTools.length > 0) {
    parts.push(`blocked tools：${blockedTools.join('、')}。`);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

type StructuredPromptSlotName =
  | 'host_policy'
  | 'global_policy'
  | 'execution_protocol'
  | 'identity_context'
  | 'capability_context'
  | 'memory_context'
  | 'session_context'
  | 'task_input';

const STRUCTURED_PROMPT_SLOT_ORDER: StructuredPromptSlotName[] = [
  'host_policy',
  'global_policy',
  'execution_protocol',
  'identity_context',
  'capability_context',
  'memory_context',
  'session_context',
  'task_input',
];

const STRUCTURED_PROMPT_SLOT_LABELS: Record<StructuredPromptSlotName, string> = {
  host_policy: '宿主规则',
  global_policy: '全局协议',
  execution_protocol: '执行协议',
  identity_context: '身份上下文',
  capability_context: '能力上下文',
  memory_context: '记忆上下文',
  session_context: '会话上下文',
  task_input: '任务输入',
};

function buildStructuredPromptRows(msg: Message): MessageTrace[] {
  const slots = new Set((msg.promptDebug?.promptSlots ?? []).map((slot) => slot.trim().toLowerCase()));
  if (slots.size === 0) {
    return [];
  }
  const availableSkills = msg.promptDebug?.availableSkills ?? [];
  const baseAt = Number.isFinite(new Date(msg.timestamp).getTime()) ? new Date(msg.timestamp).getTime() : Date.now();
  const injectedSlots = STRUCTURED_PROMPT_SLOT_ORDER.filter((slot) => slots.has(slot));
  const detailLines = [
    `已注入槽位：${injectedSlots.map((slot) => STRUCTURED_PROMPT_SLOT_LABELS[slot]).join(' -> ')}`,
    msg.promptDebug?.hostPolicyLoaded ? '宿主规则：已加载宿主级 AGENTS。' : '宿主规则：未加载或为空。',
    availableSkills.length > 0 ? `能力：${availableSkills.join('、')}` : '',
  ].filter(Boolean);
  return [{
    id: `${msg.id}-structured-context-summary`,
    title: '上下文装配',
    detail: detailLines.join('\n'),
    at: new Date(baseAt).toISOString(),
  }];
}

function summarizeRenderDecisionStage(msg: Message, renderThinkingRows: MessageTrace[]): string {
  const channel = (msg.debugPromptChannel || 'app').trim();
  const renderMode = (msg.debugRenderMode || 'json-render').trim();
  const outputFormat = msg.spec
    ? '结构化卡片/A2UI'
    : (cleanupAssistantText(msg.text || '', msg.spec).trim() ? 'Markdown 文本' : '空白/等待结果');
  const a2uiAvailable = renderMode === 'json-render' || renderMode === 'gui'
    || channel === 'app' || channel === 'desktop' || channel === 'web' || channel === 'gui';
  const finalOutput = summarizeFinalOutput(msg);
  const thoughtSummary = summarizeTraceDetails(
    renderThinkingRows,
    (row) => summarizeThinkingDetail(row.detail),
    '',
    2,
  );
  return [
    `当前客户端：${channel}，渲染模式：${renderMode}，A2UI ${a2uiAvailable ? '可用' : '不可用'}。`,
    thoughtSummary,
    `最终决定输出格式：${outputFormat}。`,
    finalOutput ? `最终输出：${finalOutput}` : '最终输出：本轮暂未形成可展示结果。',
  ].filter(Boolean).join('\n');
}

function getRuntimeStageLabel(title: string): string {
  return title.trim().replace(/^\d+\s*[：:]\s*/u, '');
}

function getRuntimeStageIndex(trace: Pick<MessageTrace, 'title'>): number {
  const normalized = getRuntimeStageLabel(trace.title);
  const stageMap: Record<string, number> = {
    '开始连接': 0,
    '身份判断': 1,
    '理解用户': 2,
    '召回记忆': 3,
    '调用工具': 4,
    '渲染与输出': 5,
  };
  return stageMap[normalized] ?? Number.MAX_SAFE_INTEGER;
}

function summarizeStagePreview(title: string, detail: string): string {
  const normalizedTitle = getRuntimeStageLabel(title);
  const firstLine = detail
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';
  if (!firstLine) {
    return '点击展开查看';
  }
  if (normalizedTitle === '开始连接') {
    return '已连接上下文';
  }
  if (normalizedTitle === '身份判断') {
    return clampLogText(firstLine.replace(/^已进入本轮执行身份判断，?/, '').replace(/^当前判断如下[:：]?/, ''), 28) || '已完成身份判断';
  }
  if (normalizedTitle === '理解用户') {
    return clampLogText(firstLine.replace(/^正在持续理解用户语义与意图，?/, '').replace(/^当前收敛结果如下[:：]?/, ''), 32) || '已理解用户意图';
  }
  if (normalizedTitle === '召回记忆') {
    const hitMatch = detail.match(/共返回\s*(\d+)\s*段/u);
    return hitMatch ? `命中 ${hitMatch[1]} 段记忆` : '已召回记忆';
  }
  if (normalizedTitle === '调用工具') {
    const toolMatch = detail.match(/已调用\s*(\d+)\s*个工具[:：]\s*([^\n。]+)/u);
    if (toolMatch) {
      return clampLogText(`${toolMatch[1]} 个工具 · ${toolMatch[2]}`, 38);
    }
    return '已调用工具';
  }
  if (normalizedTitle === '渲染与输出') {
    const outputMatch = detail.match(/最终输出[:：]\s*([^\n]+)/u);
    if (outputMatch) {
      return clampLogText(outputMatch[1], 38);
    }
    const formatMatch = detail.match(/最终决定输出格式[:：]\s*([^\n。]+)/u);
    if (formatMatch) {
      return clampLogText(formatMatch[1], 24);
    }
    return '已生成输出';
  }
  return clampLogText(firstLine, 40) || '点击展开查看';
}

function formatRuntimeStageTickerLabel(trace: MessageTrace): string {
  const stageTitle = getRuntimeStageLabel(trace.title);
  const preview = summarizeStagePreview(trace.title, trace.detail || '');
  return preview && preview !== '点击展开查看'
    ? `${stageTitle} ${preview}`.trim()
    : stageTitle;
}

function getTraceTimeMs(trace: Pick<MessageTrace, 'at'>): number {
  const value = new Date(trace.at).getTime();
  return Number.isFinite(value) ? value : Date.now();
}

function createStageTrace(
  id: string,
  title: string,
  detail: string,
  sourceRows: MessageTrace[],
  fallbackTimeMs: number,
): MessageTrace {
  const stageTimeMs = sourceRows.length > 0
    ? Math.max(...sourceRows.map((row) => getTraceTimeMs(row)))
    : fallbackTimeMs;
  return {
    id,
    title,
    detail,
    at: new Date(stageTimeMs).toISOString(),
  };
}

function formatTraceDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0ms';
  }
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = ms / 1_000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainSeconds}s`;
}

function hasVisibleToolDetail(tool: MessageToolCall): boolean {
  return Boolean(summarizeToolDetail(tool.name || 'tool', tool.result || tool.input));
}

function hasVisibleTraceDetail(rows: MessageTrace[] | undefined, kind: 'thinking' | 'tool'): boolean {
  return Boolean(rows?.some((row) => (
    kind === 'thinking'
      ? Boolean(summarizeThinkingDetail(row.detail))
      : Boolean(summarizeToolDetail(row.title, row.detail))
  )));
}

function buildClipboardFileName(file: File, index: number): string {
  const rawName = file.name.trim();
  if (rawName) {
    return rawName;
  }
  const mimeType = file.type.trim().toLowerCase();
  const extension = CLIPBOARD_IMAGE_EXTENSION_BY_MIME[mimeType] || 'bin';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `clipboard-${stamp}-${index + 1}.${extension}`;
}

function collectClipboardFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) {
    return [];
  }
  const collected: File[] = [];
  const seenKeys = new Set<string>();
  const pushFile = (candidate: File | null | undefined, index: number) => {
    if (!candidate) {
      return;
    }
    const normalizedName = buildClipboardFileName(candidate, index);
    const normalized = candidate.name.trim()
      ? candidate
      : new File([candidate], normalizedName, {
        type: candidate.type || 'application/octet-stream',
        lastModified: candidate.lastModified || Date.now(),
      });
    const key = [normalized.name, normalized.size, normalized.type, normalized.lastModified].join('::');
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    collected.push(normalized);
  };

  Array.from(clipboardData.items ?? []).forEach((item, index) => {
    if (item.kind !== 'file') {
      return;
    }
    pushFile(item.getAsFile(), index);
  });

  if (collected.length > 0) {
    return collected;
  }

  Array.from(clipboardData.files ?? []).forEach((file, index) => {
    pushFile(file, index);
  });

  return collected;
}

export interface ChatSendPayload {
  rawText: string;
  displayText: string;
  attachments?: ChatAttachment[];
  intent?: 'default' | 'continue' | 'options';
}

export interface ChatContextUsageMeter {
  tokenCount?: number | null;
  loading?: boolean;
  updatedAt?: number | null;
  pressurePercent: number;
  recentMessageCount: number;
  recentCharCount: number;
  messageThreshold: number;
  charThreshold: number;
}

export interface ChatConversationPaneProps {
  agent: Agent;
  conversationKey?: string;
  sessionTitle?: string;
  messages: Message[];
  isSending: boolean;
  inputLocked: boolean;
  autoConversationEnabled?: boolean;
  streamState: 'idle' | 'streaming' | 'waiting';
  streamingMessage?: Message | null;
  hideHeader?: boolean;
  inputToolbar?: ReactNode;
  contextUsage?: ChatContextUsageMeter;
  onUserActivity?: (source: UserActivitySource) => void;
  onSendMessage: (payload: ChatSendPayload) => boolean | void | Promise<boolean | void>;
  onSendSilentMessage: (text: string) => void;
  onRegenerateMessage: (messageId: string) => void;
  onStopStreaming: () => void;
  onCreateTaskCard: (messageId: string) => void;
  onCancelTaskCard: (messageId: string) => void;
  onDeleteTaskCard: (messageId: string) => void;
  onToggleAutoConversation?: () => void;
  onOpenTaskCardDetails: (input: { taskId?: string; messageId: string }) => void;
  onOpenA2aCardDetails: (messageId: string, cardId: string) => void;
  onConfirmGroupUpgrade?: (payload: GroupUpgradeActionPayload, ctx?: { messageId?: string }) => void;
  onCancelGroupUpgrade?: (payload: GroupUpgradeActionPayload, ctx?: { messageId?: string }) => void;
  onConfirmAgentManagement?: (payload: Record<string, unknown>, ctx?: { messageId?: string }) => void;
  onCancelAgentManagement?: (payload: Record<string, unknown>, ctx?: { messageId?: string }) => void;
  onConfirmSelfUpgrade?: (payload: Record<string, unknown>, ctx?: { messageId?: string }) => void;
  onCancelSelfUpgrade?: (payload: Record<string, unknown>, ctx?: { messageId?: string }) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  infoSidebarCollapsed: boolean;
  onToggleInfoSidebar: () => void;
}

export interface GroupUpgradeActionPayload {
  groupName?: string;
  reason?: string;
  description?: string;
  leaderAgentId?: string;
  memberAgentIds?: string[];
  members?: Array<{
    id?: string;
    name?: string;
    role?: string;
    description?: string;
  }>;
  tags?: string[];
}

interface ComposerAttachmentDraft {
  id: string;
  name: string;
  kind: 'image' | 'file';
  status: 'uploading' | 'ready' | 'error';
  upstreamFileId?: string;
  relativePath?: string;
  savedPath?: string;
  assetUrl?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  localVisionSummary?: string;
  localVisionProvider?: string;
  localVisionModel?: string;
  previewUrl?: string;
  error?: string;
}

interface MessageTtsPlaybackState {
  status: 'loading' | 'ready' | 'error';
  result?: AgentTtsSynthesisResult;
  error?: string;
  playing?: boolean;
  playSignal?: number;
  stopSignal?: number;
}

interface MessageTtsTriggerState {
  tagged: boolean;
  cleanText: string;
}

function normalizeMessageTtsTag(value: string | undefined): string {
  const normalized = (value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return normalized || 'speaker';
}

function parseMessageTtsTrigger(text: string, tagName: string): MessageTtsTriggerState {
  const normalizedTag = normalizeMessageTtsTag(tagName);
  const pattern = new RegExp(`</?${normalizedTag}\\s*/?>`, 'gi');
  const tagged = pattern.test(text);
  const cleanText = text.replace(pattern, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return {
    tagged,
    cleanText,
  };
}

function estimateAttachmentPromptChars(attachments: ComposerAttachmentDraft[]): number {
  return attachments.reduce((sum, attachment) => {
    const parts = [
      attachment.name,
      attachment.relativePath,
      attachment.savedPath,
      attachment.mimeType,
      attachment.kind === 'image' ? '图片' : '附件',
    ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return sum + parts.join(' ').length + 24;
  }, 0);
}

function estimateDraftTokenDelta(text: string, attachments: ComposerAttachmentDraft[]): number {
  const normalizedText = text.trim();
  const attachmentChars = estimateAttachmentPromptChars(attachments);
  const tokenSource = `${normalizedText}\n${attachments
    .map((item) => [item.name, item.relativePath, item.savedPath, item.mimeType].filter(Boolean).join(' '))
    .join('\n')}`;
  const cjkChars = Array.from(tokenSource).filter((char) => /[\u4e00-\u9fff]/.test(char)).length;
  const totalChars = normalizedText.length + attachmentChars;
  if (totalChars <= 0) {
    return 0;
  }
  const otherChars = Math.max(0, totalChars - cjkChars);
  return Math.max(1, cjkChars + Math.ceil(otherChars / 4));
}

interface MessageRenderGroup {
  id: string;
  isUser: boolean;
  messages: Message[];
}

const MarkdownBlock = memo(function MarkdownBlock({
  className,
  content,
}: {
  className: string;
  content: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

const CARD_TYPES_THAT_SUPPRESS_MEDIA_MARKDOWN = new Set([
  'imagecover',
  'imagecarousel',
  'videocover',
  'videogallery',
  'audioplayer',
  'audioplaylist',
  'officepreviewcard',
  'markdownpreviewcard',
  'jobprogresscard',
]);

function getRenderableSpecType(spec: unknown): string {
  if (!spec || typeof spec !== 'object') {
    return '';
  }
  const value = (spec as Record<string, unknown>).type;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isComponentInvokeJobProgressSpec(spec: unknown): boolean {
  if (getRenderableSpecType(spec) !== 'jobprogresscard' || !spec || typeof spec !== 'object') {
    return false;
  }
  const props = (spec as Record<string, unknown>).props;
  if (!props || typeof props !== 'object') {
    return false;
  }
  const record = props as Record<string, unknown>;
  const capabilityKey = typeof record.capabilityKey === 'string'
    ? record.capabilityKey.trim().toLowerCase()
    : (typeof record.capability_key === 'string' ? record.capability_key.trim().toLowerCase() : '');
  const route = typeof record.route === 'string'
    ? record.route.trim().toLowerCase()
    : '';
  const providerType = typeof record.providerType === 'string'
    ? record.providerType.trim().toLowerCase()
    : (typeof record.provider_type === 'string' ? record.provider_type.trim().toLowerCase() : '');
  return capabilityKey === 'component_invoke'
    || route === 'component_invoke'
    || providerType === 'component_skill';
}

function shouldRenderStructuredSpec(spec: unknown): boolean {
  const specType = getRenderableSpecType(spec);
  if (!specType) {
    return false;
  }
  if (specType !== 'jobprogresscard') {
    return true;
  }
  return isComponentInvokeJobProgressSpec(spec);
}

function sanitizeMarkdownForRenderableSpec(markdown: string, spec: unknown): string {
  if (!markdown.trim()) {
    return markdown;
  }
  if (!CARD_TYPES_THAT_SUPPRESS_MEDIA_MARKDOWN.has(getRenderableSpecType(spec))) {
    return markdown;
  }
  return markdown
    .replace(/!\[[^\]]*\]\([^)]+\)\s*/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const normalized = line.trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      if (normalized.includes('/api/uploads/')) {
        return false;
      }
      if (normalized.includes('/api/management/agents/')) {
        return false;
      }
      if (/^(图片地址|图片链接|视频地址|视频链接|文档地址|文件地址|下载地址|链接)\s*[:：]/i.test(normalized)) {
        return false;
      }
      if (/^(音频在这|音频地址|语音地址)\s*[:：]/i.test(normalized)) {
        return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasRuntimeLogData(msg: Message): boolean {
  return Boolean(
    (msg.tools ?? []).some((tool) => hasVisibleToolDetail(tool))
    || hasVisibleTraceDetail(msg.thinkingTrace, 'thinking')
    || hasVisibleTraceDetail(msg.toolTrace, 'tool')
    || (msg.promptDebug?.promptSlots?.length ?? 0) > 0
  );
}

function hasMeaningfulAgentBridgeText(msg: Message): boolean {
  const text = cleanupAssistantText(msg.text || '', msg.spec).trim();
  if (!text) {
    return false;
  }
  if (text.length > 40) {
    return false;
  }
  return /^(好的|我来|我先|这就|马上|稍等|让我|正在).*(生成|制作|处理|安排|执行|帮你)/u.test(text);
}

function getMessageTimestampMs(msg: Message): number {
  const timestamp = Date.parse(msg.timestamp || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function canCollapseBridgeMessage(current: Message, next: Message): boolean {
  if (current.role !== 'agent' || next.role !== 'agent') {
    return false;
  }
  if (current.spec != null || current.taskCard || (current.a2aCards?.length ?? 0) > 0 || (current.attachments?.length ?? 0) > 0) {
    return false;
  }
  if ((current.agentId || current.agentName || '').trim() !== (next.agentId || next.agentName || '').trim()) {
    return false;
  }
  const delta = Math.abs(getMessageTimestampMs(next) - getMessageTimestampMs(current));
  if (delta > 120_000) {
    return false;
  }
  if (hasRuntimeLogData(current)) {
    return false;
  }
  const nextHasRenderable = next.spec != null || Boolean(cleanupAssistantText(next.text || '', next.spec).trim());
  if (!nextHasRenderable) {
    return false;
  }
  return hasMeaningfulAgentBridgeText(current) || !cleanupAssistantText(current.text || '', current.spec).trim();
}

function DeferredUiCard({
  shouldDefer,
  children,
}: {
  shouldDefer: boolean;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(!shouldDefer);

  useEffect(() => {
    if (!shouldDefer) {
      setReady(true);
      return;
    }
    if (ready) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setReady(true);
      return;
    }

    const node = containerRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setReady(true);
        observer.disconnect();
      }
    }, {
      rootMargin: '360px 0px',
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [ready, shouldDefer]);

  return (
    <div ref={containerRef}>
      {ready ? children : (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          A2UI 卡片将按滚动位置择机渲染
        </div>
      )}
    </div>
  );
}

function isPlaceholderA2aCard(card: A2AWorkCardData): boolean {
  const name = (card.agentName || '').trim();
  return card.agentId === A2A_PLACEHOLDER_AGENT_ID || !name || name === A2A_PLACEHOLDER_AGENT_NAME;
}

function mergeA2aCardLogs(left: A2AWorkCardData['logs'], right: A2AWorkCardData['logs']): A2AWorkCardData['logs'] {
  const merged = [...left, ...right];
  const seen = new Set<string>();
  return merged
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .filter((item) => {
      const key = `${item.title}::${item.detail || ''}::${item.at}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(-80);
}

function mergeA2aCardsForDisplay(left: A2AWorkCardData, right: A2AWorkCardData): A2AWorkCardData {
  const leftIsPlaceholder = isPlaceholderA2aCard(left);
  const rightIsPlaceholder = isPlaceholderA2aCard(right);
  const preferRight =
    (!rightIsPlaceholder && leftIsPlaceholder)
    || (left.status === 'working' && right.status !== 'working')
    || right.logs.length > left.logs.length;
  const primary = preferRight ? right : left;
  const secondary = preferRight ? left : right;
  return {
    ...secondary,
    ...primary,
    agentId: !isPlaceholderA2aCard(primary) ? primary.agentId : secondary.agentId,
    agentName: !isPlaceholderA2aCard(primary) ? primary.agentName : (primary.agentName || secondary.agentName),
    agentAvatarUrl: primary.agentAvatarUrl || secondary.agentAvatarUrl,
    agentColor: primary.agentColor || secondary.agentColor,
    summary: primary.summary || secondary.summary,
    startedAt: primary.startedAt || secondary.startedAt,
    finishedAt: primary.finishedAt || secondary.finishedAt,
    logs: mergeA2aCardLogs(secondary.logs, primary.logs),
  };
}

function getVisibleA2aCards(cards: A2AWorkCardData[]): A2AWorkCardData[] {
  if (cards.length === 0) {
    return [];
  }
  const nonPlaceholderCards = cards.filter((card) => !isPlaceholderA2aCard(card));
  const source = nonPlaceholderCards.length > 0 ? nonPlaceholderCards : cards;
  const merged = new Map<string, A2AWorkCardData>();

  for (const card of source) {
    const normalizedName = (card.agentName || '').trim().toLowerCase();
    const key = isPlaceholderA2aCard(card)
      ? `placeholder:${card.id}`
      : `agent:${card.agentId || normalizedName || card.id}`;
    const current = merged.get(key);
    merged.set(key, current ? mergeA2aCardsForDisplay(current, card) : card);
  }

  return Array.from(merged.values());
}

function getA2aCardDisplayName(card: A2AWorkCardData): string {
  return isPlaceholderA2aCard(card) ? '协作任务' : (card.agentName || '协作任务');
}

function formatA2aTimeLabel(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function normalizeOptionIntentText(raw: string): string {
  return raw
    .trim()
    .replace(/^[\s\u2705\u2714\u2716\u274c\u25cb\u25ef\u2022\-*#]+/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, '');
}

function resolveTaskProposalOptionIntent(
  raw: string,
): 'confirm' | 'cancel' | null {
  const normalized = normalizeOptionIntentText(raw).toLowerCase();
  if (!normalized) return null;
  if (
    normalized === 'confirm'
    || normalized === 'ok'
    || normalized === 'yes'
    || normalized === '确认'
    || normalized === '创建任务'
    || normalized.includes('确认创建任务')
    || (normalized.includes('确认') && normalized.includes('任务'))
    || normalized.includes('立即创建')
  ) {
    return 'confirm';
  }
  if (
    normalized === 'cancel'
    || normalized.includes('取消')
    || normalized.includes('暂不创建')
    || normalized.includes('放弃创建')
  ) {
    return 'cancel';
  }
  return null;
}

function formatAttachmentSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return '';
  }
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatConversationPane({
  agent,
  conversationKey,
  sessionTitle,
  messages,
  isSending,
  inputLocked,
  autoConversationEnabled = false,
  streamState,
  streamingMessage,
  hideHeader = false,
  inputToolbar,
  contextUsage,
  onUserActivity,
  onSendMessage,
  onSendSilentMessage,
  onRegenerateMessage,
  onStopStreaming,
  onCreateTaskCard,
  onCancelTaskCard,
  onDeleteTaskCard,
  onToggleAutoConversation,
  onOpenA2aCardDetails,
  onConfirmGroupUpgrade,
  onCancelGroupUpgrade,
  onConfirmAgentManagement,
  onCancelAgentManagement,
  onConfirmSelfUpgrade,
  onCancelSelfUpgrade,
  sidebarCollapsed,
  onToggleSidebar,
  infoSidebarCollapsed,
  onToggleInfoSidebar,
}: ChatConversationPaneProps) {
  const { t } = useTranslation();
  const { showAlert } = useGlobalAlert();
  const [inputValue, setInputValue] = useState('');
  const [traceOpen, setTraceOpen] = useState<Record<string, boolean>>({});
  const [traceNodeOpen, setTraceNodeOpen] = useState<Record<string, boolean>>({});
  const [taskCardTabState, setTaskCardTabState] = useState<Record<string, 'overview' | 'process' | 'summary'>>({});
  const [copiedTraceKey, setCopiedTraceKey] = useState('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachmentDraft[]>([]);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const [messageTtsMap, setMessageTtsMap] = useState<Record<string, MessageTtsPlaybackState>>({});
  const [globalTtsEnabled, setGlobalTtsEnabled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoStickToBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const mixedSegmentsCacheRef = useRef<Map<string, MixedRenderSegment[]>>(new Map());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerAttachmentsRef = useRef<ComposerAttachmentDraft[]>([]);
  const messageTtsAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const autoTriggeredTtsMessageIdsRef = useRef<Set<string>>(new Set());
  const isDesktopRuntime = isTauriRuntime();
  const desktopFileOpenSupported = isDesktopFileOpenSupported();

  useEffect(() => {
    let active = true;
    getApiBaseUrl({ forceRefresh: true })
      .then((resolvedBaseUrl) => {
        if (active) {
          setApiBaseUrl(resolvedBaseUrl);
        }
      })
      .catch(() => {
        if (active) {
          setApiBaseUrl('');
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setMessageTtsMap({});
    autoTriggeredTtsMessageIdsRef.current.clear();
    for (const controller of messageTtsAbortControllersRef.current.values()) {
      controller.abort();
    }
    messageTtsAbortControllersRef.current.clear();
  }, [agent.id, conversationKey]);
  useEffect(() => {
    setComposerSubmitting(false);
  }, [conversationKey]);
  useEffect(() => () => {
    for (const controller of messageTtsAbortControllersRef.current.values()) {
      controller.abort();
    }
    messageTtsAbortControllersRef.current.clear();
  }, []);
  useEffect(() => {
    let active = true;
    getTtsStatus()
      .then((next) => {
        if (active) {
          setGlobalTtsEnabled(Boolean(next.config.enabled));
        }
      })
      .catch(() => {
        if (active) {
          setGlobalTtsEnabled(false);
        }
      });
    return () => {
      active = false;
    };
  }, [agent.id]);
  const draftCharCount = useMemo(
    () => inputValue.trim().length + estimateAttachmentPromptChars(composerAttachments),
    [composerAttachments, inputValue],
  );
  const estimatedTokenDelta = useMemo(
    () => estimateDraftTokenDelta(inputValue, composerAttachments),
    [composerAttachments, inputValue],
  );
  const estimatedMessageCount = useMemo(() => {
    if (!inputValue.trim() && composerAttachments.length === 0) {
      return contextUsage?.recentMessageCount ?? 0;
    }
    return (contextUsage?.recentMessageCount ?? 0) + 1;
  }, [composerAttachments.length, contextUsage?.recentMessageCount, inputValue]);
  const estimatedCharCount = (contextUsage?.recentCharCount ?? 0) + draftCharCount;
  const estimatedPressurePercent = useMemo(() => {
    if (!contextUsage) {
      return 0;
    }
    const messageRatio = estimatedMessageCount / Math.max(1, contextUsage.messageThreshold);
    const charRatio = estimatedCharCount / Math.max(1, contextUsage.charThreshold);
    return Math.max(0, Math.min(100, Math.round(Math.max(messageRatio, charRatio) * 100)));
  }, [contextUsage, estimatedCharCount, estimatedMessageCount]);
  const meterTextClass = estimatedPressurePercent >= 85
    ? 'text-rose-500'
    : estimatedPressurePercent >= 60
      ? 'text-amber-500'
      : 'text-muted-foreground';
  const estimatedContextTokenCount = contextUsage?.tokenCount != null
    ? contextUsage.tokenCount + estimatedTokenDelta
    : ((contextUsage?.recentMessageCount ?? 0) === 0 && (contextUsage?.recentCharCount ?? 0) === 0
      ? estimatedTokenDelta
      : null);
  const currentTokenText = contextUsage?.tokenCount != null
    ? `当前 ${formatCount(contextUsage.tokenCount)} token`
    : ((contextUsage?.recentMessageCount ?? 0) === 0 && (contextUsage?.recentCharCount ?? 0) === 0
      ? '当前 0 token'
      : '当前 token 暂不可用');

  const revokeComposerPreview = useCallback((previewUrl?: string) => {
    if (!previewUrl || !previewUrl.startsWith('blob:')) {
      return;
    }
    URL.revokeObjectURL(previewUrl);
  }, []);

  composerAttachmentsRef.current = composerAttachments;

  useEffect(() => () => {
    composerAttachmentsRef.current.forEach((item) => revokeComposerPreview(item.previewUrl));
  }, [revokeComposerPreview]);

  const isNearBottom = useCallback((node: HTMLDivElement | null, threshold = 96): boolean => {
    if (!node) return true;
    const distance = node.scrollHeight - node.clientHeight - node.scrollTop;
    return distance <= threshold;
  }, []);

  const flushScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({
      top: node.scrollHeight,
      behavior,
    });
  }, []);

  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      flushScrollToBottom(behavior);
    });
  }, [flushScrollToBottom]);

  useEffect(() => () => {
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  const appendImageToInput = useCallback((source: string, altText?: string) => {
    const src = source.trim();
    if (!src) return;
    const alt = (altText || '图片').trim() || '图片';
    const line = `![${alt}](${src})`;
    setInputValue((prev) => (prev.trim() ? `${prev}\n${line}` : line));
  }, []);

  const appendVideoToInput = useCallback((source: string, title?: string, duration?: string) => {
    const src = source.trim();
    if (!src) return;
    const safeTitle = (title || '视频').trim() || '视频';
    const suffix = (duration || '').trim();
    const line = suffix ? `[🎬 ${safeTitle} · ${suffix}](${src})` : `[🎬 ${safeTitle}](${src})`;
    setInputValue((prev) => (prev.trim() ? `${prev}\n${line}` : line));
  }, []);

  const appendAudioToInput = useCallback((source: string, title?: string, duration?: string, live?: boolean) => {
    const src = source.trim();
    if (!src) return;
    const safeTitle = (title || '音频').trim() || '音频';
    const suffix = (duration || '').trim();
    const liveMark = live ? 'LIVE' : 'AUDIO';
    const line = suffix
      ? `[🎧 ${safeTitle} · ${liveMark} · ${suffix}](${src})`
      : `[🎧 ${safeTitle} · ${liveMark}](${src})`;
    setInputValue((prev) => (prev.trim() ? `${prev}\n${line}` : line));
  }, []);

  const handleUiAction = useCallback((actionId: string, payload?: any, ctx?: { messageId?: string }) => {
    const normalized = (actionId || '').trim().toLowerCase();
    if (!normalized) return;

    const isImageInsertAction = (
      normalized === 'insert_image'
      || normalized === 'image_insert'
      || normalized === 'send_image'
      || normalized === 'pick_image'
      || normalized === 'select_image'
      || normalized === 'insert.image'
      || normalized === 'image.insert'
    );
    const isVideoInsertAction = (
      normalized === 'insert_video'
      || normalized === 'video_insert'
      || normalized === 'send_video'
      || normalized === 'pick_video'
      || normalized === 'select_video'
      || normalized === 'insert.video'
      || normalized === 'video.insert'
    );
    const isAudioInsertAction = (
      normalized === 'insert_audio'
      || normalized === 'audio_insert'
      || normalized === 'send_audio'
      || normalized === 'pick_audio'
      || normalized === 'select_audio'
      || normalized === 'insert.audio'
      || normalized === 'audio.insert'
    );
    const isGroupUpgradeConfirmAction = (
      normalized === 'confirm_group_upgrade'
      || normalized === 'group_upgrade_confirm'
      || normalized === 'group-upgrade-confirm'
      || normalized === 'group.upgrade.confirm'
    );
    const isGroupUpgradeCancelAction = (
      normalized === 'cancel_group_upgrade'
      || normalized === 'group_upgrade_cancel'
      || normalized === 'group-upgrade-cancel'
      || normalized === 'group.upgrade.cancel'
    );
    const isAgentManagementConfirmAction = (
      normalized === 'confirm_agent_management'
      || normalized === 'agent_management_confirm'
      || normalized === 'agent-management-confirm'
      || normalized === 'agent.management.confirm'
    );
    const isAgentManagementCancelAction = (
      normalized === 'cancel_agent_management'
      || normalized === 'agent_management_cancel'
      || normalized === 'agent-management-cancel'
      || normalized === 'agent.management.cancel'
    );
    const isSelfUpgradeConfirmAction = (
      normalized === 'confirm_self_upgrade'
      || normalized === 'self_upgrade_confirm'
      || normalized === 'self-upgrade-confirm'
      || normalized === 'self.upgrade.confirm'
    );
    const isSelfUpgradeCancelAction = (
      normalized === 'cancel_self_upgrade'
      || normalized === 'self_upgrade_cancel'
      || normalized === 'self-upgrade-cancel'
      || normalized === 'self.upgrade.cancel'
    );
    const isOptionSubmitAction = (
      normalized === 'submit_option'
      || normalized === 'option_submit'
      || normalized === 'submit-option'
      || normalized === 'option-submit'
      || normalized === 'select_option'
      || normalized === 'option_select'
      || normalized === 'choice_submit'
      || normalized === 'choice_select'
      || normalized === 'option.submit'
      || normalized === 'option.select'
    );
    if (
      !isImageInsertAction
      && !isVideoInsertAction
      && !isAudioInsertAction
      && !isOptionSubmitAction
      && !isGroupUpgradeConfirmAction
      && !isGroupUpgradeCancelAction
      && !isAgentManagementConfirmAction
      && !isAgentManagementCancelAction
      && !isSelfUpgradeConfirmAction
      && !isSelfUpgradeCancelAction
    ) return;

    if (typeof onUserActivity === 'function') {
      onUserActivity('ui_action');
    }

    if (isAgentManagementConfirmAction || isAgentManagementCancelAction) {
      const payloadRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      if (isAgentManagementConfirmAction) {
        onConfirmAgentManagement?.(payloadRecord, ctx);
      } else {
        onCancelAgentManagement?.(payloadRecord, ctx);
      }
      return;
    }

    if (isSelfUpgradeConfirmAction || isSelfUpgradeCancelAction) {
      const payloadRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      if (isSelfUpgradeConfirmAction) {
        onConfirmSelfUpgrade?.(payloadRecord, ctx);
      } else {
        onCancelSelfUpgrade?.(payloadRecord, ctx);
      }
      return;
    }

    if (isGroupUpgradeConfirmAction || isGroupUpgradeCancelAction) {
      const payloadRecord = payload && typeof payload === 'object' ? payload as GroupUpgradeActionPayload : {};
      if (isGroupUpgradeConfirmAction) {
        onConfirmGroupUpgrade?.(payloadRecord, ctx);
      } else {
        onCancelGroupUpgrade?.(payloadRecord, ctx);
      }
      return;
    }

    if (isOptionSubmitAction) {
      const pickPromptFromRecord = (record: Record<string, unknown> | undefined): string => {
        if (!record) return '';
        const promptsFromPayload = Array.isArray(record.prompts)
          ? record.prompts
            .filter((item: unknown): item is string => typeof item === 'string')
            .map((item: string) => item.trim())
            .filter(Boolean)
          : [];
        const promptFromSelected = Array.isArray(record.selected)
          ? record.selected
            .map((item: unknown) => {
              if (!item || typeof item !== 'object') return '';
              const row = item as Record<string, unknown>;
              if (typeof row.prompt === 'string' && row.prompt.trim()) return row.prompt.trim();
              if (typeof row.value === 'string' && row.value.trim()) return row.value.trim();
              if (typeof row.label === 'string' && row.label.trim()) return row.label.trim();
              return '';
            })
            .filter(Boolean)
          : [];
        return (
          (typeof record.prompt === 'string' ? record.prompt : '')
          || (typeof record.hiddenPrompt === 'string' ? record.hiddenPrompt : '')
          || (typeof record.nextPrompt === 'string' ? record.nextPrompt : '')
          || promptsFromPayload.join('\n')
          || promptFromSelected.join('\n')
          || (typeof record.message === 'string' ? record.message : '')
          || (typeof record.value === 'string' ? record.value : '')
          || (typeof record.label === 'string' ? record.label : '')
        ).trim();
      };

      const payloadRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
      const nestedCandidates: Array<Record<string, unknown> | undefined> = [
        payloadRecord,
        payloadRecord?.payload && typeof payloadRecord.payload === 'object' ? payloadRecord.payload as Record<string, unknown> : undefined,
        payloadRecord?.params && typeof payloadRecord.params === 'object' ? payloadRecord.params as Record<string, unknown> : undefined,
        payloadRecord?.data && typeof payloadRecord.data === 'object' ? payloadRecord.data as Record<string, unknown> : undefined,
        payloadRecord?.detail && typeof payloadRecord.detail === 'object' ? payloadRecord.detail as Record<string, unknown> : undefined,
        payloadRecord?.meta && typeof payloadRecord.meta === 'object' ? payloadRecord.meta as Record<string, unknown> : undefined,
      ];

      const prompt = nestedCandidates
        .map((record) => pickPromptFromRecord(record))
        .find((item) => Boolean(item)) || '';

      if (!prompt) return;

      const messageId = (ctx?.messageId || '').trim();
      const optionIntent = resolveTaskProposalOptionIntent(prompt);
      if (messageId) {
        const owner = messages.find((msg) => msg.id === messageId);
        const looksLikeTaskProposal = Boolean(
          owner
          && owner.role === 'agent'
          && owner.taskCard
          && (owner.taskCard.stage === 'proposal' || owner.taskCard.stage === 'failed')
          && (owner.taskCard.canCreate === true || owner.taskCard.canCancel === true),
        );

        if (looksLikeTaskProposal) {
          if (optionIntent === 'confirm') {
            onCreateTaskCard(messageId);
            return;
          }

          if (optionIntent === 'cancel') {
            onCancelTaskCard(messageId);
            return;
          }
        }

        // 旧任务确认卡仍可能通过通用 OptionSelector 回传一个裸 "确认/取消" 文本。
        // 这类输入会重新落回普通聊天链路，导致模型继续走旧的“自由发挥 + 运行日志”分支。
        // 现在统一收口：非标准 taskCard 的确认/取消按钮不再静默转发给模型。
        if (owner?.role === 'agent' && optionIntent) {
          return;
        }
      }

      onSendSilentMessage(prompt);
      return;
    }

    const src = (
      (payload && typeof payload.src === 'string' && payload.src)
      || (payload && typeof payload.url === 'string' && payload.url)
      || (payload && typeof payload.path === 'string' && payload.path)
      || (payload && typeof payload.rawSrc === 'string' && payload.rawSrc)
      || ''
    ).trim();
    if (!src) return;

    if (isImageInsertAction) {
      const alt = (payload && typeof payload.alt === 'string' ? payload.alt : '')
        || (payload && typeof payload.title === 'string' ? payload.title : '')
        || '图片';
      appendImageToInput(src, alt);
      return;
    }

    if (isVideoInsertAction) {
      const title = (payload && typeof payload.title === 'string' ? payload.title : '') || '视频';
      const duration = (payload && typeof payload.duration === 'string' ? payload.duration : '') || '';
      appendVideoToInput(src, title, duration);
      return;
    }

    if (isAudioInsertAction) {
      const title = (payload && typeof payload.title === 'string' ? payload.title : '') || '音频';
      const duration = (payload && typeof payload.duration === 'string' ? payload.duration : '') || '';
      const live = Boolean(payload && payload.live === true);
      appendAudioToInput(src, title, duration, live);
    }
  }, [
    appendAudioToInput,
    appendImageToInput,
    appendVideoToInput,
    messages,
    onCancelAgentManagement,
    onCancelSelfUpgrade,
    onCancelTaskCard,
    onConfirmAgentManagement,
    onConfirmSelfUpgrade,
    onCreateTaskCard,
    onCancelGroupUpgrade,
    onConfirmGroupUpgrade,
    onSendSilentMessage,
    onUserActivity,
  ]);

  const validatePickedFile = useCallback((file: File, requestedKind: 'image' | 'file'): string | null => {
    const isImage = file.type.startsWith('image/');
    if (requestedKind === 'image' && !isImage) {
      return '只能选择图片文件';
    }
    if (!isDesktopRuntime) {
      if (!isImage) {
        return 'Web 端当前只支持上传小图片';
      }
      if (file.size > WEB_IMAGE_MAX_BYTES) {
        return `Web 端图片大小不能超过 ${Math.round(WEB_IMAGE_MAX_BYTES / (1024 * 1024))} MB`;
      }
      return null;
    }
    if (file.size > APP_FILE_MAX_BYTES) {
      return `App 端单个附件大小不能超过 ${Math.round(APP_FILE_MAX_BYTES / (1024 * 1024))} MB`;
    }
    return null;
  }, [isDesktopRuntime]);

  const updateComposerAttachment = useCallback((attachmentId: string, updater: (draft: ComposerAttachmentDraft) => ComposerAttachmentDraft) => {
    setComposerAttachments((prev) => prev.map((item) => (item.id === attachmentId ? updater(item) : item)));
  }, []);

  const handlePickedFiles = useCallback(async (
    fileList: FileList | readonly File[] | null,
    requestedKind: 'image' | 'file',
  ) => {
    const files = Array.isArray(fileList) ? [...fileList] : Array.from(fileList ?? []);
    if (files.length === 0 || inputLocked) {
      return;
    }

    for (const file of files) {
      const error = validatePickedFile(file, requestedKind);
      const attachmentId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const draft: ComposerAttachmentDraft = {
        id: attachmentId,
        name: file.name || 'upload.bin',
        kind: requestedKind === 'image' || file.type.startsWith('image/') ? 'image' : 'file',
        status: error ? 'error' : 'uploading',
        size: file.size,
        mimeType: file.type || undefined,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        error: error || undefined,
      };
      setComposerAttachments((prev) => [...prev, draft]);
      if (error) {
        continue;
      }

      try {
        const uploaded = await uploadManagementAgentChatAsset(agent.id, file);
        updateComposerAttachment(attachmentId, (current) => ({
          ...current,
          status: 'ready',
          kind: uploaded.kind,
          name: uploaded.filename,
          upstreamFileId: uploaded.upstreamFileId,
          relativePath: uploaded.relativePath,
          savedPath: uploaded.savedPath,
          assetUrl: uploaded.assetUrl,
          mimeType: uploaded.mimeType,
          size: uploaded.size,
          sha256: uploaded.sha256,
          localVisionSummary: uploaded.localVisionSummary,
          localVisionProvider: uploaded.localVisionProvider,
          localVisionModel: uploaded.localVisionModel,
        }));
      } catch (uploadError) {
        updateComposerAttachment(attachmentId, (current) => ({
          ...current,
          status: 'error',
          error: uploadError instanceof Error ? uploadError.message : '上传失败',
        }));
      }
    }
  }, [agent.id, inputLocked, updateComposerAttachment, validatePickedFile]);

  const handleRemoveComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((prev) => {
      const target = prev.find((item) => item.id === attachmentId);
      if (target) {
        revokeComposerPreview(target.previewUrl);
      }
      return prev.filter((item) => item.id !== attachmentId);
    });
  }, [revokeComposerPreview]);

  const buildOutgoingAttachments = useCallback((
    readyAttachments: ComposerAttachmentDraft[],
  ): ChatAttachment[] => (
    readyAttachments.map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        upstreamFileId: item.upstreamFileId,
        relativePath: item.relativePath || '',
        savedPath: item.savedPath,
        assetUrl: item.assetUrl,
        mimeType: item.mimeType,
        size: item.size,
        sha256: item.sha256,
        localVisionSummary: item.localVisionSummary,
        localVisionProvider: item.localVisionProvider,
        localVisionModel: item.localVisionModel,
      }))
  ), []);

  const handleSend = async () => {
    const draftInputValue = inputValue;
    const draftAttachments = composerAttachments.map((item) => ({ ...item }));
    const readyAttachments = composerAttachments.filter((item) => item.status === 'ready');
    const uploadingCount = composerAttachments.filter((item) => item.status === 'uploading').length;
    if (
      (inputValue.trim().length === 0 && readyAttachments.length === 0)
      || inputLocked
      || composerSubmitting
      || uploadingCount > 0
    ) {
      return;
    }
    if (typeof onUserActivity === 'function') {
      onUserActivity('send');
    }
    const userText = inputValue.trim();
    const attachments = buildOutgoingAttachments(readyAttachments);
    setInputValue('');
    setComposerAttachments([]);
    setComposerSubmitting(true);
    const payload: ChatSendPayload = {
      rawText: userText,
      displayText: userText || `已上传 ${attachments.length} 个附件`,
      attachments,
    };
    try {
      const accepted = await onSendMessage(payload);
      if (accepted === false) {
        setInputValue(draftInputValue);
        setComposerAttachments(draftAttachments);
        return;
      }
      draftAttachments.forEach((item) => revokeComposerPreview(item.previewUrl));
    } catch {
      setInputValue(draftInputValue);
      setComposerAttachments(draftAttachments);
    } finally {
      setComposerSubmitting(false);
    }
  };

  const handleQuickActionSend = async (intent: 'continue' | 'options') => {
    const draftInputValue = inputValue;
    const draftAttachments = composerAttachments.map((item) => ({ ...item }));
    const uploadingCount = composerAttachments.filter((item) => item.status === 'uploading').length;
    if (inputLocked || composerSubmitting || uploadingCount > 0 || composerAttachments.length > 0) {
      return;
    }
    if (typeof onUserActivity === 'function') {
      onUserActivity('send');
    }
    const userText = inputValue.trim();
    setInputValue('');
    setComposerSubmitting(true);
    const payload: ChatSendPayload = {
      rawText: userText,
      displayText: intent === 'continue' ? '继续' : '选项',
      intent,
    };
    try {
      const accepted = await onSendMessage(payload);
      if (accepted === false) {
        setInputValue(draftInputValue);
        setComposerAttachments(draftAttachments);
      }
    } catch {
      setInputValue(draftInputValue);
      setComposerAttachments(draftAttachments);
    } finally {
      setComposerSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (typeof onUserActivity === 'function') {
      onUserActivity('keydown');
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleComposerPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (typeof onUserActivity === 'function') {
      onUserActivity('input');
    }
    const clipboardFiles = collectClipboardFiles(event.clipboardData);
    if (clipboardFiles.length === 0) {
      return;
    }
    event.preventDefault();
    void handlePickedFiles(clipboardFiles, 'file');
  }, [handlePickedFiles, onUserActivity]);

  const handleScroll = useCallback(() => {
    autoStickToBottomRef.current = isNearBottom(scrollRef.current);
  }, [isNearBottom]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    autoStickToBottomRef.current = isNearBottom(node);
  }, [isNearBottom]);

  useEffect(() => {
    autoStickToBottomRef.current = true;
    scheduleScrollToBottom('auto');
  }, [conversationKey, scheduleScrollToBottom]);

  useEffect(() => {
    if (!autoStickToBottomRef.current) {
      return;
    }
    scheduleScrollToBottom('auto');
  }, [messages, streamingMessage, scheduleScrollToBottom]);

  useEffect(() => {
    const node = contentRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!autoStickToBottomRef.current) {
        return;
      }
      scheduleScrollToBottom('auto');
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [scheduleScrollToBottom]);

  useEffect(() => {
    const hasRunningMessage = messages.some((msg) => msg.role === 'agent' && msg.streaming && msg.generationStartedAt != null)
      || Boolean(streamingMessage?.streaming && streamingMessage.generationStartedAt != null);
    if (!hasRunningMessage) {
      return;
    }
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [messages, streamingMessage]);

  const displayStatus = isSending ? 'busy' : 'online';
  const formatElapsed = useCallback((ms?: number): string => {
    const safeMs = Math.max(0, ms || 0);
    if (safeMs < 60000) {
      const seconds = safeMs / 1000;
      return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}秒`;
    }
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}分${seconds.toString().padStart(2, '0')}秒`;
  }, []);

  const canRegenerateAt = useCallback((index: number): boolean => {
    if (isSending) return false;
    const current = messages[index];
    if (!current || current.role !== 'agent') return false;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') {
        return true;
      }
    }
    return false;
  }, [isSending, messages]);

  const renderSimpleCardSpec = useCallback((spec: unknown) => {
    if (!spec || typeof spec !== 'object') return null;
    const obj = spec as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : '';
    if (type !== 'card') return null;
    const props = (obj.props && typeof obj.props === 'object') ? (obj.props as Record<string, unknown>) : {};
    const hasStructuredChildren = Array.isArray(props.children) && props.children.length > 0;
    if (hasStructuredChildren) {
      return null;
    }
    const title = typeof props.title === 'string' ? props.title : '';
    const content = typeof props.content === 'string'
      ? props.content
      : typeof props.description === 'string'
        ? props.description
        : '';
    const footer = typeof props.footer === 'string' ? props.footer : '';
    const hasFallbackPayload = Boolean(title || content || footer);
    if (!hasFallbackPayload) {
      return null;
    }
    return (
      <Card className="mt-2 border-border/60 shadow-none">
        {title ? (
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{title}</CardTitle>
          </CardHeader>
        ) : null}
        <CardContent className="pt-0 text-sm text-foreground/85 whitespace-pre-wrap break-words">
          {content || '??????'}
        </CardContent>
        {footer ? <div className="px-6 pb-4 text-xs text-muted-foreground whitespace-pre-wrap break-words">{footer}</div> : null}
      </Card>
    );
  }, []);

  const renderLoadingCard = useCallback((msg: Message) => {
    return (
      <div className="chat-inputing-inline mt-2" aria-label={msg.debugWatchdogTriggered ? '等待中' : '输入中'}>
        <span className="chat-inputing-dots" aria-hidden="true">
          <span className="chat-inputing-dot" />
          <span className="chat-inputing-dot" />
          <span className="chat-inputing-dot" />
        </span>
      </div>
    );
  }, []);

  const taskStageLabel = useCallback((stage: ChatTaskCardData['stage']): string => {
    if (stage === 'proposal') return '待确认';
    if (stage === 'scheduled') return '等待执行';
    if (stage === 'running') return '执行中';
    if (stage === 'completed') return '已完成';
    if (stage === 'cancelled') return '已取消';
    return '执行失败';
  }, []);

  const taskStageClass = useCallback((stage: ChatTaskCardData['stage']): string => {
    if (stage === 'completed') return 'bg-success';
    if (stage === 'running') return 'bg-primary';
    if (stage === 'cancelled') return 'bg-muted';
    if (stage === 'failed') return 'bg-destructive';
    return 'bg-warning';
  }, []);

  const taskKindLabel = useCallback((kind?: ChatTaskCardData['taskKind']): string => {
    if (kind === 'chat_async') return '聊天异步任务';
    if (kind === 'manual_schedule') return '任务中心定时任务';
    if (kind === 'a2a_delegate') return '智能体委派任务';
    return '聊天定时任务';
  }, []);

  const taskReportStatusLabel = useCallback((status?: ChatTaskCardData['reportStatus']): string => {
    if (status === 'acknowledged') return '已同步到当前会话';
    return '待汇报';
  }, [buildOutgoingAttachments, composerAttachments, composerSubmitting, inputLocked, inputValue, onSendMessage, onUserActivity, revokeComposerPreview]);

  const taskTimelineLabel = useCallback((kind: ChatTaskLifecycleItem['kind']): string => {
    if (kind === 'created') return '草案';
    if (kind === 'started') return '启动';
    if (kind === 'progress') return '进度';
    if (kind === 'anomaly') return '异常';
    if (kind === 'final') return '总结';
    if (kind === 'cancelled') return '取消';
    return '失败';
  }, []);

  const taskTimelineClass = useCallback((entry: ChatTaskLifecycleItem): string => {
    if (entry.level === 'success' || entry.kind === 'final') return 'text-success';
    if (entry.level === 'error' || entry.kind === 'anomaly' || entry.kind === 'failed') return 'text-destructive';
    return 'text-primary';
  }, []);

  const formatTaskTimelineTime = useCallback((raw: string): string => {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString();
  }, []);

  const renderTaskCard = useCallback((msg: Message, taskCard: ChatTaskCardData) => {
    const stage = taskCard.stage;
    const logCount = taskCard.logCount ?? taskCard.runCount;
    const errorCount = taskCard.errorCount ?? 0;
    const hasFinalSummary = taskCard.finalSummaryReady === true;
    const allTimelineEntries = (taskCard.timeline ?? [])
      .slice()
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
    const processTimelineEntries = allTimelineEntries.filter((entry) => entry.kind !== 'final');
    const anomalyTimelineEntries = allTimelineEntries.filter((entry) => entry.kind === 'anomaly' || entry.kind === 'failed');
    const finalSummaryPreview = (taskCard.finalSummaryText || '').trim();
    const activeTab = taskCardTabState[msg.id]
      || (finalSummaryPreview || stage === 'completed'
        ? 'summary'
        : processTimelineEntries.length > 0
          ? 'process'
          : 'overview');
    const canCreate = (stage === 'proposal' || stage === 'failed') && taskCard.canCreate === true;
    const canCancelProposal = stage === 'proposal' && taskCard.canCancel === true;
    const canCancelRunning = (stage === 'scheduled' || stage === 'running') && taskCard.canCancel === true;
    const showDelete = stage !== 'running' && stage !== 'completed';
    const canDelete = showDelete && taskCard.canDelete === true;
    const notCreatedYet = !taskCard.taskId;
    const createDisabledReason = stage === 'completed' ? '任务已完成，不能再次创建' : '当前状态不可创建';
    const deleteDisabledReason = notCreatedYet
      ? '任务尚未创建，无需删除'
      : stage === 'running'
      ? '执行中任务不能删除'
      : '任务执行中，请先停止后再删除';
    let deliveryStatus = '等待确认创建';
    let deliveryClass = 'text-muted-foreground';
    if (stage === 'scheduled') {
      deliveryStatus = logCount > 0
        ? `进行中（已记录 ${logCount} 轮执行${errorCount > 0 ? `，异常 ${errorCount} 次` : ''}）`
        : '进行中（等待首次执行）';
      deliveryClass = 'text-primary';
    } else if (stage === 'running') {
      deliveryStatus = logCount > 0
        ? `执行中（已记录 ${logCount} 轮执行${errorCount > 0 ? `，异常 ${errorCount} 次` : ''}）`
        : '执行中（等待首次执行结果）';
      deliveryClass = 'text-primary';
    } else if (stage === 'completed') {
      if (hasFinalSummary) {
        deliveryStatus = '已完成（最终汇报已归档到卡片）';
        deliveryClass = 'text-success';
      } else {
        deliveryStatus = '已完成（最终汇报生成中）';
        deliveryClass = 'text-warning';
      }
    } else if (stage === 'cancelled') {
      deliveryStatus = '任务已取消（闭环终止）';
    } else if (stage === 'failed') {
      deliveryStatus = '任务创建或执行失败，请重试';
      deliveryClass = 'text-destructive';
    }
    return (
      <Card className="mt-2 rounded-2xl border-border/50 bg-background shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <CardTitle className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                <Zap className="h-4 w-4 shrink-0 text-warning" />
                <span className="truncate">{taskCard.taskName || '任务定时器'}</span>
              </CardTitle>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{taskKindLabel(taskCard.taskKind)}</span>
                <span>已执行 {taskCard.maxRuns > 0 ? `${taskCard.runCount}/${taskCard.maxRuns}` : `${taskCard.runCount} 次`}</span>
                <span>{allTimelineEntries.length} 条记录</span>
                {errorCount > 0 ? <span className="text-destructive">异常 {errorCount} 次</span> : null}
              </div>
            </div>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold text-white', taskStageClass(taskCard.stage))}>
              {taskStageLabel(taskCard.stage)}
            </span>
          </div>
          <div className="border-t border-border/50 pt-3 text-sm leading-7 text-foreground/88">
            {taskCard.objective || '-'}
          </div>
          {taskCard.reportCondition ? (
            <div className="text-xs leading-6 text-muted-foreground">
              <span className="font-medium text-foreground/80">汇报条件：</span>
              {taskCard.reportCondition}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <Tabs
            value={activeTab}
            onValueChange={(value) => setTaskCardTabState((prev) => ({
              ...prev,
              [msg.id]: value as 'overview' | 'process' | 'summary',
            }))}
            className="space-y-3"
          >
            <TabsList className="grid h-auto grid-cols-3 rounded-none border-b border-border/50 bg-transparent p-0 text-muted-foreground">
              <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent px-0 py-2 text-xs font-medium data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                概览
              </TabsTrigger>
              <TabsTrigger value="process" className="rounded-none border-b-2 border-transparent px-0 py-2 text-xs font-medium data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                过程
              </TabsTrigger>
              <TabsTrigger value="summary" className="rounded-none border-b-2 border-transparent px-0 py-2 text-xs font-medium data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                总结
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-0 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Gauge className="h-3.5 w-3.5" />
                    <span>执行进度</span>
                  </div>
                  <span className="font-medium text-foreground">
                    {taskCard.maxRuns > 0
                      ? `${taskCard.runCount}/${taskCard.maxRuns}${typeof taskCard.progressPercent === 'number' ? `（${taskCard.progressPercent}%）` : ''}`
                      : `${taskCard.runCount} 次`}
                  </span>
                </div>
                <Progress value={taskCard.progressPercent ?? 0} className="h-1.5" />
              </div>
              <div className="grid gap-x-6 gap-y-2 text-xs leading-6 text-foreground/85 sm:grid-cols-2">
                <div><span className="text-muted-foreground">执行安排：</span>{taskCard.scheduleText || '-'}</div>
                <div><span className="text-muted-foreground">聊天回执：</span><span className={deliveryClass}>{deliveryStatus}</span></div>
                <div><span className="text-muted-foreground">执行人：</span>{taskCard.executorAgentName || '-'}</div>
                <div><span className="text-muted-foreground">汇报人：</span>{taskCard.reportActorName || taskCard.executorAgentName || '-'}</div>
                <div><span className="text-muted-foreground">汇报状态：</span>{taskReportStatusLabel(taskCard.reportStatus)}</div>
                <div><span className="text-muted-foreground">上次执行：</span>{taskCard.lastRun ? new Date(taskCard.lastRun).toLocaleString() : '-'}</div>
                <div><span className="text-muted-foreground">下次执行：</span>{taskCard.nextRun ? new Date(taskCard.nextRun).toLocaleString() : '-'}</div>
              </div>
              {taskCard.errorSummary ? (
                <div className="border-l-2 border-destructive/60 pl-3 text-xs leading-6 text-destructive">
                  <span className="font-medium">异常摘要：</span>
                  {taskCard.errorSummary}
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="process" className="mt-0 space-y-3">
              {anomalyTimelineEntries.length > 0 ? (
                <div className="border-l-2 border-destructive/60 pl-3">
                  <div className="text-[11px] font-medium text-destructive/80">异常概览</div>
                  <div className="mt-1 text-xs leading-6 text-destructive">
                    {anomalyTimelineEntries[0]?.detail || anomalyTimelineEntries[0]?.title || '存在异常，请查看过程明细。'}
                  </div>
                </div>
              ) : null}
              {allTimelineEntries.length > 0 ? (
                <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                  {allTimelineEntries.map((entry) => (
                    <div key={entry.id} className="space-y-1 border-b border-border/40 pb-3 last:border-b-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={cn('text-[11px] font-medium', taskTimelineClass(entry))}>
                            {taskTimelineLabel(entry.kind)} · {entry.title}
                          </div>
                          {typeof entry.runCount === 'number' ? (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">第 {entry.runCount} 轮</div>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-[10px] text-muted-foreground">{formatTaskTimelineTime(entry.at)}</div>
                      </div>
                      {entry.detail ? (
                        <div className="text-xs leading-6 text-foreground/78 whitespace-pre-wrap break-words">
                          {entry.detail}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  暂时还没有执行过程，首次执行后会直接沉淀在这里。
                </div>
              )}
            </TabsContent>
            <TabsContent value="summary" className="mt-0 space-y-3">
              {finalSummaryPreview ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-medium text-success/80">最终总结</div>
                  <div className="text-sm leading-7 text-foreground/90 whitespace-pre-wrap break-words">
                    {finalSummaryPreview}
                  </div>
                </div>
              ) : taskCard.errorSummary ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-medium text-destructive/80">失败总结</div>
                  <div className="text-sm leading-7 text-foreground/90 whitespace-pre-wrap break-words">
                    {taskCard.errorSummary}
                  </div>
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  {stage === 'completed'
                    ? '任务已完成，正在等待最终总结写回。'
                    : '任务还未结束，最终总结会在完成后显示在这里。'}
                </div>
              )}
            </TabsContent>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2">
            {(stage === 'proposal' || stage === 'failed') ? (
              <Button
                type="button"
                size="sm"
                className="h-7 rounded-md px-3 text-[11px] font-bold"
                disabled={!canCreate}
                title={canCreate ? '' : createDisabledReason}
                onClick={() => onCreateTaskCard(msg.id)}
              >
                {stage === 'failed' ? '重试创建' : '创建任务'}
              </Button>
            ) : null}
            {stage === 'proposal' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-md px-3 text-[11px] font-semibold"
                disabled={!canCancelProposal}
                title={canCancelProposal ? '' : '当前状态不可取消'}
                onClick={() => onCancelTaskCard(msg.id)}
              >
                取消
              </Button>
            ) : null}
            {(stage === 'scheduled' || stage === 'running') ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-md px-3 text-[11px] font-semibold gap-1.5"
                disabled={!canCancelRunning}
                title={canCancelRunning ? '' : '当前状态不可停止'}
                onClick={() => onCancelTaskCard(msg.id)}
              >
                <Square className="w-3 h-3 fill-current" />
                停止并取消
              </Button>
            ) : null}
            {showDelete ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-md px-3 text-[11px] font-semibold gap-1.5"
                disabled={!canDelete}
                title={canDelete ? '' : deleteDisabledReason}
                onClick={() => onDeleteTaskCard(msg.id)}
              >
                <Trash2 className="w-3 h-3" />
                删除
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }, [
    formatTaskTimelineTime,
    onCancelTaskCard,
    onCreateTaskCard,
    onDeleteTaskCard,
    taskCardTabState,
    taskKindLabel,
    taskReportStatusLabel,
    taskStageClass,
    taskStageLabel,
    taskTimelineClass,
    taskTimelineLabel,
  ]);

  const a2aStatusText = useCallback((card: A2AWorkCardData): string => {
    if (card.status === 'working') return '工作中';
    if (card.status === 'completed') return '已完成';
    return '失败';
  }, []);

  const renderA2aCards = useCallback((msg: Message, cards: A2AWorkCardData[]) => {
    const visibleCards = getVisibleA2aCards(cards);
    if (visibleCards.length === 0) {
      return null;
    }

    return (
      <div className="mt-3 rounded-2xl border border-border/60 bg-gradient-to-br from-muted/30 via-background to-muted/10 p-2.5 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">协作进度</p>
            <p className="text-xs text-muted-foreground">点击查看子任务详情</p>
          </div>
          <div className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground/80">
            {visibleCards.length} 项
          </div>
        </div>
        <div className="space-y-2">
          {visibleCards.map((card) => {
            const displayName = getA2aCardDisplayName(card);
            const timeLabel = formatA2aTimeLabel(card.finishedAt || card.startedAt);
            return (
              <button
                key={card.id}
                type="button"
                className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/85 px-3 py-2.5 text-left transition-all hover:border-primary/30 hover:bg-background hover:shadow-sm"
                onClick={() => onOpenA2aCardDetails(msg.id, card.id)}
              >
                <AgentAvatar
                  name={displayName}
                  avatarUrl={card.agentAvatarUrl}
                  color={card.agentColor}
                  size="sm"
                  className="ring-1 ring-border/60"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground/92">{displayName}</p>
                    <span
                      className={cn(
                        'inline-flex h-2 w-2 shrink-0 rounded-full',
                        card.status === 'working'
                          ? 'bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.15)]'
                          : card.status === 'completed'
                            ? 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]'
                            : 'bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]',
                      )}
                    />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className={cn(card.status === 'working' ? 'text-amber-600 animate-pulse' : '')}>
                      {card.summary || a2aStatusText(card)}
                    </span>
                    {timeLabel ? (
                      <>
                        <span className="text-muted-foreground/40">•</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {timeLabel}
                        </span>
                      </>
                    ) : null}
                  </div>
                  {card.objective ? (
                    <div className="mt-1 text-[11px] leading-5 text-foreground/80">
                      任务目标：{card.objective.length > 110 ? `${card.objective.slice(0, 110)}...` : card.objective}
                    </div>
                  ) : null}
                  {card.finalReportText ? (
                    <div className="mt-1 text-[11px] leading-5 text-foreground/80">
                      最终汇报：{card.finalReportText.length > 110 ? `${card.finalReportText.slice(0, 110)}...` : card.finalReportText}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-[10px] text-muted-foreground">
                  {card.logs.length} 条日志
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }, [a2aStatusText, onOpenA2aCardDetails]);

  const toggleTraceNodePanel = useCallback((parentKey: string, key: string) => {
    setTraceNodeOpen((prev) => {
      const next = { ...prev };
      const prefix = `${parentKey}:`;
      Object.keys(next).forEach((itemKey) => {
        if (itemKey.startsWith(prefix)) {
          delete next[itemKey];
        }
      });
      if (!prev[key]) {
        next[key] = true;
      }
      return next;
    });
  }, []);

  const renderTraceItems = useCallback((parentKey: string, rows: MessageTrace[], live = false) => (
    <div className="chat-trace-list min-w-0">
      {rows.map((trace, index) => {
        const previousAt = index > 0 ? getTraceTimeMs(rows[index - 1]) : getTraceTimeMs(trace);
        const currentAt = getTraceTimeMs(trace);
        const durationLabel = formatTraceDuration(Math.max(0, currentAt - previousAt));
        const nodeKey = `${parentKey}:${trace.id}`;
        const opened = traceNodeOpen[nodeKey] ?? (live && index === rows.length - 1);
        return (
          <div
            key={trace.id}
            className="chat-trace-node min-w-0 [contain:layout]"
          >
            <button
              type="button"
              className="chat-trace-node-trigger"
              onClick={() => toggleTraceNodePanel(parentKey, nodeKey)}
            >
              <div className="chat-trace-node-head">
                <span className="chat-trace-node-dot" />
                <span className="chat-trace-node-title">{getRuntimeStageLabel(trace.title)}</span>
                <span className="chat-trace-node-inline-meta">
                  <span className="chat-trace-node-duration">{durationLabel}</span>
                  <ChevronDown className={cn('chat-trace-node-chevron', opened && 'rotate-90')} />
                </span>
              </div>
            </button>
            {trace.detail ? (
              <div
                className={cn(
                  'chat-trace-node-detail-wrap',
                  opened ? 'chat-trace-node-detail-wrap-open' : 'chat-trace-node-detail-wrap-closed',
                )}
              >
                <div className="chat-trace-node-detail whitespace-pre-wrap break-all overflow-x-auto">
                  {trace.detail}
                </div>
              </div>
            ) : null}
          </div>
      )})}
    </div>
  ), [toggleTraceNodePanel, traceNodeOpen]);

  const toggleTracePanel = useCallback((key: string) => {
    setTraceOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const traceRenderToken = useMemo(() => {
    const openedKeys = Object.entries(traceOpen)
      .filter(([, opened]) => opened)
      .map(([key]) => key)
      .sort()
      .join('|');
    return `${copiedTraceKey}::${openedKeys}`;
  }, [copiedTraceKey, traceOpen]);

  const copyTraceBlock = useCallback(async (key: string, label: string, rows: MessageTrace[] | undefined) => {
    const content = (rows ?? [])
      .map((row) => `${row.title}\n${row.detail || ''}\n${row.at}`)
      .join('\n\n');
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedTraceKey(key);
      window.setTimeout(() => {
        setCopiedTraceKey((prev) => (prev === key ? '' : prev));
      }, 1600);
    } catch {
      console.warn(`[Trace] failed to copy ${label}`);
    }
  }, []);

  const renderTraceBlock = useCallback((key: string, label: string, rows: MessageTrace[] | undefined, live = false) => {
    const count = rows?.length ?? 0;
    if (count <= 0) return null;
    const opened = traceOpen[key] ?? live;
    const totalDuration = count > 1
      ? formatTraceDuration(Math.max(0, getTraceTimeMs(rows![count - 1]) - getTraceTimeMs(rows![0])))
      : formatTraceDuration(0);
    return (
      <div className="chat-runtime-card mt-1.5 w-full">
        <div className="group/trace-trigger flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleTracePanel(key)}
            className="chat-runtime-card-trigger"
          >
            <span className="chat-runtime-card-trigger-inner">
              <span className="chat-runtime-card-title">
                <span className="truncate">{label}</span>
              </span>
              <span className="chat-runtime-card-inline-meta">
                <span className="chat-runtime-card-meta">{count}步 · {totalDuration}</span>
                <ChevronDown className={cn(
                  'chat-runtime-card-chevron',
                  opened ? 'rotate-180 opacity-100' : 'rotate-0 opacity-70',
                )} />
              </span>
            </span>
          </button>
        </div>
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out',
            opened ? 'mt-1 grid-rows-[1fr] opacity-100 translate-y-0' : 'grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="chat-runtime-card-body group/trace-panel relative max-h-80 overflow-y-auto overflow-x-hidden min-w-0 overscroll-contain [scrollbar-gutter:stable]">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-6 w-6 shrink-0 rounded-md text-zinc-500 opacity-0 transition-all hover:bg-white/80 hover:text-zinc-900 group-hover/trace-panel:opacity-100 focus-visible:opacity-100 dark:text-zinc-500/90 dark:hover:bg-white/8 dark:hover:text-zinc-50"
                onClick={() => copyTraceBlock(key, label, rows)}
                title={`复制${label}`}
              >
                {copiedTraceKey === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              {renderTraceItems(key, rows ?? [], live)}
            </div>
          </div>
        </div>
      </div>
    );
  }, [copiedTraceKey, copyTraceBlock, renderTraceItems, toggleTracePanel, traceOpen]);

  const buildRuntimeLogRows = useCallback((msg: Message, includeAllStages = false): MessageTrace[] => {
    const rawToolRows: MessageTrace[] = [];
    const baseAt = Number.isFinite(new Date(msg.timestamp).getTime()) ? new Date(msg.timestamp).getTime() : Date.now();
    let autoIndex = 0;

    const pushAutoRow = (title: string, detail?: string) => {
      const normalizedDetail = detail?.trim();
      if (!normalizedDetail) {
        return;
      }
      rawToolRows.push({
        id: `${msg.id}-runtime-${autoIndex}`,
        title,
        detail: normalizedDetail,
        at: new Date(baseAt + autoIndex).toISOString(),
      });
      autoIndex += 1;
    };

    if ((msg.toolTrace?.length ?? 0) === 0) {
      (msg.tools ?? []).forEach((tool) => {
        const name = (tool.name || 'tool').trim();
        const detail = summarizeToolDetail(name, tool.result || tool.input);
        pushAutoRow(`工具调用 · ${name}${tool.running ? ' 运行中' : ''}`.trim(), detail);
      });
    }

    const normalizedThinkingRows = (msg.thinkingTrace ?? [])
      .map((row) => ({
        ...row,
        detail: summarizeThinkingDetail(row.detail),
      }))
      .filter((row): row is MessageTrace & { detail: string } => Boolean(row.detail));

    const normalizedToolRows = [
      ...rawToolRows,
      ...(msg.toolTrace ?? [])
        .map((row) => ({
          ...row,
          detail: summarizeToolDetail(row.title, row.detail),
        }))
        .filter((row): row is MessageTrace & { detail: string } => Boolean(row.detail)),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    const connectionRows = normalizedToolRows.filter(isConnectionToolRow);
    const renderDecisionRows = normalizedThinkingRows.filter((row) => isRenderDecisionThinkingRow(row) && hasSubstantiveThinkingDetail(row));
    const renderStageRows = renderDecisionRows;
    const memoryRows = normalizedToolRows.filter(isMemoryTraceRow);
    const toolRows = normalizedToolRows.filter((row) => !isMemoryTraceRow(row) && !isConnectionToolRow(row));
    const promptCapabilityEvidence = summarizePromptDebugCapabilityEvidence(msg);

    const hasAnyMemory = memoryRows.length > 0;
    const hasAnyTool = toolRows.length > 0;
    const hasFinalOutput = Boolean(
      renderDecisionRows.length > 0
      || msg.spec != null
      || msg.taskCard
      || cleanupAssistantText(msg.text || '', msg.spec).trim(),
    );
    const hasConnectionEvidence = connectionRows.length > 0 || Boolean(msg.generationStartedAt);

    const stageRows: MessageTrace[] = [];
    if (hasConnectionEvidence || includeAllStages) {
      stageRows.push(createStageTrace(
        `${msg.id}-runtime-stage-0`,
        '开始连接',
        hasConnectionEvidence
          ? summarizeConnectionEvidence(msg, connectionRows)
          : summarizeConnectionStage(msg),
        connectionRows,
        msg.generationStartedAt ?? baseAt,
      ));
    }

    if (hasAnyMemory || hasAnyTool || hasFinalOutput || includeAllStages) {
      stageRows.push(createStageTrace(
        `${msg.id}-runtime-stage-1`,
        '召回记忆',
        hasAnyMemory
          ? summarizeMemoryStageEvidence(memoryRows)
          : '本轮未触发记忆召回。',
        memoryRows,
        (msg.generationStartedAt ?? baseAt) + 100,
      ));
    }

    if (hasAnyTool || hasFinalOutput || includeAllStages) {
      stageRows.push(createStageTrace(
        `${msg.id}-runtime-stage-2`,
        '调用工具',
        hasAnyTool
          ? summarizeToolStageEvidence(toolRows)
          : promptCapabilityEvidence
            ? `本轮未显式调用外部工具。\n当前能力快照如下：\n${promptCapabilityEvidence}`
            : '本轮未显式调用外部工具。',
        toolRows,
        (msg.generationStartedAt ?? baseAt) + 200,
      ));
    }

    if (hasFinalOutput || renderStageRows.length > 0 || includeAllStages) {
      stageRows.push(createStageTrace(
        `${msg.id}-runtime-stage-3`,
        '渲染与输出',
        hasFinalOutput
          ? summarizeRenderDecisionStage(msg, renderStageRows)
          : renderStageRows.length > 0
            ? `已收到模型显式渲染阶段信号：\n${summarizeThinkingStageEvidence(renderStageRows)}`
            : '本轮暂未形成最终输出内容，且未收到模型显式渲染阶段信号。',
        renderStageRows,
        msg.generationStartedAt && typeof msg.generationElapsedMs === 'number'
          ? msg.generationStartedAt + msg.generationElapsedMs
          : baseAt + 300,
      ));
    }

    return stageRows.filter((row) => (row.detail ?? '').trim().length > 0);
  }, []);

  const buildRuntimeLogRowsForMessages = useCallback((items: Message[], includeAllStages = false): MessageTrace[] =>
    items
      .flatMap((item) => buildRuntimeLogRows(item, includeAllStages))
      .sort((a, b) => {
        const stageDelta = getRuntimeStageIndex(a) - getRuntimeStageIndex(b);
        if (stageDelta !== 0) {
          return stageDelta;
        }
        return new Date(a.at).getTime() - new Date(b.at).getTime();
      }), [buildRuntimeLogRows]);

  const ttsTriggerTag = normalizeMessageTtsTag(agent.ttsConfig?.messageTag);
  const agentTtsAvailable = globalTtsEnabled && Boolean(agent.ttsConfig?.enabled);
  const getMessageTtsTrigger = useCallback((msg: Message): MessageTtsTriggerState => {
    return parseMessageTtsTrigger(cleanupAssistantText(msg.text || '', msg.spec), ttsTriggerTag);
  }, [ttsTriggerTag]);

  const renderProcessPanel = useCallback((key: string, items: Message[]) => {
    if (!items.some((item) => hasRuntimeLogData(item))) {
      return null;
    }
    const structuredRows = items
      .flatMap((item) => buildStructuredPromptRows(item))
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const rows = buildRuntimeLogRowsForMessages(items, true);
    if (rows.length === 0 && structuredRows.length === 0) {
      return null;
    }
    const live = items.some((item) => item.streaming || item.thinking || item.uiStreamState === 'streaming');
    const mergedRows = [...structuredRows, ...rows]
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return renderTraceBlock(`${key}-runtime-log`, '上下文与执行', mergedRows, live);
  }, [buildRuntimeLogRowsForMessages, renderTraceBlock]);

  const renderLiveTraceTicker = useCallback((msg: Message) => {
    const rows = buildRuntimeLogRows(msg);
    if (rows.length === 0) {
      return null;
    }
    const current = rows[rows.length - 1];
    return (
      <div className="chat-live-trace-ticker" aria-label="执行步骤">
        <span className="chat-live-trace-ticker-dots" aria-hidden="true">
          <span className="chat-live-trace-ticker-dot" />
          <span className="chat-live-trace-ticker-dot" />
          <span className="chat-live-trace-ticker-dot" />
        </span>
        <span key={current.id} className="chat-live-trace-ticker-current">
          {formatRuntimeStageTickerLabel(current)}
        </span>
      </div>
    );
  }, [buildRuntimeLogRows]);

  const hasMeaningfulMarkdownText = useCallback((msg: Message): boolean => {
    const text = getMessageTtsTrigger(msg).cleanText;
    if (!text) return false;
    if (
      msg.spec != null
      && /^(已生成卡片结果。?|已根据工具调用日志生成兜底卡片。?)$/u.test(text)
    ) {
      return false;
    }
    return !looksLikeProtocolOnlyText(text);
  }, [getMessageTtsTrigger]);

  const getDisplayMarkdownText = useCallback((msg: Message): string => {
    return getMessageTtsTrigger(msg).cleanText;
  }, [getMessageTtsTrigger]);

  const getRenderableUiSpec = useCallback((spec: unknown): unknown | undefined => {
    const normalizedSpec = normalizeIncomingSpec(spec);
    const appearanceAction = extractAgentSelfAppearanceActionFromSpec(normalizedSpec);
    const withoutAppearance = appearanceAction ? appearanceAction.strippedSpec : normalizedSpec;
    const componentAction = extractComponentInvokeActionFromSpec(withoutAppearance);
    return componentAction ? componentAction.strippedSpec : withoutAppearance;
  }, []);

  const hasRenderableMessageContent = useCallback((msg: Message): boolean => {
    if ((msg.attachments?.length ?? 0) > 0) return true;
    if (msg.taskCard) return true;
    if ((msg.a2aCards?.length ?? 0) > 0) return true;
    if (shouldRenderStructuredSpec(getRenderableUiSpec(msg.spec))) return true;
    if (hasRuntimeLogData(msg)) return true;
    if (msg.role === 'user') return Boolean((msg.text || '').trim());
    if (hasMeaningfulMarkdownText(msg)) return true;
    const meta = getVisibleMessageMeta(msg.meta);
    if (meta && !meta.startsWith('auto_dispatch:')) return true;
    return false;
  }, [getRenderableUiSpec, hasMeaningfulMarkdownText]);

  const shouldRenderCardForMessage = useCallback((msg: Message, isUser: boolean): boolean => {
    if (isUser) return false;
    return shouldRenderStructuredSpec(getRenderableUiSpec(msg.spec));
  }, [getRenderableUiSpec]);

  const shouldShowLoadingCardForMessage = useCallback((msg: Message, isUser: boolean): boolean => {
    if (isUser) return false;
    const hasRenderableContent = Boolean(
      msg.taskCard
      || (msg.a2aCards?.length ?? 0) > 0
      || shouldRenderStructuredSpec(getRenderableUiSpec(msg.spec))
      || hasMeaningfulMarkdownText(msg),
    );
    if ((msg.cardPending && !hasRenderableContent) || (msg.debugWatchdogTriggered && !hasRenderableContent)) {
      return true;
    }
    if (hasRenderableContent) {
      return false;
    }
    return Boolean(msg.thinking || msg.streaming || msg.uiStreamState === 'streaming');
  }, [getRenderableUiSpec, hasMeaningfulMarkdownText]);

  type MixedRenderSegment =
    | { kind: 'markdown'; content: string }
    | { kind: 'ui'; spec: unknown };

  const extractMixedSegments = useCallback((raw: string): MixedRenderSegment[] => {
    const source = sanitizeAiUiOutput(raw).trim();
    if (!source || !containsUiJsonTag(source)) return [];

    const segments: MixedRenderSegment[] = [];
    let lastIndex = 0;
    let matchedUiCount = 0;
    const blocks = getBestEffortUiJsonBlocks(source);
    if (blocks.length === 0) return [];

    for (const block of blocks) {
      const start = block.start;
      const end = block.end;
      const markdownPart = source.slice(lastIndex, start).trim();
      if (markdownPart) {
        segments.push({ kind: 'markdown', content: markdownPart });
      }

      const jsonBlock = block.payload;
      if (jsonBlock) {
        const parsed = parseJsonSafely<unknown>(repairUiJsonString(jsonBlock));
        const spec = getRenderableUiSpec(parsed ?? jsonBlock);
        if (spec != null) {
          segments.push({ kind: 'ui', spec });
          matchedUiCount += 1;
        }
      }

      lastIndex = end;
    }

    const tailPart = source.slice(lastIndex).trim();
    if (tailPart) {
      segments.push({ kind: 'markdown', content: tailPart });
    }

    if (matchedUiCount === 0) {
      return [];
    }

    return segments;
  }, [getRenderableUiSpec]);

  const getCachedMixedSegments = useCallback((messageId: string, raw: string): MixedRenderSegment[] => {
    const source = sanitizeAiUiOutput(raw).trim();
    if (!source || !containsUiJsonTag(source)) return [];
    const key = `${messageId}::${source}`;
    const hit = mixedSegmentsCacheRef.current.get(key);
    if (hit) return hit;

    const parsed = extractMixedSegments(source);
    mixedSegmentsCacheRef.current.set(key, parsed);
    if (mixedSegmentsCacheRef.current.size > 180) {
      const firstKey = mixedSegmentsCacheRef.current.keys().next().value;
      if (firstKey) {
        mixedSegmentsCacheRef.current.delete(firstKey);
      }
    }
    return parsed;
  }, [extractMixedSegments]);

  const getMessageMixedSegments = useCallback((msg: Message, isUser: boolean): MixedRenderSegment[] => {
    if (isUser) {
      return [];
    }

    const mixedSource = [
      typeof msg.debugRawStream === 'string' ? msg.debugRawStream : '',
      typeof msg.uiRawText === 'string' ? msg.uiRawText : '',
      typeof msg.text === 'string' ? extractUiRawText(msg.text) : '',
      typeof msg.text === 'string' ? msg.text : '',
    ].find((item) => containsUiJsonTag(item)) || '';

    const mixedSegments = getCachedMixedSegments(msg.id, mixedSource)
      .filter((segment) => (
        segment.kind !== 'ui' || shouldRenderStructuredSpec(segment.spec)
      ));
    msg.debugMixedSegmentCount = mixedSegments.length;
    return mixedSegments;
  }, [getCachedMixedSegments]);

  const hasMessageBubbleContent = useCallback((msg: Message, isUser: boolean): boolean => {
    if (shouldShowLoadingCardForMessage(msg, isUser)) {
      return true;
    }
    if (!isUser && msg.meta && !msg.meta.startsWith('auto_dispatch:')) {
      return true;
    }
    if (!isUser && msg.taskCard) {
      return true;
    }

    const mixedSegments = getMessageMixedSegments(msg, isUser);
    if (!isUser && mixedSegments.length > 0) {
      return true;
    }

    const shouldRenderCard = shouldRenderCardForMessage(msg, isUser);
    const renderableSpec = getRenderableUiSpec(msg.spec);
    const hasMarkdown = hasMeaningfulMarkdownText(msg);
    const rawMarkdownContent = isUser
      ? (msg.text || '')
      : (hasMarkdown ? getDisplayMarkdownText(msg) : '');
    const markdownContent = !isUser
      ? sanitizeMarkdownForRenderableSpec(rawMarkdownContent, renderableSpec)
      : rawMarkdownContent;

    return Boolean(
      markdownContent
      || (!isUser && shouldRenderCard)
      || (!isUser && (msg.a2aCards?.length ?? 0) > 0),
    );
  }, [
    getDisplayMarkdownText,
    getMessageMixedSegments,
    getRenderableUiSpec,
    hasMeaningfulMarkdownText,
    shouldRenderCardForMessage,
    shouldShowLoadingCardForMessage,
  ]);

  const handleOpenAttachmentFile = useCallback(async (attachment: ChatAttachment) => {
    const result = await openAttachmentWithSystem(attachment);
    if (!result.ok) {
      showAlert(result.message, '打开文件失败');
    }
  }, [showAlert]);

  const canOpenAttachmentFile = useCallback((attachment: ChatAttachment) => (
    desktopFileOpenSupported && canOpenAttachmentWithSystem(attachment)
  ), [desktopFileOpenSupported]);

  const resolveMessageAttachments = useCallback((msg: Message): readonly ChatAttachment[] => {
    const attachments = msg.attachments ?? [];
    if (attachments.length === 0) {
      return attachments;
    }

    const ownerAgentId = msg.agentId || agent.id;
    let resolved: ChatAttachment[] | null = null;

    attachments.forEach((attachment, index) => {
      if (attachment.kind !== 'image') {
        return;
      }
      const normalizedExistingAssetUrl = normalizeLocalManagementAssetUrl(apiBaseUrl, attachment.assetUrl);
      const fallbackStableAssetUrl = buildStableChatAttachmentAssetUrl(apiBaseUrl, ownerAgentId, attachment.relativePath);
      const nextAssetUrl = normalizedExistingAssetUrl || fallbackStableAssetUrl;
      if (!nextAssetUrl || nextAssetUrl === attachment.assetUrl) {
        return;
      }
      if (!resolved) {
        resolved = attachments.slice();
      }
      resolved[index] = {
        ...attachment,
        assetUrl: nextAssetUrl,
      };
    });

    return resolved ?? attachments;
  }, [agent.id, apiBaseUrl]);

  const resolveMessageTtsAssetUrl = useCallback((msg: Message, result: AgentTtsSynthesisResult): string | undefined => {
    const normalizedExistingAssetUrl = normalizeLocalManagementAssetUrl(apiBaseUrl, result.assetUrl);
    const fallbackStableAssetUrl = buildStableChatAttachmentAssetUrl(
      apiBaseUrl,
      msg.agentId || agent.id,
      result.relativePath,
    );
    return normalizedExistingAssetUrl || fallbackStableAssetUrl;
  }, [agent.id, apiBaseUrl]);

  const handleSynthesizeMessage = useCallback(async (msg: Message, options?: { autoPlay?: boolean }) => {
    const targetAgentId = (msg.agentId || agent.id || '').trim();
    const text = getDisplayMarkdownText(msg).trim();
    if (!targetAgentId || !text) {
      showAlert('当前消息没有可朗读的正文内容。', '生成语音失败');
      return;
    }

    messageTtsAbortControllersRef.current.get(msg.id)?.abort();
    const controller = new AbortController();
    messageTtsAbortControllersRef.current.set(msg.id, controller);

    setMessageTtsMap((prev) => ({
      ...prev,
      [msg.id]: {
        status: 'loading',
        result: prev[msg.id]?.result,
        playSignal: prev[msg.id]?.playSignal ?? 0,
        stopSignal: prev[msg.id]?.stopSignal ?? 0,
      },
    }));

    try {
      const result = await synthesizeAgentTts(targetAgentId, {
        text,
        speakerProfileId: msg.agentId && msg.agentId !== agent.id ? undefined : agent.ttsConfig?.speakerProfileId,
        format: 'wav',
        messageId: msg.id,
        signal: controller.signal,
      });
      messageTtsAbortControllersRef.current.delete(msg.id);
      setMessageTtsMap((prev) => ({
        ...prev,
        [msg.id]: {
          status: 'ready',
          result,
          playing: Boolean(options?.autoPlay),
          playSignal: (prev[msg.id]?.playSignal ?? 0) + 1,
          stopSignal: prev[msg.id]?.stopSignal ?? 0,
        },
      }));
    } catch (error) {
      messageTtsAbortControllersRef.current.delete(msg.id);
      if (controller.signal.aborted) {
        setMessageTtsMap((prev) => {
          const next = { ...prev };
          delete next[msg.id];
          return next;
        });
        return;
      }
      const message = error instanceof Error ? error.message : '生成语音失败，请稍后重试。';
      setMessageTtsMap((prev) => ({
        ...prev,
        [msg.id]: {
          status: 'error',
          error: message,
          playSignal: prev[msg.id]?.playSignal ?? 0,
          stopSignal: prev[msg.id]?.stopSignal ?? 0,
        },
      }));
      showAlert(message, '生成语音失败');
    }
  }, [agent.id, agent.ttsConfig?.speakerProfileId, getDisplayMarkdownText, showAlert]);

  const stopMessageTtsGeneration = useCallback((messageId: string) => {
    const controller = messageTtsAbortControllersRef.current.get(messageId);
    if (controller) {
      controller.abort();
      messageTtsAbortControllersRef.current.delete(messageId);
    }
  }, []);

  const toggleMessagePlayback = useCallback((msg: Message) => {
    const state = messageTtsMap[msg.id];
    if (state?.status === 'loading') {
      stopMessageTtsGeneration(msg.id);
      return;
    }
    if (state?.status === 'ready') {
      if (state.playing) {
        setMessageTtsMap((prev) => ({
          ...prev,
          [msg.id]: {
            ...prev[msg.id],
            status: 'ready',
            playing: false,
            stopSignal: (prev[msg.id]?.stopSignal ?? 0) + 1,
          },
        }));
        return;
      }
      setMessageTtsMap((prev) => ({
        ...prev,
        [msg.id]: {
          ...prev[msg.id],
          status: 'ready',
          playing: true,
          playSignal: (prev[msg.id]?.playSignal ?? 0) + 1,
        },
      }));
      return;
    }
    void handleSynthesizeMessage(msg, { autoPlay: true });
  }, [handleSynthesizeMessage, messageTtsMap, stopMessageTtsGeneration]);

  useEffect(() => {
    if (!agentTtsAvailable) {
      return;
    }
    for (const msg of messages) {
      if (msg.streaming || !hasRenderableMessageContent(msg)) {
        continue;
      }
      if (msg.role !== 'agent') {
        continue;
      }
      const trigger = getMessageTtsTrigger(msg);
      if (!trigger.tagged || !trigger.cleanText) {
        continue;
      }
      if (messageTtsMap[msg.id]) {
        continue;
      }
      if (autoTriggeredTtsMessageIdsRef.current.has(msg.id)) {
        continue;
      }
      autoTriggeredTtsMessageIdsRef.current.add(msg.id);
      void handleSynthesizeMessage(msg, { autoPlay: true });
    }
  }, [agentTtsAvailable, getMessageTtsTrigger, handleSynthesizeMessage, hasRenderableMessageContent, messageTtsMap, messages]);

  const renderMessageAttachments = useCallback((msg: Message, isUser: boolean) => {
    if (!msg.attachments || msg.attachments.length === 0) {
      return null;
    }

    return (
      <ChatAttachmentDeck
        attachments={resolveMessageAttachments(msg)}
        isUser={isUser}
        desktopFileOpenSupported={desktopFileOpenSupported}
        canOpenFile={canOpenAttachmentFile}
        onOpenFile={handleOpenAttachmentFile}
      />
    );
  }, [
    canOpenAttachmentFile,
    desktopFileOpenSupported,
    handleOpenAttachmentFile,
    resolveMessageAttachments,
  ]);

  const renderMessageActions = useCallback((msg: Message, isUser: boolean) => {
    if (isUser || msg.role !== 'agent') {
      return null;
    }
    const state = messageTtsMap[msg.id];
    if (!state || state.status !== 'error' || !state.error) {
      return null;
    }
    return (
      <div className="flex max-w-full flex-wrap items-center gap-2">
        <span className="max-w-full text-[11px] text-rose-500">{state.error}</span>
      </div>
    );
  }, [messageTtsMap]);

  const renderMessageMetaControl = useCallback((msg: Message, isUser: boolean) => {
    if (isUser || msg.role !== 'agent' || !agentTtsAvailable) {
      return null;
    }
    const trigger = getMessageTtsTrigger(msg);
    const state = messageTtsMap[msg.id];
    const shouldShow = trigger.tagged || Boolean(state);
    if (!shouldShow || !trigger.cleanText) {
      return null;
    }
    const title = state?.status === 'loading'
      ? '停止生成语音'
      : state?.playing
        ? '停止播放'
        : state?.status === 'ready'
          ? '播放语音'
          : trigger.tagged
            ? '生成语音'
            : '生成语音';
    return (
      <button
        type="button"
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
          state?.status === 'error'
            ? 'border-rose-500/40 text-rose-500 hover:bg-rose-500/10'
            : state?.status === 'loading' || state?.playing
              ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
              : 'border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
        onClick={() => toggleMessagePlayback(msg)}
        title={title}
        aria-label={title}
      >
        {state?.status === 'loading' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state?.playing ? (
          <Square className="h-2.5 w-2.5 fill-current" />
        ) : (
          <Volume2 className="h-3 w-3" />
        )}
      </button>
    );
  }, [agentTtsAvailable, getMessageTtsTrigger, messageTtsMap, toggleMessagePlayback]);

  const renderMessageFooter = useCallback((msg: Message, isUser: boolean) => {
    if (isUser) {
      return null;
    }
    const state = messageTtsMap[msg.id];
    if (!state || state.status !== 'ready' || !state.result) {
      return null;
    }
    const playbackUrl = resolveMessageTtsAssetUrl(msg, state.result);
    if (!playbackUrl) {
      return null;
    }
    return (
      <div className="w-full max-w-[420px] space-y-2">
        <GenUIAudioPlayer
          props={{
            src: playbackUrl,
            title: '语音回复',
            subtitle: state.result.speakerName || msg.agentName || agent.name,
            duration: state.result.durationSecs,
            minimal: true,
            showMpv: false,
            playSignal: state.playSignal ?? 0,
            stopSignal: state.stopSignal ?? 0,
            onPlaybackChange: (playing: boolean) => {
              setMessageTtsMap((prev) => {
                const current = prev[msg.id];
                if (!current || current.status !== 'ready' || current.playing === playing) {
                  return prev;
                }
                return {
                  ...prev,
                  [msg.id]: {
                    ...current,
                    playing,
                  },
                };
              });
            },
          }}
        />
        {state.result.warnings.length > 0 ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[11px] leading-5 text-amber-700">
            {state.result.warnings.join('；')}
          </div>
        ) : null}
      </div>
    );
  }, [agent.name, messageTtsMap, resolveMessageTtsAssetUrl]);

  const renderMessageBody = useCallback((
    msg: Message,
    isUser: boolean,
    options?: { deferHeavyUi?: boolean; includeProcessPanel?: boolean },
  ) => {
    const visibleMeta = getVisibleMessageMeta(msg.meta);
    return (
    <>
      {!isUser && msg.taskCard ? (
        <>
          {renderTaskCard(msg, msg.taskCard)}
          {msg.a2aCards && msg.a2aCards.length > 0 ? renderA2aCards(msg, msg.a2aCards) : null}
          {getDisplayMarkdownText(msg).trim() ? (
            <MarkdownBlock className={cn('chat-markdown chat-markdown-agent mt-2')} content={getDisplayMarkdownText(msg)} />
          ) : null}
        </>
      ) : (
      (() => {
        const mixedSegments = getMessageMixedSegments(msg, isUser);
        if (!isUser && mixedSegments.length > 0) {
          const hasLegacyJobProgressMixedSegment = mixedSegments.some((segment) => (
            segment.kind === 'ui' && getRenderableSpecType(segment.spec) === 'jobprogresscard'
          ));
          const showProcessPanel = options?.includeProcessPanel !== false
            && hasRuntimeLogData(msg)
            && !hasLegacyJobProgressMixedSegment;
          return (
            <>
              {showProcessPanel ? renderProcessPanel(msg.id, [msg]) : null}
              {mixedSegments.map((segment, index) => (
                segment.kind === 'markdown' ? (
                  <MarkdownBlock
                    key={`mixed-markdown-${msg.id}-${index}`}
                    className={cn('chat-markdown', 'chat-markdown-agent', index > 0 ? 'mt-3' : '')}
                    content={segment.content}
                  />
                ) : (
                  <div key={`mixed-ui-${msg.id}-${index}`} className={index > 0 ? 'mt-3' : ''}>
                    {renderSimpleCardSpec(segment.spec) ?? (
                      <DeferredUiCard shouldDefer={Boolean(options?.deferHeavyUi)}>
                        <DynamicUIRenderer
                          schema={segment.spec as any}
                          onAction={(actionId, payload) => handleUiAction(actionId, payload, { messageId: msg.id })}
                          agentId={agent.id}
                          messageId={msg.id}
                        />
                      </DeferredUiCard>
                    )}
                  </div>
                )
              ))}
            </>
          );
        }

        const shouldRenderCard = shouldRenderCardForMessage(msg, isUser);
        const renderableSpec = getRenderableUiSpec(msg.spec);
        const hasMarkdown = hasMeaningfulMarkdownText(msg);
        const rawMarkdownContent = isUser
          ? (msg.text || '')
          : (hasMarkdown ? getDisplayMarkdownText(msg) : '');
        const markdownContent = !isUser
          ? sanitizeMarkdownForRenderableSpec(rawMarkdownContent, renderableSpec)
          : rawMarkdownContent;
        const hasLegacyJobProgressSpec = getRenderableSpecType(renderableSpec) === 'jobprogresscard';
        const showProcessPanel = !isUser
          && options?.includeProcessPanel !== false
          && hasRuntimeLogData(msg)
          && !hasLegacyJobProgressSpec;
        return (
          <>
            {showProcessPanel ? renderProcessPanel(msg.id, [msg]) : null}
            {markdownContent ? (
              <MarkdownBlock
                className={cn('chat-markdown', isUser ? 'chat-markdown-user' : 'chat-markdown-agent')}
                content={markdownContent}
              />
            ) : null}
            {!isUser && shouldRenderCard && (
              <div className="mt-3">
                {renderSimpleCardSpec(renderableSpec) ?? (
                  <DeferredUiCard shouldDefer={Boolean(options?.deferHeavyUi)}>
                    <DynamicUIRenderer
                      schema={renderableSpec as any}
                      onAction={(actionId, payload) => handleUiAction(actionId, payload, { messageId: msg.id })}
                      agentId={agent.id}
                      messageId={msg.id}
                    />
                  </DeferredUiCard>
                )}
              </div>
            )}
            {!isUser && msg.a2aCards && msg.a2aCards.length > 0 ? renderA2aCards(msg, msg.a2aCards) : null}
          </>
        );
      })()
      )}
      {shouldShowLoadingCardForMessage(msg, isUser) ? (
        <div className="mt-3">{renderLoadingCard(msg)}</div>
      ) : null}
      {!isUser && visibleMeta && !visibleMeta.startsWith('auto_dispatch:')
        ? <div className="mt-2 text-[11px] text-muted-foreground">{visibleMeta}</div>
        : null}
    </>
    );
  }, [
    agent.id,
    getDisplayMarkdownText,
    getMessageMixedSegments,
    getRenderableUiSpec,
    handleUiAction,
    renderA2aCards,
    renderLoadingCard,
    renderProcessPanel,
    renderSimpleCardSpec,
    renderTaskCard,
    shouldRenderCardForMessage,
    shouldShowLoadingCardForMessage,
    hasMeaningfulMarkdownText,
  ]);

  const stableMessages = useMemo(() => {
    const working = messages
      .filter((msg) => !msg.streaming)
      .map((msg) => msg);
    for (let index = 0; index < working.length - 1; index += 1) {
      const current = working[index];
      const next = working[index + 1];
      if (!current || !next) {
        continue;
      }
      if (canCollapseBridgeMessage(current, next)) {
        working[index] = null as unknown as Message;
      }
    }
    return working.filter((msg): msg is Message => Boolean(msg) && hasRenderableMessageContent(msg));
  }, [hasRenderableMessageContent, messages]);
  const messageIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    messages.forEach((msg, index) => {
      map.set(msg.id, index);
    });
    return map;
  }, [messages]);
  const messageGroups = useMemo(() => {
    const groups: MessageRenderGroup[] = [];
    for (const msg of stableMessages) {
      const isUser = msg.role === 'user';
      const previousGroup = groups[groups.length - 1];
      const previousMessage = previousGroup?.messages[previousGroup.messages.length - 1];
      if (!previousGroup || !previousMessage) {
        groups.push({ id: msg.id, isUser, messages: [msg] });
        continue;
      }

      const previousTimestamp = previousMessage.timestamp ? Date.parse(previousMessage.timestamp) : NaN;
      const currentTimestamp = msg.timestamp ? Date.parse(msg.timestamp) : NaN;
      const withinWindow = Number.isFinite(previousTimestamp) && Number.isFinite(currentTimestamp)
        ? Math.abs(currentTimestamp - previousTimestamp) <= 120_000
        : false;
      const sameAgent = !isUser && !previousGroup.isUser
        ? ((previousMessage.agentId || previousMessage.agentName) === (msg.agentId || msg.agentName))
        : false;

      const shouldKeepSeparateGroups =
        hasRuntimeLogData(previousMessage)
        || hasRuntimeLogData(msg)
        || getMessageTtsTrigger(previousMessage).tagged
        || getMessageTtsTrigger(msg).tagged;
      if (!isUser && !previousGroup.isUser && sameAgent && withinWindow && !shouldKeepSeparateGroups) {
        previousGroup.messages.push(msg);
        continue;
      }

      groups.push({ id: msg.id, isUser, messages: [msg] });
    }
    return groups;
  }, [getMessageTtsTrigger, stableMessages]);
  const activeStreaming = useMemo(
    () => streamingMessage ?? messages.find((msg) => msg.streaming) ?? null,
    [messages, streamingMessage],
  );

  const streamingRow = useMemo(() => {
    if (!activeStreaming) {
      return null;
    }
    return (
      <div className="chat-message-row chat-message-row-agent mb-6">
        <div className="chat-avatar-frame">
          <AgentAvatar
            name={activeStreaming.agentName || agent.name}
            avatarUrl={activeStreaming.agentAvatarUrl || agent.avatarUrl}
            color={activeStreaming.agentColor || agent.color}
            size="md"
          />
        </div>
        <div className="flex flex-col w-full min-w-0">
          <div className="chat-message-meta">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              {activeStreaming.agentName || agent.name}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {activeStreaming.generationStartedAt != null
                ? formatElapsed(Math.max(0, nowMs - activeStreaming.generationStartedAt))
                : '...'}
            </span>
          </div>
          {renderLiveTraceTicker(activeStreaming)}
          <div className="chat-bubble-container flex w-full justify-start mt-1">
            <div className="chat-bubble chat-bubble-agent">{renderMessageBody(activeStreaming, false, { deferHeavyUi: false, includeProcessPanel: false })}</div>
          </div>
        </div>
      </div>
    );
  }, [activeStreaming, agent.avatarUrl, agent.color, agent.name, nowMs, renderLiveTraceTicker, renderMessageBody]);

  const readyAttachmentCount = composerAttachments.filter((item) => item.status === 'ready').length;
  const uploadingAttachmentCount = composerAttachments.filter((item) => item.status === 'uploading').length;
  const canSendMessage = !inputLocked && !composerSubmitting && uploadingAttachmentCount === 0 && (inputValue.trim().length > 0 || readyAttachmentCount > 0);
  const canUseQuickAction = !inputLocked && !composerSubmitting && !isSending && uploadingAttachmentCount === 0 && composerAttachments.length === 0;
  const showAutoConversationToggle = typeof onToggleAutoConversation === 'function';

  return (
    <div className="chat-main">
      {!hideHeader ? (
        <div className="chat-header">
          <div className="flex items-center gap-4 w-full h-full">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8 transition-colors', sidebarCollapsed ? 'text-foreground bg-accent/20' : 'text-muted-foreground')}
                onClick={onToggleSidebar}
                title={sidebarCollapsed ? t('chat.expandSidebar') : t('chat.collapseSidebar')}
              >
                <PanelLeft className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 flex flex-col justify-center overflow-hidden">
              <span className="font-semibold text-sm truncate">{agent.name}</span>
              <div className="flex items-center gap-1.5 leading-none mt-0.5">
                <div className={cn('w-1.5 h-1.5 rounded-full', displayStatus === 'online' ? 'bg-success' : 'bg-warning animate-pulse')} />
                <span className="text-[10px] text-muted-foreground font-medium truncate">
                  {displayStatus === 'online' ? t('status.online') : t('status.busy')}
                </span>
                {sessionTitle ? (
                  <span className="text-[10px] text-muted-foreground/80 truncate max-w-[220px]">
                    · {sessionTitle}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8 transition-colors', infoSidebarCollapsed ? 'text-foreground bg-accent/20' : 'text-muted-foreground')}
                onClick={onToggleInfoSidebar}
                title={infoSidebarCollapsed ? t('chat.expandInfo') : t('chat.collapseInfo')}
              >
                <PanelRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div ref={scrollRef} className="chat-messages" onScroll={handleScroll}>
        <div ref={contentRef} className="chat-messages-content">
          <ChatMessageList
            agentName={agent.name}
            agentAvatarUrl={agent.avatarUrl}
            agentColor={agent.color}
            isSending={isSending}
            messageGroups={messageGroups}
            messageIndexMap={messageIndexMap}
            stableMessagesLength={stableMessages.length}
            traceRenderToken={traceRenderToken}
            scrollContainerRef={scrollRef}
            renderMessageBody={renderMessageBody}
            renderMessageMetaControl={renderMessageMetaControl}
            renderMessageAttachments={renderMessageAttachments}
            renderMessageActions={renderMessageActions}
            renderMessageFooter={renderMessageFooter}
            hasMessageBubbleContent={hasMessageBubbleContent}
            renderProcessPanel={renderProcessPanel}
            canRegenerateAt={canRegenerateAt}
            formatElapsed={formatElapsed}
            onRegenerateMessage={onRegenerateMessage}
          />
          {streamingRow}
        </div>
      </div>

      <div className="chat-input-area">
        <div className="chat-input-container">
          <div className="chat-input-box">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void handlePickedFiles(event.target.files, 'image');
                event.currentTarget.value = '';
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void handlePickedFiles(event.target.files, 'file');
                event.currentTarget.value = '';
              }}
            />
            {inputToolbar ? (
              <div className="px-3 pt-3 pb-2 border-b border-border/30 bg-background/40">
                {inputToolbar}
              </div>
            ) : null}
            <Textarea
              value={inputValue}
              onChange={(e) => {
                if (typeof onUserActivity === 'function') {
                  onUserActivity('input');
                }
                setInputValue(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handleComposerPaste}
              onFocus={() => {
                if (typeof onUserActivity === 'function') {
                  onUserActivity('focus');
                }
              }}
              placeholder={autoConversationEnabled ? '自动群聊中，点击“自动中”可退出并恢复手动输入。' : t('chat.inputPlaceholder')}
              className="chat-input-field focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={inputLocked || composerSubmitting}
            />
            {composerAttachments.length > 0 ? (
              <div className="px-3 pb-3 space-y-2">
                <div className="grid gap-2">
                  {composerAttachments.map((attachment) => (
                    <div key={attachment.id} className="rounded-xl border border-border/60 bg-muted/10 p-2.5">
                      <div className="flex items-start gap-3">
                        {attachment.kind === 'image' && attachment.previewUrl ? (
                          <img
                            src={attachment.previewUrl}
                            alt={attachment.name}
                            className="h-14 w-14 rounded-lg object-cover border border-border/50"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-border/60 bg-background/70">
                            <Paperclip className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{attachment.name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {[attachment.kind === 'image' ? '图片' : '附件', formatAttachmentSize(attachment.size)].filter(Boolean).join(' · ')}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => handleRemoveComposerAttachment(attachment.id)}
                              disabled={inputLocked || composerSubmitting}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="mt-1 text-[11px]">
                            {attachment.status === 'uploading' ? (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                上传中...
                              </span>
                            ) : attachment.status === 'ready' ? (
                              <span className="text-emerald-600 break-all">
                                {attachment.relativePath}
                            {attachment.localVisionSummary ? ' · 已生成本地视觉文本' : ''}
                              </span>
                            ) : (
                              <span className="text-destructive break-all">{attachment.error || '上传失败'}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex items-center justify-between px-3 py-2 border-t border-border/30 bg-muted/10">
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                  disabled={inputLocked || composerSubmitting}
                  title={isDesktopRuntime ? '上传图片或 Ctrl+V 粘贴图片' : 'Web 端支持上传或粘贴小图片'}
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImageIcon className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                  disabled={inputLocked || composerSubmitting || !isDesktopRuntime}
                  title={isDesktopRuntime ? '上传附件或 Ctrl+V 粘贴文件' : 'Web 端暂不支持粘贴通用附件'}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                {contextUsage ? (
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn('w-8 h-8 rounded-lg transition-colors', meterTextClass, 'hover:text-foreground')}
                          title="查看上下文压力"
                        >
                          {contextUsage.loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Gauge className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="start" className="w-[260px] p-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-medium text-foreground">上下文压力</span>
                            <span className="text-muted-foreground">{estimatedPressurePercent}%</span>
                          </div>
                          <Progress value={estimatedPressurePercent} className="h-1.5" />
                          <div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                            <div>{currentTokenText}</div>
                            {estimatedContextTokenCount != null && estimatedTokenDelta > 0 ? (
                              <div>发送后约 {formatCount(estimatedContextTokenCount)} token</div>
                            ) : null}
                            <div>
                              近段上下文 {formatCount(contextUsage.recentMessageCount)} 条消息 / {formatCount(contextUsage.recentCharCount)} 字
                            </div>
                            <div>
                              自动压缩阈值: {formatCount(contextUsage.messageThreshold)} 条消息 或 {formatCount(contextUsage.charThreshold)} 字
                            </div>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {uploadingAttachmentCount > 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    附件上传中 {uploadingAttachmentCount}
                  </span>
                ) : null}
                {!isSending && showAutoConversationToggle ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={autoConversationEnabled ? 'default' : 'outline'}
                    className={cn(
                      'h-8 rounded-full px-3 text-xs transition-colors',
                      autoConversationEnabled ? 'bg-black text-white hover:bg-zinc-800' : 'border-border/60 text-muted-foreground hover:text-foreground',
                    )}
                    onClick={onToggleAutoConversation}
                    title={autoConversationEnabled ? '停止自动群聊' : '开启自动群聊'}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      {autoConversationEnabled ? '自动中' : '自动'}
                    </span>
                  </Button>
                ) : null}
                {isSending ? (
                  <Button onClick={onStopStreaming} size="sm" variant="outline" className="chat-stop-button" title="终止输出">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      {streamState === 'streaming' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-current" />}
                      终止输出
                    </span>
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full px-3 text-xs"
                      disabled={!canUseQuickAction}
                      onClick={() => void handleQuickActionSend('continue')}
                      title="让 AI 基于当前上下文继续输出"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronDown className="h-3.5 w-3.5" />
                        继续
                      </span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full px-3 text-xs"
                      disabled={!canUseQuickAction}
                      onClick={() => void handleQuickActionSend('options')}
                      title="让 AI 生成当前情境下的选项卡片"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <ListChecks className="h-3.5 w-3.5" />
                        选项
                      </span>
                    </Button>
                    <Button
                      onClick={() => void handleSend()}
                      disabled={!canSendMessage}
                      size="icon"
                      className="h-8 w-8 rounded-full shadow-md bg-black text-white hover:bg-zinc-800 active:scale-95 transition-all disabled:opacity-30"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
