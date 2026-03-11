import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { HomePage } from '@/pages/HomePage';
import { AgentListPage } from '@/pages/AgentListPage';
import { CreateAgentPage } from '@/pages/CreateAgentPage';
import { CreateGroupPage } from '@/pages/CreateGroupPage';
import { EditAgentPage } from '@/pages/EditAgentPage';
import { ImportPage } from '@/pages/ImportPage';
import { GroupChatPage } from '@/pages/GroupChatPage';
import { TaskCenterPage } from '@/pages/TaskCenterPage';
import { ChatPage } from '@/pages/ChatPage';

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/agents" element={<AgentListPage />} />
        <Route path="/tasks" element={<TaskCenterPage />} />
        <Route path="/create" element={<CreateAgentPage />} />
        <Route path="/groups/create" element={<CreateGroupPage />} />
        <Route path="/edit/:id" element={<EditAgentPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/chat/:id" element={<ChatPage />} />
        <Route path="/group-chat/:id" element={<GroupChatPage />} />
      </Route>
    </Routes>
  );
}

export default App;
