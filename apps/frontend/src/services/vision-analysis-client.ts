import { requestJson } from "@/services/transport";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export interface VisionAnalysisConfig {
  enabled: boolean;
  provider: "florence2";
  modelId: string;
  taskPrompt: string;
  cacheEnabled: boolean;
  autoAnalyzeChatImages: boolean;
  autoDownloadOnEnable: boolean;
}

export interface VisionModelFileStatus {
  relativePath: string;
  expectedSize?: number;
  present: boolean;
  size?: number;
}

export interface VisionAnalysisStatus {
  config: VisionAnalysisConfig;
  providerAvailable: boolean;
  modelReady: boolean;
  downloadActive: boolean;
  downloadedBytes: number;
  totalBytes: number;
  progressPercent: number;
  currentFile?: string;
  lastError?: string;
  modelRootDir: string;
  modelDir: string;
  cacheDir: string;
  missingFiles: string[];
  files: VisionModelFileStatus[];
  updatedAtMs: number;
}

export interface UpsertVisionCacheInput {
  sha256: string;
  summary: string;
  mimeType: string;
  provider?: string;
  model?: string;
  taskPrompt?: string;
  source?: string;
  width?: number;
  height?: number;
  relativePath?: string;
  savedPath?: string;
  upstreamFileId?: string;
  fileName?: string;
}

export interface AnalyzeVisionImageInput {
  imagePath: string;
  sha256?: string;
  mimeType?: string;
  relativePath?: string;
  savedPath?: string;
  upstreamFileId?: string;
  fileName?: string;
  source?: string;
  userText?: string;
}

export interface AnalyzeVisionImageResult {
  sha256: string;
  summary: string;
  provider: string;
  model: string;
  taskPrompt: string;
  mimeType: string;
  width?: number;
  height?: number;
  cached: boolean;
}

const FLORENCE_MODEL_ID = "laub/Florence-2-large-PromptGen-v2.0-onnx";
const LEGACY_FLORENCE_MODEL_ID = "onnx-community/Florence-2-large-ft";

export const DEFAULT_VISION_ANALYSIS_CONFIG: VisionAnalysisConfig = {
  enabled: false,
  provider: "florence2",
  modelId: FLORENCE_MODEL_ID,
  taskPrompt: "<MORE_DETAILED_CAPTION>",
  cacheEnabled: true,
  autoAnalyzeChatImages: true,
  autoDownloadOnEnable: true,
};

function normalizeModelId(value: unknown): string {
  const modelId = asString(value).trim();
  if (!modelId || modelId.toLowerCase() === LEGACY_FLORENCE_MODEL_ID.toLowerCase()) {
    return FLORENCE_MODEL_ID;
  }
  return modelId;
}

function normalizeConfig(value: unknown): VisionAnalysisConfig {
  if (!isRecord(value)) {
    return DEFAULT_VISION_ANALYSIS_CONFIG;
  }
  return {
    enabled: asBool(value.enabled),
    provider: "florence2",
    modelId: normalizeModelId(value.modelId),
    taskPrompt: asString(
      value.taskPrompt,
      DEFAULT_VISION_ANALYSIS_CONFIG.taskPrompt,
    ),
    cacheEnabled: asBool(
      value.cacheEnabled,
      DEFAULT_VISION_ANALYSIS_CONFIG.cacheEnabled,
    ),
    autoAnalyzeChatImages: asBool(
      value.autoAnalyzeChatImages,
      DEFAULT_VISION_ANALYSIS_CONFIG.autoAnalyzeChatImages,
    ),
    autoDownloadOnEnable: asBool(
      value.autoDownloadOnEnable,
      DEFAULT_VISION_ANALYSIS_CONFIG.autoDownloadOnEnable,
    ),
  };
}

function normalizeFileStatus(value: unknown): VisionModelFileStatus {
  const record = isRecord(value) ? value : {};
  return {
    relativePath: asString(record.relativePath),
    expectedSize:
      typeof record.expectedSize === "number" ? record.expectedSize : undefined,
    present: asBool(record.present),
    size: typeof record.size === "number" ? record.size : undefined,
  };
}

function normalizeStatus(value: unknown): VisionAnalysisStatus {
  const record = isRecord(value) ? value : {};
  return {
    config: normalizeConfig(record.config),
    providerAvailable: asBool(record.providerAvailable),
    modelReady: asBool(record.modelReady),
    downloadActive: asBool(record.downloadActive),
    downloadedBytes: asNumber(record.downloadedBytes),
    totalBytes: asNumber(record.totalBytes),
    progressPercent: asNumber(record.progressPercent),
    currentFile: asString(record.currentFile) || undefined,
    lastError: asString(record.lastError) || undefined,
    modelRootDir: asString(record.modelRootDir),
    modelDir: asString(record.modelDir),
    cacheDir: asString(record.cacheDir),
    missingFiles: asStringArray(record.missingFiles),
    files: Array.isArray(record.files)
      ? record.files.map(normalizeFileStatus)
      : [],
    updatedAtMs: asNumber(record.updatedAtMs),
  };
}

function normalizeAnalyzeResult(value: unknown): AnalyzeVisionImageResult {
  const record = isRecord(value) ? value : {};
  return {
    sha256: asString(record.sha256),
    summary: asString(record.summary),
    provider: asString(record.provider, "florence2"),
    model: normalizeModelId(record.model),
    taskPrompt: asString(
      record.taskPrompt,
      DEFAULT_VISION_ANALYSIS_CONFIG.taskPrompt,
    ),
    mimeType: asString(record.mimeType, "image/jpeg"),
    width: typeof record.width === "number" ? record.width : undefined,
    height: typeof record.height === "number" ? record.height : undefined,
    cached: asBool(record.cached),
  };
}

export async function getVisionAnalysisConfig(): Promise<VisionAnalysisConfig> {
  const payload = await requestJson<unknown>(
    "/api/management/vision-analysis/config",
  );
  if (!isRecord(payload)) {
    return DEFAULT_VISION_ANALYSIS_CONFIG;
  }
  return normalizeConfig(payload.config);
}

export async function setVisionAnalysisConfig(
  config: VisionAnalysisConfig,
): Promise<VisionAnalysisConfig> {
  const payload = await requestJson<unknown>(
    "/api/management/vision-analysis/config",
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

export async function getVisionAnalysisStatus(): Promise<VisionAnalysisStatus> {
  const payload = await requestJson<unknown>(
    "/api/management/vision-analysis/status",
  );
  if (!isRecord(payload)) {
    return normalizeStatus({});
  }
  return normalizeStatus(payload.status);
}

export async function startVisionAnalysisDownload(): Promise<VisionAnalysisStatus> {
  const payload = await requestJson<unknown>(
    "/api/management/vision-analysis/download",
    {
      method: "POST",
    },
  );
  if (!isRecord(payload)) {
    return normalizeStatus({});
  }
  return normalizeStatus(payload.status);
}

export async function analyzeVisionImage(
  input: AnalyzeVisionImageInput,
): Promise<AnalyzeVisionImageResult> {
  const payload = await requestJson<unknown>(
    "/api/management/vision-analysis/analyze",
    {
      method: "POST",
      body: {
        imagePath: input.imagePath,
        sha256: input.sha256,
        mimeType: input.mimeType,
        relativePath: input.relativePath,
        savedPath: input.savedPath,
        upstreamFileId: input.upstreamFileId,
        fileName: input.fileName,
        source: input.source,
        userText: input.userText,
      },
    },
  );
  if (!isRecord(payload)) {
    return normalizeAnalyzeResult({});
  }
  return normalizeAnalyzeResult(payload.analysis);
}

export async function upsertVisionAnalysisCache(
  input: UpsertVisionCacheInput,
): Promise<void> {
  await requestJson<unknown>("/api/management/vision-analysis/cache", {
    method: "POST",
    body: {
      sha256: input.sha256,
      summary: input.summary,
      mimeType: input.mimeType,
      provider: input.provider,
      model: input.model,
      taskPrompt: input.taskPrompt,
      source: input.source,
      width: input.width,
      height: input.height,
      relativePath: input.relativePath,
      savedPath: input.savedPath,
      upstreamFileId: input.upstreamFileId,
      fileName: input.fileName,
    },
  });
}
