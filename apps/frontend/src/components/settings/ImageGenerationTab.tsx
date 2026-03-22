import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CloudCog, Link2, RefreshCw, Save, Sparkles } from "lucide-react";
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

  return (
    <div className="max-w-4xl animate-fade-in opacity-0">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">
            {t("settings.imageGeneration.title")}
          </h2>
          <p className="text-sm text-foreground-secondary">
            {t("settings.imageGeneration.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
              {t("settings.imageGeneration.refreshResources")}
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

      <div className="grid gap-5">
        <Card className="border-border-light/50 bg-background-secondary/20 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">
                  {t("settings.imageGeneration.providerTitle")}
                </CardTitle>
                <p className="text-sm text-foreground-secondary">
                  {t("settings.imageGeneration.providerDesc")}
                </p>
              </div>
              <Badge
                variant="outline"
                className="h-6 px-2 text-[11px] font-medium"
              >
                {config.provider === "comfyui" ? "ComfyUI" : "ModelScope"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Label className="mb-2 block text-xs font-medium text-foreground-secondary">
              {t("settings.imageGeneration.providerLabel")}
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
          </CardContent>
        </Card>

        {config.provider === "comfyui" ? (
          <Card className="border-border-light/50 bg-background-secondary/20 shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">
                    {t("settings.imageGeneration.comfyuiTitle")}
                  </CardTitle>
                  <p className="text-sm text-foreground-secondary">
                    {t("settings.imageGeneration.comfyuiDesc")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge
                    variant="outline"
                    className="h-6 px-2 text-[11px] font-medium"
                  >
                    {probing || loading
                      ? t("settings.loading")
                      : `${modelOptions.length} ${t("settings.imageGeneration.modelsSuffix")} / ${loraOptions.length} ${t("settings.imageGeneration.lorasSuffix")}`}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`h-6 px-2 text-[11px] font-medium ${
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
            <CardContent className="grid gap-4">
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
                  {t("settings.imageGeneration.comfyuiStatus")}:{" "}
                  {comfyuiStatusMessage ||
                    t("settings.imageGeneration.comfyuiStatusUnavailableHint")}
                </p>
                <p className="text-xs leading-6 text-foreground-secondary">
                  {t("settings.imageGeneration.comfyuiBuiltinWorkflowHint")}
                </p>
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
                  className="min-h-[88px]"
                />
              </div>

              <Tabs
                value={serviceMode}
                onValueChange={(value) =>
                  setServiceMode(value as ImageServiceMode)
                }
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="generate">
                    {t("settings.imageGeneration.generateTab")}
                  </TabsTrigger>
                  <TabsTrigger value="edit">
                    {t("settings.imageGeneration.editTab")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="generate" className="grid gap-4">
                  <p className="rounded-2xl border border-border-light/40 bg-background/40 p-4 text-sm text-foreground-secondary">
                    {t("settings.imageGeneration.comfyuiGenerateDesc")}
                  </p>
                  {renderComfySelect(
                    "settings.imageGeneration.comfyuiModel",
                    "settings.imageGeneration.comfyuiModelPlaceholder",
                    config.comfyui.generate.modelName,
                    modelOptions,
                    (next) => updateComfyuiGenerate({ modelName: next }),
                  )}
                  {renderComfySelect(
                    "settings.imageGeneration.comfyuiLora",
                    "settings.imageGeneration.comfyuiLoraPlaceholder",
                    config.comfyui.generate.loraName,
                    loraOptions,
                    (next) => updateComfyuiGenerate({ loraName: next }),
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    {renderComfyNumber(
                      "settings.imageGeneration.comfyuiDefaultSteps",
                      config.comfyui.generate.defaultSteps,
                      (next) => updateComfyuiGenerate({ defaultSteps: next }),
                      1,
                      "settings.imageGeneration.comfyuiDefaultStepsPlaceholder",
                    )}
                    {renderComfyNumber(
                      "settings.imageGeneration.comfyuiCfgScale",
                      config.comfyui.generate.cfgScale,
                      (next) => updateComfyuiGenerate({ cfgScale: next }),
                      0.1,
                      "settings.imageGeneration.comfyuiCfgScalePlaceholder",
                    )}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-xs font-medium text-foreground-secondary">
                        {t("settings.imageGeneration.comfyuiSamplerName")}
                      </Label>
                      <Input
                        value={config.comfyui.generate.samplerName}
                        onChange={(event) =>
                          updateComfyuiGenerate({
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
                        {t("settings.imageGeneration.comfyuiScheduler")}
                      </Label>
                      <Input
                        value={config.comfyui.generate.scheduler}
                        onChange={(event) =>
                          updateComfyuiGenerate({
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
                  <div className="grid gap-4 md:grid-cols-2">
                    {renderComfyNumber(
                      "settings.imageGeneration.comfyuiDefaultWidth",
                      config.comfyui.generate.defaultWidth,
                      (next) => updateComfyuiGenerate({ defaultWidth: next }),
                      1,
                      "settings.imageGeneration.comfyuiDefaultWidthPlaceholder",
                    )}
                    {renderComfyNumber(
                      "settings.imageGeneration.comfyuiDefaultHeight",
                      config.comfyui.generate.defaultHeight,
                      (next) => updateComfyuiGenerate({ defaultHeight: next }),
                      1,
                      "settings.imageGeneration.comfyuiDefaultHeightPlaceholder",
                    )}
                  </div>
                  <p className="text-xs leading-6 text-foreground-secondary">
                    {t("settings.imageGeneration.comfyuiAdvancedHint")}
                  </p>
                </TabsContent>

                <TabsContent value="edit" className="grid gap-4">
                  <p className="rounded-2xl border border-border-light/40 bg-background/40 p-4 text-sm text-foreground-secondary">
                    {t("settings.imageGeneration.comfyuiEditDesc")}
                  </p>
                  {renderComfySelect(
                    "settings.imageGeneration.comfyuiEditModel",
                    "settings.imageGeneration.comfyuiEditModelPlaceholder",
                    config.comfyui.edit.modelName,
                    modelOptions,
                    (next) => updateComfyuiEdit({ modelName: next }),
                  )}
                  {renderComfySelect(
                    "settings.imageGeneration.comfyuiEditLora",
                    "settings.imageGeneration.comfyuiEditLoraPlaceholder",
                    config.comfyui.edit.loraName,
                    loraOptions,
                    (next) => updateComfyuiEdit({ loraName: next }),
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    {renderComfyNumber(
                      "settings.imageGeneration.comfyuiEditSteps",
                      config.comfyui.edit.defaultSteps,
                      (next) => updateComfyuiEdit({ defaultSteps: next }),
                      1,
                      "settings.imageGeneration.comfyuiDefaultStepsPlaceholder",
                    )}
                    {renderComfyNumber(
                      "settings.imageGeneration.comfyuiEditCfgScale",
                      config.comfyui.edit.cfgScale,
                      (next) => updateComfyuiEdit({ cfgScale: next }),
                      0.1,
                      "settings.imageGeneration.comfyuiCfgScalePlaceholder",
                    )}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-xs font-medium text-foreground-secondary">
                        {t("settings.imageGeneration.comfyuiEditSamplerName")}
                      </Label>
                      <Input
                        value={config.comfyui.edit.samplerName}
                        onChange={(event) =>
                          updateComfyuiEdit({ samplerName: event.target.value })
                        }
                        placeholder={t(
                          "settings.imageGeneration.comfyuiSamplerNamePlaceholder",
                        )}
                        className="h-10"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-xs font-medium text-foreground-secondary">
                        {t("settings.imageGeneration.comfyuiEditScheduler")}
                      </Label>
                      <Input
                        value={config.comfyui.edit.scheduler}
                        onChange={(event) =>
                          updateComfyuiEdit({ scheduler: event.target.value })
                        }
                        placeholder={t(
                          "settings.imageGeneration.comfyuiSchedulerPlaceholder",
                        )}
                        className="h-10"
                      />
                    </div>
                  </div>
                  <p className="text-xs leading-6 text-foreground-secondary">
                    {t("settings.imageGeneration.comfyuiEditHint")}
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border-light/50 bg-background-secondary/20 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {t("settings.imageGeneration.modelscopeTitle")}
              </CardTitle>
              <p className="text-sm text-foreground-secondary">
                {t("settings.imageGeneration.modelscopeDesc")}
              </p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t("settings.imageGeneration.baseUrl")}
                </Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
                  <Input
                    value={config.modelscope.baseUrl}
                    onChange={(event) =>
                      setConfig((prev) => ({
                        ...prev,
                        modelscope: {
                          ...prev.modelscope,
                          baseUrl: event.target.value,
                        },
                      }))
                    }
                    placeholder={t(
                      "settings.imageGeneration.baseUrlPlaceholder",
                    )}
                    className="h-10 pl-9"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-xs font-medium text-foreground-secondary">
                  {t("settings.imageGeneration.apiKey")}
                </Label>
                <Textarea
                  value={config.modelscope.apiKey}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      modelscope: {
                        ...prev.modelscope,
                        apiKey: event.target.value,
                      },
                    }))
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
                    setConfig((prev) => ({
                      ...prev,
                      modelscope: {
                        ...prev.modelscope,
                        apiSecret: event.target.value,
                      },
                    }))
                  }
                  placeholder={t(
                    "settings.imageGeneration.modelscopeSecretPlaceholder",
                  )}
                  className="min-h-[72px]"
                />
              </div>
              <Tabs
                value={serviceMode}
                onValueChange={(value) =>
                  setServiceMode(value as ImageServiceMode)
                }
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="generate">
                    {t("settings.imageGeneration.generateTab")}
                  </TabsTrigger>
                  <TabsTrigger value="edit">
                    {t("settings.imageGeneration.editTab")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="generate" className="grid gap-4">
                  <p className="rounded-2xl border border-border-light/40 bg-background/40 p-4 text-sm text-foreground-secondary">
                    {t("settings.imageGeneration.modelscopeGenerateDesc")}
                  </p>
                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-foreground-secondary">
                      {t("settings.imageGeneration.modelscopeModel")}
                    </Label>
                    <Input
                      value={config.modelscope.generate.model}
                      onChange={(event) =>
                        setConfig((prev) => ({
                          ...prev,
                          modelscope: {
                            ...prev.modelscope,
                            generate: { model: event.target.value },
                          },
                        }))
                      }
                      placeholder={t(
                        "settings.imageGeneration.modelscopeModelPlaceholder",
                      )}
                      className="h-10"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="edit" className="grid gap-4">
                  <p className="rounded-2xl border border-border-light/40 bg-background/40 p-4 text-sm text-foreground-secondary">
                    {t("settings.imageGeneration.modelscopeEditDesc")}
                  </p>
                  <div className="grid gap-2">
                    <Label className="text-xs font-medium text-foreground-secondary">
                      {t("settings.imageGeneration.modelscopeEditModel")}
                    </Label>
                    <Input
                      value={config.modelscope.edit.model}
                      onChange={(event) =>
                        setConfig((prev) => ({
                          ...prev,
                          modelscope: {
                            ...prev.modelscope,
                            edit: { model: event.target.value },
                          },
                        }))
                      }
                      placeholder={t(
                        "settings.imageGeneration.modelscopeEditModelPlaceholder",
                      )}
                      className="h-10"
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-border-light/40 bg-background-secondary/20 p-4 text-xs text-foreground-secondary">
        <div className="flex items-center gap-2 text-foreground">
          <CloudCog className="h-4 w-4" />
          <span>{t("settings.imageGeneration.hintTitle")}</span>
        </div>
        <p className="mt-2 leading-6">{t("settings.imageGeneration.hint")}</p>
        <div className="mt-3 flex items-start gap-2 text-foreground-secondary">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t("settings.imageGeneration.priorityHint")}</p>
        </div>
      </div>
    </div>
  );
}
