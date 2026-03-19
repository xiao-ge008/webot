# Windows 开发机初始化与迁移说明

本文档用于回答一个实际问题：为什么同一份 Git 代码，在不同 Windows 开发机上的启动体验差异会很大。

结论先写在前面：

- 代码仓库里保存的是源码，不会自动携带本机的 Rust 链接器、MinGW、WebView2、WiX、`node_modules`、Cargo 缓存和本地编译产物。
- 这个仓库的桌面开发现在统一按 `GNU Rust + MinGW` 运行，避免依赖某台机器本地才有的 `link.exe`。
- `app` 模式默认不再挂 QQ 桥；QQ 桥属于可选的 Web 调试扩展能力，不应该阻塞桌面端启动。

## 一键初始化

在仓库根目录执行：

```powershell
npm run bootstrap:dev:windows
```

脚本位置：

- `scripts/bootstrap-dev.ps1`

它会处理下面几件事：

1. 检查 `node`、`npm`、`cargo`、`rustup` 是否存在。
2. 检查 GNU 工具链目录是否存在，默认路径为 `%USERPROFILE%\tools\winlibs-x64\mingw64\bin`。
3. 检查并补齐 `stable-x86_64-pc-windows-gnu` toolchain 与 `x86_64-pc-windows-gnu` target。
4. 在首次接手机器时运行 `npm install`。
5. 如有需要，编译 `vendor/openfang` 的 GNU 版 `openfang.exe`。
6. 将 `openfang.exe` 同步到 `apps/frontend/src-tauri/resources/openfang`。

只做体检、不执行安装和编译，可以运行：

```powershell
npm run bootstrap:dev:check
```

## 当前仓库约定

### 1. Windows 桌面开发统一走 GNU

当前仓库已经把下列脚本切到 GNU 环境：

- `scripts/start-dev.mjs`
- `scripts/build-desktop.mjs`

也就是说，在这台机器上：

- `npm run dev:start:app`
- `npm run build:desktop`

都会优先注入 GNU 工具链环境，而不是依赖本机默认 MSVC。

### 2. `app` 模式不再依赖 QQ 桥

桌面端调试只需要：

```powershell
npm run dev:start:app
```

如果要联调 QQ 桥，请使用 Web 模式：

```powershell
npm run dev:start -- web --qqbot
```

这样拆分的原因是：QQ 桥是外部扩展能力，不应成为桌面端调试的硬前提。

### 3. `openfang.exe` 属于本地构建产物

仓库中的源码并不保证每台机器都天然拥有下面这个文件：

```text
vendor/openfang/target/x86_64-pc-windows-gnu/release/openfang.exe
```

因此初始化脚本会尽量把它补齐，并同步到：

- `apps/frontend/src-tauri/resources/openfang/win/openfang.exe`
- `apps/frontend/src-tauri/resources/openfang/openfang.exe`

## 必需依赖

### 开发启动必需

- Node.js 20+
- npm 10+
- Rust + rustup
- `stable-x86_64-pc-windows-gnu`
- `x86_64-pc-windows-gnu`
- MinGW/WinLibs

默认 MinGW 路径：

```text
%USERPROFILE%\tools\winlibs-x64\mingw64\bin
```

如果你的路径不同，可以先设置：

```powershell
$env:WEBOT_MINGW_BIN = 'D:\tools\winlibs-x64\mingw64\bin'
```

然后再执行 bootstrap。

### 桌面打包额外需要

- .NET SDK
- WiX

这两项主要影响 `npm run build:desktop`，不影响 `npm run dev:start:app`。

## 常见问题

### 1. 为什么老机器能跑，新机器不行？

因为老机器上存在很多“隐式前提”：

- 装过 Visual Studio Build Tools，默认就有 `link.exe`
- 本地已有 `node_modules`
- 本地已经编过 `openfang.exe`
- 本地可能已有 QQ 桥 dist 产物
- 本地存在 Cargo target 和缓存

这些状态不会随 Git 一起同步。

### 2. 为什么现在要去掉 `cdylib`？

这是为了消除 GNU 链接阶段的一个真实问题。

在 `apps/frontend/src-tauri/Cargo.toml` 中，桌面端库原先声明了：

```toml
crate-type = ["staticlib", "cdylib", "rlib"]
```

切到 GNU 后，链接 `webot_frontend_lib.dll` 时触发了导出表上限错误。当前桌面入口只需要 `main.rs -> lib.rs::run()` 这条路径，不需要额外生成 `cdylib`，因此将其收敛为：

```toml
crate-type = ["staticlib", "rlib"]
```

这不是为某台机器特判，而是把一个只在 GNU 下暴露出来的无效配置清掉。

### 3. 为什么 `app` 模式不再默认带 `--qqbot`？

因为 `app` 模式的目标是验证桌面端自身能否启动。QQ 桥属于可选外部联调项，不应该阻塞桌面端入口。

## 推荐接手流程

新机器接手时按下面顺序：

1. `git clone`
2. `npm run bootstrap:dev:windows`
3. `npm run dev:start:app`
4. 如果需要 Web + QQ 联调，再执行 `npm run dev:start -- web --qqbot`
5. 需要打包时再补齐 `.NET SDK` / `WiX` 并执行 `npm run build:desktop`

## 相关文件

- `scripts/bootstrap-dev.ps1`
- `scripts/windows-rust-env.mjs`
- `scripts/start-dev.mjs`
- `scripts/build-desktop.mjs`
- `apps/frontend/src-tauri/Cargo.toml`
