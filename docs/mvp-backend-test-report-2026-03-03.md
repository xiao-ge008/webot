# MVP 后端调度测试报告（2026-03-03）

## 范围

- 仅验证后端框架与 API 调度链路，不包含前端 UI。
- 测试服务：`@webot/server`（`http://127.0.0.1:4300`）。

## 编译检查

- `npm run typecheck --workspace @webot/shared-types`：通过
- `npm run typecheck --workspace @webot/server`：通过
- `npm run build --workspace @webot/shared-types`：通过
- `npm run build --workspace @webot/server`：通过

## API 测试结果

1. 健康检查
- `GET /api/health`：通过

2. 管理 API
- 创建 `workspace`：通过
- 创建 `skill`：通过
- 创建 `mcp`：通过
- 创建 `agent`：通过
- 生成配置文件 `POST /api/agents/:id/config-file`：通过
- 配置文件输出路径：`E:\weBot2\runtime\workspaces\mvp\configs\agent_d2a04e68059a.json`

3. 调度 API（gold_price_probe）
- 创建 schedule：通过
- 手动触发 3 次 `POST /api/schedules/:id/run`：通过
- 记录查询 `GET /api/schedules/:id/runs`：通过
- 最新结果：`success`
- 样例输出：`黄金现价: 5112.245 USD (XAUUSD @ 20260303 170924, open=5324.875, high=5379.865, low=4997.975)`

4. 调度 API（agent_message）
- 创建 schedule：通过
- 手动触发：失败（预期内）
- 失败原因：OpenFang 服务未在 `127.0.0.1:4200` 运行，网络请求失败

## 结论

- 后端框架可用，管理与调度主链路已打通。
- 黄金探测任务支持回退源，调度可稳定执行并记录运行结果。
- `agent_message` 已具备错误可观测性，待 OpenFang 服务启动后可做成功链路复测。
