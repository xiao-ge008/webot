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
import { DEFAULT_GROUP_LIMITS, type ChatGroup, type ChatGroupLimits, type ChatGroupMode } from '@/types/group';
import type { Agent } from '@/types';
import { AtSign, Plus, Search, Settings, Users, X } from 'lucide-react';

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
        if (out.length >= 12) break;
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
    const [targetSelectError, setTargetSelectError] = useState('');
    const [sessionKeyword, setSessionKeyword] = useState('');
    const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);

    const runtimeKey = useMemo(() => (group ? `group:${group.groupId}` : ''), [group]);
    const sessionLabel = useMemo(() => (group ? buildGroupSessionLabel(group.groupId) : ''), [group]);

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

    const groupMembers = useMemo(() => {
        if (!group) return [] as Agent[];
        return group.memberAgentIds.map((agentId) => memberDirectory.get(agentId) ?? buildFallbackMember(agentId));
    }, [group, memberDirectory]);

    const onlineMemberCount = useMemo(() => groupMembers.filter((m) => m.status === 'online' || m.status === 'busy').length, [groupMembers]);
    const mentionDirectory = useMemo(() => buildMentionDirectory(groupMembers), [groupMembers]);

    const speaker = useMemo(() => {
        if (!group) return null;
        const preferred = selectedSpeakerId || group.leaderAgentId;
        return memberDirectory.get(preferred) ?? buildFallbackMember(preferred);
    }, [group, memberDirectory, selectedSpeakerId]);

    const idleAutoLeader = useMemo(() => {
        if (!group) return undefined;
        return memberDirectory.get(group.leaderAgentId) ?? buildFallbackMember(group.leaderAgentId);
    }, [group, memberDirectory]);

    const idleAutoConfig = useMemo(() => {
        if (!group) {
            return { enabled: false } as const;
        }
        return {
            enabled: true,
            scope: 'group' as const,
            scopeId: group.groupId,
            idleMs: 60_000,
            maxPerPage: 2,
            maxPerDay: 1,
            cooldownMs: 600_000,
            agentOverride: idleAutoLeader,
        };
    }, [group, idleAutoLeader]);

    const speakerId = speaker?.id ?? '';
    const speakerRef = useRef(speakerId);
    speakerRef.current = speakerId;
    const lastSpeakerIdRef = useRef<string>('');
    const groupMode = group?.groupMode ?? 'leader_dispatch';
    const groupLimits = useMemo(
        () => ({ ...DEFAULT_GROUP_LIMITS, ...(group?.limits ?? {}) }),
        [group],
    );
    const maxTalkTargets = Math.max(1, groupLimits.maxMentions);

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
        const session: StoredChatSession = {
            id: generateId(),
            title: t('groupChat.defaultSessionTitle', { defaultValue: '群聊' }),
            updatedAt: nowMs,
            messages: [introMessage, ...buildInitialMessages(speakerRef.current || '')],
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
                const isLegacySeed = (session: StoredChatSession): boolean => {
                    if (session.messages.length !== 1) return false;
                    const only = session.messages[0];
                    if (only.role !== 'system') return false;
                    const text = only.text || '';
                    return text.includes('欢迎来到') && (text.includes('群组') || text.includes('群聊'));
                };

                const shouldDropLegacySeeds = loaded.sessions.length === 2 && loaded.sessions.every(isLegacySeed);
                if (!shouldDropLegacySeeds) {
                    return loaded;
                }
            }
            return {
                sessions: initialState.sessions,
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
                const rows = await listManagementAgents();
                if (cancelled) return;
                const mapped = rows.map(mapManagementAgentToUi);
                const next = new Map<string, Agent>();
                for (const agent of mapped) {
                    next.set(agent.id, agent);
                }
                setMemberDirectory(next);
            } catch {
                // ignore directory failures; fallback members still work
            } finally {
                if (!cancelled) setDirectoryLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [group]);

    const handleCreateSession = () => {
        if (!runtimeKey) return;
        const nextId = generateId();
        chatRuntimeStore.updateSessions(runtimeKey, (prev) => {
            const index = prev.length + 1;
            const session: StoredChatSession = {
                id: nextId,
                title: t('chat.newSessionAutoTitle', { index, defaultValue: `新对话 ${index}` }),
                updatedAt: Date.now(),
                messages: buildInitialMessages(speakerRef.current || ''),
                autoTitle: true,
                streamState: 'idle',
            };
            return [session, ...prev];
        });
        chatRuntimeStore.setActiveSessionId(runtimeKey, nextId);
    };

    const handleSelectSession = (sessionId: string) => {
        if (!runtimeKey) return;
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
            if (base.length >= maxTalkTargets) {
                setTargetSelectError(`每轮最多选择 ${maxTalkTargets} 位成员`);
                return base;
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
            const maxExtra = Math.max(0, groupLimits.maxSpeakers - 1);
            if (maxExtra <= 0) return [];

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
                    if (targets.length >= maxExtra) break;
                }
                if (targets.length > 0) {
                    return targets;
                }
            }

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
    }, [extraReplyAgents, group, groupLimits.maxSpeakers, groupMembers, groupMode, mentionDirectory, selectedTargetIds, speakerId]);

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
            '规则：需要对方接棒时才@；@时把要做的事写清楚；若你@别人来答，请闭麦不要继续输出正文。',
            '终止：当用户说“停止/终止/暂停讨论/闭麦”或点击「终止输出」时，停止继续@与扩展讨论。',
            `限制：一次最多@${maxTalkTargets}人；自动讨论链最大深度${groupLimits.mentionMaxDepth}。`,
        ].join('\n');
        const runtimeHint = [
            '[system:group-chat-runtime]',
            `当前主回复者: ${speaker?.name ?? speakerId} (id=${speakerId || 'unknown'})`,
            selectedTargetNames.length > 0 ? `本次@对象: ${selectedTargetNames.map((name) => `@${name}`).join(' ')}` : '本次未指定@对象：由主持人按秩序决定是否点名接棒。',
            `当前群聊模式: ${groupMode === 'free_talk' ? '自由发言（相关者可主动回应）' : '主持人调度（未@仅主持人回应）'}`,
            `阈值：每轮最多 ${groupLimits.maxSpeakers} 人发言，冷却 ${Math.round(groupLimits.cooldownMs / 1000)} 秒，重复抑制阈值 ${groupLimits.duplicateThreshold}`,
            '注意：这是群聊公开消息，你的回复应让群内所有成员都能理解与跟进。',
            selectedLines.length > 0 ? '群成员（可互相委派 A2A，仅限群内白名单）:' : '',
            selectedLines.length > 0 ? selectedLines.join('\n') : '',
        ].filter(Boolean).join('\n');
        const sharedContext = activeSession ? buildGroupSharedContext(activeSession.messages, 14) : '';
        return [group.systemPrompt, dispatchHint, runtimeHint, sharedContext].filter(Boolean).join('\n\n');
    }, [activeSession, group, groupLimits, groupMode, maxTalkTargets, memberDirectory, selectedTargetNames, speaker, speakerId]);

    const inputToolbar = useMemo(() => {
        if (!group) return null;
        return (
            <div className="flex items-start gap-2">
                <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    <AtSign className="w-3.5 h-3.5" />
                    {t('groupChat.talkTo', { defaultValue: '对话对象' })}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto pr-1">
                        <button
                            type="button"
                            onClick={() => {
                                setTargetSelectError('');
                                setSelectedTargetIds([]);
                                setSelectedSpeakerId(group.leaderAgentId);
                            }}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold transition-all border',
                                selectedTargetIds.length === 0
                                    ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/15'
                                    : 'bg-background/60 text-muted-foreground border-border/60 hover:bg-muted/50 hover:text-foreground',
                            )}
                            title="不指定@对象（主持人调度）"
                        >
                            <span className="max-w-[120px] truncate">自动分工</span>
                        </button>
                        {groupMembers.map((m) => {
                            const selected = selectedTargetIds.includes(m.id);
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => toggleTarget(m.id)}
                                    className={cn(
                                        'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold transition-all border',
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
                    {targetSelectError ? (
                        <div className="mt-1 text-[10px] font-bold text-destructive/90">{targetSelectError}</div>
                    ) : null}
                </div>
                <div className="text-[10px] text-muted-foreground/70 font-medium shrink-0">
                    {t('groupChat.talkToHint', { defaultValue: `可多选（最多${maxTalkTargets}位），在群里@TA们发起对话` })}
                </div>
            </div>
        );
    }, [group, groupMembers, selectedTargetIds, t, targetSelectError, maxTalkTargets]);

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
            setGroup(updated);
            setSettingsMemberIds(updated.memberAgentIds);
            setSettingsAdminIds((updated.adminAgentIds?.length ? updated.adminAgentIds : [updated.leaderAgentId]).filter(Boolean));
            setSettingsMode(updated.groupMode ?? 'leader_dispatch');
            setSettingsLimits(updated.limits ?? DEFAULT_GROUP_LIMITS);
            setSelectedTargetIds((prev) => prev.filter((id) => updated.memberAgentIds.includes(id)));
            setSelectedSpeakerId((prev) => (updated.memberAgentIds.includes(prev) ? prev : updated.leaderAgentId));
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

                {/* 聊天区域 */}
                <div className="flex-1 min-h-0 flex">
                        <ChatPage
                            agentId={selectedTargetIds.length ? (speakerId || group.leaderAgentId) : group.leaderAgentId}
                            runtimeKey={runtimeKey}
                            fixedSessionTitle={group.name}
                            sessionLabel={sessionLabel}
                            systemPreamble={dynamicSystemPreamble}
                            groupUpgradeEnabled={false}
                            uiVariant="embedded"
                        inputToolbar={inputToolbar}
                        idleAuto={idleAutoConfig}
                        extraReplyAgents={extraReplyAgents}
                        selectExtraReplyAgents={selectExtraReplyAgents}
                        mentionDispatchAgents={groupMembers}
                        mentionDispatchMaxTargets={maxTalkTargets}
                        mentionDispatchMaxDepth={groupLimits.mentionMaxDepth}
                        maxRespondersPerUserTurn={groupLimits.maxSpeakers}
                        agentCooldownMs={groupLimits.cooldownMs}
                        duplicateSuppressionThreshold={groupLimits.duplicateThreshold}
                        stopAuthorityAgentIds={[group.leaderAgentId, ...(group.adminAgentIds ?? [])].filter(Boolean)}
                        transformUserMessage={transformUserMessage}
                    />
                </div>
            </div>

            {/* 3) 右栏：立绘 → 成员头像 → 群信息 → 群设置（对齐私聊风格） */}
            <div className="chat-info-sidebar">
                <div className="chat-info-panel">
                    {speaker?.portraitUrl ? (
                        <div className="chat-info-portrait-card">
                            <img
                                src={speaker.portraitUrl}
                                alt={`${speaker.name} portrait`}
                                className="chat-info-portrait-img"
                            />
                        </div>
                    ) : (
                        <div className="chat-info-portrait-placeholder">
                            <AgentAvatar
                                name={speaker?.name ?? speakerId}
                                avatarUrl={speaker?.avatarUrl}
                                color={speaker?.color}
                                size="xl"
                                className="chat-info-portrait-fallback-avatar"
                            />
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
                                                if (base.length >= maxTalkTargets) {
                                                    return [m.id];
                                                }
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
                                        每轮最多 {settingsLimits.maxSpeakers} 人，单人冷却 {Math.round(settingsLimits.cooldownMs / 1000)} 秒，重复抑制 {settingsLimits.duplicateThreshold}，@上限 {settingsLimits.maxMentions}，链深度 {settingsLimits.mentionMaxDepth}
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
