
      // ESM to CJS compatibility shim
      const import_meta_url = require("url").pathToFileURL(__filename).href;
      
      // Robust Electron Module Fix: Force built-in resolution
      const Module = require('module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === 'electron') {
          try {
            const res = originalLoad.apply(this, ['electron', { paths: [] }, isMain]);
            if (res && typeof res !== 'string') return res;
          } catch (e) {}
        }
        return originalLoad.apply(this, arguments);
      };
    
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main/electron-main.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path12 = __toESM(require("node:path"), 1);
var import_node_url2 = require("node:url");
var import_electron6 = require("electron");

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
  agentCollaborationEvents: "agent:collaboration-events",
  agentChat: "agent:chat",
  agentChatStream: "agent:chat-stream",
  agentChatCancel: "agent:chat-cancel",
  agentTaskList: "agent:task-list",
  agentTaskCreate: "agent:task-create",
  agentTaskDelete: "agent:task-delete",
  agentTaskProgress: "agent:task-progress",
  agentNotificationList: "agent:notification-list",
  agentNotificationMarkRead: "agent:notification-mark-read"
};
var LIVE2D_IPC_CHANNELS = {
  importModel: "live2d:import-model",
  listModels: "live2d:list-models",
  saveConfig: "live2d:save-config",
  downloadGithub: "live2d:download-github"
};

// src/main/agent-profile-service.ts
var import_node_path4 = __toESM(require("node:path"), 1);
var import_promises4 = require("node:fs/promises");

// src/main/agent-config-manager.ts
var import_node_path2 = __toESM(require("node:path"), 1);
var import_promises2 = require("node:fs/promises");

// src/main/shared-workspace-manager.ts
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_promises = require("node:fs/promises");
var WEBOT_HOME_DIR_NAME = ".webot";
async function ensureDirectory(dirPath) {
  await (0, import_promises.mkdir)(dirPath, { recursive: true });
}
function normalizeAgentId(agentId) {
  const normalized = agentId.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
  if (normalized.length === 0) {
    throw new Error("\u667A\u80FD\u4F53 ID \u975E\u6CD5\uFF1A\u4E0D\u80FD\u4E3A\u7A7A\u6216\u5168\u662F\u7279\u6B8A\u5B57\u7B26\u3002");
  }
  return normalized;
}
function resolveWeBotHomeRoot(homeDirOverride) {
  const homeRoot = homeDirOverride ?? import_node_os.default.homedir();
  return import_node_path.default.join(homeRoot, WEBOT_HOME_DIR_NAME);
}
async function ensureSharedWorkspace(homeDirOverride) {
  const webotHomeRoot = resolveWeBotHomeRoot(homeDirOverride);
  const sharedRoot = import_node_path.default.join(webotHomeRoot, "shared");
  const agentsRoot = import_node_path.default.join(webotHomeRoot, "agents");
  const zeroclawRoot = import_node_path.default.join(webotHomeRoot, "zeroclaw");
  const sharedSkillsRoot = import_node_path.default.join(webotHomeRoot, "skills");
  const sharedMcpRoot = import_node_path.default.join(webotHomeRoot, "mcp");
  const sharedDataRoot = import_node_path.default.join(sharedRoot, "data");
  const sharedMediaRoot = import_node_path.default.join(sharedRoot, "media");
  const sharedModelsRoot = import_node_path.default.join(sharedRoot, "models");
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
  const agentRoot = import_node_path.default.join(shared.agentsRoot, normalizedAgentId);
  const privateSkillsRoot = import_node_path.default.join(agentRoot, "skills");
  const privateMcpRoot = import_node_path.default.join(agentRoot, "mcp");
  const privateMemoryRoot = import_node_path.default.join(agentRoot, "memory");
  const privateDataRoot = import_node_path.default.join(agentRoot, "data");
  const privateLogsRoot = import_node_path.default.join(agentRoot, "logs");
  await ensureDirectory(agentRoot);
  await ensureDirectory(privateMemoryRoot);
  await ensureDirectory(privateDataRoot);
  await ensureDirectory(privateLogsRoot);
  return {
    agentId: normalizedAgentId,
    agentRoot,
    privateSkillsRoot,
    privateMcpRoot,
    privateMemoryRoot,
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
      privateMemoryRoot: agent.privateMemoryRoot,
      privateDataRoot: agent.privateDataRoot,
      privateLogsRoot: agent.privateLogsRoot,
      sharedSkillsRoot: shared.sharedSkillsRoot,
      sharedMcpRoot: shared.sharedMcpRoot,
      sharedDataRoot: shared.sharedDataRoot,
      sharedMediaRoot: shared.sharedMediaRoot
    },
    skills: {
      privateSkills: input.privateSkills ?? [],
      // 统一使用全局技能池，智能体仅记录启用列表；shared 字段保留兼容。
      sharedSkills: []
    },
    mcp: {
      privateServers: input.privateMcpServers ?? [],
      // 统一使用全局 MCP 池，智能体仅记录启用列表；shared 字段保留兼容。
      sharedServers: []
    },
    team: {
      members: input.teamMembers ?? []
    }
  };
}
async function writeAgentRuntimeConfigFile(config, homeDirOverride, targetFilePath) {
  const agentWorkspace = await ensureAgentWorkspace(config.agentId, homeDirOverride);
  const outputPath = targetFilePath ?? import_node_path2.default.join(agentWorkspace.agentRoot, "agent.config.json");
  await (0, import_promises2.mkdir)(import_node_path2.default.dirname(outputPath), { recursive: true });
  await (0, import_promises2.writeFile)(outputPath, JSON.stringify(config, null, 2), "utf-8");
  return outputPath;
}

// src/main/zeroclaw-config-manager.ts
var import_node_path3 = __toESM(require("node:path"), 1);
var import_promises3 = require("node:fs/promises");

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
var DEFAULT_TIMEOUT_MS = 6e5;
var LEGACY_DEFAULT_TIMEOUT_MS = 6e4;
var PREVIOUS_DEFAULT_TIMEOUT_MS = 18e4;
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
  return import_node_path3.default.join(shared.zeroclawRoot, "zeroclaw.config.json");
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
    const raw = await (0, import_promises3.readFile)(configPath, "utf-8");
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
    const resolvedTimeoutMs = (() => {
      const current = existing.defaults.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (current === LEGACY_DEFAULT_TIMEOUT_MS || current === PREVIOUS_DEFAULT_TIMEOUT_MS) {
        return DEFAULT_TIMEOUT_MS;
      }
      return current;
    })();
    const normalized = {
      ...existing,
      defaults: {
        ...existing.defaults,
        primaryProviderId: existing.defaults.primaryProviderId ?? existing.modelProviders[0]?.id,
        defaultModelId: existing.defaults.defaultModelId ?? existing.modelCatalog.find((item) => item.providerId === existing.defaults.primaryProviderId)?.modelId,
        timeoutMs: resolvedTimeoutMs
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
  const outputPath = targetFilePath ?? import_node_path3.default.join(shared.zeroclawRoot, "zeroclaw.config.json");
  await (0, import_promises3.mkdir)(import_node_path3.default.dirname(outputPath), { recursive: true });
  await (0, import_promises3.writeFile)(outputPath, JSON.stringify(config, null, 2), "utf-8");
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
var TEAM_TOOL_NAME_MAP = {
  sys_search: "\u7CFB\u7EDF\u641C\u7D22",
  web_request: "\u7F51\u7EDC\u8BF7\u6C42",
  file_read: "\u6587\u4EF6\u8BFB\u53D6",
  file_write: "\u6587\u4EF6\u5199\u5165",
  file_delete: "\u6587\u4EF6\u5220\u9664",
  mcp_tools: "MCP \u5DE5\u5177"
};
function normalizeStringList(values) {
  if (!values) return [];
  const normalized = values.map((item) => item.trim()).filter((item) => item.length > 0);
  return Array.from(new Set(normalized));
}
function normalizeTeamMemberId(input, fallbackIndex) {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || `member-${fallbackIndex + 1}`;
}
function normalizeToolPermissions(permissions) {
  if (!permissions) return [];
  const normalized = permissions.map((item) => ({
    id: item.id.trim(),
    name: item.name.trim() || TEAM_TOOL_NAME_MAP[item.id.trim()] || item.id.trim(),
    enabled: item.enabled !== false
  })).filter((item) => item.id.length > 0);
  const unique = /* @__PURE__ */ new Map();
  for (const item of normalized) {
    unique.set(item.id, item);
  }
  return Array.from(unique.values());
}
function normalizeTeamMembers(members, fallbackProviderId, fallbackModelName) {
  if (!members || members.length === 0) return [];
  const result = [];
  const usedIds = /* @__PURE__ */ new Set();
  members.forEach((member, index) => {
    const memberIdBase = normalizeTeamMemberId(member.id || member.name || "", index);
    let memberId = memberIdBase;
    let suffix = 2;
    while (usedIds.has(memberId)) {
      memberId = `${memberIdBase}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(memberId);
    const allowedTools = normalizeStringList(member.allowedTools);
    const toolPermissions = normalizeToolPermissions(member.toolPermissions);
    const mergedAllowedTools = allowedTools.length > 0 ? allowedTools : toolPermissions.filter((item) => item.enabled).map((item) => item.id);
    result.push({
      id: memberId,
      name: member.name?.trim() || `\u6210\u5458 ${index + 1}`,
      role: member.role?.trim() || "\u5B50\u667A\u80FD\u4F53",
      avatarUrl: member.avatarUrl?.trim() || void 0,
      systemPrompt: member.systemPrompt?.trim() || "",
      providerId: member.providerId?.trim() || fallbackProviderId,
      modelName: member.modelName?.trim() || fallbackModelName,
      allowedTools: mergedAllowedTools,
      toolPermissions
    });
  });
  return result;
}
function createDefaultTeamMembers(providerId, modelName) {
  return [
    {
      id: "developer-executor",
      name: "\u5F00\u53D1\u6267\u884C",
      role: "\u5B50\u667A\u80FD\u4F53",
      systemPrompt: "\u4F60\u662F\u6267\u884C\u5F00\u53D1\u6210\u5458\uFF0C\u8D1F\u8D23\u6309\u7167\u8D1F\u8D23\u4EBA\u62C6\u89E3\u7684\u4EFB\u52A1\u5B9E\u73B0\u4EE3\u7801\u5E76\u6C47\u62A5\u7ED3\u679C\u3002",
      providerId,
      modelName,
      allowedTools: ["sys_search", "web_request", "file_read", "file_write", "mcp_tools"],
      toolPermissions: [
        { id: "sys_search", name: TEAM_TOOL_NAME_MAP.sys_search, enabled: true },
        { id: "web_request", name: TEAM_TOOL_NAME_MAP.web_request, enabled: true },
        { id: "file_read", name: TEAM_TOOL_NAME_MAP.file_read, enabled: true },
        { id: "file_write", name: TEAM_TOOL_NAME_MAP.file_write, enabled: true },
        { id: "file_delete", name: TEAM_TOOL_NAME_MAP.file_delete, enabled: false },
        { id: "mcp_tools", name: TEAM_TOOL_NAME_MAP.mcp_tools, enabled: true }
      ]
    },
    {
      id: "qa-reviewer",
      name: "\u6D4B\u8BD5\u8BC4\u5BA1",
      role: "\u5B50\u667A\u80FD\u4F53",
      systemPrompt: "\u4F60\u662F\u6D4B\u8BD5\u4E0E\u8BC4\u5BA1\u6210\u5458\uFF0C\u8D1F\u8D23\u9A8C\u8BC1\u4EA4\u4ED8\u8D28\u91CF\u3001\u8BC6\u522B\u98CE\u9669\u5E76\u7ED9\u51FA\u56DE\u5F52\u5EFA\u8BAE\u3002",
      providerId,
      modelName,
      allowedTools: ["sys_search", "file_read", "mcp_tools"],
      toolPermissions: [
        { id: "sys_search", name: TEAM_TOOL_NAME_MAP.sys_search, enabled: true },
        { id: "web_request", name: TEAM_TOOL_NAME_MAP.web_request, enabled: false },
        { id: "file_read", name: TEAM_TOOL_NAME_MAP.file_read, enabled: true },
        { id: "file_write", name: TEAM_TOOL_NAME_MAP.file_write, enabled: false },
        { id: "file_delete", name: TEAM_TOOL_NAME_MAP.file_delete, enabled: false },
        { id: "mcp_tools", name: TEAM_TOOL_NAME_MAP.mcp_tools, enabled: true }
      ]
    }
  ];
}
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
      teamMembers: seed.agentId === "agent-dev" ? createDefaultTeamMembers(providerId, modelName) : [],
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
    const raw = await (0, import_promises4.readFile)(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}
async function writeJsonFile(filePath, data) {
  await (0, import_promises4.mkdir)(import_node_path4.default.dirname(filePath), { recursive: true });
  await (0, import_promises4.writeFile)(filePath, JSON.stringify(data, null, 2), "utf-8");
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
  const indexPath = import_node_path4.default.join(shared.agentsRoot, AGENTS_INDEX_FILE);
  return readJsonFile(indexPath);
}
async function writeAgentsIndexFile(agents, homeDirOverride) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const indexPath = import_node_path4.default.join(shared.agentsRoot, AGENTS_INDEX_FILE);
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
async function ensureProfileTeamData(profile, profilePath) {
  const teamRaw = profile.team?.members;
  const normalizedTeam = normalizeTeamMembers(
    teamRaw,
    profile.defaultLlm.providerId,
    profile.defaultLlm.modelName
  );
  const shouldBackfillDefaults = profile.agentId === "agent-dev" && normalizedTeam.length === 0;
  const nextTeam = shouldBackfillDefaults ? createDefaultTeamMembers(profile.defaultLlm.providerId, profile.defaultLlm.modelName) : normalizedTeam;
  const nextProfile = {
    ...profile,
    team: {
      members: nextTeam
    }
  };
  const currentSerialized = JSON.stringify(profile.team ?? null);
  const nextSerialized = JSON.stringify(nextProfile.team);
  if (currentSerialized !== nextSerialized) {
    await writeJsonFile(profilePath, nextProfile);
  }
  return nextProfile;
}
async function saveAgentProfile(input) {
  const agentId = resolveAgentId(input);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const workspace = await ensureAgentWorkspace(agentId, input.homeDirOverride);
  const existingProfilePath = import_node_path4.default.join(workspace.agentRoot, AGENT_PROFILE_FILE);
  const existing = await readJsonFile(existingProfilePath);
  const privateSkills = normalizeStringList(input.privateSkills);
  const privateMcpServers = normalizeStringList(input.privateMcpServers);
  const currentTeamMembers = existing?.team?.members;
  const teamInput = input.teamMembers ?? currentTeamMembers;
  const teamMembers = normalizeTeamMembers(
    teamInput,
    input.defaultProviderId,
    input.defaultModelName
  );
  const runtimeConfig = await buildAgentRuntimeConfig({
    agentId,
    displayName: input.name,
    providerId: input.defaultProviderId,
    modelName: input.defaultModelName,
    systemPrompt: input.systemPrompt,
    privateSkills,
    sharedSkills: [],
    privateMcpServers,
    sharedMcpServers: [],
    teamMembers,
    homeDirOverride: input.homeDirOverride
  });
  const runtimeConfigPath = await writeAgentRuntimeConfigFile(runtimeConfig, input.homeDirOverride);
  const systemPromptPath = import_node_path4.default.join(workspace.agentRoot, AGENT_PROMPT_FILE);
  await (0, import_promises4.writeFile)(systemPromptPath, input.systemPrompt, "utf-8");
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
      privateSkills,
      // 统一使用全局技能池，智能体仅记录启用列表；shared 字段保留兼容。
      sharedSkills: []
    },
    mcp: {
      privateServers: privateMcpServers,
      // 统一使用全局 MCP 池，智能体仅记录启用列表；shared 字段保留兼容。
      sharedServers: []
    },
    team: {
      members: teamMembers
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
      privateMemoryRoot: workspace.privateMemoryRoot,
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
  const profilePath = import_node_path4.default.join(workspace.agentRoot, AGENT_PROFILE_FILE);
  const profile = await readJsonFile(profilePath);
  if (!profile) {
    throw new Error(`\u667A\u80FD\u4F53\u4E0D\u5B58\u5728\uFF1A${input.agentId}`);
  }
  return ensureProfileTeamData(profile, profilePath);
}
async function scanAgentProfiles(homeDirOverride) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const dirs = await (0, import_promises4.readdir)(shared.agentsRoot, { withFileTypes: true });
  const profiles = [];
  for (const entry of dirs) {
    if (!entry.isDirectory()) {
      continue;
    }
    const profilePath = import_node_path4.default.join(shared.agentsRoot, entry.name, AGENT_PROFILE_FILE);
    const profile = await readJsonFile(profilePath);
    if (profile) {
      profiles.push(await ensureProfileTeamData(profile, profilePath));
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
      profiles.push(await ensureProfileTeamData(profile, item.profilePath));
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
var import_node_path6 = __toESM(require("node:path"), 1);
var import_node_fs = require("node:fs");
var import_promises6 = require("node:fs/promises");
var import_node_net = __toESM(require("node:net"), 1);
var import_node_child_process = require("node:child_process");
var import_node_url = require("node:url");
var import_node_sqlite = require("node:sqlite");
var import_electron = require("electron");

// src/main/agent-collaboration-event-service.ts
var import_node_path5 = __toESM(require("node:path"), 1);
var import_promises5 = require("node:fs/promises");
function toDateKey(date = /* @__PURE__ */ new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function createEventId(now = /* @__PURE__ */ new Date()) {
  return `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
}
function normalizeLine(input) {
  return input.replace(/\s+/g, " ").trim();
}
function inferEventKindFromRuntimeLog(line) {
  const lower = line.toLowerCase();
  if (lower.includes("delegate") || lower.includes("subagent") || lower.includes("sub-agent") || lower.includes("agent_call")) {
    return "delegate_call";
  }
  if (lower.includes("agents_send") || lower.includes("agents_inbox") || lower.includes("agents_list") || lower.includes("agents_ipc")) {
    return "ipc_call";
  }
  if (lower.includes("tool") || lower.includes("/api/tools") || lower.includes("mcp") || lower.includes("function call")) {
    return "tool_call";
  }
  return "runtime_log";
}
async function resolveEventFilePath(agentId, homeDirOverride) {
  const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
  const eventDir = import_node_path5.default.join(workspace.privateLogsRoot, "collaboration");
  await (0, import_promises5.mkdir)(eventDir, { recursive: true });
  return import_node_path5.default.join(eventDir, `${toDateKey()}.jsonl`);
}
async function appendAgentCollaborationEvent(agentId, requestId, event, homeDirOverride) {
  const now = /* @__PURE__ */ new Date();
  const payload = {
    eventId: createEventId(now),
    agentId,
    requestId,
    kind: event.kind,
    message: normalizeLine(event.message).slice(0, 2e3),
    createdAt: event.createdAt ?? now.toISOString(),
    meta: event.meta
  };
  const filePath = await resolveEventFilePath(agentId, homeDirOverride);
  await (0, import_promises5.appendFile)(filePath, `${JSON.stringify(payload)}
`, "utf-8");
}
async function getRecentAgentCollaborationEvents(input) {
  const workspace = await ensureAgentWorkspace(input.agentId, input.homeDirOverride);
  const eventDir = import_node_path5.default.join(workspace.privateLogsRoot, "collaboration");
  const limit = Math.max(1, Math.min(2e3, input.limit ?? 200));
  let files = [];
  try {
    files = (await (0, import_promises5.readdir)(eventDir)).filter((name) => name.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  const result = [];
  for (let index = files.length - 1; index >= 0; index -= 1) {
    if (result.length >= limit) break;
    const filePath = import_node_path5.default.join(eventDir, files[index]);
    let content = "";
    try {
      content = await (0, import_promises5.readFile)(filePath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/).filter(Boolean);
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      if (result.length >= limit) break;
      const raw = lines[lineIndex];
      try {
        const item = JSON.parse(raw);
        if (item?.agentId === input.agentId && typeof item.requestId === "string") {
          result.push(item);
        }
      } catch {
      }
    }
  }
  return result.reverse();
}

// src/main/agent-runtime-service.ts
var GLOBAL_SYSTEM_PROMPT_FILE = "angets.md";
var ZEROCLAW_LOG_DIR = "zeroclaw";
var ZEROCLAW_WORKSPACE_PROMPT_FILE = "AGENTS.md";
var ZEROCLAW_GATEWAY_HOST = "127.0.0.1";
var ZEROCLAW_GATEWAY_PORT_BASE = 43600;
var ZEROCLAW_GATEWAY_PORT_SPAN = 1e3;
var GATEWAY_READY_TIMEOUT_MS = 6e4;
var GATEWAY_READY_POLL_INTERVAL_MS = 250;
var DEFAULT_GATEWAY_REQUEST_TIMEOUT_SECS = 600;
var DEFAULT_AUTONOMY_MAX_ACTIONS_PER_HOUR = 300;
var DEFAULT_AUTONOMY_MAX_COST_PER_DAY_CENTS = 5e3;
var DEFAULT_AUTONOMY_ALLOWED_COMMANDS = [
  "git",
  "npm",
  "cargo",
  "ls",
  "cat",
  "grep",
  "find",
  "echo",
  "pwd",
  "wc",
  "head",
  "tail",
  "date"
];
var DEFAULT_AUTONOMY_FORBIDDEN_PATHS = [
  "/etc",
  "/root",
  "/home",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/opt",
  "/boot",
  "/dev",
  "/proc",
  "/sys",
  "/var",
  "/tmp",
  "~/.ssh",
  "~/.gnupg",
  "~/.aws",
  "~/.config"
];
var DEFAULT_AUTONOMY_AUTO_APPROVE_TOOLS = ["file_read", "memory_recall"];
var TASK_SYNC_INTERVAL_MS = 8e3;
var TASK_SYNC_TIMEOUT_MS = 1e4;
var DEFAULT_WEB_SEARCH_PROVIDER = "tavily";
var DEFAULT_WEB_SEARCH_MAX_RESULTS = 5;
var DEFAULT_WEB_SEARCH_TIMEOUT_SECS = 20;
var TASK_AGENT_PROMPT_MAX_LENGTH = 320;
var TASK_AGENT_FORBIDDEN_PROMPT_PATTERN = /\b(cron_add|cron_update|cron_remove|cron_run|cron_list|web_search_config|web_access_config|model_routing_config|curl|wget)\b/gi;
var TASK_AGENT_NOISE_PATTERN = /\b(discord|telegram|slack|mattermost|lark|feishu|email|channel[_-]?id|delivery|announce|push)\b/gi;
var TEAM_TOOL_TO_ZEROCLAW_TOOLS = {
  sys_search: ["glob_search", "content_search", "web_search_tool"],
  web_request: ["http_request", "web_fetch"],
  file_read: ["file_read"],
  file_write: ["file_write"],
  file_delete: ["file_delete"]
};
var agentProcesses = /* @__PURE__ */ new Map();
var agentTaskWatchers = /* @__PURE__ */ new Map();
async function resolveZeroClawExecutable() {
  const appRoot = import_electron.app.getAppPath();
  const candidates = [
    import_node_path6.default.join(appRoot, "..", "zeroclaw", "zeroclaw.exe"),
    import_node_path6.default.join(appRoot, "zeroclaw", "zeroclaw.exe"),
    import_node_path6.default.join(process.cwd(), "..", "zeroclaw", "zeroclaw.exe"),
    import_node_path6.default.join(process.resourcesPath ?? "", "zeroclaw", "zeroclaw.exe")
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
    const info = await (0, import_promises6.stat)(targetPath);
    return info.isFile();
  } catch {
    return false;
  }
}
async function ensureDirectory2(dirPath) {
  await (0, import_promises6.mkdir)(dirPath, { recursive: true });
}
function stripFrontmatter(content) {
  const match = content.match(/^---\s*[\s\S]*?\s*---\s*/);
  if (!match) return content.trim();
  return content.slice(match[0].length).trim();
}
function resolveAppRoot() {
  const __filename2 = (0, import_node_url.fileURLToPath)(import_meta_url);
  const __dirname2 = import_node_path6.default.dirname(__filename2);
  return import_node_path6.default.resolve(__dirname2, "..", "..");
}
async function loadGlobalSystemPrompt() {
  const promptPath = import_node_path6.default.join(resolveAppRoot(), GLOBAL_SYSTEM_PROMPT_FILE);
  try {
    const content = await (0, import_promises6.readFile)(promptPath, "utf-8");
    const normalized = stripFrontmatter(content).trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
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
  const logDir = import_node_path6.default.join(workspace.privateLogsRoot, ZEROCLAW_LOG_DIR);
  await ensureDirectory2(logDir);
  const logPath = import_node_path6.default.join(logDir, toLogFileName());
  const stream = (0, import_node_fs.createWriteStream)(logPath, { flags: "a" });
  return { logPath, stream };
}
async function readMcpServersFromFile(filePath) {
  try {
    const raw = await (0, import_promises6.readFile)(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === "object" && item !== null);
    }
    return [];
  } catch {
    return [];
  }
}
function normalizeGatewayHashInput(agentId) {
  return agentId.trim().toLowerCase();
}
function hashAgentId(agentId) {
  const normalized = normalizeGatewayHashInput(agentId);
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) % Number.MAX_SAFE_INTEGER;
  }
  return Math.abs(hash);
}
function resolveAgentGatewayPort(agentId) {
  const hash = hashAgentId(agentId);
  return ZEROCLAW_GATEWAY_PORT_BASE + hash % ZEROCLAW_GATEWAY_PORT_SPAN;
}
function resolveGatewayEndpointForAgent(agentId) {
  const port = resolveAgentGatewayPort(agentId);
  return {
    host: ZEROCLAW_GATEWAY_HOST,
    port,
    baseUrl: `http://${ZEROCLAW_GATEWAY_HOST}:${port}`
  };
}
function resolveAgentGatewayBaseUrl(agentId) {
  return resolveGatewayEndpointForAgent(agentId).baseUrl;
}
function getAgentRuntimeGatewayBaseUrl(agentId) {
  const entry = agentProcesses.get(agentId);
  if (entry?.gateway) {
    return entry.gateway.baseUrl;
  }
  return resolveAgentGatewayBaseUrl(agentId);
}
async function isPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = import_node_net.default.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}
function escapeTomlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
function renderTomlString(value) {
  return `"${escapeTomlString(value)}"`;
}
function renderTomlStringArray(values) {
  const normalized = values.filter((value) => value.trim().length > 0);
  return `[${normalized.map((value) => renderTomlString(value)).join(", ")}]`;
}
function sanitizeTomlSectionName(raw) {
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : "member";
}
function normalizeMcpTransport(type) {
  const normalized = type.trim().toLowerCase();
  if (normalized === "sse") return "sse";
  if (normalized === "streamablehttp" || normalized === "http") return "http";
  return "stdio";
}
function sanitizeMcpServerName(raw) {
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : "mcp_server";
}
function toStringMap(input) {
  if (!input) return {};
  const entries = Object.entries(input).filter(
    ([key, value]) => key.trim().length > 0 && value.trim().length > 0
  );
  return Object.fromEntries(entries);
}
function mapMcpServerToZeroClaw(server) {
  const transport = normalizeMcpTransport(server.type ?? "stdio");
  const name = sanitizeMcpServerName(server.id || server.name);
  const rawTimeout = typeof server.timeout === "number" && Number.isFinite(server.timeout) && server.timeout > 0 ? server.timeout : void 0;
  const timeout = rawTimeout === void 0 ? void 0 : Math.max(1, Math.min(600, Math.ceil(rawTimeout > 1e3 ? rawTimeout / 1e3 : rawTimeout)));
  if (transport === "stdio") {
    const command = (server.command ?? server.path ?? "").trim();
    if (!command) return null;
    return {
      name,
      transport,
      command,
      args: (server.args ?? []).filter((item) => item.trim().length > 0),
      env: toStringMap(server.env),
      headers: {},
      toolTimeoutSecs: timeout
    };
  }
  const url = (server.url ?? "").trim();
  if (!url) return null;
  return {
    name,
    transport,
    url,
    args: [],
    env: {},
    headers: toStringMap(server.headers),
    toolTimeoutSecs: timeout
  };
}
function resolveMemberAllowedTools(member, mcpServerNames) {
  const enabled = new Set((member.allowedTools ?? []).map((item) => item.trim()).filter(Boolean));
  const toolPermissions = member.toolPermissions ?? [];
  if (enabled.size === 0 && toolPermissions.length > 0) {
    toolPermissions.filter((item) => item.enabled).forEach((item) => {
      if (item.id.trim()) enabled.add(item.id.trim());
    });
  }
  const mapped = /* @__PURE__ */ new Set();
  for (const key of enabled) {
    const tools = TEAM_TOOL_TO_ZEROCLAW_TOOLS[key];
    if (tools) {
      tools.forEach((tool) => mapped.add(tool));
    }
  }
  const allowMcp = enabled.has("mcp_tools");
  if (allowMcp) {
    for (const name of mcpServerNames) {
      mapped.add(name);
    }
  }
  return Array.from(mapped.values());
}
function ensureUniqueFolderName(baseName, used) {
  const normalized = baseName.trim().replace(/[\\/:*?"<>|]/g, "_") || "skill";
  if (!used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }
  let index = 2;
  while (true) {
    const candidate = `${normalized}_${index}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    index += 1;
  }
}
function normalizeResourceSelectionId(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(?:app|shared|global|agent):(.+)$/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return trimmed;
}
async function materializeWorkspaceSkills(profile, workspaceRoot, homeDirOverride) {
  const sharedWorkspace = await ensureSharedWorkspace(homeDirOverride);
  const targetSkillsRoot = import_node_path6.default.join(workspaceRoot, "skills");
  await (0, import_promises6.rm)(targetSkillsRoot, { recursive: true, force: true });
  await ensureDirectory2(targetSkillsRoot);
  const usedNames = /* @__PURE__ */ new Set();
  const enabledSkillSet = new Set(
    (profile.skills.privateSkills ?? []).map((item) => normalizeResourceSelectionId(item)).filter(Boolean)
  );
  if (enabledSkillSet.size === 0) {
    return;
  }
  try {
    const globalEntries = await (0, import_promises6.readdir)(sharedWorkspace.sharedSkillsRoot, { withFileTypes: true });
    for (const entry of globalEntries) {
      if (!entry.isDirectory()) continue;
      if (!enabledSkillSet.has(entry.name)) continue;
      const source = import_node_path6.default.join(sharedWorkspace.sharedSkillsRoot, entry.name);
      const targetName = ensureUniqueFolderName(entry.name, usedNames);
      await (0, import_promises6.cp)(source, import_node_path6.default.join(targetSkillsRoot, targetName), { recursive: true });
    }
  } catch {
  }
}
async function collectActiveMcpServers(profile, homeDirOverride) {
  const sharedWorkspace = await ensureSharedWorkspace(homeDirOverride);
  const globalServers = await readMcpServersFromFile(import_node_path6.default.join(sharedWorkspace.sharedMcpRoot, "servers.json"));
  const privateIds = new Set(
    (profile.mcp.privateServers ?? []).map((item) => normalizeResourceSelectionId(item)).filter(Boolean)
  );
  if (privateIds.size === 0) {
    return [];
  }
  const merged = globalServers.filter(
    (server) => server.enabled !== false && privateIds.has(server.id)
  );
  const result = [];
  const usedNames = /* @__PURE__ */ new Set();
  for (const server of merged) {
    const mapped = mapMcpServerToZeroClaw(server);
    if (!mapped) continue;
    if (usedNames.has(mapped.name)) continue;
    usedNames.add(mapped.name);
    result.push(mapped);
  }
  return result;
}
function parseTomlArray(raw) {
  const match = raw.match(/\[(.*)\]/);
  if (!match?.[1]) return [];
  return match[1].split(",").map((item) => item.trim()).filter(Boolean).map((item) => item.replace(/^"(.*)"$/, "$1").trim()).filter(Boolean);
}
async function resolveRuntimeWebSearchConfig(configDir) {
  const configPath = import_node_path6.default.join(configDir, "config.toml");
  let currentEnabled;
  let currentProvider;
  let currentApiKey;
  let currentFallbackProviders;
  let currentMaxResults;
  let currentTimeoutSecs;
  try {
    const raw = await (0, import_promises6.readFile)(configPath, "utf-8");
    const lines = raw.split(/\r?\n/);
    let inWebSearch = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (/^\[\[.*\]\]$/.test(trimmed) || /^\[.*\]$/.test(trimmed)) {
        inWebSearch = trimmed === "[web_search]";
        continue;
      }
      if (!inWebSearch) continue;
      const enabledMatch = trimmed.match(/^enabled\s*=\s*(true|false)$/i);
      if (enabledMatch) {
        currentEnabled = enabledMatch[1].toLowerCase() === "true";
        continue;
      }
      const providerMatch = trimmed.match(/^provider\s*=\s*"([^"]+)"$/);
      if (providerMatch?.[1]) {
        currentProvider = providerMatch[1].trim();
        continue;
      }
      const apiKeyMatch = trimmed.match(/^api_key\s*=\s*"([^"]*)"$/);
      if (apiKeyMatch && apiKeyMatch[1].trim()) {
        currentApiKey = apiKeyMatch[1].trim();
        continue;
      }
      const fallbackMatch = trimmed.match(/^fallback_providers\s*=\s*\[.*\]$/);
      if (fallbackMatch) {
        currentFallbackProviders = parseTomlArray(trimmed);
        continue;
      }
      const maxResultsMatch = trimmed.match(/^max_results\s*=\s*(\d+)$/);
      if (maxResultsMatch?.[1]) {
        currentMaxResults = Number(maxResultsMatch[1]);
        continue;
      }
      const timeoutMatch = trimmed.match(/^timeout_secs\s*=\s*(\d+)$/);
      if (timeoutMatch?.[1]) {
        currentTimeoutSecs = Number(timeoutMatch[1]);
      }
    }
  } catch {
  }
  const envApiKey = process.env.WEBOT_WEB_SEARCH_API_KEY?.trim() || process.env.ZEROCLAW_WEB_SEARCH_API_KEY?.trim() || process.env.TAVILY_API_KEY?.trim() || "";
  const apiKey = envApiKey || currentApiKey || void 0;
  const provider = (currentProvider || (apiKey ? DEFAULT_WEB_SEARCH_PROVIDER : "duckduckgo")).trim();
  const fallbackProviders = currentFallbackProviders && currentFallbackProviders.length > 0 ? currentFallbackProviders : provider === "duckduckgo" ? [] : ["duckduckgo"];
  const enabled = typeof currentEnabled === "boolean" ? currentEnabled : provider === "duckduckgo" ? true : Boolean(apiKey);
  const maxResults = typeof currentMaxResults === "number" && Number.isFinite(currentMaxResults) && currentMaxResults >= 1 ? Math.min(10, Math.max(1, Math.floor(currentMaxResults))) : DEFAULT_WEB_SEARCH_MAX_RESULTS;
  const timeoutSecs = typeof currentTimeoutSecs === "number" && Number.isFinite(currentTimeoutSecs) && currentTimeoutSecs >= 1 ? Math.min(60, Math.max(1, Math.floor(currentTimeoutSecs))) : DEFAULT_WEB_SEARCH_TIMEOUT_SECS;
  return {
    enabled,
    provider,
    fallbackProviders,
    apiKey,
    maxResults,
    timeoutSecs
  };
}
function renderZeroClawConfigToml(profile, gateway, workspaceRoot, mcpServers, webSearchConfig) {
  const mcpServerNames = mcpServers.map((server) => server.name);
  const lines = [
    "# Auto-generated by weBot. Manual edits may be overwritten.",
    `workspace_dir = ${renderTomlString(workspaceRoot)}`,
    "",
    `default_provider = ${renderTomlString(profile.defaultLlm.providerId)}`,
    `default_model = ${renderTomlString(profile.defaultLlm.modelName)}`,
    "default_temperature = 0.2",
    "",
    "[gateway]",
    `host = ${renderTomlString(gateway.host)}`,
    `port = ${gateway.port}`,
    "require_pairing = false",
    "allow_public_bind = false",
    `request_timeout_secs = ${DEFAULT_GATEWAY_REQUEST_TIMEOUT_SECS}`,
    "",
    "[agent]",
    "compact_context = true",
    "max_tool_iterations = 8",
    "",
    "[autonomy]",
    'level = "supervised"',
    "workspace_only = true",
    `allowed_commands = ${renderTomlStringArray(DEFAULT_AUTONOMY_ALLOWED_COMMANDS)}`,
    `forbidden_paths = ${renderTomlStringArray(DEFAULT_AUTONOMY_FORBIDDEN_PATHS)}`,
    `max_actions_per_hour = ${DEFAULT_AUTONOMY_MAX_ACTIONS_PER_HOUR}`,
    `max_cost_per_day_cents = ${DEFAULT_AUTONOMY_MAX_COST_PER_DAY_CENTS}`,
    "require_approval_for_medium_risk = true",
    "block_high_risk_commands = true",
    "shell_env_passthrough = []",
    "allowed_roots = []",
    `auto_approve = ${renderTomlStringArray(DEFAULT_AUTONOMY_AUTO_APPROVE_TOOLS)}`,
    "always_ask = []",
    "",
    "[scheduler]",
    "enabled = true",
    "max_tasks = 256",
    "max_concurrent = 4",
    "",
    "[cron]",
    "enabled = true",
    "max_run_history = 200",
    "",
    "[reliability]",
    "scheduler_poll_secs = 15",
    "scheduler_retries = 2",
    "",
    "[memory]",
    'backend = "sqlite"',
    "auto_save = true",
    'embedding_provider = "none"',
    "vector_weight = 0.7",
    "keyword_weight = 0.3",
    "",
    "[skills]",
    "open_skills_enabled = false",
    "allow_scripts = false",
    'prompt_injection_mode = "compact"',
    "",
    "[web_search]",
    `enabled = ${webSearchConfig.enabled ? "true" : "false"}`,
    `provider = ${renderTomlString(webSearchConfig.provider)}`,
    ...webSearchConfig.apiKey?.trim() ? [`api_key = ${renderTomlString(webSearchConfig.apiKey.trim())}`] : [],
    `fallback_providers = ${renderTomlStringArray(webSearchConfig.fallbackProviders)}`,
    `max_results = ${webSearchConfig.maxResults}`,
    `timeout_secs = ${webSearchConfig.timeoutSecs}`,
    "",
    "[mcp]",
    `enabled = ${mcpServers.length > 0 ? "true" : "false"}`
  ];
  for (const server of mcpServers) {
    lines.push("");
    lines.push("[[mcp.servers]]");
    lines.push(`name = ${renderTomlString(server.name)}`);
    lines.push(`transport = ${renderTomlString(server.transport)}`);
    if (server.transport === "stdio") {
      lines.push(`command = ${renderTomlString(server.command ?? "")}`);
      lines.push(`args = ${renderTomlStringArray(server.args)}`);
      if (server.toolTimeoutSecs) {
        lines.push(`tool_timeout_secs = ${server.toolTimeoutSecs}`);
      }
      if (Object.keys(server.env).length > 0) {
        lines.push("[mcp.servers.env]");
        for (const [key, value] of Object.entries(server.env)) {
          lines.push(`${renderTomlString(key)} = ${renderTomlString(value)}`);
        }
      }
    } else {
      lines.push(`url = ${renderTomlString(server.url ?? "")}`);
      if (server.toolTimeoutSecs) {
        lines.push(`tool_timeout_secs = ${server.toolTimeoutSecs}`);
      }
      if (Object.keys(server.headers).length > 0) {
        lines.push("[mcp.servers.headers]");
        for (const [key, value] of Object.entries(server.headers)) {
          lines.push(`${renderTomlString(key)} = ${renderTomlString(value)}`);
        }
      }
    }
  }
  const members = profile.team?.members ?? [];
  const usedMemberSectionNames = /* @__PURE__ */ new Set();
  for (const member of members) {
    const baseName = sanitizeTomlSectionName(member.id || member.name);
    let sectionName = baseName;
    let suffix = 2;
    while (usedMemberSectionNames.has(sectionName)) {
      sectionName = `${baseName}_${suffix}`;
      suffix += 1;
    }
    usedMemberSectionNames.add(sectionName);
    const allowedTools = resolveMemberAllowedTools(member, mcpServerNames);
    lines.push("");
    lines.push(`[agents.${sectionName}]`);
    lines.push(`provider = ${renderTomlString(member.providerId)}`);
    lines.push(`model = ${renderTomlString(member.modelName)}`);
    lines.push(`system_prompt = ${renderTomlString(member.systemPrompt || `\u4F60\u662F\u56E2\u961F\u6210\u5458 ${member.name}\u3002`)}`);
    lines.push("agentic = true");
    if (allowedTools.length > 0) {
      lines.push(`allowed_tools = ${renderTomlStringArray(allowedTools)}`);
    }
    lines.push("max_iterations = 6");
  }
  return `${lines.join("\n")}
`;
}
async function writeWorkspaceIdentityPrompt(profile, workspaceRoot) {
  const globalSystemPrompt = await loadGlobalSystemPrompt();
  const promptLines = [];
  if (globalSystemPrompt?.trim()) {
    promptLines.push(globalSystemPrompt.trim(), "");
  }
  promptLines.push(
    "# \u89D2\u8272\u7CFB\u7EDF\u63D0\u793A\u8BCD",
    profile.systemPrompt.trim() || "\uFF08\u7A7A\uFF09",
    "",
    "# \u89D2\u8272\u6458\u8981",
    profile.summary?.trim() || "\uFF08\u7A7A\uFF09",
    "",
    "# \u89D2\u8272\u7075\u9B42",
    profile.soul?.trim() || "\uFF08\u7A7A\uFF09"
  );
  const promptPath = import_node_path6.default.join(workspaceRoot, "AGENTS.md");
  await (0, import_promises6.writeFile)(promptPath, promptLines.join("\n"), "utf-8");
}
async function prepareZeroClawRuntimeFiles(profile, configDir, gateway, mcpServers, homeDirOverride) {
  const workspaceRoot = import_node_path6.default.join(configDir, "workspace");
  await ensureDirectory2(workspaceRoot);
  await ensureDirectory2(import_node_path6.default.join(workspaceRoot, "state"));
  await materializeWorkspaceSkills(profile, workspaceRoot, homeDirOverride);
  await writeWorkspaceIdentityPrompt(profile, workspaceRoot);
  const webSearchConfig = await resolveRuntimeWebSearchConfig(configDir);
  const configToml = renderZeroClawConfigToml(
    profile,
    gateway,
    workspaceRoot,
    mcpServers,
    webSearchConfig
  );
  await (0, import_promises6.writeFile)(import_node_path6.default.join(configDir, "config.toml"), configToml, "utf-8");
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
  const configDir = import_node_path6.default.join(workspace.agentRoot, "zeroclaw");
  await ensureDirectory2(configDir);
  return configDir;
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
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForGatewayReady(gateway, timeoutMs = GATEWAY_READY_TIMEOUT_MS) {
  const healthUrl = `${gateway.baseUrl}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const requestTimer = setTimeout(() => controller.abort(), 3e3);
    try {
      const response = await fetch(healthUrl, { method: "GET", signal: controller.signal });
      if (response.ok) {
        clearTimeout(requestTimer);
        return true;
      }
    } catch {
    } finally {
      clearTimeout(requestTimer);
    }
    await sleep(GATEWAY_READY_POLL_INTERVAL_MS);
  }
  return false;
}
async function listGatewayCronJobs(gatewayBaseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TASK_SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(`${gatewayBaseUrl.replace(/\/+$/, "")}/api/cron`, {
      method: "GET",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`cron \u5217\u8868\u8BF7\u6C42\u5931\u8D25 (${response.status})`);
    }
    const payload = await response.json();
    return Array.isArray(payload.jobs) ? payload.jobs : [];
  } finally {
    clearTimeout(timer);
  }
}
function toTaskSnapshotToken(job) {
  return [
    String(job.enabled),
    job.next_run || "",
    job.last_run || "",
    job.last_status || "",
    resolveCronJobOutput(job) || ""
  ].join("|");
}
function resolveCronJobOutput(job) {
  const candidates = [
    job.last_output,
    job.output,
    job.last_result,
    job.result,
    job.last_message,
    job.message
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}
function normalizeCronRunOutput(raw) {
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.slice(0, 1200);
}
function sanitizeScheduledAgentPrompt(rawPrompt, taskName) {
  const normalized = (rawPrompt ?? "").replace(/\s+/g, " ").trim();
  let business = normalized.replace(/^只做业务执行[:：]?\s*/i, "").replace(TASK_AGENT_FORBIDDEN_PROMPT_PATTERN, "").replace(TASK_AGENT_NOISE_PATTERN, "").replace(/\s+/g, " ").trim();
  if (!business) {
    business = taskName?.trim() ? `\u6309\u4EFB\u52A1\u76EE\u6807\u6267\u884C\uFF1A${taskName.trim()}` : "\u6267\u884C\u4EFB\u52A1\u5E76\u8FD4\u56DE\u7B80\u8981\u4E1A\u52A1\u7ED3\u679C\u3002";
  }
  if (business.length > TASK_AGENT_PROMPT_MAX_LENGTH) {
    business = business.slice(0, TASK_AGENT_PROMPT_MAX_LENGTH).trim();
  }
  return [
    `\u53EA\u505A\u4E1A\u52A1\u6267\u884C\uFF1A${business}`,
    "\u6267\u884C\u7EA6\u675F\uFF1A\u4F18\u5148\u4F7F\u7528 web_search_tool\uFF08\u82E5\u53EF\u7528\uFF09\u6216\u5DF2\u6388\u6743\u68C0\u7D22\u5DE5\u5177\uFF1B\u7981\u6B62\u8C03\u7528 cron_add/cron_update/cron_remove/cron_run/cron_list\uFF1B\u7981\u6B62\u8C03\u7528 web_search_config/web_access_config/model_routing_config\uFF1B\u7981\u6B62\u4F7F\u7528 curl/wget\uFF1B\u4EC5\u8F93\u51FA\u4E1A\u52A1\u7ED3\u679C\u6216\u5931\u8D25\u539F\u56E0\u3002"
  ].join("\n");
}
async function sanitizeCronAgentJobPrompt(agentId, jobId, homeDirOverride) {
  try {
    const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
    const dbPath = import_node_path6.default.join(workspace.agentRoot, "zeroclaw", "workspace", "cron", "jobs.db");
    if (!await fileExists(dbPath)) {
      return false;
    }
    const db = new import_node_sqlite.DatabaseSync(dbPath);
    try {
      const row = db.prepare("SELECT job_type, prompt, name, model, session_target FROM cron_jobs WHERE id = ? LIMIT 1").get(jobId);
      if (!row || (row.job_type || "").toLowerCase() !== "agent") {
        return false;
      }
      const nextPrompt = sanitizeScheduledAgentPrompt(row.prompt, row.name);
      const currentPrompt = (row.prompt ?? "").trim();
      const normalizedModel = (() => {
        const raw = (row.model ?? "").trim();
        if (!raw) return null;
        if (raw.includes("/")) return raw;
        if (/^qwen\d/i.test(raw)) return `qwen/${raw}`;
        return null;
      })();
      const currentSessionTarget = (row.session_target ?? "").trim().toLowerCase();
      const nextSessionTarget = currentSessionTarget === "isolated" ? "isolated" : "isolated";
      const shouldUpdatePrompt = nextPrompt !== currentPrompt;
      const shouldUpdateModel = normalizedModel !== null && normalizedModel !== (row.model ?? "").trim();
      const shouldUpdateTarget = nextSessionTarget !== currentSessionTarget;
      if (!shouldUpdatePrompt && !shouldUpdateModel && !shouldUpdateTarget) {
        return false;
      }
      db.prepare(
        "UPDATE cron_jobs SET prompt = ?, model = COALESCE(?, model), session_target = ? WHERE id = ?"
      ).run(nextPrompt, normalizedModel, nextSessionTarget, jobId);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}
async function resolveLatestCronRunOutput(agentId, jobId, homeDirOverride) {
  try {
    const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
    const dbPath = import_node_path6.default.join(workspace.agentRoot, "zeroclaw", "workspace", "cron", "jobs.db");
    const exists = await fileExists(dbPath);
    if (!exists) {
      return null;
    }
    const db = new import_node_sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const stmt = db.prepare(
        "SELECT output FROM cron_runs WHERE job_id = ? ORDER BY id DESC LIMIT 1"
      );
      const row = stmt.get(jobId);
      return normalizeCronRunOutput(row?.output);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
async function resolveCronRunCount(agentId, jobId, homeDirOverride) {
  try {
    const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
    const dbPath = import_node_path6.default.join(workspace.agentRoot, "zeroclaw", "workspace", "cron", "jobs.db");
    const exists = await fileExists(dbPath);
    if (!exists) {
      return null;
    }
    const db = new import_node_sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const stmt = db.prepare(
        "SELECT COUNT(*) AS count FROM cron_runs WHERE job_id = ?"
      );
      const row = stmt.get(jobId);
      return Number.isFinite(Number(row?.count)) ? Number(row?.count) : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
async function appendTaskRuntimeEvent(agentId, taskId, message, meta, homeDirOverride) {
  await appendAgentCollaborationEvent(
    agentId,
    `cron_${taskId}`,
    {
      kind: "runtime_log",
      message,
      meta: {
        source: "scheduled_task",
        taskId,
        ...meta
      }
    },
    homeDirOverride
  );
}
async function syncAgentScheduledTaskEvents(agentId, watcher) {
  const jobs = await listGatewayCronJobs(watcher.gatewayBaseUrl);
  const nextSnapshot = /* @__PURE__ */ new Map();
  for (const job of jobs) {
    nextSnapshot.set(job.id, toTaskSnapshotToken(job));
  }
  if (watcher.snapshot.size === 0) {
    watcher.snapshot = nextSnapshot;
    return;
  }
  for (const job of jobs) {
    const currentToken = toTaskSnapshotToken(job);
    const previousToken = watcher.snapshot.get(job.id);
    if (!previousToken) {
      const promptSanitized = await sanitizeCronAgentJobPrompt(
        agentId,
        job.id,
        watcher.homeDirOverride
      );
      await appendTaskRuntimeEvent(
        agentId,
        job.id,
        promptSanitized ? `\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u6CE8\u518C\uFF1A${job.name || job.id}\uFF0C\u4E0B\u6B21\u6267\u884C ${job.next_run || "\u672A\u77E5"}\uFF08\u5DF2\u5E94\u7528\u6267\u884C\u7EA6\u675F\uFF09` : `\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u6CE8\u518C\uFF1A${job.name || job.id}\uFF0C\u4E0B\u6B21\u6267\u884C ${job.next_run || "\u672A\u77E5"}`,
        { action: "created", taskName: job.name || void 0, nextRun: job.next_run || void 0 },
        watcher.homeDirOverride
      );
      continue;
    }
    if (currentToken === previousToken) {
      continue;
    }
    const [prevEnabled, prevNextRun, prevLastRun, prevLastStatus] = previousToken.split("|");
    const enabledChanged = String(job.enabled) !== prevEnabled;
    const runChanged = (job.last_run || "") !== prevLastRun || (job.last_status || "") !== prevLastStatus;
    const nextChanged = (job.next_run || "") !== prevNextRun;
    if (runChanged && job.last_run) {
      const status = (job.last_status || "").toLowerCase();
      const statusLabel = status === "ok" || status === "success" ? "\u6210\u529F" : status ? `\u72B6\u6001 ${job.last_status}` : "\u5DF2\u6267\u884C";
      let resultOutput = resolveCronJobOutput(job);
      if (!resultOutput) {
        resultOutput = await resolveLatestCronRunOutput(agentId, job.id, watcher.homeDirOverride);
      }
      const runCount = await resolveCronRunCount(agentId, job.id, watcher.homeDirOverride);
      if (resultOutput && /(?:curl|wget|web_search_config|web_access_config|model_routing_config)/i.test(resultOutput)) {
        await sanitizeCronAgentJobPrompt(agentId, job.id, watcher.homeDirOverride);
      }
      await appendTaskRuntimeEvent(
        agentId,
        job.id,
        resultOutput ? `\u5B9A\u65F6\u4EFB\u52A1\u6267\u884C\uFF1A${job.name || job.id}\uFF0C${statusLabel}\uFF0C\u6267\u884C\u65F6\u95F4 ${job.last_run}\uFF0C\u7ED3\u679C\uFF1A${resultOutput}` : `\u5B9A\u65F6\u4EFB\u52A1\u6267\u884C\uFF1A${job.name || job.id}\uFF0C${statusLabel}\uFF0C\u6267\u884C\u65F6\u95F4 ${job.last_run}`,
        {
          action: "ran",
          taskName: job.name || void 0,
          lastRun: job.last_run,
          lastStatus: job.last_status || void 0,
          nextRun: job.next_run || void 0,
          resultOutput: resultOutput || void 0,
          runCount: runCount ?? void 0
        },
        watcher.homeDirOverride
      );
    } else if (enabledChanged) {
      await appendTaskRuntimeEvent(
        agentId,
        job.id,
        `\u5B9A\u65F6\u4EFB\u52A1${job.enabled ? "\u5DF2\u542F\u7528" : "\u5DF2\u6682\u505C"}\uFF1A${job.name || job.id}`,
        { action: job.enabled ? "enabled" : "paused", taskName: job.name || void 0 },
        watcher.homeDirOverride
      );
    } else if (nextChanged) {
      await appendTaskRuntimeEvent(
        agentId,
        job.id,
        `\u5B9A\u65F6\u4EFB\u52A1\u8BA1\u5212\u5DF2\u66F4\u65B0\uFF1A${job.name || job.id}\uFF0C\u4E0B\u6B21\u6267\u884C ${job.next_run || "\u672A\u77E5"}`,
        {
          action: "rescheduled",
          taskName: job.name || void 0,
          nextRun: job.next_run || void 0
        },
        watcher.homeDirOverride
      );
    }
  }
  for (const [taskId] of watcher.snapshot.entries()) {
    if (!nextSnapshot.has(taskId)) {
      await appendTaskRuntimeEvent(
        agentId,
        taskId,
        `\u5B9A\u65F6\u4EFB\u52A1\u5DF2\u5220\u9664\uFF1A${taskId}`,
        { action: "deleted" },
        watcher.homeDirOverride
      );
    }
  }
  watcher.snapshot = nextSnapshot;
}
function stopAgentTaskWatcher(agentId) {
  const watcher = agentTaskWatchers.get(agentId);
  if (!watcher) return;
  clearInterval(watcher.timer);
  agentTaskWatchers.delete(agentId);
}
function startAgentTaskWatcher(agentId, gateway, homeDirOverride) {
  stopAgentTaskWatcher(agentId);
  const watcher = {
    timer: setInterval(() => {
      syncAgentScheduledTaskEvents(agentId, watcher).catch((error) => {
        console.error("[AgentRuntime] \u4EFB\u52A1\u540C\u6B65\u5931\u8D25:", error);
      });
    }, TASK_SYNC_INTERVAL_MS),
    snapshot: /* @__PURE__ */ new Map(),
    gatewayBaseUrl: gateway.baseUrl,
    homeDirOverride
  };
  agentTaskWatchers.set(agentId, watcher);
  syncAgentScheduledTaskEvents(agentId, watcher).catch((error) => {
    console.error("[AgentRuntime] \u521D\u6B21\u4EFB\u52A1\u540C\u6B65\u5931\u8D25:", error);
  });
}
function getAgentRuntimeStatus(agentId) {
  const entry = agentProcesses.get(agentId);
  if (!entry) {
    return { agentId, status: "offline" };
  }
  const gatewayTip = entry.gateway ? `\u7F51\u5173\uFF1A${entry.gateway.baseUrl}` : void 0;
  const mergedMessage = entry.message ?? gatewayTip;
  return {
    agentId,
    status: entry.status,
    pid: entry.pid,
    startedAt: entry.startedAt,
    message: mergedMessage,
    lastOutputAt: entry.lastOutputAt,
    logPath: entry.logPath
  };
}
async function startAgentRuntime(input) {
  const existing = agentProcesses.get(input.agentId);
  if (existing && (existing.status === "starting" || existing.status === "online")) {
    return { success: false, message: "\u667A\u80FD\u4F53\u5DF2\u5728\u8FD0\u884C\u4E2D\u3002", pid: existing.pid };
  }
  stopAgentTaskWatcher(input.agentId);
  const profile = await getAgentProfile(input);
  const { executablePath, tried } = await resolveZeroClawExecutable();
  if (!executablePath) {
    return {
      success: false,
      message: `\u672A\u627E\u5230 ZeroClaw \u5F15\u64CE\uFF0C\u8BF7\u68C0\u67E5\u5B89\u88C5\u8DEF\u5F84\u3002\u5DF2\u5C1D\u8BD5\uFF1A${tried.join(" ; ")}`
    };
  }
  const { apiKey, apiBase } = await resolveProviderSecrets(profile.defaultLlm.providerId, input.homeDirOverride);
  const configDir = await ensureZeroClawConfigDir(profile.agentId, input.homeDirOverride);
  const gateway = resolveGatewayEndpointForAgent(profile.agentId);
  const contextPath = import_node_path6.default.join(configDir, "workspace", ZEROCLAW_WORKSPACE_PROMPT_FILE);
  const activeMcpServers = await collectActiveMcpServers(profile, input.homeDirOverride);
  const portAvailable = await isPortAvailable(gateway.host, gateway.port);
  if (!portAvailable) {
    return {
      success: false,
      message: `\u7F51\u5173\u7AEF\u53E3\u88AB\u5360\u7528\uFF1A${gateway.host}:${gateway.port}\uFF0C\u8BF7\u5148\u91CA\u653E\u7AEF\u53E3\u540E\u91CD\u8BD5\u3002`,
      contextPath
    };
  }
  const launchRuntimeAttempt = async (mcpServers, fallbackMcpDisabled = false) => {
    await prepareZeroClawRuntimeFiles(profile, configDir, gateway, mcpServers, input.homeDirOverride);
    const { logPath, stream } = await createZeroClawLogStream(profile.agentId, input.homeDirOverride);
    const args = [
      "--config-dir",
      configDir,
      "daemon",
      "--host",
      gateway.host,
      "--port",
      String(gateway.port)
    ];
    const env = {
      ...process.env,
      ZEROCLAW_API_KEY: apiKey ?? "",
      API_KEY: apiKey ?? "",
      ZEROCLAW_API_URL: apiBase ?? "",
      API_URL: apiBase ?? ""
    };
    const child = (0, import_node_child_process.spawn)(executablePath, args, { env, stdio: "pipe" });
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
      lastOutputAt: (/* @__PURE__ */ new Date()).toISOString(),
      gateway,
      message: `\u5B88\u62A4\u8FDB\u7A0B\u542F\u52A8\u4E2D\uFF1A${gateway.baseUrl}`
    });
    child.once("exit", (code) => {
      const entry = agentProcesses.get(profile.agentId);
      if (!entry || entry.process !== child) {
        stream.end();
        return;
      }
      stopAgentTaskWatcher(profile.agentId);
      const message = code === 0 ? "\u5DF2\u505C\u6B62" : `\u5F02\u5E38\u9000\u51FA (code ${code ?? "unknown"})`;
      updateStatus(profile.agentId, {
        status: code === 0 ? "offline" : "error",
        message: logPath ? `${message}\uFF0C\u65E5\u5FD7\uFF1A${logPath}` : message,
        logPath,
        lastOutputAt: entry.lastOutputAt,
        gateway: entry.gateway
      });
      stream.end();
    });
    child.once("error", (error) => {
      const entry = agentProcesses.get(profile.agentId);
      if (!entry || entry.process !== child) {
        stream.end();
        return;
      }
      stopAgentTaskWatcher(profile.agentId);
      updateStatus(profile.agentId, {
        status: "error",
        message: logPath ? `${error.message}\uFF0C\u65E5\u5FD7\uFF1A${logPath}` : error.message,
        logPath,
        gateway
      });
      stream.end();
    });
    const gatewayReady = await waitForGatewayReady(gateway);
    const current = agentProcesses.get(profile.agentId);
    if (!gatewayReady) {
      child.kill();
      const message = `ZeroClaw \u7F51\u5173\u5065\u5EB7\u68C0\u67E5\u8D85\u65F6\uFF1A${gateway.baseUrl}/health`;
      if (current?.process === child) {
        updateStatus(profile.agentId, {
          status: "error",
          message: logPath ? `${message}\uFF0C\u65E5\u5FD7\uFF1A${logPath}` : message,
          logPath,
          lastOutputAt: current.lastOutputAt,
          gateway
        });
      }
      return {
        success: false,
        message,
        logPath,
        contextPath,
        timedOut: true
      };
    }
    if (current && current.process !== child) {
      stream.end();
      return {
        success: false,
        message: "\u542F\u52A8\u72B6\u6001\u5DF2\u5207\u6362\uFF0C\u8BF7\u91CD\u8BD5\u3002",
        logPath,
        contextPath
      };
    }
    if (current && (current.status === "offline" || current.status === "error")) {
      return {
        success: false,
        message: current.message ?? "\u542F\u52A8\u5931\u8D25",
        logPath,
        contextPath
      };
    }
    if (current) {
      updateStatus(profile.agentId, {
        ...current,
        status: "online",
        message: fallbackMcpDisabled ? `\u5B88\u62A4\u8FDB\u7A0B\u5DF2\u5C31\u7EEA\uFF08MCP \u5DF2\u4E34\u65F6\u7981\u7528\uFF09\uFF1A${current.gateway?.baseUrl ?? gateway.baseUrl}` : current.gateway ? `\u5B88\u62A4\u8FDB\u7A0B\u5DF2\u5C31\u7EEA\uFF1A${current.gateway.baseUrl}` : "\u5B88\u62A4\u8FDB\u7A0B\u5DF2\u5C31\u7EEA"
      });
    }
    startAgentTaskWatcher(profile.agentId, gateway, input.homeDirOverride);
    return {
      success: true,
      pid: child.pid,
      contextPath,
      logPath,
      message: fallbackMcpDisabled ? `ZeroClaw \u5B88\u62A4\u8FDB\u7A0B\u5DF2\u542F\u52A8\uFF08MCP \u5DF2\u4E34\u65F6\u7981\u7528\uFF09\uFF1A${gateway.baseUrl}` : `ZeroClaw \u5B88\u62A4\u8FDB\u7A0B\u5DF2\u542F\u52A8\uFF1A${gateway.baseUrl}`
    };
  };
  const firstAttempt = await launchRuntimeAttempt(activeMcpServers, false);
  if (firstAttempt.success) {
    return firstAttempt;
  }
  if (!firstAttempt.timedOut || activeMcpServers.length === 0) {
    return firstAttempt;
  }
  const retryAttempt = await launchRuntimeAttempt([], true);
  if (retryAttempt.success) {
    return retryAttempt;
  }
  return {
    success: false,
    message: `${firstAttempt.message ?? "\u542F\u52A8\u5931\u8D25"}\uFF1B\u5DF2\u81EA\u52A8\u7981\u7528 MCP \u91CD\u8BD5\uFF0C\u4F46\u4ECD\u5931\u8D25\uFF1A${retryAttempt.message ?? "\u672A\u77E5\u9519\u8BEF"}`,
    contextPath,
    logPath: retryAttempt.logPath ?? firstAttempt.logPath
  };
}
async function stopAgentRuntime(input) {
  const entry = agentProcesses.get(input.agentId);
  if (!entry || !entry.process) {
    return { success: false, message: "\u667A\u80FD\u4F53\u672A\u5728\u8FD0\u884C\u4E2D\u3002" };
  }
  stopAgentTaskWatcher(input.agentId);
  entry.process.kill();
  updateStatus(input.agentId, { status: "offline", message: "\u5DF2\u505C\u6B62", logPath: entry.logPath });
  return { success: true };
}
function stopAllAgentRuntimes() {
  for (const [agentId, entry] of agentProcesses.entries()) {
    stopAgentTaskWatcher(agentId);
    if (entry.process) {
      entry.process.kill();
    }
    updateStatus(agentId, { status: "offline", message: "\u5DF2\u505C\u6B62" });
  }
}
async function readLatestLogTail(agentId, homeDirOverride, linesCount = 80) {
  const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
  const logDir = import_node_path6.default.join(workspace.privateLogsRoot, ZEROCLAW_LOG_DIR);
  let logPath = agentProcesses.get(agentId)?.logPath;
  if (!logPath || !await fileExists(logPath)) {
    try {
      const entries = await (0, import_promises6.readdir)(logDir, { withFileTypes: true });
      const logs = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".log")).map((entry) => entry.name).sort();
      const latest = logs.at(-1);
      logPath = latest ? import_node_path6.default.join(logDir, latest) : void 0;
    } catch {
      logPath = void 0;
    }
  }
  if (!logPath) {
    return { agentId, content: "\u6682\u65E0\u8FD0\u884C\u65E5\u5FD7\u3002" };
  }
  try {
    const content = await (0, import_promises6.readFile)(logPath, "utf-8");
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

// node_modules/@json-render/core/dist/chunk-AFLK3Q4T.mjs
var import_zod = require("zod");
var DynamicValueSchema = import_zod.z.union([
  import_zod.z.string(),
  import_zod.z.number(),
  import_zod.z.boolean(),
  import_zod.z.null(),
  import_zod.z.object({ $state: import_zod.z.string() })
]);
var DynamicStringSchema = import_zod.z.union([
  import_zod.z.string(),
  import_zod.z.object({ $state: import_zod.z.string() })
]);
var DynamicNumberSchema = import_zod.z.union([
  import_zod.z.number(),
  import_zod.z.object({ $state: import_zod.z.string() })
]);
var DynamicBooleanSchema = import_zod.z.union([
  import_zod.z.boolean(),
  import_zod.z.object({ $state: import_zod.z.string() })
]);
function unescapeJsonPointer(token) {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}
function parseJsonPointer(path13) {
  const raw = path13.startsWith("/") ? path13.slice(1).split("/") : path13.split("/");
  return raw.map(unescapeJsonPointer);
}
function getByPath(obj, path13) {
  if (!path13 || path13 === "/") {
    return obj;
  }
  const segments = parseJsonPointer(path13);
  let current = obj;
  for (const segment of segments) {
    if (current === null || current === void 0) {
      return void 0;
    }
    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      current = current[index];
    } else if (typeof current === "object") {
      current = current[segment];
    } else {
      return void 0;
    }
  }
  return current;
}
function isNumericIndex(str) {
  return /^\d+$/.test(str);
}
function setByPath(obj, path13, value) {
  const segments = parseJsonPointer(path13);
  if (segments.length === 0) return;
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];
    const nextIsNumeric = nextSegment !== void 0 && (isNumericIndex(nextSegment) || nextSegment === "-");
    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (current[index] === void 0 || typeof current[index] !== "object") {
        current[index] = nextIsNumeric ? [] : {};
      }
      current = current[index];
    } else {
      if (!(segment in current) || typeof current[segment] !== "object") {
        current[segment] = nextIsNumeric ? [] : {};
      }
      current = current[segment];
    }
  }
  const lastSegment = segments[segments.length - 1];
  if (Array.isArray(current)) {
    if (lastSegment === "-") {
      current.push(value);
    } else {
      const index = parseInt(lastSegment, 10);
      current[index] = value;
    }
  } else {
    current[lastSegment] = value;
  }
}
function addByPath(obj, path13, value) {
  const segments = parseJsonPointer(path13);
  if (segments.length === 0) return;
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];
    const nextIsNumeric = nextSegment !== void 0 && (isNumericIndex(nextSegment) || nextSegment === "-");
    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (current[index] === void 0 || typeof current[index] !== "object") {
        current[index] = nextIsNumeric ? [] : {};
      }
      current = current[index];
    } else {
      if (!(segment in current) || typeof current[segment] !== "object") {
        current[segment] = nextIsNumeric ? [] : {};
      }
      current = current[segment];
    }
  }
  const lastSegment = segments[segments.length - 1];
  if (Array.isArray(current)) {
    if (lastSegment === "-") {
      current.push(value);
    } else {
      const index = parseInt(lastSegment, 10);
      current.splice(index, 0, value);
    }
  } else {
    current[lastSegment] = value;
  }
}
function removeByPath(obj, path13) {
  const segments = parseJsonPointer(path13);
  if (segments.length === 0) return;
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (current[index] === void 0 || typeof current[index] !== "object") {
        return;
      }
      current = current[index];
    } else {
      if (!(segment in current) || typeof current[segment] !== "object") {
        return;
      }
      current = current[segment];
    }
  }
  const lastSegment = segments[segments.length - 1];
  if (Array.isArray(current)) {
    const index = parseInt(lastSegment, 10);
    if (index >= 0 && index < current.length) {
      current.splice(index, 1);
    }
  } else {
    delete current[lastSegment];
  }
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aObj = a;
  const bObj = b;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
}
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
function applySpecStreamPatch(obj, patch) {
  switch (patch.op) {
    case "add":
      addByPath(obj, patch.path, patch.value);
      break;
    case "replace":
      setByPath(obj, patch.path, patch.value);
      break;
    case "remove":
      removeByPath(obj, patch.path);
      break;
    case "move": {
      if (!patch.from) break;
      const moveValue = getByPath(obj, patch.from);
      removeByPath(obj, patch.from);
      addByPath(obj, patch.path, moveValue);
      break;
    }
    case "copy": {
      if (!patch.from) break;
      const copyValue = getByPath(obj, patch.from);
      addByPath(obj, patch.path, copyValue);
      break;
    }
    case "test": {
      const actual = getByPath(obj, patch.path);
      if (!deepEqual(actual, patch.value)) {
        throw new Error(
          `Test operation failed: value at "${patch.path}" does not match`
        );
      }
      break;
    }
  }
  return obj;
}
function compileSpecStream(stream, initial = {}) {
  const lines = stream.split("\n");
  const result = { ...initial };
  for (const line of lines) {
    const patch = parseSpecStreamLine(line);
    if (patch) {
      applySpecStreamPatch(result, patch);
    }
  }
  return result;
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
var import_zod2 = require("zod");
var import_zod3 = require("zod");
var import_zod4 = require("zod");
var import_zod5 = require("zod");
var numericOrStateRef = import_zod2.z.union([
  import_zod2.z.number(),
  import_zod2.z.object({ $state: import_zod2.z.string() })
]);
var comparisonOps = {
  eq: import_zod2.z.unknown().optional(),
  neq: import_zod2.z.unknown().optional(),
  gt: numericOrStateRef.optional(),
  gte: numericOrStateRef.optional(),
  lt: numericOrStateRef.optional(),
  lte: numericOrStateRef.optional(),
  not: import_zod2.z.literal(true).optional()
};
var StateConditionSchema = import_zod2.z.object({
  $state: import_zod2.z.string(),
  ...comparisonOps
});
var ItemConditionSchema = import_zod2.z.object({
  $item: import_zod2.z.string(),
  ...comparisonOps
});
var IndexConditionSchema = import_zod2.z.object({
  $index: import_zod2.z.literal(true),
  ...comparisonOps
});
var SingleConditionSchema = import_zod2.z.union([
  StateConditionSchema,
  ItemConditionSchema,
  IndexConditionSchema
]);
var VisibilityConditionSchema = import_zod2.z.lazy(
  () => import_zod2.z.union([
    import_zod2.z.boolean(),
    SingleConditionSchema,
    import_zod2.z.array(SingleConditionSchema),
    import_zod2.z.object({ $and: import_zod2.z.array(VisibilityConditionSchema) }),
    import_zod2.z.object({ $or: import_zod2.z.array(VisibilityConditionSchema) })
  ])
);
var ActionConfirmSchema = import_zod3.z.object({
  title: import_zod3.z.string(),
  message: import_zod3.z.string(),
  confirmLabel: import_zod3.z.string().optional(),
  cancelLabel: import_zod3.z.string().optional(),
  variant: import_zod3.z.enum(["default", "danger"]).optional()
});
var ActionOnSuccessSchema = import_zod3.z.union([
  import_zod3.z.object({ navigate: import_zod3.z.string() }),
  import_zod3.z.object({ set: import_zod3.z.record(import_zod3.z.string(), import_zod3.z.unknown()) }),
  import_zod3.z.object({ action: import_zod3.z.string() })
]);
var ActionOnErrorSchema = import_zod3.z.union([
  import_zod3.z.object({ set: import_zod3.z.record(import_zod3.z.string(), import_zod3.z.unknown()) }),
  import_zod3.z.object({ action: import_zod3.z.string() })
]);
var ActionBindingSchema = import_zod3.z.object({
  action: import_zod3.z.string(),
  params: import_zod3.z.record(import_zod3.z.string(), DynamicValueSchema).optional(),
  confirm: ActionConfirmSchema.optional(),
  onSuccess: ActionOnSuccessSchema.optional(),
  onError: ActionOnErrorSchema.optional(),
  preventDefault: import_zod3.z.boolean().optional()
});
var ValidationCheckSchema = import_zod4.z.object({
  type: import_zod4.z.string(),
  args: import_zod4.z.record(import_zod4.z.string(), DynamicValueSchema).optional(),
  message: import_zod4.z.string()
});
var ValidationConfigSchema = import_zod4.z.object({
  checks: import_zod4.z.array(ValidationCheckSchema).optional(),
  validateOn: import_zod4.z.enum(["change", "blur", "submit"]).optional(),
  enabled: VisibilityConditionSchema.optional()
});

// src/main/agent-notification-service.ts
var import_node_path7 = __toESM(require("node:path"), 1);
var import_promises7 = require("node:fs/promises");
function normalizeAgentId2(agentId) {
  const normalized = agentId.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
  if (!normalized) {
    throw new Error("agentId \u975E\u6CD5\u3002");
  }
  return normalized;
}
function normalizeOneLine(value, maxLength) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function createNotificationId(now = /* @__PURE__ */ new Date()) {
  return `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
}
async function resolveNotificationFilePath(agentId, homeDirOverride) {
  const shared = await ensureSharedWorkspace(homeDirOverride);
  const notificationsDir = import_node_path7.default.join(shared.sharedDataRoot, "notifications");
  await (0, import_promises7.mkdir)(notificationsDir, { recursive: true });
  return import_node_path7.default.join(notificationsDir, `${normalizeAgentId2(agentId)}.jsonl`);
}
async function readNotifications(agentId, homeDirOverride) {
  const filePath = await resolveNotificationFilePath(agentId, homeDirOverride);
  let content = "";
  try {
    content = await (0, import_promises7.readFile)(filePath, "utf-8");
  } catch {
    return [];
  }
  const lines = content.split(/\r?\n/).filter(Boolean);
  const result = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item?.agentId === normalizeAgentId2(agentId) && typeof item.notificationId === "string") {
        result.push(item);
      }
    } catch {
    }
  }
  return result;
}
async function appendAgentNotification(agentId, input, homeDirOverride) {
  const now = /* @__PURE__ */ new Date();
  const normalizedAgentId = normalizeAgentId2(agentId);
  const payload = {
    notificationId: createNotificationId(now),
    agentId: normalizedAgentId,
    requestId: input.requestId?.trim() || void 0,
    kind: input.kind,
    title: normalizeOneLine(input.title, 120),
    message: normalizeOneLine(input.message, 2e3),
    createdAt: input.createdAt ?? now.toISOString(),
    read: false,
    meta: input.meta
  };
  const filePath = await resolveNotificationFilePath(normalizedAgentId, homeDirOverride);
  await (0, import_promises7.appendFile)(filePath, `${JSON.stringify(payload)}
`, "utf-8");
}
async function listAgentNotifications(input) {
  try {
    const limit = Math.max(1, Math.min(200, input.limit ?? 50));
    const all = await readNotifications(input.agentId, input.homeDirOverride);
    const filtered = input.unreadOnly ? all.filter((item) => !item.read) : all;
    return {
      success: true,
      notifications: filtered.slice(-limit).reverse()
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      notifications: []
    };
  }
}
async function markAgentNotificationsRead(input) {
  try {
    const all = await readNotifications(input.agentId, input.homeDirOverride);
    if (all.length === 0) {
      return { success: true, updatedCount: 0 };
    }
    const markAll = input.markAll === true || !input.notificationIds || input.notificationIds.length === 0;
    const targets = new Set((input.notificationIds ?? []).map((item) => item.trim()).filter(Boolean));
    let updatedCount = 0;
    const next = all.map((item) => {
      if (item.read) return item;
      const shouldRead = markAll || targets.has(item.notificationId);
      if (!shouldRead) return item;
      updatedCount += 1;
      return { ...item, read: true };
    });
    if (updatedCount === 0) {
      return { success: true, updatedCount: 0 };
    }
    const filePath = await resolveNotificationFilePath(input.agentId, input.homeDirOverride);
    const serialized = `${next.map((item) => JSON.stringify(item)).join("\n")}
`;
    await (0, import_promises7.writeFile)(filePath, serialized, "utf-8");
    return {
      success: true,
      updatedCount
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      updatedCount: 0
    };
  }
}

// src/main/agent-chat-service.ts
var DEFAULT_REQUEST_TIMEOUT_MS = 6e5;
var activeChatControllers = /* @__PURE__ */ new Map();
var cancelledChatRequests = /* @__PURE__ */ new Set();
var GEN_UI_PATCH_OPS = /* @__PURE__ */ new Set(["add", "remove", "replace", "move", "copy", "test"]);
var TOOL_CONFIG_INTENT_PATTERN = /(配置|设置|切换|provider|api key|apikey|密钥|令牌|token|auth|授权|proxy|路由|model routing|模型路由|quota|限额|web_search_config|web_access_config|model_routing_config|manage_auth_profile|switch_provider|check_provider_quota)/i;
function buildToolGuardSystemMessage(userMessage) {
  const normalized = userMessage.trim();
  if (!normalized) {
    return null;
  }
  if (TOOL_CONFIG_INTENT_PATTERN.test(normalized)) {
    return null;
  }
  return {
    role: "system",
    content: [
      "\u5DE5\u5177\u4F7F\u7528\u89C4\u5219\uFF1A",
      "1. \u4EC5\u5728\u7528\u6237\u660E\u786E\u8981\u6C42\u201C\u4FEE\u6539\u914D\u7F6E/\u5207\u6362\u63D0\u4F9B\u5546/\u8C03\u6574\u8DEF\u7531/\u7BA1\u7406\u51ED\u636E\u201D\u65F6\uFF0C\u624D\u53EF\u8C03\u7528 *_config\u3001manage_auth_profile\u3001switch_provider\u3001check_provider_quota\u3002",
      "2. \u666E\u901A\u4FE1\u606F\u68C0\u7D22\u6216\u6570\u636E\u67E5\u8BE2\u573A\u666F\uFF0C\u5FC5\u987B\u4F18\u5148\u8C03\u7528\u6267\u884C\u7C7B\u5DE5\u5177\uFF0C\u4E0D\u8981\u5148\u6539\u914D\u7F6E\u3002",
      "3. \u9700\u8981\u8054\u7F51\u641C\u7D22\u65F6\uFF0C\u4F18\u5148\u4F7F\u7528 web_search_tool\uFF1Bweb_search_config \u4EC5\u7528\u4E8E\u914D\u7F6E\u53D8\u66F4\u3002",
      "4. \u82E5\u6267\u884C\u7C7B\u5DE5\u5177\u5931\u8D25\uFF0C\u5148\u8FD4\u56DE\u5931\u8D25\u539F\u56E0\uFF0C\u518D\u8BE2\u95EE\u662F\u5426\u5141\u8BB8\u8C03\u6574\u914D\u7F6E\u3002"
    ].join("\n")
  };
}
function extractJsonBlocks(text) {
  const blocks = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          const raw = text.slice(start, i + 1);
          try {
            const value = JSON.parse(raw);
            blocks.push({ raw, value });
          } catch {
          }
          start = -1;
        }
      }
    }
  }
  return blocks;
}
function summarizeNotificationMessage(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "\u4EFB\u52A1\u6267\u884C\u5B8C\u6210\u3002";
  }
  return normalized.slice(0, 240);
}
function looksLikeGenUiSpec(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  const obj = candidate;
  if (typeof obj.root === "string" && obj.elements && typeof obj.elements === "object") {
    const elements = Object.values(obj.elements);
    return elements.some((el) => typeof el === "object" && el !== null && typeof el.type === "string");
  }
  if (typeof obj.type === "string" && (obj.props || obj.children)) {
    return true;
  }
  return false;
}
function looksLikeGenUiPatch(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  const obj = candidate;
  if (typeof obj.op !== "string" || !GEN_UI_PATCH_OPS.has(obj.op)) return false;
  if (typeof obj.path !== "string") return false;
  return obj.path.startsWith("/");
}
function normalizeGenUiSpec(spec) {
  if (looksLikeGenUiSpec(spec)) return spec;
  if (!spec || typeof spec !== "object") return void 0;
  const obj = spec;
  if (Array.isArray(obj)) {
    const hasElements = obj.some((item) => item && typeof item === "object" && typeof item.type === "string");
    if (hasElements) {
      return { type: "div", props: {}, children: obj };
    }
  }
  if (Array.isArray(obj.children)) {
    return { type: "div", props: {}, children: obj.children };
  }
  return void 0;
}
function parseGenUiFromText(text) {
  if (!text) return { text };
  const blocks = extractJsonBlocks(text);
  if (blocks.length === 0) return { text };
  let spec;
  const patchBlocks = [];
  const specBlocks = [];
  for (const block of blocks) {
    if (looksLikeGenUiSpec(block.value)) {
      specBlocks.push(block);
    } else if (looksLikeGenUiPatch(block.value)) {
      patchBlocks.push(block);
    }
  }
  if (specBlocks.length > 0) {
    spec = specBlocks[0]?.value;
  } else if (patchBlocks.length > 0) {
    const jsonl = patchBlocks.map((block) => block.raw.trim()).join("\n");
    try {
      spec = compileSpecStream(jsonl);
    } catch (error) {
      console.error("[AgentChat] GenUI patch compile failed:", error);
    }
  }
  const normalized = normalizeGenUiSpec(spec);
  if (!normalized) {
    return { text };
  }
  return { text, spec: normalized };
}
function normalizeHistory(history) {
  if (!history) return [];
  return history.filter((item) => item.role === "user" || item.role === "assistant").map((item) => ({ role: item.role, content: item.content }));
}
function buildApiChatContext(history) {
  const lines = history.map((item) => {
    const roleLabel = item.role === "assistant" ? "Assistant" : "User";
    return `${roleLabel}: ${item.content}`;
  });
  return lines.slice(-20);
}
function isNotFoundError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /\((404|405)\)/.test(error.message);
}
async function observeGatewayEvents(apiBase, onEvent, abortController) {
  const base = apiBase.replace(/\/+$/, "");
  const url = `${base}/api/events`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache"
    },
    signal: abortController.signal
  });
  if (!response.ok) {
    throw new Error(`\u7F51\u5173\u4E8B\u4EF6\u8BA2\u9605\u5931\u8D25 (${response.status})`);
  }
  if (!response.body) {
    throw new Error("\u7F51\u5173\u4E8B\u4EF6\u6D41\u4E3A\u7A7A");
  }
  const decoder = new TextDecoder("utf-8");
  const reader = response.body.getReader();
  let buffer = "";
  let currentData = "";
  const flushEvent = () => {
    const raw = currentData.trim();
    currentData = "";
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      onEvent(parsed);
    } catch {
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) {
        flushEvent();
        continue;
      }
      if (line.startsWith("data:")) {
        currentData += `${line.slice(5).trim()}
`;
      }
    }
  }
  flushEvent();
}
async function requestApiChatCompletion(apiBase, message, context, timeoutMs, abortController) {
  const controller = abortController ?? new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = apiBase.replace(/\/+$/, "");
    const url = `${base}/api/chat`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        context
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`\u7F51\u5173\u8BF7\u6C42\u5931\u8D25 (${response.status}) ${text}`);
    }
    const payload = await response.json();
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      throw new Error(payload.error);
    }
    const content = payload.reply;
    if (!content) {
      throw new Error("\u7F51\u5173\u8FD4\u56DE\u4E3A\u7A7A");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}
async function requestChatCompletionCompat(apiBase, modelName, messages, timeoutMs, abortController) {
  const controller = abortController ?? new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = apiBase.replace(/\/+$/, "");
    const url = `${base}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
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
      throw new Error(`\u7F51\u5173\u8BF7\u6C42\u5931\u8D25 (${response.status}) ${text}`);
    }
    const payload = await response.json();
    const content = payload.reply ?? payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("\u7F51\u5173\u8FD4\u56DE\u4E3A\u7A7A");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}
async function requestChatCompletionStream(apiBase, modelName, messages, timeoutMs, onDelta, abortController) {
  const controller = abortController ?? new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let normalizeTextPart = function(value) {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) {
        return value.map((item) => {
          if (typeof item === "string") return item;
          if (!item || typeof item !== "object") return "";
          const obj = item;
          if (typeof obj.text === "string") return obj.text;
          if (typeof obj.content === "string") return obj.content;
          return "";
        }).join("");
      }
      return "";
    }, extractDeltaText = function(chunk) {
      const choice = chunk.choices?.[0];
      if (!choice) return "";
      const delta = choice.delta ?? {};
      const message = choice.message ?? {};
      const candidates = [
        delta.content,
        delta.reasoning_content,
        delta.reasoning,
        delta.text,
        message.content,
        message.reasoning_content,
        message.reasoning,
        message.text
      ];
      for (const candidate of candidates) {
        const text = normalizeTextPart(candidate);
        if (text) return text;
      }
      return "";
    };
    const base = apiBase.replace(/\/+$/, "");
    const url = `${base}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
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
      throw new Error(`\u7F51\u5173\u8BF7\u6C42\u5931\u8D25 (${response.status}) ${text}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      const content2 = payload.reply ?? payload.choices?.[0]?.message?.content ?? "";
      if (!content2) {
        throw new Error("\u7F51\u5173\u8FD4\u56DE\u4E3A\u7A7A");
      }
      onDelta?.(content2);
      return content2;
    }
    if (!response.body) {
      throw new Error("\u7F51\u5173\u6D41\u5F0F\u54CD\u5E94\u4E3A\u7A7A");
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
          const delta = extractDeltaText(json);
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
function createChatModeParser(emitChunk, requestId, onLogChunk) {
  const PATCH_START_PATTERN = /(?:^|\n)\s*(?:```spec\b|\{"op"\s*:\s*"(?:add|remove|replace|move|copy|test)"\s*,\s*"path"\s*:)/m;
  const PATCH_DETECTION_TAIL = 160;
  const parser = createMixedStreamParser({
    onText: () => {
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
  let patchStarted = false;
  let pendingText = "";
  const emitTextChunk = (value) => {
    if (!value) return;
    emitChunk({ requestId, kind: "text", value });
  };
  const emitLogChunk = (value) => {
    if (!value) return;
    onLogChunk?.(value);
    emitChunk({ requestId, kind: "log", value });
  };
  return {
    push: (chunk) => {
      if (!chunk) {
        return;
      }
      emitLogChunk(chunk);
      parser.push(chunk);
      if (patchStarted) {
        return;
      }
      pendingText += chunk;
      const match = pendingText.match(PATCH_START_PATTERN);
      if (typeof match?.index === "number") {
        const safeText = pendingText.slice(0, match.index);
        emitTextChunk(safeText);
        pendingText = "";
        patchStarted = true;
        return;
      }
      if (pendingText.length > PATCH_DETECTION_TAIL) {
        const safeLength = pendingText.length - PATCH_DETECTION_TAIL;
        const safeText = pendingText.slice(0, safeLength);
        pendingText = pendingText.slice(safeLength);
        emitTextChunk(safeText);
      }
    },
    flush: () => {
      parser.flush();
      if (!patchStarted && pendingText) {
        emitTextChunk(pendingText);
      }
      pendingText = "";
    }
  };
}
async function sendAgentChat(input, emitChunk) {
  const profile = await getAgentProfile({ agentId: input.agentId, homeDirOverride: input.homeDirOverride });
  const runtimeStatus = getAgentRuntimeStatus(profile.agentId);
  if (runtimeStatus.status !== "online") {
    return {
      success: false,
      content: "\u667A\u80FD\u4F53\u672A\u8FD0\u884C\uFF0C\u8BF7\u5148\u542F\u52A8\u667A\u80FD\u4F53\u8FD0\u884C\u65F6\u3002",
      error: "\u667A\u80FD\u4F53\u79BB\u7EBF"
    };
  }
  const gatewayBaseUrl = getAgentRuntimeGatewayBaseUrl(profile.agentId);
  const timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
  const history = normalizeHistory(input.history);
  const toolGuardSystemMessage = buildToolGuardSystemMessage(input.message);
  const contextLines = buildApiChatContext(history);
  if (toolGuardSystemMessage) {
    contextLines.unshift(`System: ${toolGuardSystemMessage.content}`);
  }
  const messages = [
    ...toolGuardSystemMessage ? [toolGuardSystemMessage] : [],
    ...history,
    { role: "user", content: input.message }
  ];
  const requestId = input.requestId ?? `req_${Date.now()}`;
  const controller = new AbortController();
  activeChatControllers.set(requestId, controller);
  const eventController = new AbortController();
  let eventWatcher = null;
  let eventWriteQueue = Promise.resolve();
  let logLineBuffer = "";
  const requestStartedAt = Date.now();
  const queueEvent = (kind, message, meta) => {
    eventWriteQueue = eventWriteQueue.then(
      () => appendAgentCollaborationEvent(
        profile.agentId,
        requestId,
        {
          kind,
          message,
          meta
        },
        input.homeDirOverride
      )
    ).catch((error) => {
      console.error("[AgentChat] collaboration event append failed:", error);
    });
  };
  const queueNotification = (kind, title, message, meta) => {
    eventWriteQueue = eventWriteQueue.then(
      () => appendAgentNotification(
        profile.agentId,
        {
          requestId,
          kind,
          title,
          message: summarizeNotificationMessage(message),
          meta
        },
        input.homeDirOverride
      )
    ).catch((error) => {
      console.error("[AgentChat] notification append failed:", error);
    });
  };
  const queueRuntimeLogChunk = (chunk) => {
    if (!chunk) return;
    logLineBuffer += chunk;
    const lines = logLineBuffer.split(/\r?\n/);
    logLineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const normalized = line.trim();
      if (!normalized) continue;
      queueEvent(inferEventKindFromRuntimeLog(normalized), normalized);
    }
  };
  queueEvent("chat_started", input.message, {
    stream: !!input.stream,
    historyCount: history.length,
    gatewayBaseUrl
  });
  const emitRuntimeLog = (message) => {
    if (!message.trim()) return;
    emitChunk?.({
      requestId,
      kind: "log",
      value: `${message}
`
    });
  };
  const toEventTimestamp = (value) => {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  };
  eventWatcher = observeGatewayEvents(
    gatewayBaseUrl,
    (event) => {
      const ts = toEventTimestamp(event.timestamp);
      if (ts !== null && ts + 500 < requestStartedAt) {
        return;
      }
      const type = (event.type ?? "").trim();
      if (!type) return;
      if (type === "tool_call_start") {
        const toolName = event.tool?.trim() || "unknown_tool";
        const message = `[tool:start] ${toolName}`;
        queueEvent(toolName.toLowerCase().includes("delegate") ? "delegate_call" : "tool_call", message, {
          tool: toolName,
          timestamp: event.timestamp
        });
        emitRuntimeLog(message);
        return;
      }
      if (type === "tool_call") {
        const toolName = event.tool?.trim() || "unknown_tool";
        const duration = typeof event.duration_ms === "number" ? event.duration_ms : void 0;
        const success = event.success !== false;
        const message = `[tool] ${toolName} ${success ? "success" : "failed"}${typeof duration === "number" ? ` (${duration}ms)` : ""}`;
        queueEvent(toolName.toLowerCase().includes("delegate") ? "delegate_call" : "tool_call", message, {
          tool: toolName,
          durationMs: duration,
          success,
          timestamp: event.timestamp
        });
        emitRuntimeLog(message);
        return;
      }
      if (type === "error") {
        const component = event.component?.trim() || "gateway";
        const details = event.message?.trim() || "unknown error";
        const message = `[${component}] ${details}`;
        queueEvent("runtime_log", message, { component, timestamp: event.timestamp });
        emitRuntimeLog(message);
        return;
      }
      if (type === "agent_start" || type === "agent_end" || type === "llm_request") {
        const provider = event.provider?.trim() || "unknown";
        const model = event.model?.trim() || "unknown";
        const message = `[${type}] ${provider}/${model}`;
        queueEvent("runtime_log", message, { type, provider, model, timestamp: event.timestamp });
        emitRuntimeLog(message);
      }
    },
    eventController
  ).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (!/abort/i.test(reason)) {
      console.error("[AgentChat] gateway event stream failed:", error);
      queueEvent("runtime_log", `[events] ${reason}`);
    }
  });
  try {
    const parser = input.stream && emitChunk ? createChatModeParser(emitChunk, requestId, queueRuntimeLogChunk) : null;
    const onDelta = input.stream && emitChunk ? (delta) => parser?.push(delta) : void 0;
    const content = input.stream ? await requestChatCompletionStream(
      gatewayBaseUrl,
      profile.defaultLlm.modelName,
      messages,
      timeoutMs,
      onDelta,
      controller
    ) : await (async () => {
      try {
        return await requestApiChatCompletion(
          gatewayBaseUrl,
          input.message,
          contextLines,
          timeoutMs,
          controller
        );
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
        return requestChatCompletionCompat(
          gatewayBaseUrl,
          profile.defaultLlm.modelName,
          messages,
          timeoutMs,
          controller
        );
      }
    })();
    const parsed = parseGenUiFromText(content);
    if (input.stream && emitChunk) {
      parser?.flush();
      emitChunk({
        requestId,
        kind: "done",
        text: parsed.text,
        spec: parsed.spec
      });
    }
    if (logLineBuffer.trim()) {
      const tail = logLineBuffer.trim();
      queueEvent(inferEventKindFromRuntimeLog(tail), tail);
      logLineBuffer = "";
    }
    queueEvent("chat_done", parsed.text || "\u804A\u5929\u5B8C\u6210", {
      hasSpec: !!parsed.spec,
      stream: !!input.stream
    });
    queueNotification("request_done", "\u4EFB\u52A1\u5DF2\u5B8C\u6210", parsed.text || "\u4EFB\u52A1\u6267\u884C\u5B8C\u6210\u3002", {
      hasSpec: !!parsed.spec,
      stream: !!input.stream
    });
    await eventWriteQueue;
    return {
      success: true,
      content: parsed.text,
      text: parsed.text,
      spec: parsed.spec
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const isAbort = error instanceof Error && error.name === "AbortError" || /aborted/i.test(rawMessage);
    const wasCancelled = cancelledChatRequests.has(requestId);
    const errorMessage = wasCancelled ? "\u5DF2\u505C\u6B62\u8F93\u51FA\u3002" : isAbort ? `\u8BF7\u6C42\u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)}\u79D2\uFF09\uFF0C\u8BF7\u68C0\u67E5\u672C\u5730 ZeroClaw \u7F51\u5173\u3002` : rawMessage;
    if (logLineBuffer.trim()) {
      const tail = logLineBuffer.trim();
      queueEvent(inferEventKindFromRuntimeLog(tail), tail);
      logLineBuffer = "";
    }
    queueEvent("chat_error", errorMessage, {
      stream: !!input.stream,
      aborted: isAbort,
      cancelled: wasCancelled
    });
    queueNotification("request_error", "\u4EFB\u52A1\u6267\u884C\u5931\u8D25", errorMessage, {
      stream: !!input.stream,
      aborted: isAbort,
      cancelled: wasCancelled
    });
    await eventWriteQueue;
    if (input.stream && emitChunk) {
      emitChunk({
        requestId,
        kind: "error",
        value: errorMessage
      });
    }
    return {
      success: false,
      content: errorMessage,
      error: errorMessage
    };
  } finally {
    eventController.abort();
    if (eventWatcher) {
      try {
        await eventWatcher;
      } catch {
      }
    }
    activeChatControllers.delete(requestId);
    cancelledChatRequests.delete(requestId);
  }
}
function cancelAgentChat(input) {
  const controller = activeChatControllers.get(input.requestId);
  if (!controller) {
    return { success: false, message: "\u672A\u627E\u5230\u53EF\u4E2D\u65AD\u7684\u8BF7\u6C42\u3002" };
  }
  cancelledChatRequests.add(input.requestId);
  controller.abort();
  return { success: true };
}

// src/main/agent-task-service.ts
var import_node_path8 = __toESM(require("node:path"), 1);
var import_promises8 = require("node:fs/promises");
var import_node_sqlite2 = require("node:sqlite");
var DEFAULT_TIMEOUT_MS2 = 2e4;
var TASK_PROMPT_FORBIDDEN_PATTERN = /\b(cron_add|cron_update|cron_remove|cron_run|cron_list|web_search_config|web_access_config|model_routing_config|curl|wget)\b/gi;
function sanitizeAgentTaskPrompt(rawPrompt) {
  const normalized = (rawPrompt || "").replace(/\s+/g, " ").trim();
  const business = normalized.replace(/^只做业务执行[:：]?\s*/i, "").replace(TASK_PROMPT_FORBIDDEN_PATTERN, "").replace(/\s+/g, " ").trim();
  const compact = (business || "\u6267\u884C\u4EFB\u52A1\u5E76\u8FD4\u56DE\u7B80\u8981\u4E1A\u52A1\u7ED3\u679C\u3002").slice(0, 320);
  return [
    `\u53EA\u505A\u4E1A\u52A1\u6267\u884C\uFF1A${compact}`,
    "\u6267\u884C\u7EA6\u675F\uFF1A\u4F18\u5148\u4F7F\u7528 web_search_tool\uFF08\u82E5\u53EF\u7528\uFF09\u6216\u5DF2\u6388\u6743\u68C0\u7D22\u5DE5\u5177\uFF1B\u7981\u6B62\u8C03\u7528 cron_add/cron_update/cron_remove/cron_run/cron_list\uFF1B\u7981\u6B62\u8C03\u7528 web_search_config/web_access_config/model_routing_config\uFF1B\u7981\u6B62\u4F7F\u7528 curl/wget\uFF1B\u4EC5\u8F93\u51FA\u4E1A\u52A1\u7ED3\u679C\u6216\u5931\u8D25\u539F\u56E0\u3002"
  ].join("\n");
}
function mapGatewayCronJobToTask(job) {
  return {
    id: String(job.id),
    name: job.name?.trim() || "\u672A\u547D\u540D\u4EFB\u52A1",
    sourceType: "custom",
    scheduleKind: "cron",
    scheduleExpression: "",
    jobType: "shell",
    command: job.command,
    prompt: void 0,
    sessionTarget: void 0,
    enabled: !!job.enabled,
    nextRun: job.next_run || void 0,
    lastRun: job.last_run || void 0,
    lastStatus: job.last_status || void 0
  };
}
function buildCronAddToolArgs(input) {
  const schedule = input.scheduleKind === "every" ? { kind: "every", every_ms: input.everyMs } : input.scheduleKind === "at" ? { kind: "at", at: input.runAt } : { kind: "cron", expr: input.scheduleExpression, tz: input.timezone || void 0 };
  const args = {
    name: input.name?.trim() || void 0,
    schedule,
    job_type: input.jobType,
    session_target: input.sessionTarget || "isolated",
    delete_after_run: input.scheduleKind === "at" ? true : void 0
  };
  if (input.jobType === "agent") {
    args.prompt = sanitizeAgentTaskPrompt(input.prompt);
    if (input.model) {
      args.model = input.model;
    }
  } else {
    args.command = input.command;
  }
  if (input.deliveryMode && input.deliveryMode !== "none") {
    args.delivery = {
      mode: "announce",
      channel: input.deliveryChannel,
      to: input.deliveryTarget,
      best_effort: input.deliveryBestEffort !== false
    };
  }
  return args;
}
function validateCreateInput(input) {
  if (!input.agentId?.trim()) {
    return "agentId \u4E0D\u80FD\u4E3A\u7A7A\u3002";
  }
  if (input.scheduleKind === "cron" && !input.scheduleExpression?.trim()) {
    return "cron \u4EFB\u52A1\u5FC5\u987B\u586B\u5199\u8C03\u5EA6\u8868\u8FBE\u5F0F\u3002";
  }
  if (input.scheduleKind === "at" && !input.runAt?.trim()) {
    return "at \u4EFB\u52A1\u5FC5\u987B\u586B\u5199\u8FD0\u884C\u65F6\u95F4\u3002";
  }
  if (input.scheduleKind === "every" && (!input.everyMs || input.everyMs < 1e3)) {
    return "every \u4EFB\u52A1\u5FC5\u987B\u586B\u5199\u6BCF\u6B21\u6267\u884C\u95F4\u9694\uFF08\u6BEB\u79D2\uFF0C\u4E14 >= 1000\uFF09\u3002";
  }
  if (input.jobType === "shell" && !input.command?.trim()) {
    return "shell \u4EFB\u52A1\u5FC5\u987B\u586B\u5199\u547D\u4EE4\u3002";
  }
  if (input.jobType === "agent" && !input.prompt?.trim()) {
    return "agent \u4EFB\u52A1\u5FC5\u987B\u586B\u5199\u63D0\u793A\u8BCD\u3002";
  }
  if (input.deliveryMode && input.deliveryMode !== "none") {
    if (!input.deliveryChannel?.trim()) return "\u6295\u9012\u6A21\u5F0F\u4E3A announce \u65F6\u5FC5\u987B\u586B\u5199 channel\u3002";
    if (!input.deliveryTarget?.trim()) return "\u6295\u9012\u6A21\u5F0F\u4E3A announce \u65F6\u5FC5\u987B\u586B\u5199 target\u3002";
  }
  return null;
}
async function requestGateway(baseUrl, path13, method, body, timeoutMs = DEFAULT_TIMEOUT_MS2) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path13}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : void 0,
      body: body ? JSON.stringify(body) : void 0,
      signal: controller.signal
    });
    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : void 0;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && payload !== null && "error" in payload ? String(payload.error) : `\u8BF7\u6C42\u5931\u8D25 (${response.status})`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
async function listGatewayCronJobs2(agentId) {
  const status = getAgentRuntimeStatus(agentId);
  if (status.status !== "online") {
    return [];
  }
  const baseUrl = getAgentRuntimeGatewayBaseUrl(agentId);
  const payload = await requestGateway(baseUrl, "/api/cron", "GET");
  return Array.isArray(payload?.jobs) ? payload.jobs : [];
}
async function fileExists2(targetPath) {
  try {
    await (0, import_promises8.stat)(targetPath);
    return true;
  } catch {
    return false;
  }
}
async function listCronRunsFromDb(agentId, taskId, homeDirOverride) {
  const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
  const dbPath = import_node_path8.default.join(workspace.agentRoot, "zeroclaw", "workspace", "cron", "jobs.db");
  if (!await fileExists2(dbPath)) {
    return [];
  }
  const db = new import_node_sqlite2.DatabaseSync(dbPath, { readOnly: true });
  try {
    const stmt = db.prepare(
      "SELECT id, started_at, finished_at, status, output FROM cron_runs WHERE job_id = ? ORDER BY id DESC LIMIT 200"
    );
    const rows = stmt.all(taskId);
    return Array.isArray(rows) ? rows : [];
  } finally {
    db.close();
  }
}
async function createCronViaGateway(input) {
  const baseUrl = getAgentRuntimeGatewayBaseUrl(input.agentId);
  await requestGateway(
    baseUrl,
    "/api/cron",
    "POST",
    {
      name: input.name?.trim() || void 0,
      schedule: input.scheduleExpression?.trim(),
      command: input.command?.trim()
    }
  );
  const jobs = await listGatewayCronJobs2(input.agentId);
  const byName = jobs.filter((item) => (item.name?.trim() || "") === (input.name?.trim() || "")).sort((a, b) => String(b.next_run).localeCompare(String(a.next_run)));
  const matched = byName[0] ?? jobs[jobs.length - 1];
  return {
    success: true,
    message: "\u4EFB\u52A1\u5DF2\u521B\u5EFA\u3002",
    task: matched ? mapGatewayCronJobToTask(matched) : void 0
  };
}
async function createAdvancedTaskViaAgent(input) {
  const toolArgs = buildCronAddToolArgs(input);
  const message = [
    "\u4F60\u73B0\u5728\u5FC5\u987B\u53EA\u505A\u4E00\u4EF6\u4E8B\uFF1A\u8C03\u7528 cron_add \u5DE5\u5177\u521B\u5EFA\u4EFB\u52A1\u3002",
    "\u7981\u6B62\u89E3\u91CA\u539F\u7406\uFF0C\u7981\u6B62\u95F2\u804A\u3002",
    "\u6309\u7167\u4E0B\u65B9 JSON \u53C2\u6570\u539F\u6837\u6267\u884C\uFF1A",
    "```json",
    JSON.stringify(toolArgs, null, 2),
    "```",
    "\u521B\u5EFA\u6210\u529F\u540E\u53EA\u8FD4\u56DE\u4E00\u53E5\u4E2D\u6587\u786E\u8BA4\uFF0C\u5E76\u5305\u542B\u4EFB\u52A1 ID\uFF08\u5982\u679C\u5DE5\u5177\u8FD4\u56DE\u4E86 ID\uFF09\u3002"
  ].join("\n");
  const chatResult = await sendAgentChat({
    agentId: input.agentId,
    message,
    history: [],
    stream: false,
    homeDirOverride: input.homeDirOverride
  });
  if (!chatResult.success) {
    return {
      success: false,
      message: chatResult.error || chatResult.content || "\u521B\u5EFA\u4EFB\u52A1\u5931\u8D25\u3002"
    };
  }
  const jobs = await listGatewayCronJobs2(input.agentId);
  const byName = jobs.filter((item) => (item.name?.trim() || "") === (input.name?.trim() || "")).sort((a, b) => String(b.next_run).localeCompare(String(a.next_run)));
  const matched = byName[0] ?? jobs[jobs.length - 1];
  return {
    success: true,
    message: chatResult.text || chatResult.content || "\u4EFB\u52A1\u5DF2\u521B\u5EFA\u3002",
    task: matched ? mapGatewayCronJobToTask(matched) : void 0,
    raw: chatResult.text || chatResult.content
  };
}
async function listAgentTasks(input) {
  const status = getAgentRuntimeStatus(input.agentId);
  if (status.status !== "online") {
    return {
      success: false,
      message: "\u667A\u80FD\u4F53\u672A\u8FD0\u884C\uFF0C\u8BF7\u5148\u542F\u52A8\u56E2\u961F\u8FD0\u884C\u65F6\u3002",
      tasks: []
    };
  }
  try {
    const jobs = await listGatewayCronJobs2(input.agentId);
    return {
      success: true,
      tasks: jobs.map(mapGatewayCronJobToTask)
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      tasks: []
    };
  }
}
async function createAgentTask(input) {
  const status = getAgentRuntimeStatus(input.agentId);
  if (status.status !== "online") {
    return {
      success: false,
      message: "\u667A\u80FD\u4F53\u672A\u8FD0\u884C\uFF0C\u8BF7\u5148\u542F\u52A8\u56E2\u961F\u8FD0\u884C\u65F6\u3002"
    };
  }
  const validationError = validateCreateInput(input);
  if (validationError) {
    return {
      success: false,
      message: validationError
    };
  }
  try {
    if (input.scheduleKind === "cron" && input.jobType === "shell") {
      return createCronViaGateway(input);
    }
    return createAdvancedTaskViaAgent(input);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
async function deleteAgentTask(input) {
  const status = getAgentRuntimeStatus(input.agentId);
  if (status.status !== "online") {
    return {
      success: false,
      message: "\u667A\u80FD\u4F53\u672A\u8FD0\u884C\uFF0C\u8BF7\u5148\u542F\u52A8\u56E2\u961F\u8FD0\u884C\u65F6\u3002"
    };
  }
  if (!input.taskId?.trim()) {
    return {
      success: false,
      message: "taskId \u4E0D\u80FD\u4E3A\u7A7A\u3002"
    };
  }
  try {
    const baseUrl = getAgentRuntimeGatewayBaseUrl(input.agentId);
    await requestGateway(
      baseUrl,
      `/api/cron/${encodeURIComponent(input.taskId)}`,
      "DELETE",
      void 0
    );
    return {
      success: true,
      message: "\u4EFB\u52A1\u5DF2\u5220\u9664\u3002"
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
async function getAgentTaskProgress(input) {
  const status = getAgentRuntimeStatus(input.agentId);
  if (status.status !== "online") {
    return {
      success: false,
      message: "\u667A\u80FD\u4F53\u672A\u8FD0\u884C\uFF0C\u8BF7\u5148\u542F\u52A8\u56E2\u961F\u8FD0\u884C\u65F6\u3002",
      logs: []
    };
  }
  if (!input.taskId?.trim()) {
    return {
      success: false,
      message: "taskId \u4E0D\u80FD\u4E3A\u7A7A\u3002",
      logs: []
    };
  }
  try {
    const jobs = await listGatewayCronJobs2(input.agentId);
    const task = jobs.map(mapGatewayCronJobToTask).find((item) => item.id === input.taskId);
    const dbRuns = await listCronRunsFromDb(input.agentId, input.taskId, input.homeDirOverride);
    const logsFromDb = dbRuns.map((run) => ({
      eventId: `run-${run.id}`,
      createdAt: run.started_at,
      kind: run.status || "unknown",
      message: (run.output || "").trim() || `\u4EFB\u52A1\u6267\u884C\u7ED3\u675F\uFF0C\u72B6\u6001\uFF1A${run.status || "unknown"}`
    }));
    let logs = logsFromDb;
    if (logs.length === 0) {
      const events = await getRecentAgentCollaborationEvents({
        agentId: input.agentId,
        limit: 800,
        homeDirOverride: input.homeDirOverride
      });
      logs = events.filter((event) => {
        const meta = event.meta;
        return meta?.source === "scheduled_task" && String(meta?.taskId ?? "") === input.taskId;
      }).slice(-50).map((event) => ({
        eventId: event.eventId,
        createdAt: event.createdAt,
        kind: event.kind,
        message: event.message
      }));
    }
    if (!task && logs.length === 0) {
      return {
        success: false,
        message: `\u672A\u627E\u5230\u4EFB\u52A1\uFF1A${input.taskId}`,
        logs: []
      };
    }
    return {
      success: true,
      task,
      logs
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      logs: []
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
  async collaborationEvents(input) {
    return getRecentAgentCollaborationEvents(input);
  },
  async chat(input, onChunk) {
    return sendAgentChat(input, onChunk);
  },
  async cancelChat(input) {
    return cancelAgentChat(input);
  },
  async listTasks(input) {
    return listAgentTasks(input);
  },
  async createTask(input) {
    return createAgentTask(input);
  },
  async deleteTask(input) {
    return deleteAgentTask(input);
  },
  async taskProgress(input) {
    return getAgentTaskProgress(input);
  },
  async listNotifications(input) {
    return listAgentNotifications(input);
  },
  async markNotificationsRead(input) {
    return markAgentNotificationsRead(input);
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
function asAgentCollaborationEventsInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentCollaborationEvents \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentChatInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentChat \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asCancelAgentChatInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentChatCancel \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentTaskListInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentTaskList \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentTaskCreateInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentTaskCreate \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentTaskDeleteInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentTaskDelete \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentTaskProgressInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentTaskProgress \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentNotificationListInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentNotificationList \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  return payload;
}
function asAgentNotificationMarkReadInput(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("agentNotificationMarkRead \u8BF7\u6C42\u53C2\u6570\u4E0D\u80FD\u4E3A\u7A7A\u3002");
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
    },
    async [AGENT_IPC_CHANNELS.agentCollaborationEvents](payload) {
      try {
        const data = await agentApi.collaborationEvents(asAgentCollaborationEventsInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentChatCancel](payload) {
      try {
        const data = await agentApi.cancelChat(asCancelAgentChatInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentTaskList](payload) {
      try {
        const data = await agentApi.listTasks(asAgentTaskListInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentTaskCreate](payload) {
      try {
        const data = await agentApi.createTask(asAgentTaskCreateInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentTaskDelete](payload) {
      try {
        const data = await agentApi.deleteTask(asAgentTaskDeleteInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentTaskProgress](payload) {
      try {
        const data = await agentApi.taskProgress(asAgentTaskProgressInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentNotificationList](payload) {
      try {
        const data = await agentApi.listNotifications(asAgentNotificationListInput(payload));
        return toSuccess(data);
      } catch (error) {
        return toFailure(error);
      }
    },
    async [AGENT_IPC_CHANNELS.agentNotificationMarkRead](payload) {
      try {
        const data = await agentApi.markNotificationsRead(asAgentNotificationMarkReadInput(payload));
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
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentCollaborationEvents,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentCollaborationEvents](payload)
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
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentChatCancel,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentChatCancel](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentTaskList,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentTaskList](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentTaskCreate,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentTaskCreate](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentTaskDelete,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentTaskDelete](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentTaskProgress,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentTaskProgress](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentNotificationList,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentNotificationList](payload)
  );
  ipcMainLike.handle(
    AGENT_IPC_CHANNELS.agentNotificationMarkRead,
    async (_event, payload) => handlers[AGENT_IPC_CHANNELS.agentNotificationMarkRead](payload)
  );
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
var import_electron2 = require("electron");
function getAutoLaunchSetting() {
  try {
    return import_electron2.app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}
function setAutoLaunchSetting(enabled) {
  try {
    import_electron2.app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    });
    return import_electron2.app.getLoginItemSettings().openAtLogin;
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
var import_electron3 = require("electron");

// src/main/skills-mcp-service.ts
var import_node_path9 = __toESM(require("node:path"), 1);
var import_promises9 = require("node:fs/promises");
var SKILL_FILE_CANDIDATES = ["SKILLS.md", "SKILL.md", "skills.md", "skill.md"];
function parseFrontmatter(content) {
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
  const frontmatter = parseFrontmatter(content);
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
  for (const candidate of SKILL_FILE_CANDIDATES) {
    const filePath = import_node_path9.default.join(folderPath, candidate);
    try {
      const content = await (0, import_promises9.readFile)(filePath, "utf-8");
      return parseSkillFileContent(content, folderName, fallbackLocation);
    } catch {
    }
  }
  return null;
}
async function ensureDirectory3(dirPath) {
  await (0, import_promises9.mkdir)(dirPath, { recursive: true });
}
async function isDirectory(targetPath) {
  try {
    const info = await (0, import_promises9.stat)(targetPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}
function createSkillId(folderName) {
  return folderName.trim();
}
function parseSkillId(skillId) {
  const trimmed = skillId.trim();
  const match = trimmed.match(/^(?:app|shared|global|agent):(.+)$/);
  if (match?.[1]) {
    return { folderName: match[1].trim() };
  }
  return { folderName: trimmed };
}
function buildFallbackLocation(folderName) {
  return import_node_path9.default.join("skills", folderName);
}
async function resolveSkillsRoot(scope) {
  const shared = await ensureSharedWorkspace(scope?.homeDirOverride);
  await ensureDirectory3(shared.sharedSkillsRoot);
  return shared.sharedSkillsRoot;
}
async function resolveMcpStoragePath(scope) {
  const shared = await ensureSharedWorkspace(scope?.homeDirOverride);
  await ensureDirectory3(shared.sharedMcpRoot);
  return import_node_path9.default.join(shared.sharedMcpRoot, "servers.json");
}
async function readSkillsFromRoot(skillsRoot) {
  const entries = await (0, import_promises9.readdir)(skillsRoot, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderName = entry.name;
    const folderPath = import_node_path9.default.join(skillsRoot, folderName);
    const metadata = await resolveSkillMetadata(folderPath, folderName, buildFallbackLocation(folderName));
    if (!metadata) continue;
    skills.push({
      id: createSkillId(folderName),
      metadata,
      path: folderPath,
      isSystem: false,
      isNew: false
    });
  }
  return skills;
}
async function safeReadSkillsFromRoot(skillsRoot) {
  try {
    return await readSkillsFromRoot(skillsRoot);
  } catch {
    return [];
  }
}
async function resolveUniqueFolderName(baseName, root) {
  const normalizedBase = baseName.trim().replace(/[\\/:*?"<>|]/g, "_") || "skill";
  let candidate = normalizedBase;
  let index = 1;
  while (await isDirectory(import_node_path9.default.join(root, candidate))) {
    candidate = `${normalizedBase}-${index}`;
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
    candidate = `${baseId}-${index}`;
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
async function readMcpServers(scope) {
  const storagePath = await resolveMcpStoragePath(scope);
  try {
    const raw = await (0, import_promises9.readFile)(storagePath, "utf-8");
    const payload = JSON.parse(raw);
    if (Array.isArray(payload)) {
      return payload.filter((item) => typeof item === "object" && item !== null);
    }
    return [];
  } catch {
    return [];
  }
}
async function writeMcpServers(scope, servers) {
  const storagePath = await resolveMcpStoragePath(scope);
  await (0, import_promises9.writeFile)(storagePath, JSON.stringify(servers, null, 2), "utf-8");
  return true;
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
async function getAllSkills(scope) {
  const skillsRoot = await resolveSkillsRoot(scope);
  const skills = await safeReadSkillsFromRoot(skillsRoot);
  return skills.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
}
async function deleteSkill(skillId, scope) {
  const skillsRoot = await resolveSkillsRoot(scope);
  const { folderName } = parseSkillId(skillId);
  const targetPath = import_node_path9.default.join(skillsRoot, folderName);
  if (!await isDirectory(targetPath)) {
    return { success: false, message: `\u6280\u80FD "${folderName}" \u4E0D\u5B58\u5728` };
  }
  await (0, import_promises9.rm)(targetPath, { recursive: true, force: true });
  return { success: true, message: `\u6280\u80FD "${folderName}" \u5DF2\u5220\u9664` };
}
async function importSkillFromFolder(sourcePath, scope) {
  const skillsRoot = await resolveSkillsRoot(scope);
  const folderName = import_node_path9.default.basename(sourcePath);
  const targetName = await resolveUniqueFolderName(folderName, skillsRoot);
  const targetPath = import_node_path9.default.join(skillsRoot, targetName);
  await (0, import_promises9.cp)(sourcePath, targetPath, { recursive: true });
  const metadata = await resolveSkillMetadata(targetPath, targetName, buildFallbackLocation(targetName));
  return {
    success: true,
    message: "\u5BFC\u5165\u6210\u529F",
    skill: metadata ? {
      id: createSkillId(targetName),
      metadata,
      path: targetPath,
      isSystem: false,
      isNew: true
    } : void 0
  };
}
async function getAllMcpServers(scope) {
  return await readMcpServers(scope);
}
async function updateMcpServerState(serverId, updates, scope) {
  const servers = await readMcpServers(scope);
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
  const written = await writeMcpServers(scope ?? {}, servers);
  if (!written) {
    return { success: false, message: "\u4FDD\u5B58 MCP \u914D\u7F6E\u5931\u8D25\u3002" };
  }
  return { success: true, message: "\u66F4\u65B0\u6210\u529F" };
}
async function createMcpServer(input, scope) {
  const normalized = normalizeMcpInput(input);
  if (!normalized.name) {
    return { success: false, message: "\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A" };
  }
  const servers = await readMcpServers(scope);
  const existing = new Set(servers.map((item) => item.id));
  const baseId = slugifyId(normalized.name);
  const id = ensureUniqueId(baseId, existing);
  const server = {
    id,
    ...normalized
  };
  servers.push(server);
  const written = await writeMcpServers(scope ?? {}, servers);
  if (!written) {
    return { success: false, message: "\u4FDD\u5B58 MCP \u914D\u7F6E\u5931\u8D25\u3002" };
  }
  return { success: true, server };
}
async function deleteMcpServer(serverId, scope) {
  const servers = await readMcpServers(scope);
  const next = servers.filter((item) => item.id !== serverId);
  if (next.length === servers.length) {
    return { success: false, message: `MCP \u670D\u52A1\u5668 "${serverId}" \u4E0D\u5B58\u5728` };
  }
  const written = await writeMcpServers(scope ?? {}, next);
  if (!written) {
    return { success: false, message: "\u4FDD\u5B58 MCP \u914D\u7F6E\u5931\u8D25\u3002" };
  }
  return { success: true };
}
async function importMcpServers(input, scope) {
  try {
    const incoming = parseMcpImportPayload(input);
    if (incoming.length === 0) {
      return { success: false, message: "\u672A\u89E3\u6790\u5230\u6709\u6548\u7684 MCP \u914D\u7F6E" };
    }
    const servers = await readMcpServers(scope);
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
    const written = await writeMcpServers(scope ?? {}, servers);
    if (!written) {
      return { success: false, message: "\u4FDD\u5B58 MCP \u914D\u7F6E\u5931\u8D25\u3002" };
    }
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
function toSkillScope(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const record = payload;
  return {
    agentId: typeof record.agentId === "string" ? record.agentId : void 0,
    homeDirOverride: typeof record.homeDirOverride === "string" ? record.homeDirOverride : void 0
  };
}
function toMcpScope(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const record = payload;
  return {
    agentId: typeof record.agentId === "string" ? record.agentId : void 0,
    homeDirOverride: typeof record.homeDirOverride === "string" ? record.homeDirOverride : void 0
  };
}
function createSkillsMcpIpcHandlers() {
  return {
    // ==================== Skills ====================
    [SKILLS_MCP_CHANNELS.SKILLS_LIST]: async (_event, payload) => {
      return await getAllSkills(toSkillScope(payload));
    },
    [SKILLS_MCP_CHANNELS.SKILLS_DELETE]: async (_event, payload) => {
      if (typeof payload === "string") {
        return await deleteSkill(payload, {});
      }
      return await deleteSkill(payload.skillId, toSkillScope(payload));
    },
    [SKILLS_MCP_CHANNELS.SKILLS_REFRESH]: async (_event, payload) => {
      return await getAllSkills(toSkillScope(payload));
    },
    [SKILLS_MCP_CHANNELS.SKILLS_IMPORT]: async (event, input) => {
      const scope = toSkillScope(input);
      let sourcePath = input?.sourcePath;
      if (!sourcePath) {
        const browserWindow = import_electron3.BrowserWindow.fromWebContents(event.sender);
        const result = browserWindow ? await import_electron3.dialog.showOpenDialog(browserWindow, { properties: ["openDirectory"] }) : await import_electron3.dialog.showOpenDialog({ properties: ["openDirectory"] });
        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, message: "\u5DF2\u53D6\u6D88" };
        }
        sourcePath = result.filePaths[0];
      }
      if (!sourcePath) {
        return { success: false, message: "\u672A\u9009\u62E9\u8DEF\u5F84" };
      }
      return await importSkillFromFolder(sourcePath, scope);
    },
    // ==================== MCP ====================
    [SKILLS_MCP_CHANNELS.MCP_LIST]: async (_event, payload) => {
      return await getAllMcpServers(toMcpScope(payload));
    },
    [SKILLS_MCP_CHANNELS.MCP_CREATE]: async (_event, payload) => {
      const { agentId, homeDirOverride, ...input } = payload;
      return await createMcpServer(input, { agentId, homeDirOverride });
    },
    [SKILLS_MCP_CHANNELS.MCP_IMPORT]: async (_event, input) => {
      const { agentId, homeDirOverride, ...rest } = input;
      return await importMcpServers(rest, { agentId, homeDirOverride });
    },
    [SKILLS_MCP_CHANNELS.MCP_DELETE]: async (_event, payload) => {
      if (typeof payload === "string") {
        return await deleteMcpServer(payload, {});
      }
      return await deleteMcpServer(payload.serverId, toMcpScope(payload));
    },
    [SKILLS_MCP_CHANNELS.MCP_UPDATE]: async (_event, payload) => {
      return await updateMcpServerState(payload.serverId, payload.updates, toMcpScope(payload));
    },
    [SKILLS_MCP_CHANNELS.MCP_REFRESH]: async (_event, payload) => {
      return await getAllMcpServers(toMcpScope(payload));
    }
  };
}
function registerSkillsMcpIpcHandlers() {
  const handlers = createSkillsMcpIpcHandlers();
  Object.entries(handlers).forEach(([channel, handler]) => {
    import_electron3.ipcMain.handle(channel, handler);
  });
  console.log("[Skills-MCP] IPC handlers \u5DF2\u6CE8\u518C");
}

// src/main/register-live2d-ipc.ts
var import_electron5 = require("electron");

// src/main/live2d-service.ts
var import_electron4 = require("electron");
var import_promises10 = __toESM(require("node:fs/promises"), 1);
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path10 = __toESM(require("node:path"), 1);
async function parseAndCompleteLive2dConfig(modelDir, folderName, modelJsonFile) {
  const jsonPath = import_node_path10.default.join(modelDir, modelJsonFile);
  const content = await import_promises10.default.readFile(jsonPath, "utf8");
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
  const customConfigPath = import_node_path10.default.join(modelDir, "live2d_custom_config.json");
  if (import_node_fs2.default.existsSync(customConfigPath)) {
    try {
      const customContent = await import_promises10.default.readFile(customConfigPath, "utf8");
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
  const { filePaths } = await import_electron4.dialog.showOpenDialog({
    title: "Select Live2D Model Folder",
    properties: ["openDirectory"]
  });
  if (!filePaths || filePaths.length === 0) {
    return { success: false, message: "\u672A\u9009\u62E9\u4EFB\u4F55\u6587\u4EF6\u5939" };
  }
  const sourceDir = filePaths[0];
  const folderName = import_node_path10.default.basename(sourceDir);
  const shared = await ensureSharedWorkspace();
  const targetDir = import_node_path10.default.join(shared.sharedModelsRoot, folderName);
  if (import_node_fs2.default.existsSync(targetDir)) {
    return { success: false, message: "\u8BE5\u6A21\u578B\u6587\u4EF6\u5939\u5DF2\u5B58\u5728" };
  }
  const files = await import_promises10.default.readdir(sourceDir);
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
    await import_promises10.default.cp(sourceDir, targetDir, { recursive: true });
    const config = await parseAndCompleteLive2dConfig(targetDir, folderName, modelJsonFile);
    return { success: true, model: config };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
async function listLive2dModels() {
  const shared = await ensureSharedWorkspace();
  const models = [];
  if (!import_node_fs2.default.existsSync(shared.sharedModelsRoot)) {
    return [];
  }
  const folders = await import_promises10.default.readdir(shared.sharedModelsRoot);
  for (const folder of folders) {
    const modelDir = import_node_path10.default.join(shared.sharedModelsRoot, folder);
    const stat4 = await import_promises10.default.stat(modelDir);
    if (!stat4.isDirectory()) continue;
    const files = await import_promises10.default.readdir(modelDir);
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
    const modelDir = import_node_path10.default.join(shared.sharedModelsRoot, input.modelId);
    if (!import_node_fs2.default.existsSync(modelDir)) {
      return { success: false, message: "Model directory not found" };
    }
    const customConfigPath = import_node_path10.default.join(modelDir, "live2d_custom_config.json");
    const saveData = {
      modelId: input.modelId,
      motions: input.motions,
      expressions: input.expressions
    };
    await import_promises10.default.writeFile(customConfigPath, JSON.stringify(saveData, null, 2), "utf8");
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
    const targetDir = import_node_path10.default.join(shared.sharedModelsRoot, folderName);
    if (import_node_fs2.default.existsSync(targetDir)) {
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
    await import_promises10.default.mkdir(targetDir, { recursive: true });
    for (const item of filesToDownload) {
      const relativePath = item.path.substring(cleanTargetPath.length + 1);
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
      const destPath = import_node_path10.default.join(targetDir, relativePath);
      await import_promises10.default.mkdir(import_node_path10.default.dirname(destPath), { recursive: true });
      const fileRes = await fetch(rawUrl);
      if (!fileRes.ok) throw new Error(`\u65E0\u6CD5\u4E0B\u8F7D\u6587\u4EF6: ${relativePath}`);
      const buffer = await fileRes.arrayBuffer();
      await import_promises10.default.writeFile(destPath, Buffer.from(buffer));
    }
    const downloadedFiles = await import_promises10.default.readdir(targetDir);
    const modelJsonFile = downloadedFiles.find((f) => f.endsWith(".model3.json") || f.endsWith("model.json"));
    if (!modelJsonFile) {
      await import_promises10.default.rm(targetDir, { recursive: true, force: true });
      return { success: false, message: "\u6240\u9009\u6587\u4EF6\u5939\u4E2D\u672A\u627E\u5230 model.json \u6216 .model3.json" };
    }
    const config = await parseAndCompleteLive2dConfig(targetDir, folderName, modelJsonFile);
    return { success: true, model: config };
  } catch (error) {
    return { success: false, message: error.message || "\u7F51\u7EDC\u6216\u89E3\u6790\u9519\u8BEF" };
  }
}

// src/main/register-live2d-ipc.ts
function registerLive2dIpcHandlers() {
  import_electron5.ipcMain.handle(LIVE2D_IPC_CHANNELS.importModel, async () => {
    return await importLive2dModel();
  });
  import_electron5.ipcMain.handle(LIVE2D_IPC_CHANNELS.listModels, async () => {
    return await listLive2dModels();
  });
  import_electron5.ipcMain.handle(LIVE2D_IPC_CHANNELS.saveConfig, async (_event, payload) => {
    return await saveLive2dConfig(payload);
  });
  import_electron5.ipcMain.handle(LIVE2D_IPC_CHANNELS.downloadGithub, async (_event, payload) => {
    return await downloadGithubLive2dModel(payload.url);
  });
}

// src/main/esbuild-compiler.ts
var import_promises11 = require("node:fs/promises");
var import_node_path11 = __toESM(require("node:path"), 1);
var esbuild = __toESM(require("esbuild"), 1);
async function findComponentInDir(dir, componentName) {
  try {
    const { readdir: readdir5 } = await import("node:fs/promises");
    const entries = await readdir5(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = import_node_path11.default.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await findComponentInDir(fullPath, componentName);
        if (found) return found;
      } else if (entry.isFile()) {
        const ext = import_node_path11.default.extname(entry.name);
        const base = import_node_path11.default.basename(entry.name, ext);
        if (base.toLowerCase() === componentName.toLowerCase() && (ext === ".tsx" || ext === ".jsx")) {
          return fullPath;
        }
        if ((entry.name.toLowerCase() === "index.tsx" || entry.name.toLowerCase() === "index.jsx") && import_node_path11.default.basename(dir).toLowerCase() === componentName.toLowerCase()) {
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
async function resolveComponentPath(componentName, agentId) {
  const skills = await getAllSkills(agentId ? { agentId } : void 0);
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
    const agentId = url.searchParams.get("agentId")?.trim();
    let componentName = (url.hostname + url.pathname).replace(/^\/|\/$/g, "");
    componentName = componentName.replace(/\/main\.js$/, "").replace(/\/index\.js$/, "").replace(/\.(js|jsx|ts|tsx)$/, "");
    console.log(`[SkillProtocol][#${rid}] Targeted component identifier: "${componentName}"`);
    if (!componentName) {
      return new Response("Missing component name", { status: 400 });
    }
    const filePath = await resolveComponentPath(componentName, agentId);
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
var __filename = (0, import_node_url2.fileURLToPath)(import_meta_url);
var __dirname = import_node_path12.default.dirname(__filename);
var preloadPathCandidates = [
  import_node_path12.default.join(__dirname, "../preload/index.cjs"),
  import_node_path12.default.join(process.cwd(), "src", "preload", "index.cjs"),
  import_node_path12.default.join(process.cwd(), "preload", "index.cjs")
];
var preloadPath = preloadPathCandidates.find((candidate) => import_node_fs3.default.existsSync(candidate)) ?? preloadPathCandidates[0];
var tray = null;
var isQuitting = false;
import_electron6.protocol.registerSchemesAsPrivileged([
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
  registerSettingsIpcHandlers(import_electron6.ipcMain);
  registerAgentIpcHandlers(import_electron6.ipcMain);
  registerSkillsMcpIpcHandlers();
  registerLive2dIpcHandlers();
}
function resolveTrayIcon() {
  const iconPath = import_node_path12.default.join(import_electron6.app.getAppPath(), "public", "vite.svg");
  const icon = import_electron6.nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    return import_electron6.nativeImage.createEmpty();
  }
  return icon;
}
function createTray(mainWindow) {
  if (tray) return;
  tray = new import_electron6.Tray(resolveTrayIcon());
  tray.setToolTip("weBot");
  const menu = import_electron6.Menu.buildFromTemplate([
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
        import_electron6.app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    mainWindow.show();
  });
}
function createMainWindow() {
  const win = new import_electron6.BrowserWindow({
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
  const devServerUrl = "http://localhost:5173";
  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(import_node_path12.default.join(__dirname, "../../dist/index.html"));
  }
  createTray(win);
}
import_electron6.app.whenReady().then(() => {
  try {
    import_electron6.protocol.handle("skill", handleSkillRequest);
    import_electron6.protocol.handle("webot-model", (req) => {
      try {
        const url = new URL(req.url);
        const modelPath = import_node_path12.default.join(import_electron6.app.getPath("userData"), "models", url.hostname, decodeURIComponent(url.pathname));
        return import_electron6.net.fetch("file://" + modelPath);
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
  import_electron6.app.on("activate", () => {
    if (import_electron6.BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
import_electron6.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    import_electron6.app.quit();
  }
});
import_electron6.app.on("before-quit", () => {
  isQuitting = true;
  stopAllAgentRuntimes();
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL21haW4vZWxlY3Ryb24tbWFpbi50cyIsICIuLi9zcmMvbWFpbi9pcGMtY29udHJhY3QudHMiLCAiLi4vc3JjL21haW4vYWdlbnQtcHJvZmlsZS1zZXJ2aWNlLnRzIiwgIi4uL3NyYy9tYWluL2FnZW50LWNvbmZpZy1tYW5hZ2VyLnRzIiwgIi4uL3NyYy9tYWluL3NoYXJlZC13b3Jrc3BhY2UtbWFuYWdlci50cyIsICIuLi9zcmMvbWFpbi96ZXJvY2xhdy1jb25maWctbWFuYWdlci50cyIsICIuLi9zcmMvbWFpbi9tb2RlbC1wcm92aWRlci1jYXRhbG9nLnRzIiwgIi4uL3NyYy9tYWluL2FnZW50LXJ1bnRpbWUtc2VydmljZS50cyIsICIuLi9zcmMvbWFpbi9hZ2VudC1jb2xsYWJvcmF0aW9uLWV2ZW50LXNlcnZpY2UudHMiLCAiLi4vbm9kZV9tb2R1bGVzL0Bqc29uLXJlbmRlci9jb3JlL3NyYy90eXBlcy50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3N0YXRlLXN0b3JlLnRzIiwgIi4uL25vZGVfbW9kdWxlcy9AanNvbi1yZW5kZXIvY29yZS9zcmMvdmlzaWJpbGl0eS50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3Byb3BzLnRzIiwgIi4uL25vZGVfbW9kdWxlcy9AanNvbi1yZW5kZXIvY29yZS9zcmMvYWN0aW9ucy50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3ZhbGlkYXRpb24udHMiLCAiLi4vbm9kZV9tb2R1bGVzL0Bqc29uLXJlbmRlci9jb3JlL3NyYy9zcGVjLXZhbGlkYXRvci50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3NjaGVtYS50cyIsICIuLi9ub2RlX21vZHVsZXMvQGpzb24tcmVuZGVyL2NvcmUvc3JjL3Byb21wdC50cyIsICIuLi9zcmMvbWFpbi9hZ2VudC1ub3RpZmljYXRpb24tc2VydmljZS50cyIsICIuLi9zcmMvbWFpbi9hZ2VudC1jaGF0LXNlcnZpY2UudHMiLCAiLi4vc3JjL21haW4vYWdlbnQtdGFzay1zZXJ2aWNlLnRzIiwgIi4uL3NyYy9tYWluL2FnZW50LWFwaS50cyIsICIuLi9zcmMvbWFpbi9yZWdpc3Rlci1hZ2VudC1pcGMudHMiLCAiLi4vc3JjL21haW4vcHJvdmlkZXItc2V0dGluZ3Mtc2VydmljZS50cyIsICIuLi9zcmMvbWFpbi9zeXN0ZW0tc2V0dGluZ3Mtc2VydmljZS50cyIsICIuLi9zcmMvbWFpbi9zZXR0aW5ncy1hcGkudHMiLCAiLi4vc3JjL21haW4vcmVnaXN0ZXItc2V0dGluZ3MtaXBjLnRzIiwgIi4uL3NyYy9tYWluL3JlZ2lzdGVyLXNraWxscy1tY3AtaXBjLnRzIiwgIi4uL3NyYy9tYWluL3NraWxscy1tY3Atc2VydmljZS50cyIsICIuLi9zcmMvbWFpbi9za2lsbHMtbWNwLXR5cGVzLnRzIiwgIi4uL3NyYy9tYWluL3JlZ2lzdGVyLWxpdmUyZC1pcGMudHMiLCAiLi4vc3JjL21haW4vbGl2ZTJkLXNlcnZpY2UudHMiLCAiLi4vc3JjL21haW4vZXNidWlsZC1jb21waWxlci50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tICdub2RlOnVybCc7XG5cbmltcG9ydCB7IGFwcCwgQnJvd3NlcldpbmRvdywgaXBjTWFpbiwgTWVudSwgVHJheSwgbmF0aXZlSW1hZ2UsIHByb3RvY29sLCBuZXQgfSBmcm9tICdlbGVjdHJvbic7XG5pbXBvcnQgdHlwZSB7IEV2ZW50LCBOYXRpdmVJbWFnZSB9IGZyb20gJ2VsZWN0cm9uJztcblxuaW1wb3J0IHsgcmVnaXN0ZXJBZ2VudElwY0hhbmRsZXJzIH0gZnJvbSAnLi9yZWdpc3Rlci1hZ2VudC1pcGMnO1xuaW1wb3J0IHsgcmVnaXN0ZXJTZXR0aW5nc0lwY0hhbmRsZXJzIH0gZnJvbSAnLi9yZWdpc3Rlci1zZXR0aW5ncy1pcGMnO1xuaW1wb3J0IHsgcmVnaXN0ZXJTa2lsbHNNY3BJcGNIYW5kbGVycyB9IGZyb20gJy4vcmVnaXN0ZXItc2tpbGxzLW1jcC1pcGMnO1xuaW1wb3J0IHsgcmVnaXN0ZXJMaXZlMmRJcGNIYW5kbGVycyB9IGZyb20gJy4vcmVnaXN0ZXItbGl2ZTJkLWlwYyc7XG5pbXBvcnQgeyBoYW5kbGVTa2lsbFJlcXVlc3QgfSBmcm9tICcuL2VzYnVpbGQtY29tcGlsZXInO1xuaW1wb3J0IHsgc3RvcEFsbEFnZW50UnVudGltZXMgfSBmcm9tICcuL2FnZW50LXJ1bnRpbWUtc2VydmljZSc7XG5cbmNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoX19maWxlbmFtZSk7XG5jb25zdCBwcmVsb2FkUGF0aENhbmRpZGF0ZXMgPSBbXG4gIHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9wcmVsb2FkL2luZGV4LmNqcycpLFxuICBwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwgJ3NyYycsICdwcmVsb2FkJywgJ2luZGV4LmNqcycpLFxuICBwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwgJ3ByZWxvYWQnLCAnaW5kZXguY2pzJyksXG5dO1xuY29uc3QgcHJlbG9hZFBhdGggPVxuICBwcmVsb2FkUGF0aENhbmRpZGF0ZXMuZmluZCgoY2FuZGlkYXRlKSA9PiBmcy5leGlzdHNTeW5jKGNhbmRpZGF0ZSkpID8/XG4gIHByZWxvYWRQYXRoQ2FuZGlkYXRlc1swXTtcbmxldCB0cmF5OiBUcmF5IHwgbnVsbCA9IG51bGw7XG5sZXQgaXNRdWl0dGluZyA9IGZhbHNlO1xuXG5wcm90b2NvbC5yZWdpc3RlclNjaGVtZXNBc1ByaXZpbGVnZWQoW1xuICB7XG4gICAgc2NoZW1lOiAnc2tpbGwnLFxuICAgIHByaXZpbGVnZXM6IHtcbiAgICAgIHN0YW5kYXJkOiB0cnVlLFxuICAgICAgc2VjdXJlOiB0cnVlLFxuICAgICAgc3VwcG9ydEZldGNoQVBJOiB0cnVlLFxuICAgICAgY29yc0VuYWJsZWQ6IHRydWUsXG4gICAgICBieXBhc3NDU1A6IHRydWVcbiAgICB9XG4gIH0sXG4gIHtcbiAgICBzY2hlbWU6ICd3ZWJvdC1tb2RlbCcsXG4gICAgcHJpdmlsZWdlczoge1xuICAgICAgc3RhbmRhcmQ6IHRydWUsXG4gICAgICBzZWN1cmU6IHRydWUsXG4gICAgICBzdXBwb3J0RmV0Y2hBUEk6IHRydWUsXG4gICAgICBjb3JzRW5hYmxlZDogdHJ1ZSxcbiAgICAgIGJ5cGFzc0NTUDogdHJ1ZVxuICAgIH1cbiAgfVxuXSk7XG5cbmZ1bmN0aW9uIHJlZ2lzdGVySXBjSGFuZGxlcnMoKSB7XG4gIHJlZ2lzdGVyU2V0dGluZ3NJcGNIYW5kbGVycyhpcGNNYWluKTtcbiAgcmVnaXN0ZXJBZ2VudElwY0hhbmRsZXJzKGlwY01haW4pO1xuICByZWdpc3RlclNraWxsc01jcElwY0hhbmRsZXJzKCk7XG4gIHJlZ2lzdGVyTGl2ZTJkSXBjSGFuZGxlcnMoKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZVRyYXlJY29uKCk6IE5hdGl2ZUltYWdlIHtcbiAgY29uc3QgaWNvblBhdGggPSBwYXRoLmpvaW4oYXBwLmdldEFwcFBhdGgoKSwgJ3B1YmxpYycsICd2aXRlLnN2ZycpO1xuICBjb25zdCBpY29uID0gbmF0aXZlSW1hZ2UuY3JlYXRlRnJvbVBhdGgoaWNvblBhdGgpO1xuICBpZiAoaWNvbi5pc0VtcHR5KCkpIHtcbiAgICByZXR1cm4gbmF0aXZlSW1hZ2UuY3JlYXRlRW1wdHkoKTtcbiAgfVxuICByZXR1cm4gaWNvbjtcbn1cblxuZnVuY3Rpb24gY3JlYXRlVHJheShtYWluV2luZG93OiBCcm93c2VyV2luZG93KSB7XG4gIGlmICh0cmF5KSByZXR1cm47XG4gIHRyYXkgPSBuZXcgVHJheShyZXNvbHZlVHJheUljb24oKSk7XG4gIHRyYXkuc2V0VG9vbFRpcCgnd2VCb3QnKTtcblxuICBjb25zdCBtZW51ID0gTWVudS5idWlsZEZyb21UZW1wbGF0ZShbXG4gICAge1xuICAgICAgbGFiZWw6ICdcdTYyNTNcdTVGMDAgd2VCb3QnLFxuICAgICAgY2xpY2s6ICgpID0+IHtcbiAgICAgICAgbWFpbldpbmRvdy5zaG93KCk7XG4gICAgICB9LFxuICAgIH0sXG4gICAge1xuICAgICAgbGFiZWw6ICdcdTUwNUNcdTZCNjJcdTUxNjhcdTkwRThcdTY2N0FcdTgwRkRcdTRGNTMnLFxuICAgICAgY2xpY2s6ICgpID0+IHtcbiAgICAgICAgc3RvcEFsbEFnZW50UnVudGltZXMoKTtcbiAgICAgIH0sXG4gICAgfSxcbiAgICB7IHR5cGU6ICdzZXBhcmF0b3InIH0sXG4gICAge1xuICAgICAgbGFiZWw6ICdcdTkwMDBcdTUxRkEnLFxuICAgICAgY2xpY2s6ICgpID0+IHtcbiAgICAgICAgaXNRdWl0dGluZyA9IHRydWU7XG4gICAgICAgIHN0b3BBbGxBZ2VudFJ1bnRpbWVzKCk7XG4gICAgICAgIGFwcC5xdWl0KCk7XG4gICAgICB9LFxuICAgIH0sXG4gIF0pO1xuXG4gIHRyYXkuc2V0Q29udGV4dE1lbnUobWVudSk7XG4gIHRyYXkub24oJ2NsaWNrJywgKCkgPT4ge1xuICAgIG1haW5XaW5kb3cuc2hvdygpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTWFpbldpbmRvdygpIHtcbiAgY29uc3Qgd2luID0gbmV3IEJyb3dzZXJXaW5kb3coe1xuICAgIHdpZHRoOiAxMjAwLFxuICAgIGhlaWdodDogODYwLFxuICAgIG1pbldpZHRoOiAxMTAwLFxuICAgIG1pbkhlaWdodDogNzIwLFxuICAgIHNob3c6IGZhbHNlLFxuICAgIGJhY2tncm91bmRDb2xvcjogJyNmZmZmZmYnLFxuICAgIHdlYlByZWZlcmVuY2VzOiB7XG4gICAgICBwcmVsb2FkOiBwcmVsb2FkUGF0aCxcbiAgICAgIGNvbnRleHRJc29sYXRpb246IHRydWUsXG4gICAgICBub2RlSW50ZWdyYXRpb246IGZhbHNlLFxuICAgIH0sXG4gIH0pO1xuXG4gIHdpbi5vbmNlKCdyZWFkeS10by1zaG93JywgKCkgPT4ge1xuICAgIHdpbi5zaG93KCk7XG4gIH0pO1xuXG4gIHdpbi5vbignY2xvc2UnLCAoZXZlbnQ6IEV2ZW50KSA9PiB7XG4gICAgaWYgKCFpc1F1aXR0aW5nKSB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgd2luLmhpZGUoKTtcbiAgICB9XG4gIH0pO1xuXG4gIGNvbnN0IGRldlNlcnZlclVybCA9IHByb2Nlc3MuZW52LlZJVEVfREVWX1NFUlZFUl9VUkw7XG4gIGlmIChkZXZTZXJ2ZXJVcmwpIHtcbiAgICB3aW4ubG9hZFVSTChkZXZTZXJ2ZXJVcmwpO1xuICAgIHdpbi53ZWJDb250ZW50cy5vcGVuRGV2VG9vbHMoeyBtb2RlOiAnZGV0YWNoJyB9KTtcbiAgfSBlbHNlIHtcbiAgICB3aW4ubG9hZEZpbGUocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2Rpc3QvaW5kZXguaHRtbCcpKTtcbiAgfVxuXG4gIGNyZWF0ZVRyYXkod2luKTtcbn1cblxuYXBwLndoZW5SZWFkeSgpLnRoZW4oKCkgPT4ge1xuICB0cnkge1xuICAgIHByb3RvY29sLmhhbmRsZSgnc2tpbGwnLCBoYW5kbGVTa2lsbFJlcXVlc3QpO1xuXG4gICAgLy8gXHU2MkU2XHU2MjJBIHdlYm90LW1vZGVsIFx1NTM0Rlx1OEJBRVx1NTJBMFx1OEY3RFx1NjcyQ1x1NTczMFx1NkEyMVx1NTc4Qlx1NjU4N1x1NEVGNlxuICAgIHByb3RvY29sLmhhbmRsZSgnd2Vib3QtbW9kZWwnLCAocmVxOiBSZXF1ZXN0KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcS51cmwpO1xuICAgICAgICAvLyB1cmwuaG9zdG5hbWUgaXMgdGhlIG1vZGVsIG5hbWUsIHVybC5wYXRobmFtZSBpcyB0aGUgZmlsZSBwYXRoIGluc2lkZSBtb2RlbCBmb2xkZXJcbiAgICAgICAgY29uc3QgbW9kZWxQYXRoID0gcGF0aC5qb2luKGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpLCAnbW9kZWxzJywgdXJsLmhvc3RuYW1lLCBkZWNvZGVVUklDb21wb25lbnQodXJsLnBhdGhuYW1lKSk7XG4gICAgICAgIHJldHVybiBuZXQuZmV0Y2goJ2ZpbGU6Ly8nICsgbW9kZWxQYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBoYW5kbGluZyB3ZWJvdC1tb2RlbCBwcm90b2NvbCcsIGVycik7XG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoJ05vdCBGb3VuZCcsIHsgc3RhdHVzOiA0MDQgfSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zb2xlLmxvZygnW1NraWxsUHJvdG9jb2xdIEN1c3RvbSBwcm90b2NvbCBoYW5kbGVycyByZWdpc3RlcmVkIHN1Y2Nlc3NmdWxseS4nKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1tTa2lsbFByb3RvY29sXSBGYWlsZWQgdG8gcmVnaXN0ZXIgcHJvdG9jb2wgaGFuZGxlcnM6JywgZSk7XG4gIH1cbiAgcmVnaXN0ZXJJcGNIYW5kbGVycygpO1xuICBjcmVhdGVNYWluV2luZG93KCk7XG5cbiAgYXBwLm9uKCdhY3RpdmF0ZScsICgpID0+IHtcbiAgICBpZiAoQnJvd3NlcldpbmRvdy5nZXRBbGxXaW5kb3dzKCkubGVuZ3RoID09PSAwKSB7XG4gICAgICBjcmVhdGVNYWluV2luZG93KCk7XG4gICAgfVxuICB9KTtcbn0pO1xuXG5hcHAub24oJ3dpbmRvdy1hbGwtY2xvc2VkJywgKCkgPT4ge1xuICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSAhPT0gJ2RhcndpbicpIHtcbiAgICBhcHAucXVpdCgpO1xuICB9XG59KTtcblxuYXBwLm9uKCdiZWZvcmUtcXVpdCcsICgpID0+IHtcbiAgaXNRdWl0dGluZyA9IHRydWU7XG4gIHN0b3BBbGxBZ2VudFJ1bnRpbWVzKCk7XG59KTtcbiIsICJpbXBvcnQgdHlwZSB7XG4gIEFnZW50UHJvZmlsZSxcbiAgQ29ubmVjdEN1c3RvbVByb3ZpZGVySW5wdXQsXG4gIENvbm5lY3RQcm92aWRlcklucHV0LFxuICBEaXNjb25uZWN0UHJvdmlkZXJJbnB1dCxcbiAgR2V0QWdlbnRJbnB1dCxcbiAgTGlzdEFnZW50c0lucHV0LFxuICBNb2RlbFNldHRpbmdzUmVzcG9uc2UsXG4gIFByb3ZpZGVyU2V0dGluZ3NSZXNwb25zZSxcbiAgUmVmcmVzaFByb3ZpZGVyTW9kZWxzSW5wdXQsXG4gIFJlZnJlc2hQcm92aWRlck1vZGVsc1Jlc3VsdCxcbiAgU2F2ZUFnZW50SW5wdXQsXG4gIFNhdmVBZ2VudFJlc3VsdCxcbiAgU3RhcnRBZ2VudElucHV0LFxuICBTdGFydEFnZW50UmVzdWx0LFxuICBTdG9wQWdlbnRJbnB1dCxcbiAgU3RvcEFnZW50UmVzdWx0LFxuICBBZ2VudFJ1bnRpbWVTdGF0dXMsXG4gIEFnZW50TG9nVGFpbCxcbiAgQWdlbnRDb2xsYWJvcmF0aW9uRXZlbnQsXG4gIEFnZW50VGFza0NyZWF0ZUlucHV0LFxuICBBZ2VudFRhc2tDcmVhdGVSZXN1bHQsXG4gIEFnZW50VGFza0RlbGV0ZUlucHV0LFxuICBBZ2VudFRhc2tEZWxldGVSZXN1bHQsXG4gIEFnZW50VGFza0xpc3RJbnB1dCxcbiAgQWdlbnRUYXNrTGlzdFJlc3VsdCxcbiAgQWdlbnRUYXNrUHJvZ3Jlc3NJbnB1dCxcbiAgQWdlbnRUYXNrUHJvZ3Jlc3NSZXN1bHQsXG4gIEFnZW50Tm90aWZpY2F0aW9uTGlzdElucHV0LFxuICBBZ2VudE5vdGlmaWNhdGlvbkxpc3RSZXN1bHQsXG4gIEFnZW50Tm90aWZpY2F0aW9uTWFya1JlYWRJbnB1dCxcbiAgQWdlbnROb3RpZmljYXRpb25NYXJrUmVhZFJlc3VsdCxcbiAgU2V0RGVmYXVsdE1vZGVsSW5wdXQsXG4gIFRvZ2dsZU1vZGVsRW5hYmxlZElucHV0LFxuICBUb2dnbGVQcm92aWRlckVuYWJsZWRJbnB1dCxcbiAgVXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uSW5wdXQsXG4gIFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uLFxuICBBcHBTZXR0aW5ncyxcbiAgU2V0QXV0b0xhdW5jaElucHV0LFxuICBHZXRBZ2VudExvZ1RhaWxJbnB1dCxcbiAgR2V0QWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRzSW5wdXQsXG4gIEFnZW50Q2hhdElucHV0LFxuICBBZ2VudENoYXRSZXN1bHQsXG4gIENhbmNlbEFnZW50Q2hhdElucHV0LFxuICBDYW5jZWxBZ2VudENoYXRSZXN1bHQsXG59IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQgY29uc3QgU0VUVElOR1NfSVBDX0NIQU5ORUxTID0ge1xuICBnZXRQcm92aWRlclNldHRpbmdzOiAnc2V0dGluZ3M6Z2V0LXByb3ZpZGVyLXNldHRpbmdzJyxcbiAgY29ubmVjdFByb3ZpZGVyOiAnc2V0dGluZ3M6Y29ubmVjdC1wcm92aWRlcicsXG4gIGNvbm5lY3RDdXN0b21Qcm92aWRlcjogJ3NldHRpbmdzOmNvbm5lY3QtY3VzdG9tLXByb3ZpZGVyJyxcbiAgZGlzY29ubmVjdFByb3ZpZGVyOiAnc2V0dGluZ3M6ZGlzY29ubmVjdC1wcm92aWRlcicsXG4gIGdldE1vZGVsU2V0dGluZ3M6ICdzZXR0aW5nczpnZXQtbW9kZWwtc2V0dGluZ3MnLFxuICBzZXREZWZhdWx0TW9kZWw6ICdzZXR0aW5nczpzZXQtZGVmYXVsdC1tb2RlbCcsXG4gIHRvZ2dsZVByb3ZpZGVyRW5hYmxlZDogJ3NldHRpbmdzOnRvZ2dsZS1wcm92aWRlci1lbmFibGVkJyxcbiAgdG9nZ2xlTW9kZWxFbmFibGVkOiAnc2V0dGluZ3M6dG9nZ2xlLW1vZGVsLWVuYWJsZWQnLFxuICByZWZyZXNoUHJvdmlkZXJNb2RlbHM6ICdzZXR0aW5nczpyZWZyZXNoLXByb3ZpZGVyLW1vZGVscycsXG4gIHVwZGF0ZVByb3ZpZGVyQ29ubmVjdGlvbjogJ3NldHRpbmdzOnVwZGF0ZS1wcm92aWRlci1jb25uZWN0aW9uJyxcbiAgZ2V0QXBwU2V0dGluZ3M6ICdzZXR0aW5nczpnZXQtYXBwLXNldHRpbmdzJyxcbiAgc2V0QXV0b0xhdW5jaDogJ3NldHRpbmdzOnNldC1hdXRvLWxhdW5jaCcsXG59IGFzIGNvbnN0O1xuXG5leHBvcnQgY29uc3QgQUdFTlRfSVBDX0NIQU5ORUxTID0ge1xuICBzYXZlQWdlbnQ6ICdhZ2VudDpzYXZlJyxcbiAgZ2V0QWdlbnQ6ICdhZ2VudDpnZXQnLFxuICBsaXN0QWdlbnRzOiAnYWdlbnQ6bGlzdCcsXG4gIHN0YXJ0QWdlbnQ6ICdhZ2VudDpzdGFydCcsXG4gIHN0b3BBZ2VudDogJ2FnZW50OnN0b3AnLFxuICBhZ2VudFN0YXR1czogJ2FnZW50OnN0YXR1cycsXG4gIGFnZW50TG9nVGFpbDogJ2FnZW50OmxvZy10YWlsJyxcbiAgYWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRzOiAnYWdlbnQ6Y29sbGFib3JhdGlvbi1ldmVudHMnLFxuICBhZ2VudENoYXQ6ICdhZ2VudDpjaGF0JyxcbiAgYWdlbnRDaGF0U3RyZWFtOiAnYWdlbnQ6Y2hhdC1zdHJlYW0nLFxuICBhZ2VudENoYXRDYW5jZWw6ICdhZ2VudDpjaGF0LWNhbmNlbCcsXG4gIGFnZW50VGFza0xpc3Q6ICdhZ2VudDp0YXNrLWxpc3QnLFxuICBhZ2VudFRhc2tDcmVhdGU6ICdhZ2VudDp0YXNrLWNyZWF0ZScsXG4gIGFnZW50VGFza0RlbGV0ZTogJ2FnZW50OnRhc2stZGVsZXRlJyxcbiAgYWdlbnRUYXNrUHJvZ3Jlc3M6ICdhZ2VudDp0YXNrLXByb2dyZXNzJyxcbiAgYWdlbnROb3RpZmljYXRpb25MaXN0OiAnYWdlbnQ6bm90aWZpY2F0aW9uLWxpc3QnLFxuICBhZ2VudE5vdGlmaWNhdGlvbk1hcmtSZWFkOiAnYWdlbnQ6bm90aWZpY2F0aW9uLW1hcmstcmVhZCcsXG59IGFzIGNvbnN0O1xuXG5leHBvcnQgaW50ZXJmYWNlIFNldHRpbmdzSXBjQ29udHJhY3Qge1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldFByb3ZpZGVyU2V0dGluZ3NdOiB7XG4gICAgcmVxOiB1bmRlZmluZWQ7XG4gICAgcmVzOiBQcm92aWRlclNldHRpbmdzUmVzcG9uc2U7XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuY29ubmVjdFByb3ZpZGVyXToge1xuICAgIHJlcTogQ29ubmVjdFByb3ZpZGVySW5wdXQ7XG4gICAgcmVzOiBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbjtcbiAgfTtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5jb25uZWN0Q3VzdG9tUHJvdmlkZXJdOiB7XG4gICAgcmVxOiBDb25uZWN0Q3VzdG9tUHJvdmlkZXJJbnB1dDtcbiAgICByZXM6IFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uO1xuICB9O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmRpc2Nvbm5lY3RQcm92aWRlcl06IHtcbiAgICByZXE6IERpc2Nvbm5lY3RQcm92aWRlcklucHV0O1xuICAgIHJlczogeyBvazogdHJ1ZSB9O1xuICB9O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldE1vZGVsU2V0dGluZ3NdOiB7XG4gICAgcmVxOiB1bmRlZmluZWQ7XG4gICAgcmVzOiBNb2RlbFNldHRpbmdzUmVzcG9uc2U7XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuc2V0RGVmYXVsdE1vZGVsXToge1xuICAgIHJlcTogU2V0RGVmYXVsdE1vZGVsSW5wdXQ7XG4gICAgcmVzOiB7IG9rOiB0cnVlIH07XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlUHJvdmlkZXJFbmFibGVkXToge1xuICAgIHJlcTogVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQ7XG4gICAgcmVzOiB7IG9rOiB0cnVlIH07XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlTW9kZWxFbmFibGVkXToge1xuICAgIHJlcTogVG9nZ2xlTW9kZWxFbmFibGVkSW5wdXQ7XG4gICAgcmVzOiB7IG9rOiB0cnVlIH07XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMucmVmcmVzaFByb3ZpZGVyTW9kZWxzXToge1xuICAgIHJlcTogUmVmcmVzaFByb3ZpZGVyTW9kZWxzSW5wdXQ7XG4gICAgcmVzOiBSZWZyZXNoUHJvdmlkZXJNb2RlbHNSZXN1bHQ7XG4gIH07XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uXToge1xuICAgIHJlcTogVXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uSW5wdXQ7XG4gICAgcmVzOiBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbjtcbiAgfTtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRBcHBTZXR0aW5nc106IHtcbiAgICByZXE6IHVuZGVmaW5lZDtcbiAgICByZXM6IEFwcFNldHRpbmdzO1xuICB9O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnNldEF1dG9MYXVuY2hdOiB7XG4gICAgcmVxOiBTZXRBdXRvTGF1bmNoSW5wdXQ7XG4gICAgcmVzOiBBcHBTZXR0aW5ncztcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBZ2VudElwY0NvbnRyYWN0IHtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5zYXZlQWdlbnRdOiB7XG4gICAgcmVxOiBTYXZlQWdlbnRJbnB1dDtcbiAgICByZXM6IFNhdmVBZ2VudFJlc3VsdDtcbiAgfTtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5nZXRBZ2VudF06IHtcbiAgICByZXE6IEdldEFnZW50SW5wdXQ7XG4gICAgcmVzOiBBZ2VudFByb2ZpbGU7XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMubGlzdEFnZW50c106IHtcbiAgICByZXE6IExpc3RBZ2VudHNJbnB1dCB8IHVuZGVmaW5lZDtcbiAgICByZXM6IHJlYWRvbmx5IEFnZW50UHJvZmlsZVtdO1xuICB9O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLnN0YXJ0QWdlbnRdOiB7XG4gICAgcmVxOiBTdGFydEFnZW50SW5wdXQ7XG4gICAgcmVzOiBTdGFydEFnZW50UmVzdWx0O1xuICB9O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLnN0b3BBZ2VudF06IHtcbiAgICByZXE6IFN0b3BBZ2VudElucHV0O1xuICAgIHJlczogU3RvcEFnZW50UmVzdWx0O1xuICB9O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50U3RhdHVzXToge1xuICAgIHJlcTogeyBhZ2VudElkOiBzdHJpbmcgfTtcbiAgICByZXM6IEFnZW50UnVudGltZVN0YXR1cztcbiAgfTtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudExvZ1RhaWxdOiB7XG4gICAgcmVxOiBHZXRBZ2VudExvZ1RhaWxJbnB1dDtcbiAgICByZXM6IEFnZW50TG9nVGFpbDtcbiAgfTtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudENvbGxhYm9yYXRpb25FdmVudHNdOiB7XG4gICAgcmVxOiBHZXRBZ2VudENvbGxhYm9yYXRpb25FdmVudHNJbnB1dDtcbiAgICByZXM6IHJlYWRvbmx5IEFnZW50Q29sbGFib3JhdGlvbkV2ZW50W107XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRDaGF0XToge1xuICAgIHJlcTogQWdlbnRDaGF0SW5wdXQ7XG4gICAgcmVzOiBBZ2VudENoYXRSZXN1bHQ7XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRDaGF0Q2FuY2VsXToge1xuICAgIHJlcTogQ2FuY2VsQWdlbnRDaGF0SW5wdXQ7XG4gICAgcmVzOiBDYW5jZWxBZ2VudENoYXRSZXN1bHQ7XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRUYXNrTGlzdF06IHtcbiAgICByZXE6IEFnZW50VGFza0xpc3RJbnB1dDtcbiAgICByZXM6IEFnZW50VGFza0xpc3RSZXN1bHQ7XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRUYXNrQ3JlYXRlXToge1xuICAgIHJlcTogQWdlbnRUYXNrQ3JlYXRlSW5wdXQ7XG4gICAgcmVzOiBBZ2VudFRhc2tDcmVhdGVSZXN1bHQ7XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRUYXNrRGVsZXRlXToge1xuICAgIHJlcTogQWdlbnRUYXNrRGVsZXRlSW5wdXQ7XG4gICAgcmVzOiBBZ2VudFRhc2tEZWxldGVSZXN1bHQ7XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRUYXNrUHJvZ3Jlc3NdOiB7XG4gICAgcmVxOiBBZ2VudFRhc2tQcm9ncmVzc0lucHV0O1xuICAgIHJlczogQWdlbnRUYXNrUHJvZ3Jlc3NSZXN1bHQ7XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnROb3RpZmljYXRpb25MaXN0XToge1xuICAgIHJlcTogQWdlbnROb3RpZmljYXRpb25MaXN0SW5wdXQ7XG4gICAgcmVzOiBBZ2VudE5vdGlmaWNhdGlvbkxpc3RSZXN1bHQ7XG4gIH07XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnROb3RpZmljYXRpb25NYXJrUmVhZF06IHtcbiAgICByZXE6IEFnZW50Tm90aWZpY2F0aW9uTWFya1JlYWRJbnB1dDtcbiAgICByZXM6IEFnZW50Tm90aWZpY2F0aW9uTWFya1JlYWRSZXN1bHQ7XG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCBMSVZFMkRfSVBDX0NIQU5ORUxTID0ge1xuICBpbXBvcnRNb2RlbDogJ2xpdmUyZDppbXBvcnQtbW9kZWwnLFxuICBsaXN0TW9kZWxzOiAnbGl2ZTJkOmxpc3QtbW9kZWxzJyxcbiAgc2F2ZUNvbmZpZzogJ2xpdmUyZDpzYXZlLWNvbmZpZycsXG4gIGRvd25sb2FkR2l0aHViOiAnbGl2ZTJkOmRvd25sb2FkLWdpdGh1YicsXG59IGFzIGNvbnN0O1xuXG5leHBvcnQgaW50ZXJmYWNlIExpdmUyZElwY0NvbnRyYWN0IHtcbiAgW0xJVkUyRF9JUENfQ0hBTk5FTFMuaW1wb3J0TW9kZWxdOiB7XG4gICAgcmVxOiB1bmRlZmluZWQ7XG4gICAgcmVzOiBpbXBvcnQoJy4vdHlwZXMnKS5JbXBvcnRMaXZlMmRNb2RlbFJlc3VsdDtcbiAgfTtcbiAgW0xJVkUyRF9JUENfQ0hBTk5FTFMubGlzdE1vZGVsc106IHtcbiAgICByZXE6IHVuZGVmaW5lZDtcbiAgICByZXM6IHJlYWRvbmx5IGltcG9ydCgnLi90eXBlcycpLkxpdmUyZE1vZGVsQ29uZmlnW107XG4gIH07XG4gIFtMSVZFMkRfSVBDX0NIQU5ORUxTLnNhdmVDb25maWddOiB7XG4gICAgcmVxOiBpbXBvcnQoJy4vdHlwZXMnKS5TYXZlTGl2ZTJkQ29uZmlnSW5wdXQ7XG4gICAgcmVzOiBpbXBvcnQoJy4vdHlwZXMnKS5TYXZlTGl2ZTJkQ29uZmlnUmVzdWx0O1xuICB9O1xuICBbTElWRTJEX0lQQ19DSEFOTkVMUy5kb3dubG9hZEdpdGh1Yl06IHtcbiAgICByZXE6IHsgdXJsOiBzdHJpbmcgfTtcbiAgICByZXM6IGltcG9ydCgnLi90eXBlcycpLkltcG9ydExpdmUyZE1vZGVsUmVzdWx0O1xuICB9O1xufVxuIiwgImltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHJlYWRkaXIsIHdyaXRlRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuXG5pbXBvcnQgeyBidWlsZEFnZW50UnVudGltZUNvbmZpZywgd3JpdGVBZ2VudFJ1bnRpbWVDb25maWdGaWxlIH0gZnJvbSAnLi9hZ2VudC1jb25maWctbWFuYWdlcic7XG5pbXBvcnQgeyBlbnN1cmVBZ2VudFdvcmtzcGFjZSwgZW5zdXJlU2hhcmVkV29ya3NwYWNlIH0gZnJvbSAnLi9zaGFyZWQtd29ya3NwYWNlLW1hbmFnZXInO1xuaW1wb3J0IHsgZW5zdXJlWmVyb0NsYXdDb25maWcgfSBmcm9tICcuL3plcm9jbGF3LWNvbmZpZy1tYW5hZ2VyJztcbmltcG9ydCB0eXBlIHtcbiAgQWdlbnRJbmRleEl0ZW0sXG4gIEFnZW50UHJvZmlsZSxcbiAgQWdlbnRUZWFtTWVtYmVyLFxuICBBZ2VudFRlYW1Ub29sUGVybWlzc2lvbixcbiAgQWdlbnRzSW5kZXhGaWxlLFxuICBHZXRBZ2VudElucHV0LFxuICBMaXN0QWdlbnRzSW5wdXQsXG4gIFNhdmVBZ2VudElucHV0LFxuICBTYXZlQWdlbnRSZXN1bHQsXG59IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBBR0VOVFNfSU5ERVhfRklMRSA9ICdhZ2VudHMuaW5kZXguanNvbic7XG5jb25zdCBBR0VOVF9QUk9GSUxFX0ZJTEUgPSAnYWdlbnQucHJvZmlsZS5qc29uJztcbmNvbnN0IEFHRU5UX1BST01QVF9GSUxFID0gJ3N5c3RlbS1wcm9tcHQubWQnO1xuXG5pbnRlcmZhY2UgRGVmYXVsdEFnZW50U2VlZCB7XG4gIGFnZW50SWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICB0aXRsZTogc3RyaW5nO1xuICB0YWdzOiBzdHJpbmdbXTtcbiAgc3VtbWFyeTogc3RyaW5nO1xuICBzb3VsOiBzdHJpbmc7XG4gIHN5c3RlbVByb21wdDogc3RyaW5nO1xuICBjb2xvcjogc3RyaW5nO1xufVxuXG5jb25zdCBURUFNX1RPT0xfTkFNRV9NQVA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIHN5c19zZWFyY2g6ICdcdTdDRkJcdTdFREZcdTY0MUNcdTdEMjInLFxuICB3ZWJfcmVxdWVzdDogJ1x1N0Y1MVx1N0VEQ1x1OEJGN1x1NkM0MicsXG4gIGZpbGVfcmVhZDogJ1x1NjU4N1x1NEVGNlx1OEJGQlx1NTNENicsXG4gIGZpbGVfd3JpdGU6ICdcdTY1ODdcdTRFRjZcdTUxOTlcdTUxNjUnLFxuICBmaWxlX2RlbGV0ZTogJ1x1NjU4N1x1NEVGNlx1NTIyMFx1OTY2NCcsXG4gIG1jcF90b29sczogJ01DUCBcdTVERTVcdTUxNzcnLFxufTtcblxuZnVuY3Rpb24gbm9ybWFsaXplU3RyaW5nTGlzdCh2YWx1ZXM6IHJlYWRvbmx5IHN0cmluZ1tdIHwgdW5kZWZpbmVkKTogc3RyaW5nW10ge1xuICBpZiAoIXZhbHVlcykgcmV0dXJuIFtdO1xuICBjb25zdCBub3JtYWxpemVkID0gdmFsdWVzLm1hcCgoaXRlbSkgPT4gaXRlbS50cmltKCkpLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5sZW5ndGggPiAwKTtcbiAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldChub3JtYWxpemVkKSk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRlYW1NZW1iZXJJZChpbnB1dDogc3RyaW5nLCBmYWxsYmFja0luZGV4OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gaW5wdXRcbiAgICAudHJpbSgpXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAucmVwbGFjZSgvW15hLXowLTktX10rL2csICctJylcbiAgICAucmVwbGFjZSgvXi0rfC0rJC9nLCAnJyk7XG4gIHJldHVybiBub3JtYWxpemVkIHx8IGBtZW1iZXItJHtmYWxsYmFja0luZGV4ICsgMX1gO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVUb29sUGVybWlzc2lvbnMoXG4gIHBlcm1pc3Npb25zOiByZWFkb25seSBBZ2VudFRlYW1Ub29sUGVybWlzc2lvbltdIHwgdW5kZWZpbmVkLFxuKTogQWdlbnRUZWFtVG9vbFBlcm1pc3Npb25bXSB7XG4gIGlmICghcGVybWlzc2lvbnMpIHJldHVybiBbXTtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHBlcm1pc3Npb25zXG4gICAgLm1hcCgoaXRlbSkgPT4gKHtcbiAgICAgIGlkOiBpdGVtLmlkLnRyaW0oKSxcbiAgICAgIG5hbWU6IGl0ZW0ubmFtZS50cmltKCkgfHwgVEVBTV9UT09MX05BTUVfTUFQW2l0ZW0uaWQudHJpbSgpXSB8fCBpdGVtLmlkLnRyaW0oKSxcbiAgICAgIGVuYWJsZWQ6IGl0ZW0uZW5hYmxlZCAhPT0gZmFsc2UsXG4gICAgfSkpXG4gICAgLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5pZC5sZW5ndGggPiAwKTtcbiAgY29uc3QgdW5pcXVlID0gbmV3IE1hcDxzdHJpbmcsIEFnZW50VGVhbVRvb2xQZXJtaXNzaW9uPigpO1xuICBmb3IgKGNvbnN0IGl0ZW0gb2Ygbm9ybWFsaXplZCkge1xuICAgIHVuaXF1ZS5zZXQoaXRlbS5pZCwgaXRlbSk7XG4gIH1cbiAgcmV0dXJuIEFycmF5LmZyb20odW5pcXVlLnZhbHVlcygpKTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplVGVhbU1lbWJlcnMoXG4gIG1lbWJlcnM6IHJlYWRvbmx5IEFnZW50VGVhbU1lbWJlcltdIHwgdW5kZWZpbmVkLFxuICBmYWxsYmFja1Byb3ZpZGVySWQ6IHN0cmluZyxcbiAgZmFsbGJhY2tNb2RlbE5hbWU6IHN0cmluZyxcbik6IEFnZW50VGVhbU1lbWJlcltdIHtcbiAgaWYgKCFtZW1iZXJzIHx8IG1lbWJlcnMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG5cbiAgY29uc3QgcmVzdWx0OiBBZ2VudFRlYW1NZW1iZXJbXSA9IFtdO1xuICBjb25zdCB1c2VkSWRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgbWVtYmVycy5mb3JFYWNoKChtZW1iZXIsIGluZGV4KSA9PiB7XG4gICAgY29uc3QgbWVtYmVySWRCYXNlID0gbm9ybWFsaXplVGVhbU1lbWJlcklkKG1lbWJlci5pZCB8fCBtZW1iZXIubmFtZSB8fCAnJywgaW5kZXgpO1xuICAgIGxldCBtZW1iZXJJZCA9IG1lbWJlcklkQmFzZTtcbiAgICBsZXQgc3VmZml4ID0gMjtcbiAgICB3aGlsZSAodXNlZElkcy5oYXMobWVtYmVySWQpKSB7XG4gICAgICBtZW1iZXJJZCA9IGAke21lbWJlcklkQmFzZX0tJHtzdWZmaXh9YDtcbiAgICAgIHN1ZmZpeCArPSAxO1xuICAgIH1cbiAgICB1c2VkSWRzLmFkZChtZW1iZXJJZCk7XG5cbiAgICBjb25zdCBhbGxvd2VkVG9vbHMgPSBub3JtYWxpemVTdHJpbmdMaXN0KG1lbWJlci5hbGxvd2VkVG9vbHMpO1xuICAgIGNvbnN0IHRvb2xQZXJtaXNzaW9ucyA9IG5vcm1hbGl6ZVRvb2xQZXJtaXNzaW9ucyhtZW1iZXIudG9vbFBlcm1pc3Npb25zKTtcbiAgICBjb25zdCBtZXJnZWRBbGxvd2VkVG9vbHMgPSBhbGxvd2VkVG9vbHMubGVuZ3RoID4gMFxuICAgICAgPyBhbGxvd2VkVG9vbHNcbiAgICAgIDogdG9vbFBlcm1pc3Npb25zLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5lbmFibGVkKS5tYXAoKGl0ZW0pID0+IGl0ZW0uaWQpO1xuXG4gICAgcmVzdWx0LnB1c2goe1xuICAgICAgaWQ6IG1lbWJlcklkLFxuICAgICAgbmFtZTogbWVtYmVyLm5hbWU/LnRyaW0oKSB8fCBgXHU2MjEwXHU1NDU4ICR7aW5kZXggKyAxfWAsXG4gICAgICByb2xlOiBtZW1iZXIucm9sZT8udHJpbSgpIHx8ICdcdTVCNTBcdTY2N0FcdTgwRkRcdTRGNTMnLFxuICAgICAgYXZhdGFyVXJsOiBtZW1iZXIuYXZhdGFyVXJsPy50cmltKCkgfHwgdW5kZWZpbmVkLFxuICAgICAgc3lzdGVtUHJvbXB0OiBtZW1iZXIuc3lzdGVtUHJvbXB0Py50cmltKCkgfHwgJycsXG4gICAgICBwcm92aWRlcklkOiBtZW1iZXIucHJvdmlkZXJJZD8udHJpbSgpIHx8IGZhbGxiYWNrUHJvdmlkZXJJZCxcbiAgICAgIG1vZGVsTmFtZTogbWVtYmVyLm1vZGVsTmFtZT8udHJpbSgpIHx8IGZhbGxiYWNrTW9kZWxOYW1lLFxuICAgICAgYWxsb3dlZFRvb2xzOiBtZXJnZWRBbGxvd2VkVG9vbHMsXG4gICAgICB0b29sUGVybWlzc2lvbnMsXG4gICAgfSk7XG4gIH0pO1xuXG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRUZWFtTWVtYmVycyhwcm92aWRlcklkOiBzdHJpbmcsIG1vZGVsTmFtZTogc3RyaW5nKTogQWdlbnRUZWFtTWVtYmVyW10ge1xuICByZXR1cm4gW1xuICAgIHtcbiAgICAgIGlkOiAnZGV2ZWxvcGVyLWV4ZWN1dG9yJyxcbiAgICAgIG5hbWU6ICdcdTVGMDBcdTUzRDFcdTYyNjdcdTg4NEMnLFxuICAgICAgcm9sZTogJ1x1NUI1MFx1NjY3QVx1ODBGRFx1NEY1MycsXG4gICAgICBzeXN0ZW1Qcm9tcHQ6ICdcdTRGNjBcdTY2MkZcdTYyNjdcdTg4NENcdTVGMDBcdTUzRDFcdTYyMTBcdTU0NThcdUZGMENcdThEMUZcdThEMjNcdTYzMDlcdTcxNjdcdThEMUZcdThEMjNcdTRFQkFcdTYyQzZcdTg5RTNcdTc2ODRcdTRFRkJcdTUyQTFcdTVCOUVcdTczQjBcdTRFRTNcdTc4MDFcdTVFNzZcdTZDNDdcdTYyQTVcdTdFRDNcdTY3OUNcdTMwMDInLFxuICAgICAgcHJvdmlkZXJJZCxcbiAgICAgIG1vZGVsTmFtZSxcbiAgICAgIGFsbG93ZWRUb29sczogWydzeXNfc2VhcmNoJywgJ3dlYl9yZXF1ZXN0JywgJ2ZpbGVfcmVhZCcsICdmaWxlX3dyaXRlJywgJ21jcF90b29scyddLFxuICAgICAgdG9vbFBlcm1pc3Npb25zOiBbXG4gICAgICAgIHsgaWQ6ICdzeXNfc2VhcmNoJywgbmFtZTogVEVBTV9UT09MX05BTUVfTUFQLnN5c19zZWFyY2gsIGVuYWJsZWQ6IHRydWUgfSxcbiAgICAgICAgeyBpZDogJ3dlYl9yZXF1ZXN0JywgbmFtZTogVEVBTV9UT09MX05BTUVfTUFQLndlYl9yZXF1ZXN0LCBlbmFibGVkOiB0cnVlIH0sXG4gICAgICAgIHsgaWQ6ICdmaWxlX3JlYWQnLCBuYW1lOiBURUFNX1RPT0xfTkFNRV9NQVAuZmlsZV9yZWFkLCBlbmFibGVkOiB0cnVlIH0sXG4gICAgICAgIHsgaWQ6ICdmaWxlX3dyaXRlJywgbmFtZTogVEVBTV9UT09MX05BTUVfTUFQLmZpbGVfd3JpdGUsIGVuYWJsZWQ6IHRydWUgfSxcbiAgICAgICAgeyBpZDogJ2ZpbGVfZGVsZXRlJywgbmFtZTogVEVBTV9UT09MX05BTUVfTUFQLmZpbGVfZGVsZXRlLCBlbmFibGVkOiBmYWxzZSB9LFxuICAgICAgICB7IGlkOiAnbWNwX3Rvb2xzJywgbmFtZTogVEVBTV9UT09MX05BTUVfTUFQLm1jcF90b29scywgZW5hYmxlZDogdHJ1ZSB9LFxuICAgICAgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGlkOiAncWEtcmV2aWV3ZXInLFxuICAgICAgbmFtZTogJ1x1NkQ0Qlx1OEJENVx1OEJDNFx1NUJBMScsXG4gICAgICByb2xlOiAnXHU1QjUwXHU2NjdBXHU4MEZEXHU0RjUzJyxcbiAgICAgIHN5c3RlbVByb21wdDogJ1x1NEY2MFx1NjYyRlx1NkQ0Qlx1OEJENVx1NEUwRVx1OEJDNFx1NUJBMVx1NjIxMFx1NTQ1OFx1RkYwQ1x1OEQxRlx1OEQyM1x1OUE4Q1x1OEJDMVx1NEVBNFx1NEVEOFx1OEQyOFx1OTFDRlx1MzAwMVx1OEJDNlx1NTIyQlx1OThDRVx1OTY2OVx1NUU3Nlx1N0VEOVx1NTFGQVx1NTZERVx1NUY1Mlx1NUVGQVx1OEJBRVx1MzAwMicsXG4gICAgICBwcm92aWRlcklkLFxuICAgICAgbW9kZWxOYW1lLFxuICAgICAgYWxsb3dlZFRvb2xzOiBbJ3N5c19zZWFyY2gnLCAnZmlsZV9yZWFkJywgJ21jcF90b29scyddLFxuICAgICAgdG9vbFBlcm1pc3Npb25zOiBbXG4gICAgICAgIHsgaWQ6ICdzeXNfc2VhcmNoJywgbmFtZTogVEVBTV9UT09MX05BTUVfTUFQLnN5c19zZWFyY2gsIGVuYWJsZWQ6IHRydWUgfSxcbiAgICAgICAgeyBpZDogJ3dlYl9yZXF1ZXN0JywgbmFtZTogVEVBTV9UT09MX05BTUVfTUFQLndlYl9yZXF1ZXN0LCBlbmFibGVkOiBmYWxzZSB9LFxuICAgICAgICB7IGlkOiAnZmlsZV9yZWFkJywgbmFtZTogVEVBTV9UT09MX05BTUVfTUFQLmZpbGVfcmVhZCwgZW5hYmxlZDogdHJ1ZSB9LFxuICAgICAgICB7IGlkOiAnZmlsZV93cml0ZScsIG5hbWU6IFRFQU1fVE9PTF9OQU1FX01BUC5maWxlX3dyaXRlLCBlbmFibGVkOiBmYWxzZSB9LFxuICAgICAgICB7IGlkOiAnZmlsZV9kZWxldGUnLCBuYW1lOiBURUFNX1RPT0xfTkFNRV9NQVAuZmlsZV9kZWxldGUsIGVuYWJsZWQ6IGZhbHNlIH0sXG4gICAgICAgIHsgaWQ6ICdtY3BfdG9vbHMnLCBuYW1lOiBURUFNX1RPT0xfTkFNRV9NQVAubWNwX3Rvb2xzLCBlbmFibGVkOiB0cnVlIH0sXG4gICAgICBdLFxuICAgIH0sXG4gIF07XG59XG5cbmZ1bmN0aW9uIHNsdWdpZnkoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBpbnB1dC50cmltKCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOS1fXSsvZywgJy0nKTtcbiAgcmV0dXJuIG5vcm1hbGl6ZWQubGVuZ3RoID4gMCA/IG5vcm1hbGl6ZWQgOiAnYWdlbnQnO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlQWdlbnRJZChpbnB1dDogU2F2ZUFnZW50SW5wdXQpOiBzdHJpbmcge1xuICBpZiAodHlwZW9mIGlucHV0LmFnZW50SWQgPT09ICdzdHJpbmcnICYmIGlucHV0LmFnZW50SWQudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gc2x1Z2lmeShpbnB1dC5hZ2VudElkKTtcbiAgfVxuXG4gIGNvbnN0IHN1ZmZpeCA9IERhdGUubm93KCkudG9TdHJpbmcoMzYpO1xuICByZXR1cm4gYCR7c2x1Z2lmeShpbnB1dC5uYW1lKX0tJHtzdWZmaXh9YDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZURlZmF1bHRNb2RlbChob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPHtcbiAgcHJvdmlkZXJJZDogc3RyaW5nO1xuICBtb2RlbE5hbWU6IHN0cmluZztcbn0+IHtcbiAgY29uc3QgY29uZmlnID0gYXdhaXQgZW5zdXJlWmVyb0NsYXdDb25maWcoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgcHJlZmVycmVkTW9kZWxJZCA9XG4gICAgY29uZmlnLmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkID8/XG4gICAgY29uZmlnLm1vZGVsQ2F0YWxvZy5maW5kKChpdGVtKSA9PiBpdGVtLmVuYWJsZWQpPy5tb2RlbElkID8/XG4gICAgY29uZmlnLm1vZGVsQ2F0YWxvZ1swXT8ubW9kZWxJZDtcblxuICBpZiAoIXByZWZlcnJlZE1vZGVsSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1x1NjcyQVx1NjI3RVx1NTIzMFx1NTNFRlx1NzUyOFx1NkEyMVx1NTc4Qlx1RkYwQ1x1OEJGN1x1NTE0OFx1OTE0RFx1N0Y2RVx1NkEyMVx1NTc4Qlx1NjNEMFx1NEY5Qlx1NTU0Nlx1MzAwMicpO1xuICB9XG5cbiAgY29uc3QgbW9kZWwgPSBjb25maWcubW9kZWxDYXRhbG9nLmZpbmQoKGl0ZW0pID0+IGl0ZW0ubW9kZWxJZCA9PT0gcHJlZmVycmVkTW9kZWxJZCk7XG4gIGlmICghbW9kZWwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFx1OUVEOFx1OEJBNFx1NkEyMVx1NTc4Qlx1NEUwRFx1NTNFRlx1NzUyOFx1RkYxQSR7cHJlZmVycmVkTW9kZWxJZH1gKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHJvdmlkZXJJZDogbW9kZWwucHJvdmlkZXJJZCxcbiAgICBtb2RlbE5hbWU6IG1vZGVsLm1vZGVsTmFtZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0RGVmYXVsdEFnZW50U2VlZHMoKTogRGVmYXVsdEFnZW50U2VlZFtdIHtcbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBhZ2VudElkOiAnYWdlbnQtZGV2JyxcbiAgICAgIG5hbWU6ICdcdTVGMDBcdTUzRDEnLFxuICAgICAgdGl0bGU6ICdcdTY4MzhcdTVGQzNcdTVGMDBcdTUzRDFcdTVERTVcdTdBMEJcdTVFMDgnLFxuICAgICAgdGFnczogWydcdTVGMDBcdTUzRDEnLCAnXHU2N0I2XHU2Nzg0JywgJ1x1NEVBNFx1NEVEOCddLFxuICAgICAgc3VtbWFyeTogJ1x1OEQxRlx1OEQyM1x1NjgzOFx1NUZDM1x1NTI5Rlx1ODBGRFx1NUYwMFx1NTNEMVx1NEUwRVx1NEVBNFx1NEVEOFx1RkYwQ1x1NUYzQVx1OEMwM1x1NURFNVx1N0EwQlx1OEQyOFx1OTFDRlx1NEUwRVx1NTNFRlx1N0VGNFx1NjJBNFx1NjAyN1x1MzAwMicsXG4gICAgICBzb3VsOiAnXHU0RTI1XHU4QzI4XHU1MkExXHU1QjlFXHVGRjBDXHU5MUNEXHU4OUM2XHU3RUQzXHU2Nzg0XHU0RTBFXHU3RUM2XHU4MjgyXHVGRjBDXHU4MEZEXHU2MjhBXHU5NzAwXHU2QzQyXHU4NDNEXHU1NzMwXHU0RTNBXHU0RUUzXHU3ODAxXHUzMDAyJyxcbiAgICAgIHN5c3RlbVByb21wdDogW1xuICAgICAgICAnXHU0RjYwXHU2NjJGXHU2ODM4XHU1RkMzXHU1RjAwXHU1M0QxXHU1REU1XHU3QTBCXHU1RTA4XHVGRjBDXHU4RDFGXHU4RDIzXHU1MjlGXHU4MEZEXHU1QjlFXHU3M0IwXHU0RTBFXHU2MjgwXHU2NzJGXHU4NDNEXHU1NzMwXHUzMDAyJyxcbiAgICAgICAgJ1x1NTZERVx1N0I1NFx1OTcwMFx1NTMwNVx1NTQyQlx1NTNFRlx1NjI2N1x1ODg0Q1x1NkI2NVx1OUFBNFx1MzAwMVx1NTE3M1x1OTUyRVx1NjI4MFx1NjcyRlx1N0VDNlx1ODI4Mlx1NEUwRVx1OThDRVx1OTY2OVx1NjNEMFx1OTE5Mlx1MzAwMicsXG4gICAgICBdLmpvaW4oJ1xcbicpLFxuICAgICAgY29sb3I6ICcjNjBhNWZhJyxcbiAgICB9LFxuICBdO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZWVkRGVmYXVsdEFnZW50cyhob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPEFnZW50UHJvZmlsZVtdPiB7XG4gIGNvbnN0IHsgcHJvdmlkZXJJZCwgbW9kZWxOYW1lIH0gPSBhd2FpdCByZXNvbHZlRGVmYXVsdE1vZGVsKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IHNlZWRzID0gZ2V0RGVmYXVsdEFnZW50U2VlZHMoKTtcbiAgY29uc3QgcHJvZmlsZXM6IEFnZW50UHJvZmlsZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBzZWVkIG9mIHNlZWRzKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2F2ZUFnZW50UHJvZmlsZSh7XG4gICAgICBhZ2VudElkOiBzZWVkLmFnZW50SWQsXG4gICAgICBuYW1lOiBzZWVkLm5hbWUsXG4gICAgICB0aXRsZTogc2VlZC50aXRsZSxcbiAgICAgIHRhZ3M6IHNlZWQudGFncyxcbiAgICAgIHN1bW1hcnk6IHNlZWQuc3VtbWFyeSxcbiAgICAgIHNvdWw6IHNlZWQuc291bCxcbiAgICAgIHN5c3RlbVByb21wdDogc2VlZC5zeXN0ZW1Qcm9tcHQsXG4gICAgICBwcml2YXRlU2tpbGxzOiBbXSxcbiAgICAgIHNoYXJlZFNraWxsczogW10sXG4gICAgICBwcml2YXRlTWNwU2VydmVyczogW10sXG4gICAgICBzaGFyZWRNY3BTZXJ2ZXJzOiBbXSxcbiAgICAgIHRlYW1NZW1iZXJzOiBzZWVkLmFnZW50SWQgPT09ICdhZ2VudC1kZXYnID8gY3JlYXRlRGVmYXVsdFRlYW1NZW1iZXJzKHByb3ZpZGVySWQsIG1vZGVsTmFtZSkgOiBbXSxcbiAgICAgIGRlZmF1bHRQcm92aWRlcklkOiBwcm92aWRlcklkLFxuICAgICAgZGVmYXVsdE1vZGVsTmFtZTogbW9kZWxOYW1lLFxuICAgICAgYXZhdGFyVXJsOiB1bmRlZmluZWQsXG4gICAgICBjb2xvcjogc2VlZC5jb2xvcixcbiAgICAgIGhvbWVEaXJPdmVycmlkZSxcbiAgICB9KTtcbiAgICBwcm9maWxlcy5wdXNoKHJlc3VsdC5wcm9maWxlKTtcbiAgfVxuXG4gIHJldHVybiBwcm9maWxlcztcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVhZEpzb25GaWxlPFQ+KGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPFQgfCB1bmRlZmluZWQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByYXcgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04Jyk7XG4gICAgcmV0dXJuIEpTT04ucGFyc2UocmF3KSBhcyBUO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmICdjb2RlJyBpbiBlcnJvciAmJiBlcnJvci5jb2RlID09PSAnRU5PRU5UJykge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZUpzb25GaWxlKGZpbGVQYXRoOiBzdHJpbmcsIGRhdGE6IHVua25vd24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgbWtkaXIocGF0aC5kaXJuYW1lKGZpbGVQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGF3YWl0IHdyaXRlRmlsZShmaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkoZGF0YSwgbnVsbCwgMiksICd1dGYtOCcpO1xufVxuXG5mdW5jdGlvbiB0b0FnZW50SW5kZXhJdGVtKHByb2ZpbGU6IEFnZW50UHJvZmlsZSk6IEFnZW50SW5kZXhJdGVtIHtcbiAgcmV0dXJuIHtcbiAgICBhZ2VudElkOiBwcm9maWxlLmFnZW50SWQsXG4gICAgbmFtZTogcHJvZmlsZS5uYW1lLFxuICAgIHRpdGxlOiBwcm9maWxlLnRpdGxlLFxuICAgIHRhZ3M6IHByb2ZpbGUudGFncyxcbiAgICBzdW1tYXJ5OiBwcm9maWxlLnN1bW1hcnksXG4gICAgZGVmYXVsdFByb3ZpZGVySWQ6IHByb2ZpbGUuZGVmYXVsdExsbS5wcm92aWRlcklkLFxuICAgIGRlZmF1bHRNb2RlbE5hbWU6IHByb2ZpbGUuZGVmYXVsdExsbS5tb2RlbE5hbWUsXG4gICAgcHJvZmlsZVBhdGg6IHByb2ZpbGUucGF0aHMucHJvZmlsZVBhdGgsXG4gICAgYWdlbnRSb290OiBwcm9maWxlLnBhdGhzLmFnZW50Um9vdCxcbiAgICBjcmVhdGVkQXQ6IHByb2ZpbGUuY3JlYXRlZEF0LFxuICAgIHVwZGF0ZWRBdDogcHJvZmlsZS51cGRhdGVkQXQsXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRBZ2VudHNJbmRleEZpbGUoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxBZ2VudHNJbmRleEZpbGUgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGluZGV4UGF0aCA9IHBhdGguam9pbihzaGFyZWQuYWdlbnRzUm9vdCwgQUdFTlRTX0lOREVYX0ZJTEUpO1xuICByZXR1cm4gcmVhZEpzb25GaWxlPEFnZW50c0luZGV4RmlsZT4oaW5kZXhQYXRoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gd3JpdGVBZ2VudHNJbmRleEZpbGUoXG4gIGFnZW50czogcmVhZG9ubHkgQWdlbnRJbmRleEl0ZW1bXSxcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHNoYXJlZCA9IGF3YWl0IGVuc3VyZVNoYXJlZFdvcmtzcGFjZShob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBpbmRleFBhdGggPSBwYXRoLmpvaW4oc2hhcmVkLmFnZW50c1Jvb3QsIEFHRU5UU19JTkRFWF9GSUxFKTtcblxuICBjb25zdCBwYXlsb2FkOiBBZ2VudHNJbmRleEZpbGUgPSB7XG4gICAgdmVyc2lvbjogJzEuMCcsXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgYWdlbnRzLFxuICB9O1xuXG4gIGF3YWl0IHdyaXRlSnNvbkZpbGUoaW5kZXhQYXRoLCBwYXlsb2FkKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdXBzZXJ0QWdlbnRzSW5kZXgocHJvZmlsZTogQWdlbnRQcm9maWxlLCBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgY3VycmVudCA9IGF3YWl0IHJlYWRBZ2VudHNJbmRleEZpbGUoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgbmV4dEl0ZW0gPSB0b0FnZW50SW5kZXhJdGVtKHByb2ZpbGUpO1xuXG4gIGlmICghY3VycmVudCkge1xuICAgIGF3YWl0IHdyaXRlQWdlbnRzSW5kZXhGaWxlKFtuZXh0SXRlbV0sIGhvbWVEaXJPdmVycmlkZSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgZXhpc3RlZCA9IGN1cnJlbnQuYWdlbnRzLnNvbWUoKGl0ZW0pID0+IGl0ZW0uYWdlbnRJZCA9PT0gcHJvZmlsZS5hZ2VudElkKTtcbiAgY29uc3QgbmV4dEFnZW50cyA9IGV4aXN0ZWRcbiAgICA/IGN1cnJlbnQuYWdlbnRzLm1hcCgoaXRlbSkgPT4gKGl0ZW0uYWdlbnRJZCA9PT0gcHJvZmlsZS5hZ2VudElkID8gbmV4dEl0ZW0gOiBpdGVtKSlcbiAgICA6IFsuLi5jdXJyZW50LmFnZW50cywgbmV4dEl0ZW1dO1xuXG4gIGF3YWl0IHdyaXRlQWdlbnRzSW5kZXhGaWxlKG5leHRBZ2VudHMsIGhvbWVEaXJPdmVycmlkZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZVByb2ZpbGVUZWFtRGF0YShcbiAgcHJvZmlsZTogQWdlbnRQcm9maWxlLFxuICBwcm9maWxlUGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxBZ2VudFByb2ZpbGU+IHtcbiAgY29uc3QgdGVhbVJhdyA9IChwcm9maWxlIGFzIHVua25vd24gYXMgeyB0ZWFtPzogeyBtZW1iZXJzPzogcmVhZG9ubHkgQWdlbnRUZWFtTWVtYmVyW10gfSB9KS50ZWFtPy5tZW1iZXJzO1xuICBjb25zdCBub3JtYWxpemVkVGVhbSA9IG5vcm1hbGl6ZVRlYW1NZW1iZXJzKFxuICAgIHRlYW1SYXcsXG4gICAgcHJvZmlsZS5kZWZhdWx0TGxtLnByb3ZpZGVySWQsXG4gICAgcHJvZmlsZS5kZWZhdWx0TGxtLm1vZGVsTmFtZSxcbiAgKTtcblxuICBjb25zdCBzaG91bGRCYWNrZmlsbERlZmF1bHRzID0gcHJvZmlsZS5hZ2VudElkID09PSAnYWdlbnQtZGV2JyAmJiBub3JtYWxpemVkVGVhbS5sZW5ndGggPT09IDA7XG4gIGNvbnN0IG5leHRUZWFtID0gc2hvdWxkQmFja2ZpbGxEZWZhdWx0c1xuICAgID8gY3JlYXRlRGVmYXVsdFRlYW1NZW1iZXJzKHByb2ZpbGUuZGVmYXVsdExsbS5wcm92aWRlcklkLCBwcm9maWxlLmRlZmF1bHRMbG0ubW9kZWxOYW1lKVxuICAgIDogbm9ybWFsaXplZFRlYW07XG5cbiAgY29uc3QgbmV4dFByb2ZpbGU6IEFnZW50UHJvZmlsZSA9IHtcbiAgICAuLi5wcm9maWxlLFxuICAgIHRlYW06IHtcbiAgICAgIG1lbWJlcnM6IG5leHRUZWFtLFxuICAgIH0sXG4gIH07XG5cbiAgY29uc3QgY3VycmVudFNlcmlhbGl6ZWQgPSBKU09OLnN0cmluZ2lmeSgocHJvZmlsZSBhcyB1bmtub3duIGFzIHsgdGVhbT86IHVua25vd24gfSkudGVhbSA/PyBudWxsKTtcbiAgY29uc3QgbmV4dFNlcmlhbGl6ZWQgPSBKU09OLnN0cmluZ2lmeShuZXh0UHJvZmlsZS50ZWFtKTtcbiAgaWYgKGN1cnJlbnRTZXJpYWxpemVkICE9PSBuZXh0U2VyaWFsaXplZCkge1xuICAgIGF3YWl0IHdyaXRlSnNvbkZpbGUocHJvZmlsZVBhdGgsIG5leHRQcm9maWxlKTtcbiAgfVxuXG4gIHJldHVybiBuZXh0UHJvZmlsZTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNhdmVBZ2VudFByb2ZpbGUoaW5wdXQ6IFNhdmVBZ2VudElucHV0KTogUHJvbWlzZTxTYXZlQWdlbnRSZXN1bHQ+IHtcbiAgY29uc3QgYWdlbnRJZCA9IHJlc29sdmVBZ2VudElkKGlucHV0KTtcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICBjb25zdCB3b3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVBZ2VudFdvcmtzcGFjZShhZ2VudElkLCBpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBleGlzdGluZ1Byb2ZpbGVQYXRoID0gcGF0aC5qb2luKHdvcmtzcGFjZS5hZ2VudFJvb3QsIEFHRU5UX1BST0ZJTEVfRklMRSk7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcmVhZEpzb25GaWxlPEFnZW50UHJvZmlsZT4oZXhpc3RpbmdQcm9maWxlUGF0aCk7XG4gIGNvbnN0IHByaXZhdGVTa2lsbHMgPSBub3JtYWxpemVTdHJpbmdMaXN0KGlucHV0LnByaXZhdGVTa2lsbHMpO1xuICBjb25zdCBwcml2YXRlTWNwU2VydmVycyA9IG5vcm1hbGl6ZVN0cmluZ0xpc3QoaW5wdXQucHJpdmF0ZU1jcFNlcnZlcnMpO1xuICBjb25zdCBjdXJyZW50VGVhbU1lbWJlcnMgPSAoZXhpc3RpbmcgYXMgdW5rbm93biBhcyB7IHRlYW0/OiB7IG1lbWJlcnM/OiByZWFkb25seSBBZ2VudFRlYW1NZW1iZXJbXSB9IH0pPy50ZWFtPy5tZW1iZXJzO1xuICBjb25zdCB0ZWFtSW5wdXQgPSBpbnB1dC50ZWFtTWVtYmVycyA/PyBjdXJyZW50VGVhbU1lbWJlcnM7XG4gIGNvbnN0IHRlYW1NZW1iZXJzID0gbm9ybWFsaXplVGVhbU1lbWJlcnMoXG4gICAgdGVhbUlucHV0LFxuICAgIGlucHV0LmRlZmF1bHRQcm92aWRlcklkLFxuICAgIGlucHV0LmRlZmF1bHRNb2RlbE5hbWUsXG4gICk7XG5cbiAgY29uc3QgcnVudGltZUNvbmZpZyA9IGF3YWl0IGJ1aWxkQWdlbnRSdW50aW1lQ29uZmlnKHtcbiAgICBhZ2VudElkLFxuICAgIGRpc3BsYXlOYW1lOiBpbnB1dC5uYW1lLFxuICAgIHByb3ZpZGVySWQ6IGlucHV0LmRlZmF1bHRQcm92aWRlcklkLFxuICAgIG1vZGVsTmFtZTogaW5wdXQuZGVmYXVsdE1vZGVsTmFtZSxcbiAgICBzeXN0ZW1Qcm9tcHQ6IGlucHV0LnN5c3RlbVByb21wdCxcbiAgICBwcml2YXRlU2tpbGxzLFxuICAgIHNoYXJlZFNraWxsczogW10sXG4gICAgcHJpdmF0ZU1jcFNlcnZlcnMsXG4gICAgc2hhcmVkTWNwU2VydmVyczogW10sXG4gICAgdGVhbU1lbWJlcnMsXG4gICAgaG9tZURpck92ZXJyaWRlOiBpbnB1dC5ob21lRGlyT3ZlcnJpZGUsXG4gIH0pO1xuXG4gIGNvbnN0IHJ1bnRpbWVDb25maWdQYXRoID0gYXdhaXQgd3JpdGVBZ2VudFJ1bnRpbWVDb25maWdGaWxlKHJ1bnRpbWVDb25maWcsIGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IHN5c3RlbVByb21wdFBhdGggPSBwYXRoLmpvaW4od29ya3NwYWNlLmFnZW50Um9vdCwgQUdFTlRfUFJPTVBUX0ZJTEUpO1xuICBhd2FpdCB3cml0ZUZpbGUoc3lzdGVtUHJvbXB0UGF0aCwgaW5wdXQuc3lzdGVtUHJvbXB0LCAndXRmLTgnKTtcblxuICBjb25zdCBwcm9maWxlOiBBZ2VudFByb2ZpbGUgPSB7XG4gICAgdmVyc2lvbjogJzEuMCcsXG4gICAgYWdlbnRJZCxcbiAgICBuYW1lOiBpbnB1dC5uYW1lLFxuICAgIHRpdGxlOiBpbnB1dC50aXRsZSxcbiAgICB0YWdzOiBpbnB1dC50YWdzLFxuICAgIHN1bW1hcnk6IGlucHV0LnN1bW1hcnksXG4gICAgc291bDogaW5wdXQuc291bCxcbiAgICBzeXN0ZW1Qcm9tcHQ6IGlucHV0LnN5c3RlbVByb21wdCxcbiAgICBkZWZhdWx0TGxtOiB7XG4gICAgICBwcm92aWRlcklkOiBpbnB1dC5kZWZhdWx0UHJvdmlkZXJJZCxcbiAgICAgIG1vZGVsTmFtZTogaW5wdXQuZGVmYXVsdE1vZGVsTmFtZSxcbiAgICB9LFxuICAgIHNraWxsczoge1xuICAgICAgcHJpdmF0ZVNraWxscyxcbiAgICAgIC8vIFx1N0VERlx1NEUwMFx1NEY3Rlx1NzUyOFx1NTE2OFx1NUM0MFx1NjI4MFx1ODBGRFx1NkM2MFx1RkYwQ1x1NjY3QVx1ODBGRFx1NEY1M1x1NEVDNVx1OEJCMFx1NUY1NVx1NTQyRlx1NzUyOFx1NTIxN1x1ODg2OFx1RkYxQnNoYXJlZCBcdTVCNTdcdTZCQjVcdTRGRERcdTc1NTlcdTUxN0NcdTVCQjlcdTMwMDJcbiAgICAgIHNoYXJlZFNraWxsczogW10sXG4gICAgfSxcbiAgICBtY3A6IHtcbiAgICAgIHByaXZhdGVTZXJ2ZXJzOiBwcml2YXRlTWNwU2VydmVycyxcbiAgICAgIC8vIFx1N0VERlx1NEUwMFx1NEY3Rlx1NzUyOFx1NTE2OFx1NUM0MCBNQ1AgXHU2QzYwXHVGRjBDXHU2NjdBXHU4MEZEXHU0RjUzXHU0RUM1XHU4QkIwXHU1RjU1XHU1NDJGXHU3NTI4XHU1MjE3XHU4ODY4XHVGRjFCc2hhcmVkIFx1NUI1N1x1NkJCNVx1NEZERFx1NzU1OVx1NTE3Q1x1NUJCOVx1MzAwMlxuICAgICAgc2hhcmVkU2VydmVyczogW10sXG4gICAgfSxcbiAgICB0ZWFtOiB7XG4gICAgICBtZW1iZXJzOiB0ZWFtTWVtYmVycyxcbiAgICB9LFxuICAgIGFwcGVhcmFuY2U6IHtcbiAgICAgIGF2YXRhclVybDogaW5wdXQuYXZhdGFyVXJsLFxuICAgICAgY29sb3I6IGlucHV0LmNvbG9yLFxuICAgIH0sXG4gICAgdm9pY2U6IHtcbiAgICAgIHR0c01vZGVsOiBpbnB1dC50dHNNb2RlbCxcbiAgICAgIHR0c1ZvaWNlOiBpbnB1dC50dHNWb2ljZSxcbiAgICAgIHR0c1NwZWVkOiBpbnB1dC50dHNTcGVlZCxcbiAgICAgIHR0c1BpdGNoOiBpbnB1dC50dHNQaXRjaCxcbiAgICB9LFxuICAgIHBhdGhzOiB7XG4gICAgICBhZ2VudFJvb3Q6IHdvcmtzcGFjZS5hZ2VudFJvb3QsXG4gICAgICBwcml2YXRlU2tpbGxzUm9vdDogd29ya3NwYWNlLnByaXZhdGVTa2lsbHNSb290LFxuICAgICAgcHJpdmF0ZU1jcFJvb3Q6IHdvcmtzcGFjZS5wcml2YXRlTWNwUm9vdCxcbiAgICAgIHByaXZhdGVNZW1vcnlSb290OiB3b3Jrc3BhY2UucHJpdmF0ZU1lbW9yeVJvb3QsXG4gICAgICBwcml2YXRlRGF0YVJvb3Q6IHdvcmtzcGFjZS5wcml2YXRlRGF0YVJvb3QsXG4gICAgICBwcml2YXRlTG9nc1Jvb3Q6IHdvcmtzcGFjZS5wcml2YXRlTG9nc1Jvb3QsXG4gICAgICBwcm9maWxlUGF0aDogZXhpc3RpbmdQcm9maWxlUGF0aCxcbiAgICAgIHJ1bnRpbWVDb25maWdQYXRoLFxuICAgICAgc3lzdGVtUHJvbXB0UGF0aCxcbiAgICB9LFxuICAgIGNyZWF0ZWRBdDogZXhpc3Rpbmc/LmNyZWF0ZWRBdCA/PyBub3csXG4gICAgdXBkYXRlZEF0OiBub3csXG4gIH07XG5cbiAgYXdhaXQgd3JpdGVKc29uRmlsZShleGlzdGluZ1Byb2ZpbGVQYXRoLCBwcm9maWxlKTtcbiAgYXdhaXQgdXBzZXJ0QWdlbnRzSW5kZXgocHJvZmlsZSwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcblxuICByZXR1cm4ge1xuICAgIHByb2ZpbGUsXG4gICAgcnVudGltZUNvbmZpZyxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEFnZW50UHJvZmlsZShpbnB1dDogR2V0QWdlbnRJbnB1dCk6IFByb21pc2U8QWdlbnRQcm9maWxlPiB7XG4gIGNvbnN0IHdvcmtzcGFjZSA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKGlucHV0LmFnZW50SWQsIGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IHByb2ZpbGVQYXRoID0gcGF0aC5qb2luKHdvcmtzcGFjZS5hZ2VudFJvb3QsIEFHRU5UX1BST0ZJTEVfRklMRSk7XG4gIGNvbnN0IHByb2ZpbGUgPSBhd2FpdCByZWFkSnNvbkZpbGU8QWdlbnRQcm9maWxlPihwcm9maWxlUGF0aCk7XG5cbiAgaWYgKCFwcm9maWxlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBcdTY2N0FcdTgwRkRcdTRGNTNcdTRFMERcdTVCNThcdTU3MjhcdUZGMUEke2lucHV0LmFnZW50SWR9YCk7XG4gIH1cblxuICByZXR1cm4gZW5zdXJlUHJvZmlsZVRlYW1EYXRhKHByb2ZpbGUsIHByb2ZpbGVQYXRoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2NhbkFnZW50UHJvZmlsZXMoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxBZ2VudFByb2ZpbGVbXT4ge1xuICBjb25zdCBzaGFyZWQgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgZGlycyA9IGF3YWl0IHJlYWRkaXIoc2hhcmVkLmFnZW50c1Jvb3QsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgY29uc3QgcHJvZmlsZXM6IEFnZW50UHJvZmlsZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBkaXJzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBwcm9maWxlUGF0aCA9IHBhdGguam9pbihzaGFyZWQuYWdlbnRzUm9vdCwgZW50cnkubmFtZSwgQUdFTlRfUFJPRklMRV9GSUxFKTtcbiAgICBjb25zdCBwcm9maWxlID0gYXdhaXQgcmVhZEpzb25GaWxlPEFnZW50UHJvZmlsZT4ocHJvZmlsZVBhdGgpO1xuXG4gICAgaWYgKHByb2ZpbGUpIHtcbiAgICAgIHByb2ZpbGVzLnB1c2goYXdhaXQgZW5zdXJlUHJvZmlsZVRlYW1EYXRhKHByb2ZpbGUsIHByb2ZpbGVQYXRoKSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHByb2ZpbGVzLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiByaWdodC51cGRhdGVkQXQubG9jYWxlQ29tcGFyZShsZWZ0LnVwZGF0ZWRBdCkpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdEFnZW50UHJvZmlsZXMoaW5wdXQ/OiBMaXN0QWdlbnRzSW5wdXQpOiBQcm9taXNlPHJlYWRvbmx5IEFnZW50UHJvZmlsZVtdPiB7XG4gIGNvbnN0IGluZGV4ID0gYXdhaXQgcmVhZEFnZW50c0luZGV4RmlsZShpbnB1dD8uaG9tZURpck92ZXJyaWRlKTtcblxuICBpZiAoIWluZGV4IHx8IGluZGV4LmFnZW50cy5sZW5ndGggPT09IDApIHtcbiAgICBjb25zdCBzY2FubmVkID0gYXdhaXQgc2NhbkFnZW50UHJvZmlsZXMoaW5wdXQ/LmhvbWVEaXJPdmVycmlkZSk7XG4gICAgaWYgKHNjYW5uZWQubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHNjYW5uZWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlZWREZWZhdWx0QWdlbnRzKGlucHV0Py5ob21lRGlyT3ZlcnJpZGUpO1xuICB9XG5cbiAgY29uc3QgcHJvZmlsZXM6IEFnZW50UHJvZmlsZVtdID0gW107XG5cbiAgZm9yIChjb25zdCBpdGVtIG9mIGluZGV4LmFnZW50cykge1xuICAgIGNvbnN0IHByb2ZpbGUgPSBhd2FpdCByZWFkSnNvbkZpbGU8QWdlbnRQcm9maWxlPihpdGVtLnByb2ZpbGVQYXRoKTtcblxuICAgIGlmIChwcm9maWxlKSB7XG4gICAgICBwcm9maWxlcy5wdXNoKGF3YWl0IGVuc3VyZVByb2ZpbGVUZWFtRGF0YShwcm9maWxlLCBpdGVtLnByb2ZpbGVQYXRoKSk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHByb2ZpbGVzLmxlbmd0aCA9PT0gMCkge1xuICAgIGNvbnN0IHNjYW5uZWQgPSBhd2FpdCBzY2FuQWdlbnRQcm9maWxlcyhpbnB1dD8uaG9tZURpck92ZXJyaWRlKTtcbiAgICBpZiAoc2Nhbm5lZC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gc2Nhbm5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VlZERlZmF1bHRBZ2VudHMoaW5wdXQ/LmhvbWVEaXJPdmVycmlkZSk7XG4gIH1cblxuICByZXR1cm4gcHJvZmlsZXMuc29ydCgobGVmdCwgcmlnaHQpID0+IHJpZ2h0LnVwZGF0ZWRBdC5sb2NhbGVDb21wYXJlKGxlZnQudXBkYXRlZEF0KSk7XG59XG4iLCAiaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IG1rZGlyLCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuaW1wb3J0IHsgZW5zdXJlQWdlbnRXb3Jrc3BhY2UsIGVuc3VyZVNoYXJlZFdvcmtzcGFjZSB9IGZyb20gJy4vc2hhcmVkLXdvcmtzcGFjZS1tYW5hZ2VyJztcbmltcG9ydCB0eXBlIHsgQWdlbnRSdW50aW1lQ29uZmlnLCBCdWlsZEFnZW50Q29uZmlnSW5wdXQgfSBmcm9tICcuL3R5cGVzJztcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJ1aWxkQWdlbnRSdW50aW1lQ29uZmlnKFxuICBpbnB1dDogQnVpbGRBZ2VudENvbmZpZ0lucHV0LFxuKTogUHJvbWlzZTxBZ2VudFJ1bnRpbWVDb25maWc+IHtcbiAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGFnZW50ID0gYXdhaXQgZW5zdXJlQWdlbnRXb3Jrc3BhY2UoaW5wdXQuYWdlbnRJZCwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcblxuICByZXR1cm4ge1xuICAgIHZlcnNpb246ICcxLjAnLFxuICAgIGFnZW50SWQ6IGFnZW50LmFnZW50SWQsXG4gICAgZGlzcGxheU5hbWU6IGlucHV0LmRpc3BsYXlOYW1lLFxuICAgIGdlbmVyYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgbW9kZWw6IHtcbiAgICAgIHByb3ZpZGVySWQ6IGlucHV0LnByb3ZpZGVySWQsXG4gICAgICBtb2RlbE5hbWU6IGlucHV0Lm1vZGVsTmFtZSxcbiAgICB9LFxuICAgIHByb21wdDoge1xuICAgICAgc3lzdGVtUHJvbXB0OiBpbnB1dC5zeXN0ZW1Qcm9tcHQsXG4gICAgfSxcbiAgICBwYXRoczoge1xuICAgICAgcHJpdmF0ZVJvb3Q6IGFnZW50LmFnZW50Um9vdCxcbiAgICAgIHNoYXJlZFJvb3Q6IHNoYXJlZC5zaGFyZWRSb290LFxuICAgICAgcHJpdmF0ZVNraWxsc1Jvb3Q6IGFnZW50LnByaXZhdGVTa2lsbHNSb290LFxuICAgICAgcHJpdmF0ZU1jcFJvb3Q6IGFnZW50LnByaXZhdGVNY3BSb290LFxuICAgICAgcHJpdmF0ZU1lbW9yeVJvb3Q6IGFnZW50LnByaXZhdGVNZW1vcnlSb290LFxuICAgICAgcHJpdmF0ZURhdGFSb290OiBhZ2VudC5wcml2YXRlRGF0YVJvb3QsXG4gICAgICBwcml2YXRlTG9nc1Jvb3Q6IGFnZW50LnByaXZhdGVMb2dzUm9vdCxcbiAgICAgIHNoYXJlZFNraWxsc1Jvb3Q6IHNoYXJlZC5zaGFyZWRTa2lsbHNSb290LFxuICAgICAgc2hhcmVkTWNwUm9vdDogc2hhcmVkLnNoYXJlZE1jcFJvb3QsXG4gICAgICBzaGFyZWREYXRhUm9vdDogc2hhcmVkLnNoYXJlZERhdGFSb290LFxuICAgICAgc2hhcmVkTWVkaWFSb290OiBzaGFyZWQuc2hhcmVkTWVkaWFSb290LFxuICAgIH0sXG4gICAgc2tpbGxzOiB7XG4gICAgICBwcml2YXRlU2tpbGxzOiBpbnB1dC5wcml2YXRlU2tpbGxzID8/IFtdLFxuICAgICAgLy8gXHU3RURGXHU0RTAwXHU0RjdGXHU3NTI4XHU1MTY4XHU1QzQwXHU2MjgwXHU4MEZEXHU2QzYwXHVGRjBDXHU2NjdBXHU4MEZEXHU0RjUzXHU0RUM1XHU4QkIwXHU1RjU1XHU1NDJGXHU3NTI4XHU1MjE3XHU4ODY4XHVGRjFCc2hhcmVkIFx1NUI1N1x1NkJCNVx1NEZERFx1NzU1OVx1NTE3Q1x1NUJCOVx1MzAwMlxuICAgICAgc2hhcmVkU2tpbGxzOiBbXSxcbiAgICB9LFxuICAgIG1jcDoge1xuICAgICAgcHJpdmF0ZVNlcnZlcnM6IGlucHV0LnByaXZhdGVNY3BTZXJ2ZXJzID8/IFtdLFxuICAgICAgLy8gXHU3RURGXHU0RTAwXHU0RjdGXHU3NTI4XHU1MTY4XHU1QzQwIE1DUCBcdTZDNjBcdUZGMENcdTY2N0FcdTgwRkRcdTRGNTNcdTRFQzVcdThCQjBcdTVGNTVcdTU0MkZcdTc1MjhcdTUyMTdcdTg4NjhcdUZGMUJzaGFyZWQgXHU1QjU3XHU2QkI1XHU0RkREXHU3NTU5XHU1MTdDXHU1QkI5XHUzMDAyXG4gICAgICBzaGFyZWRTZXJ2ZXJzOiBbXSxcbiAgICB9LFxuICAgIHRlYW06IHtcbiAgICAgIG1lbWJlcnM6IGlucHV0LnRlYW1NZW1iZXJzID8/IFtdLFxuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3cml0ZUFnZW50UnVudGltZUNvbmZpZ0ZpbGUoXG4gIGNvbmZpZzogQWdlbnRSdW50aW1lQ29uZmlnLFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4gIHRhcmdldEZpbGVQYXRoPzogc3RyaW5nLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgYWdlbnRXb3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVBZ2VudFdvcmtzcGFjZShjb25maWcuYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3Qgb3V0cHV0UGF0aCA9IHRhcmdldEZpbGVQYXRoID8/IHBhdGguam9pbihhZ2VudFdvcmtzcGFjZS5hZ2VudFJvb3QsICdhZ2VudC5jb25maWcuanNvbicpO1xuXG4gIGF3YWl0IG1rZGlyKHBhdGguZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGF3YWl0IHdyaXRlRmlsZShvdXRwdXRQYXRoLCBKU09OLnN0cmluZ2lmeShjb25maWcsIG51bGwsIDIpLCAndXRmLTgnKTtcblxuICByZXR1cm4gb3V0cHV0UGF0aDtcbn1cbiIsICJpbXBvcnQgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgbWtkaXIgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuaW1wb3J0IHR5cGUgeyBBZ2VudFdvcmtzcGFjZVBhdGhzLCBTaGFyZWRXb3Jrc3BhY2VQYXRocyB9IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBXRUJPVF9IT01FX0RJUl9OQU1FID0gJy53ZWJvdCc7XG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZURpcmVjdG9yeShkaXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgbWtkaXIoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUFnZW50SWQoYWdlbnRJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGFnZW50SWQudHJpbSgpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTktX10rL2csICctJyk7XG5cbiAgaWYgKG5vcm1hbGl6ZWQubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdcdTY2N0FcdTgwRkRcdTRGNTMgSUQgXHU5NzVFXHU2Q0Q1XHVGRjFBXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHU2MjE2XHU1MTY4XHU2NjJGXHU3Mjc5XHU2QjhBXHU1QjU3XHU3QjI2XHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVXZUJvdEhvbWVSb290KGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGhvbWVSb290ID0gaG9tZURpck92ZXJyaWRlID8/IG9zLmhvbWVkaXIoKTtcbiAgcmV0dXJuIHBhdGguam9pbihob21lUm9vdCwgV0VCT1RfSE9NRV9ESVJfTkFNRSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxTaGFyZWRXb3Jrc3BhY2VQYXRocz4ge1xuICBjb25zdCB3ZWJvdEhvbWVSb290ID0gcmVzb2x2ZVdlQm90SG9tZVJvb3QoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3Qgc2hhcmVkUm9vdCA9IHBhdGguam9pbih3ZWJvdEhvbWVSb290LCAnc2hhcmVkJyk7XG4gIGNvbnN0IGFnZW50c1Jvb3QgPSBwYXRoLmpvaW4od2Vib3RIb21lUm9vdCwgJ2FnZW50cycpO1xuICBjb25zdCB6ZXJvY2xhd1Jvb3QgPSBwYXRoLmpvaW4od2Vib3RIb21lUm9vdCwgJ3plcm9jbGF3Jyk7XG4gIGNvbnN0IHNoYXJlZFNraWxsc1Jvb3QgPSBwYXRoLmpvaW4od2Vib3RIb21lUm9vdCwgJ3NraWxscycpO1xuICBjb25zdCBzaGFyZWRNY3BSb290ID0gcGF0aC5qb2luKHdlYm90SG9tZVJvb3QsICdtY3AnKTtcbiAgY29uc3Qgc2hhcmVkRGF0YVJvb3QgPSBwYXRoLmpvaW4oc2hhcmVkUm9vdCwgJ2RhdGEnKTtcbiAgY29uc3Qgc2hhcmVkTWVkaWFSb290ID0gcGF0aC5qb2luKHNoYXJlZFJvb3QsICdtZWRpYScpO1xuICBjb25zdCBzaGFyZWRNb2RlbHNSb290ID0gcGF0aC5qb2luKHNoYXJlZFJvb3QsICdtb2RlbHMnKTtcblxuICBhd2FpdCBlbnN1cmVEaXJlY3Rvcnkod2Vib3RIb21lUm9vdCk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShzaGFyZWRSb290KTtcbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KGFnZW50c1Jvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3RvcnkoemVyb2NsYXdSb290KTtcbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KHNoYXJlZFNraWxsc1Jvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3Rvcnkoc2hhcmVkTWNwUm9vdCk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShzaGFyZWREYXRhUm9vdCk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShzaGFyZWRNZWRpYVJvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3Rvcnkoc2hhcmVkTW9kZWxzUm9vdCk7XG5cbiAgcmV0dXJuIHtcbiAgICB3ZWJvdEhvbWVSb290LFxuICAgIHNoYXJlZFJvb3QsXG4gICAgYWdlbnRzUm9vdCxcbiAgICB6ZXJvY2xhd1Jvb3QsXG4gICAgc2hhcmVkU2tpbGxzUm9vdCxcbiAgICBzaGFyZWRNY3BSb290LFxuICAgIHNoYXJlZERhdGFSb290LFxuICAgIHNoYXJlZE1lZGlhUm9vdCxcbiAgICBzaGFyZWRNb2RlbHNSb290LFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5zdXJlQWdlbnRXb3Jrc3BhY2UoXG4gIGFnZW50SWQ6IHN0cmluZyxcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nLFxuKTogUHJvbWlzZTxBZ2VudFdvcmtzcGFjZVBhdGhzPiB7XG4gIGNvbnN0IHNoYXJlZCA9IGF3YWl0IGVuc3VyZVNoYXJlZFdvcmtzcGFjZShob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBub3JtYWxpemVkQWdlbnRJZCA9IG5vcm1hbGl6ZUFnZW50SWQoYWdlbnRJZCk7XG4gIGNvbnN0IGFnZW50Um9vdCA9IHBhdGguam9pbihzaGFyZWQuYWdlbnRzUm9vdCwgbm9ybWFsaXplZEFnZW50SWQpO1xuICBjb25zdCBwcml2YXRlU2tpbGxzUm9vdCA9IHBhdGguam9pbihhZ2VudFJvb3QsICdza2lsbHMnKTtcbiAgY29uc3QgcHJpdmF0ZU1jcFJvb3QgPSBwYXRoLmpvaW4oYWdlbnRSb290LCAnbWNwJyk7XG4gIGNvbnN0IHByaXZhdGVNZW1vcnlSb290ID0gcGF0aC5qb2luKGFnZW50Um9vdCwgJ21lbW9yeScpO1xuICBjb25zdCBwcml2YXRlRGF0YVJvb3QgPSBwYXRoLmpvaW4oYWdlbnRSb290LCAnZGF0YScpO1xuICBjb25zdCBwcml2YXRlTG9nc1Jvb3QgPSBwYXRoLmpvaW4oYWdlbnRSb290LCAnbG9ncycpO1xuXG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShhZ2VudFJvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3RvcnkocHJpdmF0ZU1lbW9yeVJvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3RvcnkocHJpdmF0ZURhdGFSb290KTtcbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KHByaXZhdGVMb2dzUm9vdCk7XG5cbiAgcmV0dXJuIHtcbiAgICBhZ2VudElkOiBub3JtYWxpemVkQWdlbnRJZCxcbiAgICBhZ2VudFJvb3QsXG4gICAgcHJpdmF0ZVNraWxsc1Jvb3QsXG4gICAgcHJpdmF0ZU1jcFJvb3QsXG4gICAgcHJpdmF0ZU1lbW9yeVJvb3QsXG4gICAgcHJpdmF0ZURhdGFSb290LFxuICAgIHByaXZhdGVMb2dzUm9vdCxcbiAgfTtcbn1cbiIsICJpbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgbWtkaXIsIHJlYWRGaWxlLCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuaW1wb3J0IHsgZmluZE1vZGVsUHJvdmlkZXIgfSBmcm9tICcuL21vZGVsLXByb3ZpZGVyLWNhdGFsb2cnO1xuaW1wb3J0IHsgZW5zdXJlU2hhcmVkV29ya3NwYWNlIH0gZnJvbSAnLi9zaGFyZWQtd29ya3NwYWNlLW1hbmFnZXInO1xuaW1wb3J0IHR5cGUge1xuICBCdWlsZFplcm9DbGF3Q29uZmlnSW5wdXQsXG4gIFplcm9DbGF3Q29uZmlnLFxuICBaZXJvQ2xhd01vZGVsQ2F0YWxvZ0l0ZW0sXG4gIFplcm9DbGF3TW9kZWxQcm92aWRlckNvbmZpZyxcbiAgWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24sXG59IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSA2MDBfMDAwO1xuY29uc3QgTEVHQUNZX0RFRkFVTFRfVElNRU9VVF9NUyA9IDYwXzAwMDtcbmNvbnN0IFBSRVZJT1VTX0RFRkFVTFRfVElNRU9VVF9NUyA9IDE4MF8wMDA7XG5jb25zdCBERUZBVUxUX01BWF9SRVRSSUVTID0gMjtcblxuY29uc3QgUFJPVklERVJfSUNPTl9NQVA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIG9wZW5haTogJ09BJyxcbiAgJ2F6dXJlLW9wZW5haSc6ICdBTycsXG4gIGFudGhyb3BpYzogJ0FOJyxcbiAgJ2dvb2dsZS1haSc6ICdHQScsXG4gIGRlZXBzZWVrOiAnRFMnLFxuICBxd2VuOiAnUVcnLFxuICBtb29uc2hvdDogJ01TJyxcbiAgemhpcHU6ICdaUCcsXG4gIGJhaWNodWFuOiAnQkMnLFxuICBtaW5pbWF4OiAnTU0nLFxuICAndm9sY2VuZ2luZS1hcmsnOiAnVkEnLFxuICBzaWxpY29uZmxvdzogJ1NGJyxcbiAgdG9nZXRoZXI6ICdURycsXG4gIGZpcmV3b3JrczogJ0ZXJyxcbiAgZ3JvcTogJ0dRJyxcbiAgY29oZXJlOiAnQ0gnLFxuICBtaXN0cmFsOiAnTVMnLFxuICB4YWk6ICdYQScsXG4gICdudmlkaWEtbmltJzogJ05WJyxcbiAgb3BlbnJvdXRlcjogJ09SJyxcbiAgcGVycGxleGl0eTogJ1BYJyxcbiAgb2xsYW1hOiAnT0wnLFxuICBsbXN0dWRpbzogJ0xNJyxcbiAgdmxsbTogJ1ZMJyxcbiAgJ2h1Z2dpbmdmYWNlLWluZmVyZW5jZSc6ICdIRicsXG4gICdhd3MtYmVkcm9jayc6ICdBQicsXG4gICdhenVyZS1haS1pbmZlcmVuY2UnOiAnQUknLFxuICAnYWxpYmFiYS1iYWlsaWFuJzogJ0FMJyxcbn07XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVByb3ZpZGVySWQocHJvdmlkZXJJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKHByb3ZpZGVySWQgPT09ICdudmlkaWEnKSB7XG4gICAgcmV0dXJuICdudmlkaWEtbmltJztcbiAgfVxuXG4gIHJldHVybiBwcm92aWRlcklkO1xufVxuXG5mdW5jdGlvbiBpbmZlck1vZGVsSW1hZ2VDYXBhYmlsaXR5KG1vZGVsTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGNvbnN0IGxvd2VyID0gbW9kZWxOYW1lLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBsb3dlci5pbmNsdWRlcygndmlzaW9uJykgfHwgbG93ZXIuaW5jbHVkZXMoJ3ZsJyk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkUHJvdmlkZXJJbml0aWFscyhwcm92aWRlcklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gcHJvdmlkZXJJZC50cmltKCkucmVwbGFjZSgvW15hLXowLTldKy9naSwgJyAnKTtcbiAgY29uc3QgcGFydHMgPSBub3JtYWxpemVkLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAocGFydHMubGVuZ3RoID09PSAwKSByZXR1cm4gJ0FJJztcbiAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBwYXJ0c1swXS5zbGljZSgwLCAyKS50b1VwcGVyQ2FzZSgpO1xuICB9XG4gIHJldHVybiBwYXJ0c1xuICAgIC5tYXAoKHBhcnQpID0+IHBhcnRbMF0/LnRvVXBwZXJDYXNlKCkgPz8gJycpXG4gICAgLmpvaW4oJycpXG4gICAgLnNsaWNlKDAsIDIpO1xufVxuXG5mdW5jdGlvbiBnZXRQcm92aWRlckljb24ocHJvdmlkZXJJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIFBST1ZJREVSX0lDT05fTUFQW3Byb3ZpZGVySWRdID8/IGJ1aWxkUHJvdmlkZXJJbml0aWFscyhwcm92aWRlcklkKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVaZXJvQ2xhd0NvbmZpZ1BhdGgoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKGhvbWVEaXJPdmVycmlkZSk7XG4gIHJldHVybiBwYXRoLmpvaW4oc2hhcmVkLnplcm9jbGF3Um9vdCwgJ3plcm9jbGF3LmNvbmZpZy5qc29uJyk7XG59XG5cbmZ1bmN0aW9uIGFzc2VydFByb3ZpZGVySWRzKHByb3ZpZGVySWRzOiByZWFkb25seSBzdHJpbmdbXSk6IHZvaWQge1xuICBjb25zdCB1bmtub3duUHJvdmlkZXJJZHMgPSBwcm92aWRlcklkcy5maWx0ZXIoKHByb3ZpZGVySWQpID0+ICFmaW5kTW9kZWxQcm92aWRlcihub3JtYWxpemVQcm92aWRlcklkKHByb3ZpZGVySWQpKSk7XG5cbiAgaWYgKHVua25vd25Qcm92aWRlcklkcy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBcdTVCNThcdTU3MjhcdTY3MkFcdTc3RTVcdTZBMjFcdTU3OEJcdTY3MERcdTUyQTFcdTU1NDYgSURcdUZGMUEke3Vua25vd25Qcm92aWRlcklkcy5qb2luKCcsICcpfWApO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBidWlsZFplcm9DbGF3Q29uZmlnKGlucHV0OiBCdWlsZFplcm9DbGF3Q29uZmlnSW5wdXQpOiBQcm9taXNlPFplcm9DbGF3Q29uZmlnPiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRQcm92aWRlcklkcyA9XG4gICAgaW5wdXQuZW5hYmxlZFByb3ZpZGVySWRzLmxlbmd0aCA+IDBcbiAgICAgID8gaW5wdXQuZW5hYmxlZFByb3ZpZGVySWRzLm1hcCgocHJvdmlkZXJJZCkgPT4gbm9ybWFsaXplUHJvdmlkZXJJZChwcm92aWRlcklkKSlcbiAgICAgIDogWydudmlkaWEtbmltJ107XG5cbiAgYXNzZXJ0UHJvdmlkZXJJZHMobm9ybWFsaXplZFByb3ZpZGVySWRzKTtcblxuICBjb25zdCBzaGFyZWQgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgbW9kZWxQcm92aWRlcnM6IFplcm9DbGF3TW9kZWxQcm92aWRlckNvbmZpZ1tdID0gbm9ybWFsaXplZFByb3ZpZGVySWRzLm1hcCgocHJvdmlkZXJJZCkgPT4ge1xuICAgIGNvbnN0IHByb3ZpZGVyID0gZmluZE1vZGVsUHJvdmlkZXIocHJvdmlkZXJJZCk7XG5cbiAgICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFx1NjVFMFx1NkNENVx1NjI3RVx1NTIzMFx1NkEyMVx1NTc4Qlx1NjcwRFx1NTJBMVx1NTU0Nlx1RkYxQSR7cHJvdmlkZXJJZH1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IHByb3ZpZGVyLmlkLFxuICAgICAgZGlzcGxheU5hbWU6IHByb3ZpZGVyLmRpc3BsYXlOYW1lLFxuICAgICAgYXBpQmFzZTogcHJvdmlkZXIuYXBpQmFzZSxcbiAgICAgIGFwaUtleUVudjogcHJvdmlkZXIuYXBpS2V5RW52LFxuICAgICAgbW9kZWxzOiBwcm92aWRlci5kZWZhdWx0TW9kZWxzLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICB9O1xuICB9KTtcblxuICBjb25zdCBtb2RlbENhdGFsb2c6IFplcm9DbGF3TW9kZWxDYXRhbG9nSXRlbVtdID0gbW9kZWxQcm92aWRlcnMuZmxhdE1hcCgocHJvdmlkZXIpID0+XG4gICAgcHJvdmlkZXIubW9kZWxzLm1hcCgobW9kZWxOYW1lKSA9PiAoe1xuICAgICAgbW9kZWxJZDogYCR7cHJvdmlkZXIuaWR9OiR7bW9kZWxOYW1lfWAsXG4gICAgICBwcm92aWRlcklkOiBwcm92aWRlci5pZCxcbiAgICAgIG1vZGVsTmFtZSxcbiAgICAgIGRpc3BsYXlOYW1lOiBtb2RlbE5hbWUsXG4gICAgICBjYXBhYmlsaXRpZXM6IHtcbiAgICAgICAgdGV4dDogdHJ1ZSxcbiAgICAgICAgaW1hZ2VJbnB1dDogaW5mZXJNb2RlbEltYWdlQ2FwYWJpbGl0eShtb2RlbE5hbWUpLFxuICAgICAgICBpbWFnZU91dHB1dDogZmFsc2UsXG4gICAgICAgIGF1ZGlvSW5wdXQ6IGZhbHNlLFxuICAgICAgICB0b29sQ2FsbDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgIH0pKSxcbiAgKTtcblxuICBjb25zdCBwcm92aWRlckNvbm5lY3Rpb25zOiBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbltdID0gbW9kZWxQcm92aWRlcnMubWFwKChwcm92aWRlcikgPT4gKHtcbiAgICBjb25uZWN0aW9uSWQ6IGBjb25uXyR7cHJvdmlkZXIuaWR9X2RlZmF1bHRgLFxuICAgIHByb3ZpZGVySWQ6IHByb3ZpZGVyLmlkLFxuICAgIGRpc3BsYXlOYW1lOiBwcm92aWRlci5kaXNwbGF5TmFtZSxcbiAgICBpY29uOiBnZXRQcm92aWRlckljb24ocHJvdmlkZXIuaWQpLFxuICAgIGJhZGdlOiAnYXBpX2tleScsXG4gICAgY29ubmVjdFR5cGU6ICdhcGlfa2V5JyxcbiAgICBjYW5EaXNjb25uZWN0OiB0cnVlLFxuICAgIGNvbm5lY3RlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgaGVhbHRoOiAnd2FybmluZycsXG4gICAgYXBpQmFzZTogcHJvdmlkZXIuYXBpQmFzZSxcbiAgICBhcGlLZXlNYXNrZWQ6IHVuZGVmaW5lZCxcbiAgICBhcGlLZXlQbGFpbnRleHQ6IHVuZGVmaW5lZCxcbiAgICBtb2RlbERpc2NvdmVyeToge1xuICAgICAgbW9kZTogJ2RlZmF1bHQnLFxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBzb3VyY2U6ICdjYXRhbG9nJyxcbiAgICB9LFxuICB9KSk7XG5cbiAgY29uc3QgcHJpbWFyeVByb3ZpZGVySWQgPSBub3JtYWxpemVQcm92aWRlcklkKGlucHV0LnByaW1hcnlQcm92aWRlcklkID8/IG5vcm1hbGl6ZWRQcm92aWRlcklkc1swXSk7XG4gIGNvbnN0IGRlZmF1bHRNb2RlbElkID0gbW9kZWxDYXRhbG9nLmZpbmQoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCA9PT0gcHJpbWFyeVByb3ZpZGVySWQpPy5tb2RlbElkO1xuXG4gIHJldHVybiB7XG4gICAgdmVyc2lvbjogJzEuMCcsXG4gICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBydW50aW1lOiB7XG4gICAgICB3b3Jrc3BhY2VSb290OiBzaGFyZWQud2Vib3RIb21lUm9vdCxcbiAgICAgIHNoYXJlZFJvb3Q6IHNoYXJlZC5zaGFyZWRSb290LFxuICAgICAgYWdlbnRzUm9vdDogc2hhcmVkLmFnZW50c1Jvb3QsXG4gICAgfSxcbiAgICBkZWZhdWx0czoge1xuICAgICAgcHJpbWFyeVByb3ZpZGVySWQsXG4gICAgICBkZWZhdWx0TW9kZWxJZCxcbiAgICAgIHRpbWVvdXRNczogaW5wdXQudGltZW91dE1zID8/IERFRkFVTFRfVElNRU9VVF9NUyxcbiAgICAgIG1heFJldHJpZXM6IGlucHV0Lm1heFJldHJpZXMgPz8gREVGQVVMVF9NQVhfUkVUUklFUyxcbiAgICB9LFxuICAgIG1vZGVsUHJvdmlkZXJzLFxuICAgIHByb3ZpZGVyQ29ubmVjdGlvbnMsXG4gICAgbW9kZWxDYXRhbG9nLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZFplcm9DbGF3Q29uZmlnRmlsZShcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nLFxuICB0YXJnZXRGaWxlUGF0aD86IHN0cmluZyxcbik6IFByb21pc2U8WmVyb0NsYXdDb25maWcgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgY29uZmlnUGF0aCA9IHRhcmdldEZpbGVQYXRoID8/IChhd2FpdCByZXNvbHZlWmVyb0NsYXdDb25maWdQYXRoKGhvbWVEaXJPdmVycmlkZSkpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmF3ID0gYXdhaXQgcmVhZEZpbGUoY29uZmlnUGF0aCwgJ3V0Zi04Jyk7XG4gICAgcmV0dXJuIEpTT04ucGFyc2UocmF3KSBhcyBaZXJvQ2xhd0NvbmZpZztcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiAnY29kZScgaW4gZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gJ0VOT0VOVCcpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGVuc3VyZVplcm9DbGF3Q29uZmlnKGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IFByb21pc2U8WmVyb0NsYXdDb25maWc+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCByZWFkWmVyb0NsYXdDb25maWdGaWxlKGhvbWVEaXJPdmVycmlkZSk7XG5cbiAgaWYgKGV4aXN0aW5nKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZENvbm5lY3Rpb25zID0gZXhpc3RpbmcucHJvdmlkZXJDb25uZWN0aW9ucy5tYXAoKGNvbm5lY3Rpb24pID0+ICh7XG4gICAgICAuLi5jb25uZWN0aW9uLFxuICAgICAgYXBpQmFzZTogY29ubmVjdGlvbi5hcGlCYXNlID8/ICcnLFxuICAgICAgbW9kZWxEaXNjb3Zlcnk6IGNvbm5lY3Rpb24ubW9kZWxEaXNjb3ZlcnkgPz8ge1xuICAgICAgICBtb2RlOiAnZGVmYXVsdCcgYXMgY29uc3QsXG4gICAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICBzb3VyY2U6ICdjYXRhbG9nJyBhcyBjb25zdCxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgY29uc3QgcmVzb2x2ZWRUaW1lb3V0TXMgPSAoKCkgPT4ge1xuICAgICAgY29uc3QgY3VycmVudCA9IGV4aXN0aW5nLmRlZmF1bHRzLnRpbWVvdXRNcyA/PyBERUZBVUxUX1RJTUVPVVRfTVM7XG4gICAgICBpZiAoY3VycmVudCA9PT0gTEVHQUNZX0RFRkFVTFRfVElNRU9VVF9NUyB8fCBjdXJyZW50ID09PSBQUkVWSU9VU19ERUZBVUxUX1RJTUVPVVRfTVMpIHtcbiAgICAgICAgcmV0dXJuIERFRkFVTFRfVElNRU9VVF9NUztcbiAgICAgIH1cbiAgICAgIHJldHVybiBjdXJyZW50O1xuICAgIH0pKCk7XG5cbiAgICBjb25zdCBub3JtYWxpemVkOiBaZXJvQ2xhd0NvbmZpZyA9IHtcbiAgICAgIC4uLmV4aXN0aW5nLFxuICAgICAgZGVmYXVsdHM6IHtcbiAgICAgICAgLi4uZXhpc3RpbmcuZGVmYXVsdHMsXG4gICAgICAgIHByaW1hcnlQcm92aWRlcklkOiBleGlzdGluZy5kZWZhdWx0cy5wcmltYXJ5UHJvdmlkZXJJZCA/PyBleGlzdGluZy5tb2RlbFByb3ZpZGVyc1swXT8uaWQsXG4gICAgICAgIGRlZmF1bHRNb2RlbElkOlxuICAgICAgICAgIGV4aXN0aW5nLmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkID8/XG4gICAgICAgICAgZXhpc3RpbmcubW9kZWxDYXRhbG9nLmZpbmQoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCA9PT0gZXhpc3RpbmcuZGVmYXVsdHMucHJpbWFyeVByb3ZpZGVySWQpPy5tb2RlbElkLFxuICAgICAgICB0aW1lb3V0TXM6IHJlc29sdmVkVGltZW91dE1zLFxuICAgICAgfSxcbiAgICAgIHByb3ZpZGVyQ29ubmVjdGlvbnM6IG5vcm1hbGl6ZWRDb25uZWN0aW9ucyxcbiAgICB9O1xuXG4gICAgaWYgKEpTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWQpICE9PSBKU09OLnN0cmluZ2lmeShleGlzdGluZykpIHtcbiAgICAgIGF3YWl0IHdyaXRlWmVyb0NsYXdDb25maWdGaWxlKG5vcm1hbGl6ZWQsIGhvbWVEaXJPdmVycmlkZSk7XG4gICAgfVxuXG4gICAgaWYgKG5vcm1hbGl6ZWQubW9kZWxQcm92aWRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICBjb25zdCByZWJ1aWx0ID0gYXdhaXQgYnVpbGRaZXJvQ2xhd0NvbmZpZyh7XG4gICAgICAgIGVuYWJsZWRQcm92aWRlcklkczogWydudmlkaWEtbmltJ10sXG4gICAgICAgIHByaW1hcnlQcm92aWRlcklkOiAnbnZpZGlhLW5pbScsXG4gICAgICAgIGhvbWVEaXJPdmVycmlkZSxcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgd3JpdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUocmVidWlsdCwgaG9tZURpck92ZXJyaWRlKTtcbiAgICAgIHJldHVybiByZWJ1aWx0O1xuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkO1xuICB9XG5cbiAgY29uc3QgaW5pdGlhbCA9IGF3YWl0IGJ1aWxkWmVyb0NsYXdDb25maWcoe1xuICAgIGVuYWJsZWRQcm92aWRlcklkczogW10sXG4gICAgaG9tZURpck92ZXJyaWRlLFxuICB9KTtcbiAgYXdhaXQgd3JpdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUoaW5pdGlhbCwgaG9tZURpck92ZXJyaWRlKTtcblxuICByZXR1cm4gaW5pdGlhbDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdyaXRlWmVyb0NsYXdDb25maWdGaWxlKFxuICBjb25maWc6IFplcm9DbGF3Q29uZmlnLFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4gIHRhcmdldEZpbGVQYXRoPzogc3RyaW5nLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IG91dHB1dFBhdGggPSB0YXJnZXRGaWxlUGF0aCA/PyBwYXRoLmpvaW4oc2hhcmVkLnplcm9jbGF3Um9vdCwgJ3plcm9jbGF3LmNvbmZpZy5qc29uJyk7XG5cbiAgYXdhaXQgbWtkaXIocGF0aC5kaXJuYW1lKG91dHB1dFBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgYXdhaXQgd3JpdGVGaWxlKG91dHB1dFBhdGgsIEpTT04uc3RyaW5naWZ5KGNvbmZpZywgbnVsbCwgMiksICd1dGYtOCcpO1xuXG4gIHJldHVybiBvdXRwdXRQYXRoO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBkYXRlWmVyb0NsYXdDb25maWdGaWxlKFxuICB1cGRhdGVyOiAoY3VycmVudDogWmVyb0NsYXdDb25maWcpID0+IFplcm9DbGF3Q29uZmlnLFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4pOiBQcm9taXNlPFplcm9DbGF3Q29uZmlnPiB7XG4gIGNvbnN0IGN1cnJlbnQgPSBhd2FpdCBlbnN1cmVaZXJvQ2xhd0NvbmZpZyhob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBuZXh0ID0gdXBkYXRlcihjdXJyZW50KTtcblxuICBhd2FpdCB3cml0ZVplcm9DbGF3Q29uZmlnRmlsZShcbiAgICB7XG4gICAgICAuLi5uZXh0LFxuICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB9LFxuICAgIGhvbWVEaXJPdmVycmlkZSxcbiAgKTtcblxuICByZXR1cm4gbmV4dDtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IE1vZGVsUHJvdmlkZXJUZW1wbGF0ZSB9IGZyb20gJy4vdHlwZXMnO1xuXG4vKipcbiAqIFplcm9DbGF3IFx1NjUyRlx1NjMwMVx1NzY4NFx1NkEyMVx1NTc4Qlx1NjcwRFx1NTJBMVx1NTU0Nlx1NzZFRVx1NUY1NVx1RkYwOFx1NTE3MSAyOCBcdTVCQjZcdUZGMDlcbiAqL1xuZXhwb3J0IGNvbnN0IE1PREVMX1BST1ZJREVSX0NBVEFMT0c6IHJlYWRvbmx5IE1vZGVsUHJvdmlkZXJUZW1wbGF0ZVtdID0gW1xuICB7XG4gICAgaWQ6ICdvcGVuYWknLFxuICAgIGRpc3BsYXlOYW1lOiAnT3BlbkFJJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MScsXG4gICAgZGVmYXVsdE1vZGVsczogWydncHQtNG8nLCAnZ3B0LTQuMSddLFxuICAgIGFwaUtleUVudjogJ09QRU5BSV9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnYXp1cmUtb3BlbmFpJyxcbiAgICBkaXNwbGF5TmFtZTogJ0F6dXJlIE9wZW5BSScsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8ve3Jlc291cmNlfS5vcGVuYWkuYXp1cmUuY29tL29wZW5haS9kZXBsb3ltZW50cy97ZGVwbG95bWVudH0nLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZ3B0LTRvJywgJ2dwdC00LjEnXSxcbiAgICBhcGlLZXlFbnY6ICdBWlVSRV9PUEVOQUlfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2FudGhyb3BpYycsXG4gICAgZGlzcGxheU5hbWU6ICdBbnRocm9waWMnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS5hbnRocm9waWMuY29tL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2NsYXVkZS1vcHVzLTQtMScsICdjbGF1ZGUtc29ubmV0LTQnXSxcbiAgICBhcGlLZXlFbnY6ICdBTlRIUk9QSUNfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2dvb2dsZS1haScsXG4gICAgZGlzcGxheU5hbWU6ICdHb29nbGUgQUknLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2dlbmVyYXRpdmVsYW5ndWFnZS5nb29nbGVhcGlzLmNvbS92MWJldGEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZ2VtaW5pLTIuNS1wcm8nLCAnZ2VtaW5pLTIuMC1mbGFzaCddLFxuICAgIGFwaUtleUVudjogJ0dPT0dMRV9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnZGVlcHNlZWsnLFxuICAgIGRpc3BsYXlOYW1lOiAnRGVlcFNlZWsnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS5kZWVwc2Vlay5jb20vdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZGVlcHNlZWstY2hhdCcsICdkZWVwc2Vlay1yZWFzb25lciddLFxuICAgIGFwaUtleUVudjogJ0RFRVBTRUVLX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICdxd2VuJyxcbiAgICBkaXNwbGF5TmFtZTogJ1F3ZW4nLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2Rhc2hzY29wZS5hbGl5dW5jcy5jb20vY29tcGF0aWJsZS1tb2RlL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ3F3ZW4tbWF4JywgJ3F3ZW4tcGx1cyddLFxuICAgIGFwaUtleUVudjogJ1FXRU5fQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ21vb25zaG90JyxcbiAgICBkaXNwbGF5TmFtZTogJ01vb25zaG90JyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkubW9vbnNob3QuY24vdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnbW9vbnNob3QtdjEtMTI4aycsICdraW1pLWsyLWluc3RydWN0J10sXG4gICAgYXBpS2V5RW52OiAnTU9PTlNIT1RfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ3poaXB1JyxcbiAgICBkaXNwbGF5TmFtZTogJ1poaXB1IEFJJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9vcGVuLmJpZ21vZGVsLmNuL2FwaS9wYWFzL3Y0JyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2dsbS00LjUnLCAnZ2xtLTQtYWlyJ10sXG4gICAgYXBpS2V5RW52OiAnWkhJUFVfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2JhaWNodWFuJyxcbiAgICBkaXNwbGF5TmFtZTogJ0JhaWNodWFuJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkuYmFpY2h1YW4tYWkuY29tL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ0JhaWNodWFuNC1UdXJibycsICdCYWljaHVhbjQtQWlyJ10sXG4gICAgYXBpS2V5RW52OiAnQkFJQ0hVQU5fQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ21pbmltYXgnLFxuICAgIGRpc3BsYXlOYW1lOiAnTWluaU1heCcsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vYXBpLm1pbmltYXguY2hhdC92MScsXG4gICAgZGVmYXVsdE1vZGVsczogWydNaW5pTWF4LU0xJywgJ2FiYWI2LjVzLWNoYXQnXSxcbiAgICBhcGlLZXlFbnY6ICdNSU5JTUFYX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICd2b2xjZW5naW5lLWFyaycsXG4gICAgZGlzcGxheU5hbWU6ICdWb2xjZW5naW5lIEFyaycsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vYXJrLmNuLWJlaWppbmcudm9sY2VzLmNvbS9hcGkvdjMnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZG91YmFvLXByby0zMmsnLCAnZG91YmFvLXNlZWQtMS42J10sXG4gICAgYXBpS2V5RW52OiAnVk9MQ0VOR0lORV9BUktfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ3NpbGljb25mbG93JyxcbiAgICBkaXNwbGF5TmFtZTogJ1NpbGljb25GbG93JyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkuc2lsaWNvbmZsb3cuY24vdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnZGVlcHNlZWstYWkvRGVlcFNlZWstUjEnLCAnUXdlbi9Rd2VuMy0yMzVCLUEyMkInXSxcbiAgICBhcGlLZXlFbnY6ICdTSUxJQ09ORkxPV19BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAndG9nZXRoZXInLFxuICAgIGRpc3BsYXlOYW1lOiAnVG9nZXRoZXIgQUknLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS50b2dldGhlci54eXovdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnbWV0YS1sbGFtYS9MbGFtYS0zLjMtNzBCLUluc3RydWN0LVR1cmJvJywgJ1F3ZW4vUXdlbjIuNS03MkItSW5zdHJ1Y3QtVHVyYm8nXSxcbiAgICBhcGlLZXlFbnY6ICdUT0dFVEhFUl9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnZmlyZXdvcmtzJyxcbiAgICBkaXNwbGF5TmFtZTogJ0ZpcmV3b3JrcyBBSScsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vYXBpLmZpcmV3b3Jrcy5haS9pbmZlcmVuY2UvdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnYWNjb3VudHMvZmlyZXdvcmtzL21vZGVscy9sbGFtYS12M3AxLTcwYi1pbnN0cnVjdCcsICdhY2NvdW50cy9maXJld29ya3MvbW9kZWxzL3F3ZW4zLTIzNWItYTIyYiddLFxuICAgIGFwaUtleUVudjogJ0ZJUkVXT1JLU19BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnZ3JvcScsXG4gICAgZGlzcGxheU5hbWU6ICdHcm9xJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkuZ3JvcS5jb20vb3BlbmFpL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2xsYW1hLTMuMy03MGItdmVyc2F0aWxlJywgJ3F3ZW4tcXdxLTMyYiddLFxuICAgIGFwaUtleUVudjogJ0dST1FfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2NvaGVyZScsXG4gICAgZGlzcGxheU5hbWU6ICdDb2hlcmUnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS5jb2hlcmUuY29tL3YyJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2NvbW1hbmQtYS0wMy0yMDI1JywgJ2NvbW1hbmQtci1wbHVzJ10sXG4gICAgYXBpS2V5RW52OiAnQ09IRVJFX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICdtaXN0cmFsJyxcbiAgICBkaXNwbGF5TmFtZTogJ01pc3RyYWwnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2FwaS5taXN0cmFsLmFpL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ21pc3RyYWwtbGFyZ2UtbGF0ZXN0JywgJ2NvZGVzdHJhbC1sYXRlc3QnXSxcbiAgICBhcGlLZXlFbnY6ICdNSVNUUkFMX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICd4YWknLFxuICAgIGRpc3BsYXlOYW1lOiAneEFJJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkueC5haS92MScsXG4gICAgZGVmYXVsdE1vZGVsczogWydncm9rLTMtbGF0ZXN0JywgJ2dyb2stMy1taW5pLWxhdGVzdCddLFxuICAgIGFwaUtleUVudjogJ1hBSV9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnbnZpZGlhLW5pbScsXG4gICAgZGlzcGxheU5hbWU6ICdOVklESUEgTklNJyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9pbnRlZ3JhdGUuYXBpLm52aWRpYS5jb20vdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnbWV0YS9sbGFtYS0zLjEtNzBiLWluc3RydWN0JywgJ21pc3RyYWxhaS9taXN0cmFsLW5lbW8taW5zdHJ1Y3QnXSxcbiAgICBhcGlLZXlFbnY6ICdOVklESUFfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ29wZW5yb3V0ZXInLFxuICAgIGRpc3BsYXlOYW1lOiAnT3BlblJvdXRlcicsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vb3BlbnJvdXRlci5haS9hcGkvdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnb3BlbmFpL2dwdC00bycsICdhbnRocm9waWMvY2xhdWRlLXNvbm5ldC00J10sXG4gICAgYXBpS2V5RW52OiAnT1BFTlJPVVRFUl9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAncGVycGxleGl0eScsXG4gICAgZGlzcGxheU5hbWU6ICdQZXJwbGV4aXR5JyxcbiAgICBhcGlCYXNlOiAnaHR0cHM6Ly9hcGkucGVycGxleGl0eS5haScsXG4gICAgZGVmYXVsdE1vZGVsczogWydzb25hci1wcm8nLCAnc29uYXItcmVhc29uaW5nLXBybyddLFxuICAgIGFwaUtleUVudjogJ1BFUlBMRVhJVFlfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ29sbGFtYScsXG4gICAgZGlzcGxheU5hbWU6ICdPbGxhbWEnLFxuICAgIGFwaUJhc2U6ICdodHRwOi8vMTI3LjAuMC4xOjExNDM0L3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ3F3ZW4yLjU6MzJiJywgJ2xsYW1hMy4zOjcwYiddLFxuICAgIGFwaUtleUVudjogJ09MTEFNQV9BUElfS0VZJyxcbiAgfSxcbiAge1xuICAgIGlkOiAnbG1zdHVkaW8nLFxuICAgIGRpc3BsYXlOYW1lOiAnTE0gU3R1ZGlvJyxcbiAgICBhcGlCYXNlOiAnaHR0cDovLzEyNy4wLjAuMToxMjM0L3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ2xvY2FsLW1vZGVsJywgJ3F3ZW4yLjUtY29kZXItMzJiJ10sXG4gICAgYXBpS2V5RW52OiAnTE1TVFVESU9fQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ3ZsbG0nLFxuICAgIGRpc3BsYXlOYW1lOiAndkxMTSBPcGVuQUknLFxuICAgIGFwaUJhc2U6ICdodHRwOi8vMTI3LjAuMC4xOjgwMDAvdjEnLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnUXdlbi9Rd2VuMy0zMkInLCAnZGVlcHNlZWstYWkvRGVlcFNlZWstUjEtRGlzdGlsbC1Rd2VuLTMyQiddLFxuICAgIGFwaUtleUVudjogJ1ZMTE1fQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2h1Z2dpbmdmYWNlLWluZmVyZW5jZScsXG4gICAgZGlzcGxheU5hbWU6ICdIdWdnaW5nRmFjZSBJbmZlcmVuY2UnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL3JvdXRlci5odWdnaW5nZmFjZS5jby92MScsXG4gICAgZGVmYXVsdE1vZGVsczogWydtZXRhLWxsYW1hL0xsYW1hLTMuMy03MEItSW5zdHJ1Y3QnLCAnUXdlbi9Rd2VuMi41LUNvZGVyLTMyQi1JbnN0cnVjdCddLFxuICAgIGFwaUtleUVudjogJ0hVR0dJTkdGQUNFX0FQSV9LRVknLFxuICB9LFxuICB7XG4gICAgaWQ6ICdhd3MtYmVkcm9jaycsXG4gICAgZGlzcGxheU5hbWU6ICdBV1MgQmVkcm9jaycsXG4gICAgYXBpQmFzZTogJ2h0dHBzOi8vYmVkcm9jay1ydW50aW1lLntyZWdpb259LmFtYXpvbmF3cy5jb20nLFxuICAgIGRlZmF1bHRNb2RlbHM6IFsnYW50aHJvcGljLmNsYXVkZS0zLTctc29ubmV0JywgJ2FtYXpvbi5ub3ZhLXByby12MTowJ10sXG4gICAgYXBpS2V5RW52OiAnQVdTX0JFRFJPQ0tfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2F6dXJlLWFpLWluZmVyZW5jZScsXG4gICAgZGlzcGxheU5hbWU6ICdBenVyZSBBSSBJbmZlcmVuY2UnLFxuICAgIGFwaUJhc2U6ICdodHRwczovL3tyZXNvdXJjZX0uc2VydmljZXMuYWkuYXp1cmUuY29tL21vZGVscycsXG4gICAgZGVmYXVsdE1vZGVsczogWydncHQtNG8nLCAncGhpLTQnXSxcbiAgICBhcGlLZXlFbnY6ICdBWlVSRV9BSV9JTkZFUkVOQ0VfQVBJX0tFWScsXG4gIH0sXG4gIHtcbiAgICBpZDogJ2FsaWJhYmEtYmFpbGlhbicsXG4gICAgZGlzcGxheU5hbWU6ICdBbGliYWJhIEJhaWxpYW4nLFxuICAgIGFwaUJhc2U6ICdodHRwczovL2Rhc2hzY29wZS5hbGl5dW5jcy5jb20vYXBpL3YxJyxcbiAgICBkZWZhdWx0TW9kZWxzOiBbJ3F3ZW4tbWF4LWxhdGVzdCcsICdxd2VuLXBsdXMtbGF0ZXN0J10sXG4gICAgYXBpS2V5RW52OiAnQUxJQkFCQV9CQUlMSUFOX0FQSV9LRVknLFxuICB9LFxuXSBhcyBjb25zdDtcblxuY29uc3QgTU9ERUxfUFJPVklERVJfTUFQID0gbmV3IE1hcDxzdHJpbmcsIE1vZGVsUHJvdmlkZXJUZW1wbGF0ZT4oXG4gIE1PREVMX1BST1ZJREVSX0NBVEFMT0cubWFwKChwcm92aWRlcikgPT4gW3Byb3ZpZGVyLmlkLCBwcm92aWRlcl0pLFxuKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGdldE1vZGVsUHJvdmlkZXJDYXRhbG9nKCk6IHJlYWRvbmx5IE1vZGVsUHJvdmlkZXJUZW1wbGF0ZVtdIHtcbiAgcmV0dXJuIE1PREVMX1BST1ZJREVSX0NBVEFMT0c7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTdXBwb3J0ZWRQcm92aWRlckNvdW50KCk6IG51bWJlciB7XG4gIHJldHVybiBNT0RFTF9QUk9WSURFUl9DQVRBTE9HLmxlbmd0aDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRNb2RlbFByb3ZpZGVyKHByb3ZpZGVySWQ6IHN0cmluZyk6IE1vZGVsUHJvdmlkZXJUZW1wbGF0ZSB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBNT0RFTF9QUk9WSURFUl9NQVAuZ2V0KHByb3ZpZGVySWQpO1xufVxuIiwgImltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjcmVhdGVXcml0ZVN0cmVhbSB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgY3AsIG1rZGlyLCByZWFkRmlsZSwgcmVhZGRpciwgcm0sIHN0YXQsIHdyaXRlRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IG5ldCBmcm9tICdub2RlOm5ldCc7XG5pbXBvcnQgeyBzcGF3biB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSAnbm9kZTp1cmwnO1xuaW1wb3J0IHsgRGF0YWJhc2VTeW5jIH0gZnJvbSAnbm9kZTpzcWxpdGUnO1xuXG5pbXBvcnQgeyBhcHAgfSBmcm9tICdlbGVjdHJvbic7XG5cbmltcG9ydCB7IGVuc3VyZVplcm9DbGF3Q29uZmlnIH0gZnJvbSAnLi96ZXJvY2xhdy1jb25maWctbWFuYWdlcic7XG5pbXBvcnQgeyBlbnN1cmVBZ2VudFdvcmtzcGFjZSwgZW5zdXJlU2hhcmVkV29ya3NwYWNlIH0gZnJvbSAnLi9zaGFyZWQtd29ya3NwYWNlLW1hbmFnZXInO1xuaW1wb3J0IHsgZ2V0QWdlbnRQcm9maWxlIH0gZnJvbSAnLi9hZ2VudC1wcm9maWxlLXNlcnZpY2UnO1xuaW1wb3J0IHsgYXBwZW5kQWdlbnRDb2xsYWJvcmF0aW9uRXZlbnQgfSBmcm9tICcuL2FnZW50LWNvbGxhYm9yYXRpb24tZXZlbnQtc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7XG4gIEFnZW50UHJvZmlsZSxcbiAgQWdlbnRUZWFtTWVtYmVyLFxuICBBZ2VudFJ1bnRpbWVTdGF0dXMsXG4gIEFnZW50TG9nVGFpbCxcbiAgU3RhcnRBZ2VudElucHV0LFxuICBTdGFydEFnZW50UmVzdWx0LFxuICBTdG9wQWdlbnRJbnB1dCxcbiAgU3RvcEFnZW50UmVzdWx0LFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgTWNwU2VydmVyQ29uZmlnIH0gZnJvbSAnLi9za2lsbHMtbWNwLXR5cGVzJztcblxuY29uc3QgR0xPQkFMX1NZU1RFTV9QUk9NUFRfRklMRSA9ICdhbmdldHMubWQnO1xuY29uc3QgWkVST0NMQVdfTE9HX0RJUiA9ICd6ZXJvY2xhdyc7XG5jb25zdCBaRVJPQ0xBV19XT1JLU1BBQ0VfUFJPTVBUX0ZJTEUgPSAnQUdFTlRTLm1kJztcbmNvbnN0IFpFUk9DTEFXX0dBVEVXQVlfSE9TVCA9ICcxMjcuMC4wLjEnO1xuY29uc3QgWkVST0NMQVdfR0FURVdBWV9QT1JUX0JBU0UgPSA0MzYwMDtcbmNvbnN0IFpFUk9DTEFXX0dBVEVXQVlfUE9SVF9TUEFOID0gMTAwMDtcbmNvbnN0IEdBVEVXQVlfUkVBRFlfVElNRU9VVF9NUyA9IDYwXzAwMDtcbmNvbnN0IEdBVEVXQVlfUkVBRFlfUE9MTF9JTlRFUlZBTF9NUyA9IDI1MDtcbmNvbnN0IERFRkFVTFRfR0FURVdBWV9SRVFVRVNUX1RJTUVPVVRfU0VDUyA9IDYwMDtcbmNvbnN0IERFRkFVTFRfQVVUT05PTVlfTUFYX0FDVElPTlNfUEVSX0hPVVIgPSAzMDA7XG5jb25zdCBERUZBVUxUX0FVVE9OT01ZX01BWF9DT1NUX1BFUl9EQVlfQ0VOVFMgPSA1MDAwO1xuY29uc3QgREVGQVVMVF9BVVRPTk9NWV9BTExPV0VEX0NPTU1BTkRTID0gW1xuICAnZ2l0JyxcbiAgJ25wbScsXG4gICdjYXJnbycsXG4gICdscycsXG4gICdjYXQnLFxuICAnZ3JlcCcsXG4gICdmaW5kJyxcbiAgJ2VjaG8nLFxuICAncHdkJyxcbiAgJ3djJyxcbiAgJ2hlYWQnLFxuICAndGFpbCcsXG4gICdkYXRlJyxcbl07XG5jb25zdCBERUZBVUxUX0FVVE9OT01ZX0ZPUkJJRERFTl9QQVRIUyA9IFtcbiAgJy9ldGMnLFxuICAnL3Jvb3QnLFxuICAnL2hvbWUnLFxuICAnL3VzcicsXG4gICcvYmluJyxcbiAgJy9zYmluJyxcbiAgJy9saWInLFxuICAnL29wdCcsXG4gICcvYm9vdCcsXG4gICcvZGV2JyxcbiAgJy9wcm9jJyxcbiAgJy9zeXMnLFxuICAnL3ZhcicsXG4gICcvdG1wJyxcbiAgJ34vLnNzaCcsXG4gICd+Ly5nbnVwZycsXG4gICd+Ly5hd3MnLFxuICAnfi8uY29uZmlnJyxcbl07XG5jb25zdCBERUZBVUxUX0FVVE9OT01ZX0FVVE9fQVBQUk9WRV9UT09MUyA9IFsnZmlsZV9yZWFkJywgJ21lbW9yeV9yZWNhbGwnXTtcbmNvbnN0IFRBU0tfU1lOQ19JTlRFUlZBTF9NUyA9IDhfMDAwO1xuY29uc3QgVEFTS19TWU5DX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5jb25zdCBERUZBVUxUX1dFQl9TRUFSQ0hfUFJPVklERVIgPSAndGF2aWx5JztcbmNvbnN0IERFRkFVTFRfV0VCX1NFQVJDSF9NQVhfUkVTVUxUUyA9IDU7XG5jb25zdCBERUZBVUxUX1dFQl9TRUFSQ0hfVElNRU9VVF9TRUNTID0gMjA7XG5jb25zdCBUQVNLX0FHRU5UX1BST01QVF9NQVhfTEVOR1RIID0gMzIwO1xuY29uc3QgVEFTS19BR0VOVF9GT1JCSURERU5fUFJPTVBUX1BBVFRFUk4gPVxuICAvXFxiKGNyb25fYWRkfGNyb25fdXBkYXRlfGNyb25fcmVtb3ZlfGNyb25fcnVufGNyb25fbGlzdHx3ZWJfc2VhcmNoX2NvbmZpZ3x3ZWJfYWNjZXNzX2NvbmZpZ3xtb2RlbF9yb3V0aW5nX2NvbmZpZ3xjdXJsfHdnZXQpXFxiL2dpO1xuY29uc3QgVEFTS19BR0VOVF9OT0lTRV9QQVRURVJOID1cbiAgL1xcYihkaXNjb3JkfHRlbGVncmFtfHNsYWNrfG1hdHRlcm1vc3R8bGFya3xmZWlzaHV8ZW1haWx8Y2hhbm5lbFtfLV0/aWR8ZGVsaXZlcnl8YW5ub3VuY2V8cHVzaClcXGIvZ2k7XG5cbmNvbnN0IFRFQU1fVE9PTF9UT19aRVJPQ0xBV19UT09MUzogUmVjb3JkPHN0cmluZywgcmVhZG9ubHkgc3RyaW5nW10+ID0ge1xuICBzeXNfc2VhcmNoOiBbJ2dsb2Jfc2VhcmNoJywgJ2NvbnRlbnRfc2VhcmNoJywgJ3dlYl9zZWFyY2hfdG9vbCddLFxuICB3ZWJfcmVxdWVzdDogWydodHRwX3JlcXVlc3QnLCAnd2ViX2ZldGNoJ10sXG4gIGZpbGVfcmVhZDogWydmaWxlX3JlYWQnXSxcbiAgZmlsZV93cml0ZTogWydmaWxlX3dyaXRlJ10sXG4gIGZpbGVfZGVsZXRlOiBbJ2ZpbGVfZGVsZXRlJ10sXG59O1xuXG50eXBlIFplcm9DbGF3R2F0ZXdheUVuZHBvaW50ID0ge1xuICBob3N0OiBzdHJpbmc7XG4gIHBvcnQ6IG51bWJlcjtcbiAgYmFzZVVybDogc3RyaW5nO1xufTtcblxudHlwZSBaZXJvQ2xhd01jcFNlcnZlckNvbmZpZyA9IHtcbiAgbmFtZTogc3RyaW5nO1xuICB0cmFuc3BvcnQ6ICdzdGRpbycgfCAnc3NlJyB8ICdodHRwJztcbiAgY29tbWFuZD86IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG4gIGVudjogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgdXJsPzogc3RyaW5nO1xuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICB0b29sVGltZW91dFNlY3M/OiBudW1iZXI7XG59O1xuXG50eXBlIFByb2Nlc3NFbnRyeSA9IHtcbiAgc3RhdHVzOiBBZ2VudFJ1bnRpbWVTdGF0dXNbJ3N0YXR1cyddO1xuICBwaWQ/OiBudW1iZXI7XG4gIHN0YXJ0ZWRBdD86IHN0cmluZztcbiAgcHJvY2Vzcz86IFJldHVyblR5cGU8dHlwZW9mIHNwYXduPjtcbiAgbWVzc2FnZT86IHN0cmluZztcbiAgbG9nUGF0aD86IHN0cmluZztcbiAgbGFzdE91dHB1dEF0Pzogc3RyaW5nO1xuICBnYXRld2F5PzogWmVyb0NsYXdHYXRld2F5RW5kcG9pbnQ7XG59O1xuXG50eXBlIEdhdGV3YXlDcm9uSm9iID0ge1xuICBpZDogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmcgfCBudWxsO1xuICBjb21tYW5kOiBzdHJpbmc7XG4gIGpvYl90eXBlPzogc3RyaW5nIHwgbnVsbDtcbiAgcHJvbXB0Pzogc3RyaW5nIHwgbnVsbDtcbiAgbmV4dF9ydW46IHN0cmluZztcbiAgbGFzdF9ydW46IHN0cmluZyB8IG51bGw7XG4gIGxhc3Rfc3RhdHVzOiBzdHJpbmcgfCBudWxsO1xuICBsYXN0X291dHB1dD86IHN0cmluZyB8IG51bGw7XG4gIG91dHB1dD86IHN0cmluZyB8IG51bGw7XG4gIHJlc3VsdD86IHN0cmluZyB8IG51bGw7XG4gIGxhc3RfcmVzdWx0Pzogc3RyaW5nIHwgbnVsbDtcbiAgbWVzc2FnZT86IHN0cmluZyB8IG51bGw7XG4gIGxhc3RfbWVzc2FnZT86IHN0cmluZyB8IG51bGw7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG59O1xuXG50eXBlIENyb25SdW5SZWNvcmQgPSB7XG4gIG91dHB1dDogc3RyaW5nIHwgbnVsbDtcbn07XG5cbnR5cGUgQ3JvblJ1bkNvdW50UmVjb3JkID0ge1xuICBjb3VudDogbnVtYmVyO1xufTtcblxudHlwZSBDcm9uSm9iUHJvbXB0UmVjb3JkID0ge1xuICBqb2JfdHlwZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJvbXB0OiBzdHJpbmcgfCBudWxsO1xuICBuYW1lOiBzdHJpbmcgfCBudWxsO1xuICBtb2RlbDogc3RyaW5nIHwgbnVsbDtcbiAgc2Vzc2lvbl90YXJnZXQ6IHN0cmluZyB8IG51bGw7XG59O1xuXG50eXBlIFRhc2tXYXRjaGVyRW50cnkgPSB7XG4gIHRpbWVyOiBOb2RlSlMuVGltZW91dDtcbiAgc25hcHNob3Q6IE1hcDxzdHJpbmcsIHN0cmluZz47XG4gIGdhdGV3YXlCYXNlVXJsOiBzdHJpbmc7XG4gIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZztcbn07XG5cbnR5cGUgUnVudGltZVdlYlNlYXJjaENvbmZpZyA9IHtcbiAgZW5hYmxlZDogYm9vbGVhbjtcbiAgcHJvdmlkZXI6IHN0cmluZztcbiAgZmFsbGJhY2tQcm92aWRlcnM6IHN0cmluZ1tdO1xuICBhcGlLZXk/OiBzdHJpbmc7XG4gIG1heFJlc3VsdHM6IG51bWJlcjtcbiAgdGltZW91dFNlY3M6IG51bWJlcjtcbn07XG5cbmNvbnN0IGFnZW50UHJvY2Vzc2VzID0gbmV3IE1hcDxzdHJpbmcsIFByb2Nlc3NFbnRyeT4oKTtcbmNvbnN0IGFnZW50VGFza1dhdGNoZXJzID0gbmV3IE1hcDxzdHJpbmcsIFRhc2tXYXRjaGVyRW50cnk+KCk7XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVaZXJvQ2xhd0V4ZWN1dGFibGUoKTogUHJvbWlzZTx7XG4gIGV4ZWN1dGFibGVQYXRoOiBzdHJpbmcgfCBudWxsO1xuICB0cmllZDogc3RyaW5nW107XG59PiB7XG4gIGNvbnN0IGFwcFJvb3QgPSBhcHAuZ2V0QXBwUGF0aCgpO1xuICBjb25zdCBjYW5kaWRhdGVzID0gW1xuICAgIHBhdGguam9pbihhcHBSb290LCAnLi4nLCAnemVyb2NsYXcnLCAnemVyb2NsYXcuZXhlJyksXG4gICAgcGF0aC5qb2luKGFwcFJvb3QsICd6ZXJvY2xhdycsICd6ZXJvY2xhdy5leGUnKSxcbiAgICBwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwgJy4uJywgJ3plcm9jbGF3JywgJ3plcm9jbGF3LmV4ZScpLFxuICAgIHBhdGguam9pbihwcm9jZXNzLnJlc291cmNlc1BhdGggPz8gJycsICd6ZXJvY2xhdycsICd6ZXJvY2xhdy5leGUnKSxcbiAgXTtcblxuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgaWYgKGNhbmRpZGF0ZSAmJiAoYXdhaXQgZmlsZUV4aXN0cyhjYW5kaWRhdGUpKSkge1xuICAgICAgcmV0dXJuIHsgZXhlY3V0YWJsZVBhdGg6IGNhbmRpZGF0ZSwgdHJpZWQ6IGNhbmRpZGF0ZXMgfTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4geyBleGVjdXRhYmxlUGF0aDogbnVsbCwgdHJpZWQ6IGNhbmRpZGF0ZXMgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmlsZUV4aXN0cyh0YXJnZXRQYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBpbmZvID0gYXdhaXQgc3RhdCh0YXJnZXRQYXRoKTtcbiAgICByZXR1cm4gaW5mby5pc0ZpbGUoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZURpcmVjdG9yeShkaXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgbWtkaXIoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG59XG5cbmZ1bmN0aW9uIHN0cmlwRnJvbnRtYXR0ZXIoY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbWF0Y2ggPSBjb250ZW50Lm1hdGNoKC9eLS0tXFxzKltcXHNcXFNdKj9cXHMqLS0tXFxzKi8pO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gY29udGVudC50cmltKCk7XG4gIHJldHVybiBjb250ZW50LnNsaWNlKG1hdGNoWzBdLmxlbmd0aCkudHJpbSgpO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlQXBwUm9vdCgpOiBzdHJpbmcge1xuICBjb25zdCBfX2ZpbGVuYW1lID0gZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpO1xuICBjb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoX19maWxlbmFtZSk7XG4gIHJldHVybiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4nLCAnLi4nKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEdsb2JhbFN5c3RlbVByb21wdCgpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgY29uc3QgcHJvbXB0UGF0aCA9IHBhdGguam9pbihyZXNvbHZlQXBwUm9vdCgpLCBHTE9CQUxfU1lTVEVNX1BST01QVF9GSUxFKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgcmVhZEZpbGUocHJvbXB0UGF0aCwgJ3V0Zi04Jyk7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHN0cmlwRnJvbnRtYXR0ZXIoY29udGVudCkudHJpbSgpO1xuICAgIHJldHVybiBub3JtYWxpemVkLmxlbmd0aCA+IDAgPyBub3JtYWxpemVkIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9Mb2dGaWxlTmFtZSgpOiBzdHJpbmcge1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBwYWQgPSAobnVtOiBudW1iZXIpID0+IFN0cmluZyhudW0pLnBhZFN0YXJ0KDIsICcwJyk7XG4gIHJldHVybiBgemVyb2NsYXctJHtub3cuZ2V0RnVsbFllYXIoKX0ke3BhZChub3cuZ2V0TW9udGgoKSArIDEpfSR7cGFkKG5vdy5nZXREYXRlKCkpfS0ke3BhZChcbiAgICBub3cuZ2V0SG91cnMoKSxcbiAgKX0ke3BhZChub3cuZ2V0TWludXRlcygpKX0ke3BhZChub3cuZ2V0U2Vjb25kcygpKX0ubG9nYDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlWmVyb0NsYXdMb2dTdHJlYW0oYWdlbnRJZDogc3RyaW5nLCBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPHtcbiAgbG9nUGF0aDogc3RyaW5nO1xuICBzdHJlYW06IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZVdyaXRlU3RyZWFtPjtcbn0+IHtcbiAgY29uc3Qgd29ya3NwYWNlID0gYXdhaXQgZW5zdXJlQWdlbnRXb3Jrc3BhY2UoYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgbG9nRGlyID0gcGF0aC5qb2luKHdvcmtzcGFjZS5wcml2YXRlTG9nc1Jvb3QsIFpFUk9DTEFXX0xPR19ESVIpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3RvcnkobG9nRGlyKTtcbiAgY29uc3QgbG9nUGF0aCA9IHBhdGguam9pbihsb2dEaXIsIHRvTG9nRmlsZU5hbWUoKSk7XG4gIGNvbnN0IHN0cmVhbSA9IGNyZWF0ZVdyaXRlU3RyZWFtKGxvZ1BhdGgsIHsgZmxhZ3M6ICdhJyB9KTtcbiAgcmV0dXJuIHsgbG9nUGF0aCwgc3RyZWFtIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRNY3BTZXJ2ZXJzRnJvbUZpbGUoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8TWNwU2VydmVyQ29uZmlnW10+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByYXcgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04Jyk7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHVua25vd247XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGFyc2VkKSkge1xuICAgICAgcmV0dXJuIHBhcnNlZC5maWx0ZXIoKGl0ZW0pOiBpdGVtIGlzIE1jcFNlcnZlckNvbmZpZyA9PiB0eXBlb2YgaXRlbSA9PT0gJ29iamVjdCcgJiYgaXRlbSAhPT0gbnVsbCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUdhdGV3YXlIYXNoSW5wdXQoYWdlbnRJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGFnZW50SWQudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG59XG5cbmZ1bmN0aW9uIGhhc2hBZ2VudElkKGFnZW50SWQ6IHN0cmluZyk6IG51bWJlciB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVHYXRld2F5SGFzaElucHV0KGFnZW50SWQpO1xuICBsZXQgaGFzaCA9IDA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbm9ybWFsaXplZC5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGhhc2ggPSAoaGFzaCAqIDMxICsgbm9ybWFsaXplZC5jaGFyQ29kZUF0KGkpKSAlIE51bWJlci5NQVhfU0FGRV9JTlRFR0VSO1xuICB9XG4gIHJldHVybiBNYXRoLmFicyhoYXNoKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVBZ2VudEdhdGV3YXlQb3J0KGFnZW50SWQ6IHN0cmluZyk6IG51bWJlciB7XG4gIGNvbnN0IGhhc2ggPSBoYXNoQWdlbnRJZChhZ2VudElkKTtcbiAgcmV0dXJuIFpFUk9DTEFXX0dBVEVXQVlfUE9SVF9CQVNFICsgKGhhc2ggJSBaRVJPQ0xBV19HQVRFV0FZX1BPUlRfU1BBTik7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVHYXRld2F5RW5kcG9pbnRGb3JBZ2VudChhZ2VudElkOiBzdHJpbmcpOiBaZXJvQ2xhd0dhdGV3YXlFbmRwb2ludCB7XG4gIGNvbnN0IHBvcnQgPSByZXNvbHZlQWdlbnRHYXRld2F5UG9ydChhZ2VudElkKTtcbiAgcmV0dXJuIHtcbiAgICBob3N0OiBaRVJPQ0xBV19HQVRFV0FZX0hPU1QsXG4gICAgcG9ydCxcbiAgICBiYXNlVXJsOiBgaHR0cDovLyR7WkVST0NMQVdfR0FURVdBWV9IT1NUfToke3BvcnR9YCxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVBZ2VudEdhdGV3YXlCYXNlVXJsKGFnZW50SWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiByZXNvbHZlR2F0ZXdheUVuZHBvaW50Rm9yQWdlbnQoYWdlbnRJZCkuYmFzZVVybDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEFnZW50UnVudGltZUdhdGV3YXlCYXNlVXJsKGFnZW50SWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudHJ5ID0gYWdlbnRQcm9jZXNzZXMuZ2V0KGFnZW50SWQpO1xuICBpZiAoZW50cnk/LmdhdGV3YXkpIHtcbiAgICByZXR1cm4gZW50cnkuZ2F0ZXdheS5iYXNlVXJsO1xuICB9XG4gIHJldHVybiByZXNvbHZlQWdlbnRHYXRld2F5QmFzZVVybChhZ2VudElkKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaXNQb3J0QXZhaWxhYmxlKGhvc3Q6IHN0cmluZywgcG9ydDogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IHNlcnZlciA9IG5ldC5jcmVhdGVTZXJ2ZXIoKTtcbiAgICBzZXJ2ZXIub25jZSgnZXJyb3InLCAoKSA9PiByZXNvbHZlKGZhbHNlKSk7XG4gICAgc2VydmVyLm9uY2UoJ2xpc3RlbmluZycsICgpID0+IHtcbiAgICAgIHNlcnZlci5jbG9zZSgoKSA9PiByZXNvbHZlKHRydWUpKTtcbiAgICB9KTtcbiAgICBzZXJ2ZXIubGlzdGVuKHBvcnQsIGhvc3QpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZXNjYXBlVG9tbFN0cmluZyh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnJlcGxhY2UoL1xcXFwvZywgJ1xcXFxcXFxcJylcbiAgICAucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpXG4gICAgLnJlcGxhY2UoL1xcci9nLCAnXFxcXHInKVxuICAgIC5yZXBsYWNlKC9cXG4vZywgJ1xcXFxuJylcbiAgICAucmVwbGFjZSgvXFx0L2csICdcXFxcdCcpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJUb21sU3RyaW5nKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYFwiJHtlc2NhcGVUb21sU3RyaW5nKHZhbHVlKX1cImA7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclRvbWxTdHJpbmdBcnJheSh2YWx1ZXM6IHJlYWRvbmx5IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHZhbHVlcy5maWx0ZXIoKHZhbHVlKSA9PiB2YWx1ZS50cmltKCkubGVuZ3RoID4gMCk7XG4gIHJldHVybiBgWyR7bm9ybWFsaXplZC5tYXAoKHZhbHVlKSA9PiByZW5kZXJUb21sU3RyaW5nKHZhbHVlKSkuam9pbignLCAnKX1dYDtcbn1cblxuZnVuY3Rpb24gc2FuaXRpemVUb21sU2VjdGlvbk5hbWUocmF3OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gcmF3LnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy1dKy9nLCAnXycpO1xuICByZXR1cm4gbm9ybWFsaXplZC5sZW5ndGggPiAwID8gbm9ybWFsaXplZCA6ICdtZW1iZXInO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVNY3BUcmFuc3BvcnQodHlwZTogc3RyaW5nKTogWmVyb0NsYXdNY3BTZXJ2ZXJDb25maWdbJ3RyYW5zcG9ydCddIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHR5cGUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnc3NlJykgcmV0dXJuICdzc2UnO1xuICBpZiAobm9ybWFsaXplZCA9PT0gJ3N0cmVhbWFibGVodHRwJyB8fCBub3JtYWxpemVkID09PSAnaHR0cCcpIHJldHVybiAnaHR0cCc7XG4gIHJldHVybiAnc3RkaW8nO1xufVxuXG5mdW5jdGlvbiBzYW5pdGl6ZU1jcFNlcnZlck5hbWUocmF3OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gcmF3LnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05Xy1dKy9nLCAnXycpO1xuICByZXR1cm4gbm9ybWFsaXplZC5sZW5ndGggPiAwID8gbm9ybWFsaXplZCA6ICdtY3Bfc2VydmVyJztcbn1cblxuZnVuY3Rpb24gdG9TdHJpbmdNYXAoaW5wdXQ/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIGlmICghaW5wdXQpIHJldHVybiB7fTtcbiAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKGlucHV0KS5maWx0ZXIoXG4gICAgKFtrZXksIHZhbHVlXSkgPT4ga2V5LnRyaW0oKS5sZW5ndGggPiAwICYmIHZhbHVlLnRyaW0oKS5sZW5ndGggPiAwLFxuICApO1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKGVudHJpZXMpO1xufVxuXG5mdW5jdGlvbiBtYXBNY3BTZXJ2ZXJUb1plcm9DbGF3KHNlcnZlcjogTWNwU2VydmVyQ29uZmlnKTogWmVyb0NsYXdNY3BTZXJ2ZXJDb25maWcgfCBudWxsIHtcbiAgY29uc3QgdHJhbnNwb3J0ID0gbm9ybWFsaXplTWNwVHJhbnNwb3J0KHNlcnZlci50eXBlID8/ICdzdGRpbycpO1xuICBjb25zdCBuYW1lID0gc2FuaXRpemVNY3BTZXJ2ZXJOYW1lKHNlcnZlci5pZCB8fCBzZXJ2ZXIubmFtZSk7XG4gIGNvbnN0IHJhd1RpbWVvdXQgPVxuICAgIHR5cGVvZiBzZXJ2ZXIudGltZW91dCA9PT0gJ251bWJlcicgJiYgTnVtYmVyLmlzRmluaXRlKHNlcnZlci50aW1lb3V0KSAmJiBzZXJ2ZXIudGltZW91dCA+IDBcbiAgICAgID8gc2VydmVyLnRpbWVvdXRcbiAgICAgIDogdW5kZWZpbmVkO1xuICBjb25zdCB0aW1lb3V0ID1cbiAgICByYXdUaW1lb3V0ID09PSB1bmRlZmluZWRcbiAgICAgID8gdW5kZWZpbmVkXG4gICAgICA6IE1hdGgubWF4KDEsIE1hdGgubWluKDYwMCwgTWF0aC5jZWlsKHJhd1RpbWVvdXQgPiAxMDAwID8gcmF3VGltZW91dCAvIDEwMDAgOiByYXdUaW1lb3V0KSkpO1xuXG4gIGlmICh0cmFuc3BvcnQgPT09ICdzdGRpbycpIHtcbiAgICBjb25zdCBjb21tYW5kID0gKHNlcnZlci5jb21tYW5kID8/IHNlcnZlci5wYXRoID8/ICcnKS50cmltKCk7XG4gICAgaWYgKCFjb21tYW5kKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4ge1xuICAgICAgbmFtZSxcbiAgICAgIHRyYW5zcG9ydCxcbiAgICAgIGNvbW1hbmQsXG4gICAgICBhcmdzOiAoc2VydmVyLmFyZ3MgPz8gW10pLmZpbHRlcigoaXRlbSkgPT4gaXRlbS50cmltKCkubGVuZ3RoID4gMCksXG4gICAgICBlbnY6IHRvU3RyaW5nTWFwKHNlcnZlci5lbnYpLFxuICAgICAgaGVhZGVyczoge30sXG4gICAgICB0b29sVGltZW91dFNlY3M6IHRpbWVvdXQsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IHVybCA9IChzZXJ2ZXIudXJsID8/ICcnKS50cmltKCk7XG4gIGlmICghdXJsKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHtcbiAgICBuYW1lLFxuICAgIHRyYW5zcG9ydCxcbiAgICB1cmwsXG4gICAgYXJnczogW10sXG4gICAgZW52OiB7fSxcbiAgICBoZWFkZXJzOiB0b1N0cmluZ01hcChzZXJ2ZXIuaGVhZGVycyksXG4gICAgdG9vbFRpbWVvdXRTZWNzOiB0aW1lb3V0LFxuICB9O1xufVxuXG5mdW5jdGlvbiByZXNvbHZlTWVtYmVyQWxsb3dlZFRvb2xzKFxuICBtZW1iZXI6IEFnZW50VGVhbU1lbWJlcixcbiAgbWNwU2VydmVyTmFtZXM6IHJlYWRvbmx5IHN0cmluZ1tdLFxuKTogc3RyaW5nW10ge1xuICBjb25zdCBlbmFibGVkID0gbmV3IFNldCgobWVtYmVyLmFsbG93ZWRUb29scyA/PyBbXSkubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pKTtcbiAgY29uc3QgdG9vbFBlcm1pc3Npb25zID0gbWVtYmVyLnRvb2xQZXJtaXNzaW9ucyA/PyBbXTtcbiAgaWYgKGVuYWJsZWQuc2l6ZSA9PT0gMCAmJiB0b29sUGVybWlzc2lvbnMubGVuZ3RoID4gMCkge1xuICAgIHRvb2xQZXJtaXNzaW9uc1xuICAgICAgLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5lbmFibGVkKVxuICAgICAgLmZvckVhY2goKGl0ZW0pID0+IHtcbiAgICAgICAgaWYgKGl0ZW0uaWQudHJpbSgpKSBlbmFibGVkLmFkZChpdGVtLmlkLnRyaW0oKSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIGNvbnN0IG1hcHBlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGtleSBvZiBlbmFibGVkKSB7XG4gICAgY29uc3QgdG9vbHMgPSBURUFNX1RPT0xfVE9fWkVST0NMQVdfVE9PTFNba2V5XTtcbiAgICBpZiAodG9vbHMpIHtcbiAgICAgIHRvb2xzLmZvckVhY2goKHRvb2wpID0+IG1hcHBlZC5hZGQodG9vbCkpO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGFsbG93TWNwID0gZW5hYmxlZC5oYXMoJ21jcF90b29scycpO1xuICBpZiAoYWxsb3dNY3ApIHtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgbWNwU2VydmVyTmFtZXMpIHtcbiAgICAgIG1hcHBlZC5hZGQobmFtZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIEFycmF5LmZyb20obWFwcGVkLnZhbHVlcygpKTtcbn1cblxuZnVuY3Rpb24gZW5zdXJlVW5pcXVlRm9sZGVyTmFtZShiYXNlTmFtZTogc3RyaW5nLCB1c2VkOiBTZXQ8c3RyaW5nPik6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBiYXNlTmFtZS50cmltKCkucmVwbGFjZSgvW1xcXFwvOio/XCI8PnxdL2csICdfJykgfHwgJ3NraWxsJztcbiAgaWYgKCF1c2VkLmhhcyhub3JtYWxpemVkKSkge1xuICAgIHVzZWQuYWRkKG5vcm1hbGl6ZWQpO1xuICAgIHJldHVybiBub3JtYWxpemVkO1xuICB9XG4gIGxldCBpbmRleCA9IDI7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gYCR7bm9ybWFsaXplZH1fJHtpbmRleH1gO1xuICAgIGlmICghdXNlZC5oYXMoY2FuZGlkYXRlKSkge1xuICAgICAgdXNlZC5hZGQoY2FuZGlkYXRlKTtcbiAgICAgIHJldHVybiBjYW5kaWRhdGU7XG4gICAgfVxuICAgIGluZGV4ICs9IDE7XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUmVzb3VyY2VTZWxlY3Rpb25JZChyYXc6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSByYXcudHJpbSgpO1xuICBpZiAoIXRyaW1tZWQpIHJldHVybiAnJztcbiAgY29uc3QgbWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9eKD86YXBwfHNoYXJlZHxnbG9iYWx8YWdlbnQpOiguKykkLyk7XG4gIGlmIChtYXRjaD8uWzFdKSB7XG4gICAgcmV0dXJuIG1hdGNoWzFdLnRyaW0oKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbWF0ZXJpYWxpemVXb3Jrc3BhY2VTa2lsbHMocHJvZmlsZTogQWdlbnRQcm9maWxlLCB3b3Jrc3BhY2VSb290OiBzdHJpbmcsIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBzaGFyZWRXb3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgdGFyZ2V0U2tpbGxzUm9vdCA9IHBhdGguam9pbih3b3Jrc3BhY2VSb290LCAnc2tpbGxzJyk7XG5cbiAgYXdhaXQgcm0odGFyZ2V0U2tpbGxzUm9vdCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICBhd2FpdCBlbnN1cmVEaXJlY3RvcnkodGFyZ2V0U2tpbGxzUm9vdCk7XG5cbiAgY29uc3QgdXNlZE5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IGVuYWJsZWRTa2lsbFNldCA9IG5ldyBTZXQoXG4gICAgKHByb2ZpbGUuc2tpbGxzLnByaXZhdGVTa2lsbHMgPz8gW10pXG4gICAgICAubWFwKChpdGVtKSA9PiBub3JtYWxpemVSZXNvdXJjZVNlbGVjdGlvbklkKGl0ZW0pKVxuICAgICAgLmZpbHRlcihCb29sZWFuKSxcbiAgKTtcblxuICBpZiAoZW5hYmxlZFNraWxsU2V0LnNpemUgPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGdsb2JhbEVudHJpZXMgPSBhd2FpdCByZWFkZGlyKHNoYXJlZFdvcmtzcGFjZS5zaGFyZWRTa2lsbHNSb290LCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBnbG9iYWxFbnRyaWVzKSB7XG4gICAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFlbmFibGVkU2tpbGxTZXQuaGFzKGVudHJ5Lm5hbWUpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHNvdXJjZSA9IHBhdGguam9pbihzaGFyZWRXb3Jrc3BhY2Uuc2hhcmVkU2tpbGxzUm9vdCwgZW50cnkubmFtZSk7XG4gICAgICBjb25zdCB0YXJnZXROYW1lID0gZW5zdXJlVW5pcXVlRm9sZGVyTmFtZShlbnRyeS5uYW1lLCB1c2VkTmFtZXMpO1xuICAgICAgYXdhaXQgY3Aoc291cmNlLCBwYXRoLmpvaW4odGFyZ2V0U2tpbGxzUm9vdCwgdGFyZ2V0TmFtZSksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cbiAgfSBjYXRjaCB7XG4gICAgLy8gaWdub3JlIGdsb2JhbCBza2lsbHMgY29weSBlcnJvcnNcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBjb2xsZWN0QWN0aXZlTWNwU2VydmVycyhwcm9maWxlOiBBZ2VudFByb2ZpbGUsIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IFByb21pc2U8WmVyb0NsYXdNY3BTZXJ2ZXJDb25maWdbXT4ge1xuICBjb25zdCBzaGFyZWRXb3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UoaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgZ2xvYmFsU2VydmVycyA9IGF3YWl0IHJlYWRNY3BTZXJ2ZXJzRnJvbUZpbGUocGF0aC5qb2luKHNoYXJlZFdvcmtzcGFjZS5zaGFyZWRNY3BSb290LCAnc2VydmVycy5qc29uJykpO1xuICBjb25zdCBwcml2YXRlSWRzID0gbmV3IFNldChcbiAgICAocHJvZmlsZS5tY3AucHJpdmF0ZVNlcnZlcnMgPz8gW10pXG4gICAgICAubWFwKChpdGVtKSA9PiBub3JtYWxpemVSZXNvdXJjZVNlbGVjdGlvbklkKGl0ZW0pKVxuICAgICAgLmZpbHRlcihCb29sZWFuKSxcbiAgKTtcbiAgaWYgKHByaXZhdGVJZHMuc2l6ZSA9PT0gMCkge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IG1lcmdlZDogTWNwU2VydmVyQ29uZmlnW10gPSBnbG9iYWxTZXJ2ZXJzLmZpbHRlcihcbiAgICAoc2VydmVyKSA9PiBzZXJ2ZXIuZW5hYmxlZCAhPT0gZmFsc2UgJiYgcHJpdmF0ZUlkcy5oYXMoc2VydmVyLmlkKSxcbiAgKTtcblxuICBjb25zdCByZXN1bHQ6IFplcm9DbGF3TWNwU2VydmVyQ29uZmlnW10gPSBbXTtcbiAgY29uc3QgdXNlZE5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgc2VydmVyIG9mIG1lcmdlZCkge1xuICAgIGNvbnN0IG1hcHBlZCA9IG1hcE1jcFNlcnZlclRvWmVyb0NsYXcoc2VydmVyKTtcbiAgICBpZiAoIW1hcHBlZCkgY29udGludWU7XG4gICAgaWYgKHVzZWROYW1lcy5oYXMobWFwcGVkLm5hbWUpKSBjb250aW51ZTtcbiAgICB1c2VkTmFtZXMuYWRkKG1hcHBlZC5uYW1lKTtcbiAgICByZXN1bHQucHVzaChtYXBwZWQpO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIHBhcnNlVG9tbEFycmF5KHJhdzogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBtYXRjaCA9IHJhdy5tYXRjaCgvXFxbKC4qKVxcXS8pO1xuICBpZiAoIW1hdGNoPy5bMV0pIHJldHVybiBbXTtcbiAgcmV0dXJuIG1hdGNoWzFdXG4gICAgLnNwbGl0KCcsJylcbiAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgLm1hcCgoaXRlbSkgPT4gaXRlbS5yZXBsYWNlKC9eXCIoLiopXCIkLywgJyQxJykudHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVSdW50aW1lV2ViU2VhcmNoQ29uZmlnKGNvbmZpZ0Rpcjogc3RyaW5nKTogUHJvbWlzZTxSdW50aW1lV2ViU2VhcmNoQ29uZmlnPiB7XG4gIGNvbnN0IGNvbmZpZ1BhdGggPSBwYXRoLmpvaW4oY29uZmlnRGlyLCAnY29uZmlnLnRvbWwnKTtcbiAgbGV0IGN1cnJlbnRFbmFibGVkOiBib29sZWFuIHwgdW5kZWZpbmVkO1xuICBsZXQgY3VycmVudFByb3ZpZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIGxldCBjdXJyZW50QXBpS2V5OiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIGxldCBjdXJyZW50RmFsbGJhY2tQcm92aWRlcnM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkO1xuICBsZXQgY3VycmVudE1heFJlc3VsdHM6IG51bWJlciB8IHVuZGVmaW5lZDtcbiAgbGV0IGN1cnJlbnRUaW1lb3V0U2VjczogbnVtYmVyIHwgdW5kZWZpbmVkO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgcmF3ID0gYXdhaXQgcmVhZEZpbGUoY29uZmlnUGF0aCwgJ3V0Zi04Jyk7XG4gICAgY29uc3QgbGluZXMgPSByYXcuc3BsaXQoL1xccj9cXG4vKTtcbiAgICBsZXQgaW5XZWJTZWFyY2ggPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgICBpZiAoL15cXFtcXFsuKlxcXVxcXSQvLnRlc3QodHJpbW1lZCkgfHwgL15cXFsuKlxcXSQvLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgICAgaW5XZWJTZWFyY2ggPSB0cmltbWVkID09PSAnW3dlYl9zZWFyY2hdJztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoIWluV2ViU2VhcmNoKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgZW5hYmxlZE1hdGNoID0gdHJpbW1lZC5tYXRjaCgvXmVuYWJsZWRcXHMqPVxccyoodHJ1ZXxmYWxzZSkkL2kpO1xuICAgICAgaWYgKGVuYWJsZWRNYXRjaCkge1xuICAgICAgICBjdXJyZW50RW5hYmxlZCA9IGVuYWJsZWRNYXRjaFsxXS50b0xvd2VyQ2FzZSgpID09PSAndHJ1ZSc7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgcHJvdmlkZXJNYXRjaCA9IHRyaW1tZWQubWF0Y2goL15wcm92aWRlclxccyo9XFxzKlwiKFteXCJdKylcIiQvKTtcbiAgICAgIGlmIChwcm92aWRlck1hdGNoPy5bMV0pIHtcbiAgICAgICAgY3VycmVudFByb3ZpZGVyID0gcHJvdmlkZXJNYXRjaFsxXS50cmltKCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgYXBpS2V5TWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9eYXBpX2tleVxccyo9XFxzKlwiKFteXCJdKilcIiQvKTtcbiAgICAgIGlmIChhcGlLZXlNYXRjaCAmJiBhcGlLZXlNYXRjaFsxXS50cmltKCkpIHtcbiAgICAgICAgY3VycmVudEFwaUtleSA9IGFwaUtleU1hdGNoWzFdLnRyaW0oKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBmYWxsYmFja01hdGNoID0gdHJpbW1lZC5tYXRjaCgvXmZhbGxiYWNrX3Byb3ZpZGVyc1xccyo9XFxzKlxcWy4qXFxdJC8pO1xuICAgICAgaWYgKGZhbGxiYWNrTWF0Y2gpIHtcbiAgICAgICAgY3VycmVudEZhbGxiYWNrUHJvdmlkZXJzID0gcGFyc2VUb21sQXJyYXkodHJpbW1lZCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgbWF4UmVzdWx0c01hdGNoID0gdHJpbW1lZC5tYXRjaCgvXm1heF9yZXN1bHRzXFxzKj1cXHMqKFxcZCspJC8pO1xuICAgICAgaWYgKG1heFJlc3VsdHNNYXRjaD8uWzFdKSB7XG4gICAgICAgIGN1cnJlbnRNYXhSZXN1bHRzID0gTnVtYmVyKG1heFJlc3VsdHNNYXRjaFsxXSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgdGltZW91dE1hdGNoID0gdHJpbW1lZC5tYXRjaCgvXnRpbWVvdXRfc2Vjc1xccyo9XFxzKihcXGQrKSQvKTtcbiAgICAgIGlmICh0aW1lb3V0TWF0Y2g/LlsxXSkge1xuICAgICAgICBjdXJyZW50VGltZW91dFNlY3MgPSBOdW1iZXIodGltZW91dE1hdGNoWzFdKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gY2F0Y2gge1xuICAgIC8vIGlnbm9yZSBvbGQgY29uZmlnIHBhcnNlIGZhaWx1cmVcbiAgfVxuXG4gIGNvbnN0IGVudkFwaUtleSA9XG4gICAgcHJvY2Vzcy5lbnYuV0VCT1RfV0VCX1NFQVJDSF9BUElfS0VZPy50cmltKCkgfHxcbiAgICBwcm9jZXNzLmVudi5aRVJPQ0xBV19XRUJfU0VBUkNIX0FQSV9LRVk/LnRyaW0oKSB8fFxuICAgIHByb2Nlc3MuZW52LlRBVklMWV9BUElfS0VZPy50cmltKCkgfHxcbiAgICAnJztcblxuICBjb25zdCBhcGlLZXkgPSBlbnZBcGlLZXkgfHwgY3VycmVudEFwaUtleSB8fCB1bmRlZmluZWQ7XG4gIGNvbnN0IHByb3ZpZGVyID0gKGN1cnJlbnRQcm92aWRlciB8fCAoYXBpS2V5ID8gREVGQVVMVF9XRUJfU0VBUkNIX1BST1ZJREVSIDogJ2R1Y2tkdWNrZ28nKSkudHJpbSgpO1xuICBjb25zdCBmYWxsYmFja1Byb3ZpZGVycyA9XG4gICAgY3VycmVudEZhbGxiYWNrUHJvdmlkZXJzICYmIGN1cnJlbnRGYWxsYmFja1Byb3ZpZGVycy5sZW5ndGggPiAwXG4gICAgICA/IGN1cnJlbnRGYWxsYmFja1Byb3ZpZGVyc1xuICAgICAgOiBwcm92aWRlciA9PT0gJ2R1Y2tkdWNrZ28nXG4gICAgICAgID8gW11cbiAgICAgICAgOiBbJ2R1Y2tkdWNrZ28nXTtcbiAgY29uc3QgZW5hYmxlZCA9XG4gICAgdHlwZW9mIGN1cnJlbnRFbmFibGVkID09PSAnYm9vbGVhbidcbiAgICAgID8gY3VycmVudEVuYWJsZWRcbiAgICAgIDogcHJvdmlkZXIgPT09ICdkdWNrZHVja2dvJ1xuICAgICAgICA/IHRydWVcbiAgICAgICAgOiBCb29sZWFuKGFwaUtleSk7XG4gIGNvbnN0IG1heFJlc3VsdHMgPVxuICAgIHR5cGVvZiBjdXJyZW50TWF4UmVzdWx0cyA9PT0gJ251bWJlcicgJiYgTnVtYmVyLmlzRmluaXRlKGN1cnJlbnRNYXhSZXN1bHRzKSAmJiBjdXJyZW50TWF4UmVzdWx0cyA+PSAxXG4gICAgICA/IE1hdGgubWluKDEwLCBNYXRoLm1heCgxLCBNYXRoLmZsb29yKGN1cnJlbnRNYXhSZXN1bHRzKSkpXG4gICAgICA6IERFRkFVTFRfV0VCX1NFQVJDSF9NQVhfUkVTVUxUUztcbiAgY29uc3QgdGltZW91dFNlY3MgPVxuICAgIHR5cGVvZiBjdXJyZW50VGltZW91dFNlY3MgPT09ICdudW1iZXInICYmXG4gICAgTnVtYmVyLmlzRmluaXRlKGN1cnJlbnRUaW1lb3V0U2VjcykgJiZcbiAgICBjdXJyZW50VGltZW91dFNlY3MgPj0gMVxuICAgICAgPyBNYXRoLm1pbig2MCwgTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihjdXJyZW50VGltZW91dFNlY3MpKSlcbiAgICAgIDogREVGQVVMVF9XRUJfU0VBUkNIX1RJTUVPVVRfU0VDUztcblxuICByZXR1cm4ge1xuICAgIGVuYWJsZWQsXG4gICAgcHJvdmlkZXIsXG4gICAgZmFsbGJhY2tQcm92aWRlcnMsXG4gICAgYXBpS2V5LFxuICAgIG1heFJlc3VsdHMsXG4gICAgdGltZW91dFNlY3MsXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlbmRlclplcm9DbGF3Q29uZmlnVG9tbChcbiAgcHJvZmlsZTogQWdlbnRQcm9maWxlLFxuICBnYXRld2F5OiBaZXJvQ2xhd0dhdGV3YXlFbmRwb2ludCxcbiAgd29ya3NwYWNlUm9vdDogc3RyaW5nLFxuICBtY3BTZXJ2ZXJzOiByZWFkb25seSBaZXJvQ2xhd01jcFNlcnZlckNvbmZpZ1tdLFxuICB3ZWJTZWFyY2hDb25maWc6IFJ1bnRpbWVXZWJTZWFyY2hDb25maWcsXG4pOiBzdHJpbmcge1xuICBjb25zdCBtY3BTZXJ2ZXJOYW1lcyA9IG1jcFNlcnZlcnMubWFwKChzZXJ2ZXIpID0+IHNlcnZlci5uYW1lKTtcbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW1xuICAgICcjIEF1dG8tZ2VuZXJhdGVkIGJ5IHdlQm90LiBNYW51YWwgZWRpdHMgbWF5IGJlIG92ZXJ3cml0dGVuLicsXG4gICAgYHdvcmtzcGFjZV9kaXIgPSAke3JlbmRlclRvbWxTdHJpbmcod29ya3NwYWNlUm9vdCl9YCxcbiAgICAnJyxcbiAgICBgZGVmYXVsdF9wcm92aWRlciA9ICR7cmVuZGVyVG9tbFN0cmluZyhwcm9maWxlLmRlZmF1bHRMbG0ucHJvdmlkZXJJZCl9YCxcbiAgICBgZGVmYXVsdF9tb2RlbCA9ICR7cmVuZGVyVG9tbFN0cmluZyhwcm9maWxlLmRlZmF1bHRMbG0ubW9kZWxOYW1lKX1gLFxuICAgICdkZWZhdWx0X3RlbXBlcmF0dXJlID0gMC4yJyxcbiAgICAnJyxcbiAgICAnW2dhdGV3YXldJyxcbiAgICBgaG9zdCA9ICR7cmVuZGVyVG9tbFN0cmluZyhnYXRld2F5Lmhvc3QpfWAsXG4gICAgYHBvcnQgPSAke2dhdGV3YXkucG9ydH1gLFxuICAgICdyZXF1aXJlX3BhaXJpbmcgPSBmYWxzZScsXG4gICAgJ2FsbG93X3B1YmxpY19iaW5kID0gZmFsc2UnLFxuICAgIGByZXF1ZXN0X3RpbWVvdXRfc2VjcyA9ICR7REVGQVVMVF9HQVRFV0FZX1JFUVVFU1RfVElNRU9VVF9TRUNTfWAsXG4gICAgJycsXG4gICAgJ1thZ2VudF0nLFxuICAgICdjb21wYWN0X2NvbnRleHQgPSB0cnVlJyxcbiAgICAnbWF4X3Rvb2xfaXRlcmF0aW9ucyA9IDgnLFxuICAgICcnLFxuICAgICdbYXV0b25vbXldJyxcbiAgICAnbGV2ZWwgPSBcInN1cGVydmlzZWRcIicsXG4gICAgJ3dvcmtzcGFjZV9vbmx5ID0gdHJ1ZScsXG4gICAgYGFsbG93ZWRfY29tbWFuZHMgPSAke3JlbmRlclRvbWxTdHJpbmdBcnJheShERUZBVUxUX0FVVE9OT01ZX0FMTE9XRURfQ09NTUFORFMpfWAsXG4gICAgYGZvcmJpZGRlbl9wYXRocyA9ICR7cmVuZGVyVG9tbFN0cmluZ0FycmF5KERFRkFVTFRfQVVUT05PTVlfRk9SQklEREVOX1BBVEhTKX1gLFxuICAgIGBtYXhfYWN0aW9uc19wZXJfaG91ciA9ICR7REVGQVVMVF9BVVRPTk9NWV9NQVhfQUNUSU9OU19QRVJfSE9VUn1gLFxuICAgIGBtYXhfY29zdF9wZXJfZGF5X2NlbnRzID0gJHtERUZBVUxUX0FVVE9OT01ZX01BWF9DT1NUX1BFUl9EQVlfQ0VOVFN9YCxcbiAgICAncmVxdWlyZV9hcHByb3ZhbF9mb3JfbWVkaXVtX3Jpc2sgPSB0cnVlJyxcbiAgICAnYmxvY2tfaGlnaF9yaXNrX2NvbW1hbmRzID0gdHJ1ZScsXG4gICAgJ3NoZWxsX2Vudl9wYXNzdGhyb3VnaCA9IFtdJyxcbiAgICAnYWxsb3dlZF9yb290cyA9IFtdJyxcbiAgICBgYXV0b19hcHByb3ZlID0gJHtyZW5kZXJUb21sU3RyaW5nQXJyYXkoREVGQVVMVF9BVVRPTk9NWV9BVVRPX0FQUFJPVkVfVE9PTFMpfWAsXG4gICAgJ2Fsd2F5c19hc2sgPSBbXScsXG4gICAgJycsXG4gICAgJ1tzY2hlZHVsZXJdJyxcbiAgICAnZW5hYmxlZCA9IHRydWUnLFxuICAgICdtYXhfdGFza3MgPSAyNTYnLFxuICAgICdtYXhfY29uY3VycmVudCA9IDQnLFxuICAgICcnLFxuICAgICdbY3Jvbl0nLFxuICAgICdlbmFibGVkID0gdHJ1ZScsXG4gICAgJ21heF9ydW5faGlzdG9yeSA9IDIwMCcsXG4gICAgJycsXG4gICAgJ1tyZWxpYWJpbGl0eV0nLFxuICAgICdzY2hlZHVsZXJfcG9sbF9zZWNzID0gMTUnLFxuICAgICdzY2hlZHVsZXJfcmV0cmllcyA9IDInLFxuICAgICcnLFxuICAgICdbbWVtb3J5XScsXG4gICAgJ2JhY2tlbmQgPSBcInNxbGl0ZVwiJyxcbiAgICAnYXV0b19zYXZlID0gdHJ1ZScsXG4gICAgJ2VtYmVkZGluZ19wcm92aWRlciA9IFwibm9uZVwiJyxcbiAgICAndmVjdG9yX3dlaWdodCA9IDAuNycsXG4gICAgJ2tleXdvcmRfd2VpZ2h0ID0gMC4zJyxcbiAgICAnJyxcbiAgICAnW3NraWxsc10nLFxuICAgICdvcGVuX3NraWxsc19lbmFibGVkID0gZmFsc2UnLFxuICAgICdhbGxvd19zY3JpcHRzID0gZmFsc2UnLFxuICAgICdwcm9tcHRfaW5qZWN0aW9uX21vZGUgPSBcImNvbXBhY3RcIicsXG4gICAgJycsXG4gICAgJ1t3ZWJfc2VhcmNoXScsXG4gICAgYGVuYWJsZWQgPSAke3dlYlNlYXJjaENvbmZpZy5lbmFibGVkID8gJ3RydWUnIDogJ2ZhbHNlJ31gLFxuICAgIGBwcm92aWRlciA9ICR7cmVuZGVyVG9tbFN0cmluZyh3ZWJTZWFyY2hDb25maWcucHJvdmlkZXIpfWAsXG4gICAgLi4uKHdlYlNlYXJjaENvbmZpZy5hcGlLZXk/LnRyaW0oKVxuICAgICAgPyBbYGFwaV9rZXkgPSAke3JlbmRlclRvbWxTdHJpbmcod2ViU2VhcmNoQ29uZmlnLmFwaUtleS50cmltKCkpfWBdXG4gICAgICA6IFtdKSxcbiAgICBgZmFsbGJhY2tfcHJvdmlkZXJzID0gJHtyZW5kZXJUb21sU3RyaW5nQXJyYXkod2ViU2VhcmNoQ29uZmlnLmZhbGxiYWNrUHJvdmlkZXJzKX1gLFxuICAgIGBtYXhfcmVzdWx0cyA9ICR7d2ViU2VhcmNoQ29uZmlnLm1heFJlc3VsdHN9YCxcbiAgICBgdGltZW91dF9zZWNzID0gJHt3ZWJTZWFyY2hDb25maWcudGltZW91dFNlY3N9YCxcbiAgICAnJyxcbiAgICAnW21jcF0nLFxuICAgIGBlbmFibGVkID0gJHttY3BTZXJ2ZXJzLmxlbmd0aCA+IDAgPyAndHJ1ZScgOiAnZmFsc2UnfWAsXG4gIF07XG5cbiAgZm9yIChjb25zdCBzZXJ2ZXIgb2YgbWNwU2VydmVycykge1xuICAgIGxpbmVzLnB1c2goJycpO1xuICAgIGxpbmVzLnB1c2goJ1tbbWNwLnNlcnZlcnNdXScpO1xuICAgIGxpbmVzLnB1c2goYG5hbWUgPSAke3JlbmRlclRvbWxTdHJpbmcoc2VydmVyLm5hbWUpfWApO1xuICAgIGxpbmVzLnB1c2goYHRyYW5zcG9ydCA9ICR7cmVuZGVyVG9tbFN0cmluZyhzZXJ2ZXIudHJhbnNwb3J0KX1gKTtcbiAgICBpZiAoc2VydmVyLnRyYW5zcG9ydCA9PT0gJ3N0ZGlvJykge1xuICAgICAgbGluZXMucHVzaChgY29tbWFuZCA9ICR7cmVuZGVyVG9tbFN0cmluZyhzZXJ2ZXIuY29tbWFuZCA/PyAnJyl9YCk7XG4gICAgICBsaW5lcy5wdXNoKGBhcmdzID0gJHtyZW5kZXJUb21sU3RyaW5nQXJyYXkoc2VydmVyLmFyZ3MpfWApO1xuICAgICAgaWYgKHNlcnZlci50b29sVGltZW91dFNlY3MpIHtcbiAgICAgICAgbGluZXMucHVzaChgdG9vbF90aW1lb3V0X3NlY3MgPSAke3NlcnZlci50b29sVGltZW91dFNlY3N9YCk7XG4gICAgICB9XG4gICAgICBpZiAoT2JqZWN0LmtleXMoc2VydmVyLmVudikubGVuZ3RoID4gMCkge1xuICAgICAgICBsaW5lcy5wdXNoKCdbbWNwLnNlcnZlcnMuZW52XScpO1xuICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzZXJ2ZXIuZW52KSkge1xuICAgICAgICAgIGxpbmVzLnB1c2goYCR7cmVuZGVyVG9tbFN0cmluZyhrZXkpfSA9ICR7cmVuZGVyVG9tbFN0cmluZyh2YWx1ZSl9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbGluZXMucHVzaChgdXJsID0gJHtyZW5kZXJUb21sU3RyaW5nKHNlcnZlci51cmwgPz8gJycpfWApO1xuICAgICAgaWYgKHNlcnZlci50b29sVGltZW91dFNlY3MpIHtcbiAgICAgICAgbGluZXMucHVzaChgdG9vbF90aW1lb3V0X3NlY3MgPSAke3NlcnZlci50b29sVGltZW91dFNlY3N9YCk7XG4gICAgICB9XG4gICAgICBpZiAoT2JqZWN0LmtleXMoc2VydmVyLmhlYWRlcnMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbGluZXMucHVzaCgnW21jcC5zZXJ2ZXJzLmhlYWRlcnNdJyk7XG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNlcnZlci5oZWFkZXJzKSkge1xuICAgICAgICAgIGxpbmVzLnB1c2goYCR7cmVuZGVyVG9tbFN0cmluZyhrZXkpfSA9ICR7cmVuZGVyVG9tbFN0cmluZyh2YWx1ZSl9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBtZW1iZXJzID0gcHJvZmlsZS50ZWFtPy5tZW1iZXJzID8/IFtdO1xuICBjb25zdCB1c2VkTWVtYmVyU2VjdGlvbk5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgbWVtYmVyIG9mIG1lbWJlcnMpIHtcbiAgICBjb25zdCBiYXNlTmFtZSA9IHNhbml0aXplVG9tbFNlY3Rpb25OYW1lKG1lbWJlci5pZCB8fCBtZW1iZXIubmFtZSk7XG4gICAgbGV0IHNlY3Rpb25OYW1lID0gYmFzZU5hbWU7XG4gICAgbGV0IHN1ZmZpeCA9IDI7XG4gICAgd2hpbGUgKHVzZWRNZW1iZXJTZWN0aW9uTmFtZXMuaGFzKHNlY3Rpb25OYW1lKSkge1xuICAgICAgc2VjdGlvbk5hbWUgPSBgJHtiYXNlTmFtZX1fJHtzdWZmaXh9YDtcbiAgICAgIHN1ZmZpeCArPSAxO1xuICAgIH1cbiAgICB1c2VkTWVtYmVyU2VjdGlvbk5hbWVzLmFkZChzZWN0aW9uTmFtZSk7XG5cbiAgICBjb25zdCBhbGxvd2VkVG9vbHMgPSByZXNvbHZlTWVtYmVyQWxsb3dlZFRvb2xzKG1lbWJlciwgbWNwU2VydmVyTmFtZXMpO1xuICAgIGxpbmVzLnB1c2goJycpO1xuICAgIGxpbmVzLnB1c2goYFthZ2VudHMuJHtzZWN0aW9uTmFtZX1dYCk7XG4gICAgbGluZXMucHVzaChgcHJvdmlkZXIgPSAke3JlbmRlclRvbWxTdHJpbmcobWVtYmVyLnByb3ZpZGVySWQpfWApO1xuICAgIGxpbmVzLnB1c2goYG1vZGVsID0gJHtyZW5kZXJUb21sU3RyaW5nKG1lbWJlci5tb2RlbE5hbWUpfWApO1xuICAgIGxpbmVzLnB1c2goYHN5c3RlbV9wcm9tcHQgPSAke3JlbmRlclRvbWxTdHJpbmcobWVtYmVyLnN5c3RlbVByb21wdCB8fCBgXHU0RjYwXHU2NjJGXHU1NkUyXHU5NjFGXHU2MjEwXHU1NDU4ICR7bWVtYmVyLm5hbWV9XHUzMDAyYCl9YCk7XG4gICAgbGluZXMucHVzaCgnYWdlbnRpYyA9IHRydWUnKTtcbiAgICBpZiAoYWxsb3dlZFRvb2xzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxpbmVzLnB1c2goYGFsbG93ZWRfdG9vbHMgPSAke3JlbmRlclRvbWxTdHJpbmdBcnJheShhbGxvd2VkVG9vbHMpfWApO1xuICAgIH1cbiAgICBsaW5lcy5wdXNoKCdtYXhfaXRlcmF0aW9ucyA9IDYnKTtcbiAgfVxuXG4gIHJldHVybiBgJHtsaW5lcy5qb2luKCdcXG4nKX1cXG5gO1xufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZVdvcmtzcGFjZUlkZW50aXR5UHJvbXB0KHByb2ZpbGU6IEFnZW50UHJvZmlsZSwgd29ya3NwYWNlUm9vdDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGdsb2JhbFN5c3RlbVByb21wdCA9IGF3YWl0IGxvYWRHbG9iYWxTeXN0ZW1Qcm9tcHQoKTtcbiAgY29uc3QgcHJvbXB0TGluZXM6IHN0cmluZ1tdID0gW107XG4gIGlmIChnbG9iYWxTeXN0ZW1Qcm9tcHQ/LnRyaW0oKSkge1xuICAgIHByb21wdExpbmVzLnB1c2goZ2xvYmFsU3lzdGVtUHJvbXB0LnRyaW0oKSwgJycpO1xuICB9XG4gIHByb21wdExpbmVzLnB1c2goXG4gICAgJyMgXHU4OUQyXHU4MjcyXHU3Q0ZCXHU3RURGXHU2M0QwXHU3OTNBXHU4QkNEJyxcbiAgICBwcm9maWxlLnN5c3RlbVByb21wdC50cmltKCkgfHwgJ1x1RkYwOFx1N0E3QVx1RkYwOScsXG4gICAgJycsXG4gICAgJyMgXHU4OUQyXHU4MjcyXHU2NDU4XHU4OTgxJyxcbiAgICBwcm9maWxlLnN1bW1hcnk/LnRyaW0oKSB8fCAnXHVGRjA4XHU3QTdBXHVGRjA5JyxcbiAgICAnJyxcbiAgICAnIyBcdTg5RDJcdTgyNzJcdTcwNzVcdTlCNDInLFxuICAgIHByb2ZpbGUuc291bD8udHJpbSgpIHx8ICdcdUZGMDhcdTdBN0FcdUZGMDknLFxuICApO1xuXG4gIGNvbnN0IHByb21wdFBhdGggPSBwYXRoLmpvaW4od29ya3NwYWNlUm9vdCwgJ0FHRU5UUy5tZCcpO1xuICBhd2FpdCB3cml0ZUZpbGUocHJvbXB0UGF0aCwgcHJvbXB0TGluZXMuam9pbignXFxuJyksICd1dGYtOCcpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwcmVwYXJlWmVyb0NsYXdSdW50aW1lRmlsZXMoXG4gIHByb2ZpbGU6IEFnZW50UHJvZmlsZSxcbiAgY29uZmlnRGlyOiBzdHJpbmcsXG4gIGdhdGV3YXk6IFplcm9DbGF3R2F0ZXdheUVuZHBvaW50LFxuICBtY3BTZXJ2ZXJzOiByZWFkb25seSBaZXJvQ2xhd01jcFNlcnZlckNvbmZpZ1tdLFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3Qgd29ya3NwYWNlUm9vdCA9IHBhdGguam9pbihjb25maWdEaXIsICd3b3Jrc3BhY2UnKTtcbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KHdvcmtzcGFjZVJvb3QpO1xuICBhd2FpdCBlbnN1cmVEaXJlY3RvcnkocGF0aC5qb2luKHdvcmtzcGFjZVJvb3QsICdzdGF0ZScpKTtcbiAgYXdhaXQgbWF0ZXJpYWxpemVXb3Jrc3BhY2VTa2lsbHMocHJvZmlsZSwgd29ya3NwYWNlUm9vdCwgaG9tZURpck92ZXJyaWRlKTtcbiAgYXdhaXQgd3JpdGVXb3Jrc3BhY2VJZGVudGl0eVByb21wdChwcm9maWxlLCB3b3Jrc3BhY2VSb290KTtcbiAgY29uc3Qgd2ViU2VhcmNoQ29uZmlnID0gYXdhaXQgcmVzb2x2ZVJ1bnRpbWVXZWJTZWFyY2hDb25maWcoY29uZmlnRGlyKTtcbiAgY29uc3QgY29uZmlnVG9tbCA9IHJlbmRlclplcm9DbGF3Q29uZmlnVG9tbChcbiAgICBwcm9maWxlLFxuICAgIGdhdGV3YXksXG4gICAgd29ya3NwYWNlUm9vdCxcbiAgICBtY3BTZXJ2ZXJzLFxuICAgIHdlYlNlYXJjaENvbmZpZyxcbiAgKTtcbiAgYXdhaXQgd3JpdGVGaWxlKHBhdGguam9pbihjb25maWdEaXIsICdjb25maWcudG9tbCcpLCBjb25maWdUb21sLCAndXRmLTgnKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVByb3ZpZGVyU2VjcmV0cyhwcm92aWRlcklkOiBzdHJpbmcsIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IFByb21pc2U8e1xuICBhcGlLZXk/OiBzdHJpbmc7XG4gIGFwaUJhc2U/OiBzdHJpbmc7XG59PiB7XG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IGVuc3VyZVplcm9DbGF3Q29uZmlnKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGNvbm5lY3Rpb24gPSBjb25maWcucHJvdmlkZXJDb25uZWN0aW9ucy5maW5kKChpdGVtKSA9PiBpdGVtLnByb3ZpZGVySWQgPT09IHByb3ZpZGVySWQpO1xuXG4gIHJldHVybiB7XG4gICAgYXBpS2V5OiBjb25uZWN0aW9uPy5hcGlLZXlQbGFpbnRleHQsXG4gICAgYXBpQmFzZTogY29ubmVjdGlvbj8uYXBpQmFzZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlWmVyb0NsYXdDb25maWdEaXIoYWdlbnRJZDogc3RyaW5nLCBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCB3b3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVBZ2VudFdvcmtzcGFjZShhZ2VudElkLCBob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBjb25maWdEaXIgPSBwYXRoLmpvaW4od29ya3NwYWNlLmFnZW50Um9vdCwgJ3plcm9jbGF3Jyk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShjb25maWdEaXIpO1xuICByZXR1cm4gY29uZmlnRGlyO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVTdGF0dXMoYWdlbnRJZDogc3RyaW5nLCBlbnRyeTogUHJvY2Vzc0VudHJ5KTogdm9pZCB7XG4gIGFnZW50UHJvY2Vzc2VzLnNldChhZ2VudElkLCBlbnRyeSk7XG59XG5cbmZ1bmN0aW9uIHRvdWNoT3V0cHV0KGFnZW50SWQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBlbnRyeSA9IGFnZW50UHJvY2Vzc2VzLmdldChhZ2VudElkKTtcbiAgaWYgKCFlbnRyeSkgcmV0dXJuO1xuICBlbnRyeS5sYXN0T3V0cHV0QXQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gIGFnZW50UHJvY2Vzc2VzLnNldChhZ2VudElkLCBlbnRyeSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNsZWVwKG1zOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckdhdGV3YXlSZWFkeShcbiAgZ2F0ZXdheTogWmVyb0NsYXdHYXRld2F5RW5kcG9pbnQsXG4gIHRpbWVvdXRNcyA9IEdBVEVXQVlfUkVBRFlfVElNRU9VVF9NUyxcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBoZWFsdGhVcmwgPSBgJHtnYXRld2F5LmJhc2VVcmx9L2hlYWx0aGA7XG4gIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIHRpbWVvdXRNcztcblxuICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7XG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCByZXF1ZXN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSwgMzAwMCk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goaGVhbHRoVXJsLCB7IG1ldGhvZDogJ0dFVCcsIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwgfSk7XG4gICAgICBpZiAocmVzcG9uc2Uub2spIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHJlcXVlc3RUaW1lcik7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gaWdub3JlIGFuZCByZXRyeSB1bnRpbCB0aW1lb3V0XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNsZWFyVGltZW91dChyZXF1ZXN0VGltZXIpO1xuICAgIH1cbiAgICBhd2FpdCBzbGVlcChHQVRFV0FZX1JFQURZX1BPTExfSU5URVJWQUxfTVMpO1xuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXN0R2F0ZXdheUNyb25Kb2JzKGdhdGV3YXlCYXNlVXJsOiBzdHJpbmcpOiBQcm9taXNlPEdhdGV3YXlDcm9uSm9iW10+IHtcbiAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSwgVEFTS19TWU5DX1RJTUVPVVRfTVMpO1xuICB0cnkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goYCR7Z2F0ZXdheUJhc2VVcmwucmVwbGFjZSgvXFwvKyQvLCAnJyl9L2FwaS9jcm9uYCwge1xuICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgfSk7XG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBjcm9uIFx1NTIxN1x1ODg2OFx1OEJGN1x1NkM0Mlx1NTkzMVx1OEQyNSAoJHtyZXNwb25zZS5zdGF0dXN9KWApO1xuICAgIH1cbiAgICBjb25zdCBwYXlsb2FkID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgeyBqb2JzPzogR2F0ZXdheUNyb25Kb2JbXSB9O1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KHBheWxvYWQuam9icykgPyBwYXlsb2FkLmpvYnMgOiBbXTtcbiAgfSBmaW5hbGx5IHtcbiAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRvVGFza1NuYXBzaG90VG9rZW4oam9iOiBHYXRld2F5Q3JvbkpvYik6IHN0cmluZyB7XG4gIHJldHVybiBbXG4gICAgU3RyaW5nKGpvYi5lbmFibGVkKSxcbiAgICBqb2IubmV4dF9ydW4gfHwgJycsXG4gICAgam9iLmxhc3RfcnVuIHx8ICcnLFxuICAgIGpvYi5sYXN0X3N0YXR1cyB8fCAnJyxcbiAgICByZXNvbHZlQ3JvbkpvYk91dHB1dChqb2IpIHx8ICcnLFxuICBdLmpvaW4oJ3wnKTtcbn1cblxuZnVuY3Rpb24gcmVzb2x2ZUNyb25Kb2JPdXRwdXQoam9iOiBHYXRld2F5Q3JvbkpvYik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBjYW5kaWRhdGVzID0gW1xuICAgIGpvYi5sYXN0X291dHB1dCxcbiAgICBqb2Iub3V0cHV0LFxuICAgIGpvYi5sYXN0X3Jlc3VsdCxcbiAgICBqb2IucmVzdWx0LFxuICAgIGpvYi5sYXN0X21lc3NhZ2UsXG4gICAgam9iLm1lc3NhZ2UsXG4gIF07XG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ3N0cmluZycgJiYgY2FuZGlkYXRlLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlLnRyaW0oKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUNyb25SdW5PdXRwdXQocmF3Pzogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGNvbXBhY3QgPSByYXcucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKTtcbiAgaWYgKCFjb21wYWN0KSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIGNvbXBhY3Quc2xpY2UoMCwgMTIwMCk7XG59XG5cbmZ1bmN0aW9uIHNhbml0aXplU2NoZWR1bGVkQWdlbnRQcm9tcHQocmF3UHJvbXB0OiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCB0YXNrTmFtZT86IHN0cmluZyB8IG51bGwpOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gKHJhd1Byb21wdCA/PyAnJykucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKTtcbiAgbGV0IGJ1c2luZXNzID0gbm9ybWFsaXplZFxuICAgIC5yZXBsYWNlKC9eXHU1M0VBXHU1MDVBXHU0RTFBXHU1MkExXHU2MjY3XHU4ODRDWzpcdUZGMUFdP1xccyovaSwgJycpXG4gICAgLnJlcGxhY2UoVEFTS19BR0VOVF9GT1JCSURERU5fUFJPTVBUX1BBVFRFUk4sICcnKVxuICAgIC5yZXBsYWNlKFRBU0tfQUdFTlRfTk9JU0VfUEFUVEVSTiwgJycpXG4gICAgLnJlcGxhY2UoL1xccysvZywgJyAnKVxuICAgIC50cmltKCk7XG5cbiAgaWYgKCFidXNpbmVzcykge1xuICAgIGJ1c2luZXNzID0gdGFza05hbWU/LnRyaW0oKSA/IGBcdTYzMDlcdTRFRkJcdTUyQTFcdTc2RUVcdTY4MDdcdTYyNjdcdTg4NENcdUZGMUEke3Rhc2tOYW1lLnRyaW0oKX1gIDogJ1x1NjI2N1x1ODg0Q1x1NEVGQlx1NTJBMVx1NUU3Nlx1OEZENFx1NTZERVx1N0I4MFx1ODk4MVx1NEUxQVx1NTJBMVx1N0VEM1x1Njc5Q1x1MzAwMic7XG4gIH1cbiAgaWYgKGJ1c2luZXNzLmxlbmd0aCA+IFRBU0tfQUdFTlRfUFJPTVBUX01BWF9MRU5HVEgpIHtcbiAgICBidXNpbmVzcyA9IGJ1c2luZXNzLnNsaWNlKDAsIFRBU0tfQUdFTlRfUFJPTVBUX01BWF9MRU5HVEgpLnRyaW0oKTtcbiAgfVxuXG4gIHJldHVybiBbXG4gICAgYFx1NTNFQVx1NTA1QVx1NEUxQVx1NTJBMVx1NjI2N1x1ODg0Q1x1RkYxQSR7YnVzaW5lc3N9YCxcbiAgICAnXHU2MjY3XHU4ODRDXHU3RUE2XHU2NzVGXHVGRjFBXHU0RjE4XHU1MTQ4XHU0RjdGXHU3NTI4IHdlYl9zZWFyY2hfdG9vbFx1RkYwOFx1ODJFNVx1NTNFRlx1NzUyOFx1RkYwOVx1NjIxNlx1NURGMlx1NjM4OFx1Njc0M1x1NjhDMFx1N0QyMlx1NURFNVx1NTE3N1x1RkYxQlx1Nzk4MVx1NkI2Mlx1OEMwM1x1NzUyOCBjcm9uX2FkZC9jcm9uX3VwZGF0ZS9jcm9uX3JlbW92ZS9jcm9uX3J1bi9jcm9uX2xpc3RcdUZGMUJcdTc5ODFcdTZCNjJcdThDMDNcdTc1Mjggd2ViX3NlYXJjaF9jb25maWcvd2ViX2FjY2Vzc19jb25maWcvbW9kZWxfcm91dGluZ19jb25maWdcdUZGMUJcdTc5ODFcdTZCNjJcdTRGN0ZcdTc1MjggY3VybC93Z2V0XHVGRjFCXHU0RUM1XHU4RjkzXHU1MUZBXHU0RTFBXHU1MkExXHU3RUQzXHU2NzlDXHU2MjE2XHU1OTMxXHU4RDI1XHU1MzlGXHU1NkUwXHUzMDAyJyxcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2FuaXRpemVDcm9uQWdlbnRKb2JQcm9tcHQoXG4gIGFnZW50SWQ6IHN0cmluZyxcbiAgam9iSWQ6IHN0cmluZyxcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nLFxuKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHRyeSB7XG4gICAgY29uc3Qgd29ya3NwYWNlID0gYXdhaXQgZW5zdXJlQWdlbnRXb3Jrc3BhY2UoYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlKTtcbiAgICBjb25zdCBkYlBhdGggPSBwYXRoLmpvaW4od29ya3NwYWNlLmFnZW50Um9vdCwgJ3plcm9jbGF3JywgJ3dvcmtzcGFjZScsICdjcm9uJywgJ2pvYnMuZGInKTtcbiAgICBpZiAoIShhd2FpdCBmaWxlRXhpc3RzKGRiUGF0aCkpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgY29uc3QgZGIgPSBuZXcgRGF0YWJhc2VTeW5jKGRiUGF0aCk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJvdyA9IGRiXG4gICAgICAgIC5wcmVwYXJlKCdTRUxFQ1Qgam9iX3R5cGUsIHByb21wdCwgbmFtZSwgbW9kZWwsIHNlc3Npb25fdGFyZ2V0IEZST00gY3Jvbl9qb2JzIFdIRVJFIGlkID0gPyBMSU1JVCAxJylcbiAgICAgICAgLmdldChqb2JJZCkgYXMgQ3JvbkpvYlByb21wdFJlY29yZCB8IHVuZGVmaW5lZDtcbiAgICAgIGlmICghcm93IHx8IChyb3cuam9iX3R5cGUgfHwgJycpLnRvTG93ZXJDYXNlKCkgIT09ICdhZ2VudCcpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgY29uc3QgbmV4dFByb21wdCA9IHNhbml0aXplU2NoZWR1bGVkQWdlbnRQcm9tcHQocm93LnByb21wdCwgcm93Lm5hbWUpO1xuICAgICAgY29uc3QgY3VycmVudFByb21wdCA9IChyb3cucHJvbXB0ID8/ICcnKS50cmltKCk7XG4gICAgICBjb25zdCBub3JtYWxpemVkTW9kZWwgPSAoKCkgPT4ge1xuICAgICAgICBjb25zdCByYXcgPSAocm93Lm1vZGVsID8/ICcnKS50cmltKCk7XG4gICAgICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDtcbiAgICAgICAgaWYgKHJhdy5pbmNsdWRlcygnLycpKSByZXR1cm4gcmF3O1xuICAgICAgICBpZiAoL15xd2VuXFxkL2kudGVzdChyYXcpKSByZXR1cm4gYHF3ZW4vJHtyYXd9YDtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9KSgpO1xuICAgICAgY29uc3QgY3VycmVudFNlc3Npb25UYXJnZXQgPSAocm93LnNlc3Npb25fdGFyZ2V0ID8/ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IG5leHRTZXNzaW9uVGFyZ2V0ID0gY3VycmVudFNlc3Npb25UYXJnZXQgPT09ICdpc29sYXRlZCcgPyAnaXNvbGF0ZWQnIDogJ2lzb2xhdGVkJztcbiAgICAgIGNvbnN0IHNob3VsZFVwZGF0ZVByb21wdCA9IG5leHRQcm9tcHQgIT09IGN1cnJlbnRQcm9tcHQ7XG4gICAgICBjb25zdCBzaG91bGRVcGRhdGVNb2RlbCA9IG5vcm1hbGl6ZWRNb2RlbCAhPT0gbnVsbCAmJiBub3JtYWxpemVkTW9kZWwgIT09IChyb3cubW9kZWwgPz8gJycpLnRyaW0oKTtcbiAgICAgIGNvbnN0IHNob3VsZFVwZGF0ZVRhcmdldCA9IG5leHRTZXNzaW9uVGFyZ2V0ICE9PSBjdXJyZW50U2Vzc2lvblRhcmdldDtcblxuICAgICAgaWYgKCFzaG91bGRVcGRhdGVQcm9tcHQgJiYgIXNob3VsZFVwZGF0ZU1vZGVsICYmICFzaG91bGRVcGRhdGVUYXJnZXQpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBkYi5wcmVwYXJlKFxuICAgICAgICAnVVBEQVRFIGNyb25fam9icyBTRVQgcHJvbXB0ID0gPywgbW9kZWwgPSBDT0FMRVNDRSg/LCBtb2RlbCksIHNlc3Npb25fdGFyZ2V0ID0gPyBXSEVSRSBpZCA9ID8nLFxuICAgICAgKS5ydW4obmV4dFByb21wdCwgbm9ybWFsaXplZE1vZGVsLCBuZXh0U2Vzc2lvblRhcmdldCwgam9iSWQpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGRiLmNsb3NlKCk7XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxhdGVzdENyb25SdW5PdXRwdXQoXG4gIGFnZW50SWQ6IHN0cmluZyxcbiAgam9iSWQ6IHN0cmluZyxcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nLFxuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIHRyeSB7XG4gICAgY29uc3Qgd29ya3NwYWNlID0gYXdhaXQgZW5zdXJlQWdlbnRXb3Jrc3BhY2UoYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlKTtcbiAgICBjb25zdCBkYlBhdGggPSBwYXRoLmpvaW4od29ya3NwYWNlLmFnZW50Um9vdCwgJ3plcm9jbGF3JywgJ3dvcmtzcGFjZScsICdjcm9uJywgJ2pvYnMuZGInKTtcbiAgICBjb25zdCBleGlzdHMgPSBhd2FpdCBmaWxlRXhpc3RzKGRiUGF0aCk7XG4gICAgaWYgKCFleGlzdHMpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGRiID0gbmV3IERhdGFiYXNlU3luYyhkYlBhdGgsIHsgcmVhZE9ubHk6IHRydWUgfSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0bXQgPSBkYi5wcmVwYXJlKFxuICAgICAgICAnU0VMRUNUIG91dHB1dCBGUk9NIGNyb25fcnVucyBXSEVSRSBqb2JfaWQgPSA/IE9SREVSIEJZIGlkIERFU0MgTElNSVQgMScsXG4gICAgICApO1xuICAgICAgY29uc3Qgcm93ID0gc3RtdC5nZXQoam9iSWQpIGFzIENyb25SdW5SZWNvcmQgfCB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4gbm9ybWFsaXplQ3JvblJ1bk91dHB1dChyb3c/Lm91dHB1dCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGRiLmNsb3NlKCk7XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlQ3JvblJ1bkNvdW50KFxuICBhZ2VudElkOiBzdHJpbmcsXG4gIGpvYklkOiBzdHJpbmcsXG4gIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyxcbik6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICB0cnkge1xuICAgIGNvbnN0IHdvcmtzcGFjZSA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKGFnZW50SWQsIGhvbWVEaXJPdmVycmlkZSk7XG4gICAgY29uc3QgZGJQYXRoID0gcGF0aC5qb2luKHdvcmtzcGFjZS5hZ2VudFJvb3QsICd6ZXJvY2xhdycsICd3b3Jrc3BhY2UnLCAnY3JvbicsICdqb2JzLmRiJyk7XG4gICAgY29uc3QgZXhpc3RzID0gYXdhaXQgZmlsZUV4aXN0cyhkYlBhdGgpO1xuICAgIGlmICghZXhpc3RzKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBkYiA9IG5ldyBEYXRhYmFzZVN5bmMoZGJQYXRoLCB7IHJlYWRPbmx5OiB0cnVlIH0pO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdG10ID0gZGIucHJlcGFyZShcbiAgICAgICAgJ1NFTEVDVCBDT1VOVCgqKSBBUyBjb3VudCBGUk9NIGNyb25fcnVucyBXSEVSRSBqb2JfaWQgPSA/JyxcbiAgICAgICk7XG4gICAgICBjb25zdCByb3cgPSBzdG10LmdldChqb2JJZCkgYXMgQ3JvblJ1bkNvdW50UmVjb3JkIHwgdW5kZWZpbmVkO1xuICAgICAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShOdW1iZXIocm93Py5jb3VudCkpID8gTnVtYmVyKHJvdz8uY291bnQpIDogbnVsbDtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgZGIuY2xvc2UoKTtcbiAgICB9XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFwcGVuZFRhc2tSdW50aW1lRXZlbnQoXG4gIGFnZW50SWQ6IHN0cmluZyxcbiAgdGFza0lkOiBzdHJpbmcsXG4gIG1lc3NhZ2U6IHN0cmluZyxcbiAgbWV0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyxcbik6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBhcHBlbmRBZ2VudENvbGxhYm9yYXRpb25FdmVudChcbiAgICBhZ2VudElkLFxuICAgIGBjcm9uXyR7dGFza0lkfWAsXG4gICAge1xuICAgICAga2luZDogJ3J1bnRpbWVfbG9nJyxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBtZXRhOiB7XG4gICAgICAgIHNvdXJjZTogJ3NjaGVkdWxlZF90YXNrJyxcbiAgICAgICAgdGFza0lkLFxuICAgICAgICAuLi5tZXRhLFxuICAgICAgfSxcbiAgICB9LFxuICAgIGhvbWVEaXJPdmVycmlkZSxcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3luY0FnZW50U2NoZWR1bGVkVGFza0V2ZW50cyhhZ2VudElkOiBzdHJpbmcsIHdhdGNoZXI6IFRhc2tXYXRjaGVyRW50cnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3Qgam9icyA9IGF3YWl0IGxpc3RHYXRld2F5Q3JvbkpvYnMod2F0Y2hlci5nYXRld2F5QmFzZVVybCk7XG4gIGNvbnN0IG5leHRTbmFwc2hvdCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgam9iIG9mIGpvYnMpIHtcbiAgICBuZXh0U25hcHNob3Quc2V0KGpvYi5pZCwgdG9UYXNrU25hcHNob3RUb2tlbihqb2IpKTtcbiAgfVxuXG4gIGlmICh3YXRjaGVyLnNuYXBzaG90LnNpemUgPT09IDApIHtcbiAgICB3YXRjaGVyLnNuYXBzaG90ID0gbmV4dFNuYXBzaG90O1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGZvciAoY29uc3Qgam9iIG9mIGpvYnMpIHtcbiAgICBjb25zdCBjdXJyZW50VG9rZW4gPSB0b1Rhc2tTbmFwc2hvdFRva2VuKGpvYik7XG4gICAgY29uc3QgcHJldmlvdXNUb2tlbiA9IHdhdGNoZXIuc25hcHNob3QuZ2V0KGpvYi5pZCk7XG4gICAgaWYgKCFwcmV2aW91c1Rva2VuKSB7XG4gICAgICBjb25zdCBwcm9tcHRTYW5pdGl6ZWQgPSBhd2FpdCBzYW5pdGl6ZUNyb25BZ2VudEpvYlByb21wdChcbiAgICAgICAgYWdlbnRJZCxcbiAgICAgICAgam9iLmlkLFxuICAgICAgICB3YXRjaGVyLmhvbWVEaXJPdmVycmlkZSxcbiAgICAgICk7XG4gICAgICBhd2FpdCBhcHBlbmRUYXNrUnVudGltZUV2ZW50KFxuICAgICAgICBhZ2VudElkLFxuICAgICAgICBqb2IuaWQsXG4gICAgICAgIHByb21wdFNhbml0aXplZFxuICAgICAgICAgID8gYFx1NUI5QVx1NjVGNlx1NEVGQlx1NTJBMVx1NURGMlx1NkNFOFx1NTE4Q1x1RkYxQSR7am9iLm5hbWUgfHwgam9iLmlkfVx1RkYwQ1x1NEUwQlx1NkIyMVx1NjI2N1x1ODg0QyAke2pvYi5uZXh0X3J1biB8fCAnXHU2NzJBXHU3N0U1J31cdUZGMDhcdTVERjJcdTVFOTRcdTc1MjhcdTYyNjdcdTg4NENcdTdFQTZcdTY3NUZcdUZGMDlgXG4gICAgICAgICAgOiBgXHU1QjlBXHU2NUY2XHU0RUZCXHU1MkExXHU1REYyXHU2Q0U4XHU1MThDXHVGRjFBJHtqb2IubmFtZSB8fCBqb2IuaWR9XHVGRjBDXHU0RTBCXHU2QjIxXHU2MjY3XHU4ODRDICR7am9iLm5leHRfcnVuIHx8ICdcdTY3MkFcdTc3RTUnfWAsXG4gICAgICAgIHsgYWN0aW9uOiAnY3JlYXRlZCcsIHRhc2tOYW1lOiBqb2IubmFtZSB8fCB1bmRlZmluZWQsIG5leHRSdW46IGpvYi5uZXh0X3J1biB8fCB1bmRlZmluZWQgfSxcbiAgICAgICAgd2F0Y2hlci5ob21lRGlyT3ZlcnJpZGUsXG4gICAgICApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjdXJyZW50VG9rZW4gPT09IHByZXZpb3VzVG9rZW4pIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IFtwcmV2RW5hYmxlZCwgcHJldk5leHRSdW4sIHByZXZMYXN0UnVuLCBwcmV2TGFzdFN0YXR1c10gPSBwcmV2aW91c1Rva2VuLnNwbGl0KCd8Jyk7XG4gICAgY29uc3QgZW5hYmxlZENoYW5nZWQgPSBTdHJpbmcoam9iLmVuYWJsZWQpICE9PSBwcmV2RW5hYmxlZDtcbiAgICBjb25zdCBydW5DaGFuZ2VkID0gKGpvYi5sYXN0X3J1biB8fCAnJykgIT09IHByZXZMYXN0UnVuIHx8IChqb2IubGFzdF9zdGF0dXMgfHwgJycpICE9PSBwcmV2TGFzdFN0YXR1cztcbiAgICBjb25zdCBuZXh0Q2hhbmdlZCA9IChqb2IubmV4dF9ydW4gfHwgJycpICE9PSBwcmV2TmV4dFJ1bjtcblxuICAgIGlmIChydW5DaGFuZ2VkICYmIGpvYi5sYXN0X3J1bikge1xuICAgICAgY29uc3Qgc3RhdHVzID0gKGpvYi5sYXN0X3N0YXR1cyB8fCAnJykudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IHN0YXR1c0xhYmVsID0gc3RhdHVzID09PSAnb2snIHx8IHN0YXR1cyA9PT0gJ3N1Y2Nlc3MnID8gJ1x1NjIxMFx1NTI5RicgOiBzdGF0dXMgPyBgXHU3MkI2XHU2MDAxICR7am9iLmxhc3Rfc3RhdHVzfWAgOiAnXHU1REYyXHU2MjY3XHU4ODRDJztcbiAgICAgIGxldCByZXN1bHRPdXRwdXQgPSByZXNvbHZlQ3JvbkpvYk91dHB1dChqb2IpO1xuICAgICAgaWYgKCFyZXN1bHRPdXRwdXQpIHtcbiAgICAgICAgcmVzdWx0T3V0cHV0ID0gYXdhaXQgcmVzb2x2ZUxhdGVzdENyb25SdW5PdXRwdXQoYWdlbnRJZCwgam9iLmlkLCB3YXRjaGVyLmhvbWVEaXJPdmVycmlkZSk7XG4gICAgICB9XG4gICAgICBjb25zdCBydW5Db3VudCA9IGF3YWl0IHJlc29sdmVDcm9uUnVuQ291bnQoYWdlbnRJZCwgam9iLmlkLCB3YXRjaGVyLmhvbWVEaXJPdmVycmlkZSk7XG4gICAgICBpZiAoXG4gICAgICAgIHJlc3VsdE91dHB1dCAmJlxuICAgICAgICAvKD86Y3VybHx3Z2V0fHdlYl9zZWFyY2hfY29uZmlnfHdlYl9hY2Nlc3NfY29uZmlnfG1vZGVsX3JvdXRpbmdfY29uZmlnKS9pLnRlc3QocmVzdWx0T3V0cHV0KVxuICAgICAgKSB7XG4gICAgICAgIGF3YWl0IHNhbml0aXplQ3JvbkFnZW50Sm9iUHJvbXB0KGFnZW50SWQsIGpvYi5pZCwgd2F0Y2hlci5ob21lRGlyT3ZlcnJpZGUpO1xuICAgICAgfVxuICAgICAgYXdhaXQgYXBwZW5kVGFza1J1bnRpbWVFdmVudChcbiAgICAgICAgYWdlbnRJZCxcbiAgICAgICAgam9iLmlkLFxuICAgICAgICByZXN1bHRPdXRwdXRcbiAgICAgICAgICA/IGBcdTVCOUFcdTY1RjZcdTRFRkJcdTUyQTFcdTYyNjdcdTg4NENcdUZGMUEke2pvYi5uYW1lIHx8IGpvYi5pZH1cdUZGMEMke3N0YXR1c0xhYmVsfVx1RkYwQ1x1NjI2N1x1ODg0Q1x1NjVGNlx1OTVGNCAke2pvYi5sYXN0X3J1bn1cdUZGMENcdTdFRDNcdTY3OUNcdUZGMUEke3Jlc3VsdE91dHB1dH1gXG4gICAgICAgICAgOiBgXHU1QjlBXHU2NUY2XHU0RUZCXHU1MkExXHU2MjY3XHU4ODRDXHVGRjFBJHtqb2IubmFtZSB8fCBqb2IuaWR9XHVGRjBDJHtzdGF0dXNMYWJlbH1cdUZGMENcdTYyNjdcdTg4NENcdTY1RjZcdTk1RjQgJHtqb2IubGFzdF9ydW59YCxcbiAgICAgICAge1xuICAgICAgICAgIGFjdGlvbjogJ3JhbicsXG4gICAgICAgICAgdGFza05hbWU6IGpvYi5uYW1lIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICBsYXN0UnVuOiBqb2IubGFzdF9ydW4sXG4gICAgICAgICAgbGFzdFN0YXR1czogam9iLmxhc3Rfc3RhdHVzIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICBuZXh0UnVuOiBqb2IubmV4dF9ydW4gfHwgdW5kZWZpbmVkLFxuICAgICAgICAgIHJlc3VsdE91dHB1dDogcmVzdWx0T3V0cHV0IHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICBydW5Db3VudDogcnVuQ291bnQgPz8gdW5kZWZpbmVkLFxuICAgICAgICB9LFxuICAgICAgICB3YXRjaGVyLmhvbWVEaXJPdmVycmlkZSxcbiAgICAgICk7XG4gICAgfSBlbHNlIGlmIChlbmFibGVkQ2hhbmdlZCkge1xuICAgICAgYXdhaXQgYXBwZW5kVGFza1J1bnRpbWVFdmVudChcbiAgICAgICAgYWdlbnRJZCxcbiAgICAgICAgam9iLmlkLFxuICAgICAgICBgXHU1QjlBXHU2NUY2XHU0RUZCXHU1MkExJHtqb2IuZW5hYmxlZCA/ICdcdTVERjJcdTU0MkZcdTc1MjgnIDogJ1x1NURGMlx1NjY4Mlx1NTA1Qyd9XHVGRjFBJHtqb2IubmFtZSB8fCBqb2IuaWR9YCxcbiAgICAgICAgeyBhY3Rpb246IGpvYi5lbmFibGVkID8gJ2VuYWJsZWQnIDogJ3BhdXNlZCcsIHRhc2tOYW1lOiBqb2IubmFtZSB8fCB1bmRlZmluZWQgfSxcbiAgICAgICAgd2F0Y2hlci5ob21lRGlyT3ZlcnJpZGUsXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAobmV4dENoYW5nZWQpIHtcbiAgICAgIGF3YWl0IGFwcGVuZFRhc2tSdW50aW1lRXZlbnQoXG4gICAgICAgIGFnZW50SWQsXG4gICAgICAgIGpvYi5pZCxcbiAgICAgICAgYFx1NUI5QVx1NjVGNlx1NEVGQlx1NTJBMVx1OEJBMVx1NTIxMlx1NURGMlx1NjZGNFx1NjVCMFx1RkYxQSR7am9iLm5hbWUgfHwgam9iLmlkfVx1RkYwQ1x1NEUwQlx1NkIyMVx1NjI2N1x1ODg0QyAke2pvYi5uZXh0X3J1biB8fCAnXHU2NzJBXHU3N0U1J31gLFxuICAgICAgICB7XG4gICAgICAgICAgYWN0aW9uOiAncmVzY2hlZHVsZWQnLFxuICAgICAgICAgIHRhc2tOYW1lOiBqb2IubmFtZSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgbmV4dFJ1bjogam9iLm5leHRfcnVuIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgfSxcbiAgICAgICAgd2F0Y2hlci5ob21lRGlyT3ZlcnJpZGUsXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGZvciAoY29uc3QgW3Rhc2tJZF0gb2Ygd2F0Y2hlci5zbmFwc2hvdC5lbnRyaWVzKCkpIHtcbiAgICBpZiAoIW5leHRTbmFwc2hvdC5oYXModGFza0lkKSkge1xuICAgICAgYXdhaXQgYXBwZW5kVGFza1J1bnRpbWVFdmVudChcbiAgICAgICAgYWdlbnRJZCxcbiAgICAgICAgdGFza0lkLFxuICAgICAgICBgXHU1QjlBXHU2NUY2XHU0RUZCXHU1MkExXHU1REYyXHU1MjIwXHU5NjY0XHVGRjFBJHt0YXNrSWR9YCxcbiAgICAgICAgeyBhY3Rpb246ICdkZWxldGVkJyB9LFxuICAgICAgICB3YXRjaGVyLmhvbWVEaXJPdmVycmlkZSxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgd2F0Y2hlci5zbmFwc2hvdCA9IG5leHRTbmFwc2hvdDtcbn1cblxuZnVuY3Rpb24gc3RvcEFnZW50VGFza1dhdGNoZXIoYWdlbnRJZDogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHdhdGNoZXIgPSBhZ2VudFRhc2tXYXRjaGVycy5nZXQoYWdlbnRJZCk7XG4gIGlmICghd2F0Y2hlcikgcmV0dXJuO1xuICBjbGVhckludGVydmFsKHdhdGNoZXIudGltZXIpO1xuICBhZ2VudFRhc2tXYXRjaGVycy5kZWxldGUoYWdlbnRJZCk7XG59XG5cbmZ1bmN0aW9uIHN0YXJ0QWdlbnRUYXNrV2F0Y2hlcihcbiAgYWdlbnRJZDogc3RyaW5nLFxuICBnYXRld2F5OiBaZXJvQ2xhd0dhdGV3YXlFbmRwb2ludCxcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nLFxuKTogdm9pZCB7XG4gIHN0b3BBZ2VudFRhc2tXYXRjaGVyKGFnZW50SWQpO1xuICBjb25zdCB3YXRjaGVyOiBUYXNrV2F0Y2hlckVudHJ5ID0ge1xuICAgIHRpbWVyOiBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICBzeW5jQWdlbnRTY2hlZHVsZWRUYXNrRXZlbnRzKGFnZW50SWQsIHdhdGNoZXIpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdbQWdlbnRSdW50aW1lXSBcdTRFRkJcdTUyQTFcdTU0MENcdTZCNjVcdTU5MzFcdThEMjU6JywgZXJyb3IpO1xuICAgICAgfSk7XG4gICAgfSwgVEFTS19TWU5DX0lOVEVSVkFMX01TKSxcbiAgICBzbmFwc2hvdDogbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKSxcbiAgICBnYXRld2F5QmFzZVVybDogZ2F0ZXdheS5iYXNlVXJsLFxuICAgIGhvbWVEaXJPdmVycmlkZSxcbiAgfTtcbiAgYWdlbnRUYXNrV2F0Y2hlcnMuc2V0KGFnZW50SWQsIHdhdGNoZXIpO1xuXG4gIHN5bmNBZ2VudFNjaGVkdWxlZFRhc2tFdmVudHMoYWdlbnRJZCwgd2F0Y2hlcikuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgY29uc29sZS5lcnJvcignW0FnZW50UnVudGltZV0gXHU1MjFEXHU2QjIxXHU0RUZCXHU1MkExXHU1NDBDXHU2QjY1XHU1OTMxXHU4RDI1OicsIGVycm9yKTtcbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRBZ2VudFJ1bnRpbWVTdGF0dXMoYWdlbnRJZDogc3RyaW5nKTogQWdlbnRSdW50aW1lU3RhdHVzIHtcbiAgY29uc3QgZW50cnkgPSBhZ2VudFByb2Nlc3Nlcy5nZXQoYWdlbnRJZCk7XG5cbiAgaWYgKCFlbnRyeSkge1xuICAgIHJldHVybiB7IGFnZW50SWQsIHN0YXR1czogJ29mZmxpbmUnIH07XG4gIH1cblxuICBjb25zdCBnYXRld2F5VGlwID0gZW50cnkuZ2F0ZXdheSA/IGBcdTdGNTFcdTUxNzNcdUZGMUEke2VudHJ5LmdhdGV3YXkuYmFzZVVybH1gIDogdW5kZWZpbmVkO1xuICBjb25zdCBtZXJnZWRNZXNzYWdlID0gZW50cnkubWVzc2FnZSA/PyBnYXRld2F5VGlwO1xuXG4gIHJldHVybiB7XG4gICAgYWdlbnRJZCxcbiAgICBzdGF0dXM6IGVudHJ5LnN0YXR1cyxcbiAgICBwaWQ6IGVudHJ5LnBpZCxcbiAgICBzdGFydGVkQXQ6IGVudHJ5LnN0YXJ0ZWRBdCxcbiAgICBtZXNzYWdlOiBtZXJnZWRNZXNzYWdlLFxuICAgIGxhc3RPdXRwdXRBdDogZW50cnkubGFzdE91dHB1dEF0LFxuICAgIGxvZ1BhdGg6IGVudHJ5LmxvZ1BhdGgsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzdGFydEFnZW50UnVudGltZShpbnB1dDogU3RhcnRBZ2VudElucHV0KTogUHJvbWlzZTxTdGFydEFnZW50UmVzdWx0PiB7XG4gIGNvbnN0IGV4aXN0aW5nID0gYWdlbnRQcm9jZXNzZXMuZ2V0KGlucHV0LmFnZW50SWQpO1xuICBpZiAoZXhpc3RpbmcgJiYgKGV4aXN0aW5nLnN0YXR1cyA9PT0gJ3N0YXJ0aW5nJyB8fCBleGlzdGluZy5zdGF0dXMgPT09ICdvbmxpbmUnKSkge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiAnXHU2NjdBXHU4MEZEXHU0RjUzXHU1REYyXHU1NzI4XHU4RkQwXHU4ODRDXHU0RTJEXHUzMDAyJywgcGlkOiBleGlzdGluZy5waWQgfTtcbiAgfVxuICBzdG9wQWdlbnRUYXNrV2F0Y2hlcihpbnB1dC5hZ2VudElkKTtcblxuICBjb25zdCBwcm9maWxlID0gYXdhaXQgZ2V0QWdlbnRQcm9maWxlKGlucHV0KTtcbiAgY29uc3QgeyBleGVjdXRhYmxlUGF0aCwgdHJpZWQgfSA9IGF3YWl0IHJlc29sdmVaZXJvQ2xhd0V4ZWN1dGFibGUoKTtcbiAgaWYgKCFleGVjdXRhYmxlUGF0aCkge1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIG1lc3NhZ2U6IGBcdTY3MkFcdTYyN0VcdTUyMzAgWmVyb0NsYXcgXHU1RjE1XHU2NENFXHVGRjBDXHU4QkY3XHU2OEMwXHU2N0U1XHU1Qjg5XHU4OEM1XHU4REVGXHU1Rjg0XHUzMDAyXHU1REYyXHU1QzFEXHU4QkQ1XHVGRjFBJHt0cmllZC5qb2luKCcgOyAnKX1gLFxuICAgIH07XG4gIH1cblxuICBjb25zdCB7IGFwaUtleSwgYXBpQmFzZSB9ID0gYXdhaXQgcmVzb2x2ZVByb3ZpZGVyU2VjcmV0cyhwcm9maWxlLmRlZmF1bHRMbG0ucHJvdmlkZXJJZCwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgY29uZmlnRGlyID0gYXdhaXQgZW5zdXJlWmVyb0NsYXdDb25maWdEaXIocHJvZmlsZS5hZ2VudElkLCBpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBnYXRld2F5ID0gcmVzb2x2ZUdhdGV3YXlFbmRwb2ludEZvckFnZW50KHByb2ZpbGUuYWdlbnRJZCk7XG4gIGNvbnN0IGNvbnRleHRQYXRoID0gcGF0aC5qb2luKGNvbmZpZ0RpciwgJ3dvcmtzcGFjZScsIFpFUk9DTEFXX1dPUktTUEFDRV9QUk9NUFRfRklMRSk7XG4gIGNvbnN0IGFjdGl2ZU1jcFNlcnZlcnMgPSBhd2FpdCBjb2xsZWN0QWN0aXZlTWNwU2VydmVycyhwcm9maWxlLCBpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuXG4gIGNvbnN0IHBvcnRBdmFpbGFibGUgPSBhd2FpdCBpc1BvcnRBdmFpbGFibGUoZ2F0ZXdheS5ob3N0LCBnYXRld2F5LnBvcnQpO1xuICBpZiAoIXBvcnRBdmFpbGFibGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBtZXNzYWdlOiBgXHU3RjUxXHU1MTczXHU3QUVGXHU1M0UzXHU4OEFCXHU1MzYwXHU3NTI4XHVGRjFBJHtnYXRld2F5Lmhvc3R9OiR7Z2F0ZXdheS5wb3J0fVx1RkYwQ1x1OEJGN1x1NTE0OFx1OTFDQVx1NjUzRVx1N0FFRlx1NTNFM1x1NTQwRVx1OTFDRFx1OEJENVx1MzAwMmAsXG4gICAgICBjb250ZXh0UGF0aCxcbiAgICB9O1xuICB9XG5cbiAgdHlwZSBMYXVuY2hBdHRlbXB0UmVzdWx0ID0gU3RhcnRBZ2VudFJlc3VsdCAmIHsgdGltZWRPdXQ/OiBib29sZWFuIH07XG5cbiAgY29uc3QgbGF1bmNoUnVudGltZUF0dGVtcHQgPSBhc3luYyAoXG4gICAgbWNwU2VydmVyczogcmVhZG9ubHkgWmVyb0NsYXdNY3BTZXJ2ZXJDb25maWdbXSxcbiAgICBmYWxsYmFja01jcERpc2FibGVkID0gZmFsc2UsXG4gICk6IFByb21pc2U8TGF1bmNoQXR0ZW1wdFJlc3VsdD4gPT4ge1xuICAgIGF3YWl0IHByZXBhcmVaZXJvQ2xhd1J1bnRpbWVGaWxlcyhwcm9maWxlLCBjb25maWdEaXIsIGdhdGV3YXksIG1jcFNlcnZlcnMsIGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG5cbiAgICBjb25zdCB7IGxvZ1BhdGgsIHN0cmVhbSB9ID0gYXdhaXQgY3JlYXRlWmVyb0NsYXdMb2dTdHJlYW0ocHJvZmlsZS5hZ2VudElkLCBpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuXG4gICAgY29uc3QgYXJncyA9IFtcbiAgICAgICctLWNvbmZpZy1kaXInLFxuICAgICAgY29uZmlnRGlyLFxuICAgICAgJ2RhZW1vbicsXG4gICAgICAnLS1ob3N0JyxcbiAgICAgIGdhdGV3YXkuaG9zdCxcbiAgICAgICctLXBvcnQnLFxuICAgICAgU3RyaW5nKGdhdGV3YXkucG9ydCksXG4gICAgXTtcblxuICAgIGNvbnN0IGVudiA9IHtcbiAgICAgIC4uLnByb2Nlc3MuZW52LFxuICAgICAgWkVST0NMQVdfQVBJX0tFWTogYXBpS2V5ID8/ICcnLFxuICAgICAgQVBJX0tFWTogYXBpS2V5ID8/ICcnLFxuICAgICAgWkVST0NMQVdfQVBJX1VSTDogYXBpQmFzZSA/PyAnJyxcbiAgICAgIEFQSV9VUkw6IGFwaUJhc2UgPz8gJycsXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkID0gc3Bhd24oZXhlY3V0YWJsZVBhdGgsIGFyZ3MsIHsgZW52LCBzdGRpbzogJ3BpcGUnIH0pO1xuXG4gICAgY2hpbGQuc3Rkb3V0Py5waXBlKHN0cmVhbSk7XG4gICAgY2hpbGQuc3RkZXJyPy5waXBlKHN0cmVhbSk7XG4gICAgY2hpbGQuc3Rkb3V0Py5vbignZGF0YScsICgpID0+IHRvdWNoT3V0cHV0KHByb2ZpbGUuYWdlbnRJZCkpO1xuICAgIGNoaWxkLnN0ZGVycj8ub24oJ2RhdGEnLCAoKSA9PiB0b3VjaE91dHB1dChwcm9maWxlLmFnZW50SWQpKTtcblxuICAgIHVwZGF0ZVN0YXR1cyhwcm9maWxlLmFnZW50SWQsIHtcbiAgICAgIHN0YXR1czogJ3N0YXJ0aW5nJyxcbiAgICAgIHBpZDogY2hpbGQucGlkLFxuICAgICAgc3RhcnRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBwcm9jZXNzOiBjaGlsZCxcbiAgICAgIGxvZ1BhdGgsXG4gICAgICBsYXN0T3V0cHV0QXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGdhdGV3YXksXG4gICAgICBtZXNzYWdlOiBgXHU1Qjg4XHU2MkE0XHU4RkRCXHU3QTBCXHU1NDJGXHU1MkE4XHU0RTJEXHVGRjFBJHtnYXRld2F5LmJhc2VVcmx9YCxcbiAgICB9KTtcblxuICAgIGNoaWxkLm9uY2UoJ2V4aXQnLCAoY29kZSkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSBhZ2VudFByb2Nlc3Nlcy5nZXQocHJvZmlsZS5hZ2VudElkKTtcbiAgICAgIGlmICghZW50cnkgfHwgZW50cnkucHJvY2VzcyAhPT0gY2hpbGQpIHtcbiAgICAgICAgc3RyZWFtLmVuZCgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzdG9wQWdlbnRUYXNrV2F0Y2hlcihwcm9maWxlLmFnZW50SWQpO1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGNvZGUgPT09IDAgPyAnXHU1REYyXHU1MDVDXHU2QjYyJyA6IGBcdTVGMDJcdTVFMzhcdTkwMDBcdTUxRkEgKGNvZGUgJHtjb2RlID8/ICd1bmtub3duJ30pYDtcbiAgICAgIHVwZGF0ZVN0YXR1cyhwcm9maWxlLmFnZW50SWQsIHtcbiAgICAgICAgc3RhdHVzOiBjb2RlID09PSAwID8gJ29mZmxpbmUnIDogJ2Vycm9yJyxcbiAgICAgICAgbWVzc2FnZTogbG9nUGF0aCA/IGAke21lc3NhZ2V9XHVGRjBDXHU2NUU1XHU1RkQ3XHVGRjFBJHtsb2dQYXRofWAgOiBtZXNzYWdlLFxuICAgICAgICBsb2dQYXRoLFxuICAgICAgICBsYXN0T3V0cHV0QXQ6IGVudHJ5Lmxhc3RPdXRwdXRBdCxcbiAgICAgICAgZ2F0ZXdheTogZW50cnkuZ2F0ZXdheSxcbiAgICAgIH0pO1xuICAgICAgc3RyZWFtLmVuZCgpO1xuICAgIH0pO1xuXG4gICAgY2hpbGQub25jZSgnZXJyb3InLCAoZXJyb3IpID0+IHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gYWdlbnRQcm9jZXNzZXMuZ2V0KHByb2ZpbGUuYWdlbnRJZCk7XG4gICAgICBpZiAoIWVudHJ5IHx8IGVudHJ5LnByb2Nlc3MgIT09IGNoaWxkKSB7XG4gICAgICAgIHN0cmVhbS5lbmQoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc3RvcEFnZW50VGFza1dhdGNoZXIocHJvZmlsZS5hZ2VudElkKTtcbiAgICAgIHVwZGF0ZVN0YXR1cyhwcm9maWxlLmFnZW50SWQsIHtcbiAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICBtZXNzYWdlOiBsb2dQYXRoID8gYCR7ZXJyb3IubWVzc2FnZX1cdUZGMENcdTY1RTVcdTVGRDdcdUZGMUEke2xvZ1BhdGh9YCA6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIGxvZ1BhdGgsXG4gICAgICAgIGdhdGV3YXksXG4gICAgICB9KTtcbiAgICAgIHN0cmVhbS5lbmQoKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGdhdGV3YXlSZWFkeSA9IGF3YWl0IHdhaXRGb3JHYXRld2F5UmVhZHkoZ2F0ZXdheSk7XG4gICAgY29uc3QgY3VycmVudCA9IGFnZW50UHJvY2Vzc2VzLmdldChwcm9maWxlLmFnZW50SWQpO1xuICAgIGlmICghZ2F0ZXdheVJlYWR5KSB7XG4gICAgICBjaGlsZC5raWxsKCk7XG4gICAgICBjb25zdCBtZXNzYWdlID0gYFplcm9DbGF3IFx1N0Y1MVx1NTE3M1x1NTA2NVx1NUVCN1x1NjhDMFx1NjdFNVx1OEQ4NVx1NjVGNlx1RkYxQSR7Z2F0ZXdheS5iYXNlVXJsfS9oZWFsdGhgO1xuICAgICAgaWYgKGN1cnJlbnQ/LnByb2Nlc3MgPT09IGNoaWxkKSB7XG4gICAgICAgIHVwZGF0ZVN0YXR1cyhwcm9maWxlLmFnZW50SWQsIHtcbiAgICAgICAgICBzdGF0dXM6ICdlcnJvcicsXG4gICAgICAgICAgbWVzc2FnZTogbG9nUGF0aCA/IGAke21lc3NhZ2V9XHVGRjBDXHU2NUU1XHU1RkQ3XHVGRjFBJHtsb2dQYXRofWAgOiBtZXNzYWdlLFxuICAgICAgICAgIGxvZ1BhdGgsXG4gICAgICAgICAgbGFzdE91dHB1dEF0OiBjdXJyZW50Lmxhc3RPdXRwdXRBdCxcbiAgICAgICAgICBnYXRld2F5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBsb2dQYXRoLFxuICAgICAgICBjb250ZXh0UGF0aCxcbiAgICAgICAgdGltZWRPdXQ6IHRydWUsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50ICYmIGN1cnJlbnQucHJvY2VzcyAhPT0gY2hpbGQpIHtcbiAgICAgIHN0cmVhbS5lbmQoKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBtZXNzYWdlOiAnXHU1NDJGXHU1MkE4XHU3MkI2XHU2MDAxXHU1REYyXHU1MjA3XHU2MzYyXHVGRjBDXHU4QkY3XHU5MUNEXHU4QkQ1XHUzMDAyJyxcbiAgICAgICAgbG9nUGF0aCxcbiAgICAgICAgY29udGV4dFBhdGgsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50ICYmIChjdXJyZW50LnN0YXR1cyA9PT0gJ29mZmxpbmUnIHx8IGN1cnJlbnQuc3RhdHVzID09PSAnZXJyb3InKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIG1lc3NhZ2U6IGN1cnJlbnQubWVzc2FnZSA/PyAnXHU1NDJGXHU1MkE4XHU1OTMxXHU4RDI1JyxcbiAgICAgICAgbG9nUGF0aCxcbiAgICAgICAgY29udGV4dFBhdGgsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50KSB7XG4gICAgICB1cGRhdGVTdGF0dXMocHJvZmlsZS5hZ2VudElkLCB7XG4gICAgICAgIC4uLmN1cnJlbnQsXG4gICAgICAgIHN0YXR1czogJ29ubGluZScsXG4gICAgICAgIG1lc3NhZ2U6IGZhbGxiYWNrTWNwRGlzYWJsZWRcbiAgICAgICAgICA/IGBcdTVCODhcdTYyQTRcdThGREJcdTdBMEJcdTVERjJcdTVDMzFcdTdFRUFcdUZGMDhNQ1AgXHU1REYyXHU0RTM0XHU2NUY2XHU3OTgxXHU3NTI4XHVGRjA5XHVGRjFBJHtjdXJyZW50LmdhdGV3YXk/LmJhc2VVcmwgPz8gZ2F0ZXdheS5iYXNlVXJsfWBcbiAgICAgICAgICA6IChjdXJyZW50LmdhdGV3YXkgPyBgXHU1Qjg4XHU2MkE0XHU4RkRCXHU3QTBCXHU1REYyXHU1QzMxXHU3RUVBXHVGRjFBJHtjdXJyZW50LmdhdGV3YXkuYmFzZVVybH1gIDogJ1x1NUI4OFx1NjJBNFx1OEZEQlx1N0EwQlx1NURGMlx1NUMzMVx1N0VFQScpLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgc3RhcnRBZ2VudFRhc2tXYXRjaGVyKHByb2ZpbGUuYWdlbnRJZCwgZ2F0ZXdheSwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgcGlkOiBjaGlsZC5waWQsXG4gICAgICBjb250ZXh0UGF0aCxcbiAgICAgIGxvZ1BhdGgsXG4gICAgICBtZXNzYWdlOiBmYWxsYmFja01jcERpc2FibGVkXG4gICAgICAgID8gYFplcm9DbGF3IFx1NUI4OFx1NjJBNFx1OEZEQlx1N0EwQlx1NURGMlx1NTQyRlx1NTJBOFx1RkYwOE1DUCBcdTVERjJcdTRFMzRcdTY1RjZcdTc5ODFcdTc1MjhcdUZGMDlcdUZGMUEke2dhdGV3YXkuYmFzZVVybH1gXG4gICAgICAgIDogYFplcm9DbGF3IFx1NUI4OFx1NjJBNFx1OEZEQlx1N0EwQlx1NURGMlx1NTQyRlx1NTJBOFx1RkYxQSR7Z2F0ZXdheS5iYXNlVXJsfWAsXG4gICAgfTtcbiAgfTtcblxuICBjb25zdCBmaXJzdEF0dGVtcHQgPSBhd2FpdCBsYXVuY2hSdW50aW1lQXR0ZW1wdChhY3RpdmVNY3BTZXJ2ZXJzLCBmYWxzZSk7XG4gIGlmIChmaXJzdEF0dGVtcHQuc3VjY2Vzcykge1xuICAgIHJldHVybiBmaXJzdEF0dGVtcHQ7XG4gIH1cblxuICBpZiAoIWZpcnN0QXR0ZW1wdC50aW1lZE91dCB8fCBhY3RpdmVNY3BTZXJ2ZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBmaXJzdEF0dGVtcHQ7XG4gIH1cblxuICBjb25zdCByZXRyeUF0dGVtcHQgPSBhd2FpdCBsYXVuY2hSdW50aW1lQXR0ZW1wdChbXSwgdHJ1ZSk7XG4gIGlmIChyZXRyeUF0dGVtcHQuc3VjY2Vzcykge1xuICAgIHJldHVybiByZXRyeUF0dGVtcHQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgIG1lc3NhZ2U6IGAke2ZpcnN0QXR0ZW1wdC5tZXNzYWdlID8/ICdcdTU0MkZcdTUyQThcdTU5MzFcdThEMjUnfVx1RkYxQlx1NURGMlx1ODFFQVx1NTJBOFx1Nzk4MVx1NzUyOCBNQ1AgXHU5MUNEXHU4QkQ1XHVGRjBDXHU0RjQ2XHU0RUNEXHU1OTMxXHU4RDI1XHVGRjFBJHtyZXRyeUF0dGVtcHQubWVzc2FnZSA/PyAnXHU2NzJBXHU3N0U1XHU5NTE5XHU4QkVGJ31gLFxuICAgIGNvbnRleHRQYXRoLFxuICAgIGxvZ1BhdGg6IHJldHJ5QXR0ZW1wdC5sb2dQYXRoID8/IGZpcnN0QXR0ZW1wdC5sb2dQYXRoLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3RvcEFnZW50UnVudGltZShpbnB1dDogU3RvcEFnZW50SW5wdXQpOiBQcm9taXNlPFN0b3BBZ2VudFJlc3VsdD4ge1xuICBjb25zdCBlbnRyeSA9IGFnZW50UHJvY2Vzc2VzLmdldChpbnB1dC5hZ2VudElkKTtcbiAgaWYgKCFlbnRyeSB8fCAhZW50cnkucHJvY2Vzcykge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiAnXHU2NjdBXHU4MEZEXHU0RjUzXHU2NzJBXHU1NzI4XHU4RkQwXHU4ODRDXHU0RTJEXHUzMDAyJyB9O1xuICB9XG5cbiAgc3RvcEFnZW50VGFza1dhdGNoZXIoaW5wdXQuYWdlbnRJZCk7XG4gIGVudHJ5LnByb2Nlc3Mua2lsbCgpO1xuICB1cGRhdGVTdGF0dXMoaW5wdXQuYWdlbnRJZCwgeyBzdGF0dXM6ICdvZmZsaW5lJywgbWVzc2FnZTogJ1x1NURGMlx1NTA1Q1x1NkI2MicsIGxvZ1BhdGg6IGVudHJ5LmxvZ1BhdGggfSk7XG5cbiAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc3RvcEFsbEFnZW50UnVudGltZXMoKTogdm9pZCB7XG4gIGZvciAoY29uc3QgW2FnZW50SWQsIGVudHJ5XSBvZiBhZ2VudFByb2Nlc3Nlcy5lbnRyaWVzKCkpIHtcbiAgICBzdG9wQWdlbnRUYXNrV2F0Y2hlcihhZ2VudElkKTtcbiAgICBpZiAoZW50cnkucHJvY2Vzcykge1xuICAgICAgZW50cnkucHJvY2Vzcy5raWxsKCk7XG4gICAgfVxuICAgIHVwZGF0ZVN0YXR1cyhhZ2VudElkLCB7IHN0YXR1czogJ29mZmxpbmUnLCBtZXNzYWdlOiAnXHU1REYyXHU1MDVDXHU2QjYyJyB9KTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZWFkTGF0ZXN0TG9nVGFpbChcbiAgYWdlbnRJZDogc3RyaW5nLFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4gIGxpbmVzQ291bnQgPSA4MCxcbik6IFByb21pc2U8QWdlbnRMb2dUYWlsPiB7XG4gIGNvbnN0IHdvcmtzcGFjZSA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKGFnZW50SWQsIGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGxvZ0RpciA9IHBhdGguam9pbih3b3Jrc3BhY2UucHJpdmF0ZUxvZ3NSb290LCBaRVJPQ0xBV19MT0dfRElSKTtcbiAgbGV0IGxvZ1BhdGggPSBhZ2VudFByb2Nlc3Nlcy5nZXQoYWdlbnRJZCk/LmxvZ1BhdGg7XG5cbiAgaWYgKCFsb2dQYXRoIHx8ICEoYXdhaXQgZmlsZUV4aXN0cyhsb2dQYXRoKSkpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZW50cmllcyA9IGF3YWl0IHJlYWRkaXIobG9nRGlyLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gICAgICBjb25zdCBsb2dzID0gZW50cmllc1xuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNGaWxlKCkgJiYgZW50cnkubmFtZS5lbmRzV2l0aCgnLmxvZycpKVxuICAgICAgICAubWFwKChlbnRyeSkgPT4gZW50cnkubmFtZSlcbiAgICAgICAgLnNvcnQoKTtcbiAgICAgIGNvbnN0IGxhdGVzdCA9IGxvZ3MuYXQoLTEpO1xuICAgICAgbG9nUGF0aCA9IGxhdGVzdCA/IHBhdGguam9pbihsb2dEaXIsIGxhdGVzdCkgOiB1bmRlZmluZWQ7XG4gICAgfSBjYXRjaCB7XG4gICAgICBsb2dQYXRoID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIGlmICghbG9nUGF0aCkge1xuICAgIHJldHVybiB7IGFnZW50SWQsIGNvbnRlbnQ6ICdcdTY2ODJcdTY1RTBcdThGRDBcdTg4NENcdTY1RTVcdTVGRDdcdTMwMDInIH07XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZShsb2dQYXRoLCAndXRmLTgnKTtcbiAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgY29uc3QgdGFpbCA9IGxpbmVzLnNsaWNlKC1saW5lc0NvdW50KS5qb2luKCdcXG4nKTtcbiAgICByZXR1cm4ge1xuICAgICAgYWdlbnRJZCxcbiAgICAgIGxvZ1BhdGgsXG4gICAgICBjb250ZW50OiB0YWlsIHx8ICdcdTY2ODJcdTY1RTBcdThGRDBcdTg4NENcdTY1RTVcdTVGRDdcdTMwMDInLFxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgfTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHsgYWdlbnRJZCwgbG9nUGF0aCwgY29udGVudDogJ1x1OEJGQlx1NTNENlx1NjVFNVx1NUZEN1x1NTkzMVx1OEQyNVx1MzAwMicgfTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0QWdlbnRMb2dUYWlsKFxuICBhZ2VudElkOiBzdHJpbmcsXG4gIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyxcbiAgbGluZXNDb3VudD86IG51bWJlcixcbik6IFByb21pc2U8QWdlbnRMb2dUYWlsPiB7XG4gIHJldHVybiByZWFkTGF0ZXN0TG9nVGFpbChhZ2VudElkLCBob21lRGlyT3ZlcnJpZGUsIGxpbmVzQ291bnQpO1xufVxuIiwgImltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBhcHBlbmRGaWxlLCBta2RpciwgcmVhZGRpciwgcmVhZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuaW1wb3J0IHsgZW5zdXJlQWdlbnRXb3Jrc3BhY2UgfSBmcm9tICcuL3NoYXJlZC13b3Jrc3BhY2UtbWFuYWdlcic7XG5cbmV4cG9ydCB0eXBlIEFnZW50Q29sbGFib3JhdGlvbkV2ZW50S2luZCA9XG4gIHwgJ2NoYXRfc3RhcnRlZCdcbiAgfCAncnVudGltZV9sb2cnXG4gIHwgJ3Rvb2xfY2FsbCdcbiAgfCAnZGVsZWdhdGVfY2FsbCdcbiAgfCAnaXBjX2NhbGwnXG4gIHwgJ2NoYXRfZG9uZSdcbiAgfCAnY2hhdF9lcnJvcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQWdlbnRDb2xsYWJvcmF0aW9uRXZlbnQge1xuICBldmVudElkOiBzdHJpbmc7XG4gIGFnZW50SWQ6IHN0cmluZztcbiAgcmVxdWVzdElkOiBzdHJpbmc7XG4gIGtpbmQ6IEFnZW50Q29sbGFib3JhdGlvbkV2ZW50S2luZDtcbiAgbWVzc2FnZTogc3RyaW5nO1xuICBjcmVhdGVkQXQ6IHN0cmluZztcbiAgbWV0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG5mdW5jdGlvbiB0b0RhdGVLZXkoZGF0ZSA9IG5ldyBEYXRlKCkpOiBzdHJpbmcge1xuICBjb25zdCB5ZWFyID0gZGF0ZS5nZXRGdWxsWWVhcigpO1xuICBjb25zdCBtb250aCA9IGAke2RhdGUuZ2V0TW9udGgoKSArIDF9YC5wYWRTdGFydCgyLCAnMCcpO1xuICBjb25zdCBkYXkgPSBgJHtkYXRlLmdldERhdGUoKX1gLnBhZFN0YXJ0KDIsICcwJyk7XG4gIHJldHVybiBgJHt5ZWFyfS0ke21vbnRofS0ke2RheX1gO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVFdmVudElkKG5vdyA9IG5ldyBEYXRlKCkpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7bm93LmdldFRpbWUoKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCAxMCl9YDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTGluZShpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGlucHV0LnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbmZlckV2ZW50S2luZEZyb21SdW50aW1lTG9nKGxpbmU6IHN0cmluZyk6IEFnZW50Q29sbGFib3JhdGlvbkV2ZW50S2luZCB7XG4gIGNvbnN0IGxvd2VyID0gbGluZS50b0xvd2VyQ2FzZSgpO1xuICBpZiAoXG4gICAgbG93ZXIuaW5jbHVkZXMoJ2RlbGVnYXRlJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygnc3ViYWdlbnQnKSB8fFxuICAgIGxvd2VyLmluY2x1ZGVzKCdzdWItYWdlbnQnKSB8fFxuICAgIGxvd2VyLmluY2x1ZGVzKCdhZ2VudF9jYWxsJylcbiAgKSB7XG4gICAgcmV0dXJuICdkZWxlZ2F0ZV9jYWxsJztcbiAgfVxuICBpZiAoXG4gICAgbG93ZXIuaW5jbHVkZXMoJ2FnZW50c19zZW5kJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygnYWdlbnRzX2luYm94JykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygnYWdlbnRzX2xpc3QnKSB8fFxuICAgIGxvd2VyLmluY2x1ZGVzKCdhZ2VudHNfaXBjJylcbiAgKSB7XG4gICAgcmV0dXJuICdpcGNfY2FsbCc7XG4gIH1cbiAgaWYgKFxuICAgIGxvd2VyLmluY2x1ZGVzKCd0b29sJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygnL2FwaS90b29scycpIHx8XG4gICAgbG93ZXIuaW5jbHVkZXMoJ21jcCcpIHx8XG4gICAgbG93ZXIuaW5jbHVkZXMoJ2Z1bmN0aW9uIGNhbGwnKVxuICApIHtcbiAgICByZXR1cm4gJ3Rvb2xfY2FsbCc7XG4gIH1cbiAgcmV0dXJuICdydW50aW1lX2xvZyc7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVFdmVudEZpbGVQYXRoKGFnZW50SWQ6IHN0cmluZywgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3Qgd29ya3NwYWNlID0gYXdhaXQgZW5zdXJlQWdlbnRXb3Jrc3BhY2UoYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlKTtcbiAgY29uc3QgZXZlbnREaXIgPSBwYXRoLmpvaW4od29ya3NwYWNlLnByaXZhdGVMb2dzUm9vdCwgJ2NvbGxhYm9yYXRpb24nKTtcbiAgYXdhaXQgbWtkaXIoZXZlbnREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICByZXR1cm4gcGF0aC5qb2luKGV2ZW50RGlyLCBgJHt0b0RhdGVLZXkoKX0uanNvbmxgKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFwcGVuZEFnZW50Q29sbGFib3JhdGlvbkV2ZW50KFxuICBhZ2VudElkOiBzdHJpbmcsXG4gIHJlcXVlc3RJZDogc3RyaW5nLFxuICBldmVudDogT21pdDxBZ2VudENvbGxhYm9yYXRpb25FdmVudCwgJ2V2ZW50SWQnIHwgJ2FnZW50SWQnIHwgJ3JlcXVlc3RJZCcgfCAnY3JlYXRlZEF0Jz4gJiB7XG4gICAgY3JlYXRlZEF0Pzogc3RyaW5nO1xuICB9LFxuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgcGF5bG9hZDogQWdlbnRDb2xsYWJvcmF0aW9uRXZlbnQgPSB7XG4gICAgZXZlbnRJZDogY3JlYXRlRXZlbnRJZChub3cpLFxuICAgIGFnZW50SWQsXG4gICAgcmVxdWVzdElkLFxuICAgIGtpbmQ6IGV2ZW50LmtpbmQsXG4gICAgbWVzc2FnZTogbm9ybWFsaXplTGluZShldmVudC5tZXNzYWdlKS5zbGljZSgwLCAyMDAwKSxcbiAgICBjcmVhdGVkQXQ6IGV2ZW50LmNyZWF0ZWRBdCA/PyBub3cudG9JU09TdHJpbmcoKSxcbiAgICBtZXRhOiBldmVudC5tZXRhLFxuICB9O1xuXG4gIGNvbnN0IGZpbGVQYXRoID0gYXdhaXQgcmVzb2x2ZUV2ZW50RmlsZVBhdGgoYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlKTtcbiAgYXdhaXQgYXBwZW5kRmlsZShmaWxlUGF0aCwgYCR7SlNPTi5zdHJpbmdpZnkocGF5bG9hZCl9XFxuYCwgJ3V0Zi04Jyk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR2V0QWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRzSW5wdXQge1xuICBhZ2VudElkOiBzdHJpbmc7XG4gIGxpbWl0PzogbnVtYmVyO1xuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRSZWNlbnRBZ2VudENvbGxhYm9yYXRpb25FdmVudHMoXG4gIGlucHV0OiBHZXRBZ2VudENvbGxhYm9yYXRpb25FdmVudHNJbnB1dCxcbik6IFByb21pc2U8QWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRbXT4ge1xuICBjb25zdCB3b3Jrc3BhY2UgPSBhd2FpdCBlbnN1cmVBZ2VudFdvcmtzcGFjZShpbnB1dC5hZ2VudElkLCBpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBldmVudERpciA9IHBhdGguam9pbih3b3Jrc3BhY2UucHJpdmF0ZUxvZ3NSb290LCAnY29sbGFib3JhdGlvbicpO1xuICBjb25zdCBsaW1pdCA9IE1hdGgubWF4KDEsIE1hdGgubWluKDIwMDAsIGlucHV0LmxpbWl0ID8/IDIwMCkpO1xuXG4gIGxldCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgdHJ5IHtcbiAgICBmaWxlcyA9IChhd2FpdCByZWFkZGlyKGV2ZW50RGlyKSkuZmlsdGVyKChuYW1lKSA9PiBuYW1lLmVuZHNXaXRoKCcuanNvbmwnKSkuc29ydCgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCByZXN1bHQ6IEFnZW50Q29sbGFib3JhdGlvbkV2ZW50W10gPSBbXTtcbiAgZm9yIChsZXQgaW5kZXggPSBmaWxlcy5sZW5ndGggLSAxOyBpbmRleCA+PSAwOyBpbmRleCAtPSAxKSB7XG4gICAgaWYgKHJlc3VsdC5sZW5ndGggPj0gbGltaXQpIGJyZWFrO1xuICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5qb2luKGV2ZW50RGlyLCBmaWxlc1tpbmRleF0pO1xuICAgIGxldCBjb250ZW50ID0gJyc7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04Jyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQuc3BsaXQoL1xccj9cXG4vKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgZm9yIChsZXQgbGluZUluZGV4ID0gbGluZXMubGVuZ3RoIC0gMTsgbGluZUluZGV4ID49IDA7IGxpbmVJbmRleCAtPSAxKSB7XG4gICAgICBpZiAocmVzdWx0Lmxlbmd0aCA+PSBsaW1pdCkgYnJlYWs7XG4gICAgICBjb25zdCByYXcgPSBsaW5lc1tsaW5lSW5kZXhdO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaXRlbSA9IEpTT04ucGFyc2UocmF3KSBhcyBBZ2VudENvbGxhYm9yYXRpb25FdmVudDtcbiAgICAgICAgaWYgKGl0ZW0/LmFnZW50SWQgPT09IGlucHV0LmFnZW50SWQgJiYgdHlwZW9mIGl0ZW0ucmVxdWVzdElkID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHJlc3VsdC5wdXNoKGl0ZW0pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gaWdub3JlIG1hbGZvcm1lZCBsaW5lXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdC5yZXZlcnNlKCk7XG59XG4iLCAiaW1wb3J0IHsgeiB9IGZyb20gXCJ6b2RcIjtcbmltcG9ydCB0eXBlIHsgQWN0aW9uQmluZGluZyB9IGZyb20gXCIuL2FjdGlvbnNcIjtcblxuLyoqXG4gKiBEeW5hbWljIHZhbHVlIC0gY2FuIGJlIGEgbGl0ZXJhbCBvciBhIGB7ICRzdGF0ZSB9YCByZWZlcmVuY2UgdG8gdGhlIHN0YXRlIG1vZGVsLlxuICpcbiAqIFVzZWQgaW4gYWN0aW9uIHBhcmFtcyBhbmQgdmFsaWRhdGlvbiBhcmdzIHdoZXJlIHZhbHVlcyBjYW4gZWl0aGVyIGJlXG4gKiBoYXJkY29kZWQgb3IgcmVzb2x2ZWQgZnJvbSBzdGF0ZSBhdCBydW50aW1lLlxuICovXG5leHBvcnQgdHlwZSBEeW5hbWljVmFsdWU8VCA9IHVua25vd24+ID0gVCB8IHsgJHN0YXRlOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBEeW5hbWljIHN0cmluZyB2YWx1ZVxuICovXG5leHBvcnQgdHlwZSBEeW5hbWljU3RyaW5nID0gRHluYW1pY1ZhbHVlPHN0cmluZz47XG5cbi8qKlxuICogRHluYW1pYyBudW1iZXIgdmFsdWVcbiAqL1xuZXhwb3J0IHR5cGUgRHluYW1pY051bWJlciA9IER5bmFtaWNWYWx1ZTxudW1iZXI+O1xuXG4vKipcbiAqIER5bmFtaWMgYm9vbGVhbiB2YWx1ZVxuICovXG5leHBvcnQgdHlwZSBEeW5hbWljQm9vbGVhbiA9IER5bmFtaWNWYWx1ZTxib29sZWFuPjtcblxuLyoqXG4gKiBab2Qgc2NoZW1hIGZvciBkeW5hbWljIHZhbHVlc1xuICovXG5leHBvcnQgY29uc3QgRHluYW1pY1ZhbHVlU2NoZW1hID0gei51bmlvbihbXG4gIHouc3RyaW5nKCksXG4gIHoubnVtYmVyKCksXG4gIHouYm9vbGVhbigpLFxuICB6Lm51bGwoKSxcbiAgei5vYmplY3QoeyAkc3RhdGU6IHouc3RyaW5nKCkgfSksXG5dKTtcblxuZXhwb3J0IGNvbnN0IER5bmFtaWNTdHJpbmdTY2hlbWEgPSB6LnVuaW9uKFtcbiAgei5zdHJpbmcoKSxcbiAgei5vYmplY3QoeyAkc3RhdGU6IHouc3RyaW5nKCkgfSksXG5dKTtcblxuZXhwb3J0IGNvbnN0IER5bmFtaWNOdW1iZXJTY2hlbWEgPSB6LnVuaW9uKFtcbiAgei5udW1iZXIoKSxcbiAgei5vYmplY3QoeyAkc3RhdGU6IHouc3RyaW5nKCkgfSksXG5dKTtcblxuZXhwb3J0IGNvbnN0IER5bmFtaWNCb29sZWFuU2NoZW1hID0gei51bmlvbihbXG4gIHouYm9vbGVhbigpLFxuICB6Lm9iamVjdCh7ICRzdGF0ZTogei5zdHJpbmcoKSB9KSxcbl0pO1xuXG4vKipcbiAqIEJhc2UgVUkgZWxlbWVudCBzdHJ1Y3R1cmUgZm9yIHYyXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVUlFbGVtZW50PFxuICBUIGV4dGVuZHMgc3RyaW5nID0gc3RyaW5nLFxuICBQID0gUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4+IHtcbiAgLyoqIENvbXBvbmVudCB0eXBlIGZyb20gdGhlIGNhdGFsb2cgKi9cbiAgdHlwZTogVDtcbiAgLyoqIENvbXBvbmVudCBwcm9wcyAqL1xuICBwcm9wczogUDtcbiAgLyoqIENoaWxkIGVsZW1lbnQga2V5cyAoZmxhdCBzdHJ1Y3R1cmUpICovXG4gIGNoaWxkcmVuPzogc3RyaW5nW107XG4gIC8qKiBWaXNpYmlsaXR5IGNvbmRpdGlvbiAqL1xuICB2aXNpYmxlPzogVmlzaWJpbGl0eUNvbmRpdGlvbjtcbiAgLyoqIEV2ZW50IGJpbmRpbmdzIOKAlCBtYXBzIGV2ZW50IG5hbWVzIHRvIGFjdGlvbiBiaW5kaW5ncyAqL1xuICBvbj86IFJlY29yZDxzdHJpbmcsIEFjdGlvbkJpbmRpbmcgfCBBY3Rpb25CaW5kaW5nW10+O1xuICAvKiogUmVwZWF0IGNoaWxkcmVuIG9uY2UgcGVyIGl0ZW0gaW4gYSBzdGF0ZSBhcnJheSAqL1xuICByZXBlYXQ/OiB7IHN0YXRlUGF0aDogc3RyaW5nOyBrZXk/OiBzdHJpbmcgfTtcbiAgLyoqXG4gICAqIFN0YXRlIHdhdGNoZXJzIOKAlCBtYXBzIEpTT04gUG9pbnRlciBzdGF0ZSBwYXRocyB0byBhY3Rpb24gYmluZGluZ3MuXG4gICAqIFdoZW4gdGhlIHZhbHVlIGF0IGEgd2F0Y2hlZCBwYXRoIGNoYW5nZXMsIHRoZSBib3VuZCBhY3Rpb25zIGZpcmUuXG4gICAqIFVzZWZ1bCBmb3IgY2FzY2FkaW5nIGRlcGVuZGVuY2llcyAoZS5nLiBjb3VudHJ5IOKGkiBjaXR5IG9wdGlvbiBsb2FkaW5nKS5cbiAgICovXG4gIHdhdGNoPzogUmVjb3JkPHN0cmluZywgQWN0aW9uQmluZGluZyB8IEFjdGlvbkJpbmRpbmdbXT47XG59XG5cbi8qKlxuICogRWxlbWVudCB3aXRoIGtleSBhbmQgcGFyZW50S2V5IGZvciB1c2Ugd2l0aCBmbGF0VG9UcmVlLlxuICogV2hlbiBlbGVtZW50cyBhcmUgaW4gYW4gYXJyYXkgKG5vdCBhIGtleWVkIG1hcCksIGtleSBhbmQgcGFyZW50S2V5XG4gKiBhcmUgbmVlZGVkIHRvIGVzdGFibGlzaCBpZGVudGl0eSBhbmQgcGFyZW50LWNoaWxkIHJlbGF0aW9uc2hpcHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRmxhdEVsZW1lbnQ8XG4gIFQgZXh0ZW5kcyBzdHJpbmcgPSBzdHJpbmcsXG4gIFAgPSBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbj4gZXh0ZW5kcyBVSUVsZW1lbnQ8VCwgUD4ge1xuICAvKiogVW5pcXVlIGtleSBpZGVudGlmeWluZyB0aGlzIGVsZW1lbnQgKi9cbiAga2V5OiBzdHJpbmc7XG4gIC8qKiBQYXJlbnQgZWxlbWVudCBrZXkgKG51bGwgZm9yIHJvb3QpICovXG4gIHBhcmVudEtleT86IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogU2hhcmVkIGNvbXBhcmlzb24gb3BlcmF0b3JzIGZvciB2aXNpYmlsaXR5IGNvbmRpdGlvbnMuXG4gKlxuICogVXNlIGF0IG1vc3QgT05FIGNvbXBhcmlzb24gb3BlcmF0b3IgcGVyIGNvbmRpdGlvbi4gSWYgbXVsdGlwbGUgYXJlXG4gKiBwcm92aWRlZCwgb25seSB0aGUgZmlyc3QgbWF0Y2hpbmcgb25lIGlzIGV2YWx1YXRlZCAocHJlY2VkZW5jZTpcbiAqIGVxID4gbmVxID4gZ3QgPiBndGUgPiBsdCA+IGx0ZSkuIFdpdGggbm8gb3BlcmF0b3IsIHRydXRoaW5lc3MgaXMgY2hlY2tlZC5cbiAqXG4gKiBgbm90YCBpbnZlcnRzIHRoZSBmaW5hbCByZXN1bHQgb2Ygd2hpY2hldmVyIG9wZXJhdG9yIChvciB0cnV0aGluZXNzXG4gKiBjaGVjaykgaXMgdXNlZC5cbiAqL1xudHlwZSBDb21wYXJpc29uT3BlcmF0b3JzID0ge1xuICBlcT86IHVua25vd247XG4gIG5lcT86IHVua25vd247XG4gIGd0PzogbnVtYmVyIHwgeyAkc3RhdGU6IHN0cmluZyB9O1xuICBndGU/OiBudW1iZXIgfCB7ICRzdGF0ZTogc3RyaW5nIH07XG4gIGx0PzogbnVtYmVyIHwgeyAkc3RhdGU6IHN0cmluZyB9O1xuICBsdGU/OiBudW1iZXIgfCB7ICRzdGF0ZTogc3RyaW5nIH07XG4gIG5vdD86IHRydWU7XG59O1xuXG4vKipcbiAqIEEgc2luZ2xlIHN0YXRlLWJhc2VkIGNvbmRpdGlvbi5cbiAqIFJlc29sdmVzIGAkc3RhdGVgIHRvIGEgdmFsdWUgZnJvbSB0aGUgc3RhdGUgbW9kZWwsIHRoZW4gYXBwbGllcyB0aGUgb3BlcmF0b3IuXG4gKiBXaXRob3V0IGFuIG9wZXJhdG9yLCBjaGVja3MgdHJ1dGhpbmVzcy5cbiAqXG4gKiBXaGVuIGBub3RgIGlzIGB0cnVlYCwgdGhlIHJlc3VsdCBvZiB0aGUgZW50aXJlIGNvbmRpdGlvbiBpcyBpbnZlcnRlZC5cbiAqIEZvciBleGFtcGxlIGB7ICRzdGF0ZTogXCIvY291bnRcIiwgZ3Q6IDUsIG5vdDogdHJ1ZSB9YCBtZWFucyBcIk5PVCBncmVhdGVyIHRoYW4gNVwiLlxuICovXG5leHBvcnQgdHlwZSBTdGF0ZUNvbmRpdGlvbiA9IHsgJHN0YXRlOiBzdHJpbmcgfSAmIENvbXBhcmlzb25PcGVyYXRvcnM7XG5cbi8qKlxuICogQSBjb25kaXRpb24gdGhhdCByZXNvbHZlcyBgJGl0ZW1gIHRvIGEgZmllbGQgb24gdGhlIGN1cnJlbnQgcmVwZWF0IGl0ZW0uXG4gKiBPbmx5IG1lYW5pbmdmdWwgaW5zaWRlIGEgYHJlcGVhdGAgc2NvcGUuXG4gKlxuICogVXNlIGBcIlwiYCB0byByZWZlcmVuY2UgdGhlIHdob2xlIGl0ZW0sIG9yIGBcImZpZWxkXCJgIGZvciBhIHNwZWNpZmljIGZpZWxkLlxuICovXG5leHBvcnQgdHlwZSBJdGVtQ29uZGl0aW9uID0geyAkaXRlbTogc3RyaW5nIH0gJiBDb21wYXJpc29uT3BlcmF0b3JzO1xuXG4vKipcbiAqIEEgY29uZGl0aW9uIHRoYXQgcmVzb2x2ZXMgYCRpbmRleGAgdG8gdGhlIGN1cnJlbnQgcmVwZWF0IGFycmF5IGluZGV4LlxuICogT25seSBtZWFuaW5nZnVsIGluc2lkZSBhIGByZXBlYXRgIHNjb3BlLlxuICovXG5leHBvcnQgdHlwZSBJbmRleENvbmRpdGlvbiA9IHsgJGluZGV4OiB0cnVlIH0gJiBDb21wYXJpc29uT3BlcmF0b3JzO1xuXG4vKiogQSBzaW5nbGUgdmlzaWJpbGl0eSBjb25kaXRpb24gKHN0YXRlLCBpdGVtLCBvciBpbmRleCkuICovXG5leHBvcnQgdHlwZSBTaW5nbGVDb25kaXRpb24gPSBTdGF0ZUNvbmRpdGlvbiB8IEl0ZW1Db25kaXRpb24gfCBJbmRleENvbmRpdGlvbjtcblxuLyoqXG4gKiBBTkQgd3JhcHBlciDigJQgYWxsIGNoaWxkIGNvbmRpdGlvbnMgbXVzdCBiZSB0cnVlLlxuICogVGhpcyBpcyB0aGUgZXhwbGljaXQgZm9ybSBvZiB0aGUgaW1wbGljaXQgYXJyYXkgQU5EIChgU2luZ2xlQ29uZGl0aW9uW11gKS5cbiAqIFVubGlrZSB0aGUgaW1wbGljaXQgZm9ybSwgYCRhbmRgIHN1cHBvcnRzIG5lc3RlZCBgJG9yYCBhbmQgYCRhbmRgIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCB0eXBlIEFuZENvbmRpdGlvbiA9IHsgJGFuZDogVmlzaWJpbGl0eUNvbmRpdGlvbltdIH07XG5cbi8qKlxuICogT1Igd3JhcHBlciDigJQgYXQgbGVhc3Qgb25lIGNoaWxkIGNvbmRpdGlvbiBtdXN0IGJlIHRydWUuXG4gKi9cbmV4cG9ydCB0eXBlIE9yQ29uZGl0aW9uID0geyAkb3I6IFZpc2liaWxpdHlDb25kaXRpb25bXSB9O1xuXG4vKipcbiAqIFZpc2liaWxpdHkgY29uZGl0aW9uIHR5cGVzLlxuICogLSBgYm9vbGVhbmAg4oCUIGFsd2F5cy9uZXZlclxuICogLSBgU2luZ2xlQ29uZGl0aW9uYCDigJQgc2luZ2xlIGNvbmRpdGlvbiAoYCRzdGF0ZWAsIGAkaXRlbWAsIG9yIGAkaW5kZXhgKVxuICogLSBgU2luZ2xlQ29uZGl0aW9uW11gIOKAlCBpbXBsaWNpdCBBTkQgKGFsbCBtdXN0IGJlIHRydWUpXG4gKiAtIGBBbmRDb25kaXRpb25gIOKAlCBgeyAkYW5kOiBbLi4uXSB9YCwgZXhwbGljaXQgQU5EIChhbGwgbXVzdCBiZSB0cnVlKVxuICogLSBgT3JDb25kaXRpb25gIOKAlCBgeyAkb3I6IFsuLi5dIH1gLCBhdCBsZWFzdCBvbmUgbXVzdCBiZSB0cnVlXG4gKi9cbmV4cG9ydCB0eXBlIFZpc2liaWxpdHlDb25kaXRpb24gPVxuICB8IGJvb2xlYW5cbiAgfCBTaW5nbGVDb25kaXRpb25cbiAgfCBTaW5nbGVDb25kaXRpb25bXVxuICB8IEFuZENvbmRpdGlvblxuICB8IE9yQ29uZGl0aW9uO1xuXG4vKipcbiAqIEZsYXQgVUkgdHJlZSBzdHJ1Y3R1cmUgKG9wdGltaXplZCBmb3IgTExNIGdlbmVyYXRpb24pXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BlYyB7XG4gIC8qKiBSb290IGVsZW1lbnQga2V5ICovXG4gIHJvb3Q6IHN0cmluZztcbiAgLyoqIEZsYXQgbWFwIG9mIGVsZW1lbnRzIGJ5IGtleSAqL1xuICBlbGVtZW50czogUmVjb3JkPHN0cmluZywgVUlFbGVtZW50PjtcbiAgLyoqIE9wdGlvbmFsIGluaXRpYWwgc3RhdGUgdG8gc2VlZCB0aGUgc3RhdGUgbW9kZWwuXG4gICAqICBDb21wb25lbnRzIHVzaW5nIHN0YXRlUGF0aCB3aWxsIHJlYWQgZnJvbSAvIHdyaXRlIHRvIHRoaXMgc3RhdGUuICovXG4gIHN0YXRlPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbi8qKlxuICogU3RhdGUgbW9kZWwgdHlwZVxuICovXG5leHBvcnQgdHlwZSBTdGF0ZU1vZGVsID0gUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cbi8qKlxuICogQW4gYWJzdHJhY3Qgc3RvcmUgdGhhdCBvd25zIHN0YXRlIGFuZCBub3RpZmllcyBzdWJzY3JpYmVycyBvbiBjaGFuZ2UuXG4gKlxuICogQ29uc3VtZXJzIGNhbiBzdXBwbHkgdGhlaXIgb3duIGltcGxlbWVudGF0aW9uIChiYWNrZWQgYnkgUmVkdXgsIFp1c3RhbmQsXG4gKiBYU3RhdGUsIGV0Yy4pIG9yIHVzZSB0aGUgYnVpbHQtaW4ge0BsaW5rIGNyZWF0ZVN0YXRlU3RvcmV9IGZvciBhIHNpbXBsZVxuICogaW4tbWVtb3J5IHN0b3JlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFN0YXRlU3RvcmUge1xuICAvKiogUmVhZCBhIHZhbHVlIGJ5IEpTT04gUG9pbnRlciBwYXRoLiAqL1xuICBnZXQ6IChwYXRoOiBzdHJpbmcpID0+IHVua25vd247XG4gIC8qKlxuICAgKiBXcml0ZSBhIHZhbHVlIGJ5IEpTT04gUG9pbnRlciBwYXRoIGFuZCBub3RpZnkgc3Vic2NyaWJlcnMuXG4gICAqIEVxdWFsaXR5IGlzIGNoZWNrZWQgYnkgcmVmZXJlbmNlIChgPT09YCksIG5vdCBkZWVwIGNvbXBhcmlzb24uXG4gICAqIENhbGxlcnMgbXVzdCBwYXNzIGEgbmV3IG9iamVjdC9hcnJheSByZWZlcmVuY2UgZm9yIGNoYW5nZXMgdG8gYmUgZGV0ZWN0ZWQuXG4gICAqL1xuICBzZXQ6IChwYXRoOiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKSA9PiB2b2lkO1xuICAvKipcbiAgICogV3JpdGUgbXVsdGlwbGUgdmFsdWVzIGF0IG9uY2UgYW5kIG5vdGlmeSBzdWJzY3JpYmVycyAoc2luZ2xlIG5vdGlmaWNhdGlvbikuXG4gICAqIEVhY2ggdmFsdWUgaXMgY29tcGFyZWQgYnkgcmVmZXJlbmNlIChgPT09YCk7IG9ubHkgcGF0aHMgd2hvc2UgdmFsdWVcbiAgICogYWN0dWFsbHkgY2hhbmdlZCBhcmUgYXBwbGllZC5cbiAgICovXG4gIHVwZGF0ZTogKHVwZGF0ZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkO1xuICAvKiogUmV0dXJuIHRoZSBmdWxsIHN0YXRlIG9iamVjdCAodXNlZCBieSBgdXNlU3luY0V4dGVybmFsU3RvcmVgKS4gKi9cbiAgZ2V0U25hcHNob3Q6ICgpID0+IFN0YXRlTW9kZWw7XG4gIC8qKiBPcHRpb25hbCBzZXJ2ZXIgc25hcHNob3QgZm9yIFNTUiAocGFzc2VkIHRvIGB1c2VTeW5jRXh0ZXJuYWxTdG9yZWApLiBGYWxscyBiYWNrIHRvIGBnZXRTbmFwc2hvdGAgd2hlbiBvbWl0dGVkLiAqL1xuICBnZXRTZXJ2ZXJTbmFwc2hvdD86ICgpID0+IFN0YXRlTW9kZWw7XG4gIC8qKiBSZWdpc3RlciBhIGxpc3RlbmVyIHRoYXQgaXMgY2FsbGVkIG9uIGV2ZXJ5IHN0YXRlIGNoYW5nZS4gUmV0dXJucyBhbiB1bnN1YnNjcmliZSBmdW5jdGlvbi4gKi9cbiAgc3Vic2NyaWJlOiAobGlzdGVuZXI6ICgpID0+IHZvaWQpID0+ICgpID0+IHZvaWQ7XG59XG5cbi8qKlxuICogQ29tcG9uZW50IHNjaGVtYSBkZWZpbml0aW9uIHVzaW5nIFpvZFxuICovXG5leHBvcnQgdHlwZSBDb21wb25lbnRTY2hlbWEgPSB6LlpvZFR5cGU8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuXG4vKipcbiAqIFZhbGlkYXRpb24gbW9kZSBmb3IgY2F0YWxvZyB2YWxpZGF0aW9uXG4gKi9cbmV4cG9ydCB0eXBlIFZhbGlkYXRpb25Nb2RlID0gXCJzdHJpY3RcIiB8IFwid2FyblwiIHwgXCJpZ25vcmVcIjtcblxuLyoqXG4gKiBKU09OIHBhdGNoIG9wZXJhdGlvbiB0eXBlcyAoUkZDIDY5MDIpXG4gKi9cbmV4cG9ydCB0eXBlIFBhdGNoT3AgPSBcImFkZFwiIHwgXCJyZW1vdmVcIiB8IFwicmVwbGFjZVwiIHwgXCJtb3ZlXCIgfCBcImNvcHlcIiB8IFwidGVzdFwiO1xuXG4vKipcbiAqIEpTT04gcGF0Y2ggb3BlcmF0aW9uIChSRkMgNjkwMilcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBKc29uUGF0Y2gge1xuICBvcDogUGF0Y2hPcDtcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogUmVxdWlyZWQgZm9yIGFkZCwgcmVwbGFjZSwgdGVzdCAqL1xuICB2YWx1ZT86IHVua25vd247XG4gIC8qKiBSZXF1aXJlZCBmb3IgbW92ZSwgY29weSAoc291cmNlIGxvY2F0aW9uKSAqL1xuICBmcm9tPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYSBkeW5hbWljIHZhbHVlIGFnYWluc3QgYSBzdGF0ZSBtb2RlbFxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUR5bmFtaWNWYWx1ZTxUPihcbiAgdmFsdWU6IER5bmFtaWNWYWx1ZTxUPixcbiAgc3RhdGVNb2RlbDogU3RhdGVNb2RlbCxcbik6IFQgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIFwiJHN0YXRlXCIgaW4gdmFsdWUpIHtcbiAgICByZXR1cm4gZ2V0QnlQYXRoKHN0YXRlTW9kZWwsICh2YWx1ZSBhcyB7ICRzdGF0ZTogc3RyaW5nIH0pLiRzdGF0ZSkgYXNcbiAgICAgIHwgVFxuICAgICAgfCB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4gdmFsdWUgYXMgVDtcbn1cblxuLyoqXG4gKiBVbmVzY2FwZSBhIEpTT04gUG9pbnRlciB0b2tlbiBwZXIgUkZDIDY5MDEgU2VjdGlvbiA0LlxuICogfjEgaXMgZGVjb2RlZCB0byAvIGFuZCB+MCBpcyBkZWNvZGVkIHRvIH4gKG9yZGVyIG1hdHRlcnMpLlxuICovXG5mdW5jdGlvbiB1bmVzY2FwZUpzb25Qb2ludGVyKHRva2VuOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdG9rZW4ucmVwbGFjZSgvfjEvZywgXCIvXCIpLnJlcGxhY2UoL34wL2csIFwiflwiKTtcbn1cblxuLyoqXG4gKiBQYXJzZSBhIEpTT04gUG9pbnRlciBwYXRoIGludG8gdW5lc2NhcGVkIHNlZ21lbnRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VKc29uUG9pbnRlcihwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHJhdyA9IHBhdGguc3RhcnRzV2l0aChcIi9cIikgPyBwYXRoLnNsaWNlKDEpLnNwbGl0KFwiL1wiKSA6IHBhdGguc3BsaXQoXCIvXCIpO1xuICByZXR1cm4gcmF3Lm1hcCh1bmVzY2FwZUpzb25Qb2ludGVyKTtcbn1cblxuLyoqXG4gKiBHZXQgYSB2YWx1ZSBmcm9tIGFuIG9iamVjdCBieSBKU09OIFBvaW50ZXIgcGF0aCAoUkZDIDY5MDEpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRCeVBhdGgob2JqOiB1bmtub3duLCBwYXRoOiBzdHJpbmcpOiB1bmtub3duIHtcbiAgaWYgKCFwYXRoIHx8IHBhdGggPT09IFwiL1wiKSB7XG4gICAgcmV0dXJuIG9iajtcbiAgfVxuXG4gIGNvbnN0IHNlZ21lbnRzID0gcGFyc2VKc29uUG9pbnRlcihwYXRoKTtcblxuICBsZXQgY3VycmVudDogdW5rbm93biA9IG9iajtcblxuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VnbWVudHMpIHtcbiAgICBpZiAoY3VycmVudCA9PT0gbnVsbCB8fCBjdXJyZW50ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoY3VycmVudCkpIHtcbiAgICAgIGNvbnN0IGluZGV4ID0gcGFyc2VJbnQoc2VnbWVudCwgMTApO1xuICAgICAgY3VycmVudCA9IGN1cnJlbnRbaW5kZXhdO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGN1cnJlbnQgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGN1cnJlbnQgPSAoY3VycmVudCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilbc2VnbWVudF07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGN1cnJlbnQ7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYSBzdHJpbmcgaXMgYSBudW1lcmljIGluZGV4XG4gKi9cbmZ1bmN0aW9uIGlzTnVtZXJpY0luZGV4KHN0cjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvXlxcZCskLy50ZXN0KHN0cik7XG59XG5cbi8qKlxuICogU2V0IGEgdmFsdWUgaW4gYW4gb2JqZWN0IGJ5IEpTT04gUG9pbnRlciBwYXRoIChSRkMgNjkwMSkuXG4gKiBBdXRvbWF0aWNhbGx5IGNyZWF0ZXMgYXJyYXlzIHdoZW4gdGhlIHBhdGggc2VnbWVudCBpcyBhIG51bWVyaWMgaW5kZXguXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRCeVBhdGgoXG4gIG9iajogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gIHBhdGg6IHN0cmluZyxcbiAgdmFsdWU6IHVua25vd24sXG4pOiB2b2lkIHtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXJzZUpzb25Qb2ludGVyKHBhdGgpO1xuXG4gIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICBsZXQgY3VycmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmtub3duW10gPSBvYmo7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICBjb25zdCBzZWdtZW50ID0gc2VnbWVudHNbaV0hO1xuICAgIGNvbnN0IG5leHRTZWdtZW50ID0gc2VnbWVudHNbaSArIDFdO1xuICAgIGNvbnN0IG5leHRJc051bWVyaWMgPVxuICAgICAgbmV4dFNlZ21lbnQgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgKGlzTnVtZXJpY0luZGV4KG5leHRTZWdtZW50KSB8fCBuZXh0U2VnbWVudCA9PT0gXCItXCIpO1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoY3VycmVudCkpIHtcbiAgICAgIGNvbnN0IGluZGV4ID0gcGFyc2VJbnQoc2VnbWVudCwgMTApO1xuICAgICAgaWYgKGN1cnJlbnRbaW5kZXhdID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIGN1cnJlbnRbaW5kZXhdICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIGN1cnJlbnRbaW5kZXhdID0gbmV4dElzTnVtZXJpYyA/IFtdIDoge307XG4gICAgICB9XG4gICAgICBjdXJyZW50ID0gY3VycmVudFtpbmRleF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmtub3duW107XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghKHNlZ21lbnQgaW4gY3VycmVudCkgfHwgdHlwZW9mIGN1cnJlbnRbc2VnbWVudF0gIT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgY3VycmVudFtzZWdtZW50XSA9IG5leHRJc051bWVyaWMgPyBbXSA6IHt9O1xuICAgICAgfVxuICAgICAgY3VycmVudCA9IGN1cnJlbnRbc2VnbWVudF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmtub3duW107XG4gICAgfVxuICB9XG5cbiAgY29uc3QgbGFzdFNlZ21lbnQgPSBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSE7XG4gIGlmIChBcnJheS5pc0FycmF5KGN1cnJlbnQpKSB7XG4gICAgaWYgKGxhc3RTZWdtZW50ID09PSBcIi1cIikge1xuICAgICAgY3VycmVudC5wdXNoKHZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgaW5kZXggPSBwYXJzZUludChsYXN0U2VnbWVudCwgMTApO1xuICAgICAgY3VycmVudFtpbmRleF0gPSB2YWx1ZTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY3VycmVudFtsYXN0U2VnbWVudF0gPSB2YWx1ZTtcbiAgfVxufVxuXG4vKipcbiAqIEFkZCBhIHZhbHVlIHBlciBSRkMgNjkwMiBcImFkZFwiIHNlbWFudGljcy5cbiAqIEZvciBvYmplY3RzOiBjcmVhdGUtb3ItcmVwbGFjZSB0aGUgbWVtYmVyLlxuICogRm9yIGFycmF5czogaW5zZXJ0IGJlZm9yZSB0aGUgZ2l2ZW4gaW5kZXgsIG9yIGFwcGVuZCBpZiBcIi1cIi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkZEJ5UGF0aChcbiAgb2JqOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgcGF0aDogc3RyaW5nLFxuICB2YWx1ZTogdW5rbm93bixcbik6IHZvaWQge1xuICBjb25zdCBzZWdtZW50cyA9IHBhcnNlSnNvblBvaW50ZXIocGF0aCk7XG5cbiAgaWYgKHNlZ21lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gIGxldCBjdXJyZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVua25vd25bXSA9IG9iajtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnRzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgIGNvbnN0IHNlZ21lbnQgPSBzZWdtZW50c1tpXSE7XG4gICAgY29uc3QgbmV4dFNlZ21lbnQgPSBzZWdtZW50c1tpICsgMV07XG4gICAgY29uc3QgbmV4dElzTnVtZXJpYyA9XG4gICAgICBuZXh0U2VnbWVudCAhPT0gdW5kZWZpbmVkICYmXG4gICAgICAoaXNOdW1lcmljSW5kZXgobmV4dFNlZ21lbnQpIHx8IG5leHRTZWdtZW50ID09PSBcIi1cIik7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShjdXJyZW50KSkge1xuICAgICAgY29uc3QgaW5kZXggPSBwYXJzZUludChzZWdtZW50LCAxMCk7XG4gICAgICBpZiAoY3VycmVudFtpbmRleF0gPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgY3VycmVudFtpbmRleF0gIT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgY3VycmVudFtpbmRleF0gPSBuZXh0SXNOdW1lcmljID8gW10gOiB7fTtcbiAgICAgIH1cbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50W2luZGV4XSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVua25vd25bXTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCEoc2VnbWVudCBpbiBjdXJyZW50KSB8fCB0eXBlb2YgY3VycmVudFtzZWdtZW50XSAhPT0gXCJvYmplY3RcIikge1xuICAgICAgICBjdXJyZW50W3NlZ21lbnRdID0gbmV4dElzTnVtZXJpYyA/IFtdIDoge307XG4gICAgICB9XG4gICAgICBjdXJyZW50ID0gY3VycmVudFtzZWdtZW50XSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVua25vd25bXTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBsYXN0U2VnbWVudCA9IHNlZ21lbnRzW3NlZ21lbnRzLmxlbmd0aCAtIDFdITtcbiAgaWYgKEFycmF5LmlzQXJyYXkoY3VycmVudCkpIHtcbiAgICBpZiAobGFzdFNlZ21lbnQgPT09IFwiLVwiKSB7XG4gICAgICBjdXJyZW50LnB1c2godmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBpbmRleCA9IHBhcnNlSW50KGxhc3RTZWdtZW50LCAxMCk7XG4gICAgICBjdXJyZW50LnNwbGljZShpbmRleCwgMCwgdmFsdWUpO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjdXJyZW50W2xhc3RTZWdtZW50XSA9IHZhbHVlO1xuICB9XG59XG5cbi8qKlxuICogUmVtb3ZlIGEgdmFsdWUgcGVyIFJGQyA2OTAyIFwicmVtb3ZlXCIgc2VtYW50aWNzLlxuICogRm9yIG9iamVjdHM6IGRlbGV0ZSB0aGUgcHJvcGVydHkuXG4gKiBGb3IgYXJyYXlzOiBzcGxpY2Ugb3V0IHRoZSBlbGVtZW50IGF0IHRoZSBnaXZlbiBpbmRleC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUJ5UGF0aChvYmo6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBwYXRoOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXJzZUpzb25Qb2ludGVyKHBhdGgpO1xuXG4gIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICBsZXQgY3VycmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmtub3duW10gPSBvYmo7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICBjb25zdCBzZWdtZW50ID0gc2VnbWVudHNbaV0hO1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoY3VycmVudCkpIHtcbiAgICAgIGNvbnN0IGluZGV4ID0gcGFyc2VJbnQoc2VnbWVudCwgMTApO1xuICAgICAgaWYgKGN1cnJlbnRbaW5kZXhdID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIGN1cnJlbnRbaW5kZXhdICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybjsgLy8gcGF0aCBkb2VzIG5vdCBleGlzdFxuICAgICAgfVxuICAgICAgY3VycmVudCA9IGN1cnJlbnRbaW5kZXhdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5rbm93bltdO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIShzZWdtZW50IGluIGN1cnJlbnQpIHx8IHR5cGVvZiBjdXJyZW50W3NlZ21lbnRdICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybjsgLy8gcGF0aCBkb2VzIG5vdCBleGlzdFxuICAgICAgfVxuICAgICAgY3VycmVudCA9IGN1cnJlbnRbc2VnbWVudF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmtub3duW107XG4gICAgfVxuICB9XG5cbiAgY29uc3QgbGFzdFNlZ21lbnQgPSBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSE7XG4gIGlmIChBcnJheS5pc0FycmF5KGN1cnJlbnQpKSB7XG4gICAgY29uc3QgaW5kZXggPSBwYXJzZUludChsYXN0U2VnbWVudCwgMTApO1xuICAgIGlmIChpbmRleCA+PSAwICYmIGluZGV4IDwgY3VycmVudC5sZW5ndGgpIHtcbiAgICAgIGN1cnJlbnQuc3BsaWNlKGluZGV4LCAxKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgZGVsZXRlIGN1cnJlbnRbbGFzdFNlZ21lbnRdO1xuICB9XG59XG5cbi8qKlxuICogRGVlcCBlcXVhbGl0eSBjaGVjayBmb3IgUkZDIDY5MDIgXCJ0ZXN0XCIgb3BlcmF0aW9uLlxuICovXG5mdW5jdGlvbiBkZWVwRXF1YWwoYTogdW5rbm93biwgYjogdW5rbm93bik6IGJvb2xlYW4ge1xuICBpZiAoYSA9PT0gYikgcmV0dXJuIHRydWU7XG4gIGlmIChhID09PSBudWxsIHx8IGIgPT09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiBhICE9PSB0eXBlb2YgYikgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIGEgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZTtcblxuICBpZiAoQXJyYXkuaXNBcnJheShhKSkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShiKSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChhLmxlbmd0aCAhPT0gYi5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gYS5ldmVyeSgoaXRlbSwgaSkgPT4gZGVlcEVxdWFsKGl0ZW0sIGJbaV0pKTtcbiAgfVxuXG4gIGNvbnN0IGFPYmogPSBhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjb25zdCBiT2JqID0gYiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgY29uc3QgYUtleXMgPSBPYmplY3Qua2V5cyhhT2JqKTtcbiAgY29uc3QgYktleXMgPSBPYmplY3Qua2V5cyhiT2JqKTtcblxuICBpZiAoYUtleXMubGVuZ3RoICE9PSBiS2V5cy5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIGFLZXlzLmV2ZXJ5KChrZXkpID0+IGRlZXBFcXVhbChhT2JqW2tleV0sIGJPYmpba2V5XSkpO1xufVxuXG4vKipcbiAqIEZpbmQgYSBmb3JtIHZhbHVlIGZyb20gcGFyYW1zIGFuZC9vciBzdGF0ZS5cbiAqIFVzZWZ1bCBpbiBhY3Rpb24gaGFuZGxlcnMgdG8gbG9jYXRlIGZvcm0gaW5wdXQgdmFsdWVzIHJlZ2FyZGxlc3Mgb2YgcGF0aCBmb3JtYXQuXG4gKlxuICogQ2hlY2tzIGluIG9yZGVyOlxuICogMS4gRGlyZWN0IHBhcmFtIGtleSAoaWYgbm90IGEgcGF0aCByZWZlcmVuY2UpXG4gKiAyLiBQYXJhbSBrZXlzIGVuZGluZyB3aXRoIHRoZSBmaWVsZCBuYW1lXG4gKiAzLiBTdGF0ZSBrZXlzIGVuZGluZyB3aXRoIHRoZSBmaWVsZCBuYW1lIChkb3Qgbm90YXRpb24pXG4gKiA0LiBTdGF0ZSBwYXRoIHVzaW5nIGdldEJ5UGF0aCAoc2xhc2ggbm90YXRpb24pXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEZpbmQgXCJuYW1lXCIgZnJvbSBwYXJhbXMgb3Igc3RhdGVcbiAqIGNvbnN0IG5hbWUgPSBmaW5kRm9ybVZhbHVlKFwibmFtZVwiLCBwYXJhbXMsIHN0YXRlKTtcbiAqXG4gKiAvLyBXaWxsIGZpbmQgZnJvbTogcGFyYW1zLm5hbWUsIHBhcmFtc1tcImZvcm0ubmFtZVwiXSwgc3RhdGVbXCJmb3JtLm5hbWVcIl0sIG9yIGdldEJ5UGF0aChzdGF0ZSwgXCJuYW1lXCIpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaW5kRm9ybVZhbHVlKFxuICBmaWVsZE5hbWU6IHN0cmluZyxcbiAgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gIHN0YXRlPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4pOiB1bmtub3duIHtcbiAgLy8gQ2hlY2sgcGFyYW1zIGZpcnN0IChidXQgbm90IGlmIGl0IGxvb2tzIGxpa2UgYSBzdGF0ZSBwYXRoIHJlZmVyZW5jZSlcbiAgaWYgKHBhcmFtcz8uW2ZpZWxkTmFtZV0gIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHZhbCA9IHBhcmFtc1tmaWVsZE5hbWVdO1xuICAgIC8vIElmIHRoZSB2YWx1ZSBsb29rcyBsaWtlIGEgcGF0aCByZWZlcmVuY2UgKGNvbnRhaW5zIGRvdHMpLCBza2lwIGl0XG4gICAgaWYgKHR5cGVvZiB2YWwgIT09IFwic3RyaW5nXCIgfHwgIXZhbC5pbmNsdWRlcyhcIi5cIikpIHtcbiAgICAgIHJldHVybiB2YWw7XG4gICAgfVxuICB9XG5cbiAgLy8gQ2hlY2sgcGFyYW0ga2V5cyB0aGF0IGVuZCB3aXRoIHRoZSBmaWVsZCBuYW1lXG4gIGlmIChwYXJhbXMpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhwYXJhbXMpKSB7XG4gICAgICBpZiAoa2V5LmVuZHNXaXRoKGAuJHtmaWVsZE5hbWV9YCkpIHtcbiAgICAgICAgY29uc3QgdmFsID0gcGFyYW1zW2tleV07XG4gICAgICAgIGlmICh0eXBlb2YgdmFsICE9PSBcInN0cmluZ1wiIHx8ICF2YWwuaW5jbHVkZXMoXCIuXCIpKSB7XG4gICAgICAgICAgcmV0dXJuIHZhbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIENoZWNrIHN0YXRlIGtleXMgdGhhdCBlbmQgd2l0aCB0aGUgZmllbGQgbmFtZSAoaGFuZGxlcyBhbnkgZm9ybSBuYW1pbmcpXG4gIGlmIChzdGF0ZSkge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHN0YXRlKSkge1xuICAgICAgaWYgKGtleSA9PT0gZmllbGROYW1lIHx8IGtleS5lbmRzV2l0aChgLiR7ZmllbGROYW1lfWApKSB7XG4gICAgICAgIHJldHVybiBzdGF0ZVtrZXldO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRyeSBnZXRCeVBhdGggd2l0aCB0aGUgcmF3IGZpZWxkIG5hbWVcbiAgICBjb25zdCB2YWwgPSBnZXRCeVBhdGgoc3RhdGUsIGZpZWxkTmFtZSk7XG4gICAgaWYgKHZhbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gdmFsO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTcGVjU3RyZWFtIC0gU3RyZWFtaW5nIGZvcm1hdCBmb3IgcHJvZ3Jlc3NpdmVseSBidWlsZGluZyBzcGVjc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBBIFNwZWNTdHJlYW0gbGluZSAtIGEgc2luZ2xlIHBhdGNoIG9wZXJhdGlvbiBpbiB0aGUgc3RyZWFtLlxuICovXG5leHBvcnQgdHlwZSBTcGVjU3RyZWFtTGluZSA9IEpzb25QYXRjaDtcblxuLyoqXG4gKiBQYXJzZSBhIHNpbmdsZSBTcGVjU3RyZWFtIGxpbmUgaW50byBhIHBhdGNoIG9wZXJhdGlvbi5cbiAqIFJldHVybnMgbnVsbCBpZiB0aGUgbGluZSBpcyBpbnZhbGlkIG9yIGVtcHR5LlxuICpcbiAqIFNwZWNTdHJlYW0gaXMganNvbi1yZW5kZXIncyBzdHJlYW1pbmcgZm9ybWF0IHdoZXJlIGVhY2ggbGluZSBpcyBhIEpTT04gcGF0Y2hcbiAqIG9wZXJhdGlvbiB0aGF0IHByb2dyZXNzaXZlbHkgYnVpbGRzIHVwIHRoZSBmaW5hbCBzcGVjLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTcGVjU3RyZWFtTGluZShsaW5lOiBzdHJpbmcpOiBTcGVjU3RyZWFtTGluZSB8IG51bGwge1xuICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gIGlmICghdHJpbW1lZCB8fCAhdHJpbW1lZC5zdGFydHNXaXRoKFwie1wiKSkgcmV0dXJuIG51bGw7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBwYXRjaCA9IEpTT04ucGFyc2UodHJpbW1lZCkgYXMgU3BlY1N0cmVhbUxpbmU7XG4gICAgaWYgKHBhdGNoLm9wICYmIHBhdGNoLnBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHBhdGNoO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBBcHBseSBhIHNpbmdsZSBSRkMgNjkwMiBKU09OIFBhdGNoIG9wZXJhdGlvbiB0byBhbiBvYmplY3QuXG4gKiBNdXRhdGVzIHRoZSBvYmplY3QgaW4gcGxhY2UuXG4gKlxuICogU3VwcG9ydHMgYWxsIHNpeCBSRkMgNjkwMiBvcGVyYXRpb25zOiBhZGQsIHJlbW92ZSwgcmVwbGFjZSwgbW92ZSwgY29weSwgdGVzdC5cbiAqXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgYSBcInRlc3RcIiBvcGVyYXRpb24gZmFpbHMgKHZhbHVlIG1pc21hdGNoKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5U3BlY1N0cmVhbVBhdGNoPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4oXG4gIG9iajogVCxcbiAgcGF0Y2g6IFNwZWNTdHJlYW1MaW5lLFxuKTogVCB7XG4gIHN3aXRjaCAocGF0Y2gub3ApIHtcbiAgICBjYXNlIFwiYWRkXCI6XG4gICAgICBhZGRCeVBhdGgob2JqLCBwYXRjaC5wYXRoLCBwYXRjaC52YWx1ZSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlIFwicmVwbGFjZVwiOlxuICAgICAgLy8gUkZDIDY5MDI6IHRhcmdldCBtdXN0IGV4aXN0LiBGb3Igc3RyZWFtaW5nIHRvbGVyYW5jZSB3ZSBzZXQgcmVnYXJkbGVzcy5cbiAgICAgIHNldEJ5UGF0aChvYmosIHBhdGNoLnBhdGgsIHBhdGNoLnZhbHVlKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgXCJyZW1vdmVcIjpcbiAgICAgIHJlbW92ZUJ5UGF0aChvYmosIHBhdGNoLnBhdGgpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSBcIm1vdmVcIjoge1xuICAgICAgaWYgKCFwYXRjaC5mcm9tKSBicmVhaztcbiAgICAgIGNvbnN0IG1vdmVWYWx1ZSA9IGdldEJ5UGF0aChvYmosIHBhdGNoLmZyb20pO1xuICAgICAgcmVtb3ZlQnlQYXRoKG9iaiwgcGF0Y2guZnJvbSk7XG4gICAgICBhZGRCeVBhdGgob2JqLCBwYXRjaC5wYXRoLCBtb3ZlVmFsdWUpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNhc2UgXCJjb3B5XCI6IHtcbiAgICAgIGlmICghcGF0Y2guZnJvbSkgYnJlYWs7XG4gICAgICBjb25zdCBjb3B5VmFsdWUgPSBnZXRCeVBhdGgob2JqLCBwYXRjaC5mcm9tKTtcbiAgICAgIGFkZEJ5UGF0aChvYmosIHBhdGNoLnBhdGgsIGNvcHlWYWx1ZSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSBcInRlc3RcIjoge1xuICAgICAgY29uc3QgYWN0dWFsID0gZ2V0QnlQYXRoKG9iaiwgcGF0Y2gucGF0aCk7XG4gICAgICBpZiAoIWRlZXBFcXVhbChhY3R1YWwsIHBhdGNoLnZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYFRlc3Qgb3BlcmF0aW9uIGZhaWxlZDogdmFsdWUgYXQgXCIke3BhdGNoLnBhdGh9XCIgZG9lcyBub3QgbWF0Y2hgLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiBvYmo7XG59XG5cbi8qKlxuICogQXBwbHkgYSBzaW5nbGUgUkZDIDY5MDIgSlNPTiBQYXRjaCBvcGVyYXRpb24gdG8gYSBTcGVjLlxuICogTXV0YXRlcyB0aGUgc3BlYyBpbiBwbGFjZSBhbmQgcmV0dXJucyBpdC5cbiAqXG4gKiBUaGlzIGlzIGEgdHlwZWQgY29udmVuaWVuY2Ugd3JhcHBlciBhcm91bmQgYGFwcGx5U3BlY1N0cmVhbVBhdGNoYCB0aGF0XG4gKiBhY2NlcHRzIGEgYFNwZWNgIGRpcmVjdGx5IHdpdGhvdXQgcmVxdWlyaW5nIGEgY2FzdCB0byBgUmVjb3JkPHN0cmluZywgdW5rbm93bj5gLlxuICpcbiAqIE5vdGU6IFRoaXMgbXV0YXRlcyB0aGUgc3BlYy4gRm9yIFJlYWN0IHN0YXRlIHVwZGF0ZXMsIHNwcmVhZCB0aGUgcmVzdWx0XG4gKiB0byBjcmVhdGUgYSBuZXcgcmVmZXJlbmNlOiBgc2V0U3BlYyh7IC4uLmFwcGx5U3BlY1BhdGNoKHNwZWMsIHBhdGNoKSB9KWAuXG4gKlxuICogQGV4YW1wbGVcbiAqIGxldCBzcGVjOiBTcGVjID0geyByb290OiBcIlwiLCBlbGVtZW50czoge30gfTtcbiAqIGFwcGx5U3BlY1BhdGNoKHNwZWMsIHsgb3A6IFwiYWRkXCIsIHBhdGg6IFwiL3Jvb3RcIiwgdmFsdWU6IFwibWFpblwiIH0pO1xuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlTcGVjUGF0Y2goc3BlYzogU3BlYywgcGF0Y2g6IFNwZWNTdHJlYW1MaW5lKTogU3BlYyB7XG4gIGFwcGx5U3BlY1N0cmVhbVBhdGNoKHNwZWMgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgcGF0Y2gpO1xuICByZXR1cm4gc3BlYztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE5lc3RlZC10by1GbGF0IENvbnZlcnNpb25cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQSBuZXN0ZWQgc3BlYyBub2RlLiBUaGlzIGlzIHRoZSB0cmVlIGZvcm1hdCB0aGF0IGh1bWFucyBuYXR1cmFsbHkgd3JpdGUg4oCUXG4gKiBlYWNoIG5vZGUgaGFzIGlubGluZSBgY2hpbGRyZW5gIGFzIGFuIGFycmF5IG9mIGNoaWxkIG5vZGUgb2JqZWN0cyByYXRoZXJcbiAqIHRoYW4gc3RyaW5nIGtleXMuXG4gKi9cbmludGVyZmFjZSBOZXN0ZWROb2RlIHtcbiAgdHlwZTogc3RyaW5nO1xuICBwcm9wczogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNoaWxkcmVuPzogTmVzdGVkTm9kZVtdO1xuICAvKiogQW55IG90aGVyIHRvcC1sZXZlbCBmaWVsZHMgKHZpc2libGUsIG9uLCByZXBlYXQsIGV0Yy4pICovXG4gIFtrZXk6IHN0cmluZ106IHVua25vd247XG59XG5cbi8qKlxuICogQ29udmVydCBhIG5lc3RlZCAodHJlZS1zdHJ1Y3R1cmVkKSBzcGVjIGludG8gdGhlIGZsYXQgYFNwZWNgIGZvcm1hdCB1c2VkXG4gKiBieSBqc29uLXJlbmRlciByZW5kZXJlcnMuXG4gKlxuICogSW4gdGhlIG5lc3RlZCBmb3JtYXQgZWFjaCBub2RlIGhhcyBpbmxpbmUgYGNoaWxkcmVuYCBhcyBhbiBhcnJheSBvZiBjaGlsZFxuICogb2JqZWN0cy4gVGhpcyBmdW5jdGlvbiB3YWxrcyB0aGUgdHJlZSwgYXNzaWducyBhdXRvLWdlbmVyYXRlZCBrZXlzXG4gKiAoYGVsLTBgLCBgZWwtMWAsIC4uLiksIGFuZCBwcm9kdWNlcyBhIGZsYXQgYHsgcm9vdCwgZWxlbWVudHMsIHN0YXRlIH1gIHNwZWMuXG4gKlxuICogVGhlIHRvcC1sZXZlbCBgc3RhdGVgIGZpZWxkIChpZiBwcmVzZW50IG9uIHRoZSByb290IG5vZGUpIGlzIGhvaXN0ZWQgdG9cbiAqIGBzcGVjLnN0YXRlYC5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGNvbnN0IG5lc3RlZCA9IHtcbiAqICAgdHlwZTogXCJDYXJkXCIsXG4gKiAgIHByb3BzOiB7IHRpdGxlOiBcIkhlbGxvXCIgfSxcbiAqICAgY2hpbGRyZW46IFtcbiAqICAgICB7IHR5cGU6IFwiVGV4dFwiLCBwcm9wczogeyBjb250ZW50OiBcIldvcmxkXCIgfSB9LFxuICogICBdLFxuICogICBzdGF0ZTogeyBjb3VudDogMCB9LFxuICogfTtcbiAqIGNvbnN0IHNwZWMgPSBuZXN0ZWRUb0ZsYXQobmVzdGVkKTtcbiAqIC8vIHtcbiAqIC8vICAgcm9vdDogXCJlbC0wXCIsXG4gKiAvLyAgIGVsZW1lbnRzOiB7XG4gKiAvLyAgICAgXCJlbC0wXCI6IHsgdHlwZTogXCJDYXJkXCIsIHByb3BzOiB7IHRpdGxlOiBcIkhlbGxvXCIgfSwgY2hpbGRyZW46IFtcImVsLTFcIl0gfSxcbiAqIC8vICAgICBcImVsLTFcIjogeyB0eXBlOiBcIlRleHRcIiwgcHJvcHM6IHsgY29udGVudDogXCJXb3JsZFwiIH0sIGNoaWxkcmVuOiBbXSB9LFxuICogLy8gICB9LFxuICogLy8gICBzdGF0ZTogeyBjb3VudDogMCB9LFxuICogLy8gfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuZXN0ZWRUb0ZsYXQobmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IFNwZWMge1xuICBjb25zdCBlbGVtZW50czogUmVjb3JkPHN0cmluZywgVUlFbGVtZW50PiA9IHt9O1xuICBsZXQgY291bnRlciA9IDA7XG5cbiAgZnVuY3Rpb24gd2Fsayhub2RlOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHN0cmluZyB7XG4gICAgY29uc3Qga2V5ID0gYGVsLSR7Y291bnRlcisrfWA7XG4gICAgY29uc3QgeyB0eXBlLCBwcm9wcywgY2hpbGRyZW46IHJhd0NoaWxkcmVuLCAuLi5yZXN0IH0gPSBub2RlIGFzIE5lc3RlZE5vZGU7XG5cbiAgICAvLyBSZWN1cnNpdmVseSBmbGF0dGVuIGNoaWxkcmVuXG4gICAgY29uc3QgY2hpbGRLZXlzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHJhd0NoaWxkcmVuKSkge1xuICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiByYXdDaGlsZHJlbikge1xuICAgICAgICBpZiAoY2hpbGQgJiYgdHlwZW9mIGNoaWxkID09PSBcIm9iamVjdFwiICYmIFwidHlwZVwiIGluIGNoaWxkKSB7XG4gICAgICAgICAgY2hpbGRLZXlzLnB1c2god2FsayhjaGlsZCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgdGhlIGZsYXQgZWxlbWVudCwgcHJlc2VydmluZyBleHRyYSBmaWVsZHMgKHZpc2libGUsIG9uLCByZXBlYXQsIGV0Yy4pXG4gICAgLy8gYnV0IGV4Y2x1ZGluZyBgc3RhdGVgIHdoaWNoIGlzIGhvaXN0ZWQgdG8gc3BlYy1sZXZlbC5cbiAgICBjb25zdCBlbGVtZW50OiBVSUVsZW1lbnQgPSB7XG4gICAgICB0eXBlOiB0eXBlID8/IFwidW5rbm93blwiLFxuICAgICAgcHJvcHM6IChwcm9wcyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPz8ge30sXG4gICAgICBjaGlsZHJlbjogY2hpbGRLZXlzLFxuICAgIH07XG5cbiAgICAvLyBDb3B5IGV4dHJhIGZpZWxkcyAodmlzaWJsZSwgb24sIHJlcGVhdCkgYnV0IG5vdCBzdGF0ZVxuICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKHJlc3QpKSB7XG4gICAgICBpZiAoayAhPT0gXCJzdGF0ZVwiICYmIHYgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAoZWxlbWVudCBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVtrXSA9IHY7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZWxlbWVudHNba2V5XSA9IGVsZW1lbnQ7XG4gICAgcmV0dXJuIGtleTtcbiAgfVxuXG4gIGNvbnN0IHJvb3QgPSB3YWxrKG5lc3RlZCk7XG5cbiAgY29uc3Qgc3BlYzogU3BlYyA9IHsgcm9vdCwgZWxlbWVudHMgfTtcblxuICAvLyBIb2lzdCBzdGF0ZSBmcm9tIHJvb3Qgbm9kZSBpZiBwcmVzZW50XG4gIGlmIChcbiAgICBuZXN0ZWQuc3RhdGUgJiZcbiAgICB0eXBlb2YgbmVzdGVkLnN0YXRlID09PSBcIm9iamVjdFwiICYmXG4gICAgIUFycmF5LmlzQXJyYXkobmVzdGVkLnN0YXRlKVxuICApIHtcbiAgICBzcGVjLnN0YXRlID0gbmVzdGVkLnN0YXRlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICB9XG5cbiAgcmV0dXJuIHNwZWM7XG59XG5cbi8qKlxuICogQ29tcGlsZSBhIFNwZWNTdHJlYW0gc3RyaW5nIGludG8gYSBKU09OIG9iamVjdC5cbiAqIEVhY2ggbGluZSBzaG91bGQgYmUgYSBwYXRjaCBvcGVyYXRpb24uXG4gKlxuICogQGV4YW1wbGVcbiAqIGNvbnN0IHN0cmVhbSA9IGB7XCJvcFwiOlwiYWRkXCIsXCJwYXRoXCI6XCIvbmFtZVwiLFwidmFsdWVcIjpcIkFsaWNlXCJ9XG4gKiB7XCJvcFwiOlwiYWRkXCIsXCJwYXRoXCI6XCIvYWdlXCIsXCJ2YWx1ZVwiOjMwfWA7XG4gKiBjb25zdCByZXN1bHQgPSBjb21waWxlU3BlY1N0cmVhbShzdHJlYW0pO1xuICogLy8geyBuYW1lOiBcIkFsaWNlXCIsIGFnZTogMzAgfVxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGlsZVNwZWNTdHJlYW08XG4gIFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuPihzdHJlYW06IHN0cmluZywgaW5pdGlhbDogVCA9IHt9IGFzIFQpOiBUIHtcbiAgY29uc3QgbGluZXMgPSBzdHJlYW0uc3BsaXQoXCJcXG5cIik7XG4gIGNvbnN0IHJlc3VsdCA9IHsgLi4uaW5pdGlhbCB9O1xuXG4gIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgIGNvbnN0IHBhdGNoID0gcGFyc2VTcGVjU3RyZWFtTGluZShsaW5lKTtcbiAgICBpZiAocGF0Y2gpIHtcbiAgICAgIGFwcGx5U3BlY1N0cmVhbVBhdGNoKHJlc3VsdCwgcGF0Y2gpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXN1bHQgYXMgVDtcbn1cblxuLyoqXG4gKiBTdHJlYW1pbmcgU3BlY1N0cmVhbSBjb21waWxlci5cbiAqIFVzZWZ1bCBmb3IgcHJvY2Vzc2luZyBTcGVjU3RyZWFtIGRhdGEgYXMgaXQgc3RyZWFtcyBpbiBmcm9tIEFJLlxuICpcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBjb21waWxlciA9IGNyZWF0ZVNwZWNTdHJlYW1Db21waWxlcjxNeVNwZWM+KCk7XG4gKlxuICogLy8gQXMgY2h1bmtzIGFycml2ZTpcbiAqIGNvbnN0IHsgcmVzdWx0LCBuZXdQYXRjaGVzIH0gPSBjb21waWxlci5wdXNoKGNodW5rKTtcbiAqIGlmIChuZXdQYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAqICAgdXBkYXRlVUkocmVzdWx0KTtcbiAqIH1cbiAqXG4gKiAvLyBXaGVuIGRvbmU6XG4gKiBjb25zdCBmaW5hbFJlc3VsdCA9IGNvbXBpbGVyLmdldFJlc3VsdCgpO1xuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwZWNTdHJlYW1Db21waWxlcjxUPiB7XG4gIC8qKiBQdXNoIGEgY2h1bmsgb2YgdGV4dC4gUmV0dXJucyB0aGUgY3VycmVudCByZXN1bHQgYW5kIGFueSBuZXcgcGF0Y2hlcyBhcHBsaWVkLiAqL1xuICBwdXNoKGNodW5rOiBzdHJpbmcpOiB7IHJlc3VsdDogVDsgbmV3UGF0Y2hlczogU3BlY1N0cmVhbUxpbmVbXSB9O1xuICAvKiogR2V0IHRoZSBjdXJyZW50IGNvbXBpbGVkIHJlc3VsdCAqL1xuICBnZXRSZXN1bHQoKTogVDtcbiAgLyoqIEdldCBhbGwgcGF0Y2hlcyB0aGF0IGhhdmUgYmVlbiBhcHBsaWVkICovXG4gIGdldFBhdGNoZXMoKTogU3BlY1N0cmVhbUxpbmVbXTtcbiAgLyoqIFJlc2V0IHRoZSBjb21waWxlciB0byBpbml0aWFsIHN0YXRlICovXG4gIHJlc2V0KGluaXRpYWw/OiBQYXJ0aWFsPFQ+KTogdm9pZDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBzdHJlYW1pbmcgU3BlY1N0cmVhbSBjb21waWxlci5cbiAqXG4gKiBTcGVjU3RyZWFtIGlzIGpzb24tcmVuZGVyJ3Mgc3RyZWFtaW5nIGZvcm1hdC4gQUkgb3V0cHV0cyBwYXRjaCBvcGVyYXRpb25zXG4gKiBsaW5lIGJ5IGxpbmUsIGFuZCB0aGlzIGNvbXBpbGVyIHByb2dyZXNzaXZlbHkgYnVpbGRzIHRoZSBmaW5hbCBzcGVjLlxuICpcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBjb21waWxlciA9IGNyZWF0ZVNwZWNTdHJlYW1Db21waWxlcjxUaW1lbGluZVNwZWM+KCk7XG4gKlxuICogLy8gUHJvY2VzcyBzdHJlYW1pbmcgcmVzcG9uc2VcbiAqIGNvbnN0IHJlYWRlciA9IHJlc3BvbnNlLmJvZHkuZ2V0UmVhZGVyKCk7XG4gKiB3aGlsZSAodHJ1ZSkge1xuICogICBjb25zdCB7IGRvbmUsIHZhbHVlIH0gPSBhd2FpdCByZWFkZXIucmVhZCgpO1xuICogICBpZiAoZG9uZSkgYnJlYWs7XG4gKlxuICogICBjb25zdCB7IHJlc3VsdCwgbmV3UGF0Y2hlcyB9ID0gY29tcGlsZXIucHVzaChkZWNvZGVyLmRlY29kZSh2YWx1ZSkpO1xuICogICBpZiAobmV3UGF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gKiAgICAgc2V0U3BlYyhyZXN1bHQpOyAvLyBVcGRhdGUgVUkgd2l0aCBwYXJ0aWFsIHJlc3VsdFxuICogICB9XG4gKiB9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTcGVjU3RyZWFtQ29tcGlsZXI8VCA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+PihcbiAgaW5pdGlhbDogUGFydGlhbDxUPiA9IHt9LFxuKTogU3BlY1N0cmVhbUNvbXBpbGVyPFQ+IHtcbiAgbGV0IHJlc3VsdCA9IHsgLi4uaW5pdGlhbCB9IGFzIFQ7XG4gIGxldCBidWZmZXIgPSBcIlwiO1xuICBjb25zdCBhcHBsaWVkUGF0Y2hlczogU3BlY1N0cmVhbUxpbmVbXSA9IFtdO1xuICBjb25zdCBwcm9jZXNzZWRMaW5lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIHJldHVybiB7XG4gICAgcHVzaChjaHVuazogc3RyaW5nKTogeyByZXN1bHQ6IFQ7IG5ld1BhdGNoZXM6IFNwZWNTdHJlYW1MaW5lW10gfSB7XG4gICAgICBidWZmZXIgKz0gY2h1bms7XG4gICAgICBjb25zdCBuZXdQYXRjaGVzOiBTcGVjU3RyZWFtTGluZVtdID0gW107XG5cbiAgICAgIC8vIFByb2Nlc3MgY29tcGxldGUgbGluZXNcbiAgICAgIGNvbnN0IGxpbmVzID0gYnVmZmVyLnNwbGl0KFwiXFxuXCIpO1xuICAgICAgYnVmZmVyID0gbGluZXMucG9wKCkgfHwgXCJcIjsgLy8gS2VlcCBpbmNvbXBsZXRlIGxpbmUgaW4gYnVmZmVyXG5cbiAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgICAgIGlmICghdHJpbW1lZCB8fCBwcm9jZXNzZWRMaW5lcy5oYXModHJpbW1lZCkpIGNvbnRpbnVlO1xuICAgICAgICBwcm9jZXNzZWRMaW5lcy5hZGQodHJpbW1lZCk7XG5cbiAgICAgICAgY29uc3QgcGF0Y2ggPSBwYXJzZVNwZWNTdHJlYW1MaW5lKHRyaW1tZWQpO1xuICAgICAgICBpZiAocGF0Y2gpIHtcbiAgICAgICAgICBhcHBseVNwZWNTdHJlYW1QYXRjaChyZXN1bHQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHBhdGNoKTtcbiAgICAgICAgICBhcHBsaWVkUGF0Y2hlcy5wdXNoKHBhdGNoKTtcbiAgICAgICAgICBuZXdQYXRjaGVzLnB1c2gocGF0Y2gpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFJldHVybiBhIHNoYWxsb3cgY29weSB0byB0cmlnZ2VyIHJlLXJlbmRlcnNcbiAgICAgIGlmIChuZXdQYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmVzdWx0ID0geyAuLi5yZXN1bHQgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHsgcmVzdWx0LCBuZXdQYXRjaGVzIH07XG4gICAgfSxcblxuICAgIGdldFJlc3VsdCgpOiBUIHtcbiAgICAgIC8vIFByb2Nlc3MgYW55IHJlbWFpbmluZyBidWZmZXJcbiAgICAgIGlmIChidWZmZXIudHJpbSgpKSB7XG4gICAgICAgIGNvbnN0IHBhdGNoID0gcGFyc2VTcGVjU3RyZWFtTGluZShidWZmZXIpO1xuICAgICAgICBpZiAocGF0Y2ggJiYgIXByb2Nlc3NlZExpbmVzLmhhcyhidWZmZXIudHJpbSgpKSkge1xuICAgICAgICAgIHByb2Nlc3NlZExpbmVzLmFkZChidWZmZXIudHJpbSgpKTtcbiAgICAgICAgICBhcHBseVNwZWNTdHJlYW1QYXRjaChyZXN1bHQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHBhdGNoKTtcbiAgICAgICAgICBhcHBsaWVkUGF0Y2hlcy5wdXNoKHBhdGNoKTtcbiAgICAgICAgICByZXN1bHQgPSB7IC4uLnJlc3VsdCB9O1xuICAgICAgICB9XG4gICAgICAgIGJ1ZmZlciA9IFwiXCI7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0sXG5cbiAgICBnZXRQYXRjaGVzKCk6IFNwZWNTdHJlYW1MaW5lW10ge1xuICAgICAgcmV0dXJuIFsuLi5hcHBsaWVkUGF0Y2hlc107XG4gICAgfSxcblxuICAgIHJlc2V0KG5ld0luaXRpYWw6IFBhcnRpYWw8VD4gPSB7fSk6IHZvaWQge1xuICAgICAgcmVzdWx0ID0geyAuLi5uZXdJbml0aWFsIH0gYXMgVDtcbiAgICAgIGJ1ZmZlciA9IFwiXCI7XG4gICAgICBhcHBsaWVkUGF0Y2hlcy5sZW5ndGggPSAwO1xuICAgICAgcHJvY2Vzc2VkTGluZXMuY2xlYXIoKTtcbiAgICB9LFxuICB9O1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTWl4ZWQgU3RyZWFtIFBhcnNlciDigJQgZm9yIGNoYXQgKyBHZW5VSSAodGV4dCBpbnRlcmxlYXZlZCB3aXRoIEpTT05MIHBhdGNoZXMpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIENhbGxiYWNrcyBmb3IgdGhlIG1peGVkIHN0cmVhbSBwYXJzZXIuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWl4ZWRTdHJlYW1DYWxsYmFja3Mge1xuICAvKiogQ2FsbGVkIHdoZW4gYSBKU09OTCBwYXRjaCBsaW5lIGlzIHBhcnNlZCAqL1xuICBvblBhdGNoOiAocGF0Y2g6IFNwZWNTdHJlYW1MaW5lKSA9PiB2b2lkO1xuICAvKiogQ2FsbGVkIHdoZW4gYSB0ZXh0IChub24tSlNPTkwpIGxpbmUgaXMgcmVjZWl2ZWQgKi9cbiAgb25UZXh0OiAodGV4dDogc3RyaW5nKSA9PiB2b2lkO1xufVxuXG4vKipcbiAqIEEgc3RhdGVmdWwgcGFyc2VyIGZvciBtaXhlZCBzdHJlYW1zIHRoYXQgY29udGFpbiBib3RoIHRleHQgYW5kIEpTT05MIHBhdGNoZXMuXG4gKiBVc2VkIGluIGNoYXQgKyBHZW5VSSBzY2VuYXJpb3Mgd2hlcmUgYW4gTExNIHJlc3BvbmRzIHdpdGggY29udmVyc2F0aW9uYWwgdGV4dFxuICogaW50ZXJsZWF2ZWQgd2l0aCBqc29uLXJlbmRlciBKU09OTCBwYXRjaCBvcGVyYXRpb25zLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIE1peGVkU3RyZWFtUGFyc2VyIHtcbiAgLyoqIFB1c2ggYSBjaHVuayBvZiBzdHJlYW1lZCBkYXRhLiBDYWxscyBvblBhdGNoL29uVGV4dCBmb3IgZWFjaCBjb21wbGV0ZSBsaW5lLiAqL1xuICBwdXNoKGNodW5rOiBzdHJpbmcpOiB2b2lkO1xuICAvKiogRmx1c2ggYW55IHJlbWFpbmluZyBidWZmZXJlZCBjb250ZW50LiBDYWxsIHdoZW4gdGhlIHN0cmVhbSBlbmRzLiAqL1xuICBmbHVzaCgpOiB2b2lkO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHBhcnNlciBmb3IgbWl4ZWQgdGV4dCArIEpTT05MIHN0cmVhbXMuXG4gKlxuICogSW4gY2hhdCArIEdlblVJIHNjZW5hcmlvcywgYW4gTExNIHN0cmVhbXMgYSByZXNwb25zZSB0aGF0IGNvbnRhaW5zIGJvdGhcbiAqIGNvbnZlcnNhdGlvbmFsIHRleHQgYW5kIGpzb24tcmVuZGVyIEpTT05MIHBhdGNoIGxpbmVzLiBUaGlzIHBhcnNlciBidWZmZXJzXG4gKiBpbmNvbWluZyBjaHVua3MsIHNwbGl0cyB0aGVtIGludG8gbGluZXMsIGFuZCBjbGFzc2lmaWVzIGVhY2ggbGluZSBhcyBlaXRoZXJcbiAqIGEgSlNPTkwgcGF0Y2ggKHZpYSBgcGFyc2VTcGVjU3RyZWFtTGluZWApIG9yIHBsYWluIHRleHQuXG4gKlxuICogQGV4YW1wbGVcbiAqIGNvbnN0IHBhcnNlciA9IGNyZWF0ZU1peGVkU3RyZWFtUGFyc2VyKHtcbiAqICAgb25UZXh0OiAodGV4dCkgPT4gYXBwZW5kVG9NZXNzYWdlKHRleHQpLFxuICogICBvblBhdGNoOiAocGF0Y2gpID0+IGFwcGx5U3BlY1BhdGNoKHNwZWMsIHBhdGNoKSxcbiAqIH0pO1xuICpcbiAqIC8vIEFzIGNodW5rcyBhcnJpdmUgZnJvbSB0aGUgc3RyZWFtOlxuICogZm9yIGF3YWl0IChjb25zdCBjaHVuayBvZiBzdHJlYW0pIHtcbiAqICAgcGFyc2VyLnB1c2goY2h1bmspO1xuICogfVxuICogcGFyc2VyLmZsdXNoKCk7XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVNaXhlZFN0cmVhbVBhcnNlcihcbiAgY2FsbGJhY2tzOiBNaXhlZFN0cmVhbUNhbGxiYWNrcyxcbik6IE1peGVkU3RyZWFtUGFyc2VyIHtcbiAgbGV0IGJ1ZmZlciA9IFwiXCI7XG4gIGxldCBpblNwZWNGZW5jZSA9IGZhbHNlO1xuXG4gIGZ1bmN0aW9uIHByb2Nlc3NMaW5lKGxpbmU6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcblxuICAgIC8vIEZlbmNlIGRldGVjdGlvblxuICAgIGlmICghaW5TcGVjRmVuY2UgJiYgdHJpbW1lZC5zdGFydHNXaXRoKFwiYGBgc3BlY1wiKSkge1xuICAgICAgaW5TcGVjRmVuY2UgPSB0cnVlO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoaW5TcGVjRmVuY2UgJiYgdHJpbW1lZCA9PT0gXCJgYGBcIikge1xuICAgICAgaW5TcGVjRmVuY2UgPSBmYWxzZTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXRyaW1tZWQpIHJldHVybjtcblxuICAgIGlmIChpblNwZWNGZW5jZSkge1xuICAgICAgY29uc3QgcGF0Y2ggPSBwYXJzZVNwZWNTdHJlYW1MaW5lKHRyaW1tZWQpO1xuICAgICAgaWYgKHBhdGNoKSB7XG4gICAgICAgIGNhbGxiYWNrcy5vblBhdGNoKHBhdGNoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBPdXRzaWRlIGZlbmNlOiBoZXVyaXN0aWMgbW9kZVxuICAgIGNvbnN0IHBhdGNoID0gcGFyc2VTcGVjU3RyZWFtTGluZSh0cmltbWVkKTtcbiAgICBpZiAocGF0Y2gpIHtcbiAgICAgIGNhbGxiYWNrcy5vblBhdGNoKHBhdGNoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY2FsbGJhY2tzLm9uVGV4dChsaW5lKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHB1c2goY2h1bms6IHN0cmluZyk6IHZvaWQge1xuICAgICAgYnVmZmVyICs9IGNodW5rO1xuXG4gICAgICAvLyBQcm9jZXNzIGNvbXBsZXRlIGxpbmVzXG4gICAgICBjb25zdCBsaW5lcyA9IGJ1ZmZlci5zcGxpdChcIlxcblwiKTtcbiAgICAgIGJ1ZmZlciA9IGxpbmVzLnBvcCgpIHx8IFwiXCI7IC8vIEtlZXAgaW5jb21wbGV0ZSBsaW5lIGluIGJ1ZmZlclxuXG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgcHJvY2Vzc0xpbmUobGluZSk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGZsdXNoKCk6IHZvaWQge1xuICAgICAgaWYgKGJ1ZmZlci50cmltKCkpIHtcbiAgICAgICAgcHJvY2Vzc0xpbmUoYnVmZmVyKTtcbiAgICAgIH1cbiAgICAgIGJ1ZmZlciA9IFwiXCI7XG4gICAgfSxcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEFJIFNESyBTdHJlYW0gVHJhbnNmb3JtXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIE1pbmltYWwgY2h1bmsgc2hhcGUgY29tcGF0aWJsZSB3aXRoIHRoZSBBSSBTREsncyBgVUlNZXNzYWdlQ2h1bmtgLlxuICpcbiAqIERlZmluZWQgaGVyZSBzbyB0aGF0IGBAanNvbi1yZW5kZXIvY29yZWAgaGFzIG5vIGRlcGVuZGVuY3kgb24gdGhlIGBhaWBcbiAqIHBhY2thZ2UuIFRoZSBkaXNjcmltaW5hdGVkIHVuaW9uIGNvdmVycyB0aGUgdGhyZWUgdGV4dC1yZWxhdGVkIGNodW5rIHR5cGVzXG4gKiB0aGUgdHJhbnNmb3JtIGluc3BlY3RzOyBhbGwgb3RoZXIgY2h1bmsgdHlwZXMgcGFzcyB0aHJvdWdoIHZpYSB0aGUgZmFsbGJhY2suXG4gKi9cbmV4cG9ydCB0eXBlIFN0cmVhbUNodW5rID1cbiAgfCB7IHR5cGU6IFwidGV4dC1zdGFydFwiOyBpZDogc3RyaW5nOyBbazogc3RyaW5nXTogdW5rbm93biB9XG4gIHwgeyB0eXBlOiBcInRleHQtZGVsdGFcIjsgaWQ6IHN0cmluZzsgZGVsdGE6IHN0cmluZzsgW2s6IHN0cmluZ106IHVua25vd24gfVxuICB8IHsgdHlwZTogXCJ0ZXh0LWVuZFwiOyBpZDogc3RyaW5nOyBbazogc3RyaW5nXTogdW5rbm93biB9XG4gIHwgeyB0eXBlOiBzdHJpbmc7IFtrOiBzdHJpbmddOiB1bmtub3duIH07XG5cbi8qKiBUaGUgb3BlbmluZyBmZW5jZSBmb3IgYSBzcGVjIGJsb2NrIChlLmcuIGAgYGBgc3BlYyBgKS4gKi9cbmNvbnN0IFNQRUNfRkVOQ0VfT1BFTiA9IFwiYGBgc3BlY1wiO1xuLyoqIFRoZSBjbG9zaW5nIGZlbmNlIGZvciBhIHNwZWMgYmxvY2suICovXG5jb25zdCBTUEVDX0ZFTkNFX0NMT1NFID0gXCJgYGBcIjtcblxuLyoqXG4gKiBDcmVhdGVzIGEgYFRyYW5zZm9ybVN0cmVhbWAgdGhhdCBpbnRlcmNlcHRzIEFJIFNESyBVSSBtZXNzYWdlIHN0cmVhbSBjaHVua3NcbiAqIGFuZCBjbGFzc2lmaWVzIHRleHQgY29udGVudCBhcyBlaXRoZXIgcHJvc2Ugb3IganNvbi1yZW5kZXIgSlNPTkwgcGF0Y2hlcy5cbiAqXG4gKiBUd28gY2xhc3NpZmljYXRpb24gbW9kZXM6XG4gKlxuICogMS4gKipGZW5jZSBtb2RlKiogKHByZWZlcnJlZCk6IExpbmVzIGJldHdlZW4gYCBgYGBzcGVjIGAgYW5kIGAgYGBgIGAgYXJlXG4gKiAgICBwYXJzZWQgYXMgSlNPTkwgcGF0Y2hlcy4gRmVuY2UgZGVsaW1pdGVycyBhcmUgc3dhbGxvd2VkIChub3QgZW1pdHRlZCkuXG4gKiAyLiAqKkhldXJpc3RpYyBtb2RlKiogKGJhY2t3YXJkIGNvbXBhdCk6IE91dHNpZGUgb2YgZmVuY2VzLCBsaW5lcyBzdGFydGluZ1xuICogICAgd2l0aCBge2AgYXJlIGJ1ZmZlcmVkIGFuZCB0ZXN0ZWQgd2l0aCBgcGFyc2VTcGVjU3RyZWFtTGluZWAuIFZhbGlkIHBhdGNoZXNcbiAqICAgIGFyZSBlbWl0dGVkIGFzIHtAbGluayBTUEVDX0RBVEFfUEFSVF9UWVBFfSBwYXJ0czsgZXZlcnl0aGluZyBlbHNlIGlzXG4gKiAgICBmbHVzaGVkIGFzIHRleHQuXG4gKlxuICogTm9uLXRleHQgY2h1bmtzICh0b29sIGV2ZW50cywgc3RlcCBtYXJrZXJzLCBldGMuKSBhcmUgcGFzc2VkIHRocm91Z2ggdW5jaGFuZ2VkLlxuICpcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgY3JlYXRlSnNvblJlbmRlclRyYW5zZm9ybSB9IGZyb20gXCJAanNvbi1yZW5kZXIvY29yZVwiO1xuICogaW1wb3J0IHsgY3JlYXRlVUlNZXNzYWdlU3RyZWFtLCBjcmVhdGVVSU1lc3NhZ2VTdHJlYW1SZXNwb25zZSB9IGZyb20gXCJhaVwiO1xuICpcbiAqIGNvbnN0IHN0cmVhbSA9IGNyZWF0ZVVJTWVzc2FnZVN0cmVhbSh7XG4gKiAgIGV4ZWN1dGU6IGFzeW5jICh7IHdyaXRlciB9KSA9PiB7XG4gKiAgICAgd3JpdGVyLm1lcmdlKFxuICogICAgICAgcmVzdWx0LnRvVUlNZXNzYWdlU3RyZWFtKCkucGlwZVRocm91Z2goY3JlYXRlSnNvblJlbmRlclRyYW5zZm9ybSgpKSxcbiAqICAgICApO1xuICogICB9LFxuICogfSk7XG4gKiByZXR1cm4gY3JlYXRlVUlNZXNzYWdlU3RyZWFtUmVzcG9uc2UoeyBzdHJlYW0gfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUpzb25SZW5kZXJUcmFuc2Zvcm0oKTogVHJhbnNmb3JtU3RyZWFtPFxuICBTdHJlYW1DaHVuayxcbiAgU3RyZWFtQ2h1bmtcbj4ge1xuICBsZXQgbGluZUJ1ZmZlciA9IFwiXCI7XG4gIGxldCBjdXJyZW50VGV4dElkID0gXCJcIjtcbiAgLy8gV2hldGhlciB0aGUgY3VycmVudCBpbmNvbXBsZXRlIGxpbmUgbWlnaHQgYmUgSlNPTkwgKHN0YXJ0cyB3aXRoICd7JylcbiAgbGV0IGJ1ZmZlcmluZyA9IGZhbHNlO1xuICAvLyBXaGV0aGVyIHdlIGFyZSBpbnNpZGUgYSBgYGBzcGVjIGZlbmNlXG4gIGxldCBpblNwZWNGZW5jZSA9IGZhbHNlO1xuICAvLyBXaGV0aGVyIHdlIGFyZSBjdXJyZW50bHkgaW5zaWRlIGEgdGV4dCBibG9jayAoYmV0d2VlbiB0ZXh0LXN0YXJ0L3RleHQtZW5kKS5cbiAgLy8gVXNlZCB0byBzcGxpdCB0ZXh0IGJsb2NrcyBhcm91bmQgc3BlYyBkYXRhIHNvIHRoZSBBSSBTREsgY3JlYXRlcyBzZXBhcmF0ZVxuICAvLyB0ZXh0IHBhcnRzLCBwcmVzZXJ2aW5nIGludGVybGVhdmluZyBvZiBwcm9zZSBhbmQgVUkgaW4gbWVzc2FnZS5wYXJ0cy5cbiAgbGV0IGluVGV4dEJsb2NrID0gZmFsc2U7XG4gIGxldCB0ZXh0SWRDb3VudGVyID0gMDtcblxuICAvKiogQ2xvc2UgdGhlIGN1cnJlbnQgdGV4dCBibG9jayBpZiBvbmUgaXMgb3Blbi4gKi9cbiAgZnVuY3Rpb24gY2xvc2VUZXh0QmxvY2soXG4gICAgY29udHJvbGxlcjogVHJhbnNmb3JtU3RyZWFtRGVmYXVsdENvbnRyb2xsZXI8U3RyZWFtQ2h1bms+LFxuICApIHtcbiAgICBpZiAoaW5UZXh0QmxvY2spIHtcbiAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZSh7IHR5cGU6IFwidGV4dC1lbmRcIiwgaWQ6IGN1cnJlbnRUZXh0SWQgfSk7XG4gICAgICBpblRleHRCbG9jayA9IGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBFbnN1cmUgYSB0ZXh0IGJsb2NrIGlzIG9wZW4sIHN0YXJ0aW5nIGEgbmV3IG9uZSBpZiBuZWVkZWQuICovXG4gIGZ1bmN0aW9uIGVuc3VyZVRleHRCbG9jayhcbiAgICBjb250cm9sbGVyOiBUcmFuc2Zvcm1TdHJlYW1EZWZhdWx0Q29udHJvbGxlcjxTdHJlYW1DaHVuaz4sXG4gICkge1xuICAgIGlmICghaW5UZXh0QmxvY2spIHtcbiAgICAgIHRleHRJZENvdW50ZXIrKztcbiAgICAgIGN1cnJlbnRUZXh0SWQgPSBTdHJpbmcodGV4dElkQ291bnRlcik7XG4gICAgICBjb250cm9sbGVyLmVucXVldWUoeyB0eXBlOiBcInRleHQtc3RhcnRcIiwgaWQ6IGN1cnJlbnRUZXh0SWQgfSk7XG4gICAgICBpblRleHRCbG9jayA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgLyoqIEVtaXQgYSB0ZXh0LWRlbHRhLCBvcGVuaW5nIGEgdGV4dCBibG9jayBmaXJzdCBpZiBuZWNlc3NhcnkuICovXG4gIGZ1bmN0aW9uIGVtaXRUZXh0RGVsdGEoXG4gICAgZGVsdGE6IHN0cmluZyxcbiAgICBjb250cm9sbGVyOiBUcmFuc2Zvcm1TdHJlYW1EZWZhdWx0Q29udHJvbGxlcjxTdHJlYW1DaHVuaz4sXG4gICkge1xuICAgIGVuc3VyZVRleHRCbG9jayhjb250cm9sbGVyKTtcbiAgICBjb250cm9sbGVyLmVucXVldWUoeyB0eXBlOiBcInRleHQtZGVsdGFcIiwgaWQ6IGN1cnJlbnRUZXh0SWQsIGRlbHRhIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gZW1pdFBhdGNoKFxuICAgIHBhdGNoOiBTcGVjU3RyZWFtTGluZSxcbiAgICBjb250cm9sbGVyOiBUcmFuc2Zvcm1TdHJlYW1EZWZhdWx0Q29udHJvbGxlcjxTdHJlYW1DaHVuaz4sXG4gICkge1xuICAgIGNsb3NlVGV4dEJsb2NrKGNvbnRyb2xsZXIpO1xuICAgIGNvbnRyb2xsZXIuZW5xdWV1ZSh7XG4gICAgICB0eXBlOiBTUEVDX0RBVEFfUEFSVF9UWVBFLFxuICAgICAgZGF0YTogeyB0eXBlOiBcInBhdGNoXCIsIHBhdGNoIH0sXG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBmbHVzaEJ1ZmZlcihcbiAgICBjb250cm9sbGVyOiBUcmFuc2Zvcm1TdHJlYW1EZWZhdWx0Q29udHJvbGxlcjxTdHJlYW1DaHVuaz4sXG4gICkge1xuICAgIGlmICghbGluZUJ1ZmZlcikgcmV0dXJuO1xuXG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVCdWZmZXIudHJpbSgpO1xuXG4gICAgLy8gSW5zaWRlIGEgZmVuY2UsIGV2ZXJ5dGhpbmcgaXMgc3BlYyBkYXRhXG4gICAgaWYgKGluU3BlY0ZlbmNlKSB7XG4gICAgICBpZiAodHJpbW1lZCkge1xuICAgICAgICBjb25zdCBwYXRjaCA9IHBhcnNlU3BlY1N0cmVhbUxpbmUodHJpbW1lZCk7XG4gICAgICAgIGlmIChwYXRjaCkgZW1pdFBhdGNoKHBhdGNoLCBjb250cm9sbGVyKTtcbiAgICAgICAgLy8gTm9uLXBhdGNoIGxpbmVzIGluc2lkZSB0aGUgZmVuY2UgYXJlIHNpbGVudGx5IGRyb3BwZWRcbiAgICAgIH1cbiAgICAgIGxpbmVCdWZmZXIgPSBcIlwiO1xuICAgICAgYnVmZmVyaW5nID0gZmFsc2U7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRyaW1tZWQpIHtcbiAgICAgIGNvbnN0IHBhdGNoID0gcGFyc2VTcGVjU3RyZWFtTGluZSh0cmltbWVkKTtcbiAgICAgIGlmIChwYXRjaCkge1xuICAgICAgICBlbWl0UGF0Y2gocGF0Y2gsIGNvbnRyb2xsZXIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gV2FzIGJ1ZmZlcmVkIGJ1dCBpc24ndCBKU09OTCDigJQgZmx1c2ggYXMgdGV4dFxuICAgICAgICBlbWl0VGV4dERlbHRhKGxpbmVCdWZmZXIsIGNvbnRyb2xsZXIpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBXaGl0ZXNwYWNlLW9ubHkgYnVmZmVyIOKAlCBmb3J3YXJkIGFzLWlzIChwcmVzZXJ2ZXMgYmxhbmsgbGluZXMpXG4gICAgICBlbWl0VGV4dERlbHRhKGxpbmVCdWZmZXIsIGNvbnRyb2xsZXIpO1xuICAgIH1cbiAgICBsaW5lQnVmZmVyID0gXCJcIjtcbiAgICBidWZmZXJpbmcgPSBmYWxzZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb2Nlc3NDb21wbGV0ZUxpbmUoXG4gICAgbGluZTogc3RyaW5nLFxuICAgIGNvbnRyb2xsZXI6IFRyYW5zZm9ybVN0cmVhbURlZmF1bHRDb250cm9sbGVyPFN0cmVhbUNodW5rPixcbiAgKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuXG4gICAgLy8gLS0tIEZlbmNlIGRldGVjdGlvbiAtLS1cbiAgICBpZiAoIWluU3BlY0ZlbmNlICYmIHRyaW1tZWQuc3RhcnRzV2l0aChTUEVDX0ZFTkNFX09QRU4pKSB7XG4gICAgICBpblNwZWNGZW5jZSA9IHRydWU7XG4gICAgICByZXR1cm47IC8vIFN3YWxsb3cgdGhlIG9wZW5pbmcgZmVuY2VcbiAgICB9XG4gICAgaWYgKGluU3BlY0ZlbmNlICYmIHRyaW1tZWQgPT09IFNQRUNfRkVOQ0VfQ0xPU0UpIHtcbiAgICAgIGluU3BlY0ZlbmNlID0gZmFsc2U7XG4gICAgICByZXR1cm47IC8vIFN3YWxsb3cgdGhlIGNsb3NpbmcgZmVuY2VcbiAgICB9XG5cbiAgICAvLyBJbnNpZGUgYSBmZW5jZTogcGFyc2UgYXMgc3BlYyBkYXRhXG4gICAgaWYgKGluU3BlY0ZlbmNlKSB7XG4gICAgICBpZiAodHJpbW1lZCkge1xuICAgICAgICBjb25zdCBwYXRjaCA9IHBhcnNlU3BlY1N0cmVhbUxpbmUodHJpbW1lZCk7XG4gICAgICAgIGlmIChwYXRjaCkgZW1pdFBhdGNoKHBhdGNoLCBjb250cm9sbGVyKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyAtLS0gT3V0c2lkZSBmZW5jZTogaGV1cmlzdGljIG1vZGUgLS0tXG4gICAgaWYgKCF0cmltbWVkKSB7XG4gICAgICAvLyBFbXB0eSBsaW5lIOKAlCBmb3J3YXJkIGZvciBtYXJrZG93biBwYXJhZ3JhcGggYnJlYWtzXG4gICAgICBlbWl0VGV4dERlbHRhKFwiXFxuXCIsIGNvbnRyb2xsZXIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBhdGNoID0gcGFyc2VTcGVjU3RyZWFtTGluZSh0cmltbWVkKTtcbiAgICBpZiAocGF0Y2gpIHtcbiAgICAgIGVtaXRQYXRjaChwYXRjaCwgY29udHJvbGxlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIGVtaXRUZXh0RGVsdGEobGluZSArIFwiXFxuXCIsIGNvbnRyb2xsZXIpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuZXcgVHJhbnNmb3JtU3RyZWFtPFN0cmVhbUNodW5rLCBTdHJlYW1DaHVuaz4oe1xuICAgIHRyYW5zZm9ybShjaHVuaywgY29udHJvbGxlcikge1xuICAgICAgc3dpdGNoIChjaHVuay50eXBlKSB7XG4gICAgICAgIGNhc2UgXCJ0ZXh0LXN0YXJ0XCI6IHtcbiAgICAgICAgICBjb25zdCBpZCA9IChjaHVuayBhcyB7IGlkOiBzdHJpbmcgfSkuaWQ7XG4gICAgICAgICAgY29uc3QgaWROdW0gPSBwYXJzZUludChpZCwgMTApO1xuICAgICAgICAgIGlmICghaXNOYU4oaWROdW0pICYmIGlkTnVtID49IHRleHRJZENvdW50ZXIpIHtcbiAgICAgICAgICAgIHRleHRJZENvdW50ZXIgPSBpZE51bTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY3VycmVudFRleHRJZCA9IGlkO1xuICAgICAgICAgIGluVGV4dEJsb2NrID0gdHJ1ZTtcbiAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoY2h1bmspO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgY2FzZSBcInRleHQtZGVsdGFcIjoge1xuICAgICAgICAgIGNvbnN0IGRlbHRhID0gY2h1bmsgYXMgeyBpZDogc3RyaW5nOyBkZWx0YTogc3RyaW5nIH07XG4gICAgICAgICAgY29uc3QgdGV4dCA9IGRlbHRhLmRlbHRhO1xuXG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0ZXh0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBjaCA9IHRleHQuY2hhckF0KGkpO1xuXG4gICAgICAgICAgICBpZiAoY2ggPT09IFwiXFxuXCIpIHtcbiAgICAgICAgICAgICAgLy8gTGluZSBjb21wbGV0ZSDigJQgY2xhc3NpZnkgYW5kIGVtaXRcbiAgICAgICAgICAgICAgaWYgKGJ1ZmZlcmluZykge1xuICAgICAgICAgICAgICAgIHByb2Nlc3NDb21wbGV0ZUxpbmUobGluZUJ1ZmZlciwgY29udHJvbGxlcik7XG4gICAgICAgICAgICAgICAgbGluZUJ1ZmZlciA9IFwiXCI7XG4gICAgICAgICAgICAgICAgYnVmZmVyaW5nID0gZmFsc2U7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gT3V0c2lkZSBmZW5jZSwgZW1pdCBuZXdsaW5lOyBpbnNpZGUgZmVuY2UsIHN3YWxsb3cgaXRcbiAgICAgICAgICAgICAgICBpZiAoIWluU3BlY0ZlbmNlKSB7XG4gICAgICAgICAgICAgICAgICBlbWl0VGV4dERlbHRhKFwiXFxuXCIsIGNvbnRyb2xsZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChsaW5lQnVmZmVyLmxlbmd0aCA9PT0gMCAmJiAhYnVmZmVyaW5nKSB7XG4gICAgICAgICAgICAgIC8vIFN0YXJ0IG9mIGEgbmV3IGxpbmUg4oCUIGRlY2lkZSB3aGV0aGVyIHRvIGJ1ZmZlciBvciBzdHJlYW1cbiAgICAgICAgICAgICAgaWYgKGluU3BlY0ZlbmNlIHx8IGNoID09PSBcIntcIiB8fCBjaCA9PT0gXCJgXCIpIHtcbiAgICAgICAgICAgICAgICAvLyBCdWZmZXI6IGluc2lkZSBmZW5jZSAoZXZlcnl0aGluZyksIG9yIGhldXJpc3RpYyBtb2RlICh7KSwgb3IgcG90ZW50aWFsIGZlbmNlIChgKVxuICAgICAgICAgICAgICAgIGJ1ZmZlcmluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgbGluZUJ1ZmZlciArPSBjaDtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBlbWl0VGV4dERlbHRhKGNoLCBjb250cm9sbGVyKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChidWZmZXJpbmcpIHtcbiAgICAgICAgICAgICAgbGluZUJ1ZmZlciArPSBjaDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGVtaXRUZXh0RGVsdGEoY2gsIGNvbnRyb2xsZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGNhc2UgXCJ0ZXh0LWVuZFwiOiB7XG4gICAgICAgICAgZmx1c2hCdWZmZXIoY29udHJvbGxlcik7XG4gICAgICAgICAgaWYgKGluVGV4dEJsb2NrKSB7XG4gICAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoeyB0eXBlOiBcInRleHQtZW5kXCIsIGlkOiBjdXJyZW50VGV4dElkIH0pO1xuICAgICAgICAgICAgaW5UZXh0QmxvY2sgPSBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBkZWZhdWx0OiB7XG4gICAgICAgICAgY29udHJvbGxlci5lbnF1ZXVlKGNodW5rKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICBmbHVzaChjb250cm9sbGVyKSB7XG4gICAgICBmbHVzaEJ1ZmZlcihjb250cm9sbGVyKTtcbiAgICAgIGNsb3NlVGV4dEJsb2NrKGNvbnRyb2xsZXIpO1xuICAgIH0sXG4gIH0pO1xufVxuXG4vKipcbiAqIFRoZSBrZXkgcmVnaXN0ZXJlZCBpbiBgQXBwRGF0YVBhcnRzYCBmb3IganNvbi1yZW5kZXIgc3BlY3MuXG4gKiBUaGUgQUkgU0RLIGF1dG9tYXRpY2FsbHkgcHJlZml4ZXMgdGhpcyB3aXRoIGBcImRhdGEtXCJgIG9uIHRoZSB3aXJlLFxuICogc28gdGhlIGFjdHVhbCBzdHJlYW0gY2h1bmsgdHlwZSBpcyBgXCJkYXRhLXNwZWNcImAgKHNlZSB7QGxpbmsgU1BFQ19EQVRBX1BBUlRfVFlQRX0pLlxuICpcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgU1BFQ19EQVRBX1BBUlQsIHR5cGUgU3BlY0RhdGFQYXJ0IH0gZnJvbSBcIkBqc29uLXJlbmRlci9jb3JlXCI7XG4gKiB0eXBlIEFwcERhdGFQYXJ0cyA9IHsgW1NQRUNfREFUQV9QQVJUXTogU3BlY0RhdGFQYXJ0IH07XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IFNQRUNfREFUQV9QQVJUID0gXCJzcGVjXCIgYXMgY29uc3Q7XG5cbi8qKlxuICogVGhlIHdpcmUtZm9ybWF0IHR5cGUgc3RyaW5nIGFzIGl0IGFwcGVhcnMgaW4gc3RyZWFtIGNodW5rcyBhbmQgbWVzc2FnZSBwYXJ0cy5cbiAqIFRoaXMgaXMgYFwiZGF0YS1cImAgKyB7QGxpbmsgU1BFQ19EQVRBX1BBUlR9IOKAlCBpLmUuIGBcImRhdGEtc3BlY1wiYC5cbiAqXG4gKiBVc2UgdGhpcyBjb25zdGFudCB3aGVuIGZpbHRlcmluZyBtZXNzYWdlIHBhcnRzIG9yIGVucXVldWluZyBzdHJlYW0gY2h1bmtzLlxuICovXG5leHBvcnQgY29uc3QgU1BFQ19EQVRBX1BBUlRfVFlQRSA9IGBkYXRhLSR7U1BFQ19EQVRBX1BBUlR9YCBhcyBjb25zdDtcblxuLyoqXG4gKiBEaXNjcmltaW5hdGVkIHVuaW9uIGZvciB0aGUgcGF5bG9hZCBvZiBhIHtAbGluayBTUEVDX0RBVEFfUEFSVF9UWVBFfSBTU0UgcGFydC5cbiAqXG4gKiAtIGBcInBhdGNoXCJgOiBBIHNpbmdsZSBSRkMgNjkwMiBKU09OIFBhdGNoIG9wZXJhdGlvbiAoc3RyZWFtaW5nLCBwcm9ncmVzc2l2ZSBVSSkuXG4gKiAtIGBcImZsYXRcImA6IEEgY29tcGxldGUgZmxhdCBzcGVjIHdpdGggYHJvb3RgLCBgZWxlbWVudHNgLCBhbmQgb3B0aW9uYWwgYHN0YXRlYC5cbiAqIC0gYFwibmVzdGVkXCJgOiBBIGNvbXBsZXRlIG5lc3RlZCBzcGVjICh0cmVlIHN0cnVjdHVyZSDigJQgc2NoZW1hIGRlcGVuZHMgb24gY2F0YWxvZykuXG4gKi9cbmV4cG9ydCB0eXBlIFNwZWNEYXRhUGFydCA9XG4gIHwgeyB0eXBlOiBcInBhdGNoXCI7IHBhdGNoOiBKc29uUGF0Y2ggfVxuICB8IHsgdHlwZTogXCJmbGF0XCI7IHNwZWM6IFNwZWMgfVxuICB8IHsgdHlwZTogXCJuZXN0ZWRcIjsgc3BlYzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfTtcblxuLyoqXG4gKiBDb252ZW5pZW5jZSB3cmFwcGVyIHRoYXQgcGlwZXMgYW4gQUkgU0RLIFVJIG1lc3NhZ2Ugc3RyZWFtIHRocm91Z2ggdGhlXG4gKiBqc29uLXJlbmRlciB0cmFuc2Zvcm0sIGNsYXNzaWZ5aW5nIHRleHQgYXMgcHJvc2Ugb3IgSlNPTkwgcGF0Y2hlcy5cbiAqXG4gKiBFbGltaW5hdGVzIHRoZSBuZWVkIGZvciBtYW51YWwgYHBpcGVUaHJvdWdoKGNyZWF0ZUpzb25SZW5kZXJUcmFuc2Zvcm0oKSlgXG4gKiBhbmQgdGhlIGFzc29jaWF0ZWQgdHlwZSBjYXN0LlxuICpcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgcGlwZUpzb25SZW5kZXIgfSBmcm9tIFwiQGpzb24tcmVuZGVyL2NvcmVcIjtcbiAqXG4gKiBjb25zdCBzdHJlYW0gPSBjcmVhdGVVSU1lc3NhZ2VTdHJlYW0oe1xuICogICBleGVjdXRlOiBhc3luYyAoeyB3cml0ZXIgfSkgPT4ge1xuICogICAgIHdyaXRlci5tZXJnZShwaXBlSnNvblJlbmRlcihyZXN1bHQudG9VSU1lc3NhZ2VTdHJlYW0oKSkpO1xuICogICB9LFxuICogfSk7XG4gKiByZXR1cm4gY3JlYXRlVUlNZXNzYWdlU3RyZWFtUmVzcG9uc2UoeyBzdHJlYW0gfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBpcGVKc29uUmVuZGVyPFQgPSBTdHJlYW1DaHVuaz4oXG4gIHN0cmVhbTogUmVhZGFibGVTdHJlYW08VD4sXG4pOiBSZWFkYWJsZVN0cmVhbTxUPiB7XG4gIHJldHVybiBzdHJlYW0ucGlwZVRocm91Z2goXG4gICAgY3JlYXRlSnNvblJlbmRlclRyYW5zZm9ybSgpIGFzIHVua25vd24gYXMgVHJhbnNmb3JtU3RyZWFtPFQsIFQ+LFxuICApO1xufVxuIiwgImltcG9ydCB7XG4gIGdldEJ5UGF0aCxcbiAgcGFyc2VKc29uUG9pbnRlcixcbiAgdHlwZSBTdGF0ZU1vZGVsLFxuICB0eXBlIFN0YXRlU3RvcmUsXG59IGZyb20gXCIuL3R5cGVzXCI7XG5cbi8qKlxuICogSW1tdXRhYmx5IHNldCBhIHZhbHVlIGF0IGEgSlNPTiBQb2ludGVyIHBhdGggdXNpbmcgc3RydWN0dXJhbCBzaGFyaW5nLlxuICogT25seSBvYmplY3RzIGFsb25nIHRoZSBwYXRoIGFyZSBzaGFsbG93LWNsb25lZDsgdW50b3VjaGVkIGJyYW5jaGVzIGtlZXBcbiAqIHRoZWlyIG9yaWdpbmFsIHJlZmVyZW5jZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbW11dGFibGVTZXRCeVBhdGgoXG4gIHJvb3Q6IFN0YXRlTW9kZWwsXG4gIHBhdGg6IHN0cmluZyxcbiAgdmFsdWU6IHVua25vd24sXG4pOiBTdGF0ZU1vZGVsIHtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXJzZUpzb25Qb2ludGVyKHBhdGgpO1xuICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gcm9vdDtcblxuICBjb25zdCByZXN1bHQgPSB7IC4uLnJvb3QgfTtcbiAgbGV0IGN1cnJlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0gcmVzdWx0O1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY29uc3Qgc2VnID0gc2VnbWVudHNbaV0hO1xuICAgIGNvbnN0IGNoaWxkID0gY3VycmVudFtzZWddO1xuICAgIGlmIChBcnJheS5pc0FycmF5KGNoaWxkKSkge1xuICAgICAgY3VycmVudFtzZWddID0gWy4uLmNoaWxkXTtcbiAgICB9IGVsc2UgaWYgKGNoaWxkICE9PSBudWxsICYmIHR5cGVvZiBjaGlsZCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgY3VycmVudFtzZWddID0geyAuLi4oY2hpbGQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG5leHRTZWcgPSBzZWdtZW50c1tpICsgMV07XG4gICAgICBjdXJyZW50W3NlZ10gPSBuZXh0U2VnICE9PSB1bmRlZmluZWQgJiYgL15cXGQrJC8udGVzdChuZXh0U2VnKSA/IFtdIDoge307XG4gICAgfVxuICAgIGN1cnJlbnQgPSBjdXJyZW50W3NlZ10gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIH1cblxuICBjb25zdCBsYXN0U2VnID0gc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0hO1xuICBpZiAoQXJyYXkuaXNBcnJheShjdXJyZW50KSkge1xuICAgIGlmIChsYXN0U2VnID09PSBcIi1cIikge1xuICAgICAgKGN1cnJlbnQgYXMgdW5rbm93bltdKS5wdXNoKHZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgKGN1cnJlbnQgYXMgdW5rbm93bltdKVtwYXJzZUludChsYXN0U2VnLCAxMCldID0gdmFsdWU7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGN1cnJlbnRbbGFzdFNlZ10gPSB2YWx1ZTtcbiAgfVxuXG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgc2ltcGxlIGluLW1lbW9yeSB7QGxpbmsgU3RhdGVTdG9yZX0uXG4gKlxuICogVGhpcyBpcyB0aGUgZGVmYXVsdCBzdG9yZSB1c2VkIGJ5IGBTdGF0ZVByb3ZpZGVyYCB3aGVuIG5vIGV4dGVybmFsIHN0b3JlIGlzXG4gKiBwcm92aWRlZC4gSXQgbWlycm9ycyB0aGUgcHJldmlvdXMgYHVzZVN0YXRlYC1iYXNlZCBiZWhhdmlvdXIgYnV0IGlzXG4gKiBmcmFtZXdvcmstYWdub3N0aWMgc28gaXQgY2FuIGFsc28gYmUgdXNlZCBpbiB0ZXN0cyBvciBub24tUmVhY3QgY29udGV4dHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTdGF0ZVN0b3JlKGluaXRpYWxTdGF0ZTogU3RhdGVNb2RlbCA9IHt9KTogU3RhdGVTdG9yZSB7XG4gIGxldCBzdGF0ZTogU3RhdGVNb2RlbCA9IHsgLi4uaW5pdGlhbFN0YXRlIH07XG4gIGNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuICBmdW5jdGlvbiBub3RpZnkoKSB7XG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiBsaXN0ZW5lcnMpIHtcbiAgICAgIGxpc3RlbmVyKCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBnZXQocGF0aDogc3RyaW5nKTogdW5rbm93biB7XG4gICAgICByZXR1cm4gZ2V0QnlQYXRoKHN0YXRlLCBwYXRoKTtcbiAgICB9LFxuXG4gICAgc2V0KHBhdGg6IHN0cmluZywgdmFsdWU6IHVua25vd24pOiB2b2lkIHtcbiAgICAgIGlmIChnZXRCeVBhdGgoc3RhdGUsIHBhdGgpID09PSB2YWx1ZSkgcmV0dXJuO1xuICAgICAgc3RhdGUgPSBpbW11dGFibGVTZXRCeVBhdGgoc3RhdGUsIHBhdGgsIHZhbHVlKTtcbiAgICAgIG5vdGlmeSgpO1xuICAgIH0sXG5cbiAgICB1cGRhdGUodXBkYXRlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkIHtcbiAgICAgIGxldCBjaGFuZ2VkID0gZmFsc2U7XG4gICAgICBsZXQgbmV4dCA9IHN0YXRlO1xuICAgICAgZm9yIChjb25zdCBbcGF0aCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHVwZGF0ZXMpKSB7XG4gICAgICAgIGlmIChnZXRCeVBhdGgobmV4dCwgcGF0aCkgIT09IHZhbHVlKSB7XG4gICAgICAgICAgbmV4dCA9IGltbXV0YWJsZVNldEJ5UGF0aChuZXh0LCBwYXRoLCB2YWx1ZSk7XG4gICAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICghY2hhbmdlZCkgcmV0dXJuO1xuICAgICAgc3RhdGUgPSBuZXh0O1xuICAgICAgbm90aWZ5KCk7XG4gICAgfSxcblxuICAgIGdldFNuYXBzaG90KCk6IFN0YXRlTW9kZWwge1xuICAgICAgcmV0dXJuIHN0YXRlO1xuICAgIH0sXG5cbiAgICBnZXRTZXJ2ZXJTbmFwc2hvdCgpOiBTdGF0ZU1vZGVsIHtcbiAgICAgIHJldHVybiBzdGF0ZTtcbiAgICB9LFxuXG4gICAgc3Vic2NyaWJlKGxpc3RlbmVyOiAoKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XG4gICAgICBsaXN0ZW5lcnMuYWRkKGxpc3RlbmVyKTtcbiAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGxpc3RlbmVycy5kZWxldGUobGlzdGVuZXIpO1xuICAgICAgfTtcbiAgICB9LFxuICB9O1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHtAbGluayBjcmVhdGVTdG9yZUFkYXB0ZXJ9LiBBZGFwdGVyIGF1dGhvcnMgc3VwcGx5IHRoZXNlXG4gKiB0aHJlZSBjYWxsYmFja3M7IGV2ZXJ5dGhpbmcgZWxzZSAoZ2V0LCBzZXQsIHVwZGF0ZSwgbm8tb3AgZGV0ZWN0aW9uLFxuICogZ2V0U2VydmVyU25hcHNob3QpIGlzIGhhbmRsZWQgYnkgdGhlIHJldHVybmVkIHtAbGluayBTdGF0ZVN0b3JlfS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdG9yZUFkYXB0ZXJDb25maWcge1xuICAvKiogUmV0dXJuIHRoZSBjdXJyZW50IHN0YXRlIHNuYXBzaG90IGZyb20gdGhlIHVuZGVybHlpbmcgc3RvcmUuICovXG4gIGdldFNuYXBzaG90OiAoKSA9PiBTdGF0ZU1vZGVsO1xuICAvKiogV3JpdGUgYSBuZXcgc3RhdGUgc25hcHNob3QgdG8gdGhlIHVuZGVybHlpbmcgc3RvcmUuICovXG4gIHNldFNuYXBzaG90OiAobmV4dDogU3RhdGVNb2RlbCkgPT4gdm9pZDtcbiAgLyoqIFN1YnNjcmliZSB0byBjaGFuZ2VzIGluIHRoZSB1bmRlcmx5aW5nIHN0b3JlLiBSZXR1cm4gYW4gdW5zdWJzY3JpYmUgZm4uICovXG4gIHN1YnNjcmliZTogKGxpc3RlbmVyOiAoKSA9PiB2b2lkKSA9PiAoKSA9PiB2b2lkO1xufVxuXG4vKipcbiAqIEJ1aWxkIGEgZnVsbCB7QGxpbmsgU3RhdGVTdG9yZX0gZnJvbSBhIG1pbmltYWwgYWRhcHRlciBjb25maWcuXG4gKlxuICogSGFuZGxlcyBgZ2V0YCwgYHNldGAgKHdpdGggbm8tb3AgZGV0ZWN0aW9uKSwgYHVwZGF0ZWAgKGJhdGNoZWQsIHdpdGggbm8tb3BcbiAqIGRldGVjdGlvbiksIGBnZXRTbmFwc2hvdGAsIGBnZXRTZXJ2ZXJTbmFwc2hvdGAsIGFuZCBgc3Vic2NyaWJlYCAtLSBzbyBlYWNoXG4gKiBhZGFwdGVyIG9ubHkgbmVlZHMgdG8gd2lyZSBpdHMgc25hcHNob3Qgc291cmNlLCB3cml0ZSBBUEksIGFuZCBzdWJzY3JpYmVcbiAqIG1lY2hhbmlzbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVN0b3JlQWRhcHRlcihjb25maWc6IFN0b3JlQWRhcHRlckNvbmZpZyk6IFN0YXRlU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGdldChwYXRoOiBzdHJpbmcpOiB1bmtub3duIHtcbiAgICAgIHJldHVybiBnZXRCeVBhdGgoY29uZmlnLmdldFNuYXBzaG90KCksIHBhdGgpO1xuICAgIH0sXG5cbiAgICBzZXQocGF0aDogc3RyaW5nLCB2YWx1ZTogdW5rbm93bik6IHZvaWQge1xuICAgICAgY29uc3QgY3VycmVudCA9IGNvbmZpZy5nZXRTbmFwc2hvdCgpO1xuICAgICAgaWYgKGdldEJ5UGF0aChjdXJyZW50LCBwYXRoKSA9PT0gdmFsdWUpIHJldHVybjtcbiAgICAgIGNvbmZpZy5zZXRTbmFwc2hvdChpbW11dGFibGVTZXRCeVBhdGgoY3VycmVudCwgcGF0aCwgdmFsdWUpKTtcbiAgICB9LFxuXG4gICAgdXBkYXRlKHVwZGF0ZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gICAgICBsZXQgbmV4dCA9IGNvbmZpZy5nZXRTbmFwc2hvdCgpO1xuICAgICAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcbiAgICAgIGZvciAoY29uc3QgW3BhdGgsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh1cGRhdGVzKSkge1xuICAgICAgICBpZiAoZ2V0QnlQYXRoKG5leHQsIHBhdGgpICE9PSB2YWx1ZSkge1xuICAgICAgICAgIG5leHQgPSBpbW11dGFibGVTZXRCeVBhdGgobmV4dCwgcGF0aCwgdmFsdWUpO1xuICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoIWNoYW5nZWQpIHJldHVybjtcbiAgICAgIGNvbmZpZy5zZXRTbmFwc2hvdChuZXh0KTtcbiAgICB9LFxuXG4gICAgZ2V0U25hcHNob3Q6IGNvbmZpZy5nZXRTbmFwc2hvdCxcblxuICAgIGdldFNlcnZlclNuYXBzaG90OiBjb25maWcuZ2V0U25hcHNob3QsXG5cbiAgICBzdWJzY3JpYmU6IGNvbmZpZy5zdWJzY3JpYmUsXG4gIH07XG59XG5cbmNvbnN0IE1BWF9GTEFUVEVOX0RFUFRIID0gMjA7XG5cbi8qKlxuICogUmVjdXJzaXZlbHkgZmxhdHRlbiBhIHBsYWluIG9iamVjdCBpbnRvIGEgYFJlY29yZDxzdHJpbmcsIHVua25vd24+YCBrZXllZCBieVxuICogSlNPTiBQb2ludGVyIHBhdGhzLiBPbmx5IGxlYWYgdmFsdWVzIChub24tcGxhaW4tb2JqZWN0KSBhcHBlYXIgaW4gdGhlIG91dHB1dC5cbiAqXG4gKiBJbmNsdWRlcyBjaXJjdWxhciByZWZlcmVuY2UgcHJvdGVjdGlvbiBhbmQgYSBkZXB0aCBjYXAgdG8gcHJldmVudCBzdGFja1xuICogb3ZlcmZsb3cgb24gcGF0aG9sb2dpY2FsIGlucHV0cy5cbiAqXG4gKiBgYGB0c1xuICogZmxhdHRlblRvUG9pbnRlcnMoeyB1c2VyOiB7IG5hbWU6IFwiQWxpY2VcIiB9LCBjb3VudDogMSB9KVxuICogLy8gPT4geyBcIi91c2VyL25hbWVcIjogXCJBbGljZVwiLCBcIi9jb3VudFwiOiAxIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZmxhdHRlblRvUG9pbnRlcnMoXG4gIG9iajogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gIHByZWZpeCA9IFwiXCIsXG4gIF9kZXB0aCA9IDAsXG4gIF9zZWVuPzogU2V0PG9iamVjdD4sXG4gIF93YXJuZWQ/OiB7IGN1cnJlbnQ6IGJvb2xlYW4gfSxcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgY29uc3Qgc2VlbiA9IF9zZWVuID8/IG5ldyBTZXQ8b2JqZWN0PigpO1xuICBjb25zdCB3YXJuZWQgPSBfd2FybmVkID8/IHsgY3VycmVudDogZmFsc2UgfTtcbiAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhvYmopKSB7XG4gICAgY29uc3QgcG9pbnRlciA9IGAke3ByZWZpeH0vJHtrZXl9YDtcbiAgICBpZiAoXG4gICAgICBfZGVwdGggPCBNQVhfRkxBVFRFTl9ERVBUSCAmJlxuICAgICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgIUFycmF5LmlzQXJyYXkodmFsdWUpICYmXG4gICAgICBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpID09PSBPYmplY3QucHJvdG90eXBlICYmXG4gICAgICAhc2Vlbi5oYXModmFsdWUpXG4gICAgKSB7XG4gICAgICBzZWVuLmFkZCh2YWx1ZSk7XG4gICAgICBPYmplY3QuYXNzaWduKFxuICAgICAgICByZXN1bHQsXG4gICAgICAgIGZsYXR0ZW5Ub1BvaW50ZXJzKFxuICAgICAgICAgIHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgICAgICAgIHBvaW50ZXIsXG4gICAgICAgICAgX2RlcHRoICsgMSxcbiAgICAgICAgICBzZWVuLFxuICAgICAgICAgIHdhcm5lZCxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChcbiAgICAgICAgcHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09IFwicHJvZHVjdGlvblwiICYmXG4gICAgICAgICF3YXJuZWQuY3VycmVudCAmJlxuICAgICAgICBfZGVwdGggPj0gTUFYX0ZMQVRURU5fREVQVEggJiZcbiAgICAgICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICAgICAgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgICFBcnJheS5pc0FycmF5KHZhbHVlKSAmJlxuICAgICAgICBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpID09PSBPYmplY3QucHJvdG90eXBlICYmXG4gICAgICAgICFzZWVuLmhhcyh2YWx1ZSBhcyBvYmplY3QpXG4gICAgICApIHtcbiAgICAgICAgd2FybmVkLmN1cnJlbnQgPSB0cnVlO1xuICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgYGZsYXR0ZW5Ub1BvaW50ZXJzOiBkZXB0aCBsaW1pdCAoJHtNQVhfRkxBVFRFTl9ERVBUSH0pIHJlYWNoZWQuIE5lc3RlZCBzdGF0ZSBiZXlvbmQgdGhpcyBkZXB0aCB3aWxsIGJlIHRyZWF0ZWQgYXMgYSBsZWFmIHZhbHVlLmAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXN1bHRbcG9pbnRlcl0gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cbiIsICJpbXBvcnQgeyB6IH0gZnJvbSBcInpvZFwiO1xuaW1wb3J0IHR5cGUge1xuICBWaXNpYmlsaXR5Q29uZGl0aW9uLFxuICBTdGF0ZUNvbmRpdGlvbixcbiAgSXRlbUNvbmRpdGlvbixcbiAgSW5kZXhDb25kaXRpb24sXG4gIFNpbmdsZUNvbmRpdGlvbixcbiAgQW5kQ29uZGl0aW9uLFxuICBPckNvbmRpdGlvbixcbiAgU3RhdGVNb2RlbCxcbn0gZnJvbSBcIi4vdHlwZXNcIjtcbmltcG9ydCB7IGdldEJ5UGF0aCB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTY2hlbWFzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFNjaGVtYSBmb3IgYSBzaW5nbGUgc3RhdGUgY29uZGl0aW9uLlxuICovXG5jb25zdCBudW1lcmljT3JTdGF0ZVJlZiA9IHoudW5pb24oW1xuICB6Lm51bWJlcigpLFxuICB6Lm9iamVjdCh7ICRzdGF0ZTogei5zdHJpbmcoKSB9KSxcbl0pO1xuXG5jb25zdCBjb21wYXJpc29uT3BzID0ge1xuICBlcTogei51bmtub3duKCkub3B0aW9uYWwoKSxcbiAgbmVxOiB6LnVua25vd24oKS5vcHRpb25hbCgpLFxuICBndDogbnVtZXJpY09yU3RhdGVSZWYub3B0aW9uYWwoKSxcbiAgZ3RlOiBudW1lcmljT3JTdGF0ZVJlZi5vcHRpb25hbCgpLFxuICBsdDogbnVtZXJpY09yU3RhdGVSZWYub3B0aW9uYWwoKSxcbiAgbHRlOiBudW1lcmljT3JTdGF0ZVJlZi5vcHRpb25hbCgpLFxuICBub3Q6IHoubGl0ZXJhbCh0cnVlKS5vcHRpb25hbCgpLFxufTtcblxuY29uc3QgU3RhdGVDb25kaXRpb25TY2hlbWEgPSB6Lm9iamVjdCh7XG4gICRzdGF0ZTogei5zdHJpbmcoKSxcbiAgLi4uY29tcGFyaXNvbk9wcyxcbn0pO1xuXG5jb25zdCBJdGVtQ29uZGl0aW9uU2NoZW1hID0gei5vYmplY3Qoe1xuICAkaXRlbTogei5zdHJpbmcoKSxcbiAgLi4uY29tcGFyaXNvbk9wcyxcbn0pO1xuXG5jb25zdCBJbmRleENvbmRpdGlvblNjaGVtYSA9IHoub2JqZWN0KHtcbiAgJGluZGV4OiB6LmxpdGVyYWwodHJ1ZSksXG4gIC4uLmNvbXBhcmlzb25PcHMsXG59KTtcblxuY29uc3QgU2luZ2xlQ29uZGl0aW9uU2NoZW1hID0gei51bmlvbihbXG4gIFN0YXRlQ29uZGl0aW9uU2NoZW1hLFxuICBJdGVtQ29uZGl0aW9uU2NoZW1hLFxuICBJbmRleENvbmRpdGlvblNjaGVtYSxcbl0pO1xuXG4vKipcbiAqIFZpc2liaWxpdHkgY29uZGl0aW9uIHNjaGVtYS5cbiAqXG4gKiBMYXp5IGJlY2F1c2UgYE9yQ29uZGl0aW9uYCBjYW4gcmVjdXJzaXZlbHkgY29udGFpbiBgVmlzaWJpbGl0eUNvbmRpdGlvbmAuXG4gKi9cbmV4cG9ydCBjb25zdCBWaXNpYmlsaXR5Q29uZGl0aW9uU2NoZW1hOiB6LlpvZFR5cGU8VmlzaWJpbGl0eUNvbmRpdGlvbj4gPSB6LmxhenkoXG4gICgpID0+XG4gICAgei51bmlvbihbXG4gICAgICB6LmJvb2xlYW4oKSxcbiAgICAgIFNpbmdsZUNvbmRpdGlvblNjaGVtYSxcbiAgICAgIHouYXJyYXkoU2luZ2xlQ29uZGl0aW9uU2NoZW1hKSxcbiAgICAgIHoub2JqZWN0KHsgJGFuZDogei5hcnJheShWaXNpYmlsaXR5Q29uZGl0aW9uU2NoZW1hKSB9KSxcbiAgICAgIHoub2JqZWN0KHsgJG9yOiB6LmFycmF5KFZpc2liaWxpdHlDb25kaXRpb25TY2hlbWEpIH0pLFxuICAgIF0pLFxuKTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENvbnRleHRcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ29udGV4dCBmb3IgZXZhbHVhdGluZyB2aXNpYmlsaXR5IGNvbmRpdGlvbnMuXG4gKlxuICogYHJlcGVhdEl0ZW1gIGFuZCBgcmVwZWF0SW5kZXhgIGFyZSBvbmx5IHByZXNlbnQgaW5zaWRlIGEgYHJlcGVhdGAgc2NvcGVcbiAqIGFuZCBlbmFibGUgYCRpdGVtYCAvIGAkaW5kZXhgIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVmlzaWJpbGl0eUNvbnRleHQge1xuICBzdGF0ZU1vZGVsOiBTdGF0ZU1vZGVsO1xuICAvKiogVGhlIGN1cnJlbnQgcmVwZWF0IGl0ZW0gKHNldCBpbnNpZGUgYSByZXBlYXQgc2NvcGUpLiAqL1xuICByZXBlYXRJdGVtPzogdW5rbm93bjtcbiAgLyoqIFRoZSBjdXJyZW50IHJlcGVhdCBhcnJheSBpbmRleCAoc2V0IGluc2lkZSBhIHJlcGVhdCBzY29wZSkuICovXG4gIHJlcGVhdEluZGV4PzogbnVtYmVyO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXZhbHVhdGlvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBSZXNvbHZlIGEgY29tcGFyaXNvbiB2YWx1ZS4gSWYgaXQncyBhIGB7ICRzdGF0ZSB9YCByZWZlcmVuY2UsIGxvb2sgaXQgdXA7XG4gKiBvdGhlcndpc2UgcmV0dXJuIHRoZSBsaXRlcmFsLlxuICovXG5mdW5jdGlvbiByZXNvbHZlQ29tcGFyaXNvblZhbHVlKFxuICB2YWx1ZTogdW5rbm93bixcbiAgY3R4OiBWaXNpYmlsaXR5Q29udGV4dCxcbik6IHVua25vd24ge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIHZhbHVlICE9PSBudWxsKSB7XG4gICAgaWYgKFxuICAgICAgXCIkc3RhdGVcIiBpbiB2YWx1ZSAmJlxuICAgICAgdHlwZW9mICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuJHN0YXRlID09PSBcInN0cmluZ1wiXG4gICAgKSB7XG4gICAgICByZXR1cm4gZ2V0QnlQYXRoKGN0eC5zdGF0ZU1vZGVsLCAodmFsdWUgYXMgeyAkc3RhdGU6IHN0cmluZyB9KS4kc3RhdGUpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbi8qKlxuICogVHlwZSBndWFyZHMgZm9yIGNvbmRpdGlvbiBzb3VyY2VzLlxuICovXG5mdW5jdGlvbiBpc0l0ZW1Db25kaXRpb24oY29uZDogU2luZ2xlQ29uZGl0aW9uKTogY29uZCBpcyBJdGVtQ29uZGl0aW9uIHtcbiAgcmV0dXJuIFwiJGl0ZW1cIiBpbiBjb25kO1xufVxuXG5mdW5jdGlvbiBpc0luZGV4Q29uZGl0aW9uKGNvbmQ6IFNpbmdsZUNvbmRpdGlvbik6IGNvbmQgaXMgSW5kZXhDb25kaXRpb24ge1xuICByZXR1cm4gXCIkaW5kZXhcIiBpbiBjb25kO1xufVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGxlZnQtaGFuZC1zaWRlIHZhbHVlIG9mIGEgY29uZGl0aW9uIGJhc2VkIG9uIGl0cyBzb3VyY2UuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVDb25kaXRpb25WYWx1ZShcbiAgY29uZDogU2luZ2xlQ29uZGl0aW9uLFxuICBjdHg6IFZpc2liaWxpdHlDb250ZXh0LFxuKTogdW5rbm93biB7XG4gIGlmIChpc0luZGV4Q29uZGl0aW9uKGNvbmQpKSB7XG4gICAgcmV0dXJuIGN0eC5yZXBlYXRJbmRleDtcbiAgfVxuICBpZiAoaXNJdGVtQ29uZGl0aW9uKGNvbmQpKSB7XG4gICAgaWYgKGN0eC5yZXBlYXRJdGVtID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGNvbmQuJGl0ZW0gPT09IFwiXCJcbiAgICAgID8gY3R4LnJlcGVhdEl0ZW1cbiAgICAgIDogZ2V0QnlQYXRoKGN0eC5yZXBlYXRJdGVtLCBjb25kLiRpdGVtKTtcbiAgfVxuICAvLyBTdGF0ZUNvbmRpdGlvblxuICByZXR1cm4gZ2V0QnlQYXRoKGN0eC5zdGF0ZU1vZGVsLCAoY29uZCBhcyBTdGF0ZUNvbmRpdGlvbikuJHN0YXRlKTtcbn1cblxuLyoqXG4gKiBFdmFsdWF0ZSBhIHNpbmdsZSBjb25kaXRpb24gYWdhaW5zdCB0aGUgY29udGV4dC5cbiAqXG4gKiBXaGVuIGBub3RgIGlzIGB0cnVlYCwgdGhlIGZpbmFsIHJlc3VsdCBpcyBpbnZlcnRlZCDigJQgdGhpcyBhcHBsaWVzIHRvXG4gKiB3aGljaGV2ZXIgb3BlcmF0b3IgaXMgcHJlc2VudCAob3IgdG8gdGhlIHRydXRoaW5lc3MgY2hlY2sgaWYgbm8gb3BlcmF0b3JcbiAqIGlzIGdpdmVuKS4gIEZvciBleGFtcGxlOlxuICogLSBgeyAkc3RhdGU6IFwiL3hcIiwgbm90OiB0cnVlIH1gIOKGkiBgIUJvb2xlYW4odmFsdWUpYFxuICogLSBgeyAkc3RhdGU6IFwiL3hcIiwgZ3Q6IDUsIG5vdDogdHJ1ZSB9YCDihpIgYCEodmFsdWUgPiA1KWBcbiAqL1xuZnVuY3Rpb24gZXZhbHVhdGVDb25kaXRpb24oXG4gIGNvbmQ6IFNpbmdsZUNvbmRpdGlvbixcbiAgY3R4OiBWaXNpYmlsaXR5Q29udGV4dCxcbik6IGJvb2xlYW4ge1xuICBjb25zdCB2YWx1ZSA9IHJlc29sdmVDb25kaXRpb25WYWx1ZShjb25kLCBjdHgpO1xuICBsZXQgcmVzdWx0OiBib29sZWFuO1xuXG4gIC8vIEVxdWFsaXR5XG4gIGlmIChjb25kLmVxICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCByaHMgPSByZXNvbHZlQ29tcGFyaXNvblZhbHVlKGNvbmQuZXEsIGN0eCk7XG4gICAgcmVzdWx0ID0gdmFsdWUgPT09IHJocztcbiAgfVxuICAvLyBJbmVxdWFsaXR5XG4gIGVsc2UgaWYgKGNvbmQubmVxICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCByaHMgPSByZXNvbHZlQ29tcGFyaXNvblZhbHVlKGNvbmQubmVxLCBjdHgpO1xuICAgIHJlc3VsdCA9IHZhbHVlICE9PSByaHM7XG4gIH1cbiAgLy8gR3JlYXRlciB0aGFuXG4gIGVsc2UgaWYgKGNvbmQuZ3QgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHJocyA9IHJlc29sdmVDb21wYXJpc29uVmFsdWUoY29uZC5ndCwgY3R4KTtcbiAgICByZXN1bHQgPVxuICAgICAgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIHR5cGVvZiByaHMgPT09IFwibnVtYmVyXCJcbiAgICAgICAgPyB2YWx1ZSA+IHJoc1xuICAgICAgICA6IGZhbHNlO1xuICB9XG4gIC8vIEdyZWF0ZXIgdGhhbiBvciBlcXVhbFxuICBlbHNlIGlmIChjb25kLmd0ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgcmhzID0gcmVzb2x2ZUNvbXBhcmlzb25WYWx1ZShjb25kLmd0ZSwgY3R4KTtcbiAgICByZXN1bHQgPVxuICAgICAgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIHR5cGVvZiByaHMgPT09IFwibnVtYmVyXCJcbiAgICAgICAgPyB2YWx1ZSA+PSByaHNcbiAgICAgICAgOiBmYWxzZTtcbiAgfVxuICAvLyBMZXNzIHRoYW5cbiAgZWxzZSBpZiAoY29uZC5sdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgcmhzID0gcmVzb2x2ZUNvbXBhcmlzb25WYWx1ZShjb25kLmx0LCBjdHgpO1xuICAgIHJlc3VsdCA9XG4gICAgICB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIHJocyA9PT0gXCJudW1iZXJcIlxuICAgICAgICA/IHZhbHVlIDwgcmhzXG4gICAgICAgIDogZmFsc2U7XG4gIH1cbiAgLy8gTGVzcyB0aGFuIG9yIGVxdWFsXG4gIGVsc2UgaWYgKGNvbmQubHRlICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCByaHMgPSByZXNvbHZlQ29tcGFyaXNvblZhbHVlKGNvbmQubHRlLCBjdHgpO1xuICAgIHJlc3VsdCA9XG4gICAgICB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgdHlwZW9mIHJocyA9PT0gXCJudW1iZXJcIlxuICAgICAgICA/IHZhbHVlIDw9IHJoc1xuICAgICAgICA6IGZhbHNlO1xuICB9XG4gIC8vIFRydXRoaW5lc3MgKG5vIG9wZXJhdG9yKVxuICBlbHNlIHtcbiAgICByZXN1bHQgPSBCb29sZWFuKHZhbHVlKTtcbiAgfVxuXG4gIC8vIGBub3RgIGludmVydHMgdGhlIHJlc3VsdCBvZiBhbnkgY29uZGl0aW9uXG4gIHJldHVybiBjb25kLm5vdCA9PT0gdHJ1ZSA/ICFyZXN1bHQgOiByZXN1bHQ7XG59XG5cbi8qKlxuICogVHlwZSBndWFyZCBmb3IgQW5kQ29uZGl0aW9uXG4gKi9cbmZ1bmN0aW9uIGlzQW5kQ29uZGl0aW9uKFxuICBjb25kaXRpb246IFZpc2liaWxpdHlDb25kaXRpb24sXG4pOiBjb25kaXRpb24gaXMgQW5kQ29uZGl0aW9uIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgY29uZGl0aW9uID09PSBcIm9iamVjdFwiICYmXG4gICAgY29uZGl0aW9uICE9PSBudWxsICYmXG4gICAgIUFycmF5LmlzQXJyYXkoY29uZGl0aW9uKSAmJlxuICAgIFwiJGFuZFwiIGluIGNvbmRpdGlvblxuICApO1xufVxuXG4vKipcbiAqIFR5cGUgZ3VhcmQgZm9yIE9yQ29uZGl0aW9uXG4gKi9cbmZ1bmN0aW9uIGlzT3JDb25kaXRpb24oXG4gIGNvbmRpdGlvbjogVmlzaWJpbGl0eUNvbmRpdGlvbixcbik6IGNvbmRpdGlvbiBpcyBPckNvbmRpdGlvbiB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIGNvbmRpdGlvbiA9PT0gXCJvYmplY3RcIiAmJlxuICAgIGNvbmRpdGlvbiAhPT0gbnVsbCAmJlxuICAgICFBcnJheS5pc0FycmF5KGNvbmRpdGlvbikgJiZcbiAgICBcIiRvclwiIGluIGNvbmRpdGlvblxuICApO1xufVxuXG4vKipcbiAqIEV2YWx1YXRlIGEgdmlzaWJpbGl0eSBjb25kaXRpb24uXG4gKlxuICogLSBgdW5kZWZpbmVkYCDihpIgdmlzaWJsZVxuICogLSBgYm9vbGVhbmAg4oaSIHRoYXQgdmFsdWVcbiAqIC0gYFNpbmdsZUNvbmRpdGlvbmAg4oaSIGV2YWx1YXRlIHNpbmdsZSBjb25kaXRpb25cbiAqIC0gYFNpbmdsZUNvbmRpdGlvbltdYCDihpIgaW1wbGljaXQgQU5EIChhbGwgbXVzdCBiZSB0cnVlKVxuICogLSBgQW5kQ29uZGl0aW9uYCDihpIgYHsgJGFuZDogWy4uLl0gfWAsIGV4cGxpY2l0IEFORFxuICogLSBgT3JDb25kaXRpb25gIOKGkiBgeyAkb3I6IFsuLi5dIH1gLCBhdCBsZWFzdCBvbmUgbXVzdCBiZSB0cnVlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZVZpc2liaWxpdHkoXG4gIGNvbmRpdGlvbjogVmlzaWJpbGl0eUNvbmRpdGlvbiB8IHVuZGVmaW5lZCxcbiAgY3R4OiBWaXNpYmlsaXR5Q29udGV4dCxcbik6IGJvb2xlYW4ge1xuICAvLyBObyBjb25kaXRpb24gPSB2aXNpYmxlXG4gIGlmIChjb25kaXRpb24gPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gQm9vbGVhbiBsaXRlcmFsXG4gIGlmICh0eXBlb2YgY29uZGl0aW9uID09PSBcImJvb2xlYW5cIikge1xuICAgIHJldHVybiBjb25kaXRpb247XG4gIH1cblxuICAvLyBBcnJheSA9IGltcGxpY2l0IEFORFxuICBpZiAoQXJyYXkuaXNBcnJheShjb25kaXRpb24pKSB7XG4gICAgcmV0dXJuIGNvbmRpdGlvbi5ldmVyeSgoYykgPT4gZXZhbHVhdGVDb25kaXRpb24oYywgY3R4KSk7XG4gIH1cblxuICAvLyBFeHBsaWNpdCBBTkQgY29uZGl0aW9uXG4gIGlmIChpc0FuZENvbmRpdGlvbihjb25kaXRpb24pKSB7XG4gICAgcmV0dXJuIGNvbmRpdGlvbi4kYW5kLmV2ZXJ5KChjaGlsZCkgPT4gZXZhbHVhdGVWaXNpYmlsaXR5KGNoaWxkLCBjdHgpKTtcbiAgfVxuXG4gIC8vIE9SIGNvbmRpdGlvblxuICBpZiAoaXNPckNvbmRpdGlvbihjb25kaXRpb24pKSB7XG4gICAgcmV0dXJuIGNvbmRpdGlvbi4kb3Iuc29tZSgoY2hpbGQpID0+IGV2YWx1YXRlVmlzaWJpbGl0eShjaGlsZCwgY3R4KSk7XG4gIH1cblxuICAvLyBTaW5nbGUgY29uZGl0aW9uXG4gIHJldHVybiBldmFsdWF0ZUNvbmRpdGlvbihjb25kaXRpb24sIGN0eCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBIZWxwZXJzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEhlbHBlciB0byBjcmVhdGUgdmlzaWJpbGl0eSBjb25kaXRpb25zLlxuICovXG5leHBvcnQgY29uc3QgdmlzaWJpbGl0eSA9IHtcbiAgLyoqIEFsd2F5cyB2aXNpYmxlICovXG4gIGFsd2F5czogdHJ1ZSBhcyBjb25zdCxcblxuICAvKiogTmV2ZXIgdmlzaWJsZSAqL1xuICBuZXZlcjogZmFsc2UgYXMgY29uc3QsXG5cbiAgLyoqIFZpc2libGUgd2hlbiBzdGF0ZSBwYXRoIGlzIHRydXRoeSAqL1xuICB3aGVuOiAocGF0aDogc3RyaW5nKTogU3RhdGVDb25kaXRpb24gPT4gKHsgJHN0YXRlOiBwYXRoIH0pLFxuXG4gIC8qKiBWaXNpYmxlIHdoZW4gc3RhdGUgcGF0aCBpcyBmYWxzeSAqL1xuICB1bmxlc3M6IChwYXRoOiBzdHJpbmcpOiBTdGF0ZUNvbmRpdGlvbiA9PiAoeyAkc3RhdGU6IHBhdGgsIG5vdDogdHJ1ZSB9KSxcblxuICAvKiogRXF1YWxpdHkgY2hlY2sgKi9cbiAgZXE6IChwYXRoOiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKTogU3RhdGVDb25kaXRpb24gPT4gKHtcbiAgICAkc3RhdGU6IHBhdGgsXG4gICAgZXE6IHZhbHVlLFxuICB9KSxcblxuICAvKiogTm90IGVxdWFsIGNoZWNrICovXG4gIG5lcTogKHBhdGg6IHN0cmluZywgdmFsdWU6IHVua25vd24pOiBTdGF0ZUNvbmRpdGlvbiA9PiAoe1xuICAgICRzdGF0ZTogcGF0aCxcbiAgICBuZXE6IHZhbHVlLFxuICB9KSxcblxuICAvKiogR3JlYXRlciB0aGFuICovXG4gIGd0OiAocGF0aDogc3RyaW5nLCB2YWx1ZTogbnVtYmVyIHwgeyAkc3RhdGU6IHN0cmluZyB9KTogU3RhdGVDb25kaXRpb24gPT4gKHtcbiAgICAkc3RhdGU6IHBhdGgsXG4gICAgZ3Q6IHZhbHVlLFxuICB9KSxcblxuICAvKiogR3JlYXRlciB0aGFuIG9yIGVxdWFsICovXG4gIGd0ZTogKHBhdGg6IHN0cmluZywgdmFsdWU6IG51bWJlciB8IHsgJHN0YXRlOiBzdHJpbmcgfSk6IFN0YXRlQ29uZGl0aW9uID0+ICh7XG4gICAgJHN0YXRlOiBwYXRoLFxuICAgIGd0ZTogdmFsdWUsXG4gIH0pLFxuXG4gIC8qKiBMZXNzIHRoYW4gKi9cbiAgbHQ6IChwYXRoOiBzdHJpbmcsIHZhbHVlOiBudW1iZXIgfCB7ICRzdGF0ZTogc3RyaW5nIH0pOiBTdGF0ZUNvbmRpdGlvbiA9PiAoe1xuICAgICRzdGF0ZTogcGF0aCxcbiAgICBsdDogdmFsdWUsXG4gIH0pLFxuXG4gIC8qKiBMZXNzIHRoYW4gb3IgZXF1YWwgKi9cbiAgbHRlOiAocGF0aDogc3RyaW5nLCB2YWx1ZTogbnVtYmVyIHwgeyAkc3RhdGU6IHN0cmluZyB9KTogU3RhdGVDb25kaXRpb24gPT4gKHtcbiAgICAkc3RhdGU6IHBhdGgsXG4gICAgbHRlOiB2YWx1ZSxcbiAgfSksXG5cbiAgLyoqIEFORCBtdWx0aXBsZSBjb25kaXRpb25zICovXG4gIGFuZDogKC4uLmNvbmRpdGlvbnM6IFZpc2liaWxpdHlDb25kaXRpb25bXSk6IEFuZENvbmRpdGlvbiA9PiAoe1xuICAgICRhbmQ6IGNvbmRpdGlvbnMsXG4gIH0pLFxuXG4gIC8qKiBPUiBtdWx0aXBsZSBjb25kaXRpb25zICovXG4gIG9yOiAoLi4uY29uZGl0aW9uczogVmlzaWJpbGl0eUNvbmRpdGlvbltdKTogT3JDb25kaXRpb24gPT4gKHtcbiAgICAkb3I6IGNvbmRpdGlvbnMsXG4gIH0pLFxufTtcbiIsICJpbXBvcnQgdHlwZSB7IFZpc2liaWxpdHlDb25kaXRpb24sIFN0YXRlTW9kZWwgfSBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IHsgZ2V0QnlQYXRoIH0gZnJvbSBcIi4vdHlwZXNcIjtcbmltcG9ydCB7IGV2YWx1YXRlVmlzaWJpbGl0eSwgdHlwZSBWaXNpYmlsaXR5Q29udGV4dCB9IGZyb20gXCIuL3Zpc2liaWxpdHlcIjtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFByb3AgRXhwcmVzc2lvbiBUeXBlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBBIHByb3AgZXhwcmVzc2lvbiB0aGF0IHJlc29sdmVzIHRvIGEgdmFsdWUgYmFzZWQgb24gc3RhdGUuXG4gKlxuICogLSBgeyAkc3RhdGU6IHN0cmluZyB9YCByZWFkcyBhIHZhbHVlIGZyb20gdGhlIGdsb2JhbCBzdGF0ZSBtb2RlbFxuICogLSBgeyAkaXRlbTogc3RyaW5nIH1gIHJlYWRzIGEgZmllbGQgZnJvbSB0aGUgY3VycmVudCByZXBlYXQgaXRlbVxuICogICAgKHJlbGF0aXZlIHBhdGggaW50byB0aGUgaXRlbSBvYmplY3Q7IHVzZSBgXCJcImAgZm9yIHRoZSB3aG9sZSBpdGVtKVxuICogLSBgeyAkaW5kZXg6IHRydWUgfWAgcmV0dXJucyB0aGUgY3VycmVudCByZXBlYXQgYXJyYXkgaW5kZXguIFVzZXMgYHRydWVgXG4gKiAgICBhcyBhIHNlbnRpbmVsIGZsYWcgYmVjYXVzZSB0aGUgaW5kZXggaXMgYSBzY2FsYXIgd2l0aCBubyBzdWItcGF0aCB0b1xuICogICAgbmF2aWdhdGUg4oCUIHVubGlrZSBgJGl0ZW1gIHdoaWNoIG5lZWRzIGEgcGF0aCBpbnRvIHRoZSBpdGVtIG9iamVjdC5cbiAqIC0gYHsgJGJpbmRTdGF0ZTogc3RyaW5nIH1gIHR3by13YXkgYmluZGluZyB0byBhIGdsb2JhbCBzdGF0ZSBwYXRoIOKAlFxuICogICAgcmVzb2x2ZXMgdG8gdGhlIHZhbHVlIGF0IHRoZSBwYXRoIChsaWtlIGAkc3RhdGVgKSBBTkQgZXhwb3NlcyB0aGVcbiAqICAgIHJlc29sdmVkIHBhdGggc28gdGhlIGNvbXBvbmVudCBjYW4gd3JpdGUgYmFjay5cbiAqIC0gYHsgJGJpbmRJdGVtOiBzdHJpbmcgfWAgdHdvLXdheSBiaW5kaW5nIHRvIGEgZmllbGQgb24gdGhlIGN1cnJlbnRcbiAqICAgIHJlcGVhdCBpdGVtIOKAlCByZXNvbHZlcyB2aWEgYHJlcGVhdEJhc2VQYXRoICsgcGF0aGAgYW5kIGV4cG9zZXMgdGhlXG4gKiAgICBhYnNvbHV0ZSBzdGF0ZSBwYXRoIGZvciB3cml0ZS1iYWNrLlxuICogLSBgeyAkY29uZCwgJHRoZW4sICRlbHNlIH1gIGNvbmRpdGlvbmFsbHkgcGlja3MgYSB2YWx1ZVxuICogLSBgeyAkY29tcHV0ZWQ6IHN0cmluZywgYXJncz86IFJlY29yZDxzdHJpbmcsIFByb3BFeHByZXNzaW9uPiB9YCBjYWxscyBhXG4gKiAgICByZWdpc3RlcmVkIGZ1bmN0aW9uIHdpdGggcmVzb2x2ZWQgYXJncyBhbmQgcmV0dXJucyB0aGUgcmVzdWx0XG4gKiAtIGB7ICR0ZW1wbGF0ZTogc3RyaW5nIH1gIGludGVycG9sYXRlcyBgJHsvcGF0aH1gIHJlZmVyZW5jZXMgaW4gdGhlXG4gKiAgICBzdHJpbmcgd2l0aCB2YWx1ZXMgZnJvbSB0aGUgc3RhdGUgbW9kZWxcbiAqIC0gQW55IG90aGVyIHZhbHVlIGlzIGEgbGl0ZXJhbCAocGFzc3Rocm91Z2gpXG4gKi9cbmV4cG9ydCB0eXBlIFByb3BFeHByZXNzaW9uPFQgPSB1bmtub3duPiA9XG4gIHwgVFxuICB8IHsgJHN0YXRlOiBzdHJpbmcgfVxuICB8IHsgJGl0ZW06IHN0cmluZyB9XG4gIHwgeyAkaW5kZXg6IHRydWUgfVxuICB8IHsgJGJpbmRTdGF0ZTogc3RyaW5nIH1cbiAgfCB7ICRiaW5kSXRlbTogc3RyaW5nIH1cbiAgfCB7XG4gICAgICAkY29uZDogVmlzaWJpbGl0eUNvbmRpdGlvbjtcbiAgICAgICR0aGVuOiBQcm9wRXhwcmVzc2lvbjxUPjtcbiAgICAgICRlbHNlOiBQcm9wRXhwcmVzc2lvbjxUPjtcbiAgICB9XG4gIHwgeyAkY29tcHV0ZWQ6IHN0cmluZzsgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH1cbiAgfCB7ICR0ZW1wbGF0ZTogc3RyaW5nIH07XG5cbi8qKlxuICogRnVuY3Rpb24gc2lnbmF0dXJlIGZvciBgJGNvbXB1dGVkYCBleHByZXNzaW9ucy5cbiAqIFJlY2VpdmVzIGEgcmVjb3JkIG9mIHJlc29sdmVkIGFyZ3VtZW50IHZhbHVlcyBhbmQgcmV0dXJucyBhIGNvbXB1dGVkIHJlc3VsdC5cbiAqL1xuZXhwb3J0IHR5cGUgQ29tcHV0ZWRGdW5jdGlvbiA9IChhcmdzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdW5rbm93bjtcblxuLyoqXG4gKiBDb250ZXh0IGZvciByZXNvbHZpbmcgcHJvcCBleHByZXNzaW9ucy5cbiAqIEV4dGVuZHMge0BsaW5rIFZpc2liaWxpdHlDb250ZXh0fSB3aXRoIGFuIG9wdGlvbmFsIGByZXBlYXRCYXNlUGF0aGAgdXNlZFxuICogdG8gcmVzb2x2ZSBgJGJpbmRJdGVtYCBwYXRocyB0byBhYnNvbHV0ZSBzdGF0ZSBwYXRocy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQcm9wUmVzb2x1dGlvbkNvbnRleHQgZXh0ZW5kcyBWaXNpYmlsaXR5Q29udGV4dCB7XG4gIC8qKiBBYnNvbHV0ZSBzdGF0ZSBwYXRoIHRvIHRoZSBjdXJyZW50IHJlcGVhdCBpdGVtIChlLmcuIFwiL3RvZG9zLzBcIikuIFNldCBpbnNpZGUgcmVwZWF0IHNjb3Blcy4gKi9cbiAgcmVwZWF0QmFzZVBhdGg/OiBzdHJpbmc7XG4gIC8qKiBOYW1lZCBmdW5jdGlvbnMgYXZhaWxhYmxlIGZvciBgJGNvbXB1dGVkYCBleHByZXNzaW9ucy4gKi9cbiAgZnVuY3Rpb25zPzogUmVjb3JkPHN0cmluZywgQ29tcHV0ZWRGdW5jdGlvbj47XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUeXBlIEd1YXJkc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZnVuY3Rpb24gaXNTdGF0ZUV4cHJlc3Npb24odmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyB7ICRzdGF0ZTogc3RyaW5nIH0ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgXCIkc3RhdGVcIiBpbiB2YWx1ZSAmJlxuICAgIHR5cGVvZiAodmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLiRzdGF0ZSA9PT0gXCJzdHJpbmdcIlxuICApO1xufVxuXG5mdW5jdGlvbiBpc0l0ZW1FeHByZXNzaW9uKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgeyAkaXRlbTogc3RyaW5nIH0ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgXCIkaXRlbVwiIGluIHZhbHVlICYmXG4gICAgdHlwZW9mICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuJGl0ZW0gPT09IFwic3RyaW5nXCJcbiAgKTtcbn1cblxuZnVuY3Rpb24gaXNJbmRleEV4cHJlc3Npb24odmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyB7ICRpbmRleDogdHJ1ZSB9IHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIFwiJGluZGV4XCIgaW4gdmFsdWUgJiZcbiAgICAodmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLiRpbmRleCA9PT0gdHJ1ZVxuICApO1xufVxuXG5mdW5jdGlvbiBpc0JpbmRTdGF0ZUV4cHJlc3Npb24oXG4gIHZhbHVlOiB1bmtub3duLFxuKTogdmFsdWUgaXMgeyAkYmluZFN0YXRlOiBzdHJpbmcgfSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBcIiRiaW5kU3RhdGVcIiBpbiB2YWx1ZSAmJlxuICAgIHR5cGVvZiAodmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLiRiaW5kU3RhdGUgPT09IFwic3RyaW5nXCJcbiAgKTtcbn1cblxuZnVuY3Rpb24gaXNCaW5kSXRlbUV4cHJlc3Npb24odmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyB7ICRiaW5kSXRlbTogc3RyaW5nIH0ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgXCIkYmluZEl0ZW1cIiBpbiB2YWx1ZSAmJlxuICAgIHR5cGVvZiAodmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLiRiaW5kSXRlbSA9PT0gXCJzdHJpbmdcIlxuICApO1xufVxuXG5mdW5jdGlvbiBpc0NvbmRFeHByZXNzaW9uKFxuICB2YWx1ZTogdW5rbm93bixcbik6IHZhbHVlIGlzIHsgJGNvbmQ6IFZpc2liaWxpdHlDb25kaXRpb247ICR0aGVuOiB1bmtub3duOyAkZWxzZTogdW5rbm93biB9IHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIFwiJGNvbmRcIiBpbiB2YWx1ZSAmJlxuICAgIFwiJHRoZW5cIiBpbiB2YWx1ZSAmJlxuICAgIFwiJGVsc2VcIiBpbiB2YWx1ZVxuICApO1xufVxuXG5mdW5jdGlvbiBpc0NvbXB1dGVkRXhwcmVzc2lvbihcbiAgdmFsdWU6IHVua25vd24sXG4pOiB2YWx1ZSBpcyB7ICRjb21wdXRlZDogc3RyaW5nOyBhcmdzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBcIiRjb21wdXRlZFwiIGluIHZhbHVlICYmXG4gICAgdHlwZW9mICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuJGNvbXB1dGVkID09PSBcInN0cmluZ1wiXG4gICk7XG59XG5cbmZ1bmN0aW9uIGlzVGVtcGxhdGVFeHByZXNzaW9uKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgeyAkdGVtcGxhdGU6IHN0cmluZyB9IHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIFwiJHRlbXBsYXRlXCIgaW4gdmFsdWUgJiZcbiAgICB0eXBlb2YgKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS4kdGVtcGxhdGUgPT09IFwic3RyaW5nXCJcbiAgKTtcbn1cblxuLy8gTW9kdWxlLWxldmVsIHNldCB0byBhdm9pZCBzcGFtbWluZyBjb25zb2xlLndhcm4gb24gZXZlcnkgcmVuZGVyIGZvciB0aGUgc2FtZVxuLy8gdW5rbm93biAkY29tcHV0ZWQgZnVuY3Rpb24gbmFtZS4gT25jZSB0aGUgc2V0IHJlYWNoZXMgV0FSTkVEX0NPTVBVVEVEX01BWCxcbi8vIG5ldyBuYW1lcyBhcmUgbm8gbG9uZ2VyIGRlZHVwbGljYXRlZCAod2FybmluZ3Mgc3RpbGwgZmlyZSkgYnV0IHRoZSBzZXQgc3RvcHNcbi8vIGdyb3dpbmcsIHByZXZlbnRpbmcgdW5ib3VuZGVkIG1lbW9yeSB1c2UgaW4gbG9uZy1saXZlZCBwcm9jZXNzZXMgKGUuZy4gU1NSKS5cbmNvbnN0IFdBUk5FRF9DT01QVVRFRF9NQVggPSAxMDA7XG5jb25zdCB3YXJuZWRDb21wdXRlZEZucyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4vKiogQGludGVybmFsIFRlc3Qtb25seTogY2xlYXIgdGhlIGRlZHVwbGljYXRpb24gc2V0IGZvciAkY29tcHV0ZWQgd2FybmluZ3MuICovXG5leHBvcnQgZnVuY3Rpb24gX3Jlc2V0V2FybmVkQ29tcHV0ZWRGbnMoKTogdm9pZCB7XG4gIHdhcm5lZENvbXB1dGVkRm5zLmNsZWFyKCk7XG59XG5cbi8vIFNhbWUgZGVkdXBsaWNhdGlvbiBwYXR0ZXJuIGZvciAkdGVtcGxhdGUgcGF0aHMgdGhhdCBkb24ndCBzdGFydCB3aXRoIFwiL1wiLlxuY29uc3QgV0FSTkVEX1RFTVBMQVRFX01BWCA9IDEwMDtcbmNvbnN0IHdhcm5lZFRlbXBsYXRlUGF0aHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuLyoqIEBpbnRlcm5hbCBUZXN0LW9ubHk6IGNsZWFyIHRoZSBkZWR1cGxpY2F0aW9uIHNldCBmb3IgJHRlbXBsYXRlIHdhcm5pbmdzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIF9yZXNldFdhcm5lZFRlbXBsYXRlUGF0aHMoKTogdm9pZCB7XG4gIHdhcm5lZFRlbXBsYXRlUGF0aHMuY2xlYXIoKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFByb3AgRXhwcmVzc2lvbiBSZXNvbHV0aW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gJGJpbmRJdGVtIHBhdGggcmVzb2x1dGlvbiBoZWxwZXJcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogUmVzb2x2ZSBhIGAkYmluZEl0ZW1gIHBhdGggaW50byBhbiBhYnNvbHV0ZSBzdGF0ZSBwYXRoIHVzaW5nIHRoZSByZXBlYXRcbiAqIHNjb3BlJ3MgYmFzZSBwYXRoLlxuICpcbiAqIGBcIlwiYCByZXNvbHZlcyB0byBgcmVwZWF0QmFzZVBhdGhgICh0aGUgd2hvbGUgaXRlbSkuXG4gKiBgXCJmaWVsZFwiYCByZXNvbHZlcyB0byBgcmVwZWF0QmFzZVBhdGggKyBcIi9maWVsZFwiYC5cbiAqXG4gKiBSZXR1cm5zIGB1bmRlZmluZWRgIHdoZW4gbm8gYHJlcGVhdEJhc2VQYXRoYCBpcyBhdmFpbGFibGUgKGkuZS4gYCRiaW5kSXRlbWBcbiAqIGlzIHVzZWQgb3V0c2lkZSBhIHJlcGVhdCBzY29wZSkuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVCaW5kSXRlbVBhdGgoXG4gIGl0ZW1QYXRoOiBzdHJpbmcsXG4gIGN0eDogUHJvcFJlc29sdXRpb25Db250ZXh0LFxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKGN0eC5yZXBlYXRCYXNlUGF0aCA9PSBudWxsKSB7XG4gICAgY29uc29sZS53YXJuKGAkYmluZEl0ZW0gdXNlZCBvdXRzaWRlIHJlcGVhdCBzY29wZTogXCIke2l0ZW1QYXRofVwiYCk7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAoaXRlbVBhdGggPT09IFwiXCIpIHJldHVybiBjdHgucmVwZWF0QmFzZVBhdGg7XG4gIHJldHVybiBjdHgucmVwZWF0QmFzZVBhdGggKyBcIi9cIiArIGl0ZW1QYXRoO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUHJvcCBFeHByZXNzaW9uIFJlc29sdXRpb25cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogUmVzb2x2ZSBhIHNpbmdsZSBwcm9wIHZhbHVlIHRoYXQgbWF5IGNvbnRhaW4gZXhwcmVzc2lvbnMuXG4gKiBIYW5kbGVzICRzdGF0ZSwgJGl0ZW0sICRpbmRleCwgJGJpbmRTdGF0ZSwgJGJpbmRJdGVtLCBhbmQgJGNvbmQvJHRoZW4vJGVsc2UgaW4gYSBzaW5nbGUgcGFzcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVQcm9wVmFsdWUoXG4gIHZhbHVlOiB1bmtub3duLFxuICBjdHg6IFByb3BSZXNvbHV0aW9uQ29udGV4dCxcbik6IHVua25vd24ge1xuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIC8vICRzdGF0ZTogcmVhZCBmcm9tIGdsb2JhbCBzdGF0ZSBtb2RlbFxuICBpZiAoaXNTdGF0ZUV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgcmV0dXJuIGdldEJ5UGF0aChjdHguc3RhdGVNb2RlbCwgdmFsdWUuJHN0YXRlKTtcbiAgfVxuXG4gIC8vICRpdGVtOiByZWFkIGZyb20gY3VycmVudCByZXBlYXQgaXRlbVxuICBpZiAoaXNJdGVtRXhwcmVzc2lvbih2YWx1ZSkpIHtcbiAgICBpZiAoY3R4LnJlcGVhdEl0ZW0gPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAvLyBcIlwiIG1lYW5zIHRoZSB3aG9sZSBpdGVtLCBcImZpZWxkXCIgbWVhbnMgYSBmaWVsZCBvbiB0aGUgaXRlbVxuICAgIHJldHVybiB2YWx1ZS4kaXRlbSA9PT0gXCJcIlxuICAgICAgPyBjdHgucmVwZWF0SXRlbVxuICAgICAgOiBnZXRCeVBhdGgoY3R4LnJlcGVhdEl0ZW0sIHZhbHVlLiRpdGVtKTtcbiAgfVxuXG4gIC8vICRpbmRleDogcmV0dXJuIGN1cnJlbnQgcmVwZWF0IGFycmF5IGluZGV4XG4gIGlmIChpc0luZGV4RXhwcmVzc2lvbih2YWx1ZSkpIHtcbiAgICByZXR1cm4gY3R4LnJlcGVhdEluZGV4O1xuICB9XG5cbiAgLy8gJGJpbmRTdGF0ZTogdHdvLXdheSBiaW5kaW5nIHRvIGdsb2JhbCBzdGF0ZSBwYXRoXG4gIGlmIChpc0JpbmRTdGF0ZUV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgcmV0dXJuIGdldEJ5UGF0aChjdHguc3RhdGVNb2RlbCwgdmFsdWUuJGJpbmRTdGF0ZSk7XG4gIH1cblxuICAvLyAkYmluZEl0ZW06IHR3by13YXkgYmluZGluZyB0byByZXBlYXQgaXRlbSBmaWVsZFxuICBpZiAoaXNCaW5kSXRlbUV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgY29uc3QgcmVzb2x2ZWRQYXRoID0gcmVzb2x2ZUJpbmRJdGVtUGF0aCh2YWx1ZS4kYmluZEl0ZW0sIGN0eCk7XG4gICAgaWYgKHJlc29sdmVkUGF0aCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHJldHVybiBnZXRCeVBhdGgoY3R4LnN0YXRlTW9kZWwsIHJlc29sdmVkUGF0aCk7XG4gIH1cblxuICAvLyAkY29uZC8kdGhlbi8kZWxzZTogZXZhbHVhdGUgY29uZGl0aW9uIGFuZCBwaWNrIGJyYW5jaFxuICBpZiAoaXNDb25kRXhwcmVzc2lvbih2YWx1ZSkpIHtcbiAgICBjb25zdCByZXN1bHQgPSBldmFsdWF0ZVZpc2liaWxpdHkodmFsdWUuJGNvbmQsIGN0eCk7XG4gICAgcmV0dXJuIHJlc29sdmVQcm9wVmFsdWUocmVzdWx0ID8gdmFsdWUuJHRoZW4gOiB2YWx1ZS4kZWxzZSwgY3R4KTtcbiAgfVxuXG4gIC8vICRjb21wdXRlZDogY2FsbCBhIHJlZ2lzdGVyZWQgZnVuY3Rpb24gd2l0aCByZXNvbHZlZCBhcmdzXG4gIGlmIChpc0NvbXB1dGVkRXhwcmVzc2lvbih2YWx1ZSkpIHtcbiAgICBjb25zdCBmbiA9IGN0eC5mdW5jdGlvbnM/Llt2YWx1ZS4kY29tcHV0ZWRdO1xuICAgIGlmICghZm4pIHtcbiAgICAgIGlmICghd2FybmVkQ29tcHV0ZWRGbnMuaGFzKHZhbHVlLiRjb21wdXRlZCkpIHtcbiAgICAgICAgaWYgKHdhcm5lZENvbXB1dGVkRm5zLnNpemUgPCBXQVJORURfQ09NUFVURURfTUFYKSB7XG4gICAgICAgICAgd2FybmVkQ29tcHV0ZWRGbnMuYWRkKHZhbHVlLiRjb21wdXRlZCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc29sZS53YXJuKGBVbmtub3duICRjb21wdXRlZCBmdW5jdGlvbjogXCIke3ZhbHVlLiRjb21wdXRlZH1cImApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgY29uc3QgcmVzb2x2ZWRBcmdzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICAgIGlmICh2YWx1ZS5hcmdzKSB7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIGFyZ10gb2YgT2JqZWN0LmVudHJpZXModmFsdWUuYXJncykpIHtcbiAgICAgICAgcmVzb2x2ZWRBcmdzW2tleV0gPSByZXNvbHZlUHJvcFZhbHVlKGFyZywgY3R4KTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZuKHJlc29sdmVkQXJncyk7XG4gIH1cblxuICAvLyAkdGVtcGxhdGU6IGludGVycG9sYXRlICR7L3BhdGh9IHJlZmVyZW5jZXMgd2l0aCBzdGF0ZSB2YWx1ZXNcbiAgaWYgKGlzVGVtcGxhdGVFeHByZXNzaW9uKHZhbHVlKSkge1xuICAgIHJldHVybiB2YWx1ZS4kdGVtcGxhdGUucmVwbGFjZShcbiAgICAgIC9cXCRcXHsoW159XSspXFx9L2csXG4gICAgICAoX21hdGNoLCByYXdQYXRoOiBzdHJpbmcpID0+IHtcbiAgICAgICAgbGV0IHBhdGggPSByYXdQYXRoO1xuICAgICAgICBpZiAoIXBhdGguc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgICAgICBpZiAoIXdhcm5lZFRlbXBsYXRlUGF0aHMuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICBpZiAod2FybmVkVGVtcGxhdGVQYXRocy5zaXplIDwgV0FSTkVEX1RFTVBMQVRFX01BWCkge1xuICAgICAgICAgICAgICB3YXJuZWRUZW1wbGF0ZVBhdGhzLmFkZChwYXRoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICAgICAgYCR0ZW1wbGF0ZSBwYXRoIFwiJHtwYXRofVwiIHNob3VsZCBiZSBhIEpTT04gUG9pbnRlciBzdGFydGluZyB3aXRoIFwiL1wiLiBBdXRvbWF0aWNhbGx5IHJlc29sdmluZyBhcyBcIi8ke3BhdGh9XCIuYCxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHBhdGggPSBcIi9cIiArIHBhdGg7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSBnZXRCeVBhdGgoY3R4LnN0YXRlTW9kZWwsIHBhdGgpO1xuICAgICAgICByZXR1cm4gcmVzb2x2ZWQgIT0gbnVsbCA/IFN0cmluZyhyZXNvbHZlZCkgOiBcIlwiO1xuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgLy8gQXJyYXlzOiByZXNvbHZlIGVhY2ggZWxlbWVudFxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUubWFwKChpdGVtKSA9PiByZXNvbHZlUHJvcFZhbHVlKGl0ZW0sIGN0eCkpO1xuICB9XG5cbiAgLy8gUGxhaW4gb2JqZWN0cyAobm90IGV4cHJlc3Npb25zKTogcmVzb2x2ZSBlYWNoIHZhbHVlIHJlY3Vyc2l2ZWx5XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICBjb25zdCByZXNvbHZlZDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbF0gb2YgT2JqZWN0LmVudHJpZXModmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XG4gICAgICByZXNvbHZlZFtrZXldID0gcmVzb2x2ZVByb3BWYWx1ZSh2YWwsIGN0eCk7XG4gICAgfVxuICAgIHJldHVybiByZXNvbHZlZDtcbiAgfVxuXG4gIC8vIFByaW1pdGl2ZSBsaXRlcmFsOiBwYXNzdGhyb3VnaFxuICByZXR1cm4gdmFsdWU7XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhbGwgcHJvcCB2YWx1ZXMgaW4gYW4gZWxlbWVudCdzIHByb3BzIG9iamVjdC5cbiAqIFJldHVybnMgYSBuZXcgcHJvcHMgb2JqZWN0IHdpdGggYWxsIGV4cHJlc3Npb25zIHJlc29sdmVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUVsZW1lbnRQcm9wcyhcbiAgcHJvcHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICBjdHg6IFByb3BSZXNvbHV0aW9uQ29udGV4dCxcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgY29uc3QgcmVzb2x2ZWQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzKSkge1xuICAgIHJlc29sdmVkW2tleV0gPSByZXNvbHZlUHJvcFZhbHVlKHZhbHVlLCBjdHgpO1xuICB9XG4gIHJldHVybiByZXNvbHZlZDtcbn1cblxuLyoqXG4gKiBTY2FuIGFuIGVsZW1lbnQncyByYXcgcHJvcHMgZm9yIGAkYmluZFN0YXRlYCAvIGAkYmluZEl0ZW1gIGV4cHJlc3Npb25zXG4gKiBhbmQgcmV0dXJuIGEgbWFwIG9mIHByb3AgbmFtZSDihpIgcmVzb2x2ZWQgYWJzb2x1dGUgc3RhdGUgcGF0aC5cbiAqXG4gKiBUaGlzIGlzIGNhbGxlZCAqKmJlZm9yZSoqIGByZXNvbHZlRWxlbWVudFByb3BzYCBzbyB0aGUgY29tcG9uZW50IGNhblxuICogcmVjZWl2ZSBib3RoIHRoZSByZXNvbHZlZCB2YWx1ZSAoaW4gYHByb3BzYCkgYW5kIHRoZSB3cml0ZS1iYWNrIHBhdGhcbiAqIChpbiBgYmluZGluZ3NgKS5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGNvbnN0IHJhd1Byb3BzID0geyB2YWx1ZTogeyAkYmluZFN0YXRlOiBcIi9mb3JtL2VtYWlsXCIgfSwgbGFiZWw6IFwiRW1haWxcIiB9O1xuICogY29uc3QgYmluZGluZ3MgPSByZXNvbHZlQmluZGluZ3MocmF3UHJvcHMsIGN0eCk7XG4gKiAvLyBiaW5kaW5ncyA9IHsgdmFsdWU6IFwiL2Zvcm0vZW1haWxcIiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVCaW5kaW5ncyhcbiAgcHJvcHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICBjdHg6IFByb3BSZXNvbHV0aW9uQ29udGV4dCxcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQge1xuICBsZXQgYmluZGluZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQ7XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzKSkge1xuICAgIGlmIChpc0JpbmRTdGF0ZUV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgICBpZiAoIWJpbmRpbmdzKSBiaW5kaW5ncyA9IHt9O1xuICAgICAgYmluZGluZ3Nba2V5XSA9IHZhbHVlLiRiaW5kU3RhdGU7XG4gICAgfSBlbHNlIGlmIChpc0JpbmRJdGVtRXhwcmVzc2lvbih2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZUJpbmRJdGVtUGF0aCh2YWx1ZS4kYmluZEl0ZW0sIGN0eCk7XG4gICAgICBpZiAocmVzb2x2ZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAoIWJpbmRpbmdzKSBiaW5kaW5ncyA9IHt9O1xuICAgICAgICBiaW5kaW5nc1trZXldID0gcmVzb2x2ZWQ7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBiaW5kaW5ncztcbn1cblxuLyoqXG4gKiBSZXNvbHZlIGEgc2luZ2xlIGFjdGlvbiBwYXJhbWV0ZXIgdmFsdWUuXG4gKlxuICogTGlrZSB7QGxpbmsgcmVzb2x2ZVByb3BWYWx1ZX0gYnV0IHdpdGggc3BlY2lhbCBoYW5kbGluZyBmb3IgcGF0aC12YWx1ZWRcbiAqIHBhcmFtczogYHsgJGl0ZW06IFwiZmllbGRcIiB9YCByZXNvbHZlcyB0byBhbiAqKmFic29sdXRlIHN0YXRlIHBhdGgqKlxuICogKGUuZy4gYC90b2Rvcy8wL2ZpZWxkYCkgaW5zdGVhZCBvZiB0aGUgZmllbGQncyB2YWx1ZSwgc28gdGhlIHBhdGggY2FuXG4gKiBiZSBwYXNzZWQgdG8gYHNldFN0YXRlYCAvIGBwdXNoU3RhdGVgIC8gYHJlbW92ZVN0YXRlYC5cbiAqXG4gKiAtIGB7ICRpdGVtOiBcImZpZWxkXCIgfWAg4oaSIGFic29sdXRlIHN0YXRlIHBhdGggdmlhIGByZXBlYXRCYXNlUGF0aGBcbiAqIC0gYHsgJGluZGV4OiB0cnVlIH1gIOKGkiBjdXJyZW50IHJlcGVhdCBpbmRleCAobnVtYmVyKVxuICogLSBFdmVyeXRoaW5nIGVsc2UgZGVsZWdhdGVzIHRvIGByZXNvbHZlUHJvcFZhbHVlYCAoJHN0YXRlLCAkY29uZCwgbGl0ZXJhbHMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUFjdGlvblBhcmFtKFxuICB2YWx1ZTogdW5rbm93bixcbiAgY3R4OiBQcm9wUmVzb2x1dGlvbkNvbnRleHQsXG4pOiB1bmtub3duIHtcbiAgaWYgKGlzSXRlbUV4cHJlc3Npb24odmFsdWUpKSB7XG4gICAgcmV0dXJuIHJlc29sdmVCaW5kSXRlbVBhdGgodmFsdWUuJGl0ZW0sIGN0eCk7XG4gIH1cbiAgaWYgKGlzSW5kZXhFeHByZXNzaW9uKHZhbHVlKSkge1xuICAgIHJldHVybiBjdHgucmVwZWF0SW5kZXg7XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVQcm9wVmFsdWUodmFsdWUsIGN0eCk7XG59XG4iLCAiaW1wb3J0IHsgeiB9IGZyb20gXCJ6b2RcIjtcbmltcG9ydCB0eXBlIHsgRHluYW1pY1ZhbHVlLCBTdGF0ZU1vZGVsIH0gZnJvbSBcIi4vdHlwZXNcIjtcbmltcG9ydCB7IER5bmFtaWNWYWx1ZVNjaGVtYSwgcmVzb2x2ZUR5bmFtaWNWYWx1ZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbi8qKlxuICogQ29uZmlybWF0aW9uIGRpYWxvZyBjb25maWd1cmF0aW9uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQWN0aW9uQ29uZmlybSB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIG1lc3NhZ2U6IHN0cmluZztcbiAgY29uZmlybUxhYmVsPzogc3RyaW5nO1xuICBjYW5jZWxMYWJlbD86IHN0cmluZztcbiAgdmFyaWFudD86IFwiZGVmYXVsdFwiIHwgXCJkYW5nZXJcIjtcbn1cblxuLyoqXG4gKiBBY3Rpb24gc3VjY2VzcyBoYW5kbGVyXG4gKi9cbmV4cG9ydCB0eXBlIEFjdGlvbk9uU3VjY2VzcyA9XG4gIHwgeyBuYXZpZ2F0ZTogc3RyaW5nIH1cbiAgfCB7IHNldDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfVxuICB8IHsgYWN0aW9uOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBBY3Rpb24gZXJyb3IgaGFuZGxlclxuICovXG5leHBvcnQgdHlwZSBBY3Rpb25PbkVycm9yID1cbiAgfCB7IHNldDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfVxuICB8IHsgYWN0aW9uOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBBY3Rpb24gYmluZGluZyDigJQgbWFwcyBhbiBldmVudCB0byBhbiBhY3Rpb24gaW52b2NhdGlvbi5cbiAqXG4gKiBVc2VkIGluc2lkZSB0aGUgYG9uYCBmaWVsZCBvZiBhIFVJRWxlbWVudDpcbiAqIGBgYGpzb25cbiAqIHsgXCJvblwiOiB7IFwicHJlc3NcIjogeyBcImFjdGlvblwiOiBcInNldFN0YXRlXCIsIFwicGFyYW1zXCI6IHsgXCJzdGF0ZVBhdGhcIjogXCIveFwiLCBcInZhbHVlXCI6IDEgfSB9IH0gfVxuICogYGBgXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQWN0aW9uQmluZGluZyB7XG4gIC8qKiBBY3Rpb24gbmFtZSAobXVzdCBiZSBpbiBjYXRhbG9nKSAqL1xuICBhY3Rpb246IHN0cmluZztcbiAgLyoqIFBhcmFtZXRlcnMgdG8gcGFzcyB0byB0aGUgYWN0aW9uIGhhbmRsZXIgKi9cbiAgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgRHluYW1pY1ZhbHVlPjtcbiAgLyoqIENvbmZpcm1hdGlvbiBkaWFsb2cgYmVmb3JlIGV4ZWN1dGlvbiAqL1xuICBjb25maXJtPzogQWN0aW9uQ29uZmlybTtcbiAgLyoqIEhhbmRsZXIgYWZ0ZXIgc3VjY2Vzc2Z1bCBleGVjdXRpb24gKi9cbiAgb25TdWNjZXNzPzogQWN0aW9uT25TdWNjZXNzO1xuICAvKiogSGFuZGxlciBhZnRlciBmYWlsZWQgZXhlY3V0aW9uICovXG4gIG9uRXJyb3I/OiBBY3Rpb25PbkVycm9yO1xuICAvKiogV2hldGhlciB0byBwcmV2ZW50IGRlZmF1bHQgYnJvd3NlciBiZWhhdmlvciAoZS5nLiBuYXZpZ2F0aW9uIG9uIGxpbmtzKSAqL1xuICBwcmV2ZW50RGVmYXVsdD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgVXNlIEFjdGlvbkJpbmRpbmcgaW5zdGVhZFxuICovXG5leHBvcnQgdHlwZSBBY3Rpb24gPSBBY3Rpb25CaW5kaW5nO1xuXG4vKipcbiAqIFNjaGVtYSBmb3IgYWN0aW9uIGNvbmZpcm1hdGlvblxuICovXG5leHBvcnQgY29uc3QgQWN0aW9uQ29uZmlybVNjaGVtYSA9IHoub2JqZWN0KHtcbiAgdGl0bGU6IHouc3RyaW5nKCksXG4gIG1lc3NhZ2U6IHouc3RyaW5nKCksXG4gIGNvbmZpcm1MYWJlbDogei5zdHJpbmcoKS5vcHRpb25hbCgpLFxuICBjYW5jZWxMYWJlbDogei5zdHJpbmcoKS5vcHRpb25hbCgpLFxuICB2YXJpYW50OiB6LmVudW0oW1wiZGVmYXVsdFwiLCBcImRhbmdlclwiXSkub3B0aW9uYWwoKSxcbn0pO1xuXG4vKipcbiAqIFNjaGVtYSBmb3Igc3VjY2VzcyBoYW5kbGVyc1xuICovXG5leHBvcnQgY29uc3QgQWN0aW9uT25TdWNjZXNzU2NoZW1hID0gei51bmlvbihbXG4gIHoub2JqZWN0KHsgbmF2aWdhdGU6IHouc3RyaW5nKCkgfSksXG4gIHoub2JqZWN0KHsgc2V0OiB6LnJlY29yZCh6LnN0cmluZygpLCB6LnVua25vd24oKSkgfSksXG4gIHoub2JqZWN0KHsgYWN0aW9uOiB6LnN0cmluZygpIH0pLFxuXSk7XG5cbi8qKlxuICogU2NoZW1hIGZvciBlcnJvciBoYW5kbGVyc1xuICovXG5leHBvcnQgY29uc3QgQWN0aW9uT25FcnJvclNjaGVtYSA9IHoudW5pb24oW1xuICB6Lm9iamVjdCh7IHNldDogei5yZWNvcmQoei5zdHJpbmcoKSwgei51bmtub3duKCkpIH0pLFxuICB6Lm9iamVjdCh7IGFjdGlvbjogei5zdHJpbmcoKSB9KSxcbl0pO1xuXG4vKipcbiAqIEZ1bGwgYWN0aW9uIGJpbmRpbmcgc2NoZW1hXG4gKi9cbmV4cG9ydCBjb25zdCBBY3Rpb25CaW5kaW5nU2NoZW1hID0gei5vYmplY3Qoe1xuICBhY3Rpb246IHouc3RyaW5nKCksXG4gIHBhcmFtczogei5yZWNvcmQoei5zdHJpbmcoKSwgRHluYW1pY1ZhbHVlU2NoZW1hKS5vcHRpb25hbCgpLFxuICBjb25maXJtOiBBY3Rpb25Db25maXJtU2NoZW1hLm9wdGlvbmFsKCksXG4gIG9uU3VjY2VzczogQWN0aW9uT25TdWNjZXNzU2NoZW1hLm9wdGlvbmFsKCksXG4gIG9uRXJyb3I6IEFjdGlvbk9uRXJyb3JTY2hlbWEub3B0aW9uYWwoKSxcbiAgcHJldmVudERlZmF1bHQ6IHouYm9vbGVhbigpLm9wdGlvbmFsKCksXG59KTtcblxuLyoqXG4gKiBAZGVwcmVjYXRlZCBVc2UgQWN0aW9uQmluZGluZ1NjaGVtYSBpbnN0ZWFkXG4gKi9cbmV4cG9ydCBjb25zdCBBY3Rpb25TY2hlbWEgPSBBY3Rpb25CaW5kaW5nU2NoZW1hO1xuXG4vKipcbiAqIEFjdGlvbiBoYW5kbGVyIGZ1bmN0aW9uIHNpZ25hdHVyZVxuICovXG5leHBvcnQgdHlwZSBBY3Rpb25IYW5kbGVyPFxuICBUUGFyYW1zID0gUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gIFRSZXN1bHQgPSB1bmtub3duLFxuPiA9IChwYXJhbXM6IFRQYXJhbXMpID0+IFByb21pc2U8VFJlc3VsdD4gfCBUUmVzdWx0O1xuXG4vKipcbiAqIEFjdGlvbiBkZWZpbml0aW9uIGluIGNhdGFsb2dcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBY3Rpb25EZWZpbml0aW9uPFRQYXJhbXMgPSBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4ge1xuICAvKiogWm9kIHNjaGVtYSBmb3IgcGFyYW1zIHZhbGlkYXRpb24gKi9cbiAgcGFyYW1zPzogei5ab2RUeXBlPFRQYXJhbXM+O1xuICAvKiogRGVzY3JpcHRpb24gZm9yIEFJICovXG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIFJlc29sdmVkIGFjdGlvbiB3aXRoIGFsbCBkeW5hbWljIHZhbHVlcyByZXNvbHZlZFxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVkQWN0aW9uIHtcbiAgYWN0aW9uOiBzdHJpbmc7XG4gIHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbmZpcm0/OiBBY3Rpb25Db25maXJtO1xuICBvblN1Y2Nlc3M/OiBBY3Rpb25PblN1Y2Nlc3M7XG4gIG9uRXJyb3I/OiBBY3Rpb25PbkVycm9yO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYWxsIGR5bmFtaWMgdmFsdWVzIGluIGFuIGFjdGlvbiBiaW5kaW5nXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlQWN0aW9uKFxuICBiaW5kaW5nOiBBY3Rpb25CaW5kaW5nLFxuICBzdGF0ZU1vZGVsOiBTdGF0ZU1vZGVsLFxuKTogUmVzb2x2ZWRBY3Rpb24ge1xuICBjb25zdCByZXNvbHZlZFBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcblxuICBpZiAoYmluZGluZy5wYXJhbXMpIHtcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhiaW5kaW5nLnBhcmFtcykpIHtcbiAgICAgIHJlc29sdmVkUGFyYW1zW2tleV0gPSByZXNvbHZlRHluYW1pY1ZhbHVlKHZhbHVlLCBzdGF0ZU1vZGVsKTtcbiAgICB9XG4gIH1cblxuICAvLyBJbnRlcnBvbGF0ZSBjb25maXJtYXRpb24gbWVzc2FnZSBpZiBwcmVzZW50XG4gIGxldCBjb25maXJtID0gYmluZGluZy5jb25maXJtO1xuICBpZiAoY29uZmlybSkge1xuICAgIGNvbmZpcm0gPSB7XG4gICAgICAuLi5jb25maXJtLFxuICAgICAgbWVzc2FnZTogaW50ZXJwb2xhdGVTdHJpbmcoY29uZmlybS5tZXNzYWdlLCBzdGF0ZU1vZGVsKSxcbiAgICAgIHRpdGxlOiBpbnRlcnBvbGF0ZVN0cmluZyhjb25maXJtLnRpdGxlLCBzdGF0ZU1vZGVsKSxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBhY3Rpb246IGJpbmRpbmcuYWN0aW9uLFxuICAgIHBhcmFtczogcmVzb2x2ZWRQYXJhbXMsXG4gICAgY29uZmlybSxcbiAgICBvblN1Y2Nlc3M6IGJpbmRpbmcub25TdWNjZXNzLFxuICAgIG9uRXJyb3I6IGJpbmRpbmcub25FcnJvcixcbiAgfTtcbn1cblxuLyoqXG4gKiBJbnRlcnBvbGF0ZSAke3BhdGh9IGV4cHJlc3Npb25zIGluIGEgc3RyaW5nXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbnRlcnBvbGF0ZVN0cmluZyhcbiAgdGVtcGxhdGU6IHN0cmluZyxcbiAgc3RhdGVNb2RlbDogU3RhdGVNb2RlbCxcbik6IHN0cmluZyB7XG4gIHJldHVybiB0ZW1wbGF0ZS5yZXBsYWNlKC9cXCRcXHsoW159XSspXFx9L2csIChfLCBwYXRoKSA9PiB7XG4gICAgY29uc3QgdmFsdWUgPSByZXNvbHZlRHluYW1pY1ZhbHVlKHsgJHN0YXRlOiBwYXRoIH0sIHN0YXRlTW9kZWwpO1xuICAgIHJldHVybiBTdHJpbmcodmFsdWUgPz8gXCJcIik7XG4gIH0pO1xufVxuXG4vKipcbiAqIENvbnRleHQgZm9yIGFjdGlvbiBleGVjdXRpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBY3Rpb25FeGVjdXRpb25Db250ZXh0IHtcbiAgLyoqIFRoZSByZXNvbHZlZCBhY3Rpb24gKi9cbiAgYWN0aW9uOiBSZXNvbHZlZEFjdGlvbjtcbiAgLyoqIFRoZSBhY3Rpb24gaGFuZGxlciBmcm9tIHRoZSBob3N0ICovXG4gIGhhbmRsZXI6IEFjdGlvbkhhbmRsZXI7XG4gIC8qKiBGdW5jdGlvbiB0byB1cGRhdGUgc3RhdGUgbW9kZWwgKi9cbiAgc2V0U3RhdGU6IChwYXRoOiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKSA9PiB2b2lkO1xuICAvKiogRnVuY3Rpb24gdG8gbmF2aWdhdGUgKi9cbiAgbmF2aWdhdGU/OiAocGF0aDogc3RyaW5nKSA9PiB2b2lkO1xuICAvKiogRnVuY3Rpb24gdG8gZXhlY3V0ZSBhbm90aGVyIGFjdGlvbiAqL1xuICBleGVjdXRlQWN0aW9uPzogKG5hbWU6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuLyoqXG4gKiBFeGVjdXRlIGFuIGFjdGlvbiB3aXRoIGFsbCBjYWxsYmFja3NcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGVBY3Rpb24oXG4gIGN0eDogQWN0aW9uRXhlY3V0aW9uQ29udGV4dCxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IGFjdGlvbiwgaGFuZGxlciwgc2V0U3RhdGUsIG5hdmlnYXRlLCBleGVjdXRlQWN0aW9uIH0gPSBjdHg7XG5cbiAgdHJ5IHtcbiAgICBhd2FpdCBoYW5kbGVyKGFjdGlvbi5wYXJhbXMpO1xuXG4gICAgLy8gSGFuZGxlIHN1Y2Nlc3NcbiAgICBpZiAoYWN0aW9uLm9uU3VjY2Vzcykge1xuICAgICAgaWYgKFwibmF2aWdhdGVcIiBpbiBhY3Rpb24ub25TdWNjZXNzICYmIG5hdmlnYXRlKSB7XG4gICAgICAgIG5hdmlnYXRlKGFjdGlvbi5vblN1Y2Nlc3MubmF2aWdhdGUpO1xuICAgICAgfSBlbHNlIGlmIChcInNldFwiIGluIGFjdGlvbi5vblN1Y2Nlc3MpIHtcbiAgICAgICAgZm9yIChjb25zdCBbcGF0aCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGFjdGlvbi5vblN1Y2Nlc3Muc2V0KSkge1xuICAgICAgICAgIHNldFN0YXRlKHBhdGgsIHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChcImFjdGlvblwiIGluIGFjdGlvbi5vblN1Y2Nlc3MgJiYgZXhlY3V0ZUFjdGlvbikge1xuICAgICAgICBhd2FpdCBleGVjdXRlQWN0aW9uKGFjdGlvbi5vblN1Y2Nlc3MuYWN0aW9uKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgLy8gSGFuZGxlIGVycm9yXG4gICAgaWYgKGFjdGlvbi5vbkVycm9yKSB7XG4gICAgICBpZiAoXCJzZXRcIiBpbiBhY3Rpb24ub25FcnJvcikge1xuICAgICAgICBmb3IgKGNvbnN0IFtwYXRoLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYWN0aW9uLm9uRXJyb3Iuc2V0KSkge1xuICAgICAgICAgIC8vIFJlcGxhY2UgJGVycm9yLm1lc3NhZ2Ugd2l0aCBhY3R1YWwgZXJyb3JcbiAgICAgICAgICBjb25zdCByZXNvbHZlZFZhbHVlID1cbiAgICAgICAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZSA9PT0gXCIkZXJyb3IubWVzc2FnZVwiXG4gICAgICAgICAgICAgID8gKGVycm9yIGFzIEVycm9yKS5tZXNzYWdlXG4gICAgICAgICAgICAgIDogdmFsdWU7XG4gICAgICAgICAgc2V0U3RhdGUocGF0aCwgcmVzb2x2ZWRWYWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoXCJhY3Rpb25cIiBpbiBhY3Rpb24ub25FcnJvciAmJiBleGVjdXRlQWN0aW9uKSB7XG4gICAgICAgIGF3YWl0IGV4ZWN1dGVBY3Rpb24oYWN0aW9uLm9uRXJyb3IuYWN0aW9uKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogSGVscGVyIHRvIGNyZWF0ZSBhY3Rpb24gYmluZGluZ3NcbiAqL1xuZXhwb3J0IGNvbnN0IGFjdGlvbkJpbmRpbmcgPSB7XG4gIC8qKiBDcmVhdGUgYSBzaW1wbGUgYWN0aW9uIGJpbmRpbmcgKi9cbiAgc2ltcGxlOiAoXG4gICAgYWN0aW9uTmFtZTogc3RyaW5nLFxuICAgIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIER5bmFtaWNWYWx1ZT4sXG4gICk6IEFjdGlvbkJpbmRpbmcgPT4gKHtcbiAgICBhY3Rpb246IGFjdGlvbk5hbWUsXG4gICAgcGFyYW1zLFxuICB9KSxcblxuICAvKiogQ3JlYXRlIGFuIGFjdGlvbiBiaW5kaW5nIHdpdGggY29uZmlybWF0aW9uICovXG4gIHdpdGhDb25maXJtOiAoXG4gICAgYWN0aW9uTmFtZTogc3RyaW5nLFxuICAgIGNvbmZpcm06IEFjdGlvbkNvbmZpcm0sXG4gICAgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgRHluYW1pY1ZhbHVlPixcbiAgKTogQWN0aW9uQmluZGluZyA9PiAoe1xuICAgIGFjdGlvbjogYWN0aW9uTmFtZSxcbiAgICBwYXJhbXMsXG4gICAgY29uZmlybSxcbiAgfSksXG5cbiAgLyoqIENyZWF0ZSBhbiBhY3Rpb24gYmluZGluZyB3aXRoIHN1Y2Nlc3MgaGFuZGxlciAqL1xuICB3aXRoU3VjY2VzczogKFxuICAgIGFjdGlvbk5hbWU6IHN0cmluZyxcbiAgICBvblN1Y2Nlc3M6IEFjdGlvbk9uU3VjY2VzcyxcbiAgICBwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBEeW5hbWljVmFsdWU+LFxuICApOiBBY3Rpb25CaW5kaW5nID0+ICh7XG4gICAgYWN0aW9uOiBhY3Rpb25OYW1lLFxuICAgIHBhcmFtcyxcbiAgICBvblN1Y2Nlc3MsXG4gIH0pLFxufTtcblxuLyoqXG4gKiBAZGVwcmVjYXRlZCBVc2UgYWN0aW9uQmluZGluZyBpbnN0ZWFkXG4gKi9cbmV4cG9ydCBjb25zdCBhY3Rpb24gPSBhY3Rpb25CaW5kaW5nO1xuIiwgImltcG9ydCB7IHogfSBmcm9tIFwiem9kXCI7XG5pbXBvcnQgdHlwZSB7IER5bmFtaWNWYWx1ZSwgU3RhdGVNb2RlbCwgVmlzaWJpbGl0eUNvbmRpdGlvbiB9IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyBEeW5hbWljVmFsdWVTY2hlbWEsIHJlc29sdmVEeW5hbWljVmFsdWUgfSBmcm9tIFwiLi90eXBlc1wiO1xuaW1wb3J0IHsgVmlzaWJpbGl0eUNvbmRpdGlvblNjaGVtYSwgZXZhbHVhdGVWaXNpYmlsaXR5IH0gZnJvbSBcIi4vdmlzaWJpbGl0eVwiO1xuaW1wb3J0IHsgcmVzb2x2ZVByb3BWYWx1ZSB9IGZyb20gXCIuL3Byb3BzXCI7XG5cbi8qKlxuICogVmFsaWRhdGlvbiBjaGVjayBkZWZpbml0aW9uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVmFsaWRhdGlvbkNoZWNrIHtcbiAgLyoqIFZhbGlkYXRpb24gdHlwZSAoYnVpbHQtaW4gb3IgZnJvbSBjYXRhbG9nKSAqL1xuICB0eXBlOiBzdHJpbmc7XG4gIC8qKiBBZGRpdGlvbmFsIGFyZ3VtZW50cyBmb3IgdGhlIHZhbGlkYXRpb24gKi9cbiAgYXJncz86IFJlY29yZDxzdHJpbmcsIER5bmFtaWNWYWx1ZT47XG4gIC8qKiBFcnJvciBtZXNzYWdlIHRvIGRpc3BsYXkgaWYgY2hlY2sgZmFpbHMgKi9cbiAgbWVzc2FnZTogc3RyaW5nO1xufVxuXG4vKipcbiAqIFZhbGlkYXRpb24gY29uZmlndXJhdGlvbiBmb3IgYSBmaWVsZFxuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhbGlkYXRpb25Db25maWcge1xuICAvKiogQXJyYXkgb2YgY2hlY2tzIHRvIHJ1biAqL1xuICBjaGVja3M/OiBWYWxpZGF0aW9uQ2hlY2tbXTtcbiAgLyoqIFdoZW4gdG8gcnVuIHZhbGlkYXRpb24gKi9cbiAgdmFsaWRhdGVPbj86IFwiY2hhbmdlXCIgfCBcImJsdXJcIiB8IFwic3VibWl0XCI7XG4gIC8qKiBDb25kaXRpb24gZm9yIHdoZW4gdmFsaWRhdGlvbiBpcyBlbmFibGVkICovXG4gIGVuYWJsZWQ/OiBWaXNpYmlsaXR5Q29uZGl0aW9uO1xufVxuXG4vKipcbiAqIFNjaGVtYSBmb3IgdmFsaWRhdGlvbiBjaGVja1xuICovXG5leHBvcnQgY29uc3QgVmFsaWRhdGlvbkNoZWNrU2NoZW1hID0gei5vYmplY3Qoe1xuICB0eXBlOiB6LnN0cmluZygpLFxuICBhcmdzOiB6LnJlY29yZCh6LnN0cmluZygpLCBEeW5hbWljVmFsdWVTY2hlbWEpLm9wdGlvbmFsKCksXG4gIG1lc3NhZ2U6IHouc3RyaW5nKCksXG59KTtcblxuLyoqXG4gKiBTY2hlbWEgZm9yIHZhbGlkYXRpb24gY29uZmlnXG4gKi9cbmV4cG9ydCBjb25zdCBWYWxpZGF0aW9uQ29uZmlnU2NoZW1hID0gei5vYmplY3Qoe1xuICBjaGVja3M6IHouYXJyYXkoVmFsaWRhdGlvbkNoZWNrU2NoZW1hKS5vcHRpb25hbCgpLFxuICB2YWxpZGF0ZU9uOiB6LmVudW0oW1wiY2hhbmdlXCIsIFwiYmx1clwiLCBcInN1Ym1pdFwiXSkub3B0aW9uYWwoKSxcbiAgZW5hYmxlZDogVmlzaWJpbGl0eUNvbmRpdGlvblNjaGVtYS5vcHRpb25hbCgpLFxufSk7XG5cbi8qKlxuICogVmFsaWRhdGlvbiBmdW5jdGlvbiBzaWduYXR1cmVcbiAqL1xuZXhwb3J0IHR5cGUgVmFsaWRhdGlvbkZ1bmN0aW9uID0gKFxuICB2YWx1ZTogdW5rbm93bixcbiAgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuKSA9PiBib29sZWFuO1xuXG4vKipcbiAqIFZhbGlkYXRpb24gZnVuY3Rpb24gZGVmaW5pdGlvbiBpbiBjYXRhbG9nXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVmFsaWRhdGlvbkZ1bmN0aW9uRGVmaW5pdGlvbiB7XG4gIC8qKiBUaGUgdmFsaWRhdGlvbiBmdW5jdGlvbiAqL1xuICB2YWxpZGF0ZTogVmFsaWRhdGlvbkZ1bmN0aW9uO1xuICAvKiogRGVzY3JpcHRpb24gZm9yIEFJICovXG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nO1xufVxuXG5jb25zdCBtYXRjaGVzSW1wbDogVmFsaWRhdGlvbkZ1bmN0aW9uID0gKFxuICB2YWx1ZTogdW5rbm93bixcbiAgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuKSA9PiB7XG4gIGNvbnN0IG90aGVyID0gYXJncz8ub3RoZXI7XG4gIHJldHVybiB2YWx1ZSA9PT0gb3RoZXI7XG59O1xuXG4vKipcbiAqIEJ1aWx0LWluIHZhbGlkYXRpb24gZnVuY3Rpb25zXG4gKi9cbmV4cG9ydCBjb25zdCBidWlsdEluVmFsaWRhdGlvbkZ1bmN0aW9uczogUmVjb3JkPHN0cmluZywgVmFsaWRhdGlvbkZ1bmN0aW9uPiA9IHtcbiAgLyoqXG4gICAqIENoZWNrIGlmIHZhbHVlIGlzIG5vdCBudWxsLCB1bmRlZmluZWQsIG9yIGVtcHR5IHN0cmluZ1xuICAgKi9cbiAgcmVxdWlyZWQ6ICh2YWx1ZTogdW5rbm93bikgPT4ge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHZhbHVlLnRyaW0oKS5sZW5ndGggPiAwO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLmxlbmd0aCA+IDA7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIHZhbHVlIGlzIGEgdmFsaWQgZW1haWwgYWRkcmVzc1xuICAgKi9cbiAgZW1haWw6ICh2YWx1ZTogdW5rbm93bikgPT4ge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gL15bXlxcc0BdK0BbXlxcc0BdK1xcLlteXFxzQF0rJC8udGVzdCh2YWx1ZSk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENoZWNrIG1pbmltdW0gc3RyaW5nIGxlbmd0aFxuICAgKi9cbiAgbWluTGVuZ3RoOiAodmFsdWU6IHVua25vd24sIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4ge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBtaW4gPSBhcmdzPy5taW47XG4gICAgaWYgKHR5cGVvZiBtaW4gIT09IFwibnVtYmVyXCIpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdmFsdWUubGVuZ3RoID49IG1pbjtcbiAgfSxcblxuICAvKipcbiAgICogQ2hlY2sgbWF4aW11bSBzdHJpbmcgbGVuZ3RoXG4gICAqL1xuICBtYXhMZW5ndGg6ICh2YWx1ZTogdW5rbm93biwgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IG1heCA9IGFyZ3M/Lm1heDtcbiAgICBpZiAodHlwZW9mIG1heCAhPT0gXCJudW1iZXJcIikgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB2YWx1ZS5sZW5ndGggPD0gbWF4O1xuICB9LFxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiBzdHJpbmcgbWF0Y2hlcyBhIHJlZ2V4IHBhdHRlcm5cbiAgICovXG4gIHBhdHRlcm46ICh2YWx1ZTogdW5rbm93biwgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IHBhdHRlcm4gPSBhcmdzPy5wYXR0ZXJuO1xuICAgIGlmICh0eXBlb2YgcGF0dGVybiAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlO1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gbmV3IFJlZ0V4cChwYXR0ZXJuKS50ZXN0KHZhbHVlKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH0sXG5cbiAgLyoqXG4gICAqIENoZWNrIG1pbmltdW0gbnVtZXJpYyB2YWx1ZVxuICAgKi9cbiAgbWluOiAodmFsdWU6IHVua25vd24sIGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4ge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIpIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBtaW4gPSBhcmdzPy5taW47XG4gICAgaWYgKHR5cGVvZiBtaW4gIT09IFwibnVtYmVyXCIpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdmFsdWUgPj0gbWluO1xuICB9LFxuXG4gIC8qKlxuICAgKiBDaGVjayBtYXhpbXVtIG51bWVyaWMgdmFsdWVcbiAgICovXG4gIG1heDogKHZhbHVlOiB1bmtub3duLCBhcmdzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgbWF4ID0gYXJncz8ubWF4O1xuICAgIGlmICh0eXBlb2YgbWF4ICE9PSBcIm51bWJlclwiKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHZhbHVlIDw9IG1heDtcbiAgfSxcblxuICAvKipcbiAgICogQ2hlY2sgaWYgdmFsdWUgaXMgYSBudW1iZXJcbiAgICovXG4gIG51bWVyaWM6ICh2YWx1ZTogdW5rbm93bikgPT4ge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiAhaXNOYU4odmFsdWUpO1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHJldHVybiAhaXNOYU4ocGFyc2VGbG9hdCh2YWx1ZSkpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfSxcblxuICAvKipcbiAgICogQ2hlY2sgaWYgdmFsdWUgaXMgYSB2YWxpZCBVUkxcbiAgICovXG4gIHVybDogKHZhbHVlOiB1bmtub3duKSA9PiB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbHNlO1xuICAgIHRyeSB7XG4gICAgICBuZXcgVVJMKHZhbHVlKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogQ2hlY2sgaWYgdmFsdWUgbWF0Y2hlcyBhbm90aGVyIGZpZWxkXG4gICAqL1xuICBtYXRjaGVzOiBtYXRjaGVzSW1wbCxcblxuICAvKipcbiAgICogQWxpYXMgZm9yIG1hdGNoZXMgd2l0aCBhIG1vcmUgZGVzY3JpcHRpdmUgbmFtZSBmb3IgY3Jvc3MtZmllbGQgZXF1YWxpdHlcbiAgICovXG4gIGVxdWFsVG86IG1hdGNoZXNJbXBsLFxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiB2YWx1ZSBpcyBsZXNzIHRoYW4gYW5vdGhlciBmaWVsZCdzIHZhbHVlLlxuICAgKiBTdXBwb3J0cyBudW1iZXJzLCBzdHJpbmdzICh1c2VmdWwgZm9yIElTTyBkYXRlIGNvbXBhcmlzb24pLCBhbmRcbiAgICogY3Jvc3MtdHlwZSBudW1lcmljIGNvZXJjaW9uIChlLmcuIHN0cmluZyBcIjNcIiB2cyBudW1iZXIgNSkuXG4gICAqL1xuICBsZXNzVGhhbjogKHZhbHVlOiB1bmtub3duLCBhcmdzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHtcbiAgICBjb25zdCBvdGhlciA9IGFyZ3M/Lm90aGVyO1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IG90aGVyID09IG51bGwgfHwgdmFsdWUgPT09IFwiXCIgfHwgb3RoZXIgPT09IFwiXCIpXG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2Ygb3RoZXIgPT09IFwibnVtYmVyXCIpXG4gICAgICByZXR1cm4gdmFsdWUgPCBvdGhlcjtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHR5cGVvZiBvdGhlciA9PT0gXCJzdHJpbmdcIilcbiAgICAgIHJldHVybiB2YWx1ZSA8IG90aGVyO1xuICAgIGNvbnN0IG51bVZhbCA9IE51bWJlcih2YWx1ZSk7XG4gICAgY29uc3QgbnVtT3RoZXIgPSBOdW1iZXIob3RoZXIpO1xuICAgIGlmICghaXNOYU4obnVtVmFsKSAmJiAhaXNOYU4obnVtT3RoZXIpKSByZXR1cm4gbnVtVmFsIDwgbnVtT3RoZXI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9LFxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiB2YWx1ZSBpcyBncmVhdGVyIHRoYW4gYW5vdGhlciBmaWVsZCdzIHZhbHVlLlxuICAgKiBTdXBwb3J0cyBudW1iZXJzLCBzdHJpbmdzICh1c2VmdWwgZm9yIElTTyBkYXRlIGNvbXBhcmlzb24pLCBhbmRcbiAgICogY3Jvc3MtdHlwZSBudW1lcmljIGNvZXJjaW9uIChlLmcuIHN0cmluZyBcIjdcIiB2cyBudW1iZXIgNSkuXG4gICAqL1xuICBncmVhdGVyVGhhbjogKHZhbHVlOiB1bmtub3duLCBhcmdzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHtcbiAgICBjb25zdCBvdGhlciA9IGFyZ3M/Lm90aGVyO1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IG90aGVyID09IG51bGwgfHwgdmFsdWUgPT09IFwiXCIgfHwgb3RoZXIgPT09IFwiXCIpXG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2Ygb3RoZXIgPT09IFwibnVtYmVyXCIpXG4gICAgICByZXR1cm4gdmFsdWUgPiBvdGhlcjtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHR5cGVvZiBvdGhlciA9PT0gXCJzdHJpbmdcIilcbiAgICAgIHJldHVybiB2YWx1ZSA+IG90aGVyO1xuICAgIGNvbnN0IG51bVZhbCA9IE51bWJlcih2YWx1ZSk7XG4gICAgY29uc3QgbnVtT3RoZXIgPSBOdW1iZXIob3RoZXIpO1xuICAgIGlmICghaXNOYU4obnVtVmFsKSAmJiAhaXNOYU4obnVtT3RoZXIpKSByZXR1cm4gbnVtVmFsID4gbnVtT3RoZXI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9LFxuXG4gIC8qKlxuICAgKiBSZXF1aXJlZCBvbmx5IHdoZW4gYSBjb25kaXRpb24gaXMgbWV0LlxuICAgKiBVc2VzIEpTIHRydXRoaW5lc3M6IDAsIGZhbHNlLCBcIlwiLCBudWxsLCBhbmQgdW5kZWZpbmVkIGFyZSBhbGxcbiAgICogdHJlYXRlZCBhcyBcImNvbmRpdGlvbiBub3QgbWV0XCIgKGZpZWxkIG5vdCByZXF1aXJlZCksIG1hdGNoaW5nXG4gICAqIHRoZSB2aXNpYmlsaXR5IHN5c3RlbSdzIGJhcmUtY29uZGl0aW9uIHNlbWFudGljcy5cbiAgICovXG4gIHJlcXVpcmVkSWY6ICh2YWx1ZTogdW5rbm93biwgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB7XG4gICAgY29uc3QgY29uZGl0aW9uID0gYXJncz8uZmllbGQ7XG4gICAgaWYgKCFjb25kaXRpb24pIHJldHVybiB0cnVlO1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHZhbHVlLnRyaW0oKS5sZW5ndGggPiAwO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLmxlbmd0aCA+IDA7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG59O1xuXG4vKipcbiAqIFZhbGlkYXRpb24gcmVzdWx0IGZvciBhIHNpbmdsZSBjaGVja1xuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhbGlkYXRpb25DaGVja1Jlc3VsdCB7XG4gIHR5cGU6IHN0cmluZztcbiAgdmFsaWQ6IGJvb2xlYW47XG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLyoqXG4gKiBGdWxsIHZhbGlkYXRpb24gcmVzdWx0IGZvciBhIGZpZWxkXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVmFsaWRhdGlvblJlc3VsdCB7XG4gIHZhbGlkOiBib29sZWFuO1xuICBlcnJvcnM6IHN0cmluZ1tdO1xuICBjaGVja3M6IFZhbGlkYXRpb25DaGVja1Jlc3VsdFtdO1xufVxuXG4vKipcbiAqIENvbnRleHQgZm9yIHJ1bm5pbmcgdmFsaWRhdGlvblxuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhbGlkYXRpb25Db250ZXh0IHtcbiAgLyoqIEN1cnJlbnQgdmFsdWUgdG8gdmFsaWRhdGUgKi9cbiAgdmFsdWU6IHVua25vd247XG4gIC8qKiBGdWxsIGRhdGEgbW9kZWwgZm9yIHJlc29sdmluZyBwYXRocyAqL1xuICBzdGF0ZU1vZGVsOiBTdGF0ZU1vZGVsO1xuICAvKiogQ3VzdG9tIHZhbGlkYXRpb24gZnVuY3Rpb25zIGZyb20gY2F0YWxvZyAqL1xuICBjdXN0b21GdW5jdGlvbnM/OiBSZWNvcmQ8c3RyaW5nLCBWYWxpZGF0aW9uRnVuY3Rpb24+O1xufVxuXG4vKipcbiAqIFJ1biBhIHNpbmdsZSB2YWxpZGF0aW9uIGNoZWNrXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBydW5WYWxpZGF0aW9uQ2hlY2soXG4gIGNoZWNrOiBWYWxpZGF0aW9uQ2hlY2ssXG4gIGN0eDogVmFsaWRhdGlvbkNvbnRleHQsXG4pOiBWYWxpZGF0aW9uQ2hlY2tSZXN1bHQge1xuICBjb25zdCB7IHZhbHVlLCBzdGF0ZU1vZGVsLCBjdXN0b21GdW5jdGlvbnMgfSA9IGN0eDtcblxuICAvLyBSZXNvbHZlIGFyZ3MgdXNpbmcgcmVzb2x2ZVByb3BWYWx1ZSBzbyBuZXN0ZWQgJHN0YXRlIHJlZnMgKGFuZCBhbnkgb3RoZXJcbiAgLy8gcHJvcCBleHByZXNzaW9ucykgYXJlIGhhbmRsZWQgY29uc2lzdGVudGx5IHdpdGggdGhlIHJlc3Qgb2YgdGhlIHN5c3RlbS5cbiAgY29uc3QgcmVzb2x2ZWRBcmdzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICBpZiAoY2hlY2suYXJncykge1xuICAgIGZvciAoY29uc3QgW2tleSwgYXJnVmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGNoZWNrLmFyZ3MpKSB7XG4gICAgICByZXNvbHZlZEFyZ3Nba2V5XSA9IHJlc29sdmVQcm9wVmFsdWUoYXJnVmFsdWUsIHsgc3RhdGVNb2RlbCB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBGaW5kIHRoZSB2YWxpZGF0aW9uIGZ1bmN0aW9uXG4gIGNvbnN0IHZhbGlkYXRpb25GbiA9XG4gICAgYnVpbHRJblZhbGlkYXRpb25GdW5jdGlvbnNbY2hlY2sudHlwZV0gPz8gY3VzdG9tRnVuY3Rpb25zPy5bY2hlY2sudHlwZV07XG5cbiAgaWYgKCF2YWxpZGF0aW9uRm4pIHtcbiAgICBjb25zb2xlLndhcm4oYFVua25vd24gdmFsaWRhdGlvbiBmdW5jdGlvbjogJHtjaGVjay50eXBlfWApO1xuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiBjaGVjay50eXBlLFxuICAgICAgdmFsaWQ6IHRydWUsIC8vIERvbid0IGZhaWwgb24gdW5rbm93biBmdW5jdGlvbnNcbiAgICAgIG1lc3NhZ2U6IGNoZWNrLm1lc3NhZ2UsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IHZhbGlkID0gdmFsaWRhdGlvbkZuKHZhbHVlLCByZXNvbHZlZEFyZ3MpO1xuXG4gIHJldHVybiB7XG4gICAgdHlwZTogY2hlY2sudHlwZSxcbiAgICB2YWxpZCxcbiAgICBtZXNzYWdlOiBjaGVjay5tZXNzYWdlLFxuICB9O1xufVxuXG4vKipcbiAqIFJ1biBhbGwgdmFsaWRhdGlvbiBjaGVja3MgZm9yIGEgZmllbGRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJ1blZhbGlkYXRpb24oXG4gIGNvbmZpZzogVmFsaWRhdGlvbkNvbmZpZyxcbiAgY3R4OiBWYWxpZGF0aW9uQ29udGV4dCxcbik6IFZhbGlkYXRpb25SZXN1bHQge1xuICBjb25zdCBjaGVja3M6IFZhbGlkYXRpb25DaGVja1Jlc3VsdFtdID0gW107XG4gIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcblxuICAvLyBDaGVjayBpZiB2YWxpZGF0aW9uIGlzIGVuYWJsZWRcbiAgaWYgKGNvbmZpZy5lbmFibGVkKSB7XG4gICAgY29uc3QgZW5hYmxlZCA9IGV2YWx1YXRlVmlzaWJpbGl0eShjb25maWcuZW5hYmxlZCwge1xuICAgICAgc3RhdGVNb2RlbDogY3R4LnN0YXRlTW9kZWwsXG4gICAgfSk7XG4gICAgaWYgKCFlbmFibGVkKSB7XG4gICAgICByZXR1cm4geyB2YWxpZDogdHJ1ZSwgZXJyb3JzOiBbXSwgY2hlY2tzOiBbXSB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIFJ1biBlYWNoIGNoZWNrXG4gIGlmIChjb25maWcuY2hlY2tzKSB7XG4gICAgZm9yIChjb25zdCBjaGVjayBvZiBjb25maWcuY2hlY2tzKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBydW5WYWxpZGF0aW9uQ2hlY2soY2hlY2ssIGN0eCk7XG4gICAgICBjaGVja3MucHVzaChyZXN1bHQpO1xuICAgICAgaWYgKCFyZXN1bHQudmFsaWQpIHtcbiAgICAgICAgZXJyb3JzLnB1c2gocmVzdWx0Lm1lc3NhZ2UpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdmFsaWQ6IGVycm9ycy5sZW5ndGggPT09IDAsXG4gICAgZXJyb3JzLFxuICAgIGNoZWNrcyxcbiAgfTtcbn1cblxuLyoqXG4gKiBIZWxwZXIgdG8gY3JlYXRlIHZhbGlkYXRpb24gY2hlY2tzXG4gKi9cbmV4cG9ydCBjb25zdCBjaGVjayA9IHtcbiAgcmVxdWlyZWQ6IChtZXNzYWdlID0gXCJUaGlzIGZpZWxkIGlzIHJlcXVpcmVkXCIpOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcInJlcXVpcmVkXCIsXG4gICAgbWVzc2FnZSxcbiAgfSksXG5cbiAgZW1haWw6IChtZXNzYWdlID0gXCJJbnZhbGlkIGVtYWlsIGFkZHJlc3NcIik6IFZhbGlkYXRpb25DaGVjayA9PiAoe1xuICAgIHR5cGU6IFwiZW1haWxcIixcbiAgICBtZXNzYWdlLFxuICB9KSxcblxuICBtaW5MZW5ndGg6IChtaW46IG51bWJlciwgbWVzc2FnZT86IHN0cmluZyk6IFZhbGlkYXRpb25DaGVjayA9PiAoe1xuICAgIHR5cGU6IFwibWluTGVuZ3RoXCIsXG4gICAgYXJnczogeyBtaW4gfSxcbiAgICBtZXNzYWdlOiBtZXNzYWdlID8/IGBNdXN0IGJlIGF0IGxlYXN0ICR7bWlufSBjaGFyYWN0ZXJzYCxcbiAgfSksXG5cbiAgbWF4TGVuZ3RoOiAobWF4OiBudW1iZXIsIG1lc3NhZ2U/OiBzdHJpbmcpOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcIm1heExlbmd0aFwiLFxuICAgIGFyZ3M6IHsgbWF4IH0sXG4gICAgbWVzc2FnZTogbWVzc2FnZSA/PyBgTXVzdCBiZSBhdCBtb3N0ICR7bWF4fSBjaGFyYWN0ZXJzYCxcbiAgfSksXG5cbiAgcGF0dGVybjogKHBhdHRlcm46IHN0cmluZywgbWVzc2FnZSA9IFwiSW52YWxpZCBmb3JtYXRcIik6IFZhbGlkYXRpb25DaGVjayA9PiAoe1xuICAgIHR5cGU6IFwicGF0dGVyblwiLFxuICAgIGFyZ3M6IHsgcGF0dGVybiB9LFxuICAgIG1lc3NhZ2UsXG4gIH0pLFxuXG4gIG1pbjogKG1pbjogbnVtYmVyLCBtZXNzYWdlPzogc3RyaW5nKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJtaW5cIixcbiAgICBhcmdzOiB7IG1pbiB9LFxuICAgIG1lc3NhZ2U6IG1lc3NhZ2UgPz8gYE11c3QgYmUgYXQgbGVhc3QgJHttaW59YCxcbiAgfSksXG5cbiAgbWF4OiAobWF4OiBudW1iZXIsIG1lc3NhZ2U/OiBzdHJpbmcpOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcIm1heFwiLFxuICAgIGFyZ3M6IHsgbWF4IH0sXG4gICAgbWVzc2FnZTogbWVzc2FnZSA/PyBgTXVzdCBiZSBhdCBtb3N0ICR7bWF4fWAsXG4gIH0pLFxuXG4gIHVybDogKG1lc3NhZ2UgPSBcIkludmFsaWQgVVJMXCIpOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcInVybFwiLFxuICAgIG1lc3NhZ2UsXG4gIH0pLFxuXG4gIG51bWVyaWM6IChtZXNzYWdlID0gXCJNdXN0IGJlIGEgbnVtYmVyXCIpOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcIm51bWVyaWNcIixcbiAgICBtZXNzYWdlLFxuICB9KSxcblxuICBtYXRjaGVzOiAoXG4gICAgb3RoZXJQYXRoOiBzdHJpbmcsXG4gICAgbWVzc2FnZSA9IFwiRmllbGRzIG11c3QgbWF0Y2hcIixcbiAgKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJtYXRjaGVzXCIsXG4gICAgYXJnczogeyBvdGhlcjogeyAkc3RhdGU6IG90aGVyUGF0aCB9IH0sXG4gICAgbWVzc2FnZSxcbiAgfSksXG5cbiAgZXF1YWxUbzogKFxuICAgIG90aGVyUGF0aDogc3RyaW5nLFxuICAgIG1lc3NhZ2UgPSBcIkZpZWxkcyBtdXN0IG1hdGNoXCIsXG4gICk6IFZhbGlkYXRpb25DaGVjayA9PiAoe1xuICAgIHR5cGU6IFwiZXF1YWxUb1wiLFxuICAgIGFyZ3M6IHsgb3RoZXI6IHsgJHN0YXRlOiBvdGhlclBhdGggfSB9LFxuICAgIG1lc3NhZ2UsXG4gIH0pLFxuXG4gIGxlc3NUaGFuOiAob3RoZXJQYXRoOiBzdHJpbmcsIG1lc3NhZ2U/OiBzdHJpbmcpOiBWYWxpZGF0aW9uQ2hlY2sgPT4gKHtcbiAgICB0eXBlOiBcImxlc3NUaGFuXCIsXG4gICAgYXJnczogeyBvdGhlcjogeyAkc3RhdGU6IG90aGVyUGF0aCB9IH0sXG4gICAgbWVzc2FnZTogbWVzc2FnZSA/PyBcIk11c3QgYmUgbGVzcyB0aGFuIHRoZSBjb21wYXJlZCBmaWVsZFwiLFxuICB9KSxcblxuICBncmVhdGVyVGhhbjogKG90aGVyUGF0aDogc3RyaW5nLCBtZXNzYWdlPzogc3RyaW5nKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJncmVhdGVyVGhhblwiLFxuICAgIGFyZ3M6IHsgb3RoZXI6IHsgJHN0YXRlOiBvdGhlclBhdGggfSB9LFxuICAgIG1lc3NhZ2U6IG1lc3NhZ2UgPz8gXCJNdXN0IGJlIGdyZWF0ZXIgdGhhbiB0aGUgY29tcGFyZWQgZmllbGRcIixcbiAgfSksXG5cbiAgcmVxdWlyZWRJZjogKFxuICAgIGZpZWxkUGF0aDogc3RyaW5nLFxuICAgIG1lc3NhZ2UgPSBcIlRoaXMgZmllbGQgaXMgcmVxdWlyZWRcIixcbiAgKTogVmFsaWRhdGlvbkNoZWNrID0+ICh7XG4gICAgdHlwZTogXCJyZXF1aXJlZElmXCIsXG4gICAgYXJnczogeyBmaWVsZDogeyAkc3RhdGU6IGZpZWxkUGF0aCB9IH0sXG4gICAgbWVzc2FnZSxcbiAgfSksXG59O1xuIiwgImltcG9ydCB0eXBlIHsgU3BlYywgVUlFbGVtZW50IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNwZWMgU3RydWN0dXJhbCBWYWxpZGF0aW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFNldmVyaXR5IGxldmVsIGZvciB2YWxpZGF0aW9uIGlzc3Vlcy5cbiAqL1xuZXhwb3J0IHR5cGUgU3BlY0lzc3VlU2V2ZXJpdHkgPSBcImVycm9yXCIgfCBcIndhcm5pbmdcIjtcblxuLyoqXG4gKiBBIHNpbmdsZSB2YWxpZGF0aW9uIGlzc3VlIGZvdW5kIGluIGEgc3BlYy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGVjSXNzdWUge1xuICAvKiogU2V2ZXJpdHk6IGVycm9ycyBzaG91bGQgYmUgZml4ZWQsIHdhcm5pbmdzIGFyZSBpbmZvcm1hdGlvbmFsICovXG4gIHNldmVyaXR5OiBTcGVjSXNzdWVTZXZlcml0eTtcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIGRlc2NyaXB0aW9uIG9mIHRoZSBpc3N1ZSAqL1xuICBtZXNzYWdlOiBzdHJpbmc7XG4gIC8qKiBUaGUgZWxlbWVudCBrZXkgd2hlcmUgdGhlIGlzc3VlIHdhcyBmb3VuZCAoaWYgYXBwbGljYWJsZSkgKi9cbiAgZWxlbWVudEtleT86IHN0cmluZztcbiAgLyoqIE1hY2hpbmUtcmVhZGFibGUgaXNzdWUgY29kZSBmb3IgcHJvZ3JhbW1hdGljIGhhbmRsaW5nICovXG4gIGNvZGU6XG4gICAgfCBcIm1pc3Npbmdfcm9vdFwiXG4gICAgfCBcInJvb3Rfbm90X2ZvdW5kXCJcbiAgICB8IFwibWlzc2luZ19jaGlsZFwiXG4gICAgfCBcInZpc2libGVfaW5fcHJvcHNcIlxuICAgIHwgXCJvcnBoYW5lZF9lbGVtZW50XCJcbiAgICB8IFwiZW1wdHlfc3BlY1wiXG4gICAgfCBcIm9uX2luX3Byb3BzXCJcbiAgICB8IFwicmVwZWF0X2luX3Byb3BzXCJcbiAgICB8IFwid2F0Y2hfaW5fcHJvcHNcIjtcbn1cblxuLyoqXG4gKiBSZXN1bHQgb2Ygc3BlYyBzdHJ1Y3R1cmFsIHZhbGlkYXRpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BlY1ZhbGlkYXRpb25Jc3N1ZXMge1xuICAvKiogV2hldGhlciB0aGUgc3BlYyBwYXNzZWQgdmFsaWRhdGlvbiAobm8gZXJyb3JzOyB3YXJuaW5ncyBhcmUgT0spICovXG4gIHZhbGlkOiBib29sZWFuO1xuICAvKiogTGlzdCBvZiBpc3N1ZXMgZm91bmQgKi9cbiAgaXNzdWVzOiBTcGVjSXNzdWVbXTtcbn1cblxuLyoqXG4gKiBPcHRpb25zIGZvciB2YWxpZGF0ZVNwZWMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVmFsaWRhdGVTcGVjT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGNoZWNrIGZvciBvcnBoYW5lZCBlbGVtZW50cyAoZWxlbWVudHMgbm90IHJlYWNoYWJsZSBmcm9tIHJvb3QpLlxuICAgKiBEZWZhdWx0cyB0byBmYWxzZSBzaW5jZSBvcnBoYW5zIGFyZSBoYXJtbGVzcyAoanVzdCB1bnVzZWQpLlxuICAgKi9cbiAgY2hlY2tPcnBoYW5zPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZSBhIHNwZWMgZm9yIHN0cnVjdHVyYWwgaW50ZWdyaXR5LlxuICpcbiAqIENoZWNrcyBmb3IgY29tbW9uIEFJLWdlbmVyYXRpb24gZXJyb3JzOlxuICogLSBNaXNzaW5nIG9yIGVtcHR5IHJvb3RcbiAqIC0gUm9vdCBlbGVtZW50IG5vdCBmb3VuZCBpbiBlbGVtZW50cyBtYXBcbiAqIC0gQ2hpbGRyZW4gcmVmZXJlbmNpbmcgbm9uLWV4aXN0ZW50IGVsZW1lbnRzXG4gKiAtIGB2aXNpYmxlYCBwbGFjZWQgaW5zaWRlIGBwcm9wc2AgaW5zdGVhZCBvZiBvbiB0aGUgZWxlbWVudFxuICogLSBPcnBoYW5lZCBlbGVtZW50cyAob3B0aW9uYWwpXG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBjb25zdCByZXN1bHQgPSB2YWxpZGF0ZVNwZWMoc3BlYyk7XG4gKiBpZiAoIXJlc3VsdC52YWxpZCkge1xuICogICBjb25zb2xlLmxvZyhcIlNwZWMgZXJyb3JzOlwiLCByZXN1bHQuaXNzdWVzKTtcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVTcGVjKFxuICBzcGVjOiBTcGVjLFxuICBvcHRpb25zOiBWYWxpZGF0ZVNwZWNPcHRpb25zID0ge30sXG4pOiBTcGVjVmFsaWRhdGlvbklzc3VlcyB7XG4gIGNvbnN0IHsgY2hlY2tPcnBoYW5zID0gZmFsc2UgfSA9IG9wdGlvbnM7XG4gIGNvbnN0IGlzc3VlczogU3BlY0lzc3VlW10gPSBbXTtcblxuICAvLyAxLiBDaGVjayByb290XG4gIGlmICghc3BlYy5yb290KSB7XG4gICAgaXNzdWVzLnB1c2goe1xuICAgICAgc2V2ZXJpdHk6IFwiZXJyb3JcIixcbiAgICAgIG1lc3NhZ2U6IFwiU3BlYyBoYXMgbm8gcm9vdCBlbGVtZW50IGRlZmluZWQuXCIsXG4gICAgICBjb2RlOiBcIm1pc3Npbmdfcm9vdFwiLFxuICAgIH0pO1xuICAgIHJldHVybiB7IHZhbGlkOiBmYWxzZSwgaXNzdWVzIH07XG4gIH1cblxuICBpZiAoIXNwZWMuZWxlbWVudHNbc3BlYy5yb290XSkge1xuICAgIGlzc3Vlcy5wdXNoKHtcbiAgICAgIHNldmVyaXR5OiBcImVycm9yXCIsXG4gICAgICBtZXNzYWdlOiBgUm9vdCBlbGVtZW50IFwiJHtzcGVjLnJvb3R9XCIgbm90IGZvdW5kIGluIGVsZW1lbnRzIG1hcC5gLFxuICAgICAgY29kZTogXCJyb290X25vdF9mb3VuZFwiLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gMi4gQ2hlY2sgZm9yIGVtcHR5IHNwZWNcbiAgaWYgKE9iamVjdC5rZXlzKHNwZWMuZWxlbWVudHMpLmxlbmd0aCA9PT0gMCkge1xuICAgIGlzc3Vlcy5wdXNoKHtcbiAgICAgIHNldmVyaXR5OiBcImVycm9yXCIsXG4gICAgICBtZXNzYWdlOiBcIlNwZWMgaGFzIG5vIGVsZW1lbnRzLlwiLFxuICAgICAgY29kZTogXCJlbXB0eV9zcGVjXCIsXG4gICAgfSk7XG4gICAgcmV0dXJuIHsgdmFsaWQ6IGZhbHNlLCBpc3N1ZXMgfTtcbiAgfVxuXG4gIC8vIDMuIENoZWNrIGVhY2ggZWxlbWVudFxuICBmb3IgKGNvbnN0IFtrZXksIGVsZW1lbnRdIG9mIE9iamVjdC5lbnRyaWVzKHNwZWMuZWxlbWVudHMpKSB7XG4gICAgLy8gM2EuIE1pc3NpbmcgY2hpbGRyZW5cbiAgICBpZiAoZWxlbWVudC5jaGlsZHJlbikge1xuICAgICAgZm9yIChjb25zdCBjaGlsZEtleSBvZiBlbGVtZW50LmNoaWxkcmVuKSB7XG4gICAgICAgIGlmICghc3BlYy5lbGVtZW50c1tjaGlsZEtleV0pIHtcbiAgICAgICAgICBpc3N1ZXMucHVzaCh7XG4gICAgICAgICAgICBzZXZlcml0eTogXCJlcnJvclwiLFxuICAgICAgICAgICAgbWVzc2FnZTogYEVsZW1lbnQgXCIke2tleX1cIiByZWZlcmVuY2VzIGNoaWxkIFwiJHtjaGlsZEtleX1cIiB3aGljaCBkb2VzIG5vdCBleGlzdCBpbiB0aGUgZWxlbWVudHMgbWFwLmAsXG4gICAgICAgICAgICBlbGVtZW50S2V5OiBrZXksXG4gICAgICAgICAgICBjb2RlOiBcIm1pc3NpbmdfY2hpbGRcIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIDNiLiBgdmlzaWJsZWAgaW5zaWRlIHByb3BzXG4gICAgY29uc3QgcHJvcHMgPSBlbGVtZW50LnByb3BzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgIGlmIChwcm9wcyAmJiBcInZpc2libGVcIiBpbiBwcm9wcyAmJiBwcm9wcy52aXNpYmxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlzc3Vlcy5wdXNoKHtcbiAgICAgICAgc2V2ZXJpdHk6IFwiZXJyb3JcIixcbiAgICAgICAgbWVzc2FnZTogYEVsZW1lbnQgXCIke2tleX1cIiBoYXMgXCJ2aXNpYmxlXCIgaW5zaWRlIFwicHJvcHNcIi4gSXQgc2hvdWxkIGJlIGEgdG9wLWxldmVsIGZpZWxkIG9uIHRoZSBlbGVtZW50IChzaWJsaW5nIG9mIHR5cGUvcHJvcHMvY2hpbGRyZW4pLmAsXG4gICAgICAgIGVsZW1lbnRLZXk6IGtleSxcbiAgICAgICAgY29kZTogXCJ2aXNpYmxlX2luX3Byb3BzXCIsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAzYy4gYG9uYCBpbnNpZGUgcHJvcHMgKHNob3VsZCBiZSBhIHRvcC1sZXZlbCBmaWVsZClcbiAgICBpZiAocHJvcHMgJiYgXCJvblwiIGluIHByb3BzICYmIHByb3BzLm9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlzc3Vlcy5wdXNoKHtcbiAgICAgICAgc2V2ZXJpdHk6IFwiZXJyb3JcIixcbiAgICAgICAgbWVzc2FnZTogYEVsZW1lbnQgXCIke2tleX1cIiBoYXMgXCJvblwiIGluc2lkZSBcInByb3BzXCIuIEl0IHNob3VsZCBiZSBhIHRvcC1sZXZlbCBmaWVsZCBvbiB0aGUgZWxlbWVudCAoc2libGluZyBvZiB0eXBlL3Byb3BzL2NoaWxkcmVuKS5gLFxuICAgICAgICBlbGVtZW50S2V5OiBrZXksXG4gICAgICAgIGNvZGU6IFwib25faW5fcHJvcHNcIixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIDNkLiBgcmVwZWF0YCBpbnNpZGUgcHJvcHMgKHNob3VsZCBiZSBhIHRvcC1sZXZlbCBmaWVsZClcbiAgICBpZiAocHJvcHMgJiYgXCJyZXBlYXRcIiBpbiBwcm9wcyAmJiBwcm9wcy5yZXBlYXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaXNzdWVzLnB1c2goe1xuICAgICAgICBzZXZlcml0eTogXCJlcnJvclwiLFxuICAgICAgICBtZXNzYWdlOiBgRWxlbWVudCBcIiR7a2V5fVwiIGhhcyBcInJlcGVhdFwiIGluc2lkZSBcInByb3BzXCIuIEl0IHNob3VsZCBiZSBhIHRvcC1sZXZlbCBmaWVsZCBvbiB0aGUgZWxlbWVudCAoc2libGluZyBvZiB0eXBlL3Byb3BzL2NoaWxkcmVuKS5gLFxuICAgICAgICBlbGVtZW50S2V5OiBrZXksXG4gICAgICAgIGNvZGU6IFwicmVwZWF0X2luX3Byb3BzXCIsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAzZS4gYHdhdGNoYCBpbnNpZGUgcHJvcHMgKHNob3VsZCBiZSBhIHRvcC1sZXZlbCBmaWVsZClcbiAgICBpZiAocHJvcHMgJiYgXCJ3YXRjaFwiIGluIHByb3BzICYmIHByb3BzLndhdGNoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlzc3Vlcy5wdXNoKHtcbiAgICAgICAgc2V2ZXJpdHk6IFwiZXJyb3JcIixcbiAgICAgICAgbWVzc2FnZTogYEVsZW1lbnQgXCIke2tleX1cIiBoYXMgXCJ3YXRjaFwiIGluc2lkZSBcInByb3BzXCIuIEl0IHNob3VsZCBiZSBhIHRvcC1sZXZlbCBmaWVsZCBvbiB0aGUgZWxlbWVudCAoc2libGluZyBvZiB0eXBlL3Byb3BzL2NoaWxkcmVuKS5gLFxuICAgICAgICBlbGVtZW50S2V5OiBrZXksXG4gICAgICAgIGNvZGU6IFwid2F0Y2hfaW5fcHJvcHNcIixcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIDQuIE9ycGhhbmVkIGVsZW1lbnRzIChvcHRpb25hbClcbiAgaWYgKGNoZWNrT3JwaGFucykge1xuICAgIGNvbnN0IHJlYWNoYWJsZSA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGNvbnN0IHdhbGsgPSAoa2V5OiBzdHJpbmcpID0+IHtcbiAgICAgIGlmIChyZWFjaGFibGUuaGFzKGtleSkpIHJldHVybjtcbiAgICAgIHJlYWNoYWJsZS5hZGQoa2V5KTtcbiAgICAgIGNvbnN0IGVsID0gc3BlYy5lbGVtZW50c1trZXldO1xuICAgICAgaWYgKGVsPy5jaGlsZHJlbikge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkS2V5IG9mIGVsLmNoaWxkcmVuKSB7XG4gICAgICAgICAgaWYgKHNwZWMuZWxlbWVudHNbY2hpbGRLZXldKSB7XG4gICAgICAgICAgICB3YWxrKGNoaWxkS2V5KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICAgIGlmIChzcGVjLmVsZW1lbnRzW3NwZWMucm9vdF0pIHtcbiAgICAgIHdhbGsoc3BlYy5yb290KTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhzcGVjLmVsZW1lbnRzKSkge1xuICAgICAgaWYgKCFyZWFjaGFibGUuaGFzKGtleSkpIHtcbiAgICAgICAgaXNzdWVzLnB1c2goe1xuICAgICAgICAgIHNldmVyaXR5OiBcIndhcm5pbmdcIixcbiAgICAgICAgICBtZXNzYWdlOiBgRWxlbWVudCBcIiR7a2V5fVwiIGlzIG5vdCByZWFjaGFibGUgZnJvbSByb290IFwiJHtzcGVjLnJvb3R9XCIuYCxcbiAgICAgICAgICBlbGVtZW50S2V5OiBrZXksXG4gICAgICAgICAgY29kZTogXCJvcnBoYW5lZF9lbGVtZW50XCIsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGhhc0Vycm9ycyA9IGlzc3Vlcy5zb21lKChpKSA9PiBpLnNldmVyaXR5ID09PSBcImVycm9yXCIpO1xuICByZXR1cm4geyB2YWxpZDogIWhhc0Vycm9ycywgaXNzdWVzIH07XG59XG5cbi8qKlxuICogQXV0by1maXggY29tbW9uIHNwZWMgaXNzdWVzIGluLXBsYWNlIGFuZCByZXR1cm4gYSBjb3JyZWN0ZWQgY29weS5cbiAqXG4gKiBDdXJyZW50bHkgZml4ZXM6XG4gKiAtIGB2aXNpYmxlYCBpbnNpZGUgYHByb3BzYCDihpIgbW92ZWQgdG8gZWxlbWVudCBsZXZlbFxuICogLSBgb25gIGluc2lkZSBgcHJvcHNgIOKGkiBtb3ZlZCB0byBlbGVtZW50IGxldmVsXG4gKiAtIGByZXBlYXRgIGluc2lkZSBgcHJvcHNgIOKGkiBtb3ZlZCB0byBlbGVtZW50IGxldmVsXG4gKlxuICogUmV0dXJucyB0aGUgZml4ZWQgc3BlYyBhbmQgYSBsaXN0IG9mIGZpeGVzIGFwcGxpZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhdXRvRml4U3BlYyhzcGVjOiBTcGVjKToge1xuICBzcGVjOiBTcGVjO1xuICBmaXhlczogc3RyaW5nW107XG59IHtcbiAgY29uc3QgZml4ZXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGZpeGVkRWxlbWVudHM6IFJlY29yZDxzdHJpbmcsIFVJRWxlbWVudD4gPSB7fTtcblxuICBmb3IgKGNvbnN0IFtrZXksIGVsZW1lbnRdIG9mIE9iamVjdC5lbnRyaWVzKHNwZWMuZWxlbWVudHMpKSB7XG4gICAgY29uc3QgcHJvcHMgPSBlbGVtZW50LnByb3BzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgIGxldCBmaXhlZCA9IGVsZW1lbnQ7XG5cbiAgICBpZiAocHJvcHMgJiYgXCJ2aXNpYmxlXCIgaW4gcHJvcHMgJiYgcHJvcHMudmlzaWJsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBNb3ZlIHZpc2libGUgZnJvbSBwcm9wcyB0byBlbGVtZW50IGxldmVsXG4gICAgICBjb25zdCB7IHZpc2libGUsIC4uLnJlc3RQcm9wcyB9ID0gZml4ZWQucHJvcHMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBmaXhlZCA9IHtcbiAgICAgICAgLi4uZml4ZWQsXG4gICAgICAgIHByb3BzOiByZXN0UHJvcHMsXG4gICAgICAgIHZpc2libGU6IHZpc2libGUgYXMgVUlFbGVtZW50W1widmlzaWJsZVwiXSxcbiAgICAgIH07XG4gICAgICBmaXhlcy5wdXNoKGBNb3ZlZCBcInZpc2libGVcIiBmcm9tIHByb3BzIHRvIGVsZW1lbnQgbGV2ZWwgb24gXCIke2tleX1cIi5gKTtcbiAgICB9XG5cbiAgICBsZXQgY3VycmVudFByb3BzID0gZml4ZWQucHJvcHMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgaWYgKGN1cnJlbnRQcm9wcyAmJiBcIm9uXCIgaW4gY3VycmVudFByb3BzICYmIGN1cnJlbnRQcm9wcy5vbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBNb3ZlIG9uIGZyb20gcHJvcHMgdG8gZWxlbWVudCBsZXZlbFxuICAgICAgY29uc3QgeyBvbiwgLi4ucmVzdFByb3BzIH0gPSBjdXJyZW50UHJvcHM7XG4gICAgICBmaXhlZCA9IHtcbiAgICAgICAgLi4uZml4ZWQsXG4gICAgICAgIHByb3BzOiByZXN0UHJvcHMsXG4gICAgICAgIG9uOiBvbiBhcyBVSUVsZW1lbnRbXCJvblwiXSxcbiAgICAgIH07XG4gICAgICBmaXhlcy5wdXNoKGBNb3ZlZCBcIm9uXCIgZnJvbSBwcm9wcyB0byBlbGVtZW50IGxldmVsIG9uIFwiJHtrZXl9XCIuYCk7XG4gICAgfVxuXG4gICAgY3VycmVudFByb3BzID0gZml4ZWQucHJvcHMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgaWYgKFxuICAgICAgY3VycmVudFByb3BzICYmXG4gICAgICBcInJlcGVhdFwiIGluIGN1cnJlbnRQcm9wcyAmJlxuICAgICAgY3VycmVudFByb3BzLnJlcGVhdCAhPT0gdW5kZWZpbmVkXG4gICAgKSB7XG4gICAgICAvLyBNb3ZlIHJlcGVhdCBmcm9tIHByb3BzIHRvIGVsZW1lbnQgbGV2ZWxcbiAgICAgIGNvbnN0IHsgcmVwZWF0LCAuLi5yZXN0UHJvcHMgfSA9IGN1cnJlbnRQcm9wcztcbiAgICAgIGZpeGVkID0ge1xuICAgICAgICAuLi5maXhlZCxcbiAgICAgICAgcHJvcHM6IHJlc3RQcm9wcyxcbiAgICAgICAgcmVwZWF0OiByZXBlYXQgYXMgVUlFbGVtZW50W1wicmVwZWF0XCJdLFxuICAgICAgfTtcbiAgICAgIGZpeGVzLnB1c2goYE1vdmVkIFwicmVwZWF0XCIgZnJvbSBwcm9wcyB0byBlbGVtZW50IGxldmVsIG9uIFwiJHtrZXl9XCIuYCk7XG4gICAgfVxuXG4gICAgY3VycmVudFByb3BzID0gZml4ZWQucHJvcHMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgaWYgKFxuICAgICAgY3VycmVudFByb3BzICYmXG4gICAgICBcIndhdGNoXCIgaW4gY3VycmVudFByb3BzICYmXG4gICAgICBjdXJyZW50UHJvcHMud2F0Y2ggIT09IHVuZGVmaW5lZFxuICAgICkge1xuICAgICAgY29uc3QgeyB3YXRjaCwgLi4ucmVzdFByb3BzIH0gPSBjdXJyZW50UHJvcHM7XG4gICAgICBmaXhlZCA9IHtcbiAgICAgICAgLi4uZml4ZWQsXG4gICAgICAgIHByb3BzOiByZXN0UHJvcHMsXG4gICAgICAgIHdhdGNoOiB3YXRjaCBhcyBVSUVsZW1lbnRbXCJ3YXRjaFwiXSxcbiAgICAgIH07XG4gICAgICBmaXhlcy5wdXNoKGBNb3ZlZCBcIndhdGNoXCIgZnJvbSBwcm9wcyB0byBlbGVtZW50IGxldmVsIG9uIFwiJHtrZXl9XCIuYCk7XG4gICAgfVxuXG4gICAgZml4ZWRFbGVtZW50c1trZXldID0gZml4ZWQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHNwZWM6IHsgcm9vdDogc3BlYy5yb290LCBlbGVtZW50czogZml4ZWRFbGVtZW50cywgc3RhdGU6IHNwZWMuc3RhdGUgfSxcbiAgICBmaXhlcyxcbiAgfTtcbn1cblxuLyoqXG4gKiBGb3JtYXQgdmFsaWRhdGlvbiBpc3N1ZXMgaW50byBhIGh1bWFuLXJlYWRhYmxlIHN0cmluZyBzdWl0YWJsZSBmb3JcbiAqIGluY2x1c2lvbiBpbiBhIHJlcGFpciBwcm9tcHQgc2VudCBiYWNrIHRvIHRoZSBBSS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFNwZWNJc3N1ZXMoaXNzdWVzOiBTcGVjSXNzdWVbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGVycm9ycyA9IGlzc3Vlcy5maWx0ZXIoKGkpID0+IGkuc2V2ZXJpdHkgPT09IFwiZXJyb3JcIik7XG4gIGlmIChlcnJvcnMubGVuZ3RoID09PSAwKSByZXR1cm4gXCJcIjtcblxuICBjb25zdCBsaW5lcyA9IFtcIlRoZSBnZW5lcmF0ZWQgVUkgc3BlYyBoYXMgdGhlIGZvbGxvd2luZyBlcnJvcnM6XCJdO1xuICBmb3IgKGNvbnN0IGlzc3VlIG9mIGVycm9ycykge1xuICAgIGxpbmVzLnB1c2goYC0gJHtpc3N1ZS5tZXNzYWdlfWApO1xuICB9XG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xufVxuIiwgImltcG9ydCB7IHogfSBmcm9tIFwiem9kXCI7XG5cbi8qKlxuICogU2NoZW1hIGJ1aWxkZXIgcHJpbWl0aXZlc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIFNjaGVtYUJ1aWxkZXIge1xuICAvKiogU3RyaW5nIHR5cGUgKi9cbiAgc3RyaW5nKCk6IFNjaGVtYVR5cGU8XCJzdHJpbmdcIj47XG4gIC8qKiBOdW1iZXIgdHlwZSAqL1xuICBudW1iZXIoKTogU2NoZW1hVHlwZTxcIm51bWJlclwiPjtcbiAgLyoqIEJvb2xlYW4gdHlwZSAqL1xuICBib29sZWFuKCk6IFNjaGVtYVR5cGU8XCJib29sZWFuXCI+O1xuICAvKiogQXJyYXkgb2YgdHlwZSAqL1xuICBhcnJheTxUIGV4dGVuZHMgU2NoZW1hVHlwZT4oaXRlbTogVCk6IFNjaGVtYVR5cGU8XCJhcnJheVwiLCBUPjtcbiAgLyoqIE9iamVjdCB3aXRoIHNoYXBlICovXG4gIG9iamVjdDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgU2NoZW1hVHlwZT4+KFxuICAgIHNoYXBlOiBULFxuICApOiBTY2hlbWFUeXBlPFwib2JqZWN0XCIsIFQ+O1xuICAvKiogUmVjb3JkL21hcCB3aXRoIHZhbHVlIHR5cGUgKi9cbiAgcmVjb3JkPFQgZXh0ZW5kcyBTY2hlbWFUeXBlPih2YWx1ZTogVCk6IFNjaGVtYVR5cGU8XCJyZWNvcmRcIiwgVD47XG4gIC8qKiBBbnkgdHlwZSAqL1xuICBhbnkoKTogU2NoZW1hVHlwZTxcImFueVwiPjtcbiAgLyoqIFBsYWNlaG9sZGVyIGZvciB1c2VyLXByb3ZpZGVkIFpvZCBzY2hlbWEgKi9cbiAgem9kKCk6IFNjaGVtYVR5cGU8XCJ6b2RcIj47XG4gIC8qKiBSZWZlcmVuY2UgdG8gY2F0YWxvZyBrZXkgKGUuZy4sICdjYXRhbG9nLmNvbXBvbmVudHMnKSAqL1xuICByZWYocGF0aDogc3RyaW5nKTogU2NoZW1hVHlwZTxcInJlZlwiLCBzdHJpbmc+O1xuICAvKiogUHJvcHMgZnJvbSByZWZlcmVuY2VkIGNhdGFsb2cgZW50cnkgKi9cbiAgcHJvcHNPZihwYXRoOiBzdHJpbmcpOiBTY2hlbWFUeXBlPFwicHJvcHNPZlwiLCBzdHJpbmc+O1xuICAvKiogTWFwIG9mIG5hbWVkIGVudHJpZXMgd2l0aCBzaGFyZWQgc2hhcGUgKi9cbiAgbWFwPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBTY2hlbWFUeXBlPj4oXG4gICAgZW50cnlTaGFwZTogVCxcbiAgKTogU2NoZW1hVHlwZTxcIm1hcFwiLCBUPjtcbiAgLyoqIE9wdGlvbmFsIG1vZGlmaWVyICovXG4gIG9wdGlvbmFsKCk6IHsgb3B0aW9uYWw6IHRydWUgfTtcbn1cblxuLyoqXG4gKiBTY2hlbWEgdHlwZSByZXByZXNlbnRhdGlvblxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNjaGVtYVR5cGU8VEtpbmQgZXh0ZW5kcyBzdHJpbmcgPSBzdHJpbmcsIFRJbm5lciA9IHVua25vd24+IHtcbiAga2luZDogVEtpbmQ7XG4gIGlubmVyPzogVElubmVyO1xuICBvcHRpb25hbD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogU2NoZW1hIGRlZmluaXRpb24gc2hhcGVcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2hlbWFEZWZpbml0aW9uPFxuICBUU3BlYyBleHRlbmRzIFNjaGVtYVR5cGUgPSBTY2hlbWFUeXBlLFxuICBUQ2F0YWxvZyBleHRlbmRzIFNjaGVtYVR5cGUgPSBTY2hlbWFUeXBlLFxuPiB7XG4gIC8qKiBXaGF0IHRoZSBBSS1nZW5lcmF0ZWQgc3BlYyBsb29rcyBsaWtlICovXG4gIHNwZWM6IFRTcGVjO1xuICAvKiogV2hhdCB0aGUgY2F0YWxvZyBtdXN0IHByb3ZpZGUgKi9cbiAgY2F0YWxvZzogVENhdGFsb2c7XG59XG5cbi8qKlxuICogU2NoZW1hIGluc3RhbmNlIHdpdGggbWV0aG9kc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIFNjaGVtYTxURGVmIGV4dGVuZHMgU2NoZW1hRGVmaW5pdGlvbiA9IFNjaGVtYURlZmluaXRpb24+IHtcbiAgLyoqIFRoZSBzY2hlbWEgZGVmaW5pdGlvbiAqL1xuICByZWFkb25seSBkZWZpbml0aW9uOiBURGVmO1xuICAvKiogQ3VzdG9tIHByb21wdCB0ZW1wbGF0ZSBmb3IgdGhpcyBzY2hlbWEgKi9cbiAgcmVhZG9ubHkgcHJvbXB0VGVtcGxhdGU/OiBQcm9tcHRUZW1wbGF0ZTtcbiAgLyoqIERlZmF1bHQgcnVsZXMgYmFrZWQgaW50byB0aGUgc2NoZW1hIChpbmplY3RlZCBiZWZvcmUgY3VzdG9tUnVsZXMpICovXG4gIHJlYWRvbmx5IGRlZmF1bHRSdWxlcz86IHN0cmluZ1tdO1xuICAvKiogQnVpbHQtaW4gYWN0aW9ucyBhbHdheXMgYXZhaWxhYmxlIGF0IHJ1bnRpbWUgKGluamVjdGVkIGludG8gcHJvbXB0cyBhdXRvbWF0aWNhbGx5KSAqL1xuICByZWFkb25seSBidWlsdEluQWN0aW9ucz86IEJ1aWx0SW5BY3Rpb25bXTtcbiAgLyoqIENyZWF0ZSBhIGNhdGFsb2cgZnJvbSB0aGlzIHNjaGVtYSAqL1xuICBjcmVhdGVDYXRhbG9nPFRDYXRhbG9nIGV4dGVuZHMgSW5mZXJDYXRhbG9nSW5wdXQ8VERlZltcImNhdGFsb2dcIl0+PihcbiAgICBjYXRhbG9nOiBUQ2F0YWxvZyxcbiAgKTogQ2F0YWxvZzxURGVmLCBUQ2F0YWxvZz47XG59XG5cbi8qKlxuICogQ2F0YWxvZyBpbnN0YW5jZSB3aXRoIG1ldGhvZHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDYXRhbG9nPFxuICBURGVmIGV4dGVuZHMgU2NoZW1hRGVmaW5pdGlvbiA9IFNjaGVtYURlZmluaXRpb24sXG4gIFRDYXRhbG9nID0gdW5rbm93bixcbj4ge1xuICAvKiogVGhlIHNjaGVtYSB0aGlzIGNhdGFsb2cgaXMgYmFzZWQgb24gKi9cbiAgcmVhZG9ubHkgc2NoZW1hOiBTY2hlbWE8VERlZj47XG4gIC8qKiBUaGUgY2F0YWxvZyBkYXRhICovXG4gIHJlYWRvbmx5IGRhdGE6IFRDYXRhbG9nO1xuICAvKiogQ29tcG9uZW50IG5hbWVzICovXG4gIHJlYWRvbmx5IGNvbXBvbmVudE5hbWVzOiBzdHJpbmdbXTtcbiAgLyoqIEFjdGlvbiBuYW1lcyAqL1xuICByZWFkb25seSBhY3Rpb25OYW1lczogc3RyaW5nW107XG4gIC8qKiBHZW5lcmF0ZSBzeXN0ZW0gcHJvbXB0IGZvciBBSSAqL1xuICBwcm9tcHQob3B0aW9ucz86IFByb21wdE9wdGlvbnMpOiBzdHJpbmc7XG4gIC8qKiBFeHBvcnQgYXMgSlNPTiBTY2hlbWEgZm9yIHN0cnVjdHVyZWQgb3V0cHV0cyAqL1xuICBqc29uU2NoZW1hKCk6IG9iamVjdDtcbiAgLyoqIFZhbGlkYXRlIGEgc3BlYyBhZ2FpbnN0IHRoaXMgY2F0YWxvZyAqL1xuICB2YWxpZGF0ZShzcGVjOiB1bmtub3duKTogU3BlY1ZhbGlkYXRpb25SZXN1bHQ8SW5mZXJTcGVjPFREZWYsIFRDYXRhbG9nPj47XG4gIC8qKiBHZXQgdGhlIFpvZCBzY2hlbWEgZm9yIHRoZSBzcGVjICovXG4gIHpvZFNjaGVtYSgpOiB6LlpvZFR5cGU8SW5mZXJTcGVjPFREZWYsIFRDYXRhbG9nPj47XG4gIC8qKiBUeXBlIGhlbHBlciBmb3IgdGhlIHNwZWMgdHlwZSAqL1xuICByZWFkb25seSBfc3BlY1R5cGU6IEluZmVyU3BlYzxURGVmLCBUQ2F0YWxvZz47XG59XG5cbi8qKlxuICogUHJvbXB0IGdlbmVyYXRpb24gb3B0aW9uc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIFByb21wdE9wdGlvbnMge1xuICAvKiogQ3VzdG9tIHN5c3RlbSBtZXNzYWdlIGludHJvICovXG4gIHN5c3RlbT86IHN0cmluZztcbiAgLyoqIEFkZGl0aW9uYWwgcnVsZXMgdG8gYXBwZW5kICovXG4gIGN1c3RvbVJ1bGVzPzogc3RyaW5nW107XG4gIC8qKlxuICAgKiBPdXRwdXQgbW9kZSBmb3IgdGhlIGdlbmVyYXRlZCBwcm9tcHQuXG4gICAqXG4gICAqIC0gYFwiZ2VuZXJhdGVcImAgKGRlZmF1bHQpOiBUaGUgTExNIHNob3VsZCBvdXRwdXQgb25seSBKU09OTCBwYXRjaGVzIChubyBwcm9zZSkuXG4gICAqIC0gYFwiY2hhdFwiYDogVGhlIExMTSBzaG91bGQgcmVzcG9uZCBjb252ZXJzYXRpb25hbGx5IGZpcnN0LCB0aGVuIG91dHB1dCBKU09OTCBwYXRjaGVzLlxuICAgKiAgIEluY2x1ZGVzIHJ1bGVzIGFib3V0IGludGVybGVhdmluZyB0ZXh0IHdpdGggSlNPTkwgYW5kIG5vdCB3cmFwcGluZyBpbiBjb2RlIGZlbmNlcy5cbiAgICovXG4gIG1vZGU/OiBcImdlbmVyYXRlXCIgfCBcImNoYXRcIjtcbn1cblxuLyoqXG4gKiBDb250ZXh0IHByb3ZpZGVkIHRvIHByb21wdCB0ZW1wbGF0ZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQcm9tcHRDb250ZXh0PFRDYXRhbG9nID0gdW5rbm93bj4ge1xuICAvKiogVGhlIGNhdGFsb2cgZGF0YSAqL1xuICBjYXRhbG9nOiBUQ2F0YWxvZztcbiAgLyoqIENvbXBvbmVudCBuYW1lcyBmcm9tIHRoZSBjYXRhbG9nICovXG4gIGNvbXBvbmVudE5hbWVzOiBzdHJpbmdbXTtcbiAgLyoqIEFjdGlvbiBuYW1lcyBmcm9tIHRoZSBjYXRhbG9nIChpZiBhbnkpICovXG4gIGFjdGlvbk5hbWVzOiBzdHJpbmdbXTtcbiAgLyoqIFByb21wdCBvcHRpb25zIHByb3ZpZGVkIGJ5IHRoZSB1c2VyICovXG4gIG9wdGlvbnM6IFByb21wdE9wdGlvbnM7XG4gIC8qKiBIZWxwZXIgdG8gZm9ybWF0IGEgWm9kIHR5cGUgYXMgYSBodW1hbi1yZWFkYWJsZSBzdHJpbmcgKi9cbiAgZm9ybWF0Wm9kVHlwZTogKHNjaGVtYTogei5ab2RUeXBlKSA9PiBzdHJpbmc7XG59XG5cbi8qKlxuICogUHJvbXB0IHRlbXBsYXRlIGZ1bmN0aW9uIHR5cGVcbiAqL1xuZXhwb3J0IHR5cGUgUHJvbXB0VGVtcGxhdGU8VENhdGFsb2cgPSB1bmtub3duPiA9IChcbiAgY29udGV4dDogUHJvbXB0Q29udGV4dDxUQ2F0YWxvZz4sXG4pID0+IHN0cmluZztcblxuLyoqXG4gKiBBIGJ1aWx0LWluIGFjdGlvbiB0aGF0IGlzIGFsd2F5cyBhdmFpbGFibGUgcmVnYXJkbGVzcyBvZiBjYXRhbG9nIGNvbmZpZ3VyYXRpb24uXG4gKiBUaGVzZSBhcmUgaGFuZGxlZCBieSB0aGUgcnVudGltZSAoZS5nLiBBY3Rpb25Qcm92aWRlcikgYW5kIGluamVjdGVkIGludG8gcHJvbXB0c1xuICogYXV0b21hdGljYWxseSBzbyB0aGUgTExNIGtub3dzIGFib3V0IHRoZW0uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQnVpbHRJbkFjdGlvbiB7XG4gIC8qKiBBY3Rpb24gbmFtZSAoZS5nLiBcInNldFN0YXRlXCIpICovXG4gIG5hbWU6IHN0cmluZztcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIGRlc2NyaXB0aW9uIGZvciB0aGUgTExNICovXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG59XG5cbi8qKlxuICogU2NoZW1hIG9wdGlvbnNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2hlbWFPcHRpb25zPFRDYXRhbG9nID0gdW5rbm93bj4ge1xuICAvKiogQ3VzdG9tIHByb21wdCB0ZW1wbGF0ZSBmb3IgdGhpcyBzY2hlbWEgKi9cbiAgcHJvbXB0VGVtcGxhdGU/OiBQcm9tcHRUZW1wbGF0ZTxUQ2F0YWxvZz47XG4gIC8qKiBEZWZhdWx0IHJ1bGVzIGJha2VkIGludG8gdGhlIHNjaGVtYSAoaW5qZWN0ZWQgYmVmb3JlIGN1c3RvbVJ1bGVzIGluIHByb21wdHMpICovXG4gIGRlZmF1bHRSdWxlcz86IHN0cmluZ1tdO1xuICAvKipcbiAgICogQnVpbHQtaW4gYWN0aW9ucyB0aGF0IGFyZSBhbHdheXMgYXZhaWxhYmxlIHJlZ2FyZGxlc3Mgb2YgY2F0YWxvZyBjb25maWd1cmF0aW9uLlxuICAgKiBUaGVzZSBhcmUgaW5qZWN0ZWQgaW50byBwcm9tcHRzIGF1dG9tYXRpY2FsbHkgc28gdGhlIExMTSBrbm93cyBhYm91dCB0aGVtLFxuICAgKiBidXQgdGhleSBkb24ndCByZXF1aXJlIGhhbmRsZXJzIGluIGRlZmluZVJlZ2lzdHJ5IGJlY2F1c2UgdGhlIHJ1bnRpbWVcbiAgICogKGUuZy4gQWN0aW9uUHJvdmlkZXIpIGhhbmRsZXMgdGhlbSBkaXJlY3RseS5cbiAgICovXG4gIGJ1aWx0SW5BY3Rpb25zPzogQnVpbHRJbkFjdGlvbltdO1xufVxuXG4vKipcbiAqIFNwZWMgdmFsaWRhdGlvbiByZXN1bHRcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGVjVmFsaWRhdGlvblJlc3VsdDxUPiB7XG4gIHN1Y2Nlc3M6IGJvb2xlYW47XG4gIGRhdGE/OiBUO1xuICBlcnJvcj86IHouWm9kRXJyb3I7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDYXRhbG9nIFR5cGUgSW5mZXJlbmNlIEhlbHBlcnNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRXh0cmFjdCB0aGUgY29tcG9uZW50cyBtYXAgdHlwZSBmcm9tIGEgY2F0YWxvZ1xuICogQGV4YW1wbGUgdHlwZSBDb21wb25lbnRzID0gSW5mZXJDYXRhbG9nQ29tcG9uZW50czx0eXBlb2YgbXlDYXRhbG9nPjtcbiAqL1xuZXhwb3J0IHR5cGUgSW5mZXJDYXRhbG9nQ29tcG9uZW50czxDIGV4dGVuZHMgQ2F0YWxvZz4gPVxuICBDIGV4dGVuZHMgQ2F0YWxvZzxTY2hlbWFEZWZpbml0aW9uLCBpbmZlciBUQ2F0YWxvZz5cbiAgICA/IFRDYXRhbG9nIGV4dGVuZHMgeyBjb21wb25lbnRzOiBpbmZlciBDb21wcyB9XG4gICAgICA/IENvbXBzXG4gICAgICA6IG5ldmVyXG4gICAgOiBuZXZlcjtcblxuLyoqXG4gKiBFeHRyYWN0IHRoZSBhY3Rpb25zIG1hcCB0eXBlIGZyb20gYSBjYXRhbG9nXG4gKiBAZXhhbXBsZSB0eXBlIEFjdGlvbnMgPSBJbmZlckNhdGFsb2dBY3Rpb25zPHR5cGVvZiBteUNhdGFsb2c+O1xuICovXG5leHBvcnQgdHlwZSBJbmZlckNhdGFsb2dBY3Rpb25zPEMgZXh0ZW5kcyBDYXRhbG9nPiA9XG4gIEMgZXh0ZW5kcyBDYXRhbG9nPFNjaGVtYURlZmluaXRpb24sIGluZmVyIFRDYXRhbG9nPlxuICAgID8gVENhdGFsb2cgZXh0ZW5kcyB7IGFjdGlvbnM6IGluZmVyIEFjdHMgfVxuICAgICAgPyBBY3RzXG4gICAgICA6IG5ldmVyXG4gICAgOiBuZXZlcjtcblxuLyoqXG4gKiBJbmZlciBjb21wb25lbnQgcHJvcHMgZnJvbSBhIGNhdGFsb2cgYnkgY29tcG9uZW50IG5hbWVcbiAqIEBleGFtcGxlIHR5cGUgQnV0dG9uUHJvcHMgPSBJbmZlckNvbXBvbmVudFByb3BzPHR5cGVvZiBteUNhdGFsb2csICdCdXR0b24nPjtcbiAqL1xuZXhwb3J0IHR5cGUgSW5mZXJDb21wb25lbnRQcm9wczxcbiAgQyBleHRlbmRzIENhdGFsb2csXG4gIEsgZXh0ZW5kcyBrZXlvZiBJbmZlckNhdGFsb2dDb21wb25lbnRzPEM+LFxuPiA9IEluZmVyQ2F0YWxvZ0NvbXBvbmVudHM8Qz5bS10gZXh0ZW5kcyB7IHByb3BzOiB6LlpvZFR5cGU8aW5mZXIgUD4gfVxuICA/IFBcbiAgOiBuZXZlcjtcblxuLyoqXG4gKiBJbmZlciBhY3Rpb24gcGFyYW1zIGZyb20gYSBjYXRhbG9nIGJ5IGFjdGlvbiBuYW1lXG4gKiBAZXhhbXBsZSB0eXBlIFZpZXdDdXN0b21lcnNQYXJhbXMgPSBJbmZlckFjdGlvblBhcmFtczx0eXBlb2YgbXlDYXRhbG9nLCAndmlld0N1c3RvbWVycyc+O1xuICovXG5leHBvcnQgdHlwZSBJbmZlckFjdGlvblBhcmFtczxcbiAgQyBleHRlbmRzIENhdGFsb2csXG4gIEsgZXh0ZW5kcyBrZXlvZiBJbmZlckNhdGFsb2dBY3Rpb25zPEM+LFxuPiA9IEluZmVyQ2F0YWxvZ0FjdGlvbnM8Qz5bS10gZXh0ZW5kcyB7IHBhcmFtczogei5ab2RUeXBlPGluZmVyIFA+IH1cbiAgPyBQXG4gIDogbmV2ZXI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBJbnRlcm5hbCBUeXBlIEluZmVyZW5jZSBIZWxwZXJzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgdHlwZSBJbmZlckNhdGFsb2dJbnB1dDxUPiA9XG4gIFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwib2JqZWN0XCIsIGluZmVyIFNoYXBlPlxuICAgID8geyBbSyBpbiBrZXlvZiBTaGFwZV06IEluZmVyQ2F0YWxvZ0ZpZWxkPFNoYXBlW0tdPiB9XG4gICAgOiBuZXZlcjtcblxudHlwZSBJbmZlckNhdGFsb2dGaWVsZDxUPiA9XG4gIFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwibWFwXCIsIGluZmVyIEVudHJ5U2hhcGU+XG4gICAgPyBSZWNvcmQ8XG4gICAgICAgIHN0cmluZyxcbiAgICAgICAgLy8gT25seSAncHJvcHMnIGlzIHJlcXVpcmVkLCByZXN0IGFyZSBvcHRpb25hbFxuICAgICAgICBJbmZlck1hcEVudHJ5UmVxdWlyZWQ8RW50cnlTaGFwZT4gJlxuICAgICAgICAgIFBhcnRpYWw8SW5mZXJNYXBFbnRyeU9wdGlvbmFsPEVudHJ5U2hhcGU+PlxuICAgICAgPlxuICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJ6b2RcIj5cbiAgICAgID8gei5ab2RUeXBlXG4gICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwic3RyaW5nXCI+XG4gICAgICAgID8gc3RyaW5nXG4gICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJudW1iZXJcIj5cbiAgICAgICAgICA/IG51bWJlclxuICAgICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJib29sZWFuXCI+XG4gICAgICAgICAgICA/IGJvb2xlYW5cbiAgICAgICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJhcnJheVwiLCBpbmZlciBJdGVtPlxuICAgICAgICAgICAgICA/IEluZmVyQ2F0YWxvZ0ZpZWxkPEl0ZW0+W11cbiAgICAgICAgICAgICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcIm9iamVjdFwiLCBpbmZlciBTaGFwZT5cbiAgICAgICAgICAgICAgICA/IHsgW0sgaW4ga2V5b2YgU2hhcGVdOiBJbmZlckNhdGFsb2dGaWVsZDxTaGFwZVtLXT4gfVxuICAgICAgICAgICAgICAgIDogdW5rbm93bjtcblxuLy8gRXh0cmFjdCByZXF1aXJlZCBmaWVsZHMgKHByb3BzIGlzIGFsd2F5cyByZXF1aXJlZClcbnR5cGUgSW5mZXJNYXBFbnRyeVJlcXVpcmVkPFQ+ID0ge1xuICBbSyBpbiBrZXlvZiBUIGFzIEsgZXh0ZW5kcyBcInByb3BzXCIgPyBLIDogbmV2ZXJdOiBJbmZlck1hcEVudHJ5RmllbGQ8VFtLXT47XG59O1xuXG4vLyBFeHRyYWN0IG9wdGlvbmFsIGZpZWxkcyAoZXZlcnl0aGluZyBleGNlcHQgcHJvcHMpXG50eXBlIEluZmVyTWFwRW50cnlPcHRpb25hbDxUPiA9IHtcbiAgW0sgaW4ga2V5b2YgVCBhcyBLIGV4dGVuZHMgXCJwcm9wc1wiID8gbmV2ZXIgOiBLXTogSW5mZXJNYXBFbnRyeUZpZWxkPFRbS10+O1xufTtcblxudHlwZSBJbmZlck1hcEVudHJ5RmllbGQ8VD4gPVxuICBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcInpvZFwiPlxuICAgID8gei5ab2RUeXBlXG4gICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcInN0cmluZ1wiPlxuICAgICAgPyBzdHJpbmdcbiAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJudW1iZXJcIj5cbiAgICAgICAgPyBudW1iZXJcbiAgICAgICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcImJvb2xlYW5cIj5cbiAgICAgICAgICA/IGJvb2xlYW5cbiAgICAgICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwiYXJyYXlcIiwgaW5mZXIgSXRlbT5cbiAgICAgICAgICAgID8gSW5mZXJNYXBFbnRyeUZpZWxkPEl0ZW0+W11cbiAgICAgICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJvYmplY3RcIiwgaW5mZXIgU2hhcGU+XG4gICAgICAgICAgICAgID8geyBbSyBpbiBrZXlvZiBTaGFwZV06IEluZmVyTWFwRW50cnlGaWVsZDxTaGFwZVtLXT4gfVxuICAgICAgICAgICAgICA6IHVua25vd247XG5cbi8vIFNwZWMgaW5mZXJlbmNlIChzaW1wbGlmaWVkIC0gd2lsbCBiZSBleHBhbmRlZClcbmV4cG9ydCB0eXBlIEluZmVyU3BlYzxURGVmIGV4dGVuZHMgU2NoZW1hRGVmaW5pdGlvbiwgVENhdGFsb2c+ID0gVERlZiBleHRlbmRzIHtcbiAgc3BlYzogU2NoZW1hVHlwZTxcIm9iamVjdFwiLCBpbmZlciBTaGFwZT47XG59XG4gID8gSW5mZXJTcGVjT2JqZWN0PFNoYXBlLCBUQ2F0YWxvZz5cbiAgOiB1bmtub3duO1xuXG50eXBlIEluZmVyU3BlY09iamVjdDxTaGFwZSwgVENhdGFsb2c+ID0ge1xuICBbSyBpbiBrZXlvZiBTaGFwZV06IEluZmVyU3BlY0ZpZWxkPFNoYXBlW0tdLCBUQ2F0YWxvZz47XG59O1xuXG50eXBlIEluZmVyU3BlY0ZpZWxkPFQsIFRDYXRhbG9nPiA9XG4gIFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwic3RyaW5nXCI+XG4gICAgPyBzdHJpbmdcbiAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwibnVtYmVyXCI+XG4gICAgICA/IG51bWJlclxuICAgICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcImJvb2xlYW5cIj5cbiAgICAgICAgPyBib29sZWFuXG4gICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJhcnJheVwiLCBpbmZlciBJdGVtPlxuICAgICAgICAgID8gSW5mZXJTcGVjRmllbGQ8SXRlbSwgVENhdGFsb2c+W11cbiAgICAgICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwib2JqZWN0XCIsIGluZmVyIFNoYXBlPlxuICAgICAgICAgICAgPyBJbmZlclNwZWNPYmplY3Q8U2hhcGUsIFRDYXRhbG9nPlxuICAgICAgICAgICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcInJlY29yZFwiLCBpbmZlciBWYWx1ZT5cbiAgICAgICAgICAgICAgPyBSZWNvcmQ8c3RyaW5nLCBJbmZlclNwZWNGaWVsZDxWYWx1ZSwgVENhdGFsb2c+PlxuICAgICAgICAgICAgICA6IFQgZXh0ZW5kcyBTY2hlbWFUeXBlPFwicmVmXCIsIGluZmVyIFBhdGg+XG4gICAgICAgICAgICAgICAgPyBJbmZlclJlZlR5cGU8UGF0aCwgVENhdGFsb2c+XG4gICAgICAgICAgICAgICAgOiBUIGV4dGVuZHMgU2NoZW1hVHlwZTxcInByb3BzT2ZcIiwgaW5mZXIgUGF0aD5cbiAgICAgICAgICAgICAgICAgID8gSW5mZXJQcm9wc09mVHlwZTxQYXRoLCBUQ2F0YWxvZz5cbiAgICAgICAgICAgICAgICAgIDogVCBleHRlbmRzIFNjaGVtYVR5cGU8XCJhbnlcIj5cbiAgICAgICAgICAgICAgICAgICAgPyB1bmtub3duXG4gICAgICAgICAgICAgICAgICAgIDogdW5rbm93bjtcblxudHlwZSBJbmZlclJlZlR5cGU8UGF0aCwgVENhdGFsb2c+ID0gUGF0aCBleHRlbmRzIFwiY2F0YWxvZy5jb21wb25lbnRzXCJcbiAgPyBUQ2F0YWxvZyBleHRlbmRzIHsgY29tcG9uZW50czogaW5mZXIgQyB9XG4gICAgPyBrZXlvZiBDXG4gICAgOiBzdHJpbmdcbiAgOiBQYXRoIGV4dGVuZHMgXCJjYXRhbG9nLmFjdGlvbnNcIlxuICAgID8gVENhdGFsb2cgZXh0ZW5kcyB7IGFjdGlvbnM6IGluZmVyIEEgfVxuICAgICAgPyBrZXlvZiBBXG4gICAgICA6IHN0cmluZ1xuICAgIDogc3RyaW5nO1xuXG50eXBlIEluZmVyUHJvcHNPZlR5cGU8UGF0aCwgVENhdGFsb2c+ID0gUGF0aCBleHRlbmRzIFwiY2F0YWxvZy5jb21wb25lbnRzXCJcbiAgPyBUQ2F0YWxvZyBleHRlbmRzIHsgY29tcG9uZW50czogaW5mZXIgQyB9XG4gICAgPyBDIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgeyBwcm9wczogei5ab2RUeXBlPGluZmVyIFA+IH0+XG4gICAgICA/IFBcbiAgICAgIDogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgICA6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gIDogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cbi8qKlxuICogQ3JlYXRlIHRoZSBzY2hlbWEgYnVpbGRlclxuICovXG5mdW5jdGlvbiBjcmVhdGVCdWlsZGVyKCk6IFNjaGVtYUJ1aWxkZXIge1xuICByZXR1cm4ge1xuICAgIHN0cmluZzogKCkgPT4gKHsga2luZDogXCJzdHJpbmdcIiB9KSxcbiAgICBudW1iZXI6ICgpID0+ICh7IGtpbmQ6IFwibnVtYmVyXCIgfSksXG4gICAgYm9vbGVhbjogKCkgPT4gKHsga2luZDogXCJib29sZWFuXCIgfSksXG4gICAgYXJyYXk6IChpdGVtKSA9PiAoeyBraW5kOiBcImFycmF5XCIsIGlubmVyOiBpdGVtIH0pLFxuICAgIG9iamVjdDogKHNoYXBlKSA9PiAoeyBraW5kOiBcIm9iamVjdFwiLCBpbm5lcjogc2hhcGUgfSksXG4gICAgcmVjb3JkOiAodmFsdWUpID0+ICh7IGtpbmQ6IFwicmVjb3JkXCIsIGlubmVyOiB2YWx1ZSB9KSxcbiAgICBhbnk6ICgpID0+ICh7IGtpbmQ6IFwiYW55XCIgfSksXG4gICAgem9kOiAoKSA9PiAoeyBraW5kOiBcInpvZFwiIH0pLFxuICAgIHJlZjogKHBhdGgpID0+ICh7IGtpbmQ6IFwicmVmXCIsIGlubmVyOiBwYXRoIH0pLFxuICAgIHByb3BzT2Y6IChwYXRoKSA9PiAoeyBraW5kOiBcInByb3BzT2ZcIiwgaW5uZXI6IHBhdGggfSksXG4gICAgbWFwOiAoZW50cnlTaGFwZSkgPT4gKHsga2luZDogXCJtYXBcIiwgaW5uZXI6IGVudHJ5U2hhcGUgfSksXG4gICAgb3B0aW9uYWw6ICgpID0+ICh7IG9wdGlvbmFsOiB0cnVlIH0pLFxuICB9O1xufVxuXG4vKipcbiAqIERlZmluZSBhIHNjaGVtYSB1c2luZyB0aGUgYnVpbGRlciBwYXR0ZXJuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZpbmVTY2hlbWE8VERlZiBleHRlbmRzIFNjaGVtYURlZmluaXRpb24+KFxuICBidWlsZGVyOiAoczogU2NoZW1hQnVpbGRlcikgPT4gVERlZixcbiAgb3B0aW9ucz86IFNjaGVtYU9wdGlvbnMsXG4pOiBTY2hlbWE8VERlZj4ge1xuICBjb25zdCBzID0gY3JlYXRlQnVpbGRlcigpO1xuICBjb25zdCBkZWZpbml0aW9uID0gYnVpbGRlcihzKTtcblxuICByZXR1cm4ge1xuICAgIGRlZmluaXRpb24sXG4gICAgcHJvbXB0VGVtcGxhdGU6IG9wdGlvbnM/LnByb21wdFRlbXBsYXRlLFxuICAgIGRlZmF1bHRSdWxlczogb3B0aW9ucz8uZGVmYXVsdFJ1bGVzLFxuICAgIGJ1aWx0SW5BY3Rpb25zOiBvcHRpb25zPy5idWlsdEluQWN0aW9ucyxcbiAgICBjcmVhdGVDYXRhbG9nPFRDYXRhbG9nIGV4dGVuZHMgSW5mZXJDYXRhbG9nSW5wdXQ8VERlZltcImNhdGFsb2dcIl0+PihcbiAgICAgIGNhdGFsb2c6IFRDYXRhbG9nLFxuICAgICk6IENhdGFsb2c8VERlZiwgVENhdGFsb2c+IHtcbiAgICAgIHJldHVybiBjcmVhdGVDYXRhbG9nRnJvbVNjaGVtYSh0aGlzIGFzIFNjaGVtYTxURGVmPiwgY2F0YWxvZyk7XG4gICAgfSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBjYXRhbG9nIGZyb20gYSBzY2hlbWEgKGludGVybmFsKVxuICovXG5mdW5jdGlvbiBjcmVhdGVDYXRhbG9nRnJvbVNjaGVtYTxURGVmIGV4dGVuZHMgU2NoZW1hRGVmaW5pdGlvbiwgVENhdGFsb2c+KFxuICBzY2hlbWE6IFNjaGVtYTxURGVmPixcbiAgY2F0YWxvZ0RhdGE6IFRDYXRhbG9nLFxuKTogQ2F0YWxvZzxURGVmLCBUQ2F0YWxvZz4ge1xuICAvLyBFeHRyYWN0IGNvbXBvbmVudCBhbmQgYWN0aW9uIG5hbWVzXG4gIGNvbnN0IGNvbXBvbmVudHMgPSAoY2F0YWxvZ0RhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmNvbXBvbmVudHMgYXNcbiAgICB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gICAgfCB1bmRlZmluZWQ7XG4gIGNvbnN0IGFjdGlvbnMgPSAoY2F0YWxvZ0RhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmFjdGlvbnMgYXNcbiAgICB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4gICAgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY29tcG9uZW50TmFtZXMgPSBjb21wb25lbnRzID8gT2JqZWN0LmtleXMoY29tcG9uZW50cykgOiBbXTtcbiAgY29uc3QgYWN0aW9uTmFtZXMgPSBhY3Rpb25zID8gT2JqZWN0LmtleXMoYWN0aW9ucykgOiBbXTtcblxuICAvLyBCdWlsZCB0aGUgWm9kIHNjaGVtYSBmb3IgdmFsaWRhdGlvblxuICBjb25zdCB6b2RTY2hlbWEgPSBidWlsZFpvZFNjaGVtYUZyb21EZWZpbml0aW9uKFxuICAgIHNjaGVtYS5kZWZpbml0aW9uLFxuICAgIGNhdGFsb2dEYXRhLFxuICApO1xuXG4gIHJldHVybiB7XG4gICAgc2NoZW1hLFxuICAgIGRhdGE6IGNhdGFsb2dEYXRhLFxuICAgIGNvbXBvbmVudE5hbWVzLFxuICAgIGFjdGlvbk5hbWVzLFxuXG4gICAgcHJvbXB0KG9wdGlvbnM6IFByb21wdE9wdGlvbnMgPSB7fSk6IHN0cmluZyB7XG4gICAgICByZXR1cm4gZ2VuZXJhdGVQcm9tcHQodGhpcywgb3B0aW9ucyk7XG4gICAgfSxcblxuICAgIGpzb25TY2hlbWEoKTogb2JqZWN0IHtcbiAgICAgIHJldHVybiB6b2RUb0pzb25TY2hlbWEoem9kU2NoZW1hKTtcbiAgICB9LFxuXG4gICAgdmFsaWRhdGUoc3BlYzogdW5rbm93bik6IFNwZWNWYWxpZGF0aW9uUmVzdWx0PEluZmVyU3BlYzxURGVmLCBUQ2F0YWxvZz4+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHpvZFNjaGVtYS5zYWZlUGFyc2Uoc3BlYyk7XG4gICAgICBpZiAocmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgIGRhdGE6IHJlc3VsdC5kYXRhIGFzIEluZmVyU3BlYzxURGVmLCBUQ2F0YWxvZz4sXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IHJlc3VsdC5lcnJvciB9O1xuICAgIH0sXG5cbiAgICB6b2RTY2hlbWEoKTogei5ab2RUeXBlPEluZmVyU3BlYzxURGVmLCBUQ2F0YWxvZz4+IHtcbiAgICAgIHJldHVybiB6b2RTY2hlbWEgYXMgei5ab2RUeXBlPEluZmVyU3BlYzxURGVmLCBUQ2F0YWxvZz4+O1xuICAgIH0sXG5cbiAgICBnZXQgX3NwZWNUeXBlKCk6IEluZmVyU3BlYzxURGVmLCBUQ2F0YWxvZz4ge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiX3NwZWNUeXBlIGlzIG9ubHkgZm9yIHR5cGUgaW5mZXJlbmNlXCIpO1xuICAgIH0sXG4gIH07XG59XG5cbi8qKlxuICogQnVpbGQgWm9kIHNjaGVtYSBmcm9tIHNjaGVtYSBkZWZpbml0aW9uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkWm9kU2NoZW1hRnJvbURlZmluaXRpb24oXG4gIGRlZmluaXRpb246IFNjaGVtYURlZmluaXRpb24sXG4gIGNhdGFsb2dEYXRhOiB1bmtub3duLFxuKTogei5ab2RUeXBlIHtcbiAgcmV0dXJuIGJ1aWxkWm9kVHlwZShkZWZpbml0aW9uLnNwZWMsIGNhdGFsb2dEYXRhKTtcbn1cblxuZnVuY3Rpb24gYnVpbGRab2RUeXBlKHNjaGVtYVR5cGU6IFNjaGVtYVR5cGUsIGNhdGFsb2dEYXRhOiB1bmtub3duKTogei5ab2RUeXBlIHtcbiAgc3dpdGNoIChzY2hlbWFUeXBlLmtpbmQpIHtcbiAgICBjYXNlIFwic3RyaW5nXCI6XG4gICAgICByZXR1cm4gei5zdHJpbmcoKTtcbiAgICBjYXNlIFwibnVtYmVyXCI6XG4gICAgICByZXR1cm4gei5udW1iZXIoKTtcbiAgICBjYXNlIFwiYm9vbGVhblwiOlxuICAgICAgcmV0dXJuIHouYm9vbGVhbigpO1xuICAgIGNhc2UgXCJhbnlcIjpcbiAgICAgIHJldHVybiB6LmFueSgpO1xuICAgIGNhc2UgXCJhcnJheVwiOiB7XG4gICAgICBjb25zdCBpbm5lciA9IGJ1aWxkWm9kVHlwZShzY2hlbWFUeXBlLmlubmVyIGFzIFNjaGVtYVR5cGUsIGNhdGFsb2dEYXRhKTtcbiAgICAgIHJldHVybiB6LmFycmF5KGlubmVyKTtcbiAgICB9XG4gICAgY2FzZSBcIm9iamVjdFwiOiB7XG4gICAgICBjb25zdCBzaGFwZSA9IHNjaGVtYVR5cGUuaW5uZXIgYXMgUmVjb3JkPHN0cmluZywgU2NoZW1hVHlwZT47XG4gICAgICBjb25zdCB6b2RTaGFwZTogUmVjb3JkPHN0cmluZywgei5ab2RUeXBlPiA9IHt9O1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc2hhcGUpKSB7XG4gICAgICAgIGxldCB6b2RUeXBlID0gYnVpbGRab2RUeXBlKHZhbHVlLCBjYXRhbG9nRGF0YSk7XG4gICAgICAgIGlmICh2YWx1ZS5vcHRpb25hbCkge1xuICAgICAgICAgIHpvZFR5cGUgPSB6b2RUeXBlLm9wdGlvbmFsKCk7XG4gICAgICAgIH1cbiAgICAgICAgem9kU2hhcGVba2V5XSA9IHpvZFR5cGU7XG4gICAgICB9XG4gICAgICByZXR1cm4gei5vYmplY3Qoem9kU2hhcGUpO1xuICAgIH1cbiAgICBjYXNlIFwicmVjb3JkXCI6IHtcbiAgICAgIGNvbnN0IGlubmVyID0gYnVpbGRab2RUeXBlKHNjaGVtYVR5cGUuaW5uZXIgYXMgU2NoZW1hVHlwZSwgY2F0YWxvZ0RhdGEpO1xuICAgICAgcmV0dXJuIHoucmVjb3JkKHouc3RyaW5nKCksIGlubmVyKTtcbiAgICB9XG4gICAgY2FzZSBcInJlZlwiOiB7XG4gICAgICAvLyBSZWZlcmVuY2UgdG8gY2F0YWxvZyBrZXkgLSBjcmVhdGUgZW51bSBvZiB2YWxpZCBrZXlzXG4gICAgICBjb25zdCBwYXRoID0gc2NoZW1hVHlwZS5pbm5lciBhcyBzdHJpbmc7XG4gICAgICBjb25zdCBrZXlzID0gZ2V0S2V5c0Zyb21QYXRoKHBhdGgsIGNhdGFsb2dEYXRhKTtcbiAgICAgIGlmIChrZXlzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gei5zdHJpbmcoKTtcbiAgICAgIH1cbiAgICAgIGlmIChrZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICByZXR1cm4gei5saXRlcmFsKGtleXNbMF0hKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB6LmVudW0oa2V5cyBhcyBbc3RyaW5nLCAuLi5zdHJpbmdbXV0pO1xuICAgIH1cbiAgICBjYXNlIFwicHJvcHNPZlwiOiB7XG4gICAgICAvLyBQcm9wcyBmcm9tIGNhdGFsb2cgZW50cnkgLSBjcmVhdGUgdW5pb24gb2YgYWxsIHByb3BzIHNjaGVtYXNcbiAgICAgIGNvbnN0IHBhdGggPSBzY2hlbWFUeXBlLmlubmVyIGFzIHN0cmluZztcbiAgICAgIGNvbnN0IHByb3BzU2NoZW1hcyA9IGdldFByb3BzRnJvbVBhdGgocGF0aCwgY2F0YWxvZ0RhdGEpO1xuICAgICAgaWYgKHByb3BzU2NoZW1hcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHoucmVjb3JkKHouc3RyaW5nKCksIHoudW5rbm93bigpKTtcbiAgICAgIH1cbiAgICAgIGlmIChwcm9wc1NjaGVtYXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIHJldHVybiBwcm9wc1NjaGVtYXNbMF0hO1xuICAgICAgfVxuICAgICAgLy8gRm9yIHByb3BzT2YsIHdlIG5lZWQgdG8gYmUgbGVuaWVudCBzaW5jZSB0eXBlIGRldGVybWluZXMgd2hpY2ggcHJvcHMgYXBwbHlcbiAgICAgIHJldHVybiB6LnJlY29yZCh6LnN0cmluZygpLCB6LnVua25vd24oKSk7XG4gICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gei51bmtub3duKCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZ2V0S2V5c0Zyb21QYXRoKHBhdGg6IHN0cmluZywgY2F0YWxvZ0RhdGE6IHVua25vd24pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdChcIi5cIik7XG4gIGxldCBjdXJyZW50OiB1bmtub3duID0geyBjYXRhbG9nOiBjYXRhbG9nRGF0YSB9O1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICBpZiAoY3VycmVudCAmJiB0eXBlb2YgY3VycmVudCA9PT0gXCJvYmplY3RcIikge1xuICAgICAgY3VycmVudCA9IChjdXJyZW50IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVtwYXJ0XTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfVxuICBpZiAoY3VycmVudCAmJiB0eXBlb2YgY3VycmVudCA9PT0gXCJvYmplY3RcIikge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyhjdXJyZW50KTtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbmZ1bmN0aW9uIGdldFByb3BzRnJvbVBhdGgocGF0aDogc3RyaW5nLCBjYXRhbG9nRGF0YTogdW5rbm93bik6IHouWm9kVHlwZVtdIHtcbiAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KFwiLlwiKTtcbiAgbGV0IGN1cnJlbnQ6IHVua25vd24gPSB7IGNhdGFsb2c6IGNhdGFsb2dEYXRhIH07XG4gIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgIGlmIChjdXJyZW50ICYmIHR5cGVvZiBjdXJyZW50ID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBjdXJyZW50ID0gKGN1cnJlbnQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pW3BhcnRdO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuICB9XG4gIGlmIChjdXJyZW50ICYmIHR5cGVvZiBjdXJyZW50ID09PSBcIm9iamVjdFwiKSB7XG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXMoY3VycmVudCBhcyBSZWNvcmQ8c3RyaW5nLCB7IHByb3BzPzogei5ab2RUeXBlIH0+KVxuICAgICAgLm1hcCgoZW50cnkpID0+IGVudHJ5LnByb3BzKVxuICAgICAgLmZpbHRlcigocHJvcHMpOiBwcm9wcyBpcyB6LlpvZFR5cGUgPT4gcHJvcHMgIT09IHVuZGVmaW5lZCk7XG4gIH1cbiAgcmV0dXJuIFtdO1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIHN5c3RlbSBwcm9tcHQgZnJvbSBjYXRhbG9nXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlUHJvbXB0PFREZWYgZXh0ZW5kcyBTY2hlbWFEZWZpbml0aW9uLCBUQ2F0YWxvZz4oXG4gIGNhdGFsb2c6IENhdGFsb2c8VERlZiwgVENhdGFsb2c+LFxuICBvcHRpb25zOiBQcm9tcHRPcHRpb25zLFxuKTogc3RyaW5nIHtcbiAgLy8gQ2hlY2sgaWYgc2NoZW1hIGhhcyBhIGN1c3RvbSBwcm9tcHQgdGVtcGxhdGVcbiAgaWYgKGNhdGFsb2cuc2NoZW1hLnByb21wdFRlbXBsYXRlKSB7XG4gICAgY29uc3QgY29udGV4dDogUHJvbXB0Q29udGV4dDxUQ2F0YWxvZz4gPSB7XG4gICAgICBjYXRhbG9nOiBjYXRhbG9nLmRhdGEsXG4gICAgICBjb21wb25lbnROYW1lczogY2F0YWxvZy5jb21wb25lbnROYW1lcyxcbiAgICAgIGFjdGlvbk5hbWVzOiBjYXRhbG9nLmFjdGlvbk5hbWVzLFxuICAgICAgb3B0aW9ucyxcbiAgICAgIGZvcm1hdFpvZFR5cGUsXG4gICAgfTtcbiAgICByZXR1cm4gY2F0YWxvZy5zY2hlbWEucHJvbXB0VGVtcGxhdGUoY29udGV4dCk7XG4gIH1cblxuICAvLyBEZWZhdWx0IEpTT05MIGVsZW1lbnQtdHJlZSBmb3JtYXQgKGZvciBAanNvbi1yZW5kZXIvcmVhY3QgYW5kIHNpbWlsYXIpXG4gIGNvbnN0IHtcbiAgICBzeXN0ZW0gPSBcIllvdSBhcmUgYSBVSSBnZW5lcmF0b3IgdGhhdCBvdXRwdXRzIEpTT04uXCIsXG4gICAgY3VzdG9tUnVsZXMgPSBbXSxcbiAgICBtb2RlID0gXCJnZW5lcmF0ZVwiLFxuICB9ID0gb3B0aW9ucztcblxuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgbGluZXMucHVzaChzeXN0ZW0pO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuXG4gIC8vIE91dHB1dCBmb3JtYXQgc2VjdGlvbiAtIGV4cGxhaW4gSlNPTkwgc3RyZWFtaW5nIHBhdGNoIGZvcm1hdFxuICBpZiAobW9kZSA9PT0gXCJjaGF0XCIpIHtcbiAgICBsaW5lcy5wdXNoKFwiT1VUUFVUIEZPUk1BVCAodGV4dCArIEpTT05MLCBSRkMgNjkwMiBKU09OIFBhdGNoKTpcIik7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiWW91IHJlc3BvbmQgY29udmVyc2F0aW9uYWxseS4gV2hlbiBnZW5lcmF0aW5nIFVJLCBmaXJzdCB3cml0ZSBhIGJyaWVmIGV4cGxhbmF0aW9uICgxLTMgc2VudGVuY2VzKSwgdGhlbiBvdXRwdXQgSlNPTkwgcGF0Y2ggbGluZXMgd3JhcHBlZCBpbiBhIGBgYHNwZWMgY29kZSBmZW5jZS5cIixcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBcIlRoZSBKU09OTCBsaW5lcyB1c2UgUkZDIDY5MDIgSlNPTiBQYXRjaCBvcGVyYXRpb25zIHRvIGJ1aWxkIGEgVUkgdHJlZS4gQWx3YXlzIHdyYXAgdGhlbSBpbiBhIGBgYHNwZWMgZmVuY2UgYmxvY2s6XCIsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFwiICBgYGBzcGVjXCIpO1xuICAgIGxpbmVzLnB1c2goJyAge1wib3BcIjpcImFkZFwiLFwicGF0aFwiOlwiL3Jvb3RcIixcInZhbHVlXCI6XCJtYWluXCJ9Jyk7XG4gICAgbGluZXMucHVzaChcbiAgICAgICcgIHtcIm9wXCI6XCJhZGRcIixcInBhdGhcIjpcIi9lbGVtZW50cy9tYWluXCIsXCJ2YWx1ZVwiOntcInR5cGVcIjpcIkNhcmRcIixcInByb3BzXCI6e1widGl0bGVcIjpcIkhlbGxvXCJ9LFwiY2hpbGRyZW5cIjpbXX19JyxcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXCIgIGBgYFwiKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgXCJJZiB0aGUgdXNlcidzIG1lc3NhZ2UgZG9lcyBub3QgcmVxdWlyZSBhIFVJIChlLmcuIGEgZ3JlZXRpbmcgb3IgY2xhcmlmeWluZyBxdWVzdGlvbiksIHJlc3BvbmQgd2l0aCB0ZXh0IG9ubHkg4oCUIG5vIEpTT05MLlwiLFxuICAgICk7XG4gIH0gZWxzZSB7XG4gICAgbGluZXMucHVzaChcIk9VVFBVVCBGT1JNQVQgKEpTT05MLCBSRkMgNjkwMiBKU09OIFBhdGNoKTpcIik7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiT3V0cHV0IEpTT05MIChvbmUgSlNPTiBvYmplY3QgcGVyIGxpbmUpIHVzaW5nIFJGQyA2OTAyIEpTT04gUGF0Y2ggb3BlcmF0aW9ucyB0byBidWlsZCBhIFVJIHRyZWUuXCIsXG4gICAgKTtcbiAgfVxuICBsaW5lcy5wdXNoKFxuICAgIFwiRWFjaCBsaW5lIGlzIGEgSlNPTiBwYXRjaCBvcGVyYXRpb24gKGFkZCwgcmVtb3ZlLCByZXBsYWNlKS4gU3RhcnQgd2l0aCAvcm9vdCwgdGhlbiBzdHJlYW0gL2VsZW1lbnRzIGFuZCAvc3RhdGUgcGF0Y2hlcyBpbnRlcmxlYXZlZCBzbyB0aGUgVUkgZmlsbHMgaW4gcHJvZ3Jlc3NpdmVseSBhcyBpdCBzdHJlYW1zLlwiLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFwiRXhhbXBsZSBvdXRwdXQgKGVhY2ggbGluZSBpcyBhIHNlcGFyYXRlIEpTT04gb2JqZWN0KTpcIik7XG4gIGxpbmVzLnB1c2goXCJcIik7XG5cbiAgLy8gQnVpbGQgZXhhbXBsZSB1c2luZyBhY3R1YWwgY2F0YWxvZyBjb21wb25lbnQgbmFtZXMgYW5kIHByb3BzIHRvIGF2b2lkIGhhbGx1Y2luYXRpb25zXG4gIGNvbnN0IGFsbENvbXBvbmVudHMgPSAoY2F0YWxvZy5kYXRhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5jb21wb25lbnRzIGFzXG4gICAgfCBSZWNvcmQ8c3RyaW5nLCBDYXRhbG9nQ29tcG9uZW50RGVmPlxuICAgIHwgdW5kZWZpbmVkO1xuICBjb25zdCBjbiA9IGNhdGFsb2cuY29tcG9uZW50TmFtZXM7XG4gIGNvbnN0IGNvbXAxID0gY25bMF0gfHwgXCJDb21wb25lbnRcIjtcbiAgY29uc3QgY29tcDIgPSBjbi5sZW5ndGggPiAxID8gY25bMV0hIDogY29tcDE7XG4gIGNvbnN0IGNvbXAxRGVmID0gYWxsQ29tcG9uZW50cz8uW2NvbXAxXTtcbiAgY29uc3QgY29tcDJEZWYgPSBhbGxDb21wb25lbnRzPy5bY29tcDJdO1xuICBjb25zdCBjb21wMVByb3BzID0gY29tcDFEZWYgPyBnZXRFeGFtcGxlUHJvcHMoY29tcDFEZWYpIDoge307XG4gIGNvbnN0IGNvbXAyUHJvcHMgPSBjb21wMkRlZiA/IGdldEV4YW1wbGVQcm9wcyhjb21wMkRlZikgOiB7fTtcblxuICAvLyBGaW5kIGEgc3RyaW5nIHByb3Agb24gY29tcDIgdG8gZGVtb25zdHJhdGUgJHN0YXRlIGR5bmFtaWMgYmluZGluZ3NcbiAgY29uc3QgZHluYW1pY1Byb3BOYW1lID0gY29tcDJEZWY/LnByb3BzXG4gICAgPyBmaW5kRmlyc3RTdHJpbmdQcm9wKGNvbXAyRGVmLnByb3BzKVxuICAgIDogbnVsbDtcbiAgY29uc3QgZHluYW1pY1Byb3BzID0gZHluYW1pY1Byb3BOYW1lXG4gICAgPyB7IC4uLmNvbXAyUHJvcHMsIFtkeW5hbWljUHJvcE5hbWVdOiB7ICRpdGVtOiBcInRpdGxlXCIgfSB9XG4gICAgOiBjb21wMlByb3BzO1xuXG4gIGNvbnN0IGV4YW1wbGVPdXRwdXQgPSBbXG4gICAgSlNPTi5zdHJpbmdpZnkoeyBvcDogXCJhZGRcIiwgcGF0aDogXCIvcm9vdFwiLCB2YWx1ZTogXCJtYWluXCIgfSksXG4gICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgb3A6IFwiYWRkXCIsXG4gICAgICBwYXRoOiBcIi9lbGVtZW50cy9tYWluXCIsXG4gICAgICB2YWx1ZToge1xuICAgICAgICB0eXBlOiBjb21wMSxcbiAgICAgICAgcHJvcHM6IGNvbXAxUHJvcHMsXG4gICAgICAgIGNoaWxkcmVuOiBbXCJjaGlsZC0xXCIsIFwibGlzdFwiXSxcbiAgICAgIH0sXG4gICAgfSksXG4gICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgb3A6IFwiYWRkXCIsXG4gICAgICBwYXRoOiBcIi9lbGVtZW50cy9jaGlsZC0xXCIsXG4gICAgICB2YWx1ZTogeyB0eXBlOiBjb21wMiwgcHJvcHM6IGNvbXAyUHJvcHMsIGNoaWxkcmVuOiBbXSB9LFxuICAgIH0pLFxuICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIG9wOiBcImFkZFwiLFxuICAgICAgcGF0aDogXCIvZWxlbWVudHMvbGlzdFwiLFxuICAgICAgdmFsdWU6IHtcbiAgICAgICAgdHlwZTogY29tcDEsXG4gICAgICAgIHByb3BzOiBjb21wMVByb3BzLFxuICAgICAgICByZXBlYXQ6IHsgc3RhdGVQYXRoOiBcIi9pdGVtc1wiLCBrZXk6IFwiaWRcIiB9LFxuICAgICAgICBjaGlsZHJlbjogW1wiaXRlbVwiXSxcbiAgICAgIH0sXG4gICAgfSksXG4gICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgb3A6IFwiYWRkXCIsXG4gICAgICBwYXRoOiBcIi9lbGVtZW50cy9pdGVtXCIsXG4gICAgICB2YWx1ZTogeyB0eXBlOiBjb21wMiwgcHJvcHM6IGR5bmFtaWNQcm9wcywgY2hpbGRyZW46IFtdIH0sXG4gICAgfSksXG4gICAgSlNPTi5zdHJpbmdpZnkoeyBvcDogXCJhZGRcIiwgcGF0aDogXCIvc3RhdGUvaXRlbXNcIiwgdmFsdWU6IFtdIH0pLFxuICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIG9wOiBcImFkZFwiLFxuICAgICAgcGF0aDogXCIvc3RhdGUvaXRlbXMvMFwiLFxuICAgICAgdmFsdWU6IHsgaWQ6IFwiMVwiLCB0aXRsZTogXCJGaXJzdCBJdGVtXCIgfSxcbiAgICB9KSxcbiAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBvcDogXCJhZGRcIixcbiAgICAgIHBhdGg6IFwiL3N0YXRlL2l0ZW1zLzFcIixcbiAgICAgIHZhbHVlOiB7IGlkOiBcIjJcIiwgdGl0bGU6IFwiU2Vjb25kIEl0ZW1cIiB9LFxuICAgIH0pLFxuICBdLmpvaW4oXCJcXG5cIik7XG5cbiAgbGluZXMucHVzaChgJHtleGFtcGxlT3V0cHV0fVxuXG5Ob3RlOiBzdGF0ZSBwYXRjaGVzIGFwcGVhciByaWdodCBhZnRlciB0aGUgZWxlbWVudHMgdGhhdCB1c2UgdGhlbSwgc28gdGhlIFVJIGZpbGxzIGluIGFzIGl0IHN0cmVhbXMuIE9OTFkgdXNlIGNvbXBvbmVudCB0eXBlcyBmcm9tIHRoZSBBVkFJTEFCTEUgQ09NUE9ORU5UUyBsaXN0IGJlbG93LmApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuXG4gIC8vIEluaXRpYWwgc3RhdGUgc2VjdGlvblxuICBsaW5lcy5wdXNoKFwiSU5JVElBTCBTVEFURTpcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgXCJTcGVjcyBpbmNsdWRlIGEgL3N0YXRlIGZpZWxkIHRvIHNlZWQgdGhlIHN0YXRlIG1vZGVsLiBDb21wb25lbnRzIHdpdGggeyAkYmluZFN0YXRlIH0gb3IgeyAkYmluZEl0ZW0gfSByZWFkIGZyb20gYW5kIHdyaXRlIHRvIHRoaXMgc3RhdGUsIGFuZCAkc3RhdGUgZXhwcmVzc2lvbnMgcmVhZCBmcm9tIGl0LlwiLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiQ1JJVElDQUw6IFlvdSBNVVNUIGluY2x1ZGUgc3RhdGUgcGF0Y2hlcyB3aGVuZXZlciB5b3VyIFVJIGRpc3BsYXlzIGRhdGEgdmlhICRzdGF0ZSwgJGJpbmRTdGF0ZSwgJGJpbmRJdGVtLCAkaXRlbSwgb3IgJGluZGV4IGV4cHJlc3Npb25zLCBvciB1c2VzIHJlcGVhdCB0byBpdGVyYXRlIG92ZXIgYXJyYXlzLiBXaXRob3V0IHN0YXRlLCB0aGVzZSByZWZlcmVuY2VzIHJlc29sdmUgdG8gbm90aGluZyBhbmQgcmVwZWF0IGxpc3RzIHJlbmRlciB6ZXJvIGl0ZW1zLlwiLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiT3V0cHV0IHN0YXRlIHBhdGNoZXMgcmlnaHQgYWZ0ZXIgdGhlIGVsZW1lbnRzIHRoYXQgcmVmZXJlbmNlIHRoZW0sIHNvIHRoZSBVSSBmaWxscyBpbiBwcm9ncmVzc2l2ZWx5IGFzIGl0IHN0cmVhbXMuXCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgXCJTdHJlYW0gc3RhdGUgcHJvZ3Jlc3NpdmVseSAtIG91dHB1dCBvbmUgcGF0Y2ggcGVyIGFycmF5IGl0ZW0gaW5zdGVhZCBvZiBvbmUgZ2lhbnQgYmxvYjpcIixcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnICBGb3IgYXJyYXlzOiB7XCJvcFwiOlwiYWRkXCIsXCJwYXRoXCI6XCIvc3RhdGUvcG9zdHMvMFwiLFwidmFsdWVcIjp7XCJpZFwiOlwiMVwiLFwidGl0bGVcIjpcIkZpcnN0IFBvc3RcIiwuLi59fSB0aGVuIC9zdGF0ZS9wb3N0cy8xLCAvc3RhdGUvcG9zdHMvMiwgZXRjLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJyAgRm9yIHNjYWxhcnM6IHtcIm9wXCI6XCJhZGRcIixcInBhdGhcIjpcIi9zdGF0ZS9uZXdUb2RvVGV4dFwiLFwidmFsdWVcIjpcIlwifScsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJyAgSW5pdGlhbGl6ZSB0aGUgYXJyYXkgZmlyc3QgaWYgbmVlZGVkOiB7XCJvcFwiOlwiYWRkXCIsXCJwYXRoXCI6XCIvc3RhdGUvcG9zdHNcIixcInZhbHVlXCI6W119JyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnV2hlbiBjb250ZW50IGNvbWVzIGZyb20gdGhlIHN0YXRlIG1vZGVsLCB1c2UgeyBcIiRzdGF0ZVwiOiBcIi9zb21lL3BhdGhcIiB9IGR5bmFtaWMgcHJvcHMgdG8gZGlzcGxheSBpdCBpbnN0ZWFkIG9mIGhhcmRjb2RpbmcgdGhlIHNhbWUgdmFsdWUgaW4gYm90aCBzdGF0ZSBhbmQgcHJvcHMuIFRoZSBzdGF0ZSBtb2RlbCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aC4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiSW5jbHVkZSByZWFsaXN0aWMgc2FtcGxlIGRhdGEgaW4gc3RhdGUuIEZvciBibG9nczogMy00IHBvc3RzIHdpdGggdGl0bGVzLCBleGNlcnB0cywgYXV0aG9ycywgZGF0ZXMuIEZvciBwcm9kdWN0IGxpc3RzOiAzLTUgaXRlbXMgd2l0aCBuYW1lcywgcHJpY2VzLCBkZXNjcmlwdGlvbnMuIE5ldmVyIGxlYXZlIGFycmF5cyBlbXB0eS5cIixcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcbiAgbGluZXMucHVzaChcIkRZTkFNSUMgTElTVFMgKHJlcGVhdCBmaWVsZCk6XCIpO1xuICBsaW5lcy5wdXNoKFxuICAgICdBbnkgZWxlbWVudCBjYW4gaGF2ZSBhIHRvcC1sZXZlbCBcInJlcGVhdFwiIGZpZWxkIHRvIHJlbmRlciBpdHMgY2hpbGRyZW4gb25jZSBwZXIgaXRlbSBpbiBhIHN0YXRlIGFycmF5OiB7IFwicmVwZWF0XCI6IHsgXCJzdGF0ZVBhdGhcIjogXCIvYXJyYXlQYXRoXCIsIFwia2V5XCI6IFwiaWRcIiB9IH0uJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnVGhlIGVsZW1lbnQgaXRzZWxmIHJlbmRlcnMgb25jZSAoYXMgdGhlIGNvbnRhaW5lciksIGFuZCBpdHMgY2hpbGRyZW4gYXJlIGV4cGFuZGVkIG9uY2UgcGVyIGFycmF5IGl0ZW0uIFwic3RhdGVQYXRoXCIgaXMgdGhlIHN0YXRlIGFycmF5IHBhdGguIFwia2V5XCIgaXMgYW4gb3B0aW9uYWwgZmllbGQgbmFtZSBvbiBlYWNoIGl0ZW0gZm9yIHN0YWJsZSBSZWFjdCBrZXlzLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgYEV4YW1wbGU6ICR7SlNPTi5zdHJpbmdpZnkoeyB0eXBlOiBjb21wMSwgcHJvcHM6IGNvbXAxUHJvcHMsIHJlcGVhdDogeyBzdGF0ZVBhdGg6IFwiL3RvZG9zXCIsIGtleTogXCJpZFwiIH0sIGNoaWxkcmVuOiBbXCJ0b2RvLWl0ZW1cIl0gfSl9YCxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnSW5zaWRlIGNoaWxkcmVuIG9mIGEgcmVwZWF0ZWQgZWxlbWVudCwgdXNlIHsgXCIkaXRlbVwiOiBcImZpZWxkXCIgfSB0byByZWFkIGEgZmllbGQgZnJvbSB0aGUgY3VycmVudCBpdGVtLCBhbmQgeyBcIiRpbmRleFwiOiB0cnVlIH0gdG8gZ2V0IHRoZSBjdXJyZW50IGFycmF5IGluZGV4LiBGb3IgdHdvLXdheSBiaW5kaW5nIHRvIGFuIGl0ZW0gZmllbGQgdXNlIHsgXCIkYmluZEl0ZW1cIjogXCJjb21wbGV0ZWRcIiB9IG9uIHRoZSBhcHByb3ByaWF0ZSBwcm9wLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgXCJBTFdBWVMgdXNlIHRoZSByZXBlYXQgZmllbGQgZm9yIGxpc3RzIGJhY2tlZCBieSBzdGF0ZSBhcnJheXMuIE5FVkVSIGhhcmRjb2RlIGluZGl2aWR1YWwgZWxlbWVudHMgZm9yIGVhY2ggYXJyYXkgaXRlbS5cIixcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnSU1QT1JUQU5UOiBcInJlcGVhdFwiIGlzIGEgdG9wLWxldmVsIGZpZWxkIG9uIHRoZSBlbGVtZW50IChzaWJsaW5nIG9mIHR5cGUvcHJvcHMvY2hpbGRyZW4pLCBOT1QgaW5zaWRlIHByb3BzLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG4gIGxpbmVzLnB1c2goXCJBUlJBWSBTVEFURSBBQ1RJT05TOlwiKTtcbiAgbGluZXMucHVzaChcbiAgICAnVXNlIGFjdGlvbiBcInB1c2hTdGF0ZVwiIHRvIGFwcGVuZCBpdGVtcyB0byBhcnJheXMuIFBhcmFtczogeyBzdGF0ZVBhdGg6IFwiL2FycmF5UGF0aFwiLCB2YWx1ZTogeyAuLi5pdGVtIH0sIGNsZWFyU3RhdGVQYXRoOiBcIi9pbnB1dFBhdGhcIiB9LicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJ1ZhbHVlcyBpbnNpZGUgcHVzaFN0YXRlIGNhbiBjb250YWluIHsgXCIkc3RhdGVcIjogXCIvc3RhdGVQYXRoXCIgfSByZWZlcmVuY2VzIHRvIHJlYWQgY3VycmVudCBzdGF0ZSAoZS5nLiB0aGUgdGV4dCBmcm9tIGFuIGlucHV0IGZpZWxkKS4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICdVc2UgXCIkaWRcIiBpbnNpZGUgYSBwdXNoU3RhdGUgdmFsdWUgdG8gYXV0by1nZW5lcmF0ZSBhIHVuaXF1ZSBJRC4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICdFeGFtcGxlOiBvbjogeyBcInByZXNzXCI6IHsgXCJhY3Rpb25cIjogXCJwdXNoU3RhdGVcIiwgXCJwYXJhbXNcIjogeyBcInN0YXRlUGF0aFwiOiBcIi90b2Rvc1wiLCBcInZhbHVlXCI6IHsgXCJpZFwiOiBcIiRpZFwiLCBcInRpdGxlXCI6IHsgXCIkc3RhdGVcIjogXCIvbmV3VG9kb1RleHRcIiB9LCBcImNvbXBsZXRlZFwiOiBmYWxzZSB9LCBcImNsZWFyU3RhdGVQYXRoXCI6IFwiL25ld1RvZG9UZXh0XCIgfSB9IH0nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICdVc2UgYWN0aW9uIFwicmVtb3ZlU3RhdGVcIiB0byByZW1vdmUgaXRlbXMgZnJvbSBhcnJheXMgYnkgaW5kZXguIFBhcmFtczogeyBzdGF0ZVBhdGg6IFwiL2FycmF5UGF0aFwiLCBpbmRleDogTiB9LiBJbnNpZGUgYSByZXBlYXRlZCBlbGVtZW50XFwncyBjaGlsZHJlbiwgdXNlIHsgXCIkaW5kZXhcIjogdHJ1ZSB9IGZvciB0aGUgY3VycmVudCBpdGVtIGluZGV4LiBBY3Rpb24gcGFyYW1zIHN1cHBvcnQgdGhlIHNhbWUgZXhwcmVzc2lvbnMgYXMgcHJvcHM6IHsgXCIkaXRlbVwiOiBcImZpZWxkXCIgfSByZXNvbHZlcyB0byB0aGUgYWJzb2x1dGUgc3RhdGUgcGF0aCwgeyBcIiRpbmRleFwiOiB0cnVlIH0gcmVzb2x2ZXMgdG8gdGhlIGluZGV4IG51bWJlciwgYW5kIHsgXCIkc3RhdGVcIjogXCIvcGF0aFwiIH0gcmVhZHMgYSB2YWx1ZSBmcm9tIHN0YXRlLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgXCJGb3IgbGlzdHMgd2hlcmUgdXNlcnMgY2FuIGFkZC9yZW1vdmUgaXRlbXMgKHRvZG9zLCBjYXJ0cywgZXRjLiksIHVzZSBwdXNoU3RhdGUgYW5kIHJlbW92ZVN0YXRlIGluc3RlYWQgb2YgaGFyZGNvZGluZyB3aXRoIHNldFN0YXRlLlwiLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFxuICAgICdJTVBPUlRBTlQ6IFN0YXRlIHBhdGhzIHVzZSBSRkMgNjkwMSBKU09OIFBvaW50ZXIgc3ludGF4IChlLmcuIFwiL3RvZG9zLzAvdGl0bGVcIikuIERvIE5PVCB1c2UgSmF2YVNjcmlwdC1zdHlsZSBkb3Qgbm90YXRpb24gKGUuZy4gXCIvdG9kb3MubGVuZ3RoXCIgaXMgV1JPTkcpLiBUbyBnZW5lcmF0ZSB1bmlxdWUgSURzIGZvciBuZXcgaXRlbXMsIHVzZSBcIiRpZFwiIGluc3RlYWQgb2YgdHJ5aW5nIHRvIHJlYWQgYXJyYXkgbGVuZ3RoLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG5cbiAgLy8gQ29tcG9uZW50cyBzZWN0aW9uIOKAlCByZXVzZSB0aGUgdHlwZWQgcmVmZXJlbmNlIGZyb20gZXhhbXBsZSBnZW5lcmF0aW9uXG4gIGNvbnN0IGNvbXBvbmVudHMgPSBhbGxDb21wb25lbnRzO1xuXG4gIGlmIChjb21wb25lbnRzKSB7XG4gICAgbGluZXMucHVzaChgQVZBSUxBQkxFIENPTVBPTkVOVFMgKCR7Y2F0YWxvZy5jb21wb25lbnROYW1lcy5sZW5ndGh9KTpgKTtcbiAgICBsaW5lcy5wdXNoKFwiXCIpO1xuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgZGVmXSBvZiBPYmplY3QuZW50cmllcyhjb21wb25lbnRzKSkge1xuICAgICAgY29uc3QgcHJvcHNTdHIgPSBkZWYucHJvcHMgPyBmb3JtYXRab2RUeXBlKGRlZi5wcm9wcykgOiBcInt9XCI7XG4gICAgICBjb25zdCBoYXNDaGlsZHJlbiA9IGRlZi5zbG90cyAmJiBkZWYuc2xvdHMubGVuZ3RoID4gMDtcbiAgICAgIGNvbnN0IGNoaWxkcmVuU3RyID0gaGFzQ2hpbGRyZW4gPyBcIiBbYWNjZXB0cyBjaGlsZHJlbl1cIiA6IFwiXCI7XG4gICAgICBjb25zdCBldmVudHNTdHIgPVxuICAgICAgICBkZWYuZXZlbnRzICYmIGRlZi5ldmVudHMubGVuZ3RoID4gMFxuICAgICAgICAgID8gYCBbZXZlbnRzOiAke2RlZi5ldmVudHMuam9pbihcIiwgXCIpfV1gXG4gICAgICAgICAgOiBcIlwiO1xuICAgICAgY29uc3QgZGVzY1N0ciA9IGRlZi5kZXNjcmlwdGlvbiA/IGAgLSAke2RlZi5kZXNjcmlwdGlvbn1gIDogXCJcIjtcbiAgICAgIGxpbmVzLnB1c2goYC0gJHtuYW1lfTogJHtwcm9wc1N0cn0ke2Rlc2NTdHJ9JHtjaGlsZHJlblN0cn0ke2V2ZW50c1N0cn1gKTtcbiAgICB9XG4gICAgbGluZXMucHVzaChcIlwiKTtcbiAgfVxuXG4gIC8vIEFjdGlvbnMgc2VjdGlvblxuICBjb25zdCBhY3Rpb25zID0gKGNhdGFsb2cuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuYWN0aW9ucyBhc1xuICAgIHwgUmVjb3JkPHN0cmluZywgeyBwYXJhbXM/OiB6LlpvZFR5cGU7IGRlc2NyaXB0aW9uPzogc3RyaW5nIH0+XG4gICAgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3QgYnVpbHRJbkFjdGlvbnMgPSBjYXRhbG9nLnNjaGVtYS5idWlsdEluQWN0aW9ucyA/PyBbXTtcbiAgY29uc3QgaGFzQ3VzdG9tQWN0aW9ucyA9IGFjdGlvbnMgJiYgY2F0YWxvZy5hY3Rpb25OYW1lcy5sZW5ndGggPiAwO1xuICBjb25zdCBoYXNCdWlsdEluQWN0aW9ucyA9IGJ1aWx0SW5BY3Rpb25zLmxlbmd0aCA+IDA7XG5cbiAgaWYgKGhhc0N1c3RvbUFjdGlvbnMgfHwgaGFzQnVpbHRJbkFjdGlvbnMpIHtcbiAgICBsaW5lcy5wdXNoKFwiQVZBSUxBQkxFIEFDVElPTlM6XCIpO1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG5cbiAgICAvLyBCdWlsdC1pbiBhY3Rpb25zIChoYW5kbGVkIGJ5IHJ1bnRpbWUsIGFsd2F5cyBhdmFpbGFibGUpXG4gICAgZm9yIChjb25zdCBhY3Rpb24gb2YgYnVpbHRJbkFjdGlvbnMpIHtcbiAgICAgIGxpbmVzLnB1c2goYC0gJHthY3Rpb24ubmFtZX06ICR7YWN0aW9uLmRlc2NyaXB0aW9ufSBbYnVpbHQtaW5dYCk7XG4gICAgfVxuXG4gICAgLy8gQ3VzdG9tIGFjdGlvbnMgKGRlY2xhcmVkIGluIGNhdGFsb2csIHJlcXVpcmUgaGFuZGxlcnMpXG4gICAgaWYgKGhhc0N1c3RvbUFjdGlvbnMpIHtcbiAgICAgIGZvciAoY29uc3QgW25hbWUsIGRlZl0gb2YgT2JqZWN0LmVudHJpZXMoYWN0aW9ucykpIHtcbiAgICAgICAgbGluZXMucHVzaChgLSAke25hbWV9JHtkZWYuZGVzY3JpcHRpb24gPyBgOiAke2RlZi5kZXNjcmlwdGlvbn1gIDogXCJcIn1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsaW5lcy5wdXNoKFwiXCIpO1xuICB9XG5cbiAgLy8gRXZlbnRzIHNlY3Rpb25cbiAgbGluZXMucHVzaChcIkVWRU5UUyAodGhlIGBvbmAgZmllbGQpOlwiKTtcbiAgbGluZXMucHVzaChcbiAgICBcIkVsZW1lbnRzIGNhbiBoYXZlIGFuIG9wdGlvbmFsIGBvbmAgZmllbGQgdG8gYmluZCBldmVudHMgdG8gYWN0aW9ucy4gVGhlIGBvbmAgZmllbGQgaXMgYSB0b3AtbGV2ZWwgZmllbGQgb24gdGhlIGVsZW1lbnQgKHNpYmxpbmcgb2YgdHlwZS9wcm9wcy9jaGlsZHJlbiksIE5PVCBpbnNpZGUgcHJvcHMuXCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJ0VhY2gga2V5IGluIGBvbmAgaXMgYW4gZXZlbnQgbmFtZSAoZnJvbSB0aGUgY29tcG9uZW50XFwncyBzdXBwb3J0ZWQgZXZlbnRzKSwgYW5kIHRoZSB2YWx1ZSBpcyBhbiBhY3Rpb24gYmluZGluZzogYHsgXCJhY3Rpb25cIjogXCI8YWN0aW9uTmFtZT5cIiwgXCJwYXJhbXNcIjogeyAuLi4gfSB9YC4nLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFwiRXhhbXBsZTpcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgYCAgJHtKU09OLnN0cmluZ2lmeSh7IHR5cGU6IGNvbXAxLCBwcm9wczogY29tcDFQcm9wcywgb246IHsgcHJlc3M6IHsgYWN0aW9uOiBcInNldFN0YXRlXCIsIHBhcmFtczogeyBzdGF0ZVBhdGg6IFwiL3NhdmVkXCIsIHZhbHVlOiB0cnVlIH0gfSB9LCBjaGlsZHJlbjogW10gfSl9YCxcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcbiAgbGluZXMucHVzaChcbiAgICAnQWN0aW9uIHBhcmFtcyBjYW4gdXNlIGR5bmFtaWMgcmVmZXJlbmNlcyB0byByZWFkIGZyb20gc3RhdGU6IHsgXCIkc3RhdGVcIjogXCIvc3RhdGVQYXRoXCIgfS4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiSU1QT1JUQU5UOiBEbyBOT1QgcHV0IGFjdGlvbi9hY3Rpb25QYXJhbXMgaW5zaWRlIHByb3BzLiBBbHdheXMgdXNlIHRoZSBgb25gIGZpZWxkIGZvciBldmVudCBiaW5kaW5ncy5cIixcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcblxuICAvLyBWaXNpYmlsaXR5IGNvbmRpdGlvbnNcbiAgbGluZXMucHVzaChcIlZJU0lCSUxJVFkgQ09ORElUSU9OUzpcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgXCJFbGVtZW50cyBjYW4gaGF2ZSBhbiBvcHRpb25hbCBgdmlzaWJsZWAgZmllbGQgdG8gY29uZGl0aW9uYWxseSBzaG93L2hpZGUgYmFzZWQgb24gc3RhdGUuIElNUE9SVEFOVDogYHZpc2libGVgIGlzIGEgdG9wLWxldmVsIGZpZWxkIG9uIHRoZSBlbGVtZW50IG9iamVjdCAoc2libGluZyBvZiB0eXBlL3Byb3BzL2NoaWxkcmVuKSwgTk9UIGluc2lkZSBwcm9wcy5cIixcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICBgQ29ycmVjdDogJHtKU09OLnN0cmluZ2lmeSh7IHR5cGU6IGNvbXAxLCBwcm9wczogY29tcDFQcm9wcywgdmlzaWJsZTogeyAkc3RhdGU6IFwiL2FjdGl2ZVRhYlwiLCBlcTogXCJob21lXCIgfSwgY2hpbGRyZW46IFtcIi4uLlwiXSB9KX1gLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICctIGB7IFwiJHN0YXRlXCI6IFwiL3BhdGhcIiB9YCAtIHZpc2libGUgd2hlbiBzdGF0ZSBhdCBwYXRoIGlzIHRydXRoeScsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJy0gYHsgXCIkc3RhdGVcIjogXCIvcGF0aFwiLCBcIm5vdFwiOiB0cnVlIH1gIC0gdmlzaWJsZSB3aGVuIHN0YXRlIGF0IHBhdGggaXMgZmFsc3knLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICctIGB7IFwiJHN0YXRlXCI6IFwiL3BhdGhcIiwgXCJlcVwiOiBcInZhbHVlXCIgfWAgLSB2aXNpYmxlIHdoZW4gc3RhdGUgZXF1YWxzIHZhbHVlJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnLSBgeyBcIiRzdGF0ZVwiOiBcIi9wYXRoXCIsIFwibmVxXCI6IFwidmFsdWVcIiB9YCAtIHZpc2libGUgd2hlbiBzdGF0ZSBkb2VzIG5vdCBlcXVhbCB2YWx1ZScsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJy0gYHsgXCIkc3RhdGVcIjogXCIvcGF0aFwiLCBcImd0XCI6IE4gfWAgLyBgZ3RlYCAvIGBsdGAgLyBgbHRlYCAtIG51bWVyaWMgY29tcGFyaXNvbnMnLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiLSBVc2UgT05FIG9wZXJhdG9yIHBlciBjb25kaXRpb24gKGVxLCBuZXEsIGd0LCBndGUsIGx0LCBsdGUpLiBEbyBub3QgY29tYmluZSBtdWx0aXBsZSBvcGVyYXRvcnMuXCIsXG4gICk7XG4gIGxpbmVzLnB1c2goJy0gQW55IGNvbmRpdGlvbiBjYW4gYWRkIGBcIm5vdFwiOiB0cnVlYCB0byBpbnZlcnQgaXRzIHJlc3VsdCcpO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiLSBgW2NvbmRpdGlvbiwgY29uZGl0aW9uXWAgLSBhbGwgY29uZGl0aW9ucyBtdXN0IGJlIHRydWUgKGltcGxpY2l0IEFORClcIixcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnLSBgeyBcIiRhbmRcIjogW2NvbmRpdGlvbiwgY29uZGl0aW9uXSB9YCAtIGV4cGxpY2l0IEFORCAodXNlIHdoZW4gbmVzdGluZyBpbnNpZGUgJG9yKScsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJy0gYHsgXCIkb3JcIjogW2NvbmRpdGlvbiwgY29uZGl0aW9uXSB9YCAtIGF0IGxlYXN0IG9uZSBtdXN0IGJlIHRydWUgKE9SKScsXG4gICk7XG4gIGxpbmVzLnB1c2goXCItIGB0cnVlYCAvIGBmYWxzZWAgLSBhbHdheXMgdmlzaWJsZS9oaWRkZW5cIik7XG4gIGxpbmVzLnB1c2goXCJcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgXCJVc2UgYSBjb21wb25lbnQgd2l0aCBvbi5wcmVzcyBib3VuZCB0byBzZXRTdGF0ZSB0byB1cGRhdGUgc3RhdGUgYW5kIGRyaXZlIHZpc2liaWxpdHkuXCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgYEV4YW1wbGU6IEEgJHtjb21wMX0gd2l0aCBvbjogeyBcInByZXNzXCI6IHsgXCJhY3Rpb25cIjogXCJzZXRTdGF0ZVwiLCBcInBhcmFtc1wiOiB7IFwic3RhdGVQYXRoXCI6IFwiL2FjdGl2ZVRhYlwiLCBcInZhbHVlXCI6IFwiaG9tZVwiIH0gfSB9IHNldHMgc3RhdGUsIHRoZW4gYSBjb250YWluZXIgd2l0aCB2aXNpYmxlOiB7IFwiJHN0YXRlXCI6IFwiL2FjdGl2ZVRhYlwiLCBcImVxXCI6IFwiaG9tZVwiIH0gc2hvd3Mgb25seSB3aGVuIHRoYXQgdGFiIGlzIGFjdGl2ZS5gLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFxuICAgICdGb3IgdGFiIHBhdHRlcm5zIHdoZXJlIHRoZSBmaXJzdC9kZWZhdWx0IHRhYiBzaG91bGQgYmUgdmlzaWJsZSB3aGVuIG5vIHRhYiBpcyBzZWxlY3RlZCB5ZXQsIHVzZSAkb3IgdG8gaGFuZGxlIGJvdGggY2FzZXM6IHZpc2libGU6IHsgXCIkb3JcIjogW3sgXCIkc3RhdGVcIjogXCIvYWN0aXZlVGFiXCIsIFwiZXFcIjogXCJob21lXCIgfSwgeyBcIiRzdGF0ZVwiOiBcIi9hY3RpdmVUYWJcIiwgXCJub3RcIjogdHJ1ZSB9XSB9LiBUaGlzIGVuc3VyZXMgdGhlIGZpcnN0IHRhYiBpcyB2aXNpYmxlIGJvdGggd2hlbiBleHBsaWNpdGx5IHNlbGVjdGVkIEFORCB3aGVuIC9hY3RpdmVUYWIgaXMgbm90IHlldCBzZXQuJyxcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcblxuICAvLyBEeW5hbWljIHByb3AgZXhwcmVzc2lvbnNcbiAgbGluZXMucHVzaChcIkRZTkFNSUMgUFJPUFM6XCIpO1xuICBsaW5lcy5wdXNoKFxuICAgIFwiQW55IHByb3AgdmFsdWUgY2FuIGJlIGEgZHluYW1pYyBleHByZXNzaW9uIHRoYXQgcmVzb2x2ZXMgYmFzZWQgb24gc3RhdGUuIFRocmVlIGZvcm1zIGFyZSBzdXBwb3J0ZWQ6XCIsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgJzEuIFJlYWQtb25seSBzdGF0ZTogYHsgXCIkc3RhdGVcIjogXCIvc3RhdGVQYXRoXCIgfWAgLSByZXNvbHZlcyB0byB0aGUgdmFsdWUgYXQgdGhhdCBzdGF0ZSBwYXRoIChvbmUtd2F5IHJlYWQpLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXG4gICAgJyAgIEV4YW1wbGU6IGBcImNvbG9yXCI6IHsgXCIkc3RhdGVcIjogXCIvdGhlbWUvcHJpbWFyeVwiIH1gIHJlYWRzIHRoZSBjb2xvciBmcm9tIHN0YXRlLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgJzIuIFR3by13YXkgYmluZGluZzogYHsgXCIkYmluZFN0YXRlXCI6IFwiL3N0YXRlUGF0aFwiIH1gIC0gcmVzb2x2ZXMgdG8gdGhlIHZhbHVlIGF0IHRoZSBzdGF0ZSBwYXRoIEFORCBlbmFibGVzIHdyaXRlLWJhY2suIFVzZSBvbiBmb3JtIGlucHV0IHByb3BzICh2YWx1ZSwgY2hlY2tlZCwgcHJlc3NlZCwgZXRjLikuJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnICAgRXhhbXBsZTogYFwidmFsdWVcIjogeyBcIiRiaW5kU3RhdGVcIjogXCIvZm9ybS9lbWFpbFwiIH1gIGJpbmRzIHRoZSBpbnB1dCB2YWx1ZSB0byAvZm9ybS9lbWFpbC4nLFxuICApO1xuICBsaW5lcy5wdXNoKFxuICAgICcgICBJbnNpZGUgcmVwZWF0IHNjb3BlczogYFwiY2hlY2tlZFwiOiB7IFwiJGJpbmRJdGVtXCI6IFwiY29tcGxldGVkXCIgfWAgYmluZHMgdG8gdGhlIGN1cnJlbnQgaXRlbVxcJ3MgY29tcGxldGVkIGZpZWxkLicsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgJzMuIENvbmRpdGlvbmFsOiBgeyBcIiRjb25kXCI6IDxjb25kaXRpb24+LCBcIiR0aGVuXCI6IDx2YWx1ZT4sIFwiJGVsc2VcIjogPHZhbHVlPiB9YCAtIGV2YWx1YXRlcyB0aGUgY29uZGl0aW9uIChzYW1lIHN5bnRheCBhcyB2aXNpYmlsaXR5IGNvbmRpdGlvbnMpIGFuZCBwaWNrcyB0aGUgbWF0Y2hpbmcgdmFsdWUuJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnICAgRXhhbXBsZTogYFwiY29sb3JcIjogeyBcIiRjb25kXCI6IHsgXCIkc3RhdGVcIjogXCIvYWN0aXZlVGFiXCIsIFwiZXFcIjogXCJob21lXCIgfSwgXCIkdGhlblwiOiBcIiMwMDdBRkZcIiwgXCIkZWxzZVwiOiBcIiM4RThFOTNcIiB9YCcsXG4gICk7XG4gIGxpbmVzLnB1c2goXCJcIik7XG4gIGxpbmVzLnB1c2goXG4gICAgXCJVc2UgJGJpbmRTdGF0ZSBmb3IgZm9ybSBpbnB1dHMgKHRleHQgZmllbGRzLCBjaGVja2JveGVzLCBzZWxlY3RzLCBzbGlkZXJzLCBldGMuKSBhbmQgJHN0YXRlIGZvciByZWFkLW9ubHkgZGF0YSBkaXNwbGF5LiBJbnNpZGUgcmVwZWF0IHNjb3BlcywgdXNlICRiaW5kSXRlbSBmb3IgZm9ybSBpbnB1dHMgYm91bmQgdG8gdGhlIGN1cnJlbnQgaXRlbS4gVXNlIGR5bmFtaWMgcHJvcHMgaW5zdGVhZCBvZiBkdXBsaWNhdGluZyBlbGVtZW50cyB3aXRoIG9wcG9zaW5nIHZpc2libGUgY29uZGl0aW9ucyB3aGVuIG9ubHkgcHJvcCB2YWx1ZXMgZGlmZmVyLlwiLFxuICApO1xuICBsaW5lcy5wdXNoKFwiXCIpO1xuICBsaW5lcy5wdXNoKFxuICAgICc0LiBUZW1wbGF0ZTogYHsgXCIkdGVtcGxhdGVcIjogXCJIZWxsbywgJHsvbmFtZX0hXCIgfWAgLSBpbnRlcnBvbGF0ZXMgYCR7L3BhdGh9YCByZWZlcmVuY2VzIGluIHRoZSBzdHJpbmcgd2l0aCB2YWx1ZXMgZnJvbSB0aGUgc3RhdGUgbW9kZWwuJyxcbiAgKTtcbiAgbGluZXMucHVzaChcbiAgICAnICAgRXhhbXBsZTogYFwibGFiZWxcIjogeyBcIiR0ZW1wbGF0ZVwiOiBcIkl0ZW1zOiAkey9jYXJ0L2NvdW50fSB8IFRvdGFsOiAkey9jYXJ0L3RvdGFsfVwiIH1gIHJlbmRlcnMgXCJJdGVtczogMyB8IFRvdGFsOiA0Mi4wMFwiIHdoZW4gL2NhcnQvY291bnQgaXMgMyBhbmQgL2NhcnQvdG90YWwgaXMgNDIuMDAuJyxcbiAgKTtcbiAgbGluZXMucHVzaChcIlwiKTtcblxuICAvLyAkY29tcHV0ZWQgc2VjdGlvbiDigJQgb25seSBlbWl0IHdoZW4gY2F0YWxvZyBkZWZpbmVzIGZ1bmN0aW9uc1xuICBjb25zdCBjYXRhbG9nRnVuY3Rpb25zID0gKGNhdGFsb2cuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuZnVuY3Rpb25zO1xuICBpZiAoY2F0YWxvZ0Z1bmN0aW9ucyAmJiBPYmplY3Qua2V5cyhjYXRhbG9nRnVuY3Rpb25zKS5sZW5ndGggPiAwKSB7XG4gICAgbGluZXMucHVzaChcbiAgICAgICc1LiBDb21wdXRlZDogYHsgXCIkY29tcHV0ZWRcIjogXCI8ZnVuY3Rpb25OYW1lPlwiLCBcImFyZ3NcIjogeyBcImtleVwiOiA8ZXhwcmVzc2lvbj4gfSB9YCAtIGNhbGxzIGEgcmVnaXN0ZXJlZCBmdW5jdGlvbiB3aXRoIHJlc29sdmVkIGFyZ3MgYW5kIHJldHVybnMgdGhlIHJlc3VsdC4nLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcbiAgICAgICcgICBFeGFtcGxlOiBgXCJ2YWx1ZVwiOiB7IFwiJGNvbXB1dGVkXCI6IFwiZnVsbE5hbWVcIiwgXCJhcmdzXCI6IHsgXCJmaXJzdFwiOiB7IFwiJHN0YXRlXCI6IFwiL2Zvcm0vZmlyc3ROYW1lXCIgfSwgXCJsYXN0XCI6IHsgXCIkc3RhdGVcIjogXCIvZm9ybS9sYXN0TmFtZVwiIH0gfSB9YCcsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFwiICAgQXZhaWxhYmxlIGZ1bmN0aW9uczpcIik7XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIE9iamVjdC5rZXlzKFxuICAgICAgY2F0YWxvZ0Z1bmN0aW9ucyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICApKSB7XG4gICAgICBsaW5lcy5wdXNoKGAgICAtICR7bmFtZX1gKTtcbiAgICB9XG4gICAgbGluZXMucHVzaChcIlwiKTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRpb24gc2VjdGlvbiDigJQgb25seSBlbWl0IHdoZW4gYXQgbGVhc3Qgb25lIGNvbXBvbmVudCBoYXMgYSBgY2hlY2tzYCBwcm9wXG4gIGNvbnN0IGhhc0NoZWNrc0NvbXBvbmVudHMgPSBhbGxDb21wb25lbnRzXG4gICAgPyBPYmplY3QuZW50cmllcyhhbGxDb21wb25lbnRzKS5zb21lKChbLCBkZWZdKSA9PiB7XG4gICAgICAgIGlmICghZGVmLnByb3BzKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIGNvbnN0IGZvcm1hdHRlZCA9IGZvcm1hdFpvZFR5cGUoZGVmLnByb3BzKTtcbiAgICAgICAgcmV0dXJuIGZvcm1hdHRlZC5pbmNsdWRlcyhcImNoZWNrc1wiKTtcbiAgICAgIH0pXG4gICAgOiBmYWxzZTtcblxuICBpZiAoaGFzQ2hlY2tzQ29tcG9uZW50cykge1xuICAgIGxpbmVzLnB1c2goXCJWQUxJREFUSU9OOlwiKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgXCJGb3JtIGNvbXBvbmVudHMgdGhhdCBhY2NlcHQgYSBgY2hlY2tzYCBwcm9wIHN1cHBvcnQgY2xpZW50LXNpZGUgdmFsaWRhdGlvbi5cIixcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICAnRWFjaCBjaGVjayBpcyBhbiBvYmplY3Q6IHsgXCJ0eXBlXCI6IFwiPG5hbWU+XCIsIFwibWVzc2FnZVwiOiBcIi4uLlwiLCBcImFyZ3NcIjogeyAuLi4gfSB9JyxcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gICAgbGluZXMucHVzaChcIkJ1aWx0LWluIHZhbGlkYXRpb24gdHlwZXM6XCIpO1xuICAgIGxpbmVzLnB1c2goXCIgIC0gcmVxdWlyZWQg4oCUIHZhbHVlIG11c3QgYmUgbm9uLWVtcHR5XCIpO1xuICAgIGxpbmVzLnB1c2goXCIgIC0gZW1haWwg4oCUIHZhbGlkIGVtYWlsIGZvcm1hdFwiKTtcbiAgICBsaW5lcy5wdXNoKCcgIC0gbWluTGVuZ3RoIOKAlCBtaW5pbXVtIHN0cmluZyBsZW5ndGggKGFyZ3M6IHsgXCJtaW5cIjogTiB9KScpO1xuICAgIGxpbmVzLnB1c2goJyAgLSBtYXhMZW5ndGgg4oCUIG1heGltdW0gc3RyaW5nIGxlbmd0aCAoYXJnczogeyBcIm1heFwiOiBOIH0pJyk7XG4gICAgbGluZXMucHVzaCgnICAtIHBhdHRlcm4g4oCUIG1hdGNoIGEgcmVnZXggKGFyZ3M6IHsgXCJwYXR0ZXJuXCI6IFwicmVnZXhcIiB9KScpO1xuICAgIGxpbmVzLnB1c2goJyAgLSBtaW4g4oCUIG1pbmltdW0gbnVtZXJpYyB2YWx1ZSAoYXJnczogeyBcIm1pblwiOiBOIH0pJyk7XG4gICAgbGluZXMucHVzaCgnICAtIG1heCDigJQgbWF4aW11bSBudW1lcmljIHZhbHVlIChhcmdzOiB7IFwibWF4XCI6IE4gfSknKTtcbiAgICBsaW5lcy5wdXNoKFwiICAtIG51bWVyaWMg4oCUIHZhbHVlIG11c3QgYmUgYSBudW1iZXJcIik7XG4gICAgbGluZXMucHVzaChcIiAgLSB1cmwg4oCUIHZhbGlkIFVSTCBmb3JtYXRcIik7XG4gICAgbGluZXMucHVzaChcbiAgICAgICcgIC0gbWF0Y2hlcyDigJQgbXVzdCBlcXVhbCBhbm90aGVyIGZpZWxkIChhcmdzOiB7IFwib3RoZXJcIjogeyBcIiRzdGF0ZVwiOiBcIi9wYXRoXCIgfSB9KScsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgJyAgLSBlcXVhbFRvIOKAlCBhbGlhcyBmb3IgbWF0Y2hlcyAoYXJnczogeyBcIm90aGVyXCI6IHsgXCIkc3RhdGVcIjogXCIvcGF0aFwiIH0gfSknLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcbiAgICAgICcgIC0gbGVzc1RoYW4g4oCUIHZhbHVlIG11c3QgYmUgbGVzcyB0aGFuIGFub3RoZXIgZmllbGQgKGFyZ3M6IHsgXCJvdGhlclwiOiB7IFwiJHN0YXRlXCI6IFwiL3BhdGhcIiB9IH0pJyxcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICAnICAtIGdyZWF0ZXJUaGFuIOKAlCB2YWx1ZSBtdXN0IGJlIGdyZWF0ZXIgdGhhbiBhbm90aGVyIGZpZWxkIChhcmdzOiB7IFwib3RoZXJcIjogeyBcIiRzdGF0ZVwiOiBcIi9wYXRoXCIgfSB9KScsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgJyAgLSByZXF1aXJlZElmIOKAlCByZXF1aXJlZCBvbmx5IHdoZW4gYW5vdGhlciBmaWVsZCBpcyB0cnV0aHkgKGFyZ3M6IHsgXCJmaWVsZFwiOiB7IFwiJHN0YXRlXCI6IFwiL3BhdGhcIiB9IH0pJyxcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gICAgbGluZXMucHVzaChcIkV4YW1wbGU6XCIpO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICAnICBcImNoZWNrc1wiOiBbeyBcInR5cGVcIjogXCJyZXF1aXJlZFwiLCBcIm1lc3NhZ2VcIjogXCJFbWFpbCBpcyByZXF1aXJlZFwiIH0sIHsgXCJ0eXBlXCI6IFwiZW1haWxcIiwgXCJtZXNzYWdlXCI6IFwiSW52YWxpZCBlbWFpbFwiIH1dJyxcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiSU1QT1JUQU5UOiBXaGVuIHVzaW5nIGNoZWNrcywgdGhlIGNvbXBvbmVudCBtdXN0IGFsc28gaGF2ZSBhIHsgJGJpbmRTdGF0ZSB9IG9yIHsgJGJpbmRJdGVtIH0gb24gaXRzIHZhbHVlL2NoZWNrZWQgcHJvcCBmb3IgdHdvLXdheSBiaW5kaW5nLlwiLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiQWx3YXlzIGluY2x1ZGUgdmFsaWRhdGlvbiBjaGVja3Mgb24gZm9ybSBpbnB1dHMgZm9yIGEgZ29vZCB1c2VyIGV4cGVyaWVuY2UgKGUuZy4gcmVxdWlyZWQsIGVtYWlsLCBtaW5MZW5ndGgpLlwiLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcIlwiKTtcbiAgfVxuXG4gIC8vIFN0YXRlIHdhdGNoZXJzIHNlY3Rpb24g4oCUIG9ubHkgZW1pdCB3aGVuIGFjdGlvbnMgYXJlIGF2YWlsYWJsZSAod2F0Y2hlcnNcbiAgLy8gdHJpZ2dlciBhY3Rpb25zLCBzbyB0aGUgc2VjdGlvbiBpcyBpcnJlbGV2YW50IHdpdGhvdXQgdGhlbSkuXG4gIGlmIChoYXNDdXN0b21BY3Rpb25zIHx8IGhhc0J1aWx0SW5BY3Rpb25zKSB7XG4gICAgbGluZXMucHVzaChcIlNUQVRFIFdBVENIRVJTOlwiKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgXCJFbGVtZW50cyBjYW4gaGF2ZSBhbiBvcHRpb25hbCBgd2F0Y2hgIGZpZWxkIHRvIHJlYWN0IHRvIHN0YXRlIGNoYW5nZXMgYW5kIHRyaWdnZXIgYWN0aW9ucy4gVGhlIGB3YXRjaGAgZmllbGQgaXMgYSB0b3AtbGV2ZWwgZmllbGQgb24gdGhlIGVsZW1lbnQgKHNpYmxpbmcgb2YgdHlwZS9wcm9wcy9jaGlsZHJlbiksIE5PVCBpbnNpZGUgcHJvcHMuXCIsXG4gICAgKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgXCJNYXBzIHN0YXRlIHBhdGhzIChKU09OIFBvaW50ZXJzKSB0byBhY3Rpb24gYmluZGluZ3MuIFdoZW4gdGhlIHZhbHVlIGF0IGEgd2F0Y2hlZCBwYXRoIGNoYW5nZXMsIHRoZSBib3VuZCBhY3Rpb25zIGZpcmUgYXV0b21hdGljYWxseS5cIixcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiRXhhbXBsZSAoY2FzY2FkaW5nIHNlbGVjdCDigJQgY291bnRyeSBjaGFuZ2VzIHRyaWdnZXIgY2l0eSBsb2FkaW5nKTpcIixcbiAgICApO1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBgICAke0pTT04uc3RyaW5naWZ5KHsgdHlwZTogXCJTZWxlY3RcIiwgcHJvcHM6IHsgdmFsdWU6IHsgJGJpbmRTdGF0ZTogXCIvZm9ybS9jb3VudHJ5XCIgfSwgb3B0aW9uczogW1wiVVNcIiwgXCJDYW5hZGFcIiwgXCJVS1wiXSB9LCB3YXRjaDogeyBcIi9mb3JtL2NvdW50cnlcIjogeyBhY3Rpb246IFwibG9hZENpdGllc1wiLCBwYXJhbXM6IHsgY291bnRyeTogeyAkc3RhdGU6IFwiL2Zvcm0vY291bnRyeVwiIH0gfSB9IH0sIGNoaWxkcmVuOiBbXSB9KX1gLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcIlwiKTtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgXCJVc2UgYHdhdGNoYCBmb3IgY2FzY2FkaW5nIGRlcGVuZGVuY2llcyB3aGVyZSBjaGFuZ2luZyBvbmUgZmllbGQgc2hvdWxkIHRyaWdnZXIgc2lkZSBlZmZlY3RzIChsb2FkaW5nIGRhdGEsIHJlc2V0dGluZyBkZXBlbmRlbnQgZmllbGRzLCBjb21wdXRpbmcgZGVyaXZlZCB2YWx1ZXMpLlwiLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcbiAgICAgIFwiSU1QT1JUQU5UOiBgd2F0Y2hgIGlzIGEgdG9wLWxldmVsIGZpZWxkIG9uIHRoZSBlbGVtZW50IChzaWJsaW5nIG9mIHR5cGUvcHJvcHMvY2hpbGRyZW4pLCBOT1QgaW5zaWRlIHByb3BzLiBXYXRjaGVycyBvbmx5IGZpcmUgd2hlbiB0aGUgdmFsdWUgY2hhbmdlcywgbm90IG9uIGluaXRpYWwgcmVuZGVyLlwiLFxuICAgICk7XG4gICAgbGluZXMucHVzaChcIlwiKTtcbiAgfVxuXG4gIC8vIFJ1bGVzXG4gIGxpbmVzLnB1c2goXCJSVUxFUzpcIik7XG4gIGNvbnN0IGJhc2VSdWxlcyA9XG4gICAgbW9kZSA9PT0gXCJjaGF0XCJcbiAgICAgID8gW1xuICAgICAgICAgIFwiV2hlbiBnZW5lcmF0aW5nIFVJLCB3cmFwIGFsbCBKU09OTCBwYXRjaGVzIGluIGEgYGBgc3BlYyBjb2RlIGZlbmNlIC0gb25lIEpTT04gb2JqZWN0IHBlciBsaW5lIGluc2lkZSB0aGUgZmVuY2VcIixcbiAgICAgICAgICBcIldyaXRlIGEgYnJpZWYgY29udmVyc2F0aW9uYWwgcmVzcG9uc2UgYmVmb3JlIGFueSBKU09OTCBvdXRwdXRcIixcbiAgICAgICAgICAnRmlyc3Qgc2V0IHJvb3Q6IHtcIm9wXCI6XCJhZGRcIixcInBhdGhcIjpcIi9yb290XCIsXCJ2YWx1ZVwiOlwiPHJvb3Qta2V5PlwifScsXG4gICAgICAgICAgJ1RoZW4gYWRkIGVhY2ggZWxlbWVudDoge1wib3BcIjpcImFkZFwiLFwicGF0aFwiOlwiL2VsZW1lbnRzLzxrZXk+XCIsXCJ2YWx1ZVwiOnsuLi59fScsXG4gICAgICAgICAgXCJPdXRwdXQgL3N0YXRlIHBhdGNoZXMgcmlnaHQgYWZ0ZXIgdGhlIGVsZW1lbnRzIHRoYXQgdXNlIHRoZW0sIG9uZSBwZXIgYXJyYXkgaXRlbSBmb3IgcHJvZ3Jlc3NpdmUgbG9hZGluZy4gUkVRVUlSRUQgd2hlbmV2ZXIgdXNpbmcgJHN0YXRlLCAkYmluZFN0YXRlLCAkYmluZEl0ZW0sICRpdGVtLCAkaW5kZXgsIG9yIHJlcGVhdC5cIixcbiAgICAgICAgICBcIk9OTFkgdXNlIGNvbXBvbmVudHMgbGlzdGVkIGFib3ZlXCIsXG4gICAgICAgICAgXCJFYWNoIGVsZW1lbnQgdmFsdWUgbmVlZHM6IHR5cGUsIHByb3BzLCBjaGlsZHJlbiAoYXJyYXkgb2YgY2hpbGQga2V5cylcIixcbiAgICAgICAgICBcIlVzZSB1bmlxdWUga2V5cyBmb3IgdGhlIGVsZW1lbnQgbWFwIGVudHJpZXMgKGUuZy4sICdoZWFkZXInLCAnbWV0cmljLTEnLCAnY2hhcnQtcmV2ZW51ZScpXCIsXG4gICAgICAgIF1cbiAgICAgIDogW1xuICAgICAgICAgIFwiT3V0cHV0IE9OTFkgSlNPTkwgcGF0Y2hlcyAtIG9uZSBKU09OIG9iamVjdCBwZXIgbGluZSwgbm8gbWFya2Rvd24sIG5vIGNvZGUgZmVuY2VzXCIsXG4gICAgICAgICAgJ0ZpcnN0IHNldCByb290OiB7XCJvcFwiOlwiYWRkXCIsXCJwYXRoXCI6XCIvcm9vdFwiLFwidmFsdWVcIjpcIjxyb290LWtleT5cIn0nLFxuICAgICAgICAgICdUaGVuIGFkZCBlYWNoIGVsZW1lbnQ6IHtcIm9wXCI6XCJhZGRcIixcInBhdGhcIjpcIi9lbGVtZW50cy88a2V5PlwiLFwidmFsdWVcIjp7Li4ufX0nLFxuICAgICAgICAgIFwiT3V0cHV0IC9zdGF0ZSBwYXRjaGVzIHJpZ2h0IGFmdGVyIHRoZSBlbGVtZW50cyB0aGF0IHVzZSB0aGVtLCBvbmUgcGVyIGFycmF5IGl0ZW0gZm9yIHByb2dyZXNzaXZlIGxvYWRpbmcuIFJFUVVJUkVEIHdoZW5ldmVyIHVzaW5nICRzdGF0ZSwgJGJpbmRTdGF0ZSwgJGJpbmRJdGVtLCAkaXRlbSwgJGluZGV4LCBvciByZXBlYXQuXCIsXG4gICAgICAgICAgXCJPTkxZIHVzZSBjb21wb25lbnRzIGxpc3RlZCBhYm92ZVwiLFxuICAgICAgICAgIFwiRWFjaCBlbGVtZW50IHZhbHVlIG5lZWRzOiB0eXBlLCBwcm9wcywgY2hpbGRyZW4gKGFycmF5IG9mIGNoaWxkIGtleXMpXCIsXG4gICAgICAgICAgXCJVc2UgdW5pcXVlIGtleXMgZm9yIHRoZSBlbGVtZW50IG1hcCBlbnRyaWVzIChlLmcuLCAnaGVhZGVyJywgJ21ldHJpYy0xJywgJ2NoYXJ0LXJldmVudWUnKVwiLFxuICAgICAgICBdO1xuICBjb25zdCBzY2hlbWFSdWxlcyA9IGNhdGFsb2cuc2NoZW1hLmRlZmF1bHRSdWxlcyA/PyBbXTtcbiAgY29uc3QgYWxsUnVsZXMgPSBbLi4uYmFzZVJ1bGVzLCAuLi5zY2hlbWFSdWxlcywgLi4uY3VzdG9tUnVsZXNdO1xuICBhbGxSdWxlcy5mb3JFYWNoKChydWxlLCBpKSA9PiB7XG4gICAgbGluZXMucHVzaChgJHtpICsgMX0uICR7cnVsZX1gKTtcbiAgfSk7XG5cbiAgcmV0dXJuIGxpbmVzLmpvaW4oXCJcXG5cIik7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGFtcGxlIFZhbHVlIEdlbmVyYXRpb24gZnJvbSBab2QgU2NoZW1hc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDb21wb25lbnQgZGVmaW5pdGlvbiBzaGFwZSBhcyBpdCBhcHBlYXJzIGluIGNhdGFsb2cgZGF0YVxuICovXG5pbnRlcmZhY2UgQ2F0YWxvZ0NvbXBvbmVudERlZiB7XG4gIHByb3BzPzogei5ab2RUeXBlO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbiAgc2xvdHM/OiBzdHJpbmdbXTtcbiAgZXZlbnRzPzogc3RyaW5nW107XG4gIGV4YW1wbGU/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn1cblxuLyoqXG4gKiBHZXQgZXhhbXBsZSBwcm9wcyBmb3IgYSBjYXRhbG9nIGNvbXBvbmVudC5cbiAqIFVzZXMgdGhlIGV4cGxpY2l0IGBleGFtcGxlYCBmaWVsZCBpZiBwcm92aWRlZCwgb3RoZXJ3aXNlIGdlbmVyYXRlcyBmcm9tIFpvZCBzY2hlbWEuXG4gKi9cbmZ1bmN0aW9uIGdldEV4YW1wbGVQcm9wcyhkZWY6IENhdGFsb2dDb21wb25lbnREZWYpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIGlmIChkZWYuZXhhbXBsZSAmJiBPYmplY3Qua2V5cyhkZWYuZXhhbXBsZSkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBkZWYuZXhhbXBsZTtcbiAgfVxuICBpZiAoZGVmLnByb3BzKSB7XG4gICAgcmV0dXJuIGdlbmVyYXRlRXhhbXBsZVByb3BzRnJvbVpvZChkZWYucHJvcHMpO1xuICB9XG4gIHJldHVybiB7fTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBleGFtcGxlIHByb3AgdmFsdWVzIGZyb20gYSBab2Qgb2JqZWN0IHNjaGVtYS5cbiAqIE9ubHkgaW5jbHVkZXMgcmVxdWlyZWQgZmllbGRzIHRvIGtlZXAgZXhhbXBsZXMgY29uY2lzZS5cbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVFeGFtcGxlUHJvcHNGcm9tWm9kKFxuICBzY2hlbWE6IHouWm9kVHlwZSxcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgaWYgKCFzY2hlbWEgfHwgIXNjaGVtYS5fZGVmKSByZXR1cm4ge307XG4gIGNvbnN0IGRlZiA9IHNjaGVtYS5fZGVmIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbnN0IHR5cGVOYW1lID0gZ2V0Wm9kVHlwZU5hbWUoc2NoZW1hKTtcblxuICBpZiAodHlwZU5hbWUgIT09IFwiWm9kT2JqZWN0XCIgJiYgdHlwZU5hbWUgIT09IFwib2JqZWN0XCIpIHJldHVybiB7fTtcblxuICBjb25zdCBzaGFwZSA9XG4gICAgdHlwZW9mIGRlZi5zaGFwZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IChkZWYuc2hhcGUgYXMgKCkgPT4gUmVjb3JkPHN0cmluZywgei5ab2RUeXBlPikoKVxuICAgICAgOiAoZGVmLnNoYXBlIGFzIFJlY29yZDxzdHJpbmcsIHouWm9kVHlwZT4pO1xuICBpZiAoIXNoYXBlKSByZXR1cm4ge307XG5cbiAgY29uc3QgcmVzdWx0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzaGFwZSkpIHtcbiAgICBjb25zdCBpbm5lclR5cGVOYW1lID0gZ2V0Wm9kVHlwZU5hbWUodmFsdWUpO1xuICAgIC8vIFNraXAgb3B0aW9uYWwgcHJvcHMgdG8ga2VlcCBleGFtcGxlcyBjb25jaXNlXG4gICAgaWYgKFxuICAgICAgaW5uZXJUeXBlTmFtZSA9PT0gXCJab2RPcHRpb25hbFwiIHx8XG4gICAgICBpbm5lclR5cGVOYW1lID09PSBcIm9wdGlvbmFsXCIgfHxcbiAgICAgIGlubmVyVHlwZU5hbWUgPT09IFwiWm9kTnVsbGFibGVcIiB8fFxuICAgICAgaW5uZXJUeXBlTmFtZSA9PT0gXCJudWxsYWJsZVwiXG4gICAgKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcmVzdWx0W2tleV0gPSBnZW5lcmF0ZUV4YW1wbGVWYWx1ZSh2YWx1ZSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBhIHNpbmdsZSBleGFtcGxlIHZhbHVlIGZyb20gYSBab2QgdHlwZS5cbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVFeGFtcGxlVmFsdWUoc2NoZW1hOiB6LlpvZFR5cGUpOiB1bmtub3duIHtcbiAgaWYgKCFzY2hlbWEgfHwgIXNjaGVtYS5fZGVmKSByZXR1cm4gXCIuLi5cIjtcbiAgY29uc3QgZGVmID0gc2NoZW1hLl9kZWYgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgY29uc3QgdHlwZU5hbWUgPSBnZXRab2RUeXBlTmFtZShzY2hlbWEpO1xuXG4gIHN3aXRjaCAodHlwZU5hbWUpIHtcbiAgICBjYXNlIFwiWm9kU3RyaW5nXCI6XG4gICAgY2FzZSBcInN0cmluZ1wiOlxuICAgICAgcmV0dXJuIFwiZXhhbXBsZVwiO1xuICAgIGNhc2UgXCJab2ROdW1iZXJcIjpcbiAgICBjYXNlIFwibnVtYmVyXCI6XG4gICAgICByZXR1cm4gMDtcbiAgICBjYXNlIFwiWm9kQm9vbGVhblwiOlxuICAgIGNhc2UgXCJib29sZWFuXCI6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBjYXNlIFwiWm9kTGl0ZXJhbFwiOlxuICAgIGNhc2UgXCJsaXRlcmFsXCI6XG4gICAgICByZXR1cm4gZGVmLnZhbHVlO1xuICAgIGNhc2UgXCJab2RFbnVtXCI6XG4gICAgY2FzZSBcImVudW1cIjoge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZGVmLnZhbHVlcykgJiYgZGVmLnZhbHVlcy5sZW5ndGggPiAwKVxuICAgICAgICByZXR1cm4gZGVmLnZhbHVlc1swXTtcbiAgICAgIGlmIChkZWYuZW50cmllcyAmJiB0eXBlb2YgZGVmLmVudHJpZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgY29uc3QgdmFsdWVzID0gT2JqZWN0LnZhbHVlcyhkZWYuZW50cmllcyBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTtcbiAgICAgICAgcmV0dXJuIHZhbHVlcy5sZW5ndGggPiAwID8gdmFsdWVzWzBdIDogXCJleGFtcGxlXCI7XG4gICAgICB9XG4gICAgICByZXR1cm4gXCJleGFtcGxlXCI7XG4gICAgfVxuICAgIGNhc2UgXCJab2RPcHRpb25hbFwiOlxuICAgIGNhc2UgXCJvcHRpb25hbFwiOlxuICAgIGNhc2UgXCJab2ROdWxsYWJsZVwiOlxuICAgIGNhc2UgXCJudWxsYWJsZVwiOlxuICAgIGNhc2UgXCJab2REZWZhdWx0XCI6XG4gICAgY2FzZSBcImRlZmF1bHRcIjoge1xuICAgICAgY29uc3QgaW5uZXIgPSAoZGVmLmlubmVyVHlwZSBhcyB6LlpvZFR5cGUpID8/IChkZWYud3JhcHBlZCBhcyB6LlpvZFR5cGUpO1xuICAgICAgcmV0dXJuIGlubmVyID8gZ2VuZXJhdGVFeGFtcGxlVmFsdWUoaW5uZXIpIDogbnVsbDtcbiAgICB9XG4gICAgY2FzZSBcIlpvZEFycmF5XCI6XG4gICAgY2FzZSBcImFycmF5XCI6XG4gICAgICByZXR1cm4gW107XG4gICAgY2FzZSBcIlpvZE9iamVjdFwiOlxuICAgIGNhc2UgXCJvYmplY3RcIjpcbiAgICAgIHJldHVybiBnZW5lcmF0ZUV4YW1wbGVQcm9wc0Zyb21ab2Qoc2NoZW1hKTtcbiAgICBjYXNlIFwiWm9kVW5pb25cIjpcbiAgICBjYXNlIFwidW5pb25cIjoge1xuICAgICAgY29uc3Qgb3B0aW9ucyA9IGRlZi5vcHRpb25zIGFzIHouWm9kVHlwZVtdIHwgdW5kZWZpbmVkO1xuICAgICAgcmV0dXJuIG9wdGlvbnMgJiYgb3B0aW9ucy5sZW5ndGggPiAwXG4gICAgICAgID8gZ2VuZXJhdGVFeGFtcGxlVmFsdWUob3B0aW9uc1swXSEpXG4gICAgICAgIDogXCIuLi5cIjtcbiAgICB9XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBcIi4uLlwiO1xuICB9XG59XG5cbi8qKlxuICogRmluZCB0aGUgbmFtZSBvZiB0aGUgZmlyc3QgcmVxdWlyZWQgc3RyaW5nIHByb3AgaW4gYSBab2Qgb2JqZWN0IHNjaGVtYS5cbiAqIFVzZWQgdG8gZGVtb25zdHJhdGUgJHN0YXRlIGR5bmFtaWMgYmluZGluZ3MgaW4gZXhhbXBsZXMuXG4gKi9cbmZ1bmN0aW9uIGZpbmRGaXJzdFN0cmluZ1Byb3Aoc2NoZW1hPzogei5ab2RUeXBlKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghc2NoZW1hIHx8ICFzY2hlbWEuX2RlZikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRlZiA9IHNjaGVtYS5fZGVmIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbnN0IHR5cGVOYW1lID0gZ2V0Wm9kVHlwZU5hbWUoc2NoZW1hKTtcblxuICBpZiAodHlwZU5hbWUgIT09IFwiWm9kT2JqZWN0XCIgJiYgdHlwZU5hbWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHNoYXBlID1cbiAgICB0eXBlb2YgZGVmLnNoYXBlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gKGRlZi5zaGFwZSBhcyAoKSA9PiBSZWNvcmQ8c3RyaW5nLCB6LlpvZFR5cGU+KSgpXG4gICAgICA6IChkZWYuc2hhcGUgYXMgUmVjb3JkPHN0cmluZywgei5ab2RUeXBlPik7XG4gIGlmICghc2hhcGUpIHJldHVybiBudWxsO1xuXG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNoYXBlKSkge1xuICAgIGNvbnN0IGlubmVyVHlwZU5hbWUgPSBnZXRab2RUeXBlTmFtZSh2YWx1ZSk7XG4gICAgLy8gU2tpcCBvcHRpb25hbCBwcm9wc1xuICAgIGlmIChcbiAgICAgIGlubmVyVHlwZU5hbWUgPT09IFwiWm9kT3B0aW9uYWxcIiB8fFxuICAgICAgaW5uZXJUeXBlTmFtZSA9PT0gXCJvcHRpb25hbFwiIHx8XG4gICAgICBpbm5lclR5cGVOYW1lID09PSBcIlpvZE51bGxhYmxlXCIgfHxcbiAgICAgIGlubmVyVHlwZU5hbWUgPT09IFwibnVsbGFibGVcIlxuICAgICkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFVud3JhcCB0byBjaGVjayB0aGUgYWN0dWFsIHR5cGVcbiAgICBpZiAoaW5uZXJUeXBlTmFtZSA9PT0gXCJab2RTdHJpbmdcIiB8fCBpbm5lclR5cGVOYW1lID09PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4ga2V5O1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFpvZCBJbnRyb3NwZWN0aW9uIEhlbHBlcnNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogR2V0IFpvZCB0eXBlIG5hbWUgZnJvbSBzY2hlbWEgKGhhbmRsZXMgZGlmZmVyZW50IFpvZCB2ZXJzaW9ucylcbiAqL1xuZnVuY3Rpb24gZ2V0Wm9kVHlwZU5hbWUoc2NoZW1hOiB6LlpvZFR5cGUpOiBzdHJpbmcge1xuICBpZiAoIXNjaGVtYSB8fCAhc2NoZW1hLl9kZWYpIHJldHVybiBcIlwiO1xuICBjb25zdCBkZWYgPSBzY2hlbWEuX2RlZiBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvLyBab2QgNCsgdXNlcyBfZGVmLnR5cGUsIG9sZGVyIHZlcnNpb25zIHVzZSBfZGVmLnR5cGVOYW1lXG4gIHJldHVybiAoZGVmLnR5cGVOYW1lIGFzIHN0cmluZykgPz8gKGRlZi50eXBlIGFzIHN0cmluZykgPz8gXCJcIjtcbn1cblxuLyoqXG4gKiBGb3JtYXQgYSBab2QgdHlwZSBpbnRvIGEgaHVtYW4tcmVhZGFibGUgc3RyaW5nXG4gKi9cbmZ1bmN0aW9uIGZvcm1hdFpvZFR5cGUoc2NoZW1hOiB6LlpvZFR5cGUpOiBzdHJpbmcge1xuICBpZiAoIXNjaGVtYSB8fCAhc2NoZW1hLl9kZWYpIHJldHVybiBcInVua25vd25cIjtcbiAgY29uc3QgZGVmID0gc2NoZW1hLl9kZWYgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgY29uc3QgdHlwZU5hbWUgPSBnZXRab2RUeXBlTmFtZShzY2hlbWEpO1xuXG4gIHN3aXRjaCAodHlwZU5hbWUpIHtcbiAgICBjYXNlIFwiWm9kU3RyaW5nXCI6XG4gICAgY2FzZSBcInN0cmluZ1wiOlxuICAgICAgcmV0dXJuIFwic3RyaW5nXCI7XG4gICAgY2FzZSBcIlpvZE51bWJlclwiOlxuICAgIGNhc2UgXCJudW1iZXJcIjpcbiAgICAgIHJldHVybiBcIm51bWJlclwiO1xuICAgIGNhc2UgXCJab2RCb29sZWFuXCI6XG4gICAgY2FzZSBcImJvb2xlYW5cIjpcbiAgICAgIHJldHVybiBcImJvb2xlYW5cIjtcbiAgICBjYXNlIFwiWm9kTGl0ZXJhbFwiOlxuICAgIGNhc2UgXCJsaXRlcmFsXCI6XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZGVmLnZhbHVlKTtcbiAgICBjYXNlIFwiWm9kRW51bVwiOlxuICAgIGNhc2UgXCJlbnVtXCI6IHtcbiAgICAgIC8vIFpvZCAzIHVzZXMgdmFsdWVzIGFycmF5LCBab2QgNCB1c2VzIGVudHJpZXMgb2JqZWN0XG4gICAgICBsZXQgdmFsdWVzOiBzdHJpbmdbXTtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGRlZi52YWx1ZXMpKSB7XG4gICAgICAgIHZhbHVlcyA9IGRlZi52YWx1ZXMgYXMgc3RyaW5nW107XG4gICAgICB9IGVsc2UgaWYgKGRlZi5lbnRyaWVzICYmIHR5cGVvZiBkZWYuZW50cmllcyA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICB2YWx1ZXMgPSBPYmplY3QudmFsdWVzKGRlZi5lbnRyaWVzIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIFwiZW51bVwiO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHZhbHVlcy5tYXAoKHYpID0+IGBcIiR7dn1cImApLmpvaW4oXCIgfCBcIik7XG4gICAgfVxuICAgIGNhc2UgXCJab2RBcnJheVwiOlxuICAgIGNhc2UgXCJhcnJheVwiOiB7XG4gICAgICAvLyBzYWZlbHkgcmVzb2x2ZSBpbm5lciB0eXBlIGZvciBab2QgYXJyYXlzXG4gICAgICBjb25zdCBpbm5lciA9IChcbiAgICAgICAgdHlwZW9mIGRlZi5lbGVtZW50ID09PSBcIm9iamVjdFwiXG4gICAgICAgICAgPyBkZWYuZWxlbWVudFxuICAgICAgICAgIDogdHlwZW9mIGRlZi50eXBlID09PSBcIm9iamVjdFwiXG4gICAgICAgICAgICA/IGRlZi50eXBlXG4gICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgKSBhcyB6LlpvZFR5cGUgfCB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4gaW5uZXIgPyBgQXJyYXk8JHtmb3JtYXRab2RUeXBlKGlubmVyKX0+YCA6IFwiQXJyYXk8dW5rbm93bj5cIjtcbiAgICB9XG4gICAgY2FzZSBcIlpvZE9iamVjdFwiOlxuICAgIGNhc2UgXCJvYmplY3RcIjoge1xuICAgICAgLy8gU2hhcGUgY2FuIGJlIGEgZnVuY3Rpb24gKFpvZCAzKSBvciBkaXJlY3Qgb2JqZWN0IChab2QgNClcbiAgICAgIGNvbnN0IHNoYXBlID1cbiAgICAgICAgdHlwZW9mIGRlZi5zaGFwZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyAoZGVmLnNoYXBlIGFzICgpID0+IFJlY29yZDxzdHJpbmcsIHouWm9kVHlwZT4pKClcbiAgICAgICAgICA6IChkZWYuc2hhcGUgYXMgUmVjb3JkPHN0cmluZywgei5ab2RUeXBlPik7XG4gICAgICBpZiAoIXNoYXBlKSByZXR1cm4gXCJvYmplY3RcIjtcbiAgICAgIGNvbnN0IHByb3BzID0gT2JqZWN0LmVudHJpZXMoc2hhcGUpXG4gICAgICAgIC5tYXAoKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGlubmVyVHlwZU5hbWUgPSBnZXRab2RUeXBlTmFtZSh2YWx1ZSk7XG4gICAgICAgICAgY29uc3QgaXNPcHRpb25hbCA9XG4gICAgICAgICAgICBpbm5lclR5cGVOYW1lID09PSBcIlpvZE9wdGlvbmFsXCIgfHxcbiAgICAgICAgICAgIGlubmVyVHlwZU5hbWUgPT09IFwiWm9kTnVsbGFibGVcIiB8fFxuICAgICAgICAgICAgaW5uZXJUeXBlTmFtZSA9PT0gXCJvcHRpb25hbFwiIHx8XG4gICAgICAgICAgICBpbm5lclR5cGVOYW1lID09PSBcIm51bGxhYmxlXCI7XG4gICAgICAgICAgcmV0dXJuIGAke2tleX0ke2lzT3B0aW9uYWwgPyBcIj9cIiA6IFwiXCJ9OiAke2Zvcm1hdFpvZFR5cGUodmFsdWUpfWA7XG4gICAgICAgIH0pXG4gICAgICAgIC5qb2luKFwiLCBcIik7XG4gICAgICByZXR1cm4gYHsgJHtwcm9wc30gfWA7XG4gICAgfVxuICAgIGNhc2UgXCJab2RPcHRpb25hbFwiOlxuICAgIGNhc2UgXCJvcHRpb25hbFwiOlxuICAgIGNhc2UgXCJab2ROdWxsYWJsZVwiOlxuICAgIGNhc2UgXCJudWxsYWJsZVwiOiB7XG4gICAgICBjb25zdCBpbm5lciA9IChkZWYuaW5uZXJUeXBlIGFzIHouWm9kVHlwZSkgPz8gKGRlZi53cmFwcGVkIGFzIHouWm9kVHlwZSk7XG4gICAgICByZXR1cm4gaW5uZXIgPyBmb3JtYXRab2RUeXBlKGlubmVyKSA6IFwidW5rbm93blwiO1xuICAgIH1cbiAgICBjYXNlIFwiWm9kVW5pb25cIjpcbiAgICBjYXNlIFwidW5pb25cIjoge1xuICAgICAgY29uc3Qgb3B0aW9ucyA9IGRlZi5vcHRpb25zIGFzIHouWm9kVHlwZVtdIHwgdW5kZWZpbmVkO1xuICAgICAgcmV0dXJuIG9wdGlvbnNcbiAgICAgICAgPyBvcHRpb25zLm1hcCgob3B0KSA9PiBmb3JtYXRab2RUeXBlKG9wdCkpLmpvaW4oXCIgfCBcIilcbiAgICAgICAgOiBcInVua25vd25cIjtcbiAgICB9XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBcInVua25vd25cIjtcbiAgfVxufVxuXG4vKipcbiAqIENvbnZlcnQgWm9kIHNjaGVtYSB0byBKU09OIFNjaGVtYVxuICovXG5mdW5jdGlvbiB6b2RUb0pzb25TY2hlbWEoc2NoZW1hOiB6LlpvZFR5cGUpOiBvYmplY3Qge1xuICAvLyBTaW1wbGlmaWVkIEpTT04gU2NoZW1hIGNvbnZlcnNpb25cbiAgY29uc3QgZGVmID0gc2NoZW1hLl9kZWYgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgY29uc3QgdHlwZU5hbWUgPSAoZGVmLnR5cGVOYW1lIGFzIHN0cmluZykgPz8gXCJcIjtcblxuICBzd2l0Y2ggKHR5cGVOYW1lKSB7XG4gICAgY2FzZSBcIlpvZFN0cmluZ1wiOlxuICAgICAgcmV0dXJuIHsgdHlwZTogXCJzdHJpbmdcIiB9O1xuICAgIGNhc2UgXCJab2ROdW1iZXJcIjpcbiAgICAgIHJldHVybiB7IHR5cGU6IFwibnVtYmVyXCIgfTtcbiAgICBjYXNlIFwiWm9kQm9vbGVhblwiOlxuICAgICAgcmV0dXJuIHsgdHlwZTogXCJib29sZWFuXCIgfTtcbiAgICBjYXNlIFwiWm9kTGl0ZXJhbFwiOlxuICAgICAgcmV0dXJuIHsgY29uc3Q6IGRlZi52YWx1ZSB9O1xuICAgIGNhc2UgXCJab2RFbnVtXCI6XG4gICAgICByZXR1cm4geyBlbnVtOiBkZWYudmFsdWVzIH07XG4gICAgY2FzZSBcIlpvZEFycmF5XCI6IHtcbiAgICAgIGNvbnN0IGlubmVyID0gZGVmLnR5cGUgYXMgei5ab2RUeXBlIHwgdW5kZWZpbmVkO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogXCJhcnJheVwiLFxuICAgICAgICBpdGVtczogaW5uZXIgPyB6b2RUb0pzb25TY2hlbWEoaW5uZXIpIDoge30sXG4gICAgICB9O1xuICAgIH1cbiAgICBjYXNlIFwiWm9kT2JqZWN0XCI6IHtcbiAgICAgIGNvbnN0IHNoYXBlID0gKGRlZi5zaGFwZSBhcyAoKSA9PiBSZWNvcmQ8c3RyaW5nLCB6LlpvZFR5cGU+KT8uKCk7XG4gICAgICBpZiAoIXNoYXBlKSByZXR1cm4geyB0eXBlOiBcIm9iamVjdFwiIH07XG4gICAgICBjb25zdCBwcm9wZXJ0aWVzOiBSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+ID0ge307XG4gICAgICBjb25zdCByZXF1aXJlZDogc3RyaW5nW10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNoYXBlKSkge1xuICAgICAgICBwcm9wZXJ0aWVzW2tleV0gPSB6b2RUb0pzb25TY2hlbWEodmFsdWUpO1xuICAgICAgICBjb25zdCBpbm5lckRlZiA9IHZhbHVlLl9kZWYgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGlubmVyRGVmLnR5cGVOYW1lICE9PSBcIlpvZE9wdGlvbmFsXCIgJiZcbiAgICAgICAgICBpbm5lckRlZi50eXBlTmFtZSAhPT0gXCJab2ROdWxsYWJsZVwiXG4gICAgICAgICkge1xuICAgICAgICAgIHJlcXVpcmVkLnB1c2goa2V5KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgcHJvcGVydGllcyxcbiAgICAgICAgcmVxdWlyZWQ6IHJlcXVpcmVkLmxlbmd0aCA+IDAgPyByZXF1aXJlZCA6IHVuZGVmaW5lZCxcbiAgICAgICAgYWRkaXRpb25hbFByb3BlcnRpZXM6IGZhbHNlLFxuICAgICAgfTtcbiAgICB9XG4gICAgY2FzZSBcIlpvZFJlY29yZFwiOiB7XG4gICAgICBjb25zdCB2YWx1ZVR5cGUgPSBkZWYudmFsdWVUeXBlIGFzIHouWm9kVHlwZSB8IHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6IFwib2JqZWN0XCIsXG4gICAgICAgIGFkZGl0aW9uYWxQcm9wZXJ0aWVzOiB2YWx1ZVR5cGUgPyB6b2RUb0pzb25TY2hlbWEodmFsdWVUeXBlKSA6IHRydWUsXG4gICAgICB9O1xuICAgIH1cbiAgICBjYXNlIFwiWm9kT3B0aW9uYWxcIjpcbiAgICBjYXNlIFwiWm9kTnVsbGFibGVcIjoge1xuICAgICAgY29uc3QgaW5uZXIgPSBkZWYuaW5uZXJUeXBlIGFzIHouWm9kVHlwZSB8IHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiBpbm5lciA/IHpvZFRvSnNvblNjaGVtYShpbm5lcikgOiB7fTtcbiAgICB9XG4gICAgY2FzZSBcIlpvZFVuaW9uXCI6IHtcbiAgICAgIGNvbnN0IG9wdGlvbnMgPSBkZWYub3B0aW9ucyBhcyB6LlpvZFR5cGVbXSB8IHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiBvcHRpb25zID8geyBhbnlPZjogb3B0aW9ucy5tYXAoem9kVG9Kc29uU2NoZW1hKSB9IDoge307XG4gICAgfVxuICAgIGNhc2UgXCJab2RBbnlcIjpcbiAgICAgIHJldHVybiB7fTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHt9O1xuICB9XG59XG5cbi8qKlxuICogU2hvcnRoYW5kOiBEZWZpbmUgYSBjYXRhbG9nIGRpcmVjdGx5IGZyb20gYSBzY2hlbWFcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZmluZUNhdGFsb2c8XG4gIFREZWYgZXh0ZW5kcyBTY2hlbWFEZWZpbml0aW9uLFxuICBUQ2F0YWxvZyBleHRlbmRzIEluZmVyQ2F0YWxvZ0lucHV0PFREZWZbXCJjYXRhbG9nXCJdPixcbj4oc2NoZW1hOiBTY2hlbWE8VERlZj4sIGNhdGFsb2c6IFRDYXRhbG9nKTogQ2F0YWxvZzxURGVmLCBUQ2F0YWxvZz4ge1xuICByZXR1cm4gc2NoZW1hLmNyZWF0ZUNhdGFsb2coY2F0YWxvZyk7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBTcGVjIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuLyoqXG4gKiBPcHRpb25zIGZvciBidWlsZGluZyBhIHVzZXIgcHJvbXB0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJQcm9tcHRPcHRpb25zIHtcbiAgLyoqIFRoZSB1c2VyJ3MgdGV4dCBwcm9tcHQgKi9cbiAgcHJvbXB0OiBzdHJpbmc7XG4gIC8qKiBFeGlzdGluZyBzcGVjIHRvIHJlZmluZSAodHJpZ2dlcnMgcGF0Y2gtb25seSBtb2RlKSAqL1xuICBjdXJyZW50U3BlYz86IFNwZWMgfCBudWxsO1xuICAvKiogUnVudGltZSBzdGF0ZSBjb250ZXh0IHRvIGluY2x1ZGUgKi9cbiAgc3RhdGU/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGw7XG4gIC8qKiBNYXhpbXVtIGxlbmd0aCBmb3IgdGhlIHVzZXIncyB0ZXh0IHByb21wdCAoYXBwbGllZCBiZWZvcmUgd3JhcHBpbmcpICovXG4gIG1heFByb21wdExlbmd0aD86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDaGVjayB3aGV0aGVyIGEgc3BlYyBpcyBub24tZW1wdHkgKGhhcyBhIHJvb3QgYW5kIGF0IGxlYXN0IG9uZSBlbGVtZW50KS5cbiAqL1xuZnVuY3Rpb24gaXNOb25FbXB0eVNwZWMoc3BlYzogdW5rbm93bik6IHNwZWMgaXMgU3BlYyB7XG4gIGlmICghc3BlYyB8fCB0eXBlb2Ygc3BlYyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzID0gc3BlYyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygcy5yb290ID09PSBcInN0cmluZ1wiICYmXG4gICAgdHlwZW9mIHMuZWxlbWVudHMgPT09IFwib2JqZWN0XCIgJiZcbiAgICBzLmVsZW1lbnRzICE9PSBudWxsICYmXG4gICAgT2JqZWN0LmtleXMocy5lbGVtZW50cyBhcyBvYmplY3QpLmxlbmd0aCA+IDBcbiAgKTtcbn1cblxuY29uc3QgUEFUQ0hfSU5TVFJVQ1RJT05TID0gYElNUE9SVEFOVDogVGhlIGN1cnJlbnQgVUkgaXMgYWxyZWFkeSBsb2FkZWQuIE91dHB1dCBPTkxZIHRoZSBwYXRjaGVzIG5lZWRlZCB0byBtYWtlIHRoZSByZXF1ZXN0ZWQgY2hhbmdlOlxuLSBUbyBhZGQgYSBuZXcgZWxlbWVudDoge1wib3BcIjpcImFkZFwiLFwicGF0aFwiOlwiL2VsZW1lbnRzL25ldy1rZXlcIixcInZhbHVlXCI6ey4uLn19XG4tIFRvIG1vZGlmeSBhbiBleGlzdGluZyBlbGVtZW50OiB7XCJvcFwiOlwicmVwbGFjZVwiLFwicGF0aFwiOlwiL2VsZW1lbnRzL2V4aXN0aW5nLWtleVwiLFwidmFsdWVcIjp7Li4ufX1cbi0gVG8gcmVtb3ZlIGFuIGVsZW1lbnQ6IHtcIm9wXCI6XCJyZW1vdmVcIixcInBhdGhcIjpcIi9lbGVtZW50cy9vbGQta2V5XCJ9XG4tIFRvIHVwZGF0ZSB0aGUgcm9vdDoge1wib3BcIjpcInJlcGxhY2VcIixcInBhdGhcIjpcIi9yb290XCIsXCJ2YWx1ZVwiOlwibmV3LXJvb3Qta2V5XCJ9XG4tIFRvIGFkZCBjaGlsZHJlbjogdXBkYXRlIHRoZSBwYXJlbnQgZWxlbWVudCB3aXRoIG5ldyBjaGlsZHJlbiBhcnJheVxuXG5ETyBOT1Qgb3V0cHV0IHBhdGNoZXMgZm9yIGVsZW1lbnRzIHRoYXQgZG9uJ3QgbmVlZCB0byBjaGFuZ2UuIE9ubHkgb3V0cHV0IHdoYXQncyBuZWNlc3NhcnkgZm9yIHRoZSByZXF1ZXN0ZWQgbW9kaWZpY2F0aW9uLmA7XG5cbi8qKlxuICogQnVpbGQgYSB1c2VyIHByb21wdCBmb3IgQUkgZ2VuZXJhdGlvbi5cbiAqXG4gKiBIYW5kbGVzIGNvbW1vbiBwYXR0ZXJucyB0aGF0IGV2ZXJ5IGNvbnN1bWluZyBhcHAgbmVlZHM6XG4gKiAtIFRydW5jYXRpbmcgdGhlIHVzZXIncyBwcm9tcHQgdG8gYSBtYXggbGVuZ3RoXG4gKiAtIEluY2x1ZGluZyB0aGUgY3VycmVudCBzcGVjIGZvciByZWZpbmVtZW50IChwYXRjaC1vbmx5IG1vZGUpXG4gKiAtIEluY2x1ZGluZyBydW50aW1lIHN0YXRlIGNvbnRleHRcbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIEZyZXNoIGdlbmVyYXRpb25cbiAqIGJ1aWxkVXNlclByb21wdCh7IHByb21wdDogXCJjcmVhdGUgYSB0b2RvIGFwcFwiIH0pXG4gKlxuICogLy8gUmVmaW5lbWVudCB3aXRoIGV4aXN0aW5nIHNwZWNcbiAqIGJ1aWxkVXNlclByb21wdCh7IHByb21wdDogXCJhZGQgYSBkYXJrIG1vZGUgdG9nZ2xlXCIsIGN1cnJlbnRTcGVjOiBzcGVjIH0pXG4gKlxuICogLy8gV2l0aCBzdGF0ZSBjb250ZXh0XG4gKiBidWlsZFVzZXJQcm9tcHQoeyBwcm9tcHQ6IFwic2hvdyBteSBkYXRhXCIsIHN0YXRlOiB7IHRvZG9zOiBbXSB9IH0pXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVXNlclByb21wdChvcHRpb25zOiBVc2VyUHJvbXB0T3B0aW9ucyk6IHN0cmluZyB7XG4gIGNvbnN0IHsgcHJvbXB0LCBjdXJyZW50U3BlYywgc3RhdGUsIG1heFByb21wdExlbmd0aCB9ID0gb3B0aW9ucztcblxuICAvLyBTYW5pdGl6ZSBhbmQgb3B0aW9uYWxseSB0cnVuY2F0ZSB0aGUgdXNlcidzIHRleHRcbiAgbGV0IHVzZXJUZXh0ID0gU3RyaW5nKHByb21wdCB8fCBcIlwiKTtcbiAgaWYgKG1heFByb21wdExlbmd0aCAhPT0gdW5kZWZpbmVkICYmIG1heFByb21wdExlbmd0aCA+IDApIHtcbiAgICB1c2VyVGV4dCA9IHVzZXJUZXh0LnNsaWNlKDAsIG1heFByb21wdExlbmd0aCk7XG4gIH1cblxuICAvLyAtLS0gUmVmaW5lbWVudCBtb2RlOiBjdXJyZW50U3BlYyBpcyBwcm92aWRlZCAtLS1cbiAgaWYgKGlzTm9uRW1wdHlTcGVjKGN1cnJlbnRTcGVjKSkge1xuICAgIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgcGFydHMucHVzaChcbiAgICAgIGBDVVJSRU5UIFVJIFNUQVRFIChhbHJlYWR5IGxvYWRlZCwgRE8gTk9UIHJlY3JlYXRlIGV4aXN0aW5nIGVsZW1lbnRzKTpgLFxuICAgICk7XG4gICAgcGFydHMucHVzaChKU09OLnN0cmluZ2lmeShjdXJyZW50U3BlYywgbnVsbCwgMikpO1xuICAgIHBhcnRzLnB1c2goXCJcIik7XG4gICAgcGFydHMucHVzaChgVVNFUiBSRVFVRVNUOiAke3VzZXJUZXh0fWApO1xuXG4gICAgLy8gQXBwZW5kIHN0YXRlIGNvbnRleHQgaWYgcHJvdmlkZWRcbiAgICBpZiAoc3RhdGUgJiYgT2JqZWN0LmtleXMoc3RhdGUpLmxlbmd0aCA+IDApIHtcbiAgICAgIHBhcnRzLnB1c2goXCJcIik7XG4gICAgICBwYXJ0cy5wdXNoKGBBVkFJTEFCTEUgU1RBVEU6XFxuJHtKU09OLnN0cmluZ2lmeShzdGF0ZSwgbnVsbCwgMil9YCk7XG4gICAgfVxuXG4gICAgcGFydHMucHVzaChcIlwiKTtcbiAgICBwYXJ0cy5wdXNoKFBBVENIX0lOU1RSVUNUSU9OUyk7XG5cbiAgICByZXR1cm4gcGFydHMuam9pbihcIlxcblwiKTtcbiAgfVxuXG4gIC8vIC0tLSBGcmVzaCBnZW5lcmF0aW9uIG1vZGUgLS0tXG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFt1c2VyVGV4dF07XG5cbiAgaWYgKHN0YXRlICYmIE9iamVjdC5rZXlzKHN0YXRlKS5sZW5ndGggPiAwKSB7XG4gICAgcGFydHMucHVzaChgXFxuQVZBSUxBQkxFIFNUQVRFOlxcbiR7SlNPTi5zdHJpbmdpZnkoc3RhdGUsIG51bGwsIDIpfWApO1xuICB9XG5cbiAgcGFydHMucHVzaChcbiAgICBgXFxuUmVtZW1iZXI6IE91dHB1dCAvcm9vdCBmaXJzdCwgdGhlbiBpbnRlcmxlYXZlIC9lbGVtZW50cyBhbmQgL3N0YXRlIHBhdGNoZXMgc28gdGhlIFVJIGZpbGxzIGluIHByb2dyZXNzaXZlbHkgYXMgaXQgc3RyZWFtcy4gT3V0cHV0IGVhY2ggc3RhdGUgcGF0Y2ggcmlnaHQgYWZ0ZXIgdGhlIGVsZW1lbnRzIHRoYXQgdXNlIGl0LCBvbmUgcGVyIGFycmF5IGl0ZW0uYCxcbiAgKTtcblxuICByZXR1cm4gcGFydHMuam9pbihcIlxcblwiKTtcbn1cbiIsICJpbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgbWtkaXIsIHJlYWRGaWxlLCB3cml0ZUZpbGUsIGFwcGVuZEZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuaW1wb3J0IHsgZW5zdXJlU2hhcmVkV29ya3NwYWNlIH0gZnJvbSAnLi9zaGFyZWQtd29ya3NwYWNlLW1hbmFnZXInO1xuaW1wb3J0IHR5cGUge1xuICBBZ2VudE5vdGlmaWNhdGlvbixcbiAgQWdlbnROb3RpZmljYXRpb25MaXN0SW5wdXQsXG4gIEFnZW50Tm90aWZpY2F0aW9uTGlzdFJlc3VsdCxcbiAgQWdlbnROb3RpZmljYXRpb25NYXJrUmVhZElucHV0LFxuICBBZ2VudE5vdGlmaWNhdGlvbk1hcmtSZWFkUmVzdWx0LFxufSBmcm9tICcuL3R5cGVzJztcblxuaW50ZXJmYWNlIEFwcGVuZEFnZW50Tm90aWZpY2F0aW9uSW5wdXQge1xuICByZXF1ZXN0SWQ/OiBzdHJpbmc7XG4gIGtpbmQ6IEFnZW50Tm90aWZpY2F0aW9uWydraW5kJ107XG4gIHRpdGxlOiBzdHJpbmc7XG4gIG1lc3NhZ2U6IHN0cmluZztcbiAgY3JlYXRlZEF0Pzogc3RyaW5nO1xuICBtZXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUFnZW50SWQoYWdlbnRJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGFnZW50SWQudHJpbSgpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTktX10rL2csICctJyk7XG4gIGlmICghbm9ybWFsaXplZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignYWdlbnRJZCBcdTk3NUVcdTZDRDVcdTMwMDInKTtcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplZDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplT25lTGluZSh2YWx1ZTogc3RyaW5nLCBtYXhMZW5ndGg6IG51bWJlcik6IHN0cmluZyB7XG4gIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9cXHMrL2csICcgJykudHJpbSgpLnNsaWNlKDAsIG1heExlbmd0aCk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZU5vdGlmaWNhdGlvbklkKG5vdyA9IG5ldyBEYXRlKCkpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7bm93LmdldFRpbWUoKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCAxMCl9YDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZU5vdGlmaWNhdGlvbkZpbGVQYXRoKGFnZW50SWQ6IHN0cmluZywgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IG5vdGlmaWNhdGlvbnNEaXIgPSBwYXRoLmpvaW4oc2hhcmVkLnNoYXJlZERhdGFSb290LCAnbm90aWZpY2F0aW9ucycpO1xuICBhd2FpdCBta2Rpcihub3RpZmljYXRpb25zRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgcmV0dXJuIHBhdGguam9pbihub3RpZmljYXRpb25zRGlyLCBgJHtub3JtYWxpemVBZ2VudElkKGFnZW50SWQpfS5qc29ubGApO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWFkTm90aWZpY2F0aW9ucyhhZ2VudElkOiBzdHJpbmcsIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyk6IFByb21pc2U8QWdlbnROb3RpZmljYXRpb25bXT4ge1xuICBjb25zdCBmaWxlUGF0aCA9IGF3YWl0IHJlc29sdmVOb3RpZmljYXRpb25GaWxlUGF0aChhZ2VudElkLCBob21lRGlyT3ZlcnJpZGUpO1xuICBsZXQgY29udGVudCA9ICcnO1xuICB0cnkge1xuICAgIGNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdCgvXFxyP1xcbi8pLmZpbHRlcihCb29sZWFuKTtcbiAgY29uc3QgcmVzdWx0OiBBZ2VudE5vdGlmaWNhdGlvbltdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBpdGVtID0gSlNPTi5wYXJzZShsaW5lKSBhcyBBZ2VudE5vdGlmaWNhdGlvbjtcbiAgICAgIGlmIChpdGVtPy5hZ2VudElkID09PSBub3JtYWxpemVBZ2VudElkKGFnZW50SWQpICYmIHR5cGVvZiBpdGVtLm5vdGlmaWNhdGlvbklkID09PSAnc3RyaW5nJykge1xuICAgICAgICByZXN1bHQucHVzaChpdGVtKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGlnbm9yZSBtYWxmb3JtZWQgbGluZVxuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXBwZW5kQWdlbnROb3RpZmljYXRpb24oXG4gIGFnZW50SWQ6IHN0cmluZyxcbiAgaW5wdXQ6IEFwcGVuZEFnZW50Tm90aWZpY2F0aW9uSW5wdXQsXG4gIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBub3JtYWxpemVkQWdlbnRJZCA9IG5vcm1hbGl6ZUFnZW50SWQoYWdlbnRJZCk7XG4gIGNvbnN0IHBheWxvYWQ6IEFnZW50Tm90aWZpY2F0aW9uID0ge1xuICAgIG5vdGlmaWNhdGlvbklkOiBjcmVhdGVOb3RpZmljYXRpb25JZChub3cpLFxuICAgIGFnZW50SWQ6IG5vcm1hbGl6ZWRBZ2VudElkLFxuICAgIHJlcXVlc3RJZDogaW5wdXQucmVxdWVzdElkPy50cmltKCkgfHwgdW5kZWZpbmVkLFxuICAgIGtpbmQ6IGlucHV0LmtpbmQsXG4gICAgdGl0bGU6IG5vcm1hbGl6ZU9uZUxpbmUoaW5wdXQudGl0bGUsIDEyMCksXG4gICAgbWVzc2FnZTogbm9ybWFsaXplT25lTGluZShpbnB1dC5tZXNzYWdlLCAyMDAwKSxcbiAgICBjcmVhdGVkQXQ6IGlucHV0LmNyZWF0ZWRBdCA/PyBub3cudG9JU09TdHJpbmcoKSxcbiAgICByZWFkOiBmYWxzZSxcbiAgICBtZXRhOiBpbnB1dC5tZXRhLFxuICB9O1xuXG4gIGNvbnN0IGZpbGVQYXRoID0gYXdhaXQgcmVzb2x2ZU5vdGlmaWNhdGlvbkZpbGVQYXRoKG5vcm1hbGl6ZWRBZ2VudElkLCBob21lRGlyT3ZlcnJpZGUpO1xuICBhd2FpdCBhcHBlbmRGaWxlKGZpbGVQYXRoLCBgJHtKU09OLnN0cmluZ2lmeShwYXlsb2FkKX1cXG5gLCAndXRmLTgnKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxpc3RBZ2VudE5vdGlmaWNhdGlvbnMoXG4gIGlucHV0OiBBZ2VudE5vdGlmaWNhdGlvbkxpc3RJbnB1dCxcbik6IFByb21pc2U8QWdlbnROb3RpZmljYXRpb25MaXN0UmVzdWx0PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgbGltaXQgPSBNYXRoLm1heCgxLCBNYXRoLm1pbigyMDAsIGlucHV0LmxpbWl0ID8/IDUwKSk7XG4gICAgY29uc3QgYWxsID0gYXdhaXQgcmVhZE5vdGlmaWNhdGlvbnMoaW5wdXQuYWdlbnRJZCwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgICBjb25zdCBmaWx0ZXJlZCA9IGlucHV0LnVucmVhZE9ubHkgPyBhbGwuZmlsdGVyKChpdGVtKSA9PiAhaXRlbS5yZWFkKSA6IGFsbDtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIG5vdGlmaWNhdGlvbnM6IGZpbHRlcmVkLnNsaWNlKC1saW1pdCkucmV2ZXJzZSgpLFxuICAgIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgICAgbm90aWZpY2F0aW9uczogW10sXG4gICAgfTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFya0FnZW50Tm90aWZpY2F0aW9uc1JlYWQoXG4gIGlucHV0OiBBZ2VudE5vdGlmaWNhdGlvbk1hcmtSZWFkSW5wdXQsXG4pOiBQcm9taXNlPEFnZW50Tm90aWZpY2F0aW9uTWFya1JlYWRSZXN1bHQ+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBhbGwgPSBhd2FpdCByZWFkTm90aWZpY2F0aW9ucyhpbnB1dC5hZ2VudElkLCBpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuICAgIGlmIChhbGwubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCB1cGRhdGVkQ291bnQ6IDAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBtYXJrQWxsID0gaW5wdXQubWFya0FsbCA9PT0gdHJ1ZSB8fCAhaW5wdXQubm90aWZpY2F0aW9uSWRzIHx8IGlucHV0Lm5vdGlmaWNhdGlvbklkcy5sZW5ndGggPT09IDA7XG4gICAgY29uc3QgdGFyZ2V0cyA9IG5ldyBTZXQoKGlucHV0Lm5vdGlmaWNhdGlvbklkcyA/PyBbXSkubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pKTtcblxuICAgIGxldCB1cGRhdGVkQ291bnQgPSAwO1xuICAgIGNvbnN0IG5leHQgPSBhbGwubWFwKChpdGVtKSA9PiB7XG4gICAgICBpZiAoaXRlbS5yZWFkKSByZXR1cm4gaXRlbTtcbiAgICAgIGNvbnN0IHNob3VsZFJlYWQgPSBtYXJrQWxsIHx8IHRhcmdldHMuaGFzKGl0ZW0ubm90aWZpY2F0aW9uSWQpO1xuICAgICAgaWYgKCFzaG91bGRSZWFkKSByZXR1cm4gaXRlbTtcbiAgICAgIHVwZGF0ZWRDb3VudCArPSAxO1xuICAgICAgcmV0dXJuIHsgLi4uaXRlbSwgcmVhZDogdHJ1ZSB9O1xuICAgIH0pO1xuXG4gICAgaWYgKHVwZGF0ZWRDb3VudCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgdXBkYXRlZENvdW50OiAwIH07XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZVBhdGggPSBhd2FpdCByZXNvbHZlTm90aWZpY2F0aW9uRmlsZVBhdGgoaW5wdXQuYWdlbnRJZCwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgICBjb25zdCBzZXJpYWxpemVkID0gYCR7bmV4dC5tYXAoKGl0ZW0pID0+IEpTT04uc3RyaW5naWZ5KGl0ZW0pKS5qb2luKCdcXG4nKX1cXG5gO1xuICAgIGF3YWl0IHdyaXRlRmlsZShmaWxlUGF0aCwgc2VyaWFsaXplZCwgJ3V0Zi04Jyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHVwZGF0ZWRDb3VudCxcbiAgICB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgIHVwZGF0ZWRDb3VudDogMCxcbiAgICB9O1xuICB9XG59XG4iLCAiaW1wb3J0IHsgY29tcGlsZVNwZWNTdHJlYW0sIGNyZWF0ZU1peGVkU3RyZWFtUGFyc2VyIH0gZnJvbSAnQGpzb24tcmVuZGVyL2NvcmUnO1xuXG5pbXBvcnQgeyBnZXRBZ2VudFByb2ZpbGUgfSBmcm9tICcuL2FnZW50LXByb2ZpbGUtc2VydmljZSc7XG5pbXBvcnQgeyBnZXRBZ2VudFJ1bnRpbWVHYXRld2F5QmFzZVVybCwgZ2V0QWdlbnRSdW50aW1lU3RhdHVzIH0gZnJvbSAnLi9hZ2VudC1ydW50aW1lLXNlcnZpY2UnO1xuaW1wb3J0IHsgYXBwZW5kQWdlbnRDb2xsYWJvcmF0aW9uRXZlbnQsIGluZmVyRXZlbnRLaW5kRnJvbVJ1bnRpbWVMb2cgfSBmcm9tICcuL2FnZW50LWNvbGxhYm9yYXRpb24tZXZlbnQtc2VydmljZSc7XG5pbXBvcnQgeyBhcHBlbmRBZ2VudE5vdGlmaWNhdGlvbiB9IGZyb20gJy4vYWdlbnQtbm90aWZpY2F0aW9uLXNlcnZpY2UnO1xuaW1wb3J0IHR5cGUge1xuICBBZ2VudENoYXRJbnB1dCxcbiAgQWdlbnRDaGF0TWVzc2FnZSxcbiAgQWdlbnRDaGF0UmVzdWx0LFxuICBBZ2VudENoYXRTdHJlYW1DaHVuayxcbiAgQ2FuY2VsQWdlbnRDaGF0SW5wdXQsXG4gIENhbmNlbEFnZW50Q2hhdFJlc3VsdCxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IERFRkFVTFRfUkVRVUVTVF9USU1FT1VUX01TID0gNjAwXzAwMDtcbmNvbnN0IGFjdGl2ZUNoYXRDb250cm9sbGVycyA9IG5ldyBNYXA8c3RyaW5nLCBBYm9ydENvbnRyb2xsZXI+KCk7XG5jb25zdCBjYW5jZWxsZWRDaGF0UmVxdWVzdHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbmNvbnN0IEdFTl9VSV9QQVRDSF9PUFMgPSBuZXcgU2V0KFsnYWRkJywgJ3JlbW92ZScsICdyZXBsYWNlJywgJ21vdmUnLCAnY29weScsICd0ZXN0J10pO1xuXG5pbnRlcmZhY2UgT3BlbkFJQ2hhdE1lc3NhZ2Uge1xuICByb2xlOiAnc3lzdGVtJyB8ICd1c2VyJyB8ICdhc3Npc3RhbnQnO1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBPcGVuQUlDaGF0UmVzcG9uc2Uge1xuICByZXBseT86IHN0cmluZztcbiAgY2hvaWNlcz86IEFycmF5PHsgbWVzc2FnZT86IHsgY29udGVudD86IHN0cmluZyB9IH0+O1xufVxuXG5pbnRlcmZhY2UgQXBpQ2hhdFJlc3BvbnNlIHtcbiAgcmVwbHk/OiBzdHJpbmc7XG4gIG1vZGVsPzogc3RyaW5nO1xuICBlcnJvcj86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIE9wZW5BSUNoYXRTdHJlYW1DaHVuayB7XG4gIGNob2ljZXM/OiBBcnJheTx7XG4gICAgZGVsdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBtZXNzYWdlPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIH0+O1xufVxuXG5pbnRlcmZhY2UgR2F0ZXdheU9ic2VydmVyRXZlbnQge1xuICB0eXBlPzogc3RyaW5nO1xuICB0b29sPzogc3RyaW5nO1xuICBkdXJhdGlvbl9tcz86IG51bWJlcjtcbiAgc3VjY2Vzcz86IGJvb2xlYW47XG4gIGNvbXBvbmVudD86IHN0cmluZztcbiAgbWVzc2FnZT86IHN0cmluZztcbiAgcHJvdmlkZXI/OiBzdHJpbmc7XG4gIG1vZGVsPzogc3RyaW5nO1xuICB0aW1lc3RhbXA/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBQYXJzZWRHZW5VSVJlc3VsdCB7XG4gIHRleHQ6IHN0cmluZztcbiAgc3BlYz86IHVua25vd247XG59XG5cbmNvbnN0IFRPT0xfQ09ORklHX0lOVEVOVF9QQVRURVJOID1cbiAgLyhcdTkxNERcdTdGNkV8XHU4QkJFXHU3RjZFfFx1NTIwN1x1NjM2Mnxwcm92aWRlcnxhcGkga2V5fGFwaWtleXxcdTVCQzZcdTk0QTV8XHU0RUU0XHU3MjRDfHRva2VufGF1dGh8XHU2Mzg4XHU2NzQzfHByb3h5fFx1OERFRlx1NzUzMXxtb2RlbCByb3V0aW5nfFx1NkEyMVx1NTc4Qlx1OERFRlx1NzUzMXxxdW90YXxcdTk2NTBcdTk4OUR8d2ViX3NlYXJjaF9jb25maWd8d2ViX2FjY2Vzc19jb25maWd8bW9kZWxfcm91dGluZ19jb25maWd8bWFuYWdlX2F1dGhfcHJvZmlsZXxzd2l0Y2hfcHJvdmlkZXJ8Y2hlY2tfcHJvdmlkZXJfcXVvdGEpL2k7XG5cbmZ1bmN0aW9uIGJ1aWxkVG9vbEd1YXJkU3lzdGVtTWVzc2FnZSh1c2VyTWVzc2FnZTogc3RyaW5nKTogT3BlbkFJQ2hhdE1lc3NhZ2UgfCBudWxsIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHVzZXJNZXNzYWdlLnRyaW0oKTtcbiAgaWYgKCFub3JtYWxpemVkKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgaWYgKFRPT0xfQ09ORklHX0lOVEVOVF9QQVRURVJOLnRlc3Qobm9ybWFsaXplZCkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcm9sZTogJ3N5c3RlbScsXG4gICAgY29udGVudDogW1xuICAgICAgJ1x1NURFNVx1NTE3N1x1NEY3Rlx1NzUyOFx1ODlDNFx1NTIxOVx1RkYxQScsXG4gICAgICAnMS4gXHU0RUM1XHU1NzI4XHU3NTI4XHU2MjM3XHU2NjBFXHU3ODZFXHU4OTgxXHU2QzQyXHUyMDFDXHU0RkVFXHU2NTM5XHU5MTREXHU3RjZFL1x1NTIwN1x1NjM2Mlx1NjNEMFx1NEY5Qlx1NTU0Ni9cdThDMDNcdTY1NzRcdThERUZcdTc1MzEvXHU3QkExXHU3NDA2XHU1MUVEXHU2MzZFXHUyMDFEXHU2NUY2XHVGRjBDXHU2MjREXHU1M0VGXHU4QzAzXHU3NTI4ICpfY29uZmlnXHUzMDAxbWFuYWdlX2F1dGhfcHJvZmlsZVx1MzAwMXN3aXRjaF9wcm92aWRlclx1MzAwMWNoZWNrX3Byb3ZpZGVyX3F1b3RhXHUzMDAyJyxcbiAgICAgICcyLiBcdTY2NkVcdTkwMUFcdTRGRTFcdTYwNkZcdTY4QzBcdTdEMjJcdTYyMTZcdTY1NzBcdTYzNkVcdTY3RTVcdThCRTJcdTU3M0FcdTY2NkZcdUZGMENcdTVGQzVcdTk4N0JcdTRGMThcdTUxNDhcdThDMDNcdTc1MjhcdTYyNjdcdTg4NENcdTdDN0JcdTVERTVcdTUxNzdcdUZGMENcdTRFMERcdTg5ODFcdTUxNDhcdTY1MzlcdTkxNERcdTdGNkVcdTMwMDInLFxuICAgICAgJzMuIFx1OTcwMFx1ODk4MVx1ODA1NFx1N0Y1MVx1NjQxQ1x1N0QyMlx1NjVGNlx1RkYwQ1x1NEYxOFx1NTE0OFx1NEY3Rlx1NzUyOCB3ZWJfc2VhcmNoX3Rvb2xcdUZGMUJ3ZWJfc2VhcmNoX2NvbmZpZyBcdTRFQzVcdTc1MjhcdTRFOEVcdTkxNERcdTdGNkVcdTUzRDhcdTY2RjRcdTMwMDInLFxuICAgICAgJzQuIFx1ODJFNVx1NjI2N1x1ODg0Q1x1N0M3Qlx1NURFNVx1NTE3N1x1NTkzMVx1OEQyNVx1RkYwQ1x1NTE0OFx1OEZENFx1NTZERVx1NTkzMVx1OEQyNVx1NTM5Rlx1NTZFMFx1RkYwQ1x1NTE4RFx1OEJFMlx1OTVFRVx1NjYyRlx1NTQyNlx1NTE0MVx1OEJCOFx1OEMwM1x1NjU3NFx1OTE0RFx1N0Y2RVx1MzAwMicsXG4gICAgXS5qb2luKCdcXG4nKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdEpzb25CbG9ja3ModGV4dDogc3RyaW5nKTogQXJyYXk8eyByYXc6IHN0cmluZzsgdmFsdWU6IHVua25vd24gfT4ge1xuICBjb25zdCBibG9ja3M6IEFycmF5PHsgcmF3OiBzdHJpbmc7IHZhbHVlOiB1bmtub3duIH0+ID0gW107XG4gIGxldCBzdGFydCA9IC0xO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgaW5TdHJpbmcgPSBmYWxzZTtcbiAgbGV0IGVzY2FwZSA9IGZhbHNlO1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdGV4dC5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGNvbnN0IGNoYXIgPSB0ZXh0W2ldO1xuICAgIGlmIChpblN0cmluZykge1xuICAgICAgaWYgKGVzY2FwZSkge1xuICAgICAgICBlc2NhcGUgPSBmYWxzZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY2hhciA9PT0gJ1xcXFwnKSB7XG4gICAgICAgIGVzY2FwZSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNoYXIgPT09ICdcIicpIHtcbiAgICAgICAgaW5TdHJpbmcgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSAnXCInKSB7XG4gICAgICBpblN0cmluZyA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY2hhciA9PT0gJ3snKSB7XG4gICAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgICAgc3RhcnQgPSBpO1xuICAgICAgfVxuICAgICAgZGVwdGggKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjaGFyID09PSAnfScpIHtcbiAgICAgIGlmIChkZXB0aCA+IDApIHtcbiAgICAgICAgZGVwdGggLT0gMTtcbiAgICAgICAgaWYgKGRlcHRoID09PSAwICYmIHN0YXJ0ID49IDApIHtcbiAgICAgICAgICBjb25zdCByYXcgPSB0ZXh0LnNsaWNlKHN0YXJ0LCBpICsgMSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShyYXcpO1xuICAgICAgICAgICAgYmxvY2tzLnB1c2goeyByYXcsIHZhbHVlIH0pO1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgLy8gaWdub3JlIHBhcnNlIGZhaWx1cmVzXG4gICAgICAgICAgfVxuICAgICAgICAgIHN0YXJ0ID0gLTE7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gYmxvY2tzO1xufVxuXG5mdW5jdGlvbiBzdW1tYXJpemVOb3RpZmljYXRpb25NZXNzYWdlKHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB0ZXh0LnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCk7XG4gIGlmICghbm9ybWFsaXplZCkge1xuICAgIHJldHVybiAnXHU0RUZCXHU1MkExXHU2MjY3XHU4ODRDXHU1QjhDXHU2MjEwXHUzMDAyJztcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplZC5zbGljZSgwLCAyNDApO1xufVxuXG5mdW5jdGlvbiBsb29rc0xpa2VHZW5VaVNwZWMoY2FuZGlkYXRlOiB1bmtub3duKTogYm9vbGVhbiB7XG4gIGlmICghY2FuZGlkYXRlIHx8IHR5cGVvZiBjYW5kaWRhdGUgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IG9iaiA9IGNhbmRpZGF0ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKHR5cGVvZiBvYmoucm9vdCA9PT0gJ3N0cmluZycgJiYgb2JqLmVsZW1lbnRzICYmIHR5cGVvZiBvYmouZWxlbWVudHMgPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgZWxlbWVudHMgPSBPYmplY3QudmFsdWVzKG9iai5lbGVtZW50cyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik7XG4gICAgcmV0dXJuIGVsZW1lbnRzLnNvbWUoKGVsKSA9PiB0eXBlb2YgZWwgPT09ICdvYmplY3QnICYmIGVsICE9PSBudWxsICYmIHR5cGVvZiAoZWwgYXMgYW55KS50eXBlID09PSAnc3RyaW5nJyk7XG4gIH1cbiAgaWYgKHR5cGVvZiBvYmoudHlwZSA9PT0gJ3N0cmluZycgJiYgKG9iai5wcm9wcyB8fCBvYmouY2hpbGRyZW4pKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBsb29rc0xpa2VHZW5VaVBhdGNoKGNhbmRpZGF0ZTogdW5rbm93bik6IGJvb2xlYW4ge1xuICBpZiAoIWNhbmRpZGF0ZSB8fCB0eXBlb2YgY2FuZGlkYXRlICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBvYmogPSBjYW5kaWRhdGUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmICh0eXBlb2Ygb2JqLm9wICE9PSAnc3RyaW5nJyB8fCAhR0VOX1VJX1BBVENIX09QUy5oYXMob2JqLm9wKSkgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIG9iai5wYXRoICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gb2JqLnBhdGguc3RhcnRzV2l0aCgnLycpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVHZW5VaVNwZWMoc3BlYzogdW5rbm93bik6IHVua25vd24gfCB1bmRlZmluZWQge1xuICBpZiAobG9va3NMaWtlR2VuVWlTcGVjKHNwZWMpKSByZXR1cm4gc3BlYztcbiAgaWYgKCFzcGVjIHx8IHR5cGVvZiBzcGVjICE9PSAnb2JqZWN0JykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3Qgb2JqID0gc3BlYyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKEFycmF5LmlzQXJyYXkob2JqKSkge1xuICAgIGNvbnN0IGhhc0VsZW1lbnRzID0gb2JqLnNvbWUoKGl0ZW0pID0+IGl0ZW0gJiYgdHlwZW9mIGl0ZW0gPT09ICdvYmplY3QnICYmIHR5cGVvZiAoaXRlbSBhcyBhbnkpLnR5cGUgPT09ICdzdHJpbmcnKTtcbiAgICBpZiAoaGFzRWxlbWVudHMpIHtcbiAgICAgIHJldHVybiB7IHR5cGU6ICdkaXYnLCBwcm9wczoge30sIGNoaWxkcmVuOiBvYmogfTtcbiAgICB9XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkob2JqLmNoaWxkcmVuKSkge1xuICAgIHJldHVybiB7IHR5cGU6ICdkaXYnLCBwcm9wczoge30sIGNoaWxkcmVuOiBvYmouY2hpbGRyZW4gfTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBwYXJzZUdlblVpRnJvbVRleHQodGV4dDogc3RyaW5nKTogUGFyc2VkR2VuVUlSZXN1bHQge1xuICBpZiAoIXRleHQpIHJldHVybiB7IHRleHQgfTtcbiAgY29uc3QgYmxvY2tzID0gZXh0cmFjdEpzb25CbG9ja3ModGV4dCk7XG4gIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4geyB0ZXh0IH07XG5cbiAgbGV0IHNwZWM6IHVua25vd24gfCB1bmRlZmluZWQ7XG4gIGNvbnN0IHBhdGNoQmxvY2tzOiBBcnJheTx7IHJhdzogc3RyaW5nOyB2YWx1ZTogdW5rbm93biB9PiA9IFtdO1xuICBjb25zdCBzcGVjQmxvY2tzOiBBcnJheTx7IHJhdzogc3RyaW5nOyB2YWx1ZTogdW5rbm93biB9PiA9IFtdO1xuXG4gIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgaWYgKGxvb2tzTGlrZUdlblVpU3BlYyhibG9jay52YWx1ZSkpIHtcbiAgICAgIHNwZWNCbG9ja3MucHVzaChibG9jayk7XG4gICAgfSBlbHNlIGlmIChsb29rc0xpa2VHZW5VaVBhdGNoKGJsb2NrLnZhbHVlKSkge1xuICAgICAgcGF0Y2hCbG9ja3MucHVzaChibG9jayk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHNwZWNCbG9ja3MubGVuZ3RoID4gMCkge1xuICAgIHNwZWMgPSBzcGVjQmxvY2tzWzBdPy52YWx1ZTtcbiAgfSBlbHNlIGlmIChwYXRjaEJsb2Nrcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QganNvbmwgPSBwYXRjaEJsb2Nrcy5tYXAoKGJsb2NrKSA9PiBibG9jay5yYXcudHJpbSgpKS5qb2luKCdcXG4nKTtcbiAgICB0cnkge1xuICAgICAgc3BlYyA9IGNvbXBpbGVTcGVjU3RyZWFtKGpzb25sKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignW0FnZW50Q2hhdF0gR2VuVUkgcGF0Y2ggY29tcGlsZSBmYWlsZWQ6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVHZW5VaVNwZWMoc3BlYyk7XG5cbiAgaWYgKCFub3JtYWxpemVkKSB7XG4gICAgcmV0dXJuIHsgdGV4dCB9O1xuICB9XG5cbiAgcmV0dXJuIHsgdGV4dCwgc3BlYzogbm9ybWFsaXplZCB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVIaXN0b3J5KGhpc3Rvcnk/OiByZWFkb25seSBBZ2VudENoYXRNZXNzYWdlW10pOiBPcGVuQUlDaGF0TWVzc2FnZVtdIHtcbiAgaWYgKCFoaXN0b3J5KSByZXR1cm4gW107XG4gIHJldHVybiBoaXN0b3J5XG4gICAgLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5yb2xlID09PSAndXNlcicgfHwgaXRlbS5yb2xlID09PSAnYXNzaXN0YW50JylcbiAgICAubWFwKChpdGVtKSA9PiAoeyByb2xlOiBpdGVtLnJvbGUsIGNvbnRlbnQ6IGl0ZW0uY29udGVudCB9KSk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkQXBpQ2hhdENvbnRleHQoaGlzdG9yeTogcmVhZG9ubHkgT3BlbkFJQ2hhdE1lc3NhZ2VbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGluZXMgPSBoaXN0b3J5Lm1hcCgoaXRlbSkgPT4ge1xuICAgIGNvbnN0IHJvbGVMYWJlbCA9IGl0ZW0ucm9sZSA9PT0gJ2Fzc2lzdGFudCcgPyAnQXNzaXN0YW50JyA6ICdVc2VyJztcbiAgICByZXR1cm4gYCR7cm9sZUxhYmVsfTogJHtpdGVtLmNvbnRlbnR9YDtcbiAgfSk7XG5cbiAgcmV0dXJuIGxpbmVzLnNsaWNlKC0yMCk7XG59XG5cbmZ1bmN0aW9uIGlzTm90Rm91bmRFcnJvcihlcnJvcjogdW5rbm93bik6IGJvb2xlYW4ge1xuICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEVycm9yKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gL1xcKCg0MDR8NDA1KVxcKS8udGVzdChlcnJvci5tZXNzYWdlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gb2JzZXJ2ZUdhdGV3YXlFdmVudHMoXG4gIGFwaUJhc2U6IHN0cmluZyxcbiAgb25FdmVudDogKGV2ZW50OiBHYXRld2F5T2JzZXJ2ZXJFdmVudCkgPT4gdm9pZCxcbiAgYWJvcnRDb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXIsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgYmFzZSA9IGFwaUJhc2UucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIGNvbnN0IHVybCA9IGAke2Jhc2V9L2FwaS9ldmVudHNgO1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgaGVhZGVyczoge1xuICAgICAgQWNjZXB0OiAndGV4dC9ldmVudC1zdHJlYW0nLFxuICAgICAgJ0NhY2hlLUNvbnRyb2wnOiAnbm8tY2FjaGUnLFxuICAgIH0sXG4gICAgc2lnbmFsOiBhYm9ydENvbnRyb2xsZXIuc2lnbmFsLFxuICB9KTtcblxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBcdTdGNTFcdTUxNzNcdTRFOEJcdTRFRjZcdThCQTJcdTk2MDVcdTU5MzFcdThEMjUgKCR7cmVzcG9uc2Uuc3RhdHVzfSlgKTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLmJvZHkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1x1N0Y1MVx1NTE3M1x1NEU4Qlx1NEVGNlx1NkQ0MVx1NEUzQVx1N0E3QScpO1xuICB9XG5cbiAgY29uc3QgZGVjb2RlciA9IG5ldyBUZXh0RGVjb2RlcigndXRmLTgnKTtcbiAgY29uc3QgcmVhZGVyID0gcmVzcG9uc2UuYm9keS5nZXRSZWFkZXIoKTtcbiAgbGV0IGJ1ZmZlciA9ICcnO1xuICBsZXQgY3VycmVudERhdGEgPSAnJztcblxuICBjb25zdCBmbHVzaEV2ZW50ID0gKCkgPT4ge1xuICAgIGNvbnN0IHJhdyA9IGN1cnJlbnREYXRhLnRyaW0oKTtcbiAgICBjdXJyZW50RGF0YSA9ICcnO1xuICAgIGlmICghcmF3KSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyBHYXRld2F5T2JzZXJ2ZXJFdmVudDtcbiAgICAgIG9uRXZlbnQocGFyc2VkKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGlnbm9yZSBtYWxmb3JtZWQgZXZlbnQgcGF5bG9hZFxuICAgIH1cbiAgfTtcblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIGNvbnN0IHsgdmFsdWUsIGRvbmUgfSA9IGF3YWl0IHJlYWRlci5yZWFkKCk7XG4gICAgaWYgKGRvbmUpIGJyZWFrO1xuICAgIGJ1ZmZlciArPSBkZWNvZGVyLmRlY29kZSh2YWx1ZSwgeyBzdHJlYW06IHRydWUgfSk7XG4gICAgY29uc3QgbGluZXMgPSBidWZmZXIuc3BsaXQoL1xccj9cXG4vKTtcbiAgICBidWZmZXIgPSBsaW5lcy5wb3AoKSA/PyAnJztcblxuICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgaWYgKCFsaW5lKSB7XG4gICAgICAgIGZsdXNoRXZlbnQoKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAobGluZS5zdGFydHNXaXRoKCdkYXRhOicpKSB7XG4gICAgICAgIGN1cnJlbnREYXRhICs9IGAke2xpbmUuc2xpY2UoNSkudHJpbSgpfVxcbmA7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZmx1c2hFdmVudCgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXF1ZXN0QXBpQ2hhdENvbXBsZXRpb24oXG4gIGFwaUJhc2U6IHN0cmluZyxcbiAgbWVzc2FnZTogc3RyaW5nLFxuICBjb250ZXh0OiBzdHJpbmdbXSxcbiAgdGltZW91dE1zOiBudW1iZXIsXG4gIGFib3J0Q29udHJvbGxlcj86IEFib3J0Q29udHJvbGxlcixcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGNvbnRyb2xsZXIgPSBhYm9ydENvbnRyb2xsZXIgPz8gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLCB0aW1lb3V0TXMpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgYmFzZSA9IGFwaUJhc2UucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgY29uc3QgdXJsID0gYCR7YmFzZX0vYXBpL2NoYXRgO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIGNvbnRleHQsXG4gICAgICB9KSxcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBcdTdGNTFcdTUxNzNcdThCRjdcdTZDNDJcdTU5MzFcdThEMjUgKCR7cmVzcG9uc2Uuc3RhdHVzfSkgJHt0ZXh0fWApO1xuICAgIH1cblxuICAgIGNvbnN0IHBheWxvYWQgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpKSBhcyBBcGlDaGF0UmVzcG9uc2U7XG4gICAgaWYgKHR5cGVvZiBwYXlsb2FkLmVycm9yID09PSAnc3RyaW5nJyAmJiBwYXlsb2FkLmVycm9yLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IocGF5bG9hZC5lcnJvcik7XG4gICAgfVxuICAgIGNvbnN0IGNvbnRlbnQgPSBwYXlsb2FkLnJlcGx5O1xuICAgIGlmICghY29udGVudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdcdTdGNTFcdTUxNzNcdThGRDRcdTU2REVcdTRFM0FcdTdBN0EnKTtcbiAgICB9XG4gICAgcmV0dXJuIGNvbnRlbnQ7XG4gIH0gZmluYWxseSB7XG4gICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXF1ZXN0Q2hhdENvbXBsZXRpb25Db21wYXQoXG4gIGFwaUJhc2U6IHN0cmluZyxcbiAgbW9kZWxOYW1lOiBzdHJpbmcsXG4gIG1lc3NhZ2VzOiBPcGVuQUlDaGF0TWVzc2FnZVtdLFxuICB0aW1lb3V0TXM6IG51bWJlcixcbiAgYWJvcnRDb250cm9sbGVyPzogQWJvcnRDb250cm9sbGVyLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgY29udHJvbGxlciA9IGFib3J0Q29udHJvbGxlciA/PyBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiBjb250cm9sbGVyLmFib3J0KCksIHRpbWVvdXRNcyk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBiYXNlID0gYXBpQmFzZS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBjb25zdCB1cmwgPSBgJHtiYXNlfS92MS9jaGF0L2NvbXBsZXRpb25zYDtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBtb2RlbDogbW9kZWxOYW1lLFxuICAgICAgICBtZXNzYWdlcyxcbiAgICAgICAgdGVtcGVyYXR1cmU6IDAuMixcbiAgICAgICAgc3RyZWFtOiBmYWxzZSxcbiAgICAgIH0pLFxuICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICB9KTtcblxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFx1N0Y1MVx1NTE3M1x1OEJGN1x1NkM0Mlx1NTkzMVx1OEQyNSAoJHtyZXNwb25zZS5zdGF0dXN9KSAke3RleHR9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgcGF5bG9hZCA9IChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIE9wZW5BSUNoYXRSZXNwb25zZTtcbiAgICBjb25zdCBjb250ZW50ID0gcGF5bG9hZC5yZXBseSA/PyBwYXlsb2FkLmNob2ljZXM/LlswXT8ubWVzc2FnZT8uY29udGVudDtcbiAgICBpZiAoIWNvbnRlbnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignXHU3RjUxXHU1MTczXHU4RkQ0XHU1NkRFXHU0RTNBXHU3QTdBJyk7XG4gICAgfVxuICAgIHJldHVybiBjb250ZW50O1xuICB9IGZpbmFsbHkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lcik7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVxdWVzdENoYXRDb21wbGV0aW9uU3RyZWFtKFxuICBhcGlCYXNlOiBzdHJpbmcsXG4gIG1vZGVsTmFtZTogc3RyaW5nLFxuICBtZXNzYWdlczogT3BlbkFJQ2hhdE1lc3NhZ2VbXSxcbiAgdGltZW91dE1zOiBudW1iZXIsXG4gIG9uRGVsdGE/OiAoZGVsdGE6IHN0cmluZykgPT4gdm9pZCxcbiAgYWJvcnRDb250cm9sbGVyPzogQWJvcnRDb250cm9sbGVyLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgY29udHJvbGxlciA9IGFib3J0Q29udHJvbGxlciA/PyBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiBjb250cm9sbGVyLmFib3J0KCksIHRpbWVvdXRNcyk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBiYXNlID0gYXBpQmFzZS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBjb25zdCB1cmwgPSBgJHtiYXNlfS92MS9jaGF0L2NvbXBsZXRpb25zYDtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBtb2RlbDogbW9kZWxOYW1lLFxuICAgICAgICBtZXNzYWdlcyxcbiAgICAgICAgdGVtcGVyYXR1cmU6IDAuMixcbiAgICAgICAgc3RyZWFtOiB0cnVlLFxuICAgICAgfSksXG4gICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgXHU3RjUxXHU1MTczXHU4QkY3XHU2QzQyXHU1OTMxXHU4RDI1ICgke3Jlc3BvbnNlLnN0YXR1c30pICR7dGV4dH1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBjb250ZW50VHlwZSA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCdjb250ZW50LXR5cGUnKSA/PyAnJztcbiAgICBpZiAoY29udGVudFR5cGUuaW5jbHVkZXMoJ2FwcGxpY2F0aW9uL2pzb24nKSkge1xuICAgICAgY29uc3QgcGF5bG9hZCA9IChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIE9wZW5BSUNoYXRSZXNwb25zZTtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBwYXlsb2FkLnJlcGx5ID8/IHBheWxvYWQuY2hvaWNlcz8uWzBdPy5tZXNzYWdlPy5jb250ZW50ID8/ICcnO1xuICAgICAgaWYgKCFjb250ZW50KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignXHU3RjUxXHU1MTczXHU4RkQ0XHU1NkRFXHU0RTNBXHU3QTdBJyk7XG4gICAgICB9XG4gICAgICBvbkRlbHRhPy4oY29udGVudCk7XG4gICAgICByZXR1cm4gY29udGVudDtcbiAgICB9XG5cbiAgICBpZiAoIXJlc3BvbnNlLmJvZHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignXHU3RjUxXHU1MTczXHU2RDQxXHU1RjBGXHU1NENEXHU1RTk0XHU0RTNBXHU3QTdBJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplVGV4dFBhcnQodmFsdWU6IHVua25vd24pOiBzdHJpbmcge1xuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHJldHVybiB2YWx1ZTtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICByZXR1cm4gdmFsdWVcbiAgICAgICAgICAubWFwKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGl0ZW0gPT09ICdzdHJpbmcnKSByZXR1cm4gaXRlbTtcbiAgICAgICAgICAgIGlmICghaXRlbSB8fCB0eXBlb2YgaXRlbSAhPT0gJ29iamVjdCcpIHJldHVybiAnJztcbiAgICAgICAgICAgIGNvbnN0IG9iaiA9IGl0ZW0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgICAgICBpZiAodHlwZW9mIG9iai50ZXh0ID09PSAnc3RyaW5nJykgcmV0dXJuIG9iai50ZXh0O1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBvYmouY29udGVudCA9PT0gJ3N0cmluZycpIHJldHVybiBvYmouY29udGVudDtcbiAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5qb2luKCcnKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBleHRyYWN0RGVsdGFUZXh0KGNodW5rOiBPcGVuQUlDaGF0U3RyZWFtQ2h1bmspOiBzdHJpbmcge1xuICAgICAgY29uc3QgY2hvaWNlID0gY2h1bmsuY2hvaWNlcz8uWzBdO1xuICAgICAgaWYgKCFjaG9pY2UpIHJldHVybiAnJztcbiAgICAgIGNvbnN0IGRlbHRhID0gY2hvaWNlLmRlbHRhID8/IHt9O1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGNob2ljZS5tZXNzYWdlID8/IHt9O1xuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICAgICAgZGVsdGEuY29udGVudCxcbiAgICAgICAgZGVsdGEucmVhc29uaW5nX2NvbnRlbnQsXG4gICAgICAgIGRlbHRhLnJlYXNvbmluZyxcbiAgICAgICAgZGVsdGEudGV4dCxcbiAgICAgICAgbWVzc2FnZS5jb250ZW50LFxuICAgICAgICBtZXNzYWdlLnJlYXNvbmluZ19jb250ZW50LFxuICAgICAgICBtZXNzYWdlLnJlYXNvbmluZyxcbiAgICAgICAgbWVzc2FnZS50ZXh0LFxuICAgICAgXTtcbiAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgICAgY29uc3QgdGV4dCA9IG5vcm1hbGl6ZVRleHRQYXJ0KGNhbmRpZGF0ZSk7XG4gICAgICAgIGlmICh0ZXh0KSByZXR1cm4gdGV4dDtcbiAgICAgIH1cbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBjb25zdCBkZWNvZGVyID0gbmV3IFRleHREZWNvZGVyKCd1dGYtOCcpO1xuICAgIGNvbnN0IHJlYWRlciA9IHJlc3BvbnNlLmJvZHkuZ2V0UmVhZGVyKCk7XG4gICAgbGV0IGJ1ZmZlciA9ICcnO1xuICAgIGxldCBjb250ZW50ID0gJyc7XG4gICAgbGV0IHNob3VsZFN0b3AgPSBmYWxzZTtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCB7IHZhbHVlLCBkb25lIH0gPSBhd2FpdCByZWFkZXIucmVhZCgpO1xuICAgICAgaWYgKGRvbmUpIGJyZWFrO1xuICAgICAgYnVmZmVyICs9IGRlY29kZXIuZGVjb2RlKHZhbHVlLCB7IHN0cmVhbTogdHJ1ZSB9KTtcblxuICAgICAgY29uc3QgbGluZXMgPSBidWZmZXIuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIGJ1ZmZlciA9IGxpbmVzLnBvcCgpID8/ICcnO1xuXG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgICAgICBpZiAoIXRyaW1tZWQuc3RhcnRzV2l0aCgnZGF0YTonKSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSB0cmltbWVkLnJlcGxhY2UoL15kYXRhOlxccyovLCAnJyk7XG4gICAgICAgIGlmIChwYXlsb2FkID09PSAnW0RPTkVdJykge1xuICAgICAgICAgIHNob3VsZFN0b3AgPSB0cnVlO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QganNvbiA9IEpTT04ucGFyc2UocGF5bG9hZCkgYXMgT3BlbkFJQ2hhdFN0cmVhbUNodW5rO1xuICAgICAgICAgIGNvbnN0IGRlbHRhID0gZXh0cmFjdERlbHRhVGV4dChqc29uKTtcbiAgICAgICAgICBpZiAoZGVsdGEpIHtcbiAgICAgICAgICAgIGNvbnRlbnQgKz0gZGVsdGE7XG4gICAgICAgICAgICBvbkRlbHRhPy4oZGVsdGEpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gaWdub3JlIG1hbGZvcm1lZCBjaHVua1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChzaG91bGRTdG9wKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzaG91bGRTdG9wKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCByZWFkZXIuY2FuY2VsKCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gaWdub3JlIGNhbmNlbCBlcnJvcnNcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY29udGVudDtcbiAgfSBmaW5hbGx5IHtcbiAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUNoYXRNb2RlUGFyc2VyKFxuICBlbWl0Q2h1bms6IChjaHVuazogQWdlbnRDaGF0U3RyZWFtQ2h1bmspID0+IHZvaWQsXG4gIHJlcXVlc3RJZDogc3RyaW5nLFxuICBvbkxvZ0NodW5rPzogKHZhbHVlOiBzdHJpbmcpID0+IHZvaWQsXG4pOiB7IHB1c2g6IChjaHVuazogc3RyaW5nKSA9PiB2b2lkOyBmbHVzaDogKCkgPT4gdm9pZCB9IHtcbiAgY29uc3QgUEFUQ0hfU1RBUlRfUEFUVEVSTiA9XG4gICAgLyg/Ol58XFxuKVxccyooPzpgYGBzcGVjXFxifFxce1wib3BcIlxccyo6XFxzKlwiKD86YWRkfHJlbW92ZXxyZXBsYWNlfG1vdmV8Y29weXx0ZXN0KVwiXFxzKixcXHMqXCJwYXRoXCJcXHMqOikvbTtcbiAgY29uc3QgUEFUQ0hfREVURUNUSU9OX1RBSUwgPSAxNjA7XG5cbiAgY29uc3QgcGFyc2VyID0gY3JlYXRlTWl4ZWRTdHJlYW1QYXJzZXIoe1xuICAgIG9uVGV4dDogKCkgPT4ge1xuICAgICAgLy8gXHU2NTg3XHU2NzJDXHU1REYyXHU5MDFBXHU4RkM3IGRlbHRhIFx1NzZGNFx1NjNBNVx1NjNBOFx1OTAwMVx1NTIzMFx1NkUzMlx1NjdEM1x1OEZEQlx1N0EwQlx1RkYwQ1x1OEZEOVx1OTFDQ1x1NEVDNVx1NTA1QVx1NTE3Q1x1NUJCOVx1NTM2MFx1NEY0RFx1MzAwMlxuICAgIH0sXG4gICAgb25QYXRjaDogKHBhdGNoKSA9PiB7XG4gICAgICBlbWl0Q2h1bmsoe1xuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIGtpbmQ6ICdwYXRjaCcsXG4gICAgICAgIHZhbHVlOiBgJHtKU09OLnN0cmluZ2lmeShwYXRjaCl9XFxuYCxcbiAgICAgIH0pO1xuICAgIH0sXG4gIH0pO1xuXG4gIGxldCBwYXRjaFN0YXJ0ZWQgPSBmYWxzZTtcbiAgbGV0IHBlbmRpbmdUZXh0ID0gJyc7XG5cbiAgY29uc3QgZW1pdFRleHRDaHVuayA9ICh2YWx1ZTogc3RyaW5nKSA9PiB7XG4gICAgaWYgKCF2YWx1ZSkgcmV0dXJuO1xuICAgIGVtaXRDaHVuayh7IHJlcXVlc3RJZCwga2luZDogJ3RleHQnLCB2YWx1ZSB9KTtcbiAgfTtcblxuICBjb25zdCBlbWl0TG9nQ2h1bmsgPSAodmFsdWU6IHN0cmluZykgPT4ge1xuICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICBvbkxvZ0NodW5rPy4odmFsdWUpO1xuICAgIGVtaXRDaHVuayh7IHJlcXVlc3RJZCwga2luZDogJ2xvZycsIHZhbHVlIH0pO1xuICB9O1xuXG4gIHJldHVybiB7XG4gICAgcHVzaDogKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICAgIGlmICghY2h1bmspIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBlbWl0TG9nQ2h1bmsoY2h1bmspO1xuICAgICAgcGFyc2VyLnB1c2goY2h1bmspO1xuXG4gICAgICBpZiAocGF0Y2hTdGFydGVkKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgcGVuZGluZ1RleHQgKz0gY2h1bms7XG4gICAgICBjb25zdCBtYXRjaCA9IHBlbmRpbmdUZXh0Lm1hdGNoKFBBVENIX1NUQVJUX1BBVFRFUk4pO1xuICAgICAgaWYgKHR5cGVvZiBtYXRjaD8uaW5kZXggPT09ICdudW1iZXInKSB7XG4gICAgICAgIGNvbnN0IHNhZmVUZXh0ID0gcGVuZGluZ1RleHQuc2xpY2UoMCwgbWF0Y2guaW5kZXgpO1xuICAgICAgICBlbWl0VGV4dENodW5rKHNhZmVUZXh0KTtcbiAgICAgICAgcGVuZGluZ1RleHQgPSAnJztcbiAgICAgICAgcGF0Y2hTdGFydGVkID0gdHJ1ZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAocGVuZGluZ1RleHQubGVuZ3RoID4gUEFUQ0hfREVURUNUSU9OX1RBSUwpIHtcbiAgICAgICAgY29uc3Qgc2FmZUxlbmd0aCA9IHBlbmRpbmdUZXh0Lmxlbmd0aCAtIFBBVENIX0RFVEVDVElPTl9UQUlMO1xuICAgICAgICBjb25zdCBzYWZlVGV4dCA9IHBlbmRpbmdUZXh0LnNsaWNlKDAsIHNhZmVMZW5ndGgpO1xuICAgICAgICBwZW5kaW5nVGV4dCA9IHBlbmRpbmdUZXh0LnNsaWNlKHNhZmVMZW5ndGgpO1xuICAgICAgICBlbWl0VGV4dENodW5rKHNhZmVUZXh0KTtcbiAgICAgIH1cbiAgICB9LFxuICAgIGZsdXNoOiAoKSA9PiB7XG4gICAgICBwYXJzZXIuZmx1c2goKTtcbiAgICAgIGlmICghcGF0Y2hTdGFydGVkICYmIHBlbmRpbmdUZXh0KSB7XG4gICAgICAgIGVtaXRUZXh0Q2h1bmsocGVuZGluZ1RleHQpO1xuICAgICAgfVxuICAgICAgcGVuZGluZ1RleHQgPSAnJztcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VuZEFnZW50Q2hhdChcbiAgaW5wdXQ6IEFnZW50Q2hhdElucHV0LFxuICBlbWl0Q2h1bms/OiAoY2h1bms6IEFnZW50Q2hhdFN0cmVhbUNodW5rKSA9PiB2b2lkLFxuKTogUHJvbWlzZTxBZ2VudENoYXRSZXN1bHQ+IHtcbiAgY29uc3QgcHJvZmlsZSA9IGF3YWl0IGdldEFnZW50UHJvZmlsZSh7IGFnZW50SWQ6IGlucHV0LmFnZW50SWQsIGhvbWVEaXJPdmVycmlkZTogaW5wdXQuaG9tZURpck92ZXJyaWRlIH0pO1xuICBjb25zdCBydW50aW1lU3RhdHVzID0gZ2V0QWdlbnRSdW50aW1lU3RhdHVzKHByb2ZpbGUuYWdlbnRJZCk7XG4gIGlmIChydW50aW1lU3RhdHVzLnN0YXR1cyAhPT0gJ29ubGluZScpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBjb250ZW50OiAnXHU2NjdBXHU4MEZEXHU0RjUzXHU2NzJBXHU4RkQwXHU4ODRDXHVGRjBDXHU4QkY3XHU1MTQ4XHU1NDJGXHU1MkE4XHU2NjdBXHU4MEZEXHU0RjUzXHU4RkQwXHU4ODRDXHU2NUY2XHUzMDAyJyxcbiAgICAgIGVycm9yOiAnXHU2NjdBXHU4MEZEXHU0RjUzXHU3OUJCXHU3RUJGJyxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgZ2F0ZXdheUJhc2VVcmwgPSBnZXRBZ2VudFJ1bnRpbWVHYXRld2F5QmFzZVVybChwcm9maWxlLmFnZW50SWQpO1xuICBjb25zdCB0aW1lb3V0TXMgPSBERUZBVUxUX1JFUVVFU1RfVElNRU9VVF9NUztcbiAgY29uc3QgaGlzdG9yeSA9IG5vcm1hbGl6ZUhpc3RvcnkoaW5wdXQuaGlzdG9yeSk7XG4gIGNvbnN0IHRvb2xHdWFyZFN5c3RlbU1lc3NhZ2UgPSBidWlsZFRvb2xHdWFyZFN5c3RlbU1lc3NhZ2UoaW5wdXQubWVzc2FnZSk7XG4gIGNvbnN0IGNvbnRleHRMaW5lcyA9IGJ1aWxkQXBpQ2hhdENvbnRleHQoaGlzdG9yeSk7XG4gIGlmICh0b29sR3VhcmRTeXN0ZW1NZXNzYWdlKSB7XG4gICAgY29udGV4dExpbmVzLnVuc2hpZnQoYFN5c3RlbTogJHt0b29sR3VhcmRTeXN0ZW1NZXNzYWdlLmNvbnRlbnR9YCk7XG4gIH1cbiAgY29uc3QgbWVzc2FnZXM6IE9wZW5BSUNoYXRNZXNzYWdlW10gPSBbXG4gICAgLi4uKHRvb2xHdWFyZFN5c3RlbU1lc3NhZ2UgPyBbdG9vbEd1YXJkU3lzdGVtTWVzc2FnZV0gOiBbXSksXG4gICAgLi4uaGlzdG9yeSxcbiAgICB7IHJvbGU6ICd1c2VyJywgY29udGVudDogaW5wdXQubWVzc2FnZSB9LFxuICBdO1xuXG4gIGNvbnN0IHJlcXVlc3RJZCA9IGlucHV0LnJlcXVlc3RJZCA/PyBgcmVxXyR7RGF0ZS5ub3coKX1gO1xuICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpO1xuICBhY3RpdmVDaGF0Q29udHJvbGxlcnMuc2V0KHJlcXVlc3RJZCwgY29udHJvbGxlcik7XG4gIGNvbnN0IGV2ZW50Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgbGV0IGV2ZW50V2F0Y2hlcjogUHJvbWlzZTx2b2lkPiB8IG51bGwgPSBudWxsO1xuICBsZXQgZXZlbnRXcml0ZVF1ZXVlOiBQcm9taXNlPHZvaWQ+ID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIGxldCBsb2dMaW5lQnVmZmVyID0gJyc7XG4gIGNvbnN0IHJlcXVlc3RTdGFydGVkQXQgPSBEYXRlLm5vdygpO1xuXG4gIGNvbnN0IHF1ZXVlRXZlbnQgPSAoXG4gICAga2luZDogJ2NoYXRfc3RhcnRlZCcgfCAncnVudGltZV9sb2cnIHwgJ3Rvb2xfY2FsbCcgfCAnZGVsZWdhdGVfY2FsbCcgfCAnaXBjX2NhbGwnIHwgJ2NoYXRfZG9uZScgfCAnY2hhdF9lcnJvcicsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIG1ldGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgKSA9PiB7XG4gICAgZXZlbnRXcml0ZVF1ZXVlID0gZXZlbnRXcml0ZVF1ZXVlXG4gICAgICAudGhlbigoKSA9PlxuICAgICAgICBhcHBlbmRBZ2VudENvbGxhYm9yYXRpb25FdmVudChcbiAgICAgICAgICBwcm9maWxlLmFnZW50SWQsXG4gICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGtpbmQsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgbWV0YSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGlucHV0LmhvbWVEaXJPdmVycmlkZSxcbiAgICAgICAgKSxcbiAgICAgIClcbiAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgY29uc29sZS5lcnJvcignW0FnZW50Q2hhdF0gY29sbGFib3JhdGlvbiBldmVudCBhcHBlbmQgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgIH0pO1xuICB9O1xuXG4gIGNvbnN0IHF1ZXVlTm90aWZpY2F0aW9uID0gKFxuICAgIGtpbmQ6ICdyZXF1ZXN0X2RvbmUnIHwgJ3JlcXVlc3RfZXJyb3InLFxuICAgIHRpdGxlOiBzdHJpbmcsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIG1ldGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgKSA9PiB7XG4gICAgZXZlbnRXcml0ZVF1ZXVlID0gZXZlbnRXcml0ZVF1ZXVlXG4gICAgICAudGhlbigoKSA9PlxuICAgICAgICBhcHBlbmRBZ2VudE5vdGlmaWNhdGlvbihcbiAgICAgICAgICBwcm9maWxlLmFnZW50SWQsXG4gICAgICAgICAge1xuICAgICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgICAga2luZCxcbiAgICAgICAgICAgIHRpdGxlLFxuICAgICAgICAgICAgbWVzc2FnZTogc3VtbWFyaXplTm90aWZpY2F0aW9uTWVzc2FnZShtZXNzYWdlKSxcbiAgICAgICAgICAgIG1ldGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBpbnB1dC5ob21lRGlyT3ZlcnJpZGUsXG4gICAgICAgICksXG4gICAgICApXG4gICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tBZ2VudENoYXRdIG5vdGlmaWNhdGlvbiBhcHBlbmQgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgIH0pO1xuICB9O1xuXG4gIGNvbnN0IHF1ZXVlUnVudGltZUxvZ0NodW5rID0gKGNodW5rOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoIWNodW5rKSByZXR1cm47XG4gICAgbG9nTGluZUJ1ZmZlciArPSBjaHVuaztcbiAgICBjb25zdCBsaW5lcyA9IGxvZ0xpbmVCdWZmZXIuc3BsaXQoL1xccj9cXG4vKTtcbiAgICBsb2dMaW5lQnVmZmVyID0gbGluZXMucG9wKCkgPz8gJyc7XG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkID0gbGluZS50cmltKCk7XG4gICAgICBpZiAoIW5vcm1hbGl6ZWQpIGNvbnRpbnVlO1xuICAgICAgcXVldWVFdmVudChpbmZlckV2ZW50S2luZEZyb21SdW50aW1lTG9nKG5vcm1hbGl6ZWQpLCBub3JtYWxpemVkKTtcbiAgICB9XG4gIH07XG5cbiAgcXVldWVFdmVudCgnY2hhdF9zdGFydGVkJywgaW5wdXQubWVzc2FnZSwge1xuICAgIHN0cmVhbTogISFpbnB1dC5zdHJlYW0sXG4gICAgaGlzdG9yeUNvdW50OiBoaXN0b3J5Lmxlbmd0aCxcbiAgICBnYXRld2F5QmFzZVVybCxcbiAgfSk7XG5cbiAgY29uc3QgZW1pdFJ1bnRpbWVMb2cgPSAobWVzc2FnZTogc3RyaW5nKSA9PiB7XG4gICAgaWYgKCFtZXNzYWdlLnRyaW0oKSkgcmV0dXJuO1xuICAgIGVtaXRDaHVuaz8uKHtcbiAgICAgIHJlcXVlc3RJZCxcbiAgICAgIGtpbmQ6ICdsb2cnLFxuICAgICAgdmFsdWU6IGAke21lc3NhZ2V9XFxuYCxcbiAgICB9KTtcbiAgfTtcblxuICBjb25zdCB0b0V2ZW50VGltZXN0YW1wID0gKHZhbHVlPzogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCA9PiB7XG4gICAgaWYgKCF2YWx1ZSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgdHMgPSBEYXRlLnBhcnNlKHZhbHVlKTtcbiAgICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKHRzKSA/IHRzIDogbnVsbDtcbiAgfTtcblxuICBldmVudFdhdGNoZXIgPSBvYnNlcnZlR2F0ZXdheUV2ZW50cyhcbiAgICBnYXRld2F5QmFzZVVybCxcbiAgICAoZXZlbnQpID0+IHtcbiAgICAgIGNvbnN0IHRzID0gdG9FdmVudFRpbWVzdGFtcChldmVudC50aW1lc3RhbXApO1xuICAgICAgaWYgKHRzICE9PSBudWxsICYmIHRzICsgNTAwIDwgcmVxdWVzdFN0YXJ0ZWRBdCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCB0eXBlID0gKGV2ZW50LnR5cGUgPz8gJycpLnRyaW0oKTtcbiAgICAgIGlmICghdHlwZSkgcmV0dXJuO1xuXG4gICAgICBpZiAodHlwZSA9PT0gJ3Rvb2xfY2FsbF9zdGFydCcpIHtcbiAgICAgICAgY29uc3QgdG9vbE5hbWUgPSBldmVudC50b29sPy50cmltKCkgfHwgJ3Vua25vd25fdG9vbCc7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgW3Rvb2w6c3RhcnRdICR7dG9vbE5hbWV9YDtcbiAgICAgICAgcXVldWVFdmVudCh0b29sTmFtZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdkZWxlZ2F0ZScpID8gJ2RlbGVnYXRlX2NhbGwnIDogJ3Rvb2xfY2FsbCcsIG1lc3NhZ2UsIHtcbiAgICAgICAgICB0b29sOiB0b29sTmFtZSxcbiAgICAgICAgICB0aW1lc3RhbXA6IGV2ZW50LnRpbWVzdGFtcCxcbiAgICAgICAgfSk7XG4gICAgICAgIGVtaXRSdW50aW1lTG9nKG1lc3NhZ2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlID09PSAndG9vbF9jYWxsJykge1xuICAgICAgICBjb25zdCB0b29sTmFtZSA9IGV2ZW50LnRvb2w/LnRyaW0oKSB8fCAndW5rbm93bl90b29sJztcbiAgICAgICAgY29uc3QgZHVyYXRpb24gPSB0eXBlb2YgZXZlbnQuZHVyYXRpb25fbXMgPT09ICdudW1iZXInID8gZXZlbnQuZHVyYXRpb25fbXMgOiB1bmRlZmluZWQ7XG4gICAgICAgIGNvbnN0IHN1Y2Nlc3MgPSBldmVudC5zdWNjZXNzICE9PSBmYWxzZTtcbiAgICAgICAgY29uc3QgbWVzc2FnZSA9IGBbdG9vbF0gJHt0b29sTmFtZX0gJHtzdWNjZXNzID8gJ3N1Y2Nlc3MnIDogJ2ZhaWxlZCd9JHtcbiAgICAgICAgICB0eXBlb2YgZHVyYXRpb24gPT09ICdudW1iZXInID8gYCAoJHtkdXJhdGlvbn1tcylgIDogJydcbiAgICAgICAgfWA7XG4gICAgICAgIHF1ZXVlRXZlbnQodG9vbE5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnZGVsZWdhdGUnKSA/ICdkZWxlZ2F0ZV9jYWxsJyA6ICd0b29sX2NhbGwnLCBtZXNzYWdlLCB7XG4gICAgICAgICAgdG9vbDogdG9vbE5hbWUsXG4gICAgICAgICAgZHVyYXRpb25NczogZHVyYXRpb24sXG4gICAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgICB0aW1lc3RhbXA6IGV2ZW50LnRpbWVzdGFtcCxcbiAgICAgICAgfSk7XG4gICAgICAgIGVtaXRSdW50aW1lTG9nKG1lc3NhZ2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlID09PSAnZXJyb3InKSB7XG4gICAgICAgIGNvbnN0IGNvbXBvbmVudCA9IGV2ZW50LmNvbXBvbmVudD8udHJpbSgpIHx8ICdnYXRld2F5JztcbiAgICAgICAgY29uc3QgZGV0YWlscyA9IGV2ZW50Lm1lc3NhZ2U/LnRyaW0oKSB8fCAndW5rbm93biBlcnJvcic7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgWyR7Y29tcG9uZW50fV0gJHtkZXRhaWxzfWA7XG4gICAgICAgIHF1ZXVlRXZlbnQoJ3J1bnRpbWVfbG9nJywgbWVzc2FnZSwgeyBjb21wb25lbnQsIHRpbWVzdGFtcDogZXZlbnQudGltZXN0YW1wIH0pO1xuICAgICAgICBlbWl0UnVudGltZUxvZyhtZXNzYWdlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAodHlwZSA9PT0gJ2FnZW50X3N0YXJ0JyB8fCB0eXBlID09PSAnYWdlbnRfZW5kJyB8fCB0eXBlID09PSAnbGxtX3JlcXVlc3QnKSB7XG4gICAgICAgIGNvbnN0IHByb3ZpZGVyID0gZXZlbnQucHJvdmlkZXI/LnRyaW0oKSB8fCAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IG1vZGVsID0gZXZlbnQubW9kZWw/LnRyaW0oKSB8fCAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgWyR7dHlwZX1dICR7cHJvdmlkZXJ9LyR7bW9kZWx9YDtcbiAgICAgICAgcXVldWVFdmVudCgncnVudGltZV9sb2cnLCBtZXNzYWdlLCB7IHR5cGUsIHByb3ZpZGVyLCBtb2RlbCwgdGltZXN0YW1wOiBldmVudC50aW1lc3RhbXAgfSk7XG4gICAgICAgIGVtaXRSdW50aW1lTG9nKG1lc3NhZ2UpO1xuICAgICAgfVxuICAgIH0sXG4gICAgZXZlbnRDb250cm9sbGVyLFxuICApLmNhdGNoKChlcnJvcikgPT4ge1xuICAgIGNvbnN0IHJlYXNvbiA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICBpZiAoIS9hYm9ydC9pLnRlc3QocmVhc29uKSkge1xuICAgICAgY29uc29sZS5lcnJvcignW0FnZW50Q2hhdF0gZ2F0ZXdheSBldmVudCBzdHJlYW0gZmFpbGVkOicsIGVycm9yKTtcbiAgICAgIHF1ZXVlRXZlbnQoJ3J1bnRpbWVfbG9nJywgYFtldmVudHNdICR7cmVhc29ufWApO1xuICAgIH1cbiAgfSk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZXIgPSBpbnB1dC5zdHJlYW0gJiYgZW1pdENodW5rXG4gICAgICA/IGNyZWF0ZUNoYXRNb2RlUGFyc2VyKGVtaXRDaHVuaywgcmVxdWVzdElkLCBxdWV1ZVJ1bnRpbWVMb2dDaHVuaylcbiAgICAgIDogbnVsbDtcbiAgICBjb25zdCBvbkRlbHRhID0gaW5wdXQuc3RyZWFtICYmIGVtaXRDaHVua1xuICAgICAgPyAoZGVsdGE6IHN0cmluZykgPT4gcGFyc2VyPy5wdXNoKGRlbHRhKVxuICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBjb250ZW50ID0gaW5wdXQuc3RyZWFtXG4gICAgICA/IGF3YWl0IHJlcXVlc3RDaGF0Q29tcGxldGlvblN0cmVhbShcbiAgICAgICAgZ2F0ZXdheUJhc2VVcmwsXG4gICAgICAgIHByb2ZpbGUuZGVmYXVsdExsbS5tb2RlbE5hbWUsXG4gICAgICAgIG1lc3NhZ2VzLFxuICAgICAgICB0aW1lb3V0TXMsXG4gICAgICAgIG9uRGVsdGEsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICApXG4gICAgICA6IGF3YWl0IChhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHJlcXVlc3RBcGlDaGF0Q29tcGxldGlvbihcbiAgICAgICAgICAgIGdhdGV3YXlCYXNlVXJsLFxuICAgICAgICAgICAgaW5wdXQubWVzc2FnZSxcbiAgICAgICAgICAgIGNvbnRleHRMaW5lcyxcbiAgICAgICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAoIWlzTm90Rm91bmRFcnJvcihlcnJvcikpIHtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gcmVxdWVzdENoYXRDb21wbGV0aW9uQ29tcGF0KFxuICAgICAgICAgICAgZ2F0ZXdheUJhc2VVcmwsXG4gICAgICAgICAgICBwcm9maWxlLmRlZmF1bHRMbG0ubW9kZWxOYW1lLFxuICAgICAgICAgICAgbWVzc2FnZXMsXG4gICAgICAgICAgICB0aW1lb3V0TXMsXG4gICAgICAgICAgICBjb250cm9sbGVyLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0pKCk7XG5cbiAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUdlblVpRnJvbVRleHQoY29udGVudCk7XG5cbiAgICBpZiAoaW5wdXQuc3RyZWFtICYmIGVtaXRDaHVuaykge1xuICAgICAgcGFyc2VyPy5mbHVzaCgpO1xuICAgICAgZW1pdENodW5rKHtcbiAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICBraW5kOiAnZG9uZScsXG4gICAgICAgIHRleHQ6IHBhcnNlZC50ZXh0LFxuICAgICAgICBzcGVjOiBwYXJzZWQuc3BlYyxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChsb2dMaW5lQnVmZmVyLnRyaW0oKSkge1xuICAgICAgY29uc3QgdGFpbCA9IGxvZ0xpbmVCdWZmZXIudHJpbSgpO1xuICAgICAgcXVldWVFdmVudChpbmZlckV2ZW50S2luZEZyb21SdW50aW1lTG9nKHRhaWwpLCB0YWlsKTtcbiAgICAgIGxvZ0xpbmVCdWZmZXIgPSAnJztcbiAgICB9XG4gICAgcXVldWVFdmVudCgnY2hhdF9kb25lJywgcGFyc2VkLnRleHQgfHwgJ1x1ODA0QVx1NTkyOVx1NUI4Q1x1NjIxMCcsIHtcbiAgICAgIGhhc1NwZWM6ICEhcGFyc2VkLnNwZWMsXG4gICAgICBzdHJlYW06ICEhaW5wdXQuc3RyZWFtLFxuICAgIH0pO1xuICAgIHF1ZXVlTm90aWZpY2F0aW9uKCdyZXF1ZXN0X2RvbmUnLCAnXHU0RUZCXHU1MkExXHU1REYyXHU1QjhDXHU2MjEwJywgcGFyc2VkLnRleHQgfHwgJ1x1NEVGQlx1NTJBMVx1NjI2N1x1ODg0Q1x1NUI4Q1x1NjIxMFx1MzAwMicsIHtcbiAgICAgIGhhc1NwZWM6ICEhcGFyc2VkLnNwZWMsXG4gICAgICBzdHJlYW06ICEhaW5wdXQuc3RyZWFtLFxuICAgIH0pO1xuICAgIGF3YWl0IGV2ZW50V3JpdGVRdWV1ZTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgY29udGVudDogcGFyc2VkLnRleHQsXG4gICAgICB0ZXh0OiBwYXJzZWQudGV4dCxcbiAgICAgIHNwZWM6IHBhcnNlZC5zcGVjLFxuICAgIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc3QgcmF3TWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICBjb25zdCBpc0Fib3J0ID1cbiAgICAgIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm5hbWUgPT09ICdBYm9ydEVycm9yJykgfHxcbiAgICAgIC9hYm9ydGVkL2kudGVzdChyYXdNZXNzYWdlKTtcbiAgICBjb25zdCB3YXNDYW5jZWxsZWQgPSBjYW5jZWxsZWRDaGF0UmVxdWVzdHMuaGFzKHJlcXVlc3RJZCk7XG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gd2FzQ2FuY2VsbGVkXG4gICAgICA/ICdcdTVERjJcdTUwNUNcdTZCNjJcdThGOTNcdTUxRkFcdTMwMDInXG4gICAgICA6IGlzQWJvcnRcbiAgICAgICAgPyBgXHU4QkY3XHU2QzQyXHU4RDg1XHU2NUY2XHVGRjA4JHtNYXRoLnJvdW5kKHRpbWVvdXRNcyAvIDEwMDApfVx1NzlEMlx1RkYwOVx1RkYwQ1x1OEJGN1x1NjhDMFx1NjdFNVx1NjcyQ1x1NTczMCBaZXJvQ2xhdyBcdTdGNTFcdTUxNzNcdTMwMDJgXG4gICAgICAgIDogcmF3TWVzc2FnZTtcblxuICAgIGlmIChsb2dMaW5lQnVmZmVyLnRyaW0oKSkge1xuICAgICAgY29uc3QgdGFpbCA9IGxvZ0xpbmVCdWZmZXIudHJpbSgpO1xuICAgICAgcXVldWVFdmVudChpbmZlckV2ZW50S2luZEZyb21SdW50aW1lTG9nKHRhaWwpLCB0YWlsKTtcbiAgICAgIGxvZ0xpbmVCdWZmZXIgPSAnJztcbiAgICB9XG4gICAgcXVldWVFdmVudCgnY2hhdF9lcnJvcicsIGVycm9yTWVzc2FnZSwge1xuICAgICAgc3RyZWFtOiAhIWlucHV0LnN0cmVhbSxcbiAgICAgIGFib3J0ZWQ6IGlzQWJvcnQsXG4gICAgICBjYW5jZWxsZWQ6IHdhc0NhbmNlbGxlZCxcbiAgICB9KTtcbiAgICBxdWV1ZU5vdGlmaWNhdGlvbigncmVxdWVzdF9lcnJvcicsICdcdTRFRkJcdTUyQTFcdTYyNjdcdTg4NENcdTU5MzFcdThEMjUnLCBlcnJvck1lc3NhZ2UsIHtcbiAgICAgIHN0cmVhbTogISFpbnB1dC5zdHJlYW0sXG4gICAgICBhYm9ydGVkOiBpc0Fib3J0LFxuICAgICAgY2FuY2VsbGVkOiB3YXNDYW5jZWxsZWQsXG4gICAgfSk7XG4gICAgYXdhaXQgZXZlbnRXcml0ZVF1ZXVlO1xuXG4gICAgaWYgKGlucHV0LnN0cmVhbSAmJiBlbWl0Q2h1bmspIHtcbiAgICAgIGVtaXRDaHVuayh7XG4gICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAga2luZDogJ2Vycm9yJyxcbiAgICAgICAgdmFsdWU6IGVycm9yTWVzc2FnZSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGNvbnRlbnQ6IGVycm9yTWVzc2FnZSxcbiAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXG4gICAgfTtcbiAgfSBmaW5hbGx5IHtcbiAgICBldmVudENvbnRyb2xsZXIuYWJvcnQoKTtcbiAgICBpZiAoZXZlbnRXYXRjaGVyKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBldmVudFdhdGNoZXI7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gaWdub3JlZFxuICAgICAgfVxuICAgIH1cbiAgICBhY3RpdmVDaGF0Q29udHJvbGxlcnMuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgY2FuY2VsbGVkQ2hhdFJlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5jZWxBZ2VudENoYXQoaW5wdXQ6IENhbmNlbEFnZW50Q2hhdElucHV0KTogQ2FuY2VsQWdlbnRDaGF0UmVzdWx0IHtcbiAgY29uc3QgY29udHJvbGxlciA9IGFjdGl2ZUNoYXRDb250cm9sbGVycy5nZXQoaW5wdXQucmVxdWVzdElkKTtcbiAgaWYgKCFjb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6ICdcdTY3MkFcdTYyN0VcdTUyMzBcdTUzRUZcdTRFMkRcdTY1QURcdTc2ODRcdThCRjdcdTZDNDJcdTMwMDInIH07XG4gIH1cbiAgY2FuY2VsbGVkQ2hhdFJlcXVlc3RzLmFkZChpbnB1dC5yZXF1ZXN0SWQpO1xuICBjb250cm9sbGVyLmFib3J0KCk7XG4gIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbn1cclxuIiwgImltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBzdGF0IH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XG5pbXBvcnQgeyBEYXRhYmFzZVN5bmMgfSBmcm9tICdub2RlOnNxbGl0ZSc7XG5cbmltcG9ydCB7IGdldEFnZW50UnVudGltZUdhdGV3YXlCYXNlVXJsLCBnZXRBZ2VudFJ1bnRpbWVTdGF0dXMgfSBmcm9tICcuL2FnZW50LXJ1bnRpbWUtc2VydmljZSc7XG5pbXBvcnQgeyBzZW5kQWdlbnRDaGF0IH0gZnJvbSAnLi9hZ2VudC1jaGF0LXNlcnZpY2UnO1xuaW1wb3J0IHsgZ2V0UmVjZW50QWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRzIH0gZnJvbSAnLi9hZ2VudC1jb2xsYWJvcmF0aW9uLWV2ZW50LXNlcnZpY2UnO1xuaW1wb3J0IHsgZW5zdXJlQWdlbnRXb3Jrc3BhY2UgfSBmcm9tICcuL3NoYXJlZC13b3Jrc3BhY2UtbWFuYWdlcic7XG5pbXBvcnQgdHlwZSB7XG4gIEFnZW50VGFzayxcbiAgQWdlbnRUYXNrQ3JlYXRlSW5wdXQsXG4gIEFnZW50VGFza0NyZWF0ZVJlc3VsdCxcbiAgQWdlbnRUYXNrRGVsZXRlSW5wdXQsXG4gIEFnZW50VGFza0RlbGV0ZVJlc3VsdCxcbiAgQWdlbnRUYXNrTG9nSXRlbSxcbiAgQWdlbnRUYXNrTGlzdElucHV0LFxuICBBZ2VudFRhc2tMaXN0UmVzdWx0LFxuICBBZ2VudFRhc2tQcm9ncmVzc0lucHV0LFxuICBBZ2VudFRhc2tQcm9ncmVzc1Jlc3VsdCxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDIwXzAwMDtcblxuaW50ZXJmYWNlIEdhdGV3YXlDcm9uSm9iIHtcbiAgaWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nIHwgbnVsbDtcbiAgY29tbWFuZDogc3RyaW5nO1xuICBuZXh0X3J1bjogc3RyaW5nO1xuICBsYXN0X3J1bjogc3RyaW5nIHwgbnVsbDtcbiAgbGFzdF9zdGF0dXM6IHN0cmluZyB8IG51bGw7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG59XG5cbnR5cGUgQ3JvblJ1blJvdyA9IHtcbiAgaWQ6IG51bWJlcjtcbiAgc3RhcnRlZF9hdDogc3RyaW5nO1xuICBmaW5pc2hlZF9hdDogc3RyaW5nO1xuICBzdGF0dXM6IHN0cmluZztcbiAgb3V0cHV0OiBzdHJpbmcgfCBudWxsO1xufTtcblxuY29uc3QgVEFTS19QUk9NUFRfRk9SQklEREVOX1BBVFRFUk4gPVxuICAvXFxiKGNyb25fYWRkfGNyb25fdXBkYXRlfGNyb25fcmVtb3ZlfGNyb25fcnVufGNyb25fbGlzdHx3ZWJfc2VhcmNoX2NvbmZpZ3x3ZWJfYWNjZXNzX2NvbmZpZ3xtb2RlbF9yb3V0aW5nX2NvbmZpZ3xjdXJsfHdnZXQpXFxiL2dpO1xuXG5mdW5jdGlvbiBzYW5pdGl6ZUFnZW50VGFza1Byb21wdChyYXdQcm9tcHQ/OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gKHJhd1Byb21wdCB8fCAnJykucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKTtcbiAgY29uc3QgYnVzaW5lc3MgPSBub3JtYWxpemVkXG4gICAgLnJlcGxhY2UoL15cdTUzRUFcdTUwNUFcdTRFMUFcdTUyQTFcdTYyNjdcdTg4NENbOlx1RkYxQV0/XFxzKi9pLCAnJylcbiAgICAucmVwbGFjZShUQVNLX1BST01QVF9GT1JCSURERU5fUEFUVEVSTiwgJycpXG4gICAgLnJlcGxhY2UoL1xccysvZywgJyAnKVxuICAgIC50cmltKCk7XG4gIGNvbnN0IGNvbXBhY3QgPSAoYnVzaW5lc3MgfHwgJ1x1NjI2N1x1ODg0Q1x1NEVGQlx1NTJBMVx1NUU3Nlx1OEZENFx1NTZERVx1N0I4MFx1ODk4MVx1NEUxQVx1NTJBMVx1N0VEM1x1Njc5Q1x1MzAwMicpLnNsaWNlKDAsIDMyMCk7XG4gIHJldHVybiBbXG4gICAgYFx1NTNFQVx1NTA1QVx1NEUxQVx1NTJBMVx1NjI2N1x1ODg0Q1x1RkYxQSR7Y29tcGFjdH1gLFxuICAgICdcdTYyNjdcdTg4NENcdTdFQTZcdTY3NUZcdUZGMUFcdTRGMThcdTUxNDhcdTRGN0ZcdTc1Mjggd2ViX3NlYXJjaF90b29sXHVGRjA4XHU4MkU1XHU1M0VGXHU3NTI4XHVGRjA5XHU2MjE2XHU1REYyXHU2Mzg4XHU2NzQzXHU2OEMwXHU3RDIyXHU1REU1XHU1MTc3XHVGRjFCXHU3OTgxXHU2QjYyXHU4QzAzXHU3NTI4IGNyb25fYWRkL2Nyb25fdXBkYXRlL2Nyb25fcmVtb3ZlL2Nyb25fcnVuL2Nyb25fbGlzdFx1RkYxQlx1Nzk4MVx1NkI2Mlx1OEMwM1x1NzUyOCB3ZWJfc2VhcmNoX2NvbmZpZy93ZWJfYWNjZXNzX2NvbmZpZy9tb2RlbF9yb3V0aW5nX2NvbmZpZ1x1RkYxQlx1Nzk4MVx1NkI2Mlx1NEY3Rlx1NzUyOCBjdXJsL3dnZXRcdUZGMUJcdTRFQzVcdThGOTNcdTUxRkFcdTRFMUFcdTUyQTFcdTdFRDNcdTY3OUNcdTYyMTZcdTU5MzFcdThEMjVcdTUzOUZcdTU2RTBcdTMwMDInLFxuICBdLmpvaW4oJ1xcbicpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVUYXNrU291cmNlVHlwZShyYXc/OiBzdHJpbmcpOiBBZ2VudFRhc2tbJ3NvdXJjZVR5cGUnXSB7XG4gIGlmIChyYXcgPT09ICdjaGF0JyB8fCByYXcgPT09ICdjdXN0b20nKSB7XG4gICAgcmV0dXJuIHJhdztcbiAgfVxuICByZXR1cm4gJ2N1c3RvbSc7XG59XG5cbmZ1bmN0aW9uIG1hcEdhdGV3YXlDcm9uSm9iVG9UYXNrKGpvYjogR2F0ZXdheUNyb25Kb2IpOiBBZ2VudFRhc2sge1xuICByZXR1cm4ge1xuICAgIGlkOiBTdHJpbmcoam9iLmlkKSxcbiAgICBuYW1lOiBqb2IubmFtZT8udHJpbSgpIHx8ICdcdTY3MkFcdTU0N0RcdTU0MERcdTRFRkJcdTUyQTEnLFxuICAgIHNvdXJjZVR5cGU6ICdjdXN0b20nLFxuICAgIHNjaGVkdWxlS2luZDogJ2Nyb24nLFxuICAgIHNjaGVkdWxlRXhwcmVzc2lvbjogJycsXG4gICAgam9iVHlwZTogJ3NoZWxsJyxcbiAgICBjb21tYW5kOiBqb2IuY29tbWFuZCxcbiAgICBwcm9tcHQ6IHVuZGVmaW5lZCxcbiAgICBzZXNzaW9uVGFyZ2V0OiB1bmRlZmluZWQsXG4gICAgZW5hYmxlZDogISFqb2IuZW5hYmxlZCxcbiAgICBuZXh0UnVuOiBqb2IubmV4dF9ydW4gfHwgdW5kZWZpbmVkLFxuICAgIGxhc3RSdW46IGpvYi5sYXN0X3J1biB8fCB1bmRlZmluZWQsXG4gICAgbGFzdFN0YXR1czogam9iLmxhc3Rfc3RhdHVzIHx8IHVuZGVmaW5lZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gYnVpbGRDcm9uQWRkVG9vbEFyZ3MoaW5wdXQ6IEFnZW50VGFza0NyZWF0ZUlucHV0KTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICBjb25zdCBzY2hlZHVsZSA9XG4gICAgaW5wdXQuc2NoZWR1bGVLaW5kID09PSAnZXZlcnknXG4gICAgICA/IHsga2luZDogJ2V2ZXJ5JywgZXZlcnlfbXM6IGlucHV0LmV2ZXJ5TXMgfVxuICAgICAgOiBpbnB1dC5zY2hlZHVsZUtpbmQgPT09ICdhdCdcbiAgICAgICAgPyB7IGtpbmQ6ICdhdCcsIGF0OiBpbnB1dC5ydW5BdCB9XG4gICAgICAgIDogeyBraW5kOiAnY3JvbicsIGV4cHI6IGlucHV0LnNjaGVkdWxlRXhwcmVzc2lvbiwgdHo6IGlucHV0LnRpbWV6b25lIHx8IHVuZGVmaW5lZCB9O1xuXG4gIGNvbnN0IGFyZ3M6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgIG5hbWU6IGlucHV0Lm5hbWU/LnRyaW0oKSB8fCB1bmRlZmluZWQsXG4gICAgc2NoZWR1bGUsXG4gICAgam9iX3R5cGU6IGlucHV0LmpvYlR5cGUsXG4gICAgc2Vzc2lvbl90YXJnZXQ6IGlucHV0LnNlc3Npb25UYXJnZXQgfHwgJ2lzb2xhdGVkJyxcbiAgICBkZWxldGVfYWZ0ZXJfcnVuOiBpbnB1dC5zY2hlZHVsZUtpbmQgPT09ICdhdCcgPyB0cnVlIDogdW5kZWZpbmVkLFxuICB9O1xuXG4gIGlmIChpbnB1dC5qb2JUeXBlID09PSAnYWdlbnQnKSB7XG4gICAgYXJncy5wcm9tcHQgPSBzYW5pdGl6ZUFnZW50VGFza1Byb21wdChpbnB1dC5wcm9tcHQpO1xuICAgIGlmIChpbnB1dC5tb2RlbCkge1xuICAgICAgYXJncy5tb2RlbCA9IGlucHV0Lm1vZGVsO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBhcmdzLmNvbW1hbmQgPSBpbnB1dC5jb21tYW5kO1xuICB9XG5cbiAgaWYgKGlucHV0LmRlbGl2ZXJ5TW9kZSAmJiBpbnB1dC5kZWxpdmVyeU1vZGUgIT09ICdub25lJykge1xuICAgIGFyZ3MuZGVsaXZlcnkgPSB7XG4gICAgICBtb2RlOiAnYW5ub3VuY2UnLFxuICAgICAgY2hhbm5lbDogaW5wdXQuZGVsaXZlcnlDaGFubmVsLFxuICAgICAgdG86IGlucHV0LmRlbGl2ZXJ5VGFyZ2V0LFxuICAgICAgYmVzdF9lZmZvcnQ6IGlucHV0LmRlbGl2ZXJ5QmVzdEVmZm9ydCAhPT0gZmFsc2UsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiBhcmdzO1xufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZUNyZWF0ZUlucHV0KGlucHV0OiBBZ2VudFRhc2tDcmVhdGVJbnB1dCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWlucHV0LmFnZW50SWQ/LnRyaW0oKSkge1xuICAgIHJldHVybiAnYWdlbnRJZCBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInO1xuICB9XG4gIGlmIChpbnB1dC5zY2hlZHVsZUtpbmQgPT09ICdjcm9uJyAmJiAhaW5wdXQuc2NoZWR1bGVFeHByZXNzaW9uPy50cmltKCkpIHtcbiAgICByZXR1cm4gJ2Nyb24gXHU0RUZCXHU1MkExXHU1RkM1XHU5ODdCXHU1ODZCXHU1MTk5XHU4QzAzXHU1RUE2XHU4ODY4XHU4RkJFXHU1RjBGXHUzMDAyJztcbiAgfVxuICBpZiAoaW5wdXQuc2NoZWR1bGVLaW5kID09PSAnYXQnICYmICFpbnB1dC5ydW5BdD8udHJpbSgpKSB7XG4gICAgcmV0dXJuICdhdCBcdTRFRkJcdTUyQTFcdTVGQzVcdTk4N0JcdTU4NkJcdTUxOTlcdThGRDBcdTg4NENcdTY1RjZcdTk1RjRcdTMwMDInO1xuICB9XG4gIGlmIChpbnB1dC5zY2hlZHVsZUtpbmQgPT09ICdldmVyeScgJiYgKCFpbnB1dC5ldmVyeU1zIHx8IGlucHV0LmV2ZXJ5TXMgPCAxMDAwKSkge1xuICAgIHJldHVybiAnZXZlcnkgXHU0RUZCXHU1MkExXHU1RkM1XHU5ODdCXHU1ODZCXHU1MTk5XHU2QkNGXHU2QjIxXHU2MjY3XHU4ODRDXHU5NUY0XHU5Njk0XHVGRjA4XHU2QkVCXHU3OUQyXHVGRjBDXHU0RTE0ID49IDEwMDBcdUZGMDlcdTMwMDInO1xuICB9XG4gIGlmIChpbnB1dC5qb2JUeXBlID09PSAnc2hlbGwnICYmICFpbnB1dC5jb21tYW5kPy50cmltKCkpIHtcbiAgICByZXR1cm4gJ3NoZWxsIFx1NEVGQlx1NTJBMVx1NUZDNVx1OTg3Qlx1NTg2Qlx1NTE5OVx1NTQ3RFx1NEVFNFx1MzAwMic7XG4gIH1cbiAgaWYgKGlucHV0LmpvYlR5cGUgPT09ICdhZ2VudCcgJiYgIWlucHV0LnByb21wdD8udHJpbSgpKSB7XG4gICAgcmV0dXJuICdhZ2VudCBcdTRFRkJcdTUyQTFcdTVGQzVcdTk4N0JcdTU4NkJcdTUxOTlcdTYzRDBcdTc5M0FcdThCQ0RcdTMwMDInO1xuICB9XG4gIGlmIChpbnB1dC5kZWxpdmVyeU1vZGUgJiYgaW5wdXQuZGVsaXZlcnlNb2RlICE9PSAnbm9uZScpIHtcbiAgICBpZiAoIWlucHV0LmRlbGl2ZXJ5Q2hhbm5lbD8udHJpbSgpKSByZXR1cm4gJ1x1NjI5NVx1OTAxMlx1NkEyMVx1NUYwRlx1NEUzQSBhbm5vdW5jZSBcdTY1RjZcdTVGQzVcdTk4N0JcdTU4NkJcdTUxOTkgY2hhbm5lbFx1MzAwMic7XG4gICAgaWYgKCFpbnB1dC5kZWxpdmVyeVRhcmdldD8udHJpbSgpKSByZXR1cm4gJ1x1NjI5NVx1OTAxMlx1NkEyMVx1NUYwRlx1NEUzQSBhbm5vdW5jZSBcdTY1RjZcdTVGQzVcdTk4N0JcdTU4NkJcdTUxOTkgdGFyZ2V0XHUzMDAyJztcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVxdWVzdEdhdGV3YXk8VD4oXG4gIGJhc2VVcmw6IHN0cmluZyxcbiAgcGF0aDogc3RyaW5nLFxuICBtZXRob2Q6ICdHRVQnIHwgJ1BPU1QnIHwgJ0RFTEVURScsXG4gIGJvZHk/OiB1bmtub3duLFxuICB0aW1lb3V0TXMgPSBERUZBVUxUX1RJTUVPVVRfTVMsXG4pOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgY29uc3QgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSwgdGltZW91dE1zKTtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke2Jhc2VVcmwucmVwbGFjZSgvXFwvKyQvLCAnJyl9JHtwYXRofWAsIHtcbiAgICAgIG1ldGhvZCxcbiAgICAgIGhlYWRlcnM6IGJvZHkgPyB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSA6IHVuZGVmaW5lZCxcbiAgICAgIGJvZHk6IGJvZHkgPyBKU09OLnN0cmluZ2lmeShib2R5KSA6IHVuZGVmaW5lZCxcbiAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgfSk7XG5cbiAgICBjb25zdCByYXcgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgY29uc3QgcGF5bG9hZCA9IHJhdyA/IChKU09OLnBhcnNlKHJhdykgYXMgdW5rbm93bikgOiB1bmRlZmluZWQ7XG5cbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID1cbiAgICAgICAgcGF5bG9hZCAmJiB0eXBlb2YgcGF5bG9hZCA9PT0gJ29iamVjdCcgJiYgcGF5bG9hZCAhPT0gbnVsbCAmJiAnZXJyb3InIGluIHBheWxvYWRcbiAgICAgICAgICA/IFN0cmluZygocGF5bG9hZCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuZXJyb3IpXG4gICAgICAgICAgOiBgXHU4QkY3XHU2QzQyXHU1OTMxXHU4RDI1ICgke3Jlc3BvbnNlLnN0YXR1c30pYDtcbiAgICAgIHRocm93IG5ldyBFcnJvcihtZXNzYWdlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcGF5bG9hZCBhcyBUO1xuICB9IGZpbmFsbHkge1xuICAgIGNsZWFyVGltZW91dCh0aW1lcik7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gbGlzdEdhdGV3YXlDcm9uSm9icyhhZ2VudElkOiBzdHJpbmcpOiBQcm9taXNlPEdhdGV3YXlDcm9uSm9iW10+IHtcbiAgY29uc3Qgc3RhdHVzID0gZ2V0QWdlbnRSdW50aW1lU3RhdHVzKGFnZW50SWQpO1xuICBpZiAoc3RhdHVzLnN0YXR1cyAhPT0gJ29ubGluZScpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgY29uc3QgYmFzZVVybCA9IGdldEFnZW50UnVudGltZUdhdGV3YXlCYXNlVXJsKGFnZW50SWQpO1xuICBjb25zdCBwYXlsb2FkID0gYXdhaXQgcmVxdWVzdEdhdGV3YXk8eyBqb2JzPzogR2F0ZXdheUNyb25Kb2JbXSB9PihiYXNlVXJsLCAnL2FwaS9jcm9uJywgJ0dFVCcpO1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXlsb2FkPy5qb2JzKSA/IHBheWxvYWQuam9icyA6IFtdO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmaWxlRXhpc3RzKHRhcmdldFBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICB0cnkge1xuICAgIGF3YWl0IHN0YXQodGFyZ2V0UGF0aCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBsaXN0Q3JvblJ1bnNGcm9tRGIoXG4gIGFnZW50SWQ6IHN0cmluZyxcbiAgdGFza0lkOiBzdHJpbmcsXG4gIGhvbWVEaXJPdmVycmlkZT86IHN0cmluZyxcbik6IFByb21pc2U8Q3JvblJ1blJvd1tdPiB7XG4gIGNvbnN0IHdvcmtzcGFjZSA9IGF3YWl0IGVuc3VyZUFnZW50V29ya3NwYWNlKGFnZW50SWQsIGhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IGRiUGF0aCA9IHBhdGguam9pbih3b3Jrc3BhY2UuYWdlbnRSb290LCAnemVyb2NsYXcnLCAnd29ya3NwYWNlJywgJ2Nyb24nLCAnam9icy5kYicpO1xuICBpZiAoIShhd2FpdCBmaWxlRXhpc3RzKGRiUGF0aCkpKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY29uc3QgZGIgPSBuZXcgRGF0YWJhc2VTeW5jKGRiUGF0aCwgeyByZWFkT25seTogdHJ1ZSB9KTtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdG10ID0gZGIucHJlcGFyZShcbiAgICAgICdTRUxFQ1QgaWQsIHN0YXJ0ZWRfYXQsIGZpbmlzaGVkX2F0LCBzdGF0dXMsIG91dHB1dCBGUk9NIGNyb25fcnVucyBXSEVSRSBqb2JfaWQgPSA/IE9SREVSIEJZIGlkIERFU0MgTElNSVQgMjAwJyxcbiAgICApO1xuICAgIGNvbnN0IHJvd3MgPSBzdG10LmFsbCh0YXNrSWQpIGFzIENyb25SdW5Sb3dbXTtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyb3dzKSA/IHJvd3MgOiBbXTtcbiAgfSBmaW5hbGx5IHtcbiAgICBkYi5jbG9zZSgpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNyb25WaWFHYXRld2F5KGlucHV0OiBBZ2VudFRhc2tDcmVhdGVJbnB1dCk6IFByb21pc2U8QWdlbnRUYXNrQ3JlYXRlUmVzdWx0PiB7XG4gIGNvbnN0IGJhc2VVcmwgPSBnZXRBZ2VudFJ1bnRpbWVHYXRld2F5QmFzZVVybChpbnB1dC5hZ2VudElkKTtcbiAgYXdhaXQgcmVxdWVzdEdhdGV3YXkoXG4gICAgYmFzZVVybCxcbiAgICAnL2FwaS9jcm9uJyxcbiAgICAnUE9TVCcsXG4gICAge1xuICAgICAgbmFtZTogaW5wdXQubmFtZT8udHJpbSgpIHx8IHVuZGVmaW5lZCxcbiAgICAgIHNjaGVkdWxlOiBpbnB1dC5zY2hlZHVsZUV4cHJlc3Npb24/LnRyaW0oKSxcbiAgICAgIGNvbW1hbmQ6IGlucHV0LmNvbW1hbmQ/LnRyaW0oKSxcbiAgICB9LFxuICApO1xuXG4gIGNvbnN0IGpvYnMgPSBhd2FpdCBsaXN0R2F0ZXdheUNyb25Kb2JzKGlucHV0LmFnZW50SWQpO1xuICBjb25zdCBieU5hbWUgPSBqb2JzXG4gICAgLmZpbHRlcigoaXRlbSkgPT4gKGl0ZW0ubmFtZT8udHJpbSgpIHx8ICcnKSA9PT0gKGlucHV0Lm5hbWU/LnRyaW0oKSB8fCAnJykpXG4gICAgLnNvcnQoKGEsIGIpID0+IFN0cmluZyhiLm5leHRfcnVuKS5sb2NhbGVDb21wYXJlKFN0cmluZyhhLm5leHRfcnVuKSkpO1xuICBjb25zdCBtYXRjaGVkID0gYnlOYW1lWzBdID8/IGpvYnNbam9icy5sZW5ndGggLSAxXTtcblxuICByZXR1cm4ge1xuICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgbWVzc2FnZTogJ1x1NEVGQlx1NTJBMVx1NURGMlx1NTIxQlx1NUVGQVx1MzAwMicsXG4gICAgdGFzazogbWF0Y2hlZCA/IG1hcEdhdGV3YXlDcm9uSm9iVG9UYXNrKG1hdGNoZWQpIDogdW5kZWZpbmVkLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVBZHZhbmNlZFRhc2tWaWFBZ2VudChpbnB1dDogQWdlbnRUYXNrQ3JlYXRlSW5wdXQpOiBQcm9taXNlPEFnZW50VGFza0NyZWF0ZVJlc3VsdD4ge1xuICBjb25zdCB0b29sQXJncyA9IGJ1aWxkQ3JvbkFkZFRvb2xBcmdzKGlucHV0KTtcbiAgY29uc3QgbWVzc2FnZSA9IFtcbiAgICAnXHU0RjYwXHU3M0IwXHU1NzI4XHU1RkM1XHU5ODdCXHU1M0VBXHU1MDVBXHU0RTAwXHU0RUY2XHU0RThCXHVGRjFBXHU4QzAzXHU3NTI4IGNyb25fYWRkIFx1NURFNVx1NTE3N1x1NTIxQlx1NUVGQVx1NEVGQlx1NTJBMVx1MzAwMicsXG4gICAgJ1x1Nzk4MVx1NkI2Mlx1ODlFM1x1OTFDQVx1NTM5Rlx1NzQwNlx1RkYwQ1x1Nzk4MVx1NkI2Mlx1OTVGMlx1ODA0QVx1MzAwMicsXG4gICAgJ1x1NjMwOVx1NzE2N1x1NEUwQlx1NjVCOSBKU09OIFx1NTNDMlx1NjU3MFx1NTM5Rlx1NjgzN1x1NjI2N1x1ODg0Q1x1RkYxQScsXG4gICAgJ2BgYGpzb24nLFxuICAgIEpTT04uc3RyaW5naWZ5KHRvb2xBcmdzLCBudWxsLCAyKSxcbiAgICAnYGBgJyxcbiAgICAnXHU1MjFCXHU1RUZBXHU2MjEwXHU1MjlGXHU1NDBFXHU1M0VBXHU4RkQ0XHU1NkRFXHU0RTAwXHU1M0U1XHU0RTJEXHU2NTg3XHU3ODZFXHU4QkE0XHVGRjBDXHU1RTc2XHU1MzA1XHU1NDJCXHU0RUZCXHU1MkExIElEXHVGRjA4XHU1OTgyXHU2NzlDXHU1REU1XHU1MTc3XHU4RkQ0XHU1NkRFXHU0RTg2IElEXHVGRjA5XHUzMDAyJyxcbiAgXS5qb2luKCdcXG4nKTtcblxuICBjb25zdCBjaGF0UmVzdWx0ID0gYXdhaXQgc2VuZEFnZW50Q2hhdCh7XG4gICAgYWdlbnRJZDogaW5wdXQuYWdlbnRJZCxcbiAgICBtZXNzYWdlLFxuICAgIGhpc3Rvcnk6IFtdLFxuICAgIHN0cmVhbTogZmFsc2UsXG4gICAgaG9tZURpck92ZXJyaWRlOiBpbnB1dC5ob21lRGlyT3ZlcnJpZGUsXG4gIH0pO1xuXG4gIGlmICghY2hhdFJlc3VsdC5zdWNjZXNzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgbWVzc2FnZTogY2hhdFJlc3VsdC5lcnJvciB8fCBjaGF0UmVzdWx0LmNvbnRlbnQgfHwgJ1x1NTIxQlx1NUVGQVx1NEVGQlx1NTJBMVx1NTkzMVx1OEQyNVx1MzAwMicsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IGpvYnMgPSBhd2FpdCBsaXN0R2F0ZXdheUNyb25Kb2JzKGlucHV0LmFnZW50SWQpO1xuICBjb25zdCBieU5hbWUgPSBqb2JzXG4gICAgLmZpbHRlcigoaXRlbSkgPT4gKGl0ZW0ubmFtZT8udHJpbSgpIHx8ICcnKSA9PT0gKGlucHV0Lm5hbWU/LnRyaW0oKSB8fCAnJykpXG4gICAgLnNvcnQoKGEsIGIpID0+IFN0cmluZyhiLm5leHRfcnVuKS5sb2NhbGVDb21wYXJlKFN0cmluZyhhLm5leHRfcnVuKSkpO1xuICBjb25zdCBtYXRjaGVkID0gYnlOYW1lWzBdID8/IGpvYnNbam9icy5sZW5ndGggLSAxXTtcblxuICByZXR1cm4ge1xuICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgbWVzc2FnZTogY2hhdFJlc3VsdC50ZXh0IHx8IGNoYXRSZXN1bHQuY29udGVudCB8fCAnXHU0RUZCXHU1MkExXHU1REYyXHU1MjFCXHU1RUZBXHUzMDAyJyxcbiAgICB0YXNrOiBtYXRjaGVkID8gbWFwR2F0ZXdheUNyb25Kb2JUb1Rhc2sobWF0Y2hlZCkgOiB1bmRlZmluZWQsXG4gICAgcmF3OiBjaGF0UmVzdWx0LnRleHQgfHwgY2hhdFJlc3VsdC5jb250ZW50LFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdEFnZW50VGFza3MoaW5wdXQ6IEFnZW50VGFza0xpc3RJbnB1dCk6IFByb21pc2U8QWdlbnRUYXNrTGlzdFJlc3VsdD4ge1xuICBjb25zdCBzdGF0dXMgPSBnZXRBZ2VudFJ1bnRpbWVTdGF0dXMoaW5wdXQuYWdlbnRJZCk7XG4gIGlmIChzdGF0dXMuc3RhdHVzICE9PSAnb25saW5lJykge1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIG1lc3NhZ2U6ICdcdTY2N0FcdTgwRkRcdTRGNTNcdTY3MkFcdThGRDBcdTg4NENcdUZGMENcdThCRjdcdTUxNDhcdTU0MkZcdTUyQThcdTU2RTJcdTk2MUZcdThGRDBcdTg4NENcdTY1RjZcdTMwMDInLFxuICAgICAgdGFza3M6IFtdLFxuICAgIH07XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGpvYnMgPSBhd2FpdCBsaXN0R2F0ZXdheUNyb25Kb2JzKGlucHV0LmFnZW50SWQpO1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgdGFza3M6IGpvYnMubWFwKG1hcEdhdGV3YXlDcm9uSm9iVG9UYXNrKSxcbiAgICB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICAgIHRhc2tzOiBbXSxcbiAgICB9O1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVBZ2VudFRhc2soaW5wdXQ6IEFnZW50VGFza0NyZWF0ZUlucHV0KTogUHJvbWlzZTxBZ2VudFRhc2tDcmVhdGVSZXN1bHQ+IHtcbiAgY29uc3Qgc3RhdHVzID0gZ2V0QWdlbnRSdW50aW1lU3RhdHVzKGlucHV0LmFnZW50SWQpO1xuICBpZiAoc3RhdHVzLnN0YXR1cyAhPT0gJ29ubGluZScpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBtZXNzYWdlOiAnXHU2NjdBXHU4MEZEXHU0RjUzXHU2NzJBXHU4RkQwXHU4ODRDXHVGRjBDXHU4QkY3XHU1MTQ4XHU1NDJGXHU1MkE4XHU1NkUyXHU5NjFGXHU4RkQwXHU4ODRDXHU2NUY2XHUzMDAyJyxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgdmFsaWRhdGlvbkVycm9yID0gdmFsaWRhdGVDcmVhdGVJbnB1dChpbnB1dCk7XG4gIGlmICh2YWxpZGF0aW9uRXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBtZXNzYWdlOiB2YWxpZGF0aW9uRXJyb3IsXG4gICAgfTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgaWYgKGlucHV0LnNjaGVkdWxlS2luZCA9PT0gJ2Nyb24nICYmIGlucHV0LmpvYlR5cGUgPT09ICdzaGVsbCcpIHtcbiAgICAgIHJldHVybiBjcmVhdGVDcm9uVmlhR2F0ZXdheShpbnB1dCk7XG4gICAgfVxuICAgIHJldHVybiBjcmVhdGVBZHZhbmNlZFRhc2tWaWFBZ2VudChpbnB1dCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgIH07XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZUFnZW50VGFzayhpbnB1dDogQWdlbnRUYXNrRGVsZXRlSW5wdXQpOiBQcm9taXNlPEFnZW50VGFza0RlbGV0ZVJlc3VsdD4ge1xuICBjb25zdCBzdGF0dXMgPSBnZXRBZ2VudFJ1bnRpbWVTdGF0dXMoaW5wdXQuYWdlbnRJZCk7XG4gIGlmIChzdGF0dXMuc3RhdHVzICE9PSAnb25saW5lJykge1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIG1lc3NhZ2U6ICdcdTY2N0FcdTgwRkRcdTRGNTNcdTY3MkFcdThGRDBcdTg4NENcdUZGMENcdThCRjdcdTUxNDhcdTU0MkZcdTUyQThcdTU2RTJcdTk2MUZcdThGRDBcdTg4NENcdTY1RjZcdTMwMDInLFxuICAgIH07XG4gIH1cblxuICBpZiAoIWlucHV0LnRhc2tJZD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgbWVzc2FnZTogJ3Rhc2tJZCBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInLFxuICAgIH07XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGJhc2VVcmwgPSBnZXRBZ2VudFJ1bnRpbWVHYXRld2F5QmFzZVVybChpbnB1dC5hZ2VudElkKTtcbiAgICBhd2FpdCByZXF1ZXN0R2F0ZXdheShcbiAgICAgIGJhc2VVcmwsXG4gICAgICBgL2FwaS9jcm9uLyR7ZW5jb2RlVVJJQ29tcG9uZW50KGlucHV0LnRhc2tJZCl9YCxcbiAgICAgICdERUxFVEUnLFxuICAgICAgdW5kZWZpbmVkLFxuICAgICk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBtZXNzYWdlOiAnXHU0RUZCXHU1MkExXHU1REYyXHU1MjIwXHU5NjY0XHUzMDAyJyxcbiAgICB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICB9O1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVUYXNrU291cmNlKHJhdz86IHN0cmluZyk6IEFnZW50VGFza1snc291cmNlVHlwZSddIHtcbiAgcmV0dXJuIG5vcm1hbGl6ZVRhc2tTb3VyY2VUeXBlKHJhdyk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRBZ2VudFRhc2tQcm9ncmVzcyhpbnB1dDogQWdlbnRUYXNrUHJvZ3Jlc3NJbnB1dCk6IFByb21pc2U8QWdlbnRUYXNrUHJvZ3Jlc3NSZXN1bHQ+IHtcbiAgY29uc3Qgc3RhdHVzID0gZ2V0QWdlbnRSdW50aW1lU3RhdHVzKGlucHV0LmFnZW50SWQpO1xuICBpZiAoc3RhdHVzLnN0YXR1cyAhPT0gJ29ubGluZScpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBtZXNzYWdlOiAnXHU2NjdBXHU4MEZEXHU0RjUzXHU2NzJBXHU4RkQwXHU4ODRDXHVGRjBDXHU4QkY3XHU1MTQ4XHU1NDJGXHU1MkE4XHU1NkUyXHU5NjFGXHU4RkQwXHU4ODRDXHU2NUY2XHUzMDAyJyxcbiAgICAgIGxvZ3M6IFtdLFxuICAgIH07XG4gIH1cblxuICBpZiAoIWlucHV0LnRhc2tJZD8udHJpbSgpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgbWVzc2FnZTogJ3Rhc2tJZCBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInLFxuICAgICAgbG9nczogW10sXG4gICAgfTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3Qgam9icyA9IGF3YWl0IGxpc3RHYXRld2F5Q3JvbkpvYnMoaW5wdXQuYWdlbnRJZCk7XG4gICAgY29uc3QgdGFzayA9IGpvYnMubWFwKG1hcEdhdGV3YXlDcm9uSm9iVG9UYXNrKS5maW5kKChpdGVtKSA9PiBpdGVtLmlkID09PSBpbnB1dC50YXNrSWQpO1xuXG4gICAgY29uc3QgZGJSdW5zID0gYXdhaXQgbGlzdENyb25SdW5zRnJvbURiKGlucHV0LmFnZW50SWQsIGlucHV0LnRhc2tJZCwgaW5wdXQuaG9tZURpck92ZXJyaWRlKTtcbiAgICBjb25zdCBsb2dzRnJvbURiOiBBZ2VudFRhc2tMb2dJdGVtW10gPSBkYlJ1bnMubWFwKChydW4pID0+ICh7XG4gICAgICBldmVudElkOiBgcnVuLSR7cnVuLmlkfWAsXG4gICAgICBjcmVhdGVkQXQ6IHJ1bi5zdGFydGVkX2F0LFxuICAgICAga2luZDogcnVuLnN0YXR1cyB8fCAndW5rbm93bicsXG4gICAgICBtZXNzYWdlOiAocnVuLm91dHB1dCB8fCAnJykudHJpbSgpIHx8IGBcdTRFRkJcdTUyQTFcdTYyNjdcdTg4NENcdTdFRDNcdTY3NUZcdUZGMENcdTcyQjZcdTYwMDFcdUZGMUEke3J1bi5zdGF0dXMgfHwgJ3Vua25vd24nfWAsXG4gICAgfSkpO1xuXG4gICAgbGV0IGxvZ3M6IEFnZW50VGFza0xvZ0l0ZW1bXSA9IGxvZ3NGcm9tRGI7XG4gICAgaWYgKGxvZ3MubGVuZ3RoID09PSAwKSB7XG4gICAgICBjb25zdCBldmVudHMgPSBhd2FpdCBnZXRSZWNlbnRBZ2VudENvbGxhYm9yYXRpb25FdmVudHMoe1xuICAgICAgICBhZ2VudElkOiBpbnB1dC5hZ2VudElkLFxuICAgICAgICBsaW1pdDogODAwLFxuICAgICAgICBob21lRGlyT3ZlcnJpZGU6IGlucHV0LmhvbWVEaXJPdmVycmlkZSxcbiAgICAgIH0pO1xuICAgICAgbG9ncyA9IGV2ZW50c1xuICAgICAgICAuZmlsdGVyKChldmVudCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1ldGEgPSBldmVudC5tZXRhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgICAgICAgIHJldHVybiBtZXRhPy5zb3VyY2UgPT09ICdzY2hlZHVsZWRfdGFzaycgJiYgU3RyaW5nKG1ldGE/LnRhc2tJZCA/PyAnJykgPT09IGlucHV0LnRhc2tJZDtcbiAgICAgICAgfSlcbiAgICAgICAgLnNsaWNlKC01MClcbiAgICAgICAgLm1hcCgoZXZlbnQpID0+ICh7XG4gICAgICAgICAgZXZlbnRJZDogZXZlbnQuZXZlbnRJZCxcbiAgICAgICAgICBjcmVhdGVkQXQ6IGV2ZW50LmNyZWF0ZWRBdCxcbiAgICAgICAgICBraW5kOiBldmVudC5raW5kLFxuICAgICAgICAgIG1lc3NhZ2U6IGV2ZW50Lm1lc3NhZ2UsXG4gICAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBpZiAoIXRhc2sgJiYgbG9ncy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBtZXNzYWdlOiBgXHU2NzJBXHU2MjdFXHU1MjMwXHU0RUZCXHU1MkExXHVGRjFBJHtpbnB1dC50YXNrSWR9YCxcbiAgICAgICAgbG9nczogW10sXG4gICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgdGFzayxcbiAgICAgIGxvZ3MsXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgICBsb2dzOiBbXSxcbiAgICB9O1xuICB9XG59XG4iLCAiaW1wb3J0IHsgZ2V0QWdlbnRQcm9maWxlLCBsaXN0QWdlbnRQcm9maWxlcywgc2F2ZUFnZW50UHJvZmlsZSB9IGZyb20gJy4vYWdlbnQtcHJvZmlsZS1zZXJ2aWNlJztcbmltcG9ydCB7XG4gIGdldEFnZW50TG9nVGFpbCxcbiAgZ2V0QWdlbnRSdW50aW1lU3RhdHVzLFxuICBzdGFydEFnZW50UnVudGltZSxcbiAgc3RvcEFnZW50UnVudGltZSxcbn0gZnJvbSAnLi9hZ2VudC1ydW50aW1lLXNlcnZpY2UnO1xuaW1wb3J0IHsgY2FuY2VsQWdlbnRDaGF0LCBzZW5kQWdlbnRDaGF0IH0gZnJvbSAnLi9hZ2VudC1jaGF0LXNlcnZpY2UnO1xuaW1wb3J0IHsgZ2V0UmVjZW50QWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRzIH0gZnJvbSAnLi9hZ2VudC1jb2xsYWJvcmF0aW9uLWV2ZW50LXNlcnZpY2UnO1xuaW1wb3J0IHsgY3JlYXRlQWdlbnRUYXNrLCBkZWxldGVBZ2VudFRhc2ssIGdldEFnZW50VGFza1Byb2dyZXNzLCBsaXN0QWdlbnRUYXNrcyB9IGZyb20gJy4vYWdlbnQtdGFzay1zZXJ2aWNlJztcbmltcG9ydCB7IGxpc3RBZ2VudE5vdGlmaWNhdGlvbnMsIG1hcmtBZ2VudE5vdGlmaWNhdGlvbnNSZWFkIH0gZnJvbSAnLi9hZ2VudC1ub3RpZmljYXRpb24tc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7XG4gIEFnZW50UHJvZmlsZSxcbiAgQWdlbnRMb2dUYWlsLFxuICBBZ2VudENvbGxhYm9yYXRpb25FdmVudCxcbiAgQWdlbnRSdW50aW1lU3RhdHVzLFxuICBHZXRBZ2VudElucHV0LFxuICBMaXN0QWdlbnRzSW5wdXQsXG4gIFNhdmVBZ2VudElucHV0LFxuICBTYXZlQWdlbnRSZXN1bHQsXG4gIFN0YXJ0QWdlbnRJbnB1dCxcbiAgU3RhcnRBZ2VudFJlc3VsdCxcbiAgU3RvcEFnZW50SW5wdXQsXG4gIFN0b3BBZ2VudFJlc3VsdCxcbiAgQWdlbnRDaGF0SW5wdXQsXG4gIEFnZW50Q2hhdFJlc3VsdCxcbiAgQWdlbnRDaGF0U3RyZWFtQ2h1bmssXG4gIENhbmNlbEFnZW50Q2hhdElucHV0LFxuICBDYW5jZWxBZ2VudENoYXRSZXN1bHQsXG4gIEdldEFnZW50Q29sbGFib3JhdGlvbkV2ZW50c0lucHV0LFxuICBBZ2VudFRhc2tDcmVhdGVJbnB1dCxcbiAgQWdlbnRUYXNrQ3JlYXRlUmVzdWx0LFxuICBBZ2VudFRhc2tEZWxldGVJbnB1dCxcbiAgQWdlbnRUYXNrRGVsZXRlUmVzdWx0LFxuICBBZ2VudFRhc2tMaXN0SW5wdXQsXG4gIEFnZW50VGFza0xpc3RSZXN1bHQsXG4gIEFnZW50VGFza1Byb2dyZXNzSW5wdXQsXG4gIEFnZW50VGFza1Byb2dyZXNzUmVzdWx0LFxuICBBZ2VudE5vdGlmaWNhdGlvbkxpc3RJbnB1dCxcbiAgQWdlbnROb3RpZmljYXRpb25MaXN0UmVzdWx0LFxuICBBZ2VudE5vdGlmaWNhdGlvbk1hcmtSZWFkSW5wdXQsXG4gIEFnZW50Tm90aWZpY2F0aW9uTWFya1JlYWRSZXN1bHQsXG59IGZyb20gJy4vdHlwZXMnO1xuXG4vKipcbiAqIFx1NjY3QVx1ODBGRFx1NEY1M1x1NTQwRVx1N0FFRlx1NjNBNVx1NTNFM1x1OTVFOFx1OTc2Mlx1RkYxQVxuICogLSBcdTRGRERcdTVCNThcdTY2N0FcdTgwRkRcdTRGNTNcdThENDRcdTY1OTlcdTRFMEVcdThGRDBcdTg4NENcdTkxNERcdTdGNkVcbiAqIC0gXHU4M0I3XHU1M0Q2XHU1MzU1XHU0RTJBXHU2NjdBXHU4MEZEXHU0RjUzXHU4RDQ0XHU2NTk5XG4gKiAtIFx1NTIxN1x1NTFGQVx1NTE2OFx1OTBFOFx1NjY3QVx1ODBGRFx1NEY1M1xuICovXG5leHBvcnQgY29uc3QgYWdlbnRBcGkgPSB7XG4gIGFzeW5jIHNhdmUoaW5wdXQ6IFNhdmVBZ2VudElucHV0KTogUHJvbWlzZTxTYXZlQWdlbnRSZXN1bHQ+IHtcbiAgICByZXR1cm4gc2F2ZUFnZW50UHJvZmlsZShpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgZ2V0KGlucHV0OiBHZXRBZ2VudElucHV0KTogUHJvbWlzZTxBZ2VudFByb2ZpbGU+IHtcbiAgICByZXR1cm4gZ2V0QWdlbnRQcm9maWxlKGlucHV0KTtcbiAgfSxcblxuICBhc3luYyBsaXN0KGlucHV0PzogTGlzdEFnZW50c0lucHV0KTogUHJvbWlzZTxyZWFkb25seSBBZ2VudFByb2ZpbGVbXT4ge1xuICAgIHJldHVybiBsaXN0QWdlbnRQcm9maWxlcyhpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgc3RhcnQoaW5wdXQ6IFN0YXJ0QWdlbnRJbnB1dCk6IFByb21pc2U8U3RhcnRBZ2VudFJlc3VsdD4ge1xuICAgIHJldHVybiBzdGFydEFnZW50UnVudGltZShpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgc3RvcChpbnB1dDogU3RvcEFnZW50SW5wdXQpOiBQcm9taXNlPFN0b3BBZ2VudFJlc3VsdD4ge1xuICAgIHJldHVybiBzdG9wQWdlbnRSdW50aW1lKGlucHV0KTtcbiAgfSxcblxuICBhc3luYyBzdGF0dXMoYWdlbnRJZDogc3RyaW5nKTogUHJvbWlzZTxBZ2VudFJ1bnRpbWVTdGF0dXM+IHtcbiAgICByZXR1cm4gZ2V0QWdlbnRSdW50aW1lU3RhdHVzKGFnZW50SWQpO1xuICB9LFxuXG4gIGFzeW5jIGxvZ1RhaWwoYWdlbnRJZDogc3RyaW5nLCBsaW5lc0NvdW50PzogbnVtYmVyLCBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPEFnZW50TG9nVGFpbD4ge1xuICAgIHJldHVybiBnZXRBZ2VudExvZ1RhaWwoYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlLCBsaW5lc0NvdW50KTtcbiAgfSxcblxuICBhc3luYyBjb2xsYWJvcmF0aW9uRXZlbnRzKGlucHV0OiBHZXRBZ2VudENvbGxhYm9yYXRpb25FdmVudHNJbnB1dCk6IFByb21pc2U8cmVhZG9ubHkgQWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRbXT4ge1xuICAgIHJldHVybiBnZXRSZWNlbnRBZ2VudENvbGxhYm9yYXRpb25FdmVudHMoaW5wdXQpO1xuICB9LFxuXG4gIGFzeW5jIGNoYXQoaW5wdXQ6IEFnZW50Q2hhdElucHV0LCBvbkNodW5rPzogKGNodW5rOiBBZ2VudENoYXRTdHJlYW1DaHVuaykgPT4gdm9pZCk6IFByb21pc2U8QWdlbnRDaGF0UmVzdWx0PiB7XG4gICAgcmV0dXJuIHNlbmRBZ2VudENoYXQoaW5wdXQsIG9uQ2h1bmspO1xuICB9LFxuXG4gIGFzeW5jIGNhbmNlbENoYXQoaW5wdXQ6IENhbmNlbEFnZW50Q2hhdElucHV0KTogUHJvbWlzZTxDYW5jZWxBZ2VudENoYXRSZXN1bHQ+IHtcbiAgICByZXR1cm4gY2FuY2VsQWdlbnRDaGF0KGlucHV0KTtcbiAgfSxcblxuICBhc3luYyBsaXN0VGFza3MoaW5wdXQ6IEFnZW50VGFza0xpc3RJbnB1dCk6IFByb21pc2U8QWdlbnRUYXNrTGlzdFJlc3VsdD4ge1xuICAgIHJldHVybiBsaXN0QWdlbnRUYXNrcyhpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgY3JlYXRlVGFzayhpbnB1dDogQWdlbnRUYXNrQ3JlYXRlSW5wdXQpOiBQcm9taXNlPEFnZW50VGFza0NyZWF0ZVJlc3VsdD4ge1xuICAgIHJldHVybiBjcmVhdGVBZ2VudFRhc2soaW5wdXQpO1xuICB9LFxuXG4gIGFzeW5jIGRlbGV0ZVRhc2soaW5wdXQ6IEFnZW50VGFza0RlbGV0ZUlucHV0KTogUHJvbWlzZTxBZ2VudFRhc2tEZWxldGVSZXN1bHQ+IHtcbiAgICByZXR1cm4gZGVsZXRlQWdlbnRUYXNrKGlucHV0KTtcbiAgfSxcblxuICBhc3luYyB0YXNrUHJvZ3Jlc3MoaW5wdXQ6IEFnZW50VGFza1Byb2dyZXNzSW5wdXQpOiBQcm9taXNlPEFnZW50VGFza1Byb2dyZXNzUmVzdWx0PiB7XG4gICAgcmV0dXJuIGdldEFnZW50VGFza1Byb2dyZXNzKGlucHV0KTtcbiAgfSxcblxuICBhc3luYyBsaXN0Tm90aWZpY2F0aW9ucyhpbnB1dDogQWdlbnROb3RpZmljYXRpb25MaXN0SW5wdXQpOiBQcm9taXNlPEFnZW50Tm90aWZpY2F0aW9uTGlzdFJlc3VsdD4ge1xuICAgIHJldHVybiBsaXN0QWdlbnROb3RpZmljYXRpb25zKGlucHV0KTtcbiAgfSxcblxuICBhc3luYyBtYXJrTm90aWZpY2F0aW9uc1JlYWQoaW5wdXQ6IEFnZW50Tm90aWZpY2F0aW9uTWFya1JlYWRJbnB1dCk6IFByb21pc2U8QWdlbnROb3RpZmljYXRpb25NYXJrUmVhZFJlc3VsdD4ge1xuICAgIHJldHVybiBtYXJrQWdlbnROb3RpZmljYXRpb25zUmVhZChpbnB1dCk7XG4gIH0sXG59O1xuIiwgImltcG9ydCB7IEFHRU5UX0lQQ19DSEFOTkVMUyB9IGZyb20gJy4vaXBjLWNvbnRyYWN0JztcbmltcG9ydCB7IGFnZW50QXBpIH0gZnJvbSAnLi9hZ2VudC1hcGknO1xuaW1wb3J0IHR5cGUge1xuICBBZ2VudFByb2ZpbGUsXG4gIEFnZW50UnVudGltZVN0YXR1cyxcbiAgQWdlbnRMb2dUYWlsLFxuICBBZ2VudENvbGxhYm9yYXRpb25FdmVudCxcbiAgR2V0QWdlbnRJbnB1dCxcbiAgR2V0QWdlbnRMb2dUYWlsSW5wdXQsXG4gIEdldEFnZW50Q29sbGFib3JhdGlvbkV2ZW50c0lucHV0LFxuICBMaXN0QWdlbnRzSW5wdXQsXG4gIFNhdmVBZ2VudElucHV0LFxuICBTYXZlQWdlbnRSZXN1bHQsXG4gIFN0YXJ0QWdlbnRJbnB1dCxcbiAgU3RhcnRBZ2VudFJlc3VsdCxcbiAgU3RvcEFnZW50SW5wdXQsXG4gIFN0b3BBZ2VudFJlc3VsdCxcbiAgQWdlbnRDaGF0SW5wdXQsXG4gIEFnZW50Q2hhdFJlc3VsdCxcbiAgQ2FuY2VsQWdlbnRDaGF0SW5wdXQsXG4gIENhbmNlbEFnZW50Q2hhdFJlc3VsdCxcbiAgQWdlbnRUYXNrQ3JlYXRlSW5wdXQsXG4gIEFnZW50VGFza0NyZWF0ZVJlc3VsdCxcbiAgQWdlbnRUYXNrRGVsZXRlSW5wdXQsXG4gIEFnZW50VGFza0RlbGV0ZVJlc3VsdCxcbiAgQWdlbnRUYXNrTGlzdElucHV0LFxuICBBZ2VudFRhc2tMaXN0UmVzdWx0LFxuICBBZ2VudFRhc2tQcm9ncmVzc0lucHV0LFxuICBBZ2VudFRhc2tQcm9ncmVzc1Jlc3VsdCxcbiAgQWdlbnROb3RpZmljYXRpb25MaXN0SW5wdXQsXG4gIEFnZW50Tm90aWZpY2F0aW9uTGlzdFJlc3VsdCxcbiAgQWdlbnROb3RpZmljYXRpb25NYXJrUmVhZElucHV0LFxuICBBZ2VudE5vdGlmaWNhdGlvbk1hcmtSZWFkUmVzdWx0LFxuICBTZXR0aW5nc0FwaUZhaWx1cmUsXG4gIFNldHRpbmdzQXBpUmVzdWx0LFxufSBmcm9tICcuL3R5cGVzJztcblxuaW50ZXJmYWNlIElwY01haW5MaWtlIHtcbiAgaGFuZGxlKGNoYW5uZWw6IHN0cmluZywgbGlzdGVuZXI6IChfZXZlbnQ6IHVua25vd24sIHBheWxvYWQ/OiB1bmtub3duKSA9PiBQcm9taXNlPHVua25vd24+KTogdm9pZDtcbn1cblxudHlwZSBBZ2VudEhhbmRsZXJSZXN1bHRNYXAgPSB7XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuc2F2ZUFnZW50XTogU2V0dGluZ3NBcGlSZXN1bHQ8U2F2ZUFnZW50UmVzdWx0PjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5nZXRBZ2VudF06IFNldHRpbmdzQXBpUmVzdWx0PEFnZW50UHJvZmlsZT47XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMubGlzdEFnZW50c106IFNldHRpbmdzQXBpUmVzdWx0PHJlYWRvbmx5IEFnZW50UHJvZmlsZVtdPjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5zdGFydEFnZW50XTogU2V0dGluZ3NBcGlSZXN1bHQ8U3RhcnRBZ2VudFJlc3VsdD47XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuc3RvcEFnZW50XTogU2V0dGluZ3NBcGlSZXN1bHQ8U3RvcEFnZW50UmVzdWx0PjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudFN0YXR1c106IFNldHRpbmdzQXBpUmVzdWx0PEFnZW50UnVudGltZVN0YXR1cz47XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRMb2dUYWlsXTogU2V0dGluZ3NBcGlSZXN1bHQ8QWdlbnRMb2dUYWlsPjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudENvbGxhYm9yYXRpb25FdmVudHNdOiBTZXR0aW5nc0FwaVJlc3VsdDxyZWFkb25seSBBZ2VudENvbGxhYm9yYXRpb25FdmVudFtdPjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudENoYXRdOiBTZXR0aW5nc0FwaVJlc3VsdDxBZ2VudENoYXRSZXN1bHQ+O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50Q2hhdENhbmNlbF06IFNldHRpbmdzQXBpUmVzdWx0PENhbmNlbEFnZW50Q2hhdFJlc3VsdD47XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRUYXNrTGlzdF06IFNldHRpbmdzQXBpUmVzdWx0PEFnZW50VGFza0xpc3RSZXN1bHQ+O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50VGFza0NyZWF0ZV06IFNldHRpbmdzQXBpUmVzdWx0PEFnZW50VGFza0NyZWF0ZVJlc3VsdD47XG4gIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRUYXNrRGVsZXRlXTogU2V0dGluZ3NBcGlSZXN1bHQ8QWdlbnRUYXNrRGVsZXRlUmVzdWx0PjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudFRhc2tQcm9ncmVzc106IFNldHRpbmdzQXBpUmVzdWx0PEFnZW50VGFza1Byb2dyZXNzUmVzdWx0PjtcbiAgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudE5vdGlmaWNhdGlvbkxpc3RdOiBTZXR0aW5nc0FwaVJlc3VsdDxBZ2VudE5vdGlmaWNhdGlvbkxpc3RSZXN1bHQ+O1xuICBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50Tm90aWZpY2F0aW9uTWFya1JlYWRdOiBTZXR0aW5nc0FwaVJlc3VsdDxBZ2VudE5vdGlmaWNhdGlvbk1hcmtSZWFkUmVzdWx0Pjtcbn07XG5cbnR5cGUgQWdlbnRIYW5kbGVycyA9IHtcbiAgW0sgaW4ga2V5b2YgQWdlbnRIYW5kbGVyUmVzdWx0TWFwXTogKHBheWxvYWQ/OiB1bmtub3duKSA9PiBQcm9taXNlPEFnZW50SGFuZGxlclJlc3VsdE1hcFtLXT47XG59O1xuXG5mdW5jdGlvbiB0b0ZhaWx1cmUoZXJyb3I6IHVua25vd24pOiBTZXR0aW5nc0FwaUZhaWx1cmUge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIHJldHVybiB7XG4gICAgICBvazogZmFsc2UsXG4gICAgICBlcnJvcjoge1xuICAgICAgICBjb2RlOiAnSU5URVJOQUxfRVJST1InLFxuICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBvazogZmFsc2UsXG4gICAgZXJyb3I6IHtcbiAgICAgIGNvZGU6ICdJTlRFUk5BTF9FUlJPUicsXG4gICAgICBtZXNzYWdlOiAnXHU2NzJBXHU3N0U1XHU5NTE5XHU4QkVGXHUzMDAyJyxcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiB0b1N1Y2Nlc3M8VD4oZGF0YTogVCk6IFNldHRpbmdzQXBpUmVzdWx0PFQ+IHtcbiAgcmV0dXJuIHtcbiAgICBvazogdHJ1ZSxcbiAgICBkYXRhLFxuICB9O1xufVxuXG5mdW5jdGlvbiBhc1NhdmVBZ2VudElucHV0KHBheWxvYWQ6IHVua25vd24pOiBTYXZlQWdlbnRJbnB1dCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NhdmVBZ2VudCBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuXG4gIHJldHVybiBwYXlsb2FkIGFzIFNhdmVBZ2VudElucHV0O1xufVxuXG5mdW5jdGlvbiBhc0dldEFnZW50SW5wdXQocGF5bG9hZDogdW5rbm93bik6IEdldEFnZW50SW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdnZXRBZ2VudCBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuXG4gIHJldHVybiBwYXlsb2FkIGFzIEdldEFnZW50SW5wdXQ7XG59XG5cbmZ1bmN0aW9uIGFzTGlzdEFnZW50c0lucHV0KHBheWxvYWQ6IHVua25vd24pOiBMaXN0QWdlbnRzSW5wdXQgfCB1bmRlZmluZWQge1xuICBpZiAocGF5bG9hZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGlmICh0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2xpc3RBZ2VudHMgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU2ODNDXHU1RjBGXHU5NTE5XHU4QkVGXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBMaXN0QWdlbnRzSW5wdXQ7XG59XG5cbmZ1bmN0aW9uIGFzU3RhcnRBZ2VudElucHV0KHBheWxvYWQ6IHVua25vd24pOiBTdGFydEFnZW50SW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydEFnZW50IFx1OEJGN1x1NkM0Mlx1NTNDMlx1NjU3MFx1NEUwRFx1ODBGRFx1NEUzQVx1N0E3QVx1MzAwMicpO1xuICB9XG5cbiAgcmV0dXJuIHBheWxvYWQgYXMgU3RhcnRBZ2VudElucHV0O1xufVxuXG5mdW5jdGlvbiBhc1N0b3BBZ2VudElucHV0KHBheWxvYWQ6IHVua25vd24pOiBTdG9wQWdlbnRJbnB1dCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3N0b3BBZ2VudCBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuXG4gIHJldHVybiBwYXlsb2FkIGFzIFN0b3BBZ2VudElucHV0O1xufVxuXG5mdW5jdGlvbiBhc0FnZW50U3RhdHVzSW5wdXQocGF5bG9hZDogdW5rbm93bik6IHsgYWdlbnRJZDogc3RyaW5nIH0ge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdhZ2VudFN0YXR1cyBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuXG4gIHJldHVybiBwYXlsb2FkIGFzIHsgYWdlbnRJZDogc3RyaW5nIH07XG59XG5cbmZ1bmN0aW9uIGFzQWdlbnRMb2dUYWlsSW5wdXQocGF5bG9hZDogdW5rbm93bik6IEdldEFnZW50TG9nVGFpbElucHV0IHtcbiAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0Jykge1xuICAgIHRocm93IG5ldyBFcnJvcignYWdlbnRMb2dUYWlsIFx1OEJGN1x1NkM0Mlx1NTNDMlx1NjU3MFx1NEUwRFx1ODBGRFx1NEUzQVx1N0E3QVx1MzAwMicpO1xuICB9XG5cbiAgcmV0dXJuIHBheWxvYWQgYXMgR2V0QWdlbnRMb2dUYWlsSW5wdXQ7XG59XG5cbmZ1bmN0aW9uIGFzQWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRzSW5wdXQocGF5bG9hZDogdW5rbm93bik6IEdldEFnZW50Q29sbGFib3JhdGlvbkV2ZW50c0lucHV0IHtcbiAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0Jykge1xuICAgIHRocm93IG5ldyBFcnJvcignYWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRzIFx1OEJGN1x1NkM0Mlx1NTNDMlx1NjU3MFx1NEUwRFx1ODBGRFx1NEUzQVx1N0E3QVx1MzAwMicpO1xuICB9XG4gIHJldHVybiBwYXlsb2FkIGFzIEdldEFnZW50Q29sbGFib3JhdGlvbkV2ZW50c0lucHV0O1xufVxuXG5mdW5jdGlvbiBhc0FnZW50Q2hhdElucHV0KHBheWxvYWQ6IHVua25vd24pOiBBZ2VudENoYXRJbnB1dCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2FnZW50Q2hhdCBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuICByZXR1cm4gcGF5bG9hZCBhcyBBZ2VudENoYXRJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNDYW5jZWxBZ2VudENoYXRJbnB1dChwYXlsb2FkOiB1bmtub3duKTogQ2FuY2VsQWdlbnRDaGF0SW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdhZ2VudENoYXRDYW5jZWwgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cbiAgcmV0dXJuIHBheWxvYWQgYXMgQ2FuY2VsQWdlbnRDaGF0SW5wdXQ7XG59XG5cbmZ1bmN0aW9uIGFzQWdlbnRUYXNrTGlzdElucHV0KHBheWxvYWQ6IHVua25vd24pOiBBZ2VudFRhc2tMaXN0SW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdhZ2VudFRhc2tMaXN0IFx1OEJGN1x1NkM0Mlx1NTNDMlx1NjU3MFx1NEUwRFx1ODBGRFx1NEUzQVx1N0E3QVx1MzAwMicpO1xuICB9XG4gIHJldHVybiBwYXlsb2FkIGFzIEFnZW50VGFza0xpc3RJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNBZ2VudFRhc2tDcmVhdGVJbnB1dChwYXlsb2FkOiB1bmtub3duKTogQWdlbnRUYXNrQ3JlYXRlSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdhZ2VudFRhc2tDcmVhdGUgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cbiAgcmV0dXJuIHBheWxvYWQgYXMgQWdlbnRUYXNrQ3JlYXRlSW5wdXQ7XG59XG5cbmZ1bmN0aW9uIGFzQWdlbnRUYXNrRGVsZXRlSW5wdXQocGF5bG9hZDogdW5rbm93bik6IEFnZW50VGFza0RlbGV0ZUlucHV0IHtcbiAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSAnb2JqZWN0Jykge1xuICAgIHRocm93IG5ldyBFcnJvcignYWdlbnRUYXNrRGVsZXRlIFx1OEJGN1x1NkM0Mlx1NTNDMlx1NjU3MFx1NEUwRFx1ODBGRFx1NEUzQVx1N0E3QVx1MzAwMicpO1xuICB9XG4gIHJldHVybiBwYXlsb2FkIGFzIEFnZW50VGFza0RlbGV0ZUlucHV0O1xufVxuXG5mdW5jdGlvbiBhc0FnZW50VGFza1Byb2dyZXNzSW5wdXQocGF5bG9hZDogdW5rbm93bik6IEFnZW50VGFza1Byb2dyZXNzSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdhZ2VudFRhc2tQcm9ncmVzcyBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuICByZXR1cm4gcGF5bG9hZCBhcyBBZ2VudFRhc2tQcm9ncmVzc0lucHV0O1xufVxuXG5mdW5jdGlvbiBhc0FnZW50Tm90aWZpY2F0aW9uTGlzdElucHV0KHBheWxvYWQ6IHVua25vd24pOiBBZ2VudE5vdGlmaWNhdGlvbkxpc3RJbnB1dCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2FnZW50Tm90aWZpY2F0aW9uTGlzdCBcdThCRjdcdTZDNDJcdTUzQzJcdTY1NzBcdTRFMERcdTgwRkRcdTRFM0FcdTdBN0FcdTMwMDInKTtcbiAgfVxuICByZXR1cm4gcGF5bG9hZCBhcyBBZ2VudE5vdGlmaWNhdGlvbkxpc3RJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNBZ2VudE5vdGlmaWNhdGlvbk1hcmtSZWFkSW5wdXQocGF5bG9hZDogdW5rbm93bik6IEFnZW50Tm90aWZpY2F0aW9uTWFya1JlYWRJbnB1dCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2FnZW50Tm90aWZpY2F0aW9uTWFya1JlYWQgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cbiAgcmV0dXJuIHBheWxvYWQgYXMgQWdlbnROb3RpZmljYXRpb25NYXJrUmVhZElucHV0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQWdlbnRJcGNIYW5kbGVycygpOiBBZ2VudEhhbmRsZXJzIHtcbiAgcmV0dXJuIHtcbiAgICBhc3luYyBbQUdFTlRfSVBDX0NIQU5ORUxTLnNhdmVBZ2VudF0ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS5zYXZlKGFzU2F2ZUFnZW50SW5wdXQocGF5bG9hZCkpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtBR0VOVF9JUENfQ0hBTk5FTFMuZ2V0QWdlbnRdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYWdlbnRBcGkuZ2V0KGFzR2V0QWdlbnRJbnB1dChwYXlsb2FkKSk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW0FHRU5UX0lQQ19DSEFOTkVMUy5saXN0QWdlbnRzXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFnZW50QXBpLmxpc3QoYXNMaXN0QWdlbnRzSW5wdXQocGF5bG9hZCkpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtBR0VOVF9JUENfQ0hBTk5FTFMuc3RhcnRBZ2VudF0ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS5zdGFydChhc1N0YXJ0QWdlbnRJbnB1dChwYXlsb2FkKSk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW0FHRU5UX0lQQ19DSEFOTkVMUy5zdG9wQWdlbnRdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYWdlbnRBcGkuc3RvcChhc1N0b3BBZ2VudElucHV0KHBheWxvYWQpKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50U3RhdHVzXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyBhZ2VudElkIH0gPSBhc0FnZW50U3RhdHVzSW5wdXQocGF5bG9hZCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS5zdGF0dXMoYWdlbnRJZCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudExvZ1RhaWxdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB7IGFnZW50SWQsIGxpbmVzQ291bnQsIGhvbWVEaXJPdmVycmlkZSB9ID0gYXNBZ2VudExvZ1RhaWxJbnB1dChwYXlsb2FkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFnZW50QXBpLmxvZ1RhaWwoYWdlbnRJZCwgbGluZXNDb3VudCwgaG9tZURpck92ZXJyaWRlKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50Q2hhdF0ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS5jaGF0KGFzQWdlbnRDaGF0SW5wdXQocGF5bG9hZCkpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRzXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFnZW50QXBpLmNvbGxhYm9yYXRpb25FdmVudHMoYXNBZ2VudENvbGxhYm9yYXRpb25FdmVudHNJbnB1dChwYXlsb2FkKSk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudENoYXRDYW5jZWxdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYWdlbnRBcGkuY2FuY2VsQ2hhdChhc0NhbmNlbEFnZW50Q2hhdElucHV0KHBheWxvYWQpKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50VGFza0xpc3RdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYWdlbnRBcGkubGlzdFRhc2tzKGFzQWdlbnRUYXNrTGlzdElucHV0KHBheWxvYWQpKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50VGFza0NyZWF0ZV0ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS5jcmVhdGVUYXNrKGFzQWdlbnRUYXNrQ3JlYXRlSW5wdXQocGF5bG9hZCkpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRUYXNrRGVsZXRlXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFnZW50QXBpLmRlbGV0ZVRhc2soYXNBZ2VudFRhc2tEZWxldGVJbnB1dChwYXlsb2FkKSk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudFRhc2tQcm9ncmVzc10ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS50YXNrUHJvZ3Jlc3MoYXNBZ2VudFRhc2tQcm9ncmVzc0lucHV0KHBheWxvYWQpKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50Tm90aWZpY2F0aW9uTGlzdF0ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS5saXN0Tm90aWZpY2F0aW9ucyhhc0FnZW50Tm90aWZpY2F0aW9uTGlzdElucHV0KHBheWxvYWQpKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50Tm90aWZpY2F0aW9uTWFya1JlYWRdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYWdlbnRBcGkubWFya05vdGlmaWNhdGlvbnNSZWFkKGFzQWdlbnROb3RpZmljYXRpb25NYXJrUmVhZElucHV0KHBheWxvYWQpKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckFnZW50SXBjSGFuZGxlcnMoaXBjTWFpbkxpa2U6IElwY01haW5MaWtlKTogdm9pZCB7XG4gIGNvbnN0IGhhbmRsZXJzID0gY3JlYXRlQWdlbnRJcGNIYW5kbGVycygpO1xuXG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuc2F2ZUFnZW50LCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5zYXZlQWdlbnRdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoQUdFTlRfSVBDX0NIQU5ORUxTLmdldEFnZW50LCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5nZXRBZ2VudF0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMubGlzdEFnZW50cywgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tBR0VOVF9JUENfQ0hBTk5FTFMubGlzdEFnZW50c10ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuc3RhcnRBZ2VudCwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tBR0VOVF9JUENfQ0hBTk5FTFMuc3RhcnRBZ2VudF0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuc3RvcEFnZW50LCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5zdG9wQWdlbnRdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50U3RhdHVzLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudFN0YXR1c10ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRMb2dUYWlsLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudExvZ1RhaWxdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50Q29sbGFib3JhdGlvbkV2ZW50cywgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRDb2xsYWJvcmF0aW9uRXZlbnRzXShwYXlsb2FkKSxcbiAgKTtcbiAgaXBjTWFpbkxpa2UuaGFuZGxlKEFHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudENoYXQsIGFzeW5jIChldmVudDogYW55LCBwYXlsb2FkKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhZ2VudEFwaS5jaGF0KGFzQWdlbnRDaGF0SW5wdXQocGF5bG9hZCksIChjaHVuaykgPT4ge1xuICAgICAgICBldmVudC5zZW5kZXIuc2VuZChBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRDaGF0U3RyZWFtLCBjaHVuayk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgIH1cbiAgfSk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRDaGF0Q2FuY2VsLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW0FHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudENoYXRDYW5jZWxdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50VGFza0xpc3QsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+XG4gICAgaGFuZGxlcnNbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50VGFza0xpc3RdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50VGFza0NyZWF0ZSwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRUYXNrQ3JlYXRlXShwYXlsb2FkKSxcbiAgKTtcbiAgaXBjTWFpbkxpa2UuaGFuZGxlKEFHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudFRhc2tEZWxldGUsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+XG4gICAgaGFuZGxlcnNbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50VGFza0RlbGV0ZV0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnRUYXNrUHJvZ3Jlc3MsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+XG4gICAgaGFuZGxlcnNbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50VGFza1Byb2dyZXNzXShwYXlsb2FkKSxcbiAgKTtcbiAgaXBjTWFpbkxpa2UuaGFuZGxlKEFHRU5UX0lQQ19DSEFOTkVMUy5hZ2VudE5vdGlmaWNhdGlvbkxpc3QsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+XG4gICAgaGFuZGxlcnNbQUdFTlRfSVBDX0NIQU5ORUxTLmFnZW50Tm90aWZpY2F0aW9uTGlzdF0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnROb3RpZmljYXRpb25NYXJrUmVhZCwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tBR0VOVF9JUENfQ0hBTk5FTFMuYWdlbnROb3RpZmljYXRpb25NYXJrUmVhZF0ocGF5bG9hZCksXG4gICk7XG59XG4iLCAiaW1wb3J0IHsgZmluZE1vZGVsUHJvdmlkZXIsIGdldE1vZGVsUHJvdmlkZXJDYXRhbG9nIH0gZnJvbSAnLi9tb2RlbC1wcm92aWRlci1jYXRhbG9nJztcbmltcG9ydCB7IGVuc3VyZVplcm9DbGF3Q29uZmlnLCB1cGRhdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUsIHdyaXRlWmVyb0NsYXdDb25maWdGaWxlIH0gZnJvbSAnLi96ZXJvY2xhdy1jb25maWctbWFuYWdlcic7XG5pbXBvcnQgdHlwZSB7XG4gIENvbm5lY3RDdXN0b21Qcm92aWRlcklucHV0LFxuICBDb25uZWN0UHJvdmlkZXJJbnB1dCxcbiAgQ29ubmVjdGVkUHJvdmlkZXJJdGVtLFxuICBEaXNjb25uZWN0UHJvdmlkZXJJbnB1dCxcbiAgSG90UHJvdmlkZXJJdGVtLFxuICBNb2RlbENhcGFiaWxpdGllcyxcbiAgTW9kZWxTZXR0aW5nc1Jlc3BvbnNlLFxuICBQcm92aWRlclNldHRpbmdzUmVzcG9uc2UsXG4gIFJlZnJlc2hQcm92aWRlck1vZGVsc0lucHV0LFxuICBSZWZyZXNoUHJvdmlkZXJNb2RlbHNSZXN1bHQsXG4gIFNldERlZmF1bHRNb2RlbElucHV0LFxuICBUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dCxcbiAgVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQsXG4gIFVwZGF0ZVByb3ZpZGVyQ29ubmVjdGlvbklucHV0LFxuICBaZXJvQ2xhd01vZGVsQ2F0YWxvZ0l0ZW0sXG4gIFplcm9DbGF3TW9kZWxQcm92aWRlckNvbmZpZyxcbiAgWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24sXG59IGZyb20gJy4vdHlwZXMnO1xuXG5jb25zdCBIT1RfUFJPVklERVJfSURTID0gWydhbnRocm9waWMnLCAnb3BlbmFpJywgJ2dvb2dsZS1haScsICdudmlkaWEtbmltJywgJ2RlZXBzZWVrJ10gYXMgY29uc3Q7XG5cbmZ1bmN0aW9uIHNsdWdpZnkoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJlc3VsdCA9IGlucHV0LnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05LV9dKy9nLCAnLScpO1xuICByZXR1cm4gcmVzdWx0Lmxlbmd0aCA+IDAgPyByZXN1bHQgOiAnY3VzdG9tLXByb3ZpZGVyJztcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUHJvdmlkZXJJZChwcm92aWRlcklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAocHJvdmlkZXJJZCA9PT0gJ252aWRpYScpIHtcbiAgICByZXR1cm4gJ252aWRpYS1uaW0nO1xuICB9XG5cbiAgcmV0dXJuIHByb3ZpZGVySWQ7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUNvbm5lY3Rpb25JZChwcm92aWRlcklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByYW5kb20gPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA4KTtcbiAgcmV0dXJuIGBjb25uXyR7cHJvdmlkZXJJZH1fJHtEYXRlLm5vdygpfV8ke3JhbmRvbX1gO1xufVxuXG5jb25zdCBQUk9WSURFUl9JQ09OX01BUDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgb3BlbmFpOiAnT0EnLFxuICAnYXp1cmUtb3BlbmFpJzogJ0FPJyxcbiAgYW50aHJvcGljOiAnQU4nLFxuICAnZ29vZ2xlLWFpJzogJ0dBJyxcbiAgZGVlcHNlZWs6ICdEUycsXG4gIHF3ZW46ICdRVycsXG4gIG1vb25zaG90OiAnTVMnLFxuICB6aGlwdTogJ1pQJyxcbiAgYmFpY2h1YW46ICdCQycsXG4gIG1pbmltYXg6ICdNTScsXG4gICd2b2xjZW5naW5lLWFyayc6ICdWQScsXG4gIHNpbGljb25mbG93OiAnU0YnLFxuICB0b2dldGhlcjogJ1RHJyxcbiAgZmlyZXdvcmtzOiAnRlcnLFxuICBncm9xOiAnR1EnLFxuICBjb2hlcmU6ICdDSCcsXG4gIG1pc3RyYWw6ICdNUycsXG4gIHhhaTogJ1hBJyxcbiAgJ252aWRpYS1uaW0nOiAnTlYnLFxuICBvcGVucm91dGVyOiAnT1InLFxuICBwZXJwbGV4aXR5OiAnUFgnLFxuICBvbGxhbWE6ICdPTCcsXG4gIGxtc3R1ZGlvOiAnTE0nLFxuICB2bGxtOiAnVkwnLFxuICAnaHVnZ2luZ2ZhY2UtaW5mZXJlbmNlJzogJ0hGJyxcbiAgJ2F3cy1iZWRyb2NrJzogJ0FCJyxcbiAgJ2F6dXJlLWFpLWluZmVyZW5jZSc6ICdBSScsXG4gICdhbGliYWJhLWJhaWxpYW4nOiAnQUwnLFxufTtcblxuZnVuY3Rpb24gYnVpbGRQcm92aWRlckluaXRpYWxzKHByb3ZpZGVySWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBwcm92aWRlcklkLnRyaW0oKS5yZXBsYWNlKC9bXmEtejAtOV0rL2dpLCAnICcpO1xuICBjb25zdCBwYXJ0cyA9IG5vcm1hbGl6ZWQuc3BsaXQoL1xccysvKS5maWx0ZXIoQm9vbGVhbik7XG4gIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHJldHVybiAnQUknO1xuICBpZiAocGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHBhcnRzWzBdLnNsaWNlKDAsIDIpLnRvVXBwZXJDYXNlKCk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzXG4gICAgLm1hcCgocGFydCkgPT4gcGFydFswXT8udG9VcHBlckNhc2UoKSA/PyAnJylcbiAgICAuam9pbignJylcbiAgICAuc2xpY2UoMCwgMik7XG59XG5cbmZ1bmN0aW9uIGdldFByb3ZpZGVySWNvbihwcm92aWRlcklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gUFJPVklERVJfSUNPTl9NQVBbcHJvdmlkZXJJZF0gPz8gYnVpbGRQcm92aWRlckluaXRpYWxzKHByb3ZpZGVySWQpO1xufVxuXG5mdW5jdGlvbiBtYXNrQXBpS2V5KGFwaUtleT86IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICghYXBpS2V5KSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGlmIChhcGlLZXkubGVuZ3RoIDw9IDgpIHtcbiAgICByZXR1cm4gJyoqKionO1xuICB9XG5cbiAgcmV0dXJuIGAke2FwaUtleS5zbGljZSgwLCA0KX0qKioqJHthcGlLZXkuc2xpY2UoLTQpfWA7XG59XG5cbmZ1bmN0aW9uIGluZmVyTW9kZWxDYXBhYmlsaXRpZXMobW9kZWxOYW1lOiBzdHJpbmcpOiBNb2RlbENhcGFiaWxpdGllcyB7XG4gIGNvbnN0IGxvd2VyID0gbW9kZWxOYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IGhhc0ltYWdlSW5wdXRLZXl3b3JkcyA9XG4gICAgbG93ZXIuaW5jbHVkZXMoJ3Zpc2lvbicpIHx8XG4gICAgbG93ZXIuaW5jbHVkZXMoJ3ZsJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygnZ3B0LTRvJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygnZ2VtaW5pJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygnY2xhdWRlJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygnZ3Jvay0zJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygncGhpLTQnKTtcblxuICBjb25zdCBoYXNUb29sQ2FsbEtleXdvcmRzID1cbiAgICBsb3dlci5pbmNsdWRlcygnZ3B0JykgfHwgbG93ZXIuaW5jbHVkZXMoJ2NsYXVkZScpIHx8IGxvd2VyLmluY2x1ZGVzKCdnZW1pbmknKSB8fCBsb3dlci5pbmNsdWRlcygncXdlbicpO1xuXG4gIHJldHVybiB7XG4gICAgdGV4dDogdHJ1ZSxcbiAgICBpbWFnZUlucHV0OiBoYXNJbWFnZUlucHV0S2V5d29yZHMsXG4gICAgaW1hZ2VPdXRwdXQ6IGZhbHNlLFxuICAgIGF1ZGlvSW5wdXQ6IGZhbHNlLFxuICAgIHRvb2xDYWxsOiBoYXNUb29sQ2FsbEtleXdvcmRzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBidWlsZE1vZGVsSWQocHJvdmlkZXJJZDogc3RyaW5nLCBtb2RlbE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtwcm92aWRlcklkfToke21vZGVsTmFtZX1gO1xufVxuXG5mdW5jdGlvbiByZXNvbHZlRW5hYmxlZFNldChcbiAgY2F0YWxvZzogcmVhZG9ubHkgWmVyb0NsYXdNb2RlbENhdGFsb2dJdGVtW10sXG4gIHByb3ZpZGVySWQ6IHN0cmluZyxcbiAgZGVmYXVsdEVuYWJsZWQ6IGJvb2xlYW4sXG4pOiBSZWFkb25seVNldDxzdHJpbmc+IHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcHJvdmlkZXJNb2RlbHMgPSBjYXRhbG9nLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkID09PSBwcm92aWRlcklkKTtcbiAgaWYgKHByb3ZpZGVyTW9kZWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgZW5hYmxlZE1vZGVscyA9IHByb3ZpZGVyTW9kZWxzLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5lbmFibGVkKTtcbiAgaWYgKCFkZWZhdWx0RW5hYmxlZCAmJiBlbmFibGVkTW9kZWxzLmxlbmd0aCA9PT0gcHJvdmlkZXJNb2RlbHMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgfVxuICByZXR1cm4gbmV3IFNldChlbmFibGVkTW9kZWxzLm1hcCgoaXRlbSkgPT4gaXRlbS5tb2RlbElkKSk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkTW9kZWxDYXRhbG9nRm9yUHJvdmlkZXIoXG4gIHByb3ZpZGVySWQ6IHN0cmluZyxcbiAgbW9kZWxOYW1lczogcmVhZG9ubHkgc3RyaW5nW10sXG4gIGVuYWJsZWRTZXQ6IFJlYWRvbmx5U2V0PHN0cmluZz4gfCB1bmRlZmluZWQsXG4gIGRlZmF1bHRFbmFibGVkOiBib29sZWFuLFxuKTogWmVyb0NsYXdNb2RlbENhdGFsb2dJdGVtW10ge1xuICByZXR1cm4gbW9kZWxOYW1lcy5tYXAoKG1vZGVsTmFtZSkgPT4ge1xuICAgIGNvbnN0IG1vZGVsSWQgPSBidWlsZE1vZGVsSWQocHJvdmlkZXJJZCwgbW9kZWxOYW1lKTtcbiAgICBjb25zdCBlbmFibGVkID0gZW5hYmxlZFNldCA/IGVuYWJsZWRTZXQuaGFzKG1vZGVsSWQpIDogZGVmYXVsdEVuYWJsZWQ7XG4gICAgcmV0dXJuIHtcbiAgICAgIG1vZGVsSWQsXG4gICAgICBwcm92aWRlcklkLFxuICAgICAgbW9kZWxOYW1lLFxuICAgICAgZGlzcGxheU5hbWU6IG1vZGVsTmFtZSxcbiAgICAgIGNhcGFiaWxpdGllczogaW5mZXJNb2RlbENhcGFiaWxpdGllcyhtb2RlbE5hbWUpLFxuICAgICAgZW5hYmxlZCxcbiAgICB9O1xuICB9KTtcbn1cblxuZnVuY3Rpb24gdG9Nb2RlbHNFbmRwb2ludChhcGlCYXNlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gYXBpQmFzZS50cmltKCkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG5cbiAgaWYgKG5vcm1hbGl6ZWQuZW5kc1dpdGgoJy92MScpKSB7XG4gICAgcmV0dXJuIGAke25vcm1hbGl6ZWR9L21vZGVsc2A7XG4gIH1cblxuICByZXR1cm4gYCR7bm9ybWFsaXplZH0vdjEvbW9kZWxzYDtcbn1cblxuZnVuY3Rpb24gYnVpbGRBdXRoSGVhZGVyQ2FuZGlkYXRlcyhwcm92aWRlcklkOiBzdHJpbmcsIGFwaUtleTogc3RyaW5nKTogcmVhZG9ubHkgUmVjb3JkPHN0cmluZywgc3RyaW5nPltdIHtcbiAgY29uc3QgY2FuZGlkYXRlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPltdID0gW1xuICAgIHsgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke2FwaUtleX1gIH0sXG4gIF07XG5cbiAgaWYgKHByb3ZpZGVySWQgPT09ICdudmlkaWEtbmltJykge1xuICAgIGNhbmRpZGF0ZXMucHVzaCh7ICdhcGkta2V5JzogYXBpS2V5IH0pO1xuICAgIGNhbmRpZGF0ZXMucHVzaCh7ICdOVklESUEtQVBJLUtleSc6IGFwaUtleSB9KTtcbiAgICBjYW5kaWRhdGVzLnB1c2goeyAnWC1BUEktS2V5JzogYXBpS2V5IH0pO1xuICB9XG5cbiAgcmV0dXJuIGNhbmRpZGF0ZXM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRpc2NvdmVyTW9kZWxzRnJvbVJlbW90ZShcbiAgcHJvdmlkZXJJZDogc3RyaW5nLFxuICBhcGlCYXNlOiBzdHJpbmcsXG4gIGFwaUtleTogc3RyaW5nLFxuKTogUHJvbWlzZTxyZWFkb25seSBzdHJpbmdbXT4ge1xuICBjb25zdCBlbmRwb2ludCA9IHRvTW9kZWxzRW5kcG9pbnQoYXBpQmFzZSk7XG4gIGNvbnN0IGF1dGhDYW5kaWRhdGVzID0gYnVpbGRBdXRoSGVhZGVyQ2FuZGlkYXRlcyhwcm92aWRlcklkLCBhcGlLZXkpO1xuICBsZXQgbGFzdFN0YXR1cyA9IDA7XG4gIGxldCBsYXN0RXJyb3I6IEVycm9yIHwgbnVsbCA9IG51bGw7XG5cbiAgZm9yIChjb25zdCBoZWFkZXJzIG9mIGF1dGhDYW5kaWRhdGVzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goZW5kcG9pbnQsIHtcbiAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIC4uLmhlYWRlcnMsXG4gICAgICAgICAgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgICBsYXN0U3RhdHVzID0gcmVzcG9uc2Uuc3RhdHVzO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGF5bG9hZCA9IChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIHtcbiAgICAgICAgZGF0YT86IEFycmF5PHsgaWQ/OiBzdHJpbmcgfT47XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtb2RlbE5hbWVzID0gKHBheWxvYWQuZGF0YSA/PyBbXSlcbiAgICAgICAgLm1hcCgoaXRlbSkgPT4gaXRlbS5pZClcbiAgICAgICAgLmZpbHRlcigoaXRlbSk6IGl0ZW0gaXMgc3RyaW5nID0+IHR5cGVvZiBpdGVtID09PSAnc3RyaW5nJyAmJiBpdGVtLnRyaW0oKS5sZW5ndGggPiAwKTtcblxuICAgICAgaWYgKG1vZGVsTmFtZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignXHU4RkRDXHU3QTBCXHU2QTIxXHU1NzhCXHU1M0QxXHU3M0IwXHU1OTMxXHU4RDI1XHVGRjFBXHU2NzJBXHU4RkQ0XHU1NkRFXHU0RUZCXHU0RjU1XHU2QTIxXHU1NzhCXHUzMDAyJyk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBtb2RlbE5hbWVzO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsYXN0RXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoJ1x1OEZEQ1x1N0EwQlx1NkEyMVx1NTc4Qlx1NTNEMVx1NzNCMFx1NTkzMVx1OEQyNScpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChsYXN0U3RhdHVzID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgXHU4RkRDXHU3QTBCXHU2QTIxXHU1NzhCXHU1M0QxXHU3M0IwXHU1OTMxXHU4RDI1XHVGRjFBSFRUUCAke2xhc3RTdGF0dXN9YCk7XG4gIH1cblxuICBpZiAobGFzdEVycm9yKSB7XG4gICAgdGhyb3cgbGFzdEVycm9yO1xuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKCdcdThGRENcdTdBMEJcdTZBMjFcdTU3OEJcdTUzRDFcdTczQjBcdTU5MzFcdThEMjVcdUZGMUFcdThCRjdcdTZDNDJcdTY3MkFcdTVCOENcdTYyMTBcdTMwMDInKTtcbn1cblxuZnVuY3Rpb24gbWVyZ2VQcm92aWRlckNvbmZpZ3MoXG4gIHByb3ZpZGVyczogcmVhZG9ubHkgWmVyb0NsYXdNb2RlbFByb3ZpZGVyQ29uZmlnW10sXG4gIG5leHRQcm92aWRlcjogWmVyb0NsYXdNb2RlbFByb3ZpZGVyQ29uZmlnLFxuKTogWmVyb0NsYXdNb2RlbFByb3ZpZGVyQ29uZmlnW10ge1xuICBjb25zdCBleGlzdGVkID0gcHJvdmlkZXJzLnNvbWUoKGl0ZW0pID0+IGl0ZW0uaWQgPT09IG5leHRQcm92aWRlci5pZCk7XG5cbiAgaWYgKGV4aXN0ZWQpIHtcbiAgICByZXR1cm4gcHJvdmlkZXJzLm1hcCgoaXRlbSkgPT4gKGl0ZW0uaWQgPT09IG5leHRQcm92aWRlci5pZCA/IG5leHRQcm92aWRlciA6IGl0ZW0pKTtcbiAgfVxuXG4gIHJldHVybiBbLi4ucHJvdmlkZXJzLCBuZXh0UHJvdmlkZXJdO1xufVxuXG5mdW5jdGlvbiByZXBsYWNlTW9kZWxDYXRhbG9nRm9yUHJvdmlkZXIoXG4gIGN1cnJlbnQ6IHJlYWRvbmx5IFplcm9DbGF3TW9kZWxDYXRhbG9nSXRlbVtdLFxuICBwcm92aWRlcklkOiBzdHJpbmcsXG4gIGluY29taW5nOiByZWFkb25seSBaZXJvQ2xhd01vZGVsQ2F0YWxvZ0l0ZW1bXSxcbik6IFplcm9DbGF3TW9kZWxDYXRhbG9nSXRlbVtdIHtcbiAgY29uc3Qgb3RoZXJzID0gY3VycmVudC5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCAhPT0gcHJvdmlkZXJJZCk7XG4gIHJldHVybiBbLi4ub3RoZXJzLCAuLi5pbmNvbWluZ107XG59XG5cbmZ1bmN0aW9uIHRvQ29ubmVjdGVkUHJvdmlkZXJJdGVtcyhcbiAgY29ubmVjdGlvbnM6IHJlYWRvbmx5IFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uW10sXG4gIG1vZGVsQ2F0YWxvZzogcmVhZG9ubHkgWmVyb0NsYXdNb2RlbENhdGFsb2dJdGVtW10sXG4pOiBDb25uZWN0ZWRQcm92aWRlckl0ZW1bXSB7XG4gIHJldHVybiBjb25uZWN0aW9ucy5tYXAoKGNvbm5lY3Rpb24pID0+IHtcbiAgICBjb25zdCBtb2RlbENvdW50ID0gbW9kZWxDYXRhbG9nLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkID09PSBjb25uZWN0aW9uLnByb3ZpZGVySWQpLmxlbmd0aDtcblxuICAgIHJldHVybiB7XG4gICAgICBjb25uZWN0aW9uSWQ6IGNvbm5lY3Rpb24uY29ubmVjdGlvbklkLFxuICAgICAgcHJvdmlkZXJJZDogY29ubmVjdGlvbi5wcm92aWRlcklkLFxuICAgICAgZGlzcGxheU5hbWU6IGNvbm5lY3Rpb24uZGlzcGxheU5hbWUsXG4gICAgICBpY29uOiBjb25uZWN0aW9uLmljb24sXG4gICAgICBiYWRnZTogY29ubmVjdGlvbi5iYWRnZSxcbiAgICAgIGNhbkRpc2Nvbm5lY3Q6IGNvbm5lY3Rpb24uY2FuRGlzY29ubmVjdCxcbiAgICAgIGNvbm5lY3RlZEF0OiBjb25uZWN0aW9uLmNvbm5lY3RlZEF0LFxuICAgICAgbW9kZWxDb3VudCxcbiAgICAgIGhlYWx0aDogY29ubmVjdGlvbi5oZWFsdGgsXG4gICAgICBhcGlCYXNlOiBjb25uZWN0aW9uLmFwaUJhc2UsXG4gICAgICBoYXNBcGlLZXk6IHR5cGVvZiBjb25uZWN0aW9uLmFwaUtleVBsYWludGV4dCA9PT0gJ3N0cmluZycgJiYgY29ubmVjdGlvbi5hcGlLZXlQbGFpbnRleHQubGVuZ3RoID4gMCxcbiAgICB9O1xuICB9KTtcbn1cblxuZnVuY3Rpb24gYnVpbGRIb3RQcm92aWRlckl0ZW1zKGNvbm5lY3RlZFByb3ZpZGVySWRzOiBSZWFkb25seVNldDxzdHJpbmc+KTogSG90UHJvdmlkZXJJdGVtW10ge1xuICBjb25zdCBjYXRhbG9nID0gZ2V0TW9kZWxQcm92aWRlckNhdGFsb2coKTtcblxuICByZXR1cm4gSE9UX1BST1ZJREVSX0lEUy5tYXAoKHByb3ZpZGVySWQpID0+IHtcbiAgICBjb25zdCBwcm92aWRlciA9IGNhdGFsb2cuZmluZCgoaXRlbSkgPT4gaXRlbS5pZCA9PT0gcHJvdmlkZXJJZCk7XG5cbiAgICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFx1NzBFRFx1OTVFOFx1NjNEMFx1NEY5Qlx1NTU0Nlx1N0YzQVx1NTkzMVx1RkYxQSR7cHJvdmlkZXJJZH1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBhbHJlYWR5Q29ubmVjdGVkID0gY29ubmVjdGVkUHJvdmlkZXJJZHMuaGFzKHByb3ZpZGVySWQpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHByb3ZpZGVySWQ6IHByb3ZpZGVyLmlkLFxuICAgICAgZGlzcGxheU5hbWU6IHByb3ZpZGVyLmRpc3BsYXlOYW1lLFxuICAgICAgaWNvbjogZ2V0UHJvdmlkZXJJY29uKHByb3ZpZGVyLmlkKSxcbiAgICAgIHN1YnRpdGxlOiBhbHJlYWR5Q29ubmVjdGVkXG4gICAgICAgID8gYCR7cHJvdmlkZXIuZGlzcGxheU5hbWV9IFx1NURGMlx1OEZERVx1NjNBNVx1RkYwQ1x1NTNFRlx1NTcyOFx1NEUwQVx1NjVCOVx1N0JBMVx1NzQwNmBcbiAgICAgICAgOiBgXHU0RjdGXHU3NTI4ICR7cHJvdmlkZXIuZGlzcGxheU5hbWV9IEFQSSBcdTVCQzZcdTk0QTVcdThGREVcdTYzQTVgLFxuICAgICAgcmVjb21tZW5kZWQ6IHByb3ZpZGVyLmlkID09PSAnYW50aHJvcGljJyB8fCBwcm92aWRlci5pZCA9PT0gJ29wZW5haScgfHwgcHJvdmlkZXIuaWQgPT09ICdudmlkaWEtbmltJyxcbiAgICAgIGNvbm5lY3RUeXBlOiAnYXBpX2tleScgYXMgY29uc3QsXG4gICAgfTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHVwc2VydENvbm5lY3Rpb24oXG4gIGN1cnJlbnRDb25uZWN0aW9uczogcmVhZG9ubHkgWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb25bXSxcbiAgbmV4dENvbm5lY3Rpb246IFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uLFxuKTogWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb25bXSB7XG4gIGNvbnN0IGV4aXN0ZWQgPSBjdXJyZW50Q29ubmVjdGlvbnMuc29tZSgoY29ubmVjdGlvbikgPT4gY29ubmVjdGlvbi5wcm92aWRlcklkID09PSBuZXh0Q29ubmVjdGlvbi5wcm92aWRlcklkKTtcblxuICBpZiAoZXhpc3RlZCkge1xuICAgIHJldHVybiBjdXJyZW50Q29ubmVjdGlvbnMubWFwKChjb25uZWN0aW9uKSA9PlxuICAgICAgY29ubmVjdGlvbi5wcm92aWRlcklkID09PSBuZXh0Q29ubmVjdGlvbi5wcm92aWRlcklkID8gbmV4dENvbm5lY3Rpb24gOiBjb25uZWN0aW9uLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4gWy4uLmN1cnJlbnRDb25uZWN0aW9ucywgbmV4dENvbm5lY3Rpb25dO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0UHJvdmlkZXJTZXR0aW5ncyhob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPFByb3ZpZGVyU2V0dGluZ3NSZXNwb25zZT4ge1xuICBjb25zdCBjb25maWcgPSBhd2FpdCBlbnN1cmVaZXJvQ2xhd0NvbmZpZyhob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBjb25uZWN0ZWRQcm92aWRlcnMgPSB0b0Nvbm5lY3RlZFByb3ZpZGVySXRlbXMoY29uZmlnLnByb3ZpZGVyQ29ubmVjdGlvbnMsIGNvbmZpZy5tb2RlbENhdGFsb2cpO1xuICBjb25zdCBjb25uZWN0ZWRQcm92aWRlcklkcyA9IG5ldyBTZXQoY29ubmVjdGVkUHJvdmlkZXJzLm1hcCgoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkKSk7XG5cbiAgcmV0dXJuIHtcbiAgICBjb25uZWN0ZWRQcm92aWRlcnMsXG4gICAgaG90UHJvdmlkZXJzOiBidWlsZEhvdFByb3ZpZGVySXRlbXMoY29ubmVjdGVkUHJvdmlkZXJJZHMpLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29ubmVjdFByb3ZpZGVyKGlucHV0OiBDb25uZWN0UHJvdmlkZXJJbnB1dCk6IFByb21pc2U8WmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24+IHtcbiAgY29uc3Qgbm9ybWFsaXplZFByb3ZpZGVySWQgPSBub3JtYWxpemVQcm92aWRlcklkKGlucHV0LnByb3ZpZGVySWQpO1xuICBjb25zdCBwcm92aWRlciA9IGZpbmRNb2RlbFByb3ZpZGVyKG5vcm1hbGl6ZWRQcm92aWRlcklkKTtcblxuICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBcdTY1RTBcdTZDRDVcdThGREVcdTYzQTVcdTY3MkFcdTc3RTVcdTYzRDBcdTRGOUJcdTU1NDZcdUZGMUEke2lucHV0LnByb3ZpZGVySWR9YCk7XG4gIH1cblxuICBjb25zdCBhcGlCYXNlID0gKGlucHV0LmFwaUJhc2UgPz8gcHJvdmlkZXIuYXBpQmFzZSkudHJpbSgpO1xuICBjb25zdCBhdXRvRGlzY292ZXJNb2RlbHMgPSBpbnB1dC5hdXRvRGlzY292ZXJNb2RlbHMgPz8gdHJ1ZTtcbiAgbGV0IG1vZGVsTmFtZXMgPSBwcm92aWRlci5kZWZhdWx0TW9kZWxzO1xuICBsZXQgbW9kZWxTb3VyY2U6ICdjYXRhbG9nJyB8ICdsaXZlJyA9ICdjYXRhbG9nJztcbiAgbGV0IGhlYWx0aDogJ29rJyB8ICd3YXJuaW5nJyB8ICdlcnJvcicgPSAnb2snO1xuXG4gIGlmIChhdXRvRGlzY292ZXJNb2RlbHMgJiYgaW5wdXQuY29ubmVjdFR5cGUgPT09ICdhcGlfa2V5JyAmJiB0eXBlb2YgaW5wdXQuYXBpS2V5ID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXNjb3ZlcmVkID0gYXdhaXQgZGlzY292ZXJNb2RlbHNGcm9tUmVtb3RlKHByb3ZpZGVyLmlkLCBhcGlCYXNlLCBpbnB1dC5hcGlLZXkpO1xuICAgICAgbW9kZWxOYW1lcyA9IGRpc2NvdmVyZWQ7XG4gICAgICBtb2RlbFNvdXJjZSA9ICdsaXZlJztcbiAgICB9IGNhdGNoIHtcbiAgICAgIGhlYWx0aCA9ICd3YXJuaW5nJztcbiAgICB9XG4gIH1cblxuICBjb25zdCBwcm92aWRlckNvbmZpZzogWmVyb0NsYXdNb2RlbFByb3ZpZGVyQ29uZmlnID0ge1xuICAgIGlkOiBwcm92aWRlci5pZCxcbiAgICBkaXNwbGF5TmFtZTogcHJvdmlkZXIuZGlzcGxheU5hbWUsXG4gICAgYXBpQmFzZSxcbiAgICBhcGlLZXlFbnY6IHByb3ZpZGVyLmFwaUtleUVudixcbiAgICBtb2RlbHM6IG1vZGVsTmFtZXMsXG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgfTtcblxuICBjb25zdCBjb25uZWN0aW9uOiBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbiA9IHtcbiAgICBjb25uZWN0aW9uSWQ6IGNyZWF0ZUNvbm5lY3Rpb25JZChwcm92aWRlci5pZCksXG4gICAgcHJvdmlkZXJJZDogcHJvdmlkZXIuaWQsXG4gICAgZGlzcGxheU5hbWU6IGlucHV0LmFsaWFzID8/IHByb3ZpZGVyLmRpc3BsYXlOYW1lLFxuICAgIGljb246IGdldFByb3ZpZGVySWNvbihwcm92aWRlci5pZCksXG4gICAgYmFkZ2U6IGlucHV0LmNvbm5lY3RUeXBlID09PSAnYXBpX2tleScgPyAnYXBpX2tleScgOiAnY29uZmlnJyxcbiAgICBjb25uZWN0VHlwZTogaW5wdXQuY29ubmVjdFR5cGUsXG4gICAgY2FuRGlzY29ubmVjdDogdHJ1ZSxcbiAgICBjb25uZWN0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIGhlYWx0aCxcbiAgICBhcGlCYXNlLFxuICAgIGFwaUtleU1hc2tlZDogbWFza0FwaUtleShpbnB1dC5hcGlLZXkpLFxuICAgIGFwaUtleVBsYWludGV4dDogaW5wdXQuYXBpS2V5LFxuICAgIG1vZGVsRGlzY292ZXJ5OiB7XG4gICAgICBtb2RlOiBhdXRvRGlzY292ZXJNb2RlbHMgPyAncmVtb3RlJyA6ICdkZWZhdWx0JyxcbiAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgc291cmNlOiBtb2RlbFNvdXJjZSxcbiAgICB9LFxuICB9O1xuXG4gICAgYXdhaXQgdXBkYXRlWmVyb0NsYXdDb25maWdGaWxlKFxuICAgICAgKGN1cnJlbnQpID0+IHtcbiAgICAgICAgY29uc3QgZW5hYmxlZFNldCA9IHJlc29sdmVFbmFibGVkU2V0KGN1cnJlbnQubW9kZWxDYXRhbG9nLCBwcm92aWRlci5pZCwgbW9kZWxTb3VyY2UgPT09ICdjYXRhbG9nJyk7XG4gICAgICAgIGNvbnN0IHByb3ZpZGVyTW9kZWxzID0gYnVpbGRNb2RlbENhdGFsb2dGb3JQcm92aWRlcihcbiAgICAgICAgICBwcm92aWRlci5pZCxcbiAgICAgICAgICBtb2RlbE5hbWVzLFxuICAgICAgICAgIGVuYWJsZWRTZXQsXG4gICAgICAgICAgbW9kZWxTb3VyY2UgPT09ICdjYXRhbG9nJyxcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgbW9kZWxQcm92aWRlcnMgPSBtZXJnZVByb3ZpZGVyQ29uZmlncyhjdXJyZW50Lm1vZGVsUHJvdmlkZXJzLCBwcm92aWRlckNvbmZpZyk7XG4gICAgICAgIGNvbnN0IG1vZGVsQ2F0YWxvZyA9IHJlcGxhY2VNb2RlbENhdGFsb2dGb3JQcm92aWRlcihjdXJyZW50Lm1vZGVsQ2F0YWxvZywgcHJvdmlkZXIuaWQsIHByb3ZpZGVyTW9kZWxzKTtcbiAgICAgIGNvbnN0IHByb3ZpZGVyQ29ubmVjdGlvbnMgPSB1cHNlcnRDb25uZWN0aW9uKGN1cnJlbnQucHJvdmlkZXJDb25uZWN0aW9ucywgY29ubmVjdGlvbik7XG4gICAgICBjb25zdCBkZWZhdWx0TW9kZWxJZCA9XG4gICAgICAgIGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWQgJiZcbiAgICAgICAgbW9kZWxDYXRhbG9nLnNvbWUoKGl0ZW0pID0+IGl0ZW0ubW9kZWxJZCA9PT0gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZClcbiAgICAgICAgICA/IGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWRcbiAgICAgICAgICA6IHByb3ZpZGVyTW9kZWxzWzBdPy5tb2RlbElkO1xuXG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5jdXJyZW50LFxuICAgICAgICBkZWZhdWx0czoge1xuICAgICAgICAgIC4uLmN1cnJlbnQuZGVmYXVsdHMsXG4gICAgICAgICAgcHJpbWFyeVByb3ZpZGVySWQ6IHByb3ZpZGVyLmlkLFxuICAgICAgICAgIGRlZmF1bHRNb2RlbElkLFxuICAgICAgICB9LFxuICAgICAgICBtb2RlbFByb3ZpZGVycyxcbiAgICAgICAgbW9kZWxDYXRhbG9nLFxuICAgICAgICBwcm92aWRlckNvbm5lY3Rpb25zLFxuICAgICAgfTtcbiAgICB9LFxuICAgIGlucHV0LmhvbWVEaXJPdmVycmlkZSxcbiAgKTtcblxuICByZXR1cm4gY29ubmVjdGlvbjtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvbm5lY3RDdXN0b21Qcm92aWRlcihcbiAgaW5wdXQ6IENvbm5lY3RDdXN0b21Qcm92aWRlcklucHV0LFxuKTogUHJvbWlzZTxaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbj4ge1xuICBjb25zdCBwcm92aWRlcklkID0gYGN1c3RvbS0ke3NsdWdpZnkoaW5wdXQuZGlzcGxheU5hbWUpfWA7XG4gIGNvbnN0IGRpc3BsYXlOYW1lID0gaW5wdXQuYWxpYXMgPz8gaW5wdXQuZGlzcGxheU5hbWU7XG4gIGNvbnN0IGFwaUtleUVudiA9IGBDVVNUT01fJHtzbHVnaWZ5KGlucHV0LmRpc3BsYXlOYW1lKS50b1VwcGVyQ2FzZSgpLnJlcGxhY2UoLy0vZywgJ18nKX1fQVBJX0tFWWA7XG4gIGNvbnN0IGF1dG9EaXNjb3Zlck1vZGVscyA9IGlucHV0LmF1dG9EaXNjb3Zlck1vZGVscyA/PyB0cnVlO1xuXG4gIGxldCBtb2RlbE5hbWVzID0gaW5wdXQubW9kZWxzLmxlbmd0aCA+IDAgPyBpbnB1dC5tb2RlbHMgOiBbJ2N1c3RvbS1tb2RlbCddO1xuICBsZXQgbW9kZWxTb3VyY2U6ICdjYXRhbG9nJyB8ICdsaXZlJyA9ICdjYXRhbG9nJztcbiAgbGV0IGhlYWx0aDogJ29rJyB8ICd3YXJuaW5nJyB8ICdlcnJvcicgPSAnb2snO1xuXG4gIGlmIChhdXRvRGlzY292ZXJNb2RlbHMgJiYgdHlwZW9mIGlucHV0LmFwaUtleSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlzY292ZXJlZCA9IGF3YWl0IGRpc2NvdmVyTW9kZWxzRnJvbVJlbW90ZShwcm92aWRlcklkLCBpbnB1dC5hcGlCYXNlLCBpbnB1dC5hcGlLZXkpO1xuICAgICAgbW9kZWxOYW1lcyA9IGRpc2NvdmVyZWQ7XG4gICAgICBtb2RlbFNvdXJjZSA9ICdsaXZlJztcbiAgICB9IGNhdGNoIHtcbiAgICAgIGhlYWx0aCA9ICd3YXJuaW5nJztcbiAgICB9XG4gIH1cblxuICBjb25zdCBwcm92aWRlckNvbmZpZzogWmVyb0NsYXdNb2RlbFByb3ZpZGVyQ29uZmlnID0ge1xuICAgIGlkOiBwcm92aWRlcklkLFxuICAgIGRpc3BsYXlOYW1lLFxuICAgIGFwaUJhc2U6IGlucHV0LmFwaUJhc2UsXG4gICAgYXBpS2V5RW52LFxuICAgIG1vZGVsczogbW9kZWxOYW1lcyxcbiAgICBlbmFibGVkOiB0cnVlLFxuICB9O1xuXG4gIGNvbnN0IGNvbm5lY3Rpb246IFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uID0ge1xuICAgIGNvbm5lY3Rpb25JZDogY3JlYXRlQ29ubmVjdGlvbklkKHByb3ZpZGVySWQpLFxuICAgIHByb3ZpZGVySWQsXG4gICAgZGlzcGxheU5hbWUsXG4gICAgaWNvbjogZ2V0UHJvdmlkZXJJY29uKHByb3ZpZGVySWQpLFxuICAgIGJhZGdlOiAnY3VzdG9tJyxcbiAgICBjb25uZWN0VHlwZTogJ2NvbmZpZycsXG4gICAgY2FuRGlzY29ubmVjdDogdHJ1ZSxcbiAgICBjb25uZWN0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIGhlYWx0aCxcbiAgICBhcGlCYXNlOiBpbnB1dC5hcGlCYXNlLFxuICAgIGFwaUtleU1hc2tlZDogbWFza0FwaUtleShpbnB1dC5hcGlLZXkpLFxuICAgIGFwaUtleVBsYWludGV4dDogaW5wdXQuYXBpS2V5LFxuICAgIG1vZGVsRGlzY292ZXJ5OiB7XG4gICAgICBtb2RlOiBhdXRvRGlzY292ZXJNb2RlbHMgPyAncmVtb3RlJyA6ICdkZWZhdWx0JyxcbiAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgc291cmNlOiBtb2RlbFNvdXJjZSxcbiAgICB9LFxuICB9O1xuXG4gICAgYXdhaXQgdXBkYXRlWmVyb0NsYXdDb25maWdGaWxlKFxuICAgICAgKGN1cnJlbnQpID0+IHtcbiAgICAgICAgY29uc3QgZW5hYmxlZFNldCA9IHJlc29sdmVFbmFibGVkU2V0KGN1cnJlbnQubW9kZWxDYXRhbG9nLCBwcm92aWRlcklkLCBtb2RlbFNvdXJjZSA9PT0gJ2NhdGFsb2cnKTtcbiAgICAgICAgY29uc3QgcHJvdmlkZXJNb2RlbHMgPSBidWlsZE1vZGVsQ2F0YWxvZ0ZvclByb3ZpZGVyKFxuICAgICAgICAgIHByb3ZpZGVySWQsXG4gICAgICAgICAgbW9kZWxOYW1lcyxcbiAgICAgICAgICBlbmFibGVkU2V0LFxuICAgICAgICAgIG1vZGVsU291cmNlID09PSAnY2F0YWxvZycsXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IG1vZGVsUHJvdmlkZXJzID0gbWVyZ2VQcm92aWRlckNvbmZpZ3MoY3VycmVudC5tb2RlbFByb3ZpZGVycywgcHJvdmlkZXJDb25maWcpO1xuICAgICAgICBjb25zdCBtb2RlbENhdGFsb2cgPSByZXBsYWNlTW9kZWxDYXRhbG9nRm9yUHJvdmlkZXIoY3VycmVudC5tb2RlbENhdGFsb2csIHByb3ZpZGVySWQsIHByb3ZpZGVyTW9kZWxzKTtcbiAgICAgIGNvbnN0IHByb3ZpZGVyQ29ubmVjdGlvbnMgPSB1cHNlcnRDb25uZWN0aW9uKGN1cnJlbnQucHJvdmlkZXJDb25uZWN0aW9ucywgY29ubmVjdGlvbik7XG4gICAgICBjb25zdCBkZWZhdWx0TW9kZWxJZCA9XG4gICAgICAgIGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWQgJiZcbiAgICAgICAgbW9kZWxDYXRhbG9nLnNvbWUoKGl0ZW0pID0+IGl0ZW0ubW9kZWxJZCA9PT0gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZClcbiAgICAgICAgICA/IGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWRcbiAgICAgICAgICA6IHByb3ZpZGVyTW9kZWxzWzBdPy5tb2RlbElkO1xuXG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5jdXJyZW50LFxuICAgICAgICBkZWZhdWx0czoge1xuICAgICAgICAgIC4uLmN1cnJlbnQuZGVmYXVsdHMsXG4gICAgICAgICAgcHJpbWFyeVByb3ZpZGVySWQ6IHByb3ZpZGVySWQsXG4gICAgICAgICAgZGVmYXVsdE1vZGVsSWQsXG4gICAgICAgIH0sXG4gICAgICAgIG1vZGVsUHJvdmlkZXJzLFxuICAgICAgICBtb2RlbENhdGFsb2csXG4gICAgICAgIHByb3ZpZGVyQ29ubmVjdGlvbnMsXG4gICAgICB9O1xuICAgIH0sXG4gICAgaW5wdXQuaG9tZURpck92ZXJyaWRlLFxuICApO1xuXG4gIHJldHVybiBjb25uZWN0aW9uO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGlzY29ubmVjdFByb3ZpZGVyKGlucHV0OiBEaXNjb25uZWN0UHJvdmlkZXJJbnB1dCk6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCB1cGRhdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUoXG4gICAgKGN1cnJlbnQpID0+IHtcbiAgICAgIGNvbnN0IHRhcmdldENvbm5lY3Rpb24gPSBjdXJyZW50LnByb3ZpZGVyQ29ubmVjdGlvbnMuZmluZChcbiAgICAgICAgKGNvbm5lY3Rpb24pID0+IGNvbm5lY3Rpb24uY29ubmVjdGlvbklkID09PSBpbnB1dC5jb25uZWN0aW9uSWQsXG4gICAgICApO1xuXG4gICAgICBpZiAoIXRhcmdldENvbm5lY3Rpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBcdThGREVcdTYzQTVcdTRFMERcdTVCNThcdTU3MjhcdUZGMUEke2lucHV0LmNvbm5lY3Rpb25JZH1gKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcHJvdmlkZXJDb25uZWN0aW9ucyA9IGN1cnJlbnQucHJvdmlkZXJDb25uZWN0aW9ucy5maWx0ZXIoXG4gICAgICAgIChjb25uZWN0aW9uKSA9PiBjb25uZWN0aW9uLmNvbm5lY3Rpb25JZCAhPT0gaW5wdXQuY29ubmVjdGlvbklkLFxuICAgICAgKTtcblxuICAgICAgY29uc3QgaGFzU2FtZVByb3ZpZGVyQ29ubmVjdGlvbiA9IHByb3ZpZGVyQ29ubmVjdGlvbnMuc29tZShcbiAgICAgICAgKGNvbm5lY3Rpb24pID0+IGNvbm5lY3Rpb24ucHJvdmlkZXJJZCA9PT0gdGFyZ2V0Q29ubmVjdGlvbi5wcm92aWRlcklkLFxuICAgICAgKTtcblxuICAgICAgY29uc3QgbW9kZWxQcm92aWRlcnMgPSBjdXJyZW50Lm1vZGVsUHJvdmlkZXJzXG4gICAgICAgIC5tYXAoKHByb3ZpZGVyKSA9PlxuICAgICAgICAgIHByb3ZpZGVyLmlkID09PSB0YXJnZXRDb25uZWN0aW9uLnByb3ZpZGVySWRcbiAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICAgIC4uLnByb3ZpZGVyLFxuICAgICAgICAgICAgICAgIGVuYWJsZWQ6IGhhc1NhbWVQcm92aWRlckNvbm5lY3Rpb24sXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDogcHJvdmlkZXIsXG4gICAgICAgIClcbiAgICAgICAgLmZpbHRlcigocHJvdmlkZXIpID0+IHByb3ZpZGVyLmVuYWJsZWQpO1xuXG4gICAgICBjb25zdCBtb2RlbENhdGFsb2cgPSBjdXJyZW50Lm1vZGVsQ2F0YWxvZy5maWx0ZXIoXG4gICAgICAgIChtb2RlbCkgPT4gbW9kZWwucHJvdmlkZXJJZCAhPT0gdGFyZ2V0Q29ubmVjdGlvbi5wcm92aWRlcklkLFxuICAgICAgKTtcblxuICAgICAgY29uc3QgbmV4dFByaW1hcnlQcm92aWRlcklkID1cbiAgICAgICAgY3VycmVudC5kZWZhdWx0cy5wcmltYXJ5UHJvdmlkZXJJZCA9PT0gdGFyZ2V0Q29ubmVjdGlvbi5wcm92aWRlcklkXG4gICAgICAgICAgPyBwcm92aWRlckNvbm5lY3Rpb25zWzBdPy5wcm92aWRlcklkXG4gICAgICAgICAgOiBjdXJyZW50LmRlZmF1bHRzLnByaW1hcnlQcm92aWRlcklkO1xuXG4gICAgICBjb25zdCBuZXh0RGVmYXVsdE1vZGVsSWQgPVxuICAgICAgICB0eXBlb2YgY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgICAgbW9kZWxDYXRhbG9nLnNvbWUoKGl0ZW0pID0+IGl0ZW0ubW9kZWxJZCA9PT0gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZClcbiAgICAgICAgICA/IGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWRcbiAgICAgICAgICA6IG1vZGVsQ2F0YWxvZy5maW5kKChpdGVtKSA9PiBpdGVtLnByb3ZpZGVySWQgPT09IG5leHRQcmltYXJ5UHJvdmlkZXJJZCk/Lm1vZGVsSWQ7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmN1cnJlbnQsXG4gICAgICAgIGRlZmF1bHRzOiB7XG4gICAgICAgICAgLi4uY3VycmVudC5kZWZhdWx0cyxcbiAgICAgICAgICBwcmltYXJ5UHJvdmlkZXJJZDogbmV4dFByaW1hcnlQcm92aWRlcklkLFxuICAgICAgICAgIGRlZmF1bHRNb2RlbElkOiBuZXh0RGVmYXVsdE1vZGVsSWQsXG4gICAgICAgIH0sXG4gICAgICAgIHByb3ZpZGVyQ29ubmVjdGlvbnMsXG4gICAgICAgIG1vZGVsUHJvdmlkZXJzLFxuICAgICAgICBtb2RlbENhdGFsb2csXG4gICAgICB9O1xuICAgIH0sXG4gICAgaW5wdXQuaG9tZURpck92ZXJyaWRlLFxuICApO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0TW9kZWxTZXR0aW5ncyhob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmcpOiBQcm9taXNlPE1vZGVsU2V0dGluZ3NSZXNwb25zZT4ge1xuICBjb25zdCBjb25maWcgPSBhd2FpdCBlbnN1cmVaZXJvQ2xhd0NvbmZpZyhob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBjb25uZWN0ZWRQcm92aWRlcklkcyA9IG5ldyBTZXQoY29uZmlnLnByb3ZpZGVyQ29ubmVjdGlvbnMubWFwKChpdGVtKSA9PiBpdGVtLnByb3ZpZGVySWQpKTtcblxuICByZXR1cm4ge1xuICAgIHByb3ZpZGVyczogY29uZmlnLnByb3ZpZGVyQ29ubmVjdGlvbnMubWFwKChpdGVtKSA9PiAoe1xuICAgICAgY29ubmVjdGlvbklkOiBpdGVtLmNvbm5lY3Rpb25JZCxcbiAgICAgIHByb3ZpZGVySWQ6IGl0ZW0ucHJvdmlkZXJJZCxcbiAgICAgIGRpc3BsYXlOYW1lOiBpdGVtLmRpc3BsYXlOYW1lLFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICB9KSksXG4gICAgbW9kZWxzOiBjb25maWcubW9kZWxDYXRhbG9nXG4gICAgICAuZmlsdGVyKChpdGVtKSA9PiBjb25uZWN0ZWRQcm92aWRlcklkcy5oYXMoaXRlbS5wcm92aWRlcklkKSlcbiAgICAgIC5tYXAoKGl0ZW0pID0+ICh7XG4gICAgICAgIG1vZGVsSWQ6IGl0ZW0ubW9kZWxJZCxcbiAgICAgICAgcHJvdmlkZXJJZDogaXRlbS5wcm92aWRlcklkLFxuICAgICAgICBkaXNwbGF5TmFtZTogaXRlbS5kaXNwbGF5TmFtZSxcbiAgICAgICAgc3VwcG9ydHNJbWFnZUlucHV0OiBpdGVtLmNhcGFiaWxpdGllcy5pbWFnZUlucHV0LFxuICAgICAgICBzdXBwb3J0c1Rvb2xDYWxsOiBpdGVtLmNhcGFiaWxpdGllcy50b29sQ2FsbCxcbiAgICAgICAgZW5hYmxlZDogaXRlbS5lbmFibGVkLFxuICAgICAgICBpc0RlZmF1bHQ6IGNvbmZpZy5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZCA9PT0gaXRlbS5tb2RlbElkLFxuICAgICAgfSkpLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2V0RGVmYXVsdE1vZGVsKGlucHV0OiBTZXREZWZhdWx0TW9kZWxJbnB1dCk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBjb25maWcgPSBhd2FpdCBlbnN1cmVaZXJvQ2xhd0NvbmZpZyhpbnB1dC5ob21lRGlyT3ZlcnJpZGUpO1xuICBjb25zdCBzZWxlY3RlZE1vZGVsID0gY29uZmlnLm1vZGVsQ2F0YWxvZy5maW5kKChpdGVtKSA9PiBpdGVtLm1vZGVsSWQgPT09IGlucHV0Lm1vZGVsSWQpO1xuXG4gIGlmICghc2VsZWN0ZWRNb2RlbCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgXHU2QTIxXHU1NzhCXHU0RTBEXHU1QjU4XHU1NzI4XHVGRjFBJHtpbnB1dC5tb2RlbElkfWApO1xuICB9XG5cbiAgY29uc3QgaGFzUHJvdmlkZXJDb25uZWN0aW9uID0gY29uZmlnLnByb3ZpZGVyQ29ubmVjdGlvbnMuc29tZShcbiAgICAoaXRlbSkgPT4gaXRlbS5wcm92aWRlcklkID09PSBzZWxlY3RlZE1vZGVsLnByb3ZpZGVySWQsXG4gICk7XG5cbiAgaWYgKCFoYXNQcm92aWRlckNvbm5lY3Rpb24pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1x1OEJFNVx1NkEyMVx1NTc4Qlx1NjI0MFx1NUM1RVx1NjNEMFx1NEY5Qlx1NTU0Nlx1NUMxQVx1NjcyQVx1OEZERVx1NjNBNVx1MzAwMicpO1xuICB9XG5cbiAgYXdhaXQgd3JpdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUoXG4gICAge1xuICAgICAgLi4uY29uZmlnLFxuICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGRlZmF1bHRzOiB7XG4gICAgICAgIC4uLmNvbmZpZy5kZWZhdWx0cyxcbiAgICAgICAgcHJpbWFyeVByb3ZpZGVySWQ6IHNlbGVjdGVkTW9kZWwucHJvdmlkZXJJZCxcbiAgICAgICAgZGVmYXVsdE1vZGVsSWQ6IHNlbGVjdGVkTW9kZWwubW9kZWxJZCxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBpbnB1dC5ob21lRGlyT3ZlcnJpZGUsXG4gICk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB0b2dnbGVQcm92aWRlckVuYWJsZWQoaW5wdXQ6IFRvZ2dsZVByb3ZpZGVyRW5hYmxlZElucHV0KTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHByb3ZpZGVySWQgPSBub3JtYWxpemVQcm92aWRlcklkKGlucHV0LnByb3ZpZGVySWQpO1xuXG4gIGF3YWl0IHVwZGF0ZVplcm9DbGF3Q29uZmlnRmlsZShcbiAgICAoY3VycmVudCkgPT4ge1xuICAgICAgY29uc3QgdGFyZ2V0UHJvdmlkZXIgPSBjdXJyZW50Lm1vZGVsUHJvdmlkZXJzLmZpbmQoKGl0ZW0pID0+IGl0ZW0uaWQgPT09IHByb3ZpZGVySWQpO1xuXG4gICAgICBpZiAoIXRhcmdldFByb3ZpZGVyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgXHU2M0QwXHU0RjlCXHU1NTQ2XHU0RTBEXHU1QjU4XHU1NzI4XHVGRjFBJHtpbnB1dC5wcm92aWRlcklkfWApO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBtb2RlbFByb3ZpZGVycyA9IGN1cnJlbnQubW9kZWxQcm92aWRlcnMubWFwKChpdGVtKSA9PlxuICAgICAgICBpdGVtLmlkID09PSBwcm92aWRlcklkXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIC4uLml0ZW0sXG4gICAgICAgICAgICAgIGVuYWJsZWQ6IGlucHV0LmVuYWJsZWQsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgOiBpdGVtLFxuICAgICAgKTtcblxuICAgICAgY29uc3QgbW9kZWxDYXRhbG9nID0gY3VycmVudC5tb2RlbENhdGFsb2cubWFwKChpdGVtKSA9PlxuICAgICAgICBpdGVtLnByb3ZpZGVySWQgPT09IHByb3ZpZGVySWRcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgLi4uaXRlbSxcbiAgICAgICAgICAgICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA6IGl0ZW0sXG4gICAgICApO1xuXG4gICAgICBjb25zdCBwcm92aWRlckNvbm5lY3Rpb25zID0gY3VycmVudC5wcm92aWRlckNvbm5lY3Rpb25zLm1hcCgoaXRlbSkgPT5cbiAgICAgICAgaXRlbS5wcm92aWRlcklkID09PSBwcm92aWRlcklkXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIC4uLml0ZW0sXG4gICAgICAgICAgICAgIGhlYWx0aDogaW5wdXQuZW5hYmxlZCA/IChpdGVtLmhlYWx0aCA9PT0gJ2Vycm9yJyA/ICd3YXJuaW5nJyA6IGl0ZW0uaGVhbHRoKSA6ICd3YXJuaW5nJyxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA6IGl0ZW0sXG4gICAgICApO1xuXG4gICAgICBjb25zdCBuZXh0UHJpbWFyeVByb3ZpZGVySWQgPVxuICAgICAgICBjdXJyZW50LmRlZmF1bHRzLnByaW1hcnlQcm92aWRlcklkID09PSBwcm92aWRlcklkICYmICFpbnB1dC5lbmFibGVkXG4gICAgICAgICAgPyBtb2RlbFByb3ZpZGVycy5maW5kKChpdGVtKSA9PiBpdGVtLmVuYWJsZWQpPy5pZFxuICAgICAgICAgIDogY3VycmVudC5kZWZhdWx0cy5wcmltYXJ5UHJvdmlkZXJJZDtcblxuICAgICAgY29uc3QgbmV4dERlZmF1bHRNb2RlbElkID1cbiAgICAgICAgdHlwZW9mIGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWQgPT09ICdzdHJpbmcnICYmXG4gICAgICAgIG1vZGVsQ2F0YWxvZy5zb21lKChpdGVtKSA9PiBpdGVtLm1vZGVsSWQgPT09IGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWQgJiYgaXRlbS5lbmFibGVkKVxuICAgICAgICAgID8gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZFxuICAgICAgICAgIDogbW9kZWxDYXRhbG9nLmZpbmQoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCA9PT0gbmV4dFByaW1hcnlQcm92aWRlcklkICYmIGl0ZW0uZW5hYmxlZCk/Lm1vZGVsSWQ7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmN1cnJlbnQsXG4gICAgICAgIGRlZmF1bHRzOiB7XG4gICAgICAgICAgLi4uY3VycmVudC5kZWZhdWx0cyxcbiAgICAgICAgICBwcmltYXJ5UHJvdmlkZXJJZDogbmV4dFByaW1hcnlQcm92aWRlcklkLFxuICAgICAgICAgIGRlZmF1bHRNb2RlbElkOiBuZXh0RGVmYXVsdE1vZGVsSWQsXG4gICAgICAgIH0sXG4gICAgICAgIHByb3ZpZGVyQ29ubmVjdGlvbnMsXG4gICAgICAgIG1vZGVsUHJvdmlkZXJzLFxuICAgICAgICBtb2RlbENhdGFsb2csXG4gICAgICB9O1xuICAgIH0sXG4gICAgaW5wdXQuaG9tZURpck92ZXJyaWRlLFxuICApO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdG9nZ2xlTW9kZWxFbmFibGVkKGlucHV0OiBUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dCk6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCB1cGRhdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUoXG4gICAgKGN1cnJlbnQpID0+IHtcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsID0gY3VycmVudC5tb2RlbENhdGFsb2cuZmluZCgoaXRlbSkgPT4gaXRlbS5tb2RlbElkID09PSBpbnB1dC5tb2RlbElkKTtcblxuICAgICAgaWYgKCF0YXJnZXRNb2RlbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFx1NkEyMVx1NTc4Qlx1NEUwRFx1NUI1OFx1NTcyOFx1RkYxQSR7aW5wdXQubW9kZWxJZH1gKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbW9kZWxDYXRhbG9nID0gY3VycmVudC5tb2RlbENhdGFsb2cubWFwKChpdGVtKSA9PlxuICAgICAgICBpdGVtLm1vZGVsSWQgPT09IGlucHV0Lm1vZGVsSWRcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgLi4uaXRlbSxcbiAgICAgICAgICAgICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA6IGl0ZW0sXG4gICAgICApO1xuXG4gICAgICBjb25zdCBuZXh0RGVmYXVsdE1vZGVsSWQgPVxuICAgICAgICBjdXJyZW50LmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkID09PSBpbnB1dC5tb2RlbElkICYmICFpbnB1dC5lbmFibGVkXG4gICAgICAgICAgPyBtb2RlbENhdGFsb2cuZmluZChcbiAgICAgICAgICAgICAgKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCA9PT0gdGFyZ2V0TW9kZWwucHJvdmlkZXJJZCAmJiBpdGVtLmVuYWJsZWQsXG4gICAgICAgICAgICApPy5tb2RlbElkXG4gICAgICAgICAgOiBjdXJyZW50LmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkO1xuXG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5jdXJyZW50LFxuICAgICAgICBkZWZhdWx0czoge1xuICAgICAgICAgIC4uLmN1cnJlbnQuZGVmYXVsdHMsXG4gICAgICAgICAgZGVmYXVsdE1vZGVsSWQ6IG5leHREZWZhdWx0TW9kZWxJZCxcbiAgICAgICAgfSxcbiAgICAgICAgbW9kZWxDYXRhbG9nLFxuICAgICAgfTtcbiAgICB9LFxuICAgIGlucHV0LmhvbWVEaXJPdmVycmlkZSxcbiAgKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hQcm92aWRlck1vZGVscyhcbiAgaW5wdXQ6IFJlZnJlc2hQcm92aWRlck1vZGVsc0lucHV0LFxuKTogUHJvbWlzZTxSZWZyZXNoUHJvdmlkZXJNb2RlbHNSZXN1bHQ+IHtcbiAgY29uc3QgcHJvdmlkZXJJZCA9IG5vcm1hbGl6ZVByb3ZpZGVySWQoaW5wdXQucHJvdmlkZXJJZCk7XG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IGVuc3VyZVplcm9DbGF3Q29uZmlnKGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IHByb3ZpZGVyID0gY29uZmlnLm1vZGVsUHJvdmlkZXJzLmZpbmQoKGl0ZW0pID0+IGl0ZW0uaWQgPT09IHByb3ZpZGVySWQpO1xuXG4gIGlmICghcHJvdmlkZXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFx1NjNEMFx1NEY5Qlx1NTU0Nlx1NEUwRFx1NUI1OFx1NTcyOFx1RkYxQSR7aW5wdXQucHJvdmlkZXJJZH1gKTtcbiAgfVxuXG4gIGNvbnN0IGNvbm5lY3Rpb24gPSBjb25maWcucHJvdmlkZXJDb25uZWN0aW9ucy5maW5kKChpdGVtKSA9PiBpdGVtLnByb3ZpZGVySWQgPT09IHByb3ZpZGVySWQpO1xuICBsZXQgc291cmNlOiAnY2F0YWxvZycgfCAnbGl2ZScgPSAnY2F0YWxvZyc7XG4gIGxldCBtb2RlbE5hbWVzOiByZWFkb25seSBzdHJpbmdbXSA9IHByb3ZpZGVyLm1vZGVscztcblxuICBpZiAoY29ubmVjdGlvbj8uYXBpS2V5UGxhaW50ZXh0KSB7XG4gICAgdHJ5IHtcbiAgICAgIG1vZGVsTmFtZXMgPSBhd2FpdCBkaXNjb3Zlck1vZGVsc0Zyb21SZW1vdGUocHJvdmlkZXJJZCwgcHJvdmlkZXIuYXBpQmFzZSwgY29ubmVjdGlvbi5hcGlLZXlQbGFpbnRleHQpO1xuICAgICAgc291cmNlID0gJ2xpdmUnO1xuICAgIH0gY2F0Y2gge1xuICAgICAgc291cmNlID0gJ2NhdGFsb2cnO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHJlZnJlc2hlZFByb3ZpZGVyOiBaZXJvQ2xhd01vZGVsUHJvdmlkZXJDb25maWcgPSB7XG4gICAgLi4ucHJvdmlkZXIsXG4gICAgbW9kZWxzOiBtb2RlbE5hbWVzLFxuICAgIGVuYWJsZWQ6IHRydWUsXG4gIH07XG4gICAgYXdhaXQgdXBkYXRlWmVyb0NsYXdDb25maWdGaWxlKFxuICAgICAgKGN1cnJlbnQpID0+IHtcbiAgICAgICAgY29uc3QgZW5hYmxlZFNldCA9IHJlc29sdmVFbmFibGVkU2V0KGN1cnJlbnQubW9kZWxDYXRhbG9nLCBwcm92aWRlcklkLCBmYWxzZSk7XG4gICAgICAgIGNvbnN0IHJlZnJlc2hlZENhdGFsb2cgPSBidWlsZE1vZGVsQ2F0YWxvZ0ZvclByb3ZpZGVyKHByb3ZpZGVySWQsIG1vZGVsTmFtZXMsIGVuYWJsZWRTZXQsIGZhbHNlKTtcbiAgICAgICAgY29uc3QgbW9kZWxQcm92aWRlcnMgPSBtZXJnZVByb3ZpZGVyQ29uZmlncyhjdXJyZW50Lm1vZGVsUHJvdmlkZXJzLCByZWZyZXNoZWRQcm92aWRlcik7XG4gICAgICAgIGNvbnN0IG1vZGVsQ2F0YWxvZyA9IHJlcGxhY2VNb2RlbENhdGFsb2dGb3JQcm92aWRlcihjdXJyZW50Lm1vZGVsQ2F0YWxvZywgcHJvdmlkZXJJZCwgcmVmcmVzaGVkQ2F0YWxvZyk7XG4gICAgICBjb25zdCBwcm92aWRlckNvbm5lY3Rpb25zID0gY3VycmVudC5wcm92aWRlckNvbm5lY3Rpb25zLm1hcCgoaXRlbSkgPT5cbiAgICAgICAgaXRlbS5wcm92aWRlcklkID09PSBwcm92aWRlcklkXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIC4uLml0ZW0sXG4gICAgICAgICAgICAgIGhlYWx0aDogc291cmNlID09PSAnbGl2ZScgPyAnb2snIDogaXRlbS5oZWFsdGgsXG4gICAgICAgICAgICAgIG1vZGVsRGlzY292ZXJ5OiB7XG4gICAgICAgICAgICAgICAgbW9kZTogaXRlbS5tb2RlbERpc2NvdmVyeS5tb2RlLFxuICAgICAgICAgICAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA6IGl0ZW0sXG4gICAgICApO1xuXG4gICAgICBjb25zdCBuZXh0RGVmYXVsdE1vZGVsSWQgPVxuICAgICAgICB0eXBlb2YgY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgICAgbW9kZWxDYXRhbG9nLnNvbWUoKGl0ZW0pID0+IGl0ZW0ubW9kZWxJZCA9PT0gY3VycmVudC5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZClcbiAgICAgICAgICA/IGN1cnJlbnQuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWRcbiAgICAgICAgICA6IHJlZnJlc2hlZENhdGFsb2dbMF0/Lm1vZGVsSWQ7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmN1cnJlbnQsXG4gICAgICAgIGRlZmF1bHRzOiB7XG4gICAgICAgICAgLi4uY3VycmVudC5kZWZhdWx0cyxcbiAgICAgICAgICBkZWZhdWx0TW9kZWxJZDogbmV4dERlZmF1bHRNb2RlbElkLFxuICAgICAgICB9LFxuICAgICAgICBtb2RlbFByb3ZpZGVycyxcbiAgICAgICAgbW9kZWxDYXRhbG9nLFxuICAgICAgICBwcm92aWRlckNvbm5lY3Rpb25zLFxuICAgICAgfTtcbiAgICB9LFxuICAgIGlucHV0LmhvbWVEaXJPdmVycmlkZSxcbiAgKTtcblxuICByZXR1cm4ge1xuICAgIHByb3ZpZGVySWQsXG4gICAgbW9kZWxDb3VudDogbW9kZWxOYW1lcy5sZW5ndGgsXG4gICAgc291cmNlLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uKFxuICBpbnB1dDogVXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uSW5wdXQsXG4pOiBQcm9taXNlPFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uPiB7XG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IGVuc3VyZVplcm9DbGF3Q29uZmlnKGlucHV0LmhvbWVEaXJPdmVycmlkZSk7XG4gIGNvbnN0IHRhcmdldENvbm5lY3Rpb24gPSBjb25maWcucHJvdmlkZXJDb25uZWN0aW9ucy5maW5kKFxuICAgIChjb25uZWN0aW9uKSA9PiBjb25uZWN0aW9uLmNvbm5lY3Rpb25JZCA9PT0gaW5wdXQuY29ubmVjdGlvbklkLFxuICApO1xuXG4gIGlmICghdGFyZ2V0Q29ubmVjdGlvbikge1xuICAgIHRocm93IG5ldyBFcnJvcihgXHU4RkRFXHU2M0E1XHU0RTBEXHU1QjU4XHU1NzI4XHVGRjFBJHtpbnB1dC5jb25uZWN0aW9uSWR9YCk7XG4gIH1cblxuICBjb25zdCBwcm92aWRlcklkID0gdGFyZ2V0Q29ubmVjdGlvbi5wcm92aWRlcklkO1xuICBjb25zdCBwcm92aWRlciA9IGNvbmZpZy5tb2RlbFByb3ZpZGVycy5maW5kKChpdGVtKSA9PiBpdGVtLmlkID09PSBwcm92aWRlcklkKTtcblxuICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBcdTYzRDBcdTRGOUJcdTU1NDZcdTRFMERcdTVCNThcdTU3MjhcdUZGMUEke3Byb3ZpZGVySWR9YCk7XG4gIH1cblxuICBjb25zdCBhcGlCYXNlID0gKGlucHV0LmFwaUJhc2UgPz8gdGFyZ2V0Q29ubmVjdGlvbi5hcGlCYXNlKS50cmltKCk7XG4gIGNvbnN0IGFwaUtleVBsYWludGV4dCA9IGlucHV0LmFwaUtleSA/PyB0YXJnZXRDb25uZWN0aW9uLmFwaUtleVBsYWludGV4dDtcbiAgY29uc3QgZGlzcGxheU5hbWUgPSBpbnB1dC5hbGlhcyA/PyB0YXJnZXRDb25uZWN0aW9uLmRpc3BsYXlOYW1lO1xuICBjb25zdCBhdXRvRGlzY292ZXJNb2RlbHMgPSBpbnB1dC5hdXRvRGlzY292ZXJNb2RlbHMgPz8gZmFsc2U7XG5cbiAgbGV0IG1vZGVsTmFtZXM6IHJlYWRvbmx5IHN0cmluZ1tdID0gcHJvdmlkZXIubW9kZWxzO1xuICBsZXQgbW9kZWxTb3VyY2U6ICdjYXRhbG9nJyB8ICdsaXZlJyA9IHRhcmdldENvbm5lY3Rpb24ubW9kZWxEaXNjb3Zlcnkuc291cmNlO1xuICBsZXQgaGVhbHRoOiAnb2snIHwgJ3dhcm5pbmcnIHwgJ2Vycm9yJyA9IHRhcmdldENvbm5lY3Rpb24uaGVhbHRoO1xuICBsZXQgdXBkYXRlZE1vZGVsQ2F0YWxvZyA9IGNvbmZpZy5tb2RlbENhdGFsb2c7XG5cbiAgaWYgKGF1dG9EaXNjb3Zlck1vZGVscyAmJiBhcGlLZXlQbGFpbnRleHQpIHtcbiAgICB0cnkge1xuICAgICAgbW9kZWxOYW1lcyA9IGF3YWl0IGRpc2NvdmVyTW9kZWxzRnJvbVJlbW90ZShwcm92aWRlcklkLCBhcGlCYXNlLCBhcGlLZXlQbGFpbnRleHQpO1xuICAgICAgbW9kZWxTb3VyY2UgPSAnbGl2ZSc7XG4gICAgICBoZWFsdGggPSAnb2snO1xuICAgICAgICBjb25zdCBlbmFibGVkU2V0ID0gcmVzb2x2ZUVuYWJsZWRTZXQoY29uZmlnLm1vZGVsQ2F0YWxvZywgcHJvdmlkZXJJZCwgZmFsc2UpO1xuICAgICAgICB1cGRhdGVkTW9kZWxDYXRhbG9nID0gcmVwbGFjZU1vZGVsQ2F0YWxvZ0ZvclByb3ZpZGVyKFxuICAgICAgICAgIGNvbmZpZy5tb2RlbENhdGFsb2csXG4gICAgICAgICAgcHJvdmlkZXJJZCxcbiAgICAgICAgICBidWlsZE1vZGVsQ2F0YWxvZ0ZvclByb3ZpZGVyKHByb3ZpZGVySWQsIG1vZGVsTmFtZXMsIGVuYWJsZWRTZXQsIGZhbHNlKSxcbiAgICAgICAgKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIG1vZGVsU291cmNlID0gJ2NhdGFsb2cnO1xuICAgICAgaGVhbHRoID0gJ3dhcm5pbmcnO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHVwZGF0ZWRQcm92aWRlcjogWmVyb0NsYXdNb2RlbFByb3ZpZGVyQ29uZmlnID0ge1xuICAgIC4uLnByb3ZpZGVyLFxuICAgIGFwaUJhc2UsXG4gICAgbW9kZWxzOiBtb2RlbE5hbWVzLFxuICAgIGVuYWJsZWQ6IHRydWUsXG4gIH07XG5cbiAgY29uc3QgdXBkYXRlZENvbm5lY3Rpb246IFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uID0ge1xuICAgIC4uLnRhcmdldENvbm5lY3Rpb24sXG4gICAgZGlzcGxheU5hbWUsXG4gICAgYXBpQmFzZSxcbiAgICBhcGlLZXlQbGFpbnRleHQsXG4gICAgYXBpS2V5TWFza2VkOiBtYXNrQXBpS2V5KGFwaUtleVBsYWludGV4dCksXG4gICAgaGVhbHRoLFxuICAgIG1vZGVsRGlzY292ZXJ5OiB7XG4gICAgICBtb2RlOiBhdXRvRGlzY292ZXJNb2RlbHMgPyAncmVtb3RlJyA6IHRhcmdldENvbm5lY3Rpb24ubW9kZWxEaXNjb3ZlcnkubW9kZSxcbiAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgc291cmNlOiBtb2RlbFNvdXJjZSxcbiAgICB9LFxuICB9O1xuXG4gIGNvbnN0IG1vZGVsUHJvdmlkZXJzID0gbWVyZ2VQcm92aWRlckNvbmZpZ3MoY29uZmlnLm1vZGVsUHJvdmlkZXJzLCB1cGRhdGVkUHJvdmlkZXIpO1xuICBjb25zdCBwcm92aWRlckNvbm5lY3Rpb25zID0gY29uZmlnLnByb3ZpZGVyQ29ubmVjdGlvbnMubWFwKChjb25uZWN0aW9uKSA9PlxuICAgIGNvbm5lY3Rpb24uY29ubmVjdGlvbklkID09PSBpbnB1dC5jb25uZWN0aW9uSWQgPyB1cGRhdGVkQ29ubmVjdGlvbiA6IGNvbm5lY3Rpb24sXG4gICk7XG5cbiAgY29uc3QgbmV4dERlZmF1bHRNb2RlbElkID1cbiAgICB0eXBlb2YgY29uZmlnLmRlZmF1bHRzLmRlZmF1bHRNb2RlbElkID09PSAnc3RyaW5nJyAmJlxuICAgIHVwZGF0ZWRNb2RlbENhdGFsb2cuc29tZSgoaXRlbSkgPT4gaXRlbS5tb2RlbElkID09PSBjb25maWcuZGVmYXVsdHMuZGVmYXVsdE1vZGVsSWQpXG4gICAgICA/IGNvbmZpZy5kZWZhdWx0cy5kZWZhdWx0TW9kZWxJZFxuICAgICAgOiB1cGRhdGVkTW9kZWxDYXRhbG9nLmZpbmQoKGl0ZW0pID0+IGl0ZW0ucHJvdmlkZXJJZCA9PT0gcHJvdmlkZXJJZCk/Lm1vZGVsSWQ7XG5cbiAgYXdhaXQgd3JpdGVaZXJvQ2xhd0NvbmZpZ0ZpbGUoXG4gICAge1xuICAgICAgLi4uY29uZmlnLFxuICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGRlZmF1bHRzOiB7XG4gICAgICAgIC4uLmNvbmZpZy5kZWZhdWx0cyxcbiAgICAgICAgZGVmYXVsdE1vZGVsSWQ6IG5leHREZWZhdWx0TW9kZWxJZCxcbiAgICAgIH0sXG4gICAgICBtb2RlbFByb3ZpZGVycyxcbiAgICAgIG1vZGVsQ2F0YWxvZzogdXBkYXRlZE1vZGVsQ2F0YWxvZyxcbiAgICAgIHByb3ZpZGVyQ29ubmVjdGlvbnMsXG4gICAgfSxcbiAgICBpbnB1dC5ob21lRGlyT3ZlcnJpZGUsXG4gICk7XG5cbiAgcmV0dXJuIHVwZGF0ZWRDb25uZWN0aW9uO1xufVxuIiwgImltcG9ydCB7IGFwcCB9IGZyb20gJ2VsZWN0cm9uJztcblxuZXhwb3J0IGZ1bmN0aW9uIGdldEF1dG9MYXVuY2hTZXR0aW5nKCk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIHJldHVybiBhcHAuZ2V0TG9naW5JdGVtU2V0dGluZ3MoKS5vcGVuQXRMb2dpbjtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRBdXRvTGF1bmNoU2V0dGluZyhlbmFibGVkOiBib29sZWFuKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgYXBwLnNldExvZ2luSXRlbVNldHRpbmdzKHtcbiAgICAgIG9wZW5BdExvZ2luOiBlbmFibGVkLFxuICAgICAgb3BlbkFzSGlkZGVuOiB0cnVlLFxuICAgIH0pO1xuICAgIHJldHVybiBhcHAuZ2V0TG9naW5JdGVtU2V0dGluZ3MoKS5vcGVuQXRMb2dpbjtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG4iLCAiaW1wb3J0IHtcbiAgY29ubmVjdEN1c3RvbVByb3ZpZGVyLFxuICBjb25uZWN0UHJvdmlkZXIsXG4gIGRpc2Nvbm5lY3RQcm92aWRlcixcbiAgZ2V0TW9kZWxTZXR0aW5ncyxcbiAgZ2V0UHJvdmlkZXJTZXR0aW5ncyxcbiAgcmVmcmVzaFByb3ZpZGVyTW9kZWxzLFxuICBzZXREZWZhdWx0TW9kZWwsXG4gIHRvZ2dsZU1vZGVsRW5hYmxlZCxcbiAgdG9nZ2xlUHJvdmlkZXJFbmFibGVkLFxuICB1cGRhdGVQcm92aWRlckNvbm5lY3Rpb24sXG59IGZyb20gJy4vcHJvdmlkZXItc2V0dGluZ3Mtc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7XG4gIENvbm5lY3RDdXN0b21Qcm92aWRlcklucHV0LFxuICBDb25uZWN0UHJvdmlkZXJJbnB1dCxcbiAgRGlzY29ubmVjdFByb3ZpZGVySW5wdXQsXG4gIE1vZGVsU2V0dGluZ3NSZXNwb25zZSxcbiAgUHJvdmlkZXJTZXR0aW5nc1Jlc3BvbnNlLFxuICBSZWZyZXNoUHJvdmlkZXJNb2RlbHNJbnB1dCxcbiAgUmVmcmVzaFByb3ZpZGVyTW9kZWxzUmVzdWx0LFxuICBTZXREZWZhdWx0TW9kZWxJbnB1dCxcbiAgVG9nZ2xlTW9kZWxFbmFibGVkSW5wdXQsXG4gIFRvZ2dsZVByb3ZpZGVyRW5hYmxlZElucHV0LFxuICBVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dCxcbiAgWmVyb0NsYXdQcm92aWRlckNvbm5lY3Rpb24sXG4gIEFwcFNldHRpbmdzLFxuICBTZXRBdXRvTGF1bmNoSW5wdXQsXG59IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgZ2V0QXV0b0xhdW5jaFNldHRpbmcsIHNldEF1dG9MYXVuY2hTZXR0aW5nIH0gZnJvbSAnLi9zeXN0ZW0tc2V0dGluZ3Mtc2VydmljZSc7XG5cbi8qKlxuICogXHU4QkJFXHU3RjZFXHU5ODc1XHU2M0E1XHU1M0UzXHU5NUU4XHU5NzYyXHVGRjFBXG4gKiAtIFx1NjNEMFx1NEY5Qlx1NTU0Nlx1NTIxN1x1ODg2OFxuICogLSBcdThGREVcdTYzQTUvXHU2NUFEXHU1RjAwXHU2M0QwXHU0RjlCXHU1NTQ2XG4gKiAtIFx1NkEyMVx1NTc4Qlx1NTIxN1x1ODg2OFxuICogLSBcdThCQkVcdTdGNkVcdTlFRDhcdThCQTRcdTZBMjFcdTU3OEJcbiAqL1xuZXhwb3J0IGNvbnN0IHNldHRpbmdzQXBpID0ge1xuICBhc3luYyBnZXRQcm92aWRlcnMoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxQcm92aWRlclNldHRpbmdzUmVzcG9uc2U+IHtcbiAgICByZXR1cm4gZ2V0UHJvdmlkZXJTZXR0aW5ncyhob21lRGlyT3ZlcnJpZGUpO1xuICB9LFxuXG4gIGFzeW5jIGNvbm5lY3RQcm92aWRlcihpbnB1dDogQ29ubmVjdFByb3ZpZGVySW5wdXQpOiBQcm9taXNlPFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uPiB7XG4gICAgcmV0dXJuIGNvbm5lY3RQcm92aWRlcihpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgY29ubmVjdEN1c3RvbVByb3ZpZGVyKFxuICAgIGlucHV0OiBDb25uZWN0Q3VzdG9tUHJvdmlkZXJJbnB1dCxcbiAgKTogUHJvbWlzZTxaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbj4ge1xuICAgIHJldHVybiBjb25uZWN0Q3VzdG9tUHJvdmlkZXIoaW5wdXQpO1xuICB9LFxuXG4gIGFzeW5jIGRpc2Nvbm5lY3RQcm92aWRlcihpbnB1dDogRGlzY29ubmVjdFByb3ZpZGVySW5wdXQpOiBQcm9taXNlPHsgb2s6IHRydWUgfT4ge1xuICAgIGF3YWl0IGRpc2Nvbm5lY3RQcm92aWRlcihpbnB1dCk7XG4gICAgcmV0dXJuIHsgb2s6IHRydWUgfTtcbiAgfSxcblxuICBhc3luYyBnZXRNb2RlbHMoaG9tZURpck92ZXJyaWRlPzogc3RyaW5nKTogUHJvbWlzZTxNb2RlbFNldHRpbmdzUmVzcG9uc2U+IHtcbiAgICByZXR1cm4gZ2V0TW9kZWxTZXR0aW5ncyhob21lRGlyT3ZlcnJpZGUpO1xuICB9LFxuXG4gIGFzeW5jIHNldERlZmF1bHRNb2RlbChpbnB1dDogU2V0RGVmYXVsdE1vZGVsSW5wdXQpOiBQcm9taXNlPHsgb2s6IHRydWUgfT4ge1xuICAgIGF3YWl0IHNldERlZmF1bHRNb2RlbChpbnB1dCk7XG4gICAgcmV0dXJuIHsgb2s6IHRydWUgfTtcbiAgfSxcblxuICBhc3luYyB0b2dnbGVQcm92aWRlckVuYWJsZWQoaW5wdXQ6IFRvZ2dsZVByb3ZpZGVyRW5hYmxlZElucHV0KTogUHJvbWlzZTx7IG9rOiB0cnVlIH0+IHtcbiAgICBhd2FpdCB0b2dnbGVQcm92aWRlckVuYWJsZWQoaW5wdXQpO1xuICAgIHJldHVybiB7IG9rOiB0cnVlIH07XG4gIH0sXG5cbiAgYXN5bmMgdG9nZ2xlTW9kZWxFbmFibGVkKGlucHV0OiBUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dCk6IFByb21pc2U8eyBvazogdHJ1ZSB9PiB7XG4gICAgYXdhaXQgdG9nZ2xlTW9kZWxFbmFibGVkKGlucHV0KTtcbiAgICByZXR1cm4geyBvazogdHJ1ZSB9O1xuICB9LFxuXG4gIGFzeW5jIHJlZnJlc2hQcm92aWRlck1vZGVscyhcbiAgICBpbnB1dDogUmVmcmVzaFByb3ZpZGVyTW9kZWxzSW5wdXQsXG4gICk6IFByb21pc2U8UmVmcmVzaFByb3ZpZGVyTW9kZWxzUmVzdWx0PiB7XG4gICAgcmV0dXJuIHJlZnJlc2hQcm92aWRlck1vZGVscyhpbnB1dCk7XG4gIH0sXG5cbiAgYXN5bmMgdXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uKFxuICAgIGlucHV0OiBVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dCxcbiAgKTogUHJvbWlzZTxaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbj4ge1xuICAgIHJldHVybiB1cGRhdGVQcm92aWRlckNvbm5lY3Rpb24oaW5wdXQpO1xuICB9LFxuXG4gIGFzeW5jIGdldEFwcFNldHRpbmdzKCk6IFByb21pc2U8QXBwU2V0dGluZ3M+IHtcbiAgICByZXR1cm4ge1xuICAgICAgYXV0b0xhdW5jaDogZ2V0QXV0b0xhdW5jaFNldHRpbmcoKSxcbiAgICB9O1xuICB9LFxuXG4gIGFzeW5jIHNldEF1dG9MYXVuY2goaW5wdXQ6IFNldEF1dG9MYXVuY2hJbnB1dCk6IFByb21pc2U8QXBwU2V0dGluZ3M+IHtcbiAgICBjb25zdCBlbmFibGVkID0gc2V0QXV0b0xhdW5jaFNldHRpbmcoaW5wdXQuZW5hYmxlZCk7XG4gICAgcmV0dXJuIHsgYXV0b0xhdW5jaDogZW5hYmxlZCB9O1xuICB9LFxufTtcbiIsICJpbXBvcnQgeyBTRVRUSU5HU19JUENfQ0hBTk5FTFMgfSBmcm9tICcuL2lwYy1jb250cmFjdCc7XG5pbXBvcnQgeyBzZXR0aW5nc0FwaSB9IGZyb20gJy4vc2V0dGluZ3MtYXBpJztcbmltcG9ydCB0eXBlIHtcbiAgQ29ubmVjdEN1c3RvbVByb3ZpZGVySW5wdXQsXG4gIENvbm5lY3RQcm92aWRlcklucHV0LFxuICBEaXNjb25uZWN0UHJvdmlkZXJJbnB1dCxcbiAgTW9kZWxTZXR0aW5nc1Jlc3BvbnNlLFxuICBQcm92aWRlclNldHRpbmdzUmVzcG9uc2UsXG4gIFJlZnJlc2hQcm92aWRlck1vZGVsc0lucHV0LFxuICBSZWZyZXNoUHJvdmlkZXJNb2RlbHNSZXN1bHQsXG4gIFNldERlZmF1bHRNb2RlbElucHV0LFxuICBTZXR0aW5nc0FwaUZhaWx1cmUsXG4gIFNldHRpbmdzQXBpUmVzdWx0LFxuICBUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dCxcbiAgVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQsXG4gIFVwZGF0ZVByb3ZpZGVyQ29ubmVjdGlvbklucHV0LFxuICBaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbixcbiAgQXBwU2V0dGluZ3MsXG4gIFNldEF1dG9MYXVuY2hJbnB1dCxcbn0gZnJvbSAnLi90eXBlcyc7XG5cbmludGVyZmFjZSBJcGNNYWluTGlrZSB7XG4gIGhhbmRsZShjaGFubmVsOiBzdHJpbmcsIGxpc3RlbmVyOiAoX2V2ZW50OiB1bmtub3duLCBwYXlsb2FkPzogdW5rbm93bikgPT4gUHJvbWlzZTx1bmtub3duPik6IHZvaWQ7XG59XG5cbnR5cGUgU2V0dGluZ3NIYW5kbGVyUmVzdWx0TWFwID0ge1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldFByb3ZpZGVyU2V0dGluZ3NdOiBTZXR0aW5nc0FwaVJlc3VsdDxQcm92aWRlclNldHRpbmdzUmVzcG9uc2U+O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmNvbm5lY3RQcm92aWRlcl06IFNldHRpbmdzQXBpUmVzdWx0PFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uPjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5jb25uZWN0Q3VzdG9tUHJvdmlkZXJdOiBTZXR0aW5nc0FwaVJlc3VsdDxaZXJvQ2xhd1Byb3ZpZGVyQ29ubmVjdGlvbj47XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuZGlzY29ubmVjdFByb3ZpZGVyXTogU2V0dGluZ3NBcGlSZXN1bHQ8eyBvazogdHJ1ZSB9PjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRNb2RlbFNldHRpbmdzXTogU2V0dGluZ3NBcGlSZXN1bHQ8TW9kZWxTZXR0aW5nc1Jlc3BvbnNlPjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5zZXREZWZhdWx0TW9kZWxdOiBTZXR0aW5nc0FwaVJlc3VsdDx7IG9rOiB0cnVlIH0+O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnRvZ2dsZVByb3ZpZGVyRW5hYmxlZF06IFNldHRpbmdzQXBpUmVzdWx0PHsgb2s6IHRydWUgfT47XG4gIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlTW9kZWxFbmFibGVkXTogU2V0dGluZ3NBcGlSZXN1bHQ8eyBvazogdHJ1ZSB9PjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5yZWZyZXNoUHJvdmlkZXJNb2RlbHNdOiBTZXR0aW5nc0FwaVJlc3VsdDxSZWZyZXNoUHJvdmlkZXJNb2RlbHNSZXN1bHQ+O1xuICBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnVwZGF0ZVByb3ZpZGVyQ29ubmVjdGlvbl06IFNldHRpbmdzQXBpUmVzdWx0PFplcm9DbGF3UHJvdmlkZXJDb25uZWN0aW9uPjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRBcHBTZXR0aW5nc106IFNldHRpbmdzQXBpUmVzdWx0PEFwcFNldHRpbmdzPjtcbiAgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5zZXRBdXRvTGF1bmNoXTogU2V0dGluZ3NBcGlSZXN1bHQ8QXBwU2V0dGluZ3M+O1xufTtcblxudHlwZSBTZXR0aW5nc0hhbmRsZXJzID0ge1xuICBbSyBpbiBrZXlvZiBTZXR0aW5nc0hhbmRsZXJSZXN1bHRNYXBdOiAoXG4gICAgcGF5bG9hZD86IHVua25vd24sXG4gICkgPT4gUHJvbWlzZTxTZXR0aW5nc0hhbmRsZXJSZXN1bHRNYXBbS10+O1xufTtcblxuZnVuY3Rpb24gdG9GYWlsdXJlKGVycm9yOiB1bmtub3duKTogU2V0dGluZ3NBcGlGYWlsdXJlIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2s6IGZhbHNlLFxuICAgICAgZXJyb3I6IHtcbiAgICAgICAgY29kZTogJ0lOVEVSTkFMX0VSUk9SJyxcbiAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgb2s6IGZhbHNlLFxuICAgIGVycm9yOiB7XG4gICAgICBjb2RlOiAnSU5URVJOQUxfRVJST1InLFxuICAgICAgbWVzc2FnZTogJ1x1NjcyQVx1NzdFNVx1OTUxOVx1OEJFRlx1MzAwMicsXG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gdG9TdWNjZXNzPFQ+KGRhdGE6IFQpOiBTZXR0aW5nc0FwaVJlc3VsdDxUPiB7XG4gIHJldHVybiB7XG4gICAgb2s6IHRydWUsXG4gICAgZGF0YSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXNDb25uZWN0UHJvdmlkZXJJbnB1dChwYXlsb2FkOiB1bmtub3duKTogQ29ubmVjdFByb3ZpZGVySW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjb25uZWN0UHJvdmlkZXIgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBDb25uZWN0UHJvdmlkZXJJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNDb25uZWN0Q3VzdG9tUHJvdmlkZXJJbnB1dChwYXlsb2FkOiB1bmtub3duKTogQ29ubmVjdEN1c3RvbVByb3ZpZGVySW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjb25uZWN0Q3VzdG9tUHJvdmlkZXIgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBDb25uZWN0Q3VzdG9tUHJvdmlkZXJJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNEaXNjb25uZWN0UHJvdmlkZXJJbnB1dChwYXlsb2FkOiB1bmtub3duKTogRGlzY29ubmVjdFByb3ZpZGVySW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdkaXNjb25uZWN0UHJvdmlkZXIgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBEaXNjb25uZWN0UHJvdmlkZXJJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNTZXREZWZhdWx0TW9kZWxJbnB1dChwYXlsb2FkOiB1bmtub3duKTogU2V0RGVmYXVsdE1vZGVsSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzZXREZWZhdWx0TW9kZWwgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBTZXREZWZhdWx0TW9kZWxJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNUb2dnbGVQcm92aWRlckVuYWJsZWRJbnB1dChwYXlsb2FkOiB1bmtub3duKTogVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd0b2dnbGVQcm92aWRlckVuYWJsZWQgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBUb2dnbGVQcm92aWRlckVuYWJsZWRJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dChwYXlsb2FkOiB1bmtub3duKTogVG9nZ2xlTW9kZWxFbmFibGVkSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd0b2dnbGVNb2RlbEVuYWJsZWQgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBUb2dnbGVNb2RlbEVuYWJsZWRJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNSZWZyZXNoUHJvdmlkZXJNb2RlbHNJbnB1dChwYXlsb2FkOiB1bmtub3duKTogUmVmcmVzaFByb3ZpZGVyTW9kZWxzSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdyZWZyZXNoUHJvdmlkZXJNb2RlbHMgXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBSZWZyZXNoUHJvdmlkZXJNb2RlbHNJbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dChwYXlsb2FkOiB1bmtub3duKTogVXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd1cGRhdGVQcm92aWRlckNvbm5lY3Rpb24gXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBVcGRhdGVQcm92aWRlckNvbm5lY3Rpb25JbnB1dDtcbn1cblxuZnVuY3Rpb24gYXNTZXRBdXRvTGF1bmNoSW5wdXQocGF5bG9hZDogdW5rbm93bik6IFNldEF1dG9MYXVuY2hJbnB1dCB7XG4gIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NldEF1dG9MYXVuY2ggXHU4QkY3XHU2QzQyXHU1M0MyXHU2NTcwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBXHUzMDAyJyk7XG4gIH1cblxuICByZXR1cm4gcGF5bG9hZCBhcyBTZXRBdXRvTGF1bmNoSW5wdXQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTZXR0aW5nc0lwY0hhbmRsZXJzKCk6IFNldHRpbmdzSGFuZGxlcnMge1xuICByZXR1cm4ge1xuICAgIGFzeW5jIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuZ2V0UHJvdmlkZXJTZXR0aW5nc10oKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgc2V0dGluZ3NBcGkuZ2V0UHJvdmlkZXJzKCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5jb25uZWN0UHJvdmlkZXJdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBpbnB1dCA9IGFzQ29ubmVjdFByb3ZpZGVySW5wdXQocGF5bG9hZCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzZXR0aW5nc0FwaS5jb25uZWN0UHJvdmlkZXIoaW5wdXQpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuY29ubmVjdEN1c3RvbVByb3ZpZGVyXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBhc0Nvbm5lY3RDdXN0b21Qcm92aWRlcklucHV0KHBheWxvYWQpO1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgc2V0dGluZ3NBcGkuY29ubmVjdEN1c3RvbVByb3ZpZGVyKGlucHV0KTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmRpc2Nvbm5lY3RQcm92aWRlcl0ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gYXNEaXNjb25uZWN0UHJvdmlkZXJJbnB1dChwYXlsb2FkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLmRpc2Nvbm5lY3RQcm92aWRlcihpbnB1dCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRNb2RlbFNldHRpbmdzXSgpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzZXR0aW5nc0FwaS5nZXRNb2RlbHMoKTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnNldERlZmF1bHRNb2RlbF0ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gYXNTZXREZWZhdWx0TW9kZWxJbnB1dChwYXlsb2FkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLnNldERlZmF1bHRNb2RlbChpbnB1dCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy50b2dnbGVQcm92aWRlckVuYWJsZWRdKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBpbnB1dCA9IGFzVG9nZ2xlUHJvdmlkZXJFbmFibGVkSW5wdXQocGF5bG9hZCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzZXR0aW5nc0FwaS50b2dnbGVQcm92aWRlckVuYWJsZWQoaW5wdXQpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlTW9kZWxFbmFibGVkXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBhc1RvZ2dsZU1vZGVsRW5hYmxlZElucHV0KHBheWxvYWQpO1xuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgc2V0dGluZ3NBcGkudG9nZ2xlTW9kZWxFbmFibGVkKGlucHV0KTtcbiAgICAgICAgcmV0dXJuIHRvU3VjY2VzcyhkYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybiB0b0ZhaWx1cmUoZXJyb3IpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhc3luYyBbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnJlZnJlc2hQcm92aWRlck1vZGVsc10ocGF5bG9hZD86IHVua25vd24pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gYXNSZWZyZXNoUHJvdmlkZXJNb2RlbHNJbnB1dChwYXlsb2FkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLnJlZnJlc2hQcm92aWRlck1vZGVscyhpbnB1dCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy51cGRhdGVQcm92aWRlckNvbm5lY3Rpb25dKHBheWxvYWQ/OiB1bmtub3duKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBpbnB1dCA9IGFzVXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uSW5wdXQocGF5bG9hZCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBzZXR0aW5nc0FwaS51cGRhdGVQcm92aWRlckNvbm5lY3Rpb24oaW5wdXQpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFzeW5jIFtTRVRUSU5HU19JUENfQ0hBTk5FTFMuZ2V0QXBwU2V0dGluZ3NdKCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLmdldEFwcFNldHRpbmdzKCk7XG4gICAgICAgIHJldHVybiB0b1N1Y2Nlc3MoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICByZXR1cm4gdG9GYWlsdXJlKGVycm9yKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYXN5bmMgW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5zZXRBdXRvTGF1bmNoXShwYXlsb2FkPzogdW5rbm93bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBhc1NldEF1dG9MYXVuY2hJbnB1dChwYXlsb2FkKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IHNldHRpbmdzQXBpLnNldEF1dG9MYXVuY2goaW5wdXQpO1xuICAgICAgICByZXR1cm4gdG9TdWNjZXNzKGRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHRvRmFpbHVyZShlcnJvcik7XG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyU2V0dGluZ3NJcGNIYW5kbGVycyhpcGNNYWluTGlrZTogSXBjTWFpbkxpa2UpOiB2b2lkIHtcbiAgY29uc3QgaGFuZGxlcnMgPSBjcmVhdGVTZXR0aW5nc0lwY0hhbmRsZXJzKCk7XG5cbiAgaXBjTWFpbkxpa2UuaGFuZGxlKFNFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRQcm92aWRlclNldHRpbmdzLCBhc3luYyAoKSA9PlxuICAgIGhhbmRsZXJzW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRQcm92aWRlclNldHRpbmdzXSgpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoU0VUVElOR1NfSVBDX0NIQU5ORUxTLmNvbm5lY3RQcm92aWRlciwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMuY29ubmVjdFByb3ZpZGVyXShwYXlsb2FkKSxcbiAgKTtcbiAgaXBjTWFpbkxpa2UuaGFuZGxlKFNFVFRJTkdTX0lQQ19DSEFOTkVMUy5jb25uZWN0Q3VzdG9tUHJvdmlkZXIsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+XG4gICAgaGFuZGxlcnNbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmNvbm5lY3RDdXN0b21Qcm92aWRlcl0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShTRVRUSU5HU19JUENfQ0hBTk5FTFMuZGlzY29ubmVjdFByb3ZpZGVyLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5kaXNjb25uZWN0UHJvdmlkZXJdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldE1vZGVsU2V0dGluZ3MsIGFzeW5jICgpID0+XG4gICAgaGFuZGxlcnNbU0VUVElOR1NfSVBDX0NIQU5ORUxTLmdldE1vZGVsU2V0dGluZ3NdKCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShTRVRUSU5HU19JUENfQ0hBTk5FTFMuc2V0RGVmYXVsdE1vZGVsLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5zZXREZWZhdWx0TW9kZWxdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoU0VUVElOR1NfSVBDX0NIQU5ORUxTLnRvZ2dsZVByb3ZpZGVyRW5hYmxlZCwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMudG9nZ2xlUHJvdmlkZXJFbmFibGVkXShwYXlsb2FkKSxcbiAgKTtcbiAgaXBjTWFpbkxpa2UuaGFuZGxlKFNFVFRJTkdTX0lQQ19DSEFOTkVMUy50b2dnbGVNb2RlbEVuYWJsZWQsIGFzeW5jIChfZXZlbnQsIHBheWxvYWQpID0+XG4gICAgaGFuZGxlcnNbU0VUVElOR1NfSVBDX0NIQU5ORUxTLnRvZ2dsZU1vZGVsRW5hYmxlZF0ocGF5bG9hZCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShTRVRUSU5HU19JUENfQ0hBTk5FTFMucmVmcmVzaFByb3ZpZGVyTW9kZWxzLCBhc3luYyAoX2V2ZW50LCBwYXlsb2FkKSA9PlxuICAgIGhhbmRsZXJzW1NFVFRJTkdTX0lQQ19DSEFOTkVMUy5yZWZyZXNoUHJvdmlkZXJNb2RlbHNdKHBheWxvYWQpLFxuICApO1xuICBpcGNNYWluTGlrZS5oYW5kbGUoU0VUVElOR1NfSVBDX0NIQU5ORUxTLnVwZGF0ZVByb3ZpZGVyQ29ubmVjdGlvbiwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMudXBkYXRlUHJvdmlkZXJDb25uZWN0aW9uXShwYXlsb2FkKSxcbiAgKTtcbiAgaXBjTWFpbkxpa2UuaGFuZGxlKFNFVFRJTkdTX0lQQ19DSEFOTkVMUy5nZXRBcHBTZXR0aW5ncywgYXN5bmMgKCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMuZ2V0QXBwU2V0dGluZ3NdKCksXG4gICk7XG4gIGlwY01haW5MaWtlLmhhbmRsZShTRVRUSU5HU19JUENfQ0hBTk5FTFMuc2V0QXV0b0xhdW5jaCwgYXN5bmMgKF9ldmVudCwgcGF5bG9hZCkgPT5cbiAgICBoYW5kbGVyc1tTRVRUSU5HU19JUENfQ0hBTk5FTFMuc2V0QXV0b0xhdW5jaF0ocGF5bG9hZCksXG4gICk7XG59XG4iLCAiaW1wb3J0IHsgQnJvd3NlcldpbmRvdywgZGlhbG9nLCBpcGNNYWluIH0gZnJvbSAnZWxlY3Ryb24nO1xuaW1wb3J0IHR5cGUgeyBJcGNNYWluSW52b2tlRXZlbnQgfSBmcm9tICdlbGVjdHJvbic7XG5pbXBvcnQge1xuICBnZXRBbGxTa2lsbHMsXG4gIGRlbGV0ZVNraWxsLFxuICBpbXBvcnRTa2lsbEZyb21Gb2xkZXIsXG4gIGdldEFsbE1jcFNlcnZlcnMsXG4gIGNyZWF0ZU1jcFNlcnZlcixcbiAgaW1wb3J0TWNwU2VydmVycyxcbiAgZGVsZXRlTWNwU2VydmVyLFxuICB1cGRhdGVNY3BTZXJ2ZXJTdGF0ZSxcbn0gZnJvbSAnLi9za2lsbHMtbWNwLXNlcnZpY2UnO1xuaW1wb3J0IHtcbiAgU0tJTExTX01DUF9DSEFOTkVMUyxcbiAgdHlwZSBTa2lsbFNjb3BlSW5wdXQsXG4gIHR5cGUgU2tpbGxEZWxldGVJbnB1dCxcbiAgdHlwZSBTa2lsbEltcG9ydElucHV0LFxuICB0eXBlIE1jcFNlcnZlckNvbmZpZyxcbiAgdHlwZSBNY3BTZXJ2ZXJTY29wZUlucHV0LFxuICB0eXBlIE1jcFNlcnZlckRlbGV0ZUlucHV0LFxuICB0eXBlIE1jcFNlcnZlclVwZGF0ZUlucHV0LFxuICB0eXBlIE1jcFNlcnZlckNyZWF0ZUlucHV0LFxuICB0eXBlIE1jcFNlcnZlckltcG9ydElucHV0LFxufSBmcm9tICcuL3NraWxscy1tY3AtdHlwZXMnO1xuXG5mdW5jdGlvbiB0b1NraWxsU2NvcGUocGF5bG9hZD86IHVua25vd24pOiBTa2lsbFNjb3BlSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG4gIGNvbnN0IHJlY29yZCA9IHBheWxvYWQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIHJldHVybiB7XG4gICAgYWdlbnRJZDogdHlwZW9mIHJlY29yZC5hZ2VudElkID09PSAnc3RyaW5nJyA/IHJlY29yZC5hZ2VudElkIDogdW5kZWZpbmVkLFxuICAgIGhvbWVEaXJPdmVycmlkZTogdHlwZW9mIHJlY29yZC5ob21lRGlyT3ZlcnJpZGUgPT09ICdzdHJpbmcnID8gcmVjb3JkLmhvbWVEaXJPdmVycmlkZSA6IHVuZGVmaW5lZCxcbiAgfTtcbn1cblxuZnVuY3Rpb24gdG9NY3BTY29wZShwYXlsb2FkPzogdW5rbm93bik6IE1jcFNlcnZlclNjb3BlSW5wdXQge1xuICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG4gIGNvbnN0IHJlY29yZCA9IHBheWxvYWQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIHJldHVybiB7XG4gICAgYWdlbnRJZDogdHlwZW9mIHJlY29yZC5hZ2VudElkID09PSAnc3RyaW5nJyA/IHJlY29yZC5hZ2VudElkIDogdW5kZWZpbmVkLFxuICAgIGhvbWVEaXJPdmVycmlkZTogdHlwZW9mIHJlY29yZC5ob21lRGlyT3ZlcnJpZGUgPT09ICdzdHJpbmcnID8gcmVjb3JkLmhvbWVEaXJPdmVycmlkZSA6IHVuZGVmaW5lZCxcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT0gSVBDIEhhbmRsZXJzID09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogXHU1MjFCXHU1RUZBIFNraWxscyBcdTU0OEMgTUNQIFx1NzY4NCBJUEMgaGFuZGxlcnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVNraWxsc01jcElwY0hhbmRsZXJzKCkge1xuICByZXR1cm4ge1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09IFNraWxscyA9PT09PT09PT09PT09PT09PT09PVxuXG4gICAgW1NLSUxMU19NQ1BfQ0hBTk5FTFMuU0tJTExTX0xJU1RdOiBhc3luYyAoX2V2ZW50OiBJcGNNYWluSW52b2tlRXZlbnQsIHBheWxvYWQ/OiBTa2lsbFNjb3BlSW5wdXQpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBnZXRBbGxTa2lsbHModG9Ta2lsbFNjb3BlKHBheWxvYWQpKTtcbiAgICB9LFxuXG4gICAgW1NLSUxMU19NQ1BfQ0hBTk5FTFMuU0tJTExTX0RFTEVURV06IGFzeW5jIChfZXZlbnQ6IElwY01haW5JbnZva2VFdmVudCwgcGF5bG9hZDogU2tpbGxEZWxldGVJbnB1dCB8IHN0cmluZykgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBwYXlsb2FkID09PSAnc3RyaW5nJykge1xuICAgICAgICByZXR1cm4gYXdhaXQgZGVsZXRlU2tpbGwocGF5bG9hZCwge30pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGF3YWl0IGRlbGV0ZVNraWxsKHBheWxvYWQuc2tpbGxJZCwgdG9Ta2lsbFNjb3BlKHBheWxvYWQpKTtcbiAgICB9LFxuXG4gICAgW1NLSUxMU19NQ1BfQ0hBTk5FTFMuU0tJTExTX1JFRlJFU0hdOiBhc3luYyAoX2V2ZW50OiBJcGNNYWluSW52b2tlRXZlbnQsIHBheWxvYWQ/OiBTa2lsbFNjb3BlSW5wdXQpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBnZXRBbGxTa2lsbHModG9Ta2lsbFNjb3BlKHBheWxvYWQpKTtcbiAgICB9LFxuXG4gICAgW1NLSUxMU19NQ1BfQ0hBTk5FTFMuU0tJTExTX0lNUE9SVF06IGFzeW5jIChcbiAgICAgIGV2ZW50OiBJcGNNYWluSW52b2tlRXZlbnQsXG4gICAgICBpbnB1dD86IFNraWxsSW1wb3J0SW5wdXQsXG4gICAgKSA9PiB7XG4gICAgICBjb25zdCBzY29wZSA9IHRvU2tpbGxTY29wZShpbnB1dCk7XG4gICAgICBsZXQgc291cmNlUGF0aCA9IGlucHV0Py5zb3VyY2VQYXRoO1xuICAgICAgaWYgKCFzb3VyY2VQYXRoKSB7XG4gICAgICAgIGNvbnN0IGJyb3dzZXJXaW5kb3cgPSBCcm93c2VyV2luZG93LmZyb21XZWJDb250ZW50cyhldmVudC5zZW5kZXIpO1xuICAgICAgICBjb25zdCByZXN1bHQgPSBicm93c2VyV2luZG93XG4gICAgICAgICAgPyBhd2FpdCBkaWFsb2cuc2hvd09wZW5EaWFsb2coYnJvd3NlcldpbmRvdywgeyBwcm9wZXJ0aWVzOiBbJ29wZW5EaXJlY3RvcnknXSB9KVxuICAgICAgICAgIDogYXdhaXQgZGlhbG9nLnNob3dPcGVuRGlhbG9nKHsgcHJvcGVydGllczogWydvcGVuRGlyZWN0b3J5J10gfSk7XG4gICAgICAgIGlmIChyZXN1bHQuY2FuY2VsZWQgfHwgcmVzdWx0LmZpbGVQYXRocy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NURGMlx1NTNENlx1NkQ4OCcgfTtcbiAgICAgICAgfVxuICAgICAgICBzb3VyY2VQYXRoID0gcmVzdWx0LmZpbGVQYXRoc1swXTtcbiAgICAgIH1cbiAgICAgIGlmICghc291cmNlUGF0aCkge1xuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NjcyQVx1OTAwOVx1NjJFOVx1OERFRlx1NUY4NCcgfTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBhd2FpdCBpbXBvcnRTa2lsbEZyb21Gb2xkZXIoc291cmNlUGF0aCwgc2NvcGUpO1xuICAgIH0sXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBNQ1AgPT09PT09PT09PT09PT09PT09PT1cblxuICAgIFtTS0lMTFNfTUNQX0NIQU5ORUxTLk1DUF9MSVNUXTogYXN5bmMgKF9ldmVudDogSXBjTWFpbkludm9rZUV2ZW50LCBwYXlsb2FkPzogTWNwU2VydmVyU2NvcGVJbnB1dCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGdldEFsbE1jcFNlcnZlcnModG9NY3BTY29wZShwYXlsb2FkKSk7XG4gICAgfSxcblxuICAgIFtTS0lMTFNfTUNQX0NIQU5ORUxTLk1DUF9DUkVBVEVdOiBhc3luYyAoXG4gICAgICBfZXZlbnQ6IElwY01haW5JbnZva2VFdmVudCxcbiAgICAgIHBheWxvYWQ6IE1jcFNlcnZlckNyZWF0ZUlucHV0ICYgTWNwU2VydmVyU2NvcGVJbnB1dCxcbiAgICApID0+IHtcbiAgICAgIGNvbnN0IHsgYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlLCAuLi5pbnB1dCB9ID0gcGF5bG9hZDtcbiAgICAgIHJldHVybiBhd2FpdCBjcmVhdGVNY3BTZXJ2ZXIoaW5wdXQsIHsgYWdlbnRJZCwgaG9tZURpck92ZXJyaWRlIH0pO1xuICAgIH0sXG5cbiAgICBbU0tJTExTX01DUF9DSEFOTkVMUy5NQ1BfSU1QT1JUXTogYXN5bmMgKFxuICAgICAgX2V2ZW50OiBJcGNNYWluSW52b2tlRXZlbnQsXG4gICAgICBpbnB1dDogTWNwU2VydmVySW1wb3J0SW5wdXQsXG4gICAgKSA9PiB7XG4gICAgICBjb25zdCB7IGFnZW50SWQsIGhvbWVEaXJPdmVycmlkZSwgLi4ucmVzdCB9ID0gaW5wdXQ7XG4gICAgICByZXR1cm4gYXdhaXQgaW1wb3J0TWNwU2VydmVycyhyZXN0IGFzIE1jcFNlcnZlckltcG9ydElucHV0LCB7IGFnZW50SWQsIGhvbWVEaXJPdmVycmlkZSB9KTtcbiAgICB9LFxuXG4gICAgW1NLSUxMU19NQ1BfQ0hBTk5FTFMuTUNQX0RFTEVURV06IGFzeW5jIChcbiAgICAgIF9ldmVudDogSXBjTWFpbkludm9rZUV2ZW50LFxuICAgICAgcGF5bG9hZDogTWNwU2VydmVyRGVsZXRlSW5wdXQgfCBzdHJpbmcsXG4gICAgKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIHBheWxvYWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBkZWxldGVNY3BTZXJ2ZXIocGF5bG9hZCwge30pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGF3YWl0IGRlbGV0ZU1jcFNlcnZlcihwYXlsb2FkLnNlcnZlcklkLCB0b01jcFNjb3BlKHBheWxvYWQpKTtcbiAgICB9LFxuXG4gICAgW1NLSUxMU19NQ1BfQ0hBTk5FTFMuTUNQX1VQREFURV06IGFzeW5jIChcbiAgICAgIF9ldmVudDogSXBjTWFpbkludm9rZUV2ZW50LFxuICAgICAgcGF5bG9hZDogTWNwU2VydmVyVXBkYXRlSW5wdXQgfCB7IHNlcnZlcklkOiBzdHJpbmc7IHVwZGF0ZXM6IFBhcnRpYWw8TWNwU2VydmVyQ29uZmlnPiB9XG4gICAgKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdXBkYXRlTWNwU2VydmVyU3RhdGUocGF5bG9hZC5zZXJ2ZXJJZCwgcGF5bG9hZC51cGRhdGVzLCB0b01jcFNjb3BlKHBheWxvYWQpKTtcbiAgICB9LFxuXG4gICAgW1NLSUxMU19NQ1BfQ0hBTk5FTFMuTUNQX1JFRlJFU0hdOiBhc3luYyAoX2V2ZW50OiBJcGNNYWluSW52b2tlRXZlbnQsIHBheWxvYWQ/OiBNY3BTZXJ2ZXJTY29wZUlucHV0KSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgZ2V0QWxsTWNwU2VydmVycyh0b01jcFNjb3BlKHBheWxvYWQpKTtcbiAgICB9LFxuICB9O1xufVxuXG4vKipcbiAqIFx1NkNFOFx1NTE4QyBTa2lsbHMgXHU1NDhDIE1DUCBcdTc2ODQgSVBDIGhhbmRsZXJzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlclNraWxsc01jcElwY0hhbmRsZXJzKCkge1xuICBjb25zdCBoYW5kbGVycyA9IGNyZWF0ZVNraWxsc01jcElwY0hhbmRsZXJzKCk7XG5cbiAgT2JqZWN0LmVudHJpZXMoaGFuZGxlcnMpLmZvckVhY2goKFtjaGFubmVsLCBoYW5kbGVyXSkgPT4ge1xuICAgIGlwY01haW4uaGFuZGxlKGNoYW5uZWwsIGhhbmRsZXIgYXMgYW55KTtcbiAgfSk7XG5cbiAgY29uc29sZS5sb2coJ1tTa2lsbHMtTUNQXSBJUEMgaGFuZGxlcnMgXHU1REYyXHU2Q0U4XHU1MThDJyk7XG59XG4iLCAiaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNwLCByZWFkRmlsZSwgcmVhZGRpciwgcm0sIHN0YXQsIG1rZGlyLCB3cml0ZUZpbGUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcblxuaW1wb3J0IHsgZW5zdXJlU2hhcmVkV29ya3NwYWNlIH0gZnJvbSAnLi9zaGFyZWQtd29ya3NwYWNlLW1hbmFnZXInO1xuaW1wb3J0IHR5cGUge1xuICBTa2lsbEl0ZW0sXG4gIE1jcFNlcnZlckNvbmZpZyxcbiAgU2tpbGxNZXRhZGF0YSxcbiAgU2tpbGxJbXBvcnRSZXN1bHQsXG4gIFNraWxsU2NvcGVJbnB1dCxcbiAgTWNwU2VydmVyQ3JlYXRlSW5wdXQsXG4gIE1jcFNlcnZlckNyZWF0ZVJlc3VsdCxcbiAgTWNwU2VydmVySW1wb3J0SW5wdXQsXG4gIE1jcFNlcnZlckltcG9ydFJlc3VsdCxcbiAgTWNwU2VydmVyRGVsZXRlUmVzdWx0LFxuICBNY3BTZXJ2ZXJTY29wZUlucHV0LFxufSBmcm9tICcuL3NraWxscy1tY3AtdHlwZXMnO1xuXG5jb25zdCBTS0lMTF9GSUxFX0NBTkRJREFURVMgPSBbJ1NLSUxMUy5tZCcsICdTS0lMTC5tZCcsICdza2lsbHMubWQnLCAnc2tpbGwubWQnXSBhcyBjb25zdDtcblxuZnVuY3Rpb24gcGFyc2VGcm9udG1hdHRlcihjb250ZW50OiBzdHJpbmcpOiBQYXJ0aWFsPFNraWxsTWV0YWRhdGE+IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gY29udGVudC5tYXRjaCgvXi0tLVxccyooW1xcc1xcU10qPylcXHMqLS0tLyk7XG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICBjb25zdCBsaW5lcyA9IG1hdGNoWzFdLnNwbGl0KCdcXG4nKTtcbiAgY29uc3QgbWV0YWRhdGE6IFBhcnRpYWw8U2tpbGxNZXRhZGF0YT4gPSB7fTtcblxuICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBlbnRyeSA9IHRyaW1tZWQubWF0Y2goL14oXFx3Kyk6XFxzKiguKykkLyk7XG4gICAgaWYgKCFlbnRyeSkgY29udGludWU7XG4gICAgY29uc3QgWywga2V5LCB2YWx1ZV0gPSBlbnRyeTtcbiAgICBpZiAoa2V5ID09PSAnbmFtZScpIG1ldGFkYXRhLm5hbWUgPSB2YWx1ZTtcbiAgICBpZiAoa2V5ID09PSAnZGVzY3JpcHRpb24nKSBtZXRhZGF0YS5kZXNjcmlwdGlvbiA9IHZhbHVlO1xuICAgIGlmIChrZXkgPT09ICdsb2NhdGlvbicpIG1ldGFkYXRhLmxvY2F0aW9uID0gdmFsdWU7XG4gIH1cblxuICByZXR1cm4gbWV0YWRhdGE7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU2tpbGxGaWxlQ29udGVudChjb250ZW50OiBzdHJpbmcsIGZhbGxiYWNrTmFtZTogc3RyaW5nLCBmYWxsYmFja0xvY2F0aW9uOiBzdHJpbmcpOiBTa2lsbE1ldGFkYXRhIHtcbiAgY29uc3QgZnJvbnRtYXR0ZXIgPSBwYXJzZUZyb250bWF0dGVyKGNvbnRlbnQpO1xuICBpZiAoZnJvbnRtYXR0ZXI/Lm5hbWUgJiYgZnJvbnRtYXR0ZXI/LmRlc2NyaXB0aW9uKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWU6IGZyb250bWF0dGVyLm5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogZnJvbnRtYXR0ZXIuZGVzY3JpcHRpb24sXG4gICAgICBsb2NhdGlvbjogZnJvbnRtYXR0ZXIubG9jYXRpb24gPz8gZmFsbGJhY2tMb2NhdGlvbixcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgbGluZXMgPSBjb250ZW50XG4gICAgLnNwbGl0KC9cXHI/XFxuLylcbiAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xuXG4gIGNvbnN0IHRpdGxlTGluZSA9IGxpbmVzLmZpbmQoKGxpbmUpID0+IGxpbmUuc3RhcnRzV2l0aCgnIycpKSA/PyBsaW5lc1swXTtcbiAgY29uc3QgbmFtZSA9IHRpdGxlTGluZSA/IHRpdGxlTGluZS5yZXBsYWNlKC9eIytcXHMqLywgJycpIDogZmFsbGJhY2tOYW1lO1xuICBjb25zdCBkZXNjcmlwdGlvbiA9IGxpbmVzLmZpbmQoKGxpbmUpID0+IGxpbmUgIT09IHRpdGxlTGluZSkgPz8gJ1x1NjcyQVx1NTg2Qlx1NTE5OVx1NjNDRlx1OEZGMCc7XG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBuYW1lIHx8IGZhbGxiYWNrTmFtZSxcbiAgICBkZXNjcmlwdGlvbixcbiAgICBsb2NhdGlvbjogZmFsbGJhY2tMb2NhdGlvbixcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVNraWxsTWV0YWRhdGEoXG4gIGZvbGRlclBhdGg6IHN0cmluZyxcbiAgZm9sZGVyTmFtZTogc3RyaW5nLFxuICBmYWxsYmFja0xvY2F0aW9uOiBzdHJpbmcsXG4pOiBQcm9taXNlPFNraWxsTWV0YWRhdGEgfCBudWxsPiB7XG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIFNLSUxMX0ZJTEVfQ0FORElEQVRFUykge1xuICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5qb2luKGZvbGRlclBhdGgsIGNhbmRpZGF0ZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04Jyk7XG4gICAgICByZXR1cm4gcGFyc2VTa2lsbEZpbGVDb250ZW50KGNvbnRlbnQsIGZvbGRlck5hbWUsIGZhbGxiYWNrTG9jYXRpb24pO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gaWdub3JlXG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiBlbnN1cmVEaXJlY3RvcnkoZGlyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IG1rZGlyKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpc0RpcmVjdG9yeSh0YXJnZXRQYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBpbmZvID0gYXdhaXQgc3RhdCh0YXJnZXRQYXRoKTtcbiAgICByZXR1cm4gaW5mby5pc0RpcmVjdG9yeSgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZnVuY3Rpb24gY3JlYXRlU2tpbGxJZChmb2xkZXJOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gZm9sZGVyTmFtZS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU2tpbGxJZChza2lsbElkOiBzdHJpbmcpOiB7IGZvbGRlck5hbWU6IHN0cmluZyB9IHtcbiAgY29uc3QgdHJpbW1lZCA9IHNraWxsSWQudHJpbSgpO1xuICBjb25zdCBtYXRjaCA9IHRyaW1tZWQubWF0Y2goL14oPzphcHB8c2hhcmVkfGdsb2JhbHxhZ2VudCk6KC4rKSQvKTtcbiAgaWYgKG1hdGNoPy5bMV0pIHtcbiAgICByZXR1cm4geyBmb2xkZXJOYW1lOiBtYXRjaFsxXS50cmltKCkgfTtcbiAgfVxuICByZXR1cm4geyBmb2xkZXJOYW1lOiB0cmltbWVkIH07XG59XG5cbmZ1bmN0aW9uIGJ1aWxkRmFsbGJhY2tMb2NhdGlvbihmb2xkZXJOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcGF0aC5qb2luKCdza2lsbHMnLCBmb2xkZXJOYW1lKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVNraWxsc1Jvb3Qoc2NvcGU/OiBTa2lsbFNjb3BlSW5wdXQpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBzaGFyZWQgPSBhd2FpdCBlbnN1cmVTaGFyZWRXb3Jrc3BhY2Uoc2NvcGU/LmhvbWVEaXJPdmVycmlkZSk7XG4gIGF3YWl0IGVuc3VyZURpcmVjdG9yeShzaGFyZWQuc2hhcmVkU2tpbGxzUm9vdCk7XG4gIHJldHVybiBzaGFyZWQuc2hhcmVkU2tpbGxzUm9vdDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZU1jcFN0b3JhZ2VQYXRoKHNjb3BlPzogTWNwU2VydmVyU2NvcGVJbnB1dCk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHNoYXJlZCA9IGF3YWl0IGVuc3VyZVNoYXJlZFdvcmtzcGFjZShzY29wZT8uaG9tZURpck92ZXJyaWRlKTtcbiAgYXdhaXQgZW5zdXJlRGlyZWN0b3J5KHNoYXJlZC5zaGFyZWRNY3BSb290KTtcbiAgcmV0dXJuIHBhdGguam9pbihzaGFyZWQuc2hhcmVkTWNwUm9vdCwgJ3NlcnZlcnMuanNvbicpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWFkU2tpbGxzRnJvbVJvb3Qoc2tpbGxzUm9vdDogc3RyaW5nKTogUHJvbWlzZTxTa2lsbEl0ZW1bXT4ge1xuICBjb25zdCBlbnRyaWVzID0gYXdhaXQgcmVhZGRpcihza2lsbHNSb290LCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gIGNvbnN0IHNraWxsczogU2tpbGxJdGVtW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGZvbGRlck5hbWUgPSBlbnRyeS5uYW1lO1xuICAgIGNvbnN0IGZvbGRlclBhdGggPSBwYXRoLmpvaW4oc2tpbGxzUm9vdCwgZm9sZGVyTmFtZSk7XG4gICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCByZXNvbHZlU2tpbGxNZXRhZGF0YShmb2xkZXJQYXRoLCBmb2xkZXJOYW1lLCBidWlsZEZhbGxiYWNrTG9jYXRpb24oZm9sZGVyTmFtZSkpO1xuICAgIGlmICghbWV0YWRhdGEpIGNvbnRpbnVlO1xuICAgIHNraWxscy5wdXNoKHtcbiAgICAgIGlkOiBjcmVhdGVTa2lsbElkKGZvbGRlck5hbWUpLFxuICAgICAgbWV0YWRhdGEsXG4gICAgICBwYXRoOiBmb2xkZXJQYXRoLFxuICAgICAgaXNTeXN0ZW06IGZhbHNlLFxuICAgICAgaXNOZXc6IGZhbHNlLFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHNraWxscztcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2FmZVJlYWRTa2lsbHNGcm9tUm9vdChza2lsbHNSb290OiBzdHJpbmcpOiBQcm9taXNlPFNraWxsSXRlbVtdPiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IHJlYWRTa2lsbHNGcm9tUm9vdChza2lsbHNSb290KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVVbmlxdWVGb2xkZXJOYW1lKGJhc2VOYW1lOiBzdHJpbmcsIHJvb3Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRCYXNlID0gYmFzZU5hbWUudHJpbSgpLnJlcGxhY2UoL1tcXFxcLzoqP1wiPD58XS9nLCAnXycpIHx8ICdza2lsbCc7XG4gIGxldCBjYW5kaWRhdGUgPSBub3JtYWxpemVkQmFzZTtcbiAgbGV0IGluZGV4ID0gMTtcbiAgd2hpbGUgKGF3YWl0IGlzRGlyZWN0b3J5KHBhdGguam9pbihyb290LCBjYW5kaWRhdGUpKSkge1xuICAgIGNhbmRpZGF0ZSA9IGAke25vcm1hbGl6ZWRCYXNlfS0ke2luZGV4fWA7XG4gICAgaW5kZXggKz0gMTtcbiAgfVxuICByZXR1cm4gY2FuZGlkYXRlO1xufVxuXG5mdW5jdGlvbiBzbHVnaWZ5SWQoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBpbnB1dFxuICAgIC50cmltKClcbiAgICAudG9Mb3dlckNhc2UoKVxuICAgIC5yZXBsYWNlKC9bXmEtejAtOS1fXSsvZywgJy0nKVxuICAgIC5yZXBsYWNlKC9eLSt8LSskL2csICcnKTtcbiAgcmV0dXJuIG5vcm1hbGl6ZWQubGVuZ3RoID4gMCA/IG5vcm1hbGl6ZWQgOiAnbWNwLXNlcnZlcic7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZVVuaXF1ZUlkKGJhc2VJZDogc3RyaW5nLCBleGlzdGluZzogUmVhZG9ubHlTZXQ8c3RyaW5nPik6IHN0cmluZyB7XG4gIGxldCBjYW5kaWRhdGUgPSBiYXNlSWQ7XG4gIGxldCBpbmRleCA9IDE7XG4gIHdoaWxlIChleGlzdGluZy5oYXMoY2FuZGlkYXRlKSkge1xuICAgIGNhbmRpZGF0ZSA9IGAke2Jhc2VJZH0tJHtpbmRleH1gO1xuICAgIGluZGV4ICs9IDE7XG4gIH1cbiAgcmV0dXJuIGNhbmRpZGF0ZTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTWNwVHlwZSh0eXBlPzogc3RyaW5nKTogTWNwU2VydmVyQ29uZmlnWyd0eXBlJ10ge1xuICBpZiAodHlwZSA9PT0gJ3NzZScgfHwgdHlwZSA9PT0gJ3N0cmVhbWFibGVIdHRwJyB8fCB0eXBlID09PSAnc3RkaW8nKSB7XG4gICAgcmV0dXJuIHR5cGU7XG4gIH1cbiAgcmV0dXJuICdzdGRpbyc7XG59XG5cbmZ1bmN0aW9uIHRvU2FmZVJlY29yZChpbnB1dD86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFpbnB1dCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKGlucHV0KS5maWx0ZXIoXG4gICAgKFtrZXksIHZhbHVlXSkgPT4ga2V5LnRyaW0oKS5sZW5ndGggPiAwICYmIHZhbHVlLnRyaW0oKS5sZW5ndGggPiAwLFxuICApO1xuICBpZiAoZW50cmllcy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoZW50cmllcyk7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZU1jcElucHV0KGlucHV0OiBNY3BTZXJ2ZXJDcmVhdGVJbnB1dCk6IE9taXQ8TWNwU2VydmVyQ29uZmlnLCAnaWQnPiB7XG4gIGNvbnN0IG5hbWUgPSBpbnB1dC5uYW1lLnRyaW0oKTtcblxuICByZXR1cm4ge1xuICAgIG5hbWU6IG5hbWUubGVuZ3RoID4gMCA/IG5hbWUgOiAnTUNQIFNlcnZlcicsXG4gICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgdW5kZWZpbmVkLFxuICAgIHR5cGU6IG5vcm1hbGl6ZU1jcFR5cGUoaW5wdXQudHlwZSksXG4gICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCA/PyB0cnVlLFxuICAgIHBhdGg6IGlucHV0LnBhdGg/LnRyaW0oKSB8fCB1bmRlZmluZWQsXG4gICAgY29tbWFuZDogaW5wdXQuY29tbWFuZD8udHJpbSgpIHx8IHVuZGVmaW5lZCxcbiAgICBhcmdzOiBpbnB1dC5hcmdzPy5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0udHJpbSgpLmxlbmd0aCA+IDApLFxuICAgIGVudjogdG9TYWZlUmVjb3JkKGlucHV0LmVudiksXG4gICAgdXJsOiBpbnB1dC51cmw/LnRyaW0oKSB8fCB1bmRlZmluZWQsXG4gICAgaGVhZGVyczogdG9TYWZlUmVjb3JkKGlucHV0LmhlYWRlcnMpLFxuICAgIGxvbmdSdW5uaW5nOiBpbnB1dC5sb25nUnVubmluZyxcbiAgICB0aW1lb3V0OiB0eXBlb2YgaW5wdXQudGltZW91dCA9PT0gJ251bWJlcicgJiYgTnVtYmVyLmlzRmluaXRlKGlucHV0LnRpbWVvdXQpID8gaW5wdXQudGltZW91dCA6IHVuZGVmaW5lZCxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVhZE1jcFNlcnZlcnMoc2NvcGU/OiBNY3BTZXJ2ZXJTY29wZUlucHV0KTogUHJvbWlzZTxNY3BTZXJ2ZXJDb25maWdbXT4ge1xuICBjb25zdCBzdG9yYWdlUGF0aCA9IGF3YWl0IHJlc29sdmVNY3BTdG9yYWdlUGF0aChzY29wZSk7XG4gIHRyeSB7XG4gICAgY29uc3QgcmF3ID0gYXdhaXQgcmVhZEZpbGUoc3RvcmFnZVBhdGgsICd1dGYtOCcpO1xuICAgIGNvbnN0IHBheWxvYWQgPSBKU09OLnBhcnNlKHJhdykgYXMgdW5rbm93bjtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwYXlsb2FkKSkge1xuICAgICAgcmV0dXJuIHBheWxvYWQuZmlsdGVyKChpdGVtKTogaXRlbSBpcyBNY3BTZXJ2ZXJDb25maWcgPT4gdHlwZW9mIGl0ZW0gPT09ICdvYmplY3QnICYmIGl0ZW0gIT09IG51bGwpO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZU1jcFNlcnZlcnMoc2NvcGU6IE1jcFNlcnZlclNjb3BlSW5wdXQsIHNlcnZlcnM6IE1jcFNlcnZlckNvbmZpZ1tdKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IHN0b3JhZ2VQYXRoID0gYXdhaXQgcmVzb2x2ZU1jcFN0b3JhZ2VQYXRoKHNjb3BlKTtcbiAgYXdhaXQgd3JpdGVGaWxlKHN0b3JhZ2VQYXRoLCBKU09OLnN0cmluZ2lmeShzZXJ2ZXJzLCBudWxsLCAyKSwgJ3V0Zi04Jyk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBwYXJzZU1jcEltcG9ydFBheWxvYWQoaW5wdXQ6IE1jcFNlcnZlckltcG9ydElucHV0KTogTWNwU2VydmVyQ3JlYXRlSW5wdXRbXSB7XG4gIGNvbnN0IHJhdyA9IGlucHV0Lmpzb24udHJpbSgpO1xuICBpZiAoIXJhdykgcmV0dXJuIFtdO1xuICBjb25zdCBwYXlsb2FkID0gSlNPTi5wYXJzZShyYXcpIGFzIHVua25vd247XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkocGF5bG9hZCkpIHtcbiAgICByZXR1cm4gcGF5bG9hZC5maWx0ZXIoKGl0ZW0pOiBpdGVtIGlzIE1jcFNlcnZlckNyZWF0ZUlucHV0ID0+IHR5cGVvZiBpdGVtID09PSAnb2JqZWN0JyAmJiBpdGVtICE9PSBudWxsKTtcbiAgfVxuXG4gIGlmIChwYXlsb2FkICYmIHR5cGVvZiBwYXlsb2FkID09PSAnb2JqZWN0Jykge1xuICAgIGNvbnN0IHJlY29yZCA9IHBheWxvYWQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgY29uc3QgbWF5YmVBcnJheSA9IHJlY29yZC5zZXJ2ZXJzID8/IHJlY29yZC5tY3BTZXJ2ZXJzID8/IHJlY29yZC5pdGVtcztcbiAgICBpZiAoQXJyYXkuaXNBcnJheShtYXliZUFycmF5KSkge1xuICAgICAgcmV0dXJuIG1heWJlQXJyYXkuZmlsdGVyKChpdGVtKTogaXRlbSBpcyBNY3BTZXJ2ZXJDcmVhdGVJbnB1dCA9PiB0eXBlb2YgaXRlbSA9PT0gJ29iamVjdCcgJiYgaXRlbSAhPT0gbnVsbCk7XG4gICAgfVxuICAgIHJldHVybiBbcmVjb3JkIGFzIHVua25vd24gYXMgTWNwU2VydmVyQ3JlYXRlSW5wdXRdO1xuICB9XG5cbiAgcmV0dXJuIFtdO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PSBTa2lsbHMgXHU2NzBEXHU1MkExID09PT09PT09PT09PT09PT09PT09XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRBbGxTa2lsbHMoc2NvcGU/OiBTa2lsbFNjb3BlSW5wdXQpOiBQcm9taXNlPFNraWxsSXRlbVtdPiB7XG4gIGNvbnN0IHNraWxsc1Jvb3QgPSBhd2FpdCByZXNvbHZlU2tpbGxzUm9vdChzY29wZSk7XG4gIGNvbnN0IHNraWxscyA9IGF3YWl0IHNhZmVSZWFkU2tpbGxzRnJvbVJvb3Qoc2tpbGxzUm9vdCk7XG4gIHJldHVybiBza2lsbHMuc29ydCgoYSwgYikgPT4gYS5tZXRhZGF0YS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5tZXRhZGF0YS5uYW1lKSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVTa2lsbChcbiAgc2tpbGxJZDogc3RyaW5nLFxuICBzY29wZT86IFNraWxsU2NvcGVJbnB1dCxcbik6IFByb21pc2U8eyBzdWNjZXNzOiBib29sZWFuOyBtZXNzYWdlPzogc3RyaW5nIH0+IHtcbiAgY29uc3Qgc2tpbGxzUm9vdCA9IGF3YWl0IHJlc29sdmVTa2lsbHNSb290KHNjb3BlKTtcblxuICBjb25zdCB7IGZvbGRlck5hbWUgfSA9IHBhcnNlU2tpbGxJZChza2lsbElkKTtcbiAgY29uc3QgdGFyZ2V0UGF0aCA9IHBhdGguam9pbihza2lsbHNSb290LCBmb2xkZXJOYW1lKTtcblxuICBpZiAoIShhd2FpdCBpc0RpcmVjdG9yeSh0YXJnZXRQYXRoKSkpIHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogYFx1NjI4MFx1ODBGRCBcIiR7Zm9sZGVyTmFtZX1cIiBcdTRFMERcdTVCNThcdTU3MjhgIH07XG4gIH1cblxuICBhd2FpdCBybSh0YXJnZXRQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG1lc3NhZ2U6IGBcdTYyODBcdTgwRkQgXCIke2ZvbGRlck5hbWV9XCIgXHU1REYyXHU1MjIwXHU5NjY0YCB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaW1wb3J0U2tpbGxGcm9tRm9sZGVyKFxuICBzb3VyY2VQYXRoOiBzdHJpbmcsXG4gIHNjb3BlPzogU2tpbGxTY29wZUlucHV0LFxuKTogUHJvbWlzZTxTa2lsbEltcG9ydFJlc3VsdD4ge1xuICBjb25zdCBza2lsbHNSb290ID0gYXdhaXQgcmVzb2x2ZVNraWxsc1Jvb3Qoc2NvcGUpO1xuXG4gIGNvbnN0IGZvbGRlck5hbWUgPSBwYXRoLmJhc2VuYW1lKHNvdXJjZVBhdGgpO1xuICBjb25zdCB0YXJnZXROYW1lID0gYXdhaXQgcmVzb2x2ZVVuaXF1ZUZvbGRlck5hbWUoZm9sZGVyTmFtZSwgc2tpbGxzUm9vdCk7XG4gIGNvbnN0IHRhcmdldFBhdGggPSBwYXRoLmpvaW4oc2tpbGxzUm9vdCwgdGFyZ2V0TmFtZSk7XG5cbiAgYXdhaXQgY3Aoc291cmNlUGF0aCwgdGFyZ2V0UGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgcmVzb2x2ZVNraWxsTWV0YWRhdGEodGFyZ2V0UGF0aCwgdGFyZ2V0TmFtZSwgYnVpbGRGYWxsYmFja0xvY2F0aW9uKHRhcmdldE5hbWUpKTtcblxuICByZXR1cm4ge1xuICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgbWVzc2FnZTogJ1x1NUJGQ1x1NTE2NVx1NjIxMFx1NTI5RicsXG4gICAgc2tpbGw6IG1ldGFkYXRhXG4gICAgICA/IHtcbiAgICAgICAgICBpZDogY3JlYXRlU2tpbGxJZCh0YXJnZXROYW1lKSxcbiAgICAgICAgICBtZXRhZGF0YSxcbiAgICAgICAgICBwYXRoOiB0YXJnZXRQYXRoLFxuICAgICAgICAgIGlzU3lzdGVtOiBmYWxzZSxcbiAgICAgICAgICBpc05ldzogdHJ1ZSxcbiAgICAgICAgfVxuICAgICAgOiB1bmRlZmluZWQsXG4gIH07XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09IE1DUCBcdTY3MERcdTUyQTEgPT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldEFsbE1jcFNlcnZlcnMoc2NvcGU/OiBNY3BTZXJ2ZXJTY29wZUlucHV0KTogUHJvbWlzZTxNY3BTZXJ2ZXJDb25maWdbXT4ge1xuICByZXR1cm4gYXdhaXQgcmVhZE1jcFNlcnZlcnMoc2NvcGUpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBkYXRlTWNwU2VydmVyU3RhdGUoXG4gIHNlcnZlcklkOiBzdHJpbmcsXG4gIHVwZGF0ZXM6IFBhcnRpYWw8TWNwU2VydmVyQ29uZmlnPixcbiAgc2NvcGU/OiBNY3BTZXJ2ZXJTY29wZUlucHV0LFxuKTogUHJvbWlzZTx7IHN1Y2Nlc3M6IGJvb2xlYW47IG1lc3NhZ2U/OiBzdHJpbmcgfT4ge1xuICBjb25zdCBzZXJ2ZXJzID0gYXdhaXQgcmVhZE1jcFNlcnZlcnMoc2NvcGUpO1xuICBjb25zdCB0YXJnZXRJbmRleCA9IHNlcnZlcnMuZmluZEluZGV4KChpdGVtKSA9PiBpdGVtLmlkID09PSBzZXJ2ZXJJZCk7XG4gIGlmICh0YXJnZXRJbmRleCA8IDApIHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogYE1DUCBcdTY3MERcdTUyQTFcdTU2NjggXCIke3NlcnZlcklkfVwiIFx1NEUwRFx1NUI1OFx1NTcyOGAgfTtcbiAgfVxuXG4gIGNvbnN0IGN1cnJlbnQgPSBzZXJ2ZXJzW3RhcmdldEluZGV4XTtcbiAgY29uc3QgdXBkYXRlZDogTWNwU2VydmVyQ29uZmlnID0ge1xuICAgIC4uLmN1cnJlbnQsXG4gICAgLi4udXBkYXRlcyxcbiAgICB0eXBlOiB1cGRhdGVzLnR5cGUgPyBub3JtYWxpemVNY3BUeXBlKHVwZGF0ZXMudHlwZSkgOiBjdXJyZW50LnR5cGUsXG4gICAgbmFtZTogdXBkYXRlcy5uYW1lPy50cmltKCkgfHwgY3VycmVudC5uYW1lLFxuICB9O1xuICBzZXJ2ZXJzW3RhcmdldEluZGV4XSA9IHVwZGF0ZWQ7XG4gIGNvbnN0IHdyaXR0ZW4gPSBhd2FpdCB3cml0ZU1jcFNlcnZlcnMoc2NvcGUgPz8ge30sIHNlcnZlcnMpO1xuICBpZiAoIXdyaXR0ZW4pIHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NEZERFx1NUI1OCBNQ1AgXHU5MTREXHU3RjZFXHU1OTMxXHU4RDI1XHUzMDAyJyB9O1xuICB9XG5cbiAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbWVzc2FnZTogJ1x1NjZGNFx1NjVCMFx1NjIxMFx1NTI5RicgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZU1jcFNlcnZlcihcbiAgaW5wdXQ6IE1jcFNlcnZlckNyZWF0ZUlucHV0LFxuICBzY29wZT86IE1jcFNlcnZlclNjb3BlSW5wdXQsXG4pOiBQcm9taXNlPE1jcFNlcnZlckNyZWF0ZVJlc3VsdD4ge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplTWNwSW5wdXQoaW5wdXQpO1xuICBpZiAoIW5vcm1hbGl6ZWQubmFtZSkge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiAnXHU1NDBEXHU3OUYwXHU0RTBEXHU4MEZEXHU0RTNBXHU3QTdBJyB9O1xuICB9XG5cbiAgY29uc3Qgc2VydmVycyA9IGF3YWl0IHJlYWRNY3BTZXJ2ZXJzKHNjb3BlKTtcbiAgY29uc3QgZXhpc3RpbmcgPSBuZXcgU2V0KHNlcnZlcnMubWFwKChpdGVtKSA9PiBpdGVtLmlkKSk7XG4gIGNvbnN0IGJhc2VJZCA9IHNsdWdpZnlJZChub3JtYWxpemVkLm5hbWUpO1xuICBjb25zdCBpZCA9IGVuc3VyZVVuaXF1ZUlkKGJhc2VJZCwgZXhpc3RpbmcpO1xuXG4gIGNvbnN0IHNlcnZlcjogTWNwU2VydmVyQ29uZmlnID0ge1xuICAgIGlkLFxuICAgIC4uLm5vcm1hbGl6ZWQsXG4gIH07XG5cbiAgc2VydmVycy5wdXNoKHNlcnZlcik7XG4gIGNvbnN0IHdyaXR0ZW4gPSBhd2FpdCB3cml0ZU1jcFNlcnZlcnMoc2NvcGUgPz8ge30sIHNlcnZlcnMpO1xuICBpZiAoIXdyaXR0ZW4pIHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NEZERFx1NUI1OCBNQ1AgXHU5MTREXHU3RjZFXHU1OTMxXHU4RDI1XHUzMDAyJyB9O1xuICB9XG5cbiAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgc2VydmVyIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVNY3BTZXJ2ZXIoXG4gIHNlcnZlcklkOiBzdHJpbmcsXG4gIHNjb3BlPzogTWNwU2VydmVyU2NvcGVJbnB1dCxcbik6IFByb21pc2U8TWNwU2VydmVyRGVsZXRlUmVzdWx0PiB7XG4gIGNvbnN0IHNlcnZlcnMgPSBhd2FpdCByZWFkTWNwU2VydmVycyhzY29wZSk7XG4gIGNvbnN0IG5leHQgPSBzZXJ2ZXJzLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5pZCAhPT0gc2VydmVySWQpO1xuICBpZiAobmV4dC5sZW5ndGggPT09IHNlcnZlcnMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6IGBNQ1AgXHU2NzBEXHU1MkExXHU1NjY4IFwiJHtzZXJ2ZXJJZH1cIiBcdTRFMERcdTVCNThcdTU3MjhgIH07XG4gIH1cbiAgY29uc3Qgd3JpdHRlbiA9IGF3YWl0IHdyaXRlTWNwU2VydmVycyhzY29wZSA/PyB7fSwgbmV4dCk7XG4gIGlmICghd3JpdHRlbikge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiAnXHU0RkREXHU1QjU4IE1DUCBcdTkxNERcdTdGNkVcdTU5MzFcdThEMjVcdTMwMDInIH07XG4gIH1cbiAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaW1wb3J0TWNwU2VydmVycyhcbiAgaW5wdXQ6IE1jcFNlcnZlckltcG9ydElucHV0LFxuICBzY29wZT86IE1jcFNlcnZlclNjb3BlSW5wdXQsXG4pOiBQcm9taXNlPE1jcFNlcnZlckltcG9ydFJlc3VsdD4ge1xuICB0cnkge1xuICAgIGNvbnN0IGluY29taW5nID0gcGFyc2VNY3BJbXBvcnRQYXlsb2FkKGlucHV0KTtcbiAgICBpZiAoaW5jb21pbmcubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NjcyQVx1ODlFM1x1Njc5MFx1NTIzMFx1NjcwOVx1NjU0OFx1NzY4NCBNQ1AgXHU5MTREXHU3RjZFJyB9O1xuICAgIH1cblxuICAgIGNvbnN0IHNlcnZlcnMgPSBhd2FpdCByZWFkTWNwU2VydmVycyhzY29wZSk7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBuZXcgU2V0KHNlcnZlcnMubWFwKChpdGVtKSA9PiBpdGVtLmlkKSk7XG4gICAgbGV0IGNvdW50ID0gMDtcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgaW5jb21pbmcpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVNY3BJbnB1dChlbnRyeSk7XG4gICAgICBjb25zdCBiYXNlSWQgPSBzbHVnaWZ5SWQobm9ybWFsaXplZC5uYW1lKTtcbiAgICAgIGNvbnN0IGlkID0gZW5zdXJlVW5pcXVlSWQoYmFzZUlkLCBleGlzdGluZyk7XG4gICAgICBleGlzdGluZy5hZGQoaWQpO1xuICAgICAgc2VydmVycy5wdXNoKHtcbiAgICAgICAgaWQsXG4gICAgICAgIC4uLm5vcm1hbGl6ZWQsXG4gICAgICB9KTtcbiAgICAgIGNvdW50ICs9IDE7XG4gICAgfVxuXG4gICAgY29uc3Qgd3JpdHRlbiA9IGF3YWl0IHdyaXRlTWNwU2VydmVycyhzY29wZSA/PyB7fSwgc2VydmVycyk7XG4gICAgaWYgKCF3cml0dGVuKSB7XG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NEZERFx1NUI1OCBNQ1AgXHU5MTREXHU3RjZFXHU1OTMxXHU4RDI1XHUzMDAyJyB9O1xuICAgIH1cbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBjb3VudCB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdcdTVCRkNcdTUxNjVcdTU5MzFcdThEMjUnIH07XG4gIH1cbn1cbiIsICIvLyA9PT09PT09PT09PT09PT09PT09PSBUeXBlcyA9PT09PT09PT09PT09PT09PT09PVxuXG4vKiogU2tpbGwgXHU1MTQzXHU2NTcwXHU2MzZFICovXG5leHBvcnQgaW50ZXJmYWNlIFNraWxsTWV0YWRhdGEge1xuICBuYW1lOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIGxvY2F0aW9uOiBzdHJpbmc7XG59XG5cbi8qKiBTa2lsbCBcdTY1ODdcdTRFRjZcdTRGRTFcdTYwNkYgKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2tpbGxJdGVtIHtcbiAgaWQ6IHN0cmluZzsgICAgICAgICAgLy8gXHU2MjgwXHU4MEZEXHU2ODA3XHU4QkM2XHVGRjA4XHU1M0VGXHU4MEZEXHU1MzA1XHU1NDJCXHU2NzY1XHU2RTkwXHU1MjREXHU3RjAwXHVGRjA5XG4gIG1ldGFkYXRhOiBTa2lsbE1ldGFkYXRhO1xuICBwYXRoOiBzdHJpbmc7ICAgICAgICAgLy8gXHU1QjhDXHU2NTc0XHU4REVGXHU1Rjg0XG4gIGlzU3lzdGVtOiBib29sZWFuOyAgICAvLyBcdTY2MkZcdTU0MjZcdTRFM0FcdTdDRkJcdTdFREZcdTYyODBcdTgwRkRcbiAgaXNOZXc6IGJvb2xlYW47ICAgICAgIC8vIFx1NjYyRlx1NTQyNlx1NEUzQVx1NjVCMFx1NUJGQ1x1NTE2NVxufVxuXG4vKiogU2tpbGwgXHU1QkZDXHU1MTY1XHU4RjkzXHU1MTY1ICovXG5leHBvcnQgaW50ZXJmYWNlIFNraWxsSW1wb3J0SW5wdXQge1xuICBzb3VyY2VQYXRoPzogc3RyaW5nO1xuICBhZ2VudElkPzogc3RyaW5nO1xuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2tpbGxTY29wZUlucHV0IHtcbiAgYWdlbnRJZD86IHN0cmluZztcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNraWxsRGVsZXRlSW5wdXQgZXh0ZW5kcyBTa2lsbFNjb3BlSW5wdXQge1xuICBza2lsbElkOiBzdHJpbmc7XG59XG5cbi8qKiBTa2lsbCBcdTVCRkNcdTUxNjVcdTdFRDNcdTY3OUMgKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2tpbGxJbXBvcnRSZXN1bHQge1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBtZXNzYWdlPzogc3RyaW5nO1xuICBza2lsbD86IFNraWxsSXRlbTtcbn1cblxuLyoqIE1DUCBcdTY3MERcdTUyQTFcdTU2NjhcdTkxNERcdTdGNkUgKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWNwU2VydmVyQ29uZmlnIHtcbiAgaWQ6IHN0cmluZzsgICAgICAgICAgIC8vIFx1NjcwRFx1NTJBMVx1NTY2OCBJRFxuICBuYW1lOiBzdHJpbmc7ICAgICAgICAgLy8gXHU2NjNFXHU3OTNBXHU1NDBEXHU3OUYwXG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nOyAvLyBcdTYzQ0ZcdThGRjBcbiAgdHlwZTogJ3N0ZGlvJyB8ICdzc2UnIHwgJ3N0cmVhbWFibGVIdHRwJyB8IHN0cmluZzsgLy8gXHU3QzdCXHU1NzhCXG4gIGVuYWJsZWQ6IGJvb2xlYW47ICAgICAvLyBcdTY2MkZcdTU0MjZcdTU0MkZcdTc1MjhcbiAgcGF0aD86IHN0cmluZzsgICAgICAgIC8vIFx1NjcyQ1x1NTczMFx1OERFRlx1NUY4NFx1RkYwOFx1NTk4Mlx1Njc5Q1x1NjYyRlx1NjcyQ1x1NTczMFx1NjVFN1x1NzI0OFx1RkYwOVxuICBjb21tYW5kPzogc3RyaW5nOyAgICAgLy8gXHU1NDJGXHU1MkE4XHU1NDdEXHU0RUU0IChzdGRpbylcbiAgYXJncz86IHN0cmluZ1tdOyAgICAgIC8vIFx1NTQyRlx1NTJBOFx1NTNDMlx1NjU3MCAoc3RkaW8pXG4gIGVudj86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47IC8vIFx1NzNBRlx1NTg4M1x1NTNEOFx1OTFDRiAoc3RkaW8pXG4gIHVybD86IHN0cmluZzsgICAgICAgICAvLyBVUkwgKHNzZS9zdHJlYW1hYmxlSHR0cClcbiAgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47IC8vIFx1OEJGN1x1NkM0Mlx1NTkzNCAoc3RyZWFtYWJsZUh0dHApXG4gIGxvbmdSdW5uaW5nPzogYm9vbGVhbjsgLy8gXHU5NTdGXHU2NUY2XHU5NUY0XHU4RkQwXHU4ODRDXHU2QTIxXHU1RjBGXG4gIHRpbWVvdXQ/OiBudW1iZXI7ICAgICAgLy8gXHU4RDg1XHU2NUY2XHU2NUY2XHU5NUY0XHVGRjA4XHU3OUQyXHVGRjA5XG59XG5cbi8qKiBNQ1AgXHU1MjFCXHU1RUZBXHU4RjkzXHU1MTY1ICovXG5leHBvcnQgaW50ZXJmYWNlIE1jcFNlcnZlckNyZWF0ZUlucHV0IHtcbiAgbmFtZTogc3RyaW5nO1xuICB0eXBlOiBNY3BTZXJ2ZXJDb25maWdbJ3R5cGUnXTtcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG4gIGVuYWJsZWQ/OiBib29sZWFuO1xuICBwYXRoPzogc3RyaW5nO1xuICBjb21tYW5kPzogc3RyaW5nO1xuICBhcmdzPzogc3RyaW5nW107XG4gIGVudj86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIHVybD86IHN0cmluZztcbiAgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIGxvbmdSdW5uaW5nPzogYm9vbGVhbjtcbiAgdGltZW91dD86IG51bWJlcjtcbn1cblxuLyoqIE1DUCBcdTUyMUJcdTVFRkFcdTdFRDNcdTY3OUMgKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWNwU2VydmVyQ3JlYXRlUmVzdWx0IHtcbiAgc3VjY2VzczogYm9vbGVhbjtcbiAgbWVzc2FnZT86IHN0cmluZztcbiAgc2VydmVyPzogTWNwU2VydmVyQ29uZmlnO1xufVxuXG4vKiogTUNQIFx1NUJGQ1x1NTE2NVx1OEY5M1x1NTE2NSAqL1xuZXhwb3J0IGludGVyZmFjZSBNY3BTZXJ2ZXJJbXBvcnRJbnB1dCB7XG4gIGpzb246IHN0cmluZztcbiAgYWdlbnRJZD86IHN0cmluZztcbiAgaG9tZURpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1jcFNlcnZlclNjb3BlSW5wdXQge1xuICBhZ2VudElkPzogc3RyaW5nO1xuICBob21lRGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWNwU2VydmVyRGVsZXRlSW5wdXQgZXh0ZW5kcyBNY3BTZXJ2ZXJTY29wZUlucHV0IHtcbiAgc2VydmVySWQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBNY3BTZXJ2ZXJVcGRhdGVJbnB1dCBleHRlbmRzIE1jcFNlcnZlclNjb3BlSW5wdXQge1xuICBzZXJ2ZXJJZDogc3RyaW5nO1xuICB1cGRhdGVzOiBQYXJ0aWFsPE1jcFNlcnZlckNvbmZpZz47XG59XG5cbi8qKiBNQ1AgXHU1QkZDXHU1MTY1XHU3RUQzXHU2NzlDICovXG5leHBvcnQgaW50ZXJmYWNlIE1jcFNlcnZlckltcG9ydFJlc3VsdCB7XG4gIHN1Y2Nlc3M6IGJvb2xlYW47XG4gIG1lc3NhZ2U/OiBzdHJpbmc7XG4gIGNvdW50PzogbnVtYmVyO1xufVxuXG4vKiogTUNQIFx1NTIyMFx1OTY2NFx1N0VEM1x1Njc5QyAqL1xuZXhwb3J0IGludGVyZmFjZSBNY3BTZXJ2ZXJEZWxldGVSZXN1bHQge1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBtZXNzYWdlPzogc3RyaW5nO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PSBTY2hlbWFzID09PT09PT09PT09PT09PT09PT09XG4vLyAoVW51c2VkKVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PSBJUEMgQ2hhbm5lbHMgPT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNvbnN0IFNLSUxMU19NQ1BfQ0hBTk5FTFMgPSB7XG4gIC8vIFNraWxsc1xuICBTS0lMTFNfTElTVDogJ3NraWxscy1tY3A6bGlzdC1za2lsbHMnLFxuICBTS0lMTFNfREVMRVRFOiAnc2tpbGxzLW1jcDpkZWxldGUtc2tpbGwnLFxuICBTS0lMTFNfUkVGUkVTSDogJ3NraWxscy1tY3A6cmVmcmVzaC1za2lsbHMnLFxuICBTS0lMTFNfSU1QT1JUOiAnc2tpbGxzLW1jcDppbXBvcnQtc2tpbGwnLFxuXG4gIC8vIE1DUFxuICBNQ1BfTElTVDogJ3NraWxscy1tY3A6bGlzdC1tY3AnLFxuICBNQ1BfQ1JFQVRFOiAnc2tpbGxzLW1jcDpjcmVhdGUtbWNwJyxcbiAgTUNQX0lNUE9SVDogJ3NraWxscy1tY3A6aW1wb3J0LW1jcCcsXG4gIE1DUF9ERUxFVEU6ICdza2lsbHMtbWNwOmRlbGV0ZS1tY3AnLFxuICBNQ1BfVVBEQVRFOiAnc2tpbGxzLW1jcDp1cGRhdGUtbWNwJyxcbiAgTUNQX1JFRlJFU0g6ICdza2lsbHMtbWNwOnJlZnJlc2gtbWNwJyxcbn0gYXMgY29uc3Q7XG4iLCAiaW1wb3J0IHsgaXBjTWFpbiB9IGZyb20gJ2VsZWN0cm9uJztcbmltcG9ydCB0eXBlIHsgSXBjTWFpbkludm9rZUV2ZW50IH0gZnJvbSAnZWxlY3Ryb24nO1xuaW1wb3J0IHsgTElWRTJEX0lQQ19DSEFOTkVMUyB9IGZyb20gJy4vaXBjLWNvbnRyYWN0JztcbmltcG9ydCB7XG4gICAgaW1wb3J0TGl2ZTJkTW9kZWwsXG4gICAgbGlzdExpdmUyZE1vZGVscyxcbiAgICBzYXZlTGl2ZTJkQ29uZmlnLFxuICAgIGRvd25sb2FkR2l0aHViTGl2ZTJkTW9kZWxcbn0gZnJvbSAnLi9saXZlMmQtc2VydmljZSc7XG5pbXBvcnQgdHlwZSB7IFNhdmVMaXZlMmRDb25maWdJbnB1dCB9IGZyb20gJy4vdHlwZXMnO1xuXHJcbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlckxpdmUyZElwY0hhbmRsZXJzKCkge1xyXG4gICAgaXBjTWFpbi5oYW5kbGUoTElWRTJEX0lQQ19DSEFOTkVMUy5pbXBvcnRNb2RlbCwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBpbXBvcnRMaXZlMmRNb2RlbCgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXBjTWFpbi5oYW5kbGUoTElWRTJEX0lQQ19DSEFOTkVMUy5saXN0TW9kZWxzLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGxpc3RMaXZlMmRNb2RlbHMoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGlwY01haW4uaGFuZGxlKExJVkUyRF9JUENfQ0hBTk5FTFMuc2F2ZUNvbmZpZywgYXN5bmMgKF9ldmVudDogSXBjTWFpbkludm9rZUV2ZW50LCBwYXlsb2FkOiBTYXZlTGl2ZTJkQ29uZmlnSW5wdXQpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHNhdmVMaXZlMmRDb25maWcocGF5bG9hZCk7XG4gICAgfSk7XG5cbiAgICBpcGNNYWluLmhhbmRsZShMSVZFMkRfSVBDX0NIQU5ORUxTLmRvd25sb2FkR2l0aHViLCBhc3luYyAoX2V2ZW50OiBJcGNNYWluSW52b2tlRXZlbnQsIHBheWxvYWQ6IHsgdXJsOiBzdHJpbmcgfSkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgZG93bmxvYWRHaXRodWJMaXZlMmRNb2RlbChwYXlsb2FkLnVybCk7XG4gICAgfSk7XG59XG4iLCAiaW1wb3J0IHsgZGlhbG9nIH0gZnJvbSAnZWxlY3Ryb24nO1xyXG5pbXBvcnQgZnMgZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XHJcbmltcG9ydCBmc3MgZnJvbSAnbm9kZTpmcyc7XHJcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XHJcblxyXG5pbXBvcnQgeyBlbnN1cmVTaGFyZWRXb3Jrc3BhY2UgfSBmcm9tICcuL3NoYXJlZC13b3Jrc3BhY2UtbWFuYWdlcic7XHJcbmltcG9ydCB0eXBlIHtcclxuICAgIEltcG9ydExpdmUyZE1vZGVsUmVzdWx0LFxyXG4gICAgTGl2ZTJkTW9kZWxDb25maWcsXHJcbiAgICBTYXZlTGl2ZTJkQ29uZmlnSW5wdXQsXHJcbiAgICBTYXZlTGl2ZTJkQ29uZmlnUmVzdWx0LFxyXG4gICAgTGl2ZTJkTW90aW9uLFxyXG4gICAgTGl2ZTJkRXhwcmVzc2lvbixcclxufSBmcm9tICcuL3R5cGVzJztcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHBhcnNlQW5kQ29tcGxldGVMaXZlMmRDb25maWcoXHJcbiAgICBtb2RlbERpcjogc3RyaW5nLFxyXG4gICAgZm9sZGVyTmFtZTogc3RyaW5nLFxyXG4gICAgbW9kZWxKc29uRmlsZTogc3RyaW5nLFxyXG4pOiBQcm9taXNlPExpdmUyZE1vZGVsQ29uZmlnPiB7XHJcbiAgICBjb25zdCBqc29uUGF0aCA9IHBhdGguam9pbihtb2RlbERpciwgbW9kZWxKc29uRmlsZSk7XHJcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUoanNvblBhdGgsICd1dGY4Jyk7XHJcbiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShjb250ZW50KTtcclxuXHJcbiAgICBjb25zdCBtb3Rpb25zOiBMaXZlMmRNb3Rpb25bXSA9IFtdO1xyXG4gICAgY29uc3QgZXhwcmVzc2lvbnM6IExpdmUyZEV4cHJlc3Npb25bXSA9IFtdO1xyXG5cclxuICAgIC8vIFBhcnNlIG1vdGlvbnNcclxuICAgIGNvbnN0IHJhd01vdGlvbnMgPSBkYXRhLkZpbGVSZWZlcmVuY2VzPy5Nb3Rpb25zIHx8IGRhdGEubW90aW9ucztcclxuICAgIGlmIChyYXdNb3Rpb25zICYmIHR5cGVvZiByYXdNb3Rpb25zID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgIGZvciAoY29uc3QgW2dyb3VwLCBpdGVtc10gb2YgT2JqZWN0LmVudHJpZXMocmF3TW90aW9ucykpIHtcclxuICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoaXRlbXMpKSB7XHJcbiAgICAgICAgICAgICAgICBpdGVtcy5mb3JFYWNoKChpdGVtOiBhbnksIGk6IG51bWJlcikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIG1vdGlvbnMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGdyb3VwLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBTdHJpbmcoaSksIC8vIHN0b3JlIGluZGV4IG9yIHNwZWNpZmljIGtleVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlOiBpdGVtLkZpbGUgfHwgaXRlbS5maWxlIHx8ICcnLFxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGl0ZW1zID09PSAnb2JqZWN0JyAmJiBpdGVtcyAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgLy8gSnVzdCBpbiBjYXNlIGl0J3Mgbm90IGFuIGFycmF5XHJcbiAgICAgICAgICAgICAgICBtb3Rpb25zLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgIGdyb3VwLFxyXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICcwJyxcclxuICAgICAgICAgICAgICAgICAgICBmaWxlOiAoaXRlbXMgYXMgYW55KS5GaWxlIHx8IChpdGVtcyBhcyBhbnkpLmZpbGUgfHwgJycsXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBQYXJzZSBleHByZXNzaW9uc1xyXG4gICAgY29uc3QgcmF3RXhwciA9IGRhdGEuRmlsZVJlZmVyZW5jZXM/LkV4cHJlc3Npb25zIHx8IGRhdGEuZXhwcmVzc2lvbnM7XHJcbiAgICBpZiAoQXJyYXkuaXNBcnJheShyYXdFeHByKSkge1xyXG4gICAgICAgIHJhd0V4cHIuZm9yRWFjaCgoaXRlbTogYW55KSA9PiB7XHJcbiAgICAgICAgICAgIGV4cHJlc3Npb25zLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgbmFtZTogaXRlbS5OYW1lIHx8IGl0ZW0ubmFtZSB8fCAnJyxcclxuICAgICAgICAgICAgICAgIGZpbGU6IGl0ZW0uRmlsZSB8fCBpdGVtLmZpbGUgfHwgJycsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGJhc2VDb25maWc6IExpdmUyZE1vZGVsQ29uZmlnID0ge1xyXG4gICAgICAgIGlkOiBmb2xkZXJOYW1lLFxyXG4gICAgICAgIG5hbWU6IGZvbGRlck5hbWUsXHJcbiAgICAgICAgbW9kZWxKc29uRmlsZSxcclxuICAgICAgICBtb3Rpb25zLFxyXG4gICAgICAgIGV4cHJlc3Npb25zLFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBNZXJnZSB3aXRoIGN1c3RvbSBjb25maWcgaWYgaXQgZXhpc3RzXHJcbiAgICBjb25zdCBjdXN0b21Db25maWdQYXRoID0gcGF0aC5qb2luKG1vZGVsRGlyLCAnbGl2ZTJkX2N1c3RvbV9jb25maWcuanNvbicpO1xyXG4gICAgaWYgKGZzcy5leGlzdHNTeW5jKGN1c3RvbUNvbmZpZ1BhdGgpKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY3VzdG9tQ29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKGN1c3RvbUNvbmZpZ1BhdGgsICd1dGY4Jyk7XHJcbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbURhdGEgPSBKU09OLnBhcnNlKGN1c3RvbUNvbnRlbnQpO1xyXG5cclxuICAgICAgICAgICAgaWYgKGN1c3RvbURhdGEubmFtZSkge1xyXG4gICAgICAgICAgICAgICAgYmFzZUNvbmZpZy5uYW1lID0gY3VzdG9tRGF0YS5uYW1lO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBVcGRhdGUgbW90aW9ucyB3aXRoIHRyYW5zbGF0aW9uc1xyXG4gICAgICAgICAgICBiYXNlQ29uZmlnLm1vdGlvbnMgPSBiYXNlQ29uZmlnLm1vdGlvbnMubWFwKChtKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBmb3VuZCA9IGN1c3RvbURhdGEubW90aW9ucz8uZmluZChcclxuICAgICAgICAgICAgICAgICAgICAoYzogYW55KSA9PiBjLmdyb3VwID09PSBtLmdyb3VwICYmIGMubmFtZSA9PT0gbS5uYW1lLFxyXG4gICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBmb3VuZFxyXG4gICAgICAgICAgICAgICAgICAgID8geyAuLi5tLCBkZXNjcmlwdGlvbkNoOiBmb3VuZC5kZXNjcmlwdGlvbkNoLCBkZXNjcmlwdGlvbkVuOiBmb3VuZC5kZXNjcmlwdGlvbkVuIH1cclxuICAgICAgICAgICAgICAgICAgICA6IG07XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gVXBkYXRlIGV4cHJlc3Npb25zIHdpdGggdHJhbnNsYXRpb25zXHJcbiAgICAgICAgICAgIGJhc2VDb25maWcuZXhwcmVzc2lvbnMgPSBiYXNlQ29uZmlnLmV4cHJlc3Npb25zLm1hcCgoZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZm91bmQgPSBjdXN0b21EYXRhLmV4cHJlc3Npb25zPy5maW5kKChjOiBhbnkpID0+IGMubmFtZSA9PT0gZS5uYW1lKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBmb3VuZFxyXG4gICAgICAgICAgICAgICAgICAgID8geyAuLi5lLCBkZXNjcmlwdGlvbkNoOiBmb3VuZC5kZXNjcmlwdGlvbkNoLCBkZXNjcmlwdGlvbkVuOiBmb3VuZC5kZXNjcmlwdGlvbkVuIH1cclxuICAgICAgICAgICAgICAgICAgICA6IGU7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHBhcnNlIGxpdmUyZF9jdXN0b21fY29uZmlnLmpzb24nLCBlKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGJhc2VDb25maWc7XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpbXBvcnRMaXZlMmRNb2RlbCgpOiBQcm9taXNlPEltcG9ydExpdmUyZE1vZGVsUmVzdWx0PiB7XHJcbiAgICBjb25zdCB7IGZpbGVQYXRocyB9ID0gYXdhaXQgZGlhbG9nLnNob3dPcGVuRGlhbG9nKHtcclxuICAgICAgICB0aXRsZTogJ1NlbGVjdCBMaXZlMkQgTW9kZWwgRm9sZGVyJyxcclxuICAgICAgICBwcm9wZXJ0aWVzOiBbJ29wZW5EaXJlY3RvcnknXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGlmICghZmlsZVBhdGhzIHx8IGZpbGVQYXRocy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NjcyQVx1OTAwOVx1NjJFOVx1NEVGQlx1NEY1NVx1NjU4N1x1NEVGNlx1NTkzOScgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBzb3VyY2VEaXIgPSBmaWxlUGF0aHNbMF07XHJcbiAgICBjb25zdCBmb2xkZXJOYW1lID0gcGF0aC5iYXNlbmFtZShzb3VyY2VEaXIpO1xyXG4gICAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKCk7XHJcbiAgICBjb25zdCB0YXJnZXREaXIgPSBwYXRoLmpvaW4oc2hhcmVkLnNoYXJlZE1vZGVsc1Jvb3QsIGZvbGRlck5hbWUpO1xyXG5cclxuICAgIGlmIChmc3MuZXhpc3RzU3luYyh0YXJnZXREaXIpKSB7XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6ICdcdThCRTVcdTZBMjFcdTU3OEJcdTY1ODdcdTRFRjZcdTU5MzlcdTVERjJcdTVCNThcdTU3MjgnIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ2hlY2sgaWYgbW9kZWwganNvbiBleGlzdHMgYmVmb3JlIGNvcHlpbmdcclxuICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgZnMucmVhZGRpcihzb3VyY2VEaXIpO1xyXG4gICAgY29uc3QgbW9kZWxKc29uRmlsZSA9IGZpbGVzLmZpbmQoXHJcbiAgICAgICAgKGYpID0+IGYuZW5kc1dpdGgoJy5tb2RlbDMuanNvbicpIHx8IGYuZW5kc1dpdGgoJ21vZGVsLmpzb24nKSxcclxuICAgICk7XHJcblxyXG4gICAgaWYgKCFtb2RlbEpzb25GaWxlKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdcdTYyNDBcdTkwMDlcdTY1ODdcdTRFRjZcdTU5MzlcdTRFMkRcdTY3MkFcdTYyN0VcdTUyMzAgbW9kZWwuanNvbiBcdTYyMTYgLm1vZGVsMy5qc29uJyxcclxuICAgICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgZnMuY3Aoc291cmNlRGlyLCB0YXJnZXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG5cclxuICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCBwYXJzZUFuZENvbXBsZXRlTGl2ZTJkQ29uZmlnKHRhcmdldERpciwgZm9sZGVyTmFtZSwgbW9kZWxKc29uRmlsZSk7XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbW9kZWw6IGNvbmZpZyB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiBlcnJvci5tZXNzYWdlIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsaXN0TGl2ZTJkTW9kZWxzKCk6IFByb21pc2U8TGl2ZTJkTW9kZWxDb25maWdbXT4ge1xyXG4gICAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKCk7XHJcbiAgICBjb25zdCBtb2RlbHM6IExpdmUyZE1vZGVsQ29uZmlnW10gPSBbXTtcclxuXHJcbiAgICBpZiAoIWZzcy5leGlzdHNTeW5jKHNoYXJlZC5zaGFyZWRNb2RlbHNSb290KSkge1xyXG4gICAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBmb2xkZXJzID0gYXdhaXQgZnMucmVhZGRpcihzaGFyZWQuc2hhcmVkTW9kZWxzUm9vdCk7XHJcblxyXG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgZm9sZGVycykge1xyXG4gICAgICAgIGNvbnN0IG1vZGVsRGlyID0gcGF0aC5qb2luKHNoYXJlZC5zaGFyZWRNb2RlbHNSb290LCBmb2xkZXIpO1xyXG4gICAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmcy5zdGF0KG1vZGVsRGlyKTtcclxuICAgICAgICBpZiAoIXN0YXQuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XHJcblxyXG4gICAgICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgZnMucmVhZGRpcihtb2RlbERpcik7XHJcbiAgICAgICAgY29uc3QgbW9kZWxKc29uRmlsZSA9IGZpbGVzLmZpbmQoXHJcbiAgICAgICAgICAgIChmKSA9PiBmLmVuZHNXaXRoKCcubW9kZWwzLmpzb24nKSB8fCBmLmVuZHNXaXRoKCdtb2RlbC5qc29uJyksXHJcbiAgICAgICAgKTtcclxuICAgICAgICBpZiAoIW1vZGVsSnNvbkZpbGUpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCBwYXJzZUFuZENvbXBsZXRlTGl2ZTJkQ29uZmlnKG1vZGVsRGlyLCBmb2xkZXIsIG1vZGVsSnNvbkZpbGUpO1xyXG4gICAgICAgICAgICBtb2RlbHMucHVzaChjb25maWcpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHBhcnNlIG1vZGVsJywgZm9sZGVyLCBlKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG1vZGVscztcclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNhdmVMaXZlMmRDb25maWcoXHJcbiAgICBpbnB1dDogU2F2ZUxpdmUyZENvbmZpZ0lucHV0LFxyXG4pOiBQcm9taXNlPFNhdmVMaXZlMmRDb25maWdSZXN1bHQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3Qgc2hhcmVkID0gYXdhaXQgZW5zdXJlU2hhcmVkV29ya3NwYWNlKCk7XHJcbiAgICAgICAgY29uc3QgbW9kZWxEaXIgPSBwYXRoLmpvaW4oc2hhcmVkLnNoYXJlZE1vZGVsc1Jvb3QsIGlucHV0Lm1vZGVsSWQpO1xyXG4gICAgICAgIGlmICghZnNzLmV4aXN0c1N5bmMobW9kZWxEaXIpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiAnTW9kZWwgZGlyZWN0b3J5IG5vdCBmb3VuZCcgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGN1c3RvbUNvbmZpZ1BhdGggPSBwYXRoLmpvaW4obW9kZWxEaXIsICdsaXZlMmRfY3VzdG9tX2NvbmZpZy5qc29uJyk7XHJcbiAgICAgICAgY29uc3Qgc2F2ZURhdGEgPSB7XHJcbiAgICAgICAgICAgIG1vZGVsSWQ6IGlucHV0Lm1vZGVsSWQsXHJcbiAgICAgICAgICAgIG1vdGlvbnM6IGlucHV0Lm1vdGlvbnMsXHJcbiAgICAgICAgICAgIGV4cHJlc3Npb25zOiBpbnB1dC5leHByZXNzaW9ucyxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUoY3VzdG9tQ29uZmlnUGF0aCwgSlNPTi5zdHJpbmdpZnkoc2F2ZURhdGEsIG51bGwsIDIpLCAndXRmOCcpO1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH0gY2F0Y2ggKGU6IGFueSkge1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiBlLm1lc3NhZ2UgfTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkR2l0aHViTGl2ZTJkTW9kZWwodXJsOiBzdHJpbmcpOiBQcm9taXNlPEltcG9ydExpdmUyZE1vZGVsUmVzdWx0PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IG1hdGNoID0gdXJsLm1hdGNoKC9eaHR0cHM6XFwvXFwvZ2l0aHViXFwuY29tXFwvKFteXFwvXSspXFwvKFteXFwvXSspXFwvdHJlZVxcLyhbXlxcL10rKVxcLyguKykkLyk7XHJcbiAgICAgICAgaWYgKCFtYXRjaCkge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NjVFMFx1NjU0OFx1NzY4NFx1OTRGRVx1NjNBNVx1RkYwQ1x1OEJGN1x1NjNEMFx1NEY5Qlx1NjMwN1x1NTQxMVx1NTE3N1x1NEY1M1x1NkEyMVx1NTc4Qlx1NjU4N1x1NEVGNlx1NTkzOVx1NzY4NCBHaXRIdWIgXHU5NEZFXHU2M0E1IChcdTRGOEJcdTU5ODIgaHR0cHM6Ly9naXRodWIuY29tLy4uLi90cmVlL21hc3Rlci9tb2RlbC9zaGl6dWt1KScgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IFssIG93bmVyLCByZXBvLCBicmFuY2gsIHRhcmdldFBhdGhdID0gbWF0Y2g7XHJcbiAgICAgICAgY29uc3QgY2xlYW5UYXJnZXRQYXRoID0gdGFyZ2V0UGF0aC5yZXBsYWNlKC9cXC8kLywgJycpO1xyXG4gICAgICAgIGNvbnN0IGZvbGRlck5hbWUgPSBjbGVhblRhcmdldFBhdGguc3BsaXQoJy8nKS5wb3AoKSB8fCAnZG93bmxvYWRlZF9tb2RlbCc7XHJcblxyXG4gICAgICAgIGNvbnN0IHNoYXJlZCA9IGF3YWl0IGVuc3VyZVNoYXJlZFdvcmtzcGFjZSgpO1xyXG4gICAgICAgIGNvbnN0IHRhcmdldERpciA9IHBhdGguam9pbihzaGFyZWQuc2hhcmVkTW9kZWxzUm9vdCwgZm9sZGVyTmFtZSk7XHJcblxyXG4gICAgICAgIGlmIChmc3MuZXhpc3RzU3luYyh0YXJnZXREaXIpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiBgXHU2QTIxXHU1NzhCXHU2NTg3XHU0RUY2XHU1OTM5ICR7Zm9sZGVyTmFtZX0gXHU1REYyXHU1QjU4XHU1NzI4YCB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgdHJlZVVybCA9IGBodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zLyR7b3duZXJ9LyR7cmVwb30vZ2l0L3RyZWVzLyR7YnJhbmNofT9yZWN1cnNpdmU9MWA7XHJcbiAgICAgICAgY29uc3QgdHJlZVJlcyA9IGF3YWl0IGZldGNoKHRyZWVVcmwsIHsgaGVhZGVyczogeyAnVXNlci1BZ2VudCc6ICd3ZUJvdC1BcHAnIH0gfSk7XHJcblxyXG4gICAgICAgIGlmICghdHJlZVJlcy5vaykge1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogYFx1NjVFMFx1NkNENVx1ODNCN1x1NTNENiBHaXRIdWIgXHU0RUQzXHU1RTkzXHU0RkUxXHU2MDZGOiBIVFRQICR7dHJlZVJlcy5zdGF0dXN9YCB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgdHJlZURhdGEgPSAoYXdhaXQgdHJlZVJlcy5qc29uKCkpIGFzIGFueTtcclxuXHJcbiAgICAgICAgY29uc3QgZmlsZXNUb0Rvd25sb2FkID0gdHJlZURhdGEudHJlZS5maWx0ZXIoKGl0ZW06IGFueSkgPT5cclxuICAgICAgICAgICAgaXRlbS50eXBlID09PSAnYmxvYicgJiYgaXRlbS5wYXRoLnN0YXJ0c1dpdGgoYCR7Y2xlYW5UYXJnZXRQYXRofS9gKVxyXG4gICAgICAgICk7XHJcblxyXG4gICAgICAgIGlmICghZmlsZXNUb0Rvd25sb2FkIHx8IGZpbGVzVG9Eb3dubG9hZC5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIG1lc3NhZ2U6ICdcdTY3MkFcdTYyN0VcdTUyMzBcdThCRTVcdThERUZcdTVGODRcdTRFMEJcdTc2ODRcdTY1ODdcdTRFRjYnIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBhd2FpdCBmcy5ta2Rpcih0YXJnZXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG5cclxuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgZmlsZXNUb0Rvd25sb2FkKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IGl0ZW0ucGF0aC5zdWJzdHJpbmcoY2xlYW5UYXJnZXRQYXRoLmxlbmd0aCArIDEpO1xyXG4gICAgICAgICAgICBjb25zdCByYXdVcmwgPSBgaHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tLyR7b3duZXJ9LyR7cmVwb30vJHticmFuY2h9LyR7aXRlbS5wYXRofWA7XHJcbiAgICAgICAgICAgIGNvbnN0IGRlc3RQYXRoID0gcGF0aC5qb2luKHRhcmdldERpciwgcmVsYXRpdmVQYXRoKTtcclxuXHJcbiAgICAgICAgICAgIGF3YWl0IGZzLm1rZGlyKHBhdGguZGlybmFtZShkZXN0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgZmlsZVJlcyA9IGF3YWl0IGZldGNoKHJhd1VybCk7XHJcbiAgICAgICAgICAgIGlmICghZmlsZVJlcy5vaykgdGhyb3cgbmV3IEVycm9yKGBcdTY1RTBcdTZDRDVcdTRFMEJcdThGN0RcdTY1ODdcdTRFRjY6ICR7cmVsYXRpdmVQYXRofWApO1xyXG4gICAgICAgICAgICBjb25zdCBidWZmZXIgPSBhd2FpdCBmaWxlUmVzLmFycmF5QnVmZmVyKCk7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShkZXN0UGF0aCwgQnVmZmVyLmZyb20oYnVmZmVyKSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBkb3dubG9hZGVkRmlsZXMgPSBhd2FpdCBmcy5yZWFkZGlyKHRhcmdldERpcik7XHJcbiAgICAgICAgY29uc3QgbW9kZWxKc29uRmlsZSA9IGRvd25sb2FkZWRGaWxlcy5maW5kKGYgPT4gZi5lbmRzV2l0aCgnLm1vZGVsMy5qc29uJykgfHwgZi5lbmRzV2l0aCgnbW9kZWwuanNvbicpKTtcclxuXHJcbiAgICAgICAgaWYgKCFtb2RlbEpzb25GaWxlKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLnJtKHRhcmdldERpciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbWVzc2FnZTogJ1x1NjI0MFx1OTAwOVx1NjU4N1x1NEVGNlx1NTkzOVx1NEUyRFx1NjcyQVx1NjI3RVx1NTIzMCBtb2RlbC5qc29uIFx1NjIxNiAubW9kZWwzLmpzb24nIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBjb25maWcgPSBhd2FpdCBwYXJzZUFuZENvbXBsZXRlTGl2ZTJkQ29uZmlnKHRhcmdldERpciwgZm9sZGVyTmFtZSwgbW9kZWxKc29uRmlsZSk7XHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbW9kZWw6IGNvbmZpZyB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBtZXNzYWdlOiBlcnJvci5tZXNzYWdlIHx8ICdcdTdGNTFcdTdFRENcdTYyMTZcdTg5RTNcdTY3OTBcdTk1MTlcdThCRUYnIH07XHJcbiAgICB9XHJcbn1cclxuIiwgImltcG9ydCB7IHJlYWRGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcyc7XHJcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XHJcbmltcG9ydCAqIGFzIGVzYnVpbGQgZnJvbSAnZXNidWlsZCc7XHJcbmltcG9ydCB7IGdldEFsbFNraWxscyB9IGZyb20gJy4vc2tpbGxzLW1jcC1zZXJ2aWNlJztcclxuXHJcbi8qKlxyXG4gKiBSZWN1cnNpdmVseSBzZWFyY2ggZm9yIGEgUmVhY3QgY29tcG9uZW50IGZpbGUgKC50c3gpIG1hdGNoaW5nIHRoZSBjb21wb25lbnROYW1lIGluc2lkZSBhIGRpci5cclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGZpbmRDb21wb25lbnRJbkRpcihkaXI6IHN0cmluZywgY29tcG9uZW50TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHsgcmVhZGRpciB9ID0gYXdhaXQgaW1wb3J0KCdub2RlOmZzL3Byb21pc2VzJyk7XHJcbiAgICAgICAgY29uc3QgZW50cmllcyA9IGF3YWl0IHJlYWRkaXIoZGlyLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XHJcblxyXG4gICAgICAgIC8vIGNvbnNvbGUubG9nKGBbU2tpbGxQcm90b2NvbF0gU2VhcmNoaW5nIGluICR7ZGlyfSBmb3IgXCIke2NvbXBvbmVudE5hbWV9XCIgKCR7ZW50cmllcy5sZW5ndGh9IGVudHJpZXMpYCk7XHJcblxyXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xyXG4gICAgICAgICAgICBjb25zdCBmdWxsUGF0aCA9IHBhdGguam9pbihkaXIsIGVudHJ5Lm5hbWUpO1xyXG4gICAgICAgICAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZm91bmQgPSBhd2FpdCBmaW5kQ29tcG9uZW50SW5EaXIoZnVsbFBhdGgsIGNvbXBvbmVudE5hbWUpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGZvdW5kKSByZXR1cm4gZm91bmQ7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZW50cnkuaXNGaWxlKCkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShlbnRyeS5uYW1lKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2UgPSBwYXRoLmJhc2VuYW1lKGVudHJ5Lm5hbWUsIGV4dCk7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gQ2FzZS1pbnNlbnNpdGl2ZSBtYXRjaCBmb3IgdGhlIGNvbXBvbmVudCBuYW1lIGFzIGEgZmlsZW5hbWVcclxuICAgICAgICAgICAgICAgIGlmICgoYmFzZS50b0xvd2VyQ2FzZSgpID09PSBjb21wb25lbnROYW1lLnRvTG93ZXJDYXNlKCkpICYmIChleHQgPT09ICcudHN4JyB8fCBleHQgPT09ICcuanN4JykpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZnVsbFBhdGg7XHJcbiAgICAgICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gTWF0Y2ggaW5kZXgudHN4IGlmIHRoZSBwYXJlbnQgZm9sZGVyIG1hdGNoZXMgdGhlIGNvbXBvbmVudCBuYW1lXHJcbiAgICAgICAgICAgICAgICBpZiAoKGVudHJ5Lm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gJ2luZGV4LnRzeCcgfHwgZW50cnkubmFtZS50b0xvd2VyQ2FzZSgpID09PSAnaW5kZXguanN4JykgJiZcclxuICAgICAgICAgICAgICAgICAgICBwYXRoLmJhc2VuYW1lKGRpcikudG9Mb3dlckNhc2UoKSA9PT0gY29tcG9uZW50TmFtZS50b0xvd2VyQ2FzZSgpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZ1bGxQYXRoO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFtTa2lsbFByb3RvY29sXSBmaW5kQ29tcG9uZW50SW5EaXIgRXJyb3IgaW4gJHtkaXJ9OmAsIGUpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG4vKipcclxuICogUmVzb2x2ZXMgYSBjb21wb25lbnQgbmFtZSAoZS5nLiAnQ3VzdG9tQ2hhcnQnKSB0byBpdHMgYWJzb2x1dGUgZmlsZSBwYXRoIGJ5IHNjYW5uaW5nIGFsbCBsb2FkZWQgc2tpbGxzLlxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNvbXBvbmVudFBhdGgoY29tcG9uZW50TmFtZTogc3RyaW5nLCBhZ2VudElkPzogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgY29uc3Qgc2tpbGxzID0gYXdhaXQgZ2V0QWxsU2tpbGxzKGFnZW50SWQgPyB7IGFnZW50SWQgfSA6IHVuZGVmaW5lZCk7XG4gICAgY29uc29sZS5sb2coYFtTa2lsbFByb3RvY29sXSBSZXNvbHZpbmcgXCIke2NvbXBvbmVudE5hbWV9XCIgYW1vbmcgJHtza2lsbHMubGVuZ3RofSBza2lsbHNgKTtcblxyXG4gICAgZm9yIChjb25zdCBza2lsbCBvZiBza2lsbHMpIHtcclxuICAgICAgICAvLyBMb29rIGluc2lkZSB0aGUgc2tpbGwgZm9sZGVyXHJcbiAgICAgICAgY29uc3QgZm91bmQgPSBhd2FpdCBmaW5kQ29tcG9uZW50SW5EaXIoc2tpbGwucGF0aCwgY29tcG9uZW50TmFtZSk7XHJcbiAgICAgICAgaWYgKGZvdW5kKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbU2tpbGxQcm90b2NvbF0gRm91bmQgXCIke2NvbXBvbmVudE5hbWV9XCIgYXQgJHtmb3VuZH1gKTtcclxuICAgICAgICAgICAgcmV0dXJuIGZvdW5kO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG5sZXQgcmVxdWVzdENvdW50ZXIgPSAwO1xyXG5cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZVNraWxsUmVxdWVzdChyZXF1ZXN0OiBSZXF1ZXN0KTogUHJvbWlzZTxSZXNwb25zZT4ge1xyXG4gICAgY29uc3QgcmlkID0gKytyZXF1ZXN0Q291bnRlcjtcclxuICAgIGNvbnNvbGUubG9nKGBbU2tpbGxQcm90b2NvbF1bIyR7cmlkfV0gPC0tLS0gSW5jb21pbmcgUmVxdWVzdDogJHtyZXF1ZXN0LnVybH1gKTtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgLy8gVVJMIGZvcm1hdDogc2tpbGw6Ly9Db21wb25lbnROYW1lIG9yIHNraWxsOi8vR3JvdXBOYW1lL0NvbXBvbmVudE5hbWVcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBbU2tpbGxQcm90b2NvbF1bIyR7cmlkfV0gUGFyc2luZzogSG9zdD1cIiR7dXJsLmhvc3RuYW1lfVwiLCBQYXRoPVwiJHt1cmwucGF0aG5hbWV9XCJgKTtcbiAgICAgICAgY29uc3QgYWdlbnRJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KCdhZ2VudElkJyk/LnRyaW0oKTtcblxyXG4gICAgICAgIC8vIENvbWJpbmUgaG9zdG5hbWUgYW5kIHBhdGhuYW1lLCB0aGVuIGNsZWFuIHVwIHNsYXNoZXNcclxuICAgICAgICBsZXQgY29tcG9uZW50TmFtZSA9ICh1cmwuaG9zdG5hbWUgKyB1cmwucGF0aG5hbWUpLnJlcGxhY2UoL15cXC98XFwvJC9nLCAnJyk7XHJcblxyXG4gICAgICAgIC8vIFN0cmlwIGNvbW1vbiBzdWZmaXhlcyB0aGF0IG1pZ2h0IGJlIGFkZGVkIGJ5IHRoZSBicm93c2VyIG9yIGJ1bmRsZXJcclxuICAgICAgICBjb21wb25lbnROYW1lID0gY29tcG9uZW50TmFtZVxyXG4gICAgICAgICAgICAucmVwbGFjZSgvXFwvbWFpblxcLmpzJC8sICcnKVxyXG4gICAgICAgICAgICAucmVwbGFjZSgvXFwvaW5kZXhcXC5qcyQvLCAnJylcclxuICAgICAgICAgICAgLnJlcGxhY2UoL1xcLihqc3xqc3h8dHN8dHN4KSQvLCAnJyk7XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbU2tpbGxQcm90b2NvbF1bIyR7cmlkfV0gVGFyZ2V0ZWQgY29tcG9uZW50IGlkZW50aWZpZXI6IFwiJHtjb21wb25lbnROYW1lfVwiYCk7XHJcblxyXG4gICAgICAgIGlmICghY29tcG9uZW50TmFtZSkge1xyXG4gICAgICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKCdNaXNzaW5nIGNvbXBvbmVudCBuYW1lJywgeyBzdGF0dXM6IDQwMCB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gYXdhaXQgcmVzb2x2ZUNvbXBvbmVudFBhdGgoY29tcG9uZW50TmFtZSwgYWdlbnRJZCk7XG5cclxuICAgICAgICBpZiAoIWZpbGVQYXRoKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtTa2lsbFByb3RvY29sXVsjJHtyaWR9XSBDb21wb25lbnQgXCIke2NvbXBvbmVudE5hbWV9XCIgbm90IGZvdW5kIGluIGFueSBza2lsbC5gKTtcclxuICAgICAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShgQ29tcG9uZW50ICR7Y29tcG9uZW50TmFtZX0gbm90IGZvdW5kYCwgeyBzdGF0dXM6IDQwNCB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbU2tpbGxQcm90b2NvbF1bIyR7cmlkfV0gQ29tcGlsaW5nICR7Y29tcG9uZW50TmFtZX0gZnJvbSAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgIGNvbnN0IHNvdXJjZUNvZGUgPSBhd2FpdCByZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04Jyk7XHJcblxyXG4gICAgICAgIC8vIENvbXBpbGUgLnRzeCAtPiAuanMgdXNpbmcgZXNidWlsZCBvbiB0aGUgZmx5XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZXNidWlsZC50cmFuc2Zvcm0oc291cmNlQ29kZSwge1xyXG4gICAgICAgICAgICBsb2FkZXI6ICd0c3gnLFxyXG4gICAgICAgICAgICBqc3g6ICdhdXRvbWF0aWMnLCAgLy8gVXNlIFJlYWN0IDE4KyBhdXRvbWF0aWMgSlNYIHJ1bnRpbWVcclxuICAgICAgICAgICAgdGFyZ2V0OiAnZXNuZXh0JyxcclxuICAgICAgICAgICAgZm9ybWF0OiAnZXNtJywgICAgIC8vIEV4cG9ydCBhcyBFUyBtb2R1bGUgc28gUmVhY3QubGF6eSBjYW4gaW1wb3J0IGl0XHJcbiAgICAgICAgICAgIHNvdXJjZW1hcDogJ2lubGluZSdcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYFtTa2lsbFByb3RvY29sXVsjJHtyaWR9XSBDb21waWxhdGlvbiBzdWNjZXNzZnVsIGZvciAke2NvbXBvbmVudE5hbWV9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFtTa2lsbFByb3RvY29sXVsjJHtyaWR9XSBGaXJzdCAyMDAgY2hhcnMgb2YgY29kZTpcXG4ke3Jlc3VsdC5jb2RlLnN1YnN0cmluZygwLCAyMDApfS4uLmApO1xyXG5cclxuICAgICAgICAvLyBBZGQgc3RhbmRhcmQgQ09SUyBoZWFkZXJzIGp1c3QgaW4gY2FzZVxyXG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UocmVzdWx0LmNvZGUsIHtcclxuICAgICAgICAgICAgc3RhdHVzOiAyMDAsXHJcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdCcsXHJcbiAgICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycm9yOiB1bmtub3duKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgW1NraWxsUHJvdG9jb2xdWyMke3JpZH1dIENvbXBpbGF0aW9uIGVycm9yIGZvciAke3JlcXVlc3QudXJsfTpgLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShgQ29tcGlsYXRpb24gRXJyb3I6ICR7KGVycm9yIGFzIEVycm9yKT8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpfWAsIHsgc3RhdHVzOiA1MDAgfSk7XHJcbiAgICB9XHJcbn1cclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxJQUFBQSxrQkFBZTtBQUNmLElBQUFDLHFCQUFpQjtBQUNqQixJQUFBQyxtQkFBOEI7QUFFOUIsSUFBQUMsbUJBQW9GOzs7QUMyQzdFLElBQU0sd0JBQXdCO0FBQUEsRUFDbkMscUJBQXFCO0FBQUEsRUFDckIsaUJBQWlCO0FBQUEsRUFDakIsdUJBQXVCO0FBQUEsRUFDdkIsb0JBQW9CO0FBQUEsRUFDcEIsa0JBQWtCO0FBQUEsRUFDbEIsaUJBQWlCO0FBQUEsRUFDakIsdUJBQXVCO0FBQUEsRUFDdkIsb0JBQW9CO0FBQUEsRUFDcEIsdUJBQXVCO0FBQUEsRUFDdkIsMEJBQTBCO0FBQUEsRUFDMUIsZ0JBQWdCO0FBQUEsRUFDaEIsZUFBZTtBQUNqQjtBQUVPLElBQU0scUJBQXFCO0FBQUEsRUFDaEMsV0FBVztBQUFBLEVBQ1gsVUFBVTtBQUFBLEVBQ1YsWUFBWTtBQUFBLEVBQ1osWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsYUFBYTtBQUFBLEVBQ2IsY0FBYztBQUFBLEVBQ2QsMEJBQTBCO0FBQUEsRUFDMUIsV0FBVztBQUFBLEVBQ1gsaUJBQWlCO0FBQUEsRUFDakIsaUJBQWlCO0FBQUEsRUFDakIsZUFBZTtBQUFBLEVBQ2YsaUJBQWlCO0FBQUEsRUFDakIs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QUFpQjtBQUMvQyxVQUFJO0FBQ0YsY0FBTSxNQUFNLElBQUksSUFBSSxJQUFJLEdBQUc7QUFFM0IsY0FBTSxZQUFZLG1CQUFBQSxRQUFLLEtBQUsscUJBQUksUUFBUSxVQUFVLEdBQUcsVUFBVSxJQUFJLFVBQVUsbUJBQW1CLElBQUksUUFBUSxDQUFDO0FBQzdHLGVBQU8scUJBQUksTUFBTSxZQUFZLFNBQVM7QUFBQSxNQUN4QyxTQUFTLEtBQUs7QUFDWixnQkFBUSxNQUFNLHVDQUF1QyxHQUFHO0FBQ3hELGVBQU8sSUFBSSxTQUFTLGFBQWEsRUFBRSxRQUFRLElBQUksQ0FBQztBQUFBLE1BQ2xEO0FBQUEsSUFDRixDQUFDO0FBRUQsWUFBUSxJQUFJLG1FQUFtRTtBQUFBLEVBQ2pGLFNBQVMsR0FBRztBQUNWLFlBQVEsTUFBTSx5REFBeUQsQ0FBQztBQUFBLEVBQzFFO0FBQ0Esc0JBQW9CO0FBQ3BCLG1CQUFpQjtBQUVqQix1QkFBSSxHQUFHLFlBQVksTUFBTTtBQUN2QixRQUFJLCtCQUFjLGNBQWMsRUFBRSxXQUFXLEdBQUc7QUFDOUMsdUJBQWlCO0FBQUEsSUFDbkI7QUFBQSxFQUNGLENBQUM7QUFDSCxDQUFDO0FBRUQscUJBQUksR0FBRyxxQkFBcUIsTUFBTTtBQUNoQyxNQUFJLFFBQVEsYUFBYSxVQUFVO0FBQ2pDLHlCQUFJLEtBQUs7QUFBQSxFQUNYO0FBQ0YsQ0FBQztBQUVELHFCQUFJLEdBQUcsZUFBZSxNQUFNO0FBQzFCLGVBQWE7QUFDYix1QkFBcUI7QUFDdkIsQ0FBQzsiLAogICJuYW1lcyI6IFsiaW1wb3J0X25vZGVfZnMiLCAiaW1wb3J0X25vZGVfcGF0aCIsICJpbXBvcnRfbm9kZV91cmwiLCAiaW1wb3J0X2VsZWN0cm9uIiwgImltcG9ydF9ub2RlX3BhdGgiLCAiaW1wb3J0X3Byb21pc2VzIiwgImltcG9ydF9ub2RlX3BhdGgiLCAiaW1wb3J0X3Byb21pc2VzIiwgIm9zIiwgInBhdGgiLCAicGF0aCIsICJpbXBvcnRfbm9kZV9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJwYXRoIiwgInBhdGgiLCAiaW1wb3J0X25vZGVfcGF0aCIsICJpbXBvcnRfcHJvbWlzZXMiLCAiaW1wb3J0X25vZGVfcGF0aCIsICJpbXBvcnRfcHJvbWlzZXMiLCAicGF0aCIsICJwYXRoIiwgImVuc3VyZURpcmVjdG9yeSIsICJfX2ZpbGVuYW1lIiwgIl9fZGlybmFtZSIsICJuZXQiLCAicGF0aCIsICJwYXRjaCIsICJpbXBvcnRfem9kIiwgInoiLCAieiIsICJpbXBvcnRfbm9kZV9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJub3JtYWxpemVBZ2VudElkIiwgInBhdGgiLCAiY29udGVudCIsICJpbXBvcnRfbm9kZV9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfbm9kZV9zcWxpdGUiLCAiREVGQVVMVF9USU1FT1VUX01TIiwgInBhdGgiLCAiREVGQVVMVF9USU1FT1VUX01TIiwgImxpc3RHYXRld2F5Q3JvbkpvYnMiLCAiZmlsZUV4aXN0cyIsICJsaXN0R2F0ZXdheUNyb25Kb2JzIiwgInNsdWdpZnkiLCAibm9ybWFsaXplUHJvdmlkZXJJZCIsICJQUk9WSURFUl9JQ09OX01BUCIsICJidWlsZFByb3ZpZGVySW5pdGlhbHMiLCAiZ2V0UHJvdmlkZXJJY29uIiwgImltcG9ydF9lbGVjdHJvbiIsICJ0b0ZhaWx1cmUiLCAidG9TdWNjZXNzIiwgImltcG9ydF9lbGVjdHJvbiIsICJpbXBvcnRfbm9kZV9wYXRoIiwgImltcG9ydF9wcm9taXNlcyIsICJwYXRoIiwgImVuc3VyZURpcmVjdG9yeSIsICJpbXBvcnRfZWxlY3Ryb24iLCAiaW1wb3J0X2VsZWN0cm9uIiwgImltcG9ydF9wcm9taXNlcyIsICJpbXBvcnRfbm9kZV9mcyIsICJpbXBvcnRfbm9kZV9wYXRoIiwgInBhdGgiLCAiZnMiLCAiZnNzIiwgInN0YXQiLCAiaW1wb3J0X3Byb21pc2VzIiwgImltcG9ydF9ub2RlX3BhdGgiLCAicmVhZGRpciIsICJwYXRoIiwgInBhdGgiLCAiZnMiXQp9Cg==
