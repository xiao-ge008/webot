import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link2, RefreshCw, Save } from "lucide-react";
import {
  getImageGenerationConfig,
  probeComfyuiResources,
  setImageGenerationConfig,
  type ComfyuiEditDefaults,
  type ComfyuiGenerationDefaults,
  type ImageGenerationConfig,
  type ImageGenerationProvider,
  type ImageServiceMode,
} from "@/services/image-generation-client";

const EMPTY_CONFIG: ImageGenerationConfig = {
  provider: "comfyui",
  comfyui: {
    serverUrl: "http://127.0.0.1:8188",
    apiKey: "",
    modelName: "",
    loraName: "",
    defaultSteps: 20,
    cfgScale: 7,
    samplerName: "euler",
    scheduler: "normal",
    defaultWidth: 1024,
    defaultHeight: 1024,
    generate: {
      modelName: "",
      loraName: "",
      defaultSteps: 20,
      cfgScale: 7,
      samplerName: "euler",
      scheduler: "normal",
      defaultWidth: 1024,
      defaultHeight: 1024,
    },
    edit: {
      modelName: "",
      loraName: "",
      defaultSteps: 20,
      cfgScale: 7,
      samplerName: "euler",
      scheduler: "normal",
    },
  },
  modelscope: {
    baseUrl: "https://api-inference.modelscope.cn",
    apiKey: "",
    apiSecret: "",
    model: "Tongyi-MAI/Z-Image-Turbo",
    generate: { model: "Tongyi-MAI/Z-Image-Turbo" },
    edit: { model: "" },
  },
};

function parseNumber(value: string, fallback: number, minimum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function ImageGenerationTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ImageGenerationConfig>(EMPTY_CONFIG);
  const [serviceMode, setServiceMode] = useState<ImageServiceMode>("generate");
  const [comfyuiModels, setComfyuiModels] = useState<string[]>([]);
  const [comfyuiLoras, setComfyuiLoras] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [comfyuiConnected, setComfyuiConnected] = useState<boolean | null>(
    null,
  );
  const [comfyuiStatusMessage, setComfyuiStatusMessage] = useState("");

  const modelOptions = useMemo(() => {
    const selected = [
      config.comfyui.generate.modelName,
      config.comfyui.edit.modelName,
    ].filter(Boolean);
    return Array.from(new Set([...selected, ...comfyuiModels]));
  }, [
    comfyuiModels,
    config.comfyui.generate.modelName,
    config.comfyui.edit.modelName,
  ]);

  const loraOptions = useMemo(() => {
    const selected = [
      config.comfyui.generate.loraName,
      config.comfyui.edit.loraName,
    ].filter(Boolean);
    return Array.from(new Set([...selected, ...comfyuiLoras]));
  }, [
    comfyuiLoras,
    config.comfyui.generate.loraName,
    config.comfyui.edit.loraName,
  ]);

  const comfyuiStatusLabel = probing
    ? t("settings.imageGeneration.comfyuiStatusChecking")
    : comfyuiConnected === true
      ? t("settings.imageGeneration.comfyuiStatusConnected")
      : comfyuiConnected === false
        ? t("settings.imageGeneration.comfyuiStatusDisconnected")
        : t("settings.imageGeneration.comfyuiStatusUnknown");

  const updateProvider = (provider: ImageGenerationProvider) =>
    setConfig((prev) => ({ ...prev, provider }));

  const updateComfyuiBase = (
    patch: Partial<ImageGenerationConfig["comfyui"]>,
  ) =>
    setConfig((prev) => ({
      ...prev,
      comfyui: { ...prev.comfyui, ...patch },
    }));

  const updateComfyuiGenerate = (patch: Partial<ComfyuiGenerationDefaults>) =>
    setConfig((prev) => ({
      ...prev,
      comfyui: {
        ...prev.comfyui,
        generate: { ...prev.comfyui.generate, ...patch },
      },
    }));

  const updateComfyuiEdit = (patch: Partial<ComfyuiEditDefaults>) =>
    setConfig((prev) => ({
      ...prev,
      comfyui: {
        ...prev.comfyui,
        edit: { ...prev.comfyui.edit, ...patch },
      },
    }));

  const updateModelscopeBase = (
    patch: Partial<ImageGenerationConfig["modelscope"]>,
  ) =>
    setConfig((prev) => ({
      ...prev,
      modelscope: { ...prev.modelscope, ...patch },
    }));

  const updateModelscopeGenerate = (
    patch: Partial<ImageGenerationConfig["modelscope"]["generate"]>,
  ) =>
    setConfig((prev) => ({
      ...prev,
      modelscope: {
        ...prev.modelscope,
        generate: { ...prev.modelscope.generate, ...patch },
      },
    }));

  const updateModelscopeEdit = (
    patch: Partial<ImageGenerationConfig["modelscope"]["edit"]>,
  ) =>
    setConfig((prev) => ({
      ...prev,
      modelscope: {
        ...prev.modelscope,
        edit: { ...prev.modelscope.edit, ...patch },
      },
    }));

  const load = async () => {
    setLoading(true);
    try {
      setConfig(await getImageGenerationConfig());
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : t("settings.imageGeneration.loadFailed"),
      );
    } finally {
      setLoading(false);
      setConfigLoaded(true);
    }
  };

  const refreshComfyuiResources = async (options?: { silent?: boolean }) => {
    setProbing(true);
    try {
      const result = await probeComfyuiResources({
        serverUrl: config.comfyui.serverUrl,
        apiKey: config.comfyui.apiKey,
      });
      setComfyuiModels(result.items);
      setComfyuiLoras(result.loras);
      setComfyuiConnected(result.connected);
      setComfyuiStatusMessage(result.message);
      setConfig((prev) => ({
        ...prev,
        comfyui: {
          ...prev.comfyui,
          generate: {
            ...prev.comfyui.generate,
            modelName: prev.comfyui.generate.modelName || result.items[0] || "",
            loraName:
              prev.comfyui.generate.loraName &&
              result.loras.length > 0 &&
              !result.loras.includes(prev.comfyui.generate.loraName)
                ? ""
                : prev.comfyui.generate.loraName,
          },
          edit: {
            ...prev.comfyui.edit,
            modelName: prev.comfyui.edit.modelName || result.items[0] || "",
            loraName:
              prev.comfyui.edit.loraName &&
              result.loras.length > 0 &&
              !result.loras.includes(prev.comfyui.edit.loraName)
                ? ""
                : prev.comfyui.edit.loraName,
          },
        },
      }));
    } catch (error) {
      setComfyuiConnected(false);
      setComfyuiStatusMessage(
        t("settings.imageGeneration.comfyuiStatusUnavailableHint"),
      );
      if (!options?.silent) {
        alert(
          error instanceof Error
            ? error.message
            : t("settings.imageGeneration.comfyuiProbeFailed"),
        );
      }
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!configLoaded || config.provider !== "comfyui") return;
    const timer = window.setTimeout(() => {
      void refreshComfyuiResources({ silent: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    configLoaded,
    config.provider,
    config.comfyui.serverUrl,
    config.comfyui.apiKey,
  ]);

  const save = async () => {
    setSaving(true);
    try {
      setConfig(await setImageGenerationConfig(config));
      alert(t("settings.imageGeneration.saved"));
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : t("settings.imageGeneration.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const renderComfyNumber = (
    labelKey: string,
    value: number,
    onChange: (next: number) => void,
    minimum: number,
    placeholderKey: string,
  ) => (
    <div className="grid gap-2">
      <Label className="text-xs font-medium text-foreground-secondary">
        {t(labelKey)}
      </Label>
      <Input
        type="number"
        min={minimum}
        step={minimum >= 1 ? 1 : 0.1}
        value={value}
        onChange={(event) =>
          onChange(parseNumber(event.target.value, value, minimum))
        }
        placeholder={t(placeholderKey)}
        className="h-10"
      />
    </div>
  );

  const renderComfySelect = (
    labelKey: string,
    placeholderKey: string,
    value: string,
    options: string[],
    onChange: (next: string) => void,
  ) => (
    <div className="grid gap-2">
      <Label className="text-xs font-medium text-foreground-secondary">
        {t(labelKey)}
      </Label>
      <Select
        value={value || "__empty__"}
        onValueChange={(next) => onChange(next === "__empty__" ? "" : next)}
      >
        <SelectTrigger className="h-10">
          <SelectValue placeholder={t(placeholderKey)} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">{t(placeholderKey)}</SelectItem>
          {options.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const activeModeLabel = serviceMode === "generate" ? "生成" : "修改";
  const activeComfyConfig =
    serviceMode === "generate" ? config.comfyui.generate : config.comfyui.edit;
  const activeModelscopeModel =
    serviceMode === "generate"
      ? config.modelscope.generate.model
      : config.modelscope.edit.model;

  const updateActiveComfyConfig = (
    patch: Partial<ComfyuiGenerationDefaults | ComfyuiEditDefaults>,
  ) => {
    if (serviceMode === "generate") {
      updateComfyuiGenerate(patch as Partial<ComfyuiGenerationDefaults>);
      return;
    }
    updateComfyuiEdit(patch as Partial<ComfyuiEditDefaults>);
  };

  const updateActiveModelscopeModel = (model: string) => {
    if (serviceMode === "generate") {
      updateModelscopeGenerate({ model });
      return;
    }
    updateModelscopeEdit({ model });
  };

  const comfyModelLabelKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.comfyuiModel"
      : "settings.imageGeneration.comfyuiEditModel";
  const comfyModelPlaceholderKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.comfyuiModelPlaceholder"
      : "settings.imageGeneration.comfyuiEditModelPlaceholder";
  const comfyLoraLabelKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.comfyuiLora"
      : "settings.imageGeneration.comfyuiEditLora";
  const comfyLoraPlaceholderKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.comfyuiLoraPlaceholder"
      : "settings.imageGeneration.comfyuiEditLoraPlaceholder";
  const comfyStepsLabelKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.comfyuiDefaultSteps"
      : "settings.imageGeneration.comfyuiEditSteps";
  const comfyCfgLabelKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.comfyuiCfgScale"
      : "settings.imageGeneration.comfyuiEditCfgScale";
  const comfySamplerLabelKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.comfyuiSamplerName"
      : "settings.imageGeneration.comfyuiEditSamplerName";
  const comfySchedulerLabelKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.comfyuiScheduler"
      : "settings.imageGeneration.comfyuiEditScheduler";
  const comfyModeDescription =
    serviceMode === "generate"
      ? t("settings.imageGeneration.comfyuiGenerateDesc")
      : t("settings.imageGeneration.comfyuiEditDesc");
  const modelscopeModeDescription =
    serviceMode === "generate"
      ? t("settings.imageGeneration.modelscopeGenerateDesc")
      : t("settings.imageGeneration.modelscopeEditDesc");
  const modelscopeModelLabelKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.modelscopeModel"
      : "settings.imageGeneration.modelscopeEditModel";
  const modelscopeModelPlaceholderKey =
    serviceMode === "generate"
      ? "settings.imageGeneration.modelscopeModelPlaceholder"
      : "settings.imageGeneration.modelscopeEditModelPlaceholder";

  return (
    <div className="max-w-5xl animate-fade-in space-y-5 opacity-0">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">
            {t("settings.imageGeneration.title")}
          </h2>
          <p className="text-sm text-foreground-secondary">
            这里只保留三步：先选图片服务，再选当前用途，最后只配置这一种用途的默认参数。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline" className="h-8 px-3 text-xs">
            {config.provider === "comfyui" ? "ComfyUI" : "ModelScope"}
          </Badge>
          <Badge variant="outline" className="h-8 px-3 text-xs">
            {activeModeLabel}
          </Badge>
          {config.provider === "comfyui" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              onClick={() => void refreshComfyuiResources()}
              disabled={probing}
            >
              <RefreshCw
                className={`h-4 w-4 ${probing ? "animate-spin" : ""}`}
              />
              刷新资源
            </Button>
          ) : null}
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

      <Card className="shadow-none">
        <CardContent className="grid gap-4 p-5 md:grid-cols-2">
          <div className="grid gap-2">
            <Label className="text-xs text-foreground-secondary">
              图片服务
            </Label>
            <Select
              value={config.provider}
              onValueChange={(value: ImageGenerationProvider) =>
                updateProvider(value)
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="comfyui">ComfyUI</SelectItem>
                <SelectItem value="modelscope">ModelScope</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-6 text-foreground-secondary">
              本地稳定优先用 ComfyUI，需要云端接口再切到 ModelScope。
            </p>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs text-foreground-secondary">
              当前用途
            </Label>
            <Select
              value={serviceMode}
              onValueChange={(value) =>
                setServiceMode(value as ImageServiceMode)
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generate">
                  {t("settings.imageGeneration.generateTab")}
                </SelectItem>
                <SelectItem value="edit">
                  {t("settings.imageGeneration.editTab")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-6 text-foreground-secondary">
              当前只会显示“{activeModeLabel}”这一项的默认配置，另一项先不打扰。
            </p>
          </div>
        </CardContent>
      </Card>

      {config.provider === "comfyui" ? (
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">ComfyUI</CardTitle>
                <p className="text-sm text-foreground-secondary">
                  主页面只放连接、模型和核心参数，采样器与尺寸收进高级设置。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="h-7 px-3 text-[11px]">
                  {loading || probing
                    ? t("settings.loading")
                    : `${modelOptions.length} 模型 / ${loraOptions.length} LoRA`}
                </Badge>
                <Badge
                  variant="outline"
                  className={`h-7 px-3 text-[11px] ${
                    probing
                      ? "border-border-light text-foreground-secondary"
                      : comfyuiConnected
                        ? "border-emerald-500/40 text-emerald-600"
                        : comfyuiConnected === false
                          ? "border-red-500/40 text-red-500"
                          : "border-border-light text-foreground-secondary"
                  }`}
                >
                  {comfyuiStatusLabel}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
              <div className="grid gap-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t("settings.imageGeneration.serverUrl")}
                </Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
                  <Input
                    value={config.comfyui.serverUrl}
                    onChange={(event) =>
                      updateComfyuiBase({ serverUrl: event.target.value })
                    }
                    placeholder={t(
                      "settings.imageGeneration.serverUrlPlaceholder",
                    )}
                    className="h-10 pl-9"
                  />
                </div>
                <p className="text-xs leading-6 text-foreground-secondary">
                  当前状态：
                  {comfyuiStatusMessage ||
                    t("settings.imageGeneration.comfyuiStatusUnavailableHint")}
                </p>
              </div>

              <div className="rounded-2xl border border-border-light/50 bg-background-secondary/20 px-4 py-4">
                <div className="text-sm font-medium">
                  当前用途：{activeModeLabel}
                </div>
                <p className="mt-2 text-xs leading-6 text-foreground-secondary">
                  {comfyModeDescription}
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-xs font-medium text-foreground-secondary">
                {t("settings.imageGeneration.apiKey")}
              </Label>
              <Textarea
                value={config.comfyui.apiKey}
                onChange={(event) =>
                  updateComfyuiBase({ apiKey: event.target.value })
                }
                placeholder={t("settings.imageGeneration.apiKeyPlaceholder")}
                className="min-h-[72px]"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {renderComfySelect(
                comfyModelLabelKey,
                comfyModelPlaceholderKey,
                activeComfyConfig.modelName,
                modelOptions,
                (next) => updateActiveComfyConfig({ modelName: next }),
              )}
              {renderComfySelect(
                comfyLoraLabelKey,
                comfyLoraPlaceholderKey,
                activeComfyConfig.loraName,
                loraOptions,
                (next) => updateActiveComfyConfig({ loraName: next }),
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {renderComfyNumber(
                comfyStepsLabelKey,
                activeComfyConfig.defaultSteps,
                (next) => updateActiveComfyConfig({ defaultSteps: next }),
                1,
                "settings.imageGeneration.comfyuiDefaultStepsPlaceholder",
              )}
              {renderComfyNumber(
                comfyCfgLabelKey,
                activeComfyConfig.cfgScale,
                (next) => updateActiveComfyConfig({ cfgScale: next }),
                0.1,
                "settings.imageGeneration.comfyuiCfgScalePlaceholder",
              )}
            </div>

            <details className="rounded-2xl border border-border-light/50 bg-background-secondary/10 px-4 py-3">
              <summary className="cursor-pointer list-none text-sm font-medium">
                高级设置
              </summary>
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-foreground-secondary">
                      {t(comfySamplerLabelKey)}
                    </Label>
                    <Input
                      value={activeComfyConfig.samplerName}
                      onChange={(event) =>
                        updateActiveComfyConfig({
                          samplerName: event.target.value,
                        })
                      }
                      placeholder={t(
                        "settings.imageGeneration.comfyuiSamplerNamePlaceholder",
                      )}
                      className="h-10"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-foreground-secondary">
                      {t(comfySchedulerLabelKey)}
                    </Label>
                    <Input
                      value={activeComfyConfig.scheduler}
                      onChange={(event) =>
                        updateActiveComfyConfig({
                          scheduler: event.target.value,
                        })
                      }
                      placeholder={t(
                        "settings.imageGeneration.comfyuiSchedulerPlaceholder",
                      )}
                      className="h-10"
                    />
                  </div>
                </div>

                {serviceMode === "generate" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {renderComfyNumber(
                      "settings.imageGeneration.comfyuiDefaultWidth",
                      (activeComfyConfig as ComfyuiGenerationDefaults)
                        .defaultWidth,
                      (next) =>
                        updateActiveComfyConfig({
                          defaultWidth: next,
                        } as Partial<ComfyuiGenerationDefaults>),
                      1,
                      "settings.imageGeneration.comfyuiDefaultWidthPlaceholder",
                    )}
                    {renderComfyNumber(
                      "settings.imageGeneration.comfyuiDefaultHeight",
                      (activeComfyConfig as ComfyuiGenerationDefaults)
                        .defaultHeight,
                      (next) =>
                        updateActiveComfyConfig({
                          defaultHeight: next,
                        } as Partial<ComfyuiGenerationDefaults>),
                      1,
                      "settings.imageGeneration.comfyuiDefaultHeightPlaceholder",
                    )}
                  </div>
                ) : null}

                <p className="text-xs leading-6 text-foreground-secondary">
                  一般保持默认即可，只有你明确知道采样器、调度器或尺寸要固定时，再展开这里调整。
                </p>
              </div>
            </details>

            <p className="text-xs leading-6 text-foreground-secondary">
              {t("settings.imageGeneration.comfyuiBuiltinWorkflowHint")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <div className="space-y-1">
              <CardTitle className="text-base">ModelScope</CardTitle>
              <p className="text-sm text-foreground-secondary">
                云端模式只保留地址、鉴权和当前用途模型，避免一次看见太多字段。
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
              <div className="grid gap-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t("settings.imageGeneration.baseUrl")}
                </Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
                  <Input
                    value={config.modelscope.baseUrl}
                    onChange={(event) =>
                      updateModelscopeBase({ baseUrl: event.target.value })
                    }
                    placeholder={t(
                      "settings.imageGeneration.baseUrlPlaceholder",
                    )}
                    className="h-10 pl-9"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-border-light/50 bg-background-secondary/20 px-4 py-4">
                <div className="text-sm font-medium">
                  当前用途：{activeModeLabel}
                </div>
                <p className="mt-2 text-xs leading-6 text-foreground-secondary">
                  {modelscopeModeDescription}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t("settings.imageGeneration.apiKey")}
                </Label>
                <Textarea
                  value={config.modelscope.apiKey}
                  onChange={(event) =>
                    updateModelscopeBase({ apiKey: event.target.value })
                  }
                  placeholder={t(
                    "settings.imageGeneration.modelscopeKeyPlaceholder",
                  )}
                  className="min-h-[72px]"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t("settings.imageGeneration.apiSecret")}
                </Label>
                <Textarea
                  value={config.modelscope.apiSecret}
                  onChange={(event) =>
                    updateModelscopeBase({ apiSecret: event.target.value })
                  }
                  placeholder={t(
                    "settings.imageGeneration.modelscopeSecretPlaceholder",
                  )}
                  className="min-h-[72px]"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-xs font-medium text-foreground-secondary">
                {t(modelscopeModelLabelKey)}
              </Label>
              <Input
                value={activeModelscopeModel}
                onChange={(event) =>
                  updateActiveModelscopeModel(event.target.value)
                }
                placeholder={t(modelscopeModelPlaceholderKey)}
                className="h-10"
              />
              <p className="text-xs leading-6 text-foreground-secondary">
                生成场景通常保留默认模型即可；只有云端修图或替换模型时，再单独调整这里。
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-none">
        <CardContent className="p-4 text-sm text-foreground-secondary">
          建议先只配一个默认图片服务，把通用图片生成跑通。更细的业务图片流程，继续放到组件技能里，不要把所有场景都堆在这里。
        </CardContent>
      </Card>
    </div>
  );
}
