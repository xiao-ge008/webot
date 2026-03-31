import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, Save } from "lucide-react";
import {
  DEFAULT_VISION_ANALYSIS_CONFIG,
  getVisionAnalysisStatus,
  setVisionAnalysisConfig,
  startVisionAnalysisDownload,
  type VisionAnalysisConfig,
  type VisionAnalysisStatus,
} from "@/services/vision-analysis-client";

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

const EMPTY_STATUS: VisionAnalysisStatus = {
  config: DEFAULT_VISION_ANALYSIS_CONFIG,
  providerAvailable: false,
  modelReady: false,
  downloadActive: false,
  downloadedBytes: 0,
  totalBytes: 0,
  progressPercent: 0,
  modelRootDir: "",
  modelDir: "",
  cacheDir: "",
  missingFiles: [],
  files: [],
  ocrProviderAvailable: false,
  ocrModelReady: false,
  ocrDownloadActive: false,
  ocrDownloadedBytes: 0,
  ocrTotalBytes: 0,
  ocrProgressPercent: 0,
  ocrModelRootDir: "",
  ocrModelDir: "",
  ocrMissingFiles: [],
  ocrFiles: [],
  updatedAtMs: 0,
};

export function VisionAnalysisTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<VisionAnalysisConfig>(DEFAULT_VISION_ANALYSIS_CONFIG);
  const [status, setStatus] = useState<VisionAnalysisStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const ocrUsesRemoteSidecar = config.ocrProvider === "sidecar_http";
  const ocrCanDownloadLocally = !ocrUsesRemoteSidecar;

  const loadStatus = async () => {
    setLoading(true);
    try {
      const next = await getVisionAnalysisStatus();
      setStatus(next);
      setConfig(next.config);
    } catch (error) {
      alert(error instanceof Error ? error.message : "读取视觉分析配置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (!status.downloadActive && !status.ocrDownloadActive) return;
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [status.downloadActive, status.ocrDownloadActive]);

  const statusLabel = useMemo(() => {
    if (!config.enabled && !config.ocrEnabled) return "未启用";
    if (status.downloadActive || status.ocrDownloadActive) return "下载中";
    if ((status.modelReady || !config.enabled) && (status.ocrModelReady || !config.ocrEnabled || ocrUsesRemoteSidecar)) {
      return "已就绪";
    }
    return "待准备";
  }, [
    config.enabled,
    config.ocrEnabled,
    ocrUsesRemoteSidecar,
    status.downloadActive,
    status.ocrDownloadActive,
    status.modelReady,
    status.ocrModelReady,
  ]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await setVisionAnalysisConfig(config);
      setConfig(saved);
      const next = await getVisionAnalysisStatus();
      setStatus(next);
      if (
        ((saved.enabled && saved.autoDownloadOnEnable && !next.modelReady) ||
          (saved.ocrEnabled &&
            saved.ocrProvider !== "sidecar_http" &&
            saved.ocrAutoDownloadOnEnable &&
            !next.ocrModelReady)) &&
        !next.downloadActive &&
        !next.ocrDownloadActive
      ) {
        setDownloading(true);
        const downloadStatus = await startVisionAnalysisDownload();
        setStatus(downloadStatus);
      }
      alert(t("settings.visionAnalysis.saved", { defaultValue: "视觉分析配置已保存" }));
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : t("settings.visionAnalysis.saveFailed", { defaultValue: "保存视觉分析配置失败" }),
      );
    } finally {
      setSaving(false);
      setDownloading(false);
    }
  };

  const startDownload = async () => {
    setDownloading(true);
    try {
      setStatus(await startVisionAnalysisDownload());
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : t("settings.visionAnalysis.downloadFailed", { defaultValue: "启动视觉模型下载失败" }),
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-5xl animate-fade-in opacity-0 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">
            {t("settings.visionAnalysis.title", { defaultValue: "视觉分析" })}
          </h2>
          <p className="text-sm text-foreground-secondary">
            只保留三件事：是否启用、视觉模型准备、OCR 识别方式。其余信息收进高级说明。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-8 px-3 text-xs">
            {statusLabel}
          </Badge>
          <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => void loadStatus()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
          <Button size="sm" className="h-9 gap-2" onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? t("settings.loading") : t("common.save")}
          </Button>
        </div>
      </div>

      <Card className="shadow-none">
        <CardContent className="grid gap-4 p-5 md:grid-cols-[1fr_1fr]">
          <div className="flex items-center justify-between rounded-2xl border px-4 py-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">启用视觉语义分析</div>
              <div className="text-xs text-foreground-secondary">
                图片会优先经过 Florence 本地理解，再决定是否回退到模型视觉。
              </div>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, enabled: checked }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-2xl border px-4 py-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">启用 OCR 文本识别</div>
              <div className="text-xs text-foreground-secondary">
                识别图片文字，再和语义摘要一起合并输出。
              </div>
            </div>
            <Switch
              checked={config.ocrEnabled}
              onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, ocrEnabled: checked }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Florence 视觉模型</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="grid gap-2 rounded-2xl border px-4 py-3">
              <Label className="text-xs text-foreground-secondary">任务模式</Label>
              <Select
                value={config.taskPrompt}
                onValueChange={(value) => setConfig((prev) => ({ ...prev, taskPrompt: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="<MORE_DETAILED_CAPTION>">详细描述</SelectItem>
                  <SelectItem value="<DETAILED_CAPTION>">标准描述</SelectItem>
                  <SelectItem value="<CAPTION>">简短描述</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              className="self-end"
              onClick={() => void startDownload()}
              disabled={downloading || status.downloadActive || status.ocrDownloadActive}
            >
              {status.modelReady ? "重新校验 Florence" : "下载 Florence"}
            </Button>
          </div>

          <div className="rounded-2xl border px-4 py-4 space-y-3">
            <Progress value={status.modelReady ? 100 : status.progressPercent} className="h-2" />
            <div className="flex flex-wrap gap-3 text-xs text-foreground-secondary">
              <span>{formatBytes(status.downloadedBytes)} / {formatBytes(status.totalBytes)}</span>
              {status.currentFile ? <span>{status.currentFile}</span> : null}
              {status.lastError ? <span className="text-destructive">{status.lastError}</span> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">OCR 识别方式</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2 rounded-2xl border px-4 py-3">
              <Label className="text-xs text-foreground-secondary">OCR 模式</Label>
              <Select
                value={config.ocrProvider}
                onValueChange={(value) =>
                  setConfig((prev) => ({
                    ...prev,
                    ocrProvider: value,
                    ocrServiceUrl: value === "sidecar_http" ? prev.ocrServiceUrl : "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sidecar_local">本地自动模式</SelectItem>
                  <SelectItem value="builtin">内置模式</SelectItem>
                  <SelectItem value="sidecar_http">远程 OCR 服务</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {ocrUsesRemoteSidecar ? (
              <div className="grid gap-2 rounded-2xl border px-4 py-3">
                <Label className="text-xs text-foreground-secondary">远程服务地址</Label>
                <Input
                  value={config.ocrServiceUrl}
                  placeholder="http://127.0.0.1:38080"
                  onChange={(event) => setConfig((prev) => ({ ...prev, ocrServiceUrl: event.target.value }))}
                />
              </div>
            ) : (
              <div className="grid gap-2 rounded-2xl border px-4 py-3">
                <Label className="text-xs text-foreground-secondary">OCR 模型下载</Label>
                <Button
                  variant="outline"
                  onClick={() => void startDownload()}
                  disabled={downloading || status.downloadActive || status.ocrDownloadActive || !ocrCanDownloadLocally}
                >
                  {status.ocrModelReady ? "重新校验 OCR" : "下载 OCR"}
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-2xl border px-4 py-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">把 OCR 合并进主摘要</div>
                <div className="text-xs text-foreground-secondary">适合让模型直接复用识别结果。</div>
              </div>
              <Switch
                checked={config.ocrMergeIntoSummary}
                onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, ocrMergeIntoSummary: checked }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-2xl border px-4 py-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">文本密集图片优先 OCR</div>
                <div className="text-xs text-foreground-secondary">海报、截图、文档更适合打开。</div>
              </div>
              <Switch
                checked={config.ocrPreferForTextHeavyImages}
                onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, ocrPreferForTextHeavyImages: checked }))}
              />
            </div>
          </div>

          {!ocrUsesRemoteSidecar ? (
            <div className="rounded-2xl border px-4 py-4 space-y-3">
              <Progress value={status.ocrModelReady ? 100 : status.ocrProgressPercent} className="h-2" />
              <div className="flex flex-wrap gap-3 text-xs text-foreground-secondary">
                <span>{formatBytes(status.ocrDownloadedBytes)} / {formatBytes(status.ocrTotalBytes)}</span>
                {status.ocrCurrentFile ? <span>{status.ocrCurrentFile}</span> : null}
                {status.ocrLastError ? <span className="text-destructive">{status.ocrLastError}</span> : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <details className="rounded-2xl border border-dashed px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">高级信息</summary>
        <div className="mt-4 grid gap-3 text-xs text-foreground-secondary md:grid-cols-2">
          <div className="rounded-2xl border px-4 py-3">
            <div>Florence 目录：{status.modelDir || "-"}</div>
            <div className="mt-2">缺失文件：{status.missingFiles.length > 0 ? status.missingFiles.join("、") : "无"}</div>
          </div>
          <div className="rounded-2xl border px-4 py-3">
            <div>{ocrUsesRemoteSidecar ? "OCR 服务地址" : "OCR 目录"}：{ocrUsesRemoteSidecar ? config.ocrServiceUrl || "未配置" : status.ocrModelDir || "-"}</div>
            <div className="mt-2">缺失文件：{status.ocrMissingFiles.length > 0 ? status.ocrMissingFiles.join("、") : "无"}</div>
          </div>
          <div className="rounded-2xl border px-4 py-3 md:col-span-2">
            缓存目录：{status.cacheDir || "-"}
          </div>
        </div>
      </details>
    </div>
  );
}
