import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RefreshCw, Save, Volume2 } from 'lucide-react';
import {
  getTtsStatus,
  installTtsRuntime,
  loadTtsEngine,
  setTtsConfig,
  startTtsDownload,
  unloadTtsEngine,
} from '@/services/tts-client';
import { DEFAULT_APP_TTS_SETTINGS, type AppTtsSettings, type RemoteTtsProviderId, type TtsManagementStatus } from '@/types/tts';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const EMPTY_STATUS: TtsManagementStatus = {
  config: DEFAULT_APP_TTS_SETTINGS,
  providerAvailable: true,
  modelReady: false,
  downloadActive: false,
  downloadedBytes: 0,
  totalBytes: 0,
  progressPercent: 0,
  currentFile: undefined,
  lastError: undefined,
  modelRootDir: '',
  modelDir: '',
  missingFiles: [],
  files: [],
  updatedAtMs: 0,
};

const REMOTE_PROVIDER_OPTIONS: Array<{ id: RemoteTtsProviderId; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'cosyvoice3', label: 'CosyVoice3' },
  { id: 'indextts', label: 'IndexTTS' },
  { id: 'qwen_tts', label: 'QWEN-TTS' },
];

export function TtsTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppTtsSettings>(DEFAULT_APP_TTS_SETTINGS);
  const [status, setStatus] = useState<TtsManagementStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loadingEngine, setLoadingEngine] = useState(false);
  const [preparingRuntime, setPreparingRuntime] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const next = await getTtsStatus();
      setStatus(next);
      setConfig(next.config);
    } catch (error) {
      alert(error instanceof Error ? error.message : '读取 TTS 配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (!status.downloadActive) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [status.downloadActive]);

  const statusLabel = useMemo(() => {
    if (status.downloadActive) {
      return '下载中';
    }
    if (config.local.status === 'loaded') {
      return '已加载';
    }
    if (status.modelReady) {
      return '已下载';
    }
    if (!config.enabled) {
      return '未启用';
    }
    return '未安装';
  }, [config.enabled, config.local.status, status.downloadActive, status.modelReady]);

  const activeRemoteConfig =
    config.remote.activeProvider === 'openai'
      ? config.remote.openai
      : config.remote.activeProvider === 'cosyvoice3'
        ? config.remote.cosyvoice3
        : config.remote.activeProvider === 'indextts'
          ? config.remote.indextts
          : config.remote.qwenTts;

  const updateActiveRemoteConfig = (patch: Partial<typeof activeRemoteConfig>) => {
    setConfig((prev) => {
      const nextRemote = { ...prev.remote };
      if (nextRemote.activeProvider === 'openai') {
        nextRemote.openai = { ...nextRemote.openai, ...patch };
      } else if (nextRemote.activeProvider === 'cosyvoice3') {
        nextRemote.cosyvoice3 = { ...nextRemote.cosyvoice3, ...patch };
      } else if (nextRemote.activeProvider === 'indextts') {
        nextRemote.indextts = { ...nextRemote.indextts, ...patch };
      } else {
        nextRemote.qwenTts = { ...nextRemote.qwenTts, ...patch };
      }
      return { ...prev, remote: nextRemote };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await setTtsConfig(config);
      setConfig(saved);
      const next = await getTtsStatus();
      setStatus(next);
      alert(t('settings.tts.saved', { defaultValue: 'TTS 配置已保存' }));
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存 TTS 配置失败');
    } finally {
      setSaving(false);
      setDownloading(false);
      setLoadingEngine(false);
    }
  };

  const persistConfig = async (): Promise<TtsManagementStatus> => {
    const saved = await setTtsConfig(config);
    setConfig(saved);
    const next = await getTtsStatus();
    setStatus(next);
    return next;
  };

  const toggleEngineLoad = async () => {
    const isLoaded = status.config.local.status === 'loaded';
    if (isLoaded) {
      setLoadingEngine(true);
    } else if (!status.modelReady) {
      setDownloading(true);
    } else {
      setLoadingEngine(true);
    }
    try {
      const latestStatus = await persistConfig();

      if (isLoaded) {
        const next = await unloadTtsEngine();
        setStatus(next);
        setConfig(next.config);
        return;
      }

      const shouldPrepareRuntime =
        latestStatus.config.mode === 'local'
        && latestStatus.config.local.enabled
        && latestStatus.config.local.device !== 'cpu';

      if (shouldPrepareRuntime) {
        setPreparingRuntime(true);
        const prepared = await installTtsRuntime();
        setStatus(prepared);
        setConfig(prepared.config);
      }

      if (!latestStatus.modelReady) {
        await startTtsDownload();
        await sleep(500);
        const next = await getTtsStatus();
        setStatus(next);
        setConfig(next.config);
        if (!next.modelReady) {
          return;
        }
      }

      const loaded = await loadTtsEngine();
      setStatus(loaded);
      setConfig(loaded.config);
    } catch (error) {
      alert(error instanceof Error ? error.message : '切换 TTS 引擎状态失败');
    } finally {
      setPreparingRuntime(false);
      setLoadingEngine(false);
      setDownloading(false);
    }
  };

  const isLocalMode = config.mode === 'local';
  const localActionBusy = downloading || loadingEngine || status.downloadActive || preparingRuntime || saving;
  const localActionLabel = status.downloadActive
    ? '正在下载模型...'
    : preparingRuntime
      ? '正在准备加速环境...'
    : loadingEngine
      ? '处理中...'
      : status.config.local.status === 'loaded'
        ? '停止本地语音'
        : status.modelReady
          ? '启动本地语音'
          : '启动并自动下载';

  return (
    <div className="max-w-5xl animate-fade-in opacity-0">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Volume2 className="h-5 w-5" />
            {t('settings.tts.title', { defaultValue: '语音 / TTS' })}
          </h2>
          <p className="text-sm text-foreground-secondary">
            {t('settings.tts.subtitle', {
              defaultValue:
                '只保留本地 / 远程切换和最少必填项。本地首次启动会自动准备环境、下载模型并加载。',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => void loadStatus()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('settings.tts.refresh', { defaultValue: '刷新状态' })}
          </Button>
          <Button size="sm" className="h-9 gap-2" onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? t('settings.loading') : t('common.save')}
          </Button>
        </div>
      </div>

      <div className="grid gap-5">
        <Card className="border-border-light/50 bg-background-secondary/20 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">全局开关</CardTitle>
                <p className="text-sm text-foreground-secondary">
                  先选模式，再决定是否启用。智能体默认继承这里的设置。
                </p>
              </div>
              <Badge variant="outline" className="h-6 px-2 text-[11px] font-medium">
                {statusLabel}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-background px-4 py-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">启用全局 TTS</div>
                  <div className="text-xs text-foreground-secondary">关闭后不生成任何语音。</div>
                </div>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, enabled: checked }))}
                />
              </div>
              <div className="grid gap-2 rounded-2xl border border-border/50 bg-background px-4 py-3">
                <Label className="text-xs font-medium text-foreground-secondary">模式</Label>
                <Select
                  value={config.mode}
                  onValueChange={(value) => setConfig((prev) => ({ ...prev, mode: value === 'remote' ? 'remote' : 'local' }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">本地</SelectItem>
                    <SelectItem value="remote">远程 API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isLocalMode ? (
              <div className="grid gap-4 rounded-3xl border border-border/50 bg-background px-5 py-5">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">本地 F5-TTS-ONNX</div>
                  <div className="text-xs leading-5 text-foreground-secondary">
                    点一次启动即可。系统会自动准备加速环境、下载模型并加载。
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
                  <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-background px-4 py-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">启用本地语音</div>
                      <div className="text-xs text-foreground-secondary">关闭后不使用本地 TTS。</div>
                    </div>
                    <Switch
                      checked={config.local.enabled}
                      onCheckedChange={(checked) =>
                        setConfig((prev) => ({ ...prev, local: { ...prev.local, enabled: checked } }))
                      }
                    />
                  </div>

                  <div className="grid gap-2 rounded-2xl border border-border/50 bg-background px-4 py-3">
                    <Label className="text-xs font-medium text-foreground-secondary">运行设备</Label>
                    <Select
                      value={config.local.device}
                      onValueChange={(value) =>
                        setConfig((prev) => ({
                          ...prev,
                          local: {
                            ...prev.local,
                            device:
                              value === 'cpu' || value === 'directml' || value === 'openvino'
                                ? value
                                : 'auto',
                          },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自动</SelectItem>
                        <SelectItem value="cpu">CPU</SelectItem>
                        <SelectItem value="directml">DirectML</SelectItem>
                        <SelectItem value="openvino">OpenVINO</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 rounded-2xl border border-border/50 bg-background px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">一键启动</div>
                      <div className="text-xs text-foreground-secondary">
                        自动保存当前设置，并完成环境准备、模型下载和加载。
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-9 min-w-36"
                      onClick={() => void toggleEngineLoad()}
                      disabled={localActionBusy || !config.enabled || !config.local.enabled}
                    >
                      {localActionLabel}
                    </Button>
                  </div>
                  <div className="text-xs text-foreground-secondary">
                    选择 `自动` 或 `DirectML` 时会优先准备 GPU 执行环境；只有明确选 `CPU` 才会跳过。
                  </div>
                  <Progress value={status.modelReady ? 100 : status.progressPercent} className="h-2" />
                  <div className="flex flex-wrap items-center gap-3 text-xs text-foreground-secondary">
                    <span>
                      {formatBytes(status.downloadedBytes)} / {formatBytes(status.totalBytes)}
                    </span>
                    {status.currentFile ? <span>{status.currentFile}</span> : <span>等待启动</span>}
                    {status.lastError ? <span className="text-destructive">{status.lastError}</span> : null}
                  </div>
                </div>

                {status.missingFiles.length > 0 && !status.downloadActive ? (
                  <div className="rounded-2xl border border-dashed border-border/60 px-4 py-3 text-xs text-foreground-secondary">
                    当前还没有本地模型，点击上方按钮后会自动补齐所需文件。
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-4 rounded-3xl border border-border/50 bg-background px-5 py-5">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">远程 Provider 预留</div>
                  <div className="text-xs leading-5 text-foreground-secondary">
                    这里只保存远程配置，实际远程推理暂未接入。
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label className="text-xs font-medium text-foreground-secondary">默认远程 Provider</Label>
                  <Select
                    value={config.remote.activeProvider}
                    onValueChange={(value) =>
                      setConfig((prev) => ({
                        ...prev,
                        remote: {
                          ...prev.remote,
                          activeProvider:
                            value === 'cosyvoice3' || value === 'indextts' || value === 'qwen_tts' ? value : 'openai',
                        },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REMOTE_PROVIDER_OPTIONS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-background px-4 py-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">启用当前远程 Provider</div>
                    <div className="text-xs text-foreground-secondary">只保存配置，不触发真实请求。</div>
                  </div>
                  <Switch
                    checked={activeRemoteConfig.enabled}
                    onCheckedChange={(checked) => updateActiveRemoteConfig({ enabled: checked })}
                  />
                </div>

                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-foreground-secondary">Base URL</Label>
                    <Input
                      value={activeRemoteConfig.baseUrl}
                      onChange={(event) => updateActiveRemoteConfig({ baseUrl: event.target.value })}
                      placeholder="https://your-tts-service/v1"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-foreground-secondary">API Key 环境变量</Label>
                    <Input
                      value={activeRemoteConfig.apiKeyEnv || ''}
                      onChange={(event) => updateActiveRemoteConfig({ apiKeyEnv: event.target.value || undefined })}
                      placeholder="OPENAI_API_KEY"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-foreground-secondary">模型 / 音色</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        value={activeRemoteConfig.model || ''}
                        onChange={(event) => updateActiveRemoteConfig({ model: event.target.value || undefined })}
                        placeholder="模型 ID"
                      />
                      <Input
                        value={activeRemoteConfig.voice || ''}
                        onChange={(event) => updateActiveRemoteConfig({ voice: event.target.value || undefined })}
                        placeholder="音色 ID"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-foreground-secondary">输出格式 / 超时</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        value={activeRemoteConfig.format || ''}
                        onChange={(event) => updateActiveRemoteConfig({ format: event.target.value || undefined })}
                        placeholder="mp3 / wav / pcm"
                      />
                      <Input
                        type="number"
                        value={activeRemoteConfig.timeoutSecs ?? 30}
                        onChange={(event) =>
                          updateActiveRemoteConfig({
                            timeoutSecs: Number.isFinite(Number(event.target.value))
                              ? Number(event.target.value)
                              : undefined,
                          })
                        }
                        min={1}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
