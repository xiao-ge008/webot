# 智能体统一记忆系统设计方案（v2）

日期：2026-03-15  
状态：Draft v2  
适用范围：`weBot-app` + `openfang` 联合部署  
目标：把“短期上下文、主题总结、长期记忆、群聊协作、A2A 协作”统一为一套可治理、可召回、可扩展的记忆系统。

---

## 1. 设计结论

### 1.1 核心结论

1. 记忆系统不能再按“单个 agent 各记各的”建设，必须升级为“统一关联记忆系统”。
2. 群聊与 A2A 不应被视为普通文本日志，它们本质上是多主体协作事件，必须进入同一条记忆主链。
3. 真正可用的记忆系统应分为三层：事件层、投影层、语义层，而不是只有 KV 和记忆文本两种形态。
4. `workspace/memory/*.md` 与 `MEMORY.md` 继续保留，但定位为审计/导出层，不承担主召回职责。
5. `memory_recall` 不应再作为“让模型自行猜 key 的共享 KV 工具”，而应逐步演化为统一记忆查询入口。

### 1.2 当前系统的主要结构性问题

1. 短期上下文、长期语义记忆、共享 KV 和记忆文件是割裂的。
2. 群聊与 A2A 缺少统一事件建模，导致“谁参与过什么协作”无法稳定召回。
3. 同一条信息会被重复写入多个主体，造成污染、重复和 token 浪费。
4. 旧链路中系统注入内容会污染长期记忆，降低召回质量。
5. 召回缺少“当前主体 + 会话最近窗口 + 关联协作摘要”的统一拼装逻辑。

---

## 1.3 当前已落地能力

截至 2026-03-15，以下能力已经在现有代码链路中落地：

1. 服务层默认启用语义记忆增强，并采用“相关检索 + 最近窗口”混合召回，而不是靠关键词硬判断是否回顾历史。
2. 运行时在写入长期记忆和构造召回 query 前，会清洗 `[system:*]` 注入内容，降低角色设定污染长期记忆的概率。
3. `agent_send` 成功后，会为 caller 与 callee 双向写入 `agent_collaboration` 语义记忆，形成最小可用的 A2A 协作记忆闭环。
4. `memory_recall` 的定位已收敛为“共享 KV 已知 key 工具”；统一召回与排序统一走 `/api/memory/agents/{id}/unified-search`（语义 + 投影），避免模型猜 key。
5. 群聊链路已具备 `group session label + MemoryTurnContext` 隔离能力，并在群消息成功处理后额外写入 `group_message` 与 `group_summary` 语义记忆，为后续事件层/投影层正式落库提供兼容基础。
6. `openfang-memory` 已新增 `memory_events` 与 `memory_projections` 两张结构表，群聊与 A2A 开始同步写入事件事实和多主体投影，统一记忆系统已经不再只是“语义文本堆积”。
7. 统一记忆查询已开始补充最近的 agent 投影事件，因此事件层不再只是审计链，而是开始进入真实召回链路。
8. 统一记忆查询结果已经开始带 `score` 与 `explain`，并支持按 `subject_type/subject_id` 明确查询 agent、group、user、a2a_edge 等主体视角。
9. 服务层自动记忆增强已切到统一记忆查询接口，自动注入 prompt 不再只依赖纯语义记忆，而会吃到群聊/A2A 投影事件。
10. 统一查询会构建 `subject_plan`（主主体 + 关联主体集合），对 `task / group / user / a2a_edge / agent` 做多主体联合权重，并将语义候选与投影候选统一去重后再排序。
11. 已提供统一记忆调试接口（`/unified-debug`）；同时 `service-rs` 会把调试摘要合并到聊天日志的 `phase=unified_memory_recall` 事件里，便于端到端调优。

这些实现还不是最终形态，但已经把“统一召回”和“A2A 双向记忆”从设计推进到了运行链路。

---

## 2. 设计目标

### 2.1 必须达成

1. 同一条协作事件能同时服务于私聊、群聊和 A2A 场景。
2. 当前智能体在回答前，可以自动获取：
   - 当前会话短期上下文
   - 当前主体长期语义记忆
   - 当前群聊相关总结
   - 当前任务/A2A 协作摘要
3. A 调 B 后，A 与 B 都能在后续对话中召回这次协作。
4. 群聊内所有有效讨论都能沉淀为群级摘要与成员视角摘要。
5. 整套系统有统一治理能力：去重、冲突、版本替代、过期、撤销、解释日志。

### 2.2 当前阶段不做

1. 不引入外部重型记忆中间件集群。
2. 不做跨产品跨租户的全局知识网络。
3. 不在 P0 阶段追求复杂自治演化，只先解决“记得对、记得稳、召得回”。

---

## 3. 总体架构

## 3.1 三层记忆结构

### A. 事件层 `memory_event`

事件层记录真实发生过的交互或协作，是唯一事实源。

事件类型至少包括：

1. `user_message`
2. `assistant_message`
3. `group_message`
4. `a2a_call`
5. `a2a_result`
6. `tool_result`
7. `summary_turn`
8. `summary_topic`
9. `summary_episode`

这一层强调“不丢事实、不重复写原文”。

### B. 投影层 `memory_projection`

投影层定义“这条事件对谁有意义”。

同一事件可以投影给：

1. 当前 agent
2. 被委派的 agent
3. 所属 conversation
4. 所属 group
5. 所属 task
6. 特定 user

投影层解决“统一事件，多主体可见”的问题。

### C. 语义层 `memory_semantic`

语义层是为了召回而存在的压缩结果，不保存全部原文，而保存对后续最有价值的结论。

语义类型建议包括：

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

---

## 4. 统一关联模型

## 4.1 主体模型 `memory_subject`

记忆主体不是只有 agent，还应包含：

1. `agent`
2. `user`
3. `group`
4. `conversation`
5. `task`
6. `a2a_edge`

其中：

1. `group` 表示群级共享记忆空间。
2. `conversation` 表示一段具体对话链路。
3. `task` 表示一个连续任务生命周期。
4. `a2a_edge` 表示某次 caller -> callee 的协作关系。

## 4.2 关联模型 `memory_link`

为避免复制，记忆必须显式记录关联关系：

1. `source_event_id`
2. `conversation_scope`
3. `group_scope`
4. `participant_scope`
5. `task_id`
6. `caller_agent_id`
7. `callee_agent_id`
8. `reply_to_event_id`
9. `delegation_depth`
10. `tool_use_id`

这组字段决定后续召回时“哪些记忆和当前上下文相关”。

---

## 5. 群聊记忆设计

## 5.1 群聊写入原则

群聊中的每条消息先作为共享事件入库，再派生摘要，不直接向每个成员重复写原文。

每条群聊事件至少应绑定：

1. `group_id`
2. `conversation_scope`
3. `speaker_agent_id` 或 `speaker_user_id`
4. `participant_ids`
5. `message_role`

## 5.2 群聊派生记忆

群聊至少派生两类长期记忆：

1. 群级摘要 `group_summary`
   - 最近讨论主题
   - 达成的共识
   - 未决问题
   - 活跃成员与分工

2. 成员视角摘要
   - 某 agent 在该群里负责过什么
   - 某 agent 与谁协作过
   - 某 agent 最近的结论、任务、承诺

## 5.3 群聊召回

群聊场景回答前，至少混合召回：

1. 当前 conversation 最近窗口
2. 当前 group 的长期摘要
3. 当前发言 agent 在该群中的个人视角记忆
4. 与当前问题高相关的群历史语义记忆

---

## 6. A2A 协作记忆设计

## 6.1 A2A 事件模型

一次 A2A 至少拆成两个事件：

1. `a2a_call`
2. `a2a_result`

必备字段：

1. `caller_agent_id`
2. `callee_agent_id`
3. `task_id`
4. `request_summary`
5. `result_summary`
6. `status`
7. `delegation_depth`
8. `source_event_id`

## 6.2 A2A 派生记忆

同一次协作至少派生三种语义记忆：

1. caller 视角摘要
   - 我把什么任务交给了谁
   - 对方处理结果如何

2. callee 视角摘要
   - 我为谁处理了什么任务
   - 我给出的结果和结论

3. 任务级摘要
   - 当前任务有哪些协作节点
   - 各节点状态如何

## 6.3 A2A 召回

当前 agent 回答前，应能召回：

1. 自己作为 caller 的历史协作
2. 自己作为 callee 的历史协作
3. 当前 task 的协作链摘要
4. 与当前问题相关的 caller/callee 关系记忆

---

## 7. 上下文与总结体系

## 7.1 短期上下文

短期上下文只保留有限窗口，不承载长期知识。

来源包括：

1. 最近消息窗口
2. 当前轮 `turn summary`
3. 当前话题 `topic summary`
4. 当前 task 的工作状态

## 7.2 中期总结

中期总结用于压缩多轮讨论。

1. `summary_turn`
   - 每轮生成
   - 提炼本轮新增事实、决策、约束

2. `summary_topic`
   - 若干轮后生成
   - 聚合当前主题的结论与未决问题

3. `summary_episode`
   - 任务结束或跨阶段生成
   - 沉淀阶段性成果、失败经验、后续动作

## 7.3 长期记忆

长期记忆不是原始对话，而是“可复用事实”。

主要保留：

1. 用户偏好
2. 稳定事实
3. 长期任务状态
4. 群级协作画像
5. A2A 协作画像
6. 工具经验

---

## 8. 统一召回策略

## 8.1 基本原则

召回不再依赖“模型自己猜 key”，而采用统一混合召回。

每轮默认并行构造三类候选：

1. 当前问题相关语义记忆
2. 当前主体的最近记忆窗口
3. 当前关联对象的协作摘要

## 8.2 召回拼装顺序

建议按以下顺序拼上下文：

1. 当前会话短期窗口
2. 当前 conversation / group 的近期摘要
3. 当前 agent 相关长期记忆
4. 当前 task / A2A 协作摘要
5. 其余高相关长期记忆

## 8.3 去重与预算

上下文拼装前必须做：

1. 基于 `event_id` 去重
2. 基于 `content hash` 去重
3. 基于 `type + entity_key` 合并

预算建议：

1. 短期上下文：35%
2. `task_state`：20%
3. 群聊/A2A 摘要：20%
4. `fact/preference`：20%
5. `tool_experience`：5%

---

## 9. 治理与安全

## 9.1 去重与冲突

1. 同一事件只允许一份原始记录。
2. 同一事实槽位更新时，建立 `supersedes` 关系，不直接硬覆盖。
3. 同一协作节点的多次总结必须有版本链。

## 9.2 生命周期

1. `summary_turn` 短 TTL
2. `summary_topic` 中 TTL
3. `fact/preference` 长 TTL
4. `task_state` 按任务生命周期清理
5. `group_summary` 和 `a2a_summary` 采用衰减而非立即删除

## 9.3 可解释性

每次召回应记录：

1. 命中来源
2. 命中主体
3. 命中关系
4. 进入上下文原因
5. 被淘汰原因

---

## 10. 与当前代码的映射建议

优先改造的模块：

1. [agent_loop.rs](E:/weBot2/webot-app/vendor/openfang/crates/openfang-runtime/src/agent_loop.rs)
   负责统一写入入口、短期摘要与长期记忆抽取。

2. [routes.rs](E:/weBot2/webot-app/apps/service-rs/src/routes.rs)
   负责统一召回编排、群聊/A2A 辅助拼装、服务层兜底。

3. `openfang-memory/src/semantic.rs`
   负责多主体语义召回、去重、重排。

4. `openfang-memory/src/migration.rs`
   负责补齐 `group_id / task_id / caller_agent_id / callee_agent_id / source_event_id` 等字段。

5. 群聊与 A2A 路由
   把群聊消息、A2A 调用结果接入统一 remember pipeline。

---

## 11. 最终架构建议

统一记忆系统采用：

`共享事件层 + 多主体投影层 + 语义压缩层 + 混合召回编排层`

这套模型能同时解决：

1. 私聊连续性
2. 群聊公共记忆
3. A2A 协作记忆
4. 短期上下文控制
5. 长期语义召回
6. 统一治理与解释

最终目标不是“多记”，而是“记得准、记得干净、召得回来、能解释为什么记住了这件事”。
