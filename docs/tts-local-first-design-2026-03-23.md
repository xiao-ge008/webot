# TTS 本地优先方案设计（2026-03-23）

日期：2026-03-23  
状态：Draft v1  
适用范围：`webot-app` 桌面端 + `vendor/openfang` 运行时 TTS 体系  
当前优先级：先写文档并收敛方案，后续按本文逐步实现  

---

## 1. 文档目标

本文用于定义 `weBot-app` 的 TTS 一期方案。

本期的核心目标不是一次性做完所有语音能力，而是先把下面三件事收敛清楚：

1. 在全局设置页增加统一的 TTS 配置入口，明确区分本地与远程。
2. 在智能体编辑页增加“TTS 服务”配置区，让每个智能体可以独立控制自己的发声配置。
3. 一期先实现本地引擎 `DakeQQ/F5-TTS-ONNX`，远程 provider 只做配置预留，不在本期落地请求链路。

---

## 2. 本期设计结论

### 2.1 功能范围

本期确认如下范围：

1. 全局设置页新增 `TTS` 选项卡。
2. 设置页支持切换 `本地 / 远程` 两种模式。
3. 本地模式先接入 `DakeQQ/F5-TTS-ONNX`。
4. 用户开启本地模式后，支持下载模型到本地目录。
5. 用户开启本地模式后，支持加载本地模型并查看状态。
6. 智能体编辑页新增 `TTS 服务` 配置区。
7. 智能体可以配置：
   - 是否启用 TTS
   - 绑定哪个 TTS 服务
   - 使用哪个声音样本 / 音色配置
   - 语速、音调、文本切分等参数
8. 远程 provider 在设置页先做结构和表单预留：
   - `OpenAI`
   - `CosyVoice3`
   - `IndexTTS`
   - `QWEN-TTS`

### 2.2 本期不做

本期明确不做：

1. 不实现远程 provider 的真实调用链。
2. 不实现 `CosyVoice3 / IndexTTS / QWEN-TTS / OpenAI` 的运行时推理。
3. 不做高性能加速后端，如 `F5_TTS_Faster`。
4. 不做复杂声纹市场或用户自由语音克隆工作流。
5. 不做边生成边播放。
6. 不做多引擎并发调度。

---

## 3. 当前代码基线

当前仓库里已经存在和 TTS 相关的基础能力，但结构还不满足“本地引擎优先”的产品化要求。

### 3.1 现有运行时能力

`vendor/openfang` 里已经有：

1. `TtsEngine`
2. `text_to_speech` 工具
3. Web Chat 的语音上传和 STT
4. 旧版的远程 TTS provider 直连逻辑

但当前这些能力的特点是：

1. 偏工具调用，不是完整的“本地引擎管理系统”。
2. 没有“模型下载 -> 校验 -> 本地加载 -> 状态管理”这一层。
3. 没有按“全局服务配置”和“智能体发声配置”分开建模。

### 3.2 现有前端入口

已经定位到的主要入口如下：

1. 全局设置页容器：
   - `apps/frontend/src/components/SettingsDialog.tsx`
2. 设置页子模块目录：
   - `apps/frontend/src/components/settings/`
3. 智能体编辑页：
   - `apps/frontend/src/pages/EditAgentPage.tsx`
4. 智能体前端类型：
   - `apps/frontend/src/types/agent.ts`

当前 `apps/frontend/src/types/agent.ts` 已经有旧的占位字段：

1. `ttsModel`
2. `ttsVoice`
3. `ttsSpeed`
4. `ttsPitch`

这些字段说明项目之前已经考虑过 TTS，但现在需要升级成完整配置结构，不能继续靠四个扁平字段承载后续能力。

---

## 4. 总体设计原则

### 4.1 全局服务配置与智能体使用配置分离

必须把下面两层分开：

1. 全局层：
   - 当前启用的是本地还是远程
   - 本地模型是否已下载
   - 本地模型是否已加载
   - 远程 provider 的地址和密钥
2. 智能体层：
   - 当前智能体是否启用 TTS
   - 当前智能体使用哪个 TTS 服务
   - 当前智能体对应哪个声音样本 / 音色配置
   - 当前智能体的发声参数

### 4.2 本地优先，远程预留

一期默认逻辑：

1. 用户在设置页把 TTS 模式切到本地。
2. 系统引导下载 `F5-TTS-ONNX` 所需模型。
3. 下载完成后支持加载本地模型。
4. 智能体编辑页允许选择“本地 F5 服务”并绑定声音样本。

远程 provider 本期只负责：

1. 先在设置页有表单结构。
2. 先把数据结构设计好。
3. 先把 UI 上的可见入口预留好。

### 4.3 “声音样本”优先于“简单 voice id”

本期的智能体音色方案不建议继续沿用简单的：

1. `ttsVoice = alloy`
2. `ttsModel = xxx`

更合理的抽象应该是：

1. 智能体绑定一个 `声音样本` 或 `音色配置`
2. 该配置包含参考音频、参考文本和推理参数

这样后续才能兼容 F5 的 reference-based 方案。

---

## 5. 页面改造方案

## 5.1 设置页新增 TTS 选项卡

建议在 `SettingsDialog.tsx` 里新增一个 `tts` 菜单项，和现有：

1. `providers`
2. `models`
3. `imageGeneration`
4. `visionAnalysis`
5. `memoryEnhancement`

并列，归入 `Server` 分组。

建议新增文件：

1. `apps/frontend/src/components/settings/TtsTab.tsx`

### 5.1.1 设置页需要展示的内容

一期建议展示以下内容：

1. TTS 总开关
2. TTS 模式
   - `local`
   - `remote`
3. 当前本地引擎
   - 先固定为 `F5-TTS-ONNX`
4. 本地模型状态
   - 未下载
   - 下载中
   - 已下载
   - 加载中
   - 已加载
   - 失败
5. 模型目录
6. 下载按钮
7. 加载按钮
8. 卸载按钮
9. 健康检查结果
10. 远程 provider 配置区域
    - 先做表单预留
    - 不接真实调用

### 5.1.2 远程 provider 预留项

设置页里远程区先显示四个 provider：

1. `OpenAI`
2. `CosyVoice3`
3. `IndexTTS`
4. `QWEN-TTS`

每个 provider 先预留：

1. `enabled`
2. `baseUrl`
3. `apiKeyEnv` 或密钥引用方式
4. `model`
5. `voice`
6. `format`
7. `timeout`

本期不做：

1. 真实联通测试
2. 真实推理调用
3. 自动 provider 回退

---

## 5.2 智能体编辑页新增 TTS 服务区

入口文件：

1. `apps/frontend/src/pages/EditAgentPage.tsx`

一期建议在智能体编辑页增加独立区块：

1. `TTS 服务`

不要把它混在模型选择字段后面几个小输入框里，否则后面扩展会很乱。

### 5.2.1 智能体级配置项

建议智能体编辑页支持：

1. 是否启用该智能体的 TTS
2. 服务来源
   - `inherit_global`
   - `local_f5`
   - `remote_openai`
   - `remote_cosyvoice3`
   - `remote_indextts`
   - `remote_qwen_tts`
3. 声音样本选择
4. 参考音频上传
5. 参考文本编辑
6. 语速
7. 音调
8. 文本切分策略
9. 单次最大字符数
10. 试听按钮

### 5.2.2 智能体级状态展示

建议在智能体编辑页显示：

1. 当前绑定服务
2. 当前绑定声音样本
3. 服务可用性
4. 声音样本是否完整
5. 最近一次试听结果

---

## 6. 数据模型设计

## 6.1 全局 TTS 设置

建议新增全局结构：

```ts
interface AppTtsSettings {
  enabled: boolean;
  mode: 'local' | 'remote';
  activeLocalEngine: 'f5-tts-onnx';
  local: LocalTtsSettings;
  remote: RemoteTtsSettings;
}
```

### 6.1.1 本地引擎设置

```ts
interface LocalTtsSettings {
  enabled: boolean;
  engine: 'f5-tts-onnx';
  modelDir: string;
  autoDownload: boolean;
  autoLoad: boolean;
  device: 'auto' | 'cpu' | 'directml' | 'openvino';
  status:
    | 'not_installed'
    | 'downloading'
    | 'downloaded'
    | 'loading'
    | 'loaded'
    | 'failed';
  modelVersion?: string;
  lastError?: string;
}
```

### 6.1.2 远程 provider 设置

```ts
interface RemoteTtsSettings {
  activeProvider?: 'openai' | 'cosyvoice3' | 'indextts' | 'qwen-tts';
  openai: RemoteTtsProviderConfig;
  cosyvoice3: RemoteTtsProviderConfig;
  indextts: RemoteTtsProviderConfig;
  qwenTts: RemoteTtsProviderConfig;
}

interface RemoteTtsProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKeyEnv?: string;
  model?: string;
  voice?: string;
  format?: string;
  timeoutSecs?: number;
}
```

## 6.2 智能体级 TTS 配置

建议把当前 `Agent` 上的扁平字段升级为结构化字段：

```ts
interface AgentTtsConfig {
  enabled: boolean;
  serviceMode: 'inherit_global' | 'local_f5' | 'remote_openai' | 'remote_cosyvoice3' | 'remote_indextts' | 'remote_qwen_tts';
  speakerProfileId?: string;
  speed?: number;
  pitch?: number;
  splitStrategy?: 'auto' | 'sentence' | 'paragraph';
  maxChunkChars?: number;
}
```

### 6.2.1 声音样本 / 音色配置

```ts
interface AgentSpeakerProfile {
  id: string;
  name: string;
  engine: 'f5-tts-onnx';
  refAudioPath?: string;
  refText?: string;
  language?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

说明：

1. 一期优先把“声音样本”建成结构化对象。
2. 智能体只保存 `speakerProfileId`。
3. 参考音频和参考文本作为 profile 资源保存。

---

## 7. 本地 F5 引擎一期工作流

## 7.1 用户首次开启本地 TTS

流程如下：

1. 用户进入设置页 `TTS`。
2. 切换模式到 `本地`。
3. 系统检测本地模型目录是否存在。
4. 如果不存在，展示“下载模型”按钮。
5. 用户点击下载后，开始下载模型文件到本地目录。
6. 下载完成后进行完整性校验。
7. 校验通过后，允许点击“加载模型”。
8. 加载成功后，设置页显示 `已加载`。

## 7.2 智能体绑定声音样本

流程如下：

1. 用户进入智能体编辑页。
2. 打开 `TTS 服务` 区块。
3. 启用该智能体的 TTS。
4. 选择 `本地 F5`。
5. 上传参考音频。
6. 填写参考文本。
7. 保存为一个 `声音样本`。
8. 智能体绑定该样本。

## 7.3 后续聊天发声

本期文档先收敛到配置和模型管理层，运行时播放链路后续实现时再接入。

目标形态是：

1. 智能体回复文本
2. 选择对应智能体的 TTS 配置
3. 调用本地 F5 引擎
4. 产出音频文件
5. 聊天界面播放

---

## 8. 本地模型目录建议

建议统一放在应用私有模型目录下，例如：

```text
~/.webot/shared/models/tts/f5-tts-onnx/
```

目录下建议包含：

```text
manifest.json
model.onnx
vocoder.onnx
tokens/
voices/
version.json
```

下载过程建议遵循：

1. 先下载到 `.part`
2. 下载完成后做校验
3. 校验通过再原子改名
4. 失败时保留错误信息并允许重试

---

## 9. 配置持久化建议

## 9.1 全局设置

全局 TTS 设置建议跟现有设置页统一管理，保存到应用设置配置中。

这部分后续需要扩展：

1. `apps/frontend/src/main/types.ts`
2. 设置页对应的数据读写服务
3. 可能的桌面端配置持久化接口

## 9.2 智能体配置

智能体级 TTS 配置建议并入智能体详情配置，不单独散落到多个字段。

后续应从：

1. `ttsModel`
2. `ttsVoice`
3. `ttsSpeed`
4. `ttsPitch`

迁移到：

1. `ttsConfig`
2. `speakerProfiles`

---

## 10. 推荐实施阶段

## 10.1 第一阶段：文档与数据结构

本阶段目标：

1. 完成本文档
2. 确定全局 TTS 设置结构
3. 确定智能体级 TTS 配置结构
4. 确定声音样本结构

## 10.2 第二阶段：设置页 UI

本阶段目标：

1. 新增 `TtsTab.tsx`
2. 完成本地 / 远程 UI 结构
3. 远程 provider 做表单预留
4. 本地模型状态 UI 打通

## 10.3 第三阶段：本地模型管理

本阶段目标：

1. 接入 `F5-TTS-ONNX`
2. 实现下载
3. 实现校验
4. 实现加载 / 卸载
5. 实现状态回显

## 10.4 第四阶段：智能体编辑页 TTS 服务

本阶段目标：

1. 增加 `TTS 服务` 区块
2. 支持样本上传
3. 支持参考文本编辑
4. 支持绑定 profile

## 10.5 第五阶段：聊天播放链路

本阶段目标：

1. 把智能体回复接入 TTS
2. 产出音频文件
3. 前端可播放

---

## 11. 建议涉及文件

本文档对应的主要开发入口建议如下。

### 11.1 前端设置页

1. `apps/frontend/src/components/SettingsDialog.tsx`
2. `apps/frontend/src/components/settings/TtsTab.tsx`
3. `apps/frontend/src/main/types.ts`

### 11.2 前端智能体编辑页

1. `apps/frontend/src/pages/EditAgentPage.tsx`
2. `apps/frontend/src/types/agent.ts`

### 11.3 前端服务层

1. `apps/frontend/src/services/management-client.ts`
2. 可能新增：
   - `apps/frontend/src/services/tts-settings-client.ts`
   - `apps/frontend/src/services/local-tts-service.ts`

### 11.4 OpenFang / 本地运行时

1. `vendor/openfang/crates/openfang-runtime/src/tts.rs`
2. `vendor/openfang/crates/openfang-kernel/src/kernel.rs`
3. `vendor/openfang/crates/openfang-api/src/routes.rs`

---

## 12. 最终收敛结论

本期统一按下面这条主线推进：

1. 设置页增加 `TTS` 配置。
2. TTS 模式分 `本地 / 远程`。
3. 远程 provider 先预留 `OpenAI / CosyVoice3 / IndexTTS / QWEN-TTS`。
4. 一期只实现本地 `DakeQQ/F5-TTS-ONNX`。
5. 开启本地后支持下载模型到本地目录并加载。
6. 智能体编辑页增加 `TTS 服务` 区域。
7. 智能体可配置状态、服务来源、声音样本和参考参数。

这套设计的重点是先把“配置层”和“资源层”搭稳，再进入真正的推理与播放链路实现。
