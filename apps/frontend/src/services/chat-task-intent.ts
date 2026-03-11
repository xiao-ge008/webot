export interface ChatTaskIntent {
  taskName: string;
  objective: string;
  everyMs: number;
  maxRuns: number;
  scheduleText: string;
  executionPrompt: string;
  sourceMessageText: string;
}

const INTERVAL_PATTERNS: RegExp[] = [
  /每\s*(\d+)\s*(秒|分钟|分|小时|天)\s*(?:去|来|再)?\s*(?:查|执行|运行|获取|提醒)?\s*(?:一次)?/i,
  /(\d+)\s*(秒|分钟|分|小时|天)\s*(?:去|来|再)?\s*(?:查|执行|运行|获取|提醒)\s*(?:一次)?/i,
  /(\d+)\s*(秒|分钟|分|小时|天)\s*(?:1|一)?\s*次/i,
];

const RUN_COUNT_PATTERNS: RegExp[] = [
  /(?:总共|一共|共|总计|连续)\s*(\d+)\s*次/i,
  /(?:查|执行|运行|获取)\s*(\d+)\s*次/i,
  /(\d+)\s*轮/i,
];

export const CHAT_TASK_TRIGGER_KEYWORDS = [
  '定时',
  '每',
  '分钟',
  '小时',
  '每天',
  '每隔',
  '总共',
  '一共',
  '查一次',
  '执行一次',
  '获取一次',
] as const;

export const CHAT_TASK_TRIGGER_KEYWORDS_HINT = CHAT_TASK_TRIGGER_KEYWORDS.join('、');

function unitToMs(value: number, unit: string): number {
  const normalized = unit.trim().toLowerCase();
  if (normalized === '秒') return value * 1000;
  if (normalized === '分钟' || normalized === '分') return value * 60_000;
  if (normalized === '小时') return value * 3_600_000;
  if (normalized === '天') return value * 86_400_000;
  return value * 60_000;
}

export function formatEveryMs(everyMs: number): string {
  const safe = Math.max(1000, Math.floor(everyMs));
  if (safe % 86_400_000 === 0) return `每 ${safe / 86_400_000} 天`;
  if (safe % 3_600_000 === 0) return `每 ${safe / 3_600_000} 小时`;
  if (safe % 60_000 === 0) return `每 ${safe / 60_000} 分钟`;
  if (safe % 1000 === 0) return `每 ${safe / 1000} 秒`;
  return `每 ${safe} 毫秒`;
}

function parseEveryMs(message: string): number | null {
  for (const pattern of INTERVAL_PATTERNS) {
    const match = message.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    const unit = String(match[2] || '');
    if (!Number.isFinite(value) || value <= 0) continue;
    return Math.max(1000, unitToMs(value, unit));
  }
  return null;
}

function parseMaxRuns(message: string): number {
  for (const pattern of RUN_COUNT_PATTERNS) {
    const match = message.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return Math.max(1, Math.floor(value));
    }
  }
  const trailingMatch = message.match(/(?:^|[\s，,；;])(\d+)\s*次(?:$|[\s，,。！？!?])/i);
  if (trailingMatch) {
    const value = Number(trailingMatch[1]);
    if (Number.isFinite(value) && value > 1) {
      return Math.floor(value);
    }
  }
  return 0;
}

function extractObjective(message: string): string {
  const stripped = message
    .replace(/^(请|请你|帮我|麻烦|可以|能否|给我)\s*/i, '')
    .replace(/[，,\s]*(?:每|总共|一共|共|连续)\s*\d+\s*(?:秒|分钟|分|小时|天|次|轮).*/i, '')
    .replace(/[，,\s]*\d+\s*(?:秒|分钟|分|小时|天)\s*(?:\d+|一)?\s*次(?:[，,\s].*)?/i, '')
    .replace(/[，,\s]*(?:总共|一共|共|总计|连续)\s*\d+\s*次(?:[，,\s].*)?/i, '')
    .replace(/[，,\s]*(?:执行|运行|获取|查询|追踪|监控)\s*\d+\s*次(?:[，,\s].*)?/i, '')
    .replace(/[。！？!?，,；;]+$/g, '')
    .replace(/[，,；;]+$/g, '')
    .trim();

  if (stripped) {
    return stripped;
  }
  return message.trim();
}

function containsTriggerKeyword(message: string): boolean {
  return CHAT_TASK_TRIGGER_KEYWORDS.some((keyword) => message.includes(keyword));
}

function buildTaskName(objective: string, fallback: string): string {
  const seed = (objective || fallback).trim();
  if (!seed) return '任务定时器';
  const compact = seed
    .replace(/[。！？!?]/g, '')
    .replace(/\s+/g, '');
  if (/黄金|金价|xau|xauusd|gold/i.test(compact)) {
    return '监控黄金价格';
  }
  if (compact.length <= 14) {
    return compact;
  }
  return `${compact.slice(0, 14)}...`;
}

export function parseChatTaskIntent(message: string): ChatTaskIntent | null {
  const raw = message.trim();
  if (!raw) return null;
  if (!containsTriggerKeyword(raw)) return null;

  const everyMs = parseEveryMs(raw);
  if (everyMs == null) {
    return null;
  }

  const maxRuns = parseMaxRuns(raw);
  const objective = extractObjective(raw);
  const scheduleText = maxRuns > 0
    ? `${formatEveryMs(everyMs)}，共 ${maxRuns} 次`
    : `${formatEveryMs(everyMs)}，无限次`;
  const executionPrompt = [
    '你是任务执行助手。请直接执行以下任务并给出简洁结果：',
    objective || raw,
    maxRuns > 0 ? `任务总执行次数上限：${maxRuns} 次。达到上限后停止。` : '任务总执行次数上限：无限次。',
    '要求：',
    '1) 必须返回可读的结论。',
    '2) 若失败，返回失败原因。',
    '3) 不要输出额外格式包装。',
    '4) 禁止输出“是否创建任务/请确认/确认后执行”等二次确认语句。',
    '5) 禁止复述调度信息（如每几分钟执行一次），仅输出本次查询结果。',
    '6) 监控/阈值类任务必须明确输出：`告警状态：触发` 或 `告警状态：未触发`，并说明关键数值与阈值比较。',
  ].join('\n');

  return {
    taskName: buildTaskName(objective || raw, raw),
    objective: objective || raw,
    everyMs,
    maxRuns,
    scheduleText,
    executionPrompt,
    sourceMessageText: raw,
  };
}
