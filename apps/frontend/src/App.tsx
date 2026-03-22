import { Routes, Route, useLocation, type Location } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { HomePage } from '@/pages/HomePage';
import { AgentListPage } from '@/pages/AgentListPage';
import { CreateAgentPage } from '@/pages/CreateAgentPage';
import { CreateGroupPage } from '@/pages/CreateGroupPage';
import { EditAgentPage } from '@/pages/EditAgentPage';
import { ImportPage } from '@/pages/ImportPage';
import { GroupChatPage } from '@/pages/GroupChatPage';
import { TaskCenterPage } from '@/pages/TaskCenterPage';
import { ComponentCenterPage } from '@/pages/ComponentCenterPage';
import { ChatPage } from '@/pages/ChatPage';
import { AgentTaskManagerPage } from '@/pages/AgentTaskManagerPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ContextManagerPage } from '@/pages/ContextManagerPage';

type ModalState = {
  backgroundLocation?: Location;
};

function App() {
  const location = useLocation();
  const backgroundLocation = (location.state as ModalState | null)?.backgroundLocation;

  return (
    <>
      <Routes location={backgroundLocation ?? location}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/agents" element={<AgentListPage />} />
          <Route path="/tasks" element={<TaskCenterPage />} />
          <Route path="/components" element={<ComponentCenterPage />} />
          <Route path="/create" element={<CreateAgentPage />} />
          <Route path="/groups/create" element={<CreateGroupPage />} />
          <Route path="/edit/:id" element={<EditAgentPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/chat/:id/context" element={<ContextManagerPage />} />
          <Route path="/group-chat/:id/context" element={<ContextManagerPage />} />
          <Route path="/chat/:id" element={<ChatPage />} />
          <Route path="/group-chat/:id" element={<GroupChatPage />} />
          <Route path="/agent/:id/tasks" element={<AgentTaskManagerPage />} />
        </Route>

        {/* 直接访问 /settings 时的“全屏页面” */}
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>

      {/* 从应用内打开 /settings 时的“全屏覆盖层”，保留打开前界面状态 */}
      {backgroundLocation && (
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      )}
    </>
  );
}

export default App;
