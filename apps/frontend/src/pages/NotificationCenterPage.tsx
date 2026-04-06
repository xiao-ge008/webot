import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Archive,
  Bell,
  CheckCircle2,
  ExternalLink,
  Inbox,
  Loader2,
  Search,
  Send,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useGlobalAlert } from '@/providers/GlobalAlertProvider';
import {
  archiveNotification,
  deleteNotification,
  getNotificationSettings,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationSettings,
} from '@/services/notification-client';
import type {
  NotificationChannelType,
  NotificationRecord,
  NotificationSettings,
  NotificationType,
} from '@/types/notifications';

const DEFAULT_NOTIFICATION_LIMIT = 200;

const DEFAULT_SETTINGS: NotificationSettings = {
  version: 1,
  enabledChannels: ['system'],
  targets: {
    telegram: '',
    feishu: '',
    qqbot: '',
    whatsapp: '',
  },
  fallbackToSystem: true,
};

function formatTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function sourceDomainLabel(value: string): string {
  if (value === 'manual_task') return '任务中心';
  if (value === 'chat_task') return '聊天任务';
  if (value === 'video_job') return '视频任务';
  if (value === 'a2a_task') return '协作任务';
  if (value === 'agent_workflow') return '异步作业';
  return '系统';
}

function channelLabel(channel: NotificationChannelType): string {
  if (channel === 'system') return '系统弹窗';
  if (channel === 'telegram') return 'Telegram';
  if (channel === 'feishu') return '飞书';
  if (channel === 'qqbot') return 'QQ';
  return 'WhatsApp';
}

function buildTargetInputLabel(channel: Exclude<NotificationChannelType, 'system'>): string {
  if (channel === 'telegram') return 'Telegram 接收人 / Chat ID';
  if (channel === 'feishu') return '飞书接收目标';
  if (channel === 'qqbot') return 'QQ 接收目标';
  return 'WhatsApp 接收目标';
}

function deliveryAttemptsOf(record: NotificationRecord): Array<Record<string, unknown>> {
  const raw = record.deliveryStatus?.delivery_attempts;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

function notificationTone(type: string): {
  label: string;
  badge: string;
  iconWrap: string;
  card: string;
  icon: typeof Bell;
} {
  if (type === 'anomaly' || type === 'failed') {
    return {
      label: type === 'failed' ? '失败' : '异常',
      badge: 'bg-destructive text-white',
      iconWrap: 'bg-destructive/10 text-destructive',
      card: 'border-destructive/20 bg-destructive/[0.03]',
      icon: AlertCircle,
    };
  }
  if (type === 'summary' || type === 'completed') {
    return {
      label: type === 'summary' ? '总结' : '完成',
      badge: 'bg-success text-white',
      iconWrap: 'bg-success/10 text-success',
      card: 'border-success/20 bg-success/[0.03]',
      icon: CheckCircle2,
    };
  }
  if (type === 'progress') {
    return {
      label: '进展',
      badge: 'bg-primary text-primary-foreground',
      iconWrap: 'bg-primary/10 text-primary',
      card: 'border-primary/20 bg-primary/[0.03]',
      icon: Send,
    };
  }
  return {
    label: '通知',
    badge: 'bg-muted text-foreground',
    iconWrap: 'bg-muted text-foreground',
    card: 'border-border bg-card',
    icon: Bell,
  };
}

function compactSummary(record: NotificationRecord): string {
  return record.summary || record.detail || '暂无摘要';
}

export function NotificationCenterPage() {
  const [loading, setLoading] = useState(true);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [archivingSelected, setArchivingSelected] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | NotificationType>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | string>('all');
  const [agentFilter, setAgentFilter] = useState<'all' | string>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [unreadCount, setUnreadCount] = useState(0);
  const { showConfirm } = useGlobalAlert();

  const selected = useMemo(
    () => notifications.find((item) => item.id === selectedId) || null,
    [notifications, selectedId],
  );

  const agentOptions = useMemo(() => {
    const rows = notifications
      .map((item) => ({
        id: item.agentId || item.agentName || '',
        label: item.agentName || item.agentId || '',
      }))
      .filter((item) => item.id && item.label);
    const unique = new Map(rows.map((item) => [item.id, item.label]));
    return [...unique.entries()].map(([id, label]) => ({ id, label }));
  }, [notifications]);

  const loadUnreadCount = async () => {
    try {
      setUnreadCount(await getUnreadNotificationCount());
    } catch (error) {
      console.error(error);
    }
  };

  const loadSettings = async () => {
    try {
      setSettings(await getNotificationSettings());
    } catch (error) {
      alert(error instanceof Error ? error.message : '读取通知设置失败');
    }
  };

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const requestedLimit = createdFrom || createdTo ? 500 : DEFAULT_NOTIFICATION_LIMIT;
      const [rows, nextUnreadCount] = await Promise.all([
        listNotifications({
          unreadOnly,
          notificationType: typeFilter === 'all' ? undefined : typeFilter,
          sourceDomain: sourceFilter === 'all' ? undefined : sourceFilter,
          agentId: agentFilter === 'all' ? undefined : agentFilter,
          q: appliedQuery || undefined,
          createdFrom: createdFrom || undefined,
          createdTo: createdTo || undefined,
          limit: requestedLimit,
        }),
        getUnreadNotificationCount(),
      ]);
      setNotifications(rows);
      setUnreadCount(nextUnreadCount);
      setSelectedId((prev) => {
        if (prev && rows.some((item) => item.id === prev)) return prev;
        return rows[0]?.id || '';
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : '读取通知失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [appliedQuery, typeFilter, sourceFilter, agentFilter, unreadOnly, createdFrom, createdTo]);

  const removeNotificationFromState = (notificationId: string) => {
    const nextRows = notifications.filter((item) => item.id !== notificationId);
    setNotifications(nextRows);
    setSelectedId((prev) => (prev === notificationId ? (nextRows[0]?.id || '') : prev));
    if (selectedId === notificationId) {
      setDetailOpen(false);
    }
  };

  const handleSelect = async (item: NotificationRecord) => {
    setSelectedId(item.id);
    setDetailOpen(true);
    if (item.readAt) return;
    try {
      const next = await markNotificationRead(item.id);
      const now = next?.readAt || new Date().toISOString();
      setNotifications((prev) => prev.map((row) => (
        row.id === item.id
          ? { ...row, readAt: now }
          : row
      )));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      alert(error instanceof Error ? error.message : '标记通知已读失败');
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAllRead(true);
    try {
      await markAllNotificationsRead();
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((item) => ({
        ...item,
        readAt: item.readAt || now,
      })));
      setUnreadCount(0);
    } catch (error) {
      alert(error instanceof Error ? error.message : '批量标记已读失败');
    } finally {
      setMarkingAllRead(false);
    }
  };

  const handleArchiveSelected = async () => {
    if (!selected) return;
    setArchivingSelected(true);
    try {
      const wasUnread = !selected.readAt && !selected.archivedAt;
      await archiveNotification(selected.id);
      removeNotificationFromState(selected.id);
      if (wasUnread) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } else {
        void loadUnreadCount();
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '归档通知失败');
    } finally {
      setArchivingSelected(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selected) return;
    const confirmed = await showConfirm(`确认删除通知“${selected.title}”吗？删除后不可恢复。`, {
      title: '删除通知',
      confirmText: '删除',
      cancelText: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;
    setDeletingSelected(true);
    try {
      const wasUnread = !selected.readAt && !selected.archivedAt;
      await deleteNotification(selected.id);
      removeNotificationFromState(selected.id);
      if (wasUnread) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } else {
        void loadUnreadCount();
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除通知失败');
    } finally {
      setDeletingSelected(false);
    }
  };

  const toggleChannel = (channel: NotificationChannelType, enabled: boolean) => {
    setSettings((prev) => {
      const nextEnabled = new Set(prev.enabledChannels);
      if (enabled) {
        nextEnabled.add(channel);
      } else {
        nextEnabled.delete(channel);
      }
      if (nextEnabled.size === 0) {
        nextEnabled.add('system');
      }
      return {
        ...prev,
        enabledChannels: [...nextEnabled] as NotificationSettings['enabledChannels'],
      };
    });
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const next = await updateNotificationSettings(settings);
      setSettings(next);
      setSettingsOpen(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存通知设置失败');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSearchSubmit = () => {
    const next = searchInput.trim();
    if (next === appliedQuery) {
      void loadNotifications();
      return;
    }
    setAppliedQuery(next);
  };

  const resetFilters = () => {
    setSearchInput('');
    setAppliedQuery('');
    setCreatedFrom('');
    setCreatedTo('');
    setTypeFilter('all');
    setSourceFilter('all');
    setAgentFilter('all');
    setUnreadOnly(false);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-5 pb-10 pt-8 md:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-primary">
            <Bell className="h-3.5 w-3.5" />
            Notification Center
          </div>
          <h1 className="text-4xl font-black tracking-tight">通知中心</h1>
          <p className="text-sm text-muted-foreground">
            默认展示最近 {DEFAULT_NOTIFICATION_LIMIT} 条通知。点击通知用弹窗查看内容，当前未读 {unreadCount} 条。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => { void loadNotifications(); }}>
            刷新
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => { void handleMarkAllRead(); }}
            disabled={markingAllRead}
          >
            {markingAllRead ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            全部已读
          </Button>
          <Button className="rounded-full gap-2" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4" />
            通知方式设置
          </Button>
        </div>
      </div>

      <Card className="rounded-[28px] border-border/60 shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px_150px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="notification-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearchSubmit();
                  }
                }}
                placeholder="搜索通知标题、任务名、智能体"
                className="rounded-2xl pl-10"
              />
            </div>
            <Input
              name="notification-created-from"
              type="date"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
              className="rounded-2xl"
            />
            <Input
              name="notification-created-to"
              type="date"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
              className="rounded-2xl"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto]">
            <Select value={typeFilter} onValueChange={(value: 'all' | NotificationType) => setTypeFilter(value)}>
              <SelectTrigger className="rounded-2xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="progress">进行中</SelectItem>
                <SelectItem value="completed">完成</SelectItem>
                <SelectItem value="summary">总结</SelectItem>
                <SelectItem value="anomaly">异常</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sourceFilter} onValueChange={(value: 'all' | string) => setSourceFilter(value)}>
              <SelectTrigger className="rounded-2xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部来源</SelectItem>
                <SelectItem value="manual_task">任务中心</SelectItem>
                <SelectItem value="chat_task">聊天任务</SelectItem>
                <SelectItem value="video_job">视频任务</SelectItem>
                <SelectItem value="a2a_task">协作任务</SelectItem>
                <SelectItem value="agent_workflow">异步作业</SelectItem>
              </SelectContent>
            </Select>

            <Select value={agentFilter} onValueChange={(value: 'all' | string) => setAgentFilter(value)}>
              <SelectTrigger className="rounded-2xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部智能体</SelectItem>
                {agentOptions.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" className="rounded-2xl" onClick={handleSearchSubmit}>
              搜索
            </Button>
            <Button variant="ghost" className="rounded-2xl" onClick={resetFilters}>
              清空
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-muted/35 px-4 py-3">
            <div className="text-xs text-muted-foreground">
              当前展示 {notifications.length} 条结果，历史通知可通过日期检索。
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">只看未读</span>
              <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {loading ? (
          <Card className="rounded-[28px]">
            <CardContent className="p-10 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
              正在加载通知...
            </CardContent>
          </Card>
        ) : notifications.length === 0 ? (
          <Card className="rounded-[28px] border-dashed">
            <CardContent className="space-y-3 p-10 text-center">
              <Inbox className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <div className="font-bold">当前没有匹配的通知</div>
              <div className="text-xs text-muted-foreground">可以调整搜索词或筛选条件后再试。</div>
            </CardContent>
          </Card>
        ) : (
          notifications.map((item) => {
            const tone = notificationTone(item.notificationType);
            const Icon = tone.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="w-full text-left"
                onClick={() => { void handleSelect(item); }}
              >
                <Card className={cn('rounded-[24px] border transition-all hover:shadow-md', tone.card)}>
                  <CardContent className="flex items-start gap-4 p-4 md:p-5">
                    <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', tone.iconWrap)}>
                      <Icon className="h-4.5 w-4.5" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={cn('rounded-full border-none text-[10px] font-black', tone.badge)}>
                              {tone.label}
                            </Badge>
                            <Badge variant="outline" className="rounded-full text-[10px]">
                              {sourceDomainLabel(item.sourceDomain)}
                            </Badge>
                            {!item.readAt ? (
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                            ) : null}
                          </div>
                          <div className="line-clamp-1 text-base font-black leading-snug">{item.title}</div>
                        </div>
                        <div className="shrink-0 text-[11px] text-muted-foreground">
                          {formatTime(item.updatedAt)}
                        </div>
                      </div>

                      <div className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                        {compactSummary(item)}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{item.agentName || item.agentId || '未标记智能体'}</span>
                        <span>{item.taskName || item.taskId || '未关联任务'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })
        )}
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl rounded-[28px] border-border/60 p-0">
          <div className="space-y-5 p-6 md:p-7">
            {!selected ? null : (
              <>
                <DialogHeader className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn('rounded-full border-none', notificationTone(selected.notificationType).badge)}>
                      {notificationTone(selected.notificationType).label}
                    </Badge>
                    <Badge variant="outline" className="rounded-full">
                      {sourceDomainLabel(selected.sourceDomain)}
                    </Badge>
                  </div>
                  <DialogTitle className="text-2xl font-black leading-snug">{selected.title}</DialogTitle>
                  <DialogDescription className="text-sm leading-6 text-muted-foreground">
                    {selected.agentName || selected.agentId || '未标记智能体'}
                    {' · '}
                    {selected.taskName || selected.taskId || '未关联任务'}
                    {' · '}
                    {formatTime(selected.updatedAt)}
                  </DialogDescription>
                </DialogHeader>

                <div className="rounded-[24px] border border-border/60 bg-background p-5 text-sm leading-7 whitespace-pre-wrap">
                  {selected.detail || selected.summary || '暂无详细内容。'}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-muted/35 p-4 text-sm">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">来源智能体</div>
                    <div className="mt-2 font-medium">{selected.agentName || selected.agentId || '-'}</div>
                  </div>
                  <div className="rounded-2xl bg-muted/35 p-4 text-sm">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">关联任务</div>
                    <div className="mt-2 font-medium">{selected.taskName || selected.taskId || '-'}</div>
                  </div>
                </div>

                {deliveryAttemptsOf(selected).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {deliveryAttemptsOf(selected).map((attempt, index) => (
                      <Badge
                        key={`${String(attempt.channel || 'channel')}-${index}`}
                        className={cn(
                          'rounded-full border-none',
                          typeof attempt.status === 'string' && attempt.status === 'failed'
                            ? 'bg-destructive text-white'
                            : 'bg-muted text-foreground',
                        )}
                      >
                        {typeof attempt.channel === 'string'
                          ? channelLabel(attempt.channel as NotificationChannelType)
                          : '未知渠道'}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="rounded-full"
                    onClick={() => { void handleArchiveSelected(); }}
                    disabled={archivingSelected || deletingSelected}
                  >
                    {archivingSelected ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
                    归档
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => { void handleDeleteSelected(); }}
                    disabled={archivingSelected || deletingSelected}
                  >
                    {deletingSelected ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    删除
                  </Button>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link to="/tasks">
                      打开任务中心
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  {selected.agentId ? (
                    <Button asChild variant="outline" className="rounded-full">
                      <Link to={`/chat/${selected.agentId}`}>
                        打开智能体会话
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" className="rounded-full">
                  关闭
                </Button>
              </DialogClose>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-3xl rounded-[28px] border-border/60 p-0">
          <div className="space-y-5 p-6 md:p-7">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-2xl font-black">通知方式设置</DialogTitle>
              <DialogDescription className="text-sm leading-6 text-muted-foreground">
                默认仍然是右下角系统弹窗，外部渠道按全局配置追加发送。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-2">
              {(['system', 'telegram', 'feishu', 'qqbot', 'whatsapp'] as NotificationChannelType[]).map((channel) => (
                <div key={channel} className="space-y-3 rounded-[24px] border border-border/60 bg-muted/[0.3] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-bold">{channelLabel(channel)}</div>
                      <div className="text-[11px] leading-5 text-muted-foreground">
                        {channel === 'system'
                          ? '桌面端默认使用系统弹窗提醒。'
                          : '保存后作为全局默认外发渠道参与通知投递。'}
                      </div>
                    </div>
                    <Switch
                      checked={settings.enabledChannels.includes(channel)}
                      onCheckedChange={(checked) => toggleChannel(channel, checked)}
                    />
                  </div>

                  {channel !== 'system' ? (
                    <Input
                      name={`notification-target-${channel}`}
                      value={settings.targets[channel] || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSettings((prev) => ({
                          ...prev,
                          targets: {
                            ...prev.targets,
                            [channel]: value,
                          },
                        }));
                      }}
                      placeholder={buildTargetInputLabel(channel)}
                      className="rounded-2xl bg-background"
                    />
                  ) : null}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-[24px] border border-border/60 bg-background px-5 py-4">
              <div className="space-y-1">
                <div className="font-bold">失败回退系统弹窗</div>
                <div className="text-[11px] leading-5 text-muted-foreground">
                  外部渠道发送失败时，仍保留桌面弹窗提醒。
                </div>
              </div>
              <Switch
                checked={settings.fallbackToSystem}
                onCheckedChange={(checked) => {
                  setSettings((prev) => ({ ...prev, fallbackToSystem: checked }));
                }}
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" className="rounded-full">
                  取消
                </Button>
              </DialogClose>
              <Button className="rounded-full" onClick={() => { void saveSettings(); }} disabled={savingSettings}>
                {savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings2 className="mr-2 h-4 w-4" />}
                保存设置
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

