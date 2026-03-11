import { type ChangeEvent, type DragEventHandler, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileArchive, Loader2 } from 'lucide-react';
import { importManagementAgentBundle } from '@/services/management-client';
import type { Message, MessageToolCall } from '@/data/mock-chats';
import {
  loadAgentChatState,
  saveAgentChatState,
  type StoredAgentChatState,
  type StoredChatSession,
} from '@/services/chat-session-store';

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeImportedRole(value: unknown): Message['role'] {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (role.includes('user')) return 'user';
  if (role.includes('assistant') || role.includes('agent')) return 'agent';
  return 'system';
}

function normalizeImportedToolCalls(value: unknown): MessageToolCall[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rows: MessageToolCall[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isRecord(item)) {
      continue;
    }
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) {
      continue;
    }
    rows.push({
      id: `import_tool_${Date.now()}_${index}`,
      name,
      running: false,
      expanded: false,
      input: typeof item.input === 'string' ? item.input : undefined,
      result: typeof item.result === 'string' ? item.result : undefined,
      is_error: typeof item.is_error === 'boolean' ? item.is_error : undefined,
    });
  }
  return rows.length > 0 ? rows : undefined;
}

function restoreImportedChatHistory(agentId: string, payload: unknown): number {
  if (!agentId.trim() || !isRecord(payload)) {
    return 0;
  }
  const messageRows = Array.isArray(payload.messages) ? payload.messages.filter(isRecord) : [];
  if (messageRows.length === 0) {
    return 0;
  }

  const startAt = Date.now() - messageRows.length * 1000;
  const messages: Message[] = messageRows
    .map((row, index) => {
      const text = typeof row.content === 'string'
        ? row.content
        : (typeof row.message === 'string' ? row.message : '');
      const tools = normalizeImportedToolCalls(row.tools);
      if (!text.trim() && (!tools || tools.length === 0)) {
        return null;
      }
      return {
        id: `import_msg_${Date.now()}_${index}`,
        role: normalizeImportedRole(row.role),
        text,
        timestamp: new Date(startAt + index * 1000).toISOString(),
        tools,
      } as Message;
    })
    .filter((item): item is Message => item != null);

  if (messages.length === 0) {
    return 0;
  }

  const sessionIdRaw = typeof payload.session_id === 'string' ? payload.session_id.trim() : '';
  const sessionLabelRaw = typeof payload.label === 'string' ? payload.label.trim() : '';
  const session: StoredChatSession = {
    id: sessionIdRaw ? `imported_${sessionIdRaw}` : `imported_${Date.now()}`,
    title: sessionLabelRaw || '导入会话',
    updatedAt: Date.now(),
    messages,
    streamState: 'idle',
  };

  const state: StoredAgentChatState = {
    sessions: [session],
    activeSessionId: session.id,
  };
  saveAgentChatState(agentId, state);
  return messages.length;
}

function cloneLocalHistoryFromSource(sourceAgentId: string | undefined, targetAgentId: string): number {
  const sourceId = (sourceAgentId || '').trim();
  const targetId = targetAgentId.trim();
  if (!sourceId || !targetId || sourceId === targetId) {
    return 0;
  }
  const sourceState = loadAgentChatState(sourceId);
  if (!sourceState?.sessions?.length) {
    return 0;
  }
  saveAgentChatState(targetId, sourceState);
  return sourceState.sessions.reduce((sum, session) => sum + session.messages.length, 0);
}

export function ImportPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastMessage, setLastMessage] = useState('');

  const openPicker = () => {
    inputRef.current?.click();
  };

  const handleSelectFile = (file: File | null) => {
    if (!file) {
      return;
    }
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.zip')) {
      alert('仅支持导入 zip 压缩包');
      return;
    }
    setLastMessage('');
    setSelectedFile(file);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    handleSelectFile(file);
    event.currentTarget.value = '';
  };

  const handleDrop: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    handleSelectFile(file);
  };

  const handleImport = async () => {
    if (!selectedFile) {
      alert('请先选择导出包文件');
      return;
    }
    setImporting(true);
    try {
      const result = await importManagementAgentBundle(selectedFile);
      const warningCount = result.warnings?.length ?? 0;
      const restoredFromBundle = restoreImportedChatHistory(result.agent_id, result.chat_session);
      const restoredMessages =
        restoredFromBundle > 0
          ? restoredFromBundle
          : cloneLocalHistoryFromSource(result.source_agent_id, result.agent_id);
      const restoredSuffix =
        restoredMessages > 0 ? `，已恢复 ${restoredMessages} 条聊天记录` : '';
      setLastMessage(
        warningCount > 0
          ? `导入完成（含 ${warningCount} 条恢复警告）${restoredSuffix}，已进入智能体编辑页。`
          : `导入成功${restoredSuffix}，已进入智能体编辑页。`,
      );
      navigate(`/edit/${encodeURIComponent(result.agent_id)}`);
    } catch (error) {
      alert(error instanceof Error ? error.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="px-10 py-8 max-w-[800px] mx-auto">
      <div className="mb-8 animate-fade-in opacity-0">
        <h1 className="text-2xl font-semibold tracking-tight">导入智能体</h1>
        <p className="text-foreground-secondary mt-1">上传已导出的智能体 ZIP 包，一次完成恢复。</p>
      </div>

      <Card className="animate-fade-in opacity-0 stagger-1">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileArchive className="w-4 h-4 text-accent" />
            上传导入
          </CardTitle>
        </CardHeader>
        <CardContent>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="hidden"
            onChange={handleFileInputChange}
          />
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
              dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
            }`}
            onClick={openPicker}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragging(false);
            }}
            onDrop={handleDrop}
          >
            <Upload className="w-8 h-8 mx-auto text-foreground-tertiary mb-3" />
            <p className="text-sm font-medium">拖拽 ZIP 到此处，或点击选择文件</p>
            <p className="text-xs text-foreground-tertiary mt-1">仅支持智能体导出包（.zip）</p>
            {selectedFile ? (
              <p className="text-xs mt-3 text-foreground-secondary">
                已选择：{selectedFile.name}（{formatBytes(selectedFile.size)}）
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-3 mt-4">
            <Button variant="outline" className="rounded-xl" onClick={openPicker} disabled={importing}>
              选择文件
            </Button>
            <Button className="rounded-xl gap-2" onClick={handleImport} disabled={importing || !selectedFile}>
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {importing ? '导入中...' : '上传并导入'}
            </Button>
          </div>

          {lastMessage ? <p className="text-xs text-muted-foreground mt-3">{lastMessage}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
