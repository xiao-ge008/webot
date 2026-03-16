import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
  RotateCcw,
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { looksLikeProtocolOnlyText, normalizeIncomingSpec, parseJsonSafely, extractUiRawText, repairUiJsonString, sanitizeAiUiOutput, getBestEffortUiJsonBlocks } from '@/components/chat/chat-page-helpers';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Agent } from '@/types';
import type { ChatAttachment, Message, MessageTrace } from '@/data/mock-chats';
import type { ChatTaskCardData, ChatTaskLifecycleItem } from '@/types/chat-task';
import type { A2AWorkCardData } from '@/types/a2a';
import { DynamicUIRenderer } from '@/components/chat/DynamicUIRenderer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { uploadManagementAgentChatAsset } from '@/services/management-client';

type UserActivitySource = 'input' | 'send' | 'focus' | 'keydown' | 'ui_action';

const WEB_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const APP_FILE_MAX_BYTES = 32 * 1024 * 1024;
const A2A_PLACEHOLDER_AGENT_ID = 'unknown-agent';
const A2A_PLACEHOLDER_AGENT_NAME = '子智能体';

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)));
}

export interface ChatSendPayload {
  displayText: string;
  submitText: string;
  attachments?: ChatAttachment[];
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
  onSendMessage: (payload: ChatSendPayload) => void;
  onSendSilentMessage: (text: string) => void;
  onRegenerateMessage: (messageId: string) => void;
  onStopStreaming: () => void;
  onCreateTaskCard: (messageId: string) => void;
  onConfirmCreateTaskCard?: (messageId: string) => void;
  onCancelTaskCard: (messageId: string) => void;
  onDeleteTaskCard: (messageId: string) => void;
  onToggleAutoConversation?: () => void;
  onOpenTaskCardDetails: (input: { taskId?: string; messageId: string }) => void;
  onOpenA2aCardDetails: (messageId: string, cardId: string) => void;
  onConfirmGroupUpgrade?: (payload: GroupUpgradeActionPayload, ctx?: { messageId?: string }) => void;
  onCancelGroupUpgrade?: (payload: GroupUpgradeActionPayload, ctx?: { messageId?: string }) => void;
  onConfirmAgentManagement?: (payload: Record<string, unknown>, ctx?: { messageId?: string }) => void;
  onCancelAgentManagement?: (payload: Record<string, unknown>, ctx?: { messageId?: string }) => void;
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
  previewUrl?: string;
  error?: string;
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

function hasRuntimeLogData(msg: Message): boolean {
  return Boolean(
    (msg.thinkingTrace?.length ?? 0) > 0
    || (msg.toolTrace?.length ?? 0) > 0
    || (msg.debugNativeFrames || '').trim()
    || (msg.debugRawStream || '').trim()
    || (msg.uiRawText || '').trim()
    || (msg.debugNormalizedUiRawText || '').trim()
    || (msg.debugRepairedUiRawText || '').trim()
    || (msg.debugUiContractWarnings || '').trim()
    || (msg.text || '').trim()
    || msg.spec != null
    || (msg.debugNormalizedSpecText || '').trim()
    || typeof msg.debugProfileIntroDetected === 'boolean'
    || (msg.debugLegacySanitizer || '').trim()
    || (msg.debugSchemaSanitizer || '').trim()
    || typeof msg.debugMixedSegmentCount === 'number'
    || (msg.debugDonePayload || '').trim()
  );
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

const CHAT_ATTACHMENT_PROMPT_BEGIN = '[WEBOT_CHAT_ATTACHMENTS_BEGIN]';
const CHAT_ATTACHMENT_PROMPT_END = '[WEBOT_CHAT_ATTACHMENTS_END]';

function buildAttachmentPrompt(text: string, attachments: ChatAttachment[]): string {
  const userText = text.trim();
  const lines = attachments.map((attachment, index) => {
    const parts = [
      `${index + 1}. ${attachment.kind === 'image' ? '图片' : '附件'}：${attachment.name}`,
      `- 相对路径：${attachment.relativePath}`,
    ];
    if (attachment.savedPath?.trim()) {
      parts.push(`- 绝对路径：${attachment.savedPath.trim()}`);
    }
    if (attachment.mimeType?.trim()) {
      parts.push(`- MIME：${attachment.mimeType.trim()}`);
    }
    if (attachment.upstreamFileId?.trim()) {
      parts.push(`- OpenFang 文件ID：${attachment.upstreamFileId.trim()}`);
    }
    return parts.join('\n');
  });

  const attachmentBlock = attachments.length > 0
    ? [
      CHAT_ATTACHMENT_PROMPT_BEGIN,
      '以下文件已上传到当前智能体工作区的 data/chat-uploads 目录，请按需读取：',
      ...lines,
      '处理要求：',
      '- 若当前模型支持视觉，请优先直接查看图片附件。',
      '- 若当前模型不支持视觉，或附件不是图片，请使用文件读取类工具按上述路径读取。',
      '- 回复时优先引用文件名和关键结论，无需重复整段路径。',
      CHAT_ATTACHMENT_PROMPT_END,
    ].join('\n')
    : '';

  return [userText || '请先读取我刚上传的附件并继续处理。', attachmentBlock]
    .filter((item) => item.trim().length > 0)
    .join('\n\n');
}



export function ChatConversationPane({
  agent,
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
  onConfirmCreateTaskCard,
  onCancelTaskCard,
  onDeleteTaskCard,
  onToggleAutoConversation,
  onOpenTaskCardDetails,
  onOpenA2aCardDetails,
  onConfirmGroupUpgrade,
  onCancelGroupUpgrade,
  onConfirmAgentManagement,
  onCancelAgentManagement,
  sidebarCollapsed,
  onToggleSidebar,
  infoSidebarCollapsed,
  onToggleInfoSidebar,
}: ChatConversationPaneProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [traceOpen, setTraceOpen] = useState<Record<string, boolean>>({});
  const [copiedTraceKey, setCopiedTraceKey] = useState('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachmentDraft[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoStickToBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const mixedSegmentsCacheRef = useRef<Map<string, MixedRenderSegment[]>>(new Map());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerAttachmentsRef = useRef<ComposerAttachmentDraft[]>([]);
  const isDesktopRuntime = isTauriRuntime();
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
      if (messageId) {
        const owner = messages.find((msg) => msg.id === messageId);
        const ownerText = `${owner?.text || ''}\n${owner?.uiRawText || ''}`.trim();
        const looksLikeTaskProposal = Boolean(
          owner
          && owner.role === 'agent'
          && (owner.taskCard?.canCreate === true
            || /(任务名称|任务内容|执行间隔|总执行次数|定时任务|监控)/i.test(ownerText)),
        );

        if (looksLikeTaskProposal) {
          const intent = resolveTaskProposalOptionIntent(prompt);

          if (intent === 'confirm') {
            if (typeof onConfirmCreateTaskCard === 'function') {
              onConfirmCreateTaskCard(messageId);
            } else {
              onCreateTaskCard(messageId);
            }
            return;
          }

          if (intent === 'cancel') {
            onCancelTaskCard(messageId);
            return;
          }
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
    onCancelTaskCard,
    onConfirmAgentManagement,
    onConfirmCreateTaskCard,
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
    fileList: FileList | null,
    requestedKind: 'image' | 'file',
  ) => {
    const files = Array.from(fileList ?? []);
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

  const handleSend = () => {
    const readyAttachments = composerAttachments.filter((item) => item.status === 'ready');
    const uploadingCount = composerAttachments.filter((item) => item.status === 'uploading').length;
    if ((inputValue.trim().length === 0 && readyAttachments.length === 0) || inputLocked || uploadingCount > 0) return;
    if (typeof onUserActivity === 'function') {
      onUserActivity('send');
    }
    const attachments: ChatAttachment[] = readyAttachments.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      upstreamFileId: item.upstreamFileId,
      relativePath: item.relativePath || '',
      savedPath: item.savedPath,
      assetUrl: item.assetUrl,
      mimeType: item.mimeType,
      size: item.size,
    }));
    onSendMessage({
      displayText: inputValue.trim() || `已上传 ${attachments.length} 个附件`,
      submitText: buildAttachmentPrompt(inputValue, attachments),
      attachments,
    });
    setInputValue('');
    setComposerAttachments((prev) => {
      prev.forEach((item) => revokeComposerPreview(item.previewUrl));
      return [];
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (typeof onUserActivity === 'function') {
      onUserActivity('keydown');
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
  const formatElapsed = (ms?: number): string => {
    const safeMs = Math.max(0, ms || 0);
    if (safeMs < 60000) {
      const seconds = safeMs / 1000;
      return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}秒`;
    }
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}分${seconds.toString().padStart(2, '0')}秒`;
  };

  const canRegenerateAt = (index: number): boolean => {
    if (isSending) return false;
    const current = messages[index];
    if (!current || current.role !== 'agent') return false;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') {
        return true;
      }
    }
    return false;
  };

  const renderSimpleCardSpec = (spec: unknown) => {
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
  };

  const renderLoadingCard = (uiRawText?: string, uiStreamState?: 'idle' | 'streaming' | 'ready') => {
    const stageText = uiStreamState === 'streaming'
      ? '正在接收 UI 数据流…'
      : uiStreamState === 'ready'
        ? '正在渲染卡片组件…'
        : uiRawText
          ? '正在解析卡片结构…'
          : '等待卡片数据…';
    return (
      <Card className="mt-2 border-border/60 shadow-none bg-muted/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {stageText}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="chat-card-loading-shell">
            <div className="chat-card-loading-shimmer" />
            <div className="chat-card-loading-line w-[86%]" />
            <div className="chat-card-loading-line w-[64%]" />
            <div className="chat-card-loading-line w-[72%]" />
          </div>
        </CardContent>
      </Card>
    );
  };

  const taskStageLabel = (stage: ChatTaskCardData['stage']): string => {
    if (stage === 'proposal') return '待确认';
    if (stage === 'scheduled') return '等待执行';
    if (stage === 'running') return '执行中';
    if (stage === 'completed') return '已完成';
    if (stage === 'cancelled') return '已取消';
    return '执行失败';
  };

  const taskStageClass = (stage: ChatTaskCardData['stage']): string => {
    if (stage === 'completed') return 'bg-success';
    if (stage === 'running') return 'bg-primary';
    if (stage === 'cancelled') return 'bg-muted';
    if (stage === 'failed') return 'bg-destructive';
    return 'bg-warning';
  };

  const taskKindLabel = (kind?: ChatTaskCardData['taskKind']): string => {
    if (kind === 'chat_async') return '聊天异步任务';
    if (kind === 'manual_schedule') return '任务中心定时任务';
    if (kind === 'a2a_delegate') return '智能体委派任务';
    return '聊天定时任务';
  };

  const taskReportStatusLabel = (status?: ChatTaskCardData['reportStatus']): string => {
    if (status === 'acknowledged') return '已同步到当前会话';
    if (status === 'reported') return '已生成会话回执';
    return '待汇报';
  };

  const taskTimelineLabel = (kind: ChatTaskLifecycleItem['kind']): string => {
    if (kind === 'created') return '草案';
    if (kind === 'started') return '启动';
    if (kind === 'progress') return '进度';
    if (kind === 'anomaly') return '异常';
    if (kind === 'final') return '总结';
    if (kind === 'cancelled') return '取消';
    return '失败';
  };

  const taskTimelineClass = (entry: ChatTaskLifecycleItem): string => {
    if (entry.level === 'success' || entry.kind === 'final') return 'text-success';
    if (entry.level === 'error' || entry.kind === 'anomaly' || entry.kind === 'failed') return 'text-destructive';
    return 'text-primary';
  };

  const formatTaskTimelineTime = (raw: string): string => {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString();
  };

  const renderTaskCard = (msg: Message, taskCard: ChatTaskCardData) => {
    const stage = taskCard.stage;
    const logCount = taskCard.logCount ?? taskCard.runCount;
    const errorCount = taskCard.errorCount ?? 0;
    const hasFinalSummary = taskCard.finalSummaryReady === true;
    const canViewDetails = Boolean(
      taskCard.taskId
      || taskCard.timeline?.length
      || taskCard.finalSummaryText
      || taskCard.errorSummary
      || taskCard.bindingSourceMessageId,
    );
    const latestTimelineEntries = (taskCard.timeline ?? []).slice(-3).reverse();
    const finalSummaryPreview = (taskCard.finalSummaryText || '').trim();
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
      : '任务已开跑，当前仅支持取消，不可删除';
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
        deliveryStatus = '已完成（最终汇报已生成，点击查看明细）';
        deliveryClass = 'text-success';
      } else {
        deliveryStatus = '已完成（最终汇报生成中，点击查看明细）';
        deliveryClass = 'text-warning';
      }
    } else if (stage === 'cancelled') {
      deliveryStatus = '任务已取消（闭环终止）';
    } else if (stage === 'failed') {
      deliveryStatus = '任务创建或执行失败，请重试';
      deliveryClass = 'text-destructive';
    }
    return (
      <Card className="mt-2 border-border/60 shadow-none bg-card/70">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-warning" />
              {taskCard.taskName || '任务定时器'}
            </CardTitle>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold text-white', taskStageClass(taskCard.stage))}>
              {taskStageLabel(taskCard.stage)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="text-xs leading-6 text-foreground/85">
            <div><span className="font-semibold">任务内容：</span>{taskCard.objective || '-'}</div>
            <div className="flex items-center gap-1.5">
              <Clock3 className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{taskCard.scheduleText || '-'}</span>
            </div>
            <div>
              <span className="font-semibold">执行进度：</span>
              {taskCard.maxRuns > 0
                ? `${taskCard.runCount}/${taskCard.maxRuns}${typeof taskCard.progressPercent === 'number' ? `（${taskCard.progressPercent}%）` : ''}`
                : `${taskCard.runCount} 次`}
            </div>
            <div><span className="font-semibold">任务类型：</span>{taskKindLabel(taskCard.taskKind)}</div>
            <div><span className="font-semibold">执行人：</span>{taskCard.executorAgentName || '-'}</div>
            <div><span className="font-semibold">汇报人：</span>{taskCard.reportActorName || taskCard.executorAgentName || '-'}</div>
            <div><span className="font-semibold">汇报状态：</span>{taskReportStatusLabel(taskCard.reportStatus)}</div>
            <div>
              <span className="font-semibold">聊天回执：</span>
              <span className={deliveryClass}>{deliveryStatus}</span>
            </div>
            {taskCard.errorSummary ? <div><span className="font-semibold">异常摘要：</span>{taskCard.errorSummary}</div> : null}
            {finalSummaryPreview ? (
              <div><span className="font-semibold">最终总结：</span>{finalSummaryPreview.length > 160 ? `${finalSummaryPreview.slice(0, 160)}...` : finalSummaryPreview}</div>
            ) : null}
            {taskCard.nextRun ? <div><span className="font-semibold">下次执行：</span>{new Date(taskCard.nextRun).toLocaleString()}</div> : null}
            {taskCard.lastRun ? <div><span className="font-semibold">上次执行：</span>{new Date(taskCard.lastRun).toLocaleString()}</div> : null}
          </div>
          {latestTimelineEntries.length > 0 ? (
            <div className="rounded-xl border border-border/60 bg-muted/10 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">任务时间线</span>
                <span className="text-[10px] text-muted-foreground">{taskCard.timeline?.length || 0} 条</span>
              </div>
              <div className="space-y-2">
                {latestTimelineEntries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border/50 bg-background/80 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-[11px] font-semibold', taskTimelineClass(entry))}>
                        {taskTimelineLabel(entry.kind)} · {entry.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{formatTaskTimelineTime(entry.at)}</span>
                    </div>
                    {entry.detail ? (
                      <div className="mt-1 text-[11px] leading-5 text-foreground/80 whitespace-pre-wrap break-words">
                        {entry.detail}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {(stage === 'proposal' || stage === 'failed') ? (
              <Button
                type="button"
                size="sm"
                className="h-7 rounded-md px-3 text-[11px] font-bold"
                disabled={!canCreate}
                title={canCreate ? '' : createDisabledReason}
                onClick={() => {
                  if (typeof onConfirmCreateTaskCard === 'function') {
                    onConfirmCreateTaskCard(msg.id);
                    return;
                  }
                  onCreateTaskCard(msg.id);
                }}
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
            {canViewDetails ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 rounded-md px-3 text-[11px] font-semibold gap-1.5"
                onClick={() => onOpenTaskCardDetails({ taskId: taskCard.taskId, messageId: msg.id })}
              >
                <ListChecks className="w-3 h-3" />
                查看详情
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  };

  const a2aStatusText = (card: A2AWorkCardData): string => {
    if (card.status === 'working') return '工作中';
    if (card.status === 'completed') return '已完成';
    return '失败';
  };

  const renderA2aCards = (msg: Message, cards: A2AWorkCardData[]) => {
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
  };

  const renderTraceItems = (rows: MessageTrace[]) => (
    <div className="space-y-2 min-w-0">
      {rows.map((trace) => (
        <div key={trace.id} className="border-l border-border/60 pl-3 py-1 min-w-0 [contain:layout]">
          <div className="text-[11px] font-medium text-foreground/85 leading-5">{trace.title}</div>
          {trace.detail ? <div className="mt-1 rounded-sm bg-muted/20 px-2 py-1.5 text-[12px] leading-5 text-muted-foreground whitespace-pre-wrap break-all overflow-x-auto">{trace.detail}</div> : null}
          <div className="mt-1 text-[10px] text-muted-foreground/70">
            {new Date(trace.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      ))}
    </div>
  );

  const toggleTracePanel = (key: string) => {
    setTraceOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const copyTraceBlock = async (key: string, label: string, rows: MessageTrace[] | undefined) => {
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
  };

  const renderTraceBlock = (key: string, label: string, rows: MessageTrace[] | undefined) => {
    const count = rows?.length ?? 0;
    if (count <= 0) return null;
    const opened = Boolean(traceOpen[key]);
    return (
      <div className="mt-2 w-full rounded-md border border-border/50 bg-muted/10">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <button
            type="button"
            onClick={() => toggleTracePanel(key)}
            className="min-w-0 flex-1 inline-flex items-center justify-start gap-2 text-muted-foreground"
          >
            <span className="inline-flex items-center gap-2 text-[11px] leading-5 min-w-0">
              <span className="font-medium truncate">{label}</span>
              <span className="inline-flex items-center gap-0.5 text-muted-foreground/90 shrink-0">
                <span className="inline-flex w-8 justify-end tabular-nums font-mono">{count}</span>
                <span>?</span>
              </span>
              <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 transition-transform duration-150', opened ? 'rotate-180' : 'rotate-0')} />
            </span>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => copyTraceBlock(key, label, rows)}
            title={`??${label}`}
          >
            {copiedTraceKey === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
            opened ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-90',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="max-h-80 overflow-y-auto overflow-x-hidden px-2 pb-2 pt-0 min-w-0 overscroll-contain [scrollbar-gutter:stable]">
              {renderTraceItems(rows ?? [])}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const buildRuntimeLogRows = (msg: Message): MessageTrace[] => {
    const rows: MessageTrace[] = [];
    const baseAt = Number.isFinite(new Date(msg.timestamp).getTime()) ? new Date(msg.timestamp).getTime() : Date.now();
    let autoIndex = 0;

    const pushAutoRow = (title: string, detail?: string) => {
      const normalizedDetail = detail?.trim();
      if (!normalizedDetail) return;
      rows.push({
        id: `${msg.id}-runtime-${autoIndex}`,
        title,
        detail: normalizedDetail,
        at: new Date(baseAt + autoIndex).toISOString(),
      });
      autoIndex += 1;
    };

    const nativeFrames = (msg.debugNativeFrames || '').trim();
    if (nativeFrames) {
      const frameBlocks = nativeFrames
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);
      frameBlocks.forEach((block) => {
        const eventMatch = block.match(/event:\s*([^\n\r]+)/i);
        const payloadMatch = block.match(/payload:\s*([\s\S]+)/i);
        const frameMatch = block.match(/frame:\s*([\s\S]+)/i);
        const eventName = eventMatch?.[1]?.trim() || 'native';
        const detail = payloadMatch?.[1]?.trim() || frameMatch?.[1]?.trim() || block;
        pushAutoRow(`事件 · ${eventName}`, detail);
      });
    }

    (msg.thinkingTrace ?? []).forEach((row) => {
      rows.push({
        ...row,
        title: `思考 · ${row.title}`,
      });
    });

    (msg.toolTrace ?? []).forEach((row) => {
      rows.push({
        ...row,
        title: `工具 · ${row.title}`,
      });
    });

    if (msg.debugRawStream?.trim()) {
      pushAutoRow('正文流累计', msg.debugRawStream);
    }
    if (msg.uiRawText?.trim()) {
      pushAutoRow('UI_JSON 原文', msg.uiRawText);
    }
    if (msg.debugNormalizedUiRawText?.trim()) {
      pushAutoRow('UI_JSON 归一后', msg.debugNormalizedUiRawText);
    }
    if (msg.debugRepairedUiRawText?.trim()) {
      pushAutoRow('UI_JSON 修复后', msg.debugRepairedUiRawText);
    }
    if (msg.debugUiContractWarnings?.trim()) {
      pushAutoRow('UI_JSON Contract 警告', msg.debugUiContractWarnings);
    }
    if (msg.text?.trim()) {
      pushAutoRow('最终正文', msg.text);
    }
    if (msg.spec != null) {
      try {
        const specText = typeof msg.spec === 'string' ? msg.spec : JSON.stringify(msg.spec, null, 2);
        pushAutoRow('最终卡片 JSON', specText);
      } catch {
        pushAutoRow('最终卡片 JSON', String(msg.spec));
      }
    }
    if (msg.debugNormalizedSpecText?.trim()) {
      pushAutoRow('归一后 Spec', msg.debugNormalizedSpecText);
    }
    if (typeof msg.debugProfileIntroDetected === 'boolean') {
      pushAutoRow('检测到 ProfileIntroCard', msg.debugProfileIntroDetected ? 'yes' : 'no');
    }
    if (msg.debugLegacySanitizer?.trim()) {
      pushAutoRow('Legacy Sanitizer', msg.debugLegacySanitizer);
    }
    if (msg.debugSchemaSanitizer?.trim()) {
      pushAutoRow('Schema Sanitizer', msg.debugSchemaSanitizer);
    }
    if (typeof msg.debugMixedSegmentCount === 'number') {
      pushAutoRow('MixedSegments 数量', String(msg.debugMixedSegmentCount));
    }
    if (msg.debugDonePayload?.trim()) {
      pushAutoRow('Done Payload', msg.debugDonePayload);
    }

    return rows
      .filter((row) => row.detail && row.detail.trim().length > 0)
      .sort((a, b) => {
        const aTime = new Date(a.at).getTime();
        const bTime = new Date(b.at).getTime();
        return aTime - bTime;
      });
  };

  const buildRuntimeLogRowsForMessages = (items: Message[]): MessageTrace[] =>
    items
      .flatMap((item) => buildRuntimeLogRows(item))
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const renderProcessPanel = (key: string, items: Message[]) => {
    if (!items.some((item) => hasRuntimeLogData(item))) {
      return null;
    }
    return renderTraceBlock(`${key}-runtime-log`, '运行日志', buildRuntimeLogRowsForMessages(items));
  };

  const hasMeaningfulMarkdownText = (msg: Message): boolean => {
    const text = (msg.text || '').trim();
    if (!text) return false;
    if (
      msg.spec != null
      && /^(已生成卡片结果。?|已根据工具调用日志生成兜底卡片。?)$/u.test(text)
    ) {
      return false;
    }
    return !looksLikeProtocolOnlyText(text);
  };

  const shouldRenderCardForMessage = (msg: Message, isUser: boolean): boolean => {
    if (isUser || msg.spec == null) return false;
    return true;
  };

  const shouldShowLoadingCardForMessage = (msg: Message, isUser: boolean): boolean => {
    if (isUser) return false;
    if (msg.spec != null) return false;
    if (!(msg.cardPending || msg.uiStreamState === 'streaming')) return false;
    if (hasMeaningfulMarkdownText(msg)) return false;
    return true;
  };

  type MixedRenderSegment =
    | { kind: 'markdown'; content: string }
    | { kind: 'ui'; spec: unknown };

  const extractMixedSegments = (raw: string): MixedRenderSegment[] => {
    const source = sanitizeAiUiOutput(raw).trim();
    if (!source || !source.includes('<UI_JSON>')) return [];

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
        const spec = normalizeIncomingSpec(parsed);
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
  };

  const getCachedMixedSegments = useCallback((messageId: string, raw: string): MixedRenderSegment[] => {
    const source = sanitizeAiUiOutput(raw).trim();
    if (!source || !source.includes('<UI_JSON>')) return [];
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
  }, []);

  const renderMessageBody = (
    msg: Message,
    isUser: boolean,
    options?: { deferHeavyUi?: boolean; includeProcessPanel?: boolean },
  ) => (
    <>
      {msg.attachments && msg.attachments.length > 0 ? (
        <div className={cn('mb-3 grid gap-2', msg.attachments.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
          {msg.attachments.map((attachment) => (
            <div key={attachment.id} className="rounded-xl border border-border/60 bg-background/50 p-2.5">
              {attachment.kind === 'image' && attachment.assetUrl ? (
                <a
                  href={attachment.assetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-border/50 bg-muted/20"
                >
                  <img
                    src={attachment.assetUrl}
                    alt={attachment.name}
                    loading="lazy"
                    decoding="async"
                    className="h-40 w-full object-cover"
                  />
                </a>
              ) : null}
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{attachment.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {attachment.kind === 'image' ? '图片' : '附件'}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground break-all">{attachment.relativePath}</div>
                {attachment.assetUrl ? (
                  <a
                    href={attachment.assetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-[11px] text-accent hover:underline"
                  >
                    打开文件
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {!isUser && msg.taskCard ? (
        <>
          {renderTaskCard(msg, msg.taskCard)}
          {msg.a2aCards && msg.a2aCards.length > 0 ? renderA2aCards(msg, msg.a2aCards) : null}
          {msg.text?.trim() ? (
            <MarkdownBlock className={cn('chat-markdown chat-markdown-agent mt-2')} content={msg.text} />
          ) : null}
        </>
      ) : (
      (() => {
        const mixedSource = !isUser
          ? [
            typeof msg.debugRawStream === 'string' ? msg.debugRawStream : '',
            typeof msg.uiRawText === 'string' ? msg.uiRawText : '',
            typeof msg.text === 'string' ? extractUiRawText(msg.text) : '',
            typeof msg.text === 'string' ? msg.text : '',
          ].find((item) => item.includes('<UI_JSON>')) || ''
          : '';
        const mixedSegments = !isUser ? getCachedMixedSegments(msg.id, mixedSource) : [];
        if (!isUser) {
          msg.debugMixedSegmentCount = mixedSegments.length;
        }
        if (!isUser && mixedSegments.length > 0) {
          return (
            <>
              {!isUser && options?.includeProcessPanel !== false ? renderProcessPanel(msg.id, [msg]) : null}
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
        const hasMarkdown = hasMeaningfulMarkdownText(msg);
        const markdownContent = isUser
          ? (msg.text || '')
          : (hasMarkdown ? (msg.text || '') : '');
        return (
          <>
            {!isUser && options?.includeProcessPanel !== false ? renderProcessPanel(msg.id, [msg]) : null}
            {markdownContent ? (
              <MarkdownBlock
                className={cn('chat-markdown', isUser ? 'chat-markdown-user' : 'chat-markdown-agent')}
                content={markdownContent}
              />
            ) : null}
            {!isUser && shouldRenderCard && (
              <div className="mt-3">
                {renderSimpleCardSpec(msg.spec) ?? (
                  <DeferredUiCard shouldDefer={Boolean(options?.deferHeavyUi)}>
                    <DynamicUIRenderer
                      schema={msg.spec as any}
                      onAction={(actionId, payload) => handleUiAction(actionId, payload, { messageId: msg.id })}
                      agentId={agent.id}
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
        <div className="mt-3">{renderLoadingCard(msg.uiRawText, msg.uiStreamState)}</div>
      ) : null}
      {!isUser && msg.meta && !msg.meta.startsWith('auto_dispatch:')
        ? <div className="mt-2 text-[11px] text-muted-foreground">{msg.meta}</div>
        : null}
    </>
  );

  const stableMessages = useMemo(() => messages.filter((msg) => !msg.streaming), [messages]);
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

      const shouldKeepSeparateGroups = hasRuntimeLogData(previousMessage) || hasRuntimeLogData(msg);
      if (!isUser && !previousGroup.isUser && sameAgent && withinWindow && !shouldKeepSeparateGroups) {
        previousGroup.messages.push(msg);
        continue;
      }

      groups.push({ id: msg.id, isUser, messages: [msg] });
    }
    return groups;
  }, [stableMessages]);
  const activeStreaming = useMemo(
    () => streamingMessage ?? messages.find((msg) => msg.streaming) ?? null,
    [messages, streamingMessage],
  );

  const messageRows = useMemo(() => (
    <>
      {messageGroups.map((group, groupIndex) => {
        const groupMessages = group.messages;
        const msg = groupMessages[groupMessages.length - 1];
        const isUser = group.isUser;
        const originalIndex = messageIndexMap.get(msg.id) ?? groupIndex;
        const deferHeavyUi = !isUser && stableMessages.length > 18 && originalIndex < stableMessages.length - 6;
        const canRegenerate = canRegenerateAt(originalIndex);
        const messageAgentName = !isUser ? (msg.agentName || agent.name) : '';
        const messageAgentAvatarUrl = !isUser ? (msg.agentAvatarUrl || agent.avatarUrl) : undefined;
        const messageAgentColor = !isUser ? (msg.agentColor || agent.color) : undefined;
        const showMeta = true;
        const elapsedText = msg.role === 'agent' && msg.generationElapsedMs != null
          ? formatElapsed(msg.generationElapsedMs)
          : '';
        return (
          <div key={group.id} className={cn('chat-message-row', 'mb-6', isUser ? 'chat-message-row-user' : 'chat-message-row-agent')}>
            {!isUser && showMeta && (
              <div className="chat-avatar-frame">
                <AgentAvatar name={messageAgentName} avatarUrl={messageAgentAvatarUrl} color={messageAgentColor} size="md" />
              </div>
            )}
            <div className="flex flex-col w-full min-w-0">
              {!isUser && showMeta && (
                <div className="chat-message-meta flex items-center justify-between">
                  <div className="chat-message-meta-left">
                    <span className="text-xs font-bold text-muted-foreground">{messageAgentName}</span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {elapsedText ? (
                      <span className="text-[10px] text-muted-foreground/80">耗时 {elapsedText}</span>
                    ) : null}
                    {canRegenerate ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-muted-foreground"
                        onClick={() => onRegenerateMessage(msg.id)}
                        title="重复生成本条回复"
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        重复生成
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
              <div className={cn('chat-bubble-container flex w-full', isUser ? 'justify-end' : 'justify-start mt-1')}>
                <div className={cn('chat-bubble', isUser ? 'chat-bubble-user' : 'chat-bubble-agent')}>
                  {!isUser ? renderProcessPanel(group.id, groupMessages) : null}
                  <div className={cn(groupMessages.length > 1 ? 'space-y-4' : '')}>
                    {groupMessages.map((item, itemIndex) => (
                      <div
                        key={item.id}
                        data-message-id={item.id}
                        className={cn(
                          'transition-colors',
                          itemIndex > 0 ? 'border-t border-border/40 pt-4' : '',
                        )}
                      >
                        {renderMessageBody(item, isUser, {
                          deferHeavyUi,
                          includeProcessPanel: false,
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  ), [agent.avatarUrl, agent.color, agent.name, canRegenerateAt, messageGroups, messageIndexMap, onRegenerateMessage, renderMessageBody, stableMessages]);

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
          <div className="chat-bubble-container flex w-full justify-start mt-1">
            <div className="chat-bubble chat-bubble-agent">{renderMessageBody(activeStreaming, false, { deferHeavyUi: false })}</div>
          </div>
        </div>
      </div>
    );
  }, [activeStreaming, agent.avatarUrl, agent.color, agent.name, nowMs, renderMessageBody]);

  const readyAttachmentCount = composerAttachments.filter((item) => item.status === 'ready').length;
  const uploadingAttachmentCount = composerAttachments.filter((item) => item.status === 'uploading').length;
  const canSendMessage = !inputLocked && uploadingAttachmentCount === 0 && (inputValue.trim().length > 0 || readyAttachmentCount > 0);
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
          {messageRows}
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
              onFocus={() => {
                if (typeof onUserActivity === 'function') {
                  onUserActivity('focus');
                }
              }}
              placeholder={autoConversationEnabled ? '自动群聊中，点击“自动中”可退出并恢复手动输入。' : t('chat.inputPlaceholder')}
              className="chat-input-field focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={inputLocked}
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
                              <span className="text-emerald-600 break-all">{attachment.relativePath}</span>
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
                  disabled={inputLocked}
                  title={isDesktopRuntime ? '上传图片' : 'Web 端支持上传小图片'}
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImageIcon className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                  disabled={inputLocked || !isDesktopRuntime}
                  title={isDesktopRuntime ? '上传附件' : 'Web 端暂不支持通用附件'}
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
                  <Button
                    onClick={handleSend}
                    disabled={!canSendMessage}
                    size="icon"
                    className="h-8 w-8 rounded-full shadow-md bg-black text-white hover:bg-zinc-800 active:scale-95 transition-all disabled:opacity-30"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
