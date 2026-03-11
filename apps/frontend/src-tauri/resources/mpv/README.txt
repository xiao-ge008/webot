将 mpv 可执行文件放到此目录，用于桌面版打包时随应用分发。

推荐目录结构（支持 Win / macOS / Linux，多平台与多架构）：

- `resources/mpv/win-x64/mpv.exe`
- `resources/mpv/win-arm64/mpv.exe`
- `resources/mpv/win/mpv.exe`（通用回退）
- `resources/mpv/macos-aarch64/mpv`
- `resources/mpv/macos-x86_64/mpv`
- `resources/mpv/macos/mpv`（通用回退）
- `resources/mpv/linux-x86_64/mpv`
- `resources/mpv/linux-aarch64/mpv`
- `resources/mpv/linux/mpv`（通用回退）

可执行文件旁需放置其运行依赖（如 Windows 的 DLL）。

运行时探测顺序：
1) 按当前平台 + 架构目录优先（如 `win-x64`、`macos-aarch64`、`linux-x86_64`）
2) 平台通用目录（`win` / `macos` / `linux`）
3) `resources/mpv` 根目录
4) 系统 PATH 中的 `mpv`
