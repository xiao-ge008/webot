# 协同调度权限设计说明（数据库优先）

## 1. 目标

- 协同配置以数据库为准，不依赖 `AGENTS.md` 配置块。
- 支持“调用者（调度）/被调用者（可被调度）”两类能力开关。
- 通过白名单关系控制可调用对象，防止任意调度。
- 聊天时动态注入协同系统提示词（含被调用智能体简介）。
- 为后续群聊扩展预留 `scope` 维度。

## 2. 数据模型

### 2.1 `agent_profile_overrides` 增强

新增列：

- `collaboration_json TEXT NULL`

示例值：

```json
{
  "discoverable": true,
  "dispatchEnabled": true,
  "selectedWorkers": ["local:hand-worker", "local:test-scheduler"]
}
```

字段语义：

- `discoverable`：是否可被其他智能体发现并作为被调度对象。
- `dispatchEnabled`：是否允许该智能体发起调度。
- `selectedWorkers`：调度白名单（当前主要使用 `local:<agent_id>`）。

### 2.2 新增关系表 `agent_collaboration_acl`

表结构（逻辑）：

- `caller_agent_id TEXT NOT NULL`
- `callee_agent_id TEXT NOT NULL`
- `scope TEXT NOT NULL DEFAULT 'private'`
- `enabled INTEGER NOT NULL DEFAULT 1`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- 主键：`(caller_agent_id, callee_agent_id, scope)`

说明：

- 当前先落地 `scope='private'`。
- 后续群聊可扩展为 `scope='group'` + 群维度策略。

## 3. 配置写入流程（编辑页保存）

入口：`PATCH /api/management/agents/{id}/config`

请求体新增字段：

```json
{
  "collaboration": {
    "discoverable": true,
    "dispatchEnabled": true,
    "selectedWorkers": ["local:xxx", "local:yyy"]
  }
}
```

后端处理规则：

1. 解析并标准化 `collaboration`（补齐 key 格式、去重、剔除 self）。
2. 自动同步协同标签（内部）：
   - `webot:collab_discoverable`
   - `webot:collab_dispatcher`
3. 写入 `agent_profile_overrides.collaboration_json`。
4. 若 `dispatchEnabled=true`，按 `selectedWorkers` 的 `local:*` 重建 `agent_collaboration_acl(scope=private)`。
5. 若 `dispatchEnabled=false`，清空该 caller 在 `scope=private` 的 ACL 关系。

## 4. 聊天动态注入（系统提示词）

注入发生在后端聊天入口：

- `POST /api/chat/{id}/message`
- `POST /api/chat/{id}/message/stream`

拼装逻辑：

1. 读取该 agent 的 `system_prompt`（原 profile 提示词）。
2. 根据 `collaboration_json + ACL` 生成协同提示块。
3. 协同提示块中包含“允许列表 + 被调用者简介（截断）”。
4. 最终将 profile 提示词与协同提示词一起注入当前请求。

示例注入块：

```text
[system:multi-agent-collaboration]
你当前可调用的员工白名单（仅以下对象允许委派）：
- 可欣 (id=xxx): 主人的女友，听话但有点迷糊
- hand-worker (id=yyy): 实时查询与数据抓取
严格规则：仅允许调用白名单中的智能体；禁止调用未授权对象。
结果要求：最终答复汇总每个子任务状态（工作中 / 已完成 / 失败）。
```

## 5. A2A 调用权限校验（后端硬约束）

入口：`POST /api/management/a2a/tasks/send`

当 payload 中可解析出 `caller_agent_id` 与 `callee_agent_id` 时，执行硬校验：

1. `caller` 不能等于 `callee`（禁止自调度）。
2. `caller` 必须开启调度（`dispatchEnabled=true` 或调度标签存在）。
3. `callee` 必须开启被调度（`discoverable=true` 或被调度标签存在）。
4. `caller -> callee` 必须命中 `agent_collaboration_acl(scope=private)` 且 `enabled=1`。

任一不满足，返回 `403` 拒绝调用。

## 6. 与“发现/调度/被调度”能力的一致性

- 发现列表：只展示开启被调度（discoverable）的本地智能体，并排除自己。
- 开启调度：必须选择可调度员工才允许保存。
- 保存后：DB 中同时具备
  - 配置态（`collaboration_json`）
  - 关系态（`agent_collaboration_acl`）
- 聊天时：按关系态注入，不再依赖文档文件块。

## 7. 前端协议变化

`management-client` 增强：

- `ManagementAgentDetail.collaboration`
- `ManagementAgentSummary.collaboration`
- `AgentConfigPatchInput.collaboration`

编辑页改动：

- 加载优先读 `detail.collaboration`（保留旧块兜底兼容）。
- 保存通过 `config.collaboration` 回传后端。
- 协同配置不再写 `AGENTS.md`/`system_prompt` 标记块。

## 8. 兼容与扩展建议

### 8.1 兼容

- 旧数据仍可通过已有系统标签和旧配置块兜底读取。
- 新逻辑以数据库字段为主，逐步迁移后可移除兜底解析。

### 8.2 群聊扩展（后续）

建议在 ACL 基础上增加：

- `scope='group'`
- `group_id`
- 运行时按“群成员全集 - 自己”计算可调用对象

这样可做到：

- 私聊：严格白名单
- 群聊：自动群成员授权（可选再叠加细粒度规则）

## 9. 本次实现涉及的主要文件

- `apps/service-rs/src/assignment_store.rs`
- `apps/service-rs/src/routes.rs`
- `apps/frontend/src/services/management-client.ts`
- `apps/frontend/src/pages/EditAgentPage.tsx`
- `apps/frontend/src/services/agent-client.ts`

