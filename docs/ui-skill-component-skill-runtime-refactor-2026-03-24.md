# UI Skill / 组件 Skill / Runtime 工程级重构方案（2026-03-24）

日期：2026-03-24  
状态：Draft v1  
适用范围：`webot-app` 桌面端、`apps/service-rs` 管理层、`vendor/openfang` 运行时、组件中心、渠道绑定输出链路  
当前优先级：高  

---

## 1. 文档目标

本文用于定义 `weBot-app` 下一阶段的工程级重构方案，解决当前 `UI skill`、`组件 skill`、`openfang` 底层工具、桌面端 A2UI 协议、渠道绑定输出之间职责混乱的问题，并为后续扩展以下能力打下统一基础：

1. 图片生成 / 图片修改
2. 视频生成 / 视频编辑
3. 音频生成 / 语音转写 / 媒体理解
4. 文档解析 / 文档摘要 / 文档转换 / 文档比较
5. 多渠道输出（桌面端、WhatsApp、Telegram、QQ、Email 等）
6. 长耗时任务、异步作业与派生资产工作流

本文不是单点修复方案，而是作为未来 2~4 个迭代周期可持续落地的统一架构设计。

---

## 2. 当前设计结论

### 2.1 总体结论

未来系统应明确拆成 4 层：

1. `OpenFang Tool Layer`
   模型优先面向统一语义工具，而不是直接面向组件或 A2UI。
2. `Capability Adapter Layer`
   组件 skill 作为底层工具的能力实现适配器，而不是最终输出协议。
3. `Presentable Result Layer`
   所有工具和组件执行后先返回中立结果对象，不直接输出桌面端 A2UI。
4. `Channel Renderer Layer`
   桌面端、WhatsApp、Telegram 等不同渠道各自把中立结果渲染成目标渠道协议。

### 2.2 核心原则

1. `openfang` 底层工具是稳定主协议层。
2. `UI skill` 只负责桌面端展示规则，不负责能力执行。
3. `组件 skill` 只负责能力接入和参数映射，不再兼任最终展示协议。
4. A2UI 只能存在于桌面端渲染层，不能作为系统通用输出协议。
5. 模型应优先调用统一语义工具，而不是直接构造 `ComponentInvokeAction` 或桌面端 JSON。
6. 图片、视频、音频、文档都必须统一走 `AssetRef + PresentableResult + Job` 三个基础抽象。

### 2.3 通用工具域与个人边界工具域

未来 `OpenFang Tool Layer` 内部必须明确拆成两类工具域，而不是把“公共能力”和“智能体自我能力”继续混写在同一套软提示词里。

#### 2.3.1 通用工具域

通用工具域的特点：

1. 面向一般对象，而不是默认面向“当前智能体自己”
2. 不自带身份锚点保护
3. 不自带“只能改自己”的权限边界
4. 适合作为全局技能、团队技能、公共能力暴露给模型

典型例子：

1. `image_generate`
2. `image_edit`
3. `media_describe`
4. `text_to_speech`
5. `speech_to_text`
6. `document_parse`
7. 公共文件工具
8. 公共记忆工具

#### 2.3.2 个人边界工具域

个人边界工具域的特点：

1. 目标对象固定为“当前智能体自己”
2. 由 runtime 强制注入身份边界，而不是依赖 prompt 约束
3. 允许访问自己的专属身份文件、专属记忆、专属照片体系
4. 默认带更严格的风险分级、确认门槛和审计要求

典型例子：

1. `my_photo_generate`
2. `my_photo_edit`
3. `my_memory_patch`
4. `my_identity_patch`
5. `my_upgrade_review`
6. `my_upgrade_apply`

#### 2.3.3 两类工具域的关系

这两类工具域不是两套完全独立的底层实现，而是：

1. **共享能力核心**
   - 例如 `image_generate` 和 `my_photo_generate` 底层都可能落到图片生成能力。
2. **边界与策略不同**
   - 通用工具处理一般对象。
   - 个人边界工具处理“自己”，并附带身份锚点、权限限制、确认策略。
3. **模型暴露名可以不同，但内部 capability 要统一**
   - 例如：
     - `image_generate` -> `generate.image` + `scope=generic`
     - `my_photo_generate` -> `generate.image` + `scope=self`
     - `image_edit` -> `edit.image` + `scope=generic`
     - `my_photo_edit` -> `edit.image` + `scope=self`
     - `my_memory_patch` -> `patch.memory` + `scope=self`
     - `my_identity_patch` -> `patch.identity` + `scope=self`

#### 2.3.4 工程约束

1. `UI skill` 不承载“个人边界”定义。
2. `组件 skill` 不直接拥有“个人身份权限”。
3. 个人边界只能在 runtime / capability router 层定义和强制执行。
4. 桌面端只负责把个人边界工具的结果渲染出来，不负责模拟权限边界。

---

## 3. 当前代码基线

### 3.1 OpenFang 已有底层工具清单

当前 `vendor/openfang/crates/openfang-runtime/src/tool_runner.rs` 中已内置大量工具，主要包括：

1. 文件与执行：
   - `file_list`
   - `file_read`
   - `file_write`
   - `shell_exec`
   - `apply_patch`
2. 协作与调度：
   - `agent_find`
   - `agent_send`
   - `agent_spawn`
   - `cron_create`
   - `cron_list`
   - `cron_cancel`
   - `channel_send`
3. 媒体与感知：
   - `image_analyze`
   - `media_describe`
   - `media_transcribe`
   - `text_to_speech`
   - `speech_to_text`
4. 图片能力：
   - `image_generate`
   - `image_edit`
   - `my_photo_generate`
   - `my_photo_edit`
5. 视频能力：
   - `video_generate`
   - `video_edit`
5. 浏览器与任务：
   - `browser_*`
   - `process_*`
   - `task_*`
6. 记忆与知识：
   - `memory_recall`
   - `memory_store`
   - `knowledge_*`

当前基线更新为：

1. runtime 已拥有统一 `video_generate` / `video_edit` 工具入口
2. `media_describe` 已开始承担图片 / 音频 / 视频理解入口
3. 文档类统一工具与 OCR selector 仍处于设计与迁移期
4. 当前真正缺失的不是“是否有工具名”，而是“多 provider 时的稳定选择层”

### 3.2 项目中已经实际形成产品链路的底层工具

当前已经明显接入前端与产品流的底层能力主要有：

1. `image_generate`
2. `image_edit`
3. `text_to_speech`
4. `speech_to_text`
5. `media_describe`
6. `agent_send`
7. `cron_*`
8. `file_read / file_list / file_write / shell_exec`

其中最成熟的是图片链路：

1. `openfang` 统一工具已存在
2. runtime 已支持“skill/provider -> 通用服务 -> 模型兜底”分层回退
3. 前端已能根据工具日志把图片结果转成桌面卡片

### 3.3 当前存在的结构性问题

当前体系存在以下核心问题：

1. 模型被注入过多桌面端 A2UI 细节，能力调用与展示协议耦合。
2. `UI skill`、`组件 skill`、统一工具、桌面组件协议职责重叠。
3. 组件直调链路在桌面端能工作，但在渠道绑定场景容易失真。
4. 图片、视频、语音、文档没有统一的资源引用模型。
5. 不同工具返回结果格式不统一，前端通过大量特判解析。
6. 视频、文档、多媒体链路缺少统一的长耗时任务模型。
7. 扩展新能力时，当前做法高度依赖 prompt 规则和前端特判，扩展成本高。

---

## 4. 当前痛点与漏洞分析

### 4.1 模型直接面向 A2UI 导致的系统性问题

当前如果模型直接输出桌面端 A2UI JSON，会带来以下问题：

1. 渠道端无法理解桌面端专属组件协议。
2. 同一条回复同时承担“能力执行”和“最终渲染”两种职责，边界混乱。
3. 模型会把大量精力花在猜组件名、字段名、JSON 结构，而不是稳定调用能力。
4. 组件一旦重命名或参数调整，所有提示词与适配逻辑都会一起抖动。

### 4.2 资源引用模型缺失

当前系统里同时存在：

1. 工作区相对路径
2. 本地绝对路径
3. `/api/uploads/...`
4. `/api/management/agents/...`
5. `http/https`
6. `data:image/...`
7. base64 裸数据

但没有统一的资源抽象，导致：

1. 工具层、组件层、渲染层都在重复做路径解析。
2. 图片问题刚修完，视频、文档、音频未来还会重复踩坑。
3. 资产来源不透明，不利于缓存、权限、渠道转发、派生文件管理。

### 4.3 返回结果模型缺失

当前不同能力返回格式差异较大：

1. 图片工具返回图片 URL 列表
2. TTS 返回音频地址和时长
3. 组件调用返回 `ComponentInvokeResult`
4. 部分能力只回纯文本

前端只能按工具名特判。

这会直接导致：

1. 新增能力时需要继续写专属 fallback 解析。
2. 同一类结果无法统一映射到桌面端和渠道端。
3. 结果协议难以测试、难以稳定演进。

### 4.4 长耗时作业模型缺失

未来以下能力大概率都不是短平快同步请求：

1. 视频生成
2. 视频转音频
3. OCR 与多页文档解析
4. 长音频转写
5. 文档转换
6. 批量媒体处理

目前缺少统一的 `Job` 抽象，会导致每个能力自行发明轮询、进度、取消、失败回调协议。

### 4.5 Prompt 规则膨胀风险

当前 `agent-client.ts` 已承担了大量运行时路由逻辑：

1. 图片路由
2. 自管理行为
3. 组件直调规则
4. 组件参数拼接规则
5. 桌面组件优先级

该模式短期可用，但长期风险很高：

1. 规则难验证
2. 新能力增加后 prompt 继续膨胀
3. 过度依赖模型记忆规则而非结构化元数据
4. 模型升级后行为波动更大

---

## 5. 目标架构

### 5.1 分层架构

```mermaid
flowchart TD
    A["用户意图 / 模型规划"] --> B["OpenFang Tool Layer"]
    B --> C["Capability Router"]
C --> D["Component Skill Adapter"]
C --> L["Provider Selector"]
C --> E["Generic Provider Adapter"]
C --> F["Model Fallback Adapter"]
D --> G["PresentableResult / AssetRef / Job"]
L --> D
L --> E
L --> F
E --> G
F --> G
G --> H["Desktop Renderer"]
    G --> I["WhatsApp Renderer"]
    G --> J["Telegram Renderer"]
    G --> K["Plain Text Renderer"]
```

### 5.2 各层职责

#### 5.2.1 OpenFang Tool Layer

职责：

1. 作为模型唯一稳定主协议层
2. 提供统一语义工具
3. 屏蔽底层 provider / 组件 / 模型差异
4. 对“通用对象”和“当前智能体自己”建立不同的工具边界

对模型暴露时，应明确包含两类工具：

1. **通用工具**
   - 例如 `image_generate` / `image_edit` / `document_parse`
2. **个人边界工具**
   - 例如 `my_photo_generate` / `my_photo_edit` / `my_memory_patch` / `my_identity_patch`

模型未来优先面向以下统一能力：

1. `generate.image`
2. `edit.image`
3. `generate.video`
4. `edit.video`
5. `generate.audio`
6. `transcribe.audio`
7. `analyze.media`
8. `parse.document`
9. `extract.document`
10. `summarize.document`
11. `convert.document`
12. `present.choice`
13. `confirm.action`
14. `patch.memory`
15. `patch.identity`
16. `review.upgrade`
17. `apply.upgrade`

#### 5.2.2 Capability Adapter Layer

职责：

1. 接管统一工具的实际执行
2. 将工具语义映射到组件 skill / provider / 模型 fallback
3. 处理参数映射、源素材要求、输入归一化、输出归一化

这里的组件 skill 不再是最终输出协议，而是工具实现插件。

#### 5.2.2.1 Provider Selector

当同一个 capability 下只绑定了 1 个 provider 时，router 可直接命中，不增加额外复杂度。  
当同一个 capability 下存在多个 provider，且它们并非简单主备关系，而是“人物 / 场景 / 通用”“PDF / OCR / Office”等不同专长时，必须增加一个轻量 `Selector`。

`Selector` 的职责不是重新引入一层模型，而是：

1. 根据 capability、输入源、意图标签、provider 元数据做规则选择
2. 在 provider 可选项较多时，替代“只靠 priority 排序”的粗粒度路由
3. 对缺失强制输入的 provider 做过滤或返回缺参结果
4. 输出结构化选择结果和审计信息

默认设计原则：

1. 单 provider 不启用 selector
2. 多 provider 时优先走规则 selector
3. 不默认引入模型参与决策
4. 只有未来 provider 数量显著增加且规则无法稳定区分时，才允许增加“模型辅助判别”，且模型只输出建议，不直接决定执行

因此主链路变成：

1. 模型先命中统一能力或基础工具
2. capability router 拉取可用 provider
3. selector 在多 provider 情况下做一次轻量选择
4. 再执行 `component skill / generic provider / model fallback`

#### 5.2.3 Presentable Result Layer

职责：

1. 统一承接所有能力输出
2. 对上游 provider / 组件差异做归一化
3. 为桌面端和渠道端提供统一渲染输入

这是整个重构中最关键的一层。

#### 5.2.4 Channel Renderer Layer

职责：

1. 桌面端转 A2UI
2. WhatsApp 转文本 + 媒体 + 按钮
3. Telegram 转文本 + Inline Keyboard
4. 纯文本环境降级

该层不能反向影响能力调用。

---

## 6. 统一基础抽象

### 6.1 Capability

能力必须从“工具名散点”升级为“稳定能力键”。

建议定义如下命名规范：

1. `generate.image`
2. `edit.image`
3. `generate.video`
4. `edit.video`
5. `generate.audio`
6. `transcribe.audio`
7. `analyze.media`
8. `parse.document`
9. `extract.document`
10. `summarize.document`
11. `convert.document`
12. `compare.document`
13. `confirm.action`
14. `present.choice`
15. `patch.memory`
16. `patch.identity`
17. `review.upgrade`
18. `apply.upgrade`

统一工具只是能力对模型暴露时的名字，内部路由使用 capability key。

同时必须补一个与 capability 正交的边界维度：

1. `scope=generic`
2. `scope=self`

也就是说，系统内部判断能力时，不能只看 `generate.image`，还要看它是：

1. 一般对象生成
2. 当前智能体自己的生成

这样才能避免以后继续为“自己”这一类需求写大量 prompt 特判。

### 6.2 AssetRef

所有媒体与文档资源必须统一使用 `AssetRef` 描述，禁止各层直接传裸字符串。

建议结构如下：

```json
{
  "id": "asset_123",
  "kind": "workspace_file",
  "agent_id": "luna",
  "path": "agent_profile/portrait/portrait-001.png",
  "mime_type": "image/png",
  "display_name": "portrait-001.png",
  "origin": "agent_workspace"
}
```

支持的 `kind` 建议至少包括：

1. `workspace_file`
2. `absolute_file`
3. `upload_url`
4. `management_media_url`
5. `remote_url`
6. `data_url`
7. `base64_blob`
8. `derived_asset`

### 6.3 PresentableResult

所有工具和组件输出都必须先归一化成 `PresentableResult`。

建议结构族如下：

1. `TextResult`
2. `MediaResult`
3. `DocumentResult`
4. `ChoiceResult`
5. `ConfirmResult`
6. `TaskResult`
7. `ErrorResult`

示例：

```json
{
  "kind": "media_result",
  "media_type": "video",
  "text": "已生成 1 个视频",
  "items": [
    {
      "asset": {
        "kind": "upload_url",
        "url": "/api/uploads/abc.mp4",
        "mime_type": "video/mp4"
      },
      "poster_asset": {
        "kind": "upload_url",
        "url": "/api/uploads/poster.jpg",
        "mime_type": "image/jpeg"
      }
    }
  ],
  "meta": {
    "tool": "video_generate",
    "provider": "component_skill",
    "component_name": "image2video"
  }
}
```

### 6.4 Job

视频、文档、长音频、多媒体链路统一采用 `Job` 模型。

建议结构如下：

```json
{
  "job_id": "job_001",
  "capability": "generate.video",
  "status": "queued",
  "progress": 0,
  "message": "任务已排队",
  "result": null
}
```

状态建议统一为：

1. `queued`
2. `running`
3. `done`
4. `failed`
5. `cancelled`

---

## 7. UI Skill 设计

### 7.1 UI Skill 的最终定位

`UI skill` 只负责桌面端视觉呈现策略，不负责能力执行。

它要解决的是：

1. 同一类 `PresentableResult` 在桌面端如何映射到 A2UI
2. 图片显示用什么卡片
3. 视频显示用什么卡片
4. 选项与确认如何显示
5. 文档预览如何显示

### 7.2 UI Skill 禁止承担的职责

1. 不直接决定调用哪个组件 skill
2. 不直接决定调用哪个 provider
3. 不直接要求模型输出最终组件 JSON 作为主协议
4. 不包含渠道端输出规则

### 7.3 UI Skill 推荐输出规则

桌面端建议建立以下映射：

1. `MediaResult(image)` -> `ImageCover` / `ImageCarousel`
2. `MediaResult(video)` -> `VideoCover` / `VideoGallery`
3. `MediaResult(audio)` -> `AudioPlayer` / `AudioPlaylist`
4. `DocumentResult(pdf/docx/xlsx/pptx)` -> `OfficePreviewCard`
5. `TextResult(markdown)` -> `MarkdownPreviewCard`
6. `ChoiceResult` -> `OptionSelector`
7. `ConfirmResult` -> 通用确认卡
8. 长耗时 `Job` -> 任务进度卡

---

## 8. 组件 Skill 设计

### 8.1 组件 Skill 的最终定位

组件 skill 是能力实现适配器，不是最终协议。

每个组件 skill 应声明：

1. 它接管哪些 capability
2. 它默认绑定哪个基础工具
2. 它需要哪些真实源素材
3. 哪些参数是描述型参数
4. 输出属于哪种 `PresentableResult`
5. 桌面端是否有专属渲染组件

这里要特别强调：

1. `returnType` 只负责结果渲染分类，不足以承担执行语义
2. 组件必须额外声明 `capability binding`
3. 默认情况下，组件应先绑定到内置基础工具，再作为该工具下的 provider
4. 后续 AI 不应直接先挑组件，而应先命中基础工具 / capability，再由 router 与 selector 选择组件 provider

### 8.2 组件 Skill Manifest 建议

建议新增统一 manifest 字段：

```json
{
  "skill_type": "component_adapter",
  "return_type": "video",
  "capabilities": ["generate.video"],
  "capability_binding": {
    "capability_key": "generate.video",
    "base_tool": "video_generate",
    "tool_mode": "generate",
    "source_policy": "requires_image",
    "fallback_policy": "allow_generic_provider",
    "enabled": true,
    "priority": 100
  },
  "selector_meta": {
    "specialization": "character",
    "intent_tags": ["dance", "idol", "human-motion"],
    "subject_policy": "person_first",
    "supports_text_only": true,
    "requires_slots": ["prompt"],
    "optional_slots": ["image"]
  },
  "input_contract": {
    "required_params": ["image", "prompt"],
    "strict_source_params": ["image"],
    "descriptive_params": ["prompt"]
  },
  "output_contract": {
    "result_kind": "media_result",
    "media_type": "video"
  },
  "desktop_render": {
    "preferred_card": "ComfyUIVideoCard"
  }
}
```

这里还要进一步明确一个工程约束：

1. 组件 skill 不能只停留在 prompt-only 说明层
2. 当组件声明了 `capabilityBinding.base_tool` 且该基础工具不是 `component_invoke` 时，组件中心必须生成“可执行 tool adapter”
3. 这个 adapter 的职责是：
   - 接收 runtime 传入的基础工具输入
   - 调用组件中心的 capability invoke 接口
   - 返回标准 `presentable_result + provider_meta`
4. 也就是说，组件 provider 的标准落地形态应是：
   - `component-center.definition.json`
   - `components.manifest.json`
   - `skill.toml`
   - `tool-adapter entry`
   - `capability-invoke API`

否则“组件默认绑定基础工具”就只是静态配置，而不是可执行的底层 provider。

### 8.2.1 组件能力绑定的默认映射

为了降低组件作者配置成本，组件中心在只填写 `returnType` 时，应自动生成默认 `capability_binding`。

建议默认映射：

1. `returnType=image`
   - `capability_key=generate.image`
   - `base_tool=image_generate`
   - `tool_mode=generate`
2. `returnType=video`
   - `capability_key=generate.video`
   - `base_tool=video_generate`
   - `tool_mode=generate`
3. `returnType=audio`
   - `capability_key=generate.audio`
   - `base_tool=text_to_speech`
   - `tool_mode=generate`
4. `returnType=text`
   - `capability_key=generate.text`
   - `base_tool=component_invoke` 或组件自定义文本执行入口
   - `tool_mode=generate`

也就是说，未来“组件能力类型”不应停留在“图片 / 视频 / 语音 / 文本”这一级，而应升级为：

1. `returnType`
2. `capabilityBinding`
3. `selectorMeta`

其中：

1. `returnType` 决定如何渲染
2. `capabilityBinding` 决定它挂到哪个基础工具 / capability 下
3. `selectorMeta` 决定在多 provider 竞争时它如何被选中

### 8.3 组件 Skill 分类

建议把组件 skill 分为两类：

1. `tool_adapter`
   供统一工具层调用
2. `desktop_widget`
   仅供桌面端显示和手动交互

两者可在同一个 skill 中共存，但必须明确分区。

进一步建议再细化一层 provider specialization 元数据，而不是只靠 `returnType`：

1. `character`
2. `scene`
3. `general`
4. `portrait`
5. `ocr`
6. `pdf`
7. `office`

例如：

1. 人物跳舞视频组件
   - `returnType=video`
   - `capability_key=generate.video`
   - `base_tool=video_generate`
   - `specialization=character`
2. 场景运镜视频组件
   - `returnType=video`
   - `capability_key=generate.video`
   - `base_tool=video_generate`
   - `specialization=scene`
3. 通用 text2video 组件
   - `returnType=video`
   - `capability_key=generate.video`
   - `base_tool=video_generate`
   - `specialization=general`

### 8.4 组件 Skill 直调规则

未来只允许以下两种场景直调组件：

1. 用户明确指定某个组件
2. 当前是桌面端且用户需要直接打开组件交互卡片

除此之外，统一工具优先。

这里要进一步明确：

1. AI 的默认路径不是“先挑组件，再读组件说明”
2. AI 的默认路径应是“先命中基础工具 / capability，再由 router 选择 provider”
3. 组件 manifest / skill 说明主要用于：
   - 声明自己能接哪些 capability
   - 声明自己绑定哪个基础工具
   - 声明自己擅长的 specialization / intent tags / source policy
4. 组件 skill 说明不再承担主路由逻辑本身

---

## 9. 渠道渲染设计

### 9.1 渠道无关交互模型

所有交互必须先语义化，再桌面化 / 渠道化。

例如：

1. `ChoiceResult`
2. `ConfirmResult`
3. `TaskResult`

渠道侧不能直接消费桌面组件协议。

### 9.2 Desktop Renderer

输入：`PresentableResult`  
输出：A2UI / 内部 UI Spec

### 9.3 WhatsApp Renderer

输入：`PresentableResult`  
输出建议：

1. 文本
2. 图片 / 视频 / 音频附件
3. 轻量按钮或“回复数字”交互
4. 文档链接与摘要

### 9.4 Telegram Renderer

输入：`PresentableResult`  
输出建议：

1. 文本
2. 媒体
3. Inline Keyboard
4. 文件附件

### 9.5 Plain Text Renderer

作为最终兜底：

1. 仅输出文本摘要
2. 附资源 URL
3. 交互降级成编号选项或确认文字

---

## 10. 新增能力扩展规划

### 10.1 视频能力族

建议新增统一工具：

1. `video_generate`
2. `video_edit`
3. `media_thumbnail`
4. `media_extract_audio`
5. `media_extract_frames`
6. `media_subtitle_generate`
7. `media_subtitle_burn`
8. `media_trim`

`video_generate` 推荐路由：

1. `generate.video` capability router
2. 优先命中 `image2video` / `text2video` 组件 skill
3. 再走通用视频 provider
4. 最后模型能力兜底

### 10.2 文档能力族

建议新增统一工具：

1. `document_parse`
2. `document_extract`
3. `document_summarize`
4. `document_convert`
5. `document_compare`
6. `document_chunk`
7. `document_preview`

### 10.3 媒体工作流能力族

建议新增统一工具：

1. `media_convert`
2. `media_merge`
3. `media_split`
4. `media_package`

这些能力未来都应回到：

1. 统一工具
2. 统一输入 `AssetRef`
3. 统一输出 `PresentableResult`
4. 长耗时任务统一走 `Job`

---

## 11. 关键注册中心设计

### 11.1 Capability Registry

目标：解耦“工具名 -> 组件名 -> provider 名”的硬编码关系。

建议每个 capability 注册多个 provider：

```json
{
  "capability": "generate.video",
  "base_tool": "video_generate",
  "providers": [
    {
      "type": "component_skill",
      "name": "image2video",
      "priority": 100,
      "requirements": ["image"],
      "specialization": "character",
      "intent_tags": ["human-motion", "dance"],
      "supports_text_only": false
    },
    {
      "type": "component_skill",
      "name": "text2video",
      "priority": 90,
      "requirements": ["prompt"],
      "specialization": "general",
      "intent_tags": ["general"],
      "supports_text_only": true
    },
    {
      "type": "generic_provider",
      "name": "video_service",
      "priority": 30,
      "specialization": "general"
    },
    {
      "type": "model_fallback",
      "name": "native_video_model",
      "priority": 10
    }
  ]
}
```

这里要明确两件事：

1. provider 注册不再只是“谁优先级更高”
2. provider 必须附带 selector 所需元数据

否则同属 `generate.video` 的多个 provider 只能靠固定 priority 排序，无法回答“当前请求更适合人物视频组件还是场景视频组件”。

### 11.1.1 Capability Selector

当一个 capability 下只存在 1 个有效 provider 时，可直接执行。  
当一个 capability 下存在多个 provider 时，必须增加一个轻量 `Selector`。

建议 selector 输入：

```json
{
  "capability_key": "generate.video",
  "base_tool": "video_generate",
  "raw_prompt": "我要一个跳舞视频",
  "subject_type": "person",
  "intent_tags": ["dance"],
  "has_image_input": false,
  "has_video_input": false
}
```

建议 selector 输出：

```json
{
  "selected_provider_id": "component_skill:character_dance_video",
  "candidate_provider_ids": [
    "component_skill:character_dance_video",
    "component_skill:general_text2video"
  ],
  "decision_reason": "命中人物动作与 dance 标签",
  "requires_user_input": false
}
```

selector 默认规则：

1. 先过滤：
   - 未启用 provider
   - health 不可用 provider
   - source policy 不满足 provider
   - agent binding 不允许 provider
2. 再打分：
   - `specialization`
   - `intent_tags`
   - `subject_policy`
   - `supports_text_only`
   - `priority`
3. 若最高分 provider 缺强制输入：
   - 返回缺参
   - 或降级到通用 provider
4. 若 provider 只有 1 个：
   - 跳过 selector

默认不引入模型参与 selector。  
只有未来 provider 数量明显增加且规则难以稳定判别时，才允许增加“模型辅助判别”，并且模型只输出建议，不直接执行。

这里还必须补一个执行期回退语义：

1. selector 不应只输出“唯一命中 provider”
2. selector 应输出“按优先级排序后的 candidate list”
3. runtime 先执行首选 provider
4. 如果首选 provider 执行失败：
   - 记录失败原因
   - 尝试下一个 candidate
5. 所有 candidate 都失败后：
   - 再回退全局 provider / model fallback
   - 或返回 unavailable / error_result

也就是说，selector 负责“排候选顺序”，runtime 负责“逐个执行与失败回退”，两者不能混成一个黑盒。

建议默认优先级矩阵如下：

1. 组件 skill provider
   - 首选
   - 执行失败时继续尝试同 capability 下的下一候选
2. 全局 generic provider / runtime provider
   - 第二层
   - 执行失败时可继续下探
3. 模型原生能力 fallback
   - 最后兜底
   - 失败后返回结构化 unavailable / error_result

### 11.2 Renderer Registry

目标：解耦“工具名特判 -> 桌面卡片名”的硬编码关系。

建议按结果类型注册：

1. `media_result(image)` -> 桌面/渠道渲染器
2. `media_result(video)` -> 桌面/渠道渲染器
3. `document_result(pdf)` -> 桌面/渠道渲染器
4. `choice_result` -> 桌面/渠道渲染器
5. `confirm_result` -> 桌面/渠道渲染器

### 11.3 Source Resolver

目标：统一解析资源来源。

职责：

1. 识别 `AssetRef`
2. 解析工作区路径
3. 下载远程资源
4. 识别 MIME
5. 上传到 ComfyUI / provider
6. 处理缓存与权限

这是未来所有媒体与文档能力的底层基础设施。

---

## 12. 模块级改造建议

### 12.1 `vendor/openfang`

建议新增或升级：

1. 新增 capability router
2. 在 capability router 内增加轻量 `Provider Selector`
3. 新增 `video_generate` / `video_edit`
4. 新增 `document_*` 工具族
5. 引入 `AssetRef` 与 `PresentableResult`
6. 引入 `Job` 与异步任务统一返回
7. 底层工具描述改成“能力语义优先”，减少组件名暴露
8. 将当前底层路由顺序正式固化为：
   - 组件 skill provider 优先
   - 全局 generic provider / runtime provider 次之
   - 模型原生能力最后兜底
9. `tool_runner` 只面向 capability / base tool 执行，不再直接承担“手写组件挑选逻辑”

特别强调：

1. selector 只在多 provider 时启用
2. selector 默认走规则，不默认引入模型参与
3. `tool_runner` 应优先消费 registry / binding / selector 结果，而不是继续在 prompt 里硬塞“优先用哪个组件”
4. 单 provider 场景直接命中，不增加额外选择开销
5. 多 provider 场景先按 binding 和 source policy 过滤，再由 selector 打分排序
6. selector 的职责是“在同一 capability 下选 provider”，不是替代 capability router 本身

建议在 `vendor/openfang` 内部继续拆出一个轻量选择层：

1. `Capability Router`
   - 决定命中 `generate.video`、`generate.image`、`generate.audio`、`analyze.media` 还是 `parse.document`
2. `Provider Selector`
   - 只在某 capability 下存在多个 provider 时启用
   - 输入为 `request + provider candidates + binding meta + selector meta`
   - 输出为最终 provider、缺参原因或 unavailable 结果
3. `Provider Executor`
   - 真正执行组件 skill、全局 provider 或模型 fallback

这样视频生成场景里就能稳定支持：

1. `character` 人物类组件
2. `scene` 场景类组件
3. `general` 通用类组件

而不是继续靠 prompt 或固定 priority 粗暴决定。

### 12.2 `apps/service-rs`

建议新增或升级：

1. `Capability Registry`
2. `Renderer Registry`
3. `Source Resolver`
4. `Capability Selector` 的配置与审计存储
5. 组件中心从“定义存储”升级为“组件能力注册中心”
6. 组件 schema 从 `returnType-only` 升级为：
   - `returnType`
   - `capabilityBinding`
   - `selectorMeta`
7. 统一 `PresentableResult` 与 `Job` API
8. 渠道端渲染器适配

其中组件中心建议默认行为：

1. 只填 `returnType` 时自动生成默认 `capabilityBinding`
2. 默认绑定到内置基础工具
3. 当组件需要更精细的语义路由时，再补 `selectorMeta`

同时建议把服务层配置和审计对象补全为：

1. `capability_providers`
   - provider 的基础注册信息
2. `capability_provider_bindings`
   - provider 到 capability / base tool 的绑定关系
3. `agent_capability_bindings`
   - agent 级启用、禁用、屏蔽关系
4. `renderer_bindings`
   - `PresentableResult.kind -> channel renderer` 的绑定关系
5. `provider_health_state`
   - provider 的健康检查、失败次数、熔断状态
6. `capability_audit_logs`
   - 注册、解绑、禁用、回退、selector 选择结果审计

组件中心 schema 也建议从“描述组件能返回什么”升级为“描述组件如何接入能力路由”，至少包含：

1. `returnType`
2. `capabilityBinding`
3. `selectorMeta`
4. `inputContract`
5. `outputContract`

其中 `selectorMeta` 建议允许声明：

1. `specialization`
2. `intentTags`
3. `subjectPolicy`
4. `supportsTextOnly`
5. `requiresSlots`
6. `preferredMimeTypes`

这样未来增加 OCR、PDF 解析、Office 转换等能力时，不需要重写前端提示词，只需继续注册 provider 并补 selector 元数据即可。

此外还应明确组件中心的生命周期同步语义：

1. 组件创建
   - 写入 definition / manifest / skill adapter artifacts
   - 注册或刷新 capability provider
   - 追加 audit log
2. 组件修改
   - 重新生成 artifacts
   - 刷新 provider 元数据与 selector 元数据
   - 触发 runtime cache invalidate
3. 组件重命名
   - 同步 skill 名称、目录名、provider id
   - 清理旧路径与旧缓存
4. 组件删除
   - 删除 artifacts
   - 让 provider 从 registry 中不可见
   - 记录 remove/unbind audit
5. 组件禁用
   - 不删除定义
   - 但 selector 与 registry 不再命中

建议把组件中心定义为：

1. UI 配置入口
2. 组件 artifacts 生成器
3. capability provider 的事实来源之一

这样组件定义、skill artifact、runtime 可见 provider 才不会发生漂移。

同时建议补一个最小接口合同：

1. `GET /api/management/components/:name`
   - 返回组件定义、`capabilityBinding`、`selectorMeta`
2. `POST /api/management/components/:name/invoke`
   - 手工组件调用入口
3. `POST /api/management/components/:name/capability-invoke`
   - 供 runtime tool adapter 调用的能力入口
   - 输入：`toolName + input + agentId`
   - 输出：标准 `presentable_result + provider_meta`

### 12.3 `apps/frontend`

建议新增或升级：

1. 将基于工具名的 fallback 渲染逐步改为基于 `PresentableResult.kind`
2. 保留 A2UI，但只作为桌面 renderer 输出协议
3. 将 `ComponentInvokeAction` 降级为桌面专用能力
4. 增加桌面端结果卡片适配器，而不是模型直接写卡片
5. 聊天层增加 `Job` 进度渲染
6. 前端只消费能力执行结果，不再承担 provider 选择职责
7. 旧 prompt 中关于“优先某组件”“命中某 UI action”的硬编码逐步删除

还应把一个反向约束写死：

1. 前端页面逻辑不得直接决定 `image2video / text2video / OCR / TTS provider` 的选型
2. 前端可以展示 provider 信息
3. 前端可以展示 capability binding
4. 但 provider 选择权必须留在 runtime / registry / selector

否则迁移到 WhatsApp / Telegram 之类渠道时，又会把路由逻辑重新拖回 PC 端。

---

## 13. 迁移路线

### Phase 1：收敛基础抽象

目标：

1. 定义 `Capability`
2. 定义 `AssetRef`
3. 定义 `PresentableResult`
4. 定义 `Job`

产出：

1. TS 类型
2. Rust 类型
3. API schema
4. 基础测试

### Phase 2：先改图片链路

目标：

1. 保留 `image_generate / image_edit`
2. 将其输出升级到 `PresentableResult`
3. 前端桌面端改为基于结果类型渲染

意义：

图片链路最成熟，适合作为整套重构试点。

### Phase 3：新增视频统一工具

目标：

1. 新增 `video_generate`
2. 接入 `Capability Registry`
3. 让 `image2video` / `text2video` 组件 skill 成为底层 provider
4. 输出统一 `MediaResult(video)`
5. 为 `generate.video` 增加第一个轻量 `Provider Selector`
6. 验证 `character / scene / general` 三类 provider 的选择正确性

完成标准：

1. 单视频 provider 时不启用 selector，直接命中
2. 多视频 provider 时 selector 能根据 `source_policy + specialization + intent_tags` 选中正确组件
3. 当组件 skill 不命中时，自动回退全局视频 provider
4. 当全局 provider 不可用时，最后才进入模型视频能力兜底
5. 无任何 provider 时返回结构化 unavailable，而不是前端提示词兜底

### Phase 4：组件中心升级为 provider-ready schema

目标：

1. 组件定义从 `returnType-only` 升级为：
   - `returnType`
   - `capabilityBinding`
   - `selectorMeta`
2. 保存组件时自动生成可执行 tool adapter
3. 新增 `capability-invoke` 接口供 runtime 调用
4. 组件 CRUD 与 capability provider 生命周期自动同步

完成标准：

1. 组件不再只是桌面直调入口
2. 组件可以作为底层 provider 被 runtime 直接命中
3. 修改组件绑定后，runtime 不需要依赖前端 prompt 刷新才能生效
4. 删除或禁用组件后，registry 中不再错误命中旧 provider

### Phase 5：语音与视觉能力族收口

目标：

1. `text_to_speech`
2. `speech_to_text`
3. `image_analyze`
4. `media_describe`
5. 统一进入 capability router / selector / fallback 体系

完成标准：

1. 语音组件 skill 优先于全局 TTS/STT provider
2. 全局 provider 优先于模型 audio / vision fallback
3. 图片、音频、视频理解统一进入 `PresentableResult`
4. 视觉与语音链路不再主要依赖前端提示词硬注入

### Phase 6：渠道渲染层落地

目标：

1. 桌面 renderer 与 WhatsApp renderer 拆分
2. 桌面继续输出 A2UI
3. 渠道端只消费中立结果

### Phase 7：文档能力族上线

目标：

1. `document_parse`
2. `document_extract`
3. `document_summarize`
4. `document_convert`
5. `parse.document` 作为第二个 selector 试点能力
6. 文档 provider 按 MIME / 扩展名 / source policy 正确选择

完成标准：

1. PDF、Office、纯文本文档能够进入统一 capability router
2. `pdf_reader / office_preview_adapter / ocr_service` 能在同一能力下并存
3. selector 能按 `preferredMimeTypes + specialization + source availability` 选择 provider
4. 当解析类 provider 被解绑后，系统能自动回退到同能力下的其他 provider
5. 无 provider 时返回 `error_result(document_unavailable)`，而不是前端私有组件硬接管

### Phase 8：媒体工作流与长任务统一

目标：

1. `media_*` 工作流工具族
2. 统一异步 job 管理
3. 派生资产关系与缓存

---

## 14. 测试策略

### 14.1 路由测试

必须覆盖：

1. 有源图 + 生成视频 -> 命中 `image2video`
2. 纯描述 + 生成视频 -> 命中 `text2video`
3. 改图请求 -> 命中 `image_edit`
4. 没有源图但要求改图 -> 正确报错，不得偷切 `image_generate`
5. 文档能力按 MIME / 扩展名正确路由
6. selector 首选 provider 执行失败后，能继续命中下一候选
7. 前端不参与 provider 选择时，视频 / 语音 / 视觉链路仍能跑通

### 14.2 Source Resolver 测试

必须覆盖：

1. 工作区相对路径
2. 本地绝对路径
3. `/api/uploads/...`
4. `/api/management/agents/...`
5. `http/https`
6. `data:image/...`

### 14.3 Result Renderer 测试

同一个 `PresentableResult` 必须覆盖：

1. Desktop Renderer 输出
2. WhatsApp Renderer 输出
3. Telegram Renderer 输出
4. Plain Text Renderer 输出

同时还要验证：

1. 前端只根据 `PresentableResult` 渲染
2. 不通过页面逻辑手工选择组件 provider
3. renderer 被解绑后，仍能退回纯文本或下载链接渲染

### 14.4 Job 测试

必须覆盖：

1. 排队
2. 运行中
3. 成功
4. 失败
5. 取消
6. 进度更新

### 14.5 组件 Provider Artifact 测试

必须覆盖：

1. 保存组件后自动生成可执行 skill adapter
2. 组件定义中的 `capabilityBinding` 能正确反映到 runtime skill tags / metadata
3. 修改基础工具绑定后，skill artifact 与 runtime cache 同步更新
4. 删除组件后 provider 不再可见
5. 禁用组件后 selector 不再命中该 provider

### 14.6 Agent Binding 冲突测试

必须覆盖：

1. agent 禁用某 provider 时，即使 capability 允许，也不得命中
2. provider 全局 disabled 时，即使 agent 允许，也不得命中
3. `scope=self` 不得错误泄露到普通 generic agent 列表
4. 同名 capability 在 `generic/self` 共存时，按 scope 正确隔离

建议明确冲突优先级：

1. `agent provider deny`
2. `agent capability allow/deny`
3. `provider enabled/health state`
4. `global fallback`

---

## 15. 风险与控制措施

### 15.1 风险：迁移期双协议并存

控制：

1. 先保留旧链路
2. 图片能力先试点
3. 逐步将旧组件直调迁移到统一工具

### 15.2 风险：Prompt 与结构化路由冲突

控制：

1. Prompt 逐步减负
2. 路由逻辑尽量下沉到 `Capability Registry`
3. Prompt 只保留原则，不保留过多组件细节

### 15.3 风险：渠道能力差异大

控制：

1. 所有交互先语义化
2. renderer 层决定降级方式
3. 不让模型直接输出渠道专有协议

### 15.4 风险：视频与文档链路复杂度高

控制：

1. 统一走 `Job`
2. 统一走 `AssetRef`
3. 统一走 `PresentableResult`

---

## 16. 本期建议落地优先级

建议按以下优先级推进：

1. 抽出 `AssetRef`
2. 抽出 `PresentableResult`
3. 抽出 `Job`
4. 在 `openfang` 中新增 `Capability Router`
5. 重构图片链路为标准范式
6. 新增 `video_generate`
7. 将组件 skill 降级为 capability provider
8. 将 `UI skill` 收敛为桌面端 renderer 规则
9. 为 WhatsApp / Telegram 增加 renderer
10. 新增文档能力族

---

## 17. 最终结论

本次重构的本质不是“继续补规则”，而是把系统从“模型直面 UI 协议 + 组件名”升级为“模型直面统一能力 + 系统内部自行选择 provider + 渠道自行渲染结果”。

如果该方案落地，项目将获得以下长期收益：

1. 底层工具更稳定，可复用性更高
2. 组件 skill 不再污染跨渠道输出协议
3. 桌面端 A2UI 得到保留，但不会反向绑架所有渠道
4. 图片、视频、音频、文档能力具备统一扩展路径
5. 新增 provider、新增组件、新增渠道时不再需要继续膨胀 prompt 规则
6. 后续引入 OCR、字幕、文档解析、媒体派生处理会更加自然

一句话总结：

**能力统一进底层工具，组件统一做能力适配，结果统一进中立模型，桌面和渠道统一走各自 renderer。**
