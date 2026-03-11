// src/main/electron-main.ts
import { createRequire as createRequire8 } from "node:module";
import path10 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// src/main/ipc-contract.ts
var SETTINGS_IPC_CHANNELS = {
  getProviderSettings: "settings:get-provider-settings",
  connectProvider: "settings:connect-provider",
  connectCustomProvider: "settings:connect-custom-provider",
  disconnectProvider: "settings:disconnect-provider",
  getModelSettings: "settings:get-model-settings",
  setDefaultModel: "settings:set-default-model",
  toggleProviderEnabled: "settings:toggle-provider-enabled",
  toggleModelEnabled: "settings:toggle-model-enabled",
  refreshProviderModels: "settings:refresh-provider-models",
  updateProviderConnection: "settings:update-provider-connection",
  getAppSettings: "settings:get-app-settings",
  setAutoLaunch: "settings:set-auto-launch"
};
var AGENT_IPC_CHANNELS = {
  saveAgent: "agent:save",
  getAgent: "agent:get",
  listAgents: "agent:list",
  startAgent: "agent:start",
  stopAgent: "agent:stop",
  agentStatus: "agent:status",
  agentLogTail: "agent:log-tail",
  agentChat: "agent:chat",
  agentChatStream: "agent:chat-stream"
};
var LIVE2D_IPC_CHANNELS = {
  importModel: "live2d:import-model",
  listModels: "live2d:list-models",
  saveConfig: "live2d:save-config",
  downloadGithub: "live2d:download-github"
};

// src/main/agent-profile-service.ts
import path4 from "node:path";
import { mkdir as mkdir4, readFile as readFile2, readdir, writeFile as writeFile3 } from "node:fs/promises";

// src/main/agent-config-manager.ts
import path2 from "node:path";
import { mkdir as mkdir2, writeFile } from "node:fs/promises";

// src/main/shared-workspace-manager.ts
import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
var WEBOT_HOME_DIR_NAME = ".webot";
async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true });
}
function normalizeAgentId(agentId) {
  const normalized = agentId.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
  if (normalized.length === 0) {
    throw new Error("\u667A\u80FD\u4F53 ID \u975E\u6CD5\uFF1A\u4E0D\u80FD\u4E3A\u7A7A\u6216\u5168\u662F\u7279\u6B8A\u5B57\u7B26\u3002");
  }
  return normalized;
}
function resolveWeBotHomeRoot(homeDirOverride) {
  const homeRoot = homeDirOverride ?? os.homedir();
  return path.join(homeRoot, WEBOT_HOME_DIR_NAME);
}
async function ensureSharedWorkspace(homeDirOverride) {
  const webotHomeRoot = resolveWeBotHomeRoot(homeDirOverride);
  const sharedRoot = path.join(webotHomeRoot, "shared");
  const agentsRoot = path.join(webotHomeRoot, "agents");
  const zeroclawRoot = path.join(webotHomeRoot, "zeroclaw");
  const sharedSkillsRoot = path.join(sharedRoot, "skills");
  const sharedMcpRoot = path.join(sharedRoot, "mcp");
  const sharedDataRoot = path.join(sharedRoot, "data");
  const sharedMediaRoot = path.join(sharedRoot, "media");
  const sharedModelsRoot = path.join(sharedRoot, "models");
  await ensureDirectory(webotHomeRoot);
  await ensureDirectory(sharedRoot);
  await ensureDirectory(agentsRoot);
  await ensureDirectory(zeroclawRoot);
  await ensureDirectory(sharedSkillsRoot);
  await ensureDirectory(sharedMcpRoot);
  await ensureDirectory(sharedDataRoot);
  await ensureDirectory(sharedMediaRoot);
  await ensureDirectory(sharedModelsRoot);
  return {
    webotHomeRoot,
    sharedRoot,
    agentsRoot,
    zeroclawRoot,
    sharedSkillsRoot,
    sharedMcpRoot,
    sharedDataRoot,
    sharedMediaRoot,
    sharedModelsRoot
  };
}
async function ensureAgentWorkspace(agentId, homeDirOverride) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const normalizedAgentId = normalizeAgentId(agentId);
  const agentRoot = path.join(shared.agentsRoot, normalizedAgentId);
  const privateSkillsRoot = path.join(agentRoot, "skills");
  const privateMcpRoot = path.join(agentRoot, "mcp");
  const privateDataRoot = path.join(agentRoot, "data");
  const privateLogsRoot = path.join(agentRoot, "logs");
  await ensureDirectory(agentRoot);
  await ensureDirectory(privateSkillsRoot);
  await ensureDirectory(privateMcpRoot);
  await ensureDirectory(privateDataRoot);
  await ensureDirectory(privateLogsRoot);
  return {
    agentId: normalizedAgentId,
    agentRoot,
    privateSkillsRoot,
    privateMcpRoot,
    privateDataRoot,
    privateLogsRoot
  };
}

// src/main/agent-config-manager.ts
async function buildAgentRuntimeConfig(input) {
  const shared = await ensureSharedWorkspace(input.homeDirOverride);
  const agent = await ensureAgentWorkspace(input.agentId, input.homeDirOverride);
  return {
    version: "1.0",
    agentId: agent.agentId,
    displayName: input.displayName,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    model: {
      providerId: input.providerId,
      modelName: input.modelName
    },
    prompt: {
      systemPrompt: input.systemPrompt
    },
    paths: {
      privateRoot: agent.agentRoot,
      sharedRoot: shared.sharedRoot,
      privateSkillsRoot: agent.privateSkillsRoot,
      privateMcpRoot: agent.privateMcpRoot,
      privateDataRoot: agent.privateDataRoot,
      privateLogsRoot: agent.privateLogsRoot,
      sharedSkillsRoot: shared.sharedSkillsRoot,
      sharedMcpRoot: shared.sharedMcpRoot,
      sharedDataRoot: shared.sharedDataRoot,
      sharedMediaRoot: shared.sharedMediaRoot
    },
    skills: {
      privateSkills: input.privateSkills ?? [],
      sharedSkills: input.sharedSkills ?? []
    },
    mcp: {
      privateServers: input.privateMcpServers ?? [],
      sharedServers: input.sharedMcpServers ?? []
    }
  };
}
async function writeAgentRuntimeConfigFile(config, homeDirOverride, targetFilePath) {
  const agentWorkspace = await ensureAgentWorkspace(config.agentId, homeDirOverride);
  const outputPath = targetFilePath ?? path2.join(agentWorkspace.agentRoot, "agent.config.json");
  await mkdir2(path2.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(config, null, 2), "utf-8");
  return outputPath;
}

// src/main/zeroclaw-config-manager.ts
import path3 from "node:path";
import { mkdir as mkdir3, readFile, writeFile as writeFile2 } from "node:fs/promises";

// src/main/model-provider-catalog.ts
var MODEL_PROVIDER_CATALOG = [
  {
    id: "openai",
    displayName: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    defaultModels: ["gpt-4o", "gpt-4.1"],
    apiKeyEnv: "OPENAI_API_KEY"
  },
  {
    id: "azure-openai",
    displayName: "Azure OpenAI",
    apiBase: "https://{resource}.openai.azure.com/openai/deployments/{deployment}",
    defaultModels: ["gpt-4o", "gpt-4.1"],
    apiKeyEnv: "AZURE_OPENAI_API_KEY"
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    apiBase: "https://api.anthropic.com/v1",
    defaultModels: ["claude-opus-4-1", "claude-sonnet-4"],
    apiKeyEnv: "ANTHROPIC_API_KEY"
  },
  {
    id: "google-ai",
    displayName: "Google AI",
    apiBase: "https://generativelanguage.googleapis.com/v1beta",
    defaultModels: ["gemini-2.5-pro", "gemini-2.0-flash"],
    apiKeyEnv: "GOOGLE_API_KEY"
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    apiBase: "https://api.deepseek.com/v1",
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
    apiKeyEnv: "DEEPSEEK_API_KEY"
  },
  {
    id: "qwen",
    displayName: "Qwen",
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModels: ["qwen-max", "qwen-plus"],
    apiKeyEnv: "QWEN_API_KEY"
  },
  {
    id: "moonshot",
    displayName: "Moonshot",
    apiBase: "https://api.moonshot.cn/v1",
    defaultModels: ["moonshot-v1-128k", "kimi-k2-instruct"],
    apiKeyEnv: "MOONSHOT_API_KEY"
  },
  {
    id: "zhipu",
    displayName: "Zhipu AI",
    apiBase: "https://open.bigmodel.cn/api/paas/v4",
    defaultModels: ["glm-4.5", "glm-4-air"],
    apiKeyEnv: "ZHIPU_API_KEY"
  },
  {
    id: "baichuan",
    displayName: "Baichuan",
    apiBase: "https://api.baichuan-ai.com/v1",
    defaultModels: ["Baichuan4-Turbo", "Baichuan4-Air"],
    apiKeyEnv: "BAICHUAN_API_KEY"
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    apiBase: "https://api.minimax.chat/v1",
    defaultModels: ["MiniMax-M1", "abab6.5s-chat"],
    apiKeyEnv: "MINIMAX_API_KEY"
  },
  {
    id: "volcengine-ark",
    displayName: "Volcengine Ark",
    apiBase: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModels: ["doubao-pro-32k", "doubao-seed-1.6"],
    apiKeyEnv: "VOLCENGINE_ARK_API_KEY"
  },
  {
    id: "siliconflow",
    displayName: "SiliconFlow",
    apiBase: "https://api.siliconflow.cn/v1",
    defaultModels: ["deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-235B-A22B"],
    apiKeyEnv: "SILICONFLOW_API_KEY"
  },
  {
    id: "together",
    displayName: "Together AI",
    apiBase: "https://api.together.xyz/v1",
    defaultModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
    apiKeyEnv: "TOGETHER_API_KEY"
  },
  {
    id: "fireworks",
    displayName: "Fireworks AI",
    apiBase: "https://api.fireworks.ai/inference/v1",
    defaultModels: ["accounts/fireworks/models/llama-v3p1-70b-instruct", "accounts/fireworks/models/qwen3-235b-a22b"],
    apiKeyEnv: "FIREWORKS_API_KEY"
  },
  {
    id: "groq",
    displayName: "Groq",
    apiBase: "https://api.groq.com/openai/v1",
    defaultModels: ["llama-3.3-70b-versatile", "qwen-qwq-32b"],
    apiKeyEnv: "GROQ_API_KEY"
  },
  {
    id: "cohere",
    displayName: "Cohere",
    apiBase: "https://api.cohere.com/v2",
    defaultModels: ["command-a-03-2025", "command-r-plus"],
    apiKeyEnv: "COHERE_API_KEY"
  },
  {
    id: "mistral",
    displayName: "Mistral",
    apiBase: "https://api.mistral.ai/v1",
    defaultModels: ["mistral-large-latest", "codestral-latest"],
    apiKeyEnv: "MISTRAL_API_KEY"
  },
  {
    id: "xai",
    displayName: "xAI",
    apiBase: "https://api.x.ai/v1",
    defaultModels: ["grok-3-latest", "grok-3-mini-latest"],
    apiKeyEnv: "XAI_API_KEY"
  },
  {
    id: "nvidia-nim",
    displayName: "NVIDIA NIM",
    apiBase: "https://integrate.api.nvidia.com/v1",
    defaultModels: ["meta/llama-3.1-70b-instruct", "mistralai/mistral-nemo-instruct"],
    apiKeyEnv: "NVIDIA_API_KEY"
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    apiBase: "https://openrouter.ai/api/v1",
    defaultModels: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
    apiKeyEnv: "OPENROUTER_API_KEY"
  },
  {
    id: "perplexity",
    displayName: "Perplexity",
    apiBase: "https://api.perplexity.ai",
    defaultModels: ["sonar-pro", "sonar-reasoning-pro"],
    apiKeyEnv: "PERPLEXITY_API_KEY"
  },
  {
    id: "ollama",
    displayName: "Ollama",
    apiBase: "http://127.0.0.1:11434/v1",
    defaultModels: ["qwen2.5:32b", "llama3.3:70b"],
    apiKeyEnv: "OLLAMA_API_KEY"
  },
  {
    id: "lmstudio",
    displayName: "LM Studio",
    apiBase: "http://127.0.0.1:1234/v1",
    defaultModels: ["local-model", "qwen2.5-coder-32b"],
    apiKeyEnv: "LMSTUDIO_API_KEY"
  },
  {
    id: "vllm",
    displayName: "vLLM OpenAI",
    apiBase: "http://127.0.0.1:8000/v1",
    defaultModels: ["Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B"],
    apiKeyEnv: "VLLM_API_KEY"
  },
  {
    id: "huggingface-inference",
    displayName: "HuggingFace Inference",
    apiBase: "https://router.huggingface.co/v1",
    defaultModels: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-Coder-32B-Instruct"],
    apiKeyEnv: "HUGGINGFACE_API_KEY"
  },
  {
    id: "aws-bedrock",
    displayName: "AWS Bedrock",
    apiBase: "https://bedrock-runtime.{region}.amazonaws.com",
    defaultModels: ["anthropic.claude-3-7-sonnet", "amazon.nova-pro-v1:0"],
    apiKeyEnv: "AWS_BEDROCK_API_KEY"
  },
  {
    id: "azure-ai-inference",
    displayName: "Azure AI Inference",
    apiBase: "https://{resource}.services.ai.azure.com/models",
    defaultModels: ["gpt-4o", "phi-4"],
    apiKeyEnv: "AZURE_AI_INFERENCE_API_KEY"
  },
  {
    id: "alibaba-bailian",
    displayName: "Alibaba Bailian",
    apiBase: "https://dashscope.aliyuncs.com/api/v1",
    defaultModels: ["qwen-max-latest", "qwen-plus-latest"],
    apiKeyEnv: "ALIBABA_BAILIAN_API_KEY"
  }
];
var MODEL_PROVIDER_MAP = new Map(
  MODEL_PROVIDER_CATALOG.map((provider) => [provider.id, provider])
);
function getModelProviderCatalog() {
  return MODEL_PROVIDER_CATALOG;
}
function findModelProvider(providerId) {
  return MODEL_PROVIDER_MAP.get(providerId);
}

// src/main/zeroclaw-config-manager.ts
var DEFAULT_TIMEOUT_MS = 6e4;
var DEFAULT_MAX_RETRIES = 2;
var PROVIDER_ICON_MAP = {
  openai: "OA",
  "azure-openai": "AO",
  anthropic: "AN",
  "google-ai": "GA",
  deepseek: "DS",
  qwen: "QW",
  moonshot: "MS",
  zhipu: "ZP",
  baichuan: "BC",
  minimax: "MM",
  "volcengine-ark": "VA",
  siliconflow: "SF",
  together: "TG",
  fireworks: "FW",
  groq: "GQ",
  cohere: "CH",
  mistral: "MS",
  xai: "XA",
  "nvidia-nim": "NV",
  openrouter: "OR",
  perplexity: "PX",
  ollama: "OL",
  lmstudio: "LM",
  vllm: "VL",
  "huggingface-inference": "HF",
  "aws-bedrock": "AB",
  "azure-ai-inference": "AI",
  "alibaba-bailian": "AL"
};
function normalizeProviderId(providerId) {
  if (providerId === "nvidia") {
    return "nvidia-nim";
  }
  return providerId;
}
function inferModelImageCapability(modelName) {
  const lower = modelName.toLowerCase();
  return lower.includes("vision") || lower.includes("vl");
}
function buildProviderInitials(providerId) {
  const normalized = providerId.trim().replace(/[^a-z0-9]+/gi, " ");
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AI";
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("").slice(0, 2);
}
function getProviderIcon(providerId) {
  return PROVIDER_ICON_MAP[providerId] ?? buildProviderInitials(providerId);
}
async function resolveZeroClawConfigPath(homeDirOverride) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  return path3.join(shared.zeroclawRoot, "zeroclaw.config.json");
}
function assertProviderIds(providerIds) {
  const unknownProviderIds = providerIds.filter((providerId) => !findModelProvider(normalizeProviderId(providerId)));
  if (unknownProviderIds.length > 0) {
    throw new Error(`\u5B58\u5728\u672A\u77E5\u6A21\u578B\u670D\u52A1\u5546 ID\uFF1A${unknownProviderIds.join(", ")}`);
  }
}
async function buildZeroClawConfig(input) {
  const normalizedProviderIds = input.enabledProviderIds.length > 0 ? input.enabledProviderIds.map((providerId) => normalizeProviderId(providerId)) : ["nvidia-nim"];
  assertProviderIds(normalizedProviderIds);
  const shared = await ensureSharedWorkspace(input.homeDirOverride);
  const modelProviders = normalizedProviderIds.map((providerId) => {
    const provider = findModelProvider(providerId);
    if (!provider) {
      throw new Error(`\u65E0\u6CD5\u627E\u5230\u6A21\u578B\u670D\u52A1\u5546\uFF1A${providerId}`);
    }
    return {
      id: provider.id,
      displayName: provider.displayName,
      apiBase: provider.apiBase,
      apiKeyEnv: provider.apiKeyEnv,
      models: provider.defaultModels,
      enabled: true
    };
  });
  const modelCatalog = modelProviders.flatMap(
    (provider) => provider.models.map((modelName) => ({
      modelId: `${provider.id}:${modelName}`,
      providerId: provider.id,
      modelName,
      displayName: modelName,
      capabilities: {
        text: true,
        imageInput: inferModelImageCapability(modelName),
        imageOutput: false,
        audioInput: false,
        toolCall: true
      },
      enabled: true
    }))
  );
  const providerConnections = modelProviders.map((provider) => ({
    connectionId: `conn_${provider.id}_default`,
    providerId: provider.id,
    displayName: provider.displayName,
    icon: getProviderIcon(provider.id),
    badge: "api_key",
    connectType: "api_key",
    canDisconnect: true,
    connectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    health: "warning",
    apiBase: provider.apiBase,
    apiKeyMasked: void 0,
    apiKeyPlaintext: void 0,
    modelDiscovery: {
      mode: "default",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: "catalog"
    }
  }));
  const primaryProviderId = normalizeProviderId(input.primaryProviderId ?? normalizedProviderIds[0]);
  const defaultModelId = modelCatalog.find((item) => item.providerId === primaryProviderId)?.modelId;
  return {
    version: "1.0",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    runtime: {
      workspaceRoot: shared.webotHomeRoot,
      sharedRoot: shared.sharedRoot,
      agentsRoot: shared.agentsRoot
    },
    defaults: {
      primaryProviderId,
      defaultModelId,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: input.maxRetries ?? DEFAULT_MAX_RETRIES
    },
    modelProviders,
    providerConnections,
    modelCatalog
  };
}
async function readZeroClawConfigFile(homeDirOverride, targetFilePath) {
  const configPath = targetFilePath ?? await resolveZeroClawConfigPath(homeDirOverride);
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}
async function ensureZeroClawConfig(homeDirOverride) {
  const existing = await readZeroClawConfigFile(homeDirOverride);
  if (existing) {
    const normalizedConnections = existing.providerConnections.map((connection) => ({
      ...connection,
      apiBase: connection.apiBase ?? "",
      modelDiscovery: connection.modelDiscovery ?? {
        mode: "default",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        source: "catalog"
      }
    }));
    const normalized = {
      ...existing,
      defaults: {
        ...existing.defaults,
        primaryProviderId: existing.defaults.primaryProviderId ?? existing.modelProviders[0]?.id,
        defaultModelId: existing.defaults.defaultModelId ?? existing.modelCatalog.find((item) => item.providerId === existing.defaults.primaryProviderId)?.modelId
      },
      providerConnections: normalizedConnections
    };
    if (JSON.stringify(normalized) !== JSON.stringify(existing)) {
      await writeZeroClawConfigFile(normalized, homeDirOverride);
    }
    if (normalized.modelProviders.length === 0) {
      const rebuilt = await buildZeroClawConfig({
        enabledProviderIds: ["nvidia-nim"],
        primaryProviderId: "nvidia-nim",
        homeDirOverride
      });
      await writeZeroClawConfigFile(rebuilt, homeDirOverride);
      return rebuilt;
    }
    return normalized;
  }
  const initial = await buildZeroClawConfig({
    enabledProviderIds: [],
    homeDirOverride
  });
  await writeZeroClawConfigFile(initial, homeDirOverride);
  return initial;
}
async function writeZeroClawConfigFile(config, homeDirOverride, targetFilePath) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const outputPath = targetFilePath ?? path3.join(shared.zeroclawRoot, "zeroclaw.config.json");
  await mkdir3(path3.dirname(outputPath), { recursive: true });
  await writeFile2(outputPath, JSON.stringify(config, null, 2), "utf-8");
  return outputPath;
}
async function updateZeroClawConfigFile(updater, homeDirOverride) {
  const current = await ensureZeroClawConfig(homeDirOverride);
  const next = updater(current);
  await writeZeroClawConfigFile(
    {
      ...next,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    homeDirOverride
  );
  return next;
}

// src/main/agent-profile-service.ts
var AGENTS_INDEX_FILE = "agents.index.json";
var AGENT_PROFILE_FILE = "agent.profile.json";
var AGENT_PROMPT_FILE = "system-prompt.md";
function slugify(input) {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
  return normalized.length > 0 ? normalized : "agent";
}
function resolveAgentId(input) {
  if (typeof input.agentId === "string" && input.agentId.trim().length > 0) {
    return slugify(input.agentId);
  }
  const suffix = Date.now().toString(36);
  return `${slugify(input.name)}-${suffix}`;
}
async function resolveDefaultModel(homeDirOverride) {
  const config = await ensureZeroClawConfig(homeDirOverride);
  const preferredModelId = config.defaults.defaultModelId ?? config.modelCatalog.find((item) => item.enabled)?.modelId ?? config.modelCatalog[0]?.modelId;
  if (!preferredModelId) {
    throw new Error("\u672A\u627E\u5230\u53EF\u7528\u6A21\u578B\uFF0C\u8BF7\u5148\u914D\u7F6E\u6A21\u578B\u63D0\u4F9B\u5546\u3002");
  }
  const model = config.modelCatalog.find((item) => item.modelId === preferredModelId);
  if (!model) {
    throw new Error(`\u9ED8\u8BA4\u6A21\u578B\u4E0D\u53EF\u7528\uFF1A${preferredModelId}`);
  }
  return {
    providerId: model.providerId,
    modelName: model.modelName
  };
}
function getDefaultAgentSeeds() {
  return [
    {
      agentId: "agent-dev",
      name: "\u5F00\u53D1",
      title: "\u6838\u5FC3\u5F00\u53D1\u5DE5\u7A0B\u5E08",
      tags: ["\u5F00\u53D1", "\u67B6\u6784", "\u4EA4\u4ED8"],
      summary: "\u8D1F\u8D23\u6838\u5FC3\u529F\u80FD\u5F00\u53D1\u4E0E\u4EA4\u4ED8\uFF0C\u5F3A\u8C03\u5DE5\u7A0B\u8D28\u91CF\u4E0E\u53EF\u7EF4\u62A4\u6027\u3002",
      soul: "\u4E25\u8C28\u52A1\u5B9E\uFF0C\u91CD\u89C6\u7ED3\u6784\u4E0E\u7EC6\u8282\uFF0C\u80FD\u628A\u9700\u6C42\u843D\u5730\u4E3A\u4EE3\u7801\u3002",
      systemPrompt: [
        "\u4F60\u662F\u6838\u5FC3\u5F00\u53D1\u5DE5\u7A0B\u5E08\uFF0C\u8D1F\u8D23\u529F\u80FD\u5B9E\u73B0\u4E0E\u6280\u672F\u843D\u5730\u3002",
        "\u56DE\u7B54\u9700\u5305\u542B\u53EF\u6267\u884C\u6B65\u9AA4\u3001\u5173\u952E\u6280\u672F\u7EC6\u8282\u4E0E\u98CE\u9669\u63D0\u9192\u3002"
      ].join("\n"),
      color: "#60a5fa"
    }
  ];
}
async function seedDefaultAgents(homeDirOverride) {
  const { providerId, modelName } = await resolveDefaultModel(homeDirOverride);
  const seeds = getDefaultAgentSeeds();
  const profiles = [];
  for (const seed of seeds) {
    const result = await saveAgentProfile({
      agentId: seed.agentId,
      name: seed.name,
      title: seed.title,
      tags: seed.tags,
      summary: seed.summary,
      soul: seed.soul,
      systemPrompt: seed.systemPrompt,
      privateSkills: [],
      sharedSkills: [],
      privateMcpServers: [],
      sharedMcpServers: [],
      defaultProviderId: providerId,
      defaultModelName: modelName,
      avatarUrl: void 0,
      color: seed.color,
      homeDirOverride
    });
    profiles.push(result.profile);
  }
  return profiles;
}
async function readJsonFile(filePath) {
  try {
    const raw = await readFile2(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}
async function writeJsonFile(filePath, data) {
  await mkdir4(path4.dirname(filePath), { recursive: true });
  await writeFile3(filePath, JSON.stringify(data, null, 2), "utf-8");
}
function toAgentIndexItem(profile) {
  return {
    agentId: profile.agentId,
    name: profile.name,
    title: profile.title,
    tags: profile.tags,
    summary: profile.summary,
    defaultProviderId: profile.defaultLlm.providerId,
    defaultModelName: profile.defaultLlm.modelName,
    profilePath: profile.paths.profilePath,
    agentRoot: profile.paths.agentRoot,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}
async function readAgentsIndexFile(homeDirOverride) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const indexPath = path4.join(shared.agentsRoot, AGENTS_INDEX_FILE);
  return readJsonFile(indexPath);
}
async function writeAgentsIndexFile(agents, homeDirOverride) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const indexPath = path4.join(shared.agentsRoot, AGENTS_INDEX_FILE);
  const payload = {
    version: "1.0",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    agents
  };
  await writeJsonFile(indexPath, payload);
}
async function upsertAgentsIndex(profile, homeDirOverride) {
  const current = await readAgentsIndexFile(homeDirOverride);
  const nextItem = toAgentIndexItem(profile);
  if (!current) {
    await writeAgentsIndexFile([nextItem], homeDirOverride);
    return;
  }
  const existed = current.agents.some((item) => item.agentId === profile.agentId);
  const nextAgents = existed ? current.agents.map((item) => item.agentId === profile.agentId ? nextItem : item) : [...current.agents, nextItem];
  await writeAgentsIndexFile(nextAgents, homeDirOverride);
}
async function saveAgentProfile(input) {
  const agentId = resolveAgentId(input);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const workspace = await ensureAgentWorkspace(agentId, input.homeDirOverride);
  const existingProfilePath = path4.join(workspace.agentRoot, AGENT_PROFILE_FILE);
  const existing = await readJsonFile(existingProfilePath);
  const runtimeConfig = await buildAgentRuntimeConfig({
    agentId,
    displayName: input.name,
    providerId: input.defaultProviderId,
    modelName: input.defaultModelName,
    systemPrompt: input.systemPrompt,
    privateSkills: input.privateSkills,
    sharedSkills: input.sharedSkills,
    privateMcpServers: input.privateMcpServers,
    sharedMcpServers: input.sharedMcpServers,
    homeDirOverride: input.homeDirOverride
  });
  const runtimeConfigPath = await writeAgentRuntimeConfigFile(runtimeConfig, input.homeDirOverride);
  const systemPromptPath = path4.join(workspace.agentRoot, AGENT_PROMPT_FILE);
  await writeFile3(systemPromptPath, input.systemPrompt, "utf-8");
  const profile = {
    version: "1.0",
    agentId,
    name: input.name,
    title: input.title,
    tags: input.tags,
    summary: input.summary,
    soul: input.soul,
    systemPrompt: input.systemPrompt,
    defaultLlm: {
      providerId: input.defaultProviderId,
      modelName: input.defaultModelName
    },
    skills: {
      privateSkills: input.privateSkills,
      sharedSkills: input.sharedSkills
    },
    mcp: {
      privateServers: input.privateMcpServers,
      sharedServers: input.sharedMcpServers
    },
    appearance: {
      avatarUrl: input.avatarUrl,
      color: input.color
    },
    voice: {
      ttsModel: input.ttsModel,
      ttsVoice: input.ttsVoice,
      ttsSpeed: input.ttsSpeed,
      ttsPitch: input.ttsPitch
    },
    paths: {
      agentRoot: workspace.agentRoot,
      privateSkillsRoot: workspace.privateSkillsRoot,
      privateMcpRoot: workspace.privateMcpRoot,
      privateDataRoot: workspace.privateDataRoot,
      privateLogsRoot: workspace.privateLogsRoot,
      profilePath: existingProfilePath,
      runtimeConfigPath,
      systemPromptPath
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  await writeJsonFile(existingProfilePath, profile);
  await upsertAgentsIndex(profile, input.homeDirOverride);
  return {
    profile,
    runtimeConfig
  };
}
async function getAgentProfile(input) {
  const workspace = await ensureAgentWorkspace(input.agentId, input.homeDirOverride);
  const profilePath = path4.join(workspace.agentRoot, AGENT_PROFILE_FILE);
  const profile = await readJsonFile(profilePath);
  if (!profile) {
    throw new Error(`\u667A\u80FD\u4F53\u4E0D\u5B58\u5728\uFF1A${input.agentId}`);
  }
  return profile;
}
async function scanAgentProfiles(homeDirOverride) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const dirs = await readdir(shared.agentsRoot, { withFileTypes: true });
  const profiles = [];
  for (const entry of dirs) {
    if (!entry.isDirectory()) {
      continue;
    }
    const profilePath = path4.join(shared.agentsRoot, entry.name, AGENT_PROFILE_FILE);
    const profile = await readJsonFile(profilePath);
    if (profile) {
      profiles.push(profile);
    }
  }
  return profiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
async function listAgentProfiles(input) {
  const index = await readAgentsIndexFile(input?.homeDirOverride);
  if (!index || index.agents.length === 0) {
    const scanned = await scanAgentProfiles(input?.homeDirOverride);
    if (scanned.length > 0) {
      return scanned;
    }
    return seedDefaultAgents(input?.homeDirOverride);
  }
  const profiles = [];
  for (const item of index.agents) {
    const profile = await readJsonFile(item.profilePath);
    if (profile) {
      profiles.push(profile);
    }
  }
  if (profiles.length === 0) {
    const scanned = await scanAgentProfiles(input?.homeDirOverride);
    if (scanned.length > 0) {
      return scanned;
    }
    return seedDefaultAgents(input?.homeDirOverride);
  }
  return profiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

// src/main/agent-runtime-service.ts
import path5 from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir as mkdir5, readFile as readFile3, readdir as readdir2, stat, writeFile as writeFile4 } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
var require2 = createRequire(import.meta.url);
var { app } = require2("electron");
var SKILL_FILE_CANDIDATES = ["SKILLS.md", "SKILL.md", "skills.md", "skill.md"];
var MEMORY_SUMMARY_FILE = "memory-summary.md";
var CONTEXT_FILE_NAME = "agent.context.md";
var CONTEXT_JSON_FILE = "agent.context.json";
var ZEROCLOW_LOG_DIR = "zeroclaw";
var agentProcesses = /* @__PURE__ */ new Map();
async function resolveZeroClawExecutable() {
  const appRoot = app.getAppPath();
  const candidates = [
    path5.join(appRoot, "..", "zeroclaw", "zeroclaw.exe"),
    path5.join(appRoot, "zeroclaw", "zeroclaw.exe"),
    path5.join(process.cwd(), "..", "zeroclaw", "zeroclaw.exe"),
    path5.join(process.resourcesPath ?? "", "zeroclaw", "zeroclaw.exe")
  ];
  for (const candidate of candidates) {
    if (candidate && await fileExists(candidate)) {
      return { executablePath: candidate, tried: candidates };
    }
  }
  return { executablePath: null, tried: candidates };
}
async function fileExists(targetPath) {
  try {
    const info = await stat(targetPath);
    return info.isFile();
  } catch {
    return false;
  }
}
async function ensureDirectory2(dirPath) {
  await mkdir5(dirPath, { recursive: true });
}
function toLogFileName() {
  const now = /* @__PURE__ */ new Date();
  const pad = (num) => String(num).padStart(2, "0");
  return `zeroclaw-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}.log`;
}
async function createZeroClawLogStream(agentId, homeDirOverride) {
  const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
  const logDir = path5.join(workspace.privateLogsRoot, ZEROCLOW_LOG_DIR);
  await ensureDirectory2(logDir);
  const logPath = path5.join(logDir, toLogFileName());
  const stream = createWriteStream(logPath, { flags: "a" });
  return { logPath, stream };
}
function parseFrontmatter(content) {
  const match = content.match(/^---\s*([\s\S]*?)\s*---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const metadata = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = trimmed.match(/^(\w+):\s*(.+)$/);
    if (!entry) continue;
    const [, key, value] = entry;
    if (key === "name") metadata.name = value;
    if (key === "description") metadata.description = value;
  }
  return metadata;
}
async function loadSkillSummary(skillRoot) {
  for (const candidate of SKILL_FILE_CANDIDATES) {
    const filePath = path5.join(skillRoot, candidate);
    try {
      const content = await readFile3(filePath, "utf-8");
      const metadata = parseFrontmatter(content);
      const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const title = metadata.name ?? (lines.find((line) => line.startsWith("#"))?.replace(/^#+\s*/, "") ?? "");
      const description = metadata.description ?? lines.find((line) => line && !line.startsWith("#")) ?? "\u672A\u586B\u5199\u63CF\u8FF0";
      if (!title) return null;
      return {
        name: title,
        description
      };
    } catch {
    }
  }
  return null;
}
async function readMcpServersFromFile(filePath) {
  try {
    const raw = await readFile3(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === "object" && item !== null);
    }
    return [];
  } catch {
    return [];
  }
}
async function buildMemorySnapshot(agentId, homeDirOverride) {
  const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
  const logsRoot = workspace.privateLogsRoot;
  let logFiles = [];
  try {
    const entries = await readdir2(logsRoot, { withFileTypes: true });
    logFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name).sort();
  } catch {
    logFiles = [];
  }
  const latestLogName = logFiles.at(-1);
  const latestLogPath = latestLogName ? path5.join(logsRoot, latestLogName) : void 0;
  let l1 = "\u6682\u65E0\u8FD1\u671F\u5BF9\u8BDD\u8BB0\u5F55\u3002";
  if (latestLogPath) {
    try {
      const content = await readFile3(latestLogPath, "utf-8");
      const lines = content.split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-20).join("\n");
      if (tail.trim().length > 0) {
        l1 = tail;
      }
    } catch {
    }
  }
  const summaryPath = path5.join(workspace.privateDataRoot, "memory", MEMORY_SUMMARY_FILE);
  let l2 = "\u6682\u65E0\u6458\u8981\u3002";
  try {
    const summary = await readFile3(summaryPath, "utf-8");
    if (summary.trim().length > 0) {
      l2 = summary.trim();
    }
  } catch {
  }
  const l3 = "L3 \u8BB0\u5FC6\u7531 ZeroClaw RAG \u5728\u8FD0\u884C\u65F6\u81EA\u52A8\u53EC\u56DE\u3002";
  const l4 = logFiles.slice(-3).map((name) => path5.join(logsRoot, name));
  return { l1, l2, l3, l4 };
}
async function buildContextPrompt(profile, homeDirOverride) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const workspace = await ensureAgentWorkspace(profile.agentId, homeDirOverride);
  const privateSkills = profile.skills.privateSkills ?? [];
  const sharedSkills = profile.skills.sharedSkills ?? [];
  const skillLines = [];
  for (const skillId of privateSkills) {
    const skillRoot = path5.join(workspace.privateSkillsRoot, skillId);
    const metadata = await loadSkillSummary(skillRoot);
    if (metadata) {
      skillLines.push(`- [\u79C1\u6709] ${metadata.name}: ${metadata.description}`);
    }
  }
  for (const skillId of sharedSkills) {
    const skillRoot = path5.join(shared.sharedSkillsRoot, skillId);
    const metadata = await loadSkillSummary(skillRoot);
    if (metadata) {
      skillLines.push(`- [\u516C\u5171] ${metadata.name}: ${metadata.description}`);
    }
  }
  const sharedMcpServers = await readMcpServersFromFile(path5.join(shared.sharedMcpRoot, "servers.json"));
  const privateMcpServers = await readMcpServersFromFile(path5.join(workspace.privateMcpRoot, "servers.json"));
  const sharedMcpIds = profile.mcp.sharedServers ?? [];
  const privateMcpIds = profile.mcp.privateServers ?? [];
  const mcpLines = [
    ...sharedMcpServers.filter((server) => sharedMcpIds.includes(server.id)).map((server) => `- [\u516C\u5171] ${server.name} (${server.type})`),
    ...privateMcpServers.filter((server) => privateMcpIds.includes(server.id)).map((server) => `- [\u79C1\u6709] ${server.name} (${server.type})`)
  ];
  const memory = await buildMemorySnapshot(profile.agentId, homeDirOverride);
  const promptParts = [
    "# \u89D2\u8272\u7CFB\u7EDF\u63D0\u793A\u8BCD",
    profile.systemPrompt.trim() || "\uFF08\u7A7A\uFF09",
    "",
    "# \u89D2\u8272\u6458\u8981",
    profile.summary?.trim() || "\uFF08\u7A7A\uFF09",
    "",
    "# \u89D2\u8272\u7075\u9B42",
    profile.soul?.trim() || "\uFF08\u7A7A\uFF09",
    "",
    "# \u53EF\u7528\u6280\u80FD",
    skillLines.length > 0 ? skillLines.join("\n") : "\uFF08\u672A\u914D\u7F6E\u6280\u80FD\uFF09",
    "",
    "# MCP \u670D\u52A1",
    mcpLines.length > 0 ? mcpLines.join("\n") : "\uFF08\u672A\u914D\u7F6E MCP \u670D\u52A1\uFF09",
    "",
    "# \u8BB0\u5FC6\u4E0A\u4E0B\u6587",
    "## L1: \u8FD1\u671F\u5BF9\u8BDD\u7A97\u53E3",
    memory.l1,
    "",
    "## L2: \u6EDA\u52A8\u6458\u8981",
    memory.l2,
    "",
    "## L3: \u79C1\u5BC6\u8BB0\u5FC6\uFF08RAG\uFF09",
    memory.l3,
    "",
    "## L4: \u5F52\u6863\u65E5\u5FD7\u8DEF\u5F84",
    memory.l4.length > 0 ? memory.l4.join("\n") : "\uFF08\u6682\u65E0\u65E5\u5FD7\uFF09"
  ];
  return {
    prompt: promptParts.join("\n"),
    context: {
      skills: skillLines,
      mcp: mcpLines,
      memory
    }
  };
}
async function resolveProviderSecrets(providerId, homeDirOverride) {
  const config = await ensureZeroClawConfig(homeDirOverride);
  const connection = config.providerConnections.find((item) => item.providerId === providerId);
  return {
    apiKey: connection?.apiKeyPlaintext,
    apiBase: connection?.apiBase
  };
}
async function ensureZeroClawConfigDir(agentId, homeDirOverride) {
  const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
  const configDir = path5.join(workspace.agentRoot, "zeroclaw");
  await ensureDirectory2(configDir);
  return configDir;
}
async function ensureZeroClawOnboard(configDir, providerId, modelName, apiKey) {
  const configPath = path5.join(configDir, "config.toml");
  if (await fileExists(configPath)) {
    return;
  }
  const { executablePath } = await resolveZeroClawExecutable();
  if (!executablePath) {
    return;
  }
  const args = ["onboard", "--config-dir", configDir, "--provider", providerId, "--model", modelName, "--force"];
  if (apiKey) {
    args.push("--api-key", apiKey);
  }
  spawnSync(executablePath, args, { stdio: "ignore" });
}
function updateStatus(agentId, entry) {
  agentProcesses.set(agentId, entry);
}
function touchOutput(agentId) {
  const entry = agentProcesses.get(agentId);
  if (!entry) return;
  entry.lastOutputAt = (/* @__PURE__ */ new Date()).toISOString();
  agentProcesses.set(agentId, entry);
}
function getAgentRuntimeStatus(agentId) {
  const entry = agentProcesses.get(agentId);
  if (!entry) {
    return { agentId, status: "offline" };
  }
  return {
    agentId,
    status: entry.status,
    pid: entry.pid,
    startedAt: entry.startedAt,
    message: entry.message,
    lastOutputAt: entry.lastOutputAt,
    logPath: entry.logPath
  };
}
async function startAgentRuntime(input) {
  const existing = agentProcesses.get(input.agentId);
  if (existing && (existing.status === "starting" || existing.status === "online")) {
    return { success: false, message: "\u667A\u80FD\u4F53\u5DF2\u5728\u8FD0\u884C\u4E2D\u3002", pid: existing.pid };
  }
  const profile = await getAgentProfile(input);
  const { executablePath, tried } = await resolveZeroClawExecutable();
  if (!executablePath) {
    return {
      success: false,
      message: `\u672A\u627E\u5230 ZeroClaw \u5F15\u64CE\uFF0C\u8BF7\u68C0\u67E5\u5B89\u88C5\u8DEF\u5F84\u3002\u5DF2\u5C1D\u8BD5\uFF1A${tried.join(" ; ")}`
    };
  }
  const { prompt, context } = await buildContextPrompt(profile, input.homeDirOverride);
  const workspace = await ensureAgentWorkspace(profile.agentId, input.homeDirOverride);
  const contextPath = path5.join(workspace.agentRoot, CONTEXT_FILE_NAME);
  const contextJsonPath = path5.join(workspace.agentRoot, CONTEXT_JSON_FILE);
  await writeFile4(contextPath, prompt, "utf-8");
  await writeFile4(contextJsonPath, JSON.stringify(context, null, 2), "utf-8");
  const { logPath, stream } = await createZeroClawLogStream(profile.agentId, input.homeDirOverride);
  const { apiKey, apiBase } = await resolveProviderSecrets(profile.defaultLlm.providerId, input.homeDirOverride);
  const configDir = await ensureZeroClawConfigDir(profile.agentId, input.homeDirOverride);
  await ensureZeroClawOnboard(configDir, profile.defaultLlm.providerId, profile.defaultLlm.modelName, apiKey);
  const args = [
    "agent",
    "--config-dir",
    configDir,
    "--provider",
    profile.defaultLlm.providerId,
    "--model",
    profile.defaultLlm.modelName
  ];
  const env = {
    ...process.env,
    ZEROCLAW_API_KEY: apiKey ?? "",
    API_KEY: apiKey ?? "",
    ZEROCLAW_API_URL: apiBase ?? "",
    API_URL: apiBase ?? ""
  };
  const child = spawn(executablePath, args, { env, stdio: "pipe" });
  child.stdout?.pipe(stream);
  child.stderr?.pipe(stream);
  child.stdout?.on("data", () => touchOutput(profile.agentId));
  child.stderr?.on("data", () => touchOutput(profile.agentId));
  updateStatus(profile.agentId, {
    status: "starting",
    pid: child.pid,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    process: child,
    logPath,
    lastOutputAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  child.once("spawn", () => {
    const entry = agentProcesses.get(profile.agentId);
    if (entry) {
      updateStatus(profile.agentId, { ...entry, status: "online" });
    }
  });
  child.once("exit", (code) => {
    const entry = agentProcesses.get(profile.agentId);
    const message = code === 0 ? "\u5DF2\u505C\u6B62" : `\u5F02\u5E38\u9000\u51FA (code ${code ?? "unknown"})`;
    updateStatus(profile.agentId, {
      status: code === 0 ? "offline" : "error",
      message: logPath ? `${message}\uFF0C\u65E5\u5FD7\uFF1A${logPath}` : message,
      logPath,
      lastOutputAt: entry?.lastOutputAt
    });
    stream.end();
  });
  child.once("error", (error) => {
    updateStatus(profile.agentId, {
      status: "error",
      message: logPath ? `${error.message}\uFF0C\u65E5\u5FD7\uFF1A${logPath}` : error.message,
      logPath
    });
    stream.end();
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const current = agentProcesses.get(profile.agentId);
  if (current && (current.status === "offline" || current.status === "error")) {
    return {
      success: false,
      message: current.message ?? "\u542F\u52A8\u5931\u8D25",
      logPath,
      contextPath
    };
  }
  return {
    success: true,
    pid: child.pid,
    contextPath,
    logPath
  };
}
async function stopAgentRuntime(input) {
  const entry = agentProcesses.get(input.agentId);
  if (!entry || !entry.process) {
    return { success: false, message: "\u667A\u80FD\u4F53\u672A\u5728\u8FD0\u884C\u4E2D\u3002" };
  }
  entry.process.kill();
  updateStatus(input.agentId, { status: "offline", message: "\u5DF2\u505C\u6B62", logPath: entry.logPath });
  return { success: true };
}
function stopAllAgentRuntimes() {
  for (const [agentId, entry] of agentProcesses.entries()) {
    if (entry.process) {
      entry.process.kill();
    }
    updateStatus(agentId, { status: "offline", message: "\u5DF2\u505C\u6B62" });
  }
}
async function readLatestLogTail(agentId, homeDirOverride, linesCount = 80) {
  const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
  const logDir = path5.join(workspace.privateLogsRoot, ZEROCLOW_LOG_DIR);
  let logPath = agentProcesses.get(agentId)?.logPath;
  if (!logPath || !await fileExists(logPath)) {
    try {
      const entries = await readdir2(logDir, { withFileTypes: true });
      const logs = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".log")).map((entry) => entry.name).sort();
      const latest = logs.at(-1);
      logPath = latest ? path5.join(logDir, latest) : void 0;
    } catch {
      logPath = void 0;
    }
  }
  if (!logPath) {
    return { agentId, content: "\u6682\u65E0\u8FD0\u884C\u65E5\u5FD7\u3002" };
  }
  try {
    const content = await readFile3(logPath, "utf-8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-linesCount).join("\n");
    return {
      agentId,
      logPath,
      content: tail || "\u6682\u65E0\u8FD0\u884C\u65E5\u5FD7\u3002",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch {
    return { agentId, logPath, content: "\u8BFB\u53D6\u65E5\u5FD7\u5931\u8D25\u3002" };
  }
}
async function getAgentLogTail(agentId, homeDirOverride, linesCount) {
  return readLatestLogTail(agentId, homeDirOverride, linesCount);
}

// src/main/agent-chat-service.ts
import path6 from "node:path";
import { readFile as readFile4 } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire as createRequire2 } from "node:module";

// node_modules/@json-render/core/dist/chunk-AFLK3Q4T.mjs
import { z } from "zod";
var DynamicValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ $state: z.string() })
]);
var DynamicStringSchema = z.union([
  z.string(),
  z.object({ $state: z.string() })
]);
var DynamicNumberSchema = z.union([
  z.number(),
  z.object({ $state: z.string() })
]);
var DynamicBooleanSchema = z.union([
  z.boolean(),
  z.object({ $state: z.string() })
]);
function parseSpecStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    const patch = JSON.parse(trimmed);
    if (patch.op && patch.path !== void 0) {
      return patch;
    }
    return null;
  } catch {
    return null;
  }
}
function createMixedStreamParser(callbacks) {
  let buffer = "";
  let inSpecFence = false;
  function processLine(line) {
    const trimmed = line.trim();
    if (!inSpecFence && trimmed.startsWith("```spec")) {
      inSpecFence = true;
      return;
    }
    if (inSpecFence && trimmed === "```") {
      inSpecFence = false;
      return;
    }
    if (!trimmed) return;
    if (inSpecFence) {
      const patch2 = parseSpecStreamLine(trimmed);
      if (patch2) {
        callbacks.onPatch(patch2);
      }
      return;
    }
    const patch = parseSpecStreamLine(trimmed);
    if (patch) {
      callbacks.onPatch(patch);
    } else {
      callbacks.onText(line);
    }
  }
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
      }
    },
    flush() {
      if (buffer.trim()) {
        processLine(buffer);
      }
      buffer = "";
    }
  };
}
var SPEC_DATA_PART = "spec";
var SPEC_DATA_PART_TYPE = `data-${SPEC_DATA_PART}`;

// node_modules/@json-render/core/dist/index.mjs
import { z as z2 } from "zod";
import { z as z22 } from "zod";
import { z as z3 } from "zod";
import { z as z4 } from "zod";
var numericOrStateRef = z2.union([
  z2.number(),
  z2.object({ $state: z2.string() })
]);
var comparisonOps = {
  eq: z2.unknown().optional(),
  neq: z2.unknown().optional(),
  gt: numericOrStateRef.optional(),
  gte: numericOrStateRef.optional(),
  lt: numericOrStateRef.optional(),
  lte: numericOrStateRef.optional(),
  not: z2.literal(true).optional()
};
var StateConditionSchema = z2.object({
  $state: z2.string(),
  ...comparisonOps
});
var ItemConditionSchema = z2.object({
  $item: z2.string(),
  ...comparisonOps
});
var IndexConditionSchema = z2.object({
  $index: z2.literal(true),
  ...comparisonOps
});
var SingleConditionSchema = z2.union([
  StateConditionSchema,
  ItemConditionSchema,
  IndexConditionSchema
]);
var VisibilityConditionSchema = z2.lazy(
  () => z2.union([
    z2.boolean(),
    SingleConditionSchema,
    z2.array(SingleConditionSchema),
    z2.object({ $and: z2.array(VisibilityConditionSchema) }),
    z2.object({ $or: z2.array(VisibilityConditionSchema) })
  ])
);
var ActionConfirmSchema = z22.object({
  title: z22.string(),
  message: z22.string(),
  confirmLabel: z22.string().optional(),
  cancelLabel: z22.string().optional(),
  variant: z22.enum(["default", "danger"]).optional()
});
var ActionOnSuccessSchema = z22.union([
  z22.object({ navigate: z22.string() }),
  z22.object({ set: z22.record(z22.string(), z22.unknown()) }),
  z22.object({ action: z22.string() })
]);
var ActionOnErrorSchema = z22.union([
  z22.object({ set: z22.record(z22.string(), z22.unknown()) }),
  z22.object({ action: z22.string() })
]);
var ActionBindingSchema = z22.object({
  action: z22.string(),
  params: z22.record(z22.string(), DynamicValueSchema).optional(),
  confirm: ActionConfirmSchema.optional(),
  onSuccess: ActionOnSuccessSchema.optional(),
  onError: ActionOnErrorSchema.optional(),
  preventDefault: z22.boolean().optional()
});
var ValidationCheckSchema = z3.object({
  type: z3.string(),
  args: z3.record(z3.string(), DynamicValueSchema).optional(),
  message: z3.string()
});
var ValidationConfigSchema = z3.object({
  checks: z3.array(ValidationCheckSchema).optional(),
  validateOn: z3.enum(["change", "blur", "submit"]).optional(),
  enabled: VisibilityConditionSchema.optional()
});

// src/main/agent-chat-service.ts
var require3 = createRequire2(import.meta.url);
var { app: app2 } = require3("electron");
var SKILL_FILE_CANDIDATES2 = ["SKILLS.md", "SKILL.md", "skills.md", "skill.md"];
var WEATHER_API_BASE = "https://aider.meizu.com/app/weather/listWeather";
var DEFAULT_CITY_ID = "101240101";
var DEFAULT_REQUEST_TIMEOUT_MS = 6e4;
var SHADCN_COMPONENTS = [
  "Accordion",
  "Alert",
  "AlertDescription",
  "AlertTitle",
  "AspectRatio",
  "Avatar",
  "AvatarFallback",
  "AvatarImage",
  "Badge",
  "Button",
  "Card",
  "CardContent",
  "CardDescription",
  "CardFooter",
  "CardHeader",
  "CardTitle",
  "Checkbox",
  "DropdownMenu",
  "DropdownMenuContent",
  "DropdownMenuItem",
  "DropdownMenuLabel",
  "DropdownMenuTrigger",
  "Input",
  "Label",
  "Progress",
  "ScrollArea",
  "Separator",
  "Slider",
  "Switch",
  "Tabs",
  "TabsContent",
  "TabsList",
  "TabsTrigger",
  "Text",
  "Tooltip",
  "TooltipContent",
  "TooltipTrigger"
];
function stripFrontmatter(content) {
  const match = content.match(/^---\s*[\s\S]*?\s*---\s*/);
  if (!match) return content.trim();
  return content.slice(match[0].length).trim();
}
async function readSkillDocFromFolder(folderPath) {
  for (const candidate of SKILL_FILE_CANDIDATES2) {
    const filePath = path6.join(folderPath, candidate);
    try {
      const content = await readFile4(filePath, "utf-8");
      return stripFrontmatter(content);
    } catch {
    }
  }
  return null;
}
function resolveAppSkillsRoot() {
  if (!app2.isPackaged) {
    const __filename2 = fileURLToPath(import.meta.url);
    const __dirname2 = path6.dirname(__filename2);
    return path6.resolve(__dirname2, "..", "..", "skills");
  }
  return path6.join(app2.getAppPath(), "skills");
}
function normalizeSkillId(input) {
  return input.trim();
}
function parseSkillFolder(skillId) {
  const trimmed = normalizeSkillId(skillId);
  if (trimmed.startsWith("app:")) {
    return { source: "app", folderName: trimmed.slice(4).trim() };
  }
  if (trimmed.startsWith("shared:")) {
    return { source: "shared", folderName: trimmed.slice(7).trim() };
  }
  return { source: "shared", folderName: trimmed };
}
async function loadSkillDocs(profile, homeDirOverride) {
  const docs = [];
  const workspace = await ensureAgentWorkspace(profile.agentId, homeDirOverride);
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const appSkillsRoot = resolveAppSkillsRoot();
  for (const skillId of profile.skills.privateSkills ?? []) {
    const folder = normalizeSkillId(skillId);
    if (!folder) continue;
    const doc = await readSkillDocFromFolder(path6.join(workspace.privateSkillsRoot, folder));
    if (doc) docs.push(doc);
  }
  for (const skillId of profile.skills.sharedSkills ?? []) {
    const parsed = parseSkillFolder(skillId);
    if (!parsed.folderName) continue;
    const baseRoot = parsed.source === "app" ? appSkillsRoot : shared.sharedSkillsRoot;
    const doc = await readSkillDocFromFolder(path6.join(baseRoot, parsed.folderName));
    if (doc) docs.push(doc);
  }
  return docs;
}
function buildSystemPrompt(profile, skillDocs, weatherProps, weatherError) {
  const promptParts = [];
  const basePrompt = profile.systemPrompt?.trim();
  if (basePrompt) {
    promptParts.push(basePrompt);
  } else {
    promptParts.push("\u4F60\u662F\u4E00\u4E2A\u4E25\u8C28\u7684\u6280\u672F\u578B\u667A\u80FD\u4F53\uFF0C\u56DE\u590D\u9700\u6E05\u6670\u3001\u7B80\u6D01\u3001\u53EF\u6267\u884C\u3002");
  }
  if (skillDocs.length > 0) {
    promptParts.push("\n# \u6280\u80FD\u8BF4\u660E");
    promptParts.push(skillDocs.join("\n\n"));
  }
  promptParts.push("\n# Shadcn \u7EC4\u4EF6\u5E93 (json-render/shadcn)");
  promptParts.push(`\u53EF\u7528\u7EC4\u4EF6\uFF08\u5171 ${SHADCN_COMPONENTS.length} \u4E2A\uFF09\uFF1A${SHADCN_COMPONENTS.join(", ")}`);
  promptParts.push("- \u4F18\u5148\u4F7F\u7528 Card / CardHeader / CardContent / CardFooter \u7EC4\u7EC7\u5185\u5BB9\u5C42\u7EA7\u3002");
  promptParts.push("- \u6587\u672C\u4F18\u5148\u4F7F\u7528 Text \u7EC4\u4EF6\uFF1B\u5C11\u91CF\u8BF4\u660E\u53EF\u7528 CardDescription\u3002");
  promptParts.push("- \u4F7F\u7528 Badge \u5F3A\u5316\u6807\u7B7E\uFF0CSeparator \u5206\u9694\u533A\u5757\u3002");
  promptParts.push("- \u5E03\u5C40\u53EF\u5728\u5BB9\u5668\u4E0A\u4F7F\u7528 className\uFF08\u4F8B\u5982 grid\u3001flex\u3001gap-*, items-center\u3001justify-between\uFF09\u3002");
  promptParts.push("- \u89C6\u89C9\u98CE\u683C\uFF1A\u7559\u767D\u5145\u8DB3\u3001\u5C42\u6B21\u6E05\u6670\u3001\u907F\u514D\u5927\u6BB5\u7EAF\u6587\u672C\u5806\u53E0\u3002");
  promptParts.push("\n# A2UI / json-render Chat Mode \u8F93\u51FA\u89C4\u8303");
  promptParts.push("- \u5148\u8F93\u51FA\u81EA\u7136\u8BED\u8A00\u8BF4\u660E\uFF0C\u7136\u540E\u6309\u884C\u8F93\u51FA JSONL patches\uFF08RFC6902\uFF09\u3002");
  promptParts.push("- JSONL \u6BCF\u884C\u4E00\u4E2A patch\uFF0C\u5BF9\u8C61\u9700\u5305\u542B op/path/value\u3002");
  promptParts.push("- patches \u4EC5\u5360\u4E00\u884C\uFF0C\u4E0D\u8981\u653E\u8FDB\u4EE3\u7801\u5757\uFF0C\u4E0D\u8981\u4F7F\u7528 Markdown ```\u3002");
  promptParts.push("- \u5F53\u65E0\u9700 UI \u65F6\uFF0C\u53EA\u8F93\u51FA\u7EAF\u6587\u672C\u5373\u53EF\u3002");
  promptParts.push(`- \u7EC4\u4EF6\u7C7B\u578B\u4EC5\u4F7F\u7528\u5DF2\u6CE8\u518C\u7684\u7C7B\u578B\uFF08\u4F18\u5148 Shadcn \u7EC4\u4EF6\uFF09\uFF1A${SHADCN_COMPONENTS.join(", ")}\uFF0C\u4EE5\u53CA\u6280\u80FD\u7EC4\u4EF6\u5982 weather-card\u3002`);
  promptParts.push("- \u975E\u5FC5\u8981\u4E0D\u8981\u8F93\u51FA\u539F\u59CB HTML \u6807\u7B7E\uFF08div/span/p \u7B49\uFF09\uFF0C\u4F18\u5148\u4F7F\u7528 Shadcn \u7EC4\u4EF6\u3002");
  if (weatherProps) {
    promptParts.push("\n# \u5DF2\u83B7\u53D6\u7684\u5929\u6C14\u6570\u636E (props)");
    promptParts.push(JSON.stringify(weatherProps, null, 2));
  }
  if (weatherError) {
    promptParts.push("\n# \u5929\u6C14\u63A5\u53E3\u72B6\u6001");
    promptParts.push(`- \u83B7\u53D6\u5929\u6C14\u5931\u8D25\uFF1A${weatherError}`);
    promptParts.push("- \u4E0D\u8981\u7F16\u9020\u5B9E\u65F6\u5929\u6C14\u6570\u636E\uFF0C\u9700\u63D0\u793A\u7528\u6237\u7A0D\u540E\u91CD\u8BD5\u3002");
  }
  return promptParts.join("\n");
}
function extractCityId(message) {
  const explicit = message.match(/\b(\d{9})\b/);
  if (explicit) return explicit[1];
  return DEFAULT_CITY_ID;
}
async function fetchWeather(cityId, timeoutMs) {
  const url = `${WEATHER_API_BASE}?cityIds=${encodeURIComponent(cityId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`\u5929\u6C14\u63A5\u53E3\u8BF7\u6C42\u5931\u8D25 (${response.status})`);
    }
    const payload = await response.json();
    const entry = payload.value?.[0];
    if (!entry) {
      throw new Error("\u5929\u6C14\u63A5\u53E3\u8FD4\u56DE\u4E3A\u7A7A");
    }
    return {
      city: entry.city,
      provinceName: entry.provinceName,
      realtime: entry.realtime,
      pm25: entry.pm25,
      weathers: entry.weathers?.slice(0, 3),
      indexes: entry.indexes?.slice(0, 3),
      updatedAt: entry.realtime?.time ?? entry.pm25?.upDateTime,
      source: "\u9B45\u65CF\u5929\u6C14 API"
    };
  } finally {
    clearTimeout(timer);
  }
}
function shouldUseWeatherSkill(message) {
  return /天气|预报|weather/i.test(message);
}
async function requestChatCompletion(apiBase, apiKey, modelName, messages, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = apiBase.replace(/\/+$/, "");
    const url = `${base}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: 0.2,
        stream: false
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`\u6A21\u578B\u8BF7\u6C42\u5931\u8D25 (${response.status}) ${text}`);
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("\u6A21\u578B\u8FD4\u56DE\u4E3A\u7A7A");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}
async function requestChatCompletionStream(apiBase, apiKey, modelName, messages, timeoutMs, onDelta) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = apiBase.replace(/\/+$/, "");
    const url = `${base}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: 0.2,
        stream: true
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`\u6A21\u578B\u8BF7\u6C42\u5931\u8D25 (${response.status}) ${text}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      const content2 = payload.choices?.[0]?.message?.content ?? "";
      if (!content2) {
        throw new Error("\u6A21\u578B\u8FD4\u56DE\u4E3A\u7A7A");
      }
      onDelta?.(content2);
      return content2;
    }
    if (!response.body) {
      throw new Error("\u6A21\u578B\u6D41\u5F0F\u54CD\u5E94\u4E3A\u7A7A");
    }
    const decoder = new TextDecoder("utf-8");
    const reader = response.body.getReader();
    let buffer = "";
    let content = "";
    let shouldStop = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.replace(/^data:\s*/, "");
        if (payload === "[DONE]") {
          shouldStop = true;
          break;
        }
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
          if (delta) {
            content += delta;
            onDelta?.(delta);
          }
        } catch {
        }
      }
      if (shouldStop) {
        break;
      }
    }
    if (shouldStop) {
      try {
        await reader.cancel();
      } catch {
      }
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}
function buildWeatherFallbackResponse(props) {
  const rootKey = "weather-root";
  return [
    "\u5DF2\u4E3A\u4F60\u83B7\u53D6\u6700\u65B0\u5929\u6C14\u6570\u636E\uFF1A",
    JSON.stringify({ op: "add", path: "/root", value: rootKey }),
    JSON.stringify({
      op: "add",
      path: `/elements/${rootKey}`,
      value: {
        type: "weather-card",
        props
      }
    })
  ].join("\n");
}
function normalizeHistory(history) {
  if (!history) return [];
  return history.filter((item) => item.role === "user" || item.role === "assistant").map((item) => ({ role: item.role, content: item.content }));
}
function createChatModeParser(emitChunk, requestId) {
  let logBuffer = "";
  let logClosed = false;
  const parser = createMixedStreamParser({
    onText: (line) => {
      const payload = `${line}
`;
      emitChunk({
        requestId,
        kind: "text",
        value: payload
      });
    },
    onPatch: (patch) => {
      emitChunk({
        requestId,
        kind: "patch",
        value: `${JSON.stringify(patch)}
`
      });
    }
  });
  function emitLogChunk(delta) {
    if (logClosed) return;
    const combined = logBuffer + delta;
    const match = combined.search(/(^|\n)\\{\"op\"\\s*:/);
    if (match >= 0) {
      const safeText = combined.slice(0, match);
      if (safeText) {
        emitChunk({ requestId, kind: "log", value: safeText });
      }
      logClosed = true;
      logBuffer = "";
      return;
    }
    emitChunk({ requestId, kind: "log", value: delta });
    logBuffer = combined.slice(-24);
  }
  return {
    push: (chunk) => {
      emitLogChunk(chunk);
      parser.push(chunk);
    },
    flush: () => parser.flush()
  };
}
async function sendAgentChat(input, emitChunk) {
  const profile = await getAgentProfile({ agentId: input.agentId, homeDirOverride: input.homeDirOverride });
  const config = await ensureZeroClawConfig(input.homeDirOverride);
  const connection = config.providerConnections.find(
    (item) => item.providerId === profile.defaultLlm.providerId
  );
  const timeoutMs = config.defaults.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const shouldWeather = shouldUseWeatherSkill(input.message);
  let weatherProps;
  let weatherError;
  if (shouldWeather) {
    try {
      weatherProps = await fetchWeather(extractCityId(input.message), timeoutMs);
    } catch (error) {
      weatherError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!connection?.apiKeyPlaintext || !connection.apiBase) {
    if (weatherProps) {
      return {
        success: true,
        content: buildWeatherFallbackResponse(weatherProps),
        usedFallback: true,
        error: "\u7F3A\u5C11 API Key"
      };
    }
    return {
      success: false,
      content: "\u6A21\u578B\u672A\u914D\u7F6E API Key\uFF0C\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u5B8C\u6210\u8FDE\u63A5\u3002",
      error: "\u7F3A\u5C11 API Key"
    };
  }
  const skillDocs = await loadSkillDocs(profile, input.homeDirOverride);
  if (shouldWeather) {
    const appSkillsRoot = resolveAppSkillsRoot();
    const weatherDoc = await readSkillDocFromFolder(path6.join(appSkillsRoot, "weather-card"));
    if (weatherDoc) {
      skillDocs.push(weatherDoc);
    }
  }
  const systemPrompt = buildSystemPrompt(profile, skillDocs, weatherProps, weatherError);
  const messages = [
    { role: "system", content: systemPrompt },
    ...normalizeHistory(input.history),
    { role: "user", content: input.message }
  ];
  try {
    const requestId = input.requestId ?? `req_${Date.now()}`;
    const parser = input.stream && emitChunk ? createChatModeParser(emitChunk, requestId) : null;
    const onDelta = input.stream && emitChunk ? (delta) => parser?.push(delta) : void 0;
    const content = input.stream ? await requestChatCompletionStream(
      connection.apiBase,
      connection.apiKeyPlaintext,
      profile.defaultLlm.modelName,
      messages,
      timeoutMs,
      onDelta
    ) : await requestChatCompletion(
      connection.apiBase,
      connection.apiKeyPlaintext,
      profile.defaultLlm.modelName,
      messages,
      timeoutMs
    );
    if (input.stream && emitChunk) {
      parser?.flush();
      emitChunk({ requestId, kind: "done" });
    }
    return { success: true, content };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const isAbort = error instanceof Error && error.name === "AbortError" || /aborted/i.test(rawMessage);
    const errorMessage = isAbort ? `\u8BF7\u6C42\u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)}\u79D2\uFF09\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216\u6A21\u578B\u670D\u52A1\u54CD\u5E94\u901F\u5EA6\u3002` : rawMessage;
    if (input.stream && emitChunk) {
      emitChunk({
        requestId: input.requestId ?? `req_${Date.now()}`,
        kind: "error",
        value: errorMessage
      });
    }
    if (weatherProps) {
      return {
        success: true,
        content: buildWeatherFallbackResponse(weatherProps),
        usedFallback: true,
        error: errorMessage
      };
    }
    return {
      success: false,
      content: errorMessage,
      error: errorMessage
    };
  }
}

// src/main/agent-api.ts
var agentApi = {
  async save(input) {
    return saveAgentProfile(input);
  },
  async get(input) {
    return getAgentProfile(input);
  },
  async list(input) {
    return listAgentProfiles(input);
  },
  async start(input) {
    return startAgentRuntime(input);
  },
  async stop(input) {
    return stopAgentRuntime(input);
  },
  async status(agentId) {
    return getAgentRuntimeStatus(agentId);
  },
  async logTail(agentId, linesCount, homeDirOverride) {
    return getAgentLogTail(agentId, homeDirOverride, linesCount);
  },
  async chat(input, onChunk) {
    return sendAgentChat(input, onChunk);
  }
};

// src/main/register-agent-ipc.ts
function toFailure(error) {
  if (error instanceof Error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error.message
      }
    };
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "\u672A\u77E5\u9519\u8BEF\u3002"
    }
  };
}
function toSuccess(data) {
  return {
    ok: true,
    data
  };
}
function asSaveAgentInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("saveAgent \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asGetAgentInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("getAgent \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asListAgentsInput(payload) {
  if (payload === void 0) {
    return void 0;
  }
  if (typeof payload !== "object") {
    throw new Error("listAgents \u8BF7\u6C42\u53C2\u6570\u683C\u5F0F\u9519\u8BEF\u3002");
  }
  return payload;
}
function asStartAgentInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("startAgent \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asStopAgentInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("stopAgent \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentStatusInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentStatus \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentLogTailInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentLogTail \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentChatInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentChat \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function createAgentIpcHandlers() {
  return {
    async [AGENT_IPC_CHANNELS.saveAgent](payload) {
      try {
        const data = await agentApi.save(asSaveAgentInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.getAgent](payload) {
      try {
        const data = await agentApi.get(asGetAgentInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.listAgents](payload) {
      try {
        const data = await agentApi.list(asListAgentsInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.startAgent](payload) {
      try {
        const data = await agentApi.start(asStartAgentInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.stopAgent](payload) {
      try {
        const data = await agentApi.stop(asStopAgentInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentStatus](payload) {
      try {
        const { agentId } = asAgentStatusInput(payload);
        const data = await agentApi.status(agentId);
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentLogTail](payload) {
      try {
        const { agentId, linesCount, homeDirOverride } = asAgentLogTailInput(payload);
        const data = await agentApi.logTail(agentId, linesCount, homeDirOverride);
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentChat](payload) {
      try {
        const data = await agentApi.chat(asAgentChatInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    }
  };
}
function registerAgentIpcHandlers(ipcMainLike) {
  const handlers = createAgentIpcHandlers();
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.saveAgent,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.saveAgent](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.getAgent,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.getAgent](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.listAgents,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.listAgents](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.startAgent,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.startAgent](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.stopAgent,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.stopAgent](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentStatus,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentStatus](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentLogTail,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentLogTail](payload)
  );
  ipcMainLike.handle(AGENT_IPC_CHANNELS.agentChat, async (event, payload) => {
    try {
      const data = await agentApi.chat(asAgentChatInput(payload), (chunk) => {
        event.sender.send(AGENT_IPC_CHANNELS.agentChatStream, chunk);
      });
      return toSuccess(data);
    } catch (error) {
      return toFailure(error);
    }
  });
}

// src/main/provider-settings-service.ts
var HOT_PROVIDER_IDS = ["anthropic", "openai", "google-ai", "nvidia-nim", "deepseek"];
function slugify2(input) {
  const result = input.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
  return result.length > 0 ? result : "custom-provider";
}
function normalizeProviderId2(providerId) {
  if (providerId === "nvidia") {
    return "nvidia-nim";
  }
  return providerId;
}
function createConnectionId(providerId) {
  const random = Math.random().toString(36).slice(2, 8);
  return `conn_${providerId}_${Date.now()}_${random}`;
}
var PROVIDER_ICON_MAP2 = {
  openai: "OA",
  "azure-openai": "AO",
  anthropic: "AN",
  "google-ai": "GA",
  deepseek: "DS",
  qwen: "QW",
  moonshot: "MS",
  zhipu: "ZP",
  baichuan: "BC",
  minimax: "MM",
  "volcengine-ark": "VA",
  siliconflow: "SF",
  together: "TG",
  fireworks: "FW",
  groq: "GQ",
  cohere: "CH",
  mistral: "MS",
  xai: "XA",
  "nvidia-nim": "NV",
  openrouter: "OR",
  perplexity: "PX",
  ollama: "OL",
  lmstudio: "LM",
  vllm: "VL",
  "huggingface-inference": "HF",
  "aws-bedrock": "AB",
  "azure-ai-inference": "AI",
  "alibaba-bailian": "AL"
};
function buildProviderInitials2(providerId) {
  const normalized = providerId.trim().replace(/[^a-z0-9]+/gi, " ");
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AI";
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("").slice(0, 2);
}
function getProviderIcon2(providerId) {
  return PROVIDER_ICON_MAP2[providerId] ?? buildProviderInitials2(providerId);
}
function maskApiKey(apiKey) {
  if (!apiKey) {
    return void 0;
  }
  if (apiKey.length <= 8) {
    return "****";
  }
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
}
function inferModelCapabilities(modelName) {
  const lower = modelName.toLowerCase();
  const hasImageInputKeywords = lower.includes("vision") || lower.includes("vl") || lower.includes("gpt-4o") || lower.includes("gemini") || lower.includes("claude") || lower.includes("grok-3") || lower.includes("phi-4");
  const hasToolCallKeywords = lower.includes("gpt") || lower.includes("claude") || lower.includes("gemini") || lower.includes("qwen");
  return {
    text: true,
    imageInput: hasImageInputKeywords,
    imageOutput: false,
    audioInput: false,
    toolCall: hasToolCallKeywords
  };
}
function buildModelId(providerId, modelName) {
  return `${providerId}:${modelName}`;
}
function resolveEnabledSet(catalog, providerId, defaultEnabled) {
  const providerModels = catalog.filter((item) => item.providerId === providerId);
  if (providerModels.length === 0) return void 0;
  const enabledModels = providerModels.filter((item) => item.enabled);
  if (!defaultEnabled && enabledModels.length === providerModels.length) {
    return /* @__PURE__ */ new Set();
  }
  return new Set(enabledModels.map((item) => item.modelId));
}
function buildModelCatalogForProvider(providerId, modelNames, enabledSet, defaultEnabled) {
  return modelNames.map((modelName) => {
    const modelId = buildModelId(providerId, modelName);
    const enabled = enabledSet ? enabledSet.has(modelId) : defaultEnabled;
    return {
      modelId,
      providerId,
      modelName,
      displayName: modelName,
      capabilities: inferModelCapabilities(modelName),
      enabled
    };
  });
}
function toModelsEndpoint(apiBase) {
  const normalized = apiBase.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return `${normalized}/models`;
  }
  return `${normalized}/v1/models`;
}
function buildAuthHeaderCandidates(providerId, apiKey) {
  const candidates = [
    { Authorization: `Bearer ${apiKey}` }
  ];
  if (providerId === "nvidia-nim") {
    candidates.push({ "api-key": apiKey });
    candidates.push({ "NVIDIA-API-Key": apiKey });
    candidates.push({ "X-API-Key": apiKey });
  }
  return candidates;
}
async function discoverModelsFromRemote(providerId, apiBase, apiKey) {
  const endpoint = toModelsEndpoint(apiBase);
  const authCandidates = buildAuthHeaderCandidates(providerId, apiKey);
  let lastStatus = 0;
  let lastError = null;
  for (const headers of authCandidates) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          ...headers,
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        lastStatus = response.status;
        continue;
      }
      const payload = await response.json();
      const modelNames = (payload.data ?? []).map((item) => item.id).filter((item) => typeof item === "string" && item.trim().length > 0);
      if (modelNames.length === 0) {
        throw new Error("\u8FDC\u7A0B\u6A21\u578B\u53D1\u73B0\u5931\u8D25\uFF1A\u672A\u8FD4\u56DE\u4EFB\u4F55\u6A21\u578B\u3002");
      }
      return modelNames;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("\u8FDC\u7A0B\u6A21\u578B\u53D1\u73B0\u5931\u8D25");
    }
  }
  if (lastStatus > 0) {
    throw new Error(`\u8FDC\u7A0B\u6A21\u578B\u53D1\u73B0\u5931\u8D25\uFF1AHTTP ${lastStatus}`);
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error("\u8FDC\u7A0B\u6A21\u578B\u53D1\u73B0\u5931\u8D25\uFF1A\u8BF7\u6C42\u672A\u5B8C\u6210\u3002");
}
function mergeProviderConfigs(providers, nextProvider) {
  const existed = providers.some((item) => item.id === nextProvider.id);
  if (existed) {
    return providers.map((item) => item.id === nextProvider.id ? nextProvider : item);
  }
  return [...providers, nextProvider];
}
function replaceModelCatalogForProvider(current, providerId, incoming) {
  const others = current.filter((item) => item.providerId !== providerId);
  return [...others, ...incoming];
}
function toConnectedProviderItems(connections, modelCatalog) {
  return connections.map((connection) => {
    const modelCount = modelCatalog.filter((item) => item.providerId === connection.providerId).length;
    return {
      connectionId: connection.connectionId,
      providerId: connection.providerId,
      displayName: connection.displayName,
      icon: connection.icon,
      badge: connection.badge,
      canDisconnect: connection.canDisconnect,
      connectedAt: connection.connectedAt,
      modelCount,
      health: connection.health,
      apiBase: connection.apiBase,
      hasApiKey: typeof connection.apiKeyPlaintext === "string" && connection.apiKeyPlaintext.length > 0
    };
  });
}
function buildHotProviderItems(connectedProviderIds) {
  const catalog = getModelProviderCatalog();
  return HOT_PROVIDER_IDS.map((providerId) => {
    const provider = catalog.find((item) => item.id === providerId);
    if (!provider) {
      throw new Error(`\u70ED\u95E8\u63D0\u4F9B\u5546\u7F3A\u5931\uFF1A${providerId}`);
    }
    const alreadyConnected = connectedProviderIds.has(providerId);
    return {
      providerId: provider.id,
      displayName: provider.displayName,
      icon: getProviderIcon2(provider.id),
      subtitle: alreadyConnected ? `${provider.displayName} \u5DF2\u8FDE\u63A5\uFF0C\u53EF\u5728\u4E0A\u65B9\u7BA1\u7406` : `\u4F7F\u7528 ${provider.displayName} API \u5BC6\u94A5\u8FDE\u63A5`,
      recommended: provider.id === "anthropic" || provider.id === "openai" || provider.id === "nvidia-nim",
      connectType: "api_key"
    };
  });
}
function upsertConnection(currentConnections, nextConnection) {
  const existed = currentConnections.some((connection) => connection.providerId === nextConnection.providerId);
  if (existed) {
    return currentConnections.map(
      (connection) => connection.providerId === nextConnection.providerId ? nextConnection : connection
    );
  }
  return [...currentConnections, nextConnection];
}
async function getProviderSettings(homeDirOverride) {
  const config = await ensureZeroClawConfig(homeDirOverride);
  const connectedProviders = toConnectedProviderItems(config.providerConnections, config.modelCatalog);
  const connectedProviderIds = new Set(connectedProviders.map((item) => item.providerId));
  return {
    connectedProviders,
    hotProviders: buildHotProviderItems(connectedProviderIds)
  };
}
async function connectProvider(input) {
  const normalizedProviderId = normalizeProviderId2(input.providerId);
  const provider = findModelProvider(normalizedProviderId);
  if (!provider) {
    throw new Error(`\u65E0\u6CD5\u8FDE\u63A5\u672A\u77E5\u63D0\u4F9B\u5546\uFF1A${input.providerId}`);
  }
  const apiBase = (input.apiBase ?? provider.apiBase).trim();
  const autoDiscoverModels = input.autoDiscoverModels ?? true;
  let modelNames = provider.defaultModels;
  let modelSource = "catalog";
  let health = "ok";
  if (autoDiscoverModels && input.connectType === "api_key" && typeof input.apiKey === "string") {
    try {
      const discovered = await discoverModelsFromRemote(provider.id, apiBase, input.apiKey);
      modelNames = discovered;
      modelSource = "live";
    } catch {
      health = "warning";
    }
  }
  const providerConfig = {
    id: provider.id,
    displayName: provider.displayName,
    apiBase,
    apiKeyEnv: provider.apiKeyEnv,
    models: modelNames,
    enabled: true
  };
  const connection = {
    connectionId: createConnectionId(provider.id),
    providerId: provider.id,
    displayName: input.alias ?? provider.displayName,
    icon: getProviderIcon2(provider.id),
    badge: input.connectType === "api_key" ? "api_key" : "config",
    connectType: input.connectType,
    canDisconnect: true,
    connectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    health,
    apiBase,
    apiKeyMasked: maskApiKey(input.apiKey),
    apiKeyPlaintext: input.apiKey,
    modelDiscovery: {
      mode: autoDiscoverModels ? "remote" : "default",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: modelSource
    }
  };
  await updateZeroClawConfigFile(
    (current) => {
      const enabledSet = resolveEnabledSet(current.modelCatalog, provider.id, modelSource === "catalog");
      const providerModels = buildModelCatalogForProvider(
        provider.id,
        modelNames,
        enabledSet,
        modelSource === "catalog"
      );
      const modelProviders = mergeProviderConfigs(current.modelProviders, providerConfig);
      const modelCatalog = replaceModelCatalogForProvider(current.modelCatalog, provider.id, providerModels);
      const providerConnections = upsertConnection(current.providerConnections, connection);
      const defaultModelId = current.defaults.defaultModelId && modelCatalog.some((item) => item.modelId === current.defaults.defaultModelId) ? current.defaults.defaultModelId : providerModels[0]?.modelId;
      return {
        ...current,
        defaults: {
          ...current.defaults,
          primaryProviderId: provider.id,
          defaultModelId
        },
        modelProviders,
        modelCatalog,
        providerConnections
      };
    },
    input.homeDirOverride
  );
  return connection;
}
async function connectCustomProvider(input) {
  const providerId = `custom-${slugify2(input.displayName)}`;
  const displayName = input.alias ?? input.displayName;
  const apiKeyEnv = `CUSTOM_${slugify2(input.displayName).toUpperCase().replace(/-/g, "_")}_API_KEY`;
  const autoDiscoverModels = input.autoDiscoverModels ?? true;
  let modelNames = input.models.length > 0 ? input.models : ["custom-model"];
  let modelSource = "catalog";
  let health = "ok";
  if (autoDiscoverModels && typeof input.apiKey === "string") {
    try {
      const discovered = await discoverModelsFromRemote(providerId, input.apiBase, input.apiKey);
      modelNames = discovered;
      modelSource = "live";
    } catch {
      health = "warning";
    }
  }
  const providerConfig = {
    id: providerId,
    displayName,
    apiBase: input.apiBase,
    apiKeyEnv,
    models: modelNames,
    enabled: true
  };
  const connection = {
    connectionId: createConnectionId(providerId),
    providerId,
    displayName,
    icon: getProviderIcon2(providerId),
    badge: "custom",
    connectType: "config",
    canDisconnect: true,
    connectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    health,
    apiBase: input.apiBase,
    apiKeyMasked: maskApiKey(input.apiKey),
    apiKeyPlaintext: input.apiKey,
    modelDiscovery: {
      mode: autoDiscoverModels ? "remote" : "default",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: modelSource
    }
  };
  await updateZeroClawConfigFile(
    (current) => {
      const enabledSet = resolveEnabledSet(current.modelCatalog, providerId, modelSource === "catalog");
      const providerModels = buildModelCatalogForProvider(
        providerId,
        modelNames,
        enabledSet,
        modelSource === "catalog"
      );
      const modelProviders = mergeProviderConfigs(current.modelProviders, providerConfig);
      const modelCatalog = replaceModelCatalogForProvider(current.modelCatalog, providerId, providerModels);
      const providerConnections = upsertConnection(current.providerConnections, connection);
      const defaultModelId = current.defaults.defaultModelId && modelCatalog.some((item) => item.modelId === current.defaults.defaultModelId) ? current.defaults.defaultModelId : providerModels[0]?.modelId;
      return {
        ...current,
        defaults: {
          ...current.defaults,
          primaryProviderId: providerId,
          defaultModelId
        },
        modelProviders,
        modelCatalog,
        providerConnections
      };
    },
    input.homeDirOverride
  );
  return connection;
}
async function disconnectProvider(input) {
  await updateZeroClawConfigFile(
    (current) => {
      const targetConnection = current.providerConnections.find(
        (connection) => connection.connectionId === input.connectionId
      );
      if (!targetConnection) {
        throw new Error(`\u8FDE\u63A5\u4E0D\u5B58\u5728\uFF1A${input.connectionId}`);
      }
      const providerConnections = current.providerConnections.filter(
        (connection) => connection.connectionId !== input.connectionId
      );
      const hasSameProviderConnection = providerConnections.some(
        (connection) => connection.providerId === targetConnection.providerId
      );
      const modelProviders = current.modelProviders.map(
        (provider) => provider.id === targetConnection.providerId ? {
          ...provider,
          enabled: hasSameProviderConnection
        } : provider
      ).filter((provider) => provider.enabled);
      const modelCatalog = current.modelCatalog.filter(
        (model) => model.providerId !== targetConnection.providerId
      );
      const nextPrimaryProviderId = current.defaults.primaryProviderId === targetConnection.providerId ? providerConnections[0]?.providerId : current.defaults.primaryProviderId;
      const nextDefaultModelId = typeof current.defaults.defaultModelId === "string" && modelCatalog.some((item) => item.modelId === current.defaults.defaultModelId) ? current.defaults.defaultModelId : modelCatalog.find((item) => item.providerId === nextPrimaryProviderId)?.modelId;
      return {
        ...current,
        defaults: {
          ...current.defaults,
          primaryProviderId: nextPrimaryProviderId,
          defaultModelId: nextDefaultModelId
        },
        providerConnections,
        modelProviders,
        modelCatalog
      };
    },
    input.homeDirOverride
  );
}
async function getModelSettings(homeDirOverride) {
  const config = await ensureZeroClawConfig(homeDirOverride);
  const connectedProviderIds = new Set(config.providerConnections.map((item) => item.providerId));
  return {
    providers: config.providerConnections.map((item) => ({
      connectionId: item.connectionId,
      providerId: item.providerId,
      displayName: item.displayName,
      enabled: true
    })),
    models: config.modelCatalog.filter((item) => connectedProviderIds.has(item.providerId)).map((item) => ({
      modelId: item.modelId,
      providerId: item.providerId,
      displayName: item.displayName,
      supportsImageInput: item.capabilities.imageInput,
      supportsToolCall: item.capabilities.toolCall,
      enabled: item.enabled,
      isDefault: config.defaults.defaultModelId === item.modelId
    }))
  };
}
async function setDefaultModel(input) {
  const config = await ensureZeroClawConfig(input.homeDirOverride);
  const selectedModel = config.modelCatalog.find((item) => item.modelId === input.modelId);
  if (!selectedModel) {
    throw new Error(`\u6A21\u578B\u4E0D\u5B58\u5728\uFF1A${input.modelId}`);
  }
  const hasProviderConnection = config.providerConnections.some(
    (item) => item.providerId === selectedModel.providerId
  );
  if (!hasProviderConnection) {
    throw new Error("\u8BE5\u6A21\u578B\u6240\u5C5E\u63D0\u4F9B\u5546\u5C1A\u672A\u8FDE\u63A5\u3002");
  }
  await writeZeroClawConfigFile(
    {
      ...config,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      defaults: {
        ...config.defaults,
        primaryProviderId: selectedModel.providerId,
        defaultModelId: selectedModel.modelId
      }
    },
    input.homeDirOverride
  );
}
async function toggleProviderEnabled(input) {
  const providerId = normalizeProviderId2(input.providerId);
  await updateZeroClawConfigFile(
    (current) => {
      const targetProvider = current.modelProviders.find((item) => item.id === providerId);
      if (!targetProvider) {
        throw new Error(`\u63D0\u4F9B\u5546\u4E0D\u5B58\u5728\uFF1A${input.providerId}`);
      }
      const modelProviders = current.modelProviders.map(
        (item) => item.id === providerId ? {
          ...item,
          enabled: input.enabled
        } : item
      );
      const modelCatalog = current.modelCatalog.map(
        (item) => item.providerId === providerId ? {
          ...item,
          enabled: input.enabled
        } : item
      );
      const providerConnections = current.providerConnections.map(
        (item) => item.providerId === providerId ? {
          ...item,
          health: input.enabled ? item.health === "error" ? "warning" : item.health : "warning"
        } : item
      );
      const nextPrimaryProviderId = current.defaults.primaryProviderId === providerId && !input.enabled ? modelProviders.find((item) => item.enabled)?.id : current.defaults.primaryProviderId;
      const nextDefaultModelId = typeof current.defaults.defaultModelId === "string" && modelCatalog.some((item) => item.modelId === current.defaults.defaultModelId && item.enabled) ? current.defaults.defaultModelId : modelCatalog.find((item) => item.providerId === nextPrimaryProviderId && item.enabled)?.modelId;
      return {
        ...current,
        defaults: {
          ...current.defaults,
          primaryProviderId: nextPrimaryProviderId,
          defaultModelId: nextDefaultModelId
        },
        providerConnections,
        modelProviders,
        modelCatalog
      };
    },
    input.homeDirOverride
  );
}
async function toggleModelEnabled(input) {
  await updateZeroClawConfigFile(
    (current) => {
      const targetModel = current.modelCatalog.find((item) => item.modelId === input.modelId);
      if (!targetModel) {
        throw new Error(`\u6A21\u578B\u4E0D\u5B58\u5728\uFF1A${input.modelId}`);
      }
      const modelCatalog = current.modelCatalog.map(
        (item) => item.modelId === input.modelId ? {
          ...item,
          enabled: input.enabled
        } : item
      );
      const nextDefaultModelId = current.defaults.defaultModelId === input.modelId && !input.enabled ? modelCatalog.find(
        (item) => item.providerId === targetModel.providerId && item.enabled
      )?.modelId : current.defaults.defaultModelId;
      return {
        ...current,
        defaults: {
          ...current.defaults,
          defaultModelId: nextDefaultModelId
        },
        modelCatalog
      };
    },
    input.homeDirOverride
  );
}
async function refreshProviderModels(input) {
  const providerId = normalizeProviderId2(input.providerId);
  const config = await ensureZeroClawConfig(input.homeDirOverride);
  const provider = config.modelProviders.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`\u63D0\u4F9B\u5546\u4E0D\u5B58\u5728\uFF1A${input.providerId}`);
  }
  const connection = config.providerConnections.find((item) => item.providerId === providerId);
  let source = "catalog";
  let modelNames = provider.models;
  if (connection?.apiKeyPlaintext) {
    try {
      modelNames = await discoverModelsFromRemote(providerId, provider.apiBase, connection.apiKeyPlaintext);
      source = "live";
    } catch {
      source = "catalog";
    }
  }
  const refreshedProvider = {
    ...provider,
    models: modelNames,
    enabled: true
  };
  await updateZeroClawConfigFile(
    (current) => {
      const enabledSet = resolveEnabledSet(current.modelCatalog, providerId, false);
      const refreshedCatalog = buildModelCatalogForProvider(providerId, modelNames, enabledSet, false);
      const modelProviders = mergeProviderConfigs(current.modelProviders, refreshedProvider);
      const modelCatalog = replaceModelCatalogForProvider(current.modelCatalog, providerId, refreshedCatalog);
      const providerConnections = current.providerConnections.map(
        (item) => item.providerId === providerId ? {
          ...item,
          health: source === "live" ? "ok" : item.health,
          modelDiscovery: {
            mode: item.modelDiscovery.mode,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            source
          }
        } : item
      );
      const nextDefaultModelId = typeof current.defaults.defaultModelId === "string" && modelCatalog.some((item) => item.modelId === current.defaults.defaultModelId) ? current.defaults.defaultModelId : refreshedCatalog[0]?.modelId;
      return {
        ...current,
        defaults: {
          ...current.defaults,
          defaultModelId: nextDefaultModelId
        },
        modelProviders,
        modelCatalog,
        providerConnections
      };
    },
    input.homeDirOverride
  );
  return {
    providerId,
    modelCount: modelNames.length,
    source
  };
}
async function updateProviderConnection(input) {
  const config = await ensureZeroClawConfig(input.homeDirOverride);
  const targetConnection = config.providerConnections.find(
    (connection) => connection.connectionId === input.connectionId
  );
  if (!targetConnection) {
    throw new Error(`\u8FDE\u63A5\u4E0D\u5B58\u5728\uFF1A${input.connectionId}`);
  }
  const providerId = targetConnection.providerId;
  const provider = config.modelProviders.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`\u63D0\u4F9B\u5546\u4E0D\u5B58\u5728\uFF1A${providerId}`);
  }
  const apiBase = (input.apiBase ?? targetConnection.apiBase).trim();
  const apiKeyPlaintext = input.apiKey ?? targetConnection.apiKeyPlaintext;
  const displayName = input.alias ?? targetConnection.displayName;
  const autoDiscoverModels = input.autoDiscoverModels ?? false;
  let modelNames = provider.models;
  let modelSource = targetConnection.modelDiscovery.source;
  let health = targetConnection.health;
  let updatedModelCatalog = config.modelCatalog;
  if (autoDiscoverModels && apiKeyPlaintext) {
    try {
      modelNames = await discoverModelsFromRemote(providerId, apiBase, apiKeyPlaintext);
      modelSource = "live";
      health = "ok";
      const enabledSet = resolveEnabledSet(config.modelCatalog, providerId, false);
      updatedModelCatalog = replaceModelCatalogForProvider(
        config.modelCatalog,
        providerId,
        buildModelCatalogForProvider(providerId, modelNames, enabledSet, false)
      );
    } catch {
      modelSource = "catalog";
      health = "warning";
    }
  }
  const updatedProvider = {
    ...provider,
    apiBase,
    models: modelNames,
    enabled: true
  };
  const updatedConnection = {
    ...targetConnection,
    displayName,
    apiBase,
    apiKeyPlaintext,
    apiKeyMasked: maskApiKey(apiKeyPlaintext),
    health,
    modelDiscovery: {
      mode: autoDiscoverModels ? "remote" : targetConnection.modelDiscovery.mode,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: modelSource
    }
  };
  const modelProviders = mergeProviderConfigs(config.modelProviders, updatedProvider);
  const providerConnections = config.providerConnections.map(
    (connection) => connection.connectionId === input.connectionId ? updatedConnection : connection
  );
  const nextDefaultModelId = typeof config.defaults.defaultModelId === "string" && updatedModelCatalog.some((item) => item.modelId === config.defaults.defaultModelId) ? config.defaults.defaultModelId : updatedModelCatalog.find((item) => item.providerId === providerId)?.modelId;
  await writeZeroClawConfigFile(
    {
      ...config,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      defaults: {
        ...config.defaults,
        defaultModelId: nextDefaultModelId
      },
      modelProviders,
      modelCatalog: updatedModelCatalog,
      providerConnections
    },
    input.homeDirOverride
  );
  return updatedConnection;
}

// src/main/system-settings-service.ts
import { createRequire as createRequire3 } from "node:module";
var require4 = createRequire3(import.meta.url);
var { app: app3 } = require4("electron");
function getAutoLaunchSetting() {
  try {
    return app3.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}
function setAutoLaunchSetting(enabled) {
  try {
    app3.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    });
    return app3.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

// src/main/settings-api.ts
var settingsApi = {
  async getProviders(homeDirOverride) {
    return getProviderSettings(homeDirOverride);
  },
  async connectProvider(input) {
    return connectProvider(input);
  },
  async connectCustomProvider(input) {
    return connectCustomProvider(input);
  },
  async disconnectProvider(input) {
    await disconnectProvider(input);
    return { ok: true };
  },
  async getModels(homeDirOverride) {
    return getModelSettings(homeDirOverride);
  },
  async setDefaultModel(input) {
    await setDefaultModel(input);
    return { ok: true };
  },
  async toggleProviderEnabled(input) {
    await toggleProviderEnabled(input);
    return { ok: true };
  },
  async toggleModelEnabled(input) {
    await toggleModelEnabled(input);
    return { ok: true };
  },
  async refreshProviderModels(input) {
    return refreshProviderModels(input);
  },
  async updateProviderConnection(input) {
    return updateProviderConnection(input);
  },
  async getAppSettings() {
    return {
      autoLaunch: getAutoLaunchSetting()
    };
  },
  async setAutoLaunch(input) {
    const enabled = setAutoLaunchSetting(input.enabled);
    return { autoLaunch: enabled };
  }
};

// src/main/register-settings-ipc.ts
function toFailure2(error) {
  if (error instanceof Error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error.message
      }
    };
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "\u672A\u77E5\u9519\u8BEF\u3002"
    }
  };
}
function toSuccess2(data) {
  return {
    ok: true,
    data
  };
}
function asConnectProviderInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("connectProvider \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asConnectCustomProviderInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("connectCustomProvider \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asDisconnectProviderInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("disconnectProvider \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asSetDefaultModelInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("setDefaultModel \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asToggleProviderEnabledInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("toggleProviderEnabled \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asToggleModelEnabledInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("toggleModelEnabled \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asRefreshProviderModelsInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("refreshProviderModels \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asUpdateProviderConnectionInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("updateProviderConnection \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asSetAutoLaunchInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("setAutoLaunch \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function createSettingsIpcHandlers() {
  return {
    async [SETTINGS_IPC_CHANNELS.getProviderSettings]() {
      try {
        const data = await settingsApi.getProviders();
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.connectProvider](payload) {
      try {
        const input = asConnectProviderInput(payload);
        const data = await settingsApi.connectProvider(input);
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.connectCustomProvider](payload) {
      try {
        const input = asConnectCustomProviderInput(payload);
        const data = await settingsApi.connectCustomProvider(input);
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.disconnectProvider](payload) {
      try {
        const input = asDisconnectProviderInput(payload);
        const data = await settingsApi.disconnectProvider(input);
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.getModelSettings]() {
      try {
        const data = await settingsApi.getModels();
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.setDefaultModel](payload) {
      try {
        const input = asSetDefaultModelInput(payload);
        const data = await settingsApi.setDefaultModel(input);
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.toggleProviderEnabled](payload) {
      try {
        const input = asToggleProviderEnabledInput(payload);
        const data = await settingsApi.toggleProviderEnabled(input);
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.toggleModelEnabled](payload) {
      try {
        const input = asToggleModelEnabledInput(payload);
        const data = await settingsApi.toggleModelEnabled(input);
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.refreshProviderModels](payload) {
      try {
        const input = asRefreshProviderModelsInput(payload);
        const data = await settingsApi.refreshProviderModels(input);
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.updateProviderConnection](payload) {
      try {
        const input = asUpdateProviderConnectionInput(payload);
        const data = await settingsApi.updateProviderConnection(input);
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.getAppSettings]() {
      try {
        const data = await settingsApi.getAppSettings();
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    },
    async [SETTINGS_IPC_CHANNELS.setAutoLaunch](payload) {
      try {
        const input = asSetAutoLaunchInput(payload);
        const data = await settingsApi.setAutoLaunch(input);
        return toSuccess2(data);
      } catch (error) {
        return toFailure2(error);
      }
    }
  };
}
function registerSettingsIpcHandlers(ipcMainLike) {
  const handlers = createSettingsIpcHandlers();
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.getProviderSettings,
    async () => handlers[SETTINGS_IPC_CHANNELS.getProviderSettings]()
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.connectProvider,
    async (_event, payload) => handlers[SETTINGS_IPC_CHANNELS.connectProvider](payload)
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.connectCustomProvider,
    async (_event, payload) => handlers[SETTINGS_IPC_CHANNELS.connectCustomProvider](payload)
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.disconnectProvider,
    async (_event, payload) => handlers[SETTINGS_IPC_CHANNELS.disconnectProvider](payload)
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.getModelSettings,
    async () => handlers[SETTINGS_IPC_CHANNELS.getModelSettings]()
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.setDefaultModel,
    async (_event, payload) => handlers[SETTINGS_IPC_CHANNELS.setDefaultModel](payload)
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.toggleProviderEnabled,
    async (_event, payload) => handlers[SETTINGS_IPC_CHANNELS.toggleProviderEnabled](payload)
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.toggleModelEnabled,
    async (_event, payload) => handlers[SETTINGS_IPC_CHANNELS.toggleModelEnabled](payload)
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.refreshProviderModels,
    async (_event, payload) => handlers[SETTINGS_IPC_CHANNELS.refreshProviderModels](payload)
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.updateProviderConnection,
    async (_event, payload) => handlers[SETTINGS_IPC_CHANNELS.updateProviderConnection](payload)
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.getAppSettings,
    async () => handlers[SETTINGS_IPC_CHANNELS.getAppSettings]()
  );
  ipcMainLike.handle(
    SETTINGS_IPC_CHANNELS.setAutoLaunch,
    async (_event, payload) => handlers[SETTINGS_IPC_CHANNELS.setAutoLaunch](payload)
  );
}

// src/main/register-skills-mcp-ipc.ts
import { createRequire as createRequire5 } from "node:module";

// src/main/skills-mcp-service.ts
import path7 from "node:path";
import { cp, readFile as readFile5, readdir as readdir3, rm, stat as stat2, mkdir as mkdir6, writeFile as writeFile5 } from "node:fs/promises";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { createRequire as createRequire4 } from "node:module";
var require5 = createRequire4(import.meta.url);
var { app: app4 } = require5("electron");
var SKILL_FILE_CANDIDATES3 = ["SKILLS.md", "SKILL.md", "skills.md", "skill.md"];
function parseFrontmatter2(content) {
  const match = content.match(/^---\s*([\s\S]*?)\s*---/);
  if (!match) return null;
  const lines = match[1].split("\n");
  const metadata = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = trimmed.match(/^(\w+):\s*(.+)$/);
    if (!entry) continue;
    const [, key, value] = entry;
    if (key === "name") metadata.name = value;
    if (key === "description") metadata.description = value;
    if (key === "location") metadata.location = value;
  }
  return metadata;
}
function parseSkillFileContent(content, fallbackName, fallbackLocation) {
  const frontmatter = parseFrontmatter2(content);
  if (frontmatter?.name && frontmatter?.description) {
    return {
      name: frontmatter.name,
      description: frontmatter.description,
      location: frontmatter.location ?? fallbackLocation
    };
  }
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const titleLine = lines.find((line) => line.startsWith("#")) ?? lines[0];
  const name = titleLine ? titleLine.replace(/^#+\s*/, "") : fallbackName;
  const description = lines.find((line) => line !== titleLine) ?? "\u672A\u586B\u5199\u63CF\u8FF0";
  return {
    name: name || fallbackName,
    description,
    location: fallbackLocation
  };
}
async function resolveSkillMetadata(folderPath, folderName, fallbackLocation) {
  for (const candidate of SKILL_FILE_CANDIDATES3) {
    const filePath = path7.join(folderPath, candidate);
    try {
      const content = await readFile5(filePath, "utf-8");
      return parseSkillFileContent(content, folderName, fallbackLocation);
    } catch {
    }
  }
  return null;
}
async function ensureDirectory3(dirPath) {
  await mkdir6(dirPath, { recursive: true });
}
async function pathExists(targetPath) {
  try {
    await stat2(targetPath);
    return true;
  } catch {
    return false;
  }
}
async function getAppSkillsRoot() {
  let appRoot;
  if (!app4.isPackaged) {
    const __filename2 = fileURLToPath2(import.meta.url);
    const __dirname2 = path7.dirname(__filename2);
    appRoot = path7.resolve(__dirname2, "..", "..");
    console.log(`[SkillsService] Dev Mode: Resolved project root from ${__dirname2} to ${appRoot}`);
  } else {
    appRoot = app4.getAppPath();
  }
  const skillsRoot = path7.join(appRoot, "skills");
  console.log(`[SkillsService] Final Skills Root: ${skillsRoot}`);
  if (await pathExists(skillsRoot)) {
    return skillsRoot;
  }
  if (!app4.isPackaged) {
    console.log(`[SkillsService] Creating missing skills directory at ${skillsRoot}`);
    await ensureDirectory3(skillsRoot);
    return skillsRoot;
  }
  return null;
}
async function getSharedSkillsRoot() {
  const shared = await ensureSharedWorkspace();
  await ensureDirectory3(shared.sharedSkillsRoot);
  return shared.sharedSkillsRoot;
}
async function getSharedMcpRoot() {
  const shared = await ensureSharedWorkspace();
  await ensureDirectory3(shared.sharedMcpRoot);
  return shared.sharedMcpRoot;
}
async function isDirectory(targetPath) {
  try {
    const info = await stat2(targetPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}
function createSkillId(source, folderName) {
  return `${source}:${folderName} `;
}
function parseSkillId(skillId) {
  const [prefix, rest] = skillId.split(":");
  if ((prefix === "app" || prefix === "shared") && rest) {
    return { source: prefix, folderName: rest };
  }
  return { source: "shared", folderName: skillId };
}
function buildFallbackLocation(folderName) {
  return path7.join("skills", folderName);
}
async function readSkillsFromRoot(skillsRoot, source) {
  const entries = await readdir3(skillsRoot, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderName = entry.name;
    const folderPath = path7.join(skillsRoot, folderName);
    const metadata = await resolveSkillMetadata(folderPath, folderName, buildFallbackLocation(folderName));
    if (!metadata) continue;
    skills.push({
      id: createSkillId(source, folderName),
      metadata,
      path: folderPath,
      isSystem: source === "app" ? app4.isPackaged : false,
      isNew: false
    });
  }
  return skills;
}
async function resolvePrimarySkillsRoot() {
  const appRoot = await getAppSkillsRoot();
  if (!app4.isPackaged && appRoot) {
    return { root: appRoot, source: "app" };
  }
  const sharedRoot = await getSharedSkillsRoot();
  return { root: sharedRoot, source: "shared" };
}
async function safeReadSkillsFromRoot(skillsRoot, source) {
  if (!skillsRoot) return [];
  try {
    return await readSkillsFromRoot(skillsRoot, source);
  } catch {
    return [];
  }
}
async function resolveUniqueFolderName(baseName, root) {
  let candidate = baseName;
  let index = 1;
  while (await isDirectory(path7.join(root, candidate))) {
    candidate = `${baseName} -${index} `;
    index += 1;
  }
  return candidate;
}
function slugifyId(input) {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "mcp-server";
}
function ensureUniqueId(baseId, existing) {
  let candidate = baseId;
  let index = 1;
  while (existing.has(candidate)) {
    candidate = `${baseId} -${index} `;
    index += 1;
  }
  return candidate;
}
function normalizeMcpType(type) {
  if (type === "sse" || type === "streamableHttp" || type === "stdio") {
    return type;
  }
  return "stdio";
}
function toSafeRecord(input) {
  if (!input) return void 0;
  const entries = Object.entries(input).filter(
    ([key, value]) => key.trim().length > 0 && value.trim().length > 0
  );
  if (entries.length === 0) return void 0;
  return Object.fromEntries(entries);
}
function normalizeMcpInput(input) {
  const name = input.name.trim();
  return {
    name: name.length > 0 ? name : "MCP Server",
    description: input.description?.trim() || void 0,
    type: normalizeMcpType(input.type),
    enabled: input.enabled ?? true,
    path: input.path?.trim() || void 0,
    command: input.command?.trim() || void 0,
    args: input.args?.filter((item) => item.trim().length > 0),
    env: toSafeRecord(input.env),
    url: input.url?.trim() || void 0,
    headers: toSafeRecord(input.headers),
    longRunning: input.longRunning,
    timeout: typeof input.timeout === "number" && Number.isFinite(input.timeout) ? input.timeout : void 0
  };
}
async function resolveMcpStoragePath() {
  const mcpRoot = await getSharedMcpRoot();
  return path7.join(mcpRoot, "servers.json");
}
async function readMcpServers() {
  const storagePath = await resolveMcpStoragePath();
  try {
    const raw = await readFile5(storagePath, "utf-8");
    const payload = JSON.parse(raw);
    if (Array.isArray(payload)) {
      return payload.filter((item) => typeof item === "object" && item !== null);
    }
    return [];
  } catch {
    return [];
  }
}
async function writeMcpServers(servers) {
  const storagePath = await resolveMcpStoragePath();
  await writeFile5(storagePath, JSON.stringify(servers, null, 2), "utf-8");
}
function parseMcpImportPayload(input) {
  const raw = input.json.trim();
  if (!raw) return [];
  const payload = JSON.parse(raw);
  if (Array.isArray(payload)) {
    return payload.filter((item) => typeof item === "object" && item !== null);
  }
  if (payload && typeof payload === "object") {
    const record = payload;
    const maybeArray = record.servers ?? record.mcpServers ?? record.items;
    if (Array.isArray(maybeArray)) {
      return maybeArray.filter((item) => typeof item === "object" && item !== null);
    }
    return [record];
  }
  return [];
}
async function getAllSkills() {
  const appRoot = await getAppSkillsRoot();
  const sharedRoot = await getSharedSkillsRoot();
  const [appSkills, sharedSkills] = await Promise.all([
    safeReadSkillsFromRoot(appRoot, "app"),
    safeReadSkillsFromRoot(sharedRoot, "shared")
  ]);
  const merged = [...appSkills, ...sharedSkills];
  console.log(`[SkillsService] Discovered ${merged.length} skills (${appSkills.length} app, ${sharedSkills.length} shared)`);
  return merged.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}
async function deleteSkill(skillId) {
  const { source, folderName } = parseSkillId(skillId);
  const skillsRoot = source === "app" ? await getAppSkillsRoot() : await getSharedSkillsRoot();
  if (!skillsRoot) {
    return { success: false, message: `\u6280\u80FD "${folderName}" \u4E0D\u5B58\u5728` };
  }
  const targetPath = path7.join(skillsRoot, folderName);
  if (!await isDirectory(targetPath)) {
    return { success: false, message: `\u6280\u80FD "${folderName}" \u4E0D\u5B58\u5728` };
  }
  await rm(targetPath, { recursive: true, force: true });
  return { success: true, message: `\u6280\u80FD "${folderName}" \u5DF2\u5220\u9664` };
}
async function importSkillFromFolder(sourcePath) {
  const { root: skillsRoot, source } = await resolvePrimarySkillsRoot();
  const folderName = path7.basename(sourcePath);
  const targetName = await resolveUniqueFolderName(folderName, skillsRoot);
  const targetPath = path7.join(skillsRoot, targetName);
  await cp(sourcePath, targetPath, { recursive: true });
  const metadata = await resolveSkillMetadata(targetPath, targetName, buildFallbackLocation(targetName));
  return {
    success: true,
    message: "\u5BFC\u5165\u6210\u529F",
    skill: metadata ? {
      id: createSkillId(source, targetName),
      metadata,
      path: targetPath,
      isSystem: source === "app" ? app4.isPackaged : false,
      isNew: true
    } : void 0
  };
}
async function getAllMcpServers() {
  return await readMcpServers();
}
async function updateMcpServerState(serverId, updates) {
  const servers = await readMcpServers();
  const targetIndex = servers.findIndex((item) => item.id === serverId);
  if (targetIndex < 0) {
    return { success: false, message: `MCP \u670D\u52A1\u5668 "${serverId}" \u4E0D\u5B58\u5728` };
  }
  const current = servers[targetIndex];
  const updated = {
    ...current,
    ...updates,
    type: updates.type ? normalizeMcpType(updates.type) : current.type,
    name: updates.name?.trim() || current.name
  };
  servers[targetIndex] = updated;
  await writeMcpServers(servers);
  return { success: true, message: "\u66F4\u65B0\u6210\u529F" };
}
async function createMcpServer(input) {
  const normalized = normalizeMcpInput(input);
  if (!normalized.name) {
    return { success: false, message: "\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A" };
  }
  const servers = await readMcpServers();
  const existing = new Set(servers.map((item) => item.id));
  const baseId = slugifyId(normalized.name);
  const id = ensureUniqueId(baseId, existing);
  const server = {
    id,
    ...normalized
  };
  servers.push(server);
  await writeMcpServers(servers);
  return { success: true, server };
}
async function deleteMcpServer(serverId) {
  const servers = await readMcpServers();
  const next = servers.filter((item) => item.id !== serverId);
  if (next.length === servers.length) {
    return { success: false, message: `MCP \u670D\u52A1\u5668 "${serverId}" \u4E0D\u5B58\u5728` };
  }
  await writeMcpServers(next);
  return { success: true };
}
async function importMcpServers(input) {
  try {
    const incoming = parseMcpImportPayload(input);
    if (incoming.length === 0) {
      return { success: false, message: "\u672A\u89E3\u6790\u5230\u6709\u6548\u7684 MCP \u914D\u7F6E" };
    }
    const servers = await readMcpServers();
    const existing = new Set(servers.map((item) => item.id));
    let count = 0;
    for (const entry of incoming) {
      const normalized = normalizeMcpInput(entry);
      const baseId = slugifyId(normalized.name);
      const id = ensureUniqueId(baseId, existing);
      existing.add(id);
      servers.push({
        id,
        ...normalized
      });
      count += 1;
    }
    await writeMcpServers(servers);
    return { success: true, count };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "\u5BFC\u5165\u5931\u8D25" };
  }
}

// src/main/skills-mcp-types.ts
var SKILLS_MCP_CHANNELS = {
  // Skills
  SKILLS_LIST: "skills-mcp:list-skills",
  SKILLS_DELETE: "skills-mcp:delete-skill",
  SKILLS_REFRESH: "skills-mcp:refresh-skills",
  SKILLS_IMPORT: "skills-mcp:import-skill",
  // MCP
  MCP_LIST: "skills-mcp:list-mcp",
  MCP_CREATE: "skills-mcp:create-mcp",
  MCP_IMPORT: "skills-mcp:import-mcp",
  MCP_DELETE: "skills-mcp:delete-mcp",
  MCP_UPDATE: "skills-mcp:update-mcp",
  MCP_REFRESH: "skills-mcp:refresh-mcp"
};

// src/main/register-skills-mcp-ipc.ts
var require6 = createRequire5(import.meta.url);
var { BrowserWindow, dialog, ipcMain } = require6("electron");
function createSkillsMcpIpcHandlers() {
  return {
    // ==================== Skills ====================
    [SKILLS_MCP_CHANNELS.SKILLS_LIST]: async () => {
      return await getAllSkills();
    },
    [SKILLS_MCP_CHANNELS.SKILLS_DELETE]: async (_event, skillId) => {
      return await deleteSkill(skillId);
    },
    [SKILLS_MCP_CHANNELS.SKILLS_REFRESH]: async () => {
      return await getAllSkills();
    },
    [SKILLS_MCP_CHANNELS.SKILLS_IMPORT]: async (event, input) => {
      let sourcePath = input?.sourcePath;
      if (!sourcePath) {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const result = browserWindow ? await dialog.showOpenDialog(browserWindow, { properties: ["openDirectory"] }) : await dialog.showOpenDialog({ properties: ["openDirectory"] });
        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, message: "\u5DF2\u53D6\u6D88" };
        }
        sourcePath = result.filePaths[0];
      }
      return await importSkillFromFolder(sourcePath);
    },
    // ==================== MCP ====================
    [SKILLS_MCP_CHANNELS.MCP_LIST]: async () => {
      return await getAllMcpServers();
    },
    [SKILLS_MCP_CHANNELS.MCP_CREATE]: async (_event, input) => {
      return await createMcpServer(input);
    },
    [SKILLS_MCP_CHANNELS.MCP_IMPORT]: async (_event, input) => {
      return await importMcpServers(input);
    },
    [SKILLS_MCP_CHANNELS.MCP_DELETE]: async (_event, serverId) => {
      return await deleteMcpServer(serverId);
    },
    [SKILLS_MCP_CHANNELS.MCP_UPDATE]: async (_event, payload) => {
      return await updateMcpServerState(payload.serverId, payload.updates);
    },
    [SKILLS_MCP_CHANNELS.MCP_REFRESH]: async () => {
      return await getAllMcpServers();
    }
  };
}
function registerSkillsMcpIpcHandlers() {
  const handlers = createSkillsMcpIpcHandlers();
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler);
  });
  console.log("[Skills-MCP] IPC handlers \u5DF2\u6CE8\u518C");
}

// src/main/register-live2d-ipc.ts
import { createRequire as createRequire7 } from "node:module";

// src/main/live2d-service.ts
import { createRequire as createRequire6 } from "node:module";
import fs from "node:fs/promises";
import fss from "node:fs";
import path8 from "node:path";
var require7 = createRequire6(import.meta.url);
var { dialog: dialog2 } = require7("electron");
async function parseAndCompleteLive2dConfig(modelDir, folderName, modelJsonFile) {
  const jsonPath = path8.join(modelDir, modelJsonFile);
  const content = await fs.readFile(jsonPath, "utf8");
  const data = JSON.parse(content);
  const motions = [];
  const expressions = [];
  const rawMotions = data.FileReferences?.Motions || data.motions;
  if (rawMotions && typeof rawMotions === "object") {
    for (const [group, items] of Object.entries(rawMotions)) {
      if (Array.isArray(items)) {
        items.forEach((item, i) => {
          motions.push({
            group,
            name: String(i),
            // store index or specific key
            file: item.File || item.file || ""
          });
        });
      } else if (typeof items === "object" && items !== null) {
        motions.push({
          group,
          name: "0",
          file: items.File || items.file || ""
        });
      }
    }
  }
  const rawExpr = data.FileReferences?.Expressions || data.expressions;
  if (Array.isArray(rawExpr)) {
    rawExpr.forEach((item) => {
      expressions.push({
        name: item.Name || item.name || "",
        file: item.File || item.file || ""
      });
    });
  }
  const baseConfig = {
    id: folderName,
    name: folderName,
    modelJsonFile,
    motions,
    expressions
  };
  const customConfigPath = path8.join(modelDir, "live2d_custom_config.json");
  if (fss.existsSync(customConfigPath)) {
    try {
      const customContent = await fs.readFile(customConfigPath, "utf8");
      const customData = JSON.parse(customContent);
      if (customData.name) {
        baseConfig.name = customData.name;
      }
      baseConfig.motions = baseConfig.motions.map((m) => {
        const found = customData.motions?.find(
          (c) => c.group === m.group && c.name === m.name
        );
        return found ? { ...m, descriptionCh: found.descriptionCh, descriptionEn: found.descriptionEn } : m;
      });
      baseConfig.expressions = baseConfig.expressions.map((e) => {
        const found = customData.expressions?.find((c) => c.name === e.name);
        return found ? { ...e, descriptionCh: found.descriptionCh, descriptionEn: found.descriptionEn } : e;
      });
    } catch (e) {
      console.error("Failed to parse live2d_custom_config.json", e);
    }
  }
  return baseConfig;
}
async function importLive2dModel() {
  const { filePaths } = await dialog2.showOpenDialog({
    title: "Select Live2D Model Folder",
    properties: ["openDirectory"]
  });
  if (!filePaths || filePaths.length === 0) {
    return { success: false, message: "\u672A\u9009\u62E9\u4EFB\u4F55\u6587\u4EF6\u5939" };
  }
  const sourceDir = filePaths[0];
  const folderName = path8.basename(sourceDir);
  const shared = await ensureSharedWorkspace();
  const targetDir = path8.join(shared.sharedModelsRoot, folderName);
  if (fss.existsSync(targetDir)) {
    return { success: false, message: "\u8BE5\u6A21\u578B\u6587\u4EF6\u5939\u5DF2\u5B58\u5728" };
  }
  const files = await fs.readdir(sourceDir);
  const modelJsonFile = files.find(
    (f) => f.endsWith(".model3.json") || f.endsWith("model.json")
  );
  if (!modelJsonFile) {
    return {
      success: false,
      message: "\u6240\u9009\u6587\u4EF6\u5939\u4E2D\u672A\u627E\u5230 model.json \u6216 .model3.json"
    };
  }
  try {
    await fs.cp(sourceDir, targetDir, { recursive: true });
    const config = await parseAndCompleteLive2dConfig(targetDir, folderName, modelJsonFile);
    return { success: true, model: config };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
async function listLive2dModels() {
  const shared = await ensureSharedWorkspace();
  const models = [];
  if (!fss.existsSync(shared.sharedModelsRoot)) {
    return [];
  }
  const folders = await fs.readdir(shared.sharedModelsRoot);
  for (const folder of folders) {
    const modelDir = path8.join(shared.sharedModelsRoot, folder);
    const stat3 = await fs.stat(modelDir);
    if (!stat3.isDirectory()) continue;
    const files = await fs.readdir(modelDir);
    const modelJsonFile = files.find(
      (f) => f.endsWith(".model3.json") || f.endsWith("model.json")
    );
    if (!modelJsonFile) continue;
    try {
      const config = await parseAndCompleteLive2dConfig(modelDir, folder, modelJsonFile);
      models.push(config);
    } catch (e) {
      console.error("Failed to parse model", folder, e);
    }
  }
  return models;
}
async function saveLive2dConfig(input) {
  try {
    const shared = await ensureSharedWorkspace();
    const modelDir = path8.join(shared.sharedModelsRoot, input.modelId);
    if (!fss.existsSync(modelDir)) {
      return { success: false, message: "Model directory not found" };
    }
    const customConfigPath = path8.join(modelDir, "live2d_custom_config.json");
    const saveData = {
      modelId: input.modelId,
      motions: input.motions,
      expressions: input.expressions
    };
    await fs.writeFile(customConfigPath, JSON.stringify(saveData, null, 2), "utf8");
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}
async function downloadGithubLive2dModel(url) {
  try {
    const match = url.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)$/);
    if (!match) {
      return { success: false, message: "\u65E0\u6548\u7684\u94FE\u63A5\uFF0C\u8BF7\u63D0\u4F9B\u6307\u5411\u5177\u4F53\u6A21\u578B\u6587\u4EF6\u5939\u7684 GitHub \u94FE\u63A5 (\u4F8B\u5982 https://github.com/.../tree/master/model/shizuku)" };
    }
    const [, owner, repo, branch, targetPath] = match;
    const cleanTargetPath = targetPath.replace(/\/$/, "");
    const folderName = cleanTargetPath.split("/").pop() || "downloaded_model";
    const shared = await ensureSharedWorkspace();
    const targetDir = path8.join(shared.sharedModelsRoot, folderName);
    if (fss.existsSync(targetDir)) {
      return { success: false, message: `\u6A21\u578B\u6587\u4EF6\u5939 ${folderName} \u5DF2\u5B58\u5728` };
    }
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const treeRes = await fetch(treeUrl, { headers: { "User-Agent": "weBot-App" } });
    if (!treeRes.ok) {
      return { success: false, message: `\u65E0\u6CD5\u83B7\u53D6 GitHub \u4ED3\u5E93\u4FE1\u606F: HTTP ${treeRes.status}` };
    }
    const treeData = await treeRes.json();
    const filesToDownload = treeData.tree.filter(
      (item) => item.type === "blob" && item.path.startsWith(`${cleanTargetPath}/`)
    );
    if (!filesToDownload || filesToDownload.length === 0) {
      return { success: false, message: "\u672A\u627E\u5230\u8BE5\u8DEF\u5F84\u4E0B\u7684\u6587\u4EF6" };
    }
    await fs.mkdir(targetDir, { recursive: true });
    for (const item of filesToDownload) {
      const relativePath = item.path.substring(cleanTargetPath.length + 1);
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
      const destPath = path8.join(targetDir, relativePath);
      await fs.mkdir(path8.dirname(destPath), { recursive: true });
      const fileRes = await fetch(rawUrl);
      if (!fileRes.ok) throw new Error(`\u65E0\u6CD5\u4E0B\u8F7D\u6587\u4EF6: ${relativePath}`);
      const buffer = await fileRes.arrayBuffer();
      await fs.writeFile(destPath, Buffer.from(buffer));
    }
    const downloadedFiles = await fs.readdir(targetDir);
    const modelJsonFile = downloadedFiles.find((f) => f.endsWith(".model3.json") || f.endsWith("model.json"));
    if (!modelJsonFile) {
      await fs.rm(targetDir, { recursive: true, force: true });
      return { success: false, message: "\u6240\u9009\u6587\u4EF6\u5939\u4E2D\u672A\u627E\u5230 model.json \u6216 .model3.json" };
    }
    const config = await parseAndCompleteLive2dConfig(targetDir, folderName, modelJsonFile);
    return { success: true, model: config };
  } catch (error) {
    return { success: false, message: error.message || "\u7F51\u7EDC\u6216\u89E3\u6790\u9519\u8BEF" };
  }
}

// src/main/register-live2d-ipc.ts
var require8 = createRequire7(import.meta.url);
var { ipcMain: ipcMain2 } = require8("electron");
function registerLive2dIpcHandlers() {
  ipcMain2.handle(LIVE2D_IPC_CHANNELS.importModel, async () => {
    return await importLive2dModel();
  });
  ipcMain2.handle(LIVE2D_IPC_CHANNELS.listModels, async () => {
    return await listLive2dModels();
  });
  ipcMain2.handle(LIVE2D_IPC_CHANNELS.saveConfig, async (_event, payload) => {
    return await saveLive2dConfig(payload);
  });
  ipcMain2.handle(LIVE2D_IPC_CHANNELS.downloadGithub, async (_event, payload) => {
    return await downloadGithubLive2dModel(payload.url);
  });
}

// src/main/esbuild-compiler.ts
import { readFile as readFile6 } from "node:fs/promises";
import path9 from "node:path";
import * as esbuild from "esbuild";
async function findComponentInDir(dir, componentName) {
  try {
    const { readdir: readdir4 } = await import("node:fs/promises");
    const entries = await readdir4(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path9.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await findComponentInDir(fullPath, componentName);
        if (found) return found;
      } else if (entry.isFile()) {
        const ext = path9.extname(entry.name);
        const base = path9.basename(entry.name, ext);
        if (base.toLowerCase() === componentName.toLowerCase() && (ext === ".tsx" || ext === ".jsx")) {
          return fullPath;
        }
        if ((entry.name.toLowerCase() === "index.tsx" || entry.name.toLowerCase() === "index.jsx") && path9.basename(dir).toLowerCase() === componentName.toLowerCase()) {
          return fullPath;
        }
      }
    }
    return null;
  } catch (e) {
    console.error(`[SkillProtocol] findComponentInDir Error in ${dir}:`, e);
    return null;
  }
}
async function resolveComponentPath(componentName) {
  const skills = await getAllSkills();
  console.log(`[SkillProtocol] Resolving "${componentName}" among ${skills.length} skills`);
  for (const skill of skills) {
    const found = await findComponentInDir(skill.path, componentName);
    if (found) {
      console.log(`[SkillProtocol] Found "${componentName}" at ${found}`);
      return found;
    }
  }
  return null;
}
var requestCounter = 0;
async function handleSkillRequest(request) {
  const rid = ++requestCounter;
  console.log(`[SkillProtocol][#${rid}] <---- Incoming Request: ${request.url}`);
  try {
    const url = new URL(request.url);
    console.log(`[SkillProtocol][#${rid}] Parsing: Host="${url.hostname}", Path="${url.pathname}"`);
    let componentName = (url.hostname + url.pathname).replace(/^\/|\/$/g, "");
    componentName = componentName.replace(/\/main\.js$/, "").replace(/\/index\.js$/, "").replace(/\.(js|jsx|ts|tsx)$/, "");
    console.log(`[SkillProtocol][#${rid}] Targeted component identifier: "${componentName}"`);
    if (!componentName) {
      return new Response("Missing component name", { status: 400 });
    }
    const filePath = await resolveComponentPath(componentName);
    if (!filePath) {
      console.error(`[SkillProtocol][#${rid}] Component "${componentName}" not found in any skill.`);
      return new Response(`Component ${componentName} not found`, { status: 404 });
    }
    console.log(`[SkillProtocol][#${rid}] Compiling ${componentName} from ${filePath}`);
    const buildResult = await esbuild.build({
      entryPoints: [filePath],
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      target: "esnext",
      sourcemap: "inline",
      logLevel: "silent",
      loader: {
        ".ts": "ts",
        ".tsx": "tsx",
        ".js": "js",
        ".jsx": "jsx",
        ".json": "json"
      }
    });
    const output = buildResult.outputFiles?.[0];
    if (!output) {
      throw new Error("skill 编译失败：未生成输出文件");
    }
    const code = output.text;
    console.log(`[SkillProtocol][#${rid}] Compilation successful for ${componentName}`);
    console.log(`[SkillProtocol][#${rid}] First 200 chars of code:
${code.substring(0, 200)}...`);
    return new Response(code, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    console.error(`[SkillProtocol][#${rid}] Compilation error for ${request.url}:`, error);
    return new Response(`Compilation Error: ${error?.message || String(error)}`, { status: 500 });
  }
}

// src/main/electron-main.ts
var require9 = createRequire8(import.meta.url);
var { app: app5, BrowserWindow: BrowserWindow2, ipcMain: ipcMain3, Menu, Tray, nativeImage, protocol, net } = require9("electron");
var __filename = fileURLToPath3(import.meta.url);
var __dirname = path10.dirname(__filename);
var preloadPath = path10.join(__dirname, "../preload/index.cjs");
var tray = null;
var isQuitting = false;
protocol.registerSchemesAsPrivileged([
  {
    scheme: "skill",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  },
  {
    scheme: "webot-model",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
]);
function registerIpcHandlers() {
  registerSettingsIpcHandlers(ipcMain3);
  registerAgentIpcHandlers(ipcMain3);
  registerSkillsMcpIpcHandlers();
  registerLive2dIpcHandlers();
}
function resolveTrayIcon() {
  const iconPath = path10.join(app5.getAppPath(), "public", "vite.svg");
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    return nativeImage.createEmpty();
  }
  return icon;
}
function createTray(mainWindow) {
  if (tray) return;
  tray = new Tray(resolveTrayIcon());
  tray.setToolTip("weBot");
  const menu = Menu.buildFromTemplate([
    {
      label: "\u6253\u5F00 weBot",
      click: () => {
        mainWindow.show();
      }
    },
    {
      label: "\u505C\u6B62\u5168\u90E8\u667A\u80FD\u4F53",
      click: () => {
        stopAllAgentRuntimes();
      }
    },
    { type: "separator" },
    {
      label: "\u9000\u51FA",
      click: () => {
        isQuitting = true;
        stopAllAgentRuntimes();
        app5.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    mainWindow.show();
  });
}
function createMainWindow() {
  const win = new BrowserWindow2({
    width: 1200,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  win.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  const devServerUrl = "http://localhost:5274";
  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path10.join(__dirname, "../../dist/index.html"));
  }
  createTray(win);
}
app5.whenReady().then(() => {
  try {
    protocol.handle("skill", handleSkillRequest);
    protocol.handle("webot-model", (req) => {
      try {
        const url = new URL(req.url);
        const modelPath = path10.join(app5.getPath("userData"), "models", url.hostname, decodeURIComponent(url.pathname));
        return net.fetch("file://" + modelPath);
      } catch (err) {
        console.error("Error handling webot-model protocol", err);
        return new Response("Not Found", { status: 404 });
      }
    });
    console.log("[SkillProtocol] Custom protocol handlers registered successfully.");
  } catch (e) {
    console.error("[SkillProtocol] Failed to register protocol handlers:", e);
  }
  registerIpcHandlers();
  createMainWindow();
  app5.on("activate", () => {
    if (BrowserWindow2.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
app5.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app5.quit();
  }
});
app5.on("before-quit", () => {
  isQuitting = true;
  stopAllAgentRuntimes();
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL21haW4vZWxlY3Ryb24tbWFpbi50cyIsICIuLi9zcmMvbWFpbi9pcGMtY29udHJhY3QudHMiLCAiLi4vc3JjL21haW4vYWdlbnQtcHJvZmlsZS1zZXJ2aWNlLnRzIiwgIi4uL3NyYy9tYWluL2FnZW50LWNvbmZpZy1tYW5hZ2VyLnRzIiwgIi4uL3NyYy9tYWluL3NoYXJlZC13b3Jrc3BhY2UtbWFuYWdlci50cyIsICIuLi9zcmMvbWFpbi96ZXJvY2xhdy1jb25maWctbWFuYWdlci50cyIsICIuLi9zcmMvbWFpbi9tb2RlbC1wcm92aWRlci1jYXRhbG9nLnRzIiwgIi4uL3NyYy9tYWluL2FnZW50LXJ1bnRpbWUtc2VydmljZS50cyIsICIuLi9zcmMvbWFpbi9hZ2VudC1jaGF0LXNlcnZpY2UudHMiLCAiLi4vbm9kZV9tb2R1bGVzL0Bqc29uLXJlbmRlci9jb3JlL3NyYy90eXBlcy50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3N0YXRlLXN0b3JlLnRzIiwgIi4uL25vZGVfbW9kdWxlcy9AanNvbi1yZW5kZXIvY29yZS9zcmMvdmlzaWJpbGl0eS50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3Byb3BzLnRzIiwgIi4uL25vZGVfbW9kdWxlcy9AanNvbi1yZW5kZXIvY29yZS9zcmMvYWN0aW9ucy50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3ZhbGlkYXRpb24udHMiLCAiLi4vbm9kZV9tb2R1bGVzL0Bqc29uLXJlbmRlci9jb3JlL3NyYy9zcGVjLXZhbGlkYXRvci50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3NjaGVtYS50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3Byb21wdC50cyIsICIuLi9zcmMvbWFpbi9hZ2VudC1hcGkudHMiLCAiLi4vc3JjL21haW4vcmVnaXN0ZXItYWdlbnQtaXBjLnRzIiwgIi4uL3NyYy9tYWluL3Byb3ZpZGVyLXNldHRpbmdzLXNlcnZpY2UudHMiLCAiLi4vc3JjL21haW4vc3lzdGVtLXNldHRpbmdzLXNlcnZpY2UudHMiLCAiLi4vc3JjL21haW4vc2V0dGluZ3MtYXBpLnRzIiwgIi4uL3NyYy9tYWluL3JlZ2lzdGVyLXNldHRpbmdzLWlwYy50cyIsICIuLi9zcmMvbWFpbi9yZWdpc3Rlci1za2lsbHMtbWNwLWlwYy50cyIsICIuLi9zcmMvbWFpbi9za2lsbHMtbWNwLXNlcnZpY2UudHMiLCAiLi4vc3JjL21haW4vc2tpbGxzLW1jcC10eXBlcy50cyIsICIuLi9zcmMvbWFpbi9yZWdpc3Rlci1saXZlMmQtaXBjLnRzIiwgIi4uL3NyYy9tYWluL2xpdmUyZC1zZXJ2aWNlLnRzIiwgIi4uL3NyYy9tYWluL2VzYnVpbGQtY29tcGlsZXIudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgfSBmcm9tICdub2RlOm1vZHVsZSc7XG5jb25zdCByZXF1aXJlID0gY3JlYXRlUmVxdWlyZShpbXBvcnQubWV0YS51cmwpO1xuY29uc3QgeyBhcHAsIEJyb3dzZXJXaW5kb3csIGlwY01haW4sIE1lbnUsIFRyYXksIG5hdGl2ZUltYWdlLCBwcm90b2NvbCwgbmV0IH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmltcG9ydCB7IHJlZ2lzdGVyQWdlbnRJcGNIYW5kbGVycyB9IGZyb20gJy4vcmVnaXN0ZXItYWdlbnQtaXBjJztcbmltcG9ydCB7IHJlZ2lzdGVyU2V0dGluZ3NJcGNIYW5kbGVycyB9IGZyb20gJy4vcmVnaXN0ZXItc2V0dGluZ3MtaXBjJztcbmltcG9ydCB7IHJlZ2lzdGVyU2tpbGxzTWNwSXBjSGFuZGxlcnMgfSBmcm9tICcuL3JlZ2lzdGVyLXNraWxscy1tY3AtaXBjJztcbmltcG9ydCB7IHJlZ2lzdGVyTGl2ZTJkSXBjSGFuZGxlcnMgfSBmcm9tICcuL3JlZ2lzdGVyLWxpdmUyZC1pcGMnO1xuaW1wb3J0IHsgaGFuZGxlU2tpbGxSZXF1ZXN0IH0gZnJvbSAnLi9lc2J1aWxkLWNvbXBpbGVyJztcbmltcG9ydCB7IHN0b3BBbGxBZ2VudFJ1bnRpbWVzIH0gZnJvbSAnLi9hZ2VudC1ydW50aW1lLXNlcnZpY2UnO1xuXG5jb25zdCBfX2ZpbGVuYW1lID0gZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpO1xuY29uc3QgX19kaXJuYW1lID0gcGF0aC5kaXJuYW1lKF9fZmlsZW5hbWUpO1xuY29uc3QgcHJlbG9hZFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vcHJlbG9hZC9pbmRleC5janMnKTtcbmxldCB0cmF5OiBlbGVjdHJvbi5UcmF5IHwgbnVsbCA9IG51bGw7XG5sZXQgaXNRdWl0dGluZyA9IGZhbHNlO1xuXG5wcm90b2NvbC5yZWdpc3RlclNjaGVtZXNBc1ByaXZpbGVnZWQoW1xuICB7XG4gICAgc2NoZW1lOiAnc2tpbGwnLFxuICAgIHByaXZpbGVnZXM6IHtcbiAgICAgIHN0YW5kYXJkOiB0cnVlLFxuICAgICAgc2VjdXJlOiB0cnVlLFxuICAgICAgc3VwcG9ydEZldGNoQVBJOiB0cnVlLFxuICAgICAgY29yc0VuYWJsZWQ6IHRydWUsXG4gICAgICBieXBhc3NDU1A6IHRydWVcbiAgICB9XG4gIH0sXG4gIHtcbiAgICBzY2hlbWU6ICd3ZWJvdC1tb2RlbCcsXG4gICAgcHJpdmlsZWdlczoge1xuICAgICAgc3RhbmRhcmQ6IHRydWUsXG4gICAgICBzZWN1cmU6IHRydWUsXG4gICAgICBzdXBwb3J0RmV0Y2hBUEk6IHRydWUsXG4gICAgICBjb3JzRW5hYmxlZDogdHJ1ZSxcbiAgICAgIGJ5cGFzc0NTUDogdHJ1ZVxuICAgIH1cbiAgfVxuXSk7XG5cbmZ1bmN0aW9uIHJlZ2lzdGVySXBjSGFuZGxlcnMoKSB7XG4gIHJlZ2lzdGVyU2V0dGluZ3NJcGNIYW5kbGVycyhpcGNNYWluKTtcbiAgcmVnaXN0ZXJBZ2VudElwY0hhbmRsZXJzKGlwY01haW4pO1xuICByZWdpc3RlclNraWxsc01jcElwY0hhbmRsZXJzKCk7XG4gIHJlZ2lzdGVyTGl2ZTJkSXBjSGFuZGxlcnMoKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVRyYXlJY29uKCk6IGVsZWN0cm9uLk5hdGl2ZUltYWdlIHtcbiAgY29uc3QgaWNvblBhdGggPSBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ3B1YmxpYycsICd2aXRlLnN2ZycpO1xuICBjb25zdCBpY29uID0gbmF0aXZlSW1hZ2UuY3JlYXRlRnJvbVBhdGgoaWNvblBhdGgpO1xuICBpZiAoaWNvbi5pc0VtcHR5KCkpIHtcbiAgICByZXR1cm4gbmF0aXZlSW1hZ2UuY3JlYXRlRW1wdHkoKTtcbiAgfVxuICByZXR1cm4gaWNvbjtcbn1cblxuZnVuY3Rpb24gY3JlYXRlVHJheShtYWluV2luZG93OiBlbGVjdHJvbi5Ccm93c2VyV2luZG93KSB7XG4gIGlmICh0cmF5KSByZXR1cm47XG4gIHRyYXkgPSBuZXcgVHJheShyZXNvbHZlVHJheUljb24oKSk7XG4gIHRyYXkuc2V0VG9vbFRpcCgnd2VCb3QnKTtcblxuICBjb25zdCBtZW51ID0gTWVudS5idWlsZEZyb21UZW1wbGF0ZShbXG4gICAge1xuICAgICAgbGFiZWw6ICdcdTYyNTNcdTVGMDAgd2VCb3QnLFxuICAgICAgY2xpY2s6ICgpID0+IHtcbiAgICAgICAgbWFpbldpbmRvdy5zaG93KCk7XG4gICAgICB9LFxuICAgIH0sXG4gICAge1xuICAgICAgbGFiZWw6ICdcdTUwNUNcdTZCNjJcdTUxNjhcdTkwRThcdTY2N0FcdTgwRkRcdTRGNTMnLFxuICAgICAgY2xpY2s6ICgpID0+IHtcbiAgICAgICAgc3RvcEFsbEFnZW50UnVudGltZXMoKTtcbiAgICAgIH0sXG4gICAgfSxcbiAgICB7IHR5cGU6ICdzZXBhcmF0b3InIH0sXG4gICAge1xuICAgICAgbGFiZWw6ICdcdTkwMDBcdTUxRkEnLFxuICAgICAgY2xpY2s6ICgpID0+IHtcbiAgICAgICAgaXNRdWl0dGluZyA9IHRydWU7XG4gICAgICAgIHN0b3BBbGxBZ2VudFJ1bnRpbWVzKCk7XG4gICAgICAgIGFwcC5xdWl0KCk7XG4gICAgICB9LFxuICAgIH0sXG4gIF0pO1xuXG4gIHRyYXkuc2V0Q29udGV4dE1lbnUobWVudSk7XG4gIHRyYXkub24oJ2NsaWNrJywgKCkgPT4ge1xuICAgIG1haW5XaW5kb3cuc2hvdygpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTWFpbldpbmRvdygpIHtcbiAgY29uc3Qgd2luID0gbmV3IEJyb3dzZXJXaW5kb3coe1xuICAgIHdpZHRoOiAxMjAwLFxuICAgIGhlaWdodDogODYwLFxuICAgIG1pbldpZHRoOiAxMTAwLFxuICAgIG1pbkhlaWdodDogNzIwLFxuICAgIHNob3c6IGZhbHNlLFxuICAgIGJhY2tncm91bmRDb2xvcjogJyNmZmZmZmYnLFxuICAgIHdlYlByZWZlcmVuY2VzOiB7XG4gICAgICBwcmVsb2FkOiBwcmVsb2FkUGF0aCxcbiAgICAgIGNvbnRleHRJc29sYXRpb246IHRydWUsXG4gICAgICBub2RlSW50ZWdyYXRpb246IGZhbHNlLFxuICAgIH0sXG4gIH0pO1xuXG4gIHdpbi5vbmNlKCdyZWFkeS10by1zaG93JywgKCkgPT4ge1xuICAgIHdpbi5zaG93KCk7XG4gIH0pO1xuXG4gIHdpbi5vbignY2xvc2UnLCAoZXZlbnQpID0+IHtcbiAgICBpZiAoIWlzUXVpdHRpbmcpIHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICB3aW4uaGlkZSgpO1xuICAgIH1cbiAgfSk7XG5cbiAgY29uc3QgZGV2U2VydmVyVXJsID0gcHJvY2Vzcy5lbnYuVklURV9ERVZfU0VSVkVSX1VSTDtcbiAgaWYgKGRldlNlcnZlclVybCkge1xuICAgIHdpbi5sb2FkVVJMKGRldlNlcnZlclVybCk7XG4gICAgd2luLndlYkNvbnRlbnRzLm9wZW5EZXZUb29scyh7IG1vZGU6ICdkZXRhY2gnIH0pO1xuICB9IGVsc2Uge1xuICAgIHdpbi5sb2FkRmlsZShwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vZGlzdC9pbmRleC5odG1sJykpO1xuICB9XG5cbiAgY3JlYXRlVHJheSh3aW4pO1xufVxuXG5hcHAud2hlblJlYWR5KCkudGhlbigoKSA9PiB7XG4gIHRyeSB7XG4gICAgcHJvdG9jb2wuaGFuZGxlKCdza2lsbCcsIGhhbmRsZVNraWxsUmVxdWVzdCk7XG5cbiAgICAvLyBcdTYyRTZcdTYyMkEgd2Vib3QtbW9kZWwgXHU1MzRGXHU4QkFFXHU1MkEwXHU4RjdEXHU2NzJDXHU1NzMwXHU2QTIxXHU1NzhCXHU2NTg3XHU0RUY2XG4gICAgcHJvdG9jb2wuaGFuZGxlKCd3ZWJvdC1tb2RlbCcsIChyZXEpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCk7XG4gICAgICAgIC8vIHVybC5ob3N0bmFtZSBpcyB0aGUgbW9kZWwgbmFtZSwgdXJsLnBhdGhuYW1lIGlzIHRoZSBmaWxlIHBhdGggaW5zaWRlIG1vZGVsIGZvbGRlclxuICAgICAgICBjb25zdCBtb2RlbFBhdGggPSBwYXRoLmpvaW4oYXBwLmdldFBhdGgoJ3VzZXJEYXRhJyksICdtb2RlbHMnLCB1cmwuaG9zdG5hbWUsIGRlY29kZVVSSUNvbXBvbmVudCh1cmwucGF0aG5hbWUpKTtcbiAgICAgICAgcmV0dXJuIG5ldC5mZXRjaCgnZmlsZTovLycgKyBtb2RlbFBhdGgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGhhbmRsaW5nIHdlYm90LW1vZGVsIHByb3RvY29sJywgZXJyKTtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZSgnTm90IEZvdW5kJywgeyBzdGF0dXM6IDQwNCB9KTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnNvbGUubG9nKCdbU2tpbGxQcm90b2NvbF0gQ3VzdG9tIHByb3RvY29sIGhhbmRsZXJzIHJlZ2lzdGVyZWQgc3VjY2Vzc2Z1bGx5LicpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW1NraWxsUHJvdG9jb2xdIEZhaWxlZCB0byByZWdpc3RlciBwcm90b2NvbCBoYW5kbGVyczonLCBlKTtcbiAgfVxuICByZWdpc3RlcklwY0hhbmRsZXJzKCk7XG4gIGNyZWF0ZU1haW5XaW5kb3coKTtcblxuICBhcHAub24oJ2FjdGl2YXRlJywgKCkgPT4ge1xuICAgIGlmIChCcm93c2VyV2luZG93LmdldEFsbFdpbmRvd3MoKS5sZW5ndGggPT09IDApIHtcbiAgICAgIGNyZWF0ZU1haW5XaW5kb3coKTtcbiAgICB9XG4gIH0pO1xufSk7XG5cbmFwcC5vbignd2luZG93LWFsbC1jbG9zZWQnLCAoKSA9PiB7XG4gIGlmIChwcm9jZXNzLnBsYXRmb3JtICE9PSAnZGFyd2luJykge1xuICAgIGFwcC5xdWl0KCk7XG4gIH1cbn0pO1xuXG5hcHAub24oJ2JlZm9yZS1xdWl0JywgKCkgPT4ge1xuICBpc1F1aXR0aW5nID0gdHJ1ZTtcbiAgc3RvcEFsbEFnZW50UnVudGltZXMoKTtcbn0pO1xuIiwgImltcG9ydCB0eXBlIHtcbiAgQWdlbnRQcm9maWxlLFxuICBDb25uZWN0Q3VzdG9tUHJvdmlkZXJJbnB1dCxcbiAgQ29ubmVjdFByb3ZpZGVySW5wdXQsXG4gIERpc2Nvbm5lY3RQcm92aWRlcklucHV0LFxuICBHZXRBZ2VudElucHV0LFxuICBMaXN0QWdlbnRzSW5wdXQsXG4gIE1vZGVsU2V0dGluZ3NSZXNwb25zZSxcbiAgUHJvdmlkZXJTZXR0aW5nc1Jlc3BvbnNlLFxuICBSZWZyZXNoUHJvdmlkZXJNb2RlbHNJbnB1dCxcbiAgUmVmcmVzaFByb3ZpZGVyTW9kZWxzUmVzdWx0LFxuICBTYXZlQWdlbnRJbnB1dCxcbiAgU2F2ZUFnZW50UmVzdWx0LFxuICBTdGFydEFnZW50SW5wdXQsXG4gIFN0YXJ0QWdlbnRSZXN1bHQsXG4gIFN0b3BBZ2VudElucHV0LFxuICBTdG9wQWdlbnRSZXN1bHQsXG4gIEFnZW50UnVudGltZVN0YXR1cyxcbiAgQWdlbnRMb2dUYWlsLFxuICBTZXREZWZhdWx0TW9kZWxJbnB1dCxcbiAgVG9nZ2xlTW9kZWxFbmFibGVkSW5wdXQsXG4gIFRvZ2dsZVByb3ZpZGVyRW5hYmxlZElucHV0LFxuICBVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dCxcbiAgWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24sXG4gIEFwcFNldHRpbmdzLFxuICBTZXRBdXRvTGF1bmNoSW5wdXQsXG4gIEdldEFnZW50TG9nVGFpbElucHV0LFxuICBBZ2VudENoYXRJbnB1dCxcbiAgQWdlbnRDaGF0UmVzdWx0LFxufSBmcm9tICcuL3R5cGVzJztcblxuZXhwb3J0IGNvbnN0IFNFVFRJTkdTX0lQQ19DSEFOTkVMUyA9IHtcbiAgZ2V0UHJvdmlkZXJTZXR0aW5nczogJ3NldHRpbmdzOmdldC1wcm92aWRlci1zZXR0aW5ncycsXG4gIGNvbm5lY3RQcm92aWRlcjogJ3NldHRpbmdzOmNvbm5lY3QtcHJvdmlkZXInLFxuICBjb25uZWN0Q3VzdG9tUHJvdmlkZXI6ICdzZXR0aW5nczpjb25uZWN0LWN1c3RvbS1wcm92aWRlcicsXG4gIGRpc2Nvbm5lY3RQcm92aWRlcjogJ3NldHRpbmdzOmRpc2Nvbm5lY3QtcHJvdmlkZXInLFxuICBnZXRNb2RlbFNldHRpbmdzOiAnc2V0dGluZ3M6Z2V0LW1vZGVsLXNldHRpbmdzJyxcbiAgc2V0RGVmYXVsdE1vZGVsOiAnc2V0dGluZ3M6c2V0LWRlZmF1bHQtbW9kZWwnLFxuICB0b2dnbGVQcm92aWRlckVuYWJsZWQ6ICdzZXR0aW5nczp0b2dnbGUtcHJvdmlkZXItZW5hYmxlZCcsXG4gIHRvZ2dsZU1vZGVsRW5hYmxlZDogJ3NldHRpbmdzOnRvZ2dsZS1tb2RlbC1lbmFibGVkJyxcbiAgcmVmcmVzaFByb3ZpZGVyTW9kZWxzOiAnc2V0dGluZ3M6cmVmcmVzaC1wcm92aWRlci1tb2RlbHMnLFxuICB1cGRhdGVQcm92aWRlckNvbm5lY3Rpb246ICdzZXR0aW5nczp1cGRhdGUtcHJvdmlkZXItY29ubmVjdGlvbicsXG4gIGdldEFwcFNldHRpbmdzOiAnc2V0dGluZ3M6Z2V0LWFwcC1zZXR0aW5ncycsXG4gIHNldEF1dG9MYXVuY2g6ICdzZXR0aW5nczpzZXQtYXV0by1sYXVuY2gnLFxufSBhcyBjb25zdDtcblxuZXhwb3J0IGNvbnN0IEFHRU5UX0lQQ19DSEFOTkVMUyA9IHtcbiAgc2F2ZUFnZW50OiAnYWdlbnQ6c2F2ZScsXG4gIGdldEFnZW50OiAnYWdlbnQ6Z2V0JyxcbiAgbGlzdEFnZW50czogJ2FnZW50Omxpc3QnLFxuICBzdGFydEFnZW50OiAnYWdlbnQ6c3RhcnQnLFxuICBzdG9wQWdlbnQ6ICdhZ2VudDpzdG9wJyxcbiAgYWdlbnRTdGF0dXM6ICdhZ2VudDpzdGF0dXMnLFxuICBhZ2VudExvZ1RhaWw6ICdhZ2VudDpsb2ctdGFpbCcsXG4gIGFnZW50Q2hhdDogJ2FnZW50OmNoYXQnLFxuICBhZ2VudENoYXRTdHJlYW06ICdhZ2VudDpjaGF0LXN0cmVhbScsXG59IGFzIGNvbnN0O1xuXG5leHBvcnQgaW50ZXJmYWNlIFNldHRpbmdzSXBjQ29udHJhY3Qge1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldFByb3ZpZGVyU2V0dGluZ3NdOiB7XG4gICAgcmVxOiB1bmRlZmluZWQ7XG4gICAgcmVzOiBQcm92aWRlclNldHRpbmdzUmVzcG9uc2U7XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuY29ubmVjdFByb3ZpZGVyXToge1xuICAgIHJlcTogQ29ubmVjdFByb3ZpZGVySW5wdXQ7XG4gICAgcmVzOiBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbjtcbiAgfTtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5jb25uZWN0Q3VzdG9tUHJvdmlkZXJdOiB7XG4gICAgcmVxOiBDb25uZWN0Q3VzdG9tUHJvdmlkZXJJbnB1dDtcbiAgICByZXM6IFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uO1xuICB9O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmRpc2Nvbm5lY3RQcm92aWRlcl06IHtcbiAgICByZXE6IERpc2Nvbm5lY3RQcm92aWRlcklucHV0O1xuICAgIHJlczogeyBvazogdHJ1ZSB9O1xuICB9O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldE1vZGVsU2V0dGluZ3NdOiB7XG4gICAgcmVxOiB1bmRlZmluZWQ7XG4gICAgcmVzOiBNb2RlbFNldHRpbmdzUmVzcG9uc2U7XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuc2V0RGVmYXVsdE1vZGVsXToge1xuICAgIHJlcTogU2V0RGVmYXVsdE1vZGVsSW5wdXQ7XG4gICAgcmVzOiB7IG9rOiB0cnVlIH07XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlUHJvdmlkZXJFbmFibGVkXToge1xuICAgIHJlcTogVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQ7XG4gICAgcmVzOiB7IG9rOiB0cnVlIH07XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlTW9kZWxFbmFibGVkXToge1xuICAgIHJlcTogVG9nZ2xlTW9kZWxFbmFibGVkSW5wdXQ7XG4gICAgcmVzOiB7IG9rOiB0cnVlIH07XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMucmVmcmVzaFByb3ZpZGVyTW9kZWxzXToge1xuICAgIHJlcTogUmVmcmVzaFByb3ZpZGVyTW9kZWxzSW5wdXQ7XG4gICAgcmVzOiBSZWZyZXNoUHJvdmlkZXJNb2RlbHNSZXN1bHQ7XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uXToge1xuICAgIHJlcTogVXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uSW5wdXQ7XG4gICAgcmVzOiBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbjtcbiAgfTtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRBcHBTZXR0aW5nc106IHtcbiAgICByZXE6IHVuZGVmaW5lZDtcbiAgICByZXM6IEFwcFNldHRpbmdzO1xuICB9O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnNldEF1dG9MYXVuY2hdOiB7XG4gICAgcmVxOiBTZXRBdXRvTGF1bmNoSW5wdXQ7XG4gICAgcmVzOiBBcHBTZXR0aW5ncztcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBZ2VudElwY0NvbnRyYWN0IHtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5zYXZlQWdlbnRdOiB7XG4gICAgcmVxOiBTYXZlQWdlbnRJbnB1dDtcbiAgICByZXM6IFNhdmVBZ2VudFJlc3VsdDtcbiAgfTtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5nZXRBZ2VudF06IHtcbiAgICByZXE6IEdldEFnZW50SW5wdXQ7XG4gICAgcmVzOiBBZ2VudFByb2ZpbGU7XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMubGlzdEFnZW50c106IHtcbiAgICByZXE6IExpc3RBZ2VudHNJbnB1dCB8IHVuZGVmaW5lZDtcbiAgICByZXM6IHJlYWRvbmx5IEFnZW50UHJvZmlsZVtdO1xuICB9O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLnN0YXJ0QWdlbnRdOiB7XG4gICAgcmVxOiBTdGFydEFnZW50SW5wdXQ7XG4gICAgcmVzOiBTdGFydEFnZW50UmVzdWx0O1xuICB9O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLnN0b3BBZ2VudF06IHtcbiAgICByZXE6IFN0b3BBZ2VudElucHV0O1xuICAgIHJlczogU3RvcEFnZW50UmVzdWx0O1xuICB9O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50U3RhdHVzXToge1xuICAgIHJlcTogeyBhZ2VudElkOiBzdHJpbmcgfTtcbiAgICByZXM6IEFnZW50UnVudGltZVN0YXR1cztcbiAgfTtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudExvZ1RhaWxdOiB7XG4gICAgcmVxOiBHZXRBZ2VudExvZ1RhaWxJbnB1dDtcbiAgICByZXM6IEFnZW50TG9nVGFpbDtcbiAgfTtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudENoYXRdOiB7XG4gICAgcmVxOiBBZ2VudENoYXRJbnB1dDtcbiAgICByZXM6IEFnZW50Q2hhdFJlc3VsdDtcbiAgfTtcbn1cblxuZXhwb3J0IGNvbnN0IExJVkUyRF9JUENfQ0hBTk5FTFMgPSB7XG4gIGltcG9ydE1vZGVsOiAnbGl2ZTJkOmltcG9ydC1tb2RlbCcsXG4gIGxpc3RNb2RlbHM6ICdsaXZlMmQ6bGlzdC1tb2RlbHMnLFxuICBzYXZlQ29uZmlnOiAnbGl2ZTJkOnNhdmUtY29uZmlnJyxcbiAgZG93bmxvYWRHaXRodWI6ICdsaXZlMmQ6ZG93bmxvYWQtZ2l0aHViJyxcbn0gYXMgY29uc3Q7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTGl2ZTJkSXBjQ29udHJhY3Qge1xuICBbTElWRTJEX0lQQ19DSEFOTkVMUy5pbXBvcnRNb2RlbF06IHtcbiAgICByZXE6IHVuZGVmaW5lZDtcbiAgICByZXM6IGltcG9ydCgnLi90eXBlcycpLkltcG9ydExpdmUyZE1vZGVsUmVzdWx0O1xuICB9O1xuICBbTElWRTJEX0lQQ19DSEFOTkVMUy5saXN0TW9kZWxzXToge1xuICAgIHJlcTogdW5kZWZpbmVkO1xuICAgIHJlczogcmVhZG9ubHkgaW1wb3J0KCcuL3R5cGVzJykuTGl2ZTJkTW9kZWxDb25maWdbXTtcbiAgfTtcbiAgW0xJVkUyRF9JUENfQ0hBTk5FTFMuc2F2ZUNvbmZpZ106IHtcbiAgICByZXE6IGltcG9ydCgnLi90eXBlcycpLlNhdmVMaXZlMmRDb25maWdJbnB1dDtcbiAgICByZXM6IGltcG9ydCgnLi90eXBlcycpLlNhdmVMaXZlMmRDb25maWdSZXN1bHQ7XG4gIH07XG4gIFtMSVZFMkRfSVBDX0NIQU5ORUxTLmRvd25sb2FkR2l0aHViXToge1xuICAgIHJlcTogeyB1cmw6IHN0cmluZyB9O1xuICAgIHJlczogaW1wb3J0KCcuL3R5cGVzJykuSW1wb3J0TGl2ZTJkTW9kZWxSZXN1bHQ7XG4gIH07XG59XG4iLCAiaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IG1rZGlyLCByZWFkRmlsZSwgcmVhZGRpciwgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5cbmltcG9ydCB7IGJ1aWxkQWdlbnRSdW50aW1lQ29uZmlnLCB3cml0ZUFnZW50UnVudGltZUNvbmZpZ0ZpbGUgfSBmcm9tICcuL2FnZW50LWNvbmZpZy1tYW5hZ2VyJztcbmltcG9ydCB7IGVuc3VyZUFnZW50V29ya3NwYWNlLCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UgfSBmcm9tICcuL3NoYXJlZC13b3Jrc3BhY2UtbWFuYWdlcic7XG5pbXBvcnQgeyBlbnN1cmVaZXJvQ2xhd0NvbmZpZyB9IGZyb20gJy4vemVyb2NsYXctY29uZmlnLW1hbmFnZXInO1xuaW1wb3J0IHR5cGUge1xuICBBZ2VudEluZGV4SXRlbSxcbiAgQWdlbnRQcm9maWxlLFxuICBBZ2VudHNJbmRleEZpbGUsXG4gIEdldEFnZW50SW5wdXQsXG4gIExpc3RBZ2VudHNJbnB1dCxcbiAgU2F2ZUFnZW50SW5wdXQsXG4gIFNhdmVBZ2VudFJlc3VsdCxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IEFHRU5UU19JTkRFWF9GSUxFID0gJ2FnZW50cy5pbmRleC5qc29uJztcbmNvbnN0IEFHRU5UX1BST0ZJTEVfRklMRSA9ICdhZ2VudC5wcm9maWxlLmpzb24nO1xuY29uc3QgQUdFTlRfUFJPTVBUX0ZJTEUgPSAnc3lzdGVtLXByb21wdC5tZCc7XG5cbmludGVyZmFjZSBEZWZhdWx0QWdlbnRTZWVkIHtcbiAgYWdlbnRJZDogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIHRhZ3M6IHN0cmluZ1tdO1xuICBzdW1tYXJ5OiBzdHJpbmc7XG4gIHNvdWw6IHN0cmluZztcbiAgc3lzdGVtUHJvbXB0OiBzdHJpbmc7XG4gIGNvbG9yOiBzdHJpbmc7XG59XG5cbmZ1bmN0aW9uIHNsdWdpZnkoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBpbnB1dC50cmltKCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOS1fXSsvZywgJy0nKTtcbiAgcmV0dXJuIG5vcm1hbGl6ZWQubGVuZ3RoID4gMCA/IG5vcm1hbGl6ZWQgOiAnYWdlbnQnO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlQWdlbnRJZChpbnB1dDogU2F2ZUFnZW50SW5wdXQpOiBzdHJpbmcge1xuICBpZiAodHlwZW9mIGlucHV0LmFnZW50SWQgPT09ICdzdHJpbmcnICYmIGlucHV0LmFnZW50SWQudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gc2x1Z2lmeShpbnB1dC5hZ2VudElkKTtcbiAgfVxuXG4gIGNvbnN0IHN1ZmZpeCA9IERhdGUubm93KCkudG9TdHJpbmcoMzYpO1xuICByZXR1cm4gYCR7c2x1Z2lmeShpbnB1dC5uYW1lKX0tJHtzdWZmaXh9YDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZURlZmF1bHRNb2RlbChob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPHtcbiAgcHJvdmlkZXJJZDogc3RyaW5nO1xuICBtb2RlbE5hbWU6IHN0cmluZztcbn0+IHtcbiAgY29uc3QgY29uZmlnID0gYXdhaXQgZW5zdXJlWmVyb0NsYXdDb25maWcoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgcHJlZmVycmVkTW9kZWxJZCA9XG4gICAgY29uZmlnLmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkID8/XG4gICAgY29uZmlnLm1vZGVsQ2F0YWxvZy5maW5kKChpdGVtKSA9PiBpdGVtLmVuYWJsZWQpPy5tb2RlbElkID8/XG4gICAgY29uZmlnLm1vZGVsQ2F0YWxvZ1swXT8ubW9kZWxJZDtcblxuICBpZiAoIXByZWZlcnJlZE1vZGVsSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1x1NjcyQVx1NjI3RVx1NTIzMFx1NTNFRlx1NzUyOFx1NkEyMVx1NTc4Qlx1RkYwQ1x1OEJGN1x1NTE0OFx1OTE0RFx1N0Y2RVx1NkEyMVx1NTc4Qlx1NjNEMFx1NEY5Qlx1NTU0Nlx1MzAwMicpO1xuICB9XG5cbiAgY29uc3QgbW9kZWwgPSBjb25maWcubW9kZWxDYXRhbG9nLmZpbmQoKGl0ZW0pID0+IGl0ZW0ubW9kZWxJZCA9PT0gcHJlZmVycmVkTW9kZWxJZCk7XG4gIGlmICghbW9kZWwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFx1OUVEOFx1OEJBNFx1NkEyMVx1NTc4Qlx1NEUwRFx1NTNFRlx1NzUyOFx1RkYxQSR7cHJlZmVycmVkTW9kZWxJZH1gKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHJvdmlkZXJJZDogbW9kZWwucHJvdmlkZXJJZCxcbiAgICBtb2RlbE5hbWU6IG1vZGVsLm1vZGVsTmFtZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0RGVmYXVsdEFnZW50U2VlZHMoKTogRGVmYXVsdEFnZW50U2VlZFtdIHtcbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBhZ2VudElkOiAnYWdlbnQtZGV2JyxcbiAgICAgIG5hbWU6ICdcdTVGMDBcdTUzRDEnLFxuICAgICAgdGl0bGU6ICdcdTY4MzhcdTVGQzNcdTVGMDBcdTUzRDFcdTVERTVcdTdBMEJcdTVFMDgnLFxuICAgICAgdGFnczogWydcdTVGMDBcdTUzRDEnLCAnXHU2N0I2XHU2Nzg0JywgJ1x1NEVBNFx1NEVEOCddLFxuICAgICAgc3VtbWFyeTogJ1x1OEQxRlx1OEQyM1x1NjgzOFx1NUZDM1x1NTI5Rlx1ODBGRFx1NUYwMFx1NTNEMVx1NEUwRVx1NEVBNFx1NEVEOFx1RkYwQ1x1NUYzQVx1OEMwM1x1NURFNVx1N0EwQlx1OEQyOFx1OTFDRlx1NEUwRVx1NTNFRlx1N0VGNFx1NjJBNFx1NjAyN1x1MzAwMicsXG4gICAgICBzb3VsOiAnXHU0RTI1XHU4QzI4XHU1MkExXHU1QjlFXHVGRjBDXHU5MUNEXHU4OUM2XHU3RUQzXHU2Nzg0XHU0RTBFXHU3RUM2XHU4MjgyXHVGRjBDXHU4MEZEXHU2MjhBXHU5NzAwXHU2QzQyXHU4NDNEXHU1NzMwXHU0RTNBXHU0RUUzXHU3ODAxXHUzMDAyJyxcbiAgICAgIHN5c3RlbVByb21wdDogW1xuICAgICAgICAnXHU0RjYwXHU2NjJGXHU2ODM4XHU1RkMzXHU1RjAwXHU1M0QxXHU1REU1XHU3QTBCXHU1RTA4XHVGRjBDXHU4RDFGXHU4RDIzXHU1MjlGXHU4MEZEXHU1QjlFXHU3M0IwXHU0RTBFXHU2MjgwXHU2NzJGXHU4NDNEXHU1NzMwXHUzMDAyJyxcbiAgICAgICAgJ1x1NTZERVx1N0I1NFx1OTcwMFx1NTMwNVx1NTQyQlx1NTNFRlx1NjI2N1x1ODg0Q1x1NkI2NVx1OUFBNFx1MzAwMVx1NTE3M1x1OTUyRVx1NjI4MFx1NjcyRlx1N0VDNlx1ODI4Mlx1NEUwRVx1OThDRVx1OTY2OVx1NjNEMFx1OTE5Mlx1MzAwMicsXG4gICAgICBdLmpvaW4oJ1xcbicpLFxuICAgICAgY29sb3I6ICcjNjBhNWZhJyxcbiAgICB9LFxuICBdO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZWVkRGVmYXVsdEFnZW50cyhob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPEFnZW50UHJvZmlsZVtdPiB7XG4gIGNvbnN0IHsgcHJvdmlkZXJJZCwgbW9kZWxOYW1lIH0gPSBhd2FpdCByZXNvbHZlRGVmYXVsdE1vZGVsKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IHNlZWRzID0gZ2V0RGVmYXVsdEFnZW50U2VlZHMoKTtcbiAgY29uc3QgcHJvZmlsZXM6IEFnZW50UHJvZmlsZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBzZWVkIG9mIHNlZWRzKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2F2ZUFnZW50UHJvZmlsZSh7XG4gICAgICBhZ2VudElkOiBzZWVkLmFnZW50SWQsXG4gICAgICBuYW1lOiBzZWVkLm5hbWUsXG4gICAgICB0aXRsZTogc2VlZC50aXRsZSxcbiAgICAgIHRhZ3M6IHNlZWQudGFncyxcbiAgICAgIHN1bW1hcnk6IHNlZWQuc3VtbWFyeSxcbiAgICAgIHNvdWw6IHNlZWQuc291bCxcbiAgICAgIHN5c3RlbVByb21wdDogc2VlZC5zeXN0ZW1Qcm9tcHQsXG4gICAgICBwcml2YXRlU2tpbGxzOiBbXSxcbiAgICAgIHNoYXJlZFNraWxsczogW10sXG4gICAgICBwcml2YXRlTWNwU2VydmVyczogW10sXG4gICAgICBzaGFyZWRNY3BTZXJ2ZXJzOiBbXSxcbiAgICAgIGRlZmF1bHRQcm92aWRlcklkOiBwcm92aWRlcklkLFxuICAgICAgZGVmYXVsdE1vZGVsTmFtZTogbW9kZWxOYW1lLFxuICAgICAgYXZhdGFyVXJsOiB1bmRlZmluZWQsXG4gICAgICBjb2xvcjogc2VlZC5jb2xvcixcbiAgICAgIGhvbWVEaXJPdmVycmlkZSxcbiAgICB9KTtcbiAgICBwcm9maWxlcy5wdXNoKHJlc3VsdC5wcm9maWxlKTtcbiAgfVxuXG4gIHJldHVybiBwcm9maWxlcztcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVhZEpzb25GaWxlPFQ+KGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPFQgfCB1bmRlZmluZWQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByYXcgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04Jyk7XG4gICAgcmV0dXJuIEpTT04ucGFyc2UocmF3KSBhcyBUO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmICdjb2RlJyBpbiBlcnJvciAmJiBlcnJvci5jb2RlID09PSAnRU5PRU5UJykge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZUpzb25GaWxlKGZpbGVQYXRoOiBzdHJpbmcsIGRhdGE6IHVua25vd24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgbWtkaXIocGF0aC5kaXJuYW1lKGZpbGVQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGF3YWl0IHdyaXRlRmlsZShmaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGF0YSwgbnVsbCwgMiksICd1dGYtOCcpO1xufVxuXG5mdW5jdGlvbiB0b0FnZW50SW5kZXhJdGVtKHByb2ZpbGU6IEFnZW50UHJvZmlsZSk6IEFnZW50SW5kZXhJdGVtIHtcbiAgcmV0dXJuIHtcbiAgICBhZ2VudElkOiBwcm9maWxlLmFnZW50SWQsXG4gICAgbmFtZTogcHJvZmlsZS5uYW1lLFxuICAgIHRpdGxlOiBwcm9maWxlLnRpdGxlLFxuICAgIHRhZ3M6IHByb2ZpbGUudGFncyxcbiAgICBzdW1tYXJ5OiBwcm9maWxlLnN1bW1hcnksXG4gICAgZGVmYXVsdFByb3ZpZGVySWQ6IHByb2ZpbGUuZGVmYXVsdExsbS5wcm92aWRlcklkLFxuICAgIGRlZmF1bHRNb2RlbE5hbWU6IHByb2ZpbGUuZGVmYXVsdExsbS5tb2RlbE5hbWUsXG4gICAgcHJvZmlsZVBhdGg6IHByb2ZpbGUucGF0aHMucHJvZmlsZVBhdGgsXG4gICAgYWdlbnRSb290OiBwcm9maWxlLnBhdGhzLmFnZW50Um9vdCxcbiAgICBjcmVhdGVkQXQ6IHByb2ZpbGUuY3JlYXRlZEF0LFxuICAgIHVwZGF0ZWRBdDogcHJvZmlsZS51cGRhdGVkQXQsXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRBZ2VudHNJbmRleEZpbGUoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxBZ2VudHNJbmRleEZpbGUgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGluZGV4UGF0aCA9IHBhdGguam9pbihzaGFyZWQuYWdlbnRzUm9vdCwgQUdFTlRTX0lOREVYX0ZJTEUpO1xuICByZXR1cm4gcmVhZEpzb25GaWxlPEFnZW50c0luZGV4RmlsZT4oaW5kZXhQYXRoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gd3JpdGVBZ2VudHNJbmRleEZpbGUoXG4gIGFnZW50czogcmVhZG9ubHkgQWdlbnRJbmRleEl0ZW1bXSxcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHNoYXJlZCA9IGF3YWl0IGVuc3VyZVNoYXJlZFdvcmtzcGFjZShob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBpbmRleFBhdGggPSBwYXRoLmpvaW4oc2hhcmVkLmFnZW50c1Jvb3QsIEFHRU5UU19JTkRFWF9GSUxFKTtcblxuICBjb25zdCBwYXlsb2FkOiBBZ2VudHNJbmRleEZpbGUgPSB7XG4gICAgdmVyc2lvbjogJzEuMCcsXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgYWdlbnRzLFxuICB9O1xuXG4gIGF3YWl0IHdyaXRlSnNvbkZpbGUoaW5kZXhQYXRoLCBwYXlsb2FkKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdXBzZXJ0QWdlbnRzSW5kZXgocHJvZmlsZTogQWdlbnRQcm9maWxlLCBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgY3VycmVudCA9IGF3YWl0IHJlYWRBZ2VudHNJbmRleEZpbGUoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgbmV4dEl0ZW0gPSB0b0FnZW50SW5kZXhJdGVtKHByb2ZpbGUpO1xuXG4gIGlmICghY3VycmVudCkge1xuICAgIGF3YWl0IHdyaXRlQWdlbnRzSW5kZXhGaWxlKFtuZXh0SXRlbV0sIGhvbWVEaXJPdmVycmlkZSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgZXhpc3RlZCA9IGN1cnJlbnQuYWdlbnRzLnNvbWUoKGl0ZW0pID0+IGl0ZW0uYWdlbnRJZCA9PT0gcHJvZmlsZS5hZ2VudElkKTtcbiAgY29uc3QgbmV4dEFnZW50cyA9IGV4aXN0ZWRcbiAgICA/IGN1cnJlbnQuYWdlbnRzLm1hcCgoaXRlbSkgPT4gKGl0ZW0uYWdlbnRJZCA9PT0gcHJvZmlsZS5hZ2VudElkID8gbmV4dEl0ZW0gOiBpdGVtKSlcbiAgICA6IFsuLi5jdXJyZW50LmFnZW50cywgbmV4dEl0ZW1dO1xuXG4gIGF3YWl0IHdyaXRlQWdlbnRzSW5kZXhGaWxlKG5leHRBZ2VudHMsIGhvbWVEaXJPdmVycmlkZSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzYXZlQWdlbnRQcm9maWxlKGlucHV0OiBTYXZlQWdlbnRJbnB1dCk6IFByb21pc2U8U2F2ZUFnZW50UmVzdWx0PiB7XG4gIGNvbnN0IGFnZW50SWQgPSByZXNvbHZlQWdlbnRJZChpbnB1dCk7XG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgY29uc3Qgd29ya3NwYWNlID0gYXdhaXQgZW5zdXJlQWdlbnRXb3Jrc3BhY2UoYWdlbnRJZCwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgZXhpc3RpbmdQcm9maWxlUGF0aCA9IHBhdGguam9pbih3b3Jrc3BhY2UuYWdlbnRSb290LCBBR0VOVF9QUk9GSUxFX0ZJTEUpO1xuICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHJlYWRKc29uRmlsZTxBZ2VudFByb2ZpbGU+KGV4aXN0aW5nUHJvZmlsZVBhdGgpO1xuXG4gIGNvbnN0IHJ1bnRpbWVDb25maWcgPSBhd2FpdCBidWlsZEFnZW50UnVudGltZUNvbmZpZyh7XG4gICAgYWdlbnRJZCxcbiAgICBkaXNwbGF5TmFtZTogaW5wdXQubmFtZSxcbiAgICBwcm92aWRlcklkOiBpbnB1dC5kZWZhdWx0UHJvdmlkZXJJZCxcbiAgICBtb2RlbE5hbWU6IGlucHV0LmRlZmF1bHRNb2RlbE5hbWUsXG4gICAgc3lzdGVtUHJvbXB0OiBpbnB1dC5zeXN0ZW1Qcm9tcHQsXG4gICAgcHJpdmF0ZVNraWxsczogaW5wdXQucHJpdmF0ZVNraWxscyxcbiAgICBzaGFyZWRTa2lsbHM6IGlucHV0LnNoYXJlZFNraWxscyxcbiAgICBwcml2YXRlTWNwU2VydmVyczogaW5wdXQucHJpdmF0ZU1jcFNlcnZlcnMsXG4gICAgc2hhcmVkTWNwU2VydmVyczogaW5wdXQuc2hhcmVkTWNwU2VydmVycyxcbiAgICBob21lRGlyT3ZlcnJpZGU6IGlucHV0LmhvbWVEaXJPdmVycmlkZSxcbiAgfSk7XG5cbiAgY29uc3QgcnVudGltZUNvbmZpZ1BhdGggPSBhd2FpdCB3cml0ZUFnZW50UnVudGltZUNvbmZpZ0ZpbGUocnVudGltZUNvbmZpZywgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3Qgc3lzdGVtUHJvbXB0UGF0aCA9IHBhdGguam9pbih3b3Jrc3BhY2UuYWdlbnRSb290LCBBR0VOVF9QUk9NUFRfRklMRSk7XG4gIGF3YWl0IHdyaXRlRmlsZShzeXN0ZW1Qcm9tcHRQYXRoLCBpbnB1dC5zeXN0ZW1Qcm9tcHQsICd1dGYtOCcpO1xuXG4gIGNvbnN0IHByb2ZpbGU6IEFnZW50UHJvZmlsZSA9IHtcbiAgICB2ZXJzaW9uOiAnMS4wJyxcbiAgICBhZ2VudElkLFxuICAgIG5hbWU6IGlucHV0Lm5hbWUsXG4gICAgdGl0bGU6IGlucHV0LnRpdGxlLFxuICAgIHRhZ3M6IGlucHV0LnRhZ3MsXG4gICAgc3VtbWFyeTogaW5wdXQuc3VtbWFyeSxcbiAgICBzb3VsOiBpbnB1dC5zb3VsLFxuICAgIHN5c3RlbVByb21wdDogaW5wdXQuc3lzdGVtUHJvbXB0LFxuICAgIGRlZmF1bHRMbG06IHtcbiAgICAgIHByb3ZpZGVySWQ6IGlucHV0LmRlZmF1bHRQcm92aWRlcklkLFxuICAgICAgbW9kZWxOYW1lOiBpbnB1dC5kZWZhdWx0TW9kZWxOYW1lLFxuICAgIH0sXG4gICAgc2tpbGxzOiB7XG4gICAgICBwcml2YXRlU2tpbGxzOiBpbnB1dC5wcml2YXRlU2tpbGxzLFxuICAgICAgc2hhcmVkU2tpbGxzOiBpbnB1dC5zaGFyZWRTa2lsbHMsXG4gICAgfSxcbiAgICBtY3A6IHtcbiAgICAgIHByaXZhdGVTZXJ2ZXJzOiBpbnB1dC5wcml2YXRlTWNwU2VydmVycyxcbiAgICAgIHNoYXJlZFNlcnZlcnM6IGlucHV0LnNoYXJlZE1jcFNlcnZlcnMsXG4gICAgfSxcbiAgICBhcHBlYXJhbmNlOiB7XG4gICAgICBhdmF0YXJVcmw6IGlucHV0LmF2YXRhclVybCxcbiAgICAgIGNvbG9yOiBpbnB1dC5jb2xvcixcbiAgICB9LFxuICAgIHZvaWNlOiB7XG4gICAgICB0dHNNb2RlbDogaW5wdXQudHRzTW9kZWwsXG4gICAgICB0dHNWb2ljZTogaW5wdXQudHRzVm9pY2UsXG4gICAgICB0dHNTcGVlZDogaW5wdXQudHRzU3BlZWQsXG4gICAgICB0dHNQaXRjaDogaW5wdXQudHRzUGl0Y2gsXG4gICAgfSxcbiAgICBwYXRoczoge1xuICAgICAgYWdlbnRSb290OiB3b3Jrc3BhY2UuYWdlbnRSb290LFxuICAgICAgcHJpdmF0ZVNraWxsc1Jvb3Q6IHdvcmtzcGFjZS5wcml2YXRlU2tpbGxzUm9vdCxcbiAgICAgIHByaXZhdGVNY3BSb290OiB3b3Jrc3BhY2UucHJpdmF0ZU1jcFJvb3QsXG4gICAgICBwcml2YXRlRGF0YVJvb3Q6IHdvcmtzcGFjZS5wcml2YXRlRGF0YVJvb3QsXG4gICAgICBwcml2YXRlTG9nc1Jvb3Q6IHdvcmtzcGFjZS5wcml2YXRlTG9nc1Jvb3QsXG4gICAgICBwcm9maWxlUGF0aDogZXhpc3RpbmdQcm9maWxlUGF0aCxcbiAgICAgIHJ1bnRpbWVDb25maWdQYXRoLFxuICAgICAgc3lzdGVtUHJvbXB0UGF0aCxcbiAgICB9LFxuICAgIGNyZWF0ZWRBdDogZXhpc3Rpbmc/LmNyZWF0ZWRBdCA/PyBub3csXG4gICAgdXBkYXRlZEF0OiBub3csXG4gIH07XG5cbiAgYXdhaXQgd3JpdGVKc29uRmlsZShleGlzdGluZ1Byb2ZpbGVQYXRoLCBwcm9maWxlKTtcbiAgYXdhaXQgdXBzZXJ0QWdlbnRzSW5kZXgocHJvZmlsZSwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcblxuICByZXR1cm4ge1xuICAgIHByb2ZpbGUsXG4gICAgcnVudGltZUNvbmZpZyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEFnZW50UHJvZmlsZShpbnB1dDogR2V0QWdlbnRJbnB1dCk6IFByb21pc2U8QWdlbnRQcm9maWxlPiB7XG4gIGNvbnN0IHdvcmtzcGFjZSA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKGlucHV0LmFnZW50SWQsIGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IHByb2ZpbGVQYXRoID0gcGF0aC5qb2luKHdvcmtzcGFjZS5hZ2VudFJvb3QsIEFHRU5UX1BST0ZJTEVfRklMRSk7XG4gIGNvbnN0IHByb2ZpbGUgPSBhd2FpdCByZWFkSnNvbkZpbGU8QWdlbnRQcm9maWxlPihwcm9maWxlUGF0aCk7XG5cbiAgaWYgKCFwcm9maWxlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBcdTY2N0FcdTgwRkRcdTRGNTNcdTRFMERcdTVCNThcdTU3MjhcdUZGMUEke2lucHV0LmFnZW50SWR9YCk7XG4gIH1cblxuICByZXR1cm4gcHJvZmlsZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2NhbkFnZW50UHJvZmlsZXMoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxBZ2VudFByb2ZpbGVbXT4ge1xuICBjb25zdCBzaGFyZWQgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgZGlycyA9IGF3YWl0IHJlYWRkaXIoc2hhcmVkLmFnZW50c1Jvb3QsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgY29uc3QgcHJvZmlsZXM6IEFnZW50UHJvZmlsZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBkaXJzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBwcm9maWxlUGF0aCA9IHBhdGguam9pbihzaGFyZWQuYWdlbnRzUm9vdCwgZW50cnkubmFtZSwgQUdFTlRfUFJPRklMRV9GSUxFKTtcbiAgICBjb25zdCBwcm9maWxlID0gYXdhaXQgcmVhZEpzb25GaWxlPEFnZW50UHJvZmlsZT4ocHJvZmlsZVBhdGgpO1xuXG4gICAgaWYgKHByb2ZpbGUpIHtcbiAgICAgIHByb2ZpbGVzLnB1c2gocHJvZmlsZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHByb2ZpbGVzLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiByaWdodC51cGRhdGVkQXQubG9jYWxlQ29tcGFyZShsZWZ0LnVwZGF0ZWRBdCkpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdEFnZW50UHJvZmlsZXMoaW5wdXQ/OiBMaXN0QWdlbnRzSW5wdXQpOiBQcm9taXNlPHJlYWRvbmx5IEFnZW50UHJvZmlsZVtdPiB7XG4gIGNvbnN0IGluZGV4ID0gYXdhaXQgcmVhZEFnZW50c0luZGV4RmlsZShpbnB1dD8uaG9tZURpck92ZXJyaWRlKTtcblxuICBpZiAoIWluZGV4IHx8IGluZGV4LmFnZW50cy5sZW5ndGggPT09IDApIHtcbiAgICBjb25zdCBzY2FubmVkID0gYXdhaXQgc2NhbkFnZW50UHJvZmlsZXMoaW5wdXQ/LmhvbWVEaXJPdmVycmlkZSk7XG4gICAgaWYgKHNjYW5uZWQubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHNjYW5uZWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlZWREZWZhdWx0QWdlbnRzKGlucHV0Py5ob21lRGlyT3ZlcnJpZGUpO1xuICB9XG5cbiAgY29uc3QgcHJvZmlsZXM6IEFnZW50UHJvZmlsZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBpdGVtIG9mIGluZGV4LmFnZW50cykge1xuICAgIGNvbnN0IHByb2ZpbGUgPSBhd2FpdCByZWFkSnNvbkZpbGU8QWdlbnRQcm9maWxlPihpdGVtLnByb2ZpbGVQYXRoKTtcblxuICAgIGlmIChwcm9maWxlKSB7XG4gICAgICBwcm9maWxlcy5wdXNoKHByb2ZpbGUpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChwcm9maWxlcy5sZW5ndGggPT09IDApIHtcbiAgICBjb25zdCBzY2FubmVkID0gYXdhaXQgc2NhbkFnZW50UHJvZmlsZXMoaW5wdXQ/LmhvbWVEaXJPdmVycmlkZSk7XG4gICAgaWYgKHNjYW5uZWQubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHNjYW5uZWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlZWREZWZhdWx0QWdlbnRzKGlucHV0Py5ob21lRGlyT3ZlcnJpZGUpO1xuICB9XG5cbiAgcmV0dXJuIHByb2ZpbGVzLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiByaWdodC51cGRhdGVkQXQubG9jYWxlQ29tcGFyZShsZWZ0LnVwZGF0ZWRBdCkpO1xufVxuIiwgImltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5cbmltcG9ydCB7IGVuc3VyZUFnZW50V29ya3NwYWNlLCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UgfSBmcm9tICcuL3NoYXJlZC13b3Jrc3BhY2UtbWFuYWdlcic7XG5pbXBvcnQgdHlwZSB7IEFnZW50UnVudGltZUNvbmZpZywgQnVpbGRBZ2VudENvbmZpZ0lucHV0IH0gZnJvbSAnLi90eXBlcyc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBidWlsZEFnZW50UnVudGltZUNvbmZpZyhcbiAgaW5wdXQ6IEJ1aWxkQWdlbnRDb25maWdJbnB1dCxcbik6IFByb21pc2U8QWdlbnRSdW50aW1lQ29uZmlnPiB7XG4gIGNvbnN0IHNoYXJlZCA9IGF3YWl0IGVuc3VyZVNoYXJlZFdvcmtzcGFjZShpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBhZ2VudCA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKGlucHV0LmFnZW50SWQsIGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG5cbiAgcmV0dXJuIHtcbiAgICB2ZXJzaW9uOiAnMS4wJyxcbiAgICBhZ2VudElkOiBhZ2VudC5hZ2VudElkLFxuICAgIGRpc3BsYXlOYW1lOiBpbnB1dC5kaXNwbGF5TmFtZSxcbiAgICBnZW5lcmF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIG1vZGVsOiB7XG4gICAgICBwcm92aWRlcklkOiBpbnB1dC5wcm92aWRlcklkLFxuICAgICAgbW9kZWxOYW1lOiBpbnB1dC5tb2RlbE5hbWUsXG4gICAgfSxcbiAgICBwcm9tcHQ6IHtcbiAgICAgIHN5c3RlbVByb21wdDogaW5wdXQuc3lzdGVtUHJvbXB0LFxuICAgIH0sXG4gICAgcGF0aHM6IHtcbiAgICAgIHByaXZhdGVSb290OiBhZ2VudC5hZ2VudFJvb3QsXG4gICAgICBzaGFyZWRSb290OiBzaGFyZWQuc2hhcmVkUm9vdCxcbiAgICAgIHByaXZhdGVTa2lsbHNSb290OiBhZ2VudC5wcml2YXRlU2tpbGxzUm9vdCxcbiAgICAgIHByaXZhdGVNY3BSb290OiBhZ2VudC5wcml2YXRlTWNwUm9vdCxcbiAgICAgIHByaXZhdGVEYXRhUm9vdDogYWdlbnQucHJpdmF0ZURhdGFSb290LFxuICAgICAgcHJpdmF0ZUxvZ3NSb290OiBhZ2VudC5wcml2YXRlTG9nc1Jvb3QsXG4gICAgICBzaGFyZWRTa2lsbHNSb290OiBzaGFyZWQuc2hhcmVkU2tpbGxzUm9vdCxcbiAgICAgIHNoYXJlZE1jcFJvb3Q6IHNoYXJlZC5zaGFyZWRNY3BSb290LFxuICAgICAgc2hhcmVkRGF0YVJvb3Q6IHNoYXJlZC5zaGFyZWREYXRhUm9vdCxcbiAgICAgIHNoYXJlZE1lZGlhUm9vdDogc2hhcmVkLnNoYXJlZE1lZGlhUm9vdCxcbiAgICB9LFxuICAgIHNraWxsczoge1xuICAgICAgcHJpdmF0ZVNraWxsczogaW5wdXQucHJpdmF0ZVNraWxscyA/PyBbXSxcbiAgICAgIHNoYXJlZFNraWxsczogaW5wdXQuc2hhcmVkU2tpbGxzID8/IFtdLFxuICAgIH0sXG4gICAgbWNwOiB7XG4gICAgICBwcml2YXRlU2VydmVyczogaW5wdXQucHJpdmF0ZU1jcFNlcnZlcnMgPz8gW10sXG4gICAgICBzaGFyZWRTZXJ2ZXJzOiBpbnB1dC5zaGFyZWRNY3BTZXJ2ZXJzID8/IFtdLFxuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3cml0ZUFnZW50UnVudGltZUNvbmZpZ0ZpbGUoXG4gIGNvbmZpZzogQWdlbnRSdW50aW1lQ29uZmlnLFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4gIHRhcmdldEZpbGVQYXRoPzogc3RyaW5nLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgYWdlbnRXb3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVBZ2VudFdvcmtzcGFjZShjb25maWcuYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3Qgb3V0cHV0UGF0aCA9IHRhcmdldEZpbGVQYXRoID8/IHBhdGguam9pbihhZ2VudFdvcmtzcGFjZS5hZ2VudFJvb3QsICdhZ2VudC5jb25maWcuanNvbicpO1xuXG4gIGF3YWl0IG1rZGlyKHBhdGguZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGF3YWl0IHdyaXRlRmlsZShvdXRwdXRQYXRoLCBKU09OLnN0cmluZ2lmeShjb25maWcsIG51bGwsIDIpLCAndXRmLTgnKTtcblxuICByZXR1cm4gb3V0cHV0UGF0aDtcbn1cbiIsICJpbXBvcnQgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgbWtkaXIgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuaW1wb3J0IHR5cGUgeyBBZ2VudFdvcmtzcGFjZVBhdGhzLCBTaGFyZWRXb3Jrc3BhY2VQYXRocyB9IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBXRUJPVF9IT01FX0RJUl9OQU1FID0gJy53ZWJvdCc7XG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZURpcmVjdG9yeShkaXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgbWtkaXIoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUFnZW50SWQoYWdlbnRJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGFnZW50SWQudHJpbSgpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTktX10rL2csICctJyk7XG5cbiAgaWYgKG5vcm1hbGl6ZWQubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdcdTY2N0FcdTgwRkRcdTRGNTMgSUQgXHU5NzVFXHU2Q0Q1XHVGRjFBXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHU2MjE2XHU1MTY4XHU2NjJGXHU3Mjc5XHU2QjhBXHU1QjU3XHU3QjI2XHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVXZUJvdEhvbWVSb290KGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGhvbWVSb290ID0gaG9tZURpck92ZXJyaWRlID8/IG9zLmhvbWVkaXIoKTtcbiAgcmV0dXJuIHBhdGguam9pbihob21lUm9vdCwgV0VCT1RfSE9NRV9ESVJfTkFNRSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxTaGFyZWRXb3Jrc3BhY2VQYXRocz4ge1xuICBjb25zdCB3ZWJvdEhvbWVSb290ID0gcmVzb2x2ZVdlQm90SG9tZVJvb3QoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3Qgc2hhcmVkUm9vdCA9IHBhdGguam9pbih3ZWJvdEhvbWVSb290LCAnc2hhcmVkJyk7XG4gIGNvbnN0IGFnZW50c1Jvb3QgPSBwYXRoLmpvaW4od2Vib3RIb21lUm9vdCwgJ2FnZW50cycpO1xuICBjb25zdCB6ZXJvY2xhd1Jvb3QgPSBwYXRoLmpvaW4od2Vib3RIb21lUm9vdCwgJ3plcm9jbGF3Jyk7XG4gIGNvbnN0IHNoYXJlZFNraWxsc1Jvb3QgPSBwYXRoLmpvaW4oc2hhcmVkUm9vdCwgJ3NraWxscycpO1xuICBjb25zdCBzaGFyZWRNY3BSb290ID0gcGF0aC5qb2luKHNoYXJlZFJvb3QsICdtY3AnKTtcbiAgY29uc3Qgc2hhcmVkRGF0YVJvb3QgPSBwYXRoLmpvaW4oc2hhcmVkUm9vdCwgJ2RhdGEnKTtcbiAgY29uc3Qgc2hhcmVkTWVkaWFSb290ID0gcGF0aC5qb2luKHNoYXJlZFJvb3QsICdtZWRpYScpO1xuICBjb25zdCBzaGFyZWRNb2RlbHNSb290ID0gcGF0aC5qb2luKHNoYXJlZFJvb3QsICdtb2RlbHMnKTtcblxuICBhd2FpdCBlbnN1cmVEaXJlY3Rvcnkod2Vib3RIb21lUm9vdCk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShzaGFyZWRSb290KTtcbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KGFnZW50c1Jvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3RvcnkoemVyb2NsYXdSb290KTtcbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KHNoYXJlZFNraWxsc1Jvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3Rvcnkoc2hhcmVkTWNwUm9vdCk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShzaGFyZWREYXRhUm9vdCk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShzaGFyZWRNZWRpYVJvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3Rvcnkoc2hhcmVkTW9kZWxzUm9vdCk7XG5cbiAgcmV0dXJuIHtcbiAgICB3ZWJvdEhvbWVSb290LFxuICAgIHNoYXJlZFJvb3QsXG4gICAgYWdlbnRzUm9vdCxcbiAgICB6ZXJvY2xhd1Jvb3QsXG4gICAgc2hhcmVkU2tpbGxzUm9vdCxcbiAgICBzaGFyZWRNY3BSb290LFxuICAgIHNoYXJlZERhdGFSb290LFxuICAgIHNoYXJlZE1lZGlhUm9vdCxcbiAgICBzaGFyZWRNb2RlbHNSb290LFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5zdXJlQWdlbnRXb3Jrc3BhY2UoXG4gIGFnZW50SWQ6IHN0cmluZyxcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nLFxuKTogUHJvbWlzZTxBZ2VudFdvcmtzcGFjZVBhdGhzPiB7XG4gIGNvbnN0IHNoYXJlZCA9IGF3YWl0IGVuc3VyZVNoYXJlZFdvcmtzcGFjZShob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBub3JtYWxpemVkQWdlbnRJZCA9IG5vcm1hbGl6ZUFnZW50SWQoYWdlbnRJZCk7XG4gIGNvbnN0IGFnZW50Um9vdCA9IHBhdGguam9pbihzaGFyZWQuYWdlbnRzUm9vdCwgbm9ybWFsaXplZEFnZW50SWQpO1xuICBjb25zdCBwcml2YXRlU2tpbGxzUm9vdCA9IHBhdGguam9pbihhZ2VudFJvb3QsICdza2lsbHMnKTtcbiAgY29uc3QgcHJpdmF0ZU1jcFJvb3QgPSBwYXRoLmpvaW4oYWdlbnRSb290LCAnbWNwJyk7XG4gIGNvbnN0IHByaXZhdGVEYXRhUm9vdCA9IHBhdGguam9pbihhZ2VudFJvb3QsICdkYXRhJyk7XG4gIGNvbnN0IHByaXZhdGVMb2dzUm9vdCA9IHBhdGguam9pbihhZ2VudFJvb3QsICdsb2dzJyk7XG5cbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KGFnZW50Um9vdCk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShwcml2YXRlU2tpbGxzUm9vdCk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShwcml2YXRlTWNwUm9vdCk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShwcml2YXRlRGF0YVJvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3RvcnkocHJpdmF0ZUxvZ3NSb290KTtcblxuICByZXR1cm4ge1xuICAgIGFnZW50SWQ6IG5vcm1hbGl6ZWRBZ2VudElkLFxuICAgIGFnZW50Um9vdCxcbiAgICBwcml2YXRlU2tpbGxzUm9vdCxcbiAgICBwcml2YXRlTWNwUm9vdCxcbiAgICBwcml2YXRlRGF0YVJvb3QsXG4gICAgcHJpdmF0ZUxvZ3NSb290LFxuICB9O1xufVxuIiwgImltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHdyaXRlRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuXG5pbXBvcnQgeyBmaW5kTW9kZWxQcm92aWRlciB9IGZyb20gJy4vbW9kZWwtcHJvdmlkZXItY2F0YWxvZyc7XG5pbXBvcnQgeyBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UgfSBmcm9tICcuL3NoYXJlZC13b3Jrc3BhY2UtbWFuYWdlcic7XG5pbXBvcnQgdHlwZSB7XG4gIEJ1aWxkWmVyb0NsYXdDb25maWdJbnB1dCxcbiAgWmVyb0NsYXdDb25maWcsXG4gIFplcm9DbGF3TW9kZWxDYXRhbG9nSXRlbSxcbiAgWmVyb0NsYXdNb2RlbFByb3ZpZGVyQ29uZmlnLFxuICBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbixcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwXzAwMDtcbmNvbnN0IERFRkFVTFRfTUFYX1JFVFJJRVMgPSAyO1xuXG5jb25zdCBQUk9WSURFUl9JQ09OX01BUDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgb3BlbmFpOiAnT0EnLFxuICAnYXp1cmUtb3BlbmFpJzogJ0FPJyxcbiAgYW50aHJvcGljOiAnQU4nLFxuICAnZ29vZ2xlLWFpJzogJ0dBJyxcbiAgZGVlcHNlZWs6ICdEUycsXG4gIHF3ZW46ICdRVycsXG4gIG1vb25zaG90OiAnTVMnLFxuICB6aGlwdTogJ1pQJyxcbiAgYmFpY2h1YW46ICdCQycsXG4gIG1pbmltYXg6ICdNTScsXG4gICd2b2xjZW5naW5lLWFyayc6ICdWQScsXG4gIHNpbGljb25mbG93OiAnU0YnLFxuICB0b2dldGhlcjogJ1RHJyxcbiAgZmlyZXdvcmtzOiAnRlcnLFxuICBncm9xOiAnR1EnLFxuICBjb2hlcmU6ICdDSCcsXG4gIG1pc3RyYWw6ICdNUycsXG4gIHhhaTogJ1hBJyxcbiAgJ252aWRpYS1uaW0nOiAnTlYnLFxuICBvcGVucm91dGVyOiAnT1InLFxuICBwZXJwbGV4aXR5OiAnUFgnLFxuICBvbGxhbWE6ICdPTCcsXG4gIGxtc3R1ZGlvOiAnTE0nLFxuICB2bGxtOiAnVkwnLFxuICAnaHVnZ2luZ2ZhY2UtaW5mZXJlbmNlJzogJ0hGJyxcbiAgJ2F3cy1iZWRyb2NrJzogJ0FCJyxcbiAgJ2F6dXJlLWFpLWluZmVyZW5jZSc6ICdBSScsXG4gICdhbGliYWJhLWJhaWxpYW4nOiAnQUwnLFxufTtcblxuZnVuY3Rpb24gbm9ybWFsaXplUHJvdmlkZXJJZChwcm92aWRlcklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAocHJvdmlkZXJJZCA9PT0gJ252aWRpYScpIHtcbiAgICByZXR1cm4gJ252aWRpYS1uaW0nO1xuICB9XG5cbiAgcmV0dXJuIHByb3ZpZGVySWQ7XG59XG5cbmZ1bmN0aW9uIGluZmVyTW9kZWxJbWFnZUNhcGFiaWxpdHkobW9kZWxOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3QgbG93ZXIgPSBtb2RlbE5hbWUudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIGxvd2VyLmluY2x1ZGVzKCd2aXNpb24nKSB8fCBsb3dlci5pbmNsdWRlcygndmwnKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRQcm92aWRlckluaXRpYWxzKHByb3ZpZGVySWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBwcm92aWRlcklkLnRyaW0oKS5yZXBsYWNlKC9bXmEtejAtOV0rL2dpLCAnICcpO1xuICBjb25zdCBwYXJ0cyA9IG5vcm1hbGl6ZWQuc3BsaXQoL1xccysvKS5maWx0ZXIoQm9vbGVhbik7XG4gIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHJldHVybiAnQUknO1xuICBpZiAocGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHBhcnRzWzBdLnNsaWNlKDAsIDIpLnRvVXBwZXJDYXNlKCk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzXG4gICAgLm1hcCgocGFydCkgPT4gcGFydFswXT8udG9VcHBlckNhc2UoKSA/PyAnJylcbiAgICAuam9pbignJylcbiAgICAuc2xpY2UoMCwgMik7XG59XG5cbmZ1bmN0aW9uIGdldFByb3ZpZGVySWNvbihwcm92aWRlcklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gUFJPVklERVJfSUNPTl9NQVBbcHJvdmlkZXJJZF0gPz8gYnVpbGRQcm92aWRlckluaXRpYWxzKHByb3ZpZGVySWQpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVplcm9DbGF3Q29uZmlnUGF0aChob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBzaGFyZWQgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoaG9tZURpck92ZXJyaWRlKTtcbiAgcmV0dXJuIHBhdGguam9pbihzaGFyZWQuemVyb2NsYXdSb290LCAnemVyb2NsYXcuY29uZmlnLmpzb24nKTtcbn1cblxuZnVuY3Rpb24gYXNzZXJ0UHJvdmlkZXJJZHMocHJvdmlkZXJJZHM6IHJlYWRvbmx5IHN0cmluZ1tdKTogdm9pZCB7XG4gIGNvbnN0IHVua25vd25Qcm92aWRlcklkcyA9IHByb3ZpZGVySWRzLmZpbHRlcigocHJvdmlkZXJJZCkgPT4gIWZpbmRNb2RlbFByb3ZpZGVyKG5vcm1hbGl6ZVByb3ZpZGVySWQocHJvdmlkZXJJZCkpKTtcblxuICBpZiAodW5rbm93blByb3ZpZGVySWRzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFx1NUI1OFx1NTcyOFx1NjcyQVx1NzdFNVx1NkEyMVx1NTc4Qlx1NjcwRFx1NTJBMVx1NTU0NiBJRFx1RkYxQSR7dW5rbm93blByb3ZpZGVySWRzLmpvaW4oJywgJyl9YCk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJ1aWxkWmVyb0NsYXdDb25maWcoaW5wdXQ6IEJ1aWxkWmVyb0NsYXdDb25maWdJbnB1dCk6IFByb21pc2U8WmVyb0NsYXdDb25maWc+IHtcbiAgY29uc3Qgbm9ybWFsaXplZFByb3ZpZGVySWRzID1cbiAgICBpbnB1dC5lbmFibGVkUHJvdmlkZXJJZHMubGVuZ3RoID4gMFxuICAgICAgPyBpbnB1dC5lbmFibGVkUHJvdmlkZXJJZHMubWFwKChwcm92aWRlcklkKSA9PiBub3JtYWxpemVQcm92aWRlcklkKHByb3ZpZGVySWQpKVxuICAgICAgOiBbJ252aWRpYS1uaW0nXTtcblxuICBhc3NlcnRQcm92aWRlcklkcyhub3JtYWxpemVkUHJvdmlkZXJJZHMpO1xuXG4gIGNvbnN0IHNoYXJlZCA9IGF3YWl0IGVuc3VyZVNoYXJlZFdvcmtzcGFjZShpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBtb2RlbFByb3ZpZGVyczogWmVyb0NsYXdNb2RlbFByb3ZpZGVyQ29uZmlnW10gPSBub3JtYWxpemVkUHJvdmlkZXJJZHMubWFwKChwcm92aWRlcklkKSA9PiB7XG4gICAgY29uc3QgcHJvdmlkZXIgPSBmaW5kTW9kZWxQcm92aWRlcihwcm92aWRlcklkKTtcblxuICAgIGlmICghcHJvdmlkZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgXHU2NUUwXHU2Q0Q1XHU2MjdFXHU1MjMwXHU2QTIxXHU1NzhCXHU2NzBEXHU1MkExXHU1NTQ2XHVGRjFBJHtwcm92aWRlcklkfWApO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBpZDogcHJvdmlkZXIuaWQsXG4gICAgICBkaXNwbGF5TmFtZTogcHJvdmlkZXIuZGlzcGxheU5hbWUsXG4gICAgICBhcGlCYXNlOiBwcm92aWRlci5hcGlCYXNlLFxuICAgICAgYXBpS2V5RW52OiBwcm92aWRlci5hcGlLZXlFbnYsXG4gICAgICBtb2RlbHM6IHByb3ZpZGVyLmRlZmF1bHRNb2RlbHMsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgIH07XG4gIH0pO1xuXG4gIGNvbnN0IG1vZGVsQ2F0YWxvZzogWmVyb0NsYXdNb2RlbENhdGFsb2dJdGVtW10gPSBtb2RlbFByb3ZpZGVycy5mbGF0TWFwKChwcm92aWRlcikgPT5cbiAgICBwcm92aWRlci5tb2RlbHMubWFwKChtb2RlbE5hbWUpID0+ICh7XG4gICAgICBtb2RlbElkOiBgJHtwcm92aWRlci5pZH06JHttb2RlbE5hbWV9YCxcbiAgICAgIHByb3ZpZGVySWQ6IHByb3ZpZGVyLmlkLFxuICAgICAgbW9kZWxOYW1lLFxuICAgICAgZGlzcGxheU5hbWU6IG1vZGVsTmFtZSxcbiAgICAgIGNhcGFiaWxpdGllczoge1xuICAgICAgICB0ZXh0OiB0cnVlLFxuICAgICAgICBpbWFnZUlucHV0OiBpbmZlck1vZGVsSW1hZ2VDYXBhYmlsaXR5KG1vZGVsTmFtZSksXG4gICAgICAgIGltYWdlT3V0cHV0OiBmYWxzZSxcbiAgICAgICAgYXVkaW9JbnB1dDogZmFsc2UsXG4gICAgICAgIHRvb2xDYWxsOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgfSkpLFxuICApO1xuXG4gIGNvbnN0IHByb3ZpZGVyQ29ubmVjdGlvbnM6IFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uW10gPSBtb2RlbFByb3ZpZGVycy5tYXAoKHByb3ZpZGVyKSA9PiAoe1xuICAgIGNvbm5lY3Rpb25JZDogYGNvbm5fJHtwcm92aWRlci5pZH1fZGVmYXVsdGAsXG4gICAgcHJvdmlkZXJJZDogcHJvdmlkZXIuaWQsXG4gICAgZGlzcGxheU5hbWU6IHByb3ZpZGVyLmRpc3BsYXlOYW1lLFxuICAgIGljb246IGdldFByb3ZpZGVySWNvbihwcm92aWRlci5pZCksXG4gICAgYmFkZ2U6ICdhcGlfa2V5JyxcbiAgICBjb25uZWN0VHlwZTogJ2FwaV9rZXknLFxuICAgIGNhbkRpc2Nvbm5lY3Q6IHRydWUsXG4gICAgY29ubmVjdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBoZWFsdGg6ICd3YXJuaW5nJyxcbiAgICBhcGlCYXNlOiBwcm92aWRlci5hcGlCYXNlLFxuICAgIGFwaUtleU1hc2tlZDogdW5kZWZpbmVkLFxuICAgIGFwaUtleVBsYWludGV4dDogdW5kZWZpbmVkLFxuICAgIG1vZGVsRGlzY292ZXJ5OiB7XG4gICAgICBtb2RlOiAnZGVmYXVsdCcsXG4gICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHNvdXJjZTogJ2NhdGFsb2cnLFxuICAgIH0sXG4gIH0pKTtcblxuICBjb25zdCBwcmltYXJ5UHJvdmlkZXJJZCA9IG5vcm1hbGl6ZVByb3ZpZGVySWQoaW5wdXQucHJpbWFyeVByb3ZpZGVySWQgPz8gbm9ybWFsaXplZFByb3ZpZGVySWRzWzBdKTtcbiAgY29uc3QgZGVmYXVsdE1vZGVsSWQgPSBtb2RlbENhdGFsb2cuZmluZCgoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkID09PSBwcmltYXJ5UHJvdmlkZXJJZCk/Lm1vZGVsSWQ7XG5cbiAgcmV0dXJuIHtcbiAgICB2ZXJzaW9uOiAnMS4wJyxcbiAgICBnZW5lcmF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIHJ1bnRpbWU6IHtcbiAgICAgIHdvcmtzcGFjZVJvb3Q6IHNoYXJlZC53ZWJvdEhvbWVSb290LFxuICAgICAgc2hhcmVkUm9vdDogc2hhcmVkLnNoYXJlZFJvb3QsXG4gICAgICBhZ2VudHNSb290OiBzaGFyZWQuYWdlbnRzUm9vdCxcbiAgICB9LFxuICAgIGRlZmF1bHRzOiB7XG4gICAgICBwcmltYXJ5UHJvdmlkZXJJZCxcbiAgICAgIGRlZmF1bHRNb2RlbElkLFxuICAgICAgdGltZW91dE1zOiBpbnB1dC50aW1lb3V0TXMgPz8gREVGQVVMVF9USU1FT1VUX01TLFxuICAgICAgbWF4UmV0cmllczogaW5wdXQubWF4UmV0cmllcyA/PyBERUZBVUxUX01BWF9SRVRSSUVTLFxuICAgIH0sXG4gICAgbW9kZWxQcm92aWRlcnMsXG4gICAgcHJvdmlkZXJDb25uZWN0aW9ucyxcbiAgICBtb2RlbENhdGFsb2csXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkWmVyb0NsYXdDb25maWdGaWxlKFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4gIHRhcmdldEZpbGVQYXRoPzogc3RyaW5nLFxuKTogUHJvbWlzZTxaZXJvQ2xhd0NvbmZpZyB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCBjb25maWdQYXRoID0gdGFyZ2V0RmlsZVBhdGggPz8gKGF3YWl0IHJlc29sdmVaZXJvQ2xhd0NvbmZpZ1BhdGgoaG9tZURpck92ZXJyaWRlKSk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByYXcgPSBhd2FpdCByZWFkRmlsZShjb25maWdQYXRoLCAndXRmLTgnKTtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShyYXcpIGFzIFplcm9DbGF3Q29uZmlnO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmICdjb2RlJyBpbiBlcnJvciAmJiBlcnJvci5jb2RlID09PSAnRU5PRU5UJykge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5zdXJlWmVyb0NsYXdDb25maWcoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxaZXJvQ2xhd0NvbmZpZz4ge1xuICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHJlYWRaZXJvQ2xhd0NvbmZpZ0ZpbGUoaG9tZURpck92ZXJyaWRlKTtcblxuICBpZiAoZXhpc3RpbmcpIHtcbiAgICBjb25zdCBub3JtYWxpemVkQ29ubmVjdGlvbnMgPSBleGlzdGluZy5wcm92aWRlckNvbm5lY3Rpb25zLm1hcCgoY29ubmVjdGlvbikgPT4gKHtcbiAgICAgIC4uLmNvbm5lY3Rpb24sXG4gICAgICBhcGlCYXNlOiBjb25uZWN0aW9uLmFwaUJhc2UgPz8gJycsXG4gICAgICBtb2RlbERpc2NvdmVyeTogY29ubmVjdGlvbi5tb2RlbERpc2NvdmVyeSA/PyB7XG4gICAgICAgIG1vZGU6ICdkZWZhdWx0JyBhcyBjb25zdCxcbiAgICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHNvdXJjZTogJ2NhdGFsb2cnIGFzIGNvbnN0LFxuICAgICAgfSxcbiAgICB9KSk7XG5cbiAgICBjb25zdCBub3JtYWxpemVkOiBaZXJvQ2xhd0NvbmZpZyA9IHtcbiAgICAgIC4uLmV4aXN0aW5nLFxuICAgICAgZGVmYXVsdHM6IHtcbiAgICAgICAgLi4uZXhpc3RpbmcuZGVmYXVsdHMsXG4gICAgICAgIHByaW1hcnlQcm92aWRlcklkOiBleGlzdGluZy5kZWZhdWx0cy5wcmltYXJ5UHJvdmlkZXJJZCA/PyBleGlzdGluZy5tb2RlbFByb3ZpZGVyc1swXT8uaWQsXG4gICAgICAgIGRlZmF1bHRNb2RlbElkOlxuICAgICAgICAgIGV4aXN0aW5nLmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkID8/XG4gICAgICAgICAgZXhpc3RpbmcubW9kZWxDYXRhbG9nLmZpbmQoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCA9PT0gZXhpc3RpbmcuZGVmYXVsdHMucHJpbWFyeVByb3ZpZGVySWQpPy5tb2RlbElkLFxuICAgICAgfSxcbiAgICAgIHByb3ZpZGVyQ29ubmVjdGlvbnM6IG5vcm1hbGl6ZWRDb25uZWN0aW9ucyxcbiAgICB9O1xuXG4gICAgaWYgKEpTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWQpICE9PSBKU09OLnN0cmluZ2lmeShleGlzdGluZykpIHtcbiAgICAgIGF3YWl0IHdyaXRlWmVyb0NsYXdDb25maWdGaWxlKG5vcm1hbGl6ZWQsIGhvbWVEaXJPdmVycmlkZSk7XG4gICAgfVxuXG4gICAgaWYgKG5vcm1hbGl6ZWQubW9kZWxQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICBjb25zdCByZWJ1aWx0ID0gYXdhaXQgYnVpbGRaZXJvQ2xhd0NvbmZpZyh7XG4gICAgICAgIGVuYWJsZWRQcm92aWRlcklkczogWydudmlkaWEtbmltJ10sXG4gICAgICAgIHByaW1hcnlQcm92aWRlcklkOiAnbnZpZGlhLW5pbScsXG4gICAgICAgIGhvbWVEaXJPdmVycmlkZSxcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgd3JpdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUocmVidWlsdCwgaG9tZURpck92ZXJyaWRlKTtcbiAgICAgIHJldHVybiByZWJ1aWx0O1xuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkO1xuICB9XG5cbiAgY29uc3QgaW5pdGlhbCA9IGF3YWl0IGJ1aWxkWmVyb0NsYXdDb25maWcoe1xuICAgIGVuYWJsZWRQcm92aWRlcklkczogW10sXG4gICAgaG9tZURpck92ZXJyaWRlLFxuICB9KTtcbiAgYXdhaXQgd3JpdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUoaW5pdGlhbCwgaG9tZURpck92ZXJyaWRlKTtcblxuICByZXR1cm4gaW5pdGlhbDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdyaXRlWmVyb0NsYXdDb25maWdGaWxlKFxuICBjb25maWc6IFplcm9DbGF3Q29uZmlnLFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4gIHRhcmdldEZpbGVQYXRoPzogc3RyaW5nLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IG91dHB1dFBhdGggPSB0YXJnZXRGaWxlUGF0aCA/PyBwYXRoLmpvaW4oc2hhcmVkLnplcm9jbGF3Um9vdCwgJ3plcm9jbGF3LmNvbmZpZy5qc29uJyk7XG5cbiAgYXdhaXQgbWtkaXIocGF0aC5kaXJuYW1lKG91dHB1dFBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgYXdhaXQgd3JpdGVGaWxlKG91dHB1dFBhdGgsIEpTT04uc3RyaW5naWZ5KGNvbmZpZywgbnVsbCwgMiksICd1dGYtOCcpO1xuXG4gIHJldHVybiBvdXRwdXRQYXRoO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBkYXRlWmVyb0NsYXdDb25maWdGaWxlKFxuICB1cGRhdGVyOiAoY3VycmVudDogWmVyb0NsYXdDb25maWcpID0+IFplcm9DbGF3Q29uZmlnLFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4pOiBQcm9taXNlPFplcm9DbGF3Q29uZmlnPiB7XG4gIGNvbnN0IGN1cnJlbnQgPSBhd2FpdCBlbnN1cmVaZXJvQ2xhd0NvbmZpZyhob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBuZXh0ID0gdXBkYXRlcihjdXJyZW50KTtcblxuICBhd2FpdCB3cml0ZVplcm9DbGF3Q29uZmlnRmlsZShcbiAgICB7XG4gICAgICAuLi5uZXh0LFxuICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB9LFxuICAgIGhvbWVEaXJPdmVycmlkZSxcbiAgKTtcblxuICByZXR1cm4gbmV4dDtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IE1vZGVsUHJvdmlkZXJUZW1wbGF0ZSB9IGZyb20gJy4vdHlwZXMnO1xuXG4vKipcbiAqIFplcm9DbGF3IFx1NjUyRlx1NjMwMVx1NzY4NFx1NkEyMVx1NTc4Qlx1NjcwRFx1NTJBMVx1NTU0Nlx1NzZFRVx1NUY1NVx1RkYwOFx1NTE3MSAyOCBcdTVCQjZcdUZGMDlcbiAqL1xuZXhwb3J0IGNvbnN0IE1PREVMX1BST1ZJREVSX0NBVEFMT0c6IHJlYWRvbmx5IE1vZGVsUHJvdmlkZXJUZW1wbGF0ZVtdID0gW1xuICB7XG4gICAgaWQ6ICdvcGVuYWknLFxuICAgIGRpc3BsYXlOYW1lOiAnT3BlbkFJJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MScsXG4gICAgZGVmYXVsdE1vZGVsczogWydncHQtNG8nLCAnZ3B0LTQuMSddLFxuICAgIGFwaUtleUVudjogJ09QRU5BSV9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnYXp1cmUtb3BlbmFpJyxcbiAgICBkaXNwbGF5TmFtZTogJ0F6dXJlIE9wZW5BSScsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8ve3Jlc291cmNlfS5vcGVuYWkuYXp1cmUuY29tL29wZW5haS9kZXBsb3ltZW50cy97ZGVwbG95bWVudH0nLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZ3B0LTRvJywgJ2dwdC00LjEnXSxcbiAgICBhcGlLZXlFbnY6ICdBWlVSRV9PUEVOQUlfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2FudGhyb3BpYycsXG4gICAgZGlzcGxheU5hbWU6ICdBbnRocm9waWMnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS5hbnRocm9waWMuY29tL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2NsYXVkZS1vcHVzLTQtMScsICdjbGF1ZGUtc29ubmV0LTQnXSxcbiAgICBhcGlLZXlFbnY6ICdBTlRIUk9QSUNfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2dvb2dsZS1haScsXG4gICAgZGlzcGxheU5hbWU6ICdHb29nbGUgQUknLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2dlbmVyYXRpdmVsYW5ndWFnZS5nb29nbGVhcGlzLmNvbS92MWJldGEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZ2VtaW5pLTIuNS1wcm8nLCAnZ2VtaW5pLTIuMC1mbGFzaCddLFxuICAgIGFwaUtleUVudjogJ0dPT0dMRV9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnZGVlcHNlZWsnLFxuICAgIGRpc3BsYXlOYW1lOiAnRGVlcFNlZWsnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS5kZWVwc2Vlay5jb20vdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZGVlcHNlZWstY2hhdCcsICdkZWVwc2Vlay1yZWFzb25lciddLFxuICAgIGFwaUtleUVudjogJ0RFRVBTRUVLX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICdxd2VuJyxcbiAgICBkaXNwbGF5TmFtZTogJ1F3ZW4nLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2Rhc2hzY29wZS5hbGl5dW5jcy5jb20vY29tcGF0aWJsZS1tb2RlL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ3F3ZW4tbWF4JywgJ3F3ZW4tcGx1cyddLFxuICAgIGFwaUtleUVudjogJ1FXRU5fQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ21vb25zaG90JyxcbiAgICBkaXNwbGF5TmFtZTogJ01vb25zaG90JyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkubW9vbnNob3QuY24vdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnbW9vbnNob3QtdjEtMTI4aycsICdraW1pLWsyLWluc3RydWN0J10sXG4gICAgYXBpS2V5RW52OiAnTU9PTlNIT1RfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ3poaXB1JyxcbiAgICBkaXNwbGF5TmFtZTogJ1poaXB1IEFJJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9vcGVuLmJpZ21vZGVsLmNuL2FwaS9wYWFzL3Y0JyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2dsbS00LjUnLCAnZ2xtLTQtYWlyJ10sXG4gICAgYXBpS2V5RW52OiAnWkhJUFVfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2JhaWNodWFuJyxcbiAgICBkaXNwbGF5TmFtZTogJ0JhaWNodWFuJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkuYmFpY2h1YW4tYWkuY29tL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ0JhaWNodWFuNC1UdXJibycsICdCYWljaHVhbjQtQWlyJ10sXG4gICAgYXBpS2V5RW52OiAnQkFJQ0hVQU5fQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ21pbmltYXgnLFxuICAgIGRpc3BsYXlOYW1lOiAnTWluaU1heCcsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vYXBpLm1pbmltYXguY2hhdC92MScsXG4gICAgZGVmYXVsdE1vZGVsczogWydNaW5pTWF4LU0xJywgJ2FiYWI2LjVzLWNoYXQnXSxcbiAgICBhcGlLZXlFbnY6ICdNSU5JTUFYX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICd2b2xjZW5naW5lLWFyaycsXG4gICAgZGlzcGxheU5hbWU6ICdWb2xjZW5naW5lIEFyaycsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vYXJrLmNuLWJlaWppbmcudm9sY2VzLmNvbS9hcGkvdjMnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZG91YmFvLXByby0zMmsnLCAnZG91YmFvLXNlZWQtMS42J10sXG4gICAgYXBpS2V5RW52OiAnVk9MQ0VOR0lORV9BUktfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ3NpbGljb25mbG93JyxcbiAgICBkaXNwbGF5TmFtZTogJ1NpbGljb25GbG93JyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkuc2lsaWNvbmZsb3cuY24vdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZGVlcHNlZWstYWkvRGVlcFNlZWstUjEnLCAnUXdlbi9Rd2VuMy0yMzVCLUEyMkInXSxcbiAgICBhcGlLZXlFbnY6ICdTSUxJQ09ORkxPV19BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAndG9nZXRoZXInLFxuICAgIGRpc3BsYXlOYW1lOiAnVG9nZXRoZXIgQUknLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS50b2dldGhlci54eXovdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnbWV0YS1sbGFtYS9MbGFtYS0zLjMtNzBCLUluc3RydWN0LVR1cmJvJywgJ1F3ZW4vUXdlbjIuNS03MkItSW5zdHJ1Y3QtVHVyYm8nXSxcbiAgICBhcGlLZXlFbnY6ICdUT0dFVEhFUl9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnZmlyZXdvcmtzJyxcbiAgICBkaXNwbGF5TmFtZTogJ0ZpcmV3b3JrcyBBSScsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vYXBpLmZpcmV3b3Jrcy5haS9pbmZlcmVuY2UvdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnYWNjb3VudHMvZmlyZXdvcmtzL21vZGVscy9sbGFtYS12M3AxLTcwYi1pbnN0cnVjdCcsICdhY2NvdW50cy9maXJld29ya3MvbW9kZWxzL3F3ZW4zLTIzNWItYTIyYiddLFxuICAgIGFwaUtleUVudjogJ0ZJUkVXT1JLU19BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnZ3JvcScsXG4gICAgZGlzcGxheU5hbWU6ICdHcm9xJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkuZ3JvcS5jb20vb3BlbmFpL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2xsYW1hLTMuMy03MGItdmVyc2F0aWxlJywgJ3F3ZW4tcXdxLTMyYiddLFxuICAgIGFwaUtleUVudjogJ0dST1FfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2NvaGVyZScsXG4gICAgZGlzcGxheU5hbWU6ICdDb2hlcmUnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS5jb2hlcmUuY29tL3YyJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2NvbW1hbmQtYS0wMy0yMDI1JywgJ2NvbW1hbmQtci1wbHVzJ10sXG4gICAgYXBpS2V5RW52OiAnQ09IRVJFX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICdtaXN0cmFsJyxcbiAgICBkaXNwbGF5TmFtZTogJ01pc3RyYWwnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS5taXN0cmFsLmFpL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ21pc3RyYWwtbGFyZ2UtbGF0ZXN0JywgJ2NvZGVzdHJhbC1sYXRlc3QnXSxcbiAgICBhcGlLZXlFbnY6ICdNSVNUUkFMX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICd4YWknLFxuICAgIGRpc3BsYXlOYW1lOiAneEFJJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkueC5haS92MScsXG4gICAgZGVmYXVsdE1vZGVsczogWydncm9rLTMtbGF0ZXN0JywgJ2dyb2stMy1taW5pLWxhdGVzdCddLFxuICAgIGFwaUtleUVudjogJ1hBSV9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnbnZpZGlhLW5pbScsXG4gICAgZGlzcGxheU5hbWU6ICdOVklESUEgTklNJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9pbnRlZ3JhdGUuYXBpLm52aWRpYS5jb20vdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnbWV0YS9sbGFtYS0zLjEtNzBiLWluc3RydWN0JywgJ21pc3RyYWxhaS9taXN0cmFsLW5lbW8taW5zdHJ1Y3QnXSxcbiAgICBhcGlLZXlFbnY6ICdOVklESUFfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ29wZW5yb3V0ZXInLFxuICAgIGRpc3BsYXlOYW1lOiAnT3BlblJvdXRlcicsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vb3BlbnJvdXRlci5haS9hcGkvdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnb3BlbmFpL2dwdC00bycsICdhbnRocm9waWMvY2xhdWRlLXNvbm5ldC00J10sXG4gICAgYXBpS2V5RW52OiAnT1BFTlJPVVRFUl9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAncGVycGxleGl0eScsXG4gICAgZGlzcGxheU5hbWU6ICdQZXJwbGV4aXR5JyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkucGVycGxleGl0eS5haScsXG4gICAgZGVmYXVsdE1vZGVsczogWydzb25hci1wcm8nLCAnc29uYXItcmVhc29uaW5nLXBybyddLFxuICAgIGFwaUtleUVudjogJ1BFUlBMRVhJVFlfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ29sbGFtYScsXG4gICAgZGlzcGxheU5hbWU6ICdPbGxhbWEnLFxuICAgIGFwaUJhc2U6ICdodHRwOi8vMTI3LjAuMC4xOjExNDM0L3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ3F3ZW4yLjU6MzJiJywgJ2xsYW1hMy4zOjcwYiddLFxuICAgIGFwaUtleUVudjogJ09MTEFNQV9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnbG1zdHVkaW8nLFxuICAgIGRpc3BsYXlOYW1lOiAnTE0gU3R1ZGlvJyxcbiAgICBhcGlCYXNlOiAnaHR0cDovLzEyNy4wLjAuMToxMjM0L3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2xvY2FsLW1vZGVsJywgJ3F3ZW4yLjUtY29kZXItMzJiJ10sXG4gICAgYXBpS2V5RW52OiAnTE1TVFVESU9fQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ3ZsbG0nLFxuICAgIGRpc3BsYXlOYW1lOiAndkxMTSBPcGVuQUknLFxuICAgIGFwaUJhc2U6ICdodHRwOi8vMTI3LjAuMC4xOjgwMDAvdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnUXdlbi9Rd2VuMy0zMkInLCAnZGVlcHNlZWstYWkvRGVlcFNlZWstUjEtRGlzdGlsbC1Rd2VuLTMyQiddLFxuICAgIGFwaUtleUVudjogJ1ZMTE1fQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2h1Z2dpbmdmYWNlLWluZmVyZW5jZScsXG4gICAgZGlzcGxheU5hbWU6ICdIdWdnaW5nRmFjZSBJbmZlcmVuY2UnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL3JvdXRlci5odWdnaW5nZmFjZS5jby92MScsXG4gICAgZGVmYXVsdE1vZGVsczogWydtZXRhLWxsYW1hL0xsYW1hLTMuMy03MEItSW5zdHJ1Y3QnLCAnUXdlbi9Rd2VuMi41LUNvZGVyLTMyQi1JbnN0cnVjdCddLFxuICAgIGFwaUtleUVudjogJ0hVR0dJTkdGQUNFX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICdhd3MtYmVkcm9jaycsXG4gICAgZGlzcGxheU5hbWU6ICdBV1MgQmVkcm9jaycsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vYmVkcm9jay1ydW50aW1lLntyZWdpb259LmFtYXpvbmF3cy5jb20nLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnYW50aHJvcGljLmNsYXVkZS0zLTctc29ubmV0JywgJ2FtYXpvbi5ub3ZhLXByby12MTowJ10sXG4gICAgYXBpS2V5RW52OiAnQVdTX0JFRFJPQ0tfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2F6dXJlLWFpLWluZmVyZW5jZScsXG4gICAgZGlzcGxheU5hbWU6ICdBenVyZSBBSSBJbmZlcmVuY2UnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL3tyZXNvdXJjZX0uc2VydmljZXMuYWkuYXp1cmUuY29tL21vZGVscycsXG4gICAgZGVmYXVsdE1vZGVsczogWydncHQtNG8nLCAncGhpLTQnXSxcbiAgICBhcGlLZXlFbnY6ICdBWlVSRV9BSV9JTkZFUkVOQ0VfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2FsaWJhYmEtYmFpbGlhbicsXG4gICAgZGlzcGxheU5hbWU6ICdBbGliYWJhIEJhaWxpYW4nLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2Rhc2hzY29wZS5hbGl5dW5jcy5jb20vYXBpL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ3F3ZW4tbWF4LWxhdGVzdCcsICdxd2VuLXBsdXMtbGF0ZXN0J10sXG4gICAgYXBpS2V5RW52OiAnQUxJQkFCQV9CQUlMSUFOX0FQSV9LRVknLFxuICB9LFxuXSBhcyBjb25zdDtcblxuY29uc3QgTU9ERUxfUFJPVklERVJfTUFQID0gbmV3IE1hcDxzdHJpbmcsIE1vZGVsUHJvdmlkZXJUZW1wbGF0ZT4oXG4gIE1PREVMX1BST1ZJREVSX0NBVEFMT0cubWFwKChwcm92aWRlcikgPT4gW3Byb3ZpZGVyLmlkLCBwcm92aWRlcl0pLFxuKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGdldE1vZGVsUHJvdmlkZXJDYXRhbG9nKCk6IHJlYWRvbmx5IE1vZGVsUHJvdmlkZXJUZW1wbGF0ZVtdIHtcbiAgcmV0dXJuIE1PREVMX1BST1ZJREVSX0NBVEFMT0c7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTdXBwb3J0ZWRQcm92aWRlckNvdW50KCk6IG51bWJlciB7XG4gIHJldHVybiBNT0RFTF9QUk9WSURFUl9DQVRBTE9HLmxlbmd0aDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRNb2RlbFByb3ZpZGVyKHByb3ZpZGVySWQ6IHN0cmluZyk6IE1vZGVsUHJvdmlkZXJUZW1wbGF0ZSB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBNT0RFTF9QUk9WSURFUl9NQVAuZ2V0KHByb3ZpZGVySWQpO1xufVxuIiwgImltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjcmVhdGVXcml0ZVN0cmVhbSB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgbWtkaXIsIHJlYWRGaWxlLCByZWFkZGlyLCBzdGF0LCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IHNwYXduLCBzcGF3blN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuXG5pbXBvcnQgeyBjcmVhdGVSZXF1aXJlIH0gZnJvbSAnbm9kZTptb2R1bGUnO1xuY29uc3QgcmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xuXG5pbXBvcnQgeyBlbnN1cmVaZXJvQ2xhd0NvbmZpZyB9IGZyb20gJy4vemVyb2NsYXctY29uZmlnLW1hbmFnZXInO1xuaW1wb3J0IHsgZW5zdXJlQWdlbnRXb3Jrc3BhY2UsIGVuc3VyZVNoYXJlZFdvcmtzcGFjZSB9IGZyb20gJy4vc2hhcmVkLXdvcmtzcGFjZS1tYW5hZ2VyJztcbmltcG9ydCB7IGdldEFnZW50UHJvZmlsZSB9IGZyb20gJy4vYWdlbnQtcHJvZmlsZS1zZXJ2aWNlJztcbmltcG9ydCB0eXBlIHtcbiAgQWdlbnRQcm9maWxlLFxuICBBZ2VudFJ1bnRpbWVTdGF0dXMsXG4gIEFnZW50TG9nVGFpbCxcbiAgU3RhcnRBZ2VudElucHV0LFxuICBTdGFydEFnZW50UmVzdWx0LFxuICBTdG9wQWdlbnRJbnB1dCxcbiAgU3RvcEFnZW50UmVzdWx0LFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgTWNwU2VydmVyQ29uZmlnIH0gZnJvbSAnLi9za2lsbHMtbWNwLXR5cGVzJztcblxuY29uc3QgU0tJTExfRklMRV9DQU5ESURBVEVTID0gWydTS0lMTFMubWQnLCAnU0tJTEwubWQnLCAnc2tpbGxzLm1kJywgJ3NraWxsLm1kJ10gYXMgY29uc3Q7XG5jb25zdCBNRU1PUllfU1VNTUFSWV9GSUxFID0gJ21lbW9yeS1zdW1tYXJ5Lm1kJztcbmNvbnN0IENPTlRFWFRfRklMRV9OQU1FID0gJ2FnZW50LmNvbnRleHQubWQnO1xuY29uc3QgQ09OVEVYVF9KU09OX0ZJTEUgPSAnYWdlbnQuY29udGV4dC5qc29uJztcbmNvbnN0IFpFUk9DTE9XX0xPR19ESVIgPSAnemVyb2NsYXcnO1xuXG50eXBlIFByb2Nlc3NFbnRyeSA9IHtcbiAgc3RhdHVzOiBBZ2VudFJ1bnRpbWVTdGF0dXNbJ3N0YXR1cyddO1xuICBwaWQ/OiBudW1iZXI7XG4gIHN0YXJ0ZWRBdD86IHN0cmluZztcbiAgcHJvY2Vzcz86IFJldHVyblR5cGU8dHlwZW9mIHNwYXduPjtcbiAgbWVzc2FnZT86IHN0cmluZztcbiAgbG9nUGF0aD86IHN0cmluZztcbiAgbGFzdE91dHB1dEF0Pzogc3RyaW5nO1xufTtcblxuY29uc3QgYWdlbnRQcm9jZXNzZXMgPSBuZXcgTWFwPHN0cmluZywgUHJvY2Vzc0VudHJ5PigpO1xuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlWmVyb0NsYXdFeGVjdXRhYmxlKCk6IFByb21pc2U8e1xuICBleGVjdXRhYmxlUGF0aDogc3RyaW5nIHwgbnVsbDtcbiAgdHJpZWQ6IHN0cmluZ1tdO1xufT4ge1xuICBjb25zdCBhcHBSb290ID0gYXBwLmdldEFwcFBhdGgoKTtcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICBwYXRoLmpvaW4oYXBwUm9vdCwgJy4uJywgJ3plcm9jbGF3JywgJ3plcm9jbGF3LmV4ZScpLFxuICAgIHBhdGguam9pbihhcHBSb290LCAnemVyb2NsYXcnLCAnemVyb2NsYXcuZXhlJyksXG4gICAgcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksICcuLicsICd6ZXJvY2xhdycsICd6ZXJvY2xhdy5leGUnKSxcbiAgICBwYXRoLmpvaW4ocHJvY2Vzcy5yZXNvdXJjZXNQYXRoID8/ICcnLCAnemVyb2NsYXcnLCAnemVyb2NsYXcuZXhlJyksXG4gIF07XG5cbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgIGlmIChjYW5kaWRhdGUgJiYgKGF3YWl0IGZpbGVFeGlzdHMoY2FuZGlkYXRlKSkpIHtcbiAgICAgIHJldHVybiB7IGV4ZWN1dGFibGVQYXRoOiBjYW5kaWRhdGUsIHRyaWVkOiBjYW5kaWRhdGVzIH07XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHsgZXhlY3V0YWJsZVBhdGg6IG51bGwsIHRyaWVkOiBjYW5kaWRhdGVzIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbGVFeGlzdHModGFyZ2V0UGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgaW5mbyA9IGF3YWl0IHN0YXQodGFyZ2V0UGF0aCk7XG4gICAgcmV0dXJuIGluZm8uaXNGaWxlKCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBlbnN1cmVEaXJlY3RvcnkoZGlyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IG1rZGlyKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xufVxuXG5mdW5jdGlvbiB0b0xvZ0ZpbGVOYW1lKCk6IHN0cmluZyB7XG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gIGNvbnN0IHBhZCA9IChudW06IG51bWJlcikgPT4gU3RyaW5nKG51bSkucGFkU3RhcnQoMiwgJzAnKTtcbiAgcmV0dXJuIGB6ZXJvY2xhdy0ke25vdy5nZXRGdWxsWWVhcigpfSR7cGFkKG5vdy5nZXRNb250aCgpICsgMSl9JHtwYWQobm93LmdldERhdGUoKSl9LSR7cGFkKFxuICAgIG5vdy5nZXRIb3VycygpLFxuICApfSR7cGFkKG5vdy5nZXRNaW51dGVzKCkpfSR7cGFkKG5vdy5nZXRTZWNvbmRzKCkpfS5sb2dgO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVaZXJvQ2xhd0xvZ1N0cmVhbShhZ2VudElkOiBzdHJpbmcsIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IFByb21pc2U8e1xuICBsb2dQYXRoOiBzdHJpbmc7XG4gIHN0cmVhbTogUmV0dXJuVHlwZTx0eXBlb2YgY3JlYXRlV3JpdGVTdHJlYW0+O1xufT4ge1xuICBjb25zdCB3b3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVBZ2VudFdvcmtzcGFjZShhZ2VudElkLCBob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBsb2dEaXIgPSBwYXRoLmpvaW4od29ya3NwYWNlLnByaXZhdGVMb2dzUm9vdCwgWkVST0NMT1dfTE9HX0RJUik7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShsb2dEaXIpO1xuICBjb25zdCBsb2dQYXRoID0gcGF0aC5qb2luKGxvZ0RpciwgdG9Mb2dGaWxlTmFtZSgpKTtcbiAgY29uc3Qgc3RyZWFtID0gY3JlYXRlV3JpdGVTdHJlYW0obG9nUGF0aCwgeyBmbGFnczogJ2EnIH0pO1xuICByZXR1cm4geyBsb2dQYXRoLCBzdHJlYW0gfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VGcm9udG1hdHRlcihjb250ZW50OiBzdHJpbmcpOiB7IG5hbWU/OiBzdHJpbmc7IGRlc2NyaXB0aW9uPzogc3RyaW5nIH0ge1xuICBjb25zdCBtYXRjaCA9IGNvbnRlbnQubWF0Y2goL14tLS1cXHMqKFtcXHNcXFNdKj8pXFxzKi0tLS8pO1xuICBpZiAoIW1hdGNoKSByZXR1cm4ge307XG4gIGNvbnN0IGxpbmVzID0gbWF0Y2hbMV0uc3BsaXQoJ1xcbicpO1xuICBjb25zdCBtZXRhZGF0YTogeyBuYW1lPzogc3RyaW5nOyBkZXNjcmlwdGlvbj86IHN0cmluZyB9ID0ge307XG5cbiAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgZW50cnkgPSB0cmltbWVkLm1hdGNoKC9eKFxcdyspOlxccyooLispJC8pO1xuICAgIGlmICghZW50cnkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIGtleSwgdmFsdWVdID0gZW50cnk7XG4gICAgaWYgKGtleSA9PT0gJ25hbWUnKSBtZXRhZGF0YS5uYW1lID0gdmFsdWU7XG4gICAgaWYgKGtleSA9PT0gJ2Rlc2NyaXB0aW9uJykgbWV0YWRhdGEuZGVzY3JpcHRpb24gPSB2YWx1ZTtcbiAgfVxuXG4gIHJldHVybiBtZXRhZGF0YTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZFNraWxsU3VtbWFyeShza2lsbFJvb3Q6IHN0cmluZyk6IFByb21pc2U8eyBuYW1lOiBzdHJpbmc7IGRlc2NyaXB0aW9uOiBzdHJpbmcgfSB8IG51bGw+IHtcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgU0tJTExfRklMRV9DQU5ESURBVEVTKSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oc2tpbGxSb290LCBjYW5kaWRhdGUpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgcmVhZEZpbGUoZmlsZVBhdGgsICd1dGYtOCcpO1xuICAgICAgY29uc3QgbWV0YWRhdGEgPSBwYXJzZUZyb250bWF0dGVyKGNvbnRlbnQpO1xuICAgICAgY29uc3QgbGluZXMgPSBjb250ZW50XG4gICAgICAgIC5zcGxpdCgvXFxyP1xcbi8pXG4gICAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgY29uc3QgdGl0bGUgPSBtZXRhZGF0YS5uYW1lID8/IChsaW5lcy5maW5kKChsaW5lKSA9PiBsaW5lLnN0YXJ0c1dpdGgoJyMnKSk/LnJlcGxhY2UoL14jK1xccyovLCAnJykgPz8gJycpO1xuICAgICAgY29uc3QgZGVzY3JpcHRpb24gPVxuICAgICAgICBtZXRhZGF0YS5kZXNjcmlwdGlvbiA/P1xuICAgICAgICBsaW5lcy5maW5kKChsaW5lKSA9PiBsaW5lICYmICFsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgPz9cbiAgICAgICAgJ1x1NjcyQVx1NTg2Qlx1NTE5OVx1NjNDRlx1OEZGMCc7XG5cbiAgICAgIGlmICghdGl0bGUpIHJldHVybiBudWxsO1xuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBuYW1lOiB0aXRsZSxcbiAgICAgICAgZGVzY3JpcHRpb24sXG4gICAgICB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gaWdub3JlXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRNY3BTZXJ2ZXJzRnJvbUZpbGUoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8TWNwU2VydmVyQ29uZmlnW10+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByYXcgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04Jyk7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHVua25vd247XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGFyc2VkKSkge1xuICAgICAgcmV0dXJuIHBhcnNlZC5maWx0ZXIoKGl0ZW0pOiBpdGVtIGlzIE1jcFNlcnZlckNvbmZpZyA9PiB0eXBlb2YgaXRlbSA9PT0gJ29iamVjdCcgJiYgaXRlbSAhPT0gbnVsbCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGJ1aWxkTWVtb3J5U25hcHNob3QoYWdlbnRJZDogc3RyaW5nLCBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPHtcbiAgbDE6IHN0cmluZztcbiAgbDI6IHN0cmluZztcbiAgbDM6IHN0cmluZztcbiAgbDQ6IHN0cmluZ1tdO1xufT4ge1xuICBjb25zdCB3b3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVBZ2VudFdvcmtzcGFjZShhZ2VudElkLCBob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBsb2dzUm9vdCA9IHdvcmtzcGFjZS5wcml2YXRlTG9nc1Jvb3Q7XG4gIGxldCBsb2dGaWxlczogc3RyaW5nW10gPSBbXTtcblxuICB0cnkge1xuICAgIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKGxvZ3NSb290LCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgbG9nRmlsZXMgPSBlbnRyaWVzXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNGaWxlKCkgJiYgZW50cnkubmFtZS5lbmRzV2l0aCgnLm1kJykpXG4gICAgICAubWFwKChlbnRyeSkgPT4gZW50cnkubmFtZSlcbiAgICAgIC5zb3J0KCk7XG4gIH0gY2F0Y2gge1xuICAgIGxvZ0ZpbGVzID0gW107XG4gIH1cblxuICBjb25zdCBsYXRlc3RMb2dOYW1lID0gbG9nRmlsZXMuYXQoLTEpO1xuICBjb25zdCBsYXRlc3RMb2dQYXRoID0gbGF0ZXN0TG9nTmFtZSA/IHBhdGguam9pbihsb2dzUm9vdCwgbGF0ZXN0TG9nTmFtZSkgOiB1bmRlZmluZWQ7XG4gIGxldCBsMSA9ICdcdTY2ODJcdTY1RTBcdThGRDFcdTY3MUZcdTVCRjlcdThCRERcdThCQjBcdTVGNTVcdTMwMDInO1xuXG4gIGlmIChsYXRlc3RMb2dQYXRoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZShsYXRlc3RMb2dQYXRoLCAndXRmLTgnKTtcbiAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pLmZpbHRlcihCb29sZWFuKTtcbiAgICAgIGNvbnN0IHRhaWwgPSBsaW5lcy5zbGljZSgtMjApLmpvaW4oJ1xcbicpO1xuICAgICAgaWYgKHRhaWwudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbDEgPSB0YWlsO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gaWdub3JlXG4gICAgfVxuICB9XG5cbiAgY29uc3Qgc3VtbWFyeVBhdGggPSBwYXRoLmpvaW4od29ya3NwYWNlLnByaXZhdGVEYXRhUm9vdCwgJ21lbW9yeScsIE1FTU9SWV9TVU1NQVJZX0ZJTEUpO1xuICBsZXQgbDIgPSAnXHU2NjgyXHU2NUUwXHU2NDU4XHU4OTgxXHUzMDAyJztcbiAgdHJ5IHtcbiAgICBjb25zdCBzdW1tYXJ5ID0gYXdhaXQgcmVhZEZpbGUoc3VtbWFyeVBhdGgsICd1dGYtOCcpO1xuICAgIGlmIChzdW1tYXJ5LnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICBsMiA9IHN1bW1hcnkudHJpbSgpO1xuICAgIH1cbiAgfSBjYXRjaCB7XG4gICAgLy8gaWdub3JlXG4gIH1cblxuICBjb25zdCBsMyA9ICdMMyBcdThCQjBcdTVGQzZcdTc1MzEgWmVyb0NsYXcgUkFHIFx1NTcyOFx1OEZEMFx1ODg0Q1x1NjVGNlx1ODFFQVx1NTJBOFx1NTNFQ1x1NTZERVx1MzAwMic7XG4gIGNvbnN0IGw0ID0gbG9nRmlsZXMuc2xpY2UoLTMpLm1hcCgobmFtZSkgPT4gcGF0aC5qb2luKGxvZ3NSb290LCBuYW1lKSk7XG5cbiAgcmV0dXJuIHsgbDEsIGwyLCBsMywgbDQgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gYnVpbGRDb250ZXh0UHJvbXB0KHByb2ZpbGU6IEFnZW50UHJvZmlsZSwgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTx7XG4gIHByb21wdDogc3RyaW5nO1xuICBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn0+IHtcbiAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IHdvcmtzcGFjZSA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKHByb2ZpbGUuYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlKTtcblxuICBjb25zdCBwcml2YXRlU2tpbGxzID0gcHJvZmlsZS5za2lsbHMucHJpdmF0ZVNraWxscyA/PyBbXTtcbiAgY29uc3Qgc2hhcmVkU2tpbGxzID0gcHJvZmlsZS5za2lsbHMuc2hhcmVkU2tpbGxzID8/IFtdO1xuXG4gIGNvbnN0IHNraWxsTGluZXM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc2tpbGxJZCBvZiBwcml2YXRlU2tpbGxzKSB7XG4gICAgY29uc3Qgc2tpbGxSb290ID0gcGF0aC5qb2luKHdvcmtzcGFjZS5wcml2YXRlU2tpbGxzUm9vdCwgc2tpbGxJZCk7XG4gICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCBsb2FkU2tpbGxTdW1tYXJ5KHNraWxsUm9vdCk7XG4gICAgaWYgKG1ldGFkYXRhKSB7XG4gICAgICBza2lsbExpbmVzLnB1c2goYC0gW1x1NzlDMVx1NjcwOV0gJHttZXRhZGF0YS5uYW1lfTogJHttZXRhZGF0YS5kZXNjcmlwdGlvbn1gKTtcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBza2lsbElkIG9mIHNoYXJlZFNraWxscykge1xuICAgIGNvbnN0IHNraWxsUm9vdCA9IHBhdGguam9pbihzaGFyZWQuc2hhcmVkU2tpbGxzUm9vdCwgc2tpbGxJZCk7XG4gICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCBsb2FkU2tpbGxTdW1tYXJ5KHNraWxsUm9vdCk7XG4gICAgaWYgKG1ldGFkYXRhKSB7XG4gICAgICBza2lsbExpbmVzLnB1c2goYC0gW1x1NTE2Q1x1NTE3MV0gJHttZXRhZGF0YS5uYW1lfTogJHttZXRhZGF0YS5kZXNjcmlwdGlvbn1gKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBzaGFyZWRNY3BTZXJ2ZXJzID0gYXdhaXQgcmVhZE1jcFNlcnZlcnNGcm9tRmlsZShwYXRoLmpvaW4oc2hhcmVkLnNoYXJlZE1jcFJvb3QsICdzZXJ2ZXJzLmpzb24nKSk7XG4gIGNvbnN0IHByaXZhdGVNY3BTZXJ2ZXJzID0gYXdhaXQgcmVhZE1jcFNlcnZlcnNGcm9tRmlsZShwYXRoLmpvaW4od29ya3NwYWNlLnByaXZhdGVNY3BSb290LCAnc2VydmVycy5qc29uJykpO1xuXG4gIGNvbnN0IHNoYXJlZE1jcElkcyA9IHByb2ZpbGUubWNwLnNoYXJlZFNlcnZlcnMgPz8gW107XG4gIGNvbnN0IHByaXZhdGVNY3BJZHMgPSBwcm9maWxlLm1jcC5wcml2YXRlU2VydmVycyA/PyBbXTtcblxuICBjb25zdCBtY3BMaW5lcyA9IFtcbiAgICAuLi5zaGFyZWRNY3BTZXJ2ZXJzXG4gICAgICAuZmlsdGVyKChzZXJ2ZXIpID0+IHNoYXJlZE1jcElkcy5pbmNsdWRlcyhzZXJ2ZXIuaWQpKVxuICAgICAgLm1hcCgoc2VydmVyKSA9PiBgLSBbXHU1MTZDXHU1MTcxXSAke3NlcnZlci5uYW1lfSAoJHtzZXJ2ZXIudHlwZX0pYCksXG4gICAgLi4ucHJpdmF0ZU1jcFNlcnZlcnNcbiAgICAgIC5maWx0ZXIoKHNlcnZlcikgPT4gcHJpdmF0ZU1jcElkcy5pbmNsdWRlcyhzZXJ2ZXIuaWQpKVxuICAgICAgLm1hcCgoc2VydmVyKSA9PiBgLSBbXHU3OUMxXHU2NzA5XSAke3NlcnZlci5uYW1lfSAoJHtzZXJ2ZXIudHlwZX0pYCksXG4gIF07XG5cbiAgY29uc3QgbWVtb3J5ID0gYXdhaXQgYnVpbGRNZW1vcnlTbmFwc2hvdChwcm9maWxlLmFnZW50SWQsIGhvbWVEaXJPdmVycmlkZSk7XG5cbiAgY29uc3QgcHJvbXB0UGFydHMgPSBbXG4gICAgJyMgXHU4OUQyXHU4MjcyXHU3Q0ZCXHU3RURGXHU2M0QwXHU3OTNBXHU4QkNEJyxcbiAgICBwcm9maWxlLnN5c3RlbVByb21wdC50cmltKCkgfHwgJ1x1RkYwOFx1N0E3QVx1RkYwOScsXG4gICAgJycsXG4gICAgJyMgXHU4OUQyXHU4MjcyXHU2NDU4XHU4OTgxJyxcbiAgICBwcm9maWxlLnN1bW1hcnk/LnRyaW0oKSB8fCAnXHVGRjA4XHU3QTdBXHVGRjA5JyxcbiAgICAnJyxcbiAgICAnIyBcdTg5RDJcdTgyNzJcdTcwNzVcdTlCNDInLFxuICAgIHByb2ZpbGUuc291bD8udHJpbSgpIHx8ICdcdUZGMDhcdTdBN0FcdUZGMDknLFxuICAgICcnLFxuICAgICcjIFx1NTNFRlx1NzUyOFx1NjI4MFx1ODBGRCcsXG4gICAgc2tpbGxMaW5lcy5sZW5ndGggPiAwID8gc2tpbGxMaW5lcy5qb2luKCdcXG4nKSA6ICdcdUZGMDhcdTY3MkFcdTkxNERcdTdGNkVcdTYyODBcdTgwRkRcdUZGMDknLFxuICAgICcnLFxuICAgICcjIE1DUCBcdTY3MERcdTUyQTEnLFxuICAgIG1jcExpbmVzLmxlbmd0aCA+IDAgPyBtY3BMaW5lcy5qb2luKCdcXG4nKSA6ICdcdUZGMDhcdTY3MkFcdTkxNERcdTdGNkUgTUNQIFx1NjcwRFx1NTJBMVx1RkYwOScsXG4gICAgJycsXG4gICAgJyMgXHU4QkIwXHU1RkM2XHU0RTBBXHU0RTBCXHU2NTg3JyxcbiAgICAnIyMgTDE6IFx1OEZEMVx1NjcxRlx1NUJGOVx1OEJERFx1N0E5N1x1NTNFMycsXG4gICAgbWVtb3J5LmwxLFxuICAgICcnLFxuICAgICcjIyBMMjogXHU2RURBXHU1MkE4XHU2NDU4XHU4OTgxJyxcbiAgICBtZW1vcnkubDIsXG4gICAgJycsXG4gICAgJyMjIEwzOiBcdTc5QzFcdTVCQzZcdThCQjBcdTVGQzZcdUZGMDhSQUdcdUZGMDknLFxuICAgIG1lbW9yeS5sMyxcbiAgICAnJyxcbiAgICAnIyMgTDQ6IFx1NUY1Mlx1Njg2M1x1NjVFNVx1NUZEN1x1OERFRlx1NUY4NCcsXG4gICAgbWVtb3J5Lmw0Lmxlbmd0aCA+IDAgPyBtZW1vcnkubDQuam9pbignXFxuJykgOiAnXHVGRjA4XHU2NjgyXHU2NUUwXHU2NUU1XHU1RkQ3XHVGRjA5JyxcbiAgXTtcblxuICByZXR1cm4ge1xuICAgIHByb21wdDogcHJvbXB0UGFydHMuam9pbignXFxuJyksXG4gICAgY29udGV4dDoge1xuICAgICAgc2tpbGxzOiBza2lsbExpbmVzLFxuICAgICAgbWNwOiBtY3BMaW5lcyxcbiAgICAgIG1lbW9yeSxcbiAgICB9LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlUHJvdmlkZXJTZWNyZXRzKHByb3ZpZGVySWQ6IHN0cmluZywgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTx7XG4gIGFwaUtleT86IHN0cmluZztcbiAgYXBpQmFzZT86IHN0cmluZztcbn0+IHtcbiAgY29uc3QgY29uZmlnID0gYXdhaXQgZW5zdXJlWmVyb0NsYXdDb25maWcoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgY29ubmVjdGlvbiA9IGNvbmZpZy5wcm92aWRlckNvbm5lY3Rpb25zLmZpbmQoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCA9PT0gcHJvdmlkZXJJZCk7XG5cbiAgcmV0dXJuIHtcbiAgICBhcGlLZXk6IGNvbm5lY3Rpb24/LmFwaUtleVBsYWludGV4dCxcbiAgICBhcGlCYXNlOiBjb25uZWN0aW9uPy5hcGlCYXNlLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBlbnN1cmVaZXJvQ2xhd0NvbmZpZ0RpcihhZ2VudElkOiBzdHJpbmcsIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHdvcmtzcGFjZSA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKGFnZW50SWQsIGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGNvbmZpZ0RpciA9IHBhdGguam9pbih3b3Jrc3BhY2UuYWdlbnRSb290LCAnemVyb2NsYXcnKTtcbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KGNvbmZpZ0Rpcik7XG4gIHJldHVybiBjb25maWdEaXI7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZVplcm9DbGF3T25ib2FyZChcbiAgY29uZmlnRGlyOiBzdHJpbmcsXG4gIHByb3ZpZGVySWQ6IHN0cmluZyxcbiAgbW9kZWxOYW1lOiBzdHJpbmcsXG4gIGFwaUtleT86IHN0cmluZyxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBjb25maWdQYXRoID0gcGF0aC5qb2luKGNvbmZpZ0RpciwgJ2NvbmZpZy50b21sJyk7XG4gIGlmIChhd2FpdCBmaWxlRXhpc3RzKGNvbmZpZ1BhdGgpKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgeyBleGVjdXRhYmxlUGF0aCB9ID0gYXdhaXQgcmVzb2x2ZVplcm9DbGF3RXhlY3V0YWJsZSgpO1xuICBpZiAoIWV4ZWN1dGFibGVQYXRoKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFyZ3MgPSBbJ29uYm9hcmQnLCAnLS1jb25maWctZGlyJywgY29uZmlnRGlyLCAnLS1wcm92aWRlcicsIHByb3ZpZGVySWQsICctLW1vZGVsJywgbW9kZWxOYW1lLCAnLS1mb3JjZSddO1xuICBpZiAoYXBpS2V5KSB7XG4gICAgYXJncy5wdXNoKCctLWFwaS1rZXknLCBhcGlLZXkpO1xuICB9XG5cbiAgc3Bhd25TeW5jKGV4ZWN1dGFibGVQYXRoLCBhcmdzLCB7IHN0ZGlvOiAnaWdub3JlJyB9KTtcbn1cblxuZnVuY3Rpb24gdXBkYXRlU3RhdHVzKGFnZW50SWQ6IHN0cmluZywgZW50cnk6IFByb2Nlc3NFbnRyeSk6IHZvaWQge1xuICBhZ2VudFByb2Nlc3Nlcy5zZXQoYWdlbnRJZCwgZW50cnkpO1xufVxuXG5mdW5jdGlvbiB0b3VjaE91dHB1dChhZ2VudElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgZW50cnkgPSBhZ2VudFByb2Nlc3Nlcy5nZXQoYWdlbnRJZCk7XG4gIGlmICghZW50cnkpIHJldHVybjtcbiAgZW50cnkubGFzdE91dHB1dEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICBhZ2VudFByb2Nlc3Nlcy5zZXQoYWdlbnRJZCwgZW50cnkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0QWdlbnRSdW50aW1lU3RhdHVzKGFnZW50SWQ6IHN0cmluZyk6IEFnZW50UnVudGltZVN0YXR1cyB7XG4gIGNvbnN0IGVudHJ5ID0gYWdlbnRQcm9jZXNzZXMuZ2V0KGFnZW50SWQpO1xuXG4gIGlmICghZW50cnkpIHtcbiAgICByZXR1cm4geyBhZ2VudElkLCBzdGF0dXM6ICdvZmZsaW5lJyB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBhZ2VudElkLFxuICAgIHN0YXR1czogZW50cnkuc3RhdHVzLFxuICAgIHBpZDogZW50cnkucGlkLFxuICAgIHN0YXJ0ZWRBdDogZW50cnkuc3RhcnRlZEF0LFxuICAgIG1lc3NhZ2U6IGVudHJ5Lm1lc3NhZ2UsXG4gICAgbGFzdE91dHB1dEF0OiBlbnRyeS5sYXN0T3V0cHV0QXQsXG4gICAgbG9nUGF0aDogZW50cnkubG9nUGF0aCxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHN0YXJ0QWdlbnRSdW50aW1lKGlucHV0OiBTdGFydEFnZW50SW5wdXQpOiBQcm9taXNlPFN0YXJ0QWdlbnRSZXN1bHQ+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhZ2VudFByb2Nlc3Nlcy5nZXQoaW5wdXQuYWdlbnRJZCk7XG4gIGlmIChleGlzdGluZyAmJiAoZXhpc3Rpbmcuc3RhdHVzID09PSAnc3RhcnRpbmcnIHx8IGV4aXN0aW5nLnN0YXR1cyA9PT0gJ29ubGluZScpKSB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6ICdcdTY2N0FcdTgwRkRcdTRGNTNcdTVERjJcdTU3MjhcdThGRDBcdTg4NENcdTRFMkRcdTMwMDInLCBwaWQ6IGV4aXN0aW5nLnBpZCB9O1xuICB9XG5cbiAgY29uc3QgcHJvZmlsZSA9IGF3YWl0IGdldEFnZW50UHJvZmlsZShpbnB1dCk7XG4gIGNvbnN0IHsgZXhlY3V0YWJsZVBhdGgsIHRyaWVkIH0gPSBhd2FpdCByZXNvbHZlWmVyb0NsYXdFeGVjdXRhYmxlKCk7XG4gIGlmICghZXhlY3V0YWJsZVBhdGgpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBtZXNzYWdlOiBgXHU2NzJBXHU2MjdFXHU1MjMwIFplcm9DbGF3IFx1NUYxNVx1NjRDRVx1RkYwQ1x1OEJGN1x1NjhDMFx1NjdFNVx1NUI4OVx1ODhDNVx1OERFRlx1NUY4NFx1MzAwMlx1NURGMlx1NUMxRFx1OEJENVx1RkYxQSR7dHJpZWQuam9pbignIDsgJyl9YCxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgeyBwcm9tcHQsIGNvbnRleHQgfSA9IGF3YWl0IGJ1aWxkQ29udGV4dFByb21wdChwcm9maWxlLCBpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCB3b3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVBZ2VudFdvcmtzcGFjZShwcm9maWxlLmFnZW50SWQsIGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGNvbnRleHRQYXRoID0gcGF0aC5qb2luKHdvcmtzcGFjZS5hZ2VudFJvb3QsIENPTlRFWFRfRklMRV9OQU1FKTtcbiAgY29uc3QgY29udGV4dEpzb25QYXRoID0gcGF0aC5qb2luKHdvcmtzcGFjZS5hZ2VudFJvb3QsIENPTlRFWFRfSlNPTl9GSUxFKTtcbiAgYXdhaXQgd3JpdGVGaWxlKGNvbnRleHRQYXRoLCBwcm9tcHQsICd1dGYtOCcpO1xuICBhd2FpdCB3cml0ZUZpbGUoY29udGV4dEpzb25QYXRoLCBKU09OLnN0cmluZ2lmeShjb250ZXh0LCBudWxsLCAyKSwgJ3V0Zi04Jyk7XG5cbiAgY29uc3QgeyBsb2dQYXRoLCBzdHJlYW0gfSA9IGF3YWl0IGNyZWF0ZVplcm9DbGF3TG9nU3RyZWFtKHByb2ZpbGUuYWdlbnRJZCwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcblxuICBjb25zdCB7IGFwaUtleSwgYXBpQmFzZSB9ID0gYXdhaXQgcmVzb2x2ZVByb3ZpZGVyU2VjcmV0cyhwcm9maWxlLmRlZmF1bHRMbG0ucHJvdmlkZXJJZCwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgY29uZmlnRGlyID0gYXdhaXQgZW5zdXJlWmVyb0NsYXdDb25maWdEaXIocHJvZmlsZS5hZ2VudElkLCBpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuXG4gIGF3YWl0IGVuc3VyZVplcm9DbGF3T25ib2FyZChjb25maWdEaXIsIHByb2ZpbGUuZGVmYXVsdExsbS5wcm92aWRlcklkLCBwcm9maWxlLmRlZmF1bHRMbG0ubW9kZWxOYW1lLCBhcGlLZXkpO1xuXG4gIGNvbnN0IGFyZ3MgPSBbXG4gICAgJ2FnZW50JyxcbiAgICAnLS1jb25maWctZGlyJyxcbiAgICBjb25maWdEaXIsXG4gICAgJy0tcHJvdmlkZXInLFxuICAgIHByb2ZpbGUuZGVmYXVsdExsbS5wcm92aWRlcklkLFxuICAgICctLW1vZGVsJyxcbiAgICBwcm9maWxlLmRlZmF1bHRMbG0ubW9kZWxOYW1lLFxuICBdO1xuXG4gIGNvbnN0IGVudiA9IHtcbiAgICAuLi5wcm9jZXNzLmVudixcbiAgICBaRVJPQ0xBV19BUElfS0VZOiBhcGlLZXkgPz8gJycsXG4gICAgQVBJX0tFWTogYXBpS2V5ID8/ICcnLFxuICAgIFpFUk9DTEFXX0FQSV9VUkw6IGFwaUJhc2UgPz8gJycsXG4gICAgQVBJX1VSTDogYXBpQmFzZSA/PyAnJyxcbiAgfTtcblxuICBjb25zdCBjaGlsZCA9IHNwYXduKGV4ZWN1dGFibGVQYXRoLCBhcmdzLCB7IGVudiwgc3RkaW86ICdwaXBlJyB9KTtcblxuICBjaGlsZC5zdGRvdXQ/LnBpcGUoc3RyZWFtKTtcbiAgY2hpbGQuc3RkZXJyPy5waXBlKHN0cmVhbSk7XG4gIGNoaWxkLnN0ZG91dD8ub24oJ2RhdGEnLCAoKSA9PiB0b3VjaE91dHB1dChwcm9maWxlLmFnZW50SWQpKTtcbiAgY2hpbGQuc3RkZXJyPy5vbignZGF0YScsICgpID0+IHRvdWNoT3V0cHV0KHByb2ZpbGUuYWdlbnRJZCkpO1xuXG4gIHVwZGF0ZVN0YXR1cyhwcm9maWxlLmFnZW50SWQsIHtcbiAgICBzdGF0dXM6ICdzdGFydGluZycsXG4gICAgcGlkOiBjaGlsZC5waWQsXG4gICAgc3RhcnRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgcHJvY2VzczogY2hpbGQsXG4gICAgbG9nUGF0aCxcbiAgICBsYXN0T3V0cHV0QXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgfSk7XG5cbiAgY2hpbGQub25jZSgnc3Bhd24nLCAoKSA9PiB7XG4gICAgY29uc3QgZW50cnkgPSBhZ2VudFByb2Nlc3Nlcy5nZXQocHJvZmlsZS5hZ2VudElkKTtcbiAgICBpZiAoZW50cnkpIHtcbiAgICAgIHVwZGF0ZVN0YXR1cyhwcm9maWxlLmFnZW50SWQsIHsgLi4uZW50cnksIHN0YXR1czogJ29ubGluZScgfSk7XG4gICAgfVxuICB9KTtcblxuICBjaGlsZC5vbmNlKCdleGl0JywgKGNvZGUpID0+IHtcbiAgICBjb25zdCBlbnRyeSA9IGFnZW50UHJvY2Vzc2VzLmdldChwcm9maWxlLmFnZW50SWQpO1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBjb2RlID09PSAwID8gJ1x1NURGMlx1NTA1Q1x1NkI2MicgOiBgXHU1RjAyXHU1RTM4XHU5MDAwXHU1MUZBIChjb2RlICR7Y29kZSA/PyAndW5rbm93bid9KWA7XG4gICAgdXBkYXRlU3RhdHVzKHByb2ZpbGUuYWdlbnRJZCwge1xuICAgICAgc3RhdHVzOiBjb2RlID09PSAwID8gJ29mZmxpbmUnIDogJ2Vycm9yJyxcbiAgICAgIG1lc3NhZ2U6IGxvZ1BhdGggPyBgJHttZXNzYWdlfVx1RkYwQ1x1NjVFNVx1NUZEN1x1RkYxQSR7bG9nUGF0aH1gIDogbWVzc2FnZSxcbiAgICAgIGxvZ1BhdGgsXG4gICAgICBsYXN0T3V0cHV0QXQ6IGVudHJ5Py5sYXN0T3V0cHV0QXQsXG4gICAgfSk7XG4gICAgc3RyZWFtLmVuZCgpO1xuICB9KTtcblxuICBjaGlsZC5vbmNlKCdlcnJvcicsIChlcnJvcikgPT4ge1xuICAgIHVwZGF0ZVN0YXR1cyhwcm9maWxlLmFnZW50SWQsIHtcbiAgICAgIHN0YXR1czogJ2Vycm9yJyxcbiAgICAgIG1lc3NhZ2U6IGxvZ1BhdGggPyBgJHtlcnJvci5tZXNzYWdlfVx1RkYwQ1x1NjVFNVx1NUZEN1x1RkYxQSR7bG9nUGF0aH1gIDogZXJyb3IubWVzc2FnZSxcbiAgICAgIGxvZ1BhdGgsXG4gICAgfSk7XG4gICAgc3RyZWFtLmVuZCgpO1xuICB9KTtcblxuICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMjAwKSk7XG4gIGNvbnN0IGN1cnJlbnQgPSBhZ2VudFByb2Nlc3Nlcy5nZXQocHJvZmlsZS5hZ2VudElkKTtcbiAgaWYgKGN1cnJlbnQgJiYgKGN1cnJlbnQuc3RhdHVzID09PSAnb2ZmbGluZScgfHwgY3VycmVudC5zdGF0dXMgPT09ICdlcnJvcicpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgbWVzc2FnZTogY3VycmVudC5tZXNzYWdlID8/ICdcdTU0MkZcdTUyQThcdTU5MzFcdThEMjUnLFxuICAgICAgbG9nUGF0aCxcbiAgICAgIGNvbnRleHRQYXRoLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgcGlkOiBjaGlsZC5waWQsXG4gICAgY29udGV4dFBhdGgsXG4gICAgbG9nUGF0aCxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHN0b3BBZ2VudFJ1bnRpbWUoaW5wdXQ6IFN0b3BBZ2VudElucHV0KTogUHJvbWlzZTxTdG9wQWdlbnRSZXN1bHQ+IHtcbiAgY29uc3QgZW50cnkgPSBhZ2VudFByb2Nlc3Nlcy5nZXQoaW5wdXQuYWdlbnRJZCk7XG4gIGlmICghZW50cnkgfHwgIWVudHJ5LnByb2Nlc3MpIHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NjY3QVx1ODBGRFx1NEY1M1x1NjcyQVx1NTcyOFx1OEZEMFx1ODg0Q1x1NEUyRFx1MzAwMicgfTtcbiAgfVxuXG4gIGVudHJ5LnByb2Nlc3Mua2lsbCgpO1xuICB1cGRhdGVTdGF0dXMoaW5wdXQuYWdlbnRJZCwgeyBzdGF0dXM6ICdvZmZsaW5lJywgbWVzc2FnZTogJ1x1NURGMlx1NTA1Q1x1NkI2MicsIGxvZ1BhdGg6IGVudHJ5LmxvZ1BhdGggfSk7XG5cbiAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3RvcEFsbEFnZW50UnVudGltZXMoKTogdm9pZCB7XG4gIGZvciAoY29uc3QgW2FnZW50SWQsIGVudHJ5XSBvZiBhZ2VudFByb2Nlc3Nlcy5lbnRyaWVzKCkpIHtcbiAgICBpZiAoZW50cnkucHJvY2Vzcykge1xuICAgICAgZW50cnkucHJvY2Vzcy5raWxsKCk7XG4gICAgfVxuICAgIHVwZGF0ZVN0YXR1cyhhZ2VudElkLCB7IHN0YXR1czogJ29mZmxpbmUnLCBtZXNzYWdlOiAnXHU1REYyXHU1MDVDXHU2QjYyJyB9KTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZWFkTGF0ZXN0TG9nVGFpbChcbiAgYWdlbnRJZDogc3RyaW5nLFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4gIGxpbmVzQ291bnQgPSA4MCxcbik6IFByb21pc2U8QWdlbnRMb2dUYWlsPiB7XG4gIGNvbnN0IHdvcmtzcGFjZSA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKGFnZW50SWQsIGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGxvZ0RpciA9IHBhdGguam9pbih3b3Jrc3BhY2UucHJpdmF0ZUxvZ3NSb290LCBaRVJPQ0xPV19MT0dfRElSKTtcbiAgbGV0IGxvZ1BhdGggPSBhZ2VudFByb2Nlc3Nlcy5nZXQoYWdlbnRJZCk/LmxvZ1BhdGg7XG5cbiAgaWYgKCFsb2dQYXRoIHx8ICEoYXdhaXQgZmlsZUV4aXN0cyhsb2dQYXRoKSkpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZW50cmllcyA9IGF3YWl0IHJlYWRkaXIobG9nRGlyLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgICBjb25zdCBsb2dzID0gZW50cmllc1xuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNGaWxlKCkgJiYgZW50cnkubmFtZS5lbmRzV2l0aCgnLmxvZycpKVxuICAgICAgICAubWFwKChlbnRyeSkgPT4gZW50cnkubmFtZSlcbiAgICAgICAgLnNvcnQoKTtcbiAgICAgIGNvbnN0IGxhdGVzdCA9IGxvZ3MuYXQoLTEpO1xuICAgICAgbG9nUGF0aCA9IGxhdGVzdCA/IHBhdGguam9pbihsb2dEaXIsIGxhdGVzdCkgOiB1bmRlZmluZWQ7XG4gICAgfSBjYXRjaCB7XG4gICAgICBsb2dQYXRoID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIGlmICghbG9nUGF0aCkge1xuICAgIHJldHVybiB7IGFnZW50SWQsIGNvbnRlbnQ6ICdcdTY2ODJcdTY1RTBcdThGRDBcdTg4NENcdTY1RTVcdTVGRDdcdTMwMDInIH07XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZShsb2dQYXRoLCAndXRmLTgnKTtcbiAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgdGFpbCA9IGxpbmVzLnNsaWNlKC1saW5lc0NvdW50KS5qb2luKCdcXG4nKTtcbiAgICByZXR1cm4ge1xuICAgICAgYWdlbnRJZCxcbiAgICAgIGxvZ1BhdGgsXG4gICAgICBjb250ZW50OiB0YWlsIHx8ICdcdTY2ODJcdTY1RTBcdThGRDBcdTg4NENcdTY1RTVcdTVGRDdcdTMwMDInLFxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgfTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHsgYWdlbnRJZCwgbG9nUGF0aCwgY29udGVudDogJ1x1OEJGQlx1NTNENlx1NjVFNVx1NUZEN1x1NTkzMVx1OEQyNVx1MzAwMicgfTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0QWdlbnRMb2dUYWlsKFxuICBhZ2VudElkOiBzdHJpbmcsXG4gIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyxcbiAgbGluZXNDb3VudD86IG51bWJlcixcbik6IFByb21pc2U8QWdlbnRMb2dUYWlsPiB7XG4gIHJldHVybiByZWFkTGF0ZXN0TG9nVGFpbChhZ2VudElkLCBob21lRGlyT3ZlcnJpZGUsIGxpbmVzQ291bnQpO1xufVxuIiwgImltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyByZWFkRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJztcblxuaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gJ25vZGU6bW9kdWxlJztcbmNvbnN0IHJlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcbmltcG9ydCB7IGNyZWF0ZU1peGVkU3RyZWFtUGFyc2VyIH0gZnJvbSAnQGpzb24tcmVuZGVyL2NvcmUnO1xuXG5pbXBvcnQgeyBnZXRBZ2VudFByb2ZpbGUgfSBmcm9tICcuL2FnZW50LXByb2ZpbGUtc2VydmljZSc7XG5pbXBvcnQgeyBlbnN1cmVBZ2VudFdvcmtzcGFjZSwgZW5zdXJlU2hhcmVkV29ya3NwYWNlIH0gZnJvbSAnLi9zaGFyZWQtd29ya3NwYWNlLW1hbmFnZXInO1xuaW1wb3J0IHsgZW5zdXJlWmVyb0NsYXdDb25maWcgfSBmcm9tICcuL3plcm9jbGF3LWNvbmZpZy1tYW5hZ2VyJztcbmltcG9ydCB0eXBlIHsgQWdlbnRDaGF0SW5wdXQsIEFnZW50Q2hhdE1lc3NhZ2UsIEFnZW50Q2hhdFJlc3VsdCwgQWdlbnRDaGF0U3RyZWFtQ2h1bmssIEFnZW50UHJvZmlsZSB9IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBTS0lMTF9GSUxFX0NBTkRJREFURVMgPSBbJ1NLSUxMUy5tZCcsICdTS0lMTC5tZCcsICdza2lsbHMubWQnLCAnc2tpbGwubWQnXSBhcyBjb25zdDtcbmNvbnN0IFdFQVRIRVJfQVBJX0JBU0UgPSAnaHR0cHM6Ly9haWRlci5tZWl6dS5jb20vYXBwL3dlYXRoZXIvbGlzdFdlYXRoZXInO1xuY29uc3QgREVGQVVMVF9DSVRZX0lEID0gJzEwMTI0MDEwMSc7XG5jb25zdCBERUZBVUxUX1JFUVVFU1RfVElNRU9VVF9NUyA9IDYwXzAwMDtcblxuY29uc3QgU0hBRENOX0NPTVBPTkVOVFMgPSBbXG4gICdBY2NvcmRpb24nLFxuICAnQWxlcnQnLFxuICAnQWxlcnREZXNjcmlwdGlvbicsXG4gICdBbGVydFRpdGxlJyxcbiAgJ0FzcGVjdFJhdGlvJyxcbiAgJ0F2YXRhcicsXG4gICdBdmF0YXJGYWxsYmFjaycsXG4gICdBdmF0YXJJbWFnZScsXG4gICdCYWRnZScsXG4gICdCdXR0b24nLFxuICAnQ2FyZCcsXG4gICdDYXJkQ29udGVudCcsXG4gICdDYXJkRGVzY3JpcHRpb24nLFxuICAnQ2FyZEZvb3RlcicsXG4gICdDYXJkSGVhZGVyJyxcbiAgJ0NhcmRUaXRsZScsXG4gICdDaGVja2JveCcsXG4gICdEcm9wZG93bk1lbnUnLFxuICAnRHJvcGRvd25NZW51Q29udGVudCcsXG4gICdEcm9wZG93bk1lbnVJdGVtJyxcbiAgJ0Ryb3Bkb3duTWVudUxhYmVsJyxcbiAgJ0Ryb3Bkb3duTWVudVRyaWdnZXInLFxuICAnSW5wdXQnLFxuICAnTGFiZWwnLFxuICAnUHJvZ3Jlc3MnLFxuICAnU2Nyb2xsQXJlYScsXG4gICdTZXBhcmF0b3InLFxuICAnU2xpZGVyJyxcbiAgJ1N3aXRjaCcsXG4gICdUYWJzJyxcbiAgJ1RhYnNDb250ZW50JyxcbiAgJ1RhYnNMaXN0JyxcbiAgJ1RhYnNUcmlnZ2VyJyxcbiAgJ1RleHQnLFxuICAnVG9vbHRpcCcsXG4gICdUb29sdGlwQ29udGVudCcsXG4gICdUb29sdGlwVHJpZ2dlcicsXG5dIGFzIGNvbnN0O1xuXG5pbnRlcmZhY2UgV2VhdGhlckFwaVJlc3BvbnNlIHtcbiAgY29kZT86IHN0cmluZztcbiAgbWVzc2FnZT86IHN0cmluZztcbiAgdmFsdWU/OiBXZWF0aGVyQXBpRW50cnlbXTtcbn1cblxuaW50ZXJmYWNlIFdlYXRoZXJBcGlFbnRyeSB7XG4gIGNpdHk/OiBzdHJpbmc7XG4gIHByb3ZpbmNlTmFtZT86IHN0cmluZztcbiAgcmVhbHRpbWU/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBwbTI1PzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgd2VhdGhlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+W107XG4gIGluZGV4ZXM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+W107XG59XG5cbmludGVyZmFjZSBXZWF0aGVyU2tpbGxQcm9wcyB7XG4gIGNpdHk/OiBzdHJpbmc7XG4gIHByb3ZpbmNlTmFtZT86IHN0cmluZztcbiAgcmVhbHRpbWU/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBwbTI1PzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgd2VhdGhlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+W107XG4gIGluZGV4ZXM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+W107XG4gIHNvdXJjZT86IHN0cmluZztcbiAgdXBkYXRlZEF0Pzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgT3BlbkFJQ2hhdE1lc3NhZ2Uge1xuICByb2xlOiAnc3lzdGVtJyB8ICd1c2VyJyB8ICdhc3Npc3RhbnQnO1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBPcGVuQUlDaGF0UmVzcG9uc2Uge1xuICBjaG9pY2VzPzogQXJyYXk8eyBtZXNzYWdlPzogeyBjb250ZW50Pzogc3RyaW5nIH0gfT47XG59XG5cbmludGVyZmFjZSBPcGVuQUlDaGF0U3RyZWFtQ2h1bmsge1xuICBjaG9pY2VzPzogQXJyYXk8e1xuICAgIGRlbHRhPzogeyBjb250ZW50Pzogc3RyaW5nIH07XG4gICAgbWVzc2FnZT86IHsgY29udGVudD86IHN0cmluZyB9O1xuICB9Pjtcbn1cblxuZnVuY3Rpb24gc3RyaXBGcm9udG1hdHRlcihjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IGNvbnRlbnQubWF0Y2goL14tLS1cXHMqW1xcc1xcU10qP1xccyotLS1cXHMqLyk7XG4gIGlmICghbWF0Y2gpIHJldHVybiBjb250ZW50LnRyaW0oKTtcbiAgcmV0dXJuIGNvbnRlbnQuc2xpY2UobWF0Y2hbMF0ubGVuZ3RoKS50cmltKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRTa2lsbERvY0Zyb21Gb2xkZXIoZm9sZGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIFNLSUxMX0ZJTEVfQ0FORElEQVRFUykge1xuICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5qb2luKGZvbGRlclBhdGgsIGNhbmRpZGF0ZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04Jyk7XG4gICAgICByZXR1cm4gc3RyaXBGcm9udG1hdHRlcihjb250ZW50KTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGlnbm9yZVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUFwcFNraWxsc1Jvb3QoKTogc3RyaW5nIHtcbiAgaWYgKCFhcHAuaXNQYWNrYWdlZCkge1xuICAgIGNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCk7XG4gICAgY29uc3QgX19kaXJuYW1lID0gcGF0aC5kaXJuYW1lKF9fZmlsZW5hbWUpO1xuICAgIHJldHVybiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnc2tpbGxzJyk7XG4gIH1cbiAgcmV0dXJuIHBhdGguam9pbihhcHAuZ2V0QXBwUGF0aCgpLCAnc2tpbGxzJyk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNraWxsSWQoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBpbnB1dC50cmltKCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU2tpbGxGb2xkZXIoc2tpbGxJZDogc3RyaW5nKTogeyBzb3VyY2U6ICdhcHAnIHwgJ3NoYXJlZCcgfCAncHJpdmF0ZSc7IGZvbGRlck5hbWU6IHN0cmluZyB9IHtcbiAgY29uc3QgdHJpbW1lZCA9IG5vcm1hbGl6ZVNraWxsSWQoc2tpbGxJZCk7XG4gIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoJ2FwcDonKSkge1xuICAgIHJldHVybiB7IHNvdXJjZTogJ2FwcCcsIGZvbGRlck5hbWU6IHRyaW1tZWQuc2xpY2UoNCkudHJpbSgpIH07XG4gIH1cbiAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aCgnc2hhcmVkOicpKSB7XG4gICAgcmV0dXJuIHsgc291cmNlOiAnc2hhcmVkJywgZm9sZGVyTmFtZTogdHJpbW1lZC5zbGljZSg3KS50cmltKCkgfTtcbiAgfVxuICByZXR1cm4geyBzb3VyY2U6ICdzaGFyZWQnLCBmb2xkZXJOYW1lOiB0cmltbWVkIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRTa2lsbERvY3MocHJvZmlsZTogQWdlbnRQcm9maWxlLCBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGNvbnN0IGRvY3M6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHdvcmtzcGFjZSA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKHByb2ZpbGUuYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGFwcFNraWxsc1Jvb3QgPSByZXNvbHZlQXBwU2tpbGxzUm9vdCgpO1xuXG4gIGZvciAoY29uc3Qgc2tpbGxJZCBvZiBwcm9maWxlLnNraWxscy5wcml2YXRlU2tpbGxzID8/IFtdKSB7XG4gICAgY29uc3QgZm9sZGVyID0gbm9ybWFsaXplU2tpbGxJZChza2lsbElkKTtcbiAgICBpZiAoIWZvbGRlcikgY29udGludWU7XG4gICAgY29uc3QgZG9jID0gYXdhaXQgcmVhZFNraWxsRG9jRnJvbUZvbGRlcihwYXRoLmpvaW4od29ya3NwYWNlLnByaXZhdGVTa2lsbHNSb290LCBmb2xkZXIpKTtcbiAgICBpZiAoZG9jKSBkb2NzLnB1c2goZG9jKTtcbiAgfVxuXG4gIGZvciAoY29uc3Qgc2tpbGxJZCBvZiBwcm9maWxlLnNraWxscy5zaGFyZWRTa2lsbHMgPz8gW10pIHtcbiAgICBjb25zdCBwYXJzZWQgPSBwYXJzZVNraWxsRm9sZGVyKHNraWxsSWQpO1xuICAgIGlmICghcGFyc2VkLmZvbGRlck5hbWUpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGJhc2VSb290ID0gcGFyc2VkLnNvdXJjZSA9PT0gJ2FwcCcgPyBhcHBTa2lsbHNSb290IDogc2hhcmVkLnNoYXJlZFNraWxsc1Jvb3Q7XG4gICAgY29uc3QgZG9jID0gYXdhaXQgcmVhZFNraWxsRG9jRnJvbUZvbGRlcihwYXRoLmpvaW4oYmFzZVJvb3QsIHBhcnNlZC5mb2xkZXJOYW1lKSk7XG4gICAgaWYgKGRvYykgZG9jcy5wdXNoKGRvYyk7XG4gIH1cblxuICByZXR1cm4gZG9jcztcbn1cblxuZnVuY3Rpb24gYnVpbGRTeXN0ZW1Qcm9tcHQoXG4gIHByb2ZpbGU6IEFnZW50UHJvZmlsZSxcbiAgc2tpbGxEb2NzOiBzdHJpbmdbXSxcbiAgd2VhdGhlclByb3BzPzogV2VhdGhlclNraWxsUHJvcHMsXG4gIHdlYXRoZXJFcnJvcj86IHN0cmluZyxcbik6IHN0cmluZyB7XG4gIGNvbnN0IHByb21wdFBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBiYXNlUHJvbXB0ID0gcHJvZmlsZS5zeXN0ZW1Qcm9tcHQ/LnRyaW0oKTtcbiAgaWYgKGJhc2VQcm9tcHQpIHtcbiAgICBwcm9tcHRQYXJ0cy5wdXNoKGJhc2VQcm9tcHQpO1xuICB9IGVsc2Uge1xuICAgIHByb21wdFBhcnRzLnB1c2goJ1x1NEY2MFx1NjYyRlx1NEUwMFx1NEUyQVx1NEUyNVx1OEMyOFx1NzY4NFx1NjI4MFx1NjcyRlx1NTc4Qlx1NjY3QVx1ODBGRFx1NEY1M1x1RkYwQ1x1NTZERVx1NTkwRFx1OTcwMFx1NkUwNVx1NjY3MFx1MzAwMVx1N0I4MFx1NkQwMVx1MzAwMVx1NTNFRlx1NjI2N1x1ODg0Q1x1MzAwMicpO1xuICB9XG5cbiAgaWYgKHNraWxsRG9jcy5sZW5ndGggPiAwKSB7XG4gICAgcHJvbXB0UGFydHMucHVzaCgnXFxuIyBcdTYyODBcdTgwRkRcdThCRjRcdTY2MEUnKTtcbiAgICBwcm9tcHRQYXJ0cy5wdXNoKHNraWxsRG9jcy5qb2luKCdcXG5cXG4nKSk7XG4gIH1cblxuICBwcm9tcHRQYXJ0cy5wdXNoKCdcXG4jIFNoYWRjbiBcdTdFQzRcdTRFRjZcdTVFOTMgKGpzb24tcmVuZGVyL3NoYWRjbiknKTtcbiAgcHJvbXB0UGFydHMucHVzaChgXHU1M0VGXHU3NTI4XHU3RUM0XHU0RUY2XHVGRjA4XHU1MTcxICR7U0hBRENOX0NPTVBPTkVOVFMubGVuZ3RofSBcdTRFMkFcdUZGMDlcdUZGMUEke1NIQURDTl9DT01QT05FTlRTLmpvaW4oJywgJyl9YCk7XG4gIHByb21wdFBhcnRzLnB1c2goJy0gXHU0RjE4XHU1MTQ4XHU0RjdGXHU3NTI4IENhcmQgLyBDYXJkSGVhZGVyIC8gQ2FyZENvbnRlbnQgLyBDYXJkRm9vdGVyIFx1N0VDNFx1N0VDN1x1NTE4NVx1NUJCOVx1NUM0Mlx1N0VBN1x1MzAwMicpO1xuICBwcm9tcHRQYXJ0cy5wdXNoKCctIFx1NjU4N1x1NjcyQ1x1NEYxOFx1NTE0OFx1NEY3Rlx1NzUyOCBUZXh0IFx1N0VDNFx1NEVGNlx1RkYxQlx1NUMxMVx1OTFDRlx1OEJGNFx1NjYwRVx1NTNFRlx1NzUyOCBDYXJkRGVzY3JpcHRpb25cdTMwMDInKTtcbiAgcHJvbXB0UGFydHMucHVzaCgnLSBcdTRGN0ZcdTc1MjggQmFkZ2UgXHU1RjNBXHU1MzE2XHU2ODA3XHU3QjdFXHVGRjBDU2VwYXJhdG9yIFx1NTIwNlx1OTY5NFx1NTMzQVx1NTc1N1x1MzAwMicpO1xuICBwcm9tcHRQYXJ0cy5wdXNoKCctIFx1NUUwM1x1NUM0MFx1NTNFRlx1NTcyOFx1NUJCOVx1NTY2OFx1NEUwQVx1NEY3Rlx1NzUyOCBjbGFzc05hbWVcdUZGMDhcdTRGOEJcdTU5ODIgZ3JpZFx1MzAwMWZsZXhcdTMwMDFnYXAtKiwgaXRlbXMtY2VudGVyXHUzMDAxanVzdGlmeS1iZXR3ZWVuXHVGRjA5XHUzMDAyJyk7XG4gIHByb21wdFBhcnRzLnB1c2goJy0gXHU4OUM2XHU4OUM5XHU5OENFXHU2ODNDXHVGRjFBXHU3NTU5XHU3NjdEXHU1MTQ1XHU4REIzXHUzMDAxXHU1QzQyXHU2QjIxXHU2RTA1XHU2NjcwXHUzMDAxXHU5MDdGXHU1MTREXHU1OTI3XHU2QkI1XHU3RUFGXHU2NTg3XHU2NzJDXHU1ODA2XHU1M0UwXHUzMDAyJyk7XG5cbiAgcHJvbXB0UGFydHMucHVzaCgnXFxuIyBBMlVJIC8ganNvbi1yZW5kZXIgQ2hhdCBNb2RlIFx1OEY5M1x1NTFGQVx1ODlDNFx1ODMwMycpO1xuICBwcm9tcHRQYXJ0cy5wdXNoKCctIFx1NTE0OFx1OEY5M1x1NTFGQVx1ODFFQVx1NzEzNlx1OEJFRFx1OEEwMFx1OEJGNFx1NjYwRVx1RkYwQ1x1NzEzNlx1NTQwRVx1NjMwOVx1ODg0Q1x1OEY5M1x1NTFGQSBKU09OTCBwYXRjaGVzXHVGRjA4UkZDNjkwMlx1RkYwOVx1MzAwMicpO1xuICBwcm9tcHRQYXJ0cy5wdXNoKCctIEpTT05MIFx1NkJDRlx1ODg0Q1x1NEUwMFx1NEUyQSBwYXRjaFx1RkYwQ1x1NUJGOVx1OEM2MVx1OTcwMFx1NTMwNVx1NTQyQiBvcC9wYXRoL3ZhbHVlXHUzMDAyJyk7XG4gIHByb21wdFBhcnRzLnB1c2goJy0gcGF0Y2hlcyBcdTRFQzVcdTUzNjBcdTRFMDBcdTg4NENcdUZGMENcdTRFMERcdTg5ODFcdTY1M0VcdThGREJcdTRFRTNcdTc4MDFcdTU3NTdcdUZGMENcdTRFMERcdTg5ODFcdTRGN0ZcdTc1MjggTWFya2Rvd24gYGBgXHUzMDAyJyk7XG4gIHByb21wdFBhcnRzLnB1c2goJy0gXHU1RjUzXHU2NUUwXHU5NzAwIFVJIFx1NjVGNlx1RkYwQ1x1NTNFQVx1OEY5M1x1NTFGQVx1N0VBRlx1NjU4N1x1NjcyQ1x1NTM3M1x1NTNFRlx1MzAwMicpO1xuICBwcm9tcHRQYXJ0cy5wdXNoKGAtIFx1N0VDNFx1NEVGNlx1N0M3Qlx1NTc4Qlx1NEVDNVx1NEY3Rlx1NzUyOFx1NURGMlx1NkNFOFx1NTE4Q1x1NzY4NFx1N0M3Qlx1NTc4Qlx1RkYwOFx1NEYxOFx1NTE0OCBTaGFkY24gXHU3RUM0XHU0RUY2XHVGRjA5XHVGRjFBJHtTSEFEQ05fQ09NUE9ORU5UUy5qb2luKCcsICcpfVx1RkYwQ1x1NEVFNVx1NTNDQVx1NjI4MFx1ODBGRFx1N0VDNFx1NEVGNlx1NTk4MiB3ZWF0aGVyLWNhcmRcdTMwMDJgKTtcbiAgcHJvbXB0UGFydHMucHVzaCgnLSBcdTk3NUVcdTVGQzVcdTg5ODFcdTRFMERcdTg5ODFcdThGOTNcdTUxRkFcdTUzOUZcdTU5Q0IgSFRNTCBcdTY4MDdcdTdCN0VcdUZGMDhkaXYvc3Bhbi9wIFx1N0I0OVx1RkYwOVx1RkYwQ1x1NEYxOFx1NTE0OFx1NEY3Rlx1NzUyOCBTaGFkY24gXHU3RUM0XHU0RUY2XHUzMDAyJyk7XG5cbiAgaWYgKHdlYXRoZXJQcm9wcykge1xuICAgIHByb21wdFBhcnRzLnB1c2goJ1xcbiMgXHU1REYyXHU4M0I3XHU1M0Q2XHU3Njg0XHU1OTI5XHU2QzE0XHU2NTcwXHU2MzZFIChwcm9wcyknKTtcbiAgICBwcm9tcHRQYXJ0cy5wdXNoKEpTT04uc3RyaW5naWZ5KHdlYXRoZXJQcm9wcywgbnVsbCwgMikpO1xuICB9XG4gIGlmICh3ZWF0aGVyRXJyb3IpIHtcbiAgICBwcm9tcHRQYXJ0cy5wdXNoKCdcXG4jIFx1NTkyOVx1NkMxNFx1NjNBNVx1NTNFM1x1NzJCNlx1NjAwMScpO1xuICAgIHByb21wdFBhcnRzLnB1c2goYC0gXHU4M0I3XHU1M0Q2XHU1OTI5XHU2QzE0XHU1OTMxXHU4RDI1XHVGRjFBJHt3ZWF0aGVyRXJyb3J9YCk7XG4gICAgcHJvbXB0UGFydHMucHVzaCgnLSBcdTRFMERcdTg5ODFcdTdGMTZcdTkwMjBcdTVCOUVcdTY1RjZcdTU5MjlcdTZDMTRcdTY1NzBcdTYzNkVcdUZGMENcdTk3MDBcdTYzRDBcdTc5M0FcdTc1MjhcdTYyMzdcdTdBMERcdTU0MEVcdTkxQ0RcdThCRDVcdTMwMDInKTtcbiAgfVxuXG4gIHJldHVybiBwcm9tcHRQYXJ0cy5qb2luKCdcXG4nKTtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdENpdHlJZChtZXNzYWdlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBleHBsaWNpdCA9IG1lc3NhZ2UubWF0Y2goL1xcYihcXGR7OX0pXFxiLyk7XG4gIGlmIChleHBsaWNpdCkgcmV0dXJuIGV4cGxpY2l0WzFdO1xuICByZXR1cm4gREVGQVVMVF9DSVRZX0lEO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaFdlYXRoZXIoY2l0eUlkOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyKTogUHJvbWlzZTxXZWF0aGVyU2tpbGxQcm9wcz4ge1xuICBjb25zdCB1cmwgPSBgJHtXRUFUSEVSX0FQSV9CQVNFfT9jaXR5SWRzPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGNpdHlJZCl9YDtcbiAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSwgdGltZW91dE1zKTtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7IHNpZ25hbDogY29udHJvbGxlci5zaWduYWwgfSk7XG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBcdTU5MjlcdTZDMTRcdTYzQTVcdTUzRTNcdThCRjdcdTZDNDJcdTU5MzFcdThEMjUgKCR7cmVzcG9uc2Uuc3RhdHVzfSlgKTtcbiAgICB9XG4gICAgY29uc3QgcGF5bG9hZCA9IChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIFdlYXRoZXJBcGlSZXNwb25zZTtcbiAgICBjb25zdCBlbnRyeSA9IHBheWxvYWQudmFsdWU/LlswXTtcbiAgICBpZiAoIWVudHJ5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1x1NTkyOVx1NkMxNFx1NjNBNVx1NTNFM1x1OEZENFx1NTZERVx1NEUzQVx1N0E3QScpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjaXR5OiBlbnRyeS5jaXR5LFxuICAgICAgcHJvdmluY2VOYW1lOiBlbnRyeS5wcm92aW5jZU5hbWUsXG4gICAgICByZWFsdGltZTogZW50cnkucmVhbHRpbWUsXG4gICAgICBwbTI1OiBlbnRyeS5wbTI1LFxuICAgICAgd2VhdGhlcnM6IGVudHJ5LndlYXRoZXJzPy5zbGljZSgwLCAzKSxcbiAgICAgIGluZGV4ZXM6IGVudHJ5LmluZGV4ZXM/LnNsaWNlKDAsIDMpLFxuICAgICAgdXBkYXRlZEF0OiBlbnRyeS5yZWFsdGltZT8udGltZSA/PyBlbnRyeS5wbTI1Py51cERhdGVUaW1lLFxuICAgICAgc291cmNlOiAnXHU5QjQ1XHU2NUNGXHU1OTI5XHU2QzE0IEFQSScsXG4gICAgfTtcbiAgfSBmaW5hbGx5IHtcbiAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNob3VsZFVzZVdlYXRoZXJTa2lsbChtZXNzYWdlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9cdTU5MjlcdTZDMTR8XHU5ODg0XHU2MkE1fHdlYXRoZXIvaS50ZXN0KG1lc3NhZ2UpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXF1ZXN0Q2hhdENvbXBsZXRpb24oXG4gIGFwaUJhc2U6IHN0cmluZyxcbiAgYXBpS2V5OiBzdHJpbmcsXG4gIG1vZGVsTmFtZTogc3RyaW5nLFxuICBtZXNzYWdlczogT3BlbkFJQ2hhdE1lc3NhZ2VbXSxcbiAgdGltZW91dE1zOiBudW1iZXIsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLCB0aW1lb3V0TXMpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgYmFzZSA9IGFwaUJhc2UucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgY29uc3QgdXJsID0gYCR7YmFzZX0vY2hhdC9jb21wbGV0aW9uc2A7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7YXBpS2V5fWAsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBtb2RlbDogbW9kZWxOYW1lLFxuICAgICAgICBtZXNzYWdlcyxcbiAgICAgICAgdGVtcGVyYXR1cmU6IDAuMixcbiAgICAgICAgc3RyZWFtOiBmYWxzZSxcbiAgICAgIH0pLFxuICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFx1NkEyMVx1NTc4Qlx1OEJGN1x1NkM0Mlx1NTkzMVx1OEQyNSAoJHtyZXNwb25zZS5zdGF0dXN9KSAke3RleHR9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgcGF5bG9hZCA9IChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIE9wZW5BSUNoYXRSZXNwb25zZTtcbiAgICBjb25zdCBjb250ZW50ID0gcGF5bG9hZC5jaG9pY2VzPy5bMF0/Lm1lc3NhZ2U/LmNvbnRlbnQ7XG4gICAgaWYgKCFjb250ZW50KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1x1NkEyMVx1NTc4Qlx1OEZENFx1NTZERVx1NEUzQVx1N0E3QScpO1xuICAgIH1cbiAgICByZXR1cm4gY29udGVudDtcbiAgfSBmaW5hbGx5IHtcbiAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlcXVlc3RDaGF0Q29tcGxldGlvblN0cmVhbShcbiAgYXBpQmFzZTogc3RyaW5nLFxuICBhcGlLZXk6IHN0cmluZyxcbiAgbW9kZWxOYW1lOiBzdHJpbmcsXG4gIG1lc3NhZ2VzOiBPcGVuQUlDaGF0TWVzc2FnZVtdLFxuICB0aW1lb3V0TXM6IG51bWJlcixcbiAgb25EZWx0YT86IChkZWx0YTogc3RyaW5nKSA9PiB2b2lkLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSwgdGltZW91dE1zKTtcblxuICB0cnkge1xuICAgIGNvbnN0IGJhc2UgPSBhcGlCYXNlLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGNvbnN0IHVybCA9IGAke2Jhc2V9L2NoYXQvY29tcGxldGlvbnNgO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke2FwaUtleX1gLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgbW9kZWw6IG1vZGVsTmFtZSxcbiAgICAgICAgbWVzc2FnZXMsXG4gICAgICAgIHRlbXBlcmF0dXJlOiAwLjIsXG4gICAgICAgIHN0cmVhbTogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFx1NkEyMVx1NTc4Qlx1OEJGN1x1NkM0Mlx1NTkzMVx1OEQyNSAoJHtyZXNwb25zZS5zdGF0dXN9KSAke3RleHR9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgY29udGVudFR5cGUgPSByZXNwb25zZS5oZWFkZXJzLmdldCgnY29udGVudC10eXBlJykgPz8gJyc7XG4gICAgaWYgKGNvbnRlbnRUeXBlLmluY2x1ZGVzKCdhcHBsaWNhdGlvbi9qc29uJykpIHtcbiAgICAgIGNvbnN0IHBheWxvYWQgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpKSBhcyBPcGVuQUlDaGF0UmVzcG9uc2U7XG4gICAgICBjb25zdCBjb250ZW50ID0gcGF5bG9hZC5jaG9pY2VzPy5bMF0/Lm1lc3NhZ2U/LmNvbnRlbnQgPz8gJyc7XG4gICAgICBpZiAoIWNvbnRlbnQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdcdTZBMjFcdTU3OEJcdThGRDRcdTU2REVcdTRFM0FcdTdBN0EnKTtcbiAgICAgIH1cbiAgICAgIG9uRGVsdGE/Lihjb250ZW50KTtcbiAgICAgIHJldHVybiBjb250ZW50O1xuICAgIH1cblxuICAgIGlmICghcmVzcG9uc2UuYm9keSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdcdTZBMjFcdTU3OEJcdTZENDFcdTVGMEZcdTU0Q0RcdTVFOTRcdTRFM0FcdTdBN0EnKTtcbiAgICB9XG5cbiAgICBjb25zdCBkZWNvZGVyID0gbmV3IFRleHREZWNvZGVyKCd1dGYtOCcpO1xuICAgIGNvbnN0IHJlYWRlciA9IHJlc3BvbnNlLmJvZHkuZ2V0UmVhZGVyKCk7XG4gICAgbGV0IGJ1ZmZlciA9ICcnO1xuICAgIGxldCBjb250ZW50ID0gJyc7XG4gICAgbGV0IHNob3VsZFN0b3AgPSBmYWxzZTtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCB7IHZhbHVlLCBkb25lIH0gPSBhd2FpdCByZWFkZXIucmVhZCgpO1xuICAgICAgaWYgKGRvbmUpIGJyZWFrO1xuICAgICAgYnVmZmVyICs9IGRlY29kZXIuZGVjb2RlKHZhbHVlLCB7IHN0cmVhbTogdHJ1ZSB9KTtcblxuICAgICAgY29uc3QgbGluZXMgPSBidWZmZXIuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGJ1ZmZlciA9IGxpbmVzLnBvcCgpID8/ICcnO1xuXG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgICAgICBpZiAoIXRyaW1tZWQuc3RhcnRzV2l0aCgnZGF0YTonKSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSB0cmltbWVkLnJlcGxhY2UoL15kYXRhOlxccyovLCAnJyk7XG4gICAgICAgIGlmIChwYXlsb2FkID09PSAnW0RPTkVdJykge1xuICAgICAgICAgIHNob3VsZFN0b3AgPSB0cnVlO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QganNvbiA9IEpTT04ucGFyc2UocGF5bG9hZCkgYXMgT3BlbkFJQ2hhdFN0cmVhbUNodW5rO1xuICAgICAgICAgIGNvbnN0IGRlbHRhID1cbiAgICAgICAgICAgIGpzb24uY2hvaWNlcz8uWzBdPy5kZWx0YT8uY29udGVudCA/P1xuICAgICAgICAgICAganNvbi5jaG9pY2VzPy5bMF0/Lm1lc3NhZ2U/LmNvbnRlbnQgPz9cbiAgICAgICAgICAgICcnO1xuICAgICAgICAgIGlmIChkZWx0YSkge1xuICAgICAgICAgICAgY29udGVudCArPSBkZWx0YTtcbiAgICAgICAgICAgIG9uRGVsdGE/LihkZWx0YSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBpZ25vcmUgbWFsZm9ybWVkIGNodW5rXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHNob3VsZFN0b3ApIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNob3VsZFN0b3ApIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHJlYWRlci5jYW5jZWwoKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBpZ25vcmUgY2FuY2VsIGVycm9yc1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjb250ZW50O1xuICB9IGZpbmFsbHkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lcik7XG4gIH1cbn1cblxuZnVuY3Rpb24gYnVpbGRXZWF0aGVyRmFsbGJhY2tSZXNwb25zZShwcm9wczogV2VhdGhlclNraWxsUHJvcHMpOiBzdHJpbmcge1xuICBjb25zdCByb290S2V5ID0gJ3dlYXRoZXItcm9vdCc7XG4gIHJldHVybiBbXG4gICAgJ1x1NURGMlx1NEUzQVx1NEY2MFx1ODNCN1x1NTNENlx1NjcwMFx1NjVCMFx1NTkyOVx1NkMxNFx1NjU3MFx1NjM2RVx1RkYxQScsXG4gICAgSlNPTi5zdHJpbmdpZnkoeyBvcDogJ2FkZCcsIHBhdGg6ICcvcm9vdCcsIHZhbHVlOiByb290S2V5IH0pLFxuICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIG9wOiAnYWRkJyxcbiAgICAgIHBhdGg6IGAvZWxlbWVudHMvJHtyb290S2V5fWAsXG4gICAgICB2YWx1ZToge1xuICAgICAgICB0eXBlOiAnd2VhdGhlci1jYXJkJyxcbiAgICAgICAgcHJvcHMsXG4gICAgICB9LFxuICAgIH0pLFxuICBdLmpvaW4oJ1xcbicpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVIaXN0b3J5KGhpc3Rvcnk/OiByZWFkb25seSBBZ2VudENoYXRNZXNzYWdlW10pOiBPcGVuQUlDaGF0TWVzc2FnZVtdIHtcbiAgaWYgKCFoaXN0b3J5KSByZXR1cm4gW107XG4gIHJldHVybiBoaXN0b3J5XG4gICAgLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5yb2xlID09PSAndXNlcicgfHwgaXRlbS5yb2xlID09PSAnYXNzaXN0YW50JylcbiAgICAubWFwKChpdGVtKSA9PiAoeyByb2xlOiBpdGVtLnJvbGUsIGNvbnRlbnQ6IGl0ZW0uY29udGVudCB9KSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUNoYXRNb2RlUGFyc2VyKFxuICBlbWl0Q2h1bms6IChjaHVuazogQWdlbnRDaGF0U3RyZWFtQ2h1bmspID0+IHZvaWQsXG4gIHJlcXVlc3RJZDogc3RyaW5nLFxuKTogeyBwdXNoOiAoY2h1bms6IHN0cmluZykgPT4gdm9pZDsgZmx1c2g6ICgpID0+IHZvaWQgfSB7XG4gIGxldCBsb2dCdWZmZXIgPSAnJztcbiAgbGV0IGxvZ0Nsb3NlZCA9IGZhbHNlO1xuICBjb25zdCBwYXJzZXIgPSBjcmVhdGVNaXhlZFN0cmVhbVBhcnNlcih7XG4gICAgb25UZXh0OiAobGluZSkgPT4ge1xuICAgICAgY29uc3QgcGF5bG9hZCA9IGAke2xpbmV9XFxuYDtcbiAgICAgIGVtaXRDaHVuayh7XG4gICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAga2luZDogJ3RleHQnLFxuICAgICAgICB2YWx1ZTogcGF5bG9hZCxcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgb25QYXRjaDogKHBhdGNoKSA9PiB7XG4gICAgICBlbWl0Q2h1bmsoe1xuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIGtpbmQ6ICdwYXRjaCcsXG4gICAgICAgIHZhbHVlOiBgJHtKU09OLnN0cmluZ2lmeShwYXRjaCl9XFxuYCxcbiAgICAgIH0pO1xuICAgIH0sXG4gIH0pO1xuXG4gIGZ1bmN0aW9uIGVtaXRMb2dDaHVuayhkZWx0YTogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKGxvZ0Nsb3NlZCkgcmV0dXJuO1xuICAgIGNvbnN0IGNvbWJpbmVkID0gbG9nQnVmZmVyICsgZGVsdGE7XG4gICAgY29uc3QgbWF0Y2ggPSBjb21iaW5lZC5zZWFyY2goLyhefFxcbilcXFxce1xcXCJvcFxcXCJcXFxccyo6Lyk7XG4gICAgaWYgKG1hdGNoID49IDApIHtcbiAgICAgIGNvbnN0IHNhZmVUZXh0ID0gY29tYmluZWQuc2xpY2UoMCwgbWF0Y2gpO1xuICAgICAgaWYgKHNhZmVUZXh0KSB7XG4gICAgICAgIGVtaXRDaHVuayh7IHJlcXVlc3RJZCwga2luZDogJ2xvZycsIHZhbHVlOiBzYWZlVGV4dCB9KTtcbiAgICAgIH1cbiAgICAgIGxvZ0Nsb3NlZCA9IHRydWU7XG4gICAgICBsb2dCdWZmZXIgPSAnJztcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZW1pdENodW5rKHsgcmVxdWVzdElkLCBraW5kOiAnbG9nJywgdmFsdWU6IGRlbHRhIH0pO1xuICAgIGxvZ0J1ZmZlciA9IGNvbWJpbmVkLnNsaWNlKC0yNCk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHB1c2g6IChjaHVuazogc3RyaW5nKSA9PiB7XG4gICAgICBlbWl0TG9nQ2h1bmsoY2h1bmspO1xuICAgICAgcGFyc2VyLnB1c2goY2h1bmspO1xuICAgIH0sXG4gICAgZmx1c2g6ICgpID0+IHBhcnNlci5mbHVzaCgpLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VuZEFnZW50Q2hhdChcbiAgaW5wdXQ6IEFnZW50Q2hhdElucHV0LFxuICBlbWl0Q2h1bms/OiAoY2h1bms6IEFnZW50Q2hhdFN0cmVhbUNodW5rKSA9PiB2b2lkLFxuKTogUHJvbWlzZTxBZ2VudENoYXRSZXN1bHQ+IHtcbiAgY29uc3QgcHJvZmlsZSA9IGF3YWl0IGdldEFnZW50UHJvZmlsZSh7IGFnZW50SWQ6IGlucHV0LmFnZW50SWQsIGhvbWVEaXJPdmVycmlkZTogaW5wdXQuaG9tZURpck92ZXJyaWRlIH0pO1xuICBjb25zdCBjb25maWcgPSBhd2FpdCBlbnN1cmVaZXJvQ2xhd0NvbmZpZyhpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBjb25uZWN0aW9uID0gY29uZmlnLnByb3ZpZGVyQ29ubmVjdGlvbnMuZmluZChcbiAgICAoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkID09PSBwcm9maWxlLmRlZmF1bHRMbG0ucHJvdmlkZXJJZCxcbiAgKTtcbiAgY29uc3QgdGltZW91dE1zID0gY29uZmlnLmRlZmF1bHRzLnRpbWVvdXRNcyA/PyBERUZBVUxUX1JFUVVFU1RfVElNRU9VVF9NUztcblxuICBjb25zdCBzaG91bGRXZWF0aGVyID0gc2hvdWxkVXNlV2VhdGhlclNraWxsKGlucHV0Lm1lc3NhZ2UpO1xuICBsZXQgd2VhdGhlclByb3BzOiBXZWF0aGVyU2tpbGxQcm9wcyB8IHVuZGVmaW5lZDtcbiAgbGV0IHdlYXRoZXJFcnJvcjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBpZiAoc2hvdWxkV2VhdGhlcikge1xuICAgIHRyeSB7XG4gICAgICB3ZWF0aGVyUHJvcHMgPSBhd2FpdCBmZXRjaFdlYXRoZXIoZXh0cmFjdENpdHlJZChpbnB1dC5tZXNzYWdlKSwgdGltZW91dE1zKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgd2VhdGhlckVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIGlmICghY29ubmVjdGlvbj8uYXBpS2V5UGxhaW50ZXh0IHx8ICFjb25uZWN0aW9uLmFwaUJhc2UpIHtcbiAgICBpZiAod2VhdGhlclByb3BzKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBjb250ZW50OiBidWlsZFdlYXRoZXJGYWxsYmFja1Jlc3BvbnNlKHdlYXRoZXJQcm9wcyksXG4gICAgICAgIHVzZWRGYWxsYmFjazogdHJ1ZSxcbiAgICAgICAgZXJyb3I6ICdcdTdGM0FcdTVDMTEgQVBJIEtleScsXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBjb250ZW50OiAnXHU2QTIxXHU1NzhCXHU2NzJBXHU5MTREXHU3RjZFIEFQSSBLZXlcdUZGMENcdThCRjdcdTUxNDhcdTU3MjhcdThCQkVcdTdGNkVcdTRFMkRcdTVCOENcdTYyMTBcdThGREVcdTYzQTVcdTMwMDInLFxuICAgICAgZXJyb3I6ICdcdTdGM0FcdTVDMTEgQVBJIEtleScsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IHNraWxsRG9jcyA9IGF3YWl0IGxvYWRTa2lsbERvY3MocHJvZmlsZSwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgaWYgKHNob3VsZFdlYXRoZXIpIHtcbiAgICBjb25zdCBhcHBTa2lsbHNSb290ID0gcmVzb2x2ZUFwcFNraWxsc1Jvb3QoKTtcbiAgICBjb25zdCB3ZWF0aGVyRG9jID0gYXdhaXQgcmVhZFNraWxsRG9jRnJvbUZvbGRlcihwYXRoLmpvaW4oYXBwU2tpbGxzUm9vdCwgJ3dlYXRoZXItY2FyZCcpKTtcbiAgICBpZiAod2VhdGhlckRvYykge1xuICAgICAgc2tpbGxEb2NzLnB1c2god2VhdGhlckRvYyk7XG4gICAgfVxuICB9XG5cbiAgY29uc3Qgc3lzdGVtUHJvbXB0ID0gYnVpbGRTeXN0ZW1Qcm9tcHQocHJvZmlsZSwgc2tpbGxEb2NzLCB3ZWF0aGVyUHJvcHMsIHdlYXRoZXJFcnJvcik7XG4gIGNvbnN0IG1lc3NhZ2VzOiBPcGVuQUlDaGF0TWVzc2FnZVtdID0gW1xuICAgIHsgcm9sZTogJ3N5c3RlbScsIGNvbnRlbnQ6IHN5c3RlbVByb21wdCB9LFxuICAgIC4uLm5vcm1hbGl6ZUhpc3RvcnkoaW5wdXQuaGlzdG9yeSksXG4gICAgeyByb2xlOiAndXNlcicsIGNvbnRlbnQ6IGlucHV0Lm1lc3NhZ2UgfSxcbiAgXTtcblxuICB0cnkge1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9IGlucHV0LnJlcXVlc3RJZCA/PyBgcmVxXyR7RGF0ZS5ub3coKX1gO1xuICAgIGNvbnN0IHBhcnNlciA9IGlucHV0LnN0cmVhbSAmJiBlbWl0Q2h1bmsgPyBjcmVhdGVDaGF0TW9kZVBhcnNlcihlbWl0Q2h1bmssIHJlcXVlc3RJZCkgOiBudWxsO1xuICAgIGNvbnN0IG9uRGVsdGEgPSBpbnB1dC5zdHJlYW0gJiYgZW1pdENodW5rXG4gICAgICA/IChkZWx0YTogc3RyaW5nKSA9PiBwYXJzZXI/LnB1c2goZGVsdGEpXG4gICAgICA6IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IGNvbnRlbnQgPSBpbnB1dC5zdHJlYW1cbiAgICAgID8gYXdhaXQgcmVxdWVzdENoYXRDb21wbGV0aW9uU3RyZWFtKFxuICAgICAgICBjb25uZWN0aW9uLmFwaUJhc2UsXG4gICAgICAgIGNvbm5lY3Rpb24uYXBpS2V5UGxhaW50ZXh0LFxuICAgICAgICBwcm9maWxlLmRlZmF1bHRMbG0ubW9kZWxOYW1lLFxuICAgICAgICBtZXNzYWdlcyxcbiAgICAgICAgdGltZW91dE1zLFxuICAgICAgICBvbkRlbHRhLFxuICAgICAgKVxuICAgICAgOiBhd2FpdCByZXF1ZXN0Q2hhdENvbXBsZXRpb24oXG4gICAgICAgIGNvbm5lY3Rpb24uYXBpQmFzZSxcbiAgICAgICAgY29ubmVjdGlvbi5hcGlLZXlQbGFpbnRleHQsXG4gICAgICAgIHByb2ZpbGUuZGVmYXVsdExsbS5tb2RlbE5hbWUsXG4gICAgICAgIG1lc3NhZ2VzLFxuICAgICAgICB0aW1lb3V0TXMsXG4gICAgICApO1xuXG4gICAgaWYgKGlucHV0LnN0cmVhbSAmJiBlbWl0Q2h1bmspIHtcbiAgICAgIHBhcnNlcj8uZmx1c2goKTtcbiAgICAgIGVtaXRDaHVuayh7IHJlcXVlc3RJZCwga2luZDogJ2RvbmUnIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGNvbnRlbnQgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zdCByYXdNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgIGNvbnN0IGlzQWJvcnQgPVxuICAgICAgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubmFtZSA9PT0gJ0Fib3J0RXJyb3InKSB8fFxuICAgICAgL2Fib3J0ZWQvaS50ZXN0KHJhd01lc3NhZ2UpO1xuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGlzQWJvcnRcbiAgICAgID8gYFx1OEJGN1x1NkM0Mlx1OEQ4NVx1NjVGNlx1RkYwOCR7TWF0aC5yb3VuZCh0aW1lb3V0TXMgLyAxMDAwKX1cdTc5RDJcdUZGMDlcdUZGMENcdThCRjdcdTY4QzBcdTY3RTVcdTdGNTFcdTdFRENcdTYyMTZcdTZBMjFcdTU3OEJcdTY3MERcdTUyQTFcdTU0Q0RcdTVFOTRcdTkwMUZcdTVFQTZcdTMwMDJgXG4gICAgICA6IHJhd01lc3NhZ2U7XG4gICAgaWYgKGlucHV0LnN0cmVhbSAmJiBlbWl0Q2h1bmspIHtcbiAgICAgIGVtaXRDaHVuayh7XG4gICAgICAgIHJlcXVlc3RJZDogaW5wdXQucmVxdWVzdElkID8/IGByZXFfJHtEYXRlLm5vdygpfWAsXG4gICAgICAgIGtpbmQ6ICdlcnJvcicsXG4gICAgICAgIHZhbHVlOiBlcnJvck1lc3NhZ2UsXG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHdlYXRoZXJQcm9wcykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgY29udGVudDogYnVpbGRXZWF0aGVyRmFsbGJhY2tSZXNwb25zZSh3ZWF0aGVyUHJvcHMpLFxuICAgICAgICB1c2VkRmFsbGJhY2s6IHRydWUsXG4gICAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGNvbnRlbnQ6IGVycm9yTWVzc2FnZSxcbiAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXG4gICAgfTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHogfSBmcm9tIFwiem9kXCI7XG5pbXBvcnQgdHlwZSB7IEFjdGlvbkJpbmRpbmcgfSBmcm9tIFwiLi9hY3Rpb25zXCI7XG5cbi8qKlxuICogRHluYW1pYyB2YWx1ZSAtIGNhbiBiZSBhIGxpdGVyYWwgb3IgYSBgeyAkc3RhdGUgfWAgcmVmZXJlbmNlIHRvIHRoZSBzdGF0ZSBtb2RlbC5cbiAqXG4gKiBVc2VkIGluIGFjdGlvbiBwYXJhbXMgYW5kIHZhbGlkYXRpb24gYXJncyB3aGVyZSB2YWx1ZXMgY2FuIGVpdGhlciBiZVxuICogaGFyZGNvZGVkIG9yIHJlc29sdmVkIGZyb20gc3RhdGUgYXQgcnVudGltZS5cbiAqL1xuZXhwb3J0IHR5cGUgRHluYW1pY1ZhbHVlPFQgPSB1bmtub3duPiA9IFQgfCB7ICRzdGF0ZTogc3RyaW5nIH07XG5cbi8qKlxuICogRHluYW1pYyBzdHJpbmcgdmFsdWVcbiAqL1xuZXhwb3J0IHR5cGUgRHluYW1pY1N0cmluZyA9IER5bmFtaWNWYWx1ZTxzdHJpbmc+O1xuXG4vKipcbiAqIER5bmFtaWMgbnVtYmVyIHZhbHVlXG4gKi9cbmV4cG9ydCB0eXBlIER5bmFtaWNOdW1iZXIgPSBEeW5hbWljVmFsdWU8bnVtYmVyPjtcblxuLyoqXG4gKiBEeW5hbWljIGJvb2xlYW4gdmFsdWVcbiAqL1xuZXhwb3J0IHR5cGUgRHluYW1pY0Jvb2xlYW4gPSBEeW5hbWljVmFsdWU8Ym9vbGVhbj47XG5cbi8qKlxuICogWm9kIHNjaGVtYSBmb3IgZHluYW1pYyB2YWx1ZXNcbiAqL1xuZXhwb3J0IGNvbnN0IER5bmFtaWNWYWx1ZVNjaGVtYSA9IHoudW5pb24oW1xuICB6LnN0cmluZygpLFxuICB6Lm51bWJlcigpLFxuICB6LmJvb2xlYW4oKSxcbiAgei5udWxsKCksXG4gIHoub2JqZWN0KHsgJHN0YXRlOiB6LnN0cmluZygpIH0pLFxuXSk7XG5cbmV4cG9ydCBjb25zdCBEeW5hbWljU3RyaW5nU2NoZW1hID0gei51bmlvbihbXG4gIHouc3RyaW5nKCksXG4gIHoub2JqZWN0KHsgJHN0YXRlOiB6LnN0cmluZygpIH0pLFxuXSk7XG5cbmV4cG9ydCBjb25zdCBEeW5hbWljTnVtYmVyU2NoZW1hID0gei51bmlvbihbXG4gIHoubnVtYmVyKCksXG4gIHoub2JqZWN0KHsgJHN0YXRlOiB6LnN0cmluZygpIH0pLFxuXSk7XG5cbmV4cG9ydCBjb25zdCBEeW5hbWljQm9vbGVhblNjaGVtYSA9IHoudW5pb24oW1xuICB6LmJvb2xlYW4oKSxcbiAgei5vYmplY3QoeyAkc3RhdGU6IHouc3RyaW5nKCkgfSksXG5dKTtcblxuLyoqXG4gKiBCYXNlIFVJIGVsZW1lbnQgc3RydWN0dXJlIGZvciB2MlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVJRWxlbWVudDxcbiAgVCBleHRlbmRzIHN0cmluZyA9IHN0cmluZyxcbiAgUCA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuPiB7XG4gIC8qKiBDb21wb25lbnQgdHlwZSBmcm9tIHRoZSBjYXRhbG9nICovXG4gIHR5cGU6IFQ7XG4gIC8qKiBDb21wb25lbnQgcHJvcHMgKi9cbiAgcHJvcHM6IFA7XG4gIC8qKiBDaGlsZCBlbGVtZW50IGtleXMgKGZsYXQgc3RydWN0dXJlKSAqL1xuICBjaGlsZHJlbj86IHN0cmluZ1tdO1xuICAvKiogVmlzaWJpbGl0eSBjb25kaXRpb24gKi9cbiAgdmlzaWJsZT86IFZpc2liaWxpdHlDb25kaXRpb247XG4gIC8qKiBFdmVudCBiaW5kaW5ncyDigJQgbWFwcyBldmVudCBuYW1lcyB0byBhY3Rpb24gYmluZGluZ3MgKi9cbiAgb24/OiBSZWNvcmQ8c3RyaW5nLCBBY3Rpb25CaW5kaW5nIHwgQWN0aW9uQmluZGluZ1tdPjtcbiAgLyoqIFJlcGVhdCBjaGlsZHJlbiBvbmNlIHBlciBpdGVtIGluIGEgc3RhdGUgYXJyYXkgKi9cbiAgcmVwZWF0PzogeyBzdGF0ZVBhdGg6IHN0cmluZzsga2V5Pzogc3RyaW5nIH07XG4gIC8qKlxuICAgKiBTdGF0ZSB3YXRjaGVycyDigJQgbWFwcyBKU09OIFBvaW50ZXIgc3RhdGUgcGF0aHMgdG8gYWN0aW9uIGJpbmRpbmdzLlxuICAgKiBXaGVuIHRoZSB2YWx1ZSBhdCBhIHdhdGNoZWQgcGF0aCBjaGFuZ2VzLCB0aGUgYm91bmQgYWN0aW9ucyBmaXJlLlxuICAgKiBVc2VmdWwgZm9yIGNhc2NhZGluZyBkZXBlbmRlbmNpZXMgKGUuZy4gY291bnRyeSDihpIgY2l0eSBvcHRpb24gbG9hZGluZykuXG4gICAqL1xuICB3YXRjaD86IFJlY29yZDxzdHJpbmcsIEFjdGlvbkJpbmRpbmcgfCBBY3Rpb25CaW5kaW5nW10+O1xufVxuXG4vKipcbiAqIEVsZW1lbnQgd2l0aCBrZXkgYW5kIHBhcmVudEtleSBmb3IgdXNlIHdpdGggZmxhdFRvVHJlZS5cbiAqIFdoZW4gZWxlbWVudHMgYXJlIGluIGFuIGFycmF5IChub3QgYSBrZXllZCBtYXApLCBrZXkgYW5kIHBhcmVudEtleVxuICogYXJlIG5lZWRlZCB0byBlc3RhYmxpc2ggaWRlbnRpdHkgYW5kIHBhcmVudC1jaGlsZCByZWxhdGlvbnNoaXBzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEZsYXRFbGVtZW50PFxuICBUIGV4dGVuZHMgc3RyaW5nID0gc3RyaW5nLFxuICBQID0gUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4+IGV4dGVuZHMgVUlFbGVtZW50PFQsIFA+IHtcbiAgLyoqIFVuaXF1ZSBrZXkgaWRlbnRpZnlpbmcgdGhpcyBlbGVtZW50ICovXG4gIGtleTogc3RyaW5nO1xuICAvKiogUGFyZW50IGVsZW1lbnQga2V5IChudWxsIGZvciByb290KSAqL1xuICBwYXJlbnRLZXk/OiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIFNoYXJlZCBjb21wYXJpc29uIG9wZXJhdG9ycyBmb3IgdmlzaWJpbGl0eSBjb25kaXRpb25zLlxuICpcbiAqIFVzZSBhdCBtb3N0IE9ORSBjb21wYXJpc29uIG9wZXJhdG9yIHBlciBjb25kaXRpb24uIElmIG11bHRpcGxlIGFyZVxuICogcHJvdmlkZWQsIG9ubHkgdGhlIGZpcnN0IG1hdGNoaW5nIG9uZSBpcyBldmFsdWF0ZWQgKHByZWNlZGVuY2U6XG4gKiBlcSA+IG5lcSA+IGd0ID4gZ3RlID4gbHQgPiBsdGUpLiBXaXRoIG5vIG9wZXJhdG9yLCB0cnV0aGluZXNzIGlzIGNoZWNrZWQuXG4gKlxuICogYG5vdGAgaW52ZXJ0cyB0aGUgZmluYWwgcmVzdWx0IG9mIHdoaWNoZXZlciBvcGVyYXRvciAob3IgdHJ1dGhpbmVzc1xuICogY2hlY2spIGlzIHVzZWQuXG4gKi9cbnR5cGUgQ29tcGFyaXNvbk9wZXJhdG9ycyA9IHtcbiAgZXE/OiB1bmtub3duO1xuICBuZXE/OiB1bmtub3duO1xuICBndD86IG51bWJlciB8IHsgJHN0YXRlOiBzdHJpbmcgfTtcbiAgZ3RlPzogbnVtYmVyIHwgeyAkc3RhdGU6IHN0cmluZyB9O1xuICBsdD86IG51bWJlciB8IHsgJHN0YXRlOiBzdHJpbmcgfTtcbiAgbHRlPzogbnVtYmVyIHwgeyAkc3RhdGU6IHN0cmluZyB9O1xuICBub3Q/OiB0cnVlO1xufTtcblxuLyoqXG4gKiBBIHNpbmdsZSBzdGF0ZS1iYXNlZCBjb25kaXRpb24uXG4gKiBSZXNvbHZlcyBgJHN0YXRlYCB0byBhIHZhbHVlIGZyb20gdGhlIHN0YXRlIG1vZGVsLCB0aGVuIGFwcGxpZXMgdGhlIG9wZXJhdG9yLlxuICogV2l0aG91dCBhbiBvcGVyYXRvciwgY2hlY2tzIHRydXRoaW5lc3MuXG4gKlxuICogV2hlbiBgbm90YCBpcyBgdHJ1ZWAsIHRoZSByZXN1bHQgb2YgdGhlIGVudGlyZSBjb25kaXRpb24gaXMgaW52ZXJ0ZWQuXG4gKiBGb3IgZXhhbXBsZSBgeyAkc3RhdGU6IFwiL2NvdW50XCIsIGd0OiA1LCBub3Q6IHRydWUgfWAgbWVhbnMgXCJOT1QgZ3JlYXRlciB0aGFuIDVcIi5cbiAqL1xuZXhwb3J0IHR5cGUgU3RhdGVDb25kaXRpb24gPSB7ICRzdGF0ZTogc3RyaW5nIH0gJiBDb21wYXJpc29uT3BlcmF0b3JzO1xuXG4vKipcbiAqIEEgY29uZGl0aW9uIHRoYXQgcmVzb2x2ZXMgYCRpdGVtYCB0byBhIGZpZWxkIG9uIHRoZSBjdXJyZW50IHJlcGVhdCBpdGVtLlxuICogT25seSBtZWFuaW5nZnVsIGluc2lkZSBhIGByZXBlYXRgIHNjb3BlLlxuICpcbiAqIFVzZSBgXCJcImAgdG8gcmVmZXJlbmNlIHRoZSB3aG9sZSBpdGVtLCBvciBgXCJmaWVsZFwiYCBmb3IgYSBzcGVjaWZpYyBmaWVsZC5cbiAqL1xuZXhwb3J0IHR5cGUgSXRlbUNvbmRpdGlvbiA9IHsgJGl0ZW06IHN0cmluZyB9ICYgQ29tcGFyaXNvbk9wZXJhdG9ycztcblxuLyoqXG4gKiBBIGNvbmRpdGlvbiB0aGF0IHJlc29sdmVzIGAkaW5kZXhgIHRvIHRoZSBjdXJyZW50IHJlcGVhdCBhcnJheSBpbmRleC5cbiAqIE9ubHkgbWVhbmluZ2Z1bCBpbnNpZGUgYSBgcmVwZWF0YCBzY29wZS5cbiAqL1xuZXhwb3J0IHR5cGUgSW5kZXhDb25kaXRpb24gPSB7ICRpbmRleDogdHJ1ZSB9ICYgQ29tcGFyaXNvbk9wZXJhdG9ycztcblxuLyoqIEEgc2luZ2xlIHZpc2liaWxpdHkgY29uZGl0aW9uIChzdGF0ZSwgaXRlbSwgb3IgaW5kZXgpLiAqL1xuZXhwb3J0IHR5cGUgU2luZ2xlQ29uZGl0aW9uID0gU3RhdGVDb25kaXRpb24gfCBJdGVtQ29uZGl0aW9uIHwgSW5kZXhDb25kaXRpb247XG5cbi8qKlxuICogQU5EIHdyYXBwZXIg4oCUIGFsbCBjaGlsZCBjb25kaXRpb25zIG11c3QgYmUgdHJ1ZS5cbiAqIFRoaXMgaXMgdGhlIGV4cGxpY2l0IGZvcm0gb2YgdGhlIGltcGxpY2l0IGFycmF5IEFORCAoYFNpbmdsZUNvbmRpdGlvbltdYCkuXG4gKiBVbmxpa2UgdGhlIGltcGxpY2l0IGZvcm0sIGAkYW5kYCBzdXBwb3J0cyBuZXN0ZWQgYCRvcmAgYW5kIGAkYW5kYCBjb25kaXRpb25zLlxuICovXG5leHBvcnQgdHlwZSBBbmRDb25kaXRpb24gPSB7ICRhbmQ6IFZpc2liaWxpdHlDb25kaXRpb25bXSB9O1xuXG4vKipcbiAqIE9SIHdyYXBwZXIg4oCUIGF0IGxlYXN0IG9uZSBjaGlsZCBjb25kaXRpb24gbXVzdCBiZSB0cnVlLlxuICovXG5leHBvcnQgdHlwZSBPckNvbmRpdGlvbiA9IHsgJG9yOiBWaXNpYmlsaXR5Q29uZGl0aW9uW10gfTtcblxuLyoqXG4gKiBWaXNpYmlsaXR5IGNvbmRpdGlvbiB0eXBlcy5cbiAqIC0gYGJvb2xlYW5gIOKAlCBhbHdheXMvbmV2ZXJcbiAqIC0gYFNpbmdsZUNvbmRpdGlvbmAg4oCUIHNpbmdsZSBjb25kaXRpb24gKGAkc3RhdGVgLCBgJGl0ZW1gLCBvciBgJGluZGV4YClcbiAqIC0gYFNpbmdsZUNvbmRpdGlvbltdYCDigJQgaW1wbGljaXQgQU5EIChhbGwgbXVzdCBiZSB0cnVlKVxuICogLSBgQW5kQ29uZGl0aW9uYCDigJQgYHsgJGFuZDogWy4uLl0gfWAsIGV4cGxpY2l0IEFORCAoYWxsIG11c3QgYmUgdHJ1ZSlcbiAqIC0gYE9yQ29uZGl0aW9uYCDigJQgYHsgJG9yOiBbLi4uXSB9YCwgYXQgbGVhc3Qgb25lIG11c3QgYmUgdHJ1ZVxuICovXG5leHBvcnQgdHlwZSBWaXNpYmlsaXR5Q29uZGl0aW9uID1cbiAgfCBib29sZWFuXG4gIHwgU2luZ2xlQ29uZGl0aW9uXG4gIHwgU2luZ2xlQ29uZGl0aW9uW11cbiAgfCBBbmRDb25kaXRpb25cbiAgfCBPckNvbmRpdGlvbjtcblxuLyoqXG4gKiBGbGF0IFVJIHRyZWUgc3RydWN0dXJlIChvcHRpbWl6ZWQgZm9yIExMTSBnZW5lcmF0aW9uKVxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwZWMge1xuICAvKiogUm9vdCBlbGVtZW50IGtleSAqL1xuICByb290OiBzdHJpbmc7XG4gIC8qKiBGbGF0IG1hcCBvZiBlbGVtZW50cyBieSBrZXkgKi9cbiAgZWxlbWVudHM6IFJlY29yZDxzdHJpbmcsIFVJRWxlbWVudD47XG4gIC8qKiBPcHRpb25hbCBpbml0aWFsIHN0YXRlIHRvIHNlZWQgdGhlIHN0YXRlIG1vZGVsLlxuICAgKiAgQ29tcG9uZW50cyB1c2luZyBzdGF0ZVBhdGggd2lsbCByZWFkIGZyb20gLyB3cml0ZSB0byB0aGlzIHN0YXRlLiAqL1xuICBzdGF0ZT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG4vKipcbiAqIFN0YXRlIG1vZGVsIHR5cGVcbiAqL1xuZXhwb3J0IHR5cGUgU3RhdGVNb2RlbCA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXG4vKipcbiAqIEFuIGFic3RyYWN0IHN0b3JlIHRoYXQgb3ducyBzdGF0ZSBhbmQgbm90aWZpZXMgc3Vic2NyaWJlcnMgb24gY2hhbmdlLlxuICpcbiAqIENvbnN1bWVycyBjYW4gc3VwcGx5IHRoZWlyIG93biBpbXBsZW1lbnRhdGlvbiAoYmFja2VkIGJ5IFJlZHV4LCBadXN0YW5kLFxuICogWFN0YXRlLCBldGMuKSBvciB1c2UgdGhlIGJ1aWx0LWluIHtAbGluayBjcmVhdGVTdGF0ZVN0b3JlfSBmb3IgYSBzaW1wbGVcbiAqIGluLW1lbW9yeSBzdG9yZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdGF0ZVN0b3JlIHtcbiAgLyoqIFJlYWQgYSB2YWx1ZSBieSBKU09OIFBvaW50ZXIgcGF0aC4gKi9cbiAgZ2V0OiAocGF0aDogc3RyaW5nKSA9PiB1bmtub3duO1xuICAvKipcbiAgICogV3JpdGUgYSB2YWx1ZSBieSBKU09OIFBvaW50ZXIgcGF0aCBhbmQgbm90aWZ5IHN1YnNjcmliZXJzLlxuICAgKiBFcXVhbGl0eSBpcyBjaGVja2VkIGJ5IHJlZmVyZW5jZSAoYD09PWApLCBub3QgZGVlcCBjb21wYXJpc29uLlxuICAgKiBDYWxsZXJzIG11c3QgcGFzcyBhIG5ldyBvYmplY3QvYXJyYXkgcmVmZXJlbmNlIGZvciBjaGFuZ2VzIHRvIGJlIGRldGVjdGVkLlxuICAgKi9cbiAgc2V0OiAocGF0aDogc3RyaW5nLCB2YWx1ZTogdW5rbm93bikgPT4gdm9pZDtcbiAgLyoqXG4gICAqIFdyaXRlIG11bHRpcGxlIHZhbHVlcyBhdCBvbmNlIGFuZCBub3RpZnkgc3Vic2NyaWJlcnMgKHNpbmdsZSBub3RpZmljYXRpb24pLlxuICAgKiBFYWNoIHZhbHVlIGlzIGNvbXBhcmVkIGJ5IHJlZmVyZW5jZSAoYD09PWApOyBvbmx5IHBhdGhzIHdob3NlIHZhbHVlXG4gICAqIGFjdHVhbGx5IGNoYW5nZWQgYXJlIGFwcGxpZWQuXG4gICAqL1xuICB1cGRhdGU6ICh1cGRhdGVzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZDtcbiAgLyoqIFJldHVybiB0aGUgZnVsbCBzdGF0ZSBvYmplY3QgKHVzZWQgYnkgYHVzZVN5bmNFeHRlcm5hbFN0b3JlYCkuICovXG4gIGdldFNuYXBzaG90OiAoKSA9PiBTdGF0ZU1vZGVsO1xuICAvKiogT3B0aW9uYWwgc2VydmVyIHNuYXBzaG90IGZvciBTU1IgKHBhc3NlZCB0byBgdXNlU3luY0V4dGVybmFsU3RvcmVgKS4gRmFsbHMgYmFjayB0byBgZ2V0U25hcHNob3RgIHdoZW4gb21pdHRlZC4gKi9cbiAgZ2V0U2VydmVyU25hcHNob3Q/OiAoKSA9PiBTdGF0ZU1vZGVsO1xuICAvKiogUmVnaXN0ZXIgYSBsaXN0ZW5lciB0aGF0IGlzIGNhbGxlZCBvbiBldmVyeSBzdGF0ZSBjaGFuZ2UuIFJldHVybnMgYW4gdW5zdWJzY3JpYmUgZnVuY3Rpb24uICovXG4gIHN1YnNjcmliZTogKGxpc3RlbmVyOiAoKSA9PiB2b2lkKSA9PiAoKSA9PiB2b2lkO1xufVxuXG4vKipcbiAqIENvbXBvbmVudCBzY2hlbWEgZGVmaW5pdGlvbiB1c2luZyBab2RcbiAqL1xuZXhwb3J0IHR5cGUgQ29tcG9uZW50U2NoZW1hID0gei5ab2RUeXBlPFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcblxuLyoqXG4gKiBWYWxpZGF0aW9uIG1vZGUgZm9yIGNhdGFsb2cgdmFsaWRhdGlvblxuICovXG5leHBvcnQgdHlwZSBWYWxpZGF0aW9uTW9kZSA9IFwic3RyaWN0XCIgfCBcIndhcm5cIiB8IFwiaWdub3JlXCI7XG5cbi8qKlxuICogSlNPTiBwYXRjaCBvcGVyYXRpb24gdHlwZXMgKFJGQyA2OTAyKVxuICovXG5leHBvcnQgdHlwZSBQYXRjaE9wID0gXCJhZGRcIiB8IFwicmVtb3ZlXCIgfCBcInJlcGxhY2VcIiB8IFwibW92ZVwiIHwgXCJjb3B5XCIgfCBcInRlc3RcIjtcblxuLyoqXG4gKiBKU09OIHBhdGNoIG9wZXJhdGlvbiAoUkZDIDY5MDIpXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSnNvblBhdGNoIHtcbiAgb3A6IFBhdGNoT3A7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFJlcXVpcmVkIGZvciBhZGQsIHJlcGxhY2UsIHRlc3QgKi9cbiAgdmFsdWU/OiB1bmtub3duO1xuICAvKiogUmVxdWlyZWQgZm9yIG1vdmUsIGNvcHkgKHNvdXJjZSBsb2NhdGlvbikgKi9cbiAgZnJvbT86IHN0cmluZztcbn1cblxuLyoqXG4gKiBSZXNvbHZlIGEgZHluYW1pYyB2YWx1ZSBhZ2FpbnN0IGEgc3RhdGUgbW9kZWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVEeW5hbWljVmFsdWU8VD4oXG4gIHZhbHVlOiBEeW5hbWljVmFsdWU8VD4sXG4gIHN0YXRlTW9kZWw6IFN0YXRlTW9kZWwsXG4pOiBUIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiBcIiRzdGF0ZVwiIGluIHZhbHVlKSB7XG4gICAgcmV0dXJuIGdldEJ5UGF0aChzdGF0ZU1vZGVsLCAodmFsdWUgYXMgeyAkc3RhdGU6IHN0cmluZyB9KS4kc3RhdGUpIGFzXG4gICAgICB8IFRcbiAgICAgIHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIHZhbHVlIGFzIFQ7XG59XG5cbi8qKlxuICogVW5lc2NhcGUgYSBKU09OIFBvaW50ZXIgdG9rZW4gcGVyIFJGQyA2OTAxIFNlY3Rpb24gNC5cbiAqIH4xIGlzIGRlY29kZWQgdG8gLyBhbmQgfjAgaXMgZGVjb2RlZCB0byB+IChvcmRlciBtYXR0ZXJzKS5cbiAqL1xuZnVuY3Rpb24gdW5lc2NhcGVKc29uUG9pbnRlcih0b2tlbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRva2VuLnJlcGxhY2UoL34xL2csIFwiL1wiKS5yZXBsYWNlKC9+MC9nLCBcIn5cIik7XG59XG5cbi8qKlxuICogUGFyc2UgYSBKU09OIFBvaW50ZXIgcGF0aCBpbnRvIHVuZXNjYXBlZCBzZWdtZW50cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSnNvblBvaW50ZXIocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCByYXcgPSBwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpID8gcGF0aC5zbGljZSgxKS5zcGxpdChcIi9cIikgOiBwYXRoLnNwbGl0KFwiL1wiKTtcbiAgcmV0dXJuIHJhdy5tYXAodW5lc2NhcGVKc29uUG9pbnRlcik7XG59XG5cbi8qKlxuICogR2V0IGEgdmFsdWUgZnJvbSBhbiBvYmplY3QgYnkgSlNPTiBQb2ludGVyIHBhdGggKFJGQyA2OTAxKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0QnlQYXRoKG9iajogdW5rbm93biwgcGF0aDogc3RyaW5nKTogdW5rbm93biB7XG4gIGlmICghcGF0aCB8fCBwYXRoID09PSBcIi9cIikge1xuICAgIHJldHVybiBvYmo7XG4gIH1cblxuICBjb25zdCBzZWdtZW50cyA9IHBhcnNlSnNvblBvaW50ZXIocGF0aCk7XG5cbiAgbGV0IGN1cnJlbnQ6IHVua25vd24gPSBvYmo7XG5cbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZ21lbnRzKSB7XG4gICAgaWYgKGN1cnJlbnQgPT09IG51bGwgfHwgY3VycmVudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGN1cnJlbnQpKSB7XG4gICAgICBjb25zdCBpbmRleCA9IHBhcnNlSW50KHNlZ21lbnQsIDEwKTtcbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50W2luZGV4XTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBjdXJyZW50ID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBjdXJyZW50ID0gKGN1cnJlbnQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pW3NlZ21lbnRdO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjdXJyZW50O1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGEgc3RyaW5nIGlzIGEgbnVtZXJpYyBpbmRleFxuICovXG5mdW5jdGlvbiBpc051bWVyaWNJbmRleChzdHI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL15cXGQrJC8udGVzdChzdHIpO1xufVxuXG4vKipcbiAqIFNldCBhIHZhbHVlIGluIGFuIG9iamVjdCBieSBKU09OIFBvaW50ZXIgcGF0aCAoUkZDIDY5MDEpLlxuICogQXV0b21hdGljYWxseSBjcmVhdGVzIGFycmF5cyB3aGVuIHRoZSBwYXRoIHNlZ21lbnQgaXMgYSBudW1lcmljIGluZGV4LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0QnlQYXRoKFxuICBvYmo6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICBwYXRoOiBzdHJpbmcsXG4gIHZhbHVlOiB1bmtub3duLFxuKTogdm9pZCB7XG4gIGNvbnN0IHNlZ21lbnRzID0gcGFyc2VKc29uUG9pbnRlcihwYXRoKTtcblxuICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgbGV0IGN1cnJlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5rbm93bltdID0gb2JqO1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY29uc3Qgc2VnbWVudCA9IHNlZ21lbnRzW2ldITtcbiAgICBjb25zdCBuZXh0U2VnbWVudCA9IHNlZ21lbnRzW2kgKyAxXTtcbiAgICBjb25zdCBuZXh0SXNOdW1lcmljID1cbiAgICAgIG5leHRTZWdtZW50ICE9PSB1bmRlZmluZWQgJiZcbiAgICAgIChpc051bWVyaWNJbmRleChuZXh0U2VnbWVudCkgfHwgbmV4dFNlZ21lbnQgPT09IFwiLVwiKTtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGN1cnJlbnQpKSB7XG4gICAgICBjb25zdCBpbmRleCA9IHBhcnNlSW50KHNlZ21lbnQsIDEwKTtcbiAgICAgIGlmIChjdXJyZW50W2luZGV4XSA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiBjdXJyZW50W2luZGV4XSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgICBjdXJyZW50W2luZGV4XSA9IG5leHRJc051bWVyaWMgPyBbXSA6IHt9O1xuICAgICAgfVxuICAgICAgY3VycmVudCA9IGN1cnJlbnRbaW5kZXhdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5rbm93bltdO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIShzZWdtZW50IGluIGN1cnJlbnQpIHx8IHR5cGVvZiBjdXJyZW50W3NlZ21lbnRdICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIGN1cnJlbnRbc2VnbWVudF0gPSBuZXh0SXNOdW1lcmljID8gW10gOiB7fTtcbiAgICAgIH1cbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50W3NlZ21lbnRdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5rbm93bltdO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGxhc3RTZWdtZW50ID0gc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0hO1xuICBpZiAoQXJyYXkuaXNBcnJheShjdXJyZW50KSkge1xuICAgIGlmIChsYXN0U2VnbWVudCA9PT0gXCItXCIpIHtcbiAgICAgIGN1cnJlbnQucHVzaCh2YWx1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGluZGV4ID0gcGFyc2VJbnQobGFzdFNlZ21lbnQsIDEwKTtcbiAgICAgIGN1cnJlbnRbaW5kZXhdID0gdmFsdWU7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGN1cnJlbnRbbGFzdFNlZ21lbnRdID0gdmFsdWU7XG4gIH1cbn1cblxuLyoqXG4gKiBBZGQgYSB2YWx1ZSBwZXIgUkZDIDY5MDIgXCJhZGRcIiBzZW1hbnRpY3MuXG4gKiBGb3Igb2JqZWN0czogY3JlYXRlLW9yLXJlcGxhY2UgdGhlIG1lbWJlci5cbiAqIEZvciBhcnJheXM6IGluc2VydCBiZWZvcmUgdGhlIGdpdmVuIGluZGV4LCBvciBhcHBlbmQgaWYgXCItXCIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZGRCeVBhdGgoXG4gIG9iajogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gIHBhdGg6IHN0cmluZyxcbiAgdmFsdWU6IHVua25vd24sXG4pOiB2b2lkIHtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXJzZUpzb25Qb2ludGVyKHBhdGgpO1xuXG4gIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICBsZXQgY3VycmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmtub3duW10gPSBvYmo7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICBjb25zdCBzZWdtZW50ID0gc2VnbWVudHNbaV0hO1xuICAgIGNvbnN0IG5leHRTZWdtZW50ID0gc2VnbWVudHNbaSArIDFdO1xuICAgIGNvbnN0IG5leHRJc051bWVyaWMgPVxuICAgICAgbmV4dFNlZ21lbnQgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgKGlzTnVtZXJpY0luZGV4KG5leHRTZWdtZW50KSB8fCBuZXh0U2VnbWVudCA9PT0gXCItXCIpO1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoY3VycmVudCkpIHtcbiAgICAgIGNvbnN0IGluZGV4ID0gcGFyc2VJbnQoc2VnbWVudCwgMTApO1xuICAgICAgaWYgKGN1cnJlbnRbaW5kZXhdID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIGN1cnJlbnRbaW5kZXhdICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIGN1cnJlbnRbaW5kZXhdID0gbmV4dElzTnVtZXJpYyA/IFtdIDoge307XG4gICAgICB9XG4gICAgICBjdXJyZW50ID0gY3VycmVudFtpbmRleF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmtub3duW107XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghKHNlZ21lbnQgaW4gY3VycmVudCkgfHwgdHlwZW9mIGN1cnJlbnRbc2VnbWVudF0gIT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgY3VycmVudFtzZWdtZW50XSA9IG5leHRJc051bWVyaWMgPyBbXSA6IHt9O1xuICAgICAgfVxuICAgICAgY3VycmVudCA9IGN1cnJlbnRbc2VnbWVudF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmtub3duW107XG4gICAgfVxuICB9XG5cbiAgY29uc3QgbGFzdFNlZ21lbnQgPSBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSE7XG4gIGlmIChBcnJheS5pc0FycmF5KGN1cnJlbnQpKSB7XG4gICAgaWYgKGxhc3RTZWdtZW50ID09PSBcIi1cIikge1xuICAgICAgY3VycmVudC5wdXNoKHZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgaW5kZXggPSBwYXJzZUludChsYXN0U2VnbWVudCwgMTApO1xuICAgICAgY3VycmVudC5zcGxpY2UoaW5kZXgsIDAsIHZhbHVlKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY3VycmVudFtsYXN0U2VnbWVudF0gPSB2YWx1ZTtcbiAgfVxufVxuXG4vKipcbiAqIFJlbW92ZSBhIHZhbHVlIHBlciBSRkMgNjkwMiBcInJlbW92ZVwiIHNlbWFudGljcy5cbiAqIEZvciBvYmplY3RzOiBkZWxldGUgdGhlIHByb3BlcnR5LlxuICogRm9yIGFycmF5czogc3BsaWNlIG91dCB0aGUgZWxlbWVudCBhdCB0aGUgZ2l2ZW4gaW5kZXguXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVCeVBhdGgob2JqOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgcGF0aDogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHNlZ21lbnRzID0gcGFyc2VKc29uUG9pbnRlcihwYXRoKTtcblxuICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgbGV0IGN1cnJlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5rbm93bltdID0gb2JqO1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY29uc3Qgc2VnbWVudCA9IHNlZ21lbnRzW2ldITtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGN1cnJlbnQpKSB7XG4gICAgICBjb25zdCBpbmRleCA9IHBhcnNlSW50KHNlZ21lbnQsIDEwKTtcbiAgICAgIGlmIChjdXJyZW50W2luZGV4XSA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiBjdXJyZW50W2luZGV4XSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgICByZXR1cm47IC8vIHBhdGggZG9lcyBub3QgZXhpc3RcbiAgICAgIH1cbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50W2luZGV4XSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVua25vd25bXTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCEoc2VnbWVudCBpbiBjdXJyZW50KSB8fCB0eXBlb2YgY3VycmVudFtzZWdtZW50XSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgICByZXR1cm47IC8vIHBhdGggZG9lcyBub3QgZXhpc3RcbiAgICAgIH1cbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50W3NlZ21lbnRdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5rbm93bltdO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGxhc3RTZWdtZW50ID0gc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0hO1xuICBpZiAoQXJyYXkuaXNBcnJheShjdXJyZW50KSkge1xuICAgIGNvbnN0IGluZGV4ID0gcGFyc2VJbnQobGFzdFNlZ21lbnQsIDEwKTtcbiAgICBpZiAoaW5kZXggPj0gMCAmJiBpbmRleCA8IGN1cnJlbnQubGVuZ3RoKSB7XG4gICAgICBjdXJyZW50LnNwbGljZShpbmRleCwgMSk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGRlbGV0ZSBjdXJyZW50W2xhc3RTZWdtZW50XTtcbiAgfVxufVxuXG4vKipcbiAqIERlZXAgZXF1YWxpdHkgY2hlY2sgZm9yIFJGQyA2OTAyIFwidGVzdFwiIG9wZXJhdGlvbi5cbiAqL1xuZnVuY3Rpb24gZGVlcEVxdWFsKGE6IHVua25vd24sIGI6IHVua25vd24pOiBib29sZWFuIHtcbiAgaWYgKGEgPT09IGIpIHJldHVybiB0cnVlO1xuICBpZiAoYSA9PT0gbnVsbCB8fCBiID09PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgYSAhPT0gdHlwZW9mIGIpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoYSkpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoYikpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoYS5sZW5ndGggIT09IGIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIGEuZXZlcnkoKGl0ZW0sIGkpID0+IGRlZXBFcXVhbChpdGVtLCBiW2ldKSk7XG4gIH1cblxuICBjb25zdCBhT2JqID0gYSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgY29uc3QgYk9iaiA9IGIgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbnN0IGFLZXlzID0gT2JqZWN0LmtleXMoYU9iaik7XG4gIGNvbnN0IGJLZXlzID0gT2JqZWN0LmtleXMoYk9iaik7XG5cbiAgaWYgKGFLZXlzLmxlbmd0aCAhPT0gYktleXMubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBhS2V5cy5ldmVyeSgoa2V5KSA9PiBkZWVwRXF1YWwoYU9ialtrZXldLCBiT2JqW2tleV0pKTtcbn1cblxuLyoqXG4gKiBGaW5kIGEgZm9ybSB2YWx1ZSBmcm9tIHBhcmFtcyBhbmQvb3Igc3RhdGUuXG4gKiBVc2VmdWwgaW4gYWN0aW9uIGhhbmRsZXJzIHRvIGxvY2F0ZSBmb3JtIGlucHV0IHZhbHVlcyByZWdhcmRsZXNzIG9mIHBhdGggZm9ybWF0LlxuICpcbiAqIENoZWNrcyBpbiBvcmRlcjpcbiAqIDEuIERpcmVjdCBwYXJhbSBrZXkgKGlmIG5vdCBhIHBhdGggcmVmZXJlbmNlKVxuICogMi4gUGFyYW0ga2V5cyBlbmRpbmcgd2l0aCB0aGUgZmllbGQgbmFtZVxuICogMy4gU3RhdGUga2V5cyBlbmRpbmcgd2l0aCB0aGUgZmllbGQgbmFtZSAoZG90IG5vdGF0aW9uKVxuICogNC4gU3RhdGUgcGF0aCB1c2luZyBnZXRCeVBhdGggKHNsYXNoIG5vdGF0aW9uKVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBGaW5kIFwibmFtZVwiIGZyb20gcGFyYW1zIG9yIHN0YXRlXG4gKiBjb25zdCBuYW1lID0gZmluZEZvcm1WYWx1ZShcIm5hbWVcIiwgcGFyYW1zLCBzdGF0ZSk7XG4gKlxuICogLy8gV2lsbCBmaW5kIGZyb206IHBhcmFtcy5uYW1lLCBwYXJhbXNbXCJmb3JtLm5hbWVcIl0sIHN0YXRlW1wiZm9ybS5uYW1lXCJdLCBvciBnZXRCeVBhdGgoc3RhdGUsIFwibmFtZVwiKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZmluZEZvcm1WYWx1ZShcbiAgZmllbGROYW1lOiBzdHJpbmcsXG4gIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICBzdGF0ZT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuKTogdW5rbm93biB7XG4gIC8vIENoZWNrIHBhcmFtcyBmaXJzdCAoYnV0IG5vdCBpZiBpdCBsb29rcyBsaWtlIGEgc3RhdGUgcGF0aCByZWZlcmVuY2UpXG4gIGlmIChwYXJhbXM/LltmaWVsZE5hbWVdICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCB2YWwgPSBwYXJhbXNbZmllbGROYW1lXTtcbiAgICAvLyBJZiB0aGUgdmFsdWUgbG9va3MgbGlrZSBhIHBhdGggcmVmZXJlbmNlIChjb250YWlucyBkb3RzKSwgc2tpcCBpdFxuICAgIGlmICh0eXBlb2YgdmFsICE9PSBcInN0cmluZ1wiIHx8ICF2YWwuaW5jbHVkZXMoXCIuXCIpKSB7XG4gICAgICByZXR1cm4gdmFsO1xuICAgIH1cbiAgfVxuXG4gIC8vIENoZWNrIHBhcmFtIGtleXMgdGhhdCBlbmQgd2l0aCB0aGUgZmllbGQgbmFtZVxuICBpZiAocGFyYW1zKSB7XG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocGFyYW1zKSkge1xuICAgICAgaWYgKGtleS5lbmRzV2l0aChgLiR7ZmllbGROYW1lfWApKSB7XG4gICAgICAgIGNvbnN0IHZhbCA9IHBhcmFtc1trZXldO1xuICAgICAgICBpZiAodHlwZW9mIHZhbCAhPT0gXCJzdHJpbmdcIiB8fCAhdmFsLmluY2x1ZGVzKFwiLlwiKSkge1xuICAgICAgICAgIHJldHVybiB2YWw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBDaGVjayBzdGF0ZSBrZXlzIHRoYXQgZW5kIHdpdGggdGhlIGZpZWxkIG5hbWUgKGhhbmRsZXMgYW55IGZvcm0gbmFtaW5nKVxuICBpZiAoc3RhdGUpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzdGF0ZSkpIHtcbiAgICAgIGlmIChrZXkgPT09IGZpZWxkTmFtZSB8fCBrZXkuZW5kc1dpdGgoYC4ke2ZpZWxkTmFtZX1gKSkge1xuICAgICAgICByZXR1cm4gc3RhdGVba2V5XTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUcnkgZ2V0QnlQYXRoIHdpdGggdGhlIHJhdyBmaWVsZCBuYW1lXG4gICAgY29uc3QgdmFsID0gZ2V0QnlQYXRoKHN0YXRlLCBmaWVsZE5hbWUpO1xuICAgIGlmICh2YWwgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHZhbDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3BlY1N0cmVhbSAtIFN0cmVhbWluZyBmb3JtYXQgZm9yIHByb2dyZXNzaXZlbHkgYnVpbGRpbmcgc3BlY3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQSBTcGVjU3RyZWFtIGxpbmUgLSBhIHNpbmdsZSBwYXRjaCBvcGVyYXRpb24gaW4gdGhlIHN0cmVhbS5cbiAqL1xuZXhwb3J0IHR5cGUgU3BlY1N0cmVhbUxpbmUgPSBKc29uUGF0Y2g7XG5cbi8qKlxuICogUGFyc2UgYSBzaW5nbGUgU3BlY1N0cmVhbSBsaW5lIGludG8gYSBwYXRjaCBvcGVyYXRpb24uXG4gKiBSZXR1cm5zIG51bGwgaWYgdGhlIGxpbmUgaXMgaW52YWxpZCBvciBlbXB0eS5cbiAqXG4gKiBTcGVjU3RyZWFtIGlzIGpzb24tcmVuZGVyJ3Mgc3RyZWFtaW5nIGZvcm1hdCB3aGVyZSBlYWNoIGxpbmUgaXMgYSBKU09OIHBhdGNoXG4gKiBvcGVyYXRpb24gdGhhdCBwcm9ncmVzc2l2ZWx5IGJ1aWxkcyB1cCB0aGUgZmluYWwgc3BlYy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3BlY1N0cmVhbUxpbmUobGluZTogc3RyaW5nKTogU3BlY1N0cmVhbUxpbmUgfCBudWxsIHtcbiAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICBpZiAoIXRyaW1tZWQgfHwgIXRyaW1tZWQuc3RhcnRzV2l0aChcIntcIikpIHJldHVybiBudWxsO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcGF0Y2ggPSBKU09OLnBhcnNlKHRyaW1tZWQpIGFzIFNwZWNTdHJlYW1MaW5lO1xuICAgIGlmIChwYXRjaC5vcCAmJiBwYXRjaC5wYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBwYXRjaDtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogQXBwbHkgYSBzaW5nbGUgUkZDIDY5MDIgSlNPTiBQYXRjaCBvcGVyYXRpb24gdG8gYW4gb2JqZWN0LlxuICogTXV0YXRlcyB0aGUgb2JqZWN0IGluIHBsYWNlLlxuICpcbiAqIFN1cHBvcnRzIGFsbCBzaXggUkZDIDY5MDIgb3BlcmF0aW9uczogYWRkLCByZW1vdmUsIHJlcGxhY2UsIG1vdmUsIGNvcHksIHRlc3QuXG4gKlxuICogQHRocm93cyB7RXJyb3J9IElmIGEgXCJ0ZXN0XCIgb3BlcmF0aW9uIGZhaWxzICh2YWx1ZSBtaXNtYXRjaCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVNwZWNTdHJlYW1QYXRjaDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4+KFxuICBvYmo6IFQsXG4gIHBhdGNoOiBTcGVjU3RyZWFtTGluZSxcbik6IFQge1xuICBzd2l0Y2ggKHBhdGNoLm9wKSB7XG4gICAgY2FzZSBcImFkZFwiOlxuICAgICAgYWRkQnlQYXRoKG9iaiwgcGF0Y2gucGF0aCwgcGF0Y2gudmFsdWUpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSBcInJlcGxhY2VcIjpcbiAgICAgIC8vIFJGQyA2OTAyOiB0YXJnZXQgbXVzdCBleGlzdC4gRm9yIHN0cmVhbWluZyB0b2xlcmFuY2Ugd2Ugc2V0IHJlZ2FyZGxlc3MuXG4gICAgICBzZXRCeVBhdGgob2JqLCBwYXRjaC5wYXRoLCBwYXRjaC52YWx1ZSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlIFwicmVtb3ZlXCI6XG4gICAgICByZW1vdmVCeVBhdGgob2JqLCBwYXRjaC5wYXRoKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgXCJtb3ZlXCI6IHtcbiAgICAgIGlmICghcGF0Y2guZnJvbSkgYnJlYWs7XG4gICAgICBjb25zdCBtb3ZlVmFsdWUgPSBnZXRCeVBhdGgob2JqLCBwYXRjaC5mcm9tKTtcbiAgICAgIHJlbW92ZUJ5UGF0aChvYmosIHBhdGNoLmZyb20pO1xuICAgICAgYWRkQnlQYXRoKG9iaiwgcGF0Y2gucGF0aCwgbW92ZVZhbHVlKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlIFwiY29weVwiOiB7XG4gICAgICBpZiAoIXBhdGNoLmZyb20pIGJyZWFrO1xuICAgICAgY29uc3QgY29weVZhbHVlID0gZ2V0QnlQYXRoKG9iaiwgcGF0Y2guZnJvbSk7XG4gICAgICBhZGRCeVBhdGgob2JqLCBwYXRjaC5wYXRoLCBjb3B5VmFsdWUpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNhc2UgXCJ0ZXN0XCI6IHtcbiAgICAgIGNvbnN0IGFjdHVhbCA9IGdldEJ5UGF0aChvYmosIHBhdGNoLnBhdGgpO1xuICAgICAgaWYgKCFkZWVwRXF1YWwoYWN0dWFsLCBwYXRjaC52YWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBUZXN0IG9wZXJhdGlvbiBmYWlsZWQ6IHZhbHVlIGF0IFwiJHtwYXRjaC5wYXRofVwiIGRvZXMgbm90IG1hdGNoYCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gb2JqO1xufVxuXG4vKipcbiAqIEFwcGx5IGEgc2luZ2xlIFJGQyA2OTAyIEpTT04gUGF0Y2ggb3BlcmF0aW9uIHRvIGEgU3BlYy5cbiAqIE11dGF0ZXMgdGhlIHNwZWMgaW4gcGxhY2UgYW5kIHJldHVybnMgaXQuXG4gKlxuICogVGhpcyBpcyBhIHR5cGVkIGNvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIGBhcHBseVNwZWNTdHJlYW1QYXRjaGAgdGhhdFxuICogYWNjZXB0cyBhIGBTcGVjYCBkaXJlY3RseSB3aXRob3V0IHJlcXVpcmluZyBhIGNhc3QgdG8gYFJlY29yZDxzdHJpbmcsIHVua25vd24+YC5cbiAqXG4gKiBOb3RlOiBUaGlzIG11dGF0ZXMgdGhlIHNwZWMuIEZvciBSZWFjdCBzdGF0ZSB1cGRhdGVzLCBzcHJlYWQgdGhlIHJlc3VsdFxuICogdG8gY3JlYXRlIGEgbmV3IHJlZmVyZW5jZTogYHNldFNwZWMoeyAuLi5hcHBseVNwZWNQYXRjaChzcGVjLCBwYXRjaCkgfSlgLlxuICpcbiAqIEBleGFtcGxlXG4gKiBsZXQgc3BlYzogU3BlYyA9IHsgcm9vdDogXCJcIiwgZWxlbWVudHM6IHt9IH07XG4gKiBhcHBseVNwZWNQYXRjaChzcGVjLCB7IG9wOiBcImFkZFwiLCBwYXRoOiBcIi9yb290XCIsIHZhbHVlOiBcIm1haW5cIiB9KTtcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U3BlY1BhdGNoKHNwZWM6IFNwZWMsIHBhdGNoOiBTcGVjU3RyZWFtTGluZSk6IFNwZWMge1xuICBhcHBseVNwZWNTdHJlYW1QYXRjaChzcGVjIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHBhdGNoKTtcbiAgcmV0dXJuIHNwZWM7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBOZXN0ZWQtdG8tRmxhdCBDb252ZXJzaW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEEgbmVzdGVkIHNwZWMgbm9kZS4gVGhpcyBpcyB0aGUgdHJlZSBmb3JtYXQgdGhhdCBodW1hbnMgbmF0dXJhbGx5IHdyaXRlIOKAlFxuICogZWFjaCBub2RlIGhhcyBpbmxpbmUgYGNoaWxkcmVuYCBhcyBhbiBhcnJheSBvZiBjaGlsZCBub2RlIG9iamVjdHMgcmF0aGVyXG4gKiB0aGFuIHN0cmluZyBrZXlzLlxuICovXG5pbnRlcmZhY2UgTmVzdGVkTm9kZSB7XG4gIHR5cGU6IHN0cmluZztcbiAgcHJvcHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjaGlsZHJlbj86IE5lc3RlZE5vZGVbXTtcbiAgLyoqIEFueSBvdGhlciB0b3AtbGV2ZWwgZmllbGRzICh2aXNpYmxlLCBvbiwgcmVwZWF0LCBldGMuKSAqL1xuICBba2V5OiBzdHJpbmddOiB1bmtub3duO1xufVxuXG4vKipcbiAqIENvbnZlcnQgYSBuZXN0ZWQgKHRyZWUtc3RydWN0dXJlZCkgc3BlYyBpbnRvIHRoZSBmbGF0IGBTcGVjYCBmb3JtYXQgdXNlZFxuICogYnkganNvbi1yZW5kZXIgcmVuZGVyZXJzLlxuICpcbiAqIEluIHRoZSBuZXN0ZWQgZm9ybWF0IGVhY2ggbm9kZSBoYXMgaW5saW5lIGBjaGlsZHJlbmAgYXMgYW4gYXJyYXkgb2YgY2hpbGRcbiAqIG9iamVjdHMuIFRoaXMgZnVuY3Rpb24gd2Fsa3MgdGhlIHRyZWUsIGFzc2lnbnMgYXV0by1nZW5lcmF0ZWQga2V5c1xuICogKGBlbC0wYCwgYGVsLTFgLCAuLi4pLCBhbmQgcHJvZHVjZXMgYSBmbGF0IGB7IHJvb3QsIGVsZW1lbnRzLCBzdGF0ZSB9YCBzcGVjLlxuICpcbiAqIFRoZSB0b3AtbGV2ZWwgYHN0YXRlYCBmaWVsZCAoaWYgcHJlc2VudCBvbiB0aGUgcm9vdCBub2RlKSBpcyBob2lzdGVkIHRvXG4gKiBgc3BlYy5zdGF0ZWAuXG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBjb25zdCBuZXN0ZWQgPSB7XG4gKiAgIHR5cGU6IFwiQ2FyZFwiLFxuICogICBwcm9wczogeyB0aXRsZTogXCJIZWxsb1wiIH0sXG4gKiAgIGNoaWxkcmVuOiBbXG4gKiAgICAgeyB0eXBlOiBcIlRleHRcIiwgcHJvcHM6IHsgY29udGVudDogXCJXb3JsZFwiIH0gfSxcbiAqICAgXSxcbiAqICAgc3RhdGU6IHsgY291bnQ6IDAgfSxcbiAqIH07XG4gKiBjb25zdCBzcGVjID0gbmVzdGVkVG9GbGF0KG5lc3RlZCk7XG4gKiAvLyB7XG4gKiAvLyAgIHJvb3Q6IFwiZWwtMFwiLFxuICogLy8gICBlbGVtZW50czoge1xuICogLy8gICAgIFwiZWwtMFwiOiB7IHR5cGU6IFwiQ2FyZFwiLCBwcm9wczogeyB0aXRsZTogXCJIZWxsb1wiIH0sIGNoaWxkcmVuOiBbXCJlbC0xXCJdIH0sXG4gKiAvLyAgICAgXCJlbC0xXCI6IHsgdHlwZTogXCJUZXh0XCIsIHByb3BzOiB7IGNvbnRlbnQ6IFwiV29ybGRcIiB9LCBjaGlsZHJlbjogW10gfSxcbiAqIC8vICAgfSxcbiAqIC8vICAgc3RhdGU6IHsgY291bnQ6IDAgfSxcbiAqIC8vIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbmVzdGVkVG9GbGF0KG5lc3RlZDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBTcGVjIHtcbiAgY29uc3QgZWxlbWVudHM6IFJlY29yZDxzdHJpbmcsIFVJRWxlbWVudD4gPSB7fTtcbiAgbGV0IGNvdW50ZXIgPSAwO1xuXG4gIGZ1bmN0aW9uIHdhbGsobm9kZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmcge1xuICAgIGNvbnN0IGtleSA9IGBlbC0ke2NvdW50ZXIrK31gO1xuICAgIGNvbnN0IHsgdHlwZSwgcHJvcHMsIGNoaWxkcmVuOiByYXdDaGlsZHJlbiwgLi4ucmVzdCB9ID0gbm9kZSBhcyBOZXN0ZWROb2RlO1xuXG4gICAgLy8gUmVjdXJzaXZlbHkgZmxhdHRlbiBjaGlsZHJlblxuICAgIGNvbnN0IGNoaWxkS2V5czogc3RyaW5nW10gPSBbXTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShyYXdDaGlsZHJlbikpIHtcbiAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgcmF3Q2hpbGRyZW4pIHtcbiAgICAgICAgaWYgKGNoaWxkICYmIHR5cGVvZiBjaGlsZCA9PT0gXCJvYmplY3RcIiAmJiBcInR5cGVcIiBpbiBjaGlsZCkge1xuICAgICAgICAgIGNoaWxkS2V5cy5wdXNoKHdhbGsoY2hpbGQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEJ1aWxkIHRoZSBmbGF0IGVsZW1lbnQsIHByZXNlcnZpbmcgZXh0cmEgZmllbGRzICh2aXNpYmxlLCBvbiwgcmVwZWF0LCBldGMuKVxuICAgIC8vIGJ1dCBleGNsdWRpbmcgYHN0YXRlYCB3aGljaCBpcyBob2lzdGVkIHRvIHNwZWMtbGV2ZWwuXG4gICAgY29uc3QgZWxlbWVudDogVUlFbGVtZW50ID0ge1xuICAgICAgdHlwZTogdHlwZSA/PyBcInVua25vd25cIixcbiAgICAgIHByb3BzOiAocHJvcHMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID8/IHt9LFxuICAgICAgY2hpbGRyZW46IGNoaWxkS2V5cyxcbiAgICB9O1xuXG4gICAgLy8gQ29weSBleHRyYSBmaWVsZHMgKHZpc2libGUsIG9uLCByZXBlYXQpIGJ1dCBub3Qgc3RhdGVcbiAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhyZXN0KSkge1xuICAgICAgaWYgKGsgIT09IFwic3RhdGVcIiAmJiB2ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgKGVsZW1lbnQgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilba10gPSB2O1xuICAgICAgfVxuICAgIH1cblxuICAgIGVsZW1lbnRzW2tleV0gPSBlbGVtZW50O1xuICAgIHJldHVybiBrZXk7XG4gIH1cblxuICBjb25zdCByb290ID0gd2FsayhuZXN0ZWQpO1xuXG4gIGNvbnN0IHNwZWM6IFNwZWMgPSB7IHJvb3QsIGVsZW1lbnRzIH07XG5cbiAgLy8gSG9pc3Qgc3RhdGUgZnJvbSByb290IG5vZGUgaWYgcHJlc2VudFxuICBpZiAoXG4gICAgbmVzdGVkLnN0YXRlICYmXG4gICAgdHlwZW9mIG5lc3RlZC5zdGF0ZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICFBcnJheS5pc0FycmF5KG5lc3RlZC5zdGF0ZSlcbiAgKSB7XG4gICAgc3BlYy5zdGF0ZSA9IG5lc3RlZC5zdGF0ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgfVxuXG4gIHJldHVybiBzcGVjO1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBTcGVjU3RyZWFtIHN0cmluZyBpbnRvIGEgSlNPTiBvYmplY3QuXG4gKiBFYWNoIGxpbmUgc2hvdWxkIGJlIGEgcGF0Y2ggb3BlcmF0aW9uLlxuICpcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBzdHJlYW0gPSBge1wib3BcIjpcImFkZFwiLFwicGF0aFwiOlwiL25hbWVcIixcInZhbHVlXCI6XCJBbGljZVwifVxuICoge1wib3BcIjpcImFkZFwiLFwicGF0aFwiOlwiL2FnZVwiLFwidmFsdWVcIjozMH1gO1xuICogY29uc3QgcmVzdWx0ID0gY29tcGlsZVNwZWNTdHJlYW0oc3RyZWFtKTtcbiAqIC8vIHsgbmFtZTogXCJBbGljZVwiLCBhZ2U6IDMwIH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVTcGVjU3RyZWFtPFxuICBUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbj4oc3RyZWFtOiBzdHJpbmcsIGluaXRpYWw6IFQgPSB7fSBhcyBUKTogVCB7XG4gIGNvbnN0IGxpbmVzID0gc3RyZWFtLnNwbGl0KFwiXFxuXCIpO1xuICBjb25zdCByZXN1bHQgPSB7IC4uLmluaXRpYWwgfTtcblxuICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICBjb25zdCBwYXRjaCA9IHBhcnNlU3BlY1N0cmVhbUxpbmUobGluZSk7XG4gICAgaWYgKHBhdGNoKSB7XG4gICAgICBhcHBseVNwZWNTdHJlYW1QYXRjaChyZXN1bHQsIHBhdGNoKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzdWx0IGFzIFQ7XG59XG5cbi8qKlxuICogU3RyZWFtaW5nIFNwZWNTdHJlYW0gY29tcGlsZXIuXG4gKiBVc2VmdWwgZm9yIHByb2Nlc3NpbmcgU3BlY1N0cmVhbSBkYXRhIGFzIGl0IHN0cmVhbXMgaW4gZnJvbSBBSS5cbiAqXG4gKiBAZXhhbXBsZVxuICogY29uc3QgY29tcGlsZXIgPSBjcmVhdGVTcGVjU3RyZWFtQ29tcGlsZXI8TXlTcGVjPigpO1xuICpcbiAqIC8vIEFzIGNodW5rcyBhcnJpdmU6XG4gKiBjb25zdCB7IHJlc3VsdCwgbmV3UGF0Y2hlcyB9ID0gY29tcGlsZXIucHVzaChjaHVuayk7XG4gKiBpZiAobmV3UGF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gKiAgIHVwZGF0ZVVJKHJlc3VsdCk7XG4gKiB9XG4gKlxuICogLy8gV2hlbiBkb25lOlxuICogY29uc3QgZmluYWxSZXN1bHQgPSBjb21waWxlci5nZXRSZXN1bHQoKTtcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGVjU3RyZWFtQ29tcGlsZXI8VD4ge1xuICAvKiogUHVzaCBhIGNodW5rIG9mIHRleHQuIFJldHVybnMgdGhlIGN1cnJlbnQgcmVzdWx0IGFuZCBhbnkgbmV3IHBhdGNoZXMgYXBwbGllZC4gKi9cbiAgcHVzaChjaHVuazogc3RyaW5nKTogeyByZXN1bHQ6IFQ7IG5ld1BhdGNoZXM6IFNwZWNTdHJlYW1MaW5lW10gfTtcbiAgLyoqIEdldCB0aGUgY3VycmVudCBjb21waWxlZCByZXN1bHQgKi9cbiAgZ2V0UmVzdWx0KCk6IFQ7XG4gIC8qKiBHZXQgYWxsIHBhdGNoZXMgdGhhdCBoYXZlIGJlZW4gYXBwbGllZCAqL1xuICBnZXRQYXRjaGVzKCk6IFNwZWNTdHJlYW1MaW5lW107XG4gIC8qKiBSZXNldCB0aGUgY29tcGlsZXIgdG8gaW5pdGlhbCBzdGF0ZSAqL1xuICByZXNldChpbml0aWFsPzogUGFydGlhbDxUPik6IHZvaWQ7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgc3RyZWFtaW5nIFNwZWNTdHJlYW0gY29tcGlsZXIuXG4gKlxuICogU3BlY1N0cmVhbSBpcyBqc29uLXJlbmRlcidzIHN0cmVhbWluZyBmb3JtYXQuIEFJIG91dHB1dHMgcGF0Y2ggb3BlcmF0aW9uc1xuICogbGluZSBieSBsaW5lLCBhbmQgdGhpcyBjb21waWxlciBwcm9ncmVzc2l2ZWx5IGJ1aWxkcyB0aGUgZmluYWwgc3BlYy5cbiAqXG4gKiBAZXhhbXBsZVxuICogY29uc3QgY29tcGlsZXIgPSBjcmVhdGVTcGVjU3RyZWFtQ29tcGlsZXI8VGltZWxpbmVTcGVjPigpO1xuICpcbiAqIC8vIFByb2Nlc3Mgc3RyZWFtaW5nIHJlc3BvbnNlXG4gKiBjb25zdCByZWFkZXIgPSByZXNwb25zZS5ib2R5LmdldFJlYWRlcigpO1xuICogd2hpbGUgKHRydWUpIHtcbiAqICAgY29uc3QgeyBkb25lLCB2YWx1ZSB9ID0gYXdhaXQgcmVhZGVyLnJlYWQoKTtcbiAqICAgaWYgKGRvbmUpIGJyZWFrO1xuICpcbiAqICAgY29uc3QgeyByZXN1bHQsIG5ld1BhdGNoZXMgfSA9IGNvbXBpbGVyLnB1c2goZGVjb2Rlci5kZWNvZGUodmFsdWUpKTtcbiAqICAgaWYgKG5ld1BhdGNoZXMubGVuZ3RoID4gMCkge1xuICogICAgIHNldFNwZWMocmVzdWx0KTsgLy8gVXBkYXRlIFVJIHdpdGggcGFydGlhbCByZXN1bHRcbiAqICAgfVxuICogfVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU3BlY1N0cmVhbUNvbXBpbGVyPFQgPSBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4oXG4gIGluaXRpYWw6IFBhcnRpYWw8VD4gPSB7fSxcbik6IFNwZWNTdHJlYW1Db21waWxlcjxUPiB7XG4gIGxldCByZXN1bHQgPSB7IC4uLmluaXRpYWwgfSBhcyBUO1xuICBsZXQgYnVmZmVyID0gXCJcIjtcbiAgY29uc3QgYXBwbGllZFBhdGNoZXM6IFNwZWNTdHJlYW1MaW5lW10gPSBbXTtcbiAgY29uc3QgcHJvY2Vzc2VkTGluZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICByZXR1cm4ge1xuICAgIHB1c2goY2h1bms6IHN0cmluZyk6IHsgcmVzdWx0OiBUOyBuZXdQYXRjaGVzOiBTcGVjU3RyZWFtTGluZVtdIH0ge1xuICAgICAgYnVmZmVyICs9IGNodW5rO1xuICAgICAgY29uc3QgbmV3UGF0Y2hlczogU3BlY1N0cmVhbUxpbmVbXSA9IFtdO1xuXG4gICAgICAvLyBQcm9jZXNzIGNvbXBsZXRlIGxpbmVzXG4gICAgICBjb25zdCBsaW5lcyA9IGJ1ZmZlci5zcGxpdChcIlxcblwiKTtcbiAgICAgIGJ1ZmZlciA9IGxpbmVzLnBvcCgpIHx8IFwiXCI7IC8vIEtlZXAgaW5jb21wbGV0ZSBsaW5lIGluIGJ1ZmZlclxuXG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgICAgICBpZiAoIXRyaW1tZWQgfHwgcHJvY2Vzc2VkTGluZXMuaGFzKHRyaW1tZWQpKSBjb250aW51ZTtcbiAgICAgICAgcHJvY2Vzc2VkTGluZXMuYWRkKHRyaW1tZWQpO1xuXG4gICAgICAgIGNvbnN0IHBhdGNoID0gcGFyc2VTcGVjU3RyZWFtTGluZSh0cmltbWVkKTtcbiAgICAgICAgaWYgKHBhdGNoKSB7XG4gICAgICAgICAgYXBwbHlTcGVjU3RyZWFtUGF0Y2gocmVzdWx0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBwYXRjaCk7XG4gICAgICAgICAgYXBwbGllZFBhdGNoZXMucHVzaChwYXRjaCk7XG4gICAgICAgICAgbmV3UGF0Y2hlcy5wdXNoKHBhdGNoKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBSZXR1cm4gYSBzaGFsbG93IGNvcHkgdG8gdHJpZ2dlciByZS1yZW5kZXJzXG4gICAgICBpZiAobmV3UGF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJlc3VsdCA9IHsgLi4ucmVzdWx0IH07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7IHJlc3VsdCwgbmV3UGF0Y2hlcyB9O1xuICAgIH0sXG5cbiAgICBnZXRSZXN1bHQoKTogVCB7XG4gICAgICAvLyBQcm9jZXNzIGFueSByZW1haW5pbmcgYnVmZmVyXG4gICAgICBpZiAoYnVmZmVyLnRyaW0oKSkge1xuICAgICAgICBjb25zdCBwYXRjaCA9IHBhcnNlU3BlY1N0cmVhbUxpbmUoYnVmZmVyKTtcbiAgICAgICAgaWYgKHBhdGNoICYmICFwcm9jZXNzZWRMaW5lcy5oYXMoYnVmZmVyLnRyaW0oKSkpIHtcbiAgICAgICAgICBwcm9jZXNzZWRMaW5lcy5hZGQoYnVmZmVyLnRyaW0oKSk7XG4gICAgICAgICAgYXBwbHlTcGVjU3RyZWFtUGF0Y2gocmVzdWx0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBwYXRjaCk7XG4gICAgICAgICAgYXBwbGllZFBhdGNoZXMucHVzaChwYXRjaCk7XG4gICAgICAgICAgcmVzdWx0ID0geyAuLi5yZXN1bHQgfTtcbiAgICAgICAgfVxuICAgICAgICBidWZmZXIgPSBcIlwiO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9LFxuXG4gICAgZ2V0UGF0Y2hlcygpOiBTcGVjU3RyZWFtTGluZVtdIHtcbiAgICAgIHJldHVybiBbLi4uYXBwbGllZFBhdGNoZXNdO1xuICAgIH0sXG5cbiAgICByZXNldChuZXdJbml0aWFsOiBQYXJ0aWFsPFQ+ID0ge30pOiB2b2lkIHtcbiAgICAgIHJlc3VsdCA9IHsgLi4ubmV3SW5pdGlhbCB9IGFzIFQ7XG4gICAgICBidWZmZXIgPSBcIlwiO1xuICAgICAgYXBwbGllZFBhdGNoZXMubGVuZ3RoID0gMDtcbiAgICAgIHByb2Nlc3NlZExpbmVzLmNsZWFyKCk7XG4gICAgfSxcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1peGVkIFN0cmVhbSBQYXJzZXIg4oCUIGZvciBjaGF0ICsgR2VuVUkgKHRleHQgaW50ZXJsZWF2ZWQgd2l0aCBKU09OTCBwYXRjaGVzKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDYWxsYmFja3MgZm9yIHRoZSBtaXhlZCBzdHJlYW0gcGFyc2VyLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIE1peGVkU3RyZWFtQ2FsbGJhY2tzIHtcbiAgLyoqIENhbGxlZCB3aGVuIGEgSlNPTkwgcGF0Y2ggbGluZSBpcyBwYXJzZWQgKi9cbiAgb25QYXRjaDogKHBhdGNoOiBTcGVjU3RyZWFtTGluZSkgPT4gdm9pZDtcbiAgLyoqIENhbGxlZCB3aGVuIGEgdGV4dCAobm9uLUpTT05MKSBsaW5lIGlzIHJlY2VpdmVkICovXG4gIG9uVGV4dDogKHRleHQ6IHN0cmluZykgPT4gdm9pZDtcbn1cblxuLyoqXG4gKiBBIHN0YXRlZnVsIHBhcnNlciBmb3IgbWl4ZWQgc3RyZWFtcyB0aGF0IGNvbnRhaW4gYm90aCB0ZXh0IGFuZCBKU09OTCBwYXRjaGVzLlxuICogVXNlZCBpbiBjaGF0ICsgR2VuVUkgc2NlbmFyaW9zIHdoZXJlIGFuIExMTSByZXNwb25kcyB3aXRoIGNvbnZlcnNhdGlvbmFsIHRleHRcbiAqIGludGVybGVhdmVkIHdpdGgganNvbi1yZW5kZXIgSlNPTkwgcGF0Y2ggb3BlcmF0aW9ucy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBNaXhlZFN0cmVhbVBhcnNlciB7XG4gIC8qKiBQdXNoIGEgY2h1bmsgb2Ygc3RyZWFtZWQgZGF0YS4gQ2FsbHMgb25QYXRjaC9vblRleHQgZm9yIGVhY2ggY29tcGxldGUgbGluZS4gKi9cbiAgcHVzaChjaHVuazogc3RyaW5nKTogdm9pZDtcbiAgLyoqIEZsdXNoIGFueSByZW1haW5pbmcgYnVmZmVyZWQgY29udGVudC4gQ2FsbCB3aGVuIHRoZSBzdHJlYW0gZW5kcy4gKi9cbiAgZmx1c2goKTogdm9pZDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBwYXJzZXIgZm9yIG1peGVkIHRleHQgKyBKU09OTCBzdHJlYW1zLlxuICpcbiAqIEluIGNoYXQgKyBHZW5VSSBzY2VuYXJpb3MsIGFuIExMTSBzdHJlYW1zIGEgcmVzcG9uc2UgdGhhdCBjb250YWlucyBib3RoXG4gKiBjb252ZXJzYXRpb25hbCB0ZXh0IGFuZCBqc29uLXJlbmRlciBKU09OTCBwYXRjaCBsaW5lcy4gVGhpcyBwYXJzZXIgYnVmZmVyc1xuICogaW5jb21pbmcgY2h1bmtzLCBzcGxpdHMgdGhlbSBpbnRvIGxpbmVzLCBhbmQgY2xhc3NpZmllcyBlYWNoIGxpbmUgYXMgZWl0aGVyXG4gKiBhIEpTT05MIHBhdGNoICh2aWEgYHBhcnNlU3BlY1N0cmVhbUxpbmVgKSBvciBwbGFpbiB0ZXh0LlxuICpcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBwYXJzZXIgPSBjcmVhdGVNaXhlZFN0cmVhbVBhcnNlcih7XG4gKiAgIG9uVGV4dDogKHRleHQpID0+IGFwcGVuZFRvTWVzc2FnZSh0ZXh0KSxcbiAqICAgb25QYXRjaDogKHBhdGNoKSA9PiBhcHBseVNwZWNQYXRjaChzcGVjLCBwYXRjaCksXG4gKiB9KTtcbiAqXG4gKiAvLyBBcyBjaHVua3MgYXJyaXZlIGZyb20gdGhlIHN0cmVhbTpcbiAqIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2Ygc3RyZWFtKSB7XG4gKiAgIHBhcnNlci5wdXNoKGNodW5rKTtcbiAqIH1cbiAqIHBhcnNlci5mbHVzaCgpO1xuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTWl4ZWRTdHJlYW1QYXJzZXIoXG4gIGNhbGxiYWNrczogTWl4ZWRTdHJlYW1DYWxsYmFja3MsXG4pOiBNaXhlZFN0cmVhbVBhcnNlciB7XG4gIGxldCBidWZmZXIgPSBcIlwiO1xuICBsZXQgaW5TcGVjRmVuY2UgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBwcm9jZXNzTGluZShsaW5lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG5cbiAgICAvLyBGZW5jZSBkZXRlY3Rpb25cbiAgICBpZiAoIWluU3BlY0ZlbmNlICYmIHRyaW1tZWQuc3RhcnRzV2l0aChcImBgYHNwZWNcIikpIHtcbiAgICAgIGluU3BlY0ZlbmNlID0gdHJ1ZTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGluU3BlY0ZlbmNlICYmIHRyaW1tZWQgPT09IFwiYGBgXCIpIHtcbiAgICAgIGluU3BlY0ZlbmNlID0gZmFsc2U7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCF0cmltbWVkKSByZXR1cm47XG5cbiAgICBpZiAoaW5TcGVjRmVuY2UpIHtcbiAgICAgIGNvbnN0IHBhdGNoID0gcGFyc2VTcGVjU3RyZWFtTGluZSh0cmltbWVkKTtcbiAgICAgIGlmIChwYXRjaCkge1xuICAgICAgICBjYWxsYmFja3Mub25QYXRjaChwYXRjaCk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gT3V0c2lkZSBmZW5jZTogaGV1cmlzdGljIG1vZGVcbiAgICBjb25zdCBwYXRjaCA9IHBhcnNlU3BlY1N0cmVhbUxpbmUodHJpbW1lZCk7XG4gICAgaWYgKHBhdGNoKSB7XG4gICAgICBjYWxsYmFja3Mub25QYXRjaChwYXRjaCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhbGxiYWNrcy5vblRleHQobGluZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBwdXNoKGNodW5rOiBzdHJpbmcpOiB2b2lkIHtcbiAgICAgIGJ1ZmZlciArPSBjaHVuaztcblxuICAgICAgLy8gUHJvY2VzcyBjb21wbGV0ZSBsaW5lc1xuICAgICAgY29uc3QgbGluZXMgPSBidWZmZXIuc3BsaXQoXCJcXG5cIik7XG4gICAgICBidWZmZXIgPSBsaW5lcy5wb3AoKSB8fCBcIlwiOyAvLyBLZWVwIGluY29tcGxldGUgbGluZSBpbiBidWZmZXJcblxuICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICAgIHByb2Nlc3NMaW5lKGxpbmUpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBmbHVzaCgpOiB2b2lkIHtcbiAgICAgIGlmIChidWZmZXIudHJpbSgpKSB7XG4gICAgICAgIHByb2Nlc3NMaW5lKGJ1ZmZlcik7XG4gICAgICB9XG4gICAgICBidWZmZXIgPSBcIlwiO1xuICAgIH0sXG4gIH07XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBSSBTREsgU3RyZWFtIFRyYW5zZm9ybVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBNaW5pbWFsIGNodW5rIHNoYXBlIGNvbXBhdGlibGUgd2l0aCB0aGUgQUkgU0RLJ3MgYFVJTWVzc2FnZUNodW5rYC5cbiAqXG4gKiBEZWZpbmVkIGhlcmUgc28gdGhhdCBgQGpzb24tcmVuZGVyL2NvcmVgIGhhcyBubyBkZXBlbmRlbmN5IG9uIHRoZSBgYWlgXG4gKiBwYWNrYWdlLiBUaGUgZGlzY3JpbWluYXRlZCB1bmlvbiBjb3ZlcnMgdGhlIHRocmVlIHRleHQtcmVsYXRlZCBjaHVuayB0eXBlc1xuICogdGhlIHRyYW5zZm9ybSBpbnNwZWN0czsgYWxsIG90aGVyIGNodW5rIHR5cGVzIHBhc3MgdGhyb3VnaCB2aWEgdGhlIGZhbGxiYWNrLlxuICovXG5leHBvcnQgdHlwZSBTdHJlYW1DaHVuayA9XG4gIHwgeyB0eXBlOiBcInRleHQtc3RhcnRcIjsgaWQ6IHN0cmluZzsgW2s6IHN0cmluZ106IHVua25vd24gfVxuICB8IHsgdHlwZTogXCJ0ZXh0LWRlbHRhXCI7IGlkOiBzdHJpbmc7IGRlbHRhOiBzdHJpbmc7IFtrOiBzdHJpbmddOiB1bmtub3duIH1cbiAgfCB7IHR5cGU6IFwidGV4dC1lbmRcIjsgaWQ6IHN0cmluZzsgW2s6IHN0cmluZ106IHVua25vd24gfVxuICB8IHsgdHlwZTogc3RyaW5nOyBbazogc3RyaW5nXTogdW5rbm93biB9O1xuXG4vKiogVGhlIG9wZW5pbmcgZmVuY2UgZm9yIGEgc3BlYyBibG9jayAoZS5nLiBgIGBgYHNwZWMgYCkuICovXG5jb25zdCBTUEVDX0ZFTkNFX09QRU4gPSBcImBgYHNwZWNcIjtcbi8qKiBUaGUgY2xvc2luZyBmZW5jZSBmb3IgYSBzcGVjIGJsb2NrLiAqL1xuY29uc3QgU1BFQ19GRU5DRV9DTE9TRSA9IFwiYGBgXCI7XG5cbi8qKlxuICogQ3JlYXRlcyBhIGBUcmFuc2Zvcm1TdHJlYW1gIHRoYXQgaW50ZXJjZXB0cyBBSSBTREsgVUkgbWVzc2FnZSBzdHJlYW0gY2h1bmtzXG4gKiBhbmQgY2xhc3NpZmllcyB0ZXh0IGNvbnRlbnQgYXMgZWl0aGVyIHByb3NlIG9yIGpzb24tcmVuZGVyIEpTT05MIHBhdGNoZXMuXG4gKlxuICogVHdvIGNsYXNzaWZpY2F0aW9uIG1vZGVzOlxuICpcbiAqIDEuICoqRmVuY2UgbW9kZSoqIChwcmVmZXJyZWQpOiBMaW5lcyBiZXR3ZWVuIGAgYGBgc3BlYyBgIGFuZCBgIGBgYCBgIGFyZVxuICogICAgcGFyc2VkIGFzIEpTT05MIHBhdGNoZXMuIEZlbmNlIGRlbGltaXRlcnMgYXJlIHN3YWxsb3dlZCAobm90IGVtaXR0ZWQpLlxuICogMi4gKipIZXVyaXN0aWMgbW9kZSoqIChiYWNrd2FyZCBjb21wYXQpOiBPdXRzaWRlIG9mIGZlbmNlcywgbGluZXMgc3RhcnRpbmdcbiAqICAgIHdpdGggYHtgIGFyZSBidWZmZXJlZCBhbmQgdGVzdGVkIHdpdGggYHBhcnNlU3BlY1N0cmVhbUxpbmVgLiBWYWxpZCBwYXRjaGVzXG4gKiAgICBhcmUgZW1pdHRlZCBhcyB7QGxpbmsgU1BFQ19EQVRBX1BBUlRfVFlQRX0gcGFydHM7IGV2ZXJ5dGhpbmcgZWxzZSBpc1xuICogICAgZmx1c2hlZCBhcyB0ZXh0LlxuICpcbiAqIE5vbi10ZXh0IGNodW5rcyAodG9vbCBldmVudHMsIHN0ZXAgbWFya2VycywgZXRjLikgYXJlIHBhc3NlZCB0aHJvdWdoIHVuY2hhbmdlZC5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGltcG9ydCB7IGNyZWF0ZUpzb25SZW5kZXJUcmFuc2Zvcm0gfSBmcm9tIFwiQGpzb24tcmVuZGVyL2NvcmVcIjtcbiAqIGltcG9ydCB7IGNyZWF0ZVVJTWVzc2FnZVN0cmVhbSwgY3JlYXRlVUlNZXNzYWdlU3RyZWFtUmVzcG9uc2UgfSBmcm9tIFwiYWlcIjtcbiAqXG4gKiBjb25zdCBzdHJlYW0gPSBjcmVhdGVVSU1lc3NhZ2VTdHJlYW0oe1xuICogICBleGVjdXRlOiBhc3luYyAoeyB3cml0ZXIgfSkgPT4ge1xuICogICAgIHdyaXRlci5tZXJnZShcbiAqICAgICAgIHJlc3VsdC50b1VJTWVzc2FnZVN0cmVhbSgpLnBpcGVUaHJvdWdoKGNyZWF0ZUpzb25SZW5kZXJUcmFuc2Zvcm0oKSksXG4gKiAgICAgKTtcbiAqICAgfSxcbiAqIH0pO1xuICogcmV0dXJuIGNyZWF0ZVVJTWVzc2FnZVN0cmVhbVJlc3BvbnNlKHsgc3RyZWFtIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVKc29uUmVuZGVyVHJhbnNmb3JtKCk6IFRyYW5zZm9ybVN0cmVhbTxcbiAgU3RyZWFtQ2h1bmssXG4gIFN0cmVhbUNodW5rXG4+IHtcbiAgbGV0IGxpbmVCdWZmZXIgPSBcIlwiO1xuICBsZXQgY3VycmVudFRleHRJZCA9IFwiXCI7XG4gIC8vIFdoZXRoZXIgdGhlIGN1cnJlbnQgaW5jb21wbGV0ZSBsaW5lIG1pZ2h0IGJlIEpTT05MIChzdGFydHMgd2l0aCAneycpXG4gIGxldCBidWZmZXJpbmcgPSBmYWxzZTtcbiAgLy8gV2hldGhlciB3ZSBhcmUgaW5zaWRlIGEgYGBgc3BlYyBmZW5jZVxuICBsZXQgaW5TcGVjRmVuY2UgPSBmYWxzZTtcbiAgLy8gV2hldGhlciB3ZSBhcmUgY3VycmVudGx5IGluc2lkZSBhIHRleHQgYmxvY2sgKGJldHdlZW4gdGV4dC1zdGFydC90ZXh0LWVuZCkuXG4gIC8vIFVzZWQgdG8gc3BsaXQgdGV4dCBibG9ja3MgYXJvdW5kIHNwZWMgZGF0YSBzbyB0aGUgQUkgU0RLIGNyZWF0ZXMgc2VwYXJhdGVcbiAgLy8gdGV4dCBwYXJ0cywgcHJlc2VydmluZyBpbnRlcmxlYXZpbmcgb2YgcHJvc2UgYW5kIFVJIGluIG1lc3NhZ2UucGFydHMuXG4gIGxldCBpblRleHRCbG9jayA9IGZhbHNlO1xuICBsZXQgdGV4dElkQ291bnRlciA9IDA7XG5cbiAgLyoqIENsb3NlIHRoZSBjdXJyZW50IHRleHQgYmxvY2sgaWYgb25lIGlzIG9wZW4uICovXG4gIGZ1bmN0aW9uIGNsb3NlVGV4dEJsb2NrKFxuICAgIGNvbnRyb2xsZXI6IFRyYW5zZm9ybVN0cmVhbURlZmF1bHRDb250cm9sbGVyPFN0cmVhbUNodW5rPixcbiAgKSB7XG4gICAgaWYgKGluVGV4dEJsb2NrKSB7XG4gICAgICBjb250cm9sbGVyLmVucXVldWUoeyB0eXBlOiBcInRleHQtZW5kXCIsIGlkOiBjdXJyZW50VGV4dElkIH0pO1xuICAgICAgaW5UZXh0QmxvY2sgPSBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvKiogRW5zdXJlIGEgdGV4dCBibG9jayBpcyBvcGVuLCBzdGFydGluZyBhIG5ldyBvbmUgaWYgbmVlZGVkLiAqL1xuICBmdW5jdGlvbiBlbnN1cmVUZXh0QmxvY2soXG4gICAgY29udHJvbGxlcjogVHJhbnNmb3JtU3RyZWFtRGVmYXVsdENvbnRyb2xsZXI8U3RyZWFtQ2h1bms+LFxuICApIHtcbiAgICBpZiAoIWluVGV4dEJsb2NrKSB7XG4gICAgICB0ZXh0SWRDb3VudGVyKys7XG4gICAgICBjdXJyZW50VGV4dElkID0gU3RyaW5nKHRleHRJZENvdW50ZXIpO1xuICAgICAgY29udHJvbGxlci5lbnF1ZXVlKHsgdHlwZTogXCJ0ZXh0LXN0YXJ0XCIsIGlkOiBjdXJyZW50VGV4dElkIH0pO1xuICAgICAgaW5UZXh0QmxvY2sgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBFbWl0IGEgdGV4dC1kZWx0YSwgb3BlbmluZyBhIHRleHQgYmxvY2sgZmlyc3QgaWYgbmVjZXNzYXJ5LiAqL1xuICBmdW5jdGlvbiBlbWl0VGV4dERlbHRhKFxuICAgIGRlbHRhOiBzdHJpbmcsXG4gICAgY29udHJvbGxlcjogVHJhbnNmb3JtU3RyZWFtRGVmYXVsdENvbnRyb2xsZXI8U3RyZWFtQ2h1bms+LFxuICApIHtcbiAgICBlbnN1cmVUZXh0QmxvY2soY29udHJvbGxlcik7XG4gICAgY29udHJvbGxlci5lbnF1ZXVlKHsgdHlwZTogXCJ0ZXh0LWRlbHRhXCIsIGlkOiBjdXJyZW50VGV4dElkLCBkZWx0YSB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGVtaXRQYXRjaChcbiAgICBwYXRjaDogU3BlY1N0cmVhbUxpbmUsXG4gICAgY29udHJvbGxlcjogVHJhbnNmb3JtU3RyZWFtRGVmYXVsdENvbnRyb2xsZXI8U3RyZWFtQ2h1bms+LFxuICApIHtcbiAgICBjbG9zZVRleHRCbG9jayhjb250cm9sbGVyKTtcbiAgICBjb250cm9sbGVyLmVucXVldWUoe1xuICAgICAgdHlwZTogU1BFQ19EQVRBX1BBUlRfVFlQRSxcbiAgICAgIGRhdGE6IHsgdHlwZTogXCJwYXRjaFwiLCBwYXRjaCB9LFxuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gZmx1c2hCdWZmZXIoXG4gICAgY29udHJvbGxlcjogVHJhbnNmb3JtU3RyZWFtRGVmYXVsdENvbnRyb2xsZXI8U3RyZWFtQ2h1bms+LFxuICApIHtcbiAgICBpZiAoIWxpbmVCdWZmZXIpIHJldHVybjtcblxuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lQnVmZmVyLnRyaW0oKTtcblxuICAgIC8vIEluc2lkZSBhIGZlbmNlLCBldmVyeXRoaW5nIGlzIHNwZWMgZGF0YVxuICAgIGlmIChpblNwZWNGZW5jZSkge1xuICAgICAgaWYgKHRyaW1tZWQpIHtcbiAgICAgICAgY29uc3QgcGF0Y2ggPSBwYXJzZVNwZWNTdHJlYW1MaW5lKHRyaW1tZWQpO1xuICAgICAgICBpZiAocGF0Y2gpIGVtaXRQYXRjaChwYXRjaCwgY29udHJvbGxlcik7XG4gICAgICAgIC8vIE5vbi1wYXRjaCBsaW5lcyBpbnNpZGUgdGhlIGZlbmNlIGFyZSBzaWxlbnRseSBkcm9wcGVkXG4gICAgICB9XG4gICAgICBsaW5lQnVmZmVyID0gXCJcIjtcbiAgICAgIGJ1ZmZlcmluZyA9IGZhbHNlO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0cmltbWVkKSB7XG4gICAgICBjb25zdCBwYXRjaCA9IHBhcnNlU3BlY1N0cmVhbUxpbmUodHJpbW1lZCk7XG4gICAgICBpZiAocGF0Y2gpIHtcbiAgICAgICAgZW1pdFBhdGNoKHBhdGNoLCBjb250cm9sbGVyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFdhcyBidWZmZXJlZCBidXQgaXNuJ3QgSlNPTkwg4oCUIGZsdXNoIGFzIHRleHRcbiAgICAgICAgZW1pdFRleHREZWx0YShsaW5lQnVmZmVyLCBjb250cm9sbGVyKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2hpdGVzcGFjZS1vbmx5IGJ1ZmZlciDigJQgZm9yd2FyZCBhcy1pcyAocHJlc2VydmVzIGJsYW5rIGxpbmVzKVxuICAgICAgZW1pdFRleHREZWx0YShsaW5lQnVmZmVyLCBjb250cm9sbGVyKTtcbiAgICB9XG4gICAgbGluZUJ1ZmZlciA9IFwiXCI7XG4gICAgYnVmZmVyaW5nID0gZmFsc2U7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9jZXNzQ29tcGxldGVMaW5lKFxuICAgIGxpbmU6IHN0cmluZyxcbiAgICBjb250cm9sbGVyOiBUcmFuc2Zvcm1TdHJlYW1EZWZhdWx0Q29udHJvbGxlcjxTdHJlYW1DaHVuaz4sXG4gICkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcblxuICAgIC8vIC0tLSBGZW5jZSBkZXRlY3Rpb24gLS0tXG4gICAgaWYgKCFpblNwZWNGZW5jZSAmJiB0cmltbWVkLnN0YXJ0c1dpdGgoU1BFQ19GRU5DRV9PUEVOKSkge1xuICAgICAgaW5TcGVjRmVuY2UgPSB0cnVlO1xuICAgICAgcmV0dXJuOyAvLyBTd2FsbG93IHRoZSBvcGVuaW5nIGZlbmNlXG4gICAgfVxuICAgIGlmIChpblNwZWNGZW5jZSAmJiB0cmltbWVkID09PSBTUEVDX0ZFTkNFX0NMT1NFKSB7XG4gICAgICBpblNwZWNGZW5jZSA9IGZhbHNlO1xuICAgICAgcmV0dXJuOyAvLyBTd2FsbG93IHRoZSBjbG9zaW5nIGZlbmNlXG4gICAgfVxuXG4gICAgLy8gSW5zaWRlIGEgZmVuY2U6IHBhcnNlIGFzIHNwZWMgZGF0YVxuICAgIGlmIChpblNwZWNGZW5jZSkge1xuICAgICAgaWYgKHRyaW1tZWQpIHtcbiAgICAgICAgY29uc3QgcGF0Y2ggPSBwYXJzZVNwZWNTdHJlYW1MaW5lKHRyaW1tZWQpO1xuICAgICAgICBpZiAocGF0Y2gpIGVtaXRQYXRjaChwYXRjaCwgY29udHJvbGxlcik7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gLS0tIE91dHNpZGUgZmVuY2U6IGhldXJpc3RpYyBtb2RlIC0tLVxuICAgIGlmICghdHJpbW1lZCkge1xuICAgICAgLy8gRW1wdHkgbGluZSDigJQgZm9yd2FyZCBmb3IgbWFya2Rvd24gcGFyYWdyYXBoIGJyZWFrc1xuICAgICAgZW1pdFRleHREZWx0YShcIlxcblwiLCBjb250cm9sbGVyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwYXRjaCA9IHBhcnNlU3BlY1N0cmVhbUxpbmUodHJpbW1lZCk7XG4gICAgaWYgKHBhdGNoKSB7XG4gICAgICBlbWl0UGF0Y2gocGF0Y2gsIGNvbnRyb2xsZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBlbWl0VGV4dERlbHRhKGxpbmUgKyBcIlxcblwiLCBjb250cm9sbGVyKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zZm9ybVN0cmVhbTxTdHJlYW1DaHVuaywgU3RyZWFtQ2h1bms+KHtcbiAgICB0cmFuc2Zvcm0oY2h1bmssIGNvbnRyb2xsZXIpIHtcbiAgICAgIHN3aXRjaCAoY2h1bmsudHlwZSkge1xuICAgICAgICBjYXNlIFwidGV4dC1zdGFydFwiOiB7XG4gICAgICAgICAgY29uc3QgaWQgPSAoY2h1bmsgYXMgeyBpZDogc3RyaW5nIH0pLmlkO1xuICAgICAgICAgIGNvbnN0IGlkTnVtID0gcGFyc2VJbnQoaWQsIDEwKTtcbiAgICAgICAgICBpZiAoIWlzTmFOKGlkTnVtKSAmJiBpZE51bSA+PSB0ZXh0SWRDb3VudGVyKSB7XG4gICAgICAgICAgICB0ZXh0SWRDb3VudGVyID0gaWROdW07XG4gICAgICAgICAgfVxuICAgICAgICAgIGN1cnJlbnRUZXh0SWQgPSBpZDtcbiAgICAgICAgICBpblRleHRCbG9jayA9IHRydWU7XG4gICAgICAgICAgY29udHJvbGxlci5lbnF1ZXVlKGNodW5rKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGNhc2UgXCJ0ZXh0LWRlbHRhXCI6IHtcbiAgICAgICAgICBjb25zdCBkZWx0YSA9IGNodW5rIGFzIHsgaWQ6IHN0cmluZzsgZGVsdGE6IHN0cmluZyB9O1xuICAgICAgICAgIGNvbnN0IHRleHQgPSBkZWx0YS5kZWx0YTtcblxuICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGV4dC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgY2ggPSB0ZXh0LmNoYXJBdChpKTtcblxuICAgICAgICAgICAgaWYgKGNoID09PSBcIlxcblwiKSB7XG4gICAgICAgICAgICAgIC8vIExpbmUgY29tcGxldGUg4oCUIGNsYXNzaWZ5IGFuZCBlbWl0XG4gICAgICAgICAgICAgIGlmIChidWZmZXJpbmcpIHtcbiAgICAgICAgICAgICAgICBwcm9jZXNzQ29tcGxldGVMaW5lKGxpbmVCdWZmZXIsIGNvbnRyb2xsZXIpO1xuICAgICAgICAgICAgICAgIGxpbmVCdWZmZXIgPSBcIlwiO1xuICAgICAgICAgICAgICAgIGJ1ZmZlcmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIE91dHNpZGUgZmVuY2UsIGVtaXQgbmV3bGluZTsgaW5zaWRlIGZlbmNlLCBzd2FsbG93IGl0XG4gICAgICAgICAgICAgICAgaWYgKCFpblNwZWNGZW5jZSkge1xuICAgICAgICAgICAgICAgICAgZW1pdFRleHREZWx0YShcIlxcblwiLCBjb250cm9sbGVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAobGluZUJ1ZmZlci5sZW5ndGggPT09IDAgJiYgIWJ1ZmZlcmluZykge1xuICAgICAgICAgICAgICAvLyBTdGFydCBvZiBhIG5ldyBsaW5lIOKAlCBkZWNpZGUgd2hldGhlciB0byBidWZmZXIgb3Igc3RyZWFtXG4gICAgICAgICAgICAgIGlmIChpblNwZWNGZW5jZSB8fCBjaCA9PT0gXCJ7XCIgfHwgY2ggPT09IFwiYFwiKSB7XG4gICAgICAgICAgICAgICAgLy8gQnVmZmVyOiBpbnNpZGUgZmVuY2UgKGV2ZXJ5dGhpbmcpLCBvciBoZXVyaXN0aWMgbW9kZSAoeyksIG9yIHBvdGVudGlhbCBmZW5jZSAoYClcbiAgICAgICAgICAgICAgICBidWZmZXJpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgIGxpbmVCdWZmZXIgKz0gY2g7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZW1pdFRleHREZWx0YShjaCwgY29udHJvbGxlcik7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoYnVmZmVyaW5nKSB7XG4gICAgICAgICAgICAgIGxpbmVCdWZmZXIgKz0gY2g7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBlbWl0VGV4dERlbHRhKGNoLCBjb250cm9sbGVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBjYXNlIFwidGV4dC1lbmRcIjoge1xuICAgICAgICAgIGZsdXNoQnVmZmVyKGNvbnRyb2xsZXIpO1xuICAgICAgICAgIGlmIChpblRleHRCbG9jaykge1xuICAgICAgICAgICAgY29udHJvbGxlci5lbnF1ZXVlKHsgdHlwZTogXCJ0ZXh0LWVuZFwiLCBpZDogY3VycmVudFRleHRJZCB9KTtcbiAgICAgICAgICAgIGluVGV4dEJsb2NrID0gZmFsc2U7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZShjaHVuayk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgZmx1c2goY29udHJvbGxlcikge1xuICAgICAgZmx1c2hCdWZmZXIoY29udHJvbGxlcik7XG4gICAgICBjbG9zZVRleHRCbG9jayhjb250cm9sbGVyKTtcbiAgICB9LFxuICB9KTtcbn1cblxuLyoqXG4gKiBUaGUga2V5IHJlZ2lzdGVyZWQgaW4gYEFwcERhdGFQYXJ0c2AgZm9yIGpzb24tcmVuZGVyIHNwZWNzLlxuICogVGhlIEFJIFNESyBhdXRvbWF0aWNhbGx5IHByZWZpeGVzIHRoaXMgd2l0aCBgXCJkYXRhLVwiYCBvbiB0aGUgd2lyZSxcbiAqIHNvIHRoZSBhY3R1YWwgc3RyZWFtIGNodW5rIHR5cGUgaXMgYFwiZGF0YS1zcGVjXCJgIChzZWUge0BsaW5rIFNQRUNfREFUQV9QQVJUX1RZUEV9KS5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGltcG9ydCB7IFNQRUNfREFUQV9QQVJULCB0eXBlIFNwZWNEYXRhUGFydCB9IGZyb20gXCJAanNvbi1yZW5kZXIvY29yZVwiO1xuICogdHlwZSBBcHBEYXRhUGFydHMgPSB7IFtTUEVDX0RBVEFfUEFSVF06IFNwZWNEYXRhUGFydCB9O1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBTUEVDX0RBVEFfUEFSVCA9IFwic3BlY1wiIGFzIGNvbnN0O1xuXG4vKipcbiAqIFRoZSB3aXJlLWZvcm1hdCB0eXBlIHN0cmluZyBhcyBpdCBhcHBlYXJzIGluIHN0cmVhbSBjaHVua3MgYW5kIG1lc3NhZ2UgcGFydHMuXG4gKiBUaGlzIGlzIGBcImRhdGEtXCJgICsge0BsaW5rIFNQRUNfREFUQV9QQVJUfSDigJQgaS5lLiBgXCJkYXRhLXNwZWNcImAuXG4gKlxuICogVXNlIHRoaXMgY29uc3RhbnQgd2hlbiBmaWx0ZXJpbmcgbWVzc2FnZSBwYXJ0cyBvciBlbnF1ZXVpbmcgc3RyZWFtIGNodW5rcy5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQRUNfREFUQV9QQVJUX1RZUEUgPSBgZGF0YS0ke1NQRUNfREFUQV9QQVJUfWAgYXMgY29uc3Q7XG5cbi8qKlxuICogRGlzY3JpbWluYXRlZCB1bmlvbiBmb3IgdGhlIHBheWxvYWQgb2YgYSB7QGxpbmsgU1BFQ19EQVRBX1BBUlRfVFlQRX0gU1NFIHBhcnQuXG4gKlxuICogLSBgXCJwYXRjaFwiYDogQSBzaW5nbGUgUkZDIDY5MDIgSlNPTiBQYXRjaCBvcGVyYXRpb24gKHN0cmVhbWluZywgcHJvZ3Jlc3NpdmUgVUkpLlxuICogLSBgXCJmbGF0XCJgOiBBIGNvbXBsZXRlIGZsYXQgc3BlYyB3aXRoIGByb290YCwgYGVsZW1lbnRzYCwgYW5kIG9wdGlvbmFsIGBzdGF0ZWAuXG4gKiAtIGBcIm5lc3RlZFwiYDogQSBjb21wbGV0ZSBuZXN0ZWQgc3BlYyAodHJlZSBzdHJ1Y3R1cmUg4oCUIHNjaGVtYSBkZXBlbmRzIG9uIGNhdGFsb2cpLlxuICovXG5leHBvcnQgdHlwZSBTcGVjRGF0YVBhcnQgPVxuICB8IHsgdHlwZTogXCJwYXRjaFwiOyBwYXRjaDogSnNvblBhdGNoIH1cbiAgfCB7IHR5cGU6IFwiZmxhdFwiOyBzcGVjOiBTcGVjIH1cbiAgfCB7IHR5cGU6IFwibmVzdGVkXCI7IHNwZWM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH07XG5cbi8qKlxuICogQ29udmVuaWVuY2Ugd3JhcHBlciB0aGF0IHBpcGVzIGFuIEFJIFNESyBVSSBtZXNzYWdlIHN0cmVhbSB0aHJvdWdoIHRoZVxuICoganNvbi1yZW5kZXIgdHJhbnNmb3JtLCBjbGFzc2lmeWluZyB0ZXh0IGFzIHByb3NlIG9yIEpTT05MIHBhdGNoZXMuXG4gKlxuICogRWxpbWluYXRlcyB0aGUgbmVlZCBmb3IgbWFudWFsIGBwaXBlVGhyb3VnaChjcmVhdGVKc29uUmVuZGVyVHJhbnNmb3JtKCkpYFxuICogYW5kIHRoZSBhc3NvY2lhdGVkIHR5cGUgY2FzdC5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGltcG9ydCB7IHBpcGVKc29uUmVuZGVyIH0gZnJvbSBcIkBqc29uLXJlbmRlci9jb3JlXCI7XG4gKlxuICogY29uc3Qgc3RyZWFtID0gY3JlYXRlVUlNZXNzYWdlU3RyZWFtKHtcbiAqICAgZXhlY3V0ZTogYXN5bmMgKHsgd3JpdGVyIH0pID0+IHtcbiAqICAgICB3cml0ZXIubWVyZ2UocGlwZUpzb25SZW5kZXIocmVzdWx0LnRvVUlNZXNzYWdlU3RyZWFtKCkpKTtcbiAqICAgfSxcbiAqIH0pO1xuICogcmV0dXJuIGNyZWF0ZVVJTWVzc2FnZVN0cmVhbVJlc3BvbnNlKHsgc3RyZWFtIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwaXBlSnNvblJlbmRlcjxUID0gU3RyZWFtQ2h1bms+KFxuICBzdHJlYW06IFJlYWRhYmxlU3RyZWFtPFQ+LFxuKTogUmVhZGFibGVTdHJlYW08VD4ge1xuICByZXR1cm4gc3RyZWFtLnBpcGVUaHJvdWdoKFxuICAgIGNyZWF0ZUpzb25SZW5kZXJUcmFuc2Zvcm0oKSBhcyB1bmtub3duIGFzIFRyYW5zZm9ybVN0cmVhbTxULCBUPixcbiAgKTtcbn1cbiIsICJpbXBvcnQge1xuICBnZXRCeVBhdGgsXG4gIHBhcnNlSnNvblBvaW50ZXIsXG4gIHR5cGUgU3RhdGVNb2RlbCxcbiAgdHlwZSBTdGF0ZVN0b3JlLFxufSBmcm9tIFwiLi90eXBlc1wiO1xuXG4vKipcbiAqIEltbXV0YWJseSBzZXQgYSB2YWx1ZSBhdCBhIEpTT04gUG9pbnRlciBwYXRoIHVzaW5nIHN0cnVjdHVyYWwgc2hhcmluZy5cbiAqIE9ubHkgb2JqZWN0cyBhbG9uZyB0aGUgcGF0aCBhcmUgc2hhbGxvdy1jbG9uZWQ7IHVudG91Y2hlZCBicmFuY2hlcyBrZWVwXG4gKiB0aGVpciBvcmlnaW5hbCByZWZlcmVuY2VzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaW1tdXRhYmxlU2V0QnlQYXRoKFxuICByb290OiBTdGF0ZU1vZGVsLFxuICBwYXRoOiBzdHJpbmcsXG4gIHZhbHVlOiB1bmtub3duLFxuKTogU3RhdGVNb2RlbCB7XG4gIGNvbnN0IHNlZ21lbnRzID0gcGFyc2VKc29uUG9pbnRlcihwYXRoKTtcbiAgaWYgKHNlZ21lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHJvb3Q7XG5cbiAgY29uc3QgcmVzdWx0ID0geyAuLi5yb290IH07XG4gIGxldCBjdXJyZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHJlc3VsdDtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnRzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgIGNvbnN0IHNlZyA9IHNlZ21lbnRzW2ldITtcbiAgICBjb25zdCBjaGlsZCA9IGN1cnJlbnRbc2VnXTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZCkpIHtcbiAgICAgIGN1cnJlbnRbc2VnXSA9IFsuLi5jaGlsZF07XG4gICAgfSBlbHNlIGlmIChjaGlsZCAhPT0gbnVsbCAmJiB0eXBlb2YgY2hpbGQgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGN1cnJlbnRbc2VnXSA9IHsgLi4uKGNoaWxkIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB9O1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBuZXh0U2VnID0gc2VnbWVudHNbaSArIDFdO1xuICAgICAgY3VycmVudFtzZWddID0gbmV4dFNlZyAhPT0gdW5kZWZpbmVkICYmIC9eXFxkKyQvLnRlc3QobmV4dFNlZykgPyBbXSA6IHt9O1xuICAgIH1cbiAgICBjdXJyZW50ID0gY3VycmVudFtzZWddIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICB9XG5cbiAgY29uc3QgbGFzdFNlZyA9IHNlZ21lbnRzW3NlZ21lbnRzLmxlbmd0aCAtIDFdITtcbiAgaWYgKEFycmF5LmlzQXJyYXkoY3VycmVudCkpIHtcbiAgICBpZiAobGFzdFNlZyA9PT0gXCItXCIpIHtcbiAgICAgIChjdXJyZW50IGFzIHVua25vd25bXSkucHVzaCh2YWx1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIChjdXJyZW50IGFzIHVua25vd25bXSlbcGFyc2VJbnQobGFzdFNlZywgMTApXSA9IHZhbHVlO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjdXJyZW50W2xhc3RTZWddID0gdmFsdWU7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHNpbXBsZSBpbi1tZW1vcnkge0BsaW5rIFN0YXRlU3RvcmV9LlxuICpcbiAqIFRoaXMgaXMgdGhlIGRlZmF1bHQgc3RvcmUgdXNlZCBieSBgU3RhdGVQcm92aWRlcmAgd2hlbiBubyBleHRlcm5hbCBzdG9yZSBpc1xuICogcHJvdmlkZWQuIEl0IG1pcnJvcnMgdGhlIHByZXZpb3VzIGB1c2VTdGF0ZWAtYmFzZWQgYmVoYXZpb3VyIGJ1dCBpc1xuICogZnJhbWV3b3JrLWFnbm9zdGljIHNvIGl0IGNhbiBhbHNvIGJlIHVzZWQgaW4gdGVzdHMgb3Igbm9uLVJlYWN0IGNvbnRleHRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU3RhdGVTdG9yZShpbml0aWFsU3RhdGU6IFN0YXRlTW9kZWwgPSB7fSk6IFN0YXRlU3RvcmUge1xuICBsZXQgc3RhdGU6IFN0YXRlTW9kZWwgPSB7IC4uLmluaXRpYWxTdGF0ZSB9O1xuICBjb25zdCBsaXN0ZW5lcnMgPSBuZXcgU2V0PCgpID0+IHZvaWQ+KCk7XG5cbiAgZnVuY3Rpb24gbm90aWZ5KCkge1xuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgbGlzdGVuZXJzKSB7XG4gICAgICBsaXN0ZW5lcigpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZ2V0KHBhdGg6IHN0cmluZyk6IHVua25vd24ge1xuICAgICAgcmV0dXJuIGdldEJ5UGF0aChzdGF0ZSwgcGF0aCk7XG4gICAgfSxcblxuICAgIHNldChwYXRoOiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKTogdm9pZCB7XG4gICAgICBpZiAoZ2V0QnlQYXRoKHN0YXRlLCBwYXRoKSA9PT0gdmFsdWUpIHJldHVybjtcbiAgICAgIHN0YXRlID0gaW1tdXRhYmxlU2V0QnlQYXRoKHN0YXRlLCBwYXRoLCB2YWx1ZSk7XG4gICAgICBub3RpZnkoKTtcbiAgICB9LFxuXG4gICAgdXBkYXRlKHVwZGF0ZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gICAgICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xuICAgICAgbGV0IG5leHQgPSBzdGF0ZTtcbiAgICAgIGZvciAoY29uc3QgW3BhdGgsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh1cGRhdGVzKSkge1xuICAgICAgICBpZiAoZ2V0QnlQYXRoKG5leHQsIHBhdGgpICE9PSB2YWx1ZSkge1xuICAgICAgICAgIG5leHQgPSBpbW11dGFibGVTZXRCeVBhdGgobmV4dCwgcGF0aCwgdmFsdWUpO1xuICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoIWNoYW5nZWQpIHJldHVybjtcbiAgICAgIHN0YXRlID0gbmV4dDtcbiAgICAgIG5vdGlmeSgpO1xuICAgIH0sXG5cbiAgICBnZXRTbmFwc2hvdCgpOiBTdGF0ZU1vZGVsIHtcbiAgICAgIHJldHVybiBzdGF0ZTtcbiAgICB9LFxuXG4gICAgZ2V0U2VydmVyU25hcHNob3QoKTogU3RhdGVNb2RlbCB7XG4gICAgICByZXR1cm4gc3RhdGU7XG4gICAgfSxcblxuICAgIHN1YnNjcmliZShsaXN0ZW5lcjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgICAgbGlzdGVuZXJzLmFkZChsaXN0ZW5lcik7XG4gICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICBsaXN0ZW5lcnMuZGVsZXRlKGxpc3RlbmVyKTtcbiAgICAgIH07XG4gICAgfSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB7QGxpbmsgY3JlYXRlU3RvcmVBZGFwdGVyfS4gQWRhcHRlciBhdXRob3JzIHN1cHBseSB0aGVzZVxuICogdGhyZWUgY2FsbGJhY2tzOyBldmVyeXRoaW5nIGVsc2UgKGdldCwgc2V0LCB1cGRhdGUsIG5vLW9wIGRldGVjdGlvbixcbiAqIGdldFNlcnZlclNuYXBzaG90KSBpcyBoYW5kbGVkIGJ5IHRoZSByZXR1cm5lZCB7QGxpbmsgU3RhdGVTdG9yZX0uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RvcmVBZGFwdGVyQ29uZmlnIHtcbiAgLyoqIFJldHVybiB0aGUgY3VycmVudCBzdGF0ZSBzbmFwc2hvdCBmcm9tIHRoZSB1bmRlcmx5aW5nIHN0b3JlLiAqL1xuICBnZXRTbmFwc2hvdDogKCkgPT4gU3RhdGVNb2RlbDtcbiAgLyoqIFdyaXRlIGEgbmV3IHN0YXRlIHNuYXBzaG90IHRvIHRoZSB1bmRlcmx5aW5nIHN0b3JlLiAqL1xuICBzZXRTbmFwc2hvdDogKG5leHQ6IFN0YXRlTW9kZWwpID0+IHZvaWQ7XG4gIC8qKiBTdWJzY3JpYmUgdG8gY2hhbmdlcyBpbiB0aGUgdW5kZXJseWluZyBzdG9yZS4gUmV0dXJuIGFuIHVuc3Vic2NyaWJlIGZuLiAqL1xuICBzdWJzY3JpYmU6IChsaXN0ZW5lcjogKCkgPT4gdm9pZCkgPT4gKCkgPT4gdm9pZDtcbn1cblxuLyoqXG4gKiBCdWlsZCBhIGZ1bGwge0BsaW5rIFN0YXRlU3RvcmV9IGZyb20gYSBtaW5pbWFsIGFkYXB0ZXIgY29uZmlnLlxuICpcbiAqIEhhbmRsZXMgYGdldGAsIGBzZXRgICh3aXRoIG5vLW9wIGRldGVjdGlvbiksIGB1cGRhdGVgIChiYXRjaGVkLCB3aXRoIG5vLW9wXG4gKiBkZXRlY3Rpb24pLCBgZ2V0U25hcHNob3RgLCBgZ2V0U2VydmVyU25hcHNob3RgLCBhbmQgYHN1YnNjcmliZWAgLS0gc28gZWFjaFxuICogYWRhcHRlciBvbmx5IG5lZWRzIHRvIHdpcmUgaXRzIHNuYXBzaG90IHNvdXJjZSwgd3JpdGUgQVBJLCBhbmQgc3Vic2NyaWJlXG4gKiBtZWNoYW5pc20uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTdG9yZUFkYXB0ZXIoY29uZmlnOiBTdG9yZUFkYXB0ZXJDb25maWcpOiBTdGF0ZVN0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBnZXQocGF0aDogc3RyaW5nKTogdW5rbm93biB7XG4gICAgICByZXR1cm4gZ2V0QnlQYXRoKGNvbmZpZy5nZXRTbmFwc2hvdCgpLCBwYXRoKTtcbiAgICB9LFxuXG4gICAgc2V0KHBhdGg6IHN0cmluZywgdmFsdWU6IHVua25vd24pOiB2b2lkIHtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBjb25maWcuZ2V0U25hcHNob3QoKTtcbiAgICAgIGlmIChnZXRCeVBhdGgoY3VycmVudCwgcGF0aCkgPT09IHZhbHVlKSByZXR1cm47XG4gICAgICBjb25maWcuc2V0U25hcHNob3QoaW1tdXRhYmxlU2V0QnlQYXRoKGN1cnJlbnQsIHBhdGgsIHZhbHVlKSk7XG4gICAgfSxcblxuICAgIHVwZGF0ZSh1cGRhdGVzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgICAgbGV0IG5leHQgPSBjb25maWcuZ2V0U25hcHNob3QoKTtcbiAgICAgIGxldCBjaGFuZ2VkID0gZmFsc2U7XG4gICAgICBmb3IgKGNvbnN0IFtwYXRoLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModXBkYXRlcykpIHtcbiAgICAgICAgaWYgKGdldEJ5UGF0aChuZXh0LCBwYXRoKSAhPT0gdmFsdWUpIHtcbiAgICAgICAgICBuZXh0ID0gaW1tdXRhYmxlU2V0QnlQYXRoKG5leHQsIHBhdGgsIHZhbHVlKTtcbiAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKCFjaGFuZ2VkKSByZXR1cm47XG4gICAgICBjb25maWcuc2V0U25hcHNob3QobmV4dCk7XG4gICAgfSxcblxuICAgIGdldFNuYXBzaG90OiBjb25maWcuZ2V0U25hcHNob3QsXG5cbiAgICBnZXRTZXJ2ZXJTbmFwc2hvdDogY29uZmlnLmdldFNuYXBzaG90LFxuXG4gICAgc3Vic2NyaWJlOiBjb25maWcuc3Vic2NyaWJlLFxuICB9O1xufVxuXG5jb25zdCBNQVhfRkxBVFRFTl9ERVBUSCA9IDIwO1xuXG4vKipcbiAqIFJlY3Vyc2l2ZWx5IGZsYXR0ZW4gYSBwbGFpbiBvYmplY3QgaW50byBhIGBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPmAga2V5ZWQgYnlcbiAqIEpTT04gUG9pbnRlciBwYXRocy4gT25seSBsZWFmIHZhbHVlcyAobm9uLXBsYWluLW9iamVjdCkgYXBwZWFyIGluIHRoZSBvdXRwdXQuXG4gKlxuICogSW5jbHVkZXMgY2lyY3VsYXIgcmVmZXJlbmNlIHByb3RlY3Rpb24gYW5kIGEgZGVwdGggY2FwIHRvIHByZXZlbnQgc3RhY2tcbiAqIG92ZXJmbG93IG9uIHBhdGhvbG9naWNhbCBpbnB1dHMuXG4gKlxuICogYGBgdHNcbiAqIGZsYXR0ZW5Ub1BvaW50ZXJzKHsgdXNlcjogeyBuYW1lOiBcIkFsaWNlXCIgfSwgY291bnQ6IDEgfSlcbiAqIC8vID0+IHsgXCIvdXNlci9uYW1lXCI6IFwiQWxpY2VcIiwgXCIvY291bnRcIjogMSB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZsYXR0ZW5Ub1BvaW50ZXJzKFxuICBvYmo6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICBwcmVmaXggPSBcIlwiLFxuICBfZGVwdGggPSAwLFxuICBfc2Vlbj86IFNldDxvYmplY3Q+LFxuICBfd2FybmVkPzogeyBjdXJyZW50OiBib29sZWFuIH0sXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIGNvbnN0IHNlZW4gPSBfc2VlbiA/PyBuZXcgU2V0PG9iamVjdD4oKTtcbiAgY29uc3Qgd2FybmVkID0gX3dhcm5lZCA/PyB7IGN1cnJlbnQ6IGZhbHNlIH07XG4gIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMob2JqKSkge1xuICAgIGNvbnN0IHBvaW50ZXIgPSBgJHtwcmVmaXh9LyR7a2V5fWA7XG4gICAgaWYgKFxuICAgICAgX2RlcHRoIDwgTUFYX0ZMQVRURU5fREVQVEggJiZcbiAgICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgICB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICFBcnJheS5pc0FycmF5KHZhbHVlKSAmJlxuICAgICAgT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKSA9PT0gT2JqZWN0LnByb3RvdHlwZSAmJlxuICAgICAgIXNlZW4uaGFzKHZhbHVlKVxuICAgICkge1xuICAgICAgc2Vlbi5hZGQodmFsdWUpO1xuICAgICAgT2JqZWN0LmFzc2lnbihcbiAgICAgICAgcmVzdWx0LFxuICAgICAgICBmbGF0dGVuVG9Qb2ludGVycyhcbiAgICAgICAgICB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICAgICAgICBwb2ludGVyLFxuICAgICAgICAgIF9kZXB0aCArIDEsXG4gICAgICAgICAgc2VlbixcbiAgICAgICAgICB3YXJuZWQsXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoXG4gICAgICAgIHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSBcInByb2R1Y3Rpb25cIiAmJlxuICAgICAgICAhd2FybmVkLmN1cnJlbnQgJiZcbiAgICAgICAgX2RlcHRoID49IE1BWF9GTEFUVEVOX0RFUFRIICYmXG4gICAgICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICAhQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiZcbiAgICAgICAgT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKSA9PT0gT2JqZWN0LnByb3RvdHlwZSAmJlxuICAgICAgICAhc2Vlbi5oYXModmFsdWUgYXMgb2JqZWN0KVxuICAgICAgKSB7XG4gICAgICAgIHdhcm5lZC5jdXJyZW50ID0gdHJ1ZTtcbiAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgIGBmbGF0dGVuVG9Qb2ludGVyczogZGVwdGggbGltaXQgKCR7TUFYX0ZMQVRURU5fREVQVEh9KSByZWFjaGVkLiBOZXN0ZWQgc3RhdGUgYmV5b25kIHRoaXMgZGVwdGggd2lsbCBiZSB0cmVhdGVkIGFzIGEgbGVhZiB2YWx1ZS5gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmVzdWx0W3BvaW50ZXJdID0gdmFsdWU7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG4iLCAiaW1wb3J0IHsgeiB9IGZyb20gXCJ6b2RcIjtcbmltcG9ydCB0eXBlIHtcbiAgVmlzaWJpbGl0eUNvbmRpdGlvbixcbiAgU3RhdGVDb25kaXRpb24sXG4gIEl0ZW1Db25kaXRpb24sXG4gIEluZGV4Q29uZGl0aW9uLFxuICBTaW5nbGVDb25kaXRpb24sXG4gIEFuZENvbmRpdGlvbixcbiAgT3JDb25kaXRpb24sXG4gIFN0YXRlTW9kZWwsXG59IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyBnZXRCeVBhdGggfSBmcm9tIFwiLi90eXBlc1wiO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU2NoZW1hc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBTY2hlbWEgZm9yIGEgc2luZ2xlIHN0YXRlIGNvbmRpdGlvbi5cbiAqL1xuY29uc3QgbnVtZXJpY09yU3RhdGVSZWYgPSB6LnVuaW9uKFtcbiAgei5udW1iZXIoKSxcbiAgei5vYmplY3QoeyAkc3RhdGU6IHouc3RyaW5nKCkgfSksXG5dKTtcblxuY29uc3QgY29tcGFyaXNvbk9wcyA9IHtcbiAgZXE6IHoudW5rbm93bigpLm9wdGlvbmFsKCksXG4gIG5lcTogei51bmtub3duKCkub3B0aW9uYWwoKSxcbiAgZ3Q6IG51bWVyaWNPclN0YXRlUmVmLm9wdGlvbmFsKCksXG4gIGd0ZTogbnVtZXJpY09yU3RhdGVSZWYub3B0aW9uYWwoKSxcbiAgbHQ6IG51bWVyaWNPclN0YXRlUmVmLm9wdGlvbmFsKCksXG4gIGx0ZTogbnVtZXJpY09yU3RhdGVSZWYub3B0aW9uYWwoKSxcbiAgbm90OiB6LmxpdGVyYWwodHJ1ZSkub3B0aW9uYWwoKSxcbn07XG5cbmNvbnN0IFN0YXRlQ29uZGl0aW9uU2NoZW1hID0gei5vYmplY3Qoe1xuICAkc3RhdGU6IHouc3RyaW5nKCksXG4gIC4uLmNvbXBhcmlzb25PcHMsXG59KTtcblxuY29uc3QgSXRlbUNvbmRpdGlvblNjaGVtYSA9IHoub2JqZWN0KHtcbiAgJGl0ZW06IHouc3RyaW5nKCksXG4gIC4uLmNvbXBhcmlzb25PcHMsXG59KTtcblxuY29uc3QgSW5kZXhDb25kaXRpb25TY2hlbWEgPSB6Lm9iamVjdCh7XG4gICRpbmRleDogei5saXRlcmFsKHRydWUpLFxuICAuLi5jb21wYXJpc29uT3BzLFxufSk7XG5cbmNvbnN0IFNpbmdsZUNvbmRpdGlvblNjaGVtYSA9IHoudW5pb24oW1xuICBTdGF0ZUNvbmRpdGlvblNjaGVtYSxcbiAgSXRlbUNvbmRpdGlvblNjaGVtYSxcbiAgSW5kZXhDb25kaXRpb25TY2hlbWEsXG5dKTtcblxuLyoqXG4gKiBWaXNpYmlsaXR5IGNvbmRpdGlvbiBzY2hlbWEuXG4gKlxuICogTGF6eSBiZWNhdXNlIGBPckNvbmRpdGlvbmAgY2FuIHJlY3Vyc2l2ZWx5IGNvbnRhaW4gYFZpc2liaWxpdHlDb25kaXRpb25gLlxuICovXG5leHBvcnQgY29uc3QgVmlzaWJpbGl0eUNvbmRpdGlvblNjaGVtYTogei5ab2RUeXBlPFZpc2liaWxpdHlDb25kaXRpb24+ID0gei5sYXp5KFxuICAoKSA9PlxuICAgIHoudW5pb24oW1xuICAgICAgei5ib29sZWFuKCksXG4gICAgICBTaW5nbGVDb25kaXRpb25TY2hlbWEsXG4gICAgICB6LmFycmF5KFNpbmdsZUNvbmRpdGlvblNjaGVtYSksXG4gICAgICB6Lm9iamVjdCh7ICRhbmQ6IHouYXJyYXkoVmlzaWJpbGl0eUNvbmRpdGlvblNjaGVtYSkgfSksXG4gICAgICB6Lm9iamVjdCh7ICRvcjogei5hcnJheShWaXNpYmlsaXR5Q29uZGl0aW9uU2NoZW1hKSB9KSxcbiAgICBdKSxcbik7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb250ZXh0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIENvbnRleHQgZm9yIGV2YWx1YXRpbmcgdmlzaWJpbGl0eSBjb25kaXRpb25zLlxuICpcbiAqIGByZXBlYXRJdGVtYCBhbmQgYHJlcGVhdEluZGV4YCBhcmUgb25seSBwcmVzZW50IGluc2lkZSBhIGByZXBlYXRgIHNjb3BlXG4gKiBhbmQgZW5hYmxlIGAkaXRlbWAgLyBgJGluZGV4YCBjb25kaXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFZpc2liaWxpdHlDb250ZXh0IHtcbiAgc3RhdGVNb2RlbDogU3RhdGVNb2RlbDtcbiAgLyoqIFRoZSBjdXJyZW50IHJlcGVhdCBpdGVtIChzZXQgaW5zaWRlIGEgcmVwZWF0IHNjb3BlKS4gKi9cbiAgcmVwZWF0SXRlbT86IHVua25vd247XG4gIC8qKiBUaGUgY3VycmVudCByZXBlYXQgYXJyYXkgaW5kZXggKHNldCBpbnNpZGUgYSByZXBlYXQgc2NvcGUpLiAqL1xuICByZXBlYXRJbmRleD86IG51bWJlcjtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV2YWx1YXRpb25cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogUmVzb2x2ZSBhIGNvbXBhcmlzb24gdmFsdWUuIElmIGl0J3MgYSBgeyAkc3RhdGUgfWAgcmVmZXJlbmNlLCBsb29rIGl0IHVwO1xuICogb3RoZXJ3aXNlIHJldHVybiB0aGUgbGl0ZXJhbC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZUNvbXBhcmlzb25WYWx1ZShcbiAgdmFsdWU6IHVua25vd24sXG4gIGN0eDogVmlzaWJpbGl0eUNvbnRleHQsXG4pOiB1bmtub3duIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB2YWx1ZSAhPT0gbnVsbCkge1xuICAgIGlmIChcbiAgICAgIFwiJHN0YXRlXCIgaW4gdmFsdWUgJiZcbiAgICAgIHR5cGVvZiAodmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLiRzdGF0ZSA9PT0gXCJzdHJpbmdcIlxuICAgICkge1xuICAgICAgcmV0dXJuIGdldEJ5UGF0aChjdHguc3RhdGVNb2RlbCwgKHZhbHVlIGFzIHsgJHN0YXRlOiBzdHJpbmcgfSkuJHN0YXRlKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG4vKipcbiAqIFR5cGUgZ3VhcmRzIGZvciBjb25kaXRpb24gc291cmNlcy5cbiAqL1xuZnVuY3Rpb24gaXNJdGVtQ29uZGl0aW9uKGNvbmQ6IFNpbmdsZUNvbmRpdGlvbik6IGNvbmQgaXMgSXRlbUNvbmRpdGlvbiB7XG4gIHJldHVybiBcIiRpdGVtXCIgaW4gY29uZDtcbn1cblxuZnVuY3Rpb24gaXNJbmRleENvbmRpdGlvbihjb25kOiBTaW5nbGVDb25kaXRpb24pOiBjb25kIGlzIEluZGV4Q29uZGl0aW9uIHtcbiAgcmV0dXJuIFwiJGluZGV4XCIgaW4gY29uZDtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBsZWZ0LWhhbmQtc2lkZSB2YWx1ZSBvZiBhIGNvbmRpdGlvbiBiYXNlZCBvbiBpdHMgc291cmNlLlxuICovXG5mdW5jdGlvbiByZXNvbHZlQ29uZGl0aW9uVmFsdWUoXG4gIGNvbmQ6IFNpbmdsZUNvbmRpdGlvbixcbiAgY3R4OiBWaXNpYmlsaXR5Q29udGV4dCxcbik6IHVua25vd24ge1xuICBpZiAoaXNJbmRleENvbmRpdGlvbihjb25kKSkge1xuICAgIHJldHVybiBjdHgucmVwZWF0SW5kZXg7XG4gIH1cbiAgaWYgKGlzSXRlbUNvbmRpdGlvbihjb25kKSkge1xuICAgIGlmIChjdHgucmVwZWF0SXRlbSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHJldHVybiBjb25kLiRpdGVtID09PSBcIlwiXG4gICAgICA/IGN0eC5yZXBlYXRJdGVtXG4gICAgICA6IGdldEJ5UGF0aChjdHgucmVwZWF0SXRlbSwgY29uZC4kaXRlbSk7XG4gIH1cbiAgLy8gU3RhdGVDb25kaXRpb25cbiAgcmV0dXJuIGdldEJ5UGF0aChjdHguc3RhdGVNb2RlbCwgKGNvbmQgYXMgU3RhdGVDb25kaXRpb24pLiRzdGF0ZSk7XG59XG5cbi8qKlxuICogRXZhbHVhdGUgYSBzaW5nbGUgY29uZGl0aW9uIGFnYWluc3QgdGhlIGNvbnRleHQuXG4gKlxuICogV2hlbiBgbm90YCBpcyBgdHJ1ZWAsIHRoZSBmaW5hbCByZXN1bHQgaXMgaW52ZXJ0ZWQg4oCUIHRoaXMgYXBwbGllcyB0b1xuICogd2hpY2hldmVyIG9wZXJhdG9yIGlzIHByZXNlbnQgKG9yIHRvIHRoZSB0cnV0aGluZXNzIGNoZWNrIGlmIG5vIG9wZXJhdG9yXG4gKiBpcyBnaXZlbikuICBGb3IgZXhhbXBsZTpcbiAqIC0gYHsgJHN0YXRlOiBcIi94XCIsIG5vdDogdHJ1ZSB9YCDihpIgYCFCb29sZWFuKHZhbHVlKWBcbiAqIC0gYHsgJHN0YXRlOiBcIi94XCIsIGd0OiA1LCBub3Q6IHRydWUgfWAg4oaSIGAhKHZhbHVlID4gNSlgXG4gKi9cbmZ1bmN0aW9uIGV2YWx1YXRlQ29uZGl0aW9uKFxuICBjb25kOiBTaW5nbGVDb25kaXRpb24sXG4gIGN0eDogVmlzaWJpbGl0eUNvbnRleHQsXG4pOiBib29sZWFuIHtcbiAgY29uc3QgdmFsdWUgPSByZXNvbHZlQ29uZGl0aW9uVmFsdWUoY29uZCwgY3R4KTtcbiAgbGV0IHJlc3VsdDogYm9vbGVhbjtcblxuICAvLyBFcXVhbGl0eVxuICBpZiAoY29uZC5lcSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgcmhzID0gcmVzb2x2ZUNvbXBhcmlzb25WYWx1ZShjb25kLmVxLCBjdHgpO1xuICAgIHJlc3VsdCA9IHZhbHVlID09PSByaHM7XG4gIH1cbiAgLy8gSW5lcXVhbGl0eVxuICBlbHNlIGlmIChjb25kLm5lcSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgcmhzID0gcmVzb2x2ZUNvbXBhcmlzb25WYWx1ZShjb25kLm5lcSwgY3R4KTtcbiAgICByZXN1bHQgPSB2YWx1ZSAhPT0gcmhzO1xuICB9XG4gIC8vIEdyZWF0ZXIgdGhhblxuICBlbHNlIGlmIChjb25kLmd0ICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCByaHMgPSByZXNvbHZlQ29tcGFyaXNvblZhbHVlKGNvbmQuZ3QsIGN0eCk7XG4gICAgcmVzdWx0ID1cbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgcmhzID09PSBcIm51bWJlclwiXG4gICAgICAgID8gdmFsdWUgPiByaHNcbiAgICAgICAgOiBmYWxzZTtcbiAgfVxuICAvLyBHcmVhdGVyIHRoYW4gb3IgZXF1YWxcbiAgZWxzZSBpZiAoY29uZC5ndGUgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHJocyA9IHJlc29sdmVDb21wYXJpc29uVmFsdWUoY29uZC5ndGUsIGN0eCk7XG4gICAgcmVzdWx0ID1cbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgcmhzID09PSBcIm51bWJlclwiXG4gICAgICAgID8gdmFsdWUgPj0gcmhzXG4gICAgICAgIDogZmFsc2U7XG4gIH1cbiAgLy8gTGVzcyB0aGFuXG4gIGVsc2UgaWYgKGNvbmQubHQgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHJocyA9IHJlc29sdmVDb21wYXJpc29uVmFsdWUoY29uZC5sdCwgY3R4KTtcbiAgICByZXN1bHQgPVxuICAgICAgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIHR5cGVvZiByaHMgPT09IFwibnVtYmVyXCJcbiAgICAgICAgPyB2YWx1ZSA8IHJoc1xuICAgICAgICA6IGZhbHNlO1xuICB9XG4gIC8vIExlc3MgdGhhbiBvciBlcXVhbFxuICBlbHNlIGlmIChjb25kLmx0ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgcmhzID0gcmVzb2x2ZUNvbXBhcmlzb25WYWx1ZShjb25kLmx0ZSwgY3R4KTtcbiAgICByZXN1bHQgPVxuICAgICAgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIHR5cGVvZiByaHMgPT09IFwibnVtYmVyXCJcbiAgICAgICAgPyB2YWx1ZSA8PSByaHNcbiAgICAgICAgOiBmYWxzZTtcbiAgfVxuICAvLyBUcnV0aGluZXNzIChubyBvcGVyYXRvcilcbiAgZWxzZSB7XG4gICAgcmVzdWx0ID0gQm9vbGVhbih2YWx1ZSk7XG4gIH1cblxuICAvLyBgbm90YCBpbnZlcnRzIHRoZSByZXN1bHQgb2YgYW55IGNvbmRpdGlvblxuICByZXR1cm4gY29uZC5ub3QgPT09IHRydWUgPyAhcmVzdWx0IDogcmVzdWx0O1xufVxuXG4vKipcbiAqIFR5cGUgZ3VhcmQgZm9yIEFuZENvbmRpdGlvblxuICovXG5mdW5jdGlvbiBpc0FuZENvbmRpdGlvbihcbiAgY29uZGl0aW9uOiBWaXNpYmlsaXR5Q29uZGl0aW9uLFxuKTogY29uZGl0aW9uIGlzIEFuZENvbmRpdGlvbiB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIGNvbmRpdGlvbiA9PT0gXCJvYmplY3RcIiAmJlxuICAgIGNvbmRpdGlvbiAhPT0gbnVsbCAmJlxuICAgICFBcnJheS5pc0FycmF5KGNvbmRpdGlvbikgJiZcbiAgICBcIiRhbmRcIiBpbiBjb25kaXRpb25cbiAgKTtcbn1cblxuLyoqXG4gKiBUeXBlIGd1YXJkIGZvciBPckNvbmRpdGlvblxuICovXG5mdW5jdGlvbiBpc09yQ29uZGl0aW9uKFxuICBjb25kaXRpb246IFZpc2liaWxpdHlDb25kaXRpb24sXG4pOiBjb25kaXRpb24gaXMgT3JDb25kaXRpb24ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBjb25kaXRpb24gPT09IFwib2JqZWN0XCIgJiZcbiAgICBjb25kaXRpb24gIT09IG51bGwgJiZcbiAgICAhQXJyYXkuaXNBcnJheShjb25kaXRpb24pICYmXG4gICAgXCIkb3JcIiBpbiBjb25kaXRpb25cbiAgKTtcbn1cblxuLyoqXG4gKiBFdmFsdWF0ZSBhIHZpc2liaWxpdHkgY29uZGl0aW9uLlxuICpcbiAqIC0gYHVuZGVmaW5lZGAg4oaSIHZpc2libGVcbiAqIC0gYGJvb2xlYW5gIOKGkiB0aGF0IHZhbHVlXG4gKiAtIGBTaW5nbGVDb25kaXRpb25gIOKGkiBldmFsdWF0ZSBzaW5nbGUgY29uZGl0aW9uXG4gKiAtIGBTaW5nbGVDb25kaXRpb25bXWAg4oaSIGltcGxpY2l0IEFORCAoYWxsIG11c3QgYmUgdHJ1ZSlcbiAqIC0gYEFuZENvbmRpdGlvbmAg4oaSIGB7ICRhbmQ6IFsuLi5dIH1gLCBleHBsaWNpdCBBTkRcbiAqIC0gYE9yQ29uZGl0aW9uYCDihpIgYHsgJG9yOiBbLi4uXSB9YCwgYXQgbGVhc3Qgb25lIG11c3QgYmUgdHJ1ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gZXZhbHVhdGVWaXNpYmlsaXR5KFxuICBjb25kaXRpb246IFZpc2liaWxpdHlDb25kaXRpb24gfCB1bmRlZmluZWQsXG4gIGN0eDogVmlzaWJpbGl0eUNvbnRleHQsXG4pOiBib29sZWFuIHtcbiAgLy8gTm8gY29uZGl0aW9uID0gdmlzaWJsZVxuICBpZiAoY29uZGl0aW9uID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIEJvb2xlYW4gbGl0ZXJhbFxuICBpZiAodHlwZW9mIGNvbmRpdGlvbiA9PT0gXCJib29sZWFuXCIpIHtcbiAgICByZXR1cm4gY29uZGl0aW9uO1xuICB9XG5cbiAgLy8gQXJyYXkgPSBpbXBsaWNpdCBBTkRcbiAgaWYgKEFycmF5LmlzQXJyYXkoY29uZGl0aW9uKSkge1xuICAgIHJldHVybiBjb25kaXRpb24uZXZlcnkoKGMpID0+IGV2YWx1YXRlQ29uZGl0aW9uKGMsIGN0eCkpO1xuICB9XG5cbiAgLy8gRXhwbGljaXQgQU5EIGNvbmRpdGlvblxuICBpZiAoaXNBbmRDb25kaXRpb24oY29uZGl0aW9uKSkge1xuICAgIHJldHVybiBjb25kaXRpb24uJGFuZC5ldmVyeSgoY2hpbGQpID0+IGV2YWx1YXRlVmlzaWJpbGl0eShjaGlsZCwgY3R4KSk7XG4gIH1cblxuICAvLyBPUiBjb25kaXRpb25cbiAgaWYgKGlzT3JDb25kaXRpb24oY29uZGl0aW9uKSkge1xuICAgIHJldHVybiBjb25kaXRpb24uJG9yLnNvbWUoKGNoaWxkKSA9PiBldmFsdWF0ZVZpc2liaWxpdHkoY2hpbGQsIGN0eCkpO1xuICB9XG5cbiAgLy8gU2luZ2xlIGNvbmRpdGlvblxuICByZXR1cm4gZXZhbHVhdGVDb25kaXRpb24oY29uZGl0aW9uLCBjdHgpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gSGVscGVyc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBIZWxwZXIgdG8gY3JlYXRlIHZpc2liaWxpdHkgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGNvbnN0IHZpc2liaWxpdHkgPSB7XG4gIC8qKiBBbHdheXMgdmlzaWJsZSAqL1xuICBhbHdheXM6IHRydWUgYXMgY29uc3QsXG5cbiAgLyoqIE5ldmVyIHZpc2libGUgKi9cbiAgbmV2ZXI6IGZhbHNlIGFzIGNvbnN0LFxuXG4gIC8qKiBWaXNpYmxlIHdoZW4gc3RhdGUgcGF0aCBpcyB0cnV0aHkgKi9cbiAgd2hlbjogKHBhdGg6IHN0cmluZyk6IFN0YXRlQ29uZGl0aW9uID0+ICh7ICRzdGF0ZTogcGF0aCB9KSxcblxuICAvKiogVmlzaWJsZSB3aGVuIHN0YXRlIHBhdGggaXMgZmFsc3kgKi9cbiAgdW5sZXNzOiAocGF0aDogc3RyaW5nKTogU3RhdGVDb25kaXRpb24gPT4gKHsgJHN0YXRlOiBwYXRoLCBub3Q6IHRydWUgfSksXG5cbiAgLyoqIEVxdWFsaXR5IGNoZWNrICovXG4gIGVxOiAocGF0aDogc3RyaW5nLCB2YWx1ZTogdW5rbm93bik6IFN0YXRlQ29uZGl0aW9uID0+ICh7XG4gICAgJHN0YXRlOiBwYXRoLFxuICAgIGVxOiB2YWx1ZSxcbiAgfSksXG5cbiAgLyoqIE5vdCBlcXVhbCBjaGVjayAqL1xuICBuZXE6IChwYXRoOiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKTogU3RhdGVDb25kaXRpb24gPT4gKHtcbiAgICAkc3RhdGU6IHBhdGgsXG4gICAgbmVxOiB2YWx1ZSxcbiAgfSksXG5cbiAgLyoqIEdyZWF0ZXIgdGhhbiAqL1xuICBndDogKHBhdGg6IHN0cmluZywgdmFsdWU6IG51bWJlciB8IHsgJHN0YXRlOiBzdHJpbmcgfSk6IFN0YXRlQ29uZGl0aW9uID0+ICh7XG4gICAgJHN0YXRlOiBwYXRoLFxuICAgIGd0OiB2YWx1ZSxcbiAgfSksXG5cbiAgLyoqIEdyZWF0ZXIgdGhhbiBvciBlcXVhbCAqL1xuICBndGU6IChwYXRoOiBzdHJpbmcsIHZhbHVlOiBudW1iZXIgfCB7ICRzdGF0ZTogc3RyaW5nIH0pOiBTdGF0ZUNvbmRpdGlvbiA9PiAoe1xuICAgICRzdGF0ZTogcGF0aCxcbiAgICBndGU6IHZhbHVlLFxuICB9KSxcblxuICAvKiogTGVzcyB0aGFuICovXG4gIGx0OiAocGF0aDogc3RyaW5nLCB2YWx1ZTogbnVtYmVyIHwgeyAkc3RhdGU6IHN0cmluZyB9KTogU3RhdGVDb25kaXRpb24gPT4gKHtcbiAgICAkc3RhdGU6IHBhdGgsXG4gICAgbHQ6IHZhbHVlLFxuICB9KSxcblxuICAvKiogTGVzcyB0aGFuIG9yIGVxdWFsICovXG4gIGx0ZTogKHBhdGg6IHN0cmluZywgdmFsdWU6IG51bWJlciB8IHsgJHN0YXRlOiBzdHJpbmcgfSk6IFN0YXRlQ29uZGl0aW9uID0+ICh7XG4gICAgJHN0YXRlOiBwYXRoLFxuICAgIGx0ZTogdmFsdWUsXG4gIH0pLFxuXG4gIC8qKiBBTkQgbXVsdGlwbGUgY29uZGl0aW9ucyAqL1xuICBhbmQ6ICguLi5jb25kaXRpb25zOiBWaXNpYmlsaXR5Q29uZGl0aW9uW10pOiBBbmRDb25kaXRpb24gPT4gKHtcbiAgICAkYW5kOiBjb25kaXRpb25zLFxuICB9KSxcblxuICAvKiogT1IgbXVsdGlwbGUgY29uZGl0aW9ucyAqL1xuICBvcjogKC4uLmNvbmRpdGlvbnM6IFZpc2liaWxpdHlDb25kaXRpb25bXSk6IE9yQ29uZGl0aW9uID0+ICh7XG4gICAgJG9yOiBjb25kaXRpb25zLFxuICB9KSxcbn07XG4iLCAiaW1wb3J0IHR5cGUgeyBWaXNpYmlsaXR5Q29uZGl0aW9uLCBTdGF0ZU1vZGVsIH0gZnJvbSBcIi4vdHlwZXNcIjtcbmltcG9ydCB7IGdldEJ5UGF0aCB9IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyBldmFsdWF0ZVZpc2liaWxpdHksIHR5cGUgVmlzaWJpbGl0eUNvbnRleHQgfSBmcm9tIFwiLi92aXNpYmlsaXR5XCI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQcm9wIEV4cHJlc3Npb24gVHlwZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQSBwcm9wIGV4cHJlc3Npb24gdGhhdCByZXNvbHZlcyB0byBhIHZhbHVlIGJhc2VkIG9uIHN0YXRlLlxuICpcbiAqIC0gYHsgJHN0YXRlOiBzdHJpbmcgfWAgcmVhZHMgYSB2YWx1ZSBmcm9tIHRoZSBnbG9iYWwgc3RhdGUgbW9kZWxcbiAqIC0gYHsgJGl0ZW06IHN0cmluZyB9YCByZWFkcyBhIGZpZWxkIGZyb20gdGhlIGN1cnJlbnQgcmVwZWF0IGl0ZW1cbiAqICAgIChyZWxhdGl2ZSBwYXRoIGludG8gdGhlIGl0ZW0gb2JqZWN0OyB1c2UgYFwiXCJgIGZvciB0aGUgd2hvbGUgaXRlbSlcbiAqIC0gYHsgJGluZGV4OiB0cnVlIH1gIHJldHVybnMgdGhlIGN1cnJlbnQgcmVwZWF0IGFycmF5IGluZGV4LiBVc2VzIGB0cnVlYFxuICogICAgYXMgYSBzZW50aW5lbCBmbGFnIGJlY2F1c2UgdGhlIGluZGV4IGlzIGEgc2NhbGFyIHdpdGggbm8gc3ViLXBhdGggdG9cbiAqICAgIG5hdmlnYXRlIOKAlCB1bmxpa2UgYCRpdGVtYCB3aGljaCBuZWVkcyBhIHBhdGggaW50byB0aGUgaXRlbSBvYmplY3QuXG4gKiAtIGB7ICRiaW5kU3RhdGU6IHN0cmluZyB9YCB0d28td2F5IGJpbmRpbmcgdG8gYSBnbG9iYWwgc3RhdGUgcGF0aCDigJRcbiAqICAgIHJlc29sdmVzIHRvIHRoZSB2YWx1ZSBhdCB0aGUgcGF0aCAobGlrZSBgJHN0YXRlYCkgQU5EIGV4cG9zZXMgdGhlXG4gKiAgICByZXNvbHZlZCBwYXRoIHNvIHRoZSBjb21wb25lbnQgY2FuIHdyaXRlIGJhY2suXG4gKiAtIGB7ICRiaW5kSXRlbTogc3RyaW5nIH1gIHR3by13YXkgYmluZGluZyB0byBhIGZpZWxkIG9uIHRoZSBjdXJyZW50XG4gKiAgICByZXBlYXQgaXRlbSDigJQgcmVzb2x2ZXMgdmlhIGByZXBlYXRCYXNlUGF0aCArIHBhdGhgIGFuZCBleHBvc2VzIHRoZVxuICogICAgYWJzb2x1dGUgc3RhdGUgcGF0aCBmb3Igd3JpdGUtYmFjay5cbiAqIC0gYHsgJGNvbmQsICR0aGVuLCAkZWxzZSB9YCBjb25kaXRpb25hbGx5IHBpY2tzIGEgdmFsdWVcbiAqIC0gYHsgJGNvbXB1dGVkOiBzdHJpbmcsIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBQcm9wRXhwcmVzc2lvbj4gfWAgY2FsbHMgYVxuICogICAgcmVnaXN0ZXJlZCBmdW5jdGlvbiB3aXRoIHJlc29sdmVkIGFyZ3MgYW5kIHJldHVybnMgdGhlIHJlc3VsdFxuICogLSBgeyAkdGVtcGxhdGU6IHN0cmluZyB9YCBpbnRlcnBvbGF0ZXMgYCR7L3BhdGh9YCByZWZlcmVuY2VzIGluIHRoZVxuICogICAgc3RyaW5nIHdpdGggdmFsdWVzIGZyb20gdGhlIHN0YXRlIG1vZGVsXG4gKiAtIEFueSBvdGhlciB2YWx1ZSBpcyBhIGxpdGVyYWwgKHBhc3N0aHJvdWdoKVxuICovXG5leHBvcnQgdHlwZSBQcm9wRXhwcmVzc2lvbjxUID0gdW5rbm93bj4gPVxuICB8IFRcbiAgfCB7ICRzdGF0ZTogc3RyaW5nIH1cbiAgfCB7ICRpdGVtOiBzdHJpbmcgfVxuICB8IHsgJGluZGV4OiB0cnVlIH1cbiAgfCB7ICRiaW5kU3RhdGU6IHN0cmluZyB9XG4gIHwgeyAkYmluZEl0ZW06IHN0cmluZyB9XG4gIHwge1xuICAgICAgJGNvbmQ6IFZpc2liaWxpdHlDb25kaXRpb247XG4gICAgICAkdGhlbjogUHJvcEV4cHJlc3Npb248VD47XG4gICAgICAkZWxzZTogUHJvcEV4cHJlc3Npb248VD47XG4gICAgfVxuICB8IHsgJGNvbXB1dGVkOiBzdHJpbmc7IGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9XG4gIHwgeyAkdGVtcGxhdGU6IHN0cmluZyB9O1xuXG4vKipcbiAqIEZ1bmN0aW9uIHNpZ25hdHVyZSBmb3IgYCRjb21wdXRlZGAgZXhwcmVzc2lvbnMuXG4gKiBSZWNlaXZlcyBhIHJlY29yZCBvZiByZXNvbHZlZCBhcmd1bWVudCB2YWx1ZXMgYW5kIHJldHVybnMgYSBjb21wdXRlZCByZXN1bHQuXG4gKi9cbmV4cG9ydCB0eXBlIENvbXB1dGVkRnVuY3Rpb24gPSAoYXJnczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHVua25vd247XG5cbi8qKlxuICogQ29udGV4dCBmb3IgcmVzb2x2aW5nIHByb3AgZXhwcmVzc2lvbnMuXG4gKiBFeHRlbmRzIHtAbGluayBWaXNpYmlsaXR5Q29udGV4dH0gd2l0aCBhbiBvcHRpb25hbCBgcmVwZWF0QmFzZVBhdGhgIHVzZWRcbiAqIHRvIHJlc29sdmUgYCRiaW5kSXRlbWAgcGF0aHMgdG8gYWJzb2x1dGUgc3RhdGUgcGF0aHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHJvcFJlc29sdXRpb25Db250ZXh0IGV4dGVuZHMgVmlzaWJpbGl0eUNvbnRleHQge1xuICAvKiogQWJzb2x1dGUgc3RhdGUgcGF0aCB0byB0aGUgY3VycmVudCByZXBlYXQgaXRlbSAoZS5nLiBcIi90b2Rvcy8wXCIpLiBTZXQgaW5zaWRlIHJlcGVhdCBzY29wZXMuICovXG4gIHJlcGVhdEJhc2VQYXRoPzogc3RyaW5nO1xuICAvKiogTmFtZWQgZnVuY3Rpb25zIGF2YWlsYWJsZSBmb3IgYCRjb21wdXRlZGAgZXhwcmVzc2lvbnMuICovXG4gIGZ1bmN0aW9ucz86IFJlY29yZDxzdHJpbmcsIENvbXB1dGVkRnVuY3Rpb24+O1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVHlwZSBHdWFyZHNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbmZ1bmN0aW9uIGlzU3RhdGVFeHByZXNzaW9uKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgeyAkc3RhdGU6IHN0cmluZyB9IHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIFwiJHN0YXRlXCIgaW4gdmFsdWUgJiZcbiAgICB0eXBlb2YgKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS4kc3RhdGUgPT09IFwic3RyaW5nXCJcbiAgKTtcbn1cblxuZnVuY3Rpb24gaXNJdGVtRXhwcmVzc2lvbih2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIHsgJGl0ZW06IHN0cmluZyB9IHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIFwiJGl0ZW1cIiBpbiB2YWx1ZSAmJlxuICAgIHR5cGVvZiAodmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLiRpdGVtID09PSBcInN0cmluZ1wiXG4gICk7XG59XG5cbmZ1bmN0aW9uIGlzSW5kZXhFeHByZXNzaW9uKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgeyAkaW5kZXg6IHRydWUgfSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBcIiRpbmRleFwiIGluIHZhbHVlICYmXG4gICAgKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS4kaW5kZXggPT09IHRydWVcbiAgKTtcbn1cblxuZnVuY3Rpb24gaXNCaW5kU3RhdGVFeHByZXNzaW9uKFxuICB2YWx1ZTogdW5rbm93bixcbik6IHZhbHVlIGlzIHsgJGJpbmRTdGF0ZTogc3RyaW5nIH0ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgXCIkYmluZFN0YXRlXCIgaW4gdmFsdWUgJiZcbiAgICB0eXBlb2YgKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS4kYmluZFN0YXRlID09PSBcInN0cmluZ1wiXG4gICk7XG59XG5cbmZ1bmN0aW9uIGlzQmluZEl0ZW1FeHByZXNzaW9uKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgeyAkYmluZEl0ZW06IHN0cmluZyB9IHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIFwiJGJpbmRJdGVtXCIgaW4gdmFsdWUgJiZcbiAgICB0eXBlb2YgKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS4kYmluZEl0ZW0gPT09IFwic3RyaW5nXCJcbiAgKTtcbn1cblxuZnVuY3Rpb24gaXNDb25kRXhwcmVzc2lvbihcbiAgdmFsdWU6IHVua25vd24sXG4pOiB2YWx1ZSBpcyB7ICRjb25kOiBWaXNpYmlsaXR5Q29uZGl0aW9uOyAkdGhlbjogdW5rbm93bjsgJGVsc2U6IHVua25vd24gfSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBcIiRjb25kXCIgaW4gdmFsdWUgJiZcbiAgICBcIiR0aGVuXCIgaW4gdmFsdWUgJiZcbiAgICBcIiRlbHNlXCIgaW4gdmFsdWVcbiAgKTtcbn1cblxuZnVuY3Rpb24gaXNDb21wdXRlZEV4cHJlc3Npb24oXG4gIHZhbHVlOiB1bmtub3duLFxuKTogdmFsdWUgaXMgeyAkY29tcHV0ZWQ6IHN0cmluZzsgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH0ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgXCIkY29tcHV0ZWRcIiBpbiB2YWx1ZSAmJlxuICAgIHR5cGVvZiAodmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLiRjb21wdXRlZCA9PT0gXCJzdHJpbmdcIlxuICApO1xufVxuXG5mdW5jdGlvbiBpc1RlbXBsYXRlRXhwcmVzc2lvbih2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIHsgJHRlbXBsYXRlOiBzdHJpbmcgfSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBcIiR0ZW1wbGF0ZVwiIGluIHZhbHVlICYmXG4gICAgdHlwZW9mICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuJHRlbXBsYXRlID09PSBcInN0cmluZ1wiXG4gICk7XG59XG5cbi8vIE1vZHVsZS1sZXZlbCBzZXQgdG8gYXZvaWQgc3BhbW1pbmcgY29uc29sZS53YXJuIG9uIGV2ZXJ5IHJlbmRlciBmb3IgdGhlIHNhbWVcbi8vIHVua25vd24gJGNvbXB1dGVkIGZ1bmN0aW9uIG5hbWUuIE9uY2UgdGhlIHNldCByZWFjaGVzIFdBUk5FRF9DT01QVVRFRF9NQVgsXG4vLyBuZXcgbmFtZXMgYXJlIG5vIGxvbmdlciBkZWR1cGxpY2F0ZWQgKHdhcm5pbmdzIHN0aWxsIGZpcmUpIGJ1dCB0aGUgc2V0IHN0b3BzXG4vLyBncm93aW5nLCBwcmV2ZW50aW5nIHVuYm91bmRlZCBtZW1vcnkgdXNlIGluIGxvbmctbGl2ZWQgcHJvY2Vzc2VzIChlLmcuIFNTUikuXG5jb25zdCBXQVJORURfQ09NUFVURURfTUFYID0gMTAwO1xuY29uc3Qgd2FybmVkQ29tcHV0ZWRGbnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuLyoqIEBpbnRlcm5hbCBUZXN0LW9ubHk6IGNsZWFyIHRoZSBkZWR1cGxpY2F0aW9uIHNldCBmb3IgJGNvbXB1dGVkIHdhcm5pbmdzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIF9yZXNldFdhcm5lZENvbXB1dGVkRm5zKCk6IHZvaWQge1xuICB3YXJuZWRDb21wdXRlZEZucy5jbGVhcigpO1xufVxuXG4vLyBTYW1lIGRlZHVwbGljYXRpb24gcGF0dGVybiBmb3IgJHRlbXBsYXRlIHBhdGhzIHRoYXQgZG9uJ3Qgc3RhcnQgd2l0aCBcIi9cIi5cbmNvbnN0IFdBUk5FRF9URU1QTEFURV9NQVggPSAxMDA7XG5jb25zdCB3YXJuZWRUZW1wbGF0ZVBhdGhzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbi8qKiBAaW50ZXJuYWwgVGVzdC1vbmx5OiBjbGVhciB0aGUgZGVkdXBsaWNhdGlvbiBzZXQgZm9yICR0ZW1wbGF0ZSB3YXJuaW5ncy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBfcmVzZXRXYXJuZWRUZW1wbGF0ZVBhdGhzKCk6IHZvaWQge1xuICB3YXJuZWRUZW1wbGF0ZVBhdGhzLmNsZWFyKCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQcm9wIEV4cHJlc3Npb24gUmVzb2x1dGlvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vICRiaW5kSXRlbSBwYXRoIHJlc29sdXRpb24gaGVscGVyXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFJlc29sdmUgYSBgJGJpbmRJdGVtYCBwYXRoIGludG8gYW4gYWJzb2x1dGUgc3RhdGUgcGF0aCB1c2luZyB0aGUgcmVwZWF0XG4gKiBzY29wZSdzIGJhc2UgcGF0aC5cbiAqXG4gKiBgXCJcImAgcmVzb2x2ZXMgdG8gYHJlcGVhdEJhc2VQYXRoYCAodGhlIHdob2xlIGl0ZW0pLlxuICogYFwiZmllbGRcImAgcmVzb2x2ZXMgdG8gYHJlcGVhdEJhc2VQYXRoICsgXCIvZmllbGRcImAuXG4gKlxuICogUmV0dXJucyBgdW5kZWZpbmVkYCB3aGVuIG5vIGByZXBlYXRCYXNlUGF0aGAgaXMgYXZhaWxhYmxlIChpLmUuIGAkYmluZEl0ZW1gXG4gKiBpcyB1c2VkIG91dHNpZGUgYSByZXBlYXQgc2NvcGUpLlxuICovXG5mdW5jdGlvbiByZXNvbHZlQmluZEl0ZW1QYXRoKFxuICBpdGVtUGF0aDogc3RyaW5nLFxuICBjdHg6IFByb3BSZXNvbHV0aW9uQ29udGV4dCxcbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmIChjdHgucmVwZWF0QmFzZVBhdGggPT0gbnVsbCkge1xuICAgIGNvbnNvbGUud2FybihgJGJpbmRJdGVtIHVzZWQgb3V0c2lkZSByZXBlYXQgc2NvcGU6IFwiJHtpdGVtUGF0aH1cImApO1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKGl0ZW1QYXRoID09PSBcIlwiKSByZXR1cm4gY3R4LnJlcGVhdEJhc2VQYXRoO1xuICByZXR1cm4gY3R4LnJlcGVhdEJhc2VQYXRoICsgXCIvXCIgKyBpdGVtUGF0aDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFByb3AgRXhwcmVzc2lvbiBSZXNvbHV0aW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFJlc29sdmUgYSBzaW5nbGUgcHJvcCB2YWx1ZSB0aGF0IG1heSBjb250YWluIGV4cHJlc3Npb25zLlxuICogSGFuZGxlcyAkc3RhdGUsICRpdGVtLCAkaW5kZXgsICRiaW5kU3RhdGUsICRiaW5kSXRlbSwgYW5kICRjb25kLyR0aGVuLyRlbHNlIGluIGEgc2luZ2xlIHBhc3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUHJvcFZhbHVlKFxuICB2YWx1ZTogdW5rbm93bixcbiAgY3R4OiBQcm9wUmVzb2x1dGlvbkNvbnRleHQsXG4pOiB1bmtub3duIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICAvLyAkc3RhdGU6IHJlYWQgZnJvbSBnbG9iYWwgc3RhdGUgbW9kZWxcbiAgaWYgKGlzU3RhdGVFeHByZXNzaW9uKHZhbHVlKSkge1xuICAgIHJldHVybiBnZXRCeVBhdGgoY3R4LnN0YXRlTW9kZWwsIHZhbHVlLiRzdGF0ZSk7XG4gIH1cblxuICAvLyAkaXRlbTogcmVhZCBmcm9tIGN1cnJlbnQgcmVwZWF0IGl0ZW1cbiAgaWYgKGlzSXRlbUV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgaWYgKGN0eC5yZXBlYXRJdGVtID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgLy8gXCJcIiBtZWFucyB0aGUgd2hvbGUgaXRlbSwgXCJmaWVsZFwiIG1lYW5zIGEgZmllbGQgb24gdGhlIGl0ZW1cbiAgICByZXR1cm4gdmFsdWUuJGl0ZW0gPT09IFwiXCJcbiAgICAgID8gY3R4LnJlcGVhdEl0ZW1cbiAgICAgIDogZ2V0QnlQYXRoKGN0eC5yZXBlYXRJdGVtLCB2YWx1ZS4kaXRlbSk7XG4gIH1cblxuICAvLyAkaW5kZXg6IHJldHVybiBjdXJyZW50IHJlcGVhdCBhcnJheSBpbmRleFxuICBpZiAoaXNJbmRleEV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgcmV0dXJuIGN0eC5yZXBlYXRJbmRleDtcbiAgfVxuXG4gIC8vICRiaW5kU3RhdGU6IHR3by13YXkgYmluZGluZyB0byBnbG9iYWwgc3RhdGUgcGF0aFxuICBpZiAoaXNCaW5kU3RhdGVFeHByZXNzaW9uKHZhbHVlKSkge1xuICAgIHJldHVybiBnZXRCeVBhdGgoY3R4LnN0YXRlTW9kZWwsIHZhbHVlLiRiaW5kU3RhdGUpO1xuICB9XG5cbiAgLy8gJGJpbmRJdGVtOiB0d28td2F5IGJpbmRpbmcgdG8gcmVwZWF0IGl0ZW0gZmllbGRcbiAgaWYgKGlzQmluZEl0ZW1FeHByZXNzaW9uKHZhbHVlKSkge1xuICAgIGNvbnN0IHJlc29sdmVkUGF0aCA9IHJlc29sdmVCaW5kSXRlbVBhdGgodmFsdWUuJGJpbmRJdGVtLCBjdHgpO1xuICAgIGlmIChyZXNvbHZlZFBhdGggPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gZ2V0QnlQYXRoKGN0eC5zdGF0ZU1vZGVsLCByZXNvbHZlZFBhdGgpO1xuICB9XG5cbiAgLy8gJGNvbmQvJHRoZW4vJGVsc2U6IGV2YWx1YXRlIGNvbmRpdGlvbiBhbmQgcGljayBicmFuY2hcbiAgaWYgKGlzQ29uZEV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gZXZhbHVhdGVWaXNpYmlsaXR5KHZhbHVlLiRjb25kLCBjdHgpO1xuICAgIHJldHVybiByZXNvbHZlUHJvcFZhbHVlKHJlc3VsdCA/IHZhbHVlLiR0aGVuIDogdmFsdWUuJGVsc2UsIGN0eCk7XG4gIH1cblxuICAvLyAkY29tcHV0ZWQ6IGNhbGwgYSByZWdpc3RlcmVkIGZ1bmN0aW9uIHdpdGggcmVzb2x2ZWQgYXJnc1xuICBpZiAoaXNDb21wdXRlZEV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgY29uc3QgZm4gPSBjdHguZnVuY3Rpb25zPy5bdmFsdWUuJGNvbXB1dGVkXTtcbiAgICBpZiAoIWZuKSB7XG4gICAgICBpZiAoIXdhcm5lZENvbXB1dGVkRm5zLmhhcyh2YWx1ZS4kY29tcHV0ZWQpKSB7XG4gICAgICAgIGlmICh3YXJuZWRDb21wdXRlZEZucy5zaXplIDwgV0FSTkVEX0NPTVBVVEVEX01BWCkge1xuICAgICAgICAgIHdhcm5lZENvbXB1dGVkRm5zLmFkZCh2YWx1ZS4kY29tcHV0ZWQpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUud2FybihgVW5rbm93biAkY29tcHV0ZWQgZnVuY3Rpb246IFwiJHt2YWx1ZS4kY29tcHV0ZWR9XCJgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGNvbnN0IHJlc29sdmVkQXJnczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICBpZiAodmFsdWUuYXJncykge1xuICAgICAgZm9yIChjb25zdCBba2V5LCBhcmddIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlLmFyZ3MpKSB7XG4gICAgICAgIHJlc29sdmVkQXJnc1trZXldID0gcmVzb2x2ZVByb3BWYWx1ZShhcmcsIGN0eCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmbihyZXNvbHZlZEFyZ3MpO1xuICB9XG5cbiAgLy8gJHRlbXBsYXRlOiBpbnRlcnBvbGF0ZSAkey9wYXRofSByZWZlcmVuY2VzIHdpdGggc3RhdGUgdmFsdWVzXG4gIGlmIChpc1RlbXBsYXRlRXhwcmVzc2lvbih2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUuJHRlbXBsYXRlLnJlcGxhY2UoXG4gICAgICAvXFwkXFx7KFtefV0rKVxcfS9nLFxuICAgICAgKF9tYXRjaCwgcmF3UGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgIGxldCBwYXRoID0gcmF3UGF0aDtcbiAgICAgICAgaWYgKCFwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICAgICAgaWYgKCF3YXJuZWRUZW1wbGF0ZVBhdGhzLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgaWYgKHdhcm5lZFRlbXBsYXRlUGF0aHMuc2l6ZSA8IFdBUk5FRF9URU1QTEFURV9NQVgpIHtcbiAgICAgICAgICAgICAgd2FybmVkVGVtcGxhdGVQYXRocy5hZGQocGF0aCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICAgIGAkdGVtcGxhdGUgcGF0aCBcIiR7cGF0aH1cIiBzaG91bGQgYmUgYSBKU09OIFBvaW50ZXIgc3RhcnRpbmcgd2l0aCBcIi9cIi4gQXV0b21hdGljYWxseSByZXNvbHZpbmcgYXMgXCIvJHtwYXRofVwiLmAsXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBwYXRoID0gXCIvXCIgKyBwYXRoO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gZ2V0QnlQYXRoKGN0eC5zdGF0ZU1vZGVsLCBwYXRoKTtcbiAgICAgICAgcmV0dXJuIHJlc29sdmVkICE9IG51bGwgPyBTdHJpbmcocmVzb2x2ZWQpIDogXCJcIjtcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIC8vIEFycmF5czogcmVzb2x2ZSBlYWNoIGVsZW1lbnRcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLm1hcCgoaXRlbSkgPT4gcmVzb2x2ZVByb3BWYWx1ZShpdGVtLCBjdHgpKTtcbiAgfVxuXG4gIC8vIFBsYWluIG9iamVjdHMgKG5vdCBleHByZXNzaW9ucyk6IHJlc29sdmUgZWFjaCB2YWx1ZSByZWN1cnNpdmVseVxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgY29uc3QgcmVzb2x2ZWQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgZm9yIChjb25zdCBba2V5LCB2YWxdIG9mIE9iamVjdC5lbnRyaWVzKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IHJlc29sdmVQcm9wVmFsdWUodmFsLCBjdHgpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzb2x2ZWQ7XG4gIH1cblxuICAvLyBQcmltaXRpdmUgbGl0ZXJhbDogcGFzc3Rocm91Z2hcbiAgcmV0dXJuIHZhbHVlO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYWxsIHByb3AgdmFsdWVzIGluIGFuIGVsZW1lbnQncyBwcm9wcyBvYmplY3QuXG4gKiBSZXR1cm5zIGEgbmV3IHByb3BzIG9iamVjdCB3aXRoIGFsbCBleHByZXNzaW9ucyByZXNvbHZlZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVFbGVtZW50UHJvcHMoXG4gIHByb3BzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgY3R4OiBQcm9wUmVzb2x1dGlvbkNvbnRleHQsXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIGNvbnN0IHJlc29sdmVkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcm9wcykpIHtcbiAgICByZXNvbHZlZFtrZXldID0gcmVzb2x2ZVByb3BWYWx1ZSh2YWx1ZSwgY3R4KTtcbiAgfVxuICByZXR1cm4gcmVzb2x2ZWQ7XG59XG5cbi8qKlxuICogU2NhbiBhbiBlbGVtZW50J3MgcmF3IHByb3BzIGZvciBgJGJpbmRTdGF0ZWAgLyBgJGJpbmRJdGVtYCBleHByZXNzaW9uc1xuICogYW5kIHJldHVybiBhIG1hcCBvZiBwcm9wIG5hbWUg4oaSIHJlc29sdmVkIGFic29sdXRlIHN0YXRlIHBhdGguXG4gKlxuICogVGhpcyBpcyBjYWxsZWQgKipiZWZvcmUqKiBgcmVzb2x2ZUVsZW1lbnRQcm9wc2Agc28gdGhlIGNvbXBvbmVudCBjYW5cbiAqIHJlY2VpdmUgYm90aCB0aGUgcmVzb2x2ZWQgdmFsdWUgKGluIGBwcm9wc2ApIGFuZCB0aGUgd3JpdGUtYmFjayBwYXRoXG4gKiAoaW4gYGJpbmRpbmdzYCkuXG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBjb25zdCByYXdQcm9wcyA9IHsgdmFsdWU6IHsgJGJpbmRTdGF0ZTogXCIvZm9ybS9lbWFpbFwiIH0sIGxhYmVsOiBcIkVtYWlsXCIgfTtcbiAqIGNvbnN0IGJpbmRpbmdzID0gcmVzb2x2ZUJpbmRpbmdzKHJhd1Byb3BzLCBjdHgpO1xuICogLy8gYmluZGluZ3MgPSB7IHZhbHVlOiBcIi9mb3JtL2VtYWlsXCIgfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlQmluZGluZ3MoXG4gIHByb3BzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgY3R4OiBQcm9wUmVzb2x1dGlvbkNvbnRleHQsXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkIHtcbiAgbGV0IGJpbmRpbmdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcm9wcykpIHtcbiAgICBpZiAoaXNCaW5kU3RhdGVFeHByZXNzaW9uKHZhbHVlKSkge1xuICAgICAgaWYgKCFiaW5kaW5ncykgYmluZGluZ3MgPSB7fTtcbiAgICAgIGJpbmRpbmdzW2tleV0gPSB2YWx1ZS4kYmluZFN0YXRlO1xuICAgIH0gZWxzZSBpZiAoaXNCaW5kSXRlbUV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVCaW5kSXRlbVBhdGgodmFsdWUuJGJpbmRJdGVtLCBjdHgpO1xuICAgICAgaWYgKHJlc29sdmVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgaWYgKCFiaW5kaW5ncykgYmluZGluZ3MgPSB7fTtcbiAgICAgICAgYmluZGluZ3Nba2V5XSA9IHJlc29sdmVkO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gYmluZGluZ3M7XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhIHNpbmdsZSBhY3Rpb24gcGFyYW1ldGVyIHZhbHVlLlxuICpcbiAqIExpa2Uge0BsaW5rIHJlc29sdmVQcm9wVmFsdWV9IGJ1dCB3aXRoIHNwZWNpYWwgaGFuZGxpbmcgZm9yIHBhdGgtdmFsdWVkXG4gKiBwYXJhbXM6IGB7ICRpdGVtOiBcImZpZWxkXCIgfWAgcmVzb2x2ZXMgdG8gYW4gKiphYnNvbHV0ZSBzdGF0ZSBwYXRoKipcbiAqIChlLmcuIGAvdG9kb3MvMC9maWVsZGApIGluc3RlYWQgb2YgdGhlIGZpZWxkJ3MgdmFsdWUsIHNvIHRoZSBwYXRoIGNhblxuICogYmUgcGFzc2VkIHRvIGBzZXRTdGF0ZWAgLyBgcHVzaFN0YXRlYCAvIGByZW1vdmVTdGF0ZWAuXG4gKlxuICogLSBgeyAkaXRlbTogXCJmaWVsZFwiIH1gIOKGkiBhYnNvbHV0ZSBzdGF0ZSBwYXRoIHZpYSBgcmVwZWF0QmFzZVBhdGhgXG4gKiAtIGB7ICRpbmRleDogdHJ1ZSB9YCDihpIgY3VycmVudCByZXBlYXQgaW5kZXggKG51bWJlcilcbiAqIC0gRXZlcnl0aGluZyBlbHNlIGRlbGVnYXRlcyB0byBgcmVzb2x2ZVByb3BWYWx1ZWAgKCRzdGF0ZSwgJGNvbmQsIGxpdGVyYWxzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVBY3Rpb25QYXJhbShcbiAgdmFsdWU6IHVua25vd24sXG4gIGN0eDogUHJvcFJlc29sdXRpb25Db250ZXh0LFxuKTogdW5rbm93biB7XG4gIGlmIChpc0l0ZW1FeHByZXNzaW9uKHZhbHVlKSkge1xuICAgIHJldHVybiByZXNvbHZlQmluZEl0ZW1QYXRoKHZhbHVlLiRpdGVtLCBjdHgpO1xuICB9XG4gIGlmIChpc0luZGV4RXhwcmVzc2lvbih2YWx1ZSkpIHtcbiAgICByZXR1cm4gY3R4LnJlcGVhdEluZGV4O1xuICB9XG4gIHJldHVybiByZXNvbHZlUHJvcFZhbHVlKHZhbHVlLCBjdHgpO1xufVxuIiwgImltcG9ydCB7IHogfSBmcm9tIFwiem9kXCI7XG5pbXBvcnQgdHlwZSB7IER5bmFtaWNWYWx1ZSwgU3RhdGVNb2RlbCB9IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyBEeW5hbWljVmFsdWVTY2hlbWEsIHJlc29sdmVEeW5hbWljVmFsdWUgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG4vKipcbiAqIENvbmZpcm1hdGlvbiBkaWFsb2cgY29uZmlndXJhdGlvblxuICovXG5leHBvcnQgaW50ZXJmYWNlIEFjdGlvbkNvbmZpcm0ge1xuICB0aXRsZTogc3RyaW5nO1xuICBtZXNzYWdlOiBzdHJpbmc7XG4gIGNvbmZpcm1MYWJlbD86IHN0cmluZztcbiAgY2FuY2VsTGFiZWw/OiBzdHJpbmc7XG4gIHZhcmlhbnQ/OiBcImRlZmF1bHRcIiB8IFwiZGFuZ2VyXCI7XG59XG5cbi8qKlxuICogQWN0aW9uIHN1Y2Nlc3MgaGFuZGxlclxuICovXG5leHBvcnQgdHlwZSBBY3Rpb25PblN1Y2Nlc3MgPVxuICB8IHsgbmF2aWdhdGU6IHN0cmluZyB9XG4gIHwgeyBzZXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH1cbiAgfCB7IGFjdGlvbjogc3RyaW5nIH07XG5cbi8qKlxuICogQWN0aW9uIGVycm9yIGhhbmRsZXJcbiAqL1xuZXhwb3J0IHR5cGUgQWN0aW9uT25FcnJvciA9XG4gIHwgeyBzZXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH1cbiAgfCB7IGFjdGlvbjogc3RyaW5nIH07XG5cbi8qKlxuICogQWN0aW9uIGJpbmRpbmcg4oCUIG1hcHMgYW4gZXZlbnQgdG8gYW4gYWN0aW9uIGludm9jYXRpb24uXG4gKlxuICogVXNlZCBpbnNpZGUgdGhlIGBvbmAgZmllbGQgb2YgYSBVSUVsZW1lbnQ6XG4gKiBgYGBqc29uXG4gKiB7IFwib25cIjogeyBcInByZXNzXCI6IHsgXCJhY3Rpb25cIjogXCJzZXRTdGF0ZVwiLCBcInBhcmFtc1wiOiB7IFwic3RhdGVQYXRoXCI6IFwiL3hcIiwgXCJ2YWx1ZVwiOiAxIH0gfSB9IH1cbiAqIGBgYFxuICovXG5leHBvcnQgaW50ZXJmYWNlIEFjdGlvbkJpbmRpbmcge1xuICAvKiogQWN0aW9uIG5hbWUgKG11c3QgYmUgaW4gY2F0YWxvZykgKi9cbiAgYWN0aW9uOiBzdHJpbmc7XG4gIC8qKiBQYXJhbWV0ZXJzIHRvIHBhc3MgdG8gdGhlIGFjdGlvbiBoYW5kbGVyICovXG4gIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIER5bmFtaWNWYWx1ZT47XG4gIC8qKiBDb25maXJtYXRpb24gZGlhbG9nIGJlZm9yZSBleGVjdXRpb24gKi9cbiAgY29uZmlybT86IEFjdGlvbkNvbmZpcm07XG4gIC8qKiBIYW5kbGVyIGFmdGVyIHN1Y2Nlc3NmdWwgZXhlY3V0aW9uICovXG4gIG9uU3VjY2Vzcz86IEFjdGlvbk9uU3VjY2VzcztcbiAgLyoqIEhhbmRsZXIgYWZ0ZXIgZmFpbGVkIGV4ZWN1dGlvbiAqL1xuICBvbkVycm9yPzogQWN0aW9uT25FcnJvcjtcbiAgLyoqIFdoZXRoZXIgdG8gcHJldmVudCBkZWZhdWx0IGJyb3dzZXIgYmVoYXZpb3IgKGUuZy4gbmF2aWdhdGlvbiBvbiBsaW5rcykgKi9cbiAgcHJldmVudERlZmF1bHQ/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIEBkZXByZWNhdGVkIFVzZSBBY3Rpb25CaW5kaW5nIGluc3RlYWRcbiAqL1xuZXhwb3J0IHR5cGUgQWN0aW9uID0gQWN0aW9uQmluZGluZztcblxuLyoqXG4gKiBTY2hlbWEgZm9yIGFjdGlvbiBjb25maXJtYXRpb25cbiAqL1xuZXhwb3J0IGNvbnN0IEFjdGlvbkNvbmZpcm1TY2hlbWEgPSB6Lm9iamVjdCh7XG4gIHRpdGxlOiB6LnN0cmluZygpLFxuICBtZXNzYWdlOiB6LnN0cmluZygpLFxuICBjb25maXJtTGFiZWw6IHouc3RyaW5nKCkub3B0aW9uYWwoKSxcbiAgY2FuY2VsTGFiZWw6IHouc3RyaW5nKCkub3B0aW9uYWwoKSxcbiAgdmFyaWFudDogei5lbnVtKFtcImRlZmF1bHRcIiwgXCJkYW5nZXJcIl0pLm9wdGlvbmFsKCksXG59KTtcblxuLyoqXG4gKiBTY2hlbWEgZm9yIHN1Y2Nlc3MgaGFuZGxlcnNcbiAqL1xuZXhwb3J0IGNvbnN0IEFjdGlvbk9uU3VjY2Vzc1NjaGVtYSA9IHoudW5pb24oW1xuICB6Lm9iamVjdCh7IG5hdmlnYXRlOiB6LnN0cmluZygpIH0pLFxuICB6Lm9iamVjdCh7IHNldDogei5yZWNvcmQoei5zdHJpbmcoKSwgei51bmtub3duKCkpIH0pLFxuICB6Lm9iamVjdCh7IGFjdGlvbjogei5zdHJpbmcoKSB9KSxcbl0pO1xuXG4vKipcbiAqIFNjaGVtYSBmb3IgZXJyb3IgaGFuZGxlcnNcbiAqL1xuZXhwb3J0IGNvbnN0IEFjdGlvbk9uRXJyb3JTY2hlbWEgPSB6LnVuaW9uKFtcbiAgei5vYmplY3QoeyBzZXQ6IHoucmVjb3JkKHouc3RyaW5nKCksIHoudW5rbm93bigpKSB9KSxcbiAgei5vYmplY3QoeyBhY3Rpb246IHouc3RyaW5nKCkgfSksXG5dKTtcblxuLyoqXG4gKiBGdWxsIGFjdGlvbiBiaW5kaW5nIHNjaGVtYVxuICovXG5leHBvcnQgY29uc3QgQWN0aW9uQmluZGluZ1NjaGVtYSA9IHoub2JqZWN0KHtcbiAgYWN0aW9uOiB6LnN0cmluZygpLFxuICBwYXJhbXM6IHoucmVjb3JkKHouc3RyaW5nKCksIER5bmFtaWNWYWx1ZVNjaGVtYSkub3B0aW9uYWwoKSxcbiAgY29uZmlybTogQWN0aW9uQ29uZmlybVNjaGVtYS5vcHRpb25hbCgpLFxuICBvblN1Y2Nlc3M6IEFjdGlvbk9uU3VjY2Vzc1NjaGVtYS5vcHRpb25hbCgpLFxuICBvbkVycm9yOiBBY3Rpb25PbkVycm9yU2NoZW1hLm9wdGlvbmFsKCksXG4gIHByZXZlbnREZWZhdWx0OiB6LmJvb2xlYW4oKS5vcHRpb25hbCgpLFxufSk7XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgVXNlIEFjdGlvbkJpbmRpbmdTY2hlbWEgaW5zdGVhZFxuICovXG5leHBvcnQgY29uc3QgQWN0aW9uU2NoZW1hID0gQWN0aW9uQmluZGluZ1NjaGVtYTtcblxuLyoqXG4gKiBBY3Rpb24gaGFuZGxlciBmdW5jdGlvbiBzaWduYXR1cmVcbiAqL1xuZXhwb3J0IHR5cGUgQWN0aW9uSGFuZGxlcjxcbiAgVFBhcmFtcyA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICBUUmVzdWx0ID0gdW5rbm93bixcbj4gPSAocGFyYW1zOiBUUGFyYW1zKSA9PiBQcm9taXNlPFRSZXN1bHQ+IHwgVFJlc3VsdDtcblxuLyoqXG4gKiBBY3Rpb24gZGVmaW5pdGlvbiBpbiBjYXRhbG9nXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQWN0aW9uRGVmaW5pdGlvbjxUUGFyYW1zID0gUmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHtcbiAgLyoqIFpvZCBzY2hlbWEgZm9yIHBhcmFtcyB2YWxpZGF0aW9uICovXG4gIHBhcmFtcz86IHouWm9kVHlwZTxUUGFyYW1zPjtcbiAgLyoqIERlc2NyaXB0aW9uIGZvciBBSSAqL1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbn1cblxuLyoqXG4gKiBSZXNvbHZlZCBhY3Rpb24gd2l0aCBhbGwgZHluYW1pYyB2YWx1ZXMgcmVzb2x2ZWRcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlZEFjdGlvbiB7XG4gIGFjdGlvbjogc3RyaW5nO1xuICBwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjb25maXJtPzogQWN0aW9uQ29uZmlybTtcbiAgb25TdWNjZXNzPzogQWN0aW9uT25TdWNjZXNzO1xuICBvbkVycm9yPzogQWN0aW9uT25FcnJvcjtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIGFsbCBkeW5hbWljIHZhbHVlcyBpbiBhbiBhY3Rpb24gYmluZGluZ1xuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUFjdGlvbihcbiAgYmluZGluZzogQWN0aW9uQmluZGluZyxcbiAgc3RhdGVNb2RlbDogU3RhdGVNb2RlbCxcbik6IFJlc29sdmVkQWN0aW9uIHtcbiAgY29uc3QgcmVzb2x2ZWRQYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG5cbiAgaWYgKGJpbmRpbmcucGFyYW1zKSB7XG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYmluZGluZy5wYXJhbXMpKSB7XG4gICAgICByZXNvbHZlZFBhcmFtc1trZXldID0gcmVzb2x2ZUR5bmFtaWNWYWx1ZSh2YWx1ZSwgc3RhdGVNb2RlbCk7XG4gICAgfVxuICB9XG5cbiAgLy8gSW50ZXJwb2xhdGUgY29uZmlybWF0aW9uIG1lc3NhZ2UgaWYgcHJlc2VudFxuICBsZXQgY29uZmlybSA9IGJpbmRpbmcuY29uZmlybTtcbiAgaWYgKGNvbmZpcm0pIHtcbiAgICBjb25maXJtID0ge1xuICAgICAgLi4uY29uZmlybSxcbiAgICAgIG1lc3NhZ2U6IGludGVycG9sYXRlU3RyaW5nKGNvbmZpcm0ubWVzc2FnZSwgc3RhdGVNb2RlbCksXG4gICAgICB0aXRsZTogaW50ZXJwb2xhdGVTdHJpbmcoY29uZmlybS50aXRsZSwgc3RhdGVNb2RlbCksXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgYWN0aW9uOiBiaW5kaW5nLmFjdGlvbixcbiAgICBwYXJhbXM6IHJlc29sdmVkUGFyYW1zLFxuICAgIGNvbmZpcm0sXG4gICAgb25TdWNjZXNzOiBiaW5kaW5nLm9uU3VjY2VzcyxcbiAgICBvbkVycm9yOiBiaW5kaW5nLm9uRXJyb3IsXG4gIH07XG59XG5cbi8qKlxuICogSW50ZXJwb2xhdGUgJHtwYXRofSBleHByZXNzaW9ucyBpbiBhIHN0cmluZ1xuICovXG5leHBvcnQgZnVuY3Rpb24gaW50ZXJwb2xhdGVTdHJpbmcoXG4gIHRlbXBsYXRlOiBzdHJpbmcsXG4gIHN0YXRlTW9kZWw6IFN0YXRlTW9kZWwsXG4pOiBzdHJpbmcge1xuICByZXR1cm4gdGVtcGxhdGUucmVwbGFjZSgvXFwkXFx7KFtefV0rKVxcfS9nLCAoXywgcGF0aCkgPT4ge1xuICAgIGNvbnN0IHZhbHVlID0gcmVzb2x2ZUR5bmFtaWNWYWx1ZSh7ICRzdGF0ZTogcGF0aCB9LCBzdGF0ZU1vZGVsKTtcbiAgICByZXR1cm4gU3RyaW5nKHZhbHVlID8/IFwiXCIpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBDb250ZXh0IGZvciBhY3Rpb24gZXhlY3V0aW9uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQWN0aW9uRXhlY3V0aW9uQ29udGV4dCB7XG4gIC8qKiBUaGUgcmVzb2x2ZWQgYWN0aW9uICovXG4gIGFjdGlvbjogUmVzb2x2ZWRBY3Rpb247XG4gIC8qKiBUaGUgYWN0aW9uIGhhbmRsZXIgZnJvbSB0aGUgaG9zdCAqL1xuICBoYW5kbGVyOiBBY3Rpb25IYW5kbGVyO1xuICAvKiogRnVuY3Rpb24gdG8gdXBkYXRlIHN0YXRlIG1vZGVsICovXG4gIHNldFN0YXRlOiAocGF0aDogc3RyaW5nLCB2YWx1ZTogdW5rbm93bikgPT4gdm9pZDtcbiAgLyoqIEZ1bmN0aW9uIHRvIG5hdmlnYXRlICovXG4gIG5hdmlnYXRlPzogKHBhdGg6IHN0cmluZykgPT4gdm9pZDtcbiAgLyoqIEZ1bmN0aW9uIHRvIGV4ZWN1dGUgYW5vdGhlciBhY3Rpb24gKi9cbiAgZXhlY3V0ZUFjdGlvbj86IChuYW1lOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD47XG59XG5cbi8qKlxuICogRXhlY3V0ZSBhbiBhY3Rpb24gd2l0aCBhbGwgY2FsbGJhY2tzXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlQWN0aW9uKFxuICBjdHg6IEFjdGlvbkV4ZWN1dGlvbkNvbnRleHQsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgeyBhY3Rpb24sIGhhbmRsZXIsIHNldFN0YXRlLCBuYXZpZ2F0ZSwgZXhlY3V0ZUFjdGlvbiB9ID0gY3R4O1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgaGFuZGxlcihhY3Rpb24ucGFyYW1zKTtcblxuICAgIC8vIEhhbmRsZSBzdWNjZXNzXG4gICAgaWYgKGFjdGlvbi5vblN1Y2Nlc3MpIHtcbiAgICAgIGlmIChcIm5hdmlnYXRlXCIgaW4gYWN0aW9uLm9uU3VjY2VzcyAmJiBuYXZpZ2F0ZSkge1xuICAgICAgICBuYXZpZ2F0ZShhY3Rpb24ub25TdWNjZXNzLm5hdmlnYXRlKTtcbiAgICAgIH0gZWxzZSBpZiAoXCJzZXRcIiBpbiBhY3Rpb24ub25TdWNjZXNzKSB7XG4gICAgICAgIGZvciAoY29uc3QgW3BhdGgsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhY3Rpb24ub25TdWNjZXNzLnNldCkpIHtcbiAgICAgICAgICBzZXRTdGF0ZShwYXRoLCB2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoXCJhY3Rpb25cIiBpbiBhY3Rpb24ub25TdWNjZXNzICYmIGV4ZWN1dGVBY3Rpb24pIHtcbiAgICAgICAgYXdhaXQgZXhlY3V0ZUFjdGlvbihhY3Rpb24ub25TdWNjZXNzLmFjdGlvbik7XG4gICAgICB9XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIC8vIEhhbmRsZSBlcnJvclxuICAgIGlmIChhY3Rpb24ub25FcnJvcikge1xuICAgICAgaWYgKFwic2V0XCIgaW4gYWN0aW9uLm9uRXJyb3IpIHtcbiAgICAgICAgZm9yIChjb25zdCBbcGF0aCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFjdGlvbi5vbkVycm9yLnNldCkpIHtcbiAgICAgICAgICAvLyBSZXBsYWNlICRlcnJvci5tZXNzYWdlIHdpdGggYWN0dWFsIGVycm9yXG4gICAgICAgICAgY29uc3QgcmVzb2x2ZWRWYWx1ZSA9XG4gICAgICAgICAgICB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUgPT09IFwiJGVycm9yLm1lc3NhZ2VcIlxuICAgICAgICAgICAgICA/IChlcnJvciBhcyBFcnJvcikubWVzc2FnZVxuICAgICAgICAgICAgICA6IHZhbHVlO1xuICAgICAgICAgIHNldFN0YXRlKHBhdGgsIHJlc29sdmVkVmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKFwiYWN0aW9uXCIgaW4gYWN0aW9uLm9uRXJyb3IgJiYgZXhlY3V0ZUFjdGlvbikge1xuICAgICAgICBhd2FpdCBleGVjdXRlQWN0aW9uKGFjdGlvbi5vbkVycm9yLmFjdGlvbik7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEhlbHBlciB0byBjcmVhdGUgYWN0aW9uIGJpbmRpbmdzXG4gKi9cbmV4cG9ydCBjb25zdCBhY3Rpb25CaW5kaW5nID0ge1xuICAvKiogQ3JlYXRlIGEgc2ltcGxlIGFjdGlvbiBiaW5kaW5nICovXG4gIHNpbXBsZTogKFxuICAgIGFjdGlvbk5hbWU6IHN0cmluZyxcbiAgICBwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBEeW5hbWljVmFsdWU+LFxuICApOiBBY3Rpb25CaW5kaW5nID0+ICh7XG4gICAgYWN0aW9uOiBhY3Rpb25OYW1lLFxuICAgIHBhcmFtcyxcbiAgfSksXG5cbiAgLyoqIENyZWF0ZSBhbiBhY3Rpb24gYmluZGluZyB3aXRoIGNvbmZpcm1hdGlvbiAqL1xuICB3aXRoQ29uZmlybTogKFxuICAgIGFjdGlvbk5hbWU6IHN0cmluZyxcbiAgICBjb25maXJtOiBBY3Rpb25Db25maXJtLFxuICAgIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIER5bmFtaWNWYWx1ZT4sXG4gICk6IEFjdGlvbkJpbmRpbmcgPT4gKHtcbiAgICBhY3Rpb246IGFjdGlvbk5hbWUsXG4gICAgcGFyYW1zLFxuICAgIGNvbmZpcm0sXG4gIH0pLFxuXG4gIC8qKiBDcmVhdGUgYW4gYWN0aW9uIGJpbmRpbmcgd2l0aCBzdWNjZXNzIGhhbmRsZXIgKi9cbiAgd2l0aFN1Y2Nlc3M6IChcbiAgICBhY3Rpb25OYW1lOiBzdHJpbmcsXG4gICAgb25TdWNjZXNzOiBBY3Rpb25PblN1Y2Nlc3MsXG4gICAgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgRHluYW1pY1ZhbHVlPixcbiAgKTogQWN0aW9uQmluZGluZyA9PiAoe1xuICAgIGFjdGlvbjogYWN0aW9uTmFtZSxcbiAgICBwYXJhbXMsXG4gICAgb25TdWNjZXNzLFxuICB9KSxcbn07XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgVXNlIGFjdGlvbkJpbmRpbmcgaW5zdGVhZFxuICovXG5leHBvcnQgY29uc3QgYWN0aW9uID0gYWN0aW9uQmluZGluZztcbiIsICJpbXBvcnQgeyB6IH0gZnJvbSBcInpvZFwiO1xuaW1wb3J0IHR5cGUgeyBEeW5hbWljVmFsdWUsIFN0YXRlTW9kZWwsIFZpc2liaWxpdHlDb25kaXRpb24gfSBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IHsgRHluYW1pY1ZhbHVlU2NoZW1hLCByZXNvbHZlRHluYW1pY1ZhbHVlIH0gZnJvbSBcIi4vdHlwZXNcIjtcbmltcG9ydCB7IFZpc2liaWxpdHlDb25kaXRpb25TY2hlbWEsIGV2YWx1YXRlVmlzaWJpbGl0eSB9IGZyb20gXCIuL3Zpc2liaWxpdHlcIjtcbmltcG9ydCB7IHJlc29sdmVQcm9wVmFsdWUgfSBmcm9tIFwiLi9wcm9wc1wiO1xuXG4vKipcbiAqIFZhbGlkYXRpb24gY2hlY2sgZGVmaW5pdGlvblxuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhbGlkYXRpb25DaGVjayB7XG4gIC8qKiBWYWxpZGF0aW9uIHR5cGUgKGJ1aWx0LWluIG9yIGZyb20gY2F0YWxvZykgKi9cbiAgdHlwZTogc3RyaW5nO1xuICAvKiogQWRkaXRpb25hbCBhcmd1bWVudHMgZm9yIHRoZSB2YWxpZGF0aW9uICovXG4gIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBEeW5hbWljVmFsdWU+O1xuICAvKiogRXJyb3IgbWVzc2FnZSB0byBkaXNwbGF5IGlmIGNoZWNrIGZhaWxzICovXG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLyoqXG4gKiBWYWxpZGF0aW9uIGNvbmZpZ3VyYXRpb24gZm9yIGEgZmllbGRcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBWYWxpZGF0aW9uQ29uZmlnIHtcbiAgLyoqIEFycmF5IG9mIGNoZWNrcyB0byBydW4gKi9cbiAgY2hlY2tzPzogVmFsaWRhdGlvbkNoZWNrW107XG4gIC8qKiBXaGVuIHRvIHJ1biB2YWxpZGF0aW9uICovXG4gIHZhbGlkYXRlT24/OiBcImNoYW5nZVwiIHwgXCJibHVyXCIgfCBcInN1Ym1pdFwiO1xuICAvKiogQ29uZGl0aW9uIGZvciB3aGVuIHZhbGlkYXRpb24gaXMgZW5hYmxlZCAqL1xuICBlbmFibGVkPzogVmlzaWJpbGl0eUNvbmRpdGlvbjtcbn1cblxuLyoqXG4gKiBTY2hlbWEgZm9yIHZhbGlkYXRpb24gY2hlY2tcbiAqL1xuZXhwb3J0IGNvbnN0IFZhbGlkYXRpb25DaGVja1NjaGVtYSA9IHoub2JqZWN0KHtcbiAgdHlwZTogei5zdHJpbmcoKSxcbiAgYXJnczogei5yZWNvcmQoei5zdHJpbmcoKSwgRHluYW1pY1ZhbHVlU2NoZW1hKS5vcHRpb25hbCgpLFxuICBtZXNzYWdlOiB6LnN0cmluZygpLFxufSk7XG5cbi8qKlxuICogU2NoZW1hIGZvciB2YWxpZGF0aW9uIGNvbmZpZ1xuICovXG5leHBvcnQgY29uc3QgVmFsaWRhdGlvbkNvbmZpZ1NjaGVtYSA9IHoub2JqZWN0KHtcbiAgY2hlY2tzOiB6LmFycmF5KFZhbGlkYXRpb25DaGVja1NjaGVtYSkub3B0aW9uYWwoKSxcbiAgdmFsaWRhdGVPbjogei5lbnVtKFtcImNoYW5nZVwiLCBcImJsdXJcIiwgXCJzdWJtaXRcIl0pLm9wdGlvbmFsKCksXG4gIGVuYWJsZWQ6IFZpc2liaWxpdHlDb25kaXRpb25TY2hlbWEub3B0aW9uYWwoKSxcbn0pO1xuXG4vKipcbiAqIFZhbGlkYXRpb24gZnVuY3Rpb24gc2lnbmF0dXJlXG4gKi9cbmV4cG9ydCB0eXBlIFZhbGlkYXRpb25GdW5jdGlvbiA9IChcbiAgdmFsdWU6IHVua25vd24sXG4gIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbikgPT4gYm9vbGVhbjtcblxuLyoqXG4gKiBWYWxpZGF0aW9uIGZ1bmN0aW9uIGRlZmluaXRpb24gaW4gY2F0YWxvZ1xuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhbGlkYXRpb25GdW5jdGlvbkRlZmluaXRpb24ge1xuICAvKiogVGhlIHZhbGlkYXRpb24gZnVuY3Rpb24gKi9cbiAgdmFsaWRhdGU6IFZhbGlkYXRpb25GdW5jdGlvbjtcbiAgLyoqIERlc2NyaXB0aW9uIGZvciBBSSAqL1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbn1cblxuY29uc3QgbWF0Y2hlc0ltcGw6IFZhbGlkYXRpb25GdW5jdGlvbiA9IChcbiAgdmFsdWU6IHVua25vd24sXG4gIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbikgPT4ge1xuICBjb25zdCBvdGhlciA9IGFyZ3M/Lm90aGVyO1xuICByZXR1cm4gdmFsdWUgPT09IG90aGVyO1xufTtcblxuLyoqXG4gKiBCdWlsdC1pbiB2YWxpZGF0aW9uIGZ1bmN0aW9uc1xuICovXG5leHBvcnQgY29uc3QgYnVpbHRJblZhbGlkYXRpb25GdW5jdGlvbnM6IFJlY29yZDxzdHJpbmcsIFZhbGlkYXRpb25GdW5jdGlvbj4gPSB7XG4gIC8qKlxuICAgKiBDaGVjayBpZiB2YWx1ZSBpcyBub3QgbnVsbCwgdW5kZWZpbmVkLCBvciBlbXB0eSBzdHJpbmdcbiAgICovXG4gIHJlcXVpcmVkOiAodmFsdWU6IHVua25vd24pID0+IHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHJldHVybiB2YWx1ZS50cmltKCkubGVuZ3RoID4gMDtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZS5sZW5ndGggPiAwO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiB2YWx1ZSBpcyBhIHZhbGlkIGVtYWlsIGFkZHJlc3NcbiAgICovXG4gIGVtYWlsOiAodmFsdWU6IHVua25vd24pID0+IHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIC9eW15cXHNAXStAW15cXHNAXStcXC5bXlxcc0BdKyQvLnRlc3QodmFsdWUpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBDaGVjayBtaW5pbXVtIHN0cmluZyBsZW5ndGhcbiAgICovXG4gIG1pbkxlbmd0aDogKHZhbHVlOiB1bmtub3duLCBhcmdzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgbWluID0gYXJncz8ubWluO1xuICAgIGlmICh0eXBlb2YgbWluICE9PSBcIm51bWJlclwiKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHZhbHVlLmxlbmd0aCA+PSBtaW47XG4gIH0sXG5cbiAgLyoqXG4gICAqIENoZWNrIG1heGltdW0gc3RyaW5nIGxlbmd0aFxuICAgKi9cbiAgbWF4TGVuZ3RoOiAodmFsdWU6IHVua25vd24sIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4ge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBtYXggPSBhcmdzPy5tYXg7XG4gICAgaWYgKHR5cGVvZiBtYXggIT09IFwibnVtYmVyXCIpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdmFsdWUubGVuZ3RoIDw9IG1heDtcbiAgfSxcblxuICAvKipcbiAgICogQ2hlY2sgaWYgc3RyaW5nIG1hdGNoZXMgYSByZWdleCBwYXR0ZXJuXG4gICAqL1xuICBwYXR0ZXJuOiAodmFsdWU6IHVua25vd24sIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4ge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBwYXR0ZXJuID0gYXJncz8ucGF0dGVybjtcbiAgICBpZiAodHlwZW9mIHBhdHRlcm4gIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZTtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIG5ldyBSZWdFeHAocGF0dGVybikudGVzdCh2YWx1ZSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBDaGVjayBtaW5pbXVtIG51bWVyaWMgdmFsdWVcbiAgICovXG4gIG1pbjogKHZhbHVlOiB1bmtub3duLCBhcmdzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgbWluID0gYXJncz8ubWluO1xuICAgIGlmICh0eXBlb2YgbWluICE9PSBcIm51bWJlclwiKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHZhbHVlID49IG1pbjtcbiAgfSxcblxuICAvKipcbiAgICogQ2hlY2sgbWF4aW11bSBudW1lcmljIHZhbHVlXG4gICAqL1xuICBtYXg6ICh2YWx1ZTogdW5rbm93biwgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIikgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IG1heCA9IGFyZ3M/Lm1heDtcbiAgICBpZiAodHlwZW9mIG1heCAhPT0gXCJudW1iZXJcIikgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB2YWx1ZSA8PSBtYXg7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIHZhbHVlIGlzIGEgbnVtYmVyXG4gICAqL1xuICBudW1lcmljOiAodmFsdWU6IHVua25vd24pID0+IHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gIWlzTmFOKHZhbHVlKTtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSByZXR1cm4gIWlzTmFOKHBhcnNlRmxvYXQodmFsdWUpKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIHZhbHVlIGlzIGEgdmFsaWQgVVJMXG4gICAqL1xuICB1cmw6ICh2YWx1ZTogdW5rbm93bikgPT4ge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZTtcbiAgICB0cnkge1xuICAgICAgbmV3IFVSTCh2YWx1ZSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH0sXG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIHZhbHVlIG1hdGNoZXMgYW5vdGhlciBmaWVsZFxuICAgKi9cbiAgbWF0Y2hlczogbWF0Y2hlc0ltcGwsXG5cbiAgLyoqXG4gICAqIEFsaWFzIGZvciBtYXRjaGVzIHdpdGggYSBtb3JlIGRlc2NyaXB0aXZlIG5hbWUgZm9yIGNyb3NzLWZpZWxkIGVxdWFsaXR5XG4gICAqL1xuICBlcXVhbFRvOiBtYXRjaGVzSW1wbCxcblxuICAvKipcbiAgICogQ2hlY2sgaWYgdmFsdWUgaXMgbGVzcyB0aGFuIGFub3RoZXIgZmllbGQncyB2YWx1ZS5cbiAgICogU3VwcG9ydHMgbnVtYmVycywgc3RyaW5ncyAodXNlZnVsIGZvciBJU08gZGF0ZSBjb21wYXJpc29uKSwgYW5kXG4gICAqIGNyb3NzLXR5cGUgbnVtZXJpYyBjb2VyY2lvbiAoZS5nLiBzdHJpbmcgXCIzXCIgdnMgbnVtYmVyIDUpLlxuICAgKi9cbiAgbGVzc1RoYW46ICh2YWx1ZTogdW5rbm93biwgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB7XG4gICAgY29uc3Qgb3RoZXIgPSBhcmdzPy5vdGhlcjtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCB8fCBvdGhlciA9PSBudWxsIHx8IHZhbHVlID09PSBcIlwiIHx8IG90aGVyID09PSBcIlwiKVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIG90aGVyID09PSBcIm51bWJlclwiKVxuICAgICAgcmV0dXJuIHZhbHVlIDwgb3RoZXI7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB0eXBlb2Ygb3RoZXIgPT09IFwic3RyaW5nXCIpXG4gICAgICByZXR1cm4gdmFsdWUgPCBvdGhlcjtcbiAgICBjb25zdCBudW1WYWwgPSBOdW1iZXIodmFsdWUpO1xuICAgIGNvbnN0IG51bU90aGVyID0gTnVtYmVyKG90aGVyKTtcbiAgICBpZiAoIWlzTmFOKG51bVZhbCkgJiYgIWlzTmFOKG51bU90aGVyKSkgcmV0dXJuIG51bVZhbCA8IG51bU90aGVyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfSxcblxuICAvKipcbiAgICogQ2hlY2sgaWYgdmFsdWUgaXMgZ3JlYXRlciB0aGFuIGFub3RoZXIgZmllbGQncyB2YWx1ZS5cbiAgICogU3VwcG9ydHMgbnVtYmVycywgc3RyaW5ncyAodXNlZnVsIGZvciBJU08gZGF0ZSBjb21wYXJpc29uKSwgYW5kXG4gICAqIGNyb3NzLXR5cGUgbnVtZXJpYyBjb2VyY2lvbiAoZS5nLiBzdHJpbmcgXCI3XCIgdnMgbnVtYmVyIDUpLlxuICAgKi9cbiAgZ3JlYXRlclRoYW46ICh2YWx1ZTogdW5rbm93biwgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB7XG4gICAgY29uc3Qgb3RoZXIgPSBhcmdzPy5vdGhlcjtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCB8fCBvdGhlciA9PSBudWxsIHx8IHZhbHVlID09PSBcIlwiIHx8IG90aGVyID09PSBcIlwiKVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIG90aGVyID09PSBcIm51bWJlclwiKVxuICAgICAgcmV0dXJuIHZhbHVlID4gb3RoZXI7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB0eXBlb2Ygb3RoZXIgPT09IFwic3RyaW5nXCIpXG4gICAgICByZXR1cm4gdmFsdWUgPiBvdGhlcjtcbiAgICBjb25zdCBudW1WYWwgPSBOdW1iZXIodmFsdWUpO1xuICAgIGNvbnN0IG51bU90aGVyID0gTnVtYmVyKG90aGVyKTtcbiAgICBpZiAoIWlzTmFOKG51bVZhbCkgJiYgIWlzTmFOKG51bU90aGVyKSkgcmV0dXJuIG51bVZhbCA+IG51bU90aGVyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfSxcblxuICAvKipcbiAgICogUmVxdWlyZWQgb25seSB3aGVuIGEgY29uZGl0aW9uIGlzIG1ldC5cbiAgICogVXNlcyBKUyB0cnV0aGluZXNzOiAwLCBmYWxzZSwgXCJcIiwgbnVsbCwgYW5kIHVuZGVmaW5lZCBhcmUgYWxsXG4gICAqIHRyZWF0ZWQgYXMgXCJjb25kaXRpb24gbm90IG1ldFwiIChmaWVsZCBub3QgcmVxdWlyZWQpLCBtYXRjaGluZ1xuICAgKiB0aGUgdmlzaWJpbGl0eSBzeXN0ZW0ncyBiYXJlLWNvbmRpdGlvbiBzZW1hbnRpY3MuXG4gICAqL1xuICByZXF1aXJlZElmOiAodmFsdWU6IHVua25vd24sIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4ge1xuICAgIGNvbnN0IGNvbmRpdGlvbiA9IGFyZ3M/LmZpZWxkO1xuICAgIGlmICghY29uZGl0aW9uKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHJldHVybiB2YWx1ZS50cmltKCkubGVuZ3RoID4gMDtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZS5sZW5ndGggPiAwO1xuICAgIHJldHVybiB0cnVlO1xuICB9LFxufTtcblxuLyoqXG4gKiBWYWxpZGF0aW9uIHJlc3VsdCBmb3IgYSBzaW5nbGUgY2hlY2tcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBWYWxpZGF0aW9uQ2hlY2tSZXN1bHQge1xuICB0eXBlOiBzdHJpbmc7XG4gIHZhbGlkOiBib29sZWFuO1xuICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbi8qKlxuICogRnVsbCB2YWxpZGF0aW9uIHJlc3VsdCBmb3IgYSBmaWVsZFxuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhbGlkYXRpb25SZXN1bHQge1xuICB2YWxpZDogYm9vbGVhbjtcbiAgZXJyb3JzOiBzdHJpbmdbXTtcbiAgY2hlY2tzOiBWYWxpZGF0aW9uQ2hlY2tSZXN1bHRbXTtcbn1cblxuLyoqXG4gKiBDb250ZXh0IGZvciBydW5uaW5nIHZhbGlkYXRpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBWYWxpZGF0aW9uQ29udGV4dCB7XG4gIC8qKiBDdXJyZW50IHZhbHVlIHRvIHZhbGlkYXRlICovXG4gIHZhbHVlOiB1bmtub3duO1xuICAvKiogRnVsbCBkYXRhIG1vZGVsIGZvciByZXNvbHZpbmcgcGF0aHMgKi9cbiAgc3RhdGVNb2RlbDogU3RhdGVNb2RlbDtcbiAgLyoqIEN1c3RvbSB2YWxpZGF0aW9uIGZ1bmN0aW9ucyBmcm9tIGNhdGFsb2cgKi9cbiAgY3VzdG9tRnVuY3Rpb25zPzogUmVjb3JkPHN0cmluZywgVmFsaWRhdGlvbkZ1bmN0aW9uPjtcbn1cblxuLyoqXG4gKiBSdW4gYSBzaW5nbGUgdmFsaWRhdGlvbiBjaGVja1xuICovXG5leHBvcnQgZnVuY3Rpb24gcnVuVmFsaWRhdGlvbkNoZWNrKFxuICBjaGVjazogVmFsaWRhdGlvbkNoZWNrLFxuICBjdHg6IFZhbGlkYXRpb25Db250ZXh0LFxuKTogVmFsaWRhdGlvbkNoZWNrUmVzdWx0IHtcbiAgY29uc3QgeyB2YWx1ZSwgc3RhdGVNb2RlbCwgY3VzdG9tRnVuY3Rpb25zIH0gPSBjdHg7XG5cbiAgLy8gUmVzb2x2ZSBhcmdzIHVzaW5nIHJlc29sdmVQcm9wVmFsdWUgc28gbmVzdGVkICRzdGF0ZSByZWZzIChhbmQgYW55IG90aGVyXG4gIC8vIHByb3AgZXhwcmVzc2lvbnMpIGFyZSBoYW5kbGVkIGNvbnNpc3RlbnRseSB3aXRoIHRoZSByZXN0IG9mIHRoZSBzeXN0ZW0uXG4gIGNvbnN0IHJlc29sdmVkQXJnczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgaWYgKGNoZWNrLmFyZ3MpIHtcbiAgICBmb3IgKGNvbnN0IFtrZXksIGFyZ1ZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhjaGVjay5hcmdzKSkge1xuICAgICAgcmVzb2x2ZWRBcmdzW2tleV0gPSByZXNvbHZlUHJvcFZhbHVlKGFyZ1ZhbHVlLCB7IHN0YXRlTW9kZWwgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gRmluZCB0aGUgdmFsaWRhdGlvbiBmdW5jdGlvblxuICBjb25zdCB2YWxpZGF0aW9uRm4gPVxuICAgIGJ1aWx0SW5WYWxpZGF0aW9uRnVuY3Rpb25zW2NoZWNrLnR5cGVdID8/IGN1c3RvbUZ1bmN0aW9ucz8uW2NoZWNrLnR5cGVdO1xuXG4gIGlmICghdmFsaWRhdGlvbkZuKSB7XG4gICAgY29uc29sZS53YXJuKGBVbmtub3duIHZhbGlkYXRpb24gZnVuY3Rpb246ICR7Y2hlY2sudHlwZX1gKTtcbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogY2hlY2sudHlwZSxcbiAgICAgIHZhbGlkOiB0cnVlLCAvLyBEb24ndCBmYWlsIG9uIHVua25vd24gZnVuY3Rpb25zXG4gICAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICAgIH07XG4gIH1cblxuICBjb25zdCB2YWxpZCA9IHZhbGlkYXRpb25Gbih2YWx1ZSwgcmVzb2x2ZWRBcmdzKTtcblxuICByZXR1cm4ge1xuICAgIHR5cGU6IGNoZWNrLnR5cGUsXG4gICAgdmFsaWQsXG4gICAgbWVzc2FnZTogY2hlY2subWVzc2FnZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW4gYWxsIHZhbGlkYXRpb24gY2hlY2tzIGZvciBhIGZpZWxkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBydW5WYWxpZGF0aW9uKFxuICBjb25maWc6IFZhbGlkYXRpb25Db25maWcsXG4gIGN0eDogVmFsaWRhdGlvbkNvbnRleHQsXG4pOiBWYWxpZGF0aW9uUmVzdWx0IHtcbiAgY29uc3QgY2hlY2tzOiBWYWxpZGF0aW9uQ2hlY2tSZXN1bHRbXSA9IFtdO1xuICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgLy8gQ2hlY2sgaWYgdmFsaWRhdGlvbiBpcyBlbmFibGVkXG4gIGlmIChjb25maWcuZW5hYmxlZCkge1xuICAgIGNvbnN0IGVuYWJsZWQgPSBldmFsdWF0ZVZpc2liaWxpdHkoY29uZmlnLmVuYWJsZWQsIHtcbiAgICAgIHN0YXRlTW9kZWw6IGN0eC5zdGF0ZU1vZGVsLFxuICAgIH0pO1xuICAgIGlmICghZW5hYmxlZCkge1xuICAgICAgcmV0dXJuIHsgdmFsaWQ6IHRydWUsIGVycm9yczogW10sIGNoZWNrczogW10gfTtcbiAgICB9XG4gIH1cblxuICAvLyBSdW4gZWFjaCBjaGVja1xuICBpZiAoY29uZmlnLmNoZWNrcykge1xuICAgIGZvciAoY29uc3QgY2hlY2sgb2YgY29uZmlnLmNoZWNrcykge1xuICAgICAgY29uc3QgcmVzdWx0ID0gcnVuVmFsaWRhdGlvbkNoZWNrKGNoZWNrLCBjdHgpO1xuICAgICAgY2hlY2tzLnB1c2gocmVzdWx0KTtcbiAgICAgIGlmICghcmVzdWx0LnZhbGlkKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKHJlc3VsdC5tZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZhbGlkOiBlcnJvcnMubGVuZ3RoID09PSAwLFxuICAgIGVycm9ycyxcbiAgICBjaGVja3MsXG4gIH07XG59XG5cbi8qKlxuICogSGVscGVyIHRvIGNyZWF0ZSB2YWxpZGF0aW9uIGNoZWNrc1xuICovXG5leHBvcnQgY29uc3QgY2hlY2sgPSB7XG4gIHJlcXVpcmVkOiAobWVzc2FnZSA9IFwiVGhpcyBmaWVsZCBpcyByZXF1aXJlZFwiKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJyZXF1aXJlZFwiLFxuICAgIG1lc3NhZ2UsXG4gIH0pLFxuXG4gIGVtYWlsOiAobWVzc2FnZSA9IFwiSW52YWxpZCBlbWFpbCBhZGRyZXNzXCIpOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcImVtYWlsXCIsXG4gICAgbWVzc2FnZSxcbiAgfSksXG5cbiAgbWluTGVuZ3RoOiAobWluOiBudW1iZXIsIG1lc3NhZ2U/OiBzdHJpbmcpOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcIm1pbkxlbmd0aFwiLFxuICAgIGFyZ3M6IHsgbWluIH0sXG4gICAgbWVzc2FnZTogbWVzc2FnZSA/PyBgTXVzdCBiZSBhdCBsZWFzdCAke21pbn0gY2hhcmFjdGVyc2AsXG4gIH0pLFxuXG4gIG1heExlbmd0aDogKG1heDogbnVtYmVyLCBtZXNzYWdlPzogc3RyaW5nKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJtYXhMZW5ndGhcIixcbiAgICBhcmdzOiB7IG1heCB9LFxuICAgIG1lc3NhZ2U6IG1lc3NhZ2UgPz8gYE11c3QgYmUgYXQgbW9zdCAke21heH0gY2hhcmFjdGVyc2AsXG4gIH0pLFxuXG4gIHBhdHRlcm46IChwYXR0ZXJuOiBzdHJpbmcsIG1lc3NhZ2UgPSBcIkludmFsaWQgZm9ybWF0XCIpOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcInBhdHRlcm5cIixcbiAgICBhcmdzOiB7IHBhdHRlcm4gfSxcbiAgICBtZXNzYWdlLFxuICB9KSxcblxuICBtaW46IChtaW46IG51bWJlciwgbWVzc2FnZT86IHN0cmluZyk6IFZhbGlkYXRpb25DaGVjayA9PiAoe1xuICAgIHR5cGU6IFwibWluXCIsXG4gICAgYXJnczogeyBtaW4gfSxcbiAgICBtZXNzYWdlOiBtZXNzYWdlID8/IGBNdXN0IGJlIGF0IGxlYXN0ICR7bWlufWAsXG4gIH0pLFxuXG4gIG1heDogKG1heDogbnVtYmVyLCBtZXNzYWdlPzogc3RyaW5nKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJtYXhcIixcbiAgICBhcmdzOiB7IG1heCB9LFxuICAgIG1lc3NhZ2U6IG1lc3NhZ2UgPz8gYE11c3QgYmUgYXQgbW9zdCAke21heH1gLFxuICB9KSxcblxuICB1cmw6IChtZXNzYWdlID0gXCJJbnZhbGlkIFVSTFwiKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJ1cmxcIixcbiAgICBtZXNzYWdlLFxuICB9KSxcblxuICBudW1lcmljOiAobWVzc2FnZSA9IFwiTXVzdCBiZSBhIG51bWJlclwiKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJudW1lcmljXCIsXG4gICAgbWVzc2FnZSxcbiAgfSksXG5cbiAgbWF0Y2hlczogKFxuICAgIG90aGVyUGF0aDogc3RyaW5nLFxuICAgIG1lc3NhZ2UgPSBcIkZpZWxkcyBtdXN0IG1hdGNoXCIsXG4gICk6IFZhbGlkYXRpb25DaGVjayA9PiAoe1xuICAgIHR5cGU6IFwibWF0Y2hlc1wiLFxuICAgIGFyZ3M6IHsgb3RoZXI6IHsgJHN0YXRlOiBvdGhlclBhdGggfSB9LFxuICAgIG1lc3NhZ2UsXG4gIH0pLFxuXG4gIGVxdWFsVG86IChcbiAgICBvdGhlclBhdGg6IHN0cmluZyxcbiAgICBtZXNzYWdlID0gXCJGaWVsZHMgbXVzdCBtYXRjaFwiLFxuICApOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcImVxdWFsVG9cIixcbiAgICBhcmdzOiB7IG90aGVyOiB7ICRzdGF0ZTogb3RoZXJQYXRoIH0gfSxcbiAgICBtZXNzYWdlLFxuICB9KSxcblxuICBsZXNzVGhhbjogKG90aGVyUGF0aDogc3RyaW5nLCBtZXNzYWdlPzogc3RyaW5nKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJsZXNzVGhhblwiLFxuICAgIGFyZ3M6IHsgb3RoZXI6IHsgJHN0YXRlOiBvdGhlclBhdGggfSB9LFxuICAgIG1lc3NhZ2U6IG1lc3NhZ2UgPz8gXCJNdXN0IGJlIGxlc3MgdGhhbiB0aGUgY29tcGFyZWQgZmllbGRcIixcbiAgfSksXG5cbiAgZ3JlYXRlclRoYW46IChvdGhlclBhdGg6IHN0cmluZywgbWVzc2FnZT86IHN0cmluZyk6IFZhbGlkYXRpb25DaGVjayA9PiAoe1xuICAgIHR5cGU6IFwiZ3JlYXRlclRoYW5cIixcbiAgICBhcmdzOiB7IG90aGVyOiB7ICRzdGF0ZTogb3RoZXJQYXRoIH0gfSxcbiAgICBtZXNzYWdlOiBtZXNzYWdlID8/IFwiTXVzdCBiZSBncmVhdGVyIHRoYW4gdGhlIGNvbXBhcmVkIGZpZWxkXCIsXG4gIH0pLFxuXG4gIHJlcXVpcmVkSWY6IChcbiAgICBmaWVsZFBhdGg6IHN0cmluZyxcbiAgICBtZXNzYWdlID0gXCJUaGlzIGZpZWxkIGlzIHJlcXVpcmVkXCIsXG4gICk6IFZhbGlkYXRpb25DaGVjayA9PiAoe1xuICAgIHR5cGU6IFwicmVxdWlyZWRJZlwiLFxuICAgIGFyZ3M6IHsgZmllbGQ6IHsgJHN0YXRlOiBmaWVsZFBhdGggfSB9LFxuICAgIG1lc3NhZ2UsXG4gIH0pLFxufTtcbiIsICJpbXBvcnQgdHlwZSB7IFNwZWMsIFVJRWxlbWVudCB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTcGVjIFN0cnVjdHVyYWwgVmFsaWRhdGlvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBTZXZlcml0eSBsZXZlbCBmb3IgdmFsaWRhdGlvbiBpc3N1ZXMuXG4gKi9cbmV4cG9ydCB0eXBlIFNwZWNJc3N1ZVNldmVyaXR5ID0gXCJlcnJvclwiIHwgXCJ3YXJuaW5nXCI7XG5cbi8qKlxuICogQSBzaW5nbGUgdmFsaWRhdGlvbiBpc3N1ZSBmb3VuZCBpbiBhIHNwZWMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BlY0lzc3VlIHtcbiAgLyoqIFNldmVyaXR5OiBlcnJvcnMgc2hvdWxkIGJlIGZpeGVkLCB3YXJuaW5ncyBhcmUgaW5mb3JtYXRpb25hbCAqL1xuICBzZXZlcml0eTogU3BlY0lzc3VlU2V2ZXJpdHk7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSBkZXNjcmlwdGlvbiBvZiB0aGUgaXNzdWUgKi9cbiAgbWVzc2FnZTogc3RyaW5nO1xuICAvKiogVGhlIGVsZW1lbnQga2V5IHdoZXJlIHRoZSBpc3N1ZSB3YXMgZm91bmQgKGlmIGFwcGxpY2FibGUpICovXG4gIGVsZW1lbnRLZXk/OiBzdHJpbmc7XG4gIC8qKiBNYWNoaW5lLXJlYWRhYmxlIGlzc3VlIGNvZGUgZm9yIHByb2dyYW1tYXRpYyBoYW5kbGluZyAqL1xuICBjb2RlOlxuICAgIHwgXCJtaXNzaW5nX3Jvb3RcIlxuICAgIHwgXCJyb290X25vdF9mb3VuZFwiXG4gICAgfCBcIm1pc3NpbmdfY2hpbGRcIlxuICAgIHwgXCJ2aXNpYmxlX2luX3Byb3BzXCJcbiAgICB8IFwib3JwaGFuZWRfZWxlbWVudFwiXG4gICAgfCBcImVtcHR5X3NwZWNcIlxuICAgIHwgXCJvbl9pbl9wcm9wc1wiXG4gICAgfCBcInJlcGVhdF9pbl9wcm9wc1wiXG4gICAgfCBcIndhdGNoX2luX3Byb3BzXCI7XG59XG5cbi8qKlxuICogUmVzdWx0IG9mIHNwZWMgc3RydWN0dXJhbCB2YWxpZGF0aW9uLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwZWNWYWxpZGF0aW9uSXNzdWVzIHtcbiAgLyoqIFdoZXRoZXIgdGhlIHNwZWMgcGFzc2VkIHZhbGlkYXRpb24gKG5vIGVycm9yczsgd2FybmluZ3MgYXJlIE9LKSAqL1xuICB2YWxpZDogYm9vbGVhbjtcbiAgLyoqIExpc3Qgb2YgaXNzdWVzIGZvdW5kICovXG4gIGlzc3VlczogU3BlY0lzc3VlW107XG59XG5cbi8qKlxuICogT3B0aW9ucyBmb3IgdmFsaWRhdGVTcGVjLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhbGlkYXRlU3BlY09wdGlvbnMge1xuICAvKipcbiAgICogV2hldGhlciB0byBjaGVjayBmb3Igb3JwaGFuZWQgZWxlbWVudHMgKGVsZW1lbnRzIG5vdCByZWFjaGFibGUgZnJvbSByb290KS5cbiAgICogRGVmYXVsdHMgdG8gZmFsc2Ugc2luY2Ugb3JwaGFucyBhcmUgaGFybWxlc3MgKGp1c3QgdW51c2VkKS5cbiAgICovXG4gIGNoZWNrT3JwaGFucz86IGJvb2xlYW47XG59XG5cbi8qKlxuICogVmFsaWRhdGUgYSBzcGVjIGZvciBzdHJ1Y3R1cmFsIGludGVncml0eS5cbiAqXG4gKiBDaGVja3MgZm9yIGNvbW1vbiBBSS1nZW5lcmF0aW9uIGVycm9yczpcbiAqIC0gTWlzc2luZyBvciBlbXB0eSByb290XG4gKiAtIFJvb3QgZWxlbWVudCBub3QgZm91bmQgaW4gZWxlbWVudHMgbWFwXG4gKiAtIENoaWxkcmVuIHJlZmVyZW5jaW5nIG5vbi1leGlzdGVudCBlbGVtZW50c1xuICogLSBgdmlzaWJsZWAgcGxhY2VkIGluc2lkZSBgcHJvcHNgIGluc3RlYWQgb2Ygb24gdGhlIGVsZW1lbnRcbiAqIC0gT3JwaGFuZWQgZWxlbWVudHMgKG9wdGlvbmFsKVxuICpcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogY29uc3QgcmVzdWx0ID0gdmFsaWRhdGVTcGVjKHNwZWMpO1xuICogaWYgKCFyZXN1bHQudmFsaWQpIHtcbiAqICAgY29uc29sZS5sb2coXCJTcGVjIGVycm9yczpcIiwgcmVzdWx0Lmlzc3Vlcyk7XG4gKiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU3BlYyhcbiAgc3BlYzogU3BlYyxcbiAgb3B0aW9uczogVmFsaWRhdGVTcGVjT3B0aW9ucyA9IHt9LFxuKTogU3BlY1ZhbGlkYXRpb25Jc3N1ZXMge1xuICBjb25zdCB7IGNoZWNrT3JwaGFucyA9IGZhbHNlIH0gPSBvcHRpb25zO1xuICBjb25zdCBpc3N1ZXM6IFNwZWNJc3N1ZVtdID0gW107XG5cbiAgLy8gMS4gQ2hlY2sgcm9vdFxuICBpZiAoIXNwZWMucm9vdCkge1xuICAgIGlzc3Vlcy5wdXNoKHtcbiAgICAgIHNldmVyaXR5OiBcImVycm9yXCIsXG4gICAgICBtZXNzYWdlOiBcIlNwZWMgaGFzIG5vIHJvb3QgZWxlbWVudCBkZWZpbmVkLlwiLFxuICAgICAgY29kZTogXCJtaXNzaW5nX3Jvb3RcIixcbiAgICB9KTtcbiAgICByZXR1cm4geyB2YWxpZDogZmFsc2UsIGlzc3VlcyB9O1xuICB9XG5cbiAgaWYgKCFzcGVjLmVsZW1lbnRzW3NwZWMucm9vdF0pIHtcbiAgICBpc3N1ZXMucHVzaCh7XG4gICAgICBzZXZlcml0eTogXCJlcnJvclwiLFxuICAgICAgbWVzc2FnZTogYFJvb3QgZWxlbWVudCBcIiR7c3BlYy5yb290fVwiIG5vdCBmb3VuZCBpbiBlbGVtZW50cyBtYXAuYCxcbiAgICAgIGNvZGU6IFwicm9vdF9ub3RfZm91bmRcIixcbiAgICB9KTtcbiAgfVxuXG4gIC8vIDIuIENoZWNrIGZvciBlbXB0eSBzcGVjXG4gIGlmIChPYmplY3Qua2V5cyhzcGVjLmVsZW1lbnRzKS5sZW5ndGggPT09IDApIHtcbiAgICBpc3N1ZXMucHVzaCh7XG4gICAgICBzZXZlcml0eTogXCJlcnJvclwiLFxuICAgICAgbWVzc2FnZTogXCJTcGVjIGhhcyBubyBlbGVtZW50cy5cIixcbiAgICAgIGNvZGU6IFwiZW1wdHlfc3BlY1wiLFxuICAgIH0pO1xuICAgIHJldHVybiB7IHZhbGlkOiBmYWxzZSwgaXNzdWVzIH07XG4gIH1cblxuICAvLyAzLiBDaGVjayBlYWNoIGVsZW1lbnRcbiAgZm9yIChjb25zdCBba2V5LCBlbGVtZW50XSBvZiBPYmplY3QuZW50cmllcyhzcGVjLmVsZW1lbnRzKSkge1xuICAgIC8vIDNhLiBNaXNzaW5nIGNoaWxkcmVuXG4gICAgaWYgKGVsZW1lbnQuY2hpbGRyZW4pIHtcbiAgICAgIGZvciAoY29uc3QgY2hpbGRLZXkgb2YgZWxlbWVudC5jaGlsZHJlbikge1xuICAgICAgICBpZiAoIXNwZWMuZWxlbWVudHNbY2hpbGRLZXldKSB7XG4gICAgICAgICAgaXNzdWVzLnB1c2goe1xuICAgICAgICAgICAgc2V2ZXJpdHk6IFwiZXJyb3JcIixcbiAgICAgICAgICAgIG1lc3NhZ2U6IGBFbGVtZW50IFwiJHtrZXl9XCIgcmVmZXJlbmNlcyBjaGlsZCBcIiR7Y2hpbGRLZXl9XCIgd2hpY2ggZG9lcyBub3QgZXhpc3QgaW4gdGhlIGVsZW1lbnRzIG1hcC5gLFxuICAgICAgICAgICAgZWxlbWVudEtleToga2V5LFxuICAgICAgICAgICAgY29kZTogXCJtaXNzaW5nX2NoaWxkXCIsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAzYi4gYHZpc2libGVgIGluc2lkZSBwcm9wc1xuICAgIGNvbnN0IHByb3BzID0gZWxlbWVudC5wcm9wcyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICBpZiAocHJvcHMgJiYgXCJ2aXNpYmxlXCIgaW4gcHJvcHMgJiYgcHJvcHMudmlzaWJsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpc3N1ZXMucHVzaCh7XG4gICAgICAgIHNldmVyaXR5OiBcImVycm9yXCIsXG4gICAgICAgIG1lc3NhZ2U6IGBFbGVtZW50IFwiJHtrZXl9XCIgaGFzIFwidmlzaWJsZVwiIGluc2lkZSBcInByb3BzXCIuIEl0IHNob3VsZCBiZSBhIHRvcC1sZXZlbCBmaWVsZCBvbiB0aGUgZWxlbWVudCAoc2libGluZyBvZiB0eXBlL3Byb3BzL2NoaWxkcmVuKS5gLFxuICAgICAgICBlbGVtZW50S2V5OiBrZXksXG4gICAgICAgIGNvZGU6IFwidmlzaWJsZV9pbl9wcm9wc1wiLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gM2MuIGBvbmAgaW5zaWRlIHByb3BzIChzaG91bGQgYmUgYSB0b3AtbGV2ZWwgZmllbGQpXG4gICAgaWYgKHByb3BzICYmIFwib25cIiBpbiBwcm9wcyAmJiBwcm9wcy5vbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpc3N1ZXMucHVzaCh7XG4gICAgICAgIHNldmVyaXR5OiBcImVycm9yXCIsXG4gICAgICAgIG1lc3NhZ2U6IGBFbGVtZW50IFwiJHtrZXl9XCIgaGFzIFwib25cIiBpbnNpZGUgXCJwcm9wc1wiLiBJdCBzaG91bGQgYmUgYSB0b3AtbGV2ZWwgZmllbGQgb24gdGhlIGVsZW1lbnQgKHNpYmxpbmcgb2YgdHlwZS9wcm9wcy9jaGlsZHJlbikuYCxcbiAgICAgICAgZWxlbWVudEtleToga2V5LFxuICAgICAgICBjb2RlOiBcIm9uX2luX3Byb3BzXCIsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAzZC4gYHJlcGVhdGAgaW5zaWRlIHByb3BzIChzaG91bGQgYmUgYSB0b3AtbGV2ZWwgZmllbGQpXG4gICAgaWYgKHByb3BzICYmIFwicmVwZWF0XCIgaW4gcHJvcHMgJiYgcHJvcHMucmVwZWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlzc3Vlcy5wdXNoKHtcbiAgICAgICAgc2V2ZXJpdHk6IFwiZXJyb3JcIixcbiAgICAgICAgbWVzc2FnZTogYEVsZW1lbnQgXCIke2tleX1cIiBoYXMgXCJyZXBlYXRcIiBpbnNpZGUgXCJwcm9wc1wiLiBJdCBzaG91bGQgYmUgYSB0b3AtbGV2ZWwgZmllbGQgb24gdGhlIGVsZW1lbnQgKHNpYmxpbmcgb2YgdHlwZS9wcm9wcy9jaGlsZHJlbikuYCxcbiAgICAgICAgZWxlbWVudEtleToga2V5LFxuICAgICAgICBjb2RlOiBcInJlcGVhdF9pbl9wcm9wc1wiLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gM2UuIGB3YXRjaGAgaW5zaWRlIHByb3BzIChzaG91bGQgYmUgYSB0b3AtbGV2ZWwgZmllbGQpXG4gICAgaWYgKHByb3BzICYmIFwid2F0Y2hcIiBpbiBwcm9wcyAmJiBwcm9wcy53YXRjaCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpc3N1ZXMucHVzaCh7XG4gICAgICAgIHNldmVyaXR5OiBcImVycm9yXCIsXG4gICAgICAgIG1lc3NhZ2U6IGBFbGVtZW50IFwiJHtrZXl9XCIgaGFzIFwid2F0Y2hcIiBpbnNpZGUgXCJwcm9wc1wiLiBJdCBzaG91bGQgYmUgYSB0b3AtbGV2ZWwgZmllbGQgb24gdGhlIGVsZW1lbnQgKHNpYmxpbmcgb2YgdHlwZS9wcm9wcy9jaGlsZHJlbikuYCxcbiAgICAgICAgZWxlbWVudEtleToga2V5LFxuICAgICAgICBjb2RlOiBcIndhdGNoX2luX3Byb3BzXCIsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyA0LiBPcnBoYW5lZCBlbGVtZW50cyAob3B0aW9uYWwpXG4gIGlmIChjaGVja09ycGhhbnMpIHtcbiAgICBjb25zdCByZWFjaGFibGUgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25zdCB3YWxrID0gKGtleTogc3RyaW5nKSA9PiB7XG4gICAgICBpZiAocmVhY2hhYmxlLmhhcyhrZXkpKSByZXR1cm47XG4gICAgICByZWFjaGFibGUuYWRkKGtleSk7XG4gICAgICBjb25zdCBlbCA9IHNwZWMuZWxlbWVudHNba2V5XTtcbiAgICAgIGlmIChlbD8uY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZEtleSBvZiBlbC5jaGlsZHJlbikge1xuICAgICAgICAgIGlmIChzcGVjLmVsZW1lbnRzW2NoaWxkS2V5XSkge1xuICAgICAgICAgICAgd2FsayhjaGlsZEtleSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgICBpZiAoc3BlYy5lbGVtZW50c1tzcGVjLnJvb3RdKSB7XG4gICAgICB3YWxrKHNwZWMucm9vdCk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoc3BlYy5lbGVtZW50cykpIHtcbiAgICAgIGlmICghcmVhY2hhYmxlLmhhcyhrZXkpKSB7XG4gICAgICAgIGlzc3Vlcy5wdXNoKHtcbiAgICAgICAgICBzZXZlcml0eTogXCJ3YXJuaW5nXCIsXG4gICAgICAgICAgbWVzc2FnZTogYEVsZW1lbnQgXCIke2tleX1cIiBpcyBub3QgcmVhY2hhYmxlIGZyb20gcm9vdCBcIiR7c3BlYy5yb290fVwiLmAsXG4gICAgICAgICAgZWxlbWVudEtleToga2V5LFxuICAgICAgICAgIGNvZGU6IFwib3JwaGFuZWRfZWxlbWVudFwiLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBoYXNFcnJvcnMgPSBpc3N1ZXMuc29tZSgoaSkgPT4gaS5zZXZlcml0eSA9PT0gXCJlcnJvclwiKTtcbiAgcmV0dXJuIHsgdmFsaWQ6ICFoYXNFcnJvcnMsIGlzc3VlcyB9O1xufVxuXG4vKipcbiAqIEF1dG8tZml4IGNvbW1vbiBzcGVjIGlzc3VlcyBpbi1wbGFjZSBhbmQgcmV0dXJuIGEgY29ycmVjdGVkIGNvcHkuXG4gKlxuICogQ3VycmVudGx5IGZpeGVzOlxuICogLSBgdmlzaWJsZWAgaW5zaWRlIGBwcm9wc2Ag4oaSIG1vdmVkIHRvIGVsZW1lbnQgbGV2ZWxcbiAqIC0gYG9uYCBpbnNpZGUgYHByb3BzYCDihpIgbW92ZWQgdG8gZWxlbWVudCBsZXZlbFxuICogLSBgcmVwZWF0YCBpbnNpZGUgYHByb3BzYCDihpIgbW92ZWQgdG8gZWxlbWVudCBsZXZlbFxuICpcbiAqIFJldHVybnMgdGhlIGZpeGVkIHNwZWMgYW5kIGEgbGlzdCBvZiBmaXhlcyBhcHBsaWVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXV0b0ZpeFNwZWMoc3BlYzogU3BlYyk6IHtcbiAgc3BlYzogU3BlYztcbiAgZml4ZXM6IHN0cmluZ1tdO1xufSB7XG4gIGNvbnN0IGZpeGVzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBmaXhlZEVsZW1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBVSUVsZW1lbnQ+ID0ge307XG5cbiAgZm9yIChjb25zdCBba2V5LCBlbGVtZW50XSBvZiBPYmplY3QuZW50cmllcyhzcGVjLmVsZW1lbnRzKSkge1xuICAgIGNvbnN0IHByb3BzID0gZWxlbWVudC5wcm9wcyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICBsZXQgZml4ZWQgPSBlbGVtZW50O1xuXG4gICAgaWYgKHByb3BzICYmIFwidmlzaWJsZVwiIGluIHByb3BzICYmIHByb3BzLnZpc2libGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gTW92ZSB2aXNpYmxlIGZyb20gcHJvcHMgdG8gZWxlbWVudCBsZXZlbFxuICAgICAgY29uc3QgeyB2aXNpYmxlLCAuLi5yZXN0UHJvcHMgfSA9IGZpeGVkLnByb3BzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgZml4ZWQgPSB7XG4gICAgICAgIC4uLmZpeGVkLFxuICAgICAgICBwcm9wczogcmVzdFByb3BzLFxuICAgICAgICB2aXNpYmxlOiB2aXNpYmxlIGFzIFVJRWxlbWVudFtcInZpc2libGVcIl0sXG4gICAgICB9O1xuICAgICAgZml4ZXMucHVzaChgTW92ZWQgXCJ2aXNpYmxlXCIgZnJvbSBwcm9wcyB0byBlbGVtZW50IGxldmVsIG9uIFwiJHtrZXl9XCIuYCk7XG4gICAgfVxuXG4gICAgbGV0IGN1cnJlbnRQcm9wcyA9IGZpeGVkLnByb3BzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgIGlmIChjdXJyZW50UHJvcHMgJiYgXCJvblwiIGluIGN1cnJlbnRQcm9wcyAmJiBjdXJyZW50UHJvcHMub24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gTW92ZSBvbiBmcm9tIHByb3BzIHRvIGVsZW1lbnQgbGV2ZWxcbiAgICAgIGNvbnN0IHsgb24sIC4uLnJlc3RQcm9wcyB9ID0gY3VycmVudFByb3BzO1xuICAgICAgZml4ZWQgPSB7XG4gICAgICAgIC4uLmZpeGVkLFxuICAgICAgICBwcm9wczogcmVzdFByb3BzLFxuICAgICAgICBvbjogb24gYXMgVUlFbGVtZW50W1wib25cIl0sXG4gICAgICB9O1xuICAgICAgZml4ZXMucHVzaChgTW92ZWQgXCJvblwiIGZyb20gcHJvcHMgdG8gZWxlbWVudCBsZXZlbCBvbiBcIiR7a2V5fVwiLmApO1xuICAgIH1cblxuICAgIGN1cnJlbnRQcm9wcyA9IGZpeGVkLnByb3BzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgIGlmIChcbiAgICAgIGN1cnJlbnRQcm9wcyAmJlxuICAgICAgXCJyZXBlYXRcIiBpbiBjdXJyZW50UHJvcHMgJiZcbiAgICAgIGN1cnJlbnRQcm9wcy5yZXBlYXQgIT09IHVuZGVmaW5lZFxuICAgICkge1xuICAgICAgLy8gTW92ZSByZXBlYXQgZnJvbSBwcm9wcyB0byBlbGVtZW50IGxldmVsXG4gICAgICBjb25zdCB7IHJlcGVhdCwgLi4ucmVzdFByb3BzIH0gPSBjdXJyZW50UHJvcHM7XG4gICAgICBmaXhlZCA9IHtcbiAgICAgICAgLi4uZml4ZWQsXG4gICAgICAgIHByb3BzOiByZXN0UHJvcHMsXG4gICAgICAgIHJlcGVhdDogcmVwZWF0IGFzIFVJRWxlbWVudFtcInJlcGVhdFwiXSxcbiAgICAgIH07XG4gICAgICBmaXhlcy5wdXNoKGBNb3ZlZCBcInJlcGVhdFwiIGZyb20gcHJvcHMgdG8gZWxlbWVudCBsZXZlbCBvbiBcIiR7a2V5fVwiLmApO1xuICAgIH1cblxuICAgIGN1cnJlbnRQcm9wcyA9IGZpeGVkLnByb3BzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgIGlmIChcbiAgICAgIGN1cnJlbnRQcm9wcyAmJlxuICAgICAgXCJ3YXRjaFwiIGluIGN1cnJlbnRQcm9wcyAmJlxuICAgICAgY3VycmVudFByb3BzLndhdGNoICE9PSB1bmRlZmluZWRcbiAgICApIHtcbiAgICAgIGNvbnN0IHsgd2F0Y2gsIC4uLnJlc3RQcm9wcyB9ID0gY3VycmVudFByb3BzO1xuICAgICAgZml4ZWQgPSB7XG4gICAgICAgIC4uLmZpeGVkLFxuICAgICAgICBwcm9wczogcmVzdFByb3BzLFxuICAgICAgICB3YXRjaDogd2F0Y2ggYXMgVUlFbGVtZW50W1wid2F0Y2hcIl0sXG4gICAgICB9O1xuICAgICAgZml4ZXMucHVzaChgTW92ZWQgXCJ3YXRjaFwiIGZyb20gcHJvcHMgdG8gZWxlbWVudCBsZXZlbCBvbiBcIiR7a2V5fVwiLmApO1xuICAgIH1cblxuICAgIGZpeGVkRWxlbWVudHNba2V5XSA9IGZpeGVkO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzcGVjOiB7IHJvb3Q6IHNwZWMucm9vdCwgZWxlbWVudHM6IGZpeGVkRWxlbWVudHMsIHN0YXRlOiBzcGVjLnN0YXRlIH0sXG4gICAgZml4ZXMsXG4gIH07XG59XG5cbi8qKlxuICogRm9ybWF0IHZhbGlkYXRpb24gaXNzdWVzIGludG8gYSBodW1hbi1yZWFkYWJsZSBzdHJpbmcgc3VpdGFibGUgZm9yXG4gKiBpbmNsdXNpb24gaW4gYSByZXBhaXIgcHJvbXB0IHNlbnQgYmFjayB0byB0aGUgQUkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRTcGVjSXNzdWVzKGlzc3VlczogU3BlY0lzc3VlW10pOiBzdHJpbmcge1xuICBjb25zdCBlcnJvcnMgPSBpc3N1ZXMuZmlsdGVyKChpKSA9PiBpLnNldmVyaXR5ID09PSBcImVycm9yXCIpO1xuICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiXCI7XG5cbiAgY29uc3QgbGluZXMgPSBbXCJUaGUgZ2VuZXJhdGVkIFVJIHNwZWMgaGFzIHRoZSBmb2xsb3dpbmcgZXJyb3JzOlwiXTtcbiAgZm9yIChjb25zdCBpc3N1ZSBvZiBlcnJvcnMpIHtcbiAgICBsaW5lcy5wdXNoKGAtICR7aXNzdWUubWVzc2FnZX1gKTtcbiAgfVxuICByZXR1cm4gbGluZXMuam9pbihcIlxcblwiKTtcbn1cbiIsICJpbXBvcnQgeyB6IH0gZnJvbSBcInpvZFwiO1xuXG4vKipcbiAqIFNjaGVtYSBidWlsZGVyIHByaW1pdGl2ZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2hlbWFCdWlsZGVyIHtcbiAgLyoqIFN0cmluZyB0eXBlICovXG4gIHN0cmluZygpOiBTY2hlbWFUeXBlPFwic3RyaW5nXCI+O1xuICAvKiogTnVtYmVyIHR5cGUgKi9cbiAgbnVtYmVyKCk6IFNjaGVtYVR5cGU8XCJudW1iZXJcIj47XG4gIC8qKiBCb29sZWFuIHR5cGUgKi9cbiAgYm9vbGVhbigpOiBTY2hlbWFUeXBlPFwiYm9vbGVhblwiPjtcbiAgLyoqIEFycmF5IG9mIHR5cGUgKi9cbiAgYXJyYXk8VCBleHRlbmRzIFNjaGVtYVR5cGU+KGl0ZW06IFQpOiBTY2hlbWFUeXBlPFwiYXJyYXlcIiwgVD47XG4gIC8qKiBPYmplY3Qgd2l0aCBzaGFwZSAqL1xuICBvYmplY3Q8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIFNjaGVtYVR5cGU+PihcbiAgICBzaGFwZTogVCxcbiAgKTogU2NoZW1hVHlwZTxcIm9iamVjdFwiLCBUPjtcbiAgLyoqIFJlY29yZC9tYXAgd2l0aCB2YWx1ZSB0eXBlICovXG4gIHJlY29yZDxUIGV4dGVuZHMgU2NoZW1hVHlwZT4odmFsdWU6IFQpOiBTY2hlbWFUeXBlPFwicmVjb3JkXCIsIFQ+O1xuICAvKiogQW55IHR5cGUgKi9cbiAgYW55KCk6IFNjaGVtYVR5cGU8XCJhbnlcIj47XG4gIC8qKiBQbGFjZWhvbGRlciBmb3IgdXNlci1wcm92aWRlZCBab2Qgc2NoZW1hICovXG4gIHpvZCgpOiBTY2hlbWFUeXBlPFwiem9kXCI+O1xuICAvKiogUmVmZXJlbmNlIHRvIGNhdGFsb2cga2V5IChlLmcuLCAnY2F0YWxvZy5jb21wb25lbnRzJykgKi9cbiAgcmVmKHBhdGg6IHN0cmluZyk6IFNjaGVtYVR5cGU8XCJyZWZcIiwgc3RyaW5nPjtcbiAgLyoqIFByb3BzIGZyb20gcmVmZXJlbmNlZCBjYXRhbG9nIGVudHJ5ICovXG4gIHByb3BzT2YocGF0aDogc3RyaW5nKTogU2NoZW1hVHlwZTxcInByb3BzT2ZcIiwgc3RyaW5nPjtcbiAgLyoqIE1hcCBvZiBuYW1lZCBlbnRyaWVzIHdpdGggc2hhcmVkIHNoYXBlICovXG4gIG1hcDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgU2NoZW1hVHlwZT4+KFxuICAgIGVudHJ5U2hhcGU6IFQsXG4gICk6IFNjaGVtYVR5cGU8XCJtYXBcIiwgVD47XG4gIC8qKiBPcHRpb25hbCBtb2RpZmllciAqL1xuICBvcHRpb25hbCgpOiB7IG9wdGlvbmFsOiB0cnVlIH07XG59XG5cbi8qKlxuICogU2NoZW1hIHR5cGUgcmVwcmVzZW50YXRpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2hlbWFUeXBlPFRLaW5kIGV4dGVuZHMgc3RyaW5nID0gc3RyaW5nLCBUSW5uZXIgPSB1bmtub3duPiB7XG4gIGtpbmQ6IFRLaW5kO1xuICBpbm5lcj86IFRJbm5lcjtcbiAgb3B0aW9uYWw/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFNjaGVtYSBkZWZpbml0aW9uIHNoYXBlXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NoZW1hRGVmaW5pdGlvbjxcbiAgVFNwZWMgZXh0ZW5kcyBTY2hlbWFUeXBlID0gU2NoZW1hVHlwZSxcbiAgVENhdGFsb2cgZXh0ZW5kcyBTY2hlbWFUeXBlID0gU2NoZW1hVHlwZSxcbj4ge1xuICAvKiogV2hhdCB0aGUgQUktZ2VuZXJhdGVkIHNwZWMgbG9va3MgbGlrZSAqL1xuICBzcGVjOiBUU3BlYztcbiAgLyoqIFdoYXQgdGhlIGNhdGFsb2cgbXVzdCBwcm92aWRlICovXG4gIGNhdGFsb2c6IFRDYXRhbG9nO1xufVxuXG4vKipcbiAqIFNjaGVtYSBpbnN0YW5jZSB3aXRoIG1ldGhvZHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2hlbWE8VERlZiBleHRlbmRzIFNjaGVtYURlZmluaXRpb24gPSBTY2hlbWFEZWZpbml0aW9uPiB7XG4gIC8qKiBUaGUgc2NoZW1hIGRlZmluaXRpb24gKi9cbiAgcmVhZG9ubHkgZGVmaW5pdGlvbjogVERlZjtcbiAgLyoqIEN1c3RvbSBwcm9tcHQgdGVtcGxhdGUgZm9yIHRoaXMgc2NoZW1hICovXG4gIHJlYWRvbmx5IHByb21wdFRlbXBsYXRlPzogUHJvbXB0VGVtcGxhdGU7XG4gIC8qKiBEZWZhdWx0IHJ1bGVzIGJha2VkIGludG8gdGhlIHNjaGVtYSAoaW5qZWN0ZWQgYmVmb3JlIGN1c3RvbVJ1bGVzKSAqL1xuICByZWFkb25seSBkZWZhdWx0UnVsZXM/OiBzdHJpbmdbXTtcbiAgLyoqIEJ1aWx0LWluIGFjdGlvbnMgYWx3YXlzIGF2YWlsYWJsZSBhdCBydW50aW1lIChpbmplY3RlZCBpbnRvIHByb21wdHMgYXV0b21hdGljYWxseSkgKi9cbiAgcmVhZG9ubHkgYnVpbHRJbkFjdGlvbnM/OiBCdWlsdEluQWN0aW9uW107XG4gIC8qKiBDcmVhdGUgYSBjYXRhbG9nIGZyb20gdGhpcyBzY2hlbWEgKi9cbiAgY3JlYXRlQ2F0YWxvZzxUQ2F0YWxvZyBleHRlbmRzIEluZmVyQ2F0YWxvZ0lucHV0PFREZWZbXCJjYXRhbG9nXCJdPj4oXG4gICAgY2F0YWxvZzogVENhdGFsb2csXG4gICk6IENhdGFsb2c8VERlZiwgVENhdGFsb2c+O1xufVxuXG4vKipcbiAqIENhdGFsb2cgaW5zdGFuY2Ugd2l0aCBtZXRob2RzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2F0YWxvZzxcbiAgVERlZiBleHRlbmRzIFNjaGVtYURlZmluaXRpb24gPSBTY2hlbWFEZWZpbml0aW9uLFxuICBUQ2F0YWxvZyA9IHVua25vd24sXG4+IHtcbiAgLyoqIFRoZSBzY2hlbWEgdGhpcyBjYXRhbG9nIGlzIGJhc2VkIG9uICovXG4gIHJlYWRvbmx5IHNjaGVtYTogU2NoZW1hPFREZWY+O1xuICAvKiogVGhlIGNhdGFsb2cgZGF0YSAqL1xuICByZWFkb25seSBkYXRhOiBUQ2F0YWxvZztcbiAgLyoqIENvbXBvbmVudCBuYW1lcyAqL1xuICByZWFkb25seSBjb21wb25lbnROYW1lczogc3RyaW5nW107XG4gIC8qKiBBY3Rpb24gbmFtZXMgKi9cbiAgcmVhZG9ubHkgYWN0aW9uTmFtZXM6IHN0cmluZ1tdO1xuICAvKiogR2VuZXJhdGUgc3lzdGVtIHByb21wdCBmb3IgQUkgKi9cbiAgcHJvbXB0KG9wdGlvbnM/OiBQcm9tcHRPcHRpb25zKTogc3RyaW5nO1xuICAvKiogRXhwb3J0IGFzIEpTT04gU2NoZW1hIGZvciBzdHJ1Y3R1cmVkIG91dHB1dHMgKi9cbiAganNvblNjaGVtYSgpOiBvYmplY3Q7XG4gIC8qKiBWYWxpZGF0ZSBhIHNwZWMgYWdhaW5zdCB0aGlzIGNhdGFsb2cgKi9cbiAgdmFsaWRhdGUoc3BlYzogdW5rbm93bik6IFNwZWNWYWxpZGF0aW9uUmVzdWx0PEluZmVyU3BlYzxURGVmLCBUQ2F0YWxvZz4+O1xuICAvKiogR2V0IHRoZSBab2Qgc2NoZW1hIGZvciB0aGUgc3BlYyAqL1xuICB6b2RTY2hlbWEoKTogei5ab2RUeXBlPEluZmVyU3BlYzxURGVmLCBUQ2F0YWxvZz4+O1xuICAvKiogVHlwZSBoZWxwZXIgZm9yIHRoZSBzcGVjIHR5cGUgKi9cbiAgcmVhZG9ubHkgX3NwZWNUeXBlOiBJbmZlclNwZWM8VERlZiwgVENhdGFsb2c+O1xufVxuXG4vKipcbiAqIFByb21wdCBnZW5lcmF0aW9uIG9wdGlvbnNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQcm9tcHRPcHRpb25zIHtcbiAgLyoqIEN1c3RvbSBzeXN0ZW0gbWVzc2FnZSBpbnRybyAqL1xuICBzeXN0ZW0/OiBzdHJpbmc7XG4gIC8qKiBBZGRpdGlvbmFsIHJ1bGVzIHRvIGFwcGVuZCAqL1xuICBjdXN0b21SdWxlcz86IHN0cmluZ1tdO1xuICAvKipcbiAgICogT3V0cHV0IG1vZGUgZm9yIHRoZSBnZW5lcmF0ZWQgcHJvbXB0LlxuICAgKlxuICAgKiAtIGBcImdlbmVyYXRlXCJgIChkZWZhdWx0KTogVGhlIExMTSBzaG91bGQgb3V0cHV0IG9ubHkgSlNPTkwgcGF0Y2hlcyAobm8gcHJvc2UpLlxuICAgKiAtIGBcImNoYXRcImA6IFRoZSBMTE0gc2hvdWxkIHJlc3BvbmQgY29udmVyc2F0aW9uYWxseSBmaXJzdCwgdGhlbiBvdXRwdXQgSlNPTkwgcGF0Y2hlcy5cbiAgICogICBJbmNsdWRlcyBydWxlcyBhYm91dCBpbnRlcmxlYXZpbmcgdGV4dCB3aXRoIEpTT05MIGFuZCBub3Qgd3JhcHBpbmcgaW4gY29kZSBmZW5jZXMuXG4gICAqL1xuICBtb2RlPzogXCJnZW5lcmF0ZVwiIHwgXCJjaGF0XCI7XG59XG5cbi8qKlxuICogQ29udGV4dCBwcm92aWRlZCB0byBwcm9tcHQgdGVtcGxhdGVzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHJvbXB0Q29udGV4dDxUQ2F0YWxvZyA9IHVua25vd24+IHtcbiAgLyoqIFRoZSBjYXRhbG9nIGRhdGEgKi9cbiAgY2F0YWxvZzogVENhdGFsb2c7XG4gIC8qKiBDb21wb25lbnQgbmFtZXMgZnJvbSB0aGUgY2F0YWxvZyAqL1xuICBjb21wb25lbnROYW1lczogc3RyaW5nW107XG4gIC8qKiBBY3Rpb24gbmFtZXMgZnJvbSB0aGUgY2F0YWxvZyAoaWYgYW55KSAqL1xuICBhY3Rpb25OYW1lczogc3RyaW5nW107XG4gIC8qKiBQcm9tcHQgb3B0aW9ucyBwcm92aWRlZCBieSB0aGUgdXNlciAqL1xuICBvcHRpb25zOiBQcm9tcHRPcHRpb25zO1xuICAvKiogSGVscGVyIHRvIGZvcm1hdCBhIFpvZCB0eXBlIGFzIGEgaHVtYW4tcmVhZGFibGUgc3RyaW5nICovXG4gIGZvcm1hdFpvZFR5cGU6IChzY2hlbWE6IHouWm9kVHlwZSkgPT4gc3RyaW5nO1xufVxuXG4vKipcbiAqIFByb21wdCB0ZW1wbGF0ZSBmdW5jdGlvbiB0eXBlXG4gKi9cbmV4cG9ydCB0eXBlIFByb21wdFRlbXBsYXRlPFRDYXRhbG9nID0gdW5rbm93bj4gPSAoXG4gIGNvbnRleHQ6IFByb21wdENvbnRleHQ8VENhdGFsb2c+LFxuKSA9PiBzdHJpbmc7XG5cbi8qKlxuICogQSBidWlsdC1pbiBhY3Rpb24gdGhhdCBpcyBhbHdheXMgYXZhaWxhYmxlIHJlZ2FyZGxlc3Mgb2YgY2F0YWxvZyBjb25maWd1cmF0aW9uLlxuICogVGhlc2UgYXJlIGhhbmRsZWQgYnkgdGhlIHJ1bnRpbWUgKGUuZy4gQWN0aW9uUHJvdmlkZXIpIGFuZCBpbmplY3RlZCBpbnRvIHByb21wdHNcbiAqIGF1dG9tYXRpY2FsbHkgc28gdGhlIExMTSBrbm93cyBhYm91dCB0aGVtLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEJ1aWx0SW5BY3Rpb24ge1xuICAvKiogQWN0aW9uIG5hbWUgKGUuZy4gXCJzZXRTdGF0ZVwiKSAqL1xuICBuYW1lOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSBkZXNjcmlwdGlvbiBmb3IgdGhlIExMTSAqL1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xufVxuXG4vKipcbiAqIFNjaGVtYSBvcHRpb25zXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NoZW1hT3B0aW9uczxUQ2F0YWxvZyA9IHVua25vd24+IHtcbiAgLyoqIEN1c3RvbSBwcm9tcHQgdGVtcGxhdGUgZm9yIHRoaXMgc2NoZW1hICovXG4gIHByb21wdFRlbXBsYXRlPzogUHJvbXB0VGVtcGxhdGU8VENhdGFsb2c+O1xuICAvKiogRGVmYXVsdCBydWxlcyBiYWtlZCBpbnRvIHRoZSBzY2hlbWEgKGluamVjdGVkIGJlZm9yZSBjdXN0b21SdWxlcyBpbiBwcm9tcHRzKSAqL1xuICBkZWZhdWx0UnVsZXM/OiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIEJ1aWx0LWluIGFjdGlvbnMgdGhhdCBhcmUgYWx3YXlzIGF2YWlsYWJsZSByZWdhcmRsZXNzIG9mIGNhdGFsb2cgY29uZmlndXJhdGlvbi5cbiAgICogVGhlc2UgYXJlIGluamVjdGVkIGludG8gcHJvbXB0cyBhdXRvbWF0aWNhbGx5IHNvIHRoZSBMTE0ga25vd3MgYWJvdXQgdGhlbSxcbiAgICogYnV0IHRoZXkgZG9uJ3QgcmVxdWlyZSBoYW5kbGVycyBpbiBkZWZpbmVSZWdpc3RyeSBiZWNhdXNlIHRoZSBydW50aW1lXG4gICAqIChlLmcuIEFjdGlvblByb3ZpZGVyKSBoYW5kbGVzIHRoZW0gZGlyZWN0bHkuXG4gICAqL1xuICBidWlsdEluQWN0aW9ucz86IEJ1aWx0SW5BY3Rpb25bXTtcbn1cblxuLyoqXG4gKiBTcGVjIHZhbGlkYXRpb24gcmVzdWx0XG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BlY1ZhbGlkYXRpb25SZXN1bHQ8VD4ge1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBkYXRhPzogVDtcbiAgZXJyb3I/OiB6LlpvZEVycm9yO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ2F0YWxvZyBUeXBlIEluZmVyZW5jZSBIZWxwZXJzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEV4dHJhY3QgdGhlIGNvbXBvbmVudHMgbWFwIHR5cGUgZnJvbSBhIGNhdGFsb2dcbiAqIEBleGFtcGxlIHR5cGUgQ29tcG9uZW50cyA9IEluZmVyQ2F0YWxvZ0NvbXBvbmVudHM8dHlwZW9mIG15Q2F0YWxvZz47XG4gKi9cbmV4cG9ydCB0eXBlIEluZmVyQ2F0YWxvZ0NvbXBvbmVudHM8QyBleHRlbmRzIENhdGFsb2c+ID1cbiAgQyBleHRlbmRzIENhdGFsb2c8U2NoZW1hRGVmaW5pdGlvbiwgaW5mZXIgVENhdGFsb2c+XG4gICAgPyBUQ2F0YWxvZyBleHRlbmRzIHsgY29tcG9uZW50czogaW5mZXIgQ29tcHMgfVxuICAgICAgPyBDb21wc1xuICAgICAgOiBuZXZlclxuICAgIDogbmV2ZXI7XG5cbi8qKlxuICogRXh0cmFjdCB0aGUgYWN0aW9ucyBtYXAgdHlwZSBmcm9tIGEgY2F0YWxvZ1xuICogQGV4YW1wbGUgdHlwZSBBY3Rpb25zID0gSW5mZXJDYXRhbG9nQWN0aW9uczx0eXBlb2YgbXlDYXRhbG9nPjtcbiAqL1xuZXhwb3J0IHR5cGUgSW5mZXJDYXRhbG9nQWN0aW9uczxDIGV4dGVuZHMgQ2F0YWxvZz4gPVxuICBDIGV4dGVuZHMgQ2F0YWxvZzxTY2hlbWFEZWZpbml0aW9uLCBpbmZlciBUQ2F0YWxvZz5cbiAgICA/IFRDYXRhbG9nIGV4dGVuZHMgeyBhY3Rpb25zOiBpbmZlciBBY3RzIH1cbiAgICAgID8gQWN0c1xuICAgICAgOiBuZXZlclxuICAgIDogbmV2ZXI7XG5cbi8qKlxuICogSW5mZXIgY29tcG9uZW50IHByb3BzIGZyb20gYSBjYXRhbG9nIGJ5IGNvbXBvbmVudCBuYW1lXG4gKiBAZXhhbXBsZSB0eXBlIEJ1dHRvblByb3BzID0gSW5mZXJDb21wb25lbnRQcm9wczx0eXBlb2YgbXlDYXRhbG9nLCAnQnV0dG9uJz47XG4gKi9cbmV4cG9ydCB0eXBlIEluZmVyQ29tcG9uZW50UHJvcHM8XG4gIEMgZXh0ZW5kcyBDYXRhbG9nLFxuICBLIGV4dGVuZHMga2V5b2YgSW5mZXJDYXRhbG9nQ29tcG9uZW50czxDPixcbj4gPSBJbmZlckNhdGFsb2dDb21wb25lbnRzPEM+W0tdIGV4dGVuZHMgeyBwcm9wczogei5ab2RUeXBlPGluZmVyIFA+IH1cbiAgPyBQXG4gIDogbmV2ZXI7XG5cbi8qKlxuICogSW5mZXIgYWN0aW9uIHBhcmFtcyBmcm9tIGEgY2F0YWxvZyBieSBhY3Rpb24gbmFtZVxuICogQGV4YW1wbGUgdHlwZSBWaWV3Q3VzdG9tZXJzUGFyYW1zID0gSW5mZXJBY3Rpb25QYXJhbXM8dHlwZW9mIG15Q2F0YWxvZywgJ3ZpZXdDdXN0b21lcnMnPjtcbiAqL1xuZXhwb3J0IHR5cGUgSW5mZXJBY3Rpb25QYXJhbXM8XG4gIEMgZXh0ZW5kcyBDYXRhbG9nLFxuICBLIGV4dGVuZHMga2V5b2YgSW5mZXJDYXRhbG9nQWN0aW9uczxDPixcbj4gPSBJbmZlckNhdGFsb2dBY3Rpb25zPEM+W0tdIGV4dGVuZHMgeyBwYXJhbXM6IHouWm9kVHlwZTxpbmZlciBQPiB9XG4gID8gUFxuICA6IG5ldmVyO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gSW50ZXJuYWwgVHlwZSBJbmZlcmVuY2UgSGVscGVyc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IHR5cGUgSW5mZXJDYXRhbG9nSW5wdXQ8VD4gPVxuICBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcIm9iamVjdFwiLCBpbmZlciBTaGFwZT5cbiAgICA/IHsgW0sgaW4ga2V5b2YgU2hhcGVdOiBJbmZlckNhdGFsb2dGaWVsZDxTaGFwZVtLXT4gfVxuICAgIDogbmV2ZXI7XG5cbnR5cGUgSW5mZXJDYXRhbG9nRmllbGQ8VD4gPVxuICBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcIm1hcFwiLCBpbmZlciBFbnRyeVNoYXBlPlxuICAgID8gUmVjb3JkPFxuICAgICAgICBzdHJpbmcsXG4gICAgICAgIC8vIE9ubHkgJ3Byb3BzJyBpcyByZXF1aXJlZCwgcmVzdCBhcmUgb3B0aW9uYWxcbiAgICAgICAgSW5mZXJNYXBFbnRyeVJlcXVpcmVkPEVudHJ5U2hhcGU+ICZcbiAgICAgICAgICBQYXJ0aWFsPEluZmVyTWFwRW50cnlPcHRpb25hbDxFbnRyeVNoYXBlPj5cbiAgICAgID5cbiAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwiem9kXCI+XG4gICAgICA/IHouWm9kVHlwZVxuICAgICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcInN0cmluZ1wiPlxuICAgICAgICA/IHN0cmluZ1xuICAgICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwibnVtYmVyXCI+XG4gICAgICAgICAgPyBudW1iZXJcbiAgICAgICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwiYm9vbGVhblwiPlxuICAgICAgICAgICAgPyBib29sZWFuXG4gICAgICAgICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwiYXJyYXlcIiwgaW5mZXIgSXRlbT5cbiAgICAgICAgICAgICAgPyBJbmZlckNhdGFsb2dGaWVsZDxJdGVtPltdXG4gICAgICAgICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJvYmplY3RcIiwgaW5mZXIgU2hhcGU+XG4gICAgICAgICAgICAgICAgPyB7IFtLIGluIGtleW9mIFNoYXBlXTogSW5mZXJDYXRhbG9nRmllbGQ8U2hhcGVbS10+IH1cbiAgICAgICAgICAgICAgICA6IHVua25vd247XG5cbi8vIEV4dHJhY3QgcmVxdWlyZWQgZmllbGRzIChwcm9wcyBpcyBhbHdheXMgcmVxdWlyZWQpXG50eXBlIEluZmVyTWFwRW50cnlSZXF1aXJlZDxUPiA9IHtcbiAgW0sgaW4ga2V5b2YgVCBhcyBLIGV4dGVuZHMgXCJwcm9wc1wiID8gSyA6IG5ldmVyXTogSW5mZXJNYXBFbnRyeUZpZWxkPFRbS10+O1xufTtcblxuLy8gRXh0cmFjdCBvcHRpb25hbCBmaWVsZHMgKGV2ZXJ5dGhpbmcgZXhjZXB0IHByb3BzKVxudHlwZSBJbmZlck1hcEVudHJ5T3B0aW9uYWw8VD4gPSB7XG4gIFtLIGluIGtleW9mIFQgYXMgSyBleHRlbmRzIFwicHJvcHNcIiA/IG5ldmVyIDogS106IEluZmVyTWFwRW50cnlGaWVsZDxUW0tdPjtcbn07XG5cbnR5cGUgSW5mZXJNYXBFbnRyeUZpZWxkPFQ+ID1cbiAgVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJ6b2RcIj5cbiAgICA/IHouWm9kVHlwZVxuICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJzdHJpbmdcIj5cbiAgICAgID8gc3RyaW5nXG4gICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwibnVtYmVyXCI+XG4gICAgICAgID8gbnVtYmVyXG4gICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJib29sZWFuXCI+XG4gICAgICAgICAgPyBib29sZWFuXG4gICAgICAgICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcImFycmF5XCIsIGluZmVyIEl0ZW0+XG4gICAgICAgICAgICA/IEluZmVyTWFwRW50cnlGaWVsZDxJdGVtPltdXG4gICAgICAgICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwib2JqZWN0XCIsIGluZmVyIFNoYXBlPlxuICAgICAgICAgICAgICA/IHsgW0sgaW4ga2V5b2YgU2hhcGVdOiBJbmZlck1hcEVudHJ5RmllbGQ8U2hhcGVbS10+IH1cbiAgICAgICAgICAgICAgOiB1bmtub3duO1xuXG4vLyBTcGVjIGluZmVyZW5jZSAoc2ltcGxpZmllZCAtIHdpbGwgYmUgZXhwYW5kZWQpXG5leHBvcnQgdHlwZSBJbmZlclNwZWM8VERlZiBleHRlbmRzIFNjaGVtYURlZmluaXRpb24sIFRDYXRhbG9nPiA9IFREZWYgZXh0ZW5kcyB7XG4gIHNwZWM6IFNjaGVtYVR5cGU8XCJvYmplY3RcIiwgaW5mZXIgU2hhcGU+O1xufVxuICA/IEluZmVyU3BlY09iamVjdDxTaGFwZSwgVENhdGFsb2c+XG4gIDogdW5rbm93bjtcblxudHlwZSBJbmZlclNwZWNPYmplY3Q8U2hhcGUsIFRDYXRhbG9nPiA9IHtcbiAgW0sgaW4ga2V5b2YgU2hhcGVdOiBJbmZlclNwZWNGaWVsZDxTaGFwZVtLXSwgVENhdGFsb2c+O1xufTtcblxudHlwZSBJbmZlclNwZWNGaWVsZDxULCBUQ2F0YWxvZz4gPVxuICBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcInN0cmluZ1wiPlxuICAgID8gc3RyaW5nXG4gICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcIm51bWJlclwiPlxuICAgICAgPyBudW1iZXJcbiAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJib29sZWFuXCI+XG4gICAgICAgID8gYm9vbGVhblxuICAgICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwiYXJyYXlcIiwgaW5mZXIgSXRlbT5cbiAgICAgICAgICA/IEluZmVyU3BlY0ZpZWxkPEl0ZW0sIFRDYXRhbG9nPltdXG4gICAgICAgICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcIm9iamVjdFwiLCBpbmZlciBTaGFwZT5cbiAgICAgICAgICAgID8gSW5mZXJTcGVjT2JqZWN0PFNoYXBlLCBUQ2F0YWxvZz5cbiAgICAgICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJyZWNvcmRcIiwgaW5mZXIgVmFsdWU+XG4gICAgICAgICAgICAgID8gUmVjb3JkPHN0cmluZywgSW5mZXJTcGVjRmllbGQ8VmFsdWUsIFRDYXRhbG9nPj5cbiAgICAgICAgICAgICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcInJlZlwiLCBpbmZlciBQYXRoPlxuICAgICAgICAgICAgICAgID8gSW5mZXJSZWZUeXBlPFBhdGgsIFRDYXRhbG9nPlxuICAgICAgICAgICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJwcm9wc09mXCIsIGluZmVyIFBhdGg+XG4gICAgICAgICAgICAgICAgICA/IEluZmVyUHJvcHNPZlR5cGU8UGF0aCwgVENhdGFsb2c+XG4gICAgICAgICAgICAgICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwiYW55XCI+XG4gICAgICAgICAgICAgICAgICAgID8gdW5rbm93blxuICAgICAgICAgICAgICAgICAgICA6IHVua25vd247XG5cbnR5cGUgSW5mZXJSZWZUeXBlPFBhdGgsIFRDYXRhbG9nPiA9IFBhdGggZXh0ZW5kcyBcImNhdGFsb2cuY29tcG9uZW50c1wiXG4gID8gVENhdGFsb2cgZXh0ZW5kcyB7IGNvbXBvbmVudHM6IGluZmVyIEMgfVxuICAgID8ga2V5b2YgQ1xuICAgIDogc3RyaW5nXG4gIDogUGF0aCBleHRlbmRzIFwiY2F0YWxvZy5hY3Rpb25zXCJcbiAgICA/IFRDYXRhbG9nIGV4dGVuZHMgeyBhY3Rpb25zOiBpbmZlciBBIH1cbiAgICAgID8ga2V5b2YgQVxuICAgICAgOiBzdHJpbmdcbiAgICA6IHN0cmluZztcblxudHlwZSBJbmZlclByb3BzT2ZUeXBlPFBhdGgsIFRDYXRhbG9nPiA9IFBhdGggZXh0ZW5kcyBcImNhdGFsb2cuY29tcG9uZW50c1wiXG4gID8gVENhdGFsb2cgZXh0ZW5kcyB7IGNvbXBvbmVudHM6IGluZmVyIEMgfVxuICAgID8gQyBleHRlbmRzIFJlY29yZDxzdHJpbmcsIHsgcHJvcHM6IHouWm9kVHlwZTxpbmZlciBQPiB9PlxuICAgICAgPyBQXG4gICAgICA6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gICAgOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICA6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXG4vKipcbiAqIENyZWF0ZSB0aGUgc2NoZW1hIGJ1aWxkZXJcbiAqL1xuZnVuY3Rpb24gY3JlYXRlQnVpbGRlcigpOiBTY2hlbWFCdWlsZGVyIHtcbiAgcmV0dXJuIHtcbiAgICBzdHJpbmc6ICgpID0+ICh7IGtpbmQ6IFwic3RyaW5nXCIgfSksXG4gICAgbnVtYmVyOiAoKSA9PiAoeyBraW5kOiBcIm51bWJlclwiIH0pLFxuICAgIGJvb2xlYW46ICgpID0+ICh7IGtpbmQ6IFwiYm9vbGVhblwiIH0pLFxuICAgIGFycmF5OiAoaXRlbSkgPT4gKHsga2luZDogXCJhcnJheVwiLCBpbm5lcjogaXRlbSB9KSxcbiAgICBvYmplY3Q6IChzaGFwZSkgPT4gKHsga2luZDogXCJvYmplY3RcIiwgaW5uZXI6IHNoYXBlIH0pLFxuICAgIHJlY29yZDogKHZhbHVlKSA9PiAoeyBraW5kOiBcInJlY29yZFwiLCBpbm5lcjogdmFsdWUgfSksXG4gICAgYW55OiAoKSA9PiAoeyBraW5kOiBcImFueVwiIH0pLFxuICAgIHpvZDogKCkgPT4gKHsga2luZDogXCJ6b2RcIiB9KSxcbiAgICByZWY6IChwYXRoKSA9PiAoeyBraW5kOiBcInJlZlwiLCBpbm5lcjogcGF0aCB9KSxcbiAgICBwcm9wc09mOiAocGF0aCkgPT4gKHsga2luZDogXCJwcm9wc09mXCIsIGlubmVyOiBwYXRoIH0pLFxuICAgIG1hcDogKGVudHJ5U2hhcGUpID0+ICh7IGtpbmQ6IFwibWFwXCIsIGlubmVyOiBlbnRyeVNoYXBlIH0pLFxuICAgIG9wdGlvbmFsOiAoKSA9PiAoeyBvcHRpb25hbDogdHJ1ZSB9KSxcbiAgfTtcbn1cblxuLyoqXG4gKiBEZWZpbmUgYSBzY2hlbWEgdXNpbmcgdGhlIGJ1aWxkZXIgcGF0dGVyblxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmaW5lU2NoZW1hPFREZWYgZXh0ZW5kcyBTY2hlbWFEZWZpbml0aW9uPihcbiAgYnVpbGRlcjogKHM6IFNjaGVtYUJ1aWxkZXIpID0+IFREZWYsXG4gIG9wdGlvbnM/OiBTY2hlbWFPcHRpb25zLFxuKTogU2NoZW1hPFREZWY+IHtcbiAgY29uc3QgcyA9IGNyZWF0ZUJ1aWxkZXIoKTtcbiAgY29uc3QgZGVmaW5pdGlvbiA9IGJ1aWxkZXIocyk7XG5cbiAgcmV0dXJuIHtcbiAgICBkZWZpbml0aW9uLFxuICAgIHByb21wdFRlbXBsYXRlOiBvcHRpb25zPy5wcm9tcHRUZW1wbGF0ZSxcbiAgICBkZWZhdWx0UnVsZXM6IG9wdGlvbnM/LmRlZmF1bHRSdWxlcyxcbiAgICBidWlsdEluQWN0aW9uczogb3B0aW9ucz8uYnVpbHRJbkFjdGlvbnMsXG4gICAgY3JlYXRlQ2F0YWxvZzxUQ2F0YWxvZyBleHRlbmRzIEluZmVyQ2F0YWxvZ0lucHV0PFREZWZbXCJjYXRhbG9nXCJdPj4oXG4gICAgICBjYXRhbG9nOiBUQ2F0YWxvZyxcbiAgICApOiBDYXRhbG9nPFREZWYsIFRDYXRhbG9nPiB7XG4gICAgICByZXR1cm4gY3JlYXRlQ2F0YWxvZ0Zyb21TY2hlbWEodGhpcyBhcyBTY2hlbWE8VERlZj4sIGNhdGFsb2cpO1xuICAgIH0sXG4gIH07XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgY2F0YWxvZyBmcm9tIGEgc2NoZW1hIChpbnRlcm5hbClcbiAqL1xuZnVuY3Rpb24gY3JlYXRlQ2F0YWxvZ0Zyb21TY2hlbWE8VERlZiBleHRlbmRzIFNjaGVtYURlZmluaXRpb24sIFRDYXRhbG9nPihcbiAgc2NoZW1hOiBTY2hlbWE8VERlZj4sXG4gIGNhdGFsb2dEYXRhOiBUQ2F0YWxvZyxcbik6IENhdGFsb2c8VERlZiwgVENhdGFsb2c+IHtcbiAgLy8gRXh0cmFjdCBjb21wb25lbnQgYW5kIGFjdGlvbiBuYW1lc1xuICBjb25zdCBjb21wb25lbnRzID0gKGNhdGFsb2dEYXRhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5jb21wb25lbnRzIGFzXG4gICAgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICAgIHwgdW5kZWZpbmVkO1xuICBjb25zdCBhY3Rpb25zID0gKGNhdGFsb2dEYXRhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5hY3Rpb25zIGFzXG4gICAgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICAgIHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGNvbXBvbmVudE5hbWVzID0gY29tcG9uZW50cyA/IE9iamVjdC5rZXlzKGNvbXBvbmVudHMpIDogW107XG4gIGNvbnN0IGFjdGlvbk5hbWVzID0gYWN0aW9ucyA/IE9iamVjdC5rZXlzKGFjdGlvbnMpIDogW107XG5cbiAgLy8gQnVpbGQgdGhlIFpvZCBzY2hlbWEgZm9yIHZhbGlkYXRpb25cbiAgY29uc3Qgem9kU2NoZW1hID0gYnVpbGRab2RTY2hlbWFGcm9tRGVmaW5pdGlvbihcbiAgICBzY2hlbWEuZGVmaW5pdGlvbixcbiAgICBjYXRhbG9nRGF0YSxcbiAgKTtcblxuICByZXR1cm4ge1xuICAgIHNjaGVtYSxcbiAgICBkYXRhOiBjYXRhbG9nRGF0YSxcbiAgICBjb21wb25lbnROYW1lcyxcbiAgICBhY3Rpb25OYW1lcyxcblxuICAgIHByb21wdChvcHRpb25zOiBQcm9tcHRPcHRpb25zID0ge30pOiBzdHJpbmcge1xuICAgICAgcmV0dXJuIGdlbmVyYXRlUHJvbXB0KHRoaXMsIG9wdGlvbnMpO1xuICAgIH0sXG5cbiAgICBqc29uU2NoZW1hKCk6IG9iamVjdCB7XG4gICAgICByZXR1cm4gem9kVG9Kc29uU2NoZW1hKHpvZFNjaGVtYSk7XG4gICAgfSxcblxuICAgIHZhbGlkYXRlKHNwZWM6IHVua25vd24pOiBTcGVjVmFsaWRhdGlvblJlc3VsdDxJbmZlclNwZWM8VERlZiwgVENhdGFsb2c+PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSB6b2RTY2hlbWEuc2FmZVBhcnNlKHNwZWMpO1xuICAgICAgaWYgKHJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBkYXRhOiByZXN1bHQuZGF0YSBhcyBJbmZlclNwZWM8VERlZiwgVENhdGFsb2c+LFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiByZXN1bHQuZXJyb3IgfTtcbiAgICB9LFxuXG4gICAgem9kU2NoZW1hKCk6IHouWm9kVHlwZTxJbmZlclNwZWM8VERlZiwgVENhdGFsb2c+PiB7XG4gICAgICByZXR1cm4gem9kU2NoZW1hIGFzIHouWm9kVHlwZTxJbmZlclNwZWM8VERlZiwgVENhdGFsb2c+PjtcbiAgICB9LFxuXG4gICAgZ2V0IF9zcGVjVHlwZSgpOiBJbmZlclNwZWM8VERlZiwgVENhdGFsb2c+IHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIl9zcGVjVHlwZSBpcyBvbmx5IGZvciB0eXBlIGluZmVyZW5jZVwiKTtcbiAgICB9LFxuICB9O1xufVxuXG4vKipcbiAqIEJ1aWxkIFpvZCBzY2hlbWEgZnJvbSBzY2hlbWEgZGVmaW5pdGlvblxuICovXG5mdW5jdGlvbiBidWlsZFpvZFNjaGVtYUZyb21EZWZpbml0aW9uKFxuICBkZWZpbml0aW9uOiBTY2hlbWFEZWZpbml0aW9uLFxuICBjYXRhbG9nRGF0YTogdW5rbm93bixcbik6IHouWm9kVHlwZSB7XG4gIHJldHVybiBidWlsZFpvZFR5cGUoZGVmaW5pdGlvbi5zcGVjLCBjYXRhbG9nRGF0YSk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkWm9kVHlwZShzY2hlbWFUeXBlOiBTY2hlbWFUeXBlLCBjYXRhbG9nRGF0YTogdW5rbm93bik6IHouWm9kVHlwZSB7XG4gIHN3aXRjaCAoc2NoZW1hVHlwZS5raW5kKSB7XG4gICAgY2FzZSBcInN0cmluZ1wiOlxuICAgICAgcmV0dXJuIHouc3RyaW5nKCk7XG4gICAgY2FzZSBcIm51bWJlclwiOlxuICAgICAgcmV0dXJuIHoubnVtYmVyKCk7XG4gICAgY2FzZSBcImJvb2xlYW5cIjpcbiAgICAgIHJldHVybiB6LmJvb2xlYW4oKTtcbiAgICBjYXNlIFwiYW55XCI6XG4gICAgICByZXR1cm4gei5hbnkoKTtcbiAgICBjYXNlIFwiYXJyYXlcIjoge1xuICAgICAgY29uc3QgaW5uZXIgPSBidWlsZFpvZFR5cGUoc2NoZW1hVHlwZS5pbm5lciBhcyBTY2hlbWFUeXBlLCBjYXRhbG9nRGF0YSk7XG4gICAgICByZXR1cm4gei5hcnJheShpbm5lcik7XG4gICAgfVxuICAgIGNhc2UgXCJvYmplY3RcIjoge1xuICAgICAgY29uc3Qgc2hhcGUgPSBzY2hlbWFUeXBlLmlubmVyIGFzIFJlY29yZDxzdHJpbmcsIFNjaGVtYVR5cGU+O1xuICAgICAgY29uc3Qgem9kU2hhcGU6IFJlY29yZDxzdHJpbmcsIHouWm9kVHlwZT4gPSB7fTtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNoYXBlKSkge1xuICAgICAgICBsZXQgem9kVHlwZSA9IGJ1aWxkWm9kVHlwZSh2YWx1ZSwgY2F0YWxvZ0RhdGEpO1xuICAgICAgICBpZiAodmFsdWUub3B0aW9uYWwpIHtcbiAgICAgICAgICB6b2RUeXBlID0gem9kVHlwZS5vcHRpb25hbCgpO1xuICAgICAgICB9XG4gICAgICAgIHpvZFNoYXBlW2tleV0gPSB6b2RUeXBlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHoub2JqZWN0KHpvZFNoYXBlKTtcbiAgICB9XG4gICAgY2FzZSBcInJlY29yZFwiOiB7XG4gICAgICBjb25zdCBpbm5lciA9IGJ1aWxkWm9kVHlwZShzY2hlbWFUeXBlLmlubmVyIGFzIFNjaGVtYVR5cGUsIGNhdGFsb2dEYXRhKTtcbiAgICAgIHJldHVybiB6LnJlY29yZCh6LnN0cmluZygpLCBpbm5lcik7XG4gICAgfVxuICAgIGNhc2UgXCJyZWZcIjoge1xuICAgICAgLy8gUmVmZXJlbmNlIHRvIGNhdGFsb2cga2V5IC0gY3JlYXRlIGVudW0gb2YgdmFsaWQga2V5c1xuICAgICAgY29uc3QgcGF0aCA9IHNjaGVtYVR5cGUuaW5uZXIgYXMgc3RyaW5nO1xuICAgICAgY29uc3Qga2V5cyA9IGdldEtleXNGcm9tUGF0aChwYXRoLCBjYXRhbG9nRGF0YSk7XG4gICAgICBpZiAoa2V5cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHouc3RyaW5nKCk7XG4gICAgICB9XG4gICAgICBpZiAoa2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgcmV0dXJuIHoubGl0ZXJhbChrZXlzWzBdISk7XG4gICAgICB9XG4gICAgICByZXR1cm4gei5lbnVtKGtleXMgYXMgW3N0cmluZywgLi4uc3RyaW5nW11dKTtcbiAgICB9XG4gICAgY2FzZSBcInByb3BzT2ZcIjoge1xuICAgICAgLy8gUHJvcHMgZnJvbSBjYXRhbG9nIGVudHJ5IC0gY3JlYXRlIHVuaW9uIG9mIGFsbCBwcm9wcyBzY2hlbWFzXG4gICAgICBjb25zdCBwYXRoID0gc2NoZW1hVHlwZS5pbm5lciBhcyBzdHJpbmc7XG4gICAgICBjb25zdCBwcm9wc1NjaGVtYXMgPSBnZXRQcm9wc0Zyb21QYXRoKHBhdGgsIGNhdGFsb2dEYXRhKTtcbiAgICAgIGlmIChwcm9wc1NjaGVtYXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiB6LnJlY29yZCh6LnN0cmluZygpLCB6LnVua25vd24oKSk7XG4gICAgICB9XG4gICAgICBpZiAocHJvcHNTY2hlbWFzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICByZXR1cm4gcHJvcHNTY2hlbWFzWzBdITtcbiAgICAgIH1cbiAgICAgIC8vIEZvciBwcm9wc09mLCB3ZSBuZWVkIHRvIGJlIGxlbmllbnQgc2luY2UgdHlwZSBkZXRlcm1pbmVzIHdoaWNoIHByb3BzIGFwcGx5XG4gICAgICByZXR1cm4gei5yZWNvcmQoei5zdHJpbmcoKSwgei51bmtub3duKCkpO1xuICAgIH1cbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHoudW5rbm93bigpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGdldEtleXNGcm9tUGF0aChwYXRoOiBzdHJpbmcsIGNhdGFsb2dEYXRhOiB1bmtub3duKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoXCIuXCIpO1xuICBsZXQgY3VycmVudDogdW5rbm93biA9IHsgY2F0YWxvZzogY2F0YWxvZ0RhdGEgfTtcbiAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgaWYgKGN1cnJlbnQgJiYgdHlwZW9mIGN1cnJlbnQgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGN1cnJlbnQgPSAoY3VycmVudCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilbcGFydF07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH1cbiAgaWYgKGN1cnJlbnQgJiYgdHlwZW9mIGN1cnJlbnQgPT09IFwib2JqZWN0XCIpIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXMoY3VycmVudCk7XG4gIH1cbiAgcmV0dXJuIFtdO1xufVxuXG5mdW5jdGlvbiBnZXRQcm9wc0Zyb21QYXRoKHBhdGg6IHN0cmluZywgY2F0YWxvZ0RhdGE6IHVua25vd24pOiB6LlpvZFR5cGVbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdChcIi5cIik7XG4gIGxldCBjdXJyZW50OiB1bmtub3duID0geyBjYXRhbG9nOiBjYXRhbG9nRGF0YSB9O1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICBpZiAoY3VycmVudCAmJiB0eXBlb2YgY3VycmVudCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgY3VycmVudCA9IChjdXJyZW50IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVtwYXJ0XTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfVxuICBpZiAoY3VycmVudCAmJiB0eXBlb2YgY3VycmVudCA9PT0gXCJvYmplY3RcIikge1xuICAgIHJldHVybiBPYmplY3QudmFsdWVzKGN1cnJlbnQgYXMgUmVjb3JkPHN0cmluZywgeyBwcm9wcz86IHouWm9kVHlwZSB9PilcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5wcm9wcylcbiAgICAgIC5maWx0ZXIoKHByb3BzKTogcHJvcHMgaXMgei5ab2RUeXBlID0+IHByb3BzICE9PSB1bmRlZmluZWQpO1xuICB9XG4gIHJldHVybiBbXTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBzeXN0ZW0gcHJvbXB0IGZyb20gY2F0YWxvZ1xuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVByb21wdDxURGVmIGV4dGVuZHMgU2NoZW1hRGVmaW5pdGlvbiwgVENhdGFsb2c+KFxuICBjYXRhbG9nOiBDYXRhbG9nPFREZWYsIFRDYXRhbG9nPixcbiAgb3B0aW9uczogUHJvbXB0T3B0aW9ucyxcbik6IHN0cmluZyB7XG4gIC8vIENoZWNrIGlmIHNjaGVtYSBoYXMgYSBjdXN0b20gcHJvbXB0IHRlbXBsYXRlXG4gIGlmIChjYXRhbG9nLnNjaGVtYS5wcm9tcHRUZW1wbGF0ZSkge1xuICAgIGNvbnN0IGNvbnRleHQ6IFByb21wdENvbnRleHQ8VENhdGFsb2c+ID0ge1xuICAgICAgY2F0YWxvZzogY2F0YWxvZy5kYXRhLFxuICAgICAgY29tcG9uZW50TmFtZXM6IGNhdGFsb2cuY29tcG9uZW50TmFtZXMsXG4gICAgICBhY3Rpb25OYW1lczogY2F0YWxvZy5hY3Rpb25OYW1lcyxcbiAgICAgIG9wdGlvbnMsXG4gICAgICBmb3JtYXRab2RUeXBlLFxuICAgIH07XG4gICAgcmV0dXJuIGNhdGFsb2cuc2NoZW1hLnByb21wdFRlbXBsYXRlKGNvbnRleHQpO1xuICB9XG5cbiAgLy8gRGVmYXVsdCBKU09OTCBlbGVtZW50LXRyZWUgZm9ybWF0IChmb3IgQGpzb24tcmVuZGVyL3JlYWN0IGFuZCBzaW1pbGFyKVxuICBjb25zdCB7XG4gICAgc3lzdGVtID0gXCJZb3UgYXJlIGEgVUkgZ2VuZXJhdG9yIHRoYXQgb3V0cHV0cyBKU09OLlwiLFxuICAgIGN1c3RvbVJ1bGVzID0gW10sXG4gICAgbW9kZSA9IFwiZ2VuZXJhdGVcIixcbiAgfSA9IG9wdGlvbnM7XG5cbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG4gIGxpbmVzLnB1c2goc3lzdGVtKTtcbiAgbGluZXMucHVzaChcIlwiKTtcblxuICAvLyBPdXRwdXQgZm9ybWF0IHNlY3Rpb24gLSBleHBsYWluIEpTT05MIHN0cmVhbWluZyBwYXRjaCBmb3JtYXRcbiAgaWYgKG1vZGUgPT09IFwiY2hhdFwiKSB7XG4gICAgbGluZXMucHVzaChcIk9VVFBVVCBGT1JNQVQgKHRleHQgKyBKU09OTCwgUkZDIDY5MDIgSlNPTiBQYXRjaCk6XCIpO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBcIllvdSByZXNwb25kIGNvbnZlcnNhdGlvbmFsbHkuIFdoZW4gZ2VuZXJhdGluZyBVSSwgZmlyc3Qgd3JpdGUgYSBicmllZiBleHBsYW5hdGlvbiAoMS0zIHNlbnRlbmNlcyksIHRoZW4gb3V0cHV0IEpTT05MIHBhdGNoIGxpbmVzIHdyYXBwZWQgaW4gYSBgYGBzcGVjIGNvZGUgZmVuY2UuXCIsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgXCJUaGUgSlNPTkwgbGluZXMgdXNlIFJGQyA2OTAyIEpTT04gUGF0Y2ggb3BlcmF0aW9ucyB0byBidWlsZCBhIFVJIHRyZWUuIEFsd2F5cyB3cmFwIHRoZW0gaW4gYSBgYGBzcGVjIGZlbmNlIGJsb2NrOlwiLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcIiAgYGBgc3BlY1wiKTtcbiAgICBsaW5lcy5wdXNoKCcgIHtcIm9wXCI6XCJhZGRcIixcInBhdGhcIjpcIi9yb290XCIsXCJ2YWx1ZVwiOlwibWFpblwifScpO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICAnICB7XCJvcFwiOlwiYWRkXCIsXCJwYXRoXCI6XCIvZWxlbWVudHMvbWFpblwiLFwidmFsdWVcIjp7XCJ0eXBlXCI6XCJDYXJkXCIsXCJwcm9wc1wiOntcInRpdGxlXCI6XCJIZWxsb1wifSxcImNoaWxkcmVuXCI6W119fScsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFwiICBgYGBcIik7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiSWYgdGhlIHVzZXIncyBtZXNzYWdlIGRvZXMgbm90IHJlcXVpcmUgYSBVSSAoZS5nLiBhIGdyZWV0aW5nIG9yIGNsYXJpZnlpbmcgcXVlc3Rpb24pLCByZXNwb25kIHdpdGggdGV4dCBvbmx5IOKAlCBubyBKU09OTC5cIixcbiAgICApO1xuICB9IGVsc2Uge1xuICAgIGxpbmVzLnB1c2goXCJPVVRQVVQgRk9STUFUIChKU09OTCwgUkZDIDY5MDIgSlNPTiBQYXRjaCk6XCIpO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBcIk91dHB1dCBKU09OTCAob25lIEpTT04gb2JqZWN0IHBlciBsaW5lKSB1c2luZyBSRkMgNjkwMiBKU09OIFBhdGNoIG9wZXJhdGlvbnMgdG8gYnVpbGQgYSBVSSB0cmVlLlwiLFxuICAgICk7XG4gIH1cbiAgbGluZXMucHVzaChcbiAgICBcIkVhY2ggbGluZSBpcyBhIEpTT04gcGF0Y2ggb3BlcmF0aW9uIChhZGQsIHJlbW92ZSwgcmVwbGFjZSkuIFN0YXJ0IHdpdGggL3Jvb3QsIHRoZW4gc3RyZWFtIC9lbGVtZW50cyBhbmQgL3N0YXRlIHBhdGNoZXMgaW50ZXJsZWF2ZWQgc28gdGhlIFVJIGZpbGxzIGluIHByb2dyZXNzaXZlbHkgYXMgaXQgc3RyZWFtcy5cIixcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcbiAgbGluZXMucHVzaChcIkV4YW1wbGUgb3V0cHV0IChlYWNoIGxpbmUgaXMgYSBzZXBhcmF0ZSBKU09OIG9iamVjdCk6XCIpO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuXG4gIC8vIEJ1aWxkIGV4YW1wbGUgdXNpbmcgYWN0dWFsIGNhdGFsb2cgY29tcG9uZW50IG5hbWVzIGFuZCBwcm9wcyB0byBhdm9pZCBoYWxsdWNpbmF0aW9uc1xuICBjb25zdCBhbGxDb21wb25lbnRzID0gKGNhdGFsb2cuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuY29tcG9uZW50cyBhc1xuICAgIHwgUmVjb3JkPHN0cmluZywgQ2F0YWxvZ0NvbXBvbmVudERlZj5cbiAgICB8IHVuZGVmaW5lZDtcbiAgY29uc3QgY24gPSBjYXRhbG9nLmNvbXBvbmVudE5hbWVzO1xuICBjb25zdCBjb21wMSA9IGNuWzBdIHx8IFwiQ29tcG9uZW50XCI7XG4gIGNvbnN0IGNvbXAyID0gY24ubGVuZ3RoID4gMSA/IGNuWzFdISA6IGNvbXAxO1xuICBjb25zdCBjb21wMURlZiA9IGFsbENvbXBvbmVudHM/Lltjb21wMV07XG4gIGNvbnN0IGNvbXAyRGVmID0gYWxsQ29tcG9uZW50cz8uW2NvbXAyXTtcbiAgY29uc3QgY29tcDFQcm9wcyA9IGNvbXAxRGVmID8gZ2V0RXhhbXBsZVByb3BzKGNvbXAxRGVmKSA6IHt9O1xuICBjb25zdCBjb21wMlByb3BzID0gY29tcDJEZWYgPyBnZXRFeGFtcGxlUHJvcHMoY29tcDJEZWYpIDoge307XG5cbiAgLy8gRmluZCBhIHN0cmluZyBwcm9wIG9uIGNvbXAyIHRvIGRlbW9uc3RyYXRlICRzdGF0ZSBkeW5hbWljIGJpbmRpbmdzXG4gIGNvbnN0IGR5bmFtaWNQcm9wTmFtZSA9IGNvbXAyRGVmPy5wcm9wc1xuICAgID8gZmluZEZpcnN0U3RyaW5nUHJvcChjb21wMkRlZi5wcm9wcylcbiAgICA6IG51bGw7XG4gIGNvbnN0IGR5bmFtaWNQcm9wcyA9IGR5bmFtaWNQcm9wTmFtZVxuICAgID8geyAuLi5jb21wMlByb3BzLCBbZHluYW1pY1Byb3BOYW1lXTogeyAkaXRlbTogXCJ0aXRsZVwiIH0gfVxuICAgIDogY29tcDJQcm9wcztcblxuICBjb25zdCBleGFtcGxlT3V0cHV0ID0gW1xuICAgIEpTT04uc3RyaW5naWZ5KHsgb3A6IFwiYWRkXCIsIHBhdGg6IFwiL3Jvb3RcIiwgdmFsdWU6IFwibWFpblwiIH0pLFxuICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIG9wOiBcImFkZFwiLFxuICAgICAgcGF0aDogXCIvZWxlbWVudHMvbWFpblwiLFxuICAgICAgdmFsdWU6IHtcbiAgICAgICAgdHlwZTogY29tcDEsXG4gICAgICAgIHByb3BzOiBjb21wMVByb3BzLFxuICAgICAgICBjaGlsZHJlbjogW1wiY2hpbGQtMVwiLCBcImxpc3RcIl0sXG4gICAgICB9LFxuICAgIH0pLFxuICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIG9wOiBcImFkZFwiLFxuICAgICAgcGF0aDogXCIvZWxlbWVudHMvY2hpbGQtMVwiLFxuICAgICAgdmFsdWU6IHsgdHlwZTogY29tcDIsIHByb3BzOiBjb21wMlByb3BzLCBjaGlsZHJlbjogW10gfSxcbiAgICB9KSxcbiAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBvcDogXCJhZGRcIixcbiAgICAgIHBhdGg6IFwiL2VsZW1lbnRzL2xpc3RcIixcbiAgICAgIHZhbHVlOiB7XG4gICAgICAgIHR5cGU6IGNvbXAxLFxuICAgICAgICBwcm9wczogY29tcDFQcm9wcyxcbiAgICAgICAgcmVwZWF0OiB7IHN0YXRlUGF0aDogXCIvaXRlbXNcIiwga2V5OiBcImlkXCIgfSxcbiAgICAgICAgY2hpbGRyZW46IFtcIml0ZW1cIl0sXG4gICAgICB9LFxuICAgIH0pLFxuICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIG9wOiBcImFkZFwiLFxuICAgICAgcGF0aDogXCIvZWxlbWVudHMvaXRlbVwiLFxuICAgICAgdmFsdWU6IHsgdHlwZTogY29tcDIsIHByb3BzOiBkeW5hbWljUHJvcHMsIGNoaWxkcmVuOiBbXSB9LFxuICAgIH0pLFxuICAgIEpTT04uc3RyaW5naWZ5KHsgb3A6IFwiYWRkXCIsIHBhdGg6IFwiL3N0YXRlL2l0ZW1zXCIsIHZhbHVlOiBbXSB9KSxcbiAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBvcDogXCJhZGRcIixcbiAgICAgIHBhdGg6IFwiL3N0YXRlL2l0ZW1zLzBcIixcbiAgICAgIHZhbHVlOiB7IGlkOiBcIjFcIiwgdGl0bGU6IFwiRmlyc3QgSXRlbVwiIH0sXG4gICAgfSksXG4gICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgb3A6IFwiYWRkXCIsXG4gICAgICBwYXRoOiBcIi9zdGF0ZS9pdGVtcy8xXCIsXG4gICAgICB2YWx1ZTogeyBpZDogXCIyXCIsIHRpdGxlOiBcIlNlY29uZCBJdGVtXCIgfSxcbiAgICB9KSxcbiAgXS5qb2luKFwiXFxuXCIpO1xuXG4gIGxpbmVzLnB1c2goYCR7ZXhhbXBsZU91dHB1dH1cblxuTm90ZTogc3RhdGUgcGF0Y2hlcyBhcHBlYXIgcmlnaHQgYWZ0ZXIgdGhlIGVsZW1lbnRzIHRoYXQgdXNlIHRoZW0sIHNvIHRoZSBVSSBmaWxscyBpbiBhcyBpdCBzdHJlYW1zLiBPTkxZIHVzZSBjb21wb25lbnQgdHlwZXMgZnJvbSB0aGUgQVZBSUxBQkxFIENPTVBPTkVOVFMgbGlzdCBiZWxvdy5gKTtcbiAgbGluZXMucHVzaChcIlwiKTtcblxuICAvLyBJbml0aWFsIHN0YXRlIHNlY3Rpb25cbiAgbGluZXMucHVzaChcIklOSVRJQUwgU1RBVEU6XCIpO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiU3BlY3MgaW5jbHVkZSBhIC9zdGF0ZSBmaWVsZCB0byBzZWVkIHRoZSBzdGF0ZSBtb2RlbC4gQ29tcG9uZW50cyB3aXRoIHsgJGJpbmRTdGF0ZSB9IG9yIHsgJGJpbmRJdGVtIH0gcmVhZCBmcm9tIGFuZCB3cml0ZSB0byB0aGlzIHN0YXRlLCBhbmQgJHN0YXRlIGV4cHJlc3Npb25zIHJlYWQgZnJvbSBpdC5cIixcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICBcIkNSSVRJQ0FMOiBZb3UgTVVTVCBpbmNsdWRlIHN0YXRlIHBhdGNoZXMgd2hlbmV2ZXIgeW91ciBVSSBkaXNwbGF5cyBkYXRhIHZpYSAkc3RhdGUsICRiaW5kU3RhdGUsICRiaW5kSXRlbSwgJGl0ZW0sIG9yICRpbmRleCBleHByZXNzaW9ucywgb3IgdXNlcyByZXBlYXQgdG8gaXRlcmF0ZSBvdmVyIGFycmF5cy4gV2l0aG91dCBzdGF0ZSwgdGhlc2UgcmVmZXJlbmNlcyByZXNvbHZlIHRvIG5vdGhpbmcgYW5kIHJlcGVhdCBsaXN0cyByZW5kZXIgemVybyBpdGVtcy5cIixcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICBcIk91dHB1dCBzdGF0ZSBwYXRjaGVzIHJpZ2h0IGFmdGVyIHRoZSBlbGVtZW50cyB0aGF0IHJlZmVyZW5jZSB0aGVtLCBzbyB0aGUgVUkgZmlsbHMgaW4gcHJvZ3Jlc3NpdmVseSBhcyBpdCBzdHJlYW1zLlwiLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiU3RyZWFtIHN0YXRlIHByb2dyZXNzaXZlbHkgLSBvdXRwdXQgb25lIHBhdGNoIHBlciBhcnJheSBpdGVtIGluc3RlYWQgb2Ygb25lIGdpYW50IGJsb2I6XCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJyAgRm9yIGFycmF5czoge1wib3BcIjpcImFkZFwiLFwicGF0aFwiOlwiL3N0YXRlL3Bvc3RzLzBcIixcInZhbHVlXCI6e1wiaWRcIjpcIjFcIixcInRpdGxlXCI6XCJGaXJzdCBQb3N0XCIsLi4ufX0gdGhlbiAvc3RhdGUvcG9zdHMvMSwgL3N0YXRlL3Bvc3RzLzIsIGV0Yy4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICcgIEZvciBzY2FsYXJzOiB7XCJvcFwiOlwiYWRkXCIsXCJwYXRoXCI6XCIvc3RhdGUvbmV3VG9kb1RleHRcIixcInZhbHVlXCI6XCJcIn0nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICcgIEluaXRpYWxpemUgdGhlIGFycmF5IGZpcnN0IGlmIG5lZWRlZDoge1wib3BcIjpcImFkZFwiLFwicGF0aFwiOlwiL3N0YXRlL3Bvc3RzXCIsXCJ2YWx1ZVwiOltdfScsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJ1doZW4gY29udGVudCBjb21lcyBmcm9tIHRoZSBzdGF0ZSBtb2RlbCwgdXNlIHsgXCIkc3RhdGVcIjogXCIvc29tZS9wYXRoXCIgfSBkeW5hbWljIHByb3BzIHRvIGRpc3BsYXkgaXQgaW5zdGVhZCBvZiBoYXJkY29kaW5nIHRoZSBzYW1lIHZhbHVlIGluIGJvdGggc3RhdGUgYW5kIHByb3BzLiBUaGUgc3RhdGUgbW9kZWwgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGguJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICBcIkluY2x1ZGUgcmVhbGlzdGljIHNhbXBsZSBkYXRhIGluIHN0YXRlLiBGb3IgYmxvZ3M6IDMtNCBwb3N0cyB3aXRoIHRpdGxlcywgZXhjZXJwdHMsIGF1dGhvcnMsIGRhdGVzLiBGb3IgcHJvZHVjdCBsaXN0czogMy01IGl0ZW1zIHdpdGggbmFtZXMsIHByaWNlcywgZGVzY3JpcHRpb25zLiBOZXZlciBsZWF2ZSBhcnJheXMgZW1wdHkuXCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG4gIGxpbmVzLnB1c2goXCJEWU5BTUlDIExJU1RTIChyZXBlYXQgZmllbGQpOlwiKTtcbiAgbGluZXMucHVzaChcbiAgICAnQW55IGVsZW1lbnQgY2FuIGhhdmUgYSB0b3AtbGV2ZWwgXCJyZXBlYXRcIiBmaWVsZCB0byByZW5kZXIgaXRzIGNoaWxkcmVuIG9uY2UgcGVyIGl0ZW0gaW4gYSBzdGF0ZSBhcnJheTogeyBcInJlcGVhdFwiOiB7IFwic3RhdGVQYXRoXCI6IFwiL2FycmF5UGF0aFwiLCBcImtleVwiOiBcImlkXCIgfSB9LicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJ1RoZSBlbGVtZW50IGl0c2VsZiByZW5kZXJzIG9uY2UgKGFzIHRoZSBjb250YWluZXIpLCBhbmQgaXRzIGNoaWxkcmVuIGFyZSBleHBhbmRlZCBvbmNlIHBlciBhcnJheSBpdGVtLiBcInN0YXRlUGF0aFwiIGlzIHRoZSBzdGF0ZSBhcnJheSBwYXRoLiBcImtleVwiIGlzIGFuIG9wdGlvbmFsIGZpZWxkIG5hbWUgb24gZWFjaCBpdGVtIGZvciBzdGFibGUgUmVhY3Qga2V5cy4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIGBFeGFtcGxlOiAke0pTT04uc3RyaW5naWZ5KHsgdHlwZTogY29tcDEsIHByb3BzOiBjb21wMVByb3BzLCByZXBlYXQ6IHsgc3RhdGVQYXRoOiBcIi90b2Rvc1wiLCBrZXk6IFwiaWRcIiB9LCBjaGlsZHJlbjogW1widG9kby1pdGVtXCJdIH0pfWAsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJ0luc2lkZSBjaGlsZHJlbiBvZiBhIHJlcGVhdGVkIGVsZW1lbnQsIHVzZSB7IFwiJGl0ZW1cIjogXCJmaWVsZFwiIH0gdG8gcmVhZCBhIGZpZWxkIGZyb20gdGhlIGN1cnJlbnQgaXRlbSwgYW5kIHsgXCIkaW5kZXhcIjogdHJ1ZSB9IHRvIGdldCB0aGUgY3VycmVudCBhcnJheSBpbmRleC4gRm9yIHR3by13YXkgYmluZGluZyB0byBhbiBpdGVtIGZpZWxkIHVzZSB7IFwiJGJpbmRJdGVtXCI6IFwiY29tcGxldGVkXCIgfSBvbiB0aGUgYXBwcm9wcmlhdGUgcHJvcC4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiQUxXQVlTIHVzZSB0aGUgcmVwZWF0IGZpZWxkIGZvciBsaXN0cyBiYWNrZWQgYnkgc3RhdGUgYXJyYXlzLiBORVZFUiBoYXJkY29kZSBpbmRpdmlkdWFsIGVsZW1lbnRzIGZvciBlYWNoIGFycmF5IGl0ZW0uXCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJ0lNUE9SVEFOVDogXCJyZXBlYXRcIiBpcyBhIHRvcC1sZXZlbCBmaWVsZCBvbiB0aGUgZWxlbWVudCAoc2libGluZyBvZiB0eXBlL3Byb3BzL2NoaWxkcmVuKSwgTk9UIGluc2lkZSBwcm9wcy4nLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFwiQVJSQVkgU1RBVEUgQUNUSU9OUzpcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgJ1VzZSBhY3Rpb24gXCJwdXNoU3RhdGVcIiB0byBhcHBlbmQgaXRlbXMgdG8gYXJyYXlzLiBQYXJhbXM6IHsgc3RhdGVQYXRoOiBcIi9hcnJheVBhdGhcIiwgdmFsdWU6IHsgLi4uaXRlbSB9LCBjbGVhclN0YXRlUGF0aDogXCIvaW5wdXRQYXRoXCIgfS4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICdWYWx1ZXMgaW5zaWRlIHB1c2hTdGF0ZSBjYW4gY29udGFpbiB7IFwiJHN0YXRlXCI6IFwiL3N0YXRlUGF0aFwiIH0gcmVmZXJlbmNlcyB0byByZWFkIGN1cnJlbnQgc3RhdGUgKGUuZy4gdGhlIHRleHQgZnJvbSBhbiBpbnB1dCBmaWVsZCkuJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnVXNlIFwiJGlkXCIgaW5zaWRlIGEgcHVzaFN0YXRlIHZhbHVlIHRvIGF1dG8tZ2VuZXJhdGUgYSB1bmlxdWUgSUQuJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnRXhhbXBsZTogb246IHsgXCJwcmVzc1wiOiB7IFwiYWN0aW9uXCI6IFwicHVzaFN0YXRlXCIsIFwicGFyYW1zXCI6IHsgXCJzdGF0ZVBhdGhcIjogXCIvdG9kb3NcIiwgXCJ2YWx1ZVwiOiB7IFwiaWRcIjogXCIkaWRcIiwgXCJ0aXRsZVwiOiB7IFwiJHN0YXRlXCI6IFwiL25ld1RvZG9UZXh0XCIgfSwgXCJjb21wbGV0ZWRcIjogZmFsc2UgfSwgXCJjbGVhclN0YXRlUGF0aFwiOiBcIi9uZXdUb2RvVGV4dFwiIH0gfSB9JyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnVXNlIGFjdGlvbiBcInJlbW92ZVN0YXRlXCIgdG8gcmVtb3ZlIGl0ZW1zIGZyb20gYXJyYXlzIGJ5IGluZGV4LiBQYXJhbXM6IHsgc3RhdGVQYXRoOiBcIi9hcnJheVBhdGhcIiwgaW5kZXg6IE4gfS4gSW5zaWRlIGEgcmVwZWF0ZWQgZWxlbWVudFxcJ3MgY2hpbGRyZW4sIHVzZSB7IFwiJGluZGV4XCI6IHRydWUgfSBmb3IgdGhlIGN1cnJlbnQgaXRlbSBpbmRleC4gQWN0aW9uIHBhcmFtcyBzdXBwb3J0IHRoZSBzYW1lIGV4cHJlc3Npb25zIGFzIHByb3BzOiB7IFwiJGl0ZW1cIjogXCJmaWVsZFwiIH0gcmVzb2x2ZXMgdG8gdGhlIGFic29sdXRlIHN0YXRlIHBhdGgsIHsgXCIkaW5kZXhcIjogdHJ1ZSB9IHJlc29sdmVzIHRvIHRoZSBpbmRleCBudW1iZXIsIGFuZCB7IFwiJHN0YXRlXCI6IFwiL3BhdGhcIiB9IHJlYWRzIGEgdmFsdWUgZnJvbSBzdGF0ZS4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiRm9yIGxpc3RzIHdoZXJlIHVzZXJzIGNhbiBhZGQvcmVtb3ZlIGl0ZW1zICh0b2RvcywgY2FydHMsIGV0Yy4pLCB1c2UgcHVzaFN0YXRlIGFuZCByZW1vdmVTdGF0ZSBpbnN0ZWFkIG9mIGhhcmRjb2Rpbmcgd2l0aCBzZXRTdGF0ZS5cIixcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcbiAgbGluZXMucHVzaChcbiAgICAnSU1QT1JUQU5UOiBTdGF0ZSBwYXRocyB1c2UgUkZDIDY5MDEgSlNPTiBQb2ludGVyIHN5bnRheCAoZS5nLiBcIi90b2Rvcy8wL3RpdGxlXCIpLiBEbyBOT1QgdXNlIEphdmFTY3JpcHQtc3R5bGUgZG90IG5vdGF0aW9uIChlLmcuIFwiL3RvZG9zLmxlbmd0aFwiIGlzIFdST05HKS4gVG8gZ2VuZXJhdGUgdW5pcXVlIElEcyBmb3IgbmV3IGl0ZW1zLCB1c2UgXCIkaWRcIiBpbnN0ZWFkIG9mIHRyeWluZyB0byByZWFkIGFycmF5IGxlbmd0aC4nLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuXG4gIC8vIENvbXBvbmVudHMgc2VjdGlvbiDigJQgcmV1c2UgdGhlIHR5cGVkIHJlZmVyZW5jZSBmcm9tIGV4YW1wbGUgZ2VuZXJhdGlvblxuICBjb25zdCBjb21wb25lbnRzID0gYWxsQ29tcG9uZW50cztcblxuICBpZiAoY29tcG9uZW50cykge1xuICAgIGxpbmVzLnB1c2goYEFWQUlMQUJMRSBDT01QT05FTlRTICgke2NhdGFsb2cuY29tcG9uZW50TmFtZXMubGVuZ3RofSk6YCk7XG4gICAgbGluZXMucHVzaChcIlwiKTtcblxuICAgIGZvciAoY29uc3QgW25hbWUsIGRlZl0gb2YgT2JqZWN0LmVudHJpZXMoY29tcG9uZW50cykpIHtcbiAgICAgIGNvbnN0IHByb3BzU3RyID0gZGVmLnByb3BzID8gZm9ybWF0Wm9kVHlwZShkZWYucHJvcHMpIDogXCJ7fVwiO1xuICAgICAgY29uc3QgaGFzQ2hpbGRyZW4gPSBkZWYuc2xvdHMgJiYgZGVmLnNsb3RzLmxlbmd0aCA+IDA7XG4gICAgICBjb25zdCBjaGlsZHJlblN0ciA9IGhhc0NoaWxkcmVuID8gXCIgW2FjY2VwdHMgY2hpbGRyZW5dXCIgOiBcIlwiO1xuICAgICAgY29uc3QgZXZlbnRzU3RyID1cbiAgICAgICAgZGVmLmV2ZW50cyAmJiBkZWYuZXZlbnRzLmxlbmd0aCA+IDBcbiAgICAgICAgICA/IGAgW2V2ZW50czogJHtkZWYuZXZlbnRzLmpvaW4oXCIsIFwiKX1dYFxuICAgICAgICAgIDogXCJcIjtcbiAgICAgIGNvbnN0IGRlc2NTdHIgPSBkZWYuZGVzY3JpcHRpb24gPyBgIC0gJHtkZWYuZGVzY3JpcHRpb259YCA6IFwiXCI7XG4gICAgICBsaW5lcy5wdXNoKGAtICR7bmFtZX06ICR7cHJvcHNTdHJ9JHtkZXNjU3RyfSR7Y2hpbGRyZW5TdHJ9JHtldmVudHNTdHJ9YCk7XG4gICAgfVxuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gIH1cblxuICAvLyBBY3Rpb25zIHNlY3Rpb25cbiAgY29uc3QgYWN0aW9ucyA9IChjYXRhbG9nLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmFjdGlvbnMgYXNcbiAgICB8IFJlY29yZDxzdHJpbmcsIHsgcGFyYW1zPzogei5ab2RUeXBlOyBkZXNjcmlwdGlvbj86IHN0cmluZyB9PlxuICAgIHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGJ1aWx0SW5BY3Rpb25zID0gY2F0YWxvZy5zY2hlbWEuYnVpbHRJbkFjdGlvbnMgPz8gW107XG4gIGNvbnN0IGhhc0N1c3RvbUFjdGlvbnMgPSBhY3Rpb25zICYmIGNhdGFsb2cuYWN0aW9uTmFtZXMubGVuZ3RoID4gMDtcbiAgY29uc3QgaGFzQnVpbHRJbkFjdGlvbnMgPSBidWlsdEluQWN0aW9ucy5sZW5ndGggPiAwO1xuXG4gIGlmIChoYXNDdXN0b21BY3Rpb25zIHx8IGhhc0J1aWx0SW5BY3Rpb25zKSB7XG4gICAgbGluZXMucHVzaChcIkFWQUlMQUJMRSBBQ1RJT05TOlwiKTtcbiAgICBsaW5lcy5wdXNoKFwiXCIpO1xuXG4gICAgLy8gQnVpbHQtaW4gYWN0aW9ucyAoaGFuZGxlZCBieSBydW50aW1lLCBhbHdheXMgYXZhaWxhYmxlKVxuICAgIGZvciAoY29uc3QgYWN0aW9uIG9mIGJ1aWx0SW5BY3Rpb25zKSB7XG4gICAgICBsaW5lcy5wdXNoKGAtICR7YWN0aW9uLm5hbWV9OiAke2FjdGlvbi5kZXNjcmlwdGlvbn0gW2J1aWx0LWluXWApO1xuICAgIH1cblxuICAgIC8vIEN1c3RvbSBhY3Rpb25zIChkZWNsYXJlZCBpbiBjYXRhbG9nLCByZXF1aXJlIGhhbmRsZXJzKVxuICAgIGlmIChoYXNDdXN0b21BY3Rpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IFtuYW1lLCBkZWZdIG9mIE9iamVjdC5lbnRyaWVzKGFjdGlvbnMpKSB7XG4gICAgICAgIGxpbmVzLnB1c2goYC0gJHtuYW1lfSR7ZGVmLmRlc2NyaXB0aW9uID8gYDogJHtkZWYuZGVzY3JpcHRpb259YCA6IFwiXCJ9YCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGluZXMucHVzaChcIlwiKTtcbiAgfVxuXG4gIC8vIEV2ZW50cyBzZWN0aW9uXG4gIGxpbmVzLnB1c2goXCJFVkVOVFMgKHRoZSBgb25gIGZpZWxkKTpcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgXCJFbGVtZW50cyBjYW4gaGF2ZSBhbiBvcHRpb25hbCBgb25gIGZpZWxkIHRvIGJpbmQgZXZlbnRzIHRvIGFjdGlvbnMuIFRoZSBgb25gIGZpZWxkIGlzIGEgdG9wLWxldmVsIGZpZWxkIG9uIHRoZSBlbGVtZW50IChzaWJsaW5nIG9mIHR5cGUvcHJvcHMvY2hpbGRyZW4pLCBOT1QgaW5zaWRlIHByb3BzLlwiLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICdFYWNoIGtleSBpbiBgb25gIGlzIGFuIGV2ZW50IG5hbWUgKGZyb20gdGhlIGNvbXBvbmVudFxcJ3Mgc3VwcG9ydGVkIGV2ZW50cyksIGFuZCB0aGUgdmFsdWUgaXMgYW4gYWN0aW9uIGJpbmRpbmc6IGB7IFwiYWN0aW9uXCI6IFwiPGFjdGlvbk5hbWU+XCIsIFwicGFyYW1zXCI6IHsgLi4uIH0gfWAuJyxcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcbiAgbGluZXMucHVzaChcIkV4YW1wbGU6XCIpO1xuICBsaW5lcy5wdXNoKFxuICAgIGAgICR7SlNPTi5zdHJpbmdpZnkoeyB0eXBlOiBjb21wMSwgcHJvcHM6IGNvbXAxUHJvcHMsIG9uOiB7IHByZXNzOiB7IGFjdGlvbjogXCJzZXRTdGF0ZVwiLCBwYXJhbXM6IHsgc3RhdGVQYXRoOiBcIi9zYXZlZFwiLCB2YWx1ZTogdHJ1ZSB9IH0gfSwgY2hpbGRyZW46IFtdIH0pfWAsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgJ0FjdGlvbiBwYXJhbXMgY2FuIHVzZSBkeW5hbWljIHJlZmVyZW5jZXMgdG8gcmVhZCBmcm9tIHN0YXRlOiB7IFwiJHN0YXRlXCI6IFwiL3N0YXRlUGF0aFwiIH0uJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICBcIklNUE9SVEFOVDogRG8gTk9UIHB1dCBhY3Rpb24vYWN0aW9uUGFyYW1zIGluc2lkZSBwcm9wcy4gQWx3YXlzIHVzZSB0aGUgYG9uYCBmaWVsZCBmb3IgZXZlbnQgYmluZGluZ3MuXCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG5cbiAgLy8gVmlzaWJpbGl0eSBjb25kaXRpb25zXG4gIGxpbmVzLnB1c2goXCJWSVNJQklMSVRZIENPTkRJVElPTlM6XCIpO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiRWxlbWVudHMgY2FuIGhhdmUgYW4gb3B0aW9uYWwgYHZpc2libGVgIGZpZWxkIHRvIGNvbmRpdGlvbmFsbHkgc2hvdy9oaWRlIGJhc2VkIG9uIHN0YXRlLiBJTVBPUlRBTlQ6IGB2aXNpYmxlYCBpcyBhIHRvcC1sZXZlbCBmaWVsZCBvbiB0aGUgZWxlbWVudCBvYmplY3QgKHNpYmxpbmcgb2YgdHlwZS9wcm9wcy9jaGlsZHJlbiksIE5PVCBpbnNpZGUgcHJvcHMuXCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgYENvcnJlY3Q6ICR7SlNPTi5zdHJpbmdpZnkoeyB0eXBlOiBjb21wMSwgcHJvcHM6IGNvbXAxUHJvcHMsIHZpc2libGU6IHsgJHN0YXRlOiBcIi9hY3RpdmVUYWJcIiwgZXE6IFwiaG9tZVwiIH0sIGNoaWxkcmVuOiBbXCIuLi5cIl0gfSl9YCxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnLSBgeyBcIiRzdGF0ZVwiOiBcIi9wYXRoXCIgfWAgLSB2aXNpYmxlIHdoZW4gc3RhdGUgYXQgcGF0aCBpcyB0cnV0aHknLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICctIGB7IFwiJHN0YXRlXCI6IFwiL3BhdGhcIiwgXCJub3RcIjogdHJ1ZSB9YCAtIHZpc2libGUgd2hlbiBzdGF0ZSBhdCBwYXRoIGlzIGZhbHN5JyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnLSBgeyBcIiRzdGF0ZVwiOiBcIi9wYXRoXCIsIFwiZXFcIjogXCJ2YWx1ZVwiIH1gIC0gdmlzaWJsZSB3aGVuIHN0YXRlIGVxdWFscyB2YWx1ZScsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJy0gYHsgXCIkc3RhdGVcIjogXCIvcGF0aFwiLCBcIm5lcVwiOiBcInZhbHVlXCIgfWAgLSB2aXNpYmxlIHdoZW4gc3RhdGUgZG9lcyBub3QgZXF1YWwgdmFsdWUnLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICctIGB7IFwiJHN0YXRlXCI6IFwiL3BhdGhcIiwgXCJndFwiOiBOIH1gIC8gYGd0ZWAgLyBgbHRgIC8gYGx0ZWAgLSBudW1lcmljIGNvbXBhcmlzb25zJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICBcIi0gVXNlIE9ORSBvcGVyYXRvciBwZXIgY29uZGl0aW9uIChlcSwgbmVxLCBndCwgZ3RlLCBsdCwgbHRlKS4gRG8gbm90IGNvbWJpbmUgbXVsdGlwbGUgb3BlcmF0b3JzLlwiLFxuICApO1xuICBsaW5lcy5wdXNoKCctIEFueSBjb25kaXRpb24gY2FuIGFkZCBgXCJub3RcIjogdHJ1ZWAgdG8gaW52ZXJ0IGl0cyByZXN1bHQnKTtcbiAgbGluZXMucHVzaChcbiAgICBcIi0gYFtjb25kaXRpb24sIGNvbmRpdGlvbl1gIC0gYWxsIGNvbmRpdGlvbnMgbXVzdCBiZSB0cnVlIChpbXBsaWNpdCBBTkQpXCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJy0gYHsgXCIkYW5kXCI6IFtjb25kaXRpb24sIGNvbmRpdGlvbl0gfWAgLSBleHBsaWNpdCBBTkQgKHVzZSB3aGVuIG5lc3RpbmcgaW5zaWRlICRvciknLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICctIGB7IFwiJG9yXCI6IFtjb25kaXRpb24sIGNvbmRpdGlvbl0gfWAgLSBhdCBsZWFzdCBvbmUgbXVzdCBiZSB0cnVlIChPUiknLFxuICApO1xuICBsaW5lcy5wdXNoKFwiLSBgdHJ1ZWAgLyBgZmFsc2VgIC0gYWx3YXlzIHZpc2libGUvaGlkZGVuXCIpO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiVXNlIGEgY29tcG9uZW50IHdpdGggb24ucHJlc3MgYm91bmQgdG8gc2V0U3RhdGUgdG8gdXBkYXRlIHN0YXRlIGFuZCBkcml2ZSB2aXNpYmlsaXR5LlwiLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIGBFeGFtcGxlOiBBICR7Y29tcDF9IHdpdGggb246IHsgXCJwcmVzc1wiOiB7IFwiYWN0aW9uXCI6IFwic2V0U3RhdGVcIiwgXCJwYXJhbXNcIjogeyBcInN0YXRlUGF0aFwiOiBcIi9hY3RpdmVUYWJcIiwgXCJ2YWx1ZVwiOiBcImhvbWVcIiB9IH0gfSBzZXRzIHN0YXRlLCB0aGVuIGEgY29udGFpbmVyIHdpdGggdmlzaWJsZTogeyBcIiRzdGF0ZVwiOiBcIi9hY3RpdmVUYWJcIiwgXCJlcVwiOiBcImhvbWVcIiB9IHNob3dzIG9ubHkgd2hlbiB0aGF0IHRhYiBpcyBhY3RpdmUuYCxcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcbiAgbGluZXMucHVzaChcbiAgICAnRm9yIHRhYiBwYXR0ZXJucyB3aGVyZSB0aGUgZmlyc3QvZGVmYXVsdCB0YWIgc2hvdWxkIGJlIHZpc2libGUgd2hlbiBubyB0YWIgaXMgc2VsZWN0ZWQgeWV0LCB1c2UgJG9yIHRvIGhhbmRsZSBib3RoIGNhc2VzOiB2aXNpYmxlOiB7IFwiJG9yXCI6IFt7IFwiJHN0YXRlXCI6IFwiL2FjdGl2ZVRhYlwiLCBcImVxXCI6IFwiaG9tZVwiIH0sIHsgXCIkc3RhdGVcIjogXCIvYWN0aXZlVGFiXCIsIFwibm90XCI6IHRydWUgfV0gfS4gVGhpcyBlbnN1cmVzIHRoZSBmaXJzdCB0YWIgaXMgdmlzaWJsZSBib3RoIHdoZW4gZXhwbGljaXRseSBzZWxlY3RlZCBBTkQgd2hlbiAvYWN0aXZlVGFiIGlzIG5vdCB5ZXQgc2V0LicsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG5cbiAgLy8gRHluYW1pYyBwcm9wIGV4cHJlc3Npb25zXG4gIGxpbmVzLnB1c2goXCJEWU5BTUlDIFBST1BTOlwiKTtcbiAgbGluZXMucHVzaChcbiAgICBcIkFueSBwcm9wIHZhbHVlIGNhbiBiZSBhIGR5bmFtaWMgZXhwcmVzc2lvbiB0aGF0IHJlc29sdmVzIGJhc2VkIG9uIHN0YXRlLiBUaHJlZSBmb3JtcyBhcmUgc3VwcG9ydGVkOlwiLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFxuICAgICcxLiBSZWFkLW9ubHkgc3RhdGU6IGB7IFwiJHN0YXRlXCI6IFwiL3N0YXRlUGF0aFwiIH1gIC0gcmVzb2x2ZXMgdG8gdGhlIHZhbHVlIGF0IHRoYXQgc3RhdGUgcGF0aCAob25lLXdheSByZWFkKS4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICcgICBFeGFtcGxlOiBgXCJjb2xvclwiOiB7IFwiJHN0YXRlXCI6IFwiL3RoZW1lL3ByaW1hcnlcIiB9YCByZWFkcyB0aGUgY29sb3IgZnJvbSBzdGF0ZS4nLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFxuICAgICcyLiBUd28td2F5IGJpbmRpbmc6IGB7IFwiJGJpbmRTdGF0ZVwiOiBcIi9zdGF0ZVBhdGhcIiB9YCAtIHJlc29sdmVzIHRvIHRoZSB2YWx1ZSBhdCB0aGUgc3RhdGUgcGF0aCBBTkQgZW5hYmxlcyB3cml0ZS1iYWNrLiBVc2Ugb24gZm9ybSBpbnB1dCBwcm9wcyAodmFsdWUsIGNoZWNrZWQsIHByZXNzZWQsIGV0Yy4pLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJyAgIEV4YW1wbGU6IGBcInZhbHVlXCI6IHsgXCIkYmluZFN0YXRlXCI6IFwiL2Zvcm0vZW1haWxcIiB9YCBiaW5kcyB0aGUgaW5wdXQgdmFsdWUgdG8gL2Zvcm0vZW1haWwuJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnICAgSW5zaWRlIHJlcGVhdCBzY29wZXM6IGBcImNoZWNrZWRcIjogeyBcIiRiaW5kSXRlbVwiOiBcImNvbXBsZXRlZFwiIH1gIGJpbmRzIHRvIHRoZSBjdXJyZW50IGl0ZW1cXCdzIGNvbXBsZXRlZCBmaWVsZC4nLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFxuICAgICczLiBDb25kaXRpb25hbDogYHsgXCIkY29uZFwiOiA8Y29uZGl0aW9uPiwgXCIkdGhlblwiOiA8dmFsdWU+LCBcIiRlbHNlXCI6IDx2YWx1ZT4gfWAgLSBldmFsdWF0ZXMgdGhlIGNvbmRpdGlvbiAoc2FtZSBzeW50YXggYXMgdmlzaWJpbGl0eSBjb25kaXRpb25zKSBhbmQgcGlja3MgdGhlIG1hdGNoaW5nIHZhbHVlLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJyAgIEV4YW1wbGU6IGBcImNvbG9yXCI6IHsgXCIkY29uZFwiOiB7IFwiJHN0YXRlXCI6IFwiL2FjdGl2ZVRhYlwiLCBcImVxXCI6IFwiaG9tZVwiIH0sIFwiJHRoZW5cIjogXCIjMDA3QUZGXCIsIFwiJGVsc2VcIjogXCIjOEU4RTkzXCIgfWAnLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiVXNlICRiaW5kU3RhdGUgZm9yIGZvcm0gaW5wdXRzICh0ZXh0IGZpZWxkcywgY2hlY2tib3hlcywgc2VsZWN0cywgc2xpZGVycywgZXRjLikgYW5kICRzdGF0ZSBmb3IgcmVhZC1vbmx5IGRhdGEgZGlzcGxheS4gSW5zaWRlIHJlcGVhdCBzY29wZXMsIHVzZSAkYmluZEl0ZW0gZm9yIGZvcm0gaW5wdXRzIGJvdW5kIHRvIHRoZSBjdXJyZW50IGl0ZW0uIFVzZSBkeW5hbWljIHByb3BzIGluc3RlYWQgb2YgZHVwbGljYXRpbmcgZWxlbWVudHMgd2l0aCBvcHBvc2luZyB2aXNpYmxlIGNvbmRpdGlvbnMgd2hlbiBvbmx5IHByb3AgdmFsdWVzIGRpZmZlci5cIixcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcbiAgbGluZXMucHVzaChcbiAgICAnNC4gVGVtcGxhdGU6IGB7IFwiJHRlbXBsYXRlXCI6IFwiSGVsbG8sICR7L25hbWV9IVwiIH1gIC0gaW50ZXJwb2xhdGVzIGAkey9wYXRofWAgcmVmZXJlbmNlcyBpbiB0aGUgc3RyaW5nIHdpdGggdmFsdWVzIGZyb20gdGhlIHN0YXRlIG1vZGVsLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJyAgIEV4YW1wbGU6IGBcImxhYmVsXCI6IHsgXCIkdGVtcGxhdGVcIjogXCJJdGVtczogJHsvY2FydC9jb3VudH0gfCBUb3RhbDogJHsvY2FydC90b3RhbH1cIiB9YCByZW5kZXJzIFwiSXRlbXM6IDMgfCBUb3RhbDogNDIuMDBcIiB3aGVuIC9jYXJ0L2NvdW50IGlzIDMgYW5kIC9jYXJ0L3RvdGFsIGlzIDQyLjAwLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG5cbiAgLy8gJGNvbXB1dGVkIHNlY3Rpb24g4oCUIG9ubHkgZW1pdCB3aGVuIGNhdGFsb2cgZGVmaW5lcyBmdW5jdGlvbnNcbiAgY29uc3QgY2F0YWxvZ0Z1bmN0aW9ucyA9IChjYXRhbG9nLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmZ1bmN0aW9ucztcbiAgaWYgKGNhdGFsb2dGdW5jdGlvbnMgJiYgT2JqZWN0LmtleXMoY2F0YWxvZ0Z1bmN0aW9ucykubGVuZ3RoID4gMCkge1xuICAgIGxpbmVzLnB1c2goXG4gICAgICAnNS4gQ29tcHV0ZWQ6IGB7IFwiJGNvbXB1dGVkXCI6IFwiPGZ1bmN0aW9uTmFtZT5cIiwgXCJhcmdzXCI6IHsgXCJrZXlcIjogPGV4cHJlc3Npb24+IH0gfWAgLSBjYWxscyBhIHJlZ2lzdGVyZWQgZnVuY3Rpb24gd2l0aCByZXNvbHZlZCBhcmdzIGFuZCByZXR1cm5zIHRoZSByZXN1bHQuJyxcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICAnICAgRXhhbXBsZTogYFwidmFsdWVcIjogeyBcIiRjb21wdXRlZFwiOiBcImZ1bGxOYW1lXCIsIFwiYXJnc1wiOiB7IFwiZmlyc3RcIjogeyBcIiRzdGF0ZVwiOiBcIi9mb3JtL2ZpcnN0TmFtZVwiIH0sIFwibGFzdFwiOiB7IFwiJHN0YXRlXCI6IFwiL2Zvcm0vbGFzdE5hbWVcIiB9IH0gfWAnLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcIiAgIEF2YWlsYWJsZSBmdW5jdGlvbnM6XCIpO1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiBPYmplY3Qua2V5cyhcbiAgICAgIGNhdGFsb2dGdW5jdGlvbnMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgKSkge1xuICAgICAgbGluZXMucHVzaChgICAgLSAke25hbWV9YCk7XG4gICAgfVxuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gIH1cblxuICAvLyBWYWxpZGF0aW9uIHNlY3Rpb24g4oCUIG9ubHkgZW1pdCB3aGVuIGF0IGxlYXN0IG9uZSBjb21wb25lbnQgaGFzIGEgYGNoZWNrc2AgcHJvcFxuICBjb25zdCBoYXNDaGVja3NDb21wb25lbnRzID0gYWxsQ29tcG9uZW50c1xuICAgID8gT2JqZWN0LmVudHJpZXMoYWxsQ29tcG9uZW50cykuc29tZSgoWywgZGVmXSkgPT4ge1xuICAgICAgICBpZiAoIWRlZi5wcm9wcykgcmV0dXJuIGZhbHNlO1xuICAgICAgICBjb25zdCBmb3JtYXR0ZWQgPSBmb3JtYXRab2RUeXBlKGRlZi5wcm9wcyk7XG4gICAgICAgIHJldHVybiBmb3JtYXR0ZWQuaW5jbHVkZXMoXCJjaGVja3NcIik7XG4gICAgICB9KVxuICAgIDogZmFsc2U7XG5cbiAgaWYgKGhhc0NoZWNrc0NvbXBvbmVudHMpIHtcbiAgICBsaW5lcy5wdXNoKFwiVkFMSURBVElPTjpcIik7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiRm9ybSBjb21wb25lbnRzIHRoYXQgYWNjZXB0IGEgYGNoZWNrc2AgcHJvcCBzdXBwb3J0IGNsaWVudC1zaWRlIHZhbGlkYXRpb24uXCIsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgJ0VhY2ggY2hlY2sgaXMgYW4gb2JqZWN0OiB7IFwidHlwZVwiOiBcIjxuYW1lPlwiLCBcIm1lc3NhZ2VcIjogXCIuLi5cIiwgXCJhcmdzXCI6IHsgLi4uIH0gfScsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFwiXCIpO1xuICAgIGxpbmVzLnB1c2goXCJCdWlsdC1pbiB2YWxpZGF0aW9uIHR5cGVzOlwiKTtcbiAgICBsaW5lcy5wdXNoKFwiICAtIHJlcXVpcmVkIOKAlCB2YWx1ZSBtdXN0IGJlIG5vbi1lbXB0eVwiKTtcbiAgICBsaW5lcy5wdXNoKFwiICAtIGVtYWlsIOKAlCB2YWxpZCBlbWFpbCBmb3JtYXRcIik7XG4gICAgbGluZXMucHVzaCgnICAtIG1pbkxlbmd0aCDigJQgbWluaW11bSBzdHJpbmcgbGVuZ3RoIChhcmdzOiB7IFwibWluXCI6IE4gfSknKTtcbiAgICBsaW5lcy5wdXNoKCcgIC0gbWF4TGVuZ3RoIOKAlCBtYXhpbXVtIHN0cmluZyBsZW5ndGggKGFyZ3M6IHsgXCJtYXhcIjogTiB9KScpO1xuICAgIGxpbmVzLnB1c2goJyAgLSBwYXR0ZXJuIOKAlCBtYXRjaCBhIHJlZ2V4IChhcmdzOiB7IFwicGF0dGVyblwiOiBcInJlZ2V4XCIgfSknKTtcbiAgICBsaW5lcy5wdXNoKCcgIC0gbWluIOKAlCBtaW5pbXVtIG51bWVyaWMgdmFsdWUgKGFyZ3M6IHsgXCJtaW5cIjogTiB9KScpO1xuICAgIGxpbmVzLnB1c2goJyAgLSBtYXgg4oCUIG1heGltdW0gbnVtZXJpYyB2YWx1ZSAoYXJnczogeyBcIm1heFwiOiBOIH0pJyk7XG4gICAgbGluZXMucHVzaChcIiAgLSBudW1lcmljIOKAlCB2YWx1ZSBtdXN0IGJlIGEgbnVtYmVyXCIpO1xuICAgIGxpbmVzLnB1c2goXCIgIC0gdXJsIOKAlCB2YWxpZCBVUkwgZm9ybWF0XCIpO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICAnICAtIG1hdGNoZXMg4oCUIG11c3QgZXF1YWwgYW5vdGhlciBmaWVsZCAoYXJnczogeyBcIm90aGVyXCI6IHsgXCIkc3RhdGVcIjogXCIvcGF0aFwiIH0gfSknLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcbiAgICAgICcgIC0gZXF1YWxUbyDigJQgYWxpYXMgZm9yIG1hdGNoZXMgKGFyZ3M6IHsgXCJvdGhlclwiOiB7IFwiJHN0YXRlXCI6IFwiL3BhdGhcIiB9IH0pJyxcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICAnICAtIGxlc3NUaGFuIOKAlCB2YWx1ZSBtdXN0IGJlIGxlc3MgdGhhbiBhbm90aGVyIGZpZWxkIChhcmdzOiB7IFwib3RoZXJcIjogeyBcIiRzdGF0ZVwiOiBcIi9wYXRoXCIgfSB9KScsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgJyAgLSBncmVhdGVyVGhhbiDigJQgdmFsdWUgbXVzdCBiZSBncmVhdGVyIHRoYW4gYW5vdGhlciBmaWVsZCAoYXJnczogeyBcIm90aGVyXCI6IHsgXCIkc3RhdGVcIjogXCIvcGF0aFwiIH0gfSknLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcbiAgICAgICcgIC0gcmVxdWlyZWRJZiDigJQgcmVxdWlyZWQgb25seSB3aGVuIGFub3RoZXIgZmllbGQgaXMgdHJ1dGh5IChhcmdzOiB7IFwiZmllbGRcIjogeyBcIiRzdGF0ZVwiOiBcIi9wYXRoXCIgfSB9KScsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFwiXCIpO1xuICAgIGxpbmVzLnB1c2goXCJFeGFtcGxlOlwiKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgJyAgXCJjaGVja3NcIjogW3sgXCJ0eXBlXCI6IFwicmVxdWlyZWRcIiwgXCJtZXNzYWdlXCI6IFwiRW1haWwgaXMgcmVxdWlyZWRcIiB9LCB7IFwidHlwZVwiOiBcImVtYWlsXCIsIFwibWVzc2FnZVwiOiBcIkludmFsaWQgZW1haWxcIiB9XScsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFwiXCIpO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBcIklNUE9SVEFOVDogV2hlbiB1c2luZyBjaGVja3MsIHRoZSBjb21wb25lbnQgbXVzdCBhbHNvIGhhdmUgYSB7ICRiaW5kU3RhdGUgfSBvciB7ICRiaW5kSXRlbSB9IG9uIGl0cyB2YWx1ZS9jaGVja2VkIHByb3AgZm9yIHR3by13YXkgYmluZGluZy5cIixcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBcIkFsd2F5cyBpbmNsdWRlIHZhbGlkYXRpb24gY2hlY2tzIG9uIGZvcm0gaW5wdXRzIGZvciBhIGdvb2QgdXNlciBleHBlcmllbmNlIChlLmcuIHJlcXVpcmVkLCBlbWFpbCwgbWluTGVuZ3RoKS5cIixcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gIH1cblxuICAvLyBTdGF0ZSB3YXRjaGVycyBzZWN0aW9uIOKAlCBvbmx5IGVtaXQgd2hlbiBhY3Rpb25zIGFyZSBhdmFpbGFibGUgKHdhdGNoZXJzXG4gIC8vIHRyaWdnZXIgYWN0aW9ucywgc28gdGhlIHNlY3Rpb24gaXMgaXJyZWxldmFudCB3aXRob3V0IHRoZW0pLlxuICBpZiAoaGFzQ3VzdG9tQWN0aW9ucyB8fCBoYXNCdWlsdEluQWN0aW9ucykge1xuICAgIGxpbmVzLnB1c2goXCJTVEFURSBXQVRDSEVSUzpcIik7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiRWxlbWVudHMgY2FuIGhhdmUgYW4gb3B0aW9uYWwgYHdhdGNoYCBmaWVsZCB0byByZWFjdCB0byBzdGF0ZSBjaGFuZ2VzIGFuZCB0cmlnZ2VyIGFjdGlvbnMuIFRoZSBgd2F0Y2hgIGZpZWxkIGlzIGEgdG9wLWxldmVsIGZpZWxkIG9uIHRoZSBlbGVtZW50IChzaWJsaW5nIG9mIHR5cGUvcHJvcHMvY2hpbGRyZW4pLCBOT1QgaW5zaWRlIHByb3BzLlwiLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiTWFwcyBzdGF0ZSBwYXRocyAoSlNPTiBQb2ludGVycykgdG8gYWN0aW9uIGJpbmRpbmdzLiBXaGVuIHRoZSB2YWx1ZSBhdCBhIHdhdGNoZWQgcGF0aCBjaGFuZ2VzLCB0aGUgYm91bmQgYWN0aW9ucyBmaXJlIGF1dG9tYXRpY2FsbHkuXCIsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFwiXCIpO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBcIkV4YW1wbGUgKGNhc2NhZGluZyBzZWxlY3Qg4oCUIGNvdW50cnkgY2hhbmdlcyB0cmlnZ2VyIGNpdHkgbG9hZGluZyk6XCIsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgYCAgJHtKU09OLnN0cmluZ2lmeSh7IHR5cGU6IFwiU2VsZWN0XCIsIHByb3BzOiB7IHZhbHVlOiB7ICRiaW5kU3RhdGU6IFwiL2Zvcm0vY291bnRyeVwiIH0sIG9wdGlvbnM6IFtcIlVTXCIsIFwiQ2FuYWRhXCIsIFwiVUtcIl0gfSwgd2F0Y2g6IHsgXCIvZm9ybS9jb3VudHJ5XCI6IHsgYWN0aW9uOiBcImxvYWRDaXRpZXNcIiwgcGFyYW1zOiB7IGNvdW50cnk6IHsgJHN0YXRlOiBcIi9mb3JtL2NvdW50cnlcIiB9IH0gfSB9LCBjaGlsZHJlbjogW10gfSl9YCxcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiVXNlIGB3YXRjaGAgZm9yIGNhc2NhZGluZyBkZXBlbmRlbmNpZXMgd2hlcmUgY2hhbmdpbmcgb25lIGZpZWxkIHNob3VsZCB0cmlnZ2VyIHNpZGUgZWZmZWN0cyAobG9hZGluZyBkYXRhLCByZXNldHRpbmcgZGVwZW5kZW50IGZpZWxkcywgY29tcHV0aW5nIGRlcml2ZWQgdmFsdWVzKS5cIixcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBcIklNUE9SVEFOVDogYHdhdGNoYCBpcyBhIHRvcC1sZXZlbCBmaWVsZCBvbiB0aGUgZWxlbWVudCAoc2libGluZyBvZiB0eXBlL3Byb3BzL2NoaWxkcmVuKSwgTk9UIGluc2lkZSBwcm9wcy4gV2F0Y2hlcnMgb25seSBmaXJlIHdoZW4gdGhlIHZhbHVlIGNoYW5nZXMsIG5vdCBvbiBpbml0aWFsIHJlbmRlci5cIixcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gIH1cblxuICAvLyBSdWxlc1xuICBsaW5lcy5wdXNoKFwiUlVMRVM6XCIpO1xuICBjb25zdCBiYXNlUnVsZXMgPVxuICAgIG1vZGUgPT09IFwiY2hhdFwiXG4gICAgICA/IFtcbiAgICAgICAgICBcIldoZW4gZ2VuZXJhdGluZyBVSSwgd3JhcCBhbGwgSlNPTkwgcGF0Y2hlcyBpbiBhIGBgYHNwZWMgY29kZSBmZW5jZSAtIG9uZSBKU09OIG9iamVjdCBwZXIgbGluZSBpbnNpZGUgdGhlIGZlbmNlXCIsXG4gICAgICAgICAgXCJXcml0ZSBhIGJyaWVmIGNvbnZlcnNhdGlvbmFsIHJlc3BvbnNlIGJlZm9yZSBhbnkgSlNPTkwgb3V0cHV0XCIsXG4gICAgICAgICAgJ0ZpcnN0IHNldCByb290OiB7XCJvcFwiOlwiYWRkXCIsXCJwYXRoXCI6XCIvcm9vdFwiLFwidmFsdWVcIjpcIjxyb290LWtleT5cIn0nLFxuICAgICAgICAgICdUaGVuIGFkZCBlYWNoIGVsZW1lbnQ6IHtcIm9wXCI6XCJhZGRcIixcInBhdGhcIjpcIi9lbGVtZW50cy88a2V5PlwiLFwidmFsdWVcIjp7Li4ufX0nLFxuICAgICAgICAgIFwiT3V0cHV0IC9zdGF0ZSBwYXRjaGVzIHJpZ2h0IGFmdGVyIHRoZSBlbGVtZW50cyB0aGF0IHVzZSB0aGVtLCBvbmUgcGVyIGFycmF5IGl0ZW0gZm9yIHByb2dyZXNzaXZlIGxvYWRpbmcuIFJFUVVJUkVEIHdoZW5ldmVyIHVzaW5nICRzdGF0ZSwgJGJpbmRTdGF0ZSwgJGJpbmRJdGVtLCAkaXRlbSwgJGluZGV4LCBvciByZXBlYXQuXCIsXG4gICAgICAgICAgXCJPTkxZIHVzZSBjb21wb25lbnRzIGxpc3RlZCBhYm92ZVwiLFxuICAgICAgICAgIFwiRWFjaCBlbGVtZW50IHZhbHVlIG5lZWRzOiB0eXBlLCBwcm9wcywgY2hpbGRyZW4gKGFycmF5IG9mIGNoaWxkIGtleXMpXCIsXG4gICAgICAgICAgXCJVc2UgdW5pcXVlIGtleXMgZm9yIHRoZSBlbGVtZW50IG1hcCBlbnRyaWVzIChlLmcuLCAnaGVhZGVyJywgJ21ldHJpYy0xJywgJ2NoYXJ0LXJldmVudWUnKVwiLFxuICAgICAgICBdXG4gICAgICA6IFtcbiAgICAgICAgICBcIk91dHB1dCBPTkxZIEpTT05MIHBhdGNoZXMgLSBvbmUgSlNPTiBvYmplY3QgcGVyIGxpbmUsIG5vIG1hcmtkb3duLCBubyBjb2RlIGZlbmNlc1wiLFxuICAgICAgICAgICdGaXJzdCBzZXQgcm9vdDoge1wib3BcIjpcImFkZFwiLFwicGF0aFwiOlwiL3Jvb3RcIixcInZhbHVlXCI6XCI8cm9vdC1rZXk+XCJ9JyxcbiAgICAgICAgICAnVGhlbiBhZGQgZWFjaCBlbGVtZW50OiB7XCJvcFwiOlwiYWRkXCIsXCJwYXRoXCI6XCIvZWxlbWVudHMvPGtleT5cIixcInZhbHVlXCI6ey4uLn19JyxcbiAgICAgICAgICBcIk91dHB1dCAvc3RhdGUgcGF0Y2hlcyByaWdodCBhZnRlciB0aGUgZWxlbWVudHMgdGhhdCB1c2UgdGhlbSwgb25lIHBlciBhcnJheSBpdGVtIGZvciBwcm9ncmVzc2l2ZSBsb2FkaW5nLiBSRVFVSVJFRCB3aGVuZXZlciB1c2luZyAkc3RhdGUsICRiaW5kU3RhdGUsICRiaW5kSXRlbSwgJGl0ZW0sICRpbmRleCwgb3IgcmVwZWF0LlwiLFxuICAgICAgICAgIFwiT05MWSB1c2UgY29tcG9uZW50cyBsaXN0ZWQgYWJvdmVcIixcbiAgICAgICAgICBcIkVhY2ggZWxlbWVudCB2YWx1ZSBuZWVkczogdHlwZSwgcHJvcHMsIGNoaWxkcmVuIChhcnJheSBvZiBjaGlsZCBrZXlzKVwiLFxuICAgICAgICAgIFwiVXNlIHVuaXF1ZSBrZXlzIGZvciB0aGUgZWxlbWVudCBtYXAgZW50cmllcyAoZS5nLiwgJ2hlYWRlcicsICdtZXRyaWMtMScsICdjaGFydC1yZXZlbnVlJylcIixcbiAgICAgICAgXTtcbiAgY29uc3Qgc2NoZW1hUnVsZXMgPSBjYXRhbG9nLnNjaGVtYS5kZWZhdWx0UnVsZXMgPz8gW107XG4gIGNvbnN0IGFsbFJ1bGVzID0gWy4uLmJhc2VSdWxlcywgLi4uc2NoZW1hUnVsZXMsIC4uLmN1c3RvbVJ1bGVzXTtcbiAgYWxsUnVsZXMuZm9yRWFjaCgocnVsZSwgaSkgPT4ge1xuICAgIGxpbmVzLnB1c2goYCR7aSArIDF9LiAke3J1bGV9YCk7XG4gIH0pO1xuXG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhhbXBsZSBWYWx1ZSBHZW5lcmF0aW9uIGZyb20gWm9kIFNjaGVtYXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ29tcG9uZW50IGRlZmluaXRpb24gc2hhcGUgYXMgaXQgYXBwZWFycyBpbiBjYXRhbG9nIGRhdGFcbiAqL1xuaW50ZXJmYWNlIENhdGFsb2dDb21wb25lbnREZWYge1xuICBwcm9wcz86IHouWm9kVHlwZTtcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG4gIHNsb3RzPzogc3RyaW5nW107XG4gIGV2ZW50cz86IHN0cmluZ1tdO1xuICBleGFtcGxlPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbi8qKlxuICogR2V0IGV4YW1wbGUgcHJvcHMgZm9yIGEgY2F0YWxvZyBjb21wb25lbnQuXG4gKiBVc2VzIHRoZSBleHBsaWNpdCBgZXhhbXBsZWAgZmllbGQgaWYgcHJvdmlkZWQsIG90aGVyd2lzZSBnZW5lcmF0ZXMgZnJvbSBab2Qgc2NoZW1hLlxuICovXG5mdW5jdGlvbiBnZXRFeGFtcGxlUHJvcHMoZGVmOiBDYXRhbG9nQ29tcG9uZW50RGVmKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICBpZiAoZGVmLmV4YW1wbGUgJiYgT2JqZWN0LmtleXMoZGVmLmV4YW1wbGUpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gZGVmLmV4YW1wbGU7XG4gIH1cbiAgaWYgKGRlZi5wcm9wcykge1xuICAgIHJldHVybiBnZW5lcmF0ZUV4YW1wbGVQcm9wc0Zyb21ab2QoZGVmLnByb3BzKTtcbiAgfVxuICByZXR1cm4ge307XG59XG5cbi8qKlxuICogR2VuZXJhdGUgZXhhbXBsZSBwcm9wIHZhbHVlcyBmcm9tIGEgWm9kIG9iamVjdCBzY2hlbWEuXG4gKiBPbmx5IGluY2x1ZGVzIHJlcXVpcmVkIGZpZWxkcyB0byBrZWVwIGV4YW1wbGVzIGNvbmNpc2UuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlRXhhbXBsZVByb3BzRnJvbVpvZChcbiAgc2NoZW1hOiB6LlpvZFR5cGUsXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIGlmICghc2NoZW1hIHx8ICFzY2hlbWEuX2RlZikgcmV0dXJuIHt9O1xuICBjb25zdCBkZWYgPSBzY2hlbWEuX2RlZiBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjb25zdCB0eXBlTmFtZSA9IGdldFpvZFR5cGVOYW1lKHNjaGVtYSk7XG5cbiAgaWYgKHR5cGVOYW1lICE9PSBcIlpvZE9iamVjdFwiICYmIHR5cGVOYW1lICE9PSBcIm9iamVjdFwiKSByZXR1cm4ge307XG5cbiAgY29uc3Qgc2hhcGUgPVxuICAgIHR5cGVvZiBkZWYuc2hhcGUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyAoZGVmLnNoYXBlIGFzICgpID0+IFJlY29yZDxzdHJpbmcsIHouWm9kVHlwZT4pKClcbiAgICAgIDogKGRlZi5zaGFwZSBhcyBSZWNvcmQ8c3RyaW5nLCB6LlpvZFR5cGU+KTtcbiAgaWYgKCFzaGFwZSkgcmV0dXJuIHt9O1xuXG4gIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc2hhcGUpKSB7XG4gICAgY29uc3QgaW5uZXJUeXBlTmFtZSA9IGdldFpvZFR5cGVOYW1lKHZhbHVlKTtcbiAgICAvLyBTa2lwIG9wdGlvbmFsIHByb3BzIHRvIGtlZXAgZXhhbXBsZXMgY29uY2lzZVxuICAgIGlmIChcbiAgICAgIGlubmVyVHlwZU5hbWUgPT09IFwiWm9kT3B0aW9uYWxcIiB8fFxuICAgICAgaW5uZXJUeXBlTmFtZSA9PT0gXCJvcHRpb25hbFwiIHx8XG4gICAgICBpbm5lclR5cGVOYW1lID09PSBcIlpvZE51bGxhYmxlXCIgfHxcbiAgICAgIGlubmVyVHlwZU5hbWUgPT09IFwibnVsbGFibGVcIlxuICAgICkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHJlc3VsdFtrZXldID0gZ2VuZXJhdGVFeGFtcGxlVmFsdWUodmFsdWUpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgYSBzaW5nbGUgZXhhbXBsZSB2YWx1ZSBmcm9tIGEgWm9kIHR5cGUuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlRXhhbXBsZVZhbHVlKHNjaGVtYTogei5ab2RUeXBlKTogdW5rbm93biB7XG4gIGlmICghc2NoZW1hIHx8ICFzY2hlbWEuX2RlZikgcmV0dXJuIFwiLi4uXCI7XG4gIGNvbnN0IGRlZiA9IHNjaGVtYS5fZGVmIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbnN0IHR5cGVOYW1lID0gZ2V0Wm9kVHlwZU5hbWUoc2NoZW1hKTtcblxuICBzd2l0Y2ggKHR5cGVOYW1lKSB7XG4gICAgY2FzZSBcIlpvZFN0cmluZ1wiOlxuICAgIGNhc2UgXCJzdHJpbmdcIjpcbiAgICAgIHJldHVybiBcImV4YW1wbGVcIjtcbiAgICBjYXNlIFwiWm9kTnVtYmVyXCI6XG4gICAgY2FzZSBcIm51bWJlclwiOlxuICAgICAgcmV0dXJuIDA7XG4gICAgY2FzZSBcIlpvZEJvb2xlYW5cIjpcbiAgICBjYXNlIFwiYm9vbGVhblwiOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgY2FzZSBcIlpvZExpdGVyYWxcIjpcbiAgICBjYXNlIFwibGl0ZXJhbFwiOlxuICAgICAgcmV0dXJuIGRlZi52YWx1ZTtcbiAgICBjYXNlIFwiWm9kRW51bVwiOlxuICAgIGNhc2UgXCJlbnVtXCI6IHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGRlZi52YWx1ZXMpICYmIGRlZi52YWx1ZXMubGVuZ3RoID4gMClcbiAgICAgICAgcmV0dXJuIGRlZi52YWx1ZXNbMF07XG4gICAgICBpZiAoZGVmLmVudHJpZXMgJiYgdHlwZW9mIGRlZi5lbnRyaWVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlcyA9IE9iamVjdC52YWx1ZXMoZGVmLmVudHJpZXMgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPik7XG4gICAgICAgIHJldHVybiB2YWx1ZXMubGVuZ3RoID4gMCA/IHZhbHVlc1swXSA6IFwiZXhhbXBsZVwiO1xuICAgICAgfVxuICAgICAgcmV0dXJuIFwiZXhhbXBsZVwiO1xuICAgIH1cbiAgICBjYXNlIFwiWm9kT3B0aW9uYWxcIjpcbiAgICBjYXNlIFwib3B0aW9uYWxcIjpcbiAgICBjYXNlIFwiWm9kTnVsbGFibGVcIjpcbiAgICBjYXNlIFwibnVsbGFibGVcIjpcbiAgICBjYXNlIFwiWm9kRGVmYXVsdFwiOlxuICAgIGNhc2UgXCJkZWZhdWx0XCI6IHtcbiAgICAgIGNvbnN0IGlubmVyID0gKGRlZi5pbm5lclR5cGUgYXMgei5ab2RUeXBlKSA/PyAoZGVmLndyYXBwZWQgYXMgei5ab2RUeXBlKTtcbiAgICAgIHJldHVybiBpbm5lciA/IGdlbmVyYXRlRXhhbXBsZVZhbHVlKGlubmVyKSA6IG51bGw7XG4gICAgfVxuICAgIGNhc2UgXCJab2RBcnJheVwiOlxuICAgIGNhc2UgXCJhcnJheVwiOlxuICAgICAgcmV0dXJuIFtdO1xuICAgIGNhc2UgXCJab2RPYmplY3RcIjpcbiAgICBjYXNlIFwib2JqZWN0XCI6XG4gICAgICByZXR1cm4gZ2VuZXJhdGVFeGFtcGxlUHJvcHNGcm9tWm9kKHNjaGVtYSk7XG4gICAgY2FzZSBcIlpvZFVuaW9uXCI6XG4gICAgY2FzZSBcInVuaW9uXCI6IHtcbiAgICAgIGNvbnN0IG9wdGlvbnMgPSBkZWYub3B0aW9ucyBhcyB6LlpvZFR5cGVbXSB8IHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiBvcHRpb25zICYmIG9wdGlvbnMubGVuZ3RoID4gMFxuICAgICAgICA/IGdlbmVyYXRlRXhhbXBsZVZhbHVlKG9wdGlvbnNbMF0hKVxuICAgICAgICA6IFwiLi4uXCI7XG4gICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gXCIuLi5cIjtcbiAgfVxufVxuXG4vKipcbiAqIEZpbmQgdGhlIG5hbWUgb2YgdGhlIGZpcnN0IHJlcXVpcmVkIHN0cmluZyBwcm9wIGluIGEgWm9kIG9iamVjdCBzY2hlbWEuXG4gKiBVc2VkIHRvIGRlbW9uc3RyYXRlICRzdGF0ZSBkeW5hbWljIGJpbmRpbmdzIGluIGV4YW1wbGVzLlxuICovXG5mdW5jdGlvbiBmaW5kRmlyc3RTdHJpbmdQcm9wKHNjaGVtYT86IHouWm9kVHlwZSk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIXNjaGVtYSB8fCAhc2NoZW1hLl9kZWYpIHJldHVybiBudWxsO1xuICBjb25zdCBkZWYgPSBzY2hlbWEuX2RlZiBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjb25zdCB0eXBlTmFtZSA9IGdldFpvZFR5cGVOYW1lKHNjaGVtYSk7XG5cbiAgaWYgKHR5cGVOYW1lICE9PSBcIlpvZE9iamVjdFwiICYmIHR5cGVOYW1lICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBzaGFwZSA9XG4gICAgdHlwZW9mIGRlZi5zaGFwZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IChkZWYuc2hhcGUgYXMgKCkgPT4gUmVjb3JkPHN0cmluZywgei5ab2RUeXBlPikoKVxuICAgICAgOiAoZGVmLnNoYXBlIGFzIFJlY29yZDxzdHJpbmcsIHouWm9kVHlwZT4pO1xuICBpZiAoIXNoYXBlKSByZXR1cm4gbnVsbDtcblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzaGFwZSkpIHtcbiAgICBjb25zdCBpbm5lclR5cGVOYW1lID0gZ2V0Wm9kVHlwZU5hbWUodmFsdWUpO1xuICAgIC8vIFNraXAgb3B0aW9uYWwgcHJvcHNcbiAgICBpZiAoXG4gICAgICBpbm5lclR5cGVOYW1lID09PSBcIlpvZE9wdGlvbmFsXCIgfHxcbiAgICAgIGlubmVyVHlwZU5hbWUgPT09IFwib3B0aW9uYWxcIiB8fFxuICAgICAgaW5uZXJUeXBlTmFtZSA9PT0gXCJab2ROdWxsYWJsZVwiIHx8XG4gICAgICBpbm5lclR5cGVOYW1lID09PSBcIm51bGxhYmxlXCJcbiAgICApIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBVbndyYXAgdG8gY2hlY2sgdGhlIGFjdHVhbCB0eXBlXG4gICAgaWYgKGlubmVyVHlwZU5hbWUgPT09IFwiWm9kU3RyaW5nXCIgfHwgaW5uZXJUeXBlTmFtZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIGtleTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBab2QgSW50cm9zcGVjdGlvbiBIZWxwZXJzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEdldCBab2QgdHlwZSBuYW1lIGZyb20gc2NoZW1hIChoYW5kbGVzIGRpZmZlcmVudCBab2QgdmVyc2lvbnMpXG4gKi9cbmZ1bmN0aW9uIGdldFpvZFR5cGVOYW1lKHNjaGVtYTogei5ab2RUeXBlKTogc3RyaW5nIHtcbiAgaWYgKCFzY2hlbWEgfHwgIXNjaGVtYS5fZGVmKSByZXR1cm4gXCJcIjtcbiAgY29uc3QgZGVmID0gc2NoZW1hLl9kZWYgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLy8gWm9kIDQrIHVzZXMgX2RlZi50eXBlLCBvbGRlciB2ZXJzaW9ucyB1c2UgX2RlZi50eXBlTmFtZVxuICByZXR1cm4gKGRlZi50eXBlTmFtZSBhcyBzdHJpbmcpID8/IChkZWYudHlwZSBhcyBzdHJpbmcpID8/IFwiXCI7XG59XG5cbi8qKlxuICogRm9ybWF0IGEgWm9kIHR5cGUgaW50byBhIGh1bWFuLXJlYWRhYmxlIHN0cmluZ1xuICovXG5mdW5jdGlvbiBmb3JtYXRab2RUeXBlKHNjaGVtYTogei5ab2RUeXBlKTogc3RyaW5nIHtcbiAgaWYgKCFzY2hlbWEgfHwgIXNjaGVtYS5fZGVmKSByZXR1cm4gXCJ1bmtub3duXCI7XG4gIGNvbnN0IGRlZiA9IHNjaGVtYS5fZGVmIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbnN0IHR5cGVOYW1lID0gZ2V0Wm9kVHlwZU5hbWUoc2NoZW1hKTtcblxuICBzd2l0Y2ggKHR5cGVOYW1lKSB7XG4gICAgY2FzZSBcIlpvZFN0cmluZ1wiOlxuICAgIGNhc2UgXCJzdHJpbmdcIjpcbiAgICAgIHJldHVybiBcInN0cmluZ1wiO1xuICAgIGNhc2UgXCJab2ROdW1iZXJcIjpcbiAgICBjYXNlIFwibnVtYmVyXCI6XG4gICAgICByZXR1cm4gXCJudW1iZXJcIjtcbiAgICBjYXNlIFwiWm9kQm9vbGVhblwiOlxuICAgIGNhc2UgXCJib29sZWFuXCI6XG4gICAgICByZXR1cm4gXCJib29sZWFuXCI7XG4gICAgY2FzZSBcIlpvZExpdGVyYWxcIjpcbiAgICBjYXNlIFwibGl0ZXJhbFwiOlxuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGRlZi52YWx1ZSk7XG4gICAgY2FzZSBcIlpvZEVudW1cIjpcbiAgICBjYXNlIFwiZW51bVwiOiB7XG4gICAgICAvLyBab2QgMyB1c2VzIHZhbHVlcyBhcnJheSwgWm9kIDQgdXNlcyBlbnRyaWVzIG9iamVjdFxuICAgICAgbGV0IHZhbHVlczogc3RyaW5nW107XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShkZWYudmFsdWVzKSkge1xuICAgICAgICB2YWx1ZXMgPSBkZWYudmFsdWVzIGFzIHN0cmluZ1tdO1xuICAgICAgfSBlbHNlIGlmIChkZWYuZW50cmllcyAmJiB0eXBlb2YgZGVmLmVudHJpZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgdmFsdWVzID0gT2JqZWN0LnZhbHVlcyhkZWYuZW50cmllcyBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBcImVudW1cIjtcbiAgICAgIH1cbiAgICAgIHJldHVybiB2YWx1ZXMubWFwKCh2KSA9PiBgXCIke3Z9XCJgKS5qb2luKFwiIHwgXCIpO1xuICAgIH1cbiAgICBjYXNlIFwiWm9kQXJyYXlcIjpcbiAgICBjYXNlIFwiYXJyYXlcIjoge1xuICAgICAgLy8gc2FmZWx5IHJlc29sdmUgaW5uZXIgdHlwZSBmb3IgWm9kIGFycmF5c1xuICAgICAgY29uc3QgaW5uZXIgPSAoXG4gICAgICAgIHR5cGVvZiBkZWYuZWxlbWVudCA9PT0gXCJvYmplY3RcIlxuICAgICAgICAgID8gZGVmLmVsZW1lbnRcbiAgICAgICAgICA6IHR5cGVvZiBkZWYudHlwZSA9PT0gXCJvYmplY3RcIlxuICAgICAgICAgICAgPyBkZWYudHlwZVxuICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICkgYXMgei5ab2RUeXBlIHwgdW5kZWZpbmVkO1xuICAgICAgcmV0dXJuIGlubmVyID8gYEFycmF5PCR7Zm9ybWF0Wm9kVHlwZShpbm5lcil9PmAgOiBcIkFycmF5PHVua25vd24+XCI7XG4gICAgfVxuICAgIGNhc2UgXCJab2RPYmplY3RcIjpcbiAgICBjYXNlIFwib2JqZWN0XCI6IHtcbiAgICAgIC8vIFNoYXBlIGNhbiBiZSBhIGZ1bmN0aW9uIChab2QgMykgb3IgZGlyZWN0IG9iamVjdCAoWm9kIDQpXG4gICAgICBjb25zdCBzaGFwZSA9XG4gICAgICAgIHR5cGVvZiBkZWYuc2hhcGUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgID8gKGRlZi5zaGFwZSBhcyAoKSA9PiBSZWNvcmQ8c3RyaW5nLCB6LlpvZFR5cGU+KSgpXG4gICAgICAgICAgOiAoZGVmLnNoYXBlIGFzIFJlY29yZDxzdHJpbmcsIHouWm9kVHlwZT4pO1xuICAgICAgaWYgKCFzaGFwZSkgcmV0dXJuIFwib2JqZWN0XCI7XG4gICAgICBjb25zdCBwcm9wcyA9IE9iamVjdC5lbnRyaWVzKHNoYXBlKVxuICAgICAgICAubWFwKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgICAgICBjb25zdCBpbm5lclR5cGVOYW1lID0gZ2V0Wm9kVHlwZU5hbWUodmFsdWUpO1xuICAgICAgICAgIGNvbnN0IGlzT3B0aW9uYWwgPVxuICAgICAgICAgICAgaW5uZXJUeXBlTmFtZSA9PT0gXCJab2RPcHRpb25hbFwiIHx8XG4gICAgICAgICAgICBpbm5lclR5cGVOYW1lID09PSBcIlpvZE51bGxhYmxlXCIgfHxcbiAgICAgICAgICAgIGlubmVyVHlwZU5hbWUgPT09IFwib3B0aW9uYWxcIiB8fFxuICAgICAgICAgICAgaW5uZXJUeXBlTmFtZSA9PT0gXCJudWxsYWJsZVwiO1xuICAgICAgICAgIHJldHVybiBgJHtrZXl9JHtpc09wdGlvbmFsID8gXCI/XCIgOiBcIlwifTogJHtmb3JtYXRab2RUeXBlKHZhbHVlKX1gO1xuICAgICAgICB9KVxuICAgICAgICAuam9pbihcIiwgXCIpO1xuICAgICAgcmV0dXJuIGB7ICR7cHJvcHN9IH1gO1xuICAgIH1cbiAgICBjYXNlIFwiWm9kT3B0aW9uYWxcIjpcbiAgICBjYXNlIFwib3B0aW9uYWxcIjpcbiAgICBjYXNlIFwiWm9kTnVsbGFibGVcIjpcbiAgICBjYXNlIFwibnVsbGFibGVcIjoge1xuICAgICAgY29uc3QgaW5uZXIgPSAoZGVmLmlubmVyVHlwZSBhcyB6LlpvZFR5cGUpID8/IChkZWYud3JhcHBlZCBhcyB6LlpvZFR5cGUpO1xuICAgICAgcmV0dXJuIGlubmVyID8gZm9ybWF0Wm9kVHlwZShpbm5lcikgOiBcInVua25vd25cIjtcbiAgICB9XG4gICAgY2FzZSBcIlpvZFVuaW9uXCI6XG4gICAgY2FzZSBcInVuaW9uXCI6IHtcbiAgICAgIGNvbnN0IG9wdGlvbnMgPSBkZWYub3B0aW9ucyBhcyB6LlpvZFR5cGVbXSB8IHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiBvcHRpb25zXG4gICAgICAgID8gb3B0aW9ucy5tYXAoKG9wdCkgPT4gZm9ybWF0Wm9kVHlwZShvcHQpKS5qb2luKFwiIHwgXCIpXG4gICAgICAgIDogXCJ1bmtub3duXCI7XG4gICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gXCJ1bmtub3duXCI7XG4gIH1cbn1cblxuLyoqXG4gKiBDb252ZXJ0IFpvZCBzY2hlbWEgdG8gSlNPTiBTY2hlbWFcbiAqL1xuZnVuY3Rpb24gem9kVG9Kc29uU2NoZW1hKHNjaGVtYTogei5ab2RUeXBlKTogb2JqZWN0IHtcbiAgLy8gU2ltcGxpZmllZCBKU09OIFNjaGVtYSBjb252ZXJzaW9uXG4gIGNvbnN0IGRlZiA9IHNjaGVtYS5fZGVmIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbnN0IHR5cGVOYW1lID0gKGRlZi50eXBlTmFtZSBhcyBzdHJpbmcpID8/IFwiXCI7XG5cbiAgc3dpdGNoICh0eXBlTmFtZSkge1xuICAgIGNhc2UgXCJab2RTdHJpbmdcIjpcbiAgICAgIHJldHVybiB7IHR5cGU6IFwic3RyaW5nXCIgfTtcbiAgICBjYXNlIFwiWm9kTnVtYmVyXCI6XG4gICAgICByZXR1cm4geyB0eXBlOiBcIm51bWJlclwiIH07XG4gICAgY2FzZSBcIlpvZEJvb2xlYW5cIjpcbiAgICAgIHJldHVybiB7IHR5cGU6IFwiYm9vbGVhblwiIH07XG4gICAgY2FzZSBcIlpvZExpdGVyYWxcIjpcbiAgICAgIHJldHVybiB7IGNvbnN0OiBkZWYudmFsdWUgfTtcbiAgICBjYXNlIFwiWm9kRW51bVwiOlxuICAgICAgcmV0dXJuIHsgZW51bTogZGVmLnZhbHVlcyB9O1xuICAgIGNhc2UgXCJab2RBcnJheVwiOiB7XG4gICAgICBjb25zdCBpbm5lciA9IGRlZi50eXBlIGFzIHouWm9kVHlwZSB8IHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6IFwiYXJyYXlcIixcbiAgICAgICAgaXRlbXM6IGlubmVyID8gem9kVG9Kc29uU2NoZW1hKGlubmVyKSA6IHt9LFxuICAgICAgfTtcbiAgICB9XG4gICAgY2FzZSBcIlpvZE9iamVjdFwiOiB7XG4gICAgICBjb25zdCBzaGFwZSA9IChkZWYuc2hhcGUgYXMgKCkgPT4gUmVjb3JkPHN0cmluZywgei5ab2RUeXBlPik/LigpO1xuICAgICAgaWYgKCFzaGFwZSkgcmV0dXJuIHsgdHlwZTogXCJvYmplY3RcIiB9O1xuICAgICAgY29uc3QgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgb2JqZWN0PiA9IHt9O1xuICAgICAgY29uc3QgcmVxdWlyZWQ6IHN0cmluZ1tdID0gW107XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzaGFwZSkpIHtcbiAgICAgICAgcHJvcGVydGllc1trZXldID0gem9kVG9Kc29uU2NoZW1hKHZhbHVlKTtcbiAgICAgICAgY29uc3QgaW5uZXJEZWYgPSB2YWx1ZS5fZGVmIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgIGlmIChcbiAgICAgICAgICBpbm5lckRlZi50eXBlTmFtZSAhPT0gXCJab2RPcHRpb25hbFwiICYmXG4gICAgICAgICAgaW5uZXJEZWYudHlwZU5hbWUgIT09IFwiWm9kTnVsbGFibGVcIlxuICAgICAgICApIHtcbiAgICAgICAgICByZXF1aXJlZC5wdXNoKGtleSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6IFwib2JqZWN0XCIsXG4gICAgICAgIHByb3BlcnRpZXMsXG4gICAgICAgIHJlcXVpcmVkOiByZXF1aXJlZC5sZW5ndGggPiAwID8gcmVxdWlyZWQgOiB1bmRlZmluZWQsXG4gICAgICAgIGFkZGl0aW9uYWxQcm9wZXJ0aWVzOiBmYWxzZSxcbiAgICAgIH07XG4gICAgfVxuICAgIGNhc2UgXCJab2RSZWNvcmRcIjoge1xuICAgICAgY29uc3QgdmFsdWVUeXBlID0gZGVmLnZhbHVlVHlwZSBhcyB6LlpvZFR5cGUgfCB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiBcIm9iamVjdFwiLFxuICAgICAgICBhZGRpdGlvbmFsUHJvcGVydGllczogdmFsdWVUeXBlID8gem9kVG9Kc29uU2NoZW1hKHZhbHVlVHlwZSkgOiB0cnVlLFxuICAgICAgfTtcbiAgICB9XG4gICAgY2FzZSBcIlpvZE9wdGlvbmFsXCI6XG4gICAgY2FzZSBcIlpvZE51bGxhYmxlXCI6IHtcbiAgICAgIGNvbnN0IGlubmVyID0gZGVmLmlubmVyVHlwZSBhcyB6LlpvZFR5cGUgfCB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4gaW5uZXIgPyB6b2RUb0pzb25TY2hlbWEoaW5uZXIpIDoge307XG4gICAgfVxuICAgIGNhc2UgXCJab2RVbmlvblwiOiB7XG4gICAgICBjb25zdCBvcHRpb25zID0gZGVmLm9wdGlvbnMgYXMgei5ab2RUeXBlW10gfCB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4gb3B0aW9ucyA/IHsgYW55T2Y6IG9wdGlvbnMubWFwKHpvZFRvSnNvblNjaGVtYSkgfSA6IHt9O1xuICAgIH1cbiAgICBjYXNlIFwiWm9kQW55XCI6XG4gICAgICByZXR1cm4ge307XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB7fTtcbiAgfVxufVxuXG4vKipcbiAqIFNob3J0aGFuZDogRGVmaW5lIGEgY2F0YWxvZyBkaXJlY3RseSBmcm9tIGEgc2NoZW1hXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZpbmVDYXRhbG9nPFxuICBURGVmIGV4dGVuZHMgU2NoZW1hRGVmaW5pdGlvbixcbiAgVENhdGFsb2cgZXh0ZW5kcyBJbmZlckNhdGFsb2dJbnB1dDxURGVmW1wiY2F0YWxvZ1wiXT4sXG4+KHNjaGVtYTogU2NoZW1hPFREZWY+LCBjYXRhbG9nOiBUQ2F0YWxvZyk6IENhdGFsb2c8VERlZiwgVENhdGFsb2c+IHtcbiAgcmV0dXJuIHNjaGVtYS5jcmVhdGVDYXRhbG9nKGNhdGFsb2cpO1xufVxuIiwgImltcG9ydCB0eXBlIHsgU3BlYyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYnVpbGRpbmcgYSB1c2VyIHByb21wdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBVc2VyUHJvbXB0T3B0aW9ucyB7XG4gIC8qKiBUaGUgdXNlcidzIHRleHQgcHJvbXB0ICovXG4gIHByb21wdDogc3RyaW5nO1xuICAvKiogRXhpc3Rpbmcgc3BlYyB0byByZWZpbmUgKHRyaWdnZXJzIHBhdGNoLW9ubHkgbW9kZSkgKi9cbiAgY3VycmVudFNwZWM/OiBTcGVjIHwgbnVsbDtcbiAgLyoqIFJ1bnRpbWUgc3RhdGUgY29udGV4dCB0byBpbmNsdWRlICovXG4gIHN0YXRlPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsO1xuICAvKiogTWF4aW11bSBsZW5ndGggZm9yIHRoZSB1c2VyJ3MgdGV4dCBwcm9tcHQgKGFwcGxpZWQgYmVmb3JlIHdyYXBwaW5nKSAqL1xuICBtYXhQcm9tcHRMZW5ndGg/OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ2hlY2sgd2hldGhlciBhIHNwZWMgaXMgbm9uLWVtcHR5IChoYXMgYSByb290IGFuZCBhdCBsZWFzdCBvbmUgZWxlbWVudCkuXG4gKi9cbmZ1bmN0aW9uIGlzTm9uRW1wdHlTcGVjKHNwZWM6IHVua25vd24pOiBzcGVjIGlzIFNwZWMge1xuICBpZiAoIXNwZWMgfHwgdHlwZW9mIHNwZWMgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcyA9IHNwZWMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHMucm9vdCA9PT0gXCJzdHJpbmdcIiAmJlxuICAgIHR5cGVvZiBzLmVsZW1lbnRzID09PSBcIm9iamVjdFwiICYmXG4gICAgcy5lbGVtZW50cyAhPT0gbnVsbCAmJlxuICAgIE9iamVjdC5rZXlzKHMuZWxlbWVudHMgYXMgb2JqZWN0KS5sZW5ndGggPiAwXG4gICk7XG59XG5cbmNvbnN0IFBBVENIX0lOU1RSVUNUSU9OUyA9IGBJTVBPUlRBTlQ6IFRoZSBjdXJyZW50IFVJIGlzIGFscmVhZHkgbG9hZGVkLiBPdXRwdXQgT05MWSB0aGUgcGF0Y2hlcyBuZWVkZWQgdG8gbWFrZSB0aGUgcmVxdWVzdGVkIGNoYW5nZTpcbi0gVG8gYWRkIGEgbmV3IGVsZW1lbnQ6IHtcIm9wXCI6XCJhZGRcIixcInBhdGhcIjpcIi9lbGVtZW50cy9uZXcta2V5XCIsXCJ2YWx1ZVwiOnsuLi59fVxuLSBUbyBtb2RpZnkgYW4gZXhpc3RpbmcgZWxlbWVudDoge1wib3BcIjpcInJlcGxhY2VcIixcInBhdGhcIjpcIi9lbGVtZW50cy9leGlzdGluZy1rZXlcIixcInZhbHVlXCI6ey4uLn19XG4tIFRvIHJlbW92ZSBhbiBlbGVtZW50OiB7XCJvcFwiOlwicmVtb3ZlXCIsXCJwYXRoXCI6XCIvZWxlbWVudHMvb2xkLWtleVwifVxuLSBUbyB1cGRhdGUgdGhlIHJvb3Q6IHtcIm9wXCI6XCJyZXBsYWNlXCIsXCJwYXRoXCI6XCIvcm9vdFwiLFwidmFsdWVcIjpcIm5ldy1yb290LWtleVwifVxuLSBUbyBhZGQgY2hpbGRyZW46IHVwZGF0ZSB0aGUgcGFyZW50IGVsZW1lbnQgd2l0aCBuZXcgY2hpbGRyZW4gYXJyYXlcblxuRE8gTk9UIG91dHB1dCBwYXRjaGVzIGZvciBlbGVtZW50cyB0aGF0IGRvbid0IG5lZWQgdG8gY2hhbmdlLiBPbmx5IG91dHB1dCB3aGF0J3MgbmVjZXNzYXJ5IGZvciB0aGUgcmVxdWVzdGVkIG1vZGlmaWNhdGlvbi5gO1xuXG4vKipcbiAqIEJ1aWxkIGEgdXNlciBwcm9tcHQgZm9yIEFJIGdlbmVyYXRpb24uXG4gKlxuICogSGFuZGxlcyBjb21tb24gcGF0dGVybnMgdGhhdCBldmVyeSBjb25zdW1pbmcgYXBwIG5lZWRzOlxuICogLSBUcnVuY2F0aW5nIHRoZSB1c2VyJ3MgcHJvbXB0IHRvIGEgbWF4IGxlbmd0aFxuICogLSBJbmNsdWRpbmcgdGhlIGN1cnJlbnQgc3BlYyBmb3IgcmVmaW5lbWVudCAocGF0Y2gtb25seSBtb2RlKVxuICogLSBJbmNsdWRpbmcgcnVudGltZSBzdGF0ZSBjb250ZXh0XG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBGcmVzaCBnZW5lcmF0aW9uXG4gKiBidWlsZFVzZXJQcm9tcHQoeyBwcm9tcHQ6IFwiY3JlYXRlIGEgdG9kbyBhcHBcIiB9KVxuICpcbiAqIC8vIFJlZmluZW1lbnQgd2l0aCBleGlzdGluZyBzcGVjXG4gKiBidWlsZFVzZXJQcm9tcHQoeyBwcm9tcHQ6IFwiYWRkIGEgZGFyayBtb2RlIHRvZ2dsZVwiLCBjdXJyZW50U3BlYzogc3BlYyB9KVxuICpcbiAqIC8vIFdpdGggc3RhdGUgY29udGV4dFxuICogYnVpbGRVc2VyUHJvbXB0KHsgcHJvbXB0OiBcInNob3cgbXkgZGF0YVwiLCBzdGF0ZTogeyB0b2RvczogW10gfSB9KVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFVzZXJQcm9tcHQob3B0aW9uczogVXNlclByb21wdE9wdGlvbnMpOiBzdHJpbmcge1xuICBjb25zdCB7IHByb21wdCwgY3VycmVudFNwZWMsIHN0YXRlLCBtYXhQcm9tcHRMZW5ndGggfSA9IG9wdGlvbnM7XG5cbiAgLy8gU2FuaXRpemUgYW5kIG9wdGlvbmFsbHkgdHJ1bmNhdGUgdGhlIHVzZXIncyB0ZXh0XG4gIGxldCB1c2VyVGV4dCA9IFN0cmluZyhwcm9tcHQgfHwgXCJcIik7XG4gIGlmIChtYXhQcm9tcHRMZW5ndGggIT09IHVuZGVmaW5lZCAmJiBtYXhQcm9tcHRMZW5ndGggPiAwKSB7XG4gICAgdXNlclRleHQgPSB1c2VyVGV4dC5zbGljZSgwLCBtYXhQcm9tcHRMZW5ndGgpO1xuICB9XG5cbiAgLy8gLS0tIFJlZmluZW1lbnQgbW9kZTogY3VycmVudFNwZWMgaXMgcHJvdmlkZWQgLS0tXG4gIGlmIChpc05vbkVtcHR5U3BlYyhjdXJyZW50U3BlYykpIHtcbiAgICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcblxuICAgIHBhcnRzLnB1c2goXG4gICAgICBgQ1VSUkVOVCBVSSBTVEFURSAoYWxyZWFkeSBsb2FkZWQsIERPIE5PVCByZWNyZWF0ZSBleGlzdGluZyBlbGVtZW50cyk6YCxcbiAgICApO1xuICAgIHBhcnRzLnB1c2goSlNPTi5zdHJpbmdpZnkoY3VycmVudFNwZWMsIG51bGwsIDIpKTtcbiAgICBwYXJ0cy5wdXNoKFwiXCIpO1xuICAgIHBhcnRzLnB1c2goYFVTRVIgUkVRVUVTVDogJHt1c2VyVGV4dH1gKTtcblxuICAgIC8vIEFwcGVuZCBzdGF0ZSBjb250ZXh0IGlmIHByb3ZpZGVkXG4gICAgaWYgKHN0YXRlICYmIE9iamVjdC5rZXlzKHN0YXRlKS5sZW5ndGggPiAwKSB7XG4gICAgICBwYXJ0cy5wdXNoKFwiXCIpO1xuICAgICAgcGFydHMucHVzaChgQVZBSUxBQkxFIFNUQVRFOlxcbiR7SlNPTi5zdHJpbmdpZnkoc3RhdGUsIG51bGwsIDIpfWApO1xuICAgIH1cblxuICAgIHBhcnRzLnB1c2goXCJcIik7XG4gICAgcGFydHMucHVzaChQQVRDSF9JTlNUUlVDVElPTlMpO1xuXG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oXCJcXG5cIik7XG4gIH1cblxuICAvLyAtLS0gRnJlc2ggZ2VuZXJhdGlvbiBtb2RlIC0tLVxuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbdXNlclRleHRdO1xuXG4gIGlmIChzdGF0ZSAmJiBPYmplY3Qua2V5cyhzdGF0ZSkubGVuZ3RoID4gMCkge1xuICAgIHBhcnRzLnB1c2goYFxcbkFWQUlMQUJMRSBTVEFURTpcXG4ke0pTT04uc3RyaW5naWZ5KHN0YXRlLCBudWxsLCAyKX1gKTtcbiAgfVxuXG4gIHBhcnRzLnB1c2goXG4gICAgYFxcblJlbWVtYmVyOiBPdXRwdXQgL3Jvb3QgZmlyc3QsIHRoZW4gaW50ZXJsZWF2ZSAvZWxlbWVudHMgYW5kIC9zdGF0ZSBwYXRjaGVzIHNvIHRoZSBVSSBmaWxscyBpbiBwcm9ncmVzc2l2ZWx5IGFzIGl0IHN0cmVhbXMuIE91dHB1dCBlYWNoIHN0YXRlIHBhdGNoIHJpZ2h0IGFmdGVyIHRoZSBlbGVtZW50cyB0aGF0IHVzZSBpdCwgb25lIHBlciBhcnJheSBpdGVtLmAsXG4gICk7XG5cbiAgcmV0dXJuIHBhcnRzLmpvaW4oXCJcXG5cIik7XG59XG4iLCAiaW1wb3J0IHsgZ2V0QWdlbnRQcm9maWxlLCBsaXN0QWdlbnRQcm9maWxlcywgc2F2ZUFnZW50UHJvZmlsZSB9IGZyb20gJy4vYWdlbnQtcHJvZmlsZS1zZXJ2aWNlJztcbmltcG9ydCB7XG4gIGdldEFnZW50TG9nVGFpbCxcbiAgZ2V0QWdlbnRSdW50aW1lU3RhdHVzLFxuICBzdGFydEFnZW50UnVudGltZSxcbiAgc3RvcEFnZW50UnVudGltZSxcbn0gZnJvbSAnLi9hZ2VudC1ydW50aW1lLXNlcnZpY2UnO1xuaW1wb3J0IHsgc2VuZEFnZW50Q2hhdCB9IGZyb20gJy4vYWdlbnQtY2hhdC1zZXJ2aWNlJztcbmltcG9ydCB0eXBlIHtcbiAgQWdlbnRQcm9maWxlLFxuICBBZ2VudExvZ1RhaWwsXG4gIEFnZW50UnVudGltZVN0YXR1cyxcbiAgR2V0QWdlbnRJbnB1dCxcbiAgTGlzdEFnZW50c0lucHV0LFxuICBTYXZlQWdlbnRJbnB1dCxcbiAgU2F2ZUFnZW50UmVzdWx0LFxuICBTdGFydEFnZW50SW5wdXQsXG4gIFN0YXJ0QWdlbnRSZXN1bHQsXG4gIFN0b3BBZ2VudElucHV0LFxuICBTdG9wQWdlbnRSZXN1bHQsXG4gIEFnZW50Q2hhdElucHV0LFxuICBBZ2VudENoYXRSZXN1bHQsXG4gIEFnZW50Q2hhdFN0cmVhbUNodW5rLFxufSBmcm9tICcuL3R5cGVzJztcblxuLyoqXG4gKiBcdTY2N0FcdTgwRkRcdTRGNTNcdTU0MEVcdTdBRUZcdTYzQTVcdTUzRTNcdTk1RThcdTk3NjJcdUZGMUFcbiAqIC0gXHU0RkREXHU1QjU4XHU2NjdBXHU4MEZEXHU0RjUzXHU4RDQ0XHU2NTk5XHU0RTBFXHU4RkQwXHU4ODRDXHU5MTREXHU3RjZFXG4gKiAtIFx1ODNCN1x1NTNENlx1NTM1NVx1NEUyQVx1NjY3QVx1ODBGRFx1NEY1M1x1OEQ0NFx1NjU5OVxuICogLSBcdTUyMTdcdTUxRkFcdTUxNjhcdTkwRThcdTY2N0FcdTgwRkRcdTRGNTNcbiAqL1xuZXhwb3J0IGNvbnN0IGFnZW50QXBpID0ge1xuICBhc3luYyBzYXZlKGlucHV0OiBTYXZlQWdlbnRJbnB1dCk6IFByb21pc2U8U2F2ZUFnZW50UmVzdWx0PiB7XG4gICAgcmV0dXJuIHNhdmVBZ2VudFByb2ZpbGUoaW5wdXQpO1xuICB9LFxuXG4gIGFzeW5jIGdldChpbnB1dDogR2V0QWdlbnRJbnB1dCk6IFByb21pc2U8QWdlbnRQcm9maWxlPiB7XG4gICAgcmV0dXJuIGdldEFnZW50UHJvZmlsZShpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgbGlzdChpbnB1dD86IExpc3RBZ2VudHNJbnB1dCk6IFByb21pc2U8cmVhZG9ubHkgQWdlbnRQcm9maWxlW10+IHtcbiAgICByZXR1cm4gbGlzdEFnZW50UHJvZmlsZXMoaW5wdXQpO1xuICB9LFxuXG4gIGFzeW5jIHN0YXJ0KGlucHV0OiBTdGFydEFnZW50SW5wdXQpOiBQcm9taXNlPFN0YXJ0QWdlbnRSZXN1bHQ+IHtcbiAgICByZXR1cm4gc3RhcnRBZ2VudFJ1bnRpbWUoaW5wdXQpO1xuICB9LFxuXG4gIGFzeW5jIHN0b3AoaW5wdXQ6IFN0b3BBZ2VudElucHV0KTogUHJvbWlzZTxTdG9wQWdlbnRSZXN1bHQ+IHtcbiAgICByZXR1cm4gc3RvcEFnZW50UnVudGltZShpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgc3RhdHVzKGFnZW50SWQ6IHN0cmluZyk6IFByb21pc2U8QWdlbnRSdW50aW1lU3RhdHVzPiB7XG4gICAgcmV0dXJuIGdldEFnZW50UnVudGltZVN0YXR1cyhhZ2VudElkKTtcbiAgfSxcblxuICBhc3luYyBsb2dUYWlsKGFnZW50SWQ6IHN0cmluZywgbGluZXNDb3VudD86IG51bWJlciwgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxBZ2VudExvZ1RhaWw+IHtcbiAgICByZXR1cm4gZ2V0QWdlbnRMb2dUYWlsKGFnZW50SWQsIGhvbWVEaXJPdmVycmlkZSwgbGluZXNDb3VudCk7XG4gIH0sXG5cbiAgYXN5bmMgY2hhdChpbnB1dDogQWdlbnRDaGF0SW5wdXQsIG9uQ2h1bms/OiAoY2h1bms6IEFnZW50Q2hhdFN0cmVhbUNodW5rKSA9PiB2b2lkKTogUHJvbWlzZTxBZ2VudENoYXRSZXN1bHQ+IHtcbiAgICByZXR1cm4gc2VuZEFnZW50Q2hhdChpbnB1dCwgb25DaHVuayk7XG4gIH0sXG59O1xuIiwgImltcG9ydCB7IEFHRU5UX0lQQ19DSEFOTkVMUyB9IGZyb20gJy4vaXBjLWNvbnRyYWN0JztcbmltcG9ydCB7IGFnZW50QXBpIH0gZnJvbSAnLi9hZ2VudC1hcGknO1xuaW1wb3J0IHR5cGUge1xuICBBZ2VudFByb2ZpbGUsXG4gIEFnZW50UnVudGltZVN0YXR1cyxcbiAgQWdlbnRMb2dUYWlsLFxuICBHZXRBZ2VudElucHV0LFxuICBHZXRBZ2VudExvZ1RhaWxJbnB1dCxcbiAgTGlzdEFnZW50c0lucHV0LFxuICBTYXZlQWdlbnRJbnB1dCxcbiAgU2F2ZUFnZW50UmVzdWx0LFxuICBTdGFydEFnZW50SW5wdXQsXG4gIFN0YXJ0QWdlbnRSZXN1bHQsXG4gIFN0b3BBZ2VudElucHV0LFxuICBTdG9wQWdlbnRSZXN1bHQsXG4gIEFnZW50Q2hhdElucHV0LFxuICBBZ2VudENoYXRSZXN1bHQsXG4gIFNldHRpbmdzQXBpRmFpbHVyZSxcbiAgU2V0dGluZ3NBcGlSZXN1bHQsXG59IGZyb20gJy4vdHlwZXMnO1xuXG5pbnRlcmZhY2UgSXBjTWFpbkxpa2Uge1xuICBoYW5kbGUoY2hhbm5lbDogc3RyaW5nLCBsaXN0ZW5lcjogKF9ldmVudDogdW5rbm93biwgcGF5bG9hZD86IHVua25vd24pID0+IFByb21pc2U8dW5rbm93bj4pOiB2b2lkO1xufVxuXG50eXBlIEFnZW50SGFuZGxlclJlc3VsdE1hcCA9IHtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5zYXZlQWdlbnRdOiBTZXR0aW5nc0FwaVJlc3VsdDxTYXZlQWdlbnRSZXN1bHQ+O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLmdldEFnZW50XTogU2V0dGluZ3NBcGlSZXN1bHQ8QWdlbnRQcm9maWxlPjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5saXN0QWdlbnRzXTogU2V0dGluZ3NBcGlSZXN1bHQ8cmVhZG9ubHkgQWdlbnRQcm9maWxlW10+O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLnN0YXJ0QWdlbnRdOiBTZXR0aW5nc0FwaVJlc3VsdDxTdGFydEFnZW50UmVzdWx0PjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5zdG9wQWdlbnRdOiBTZXR0aW5nc0FwaVJlc3VsdDxTdG9wQWdlbnRSZXN1bHQ+O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50U3RhdHVzXTogU2V0dGluZ3NBcGlSZXN1bHQ8QWdlbnRSdW50aW1lU3RhdHVzPjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudExvZ1RhaWxdOiBTZXR0aW5nc0FwaVJlc3VsdDxBZ2VudExvZ1RhaWw+O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50Q2hhdF06IFNldHRpbmdzQXBpUmVzdWx0PEFnZW50Q2hhdFJlc3VsdD47XG59O1xuXG50eXBlIEFnZW50SGFuZGxlcnMgPSB7XG4gIFtLIGluIGtleW9mIEFnZW50SGFuZGxlclJlc3VsdE1hcF06IChwYXlsb2FkPzogdW5rbm93bikgPT4gUHJvbWlzZTxBZ2VudEhhbmRsZXJSZXN1bHRNYXBbS10+O1xufTtcblxuZnVuY3Rpb24gdG9GYWlsdXJlKGVycm9yOiB1bmtub3duKTogU2V0dGluZ3NBcGlGYWlsdXJlIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2s6IGZhbHNlLFxuICAgICAgZXJyb3I6IHtcbiAgICAgICAgY29kZTogJ0lOVEVSTkFMX0VSUk9SJyxcbiAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgb2s6IGZhbHNlLFxuICAgIGVycm9yOiB7XG4gICAgICBjb2RlOiAnSU5URVJOQUxfRVJST1InLFxuICAgICAgbWVzc2FnZTogJ1x1NjcyQVx1NzdFNVx1OTUxOVx1OEJFRlx1MzAwMicsXG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gdG9TdWNjZXNzPFQ+KGRhdGE6IFQpOiBTZXR0aW5nc0FwaVJlc3VsdDxUPiB7XG4gIHJldHVybiB7XG4gICAgb2s6IHRydWUsXG4gICAgZGF0YSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXNTYXZlQWdlbnRJbnB1dChwYXlsb2FkOiB1bmtub3duKTogU2F2ZUFnZW50SW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzYXZlQWdlbnQgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBTYXZlQWdlbnRJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNHZXRBZ2VudElucHV0KHBheWxvYWQ6IHVua25vd24pOiBHZXRBZ2VudElucHV0IHtcbiAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0Jykge1xuICAgIHRocm93IG5ldyBFcnJvcignZ2V0QWdlbnQgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBHZXRBZ2VudElucHV0O1xufVxuXG5mdW5jdGlvbiBhc0xpc3RBZ2VudHNJbnB1dChwYXlsb2FkOiB1bmtub3duKTogTGlzdEFnZW50c0lucHV0IHwgdW5kZWZpbmVkIHtcbiAgaWYgKHBheWxvYWQgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBpZiAodHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdsaXN0QWdlbnRzIFx1OEJGN1x1NkM0Mlx1NTNDMlx1NjU3MFx1NjgzQ1x1NUYwRlx1OTUxOVx1OEJFRlx1MzAwMicpO1xuICB9XG5cbiAgcmV0dXJuIHBheWxvYWQgYXMgTGlzdEFnZW50c0lucHV0O1xufVxuXG5mdW5jdGlvbiBhc1N0YXJ0QWdlbnRJbnB1dChwYXlsb2FkOiB1bmtub3duKTogU3RhcnRBZ2VudElucHV0IHtcbiAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0Jykge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnRBZ2VudCBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuXG4gIHJldHVybiBwYXlsb2FkIGFzIFN0YXJ0QWdlbnRJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNTdG9wQWdlbnRJbnB1dChwYXlsb2FkOiB1bmtub3duKTogU3RvcEFnZW50SW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdG9wQWdlbnQgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBTdG9wQWdlbnRJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNBZ2VudFN0YXR1c0lucHV0KHBheWxvYWQ6IHVua25vd24pOiB7IGFnZW50SWQ6IHN0cmluZyB9IHtcbiAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0Jykge1xuICAgIHRocm93IG5ldyBFcnJvcignYWdlbnRTdGF0dXMgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyB7IGFnZW50SWQ6IHN0cmluZyB9O1xufVxuXG5mdW5jdGlvbiBhc0FnZW50TG9nVGFpbElucHV0KHBheWxvYWQ6IHVua25vd24pOiBHZXRBZ2VudExvZ1RhaWxJbnB1dCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2FnZW50TG9nVGFpbCBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuXG4gIHJldHVybiBwYXlsb2FkIGFzIEdldEFnZW50TG9nVGFpbElucHV0O1xufVxuXG5mdW5jdGlvbiBhc0FnZW50Q2hhdElucHV0KHBheWxvYWQ6IHVua25vd24pOiBBZ2VudENoYXRJbnB1dCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2FnZW50Q2hhdCBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuICByZXR1cm4gcGF5bG9hZCBhcyBBZ2VudENoYXRJbnB1dDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUFnZW50SXBjSGFuZGxlcnMoKTogQWdlbnRIYW5kbGVycyB7XG4gIHJldHVybiB7XG4gICAgYXN5bmMgW0FHRU5UX0lQQ19DSEFOTkVMUy5zYXZlQWdlbnRdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYWdlbnRBcGkuc2F2ZShhc1NhdmVBZ2VudElucHV0KHBheWxvYWQpKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbQUdFTlRfSVBDX0NIQU5ORUxTLmdldEFnZW50XShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFnZW50QXBpLmdldChhc0dldEFnZW50SW5wdXQocGF5bG9hZCkpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtBR0VOVF9JUENfQ0hBTk5FTFMubGlzdEFnZW50c10ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS5saXN0KGFzTGlzdEFnZW50c0lucHV0KHBheWxvYWQpKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbQUdFTlRfSVBDX0NIQU5ORUxTLnN0YXJ0QWdlbnRdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYWdlbnRBcGkuc3RhcnQoYXNTdGFydEFnZW50SW5wdXQocGF5bG9hZCkpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtBR0VOVF9JUENfQ0hBTk5FTFMuc3RvcEFnZW50XShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFnZW50QXBpLnN0b3AoYXNTdG9wQWdlbnRJbnB1dChwYXlsb2FkKSk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudFN0YXR1c10ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHsgYWdlbnRJZCB9ID0gYXNBZ2VudFN0YXR1c0lucHV0KHBheWxvYWQpO1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYWdlbnRBcGkuc3RhdHVzKGFnZW50SWQpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRMb2dUYWlsXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyBhZ2VudElkLCBsaW5lc0NvdW50LCBob21lRGlyT3ZlcnJpZGUgfSA9IGFzQWdlbnRMb2dUYWlsSW5wdXQocGF5bG9hZCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS5sb2dUYWlsKGFnZW50SWQsIGxpbmVzQ291bnQsIGhvbWVEaXJPdmVycmlkZSk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudENoYXRdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYWdlbnRBcGkuY2hhdChhc0FnZW50Q2hhdElucHV0KHBheWxvYWQpKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckFnZW50SXBjSGFuZGxlcnMoaXBjTWFpbkxpa2U6IElwY01haW5MaWtlKTogdm9pZCB7XG4gIGNvbnN0IGhhbmRsZXJzID0gY3JlYXRlQWdlbnRJcGNIYW5kbGVycygpO1xuXG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuc2F2ZUFnZW50LCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5zYXZlQWdlbnRdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoQUdFTlRfSVBDX0NIQU5ORUxTLmdldEFnZW50LCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5nZXRBZ2VudF0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMubGlzdEFnZW50cywgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tBR0VOVF9JUENfQ0hBTk5FTFMubGlzdEFnZW50c10ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuc3RhcnRBZ2VudCwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tBR0VOVF9JUENfQ0hBTk5FTFMuc3RhcnRBZ2VudF0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuc3RvcEFnZW50LCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5zdG9wQWdlbnRdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50U3RhdHVzLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudFN0YXR1c10ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRMb2dUYWlsLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudExvZ1RhaWxdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50Q2hhdCwgYXN5bmMgKGV2ZW50OiBhbnksIHBheWxvYWQpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFnZW50QXBpLmNoYXQoYXNBZ2VudENoYXRJbnB1dChwYXlsb2FkKSwgKGNodW5rKSA9PiB7XG4gICAgICAgIGV2ZW50LnNlbmRlci5zZW5kKEFHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudENoYXRTdHJlYW0sIGNodW5rKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgfVxuICB9KTtcbn1cbiIsICJpbXBvcnQgeyBmaW5kTW9kZWxQcm92aWRlciwgZ2V0TW9kZWxQcm92aWRlckNhdGFsb2cgfSBmcm9tICcuL21vZGVsLXByb3ZpZGVyLWNhdGFsb2cnO1xuaW1wb3J0IHsgZW5zdXJlWmVyb0NsYXdDb25maWcsIHVwZGF0ZVplcm9DbGF3Q29uZmlnRmlsZSwgd3JpdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUgfSBmcm9tICcuL3plcm9jbGF3LWNvbmZpZy1tYW5hZ2VyJztcbmltcG9ydCB0eXBlIHtcbiAgQ29ubmVjdEN1c3RvbVByb3ZpZGVySW5wdXQsXG4gIENvbm5lY3RQcm92aWRlcklucHV0LFxuICBDb25uZWN0ZWRQcm92aWRlckl0ZW0sXG4gIERpc2Nvbm5lY3RQcm92aWRlcklucHV0LFxuICBIb3RQcm92aWRlckl0ZW0sXG4gIE1vZGVsQ2FwYWJpbGl0aWVzLFxuICBNb2RlbFNldHRpbmdzUmVzcG9uc2UsXG4gIFByb3ZpZGVyU2V0dGluZ3NSZXNwb25zZSxcbiAgUmVmcmVzaFByb3ZpZGVyTW9kZWxzSW5wdXQsXG4gIFJlZnJlc2hQcm92aWRlck1vZGVsc1Jlc3VsdCxcbiAgU2V0RGVmYXVsdE1vZGVsSW5wdXQsXG4gIFRvZ2dsZU1vZGVsRW5hYmxlZElucHV0LFxuICBUb2dnbGVQcm92aWRlckVuYWJsZWRJbnB1dCxcbiAgVXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uSW5wdXQsXG4gIFplcm9DbGF3TW9kZWxDYXRhbG9nSXRlbSxcbiAgWmVyb0NsYXdNb2RlbFByb3ZpZGVyQ29uZmlnLFxuICBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbixcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IEhPVF9QUk9WSURFUl9JRFMgPSBbJ2FudGhyb3BpYycsICdvcGVuYWknLCAnZ29vZ2xlLWFpJywgJ252aWRpYS1uaW0nLCAnZGVlcHNlZWsnXSBhcyBjb25zdDtcblxuZnVuY3Rpb24gc2x1Z2lmeShpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgcmVzdWx0ID0gaW5wdXQudHJpbSgpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTktX10rL2csICctJyk7XG4gIHJldHVybiByZXN1bHQubGVuZ3RoID4gMCA/IHJlc3VsdCA6ICdjdXN0b20tcHJvdmlkZXInO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVQcm92aWRlcklkKHByb3ZpZGVySWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmIChwcm92aWRlcklkID09PSAnbnZpZGlhJykge1xuICAgIHJldHVybiAnbnZpZGlhLW5pbSc7XG4gIH1cblxuICByZXR1cm4gcHJvdmlkZXJJZDtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQ29ubmVjdGlvbklkKHByb3ZpZGVySWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJhbmRvbSA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDgpO1xuICByZXR1cm4gYGNvbm5fJHtwcm92aWRlcklkfV8ke0RhdGUubm93KCl9XyR7cmFuZG9tfWA7XG59XG5cbmNvbnN0IFBST1ZJREVSX0lDT05fTUFQOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICBvcGVuYWk6ICdPQScsXG4gICdhenVyZS1vcGVuYWknOiAnQU8nLFxuICBhbnRocm9waWM6ICdBTicsXG4gICdnb29nbGUtYWknOiAnR0EnLFxuICBkZWVwc2VlazogJ0RTJyxcbiAgcXdlbjogJ1FXJyxcbiAgbW9vbnNob3Q6ICdNUycsXG4gIHpoaXB1OiAnWlAnLFxuICBiYWljaHVhbjogJ0JDJyxcbiAgbWluaW1heDogJ01NJyxcbiAgJ3ZvbGNlbmdpbmUtYXJrJzogJ1ZBJyxcbiAgc2lsaWNvbmZsb3c6ICdTRicsXG4gIHRvZ2V0aGVyOiAnVEcnLFxuICBmaXJld29ya3M6ICdGVycsXG4gIGdyb3E6ICdHUScsXG4gIGNvaGVyZTogJ0NIJyxcbiAgbWlzdHJhbDogJ01TJyxcbiAgeGFpOiAnWEEnLFxuICAnbnZpZGlhLW5pbSc6ICdOVicsXG4gIG9wZW5yb3V0ZXI6ICdPUicsXG4gIHBlcnBsZXhpdHk6ICdQWCcsXG4gIG9sbGFtYTogJ09MJyxcbiAgbG1zdHVkaW86ICdMTScsXG4gIHZsbG06ICdWTCcsXG4gICdodWdnaW5nZmFjZS1pbmZlcmVuY2UnOiAnSEYnLFxuICAnYXdzLWJlZHJvY2snOiAnQUInLFxuICAnYXp1cmUtYWktaW5mZXJlbmNlJzogJ0FJJyxcbiAgJ2FsaWJhYmEtYmFpbGlhbic6ICdBTCcsXG59O1xuXG5mdW5jdGlvbiBidWlsZFByb3ZpZGVySW5pdGlhbHMocHJvdmlkZXJJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHByb3ZpZGVySWQudHJpbSgpLnJlcGxhY2UoL1teYS16MC05XSsvZ2ksICcgJyk7XG4gIGNvbnN0IHBhcnRzID0gbm9ybWFsaXplZC5zcGxpdCgvXFxzKy8pLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuICdBSSc7XG4gIGlmIChwYXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gcGFydHNbMF0uc2xpY2UoMCwgMikudG9VcHBlckNhc2UoKTtcbiAgfVxuICByZXR1cm4gcGFydHNcbiAgICAubWFwKChwYXJ0KSA9PiBwYXJ0WzBdPy50b1VwcGVyQ2FzZSgpID8/ICcnKVxuICAgIC5qb2luKCcnKVxuICAgIC5zbGljZSgwLCAyKTtcbn1cblxuZnVuY3Rpb24gZ2V0UHJvdmlkZXJJY29uKHByb3ZpZGVySWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBQUk9WSURFUl9JQ09OX01BUFtwcm92aWRlcklkXSA/PyBidWlsZFByb3ZpZGVySW5pdGlhbHMocHJvdmlkZXJJZCk7XG59XG5cbmZ1bmN0aW9uIG1hc2tBcGlLZXkoYXBpS2V5Pzogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFhcGlLZXkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgaWYgKGFwaUtleS5sZW5ndGggPD0gOCkge1xuICAgIHJldHVybiAnKioqKic7XG4gIH1cblxuICByZXR1cm4gYCR7YXBpS2V5LnNsaWNlKDAsIDQpfSoqKioke2FwaUtleS5zbGljZSgtNCl9YDtcbn1cblxuZnVuY3Rpb24gaW5mZXJNb2RlbENhcGFiaWxpdGllcyhtb2RlbE5hbWU6IHN0cmluZyk6IE1vZGVsQ2FwYWJpbGl0aWVzIHtcbiAgY29uc3QgbG93ZXIgPSBtb2RlbE5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3QgaGFzSW1hZ2VJbnB1dEtleXdvcmRzID1cbiAgICBsb3dlci5pbmNsdWRlcygndmlzaW9uJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygndmwnKSB8fFxuICAgIGxvd2VyLmluY2x1ZGVzKCdncHQtNG8nKSB8fFxuICAgIGxvd2VyLmluY2x1ZGVzKCdnZW1pbmknKSB8fFxuICAgIGxvd2VyLmluY2x1ZGVzKCdjbGF1ZGUnKSB8fFxuICAgIGxvd2VyLmluY2x1ZGVzKCdncm9rLTMnKSB8fFxuICAgIGxvd2VyLmluY2x1ZGVzKCdwaGktNCcpO1xuXG4gIGNvbnN0IGhhc1Rvb2xDYWxsS2V5d29yZHMgPVxuICAgIGxvd2VyLmluY2x1ZGVzKCdncHQnKSB8fCBsb3dlci5pbmNsdWRlcygnY2xhdWRlJykgfHwgbG93ZXIuaW5jbHVkZXMoJ2dlbWluaScpIHx8IGxvd2VyLmluY2x1ZGVzKCdxd2VuJyk7XG5cbiAgcmV0dXJuIHtcbiAgICB0ZXh0OiB0cnVlLFxuICAgIGltYWdlSW5wdXQ6IGhhc0ltYWdlSW5wdXRLZXl3b3JkcyxcbiAgICBpbWFnZU91dHB1dDogZmFsc2UsXG4gICAgYXVkaW9JbnB1dDogZmFsc2UsXG4gICAgdG9vbENhbGw6IGhhc1Rvb2xDYWxsS2V5d29yZHMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJ1aWxkTW9kZWxJZChwcm92aWRlcklkOiBzdHJpbmcsIG1vZGVsTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke3Byb3ZpZGVySWR9OiR7bW9kZWxOYW1lfWA7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVFbmFibGVkU2V0KFxuICBjYXRhbG9nOiByZWFkb25seSBaZXJvQ2xhd01vZGVsQ2F0YWxvZ0l0ZW1bXSxcbiAgcHJvdmlkZXJJZDogc3RyaW5nLFxuICBkZWZhdWx0RW5hYmxlZDogYm9vbGVhbixcbik6IFJlYWRvbmx5U2V0PHN0cmluZz4gfCB1bmRlZmluZWQge1xuICBjb25zdCBwcm92aWRlck1vZGVscyA9IGNhdGFsb2cuZmlsdGVyKChpdGVtKSA9PiBpdGVtLnByb3ZpZGVySWQgPT09IHByb3ZpZGVySWQpO1xuICBpZiAocHJvdmlkZXJNb2RlbHMubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBlbmFibGVkTW9kZWxzID0gcHJvdmlkZXJNb2RlbHMuZmlsdGVyKChpdGVtKSA9PiBpdGVtLmVuYWJsZWQpO1xuICBpZiAoIWRlZmF1bHRFbmFibGVkICYmIGVuYWJsZWRNb2RlbHMubGVuZ3RoID09PSBwcm92aWRlck1vZGVscy5sZW5ndGgpIHtcbiAgICByZXR1cm4gbmV3IFNldCgpO1xuICB9XG4gIHJldHVybiBuZXcgU2V0KGVuYWJsZWRNb2RlbHMubWFwKChpdGVtKSA9PiBpdGVtLm1vZGVsSWQpKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRNb2RlbENhdGFsb2dGb3JQcm92aWRlcihcbiAgcHJvdmlkZXJJZDogc3RyaW5nLFxuICBtb2RlbE5hbWVzOiByZWFkb25seSBzdHJpbmdbXSxcbiAgZW5hYmxlZFNldDogUmVhZG9ubHlTZXQ8c3RyaW5nPiB8IHVuZGVmaW5lZCxcbiAgZGVmYXVsdEVuYWJsZWQ6IGJvb2xlYW4sXG4pOiBaZXJvQ2xhd01vZGVsQ2F0YWxvZ0l0ZW1bXSB7XG4gIHJldHVybiBtb2RlbE5hbWVzLm1hcCgobW9kZWxOYW1lKSA9PiB7XG4gICAgY29uc3QgbW9kZWxJZCA9IGJ1aWxkTW9kZWxJZChwcm92aWRlcklkLCBtb2RlbE5hbWUpO1xuICAgIGNvbnN0IGVuYWJsZWQgPSBlbmFibGVkU2V0ID8gZW5hYmxlZFNldC5oYXMobW9kZWxJZCkgOiBkZWZhdWx0RW5hYmxlZDtcbiAgICByZXR1cm4ge1xuICAgICAgbW9kZWxJZCxcbiAgICAgIHByb3ZpZGVySWQsXG4gICAgICBtb2RlbE5hbWUsXG4gICAgICBkaXNwbGF5TmFtZTogbW9kZWxOYW1lLFxuICAgICAgY2FwYWJpbGl0aWVzOiBpbmZlck1vZGVsQ2FwYWJpbGl0aWVzKG1vZGVsTmFtZSksXG4gICAgICBlbmFibGVkLFxuICAgIH07XG4gIH0pO1xufVxuXG5mdW5jdGlvbiB0b01vZGVsc0VuZHBvaW50KGFwaUJhc2U6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBhcGlCYXNlLnRyaW0oKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcblxuICBpZiAobm9ybWFsaXplZC5lbmRzV2l0aCgnL3YxJykpIHtcbiAgICByZXR1cm4gYCR7bm9ybWFsaXplZH0vbW9kZWxzYDtcbiAgfVxuXG4gIHJldHVybiBgJHtub3JtYWxpemVkfS92MS9tb2RlbHNgO1xufVxuXG5mdW5jdGlvbiBidWlsZEF1dGhIZWFkZXJDYW5kaWRhdGVzKHByb3ZpZGVySWQ6IHN0cmluZywgYXBpS2V5OiBzdHJpbmcpOiByZWFkb25seSBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+W10ge1xuICBjb25zdCBjYW5kaWRhdGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+W10gPSBbXG4gICAgeyBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7YXBpS2V5fWAgfSxcbiAgXTtcblxuICBpZiAocHJvdmlkZXJJZCA9PT0gJ252aWRpYS1uaW0nKSB7XG4gICAgY2FuZGlkYXRlcy5wdXNoKHsgJ2FwaS1rZXknOiBhcGlLZXkgfSk7XG4gICAgY2FuZGlkYXRlcy5wdXNoKHsgJ05WSURJQS1BUEktS2V5JzogYXBpS2V5IH0pO1xuICAgIGNhbmRpZGF0ZXMucHVzaCh7ICdYLUFQSS1LZXknOiBhcGlLZXkgfSk7XG4gIH1cblxuICByZXR1cm4gY2FuZGlkYXRlcztcbn1cblxuYXN5bmMgZnVuY3Rpb24gZGlzY292ZXJNb2RlbHNGcm9tUmVtb3RlKFxuICBwcm92aWRlcklkOiBzdHJpbmcsXG4gIGFwaUJhc2U6IHN0cmluZyxcbiAgYXBpS2V5OiBzdHJpbmcsXG4pOiBQcm9taXNlPHJlYWRvbmx5IHN0cmluZ1tdPiB7XG4gIGNvbnN0IGVuZHBvaW50ID0gdG9Nb2RlbHNFbmRwb2ludChhcGlCYXNlKTtcbiAgY29uc3QgYXV0aENhbmRpZGF0ZXMgPSBidWlsZEF1dGhIZWFkZXJDYW5kaWRhdGVzKHByb3ZpZGVySWQsIGFwaUtleSk7XG4gIGxldCBsYXN0U3RhdHVzID0gMDtcbiAgbGV0IGxhc3RFcnJvcjogRXJyb3IgfCBudWxsID0gbnVsbDtcblxuICBmb3IgKGNvbnN0IGhlYWRlcnMgb2YgYXV0aENhbmRpZGF0ZXMpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChlbmRwb2ludCwge1xuICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgLi4uaGVhZGVycyxcbiAgICAgICAgICBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgIGxhc3RTdGF0dXMgPSByZXNwb25zZS5zdGF0dXM7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXlsb2FkID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMge1xuICAgICAgICBkYXRhPzogQXJyYXk8eyBpZD86IHN0cmluZyB9PjtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IG1vZGVsTmFtZXMgPSAocGF5bG9hZC5kYXRhID8/IFtdKVxuICAgICAgICAubWFwKChpdGVtKSA9PiBpdGVtLmlkKVxuICAgICAgICAuZmlsdGVyKChpdGVtKTogaXRlbSBpcyBzdHJpbmcgPT4gdHlwZW9mIGl0ZW0gPT09ICdzdHJpbmcnICYmIGl0ZW0udHJpbSgpLmxlbmd0aCA+IDApO1xuXG4gICAgICBpZiAobW9kZWxOYW1lcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdcdThGRENcdTdBMEJcdTZBMjFcdTU3OEJcdTUzRDFcdTczQjBcdTU5MzFcdThEMjVcdUZGMUFcdTY3MkFcdThGRDRcdTU2REVcdTRFRkJcdTRGNTVcdTZBMjFcdTU3OEJcdTMwMDInKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG1vZGVsTmFtZXM7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxhc3RFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcignXHU4RkRDXHU3QTBCXHU2QTIxXHU1NzhCXHU1M0QxXHU3M0IwXHU1OTMxXHU4RDI1Jyk7XG4gICAgfVxuICB9XG5cbiAgaWYgKGxhc3RTdGF0dXMgPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBcdThGRENcdTdBMEJcdTZBMjFcdTU3OEJcdTUzRDFcdTczQjBcdTU5MzFcdThEMjVcdUZGMUFIVFRQICR7bGFzdFN0YXR1c31gKTtcbiAgfVxuXG4gIGlmIChsYXN0RXJyb3IpIHtcbiAgICB0aHJvdyBsYXN0RXJyb3I7XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoJ1x1OEZEQ1x1N0EwQlx1NkEyMVx1NTc4Qlx1NTNEMVx1NzNCMFx1NTkzMVx1OEQyNVx1RkYxQVx1OEJGN1x1NkM0Mlx1NjcyQVx1NUI4Q1x1NjIxMFx1MzAwMicpO1xufVxuXG5mdW5jdGlvbiBtZXJnZVByb3ZpZGVyQ29uZmlncyhcbiAgcHJvdmlkZXJzOiByZWFkb25seSBaZXJvQ2xhd01vZGVsUHJvdmlkZXJDb25maWdbXSxcbiAgbmV4dFByb3ZpZGVyOiBaZXJvQ2xhd01vZGVsUHJvdmlkZXJDb25maWcsXG4pOiBaZXJvQ2xhd01vZGVsUHJvdmlkZXJDb25maWdbXSB7XG4gIGNvbnN0IGV4aXN0ZWQgPSBwcm92aWRlcnMuc29tZSgoaXRlbSkgPT4gaXRlbS5pZCA9PT0gbmV4dFByb3ZpZGVyLmlkKTtcblxuICBpZiAoZXhpc3RlZCkge1xuICAgIHJldHVybiBwcm92aWRlcnMubWFwKChpdGVtKSA9PiAoaXRlbS5pZCA9PT0gbmV4dFByb3ZpZGVyLmlkID8gbmV4dFByb3ZpZGVyIDogaXRlbSkpO1xuICB9XG5cbiAgcmV0dXJuIFsuLi5wcm92aWRlcnMsIG5leHRQcm92aWRlcl07XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2VNb2RlbENhdGFsb2dGb3JQcm92aWRlcihcbiAgY3VycmVudDogcmVhZG9ubHkgWmVyb0NsYXdNb2RlbENhdGFsb2dJdGVtW10sXG4gIHByb3ZpZGVySWQ6IHN0cmluZyxcbiAgaW5jb21pbmc6IHJlYWRvbmx5IFplcm9DbGF3TW9kZWxDYXRhbG9nSXRlbVtdLFxuKTogWmVyb0NsYXdNb2RlbENhdGFsb2dJdGVtW10ge1xuICBjb25zdCBvdGhlcnMgPSBjdXJyZW50LmZpbHRlcigoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkICE9PSBwcm92aWRlcklkKTtcbiAgcmV0dXJuIFsuLi5vdGhlcnMsIC4uLmluY29taW5nXTtcbn1cblxuZnVuY3Rpb24gdG9Db25uZWN0ZWRQcm92aWRlckl0ZW1zKFxuICBjb25uZWN0aW9uczogcmVhZG9ubHkgWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb25bXSxcbiAgbW9kZWxDYXRhbG9nOiByZWFkb25seSBaZXJvQ2xhd01vZGVsQ2F0YWxvZ0l0ZW1bXSxcbik6IENvbm5lY3RlZFByb3ZpZGVySXRlbVtdIHtcbiAgcmV0dXJuIGNvbm5lY3Rpb25zLm1hcCgoY29ubmVjdGlvbikgPT4ge1xuICAgIGNvbnN0IG1vZGVsQ291bnQgPSBtb2RlbENhdGFsb2cuZmlsdGVyKChpdGVtKSA9PiBpdGVtLnByb3ZpZGVySWQgPT09IGNvbm5lY3Rpb24ucHJvdmlkZXJJZCkubGVuZ3RoO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbm5lY3Rpb25JZDogY29ubmVjdGlvbi5jb25uZWN0aW9uSWQsXG4gICAgICBwcm92aWRlcklkOiBjb25uZWN0aW9uLnByb3ZpZGVySWQsXG4gICAgICBkaXNwbGF5TmFtZTogY29ubmVjdGlvbi5kaXNwbGF5TmFtZSxcbiAgICAgIGljb246IGNvbm5lY3Rpb24uaWNvbixcbiAgICAgIGJhZGdlOiBjb25uZWN0aW9uLmJhZGdlLFxuICAgICAgY2FuRGlzY29ubmVjdDogY29ubmVjdGlvbi5jYW5EaXNjb25uZWN0LFxuICAgICAgY29ubmVjdGVkQXQ6IGNvbm5lY3Rpb24uY29ubmVjdGVkQXQsXG4gICAgICBtb2RlbENvdW50LFxuICAgICAgaGVhbHRoOiBjb25uZWN0aW9uLmhlYWx0aCxcbiAgICAgIGFwaUJhc2U6IGNvbm5lY3Rpb24uYXBpQmFzZSxcbiAgICAgIGhhc0FwaUtleTogdHlwZW9mIGNvbm5lY3Rpb24uYXBpS2V5UGxhaW50ZXh0ID09PSAnc3RyaW5nJyAmJiBjb25uZWN0aW9uLmFwaUtleVBsYWludGV4dC5sZW5ndGggPiAwLFxuICAgIH07XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBidWlsZEhvdFByb3ZpZGVySXRlbXMoY29ubmVjdGVkUHJvdmlkZXJJZHM6IFJlYWRvbmx5U2V0PHN0cmluZz4pOiBIb3RQcm92aWRlckl0ZW1bXSB7XG4gIGNvbnN0IGNhdGFsb2cgPSBnZXRNb2RlbFByb3ZpZGVyQ2F0YWxvZygpO1xuXG4gIHJldHVybiBIT1RfUFJPVklERVJfSURTLm1hcCgocHJvdmlkZXJJZCkgPT4ge1xuICAgIGNvbnN0IHByb3ZpZGVyID0gY2F0YWxvZy5maW5kKChpdGVtKSA9PiBpdGVtLmlkID09PSBwcm92aWRlcklkKTtcblxuICAgIGlmICghcHJvdmlkZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgXHU3MEVEXHU5NUU4XHU2M0QwXHU0RjlCXHU1NTQ2XHU3RjNBXHU1OTMxXHVGRjFBJHtwcm92aWRlcklkfWApO1xuICAgIH1cblxuICAgIGNvbnN0IGFscmVhZHlDb25uZWN0ZWQgPSBjb25uZWN0ZWRQcm92aWRlcklkcy5oYXMocHJvdmlkZXJJZCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgcHJvdmlkZXJJZDogcHJvdmlkZXIuaWQsXG4gICAgICBkaXNwbGF5TmFtZTogcHJvdmlkZXIuZGlzcGxheU5hbWUsXG4gICAgICBpY29uOiBnZXRQcm92aWRlckljb24ocHJvdmlkZXIuaWQpLFxuICAgICAgc3VidGl0bGU6IGFscmVhZHlDb25uZWN0ZWRcbiAgICAgICAgPyBgJHtwcm92aWRlci5kaXNwbGF5TmFtZX0gXHU1REYyXHU4RkRFXHU2M0E1XHVGRjBDXHU1M0VGXHU1NzI4XHU0RTBBXHU2NUI5XHU3QkExXHU3NDA2YFxuICAgICAgICA6IGBcdTRGN0ZcdTc1MjggJHtwcm92aWRlci5kaXNwbGF5TmFtZX0gQVBJIFx1NUJDNlx1OTRBNVx1OEZERVx1NjNBNWAsXG4gICAgICByZWNvbW1lbmRlZDogcHJvdmlkZXIuaWQgPT09ICdhbnRocm9waWMnIHx8IHByb3ZpZGVyLmlkID09PSAnb3BlbmFpJyB8fCBwcm92aWRlci5pZCA9PT0gJ252aWRpYS1uaW0nLFxuICAgICAgY29ubmVjdFR5cGU6ICdhcGlfa2V5JyBhcyBjb25zdCxcbiAgICB9O1xuICB9KTtcbn1cblxuZnVuY3Rpb24gdXBzZXJ0Q29ubmVjdGlvbihcbiAgY3VycmVudENvbm5lY3Rpb25zOiByZWFkb25seSBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbltdLFxuICBuZXh0Q29ubmVjdGlvbjogWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24sXG4pOiBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbltdIHtcbiAgY29uc3QgZXhpc3RlZCA9IGN1cnJlbnRDb25uZWN0aW9ucy5zb21lKChjb25uZWN0aW9uKSA9PiBjb25uZWN0aW9uLnByb3ZpZGVySWQgPT09IG5leHRDb25uZWN0aW9uLnByb3ZpZGVySWQpO1xuXG4gIGlmIChleGlzdGVkKSB7XG4gICAgcmV0dXJuIGN1cnJlbnRDb25uZWN0aW9ucy5tYXAoKGNvbm5lY3Rpb24pID0+XG4gICAgICBjb25uZWN0aW9uLnByb3ZpZGVySWQgPT09IG5leHRDb25uZWN0aW9uLnByb3ZpZGVySWQgPyBuZXh0Q29ubmVjdGlvbiA6IGNvbm5lY3Rpb24sXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiBbLi4uY3VycmVudENvbm5lY3Rpb25zLCBuZXh0Q29ubmVjdGlvbl07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRQcm92aWRlclNldHRpbmdzKGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IFByb21pc2U8UHJvdmlkZXJTZXR0aW5nc1Jlc3BvbnNlPiB7XG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IGVuc3VyZVplcm9DbGF3Q29uZmlnKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGNvbm5lY3RlZFByb3ZpZGVycyA9IHRvQ29ubmVjdGVkUHJvdmlkZXJJdGVtcyhjb25maWcucHJvdmlkZXJDb25uZWN0aW9ucywgY29uZmlnLm1vZGVsQ2F0YWxvZyk7XG4gIGNvbnN0IGNvbm5lY3RlZFByb3ZpZGVySWRzID0gbmV3IFNldChjb25uZWN0ZWRQcm92aWRlcnMubWFwKChpdGVtKSA9PiBpdGVtLnByb3ZpZGVySWQpKTtcblxuICByZXR1cm4ge1xuICAgIGNvbm5lY3RlZFByb3ZpZGVycyxcbiAgICBob3RQcm92aWRlcnM6IGJ1aWxkSG90UHJvdmlkZXJJdGVtcyhjb25uZWN0ZWRQcm92aWRlcklkcyksXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb25uZWN0UHJvdmlkZXIoaW5wdXQ6IENvbm5lY3RQcm92aWRlcklucHV0KTogUHJvbWlzZTxaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbj4ge1xuICBjb25zdCBub3JtYWxpemVkUHJvdmlkZXJJZCA9IG5vcm1hbGl6ZVByb3ZpZGVySWQoaW5wdXQucHJvdmlkZXJJZCk7XG4gIGNvbnN0IHByb3ZpZGVyID0gZmluZE1vZGVsUHJvdmlkZXIobm9ybWFsaXplZFByb3ZpZGVySWQpO1xuXG4gIGlmICghcHJvdmlkZXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFx1NjVFMFx1NkNENVx1OEZERVx1NjNBNVx1NjcyQVx1NzdFNVx1NjNEMFx1NEY5Qlx1NTU0Nlx1RkYxQSR7aW5wdXQucHJvdmlkZXJJZH1gKTtcbiAgfVxuXG4gIGNvbnN0IGFwaUJhc2UgPSAoaW5wdXQuYXBpQmFzZSA/PyBwcm92aWRlci5hcGlCYXNlKS50cmltKCk7XG4gIGNvbnN0IGF1dG9EaXNjb3Zlck1vZGVscyA9IGlucHV0LmF1dG9EaXNjb3Zlck1vZGVscyA/PyB0cnVlO1xuICBsZXQgbW9kZWxOYW1lcyA9IHByb3ZpZGVyLmRlZmF1bHRNb2RlbHM7XG4gIGxldCBtb2RlbFNvdXJjZTogJ2NhdGFsb2cnIHwgJ2xpdmUnID0gJ2NhdGFsb2cnO1xuICBsZXQgaGVhbHRoOiAnb2snIHwgJ3dhcm5pbmcnIHwgJ2Vycm9yJyA9ICdvayc7XG5cbiAgaWYgKGF1dG9EaXNjb3Zlck1vZGVscyAmJiBpbnB1dC5jb25uZWN0VHlwZSA9PT0gJ2FwaV9rZXknICYmIHR5cGVvZiBpbnB1dC5hcGlLZXkgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpc2NvdmVyZWQgPSBhd2FpdCBkaXNjb3Zlck1vZGVsc0Zyb21SZW1vdGUocHJvdmlkZXIuaWQsIGFwaUJhc2UsIGlucHV0LmFwaUtleSk7XG4gICAgICBtb2RlbE5hbWVzID0gZGlzY292ZXJlZDtcbiAgICAgIG1vZGVsU291cmNlID0gJ2xpdmUnO1xuICAgIH0gY2F0Y2gge1xuICAgICAgaGVhbHRoID0gJ3dhcm5pbmcnO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHByb3ZpZGVyQ29uZmlnOiBaZXJvQ2xhd01vZGVsUHJvdmlkZXJDb25maWcgPSB7XG4gICAgaWQ6IHByb3ZpZGVyLmlkLFxuICAgIGRpc3BsYXlOYW1lOiBwcm92aWRlci5kaXNwbGF5TmFtZSxcbiAgICBhcGlCYXNlLFxuICAgIGFwaUtleUVudjogcHJvdmlkZXIuYXBpS2V5RW52LFxuICAgIG1vZGVsczogbW9kZWxOYW1lcyxcbiAgICBlbmFibGVkOiB0cnVlLFxuICB9O1xuXG4gIGNvbnN0IGNvbm5lY3Rpb246IFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uID0ge1xuICAgIGNvbm5lY3Rpb25JZDogY3JlYXRlQ29ubmVjdGlvbklkKHByb3ZpZGVyLmlkKSxcbiAgICBwcm92aWRlcklkOiBwcm92aWRlci5pZCxcbiAgICBkaXNwbGF5TmFtZTogaW5wdXQuYWxpYXMgPz8gcHJvdmlkZXIuZGlzcGxheU5hbWUsXG4gICAgaWNvbjogZ2V0UHJvdmlkZXJJY29uKHByb3ZpZGVyLmlkKSxcbiAgICBiYWRnZTogaW5wdXQuY29ubmVjdFR5cGUgPT09ICdhcGlfa2V5JyA/ICdhcGlfa2V5JyA6ICdjb25maWcnLFxuICAgIGNvbm5lY3RUeXBlOiBpbnB1dC5jb25uZWN0VHlwZSxcbiAgICBjYW5EaXNjb25uZWN0OiB0cnVlLFxuICAgIGNvbm5lY3RlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgaGVhbHRoLFxuICAgIGFwaUJhc2UsXG4gICAgYXBpS2V5TWFza2VkOiBtYXNrQXBpS2V5KGlucHV0LmFwaUtleSksXG4gICAgYXBpS2V5UGxhaW50ZXh0OiBpbnB1dC5hcGlLZXksXG4gICAgbW9kZWxEaXNjb3Zlcnk6IHtcbiAgICAgIG1vZGU6IGF1dG9EaXNjb3Zlck1vZGVscyA/ICdyZW1vdGUnIDogJ2RlZmF1bHQnLFxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBzb3VyY2U6IG1vZGVsU291cmNlLFxuICAgIH0sXG4gIH07XG5cbiAgICBhd2FpdCB1cGRhdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUoXG4gICAgICAoY3VycmVudCkgPT4ge1xuICAgICAgICBjb25zdCBlbmFibGVkU2V0ID0gcmVzb2x2ZUVuYWJsZWRTZXQoY3VycmVudC5tb2RlbENhdGFsb2csIHByb3ZpZGVyLmlkLCBtb2RlbFNvdXJjZSA9PT0gJ2NhdGFsb2cnKTtcbiAgICAgICAgY29uc3QgcHJvdmlkZXJNb2RlbHMgPSBidWlsZE1vZGVsQ2F0YWxvZ0ZvclByb3ZpZGVyKFxuICAgICAgICAgIHByb3ZpZGVyLmlkLFxuICAgICAgICAgIG1vZGVsTmFtZXMsXG4gICAgICAgICAgZW5hYmxlZFNldCxcbiAgICAgICAgICBtb2RlbFNvdXJjZSA9PT0gJ2NhdGFsb2cnLFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBtb2RlbFByb3ZpZGVycyA9IG1lcmdlUHJvdmlkZXJDb25maWdzKGN1cnJlbnQubW9kZWxQcm92aWRlcnMsIHByb3ZpZGVyQ29uZmlnKTtcbiAgICAgICAgY29uc3QgbW9kZWxDYXRhbG9nID0gcmVwbGFjZU1vZGVsQ2F0YWxvZ0ZvclByb3ZpZGVyKGN1cnJlbnQubW9kZWxDYXRhbG9nLCBwcm92aWRlci5pZCwgcHJvdmlkZXJNb2RlbHMpO1xuICAgICAgY29uc3QgcHJvdmlkZXJDb25uZWN0aW9ucyA9IHVwc2VydENvbm5lY3Rpb24oY3VycmVudC5wcm92aWRlckNvbm5lY3Rpb25zLCBjb25uZWN0aW9uKTtcbiAgICAgIGNvbnN0IGRlZmF1bHRNb2RlbElkID1cbiAgICAgICAgY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZCAmJlxuICAgICAgICBtb2RlbENhdGFsb2cuc29tZSgoaXRlbSkgPT4gaXRlbS5tb2RlbElkID09PSBjdXJyZW50LmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkKVxuICAgICAgICAgID8gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZFxuICAgICAgICAgIDogcHJvdmlkZXJNb2RlbHNbMF0/Lm1vZGVsSWQ7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmN1cnJlbnQsXG4gICAgICAgIGRlZmF1bHRzOiB7XG4gICAgICAgICAgLi4uY3VycmVudC5kZWZhdWx0cyxcbiAgICAgICAgICBwcmltYXJ5UHJvdmlkZXJJZDogcHJvdmlkZXIuaWQsXG4gICAgICAgICAgZGVmYXVsdE1vZGVsSWQsXG4gICAgICAgIH0sXG4gICAgICAgIG1vZGVsUHJvdmlkZXJzLFxuICAgICAgICBtb2RlbENhdGFsb2csXG4gICAgICAgIHByb3ZpZGVyQ29ubmVjdGlvbnMsXG4gICAgICB9O1xuICAgIH0sXG4gICAgaW5wdXQuaG9tZURpck92ZXJyaWRlLFxuICApO1xuXG4gIHJldHVybiBjb25uZWN0aW9uO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29ubmVjdEN1c3RvbVByb3ZpZGVyKFxuICBpbnB1dDogQ29ubmVjdEN1c3RvbVByb3ZpZGVySW5wdXQsXG4pOiBQcm9taXNlPFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uPiB7XG4gIGNvbnN0IHByb3ZpZGVySWQgPSBgY3VzdG9tLSR7c2x1Z2lmeShpbnB1dC5kaXNwbGF5TmFtZSl9YDtcbiAgY29uc3QgZGlzcGxheU5hbWUgPSBpbnB1dC5hbGlhcyA/PyBpbnB1dC5kaXNwbGF5TmFtZTtcbiAgY29uc3QgYXBpS2V5RW52ID0gYENVU1RPTV8ke3NsdWdpZnkoaW5wdXQuZGlzcGxheU5hbWUpLnRvVXBwZXJDYXNlKCkucmVwbGFjZSgvLS9nLCAnXycpfV9BUElfS0VZYDtcbiAgY29uc3QgYXV0b0Rpc2NvdmVyTW9kZWxzID0gaW5wdXQuYXV0b0Rpc2NvdmVyTW9kZWxzID8/IHRydWU7XG5cbiAgbGV0IG1vZGVsTmFtZXMgPSBpbnB1dC5tb2RlbHMubGVuZ3RoID4gMCA/IGlucHV0Lm1vZGVscyA6IFsnY3VzdG9tLW1vZGVsJ107XG4gIGxldCBtb2RlbFNvdXJjZTogJ2NhdGFsb2cnIHwgJ2xpdmUnID0gJ2NhdGFsb2cnO1xuICBsZXQgaGVhbHRoOiAnb2snIHwgJ3dhcm5pbmcnIHwgJ2Vycm9yJyA9ICdvayc7XG5cbiAgaWYgKGF1dG9EaXNjb3Zlck1vZGVscyAmJiB0eXBlb2YgaW5wdXQuYXBpS2V5ID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXNjb3ZlcmVkID0gYXdhaXQgZGlzY292ZXJNb2RlbHNGcm9tUmVtb3RlKHByb3ZpZGVySWQsIGlucHV0LmFwaUJhc2UsIGlucHV0LmFwaUtleSk7XG4gICAgICBtb2RlbE5hbWVzID0gZGlzY292ZXJlZDtcbiAgICAgIG1vZGVsU291cmNlID0gJ2xpdmUnO1xuICAgIH0gY2F0Y2gge1xuICAgICAgaGVhbHRoID0gJ3dhcm5pbmcnO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHByb3ZpZGVyQ29uZmlnOiBaZXJvQ2xhd01vZGVsUHJvdmlkZXJDb25maWcgPSB7XG4gICAgaWQ6IHByb3ZpZGVySWQsXG4gICAgZGlzcGxheU5hbWUsXG4gICAgYXBpQmFzZTogaW5wdXQuYXBpQmFzZSxcbiAgICBhcGlLZXlFbnYsXG4gICAgbW9kZWxzOiBtb2RlbE5hbWVzLFxuICAgIGVuYWJsZWQ6IHRydWUsXG4gIH07XG5cbiAgY29uc3QgY29ubmVjdGlvbjogWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24gPSB7XG4gICAgY29ubmVjdGlvbklkOiBjcmVhdGVDb25uZWN0aW9uSWQocHJvdmlkZXJJZCksXG4gICAgcHJvdmlkZXJJZCxcbiAgICBkaXNwbGF5TmFtZSxcbiAgICBpY29uOiBnZXRQcm92aWRlckljb24ocHJvdmlkZXJJZCksXG4gICAgYmFkZ2U6ICdjdXN0b20nLFxuICAgIGNvbm5lY3RUeXBlOiAnY29uZmlnJyxcbiAgICBjYW5EaXNjb25uZWN0OiB0cnVlLFxuICAgIGNvbm5lY3RlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgaGVhbHRoLFxuICAgIGFwaUJhc2U6IGlucHV0LmFwaUJhc2UsXG4gICAgYXBpS2V5TWFza2VkOiBtYXNrQXBpS2V5KGlucHV0LmFwaUtleSksXG4gICAgYXBpS2V5UGxhaW50ZXh0OiBpbnB1dC5hcGlLZXksXG4gICAgbW9kZWxEaXNjb3Zlcnk6IHtcbiAgICAgIG1vZGU6IGF1dG9EaXNjb3Zlck1vZGVscyA/ICdyZW1vdGUnIDogJ2RlZmF1bHQnLFxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBzb3VyY2U6IG1vZGVsU291cmNlLFxuICAgIH0sXG4gIH07XG5cbiAgICBhd2FpdCB1cGRhdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUoXG4gICAgICAoY3VycmVudCkgPT4ge1xuICAgICAgICBjb25zdCBlbmFibGVkU2V0ID0gcmVzb2x2ZUVuYWJsZWRTZXQoY3VycmVudC5tb2RlbENhdGFsb2csIHByb3ZpZGVySWQsIG1vZGVsU291cmNlID09PSAnY2F0YWxvZycpO1xuICAgICAgICBjb25zdCBwcm92aWRlck1vZGVscyA9IGJ1aWxkTW9kZWxDYXRhbG9nRm9yUHJvdmlkZXIoXG4gICAgICAgICAgcHJvdmlkZXJJZCxcbiAgICAgICAgICBtb2RlbE5hbWVzLFxuICAgICAgICAgIGVuYWJsZWRTZXQsXG4gICAgICAgICAgbW9kZWxTb3VyY2UgPT09ICdjYXRhbG9nJyxcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgbW9kZWxQcm92aWRlcnMgPSBtZXJnZVByb3ZpZGVyQ29uZmlncyhjdXJyZW50Lm1vZGVsUHJvdmlkZXJzLCBwcm92aWRlckNvbmZpZyk7XG4gICAgICAgIGNvbnN0IG1vZGVsQ2F0YWxvZyA9IHJlcGxhY2VNb2RlbENhdGFsb2dGb3JQcm92aWRlcihjdXJyZW50Lm1vZGVsQ2F0YWxvZywgcHJvdmlkZXJJZCwgcHJvdmlkZXJNb2RlbHMpO1xuICAgICAgY29uc3QgcHJvdmlkZXJDb25uZWN0aW9ucyA9IHVwc2VydENvbm5lY3Rpb24oY3VycmVudC5wcm92aWRlckNvbm5lY3Rpb25zLCBjb25uZWN0aW9uKTtcbiAgICAgIGNvbnN0IGRlZmF1bHRNb2RlbElkID1cbiAgICAgICAgY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZCAmJlxuICAgICAgICBtb2RlbENhdGFsb2cuc29tZSgoaXRlbSkgPT4gaXRlbS5tb2RlbElkID09PSBjdXJyZW50LmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkKVxuICAgICAgICAgID8gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZFxuICAgICAgICAgIDogcHJvdmlkZXJNb2RlbHNbMF0/Lm1vZGVsSWQ7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmN1cnJlbnQsXG4gICAgICAgIGRlZmF1bHRzOiB7XG4gICAgICAgICAgLi4uY3VycmVudC5kZWZhdWx0cyxcbiAgICAgICAgICBwcmltYXJ5UHJvdmlkZXJJZDogcHJvdmlkZXJJZCxcbiAgICAgICAgICBkZWZhdWx0TW9kZWxJZCxcbiAgICAgICAgfSxcbiAgICAgICAgbW9kZWxQcm92aWRlcnMsXG4gICAgICAgIG1vZGVsQ2F0YWxvZyxcbiAgICAgICAgcHJvdmlkZXJDb25uZWN0aW9ucyxcbiAgICAgIH07XG4gICAgfSxcbiAgICBpbnB1dC5ob21lRGlyT3ZlcnJpZGUsXG4gICk7XG5cbiAgcmV0dXJuIGNvbm5lY3Rpb247XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkaXNjb25uZWN0UHJvdmlkZXIoaW5wdXQ6IERpc2Nvbm5lY3RQcm92aWRlcklucHV0KTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IHVwZGF0ZVplcm9DbGF3Q29uZmlnRmlsZShcbiAgICAoY3VycmVudCkgPT4ge1xuICAgICAgY29uc3QgdGFyZ2V0Q29ubmVjdGlvbiA9IGN1cnJlbnQucHJvdmlkZXJDb25uZWN0aW9ucy5maW5kKFxuICAgICAgICAoY29ubmVjdGlvbikgPT4gY29ubmVjdGlvbi5jb25uZWN0aW9uSWQgPT09IGlucHV0LmNvbm5lY3Rpb25JZCxcbiAgICAgICk7XG5cbiAgICAgIGlmICghdGFyZ2V0Q29ubmVjdGlvbikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFx1OEZERVx1NjNBNVx1NEUwRFx1NUI1OFx1NTcyOFx1RkYxQSR7aW5wdXQuY29ubmVjdGlvbklkfWApO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwcm92aWRlckNvbm5lY3Rpb25zID0gY3VycmVudC5wcm92aWRlckNvbm5lY3Rpb25zLmZpbHRlcihcbiAgICAgICAgKGNvbm5lY3Rpb24pID0+IGNvbm5lY3Rpb24uY29ubmVjdGlvbklkICE9PSBpbnB1dC5jb25uZWN0aW9uSWQsXG4gICAgICApO1xuXG4gICAgICBjb25zdCBoYXNTYW1lUHJvdmlkZXJDb25uZWN0aW9uID0gcHJvdmlkZXJDb25uZWN0aW9ucy5zb21lKFxuICAgICAgICAoY29ubmVjdGlvbikgPT4gY29ubmVjdGlvbi5wcm92aWRlcklkID09PSB0YXJnZXRDb25uZWN0aW9uLnByb3ZpZGVySWQsXG4gICAgICApO1xuXG4gICAgICBjb25zdCBtb2RlbFByb3ZpZGVycyA9IGN1cnJlbnQubW9kZWxQcm92aWRlcnNcbiAgICAgICAgLm1hcCgocHJvdmlkZXIpID0+XG4gICAgICAgICAgcHJvdmlkZXIuaWQgPT09IHRhcmdldENvbm5lY3Rpb24ucHJvdmlkZXJJZFxuICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgLi4ucHJvdmlkZXIsXG4gICAgICAgICAgICAgICAgZW5hYmxlZDogaGFzU2FtZVByb3ZpZGVyQ29ubmVjdGlvbixcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgOiBwcm92aWRlcixcbiAgICAgICAgKVxuICAgICAgICAuZmlsdGVyKChwcm92aWRlcikgPT4gcHJvdmlkZXIuZW5hYmxlZCk7XG5cbiAgICAgIGNvbnN0IG1vZGVsQ2F0YWxvZyA9IGN1cnJlbnQubW9kZWxDYXRhbG9nLmZpbHRlcihcbiAgICAgICAgKG1vZGVsKSA9PiBtb2RlbC5wcm92aWRlcklkICE9PSB0YXJnZXRDb25uZWN0aW9uLnByb3ZpZGVySWQsXG4gICAgICApO1xuXG4gICAgICBjb25zdCBuZXh0UHJpbWFyeVByb3ZpZGVySWQgPVxuICAgICAgICBjdXJyZW50LmRlZmF1bHRzLnByaW1hcnlQcm92aWRlcklkID09PSB0YXJnZXRDb25uZWN0aW9uLnByb3ZpZGVySWRcbiAgICAgICAgICA/IHByb3ZpZGVyQ29ubmVjdGlvbnNbMF0/LnByb3ZpZGVySWRcbiAgICAgICAgICA6IGN1cnJlbnQuZGVmYXVsdHMucHJpbWFyeVByb3ZpZGVySWQ7XG5cbiAgICAgIGNvbnN0IG5leHREZWZhdWx0TW9kZWxJZCA9XG4gICAgICAgIHR5cGVvZiBjdXJyZW50LmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkID09PSAnc3RyaW5nJyAmJlxuICAgICAgICBtb2RlbENhdGFsb2cuc29tZSgoaXRlbSkgPT4gaXRlbS5tb2RlbElkID09PSBjdXJyZW50LmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkKVxuICAgICAgICAgID8gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZFxuICAgICAgICAgIDogbW9kZWxDYXRhbG9nLmZpbmQoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCA9PT0gbmV4dFByaW1hcnlQcm92aWRlcklkKT8ubW9kZWxJZDtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY3VycmVudCxcbiAgICAgICAgZGVmYXVsdHM6IHtcbiAgICAgICAgICAuLi5jdXJyZW50LmRlZmF1bHRzLFxuICAgICAgICAgIHByaW1hcnlQcm92aWRlcklkOiBuZXh0UHJpbWFyeVByb3ZpZGVySWQsXG4gICAgICAgICAgZGVmYXVsdE1vZGVsSWQ6IG5leHREZWZhdWx0TW9kZWxJZCxcbiAgICAgICAgfSxcbiAgICAgICAgcHJvdmlkZXJDb25uZWN0aW9ucyxcbiAgICAgICAgbW9kZWxQcm92aWRlcnMsXG4gICAgICAgIG1vZGVsQ2F0YWxvZyxcbiAgICAgIH07XG4gICAgfSxcbiAgICBpbnB1dC5ob21lRGlyT3ZlcnJpZGUsXG4gICk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRNb2RlbFNldHRpbmdzKGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IFByb21pc2U8TW9kZWxTZXR0aW5nc1Jlc3BvbnNlPiB7XG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IGVuc3VyZVplcm9DbGF3Q29uZmlnKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGNvbm5lY3RlZFByb3ZpZGVySWRzID0gbmV3IFNldChjb25maWcucHJvdmlkZXJDb25uZWN0aW9ucy5tYXAoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCkpO1xuXG4gIHJldHVybiB7XG4gICAgcHJvdmlkZXJzOiBjb25maWcucHJvdmlkZXJDb25uZWN0aW9ucy5tYXAoKGl0ZW0pID0+ICh7XG4gICAgICBjb25uZWN0aW9uSWQ6IGl0ZW0uY29ubmVjdGlvbklkLFxuICAgICAgcHJvdmlkZXJJZDogaXRlbS5wcm92aWRlcklkLFxuICAgICAgZGlzcGxheU5hbWU6IGl0ZW0uZGlzcGxheU5hbWUsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgIH0pKSxcbiAgICBtb2RlbHM6IGNvbmZpZy5tb2RlbENhdGFsb2dcbiAgICAgIC5maWx0ZXIoKGl0ZW0pID0+IGNvbm5lY3RlZFByb3ZpZGVySWRzLmhhcyhpdGVtLnByb3ZpZGVySWQpKVxuICAgICAgLm1hcCgoaXRlbSkgPT4gKHtcbiAgICAgICAgbW9kZWxJZDogaXRlbS5tb2RlbElkLFxuICAgICAgICBwcm92aWRlcklkOiBpdGVtLnByb3ZpZGVySWQsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBpdGVtLmRpc3BsYXlOYW1lLFxuICAgICAgICBzdXBwb3J0c0ltYWdlSW5wdXQ6IGl0ZW0uY2FwYWJpbGl0aWVzLmltYWdlSW5wdXQsXG4gICAgICAgIHN1cHBvcnRzVG9vbENhbGw6IGl0ZW0uY2FwYWJpbGl0aWVzLnRvb2xDYWxsLFxuICAgICAgICBlbmFibGVkOiBpdGVtLmVuYWJsZWQsXG4gICAgICAgIGlzRGVmYXVsdDogY29uZmlnLmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkID09PSBpdGVtLm1vZGVsSWQsXG4gICAgICB9KSksXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZXREZWZhdWx0TW9kZWwoaW5wdXQ6IFNldERlZmF1bHRNb2RlbElucHV0KTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IGVuc3VyZVplcm9DbGF3Q29uZmlnKGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IHNlbGVjdGVkTW9kZWwgPSBjb25maWcubW9kZWxDYXRhbG9nLmZpbmQoKGl0ZW0pID0+IGl0ZW0ubW9kZWxJZCA9PT0gaW5wdXQubW9kZWxJZCk7XG5cbiAgaWYgKCFzZWxlY3RlZE1vZGVsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBcdTZBMjFcdTU3OEJcdTRFMERcdTVCNThcdTU3MjhcdUZGMUEke2lucHV0Lm1vZGVsSWR9YCk7XG4gIH1cblxuICBjb25zdCBoYXNQcm92aWRlckNvbm5lY3Rpb24gPSBjb25maWcucHJvdmlkZXJDb25uZWN0aW9ucy5zb21lKFxuICAgIChpdGVtKSA9PiBpdGVtLnByb3ZpZGVySWQgPT09IHNlbGVjdGVkTW9kZWwucHJvdmlkZXJJZCxcbiAgKTtcblxuICBpZiAoIWhhc1Byb3ZpZGVyQ29ubmVjdGlvbikge1xuICAgIHRocm93IG5ldyBFcnJvcignXHU4QkU1XHU2QTIxXHU1NzhCXHU2MjQwXHU1QzVFXHU2M0QwXHU0RjlCXHU1NTQ2XHU1QzFBXHU2NzJBXHU4RkRFXHU2M0E1XHUzMDAyJyk7XG4gIH1cblxuICBhd2FpdCB3cml0ZVplcm9DbGF3Q29uZmlnRmlsZShcbiAgICB7XG4gICAgICAuLi5jb25maWcsXG4gICAgICBnZW5lcmF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgZGVmYXVsdHM6IHtcbiAgICAgICAgLi4uY29uZmlnLmRlZmF1bHRzLFxuICAgICAgICBwcmltYXJ5UHJvdmlkZXJJZDogc2VsZWN0ZWRNb2RlbC5wcm92aWRlcklkLFxuICAgICAgICBkZWZhdWx0TW9kZWxJZDogc2VsZWN0ZWRNb2RlbC5tb2RlbElkLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGlucHV0LmhvbWVEaXJPdmVycmlkZSxcbiAgKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHRvZ2dsZVByb3ZpZGVyRW5hYmxlZChpbnB1dDogVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgcHJvdmlkZXJJZCA9IG5vcm1hbGl6ZVByb3ZpZGVySWQoaW5wdXQucHJvdmlkZXJJZCk7XG5cbiAgYXdhaXQgdXBkYXRlWmVyb0NsYXdDb25maWdGaWxlKFxuICAgIChjdXJyZW50KSA9PiB7XG4gICAgICBjb25zdCB0YXJnZXRQcm92aWRlciA9IGN1cnJlbnQubW9kZWxQcm92aWRlcnMuZmluZCgoaXRlbSkgPT4gaXRlbS5pZCA9PT0gcHJvdmlkZXJJZCk7XG5cbiAgICAgIGlmICghdGFyZ2V0UHJvdmlkZXIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBcdTYzRDBcdTRGOUJcdTU1NDZcdTRFMERcdTVCNThcdTU3MjhcdUZGMUEke2lucHV0LnByb3ZpZGVySWR9YCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1vZGVsUHJvdmlkZXJzID0gY3VycmVudC5tb2RlbFByb3ZpZGVycy5tYXAoKGl0ZW0pID0+XG4gICAgICAgIGl0ZW0uaWQgPT09IHByb3ZpZGVySWRcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgLi4uaXRlbSxcbiAgICAgICAgICAgICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA6IGl0ZW0sXG4gICAgICApO1xuXG4gICAgICBjb25zdCBtb2RlbENhdGFsb2cgPSBjdXJyZW50Lm1vZGVsQ2F0YWxvZy5tYXAoKGl0ZW0pID0+XG4gICAgICAgIGl0ZW0ucHJvdmlkZXJJZCA9PT0gcHJvdmlkZXJJZFxuICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAuLi5pdGVtLFxuICAgICAgICAgICAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogaXRlbSxcbiAgICAgICk7XG5cbiAgICAgIGNvbnN0IHByb3ZpZGVyQ29ubmVjdGlvbnMgPSBjdXJyZW50LnByb3ZpZGVyQ29ubmVjdGlvbnMubWFwKChpdGVtKSA9PlxuICAgICAgICBpdGVtLnByb3ZpZGVySWQgPT09IHByb3ZpZGVySWRcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgLi4uaXRlbSxcbiAgICAgICAgICAgICAgaGVhbHRoOiBpbnB1dC5lbmFibGVkID8gKGl0ZW0uaGVhbHRoID09PSAnZXJyb3InID8gJ3dhcm5pbmcnIDogaXRlbS5oZWFsdGgpIDogJ3dhcm5pbmcnLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogaXRlbSxcbiAgICAgICk7XG5cbiAgICAgIGNvbnN0IG5leHRQcmltYXJ5UHJvdmlkZXJJZCA9XG4gICAgICAgIGN1cnJlbnQuZGVmYXVsdHMucHJpbWFyeVByb3ZpZGVySWQgPT09IHByb3ZpZGVySWQgJiYgIWlucHV0LmVuYWJsZWRcbiAgICAgICAgICA/IG1vZGVsUHJvdmlkZXJzLmZpbmQoKGl0ZW0pID0+IGl0ZW0uZW5hYmxlZCk/LmlkXG4gICAgICAgICAgOiBjdXJyZW50LmRlZmF1bHRzLnByaW1hcnlQcm92aWRlcklkO1xuXG4gICAgICBjb25zdCBuZXh0RGVmYXVsdE1vZGVsSWQgPVxuICAgICAgICB0eXBlb2YgY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgICAgbW9kZWxDYXRhbG9nLnNvbWUoKGl0ZW0pID0+IGl0ZW0ubW9kZWxJZCA9PT0gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZCAmJiBpdGVtLmVuYWJsZWQpXG4gICAgICAgICAgPyBjdXJyZW50LmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkXG4gICAgICAgICAgOiBtb2RlbENhdGFsb2cuZmluZCgoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkID09PSBuZXh0UHJpbWFyeVByb3ZpZGVySWQgJiYgaXRlbS5lbmFibGVkKT8ubW9kZWxJZDtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY3VycmVudCxcbiAgICAgICAgZGVmYXVsdHM6IHtcbiAgICAgICAgICAuLi5jdXJyZW50LmRlZmF1bHRzLFxuICAgICAgICAgIHByaW1hcnlQcm92aWRlcklkOiBuZXh0UHJpbWFyeVByb3ZpZGVySWQsXG4gICAgICAgICAgZGVmYXVsdE1vZGVsSWQ6IG5leHREZWZhdWx0TW9kZWxJZCxcbiAgICAgICAgfSxcbiAgICAgICAgcHJvdmlkZXJDb25uZWN0aW9ucyxcbiAgICAgICAgbW9kZWxQcm92aWRlcnMsXG4gICAgICAgIG1vZGVsQ2F0YWxvZyxcbiAgICAgIH07XG4gICAgfSxcbiAgICBpbnB1dC5ob21lRGlyT3ZlcnJpZGUsXG4gICk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB0b2dnbGVNb2RlbEVuYWJsZWQoaW5wdXQ6IFRvZ2dsZU1vZGVsRW5hYmxlZElucHV0KTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IHVwZGF0ZVplcm9DbGF3Q29uZmlnRmlsZShcbiAgICAoY3VycmVudCkgPT4ge1xuICAgICAgY29uc3QgdGFyZ2V0TW9kZWwgPSBjdXJyZW50Lm1vZGVsQ2F0YWxvZy5maW5kKChpdGVtKSA9PiBpdGVtLm1vZGVsSWQgPT09IGlucHV0Lm1vZGVsSWQpO1xuXG4gICAgICBpZiAoIXRhcmdldE1vZGVsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgXHU2QTIxXHU1NzhCXHU0RTBEXHU1QjU4XHU1NzI4XHVGRjFBJHtpbnB1dC5tb2RlbElkfWApO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBtb2RlbENhdGFsb2cgPSBjdXJyZW50Lm1vZGVsQ2F0YWxvZy5tYXAoKGl0ZW0pID0+XG4gICAgICAgIGl0ZW0ubW9kZWxJZCA9PT0gaW5wdXQubW9kZWxJZFxuICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAuLi5pdGVtLFxuICAgICAgICAgICAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogaXRlbSxcbiAgICAgICk7XG5cbiAgICAgIGNvbnN0IG5leHREZWZhdWx0TW9kZWxJZCA9XG4gICAgICAgIGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWQgPT09IGlucHV0Lm1vZGVsSWQgJiYgIWlucHV0LmVuYWJsZWRcbiAgICAgICAgICA/IG1vZGVsQ2F0YWxvZy5maW5kKFxuICAgICAgICAgICAgICAoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkID09PSB0YXJnZXRNb2RlbC5wcm92aWRlcklkICYmIGl0ZW0uZW5hYmxlZCxcbiAgICAgICAgICAgICk/Lm1vZGVsSWRcbiAgICAgICAgICA6IGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWQ7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmN1cnJlbnQsXG4gICAgICAgIGRlZmF1bHRzOiB7XG4gICAgICAgICAgLi4uY3VycmVudC5kZWZhdWx0cyxcbiAgICAgICAgICBkZWZhdWx0TW9kZWxJZDogbmV4dERlZmF1bHRNb2RlbElkLFxuICAgICAgICB9LFxuICAgICAgICBtb2RlbENhdGFsb2csXG4gICAgICB9O1xuICAgIH0sXG4gICAgaW5wdXQuaG9tZURpck92ZXJyaWRlLFxuICApO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFByb3ZpZGVyTW9kZWxzKFxuICBpbnB1dDogUmVmcmVzaFByb3ZpZGVyTW9kZWxzSW5wdXQsXG4pOiBQcm9taXNlPFJlZnJlc2hQcm92aWRlck1vZGVsc1Jlc3VsdD4ge1xuICBjb25zdCBwcm92aWRlcklkID0gbm9ybWFsaXplUHJvdmlkZXJJZChpbnB1dC5wcm92aWRlcklkKTtcbiAgY29uc3QgY29uZmlnID0gYXdhaXQgZW5zdXJlWmVyb0NsYXdDb25maWcoaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgcHJvdmlkZXIgPSBjb25maWcubW9kZWxQcm92aWRlcnMuZmluZCgoaXRlbSkgPT4gaXRlbS5pZCA9PT0gcHJvdmlkZXJJZCk7XG5cbiAgaWYgKCFwcm92aWRlcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgXHU2M0QwXHU0RjlCXHU1NTQ2XHU0RTBEXHU1QjU4XHU1NzI4XHVGRjFBJHtpbnB1dC5wcm92aWRlcklkfWApO1xuICB9XG5cbiAgY29uc3QgY29ubmVjdGlvbiA9IGNvbmZpZy5wcm92aWRlckNvbm5lY3Rpb25zLmZpbmQoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCA9PT0gcHJvdmlkZXJJZCk7XG4gIGxldCBzb3VyY2U6ICdjYXRhbG9nJyB8ICdsaXZlJyA9ICdjYXRhbG9nJztcbiAgbGV0IG1vZGVsTmFtZXM6IHJlYWRvbmx5IHN0cmluZ1tdID0gcHJvdmlkZXIubW9kZWxzO1xuXG4gIGlmIChjb25uZWN0aW9uPy5hcGlLZXlQbGFpbnRleHQpIHtcbiAgICB0cnkge1xuICAgICAgbW9kZWxOYW1lcyA9IGF3YWl0IGRpc2NvdmVyTW9kZWxzRnJvbVJlbW90ZShwcm92aWRlcklkLCBwcm92aWRlci5hcGlCYXNlLCBjb25uZWN0aW9uLmFwaUtleVBsYWludGV4dCk7XG4gICAgICBzb3VyY2UgPSAnbGl2ZSc7XG4gICAgfSBjYXRjaCB7XG4gICAgICBzb3VyY2UgPSAnY2F0YWxvZyc7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgcmVmcmVzaGVkUHJvdmlkZXI6IFplcm9DbGF3TW9kZWxQcm92aWRlckNvbmZpZyA9IHtcbiAgICAuLi5wcm92aWRlcixcbiAgICBtb2RlbHM6IG1vZGVsTmFtZXMsXG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgfTtcbiAgICBhd2FpdCB1cGRhdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUoXG4gICAgICAoY3VycmVudCkgPT4ge1xuICAgICAgICBjb25zdCBlbmFibGVkU2V0ID0gcmVzb2x2ZUVuYWJsZWRTZXQoY3VycmVudC5tb2RlbENhdGFsb2csIHByb3ZpZGVySWQsIGZhbHNlKTtcbiAgICAgICAgY29uc3QgcmVmcmVzaGVkQ2F0YWxvZyA9IGJ1aWxkTW9kZWxDYXRhbG9nRm9yUHJvdmlkZXIocHJvdmlkZXJJZCwgbW9kZWxOYW1lcywgZW5hYmxlZFNldCwgZmFsc2UpO1xuICAgICAgICBjb25zdCBtb2RlbFByb3ZpZGVycyA9IG1lcmdlUHJvdmlkZXJDb25maWdzKGN1cnJlbnQubW9kZWxQcm92aWRlcnMsIHJlZnJlc2hlZFByb3ZpZGVyKTtcbiAgICAgICAgY29uc3QgbW9kZWxDYXRhbG9nID0gcmVwbGFjZU1vZGVsQ2F0YWxvZ0ZvclByb3ZpZGVyKGN1cnJlbnQubW9kZWxDYXRhbG9nLCBwcm92aWRlcklkLCByZWZyZXNoZWRDYXRhbG9nKTtcbiAgICAgIGNvbnN0IHByb3ZpZGVyQ29ubmVjdGlvbnMgPSBjdXJyZW50LnByb3ZpZGVyQ29ubmVjdGlvbnMubWFwKChpdGVtKSA9PlxuICAgICAgICBpdGVtLnByb3ZpZGVySWQgPT09IHByb3ZpZGVySWRcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgLi4uaXRlbSxcbiAgICAgICAgICAgICAgaGVhbHRoOiBzb3VyY2UgPT09ICdsaXZlJyA/ICdvaycgOiBpdGVtLmhlYWx0aCxcbiAgICAgICAgICAgICAgbW9kZWxEaXNjb3Zlcnk6IHtcbiAgICAgICAgICAgICAgICBtb2RlOiBpdGVtLm1vZGVsRGlzY292ZXJ5Lm1vZGUsXG4gICAgICAgICAgICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgc291cmNlLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogaXRlbSxcbiAgICAgICk7XG5cbiAgICAgIGNvbnN0IG5leHREZWZhdWx0TW9kZWxJZCA9XG4gICAgICAgIHR5cGVvZiBjdXJyZW50LmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkID09PSAnc3RyaW5nJyAmJlxuICAgICAgICBtb2RlbENhdGFsb2cuc29tZSgoaXRlbSkgPT4gaXRlbS5tb2RlbElkID09PSBjdXJyZW50LmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkKVxuICAgICAgICAgID8gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZFxuICAgICAgICAgIDogcmVmcmVzaGVkQ2F0YWxvZ1swXT8ubW9kZWxJZDtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY3VycmVudCxcbiAgICAgICAgZGVmYXVsdHM6IHtcbiAgICAgICAgICAuLi5jdXJyZW50LmRlZmF1bHRzLFxuICAgICAgICAgIGRlZmF1bHRNb2RlbElkOiBuZXh0RGVmYXVsdE1vZGVsSWQsXG4gICAgICAgIH0sXG4gICAgICAgIG1vZGVsUHJvdmlkZXJzLFxuICAgICAgICBtb2RlbENhdGFsb2csXG4gICAgICAgIHByb3ZpZGVyQ29ubmVjdGlvbnMsXG4gICAgICB9O1xuICAgIH0sXG4gICAgaW5wdXQuaG9tZURpck92ZXJyaWRlLFxuICApO1xuXG4gIHJldHVybiB7XG4gICAgcHJvdmlkZXJJZCxcbiAgICBtb2RlbENvdW50OiBtb2RlbE5hbWVzLmxlbmd0aCxcbiAgICBzb3VyY2UsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cGRhdGVQcm92aWRlckNvbm5lY3Rpb24oXG4gIGlucHV0OiBVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dCxcbik6IFByb21pc2U8WmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24+IHtcbiAgY29uc3QgY29uZmlnID0gYXdhaXQgZW5zdXJlWmVyb0NsYXdDb25maWcoaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgdGFyZ2V0Q29ubmVjdGlvbiA9IGNvbmZpZy5wcm92aWRlckNvbm5lY3Rpb25zLmZpbmQoXG4gICAgKGNvbm5lY3Rpb24pID0+IGNvbm5lY3Rpb24uY29ubmVjdGlvbklkID09PSBpbnB1dC5jb25uZWN0aW9uSWQsXG4gICk7XG5cbiAgaWYgKCF0YXJnZXRDb25uZWN0aW9uKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBcdThGREVcdTYzQTVcdTRFMERcdTVCNThcdTU3MjhcdUZGMUEke2lucHV0LmNvbm5lY3Rpb25JZH1gKTtcbiAgfVxuXG4gIGNvbnN0IHByb3ZpZGVySWQgPSB0YXJnZXRDb25uZWN0aW9uLnByb3ZpZGVySWQ7XG4gIGNvbnN0IHByb3ZpZGVyID0gY29uZmlnLm1vZGVsUHJvdmlkZXJzLmZpbmQoKGl0ZW0pID0+IGl0ZW0uaWQgPT09IHByb3ZpZGVySWQpO1xuXG4gIGlmICghcHJvdmlkZXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFx1NjNEMFx1NEY5Qlx1NTU0Nlx1NEUwRFx1NUI1OFx1NTcyOFx1RkYxQSR7cHJvdmlkZXJJZH1gKTtcbiAgfVxuXG4gIGNvbnN0IGFwaUJhc2UgPSAoaW5wdXQuYXBpQmFzZSA/PyB0YXJnZXRDb25uZWN0aW9uLmFwaUJhc2UpLnRyaW0oKTtcbiAgY29uc3QgYXBpS2V5UGxhaW50ZXh0ID0gaW5wdXQuYXBpS2V5ID8/IHRhcmdldENvbm5lY3Rpb24uYXBpS2V5UGxhaW50ZXh0O1xuICBjb25zdCBkaXNwbGF5TmFtZSA9IGlucHV0LmFsaWFzID8/IHRhcmdldENvbm5lY3Rpb24uZGlzcGxheU5hbWU7XG4gIGNvbnN0IGF1dG9EaXNjb3Zlck1vZGVscyA9IGlucHV0LmF1dG9EaXNjb3Zlck1vZGVscyA/PyBmYWxzZTtcblxuICBsZXQgbW9kZWxOYW1lczogcmVhZG9ubHkgc3RyaW5nW10gPSBwcm92aWRlci5tb2RlbHM7XG4gIGxldCBtb2RlbFNvdXJjZTogJ2NhdGFsb2cnIHwgJ2xpdmUnID0gdGFyZ2V0Q29ubmVjdGlvbi5tb2RlbERpc2NvdmVyeS5zb3VyY2U7XG4gIGxldCBoZWFsdGg6ICdvaycgfCAnd2FybmluZycgfCAnZXJyb3InID0gdGFyZ2V0Q29ubmVjdGlvbi5oZWFsdGg7XG4gIGxldCB1cGRhdGVkTW9kZWxDYXRhbG9nID0gY29uZmlnLm1vZGVsQ2F0YWxvZztcblxuICBpZiAoYXV0b0Rpc2NvdmVyTW9kZWxzICYmIGFwaUtleVBsYWludGV4dCkge1xuICAgIHRyeSB7XG4gICAgICBtb2RlbE5hbWVzID0gYXdhaXQgZGlzY292ZXJNb2RlbHNGcm9tUmVtb3RlKHByb3ZpZGVySWQsIGFwaUJhc2UsIGFwaUtleVBsYWludGV4dCk7XG4gICAgICBtb2RlbFNvdXJjZSA9ICdsaXZlJztcbiAgICAgIGhlYWx0aCA9ICdvayc7XG4gICAgICAgIGNvbnN0IGVuYWJsZWRTZXQgPSByZXNvbHZlRW5hYmxlZFNldChjb25maWcubW9kZWxDYXRhbG9nLCBwcm92aWRlcklkLCBmYWxzZSk7XG4gICAgICAgIHVwZGF0ZWRNb2RlbENhdGFsb2cgPSByZXBsYWNlTW9kZWxDYXRhbG9nRm9yUHJvdmlkZXIoXG4gICAgICAgICAgY29uZmlnLm1vZGVsQ2F0YWxvZyxcbiAgICAgICAgICBwcm92aWRlcklkLFxuICAgICAgICAgIGJ1aWxkTW9kZWxDYXRhbG9nRm9yUHJvdmlkZXIocHJvdmlkZXJJZCwgbW9kZWxOYW1lcywgZW5hYmxlZFNldCwgZmFsc2UpLFxuICAgICAgICApO1xuICAgIH0gY2F0Y2gge1xuICAgICAgbW9kZWxTb3VyY2UgPSAnY2F0YWxvZyc7XG4gICAgICBoZWFsdGggPSAnd2FybmluZyc7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgdXBkYXRlZFByb3ZpZGVyOiBaZXJvQ2xhd01vZGVsUHJvdmlkZXJDb25maWcgPSB7XG4gICAgLi4ucHJvdmlkZXIsXG4gICAgYXBpQmFzZSxcbiAgICBtb2RlbHM6IG1vZGVsTmFtZXMsXG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgfTtcblxuICBjb25zdCB1cGRhdGVkQ29ubmVjdGlvbjogWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24gPSB7XG4gICAgLi4udGFyZ2V0Q29ubmVjdGlvbixcbiAgICBkaXNwbGF5TmFtZSxcbiAgICBhcGlCYXNlLFxuICAgIGFwaUtleVBsYWludGV4dCxcbiAgICBhcGlLZXlNYXNrZWQ6IG1hc2tBcGlLZXkoYXBpS2V5UGxhaW50ZXh0KSxcbiAgICBoZWFsdGgsXG4gICAgbW9kZWxEaXNjb3Zlcnk6IHtcbiAgICAgIG1vZGU6IGF1dG9EaXNjb3Zlck1vZGVscyA/ICdyZW1vdGUnIDogdGFyZ2V0Q29ubmVjdGlvbi5tb2RlbERpc2NvdmVyeS5tb2RlLFxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBzb3VyY2U6IG1vZGVsU291cmNlLFxuICAgIH0sXG4gIH07XG5cbiAgY29uc3QgbW9kZWxQcm92aWRlcnMgPSBtZXJnZVByb3ZpZGVyQ29uZmlncyhjb25maWcubW9kZWxQcm92aWRlcnMsIHVwZGF0ZWRQcm92aWRlcik7XG4gIGNvbnN0IHByb3ZpZGVyQ29ubmVjdGlvbnMgPSBjb25maWcucHJvdmlkZXJDb25uZWN0aW9ucy5tYXAoKGNvbm5lY3Rpb24pID0+XG4gICAgY29ubmVjdGlvbi5jb25uZWN0aW9uSWQgPT09IGlucHV0LmNvbm5lY3Rpb25JZCA/IHVwZGF0ZWRDb25uZWN0aW9uIDogY29ubmVjdGlvbixcbiAgKTtcblxuICBjb25zdCBuZXh0RGVmYXVsdE1vZGVsSWQgPVxuICAgIHR5cGVvZiBjb25maWcuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWQgPT09ICdzdHJpbmcnICYmXG4gICAgdXBkYXRlZE1vZGVsQ2F0YWxvZy5zb21lKChpdGVtKSA9PiBpdGVtLm1vZGVsSWQgPT09IGNvbmZpZy5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZClcbiAgICAgID8gY29uZmlnLmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkXG4gICAgICA6IHVwZGF0ZWRNb2RlbENhdGFsb2cuZmluZCgoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkID09PSBwcm92aWRlcklkKT8ubW9kZWxJZDtcblxuICBhd2FpdCB3cml0ZVplcm9DbGF3Q29uZmlnRmlsZShcbiAgICB7XG4gICAgICAuLi5jb25maWcsXG4gICAgICBnZW5lcmF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgZGVmYXVsdHM6IHtcbiAgICAgICAgLi4uY29uZmlnLmRlZmF1bHRzLFxuICAgICAgICBkZWZhdWx0TW9kZWxJZDogbmV4dERlZmF1bHRNb2RlbElkLFxuICAgICAgfSxcbiAgICAgIG1vZGVsUHJvdmlkZXJzLFxuICAgICAgbW9kZWxDYXRhbG9nOiB1cGRhdGVkTW9kZWxDYXRhbG9nLFxuICAgICAgcHJvdmlkZXJDb25uZWN0aW9ucyxcbiAgICB9LFxuICAgIGlucHV0LmhvbWVEaXJPdmVycmlkZSxcbiAgKTtcblxuICByZXR1cm4gdXBkYXRlZENvbm5lY3Rpb247XG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gJ25vZGU6bW9kdWxlJztcbmNvbnN0IHJlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGdldEF1dG9MYXVuY2hTZXR0aW5nKCk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIHJldHVybiBhcHAuZ2V0TG9naW5JdGVtU2V0dGluZ3MoKS5vcGVuQXRMb2dpbjtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRBdXRvTGF1bmNoU2V0dGluZyhlbmFibGVkOiBib29sZWFuKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgYXBwLnNldExvZ2luSXRlbVNldHRpbmdzKHtcbiAgICAgIG9wZW5BdExvZ2luOiBlbmFibGVkLFxuICAgICAgb3BlbkFzSGlkZGVuOiB0cnVlLFxuICAgIH0pO1xuICAgIHJldHVybiBhcHAuZ2V0TG9naW5JdGVtU2V0dGluZ3MoKS5vcGVuQXRMb2dpbjtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG4iLCAiaW1wb3J0IHtcbiAgY29ubmVjdEN1c3RvbVByb3ZpZGVyLFxuICBjb25uZWN0UHJvdmlkZXIsXG4gIGRpc2Nvbm5lY3RQcm92aWRlcixcbiAgZ2V0TW9kZWxTZXR0aW5ncyxcbiAgZ2V0UHJvdmlkZXJTZXR0aW5ncyxcbiAgcmVmcmVzaFByb3ZpZGVyTW9kZWxzLFxuICBzZXREZWZhdWx0TW9kZWwsXG4gIHRvZ2dsZU1vZGVsRW5hYmxlZCxcbiAgdG9nZ2xlUHJvdmlkZXJFbmFibGVkLFxuICB1cGRhdGVQcm92aWRlckNvbm5lY3Rpb24sXG59IGZyb20gJy4vcHJvdmlkZXItc2V0dGluZ3Mtc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7XG4gIENvbm5lY3RDdXN0b21Qcm92aWRlcklucHV0LFxuICBDb25uZWN0UHJvdmlkZXJJbnB1dCxcbiAgRGlzY29ubmVjdFByb3ZpZGVySW5wdXQsXG4gIE1vZGVsU2V0dGluZ3NSZXNwb25zZSxcbiAgUHJvdmlkZXJTZXR0aW5nc1Jlc3BvbnNlLFxuICBSZWZyZXNoUHJvdmlkZXJNb2RlbHNJbnB1dCxcbiAgUmVmcmVzaFByb3ZpZGVyTW9kZWxzUmVzdWx0LFxuICBTZXREZWZhdWx0TW9kZWxJbnB1dCxcbiAgVG9nZ2xlTW9kZWxFbmFibGVkSW5wdXQsXG4gIFRvZ2dsZVByb3ZpZGVyRW5hYmxlZElucHV0LFxuICBVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dCxcbiAgWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24sXG4gIEFwcFNldHRpbmdzLFxuICBTZXRBdXRvTGF1bmNoSW5wdXQsXG59IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgZ2V0QXV0b0xhdW5jaFNldHRpbmcsIHNldEF1dG9MYXVuY2hTZXR0aW5nIH0gZnJvbSAnLi9zeXN0ZW0tc2V0dGluZ3Mtc2VydmljZSc7XG5cbi8qKlxuICogXHU4QkJFXHU3RjZFXHU5ODc1XHU2M0E1XHU1M0UzXHU5NUU4XHU5NzYyXHVGRjFBXG4gKiAtIFx1NjNEMFx1NEY5Qlx1NTU0Nlx1NTIxN1x1ODg2OFxuICogLSBcdThGREVcdTYzQTUvXHU2NUFEXHU1RjAwXHU2M0QwXHU0RjlCXHU1NTQ2XG4gKiAtIFx1NkEyMVx1NTc4Qlx1NTIxN1x1ODg2OFxuICogLSBcdThCQkVcdTdGNkVcdTlFRDhcdThCQTRcdTZBMjFcdTU3OEJcbiAqL1xuZXhwb3J0IGNvbnN0IHNldHRpbmdzQXBpID0ge1xuICBhc3luYyBnZXRQcm92aWRlcnMoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxQcm92aWRlclNldHRpbmdzUmVzcG9uc2U+IHtcbiAgICByZXR1cm4gZ2V0UHJvdmlkZXJTZXR0aW5ncyhob21lRGlyT3ZlcnJpZGUpO1xuICB9LFxuXG4gIGFzeW5jIGNvbm5lY3RQcm92aWRlcihpbnB1dDogQ29ubmVjdFByb3ZpZGVySW5wdXQpOiBQcm9taXNlPFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uPiB7XG4gICAgcmV0dXJuIGNvbm5lY3RQcm92aWRlcihpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgY29ubmVjdEN1c3RvbVByb3ZpZGVyKFxuICAgIGlucHV0OiBDb25uZWN0Q3VzdG9tUHJvdmlkZXJJbnB1dCxcbiAgKTogUHJvbWlzZTxaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbj4ge1xuICAgIHJldHVybiBjb25uZWN0Q3VzdG9tUHJvdmlkZXIoaW5wdXQpO1xuICB9LFxuXG4gIGFzeW5jIGRpc2Nvbm5lY3RQcm92aWRlcihpbnB1dDogRGlzY29ubmVjdFByb3ZpZGVySW5wdXQpOiBQcm9taXNlPHsgb2s6IHRydWUgfT4ge1xuICAgIGF3YWl0IGRpc2Nvbm5lY3RQcm92aWRlcihpbnB1dCk7XG4gICAgcmV0dXJuIHsgb2s6IHRydWUgfTtcbiAgfSxcblxuICBhc3luYyBnZXRNb2RlbHMoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxNb2RlbFNldHRpbmdzUmVzcG9uc2U+IHtcbiAgICByZXR1cm4gZ2V0TW9kZWxTZXR0aW5ncyhob21lRGlyT3ZlcnJpZGUpO1xuICB9LFxuXG4gIGFzeW5jIHNldERlZmF1bHRNb2RlbChpbnB1dDogU2V0RGVmYXVsdE1vZGVsSW5wdXQpOiBQcm9taXNlPHsgb2s6IHRydWUgfT4ge1xuICAgIGF3YWl0IHNldERlZmF1bHRNb2RlbChpbnB1dCk7XG4gICAgcmV0dXJuIHsgb2s6IHRydWUgfTtcbiAgfSxcblxuICBhc3luYyB0b2dnbGVQcm92aWRlckVuYWJsZWQoaW5wdXQ6IFRvZ2dsZVByb3ZpZGVyRW5hYmxlZElucHV0KTogUHJvbWlzZTx7IG9rOiB0cnVlIH0+IHtcbiAgICBhd2FpdCB0b2dnbGVQcm92aWRlckVuYWJsZWQoaW5wdXQpO1xuICAgIHJldHVybiB7IG9rOiB0cnVlIH07XG4gIH0sXG5cbiAgYXN5bmMgdG9nZ2xlTW9kZWxFbmFibGVkKGlucHV0OiBUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dCk6IFByb21pc2U8eyBvazogdHJ1ZSB9PiB7XG4gICAgYXdhaXQgdG9nZ2xlTW9kZWxFbmFibGVkKGlucHV0KTtcbiAgICByZXR1cm4geyBvazogdHJ1ZSB9O1xuICB9LFxuXG4gIGFzeW5jIHJlZnJlc2hQcm92aWRlck1vZGVscyhcbiAgICBpbnB1dDogUmVmcmVzaFByb3ZpZGVyTW9kZWxzSW5wdXQsXG4gICk6IFByb21pc2U8UmVmcmVzaFByb3ZpZGVyTW9kZWxzUmVzdWx0PiB7XG4gICAgcmV0dXJuIHJlZnJlc2hQcm92aWRlck1vZGVscyhpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgdXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uKFxuICAgIGlucHV0OiBVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dCxcbiAgKTogUHJvbWlzZTxaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbj4ge1xuICAgIHJldHVybiB1cGRhdGVQcm92aWRlckNvbm5lY3Rpb24oaW5wdXQpO1xuICB9LFxuXG4gIGFzeW5jIGdldEFwcFNldHRpbmdzKCk6IFByb21pc2U8QXBwU2V0dGluZ3M+IHtcbiAgICByZXR1cm4ge1xuICAgICAgYXV0b0xhdW5jaDogZ2V0QXV0b0xhdW5jaFNldHRpbmcoKSxcbiAgICB9O1xuICB9LFxuXG4gIGFzeW5jIHNldEF1dG9MYXVuY2goaW5wdXQ6IFNldEF1dG9MYXVuY2hJbnB1dCk6IFByb21pc2U8QXBwU2V0dGluZ3M+IHtcbiAgICBjb25zdCBlbmFibGVkID0gc2V0QXV0b0xhdW5jaFNldHRpbmcoaW5wdXQuZW5hYmxlZCk7XG4gICAgcmV0dXJuIHsgYXV0b0xhdW5jaDogZW5hYmxlZCB9O1xuICB9LFxufTtcbiIsICJpbXBvcnQgeyBTRVRUSU5HU19JUENfQ0hBTk5FTFMgfSBmcm9tICcuL2lwYy1jb250cmFjdCc7XG5pbXBvcnQgeyBzZXR0aW5nc0FwaSB9IGZyb20gJy4vc2V0dGluZ3MtYXBpJztcbmltcG9ydCB0eXBlIHtcbiAgQ29ubmVjdEN1c3RvbVByb3ZpZGVySW5wdXQsXG4gIENvbm5lY3RQcm92aWRlcklucHV0LFxuICBEaXNjb25uZWN0UHJvdmlkZXJJbnB1dCxcbiAgTW9kZWxTZXR0aW5nc1Jlc3BvbnNlLFxuICBQcm92aWRlclNldHRpbmdzUmVzcG9uc2UsXG4gIFJlZnJlc2hQcm92aWRlck1vZGVsc0lucHV0LFxuICBSZWZyZXNoUHJvdmlkZXJNb2RlbHNSZXN1bHQsXG4gIFNldERlZmF1bHRNb2RlbElucHV0LFxuICBTZXR0aW5nc0FwaUZhaWx1cmUsXG4gIFNldHRpbmdzQXBpUmVzdWx0LFxuICBUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dCxcbiAgVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQsXG4gIFVwZGF0ZVByb3ZpZGVyQ29ubmVjdGlvbklucHV0LFxuICBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbixcbiAgQXBwU2V0dGluZ3MsXG4gIFNldEF1dG9MYXVuY2hJbnB1dCxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmludGVyZmFjZSBJcGNNYWluTGlrZSB7XG4gIGhhbmRsZShjaGFubmVsOiBzdHJpbmcsIGxpc3RlbmVyOiAoX2V2ZW50OiB1bmtub3duLCBwYXlsb2FkPzogdW5rbm93bikgPT4gUHJvbWlzZTx1bmtub3duPik6IHZvaWQ7XG59XG5cbnR5cGUgU2V0dGluZ3NIYW5kbGVyUmVzdWx0TWFwID0ge1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldFByb3ZpZGVyU2V0dGluZ3NdOiBTZXR0aW5nc0FwaVJlc3VsdDxQcm92aWRlclNldHRpbmdzUmVzcG9uc2U+O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmNvbm5lY3RQcm92aWRlcl06IFNldHRpbmdzQXBpUmVzdWx0PFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uPjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5jb25uZWN0Q3VzdG9tUHJvdmlkZXJdOiBTZXR0aW5nc0FwaVJlc3VsdDxaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbj47XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuZGlzY29ubmVjdFByb3ZpZGVyXTogU2V0dGluZ3NBcGlSZXN1bHQ8eyBvazogdHJ1ZSB9PjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRNb2RlbFNldHRpbmdzXTogU2V0dGluZ3NBcGlSZXN1bHQ8TW9kZWxTZXR0aW5nc1Jlc3BvbnNlPjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5zZXREZWZhdWx0TW9kZWxdOiBTZXR0aW5nc0FwaVJlc3VsdDx7IG9rOiB0cnVlIH0+O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnRvZ2dsZVByb3ZpZGVyRW5hYmxlZF06IFNldHRpbmdzQXBpUmVzdWx0PHsgb2s6IHRydWUgfT47XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlTW9kZWxFbmFibGVkXTogU2V0dGluZ3NBcGlSZXN1bHQ8eyBvazogdHJ1ZSB9PjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5yZWZyZXNoUHJvdmlkZXJNb2RlbHNdOiBTZXR0aW5nc0FwaVJlc3VsdDxSZWZyZXNoUHJvdmlkZXJNb2RlbHNSZXN1bHQ+O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnVwZGF0ZVByb3ZpZGVyQ29ubmVjdGlvbl06IFNldHRpbmdzQXBpUmVzdWx0PFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uPjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRBcHBTZXR0aW5nc106IFNldHRpbmdzQXBpUmVzdWx0PEFwcFNldHRpbmdzPjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5zZXRBdXRvTGF1bmNoXTogU2V0dGluZ3NBcGlSZXN1bHQ8QXBwU2V0dGluZ3M+O1xufTtcblxudHlwZSBTZXR0aW5nc0hhbmRsZXJzID0ge1xuICBbSyBpbiBrZXlvZiBTZXR0aW5nc0hhbmRsZXJSZXN1bHRNYXBdOiAoXG4gICAgcGF5bG9hZD86IHVua25vd24sXG4gICkgPT4gUHJvbWlzZTxTZXR0aW5nc0hhbmRsZXJSZXN1bHRNYXBbS10+O1xufTtcblxuZnVuY3Rpb24gdG9GYWlsdXJlKGVycm9yOiB1bmtub3duKTogU2V0dGluZ3NBcGlGYWlsdXJlIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2s6IGZhbHNlLFxuICAgICAgZXJyb3I6IHtcbiAgICAgICAgY29kZTogJ0lOVEVSTkFMX0VSUk9SJyxcbiAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgb2s6IGZhbHNlLFxuICAgIGVycm9yOiB7XG4gICAgICBjb2RlOiAnSU5URVJOQUxfRVJST1InLFxuICAgICAgbWVzc2FnZTogJ1x1NjcyQVx1NzdFNVx1OTUxOVx1OEJFRlx1MzAwMicsXG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gdG9TdWNjZXNzPFQ+KGRhdGE6IFQpOiBTZXR0aW5nc0FwaVJlc3VsdDxUPiB7XG4gIHJldHVybiB7XG4gICAgb2s6IHRydWUsXG4gICAgZGF0YSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXNDb25uZWN0UHJvdmlkZXJJbnB1dChwYXlsb2FkOiB1bmtub3duKTogQ29ubmVjdFByb3ZpZGVySW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjb25uZWN0UHJvdmlkZXIgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBDb25uZWN0UHJvdmlkZXJJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNDb25uZWN0Q3VzdG9tUHJvdmlkZXJJbnB1dChwYXlsb2FkOiB1bmtub3duKTogQ29ubmVjdEN1c3RvbVByb3ZpZGVySW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjb25uZWN0Q3VzdG9tUHJvdmlkZXIgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBDb25uZWN0Q3VzdG9tUHJvdmlkZXJJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNEaXNjb25uZWN0UHJvdmlkZXJJbnB1dChwYXlsb2FkOiB1bmtub3duKTogRGlzY29ubmVjdFByb3ZpZGVySW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdkaXNjb25uZWN0UHJvdmlkZXIgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBEaXNjb25uZWN0UHJvdmlkZXJJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNTZXREZWZhdWx0TW9kZWxJbnB1dChwYXlsb2FkOiB1bmtub3duKTogU2V0RGVmYXVsdE1vZGVsSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzZXREZWZhdWx0TW9kZWwgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBTZXREZWZhdWx0TW9kZWxJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNUb2dnbGVQcm92aWRlckVuYWJsZWRJbnB1dChwYXlsb2FkOiB1bmtub3duKTogVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd0b2dnbGVQcm92aWRlckVuYWJsZWQgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBUb2dnbGVQcm92aWRlckVuYWJsZWRJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dChwYXlsb2FkOiB1bmtub3duKTogVG9nZ2xlTW9kZWxFbmFibGVkSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd0b2dnbGVNb2RlbEVuYWJsZWQgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNSZWZyZXNoUHJvdmlkZXJNb2RlbHNJbnB1dChwYXlsb2FkOiB1bmtub3duKTogUmVmcmVzaFByb3ZpZGVyTW9kZWxzSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdyZWZyZXNoUHJvdmlkZXJNb2RlbHMgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBSZWZyZXNoUHJvdmlkZXJNb2RlbHNJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dChwYXlsb2FkOiB1bmtub3duKTogVXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd1cGRhdGVQcm92aWRlckNvbm5lY3Rpb24gXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNTZXRBdXRvTGF1bmNoSW5wdXQocGF5bG9hZDogdW5rbm93bik6IFNldEF1dG9MYXVuY2hJbnB1dCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NldEF1dG9MYXVuY2ggXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBTZXRBdXRvTGF1bmNoSW5wdXQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTZXR0aW5nc0lwY0hhbmRsZXJzKCk6IFNldHRpbmdzSGFuZGxlcnMge1xuICByZXR1cm4ge1xuICAgIGFzeW5jIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuZ2V0UHJvdmlkZXJTZXR0aW5nc10oKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgc2V0dGluZ3NBcGkuZ2V0UHJvdmlkZXJzKCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5jb25uZWN0UHJvdmlkZXJdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBpbnB1dCA9IGFzQ29ubmVjdFByb3ZpZGVySW5wdXQocGF5bG9hZCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzZXR0aW5nc0FwaS5jb25uZWN0UHJvdmlkZXIoaW5wdXQpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuY29ubmVjdEN1c3RvbVByb3ZpZGVyXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBhc0Nvbm5lY3RDdXN0b21Qcm92aWRlcklucHV0KHBheWxvYWQpO1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgc2V0dGluZ3NBcGkuY29ubmVjdEN1c3RvbVByb3ZpZGVyKGlucHV0KTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmRpc2Nvbm5lY3RQcm92aWRlcl0ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gYXNEaXNjb25uZWN0UHJvdmlkZXJJbnB1dChwYXlsb2FkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLmRpc2Nvbm5lY3RQcm92aWRlcihpbnB1dCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRNb2RlbFNldHRpbmdzXSgpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzZXR0aW5nc0FwaS5nZXRNb2RlbHMoKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnNldERlZmF1bHRNb2RlbF0ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gYXNTZXREZWZhdWx0TW9kZWxJbnB1dChwYXlsb2FkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLnNldERlZmF1bHRNb2RlbChpbnB1dCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy50b2dnbGVQcm92aWRlckVuYWJsZWRdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBpbnB1dCA9IGFzVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQocGF5bG9hZCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzZXR0aW5nc0FwaS50b2dnbGVQcm92aWRlckVuYWJsZWQoaW5wdXQpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlTW9kZWxFbmFibGVkXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBhc1RvZ2dsZU1vZGVsRW5hYmxlZElucHV0KHBheWxvYWQpO1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgc2V0dGluZ3NBcGkudG9nZ2xlTW9kZWxFbmFibGVkKGlucHV0KTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnJlZnJlc2hQcm92aWRlck1vZGVsc10ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gYXNSZWZyZXNoUHJvdmlkZXJNb2RlbHNJbnB1dChwYXlsb2FkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLnJlZnJlc2hQcm92aWRlck1vZGVscyhpbnB1dCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy51cGRhdGVQcm92aWRlckNvbm5lY3Rpb25dKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBpbnB1dCA9IGFzVXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uSW5wdXQocGF5bG9hZCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzZXR0aW5nc0FwaS51cGRhdGVQcm92aWRlckNvbm5lY3Rpb24oaW5wdXQpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuZ2V0QXBwU2V0dGluZ3NdKCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLmdldEFwcFNldHRpbmdzKCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5zZXRBdXRvTGF1bmNoXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBhc1NldEF1dG9MYXVuY2hJbnB1dChwYXlsb2FkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLnNldEF1dG9MYXVuY2goaW5wdXQpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyU2V0dGluZ3NJcGNIYW5kbGVycyhpcGNNYWluTGlrZTogSXBjTWFpbkxpa2UpOiB2b2lkIHtcbiAgY29uc3QgaGFuZGxlcnMgPSBjcmVhdGVTZXR0aW5nc0lwY0hhbmRsZXJzKCk7XG5cbiAgaXBjTWFpbkxpa2UuaGFuZGxlKFNFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRQcm92aWRlclNldHRpbmdzLCBhc3luYyAoKSA9PlxuICAgIGhhbmRsZXJzW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRQcm92aWRlclNldHRpbmdzXSgpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoU0VUVElOR1NfSVBDX0NIQU5ORUxTLmNvbm5lY3RQcm92aWRlciwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMuY29ubmVjdFByb3ZpZGVyXShwYXlsb2FkKSxcbiAgKTtcbiAgaXBjTWFpbkxpa2UuaGFuZGxlKFNFVFRJTkdTX0lQQ19DSEFOTkVMUy5jb25uZWN0Q3VzdG9tUHJvdmlkZXIsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+XG4gICAgaGFuZGxlcnNbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmNvbm5lY3RDdXN0b21Qcm92aWRlcl0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShTRVRUSU5HU19JUENfQ0hBTk5FTFMuZGlzY29ubmVjdFByb3ZpZGVyLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5kaXNjb25uZWN0UHJvdmlkZXJdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldE1vZGVsU2V0dGluZ3MsIGFzeW5jICgpID0+XG4gICAgaGFuZGxlcnNbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldE1vZGVsU2V0dGluZ3NdKCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShTRVRUSU5HU19JUENfQ0hBTk5FTFMuc2V0RGVmYXVsdE1vZGVsLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5zZXREZWZhdWx0TW9kZWxdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoU0VUVElOR1NfSVBDX0NIQU5ORUxTLnRvZ2dsZVByb3ZpZGVyRW5hYmxlZCwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlUHJvdmlkZXJFbmFibGVkXShwYXlsb2FkKSxcbiAgKTtcbiAgaXBjTWFpbkxpa2UuaGFuZGxlKFNFVFRJTkdTX0lQQ19DSEFOTkVMUy50b2dnbGVNb2RlbEVuYWJsZWQsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+XG4gICAgaGFuZGxlcnNbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnRvZ2dsZU1vZGVsRW5hYmxlZF0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShTRVRUSU5HU19JUENfQ0hBTk5FTFMucmVmcmVzaFByb3ZpZGVyTW9kZWxzLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5yZWZyZXNoUHJvdmlkZXJNb2RlbHNdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoU0VUVElOR1NfSVBDX0NIQU5ORUxTLnVwZGF0ZVByb3ZpZGVyQ29ubmVjdGlvbiwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMudXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uXShwYXlsb2FkKSxcbiAgKTtcbiAgaXBjTWFpbkxpa2UuaGFuZGxlKFNFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRBcHBTZXR0aW5ncywgYXN5bmMgKCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMuZ2V0QXBwU2V0dGluZ3NdKCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShTRVRUSU5HU19JUENfQ0hBTk5FTFMuc2V0QXV0b0xhdW5jaCwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMuc2V0QXV0b0xhdW5jaF0ocGF5bG9hZCksXG4gICk7XG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gJ25vZGU6bW9kdWxlJztcbmNvbnN0IHJlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCB7IEJyb3dzZXJXaW5kb3csIGRpYWxvZywgaXBjTWFpbiB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcbmltcG9ydCB7XG4gIGdldEFsbFNraWxscyxcbiAgZGVsZXRlU2tpbGwsXG4gIGltcG9ydFNraWxsRnJvbUZvbGRlcixcbiAgZ2V0QWxsTWNwU2VydmVycyxcbiAgY3JlYXRlTWNwU2VydmVyLFxuICBpbXBvcnRNY3BTZXJ2ZXJzLFxuICBkZWxldGVNY3BTZXJ2ZXIsXG4gIHVwZGF0ZU1jcFNlcnZlclN0YXRlLFxufSBmcm9tICcuL3NraWxscy1tY3Atc2VydmljZSc7XG5pbXBvcnQge1xuICBTS0lMTFNfTUNQX0NIQU5ORUxTLFxuICB0eXBlIFNraWxsSW1wb3J0SW5wdXQsXG4gIHR5cGUgTWNwU2VydmVyQ29uZmlnLFxuICB0eXBlIE1jcFNlcnZlckNyZWF0ZUlucHV0LFxuICB0eXBlIE1jcFNlcnZlckltcG9ydElucHV0LFxufSBmcm9tICcuL3NraWxscy1tY3AtdHlwZXMnO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PSBJUEMgSGFuZGxlcnMgPT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBcdTUyMUJcdTVFRkEgU2tpbGxzIFx1NTQ4QyBNQ1AgXHU3Njg0IElQQyBoYW5kbGVyc1xuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU2tpbGxzTWNwSXBjSGFuZGxlcnMoKSB7XG4gIHJldHVybiB7XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gU2tpbGxzID09PT09PT09PT09PT09PT09PT09XG5cbiAgICBbU0tJTExTX01DUF9DSEFOTkVMUy5TS0lMTFNfTElTVF06IGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBnZXRBbGxTa2lsbHMoKTtcbiAgICB9LFxuXG4gICAgW1NLSUxMU19NQ1BfQ0hBTk5FTFMuU0tJTExTX0RFTEVURV06IGFzeW5jIChfZXZlbnQ6IEVsZWN0cm9uLklwY01haW5JbnZva2VFdmVudCwgc2tpbGxJZDogc3RyaW5nKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgZGVsZXRlU2tpbGwoc2tpbGxJZCk7XG4gICAgfSxcblxuICAgIFtTS0lMTFNfTUNQX0NIQU5ORUxTLlNLSUxMU19SRUZSRVNIXTogYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGdldEFsbFNraWxscygpO1xuICAgIH0sXG5cbiAgICBbU0tJTExTX01DUF9DSEFOTkVMUy5TS0lMTFNfSU1QT1JUXTogYXN5bmMgKFxuICAgICAgZXZlbnQ6IEVsZWN0cm9uLklwY01haW5JbnZva2VFdmVudCxcbiAgICAgIGlucHV0PzogU2tpbGxJbXBvcnRJbnB1dCxcbiAgICApID0+IHtcbiAgICAgIGxldCBzb3VyY2VQYXRoID0gaW5wdXQ/LnNvdXJjZVBhdGg7XG4gICAgICBpZiAoIXNvdXJjZVBhdGgpIHtcbiAgICAgICAgY29uc3QgYnJvd3NlcldpbmRvdyA9IEJyb3dzZXJXaW5kb3cuZnJvbVdlYkNvbnRlbnRzKGV2ZW50LnNlbmRlcik7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGJyb3dzZXJXaW5kb3dcbiAgICAgICAgICA/IGF3YWl0IGRpYWxvZy5zaG93T3BlbkRpYWxvZyhicm93c2VyV2luZG93LCB7IHByb3BlcnRpZXM6IFsnb3BlbkRpcmVjdG9yeSddIH0pXG4gICAgICAgICAgOiBhd2FpdCBkaWFsb2cuc2hvd09wZW5EaWFsb2coeyBwcm9wZXJ0aWVzOiBbJ29wZW5EaXJlY3RvcnknXSB9KTtcbiAgICAgICAgaWYgKHJlc3VsdC5jYW5jZWxlZCB8fCByZXN1bHQuZmlsZVBhdGhzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiAnXHU1REYyXHU1M0Q2XHU2RDg4JyB9O1xuICAgICAgICB9XG4gICAgICAgIHNvdXJjZVBhdGggPSByZXN1bHQuZmlsZVBhdGhzWzBdO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGF3YWl0IGltcG9ydFNraWxsRnJvbUZvbGRlcihzb3VyY2VQYXRoKTtcbiAgICB9LFxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gTUNQID09PT09PT09PT09PT09PT09PT09XG5cbiAgICBbU0tJTExTX01DUF9DSEFOTkVMUy5NQ1BfTElTVF06IGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBnZXRBbGxNY3BTZXJ2ZXJzKCk7XG4gICAgfSxcblxuICAgIFtTS0lMTFNfTUNQX0NIQU5ORUxTLk1DUF9DUkVBVEVdOiBhc3luYyAoXG4gICAgICBfZXZlbnQ6IEVsZWN0cm9uLklwY01haW5JbnZva2VFdmVudCxcbiAgICAgIGlucHV0OiBNY3BTZXJ2ZXJDcmVhdGVJbnB1dCxcbiAgICApID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBjcmVhdGVNY3BTZXJ2ZXIoaW5wdXQpO1xuICAgIH0sXG5cbiAgICBbU0tJTExTX01DUF9DSEFOTkVMUy5NQ1BfSU1QT1JUXTogYXN5bmMgKFxuICAgICAgX2V2ZW50OiBFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnQsXG4gICAgICBpbnB1dDogTWNwU2VydmVySW1wb3J0SW5wdXQsXG4gICAgKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgaW1wb3J0TWNwU2VydmVycyhpbnB1dCk7XG4gICAgfSxcblxuICAgIFtTS0lMTFNfTUNQX0NIQU5ORUxTLk1DUF9ERUxFVEVdOiBhc3luYyAoXG4gICAgICBfZXZlbnQ6IEVsZWN0cm9uLklwY01haW5JbnZva2VFdmVudCxcbiAgICAgIHNlcnZlcklkOiBzdHJpbmcsXG4gICAgKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgZGVsZXRlTWNwU2VydmVyKHNlcnZlcklkKTtcbiAgICB9LFxuXG4gICAgW1NLSUxMU19NQ1BfQ0hBTk5FTFMuTUNQX1VQREFURV06IGFzeW5jIChcbiAgICAgIF9ldmVudDogRWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50LFxuICAgICAgcGF5bG9hZDogeyBzZXJ2ZXJJZDogc3RyaW5nOyB1cGRhdGVzOiBQYXJ0aWFsPE1jcFNlcnZlckNvbmZpZz4gfVxuICAgICkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHVwZGF0ZU1jcFNlcnZlclN0YXRlKHBheWxvYWQuc2VydmVySWQsIHBheWxvYWQudXBkYXRlcyk7XG4gICAgfSxcblxuICAgIFtTS0lMTFNfTUNQX0NIQU5ORUxTLk1DUF9SRUZSRVNIXTogYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGdldEFsbE1jcFNlcnZlcnMoKTtcbiAgICB9LFxuICB9O1xufVxuXG4vKipcbiAqIFx1NkNFOFx1NTE4QyBTa2lsbHMgXHU1NDhDIE1DUCBcdTc2ODQgSVBDIGhhbmRsZXJzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlclNraWxsc01jcElwY0hhbmRsZXJzKCkge1xuICBjb25zdCBoYW5kbGVycyA9IGNyZWF0ZVNraWxsc01jcElwY0hhbmRsZXJzKCk7XG5cbiAgT2JqZWN0LmVudHJpZXMoaGFuZGxlcnMpLmZvckVhY2goKFtjaGFubmVsLCBoYW5kbGVyXSkgPT4ge1xuICAgIGlwY01haW4uaGFuZGxlKGNoYW5uZWwsIGhhbmRsZXIgYXMgYW55KTtcbiAgfSk7XG5cbiAgY29uc29sZS5sb2coJ1tTa2lsbHMtTUNQXSBJUEMgaGFuZGxlcnMgXHU1REYyXHU2Q0U4XHU1MThDJyk7XG59XG4iLCAiaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNwLCByZWFkRmlsZSwgcmVhZGRpciwgcm0sIHN0YXQsIG1rZGlyLCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgfSBmcm9tICdub2RlOm1vZHVsZSc7XG5jb25zdCByZXF1aXJlID0gY3JlYXRlUmVxdWlyZShpbXBvcnQubWV0YS51cmwpO1xuY29uc3QgeyBhcHAgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XG5cbmltcG9ydCB7IGVuc3VyZVNoYXJlZFdvcmtzcGFjZSB9IGZyb20gJy4vc2hhcmVkLXdvcmtzcGFjZS1tYW5hZ2VyJztcbmltcG9ydCB0eXBlIHtcbiAgU2tpbGxJdGVtLFxuICBNY3BTZXJ2ZXJDb25maWcsXG4gIFNraWxsTWV0YWRhdGEsXG4gIFNraWxsSW1wb3J0UmVzdWx0LFxuICBNY3BTZXJ2ZXJDcmVhdGVJbnB1dCxcbiAgTWNwU2VydmVyQ3JlYXRlUmVzdWx0LFxuICBNY3BTZXJ2ZXJJbXBvcnRJbnB1dCxcbiAgTWNwU2VydmVySW1wb3J0UmVzdWx0LFxuICBNY3BTZXJ2ZXJEZWxldGVSZXN1bHQsXG59IGZyb20gJy4vc2tpbGxzLW1jcC10eXBlcyc7XG5cbmNvbnN0IFNLSUxMX0ZJTEVfQ0FORElEQVRFUyA9IFsnU0tJTExTLm1kJywgJ1NLSUxMLm1kJywgJ3NraWxscy5tZCcsICdza2lsbC5tZCddIGFzIGNvbnN0O1xuXG5mdW5jdGlvbiBwYXJzZUZyb250bWF0dGVyKGNvbnRlbnQ6IHN0cmluZyk6IFBhcnRpYWw8U2tpbGxNZXRhZGF0YT4gfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSBjb250ZW50Lm1hdGNoKC9eLS0tXFxzKihbXFxzXFxTXSo/KVxccyotLS0vKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGxpbmVzID0gbWF0Y2hbMV0uc3BsaXQoJ1xcbicpO1xuICBjb25zdCBtZXRhZGF0YTogUGFydGlhbDxTa2lsbE1ldGFkYXRhPiA9IHt9O1xuXG4gIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGVudHJ5ID0gdHJpbW1lZC5tYXRjaCgvXihcXHcrKTpcXHMqKC4rKSQvKTtcbiAgICBpZiAoIWVudHJ5KSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBrZXksIHZhbHVlXSA9IGVudHJ5O1xuICAgIGlmIChrZXkgPT09ICduYW1lJykgbWV0YWRhdGEubmFtZSA9IHZhbHVlO1xuICAgIGlmIChrZXkgPT09ICdkZXNjcmlwdGlvbicpIG1ldGFkYXRhLmRlc2NyaXB0aW9uID0gdmFsdWU7XG4gICAgaWYgKGtleSA9PT0gJ2xvY2F0aW9uJykgbWV0YWRhdGEubG9jYXRpb24gPSB2YWx1ZTtcbiAgfVxuXG4gIHJldHVybiBtZXRhZGF0YTtcbn1cblxuZnVuY3Rpb24gcGFyc2VTa2lsbEZpbGVDb250ZW50KGNvbnRlbnQ6IHN0cmluZywgZmFsbGJhY2tOYW1lOiBzdHJpbmcsIGZhbGxiYWNrTG9jYXRpb246IHN0cmluZyk6IFNraWxsTWV0YWRhdGEge1xuICBjb25zdCBmcm9udG1hdHRlciA9IHBhcnNlRnJvbnRtYXR0ZXIoY29udGVudCk7XG4gIGlmIChmcm9udG1hdHRlcj8ubmFtZSAmJiBmcm9udG1hdHRlcj8uZGVzY3JpcHRpb24pIHtcbiAgICByZXR1cm4ge1xuICAgICAgbmFtZTogZnJvbnRtYXR0ZXIubmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiBmcm9udG1hdHRlci5kZXNjcmlwdGlvbixcbiAgICAgIGxvY2F0aW9uOiBmcm9udG1hdHRlci5sb2NhdGlvbiA/PyBmYWxsYmFja0xvY2F0aW9uLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBsaW5lcyA9IGNvbnRlbnRcbiAgICAuc3BsaXQoL1xccj9cXG4vKVxuICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG5cbiAgY29uc3QgdGl0bGVMaW5lID0gbGluZXMuZmluZCgobGluZSkgPT4gbGluZS5zdGFydHNXaXRoKCcjJykpID8/IGxpbmVzWzBdO1xuICBjb25zdCBuYW1lID0gdGl0bGVMaW5lID8gdGl0bGVMaW5lLnJlcGxhY2UoL14jK1xccyovLCAnJykgOiBmYWxsYmFja05hbWU7XG4gIGNvbnN0IGRlc2NyaXB0aW9uID0gbGluZXMuZmluZCgobGluZSkgPT4gbGluZSAhPT0gdGl0bGVMaW5lKSA/PyAnXHU2NzJBXHU1ODZCXHU1MTk5XHU2M0NGXHU4RkYwJztcblxuICByZXR1cm4ge1xuICAgIG5hbWU6IG5hbWUgfHwgZmFsbGJhY2tOYW1lLFxuICAgIGRlc2NyaXB0aW9uLFxuICAgIGxvY2F0aW9uOiBmYWxsYmFja0xvY2F0aW9uLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlU2tpbGxNZXRhZGF0YShcbiAgZm9sZGVyUGF0aDogc3RyaW5nLFxuICBmb2xkZXJOYW1lOiBzdHJpbmcsXG4gIGZhbGxiYWNrTG9jYXRpb246IHN0cmluZyxcbik6IFByb21pc2U8U2tpbGxNZXRhZGF0YSB8IG51bGw+IHtcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgU0tJTExfRklMRV9DQU5ESURBVEVTKSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oZm9sZGVyUGF0aCwgY2FuZGlkYXRlKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHJlYWRGaWxlKGZpbGVQYXRoLCAndXRmLTgnKTtcbiAgICAgIHJldHVybiBwYXJzZVNraWxsRmlsZUNvbnRlbnQoY29udGVudCwgZm9sZGVyTmFtZSwgZmFsbGJhY2tMb2NhdGlvbik7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBpZ25vcmVcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZURpcmVjdG9yeShkaXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgbWtkaXIoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHBhdGhFeGlzdHModGFyZ2V0UGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHRyeSB7XG4gICAgYXdhaXQgc3RhdCh0YXJnZXRQYXRoKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFwcFNraWxsc1Jvb3QoKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGxldCBhcHBSb290OiBzdHJpbmc7XG5cbiAgaWYgKCFhcHAuaXNQYWNrYWdlZCkge1xuICAgIC8vIEluIGRldiwgdXNlIHRoZSBjdXJyZW50IGZpbGUgcGF0aCB0byBmaW5kIHRoZSBwcm9qZWN0IHJvb3RcbiAgICBjb25zdCBfX2ZpbGVuYW1lID0gZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpO1xuICAgIGNvbnN0IF9fZGlybmFtZSA9IHBhdGguZGlybmFtZShfX2ZpbGVuYW1lKTtcbiAgICAvLyBBc3N1bWluZyBmaWxlIGlzIGluIHNyYy9tYWluL3NraWxscy1tY3Atc2VydmljZS50c1xuICAgIC8vIFByb2plY3Qgcm9vdCBzaG91bGQgYmUgdHdvIGxldmVscyB1cCBmcm9tIHNyYy9tYWluXG4gICAgYXBwUm9vdCA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLicsICcuLicpO1xuICAgIGNvbnNvbGUubG9nKGBbU2tpbGxzU2VydmljZV0gRGV2IE1vZGU6IFJlc29sdmVkIHByb2plY3Qgcm9vdCBmcm9tICR7X19kaXJuYW1lfSB0byAke2FwcFJvb3R9YCk7XG4gIH0gZWxzZSB7XG4gICAgYXBwUm9vdCA9IGFwcC5nZXRBcHBQYXRoKCk7XG4gIH1cblxuICBjb25zdCBza2lsbHNSb290ID0gcGF0aC5qb2luKGFwcFJvb3QsICdza2lsbHMnKTtcbiAgY29uc29sZS5sb2coYFtTa2lsbHNTZXJ2aWNlXSBGaW5hbCBTa2lsbHMgUm9vdDogJHtza2lsbHNSb290fWApO1xuXG4gIGlmIChhd2FpdCBwYXRoRXhpc3RzKHNraWxsc1Jvb3QpKSB7XG4gICAgcmV0dXJuIHNraWxsc1Jvb3Q7XG4gIH1cblxuICBpZiAoIWFwcC5pc1BhY2thZ2VkKSB7XG4gICAgY29uc29sZS5sb2coYFtTa2lsbHNTZXJ2aWNlXSBDcmVhdGluZyBtaXNzaW5nIHNraWxscyBkaXJlY3RvcnkgYXQgJHtza2lsbHNSb290fWApO1xuICAgIGF3YWl0IGVuc3VyZURpcmVjdG9yeShza2lsbHNSb290KTtcbiAgICByZXR1cm4gc2tpbGxzUm9vdDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0U2hhcmVkU2tpbGxzUm9vdCgpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBzaGFyZWQgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoKTtcbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KHNoYXJlZC5zaGFyZWRTa2lsbHNSb290KTtcbiAgcmV0dXJuIHNoYXJlZC5zaGFyZWRTa2lsbHNSb290O1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRTaGFyZWRNY3BSb290KCk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHNoYXJlZCA9IGF3YWl0IGVuc3VyZVNoYXJlZFdvcmtzcGFjZSgpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3Rvcnkoc2hhcmVkLnNoYXJlZE1jcFJvb3QpO1xuICByZXR1cm4gc2hhcmVkLnNoYXJlZE1jcFJvb3Q7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGlzRGlyZWN0b3J5KHRhcmdldFBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICB0cnkge1xuICAgIGNvbnN0IGluZm8gPSBhd2FpdCBzdGF0KHRhcmdldFBhdGgpO1xuICAgIHJldHVybiBpbmZvLmlzRGlyZWN0b3J5KCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG50eXBlIFNraWxsU291cmNlID0gJ2FwcCcgfCAnc2hhcmVkJztcblxuZnVuY3Rpb24gY3JlYXRlU2tpbGxJZChzb3VyY2U6IFNraWxsU291cmNlLCBmb2xkZXJOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7c291cmNlfToke2ZvbGRlck5hbWV9IGA7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU2tpbGxJZChza2lsbElkOiBzdHJpbmcpOiB7IHNvdXJjZTogU2tpbGxTb3VyY2U7IGZvbGRlck5hbWU6IHN0cmluZyB9IHtcbiAgY29uc3QgW3ByZWZpeCwgcmVzdF0gPSBza2lsbElkLnNwbGl0KCc6Jyk7XG4gIGlmICgocHJlZml4ID09PSAnYXBwJyB8fCBwcmVmaXggPT09ICdzaGFyZWQnKSAmJiByZXN0KSB7XG4gICAgcmV0dXJuIHsgc291cmNlOiBwcmVmaXgsIGZvbGRlck5hbWU6IHJlc3QgfTtcbiAgfVxuICByZXR1cm4geyBzb3VyY2U6ICdzaGFyZWQnLCBmb2xkZXJOYW1lOiBza2lsbElkIH07XG59XG5cbmZ1bmN0aW9uIGJ1aWxkRmFsbGJhY2tMb2NhdGlvbihmb2xkZXJOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcGF0aC5qb2luKCdza2lsbHMnLCBmb2xkZXJOYW1lKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVhZFNraWxsc0Zyb21Sb290KFxuICBza2lsbHNSb290OiBzdHJpbmcsXG4gIHNvdXJjZTogU2tpbGxTb3VyY2UsXG4pOiBQcm9taXNlPFNraWxsSXRlbVtdPiB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKHNraWxsc1Jvb3QsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgY29uc3Qgc2tpbGxzOiBTa2lsbEl0ZW1bXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZm9sZGVyTmFtZSA9IGVudHJ5Lm5hbWU7XG4gICAgY29uc3QgZm9sZGVyUGF0aCA9IHBhdGguam9pbihza2lsbHNSb290LCBmb2xkZXJOYW1lKTtcbiAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHJlc29sdmVTa2lsbE1ldGFkYXRhKGZvbGRlclBhdGgsIGZvbGRlck5hbWUsIGJ1aWxkRmFsbGJhY2tMb2NhdGlvbihmb2xkZXJOYW1lKSk7XG4gICAgaWYgKCFtZXRhZGF0YSkgY29udGludWU7XG4gICAgc2tpbGxzLnB1c2goe1xuICAgICAgaWQ6IGNyZWF0ZVNraWxsSWQoc291cmNlLCBmb2xkZXJOYW1lKSxcbiAgICAgIG1ldGFkYXRhLFxuICAgICAgcGF0aDogZm9sZGVyUGF0aCxcbiAgICAgIGlzU3lzdGVtOiBzb3VyY2UgPT09ICdhcHAnID8gYXBwLmlzUGFja2FnZWQgOiBmYWxzZSxcbiAgICAgIGlzTmV3OiBmYWxzZSxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBza2lsbHM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVQcmltYXJ5U2tpbGxzUm9vdCgpOiBQcm9taXNlPHsgcm9vdDogc3RyaW5nOyBzb3VyY2U6IFNraWxsU291cmNlIH0+IHtcbiAgY29uc3QgYXBwUm9vdCA9IGF3YWl0IGdldEFwcFNraWxsc1Jvb3QoKTtcbiAgaWYgKCFhcHAuaXNQYWNrYWdlZCAmJiBhcHBSb290KSB7XG4gICAgcmV0dXJuIHsgcm9vdDogYXBwUm9vdCwgc291cmNlOiAnYXBwJyB9O1xuICB9XG5cbiAgY29uc3Qgc2hhcmVkUm9vdCA9IGF3YWl0IGdldFNoYXJlZFNraWxsc1Jvb3QoKTtcbiAgcmV0dXJuIHsgcm9vdDogc2hhcmVkUm9vdCwgc291cmNlOiAnc2hhcmVkJyB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBzYWZlUmVhZFNraWxsc0Zyb21Sb290KFxuICBza2lsbHNSb290OiBzdHJpbmcgfCBudWxsLFxuICBzb3VyY2U6IFNraWxsU291cmNlLFxuKTogUHJvbWlzZTxTa2lsbEl0ZW1bXT4ge1xuICBpZiAoIXNraWxsc1Jvb3QpIHJldHVybiBbXTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgcmVhZFNraWxsc0Zyb21Sb290KHNraWxsc1Jvb3QsIHNvdXJjZSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlVW5pcXVlRm9sZGVyTmFtZShiYXNlTmFtZTogc3RyaW5nLCByb290OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBsZXQgY2FuZGlkYXRlID0gYmFzZU5hbWU7XG4gIGxldCBpbmRleCA9IDE7XG4gIHdoaWxlIChhd2FpdCBpc0RpcmVjdG9yeShwYXRoLmpvaW4ocm9vdCwgY2FuZGlkYXRlKSkpIHtcbiAgICBjYW5kaWRhdGUgPSBgJHtiYXNlTmFtZX0gLSR7aW5kZXh9IGA7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuICByZXR1cm4gY2FuZGlkYXRlO1xufVxuXG5mdW5jdGlvbiBzbHVnaWZ5SWQoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBpbnB1dFxuICAgIC50cmltKClcbiAgICAudG9Mb3dlckNhc2UoKVxuICAgIC5yZXBsYWNlKC9bXmEtejAtOS1fXSsvZywgJy0nKVxuICAgIC5yZXBsYWNlKC9eLSt8LSskL2csICcnKTtcbiAgcmV0dXJuIG5vcm1hbGl6ZWQubGVuZ3RoID4gMCA/IG5vcm1hbGl6ZWQgOiAnbWNwLXNlcnZlcic7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZVVuaXF1ZUlkKGJhc2VJZDogc3RyaW5nLCBleGlzdGluZzogUmVhZG9ubHlTZXQ8c3RyaW5nPik6IHN0cmluZyB7XG4gIGxldCBjYW5kaWRhdGUgPSBiYXNlSWQ7XG4gIGxldCBpbmRleCA9IDE7XG4gIHdoaWxlIChleGlzdGluZy5oYXMoY2FuZGlkYXRlKSkge1xuICAgIGNhbmRpZGF0ZSA9IGAke2Jhc2VJZH0gLSR7aW5kZXh9IGA7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuICByZXR1cm4gY2FuZGlkYXRlO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVNY3BUeXBlKHR5cGU/OiBzdHJpbmcpOiBNY3BTZXJ2ZXJDb25maWdbJ3R5cGUnXSB7XG4gIGlmICh0eXBlID09PSAnc3NlJyB8fCB0eXBlID09PSAnc3RyZWFtYWJsZUh0dHAnIHx8IHR5cGUgPT09ICdzdGRpbycpIHtcbiAgICByZXR1cm4gdHlwZTtcbiAgfVxuICByZXR1cm4gJ3N0ZGlvJztcbn1cblxuZnVuY3Rpb24gdG9TYWZlUmVjb3JkKGlucHV0PzogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQge1xuICBpZiAoIWlucHV0KSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXMoaW5wdXQpLmZpbHRlcihcbiAgICAoW2tleSwgdmFsdWVdKSA9PiBrZXkudHJpbSgpLmxlbmd0aCA+IDAgJiYgdmFsdWUudHJpbSgpLmxlbmd0aCA+IDAsXG4gICk7XG4gIGlmIChlbnRyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhlbnRyaWVzKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTWNwSW5wdXQoaW5wdXQ6IE1jcFNlcnZlckNyZWF0ZUlucHV0KTogT21pdDxNY3BTZXJ2ZXJDb25maWcsICdpZCc+IHtcbiAgY29uc3QgbmFtZSA9IGlucHV0Lm5hbWUudHJpbSgpO1xuXG4gIHJldHVybiB7XG4gICAgbmFtZTogbmFtZS5sZW5ndGggPiAwID8gbmFtZSA6ICdNQ1AgU2VydmVyJyxcbiAgICBkZXNjcmlwdGlvbjogaW5wdXQuZGVzY3JpcHRpb24/LnRyaW0oKSB8fCB1bmRlZmluZWQsXG4gICAgdHlwZTogbm9ybWFsaXplTWNwVHlwZShpbnB1dC50eXBlKSxcbiAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkID8/IHRydWUsXG4gICAgcGF0aDogaW5wdXQucGF0aD8udHJpbSgpIHx8IHVuZGVmaW5lZCxcbiAgICBjb21tYW5kOiBpbnB1dC5jb21tYW5kPy50cmltKCkgfHwgdW5kZWZpbmVkLFxuICAgIGFyZ3M6IGlucHV0LmFyZ3M/LmZpbHRlcigoaXRlbSkgPT4gaXRlbS50cmltKCkubGVuZ3RoID4gMCksXG4gICAgZW52OiB0b1NhZmVSZWNvcmQoaW5wdXQuZW52KSxcbiAgICB1cmw6IGlucHV0LnVybD8udHJpbSgpIHx8IHVuZGVmaW5lZCxcbiAgICBoZWFkZXJzOiB0b1NhZmVSZWNvcmQoaW5wdXQuaGVhZGVycyksXG4gICAgbG9uZ1J1bm5pbmc6IGlucHV0LmxvbmdSdW5uaW5nLFxuICAgIHRpbWVvdXQ6IHR5cGVvZiBpbnB1dC50aW1lb3V0ID09PSAnbnVtYmVyJyAmJiBOdW1iZXIuaXNGaW5pdGUoaW5wdXQudGltZW91dCkgPyBpbnB1dC50aW1lb3V0IDogdW5kZWZpbmVkLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlTWNwU3RvcmFnZVBhdGgoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgbWNwUm9vdCA9IGF3YWl0IGdldFNoYXJlZE1jcFJvb3QoKTtcbiAgcmV0dXJuIHBhdGguam9pbihtY3BSb290LCAnc2VydmVycy5qc29uJyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRNY3BTZXJ2ZXJzKCk6IFByb21pc2U8TWNwU2VydmVyQ29uZmlnW10+IHtcbiAgY29uc3Qgc3RvcmFnZVBhdGggPSBhd2FpdCByZXNvbHZlTWNwU3RvcmFnZVBhdGgoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCByYXcgPSBhd2FpdCByZWFkRmlsZShzdG9yYWdlUGF0aCwgJ3V0Zi04Jyk7XG4gICAgY29uc3QgcGF5bG9hZCA9IEpTT04ucGFyc2UocmF3KSBhcyB1bmtub3duO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHBheWxvYWQpKSB7XG4gICAgICByZXR1cm4gcGF5bG9hZC5maWx0ZXIoKGl0ZW0pOiBpdGVtIGlzIE1jcFNlcnZlckNvbmZpZyA9PiB0eXBlb2YgaXRlbSA9PT0gJ29iamVjdCcgJiYgaXRlbSAhPT0gbnVsbCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlTWNwU2VydmVycyhzZXJ2ZXJzOiBNY3BTZXJ2ZXJDb25maWdbXSk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBzdG9yYWdlUGF0aCA9IGF3YWl0IHJlc29sdmVNY3BTdG9yYWdlUGF0aCgpO1xuICBhd2FpdCB3cml0ZUZpbGUoc3RvcmFnZVBhdGgsIEpTT04uc3RyaW5naWZ5KHNlcnZlcnMsIG51bGwsIDIpLCAndXRmLTgnKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VNY3BJbXBvcnRQYXlsb2FkKGlucHV0OiBNY3BTZXJ2ZXJJbXBvcnRJbnB1dCk6IE1jcFNlcnZlckNyZWF0ZUlucHV0W10ge1xuICBjb25zdCByYXcgPSBpbnB1dC5qc29uLnRyaW0oKTtcbiAgaWYgKCFyYXcpIHJldHVybiBbXTtcbiAgY29uc3QgcGF5bG9hZCA9IEpTT04ucGFyc2UocmF3KSBhcyB1bmtub3duO1xuXG4gIGlmIChBcnJheS5pc0FycmF5KHBheWxvYWQpKSB7XG4gICAgcmV0dXJuIHBheWxvYWQuZmlsdGVyKChpdGVtKTogaXRlbSBpcyBNY3BTZXJ2ZXJDcmVhdGVJbnB1dCA9PiB0eXBlb2YgaXRlbSA9PT0gJ29iamVjdCcgJiYgaXRlbSAhPT0gbnVsbCk7XG4gIH1cblxuICBpZiAocGF5bG9hZCAmJiB0eXBlb2YgcGF5bG9hZCA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCByZWNvcmQgPSBwYXlsb2FkIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGNvbnN0IG1heWJlQXJyYXkgPSByZWNvcmQuc2VydmVycyA/PyByZWNvcmQubWNwU2VydmVycyA/PyByZWNvcmQuaXRlbXM7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkobWF5YmVBcnJheSkpIHtcbiAgICAgIHJldHVybiBtYXliZUFycmF5LmZpbHRlcigoaXRlbSk6IGl0ZW0gaXMgTWNwU2VydmVyQ3JlYXRlSW5wdXQgPT4gdHlwZW9mIGl0ZW0gPT09ICdvYmplY3QnICYmIGl0ZW0gIT09IG51bGwpO1xuICAgIH1cbiAgICByZXR1cm4gW3JlY29yZCBhcyB1bmtub3duIGFzIE1jcFNlcnZlckNyZWF0ZUlucHV0XTtcbiAgfVxuXG4gIHJldHVybiBbXTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT0gU2tpbGxzIFx1NjcwRFx1NTJBMSA9PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0QWxsU2tpbGxzKCk6IFByb21pc2U8U2tpbGxJdGVtW10+IHtcbiAgY29uc3QgYXBwUm9vdCA9IGF3YWl0IGdldEFwcFNraWxsc1Jvb3QoKTtcbiAgY29uc3Qgc2hhcmVkUm9vdCA9IGF3YWl0IGdldFNoYXJlZFNraWxsc1Jvb3QoKTtcblxuICBjb25zdCBbYXBwU2tpbGxzLCBzaGFyZWRTa2lsbHNdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIHNhZmVSZWFkU2tpbGxzRnJvbVJvb3QoYXBwUm9vdCwgJ2FwcCcpLFxuICAgIHNhZmVSZWFkU2tpbGxzRnJvbVJvb3Qoc2hhcmVkUm9vdCwgJ3NoYXJlZCcpLFxuICBdKTtcblxuICBjb25zdCBtZXJnZWQgPSBbLi4uYXBwU2tpbGxzLCAuLi5zaGFyZWRTa2lsbHNdO1xuICBjb25zb2xlLmxvZyhgW1NraWxsc1NlcnZpY2VdIERpc2NvdmVyZWQgJHttZXJnZWQubGVuZ3RofSBza2lsbHMgKCR7YXBwU2tpbGxzLmxlbmd0aH0gYXBwLCAke3NoYXJlZFNraWxscy5sZW5ndGh9IHNoYXJlZClgKTtcbiAgcmV0dXJuIG1lcmdlZC5zb3J0KChhLCBiKSA9PiBhLm1ldGFkYXRhLm5hbWUubG9jYWxlQ29tcGFyZShiLm1ldGFkYXRhLm5hbWUpKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZVNraWxsKHNraWxsSWQ6IHN0cmluZyk6IFByb21pc2U8eyBzdWNjZXNzOiBib29sZWFuOyBtZXNzYWdlPzogc3RyaW5nIH0+IHtcbiAgY29uc3QgeyBzb3VyY2UsIGZvbGRlck5hbWUgfSA9IHBhcnNlU2tpbGxJZChza2lsbElkKTtcbiAgY29uc3Qgc2tpbGxzUm9vdCA9IHNvdXJjZSA9PT0gJ2FwcCcgPyBhd2FpdCBnZXRBcHBTa2lsbHNSb290KCkgOiBhd2FpdCBnZXRTaGFyZWRTa2lsbHNSb290KCk7XG4gIGlmICghc2tpbGxzUm9vdCkge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiBgXHU2MjgwXHU4MEZEIFwiJHtmb2xkZXJOYW1lfVwiIFx1NEUwRFx1NUI1OFx1NTcyOGAgfTtcbiAgfVxuICBjb25zdCB0YXJnZXRQYXRoID0gcGF0aC5qb2luKHNraWxsc1Jvb3QsIGZvbGRlck5hbWUpO1xuXG4gIGlmICghKGF3YWl0IGlzRGlyZWN0b3J5KHRhcmdldFBhdGgpKSkge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiBgXHU2MjgwXHU4MEZEIFwiJHtmb2xkZXJOYW1lfVwiIFx1NEUwRFx1NUI1OFx1NTcyOGAgfTtcbiAgfVxuXG4gIGF3YWl0IHJtKHRhcmdldFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbWVzc2FnZTogYFx1NjI4MFx1ODBGRCBcIiR7Zm9sZGVyTmFtZX1cIiBcdTVERjJcdTUyMjBcdTk2NjRgIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpbXBvcnRTa2lsbEZyb21Gb2xkZXIoc291cmNlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxTa2lsbEltcG9ydFJlc3VsdD4ge1xuICBjb25zdCB7IHJvb3Q6IHNraWxsc1Jvb3QsIHNvdXJjZSB9ID0gYXdhaXQgcmVzb2x2ZVByaW1hcnlTa2lsbHNSb290KCk7XG4gIGNvbnN0IGZvbGRlck5hbWUgPSBwYXRoLmJhc2VuYW1lKHNvdXJjZVBhdGgpO1xuICBjb25zdCB0YXJnZXROYW1lID0gYXdhaXQgcmVzb2x2ZVVuaXF1ZUZvbGRlck5hbWUoZm9sZGVyTmFtZSwgc2tpbGxzUm9vdCk7XG4gIGNvbnN0IHRhcmdldFBhdGggPSBwYXRoLmpvaW4oc2tpbGxzUm9vdCwgdGFyZ2V0TmFtZSk7XG5cbiAgYXdhaXQgY3Aoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgcmVzb2x2ZVNraWxsTWV0YWRhdGEodGFyZ2V0UGF0aCwgdGFyZ2V0TmFtZSwgYnVpbGRGYWxsYmFja0xvY2F0aW9uKHRhcmdldE5hbWUpKTtcblxuICByZXR1cm4ge1xuICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgbWVzc2FnZTogJ1x1NUJGQ1x1NTE2NVx1NjIxMFx1NTI5RicsXG4gICAgc2tpbGw6IG1ldGFkYXRhXG4gICAgICA/IHtcbiAgICAgICAgaWQ6IGNyZWF0ZVNraWxsSWQoc291cmNlLCB0YXJnZXROYW1lKSxcbiAgICAgICAgbWV0YWRhdGEsXG4gICAgICAgIHBhdGg6IHRhcmdldFBhdGgsXG4gICAgICAgIGlzU3lzdGVtOiBzb3VyY2UgPT09ICdhcHAnID8gYXBwLmlzUGFja2FnZWQgOiBmYWxzZSxcbiAgICAgICAgaXNOZXc6IHRydWUsXG4gICAgICB9XG4gICAgICA6IHVuZGVmaW5lZCxcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT0gTUNQIFx1NjcwRFx1NTJBMSA9PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0QWxsTWNwU2VydmVycygpOiBQcm9taXNlPE1jcFNlcnZlckNvbmZpZ1tdPiB7XG4gIHJldHVybiBhd2FpdCByZWFkTWNwU2VydmVycygpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBkYXRlTWNwU2VydmVyU3RhdGUoXG4gIHNlcnZlcklkOiBzdHJpbmcsXG4gIHVwZGF0ZXM6IFBhcnRpYWw8TWNwU2VydmVyQ29uZmlnPixcbik6IFByb21pc2U8eyBzdWNjZXNzOiBib29sZWFuOyBtZXNzYWdlPzogc3RyaW5nIH0+IHtcbiAgY29uc3Qgc2VydmVycyA9IGF3YWl0IHJlYWRNY3BTZXJ2ZXJzKCk7XG4gIGNvbnN0IHRhcmdldEluZGV4ID0gc2VydmVycy5maW5kSW5kZXgoKGl0ZW0pID0+IGl0ZW0uaWQgPT09IHNlcnZlcklkKTtcbiAgaWYgKHRhcmdldEluZGV4IDwgMCkge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiBgTUNQIFx1NjcwRFx1NTJBMVx1NTY2OCBcIiR7c2VydmVySWR9XCIgXHU0RTBEXHU1QjU4XHU1NzI4YCB9O1xuICB9XG5cbiAgY29uc3QgY3VycmVudCA9IHNlcnZlcnNbdGFyZ2V0SW5kZXhdO1xuICBjb25zdCB1cGRhdGVkOiBNY3BTZXJ2ZXJDb25maWcgPSB7XG4gICAgLi4uY3VycmVudCxcbiAgICAuLi51cGRhdGVzLFxuICAgIHR5cGU6IHVwZGF0ZXMudHlwZSA/IG5vcm1hbGl6ZU1jcFR5cGUodXBkYXRlcy50eXBlKSA6IGN1cnJlbnQudHlwZSxcbiAgICBuYW1lOiB1cGRhdGVzLm5hbWU/LnRyaW0oKSB8fCBjdXJyZW50Lm5hbWUsXG4gIH07XG4gIHNlcnZlcnNbdGFyZ2V0SW5kZXhdID0gdXBkYXRlZDtcbiAgYXdhaXQgd3JpdGVNY3BTZXJ2ZXJzKHNlcnZlcnMpO1xuXG4gIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG1lc3NhZ2U6ICdcdTY2RjRcdTY1QjBcdTYyMTBcdTUyOUYnIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVNY3BTZXJ2ZXIoaW5wdXQ6IE1jcFNlcnZlckNyZWF0ZUlucHV0KTogUHJvbWlzZTxNY3BTZXJ2ZXJDcmVhdGVSZXN1bHQ+IHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZU1jcElucHV0KGlucHV0KTtcbiAgaWYgKCFub3JtYWxpemVkLm5hbWUpIHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NTQwRFx1NzlGMFx1NEUwRFx1ODBGRFx1NEUzQVx1N0E3QScgfTtcbiAgfVxuXG4gIGNvbnN0IHNlcnZlcnMgPSBhd2FpdCByZWFkTWNwU2VydmVycygpO1xuICBjb25zdCBleGlzdGluZyA9IG5ldyBTZXQoc2VydmVycy5tYXAoKGl0ZW0pID0+IGl0ZW0uaWQpKTtcbiAgY29uc3QgYmFzZUlkID0gc2x1Z2lmeUlkKG5vcm1hbGl6ZWQubmFtZSk7XG4gIGNvbnN0IGlkID0gZW5zdXJlVW5pcXVlSWQoYmFzZUlkLCBleGlzdGluZyk7XG5cbiAgY29uc3Qgc2VydmVyOiBNY3BTZXJ2ZXJDb25maWcgPSB7XG4gICAgaWQsXG4gICAgLi4ubm9ybWFsaXplZCxcbiAgfTtcblxuICBzZXJ2ZXJzLnB1c2goc2VydmVyKTtcbiAgYXdhaXQgd3JpdGVNY3BTZXJ2ZXJzKHNlcnZlcnMpO1xuXG4gIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIHNlcnZlciB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVsZXRlTWNwU2VydmVyKHNlcnZlcklkOiBzdHJpbmcpOiBQcm9taXNlPE1jcFNlcnZlckRlbGV0ZVJlc3VsdD4ge1xuICBjb25zdCBzZXJ2ZXJzID0gYXdhaXQgcmVhZE1jcFNlcnZlcnMoKTtcbiAgY29uc3QgbmV4dCA9IHNlcnZlcnMuZmlsdGVyKChpdGVtKSA9PiBpdGVtLmlkICE9PSBzZXJ2ZXJJZCk7XG4gIGlmIChuZXh0Lmxlbmd0aCA9PT0gc2VydmVycy5sZW5ndGgpIHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogYE1DUCBcdTY3MERcdTUyQTFcdTU2NjggXCIke3NlcnZlcklkfVwiIFx1NEUwRFx1NUI1OFx1NTcyOGAgfTtcbiAgfVxuICBhd2FpdCB3cml0ZU1jcFNlcnZlcnMobmV4dCk7XG4gIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGltcG9ydE1jcFNlcnZlcnMoaW5wdXQ6IE1jcFNlcnZlckltcG9ydElucHV0KTogUHJvbWlzZTxNY3BTZXJ2ZXJJbXBvcnRSZXN1bHQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBpbmNvbWluZyA9IHBhcnNlTWNwSW1wb3J0UGF5bG9hZChpbnB1dCk7XG4gICAgaWYgKGluY29taW5nLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6ICdcdTY3MkFcdTg5RTNcdTY3OTBcdTUyMzBcdTY3MDlcdTY1NDhcdTc2ODQgTUNQIFx1OTE0RFx1N0Y2RScgfTtcbiAgICB9XG5cbiAgICBjb25zdCBzZXJ2ZXJzID0gYXdhaXQgcmVhZE1jcFNlcnZlcnMoKTtcbiAgICBjb25zdCBleGlzdGluZyA9IG5ldyBTZXQoc2VydmVycy5tYXAoKGl0ZW0pID0+IGl0ZW0uaWQpKTtcbiAgICBsZXQgY291bnQgPSAwO1xuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBpbmNvbWluZykge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZU1jcElucHV0KGVudHJ5KTtcbiAgICAgIGNvbnN0IGJhc2VJZCA9IHNsdWdpZnlJZChub3JtYWxpemVkLm5hbWUpO1xuICAgICAgY29uc3QgaWQgPSBlbnN1cmVVbmlxdWVJZChiYXNlSWQsIGV4aXN0aW5nKTtcbiAgICAgIGV4aXN0aW5nLmFkZChpZCk7XG4gICAgICBzZXJ2ZXJzLnB1c2goe1xuICAgICAgICBpZCxcbiAgICAgICAgLi4ubm9ybWFsaXplZCxcbiAgICAgIH0pO1xuICAgICAgY291bnQgKz0gMTtcbiAgICB9XG5cbiAgICBhd2FpdCB3cml0ZU1jcFNlcnZlcnMoc2VydmVycyk7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgY291bnQgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnXHU1QkZDXHU1MTY1XHU1OTMxXHU4RDI1JyB9O1xuICB9XG59XG4iLCAiLy8gPT09PT09PT09PT09PT09PT09PT0gVHlwZXMgPT09PT09PT09PT09PT09PT09PT1cblxuLyoqIFNraWxsIFx1NTE0M1x1NjU3MFx1NjM2RSAqL1xuZXhwb3J0IGludGVyZmFjZSBTa2lsbE1ldGFkYXRhIHtcbiAgbmFtZTogc3RyaW5nO1xuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICBsb2NhdGlvbjogc3RyaW5nO1xufVxuXG4vKiogU2tpbGwgXHU2NTg3XHU0RUY2XHU0RkUxXHU2MDZGICovXG5leHBvcnQgaW50ZXJmYWNlIFNraWxsSXRlbSB7XG4gIGlkOiBzdHJpbmc7ICAgICAgICAgIC8vIFx1NjI4MFx1ODBGRFx1NjgwN1x1OEJDNlx1RkYwOFx1NTNFRlx1ODBGRFx1NTMwNVx1NTQyQlx1Njc2NVx1NkU5MFx1NTI0RFx1N0YwMFx1RkYwOVxuICBtZXRhZGF0YTogU2tpbGxNZXRhZGF0YTtcbiAgcGF0aDogc3RyaW5nOyAgICAgICAgIC8vIFx1NUI4Q1x1NjU3NFx1OERFRlx1NUY4NFxuICBpc1N5c3RlbTogYm9vbGVhbjsgICAgLy8gXHU2NjJGXHU1NDI2XHU0RTNBXHU3Q0ZCXHU3RURGXHU2MjgwXHU4MEZEXG4gIGlzTmV3OiBib29sZWFuOyAgICAgICAvLyBcdTY2MkZcdTU0MjZcdTRFM0FcdTY1QjBcdTVCRkNcdTUxNjVcbn1cblxuLyoqIFNraWxsIFx1NUJGQ1x1NTE2NVx1OEY5M1x1NTE2NSAqL1xuZXhwb3J0IGludGVyZmFjZSBTa2lsbEltcG9ydElucHV0IHtcbiAgc291cmNlUGF0aD86IHN0cmluZztcbn1cblxuLyoqIFNraWxsIFx1NUJGQ1x1NTE2NVx1N0VEM1x1Njc5QyAqL1xuZXhwb3J0IGludGVyZmFjZSBTa2lsbEltcG9ydFJlc3VsdCB7XG4gIHN1Y2Nlc3M6IGJvb2xlYW47XG4gIG1lc3NhZ2U/OiBzdHJpbmc7XG4gIHNraWxsPzogU2tpbGxJdGVtO1xufVxuXG4vKiogTUNQIFx1NjcwRFx1NTJBMVx1NTY2OFx1OTE0RFx1N0Y2RSAqL1xuZXhwb3J0IGludGVyZmFjZSBNY3BTZXJ2ZXJDb25maWcge1xuICBpZDogc3RyaW5nOyAgICAgICAgICAgLy8gXHU2NzBEXHU1MkExXHU1NjY4IElEXG4gIG5hbWU6IHN0cmluZzsgICAgICAgICAvLyBcdTY2M0VcdTc5M0FcdTU0MERcdTc5RjBcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmc7IC8vIFx1NjNDRlx1OEZGMFxuICB0eXBlOiAnc3RkaW8nIHwgJ3NzZScgfCAnc3RyZWFtYWJsZUh0dHAnIHwgc3RyaW5nOyAvLyBcdTdDN0JcdTU3OEJcbiAgZW5hYmxlZDogYm9vbGVhbjsgICAgIC8vIFx1NjYyRlx1NTQyNlx1NTQyRlx1NzUyOFxuICBwYXRoPzogc3RyaW5nOyAgICAgICAgLy8gXHU2NzJDXHU1NzMwXHU4REVGXHU1Rjg0XHVGRjA4XHU1OTgyXHU2NzlDXHU2NjJGXHU2NzJDXHU1NzMwXHU2NUU3XHU3MjQ4XHVGRjA5XG4gIGNvbW1hbmQ/OiBzdHJpbmc7ICAgICAvLyBcdTU0MkZcdTUyQThcdTU0N0RcdTRFRTQgKHN0ZGlvKVxuICBhcmdzPzogc3RyaW5nW107ICAgICAgLy8gXHU1NDJGXHU1MkE4XHU1M0MyXHU2NTcwIChzdGRpbylcbiAgZW52PzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjsgLy8gXHU3M0FGXHU1ODgzXHU1M0Q4XHU5MUNGIChzdGRpbylcbiAgdXJsPzogc3RyaW5nOyAgICAgICAgIC8vIFVSTCAoc3NlL3N0cmVhbWFibGVIdHRwKVxuICBoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjsgLy8gXHU4QkY3XHU2QzQyXHU1OTM0IChzdHJlYW1hYmxlSHR0cClcbiAgbG9uZ1J1bm5pbmc/OiBib29sZWFuOyAvLyBcdTk1N0ZcdTY1RjZcdTk1RjRcdThGRDBcdTg4NENcdTZBMjFcdTVGMEZcbiAgdGltZW91dD86IG51bWJlcjsgICAgICAvLyBcdThEODVcdTY1RjZcdTY1RjZcdTk1RjRcdUZGMDhcdTc5RDJcdUZGMDlcbn1cblxuLyoqIE1DUCBcdTUyMUJcdTVFRkFcdThGOTNcdTUxNjUgKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWNwU2VydmVyQ3JlYXRlSW5wdXQge1xuICBuYW1lOiBzdHJpbmc7XG4gIHR5cGU6IE1jcFNlcnZlckNvbmZpZ1sndHlwZSddO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbiAgZW5hYmxlZD86IGJvb2xlYW47XG4gIHBhdGg/OiBzdHJpbmc7XG4gIGNvbW1hbmQ/OiBzdHJpbmc7XG4gIGFyZ3M/OiBzdHJpbmdbXTtcbiAgZW52PzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgdXJsPzogc3RyaW5nO1xuICBoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgbG9uZ1J1bm5pbmc/OiBib29sZWFuO1xuICB0aW1lb3V0PzogbnVtYmVyO1xufVxuXG4vKiogTUNQIFx1NTIxQlx1NUVGQVx1N0VEM1x1Njc5QyAqL1xuZXhwb3J0IGludGVyZmFjZSBNY3BTZXJ2ZXJDcmVhdGVSZXN1bHQge1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBtZXNzYWdlPzogc3RyaW5nO1xuICBzZXJ2ZXI/OiBNY3BTZXJ2ZXJDb25maWc7XG59XG5cbi8qKiBNQ1AgXHU1QkZDXHU1MTY1XHU4RjkzXHU1MTY1ICovXG5leHBvcnQgaW50ZXJmYWNlIE1jcFNlcnZlckltcG9ydElucHV0IHtcbiAganNvbjogc3RyaW5nO1xufVxuXG4vKiogTUNQIFx1NUJGQ1x1NTE2NVx1N0VEM1x1Njc5QyAqL1xuZXhwb3J0IGludGVyZmFjZSBNY3BTZXJ2ZXJJbXBvcnRSZXN1bHQge1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBtZXNzYWdlPzogc3RyaW5nO1xuICBjb3VudD86IG51bWJlcjtcbn1cblxuLyoqIE1DUCBcdTUyMjBcdTk2NjRcdTdFRDNcdTY3OUMgKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWNwU2VydmVyRGVsZXRlUmVzdWx0IHtcbiAgc3VjY2VzczogYm9vbGVhbjtcbiAgbWVzc2FnZT86IHN0cmluZztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT0gU2NoZW1hcyA9PT09PT09PT09PT09PT09PT09PVxuLy8gKFVudXNlZClcblxuLy8gPT09PT09PT09PT09PT09PT09PT0gSVBDIENoYW5uZWxzID09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBjb25zdCBTS0lMTFNfTUNQX0NIQU5ORUxTID0ge1xuICAvLyBTa2lsbHNcbiAgU0tJTExTX0xJU1Q6ICdza2lsbHMtbWNwOmxpc3Qtc2tpbGxzJyxcbiAgU0tJTExTX0RFTEVURTogJ3NraWxscy1tY3A6ZGVsZXRlLXNraWxsJyxcbiAgU0tJTExTX1JFRlJFU0g6ICdza2lsbHMtbWNwOnJlZnJlc2gtc2tpbGxzJyxcbiAgU0tJTExTX0lNUE9SVDogJ3NraWxscy1tY3A6aW1wb3J0LXNraWxsJyxcblxuICAvLyBNQ1BcbiAgTUNQX0xJU1Q6ICdza2lsbHMtbWNwOmxpc3QtbWNwJyxcbiAgTUNQX0NSRUFURTogJ3NraWxscy1tY3A6Y3JlYXRlLW1jcCcsXG4gIE1DUF9JTVBPUlQ6ICdza2lsbHMtbWNwOmltcG9ydC1tY3AnLFxuICBNQ1BfREVMRVRFOiAnc2tpbGxzLW1jcDpkZWxldGUtbWNwJyxcbiAgTUNQX1VQREFURTogJ3NraWxscy1tY3A6dXBkYXRlLW1jcCcsXG4gIE1DUF9SRUZSRVNIOiAnc2tpbGxzLW1jcDpyZWZyZXNoLW1jcCcsXG59IGFzIGNvbnN0O1xuIiwgImltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgfSBmcm9tICdub2RlOm1vZHVsZSc7XHJcbmNvbnN0IHJlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybCk7XHJcbmNvbnN0IHsgaXBjTWFpbiB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuaW1wb3J0IHsgTElWRTJEX0lQQ19DSEFOTkVMUyB9IGZyb20gJy4vaXBjLWNvbnRyYWN0JztcclxuaW1wb3J0IHtcclxuICAgIGltcG9ydExpdmUyZE1vZGVsLFxyXG4gICAgbGlzdExpdmUyZE1vZGVscyxcclxuICAgIHNhdmVMaXZlMmRDb25maWcsXHJcbiAgICBkb3dubG9hZEdpdGh1YkxpdmUyZE1vZGVsXHJcbn0gZnJvbSAnLi9saXZlMmQtc2VydmljZSc7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJMaXZlMmRJcGNIYW5kbGVycygpIHtcclxuICAgIGlwY01haW4uaGFuZGxlKExJVkUyRF9JUENfQ0hBTk5FTFMuaW1wb3J0TW9kZWwsIGFzeW5jICgpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaW1wb3J0TGl2ZTJkTW9kZWwoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGlwY01haW4uaGFuZGxlKExJVkUyRF9JUENfQ0hBTk5FTFMubGlzdE1vZGVscywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBsaXN0TGl2ZTJkTW9kZWxzKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpcGNNYWluLmhhbmRsZShMSVZFMkRfSVBDX0NIQU5ORUxTLnNhdmVDb25maWcsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgc2F2ZUxpdmUyZENvbmZpZyhwYXlsb2FkKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGlwY01haW4uaGFuZGxlKExJVkUyRF9JUENfQ0hBTk5FTFMuZG93bmxvYWRHaXRodWIsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgZG93bmxvYWRHaXRodWJMaXZlMmRNb2RlbChwYXlsb2FkLnVybCk7XHJcbiAgICB9KTtcclxufVxyXG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gJ25vZGU6bW9kdWxlJztcclxuY29uc3QgcmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoaW1wb3J0Lm1ldGEudXJsKTtcclxuY29uc3QgeyBkaWFsb2cgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmltcG9ydCBmcyBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcclxuaW1wb3J0IGZzcyBmcm9tICdub2RlOmZzJztcclxuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcclxuXHJcbmltcG9ydCB7IGVuc3VyZVNoYXJlZFdvcmtzcGFjZSB9IGZyb20gJy4vc2hhcmVkLXdvcmtzcGFjZS1tYW5hZ2VyJztcclxuaW1wb3J0IHR5cGUge1xyXG4gICAgSW1wb3J0TGl2ZTJkTW9kZWxSZXN1bHQsXHJcbiAgICBMaXZlMmRNb2RlbENvbmZpZyxcclxuICAgIFNhdmVMaXZlMmRDb25maWdJbnB1dCxcclxuICAgIFNhdmVMaXZlMmRDb25maWdSZXN1bHQsXHJcbiAgICBMaXZlMmRNb3Rpb24sXHJcbiAgICBMaXZlMmRFeHByZXNzaW9uLFxyXG59IGZyb20gJy4vdHlwZXMnO1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gcGFyc2VBbmRDb21wbGV0ZUxpdmUyZENvbmZpZyhcclxuICAgIG1vZGVsRGlyOiBzdHJpbmcsXHJcbiAgICBmb2xkZXJOYW1lOiBzdHJpbmcsXHJcbiAgICBtb2RlbEpzb25GaWxlOiBzdHJpbmcsXHJcbik6IFByb21pc2U8TGl2ZTJkTW9kZWxDb25maWc+IHtcclxuICAgIGNvbnN0IGpzb25QYXRoID0gcGF0aC5qb2luKG1vZGVsRGlyLCBtb2RlbEpzb25GaWxlKTtcclxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmcy5yZWFkRmlsZShqc29uUGF0aCwgJ3V0ZjgnKTtcclxuICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKGNvbnRlbnQpO1xyXG5cclxuICAgIGNvbnN0IG1vdGlvbnM6IExpdmUyZE1vdGlvbltdID0gW107XHJcbiAgICBjb25zdCBleHByZXNzaW9uczogTGl2ZTJkRXhwcmVzc2lvbltdID0gW107XHJcblxyXG4gICAgLy8gUGFyc2UgbW90aW9uc1xyXG4gICAgY29uc3QgcmF3TW90aW9ucyA9IGRhdGEuRmlsZVJlZmVyZW5jZXM/Lk1vdGlvbnMgfHwgZGF0YS5tb3Rpb25zO1xyXG4gICAgaWYgKHJhd01vdGlvbnMgJiYgdHlwZW9mIHJhd01vdGlvbnMgPT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBbZ3JvdXAsIGl0ZW1zXSBvZiBPYmplY3QuZW50cmllcyhyYXdNb3Rpb25zKSkge1xyXG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShpdGVtcykpIHtcclxuICAgICAgICAgICAgICAgIGl0ZW1zLmZvckVhY2goKGl0ZW06IGFueSwgaTogbnVtYmVyKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgbW90aW9ucy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IFN0cmluZyhpKSwgLy8gc3RvcmUgaW5kZXggb3Igc3BlY2lmaWMga2V5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGU6IGl0ZW0uRmlsZSB8fCBpdGVtLmZpbGUgfHwgJycsXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgaXRlbXMgPT09ICdvYmplY3QnICYmIGl0ZW1zICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBKdXN0IGluIGNhc2UgaXQncyBub3QgYW4gYXJyYXlcclxuICAgICAgICAgICAgICAgIG1vdGlvbnMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgZ3JvdXAsXHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJzAnLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGU6IChpdGVtcyBhcyBhbnkpLkZpbGUgfHwgKGl0ZW1zIGFzIGFueSkuZmlsZSB8fCAnJyxcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIFBhcnNlIGV4cHJlc3Npb25zXHJcbiAgICBjb25zdCByYXdFeHByID0gZGF0YS5GaWxlUmVmZXJlbmNlcz8uRXhwcmVzc2lvbnMgfHwgZGF0YS5leHByZXNzaW9ucztcclxuICAgIGlmIChBcnJheS5pc0FycmF5KHJhd0V4cHIpKSB7XHJcbiAgICAgICAgcmF3RXhwci5mb3JFYWNoKChpdGVtOiBhbnkpID0+IHtcclxuICAgICAgICAgICAgZXhwcmVzc2lvbnMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiBpdGVtLk5hbWUgfHwgaXRlbS5uYW1lIHx8ICcnLFxyXG4gICAgICAgICAgICAgICAgZmlsZTogaXRlbS5GaWxlIHx8IGl0ZW0uZmlsZSB8fCAnJyxcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYmFzZUNvbmZpZzogTGl2ZTJkTW9kZWxDb25maWcgPSB7XHJcbiAgICAgICAgaWQ6IGZvbGRlck5hbWUsXHJcbiAgICAgICAgbmFtZTogZm9sZGVyTmFtZSxcclxuICAgICAgICBtb2RlbEpzb25GaWxlLFxyXG4gICAgICAgIG1vdGlvbnMsXHJcbiAgICAgICAgZXhwcmVzc2lvbnMsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIE1lcmdlIHdpdGggY3VzdG9tIGNvbmZpZyBpZiBpdCBleGlzdHNcclxuICAgIGNvbnN0IGN1c3RvbUNvbmZpZ1BhdGggPSBwYXRoLmpvaW4obW9kZWxEaXIsICdsaXZlMmRfY3VzdG9tX2NvbmZpZy5qc29uJyk7XHJcbiAgICBpZiAoZnNzLmV4aXN0c1N5bmMoY3VzdG9tQ29uZmlnUGF0aCkpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjdXN0b21Db250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUoY3VzdG9tQ29uZmlnUGF0aCwgJ3V0ZjgnKTtcclxuICAgICAgICAgICAgY29uc3QgY3VzdG9tRGF0YSA9IEpTT04ucGFyc2UoY3VzdG9tQ29udGVudCk7XHJcblxyXG4gICAgICAgICAgICBpZiAoY3VzdG9tRGF0YS5uYW1lKSB7XHJcbiAgICAgICAgICAgICAgICBiYXNlQ29uZmlnLm5hbWUgPSBjdXN0b21EYXRhLm5hbWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFVwZGF0ZSBtb3Rpb25zIHdpdGggdHJhbnNsYXRpb25zXHJcbiAgICAgICAgICAgIGJhc2VDb25maWcubW90aW9ucyA9IGJhc2VDb25maWcubW90aW9ucy5tYXAoKG0pID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZvdW5kID0gY3VzdG9tRGF0YS5tb3Rpb25zPy5maW5kKFxyXG4gICAgICAgICAgICAgICAgICAgIChjOiBhbnkpID0+IGMuZ3JvdXAgPT09IG0uZ3JvdXAgJiYgYy5uYW1lID09PSBtLm5hbWUsXHJcbiAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZvdW5kXHJcbiAgICAgICAgICAgICAgICAgICAgPyB7IC4uLm0sIGRlc2NyaXB0aW9uQ2g6IGZvdW5kLmRlc2NyaXB0aW9uQ2gsIGRlc2NyaXB0aW9uRW46IGZvdW5kLmRlc2NyaXB0aW9uRW4gfVxyXG4gICAgICAgICAgICAgICAgICAgIDogbTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBVcGRhdGUgZXhwcmVzc2lvbnMgd2l0aCB0cmFuc2xhdGlvbnNcclxuICAgICAgICAgICAgYmFzZUNvbmZpZy5leHByZXNzaW9ucyA9IGJhc2VDb25maWcuZXhwcmVzc2lvbnMubWFwKChlKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmb3VuZCA9IGN1c3RvbURhdGEuZXhwcmVzc2lvbnM/LmZpbmQoKGM6IGFueSkgPT4gYy5uYW1lID09PSBlLm5hbWUpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZvdW5kXHJcbiAgICAgICAgICAgICAgICAgICAgPyB7IC4uLmUsIGRlc2NyaXB0aW9uQ2g6IGZvdW5kLmRlc2NyaXB0aW9uQ2gsIGRlc2NyaXB0aW9uRW46IGZvdW5kLmRlc2NyaXB0aW9uRW4gfVxyXG4gICAgICAgICAgICAgICAgICAgIDogZTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gcGFyc2UgbGl2ZTJkX2N1c3RvbV9jb25maWcuanNvbicsIGUpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gYmFzZUNvbmZpZztcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGltcG9ydExpdmUyZE1vZGVsKCk6IFByb21pc2U8SW1wb3J0TGl2ZTJkTW9kZWxSZXN1bHQ+IHtcclxuICAgIGNvbnN0IHsgZmlsZVBhdGhzIH0gPSBhd2FpdCBkaWFsb2cuc2hvd09wZW5EaWFsb2coe1xyXG4gICAgICAgIHRpdGxlOiAnU2VsZWN0IExpdmUyRCBNb2RlbCBGb2xkZXInLFxyXG4gICAgICAgIHByb3BlcnRpZXM6IFsnb3BlbkRpcmVjdG9yeSddLFxyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKCFmaWxlUGF0aHMgfHwgZmlsZVBhdGhzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiAnXHU2NzJBXHU5MDA5XHU2MkU5XHU0RUZCXHU0RjU1XHU2NTg3XHU0RUY2XHU1OTM5JyB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHNvdXJjZURpciA9IGZpbGVQYXRoc1swXTtcclxuICAgIGNvbnN0IGZvbGRlck5hbWUgPSBwYXRoLmJhc2VuYW1lKHNvdXJjZURpcik7XHJcbiAgICBjb25zdCBzaGFyZWQgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoKTtcclxuICAgIGNvbnN0IHRhcmdldERpciA9IHBhdGguam9pbihzaGFyZWQuc2hhcmVkTW9kZWxzUm9vdCwgZm9sZGVyTmFtZSk7XHJcblxyXG4gICAgaWYgKGZzcy5leGlzdHNTeW5jKHRhcmdldERpcikpIHtcclxuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1OEJFNVx1NkEyMVx1NTc4Qlx1NjU4N1x1NEVGNlx1NTkzOVx1NURGMlx1NUI1OFx1NTcyOCcgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDaGVjayBpZiBtb2RlbCBqc29uIGV4aXN0cyBiZWZvcmUgY29weWluZ1xyXG4gICAgY29uc3QgZmlsZXMgPSBhd2FpdCBmcy5yZWFkZGlyKHNvdXJjZURpcik7XHJcbiAgICBjb25zdCBtb2RlbEpzb25GaWxlID0gZmlsZXMuZmluZChcclxuICAgICAgICAoZikgPT4gZi5lbmRzV2l0aCgnLm1vZGVsMy5qc29uJykgfHwgZi5lbmRzV2l0aCgnbW9kZWwuanNvbicpLFxyXG4gICAgKTtcclxuXHJcbiAgICBpZiAoIW1vZGVsSnNvbkZpbGUpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICAgICAgbWVzc2FnZTogJ1x1NjI0MFx1OTAwOVx1NjU4N1x1NEVGNlx1NTkzOVx1NEUyRFx1NjcyQVx1NjI3RVx1NTIzMCBtb2RlbC5qc29uIFx1NjIxNiAubW9kZWwzLmpzb24nLFxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCBmcy5jcChzb3VyY2VEaXIsIHRhcmdldERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XHJcblxyXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHBhcnNlQW5kQ29tcGxldGVMaXZlMmRDb25maWcodGFyZ2V0RGlyLCBmb2xkZXJOYW1lLCBtb2RlbEpzb25GaWxlKTtcclxuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBtb2RlbDogY29uZmlnIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UgfTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxpc3RMaXZlMmRNb2RlbHMoKTogUHJvbWlzZTxMaXZlMmRNb2RlbENvbmZpZ1tdPiB7XHJcbiAgICBjb25zdCBzaGFyZWQgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoKTtcclxuICAgIGNvbnN0IG1vZGVsczogTGl2ZTJkTW9kZWxDb25maWdbXSA9IFtdO1xyXG5cclxuICAgIGlmICghZnNzLmV4aXN0c1N5bmMoc2hhcmVkLnNoYXJlZE1vZGVsc1Jvb3QpKSB7XHJcbiAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGZvbGRlcnMgPSBhd2FpdCBmcy5yZWFkZGlyKHNoYXJlZC5zaGFyZWRNb2RlbHNSb290KTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiBmb2xkZXJzKSB7XHJcbiAgICAgICAgY29uc3QgbW9kZWxEaXIgPSBwYXRoLmpvaW4oc2hhcmVkLnNoYXJlZE1vZGVsc1Jvb3QsIGZvbGRlcik7XHJcbiAgICAgICAgY29uc3Qgc3RhdCA9IGF3YWl0IGZzLnN0YXQobW9kZWxEaXIpO1xyXG4gICAgICAgIGlmICghc3RhdC5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcclxuXHJcbiAgICAgICAgY29uc3QgZmlsZXMgPSBhd2FpdCBmcy5yZWFkZGlyKG1vZGVsRGlyKTtcclxuICAgICAgICBjb25zdCBtb2RlbEpzb25GaWxlID0gZmlsZXMuZmluZChcclxuICAgICAgICAgICAgKGYpID0+IGYuZW5kc1dpdGgoJy5tb2RlbDMuanNvbicpIHx8IGYuZW5kc1dpdGgoJ21vZGVsLmpzb24nKSxcclxuICAgICAgICApO1xyXG4gICAgICAgIGlmICghbW9kZWxKc29uRmlsZSkgY29udGludWU7XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHBhcnNlQW5kQ29tcGxldGVMaXZlMmRDb25maWcobW9kZWxEaXIsIGZvbGRlciwgbW9kZWxKc29uRmlsZSk7XHJcbiAgICAgICAgICAgIG1vZGVscy5wdXNoKGNvbmZpZyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gcGFyc2UgbW9kZWwnLCBmb2xkZXIsIGUpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbW9kZWxzO1xyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2F2ZUxpdmUyZENvbmZpZyhcclxuICAgIGlucHV0OiBTYXZlTGl2ZTJkQ29uZmlnSW5wdXQsXHJcbik6IFByb21pc2U8U2F2ZUxpdmUyZENvbmZpZ1Jlc3VsdD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBzaGFyZWQgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoKTtcclxuICAgICAgICBjb25zdCBtb2RlbERpciA9IHBhdGguam9pbihzaGFyZWQuc2hhcmVkTW9kZWxzUm9vdCwgaW5wdXQubW9kZWxJZCk7XHJcbiAgICAgICAgaWYgKCFmc3MuZXhpc3RzU3luYyhtb2RlbERpcikpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6ICdNb2RlbCBkaXJlY3Rvcnkgbm90IGZvdW5kJyB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgY3VzdG9tQ29uZmlnUGF0aCA9IHBhdGguam9pbihtb2RlbERpciwgJ2xpdmUyZF9jdXN0b21fY29uZmlnLmpzb24nKTtcclxuICAgICAgICBjb25zdCBzYXZlRGF0YSA9IHtcclxuICAgICAgICAgICAgbW9kZWxJZDogaW5wdXQubW9kZWxJZCxcclxuICAgICAgICAgICAgbW90aW9uczogaW5wdXQubW90aW9ucyxcclxuICAgICAgICAgICAgZXhwcmVzc2lvbnM6IGlucHV0LmV4cHJlc3Npb25zLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShjdXN0b21Db25maWdQYXRoLCBKU09OLnN0cmluZ2lmeShzYXZlRGF0YSwgbnVsbCwgMiksICd1dGY4Jyk7XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZTogYW55KSB7XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6IGUubWVzc2FnZSB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRHaXRodWJMaXZlMmRNb2RlbCh1cmw6IHN0cmluZyk6IFByb21pc2U8SW1wb3J0TGl2ZTJkTW9kZWxSZXN1bHQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSB1cmwubWF0Y2goL15odHRwczpcXC9cXC9naXRodWJcXC5jb21cXC8oW15cXC9dKylcXC8oW15cXC9dKylcXC90cmVlXFwvKFteXFwvXSspXFwvKC4rKSQvKTtcclxuICAgICAgICBpZiAoIW1hdGNoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiAnXHU2NUUwXHU2NTQ4XHU3Njg0XHU5NEZFXHU2M0E1XHVGRjBDXHU4QkY3XHU2M0QwXHU0RjlCXHU2MzA3XHU1NDExXHU1MTc3XHU0RjUzXHU2QTIxXHU1NzhCXHU2NTg3XHU0RUY2XHU1OTM5XHU3Njg0IEdpdEh1YiBcdTk0RkVcdTYzQTUgKFx1NEY4Qlx1NTk4MiBodHRwczovL2dpdGh1Yi5jb20vLi4uL3RyZWUvbWFzdGVyL21vZGVsL3NoaXp1a3UpJyB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgWywgb3duZXIsIHJlcG8sIGJyYW5jaCwgdGFyZ2V0UGF0aF0gPSBtYXRjaDtcclxuICAgICAgICBjb25zdCBjbGVhblRhcmdldFBhdGggPSB0YXJnZXRQYXRoLnJlcGxhY2UoL1xcLyQvLCAnJyk7XHJcbiAgICAgICAgY29uc3QgZm9sZGVyTmFtZSA9IGNsZWFuVGFyZ2V0UGF0aC5zcGxpdCgnLycpLnBvcCgpIHx8ICdkb3dubG9hZGVkX21vZGVsJztcclxuXHJcbiAgICAgICAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKCk7XHJcbiAgICAgICAgY29uc3QgdGFyZ2V0RGlyID0gcGF0aC5qb2luKHNoYXJlZC5zaGFyZWRNb2RlbHNSb290LCBmb2xkZXJOYW1lKTtcclxuXHJcbiAgICAgICAgaWYgKGZzcy5leGlzdHNTeW5jKHRhcmdldERpcikpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6IGBcdTZBMjFcdTU3OEJcdTY1ODdcdTRFRjZcdTU5MzkgJHtmb2xkZXJOYW1lfSBcdTVERjJcdTVCNThcdTU3MjhgIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB0cmVlVXJsID0gYGh0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3MvJHtvd25lcn0vJHtyZXBvfS9naXQvdHJlZXMvJHticmFuY2h9P3JlY3Vyc2l2ZT0xYDtcclxuICAgICAgICBjb25zdCB0cmVlUmVzID0gYXdhaXQgZmV0Y2godHJlZVVybCwgeyBoZWFkZXJzOiB7ICdVc2VyLUFnZW50JzogJ3dlQm90LUFwcCcgfSB9KTtcclxuXHJcbiAgICAgICAgaWYgKCF0cmVlUmVzLm9rKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiBgXHU2NUUwXHU2Q0Q1XHU4M0I3XHU1M0Q2IEdpdEh1YiBcdTRFRDNcdTVFOTNcdTRGRTFcdTYwNkY6IEhUVFAgJHt0cmVlUmVzLnN0YXR1c31gIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB0cmVlRGF0YSA9IChhd2FpdCB0cmVlUmVzLmpzb24oKSkgYXMgYW55O1xyXG5cclxuICAgICAgICBjb25zdCBmaWxlc1RvRG93bmxvYWQgPSB0cmVlRGF0YS50cmVlLmZpbHRlcigoaXRlbTogYW55KSA9PlxyXG4gICAgICAgICAgICBpdGVtLnR5cGUgPT09ICdibG9iJyAmJiBpdGVtLnBhdGguc3RhcnRzV2l0aChgJHtjbGVhblRhcmdldFBhdGh9L2ApXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgaWYgKCFmaWxlc1RvRG93bmxvYWQgfHwgZmlsZXNUb0Rvd25sb2FkLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NjcyQVx1NjI3RVx1NTIzMFx1OEJFNVx1OERFRlx1NUY4NFx1NEUwQlx1NzY4NFx1NjU4N1x1NEVGNicgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGF3YWl0IGZzLm1rZGlyKHRhcmdldERpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XHJcblxyXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBmaWxlc1RvRG93bmxvYWQpIHtcclxuICAgICAgICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gaXRlbS5wYXRoLnN1YnN0cmluZyhjbGVhblRhcmdldFBhdGgubGVuZ3RoICsgMSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHJhd1VybCA9IGBodHRwczovL3Jhdy5naXRodWJ1c2VyY29udGVudC5jb20vJHtvd25lcn0vJHtyZXBvfS8ke2JyYW5jaH0vJHtpdGVtLnBhdGh9YDtcclxuICAgICAgICAgICAgY29uc3QgZGVzdFBhdGggPSBwYXRoLmpvaW4odGFyZ2V0RGlyLCByZWxhdGl2ZVBhdGgpO1xyXG5cclxuICAgICAgICAgICAgYXdhaXQgZnMubWtkaXIocGF0aC5kaXJuYW1lKGRlc3RQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBmaWxlUmVzID0gYXdhaXQgZmV0Y2gocmF3VXJsKTtcclxuICAgICAgICAgICAgaWYgKCFmaWxlUmVzLm9rKSB0aHJvdyBuZXcgRXJyb3IoYFx1NjVFMFx1NkNENVx1NEUwQlx1OEY3RFx1NjU4N1x1NEVGNjogJHtyZWxhdGl2ZVBhdGh9YCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IGZpbGVSZXMuYXJyYXlCdWZmZXIoKTtcclxuICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKGRlc3RQYXRoLCBCdWZmZXIuZnJvbShidWZmZXIpKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGRvd25sb2FkZWRGaWxlcyA9IGF3YWl0IGZzLnJlYWRkaXIodGFyZ2V0RGlyKTtcclxuICAgICAgICBjb25zdCBtb2RlbEpzb25GaWxlID0gZG93bmxvYWRlZEZpbGVzLmZpbmQoZiA9PiBmLmVuZHNXaXRoKCcubW9kZWwzLmpzb24nKSB8fCBmLmVuZHNXaXRoKCdtb2RlbC5qc29uJykpO1xyXG5cclxuICAgICAgICBpZiAoIW1vZGVsSnNvbkZpbGUpIHtcclxuICAgICAgICAgICAgYXdhaXQgZnMucm0odGFyZ2V0RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiAnXHU2MjQwXHU5MDA5XHU2NTg3XHU0RUY2XHU1OTM5XHU0RTJEXHU2NzJBXHU2MjdFXHU1MjMwIG1vZGVsLmpzb24gXHU2MjE2IC5tb2RlbDMuanNvbicgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHBhcnNlQW5kQ29tcGxldGVMaXZlMmRDb25maWcodGFyZ2V0RGlyLCBmb2xkZXJOYW1lLCBtb2RlbEpzb25GaWxlKTtcclxuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBtb2RlbDogY29uZmlnIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UgfHwgJ1x1N0Y1MVx1N0VEQ1x1NjIxNlx1ODlFM1x1Njc5MFx1OTUxOVx1OEJFRicgfTtcclxuICAgIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcclxuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcclxuaW1wb3J0ICogYXMgZXNidWlsZCBmcm9tICdlc2J1aWxkJztcclxuaW1wb3J0IHsgZ2V0QWxsU2tpbGxzIH0gZnJvbSAnLi9za2lsbHMtbWNwLXNlcnZpY2UnO1xyXG5cclxuLyoqXHJcbiAqIFJlY3Vyc2l2ZWx5IHNlYXJjaCBmb3IgYSBSZWFjdCBjb21wb25lbnQgZmlsZSAoLnRzeCkgbWF0Y2hpbmcgdGhlIGNvbXBvbmVudE5hbWUgaW5zaWRlIGEgZGlyLlxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gZmluZENvbXBvbmVudEluRGlyKGRpcjogc3RyaW5nLCBjb21wb25lbnROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgeyByZWFkZGlyIH0gPSBhd2FpdCBpbXBvcnQoJ25vZGU6ZnMvcHJvbWlzZXMnKTtcclxuICAgICAgICBjb25zdCBlbnRyaWVzID0gYXdhaXQgcmVhZGRpcihkaXIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcclxuXHJcbiAgICAgICAgLy8gY29uc29sZS5sb2coYFtTa2lsbFByb3RvY29sXSBTZWFyY2hpbmcgaW4gJHtkaXJ9IGZvciBcIiR7Y29tcG9uZW50TmFtZX1cIiAoJHtlbnRyaWVzLmxlbmd0aH0gZW50cmllcylgKTtcclxuXHJcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aC5qb2luKGRpciwgZW50cnkubmFtZSk7XHJcbiAgICAgICAgICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmb3VuZCA9IGF3YWl0IGZpbmRDb21wb25lbnRJbkRpcihmdWxsUGF0aCwgY29tcG9uZW50TmFtZSk7XHJcbiAgICAgICAgICAgICAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChlbnRyeS5pc0ZpbGUoKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZXh0ID0gcGF0aC5leHRuYW1lKGVudHJ5Lm5hbWUpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZSA9IHBhdGguYmFzZW5hbWUoZW50cnkubmFtZSwgZXh0KTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBDYXNlLWluc2Vuc2l0aXZlIG1hdGNoIGZvciB0aGUgY29tcG9uZW50IG5hbWUgYXMgYSBmaWxlbmFtZVxyXG4gICAgICAgICAgICAgICAgaWYgKChiYXNlLnRvTG93ZXJDYXNlKCkgPT09IGNvbXBvbmVudE5hbWUudG9Mb3dlckNhc2UoKSkgJiYgKGV4dCA9PT0gJy50c3gnIHx8IGV4dCA9PT0gJy5qc3gnKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmdWxsUGF0aDtcclxuICAgICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgICAvLyBNYXRjaCBpbmRleC50c3ggaWYgdGhlIHBhcmVudCBmb2xkZXIgbWF0Y2hlcyB0aGUgY29tcG9uZW50IG5hbWVcclxuICAgICAgICAgICAgICAgIGlmICgoZW50cnkubmFtZS50b0xvd2VyQ2FzZSgpID09PSAnaW5kZXgudHN4JyB8fCBlbnRyeS5uYW1lLnRvTG93ZXJDYXNlKCkgPT09ICdpbmRleC5qc3gnKSAmJlxyXG4gICAgICAgICAgICAgICAgICAgIHBhdGguYmFzZW5hbWUoZGlyKS50b0xvd2VyQ2FzZSgpID09PSBjb21wb25lbnROYW1lLnRvTG93ZXJDYXNlKCkpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgW1NraWxsUHJvdG9jb2xdIGZpbmRDb21wb25lbnRJbkRpciBFcnJvciBpbiAke2Rpcn06YCwgZSk7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBSZXNvbHZlcyBhIGNvbXBvbmVudCBuYW1lIChlLmcuICdDdXN0b21DaGFydCcpIHRvIGl0cyBhYnNvbHV0ZSBmaWxlIHBhdGggYnkgc2Nhbm5pbmcgYWxsIGxvYWRlZCBza2lsbHMuXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlQ29tcG9uZW50UGF0aChjb21wb25lbnROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcclxuICAgIGNvbnN0IHNraWxscyA9IGF3YWl0IGdldEFsbFNraWxscygpO1xyXG4gICAgY29uc29sZS5sb2coYFtTa2lsbFByb3RvY29sXSBSZXNvbHZpbmcgXCIke2NvbXBvbmVudE5hbWV9XCIgYW1vbmcgJHtza2lsbHMubGVuZ3RofSBza2lsbHNgKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IHNraWxsIG9mIHNraWxscykge1xyXG4gICAgICAgIC8vIExvb2sgaW5zaWRlIHRoZSBza2lsbCBmb2xkZXJcclxuICAgICAgICBjb25zdCBmb3VuZCA9IGF3YWl0IGZpbmRDb21wb25lbnRJbkRpcihza2lsbC5wYXRoLCBjb21wb25lbnROYW1lKTtcclxuICAgICAgICBpZiAoZm91bmQpIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtTa2lsbFByb3RvY29sXSBGb3VuZCBcIiR7Y29tcG9uZW50TmFtZX1cIiBhdCAke2ZvdW5kfWApO1xyXG4gICAgICAgICAgICByZXR1cm4gZm91bmQ7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmxldCByZXF1ZXN0Q291bnRlciA9IDA7XHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlU2tpbGxSZXF1ZXN0KHJlcXVlc3Q6IFJlcXVlc3QpOiBQcm9taXNlPFJlc3BvbnNlPiB7XHJcbiAgICBjb25zdCByaWQgPSArK3JlcXVlc3RDb3VudGVyO1xyXG4gICAgY29uc29sZS5sb2coYFtTa2lsbFByb3RvY29sXVsjJHtyaWR9XSA8LS0tLSBJbmNvbWluZyBSZXF1ZXN0OiAke3JlcXVlc3QudXJsfWApO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICAvLyBVUkwgZm9ybWF0OiBza2lsbDovL0NvbXBvbmVudE5hbWUgb3Igc2tpbGw6Ly9Hcm91cE5hbWUvQ29tcG9uZW50TmFtZVxyXG4gICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbU2tpbGxQcm90b2NvbF1bIyR7cmlkfV0gUGFyc2luZzogSG9zdD1cIiR7dXJsLmhvc3RuYW1lfVwiLCBQYXRoPVwiJHt1cmwucGF0aG5hbWV9XCJgKTtcclxuXHJcbiAgICAgICAgLy8gQ29tYmluZSBob3N0bmFtZSBhbmQgcGF0aG5hbWUsIHRoZW4gY2xlYW4gdXAgc2xhc2hlc1xyXG4gICAgICAgIGxldCBjb21wb25lbnROYW1lID0gKHVybC5ob3N0bmFtZSArIHVybC5wYXRobmFtZSkucmVwbGFjZSgvXlxcL3xcXC8kL2csICcnKTtcclxuXHJcbiAgICAgICAgLy8gU3RyaXAgY29tbW9uIHN1ZmZpeGVzIHRoYXQgbWlnaHQgYmUgYWRkZWQgYnkgdGhlIGJyb3dzZXIgb3IgYnVuZGxlclxyXG4gICAgICAgIGNvbXBvbmVudE5hbWUgPSBjb21wb25lbnROYW1lXHJcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXC9tYWluXFwuanMkLywgJycpXHJcbiAgICAgICAgICAgIC5yZXBsYWNlKC9cXC9pbmRleFxcLmpzJC8sICcnKVxyXG4gICAgICAgICAgICAucmVwbGFjZSgvXFwuKGpzfGpzeHx0c3x0c3gpJC8sICcnKTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYFtTa2lsbFByb3RvY29sXVsjJHtyaWR9XSBUYXJnZXRlZCBjb21wb25lbnQgaWRlbnRpZmllcjogXCIke2NvbXBvbmVudE5hbWV9XCJgKTtcclxuXHJcbiAgICAgICAgaWYgKCFjb21wb25lbnROYW1lKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoJ01pc3NpbmcgY29tcG9uZW50IG5hbWUnLCB7IHN0YXR1czogNDAwIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSBhd2FpdCByZXNvbHZlQ29tcG9uZW50UGF0aChjb21wb25lbnROYW1lKTtcclxuXHJcbiAgICAgICAgaWYgKCFmaWxlUGF0aCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbU2tpbGxQcm90b2NvbF1bIyR7cmlkfV0gQ29tcG9uZW50IFwiJHtjb21wb25lbnROYW1lfVwiIG5vdCBmb3VuZCBpbiBhbnkgc2tpbGwuYCk7XHJcbiAgICAgICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoYENvbXBvbmVudCAke2NvbXBvbmVudE5hbWV9IG5vdCBmb3VuZGAsIHsgc3RhdHVzOiA0MDQgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgW1NraWxsUHJvdG9jb2xdWyMke3JpZH1dIENvbXBpbGluZyAke2NvbXBvbmVudE5hbWV9IGZyb20gJHtmaWxlUGF0aH1gKTtcclxuICAgICAgICBjb25zdCBzb3VyY2VDb2RlID0gYXdhaXQgcmVhZEZpbGUoZmlsZVBhdGgsICd1dGYtOCcpO1xyXG5cclxuICAgICAgICAvLyBDb21waWxlIC50c3ggLT4gLmpzIHVzaW5nIGVzYnVpbGQgb24gdGhlIGZseVxyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVzYnVpbGQudHJhbnNmb3JtKHNvdXJjZUNvZGUsIHtcclxuICAgICAgICAgICAgbG9hZGVyOiAndHN4JyxcclxuICAgICAgICAgICAganN4OiAnYXV0b21hdGljJywgIC8vIFVzZSBSZWFjdCAxOCsgYXV0b21hdGljIEpTWCBydW50aW1lXHJcbiAgICAgICAgICAgIHRhcmdldDogJ2VzbmV4dCcsXHJcbiAgICAgICAgICAgIGZvcm1hdDogJ2VzbScsICAgICAvLyBFeHBvcnQgYXMgRVMgbW9kdWxlIHNvIFJlYWN0LmxhenkgY2FuIGltcG9ydCBpdFxyXG4gICAgICAgICAgICBzb3VyY2VtYXA6ICdpbmxpbmUnXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbU2tpbGxQcm90b2NvbF1bIyR7cmlkfV0gQ29tcGlsYXRpb24gc3VjY2Vzc2Z1bCBmb3IgJHtjb21wb25lbnROYW1lfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbU2tpbGxQcm90b2NvbF1bIyR7cmlkfV0gRmlyc3QgMjAwIGNoYXJzIG9mIGNvZGU6XFxuJHtyZXN1bHQuY29kZS5zdWJzdHJpbmcoMCwgMjAwKX0uLi5gKTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHN0YW5kYXJkIENPUlMgaGVhZGVycyBqdXN0IGluIGNhc2VcclxuICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKHJlc3VsdC5jb2RlLCB7XHJcbiAgICAgICAgICAgIHN0YXR1czogMjAwLFxyXG4gICAgICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2phdmFzY3JpcHQnLFxyXG4gICAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFtTa2lsbFByb3RvY29sXVsjJHtyaWR9XSBDb21waWxhdGlvbiBlcnJvciBmb3IgJHtyZXF1ZXN0LnVybH06YCwgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoYENvbXBpbGF0aW9uIEVycm9yOiAkeyhlcnJvciBhcyBFcnJvcik/Lm1lc3NhZ2UgfHwgU3RyaW5nKGVycm9yKX1gLCB7IHN0YXR1czogNTAwIH0pO1xyXG4gICAgfVxyXG59XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxTQUFTLGlCQUFBQSxzQkFBcUI7QUFHOUIsT0FBT0MsWUFBVTtBQUNqQixTQUFTLGlCQUFBQyxzQkFBcUI7OztBQzJCdkIsSUFBTSx3QkFBd0I7QUFBQSxFQUNuQyxxQkFBcUI7QUFBQSxFQUNyQixpQkFBaUI7QUFBQSxFQUNqQix1QkFBdUI7QUFBQSxFQUN2QixvQkFBb0I7QUFBQSxFQUNwQixrQkFBa0I7QUFBQSxFQUNsQixpQkFBaUI7QUFBQSxFQUNqQix1QkFBdUI7QUFBQSxFQUN2QixvQkFBb0I7QUFBQSxFQUNwQix1QkFBdUI7QUFBQSxFQUN2QiwwQkFBMEI7QUFBQSxFQUMxQixnQkFBZ0I7QUFBQSxFQUNoQixlQUFlO0FBQ2pCO0FBRU8sSUFBTSxxQkFBcUI7QUFBQSxFQUNoQyxXQUFXO0FBQUEsRUFDWCxVQUFVO0FBQUEsRUFDVixZQUFZO0FBQUEsRUFDWixZQUFZO0FBQUEsRUFDWixXQUFXO0FBQUEsRUFDWCxhQUFhO0FBQUEsRUFDYixjQUFjO0FB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akMsSUFBQUEsS0FBSSxLQUFLO0FBQUEsRUFDWDtBQUNGLENBQUM7QUFFREEsS0FBSSxHQUFHLGVBQWUsTUFBTTtBQUMxQixlQUFhO0FBQ2IsdUJBQXFCO0FBQ3ZCLENBQUM7IiwKICAibmFtZXMiOiBbImNyZWF0ZVJlcXVpcmUiLCAicGF0aCIsICJmaWxlVVJMVG9QYXRoIiwgInBhdGgiLCAibWtkaXIiLCAicmVhZEZpbGUiLCAid3JpdGVGaWxlIiwgInBhdGgiLCAibWtkaXIiLCAicGF0aCIsICJta2RpciIsICJwYXRoIiwgIm1rZGlyIiwgIndyaXRlRmlsZSIsICJwYXRoIiwgIm1rZGlyIiwgIndyaXRlRmlsZSIsICJyZWFkRmlsZSIsICJta2RpciIsICJwYXRoIiwgIndyaXRlRmlsZSIsICJwYXRoIiwgIm1rZGlyIiwgInJlYWRGaWxlIiwgInJlYWRkaXIiLCAid3JpdGVGaWxlIiwgInJlcXVpcmUiLCAicGF0aCIsICJlbnN1cmVEaXJlY3RvcnkiLCAibWtkaXIiLCAicmVhZEZpbGUiLCAicmVhZGRpciIsICJ3cml0ZUZpbGUiLCAicGF0aCIsICJyZWFkRmlsZSIsICJjcmVhdGVSZXF1aXJlIiwgInBhdGNoIiwgInoiLCAieiIsICJ6IiwgInJlcXVpcmUiLCAiY3JlYXRlUmVxdWlyZSIsICJhcHAiLCAiU0tJTExfRklMRV9DQU5ESURBVEVTIiwgInBhdGgiLCAicmVhZEZpbGUiLCAiX19maWxlbmFtZSIsICJfX2Rpcm5hbWUiLCAiY29udGVudCIsICJzbHVnaWZ5IiwgIm5vcm1hbGl6ZVByb3ZpZGVySWQiLCAiUFJPVklERVJfSUNPTl9NQVAiLCAiYnVpbGRQcm92aWRlckluaXRpYWxzIiwgImdldFByb3ZpZGVySWNvbiIsICJjcmVhdGVSZXF1aXJlIiwgInJlcXVpcmUiLCAiYXBwIiwgInRvRmFpbHVyZSIsICJ0b1N1Y2Nlc3MiLCAiY3JlYXRlUmVxdWlyZSIsICJwYXRoIiwgInJlYWRGaWxlIiwgInJlYWRkaXIiLCAic3RhdCIsICJta2RpciIsICJ3cml0ZUZpbGUiLCAiZmlsZVVSTFRvUGF0aCIsICJjcmVhdGVSZXF1aXJlIiwgInJlcXVpcmUiLCAiY3JlYXRlUmVxdWlyZSIsICJhcHAiLCAiU0tJTExfRklMRV9DQU5ESURBVEVTIiwgInBhcnNlRnJvbnRtYXR0ZXIiLCAicGF0aCIsICJyZWFkRmlsZSIsICJlbnN1cmVEaXJlY3RvcnkiLCAibWtkaXIiLCAic3RhdCIsICJfX2ZpbGVuYW1lIiwgImZpbGVVUkxUb1BhdGgiLCAiX19kaXJuYW1lIiwgInJlYWRkaXIiLCAid3JpdGVGaWxlIiwgInJlcXVpcmUiLCAiY3JlYXRlUmVxdWlyZSIsICJjcmVhdGVSZXF1aXJlIiwgImNyZWF0ZVJlcXVpcmUiLCAicGF0aCIsICJyZXF1aXJlIiwgImNyZWF0ZVJlcXVpcmUiLCAiZGlhbG9nIiwgInBhdGgiLCAic3RhdCIsICJyZXF1aXJlIiwgImNyZWF0ZVJlcXVpcmUiLCAiaXBjTWFpbiIsICJyZWFkRmlsZSIsICJwYXRoIiwgInJlYWRkaXIiLCAicGF0aCIsICJyZWFkRmlsZSIsICJyZXF1aXJlIiwgImNyZWF0ZVJlcXVpcmUiLCAiYXBwIiwgIkJyb3dzZXJXaW5kb3ciLCAiaXBjTWFpbiIsICJmaWxlVVJMVG9QYXRoIiwgInBhdGgiXQp9Cg==
