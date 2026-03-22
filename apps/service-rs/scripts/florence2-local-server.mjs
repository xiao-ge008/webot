import readline from "node:readline";
import {
  env,
  AutoProcessor,
  AutoTokenizer,
  Florence2ForConditionalGeneration,
  RawImage,
} from "@huggingface/transformers";

const PROVIDER_NAME = "florence2";

class FlorenceLoader {
  constructor() {
    this.instancePromise = null;
    this.currentKey = "";
  }

  async get(modelId, modelRootDir) {
    const normalizedRoot = String(modelRootDir || "").trim();
    const normalizedId = String(modelId || "").trim();
    if (!normalizedRoot || !normalizedId) {
      throw new Error("缺少 modelRootDir 或 modelId");
    }

    const cacheKey = `${normalizedRoot}@@${normalizedId}`;
    if (!this.instancePromise || this.currentKey !== cacheKey) {
      this.currentKey = cacheKey;
      this.instancePromise = this.load(normalizedId, normalizedRoot);
    }
    return this.instancePromise;
  }

  async load(modelId, modelRootDir) {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = modelRootDir;

    const model = await Florence2ForConditionalGeneration.from_pretrained(modelId, {
      device: "cpu",
    });
    const processor = await AutoProcessor.from_pretrained(modelId);
    const tokenizer = await AutoTokenizer.from_pretrained(modelId);
    return { model, processor, tokenizer };
  }
}

const loader = new FlorenceLoader();
let inFlightCount = 0;
let closing = false;

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function maybeExit() {
  if (closing && inFlightCount === 0) {
    process.exit(0);
  }
}

function extractSummary(taskPrompt, processed, fallback) {
  if (typeof processed === "string" && processed.trim()) {
    return processed.trim();
  }
  if (processed && typeof processed === "object") {
    const byTask = processed[taskPrompt];
    if (typeof byTask === "string" && byTask.trim()) {
      return byTask.trim();
    }
    for (const value of Object.values(processed)) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return String(fallback || "").trim();
}

async function handleAnalyze(request) {
  const modelId = String(request.modelId || "").trim();
  const modelRootDir = String(request.modelRootDir || "").trim();
  const imagePath = String(request.imagePath || "").trim();
  const taskPrompt = String(request.taskPrompt || "<MORE_DETAILED_CAPTION>").trim();
  if (!imagePath) {
    throw new Error("缺少 imagePath");
  }

  const singleton = await loader.get(modelId, modelRootDir);
  const image = await RawImage.read(imagePath);
  const prompts = singleton.processor.construct_prompts(taskPrompt);
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
    taskPrompt,
    image.size,
  );
  const summary = extractSummary(taskPrompt, processed, generatedText);
  if (!summary) {
    throw new Error("Florence-2 未返回可用摘要");
  }

  return {
    summary,
    provider: PROVIDER_NAME,
    model: modelId,
    width: image.width,
    height: image.height,
  };
}

async function handleRequest(request) {
  const requestId = String(request?.requestId || "").trim();
  if (!requestId) {
    return;
  }

  try {
    if (request.type !== "analyze") {
      throw new Error(`不支持的请求类型: ${request.type}`);
    }
    const result = await handleAnalyze(request);
    writeMessage({
      type: "result",
      requestId,
      ...result,
    });
  } catch (error) {
    writeMessage({
      type: "error",
      requestId,
      error: error instanceof Error ? error.message : "Florence-2 推理失败",
    });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

writeMessage({ type: "ready" });

rl.on("line", (line) => {
  const content = String(line || "").trim();
  if (!content) {
    return;
  }
  let request;
  try {
    request = JSON.parse(content);
  } catch (error) {
    writeMessage({
      type: "error",
      requestId: "invalid-json",
      error: error instanceof Error ? error.message : "请求 JSON 解析失败",
    });
    return;
  }

  inFlightCount += 1;
  void handleRequest(request).finally(() => {
    inFlightCount = Math.max(0, inFlightCount - 1);
    maybeExit();
  });
});

rl.on("close", () => {
  closing = true;
  maybeExit();
});
