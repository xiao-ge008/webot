import {
  env,
  AutoProcessor,
  AutoTokenizer,
  Florence2ForConditionalGeneration,
  RawImage,
  full,
} from "@huggingface/transformers";

type WorkerRequest =
  | {
      type: "analyze";
      requestId: string;
      modelId: string;
      modelBaseUrl: string;
      imageUrl: string;
      taskPrompt: string;
    };

type WorkerResponse =
  | {
      type: "result";
      requestId: string;
      summary: string;
      provider: string;
      model: string;
    }
  | {
      type: "error";
      requestId: string;
      error: string;
    };

type FlorenceSingleton = {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof Florence2ForConditionalGeneration.from_pretrained>>;
};

const PROVIDER_NAME = "florence2";

class FlorenceSingletonLoader {
  private instancePromise: Promise<FlorenceSingleton> | null = null;
  private currentKey = "";

  async get(modelId: string, modelBaseUrl: string): Promise<FlorenceSingleton> {
    const normalizedBaseUrl = `${modelBaseUrl.trim().replace(/\/+$/, "")}/`;
    const cacheKey = `${modelId}@@${normalizedBaseUrl}`;
    if (!this.instancePromise || this.currentKey !== cacheKey) {
      this.currentKey = cacheKey;
      this.instancePromise = this.load(modelId, normalizedBaseUrl);
    }
    return this.instancePromise;
  }

  private async load(
    modelId: string,
    modelBaseUrl: string,
  ): Promise<FlorenceSingleton> {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = modelBaseUrl;

    const gpuNavigator =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { gpu?: unknown });
    const hasWebGpu =
      typeof navigator !== "undefined" && gpuNavigator?.gpu != null;
    const device = hasWebGpu ? "webgpu" : "wasm";

    const model = await Florence2ForConditionalGeneration.from_pretrained(
      modelId,
      {
        device,
      },
    );
    const processor = await AutoProcessor.from_pretrained(modelId);
    const tokenizer = await AutoTokenizer.from_pretrained(modelId);

    if (hasWebGpu) {
      try {
        await model.generate({
          ...tokenizer("<MORE_DETAILED_CAPTION>"),
          pixel_values: full([1, 3, 768, 768], 0.0),
          max_new_tokens: 1,
        });
      } catch {
        // 预热失败不阻断正式推理。
      }
    }

    return {
      tokenizer,
      processor,
      model,
    };
  }
}

const loader = new FlorenceSingletonLoader();

function extractSummary(taskPrompt: string, processed: unknown, fallback: string): string {
  if (typeof processed === "string" && processed.trim().length > 0) {
    return processed.trim();
  }
  if (processed && typeof processed === "object") {
    const record = processed as Record<string, unknown>;
    const byTask = record[taskPrompt];
    if (typeof byTask === "string" && byTask.trim().length > 0) {
      return byTask.trim();
    }
    const values = Object.values(record);
    for (const value of values) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return fallback.trim();
}

async function analyze(
  request: Extract<WorkerRequest, { type: "analyze" }>,
): Promise<WorkerResponse> {
  try {
    const singleton = await loader.get(request.modelId, request.modelBaseUrl);
    const image = await RawImage.fromURL(request.imageUrl);
    const prompts = singleton.processor.construct_prompts(request.taskPrompt);
    const textInputs = singleton.tokenizer(prompts);
    const visionInputs = await singleton.processor(image);
    const generatedIds = await singleton.model.generate({
      ...textInputs,
      ...visionInputs,
      max_new_tokens: 256,
    });
    const generatedText = singleton.tokenizer.batch_decode(generatedIds, {
      skip_special_tokens: false,
    })[0];
    const processed = singleton.processor.post_process_generation(
      generatedText,
      request.taskPrompt,
      image.size,
    );
    const summary = extractSummary(request.taskPrompt, processed, generatedText);
    if (!summary) {
      return {
        type: "error",
        requestId: request.requestId,
        error: "Florence-2 未返回可用摘要",
      };
    }
    return {
      type: "result",
      requestId: request.requestId,
      summary,
      provider: PROVIDER_NAME,
      model: request.modelId,
    };
  } catch (error) {
    return {
      type: "error",
      requestId: request.requestId,
      error: error instanceof Error ? error.message : "Florence-2 推理失败",
    };
  }
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== "analyze") {
    return;
  }
  const response = await analyze(request);
  self.postMessage(response satisfies WorkerResponse);
});
