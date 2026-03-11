# Webot App（基础工程）

该工程承接 `mvptest` 的验证成果，当前阶段对齐 OpenFang 官方架构：前端 UI + Rust 管理网关 + OpenFang 核心。

## 目录

- `apps/service-rs`：Rust 管理网关（管理接口 + 数据组合中转）
- `apps/server`：Node 过渡服务（逐步下线）
- `packages/shared-types`：共享类型定义
- `apps/frontend`：现有 UI 工程（A2UI/json-render）

## 快速开始（Rust 网关）

```bash
npm install
npm run check:service-rs
npm run dev:service-rs
```

默认网关地址：`http://127.0.0.1:4310`

### OpenFang 自动拉起（开机按钮）

点击首页“开机”时，`service-rs` 会按以下顺序尝试拉起 OpenFang：

1. `OPENFANG_START_COMMAND`（若设置）
2. `apps/frontend/src-tauri/resources/openfang` 下的打包二进制（`openfang(.exe)`）

常用环境变量：

- `OPENFANG_START_COMMAND`：自定义启动命令
- `OPENFANG_START_ARGS`：自定义参数（空格分隔）
- `OPENFANG_WORKDIR`：OpenFang 工作目录（不设置则使用资源目录）
- `OPENFANG_STARTUP_WAIT_MS`：开机等待超时（默认 `60000`）

提示：需要自定义启动参数时，可复制 `.env.example` 为 `.env` 后修改。

说明：

- 若 OpenFang `default_model.api_key_env` 指向如 `NVIDIA_API_KEY`，需保证该环境变量在启动 `service-rs`/Tauri 进程时可见。
- `service-rs` 启动时默认会自动尝试开机（`OPENFANG_AUTO_START=true`）；若你想关闭自动开机可设置 `OPENFANG_AUTO_START=false`。
- `service-rs` 会额外尝试加载这些环境文件（后加载会覆盖先加载）：
  - 当前工作目录及其上级目录内的 `.env`（最多回溯 4 级）
  - `~/.webot/.env`

调试说明：

- 默认从项目内资源目录启动：`apps/frontend/src-tauri/resources/openfang`（可放 `openfang.exe`，也可按平台子目录放置）。

## 统一启动脚本（Web / App）

```bash
# Web 模式：启动 frontend + service-rs
npm run dev:start:web

# App 模式：启动 Tauri 桌面调试
npm run dev:start:app

# 或使用统一入口（可带 --dry-run）
npm run dev:start -- web
npm run dev:start -- app
```

说明：

- 脚本会先自动清理默认端口占用，再启动：
  - `web`：`5173`（Vite）+ `4310`（service-rs）
  - `app`：`5173`（Tauri dev 的前端端口）
- 端口清理后会再次检查，若仍冲突会退出并报错。

## 常用脚本

- `npm run check:service-rs`：检查 Rust 管理网关
- `npm run dev:service-rs`：启动 Rust 管理网关
- `npm run typecheck`：检查共享类型包 + Node 过渡服务
- `npm run build`：构建共享类型包 + Node 过渡服务
- `npm run dev:server`：启动后端开发服务
- `npm run typecheck:all`：检查全部 workspace（含前端）
- `npm run build:all`：构建全部 workspace（含前端）

## 主 Skills 加载规则

- 技能提示词不直接硬编码在聊天代码中，而是通过公共技能目录中的 `SKILL.md` 动态注入。
- 公共 skills 主目录优先使用 `~/.webot/skills`，例如 Windows 下为 `C:\Users\Administrator\.webot\skills`。
- GUI / 桌面 / Web 渲染端可按需加载 `ui-skill`，用于指导模型输出“自然语言 + UI JSON”。
- `ui-skill` 默认对所有智能体视为开启；其他自定义 skill 默认关闭，只有显式分配后才注入。
- 非渲染端（如 WhatsApp、Telegram 纯文本推送、Webhook 文本通知）不加载 `ui-skill`，仅输出自然语言或 Markdown。
- `ui-skill` 只描述加载规则、组件目录、组合方式和输出约束，不和具体聊天业务强耦合。

## 说明

1. `mvptest` 目录保留为实验与对照工程。
2. 本目录是正式落地目录，后续迭代以 OpenFang 官方协议为主，减少自定义后端重复实现。
