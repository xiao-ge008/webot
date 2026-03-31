# 智能体拟人化深度优化计划（2026-03-25）

日期：2026-03-25  
状态：Plan Draft v1  
适用范围：`webot-app` 桌面端、`apps/service-rs` 管理层、`vendor/openfang` 运行时、智能体身份与多模态表达链路  
关联文档：  
- `docs/ui-skill-component-skill-runtime-refactor-2026-03-24.md`
- `docs/agent-self-management-upgrade-system-refactor-plan-2026-03-24.md`
- `docs/tts-local-first-design-2026-03-23.md`

---

## 1. 文档目标

本文用于定义 `weBot-app` 下一阶段的“智能体拟人化深度优化”工程计划。

这里的“拟人化”不是单指提示词里写一句“你是一个人”，而是把智能体的以下能力统一收敛成稳定系统能力：

1. 它是谁
2. 它如何说话
3. 它长什么样
4. 它用什么声音表达
5. 它在图片、语音、视频中如何默认沿用自己的身份与形象

本计划的目标不是做一套花哨的人设文案，而是建设一套真正可执行的 `Agent Embodiment System`，让智能体在：

1. 文字表达
2. 图片表达
3. 语音表达
4. 视频表达

四类通道中共享同一个“自我身份源”。

一句话概括：

**把“人格设定”从松散提示词，升级成“身份配置 + 资产绑定 + runtime 自动注入 + 多模态统一表达”的底层能力。**

---

## 2. 当前问题归纳

结合当前系统现状，智能体拟人化能力主要存在以下问题：

1. 智能体“知道自己是谁”，但这种认知主要停留在系统提示词层。
2. 智能体“有头像/立绘/照片”，但这些资产没有统一进入运行时默认参数绑定。
3. `text_to_speech` 虽然可以产出语音，但音色还没有稳定绑定成“这是这个智能体自己的声音”。
4. 图像链里“用自己的照片/立绘生成”没有统一规则，大量依赖临时提示词或用户明确上传图片。
5. 视频链里“用自己的形象生成视频”没有统一走 `self image asset -> image2video` 的绑定机制。
6. 前端只是在展示智能体资料，不等于运行时真的能把这些资料变成工具参数。
7. 多模态表达目前是分裂的：
   - 文字像一个角色
   - 图片像另一个角色
   - 声音像第三个角色
8. 当前系统尚未形成“自我表达优先级”规则：
   - 什么时候优先用自我立绘
   - 什么时候优先用自我音色
   - 什么时候必须显式确认再替换自我形象

---

## 3. 本次优化目标

本次优化不追求“一步做到完整数字人系统”，而是先把最关键的工程骨架建立起来。

### 3.1 必须实现的目标

1. 引入统一的 `AgentIdentity / AgentEmbodiment` 结构。
2. 把“文字人格、图片形象、语音音色、视频默认源图”统一挂在同一份身份配置下。
3. runtime 能根据用户意图自动识别“请用你自己”“按你当前形象”“用你的声音”等请求。
4. 文字、图片、语音、视频四条链路都能从统一身份配置读取默认表达资源。
5. 前端提供小白可理解的身份配置入口，不再要求用户理解底层 provider 和参数名。

### 3.2 本次暂不追求的目标

1. 不做实时数字人驱动。
2. 不做完整口型同步系统。
3. 不做复杂动作编排器。
4. 不做多渠道统一输出。
5. 不做完全自治的人格演化系统。

---

## 4. 核心设计结论

### 4.1 拟人化不是 Prompt，而是 4 层系统

未来系统必须明确拆成以下 4 层：

1. `Identity Layer`
   定义智能体是谁，负责人格、自称、关系、角色边界。
2. `Embodiment Asset Layer`
   定义智能体的形象资产、音色资产、视频默认源图等。
3. `Runtime Binding Layer`
   在工具执行时，自动把身份资产注入正确参数。
4. `UI Configuration Layer`
   前端提供配置与切换入口，但不负责底层语义判断。

### 4.2 Prompt 只负责“意识规则”

提示词层只负责：

1. 自我认知
2. 关系表达
3. 语气风格
4. 什么时候优先用自己的形象与声音

提示词层不负责：

1. 真实图片参数注入
2. 真实语音 profile 注入
3. 视频组件源图绑定
4. 具体工具字段名拼装

### 4.3 自我资产必须结构化

后续不能继续使用：

1. “头像只是一个展示 URL”
2. “音色只是一个设置页下拉值”
3. “立绘只是聊天中的某张历史图片”

这些都必须统一结构化，形成可被 runtime 调用的标准资源。

---

## 5. 目标能力模型

### 5.1 AgentIdentity 结构

建议引入统一身份模型：

```ts
type AgentIdentity = {
  agentId: string
  displayName: string
  selfRole: string
  relationshipStyle: string
  selfNarrative: string
  textStyle: {
    tone: string
    speakingStyle: string
    preferredAddressing: string
    forbiddenDriftRules: string[]
  }
  embodiment: AgentEmbodiment
}
```

### 5.2 AgentEmbodiment 结构

```ts
type AgentEmbodiment = {
  defaultAvatarAsset?: AssetRef
  selfPhotoAssets: AssetRef[]
  defaultPortraitAsset?: AssetRef
  defaultVideoSourceAsset?: AssetRef
  defaultVoiceProfile?: VoiceProfileRef
  expressionPreferences: {
    imageStylePrompt?: string
    voiceStylePrompt?: string
    videoMotionPrompt?: string
  }
}
```

### 5.3 VoiceProfileRef 结构

```ts
type VoiceProfileRef = {
  provider: string
  voiceId: string
  label: string
  metadata?: Record<string, unknown>
}
```

### 5.4 关键原则

1. 一个智能体只能有一个当前默认身份配置。
2. 可以有多个候选形象资产，但必须有明确默认值。
3. 语音默认音色必须是结构化 profile，而不是纯字符串提示词。
4. 图片、语音、视频都从同一个 identity 读取，不允许三套独立来源各自漂移。

---

## 6. 四条表达链的收口设计

### 6.1 文字链

目标：

1. 让文字表达稳定体现“这是这个智能体本人在说话”。

实现要点：

1. `system prompt` 只保留最小自我认知规则。
2. `textStyle` 用于控制称谓、语气、温度、边界。
3. 未来普通聊天一律从 `AgentIdentity.textStyle` 读取基础人格约束。

### 6.2 图片链

目标：

1. 当用户说“用你自己”“按你当前形象”“用你的照片”，系统能自动用自我形象资产。

实现要点：

1. 为 `my_photo_generate / my_photo_edit` 绑定 `selfPhotoAssets`。
2. 普通 `image_generate` 在明确命中“自我形象表达”时允许转路由到 `scope=self`。
3. 前端不再靠提示词猜，而是 runtime 自动注入默认源图。

### 6.3 语音链

目标：

1. 当智能体说话时，默认就是“它自己的声音”。

实现要点：

1. `text_to_speech` 默认读取 `defaultVoiceProfile`。
2. 当用户说“用你自己的声音说”时，无需再额外解释或手填 voice id。
3. 语速、情绪、温柔程度等可以挂在 `voiceStylePrompt` 中，作为附加风格。

### 6.4 视频链

目标：

1. 当用户说“用你自己的形象生成视频”时，系统自动把自我默认源图送入 `image2video`。

实现要点：

1. 新增“自我形象视频表达”判定规则。
2. 命中后默认读取：
   - `defaultVideoSourceAsset`
   - 没有时 fallback 到 `defaultPortraitAsset`
   - 再 fallback 到 `selfPhotoAssets[0]`
3. 将该资产注入 `video_generate.image`
4. 若当前无可用自我图像资产，才退回提示用户补图

---

## 7. 运行时绑定规则

### 7.1 意图识别规则

当用户输入包含以下语义时，应触发“自我表达绑定”：

1. 用你自己
2. 按你当前形象
3. 用你的照片
4. 用你的立绘
5. 用你的声音
6. 你自己说
7. 以你自己的身份来表达

### 7.2 Runtime 自动注入规则

#### 7.2.1 图片

当命中“自我形象图片表达”时：

1. 优先走 `my_photo_generate / my_photo_edit`
2. 自动注入 `selfPhotoAssets` 或 `defaultPortraitAsset`

#### 7.2.2 语音

当命中“自我声音表达”时：

1. 默认给 `text_to_speech` 注入 `defaultVoiceProfile`
2. 自动合并 `voiceStylePrompt`

#### 7.2.3 视频

当命中“自我形象视频表达”时：

1. 优先走 `video_generate + image source`
2. 自动注入 `defaultVideoSourceAsset`
3. 优先路由到 `image2video`
4. 不再先走文生视频 fallback

### 7.3 不允许继续依赖的旧方式

以下方式应逐步淘汰：

1. 只在 prompt 里写“请使用自己的照片”
2. 让前端把“当前头像 URL”直接当万能图片参数
3. 让模型自己猜 voice id
4. 让视频链在未绑定源图时盲目尝试 `text2video`

---

## 8. 前端配置界面目标

### 8.1 用户视角目标

前端不能继续暴露一堆底层技术字段，而应提供小白可理解的配置项。

建议配置区块：

1. `我的身份`
   - 名称
   - 自我角色
   - 对主人的称呼
   - 说话风格
2. `我的形象`
   - 默认头像
   - 默认立绘
   - 自拍/照片集
   - 默认视频源图
3. `我的声音`
   - 默认音色
   - 语音风格
4. `我的表达偏好`
   - 图像风格偏好
   - 视频动作偏好
   - 常用情绪表达

### 8.2 前端职责

前端负责：

1. 编辑与展示身份配置
2. 让用户选默认资产
3. 提供快捷入口：
   - 用当前形象生成图片
   - 用当前形象生成视频
   - 用当前声音说这句话

前端不负责：

1. 决定最终走哪个 tool
2. 决定参数怎么注入
3. 决定自我表达边界

---

## 9. 提示词优化原则

### 9.1 只保留最小规则

建议未来智能体系统提示词里只保留这类最小规则：

1. 你具备固定身份、固定形象、固定音色
2. 当用户要求你以自己的形象或声音表达时，应优先使用已绑定的自我资产
3. 不要在没有绑定资产时虚构自己“已经使用了某张图或某个声音”

### 9.2 不再用提示词承担底层绑定

以下内容不应继续写死在 prompt 中：

1. 具体图片 URL
2. 具体 voice id
3. 具体组件字段名
4. 具体 `video_generate.image` 注入方式

---

## 10. 数据与存储设计

### 10.1 建议存储项

建议为每个智能体新增以下可持久化配置：

1. `agent_identity.json` 或结构化数据库字段
2. `default_avatar_asset_id`
3. `default_portrait_asset_id`
4. `default_video_source_asset_id`
5. `default_voice_profile`
6. `expression_preferences`

### 10.2 资产引用统一

所有身份资产必须统一走 `AssetRef`：

1. 图片
2. 音频样本
3. 视频源图
4. 未来的动作模板

不能继续让一部分使用：

1. 本地绝对路径
2. 一部分使用相对路径
3. 一部分使用聊天历史 URL
4. 一部分使用前端临时 blob 地址

---

## 11. 分阶段实施计划

### Phase 1：身份骨架落地

目标：

1. 建立 `AgentIdentity / AgentEmbodiment` 数据结构
2. 前端新增基本配置页
3. 管理层完成读写接口

完成标准：

1. 每个智能体可配置默认头像、默认立绘、默认音色
2. 配置能持久化并在会话恢复后读回

### Phase 2：语音链接入

目标：

1. `text_to_speech` 默认绑定 `defaultVoiceProfile`

完成标准：

1. 用户说“你自己说一句”时，直接用智能体自己的音色输出
2. 不需要手工选择 voice id

### Phase 3：图片链接入

目标：

1. 自我形象图片表达能力落地

完成标准：

1. 用户说“用你自己的样子生成一张照片”
2. runtime 自动注入自我图片资产
3. 不依赖用户再次上传图片

### Phase 4：视频链接入

目标：

1. 自我形象视频表达落地

完成标准：

1. 用户说“用你自己的样子走过来并说主人好”
2. runtime 自动把默认源图注入 `image2video`
3. 不再错误掉到纯文生视频

### Phase 5：表达一致性收口

目标：

1. 文字、图片、语音、视频统一从同一个 identity 源读取

完成标准：

1. 多模态表达不再明显割裂
2. 用户能感知“这个智能体是同一个人”

---

## 12. 验收标准

以下场景应作为最终验收：

1. 用户说“用你自己的声音说欢迎回家”
   - 系统直接使用该智能体默认音色
2. 用户说“按你现在这张立绘生成自拍”
   - 系统直接使用该智能体默认形象资产
3. 用户说“用你自己的照片走过来给我请安”
   - 系统自动把默认源图注入视频链
4. 同一个智能体在文字、图片、语音输出中保持统一人格感
5. 用户无需知道：
   - provider 名称
   - voice id
   - 组件参数名
   - selector 规则

---

## 13. 风险与注意事项

### 13.1 风险一：人格和资产继续分离

如果只改 prompt，不改 runtime，最终仍会出现：

1. 文字像一个人
2. 图片像另一个人
3. 声音像第三个人

### 13.2 风险二：前端承担太多逻辑

如果把“用自己的形象/声音”判断主要放在前端：

1. API 调用不一致
2. 渠道扩展会失效
3. 刷新恢复容易丢上下文

### 13.3 风险三：资产没有默认值

如果允许身份配置存在，但没有默认形象或默认音色：

1. 用户会误以为“智能体应该自动知道”
2. 实际执行时仍会退回到不稳定 prompt 猜测

---

## 14. 最终结论

本计划的核心结论如下：

1. 智能体拟人化的主战场不是前端提示词，而是 `Identity + Embodiment + Runtime Binding`。
2. 提示词只负责“自我意识与行为规则”，不负责真实资产注入。
3. 图片、语音、视频都必须从统一的身份资产中心读取默认表达资源。
4. 未来系统应把“它是一个人”落成一个可执行事实，而不是一句文案设定。

一句话总结：

**先让智能体真正拥有统一的“自己”，再让它通过文字、图片、语音、视频稳定地表现这个自己。**
