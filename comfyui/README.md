# weBot 内置 ComfyUI 工作流

这个目录是 weBot 桌面端内置的 ComfyUI workflow 模板目录。

- `generate/*.json`
  - `*-api.json`：程序实际调用的 API workflow
  - `*.json`：给用户在 ComfyUI 页面里导入调试的可视化 workflow
- `edit/*.json`
  - `*-api.json`：程序实际调用的 API workflow
  - `*.json`：给用户排查缺失节点、模型、LoRA 时手动调试

## 运行方式

weBot 不会让 LLM 直接理解 ComfyUI 节点。

- `openfang-runtime` 只传通用参数：提示词、负向提示词、宽高、原图路径或上传 URL
- `apps/service-rs` 负责读取 `~/.webot/image-generation.json`
- `apps/service-rs` 负责从 `~/.webot/comfyui` 读取这些内置 workflow
- `apps/service-rs` 负责把设置项映射到 workflow 节点，然后调用 ComfyUI API

桌面端启动时，会把安装包里的这个目录同步到：

- `~/.webot/comfyui`

程序真正读取的是 `~/.webot/comfyui`，不是仓库里的这份源码目录。

## ComfyUI 服务器要求

建议：

1. 安装官方 ComfyUI。
2. 开启 API 服务，默认地址使用 `http://127.0.0.1:8188`。
3. 确认设置页里的 ComfyUI 地址能访问 `/object_info` 与 `/models`。

当前内置 workflow 至少需要这些节点类存在：

- 生成：
  - `CheckpointLoaderSimple`
  - `Lora Loader Stack (rgthree)`
  - `KSampler`
  - `EmptySD3LatentImage`
  - `CLIPTextEncode`
  - `SaveImage`
- 修改：
  - `CheckpointLoaderSimple`
  - `QwenImageIntegratedKSampler`
  - `LoraLoaderModelOnly`
  - `LayerUtility: ImageScaleByAspectRatio V2`
  - `CR Prompt Text`
  - `LoadImage`
  - `SaveImage`

如果设置页里 ComfyUI 连通但仍提示缺失节点，直接把非 API 版 workflow 导入 ComfyUI 页面，界面会更容易看到丢的是哪个自定义节点。

## 模型目录约定

内置设置页会探测这些目录：

- Checkpoint：`models/checkpoints/`
- LoRA：`models/loras/`

当前默认链路约定：

- 生成图：在设置页选择生成模型、LoRA、步数、CFG、采样器、调度器、默认宽高
- 改图：在设置页选择修改模型、LoRA、步数、CFG、采样器、调度器

只有被 ComfyUI 正常识别到的模型，才应该填到设置里。

## 工作流说明

### 1. 生成图

程序使用：

- `generate/Z-Image-Turbo-api.json`

暴露给设置页和工具层的参数只有：

- 正向提示词
- 负向提示词
- 宽
- 高
- 模型名
- LoRA
- 步数
- CFG
- 采样器
- 调度器
- 张数

### 2. 改图

程序使用：

- `edit/Qwen-AIO-api.json`

改图链路会：

1. 先读取原图
2. 上传到 ComfyUI `upload/image`
3. 把原图文件名映射到 `LoadImage`
4. 把编辑提示词映射到 Qwen Edit workflow
5. 轮询历史结果并把图片落到 weBot 本地上传缓存和工作区

## 设置文件

统一图片服务配置保存在：

- `~/.webot/image-generation.json`

内置 workflow 模板保存在：

- `~/.webot/comfyui`

如果你替换了本目录里的源码模板，重新启动桌面端后会重新同步到 `~/.webot/comfyui`。

## 调试建议

### A. 先看设置页连通状态

如果连通状态失败，先排查：

- ComfyUI 是否启动
- 地址和 Key 是否正确
- 模型是否确实在 `models/checkpoints/`
- LoRA 是否确实在 `models/loras/`

### B. 再导入非 API workflow

把这些文件导入 ComfyUI 页面：

- `generate/Z-Image-Turbo.json`
- `edit/Qwen-AIO.json`

用途：

- 看缺失节点
- 看缺失模型
- 看 LoRA 名称是否写错
- 看节点输入是否被改坏

### C. 最后跑 weBot 统一接口

仓库里提供了一个最小验收脚本：

- [scripts/test-image-service.mjs](/E:/weBot2/webot-app/scripts/test-image-service.mjs)

用法：

```bash
node E:\weBot2\webot-app\scripts\test-image-service.mjs
```

脚本会：

1. 读取 `~/.webot/image-generation.json`
2. 调 `POST /api/management/image-generation/generate`
3. 再调 `POST /api/management/image-generation/edit`
4. 输出 `saved_to` 和 `image_urls`

如果脚本成功，智能体走同一条统一图片服务链路时也应成功。
