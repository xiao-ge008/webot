# 本地视觉完整逻辑

更新时间：2026-03-22

## 目标

把图片理解链路收敛成两条清晰路径：

1. 图片上传时只落盘，不做本地视觉解析。
2. 用户点击发送后，再把“本轮用户文字 + 本轮图片”一起交给本地 Florence-2 做聚焦分析。
3. 如果本地视觉拿到结果，就直接把“图片文件信息 + 本地视觉文本 + 用户输入”发送给 OpenFang。
4. 如果本地视觉没有拿到结果，才把原图附件继续发送给 OpenFang，让它通过 `image_analyze` / `media_describe` 走本地视觉优先、模型视觉回退的运行时链路。

核心原则：

- 上传不解析，发送时才解析。
- 已有本地视觉结果时，不再把同一张图作为原始视觉附件重复发送给底层模型。
- 本地视觉结果文本是本轮图片理解的首要事实来源。
- 没有本地视觉结果时，才保留原图附件，让运行时自行调度视觉工具。

当前默认本地视觉模型：

- 模型 ID：`laub/Florence-2-large-PromptGen-v2.0-onnx`
- 镜像基址：`https://hf-mirror.com/laub/Florence-2-large-PromptGen-v2.0-onnx/resolve/main`
- 本地目录：`~/.webot/shared/models/vision/laub/Florence-2-large-PromptGen-v2.0-onnx`
- 文件形态：未量化 ONNX 多文件目录，不再使用旧的 `onnx-community/Florence-2-large-ft` 量化文件名

## 实际链路

### 1. 上传阶段

前端上传图片后只做两件事：

- 上传并落盘到当前智能体工作区
- 返回附件路径、文件 ID、sha256 等基础信息

上传阶段不再调用：

- `/api/management/vision-analysis/analyze`

也就是说：

- 上传只负责“文件进入会话”
- 不再因为用户刚选中图片就立即做整图拆解

### 2. 发送聊天阶段

当前主链路调整为：

- 用户点击发送时，前端把“本轮用户文字 + 本轮待发送图片”一起交给本地视觉服务
- 本地视觉服务优先生成和本轮文字相关的聚焦结果
- 成功后，再把“图片文件信息 + 聚焦后的本地视觉结果文本 + 用户输入”提交给 OpenFang

发送阶段的本地视觉接口现在支持接收：

- `imagePath`
- `userText`
- 文件元信息

换句话说：

- 有本地结果：走“带聚焦结果的文本上下文模式”
- 无本地结果：走“原图附件模式”

## OpenFang 运行时逻辑

当 OpenFang 收到的是“原图附件模式”时：

1. 优先通过 `image_analyze` / `media_describe` 处理本地/工作区图片
2. 这两个工具内部优先尝试本地 Florence-2 PromptGen v2.0 服务
3. 本地视觉不可用或失败时，才回退到模型视觉

当 OpenFang 收到的是“带聚焦结果的文本上下文模式”时：

- 直接把前端已经给出的本地视觉结果文本当作图片事实来源回答
- 不应该再次把同一张图当成视觉附件重新分析

补充一点：

- OpenFang 聊天 API 现在只接收“仍需视觉处理的原图附件”
- 已完成本地解析的图片，不再依赖 `attachments` 里夹带本地视觉文本的旧兼容写法
- 本地视觉结果只通过消息文本上下文进入本轮对话

## 为什么之前会乱

历史上同时存在多套混合路径：

- 旧链路里曾经存在“上传即解析”，和用户真正发送的文字脱节
- 聊天附件仍可能继续作为视觉附件发送
- OpenFang API 还兼容过“附件里直接夹带本地视觉文本”的旧路径
- `service-rs` / `openfang` / 桌面资源二进制之间还存在旧进程复用、旧二进制未同步的问题

这会导致模型看到的上下文不完整，或者运行的是旧逻辑，从而出现：

- 明明前端说“已解析”，LLM 还是不知道图片内容
- 没走本地视觉，直接胡编
- 复用了旧的 `openfang.exe`

## 当前简化后的规则

以后只按这条规则理解：

- 上传时不解析
- 发送时再拿“图片 + 用户文本”做本地视觉
- 解析成功：发“聚焦后的本地视觉结果 + 用户文本”，不再发原图附件给本轮视觉理解
- 解析失败：发“原图附件 + 用户文本”，由 OpenFang 调视觉工具

## 相关文件

- 前端隐藏上下文拼装：
  - `apps/frontend/src/components/chat/ChatConversationPane.tsx`
- 前端聊天发送负载裁剪：
  - `apps/frontend/src/services/agent-client.ts`
- 本地视觉统一客户端：
  - `apps/frontend/src/services/local-vision-service.ts`
  - `apps/frontend/src/services/vision-analysis-client.ts`
- 上传只落盘、不触发本地视觉：
  - `apps/frontend/src/services/management-client.ts`
- 发送时触发本地视觉：
  - `apps/frontend/src/components/chat/ChatConversationPane.tsx`
- 运行时视觉工具优先本地 Florence：
  - 当前默认模型：`laub/Florence-2-large-PromptGen-v2.0-onnx`
  - `vendor/openfang/crates/openfang-runtime/src/local_vision.rs`
  - `vendor/openfang/crates/openfang-runtime/src/media_understanding.rs`
  - `vendor/openfang/crates/openfang-runtime/src/tool_runner.rs`
- 原图附件注入会话：
  - `vendor/openfang/crates/openfang-api/src/routes.rs`

## 开发启动注意事项

桌面调试必须保证两件事：

1. `webot-frontend` 重新编译后再启动
2. `openfang.exe` 资源也必须同步最新编译产物，并避免复用旧的 4200 端口进程

为此，`scripts/start-dev.mjs` 的 `app` 模式现在会：

- 额外清理 4200 端口
- 先执行 `scripts/bootstrap-dev.ps1 -SkipNpmInstall`

同时 `bootstrap-dev.ps1` 已改为：

- 当 `vendor/openfang` 源码比现有 GNU release 二进制更新时，自动重新编译
- 编译后再同步到 `apps/frontend/src-tauri/resources/openfang`
