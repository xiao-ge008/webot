# A2UI / JSON Render Streaming 输出规范

本规范用于约束 AI 在聊天中输出可被 `@json-render/react` 与 `compileSpecStream` 稳定消费的内容。

## 1. 推荐输出模式

优先级从高到低：

1. **纯 Markdown**
2. **Markdown + 完整 `<UI_JSON>` 块**
3. **真正流式 patch 输出**（仅当模型/后端明确支持时）

结论：

- 对大多数通用模型，不要默认让它直接输出 streaming patch
- 最稳方案是：先输出 Markdown，再输出一个完整、闭合的 `<UI_JSON>` JSON 对象

## 2. 为什么 AI 容易乱输出

常见失败原因：

- 在外层再包一层 `response` JSON
- 把 `<UI_JSON>` 放到 Markdown 代码块里
- 输出半截 JSON，后面继续解释文本
- 使用全角标点 `：` `，`
- `type` 与组件真实名不一致
- 流式过程中先输出对象，后续又改 key 结构，导致 patch 无法合并

## 3. 最稳的协议约束

应明确要求模型：

- 只允许两种响应格式：
  - 纯 Markdown
  - Markdown 后紧跟 `<UI_JSON>...</UI_JSON>`
- `<UI_JSON>` 内只能是单个 JSON 对象
- 不能输出数组、多个裸 JSON、注释、代码块包裹
- JSON 必须使用半角符号
- `type` 必须来自 manifest 或前端 registry

## 4. 面向模型的系统约束模板

可直接注入到系统提示词：

```text
你当前运行在 A2UI / json-render 渲染环境。

你只能使用以下两种回复格式之一：
1. 纯 Markdown
2. Markdown + 一个或多个 <UI_JSON>...</UI_JSON>

规则：
- <UI_JSON> 内必须是单个、合法、闭合的 JSON 对象
- JSON 必须使用半角标点和双引号
- 不要把整条回复包装成 response JSON
- 不要输出 ```json 代码块包裹 UI JSON
- type 必须精确匹配允许的组件名
- 如果不确定字段，宁可少填，也不要编造嵌套结构
- 如果使用 ProfileIntroCard，优先输出：name/title/subtitle/avatar/tags/sections
```

## 5. 关于 json-render streaming 的建议

参考 `https://json-render.dev/docs/streaming` 的思路，真正的 streaming patch 更适合：

- 后端可控
- 模型已被严格约束
- 你能保证 patch 行格式稳定

当前项目建议：

- **默认不要让 AI 直出 patch stream**
- 让后端或中间层把模型的自然语言结构结果转换成 patch
- 前端仅消费可靠 patch 或完整 spec

即：

- AI 负责“结构化字段”
- 中间层负责“转为 A2UI schema 或 streaming patch”

这是最稳的架构边界

## 6. 当前项目的最佳实践

### 方案 A：完整卡片输出

适合绝大多数资料卡、图文卡、表单卡。

```xml
<UI_JSON>
{"type":"ProfileIntroCard","props":{"name":"示例人物","title":"示例身份","tags":["标签A"],"sections":[{"title":"基本信息","items":[{"label":"字段","value":"值"}]}]}}
</UI_JSON>
```

### 方案 B：中间层转 schema

AI 输出：

```json
{
  "card_type": "profile",
  "name": "示例人物",
  "sections": [...]
}
```

服务端再转：

- `ProfileIntroCard` 完整 spec
- 或 json-render patch stream

### 方案 C：模板驱动

为每个 skill 提供固定模板：

- `ProfileIntroCard`
- `OptionSelector`
- `ChartCard`
- `MarkdownPreviewCard`

模型只填字段，不自由发挥结构。

## 7. 建议的工程改进

1. 在技能加载时读取 `components.manifest.json`
2. 对 AI 产出的 `type` 做白名单校验
3. 对 props 做 schema 级裁剪与默认值补全
4. 对非法 JSON 自动降级为普通 Markdown
5. 在聊天页显示“协议修复日志”，方便观察模型输出偏差

## 8. 结论

如果目标是“让 AI 稳定遵循格式输出，而不是胡乱输出 JSON 结构”，最有效的不是继续放宽前端解析，而是：

- **前端做容错**
- **skill 提供固定模板**
- **系统提示严格约束输出协议**
- **中间层负责把自然语言结构转成稳定 schema/patch**

前端负责兜底，不应该承担所有结构修复责任。
