# WeBot Desktop 对齐 OpenFang 官方实现

## 官方实现要点（OpenFang）

1. 桌面端是 **Tauri 2.0 壳**，不是 Electron。
2. Rust 进程内启动后端服务（内核 + axum），监听 `127.0.0.1:{random_port}`。
3. WebView 指向本地 HTTP 服务，不直接把全部业务做成 IPC。
4. IPC 只保留少量桌面能力入口（如 `get_port` / `get_status`）。
5. 后端生命周期由桌面壳统一管理（启动、健康、退出）。

参考：
- `openfang/crates/openfang-desktop/src/lib.rs`
- `openfang/crates/openfang-desktop/src/server.rs`
- `openfang/crates/openfang-desktop/src/commands.rs`
- `openfang/docs/desktop.md`
- `openfang/docs/architecture.md`

## 本仓库当前对齐结果

1. `apps/service-rs` 已改造成可嵌入库，支持被桌面壳直接启动：
   - 新增 `start_embedded(...)` 与 `EmbeddedServerHandle`
   - 保留 CLI 启动路径（`main.rs`）
2. `apps/frontend/src-tauri` 已接入“壳托管后端”：
   - 启动时拉起内嵌 `service-rs`（随机端口）
   - 暴露 IPC：`get_port`、`get_api_base_url`、`get_status`
   - 退出时主动关闭内嵌服务
3. 前端新增统一 `transport`：
   - Tauri：通过 IPC 读取 `get_api_base_url` 再发 HTTP
   - Web：读取 `VITE_WEBOT_API_BASE_URL`（默认 `http://127.0.0.1:4310`）
4. `agent-client` 已改为 HTTP 优先（聊天/流式/任务），旧 IPC 作为兜底。
5. 前端构建错误已清理，`npm run build` 可通过。

## 下一步建议（保持官方风格）

1. 前端 API 层统一读取 `get_api_base_url`，将业务请求收口到本地服务。
2. 再逐步补齐桌面能力：
   - system tray
   - single instance
   - autostart
   - updater
3. 最后根据你要的升级策略，决定：
   - 继续保留 `service-rs` 作为适配层
   - 或进一步把 openfang 核心直接内嵌到 desktop crate（更接近官方）
