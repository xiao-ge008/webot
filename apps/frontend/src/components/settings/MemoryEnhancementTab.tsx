import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  getManagementMemoryEnhancementConfig,
  setManagementMemoryEnhancementConfig,
  type MemoryEnhancementConfig,
  type MemoryEnhancementModelConfig,
} from '@/services/management-client';

type MetaState = {
  source?: string;
  configured?: boolean;
};

export function MemoryEnhancementTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<MemoryEnhancementConfig | null>(null);
  const [meta, setMeta] = useState<MetaState>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  const loadConfig = async () => {
    setLoading(true);
    setErrorMessage('');
    setSavedMessage('');
    try {
      const payload = await getManagementMemoryEnhancementConfig();
      setConfig(payload.config);
      setMeta({
        source: payload.source,
        configured: payload.configured,
      });
    } catch (error) {
      console.error('[Settings][MemoryEnhancement] 加载失败:', error);
      setErrorMessage(t('settings.memoryEnhancement.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const updateRoot = <K extends keyof MemoryEnhancementConfig>(
    key: K,
    value: MemoryEnhancementConfig[K],
  ) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateEmbedding = <K extends keyof MemoryEnhancementModelConfig>(
    key: K,
    value: MemoryEnhancementModelConfig[K],
  ) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        embedding: {
          ...prev.embedding,
          [key]: value,
        },
      };
    });
  };

  const updateLlm = <K extends keyof MemoryEnhancementModelConfig>(
    key: K,
    value: MemoryEnhancementModelConfig[K],
  ) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        llm: {
          ...prev.llm,
          [key]: value,
        },
      };
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setErrorMessage('');
    setSavedMessage('');
    try {
      const payload = await setManagementMemoryEnhancementConfig(config);
      setConfig(payload.config);
      setMeta({
        source: payload.source,
        configured: payload.configured,
      });
      setSavedMessage(t('settings.memoryEnhancement.saved'));
    } catch (error) {
      console.error('[Settings][MemoryEnhancement] 保存失败:', error);
      setErrorMessage(t('settings.memoryEnhancement.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl animate-fade-in opacity-0">
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t('settings.memoryEnhancement.title')}</h2>
          <p className="text-xs text-foreground-secondary">
            {t('settings.memoryEnhancement.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={() => loadConfig()}
            disabled={loading}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            {t('settings.refresh')}
          </Button>
          <Button
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={handleSave}
            disabled={saving || loading || !config}
          >
            <Save className={cn('w-3.5 h-3.5', saving && 'animate-pulse')} />
            {t('settings.save')}
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
          {errorMessage}
        </div>
      )}
      {savedMessage && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-success/10 border border-success/20 text-xs text-success">
          {savedMessage}
        </div>
      )}

      {!config ? (
        <div className="p-8 text-center text-foreground-secondary">{t('settings.loading')}</div>
      ) : (
        <>
          <div className="bg-background-secondary/30 rounded-2xl border border-border-light/50 p-5 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={config.enabled ? 'success' : 'secondary'}>
                {config.enabled
                  ? t('settings.memoryEnhancement.enabled')
                  : t('settings.memoryEnhancement.disabled')}
              </Badge>
              <Badge variant="outline">
                {t('settings.memoryEnhancement.source')}: {meta.source ?? '-'}
              </Badge>
              <Badge variant="outline">
                {t('settings.memoryEnhancement.configured')}:{' '}
                {meta.configured
                  ? t('settings.memoryEnhancement.yes')
                  : t('settings.memoryEnhancement.no')}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t('settings.memoryEnhancement.switch')}</p>
                <p className="text-xs text-foreground-secondary mt-1">
                  {t('settings.memoryEnhancement.switchDesc')}
                </p>
              </div>
              <Switch
                checked={config.enabled}
                onCheckedChange={(checked) => updateRoot('enabled', checked)}
                className="data-[state=checked]:bg-accent"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.mode')}</Label>
                <Select value={config.mode} onValueChange={(value) => updateRoot('mode', value)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="remote">remote</SelectItem>
                    <SelectItem value="local">local</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.timeoutMs')}</Label>
                <Input
                  type="number"
                  value={config.timeout_ms}
                  onChange={(e) => updateRoot('timeout_ms', Number(e.target.value) || 0)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.baseUrl')}</Label>
                <Input
                  value={config.base_url}
                  onChange={(e) => updateRoot('base_url', e.target.value)}
                  placeholder="https://..."
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.apiKey')}</Label>
                <Input
                  type="password"
                  value={config.api_key}
                  onChange={(e) => updateRoot('api_key', e.target.value)}
                  placeholder="sk-..."
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.agentId')}</Label>
                <Input
                  value={config.agent_id}
                  onChange={(e) => updateRoot('agent_id', e.target.value)}
                  placeholder="memory-agent"
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.targetUri')}</Label>
                <Input
                  value={config.target_uri}
                  onChange={(e) => updateRoot('target_uri', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.recallLimit')}</Label>
                <Input
                  type="number"
                  value={config.recall_limit}
                  onChange={(e) => updateRoot('recall_limit', Number(e.target.value) || 0)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.recallScore')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={config.recall_score_threshold}
                  onChange={(e) => updateRoot('recall_score_threshold', Number(e.target.value) || 0)}
                  className="h-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between rounded-xl border border-border-light/60 px-3 py-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.autoRecall')}</Label>
                <Switch
                  checked={config.auto_recall}
                  onCheckedChange={(checked) => updateRoot('auto_recall', checked)}
                  className="data-[state=checked]:bg-accent"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border-light/60 px-3 py-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.autoCapture')}</Label>
                <Switch
                  checked={config.auto_capture}
                  onCheckedChange={(checked) => updateRoot('auto_capture', checked)}
                  className="data-[state=checked]:bg-accent"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 bg-background-secondary/30 rounded-2xl border border-border-light/50 p-5">
            <h3 className="text-sm font-semibold mb-4">{t('settings.memoryEnhancement.embeddingTitle')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.provider')}</Label>
                <Input
                  value={config.embedding.provider}
                  onChange={(e) => updateEmbedding('provider', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.model')}</Label>
                <Input
                  value={config.embedding.model}
                  onChange={(e) => updateEmbedding('model', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.apiBase')}</Label>
                <Input
                  value={config.embedding.api_base}
                  onChange={(e) => updateEmbedding('api_base', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.apiKey')}</Label>
                <Input
                  type="password"
                  value={config.embedding.api_key}
                  onChange={(e) => updateEmbedding('api_key', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.dimension')}</Label>
                <Input
                  type="number"
                  value={config.embedding.dimension ?? 1536}
                  onChange={(e) => updateEmbedding('dimension', Number(e.target.value) || 0)}
                  className="h-9"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 bg-background-secondary/30 rounded-2xl border border-border-light/50 p-5">
            <h3 className="text-sm font-semibold mb-4">{t('settings.memoryEnhancement.llmTitle')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.provider')}</Label>
                <Input
                  value={config.llm.provider}
                  onChange={(e) => updateLlm('provider', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.model')}</Label>
                <Input
                  value={config.llm.model}
                  onChange={(e) => updateLlm('model', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.apiBase')}</Label>
                <Input
                  value={config.llm.api_base}
                  onChange={(e) => updateLlm('api_base', e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.apiKey')}</Label>
                <Input
                  type="password"
                  value={config.llm.api_key}
                  onChange={(e) => updateLlm('api_key', e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 bg-background-secondary/20 rounded-xl border border-border-light/30">
            <p className="text-xs text-foreground-secondary">{t('settings.memoryEnhancement.hint')}</p>
          </div>
        </>
      )}
    </div>
  );
}
