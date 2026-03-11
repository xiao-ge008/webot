# Local Patches

记录对官方 `openfang-fresh` 仓库的本地修改，方便后续升级官方版本时人工迁移。

## 基线
- 当前官方基线：`v0.3.24`
- 当前提交：`ebcdc17 default resilience`

## 2026-03-07

### Patch 000 - 当前本地改动快照（防覆盖）
- 仓库状态：`detached HEAD`（`ebcdc17`）
- 已修改文件：
  - `Cargo.lock`
  - `crates/openfang-kernel/src/kernel.rs`
  - `crates/openfang-runtime/src/agent_loop.rs`
- 已生成补丁备份：
  - `E:\weBot2\_local_backups\openfang-local-20260307-151520.patch`
- 更新官方仓库前建议：
  - 先执行 `git -C E:\weBot2\openfang-fresh stash push -u -m "local-openfang-patches-20260307"` 保存现场
  - 更新后执行 `git -C E:\weBot2\openfang-fresh stash pop` 或 `git -C E:\weBot2\openfang-fresh apply E:\weBot2\_local_backups\openfang-local-20260307-151520.patch`

### Patch 001 - 支持 `<tool_call>...` 文本工具调用恢复（计划重打）
- 文件：`crates/openfang-runtime/src/agent_loop.rs`
- 原因：当前运行中的 `nvidia-nim / z-ai/glm4.7` 会输出：
  - `<tool_call>web_search`
  - `query: 北京天气 2026年3月7日`
- 问题：官方 v0.3.24 的 `recover_text_tool_calls()` 不支持该格式，只支持 `<function=...>{...}</function>` 等格式。
- 目标：新增 Pattern 6，支持：
  - 第一行：`<tool_call>tool_name`
  - 后续多行：`key: value`
- 计划验证命令：
  - `cargo test -p openfang-runtime test_recover_tool_call_tag_key_value_format -- --nocapture`
  - `cargo test -p openfang-runtime test_text_tool_call_tag_recovery_streaming_e2e -- --nocapture`

## 2026-03-10

### Patch 002 - 智能体记忆编排增强（P0+P1 基础落地）
- 目标：
  - 将记忆召回改为编排式策略（混合重排 + 类型优先级）
  - 将记忆写入改为类型化候选写入（turn/topic/preference/fact/task_state）
  - 为冲突治理和生命周期管理补齐 schema 字段
- 修改文件：
  - `crates/openfang-memory/src/migration.rs`
  - `crates/openfang-memory/src/semantic.rs`
  - `crates/openfang-runtime/src/agent_loop.rs`
- 关键能力：
  - schema `v8`：新增 `memory_type/importance/entity_key/status/supersedes_id/expires_at`
  - semantic store：
    - 混合检索评分（semantic + lexical + recency + importance + confidence + type_priority）
    - 过滤 `revoked/superseded/expired` 记忆
    - 基于 `entity_key` 的 supersede 冲突替代
    - 同内容 active 记忆去重
  - agent loop：
    - 统一 recall 入口（non-streaming / streaming）
    - typed memory 写入编排（metadata 带 `memory_type/importance/confidence/...`）
    - 周期性 topic summary 入库
- 编译与测试：
  - `cargo check -p openfang-memory -p openfang-runtime`
  - `cargo test -p openfang-memory semantic::tests:: -- --nocapture`
  - `cargo test -p openfang-runtime agent_loop::tests::test_max_history_messages -- --nocapture`
- 已生成补丁备份：
  - `E:\weBot2\_local_backups\openfang-memory-orchestrator-20260310-020132.patch`
- 官方升级后重放建议：
  - `git -C E:\weBot2\openfang-fresh apply E:\weBot2\_local_backups\openfang-memory-orchestrator-20260310-020132.patch`
  - 若冲突，先 `git -C E:\weBot2\openfang-fresh apply --reject --whitespace=fix <patch>`，再按 `LOCAL_PATCHES.md` 手动重打。

### Patch 003 - 记忆反馈纠错 API + 审计留痕（P2 核心）
- 目标：
  - 增加记忆反馈与纠错链路（confirm/weaken/outdated/revoke/correct）
  - 增加召回与反馈审计（memory_access_log / memory_feedback_events）
  - 提供记忆搜索和详情查询 API
- 修改文件：
  - `crates/openfang-memory/src/migration.rs`（schema v9）
  - `crates/openfang-memory/src/semantic.rs`（召回审计日志）
  - `crates/openfang-memory/src/substrate.rs`（search/get/feedback async API）
  - `crates/openfang-api/src/routes.rs`（新增 memory API handlers）
  - `crates/openfang-api/src/server.rs`（注册新路由）
  - `docs/memory-orchestrator-enhancements-2026-03-10.md`
- 新增 API：
  - `GET /api/memory/agents/{id}/search`
  - `GET /api/memory/agents/{id}/items/{memory_id}`
  - `POST /api/memory/agents/{id}/feedback`
  - `DELETE /api/memory/agents/{id}/items/{memory_id}`
- 验证命令：
  - `cargo check -p openfang-memory -p openfang-runtime -p openfang-api`
  - `cargo test -p openfang-memory substrate::tests::test_memory_feedback_flow -- --nocapture`
  - `cargo test -p openfang-memory semantic::tests::test_conflict_supersede_by_entity_key -- --nocapture`
- 已生成补丁备份：
  - `E:\weBot2\_local_backups\openfang-memory-orchestrator-p2-20260310-021949.patch`
  - `E:\weBot2\_local_backups\openfang-memory-orchestrator-p2-final-20260310-023030.patch`（包含 404 边界修复）
- 官方升级后重放建议：
  - 优先使用：`git -C E:\weBot2\openfang-fresh apply E:\weBot2\_local_backups\openfang-memory-orchestrator-p2-final-20260310-023030.patch`
