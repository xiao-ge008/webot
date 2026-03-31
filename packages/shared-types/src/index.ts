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

export type CapabilityScope = 'generic' | 'self'

export type CapabilityKey =
  | 'generate.image'
  | 'edit.image'
  | 'generate.video'
  | 'edit.video'
  | 'extract.media_audio'
  | 'extract.media_frames'
  | 'subtitle.generate'
  | 'media.trim'
  | 'generate.audio'
  | 'transcribe.audio'
  | 'analyze.media'
  | 'parse.document'
  | 'extract.document'
  | 'summarize.document'
  | 'convert.document'
  | 'compare.document'
  | 'preview.document'
  | 'chunk.document'
  | 'patch.identity'
  | 'patch.memory'
  | 'review.upgrade'
  | 'apply.upgrade'

export type AssetRefKind =
  | 'workspace_file'
  | 'absolute_file'
  | 'upload_url'
  | 'management_media_url'
  | 'remote_url'
  | 'data_url'
  | 'derived_asset'

export interface AssetRef {
  assetId?: string
  kind: AssetRefKind
  uri: string
  mimeType?: string
  fileName?: string
  byteSize?: number
  width?: number
  height?: number
  durationMs?: number
  metadata?: Record<string, unknown>
  derivedFromAssetId?: string
}

export interface JobProgress {
  current?: number
  total?: number
  percent?: number
  stage?: string
  message?: string
}

export interface Job {
  id: string
  capability: CapabilityKey
  scope: CapabilityScope
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  providerId?: string
  providerType?: CapabilityProviderType
  createdAt: string
  updatedAt: string
  progress?: JobProgress
  input?: Record<string, unknown>
  output?: PresentableResult
  error?: string
}

export type PresentableResultKind =
  | 'text_result'
  | 'media_result'
  | 'document_result'
  | 'choice_result'
  | 'confirm_result'
  | 'patch_result'
  | 'review_result'
  | 'job_result'
  | 'error_result'

export interface PresentableResultBase {
  kind: PresentableResultKind
  title?: string
  summary?: string
  providerMeta?: CapabilityProviderMeta
}

export interface TextResult extends PresentableResultBase {
  kind: 'text_result'
  text: string
  markdown?: string
}

export interface MediaResultItem {
  mediaType: 'image' | 'video' | 'audio'
  asset: AssetRef
  posterAsset?: AssetRef
  transcript?: string
  caption?: string
  durationMs?: number
}

export interface MediaResult extends PresentableResultBase {
  kind: 'media_result'
  mediaType: 'image' | 'video' | 'audio'
  items: MediaResultItem[]
}

export type DocumentType =
  | 'pdf'
  | 'doc'
  | 'docx'
  | 'xls'
  | 'xlsx'
  | 'csv'
  | 'ppt'
  | 'pptx'
  | 'txt'
  | 'md'
  | 'json'
  | 'compare'
  | 'convert'
  | 'unknown'

export interface DocumentPreviewMeta {
  channel?: string
  renderer?: string
  mimeType?: string
  pageCount?: number
  fileName?: string
}

export interface DocumentConversionOutput {
  format: string
  asset: AssetRef
  label?: string
}

export interface DocumentCompareDiff {
  summary?: string
  markdown?: string
  additions?: number
  deletions?: number
  changes?: number
  asset?: AssetRef
}

export interface DocumentResult extends PresentableResultBase {
  kind: 'document_result'
  documentType: DocumentType
  sourceAsset: AssetRef
  previewAsset?: AssetRef
  downloadAsset?: AssetRef
  pageCount?: number
  extractedText?: string
  summaryText?: string
  compareDiff?: DocumentCompareDiff
  conversionOutputs?: DocumentConversionOutput[]
  previewMeta?: DocumentPreviewMeta
}

export interface ChoiceResultOption {
  id: string
  label: string
  description?: string
  value?: string
}

export interface ChoiceResult extends PresentableResultBase {
  kind: 'choice_result'
  options: ChoiceResultOption[]
}

export interface ConfirmResult extends PresentableResultBase {
  kind: 'confirm_result'
  confirmAction: string
  cancelAction?: string
  payload?: Record<string, unknown>
}

export interface PatchOperation {
  target: string
  action: 'create' | 'update' | 'delete'
  before?: string
  after?: string
  summary?: string
}

export interface PatchResult extends PresentableResultBase {
  kind: 'patch_result'
  operations: PatchOperation[]
}

export interface ReviewFinding {
  level: 'info' | 'warning' | 'critical'
  title: string
  detail?: string
}

export interface ReviewResult extends PresentableResultBase {
  kind: 'review_result'
  verdict?: 'approved' | 'rejected' | 'needs_confirmation'
  findings: ReviewFinding[]
}

export interface JobResult extends PresentableResultBase {
  kind: 'job_result'
  job: Job
}

export interface ErrorResult extends PresentableResultBase {
  kind: 'error_result'
  code: string
  message: string
  retryable?: boolean
}

export type PresentableResult =
  | TextResult
  | MediaResult
  | DocumentResult
  | ChoiceResult
  | ConfirmResult
  | PatchResult
  | ReviewResult
  | JobResult
  | ErrorResult

export type CapabilityProviderType =
  | 'runtime_native'
  | 'component_skill'
  | 'generic_provider'
  | 'model_fallback'

export interface CapabilityProviderRef {
  providerId: string
  providerType: CapabilityProviderType
}

export interface CapabilityDescriptor {
  key: CapabilityKey
  scope: CapabilityScope
}

export interface CapabilityProviderMeta extends CapabilityProviderRef {
  capability?: CapabilityKey
  scope?: CapabilityScope
  priority?: number
}

export type ProviderHealthState =
  | 'unknown'
  | 'healthy'
  | 'degraded'
  | 'disabled'
  | 'unavailable'

export interface CapabilityProviderRecord extends CapabilityProviderRef {
  displayName?: string
  capabilities: CapabilityDescriptor[]
  supportedScopes: CapabilityScope[]
  priority: number
  requirements?: Record<string, unknown>
  supportsJob: boolean
  enabled: boolean
  healthState: ProviderHealthState
  inputContract?: Record<string, unknown>
  outputContract?: Record<string, unknown>
  metadata?: Record<string, unknown>
  updatedAt?: string
}

export interface CapabilityBinding {
  capability: CapabilityKey
  scope: CapabilityScope
  providerId?: string
  enabled: boolean
}

export interface AgentCapabilityBindingRecord extends CapabilityBinding {
  agentId: string
  bindingType: 'capability' | 'provider'
  updatedAt?: string
}

export interface RendererBinding {
  channel: string
  resultKind: PresentableResultKind
  rendererKey: string
  mediaType?: 'image' | 'video' | 'audio'
  documentType?: DocumentType
  enabled: boolean
  fallbackChannel?: string
}

export interface RendererBindingRecord extends RendererBinding {
  updatedAt?: string
}

export interface BindingConflictResult {
  ok: boolean
  reason?: string
  conflicts?: string[]
}
