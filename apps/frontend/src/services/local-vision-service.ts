import {
  analyzeVisionImage,
  getVisionAnalysisStatus,
  startVisionAnalysisDownload,
  type VisionAnalysisStatus,
} from "@/services/vision-analysis-client";

export interface ChatImageVisionInput {
  sha256: string;
  imageUrl: string;
  mimeType: string;
  relativePath?: string;
  savedPath?: string;
  upstreamFileId?: string;
  fileName?: string;
}

export interface ChatImageVisionResult {
  text: string;
  provider: string;
  model: string;
}

let statusPromise: Promise<VisionAnalysisStatus> | null = null;
const cachedAnalyses = new Map<string, ChatImageVisionResult>();
const pendingAnalyses = new Map<string, Promise<ChatImageVisionResult | null>>();

async function readStatus(forceRefresh = false): Promise<VisionAnalysisStatus> {
  if (forceRefresh || !statusPromise) {
    statusPromise = getVisionAnalysisStatus();
  }
  return statusPromise;
}

function isValidSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value.trim());
}

function normalizeUserText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildAnalysisKey(sha256: string, userText: string): string {
  const normalizedSha = sha256.trim().toLowerCase();
  const normalizedUserText = normalizeUserText(userText);
  return normalizedUserText
    ? `${normalizedSha}@@${normalizedUserText}`
    : normalizedSha;
}

export async function analyzeAndCacheChatImageWithLocalVision(
  input: ChatImageVisionInput,
  userText: string,
): Promise<ChatImageVisionResult | null> {
  const sha256 = input.sha256.trim().toLowerCase();
  const imagePath = (input.savedPath || "").trim();
  if (!isValidSha256(sha256) || !imagePath) {
    return null;
  }

  const analysisKey = buildAnalysisKey(sha256, userText);
  if (cachedAnalyses.has(analysisKey)) {
    return cachedAnalyses.get(analysisKey) ?? null;
  }
  if (pendingAnalyses.has(analysisKey)) {
    return pendingAnalyses.get(analysisKey) ?? null;
  }

  const task = (async () => {
    const status = await readStatus(true);
    if (!status.config.enabled || !status.config.autoAnalyzeChatImages) {
      return null;
    }
    if (!status.modelReady) {
      if (status.config.autoDownloadOnEnable && !status.downloadActive) {
        try {
          await startVisionAnalysisDownload();
          statusPromise = null;
        } catch {
          // 下载触发失败时直接回退到大模型视觉。
        }
      }
      return null;
    }

    const result = await analyzeVisionImage({
      imagePath,
      sha256,
      mimeType: input.mimeType,
      relativePath: input.relativePath,
      savedPath: input.savedPath,
      upstreamFileId: input.upstreamFileId,
      fileName: input.fileName,
      source: "chat-send",
      userText,
    });
    const normalized: ChatImageVisionResult = {
      text: result.summary,
      provider: result.provider,
      model: result.model,
    };
    cachedAnalyses.set(analysisKey, normalized);
    return normalized;
  })().finally(() => {
    pendingAnalyses.delete(analysisKey);
  });

  pendingAnalyses.set(analysisKey, task);
  return task;
}
