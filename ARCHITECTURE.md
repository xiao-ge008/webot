# 基础架构说明

## 分层原则

1. `apps/frontend` 负责交互与渲染（A2UI/json-render）。
2. `apps/service-rs` 负责管理接口与数据组合中转（薄网关）。
3. `openfang` 负责核心业务内核（Agent/A2A/Workflow/Skill/MCP/调度）。
4. `packages/shared-types` 负责前端与过渡层类型统一。

## 当前阶段（对齐官方）

- 完成 Rust 管理网关基础能力：
  - 管理接口：agents/skills/workflows/providers/models
  - 组合接口：dashboard 聚合视图
- 保持 OpenFang 为唯一业务状态源，降低升级成本
- Node `apps/server` 作为迁移过渡，逐步收敛下线

## 关键设计约束

1. 组件渲染遵循 json-render Spec，不直接信任模型原始文本。
2. 渲染前必须做结构与 props 校验，失败统一 fallback。
3. 共享类型只放在 `packages/shared-types`，避免前后端协议漂移。
4. 网关层只做适配/聚合，不复制 OpenFang 核心业务逻辑。
