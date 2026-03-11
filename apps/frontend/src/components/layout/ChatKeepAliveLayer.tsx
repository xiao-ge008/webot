import { useEffect, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { ChatPage } from '@/pages/ChatPage';

const MAX_CHAT_CACHE = 6;

export function ChatKeepAliveLayer() {
  const location = useLocation();
  const match = matchPath('/chat/:id', location.pathname);
  const activeChatId = typeof match?.params?.id === 'string' ? match.params.id : '';
  const [cachedChatIds, setCachedChatIds] = useState<string[]>([]);

  useEffect(() => {
    if (!activeChatId) return;
    setCachedChatIds((prev) => {
      const withoutCurrent = prev.filter((id) => id !== activeChatId);
      const next = [...withoutCurrent, activeChatId];
      if (next.length <= MAX_CHAT_CACHE) {
        return next;
      }
      return next.slice(next.length - MAX_CHAT_CACHE);
    });
  }, [activeChatId]);

  if (cachedChatIds.length === 0) {
    return null;
  }

  return (
    <>
      {cachedChatIds.map((chatId) => {
        const visible = Boolean(activeChatId) && chatId === activeChatId;
        return (
          <div
            key={chatId}
            className="flex-1 min-h-0 flex flex-col"
            style={{ display: visible ? 'flex' : 'none' }}
          >
            <ChatPage agentId={chatId} />
          </div>
        );
      })}
    </>
  );
}

