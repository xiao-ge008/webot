# Webot App / Webot 应用工程

中文说明在前，英文说明在后。

**中文**

## 简介

Webot App 是一个前端 UI + Rust 管理网关 + OpenFang 核心的基础工程。当前仓库已按项目内资源目录启动 OpenFang，无需依赖外部调试目录。

## 目录结构

- `apps/frontend`：前端与桌面端（Tauri）
- `apps/service-rs`：Rust 管理网关（管理接口 + 数据组合中转）
- `packages/shared-types`：共享类型
- `docs`：设计与说明文档
- `scripts`：构建与开发脚本

## 快速开始（服务网关）

```bash
npm install
npm run check:service-rs
npm run dev:service-rs
```

默认网关地址：`http://127.0.0.1:4310`

## OpenFang 启动逻辑

`service-rs` 启动时会尝试拉起 OpenFang：

- 若设置了 `OPENFANG_START_COMMAND`，优先使用该命令。
- 否则使用项目内资源目录：`apps/frontend/src-tauri/resources/openfang`。

常用环境变量：

- `OPENFANG_START_COMMAND`：自定义启动命令
- `OPENFANG_START_ARGS`：自定义参数（空格分隔）
- `OPENFANG_WORKDIR`：OpenFang 工作目录（不设置则使用资源目录）
- `OPENFANG_STARTUP_WAIT_MS`：开机等待超时（默认 `60000`）

提示：需要自定义启动参数时，可复制 `.env.example` 为 `.env` 后修改。

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

端口检查：

- `web`：`5173`（Vite）+ `4310`（service-rs）
- `app`：`5173`（Tauri dev 的前端端口）

## 构建与类型检查

```bash
npm run typecheck
npm run build

# 全部 workspace
npm run typecheck:all
npm run build:all
```

## 说明

- `.env` 已加入忽略列表，不会提交。
- `node_modules`、`dist`、`target` 等构建产物默认忽略。

---

**English**

## Overview

Webot App is a base project that combines a UI frontend, a Rust management gateway, and the OpenFang core. It runs OpenFang from the project resources directory by default, without relying on external debug paths.

## Structure

- `apps/frontend`: Web UI and desktop (Tauri)
- `apps/service-rs`: Rust management gateway
- `packages/shared-types`: Shared types
- `docs`: Design docs
- `scripts`: Build and dev scripts

## Quick Start (Gateway)

```bash
npm install
npm run check:service-rs
npm run dev:service-rs
```

Default gateway: `http://127.0.0.1:4310`

## OpenFang Bootstrap

`service-rs` tries to start OpenFang on launch:

- If `OPENFANG_START_COMMAND` is set, it takes priority.
- Otherwise it uses the bundled resources: `apps/frontend/src-tauri/resources/openfang`.

Common env vars:

- `OPENFANG_START_COMMAND`: custom start command
- `OPENFANG_START_ARGS`: custom args (space separated)
- `OPENFANG_WORKDIR`: OpenFang working dir (defaults to resources)
- `OPENFANG_STARTUP_WAIT_MS`: startup timeout (default `60000`)

Tip: copy `.env.example` to `.env` if you need custom settings.

## Unified Dev Scripts

```bash
npm run dev:start:web
npm run dev:start:app

npm run dev:start -- web
npm run dev:start -- app
```

Ports:

- `web`: `5173` (Vite) + `4310` (service-rs)
- `app`: `5173` (Tauri dev frontend)

## Build & Typecheck

```bash
npm run typecheck
npm run build

npm run typecheck:all
npm run build:all
```

## Notes

- `.env` is ignored and not committed.
- `node_modules`, `dist`, `target` and other build outputs are ignored by default.
