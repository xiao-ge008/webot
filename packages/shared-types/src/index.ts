export type SkillKind = 'ui' | 'tool' | 'data'

export interface SkillDefinition {
  id: string
  name: string
  kind: SkillKind
  description: string
  version: string
  entry?: string
  promptHeader?: string
}

export interface McpServerDefinition {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  description: string
}

export interface AgentWorkspace {
  id: string
  name: string
  rootPath: string
  memoryPath: string
  cachePath: string
}

export interface AgentDefinition {
  id: string
  name: string
  model: string
  systemPrompt: string
  workspaceId: string
  skillIds: string[]
  mcpIds: string[]
  tags: string[]
}

export type ChatType = 'private' | 'group'

export interface ChatSessionDefinition {
  id: string
  title: string
  type: ChatType
  participantAgentIds: string[]
}

export interface ChatMessage {
  id: string
  sessionId: string
  senderAgentId?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export interface AgentRuntimeConfigFile {
  agent: AgentDefinition
  workspace: AgentWorkspace
  skills: SkillDefinition[]
  mcps: McpServerDefinition[]
}
