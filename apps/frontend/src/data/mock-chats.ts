import type { ChatTaskCardData } from '@/types/chat-task';
import type { A2AWorkCardData } from '@/types/a2a';

export interface MessageTrace {
    id: string;
    title: string;
    detail?: string;
    at: string;
}

export interface MessageToolCall {
    id: string;
    name: string;
    running: boolean;
    expanded?: boolean;
    input?: string;
    result?: string;
    is_error?: boolean;
}

export interface ChatAttachment {
    id: string;
    kind: 'image' | 'file';
    name: string;
    relativePath: string;
    savedPath?: string;
    assetUrl?: string;
    mimeType?: string;
    size?: number;
    upstreamFileId?: string;
    sha256?: string;
    localVisionSummary?: string;
    localVisionProvider?: string;
    localVisionModel?: string;
}

export interface Message {
    id: string;
    role: 'user' | 'agent' | 'system';
    agentId?: string;
    agentName?: string;
    agentAvatarUrl?: string;
    agentColor?: string;
    agentPortraitUrl?: string;
    text: string;
    meta?: string;
    attachments?: ChatAttachment[];
    tools?: MessageToolCall[];
    thinking?: boolean;
    streaming?: boolean;
    spec?: unknown;
    cardPending?: boolean;
    pendingComponentName?: string;
    pendingComponentKind?: 'video' | 'image' | 'audio' | 'text' | 'generic';
    pendingComponentPreviewUrl?: string;
    uiRawText?: string;
    uiStreamState?: 'idle' | 'streaming' | 'ready';
    debugRawStream?: string;
    debugNativeFrames?: string;
    debugDonePayload?: string;
    debugPromptChannel?: string;
    debugRenderMode?: string;
    debugHasUiJson?: boolean;
    debugSpecSource?: 'none' | 'done' | 'tool_result' | 'patch' | 'inline';
    debugNormalizedUiRawText?: string;
    debugRepairedUiRawText?: string;
    debugUiContractWarnings?: string;
    debugLegacySanitizer?: string;
    debugSchemaSanitizer?: string;
    debugNormalizedSpecText?: string;
    debugMixedSegmentCount?: number;
    debugProfileIntroDetected?: boolean;
    debugChunkCount?: number;
    debugReceivedDone?: boolean;
    debugReceivedError?: boolean;
    debugWatchdogTriggered?: boolean;
    debugLastChunkKind?: string;
    debugLastEvent?: string;
    thinkingTrace?: MessageTrace[];
    toolTrace?: MessageTrace[];
    generationStartedAt?: number;
    generationElapsedMs?: number;
    taskCard?: ChatTaskCardData;
    a2aCards?: A2AWorkCardData[];
    timestamp: string;
}

export const mockChats: Record<string, Message[]> = {
    'default': [
        {
            id: 'msg-1',
            role: 'agent',
            text: '你好！我是你的专属智能助手。有什么我可以帮你的吗？',
            timestamp: new Date(Date.now() - 100000).toISOString(),
        },
        {
            id: 'msg-2',
            role: 'user',
            text: '你能帮我查一下今天的天气吗？',
            timestamp: new Date(Date.now() - 50000).toISOString(),
        },
        {
            id: 'msg-3',
            role: 'agent',
            text: '今天天气晴朗，气温25度，非常适合出行！',
            timestamp: new Date(Date.now() - 20000).toISOString(),
        }
    ]
};
