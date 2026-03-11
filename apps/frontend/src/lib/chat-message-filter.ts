function normalizeMultilineText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').trim();
}

const SYSTEM_TAG_PREFIX_PATTERN = /^\[(?:system|sys|prompt|instruction|context)(?::[^\]\n\r]+)?\]/i;
const IM_START_SYSTEM_PATTERN = /^<\|im_start\|>\s*system\b/i;
const XML_SYSTEM_PATTERN = /^<system\b[^>]*>/i;
const MARKDOWN_SYSTEM_PATTERN = /^#{0,3}\s*system(?:\s+(?:prompt|instruction|rules?))?\s*[:：]/i;
const LEAK_HINT_PATTERN = /(不要提及(?:系统|提示词)|不要暴露(?:系统|提示词)|优先方向|输出风格|交付标准|最近对话|与用户(?:私聊|对话)中|请主动发起一条自然的跟进消息)/i;
const INSTRUCTION_VERB_PATTERN = /(你是|请|必须|要求|规则|禁止|输出)/i;
const LIST_PATTERN = /(?:^|\n)\s*(?:\d+[\).、]|[-*])\s+/;

export function isHiddenSystemPromptText(raw: string): boolean {
  const text = normalizeMultilineText(raw);
  if (!text) return false;

  if (
    SYSTEM_TAG_PREFIX_PATTERN.test(text)
    || IM_START_SYSTEM_PATTERN.test(text)
    || XML_SYSTEM_PATTERN.test(text)
    || MARKDOWN_SYSTEM_PATTERN.test(text)
  ) {
    return true;
  }

  if (/^\s*system\s*[:：]/i.test(text) && LEAK_HINT_PATTERN.test(text)) {
    return true;
  }

  if (
    text.length >= 120
    && LEAK_HINT_PATTERN.test(text)
    && INSTRUCTION_VERB_PATTERN.test(text)
    && LIST_PATTERN.test(text)
  ) {
    return true;
  }

  return false;
}

