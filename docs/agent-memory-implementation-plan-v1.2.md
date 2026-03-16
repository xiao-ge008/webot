# 智能体统一记忆系统实施计划（v2）

日期：2026-03-15  
状态：Draft v2（实施任务版）  
关联文档：  
- `docs/agent-memory-system-design-v1.md`  
- `docs/agent-memory-system-spec-v1.1.md`

---

## 1. 实施目标

1. 把现有零散记忆链路收敛为统一入口。
2. 打通私聊、群聊、A2A 的统一写入与统一召回。
3. 建立“事件层 + 投影层 + 语义层”的基础设施。
4. 消除系统注入污染与共享 KV 误用问题。
5. 最终把 `memory_recall` 升级为真正的统一记忆查询入口。

---

## 2. 实施原则

1. 先修主链路，再清历史脏数据。
2. 先统一读写协议，再做高级调参与压缩。
3. 不暴力复制记忆，优先做共享事件和多主体投影。
4. 所有阶段都必须可灰度、可回滚、可观测。

---

## 3. 里程碑

1. M1：统一召回与污染修复
2. M2：群聊与 A2A 接入统一 remember pipeline
3. M3：事件层与投影层落库
4. M4：统一记忆查询入口替换旧 `memory_recall`
5. M5：旧记忆清洗、评测与全量切换

---

## 3.1 当前进度

截至 2026-03-15，实施进度更新如下：

1. M1 基本完成：
   - 已修正运行时提示词，避免把 `memory_recall` 描述成全文记忆搜索。
   - 已在长期记忆写入和召回 query 构造前清洗 `[system:*]` 注入块。
   - 已在服务层启用统一语义召回，并采用“相关 + 最近”混合召回。
2. M2 部分完成：
   - `agent_send` 已接入统一 remember pipeline，成功协作后会为 caller/callee 双向写入 `agent_collaboration`。
   - 群聊已接入 `group_message` 与 `group_summary` 语义记忆写入，但仍处于 `group session + scoped semantic metadata` 过渡态，尚未完成正式事件化落库。
3. M3 已启动：
   - `openfang-memory` 已新增 `memory_events` 与 `memory_projections` 表。
   - 群聊 `group_message_turn` 与 A2A `a2a_result` 已同步写入事件事实与多主体投影。
   - 统一记忆查询已进入“语义候选 + 投影候选”同台竞争阶段：统一拉取、去重、统一排序后再截断。
4. M4 已部分启动：
    - `memory_recall` 的定位已收敛为“共享 KV 已知 key 工具”；统一召回入口以 `/unified-search` 为准。
    - 查询结果已输出 `score/explain`，并支持 `subject_type/subject_id/limit`，同时新增 `subject_plan`（多主体联合权重）。
    - `service-rs` 自动召回已切到统一记忆查询接口，自动注入 prompt 开始消费事件/投影视图结果。
    - 多主体联合排序已收敛为“subject_plan → 多主体候选池 → 去重 → 统一排序”，而不是规则式扩展追加。
    - 已新增统一记忆调试接口；并把调试摘要合并到聊天日志（`phase=unified_memory_recall`）便于调参。
    - 底层共享 KV 接口本身尚未替换，正式统一查询协议仍待收敛。

---

## 4. 任务分解

## 4.1 P0：修复当前主链路

### P0-1 关闭错误提示词引导

目标：
不再诱导模型把 `memory_recall` 当“全文搜索记忆”。

任务：

1. 调整运行时 Memory section 文案
2. 调整 `memory_recall` 工具说明

验收：

1. 新对话中工具乱猜 key 频率下降

### P0-2 清理写入污染

目标：
进入记忆系统前剥离系统注入内容。

任务：

1. 在写入前清洗 `[system:*]` 注入块
2. 在语义召回 query 构造前清洗系统包裹

验收：

1. 新写入的长期记忆不再以角色设定为主体

### P0-3 默认启用统一语义召回

目标：
让服务层默认使用语义记忆，而不是退回共享 KV。

任务：

1. 启用服务层自动语义召回
2. 服务层统一做“相关记忆 + 最近窗口”混合召回

验收：

1. 普通回顾问题不再主要依赖 `memory_recall`
2. 实现状态：已完成

---

## 4.2 P1：群聊与 A2A 接入统一记忆链路

### P1-1 群聊事件落库

目标：
群聊消息不再只是 UI 日志，而是正式记忆事件。

任务：

1. 为群聊消息生成 `group_message` 事件
2. 补齐 `group_id / conversation_scope / participant_ids`
3. 派生 conversation/group/agent 投影

验收：

1. 能按 group 或成员视角回放和召回群历史
2. 实现状态：进行中（当前已完成 session scope、participant scope、group_message/group_summary 写入，未完成事件层/投影层落库）

### P1-2 A2A 协作事件落库

目标：
A 调 B 的协作链能长期沉淀。

任务：

1. 记录 `a2a_call`
2. 记录 `a2a_result`
3. 为 caller/callee/task 派生投影
4. 生成 `a2a_summary`

验收：

1. caller 与 callee 后续都能召回该次协作
2. 实现状态：部分完成（`agent_send` 双向语义记忆已落地，`a2a_call/a2a_result` 独立事件模型待完成）

### P1-3 群聊/A2A 摘要生成

目标：
让群聊与协作信息能够低 token 进入上下文。

任务：

1. 生成 `group_summary`
2. 生成 `a2a_summary`
3. 生成 `task_state`

验收：

1. 长群聊和长协作链上下文压力明显下降

---

## 4.3 P2：事件层与投影层正式建模

### P2-1 数据迁移

目标：
补齐统一关系字段。

任务：

1. 扩展记忆表 metadata 或新增结构表
2. 增加：
   - `source_event_id`
   - `group_id`
   - `task_id`
   - `caller_agent_id`
   - `callee_agent_id`
   - `projection_role`

验收：

1. 一条事件可关联多个主体且可追溯
2. 实现状态：部分完成（memory_events/memory_projections 已建表并接入群聊/A2A 写入，通用查询与回放接口待补齐）

### P2-2 Projection 构建器

目标：
统一维护“谁能看到哪段记忆”。

任务：

1. 新增投影构建逻辑
2. 群聊、A2A、普通私聊都走同一投影器

验收：

1. 召回时可按主体和关系稳定过滤
2. 实现状态：部分完成（群聊/A2A 已写入基础投影，统一 projection 查询器待补齐）

---

## 4.4 P3：统一记忆查询入口

### P3-1 重构 `memory_recall`

目标：
把 `memory_recall` 从共享 KV 读取升级为统一查询入口。

建议能力：

1. 已知 key 时读共享 KV
2. 未知 key 或自然语言 query 时走统一记忆召回
3. 支持 subject/scope/type 过滤

验收：

1. 模型无需再猜 `recent_conversations` 这类 key
2. 实现状态：部分完成（工具层已支持语义回退、score/explain 与 subject 参数，底层协议与统一排序策略仍待继续收敛）

### P3-2 统一 explain 输出

目标：
每次记忆命中都可解释。

任务：

1. 输出命中源、主体、关系、得分
2. 输出进入上下文原因

验收：

1. 问题可调、误召回可定位

---

## 4.5 P4：历史记忆清洗与回灌

### P4-1 旧污染记忆清洗

目标：
清理已有 `[system:profile]` 等污染内容。

任务：

1. 扫描历史 `memories`
2. 识别系统注入污染
3. 对污染内容执行：
   - 清洗
   - 降权
   - 标记为 superseded

验收：

1. 旧污染记忆对召回影响明显下降

### P4-2 审计层与长期层对齐

目标：
文件记忆继续保留，但不再和主召回打架。

任务：

1. 明确 `MEMORY.md` / `memory/*.md` 为审计层
2. 如需回灌，统一走清洗后的 remember pipeline

验收：

1. 文件记忆与语义记忆职责清晰

---

## 5. 代码映射建议

优先文件：

1. [agent_loop.rs](/E:/weBot2/webot-app/vendor/openfang/crates/openfang-runtime/src/agent_loop.rs)
   - 写入抽取
   - 文本清洗
   - 短期总结

2. [routes.rs](/E:/weBot2/webot-app/apps/service-rs/src/routes.rs)
   - 服务层混合召回
   - 群聊/A2A 召回拼装
   - 运行时配置

3. `openfang-memory/src/semantic.rs`
   - 统一召回器
   - 去重
   - 重排

4. `openfang-memory/src/migration.rs`
   - schema 扩展

5. 群聊/A2A 路由文件
   - 事件生成
   - 投影派生

---

## 6. 功能开关建议

1. `memory.orchestrator.enabled`
2. `memory.semantic.auto_recall.enabled`
3. `memory.group.enabled`
4. `memory.a2a.enabled`
5. `memory.projection.enabled`
6. `memory.memory_recall_v2.enabled`
7. `memory.cleanup.enabled`

---

## 7. 验收标准

1. 私聊能稳定延续上下文
2. 群聊能召回群级与成员视角历史
3. A2A caller 与 callee 都能召回协作记录
4. 旧记忆污染不再继续扩大
5. 召回 token 成本可控
6. 误召回可解释、可调优、可回滚

---

## 8. 最终建议

优先顺序不要反：

1. 先统一主链路
2. 再接群聊与 A2A
3. 再建事件层与投影层
4. 最后替换 `memory_recall`

这样做的原因很直接：先把“记忆写对、召对”做稳，再把复杂协作关系纳入同一体系，风险最低，收益最大。
