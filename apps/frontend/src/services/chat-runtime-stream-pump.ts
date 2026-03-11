import { compileSpecStream } from '@json-render/core';
import type { AgentChatStreamChunk } from '@/main/types';
import { subscribeAgentChatStream } from '@/services/agent-client';
import { chatRuntimeStore } from '@/services/chat-runtime-store';
import {
  cleanupAssistantText,
  extractUiRawText,
  normalizeIncomingSpec,
  sanitizeAssistantText,
  stripThinkingBlocks,
  tryParseInlineSpecFromText,
} from '@/components/chat/chat-page-helpers';

interface RequestBufferState {
  rawText: string;
  patchBuffer: string;
}

const requestBuffers = new Map<string, RequestBufferState>();
let pumpStarted = false;

function getOrCreateBuffer(
  requestId: string,
  binding: { agentId: string; sessionId: string; messageId: string },
): RequestBufferState {
  const current = requestBuffers.get(requestId);
  if (current) return current;

  const agentState = chatRuntimeStore.getAgentState(binding.agentId);
  const session = agentState.sessions.find((item) => item.id === binding.sessionId);
  const message = session?.messages.find((item) => item.id === binding.messageId);
  const seededRawText = typeof message?.debugRawStream === 'string' && message.debugRawStream
    ? message.debugRawStream
    : (message?.text || '');
  const seededPatchBuffer = typeof message?.uiRawText === 'string' && message.uiRawText
    ? message.uiRawText
    : '';
  const next: RequestBufferState = {
    rawText: seededRawText,
    patchBuffer: seededPatchBuffer,
  };
  requestBuffers.set(requestId, next);
  return next;
}

function clearBuffer(requestId: string): void {
  requestBuffers.delete(requestId);
}

function handleStreamChunk(chunk: AgentChatStreamChunk): void {
  const requestId = chunk.requestId;
  if (!requestId) return;

  const binding = chatRuntimeStore.getRequest(requestId);
  if (!binding) {
    clearBuffer(requestId);
    return;
  }
  if (binding.processor === 'local') {
    return;
  }

  const buffer = getOrCreateBuffer(requestId, binding);
  const patchMessage = (
    updater: Parameters<typeof chatRuntimeStore.patchSessionMessage>[3],
  ) => {
    chatRuntimeStore.patchSessionMessage(binding.agentId, binding.sessionId, binding.messageId, updater);
  };

  if (chunk.kind === 'text') {
    const delta = chunk.value || '';
    if (!delta) return;
    buffer.rawText += delta;
    chatRuntimeStore.setSessionStreamState(binding.agentId, binding.sessionId, 'streaming', false);
    patchMessage((current) => {
      const startedAt = current.generationStartedAt ?? Date.now();
      const uiRawText = extractUiRawText(buffer.rawText);
      return {
        ...current,
        generationStartedAt: startedAt,
        generationElapsedMs: Math.max(0, Date.now() - startedAt),
        streaming: true,
        thinking: false,
        text: sanitizeAssistantText(stripThinkingBlocks(buffer.rawText)),
        debugRawStream: buffer.rawText,
        uiRawText,
        uiStreamState: uiRawText ? 'streaming' : (current.uiStreamState ?? 'idle'),
        debugHasUiJson: Boolean(uiRawText),
        cardPending: uiRawText ? true : current.cardPending,
      };
    });
    return;
  }

  if (chunk.kind === 'patch') {
    const patchText = chunk.value || '';
    if (!patchText) return;
    buffer.patchBuffer = buffer.patchBuffer
      ? `${buffer.patchBuffer}${buffer.patchBuffer.endsWith('\n') || patchText.startsWith('\n') ? '' : '\n'}${patchText}`
      : patchText;
    chatRuntimeStore.setSessionStreamState(binding.agentId, binding.sessionId, 'streaming', false);
    patchMessage((current) => {
      let nextSpec = current.spec;
      try {
        nextSpec = compileSpecStream(buffer.patchBuffer);
      } catch {
        // patch 尚未完整时忽略
      }
      const startedAt = current.generationStartedAt ?? Date.now();
      return {
        ...current,
        generationStartedAt: startedAt,
        generationElapsedMs: Math.max(0, Date.now() - startedAt),
        streaming: true,
        thinking: false,
        uiRawText: buffer.patchBuffer,
        uiStreamState: 'streaming',
        debugHasUiJson: true,
        cardPending: true,
        spec: nextSpec,
      };
    });
    return;
  }

  if (chunk.kind === 'done') {
    const rawDoneText = chunk.text ?? buffer.rawText;
    const normalizedDoneSpec = chunk.spec !== undefined ? normalizeIncomingSpec(chunk.spec) : undefined;
    patchMessage((current) => {
      const startedAt = current.generationStartedAt ?? Date.now();
      const uiRawText = current.uiRawText || extractUiRawText(rawDoneText);
      const resolvedSpec = normalizedDoneSpec ?? current.spec ?? tryParseInlineSpecFromText(rawDoneText);
      const resolvedText = cleanupAssistantText(rawDoneText || current.text || '', resolvedSpec);
      return {
        ...current,
        generationStartedAt: startedAt,
        generationElapsedMs: Math.max(0, Date.now() - startedAt),
        streaming: false,
        thinking: false,
        cardPending: false,
        text: resolvedText,
        spec: resolvedSpec,
        uiRawText,
        uiStreamState: resolvedSpec != null || uiRawText ? 'ready' : 'idle',
        debugRawStream: rawDoneText || current.debugRawStream,
        debugReceivedDone: true,
      };
    });
    chatRuntimeStore.setSessionStreamState(binding.agentId, binding.sessionId, 'idle');
    chatRuntimeStore.unbindRequest(requestId);
    clearBuffer(requestId);
    return;
  }

  if (chunk.kind === 'error') {
    patchMessage((current) => {
      const startedAt = current.generationStartedAt ?? Date.now();
      const detail = chunk.value || '流式输出失败';
      return {
        ...current,
        generationStartedAt: startedAt,
        generationElapsedMs: Math.max(0, Date.now() - startedAt),
        streaming: false,
        thinking: false,
        cardPending: false,
        text: current.text || detail,
        debugReceivedError: true,
      };
    });
    chatRuntimeStore.setSessionStreamState(binding.agentId, binding.sessionId, 'idle');
    chatRuntimeStore.unbindRequest(requestId);
    clearBuffer(requestId);
  }
}

export function ensureChatRuntimeStreamPump(): void {
  if (pumpStarted) return;
  pumpStarted = true;
  subscribeAgentChatStream(handleStreamChunk);
}
