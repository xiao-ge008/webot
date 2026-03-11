# weBot GenUI (Dynamic UI) 接入指南

本文档描述了 AI Agent 和后端系统如何接入前端的新时代动态渲染架构 (GenUI)。通过遵循以下约定，AI 能够不仅仅返回枯燥的文本，而是可以直接返回**原生的受控互动界面（卡片、图表、表单等）**给用户。

---

## 🏗️ 核心运作机制简述

1. **AI 响应阶段**: AI 根据用户的提示判断需要渲染特定的界面。它会在回复的 Markdown 内部，生成特定的 `render-ui-skill` 代码块。
2. **后端传输阶段**: 后端（如果是流式传输或全量传输）无需做特殊处理，直接将这段带有 Markdown 特定代码块的文本推流/返回给前端。
3. **前端拦截阶段**: 前端的 ReactMarkdown 组件在渲染 `code` 块时，一旦监测到语言标记为 `render-ui-skill`，将立即劫持该文本块，不再渲染原始代码，而是丢给内部强大的 `@json-render/react` 引擎进行组件转化。
4. **动态加载阶段**: 引擎会按需挂载我们在前端 `genui-registry` 注册表里设定好的 Shadcn 原生 UI，或者动态拉取 `skill://` 插件库代码进行实时注入。

---

## 🤖 AI 端接入方案 (Markdown Codeblock)

AI 只需要在生成的 Markdown 文本中输出一段具有语法高亮标记标记的专有 JSON 代码块即可。有两种合法的语法标记可以激活渲染树：

- ```render-ui-skill

- ```json

*(建议优先使用 `render-ui-skill` 以避免误伤纯粹的代码展示需求)*

### UI 规范格式：Flat Spec（推荐）

前端基于 `@json-render/react` 渲染，推荐使用“扁平树结构”(Flat Spec) ，它可以更好地支持组件引用和状态绑定，且避免了深层嵌套引起的解析错误。

它由一个 `root` 字段指明入口节点 ID，并提供一个 `elements` 对象字典描述所有的节点。

**AI 回复示例：**

```markdown
为您查询了当前的动态活动数据，请点击下方交互面板进行操作：

\`\`\`render-ui-skill
{
  "root": "entry-card",
  "elements": {
    "entry-card": {
      "type": "Card",
      "props": { "className": "w-full border-border shadow-sm mt-4" },
      "children": ["card-header", "card-content", "card-footer"]
    },
    "card-header": {
      "type": "CardHeader",
      "children": ["card-title", "card-desc"]
    },
    "card-title": {
      "type": "CardTitle",
      "props": { "children": "实时服务器状态" }
    },
    "card-desc": {
      "type": "CardDescription",
      "props": { "children": "亚太区服务器负载指标" }
    },
    "card-content": {
      "type": "CardContent",
      "children": ["box"]
    },
    "box": {
      "type": "div",
      "props": { "className": "p-4 bg-muted rounded-lg font-mono text-sm" },
      "children": ["status-text"]
    },
    "status-text": {
      "type": "span",
      "props": { "children": "CPU: 45% | RAM: 60%" }
    },
    "card-footer": {
      "type": "CardFooter",
      "props": { "className": "flex justify-end gap-2" },
      "children": ["btn-refresh"]
    },
    "btn-refresh": {
      "type": "Button",
      "props": { 
        "children": "刷新状态", 
        "size": "sm" 
      },
      "on": {
        "press": [
          {
            "action": "refresh-server-status",
            "params": { "region": "ap-southeast" }
          }
        ]
      }
    }
  }
}
\`\`\`
```

> **注意：** 任何声明在 `elements` 中的组件，**必须提供有效的 `type`**（目前支持如 `Card, Button, div, span, p, Badge, Input` 等基础及 Shadcn 组件，或者是任何不在表中的自定义技能名称），引擎会自动匹配并渲染。

---

## ⚡ 动态技能挂载 (Dynamic Skill Loading)

前端实现了 `skill://` 插件化架构。如果 AI 在 `type` 中指定了一个**前端注册表（registry）和原生 HTML 标签中不存在的名称**（例如 `test-chart` 或 `weather-widget`），前端在触发 `GenUIFallback` 拦截后，会自动尝试通过动态导入加载对应的外部/内置远程模块：

```json
"chart-container": {
  "type": "test-chart",
  "props": {
    "dataPoints": [10, 20, 30],
    "theme": "dark"
  }
}
```

前端会异步执行：`import('skill://test-chart/main.js')`。因此只要前端本地的 `skills` 目录下或者对应服务网关存在此技能，即可实现**极重型 UI 的轻量化投递**（AI 只需回传 `type` 和 `props` 数据负载即可，业务渲染逻辑交给前端下载的 JS 包）。

---

## 🖧 后端接入/对接触发动作 (Event Actioning)

当用户在动态渲染出的卡片上引发了动作（Action），也就是在按钮的配置里触发了：

```json
"on": {
  "press": [{ "action": "refresh-server-status", "params": { "region": "ap" } }]
}
```

前端 `DynamicUIRenderer` 的 `ActionProvider` 就会拦截到这个动作，接着它将统一将动作名称 (`actionId`) 和荷载 (`payload`) 向上传拨至 `ChatPage.tsx` 中的 `handleGenUIAction` 处理机。

### 后端如何处理发起的参数

当前端收到事件后，它会将操作包装后发往服务端（通常发起了一个特殊的隐藏对话事件或 API POST）。
在此模式下，后端 API 或 `Agent Server (MCP)` 应拦截具有 `action` 及特定 `payload` 的指令，执行业务逻辑后，通过常规 Chat 接口下发一条新文本说明或**下发一个新的 UI Schema 局部状态**。

---

## 🐞 常见注意与防坑指北

1. **必须包含闭合且合法的 JSON**: Markdown block 内除了 JSON 字符串，不能混杂多余解释文本。`JSON.parse()` 失败将会导致全备妥协并降级为纯文本代码块展示。
2. **区分大小写与合法结构**: 虽然前端已加上针对缺失 `props` 属性补 `{}` 的宽容度补丁，依然建议按照官方结构提供完整的 `"props": {}` 与 `"children": []`。
3. **安全拦截**: 前端拦截了敏感的原生小写标签渲染（`div`, `span`, `p`, `pre` 等不触发 `skill` 热加载），因此当你定义自定义新技能加载组件时可任意取名无需受限驼峰还是中划线风格。

通过这套协议，无论是简易调查问卷卡片，还是庞大的 3D 角色模型加载，都只需前端具备对应的解析模块即可无缝内联。
