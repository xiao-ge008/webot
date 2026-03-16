# Webot 智能体自动创建策略

本文档用于指导 AI 在不依赖人工逐项点击后台界面的前提下，直接基于 Webot 运行目录完成智能体创建、工作区初始化、上下文文件落地，以及 SQLite 本地数据补齐。

## 1. 路径约定

### 1.1 实际默认根目录

当前项目代码默认读取的是 `WEBOT_HOME`，如果没有显式设置，则使用：

- Windows: `%USERPROFILE%\\.webot`
- macOS / Linux: `~/.webot`

代码位置：

- `apps/service-rs/src/path_resolver.rs`

### 1.2 如果你想强制使用 `~/webot`

你可以在启动前设置：

```bash
export WEBOT_HOME=~/webot
```

Windows PowerShell:

```powershell
$env:WEBOT_HOME="$HOME\webot"
```

如果没有设置 `WEBOT_HOME`，AI 必须按 `~/.webot` 处理，而不是 `~/webot`。

## 2. AI 执行原则

AI 创建智能体时，必须遵守下面的优先级：

1. 先创建 OpenFang 运行时里的真实智能体。
2. 再补齐 `WEBOT_HOME` 下的工作区目录和媒体目录。
3. 再写入 `management.sqlite3` 中的本地覆盖数据。
4. 最后做一次上下文文件和 MCP 分配同步校验。

重要说明：

- `management.sqlite3` 不是智能体主数据源。
- 真正的智能体实体由 OpenFang `/api/agents` 创建。
- 只写 SQLite，不调用创建接口，智能体不会出现在运行时列表中。

## 3. 目录结构

AI 至少要保证以下目录存在：

```text
$WEBOT_HOME/
  config.toml
  shared/
    data/
      management.sqlite3
  skills/
  workspaces/
    <workspace_segment>/
      agent_profile/
        avatar/
        portrait/
      data/
        chat-assets/
```

其中：

- `shared/data/management.sqlite3` 是管理端 SQLite。
- `workspaces/<workspace_segment>` 是智能体私有工作区。
- `agent_profile/avatar` 和 `agent_profile/portrait` 用于头像与立绘。
- `data/chat-assets` 用于聊天附件。

## 4. 必须创建的运行时对象

AI 创建一个完整智能体，至少要准备以下内容：

### 4.1 OpenFang 智能体实体

必须调用：

- `POST /api/management/agents`

请求体格式：

```json
{
  "manifest_toml": "name = \"alice\"\ndescription = \"你的说明\"\n\n[model]\nprovider = \"openai\"\nmodel = \"gpt-4.1\""
}
```

最小要求：

- `name`
- `description`
- `[model].provider`
- `[model].model`

返回后必须拿到：

- `agent_id`

如果没有 `agent_id`，本次创建视为失败。

### 4.2 8 个上下文文件

当前网关代码内置的标准上下文文件列表为：

- `SOUL.md`
- `USER.md`
- `TOOLS.md`
- `MEMORY.md`
- `AGENTS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `HEARTBEAT.md`

这 8 个文件必须全部初始化，即使内容暂时为空也要建档。

### 4.3 工作区

工作区目录名解析优先级：

1. `agent_profile_overrides.english_name`
2. 上游 agent 详情里的 `english_name`
3. 上游 agent 详情里的 `name`
4. `agent_id`

因此，若要保证工作区目录名稳定，AI 应优先写入 `english_name`。

## 5. SQLite 必须补齐的表

SQLite 路径：

```text
$WEBOT_HOME/shared/data/management.sqlite3
```

至少会用到这些表：

- `agent_profile_overrides`
- `agent_context_files`
- `agent_workspace_folders`
- `agent_skill_toggles`
- `agent_mcp_toggles`
- `hidden_agents`

可选表：

- `chat_groups`
- `chat_group_members`
- `chat_group_admins`

如果只是创建单个智能体，不要写群聊表。

## 6. AI 推荐执行顺序

### 步骤 1. 解析根目录

AI 必须按下面顺序确定根目录：

1. 读取环境变量 `WEBOT_HOME`
2. 若不存在，则回退到 `~/.webot`

### 步骤 2. 确保基础目录存在

AI 必须创建：

- `$WEBOT_HOME/shared/data`
- `$WEBOT_HOME/skills`
- `$WEBOT_HOME/workspaces`

### 步骤 3. 创建运行时智能体

调用：

- `POST /api/management/agents`

然后记录返回的 `agent_id`。

### 步骤 4. 写入智能体资料覆盖

写入 `agent_profile_overrides`，至少建议包含：

- `agent_id`
- `description`
- `system_prompt`
- `english_name`
- `nickname`
- `avatar_url`
- `portrait_url`
- `tags_json`
- `collaboration_json`
- `channel_binding_json`

### 步骤 5. 创建私有工作区目录

创建：

```text
$WEBOT_HOME/workspaces/<workspace_segment>/
$WEBOT_HOME/workspaces/<workspace_segment>/agent_profile/avatar/
$WEBOT_HOME/workspaces/<workspace_segment>/agent_profile/portrait/
$WEBOT_HOME/workspaces/<workspace_segment>/data/chat-assets/
```

### 步骤 6. 写入上下文文件

必须同时做两件事：

1. 写 `agent_context_files`
2. 推送到运行时文件接口

推荐接口：

- `PUT /api/management/agents/{id}/context-files/{filename}`

如果直接写 SQLite，则后续还必须调用：

- `POST /api/management/agents/{id}/context-files/reconcile`

### 步骤 7. 写入工作区绑定

向 `agent_workspace_folders` 写入额外工作区。

注意：

- 私有工作区和 `shared` 工作区是系统自动推导的。
- `agent_workspace_folders` 只存额外附加目录。
- 如果没有额外目录，这个表可以不写记录。

### 步骤 8. 写入技能与 MCP 开关

按需写入：

- `agent_skill_toggles`
- `agent_mcp_toggles`

说明：

- 默认创建流程会尝试给新智能体启用 `ui-skill`。
- AI 如果自己接管装配，也应显式补齐需要的 skill。

### 步骤 9. 清除隐藏标记

确保智能体可见：

- 删除 `hidden_agents` 中对应 `agent_id` 记录。

### 步骤 10. 校验

至少校验以下接口：

- `GET /api/management/agents/{id}`
- `GET /api/management/agents/{id}/workspaces`
- `GET /api/management/agents/{id}/context-files`

## 7. 推荐 SQL 模板

以下 SQL 用于 AI 直接补齐本地数据。

### 7.1 资料覆盖

```sql
INSERT INTO agent_profile_overrides(
  agent_id,
  tags_json,
  description,
  system_prompt,
  collaboration_json,
  channel_binding_json,
  avatar_url,
  portrait_url,
  english_name,
  nickname,
  updated_at
)
VALUES (
  :agent_id,
  :tags_json,
  :description,
  :system_prompt,
  :collaboration_json,
  :channel_binding_json,
  :avatar_url,
  :portrait_url,
  :english_name,
  :nickname,
  CURRENT_TIMESTAMP
)
ON CONFLICT(agent_id) DO UPDATE SET
  tags_json = excluded.tags_json,
  description = excluded.description,
  system_prompt = excluded.system_prompt,
  collaboration_json = excluded.collaboration_json,
  channel_binding_json = excluded.channel_binding_json,
  avatar_url = excluded.avatar_url,
  portrait_url = excluded.portrait_url,
  english_name = excluded.english_name,
  nickname = excluded.nickname,
  updated_at = CURRENT_TIMESTAMP;
```

### 7.2 上下文文件

```sql
INSERT INTO agent_context_files(agent_id, file_name, content, updated_at)
VALUES (:agent_id, :file_name, :content, CURRENT_TIMESTAMP)
ON CONFLICT(agent_id, file_name) DO UPDATE SET
  content = excluded.content,
  updated_at = CURRENT_TIMESTAMP;
```

### 7.3 额外工作区

```sql
INSERT INTO agent_workspace_folders(agent_id, folder_path, updated_at)
VALUES (:agent_id, :folder_path, CURRENT_TIMESTAMP)
ON CONFLICT(agent_id, folder_path) DO UPDATE SET
  updated_at = CURRENT_TIMESTAMP;
```

### 7.4 技能开关

```sql
INSERT INTO agent_skill_toggles(agent_id, skill_name, updated_at)
VALUES (:agent_id, :skill_name, CURRENT_TIMESTAMP)
ON CONFLICT(agent_id, skill_name) DO UPDATE SET
  updated_at = CURRENT_TIMESTAMP;
```

### 7.5 MCP 开关

```sql
INSERT INTO agent_mcp_toggles(agent_id, server_name, updated_at)
VALUES (:agent_id, :server_name, CURRENT_TIMESTAMP)
ON CONFLICT(agent_id, server_name) DO UPDATE SET
  updated_at = CURRENT_TIMESTAMP;
```

### 7.6 确保非隐藏

```sql
DELETE FROM hidden_agents
WHERE agent_id = :agent_id;
```

## 8. 推荐 HTTP 补齐接口

如果网关在线，AI 优先使用接口，而不是直接写 SQLite。

推荐顺序：

1. `POST /api/management/agents`
2. `PATCH /api/management/agents/{id}/config`
3. `PUT /api/management/agents/{id}/context-files/{filename}`
4. `PUT /api/management/agents/{id}/workspaces`
5. `PUT /api/management/agents/{id}/skills`
6. `PUT /api/management/agents/{id}/mcp_servers`
7. `POST /api/management/agents/{id}/context-files/reconcile`

原因：

- 接口会同时兼顾 OpenFang 运行时和本地 SQLite。
- 直接改 SQLite 只能补管理层，不能保证运行时立即生效。

## 9. 最小可用创建协议

如果让 AI 自动创建一个智能体，执行协议建议固定为：

```text
1. 解析 WEBOT_HOME
2. 确保 shared/data、skills、workspaces 目录存在
3. POST /api/management/agents 创建真实 agent
4. 读取 agent_id
5. 写入 agent_profile_overrides
6. 计算 workspace_segment 并创建私有工作区目录
7. 初始化 8 个 context files
8. 写入额外工作区、技能、MCP 分配
9. 删除 hidden_agents 中该 agent_id
10. reconcile context files
11. 校验 agent/workspaces/context-files 三个接口
```

## 10. AI 不应做的事

- 不要只写 `management.sqlite3` 就判定“智能体已创建”。
- 不要跳过 `agent_id` 校验。
- 不要把私有工作区路径写进 `agent_workspace_folders` 作为重复记录。
- 不要假设根目录一定是 `~/webot`。
- 不要在缺少模型配置时写死无效 provider/model。

## 11. 最终建议

如果你要让 AI 真正“直接创建智能体”，最佳实现方式不是纯 SQLite 方案，而是：

1. 用管理接口创建 agent。
2. 用本地文件系统创建工作区目录和媒体目录。
3. 用 SQLite 只保存本地覆盖层与缓存层。

这样和当前 `service-rs` 的实现是一致的，兼容性最高，后续也最不容易被 OpenFang 覆盖掉。
