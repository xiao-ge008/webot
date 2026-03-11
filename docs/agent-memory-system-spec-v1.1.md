# 智能体记忆系统执行规格（v1.1）

日期：2026-03-10  
状态：Draft v1.1（可实施规格）  
上游文档：`docs/agent-memory-system-design-v1.md`

---

## 1. 目标

本规格将 v1 设计落到可执行层，定义：

1. 记忆类型与字段约束。  
2. 写入判定与评分默认参数。  
3. 冲突检测与版本替代规则。  
4. 召回路由、预算和重排公式。  
5. 观测指标、门槛与上线开关。

---

## 2. 记忆类型规范

## 2.1 类型枚举

1. `fact`：客观事实。  
2. `preference`：用户偏好。  
3. `task_state`：任务进度与约束。  
4. `tool_experience`：工具调用经验。  
5. `summary_turn`：轮次摘要。  
6. `summary_topic`：主题摘要。  
7. `summary_episode`：阶段摘要。  
8. `policy`：长期规则。

## 2.2 类型治理参数（默认）

| type | 默认TTL | 默认importance | 默认confidence | 是否允许冲突替代 | 召回优先级 |
|---|---:|---:|---:|---|---:|
| fact | 180天 | 0.70 | 0.80 | 是 | 4 |
| preference | 365天 | 0.85 | 0.85 | 是 | 5 |
| task_state | 30天 | 0.90 | 0.90 | 是 | 5 |
| tool_experience | 90天 | 0.65 | 0.70 | 是 | 3 |
| summary_turn | 7天 | 0.55 | 0.75 | 否 | 2 |
| summary_topic | 30天 | 0.70 | 0.80 | 否 | 3 |
| summary_episode | 120天 | 0.80 | 0.85 | 否 | 4 |
| policy | 永不过期 | 1.00 | 0.95 | 是 | 5 |

说明：

1. `priority` 越高越优先进入上下文预算。  
2. `summary_*` 不直接替代事实，仅做压缩与导航。

---

## 3. 数据字段约束

## 3.1 `memory_item` 必填字段

1. `id`：UUID。  
2. `agent_id`：归属智能体。  
3. `namespace`：`self.* / shared.* / tenant.* / system.*`。  
4. `type`：见类型枚举。  
5. `text`：可检索文本（最大 2048 字）。  
6. `importance`：0-1 浮点。  
7. `confidence`：0-1 浮点。  
8. `status`：`active / superseded / revoked / expired`。  
9. `created_at`、`updated_at`。  
10. `source`：`conversation / tool / import / summary`。

## 3.2 推荐字段

1. `entity_key`：冲突槽位键（例如 `user.preference.language`）。  
2. `version`：整型版本。  
3. `supersedes_id`：替代旧记忆 ID。  
4. `conflict_group_id`：冲突集合 ID。  
5. `session_id`、`user_id`、`tenant_id`。  
6. `expires_at`。  
7. `evidence_refs`：原始消息或工具结果引用。  
8. `pii_level`：`none / low / high`。

## 3.3 硬约束

1. `text` 为空时禁止写入。  
2. `importance < 0.35` 且非 `policy/task_state` 时默认丢弃。  
3. `confidence < 0.40` 时写入为 `candidate`（不参与默认召回）。  
4. `namespace=shared.*` 必须附写权限标识。

---

## 4. 写入评分与门槛

## 4.1 重要性评分（默认权重）

`importance = 0.30*explicitness + 0.25*future_reuse + 0.20*task_relevance + 0.15*user_emphasis + 0.10*rarity`

评分维度说明：

1. `explicitness`：是否由用户明确声明。  
2. `future_reuse`：未来复用概率。  
3. `task_relevance`：与当前任务目标耦合度。  
4. `user_emphasis`：重复强调或强约束。  
5. `rarity`：信息独特性。

## 4.2 置信度评分（默认权重）

`confidence = 0.45*source_reliability + 0.20*consistency + 0.20*evidence_strength + 0.15*freshness`

默认判定：

1. 用户直接陈述偏好：`source_reliability=0.9`。  
2. 工具返回结构化结果：`source_reliability=0.85`。  
3. 模型推测性总结：`source_reliability=0.6`。

## 4.3 去重策略

判定任一命中即去重合并：

1. `entity_key` 完全相同且文本相似度 > 0.88。  
2. 向量余弦相似度 > 0.93 且时间间隔 < 7 天。  
3. 标准化文本哈希一致。

---

## 5. 冲突检测与替代规则

## 5.1 冲突触发条件

1. `entity_key` 相同且值不同。  
2. 同一事实槽位出现相反陈述。  
3. 同一偏好键出现新值（如语言从中文改为英文）。

## 5.2 冲突决议矩阵

| 场景 | 决议 |
|---|---|
| 新记录 `confidence` 高于旧记录 0.15 以上 | 新记录生效，旧记录标记 `superseded` |
| 新旧置信度接近（差值 < 0.15）且新记录更近 | 新记录生效，旧记录保留为历史版本 |
| 新记录来源低可信（推测）且旧记录是用户明确声明 | 旧记录保持生效，新记录标记 `candidate` |
| `policy` 冲突 | 进入人工确认队列，不自动替代 |

## 5.3 撤销与纠错

1. 用户显式“记错了/删除这条”时，写入 `feedback=negative`。  
2. 目标记忆改为 `revoked`，默认召回链路屏蔽。  
3. 保留审计，不做物理删除（除非合规要求）。

---

## 6. 总结策略规格

## 6.1 `turn summary`

触发：每轮响应后。  
上限：120 字。  
必须包含：

1. 本轮新增事实/偏好/任务变化。  
2. 关键决策或限制。  
3. `evidence_refs` 指针。

## 6.2 `topic summary`

触发任一条件：

1. 连续 8-12 轮同主题。  
2. 主题切换。  
3. 召回 token 压力超过阈值。

要求：

1. 合并同类项。  
2. 清除过时结论。  
3. 产出“主题结论 + 未决问题”。

## 6.3 `episode summary`

触发：

1. 任务结束。  
2. 跨日会话。  
3. 长会话压缩事件。

要求：

1. 保留可逆证据链。  
2. 产出可复用规则与失败经验。

---

## 7. 召回策略规格

## 7.1 召回路由

1. 意图 `fact_query`：`fact + summary_episode` 优先。  
2. 意图 `preference_query`：`preference + policy` 优先。  
3. 意图 `task_continue`：`task_state + summary_topic` 优先。  
4. 意图 `tool_debug`：`tool_experience` 优先。

## 7.2 多路召回参数（默认）

1. FTS 候选：Top 30。  
2. 向量候选：Top 40。  
3. 关系候选：Top 20。  
4. 融合后重排输出：Top 12（进入上下文打包前）。

## 7.3 统一重排公式（默认权重）

`score = 0.35*semantic + 0.20*lexical + 0.15*recency + 0.15*importance + 0.10*confidence + 0.05*type_priority - 0.20*conflict_penalty`

## 7.4 上下文预算（默认）

1. `fact`：40%。  
2. `task_state`：25%。  
3. `preference`：20%。  
4. `summary_*`：10%。  
5. `tool_experience`：5%。

---

## 8. 性能与可用性规格

## 8.1 性能目标

1. P50 召回延迟 < 60ms。  
2. P95 召回延迟 < 120ms。  
3. 写入主链额外开销 < 40ms（同步部分）。  
4. 异步索引完成时间 P95 < 3s。

## 8.2 降级策略

1. 向量服务不可用：降级 `FTS + recency`。  
2. 关系索引不可用：跳过关系召回，仅保留语义+关键词。  
3. 编排器异常：回退到 OpenFang 默认 recall。

---

## 9. 观测与验收门槛

## 9.1 必备指标

1. Recall@5、Recall@10。  
2. 冲突误用率。  
3. 过时记忆命中率。  
4. 用户纠错率。  
5. 召回延迟 P50/P95。

## 9.2 上线门槛（建议）

1. Recall@5 相比基线提升 >= 10%。  
2. 冲突误用率 <= 2%。  
3. 过时命中率 <= 3%。  
4. P95 延迟不劣于基线 + 20ms。  
5. 用户主观连续性评分提升 >= 15%。

---

## 10. 开关与发布策略

## 10.1 功能开关

1. `memory.orchestrator.enabled`  
2. `memory.write.classifier.enabled`  
3. `memory.summary.topic.enabled`  
4. `memory.conflict_resolution.enabled`  
5. `memory.hybrid_retrieval.enabled`

## 10.2 发布节奏

1. 阶段 A：只开读路径编排。  
2. 阶段 B：开启写入分类和去重。  
3. 阶段 C：开启冲突替代与反馈纠错。  
4. 阶段 D：全量开启并做 A/B。

---

## 11. 与当前代码的实现边界

优先落位模块：

1. `openfang/crates/openfang-runtime/src/agent_loop.rs`：写入抽取与召回路由主入口。  
2. `openfang/crates/openfang-runtime/src/compactor.rs`：三层总结调度。  
3. `openfang/crates/openfang-memory/src/migration.rs`：字段与索引扩展。  
4. `openfang/crates/openfang-memory/src/semantic.rs`：混合召回与重排。  
5. `webot-app/apps/service-rs/src/routes.rs`：文件记忆接口定位为审计层。

---

## 12. 决策摘要

1. 不替换 OpenFang。  
2. 通过最小侵入增强实现“智能总结 + 快速长期召回”。  
3. 先建立可测可控的治理闭环，再逐步提高策略复杂度。


