import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Circle, RefreshCw, Search } from 'lucide-react';
import { pushInAppNotice } from '@/services/in-app-notifier';
import {
  listManagementModels,
  listManagementProviderConfigs,
  listManagementProviders,
  setManagementDefaultModel,
  testManagementModelConnection,
  toggleManagementModelEnabled,
  type ManagementModelsPayload,
  type ManagementModelOption,
  type ProviderConfigItem,
} from '@/services/management-client';

function groupModelsByProvider(models: ManagementModelOption[]) {
  return models.reduce<Record<string, ManagementModelOption[]>>((acc, model) => {
    if (!acc[model.providerId]) {
      acc[model.providerId] = [];
    }
    acc[model.providerId].push(model);
    return acc;
  }, {});
}

export function ModelsTab() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<{
    providerId: string;
    displayName: string;
    enabled: boolean;
    linked: boolean;
    configured: boolean;
    healthy: boolean;
    hasSavedConfig: boolean;
  }[]>([]);
  const [models, setModels] = useState<ManagementModelOption[]>([]);
  const [modelsMeta, setModelsMeta] = useState<Pick<ManagementModelsPayload, 'defaultModelId' | 'defaultModelValid' | 'defaultModelReason'>>({
    defaultModelId: undefined,
    defaultModelValid: true,
    defaultModelReason: undefined,
  });
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testStatusMap, setTestStatusMap] = useState<Record<string, { ok: boolean; message: string }>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const [providerRows, providerConfigRows, modelRows] = await Promise.all([
        listManagementProviders(),
        listManagementProviderConfigs(),
        listManagementModels(),
      ]);
      const configMap = new Map<string, ProviderConfigItem>(
        providerConfigRows.map((item) => [item.provider_id, item]),
      );
      setProviders(
        providerRows.map((item) => ({
          providerId: item.providerId,
          displayName: configMap.get(item.providerId)?.display_name || item.displayName,
          enabled: item.enabled,
          linked: item.linked,
          configured: item.configured,
          healthy: item.healthy,
          hasSavedConfig: configMap.has(item.providerId),
        })),
      );
      setModels(modelRows.models);
      setModelsMeta({
        defaultModelId: modelRows.defaultModelId,
        defaultModelValid: modelRows.defaultModelValid,
        defaultModelReason: modelRows.defaultModelReason,
      });
      setTestStatusMap((prev) => {
        const visibleModelIds = new Set(modelRows.models.map((item) => item.modelId));
        return Object.fromEntries(
          Object.entries(prev).filter(([modelId]) => visibleModelIds.has(modelId)),
        );
      });
      setSelectedProviderId((prev) => {
        const selectableProviderIds = providerRows
          .filter((item) => item.enabled && configMap.has(item.providerId))
          .map((item) => item.providerId);
        if (selectableProviderIds.includes(prev)) {
          return prev;
        }
        if (selectableProviderIds.length > 0) {
          return selectableProviderIds[0];
        }
        const providersFromModels = Array.from(
          new Set(
            modelRows.models
              .map((item) => item.providerId)
              .filter((providerId) => configMap.has(providerId)),
          ),
        );
        if (providersFromModels.includes(prev)) {
          return prev;
        }
        return providersFromModels[0] ?? '';
      });
    } catch (error) {
      console.error('[Models] 加载失败:', error);
      alert(t('settings.models.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const providerMap = useMemo(() => {
    return new Map(providers.map((item) => [item.providerId, item.displayName]));
  }, [providers]);

  const providerEnabledMap = useMemo(() => {
    return new Map(providers.map((item) => [item.providerId, item.enabled]));
  }, [providers]);
  const providerLinkedMap = useMemo(() => {
    return new Map(providers.map((item) => [item.providerId, item.linked]));
  }, [providers]);

  const filteredModels = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    let filtered = models.filter((model) => {
      const providerEnabled = providerEnabledMap.get(model.providerId);
      const providerLinked = providerLinkedMap.get(model.providerId);
      return providerEnabled !== false && providerLinked !== false;
    });

    if (selectedProviderId) {
      filtered = filtered.filter((model) => model.providerId === selectedProviderId);
    }

    if (enabledOnly) {
      filtered = filtered.filter((model) => model.enabled);
    }

    if (!keyword) {
      return filtered;
    }
    return filtered.filter((model) => {
      const display = model.displayName.toLowerCase();
      const modelId = model.modelId.toLowerCase();
      return display.includes(keyword) || modelId.includes(keyword);
    });
  }, [models, searchQuery, enabledOnly, providerEnabledMap, providerLinkedMap, selectedProviderId]);

  const modelsByProvider = useMemo(() => {
    return groupModelsByProvider(filteredModels);
  }, [filteredModels]);

  const selectableProviders = useMemo(() => {
    return providers.filter((item) => item.enabled && item.hasSavedConfig);
  }, [providers]);

  const providerIds = useMemo(() => {
    if (selectedProviderId) {
      return [selectedProviderId];
    }
    return [];
  }, [selectedProviderId]);

  const handleSetDefault = async (modelId: string) => {
    const prev = models;
    setModels((current) =>
      current.map((model) => ({
        ...model,
        isDefault: model.modelId === modelId,
        enabled: model.modelId === modelId ? true : model.enabled,
      })),
    );
    setActionLoading(modelId);
    try {
      await setManagementDefaultModel(modelId);
    } catch (error) {
      console.error('[Models] 设置默认失败:', error);
      setModels(prev);
      alert(t('settings.saveFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleModel = async (modelId: string, enabled: boolean) => {
    const prev = models;
    setModels((current) =>
      current.map((model) => {
        if (model.modelId !== modelId) {
          return model;
        }
        return {
          ...model,
          enabled,
          isDefault: enabled ? model.isDefault : false,
        };
      }),
    );
    setActionLoading(modelId);
    try {
      await toggleManagementModelEnabled(modelId, enabled);
    } catch (error) {
      console.error('[Settings][Models] 切换模型失败:', error);
      setModels(prev);
      alert(t('settings.models.toggleFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRefreshProvider = async (_providerId: string) => {
    setActionLoading(_providerId);
    try {
      await loadData();
    } catch (error) {
      console.error('[Settings][Models] 刷新模型失败:', error);
      alert(t('settings.models.refreshFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRefreshAll = async () => {
    if (!providers.length) return;
    setActionLoading('all');
    try {
      await loadData();
    } catch (error) {
      console.error('[Settings][Models] 刷新全部失败:', error);
      alert(t('settings.models.refreshFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleTestModel = async (model: ManagementModelOption) => {
    setTestingModelId(model.modelId);
    try {
      const result = await testManagementModelConnection({
        provider: model.providerId,
        model: model.modelName,
        modelId: model.modelId,
      });
      setTestStatusMap((current) => ({
        ...current,
        [model.modelId]: {
          ok: result.ok,
          message: result.message,
        },
      }));
      if (!result.ok) {
        pushInAppNotice({
          title: '模型连接测试失败',
          message: result.message || '未知错误',
          level: 'error',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试请求失败';
      setTestStatusMap((current) => ({
        ...current,
        [model.modelId]: {
          ok: false,
          message,
        },
      }));
      pushInAppNotice({
        title: '模型连接测试失败',
        message,
        level: 'error',
      });
    } finally {
      setTestingModelId(null);
    }
  };

  return (
    <div className="max-w-3xl animate-fade-in opacity-0">
      <div className="mb-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('settings.models.title')}</h2>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={handleRefreshAll}
            disabled={actionLoading === 'all'}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', actionLoading === 'all' && 'animate-spin')} />
            {t('settings.models.refreshAll')}
          </Button>
        </div>
        {!modelsMeta.defaultModelValid && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            当前没有有效默认模型，请先启用一个模型并设为默认。原因：{modelsMeta.defaultModelReason || 'missing_or_unavailable'}
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="w-52">
            <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
              <SelectTrigger className="h-9 bg-background-secondary/30 border-border-light/50">
                <SelectValue placeholder="选择供应商" />
              </SelectTrigger>
              <SelectContent>
                {selectableProviders.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    暂无可用供应商
                  </SelectItem>
                ) : (
                  selectableProviders.map((provider) => (
                    <SelectItem key={provider.providerId} value={provider.providerId}>
                      {provider.displayName}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-foreground-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('settings.models.searchPlaceholder')}
              className="h-9 pl-9 bg-background-secondary/30 border-border-light/50"
            />
          </div>
          <div className="flex items-center gap-2 px-2">
            <Label className="text-xs text-foreground-secondary">
              {t('settings.models.enabledOnly')}
            </Label>
            <Switch
              checked={enabledOnly}
              onCheckedChange={setEnabledOnly}
              className="data-[state=checked]:bg-accent"
            />
          </div>
        </div>

        {loading && models.length === 0 ? (
          <div className="p-8 text-center text-foreground-secondary">{t('settings.models.loading')}</div>
        ) : selectableProviders.length === 0 ? (
          <div className="p-8 text-center text-foreground-secondary">
            请先在“供应商管理”中连接并配置一个供应商（URL + API Key）
          </div>
        ) : !selectedProviderId ? (
          <div className="p-8 text-center text-foreground-secondary">请选择一个供应商</div>
        ) : models.length === 0 ? (
          <div className="p-8 text-center text-foreground-secondary">{t('settings.models.empty')}</div>
        ) : (
          <div className="space-y-4">
            {providerIds.map((providerId) => {
              const providerModels = modelsByProvider[providerId] ?? [];
              if (providerModels.length === 0) return null;
              return (
                <div key={providerId} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      {providerMap.get(providerId) ?? providerId}
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-foreground-secondary hover:text-foreground h-7"
                      onClick={() => handleRefreshProvider(providerId)}
                      disabled={actionLoading === providerId}
                    >
                      <RefreshCw className={cn('w-4 h-4 mr-1', actionLoading === providerId && 'animate-spin')} />
                      {t('settings.models.refreshProvider')}
                    </Button>
                  </div>

                  <div className="bg-background-secondary/30 rounded-xl overflow-hidden border border-border-light/50">
                    {providerModels.map((model, index) => {
                      const testStatus = testStatusMap[model.modelId];
                      return (
                        <div
                          key={model.modelId}
                          className={cn(
                            'flex items-center justify-between px-4 py-3',
                            index !== providerModels.length - 1 && 'border-b border-border-light',
                          )}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">
                              {model.displayName}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="text-[10px]">{model.modelId}</Badge>
                              <Badge variant={model.enabled ? 'success' : 'secondary'} className="text-[10px]">
                                {model.enabled ? t('settings.models.enabled') : t('settings.models.disabled')}
                              </Badge>
                              {model.isDefault && (
                                <Badge variant="outline" className="text-[10px]">{t('settings.models.default')}</Badge>
                              )}
                              {testStatus?.ok && (
                                <span className="inline-flex items-center gap-1 text-xs text-success">
                                  <Circle className="w-2.5 h-2.5 fill-current" />
                                  正常
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn(
                                'h-7 px-2.5',
                                testStatus && !testStatus.ok && 'border-destructive/40 text-destructive hover:text-destructive',
                              )}
                              onClick={() => handleTestModel(model)}
                              disabled={testingModelId === model.modelId}
                              title={testStatus && !testStatus.ok ? testStatus.message : '测试模型连接'}
                            >
                              <RefreshCw className={cn('w-3.5 h-3.5 mr-1', testingModelId === model.modelId && 'animate-spin')} />
                              测试
                            </Button>
                            {!model.isDefault && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5"
                                onClick={() => handleSetDefault(model.modelId)}
                                disabled={actionLoading === model.modelId || testingModelId === model.modelId}
                              >
                                {t('settings.models.setDefault')}
                              </Button>
                            )}
                            <Switch
                              checked={model.enabled}
                              onCheckedChange={(checked) => handleToggleModel(model.modelId, checked)}
                              className="data-[state=checked]:bg-accent"
                              disabled={actionLoading === model.modelId || testingModelId === model.modelId}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
