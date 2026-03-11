import path from 'node:path';
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';

import { ensureAgentWorkspace } from './shared-workspace-manager';

export type AgentCollaborationEventKind =
  | 'chat_started'
  | 'runtime_log'
  | 'tool_call'
  | 'delegate_call'
  | 'ipc_call'
  | 'chat_done'
  | 'chat_error';

export interface AgentCollaborationEvent {
  eventId: string;
  agentId: string;
  requestId: string;
  kind: AgentCollaborationEventKind;
  message: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

function toDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createEventId(now = new Date()): string {
  return `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeLine(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function inferEventKindFromRuntimeLog(line: string): AgentCollaborationEventKind {
  const lower = line.toLowerCase();
  if (
    lower.includes('delegate') ||
    lower.includes('subagent') ||
    lower.includes('sub-agent') ||
    lower.includes('agent_call')
  ) {
    return 'delegate_call';
  }
  if (
    lower.includes('agents_send') ||
    lower.includes('agents_inbox') ||
    lower.includes('agents_list') ||
    lower.includes('agents_ipc')
  ) {
    return 'ipc_call';
  }
  if (
    lower.includes('tool') ||
    lower.includes('/api/tools') ||
    lower.includes('mcp') ||
    lower.includes('function call')
  ) {
    return 'tool_call';
  }
  return 'runtime_log';
}

async function resolveEventFilePath(agentId: string, homeDirOverride?: string): Promise<string> {
  const workspace = await ensureAgentWorkspace(agentId, homeDirOverride);
  const eventDir = path.join(workspace.privateLogsRoot, 'collaboration');
  await mkdir(eventDir, { recursive: true });
  return path.join(eventDir, `${toDateKey()}.jsonl`);
}

export async function appendAgentCollaborationEvent(
  agentId: string,
  requestId: string,
  event: Omit<AgentCollaborationEvent, 'eventId' | 'agentId' | 'requestId' | 'createdAt'> & {
    createdAt?: string;
  },
  homeDirOverride?: string,
): Promise<void> {
  const now = new Date();
  const payload: AgentCollaborationEvent = {
    eventId: createEventId(now),
    agentId,
    requestId,
    kind: event.kind,
    message: normalizeLine(event.message).slice(0, 2000),
    createdAt: event.createdAt ?? now.toISOString(),
    meta: event.meta,
  };

  const filePath = await resolveEventFilePath(agentId, homeDirOverride);
  await appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
}

export interface GetAgentCollaborationEventsInput {
  agentId: string;
  limit?: number;
  homeDirOverride?: string;
}

export async function getRecentAgentCollaborationEvents(
  input: GetAgentCollaborationEventsInput,
): Promise<AgentCollaborationEvent[]> {
  const workspace = await ensureAgentWorkspace(input.agentId, input.homeDirOverride);
  const eventDir = path.join(workspace.privateLogsRoot, 'collaboration');
  const limit = Math.max(1, Math.min(2000, input.limit ?? 200));

  let files: string[] = [];
  try {
    files = (await readdir(eventDir)).filter((name) => name.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }

  const result: AgentCollaborationEvent[] = [];
  for (let index = files.length - 1; index >= 0; index -= 1) {
    if (result.length >= limit) break;
    const filePath = path.join(eventDir, files[index]);
    let content = '';
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/).filter(Boolean);
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      if (result.length >= limit) break;
      const raw = lines[lineIndex];
      try {
        const item = JSON.parse(raw) as AgentCollaborationEvent;
        if (item?.agentId === input.agentId && typeof item.requestId === 'string') {
          result.push(item);
        }
      } catch {
        // ignore malformed line
      }
    }
  }

  return result.reverse();
}
