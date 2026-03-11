---
name: profile-card-skill
description: 使用 ProfileIntroCard 渲染结构化人物资料卡
location: skills/profile-card-skill
---

# Profile Card Skill

## 组件

- `ProfileIntroCard`

## 适用场景

- 人物资料卡
- 角色设定卡
- 简历/档案概览卡
- 带分组信息的资料展示

## 输出要求

1. 只允许两种输出：
   - 纯 Markdown
   - Markdown + 一个或多个 `<UI_JSON>...</UI_JSON>`
2. `ProfileIntroCard` 必须输出单个合法 JSON 对象。
3. 必须使用半角 JSON 标点：`:` `,` `{}` `[]` `"`。
4. 不要输出注释、YAML、XML、tool_call 包裹内容。
5. `sections` 中每项必须为 `{ "title": string, "items": [{ "label": string, "value": string }] }`。

## 推荐字段

- `name`
- `title`
- `subtitle`
- `summary`
- `avatar`
- `tags`
- `sections`

## 推荐模板

```xml
<UI_JSON>
{"type":"ProfileIntroCard","props":{"name":"示例人物","title":"示例身份","subtitle":"一句简短说明","avatar":"👤","tags":["标签A","标签B"],"sections":[{"title":"基本信息","items":[{"label":"出生地","value":"示例城市"},{"label":"职业","value":"示例职业"}]}]}}
</UI_JSON>
```

## 严禁输出

- 不要把整条消息包成外层 response JSON
- 不要把 `<UI_JSON>` 放进 Markdown 代码块
- 不要输出不闭合标签
- 不要使用全角标点 JSON
