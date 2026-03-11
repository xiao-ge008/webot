# OpenFang 对齐服务改造计划

日期：2026-03-04

## 目标

将当前服务层重构为“官方对齐架构”：

- 前端只面对 `service-rs`（管理与聚合）。
- `service-rs` 对接 OpenFang 官方 API。
- OpenFang 作为唯一业务状态源。

## 已完成

1. 新增 Rust 管理网关：`apps/service-rs`
2. 管理接口：
   - `GET /api/management/agents`
   - `POST /api/management/agents`
   - `DELETE /api/management/agents/{id}`
   - `GET /api/management/skills`
   - `GET /api/management/workflows`
   - `POST /api/management/workflows/{id}/run`
   - `GET /api/management/providers`
   - `GET /api/management/models`
   - `GET /api/management/a2a/agents`
   - `POST /api/management/a2a/tasks/send`
   - `GET /api/management/a2a/tasks/{id}`
   - `POST /api/management/a2a/tasks/{id}/cancel`
3. 数据组合中转接口：
   - `GET /api/compose/dashboard`
4. 健康检查：
   - `GET /api/health`
5. 业务接口：
   - `POST /api/chat/{id}/message`
   - `POST /api/chat/{id}/message/stream`（SSE 透传）

## 后续业务实现顺序

1. A2A/Workflow 管理页
   - 增加 workflow 详情与 run 历史聚合接口
2. 技能与 MCP 管理页
   - 组合 skills + marketplace + mcp servers 视图
3. 下线 Node 过渡服务
   - 前端 API 全量切换后，删除 `apps/server`

## 设计约束

1. 网关层只做适配与组合，不做重复调度引擎。
2. 错误信息尽量透传 OpenFang 原始响应，便于排障。
3. 接口命名保持 `management` / `compose` 两层语义，避免未来扩展冲突。
