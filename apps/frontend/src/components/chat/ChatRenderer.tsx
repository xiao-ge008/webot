import { memo } from 'react';
import type { ReactNode } from 'react';
import type { Agent } from '@/types';
import type { Message } from '@/data/mock-chats';
import type { GroupUpgradeActionPayload } from '@/components/chat/ChatConversationPane';
import { ChatConversationPane } from '@/components/chat/ChatConversationPane';

export interface ChatRendererProps {
  agent: Agent;
  sessionTitle?: string;
  messages: Message[];
  isSending: boolean;
  inputLocked: boolean;
  streamState: 'idle' | 'streaming' | 'waiting';
  streamingMessage?: Message | null;
  hideHeader?: boolean;
  inputToolbar?: ReactNode;
  onUserActivity?: (source: 'input' | 'send' | 'focus' | 'keydown' | 'ui_action') => void;
  onSendMessage: (text: string) => void;
  onSendSilentMessage: (text: string) => void;
  onRegenerateMessage: (messageId: string) => void;
  onStopStreaming: () => void;
  onCreateTaskCard: (messageId: string) => void;
  onConfirmCreateTaskCard?: (messageId: string) => void;
  onCancelTaskCard: (messageId: string) => void;
  onDeleteTaskCard: (messageId: string) => void;
  onOpenTaskCardDetails: (taskId: string) => void;
  onOpenA2aCardDetails: (messageId: string, cardId: string) => void;
  onConfirmGroupUpgrade?: (payload: GroupUpgradeActionPayload, ctx?: { messageId?: string }) => void;
  onCancelGroupUpgrade?: (payload: GroupUpgradeActionPayload, ctx?: { messageId?: string }) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  infoSidebarCollapsed: boolean;
  setInfoSidebarCollapsed: (v: boolean) => void;
}

export const ChatRenderer = memo(function ChatRenderer({
  agent,
  sessionTitle,
  messages,
  isSending,
  inputLocked,
  streamState,
  streamingMessage,
  hideHeader,
  inputToolbar,
  onUserActivity,
  onSendMessage,
  onSendSilentMessage,
  onRegenerateMessage,
  onStopStreaming,
  onCreateTaskCard,
  onConfirmCreateTaskCard,
  onCancelTaskCard,
  onDeleteTaskCard,
  onOpenTaskCardDetails,
  onOpenA2aCardDetails,
  onConfirmGroupUpgrade,
  onCancelGroupUpgrade,
  sidebarCollapsed,
  setSidebarCollapsed,
  infoSidebarCollapsed,
  setInfoSidebarCollapsed,
}: ChatRendererProps) {
  return (
    <ChatConversationPane
      agent={agent}
      sessionTitle={sessionTitle}
      messages={messages}
      isSending={isSending}
      inputLocked={inputLocked}
      streamState={streamState}
      streamingMessage={streamingMessage}
      hideHeader={hideHeader}
      inputToolbar={inputToolbar}
      onUserActivity={onUserActivity}
      onSendMessage={onSendMessage}
      onSendSilentMessage={onSendSilentMessage}
      onRegenerateMessage={onRegenerateMessage}
      onStopStreaming={onStopStreaming}
      onCreateTaskCard={onCreateTaskCard}
      onConfirmCreateTaskCard={onConfirmCreateTaskCard}
      onCancelTaskCard={onCancelTaskCard}
      onDeleteTaskCard={onDeleteTaskCard}
      onOpenTaskCardDetails={onOpenTaskCardDetails}
      onOpenA2aCardDetails={onOpenA2aCardDetails}
      onConfirmGroupUpgrade={onConfirmGroupUpgrade}
      onCancelGroupUpgrade={onCancelGroupUpgrade}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
      infoSidebarCollapsed={infoSidebarCollapsed}
      onToggleInfoSidebar={() => setInfoSidebarCollapsed(!infoSidebarCollapsed)}
    />
  );
}, (prev, next) => (
  prev.agent === next.agent
  && prev.sessionTitle === next.sessionTitle
  && prev.messages === next.messages
  && prev.isSending === next.isSending
  && prev.inputLocked === next.inputLocked
  && prev.streamState === next.streamState
  && prev.streamingMessage === next.streamingMessage
  && prev.hideHeader === next.hideHeader
  && prev.inputToolbar === next.inputToolbar
  && prev.onUserActivity === next.onUserActivity
  && prev.onConfirmGroupUpgrade === next.onConfirmGroupUpgrade
  && prev.onCancelGroupUpgrade === next.onCancelGroupUpgrade
  && prev.sidebarCollapsed === next.sidebarCollapsed
  && prev.infoSidebarCollapsed === next.infoSidebarCollapsed
));
