import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BookOpen,
  Bot,
  CheckCircle2,
  Globe,
  Radar,
  Scissors,
  Sparkles,
  Target,
  TrendingUp,
  Twitter,
  Wand2,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  activateHand,
  checkHandDeps,
  deactivateHandInstance,
  getHandBrowserState,
  getHandDetail,
  getHandSession,
  getHandStats,
  installHandDeps,
  listActiveHands,
  listHands,
  pauseHandInstance,
  resumeHandInstance,
  sendHandMessage,
} from '@/services/hands-client';
import { getServicePowerState, startServicePower, stopServicePower, type ServicePowerState } from '@/services/service-power-client';
import type {
  HandBrowserState,
  HandChatMessage,
  HandDefinitionDetail,
  HandDefinitionSummary,
  HandInstallResult,
  HandInstance,
  HandSettingStatus,
  HandStatsResponse,
} from '@/types';
import { cn } from '@/lib/utils';

type DialogTab = 'setup' | 'chat';

const HAND_ICON_MAP: Record<string, LucideIcon> = {
  clip: Scissors,
  lead: Target,
  collector: Radar,
  predictor: TrendingUp,
  researcher: BookOpen,
  twitter: Twitter,
  browser: Globe,
};

function getSettingDefault(setting: HandSettingStatus): string {
  if (typeof setting.default === 'string' && setting.default.trim()) {
    return setting.default;
  }
  if (setting.setting_type === 'toggle') {
    return 'false';
  }
  if (setting.setting_type === 'select' && setting.options && setting.options.length > 0) {
    return setting.options[0].value;
  }
  return '';
}

function normalizeStatus(raw: string): 'active' | 'paused' | 'error' | 'unknown' {
  const text = raw.toLowerCase();
  if (text.includes('pause')) return 'paused';
  if (text.includes('active') || text.includes('running')) return 'active';
  if (text.includes('error') || text.includes('failed')) return 'error';
  return 'unknown';
}

function formatMetricValue(value: string | number | null | undefined, format?: string): string {
  if (value === null || value === undefined) return '-';
  if (format === 'duration') {
    const secs = Number(value);
    if (!Number.isFinite(secs)) return String(value);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
  if (format === 'number') {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    return num.toLocaleString();
  }
  return String(value);
}

export function SuperToolsPanel() {
  const { t } = useTranslation();
  const [hands, setHands] = useState<HandDefinitionSummary[]>([]);
  const [handsLoading, setHandsLoading] = useState(false);
  const [handsError, setHandsError] = useState('');
  const [activeInstances, setActiveInstances] = useState<HandInstance[]>([]);
  const [activeLoading, setActiveLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<DialogTab>('setup');
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const [handDetail, setHandDetail] = useState<HandDefinitionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResults, setInstallResults] = useState<HandInstallResult[] | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [activating, setActivating] = useState(false);
  const [activeInstance, setActiveInstance] = useState<HandInstance | null>(null);
  const [stats, setStats] = useState<HandStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [browserState, setBrowserState] = useState<HandBrowserState | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<HandChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [serviceState, setServiceState] = useState<ServicePowerState>({ status: 'offline', online: false });
  const [serviceLoading, setServiceLoading] = useState(false);
  const [serviceToggling, setServiceToggling] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const activeByHandId = useMemo(() => {
    const map = new Map<string, HandInstance>();
    for (const inst of activeInstances) {
      if (!map.has(inst.hand_id)) {
        map.set(inst.hand_id, inst);
      }
    }
    return map;
  }, [activeInstances]);

  const resolvedHands = useMemo(() => {
    return hands.map((hand) => {
      const i18nKey = `home.superTools.hands.${hand.id}`;
      const translatedTitle = t(`${i18nKey}.title`, { defaultValue: '' });
      const translatedDesc = t(`${i18nKey}.desc`, { defaultValue: '' });
      return {
        ...hand,
        translatedTitle: translatedTitle || hand.name || hand.id,
        translatedDesc: translatedDesc || hand.description || '',
      };
    });
  }, [hands, t]);

  const refreshHands = async () => {
    setHandsLoading(true);
    setHandsError('');
    try {
      const rows = await listHands();
      setHands(rows);
    } catch (error) {
      setHands([]);
      setHandsError(error instanceof Error ? error.message : '加载失败');
    } finally {
      setHandsLoading(false);
    }
  };

  const refreshActive = async () => {
    setActiveLoading(true);
    try {
      const rows = await listActiveHands();
      setActiveInstances(rows);
    } catch {
      setActiveInstances([]);
    } finally {
      setActiveLoading(false);
    }
  };

  const refreshServiceState = async () => {
    setServiceLoading(true);
    try {
      const next = await getServicePowerState();
      setServiceState(next);
      setServiceError(next.error ?? null);
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : '状态查询失败');
    } finally {
      setServiceLoading(false);
    }
  };

  useEffect(() => {
    void refreshHands();
    void refreshActive();
    void refreshServiceState();
    const timer = window.setInterval(() => {
      void refreshActive();
      void refreshServiceState();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleToggleService = async () => {
    if (serviceToggling) return;
    setServiceToggling(true);
    try {
      const next = serviceState.online ? await stopServicePower() : await startServicePower();
      setServiceState(next);
      setServiceError(next.error ?? null);
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : '操作失败');
    } finally {
      setServiceToggling(false);
    }
  };

  const openDialogForHand = async (handId: string) => {
    setSelectedHandId(handId);
    setDialogOpen(true);
    setDialogTab('setup');
    setHandDetail(null);
    setInstallResults(null);
    setStats(null);
    setBrowserState(null);
    setChatMessages([]);
    setChatInput('');

    const inst = activeByHandId.get(handId) ?? null;
    setActiveInstance(inst);

    setDetailLoading(true);
    try {
      const detail = await getHandDetail(handId);
      setHandDetail(detail);
      const defaults: Record<string, string> = {};
      for (const setting of detail.settings || []) {
        defaults[setting.key] = getSettingDefault(setting);
      }
      setConfigValues(defaults);
    } catch {
      setHandDetail(null);
    } finally {
      setDetailLoading(false);
    }

    if (inst?.agent_id) {
      try {
        const history = await getHandSession(inst.agent_id);
        setChatMessages(history);
      } catch {
        setChatMessages([]);
      }
    }

    if (inst) {
      void refreshStats(inst.instance_id);
      if (inst.hand_id === 'browser') {
        void refreshBrowser(inst.instance_id);
      }
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSelectedHandId(null);
    setHandDetail(null);
    setActiveInstance(null);
    setStats(null);
    setBrowserState(null);
    setChatMessages([]);
    setChatInput('');
  };

  const handleInstallDeps = async () => {
    if (!selectedHandId) return;
    setInstalling(true);
    try {
      const result = await installHandDeps(selectedHandId);
      setInstallResults(result.results || []);
      const detail = await getHandDetail(selectedHandId);
      setHandDetail(detail);
    } catch (error) {
      setInstallResults([
        {
          key: 'install',
          status: 'error',
          message: error instanceof Error ? error.message : '安装失败',
        },
      ]);
    } finally {
      setInstalling(false);
    }
  };

  const handleRecheckDeps = async () => {
    if (!selectedHandId) return;
    try {
      await checkHandDeps(selectedHandId);
      const detail = await getHandDetail(selectedHandId);
      setHandDetail(detail);
    } catch {
      // ignore
    }
  };

  const handleActivate = async () => {
    if (!selectedHandId) return;
    setActivating(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(configValues)) {
        payload[key] = value;
      }
      const result = await activateHand(selectedHandId, payload);
      await refreshActive();
      const inst = result.instance_id
        ? { instance_id: result.instance_id, hand_id: selectedHandId, status: 'Active', agent_id: result.agent_id, agent_name: result.agent_name }
        : activeByHandId.get(selectedHandId) ?? null;
      setActiveInstance(inst);
      setDialogTab('chat');
      if (inst?.agent_id) {
        const history = await getHandSession(inst.agent_id);
        setChatMessages(history);
      }
    } catch (error) {
      setInstallResults([
        {
          key: 'activate',
          status: 'error',
          message: error instanceof Error ? error.message : '激活失败',
        },
      ]);
    } finally {
      setActivating(false);
    }
  };

  const refreshStats = async (instanceId: string) => {
    setStatsLoading(true);
    try {
      const data = await getHandStats(instanceId);
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const refreshBrowser = async (instanceId: string) => {
    setBrowserLoading(true);
    try {
      const data = await getHandBrowserState(instanceId);
      setBrowserState(data);
    } catch {
      setBrowserState(null);
    } finally {
      setBrowserLoading(false);
    }
  };

  const handlePauseResumeInstance = async (inst: HandInstance) => {
    const status = normalizeStatus(inst.status);
    try {
      if (status === 'paused') {
        await resumeHandInstance(inst.instance_id);
      } else {
        await pauseHandInstance(inst.instance_id);
      }
      await refreshActive();
    } catch {
      // ignore
    }
  };

  const handleDeactivateInstance = async (inst: HandInstance) => {
    try {
      await deactivateHandInstance(inst.instance_id);
      await refreshActive();
      if (activeInstance?.instance_id === inst.instance_id) {
        setActiveInstance(null);
      }
    } catch {
      // ignore
    }
  };

  const handleSendChat = async () => {
    if (!activeInstance?.agent_id) return;
    const message = chatInput.trim();
    if (!message) return;
    setChatSending(true);
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: message }]);
    try {
      const reply = await sendHandMessage(activeInstance.agent_id, message);
      if (reply.trim()) {
        setChatMessages((prev) => [...prev, { role: 'assistant', content: reply.trim() }]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: t('home.superTools.chat.failed') },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  const renderRequirementStatus = (satisfied?: boolean) => {
    if (satisfied) {
      return <Badge variant="success" className="text-[10px] uppercase tracking-widest">{t('home.superTools.requirements.met')}</Badge>;
    }
    return <Badge variant="warning" className="text-[10px] uppercase tracking-widest">{t('home.superTools.requirements.missing')}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-4xl border border-border/60 bg-card/30 p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              <Wand2 className="w-3.5 h-3.5" />
              {t('home.superTools.badge')}
            </div>
            <h2 className="text-2xl font-black tracking-tight">{t('home.superTools.title')}</h2>
            <p className="text-sm text-muted-foreground max-w-xl">{t('home.superTools.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="https://www.openfang.sh/docs/hands" target="_blank" rel="noreferrer">
                {t('home.superTools.learnHands')}
              </a>
            </Button>
            <Button size="sm" onClick={handleToggleService} disabled={serviceToggling}>
              {serviceToggling
                ? t('home.superTools.starting')
                : serviceState.online
                  ? t('home.superTools.stop')
                  : t('home.superTools.start')}
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="border-border/40 bg-background/60 shadow-none rounded-3xl">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Activity className="w-4 h-4 text-primary" />
                {t('home.superTools.runtime.title')}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={serviceState.online ? 'success' : 'secondary'} className="text-[10px] uppercase tracking-widest">
                  {serviceLoading
                    ? t('home.superTools.runtime.checking')
                    : serviceState.online
                      ? t('home.superTools.runtime.online')
                      : t('home.superTools.runtime.offline')}
                </Badge>
                {serviceError && (
                  <span className="text-xs text-destructive">{serviceError}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('home.superTools.runtime.desc')}
              </p>
              {serviceState.openfangBaseUrl && (
                <p className="text-[11px] text-muted-foreground/70 font-mono truncate">
                  {serviceState.openfangBaseUrl}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-background/60 shadow-none rounded-3xl">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Sparkles className="w-4 h-4 text-primary" />
                {t('home.superTools.steps.install.title')}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('home.superTools.steps.install.desc')}
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-background/60 shadow-none rounded-3xl">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Bot className="w-4 h-4 text-primary" />
                {t('home.superTools.steps.bind.title')}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('home.superTools.steps.bind.desc')}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black tracking-tight">{t('home.superTools.active.title')}</h3>
          <span className="text-xs text-muted-foreground">
            {activeLoading ? t('home.superTools.active.loading') : t('home.superTools.active.subtitle')}
          </span>
        </div>
        {activeInstances.length === 0 ? (
          <Card className="border-border/40 bg-card/30 shadow-none rounded-3xl">
            <CardContent className="p-6 text-sm text-muted-foreground">
              {t('home.superTools.active.empty')}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeInstances.map((inst) => {
              const Icon = HAND_ICON_MAP[inst.hand_id] ?? Wand2;
              const status = normalizeStatus(inst.status);
              return (
                <Card key={inst.instance_id} className="border-border/50 bg-card/40 shadow-none rounded-3xl">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold">{inst.agent_name || inst.hand_id}</p>
                          <p className="text-xs text-muted-foreground">{inst.hand_id}</p>
                        </div>
                      </div>
                      <Badge
                        variant={status === 'active' ? 'success' : status === 'paused' ? 'warning' : 'secondary'}
                        className="text-[10px] uppercase tracking-widest"
                      >
                        {inst.status || t('home.superTools.active.unknown')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => openDialogForHand(inst.hand_id)}>
                        {t('home.superTools.active.open')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handlePauseResumeInstance(inst)}>
                        {status === 'paused' ? t('home.superTools.active.resume') : t('home.superTools.active.pause')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeactivateInstance(inst)}>
                        {t('home.superTools.active.deactivate')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black tracking-tight">{t('home.superTools.hands.title')}</h3>
          <span className="text-xs text-muted-foreground">{t('home.superTools.hands.subtitle')}</span>
        </div>
        {handsLoading ? (
          <Card className="border-border/40 bg-card/30 shadow-none rounded-3xl">
            <CardContent className="p-6 text-sm text-muted-foreground">
              {t('home.superTools.hands.loading')}
            </CardContent>
          </Card>
        ) : handsError ? (
          <Card className="border-border/40 bg-card/30 shadow-none rounded-3xl">
            <CardContent className="p-6 text-sm text-destructive">{handsError}</CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {resolvedHands.map((hand) => {
              const Icon = HAND_ICON_MAP[hand.id] ?? Wand2;
              const active = activeByHandId.has(hand.id);
              return (
                <Card key={hand.id} className="border-border/50 bg-card/40 shadow-none rounded-3xl">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                        {hand.icon && hand.icon.length <= 3 ? (
                          <span className="text-lg">{hand.icon}</span>
                        ) : (
                          <Icon className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold truncate">{hand.translatedTitle}</p>
                          <Badge variant="secondary" className="text-[10px] uppercase tracking-widest">
                            {hand.name || hand.id}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{hand.translatedDesc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {renderRequirementStatus(hand.requirements_met)}
                      {active && (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-widest">
                          {t('home.superTools.hands.active')}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-widest">
                        {t('home.superTools.hands.settings', { count: hand.settings_count || 0 })}
                      </Badge>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openDialogForHand(hand.id)}>
                      {t('home.superTools.hands.open')}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? null : closeDialog())}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span className="text-xl font-black">{handDetail?.name || selectedHandId}</span>
              {handDetail?.id && (
                <Badge variant="secondary" className="text-[10px] uppercase tracking-widest">
                  {handDetail.id}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {handDetail?.description || t('home.superTools.dialog.subtitle')}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="py-12 text-center text-muted-foreground">{t('home.superTools.dialog.loading')}</div>
          ) : (
            <Tabs value={dialogTab} onValueChange={(val) => setDialogTab(val as DialogTab)}>
              <TabsList className="w-full justify-start">
                <TabsTrigger value="setup">{t('home.superTools.dialog.tabs.setup')}</TabsTrigger>
                <TabsTrigger value="chat">{t('home.superTools.dialog.tabs.chat')}</TabsTrigger>
              </TabsList>

              <TabsContent value="setup" className="space-y-5">
                <div className="rounded-3xl border border-border/40 bg-background/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold">{t('home.superTools.requirements.title')}</h4>
                    {renderRequirementStatus(handDetail?.requirements_met)}
                  </div>
                  <div className="space-y-2">
                    {(handDetail?.requirements || []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('home.superTools.requirements.none')}</p>
                    ) : (
                      handDetail?.requirements?.map((req) => (
                        <div key={req.key} className="flex items-center justify-between text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">{req.label}</span>
                            {req.description && (
                              <span className="ml-2 text-muted-foreground/70">{req.description}</span>
                            )}
                          </div>
                          {req.satisfied ? (
                            <CheckCircle2 className="w-4 h-4 text-success" />
                          ) : (
                            <XCircle className="w-4 h-4 text-warning" />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={handleRecheckDeps}>
                      {t('home.superTools.requirements.recheck')}
                    </Button>
                    <Button size="sm" onClick={handleInstallDeps} disabled={installing}>
                      {installing ? t('home.superTools.requirements.installing') : t('home.superTools.requirements.install')}
                    </Button>
                  </div>
                  {installResults && installResults.length > 0 && (
                    <div className="rounded-2xl bg-muted/40 p-3 space-y-1">
                      {installResults.map((item, index) => (
                        <p key={`${item.key}-${index}`} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{item.key}</span>
                          <span className="ml-2">{item.status}</span>
                          {item.message && <span className="ml-2">{item.message}</span>}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-border/40 bg-background/40 p-4 space-y-3">
                  <h4 className="text-sm font-bold">{t('home.superTools.settings.title')}</h4>
                  {(handDetail?.settings || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('home.superTools.settings.none')}</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {handDetail?.settings?.map((setting) => {
                        const value = configValues[setting.key] ?? getSettingDefault(setting);
                        return (
                          <div key={setting.key} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-semibold text-foreground-secondary">{setting.label}</label>
                              {setting.description && (
                                <span className="text-[10px] text-muted-foreground">{setting.description}</span>
                              )}
                            </div>
                            {setting.setting_type === 'select' && (
                              <select
                                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                                value={value}
                                onChange={(event) =>
                                  setConfigValues((prev) => ({ ...prev, [setting.key]: event.target.value }))
                                }
                              >
                                {(setting.options || []).map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}{opt.available === false ? ` (${t('home.superTools.settings.unready')})` : ''}
                                  </option>
                                ))}
                              </select>
                            )}
                            {setting.setting_type === 'text' && (
                              <Input
                                value={value}
                                onChange={(event) =>
                                  setConfigValues((prev) => ({ ...prev, [setting.key]: event.target.value }))
                                }
                                placeholder={t('home.superTools.settings.placeholder')}
                                className="h-9"
                              />
                            )}
                            {setting.setting_type === 'toggle' && (
                              <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                                <span className="text-xs text-muted-foreground">{value === 'true' ? t('home.superTools.settings.enabled') : t('home.superTools.settings.disabled')}</span>
                                <Switch
                                  checked={value === 'true'}
                                  onCheckedChange={(checked) =>
                                    setConfigValues((prev) => ({ ...prev, [setting.key]: checked ? 'true' : 'false' }))
                                  }
                                  className="data-[state=checked]:bg-accent"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    {handDetail?.requirements_met
                      ? t('home.superTools.activate.ready')
                      : t('home.superTools.activate.blocked')}
                  </div>
                  <Button onClick={handleActivate} disabled={activating || !handDetail?.requirements_met}>
                    {activating ? t('home.superTools.activate.activating') : t('home.superTools.activate.cta')}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="chat" className="space-y-5">
                {!activeInstance ? (
                  <div className="rounded-3xl border border-border/40 bg-background/40 p-6 text-sm text-muted-foreground">
                    {t('home.superTools.chat.empty')}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-widest">
                        {activeInstance.status || t('home.superTools.active.unknown')}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => refreshStats(activeInstance.instance_id)}>
                        {statsLoading ? t('home.superTools.stats.loading') : t('home.superTools.stats.refresh')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handlePauseResumeInstance(activeInstance)}>
                        {normalizeStatus(activeInstance.status) === 'paused'
                          ? t('home.superTools.active.resume')
                          : t('home.superTools.active.pause')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeactivateInstance(activeInstance)}>
                        {t('home.superTools.active.deactivate')}
                      </Button>
                    </div>

                    {stats?.metrics && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {Object.entries(stats.metrics).map(([label, metric]) => (
                          <Card key={label} className="border-border/40 bg-card/40 shadow-none rounded-2xl">
                            <CardContent className="p-4">
                              <p className="text-xs text-muted-foreground">{label}</p>
                              <p className="text-lg font-bold">{formatMetricValue(metric.value, metric.format)}</p>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}

                    {activeInstance.hand_id === 'browser' && (
                      <div className="rounded-3xl border border-border/40 bg-background/40 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold">{t('home.superTools.browser.title')}</h4>
                          <Button size="sm" variant="outline" onClick={() => refreshBrowser(activeInstance.instance_id)}>
                            {browserLoading ? t('home.superTools.browser.loading') : t('home.superTools.browser.refresh')}
                          </Button>
                        </div>
                        {browserState?.screenshot_base64 ? (
                          <img
                            src={`data:image/png;base64,${browserState.screenshot_base64}`}
                            alt={browserState.title || 'browser'}
                            className="w-full rounded-2xl border border-border/40"
                          />
                        ) : (
                          <p className="text-xs text-muted-foreground">{t('home.superTools.browser.empty')}</p>
                        )}
                      </div>
                    )}

                    <div className="rounded-3xl border border-border/40 bg-background/40 p-4 space-y-3">
                      <h4 className="text-sm font-bold">{t('home.superTools.chat.title')}</h4>
                      <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1">
                        {chatMessages.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t('home.superTools.chat.noMessages')}</p>
                        ) : (
                          chatMessages.map((msg, index) => (
                            <div
                              key={`${msg.role}-${index}`}
                              className={cn(
                                'rounded-2xl px-3 py-2 text-sm leading-relaxed',
                                msg.role === 'user'
                                  ? 'bg-primary text-primary-foreground ml-auto max-w-[80%]'
                                  : 'bg-muted text-foreground max-w-[80%]'
                              )}
                            >
                              {msg.content}
                            </div>
                          ))
                        )}
                      </div>
                      <div className="flex flex-col md:flex-row gap-2">
                        <Textarea
                          value={chatInput}
                          onChange={(event) => setChatInput(event.target.value)}
                          placeholder={t('home.superTools.chat.placeholder')}
                          className="min-h-[80px]"
                        />
                        <Button onClick={handleSendChat} disabled={chatSending || !activeInstance.agent_id}>
                          {chatSending ? t('home.superTools.chat.sending') : t('home.superTools.chat.send')}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
