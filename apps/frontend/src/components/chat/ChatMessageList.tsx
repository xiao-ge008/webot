import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentAvatar } from '@/components/ui/agent-avatar';
import { cn } from '@/lib/utils';
import type { Message } from '@/data/mock-chats';

const VIRTUALIZATION_THRESHOLD = 32;
const DEFAULT_ROW_HEIGHT = 240;
const OVERSCAN_PX = 960;

interface ChatMessageGroup {
  id: string;
  isUser: boolean;
  messages: Message[];
}

interface ChatMessageListProps {
  agentName: string;
  agentAvatarUrl?: string;
  agentColor?: string;
  isSending: boolean;
  messageGroups: ChatMessageGroup[];
  messageIndexMap: Map<string, number>;
  stableMessagesLength: number;
  traceRenderToken: string;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  renderMessageBody: (
    msg: Message,
    isUser: boolean,
    options?: { deferHeavyUi?: boolean; includeProcessPanel?: boolean },
  ) => ReactNode;
  renderMessageMetaControl?: (msg: Message, isUser: boolean) => ReactNode;
  renderMessageAttachments: (msg: Message, isUser: boolean) => ReactNode;
  renderMessageActions?: (msg: Message, isUser: boolean) => ReactNode;
  renderMessageFooter?: (msg: Message, isUser: boolean) => ReactNode;
  hasMessageBubbleContent: (msg: Message, isUser: boolean) => boolean;
  renderProcessPanel: (key: string, items: Message[]) => ReactNode;
  canRegenerateAt: (index: number) => boolean;
  formatElapsed: (ms?: number) => string;
  onRegenerateMessage: (messageId: string) => void;
}

interface ViewportState {
  height: number;
  scrollTop: number;
}

function ChatMessageRow({
  agentName,
  agentAvatarUrl,
  agentColor,
  group,
  groupIndex,
  isSending,
  messageIndexMap,
  onHeightChange,
  onRegenerateMessage,
  renderMessageBody,
  renderMessageMetaControl,
  renderMessageAttachments,
  renderMessageActions,
  renderMessageFooter,
  renderProcessPanel,
  hasMessageBubbleContent,
  canRegenerateAt,
  formatElapsed,
  stableMessagesLength,
}: {
  agentName: string;
  agentAvatarUrl?: string;
  agentColor?: string;
  group: ChatMessageGroup;
  groupIndex: number;
  isSending: boolean;
  messageIndexMap: Map<string, number>;
  onHeightChange?: (groupId: string, height: number) => void;
  onRegenerateMessage: (messageId: string) => void;
  renderMessageBody: ChatMessageListProps['renderMessageBody'];
  renderMessageMetaControl?: ChatMessageListProps['renderMessageMetaControl'];
  renderMessageAttachments: ChatMessageListProps['renderMessageAttachments'];
  renderMessageActions?: ChatMessageListProps['renderMessageActions'];
  renderMessageFooter?: ChatMessageListProps['renderMessageFooter'];
  renderProcessPanel: ChatMessageListProps['renderProcessPanel'];
  hasMessageBubbleContent: ChatMessageListProps['hasMessageBubbleContent'];
  canRegenerateAt: (index: number) => boolean;
  formatElapsed: (ms?: number) => string;
  stableMessagesLength: number;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const groupMessages = group.messages;
  const msg = groupMessages[groupMessages.length - 1];
  const isUser = group.isUser;
  const originalIndex = messageIndexMap.get(msg.id) ?? groupIndex;
  const deferHeavyUi = !isUser && stableMessagesLength > 18 && originalIndex < stableMessagesLength - 6;
  const canRegenerate = !isSending && canRegenerateAt(originalIndex);
  const messageAgentName = !isUser ? (msg.agentName || agentName) : '';
  const messageAgentAvatarUrl = !isUser ? (msg.agentAvatarUrl || agentAvatarUrl) : undefined;
  const messageAgentColor = !isUser ? (msg.agentColor || agentColor) : undefined;
  const elapsedText = msg.role === 'agent' && msg.generationElapsedMs != null
    ? formatElapsed(msg.generationElapsedMs)
    : '';
  useEffect(() => {
    if (!onHeightChange) return;
    const node = rowRef.current;
    if (!node) return;

    const report = () => {
      const nextHeight = node.getBoundingClientRect().height;
      if (nextHeight > 0) {
        onHeightChange(group.id, nextHeight);
      }
    };

    report();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      report();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [group.id, onHeightChange]);

  return (
    <div ref={rowRef} className={cn('chat-message-row', 'mb-6', isUser ? 'chat-message-row-user' : 'chat-message-row-agent')}>
      {!isUser ? (
        <div className="chat-avatar-frame">
          <AgentAvatar name={messageAgentName} avatarUrl={messageAgentAvatarUrl} color={messageAgentColor} size="md" />
        </div>
      ) : null}
      <div className="flex flex-col w-full min-w-0">
        {!isUser ? (
          <div className="chat-message-meta flex items-center justify-between">
            <div className="chat-message-meta-left">
              <span className="text-xs font-bold text-muted-foreground">{messageAgentName}</span>
              {renderMessageMetaControl?.(msg, isUser)}
              <span className="text-[10px] text-muted-foreground/60">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {elapsedText ? (
                <span className="text-[10px] text-muted-foreground/80">耗时 {elapsedText}</span>
              ) : null}
              {canRegenerate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-muted-foreground"
                  onClick={() => onRegenerateMessage(msg.id)}
                  title="重复生成本条回复"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  重复生成
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {!isUser ? renderProcessPanel(group.id, groupMessages) : null}
        <div className={cn(groupMessages.length > 1 ? 'space-y-4' : '')}>
          {groupMessages.map((item, itemIndex) => {
            const attachmentNode = renderMessageAttachments(item, isUser);
            const actionNode = renderMessageActions?.(item, isUser);
            const footerNode = renderMessageFooter?.(item, isUser);
            const showBubble = hasMessageBubbleContent(item, isUser);

            return (
              <div
                key={item.id}
                data-message-id={item.id}
                className={cn(
                  'transition-colors',
                  itemIndex > 0 ? 'border-t border-border/40 pt-4' : '',
                )}
              >
                {attachmentNode ? (
                  <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start', !showBubble && !isUser ? 'mt-1' : '')}>
                    {attachmentNode}
                  </div>
                ) : null}
                {showBubble ? (
                  <div
                    className={cn(
                      'chat-bubble-container flex w-full',
                      isUser ? 'justify-end' : 'justify-start mt-1',
                      attachmentNode ? 'mt-2' : '',
                    )}
                  >
                    <div className={cn('chat-bubble', isUser ? 'chat-bubble-user' : 'chat-bubble-agent')}>
                      {renderMessageBody(item, isUser, {
                        deferHeavyUi,
                        includeProcessPanel: false,
                      })}
                    </div>
                  </div>
                ) : null}
                {actionNode ? (
                  <div className={cn('mt-2 flex w-full', isUser ? 'justify-end' : 'justify-start')}>
                    {actionNode}
                  </div>
                ) : null}
                {footerNode ? (
                  <div className={cn('mt-2 flex w-full', isUser ? 'justify-end' : 'justify-start')}>
                    {footerNode}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChatMessageListInner({
  agentName,
  agentAvatarUrl,
  agentColor,
  isSending,
  messageGroups,
  messageIndexMap,
  stableMessagesLength,
  traceRenderToken,
  scrollContainerRef,
  renderMessageBody,
  renderMessageMetaControl,
  renderMessageAttachments,
  renderMessageActions,
  renderMessageFooter,
  renderProcessPanel,
  hasMessageBubbleContent,
  canRegenerateAt,
  formatElapsed,
  onRegenerateMessage,
}: ChatMessageListProps) {
  void traceRenderToken;

  const virtualizationEnabled = messageGroups.length >= VIRTUALIZATION_THRESHOLD;
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const [heightVersion, setHeightVersion] = useState(0);
  const [viewport, setViewport] = useState<ViewportState>({ height: 0, scrollTop: 0 });

  useEffect(() => {
    const validIds = new Set(messageGroups.map((group) => group.id));
    let changed = false;
    for (const key of measuredHeightsRef.current.keys()) {
      if (!validIds.has(key)) {
        measuredHeightsRef.current.delete(key);
        changed = true;
      }
    }
    if (changed) {
      setHeightVersion((prev) => prev + 1);
    }
  }, [messageGroups]);

  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) {
      return;
    }

    const updateViewport = () => {
      setViewport((prev) => {
        const nextHeight = node.clientHeight;
        const nextScrollTop = node.scrollTop;
        if (prev.height === nextHeight && prev.scrollTop === nextScrollTop) {
          return prev;
        }
        return {
          height: nextHeight,
          scrollTop: nextScrollTop,
        };
      });
    };

    updateViewport();
    node.addEventListener('scroll', updateViewport, { passive: true });
    window.addEventListener('resize', updateViewport);
    return () => {
      node.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [scrollContainerRef]);

  const handleHeightChange = useCallback((groupId: string, nextHeight: number) => {
    const roundedHeight = Math.max(1, Math.ceil(nextHeight));
    const currentHeight = measuredHeightsRef.current.get(groupId);
    if (currentHeight === roundedHeight) {
      return;
    }
    measuredHeightsRef.current.set(groupId, roundedHeight);
    setHeightVersion((prev) => prev + 1);
  }, []);

  const virtualMetrics = useMemo(() => {
    const heights = messageGroups.map((group) => measuredHeightsRef.current.get(group.id) ?? DEFAULT_ROW_HEIGHT);
    const offsets: number[] = new Array(messageGroups.length);
    let totalHeight = 0;
    for (let index = 0; index < messageGroups.length; index += 1) {
      offsets[index] = totalHeight;
      totalHeight += heights[index];
    }

    return {
      heights,
      offsets,
      totalHeight,
    };
  }, [heightVersion, messageGroups]);

  const visibleRange = useMemo(() => {
    if (!virtualizationEnabled || messageGroups.length === 0) {
      return {
        startIndex: 0,
        endIndex: messageGroups.length - 1,
      };
    }

    const viewportTop = Math.max(0, viewport.scrollTop - OVERSCAN_PX);
    const viewportBottom = viewport.scrollTop + Math.max(viewport.height, 0) + OVERSCAN_PX;
    const { heights, offsets } = virtualMetrics;

    let startIndex = 0;
    while (
      startIndex < messageGroups.length - 1
      && offsets[startIndex] + heights[startIndex] < viewportTop
    ) {
      startIndex += 1;
    }

    let endIndex = startIndex;
    while (
      endIndex < messageGroups.length - 1
      && offsets[endIndex] < viewportBottom
    ) {
      endIndex += 1;
    }

    return {
      startIndex,
      endIndex,
    };
  }, [messageGroups.length, viewport.height, viewport.scrollTop, virtualMetrics, virtualizationEnabled]);

  const visibleGroups = virtualizationEnabled
    ? messageGroups.slice(visibleRange.startIndex, visibleRange.endIndex + 1)
    : messageGroups;

  const topOffset = virtualizationEnabled && visibleGroups.length > 0
    ? virtualMetrics.offsets[visibleRange.startIndex] ?? 0
    : 0;

  if (!virtualizationEnabled) {
    return (
      <>
        {messageGroups.map((group, groupIndex) => (
          <ChatMessageRow
            key={group.id}
            agentName={agentName}
            agentAvatarUrl={agentAvatarUrl}
            agentColor={agentColor}
            group={group}
            groupIndex={groupIndex}
            isSending={isSending}
            messageIndexMap={messageIndexMap}
            onRegenerateMessage={onRegenerateMessage}
            renderMessageBody={renderMessageBody}
            renderMessageMetaControl={renderMessageMetaControl}
            renderMessageAttachments={renderMessageAttachments}
            renderMessageActions={renderMessageActions}
            renderMessageFooter={renderMessageFooter}
            renderProcessPanel={renderProcessPanel}
            hasMessageBubbleContent={hasMessageBubbleContent}
            canRegenerateAt={canRegenerateAt}
            formatElapsed={formatElapsed}
            stableMessagesLength={stableMessagesLength}
          />
        ))}
      </>
    );
  }

  return (
    <div
      className="relative w-full"
      style={{ height: virtualMetrics.totalHeight }}
    >
      <div
        className="absolute left-0 top-0 w-full"
        style={{ transform: `translateY(${topOffset}px)` }}
      >
        {visibleGroups.map((group, index) => (
          <ChatMessageRow
            key={group.id}
            agentName={agentName}
            agentAvatarUrl={agentAvatarUrl}
            agentColor={agentColor}
            group={group}
            groupIndex={visibleRange.startIndex + index}
            isSending={isSending}
            messageIndexMap={messageIndexMap}
            onHeightChange={handleHeightChange}
            onRegenerateMessage={onRegenerateMessage}
            renderMessageBody={renderMessageBody}
            renderMessageMetaControl={renderMessageMetaControl}
            renderMessageAttachments={renderMessageAttachments}
            renderMessageActions={renderMessageActions}
            renderMessageFooter={renderMessageFooter}
            renderProcessPanel={renderProcessPanel}
            hasMessageBubbleContent={hasMessageBubbleContent}
            canRegenerateAt={canRegenerateAt}
            formatElapsed={formatElapsed}
            stableMessagesLength={stableMessagesLength}
          />
        ))}
      </div>
    </div>
  );
}

export const ChatMessageList = memo(ChatMessageListInner);
