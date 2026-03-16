# OpenFang 精华吸收计划（2026-03-14）

目标：不整仓升级 `vendor/openfang`，只定向吸收上游高收益、低耦合、能直接提升稳定性的改动。

## 原则

1. 只迁移对 `webot-app + service-rs + vendor/openfang` 主链路有直接收益的改动。
2. 优先迁移运行时兼容和稳定性修复，暂不迁移 memory 主线、channels、官方 dashboard UI。
3. 每次迁移都要能单独回滚，并留下来源版本、落地文件、验证结果。

## 批次规划

### 批次 1：运行时兼容修复（当前执行）

- 目标：
  - 修复 OpenAI-compatible 驱动对 reasoning 模型、Kimi、Qwen/DeepSeek 本地推理模型的兼容问题。
  - 过滤流式 `<think>...</think>` 内容，避免思维链污染前端正文流。
- 迁移范围：
  - `vendor/openfang/crates/openfang-runtime/src/lib.rs`
  - `vendor/openfang/crates/openfang-runtime/src/think_filter.rs`
  - `vendor/openfang/crates/openfang-runtime/src/drivers/openai.rs`
- 验证：
  - `cargo check -p openfang-runtime`
  - 重点关注 reasoning_content、temperature、tool_call、streaming 行为是否回归。

### 批次 2：模型目录与 provider 兼容增强

- 目标：
  - 强化 provider alias、custom URL override、模型目录兼容。
  - 为后续引入更多国内/代理 provider 做准备。
- 候选范围：
  - `vendor/openfang/crates/openfang-runtime/src/model_catalog.rs`
  - `vendor/openfang/crates/openfang-types/src/model_catalog.rs`
  - `vendor/openfang/crates/openfang-types/src/config.rs`
- 风险：
  - 会影响 `/api/models`、`/api/providers`、默认模型选择和前端模型列表。

### 批次 3：工具名与反序列化容错

- 目标：
  - 降低旧 manifest、历史消息、模型幻觉工具名带来的失败率。
- 候选范围：
  - `vendor/openfang/crates/openfang-types/src/tool_compat.rs`
  - `vendor/openfang/crates/openfang-types/src/serde_compat.rs`
- 风险：
  - 低。

### 批次 4：新增 provider / driver（按需）

- 候选：
  - `qwen_code` 驱动
  - 其它新 provider catalog 项
- 启动条件：
  - 明确有业务要用，且不影响现有默认 provider 链路。

## 明确不纳入本轮

- `memory` 语义编排与 feedback API 替换
- `kernel/cron/scheduler` 大重构
- `channels` 批量改造
- 官方 dashboard auth / 静态前端

## 吸收流程

1. 先从上游版本提炼“概念补丁”，不要整文件盲拷。
2. 只改一批文件，做一次编译检查。
3. 在 `vendor/openfang/LOCAL_PATCHES.md` 记录：
   - 来源版本
   - 迁移原因
   - 落地文件
   - 验证命令
4. 下一次继续只扫描：
   - `runtime/drivers`
   - `runtime/model_catalog`
   - `types/*compat`
   - `provider` 相关文档和测试
