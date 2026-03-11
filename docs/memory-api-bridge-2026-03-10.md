# Memory API Bridge 更新说明（2026-03-10）

## 目标

将 `webot-app/apps/service-rs` 管理层对接到 OpenFang 新增记忆能力，支持：

1. 语义记忆搜索
2. 记忆条目详情
3. 记忆反馈纠错
4. 记忆撤销删除

## 管理层新增接口

基础前缀：`/api/management`

1. `GET /agents/{id}/memory/search`
   - Query:
     - `q`
     - `limit`
     - `scope`
     - `memory_type`
     - `min_confidence`
   - 透传 OpenFang：`GET /api/memory/agents/{id}/search`

2. `GET /agents/{id}/memory/items/{memory_id}`
   - 透传 OpenFang：`GET /api/memory/agents/{id}/items/{memory_id}`

3. `POST /agents/{id}/memory/feedback`
   - Body:
     - `memory_id`
     - `action`
     - `reason` (optional)
     - `corrected_content` (optional, action=correct 时必填)
   - 透传 OpenFang：`POST /api/memory/agents/{id}/feedback`

4. `DELETE /agents/{id}/memory/items/{memory_id}`
   - 透传 OpenFang：`DELETE /api/memory/agents/{id}/items/{memory_id}`

## 前端管理客户端新增方法

文件：`apps/frontend/src/services/management-client.ts`

1. `searchManagementAgentMemories`
2. `getManagementAgentMemoryItem`
3. `feedbackManagementAgentMemory`
4. `deleteManagementAgentMemoryItem`

## 编辑页接入（EditAgentPage）

文件：`apps/frontend/src/pages/EditAgentPage.tsx`

在“记忆管理”页签中，新增“语义记忆（OpenFang）”分区，保留原有 `memory/` 文件管理不变。

新增能力：

1. 检索条件
   - `q`
   - `scope`
   - `memoryType`
   - `minConfidence`
   - `limit`
2. 列表展示字段
   - `content`
   - `memoryType`
   - `confidence`
   - `status`
   - `createdAt`
3. 条目操作
   - 反馈：`confirm` / `weaken` / `outdated` / `revoke` / `reject`
   - 纠错：`correct`（支持填写 `corrected_content` 与 `reason`）
   - 删除：`DELETE item`
4. 详情查看
   - 点击条目弹窗查看完整内容与元信息

## i18n 补充

文件：

1. `apps/frontend/src/i18n/locales/zh.json`
2. `apps/frontend/src/i18n/locales/en.json`

新增 `edit.memory.semantic*` 文案键，用于语义记忆分区的查询、操作、状态与弹窗提示。

## 已完成验证

1. `cargo check`（service-rs）通过
2. `npm run build`（frontend）通过
