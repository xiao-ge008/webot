import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SetStateAction } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { compileSpecStream } from '@json-render/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, GripVertical, X } from 'lucide-react';
import { mockAgents } from '@/data/mock-agents';
import { type ChatAttachment, type Message, type MessageToolCall, type MessageTrace } from '@/data/mock-chats';
import { cn } from '@/lib/utils';
import { isHiddenSystemPromptText } from '@/lib/chat-message-filter';
import { ChatRenderer } from '@/components/chat/ChatRenderer';
import type { ChatSendPayload, GroupUpgradeActionPayload } from '@/components/chat/ChatConversationPane';
import { TaskDetailsDialog } from '@/components/tasks/TaskDetailsDialog';
import { A2AWorkDetailsDialog } from '@/components/tasks/A2AWorkDetailsDialog';
import type { Agent } from '@/types';
import type { Task, TaskRunRecord } from '@/types/tasks';
import type { ChatTaskCardData } from '@/types/chat-task';
import type { A2AWorkCardData, A2AWorkLogItem } from '@/types/a2a';
import { CHAT_CHANNELS, CHAT_RENDER_MODES } from '@/main/types';
import { cancelAgentChat, sendAgentChat, subscribeAgentChatStream, withChatRenderContext } from '@/services/agent-client';
import type { StoredChatSession } from '@/services/chat-session-store';
import { chatRuntimeStore, useChatRuntimeSelector } from '@/services/chat-runtime-store';
import { ensureChatRuntimeStreamPump } from '@/services/chat-runtime-stream-pump';
import { getManagementAgentDetail, listManagementAgents } from '@/services/management-client';
import { createChatGroup } from '@/services/group-client';
import { executeAgentManagementAction } from '@/services/agent-management-workflow';
import { requestJson } from '@/services/transport';
import {
    createTask,
    deleteTask,
    getTaskDetail,
    getTaskFinalSummary,
    hasTaskFinalSummaryDelivered,
    listTaskRuns,
    pauseTask,
    runTaskNow,
    setTaskCenterAgentId,
} from '@/services/task-client';
import { pushInAppNotice } from '@/services/in-app-notifier';
import {
    appendThinkingStream,
    buildHistory,
    buildInitialMessages,
    buildFallbackSpecFromToolTrace,
    cleanupAssistantText,
    extractLatestToolReadableText,
    extractThinkingFromTaggedText,
    extractReadableTextFromLog,
    extractToolCallTitles,
    extractUiRawText,
    findUiBoundary,
    generateId,
    looksLikeProtocolOnlyText,
    mapManagementAgentToUi,
    normalizeIncomingSpec,
    parseJsonSafely,
    parseTraceFromLog,
    pushTrace,
    repairUiJsonString,
    getManifestSchemaFromCache,
    sanitizeAssistantText,
    stripThinkingBlocks,
    tryParseInlineSpecFromText,
} from '@/components/chat/chat-page-helpers';

type StreamState = 'idle' | 'streaming' | 'waiting';
type ChatSession = StoredChatSession;
type IdleAutoScope = 'agent' | 'group';

interface IdleAutoConfig {
    enabled?: boolean;
    scope?: IdleAutoScope;
    scopeId?: string;
    idleMs?: number;
    maxPerPage?: number;
    maxPerDay?: number;
    cooldownMs?: number;
    agentOverride?: Agent;
}

const GROUP_UPGRADE_SYSTEM_PREAMBLE = [
    '[system:group-upgrade]',
    '当你判断需要引入其他智能体协作时，不要自动拉群，必须先征求用户同意。',
    '请输出 UI_JSON 卡片，type=GroupUpgradeCard，并在 props 中填写：',
    '- reason: 说明为何需要多人协作',
    '- memberAgentIds 或 members: 拟邀请的成员（可填成员 id 或 name）',
    '- 可选 groupName/description/tags',
    '用户点击“同意拉群”后系统会自动创建群聊；若用户拒绝，则停止拉人。',
    '示例：',
    '<UI_JSON>',
    '{"type":"GroupUpgradeCard","props":{"title":"建议升级为群聊","reason":"需要前端与后端协作","memberAgentIds":["agent_frontend","agent_backend"],"groupName":"临时协作群"}}',
    '</UI_JSON>',
].join('\n');

const REMOTE_SESSION_INITIAL_BATCH = 20;
const REMOTE_SESSION_LOAD_MORE_BATCH = 20;
const REMOTE_SESSION_DETAIL_CONCURRENCY = 6;

function buildGroupUpgradeSystemPreamble(): string {
    return GROUP_UPGRADE_SYSTEM_PREAMBLE;
}

const A2A_PLACEHOLDER_AGENT_ID = 'unknown-agent';
const A2A_PLACEHOLDER_AGENT_NAME = '子智能体';

function areMessagesEquivalent(left: Message[], right: Message[]): boolean {
    if (left === right) {
        return true;
    }
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        const l = left[index];
        const r = right[index];
        if (!l || !r) return false;
        if (
            l.id !== r.id ||
            l.role !== r.role ||
            l.text !== r.text ||
            l.streaming !== r.streaming ||
            l.cardPending !== r.cardPending ||
            JSON.stringify(l.attachments ?? null) !== JSON.stringify(r.attachments ?? null) ||
            JSON.stringify(l.taskCard ?? null) !== JSON.stringify(r.taskCard ?? null) ||
            JSON.stringify(l.a2aCards ?? null) !== JSON.stringify(r.a2aCards ?? null)
        ) {
            return false;
        }
    }
    return true;
}

function shortenSessionTitle(raw: string): string {
    const normalized = raw.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 18) {
        return normalized;
    }
    return `${normalized.slice(0, 18)}...`;
}

const UUID_LIKE_TITLE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isOpaqueSessionTitle(raw: string): boolean {
    const title = raw.trim();
    if (!title) return true;
    if (UUID_LIKE_TITLE_PATTERN.test(title)) return true;
    if (/^(session|remote|imported|sync|chat)_[a-z0-9_-]{8,}$/i.test(title)) return true;
    if (/^[a-z0-9_-]{24,}$/i.test(title) && /[0-9]/.test(title) && !/[\u4e00-\u9fa5]/.test(title)) return true;
    return false;
}

function normalizeSessionDisplayTitle(raw: string, fallback: string): string {
    const normalized = raw.replace(/\s+/g, ' ').trim();
    if (!normalized) return fallback;
    if (isOpaqueSessionTitle(normalized)) return fallback;
    return normalized;
}

function normalizeLabelComponent(raw: string, maxLen: number): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    let out = '';
    for (const ch of trimmed) {
        if (out.length >= maxLen) break;
        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '-' || ch === '_') {
            out += ch;
        } else {
            out += '_';
        }
    }
    return out.replace(/^_+|_+$/g, '');
}

function buildLocalSessionLabel(sessionId: string): string {
    return normalizeLabelComponent(sessionId, 96);
}

function isWebRuntime(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    const globalWindow = window as unknown as { __TAURI_INTERNALS__?: unknown };
    return !globalWindow.__TAURI_INTERNALS__;
}

function parseBackendMessageRole(value: unknown): Message['role'] {
    const role = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (role.includes('user')) return 'user';
    if (role.includes('assistant') || role.includes('agent')) return 'agent';
    return 'system';
}

const CHAT_ATTACHMENT_PROMPT_BEGIN = '[WEBOT_CHAT_ATTACHMENTS_BEGIN]';
const CHAT_ATTACHMENT_PROMPT_END = '[WEBOT_CHAT_ATTACHMENTS_END]';
const CHAT_ATTACHMENT_LEGACY_HEADER = '以下文件已上传到当前智能体工作区的 data/chat-uploads 目录，请按需读取：';

function buildRecoveredChatAssetUrl(agentId: string | undefined, relativePath: string): string | undefined {
    const normalizedAgentId = agentId?.trim();
    const normalizedPath = relativePath.trim();
    if (!normalizedAgentId || !normalizedPath) {
        return undefined;
    }
    return `/api/management/agents/${encodeURIComponent(normalizedAgentId)}/chat-assets/file?path=${encodeURIComponent(normalizedPath)}`;
}

function parseEmbeddedChatAttachments(text: string, ownerAgentId?: string): {
    displayText: string;
    attachments?: ChatAttachment[];
} {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return { displayText: '' };
    }

    let blockStart = normalized.lastIndexOf(CHAT_ATTACHMENT_PROMPT_BEGIN);
    let blockEnd = blockStart >= 0 ? normalized.indexOf(CHAT_ATTACHMENT_PROMPT_END, blockStart) : -1;
    if (blockStart < 0) {
        blockStart = normalized.indexOf(CHAT_ATTACHMENT_LEGACY_HEADER);
        blockEnd = normalized.length;
    }
    if (blockStart < 0) {
        return { displayText: normalized };
    }

    const displayText = normalized.slice(0, blockStart).trim();
    const rawBlock = normalized
        .slice(blockStart + (normalized.startsWith(CHAT_ATTACHMENT_PROMPT_BEGIN, blockStart) ? CHAT_ATTACHMENT_PROMPT_BEGIN.length : 0), blockEnd >= 0 ? blockEnd : undefined)
        .trim();
    const lines = rawBlock
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const attachments: ChatAttachment[] = [];
    let current: Partial<ChatAttachment> | null = null;
    for (const line of lines) {
        const headMatch = line.match(/^(\d+)\.\s*(图片|附件)：(.+)$/);
        if (headMatch) {
            if (current?.name && current.relativePath) {
                attachments.push({
                    id: current.id || `remote_attachment_${attachments.length}`,
                    kind: current.kind === 'image' ? 'image' : 'file',
                    name: current.name,
                    relativePath: current.relativePath,
                    savedPath: current.savedPath,
                    assetUrl: current.assetUrl,
                    mimeType: current.mimeType,
                    size: current.size,
                    upstreamFileId: current.upstreamFileId,
                });
            }
            current = {
                id: `remote_attachment_${headMatch[1]}`,
                kind: headMatch[2] === '图片' ? 'image' : 'file',
                name: headMatch[3].trim(),
            };
            continue;
        }
        if (!current || !line.startsWith('- ')) {
            continue;
        }
        if (line.startsWith('- 相对路径：')) {
            const relativePath = line.slice('- 相对路径：'.length).trim();
            current.relativePath = relativePath;
            current.assetUrl = buildRecoveredChatAssetUrl(ownerAgentId, relativePath);
            continue;
        }
        if (line.startsWith('- 绝对路径：')) {
            current.savedPath = line.slice('- 绝对路径：'.length).trim();
            continue;
        }
        if (line.startsWith('- MIME：')) {
            current.mimeType = line.slice('- MIME：'.length).trim();
            continue;
        }
        if (line.startsWith('- OpenFang 文件ID：')) {
            current.upstreamFileId = line.slice('- OpenFang 文件ID：'.length).trim();
        }
    }
    if (current?.name && current.relativePath) {
        attachments.push({
            id: current.id || `remote_attachment_${attachments.length}`,
            kind: current.kind === 'image' ? 'image' : 'file',
            name: current.name,
            relativePath: current.relativePath,
            savedPath: current.savedPath,
            assetUrl: current.assetUrl,
            mimeType: current.mimeType,
            size: current.size,
            upstreamFileId: current.upstreamFileId,
        });
    }

    return {
        displayText,
        attachments: attachments.length > 0 ? attachments : undefined,
    };
}

function normalizeBackendMessage(role: Message['role'], raw: string, ownerAgentId?: string): {
    text: string;
    attachments?: ChatAttachment[];
} {
    const text = raw.replace(/\r\n/g, '\n').trim();
    if (!text) {
        return { text: '' };
    }
    if (role === 'agent') {
        const cleaned = sanitizeAssistantText(stripThinkingBlocks(text)).trim();
        return { text: isHiddenSystemPromptText(cleaned) ? '' : cleaned };
    }
    if (role === 'user') {
        const lower = text.toLowerCase();
        const marker = lower.lastIndexOf('[user]');
        if (marker >= 0) {
            const extracted = text.slice(marker + '[user]'.length).trim();
            if (isHiddenSystemPromptText(extracted)) {
                return { text: '' };
            }
            const parsed = parseEmbeddedChatAttachments(extracted, ownerAgentId);
            return { text: parsed.displayText, attachments: parsed.attachments };
        }
        // OpenFang session 里带系统前缀但没有 user 段时，不回填这类上下文注入内容。
        if (lower.includes('[system:')) {
            return { text: '' };
        }
        const parsed = parseEmbeddedChatAttachments(text, ownerAgentId);
        return { text: isHiddenSystemPromptText(parsed.displayText) ? '' : parsed.displayText, attachments: parsed.attachments };
    }
    return { text: isHiddenSystemPromptText(text) ? '' : text };
}

function parseBackendToolCalls(raw: unknown): MessageToolCall[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }
    const tools: MessageToolCall[] = [];
    for (let index = 0; index < raw.length; index += 1) {
        const item = raw[index];
        if (!item || typeof item !== 'object') {
            continue;
        }
        const tool = item as Record<string, unknown>;
        const name = typeof tool.name === 'string' ? tool.name.trim() : '';
        if (!name) {
            continue;
        }
        tools.push({
            id: `remote_tool_${Date.now()}_${index}`,
            name,
            running: false,
            expanded: false,
            input: typeof tool.input === 'string' ? tool.input : undefined,
            result: typeof tool.result === 'string' ? tool.result : undefined,
            is_error: typeof tool.is_error === 'boolean' ? tool.is_error : undefined,
        });
    }
    return tools.length > 0 ? tools : undefined;
}

function parseBackendTimestampMs(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 0 && value < 10_000_000_000) {
            return value * 1000;
        }
        return value;
    }
    if (typeof value === 'string' && value.trim()) {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
            if (asNumber > 0 && asNumber < 10_000_000_000) {
                return asNumber * 1000;
            }
            return asNumber;
        }
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return Date.now();
}

function inferSessionSource(label: string): 'app' | 'web' | 'unknown' {
    const normalized = label.trim().toLowerCase();
    if (!normalized) return 'unknown';
    if (/(^|[_-])(app|desktop|tauri)([_-]|$)/.test(normalized)) return 'app';
    if (/(^|[_-])(web|browser|h5)([_-]|$)/.test(normalized)) return 'web';
    return 'unknown';
}

function getRemoteSessionId(session: StoredChatSession | null | undefined): string {
    if (!session) return '';
    const explicit = typeof session.remoteSessionId === 'string' ? session.remoteSessionId.trim() : '';
    if (explicit) return explicit;
    const sid = (session.id || '').trim();
    if (sid.startsWith('remote_')) {
        return sid.slice('remote_'.length).trim();
    }
    return '';
}

function getRemoteSessionOwnerAgentId(session: StoredChatSession | null | undefined): string {
    if (!session) return '';
    return typeof session.remoteSessionOwnerAgentId === 'string' ? session.remoteSessionOwnerAgentId.trim() : '';
}

function sanitizeSessionForFixedLabel(session: StoredChatSession, fixedLabel: string): StoredChatSession {
    const normalizedLabel = fixedLabel.trim();
    if (!normalizedLabel) {
        return session;
    }
    const currentLabel = (session.sessionLabel || '').trim();
    const hasRemoteBinding = Boolean(
        (session.remoteSessionId || '').trim()
        || (session.remoteSessionOwnerAgentId || '').trim(),
    );
    if (currentLabel === normalizedLabel && !hasRemoteBinding) {
        return session;
    }
    return {
        ...session,
        remoteSessionId: undefined,
        remoteSessionOwnerAgentId: undefined,
        sessionLabel: normalizedLabel,
    };
}

function sanitizeSessionsForFixedLabel(sessions: StoredChatSession[], fixedLabel: string): StoredChatSession[] {
    let changed = false;
    const next = sessions.map((session) => {
        const sanitized = sanitizeSessionForFixedLabel(session, fixedLabel);
        if (sanitized !== session) {
            changed = true;
        }
        return sanitized;
    });
    return changed ? next : sessions;
}

function toRemoteStorageSessionId(remoteSessionId: string): string {
    return `remote_${remoteSessionId}`;
}

interface BackendSessionSummary {
    sessionId: string;
    sessionLabel: string;
    displayTitle: string;
    updatedAt: number;
    source: 'app' | 'web' | 'unknown';
}

function pickSessionTitle(raw: Record<string, unknown>): string {
    const candidates = [
        raw.title,
        raw.name,
        raw.session_title,
        raw.session_name,
        raw.chat_title,
        raw.topic,
        raw.summary,
        raw.label,
        raw.session_label,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }
    return '';
}

function deriveSessionTitleFromMessages(messages: Message[]): string {
    const firstUser = messages.find((item) => item.role === 'user' && item.text.trim() && !isHiddenSystemPromptText(item.text));
    if (firstUser) {
        return shortenSessionTitle(firstUser.text.trim());
    }
    const firstAgent = messages.find((item) => item.role === 'agent' && item.text.trim() && !isHiddenSystemPromptText(item.text));
    if (firstAgent) {
        return shortenSessionTitle(firstAgent.text.trim());
    }
    return '';
}

function parseBackendSessionSummaries(payload: unknown): BackendSessionSummary[] {
    const container = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
    const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(container?.sessions)
            ? container.sessions
            : Array.isArray(container?.data)
                ? container.data
                : Array.isArray(container?.items)
                    ? container.items
                : [];
    const out: BackendSessionSummary[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const item = row as Record<string, unknown>;
        const sessionId = typeof item.session_id === 'string'
            ? item.session_id.trim()
            : (typeof item.id === 'string' ? item.id.trim() : '');
        if (!sessionId || seen.has(sessionId)) {
            continue;
        }
        seen.add(sessionId);
        const sessionLabel = typeof item.label === 'string'
            ? item.label.trim()
            : (typeof item.session_label === 'string' ? item.session_label.trim() : '');
        const rawTitle = pickSessionTitle(item);
        out.push({
            sessionId,
            sessionLabel,
            displayTitle: normalizeSessionDisplayTitle(rawTitle, '') || `会话 ${sessionId.slice(0, 8)}`,
            updatedAt: parseBackendTimestampMs(item.updated_at ?? item.updatedAt ?? item.created_at ?? item.createdAt),
            source: inferSessionSource(sessionLabel),
        });
    }

    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
}

function buildSessionFromBackendPayload(
    payload: unknown,
    fallback?: Partial<BackendSessionSummary>,
    ownerAgentId?: string,
): StoredChatSession | null {
    const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const rows = Array.isArray(source.messages)
        ? source.messages.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        : [];

    const startAt = Date.now() - rows.length * 1000;
    const messages: Message[] = rows
        .map((row, index) => {
            const rawText = typeof row.content === 'string'
                ? row.content
                : (typeof row.message === 'string' ? row.message : '');
            const role = parseBackendMessageRole(row.role);
            const normalized = normalizeBackendMessage(role, rawText, ownerAgentId);
            const text = normalized.text;
            const tools = parseBackendToolCalls(row.tools);
            if (!text.trim() && (!normalized.attachments || normalized.attachments.length === 0) && (!tools || tools.length === 0)) {
                return null;
            }
            return {
                id: `remote_msg_${Date.now()}_${index}`,
                role,
                text,
                attachments: normalized.attachments,
                tools,
                timestamp: new Date(startAt + index * 1000).toISOString(),
            } as Message;
        })
        .filter((item): item is Message => item != null);

    const rawSessionId = typeof source.session_id === 'string'
        ? source.session_id.trim()
        : (fallback?.sessionId ?? '').trim();
    if (!rawSessionId) {
        return null;
    }
    const rawSessionLabel = typeof source.label === 'string'
        ? source.label.trim()
        : (typeof source.session_label === 'string'
            ? source.session_label.trim()
            : (fallback?.sessionLabel ?? '').trim());
    const rawTitle = pickSessionTitle(source);
    const sourceType = fallback?.source ?? inferSessionSource(rawSessionLabel);
    const updatedAt = parseBackendTimestampMs(
        source.updated_at ?? source.updatedAt ?? source.created_at ?? source.createdAt ?? fallback?.updatedAt,
    );
    const titleFromPayload = normalizeSessionDisplayTitle(rawTitle, '');
    const titleFromLabel = normalizeSessionDisplayTitle(rawSessionLabel, '');
    const titleFromMessages = deriveSessionTitleFromMessages(messages);
    const titleFromFallback = normalizeSessionDisplayTitle(fallback?.displayTitle ?? '', '');
    const displayTitle = titleFromPayload
        || titleFromLabel
        || titleFromMessages
        || titleFromFallback
        || `会话 ${rawSessionId.slice(0, 8)}`;

    return {
        id: toRemoteStorageSessionId(rawSessionId),
        title: displayTitle,
        updatedAt,
        messages,
        remoteSessionId: rawSessionId,
        remoteSessionOwnerAgentId: ownerAgentId?.trim() || undefined,
        sessionLabel: rawSessionLabel || undefined,
        sessionSource: sourceType,
        autoTitle: messages.length === 0 ? true : undefined,
        streamState: 'idle',
    };
}

function mergeRemoteSessions(current: StoredChatSession[], incoming: StoredChatSession[]): StoredChatSession[] {
    if (!incoming.length) {
        return current;
    }

    let next = [...current];

    for (const remote of incoming) {
        const remoteSessionId = getRemoteSessionId(remote);
        if (!remoteSessionId) {
            continue;
        }

        let matchedIndex = next.findIndex((session) => getRemoteSessionId(session) === remoteSessionId);
        if (matchedIndex < 0) {
            const remoteLabel = (remote.sessionLabel || '').trim();
            if (remoteLabel) {
                matchedIndex = next.findIndex((session) => {
                    const localRemoteId = getRemoteSessionId(session);
                    if (localRemoteId) {
                        return false;
                    }
                    const localLabel = (session.sessionLabel || '').trim();
                    return localLabel === remoteLabel;
                });
            }
        }
        if (matchedIndex >= 0) {
            const matched = next[matchedIndex];
            const keepTitle = Boolean(matched.title && matched.title.trim());
            const keepCustomTitle = keepTitle && matched.autoTitle === false;
            const preferStreamState = matched.streamState && matched.streamState !== 'idle';
            const matchedTitle = (matched.title || '').trim();
            const rawRemoteTitle = (remote.title || '').trim();
            const remoteTitle = normalizeSessionDisplayTitle(rawRemoteTitle, '');
            const mergedTitle = keepCustomTitle
                ? matched.title
                : (matchedTitle && (!remoteTitle || isOpaqueSessionTitle(rawRemoteTitle)))
                    ? matched.title
                    : (remoteTitle || matched.title || '已同步会话');

            next[matchedIndex] = {
                ...matched,
                ...remote,
                id: matched.id || remote.id || toRemoteStorageSessionId(remoteSessionId),
                title: mergedTitle,
                updatedAt: Math.max(matched.updatedAt, remote.updatedAt),
                messages: remote.messages.length > 0 ? remote.messages : matched.messages,
                remoteSessionId,
                remoteSessionOwnerAgentId: remote.remoteSessionOwnerAgentId ?? matched.remoteSessionOwnerAgentId,
                sessionLabel: remote.sessionLabel ?? matched.sessionLabel,
                sessionSource: remote.sessionSource ?? matched.sessionSource,
                autoTitle: matched.autoTitle ?? remote.autoTitle,
                streamState: preferStreamState ? matched.streamState : remote.streamState,
            };
            continue;
        }

        next = [remote, ...next];
    }

    const seenRemoteSessionIds = new Set<string>();
    const seenSessionIds = new Set<string>();
    next = next.filter((session) => {
        const sid = (session.id || '').trim();
        if (!sid || seenSessionIds.has(sid)) {
            return false;
        }
        const remoteSessionId = getRemoteSessionId(session);
        if (remoteSessionId) {
            if (seenRemoteSessionIds.has(remoteSessionId)) {
                return false;
            }
            seenRemoteSessionIds.add(remoteSessionId);
        }
        seenSessionIds.add(sid);
        return true;
    });

    next.sort((a, b) => b.updatedAt - a.updatedAt);
    return next;
}

function buildRemoteSessionStub(summary: BackendSessionSummary, ownerAgentId?: string): StoredChatSession {
    return {
        id: toRemoteStorageSessionId(summary.sessionId),
        title: summary.displayTitle,
        updatedAt: summary.updatedAt,
        messages: [],
        remoteSessionId: summary.sessionId,
        remoteSessionOwnerAgentId: ownerAgentId?.trim() || undefined,
        sessionLabel: summary.sessionLabel || undefined,
        sessionSource: summary.source,
        autoTitle: true,
        streamState: 'idle',
    };
}

function mergeFixedLabelRestoredSession(
    current: StoredChatSession[],
    restored: StoredChatSession | null,
    fixedLabel: string,
    preferredSessionId: string,
): StoredChatSession[] {
    const sanitizedCurrent = sanitizeSessionsForFixedLabel(current, fixedLabel);
    if (!restored) {
        return sanitizedCurrent;
    }
    const sanitizedRestored = sanitizeSessionForFixedLabel(restored, fixedLabel);
    if (sanitizedCurrent.length === 0) {
        return [sanitizedRestored];
    }
    const preferredId = preferredSessionId.trim();
    const targetIndex = preferredId
        ? sanitizedCurrent.findIndex((session) => session.id === preferredId)
        : -1;
    const resolvedIndex = targetIndex >= 0 ? targetIndex : 0;
    const target = sanitizedCurrent[resolvedIndex];
    const keepCustomTitle = Boolean(target.title?.trim()) && target.autoTitle === false;
    const nextTarget: StoredChatSession = {
        ...target,
        title: keepCustomTitle ? target.title : (sanitizedRestored.title || target.title),
        updatedAt: Math.max(target.updatedAt, sanitizedRestored.updatedAt),
        messages: sanitizedRestored.messages.length > 0 ? sanitizedRestored.messages : target.messages,
        sessionLabel: fixedLabel,
        remoteSessionId: undefined,
        remoteSessionOwnerAgentId: undefined,
        sessionSource: sanitizedRestored.sessionSource ?? target.sessionSource,
        streamState: target.streamState && target.streamState !== 'idle'
            ? target.streamState
            : sanitizedRestored.streamState,
    };
    const next = [...sanitizedCurrent];
    next[resolvedIndex] = nextTarget;
    return next;
}

async function mapAsyncWithConcurrency<TInput, TResult>(
    items: readonly TInput[],
    concurrency: number,
    worker: (item: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> {
    if (items.length === 0) {
        return [];
    }
    const limit = Math.max(1, Math.floor(concurrency));
    const results: TResult[] = new Array(items.length);
    let cursor = 0;

    const runWorker = async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) {
                return;
            }
            results[index] = await worker(items[index], index);
        }
    };

    const runners = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
    await Promise.all(runners);
    return results;
}

function scheduleUnitToMs(value: number, unit: string): number {
    const normalized = unit.trim().toLowerCase();
    if (normalized === '秒' || normalized === '秒钟') return value * 1000;
    if (normalized === '分钟' || normalized === '分') return value * 60_000;
    if (normalized === '小时') return value * 3_600_000;
    if (normalized === '天' || normalized === '日') return value * 86_400_000;
    if (normalized === '周') return value * 7 * 86_400_000;
    return value * 60_000;
}

function formatLocalDateKey(value: Date = new Date()): string {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function sanitizeStorageToken(raw: string, maxLen: number): string {
    const trimmed = raw.trim();
    if (!trimmed) return 'na';
    const normalized = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLen);
    return normalized || 'na';
}

function buildIdleAutoStorageKey(scope: IdleAutoScope, scopeId: string, dateKey: string): string {
    const safeScope = scope === 'group' ? 'group' : 'agent';
    const safeId = sanitizeStorageToken(scopeId, 64);
    return `idle-auto:${safeScope}:${safeId}:${dateKey}`;
}

function readLocalNumber(key: string): number {
    if (typeof window === 'undefined') return 0;
    try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? Number.parseInt(raw, 10) : 0;
        return Number.isFinite(parsed) ? parsed : 0;
    } catch {
        return 0;
    }
}

function writeLocalNumber(key: string, value: number): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, String(Math.max(0, Math.floor(value))));
    } catch {
        // ignore storage errors
    }
}

function normalizeIdleLine(raw: string, maxLen: number): string {
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    if (cleaned.length <= maxLen) return cleaned;
    return `${cleaned.slice(0, maxLen)}…`;
}

function buildIdleContextSummary(messages: Message[], isGroup: boolean, limit: number): string {
    const rows = messages
        .filter((m) => (m.role === 'user' || m.role === 'agent') && Boolean(m.text?.trim()))
        .filter((m) => !isHiddenSystemPromptText(m.text || ''))
        .slice(-limit)
        .map((m) => {
            const speaker = m.role === 'user'
                ? '用户'
                : (isGroup ? `@${m.agentName?.trim() || m.agentId || '成员'}` : '你');
            const content = normalizeIdleLine(m.text || '', 200);
            return content ? `${speaker}: ${content}` : '';
        })
        .filter(Boolean);
    return rows.join('\n');
}

function buildIdleAutoPrompt(params: {
    agentName: string;
    isGroup: boolean;
    context: string;
}): string {
    const lines = [
        '[system:auto-idle]',
        params.isGroup
            ? '你是该群的群主/主持人，需要在群里公开发言。'
            : `你是 ${params.agentName}，与用户私聊中。`,
        '用户已经 1 分钟没有输入，请主动发起一条自然的跟进消息。',
        '优先方向：1) 昨天/最近任务进展小结 2) 发现的问题或提醒 3) 轻度慰问/继续推进的邀请。',
        '要求：1-3 句，60-120 字，避免自问自答，不要提及“系统/提示词”。若无上下文则简短问候。',
    ];
    if (params.context.trim()) {
        lines.push('最近对话：');
        lines.push(params.context);
    }
    return lines.join('\n');
}

function formatEveryMsInCard(everyMs: number): string {
    const safe = Math.max(1000, Math.floor(everyMs));
    if (safe % 86_400_000 === 0) return `每 ${safe / 86_400_000} 天`;
    if (safe % 3_600_000 === 0) return `每 ${safe / 3_600_000} 小时`;
    if (safe % 60_000 === 0) return `每 ${safe / 60_000} 分钟`;
    if (safe % 1000 === 0) return `每 ${safe / 1000} 秒`;
    return `每 ${safe} 毫秒`;
}

function parseChineseNumeral(raw: string): number | null {
    const text = raw.trim();
    if (!text) return null;
    if (!/^[零〇一二两三四五六七八九十百千]+$/.test(text)) return null;

    const digitMap: Record<string, number> = {
        零: 0,
        〇: 0,
        一: 1,
        二: 2,
        两: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
    };

    const unitMap: Record<string, number> = {
        十: 10,
        百: 100,
        千: 1000,
    };

    let total = 0;
    let current = 0;
    for (const ch of text) {
        if (ch in digitMap) {
            current = digitMap[ch];
            continue;
        }
        const unit = unitMap[ch];
        if (!unit) return null;
        total += (current || 1) * unit;
        current = 0;
    }
    total += current;
    if (!Number.isFinite(total) || total <= 0) return null;
    return total;
}

function parseLoosePositiveInt(raw: string | undefined): number | null {
    const text = (raw || '').trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
        const value = Number(text);
        if (Number.isFinite(value) && value > 0) return Math.floor(value);
        return null;
    }
    return parseChineseNumeral(text);
}

function buildTaskExecutionPrompt(objective: string, maxRuns: number): string {
    return [
        '你是任务执行助手。请直接执行以下任务并给出简洁结果：',
        objective,
        maxRuns > 0 ? `任务总执行次数上限：${maxRuns} 次。达到上限后停止。` : '任务总执行次数上限：无限次。',
        '要求：',
        '1) 必须返回可读的结论。',
        '2) 若失败，返回失败原因。',
        '3) 不要输出额外格式包装。',
        '4) 禁止输出“是否创建任务/请确认/确认后执行”等二次确认语句。',
        '5) 禁止复述调度信息（如每几分钟执行一次），仅输出本次查询结果。',
        '6) 监控/阈值类任务必须明确输出：`告警状态：触发` 或 `告警状态：未触发`，并说明关键数值与阈值比较。',
    ].join('\n');
}

function createProposalTaskCardFromAssistantText(raw: string): ChatTaskCardData | null {
    const text = raw.replace(/\r\n/g, '\n').trim();
    if (!text) return null;
    const normalizedText = text
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^\s*[-*]\s+/gm, '')
        .trim();

    const asksForConfirmation = /(请确认|确认无误|确认后|回复.?确认|是否创建)/i.test(normalizedText);
    const scheduleHint = /(定时任务|执行间隔|总执行次数|总次数|每隔|每\s*\d*\s*(秒钟?|分钟|分|小时|天|日|周))/i.test(normalizedText);
    if (!asksForConfirmation && !scheduleHint) return null;

    const nameMatch = normalizedText.match(/任务名称\s*(?:[:：]\s*)?([^\n]+)/i);
    const objectiveMatch = normalizedText.match(/任务内容\s*(?:[:：]\s*)?([^\n]+)/i);
    const intervalMatch = normalizedText.match(
        /(?:执行间隔[:：]\s*)?(?:每隔|每)\s*([0-9]+|[零〇一二两三四五六七八九十百千]+)?\s*(秒钟?|秒|分钟|分|小时|天|日|周)/i,
    );
    const runsMatch = normalizedText.match(/总执行次数\s*(?:[:：]\s*)?([0-9]+|[零〇一二两三四五六七八九十百千]+)\s*次/i)
        || normalizedText.match(/总次数\s*(?:[:：]\s*)?([0-9]+|[零〇一二两三四五六七八九十百千]+)\s*次/i)
        || normalizedText.match(/任务执行\s*([0-9]+|[零〇一二两三四五六七八九十百千]+)\s*次/i)
        || normalizedText.match(/(?:总共|一共|共|连续|持续|运行|执行)\s*([0-9]+|[零〇一二两三四五六七八九十百千]+)\s*次/i);

    if (!intervalMatch || !runsMatch) {
        return null;
    }

    const intervalValue = parseLoosePositiveInt(intervalMatch[1]) ?? 1;
    const intervalUnit = String(intervalMatch[2] || '');
    const maxRunsRaw = parseLoosePositiveInt(runsMatch[1]);
    if (!Number.isFinite(intervalValue) || intervalValue <= 0) return null;
    if (!maxRunsRaw || maxRunsRaw <= 0) return null;

    const everyMs = Math.max(1000, scheduleUnitToMs(intervalValue, intervalUnit));
    const maxRuns = Math.max(1, Math.min(1000, Math.floor(maxRunsRaw)));
    const taskName = (nameMatch?.[1] || objectiveMatch?.[1] || '定时任务').trim();
    const objective = (objectiveMatch?.[1] || nameMatch?.[1] || taskName).trim();
    const now = new Date().toISOString();
    return {
        taskName,
        objective,
        scheduleText: `${formatEveryMsInCard(everyMs)}，共 ${maxRuns} 次`,
        everyMs,
        maxRuns,
        runCount: 0,
        executionPrompt: buildTaskExecutionPrompt(objective, maxRuns),
        sourceMessageText: objective,
        stage: 'proposal',
        createdAt: now,
        updatedAt: now,
        canCreate: true,
        canCancel: true,
        canDelete: false,
        notifyOnComplete: true,
        completedNotified: false,
    };
}

function createProposalTaskCard(raw: string): ChatTaskCardData | null {
    const parsed = createProposalTaskCardFromAssistantText(raw);
    if (!parsed) return null;
    const now = new Date().toISOString();
    return {
        taskName: parsed.taskName,
        objective: parsed.objective,
        scheduleText: parsed.scheduleText,
        everyMs: parsed.everyMs,
        maxRuns: parsed.maxRuns,
        runCount: 0,
        executionPrompt: parsed.executionPrompt,
        sourceMessageText: parsed.sourceMessageText,
        stage: 'proposal',
        createdAt: now,
        updatedAt: now,
        canCreate: true,
        canCancel: true,
        canDelete: false,
        notifyOnComplete: true,
        completedNotified: false,
    };
}

function resolveCardStage(task: Task, card: ChatTaskCardData, runCount: number): ChatTaskCardData['stage'] {
    if (task.runInfo.lastStatus === 'running') {
        return 'running';
    }
    if (card.maxRuns > 0 && runCount >= card.maxRuns) {
        return 'completed';
    }
    const hasStarted = runCount > 0 || Boolean(task.runInfo.lastRun);
    if (task.runInfo.lastStatus === 'error' && hasStarted) {
        return task.enabled ? 'scheduled' : 'failed';
    }
    if (!task.enabled && hasStarted) {
        return 'cancelled';
    }
    return 'scheduled';
}

interface AgentChatReadinessMeta {
    authStatus?: string;
    ready?: boolean;
    modelProvider?: string;
    modelName?: string;
    apiKeyEnv?: string;
}

function isAgentChatUnavailable(meta?: AgentChatReadinessMeta): boolean {
    if (!meta) return false;
    if (meta.ready === false) return true;
    const auth = (meta.authStatus || '').trim().toLowerCase();
    return auth === 'missing' || auth === 'none';
}

function buildAgentChatUnavailableMessage(meta?: AgentChatReadinessMeta): string {
    if (!meta) {
        return '当前智能体模型未就绪，请在设置中检查模型与 API Key 配置。';
    }
    const auth = (meta.authStatus || 'unknown').trim() || 'unknown';
    const ready = meta.ready === undefined ? 'unknown' : (meta.ready ? 'true' : 'false');
    const modelText = [meta.modelProvider, meta.modelName].filter(Boolean).join('/');
    const keyHint = meta.apiKeyEnv ? `（需要环境变量：${meta.apiKeyEnv}）` : '';
    return [
        `当前智能体模型不可用：ready=${ready}，auth_status=${auth}。`,
        `模型：${modelText || '-'}`,
        `请先在设置里修正模型提供商/模型名/API Key${keyHint}。`,
    ].join('\n');
}

interface AgentDirectoryItem {
    id: string;
    name: string;
    avatarUrl?: string;
    color?: string;
}

function normalizeGroupUpgradeToken(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    const idMatch = withoutAt.match(/(?:^|\\b)(?:id|agent_id|agentId)\\s*[:=]\\s*([A-Za-z0-9_-]{2,64})/i);
    if (idMatch?.[1]) {
        return idMatch[1];
    }
    return withoutAt;
}

function pickStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
}

function extractGroupUpgradeCandidates(payload: GroupUpgradeActionPayload | Record<string, unknown> | null | undefined): string[] {
    if (!payload || typeof payload !== 'object') return [];
    const obj = payload as Record<string, unknown>;
    const direct = pickStringArray(obj.memberAgentIds ?? obj.member_agent_ids ?? obj.agentIds ?? obj.agent_ids);
    const names = pickStringArray(obj.memberNames ?? obj.member_names ?? obj.agentNames ?? obj.agent_names);
    const members = Array.isArray(obj.members) ? obj.members as Array<Record<string, unknown>> : [];
    const fromMembers = members
        .map((item) => (typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : ''))
        .map((item) => item.trim())
        .filter(Boolean);
    const merged = [...direct, ...names, ...fromMembers]
        .map(normalizeGroupUpgradeToken)
        .filter(Boolean);
    return [...new Set(merged)];
}

function toLogText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value) return '';
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function normalizeLookupKey(value: string): string {
    return value.trim().toLowerCase();
}

function readNestedString(source: unknown, path: string[]): string {
    let current: unknown = source;
    for (const key of path) {
        if (!current || typeof current !== 'object') {
            return '';
        }
        current = (current as Record<string, unknown>)[key];
    }
    return typeof current === 'string' ? current.trim() : '';
}

function findAgentByAlias(
    directory: Map<string, AgentDirectoryItem>,
    alias: string,
): AgentDirectoryItem | undefined {
    const normalized = normalizeLookupKey(alias);
    if (!normalized) {
        return undefined;
    }
    for (const item of directory.values()) {
        if (normalizeLookupKey(item.id) === normalized || normalizeLookupKey(item.name) === normalized) {
            return item;
        }
    }
    return undefined;
}

function extractAgentTargetFromToolPayload(
    parsedTool: Record<string, unknown> | null,
    raw: string,
    directory: Map<string, AgentDirectoryItem>,
): {
    agentId: string;
    agentName: string;
    directoryHit?: AgentDirectoryItem;
} {
    const payloadCandidates: unknown[] = [
        parsedTool,
        parsedTool?.input,
        parsedTool?.args,
        parsedTool?.arguments,
        parsedTool?.payload,
        parsedTool?.params,
        parsedTool?.result,
    ];
    const idPaths: string[][] = [
        ['agent_id'],
        ['agentId'],
        ['callee_agent_id'],
        ['calleeAgentId'],
        ['target_agent_id'],
        ['targetAgentId'],
        ['to_agent_id'],
        ['toAgentId'],
        ['target', 'agent_id'],
        ['target', 'agentId'],
        ['agent', 'id'],
        ['callee', 'id'],
    ];
    const namePaths: string[][] = [
        ['agent_name'],
        ['agentName'],
        ['callee_agent_name'],
        ['calleeAgentName'],
        ['target_agent_name'],
        ['targetAgentName'],
        ['to_name'],
        ['toName'],
        ['target', 'agent_name'],
        ['target', 'agentName'],
        ['agent', 'name'],
        ['callee', 'name'],
    ];

    let agentId = '';
    let agentName = '';

    for (const candidate of payloadCandidates) {
        if (agentId) break;
        for (const path of idPaths) {
            const value = readNestedString(candidate, path);
            if (value) {
                agentId = value;
                break;
            }
        }
    }
    for (const candidate of payloadCandidates) {
        if (agentName) break;
        for (const path of namePaths) {
            const value = readNestedString(candidate, path);
            if (value) {
                agentName = value;
                break;
            }
        }
    }

    if (!agentId) {
        const idRegex = /(?:agent[_-]?id|callee[_-]?agent[_-]?id|target[_-]?agent[_-]?id|to[_-]?agent[_-]?id)\s*[:=]\s*["']?([a-zA-Z0-9_-]{3,})/i;
        const xmlIdRegex = /<arg_name>\s*(?:agent_id|callee_agent_id|target_agent_id)\s*<\/arg_name>\s*<arg_value>\s*([^<\s]+)\s*<\/arg_value>/i;
        const idMatch = raw.match(xmlIdRegex) ?? raw.match(idRegex);
        agentId = idMatch?.[1]?.trim() || '';
    }
    if (!agentName) {
        const nameRegex = /(?:agent[_-]?name|callee[_-]?agent[_-]?name|target[_-]?agent[_-]?name|to[_-]?name)\s*[:=]\s*["']?([^\n"',}]{1,64})/i;
        const xmlNameRegex = /<arg_name>\s*(?:agent_name|callee_agent_name|target_agent_name)\s*<\/arg_name>\s*<arg_value>\s*([^<]+)\s*<\/arg_value>/i;
        const nameMatch = raw.match(xmlNameRegex) ?? raw.match(nameRegex);
        agentName = nameMatch?.[1]?.trim() || '';
    }

    let directoryHit = agentId ? directory.get(agentId) : undefined;
    if (!directoryHit && agentName) {
        directoryHit = findAgentByAlias(directory, agentName);
    }
    if (!directoryHit && agentId) {
        directoryHit = findAgentByAlias(directory, agentId);
    }

    const resolvedAgentId = directoryHit?.id || agentId || agentName || A2A_PLACEHOLDER_AGENT_ID;
    const resolvedAgentName = directoryHit?.name || agentName || agentId || '';
    return {
        agentId: resolvedAgentId,
        agentName: resolvedAgentName,
        directoryHit,
    };
}

function inferAgentFromText(
    text: string,
    directory: Map<string, AgentDirectoryItem>,
): AgentDirectoryItem | undefined {
    const normalizedText = normalizeLookupKey(text);
    if (!normalizedText) {
        return undefined;
    }
    const candidates = Array.from(directory.values()).sort(
        (left, right) => right.name.length - left.name.length,
    );
    for (const item of candidates) {
        const idHit = normalizeLookupKey(item.id);
        const nameHit = normalizeLookupKey(item.name);
        if ((idHit && normalizedText.includes(idHit)) || (nameHit && normalizedText.includes(nameHit))) {
            return item;
        }
    }
    return undefined;
}

function ensureA2aCard(
    cards: readonly A2AWorkCardData[],
    incoming: {
        cardId: string;
        agentId: string;
        agentName: string;
        agentAvatarUrl?: string;
        agentColor?: string;
        summary?: string;
    },
): { cards: A2AWorkCardData[]; index: number } {
    const isIncomingPlaceholder =
        incoming.agentId === A2A_PLACEHOLDER_AGENT_ID
        || !incoming.agentName.trim()
        || incoming.agentName.trim() === A2A_PLACEHOLDER_AGENT_NAME;
    const normalizedIncomingName = normalizeLookupKey(incoming.agentName);
    const idx = cards.findIndex((item) => {
        if (item.id === incoming.cardId) {
            return true;
        }
        const itemIsPlaceholder =
            item.agentId === A2A_PLACEHOLDER_AGENT_ID
            || !item.agentName.trim()
            || item.agentName.trim() === A2A_PLACEHOLDER_AGENT_NAME;
        if (!isIncomingPlaceholder && !itemIsPlaceholder && item.agentId === incoming.agentId) {
            return true;
        }
        if (!isIncomingPlaceholder && !itemIsPlaceholder && normalizedIncomingName) {
            return normalizeLookupKey(item.agentName) === normalizedIncomingName;
        }
        return false;
    });
    if (idx >= 0) {
        return { cards: [...cards], index: idx };
    }

    if (!isIncomingPlaceholder) {
        const workingPlaceholderIndexes = cards.reduce<number[]>((indexes, item, index) => {
            const itemIsPlaceholder =
                item.agentId === A2A_PLACEHOLDER_AGENT_ID
                || !item.agentName.trim()
                || item.agentName.trim() === A2A_PLACEHOLDER_AGENT_NAME;
            if (itemIsPlaceholder && item.status === 'working') {
                indexes.push(index);
            }
            return indexes;
        }, []);
        if (workingPlaceholderIndexes.length === 1) {
            const nextCards = [...cards];
            const placeholderIndex = workingPlaceholderIndexes[0];
            const placeholder = nextCards[placeholderIndex];
            nextCards[placeholderIndex] = {
                ...placeholder,
                id: incoming.cardId,
                agentId: incoming.agentId,
                agentName: incoming.agentName,
                agentAvatarUrl: placeholder.agentAvatarUrl || incoming.agentAvatarUrl,
                agentColor: placeholder.agentColor || incoming.agentColor,
                summary: placeholder.summary || incoming.summary,
            };
            return { cards: nextCards, index: placeholderIndex };
        }
    }

    const now = new Date().toISOString();
    const created: A2AWorkCardData = {
        id: incoming.cardId,
        agentId: incoming.agentId,
        agentName: incoming.agentName,
        agentAvatarUrl: incoming.agentAvatarUrl,
        agentColor: incoming.agentColor,
        status: 'working',
        summary: incoming.summary,
        startedAt: now,
        logs: [],
    };
    return { cards: [...cards, created], index: cards.length };
}

function withA2aLog(card: A2AWorkCardData, log: Omit<A2AWorkLogItem, 'id'>): A2AWorkCardData {
    return {
        ...card,
        logs: [
            ...card.logs,
            {
                id: generateId(),
                ...log,
            },
        ].slice(-80),
    };
}

function upsertA2aFinalResultLog(card: A2AWorkCardData, detail: string): A2AWorkCardData {
    const normalized = detail.trim();
    if (!normalized) {
        return card;
    }
    const now = new Date().toISOString();
    const nextLogs = [...card.logs];
    const resultIdx = nextLogs.findIndex((item) => item.title === '最终结果');
    if (resultIdx >= 0) {
        nextLogs[resultIdx] = {
            ...nextLogs[resultIdx],
            at: now,
            detail: normalized,
        };
    } else {
        nextLogs.push({
            id: generateId(),
            at: now,
            title: '最终结果',
            detail: normalized,
        });
    }
    return {
        ...card,
        logs: nextLogs.slice(-80),
    };
}

interface ChatPageProps {
    agentId?: string;
    runtimeKey?: string;
    sessionOwnerAgentId?: string;
    sessionLabel?: string;
    systemPreamble?: string;
    groupUpgradeEnabled?: boolean;
    fixedSessionTitle?: string;
    uiVariant?: 'full' | 'embedded';
    inputToolbar?: ReactNode;
    idleAuto?: IdleAutoConfig;
    extraReplyAgents?: Agent[];
    selectExtraReplyAgents?: (message: string) => Agent[];
    mentionDispatchAgents?: Agent[];
    mentionDispatchMaxDepth?: number;
    mentionDispatchMaxTargets?: number;
    maxRespondersPerUserTurn?: number;
    agentCooldownMs?: number;
    duplicateSuppressionThreshold?: number;
    stopAuthorityAgentIds?: string[];
    transformUserMessage?: (text: string) => string;
}

function buildFallbackAgent(agentId?: string): Agent {
    const base = mockAgents.find((a) => a.id === agentId) || mockAgents[0];
    if (!agentId || base.id === agentId) {
        return base;
    }
    return {
        ...base,
        id: agentId,
        name: agentId,
        title: agentId,
    };
}

export function ChatPage({
    agentId: agentIdProp,
    runtimeKey: runtimeKeyProp,
    sessionOwnerAgentId: sessionOwnerAgentIdProp,
    sessionLabel: sessionLabelProp,
    systemPreamble: systemPreambleProp,
    groupUpgradeEnabled: groupUpgradeEnabledProp,
    fixedSessionTitle: fixedSessionTitleProp,
    uiVariant: uiVariantProp,
    inputToolbar: inputToolbarProp,
    idleAuto: idleAutoProp,
    extraReplyAgents: extraReplyAgentsProp,
    selectExtraReplyAgents: selectExtraReplyAgentsProp,
    mentionDispatchAgents: mentionDispatchAgentsProp,
    mentionDispatchMaxDepth: mentionDispatchMaxDepthProp,
    mentionDispatchMaxTargets: mentionDispatchMaxTargetsProp,
    maxRespondersPerUserTurn: maxRespondersPerUserTurnProp,
    agentCooldownMs: agentCooldownMsProp,
    duplicateSuppressionThreshold: duplicateSuppressionThresholdProp,
    stopAuthorityAgentIds: stopAuthorityAgentIdsProp,
    transformUserMessage: transformUserMessageProp,
}: ChatPageProps = {}) {

    const { id: routeAgentId } = useParams();
    const navigate = useNavigate();
    const id = agentIdProp ?? routeAgentId;
    const { t } = useTranslation();

    const [agent, setAgent] = useState<Agent>(() => buildFallbackAgent(id));

    // UI state
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [infoSidebarCollapsed, setInfoSidebarCollapsed] = useState(false);
    const [infoSidebarWidth] = useState(384);
    const [isResizing, setIsResizing] = useState(false);
    const [sessionKeyword, setSessionKeyword] = useState('');
    const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
    const [pendingCreateTaskMessageId, setPendingCreateTaskMessageId] = useState<string | null>(null);
    const [taskActionBusy, setTaskActionBusy] = useState(false);
    const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
    const [taskDetailsItem, setTaskDetailsItem] = useState<Task | null>(null);
    const [taskDetailRuns, setTaskDetailRuns] = useState<TaskRunRecord[]>([]);
    const [taskDetailFinalSummary, setTaskDetailFinalSummary] = useState<{ runCount: number; content: string; createdAt: string } | null>(null);
    const [a2aDetailsOpen, setA2aDetailsOpen] = useState(false);
    const [a2aDetailsCard, setA2aDetailsCard] = useState<A2AWorkCardData | null>(null);
    const [a2aDetailsTarget, setA2aDetailsTarget] = useState<{ messageId: string; cardId: string } | null>(null);
    const [groupUpgradeBusy, setGroupUpgradeBusy] = useState(false);

    // Chat state
    const [isSending, setIsSending] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
    const [streamState, setStreamState] = useState<StreamState>('idle');
    const [pendingSilentCount, setPendingSilentCount] = useState(0);
    const [silentDispatching, setSilentDispatching] = useState(false);
    const [multiReplyDispatching, setMultiReplyDispatching] = useState(false);
    const [remoteLoadingMore, setRemoteLoadingMore] = useState(false);
    const [remotePendingCount, setRemotePendingCount] = useState(0);
    const [remoteMoreAvailable, setRemoteMoreAvailable] = useState(false);

    const messagesRef = useRef<Message[]>([]);
    const isSendingRef = useRef(isSending);
    const silentDispatchingRef = useRef(silentDispatching);
    const multiReplyDispatchingRef = useRef(multiReplyDispatching);
    const autoDispatchAbortTokenRef = useRef(0);
    const activeRequestIdRef = useRef<string | null>(null);
    const activeRequestSessionIdRef = useRef<string>('');
    const streamingDraftRef = useRef<Message | null>(null);
    const pendingMessageIdRef = useRef<string | null>(null);
    const patchBufferRef = useRef<Map<string, string>>(new Map());
    const rawAssistantStreamRef = useRef('');
    const doneReceivedRef = useRef(false);
    const streamStateRef = useRef<StreamState>('idle');
    const activeSessionIdRef = useRef<string>('');
    const chunkCountRef = useRef(0);
    const watchdogRef = useRef<number | null>(null);
    const waitingFinalizeRef = useRef<number | null>(null);
    const finalizedRequestIdRef = useRef<string | null>(null);
    const thinkingSnapshotRef = useRef('');
    const pendingSilentMessagesRef = useRef<string[]>([]);
    const streamPatchTimerRef = useRef<number | null>(null);
    const pendingSilentCountRef = useRef(0);
    const agentDirectoryRef = useRef<Map<string, AgentDirectoryItem>>(new Map());
    const agentReadinessRef = useRef<Map<string, AgentChatReadinessMeta>>(new Map());
    const remoteHistorySyncedKeysRef = useRef<Set<string>>(new Set());
    const remoteSessionQueueRef = useRef<BackendSessionSummary[]>([]);
    const remoteSessionSummaryMapRef = useRef<Map<string, BackendSessionSummary>>(new Map());
    const remoteBatchLoadingRef = useRef(false);
    const remoteSyncTokenRef = useRef(0);
    const lastUserActivityAtRef = useRef<number>(Date.now());
    const lastIdleAutoTriggeredAtRef = useRef<number>(0);
    const idleAutoTriggerCountRef = useRef<number>(0);
    const chatAgentId = id || agent.id;
    const sessionOwnerAgentId = (sessionOwnerAgentIdProp ?? chatAgentId).trim() || chatAgentId;
    const runtimeAgentId = (runtimeKeyProp ?? chatAgentId).trim() || chatAgentId;
    const runtimeAgentIdRef = useRef(runtimeAgentId);
    runtimeAgentIdRef.current = runtimeAgentId;
    const baseSessionLabel = (sessionLabelProp ?? '').trim();
    const baseSessionLabelRef = useRef(baseSessionLabel);
    baseSessionLabelRef.current = baseSessionLabel;
    const resolveSessionLabel = useCallback((sessionId: string) => {
        const base = baseSessionLabelRef.current;
        if (base) return base;
        return buildLocalSessionLabel(sessionId);
    }, []);
    const transformUserMessageRef = useRef(transformUserMessageProp);
    transformUserMessageRef.current = transformUserMessageProp;
    const groupUpgradeEnabled = groupUpgradeEnabledProp ?? true;
    const baseSystemPreamble = (systemPreambleProp ?? '').trim();
    const groupUpgradePreamble = groupUpgradeEnabled ? buildGroupUpgradeSystemPreamble() : '';
    const systemPreamble = [baseSystemPreamble, groupUpgradePreamble].filter(Boolean).join('\n\n');
    const systemPreambleRef = useRef(systemPreamble);
    systemPreambleRef.current = systemPreamble;
    const extraReplyAgents = useMemo(() => extraReplyAgentsProp ?? [], [extraReplyAgentsProp]);
    const extraReplyAgentsRef = useRef(extraReplyAgents);
    extraReplyAgentsRef.current = extraReplyAgents;
    const selectExtraReplyAgentsRef = useRef(selectExtraReplyAgentsProp);
    selectExtraReplyAgentsRef.current = selectExtraReplyAgentsProp;
    const mentionDispatchAgents = useMemo(() => mentionDispatchAgentsProp ?? [], [mentionDispatchAgentsProp]);
    const mentionDispatchAgentsRef = useRef(mentionDispatchAgents);
    mentionDispatchAgentsRef.current = mentionDispatchAgents;
    const mentionDispatchMaxDepth = mentionDispatchMaxDepthProp ?? 2;
    const mentionDispatchMaxTargets = mentionDispatchMaxTargetsProp ?? 3;
    const maxRespondersPerUserTurn = Number.isFinite(Number(maxRespondersPerUserTurnProp))
        ? Math.max(0, Number(maxRespondersPerUserTurnProp))
        : 0;
    const agentCooldownMs = Number.isFinite(Number(agentCooldownMsProp)) ? Math.max(0, Number(agentCooldownMsProp)) : 0;
    const duplicateSuppressionThreshold = Number.isFinite(Number(duplicateSuppressionThresholdProp))
        ? Math.max(0, Math.min(1, Number(duplicateSuppressionThresholdProp)))
        : 0;
    const stopAuthorityAgentIds = useMemo(() => (stopAuthorityAgentIdsProp ?? []).map((x) => x.trim()).filter(Boolean), [stopAuthorityAgentIdsProp]);
    const idleAutoConfig = idleAutoProp ?? {};
    const idleAutoEnabled = idleAutoConfig.enabled ?? true;
    const idleAutoScope: IdleAutoScope = idleAutoConfig.scope ?? 'agent';
    const idleAutoScopeId = (idleAutoConfig.scopeId ?? chatAgentId).trim();
    const idleAutoIdleMs = Number.isFinite(Number(idleAutoConfig.idleMs)) ? Math.max(1000, Number(idleAutoConfig.idleMs)) : 60_000;
    const idleAutoMaxPerPage = Number.isFinite(Number(idleAutoConfig.maxPerPage)) ? Math.max(0, Number(idleAutoConfig.maxPerPage)) : 2;
    const idleAutoMaxPerDay = Number.isFinite(Number(idleAutoConfig.maxPerDay)) ? Math.max(0, Number(idleAutoConfig.maxPerDay)) : 1;
    const idleAutoCooldownMs = Number.isFinite(Number(idleAutoConfig.cooldownMs)) ? Math.max(0, Number(idleAutoConfig.cooldownMs)) : 600_000;
    const idleAutoAgentOverride = idleAutoConfig.agentOverride;
    const idleAutoAgentRef = useRef<Agent>(idleAutoAgentOverride ?? agent);
    const sessions = useChatRuntimeSelector(runtimeAgentId, (state) => state.sessions);
    const activeSessionId = useChatRuntimeSelector(runtimeAgentId, (state) => state.activeSessionId);
    const inputLocked = isSending || streamState !== 'idle' || pendingSilentCount > 0 || silentDispatching || multiReplyDispatching;
    const sessionActionLocked = isSending || streamState !== 'idle';
    const markUserActivity = useCallback((_source?: string) => {
        lastUserActivityAtRef.current = Date.now();
    }, []);
    const pendingDeleteSession = pendingDeleteSessionId
        ? sessions.find((session) => session.id === pendingDeleteSessionId) ?? null
        : null;
    const activeSession = useMemo(
        () => sessions.find((session) => session.id === activeSessionId) ?? null,
        [sessions, activeSessionId],
    );
    const messages = useMemo(() => activeSession?.messages ?? [], [activeSession]);
    const pendingCreateTaskMessage = pendingCreateTaskMessageId
        ? messages.find((message) => message.id === pendingCreateTaskMessageId) ?? null
        : null;
    const sessionKeywordNormalized = useMemo(() => sessionKeyword.trim().toLocaleLowerCase(), [sessionKeyword]);
    const visibleSessions = useMemo(
        () => (sessionKeywordNormalized
            ? sessions.filter((session) => session.title.toLocaleLowerCase().includes(sessionKeywordNormalized))
            : sessions),
        [sessions, sessionKeywordNormalized],
    );

    const resolveExtraReplyAgents = (message: string): Agent[] => {
        const selector = selectExtraReplyAgentsRef.current;
        if (selector) {
            try {
                const selected = selector(message);
                return Array.isArray(selected) ? selected : [];
            } catch {
                return extraReplyAgentsRef.current;
            }
        }
        return extraReplyAgentsRef.current;
    };

    type TurnBudgetState = {
        turnId: string;
        used: Set<string>;
        remaining: number;
        startedAt: number;
    };

    const turnBudgetRef = useRef<TurnBudgetState | null>(null);

    const resetTurnBudget = (mainAgentId: string) => {
        if (!maxRespondersPerUserTurn || maxRespondersPerUserTurn <= 0) {
            turnBudgetRef.current = null;
            return;
        }
        const used = new Set<string>();
        const normalizedMain = mainAgentId.trim();
        if (normalizedMain) {
            used.add(normalizedMain);
        }
        const remaining = Math.max(0, maxRespondersPerUserTurn - used.size);
        turnBudgetRef.current = { turnId: generateId(), used, remaining, startedAt: Date.now() };
    };

    const tryConsumeTurnBudget = (agentId: string): { ok: boolean; consumedNew: boolean } => {
        const state = turnBudgetRef.current;
        if (!state) return { ok: true, consumedNew: false };
        const id = agentId.trim();
        if (!id) return { ok: false, consumedNew: false };
        if (state.used.has(id)) return { ok: true, consumedNew: false };
        if (state.remaining <= 0) return { ok: false, consumedNew: false };
        state.used.add(id);
        state.remaining -= 1;
        return { ok: true, consumedNew: true };
    };

    const refundTurnBudget = (agentId: string) => {
        const state = turnBudgetRef.current;
        if (!state) return;
        const id = agentId.trim();
        if (!id) return;
        if (!state.used.has(id)) return;
        state.used.delete(id);
        state.remaining += 1;
    };

    const normalizeSimilarityText = (raw: string): string => raw
        .toLowerCase()
        .replace(/[\s\r\n\t]+/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const trigramSet = (text: string): Set<string> => {
        const normalized = normalizeSimilarityText(text);
        const compact = normalized.replace(/\s+/g, '');
        const out = new Set<string>();
        if (compact.length < 6) return out;
        for (let i = 0; i < compact.length - 2; i += 1) {
            out.add(compact.slice(i, i + 3));
            if (out.size >= 2200) break;
        }
        return out;
    };

    const jaccard = (a: Set<string>, b: Set<string>): number => {
        if (a.size === 0 || b.size === 0) return 0;
        let intersection = 0;
        const [small, large] = a.size <= b.size ? [a, b] : [b, a];
        for (const token of small) {
            if (large.has(token)) intersection += 1;
        }
        const union = a.size + b.size - intersection;
        return union <= 0 ? 0 : intersection / union;
    };

    const getRoundAgentTexts = (snapshot: Message[]): string[] => {
        let lastUserIndex = -1;
        for (let i = snapshot.length - 1; i >= 0; i -= 1) {
            if (snapshot[i]?.role === 'user') {
                lastUserIndex = i;
                break;
            }
        }
        return snapshot
            .slice(lastUserIndex + 1)
            .filter((m) => m.role === 'agent')
            .filter((m) => !m.thinking && !m.streaming)
            .map((m) => (m.text || '').trim())
            .filter((text) => Boolean(text) && !isHiddenSystemPromptText(text))
            .slice(-10);
    };

    const isNearDuplicate = (candidate: string, baselines: string[]): boolean => {
        if (!duplicateSuppressionThreshold || duplicateSuppressionThreshold <= 0) return false;
        const normalized = normalizeSimilarityText(candidate);
        if (normalized.length < 60) return false;
        const candSet = trigramSet(candidate);
        if (candSet.size < 20) return false;
        for (const base of baselines) {
            const baseNormalized = normalizeSimilarityText(base);
            if (baseNormalized.length < 60) continue;
            const score = jaccard(candSet, trigramSet(base));
            if (score >= duplicateSuppressionThreshold) {
                return true;
            }
        }
        return false;
    };

    const agentLastSpokeAtRef = useRef<Map<string, number>>(new Map());
    const agentSpokeMessageIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!agentCooldownMs || agentCooldownMs <= 0) return;
        for (const msg of messages) {
            if (msg.role !== 'agent') continue;
            if (msg.thinking || msg.streaming) continue;
            const agentId = (msg.agentId || '').trim();
            if (!agentId) continue;
            if (!msg.text?.trim()) continue;
            if (agentSpokeMessageIdsRef.current.has(msg.id)) continue;
            agentSpokeMessageIdsRef.current.add(msg.id);
            agentLastSpokeAtRef.current.set(agentId, Date.now());
        }
    }, [agentCooldownMs, messages]);

    const createEmptySession = (index: number): ChatSession => {
        const sid = generateId();
        return {
            id: sid,
            title: t('chat.newSessionAutoTitle', {
                index,
                defaultValue: `新对话 ${index}`,
            }),
            updatedAt: Date.now(),
            messages: buildInitialMessages(agent.name),
            sessionLabel: resolveSessionLabel(sid) || undefined,
            autoTitle: true,
            streamState: 'idle',
        };
    };

    const setSessions = (updater: SetStateAction<ChatSession[]>) => {
        chatRuntimeStore.updateSessions(runtimeAgentIdRef.current, (prev) => {
            const next = typeof updater === 'function'
                ? (updater as (items: ChatSession[]) => ChatSession[])(prev)
                : updater;
            const fixedLabel = baseSessionLabelRef.current;
            if (!fixedLabel) {
                return next;
            }
            return sanitizeSessionsForFixedLabel(next, fixedLabel);
        });
    };

    const setActiveSessionId = (nextId: string) => {
        chatRuntimeStore.setActiveSessionId(runtimeAgentIdRef.current, nextId);
    };

    const syncRemoteQueueMeta = (remainingCount: number) => {
        const nextCount = Math.max(0, Math.floor(remainingCount));
        setRemotePendingCount(nextCount);
        setRemoteMoreAvailable(nextCount > 0);
    };

    const resetRemoteSyncState = () => {
        remoteSessionQueueRef.current = [];
        remoteSessionSummaryMapRef.current = new Map();
        remoteBatchLoadingRef.current = false;
        syncRemoteQueueMeta(0);
        setRemoteLoadingMore(false);
    };

    const loadRemoteSessionBatch = async (
        batchSize: number,
        syncToken: number,
        options?: { silent?: boolean },
    ): Promise<void> => {
        if (remoteBatchLoadingRef.current) {
            return;
        }
        if (syncToken !== remoteSyncTokenRef.current) {
            return;
        }
        const size = Math.max(1, Math.floor(batchSize));
        const batch = remoteSessionQueueRef.current.splice(0, size);
        syncRemoteQueueMeta(remoteSessionQueueRef.current.length);
        if (batch.length === 0) {
            return;
        }

        remoteBatchLoadingRef.current = true;
        if (!options?.silent) {
            setRemoteLoadingMore(true);
        }

        try {
            if (syncToken !== remoteSyncTokenRef.current) {
                return;
            }
            setSessions((prev) => mergeRemoteSessions(prev, batch.map((summary) => buildRemoteSessionStub(summary, chatAgentId))));

            const restoredSessions = await mapAsyncWithConcurrency(
                batch,
                REMOTE_SESSION_DETAIL_CONCURRENCY,
                async (summary) => {
                    try {
                        const detail = await requestJson<unknown>(
                            `/api/chat/${encodeURIComponent(chatAgentId)}/session?session_id=${encodeURIComponent(summary.sessionId)}`,
                        );
                        return buildSessionFromBackendPayload(detail, summary, chatAgentId) ?? buildRemoteSessionStub(summary, chatAgentId);
                    } catch (error) {
                        console.warn('[ChatPage] 拉取远端会话详情失败:', summary.sessionId, error);
                        return buildRemoteSessionStub(summary);
                    }
                },
            );

            if (syncToken !== remoteSyncTokenRef.current) {
                return;
            }
            if (restoredSessions.length > 0) {
                setSessions((prev) => mergeRemoteSessions(prev, restoredSessions));
            }
        } finally {
            if (syncToken === remoteSyncTokenRef.current) {
                remoteBatchLoadingRef.current = false;
                if (!options?.silent) {
                    setRemoteLoadingMore(false);
                }
            }
        }
    };

    const resolveRequestSessionTarget = (sessionId?: string): { sessionId?: string; sessionLabel?: string } => {
        const sid = (sessionId || activeSessionIdRef.current || '').trim();
        if (!sid) return {};
        const label = resolveSessionLabel(sid);
        const fixedLabel = baseSessionLabelRef.current;
        if (fixedLabel) {
            return { sessionLabel: label ? label : undefined };
        }
        const targetSession = sessions.find((session) => session.id === sid) ?? null;
        const remoteSessionId = getRemoteSessionId(targetSession);
        if (remoteSessionId) {
            return {
                sessionId: remoteSessionId,
                sessionLabel: targetSession?.sessionLabel || undefined,
            };
        }
        return { sessionLabel: label ? label : undefined };
    };

    const enqueueSilentMessage = (text: string) => {
        pendingSilentMessagesRef.current.push(text);
        setPendingSilentCount(pendingSilentMessagesRef.current.length);
    };

    const shiftSilentMessage = () => {
        const next = pendingSilentMessagesRef.current.shift();
        setPendingSilentCount(pendingSilentMessagesRef.current.length);
        return next;
    };

    const clearWaitingFinalizeTimer = () => {
        if (waitingFinalizeRef.current != null) {
            window.clearTimeout(waitingFinalizeRef.current);
            waitingFinalizeRef.current = null;
        }
    };

    const clearStreamPatchTimer = () => {
        if (streamPatchTimerRef.current != null) {
            window.clearTimeout(streamPatchTimerRef.current);
            streamPatchTimerRef.current = null;
        }
    };

    const bindRuntimeRequest = (requestId: string, sessionId: string, messageId: string) => {
        if (!requestId || !sessionId || !messageId) return;
        chatRuntimeStore.bindRequest(requestId, {
            agentId: runtimeAgentId,
            sessionId,
            messageId,
            processor: 'local',
        });
    };

    const unbindRuntimeRequest = (requestId: string | null | undefined) => {
        if (!requestId) return;
        chatRuntimeStore.unbindRequest(requestId);
    };

    const syncMessagesToSession = (sessionId: string, nextMessages: Message[]) => {
        setSessions((prev) => {
            const idx = prev.findIndex((session) => session.id === sessionId);
            if (idx < 0) return prev;
            const current = prev[idx];
            if (areMessagesEquivalent(current.messages, nextMessages)) {
                return prev;
            }
            const firstUserText = nextMessages.find((item) => item.role === 'user' && item.text.trim())?.text ?? '';
            const shouldFinalizeAutoTitle = Boolean(current.autoTitle && firstUserText.trim());
            const nextSession: ChatSession = {
                ...current,
                title: shouldFinalizeAutoTitle ? shortenSessionTitle(firstUserText) : current.title,
                autoTitle: shouldFinalizeAutoTitle ? false : current.autoTitle,
                updatedAt: Date.now(),
                messages: nextMessages,
                streamState: current.streamState ?? 'idle',
            };
            const next = [...prev];
            next[idx] = nextSession;
            if (idx !== 0) {
                next.sort((a, b) => b.updatedAt - a.updatedAt);
            }
            return next;
        });
    };

    const setSessionStreamState = (sessionId: string, nextState: StreamState) => {
        setSessions((prev) => {
            const idx = prev.findIndex((session) => session.id === sessionId);
            if (idx < 0) return prev;
            const current = prev[idx];
            const currentState = current.streamState ?? 'idle';
            if (currentState === nextState) {
                return prev;
            }
            const nextSession: ChatSession = {
                ...current,
                streamState: nextState,
                updatedAt: Date.now(),
            };
            const next = [...prev];
            next[idx] = nextSession;
            if (idx !== 0) {
                next.sort((a, b) => b.updatedAt - a.updatedAt);
            }
            return next;
        });
    };

    const patchSessionMessageById = (sessionId: string, messageId: string, draft: Message) => {
        setSessions((prev) => {
            const idx = prev.findIndex((session) => session.id === sessionId);
            if (idx < 0) return prev;
            const current = prev[idx];
            const hasTarget = current.messages.some((msg) => msg.id === messageId);
            if (!hasTarget) return prev;
            const nextMessages = current.messages.map((msg) =>
                msg.id === messageId
                    ? {
                        ...msg,
                        ...draft,
                        id: msg.id,
                        role: msg.role,
                        timestamp: msg.timestamp,
                    }
                    : msg,
            );
            const firstUserText = nextMessages.find((item) => item.role === 'user' && item.text.trim())?.text ?? '';
            const shouldFinalizeAutoTitle = Boolean(current.autoTitle && firstUserText.trim());
            const nextSession: ChatSession = {
                ...current,
                title: shouldFinalizeAutoTitle ? shortenSessionTitle(firstUserText) : current.title,
                autoTitle: shouldFinalizeAutoTitle ? false : current.autoTitle,
                updatedAt: current.updatedAt,
                messages: nextMessages,
                streamState: current.streamState ?? 'idle',
            };
            const next = [...prev];
            next[idx] = nextSession;
            return next;
        });
    };

    const flushPendingStreamDraft = () => {
        clearStreamPatchTimer();
        const pendingId = pendingMessageIdRef.current;
        if (!pendingId) return;
        const next = streamingDraftRef.current;
        if (!next) return;
        const requestSessionId = activeRequestSessionIdRef.current || activeSessionIdRef.current;
        patchSessionMessageById(requestSessionId, pendingId, next);
        setStreamingMessage(null);
    };

    const schedulePendingStreamDraft = () => {
        if (streamPatchTimerRef.current != null) {
            return;
        }
        streamPatchTimerRef.current = window.setTimeout(() => {
            streamPatchTimerRef.current = null;
            flushPendingStreamDraft();
        }, 80);
    };

    const commitMessages = (
        updater: Message[] | ((prev: Message[]) => Message[]),
        options?: { syncToSession?: boolean; sessionId?: string },
    ) => {
        const shouldSync = options?.syncToSession ?? true;
        const targetSessionId = options?.sessionId;
        if (!shouldSync) {
            return;
        }
        const sid = targetSessionId || activeSessionIdRef.current;
        if (!sid) {
            return;
        }
        const runtimeState = chatRuntimeStore.getAgentState(runtimeAgentIdRef.current);
        const currentSession = runtimeState.sessions.find((session) => session.id === sid);
        const prevMessages = currentSession?.messages ?? [];
        const next = typeof updater === 'function'
            ? (updater as (input: Message[]) => Message[])(prevMessages)
            : updater;
        syncMessagesToSession(sid, next);
    };

    const appendLocalAgentMessage = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const now = new Date().toISOString();
        commitMessages((prev) => [...prev, {
            id: generateId(),
            role: 'agent',
            agentId: chatAgentId,
            agentName: agent.name,
            agentAvatarUrl: agent.avatarUrl,
            agentColor: agent.color,
            agentPortraitUrl: agent.portraitUrl,
            text: trimmed,
            timestamp: now,
        }]);
    };

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        isSendingRef.current = isSending;
    }, [isSending]);

    useEffect(() => {
        silentDispatchingRef.current = silentDispatching;
    }, [silentDispatching]);

    useEffect(() => {
        multiReplyDispatchingRef.current = multiReplyDispatching;
    }, [multiReplyDispatching]);

    useEffect(() => {
        pendingSilentCountRef.current = pendingSilentCount;
    }, [pendingSilentCount]);

    useEffect(() => {
        idleAutoAgentRef.current = idleAutoAgentOverride ?? agent;
    }, [idleAutoAgentOverride, agent]);

    const displayIsSending = isSending || multiReplyDispatching;

    useEffect(() => {
        streamStateRef.current = streamState;
    }, [streamState]);

    useEffect(() => {
        activeSessionIdRef.current = activeSessionId;
    }, [activeSessionId]);

    useEffect(() => {
        lastUserActivityAtRef.current = Date.now();
    }, [activeSessionId, runtimeAgentId]);

    useEffect(() => {
        idleAutoTriggerCountRef.current = 0;
        lastIdleAutoTriggeredAtRef.current = 0;
        lastUserActivityAtRef.current = Date.now();
    }, [idleAutoScope, idleAutoScopeId]);

    useEffect(() => {
        let cancelled = false;

        const loadAgent = async () => {
            try {
                const rows = await listManagementAgents();
                if (!cancelled) {
                    agentDirectoryRef.current = new Map(
                        rows.map((row) => [
                            row.id,
                            {
                                id: row.id,
                                name: row.nickname?.trim() || row.name || row.id,
                                avatarUrl: row.identity.avatar_url,
                                color: row.identity.color,
                            },
                        ]),
                    );
                    agentReadinessRef.current = new Map(
                        rows.map((row) => [
                            row.id,
                            {
                                authStatus: row.authStatus,
                                ready: row.ready,
                                modelProvider: row.model.provider,
                                modelName: row.model.model,
                                apiKeyEnv: row.model.apiKeyEnv,
                            } satisfies AgentChatReadinessMeta,
                        ]),
                    );
                }

                if (id) {
                    setAgent((prev) => (prev.id === id ? prev : buildFallbackAgent(id)));
                    const detail = await getManagementAgentDetail(id);
                    if (!cancelled) {
                        agentReadinessRef.current.set(id, {
                            authStatus: detail.authStatus,
                            ready: detail.ready,
                            modelProvider: detail.model.provider,
                            modelName: detail.model.model,
                            apiKeyEnv: detail.model.apiKeyEnv,
                        });
                        setAgent(mapManagementAgentToUi(detail));
                    }
                    return;
                }
                if (!cancelled && rows.length > 0) {
                    setAgent(mapManagementAgentToUi(rows[0]));
                }
            } catch (error) {
                console.error('[ChatPage] 加载智能体失败:', error);
            }
        };

        void loadAgent();
        return () => {
            cancelled = true;
        };
    }, [id]);

    useEffect(() => {
        let cancelled = false;
        clearWaitingFinalizeTimer();
        setTaskCenterAgentId(chatAgentId);

        const loadedFromLocal = isWebRuntime() ? null : chatRuntimeStore.loadAgentFromStorage(runtimeAgentId);
        chatRuntimeStore.ensureAgentState(runtimeAgentId, () => {
            const loadedSessions = loadedFromLocal?.sessions?.length
                ? loadedFromLocal.sessions
                : [createEmptySession(1)];
            const sortedSessions = [...loadedSessions].sort((a, b) => b.updatedAt - a.updatedAt);
            const seenSessionIds = new Set<string>();
            const nextSessions: StoredChatSession[] = sortedSessions
                .map((session, sessionIndex): StoredChatSession => {
                    const fallbackTitle = t('chat.newSessionAutoTitle', {
                        index: sessionIndex + 1,
                        defaultValue: `新对话 ${sessionIndex + 1}`,
                    });
                    return {
                        ...session,
                        title: normalizeSessionDisplayTitle(session.title || '', fallbackTitle),
                        streamState: 'idle',
                    };
                })
                .filter((session) => {
                    const sid = (session.id || '').trim();
                    if (!sid || seenSessionIds.has(sid)) {
                        return false;
                    }
                    seenSessionIds.add(sid);
                    return true;
                });
            const preferredSessionId = loadedFromLocal?.activeSessionId ?? nextSessions[0]?.id ?? '';
            const activeSession = nextSessions.find((session) => session.id === preferredSessionId) ?? nextSessions[0];
            const resolvedActiveSessionId = activeSession?.id ?? '';
            return {
                sessions: nextSessions,
                activeSessionId: resolvedActiveSessionId,
            };
        });

        setSessionKeyword('');
        setPendingDeleteSessionId(null);
        setPendingCreateTaskMessageId(null);
        setTaskDetailsOpen(false);
        setTaskDetailsItem(null);
        setTaskDetailRuns([]);
        setA2aDetailsOpen(false);
        setA2aDetailsCard(null);
        setStreamingMessage(null);
        setIsSending(false);
        setStreamState('idle');
        setPendingSilentCount(0);
        setSilentDispatching(false);
        if (activeRequestIdRef.current) {
            chatRuntimeStore.setRequestProcessor(activeRequestIdRef.current, 'global');
        }
        activeRequestIdRef.current = null;
        activeRequestSessionIdRef.current = '';
        streamingDraftRef.current = null;
        pendingMessageIdRef.current = null;
        patchBufferRef.current.clear();
        rawAssistantStreamRef.current = '';
        doneReceivedRef.current = false;
        finalizedRequestIdRef.current = null;
        thinkingSnapshotRef.current = '';
        pendingSilentMessagesRef.current = [];
        remoteSyncTokenRef.current += 1;
        const currentRemoteSyncToken = remoteSyncTokenRef.current;
        resetRemoteSyncState();
        if (baseSessionLabel) {
            setSessions((prev) => prev);
        }

        const syncKey = baseSessionLabel
            ? `${runtimeAgentId}::agent:${sessionOwnerAgentId}::label:${baseSessionLabel}`
            : `${runtimeAgentId}::all`;
        const hasSyncedHistory = remoteHistorySyncedKeysRef.current.has(syncKey);

        void (async () => {
            try {
                if (cancelled) {
                    return;
                }

                if (baseSessionLabel) {
                    if (!hasSyncedHistory) {
                        const payload = await requestJson<unknown>(
                            `/api/chat/${encodeURIComponent(sessionOwnerAgentId)}/session?session_label=${encodeURIComponent(baseSessionLabel)}`,
                        );
                        const restored = buildSessionFromBackendPayload(payload, {
                            sessionLabel: baseSessionLabel,
                            displayTitle: normalizeSessionDisplayTitle(baseSessionLabel, '') || '当前会话',
                            source: inferSessionSource(baseSessionLabel),
                        }, sessionOwnerAgentId);
                        setSessions((prev) => mergeFixedLabelRestoredSession(
                            prev,
                            restored,
                            baseSessionLabel,
                            activeSessionIdRef.current,
                        ));
                    }
                } else {
                    const sessionsPayload = await requestJson<unknown>(`/api/chat/${encodeURIComponent(sessionOwnerAgentId)}/sessions`);
                    const summaries = parseBackendSessionSummaries(sessionsPayload);
                    const summaryMap = new Map<string, BackendSessionSummary>();
                    for (const item of summaries) {
                        summaryMap.set(item.sessionId, item);
                    }
                    remoteSessionSummaryMapRef.current = summaryMap;

                    const currentRuntimeSessions = chatRuntimeStore.getAgentState(runtimeAgentId).sessions;
                    const existingRemoteIds = new Set(
                        currentRuntimeSessions
                            .map((session) => getRemoteSessionId(session))
                            .filter((sid) => Boolean(sid)),
                    );
                    const pendingSummaries = summaries.filter((summary) => {
                        if (existingRemoteIds.has(summary.sessionId)) {
                            return false;
                        }
                        return true;
                    });
                    remoteSessionQueueRef.current = pendingSummaries;
                    syncRemoteQueueMeta(pendingSummaries.length);

                    if (!hasSyncedHistory && pendingSummaries.length > 0) {
                        await loadRemoteSessionBatch(REMOTE_SESSION_INITIAL_BATCH, currentRemoteSyncToken, { silent: true });
                    }
                }

                if (cancelled || currentRemoteSyncToken !== remoteSyncTokenRef.current) {
                    return;
                }
                remoteHistorySyncedKeysRef.current.add(syncKey);
            } catch (error) {
                console.warn('[ChatPage] 同步后端聊天记录失败:', error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [runtimeAgentId, chatAgentId, sessionOwnerAgentId, baseSessionLabel]);

    useEffect(() => {
        if (!sessions.length) {
            return;
        }
        if (!activeSessionId) {
            setActiveSessionId(sessions[0].id);
            return;
        }
        const active = sessions.find((session) => session.id === activeSessionId);
        if (!active) {
            setActiveSessionId(sessions[0].id);
            return;
        }
        if (!areMessagesEquivalent(messagesRef.current, active.messages)) {
            setStreamingMessage(null);
        }
    }, [activeSessionId, sessions]);

    useEffect(() => {
        ensureChatRuntimeStreamPump();
    }, []);

    useEffect(() => {
        return () => {
            const inflightRequestId = activeRequestIdRef.current;
            if (inflightRequestId) {
                chatRuntimeStore.setRequestProcessor(inflightRequestId, 'global');
            }
            clearWaitingFinalizeTimer();
            clearStreamPatchTimer();
        };
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeAgentChatStream((chunk) => {
            if (!activeRequestIdRef.current || chunk.requestId !== activeRequestIdRef.current) {
                return;
            }

            const base = streamingDraftRef.current;
            if (!base) {
                return;
            }

            chunkCountRef.current += 1;
            if (watchdogRef.current != null) {
                window.clearTimeout(watchdogRef.current);
                watchdogRef.current = null;
            }

                const next: Message = {
                    ...base,
                    thinkingTrace: [...(base.thinkingTrace ?? [])],
                    toolTrace: [...(base.toolTrace ?? [])],
                    generationStartedAt: base.generationStartedAt ?? Date.now(),
                    generationElapsedMs: 0,
                    debugPromptChannel: base.debugPromptChannel || CHAT_CHANNELS.app,
                    debugRenderMode: base.debugRenderMode || CHAT_RENDER_MODES.jsonRender,
                    debugSpecSource: base.debugSpecSource || 'none',
                    debugChunkCount: (base.debugChunkCount || 0) + 1,
                    debugReceivedDone: base.debugReceivedDone || false,
                    debugReceivedError: base.debugReceivedError || false,
                    debugWatchdogTriggered: base.debugWatchdogTriggered || false,
                    debugLastChunkKind: chunk.kind,
                    debugLastEvent: chunk.event || '',
                    debugNativeFrames: base.debugNativeFrames || '',
                    debugDonePayload: base.debugDonePayload || '',
                };
            next.generationElapsedMs = Math.max(0, Date.now() - (next.generationStartedAt || Date.now()));


            if (chunk.meta?.rawFrame || chunk.meta?.rawPayload) {
                const frameParts = [
                    typeof chunk.meta.rawEvent === 'string' && chunk.meta.rawEvent ? `event: ${chunk.meta.rawEvent}` : '',
                    typeof chunk.meta.rawPayload === 'string' && chunk.meta.rawPayload ? `payload: ${chunk.meta.rawPayload}` : '',
                    typeof chunk.meta.rawFrame === 'string' && chunk.meta.rawFrame ? `frame: ${chunk.meta.rawFrame}` : '',
                ].filter(Boolean);
                if (frameParts.length > 0) {
                    next.debugNativeFrames = `${next.debugNativeFrames ? `${next.debugNativeFrames}\n\n` : ''}${frameParts.join('\n')}`;
                }
            }

            if (chunk.kind === 'text') {
                const delta = chunk.value || '';
                rawAssistantStreamRef.current += delta;

                const toolCalls = extractToolCallTitles(delta);
                for (const toolCall of toolCalls) {
                    next.toolTrace = pushTrace(next.toolTrace, {
                        id: generateId(),
                        title: toolCall,
                        at: new Date().toISOString(),
                    });
                }

                const boundary = findUiBoundary(rawAssistantStreamRef.current);
                const textPart = boundary >= 0
                    ? rawAssistantStreamRef.current.slice(0, boundary)
                    : rawAssistantStreamRef.current;
                const thinkingText = extractThinkingFromTaggedText(textPart);
                const previousThinking = thinkingSnapshotRef.current;
                if (thinkingText && thinkingText !== previousThinking) {
                    const thinkingDelta = previousThinking && thinkingText.startsWith(previousThinking)
                        ? thinkingText.slice(previousThinking.length)
                        : thinkingText;
                    thinkingSnapshotRef.current = thinkingText;
                    if (thinkingDelta.trim()) {
                        next.thinkingTrace = appendThinkingStream(next.thinkingTrace, thinkingDelta);
                    }
                }
                if (next.thinking) {
                    next.text = '';
                    next.thinking = false;
                }
                next.streaming = true;
                next.text = sanitizeAssistantText(stripThinkingBlocks(textPart));
                next.debugRawStream = rawAssistantStreamRef.current;
                next.uiRawText = extractUiRawText(rawAssistantStreamRef.current);
                next.debugHasUiJson = boundary >= 0;
                next.uiStreamState = boundary >= 0 ? 'streaming' : 'idle';
                if (boundary >= 0) {
                    next.cardPending = true;
                }
                const streamText = (next.text || '').trim();
                if (streamText && next.a2aCards && next.a2aCards.length > 0) {
                    next.a2aCards = next.a2aCards.map((card) => (
                        card.status === 'working'
                            ? upsertA2aFinalResultLog(
                                {
                                    ...card,
                                    summary: '工作中',
                                },
                                streamText,
                            )
                            : card
                    ));
                }
            } else if (chunk.kind === 'patch' && chunk.value) {
                const current = patchBufferRef.current.get(chunk.requestId) || '';
                const merged = current
                    ? `${current}${current.endsWith('\n') || chunk.value.startsWith('\n') ? '' : '\n'}${chunk.value}`
                    : chunk.value;
                patchBufferRef.current.set(chunk.requestId, merged);
                next.uiRawText = merged;
                next.debugRawStream = rawAssistantStreamRef.current || merged;
                next.debugHasUiJson = true;
                next.uiStreamState = 'streaming';
                next.cardPending = true;
                try {
                    next.spec = compileSpecStream(merged);
                    next.debugSpecSource = 'patch';
                } catch {
                    // patch 未完成时会抛错，忽略即可
                }
            } else if (chunk.kind === 'log') {
                const raw = chunk.value || '';
                const parsedRaw = parseJsonSafely<Record<string, unknown>>(raw);
                const isToolLike =
                    /\[tool|tool_call|delegate_call|agent_find|agent_send/i.test(raw) ||
                    Boolean(parsedRaw && (typeof parsedRaw.tool === 'string' || typeof parsedRaw.tool_name === 'string'));
                if (!chunk.event && !parsedRaw && !isToolLike) {
                    next.thinkingTrace = appendThinkingStream(next.thinkingTrace, raw);
                }
                const parsed = parseTraceFromLog(chunk);
                if (parsed) {
                    const row: MessageTrace = {
                        id: generateId(),
                        title: parsed.title,
                        detail: parsed.detail,
                        at: new Date().toISOString(),
                    };
                    if (parsed.target === 'thinking') {
                        if (parsed.title === '深度思考' && parsed.detail) {
                            next.thinkingTrace = appendThinkingStream(next.thinkingTrace, parsed.detail);
                        } else {
                            next.thinkingTrace = pushTrace(next.thinkingTrace, row);
                        }
                    } else {
                        next.toolTrace = pushTrace(next.toolTrace, row);
                    }
                }
                const lowerEvent = (chunk.event || '').trim().toLowerCase();
                if (lowerEvent === 'tool_use') {
                    const parsedTool = parseJsonSafely<Record<string, unknown>>(raw);
                    const toolName = typeof parsedTool?.tool === 'string' ? parsedTool.tool : raw.trim() || 'tool';
                    next.tools = [...(next.tools ?? []), {
                        id: `${toolName}-${Date.now()}`,
                        name: toolName,
                        running: true,
                        expanded: false,
                        input: '',
                        result: '',
                        is_error: false,
                    }];
                    next.text = next.text || '';

                    if (toolName.toLowerCase() === 'agent_send') {
                        const target = extractAgentTargetFromToolPayload(parsedTool, raw, agentDirectoryRef.current);
                        const resolvedAgentId = target.agentId;
                        const resolvedAgentName = target.agentName;
                        const cardId = `a2a-${resolvedAgentId}`;
                        const currentCards = next.a2aCards ? [...next.a2aCards] : [];
                        const ensured = ensureA2aCard(currentCards, {
                            cardId,
                            agentId: resolvedAgentId,
                            agentName: resolvedAgentName,
                            agentAvatarUrl: target.directoryHit?.avatarUrl,
                            agentColor: target.directoryHit?.color,
                            summary: '工作中',
                        });
                        const updatedCard = withA2aLog(
                            {
                                ...ensured.cards[ensured.index],
                                status: 'working',
                                summary: '工作中',
                            },
                            {
                                at: new Date().toISOString(),
                                title: '开始执行',
                            },
                        );
                        ensured.cards[ensured.index] = updatedCard;
                        next.a2aCards = ensured.cards;
                    }
                }
                if (lowerEvent === 'tool_result') {
                    const parsedTool = parseJsonSafely<Record<string, unknown>>(raw);
                    const toolName = typeof parsedTool?.tool === 'string' ? parsedTool.tool : '';
                    const readable = extractReadableTextFromLog(raw);
                    const toolList = [...(next.tools ?? [])];
                    for (let index = toolList.length - 1; index >= 0; index -= 1) {
                        if (!toolName || toolList[index]?.name === toolName) {
                            toolList[index] = {
                                ...toolList[index],
                                running: false,
                                result: readable || raw,
                                is_error: Boolean(parsedTool?.is_error),
                            };
                            break;
                        }
                    }
                    next.tools = toolList;
                    if (next.spec == null) {
                        const inlineSpec = tryParseInlineSpecFromText(raw) ?? (readable ? tryParseInlineSpecFromText(readable) : undefined);
                        if (inlineSpec != null) {
                            next.spec = inlineSpec;
                            next.debugSpecSource = 'tool_result';
                            next.uiStreamState = 'ready';
                            next.cardPending = false;
                        }
                    }

                    if (toolName.toLowerCase() === 'agent_send') {
                        const target = extractAgentTargetFromToolPayload(parsedTool, raw, agentDirectoryRef.current);
                        const resolvedAgentId = target.agentId;
                        const resolvedAgentName = target.agentName;
                        const cardId = `a2a-${resolvedAgentId}`;
                        const currentCards = next.a2aCards ? [...next.a2aCards] : [];
                        let ensured = ensureA2aCard(currentCards, {
                            cardId,
                            agentId: resolvedAgentId,
                            agentName: resolvedAgentName,
                            agentAvatarUrl: target.directoryHit?.avatarUrl,
                            agentColor: target.directoryHit?.color,
                        });
                        if (resolvedAgentId === 'unknown-agent') {
                            const fallbackIndex = currentCards.findIndex((card) => card.status === 'working');
                            if (fallbackIndex >= 0) {
                                ensured = { cards: currentCards, index: fallbackIndex };
                            }
                        }
                        const isError = Boolean(parsedTool?.is_error);
                        const inferredFromReadable = !isError && readable
                            ? inferAgentFromText(readable, agentDirectoryRef.current)
                            : undefined;
                        const cardBase: A2AWorkCardData = {
                            ...ensured.cards[ensured.index],
                            agentId: inferredFromReadable?.id || resolvedAgentId || ensured.cards[ensured.index].agentId,
                            agentName: inferredFromReadable?.name || resolvedAgentName || ensured.cards[ensured.index].agentName,
                            agentAvatarUrl:
                                ensured.cards[ensured.index].agentAvatarUrl
                                || inferredFromReadable?.avatarUrl
                                || target.directoryHit?.avatarUrl,
                            agentColor:
                                ensured.cards[ensured.index].agentColor
                                || inferredFromReadable?.color
                                || target.directoryHit?.color,
                            status: isError ? 'failed' : 'working',
                            summary: isError ? '失败' : '工作中',
                            finishedAt: isError ? new Date().toISOString() : undefined,
                        };
                        const updatedCard = isError
                            ? withA2aLog(cardBase, {
                                at: new Date().toISOString(),
                                title: '执行失败',
                                detail: readable || toLogText(parsedTool),
                            })
                            : cardBase;
                        ensured.cards[ensured.index] = updatedCard;
                        next.a2aCards = ensured.cards;
                    }
                }
            } else if (chunk.kind === 'done') {
                doneReceivedRef.current = true;
                next.debugReceivedDone = true;
                next.debugDonePayload = typeof chunk.meta?.rawPayload === 'string'
                    ? chunk.meta.rawPayload
                    : JSON.stringify({ text: chunk.text ?? '', spec: chunk.spec ?? null }, null, 2);
                if (chunk.text !== undefined) {
                    rawAssistantStreamRef.current = chunk.text;
                    next.debugRawStream = chunk.text;
                    next.text = chunk.text;
                    const finalThinking = extractThinkingFromTaggedText(chunk.text);
                    const previousThinking = thinkingSnapshotRef.current;
                    if (finalThinking && finalThinking !== previousThinking) {
                        const thinkingDelta = previousThinking && finalThinking.startsWith(previousThinking)
                            ? finalThinking.slice(previousThinking.length)
                            : finalThinking;
                        thinkingSnapshotRef.current = finalThinking;
                        if (thinkingDelta.trim()) {
                            next.thinkingTrace = appendThinkingStream(next.thinkingTrace, thinkingDelta);
                        }
                    }
                }
                if (chunk.spec !== undefined) {
                    next.spec = normalizeIncomingSpec(chunk.spec);
                    if (next.spec != null) {
                        next.debugSpecSource = 'done';
                    }
                }
                next.uiRawText = extractUiRawText(rawAssistantStreamRef.current || next.text || '');
                next.debugHasUiJson = Boolean(next.uiRawText);
                if (next.spec == null && next.text) {
                    next.spec = tryParseInlineSpecFromText(next.text);
                    if (next.spec != null) {
                        next.debugSpecSource = 'inline';
                    }
                }
                if (next.spec == null && rawAssistantStreamRef.current) {
                    next.spec = tryParseInlineSpecFromText(rawAssistantStreamRef.current);
                    if (next.spec != null) {
                        next.debugSpecSource = 'inline';
                    }
                }
                next.text = cleanupAssistantText(next.text || '', next.spec);
                next.thinking = false;
                next.streaming = false;
                next.tools = (next.tools ?? []).map((tool) => ({ ...tool, running: false }));
                if (next.a2aCards && next.a2aCards.length > 0) {
                    const inferredAgent = inferAgentFromText(next.text || '', agentDirectoryRef.current);
                    next.a2aCards = next.a2aCards.map((card) => {
                        if (card.status !== 'working') return card;
                        const resolvedAgent = card.agentId === 'unknown-agent' ? inferredAgent : undefined;
                        const finalDetail = (next.text || '').trim();
                        return upsertA2aFinalResultLog(
                            {
                                ...card,
                                agentId: resolvedAgent?.id || card.agentId,
                                agentName: resolvedAgent?.name || card.agentName,
                                agentAvatarUrl: card.agentAvatarUrl || resolvedAgent?.avatarUrl,
                                agentColor: card.agentColor || resolvedAgent?.color,
                                status: 'completed',
                                summary: '已完成',
                                finishedAt: card.finishedAt || new Date().toISOString(),
                            },
                            finalDetail || '主智能体输出完成，子任务已完成。',
                        );
                    });
                }
                next.cardPending = false;

            } else if (chunk.kind === 'error') {
                next.debugReceivedError = true;
                const detail = chunk.value || '流式输出失败';
                next.toolTrace = pushTrace(next.toolTrace, {
                    id: generateId(),
                    title: '流式错误',
                    detail,
                    at: new Date().toISOString(),
                });
                next.cardPending = false;
                if (!next.text) {
                    next.text = detail;
                }
                if (next.a2aCards && next.a2aCards.length > 0) {
                    next.a2aCards = next.a2aCards.map((card) => {
                        if (card.status !== 'working') return card;
                        return {
                            ...card,
                            status: 'failed',
                            summary: '失败',
                            finishedAt: new Date().toISOString(),
                            logs: [{
                                id: generateId(),
                                at: new Date().toISOString(),
                                title: '执行失败',
                                detail,
                            }],
                        };
                    });
                }
                if (activeRequestSessionIdRef.current) {
                    setSessionStreamState(activeRequestSessionIdRef.current, 'idle');
                }
                if (streamStateRef.current !== 'idle') {
                    setStreamState('idle');
                }
            }

            const protocolOnly = looksLikeProtocolOnlyText(next.text || '');
            const hasRenderable = Boolean(next.spec) || (!protocolOnly && Boolean(next.text));
            if (chunk.kind === 'done' && !hasRenderable) {
                const fallbackText = extractLatestToolReadableText(next.toolTrace);
                const fallbackSpec = buildFallbackSpecFromToolTrace(next.toolTrace);
                if (fallbackSpec != null) {
                    next.spec = fallbackSpec;
                    next.debugSpecSource = 'tool_result';
                    next.uiStreamState = 'ready';
                    next.cardPending = false;
                }
                next.text = fallbackText && !looksLikeProtocolOnlyText(fallbackText)
                    ? fallbackText
                    : '已根据工具调用日志生成兜底卡片。';
            }

            streamingDraftRef.current = next;
            const pendingId = pendingMessageIdRef.current;
            const requestSessionId = activeRequestSessionIdRef.current || activeSessionIdRef.current;
            if (pendingId) {
                if (chunk.kind === 'done' || chunk.kind === 'error') {
                    flushPendingStreamDraft();
                } else {
                    schedulePendingStreamDraft();
                }
            } else {
                setStreamingMessage(next);
            }

            if (pendingId && (chunk.kind === 'done' || chunk.kind === 'error')) {
                clearStreamPatchTimer();
                clearWaitingFinalizeTimer();
                finalizedRequestIdRef.current = chunk.requestId;
                pendingMessageIdRef.current = null;
                activeRequestIdRef.current = null;
                unbindRuntimeRequest(chunk.requestId);
                activeRequestSessionIdRef.current = '';
                streamingDraftRef.current = null;
                patchBufferRef.current.delete(chunk.requestId);
                rawAssistantStreamRef.current = '';
                doneReceivedRef.current = false;
                thinkingSnapshotRef.current = '';
                setStreamingMessage(null);
                if (watchdogRef.current != null) {
                    window.clearTimeout(watchdogRef.current);
                    watchdogRef.current = null;
                }
                if (requestSessionId) {
                    setSessionStreamState(requestSessionId, 'idle');
                }
                setIsSending(false);
                setSilentDispatching(false);
                setStreamState('idle');
            }
        });

        return () => {
            clearStreamPatchTimer();
            unsubscribe();
        };
    }, []);

    const sendMessageInternal = async (
        rawText: string,
        options?: {
            appendUser?: boolean;
            agentIdOverride?: string;
            agentOverride?: Agent;
            userDisplayText?: string;
            userAttachments?: Message['attachments'];
        },
    ) => {
        const text = rawText.trim();
        if (!text || isSendingRef.current) {
            setSilentDispatching(false);
            return;
        }
        const appendUser = options?.appendUser ?? true;
        const dispatchAgentId = (options?.agentIdOverride ?? chatAgentId).trim() || chatAgentId;
        const dispatchAgent = options?.agentOverride ?? (dispatchAgentId === agent.id ? agent : buildFallbackAgent(dispatchAgentId));

        const requestId = generateId();
        const startedAt = Date.now();
        const userMsg: Message | null = appendUser
            ? {
                id: generateId(),
                role: 'user',
                text: options?.userDisplayText?.trim() || text,
                attachments: options?.userAttachments?.map((item) => ({ ...item })),
                timestamp: new Date().toISOString(),
            }
            : null;
        const readiness = agentReadinessRef.current.get(dispatchAgentId);
        if (isAgentChatUnavailable(readiness)) {
            const reasonText = buildAgentChatUnavailableMessage(readiness);
            const failed: Message = {
                id: generateId(),
                role: 'agent',
                agentId: dispatchAgentId,
                agentName: dispatchAgent.name,
                agentAvatarUrl: dispatchAgent.avatarUrl,
                agentColor: dispatchAgent.color,
                agentPortraitUrl: dispatchAgent.portraitUrl,
                text: reasonText,
                timestamp: new Date().toISOString(),
                toolTrace: [
                    {
                        id: generateId(),
                        title: '模型配置异常',
                        detail: reasonText,
                        at: new Date().toISOString(),
                    },
                ],
            };
            commitMessages((prev) => (userMsg ? [...prev, userMsg, failed] : [...prev, failed]));
            setSilentDispatching(false);
            return;
        }
        const history = buildHistory(messagesRef.current);
        const outgoingAttachments = (options?.userAttachments ?? [])
            .filter((item): item is NonNullable<Message['attachments']>[number] => Boolean(item))
            .map((item) => ({
                id: item.id,
                kind: item.kind,
                filename: item.name,
                fileId: item.upstreamFileId,
                contentType: item.mimeType,
                relativePath: item.relativePath,
                savedPath: item.savedPath,
                assetUrl: item.assetUrl,
                size: item.size,
            }))
            .filter((item) => Boolean(item.fileId));
        const draft: Message = {
            id: generateId(),
            role: 'agent',
            agentId: dispatchAgentId,
            agentName: dispatchAgent.name,
            agentAvatarUrl: dispatchAgent.avatarUrl,
            agentColor: dispatchAgent.color,
            agentPortraitUrl: dispatchAgent.portraitUrl,
            text: '',
            meta: '',
            tools: [],
            thinking: true,
            streaming: true,
            uiRawText: '',
            uiStreamState: 'idle',
            debugRawStream: '',
            debugNativeFrames: '',
            debugDonePayload: '',
            debugPromptChannel: CHAT_CHANNELS.app,
            debugRenderMode: CHAT_RENDER_MODES.jsonRender,
            debugHasUiJson: false,
            debugSpecSource: 'none',
            timestamp: new Date().toISOString(),
            thinkingTrace: [],
            toolTrace: [],
            generationStartedAt: startedAt,
            generationElapsedMs: 0,
        };

        activeRequestIdRef.current = requestId;
        activeRequestSessionIdRef.current = activeSessionIdRef.current;
        finalizedRequestIdRef.current = null;
        clearStreamPatchTimer();
        streamingDraftRef.current = draft;
        pendingMessageIdRef.current = null;
        patchBufferRef.current.set(requestId, '');
        rawAssistantStreamRef.current = '';
        thinkingSnapshotRef.current = '';
        doneReceivedRef.current = false;
        chunkCountRef.current = 0;
        setSilentDispatching(false);
        setIsSending(true);
        setStreamState('streaming');
        if (activeRequestSessionIdRef.current) {
            setSessionStreamState(activeRequestSessionIdRef.current, 'streaming');
        }
        pendingMessageIdRef.current = draft.id;
        bindRuntimeRequest(requestId, activeRequestSessionIdRef.current, draft.id);
                commitMessages((prev) => (userMsg ? [...prev, userMsg, draft] : [...prev, draft]));
        setStreamingMessage(draft);
        watchdogRef.current = window.setTimeout(() => {
            const current = streamingDraftRef.current;
            if (!current || doneReceivedRef.current || chunkCountRef.current > 0) {
                return;
            }
            const next: Message = {
                ...current,
                debugWatchdogTriggered: true,
                debugChunkCount: 0,
                debugLastChunkKind: 'none',
                debugLastEvent: 'watchdog_timeout',
                cardPending: false,
                generationElapsedMs: Math.max(0, Date.now() - (current.generationStartedAt || Date.now())),
                text: current.text || '上游未返回任何输出流，请检查运行时或工具结果回流。',
                toolTrace: pushTrace(current.toolTrace, {
                    id: generateId(),
                    title: '无输出 watchdog',
                    detail: '请求发出后在预设时间内未收到任何 chunk / done / error。',
                    at: new Date().toISOString(),
                }),
            };
            streamingDraftRef.current = next;
            setStreamingMessage(next);
            if (activeRequestSessionIdRef.current) {
                setSessionStreamState(activeRequestSessionIdRef.current, 'idle');
            }
            setStreamState('idle');
            setIsSending(false);
            setSilentDispatching(false);
        }, 10000);

        let keepWaiting = false;
        try {
            const requestSessionTarget = resolveRequestSessionTarget(activeRequestSessionIdRef.current);
            const result = await sendAgentChat(withChatRenderContext({
                agentId: dispatchAgentId,
                message: text,
                history,
                attachments: outgoingAttachments,
                stream: true,
                requestId,
                sessionId: requestSessionTarget.sessionId,
                sessionLabel: requestSessionTarget.sessionLabel,
                systemPreamble: systemPreambleRef.current || undefined,
            }, {
                channel: CHAT_CHANNELS.app,
                renderMode: CHAT_RENDER_MODES.jsonRender,
            }));

            if (finalizedRequestIdRef.current === requestId) {
                keepWaiting = false;
                return;
            }

            const finalDraft = streamingDraftRef.current
                ? { ...streamingDraftRef.current }
                : {
                    id: generateId(),
                    role: 'agent' as const,
                    agentId: dispatchAgentId,
                    agentName: dispatchAgent.name,
                    agentAvatarUrl: dispatchAgent.avatarUrl,
                    agentColor: dispatchAgent.color,
                    agentPortraitUrl: dispatchAgent.portraitUrl,
                    text: '',
                    uiRawText: '',
                    uiStreamState: 'idle' as const,
                    timestamp: new Date().toISOString(),
                    thinkingTrace: [],
                    toolTrace: [],
                    generationStartedAt: startedAt,
                    generationElapsedMs: 0,
                };
            finalDraft.generationStartedAt = finalDraft.generationStartedAt ?? startedAt;
            finalDraft.generationElapsedMs = Math.max(0, Date.now() - finalDraft.generationStartedAt);

            if (!finalDraft.text) {
                finalDraft.text = result.text || result.content || '';
            }
            if (!finalDraft.uiRawText) {
                finalDraft.uiRawText = result.uiRawText || extractUiRawText(result.text || result.content || '');
            }
            finalDraft.debugNormalizedUiRawText = finalDraft.uiRawText || '';
            finalDraft.debugRepairedUiRawText = finalDraft.uiRawText ? repairUiJsonString(finalDraft.uiRawText) : '';
            finalDraft.debugUiContractWarnings = (() => {
                const raw = finalDraft.uiRawText || '';
                if (!raw) return '';
                const warnings: string[] = [];
                if (/[：，；（）【】]/.test(raw)) warnings.push('检测到全角标点');
                if (/"(?:description|content|desc|avatarUrl|avatar_url|image|imageUrl|image_url|labels|chips|bullets|points|groups|group|panels|panel|list|rows|heading|entries|fields|key|text)"\s*:/.test(raw)) {
                    warnings.push('检测到别名字段');
                }
                if (/"(?:data|meta|profile|header|body|blocks)"\s*:/.test(raw)) {
                    warnings.push('检测到多余包装层');
                }
                if (/"type"\s*:\s*"ProfileIntroCard"/.test(raw) && !/"sections"\s*:/.test(raw)) {
                    warnings.push('ProfileIntroCard 缺少 sections');
                }
                return warnings.join('；');
            })();
            if (finalDraft.spec == null && result.spec != null) {
                finalDraft.spec = normalizeIncomingSpec(result.spec);
            }
            if (finalDraft.spec == null && finalDraft.text) {
                finalDraft.spec = tryParseInlineSpecFromText(finalDraft.text);
            }
            if (finalDraft.spec == null && rawAssistantStreamRef.current) {
                finalDraft.spec = tryParseInlineSpecFromText(rawAssistantStreamRef.current);
            }
            try {
                finalDraft.debugNormalizedSpecText = finalDraft.spec == null
                    ? ''
                    : typeof finalDraft.spec === 'string'
                        ? finalDraft.spec
                        : JSON.stringify(finalDraft.spec, null, 2);
            } catch {
                finalDraft.debugNormalizedSpecText = String(finalDraft.spec ?? '');
            }
            finalDraft.debugProfileIntroDetected = Boolean(
                finalDraft.debugNormalizedSpecText && finalDraft.debugNormalizedSpecText.includes('ProfileIntroCard'),
            );
            const profileSchemaReady = Boolean(getManifestSchemaFromCache('ProfileIntroCard'));
            finalDraft.debugLegacySanitizer = finalDraft.debugProfileIntroDetected && !profileSchemaReady ? 'ProfileIntroCard' : '';
            finalDraft.debugSchemaSanitizer = profileSchemaReady ? 'manifest-cache-ready+fallback-patch' : 'manifest-prompt-only';
            const taskCardCandidateText = finalDraft.text || result.text || result.content || rawAssistantStreamRef.current || '';
            finalDraft.text = cleanupAssistantText(finalDraft.text || '', finalDraft.spec);
            if (!finalDraft.text && !finalDraft.spec && !doneReceivedRef.current && finalDraft.cardPending) {
                finalDraft.text = '卡片生成未完成，请重试。';
            }
            if (!finalDraft.text && !finalDraft.spec && (finalDraft.toolTrace?.length ?? 0) > 0) {
                finalDraft.text = '已调用工具处理中，请稍后重试。';
            }
            if (!result.success) {
                finalDraft.toolTrace = pushTrace(finalDraft.toolTrace, {
                    id: generateId(),
                    title: '请求失败',
                    detail: result.error || result.content || '未知错误',
                    at: new Date().toISOString(),
                });
                if (!finalDraft.text) {
                    finalDraft.text = result.error || result.content || '请求失败';
                }
            }
            if (!finalDraft.taskCard) {
                const proposalFromLlm = createProposalTaskCard(taskCardCandidateText || finalDraft.text || '');
                if (proposalFromLlm) {
                    finalDraft.taskCard = proposalFromLlm;
                }
            }
            const protocolOnly = looksLikeProtocolOnlyText(finalDraft.text || '');
            const hasRenderable = Boolean(finalDraft.spec) || (!protocolOnly && Boolean(finalDraft.text));
            if (!hasRenderable && doneReceivedRef.current) {
                finalDraft.text = extractLatestToolReadableText(finalDraft.toolTrace) || '本次回复暂未返回可展示内容。';
            }
            keepWaiting = result.success && !doneReceivedRef.current;
            finalDraft.cardPending = keepWaiting ? true : false;

            const draftId = pendingMessageIdRef.current;
            const requestSessionId = activeRequestSessionIdRef.current || activeSessionIdRef.current;
            if (draftId) {
                patchSessionMessageById(requestSessionId, draftId, finalDraft);
            } else {
                commitMessages((prev) => [...prev, finalDraft]);
            }
            setStreamingMessage(null);
            if (keepWaiting) {
                setStreamState('waiting');
                if (requestSessionId) {
                    setSessionStreamState(requestSessionId, 'waiting');
                }
                clearWaitingFinalizeTimer();
                waitingFinalizeRef.current = window.setTimeout(() => {
                    if (doneReceivedRef.current || activeRequestIdRef.current !== requestId) {
                        return;
                    }
                    const pendingId = pendingMessageIdRef.current;
                    const current = streamingDraftRef.current;
                    if (!pendingId || !current) {
                        return;
                    }
                    const fallbackText = cleanupAssistantText(
                        current.text || extractLatestToolReadableText(current.toolTrace) || '本次响应未返回终态 done，已自动结束输出。',
                        current.spec,
                    );
                    const finalized: Message = {
                        ...current,
                        text: fallbackText,
                        cardPending: false,
                        streaming: false,
                        thinking: false,
                        toolTrace: pushTrace(current.toolTrace, {
                            id: generateId(),
                            title: '终态兜底',
                            detail: '已收到阶段结束信号，但未收到 done/error，前端已自动收尾。',
                            at: new Date().toISOString(),
                        }),
                    };
                    patchSessionMessageById(requestSessionId, pendingId, finalized);
                    patchBufferRef.current.delete(requestId);
                    rawAssistantStreamRef.current = '';
                    thinkingSnapshotRef.current = '';
                    finalizedRequestIdRef.current = requestId;
                    activeRequestIdRef.current = null;
                    unbindRuntimeRequest(requestId);
                    activeRequestSessionIdRef.current = '';
                    streamingDraftRef.current = null;
                    pendingMessageIdRef.current = null;
                    doneReceivedRef.current = false;
                    setStreamingMessage(null);
                    if (requestSessionId) {
                        setSessionStreamState(requestSessionId, 'idle');
                    }
                    clearStreamPatchTimer();
                    setIsSending(false);
                    setSilentDispatching(false);
                    setStreamState('idle');
                }, 3500);
            } else {
                clearWaitingFinalizeTimer();
                pendingMessageIdRef.current = null;
                if (requestSessionId) {
                    setSessionStreamState(requestSessionId, 'idle');
                }
                setStreamState('idle');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : '发送失败';
            const failed: Message = {
                id: generateId(),
                role: 'agent',
                agentId: chatAgentId,
                agentName: agent.name,
                agentAvatarUrl: agent.avatarUrl,
                agentColor: agent.color,
                agentPortraitUrl: agent.portraitUrl,
                text: message,
                timestamp: new Date().toISOString(),
                generationStartedAt: startedAt,
                generationElapsedMs: Math.max(0, Date.now() - startedAt),
                toolTrace: [
                    {
                        id: generateId(),
                        title: '请求异常',
                        detail: message,
                        at: new Date().toISOString(),
                    },
                ],
            };
            commitMessages((prev) => [...prev, failed]);
            if (activeRequestSessionIdRef.current) {
                setSessionStreamState(activeRequestSessionIdRef.current, 'idle');
            }
            setStreamState('idle');
        } finally {
            patchBufferRef.current.delete(requestId);
            if (!keepWaiting) {
                clearWaitingFinalizeTimer();
                clearStreamPatchTimer();
                activeRequestIdRef.current = null;
                unbindRuntimeRequest(requestId);
                if (activeRequestSessionIdRef.current) {
                    setSessionStreamState(activeRequestSessionIdRef.current, 'idle');
                }
                activeRequestSessionIdRef.current = '';
                streamingDraftRef.current = null;
                pendingMessageIdRef.current = null;
                rawAssistantStreamRef.current = '';
                thinkingSnapshotRef.current = '';
                doneReceivedRef.current = false;
                if (watchdogRef.current != null) {
                    window.clearTimeout(watchdogRef.current);
                    watchdogRef.current = null;
                }
                setStreamingMessage(null);
                setIsSending(false);
                setSilentDispatching(false);
            }
        }
    };

    const updateTaskCardMessage = (messageId: string, updater: (card: ChatTaskCardData) => ChatTaskCardData) => {
        commitMessages((prev) => prev.map((message) => {
            if (message.id !== messageId || !message.taskCard) return message;
            return {
                ...message,
                taskCard: updater(message.taskCard),
            };
        }));
    };

    const setTaskCardMessage = (messageId: string, taskCard: ChatTaskCardData) => {
        commitMessages((prev) => prev.map((message) => {
            if (message.id !== messageId) return message;
            return {
                ...message,
                taskCard,
            };
        }));
    };

    const ensureTaskCardFromMessage = (messageId: string): ChatTaskCardData | null => {
        const target = messagesRef.current.find((message) => message.id === messageId);
        if (!target) return null;
        if (target.taskCard) return target.taskCard;
        const candidateText = `${target.text || ''}\n${target.uiRawText || ''}`.trim();
        if (!candidateText) return null;
        const recovered = createProposalTaskCardFromAssistantText(candidateText);
        if (!recovered) return null;
        setTaskCardMessage(messageId, recovered);
        return recovered;
    };

    const updateTaskCardByTaskId = (taskId: string, updater: (card: ChatTaskCardData) => ChatTaskCardData) => {
        commitMessages((prev) => prev.map((message) => {
            if (!message.taskCard || message.taskCard.taskId !== taskId) return message;
            return {
                ...message,
                taskCard: updater(message.taskCard),
            };
        }));
    };

    type AutoDispatchMeta = {
        chainId: string;
        depth: number;
        from?: string;
    };

    const parseAutoDispatchMeta = (meta?: string): AutoDispatchMeta | null => {
        const raw = (meta || '').trim();
        if (!raw.startsWith('auto_dispatch:')) return null;
        const tail = raw.slice('auto_dispatch:'.length).trim();
        if (!tail) return null;
        const items = tail.split(';').map((part) => part.trim()).filter(Boolean);
        const obj: Record<string, string> = {};
        for (const item of items) {
            const idx = item.indexOf('=');
            if (idx <= 0) continue;
            const key = item.slice(0, idx).trim();
            const value = item.slice(idx + 1).trim();
            if (!key || !value) continue;
            obj[key] = value;
        }
        const chainId = (obj.chain || obj.chainId || '').trim();
        const depthRaw = (obj.depth || '').trim();
        const depth = Number.isFinite(Number(depthRaw)) ? Math.max(0, Number(depthRaw)) : 0;
        if (!chainId) return null;
        const from = (obj.from || '').trim();
        return { chainId, depth, from: from || undefined };
    };

    const formatAutoDispatchMeta = (meta: AutoDispatchMeta): string => {
        const parts = [`chain=${meta.chainId}`, `depth=${meta.depth}`];
        if (meta.from) {
            parts.push(`from=${meta.from}`);
        }
        return `auto_dispatch:${parts.join(';')}`;
    };

    const extractMentions = (text: string): string[] => {
        const raw = text || '';
        if (!raw.includes('@')) return [];
        const regex = /@([A-Za-z0-9_-]{2,64}|[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9_-]{0,23})/g;
        const out: string[] = [];
        const seen = new Set<string>();
        let match: RegExpExecArray | null = null;
        while ((match = regex.exec(raw)) !== null) {
            const token = (match[1] || '').trim();
            if (!token) continue;
            const key = token.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(token);
            if (out.length >= 12) break;
        }
        return out;
    };

    const buildMentionDirectory = (agents: Agent[]): Map<string, Agent> => {
        const map = new Map<string, Agent>();
        for (const item of agents) {
            if (!item?.id) continue;
            const id = item.id.trim();
            if (!id) continue;
            map.set(id.toLowerCase(), item);
            const name = (item.name || '').trim();
            if (name && !map.has(name.toLowerCase())) {
                map.set(name.toLowerCase(), item);
            }
            const title = (item.title || '').trim();
            if (title && !map.has(title.toLowerCase())) {
                map.set(title.toLowerCase(), item);
            }
        }
        return map;
    };

    const mentionProcessedRef = useRef<Set<string>>(new Set());
    const mentionDispatchRunningRef = useRef(false);
    const stopProcessedRef = useRef<Set<string>>(new Set());

    const stopAuthoritySet = useMemo(() => {
        const set = new Set<string>();
        for (const raw of stopAuthorityAgentIds) {
            const key = raw.trim().toLowerCase();
            if (key) set.add(key);
        }
        return set;
    }, [stopAuthorityAgentIds]);

    const shouldStopByText = (raw: string): boolean => {
        const text = (raw || '').trim();
        if (!text) return false;
        const lower = text.toLowerCase();
        if (lower.includes('/stop')) return true;
        if (text.includes('终止讨论')) return true;
        if (text.includes('停止讨论')) return true;
        if (text.includes('到此为止')) return true;
        if (text.includes('闭麦')) return true;
        return false;
    };

    const stopAutoDispatchChain = () => {
        autoDispatchAbortTokenRef.current += 1;
        pendingSilentMessagesRef.current = [];
        setPendingSilentCount(0);
        setMultiReplyDispatching(false);
    };

    useEffect(() => {
        if (stopAuthoritySet.size === 0) return;
        const candidates = messages
            .filter((msg) => msg.role === 'agent')
            .filter((msg) => Boolean(msg.text?.trim()))
            .filter((msg) => !msg.thinking && !msg.streaming)
            .filter((msg) => !stopProcessedRef.current.has(msg.id))
            .filter((msg) => {
                const agentId = (msg.agentId || '').trim().toLowerCase();
                return agentId && stopAuthoritySet.has(agentId);
            });
        if (!candidates.length) return;
        for (const msg of candidates) {
            stopProcessedRef.current.add(msg.id);
            if (shouldStopByText(msg.text || '')) {
                stopAutoDispatchChain();
                break;
            }
        }
    }, [messages, stopAuthoritySet]);

    useEffect(() => {
        const dispatchAgents = mentionDispatchAgentsRef.current;
        if (!dispatchAgents.length) return;
        if (isSendingRef.current || silentDispatchingRef.current || multiReplyDispatchingRef.current) {
            return;
        }
        if (mentionDispatchRunningRef.current) {
            return;
        }

        const candidates = messages
            .filter((msg) => msg.role === 'agent')
            .filter((msg) => Boolean(msg.text?.trim()))
            .filter((msg) => !msg.thinking && !msg.streaming)
            .filter((msg) => !mentionProcessedRef.current.has(msg.id));
        if (!candidates.length) return;

        mentionDispatchRunningRef.current = true;
        const abortToken = autoDispatchAbortTokenRef.current;
        void (async () => {
            const directory = buildMentionDirectory(dispatchAgents);
            setMultiReplyDispatching(true);
            try {
                for (const msg of candidates) {
                    if (autoDispatchAbortTokenRef.current !== abortToken) {
                        break;
                    }
                    mentionProcessedRef.current.add(msg.id);

                    const senderId = (msg.agentId || '').trim() || chatAgentId.trim();
                    const autoMeta = parseAutoDispatchMeta(msg.meta);
                    const chainId = autoMeta?.chainId ?? msg.id;
                    const depth = autoMeta?.depth ?? 0;
                    const from = autoMeta?.from ?? '';
                    if (depth >= mentionDispatchMaxDepth) {
                        continue;
                    }

                    const mentionTokens = extractMentions(msg.text || '');
                    if (!mentionTokens.length) {
                        continue;
                    }

                    const targets: Agent[] = [];
                    const seenTargets = new Set<string>();
                    for (const token of mentionTokens) {
                        const hit = directory.get(token.toLowerCase());
                        if (!hit?.id) continue;
                        const targetId = hit.id.trim();
                        if (!targetId) continue;
                        if (targetId === senderId) continue;
                        if (from && targetId === from) continue;
                        if (seenTargets.has(targetId)) continue;
                        seenTargets.add(targetId);
                        targets.push(hit);
                        if (targets.length >= mentionDispatchMaxTargets) {
                            break;
                        }
                    }
                    if (!targets.length) {
                        continue;
                    }

                    const getActiveSessionMessagesSnapshot = (): Message[] => {
                        const sid = activeSessionIdRef.current;
                        if (!sid) return [];
                        const runtimeState = chatRuntimeStore.getAgentState(runtimeAgentIdRef.current);
                        const session = runtimeState.sessions.find((s) => s.id === sid);
                        return session?.messages ?? [];
                    };

                    for (const target of targets) {
                        if (autoDispatchAbortTokenRef.current !== abortToken) {
                            break;
                        }
                        const targetId = target.id.trim();
                        if (!targetId) continue;

                        const readiness = agentReadinessRef.current.get(targetId);
                        if (isAgentChatUnavailable(readiness)) {
                            const fallbackText = buildAgentChatUnavailableMessage(readiness);
                            commitMessages((prev) => [...prev, {
                                id: generateId(),
                                role: 'agent',
                                agentId: targetId,
                                agentName: target.name,
                                agentAvatarUrl: target.avatarUrl,
                                agentColor: target.color,
                                agentPortraitUrl: target.portraitUrl,
                                text: fallbackText,
                                thinking: false,
                                streaming: false,
                                uiRawText: '',
                                uiStreamState: 'idle',
                                timestamp: new Date().toISOString(),
                                thinkingTrace: [],
                                toolTrace: [],
                                generationStartedAt: Date.now(),
                                generationElapsedMs: 0,
                            }]);
                            continue;
                        }

                        if (agentCooldownMs > 0) {
                            const lastSpokeAt = agentLastSpokeAtRef.current.get(targetId);
                            if (typeof lastSpokeAt === 'number' && Date.now() - lastSpokeAt < agentCooldownMs) {
                                continue;
                            }
                        }

                        const budget = tryConsumeTurnBudget(targetId);
                        if (!budget.ok) {
                            break;
                        }

                        const history = buildHistory(getActiveSessionMessagesSnapshot());
                        const baselineTexts = getRoundAgentTexts(getActiveSessionMessagesSnapshot());
                        const startedAt = Date.now();
                        const draftId = generateId();
                        const draft: Message = {
                            id: draftId,
                            role: 'agent',
                            agentId: targetId,
                            agentName: target.name,
                            agentAvatarUrl: target.avatarUrl,
                            agentColor: target.color,
                            agentPortraitUrl: target.portraitUrl,
                            text: '',
                            meta: formatAutoDispatchMeta({ chainId, depth: depth + 1, from: senderId }),
                            thinking: true,
                            streaming: false,
                            uiRawText: '',
                            uiStreamState: 'idle',
                            timestamp: new Date().toISOString(),
                            thinkingTrace: [],
                            toolTrace: [],
                            generationStartedAt: startedAt,
                            generationElapsedMs: 0,
                        };

                        commitMessages((prev) => [...prev, draft]);

                        const requestSessionTarget = resolveRequestSessionTarget();
                        const result = await sendAgentChat(withChatRenderContext({
                            agentId: targetId,
                            message: (msg.text || '').trim(),
                            history,
                            stream: false,
                            sessionId: requestSessionTarget.sessionId,
                            sessionLabel: requestSessionTarget.sessionLabel,
                            systemPreamble: systemPreambleRef.current || undefined,
                        }, {
                            channel: CHAT_CHANNELS.app,
                            renderMode: CHAT_RENDER_MODES.jsonRender,
                        }));

                        const raw = (result.text || result.content || '').trim();
                        const spec = raw ? tryParseInlineSpecFromText(raw) : null;
                        const uiRawText = raw ? extractUiRawText(raw) : '';
                        const fallbackText = result.success
                            ? ''
                            : (result.error?.trim()
                                ? '该成员当前不可用，已跳过。'
                                : '该成员当前不可用，已跳过。');
                        const finalText = raw
                            ? cleanupAssistantText(raw, spec)
                            : (result.success ? '' : fallbackText);

                        if (!result.success && budget.consumedNew) {
                            refundTurnBudget(targetId);
                        }

                        if (result.success && finalText && isNearDuplicate(finalText, baselineTexts)) {
                            if (budget.consumedNew) {
                                refundTurnBudget(targetId);
                            }
                            commitMessages((prev) => prev.filter((row) => row.id !== draftId));
                            continue;
                        }

                        commitMessages((prev) => prev.map((row) => {
                            if (row.id !== draftId) return row;
                            return {
                                ...row,
                                thinking: false,
                                streaming: false,
                                spec: spec ?? undefined,
                                uiRawText,
                                uiStreamState: uiRawText ? 'ready' : 'idle',
                                text: finalText,
                                generationElapsedMs: Math.max(0, Date.now() - startedAt),
                            };
                        }));
                    }
                }
            } finally {
                setMultiReplyDispatching(false);
                mentionDispatchRunningRef.current = false;
            }
        })();
    }, [chatAgentId, mentionDispatchMaxDepth, mentionDispatchMaxTargets, messages]);

    const handleSendMessage = async (payload: ChatSendPayload) => {
        if (inputLocked) return;
        const submitText = payload.submitText.trim();
        const displayText = payload.displayText.trim();
        const text = submitText || displayText;
        if (!text) return;
        markUserActivity('send');
        const transformed = transformUserMessageRef.current ? transformUserMessageRef.current(text) : text;
        resetTurnBudget(chatAgentId);
        await sendMessageInternal(transformed, {
            appendUser: true,
            userDisplayText: displayText || transformed,
            userAttachments: payload.attachments,
        });

        const extras = resolveExtraReplyAgents(transformed)
            .filter((item) => item?.id && item.id.trim() && item.id.trim() !== chatAgentId)
            .filter((item) => item.id.trim() !== runtimeAgentIdRef.current);
        if (extras.length === 0) {
            return;
        }
        if (isSendingRef.current || silentDispatchingRef.current || multiReplyDispatchingRef.current) {
            return;
        }

        const getActiveSessionMessagesSnapshot = (): Message[] => {
            const sid = activeSessionIdRef.current;
            if (!sid) return [];
            const runtimeState = chatRuntimeStore.getAgentState(runtimeAgentIdRef.current);
            const session = runtimeState.sessions.find((s) => s.id === sid);
            return session?.messages ?? [];
        };

        const abortToken = autoDispatchAbortTokenRef.current;
        setMultiReplyDispatching(true);
        try {
            for (const extra of extras) {
                if (autoDispatchAbortTokenRef.current !== abortToken) {
                    break;
                }
                const extraId = extra.id.trim();
                if (!extraId) continue;

                const readiness = agentReadinessRef.current.get(extraId);
                if (isAgentChatUnavailable(readiness)) {
                    const fallbackText = buildAgentChatUnavailableMessage(readiness);
                    commitMessages((prev) => [...prev, {
                        id: generateId(),
                        role: 'agent',
                        agentId: extraId,
                        agentName: extra.name,
                        agentAvatarUrl: extra.avatarUrl,
                        agentColor: extra.color,
                        agentPortraitUrl: extra.portraitUrl,
                        text: fallbackText,
                        thinking: false,
                        streaming: false,
                        uiRawText: '',
                        uiStreamState: 'idle',
                        timestamp: new Date().toISOString(),
                        thinkingTrace: [],
                        toolTrace: [],
                        generationStartedAt: Date.now(),
                        generationElapsedMs: 0,
                    }]);
                    continue;
                }

                const budget = tryConsumeTurnBudget(extraId);
                if (!budget.ok) {
                    break;
                }

                const history = buildHistory(getActiveSessionMessagesSnapshot());
                const baselineTexts = getRoundAgentTexts(getActiveSessionMessagesSnapshot());
                const startedAt = Date.now();
                const draftId = generateId();
                const draft: Message = {
                    id: draftId,
                    role: 'agent',
                    agentId: extraId,
                    agentName: extra.name,
                    agentAvatarUrl: extra.avatarUrl,
                    agentColor: extra.color,
                    agentPortraitUrl: extra.portraitUrl,
                    text: '',
                    thinking: true,
                    streaming: false,
                    uiRawText: '',
                    uiStreamState: 'idle',
                    timestamp: new Date().toISOString(),
                    thinkingTrace: [],
                    toolTrace: [],
                    generationStartedAt: startedAt,
                    generationElapsedMs: 0,
                };

                commitMessages((prev) => [...prev, draft]);

                const requestSessionTarget = resolveRequestSessionTarget();
                const result = await sendAgentChat(withChatRenderContext({
                    agentId: extraId,
                    message: transformed.trim(),
                    history,
                    stream: false,
                    sessionId: requestSessionTarget.sessionId,
                    sessionLabel: requestSessionTarget.sessionLabel,
                    systemPreamble: systemPreambleRef.current || undefined,
                }, {
                    channel: CHAT_CHANNELS.app,
                    renderMode: CHAT_RENDER_MODES.jsonRender,
                }));

                const raw = (result.text || result.content || '').trim();
                const spec = raw ? tryParseInlineSpecFromText(raw) : null;
                const uiRawText = raw ? extractUiRawText(raw) : '';
                const fallbackText = result.success
                    ? ''
                    : (result.error?.trim()
                        ? '该成员当前不可用，已跳过。'
                        : '该成员当前不可用，已跳过。');
                const finalText = raw
                    ? cleanupAssistantText(raw, spec)
                    : (result.success ? '' : fallbackText);

                if (!result.success && budget.consumedNew) {
                    refundTurnBudget(extraId);
                }

                if (result.success && finalText && isNearDuplicate(finalText, baselineTexts)) {
                    if (budget.consumedNew) {
                        refundTurnBudget(extraId);
                    }
                    commitMessages((prev) => prev.filter((msg) => msg.id !== draftId));
                    continue;
                }

                commitMessages((prev) => prev.map((msg) => {
                    if (msg.id !== draftId) return msg;
                    return {
                        ...msg,
                        thinking: false,
                        streaming: false,
                        spec: spec ?? undefined,
                        uiRawText,
                        uiStreamState: uiRawText ? 'ready' : 'idle',
                        text: finalText,
                        generationElapsedMs: Math.max(0, Date.now() - startedAt),
                    };
                }));
            }
        } finally {
            setMultiReplyDispatching(false);
        }
    };

    useEffect(() => {
        if (!idleAutoEnabled || !idleAutoScopeId || idleAutoMaxPerPage === 0) {
            return;
        }
        const timer = window.setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                return;
            }
            if (streamStateRef.current !== 'idle') {
                return;
            }
            if (isSendingRef.current || silentDispatchingRef.current || multiReplyDispatchingRef.current) {
                return;
            }
            if (pendingSilentCountRef.current > 0) {
                return;
            }

            const now = Date.now();
            if (idleAutoMaxPerPage > 0 && idleAutoTriggerCountRef.current >= idleAutoMaxPerPage) {
                return;
            }
            if (idleAutoCooldownMs > 0 && lastIdleAutoTriggeredAtRef.current > 0 && (now - lastIdleAutoTriggeredAtRef.current) < idleAutoCooldownMs) {
                return;
            }
            if (now - lastUserActivityAtRef.current < idleAutoIdleMs) {
                return;
            }

            const dateKey = formatLocalDateKey();
            const dailyKey = buildIdleAutoStorageKey(idleAutoScope, idleAutoScopeId, dateKey);
            const dailyCount = readLocalNumber(dailyKey);
            if (idleAutoMaxPerDay > 0 && dailyCount >= idleAutoMaxPerDay) {
                return;
            }

            const autoAgent = idleAutoAgentRef.current ?? agent;
            const autoAgentId = (autoAgent.id || '').trim() || chatAgentId;
            const context = buildIdleContextSummary(messagesRef.current, idleAutoScope === 'group', 6);
            const prompt = buildIdleAutoPrompt({
                agentName: autoAgent.name || autoAgentId || '智能体',
                isGroup: idleAutoScope === 'group',
                context,
            });

            idleAutoTriggerCountRef.current += 1;
            lastIdleAutoTriggeredAtRef.current = now;
            lastUserActivityAtRef.current = now;
            if (idleAutoMaxPerDay > 0) {
                writeLocalNumber(dailyKey, dailyCount + 1);
            }

            void sendMessageInternal(prompt, {
                appendUser: false,
                agentIdOverride: autoAgentId,
                agentOverride: autoAgent,
            });
        }, 10_000);

        return () => {
            window.clearInterval(timer);
        };
    }, [
        agent,
        chatAgentId,
        idleAutoCooldownMs,
        idleAutoEnabled,
        idleAutoIdleMs,
        idleAutoMaxPerDay,
        idleAutoMaxPerPage,
        idleAutoScope,
        idleAutoScopeId,
    ]);

    const handleCreateTaskCard = (messageId: string) => {
        const target = messagesRef.current.find((message) => message.id === messageId);
        if (!target?.taskCard || !['proposal', 'failed'].includes(target.taskCard.stage)) {
            return;
        }
        setPendingCreateTaskMessageId(messageId);
    };

    const encodeChatTaskSourceRef = (sessionId: string, messageId: string): string => {
        const sid = sessionId.trim();
        const mid = messageId.trim();
        if (!sid) return mid;
        if (!mid) return sid;
        return `${sid}::${mid}`;
    };

    const createAndStartTaskFromMessageId = async (sourceMessageId: string) => {
        if (!sourceMessageId || taskActionBusy) return;
        const sourceMessage = messagesRef.current.find((message) => message.id === sourceMessageId);
        const sourceCard = sourceMessage?.taskCard || ensureTaskCardFromMessage(sourceMessageId);
        if (!sourceCard || !['proposal', 'failed'].includes(sourceCard.stage)) {
            return;
        }

        setTaskActionBusy(true);
        try {
            const created = await createTask({
                teamId: chatAgentId,
                runtimeKey: runtimeAgentIdRef.current,
                sourceType: 'chat',
                sourceRef: encodeChatTaskSourceRef(activeSessionIdRef.current, sourceMessageId),
                name: sourceCard.taskName,
                schedule: {
                    kind: 'every',
                    everyMs: sourceCard.everyMs,
                },
                jobType: 'agent',
                prompt: sourceCard.executionPrompt,
                delivery: { mode: 'none' },
                maxRuns: sourceCard.maxRuns,
            });

            if (!created.success || !created.data) {
                pushInAppNotice({
                    title: '任务创建失败',
                    message: created.message || '未知错误',
                    level: 'error',
                });
                updateTaskCardMessage(sourceMessageId, (card) => ({
                    ...card,
                    stage: 'failed',
                    canCreate: true,
                    canCancel: true,
                    updatedAt: new Date().toISOString(),
                }));
                return;
            }

            const task = created.data;
            const runResult = await runTaskNow(task.id);
            const activeTaskId = runResult.activeTaskId || task.id;
            const latest = await getTaskDetail(activeTaskId);
            const latestRunCount = latest?.runInfo.runCount ?? task.runInfo.runCount;
            const latestStage = latest
                ? resolveCardStage(latest, sourceCard, latestRunCount)
                : 'scheduled';
            const nextCard: ChatTaskCardData = {
                ...sourceCard,
                stage: latestStage,
                taskId: activeTaskId,
                agentId: task.teamId,
                runCount: latestRunCount,
                nextRun: latest?.runInfo.nextRun ?? task.runInfo.nextRun,
                lastRun: latest?.runInfo.lastRun ?? task.runInfo.lastRun,
                lastStatus: latest?.runInfo.lastStatus ?? task.runInfo.lastStatus,
                canCreate: false,
                canCancel: true,
                canDelete: latestRunCount === 0 && !(latest?.runInfo.lastRun || task.runInfo.lastRun),
                updatedAt: new Date().toISOString(),
            };

            updateTaskCardMessage(sourceMessageId, () => nextCard);
            pushInAppNotice({
                title: runResult.success ? '任务已启动' : '任务已创建',
                message: runResult.success
                    ? `${nextCard.taskName} 已进入异步执行`
                    : `${nextCard.taskName} 创建成功，但启动失败：${runResult.message || '-'}`,
                level: runResult.success ? 'success' : 'error',
            });
        } finally {
            setTaskActionBusy(false);
        }
    };

    const handleConfirmCreateTaskCard = async (messageId: string) => {
        await createAndStartTaskFromMessageId(messageId);
    };

    const handleConfirmGroupUpgrade = useCallback(async (payload: GroupUpgradeActionPayload) => {
        if (!groupUpgradeEnabled || groupUpgradeBusy) {
            return;
        }

        const directory = agentDirectoryRef.current;
        const candidateTokens = extractGroupUpgradeCandidates(payload);
        const resolvedIds = candidateTokens
            .map((token) => findAgentByAlias(directory, token)?.id || '')
            .filter(Boolean);
        const memberSet = new Set(resolvedIds);
        memberSet.delete(chatAgentId);
        const memberAgentIds = [chatAgentId, ...memberSet].filter(Boolean);
        if (memberAgentIds.length < 2) {
            appendLocalAgentMessage('未找到可加入的其他成员，请补充有效的智能体名称或 ID。');
            return;
        }

        const groupName = readNestedString(payload, ['groupName'])
            || readNestedString(payload, ['group_name'])
            || `临时协作群（${agent.name || chatAgentId}）`;
        const reason = readNestedString(payload, ['reason']) || readNestedString(payload, ['description']);
        const description = reason || '由私聊升级创建的临时群聊';
        const tags = pickStringArray((payload as Record<string, unknown>).tags);

        setGroupUpgradeBusy(true);
        try {
            const group = await createChatGroup({
                name: groupName,
                description,
                tags: tags.length > 0 ? tags : ['临时', '自动建群'],
                leaderAgentId: chatAgentId,
                memberAgentIds,
                groupMode: 'leader_dispatch',
                applyCollaborationAcl: true,
            });
            navigate(`/group-chat/${encodeURIComponent(group.groupId)}`);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            appendLocalAgentMessage(`创建群聊失败：${detail || '未知错误'}`);
        } finally {
            setGroupUpgradeBusy(false);
        }
    }, [
        agent.name,
        appendLocalAgentMessage,
        chatAgentId,
        groupUpgradeBusy,
        groupUpgradeEnabled,
        navigate,
    ]);

    const handleCancelGroupUpgrade = useCallback(() => {
        if (!groupUpgradeEnabled) return;
        appendLocalAgentMessage('已取消拉群请求。如需多智能体协作，请随时告知。');
    }, [appendLocalAgentMessage, groupUpgradeEnabled]);

    const handleConfirmAgentManagement = useCallback(async (payload: Record<string, unknown>) => {
        try {
            const result = await executeAgentManagementAction(payload);
            appendLocalAgentMessage(result.summary);
            pushInAppNotice({
                title: `智能体${result.mode === 'create' ? '创建' : result.mode === 'update' ? '更新' : '删除'}成功`,
                message: `${result.displayName} (${result.agentId})`,
                level: 'success',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendLocalAgentMessage(`智能体管理操作失败：${message || '未知错误'}`);
            pushInAppNotice({
                title: '智能体管理失败',
                message: message || '未知错误',
                level: 'error',
            });
        }
    }, [appendLocalAgentMessage]);

    const handleCancelAgentManagement = useCallback(() => {
        appendLocalAgentMessage('已取消本次智能体管理操作，需要时我可以继续帮你整理新的创建或修改方案。');
    }, [appendLocalAgentMessage]);

    const handleConfirmCreateTask = async () => {
        const sourceMessageId = pendingCreateTaskMessage?.id;
        if (!sourceMessageId) return;
        try {
            await createAndStartTaskFromMessageId(sourceMessageId);
        } finally {
            setPendingCreateTaskMessageId(null);
        }
    };

    const handleCancelTaskCard = async (messageId: string) => {
        const target = messagesRef.current.find((message) => message.id === messageId);
        if (!target?.taskCard || taskActionBusy) return;
        const card = target.taskCard;
        if (card.stage === 'proposal') {
            updateTaskCardMessage(messageId, (prev) => ({
                ...prev,
                stage: 'cancelled',
                canCreate: false,
                canCancel: false,
                canDelete: false,
                updatedAt: new Date().toISOString(),
            }));
            pushInAppNotice({
                title: '已取消',
                message: '任务创建已取消。',
                level: 'info',
            });
            return;
        }
        const taskId = card.taskId;
        if (!taskId) return;
        setTaskActionBusy(true);
        try {
            const result = await pauseTask(taskId);
            if (!result.success) {
                pushInAppNotice({
                    title: '取消失败',
                    message: result.message || '无法停止任务',
                    level: 'error',
                });
                return;
            }
            const latest = await getTaskDetail(taskId);
            const canDeleteAfterCancel = latest
                ? latest.runInfo.runCount === 0 && !latest.runInfo.lastRun
                : card.runCount === 0 && !card.lastRun;
            updateTaskCardByTaskId(taskId, (prev) => ({
                ...prev,
                stage: 'cancelled',
                canCancel: false,
                canDelete: canDeleteAfterCancel,
                runCount: latest?.runInfo.runCount ?? prev.runCount,
                lastRun: latest?.runInfo.lastRun ?? prev.lastRun,
                lastStatus: latest?.runInfo.lastStatus ?? 'cancelled',
                updatedAt: new Date().toISOString(),
            }));
            pushInAppNotice({
                title: '任务已取消',
                message: card.taskName,
                level: 'info',
            });
        } finally {
            setTaskActionBusy(false);
        }
    };

    const handleDeleteTaskCard = async (messageId: string) => {
        const target = messagesRef.current.find((message) => message.id === messageId);
        if (!target?.taskCard?.taskId || taskActionBusy) return;
        const card = target.taskCard;
        const taskId = card.taskId;
        if (!taskId) return;
        setTaskActionBusy(true);
        try {
            const result = await deleteTask(taskId);
            if (!result.success) {
                pushInAppNotice({
                    title: '删除失败',
                    message: result.message || '任务已运行过或删除失败',
                    level: 'error',
                });
                return;
            }
            updateTaskCardByTaskId(taskId, (prev) => ({
                ...prev,
                stage: 'cancelled',
                canCancel: false,
                canDelete: false,
                updatedAt: new Date().toISOString(),
                lastStatus: 'cancelled',
            }));
            pushInAppNotice({
                title: '任务已删除',
                message: card.taskName,
                level: 'info',
            });
        } finally {
            setTaskActionBusy(false);
        }
    };

    const handleOpenTaskCardDetails = async (taskId: string) => {
        const detail = await getTaskDetail(taskId);
        if (!detail) {
            pushInAppNotice({
                title: '读取任务详情失败',
                message: `任务不存在：${taskId}`,
                level: 'error',
            });
            return;
        }
        const runs = await listTaskRuns(taskId);
        setTaskDetailsItem(detail);
        setTaskDetailRuns(runs);
        setTaskDetailFinalSummary(getTaskFinalSummary(taskId));
        setTaskDetailsOpen(true);
    };

    const handleOpenA2aCardDetails = (messageId: string, cardId: string) => {
        const message = messagesRef.current.find((item) => item.id === messageId);
        if (!message?.a2aCards || message.a2aCards.length === 0) {
            return;
        }
        const card = message.a2aCards.find((item) => item.id === cardId);
        if (!card) {
            return;
        }
        setA2aDetailsTarget({ messageId, cardId });
        setA2aDetailsCard(card);
        setA2aDetailsOpen(true);
    };

    useEffect(() => {
        if (!a2aDetailsOpen || !a2aDetailsTarget) {
            return;
        }
        const message = messages.find((item) => item.id === a2aDetailsTarget.messageId);
        if (!message?.a2aCards || message.a2aCards.length === 0) {
            return;
        }
        const latest = message.a2aCards.find((item) => item.id === a2aDetailsTarget.cardId);
        if (!latest) {
            return;
        }
        setA2aDetailsCard(latest);
    }, [a2aDetailsOpen, a2aDetailsTarget, messages]);

    useEffect(() => {
        const syncTaskCards = () => {
            const taskCards = messagesRef.current
                .filter((message) => Boolean(message.taskCard?.taskId))
                .map((message) => message.taskCard as ChatTaskCardData)
                .filter((card) => card.taskId)
                .filter((card) => card.stage !== 'cancelled' && card.stage !== 'failed' && card.stage !== 'completed');
            const uniqueTaskIds = [...new Set(taskCards.map((card) => card.taskId as string))];
            if (uniqueTaskIds.length === 0) return;

            void Promise.all(uniqueTaskIds.map(async (taskId) => {
                const [detail, runs] = await Promise.all([
                    getTaskDetail(taskId),
                    listTaskRuns(taskId),
                ]);
                if (!detail) return;
                const seedCard = messagesRef.current.find((item) => item.taskCard?.taskId === taskId)?.taskCard;
                if (!seedCard) return;

                const runCount = Math.max(detail.runInfo.runCount, runs.length);
                const stage = resolveCardStage(detail, seedCard, runCount);

                if (stage === 'completed' && detail.enabled) {
                    await pauseTask(taskId);
                }

                updateTaskCardByTaskId(taskId, (card) => {
                    const finalSummary = getTaskFinalSummary(taskId);
                    const errorCount = runs.filter((run) => run.status === 'error').length;
                    const next: ChatTaskCardData = {
                        ...card,
                        stage,
                        runCount,
                        logCount: runs.length,
                        errorCount,
                        finalSummaryReady: Boolean(finalSummary),
                        nextRun: detail.runInfo.nextRun,
                        lastRun: detail.runInfo.lastRun,
                        lastStatus: detail.runInfo.lastStatus,
                        canDelete: runCount === 0 && !detail.runInfo.lastRun,
                        canCancel: stage === 'scheduled' || stage === 'running',
                        updatedAt: new Date().toISOString(),
                    };
                    if (stage === 'completed' && !card.completedNotified && card.notifyOnComplete !== false) {
                        next.completedNotified = true;
                        const finalDelivered = hasTaskFinalSummaryDelivered(taskId, runCount);
                        pushInAppNotice({
                            title: '任务执行完成',
                            message: finalDelivered
                                ? `${card.taskName} 已完成并回传最终总结`
                                : `${card.taskName} 已达到完成条件，正在生成最终总结`,
                            level: 'success',
                        });
                    }
                    return next;
                });
            }));
        };

        syncTaskCards();
        const timer = window.setInterval(syncTaskCards, 5_000);
        return () => window.clearInterval(timer);
    }, []);

    const handleSendSilentMessage = (rawText: string) => {
        const text = rawText.trim();
        if (!text) return;
        enqueueSilentMessage(text);
        if (isSendingRef.current || silentDispatchingRef.current) {
            return;
        }
        const next = shiftSilentMessage();
        if (!next) return;
        setSilentDispatching(true);
        void sendMessageInternal(next, { appendUser: false });
    };

    useEffect(() => {
        if (isSending || silentDispatching) return;
        const next = shiftSilentMessage();
        if (!next) return;
        setSilentDispatching(true);
        void sendMessageInternal(next, { appendUser: false });
    }, [isSending, silentDispatching]);

    const handleRegenerateMessage = async (messageId: string) => {
        if (isSending) return;
        const currentMessages = messagesRef.current;
        const targetIndex = currentMessages.findIndex((msg) => msg.id === messageId && msg.role === 'agent');
        if (targetIndex <= 0) return;

        let previousUserIndex = -1;
        for (let index = targetIndex - 1; index >= 0; index -= 1) {
            if (currentMessages[index]?.role === 'user') {
                previousUserIndex = index;
                break;
            }
        }
        if (previousUserIndex < 0) return;

        const prompt = currentMessages[previousUserIndex]?.text?.trim() || '';
        if (!prompt) return;

        const nextMessages = currentMessages.slice(0, targetIndex);
        messagesRef.current = nextMessages;
        commitMessages(nextMessages);
        setStreamingMessage(null);
        setStreamState('idle');
        await sendMessageInternal(prompt, { appendUser: false });
    };

    const handleStopStreaming = async () => {
        autoDispatchAbortTokenRef.current += 1;
        pendingSilentMessagesRef.current = [];
        setPendingSilentCount(0);
        setMultiReplyDispatching(false);

        const requestId = activeRequestIdRef.current;
        const requestSessionId = activeRequestSessionIdRef.current || activeSessionIdRef.current;
        const pendingId = pendingMessageIdRef.current;
        finalizedRequestIdRef.current = requestId;
        if (requestId) {
            unbindRuntimeRequest(requestId);
            try {
                await cancelAgentChat({ requestId });
            } catch {
                // ignore cancel errors
            }
        }
        if (pendingId) {
            const currentDraft = streamingDraftRef.current;
            if (currentDraft) {
                const finalized: Message = {
                    ...currentDraft,
                    cardPending: false,
                    streaming: false,
                    thinking: false,
                    generationElapsedMs: Math.max(0, Date.now() - (currentDraft.generationStartedAt || Date.now())),
                    text: currentDraft.text || '已手动终止输出。',
                    tools: (currentDraft.tools ?? []).map((tool) => ({ ...tool, running: false })),
                };
                patchSessionMessageById(requestSessionId, pendingId, finalized);
            }
        }
        clearWaitingFinalizeTimer();
        activeRequestIdRef.current = null;
        activeRequestSessionIdRef.current = '';
        streamingDraftRef.current = null;
        pendingMessageIdRef.current = null;
        patchBufferRef.current.clear();
        rawAssistantStreamRef.current = '';
        thinkingSnapshotRef.current = '';
        doneReceivedRef.current = false;
        if (watchdogRef.current != null) {
            window.clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
        if (requestSessionId) {
            setSessionStreamState(requestSessionId, 'idle');
        }
        setStreamingMessage(null);
        setIsSending(false);
        setSilentDispatching(false);
        setStreamState('idle');
    };

    const formatSessionTime = (timestamp: number) => {
        const diffMs = Math.max(0, Date.now() - timestamp);
        const diffMinutes = Math.floor(diffMs / (60 * 1000));
        if (diffMinutes <= 0) {
            return t('chat.timeJustNow', { defaultValue: '刚刚' });
        }
        if (diffMinutes < 60) {
            return t('chat.timeMinutesAgo', { count: diffMinutes, defaultValue: `${diffMinutes} 分钟前` });
        }
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) {
            return t('chat.timeHoursAgo', { count: diffHours, defaultValue: `${diffHours} 小时前` });
        }
        const diffDays = Math.floor(diffHours / 24);
        return t('chat.timeDaysAgo', { count: diffDays, defaultValue: `${diffDays} 天前` });
    };

    const handleCreateSession = () => {
        if (sessionActionLocked) return;
        const nextSession = createEmptySession(sessions.length + 1);
        setSessions((prev) => [nextSession, ...prev]);
        setActiveSessionId(nextSession.id);
        setSessionKeyword('');
        setPendingDeleteSessionId(null);
        setStreamingMessage(null);
    };

    const handleSelectSession = (sessionId: string) => {
        if (sessionId === activeSessionId) return;
        setPendingDeleteSessionId(null);
        setActiveSessionId(sessionId);
        setStreamingMessage(null);

        const selected = sessions.find((session) => session.id === sessionId) ?? null;
        const remoteOwnerAgentId = getRemoteSessionOwnerAgentId(selected);
        const remoteSessionId = remoteOwnerAgentId && remoteOwnerAgentId !== chatAgentId
            ? ''
            : getRemoteSessionId(selected);
        if (!remoteSessionId || (selected?.messages.length ?? 0) > 0) {
            return;
        }
        const summary = remoteSessionSummaryMapRef.current.get(remoteSessionId);
        if (!summary) {
            return;
        }
        if (!remoteSessionQueueRef.current.some((item) => item.sessionId === summary.sessionId)) {
            remoteSessionQueueRef.current = [summary, ...remoteSessionQueueRef.current];
            syncRemoteQueueMeta(remoteSessionQueueRef.current.length);
        }
        const token = remoteSyncTokenRef.current;
        void loadRemoteSessionBatch(1, token, { silent: true });
    };

    const handleLoadMoreSessions = () => {
        if (sessionKeywordNormalized) {
            return;
        }
        if (remoteLoadingMore || !remoteMoreAvailable) {
            return;
        }
        const token = remoteSyncTokenRef.current;
        void loadRemoteSessionBatch(REMOTE_SESSION_LOAD_MORE_BATCH, token);
    };

    const handleRequestDeleteSession = (sessionId: string) => {
        if (sessionActionLocked) return;
        setPendingDeleteSessionId(sessionId);
    };

    const handleConfirmDeleteSession = () => {
        if (!pendingDeleteSessionId || sessionActionLocked) {
            return;
        }
        const deletingSessionId = pendingDeleteSessionId;
        const deletingActive = deletingSessionId === activeSessionId;
        const remaining = sessions.filter((session) => session.id !== deletingSessionId);
        if (!remaining.length) {
            const fallbackSession = createEmptySession(1);
            setSessions([fallbackSession]);
            setActiveSessionId(fallbackSession.id);
        } else {
            setSessions(remaining);
            if (deletingActive) {
                setActiveSessionId(remaining[0].id);
            }
        }
        setStreamingMessage(null);
        setPendingDeleteSessionId(null);
    };

    const uiVariant = uiVariantProp ?? 'full';
    const isEmbedded = uiVariant === 'embedded';

    useEffect(() => {
        if (!isEmbedded) {
            return;
        }
        setSidebarCollapsed(true);
        setInfoSidebarCollapsed(true);
    }, [isEmbedded]);

    const chatNode = (
        <ChatRenderer
            agent={agent}
            sessionTitle={fixedSessionTitleProp ?? activeSession?.title}
            messages={messages}
            isSending={displayIsSending}
            inputLocked={inputLocked}
            streamState={streamState}
            streamingMessage={streamingMessage}
            hideHeader={isEmbedded}
            inputToolbar={inputToolbarProp}
            onUserActivity={markUserActivity}
            onSendMessage={handleSendMessage}
            onSendSilentMessage={handleSendSilentMessage}
            onRegenerateMessage={handleRegenerateMessage}
            onStopStreaming={handleStopStreaming}
            onCreateTaskCard={handleCreateTaskCard}
            onConfirmCreateTaskCard={handleConfirmCreateTaskCard}
            onCancelTaskCard={handleCancelTaskCard}
            onDeleteTaskCard={handleDeleteTaskCard}
            onOpenTaskCardDetails={handleOpenTaskCardDetails}
            onOpenA2aCardDetails={handleOpenA2aCardDetails}
            onConfirmGroupUpgrade={handleConfirmGroupUpgrade}
            onCancelGroupUpgrade={handleCancelGroupUpgrade}
            onConfirmAgentManagement={handleConfirmAgentManagement}
            onCancelAgentManagement={handleCancelAgentManagement}
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            infoSidebarCollapsed={infoSidebarCollapsed}
            setInfoSidebarCollapsed={setInfoSidebarCollapsed}
        />
    );

    const dialogsNode = (
        <>
            <Dialog open={Boolean(pendingDeleteSession)} onOpenChange={(open) => !open && setPendingDeleteSessionId(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('chat.deleteSessionTitle', { defaultValue: '删除会话' })}</DialogTitle>
                        <DialogDescription>
                            {t('chat.deleteSessionConfirm', {
                                title: pendingDeleteSession?.title ?? '',
                                defaultValue: `确定要删除会话「${pendingDeleteSession?.title ?? ''}」吗？删除后不可恢复。`,
                            })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setPendingDeleteSessionId(null)}>
                            {t('common.cancel')}
                        </Button>
                        <Button type="button" variant="destructive" onClick={handleConfirmDeleteSession}>
                            {t('common.delete')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={Boolean(pendingCreateTaskMessage)} onOpenChange={(open) => {
                if (!open && !taskActionBusy) {
                    if (pendingCreateTaskMessageId) {
                        updateTaskCardMessage(pendingCreateTaskMessageId, (card) => ({
                            ...card,
                            stage: 'cancelled',
                            canCreate: false,
                            canCancel: false,
                            updatedAt: new Date().toISOString(),
                        }));
                    }
                    setPendingCreateTaskMessageId(null);
                }
            }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>确认创建定时任务</DialogTitle>
                        <DialogDescription>
                            {pendingCreateTaskMessage?.taskCard
                                ? `任务：${pendingCreateTaskMessage.taskCard.taskName}；调度：${pendingCreateTaskMessage.taskCard.scheduleText}。`
                                : '确认后将创建定时任务。'}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={taskActionBusy}
                            onClick={() => {
                                if (pendingCreateTaskMessageId) {
                                    updateTaskCardMessage(pendingCreateTaskMessageId, (card) => ({
                                        ...card,
                                        stage: 'cancelled',
                                        canCreate: false,
                                        canCancel: false,
                                        updatedAt: new Date().toISOString(),
                                    }));
                                }
                                setPendingCreateTaskMessageId(null);
                            }}
                        >
                            取消
                        </Button>
                        <Button type="button" disabled={taskActionBusy} onClick={handleConfirmCreateTask}>
                            {taskActionBusy ? '创建中...' : '创建任务'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <TaskDetailsDialog
                open={taskDetailsOpen}
                onOpenChange={setTaskDetailsOpen}
                task={taskDetailsItem ? {
                    ...taskDetailsItem,
                    agentId: agent.id,
                    agentName: agent.name,
                    agentAvatarUrl: agent.avatarUrl,
                    agentColor: agent.color,
                } : null}
                runs={taskDetailRuns}
                finalSummary={taskDetailFinalSummary}
            />
            <A2AWorkDetailsDialog
                open={a2aDetailsOpen}
                onOpenChange={(open) => {
                    setA2aDetailsOpen(open);
                    if (!open) {
                        setA2aDetailsTarget(null);
                    }
                }}
                card={a2aDetailsCard}
            />
        </>
    );

    if (isEmbedded) {
        return (
            <div className="h-full w-full flex flex-col">
                {chatNode}
                {dialogsNode}
            </div>
        );
    }

    return (
        <div className={cn("chat-container", isResizing && "chat-resize-active")}>
            {/* 1. 左栏：历史会话 */}
            <div className={cn("chat-sidebar", sidebarCollapsed && "chat-sidebar-collapsed")}>
                <div className="p-4 pt-3 space-y-3">
                    <Button
                        type="button"
                        onClick={handleCreateSession}
                        disabled={sessionActionLocked}
                        className="w-full justify-start gap-2 rounded-lg h-10 border border-border/80 bg-background text-foreground shadow-sm hover:bg-muted/70 hover:border-border transition-all active:scale-[0.98] dark:bg-zinc-900/70 dark:border-zinc-700/80 dark:text-zinc-100 dark:hover:bg-zinc-800/80"
                    >
                        <Plus className="w-4 h-4 text-muted-foreground dark:text-zinc-400" />
                        <span className="text-sm font-bold">{t('chat.newSession')}</span>
                    </Button>
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder={t('chat.searchSessions')}
                            value={sessionKeyword}
                            onChange={(event) => setSessionKeyword(event.target.value)}
                            className="h-8 pl-9 bg-background/50 border-none ring-1 ring-border shadow-none rounded-lg text-xs"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-2 space-y-1">
                    {visibleSessions.map((session) => {
                        const isActiveSession = session.id === activeSessionId;
                        return (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => handleSelectSession(session.id)}
                                className={cn(
                                    'chat-sidebar-item group/session w-full text-left flex flex-col gap-0.5',
                                    isActiveSession
                                        ? 'bg-muted text-foreground shadow-sm dark:bg-zinc-800/70 dark:text-zinc-100'
                                        : 'hover:bg-muted/60 dark:hover:bg-zinc-900/70',
                                )}
                            >
                                <div className="flex justify-between items-start">
                                    <span className={cn('text-sm truncate font-bold pr-2 inline-flex items-center gap-1.5', isActiveSession ? 'text-foreground dark:text-zinc-100' : 'text-foreground')}>
                                        <span className="truncate">{session.title}</span>
                                        {(session.streamState ?? 'idle') !== 'idle' && (
                                            <span
                                                className={cn(
                                                    'inline-block h-2 w-2 rounded-full animate-pulse shrink-0',
                                                    (session.streamState ?? 'idle') === 'streaming'
                                                        ? 'bg-emerald-500'
                                                        : 'bg-amber-500',
                                                )}
                                                title={(session.streamState ?? 'idle') === 'streaming' ? '输出中' : '等待收尾'}
                                            />
                                        )}
                                    </span>
                                    <span
                                        role="button"
                                        tabIndex={sessionActionLocked ? -1 : 0}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            if (sessionActionLocked) return;
                                            handleRequestDeleteSession(session.id);
                                        }}
                                        onKeyDown={(event) => {
                                            if (sessionActionLocked) return;
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                handleRequestDeleteSession(session.id);
                                            }
                                        }}
                                        className={cn(
                                            'inline-flex items-center justify-center h-5 w-5 rounded-sm shrink-0 transition-opacity',
                                            isActiveSession
                                                ? 'text-muted-foreground hover:text-foreground hover:bg-background/70 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-700/60'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-accent/30 dark:hover:bg-zinc-800/60',
                                            'opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100',
                                        )}
                                        aria-label={t('common.delete')}
                                    >
                                        <X className="w-3 h-3" />
                                    </span>
                                </div>
                                <span className={cn('text-[10px] block opacity-70', isActiveSession ? 'text-muted-foreground dark:text-zinc-400' : 'text-muted-foreground')}>
                                    {formatSessionTime(session.updatedAt)}
                                </span>
                            </button>
                        );
                    })}
                    {!sessionKeywordNormalized && remoteMoreAvailable && (
                        <div className="px-1 py-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full h-8 text-xs"
                                onClick={handleLoadMoreSessions}
                                disabled={remoteLoadingMore}
                            >
                                {remoteLoadingMore
                                    ? t('chat.loadingMoreSessions', { defaultValue: '加载中...' })
                                    : t('chat.loadMoreSessions', { defaultValue: `更多会话（剩余 ${remotePendingCount}）` })}
                            </Button>
                        </div>
                    )}
                    {visibleSessions.length === 0 && (
                        <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                            {t('chat.emptySearchSessions', { defaultValue: '没有匹配的会话' })}
                        </div>
                    )}
                </div>
            </div>

            {/* 2. 中栏：聊天主渲染页面 */}
            {chatNode}

            {/* 3. 右栏：智能体信息 */}
            <div
                className={cn("chat-info-sidebar", infoSidebarCollapsed && "chat-info-sidebar-collapsed")}
                style={{ '--chat-info-width': `${infoSidebarWidth}px` } as CSSProperties}
            >
                <div
                    className="chat-resize-handle"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setIsResizing(true);
                    }}
                >
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <GripVertical className="w-4 h-4 text-muted-foreground/40" />
                    </div>
                </div>
                <div className="chat-info-panel">
                    {agent.portraitUrl ? (
                        <div className="chat-info-portrait-card">
                            <img
                                src={agent.portraitUrl}
                                alt={`${agent.name} portrait`}
                                className="chat-info-portrait-img"
                            />
                        </div>
                    ) : (
                        <div className="chat-info-portrait-placeholder">
                            <AgentAvatar
                                name={agent.name}
                                avatarUrl={agent.avatarUrl}
                                color={agent.color}
                                size="xl"
                                className="chat-info-portrait-fallback-avatar"
                            />
                        </div>
                    )}

                    <div className="chat-info-body">
                        <div className="chat-info-avatar-wrap">
                            <AgentAvatar
                                name={agent.name}
                                avatarUrl={agent.avatarUrl}
                                color={agent.color}
                                size="lg"
                                className="chat-info-avatar"
                            />
                        </div>

                        <div className="chat-info-name-block">
                            <h2 className="chat-info-name">{agent.name}</h2>
                            {agent.title && agent.title !== agent.name && (
                                <p className="chat-info-subtitle">{agent.title}</p>
                            )}
                        </div>

                        <div className="chat-info-tag-list">
                            {agent.expertise.map((tag: string) => (
                                <Badge
                                    key={tag}
                                    variant="secondary"
                                    className="chat-info-tag"
                                >
                                    {tag}
                                </Badge>
                            ))}
                        </div>

                        <div className="pt-2">
                            <Button variant="outline" size="sm" className="w-full rounded-lg h-9 font-semibold text-xs border-border/60 hover:bg-accent/5 hover:border-accent/40 hover:text-accent transition-all duration-300" asChild>
                                <Link to={`/edit/${agent.id}`}>{t('chat.agentSettings')}</Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {dialogsNode}
        </div>
    );
}
