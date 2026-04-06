import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { Plus, Edit2, Download, Users, ArrowRight, Clock } from 'lucide-react';
import { useHomeTab } from '@/components/layout/Header';
import type { Agent } from '@/types';
import { cn } from '@/lib/utils';
import type { Task } from '@/types/tasks';
import { listTasks } from '@/services/task-client';
import {
  listManagementAgents,
  type ManagementAgentSummary,
} from '@/services/management-client';
import { listChatGroups } from '@/services/group-client';
import type { ChatGroup } from '@/types/group';

const HIDDEN_COLLAB_TAGS = new Set(['webot:collab_discoverable', 'webot:collab_dispatcher']);

function filterCollaborationTags(tags: string[]): string[] {
  return tags.filter((tag) => !HIDDEN_COLLAB_TAGS.has(tag.trim().toLowerCase()));
}

function formatOutputTime(lastOutputAt?: string): string {
  if (!lastOutputAt) return '';
  const parsed = new Date(lastOutputAt);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function mapStateToStatus(state: string): Agent['status'] {
  const normalized = state.trim().toLowerCase();
  if (normalized.includes('busy')) {
    return 'busy';
  }
  if (normalized.includes('run') || normalized.includes('online') || normalized.includes('idle')) {
    return 'online';
  }
  return 'offline';
}

function mapSummaryToAgent(summary: ManagementAgentSummary): Agent {
  const displayName = summary.nickname?.trim() || summary.name || summary.english_name || summary.id;
  const description = summary.description.trim();
  const rawTags = Array.isArray(summary.tags) ? summary.tags : [];
  const visibleTags = filterCollaborationTags(rawTags);
  return {
    id: summary.id,
    name: displayName,
    title: displayName,
    avatarUrl: summary.identity.avatar_url,
    description: description || 'No description',
    expertise:
      visibleTags.length > 0
        ? visibleTags
        : rawTags.length === 0
          ? ['general']
          : [],
    status: mapStateToStatus(summary.state),
    personality: 'default',
    mcpTools: [],
    model: summary.model.model || 'unknown',
    createdAt: new Date().toISOString(),
    messagesCount: 0,
    color: summary.identity.color || '#64748b',
  };
}

/** 状态指示器 */
function StatusIndicator({
  agent,
}: {
  agent: Agent;
}) {
  const status = agent.status;
  const isBusy = status === 'busy';
  const isOnline = status === 'online';
  const toneClass = isBusy
    ? 'bg-warning/5 border-warning/10 text-warning'
    : isOnline
      ? 'bg-success/5 border-success/10 text-success'
      : 'bg-muted/40 border-border text-muted-foreground';
  const dotClass = isBusy ? 'bg-warning' : isOnline ? 'bg-success' : 'bg-muted-foreground/60';

  return (
    <div className={cn('flex items-center gap-2 group/indicator px-2.5 py-1.5 rounded-full border shadow-xs antialiased transition-all duration-300', toneClass)}>
      <div className={cn('w-2 h-2 rounded-full shadow-sm', dotClass, isOnline || isBusy ? 'animate-pulse' : '')} />
      {/* 移除 label，改为通过颜色和动画感知状态，如有必要可使用 tooltip */}
    </div>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const { activeTab } = useHomeTab();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [lastOutputAtMap] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksLoadError, setTasksLoadError] = useState('');
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsLoadError, setGroupsLoadError] = useState('');

  const [agentsLoading, setAgentsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // 指数退避重试：最多 4 次，间隔 1s → 2s → 4s → 8s
    const retryDelays = [1000, 2000, 4000, 8000];

    const loadAgents = async () => {
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        if (cancelled) return;
        try {
          const rows = await listManagementAgents();
          if (cancelled) return;
          if (rows.length > 0 || attempt === retryDelays.length) {
            setAgents(rows.map(mapSummaryToAgent));
            setAgentsLoading(false);
            return;
          }
          // 返回空列表也视为"引擎可能还没 ready"，继续重试
        } catch (error) {
          if (cancelled) return;
          console.warn(`[Home] 加载智能体失败 (attempt ${attempt + 1}):`, error);
          if (attempt === retryDelays.length) {
            // 最后一次还是失败，停止加载状态
            setAgentsLoading(false);
            return;
          }
        }
        // 等待后重试
        const delay = retryDelays[attempt];
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    };

    void loadAgents();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'tasks') {
      return () => {
        cancelled = true;
      };
    }

    const loadTasks = async () => {
      setTasksLoading(true);
      setTasksLoadError('');
      try {
        const rows = await listTasks('all');
        if (cancelled) return;
        setTasks(rows);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setTasks([]);
        setTasksLoadError(message);
      } finally {
        if (!cancelled) {
          setTasksLoading(false);
        }
      }
    };

    void loadTasks();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'groups') {
      return () => {
        cancelled = true;
      };
    }

    const loadGroups = async () => {
      setGroupsLoading(true);
      setGroupsLoadError('');
      try {
        const rows = await listChatGroups();
        if (cancelled) return;
        setGroups(rows);
      } catch (error) {
        if (cancelled) return;
        setGroups([]);
        setGroupsLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setGroupsLoading(false);
      }
    };

    void loadGroups();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const runningTasks = useMemo(
    () => tasks.filter((task) => task.runInfo.lastStatus === 'running' && !task.isTemplate),
    [tasks],
  );

  // 头像堆叠渲染逻辑
  const renderAvatarStack = (members: Agent[]) => {
    const limit = 5;
    const items = members.slice(0, limit);
    const extraCount = members.length - limit;

    return (
      <div className="flex -space-x-4">
        {items.map((member, i) => (
          <div
            key={`${member.id}-${i}`}
            className="relative rounded-2xl border-2 border-background z-10 hover:z-20 transition-transform hover:scale-110 shadow-[0_8px_30px_rgb(0,0,0,0.12)] bg-background"
            style={{ zIndex: 10 - i }}
          >
            <AgentAvatar name={member.name} avatarUrl={member.avatarUrl} color={member.color} size="md" className="w-12 h-12 rounded-2xl shadow-inner" />
          </div>
        ))}
        {extraCount > 0 && (
          <div
            className="w-12 h-12 rounded-2xl border-2 border-background bg-secondary flex items-center justify-center text-[10px] font-black text-muted-foreground z-0 shadow-sm relative -translate-x-2"
          >
            +{extraCount}
          </div>
        )}
      </div>
    );
  };

  const resolveGroupMembers = useMemo(() => {
    const index = new Map<string, Agent>();
    for (const agent of agents) {
      index.set(agent.id, agent);
    }
    return (group: ChatGroup): Agent[] => {
      const members: Agent[] = [];
      for (const id of group.memberAgentIds) {
        const hit = index.get(id);
        if (hit) members.push(hit);
      }
      return members;
    };
  }, [agents]);

  return (
    <div className="max-w-6xl mx-auto px-8 pt-6 pb-8 space-y-6 animate-fade-in">
      {activeTab === 'agents' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {/* 创建卡片 */}
          <Link to="/create" className="h-full">
            <Card className="group border-2 border-dashed border-muted-foreground/15 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer h-full min-h-[250px] flex flex-col items-center justify-center rounded-4xl shadow-none">
              <CardContent className="flex flex-col items-center justify-center p-5 text-center space-y-4">
                <div className="mb-4 relative">
                  <div className="absolute inset-0 rounded-3xl blur-2xl opacity-0 group-hover:opacity-20 transition-all duration-500 bg-primary" />
                  <div className="w-24 h-24 rounded-3xl bg-muted group-hover:bg-primary group-hover:text-primary-foreground text-muted-foreground flex items-center justify-center transition-all duration-300 shadow-sm group-hover:scale-110 group-hover:-translate-y-2 relative z-10">
                    <Plus className="w-9 h-9" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-black tracking-tight text-foreground group-hover:text-primary transition-colors">
                    {t('home.createCustom')}
                  </p>
                  <p className="text-[12px] text-muted-foreground opacity-70 font-medium">
                    {t('home.createCustomDesc')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* 导入卡片 */}
          <Link to="/import" className="h-full">
            <Card className="group border-2 border-dashed border-muted-foreground/15 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer h-full min-h-[250px] flex flex-col items-center justify-center rounded-4xl shadow-none">
              <CardContent className="flex flex-col items-center justify-center p-5 text-center space-y-4">
                <div className="mb-4 relative">
                  <div className="absolute inset-0 rounded-3xl blur-2xl opacity-0 group-hover:opacity-20 transition-all duration-500 bg-primary" />
                  <div className="w-24 h-24 rounded-3xl bg-muted group-hover:bg-primary group-hover:text-primary-foreground text-muted-foreground flex items-center justify-center transition-all duration-300 shadow-sm group-hover:scale-110 group-hover:-translate-y-2 relative z-10">
                    <Download className="w-9 h-9" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-black tracking-tight text-foreground group-hover:text-primary transition-colors">
                    {t('home.importExternal')}
                  </p>
                  <p className="text-[12px] text-muted-foreground opacity-70 font-medium">
                    {t('home.importExternalDesc')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* loading 骨架 */}
          {agentsLoading && agents.length === 0 && (
            Array.from({ length: 2 }).map((_, i) => (
              <Card key={`skeleton-${i}`} className="border-border/50 bg-card/50 rounded-4xl flex flex-col h-full min-h-[250px] animate-pulse">
                <CardContent className="p-5 flex flex-col items-center flex-1 gap-4">
                  <div className="w-24 h-24 rounded-3xl bg-muted mt-2" />
                  <div className="w-28 h-4 rounded-full bg-muted" />
                  <div className="w-full h-3 rounded-full bg-muted/70" />
                  <div className="w-3/4 h-3 rounded-full bg-muted/50" />
                </CardContent>
              </Card>
            ))
          )}

          {/* 智能体列表 */}
          {agents.map((agent) => (
            <Card key={agent.id} className="relative group hover:ring-2 hover:ring-primary/20 transition-all cursor-pointer overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-xl hover:shadow-primary/5 rounded-4xl flex flex-col h-full min-h-[250px]">
              {/* 透明点击层 → 跳转聊天 */}
              <Link to={`/chat/${agent.id}`} className="absolute inset-0 z-20" aria-label={`Chat with ${agent.name}`} />

              {/* 装饰性背景 */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-primary/10 transition-colors" />

              {/* 编辑按钮：右上角固定，z-index 高于覆盖层 */}
              <div className="absolute top-4 right-4 z-30 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                <Button
                  variant="secondary"
                  size="icon"
                  className="w-9 h-9 rounded-xl bg-background/60 backdrop-blur-md border border-white/20 shadow-lg hover:bg-primary hover:text-primary-foreground transition-all"
                  asChild
                >
                  <Link to={`/edit/${agent.id}`} onClick={e => e.stopPropagation()}>
                    <Edit2 className="w-4 h-4" />
                  </Link>
                </Button>
              </div>

              <CardContent className="p-5 flex flex-col items-center flex-1">
                <div className="mb-4 relative">
                  <div className={cn(
                    "absolute inset-0 rounded-3xl blur-2xl opacity-20 transition-all duration-500 group-hover:opacity-40",
                    agent.status === 'online' ? "bg-success" : "bg-primary"
                  )} />
                  <AgentAvatar
                    name={agent.name}
                    avatarUrl={agent.avatarUrl}
                    color={agent.color}
                    size="xl"
                    className="w-24 h-24 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] relative z-10 group-hover:scale-110 group-hover:-translate-y-2 transition-all duration-500"
                  />
                </div>

                <div className="space-y-4 w-full text-center flex-1">
                  <div className="space-y-1">
                    <h3 className="text-lg font-black tracking-tight group-hover:text-primary transition-colors">
                      {agent.name}
                    </h3>
                    <div className="flex items-center justify-center gap-2">
                    </div>
                  </div>

                  <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2 px-2 font-medium opacity-70 min-h-[36px]">
                    {agent.description}
                  </p>

                  <div className="flex flex-wrap justify-center gap-1.5">
                    {agent.expertise.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[9px] px-2.5 py-0.5 bg-primary/5 hover:bg-primary/10 border-none font-bold uppercase tracking-wider text-primary/70 transition-colors">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="pt-4 mt-auto border-t border-border/10 w-full flex flex-col items-center shrink-0 relative z-30 opacity-0 group-hover:opacity-100 translate-y-4 group-hover:translate-y-0 transition-all duration-500 delay-100">
                  <StatusIndicator agent={agent} />
                  {(() => {
                    const outputTime = formatOutputTime(lastOutputAtMap[agent.id]);
                    if (!outputTime) return null;
                    return (
                      <p className="mt-2 text-[10px] text-muted-foreground/50 text-center px-2 font-mono">
                        {t('home.recentOutput', { time: outputTime })}
                      </p>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'groups' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* 创建群组卡片 */}
          <Link to="/groups/create" className="h-full">
            <Card className="group border-2 border-dashed border-muted-foreground/15 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer h-full min-h-[250px] flex flex-col items-center justify-center rounded-2xl shadow-none">
              <CardContent className="flex flex-col items-center justify-center p-5 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-muted group-hover:bg-primary group-hover:text-primary-foreground text-muted-foreground flex items-center justify-center transition-all duration-300 shadow-sm group-hover:scale-110">
                  <Users className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-[15px] font-bold text-foreground">
                    {t('home.groups.create')}
                  </p>
                  <p className="text-[11px] text-muted-foreground opacity-70 font-medium">
                    {t('home.groups.createDesc')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* 群组列表 */}
          {groupsLoading && (
            <Card className="md:col-span-2 lg:col-span-2 border-2 border-dashed border-muted-foreground/10 bg-card/40 rounded-4xl shadow-none">
              <CardContent className="p-10 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-muted mx-auto flex items-center justify-center">
                  <Clock className="w-8 h-8 text-muted-foreground/40 animate-spin" />
                </div>
                <p className="text-muted-foreground font-bold">{t('common.loading', { defaultValue: '加载中...' })}</p>
              </CardContent>
            </Card>
          )}

          {!groupsLoading && groupsLoadError && (
            <Card className="md:col-span-2 lg:col-span-2 border-2 border-dashed border-destructive/20 bg-card/40 rounded-4xl shadow-none">
              <CardContent className="p-10 text-center space-y-3">
                <p className="text-destructive font-bold">{t('home.groups.loadFailed', { defaultValue: '群列表加载失败' })}</p>
                <p className="text-xs text-muted-foreground">{groupsLoadError}</p>
              </CardContent>
            </Card>
          )}

          {!groupsLoading && !groupsLoadError && groups.map((group) => {
            const members = resolveGroupMembers(group);
            return (
              <Card key={group.groupId} className="relative group hover:ring-2 hover:ring-primary/20 transition-all cursor-pointer overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-xl hover:shadow-primary/5 rounded-4xl flex flex-col h-full min-h-[250px] hover:-translate-y-2 duration-500">
              {/* 透明点击层 → 跳转群聊 */}
              <Link to={`/group-chat/${group.groupId}`} className="absolute inset-0 z-20" aria-label={`Enter group ${group.name}`} />

              <CardContent className="p-5 flex flex-col flex-1">
                <div className="flex items-start justify-between mb-5 w-full">
                  {/* 多个头像堆叠区 */}
                  {renderAvatarStack(members)}
                  <Badge variant="secondary" className="text-[10px] font-black h-5 px-2 bg-primary/10 text-primary border-none rounded-lg shadow-xs uppercase tracking-widest whitespace-nowrap">
                    {t('home.groups.members', { count: group.memberAgentIds.length })}
                  </Badge>
                </div>

                <div className="space-y-3 flex-1 pt-2">
                  <h3 className="text-xl font-black tracking-tight group-hover:text-primary transition-colors">
                    {group.name}
                  </h3>
                  <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-3 opacity-70 font-medium min-h-[54px] pr-4">
                    {group.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {group.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[9px] px-2.5 py-0.5 bg-primary/5 hover:bg-primary/10 border-none font-bold uppercase tracking-wider text-primary/70 transition-colors">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="pt-4 mt-auto border-t border-border/10 w-full flex justify-between items-center shrink-0 relative z-30 opacity-0 group-hover:opacity-100 translate-y-4 group-hover:translate-y-0 transition-all duration-500 delay-100">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-success shadow-sm animate-pulse" />
                    {/* 移除状态文字 */}
                  </div>
                  <Button variant="ghost" size="sm" className="h-9 rounded-xl px-5 text-xs font-black gap-2 text-primary hover:bg-primary/10 group/btn transition-all shadow-none" asChild>
                    <Link to={`/group-chat/${group.groupId}`}>
                      {t('home.groups.enterChat')} <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between mb-8">
            <div className="space-y-1">
              <h2 className="text-2xl font-black tracking-tight">{t('tasks.title')}</h2>
              <p className="text-sm text-muted-foreground font-medium">{t('tasks.subtitle')}</p>
            </div>
            <Link to="/tasks">
              <Button variant="outline" className="rounded-full gap-2 font-bold px-6 border-primary/20 hover:bg-primary/5 text-primary">
                {t('common.more')} <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
          {/* 任务列表 */}
          {tasksLoading ? (
            <div className="py-16 text-center space-y-4 bg-card/40 rounded-3xl border-2 border-dashed border-muted-foreground/10">
              <div className="w-16 h-16 rounded-full bg-muted mx-auto flex items-center justify-center">
                <Clock className="w-8 h-8 text-muted-foreground/40 animate-spin" />
              </div>
              <p className="text-muted-foreground font-bold">正在加载任务...</p>
            </div>
          ) : tasksLoadError ? (
            <div className="py-16 text-center space-y-4 bg-card/40 rounded-3xl border-2 border-dashed border-destructive/20">
              <div className="w-16 h-16 rounded-full bg-destructive/10 mx-auto flex items-center justify-center">
                <Clock className="w-8 h-8 text-destructive/60" />
              </div>
              <p className="text-destructive font-bold">任务加载失败</p>
              <p className="text-xs text-muted-foreground">{tasksLoadError}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {runningTasks.length === 0 ? (
                <div className="md:col-span-2 lg:col-span-2 py-16 text-center space-y-4 bg-card/40 rounded-3xl border-2 border-dashed border-muted-foreground/10">
                  <div className="w-16 h-16 rounded-full bg-muted mx-auto flex items-center justify-center">
                    <Clock className="w-8 h-8 text-muted-foreground/40" />
                  </div>
                  <p className="text-muted-foreground font-bold">暂无运行中任务</p>
                </div>
              ) : (
                runningTasks.map((task) => {
                  const statusColor = {
                    ok: "bg-success shadow-success/20",
                    error: "bg-destructive shadow-destructive/20",
                    running: "bg-primary animate-pulse shadow-primary/20",
                    idle: "bg-muted shadow-none"
                  }[task.runInfo.lastStatus] || "bg-muted";

                  return (
                    <Card key={task.id} className="border-border/40 bg-card/40 hover:bg-card/60 transition-all rounded-3xl p-6 space-y-4 group">
                      <div className="flex items-center justify-between">
                        <Badge className={cn("rounded-full font-black text-[9px] px-2 py-0.5 text-white border-none", statusColor)}>
                          {task.runInfo.lastStatus.toUpperCase()}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground/40 group-hover:text-primary/40 transition-colors">
                          {task.id}
                        </span>
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold group-hover:text-primary transition-colors">{task.name}</h4>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1 opacity-70">
                          {task.jobType === 'agent' ? task.prompt : task.command}
                        </p>
                      </div>
                      <div className="pt-2 flex items-center justify-between text-[10px] font-bold text-muted-foreground/50 border-t border-border/10">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{task.schedule.kind.toUpperCase()}</span>
                        </div>
                        {task.runInfo.lastRun && (
                          <span>{new Date(task.runInfo.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                      </div>
                    </Card>
                  );
                })
              )}
              <Card className="border-border/40 bg-card/40 rounded-3xl flex flex-col items-center justify-center p-6 border-dashed border-2 hover:bg-primary/5 cursor-pointer transition-colors group" asChild>
                <Link to="/tasks?create=true">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                    <Plus className="w-5 h-5" />
                  </div>
                  <p className="text-[11px] font-bold mt-3 text-muted-foreground group-hover:text-primary transition-colors">{t('tasks.form.create')}</p>
                </Link>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
