// ==================== Types ====================

/** Skill 元数据 */
export interface SkillMetadata {
  name: string;
  description: string;
  location: string;
}

/** Skill 文件信息 */
export interface SkillItem {
  id: string; // 技能标识（可能包含来源前缀）
  metadata: SkillMetadata;
  path: string; // 完整路径
  isSystem: boolean; // 是否为系统技能
  isNew: boolean; // 是否为新导入
}

/** Skill 导入输入 */
export interface SkillImportInput {
  sourcePath?: string;
  agentId?: string;
  homeDirOverride?: string;
}

export interface SkillScopeInput {
  agentId?: string;
  homeDirOverride?: string;
}

export interface SkillDeleteInput extends SkillScopeInput {
  skillId: string;
}

/** Skill 导入结果 */
export interface SkillImportResult {
  success: boolean;
  message?: string;
  skill?: SkillItem;
}

/** MCP 服务器配置 */
export interface McpServerConfig {
  id: string; // 服务器 ID
  name: string; // 显示名称
  description?: string; // 描述
  type: 'stdio' | 'sse' | 'streamableHttp' | string; // 类型
  enabled: boolean; // 是否启用
  path?: string; // 本地路径（如果是本地旧版）
  command?: string; // 启动命令 (stdio)
  args?: string[]; // 启动参数 (stdio)
  env?: Record<string, string>; // 环境变量 (stdio)
  url?: string; // URL (sse/streamableHttp)
  headers?: Record<string, string>; // 请求头 (streamableHttp)
  longRunning?: boolean; // 长时间运行模式
  timeout?: number; // 超时时间（秒）
}

/** MCP 创建输入 */
export interface McpServerCreateInput {
  name: string;
  type: McpServerConfig['type'];
  description?: string;
  enabled?: boolean;
  path?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  longRunning?: boolean;
  timeout?: number;
}

/** MCP 创建结果 */
export interface McpServerCreateResult {
  success: boolean;
  message?: string;
  server?: McpServerConfig;
}

/** MCP 导入输入 */
export interface McpServerImportInput {
  json: string;
  agentId?: string;
  homeDirOverride?: string;
}

export interface McpServerScopeInput {
  agentId?: string;
  homeDirOverride?: string;
}

export interface McpServerDeleteInput extends McpServerScopeInput {
  serverId: string;
}

export interface McpServerUpdateInput extends McpServerScopeInput {
  serverId: string;
  updates: Partial<McpServerConfig>;
}

/** MCP 导入结果 */
export interface McpServerImportResult {
  success: boolean;
  message?: string;
  count?: number;
}

/** MCP 删除结果 */
export interface McpServerDeleteResult {
  success: boolean;
  message?: string;
}
