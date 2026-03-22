import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bot, ChevronDown, ChevronRight, Files, Loader2, Save, Sparkles, Trash2, User, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { chatRuntimeStore, useChatRuntimeSelector } from '@/services/chat-runtime-store';
import type { StoredChatSession } from '@/services/chat-session-store';
import { deleteAgentSession, sendAgentChat, updateAgentSessionContent } from '@/services/agent-client';
import type { EditableAgentSessionMessage } from '@/services/agent-client';
import { getChatGroup } from '@/services/group-client';
import { getManagementAgentDetail, listManagementAgents } from '@/services/management-client';
import { CHAT_CHANNELS, CHAT_RENDER_MODES } from '@/main/types';
import type { Message } from '@/data/mock-chats';
import type { GroupMemoryDigest } from '@/types/group';
import { isHiddenSystemPromptText } from '@/lib/chat-message-filter';
import { cn } from '@/lib/utils';

type ContextManagerMode = 'private' | 'group';

interface MessageDraft {
  id: string;
  role: Message['role'];
  title: string;
  subtitle: string;
  content: string;
}

interface AgentDigestDraft {
  agentId: string;
  name: string;
  summary: string;
  ownRecentLine: string;
  mentionLine: string;
  todoLine: string;
}

function normalizeText(raw: string): string {
  return raw.replace(/\r\n/g, '\n');
}

function messageRoleLabel(role: Message['role']): string {
  if (role === 'user') return '用户';
  if (role === 'agent') return '智能体';
  return '系统';
}

function buildMessageContextText(message: Message, overrideText?: string): string {
  const baseText = normalizeText((overrideText ?? message.text ?? '').trim());
  const sections: string[] = [];
  if (baseText) {
    sections.push(baseText);
  }
  if (message.attachments?.length) {
    sections.push([
      '附件记录：',
      ...message.attachments.map((attachment, index) => {
        const parts = [
          `${index + 1}. ${attachment.kind === 'image' ? '图片' : '附件'}：${attachment.name}`,
          `相对路径：${attachment.relativePath}`,
        ];
        if (attachment.savedPath?.trim()) {
          parts.push(`绝对路径：${attachment.savedPath.trim()}`);
        }
        return parts.join(' / ');
      }),
    ].join('\n'));
  }
  if (message.taskCard?.objective) {
    sections.push(`任务目标：${message.taskCard.objective}`);
  }
  if (message.taskCard?.taskName) {
    sections.push(`任务名称：${message.taskCard.taskName}`);
  }
  if (message.taskCard?.finalSummaryText) {
    sections.push(`任务最终总结：${message.taskCard.finalSummaryText}`);
  }
  if (message.a2aCards?.length) {
    sections.push([
      '协作卡片：',
      ...message.a2aCards.map((card, index) => `${index + 1}. ${card.agentName || card.agentId || '成员'} / ${card.summary || card.finalReportText || '无摘要'}`),
    ].join('\n'));
  }
  return sections.filter(Boolean).join('\n\n').trim();
}

function buildMessageDrafts(messages: readonly Message[]): MessageDraft[] {
  return messages
    .filter((message) => !isHiddenSystemPromptText(message.text || ''))
    .map((message) => ({
      id: message.id,
      role: message.role,
      title: message.role === 'agent'
        ? (message.agentName || message.agentId || '智能体')
        : messageRoleLabel(message.role),
      subtitle: message.timestamp ? new Date(message.timestamp).toLocaleString() : '无时间',
      content: buildMessageContextText(message),
    }))
    .filter((draft) => draft.content.trim().length > 0);
}

function buildEditableRemoteMessages(messages: readonly Message[], drafts: readonly MessageDraft[]): EditableAgentSessionMessage[] {
  const draftMap = new Map(drafts.map((item) => [item.id, item]));
  return messages
    .filter((message) => !isHiddenSystemPromptText(message.text || ''))
    .map((message) => {
      const draft = draftMap.get(message.id);
      const content = (draft?.content ?? buildMessageContextText(message)).trim();
      if (!content) {
        return null;
      }
      return {
        role: message.role === 'agent' ? 'assistant' : message.role,
        content,
      } satisfies EditableAgentSessionMessage;
    })
    .filter((item): item is EditableAgentSessionMessage => item != null);
}

function parseJsonPayload<T>(raw: string): T | null {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function createCompressionSessionLabel(agentId: string): string {
  const base = agentId.trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'agent';
  return `ctxcompress_${base}_${Date.now().toString(36)}`;
}

function buildCompressionMessageLines(messageDrafts: readonly MessageDraft[]): string[] {
  return messageDrafts
    .filter((item) => item.role !== 'system')
    .map((item) => {
      const content = item.content.trim();
      if (!content) {
        return '';
      }
      return `${messageRoleLabel(item.role)} ${item.title}：\n${content}`;
    })
    .filter(Boolean);
}

function buildPrivateCompressionSource(params: {
  summary: string;
  intent: string;
  messageDrafts: readonly MessageDraft[];
}): string {
  const sections: string[] = [];
  const summary = params.summary.trim();
  const intent = params.intent.trim();
  const messageLines = buildCompressionMessageLines(params.messageDrafts);

  if (summary) {
    sections.push(`当前聊天摘要：\n${summary}`);
  }
  if (intent) {
    sections.push(`当前诉求：\n${intent}`);
  }
  if (messageLines.length > 0) {
    sections.push(`聊天记录上下文：\n${messageLines.join('\n\n')}`);
  }

  return sections.join('\n\n');
}

function buildGroupCompressionSource(params: {
  groupSummary: string;
  groupGoal: string;
  groupDecisions: string;
  groupOpenQuestions: string;
  groupPendingLine: string;
  groupSpeakerLine: string;
  agentDigestDrafts: readonly AgentDigestDraft[];
  messageDrafts: readonly MessageDraft[];
}): string {
  const sections: string[] = [];
  const groupSummary = params.groupSummary.trim();
  const groupGoal = params.groupGoal.trim();
  const decisions = params.groupDecisions
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean);
  const openQuestions = params.groupOpenQuestions
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean);
  const pendingLine = params.groupPendingLine.trim();
  const speakerLine = params.groupSpeakerLine.trim();
  const memberSections = params.agentDigestDrafts
    .map((digest) => {
      const rows = [
        digest.summary.trim() ? `摘要：${digest.summary.trim()}` : '',
        digest.ownRecentLine.trim() ? `近期输出：${digest.ownRecentLine.trim()}` : '',
        digest.mentionLine.trim() ? `提及上下文：${digest.mentionLine.trim()}` : '',
        digest.todoLine.trim() ? `待办：${digest.todoLine.trim()}` : '',
      ].filter(Boolean);
      if (rows.length === 0) {
        return '';
      }
      return `${digest.name}（${digest.agentId}）：\n${rows.join('\n')}`;
    })
    .filter(Boolean);
  const messageLines = buildCompressionMessageLines(params.messageDrafts);

  if (groupSummary) {
    sections.push(`当前公开摘要：\n${groupSummary}`);
  }
  if (groupGoal) {
    sections.push(`当前目标：\n${groupGoal}`);
  }
  if (decisions.length > 0) {
    sections.push(`已确认结论：\n${decisions.map((row, index) => `${index + 1}. ${row}`).join('\n')}`);
  }
  if (openQuestions.length > 0) {
    sections.push(`待处理问题：\n${openQuestions.map((row, index) => `${index + 1}. ${row}`).join('\n')}`);
  }
  if (pendingLine) {
    sections.push(`当前队列：\n${pendingLine}`);
  }
  if (speakerLine) {
    sections.push(`近期结论线：\n${speakerLine}`);
  }
  if (memberSections.length > 0) {
    sections.push(`成员专属上下文：\n${memberSections.join('\n\n')}`);
  }
  if (messageLines.length > 0) {
    sections.push(`聊天记录上下文：\n${messageLines.join('\n\n')}`);
  }

  return sections.join('\n\n');
}

export function ContextManagerPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const rawId = (params.id || '').trim();
  const rawRuntimeKey = (searchParams.get('runtimeKey') || '').trim();
  const rawSessionOwnerAgentId = (searchParams.get('sessionOwnerAgentId') || '').trim();
  const requestedSessionId = (searchParams.get('sessionId') || '').trim();
  const mode: ContextManagerMode = window.location.pathname.includes('/group-chat/') ? 'group' : 'private';
  const runtimeAgentId = mode === 'group' ? (rawRuntimeKey || `group:${rawId}`) : rawId;
  const sessionOwnerAgentId = mode === 'group' ? (rawSessionOwnerAgentId || rawId) : rawId;

  const runtimeSessions = useChatRuntimeSelector(runtimeAgentId, (state) => state.sessions);
  const activeRuntimeSessionId = useChatRuntimeSelector(runtimeAgentId, (state) => state.activeSessionId);
  const selectedSessionId = requestedSessionId || activeRuntimeSessionId;
  const session = useMemo(
    () => runtimeSessions.find((item) => item.id === selectedSessionId) ?? null,
    [runtimeSessions, selectedSessionId],
  );

  const [systemPrompt, setSystemPrompt] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupMemberNames, setGroupMemberNames] = useState<Record<string, string>>({});
  const [messageDrafts, setMessageDrafts] = useState<MessageDraft[]>([]);
  const [privateSummary, setPrivateSummary] = useState('');
  const [privateIntent, setPrivateIntent] = useState('');
  const [groupSummary, setGroupSummary] = useState('');
  const [groupGoal, setGroupGoal] = useState('');
  const [groupDecisions, setGroupDecisions] = useState('');
  const [groupOpenQuestions, setGroupOpenQuestions] = useState('');
  const [groupPendingLine, setGroupPendingLine] = useState('');
  const [groupSpeakerLine, setGroupSpeakerLine] = useState('');
  const [agentDigestDrafts, setAgentDigestDrafts] = useState<AgentDigestDraft[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [compressBusy, setCompressBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [systemExpanded, setSystemExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingMeta(true);
    setErrorText('');
    void (async () => {
      try {
        if (mode === 'group') {
          const [group, agents] = await Promise.all([
            getChatGroup(rawId),
            listManagementAgents(),
          ]);
          if (cancelled) return;
          setSystemPrompt(group.systemPrompt || '');
          setGroupName(group.name);
          setGroupMemberNames(Object.fromEntries(agents.map((agent) => [agent.id, agent.name])));
        } else {
          const detail = await getManagementAgentDetail(rawId);
          if (cancelled) return;
          setSystemPrompt(detail.system_prompt || '');
          setGroupName('');
          setGroupMemberNames({});
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '读取上下文元信息失败');
        }
      } finally {
        if (!cancelled) {
          setLoadingMeta(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, rawId]);

  useEffect(() => {
    if (!session) {
      setMessageDrafts([]);
      setPrivateSummary('');
      setPrivateIntent('');
      setGroupSummary('');
      setGroupGoal('');
      setGroupDecisions('');
      setGroupOpenQuestions('');
      setGroupPendingLine('');
      setGroupSpeakerLine('');
      setAgentDigestDrafts([]);
      return;
    }

    setMessageDrafts(buildMessageDrafts(session.messages));
    setPrivateSummary(session.contextDigest?.summary ?? '');
    setPrivateIntent(session.contextDigest?.lastUserIntent ?? '');
    const memoryDigest = session.groupRuntime?.memoryDigest;
    setGroupSummary(memoryDigest?.summary ?? '');
    setGroupGoal(memoryDigest?.goal ?? '');
    setGroupDecisions((memoryDigest?.decisions ?? []).join('\n'));
    setGroupOpenQuestions((memoryDigest?.openQuestions ?? []).join('\n'));
    setGroupPendingLine(memoryDigest?.pendingLine ?? '');
    setGroupSpeakerLine(memoryDigest?.speakerLine ?? '');
    setAgentDigestDrafts(Object.entries(session.groupRuntime?.agentContextDigests ?? {}).map(([agentId, digest]) => ({
      agentId,
      name: groupMemberNames[agentId] || agentId,
      summary: digest.summary ?? '',
      ownRecentLine: digest.ownRecentLine ?? '',
      mentionLine: digest.mentionLine ?? '',
      todoLine: digest.todoLine ?? '',
    })));
  }, [groupMemberNames, session]);

  const persistSummaryState = (
    targetSession: StoredChatSession,
    options: {
      nextPrivateDigest?: { summary?: string; lastUserIntent?: string };
      nextGroupDigest?: Partial<GroupMemoryDigest> | null;
      nextAgentDigests?: AgentDigestDraft[];
    },
  ) => {
    const nextPrivateDigest = options.nextPrivateDigest;
    const nextGroupDigest = options.nextGroupDigest;
    const nextAgentDigests = options.nextAgentDigests;

    chatRuntimeStore.updateSessions(runtimeAgentId, (prev) => prev.map((item) => {
      if (item.id !== targetSession.id) {
        return item;
      }

      let nextItem: StoredChatSession = { ...item };
      if (mode === 'private' && nextPrivateDigest) {
        nextItem = {
          ...nextItem,
          updatedAt: Date.now(),
          contextDigest: nextPrivateDigest.summary?.trim()
            ? {
                summary: normalizeText(nextPrivateDigest.summary.trim()),
                lastUserIntent: nextPrivateDigest.lastUserIntent?.trim() || undefined,
                updatedAt: new Date().toISOString(),
              }
            : undefined,
          contextDigestManual: true,
        };
      }

      if (mode === 'group') {
        const currentRuntime = nextItem.groupRuntime;
        const manualIds = new Set(currentRuntime?.agentContextDigestsManualIds ?? []);
        let nextMemoryDigest = currentRuntime?.memoryDigest;
        let nextMemoryDigestManual = currentRuntime?.memoryDigestManual === true;
        let nextAgentDigestMap = currentRuntime?.agentContextDigests
          ? { ...currentRuntime.agentContextDigests }
          : undefined;

        if (nextGroupDigest !== undefined) {
          nextMemoryDigest = nextGroupDigest?.summary?.trim()
            ? {
                summary: nextGroupDigest.summary.trim(),
                goal: nextGroupDigest.goal?.trim() || undefined,
                decisions: nextGroupDigest.decisions?.filter((row) => row.trim().length > 0),
                openQuestions: nextGroupDigest.openQuestions?.filter((row) => row.trim().length > 0),
                pendingLine: nextGroupDigest.pendingLine?.trim() || undefined,
                speakerLine: nextGroupDigest.speakerLine?.trim() || undefined,
                lastUserIntent: nextGroupDigest.lastUserIntent?.trim() || undefined,
                updatedAt: new Date().toISOString(),
              }
            : undefined;
          nextMemoryDigestManual = nextGroupDigest != null ? true : nextMemoryDigestManual;
        }

        if (nextAgentDigests) {
          const nextAgentIds = new Set(nextAgentDigests.map((digest) => digest.agentId));
          const rebuiltDigests: NonNullable<StoredChatSession['groupRuntime']>['agentContextDigests'] = {};
          for (const agentId of Object.keys(currentRuntime?.agentContextDigests ?? {})) {
            if (!nextAgentIds.has(agentId)) {
              manualIds.add(agentId);
            }
          }
          for (const digest of nextAgentDigests) {
            manualIds.add(digest.agentId);
            const hasMeaningful = [
              digest.summary,
              digest.ownRecentLine,
              digest.mentionLine,
              digest.todoLine,
            ].some((value) => value.trim().length > 0);
            if (!hasMeaningful) {
              continue;
            }
            rebuiltDigests[digest.agentId] = {
              agentId: digest.agentId,
              summary: digest.summary.trim(),
              ownRecentLine: digest.ownRecentLine.trim() || undefined,
              mentionLine: digest.mentionLine.trim() || undefined,
              todoLine: digest.todoLine.trim() || undefined,
              updatedAt: new Date().toISOString(),
            };
          }
          nextAgentDigestMap = Object.keys(rebuiltDigests).length > 0 ? rebuiltDigests : undefined;
        }

        nextItem = {
          ...nextItem,
          updatedAt: Date.now(),
          groupRuntime: {
            ...(currentRuntime ?? {
              version: '1.0',
              status: 'idle',
              queueVersion: 0,
              queue: [],
              stopRequested: false,
            }),
            memoryDigest: nextMemoryDigest,
            memoryDigestManual: nextMemoryDigestManual,
            agentContextDigests: nextAgentDigestMap,
            agentContextDigestsManualIds: manualIds.size > 0 ? Array.from(manualIds) : undefined,
          },
        };
      }

      return nextItem;
    }));
  };

  const pageTitle = mode === 'group' ? `群上下文管理${groupName ? ` · ${groupName}` : ''}` : '上下文管理';
  const systemTitle = mode === 'group' ? '群系统提示词' : '系统提示词';
  const messageCount = messageDrafts.length;
  const messageRoleStats = useMemo(() => ({
    user: messageDrafts.filter((item) => item.role === 'user').length,
    agent: messageDrafts.filter((item) => item.role === 'agent').length,
    system: messageDrafts.filter((item) => item.role === 'system').length,
  }), [messageDrafts]);

  const handleSave = async () => {
    if (!session || saveBusy) {
      return;
    }
    setSaveBusy(true);
    setStatusText('');
    setErrorText('');

    try {
      const draftMap = new Map(messageDrafts.map((item) => [item.id, item]));
      const nextMessages = session.messages
        .filter((message) => !isHiddenSystemPromptText(message.text || ''))
        .map((message) => {
          const draft = draftMap.get(message.id);
          if (!draft) {
            return null;
          }
          const nextText = normalizeText(draft.content.trim());
          if (!nextText) {
            return null;
          }
          return {
            ...message,
            text: nextText,
          };
        })
        .filter((item): item is Message => item != null);

      const remoteMessages = buildEditableRemoteMessages(nextMessages, messageDrafts);
      const updateResult = await updateAgentSessionContent({
        agentId: sessionOwnerAgentId,
        sessionId: session.remoteSessionId,
        sessionLabel: session.sessionLabel,
        messages: remoteMessages,
      });
      if (!updateResult.success) {
        throw new Error(updateResult.message || '会话记录保存失败');
      }

      chatRuntimeStore.updateSessions(runtimeAgentId, (prev) => prev.map((item) => (
        item.id === session.id
          ? {
              ...item,
              messages: nextMessages,
              updatedAt: Date.now(),
            }
          : item
      )));

      persistSummaryState(session, mode === 'private'
        ? {
            nextPrivateDigest: {
              summary: privateSummary,
              lastUserIntent: privateIntent,
            },
          }
        : {
            nextGroupDigest: {
              summary: groupSummary,
              goal: groupGoal,
              decisions: groupDecisions.split('\n').map((row) => row.trim()).filter(Boolean),
              openQuestions: groupOpenQuestions.split('\n').map((row) => row.trim()).filter(Boolean),
              pendingLine: groupPendingLine,
              speakerLine: groupSpeakerLine,
              lastUserIntent: groupGoal,
            },
            nextAgentDigests: agentDigestDrafts,
          });

      setStatusText('上下文已保存，后续对话会按新的内容生效。');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaveBusy(false);
    }
  };

  const handleSmartCompress = async () => {
    if (!session || compressBusy) {
      return;
    }
    setCompressBusy(true);
    setStatusText('');
    setErrorText('');
    const tempSessionLabel = createCompressionSessionLabel(sessionOwnerAgentId);

    try {
      const compressionSource = mode === 'group'
        ? buildGroupCompressionSource({
            groupSummary,
            groupGoal,
            groupDecisions,
            groupOpenQuestions,
            groupPendingLine,
            groupSpeakerLine,
            agentDigestDrafts,
            messageDrafts,
          })
        : buildPrivateCompressionSource({
            summary: privateSummary,
            intent: privateIntent,
            messageDrafts,
          });

      if (!compressionSource.trim()) {
        throw new Error('当前没有可压缩的聊天上下文');
      }

      const prompt = mode === 'group'
        ? [
            '你现在只负责压缩群聊上下文，不要继续聊天，不要输出 Markdown，不要解释。',
            '输入里包含现有公开摘要、成员专属上下文和聊天记录，它们都属于可压缩对象。',
            '请基于下面的群聊公开上下文，输出一个 JSON 对象，字段固定为：',
            '{"summary":"","goal":"","decisions":[],"openQuestions":[],"pendingLine":"","speakerLine":""}',
            '要求：summary 控制在 220 字以内；decisions 和 openQuestions 最多各 5 条；不要编造不存在的结论。',
            '',
            '群聊上下文：',
            compressionSource,
          ].join('\n')
        : [
            '你现在只负责压缩私聊上下文，不要继续聊天，不要输出 Markdown，不要解释。',
            '输入里包含现有摘要、诉求和聊天记录，它们都属于可压缩对象。',
            '请基于下面的上下文，输出一个 JSON 对象，字段固定为：',
            '{"summary":"", "lastUserIntent":""}',
            '要求：summary 控制在 220 字以内；lastUserIntent 控制在 80 字以内；不要编造不存在的信息。',
            '',
            '对话上下文：',
            compressionSource,
          ].join('\n');

      const result = await sendAgentChat({
        agentId: sessionOwnerAgentId,
        message: prompt,
        sessionLabel: tempSessionLabel,
        channel: CHAT_CHANNELS.task,
        renderMode: CHAT_RENDER_MODES.plainText,
      });

      if (!result.success) {
        throw new Error(result.error || '智能压缩失败');
      }

      if (mode === 'group') {
        const parsed = parseJsonPayload<{
          summary?: string;
          goal?: string;
          decisions?: string[];
          openQuestions?: string[];
          pendingLine?: string;
          speakerLine?: string;
        }>(result.text || result.content || '');
        if (!parsed?.summary?.trim()) {
          throw new Error('智能压缩返回格式无效');
        }
        setGroupSummary(parsed.summary.trim());
        setGroupGoal((parsed.goal || '').trim());
        setGroupDecisions((parsed.decisions ?? []).join('\n'));
        setGroupOpenQuestions((parsed.openQuestions ?? []).join('\n'));
        setGroupPendingLine((parsed.pendingLine || '').trim());
        setGroupSpeakerLine((parsed.speakerLine || '').trim());
        persistSummaryState(session, {
          nextGroupDigest: {
            summary: parsed.summary.trim(),
            goal: (parsed.goal || '').trim() || undefined,
            decisions: (parsed.decisions ?? []).map((row) => row.trim()).filter(Boolean),
            openQuestions: (parsed.openQuestions ?? []).map((row) => row.trim()).filter(Boolean),
            pendingLine: (parsed.pendingLine || '').trim() || undefined,
            speakerLine: (parsed.speakerLine || '').trim() || undefined,
            lastUserIntent: (parsed.goal || '').trim() || undefined,
          },
        });
      } else {
        const parsed = parseJsonPayload<{ summary?: string; lastUserIntent?: string }>(result.text || result.content || '');
        if (!parsed?.summary?.trim()) {
          throw new Error('智能压缩返回格式无效');
        }
        setPrivateSummary(parsed.summary.trim());
        setPrivateIntent((parsed.lastUserIntent || '').trim());
        persistSummaryState(session, {
          nextPrivateDigest: {
            summary: parsed.summary.trim(),
            lastUserIntent: (parsed.lastUserIntent || '').trim(),
          },
        });
      }

      setStatusText('智能压缩完成，新的摘要已经写入当前上下文。');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '智能压缩失败');
    } finally {
      void deleteAgentSession({
        agentId: sessionOwnerAgentId,
        sessionLabel: tempSessionLabel,
      }).catch(() => undefined);
      setCompressBusy(false);
    }
  };

  if (!rawId) {
    return (
      <div className="min-h-screen bg-background px-6 py-10">
        <div className="mx-auto max-w-4xl text-sm text-destructive">上下文管理页缺少目标 ID。</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(32,129,226,0.10),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.10),transparent_32%),var(--background)] px-4 py-6 md:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/85 px-4 py-4 shadow-sm backdrop-blur">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">{pageTitle}</h1>
                <Badge variant="secondary" className="rounded-full px-2.5 py-0.5">
                  {mode === 'group' ? '群聊' : '私聊'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                系统提示词只读；聊天摘要、群上下文和聊天记录都可以在这里直接编辑、删除和压缩。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="rounded-full px-2.5 py-1">记录 {messageCount}</Badge>
            <Badge variant="outline" className="rounded-full px-2.5 py-1">用户 {messageRoleStats.user}</Badge>
            <Badge variant="outline" className="rounded-full px-2.5 py-1">智能体 {messageRoleStats.agent}</Badge>
            <Badge variant="outline" className="rounded-full px-2.5 py-1">系统 {messageRoleStats.system}</Badge>
          </div>
        </div>

        {statusText ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
            {statusText}
          </div>
        ) : null}
        {errorText ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorText}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
          <div className="space-y-4">
            <Card className="rounded-3xl border-border/60 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Files className="h-4 w-4" />
                    {systemTitle}
                  </CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full px-3 text-xs text-muted-foreground"
                    onClick={() => setSystemExpanded((prev) => !prev)}
                  >
                    {systemExpanded ? <ChevronDown className="mr-1 h-4 w-4" /> : <ChevronRight className="mr-1 h-4 w-4" />}
                    {systemExpanded ? '收起' : '展开'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700">
                  这是内置系统级上下文，可查看但不能修改或删除。
                </div>
                {systemExpanded ? (
                  <>
                    <Textarea
                      value={systemPrompt}
                      readOnly
                      className="min-h-[240px] resize-y rounded-2xl border-border/60 bg-muted/20 text-sm leading-6"
                    />
                    {loadingMeta ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在读取系统提示词...
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/60 px-4 py-4 text-sm text-muted-foreground">
                    系统提示词已折叠，只有查看时才需要展开。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border/60 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {mode === 'group' ? <Users className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                  {mode === 'group' ? '摘要与群上下文' : '聊天摘要'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {mode === 'group' ? (
                  <>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">公开摘要</div>
                      <Textarea value={groupSummary} onChange={(event) => setGroupSummary(event.target.value)} className="min-h-[140px] rounded-2xl" />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">当前目标</div>
                      <Textarea value={groupGoal} onChange={(event) => setGroupGoal(event.target.value)} className="min-h-[88px] rounded-2xl" />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-sm font-medium">已确认结论</div>
                        <Textarea value={groupDecisions} onChange={(event) => setGroupDecisions(event.target.value)} className="min-h-[140px] rounded-2xl" />
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-medium">待处理问题</div>
                        <Textarea value={groupOpenQuestions} onChange={(event) => setGroupOpenQuestions(event.target.value)} className="min-h-[140px] rounded-2xl" />
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-sm font-medium">当前队列</div>
                        <Textarea value={groupPendingLine} onChange={(event) => setGroupPendingLine(event.target.value)} className="min-h-[88px] rounded-2xl" />
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-medium">近期结论线</div>
                        <Textarea value={groupSpeakerLine} onChange={(event) => setGroupSpeakerLine(event.target.value)} className="min-h-[88px] rounded-2xl" />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">当前摘要</div>
                      <Textarea value={privateSummary} onChange={(event) => setPrivateSummary(event.target.value)} className="min-h-[180px] rounded-2xl" />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">当前诉求</div>
                      <Textarea value={privateIntent} onChange={(event) => setPrivateIntent(event.target.value)} className="min-h-[88px] rounded-2xl" />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {mode === 'group' ? (
              <Card className="rounded-3xl border-border/60 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4" />
                    成员专属上下文
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {agentDigestDrafts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
                      当前群会话还没有成员专属摘要。
                    </div>
                  ) : agentDigestDrafts.map((digest, index) => (
                    <div key={digest.agentId} className="rounded-2xl border border-border/60 bg-muted/10 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <AgentAvatar name={digest.name} size="sm" />
                          <div>
                            <div className="text-sm font-semibold">{digest.name}</div>
                            <div className="text-xs text-muted-foreground">{digest.agentId}</div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full text-muted-foreground"
                          onClick={() => setAgentDigestDrafts((prev) => prev.filter((_, rowIndex) => rowIndex !== index))}
                          title="删除该成员上下文"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Textarea value={digest.summary} onChange={(event) => setAgentDigestDrafts((prev) => prev.map((item, rowIndex) => rowIndex === index ? { ...item, summary: event.target.value } : item))} className="min-h-[110px] rounded-2xl" />
                        <div className="grid gap-2 md:grid-cols-3">
                          <Textarea value={digest.ownRecentLine} onChange={(event) => setAgentDigestDrafts((prev) => prev.map((item, rowIndex) => rowIndex === index ? { ...item, ownRecentLine: event.target.value } : item))} className="min-h-[88px] rounded-2xl" placeholder="近期输出" />
                          <Textarea value={digest.mentionLine} onChange={(event) => setAgentDigestDrafts((prev) => prev.map((item, rowIndex) => rowIndex === index ? { ...item, mentionLine: event.target.value } : item))} className="min-h-[88px] rounded-2xl" placeholder="@ 提及上下文" />
                          <Textarea value={digest.todoLine} onChange={(event) => setAgentDigestDrafts((prev) => prev.map((item, rowIndex) => rowIndex === index ? { ...item, todoLine: event.target.value } : item))} className="min-h-[88px] rounded-2xl" placeholder="待办" />
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Card className="rounded-3xl border-border/60 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4" />
                聊天记录上下文
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {session ? (
                <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
                  当前会话：<span className="font-medium text-foreground">{session.title}</span>
                  {session.sessionLabel ? <span className="ml-2 text-xs">label={session.sessionLabel}</span> : null}
                </div>
              ) : null}
              {messageDrafts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                  当前会话没有可编辑的上下文记录。
                </div>
              ) : (
                messageDrafts.map((draft) => (
                  <div key={draft.id} className="rounded-2xl border border-border/60 bg-background/80 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={draft.role === 'user' ? 'default' : draft.role === 'agent' ? 'secondary' : 'outline'} className={cn('rounded-full px-2.5 py-0.5', draft.role === 'user' && 'bg-black text-white hover:bg-black')}>
                          {draft.role === 'user' ? <User className="mr-1 h-3 w-3" /> : draft.role === 'agent' ? <Bot className="mr-1 h-3 w-3" /> : <Files className="mr-1 h-3 w-3" />}
                          {messageRoleLabel(draft.role)}
                        </Badge>
                        <div>
                          <div className="text-sm font-medium">{draft.title}</div>
                          <div className="text-xs text-muted-foreground">{draft.subtitle}</div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-muted-foreground"
                        onClick={() => setMessageDrafts((prev) => prev.filter((item) => item.id !== draft.id))}
                        title="删除这条上下文"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={draft.content}
                      onChange={(event) => setMessageDrafts((prev) => prev.map((item) => item.id === draft.id ? { ...item, content: event.target.value } : item))}
                      className="min-h-[150px] rounded-2xl"
                    />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border/60 bg-background/92 px-4 py-4 shadow-lg backdrop-blur">
          <div className="text-sm text-muted-foreground">
            智能压缩会使用当前默认模型，把除系统提示词外的上下文整理成新的摘要。
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="rounded-full" onClick={handleSmartCompress} disabled={!session || compressBusy}>
              {compressBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              智能压缩
            </Button>
            <Button type="button" className="rounded-full bg-black text-white hover:bg-zinc-800" onClick={handleSave} disabled={!session || saveBusy}>
              {saveBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              保存全部
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
