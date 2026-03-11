# 智能体记忆系统实施计划（v1.2）

日期：2026-03-10  
状态：Draft v1.2（实施任务版）  
关联文档：  
- `docs/agent-memory-system-design-v1.md`  
- `docs/agent-memory-system-spec-v1.1.md`

---

## 1. 目标与原则

## 1.1 实施目标

1. 以 OpenFang 为主记忆底座，完成统一记忆编排。  
2. 上线智能总结（turn/topic/episode）并可回溯证据。  
3. 实现长期记忆快速、稳定、可解释召回。  
4. 建立冲突治理、反馈纠错、观测评测闭环。

## 1.2 实施原则

1. 最小侵入：优先在现有模块增量改造。  
2. 可回滚：每阶段都可通过开关回退。  
3. 可观测：上线前必须具备关键指标。  
4. 先读后写：先统一召回路径，再升级写入策略。

---

## 2. 范围边界

## 2.1 In Scope

1. `openfang` 运行时、记忆层、迁移脚本改造。  
2. `webot-app` 服务层对文件记忆的定位调整（审计层）。  
3. 性能与质量评测基线建立。  
4. 开关与灰度发布流程。

## 2.2 Out of Scope

1. 引入外部重型记忆中间件（MemOS / EverMemOS 全量接入）。  
2. 跨产品全局共享记忆网络。  
3. P0-P2 期间的大规模 UI 重构。

---

## 3. 里程碑与时间建议

1. M1（P0 完成）：1-2 周，统一读路径和观测。  
2. M2（P1 完成）：2-3 周，智能写入与分层总结上线。  
3. M3（P2 完成）：2-4 周，冲突治理与反馈闭环上线。

总建议：5-9 周可完成首轮稳定版本。

---

## 4. 任务分解

## 4.1 P0：统一召回编排（先读路径）

### P0-1 新增 Memory Orchestrator 读入口

目标：统一所有召回请求路径，形成单入口。  
改造点：

1. `openfang/crates/openfang-runtime/src/agent_loop.rs`  
2. `openfang/crates/openfang-memory/src/semantic.rs`

交付物：

1. 统一召回接口（意图路由 + 多路召回 + 重排）。  
2. 召回 explain 字段（命中来源、得分构成）。

验收：

1. 默认对话链路全部走 Orchestrator。  
2. 可输出 TopN 候选及最终入上下文列表。

### P0-2 混合召回最小版本

目标：上线 FTS + 向量双路融合。  
改造点：

1. `openfang/crates/openfang-memory/src/semantic.rs`  
2. `openfang/crates/openfang-memory/src/substrate.rs`

交付物：

1. 双路候选召回 + 统一排序。  
2. 基础权重配置（来自 v1.1 默认参数）。

验收：

1. Recall@5 相对当前基线提升。  
2. P95 召回延迟可观测且稳定。

### P0-3 文件记忆角色下沉

目标：`memory/*.md` 退出主召回路径，仅保留审计/回放。  
改造点：

1. `webot-app/apps/service-rs/src/routes.rs`  
2. `webot-app/apps/service-rs/src/assignment_store.rs`（若需标注用途）

交付物：

1. 接口文档标注“审计层/备份层”。  
2. 主召回不再默认检索文件记忆。

验收：

1. 对话质量不下降。  
2. 文件层接口仍可读写、导出、审计。

### P0-4 基线评测与可观测

目标：建立上线门槛。  
改造点：

1. 运行时日志与指标输出模块。  
2. 回归测试脚本（仓库现有测试体系下实现）。

交付物：

1. Recall/延迟/误召回基线报表。  
2. P0 发布门槛检查清单。

验收：

1. 指标可持续采集。  
2. 失败可快速定位（召回 explain 可追溯）。

---

## 4.2 P1：智能写入与分层总结

### P1-1 写入分类器（fact/preference/task_state/tool_experience）

目标：替代“整段对话直接入库”。  
改造点：

1. `openfang/crates/openfang-runtime/src/agent_loop.rs`  
2. `openfang/crates/openfang-memory/src/structured.rs`（如需类型写入支持）

交付物：

1. 写入分类器。  
2. `importance/confidence` 评分与阈值过滤。

验收：

1. 无效记忆写入比例明显下降。  
2. 高价值类型命中率上升。

### P1-2 记忆元数据与索引迁移

目标：支持版本关系、冲突治理、回溯证据。  
改造点：

1. `openfang/crates/openfang-memory/src/migration.rs`  
2. `openfang/crates/openfang-memory/src/substrate.rs`

交付物：

1. 新字段：`entity_key/version/supersedes_id/conflict_group_id/evidence_refs/status`。  
2. 必要索引与迁移脚本。

验收：

1. 旧数据可平滑升级。  
2. 新字段在读写链路可用。

### P1-3 分层总结引擎

目标：实现 turn/topic/episode 三层总结。  
改造点：

1. `openfang/crates/openfang-runtime/src/compactor.rs`  
2. `openfang/crates/openfang-memory/src/session.rs`

交付物：

1. 三层总结触发器。  
2. summary 与 source messages 的证据映射。

验收：

1. 长会话 token 压力明显降低。  
2. 总结可回溯原始消息。

### P1-4 历史文件记忆回灌

目标：把 `memory/*.md` 历史数据导入长期记忆层。  
改造点：

1. `webot-app/apps/service-rs` 数据导入任务或脚本。  
2. OpenFang 写入接口调用路径。

交付物：

1. 回灌任务：按文件日期、来源标签入库。  
2. 去重策略：防止历史数据污染。

验收：

1. 历史关键记忆可召回。  
2. 重复率在可控范围内。

---

## 4.3 P2：冲突治理、反馈纠错、质量闭环

### P2-1 冲突检测与 supersede 流程

目标：解决“新旧记忆打架”。  
改造点：

1. `openfang/crates/openfang-memory/src/semantic.rs`  
2. `openfang/crates/openfang-memory/src/knowledge.rs`（如涉及关系规则）

交付物：

1. 冲突检测器。  
2. 决议矩阵实现（v1.1 规则）。

验收：

1. 冲突误用率 <= 门槛。  
2. 旧错信息默认不再回流。

### P2-2 用户反馈纠错链路

目标：用户可显式纠错并立刻生效。  
改造点：

1. `webot-app/apps/service-rs/src/routes.rs`（反馈接口）  
2. OpenFang 记忆写入层（`revoked/superseded` 状态变更）

交付物：

1. 反馈接口：正确/错误/删除请求。  
2. 召回链路自动屏蔽 `revoked`。

验收：

1. 用户纠错后下一轮生效。  
2. 审计日志完整可查。

### P2-3 动态重排与预算调优

目标：按意图动态分配不同记忆类型预算。  
改造点：

1. `openfang/crates/openfang-runtime/src/prompt_builder.rs`  
2. `openfang/crates/openfang-memory/src/semantic.rs`

交付物：

1. 类型预算控制器。  
2. 动态 TopK 与重排权重调参机制。

验收：

1. 多类任务下召回稳定性提升。  
2. 延迟不显著劣化。

### P2-4 A/B 与回归体系

目标：形成持续优化闭环。  
改造点：

1. 发布脚本/配置。  
2. 指标看板与评测任务。

交付物：

1. A/B 配置与采样策略。  
2. 每周回归报告模板。

验收：

1. 指标可对比追踪。  
2. 策略迭代有数据依据。

---

## 5. 开关矩阵（发布控制）

| 开关 | 阶段默认 | 用途 |
|---|---|---|
| `memory.orchestrator.enabled` | P0 开 | 统一召回入口 |
| `memory.hybrid_retrieval.enabled` | P0 开 | 混合召回 |
| `memory.write.classifier.enabled` | P1 开 | 写入分类与评分 |
| `memory.summary.topic.enabled` | P1 开 | 主题级总结 |
| `memory.summary.episode.enabled` | P1 开 | 阶段级总结 |
| `memory.conflict_resolution.enabled` | P2 开 | 冲突治理 |
| `memory.feedback.enabled` | P2 开 | 用户纠错 |

---

## 6. 质量门槛（DoD）

每阶段必须满足：

1. 功能门槛：阶段目标全部可运行。  
2. 质量门槛：关键指标达标（见 v1.1）。  
3. 稳定门槛：连续运行无高频错误。  
4. 回滚门槛：开关可一键回退到上一稳定态。  
5. 文档门槛：接口、字段、策略变更有记录。

---

## 7. 风险清单与应对

1. 记忆污染风险：分类器误判导致噪声积累。  
应对：阈值过滤 + 回归评测 + 用户反馈纠错。

2. 性能抖动风险：混合召回带来延迟波动。  
应对：热缓存 + 动态 TopK + 降级策略。

3. 迁移风险：历史数据回灌重复或冲突。  
应对：批次回灌 + 去重 + 分阶段启用。

4. 维护风险：OpenFang 上游持续更新导致冲突。  
应对：最小侵入改造 + patch 清单 + 定期 rebase。

---

## 8. 实施顺序建议（可直接执行）

1. 先做 P0-1/P0-2，拿到统一召回与基础收益。  
2. 再做 P0-3/P0-4，完成定位收敛和可观测。  
3. 进入 P1 完成写入治理与分层总结。  
4. 最后做 P2，建立冲突与反馈闭环。  
5. 全程使用开关灰度，不做一次性全量切换。

---

## 9. 管理建议

1. 每个任务创建独立变更单，绑定指标目标。  
2. 每周固定一次“记忆质量评审会”（看数据不看感觉）。  
3. 避免功能堆叠，先保证“记得对”和“召得快”。


