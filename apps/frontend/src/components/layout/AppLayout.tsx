import { Outlet, useLocation } from 'react-router-dom';
import { Header, HomeTabProvider } from './Header';
import { Footer } from './Footer';
import { InAppNotificationCenter } from '@/components/ui/in-app-notification-center';
import { ChatKeepAliveLayer } from './ChatKeepAliveLayer';
import { TaskNoticeBridge } from '@/components/tasks/TaskNoticeBridge';

/** 全局布局：顶部导航栏 + 内容区 */
export function AppLayout() {
  const location = useLocation();
  const isChatPage = location.pathname.startsWith('/chat/') || location.pathname.startsWith('/group-chat/');
  const isPrivateChatConversationPage = location.pathname.startsWith('/chat/')
    && !location.pathname.endsWith('/context');

  return (
    <HomeTabProvider>
      <div className="flex flex-col min-h-screen bg-background">
        {/* 顶部导航栏 */}
        <Header />
        <InAppNotificationCenter />
        <TaskNoticeBridge />

      {/* 主内容区 */}
      <main className="flex-1 min-h-0 pt-14 flex flex-col items-stretch">
        {isPrivateChatConversationPage ? <ChatKeepAliveLayer /> : null}
        {!isPrivateChatConversationPage ? <Outlet /> : null}
      </main>

        {/* 仅在非聊天页面显示底部信息栏 */}
        {!isChatPage && <Footer />}
      </div>
    </HomeTabProvider>
  );
}
