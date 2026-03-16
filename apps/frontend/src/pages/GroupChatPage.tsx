import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { ChatPage } from '@/pages/ChatPage';
import { deleteChatGroup, getChatGroup, updateChatGroup } from '@/services/group-client';
import { listManagementAgents } from '@/services/management-client';
import { chatRuntimeStore, useChatRuntimeSelector } from '@/services/chat-runtime-store';
import type { StoredChatSession } from '@/services/chat-session-store';
import { buildInitialMessages, generateId, mapManagementAgentToUi } from '@/components/chat/chat-page-helpers';
import type { Message } from '@/data/mock-chats';
import { cn } from '@/lib/utils';
import { DEFAULT_GROUP_LIMITS, type ChatGroup, type ChatGroupLimits, type ChatGroupMode, type GroupMemoryDigest, type GroupSessionRuntime } from '@/types/group';
import type { Agent } from '@/types';
import { ChevronLeft, ChevronRight, MessageCircle, Plus, Search, Settings, ListChecks, Users, X } from 'lucide-react';

const MEMBER_DIRECTORY_CACHE_TTL_MS = 60_000;
let memberDirectoryCache: Map<string, Agent> | null = null;
let memberDirectoryCacheAt = 0;
let memberDirectoryPendingPromise: Promise<Map<string, Agent>> | null = null;

function normalizeLabelComponent(raw: string, maxLen: number): string {
    const trimmed = raw.trim();
    if (!trimmed) return 'na';
    let out = '';
    for (const ch of trimmed) {
        if (out.length >= maxLen) break;
        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '-' || ch === '_') {
            out += ch;
        } else {
            out += '_';
        }
    }
    const normalized = out.replace(/^_+|_+$/g, '');
    return normalized || 'na';
}

function buildGroupSessionLabel(groupId: string): string {
    const conversation = normalizeLabelComponent(groupId, 56);
    return `groupmem_web_${conversation}`;
}

function buildScopedGroupSessionLabel(groupId: string, sessionId: string): string {
    const conversation = normalizeLabelComponent(groupId, 40);
    const session = normalizeLabelComponent(sessionId, 40);
    return `groupmem_web_${conversation}_${session || 'default'}`;
}

function normalizeGroupSessionIdentity(
    session: StoredChatSession,
    groupId: string,
    leaderAgentId: string,
    fallbackIndex: number,
): StoredChatSession {
    const safeId = session.id?.trim() || `group_session_${fallbackIndex + 1}`;
    const legacyLabel = buildGroupSessionLabel(groupId);
    const currentLabel = (session.sessionLabel || '').trim();
    const normalizedLabel = !currentLabel || currentLabel === legacyLabel
        ? buildScopedGroupSessionLabel(groupId, safeId)
        : currentLabel;

    return ensureGroupSessionRuntime({
        ...session,
        id: safeId,
        sessionLabel: normalizedLabel,
        sessionSource: session.sessionSource ?? 'app',
        remoteSessionOwnerAgentId: session.remoteSessionOwnerAgentId || leaderAgentId,
    }, leaderAgentId);
}

function normalizeGroupSessions(
    sessions: StoredChatSession[],
    groupId: string,
    leaderAgentId: string,
): StoredChatSession[] {
    const seenIds = new Set<string>();
    return sessions.map((session, index) => {
        let next = normalizeGroupSessionIdentity(session, groupId, leaderAgentId, index);
        if (seenIds.has(next.id)) {
            const dedupedId = `${next.id}_${index + 1}`;
            next = {
                ...next,
                id: dedupedId,
                sessionLabel: buildScopedGroupSessionLabel(groupId, dedupedId),
            };
        }
        seenIds.add(next.id);
        return next;
    });
}

function buildFallbackMember(agentId: string): Agent {
    const id = agentId.trim() || 'unknown';
    return {
        id,
        name: id,
        title: id,
        description: 'No description',
        expertise: ['general'],
        status: 'offline',
        personality: 'default',
        mcpTools: [],
        model: 'unknown',
        createdAt: new Date().toISOString(),
        messagesCount: 0,
        color: '#64748b',
    };
}

function normalizePromptLine(raw: string, maxLen: number): string {
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLen) return cleaned;
    return `${cleaned.slice(0, maxLen)}…`;
}

function buildGroupSharedContext(messages: Message[], limit: number): string {
    const rows = messages
        .filter((m) => m.role === 'user' || m.role === 'agent')
        .slice(-limit)
        .map((m) => {
            const speaker = m.role === 'user'
                ? '用户'
                : (m.agentName?.trim() ? `@${m.agentName.trim()}` : '@成员');
            const content = normalizePromptLine(m.text, 220);
            return `${speaker}: ${content}`;
        });

    const joined = rows.filter(Boolean).join('\n');
    if (!joined.trim()) return '';

    return [
        '[system:group-shared-context]',
        '以下为该群最近对话片段（用于同步群上下文；请以“群内公开、全员可见”的方式回复）：',
        joined,
    ].join('\n');
}

function compactDigestLine(raw: string, maxLen: number): string {
    const normalized = raw.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}...` : normalized;
}

function createInitialGroupRuntime(leaderAgentId: string): GroupSessionRuntime {
    return {
        version: '1.0',
        status: 'idle',
        leaderAgentId: leaderAgentId.trim() || undefined,
        currentSpeakerId: undefined,
        lastCompletedSpeakerId: undefined,
        queueVersion: 0,
        queue: [],
        stopRequested: false,
    };
}

function normalizeGroupRuntimeValue(runtime: GroupSessionRuntime | undefined, leaderAgentId: string): GroupSessionRuntime {
    const base = createInitialGroupRuntime(leaderAgentId);
    return {
        ...base,
        ...(runtime ?? {}),
        leaderAgentId: (runtime?.leaderAgentId || leaderAgentId || '').trim() || undefined,
        queue: Array.isArray(runtime?.queue) ? runtime!.queue.slice(-18) : [],
        stopRequested: runtime?.stopRequested === true,
    };
}

function buildGroupMemoryDigest(messages: Message[], runtime: GroupSessionRuntime): GroupMemoryDigest | undefined {
    const recentRows = messages
        .filter((item) => item.role === 'user' || item.role === 'agent')
        .filter((item) => Boolean((item.text || '').trim()))
        .slice(-8);
    if (recentRows.length === 0) {
        return undefined;
    }
    const lastUser = [...recentRows].reverse().find((item) => item.role === 'user');
    const recentAgents = recentRows
        .filter((item) => item.role === 'agent')
        .slice(-3)
        .map((item) => `${item.agentName || item.agentId || '成员'}: ${compactDigestLine(item.text || '', 72)}`)
        .filter(Boolean);
    const activeQueue = runtime.queue
        .filter((item) => item.status === 'queued' || item.status === 'running')
        .slice(0, 4);
    const pendingLine = activeQueue.length > 0
        ? activeQueue.map((item) => `${item.status === 'running' ? '进行中' : '待发言'} ${item.agentName || item.agentId}`).join('；')
        : '';
    const speakerLine = recentAgents.length > 0 ? recentAgents.join(' | ') : '';
    const summaryParts = [
        lastUser ? `用户诉求：${compactDigestLine(lastUser.text || '', 96)}` : '',
        speakerLine ? `近期结论：${compactDigestLine(speakerLine, 180)}` : '',
        pendingLine ? `当前队列：${pendingLine}` : '',
    ].filter(Boolean);
    if (summaryParts.length === 0) {
        return undefined;
    }
    return {
        summary: summaryParts.join('\n'),
        speakerLine: speakerLine || undefined,
        pendingLine: pendingLine || undefined,
        lastUserIntent: lastUser ? compactDigestLine(lastUser.text || '', 96) : undefined,
        updatedAt: new Date().toISOString(),
    };
}

function ensureGroupSessionRuntime(session: StoredChatSession, leaderAgentId: string): StoredChatSession {
    return {
        ...session,
        groupRuntime: normalizeGroupRuntimeValue(session.groupRuntime, leaderAgentId),
    };
}

function extractMentions(text: string): string[] {
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
    }
    return out;
}

function buildMentionDirectory(agents: Agent[]): Map<string, Agent> {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
        if (!agent?.id) continue;
        const id = agent.id.trim();
        if (!id) continue;
        map.set(id.toLowerCase(), agent);
        const name = (agent.name || '').trim();
        if (name && !map.has(name.toLowerCase())) {
            map.set(name.toLowerCase(), agent);
        }
        const title = (agent.title || '').trim();
        if (title && !map.has(title.toLowerCase())) {
            map.set(title.toLowerCase(), agent);
        }
    }
    return map;
}

function scoreAgentForMessage(message: string, agent: Agent): number {
    const normalized = message.toLowerCase();
    let score = 0;
    const name = (agent.name || '').trim().toLowerCase();
    if (name && normalized.includes(name)) score += 3;
    const title = (agent.title || '').trim().toLowerCase();
    if (title && normalized.includes(title)) score += 2;
    const expertise = agent.expertise ?? [];
    for (const tag of expertise) {
        const token = tag.trim().toLowerCase();
        if (token && normalized.includes(token)) {
            score += 2;
        }
    }
    return score;
}

function scoreDirectNameAgentMatch(message: string, agent: Agent): number {
    const normalized = message.toLowerCase();
    const aliases = [
        { value: (agent.name || '').trim(), weight: 120 },
        { value: (agent.title || '').trim(), weight: 100 },
        { value: (agent.id || '').trim(), weight: 80 },
    ];
    let score = 0;
    for (const alias of aliases) {
        const token = alias.value.toLowerCase();
        if (!token || token.length < 2) continue;
        if (normalized.includes(token)) {
            score = Math.max(score, alias.weight + Math.min(token.length, 24));
        }
    }
    return score;
}

function hashMessageSeed(message: string): number {
    const text = message.trim();
    if (!text) return 0;
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function pickFallbackAgents(message: string, agents: Agent[], maxCount: number): Agent[] {
    if (maxCount <= 0) return [];
    if (agents.length <= maxCount) return agents;
    const seed = hashMessageSeed(message);
    const start = seed % agents.length;
    const picked: Agent[] = [];
    for (let i = 0; i < agents.length && picked.length < maxCount; i += 1) {
        const index = (start + i) % agents.length;
        picked.push(agents[index]);
    }
    return picked;
}

async function loadMemberDirectoryCached(force = false): Promise<Map<string, Agent>> {
    const now = Date.now();
    if (!force && memberDirectoryCache && (now - memberDirectoryCacheAt) < MEMBER_DIRECTORY_CACHE_TTL_MS) {
        return memberDirectoryCache;
    }
    if (!force && memberDirectoryPendingPromise) {
        return memberDirectoryPendingPromise;
    }

    memberDirectoryPendingPromise = (async () => {
        const rows = await listManagementAgents();
        const mapped = rows.map(mapManagementAgentToUi);
        const next = new Map<string, Agent>();
        for (const agent of mapped) {
            next.set(agent.id, agent);
        }
        memberDirectoryCache = next;
        memberDirectoryCacheAt = Date.now();
        return next;
    })();

    try {
        return await memberDirectoryPendingPromise;
    } finally {
        memberDirectoryPendingPromise = null;
    }
}

export function GroupChatPage() {
    const { id } = useParams();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const groupId = (id || '').trim();

    const [group, setGroup] = useState<ChatGroup | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [memberDirectory, setMemberDirectory] = useState<Map<string, Agent>>(() => new Map());
    const [directoryLoading, setDirectoryLoading] = useState(false);

    const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>('');
    const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
    const [autoConversationEnabled, setAutoConversationEnabled] = useState(false);
    const [targetSelectError, setTargetSelectError] = useState('');
    const [sessionKeyword, setSessionKeyword] = useState('');
    const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
    const [canScrollTargetsLeft, setCanScrollTargetsLeft] = useState(false);
    const [canScrollTargetsRight, setCanScrollTargetsRight] = useState(false);

    const runtimeKey = useMemo(() => (group ? `group:${group.groupId}` : ''), [group]);

    const sessions = useChatRuntimeSelector(runtimeKey, (state) => state.sessions);
    const activeSessionId = useChatRuntimeSelector(runtimeKey, (state) => state.activeSessionId);
    const pendingDeleteSession = pendingDeleteSessionId
        ? sessions.find((session) => session.id === pendingDeleteSessionId) ?? null
        : null;

    const sessionKeywordNormalized = useMemo(() => sessionKeyword.trim().toLowerCase(), [sessionKeyword]);
    const visibleSessions = useMemo(() => (
        sessionKeywordNormalized
            ? sessions.filter((session) => session.title.toLowerCase().includes(sessionKeywordNormalized))
            : sessions
    ), [sessions, sessionKeywordNormalized]);

    const activeSession = useMemo(() => {
        if (!activeSessionId) return null;
        return sessions.find((session) => session.id === activeSessionId) ?? null;
    }, [activeSessionId, sessions]);
    const activeGroupRuntime = useMemo(
        () => normalizeGroupRuntimeValue(activeSession?.groupRuntime, group?.leaderAgentId || ''),
        [activeSession?.groupRuntime, group?.leaderAgentId],
    );

    const groupMembers = useMemo(() => {
        if (!group) return [] as Agent[];
        return group.memberAgentIds.map((agentId) => memberDirectory.get(agentId) ?? buildFallbackMember(agentId));
    }, [group, memberDirectory]);

    const onlineMemberCount = useMemo(() => groupMembers.filter((m) => m.status === 'online' || m.status === 'busy').length, [groupMembers]);
    const mentionDirectory = useMemo(() => buildMentionDirectory(groupMembers), [groupMembers]);
    const runningQueueItems = useMemo(
        () => activeGroupRuntime.queue.filter((item) => item.status === 'running' || item.status === 'queued'),
        [activeGroupRuntime.queue],
    );
    const activeAsyncTaskCount = useMemo(() => {
        if (!activeSession) return 0;
        const taskCount = activeSession.messages.filter((msg) => {
            const stage = msg.taskCard?.stage;
            return stage === 'running' || stage === 'scheduled';
        }).length;
        const a2aCount = activeSession.messages.reduce((sum, msg) => (
            sum + ((msg.a2aCards ?? []).filter((card) => card.status === 'working').length)
        ), 0);
        return taskCount + a2aCount;
    }, [activeSession]);

    const speaker = useMemo(() => {
        if (!group) return null;
        const preferred = selectedSpeakerId || group.leaderAgentId;
        return memberDirectory.get(preferred) ?? buildFallbackMember(preferred);
    }, [group, memberDirectory, selectedSpeakerId]);

    const idleAutoLeader = useMemo(() => {
        if (!group) return undefined;
        return memberDirectory.get(group.leaderAgentId) ?? buildFallbackMember(group.leaderAgentId);
    }, [group, memberDirectory]);

    useEffect(() => {
        setAutoConversationEnabled(false);
    }, [groupId]);

    const idleAutoConfig = useMemo(() => {
        if (!group) {
            return { enabled: false } as const;
        }
        return {
            enabled: true,
            scope: 'group' as const,
            scopeId: group.groupId,
            idleMs: 120_000,
            maxPerPage: 1,
            maxPerDay: 1,
            cooldownMs: 86_400_000,
            agentOverride: idleAutoLeader,
        };
    }, [group, idleAutoLeader]);

    const speakerId = speaker?.id ?? '';
    const speakerRef = useRef(speakerId);
    speakerRef.current = speakerId;
    const lastSpeakerIdRef = useRef<string>('');
    const targetScrollRef = useRef<HTMLDivElement | null>(null);
    const groupMode = group?.groupMode ?? 'leader_dispatch';
    const groupLimits = useMemo(
        () => ({ ...DEFAULT_GROUP_LIMITS, ...(group?.limits ?? {}) }),
        [group],
    );
    const responderQueueLimit = Math.min(3, Math.max(1, groupLimits.maxSpeakers));
    const maxTalkTargets = Math.max(groupMembers.length, Math.max(1, groupLimits.maxMentions));
    const activeSessionLabel = useMemo(() => {
        if (!group || !activeSession) return '';
        return normalizeGroupSessionIdentity(activeSession, group.groupId, group.leaderAgentId, 0).sessionLabel || '';
    }, [activeSession, group]);

    const syncTargetScrollControls = () => {
        const node = targetScrollRef.current;
        if (!node) {
            setCanScrollTargetsLeft(false);
            setCanScrollTargetsRight(false);
            return;
        }
        const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
        setCanScrollTargetsLeft(node.scrollLeft > 8);
        setCanScrollTargetsRight(node.scrollLeft < maxScrollLeft - 8);
    };

    const scrollTargetsBy = (offset: number) => {
        const node = targetScrollRef.current;
        if (!node) return;
        node.scrollBy({
            left: offset,
            behavior: 'smooth',
        });
        window.requestAnimationFrame(syncTargetScrollControls);
    };

    useEffect(() => {
        syncTargetScrollControls();
    }, [groupMembers, selectedTargetIds.length, group]);

    useEffect(() => {
        const node = targetScrollRef.current;
        if (!node) return;
        const handleScroll = () => syncTargetScrollControls();
        node.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleScroll);
        handleScroll();
        return () => {
            node.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleScroll);
        };
    }, [groupMembers.length, group]);

    useEffect(() => {
        if (!runtimeKey || !speakerId) {
            return;
        }
        const prevSpeakerId = lastSpeakerIdRef.current.trim();
        if (prevSpeakerId && prevSpeakerId !== speakerId) {
            const prevAgent = memberDirectory.get(prevSpeakerId) ?? buildFallbackMember(prevSpeakerId);
            chatRuntimeStore.updateSessions(runtimeKey, (prev) => prev.map((session) => ({
                ...session,
                messages: session.messages.map((msg) => {
                    if (msg.role !== 'agent') return msg;
                    if (msg.agentId || msg.agentName) return msg;
                    return {
                        ...msg,
                        agentId: prevSpeakerId,
                        agentName: prevAgent.name,
                        agentAvatarUrl: prevAgent.avatarUrl,
                        agentColor: prevAgent.color,
                        agentPortraitUrl: prevAgent.portraitUrl,
                    };
                }),
            })));
        }
        lastSpeakerIdRef.current = speakerId;
    }, [memberDirectory, runtimeKey, speakerId]);

    useEffect(() => {
        if (!runtimeKey || memberDirectory.size === 0) {
            return;
        }
        chatRuntimeStore.updateSessions(runtimeKey, (prev) => {
            let changed = false;
            const nextSessions = prev.map((session) => {
                let sessionChanged = false;
                const nextMessages = session.messages.map((msg) => {
                    if (msg.role !== 'agent') return msg;
                    const agentId = (msg.agentId || '').trim();
                    const agentName = (msg.agentName || '').trim();
                    const matched = (
                        (agentId ? memberDirectory.get(agentId) : undefined)
                        || (agentName ? mentionDirectory.get(agentName.toLowerCase()) : undefined)
                    );
                    if (!matched) return msg;

                    const nextAgentId = agentId || matched.id;
                    const nextAgentName = agentName || matched.name;
                    const nextAvatarUrl = msg.agentAvatarUrl || matched.avatarUrl;
                    const nextColor = msg.agentColor || matched.color;
                    const nextPortraitUrl = msg.agentPortraitUrl || matched.portraitUrl;
                    if (
                        nextAgentId === msg.agentId
                        && nextAgentName === msg.agentName
                        && nextAvatarUrl === msg.agentAvatarUrl
                        && nextColor === msg.agentColor
                        && nextPortraitUrl === msg.agentPortraitUrl
                    ) {
                        return msg;
                    }

                    changed = true;
                    sessionChanged = true;
                    return {
                        ...msg,
                        agentId: nextAgentId,
                        agentName: nextAgentName,
                        agentAvatarUrl: nextAvatarUrl,
                        agentColor: nextColor,
                        agentPortraitUrl: nextPortraitUrl,
                    };
                });

                if (!sessionChanged) return session;
                return {
                    ...session,
                    messages: nextMessages,
                };
            });
            return changed ? nextSessions : prev;
        });
    }, [memberDirectory, mentionDirectory, runtimeKey]);

    const [settingsName, setSettingsName] = useState('');
    const [settingsDescription, setSettingsDescription] = useState('');
    const [settingsTagsText, setSettingsTagsText] = useState('');
    const [settingsMemberIds, setSettingsMemberIds] = useState<string[]>([]);
    const [settingsMemberSearch, setSettingsMemberSearch] = useState('');
    const [settingsAdminIds, setSettingsAdminIds] = useState<string[]>([]);
    const [settingsMode, setSettingsMode] = useState<ChatGroupMode>('leader_dispatch');
    const [settingsLimits, setSettingsLimits] = useState<ChatGroupLimits>(DEFAULT_GROUP_LIMITS);
    const [settingsApplyAcl, setSettingsApplyAcl] = useState(true);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsSaveError, setSettingsSaveError] = useState('');
    const [settingsSaveOkAt, setSettingsSaveOkAt] = useState<number | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [pendingDeleteGroup, setPendingDeleteGroup] = useState(false);
    const [deleteGroupError, setDeleteGroupError] = useState('');
    const [deleteGroupBusy, setDeleteGroupBusy] = useState(false);

    const initialState = useMemo(() => {
        if (!group) {
            return { sessions: [] as StoredChatSession[], activeSessionId: '' };
        }

        const nowIso = new Date().toISOString();
        const introText = t('groupChat.defaultGreeting', {
            name: group.name,
            defaultValue: `欢迎来到「${group.name}」群组。\n- 这是群聊公开消息，所有成员都会看到并跟进。\n- 使用输入框上方的 @ 选择对话对象（相当于在群里@TA）。\n- 群内成员可互相委派 A2A（仅限群内白名单）。`,
        });
        const introMessage: Message = {
            id: `sys_${generateId()}`,
            role: 'system',
            text: introText,
            timestamp: nowIso,
        };

        const nowMs = Date.now();
        const sessionId = generateId();
        const session: StoredChatSession = {
            id: sessionId,
            title: t('groupChat.defaultSessionTitle', { defaultValue: '群聊' }),
            updatedAt: nowMs,
            messages: [introMessage, ...buildInitialMessages(speakerRef.current || '')],
            sessionLabel: buildScopedGroupSessionLabel(group.groupId, sessionId),
            sessionSource: 'app',
            remoteSessionOwnerAgentId: group.leaderAgentId,
            groupRuntime: createInitialGroupRuntime(group.leaderAgentId),
            streamState: 'idle',
        };
        return { sessions: [session], activeSessionId: session.id };
    }, [group, t]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (!groupId) {
                setGroup(null);
                setLoading(false);
                setError(t('groupChat.missingId', { defaultValue: '缺少群ID' }));
                return;
            }
            setLoading(true);
            setError('');
            try {
                const detail = await getChatGroup(groupId);
                if (cancelled) return;
                setGroup(detail);
                setSelectedSpeakerId(detail.leaderAgentId);
                setSelectedTargetIds([]);
                setSettingsName(detail.name);
                setSettingsDescription(detail.description || '');
                setSettingsTagsText(detail.tags.join(', '));
                setSettingsMemberIds(detail.memberAgentIds);
                setSettingsAdminIds((detail.adminAgentIds?.length ? detail.adminAgentIds : [detail.leaderAgentId]).filter(Boolean));
                setSettingsMode(detail.groupMode ?? 'leader_dispatch');
                setSettingsLimits(detail.limits ?? DEFAULT_GROUP_LIMITS);
                setSettingsSaveError('');
                setSettingsSaveOkAt(null);
                setSettingsOpen(false);
            } catch (err) {
                if (cancelled) return;
                setGroup(null);
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [groupId, t]);

    useEffect(() => {
        if (!group || !runtimeKey) {
            return;
        }

        chatRuntimeStore.ensureAgentState(runtimeKey, () => {
            const loaded = chatRuntimeStore.loadAgentFromStorage(runtimeKey);
            if (loaded?.sessions?.length) {
                const normalizedLoaded = normalizeGroupSessions(loaded.sessions, group.groupId, group.leaderAgentId);
                const isLegacySeed = (session: StoredChatSession): boolean => {
                    if (session.messages.length !== 1) return false;
                    const only = session.messages[0];
                    if (only.role !== 'system') return false;
                    const text = only.text || '';
                    return text.includes('欢迎来到') && (text.includes('群组') || text.includes('群聊'));
                };

                const shouldDropLegacySeeds = normalizedLoaded.length === 2 && normalizedLoaded.every(isLegacySeed);
                if (!shouldDropLegacySeeds) {
                    return {
                        sessions: normalizedLoaded,
                        activeSessionId: normalizedLoaded.some((session) => session.id === loaded.activeSessionId)
                            ? loaded.activeSessionId
                            : normalizedLoaded[0]?.id || '',
                    };
                }
            }
            return {
                sessions: normalizeGroupSessions(initialState.sessions, group.groupId, group.leaderAgentId),
                activeSessionId: initialState.activeSessionId,
            };
        });
    }, [group, initialState, runtimeKey]);

    useEffect(() => {
        let cancelled = false;
        if (!group) {
            return () => { cancelled = true; };
        }
        setDirectoryLoading(true);
        void (async () => {
            try {
                const next = await loadMemberDirectoryCached();
                if (cancelled) return;
                setMemberDirectory(next);
            } catch {
                // ignore directory failures; fallback members still work
            } finally {
                if (!cancelled) setDirectoryLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [group]);

    useEffect(() => {
        if (!runtimeKey || !group || !activeSessionId || !activeSession) {
            return;
        }
        const nextDigest = buildGroupMemoryDigest(activeSession.messages, activeGroupRuntime);
        const currentDigest = activeSession.groupRuntime?.memoryDigest;
        const nextSummary = nextDigest?.summary || '';
        const currentSummary = currentDigest?.summary || '';
        const nextPending = nextDigest?.pendingLine || '';
        const currentPending = currentDigest?.pendingLine || '';
        const nextSpeaker = nextDigest?.speakerLine || '';
        const currentSpeaker = currentDigest?.speakerLine || '';
        const nextIntent = nextDigest?.lastUserIntent || '';
        const currentIntent = currentDigest?.lastUserIntent || '';
        if (
            nextSummary === currentSummary
            && nextPending === currentPending
            && nextSpeaker === currentSpeaker
            && nextIntent === currentIntent
        ) {
            return;
        }
        chatRuntimeStore.updateSessions(runtimeKey, (prev) => prev.map((session) => {
            if (session.id !== activeSessionId) return session;
            return {
                ...session,
                groupRuntime: {
                    ...normalizeGroupRuntimeValue(session.groupRuntime, group.leaderAgentId),
                    memoryDigest: nextDigest,
                },
            };
        }));
    }, [activeGroupRuntime, activeSession, activeSessionId, group, runtimeKey]);

    const handleCreateSession = () => {
        if (!runtimeKey || !group) return;
        setAutoConversationEnabled(false);
        const nextId = generateId();
        chatRuntimeStore.updateSessions(runtimeKey, (prev) => {
            const index = prev.length + 1;
            const session: StoredChatSession = {
                id: nextId,
                title: t('chat.newSessionAutoTitle', { index, defaultValue: `新对话 ${index}` }),
                updatedAt: Date.now(),
                messages: buildInitialMessages(speakerRef.current || ''),
                sessionLabel: buildScopedGroupSessionLabel(group.groupId, nextId),
                sessionSource: 'app',
                remoteSessionOwnerAgentId: group.leaderAgentId,
                groupRuntime: createInitialGroupRuntime(group.leaderAgentId),
                autoTitle: true,
                streamState: 'idle',
            };
            return [session, ...prev];
        });
        chatRuntimeStore.setActiveSessionId(runtimeKey, nextId);
    };

    const handleSelectSession = (sessionId: string) => {
        if (!runtimeKey) return;
        setAutoConversationEnabled(false);
        chatRuntimeStore.setActiveSessionId(runtimeKey, sessionId);
    };

    const handleRequestDeleteSession = (sessionId: string) => {
        setPendingDeleteSessionId(sessionId);
    };

    const handleConfirmDeleteSession = () => {
        if (!pendingDeleteSessionId || !runtimeKey) return;
        const deletingSessionId = pendingDeleteSessionId;
        const deletingActive = deletingSessionId === activeSessionId;
        const remaining = sessions.filter((session) => session.id !== deletingSessionId);
        if (!remaining.length) {
            const fallbackSession = {
                id: generateId(),
                title: t('groupChat.defaultSessionTitle', { defaultValue: '群聊' }),
                updatedAt: Date.now(),
                messages: buildInitialMessages(speakerRef.current || ''),
                sessionLabel: buildScopedGroupSessionLabel(group?.groupId || runtimeKey, `${Date.now()}`),
                sessionSource: 'app' as const,
                remoteSessionOwnerAgentId: group?.leaderAgentId,
                groupRuntime: createInitialGroupRuntime(group?.leaderAgentId || ''),
                streamState: 'idle' as const,
            };
            chatRuntimeStore.updateSessions(runtimeKey, [fallbackSession]);
            chatRuntimeStore.setActiveSessionId(runtimeKey, fallbackSession.id);
        } else {
            chatRuntimeStore.updateSessions(runtimeKey, remaining);
            if (deletingActive) {
                chatRuntimeStore.setActiveSessionId(runtimeKey, remaining[0].id);
            }
        }
        setPendingDeleteSessionId(null);
    };

    const normalizeIdList = (values: string[]) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const raw of values) {
            const id = raw.trim();
            if (!id) continue;
            const key = id.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(id);
        }
        return out;
    };

    const toggleTarget = (agentId: string) => {
        const id = agentId.trim();
        if (!id) return;
        setTargetSelectError('');
        setSelectedTargetIds((prev) => {
            const base = normalizeIdList(prev);
            const exists = base.includes(id);
            if (exists) {
                return base.filter((x) => x !== id);
            }
            setSelectedSpeakerId(id);
            return [...base, id];
        });
    };

    const selectedTargetNames = useMemo(() => {
        if (!group) return [] as string[];
        const ids = normalizeIdList(selectedTargetIds);
        const seen = new Set<string>();
        const out: string[] = [];
        for (const id of ids) {
            const agent = memberDirectory.get(id) ?? buildFallbackMember(id);
            const name = (agent.name || id).trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(name);
        }
        return out;
    }, [group, memberDirectory, selectedTargetIds, speakerId]);

    const extraReplyAgents = useMemo(() => {
        if (!group) return [] as Agent[];
        const unique = normalizeIdList(selectedTargetIds);
        return unique
            .filter((id) => id !== speakerId)
            .map((id) => memberDirectory.get(id) ?? buildFallbackMember(id));
    }, [group, memberDirectory, selectedTargetIds, speakerId]);

    const selectExtraReplyAgents = useMemo(() => {
        if (!group) return undefined;
        return (message: string) => {
            if (selectedTargetIds.length) {
                return extraReplyAgents;
            }
            if (groupMode !== 'free_talk') {
                return [];
            }
            const mentionTokens = extractMentions(message);
            if (mentionTokens.length > 0) {
                const seen = new Set<string>();
                const targets: Agent[] = [];
                for (const token of mentionTokens) {
                    const hit = mentionDirectory.get(token.toLowerCase());
                    if (!hit?.id) continue;
                    const targetId = hit.id.trim();
                    if (!targetId || targetId === speakerId) continue;
                    if (seen.has(targetId)) continue;
                    seen.add(targetId);
                    targets.push(hit);
                }
                if (targets.length > 0) {
                    return targets;
                }
            }

            const maxExtra = Math.min(3, Math.max(0, responderQueueLimit - 1));
            if (maxExtra <= 0) return [];

            const ranked = groupMembers
                .filter((agent) => agent.id !== speakerId)
                .map((agent) => ({
                    agent,
                    score: scoreAgentForMessage(message, agent),
                }))
                .filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, maxExtra)
                .map((item) => item.agent);
            if (ranked.length > 0) {
                return ranked;
            }

            const fallbackCandidates = groupMembers.filter((agent) => agent.id !== speakerId);
            return pickFallbackAgents(message, fallbackCandidates, maxExtra);
        };
    }, [extraReplyAgents, group, groupMembers, groupMode, mentionDirectory, responderQueueLimit, selectedTargetIds, speakerId]);

    const resolvePrimaryReplyAgent = useMemo(() => {
        if (!group) return undefined;
        return (message: string) => {
            const trimmed = message.trim();
            if (!trimmed) return null;

            let resolved: Agent | null = null;
            if (selectedTargetIds.length) {
                const preferredId = (selectedSpeakerId || selectedTargetIds[0] || group.leaderAgentId).trim();
                if (preferredId) {
                    resolved = memberDirectory.get(preferredId) ?? buildFallbackMember(preferredId);
                }
            } else {
                const mentionTokens = extractMentions(trimmed);
                for (const token of mentionTokens) {
                    const hit = mentionDirectory.get(token.toLowerCase());
                    if (hit?.id) {
                        resolved = hit;
                        break;
                    }
                }

                if (!resolved && groupMode === 'free_talk') {
                    const directHit = groupMembers
                        .map((agent) => ({
                            agent,
                            score: scoreDirectNameAgentMatch(trimmed, agent),
                            fallback: scoreAgentForMessage(trimmed, agent),
                        }))
                        .filter((item) => item.score > 0)
                        .sort((a, b) => (b.score - a.score) || (b.fallback - a.fallback))
                        .map((item) => item.agent)[0];
                    if (directHit) {
                        resolved = directHit;
                    }
                }
            }

            if (resolved?.id) {
                setSelectedSpeakerId((prev) => (prev === resolved!.id ? prev : resolved!.id));
            }
            return resolved;
        };
    }, [group, groupMembers, groupMode, memberDirectory, mentionDirectory, selectedSpeakerId, selectedTargetIds]);

    const dynamicSystemPreamble = useMemo(() => {
        if (!group) return '';
        const selected = group.memberAgentIds.filter((id) => id !== speakerId);
        const selectedLines = selected.map((id) => {
            const agent = memberDirectory.get(id);
            const name = agent?.name?.trim() || id;
            return `- ${name} (id=${id})`;
        });
        const dispatchHint = [
            '[system:group-mention-dispatch]',
            '本群已开启“@自动转发”：任何成员回复里出现 @某成员，系统会把该句静默转发给被@成员继续讨论。',
            '规则：需要对方接棒时才@；显式 @ 按出现顺序串行入队，前一位完成后下一位继续；@时把要做的事写清楚；若你@别人来答，请闭麦不要继续输出正文。',
            '自由抢答也要排队，按关联权重依次补位，单轮最多补位 3 人。',
            '当一轮发言结束且没有明确停止时，由主持人继续承接总结、点名下一位，或直接安排下一步工作。',
            '若群内连续 2 分钟无人推进，主持人只允许追问 1 次，不能重复催促。',
            '终止：当用户说“停止/终止/暂停讨论/闭麦”或点击「终止输出」时，停止继续@与扩展讨论。',
            `规则补充：显式@人数不再单独限额（最多覆盖当前群成员）；自动讨论链最大深度${groupLimits.mentionMaxDepth}。`,
        ].join('\n');
        const runtimeHint = [
            '[system:group-chat-runtime]',
            `当前主回复者: ${speaker?.name ?? speakerId} (id=${speakerId || 'unknown'})`,
            selectedTargetNames.length > 0 ? `本次@对象: ${selectedTargetNames.map((name) => `@${name}`).join(' ')}` : '本次未指定@对象：由主持人按秩序决定是否点名接棒。',
            `当前群聊模式: ${groupMode === 'free_talk' ? '自由发言（相关成员可主动回应）' : '主持人调度（未@仅主持人回应）'}`,
            `阈值：自由抢答每轮最多 ${responderQueueLimit} 人顺序发言，冷却 ${Math.round(groupLimits.cooldownMs / 1000)} 秒，重复抑制阈值 ${groupLimits.duplicateThreshold}`,
            '注意：这是群聊公开消息，你的回复应让群内所有成员都能理解与跟进。',
            '异步任务汇报规则：进度只更新任务卡片与时间线，不要用聊天正文频繁刷进度；仅异常/失败/最终总结时再汇报一次。',
            'A2A 委派规则：只能使用稳定的 agent_id（即本群列表里的 id=...），禁止用昵称/中文名/口头称呼进行调用。',
            selectedLines.length > 0 ? '群成员（可互相委派 A2A，仅限群内白名单）:' : '',
            selectedLines.length > 0 ? selectedLines.join('\n') : '',
        ].filter(Boolean).join('\n');
        const digestContext = activeGroupRuntime.memoryDigest?.summary
            ? [
                '[system:group-memory-digest]',
                '以下是当前群聊的阶段摘要，请优先沿用此摘要理解上下文，避免重复展开旧消息：',
                activeGroupRuntime.memoryDigest.summary,
            ].join('\n')
            : '';
        const sharedContext = activeSession && !digestContext ? buildGroupSharedContext(activeSession.messages, 8) : '';
        const queueContext = runningQueueItems.length > 0
            ? [
                '[system:group-runtime-queue]',
                `当前发言队列：${runningQueueItems.map((item) => `${item.status === 'running' ? '进行中' : '待发言'} ${item.agentName || item.agentId}`).join('；')}`,
            ].join('\n')
            : '';
        return [group.systemPrompt, dispatchHint, runtimeHint, queueContext, digestContext, sharedContext].filter(Boolean).join('\n\n');
    }, [activeGroupRuntime.memoryDigest, activeSession, group, groupLimits, groupMode, memberDirectory, responderQueueLimit, runningQueueItems, selectedTargetNames, speaker, speakerId]);

    const inputToolbar = useMemo(() => {
        if (!group) return null;
        return (
            <div className="flex items-center gap-2 min-w-0">
                <div className="flex-1 min-w-0">
                    <div className="chat-target-strip group/target-strip relative min-w-0">
                        <button
                            type="button"
                            onClick={() => scrollTargetsBy(-220)}
                            disabled={!canScrollTargetsLeft}
                            className={cn(
                                'chat-target-scroll-arrow chat-target-scroll-arrow-left',
                                !canScrollTargetsLeft && 'pointer-events-none opacity-0',
                            )}
                            aria-label="向左查看对象"
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <div
                            ref={targetScrollRef}
                            className="chat-target-scroll flex items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap px-8 pb-1"
                            onWheel={(event) => {
                                const node = targetScrollRef.current;
                                if (!node) return;
                                if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
                                    return;
                                }
                                event.preventDefault();
                                node.scrollBy({
                                    left: event.deltaY,
                                });
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    setTargetSelectError('');
                                    setSelectedTargetIds([]);
                                    setSelectedSpeakerId(group.leaderAgentId);
                                }}
                                className={cn(
                                    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all border whitespace-nowrap',
                                    selectedTargetIds.length === 0
                                        ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/15'
                                        : 'bg-background/60 text-muted-foreground border-border/60 hover:bg-muted/50 hover:text-foreground',
                                )}
                                title="不指定@对象（主持人调度）"
                            >
                                <span className="max-w-[84px] truncate">智能</span>
                            </button>
                            {groupMembers.map((m) => {
                                const selected = selectedTargetIds.includes(m.id);
                                return (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => toggleTarget(m.id)}
                                        className={cn(
                                            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all border whitespace-nowrap',
                                            selected
                                                ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/15'
                                                : 'bg-background/60 text-muted-foreground border-border/60 hover:bg-muted/50 hover:text-foreground',
                                        )}
                                        title={selected ? t('groupChat.unselect', { defaultValue: '取消选择' }) : t('groupChat.select', { defaultValue: '选择' })}
                                    >
                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full overflow-hidden">
                                            <AgentAvatar name={m.name} avatarUrl={m.avatarUrl} color={m.color} size="sm" className="w-5 h-5" />
                                        </span>
                                        <span className="max-w-[120px] truncate">@{m.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            type="button"
                            onClick={() => scrollTargetsBy(220)}
                            disabled={!canScrollTargetsRight}
                            className={cn(
                                'chat-target-scroll-arrow chat-target-scroll-arrow-right',
                                !canScrollTargetsRight && 'pointer-events-none opacity-0',
                            )}
                            aria-label="向右查看对象"
                        >
                            <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    {targetSelectError ? (
                        <div className="mt-1 text-[10px] font-bold text-destructive/90">{targetSelectError}</div>
                    ) : null}
                </div>
            </div>
        );
    }, [group, groupMembers, selectedTargetIds, t, targetSelectError]);

    const transformUserMessage = useMemo(() => {
        if (!selectedTargetNames.length) return undefined;
        return (rawText: string) => {
            const trimmed = rawText.trim();
            if (!trimmed) return rawText;
            if (trimmed.startsWith('@')) return rawText;
            const prefix = selectedTargetNames.map((name) => `@${name}`).join(' ');
            return `${prefix} ${trimmed}`;
        };
    }, [selectedTargetNames]);

    const parseTags = (raw: string): string[] => {
        const tokens = raw
            .split(/[,，]/g)
            .map((item) => item.trim())
            .filter(Boolean);
        const seen = new Set<string>();
        const out: string[] = [];
        for (const token of tokens) {
            const key = token.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                out.push(token);
            }
        }
        return out;
    };

    const toggleMember = (agentId: string) => {
        const id = agentId.trim();
        if (!id) return;
        const leaderId = group?.leaderAgentId?.trim();
        if (leaderId && id === leaderId) return;
        setSettingsMemberIds((prev) => {
            const base = normalizeIdList(prev);
            if (base.includes(id)) {
                return base.filter((x) => x !== id);
            }
            return [...base, id];
        });
    };

    const settingsMembers = useMemo(() => (
        settingsMemberIds.map((id) => memberDirectory.get(id) ?? buildFallbackMember(id))
    ), [memberDirectory, settingsMemberIds]);

    const availableMembers = useMemo(() => {
        const rows = Array.from(memberDirectory.values());
        return rows.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    }, [memberDirectory]);

    const filteredAvailableMembers = useMemo(() => {
        const query = settingsMemberSearch.trim().toLowerCase();
        if (!query) return availableMembers;
        return availableMembers.filter((agent) => {
            const name = (agent.name || '').toLowerCase();
            const title = (agent.title || '').toLowerCase();
            const expertise = (agent.expertise || []).some((tag) => tag.toLowerCase().includes(query));
            return name.includes(query) || title.includes(query) || expertise;
        });
    }, [availableMembers, settingsMemberSearch]);

    const handleSaveGroup = async () => {
        if (!group) return;
        if (settingsSaving) return;
        const name = settingsName.trim();
        if (!name) {
            setSettingsSaveError(t('groupChat.nameRequired', { defaultValue: '群名称不能为空' }));
            return;
        }
        setSettingsSaving(true);
        setSettingsSaveError('');
        setSettingsSaveOkAt(null);
        try {
            const leader = group.leaderAgentId.trim();
            let memberAgentIds = normalizeIdList(settingsMemberIds);
            if (leader && !memberAgentIds.includes(leader)) {
                memberAgentIds = [leader, ...memberAgentIds];
            }
            const memberSet = new Set(memberAgentIds.map((x) => x.trim()).filter(Boolean));
            let adminAgentIds = normalizeIdList(settingsAdminIds).filter((x) => memberSet.has(x));
            if (leader && !adminAgentIds.includes(leader)) {
                adminAgentIds.push(leader);
            }
            adminAgentIds = normalizeIdList(adminAgentIds);

            const updated = await updateChatGroup(group.groupId, {
                name,
                description: settingsDescription.trim(),
                tags: parseTags(settingsTagsText),
                leaderAgentId: group.leaderAgentId,
                adminAgentIds,
                memberAgentIds,
                groupMode: settingsMode,
                limits: settingsLimits,
                applyCollaborationAcl: settingsApplyAcl,
            });
            const [refreshedDirectory, refreshedGroup] = await Promise.all([
                loadMemberDirectoryCached(true).catch(() => null),
                getChatGroup(group.groupId).catch(() => updated),
            ]);
            if (refreshedDirectory) {
                setMemberDirectory(refreshedDirectory);
            }
            const nextGroup = refreshedGroup ?? updated;
            setGroup(nextGroup);
            setSettingsMemberIds(nextGroup.memberAgentIds);
            setSettingsAdminIds((nextGroup.adminAgentIds?.length ? nextGroup.adminAgentIds : [nextGroup.leaderAgentId]).filter(Boolean));
            setSettingsMode(nextGroup.groupMode ?? 'leader_dispatch');
            setSettingsLimits(nextGroup.limits ?? DEFAULT_GROUP_LIMITS);
            setSelectedTargetIds((prev) => prev.filter((id) => nextGroup.memberAgentIds.includes(id)));
            setSelectedSpeakerId((prev) => (nextGroup.memberAgentIds.includes(prev) ? prev : nextGroup.leaderAgentId));
            setSettingsSaveOkAt(Date.now());
        } catch (err) {
            setSettingsSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSettingsSaving(false);
        }
    };

    const handleConfirmDeleteGroup = async () => {
        if (!group || deleteGroupBusy) return;
        setDeleteGroupError('');
        setDeleteGroupBusy(true);
        try {
            await deleteChatGroup(group.groupId);
            if (runtimeKey) {
                chatRuntimeStore.clearAgentState(runtimeKey);
            }
            navigate('/home');
        } catch (err) {
            setDeleteGroupError(err instanceof Error ? err.message : String(err));
        } finally {
            setDeleteGroupBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="p-6 text-sm text-muted-foreground">
                {t('common.loading', { defaultValue: '加载中...' })}
            </div>
        );
    }

    if (!group) {
        return (
            <div className="p-6 text-sm text-destructive">
                {error || t('groupChat.notFound', { defaultValue: '群不存在' })}
            </div>
        );
    }

    return (
        <div className="chat-container">
                    {/* 1) 左栏：群会话（对齐私聊 chat-sidebar 风格） */}
                    <div className="chat-sidebar">
                        <div className="p-4 pt-3 space-y-3">
                            <Button
                                type="button"
                                onClick={handleCreateSession}
                                disabled={!runtimeKey}
                                className="w-full justify-start gap-2 rounded-lg h-10 border border-border/80 bg-background text-foreground shadow-sm hover:bg-muted/70 hover:border-border transition-all active:scale-[0.98] dark:bg-zinc-900/70 dark:border-zinc-700/80 dark:text-zinc-100 dark:hover:bg-zinc-800/80"
                            >
                                <Plus className="w-4 h-4 text-muted-foreground dark:text-zinc-400" />
                                <span className="text-sm font-bold">{t('chat.newSession', { defaultValue: '新建对话' })}</span>
                            </Button>
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder={t('chat.searchSessions', { defaultValue: '搜索历史会话...' })}
                                    value={sessionKeyword}
                                    onChange={(e) => setSessionKeyword(e.target.value)}
                                    className="h-8 pl-9 bg-background/50 border-none ring-1 ring-border shadow-none rounded-lg text-xs"
                                />
                            </div>
                        </div>

                    <div className="flex-1 overflow-y-auto px-2 space-y-1">
                        {visibleSessions.map((session) => {
                            const active = session.id === activeSessionId;
                            return (
                                <button
                                    key={session.id}
                                    type="button"
                                    onClick={() => handleSelectSession(session.id)}
                                    className={cn(
                                        'chat-sidebar-item group/session w-full text-left flex flex-col gap-0.5',
                                        active
                                            ? 'bg-muted text-foreground shadow-sm dark:bg-zinc-800/70 dark:text-zinc-100'
                                            : 'hover:bg-muted/60 dark:hover:bg-zinc-900/70',
                                    )}
                                >
                                    <div className="flex justify-between items-start">
                                        <span className={cn('text-sm truncate font-bold pr-2 inline-flex items-center gap-1.5', active ? 'text-foreground dark:text-zinc-100' : 'text-foreground')}>
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
                                            tabIndex={0}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleRequestDeleteSession(session.id);
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    handleRequestDeleteSession(session.id);
                                                }
                                            }}
                                            className={cn(
                                                'inline-flex items-center justify-center h-5 w-5 rounded-sm shrink-0 transition-opacity',
                                                active
                                                    ? 'text-muted-foreground hover:text-foreground hover:bg-background/70 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-700/60'
                                                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/30 dark:hover:bg-zinc-800/60',
                                                'opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100',
                                            )}
                                            aria-label={t('common.delete')}
                                        >
                                            <X className="w-3 h-3" />
                                        </span>
                                    </div>
                                    <span className={cn('text-[10px] block opacity-70', active ? 'text-muted-foreground dark:text-zinc-400' : 'text-muted-foreground')}>
                                        {new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </button>
                                );
                            })}
                            {visibleSessions.length === 0 && (
                                <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                                    {sessionKeywordNormalized
                                        ? t('chat.emptySearchSessions', { defaultValue: '没有匹配的会话' })
                                        : t('chat.emptySessions', { defaultValue: '暂无会话，点击上方「新建对话」开始' })}
                                </div>
                            )}
                        </div>
                    </div>

            {/* 2) 中栏：群聊主窗口（沿用私聊渲染能力，外壳使用群聊UI） */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* 顶栏 */}
                <div className="chat-header">
                    <div className="flex -space-x-2.5">
                        {groupMembers.slice(0, 4).map((m, i) => (
                            <div
                                key={m.id}
                                className="rounded-full border-2 border-background shadow-sm"
                                style={{ zIndex: 10 - i }}
                            >
                                <AgentAvatar name={m.name} avatarUrl={m.avatarUrl} color={m.color} size="sm" className="w-7 h-7" />
                            </div>
                        ))}
                        {groupMembers.length > 4 && (
                            <div className="w-7 h-7 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[9px] font-black text-muted-foreground">
                                +{groupMembers.length - 4}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="font-black text-[14px] tracking-tight truncate">{group.name}</span>
                        <div className="flex items-center gap-1.5 leading-none">
                            <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                            <span className="text-[10px] uppercase font-black tracking-widest text-success">
                                {onlineMemberCount} {t('groupChat.online', { defaultValue: '在线' })}
                            </span>
                            {directoryLoading ? (
                                <span className="text-[10px] text-muted-foreground/70 ml-2">{t('common.loading', { defaultValue: '加载中...' })}</span>
                            ) : null}
                        </div>
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                        <Badge variant="secondary" className="rounded-full px-3 py-1 bg-primary/10 text-primary font-black text-[10px] uppercase tracking-widest">
                            {t('groupChat.speaker', { defaultValue: '发言' })}: {speaker?.name ?? speakerId}
                        </Badge>
                    </div>
                </div>

                <div className="px-4 pb-3">
                    <Card className="border-border/70 bg-background/70 shadow-sm">
                        <CardContent className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <Badge variant="secondary" className="rounded-full px-2.5 py-1">
                                    队列状态：{activeGroupRuntime.status === 'running' ? '执行中' : activeGroupRuntime.status === 'stopped' ? '已终止' : '空闲'}
                                </Badge>
                                <Badge variant="outline" className="rounded-full px-2.5 py-1">
                                    当前发言：{speaker?.name ?? speakerId}
                                </Badge>
                                <Badge variant="outline" className="rounded-full px-2.5 py-1">
                                    待处理：{runningQueueItems.length}
                                </Badge>
                                <Badge variant="outline" className="rounded-full px-2.5 py-1">
                                    异步任务：{activeAsyncTaskCount}
                                </Badge>
                                {activeGroupRuntime.lastCompactedAt ? (
                                    <Badge variant="secondary" className="rounded-full px-2.5 py-1 bg-amber-500/10 text-amber-700">
                                        已压缩：{new Date(activeGroupRuntime.lastCompactedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </Badge>
                                ) : null}
                                {activeGroupRuntime.stopRequested ? (
                                    <Badge variant="destructive" className="rounded-full px-2.5 py-1">
                                        已终止：{activeGroupRuntime.stopReason || '用户终止'}
                                    </Badge>
                                ) : null}
                            </div>
                            {activeGroupRuntime.memoryDigest?.summary ? (
                                <div className="mt-2 rounded-xl border border-border/60 bg-muted/25 px-3 py-2 text-[12px] leading-5 text-muted-foreground whitespace-pre-wrap">
                                    {activeGroupRuntime.memoryDigest.summary}
                                </div>
                            ) : null}
                            {runningQueueItems.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {runningQueueItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className={cn(
                                                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                                                item.status === 'running'
                                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                                                    : 'border-border/70 bg-background text-foreground/80',
                                            )}
                                        >
                                            <span>{item.status === 'running' ? '执行中' : '排队中'}</span>
                                            <span>{item.agentName || item.agentId}</span>
                                            {item.note ? <span className="text-muted-foreground">· {item.note}</span> : null}
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                </div>

                {/* 聊天区域 */}
                <div className="flex-1 min-h-0 flex">
                        <ChatPage
                            agentId={selectedTargetIds.length ? (speakerId || group.leaderAgentId) : group.leaderAgentId}
                            runtimeKey={runtimeKey}
                            sessionOwnerAgentId={group.leaderAgentId}
                            fixedSessionTitle={group.name}
                            sessionLabel={activeSessionLabel}
                            systemPreamble={dynamicSystemPreamble}
                            groupUpgradeEnabled={false}
                            uiVariant="embedded"
                        inputToolbar={inputToolbar}
                        idleAuto={idleAutoConfig}
                        autoConversationEnabled={autoConversationEnabled}
                        autoConversationLeader={idleAutoLeader}
                        onAutoConversationEnabledChange={setAutoConversationEnabled}
                        extraReplyAgents={extraReplyAgents}
                        selectExtraReplyAgents={selectExtraReplyAgents}
                        mentionDispatchAgents={groupMembers}
                        mentionDispatchMaxTargets={maxTalkTargets}
                        mentionDispatchMaxDepth={groupLimits.mentionMaxDepth}
                        maxRespondersPerUserTurn={responderQueueLimit}
                        agentCooldownMs={groupLimits.cooldownMs}
                        duplicateSuppressionThreshold={groupLimits.duplicateThreshold}
                        stopAuthorityAgentIds={[group.leaderAgentId, ...(group.adminAgentIds ?? [])].filter(Boolean)}
                        groupRuntimeEnabled
                        groupLeaderAgentId={group.leaderAgentId}
                        resolvePrimaryReplyAgent={resolvePrimaryReplyAgent}
                        transformUserMessage={transformUserMessage}
                    />
                </div>
            </div>

            {/* 3) 右栏：立绘 → 成员头像 → 群信息 → 群设置（对齐私聊风格） */}
            <div className="chat-info-sidebar">
                <div className="chat-info-panel">
                    {speaker?.portraitUrl ? (
                        <div className="chat-info-portrait-card group relative overflow-hidden">
                            <img
                                src={speaker.portraitUrl}
                                alt={`${speaker.name} portrait`}
                                className="chat-info-portrait-img"
                                loading="lazy"
                                decoding="async"
                            />
                            {speaker?.id ? (
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/55 via-black/15 to-transparent px-3 pb-3 pt-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                    <div className="pointer-events-auto flex items-center gap-2">
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="secondary"
                                            className="h-9 w-9 rounded-full border border-white/15 bg-black/65 text-white shadow-lg backdrop-blur hover:bg-black/80"
                                            title="私聊该智能体"
                                            onClick={() => navigate(`/chat/${speaker.id}`)}
                                        >
                                            <MessageCircle className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="secondary"
                                            className="h-9 w-9 rounded-full border border-white/15 bg-black/65 text-white shadow-lg backdrop-blur hover:bg-black/80"
                                            title="设置该智能体"
                                            onClick={() => navigate(`/edit/${speaker.id}`)}
                                        >
                                            <Settings className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="secondary"
                                            className="h-9 w-9 rounded-full border border-white/15 bg-black/65 text-white shadow-lg backdrop-blur hover:bg-black/80"
                                            title="任务管理"
                                            onClick={() => navigate(`/agent/${encodeURIComponent(speaker.id)}/tasks`)}
                                        >
                                            <ListChecks className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div className="chat-info-portrait-placeholder group relative overflow-hidden">
                            <AgentAvatar
                                name={speaker?.name ?? speakerId}
                                avatarUrl={speaker?.avatarUrl}
                                color={speaker?.color}
                                size="xl"
                                className="chat-info-portrait-fallback-avatar"
                            />
                            {speaker?.id ? (
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/55 via-black/15 to-transparent px-3 pb-3 pt-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                    <div className="pointer-events-auto flex items-center gap-2">
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="secondary"
                                            className="h-9 w-9 rounded-full border border-white/15 bg-black/65 text-white shadow-lg backdrop-blur hover:bg-black/80"
                                            title="私聊该智能体"
                                            onClick={() => navigate(`/chat/${speaker.id}`)}
                                        >
                                            <MessageCircle className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="secondary"
                                            className="h-9 w-9 rounded-full border border-white/15 bg-black/65 text-white shadow-lg backdrop-blur hover:bg-black/80"
                                            title="设置该智能体"
                                            onClick={() => navigate(`/edit/${speaker.id}`)}
                                        >
                                            <Settings className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="secondary"
                                            className="h-9 w-9 rounded-full border border-white/15 bg-black/65 text-white shadow-lg backdrop-blur hover:bg-black/80"
                                            title="任务管理"
                                            onClick={() => navigate(`/agent/${encodeURIComponent(speaker.id)}/tasks`)}
                                        >
                                            <ListChecks className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}

                    <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                <Users className="w-3.5 h-3.5" />
                                {t('groupChat.members', { defaultValue: '群成员' })}
                            </div>
                            <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 bg-primary/10 text-primary font-black text-[10px] uppercase tracking-widest">
                                {groupMembers.length}
                            </Badge>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {groupMembers.map((m) => {
                                const active = m.id === (speakerId || group.leaderAgentId);
                                const selected = selectedTargetIds.length
                                    ? selectedTargetIds.includes(m.id)
                                    : active;
                                return (
                                    <button
                                        key={m.id}
                                        type="button"
                                        className={cn(
                                            'shrink-0 rounded-full p-0.5 transition-all',
                                            active ? 'ring-2 ring-primary/60' : 'ring-1 ring-border/60 hover:ring-primary/30',
                                            selected ? 'bg-primary/5' : '',
                                        )}
                                        onClick={() => {
                                            setSelectedSpeakerId(m.id);
                                            setTargetSelectError('');
                                            setSelectedTargetIds((prev) => {
                                                const base = normalizeIdList(prev);
                                                if (base.includes(m.id)) return base;
                                                return [...base, m.id];
                                            });
                                        }}
                                        title={t('groupChat.switchPortrait', { defaultValue: '切换立绘/对话对象' })}
                                    >
                                        <AgentAvatar name={m.name} avatarUrl={m.avatarUrl} color={m.color} size="sm" className="w-9 h-9 rounded-full" />
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <Card className="border-border/60 shadow-none bg-background/40">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                                {t('groupChat.info', { defaultValue: '群信息' })}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="space-y-1">
                                <div className="text-sm font-bold">{group.name}</div>
                                {group.description ? (
                                    <div className="text-xs text-foreground/80 whitespace-pre-wrap break-words">{group.description}</div>
                                ) : (
                                    <div className="text-xs text-muted-foreground/70">暂无群描述</div>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <Users className="w-3.5 h-3.5" />
                                <span>{group.memberAgentIds.length} {t('groupChat.members', { defaultValue: '成员' })}</span>
                            </div>
                            {group.tags.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {group.tags.map((tag) => (
                                        <Badge key={tag} variant="secondary" className="text-[10px] px-2 py-0.5">
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            ) : null}
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => setSettingsOpen(true)}
                                className="w-full rounded-lg h-8 gap-2"
                            >
                                <Settings className="w-4 h-4" />
                                群信息设置
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>


            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>{t('groupChat.settings', { defaultValue: '群信息设置' })}</DialogTitle>
                        <DialogDescription>在这里调整群信息与成员权限设置。</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6 max-h-[70vh] overflow-auto pr-1">
                        <Card className="border-none shadow-none bg-card/40 rounded-3xl overflow-hidden ring-1 ring-border/40">
                            <CardHeader className="pb-4 pt-6 px-6">
                                <CardTitle className="text-sm font-black flex items-center gap-2 uppercase tracking-tight">
                                    <Settings className="w-4 h-4 text-primary" />
                                    基础信息
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6 px-6 pb-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label className="text-[11px] font-black uppercase tracking-widest ml-1 opacity-70">{t('home.createGroup.name', { defaultValue: '群名称' })}</Label>
                                        <Input
                                            value={settingsName}
                                            onChange={(e) => setSettingsName(e.target.value)}
                                            className="h-12 bg-background/50 border-muted-foreground/10 rounded-xl focus-visible:ring-primary/30 transition-all font-medium"
                                            placeholder={t('home.createGroup.namePlaceholder', { defaultValue: '例如：产品迭代小组' })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[11px] font-black uppercase tracking-widest ml-1 opacity-70">{t('home.createGroup.tags', { defaultValue: '标签' })}</Label>
                                        <Input
                                            value={settingsTagsText}
                                            onChange={(e) => setSettingsTagsText(e.target.value)}
                                            className="h-12 bg-background/50 border-muted-foreground/10 rounded-xl focus-visible:ring-primary/30 transition-all"
                                            placeholder={t('groupChat.tagsHint', { defaultValue: '用逗号分隔，如：ui, a2a, 运营' })}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[11px] font-black uppercase tracking-widest ml-1 opacity-70">{t('home.createGroup.description', { defaultValue: '群介绍' })}</Label>
                                    <Textarea
                                        value={settingsDescription}
                                        onChange={(e) => setSettingsDescription(e.target.value)}
                                        className="min-h-[110px] bg-background/50 border-muted-foreground/10 rounded-2xl resize-none focus-visible:ring-primary/30 p-4 transition-all"
                                        placeholder={t('home.createGroup.descriptionPlaceholder', { defaultValue: '简要说明这个群的目标与协作方式' })}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-none shadow-none bg-card/40 rounded-3xl overflow-hidden ring-1 ring-border/40">
                            <CardHeader className="pb-4 pt-6 px-6">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm font-black flex items-center gap-2 uppercase tracking-tight">
                                        <Users className="w-4 h-4 text-primary" />
                                        成员管理
                                    </CardTitle>
                                    <Badge variant="secondary" className="rounded-full px-3 py-1 bg-primary/10 text-primary font-black text-[10px] uppercase tracking-widest">
                                        {settingsMemberIds.length} 名成员
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-5 px-6 pb-6">
                                <div className="flex flex-wrap gap-2">
                                    {settingsMembers.map((member) => {
                                        const leaderId = group.leaderAgentId.trim();
                                        const isLeader = leaderId && member.id === leaderId;
                                        return (
                                            <Badge
                                                key={`member_${member.id}`}
                                                variant="secondary"
                                                className={cn(
                                                    'px-2.5 py-1 text-[11px] font-bold rounded-full flex items-center gap-1.5',
                                                    isLeader ? 'bg-primary/15 text-primary' : 'bg-muted/50 text-foreground',
                                                )}
                                            >
                                                <AgentAvatar name={member.name} avatarUrl={member.avatarUrl} color={member.color} size="sm" className="w-4 h-4" />
                                                <span className="max-w-[120px] truncate">{member.name}</span>
                                                {isLeader ? (
                                                    <span className="text-[10px] opacity-70">群主</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleMember(member.id)}
                                                        className="ml-1 text-muted-foreground hover:text-destructive"
                                                        title="移除成员"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                )}
                                            </Badge>
                                        );
                                    })}
                                    {!settingsMembers.length && (
                                        <span className="text-[10px] text-muted-foreground">暂无成员</span>
                                    )}
                                </div>

                                <div className="relative">
                                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground opacity-30" />
                                    <Input
                                        value={settingsMemberSearch}
                                        onChange={(e) => setSettingsMemberSearch(e.target.value)}
                                        placeholder="搜索可加入成员"
                                        className="pl-10 h-11 bg-background/50 border-muted-foreground/10 rounded-2xl transition-all"
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-auto pr-1 custom-scrollbar">
                                    {directoryLoading ? (
                                        <div className="col-span-full py-6 text-center text-[10px] text-muted-foreground">成员加载中...</div>
                                    ) : filteredAvailableMembers.length ? (
                                        filteredAvailableMembers.map((agent) => {
                                            const selected = settingsMemberIds.includes(agent.id);
                                            return (
                                                <button
                                                    key={`candidate_${agent.id}`}
                                                    type="button"
                                                    onClick={() => toggleMember(agent.id)}
                                                    className={cn(
                                                        'w-full flex items-center justify-between gap-2 rounded-2xl px-3 py-2 text-[11px] transition-colors',
                                                        selected
                                                            ? 'bg-primary/10 text-primary'
                                                            : 'bg-background/60 text-foreground hover:bg-muted/50',
                                                    )}
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl} color={agent.color} size="sm" className="w-5 h-5" />
                                                        <span className="truncate max-w-[160px]">{agent.name}</span>
                                                    </span>
                                                    <span className="text-[10px] font-bold">{selected ? '已加入' : '加入'}</span>
                                                </button>
                                            );
                                        })
                                    ) : (
                                        <div className="col-span-full py-6 text-center text-[10px] text-muted-foreground">没有匹配成员</div>
                                    )}
                                </div>
                                <div className="text-[10px] text-muted-foreground leading-snug">
                                    保存后会同步群系统提示词，并根据设置同步群内 A2A 可见白名单。
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-none shadow-none bg-card/40 rounded-3xl overflow-hidden ring-1 ring-border/40">
                            <CardHeader className="pb-4 pt-6 px-6">
                                <CardTitle className="text-sm font-black flex items-center gap-2 uppercase tracking-tight">
                                    <Users className="w-4 h-4 text-primary" />
                                    协作策略
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4 px-6 pb-6">
                                <div className="space-y-2">
                                    <Label className="text-[11px] font-black uppercase tracking-widest ml-1 opacity-70">群聊模式</Label>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant={settingsMode === 'leader_dispatch' ? 'secondary' : 'outline'}
                                            size="sm"
                                            className="h-9 rounded-lg"
                                            onClick={() => setSettingsMode('leader_dispatch')}
                                        >
                                            主持人调度
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={settingsMode === 'free_talk' ? 'secondary' : 'outline'}
                                            size="sm"
                                            className="h-9 rounded-lg"
                                            onClick={() => setSettingsMode('free_talk')}
                                        >
                                            自由发言
                                        </Button>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground leading-snug">
                                        主持人调度：未@时仅主持人回应；自由发言：相关成员可主动回应（仍受阈值限制）。
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-[11px] font-black uppercase tracking-widest ml-1 opacity-70">发言阈值</Label>
                                    <div className="text-[11px] text-muted-foreground">
                                        自由发言每轮最多 {settingsLimits.maxSpeakers} 人，单人冷却 {Math.round(settingsLimits.cooldownMs / 1000)} 秒，重复抑制 {settingsLimits.duplicateThreshold}，显式@不再限人数，链深度 {settingsLimits.mentionMaxDepth}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-[11px] font-black uppercase tracking-widest ml-1 opacity-70">群管理</Label>
                                    <div className="rounded-2xl border border-border/60 bg-background/60 p-3 space-y-2">
                                        <div className="text-[10px] text-muted-foreground leading-snug">
                                            主持人（群主）：{memberDirectory.get(group.leaderAgentId)?.name ?? group.leaderAgentId}（默认管理员）
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {settingsMembers.map((m) => {
                                                const leaderId = group.leaderAgentId.trim();
                                                const isLeader = Boolean(leaderId) && m.id === leaderId;
                                                const selected = isLeader || settingsAdminIds.includes(m.id);
                                                return (
                                                    <button
                                                        key={`admin_${m.id}`}
                                                        type="button"
                                                        disabled={isLeader}
                                                        onClick={() => {
                                                            setSettingsAdminIds((prev) => {
                                                                const base = normalizeIdList(prev);
                                                                const exists = base.includes(m.id);
                                                                const next = exists ? base.filter((x) => x !== m.id) : [...base, m.id];
                                                                return normalizeIdList(next);
                                                            });
                                                        }}
                                                        className={cn(
                                                            'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold transition-all border',
                                                            selected
                                                                ? 'bg-primary/10 text-primary border-primary/30'
                                                                : 'bg-background/60 text-muted-foreground border-border/60 hover:bg-muted/50 hover:text-foreground',
                                                            isLeader ? 'opacity-90 cursor-not-allowed' : '',
                                                        )}
                                                        title={isLeader ? '群主默认管理员（不可取消）' : (selected ? '取消管理员' : '设为管理员')}
                                                    >
                                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full overflow-hidden">
                                                            <AgentAvatar name={m.name} avatarUrl={m.avatarUrl} color={m.color} size="sm" className="w-5 h-5" />
                                                        </span>
                                                        <span className="max-w-[120px] truncate">{m.name}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div className="text-[10px] text-muted-foreground leading-snug">
                                            管理员权限：可用“/stop”终止本轮讨论链（前端也会强制停止后续@扩展）。
                                        </div>
                                    </div>
                                </div>

                                <Separator className="bg-border/40" />

                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-[11px] text-muted-foreground leading-snug">
                                        {t('groupChat.applyAclHint', { defaultValue: '保存时同步群内 A2A 白名单（建议开启）' })}
                                    </div>
                                    <Button
                                        type="button"
                                        variant={settingsApplyAcl ? 'secondary' : 'outline'}
                                        size="sm"
                                        className="h-9 rounded-lg"
                                        onClick={() => setSettingsApplyAcl((v) => !v)}
                                    >
                                        {settingsApplyAcl ? t('common.enabled', { defaultValue: '已开启' }) : t('common.disabled', { defaultValue: '已关闭' })}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        {settingsSaveError ? (
                            <div className="text-xs text-destructive">{settingsSaveError}</div>
                        ) : settingsSaveOkAt ? (
                            <div className="text-xs text-success">{t('common.saved', { defaultValue: '已保存' })}</div>
                        ) : null}

                        <div className="flex items-center gap-3">
                            <Button
                                type="button"
                                onClick={handleSaveGroup}
                                disabled={settingsSaving}
                                className="flex-1 rounded-xl h-11 font-black uppercase tracking-widest text-[11px]"
                            >
                                {settingsSaving ? t('common.saving', { defaultValue: '保存中...' }) : t('common.save', { defaultValue: '保存修改' })}
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={() => setPendingDeleteGroup(true)}
                                disabled={deleteGroupBusy}
                                className="rounded-xl h-11"
                            >
                                {deleteGroupBusy ? '删除中...' : '删除群组'}
                            </Button>
                        </div>
                        {deleteGroupError ? (
                            <div className="text-xs text-destructive">{deleteGroupError}</div>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>

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

            <Dialog open={pendingDeleteGroup} onOpenChange={(open) => !open && setPendingDeleteGroup(false)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>删除群组</DialogTitle>
                        <DialogDescription>
                            确定要删除群组「{group?.name ?? ''}」吗？删除后群成员关系、群信息以及群内所有聊天记录都会被清空，且不可恢复。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setPendingDeleteGroup(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button type="button" variant="destructive" onClick={handleConfirmDeleteGroup} disabled={deleteGroupBusy}>
                            {deleteGroupBusy ? '删除中...' : '确认删除'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
