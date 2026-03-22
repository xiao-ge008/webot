import { requestJson } from "@/services/transport";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value < minimum ? fallback : value;
}

export type ImageGenerationProvider = "comfyui" | "modelscope";
export type ImageServiceMode = "generate" | "edit";

export interface ComfyuiGenerationDefaults {
  modelName: string;
  loraName: string;
  defaultSteps: number;
  cfgScale: number;
  samplerName: string;
  scheduler: string;
  defaultWidth: number;
  defaultHeight: number;
}

export interface ComfyuiEditDefaults {
  modelName: string;
  loraName: string;
  defaultSteps: number;
  cfgScale: number;
  samplerName: string;
  scheduler: string;
}

export interface ComfyuiImageGenerationConfig {
  serverUrl: string;
  apiKey: string;
  modelName: string;
  loraName: string;
  defaultSteps: number;
  cfgScale: number;
  samplerName: string;
  scheduler: string;
  defaultWidth: number;
  defaultHeight: number;
  generate: ComfyuiGenerationDefaults;
  edit: ComfyuiEditDefaults;
}

export interface ComfyuiProbeResult {
  connected: boolean;
  message: string;
  items: string[];
  loras: string[];
}

export interface ModelscopeGenerationDefaults {
  model: string;
}

export interface ModelscopeEditDefaults {
  model: string;
}

export interface ModelscopeImageGenerationConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  model: string;
  generate: ModelscopeGenerationDefaults;
  edit: ModelscopeEditDefaults;
}

export interface ImageGenerationConfig {
  provider: ImageGenerationProvider;
  comfyui: ComfyuiImageGenerationConfig;
  modelscope: ModelscopeImageGenerationConfig;
}

const DEFAULT_COMFYUI_GENERATE: ComfyuiGenerationDefaults = {
  modelName: "",
  loraName: "",
  defaultSteps: 20,
  cfgScale: 7,
  samplerName: "euler",
  scheduler: "normal",
  defaultWidth: 1024,
  defaultHeight: 1024,
};

const DEFAULT_COMFYUI_EDIT: ComfyuiEditDefaults = {
  modelName: "",
  loraName: "",
  defaultSteps: 20,
  cfgScale: 7,
  samplerName: "euler",
  scheduler: "normal",
};

const DEFAULT_MODELSCOPE_GENERATE: ModelscopeGenerationDefaults = {
  model: "Tongyi-MAI/Z-Image-Turbo",
};

const DEFAULT_MODELSCOPE_EDIT: ModelscopeEditDefaults = {
  model: "",
};

const DEFAULT_CONFIG: ImageGenerationConfig = {
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
    generate: { ...DEFAULT_COMFYUI_GENERATE },
    edit: { ...DEFAULT_COMFYUI_EDIT },
  },
  modelscope: {
    baseUrl: "https://api-inference.modelscope.cn",
    apiKey: "",
    apiSecret: "",
    model: "Tongyi-MAI/Z-Image-Turbo",
    generate: { ...DEFAULT_MODELSCOPE_GENERATE },
    edit: { ...DEFAULT_MODELSCOPE_EDIT },
  },
};

function normalizeComfyuiGenerationDefaults(
  value: unknown,
  legacy?: JsonRecord,
): ComfyuiGenerationDefaults {
  const record = isRecord(value) ? value : {};
  return {
    modelName: asString(record.modelName, asString(legacy?.modelName)),
    loraName: asString(record.loraName, asString(legacy?.loraName)),
    defaultSteps: asNumber(
      record.defaultSteps,
      asNumber(legacy?.defaultSteps, DEFAULT_COMFYUI_GENERATE.defaultSteps, 1),
      1,
    ),
    cfgScale: asNumber(
      record.cfgScale,
      asNumber(legacy?.cfgScale, DEFAULT_COMFYUI_GENERATE.cfgScale, 0.1),
      0.1,
    ),
    samplerName: asString(
      record.samplerName,
      asString(legacy?.samplerName, DEFAULT_COMFYUI_GENERATE.samplerName),
    ),
    scheduler: asString(
      record.scheduler,
      asString(legacy?.scheduler, DEFAULT_COMFYUI_GENERATE.scheduler),
    ),
    defaultWidth: asNumber(
      record.defaultWidth,
      asNumber(legacy?.defaultWidth, DEFAULT_COMFYUI_GENERATE.defaultWidth, 1),
      1,
    ),
    defaultHeight: asNumber(
      record.defaultHeight,
      asNumber(
        legacy?.defaultHeight,
        DEFAULT_COMFYUI_GENERATE.defaultHeight,
        1,
      ),
      1,
    ),
  };
}

function normalizeComfyuiEditDefaults(value: unknown): ComfyuiEditDefaults {
  const record = isRecord(value) ? value : {};
  return {
    modelName: asString(record.modelName),
    loraName: asString(record.loraName),
    defaultSteps: asNumber(
      record.defaultSteps,
      DEFAULT_COMFYUI_EDIT.defaultSteps,
      1,
    ),
    cfgScale: asNumber(record.cfgScale, DEFAULT_COMFYUI_EDIT.cfgScale, 0.1),
    samplerName: asString(record.samplerName, DEFAULT_COMFYUI_EDIT.samplerName),
    scheduler: asString(record.scheduler, DEFAULT_COMFYUI_EDIT.scheduler),
  };
}

function normalizeModelscopeGenerationDefaults(
  value: unknown,
  legacy?: JsonRecord,
): ModelscopeGenerationDefaults {
  const record = isRecord(value) ? value : {};
  return {
    model: asString(
      record.model,
      asString(legacy?.model, DEFAULT_MODELSCOPE_GENERATE.model),
    ),
  };
}

function normalizeModelscopeEditDefaults(
  value: unknown,
): ModelscopeEditDefaults {
  const record = isRecord(value) ? value : {};
  return {
    model: asString(record.model, DEFAULT_MODELSCOPE_EDIT.model),
  };
}

function normalizeConfig(value: unknown): ImageGenerationConfig {
  if (!isRecord(value)) {
    return DEFAULT_CONFIG;
  }
  const provider =
    asString(value.provider, "comfyui") === "modelscope"
      ? "modelscope"
      : "comfyui";
  const comfyui = isRecord(value.comfyui) ? value.comfyui : {};
  const modelscope = isRecord(value.modelscope) ? value.modelscope : {};
  const comfyGenerate = normalizeComfyuiGenerationDefaults(
    comfyui.generate,
    comfyui,
  );
  const comfyEdit = normalizeComfyuiEditDefaults(comfyui.edit);
  const modelscopeGenerate = normalizeModelscopeGenerationDefaults(
    modelscope.generate,
    modelscope,
  );
  const modelscopeEdit = normalizeModelscopeEditDefaults(modelscope.edit);

  return {
    provider,
    comfyui: {
      serverUrl: asString(comfyui.serverUrl, DEFAULT_CONFIG.comfyui.serverUrl),
      apiKey: asString(comfyui.apiKey),
      modelName: comfyGenerate.modelName,
      loraName: comfyGenerate.loraName,
      defaultSteps: comfyGenerate.defaultSteps,
      cfgScale: comfyGenerate.cfgScale,
      samplerName: comfyGenerate.samplerName,
      scheduler: comfyGenerate.scheduler,
      defaultWidth: comfyGenerate.defaultWidth,
      defaultHeight: comfyGenerate.defaultHeight,
      generate: comfyGenerate,
      edit: comfyEdit,
    },
    modelscope: {
      baseUrl: asString(modelscope.baseUrl, DEFAULT_CONFIG.modelscope.baseUrl),
      apiKey: asString(modelscope.apiKey),
      apiSecret: asString(modelscope.apiSecret),
      model: modelscopeGenerate.model,
      generate: modelscopeGenerate,
      edit: modelscopeEdit,
    },
  };
}

export async function getImageGenerationConfig(): Promise<ImageGenerationConfig> {
  const payload = await requestJson<unknown>(
    "/api/management/image-generation/config",
  );
  if (!isRecord(payload)) {
    return DEFAULT_CONFIG;
  }
  return normalizeConfig(payload.config);
}

export async function setImageGenerationConfig(
  config: ImageGenerationConfig,
): Promise<ImageGenerationConfig> {
  const payload = await requestJson<unknown>(
    "/api/management/image-generation/config",
    {
      method: "PUT",
      body: config,
    },
  );
  if (!isRecord(payload)) {
    return config;
  }
  return normalizeConfig(payload.config);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    )
    .map((item) => item.trim());
}

export async function probeComfyuiResources(input: {
  serverUrl: string;
  apiKey: string;
}): Promise<ComfyuiProbeResult> {
  const payload = await requestJson<unknown>(
    "/api/management/image-generation/comfyui/models",
    {
      method: "POST",
      body: input,
    },
  );
  if (!isRecord(payload)) {
    return {
      connected: false,
      message: "",
      items: [],
      loras: [],
    };
  }
  return {
    connected: payload.connected === true,
    message: asString(payload.message),
    items: normalizeStringArray(payload.items),
    loras: normalizeStringArray(payload.loras),
  };
}
