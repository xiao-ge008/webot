import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const qqbotDistDir = path.resolve(rootDir, '_ext', 'qqbot', 'dist', 'src');

const gatewayPath = path.join(qqbotDistDir, 'gateway.js');
const configPath = path.join(qqbotDistDir, 'config.js');
const runtimePath = path.join(qqbotDistDir, 'runtime.js');

if (!fs.existsSync(gatewayPath) || !fs.existsSync(configPath) || !fs.existsSync(runtimePath)) {
  console.error('[qqbot-bridge] 未找到 qqbot dist，请先执行:');
  console.error('  cd e:\\weBot2\\_ext\\qqbot');
  console.error('  npm install');
  console.error('  npm run build（确保 dist\\src\\gateway.js 存在）');
  process.exit(1);
}

const { startGateway } = await import(pathToFileURL(gatewayPath).href);
const { resolveQQBotAccount, resolveDefaultQQBotAccountId } = await import(pathToFileURL(configPath).href);
const { setQQBotRuntime } = await import(pathToFileURL(runtimePath).href);

const WEBOT_HOME = process.env.WEBOT_HOME || path.join(os.homedir(), '.webot');
const CONFIG_PATH = process.env.WEBOT_CONFIG_PATH || path.join(WEBOT_HOME, 'config.toml');
const STATUS_PATH = path.join(WEBOT_HOME, 'qqbot', 'bridge-status.json');
const SERVICE_URL_FILE = path.join(WEBOT_HOME, 'service-url.txt');
const SERVICE_URL_ENV = process.env.WEBOT_SERVICE_URL || '';
const WEBOT_ENV_PATH = path.join(WEBOT_HOME, '.env');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(WEBOT_ENV_PATH);

function readServiceUrlFile() {
  if (!fs.existsSync(SERVICE_URL_FILE)) {
    return '';
  }
  return fs.readFileSync(SERVICE_URL_FILE, 'utf-8').trim();
}

async function resolveServiceUrl() {
  if (SERVICE_URL_ENV) {
    return SERVICE_URL_ENV;
  }
  let current = readServiceUrlFile();
  if (current) {
    return current;
  }
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    current = readServiceUrlFile();
    if (current) {
      return current;
    }
  }
  return 'http://127.0.0.1:4310';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeSessionLabel(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  let out = '';
  for (const ch of trimmed) {
    if (out.length >= 120) break;
    if (/^[a-zA-Z0-9_-]$/.test(ch)) {
      out += ch;
    } else {
      out += '_';
    }
  }
  return out.replace(/^_+|_+$/g, '');
}

function stripComment(line) {
  const hashIndex = line.indexOf('#');
  if (hashIndex >= 0) {
    return line.slice(0, hashIndex).trim();
  }
  return line.trim();
}

function parseTomlValue(raw) {
  const value = raw.trim();
  if (!value) return undefined;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((item) => parseTomlValue(item))
      .filter((item) => item !== undefined);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  }
  return value;
}

function parseTomlSection(content, sectionName) {
  const lines = content.split(/\r?\n/);
  let inSection = false;
  const result = {};
  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    if (!line) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      inSection = sectionMatch[1].trim() === sectionName;
      continue;
    }
    if (!inSection) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex < 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = parseTomlValue(line.slice(eqIndex + 1));
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`未找到配置文件: ${CONFIG_PATH}`);
  }
  const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const qqbotSection = parseTomlSection(content, 'channels.qqbot');
  const appId = qqbotSection.appId || qqbotSection.app_id || process.env.QQBOT_APP_ID || '';
  let clientSecret = qqbotSection.clientSecret || qqbotSection.client_secret || process.env.QQBOT_CLIENT_SECRET || '';
  const clientSecretFile = qqbotSection.clientSecretFile || qqbotSection.client_secret_file;
  if (!clientSecret && clientSecretFile && fs.existsSync(clientSecretFile)) {
    clientSecret = fs.readFileSync(clientSecretFile, 'utf-8').trim();
  }

  return {
    qqbot: {
      appId,
      clientSecret,
      enabled: qqbotSection.enabled !== false,
      name: qqbotSection.name,
      allowFrom: Array.isArray(qqbotSection.allowFrom) ? qqbotSection.allowFrom : undefined,
      systemPrompt: qqbotSection.systemPrompt,
      imageServerBaseUrl: qqbotSection.imageServerBaseUrl,
      markdownSupport: qqbotSection.markdownSupport !== false,
      defaultAgent: qqbotSection.default_agent || qqbotSection.defaultAgent || process.env.QQBOT_DEFAULT_AGENT || '',
    },
  };
}

async function fetchDefaultAgent(serviceUrl) {
  const resp = await fetch(`${serviceUrl}/api/management/agents`);
  if (!resp.ok) {
    throw new Error(`无法加载智能体列表: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('智能体列表为空');
  }
  const first = data.find((row) => row && row.id) || data[0];
  return String(first.id || '');
}

function extractText(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts = value.map(extractText).filter(Boolean);
    return parts.length ? parts.join('\n') : null;
  }
  if (value && typeof value === 'object') {
    const preferred = ['text', 'content', 'message', 'response', 'output', 'result', 'value'];
    for (const key of preferred) {
      if (key in value) {
        const text = extractText(value[key]);
        if (text) return text;
      }
    }
    for (const key of Object.keys(value)) {
      const text = extractText(value[key]);
      if (text) return text;
    }
  }
  return null;
}

function looksLikeProtocolOnlyText(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every((line) => {
    const lower = line.toLowerCase();
    return lower.startsWith('query:')
      || lower.startsWith('tool:')
      || lower.startsWith('args:')
      || lower.startsWith('name:')
      || lower.startsWith('id:')
      || lower.startsWith('type:')
      || lower.startsWith('<tool_call>');
  });
}

function extractAssistantText(payload) {
  const session = payload?.session ?? payload;
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const results = [];
  for (const row of messages) {
    const role = String(row?.role || '').trim().toLowerCase();
    if (role !== 'assistant' && role !== 'agent') continue;
    const contentText = extractText(row?.content) || extractText(row?.message);
    if (contentText && !looksLikeProtocolOnlyText(contentText)) {
      results.push(contentText);
    }
  }
  if (results.length > 0) return results[results.length - 1];
  return extractText(payload) || '';
}

function parseStreamFrame(frame) {
  const lines = frame.split(/\r?\n/);
  let eventName = '';
  const dataLines = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    if (trimmed.startsWith('event:')) {
      eventName = trimmed.slice('event:'.length).trim();
      continue;
    }
    if (trimmed.startsWith('data:')) {
      dataLines.push(trimmed.slice('data:'.length).trim());
    }
  }
  return {
    eventName,
    data: dataLines.join('\n'),
  };
}

function appendStreamedContent(buffer, data) {
  if (!data) return buffer;
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && 'content' in parsed) {
      const content = String(parsed.content ?? '');
      return buffer + content;
    }
  } catch {
    // ignore json parse errors and treat as plain text
  }
  return buffer + data;
}

function findFrameBoundary(buffer) {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return null;
  if (lf === -1) return { index: crlf, delimiterLen: 4 };
  if (crlf === -1) return { index: lf, delimiterLen: 2 };
  if (lf < crlf) return { index: lf, delimiterLen: 2 };
  return { index: crlf, delimiterLen: 4 };
}

async function readStreamedText(resp) {
  if (!resp.body) {
    const text = await resp.text();
    return text;
  }

  const reader = resp.body.getReader();
  let buffer = '';
  let text = '';
  let sawDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += Buffer.from(value).toString('utf8');
    let boundary;
    while ((boundary = findFrameBoundary(buffer)) !== null) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.delimiterLen);
      const { eventName, data } = parseStreamFrame(frame);
      if (!data) continue;
      if (!eventName || eventName === 'chunk' || eventName === 'message' || eventName === 'done') {
        text = appendStreamedContent(text, data);
      }
      if (eventName === 'done') {
        sawDone = true;
      }
    }
    if (sawDone) {
      break;
    }
  }

  return text;
}

function createStatusTracker(base) {
  const state = {
    ...base,
    connected: false,
    last_event_at: null,
    last_error: null,
  };
  const dir = path.dirname(STATUS_PATH);
  ensureDir(dir);

  const writeStatus = () => {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(state, null, 2));
  };

  return {
    state,
    markConnected() {
      state.connected = true;
      state.last_event_at = Date.now();
      writeStatus();
    },
    markDisconnected() {
      state.connected = false;
      state.last_event_at = Date.now();
      writeStatus();
    },
    markError(err) {
      state.last_error = String(err);
      state.connected = false;
      state.last_event_at = Date.now();
      writeStatus();
    },
    touch() {
      state.last_event_at = Date.now();
      writeStatus();
    },
    writeStatus,
  };
}

async function main() {
  const serviceUrl = await resolveServiceUrl();
  const cfg = loadConfig();
  const accountId = resolveDefaultQQBotAccountId({ channels: { qqbot: cfg.qqbot } });
  const account = resolveQQBotAccount({ channels: { qqbot: cfg.qqbot } }, accountId);

  if (!account.appId || !account.clientSecret) {
    throw new Error('QQBot 未配置 AppID 或 AppSecret');
  }

  let defaultAgent = cfg.qqbot.defaultAgent;
  if (!defaultAgent) {
    defaultAgent = await fetchDefaultAgent(serviceUrl);
  }

  const status = createStatusTracker({
    started_at: Date.now(),
    pid: process.pid,
    account_id: account.accountId,
    app_id: account.appId,
    service_url: serviceUrl,
    default_agent: defaultAgent,
  });
  status.writeStatus();

  let currentConfig = {
    channels: {
      qqbot: {
        ...cfg.qqbot,
        appId: account.appId,
        clientSecret: account.clientSecret,
      },
    },
  };

  const runtime = {
    getConfig() {
      return currentConfig;
    },
    setConfig(next) {
      currentConfig = next;
    },
    getDataDir() {
      return path.join(os.homedir(), '.openclaw', 'qqbot');
    },
    channel: {
      activity: {
        record() {},
      },
      routing: {
        resolveAgentRoute({ accountId: requestedAccountId, peer }) {
          const peerId = peer?.id ? String(peer.id) : 'unknown';
          const peerKind = peer?.kind ? String(peer.kind) : 'direct';
          return {
            accountId: requestedAccountId || account.accountId,
            agentId: defaultAgent,
            sessionKey: normalizeSessionLabel(`qqbot_${peerKind}_${peerId}`),
          };
        },
      },
      reply: {
        resolveEnvelopeFormatOptions() {
          return {};
        },
        formatInboundEnvelope(options) {
          return options?.body ?? '';
        },
        finalizeInboundContext(options) {
          return options;
        },
        resolveEffectiveMessagesConfig() {
          return { responsePrefix: '' };
        },
        async dispatchReplyWithBufferedBlockDispatcher(options) {
          const ctx = options?.ctx;
          const dispatcherOptions = options?.dispatcherOptions;
          const onError = options?.onError;

          try {
            const message = ctx?.BodyForAgent || ctx?.Body || '';
            const sessionLabel = ctx?.SessionKey || '';
            const agentId = defaultAgent;

            const useStream = process.env.QQBOT_USE_STREAM !== '0';
            const endpoint = useStream
              ? `${serviceUrl}/api/chat/${encodeURIComponent(agentId)}/message/stream`
              : `${serviceUrl}/api/chat/${encodeURIComponent(agentId)}/message`;

            const resp = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message,
                session_label: sessionLabel,
              }),
            });
            if (!resp.ok) {
              const detail = await resp.text().catch(() => '');
              throw new Error(`OpenFang 请求失败: HTTP ${resp.status} ${detail}`);
            }

            let text = '';
            if (useStream) {
              const streamed = await readStreamedText(resp);
              text = extractAssistantText(streamed) || streamed;
            } else {
              const data = await resp.json();
              text = extractAssistantText(data);
            }

            text = String(text || '').trim();
            if (!text) {
              throw new Error('OpenFang 未返回可用文本');
            }
            if (dispatcherOptions?.deliver) {
              await dispatcherOptions.deliver({ text }, { kind: 'block' });
            }
          } catch (err) {
            if (typeof onError === 'function') {
              await onError(err);
              return;
            }
            throw err;
          }
        },
      },
    },
    log: {
      info(msg) {
        console.log(msg);
        if (msg.includes('WebSocket connected')) {
          status.markConnected();
        }
        if (msg.includes('WebSocket closed')) {
          status.markDisconnected();
        }
      },
      warn(msg) {
        console.warn(msg);
      },
      error(msg) {
        console.error(msg);
        status.markError(msg);
      },
      debug(msg) {
        if (process.env.QQBOT_BRIDGE_DEBUG === '1') {
          console.debug(msg);
        }
      },
    },
  };

  setQQBotRuntime(runtime);

  const abortController = new AbortController();
  const stop = () => {
    abortController.abort();
    status.markDisconnected();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await startGateway({
    account,
    cfg: currentConfig,
    abortSignal: abortController.signal,
    onReady() {
      status.markConnected();
    },
    onError(err) {
      status.markError(err);
    },
    log: runtime.log,
  });
}

main().catch((err) => {
  console.error('[qqbot-bridge] 启动失败:', err);
  process.exit(1);
});
