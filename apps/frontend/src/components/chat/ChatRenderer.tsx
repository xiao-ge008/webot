import { memo } from 'react';
import type { ReactNode } from 'react';
import type { Agent } from '@/types';
import type { Message } from '@/data/mock-chats';
import type { ChatContextUsageMeter, ChatSendPayload, GroupUpgradeActionPayload } from '@/components/chat/ChatConversationPane';
import { ChatConversationPane } from '@/components/chat/ChatConversationPane';

export interface ChatRendererProps {
  agent: Agent;
  sessionTitle?: string;
  messages: Message[];
  isSending: boolean;
  inputLocked: boolean;
  autoConversationEnabled?: boolean;
  streamState: 'idle' | 'streaming' | 'waiting';
  streamingMessage?: Message | null;
  hideHeader?: boolean;
  inputToolbar?: ReactNode;
  contextUsage?: ChatContextUsageMeter;
  onUserActivity?: (source: 'input' | 'send' | 'focus' | 'keydown' | 'ui_action') => void;
  onSendMessage: (payload: ChatSendPayload) => void;
  onSendSilentMessage: (text: string) => void;
  onRegenerateMessage: (messageId: string) => void;
  onStopStreaming: () => void;
  onCreateTaskCard: (messageId: string) => void;
  onConfirmCreateTaskCard?: (messageId: string) => void;
  onCancelTaskCard: (messageId: string) => void;
  onDeleteTaskCard: (messageId: string) => void;
  onToggleAutoConversation?: () => void;
  onOpenTaskCardDetails: (input: { taskId?: string; messageId: string }) => void;
  onOpenA2aCardDetails: (messageId: string, cardId: string) => void;
  onConfirmGroupUpgrade?: (payload: GroupUpgradeActionPayload, ctx?: { messageId?: string }) => void;
  onCancelGroupUpgrade?: (payload: GroupUpgradeActionPayload, ctx?: { messageId?: string }) => void;
  onConfirmAgentManagement?: (payload: Record<string, unknown>, ctx?: { messageId?: string }) => void;
  onCancelAgentManagement?: (payload: Record<string, unknown>, ctx?: { messageId?: string }) => void;
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
  autoConversationEnabled,
  streamState,
  streamingMessage,
  hideHeader,
  inputToolbar,
  contextUsage,
  onUserActivity,
  onSendMessage,
  onSendSilentMessage,
  onRegenerateMessage,
  onStopStreaming,
  onCreateTaskCard,
  onConfirmCreateTaskCard,
  onCancelTaskCard,
  onDeleteTaskCard,
  onToggleAutoConversation,
  onOpenTaskCardDetails,
  onOpenA2aCardDetails,
  onConfirmGroupUpgrade,
  onCancelGroupUpgrade,
  onConfirmAgentManagement,
  onCancelAgentManagement,
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
      autoConversationEnabled={autoConversationEnabled}
      streamState={streamState}
      streamingMessage={streamingMessage}
      hideHeader={hideHeader}
      inputToolbar={inputToolbar}
      contextUsage={contextUsage}
      onUserActivity={onUserActivity}
      onSendMessage={onSendMessage}
      onSendSilentMessage={onSendSilentMessage}
      onRegenerateMessage={onRegenerateMessage}
      onStopStreaming={onStopStreaming}
      onCreateTaskCard={onCreateTaskCard}
      onConfirmCreateTaskCard={onConfirmCreateTaskCard}
      onCancelTaskCard={onCancelTaskCard}
      onDeleteTaskCard={onDeleteTaskCard}
      onToggleAutoConversation={onToggleAutoConversation}
      onOpenTaskCardDetails={onOpenTaskCardDetails}
      onOpenA2aCardDetails={onOpenA2aCardDetails}
      onConfirmGroupUpgrade={onConfirmGroupUpgrade}
      onCancelGroupUpgrade={onCancelGroupUpgrade}
      onConfirmAgentManagement={onConfirmAgentManagement}
      onCancelAgentManagement={onCancelAgentManagement}
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
  && prev.autoConversationEnabled === next.autoConversationEnabled
  && prev.streamState === next.streamState
  && prev.streamingMessage === next.streamingMessage
  && prev.hideHeader === next.hideHeader
  && prev.inputToolbar === next.inputToolbar
  && prev.contextUsage === next.contextUsage
  && prev.onUserActivity === next.onUserActivity
  && prev.onToggleAutoConversation === next.onToggleAutoConversation
  && prev.onConfirmGroupUpgrade === next.onConfirmGroupUpgrade
  && prev.onCancelGroupUpgrade === next.onCancelGroupUpgrade
  && prev.onConfirmAgentManagement === next.onConfirmAgentManagement
  && prev.onCancelAgentManagement === next.onCancelAgentManagement
  && prev.sidebarCollapsed === next.sidebarCollapsed
  && prev.infoSidebarCollapsed === next.infoSidebarCollapsed
));
