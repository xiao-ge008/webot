import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Link2, CloudCog, Save, RefreshCw } from 'lucide-react';
import {
  getComponentProviderConfigs,
  setComponentProviderConfigs,
  type ComponentProviderConfigs,
} from '@/services/component-client';

const EMPTY_CONFIGS: ComponentProviderConfigs = {
  comfyui: {
    serverUrl: 'http://127.0.0.1:8188',
    apiKey: '',
  },
  runninghub: {
    serverUrl: 'https://www.runninghub.ai',
    apiKey: '',
  },
};

export function ComponentProvidersTab() {
  const { t } = useTranslation();
  const [configs, setConfigs] = useState<ComponentProviderConfigs>(EMPTY_CONFIGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const next = await getComponentProviderConfigs();
      setConfigs(next);
    } catch (error) {
      alert(error instanceof Error ? error.message : t('settings.componentProviders.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const next = await setComponentProviderConfigs(configs);
      setConfigs(next);
      alert(t('settings.componentProviders.saved'));
    } catch (error) {
      alert(error instanceof Error ? error.message : t('settings.componentProviders.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const renderProvider = (
    key: 'comfyui' | 'runninghub',
    title: string,
    description: string,
    badge: string,
  ) => (
    <Card className="border-border-light/50 bg-background-secondary/20 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-sm text-foreground-secondary">{description}</p>
          </div>
          <Badge variant="outline" className="h-6 px-2 text-[11px] font-medium">
            {badge}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label className="text-xs font-medium text-foreground-secondary">
            {t('settings.componentProviders.serverUrl')}
          </Label>
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
            <Input
              value={configs[key].serverUrl}
              onChange={(event) =>
                setConfigs((prev) => ({
                  ...prev,
                  [key]: {
                    ...prev[key],
                    serverUrl: event.target.value,
                  },
                }))
              }
              placeholder={t('settings.componentProviders.serverUrlPlaceholder')}
              className="h-10 pl-9"
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label className="text-xs font-medium text-foreground-secondary">
            {t('settings.componentProviders.apiKey')}
          </Label>
          <Textarea
            value={configs[key].apiKey}
            onChange={(event) =>
              setConfigs((prev) => ({
                ...prev,
                [key]: {
                  ...prev[key],
                  apiKey: event.target.value,
                },
              }))
            }
            placeholder={t('settings.componentProviders.apiKeyPlaceholder')}
            className="min-h-[88px]"
          />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="max-w-4xl animate-fade-in opacity-0">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">{t('settings.componentProviders.title')}</h2>
          <p className="text-sm text-foreground-secondary">{t('settings.componentProviders.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('settings.refresh')}
          </Button>
          <Button size="sm" className="h-9 gap-2" onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? t('settings.loading') : t('common.save')}
          </Button>
        </div>
      </div>

      <div className="grid gap-5">
        {renderProvider(
          'comfyui',
          t('settings.componentProviders.comfyuiTitle'),
          t('settings.componentProviders.comfyuiDesc'),
          'ComfyUI',
        )}
        {renderProvider(
          'runninghub',
          t('settings.componentProviders.runninghubTitle'),
          t('settings.componentProviders.runninghubDesc'),
          'RunningHub',
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-border-light/40 bg-background-secondary/20 p-4 text-xs text-foreground-secondary">
        <div className="flex items-center gap-2 text-foreground">
          <CloudCog className="h-4 w-4" />
          <span>{t('settings.componentProviders.hintTitle')}</span>
        </div>
        <p className="mt-2 leading-6">{t('settings.componentProviders.hint')}</p>
      </div>
    </div>
  );
}
