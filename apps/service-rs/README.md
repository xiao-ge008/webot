# webot-service-rs

对齐 OpenFang 官方架构的 Rust 服务网关。

目标：

- 提供稳定的管理接口给前端（不直接耦合全部 OpenFang 细节）。
- 提供数据组合中转接口（dashboard 聚合）。
- 保持薄封装，核心业务状态仍由 OpenFang 管理，便于后续升级。

## 启动

```bash
cargo run --manifest-path apps/service-rs/Cargo.toml
```

默认监听：`127.0.0.1:4310`

## 环境变量

- `SERVICE_LISTEN_ADDR`：默认 `127.0.0.1:4310`
- `OPENFANG_BASE_URL`：默认 `http://127.0.0.1:4200`
- `OPENFANG_API_KEY`：可选，若 OpenFang 开启认证则填入
- `OPENFANG_TIMEOUT_MS`：默认 `20000`

## API

- `GET /api/health`
- `POST /api/chat/{id}/message`
- `POST /api/chat/{id}/message/stream` (SSE passthrough)
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
- `GET /api/compose/dashboard`
