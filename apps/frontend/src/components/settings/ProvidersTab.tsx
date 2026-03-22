import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Bot, Circle, Link2, Plus, RefreshCw, Search, Settings2, Unplug, Trash2 } from 'lucide-react';
import {
  createManagementCustomProvider,
  deleteManagementProviderConfig,
  discoverManagementProviderModels,
  listManagementProviderConfigs,
  listManagementProviders,
  toggleManagementProviderEnabled,
  updateManagementProviderConfig,
  type ManagementProviderOption,
  type ProviderConfigItem,
} from '@/services/management-client';

type ProtocolType = 'openai' | 'claude';

interface ProviderCatalogItem {
  id: string;
  name: string;
  baseUrl?: string;
  tags?: string[];
  popular?: boolean;
  defaultProtocol: ProtocolType;
  custom?: boolean;
}

interface ProviderConfigFormState {
  providerId: string;
  displayName: string;
  protocol: ProtocolType;
  baseUrl: string;
  apiKey: string;
  modelsText: string;
  isCustom: boolean;
  isNew: boolean;
}

const POPULAR_PROVIDER_IDS = new Set([
  'anthropic',
  'deepseek',
  'gemini',
  'minimax',
  'moonshot',
  'nvidia',
  'openai',
  'openrouter',
  'qwen',
  'zhipu',
]);

const PROVIDER_TAGS: Partial<Record<string, string[]>> = {
  anthropic: ['主流'],
  deepseek: ['热门'],
  gemini: ['热门'],
  minimax: ['国内'],
  moonshot: ['国内'],
  nvidia: ['热门'],
  openai: ['主流'],
  openrouter: ['热门'],
  qwen: ['国内'],
  zhipu: ['国内'],
};

const CUSTOM_PROVIDER_CATALOG: ProviderCatalogItem[] = [
  { id: 'custom-openai', name: '自定义 OpenAI 规范', tags: ['自定义'], defaultProtocol: 'openai', custom: true },
  { id: 'custom-claude', name: '自定义 Claude 规范', tags: ['自定义'], defaultProtocol: 'claude', custom: true },
];

function toProtocol(value?: string): ProtocolType {
  return value === 'claude' ? 'claude' : 'openai';
}

function normalizeProviderCatalogKey(value: string): string {
  return value.trim().toLowerCase();
}

function inferProviderProtocol(provider: Pick<ManagementProviderOption, 'providerId' | 'protocol'>): ProtocolType {
  if (provider.protocol) {
    return toProtocol(provider.protocol);
  }
  const normalizedId = normalizeProviderCatalogKey(provider.providerId);
  if (normalizedId === 'anthropic' || normalizedId === 'claude-code') {
    return 'claude';
  }
  return 'openai';
}

function parseModelsText(text: string): string[] {
  return text
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function authConfigured(provider: ManagementProviderOption, cfg?: ProviderConfigItem): boolean {
  if (provider.configured) {
    return true;
  }
  const auth = provider.authStatus.toLowerCase();
  if (!auth.includes('missing') && !auth.includes('none')) {
    return true;
  }
  return cfg?.has_api_key === true || provider.hasBaseUrl;
}

function authStatusLabel(configured: boolean, t: (key: string) => string): string {
  return configured ? t('settings.providers.apiKeySet') : t('settings.providers.apiKeyMissing');
}

function providerHealthLabel(
  provider: ManagementProviderOption,
  check?: { status: string; message: string },
): { text: string; tone: string } {
  const status = (check?.status || provider.connectionStatus || provider.healthStatus || '').toLowerCase();
  switch (status) {
    case 'ok':
    case 'connected':
    case 'healthy':
      return { text: '已连通', tone: 'text-success' };
    case 'checking':
      return { text: '检测中', tone: 'text-amber-600' };
    case 'connection_error':
    case 'error':
      return { text: '连接异常', tone: 'text-destructive' };
    case 'disabled':
      return { text: '已禁用', tone: 'text-foreground-tertiary' };
    case 'configured':
    case 'unverified':
      return { text: '已配置', tone: 'text-amber-600' };
    case 'manual_configuration_required':
      return { text: '手动模型', tone: 'text-amber-600' };
    default:
      return { text: '待配置', tone: 'text-amber-600' };
  }
}

function isManagedProvider(
  _provider: ManagementProviderOption,
  options: { hasSavedConfig: boolean },
): boolean {
  return options.hasSavedConfig;
}

function providerSummaryText(
  provider: ManagementProviderOption,
  check?: { status: string; message: string },
  cfg?: ProviderConfigItem,
): string {
  const configuredModelCount = cfg?.models.length ?? provider.modelCount;
  if (check?.message) {
    return check.message;
  }
  if (!provider.enabled) {
    return configuredModelCount > 0
      ? `已断开连接，本地仍保留 ${configuredModelCount} 个模型，可删除以彻底清理。`
      : '已断开连接，本地配置仍保留，可删除以彻底清理。';
  }
  if (provider.healthy) {
    return '运行时已加载，可用于模型与智能体。';
  }
  if (provider.runtimeLoaded && provider.configured) {
    return '运行时已识别，建议执行一次模型测试确认可用性。';
  }
  if (configuredModelCount > 0) {
    return `已保存 ${configuredModelCount} 个模型，可在模型页启用。`;
  }
  if (provider.configured || provider.hasApiKey || provider.hasBaseUrl) {
    return '已保存本地配置，点击“获取模型”后即可在模型页启用。';
  }
  return '尚未完成连接，请补充 URL、密钥和模型列表。';
}

function createFormFromProvider(
  provider: ManagementProviderOption,
  cfg?: ProviderConfigItem,
): ProviderConfigFormState {
  return {
    providerId: provider.providerId,
    displayName: cfg?.display_name || provider.displayName,
    protocol: toProtocol(cfg?.protocol || provider.protocol),
    baseUrl: cfg?.base_url || provider.baseUrl || '',
    apiKey: '',
    modelsText: (cfg?.models || []).join('\n'),
    isCustom: provider.isCustom === true,
    isNew: false,
  };
}

function createFormFromCatalog(item: ProviderCatalogItem): ProviderConfigFormState {
  const isCustom = item.custom === true;
  const baseId = isCustom ? '' : item.id;
  return {
    providerId: baseId,
    displayName: isCustom ? '' : item.name,
    protocol: item.defaultProtocol,
    baseUrl: item.baseUrl || '',
    apiKey: '',
    modelsText: '',
    isCustom,
    isNew: true,
  };
}

export function ProvidersTab() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ManagementProviderOption[]>([]);
  const [configs, setConfigs] = useState<ProviderConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [providerCheckMap, setProviderCheckMap] = useState<
    Record<string, { status: string; message: string }>
  >({});

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [configForm, setConfigForm] = useState<ProviderConfigFormState | null>(null);

  const configMap = useMemo(() => {
    return new Map(configs.map((item) => [item.provider_id, item]));
  }, [configs]);

  const loadProviders = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const [providerRows, configRows] = await Promise.all([
        listManagementProviders(),
        listManagementProviderConfigs(),
      ]);
      setProviders(providerRows);
      setConfigs(configRows);
      setProviderCheckMap((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([providerId]) =>
            providerRows.some((item) => item.providerId === providerId),
          ),
        ),
      );
    } catch (error) {
      console.error('[Settings][Providers] 加载失败:', error);
      setErrorMessage('加载提供商失败，请确认后端服务已开机。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProviders();
  }, []);

  const managedProviders = useMemo(() => {
    return providers.filter((item) =>
      isManagedProvider(item, { hasSavedConfig: configMap.has(item.providerId) }),
    );
  }, [providers, configMap]);

  const managedProviderIds = useMemo(() => {
    return new Set(
      managedProviders
        .map((item) => normalizeProviderCatalogKey(item.providerId))
        .filter((item) => !item.startsWith('custom-')),
    );
  }, [managedProviders]);

  const providerCatalog = useMemo(() => {
    const catalogMap = new Map<string, ProviderCatalogItem>();
    for (const provider of providers) {
      if (provider.isCustom) {
        continue;
      }
      const normalizedId = normalizeProviderCatalogKey(provider.providerId);
      if (!normalizedId || catalogMap.has(normalizedId)) {
        continue;
      }
      catalogMap.set(normalizedId, {
        id: provider.providerId,
        name: provider.displayName || provider.providerId,
        baseUrl: provider.baseUrl || '',
        tags: PROVIDER_TAGS[normalizedId],
        popular: POPULAR_PROVIDER_IDS.has(normalizedId),
        defaultProtocol: inferProviderProtocol(provider),
      });
    }
    for (const item of CUSTOM_PROVIDER_CATALOG) {
      catalogMap.set(item.id, item);
    }
    return Array.from(catalogMap.values()).sort((left, right) => {
      if (Boolean(left.popular) !== Boolean(right.popular)) {
        return left.popular ? -1 : 1;
      }
      return left.name.localeCompare(right.name, 'zh-CN');
    });
  }, [providers]);

  const filteredCatalog = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return providerCatalog.filter((item) => {
      if (!item.custom && managedProviderIds.has(normalizeProviderCatalogKey(item.id))) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return item.name.toLowerCase().includes(keyword) || item.id.toLowerCase().includes(keyword);
    });
  }, [providerCatalog, search, managedProviderIds]);
  const popularCatalog = filteredCatalog.filter((item) => item.popular);
  const otherCatalog = filteredCatalog.filter((item) => !item.popular);

  const handleDisconnect = async (providerId: string) => {
    setActionLoading(`disconnect:${providerId}`);
    try {
      await toggleManagementProviderEnabled(providerId, false);
      await loadProviders();
    } catch (error) {
      console.error('[Settings][Providers] 断开失败:', error);
      setErrorMessage('断开失败，请稍后重试。');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDiscoverModels = async (provider: ManagementProviderOption) => {
    const providerId = provider.providerId;
    setActionLoading(`discover:${providerId}`);
    setErrorMessage('');
    try {
      const result = await discoverManagementProviderModels(providerId);
      setProviderCheckMap((current) => ({
        ...current,
        [providerId]: {
          status: result.status || (result.ok ? 'ok' : 'connection_error'),
          message: result.message,
        },
      }));
      await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取模型失败';
      setProviderCheckMap((current) => ({
        ...current,
        [providerId]: {
          status: 'connection_error',
          message,
        },
      }));
      setErrorMessage(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    setActionLoading(`delete:${providerId}`);
    setErrorMessage('');
    try {
      await deleteManagementProviderConfig(providerId);
      setProviderCheckMap((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      if (configForm?.providerId === providerId) {
        setConfigOpen(false);
        setConfigForm(null);
      }
      await loadProviders();
    } catch (error) {
      console.error('[Settings][Providers] 删除失败:', error);
      setErrorMessage(error instanceof Error ? error.message : '删除失败，请稍后重试。');
    } finally {
      setActionLoading(null);
    }
  };

  const openConfigureForProvider = (provider: ManagementProviderOption) => {
    const cfg = configMap.get(provider.providerId);
    setErrorMessage('');
    setConfigForm(createFormFromProvider(provider, cfg));
    setConfigOpen(true);
  };

  const openConfigureFromCatalog = (item: ProviderCatalogItem) => {
    setSelectorOpen(false);
    setSearch('');
    setErrorMessage('');
    setConfigForm(createFormFromCatalog(item));
    setConfigOpen(true);
  };

  const saveProviderConfig = async () => {
    if (!configForm) return;
    const providerId = configForm.providerId.trim();
    if (!providerId) {
      setErrorMessage('Provider ID 不能为空。');
      return;
    }

    const models = parseModelsText(configForm.modelsText);
    setActionLoading(providerId);
    try {
      if (configForm.isNew && configForm.isCustom) {
        await createManagementCustomProvider({
          id: providerId,
          display_name: configForm.displayName.trim() || providerId,
          protocol: configForm.protocol,
          base_url: configForm.baseUrl.trim() || undefined,
          api_key: configForm.apiKey.trim() || undefined,
          models,
          enabled: true,
        });
      } else {
        await updateManagementProviderConfig(providerId, {
          display_name: configForm.displayName.trim() || undefined,
          protocol: configForm.protocol,
          base_url: configForm.baseUrl.trim() || undefined,
          api_key: configForm.apiKey.trim() || undefined,
          models,
          is_custom: configForm.isCustom,
        });
        try {
          await toggleManagementProviderEnabled(providerId, true);
        } catch (error) {
          console.warn('[Settings][Providers] 启用供应商失败，将保留已保存配置:', error);
        }
      }
      setConfigOpen(false);
      setConfigForm(null);
      await loadProviders();
    } catch (error) {
      console.error('[Settings][Providers] 保存配置失败:', error);
      setErrorMessage('保存失败，请检查 URL / 密钥 / 模型格式。');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteProviderFromDialog = async () => {
    if (!configForm) {
      return;
    }
    const providerId = configForm.providerId.trim();
    if (!providerId) {
      return;
    }
    await handleDeleteProvider(providerId);
  };

  const renderCatalogItem = (item: ProviderCatalogItem) => (
    <button
      key={item.id}
      type="button"
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-background-secondary/60 transition-colors border border-transparent hover:border-border-light text-left"
      onClick={() => openConfigureFromCatalog(item)}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-[11px] font-semibold text-foreground-secondary shrink-0">
          {(item.name.slice(0, 2) || 'AI').toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{item.name}</div>
          <div className="text-xs text-foreground-tertiary truncate">{item.id}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px]">
          {item.defaultProtocol}
        </Badge>
        {item.tags?.map((tag) => (
          <Badge key={tag} variant="outline" className="text-[10px]">
            {tag}
          </Badge>
        ))}
      </div>
    </button>
  );

  const providerMap = useMemo(() => {
    return new Map(providers.map((item) => [item.providerId, item]));
  }, [providers]);

  return (
    <div className="max-w-3xl animate-fade-in opacity-0">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-semibold">提供商管理</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={() => loadProviders()}
            disabled={loading}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            {t('settings.providers.refresh')}
          </Button>
          <Button size="sm" className="h-8 px-3 gap-1.5" onClick={() => setSelectorOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            连接新提供商
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      <div className="bg-background-secondary/30 rounded-2xl overflow-hidden border border-border-light/50">
        {loading ? (
          <div className="p-8 text-center text-foreground-secondary">{t('settings.providers.loading')}</div>
        ) : managedProviders.length === 0 ? (
          <div className="p-10 text-center text-foreground-secondary space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl border border-dashed border-border-light flex items-center justify-center">
              <Bot className="w-7 h-7 opacity-60" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">还没有已连接的供应商</p>
              <p className="text-xs text-foreground-tertiary mt-1">
                全新安装默认不会展示内置候选供应商，点击下方按钮手动添加你的第一个供应商
              </p>
            </div>
            <Button variant="outline" className="gap-2" onClick={() => setSelectorOpen(true)}>
              <Plus className="w-4 h-4" />
              + 连接新提供商
            </Button>
          </div>
        ) : (
          managedProviders.map((provider, index) => (
            (() => {
              const providerId = provider.providerId;
              const providerCfg = configMap.get(providerId);
              const discoverActionKey = `discover:${providerId}`;
              const disconnectActionKey = `disconnect:${providerId}`;
              const deleteActionKey = `delete:${providerId}`;
              const providerHealth = providerHealthLabel(provider, providerCheckMap[providerId]);
              const discoverDisabled =
                !provider.enabled ||
                !authConfigured(provider, providerCfg) ||
                actionLoading === discoverActionKey;
              return (
                <div
                  key={providerId}
                  className={cn(
                    'flex items-center justify-between p-5',
                    index !== managedProviders.length - 1 && 'border-b border-border-light',
                  )}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center text-xs font-semibold shrink-0">
                      {(provider.displayName.slice(0, 2) || 'AI').toUpperCase()}
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-medium text-foreground">{provider.displayName}</span>
                        <span className={cn('inline-flex items-center gap-1 text-xs', providerHealth.tone)}>
                          <Circle className="w-2.5 h-2.5 fill-current" />
                          {providerHealth.text}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {toProtocol(provider.protocol)}
                        </Badge>
                      </div>
                      <p className="text-xs text-foreground-tertiary truncate">
                        {authStatusLabel(authConfigured(provider, providerCfg), t)} · {providerId}
                      </p>
                      <p className="text-xs text-foreground-tertiary truncate">
                        {providerSummaryText(provider, providerCheckMap[providerId], providerCfg)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => openConfigureForProvider(provider)}
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      配置
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => handleDiscoverModels(provider)}
                      disabled={discoverDisabled}
                    >
                      <RefreshCw className={cn('w-3.5 h-3.5', actionLoading === discoverActionKey && 'animate-spin')} />
                      获取模型
                    </Button>
                    {provider.enabled ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDisconnect(providerId)}
                        disabled={actionLoading === disconnectActionKey}
                      >
                        <Unplug className="w-3.5 h-3.5" />
                        断开
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteProvider(providerId)}
                        disabled={actionLoading === deleteActionKey}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()
          ))
        )}
      </div>

      {managedProviders.length > 0 && (
        <button
          type="button"
          className="mt-4 w-full rounded-2xl border-2 border-dashed border-border-light py-6 text-sm font-medium text-foreground-secondary hover:text-foreground hover:border-accent/50 hover:bg-background-secondary/20 transition-colors flex items-center justify-center gap-2"
          onClick={() => setSelectorOpen(true)}
        >
          <Link2 className="w-4 h-4" />
          + 连接新提供商
        </button>
      )}

      <Dialog open={selectorOpen} onOpenChange={setSelectorOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>选择提供商</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-foreground-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder="搜索提供商 (例如：Google, Azure...)"
              />
            </div>

            <div className="max-h-[52vh] overflow-y-auto space-y-5 pr-1">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-foreground-tertiary uppercase tracking-wider">热门推荐 Popular</div>
                <div className="space-y-1">
                  {popularCatalog.length > 0 ? popularCatalog.map(renderCatalogItem) : <div className="text-xs text-foreground-tertiary py-2 px-1">无匹配结果</div>}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-foreground-tertiary uppercase tracking-wider">全部 / 其他 Others</div>
                <div className="space-y-1">
                  {otherCatalog.length > 0 ? otherCatalog.map(renderCatalogItem) : <div className="text-xs text-foreground-tertiary py-2 px-1">无匹配结果</div>}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>配置提供商</DialogTitle>
          </DialogHeader>
          {configForm && (
            (() => {
              const currentProvider = providerMap.get(configForm.providerId);
              const canDelete = !configForm.isNew && currentProvider && !currentProvider.enabled;
              const saveButtonLabel =
                currentProvider && !currentProvider.enabled ? '保存并重连' : '保存配置';
              return (
                <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Provider ID</Label>
                  <Input
                    value={configForm.providerId}
                    onChange={(e) => setConfigForm((prev) => (prev ? { ...prev, providerId: e.target.value } : prev))}
                    disabled={!configForm.isNew || !configForm.isCustom}
                    placeholder="my-openai"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>显示名称</Label>
                  <Input
                    value={configForm.displayName}
                    onChange={(e) => setConfigForm((prev) => (prev ? { ...prev, displayName: e.target.value } : prev))}
                    placeholder="My Provider"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>协议格式</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={configForm.protocol === 'openai' ? 'default' : 'outline'}
                    onClick={() => setConfigForm((prev) => (prev ? { ...prev, protocol: 'openai' } : prev))}
                  >
                    OpenAI 规范
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={configForm.protocol === 'claude' ? 'default' : 'outline'}
                    onClick={() => setConfigForm((prev) => (prev ? { ...prev, protocol: 'claude' } : prev))}
                  >
                    Claude 规范
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Base URL</Label>
                <Input
                  value={configForm.baseUrl}
                  onChange={(e) => setConfigForm((prev) => (prev ? { ...prev, baseUrl: e.target.value } : prev))}
                  placeholder={configForm.protocol === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
                />
              </div>

              <div className="space-y-1.5">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={configForm.apiKey}
                  onChange={(e) => setConfigForm((prev) => (prev ? { ...prev, apiKey: e.target.value } : prev))}
                  placeholder={configMap.get(configForm.providerId)?.has_api_key ? '已设置 (输入新密钥以覆盖)' : 'sk-...'}
                />
                {configMap.get(configForm.providerId)?.has_api_key && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    当前已配置 API 密钥，若无需修改请留空。
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>模型列表（换行或逗号分隔）</Label>
                <Textarea
                  value={configForm.modelsText}
                  onChange={(e) => setConfigForm((prev) => (prev ? { ...prev, modelsText: e.target.value } : prev))}
                  placeholder={'gpt-4o-mini\nclaude-3-7-sonnet'}
                  className="min-h-[90px]"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  {canDelete && (
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={deleteProviderFromDialog}
                      disabled={actionLoading === `delete:${configForm.providerId}`}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      删除供应商
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => setConfigOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={saveProviderConfig} disabled={actionLoading === configForm.providerId}>
                    {saveButtonLabel}
                  </Button>
                </div>
              </div>
                </div>
              );
            })()
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
