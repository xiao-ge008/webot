# OpenFang Local Patches Backup

来源：`E:\weBot2\openfang\LOCAL_PATCHES.md`

## 2026-03-07

### Patch 001 - 支持 `<tool_call>...` 文本工具调用恢复（已完成）
- 文件：`crates/openfang-runtime/src/agent_loop.rs`
- 原因：当前运行中的 `nvidia-nim / z-ai/glm4.7` 会输出：
  - `<tool_call>web_search`
  - `query: 北京天气 2026年3月7日`
- 问题：官方 fresh 仓 `recover_text_tool_calls()` 原本不支持该格式，只支持 `<function=...>{...}</function>` 等格式。
- 修改：新增 Pattern 6，支持：
  - 第一行：`<tool_call>tool_name`
  - 后续多行：`key: value`
- 结果：该格式现在可被恢复为 synthetic `ToolCall`，并进入正常工具执行闭环。
- 新增/修改测试：
  - `cargo test -p openfang-runtime test_recover_tool_call_tag_key_value_format -- --nocapture`
  - `cargo test -p openfang-runtime test_text_tool_call_tag_recovery_streaming_e2e -- --nocapture`
- 结果：两条测试均通过。

