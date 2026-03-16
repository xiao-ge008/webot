# 智能体统一记忆系统执行规格（v2）

日期：2026-03-15  
状态：Draft v2（可实施规格）  
上游文档：`docs/agent-memory-system-design-v1.md`

---

## 1. 规格目标

本规格定义统一记忆系统的执行约束，覆盖：

1. 记忆对象与字段模型
2. 群聊与 A2A 的写入规则
3. 短期上下文与长期记忆的拼装规则
4. 统一召回与重排规则
5. 治理、过期、冲突、解释和上线门槛

---

## 1.1 当前实现对齐状态

截至 2026-03-15，规格与现有实现的对齐情况如下：

1. 服务层已按统一入口做长期语义记忆增强，并执行“query 相关召回 + 最近窗口召回”的混合合并去重。
2. `memory_recall` 的定位已明确为“共享 KV 已知 key 工具”；统一召回与排序以 `/api/memory/agents/{id}/unified-search` 为准，不再依赖模型猜 key。
3. `agent_send` 已开始把协作结果写成 `memory_type=agent_collaboration` 的语义记忆，并同时写入 caller/callee 两侧。
4. 群聊消息成功处理后，已会写入 `memory_type=group_message` 与 `memory_type=group_summary` 的语义记忆，并携带 `conversation_scope/participant_scope/channel` 等 metadata。
5. `memory_events` / `memory_projections` 结构表已经落地到 `openfang-memory`，群聊和 A2A 已开始同步写入事件与投影。
6. 统一召回已进入“语义候选 + 投影候选”同台竞争阶段：候选集合先统一拉取、去重，再统一排序并截断，不再采用“先语义后投影补齐”的规则式追加。
7. `memory_recall` 的统一查询结果已带 `score/explain`，并支持 `subject_type/subject_id/limit` 可选参数。
8. `service-rs` 自动召回链路已切到 `/api/memory/agents/{id}/unified-search`，因此自动注入 prompt 与工具调用开始共享同一查询主链。
9. 统一查询会构建 `subject_plan`（主主体 + 关联主体集合），对 `task / group / user / a2a_edge / agent` 做多主体联合权重，并把 `query_subject_*` 与 `from=*` 关系来源写入 `explain`。
10. 已提供 `/api/memory/agents/{id}/unified-debug` 调试接口，返回 query plan、subject plan、候选集和最终排序结果；`service-rs` 会把调试摘要并入聊天日志的“记忆召回”阶段，方便端到端排查。
11. 当前仍是“结构事件 + 语义记忆并行”阶段，但主体联合排序、去重策略与 explain 已具备可持续调优的观测基础。

因此，本规格里的事件层/投影层字段既是目标模型，也是后续表结构与 API 的约束来源。

---

## 2. 记忆对象定义

## 2.1 事件对象 `memory_event`

必填字段：

1. `event_id`
2. `event_type`
3. `content`
4. `created_at`
5. `conversation_id`

推荐字段：

1. `group_id`
2. `task_id`
3. `source_agent_id`
4. `target_agent_id`
5. `speaker_agent_id`
6. `speaker_user_id`
7. `participant_ids`
8. `reply_to_event_id`
9. `tool_use_id`
10. `delegation_depth`

事件类型枚举：

1. `user_message`
2. `assistant_message`
3. `group_message`
4. `a2a_call`
5. `a2a_result`
6. `tool_result`
7. `summary_turn`
8. `summary_topic`
9. `summary_episode`

## 2.2 投影对象 `memory_projection`

必填字段：

1. `projection_id`
2. `subject_type`
3. `subject_id`
4. `event_id`
5. `projection_role`

`subject_type` 枚举：

1. `agent`
2. `user`
3. `group`
4. `conversation`
5. `task`
6. `a2a_edge`

`projection_role` 枚举：

1. `owner`
2. `participant`
3. `caller`
4. `callee`
5. `observer`

## 2.3 语义对象 `memory_semantic`

必填字段：

1. `id`
2. `subject_type`
3. `subject_id`
4. `memory_type`
5. `content`
6. `importance`
7. `confidence`
8. `status`
9. `source_event_id`
10. `created_at`

推荐字段：

1. `entity_key`
2. `conversation_scope`
3. `group_scope`
4. `participant_scope`
5. `task_id`
6. `caller_agent_id`
7. `callee_agent_id`
8. `expires_at`
9. `supersedes_id`
10. `metadata`

---

## 3. 记忆类型规范

统一类型枚举：

1. `fact`
2. `preference`
3. `task_state`
4. `summary_turn`
5. `summary_topic`
6. `summary_episode`
7. `group_summary`
8. `a2a_summary`
9. `relationship_note`
10. `tool_experience`

治理默认值：

| type | TTL | importance | confidence | 召回优先级 |
|---|---:|---:|---:|---:|
| fact | 180天 | 0.72 | 0.82 | 4 |
| preference | 365天 | 0.90 | 0.90 | 5 |
| task_state | 30天 | 0.90 | 0.90 | 5 |
| summary_turn | 7天 | 0.55 | 0.75 | 2 |
| summary_topic | 30天 | 0.70 | 0.80 | 3 |
| summary_episode | 120天 | 0.80 | 0.85 | 4 |
| group_summary | 30天 | 0.78 | 0.82 | 4 |
| a2a_summary | 45天 | 0.82 | 0.85 | 4 |
| relationship_note | 120天 | 0.75 | 0.80 | 3 |
| tool_experience | 90天 | 0.65 | 0.72 | 3 |

---

## 4. 写入规则

## 4.1 通用写入链路

每轮交互按以下顺序处理：

1. 生成 `memory_event`
2. 生成 `memory_projection`
3. 抽取语义候选
4. 打标签与评分
5. 去重
6. 冲突检测
7. 持久化语义记忆
8. 写入解释日志

## 4.2 文本清洗规则

进入语义记忆前必须剥离：

1. 系统注入块
2. 非业务工具协议壳
3. 重复的模板化角色设定

禁止把以下内容直接作为长期记忆主体内容：

1. `[system:profile]`
2. `[system:semantic-memory]`
3. `[system:multi-agent-collaboration]`
4. 纯工具协议壳

## 4.3 群聊写入规则

每条群聊消息至少写入：

1. 一条 `group_message` 事件
2. 一个 `conversation` 投影
3. 一个 `group` 投影
4. 至少一个 `agent` 或 `user` 投影

派生记忆规则：

1. 每轮生成 `summary_turn`
2. 若主题持续，生成 `summary_topic`
3. 周期性生成 `group_summary`

## 4.4 A2A 写入规则

一次 A2A 协作必须写入：

1. 一条 `a2a_call`
2. 一条 `a2a_result`
3. caller 视角 `a2a_summary`
4. callee 视角 `a2a_summary`
5. task 视角 `task_state`

禁止只在 caller 或只在 callee 单边沉淀协作记忆。

---

## 5. 召回规则

## 5.1 统一召回入口

召回必须采用统一混合召回，不允许依赖“模型自行猜共享 KV key”。

召回候选至少来自三路：

1. 当前问题相关语义记忆
2. 当前主体最近记忆窗口
3. 当前关联协作摘要

## 5.2 群聊召回

群聊场景必须混合：

1. 当前 conversation 最近窗口
2. 当前 group 的 `group_summary`
3. 当前 agent 在该 group 的成员视角记忆
4. 与问题相关的群历史语义记忆

## 5.3 A2A 召回

当前 agent 必须可同时召回：

1. 自己作为 caller 的历史协作摘要
2. 自己作为 callee 的历史协作摘要
3. 当前 task 的协作链摘要
4. caller-callee 关系记忆

## 5.4 重排公式

默认重排：

`score = 0.30*semantic + 0.20*recency + 0.15*importance + 0.10*confidence + 0.15*relation_match + 0.10*scope_match - penalty`

其中：

1. `relation_match` 代表与 group/task/a2a 关系的匹配度
2. `scope_match` 代表与当前 conversation / participant 的匹配度
3. `penalty` 主要用于重复、冲突、已过期、已撤销

当前实现对齐（2026-03-15，执行侧）：

1. 语义候选：`score = base(lexical/recency/confidence) * query_subject_weight`
2. 投影候选：`score = base(lexical/recency/projection_role) * query_subject_weight`
3. `query_subject_weight` 来自 `subject_plan`：主主体 depth=0 + 关联主体 depth=1；关联主体权重由“最近投影事件共现强度 * 类型权重 * depth 惩罚”综合得到
4. 去重：同一个 `source_event_id/event_id` 只保留更高分候选（语义与投影同台竞争）

---

## 6. 上下文预算

默认上下文预算：

1. 当前会话短期窗口：35%
2. `task_state`：20%
3. 群聊/A2A 摘要：20%
4. `fact + preference`：20%
5. `tool_experience`：5%

硬约束：

1. 同一 `source_event_id` 不得重复进入上下文
2. `revoked / expired / superseded loser` 默认禁止进入上下文
3. `summary_*` 不应覆盖原始事实，只作为压缩导航层

---

## 7. 冲突与版本规则

## 7.1 冲突触发

1. 同一 `entity_key` 出现新值
2. 同一 task 状态出现互斥结论
3. 同一群摘要出现明显更新
4. 同一 A2A 节点出现新结果

## 7.2 决议规则

1. 高置信新记录替代旧记录时，旧记录标记 `superseded`
2. 置信度接近但时间更近时，保留版本链
3. 用户显式纠错时，旧记录标记 `revoked`
4. `group_summary` 与 `a2a_summary` 优先做版本替代，不直接删除旧摘要

---

## 8. 生命周期与治理

## 8.1 生命周期

1. `summary_turn` 短期保留
2. `summary_topic` 中期保留
3. `group_summary`、`a2a_summary` 按衰减策略管理
4. `fact/preference` 长期保留
5. `task_state` 随任务生命周期衰减

## 8.2 可观测性

每次召回应记录：

1. 命中的 `subject_type/subject_id`
2. 命中的 `memory_type`
3. 命中的 `source_event_id`
4. 分数构成
5. 进入上下文或被淘汰原因

---

## 9. 性能目标

1. P50 召回延迟 < 60ms
2. P95 召回延迟 < 120ms
3. 同步写入附加开销 < 40ms
4. 异步摘要与索引完成时间 P95 < 3s

降级策略：

1. 语义召回失败时保留最近窗口 + 关系摘要
2. 关系召回失败时保留语义 + 最近窗口
3. 禁止因某一路失败导致完全失忆

---

## 10. 发布与门槛

功能开关建议：

1. `memory.orchestrator.enabled`
2. `memory.semantic.auto_recall.enabled`
3. `memory.group.enabled`
4. `memory.a2a.enabled`
5. `memory.projection.enabled`
6. `memory.summary.enabled`
7. `memory.conflict_resolution.enabled`

上线门槛：

1. 群聊连续性显著提升
2. A2A 历史可稳定召回
3. 旧污染记忆不再继续扩大
4. 召回 explain 可追溯
5. 性能指标达标
