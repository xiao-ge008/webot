import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
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
  updatedAtMs: 0,
};

export function VisionAnalysisTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<VisionAnalysisConfig>(
    DEFAULT_VISION_ANALYSIS_CONFIG,
  );
  const [status, setStatus] = useState<VisionAnalysisStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

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
      return "下载中";
    }
    if (status.modelReady) {
      return "已就绪";
    }
    if (!config.enabled) {
      return "未启用";
    }
    return "未下载";
  }, [config.enabled, status.downloadActive, status.modelReady]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await setVisionAnalysisConfig(config);
      setConfig(saved);
      const next = await getVisionAnalysisStatus();
      setStatus(next);
      if (
        saved.enabled &&
        saved.autoDownloadOnEnable &&
        !next.modelReady &&
        !next.downloadActive
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
          : t("settings.visionAnalysis.saveFailed", {
              defaultValue: "保存视觉分析配置失败",
            }),
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
          : t("settings.visionAnalysis.downloadFailed", {
              defaultValue: "启动 Florence-2 PromptGen v2.0 下载失败",
            }),
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-4xl animate-fade-in opacity-0">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">
            {t("settings.visionAnalysis.title", { defaultValue: "视觉分析" })}
          </h2>
          <p className="text-sm text-foreground-secondary">
            {t("settings.visionAnalysis.subtitle", {
              defaultValue:
                "本地 Florence-2 PromptGen v2.0 负责图片语义分析，命中后优先复用本地结果，避免重复消耗大模型视觉 token。",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            onClick={() => void loadStatus()}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            {t("settings.visionAnalysis.refresh", { defaultValue: "刷新状态" })}
          </Button>
          <Button
            size="sm"
            className="h-9 gap-2"
            onClick={() => void save()}
            disabled={saving}
          >
            <Save className="h-4 w-4" />
            {saving ? t("settings.loading") : t("common.save")}
          </Button>
        </div>
      </div>

      <div className="grid gap-5">
        <Card className="border-border-light/50 bg-background-secondary/20 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">
                  {t("settings.visionAnalysis.switchTitle", {
                    defaultValue: "本地 Florence-2 PromptGen v2.0 前置视觉",
                  })}
                </CardTitle>
                <p className="text-sm text-foreground-secondary">
                  {t("settings.visionAnalysis.switchDesc", {
                    defaultValue:
                      "启用后，聊天上传图片会先走本地 Florence-2 PromptGen v2.0 解析，再决定是否回退到模型视觉。",
                  })}
                </p>
              </div>
              <Badge variant="outline" className="h-6 px-2 text-[11px] font-medium">
                {statusLabel}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-background px-4 py-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {t("settings.visionAnalysis.enabled", { defaultValue: "启用视觉前置" })}
                </div>
                <div className="text-xs text-foreground-secondary">
                  {t("settings.visionAnalysis.enabledDesc", {
                    defaultValue:
                      "仅对图片生效，OCR 仍保留给后续独立服务。",
                  })}
                </div>
              </div>
              <Switch
                checked={config.enabled}
                onCheckedChange={(checked) =>
                  setConfig((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-xs font-medium text-foreground-secondary">
                {t("settings.visionAnalysis.modelId", { defaultValue: "模型 ID" })}
              </Label>
              <Input
                value={config.modelId}
                onChange={(event) =>
                  setConfig((prev) => ({ ...prev, modelId: event.target.value }))
                }
                disabled
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-xs font-medium text-foreground-secondary">
                {t("settings.visionAnalysis.taskPrompt", {
                  defaultValue: "任务提示词",
                })}
              </Label>
              <Input
                value={config.taskPrompt}
                onChange={(event) =>
                  setConfig((prev) => ({
                    ...prev,
                    taskPrompt: event.target.value,
                  }))
                }
              />
            </div>

            <div className="grid gap-3 rounded-2xl border border-border/50 bg-background px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {t("settings.visionAnalysis.downloadTitle", {
                      defaultValue: "模型下载状态",
                    })}
                  </div>
                  <div className="text-xs text-foreground-secondary">
                    {t("settings.visionAnalysis.downloadDesc", {
                      defaultValue:
                        "模型文件按需下载到 ~/.webot/shared/models/vision/laub/Florence-2-large-PromptGen-v2.0-onnx，不打进安装包。",
                    })}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2"
                  onClick={() => void startDownload()}
                  disabled={downloading || status.downloadActive}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      downloading || status.downloadActive ? "animate-spin" : ""
                    }`}
                  />
                  {status.modelReady
                    ? t("settings.visionAnalysis.redownload", {
                        defaultValue: "重新校验",
                      })
                    : t("settings.visionAnalysis.download", {
                        defaultValue: "下载 Florence-2 PromptGen v2.0",
                      })}
                </Button>
              </div>
              <Progress
                value={status.modelReady ? 100 : status.progressPercent}
                className="h-2"
              />
              <div className="flex flex-wrap items-center gap-3 text-xs text-foreground-secondary">
                <span>
                  {formatBytes(status.downloadedBytes)} /{" "}
                  {formatBytes(status.totalBytes)}
                </span>
                {status.currentFile ? <span>{status.currentFile}</span> : null}
                {status.lastError ? (
                  <span className="text-destructive">{status.lastError}</span>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2 rounded-2xl border border-border/50 bg-background px-4 py-3">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t("settings.visionAnalysis.modelDir", {
                    defaultValue: "模型目录",
                  })}
                </Label>
                <div className="break-all text-xs text-foreground-secondary">
                  {status.modelDir || "-"}
                </div>
              </div>
              <div className="grid gap-2 rounded-2xl border border-border/50 bg-background px-4 py-3">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t("settings.visionAnalysis.cacheDir", {
                    defaultValue: "缓存目录",
                  })}
                </Label>
                <div className="break-all text-xs text-foreground-secondary">
                  {status.cacheDir || "-"}
                </div>
              </div>
            </div>

            {status.missingFiles.length > 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 px-4 py-3 text-xs text-foreground-secondary">
                {t("settings.visionAnalysis.missingFiles", {
                  defaultValue: "缺失文件",
                })}
                ：{status.missingFiles.join("、")}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
