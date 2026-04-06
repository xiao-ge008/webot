import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Mic2, Plus, RefreshCw, Save, Trash2, Volume2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useGlobalAlert } from '@/providers/GlobalAlertProvider';
import {
  deleteGlobalSpeakerProfile,
  getTtsStatus,
  installTtsRuntime,
  loadTtsEngine,
  setTtsConfig,
  startTtsDownload,
  unloadTtsEngine,
  uploadGlobalSpeakerProfile,
} from '@/services/tts-client';
import {
  DEFAULT_APP_TTS_SETTINGS,
  type AgentSpeakerProfile,
  type AppTtsSettings,
  type RemoteTtsProviderId,
  type TtsManagementStatus,
} from '@/types/tts';

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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatDateLabel(raw?: string): string {
  if (!raw?.trim()) return '未记录';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TtsTab() {
  const { t } = useTranslation();
  const { showConfirm } = useGlobalAlert();
  const [config, setConfig] = useState<AppTtsSettings>(DEFAULT_APP_TTS_SETTINGS);
  const [status, setStatus] = useState<TtsManagementStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadRefText, setUploadRefText] = useState('');
  const [uploadLanguage, setUploadLanguage] = useState('zh');
  const [uploadNotes, setUploadNotes] = useState('');

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
    if (!status.downloadActive) return;
    const timer = window.setInterval(() => void loadStatus(), 1500);
    return () => window.clearInterval(timer);
  }, [status.downloadActive]);

  const activeRemoteConfig =
    config.remote.activeProvider === 'openai'
      ? config.remote.openai
      : config.remote.activeProvider === 'cosyvoice3'
        ? config.remote.cosyvoice3
        : config.remote.activeProvider === 'indextts'
          ? config.remote.indextts
          : config.remote.qwenTts;

  const statusLabel = useMemo(() => {
    if (!config.enabled) return '已关闭';
    if (status.downloadActive) return '下载中';
    if (config.mode === 'remote') return '远程模式';
    if (config.local.status === 'loaded') return '本地已加载';
    if (status.modelReady) return '模型已就绪';
    return '待准备';
  }, [config.enabled, config.local.status, config.mode, status.downloadActive, status.modelReady]);

  const speakerProfiles = [...config.speakerProfiles].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const patchActiveRemoteConfig = (patch: Partial<typeof activeRemoteConfig>) => {
    setConfig((prev) => {
      const remote = { ...prev.remote };
      if (remote.activeProvider === 'openai') remote.openai = { ...remote.openai, ...patch };
      else if (remote.activeProvider === 'cosyvoice3') remote.cosyvoice3 = { ...remote.cosyvoice3, ...patch };
      else if (remote.activeProvider === 'indextts') remote.indextts = { ...remote.indextts, ...patch };
      else remote.qwenTts = { ...remote.qwenTts, ...patch };
      return { ...prev, remote };
    });
  };

  const patchSpeakerProfile = (profileId: string, patch: Partial<AgentSpeakerProfile>) => {
    setConfig((prev) => ({
      ...prev,
      speakerProfiles: prev.speakerProfiles.map((item) =>
        item.id === profileId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item,
      ),
    }));
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
    }
  };

  const persistThenRefresh = async () => {
    const saved = await setTtsConfig(config);
    setConfig(saved);
    const next = await getTtsStatus();
    setStatus(next);
    return next;
  };

  const handleLocalAction = async () => {
    setActing(true);
    try {
      const latest = await persistThenRefresh();
      if (latest.config.local.status === 'loaded') {
        const next = await unloadTtsEngine();
        setStatus(next);
        setConfig(next.config);
      } else {
        if (latest.config.local.enabled && latest.config.local.device !== 'cpu') {
          const prepared = await installTtsRuntime();
          setStatus(prepared);
          setConfig(prepared.config);
        }
        if (!latest.modelReady) {
          await startTtsDownload();
          await sleep(500);
        }
        const loaded = await loadTtsEngine();
        setStatus(loaded);
        setConfig(loaded.config);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '切换本地语音失败');
    } finally {
      setActing(false);
    }
  };

  const resetUploadForm = () => {
    setUploadDialogOpen(false);
    setUploadFile(null);
    setUploadName('');
    setUploadRefText('');
    setUploadLanguage('zh');
    setUploadNotes('');
  };

  const handleUploadSpeaker = async () => {
    if (!uploadFile) return alert('请先选择 WAV 文件');
    if (!uploadName.trim()) return alert('请填写音色名称');
    if (!uploadRefText.trim()) return alert('请填写参考文本');
    setUploading(true);
    try {
      const next = await uploadGlobalSpeakerProfile({
        file: uploadFile,
        name: uploadName.trim(),
        refText: uploadRefText.trim(),
        language: uploadLanguage.trim() || undefined,
        notes: uploadNotes.trim() || undefined,
      });
      setStatus(next);
      setConfig(next.config);
      resetUploadForm();
    } catch (error) {
      alert(error instanceof Error ? error.message : '上传音色失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteSpeaker = async (profileId: string) => {
    if (!await showConfirm('删除后会从全局音色库移除，是否继续？', {
      title: '删除全局音色',
      confirmText: '删除',
      cancelText: '取消',
      variant: 'destructive',
    })) return;
    setDeletingId(profileId);
    try {
      const next = await deleteGlobalSpeakerProfile(profileId);
      setStatus(next);
      setConfig(next.config);
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除音色失败');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="max-w-5xl animate-fade-in opacity-0 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Volume2 className="h-5 w-5" />
            语音 / TTS
          </h2>
          <p className="text-sm text-foreground-secondary">
            先选模式，再操作当前模式的内容。上传音色和管理音色都集中在同一页。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-8 px-3 text-xs">
            {statusLabel}
          </Badge>
          <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => void loadStatus()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button size="sm" className="h-9 gap-2" onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? '保存中...' : '保存配置'}
          </Button>
        </div>
      </div>

      <Card className="shadow-none">
        <CardContent className="grid gap-4 p-5 md:grid-cols-[0.9fr_1.1fr]">
          <div className="flex items-center justify-between rounded-2xl border px-4 py-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">启用全局 TTS</div>
              <div className="text-xs text-foreground-secondary">关闭后所有智能体都不会继承全局语音能力。</div>
            </div>
            <Switch checked={config.enabled} onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, enabled: checked }))} />
          </div>

          <div className="grid gap-2 rounded-2xl border px-4 py-3">
            <Label className="text-xs text-foreground-secondary">当前模式</Label>
            <Select value={config.mode} onValueChange={(value) => setConfig((prev) => ({ ...prev, mode: value === 'remote' ? 'remote' : 'local' }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">本地 TTS</SelectItem>
                <SelectItem value="remote">远程 TTS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {config.mode === 'local' ? (
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4" />
              本地 TTS
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-2xl border px-4 py-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">启用本地语音</div>
                  <div className="text-xs text-foreground-secondary">建议第一次使用时保持开启。</div>
                </div>
                <Switch
                  checked={config.local.enabled}
                  onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, local: { ...prev.local, enabled: checked } }))}
                />
              </div>

              <div className="grid gap-2 rounded-2xl border px-4 py-3">
                <Label className="text-xs text-foreground-secondary">运行设备</Label>
                <Select
                  value={config.local.device}
                  onValueChange={(value) =>
                    setConfig((prev) => ({
                      ...prev,
                      local: {
                        ...prev.local,
                        device: value === 'cpu' || value === 'directml' || value === 'openvino' ? value : 'auto',
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

            <div className="rounded-2xl border px-4 py-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">一键处理本地模型</div>
                  <div className="text-xs text-foreground-secondary">会自动准备环境、下载模型并加载。</div>
                </div>
                <Button onClick={() => void handleLocalAction()} disabled={acting || !config.enabled || !config.local.enabled}>
                  {status.downloadActive ? '下载中...' : acting ? '处理中...' : status.config.local.status === 'loaded' ? '停止本地语音' : status.modelReady ? '加载本地语音' : '启动并下载'}
                </Button>
              </div>
              <Progress value={status.modelReady ? 100 : status.progressPercent} className="h-2" />
              <div className="flex flex-wrap gap-3 text-xs text-foreground-secondary">
                <span>{formatBytes(status.downloadedBytes)} / {formatBytes(status.totalBytes)}</span>
                <span>{status.currentFile || status.modelDir || '等待启动'}</span>
                {status.lastError ? <span className="text-destructive">{status.lastError}</span> : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">远程 TTS</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2 rounded-2xl border px-4 py-3">
                <Label className="text-xs text-foreground-secondary">默认服务</Label>
                <Select
                  value={config.remote.activeProvider}
                  onValueChange={(value) =>
                    setConfig((prev) => ({
                      ...prev,
                      remote: {
                        ...prev.remote,
                        activeProvider: value === 'cosyvoice3' || value === 'indextts' || value === 'qwen_tts' ? value : 'openai',
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

              <div className="flex items-center justify-between rounded-2xl border px-4 py-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">启用当前服务</div>
                  <div className="text-xs text-foreground-secondary">远程模式会使用这组参数。</div>
                </div>
                <Switch checked={activeRemoteConfig.enabled} onCheckedChange={(checked) => patchActiveRemoteConfig({ enabled: checked })} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Input value={activeRemoteConfig.voice || ''} onChange={(event) => patchActiveRemoteConfig({ voice: event.target.value || undefined })} placeholder="默认音色，例如 alloy" />
              <Input value={activeRemoteConfig.baseUrl} onChange={(event) => patchActiveRemoteConfig({ baseUrl: event.target.value })} placeholder="Base URL，留空用默认地址" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Input value={activeRemoteConfig.model || ''} onChange={(event) => patchActiveRemoteConfig({ model: event.target.value || undefined })} placeholder="模型，例如 gpt-4o-mini-tts" />
              <Input value={activeRemoteConfig.apiKeyEnv || ''} onChange={(event) => patchActiveRemoteConfig({ apiKeyEnv: event.target.value || undefined })} placeholder="API Key 环境变量，例如 OPENAI_API_KEY" />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mic2 className="h-4 w-4" />
              全局音色库
            </CardTitle>
            <Button size="sm" className="gap-2" onClick={() => setUploadDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              上传音色
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {speakerProfiles.length === 0 ? (
            <div className="rounded-2xl border-dashed border px-4 py-8 text-center text-sm text-foreground-secondary">
              还没有全局音色。点击右上角“上传音色”即可新增。
            </div>
          ) : (
            speakerProfiles.map((profile) => (
              <div key={profile.id} className="grid gap-3 rounded-2xl border px-4 py-4 lg:grid-cols-[1fr_auto]">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">{profile.name}</div>
                    <Badge variant="outline" className="text-[10px]">
                      {profile.engine}
                    </Badge>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Input value={profile.name} onChange={(event) => patchSpeakerProfile(profile.id, { name: event.target.value })} placeholder="音色名称" />
                    <Input value={profile.language || ''} onChange={(event) => patchSpeakerProfile(profile.id, { language: event.target.value })} placeholder="语言，例如 zh" />
                  </div>

                  <Textarea
                    value={profile.refText || ''}
                    onChange={(event) => patchSpeakerProfile(profile.id, { refText: event.target.value })}
                    rows={2}
                    placeholder="参考文本"
                  />

                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <Input value={profile.notes || ''} onChange={(event) => patchSpeakerProfile(profile.id, { notes: event.target.value })} placeholder="备注，可不填" />
                    <div className="text-xs text-foreground-secondary whitespace-nowrap self-center">
                      更新于 {formatDateLabel(profile.updatedAt)}
                    </div>
                  </div>
                </div>

                <div className="flex items-start justify-end">
                  <Button variant="outline" size="sm" className="gap-2 text-destructive" onClick={() => void handleDeleteSpeaker(profile.id)} disabled={deletingId === profile.id}>
                    <Trash2 className="h-4 w-4" />
                    {deletingId === profile.id ? '删除中...' : '删除'}
                  </Button>
                </div>
              </div>
            ))
          )}
          <div className="text-xs text-foreground-secondary">
            修改音色名称、参考文本或备注后，点页面右上角“保存配置”即可统一生效。
          </div>
        </CardContent>
      </Card>

      <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
        setUploadDialogOpen(open);
        if (!open && !uploading) resetUploadFormState();
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>上传全局音色</DialogTitle>
            <DialogDescription>
              上传一段 WAV 参考音频，并填写这段音频对应的文本。上传成功后，智能体默认声音下拉会直接出现这条音色。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>参考音频（WAV）</Label>
              <Input type="file" accept=".wav,audio/wav" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
            </div>

            <div className="grid gap-2">
              <Label>音色名称</Label>
              <Input value={uploadName} onChange={(event) => setUploadName(event.target.value)} placeholder="例如：温柔女声 / 解说男声" />
            </div>

            <div className="grid gap-2">
              <Label>参考文本</Label>
              <Textarea value={uploadRefText} onChange={(event) => setUploadRefText(event.target.value)} rows={4} placeholder="请填写音频里真实说过的文本" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>语言</Label>
                <Input value={uploadLanguage} onChange={(event) => setUploadLanguage(event.target.value)} placeholder="zh / en / ja" />
              </div>
              <div className="grid gap-2">
                <Label>备注</Label>
                <Input value={uploadNotes} onChange={(event) => setUploadNotes(event.target.value)} placeholder="例如：适合陪聊、讲解" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              if (!uploading) resetUploadFormState();
            }} disabled={uploading}>
              取消
            </Button>
            <Button onClick={() => void handleUploadSpeaker()} disabled={uploading}>
              {uploading ? '上传中...' : '确认上传'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function resetUploadFormState() {
    setUploadDialogOpen(false);
    setUploadFile(null);
    setUploadName('');
    setUploadRefText('');
    setUploadLanguage('zh');
    setUploadNotes('');
  }
}


