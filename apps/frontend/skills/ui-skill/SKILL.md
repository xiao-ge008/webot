---
name: ui-skill
description: "GUI 渲染技能（高优先级）：维护编译内置组件规范与选型策略。内置组件含 ImageCover/ImageAlbum/ImageCarousel（图片）、VideoCover/VideoGallery/VideoCarousel（视频）、WebViewCard（网页/HTML）、AudioPlayer/AudioPlaylist（音频）、MarkdownPreviewCard、OfficePreviewCard、OptionSelector（选项交互）、ChartCard/PieChartCard/BarChartCard/LineChartCard/AreaChartCard/RadarChartCard（图表）。自定义组件统一走独立 skill + tsx 动态加载。"
location: ~/.webot/skills/ui-skill
---
# UI Skill

## 内置组件速览（优先加载）

- `ImageCover`：单图封面预览，适合聊天流内快速展示与发图回填。
- `ImageAlbum`：多图网格相册，适合批量图片浏览与全屏切换。
- `ImageCarousel`：图片轮播，适合连续展示素材与缩略图切换。
- `VideoCover`：单视频封面卡片，点击进入播放。
- `VideoGallery`：多视频网格，适合合集/列表浏览。
- `VideoCarousel`：视频轮播，适合连续播放预览。
- `WebViewCard`：网页或 HTML 片段预览，点击后弹窗浏览。
- `AudioPlayer`：单条音频播放（TTS/音乐/FM）。
- `AudioPlaylist`：多条音频列表连续播放。
- `MarkdownPreviewCard`：Markdown 内容卡片 + 全屏只读预览 + 保存。
- `OfficePreviewCard`：Word/Excel/PDF/PPTX 文档卡片预览与保存。
- `OptionSelector`：高频交互选项组件，单选即触发、多选提交触发，静默进入下一轮。
- `ChartCard`：通用图表卡片（通过 `chartType` 输出 line/bar/area/pie/radar）。
- `PieChartCard`：饼图/环图，适合占比类数据。
- `BarChartCard`：柱状图，适合类别对比。
- `LineChartCard`：折线图，适合趋势变化。
- `AreaChartCard`：面积图，适合累计趋势。
- `RadarChartCard`：雷达图，适合多维能力评估。

## 基础通用组件（json-render / shadcn，已集成 36 个）

- 说明：除上面的业务内置组件外，还可直接使用 json-render 的 shadcn 基础组件做轻量布局与信息展示。
- 可用组件（36）：`Card`、`Stack`、`Grid`、`Separator`、`Tabs`、`Accordion`、`Collapsible`、`Dialog`、`Drawer`、`Carousel`、`Table`、`Heading`、`Text`、`Image`、`Avatar`、`Badge`、`Alert`、`Progress`、`Skeleton`、`Spinner`、`Tooltip`、`Popover`、`Input`、`Textarea`、`Select`、`Checkbox`、`Radio`、`Switch`、`Slider`、`Button`、`Link`、`DropdownMenu`、`Toggle`、`ToggleGroup`、`ButtonGroup`、`Pagination`。
- 使用建议：
  - 媒体能力（图片/视频/网页/音频/文档/选项）优先使用业务内置组件，不要用基础组件重复造轮子。
  - 轻量结构化说明（步骤、对比、状态）可用 `Card + Stack/Grid + Badge/Table`。
  - 需要简单输入交互时可用基础表单组件，但“下一步决策交互”仍优先 `OptionSelector`。

## 技能边界

- 本技能只描述**基础组件**（已编译进 App、稳定可用、不会在运行期热改）。
- 自定义组件（如人物介绍卡）不在本技能固定说明，必须在各自 `~/.webot/skills/<skill-id>/` 下维护 `SKILL.md + components.manifest.json + *.tsx`。
- 当请求命中自定义组件意图时，应优先依赖对应 skill 的说明与 manifest，不要在本技能里硬编码其 props 细节。

## 输出协议

- 只允许两种输出格式，禁止第三种：
- 格式 A（纯 Markdown）：整条消息仅输出 Markdown，不输出任何 `<UI_JSON>`。
- 格式 B（混合 UI）：先输出 Markdown（可空），再输出一个或多个 `<UI_JSON>...</UI_JSON>`；每个块必须是单个合法 JSON 对象（双引号、无代码块包裹）。
- 禁止输出 `<tool_call>`、XML、YAML、注释 JSON、未闭合标签等非协议内容。
- 若场景不适合结构化展示，使用格式 A；若需交互或卡片渲染，使用格式 B。
- 若出现“已打开视频/可播放/播放列表/点击播放”等语义，禁止只输出文字说明；必须输出至少一个视频组件（`VideoCover`/`VideoGallery`/`VideoCarousel`）。

## 组件类型命名规范（避免渲染失败）

- 推荐优先使用 PascalCase 正式名：`ImageCover`、`ImageAlbum`、`ImageCarousel`、`VideoCover`、`VideoGallery`、`VideoCarousel`、`WebViewCard`、`AudioPlayer`、`AudioPlaylist`、`MarkdownPreviewCard`、`OfficePreviewCard`、`OptionSelector`、`ChartCard`、`PieChartCard`、`BarChartCard`、`LineChartCard`、`AreaChartCard`、`RadarChartCard`。
- 兼容别名（可识别但不推荐长期使用）：`video`、`videocover`、`videogallery`、`videocarousel`、`optionselector`、`option_selector`、`option.selector`、`chart`、`pie_chart`、`bar_chart`、`line_chart`、`area_chart`、`radar_chart`。
- 严禁输出未注册的自定义 `type`（如随意新造 `video_player_xxx`）；若确需新组件，必须走独立 skill + tsx 动态加载。
- `UI_JSON` 每个块只放一个 JSON 对象，不要包 Markdown 代码块，不要混入注释。

## 交互优先策略（重要）

- 当回复末尾存在“下一步怎么做/你要我继续哪个方向/需要你确认分支”的场景，优先使用 `OptionSelector`，不要让用户再输入自然语言解释。
- 选项按钮只显示 `label/hint`，提交给 AI 的真实内容放在 `prompt`（隐藏字段）中。
- `prompt` 必须写完整可执行指令句（例如“请输出一个 VideoCover 播放该 YouTube 链接并弹窗播放”），禁止 `play_video` 这类占位短词。
- 默认将 `OptionSelector` 混排在同一条回复的结尾：上方是简短结论或阶段结果，下方直接给可点击选项。
- 单选问题（路径二选一、确认继续）优先 `mode=single`；多条件组合（一次选多个任务）使用 `mode=multiple`。
- 触发后建议禁用当前选项区（`disabledAfterSubmit=true`），避免重复触发造成上下文污染。
- 交互触发统一动作名 `submit_option`；聊天层会静默发送，不新增用户气泡，直接进入下一轮。

## 基础组件（编译内置）

### ImageCover
- 场景：单图封面预览（聊天流内自适应展示）。
- 关键参数：`src`、`title`、`subtitle`、`aspectRatio`、`maxWidth`、`maxHeight`、`sendOnClick`、`onClickAction`。
- 支持本地路径与网络 URL；点击可触发发图动作，默认 `insert_image`。

### ImageAlbum
- 场景：多图相册网格布局（自动分列与间距）。
- 关键参数：`images`、`columns`、`gap`、`maxHeight`、`sendOnClick`、`onClickAction`。
- 支持封面点击后全屏预览，支持在预览中左右切换。

### ImageCarousel
- 场景：轮播展示一组图片。
- 关键参数：`images`、`autoplay`、`intervalMs`、`loop`、`showThumbs`、`sendOnClick`、`onClickAction`。
- 支持全屏查看与缩放，适合连续展示素材。

### VideoCover
- 场景：单视频封面卡片（封面 + 标题 + 时长）。
- 关键参数：`src`、`poster`、`title`、`description`、`duration`、`openMode`、`sendAction`、`clickAction`。
- 点击可全屏弹窗播放；流媒体链接可优先走独立 WebView 窗口播放。
- `MPV` 与独立 WebView 仅在桌面 App 运行时可用；非 App 环境自动回退到内嵌弹窗或浏览器打开。

### VideoGallery
- 场景：多视频网格卡片布局。
- 关键参数：`videos`、`columns`、`gap`、`aspectRatio`、`openMode`、`sendAction`。
- 适合播放列表/合集浏览，支持点击单卡进入播放器。

### VideoCarousel
- 场景：视频轮播展示。
- 关键参数：`videos`、`height`、`autoplayMs`、`showThumbs`、`openMode`。
- 支持缩略图切换与弹窗播放。

### WebViewCard
- 场景：网页/HTML 片段预览卡片。
- 关键参数：`url`、`html`、`title`、`description`、`preview.image`、`favicon`、`dialogHeight`。
- 点击卡片后弹窗内嵌无头 WebView；URL 模式右上角可“当前浏览器打开”。
- 若输入为 HTML/`div` 片段（`html` 字段），只在弹窗中渲染片段，不提供浏览器打开入口。

### AudioPlayer
- 场景：TTS 语音、音乐单曲、FM/直播流的聊天内联播放。
- 关键参数：`src`、`title`、`artist`、`album`、`cover`、`duration`、`live`、`autoplay`、`speed`、`volume`。
- 支持播放/暂停、进度、音量、倍速、发送到输入框（默认 `insert_audio`）。
- 桌面 App（Win/macOS/Linux）支持 MPV 一键外部播放；Web 环境自动隐藏 MPV 按钮。

### AudioPlaylist
- 场景：多条音频/播客/节目列表播放。
- 关键参数：`audios`/`playlist`、`showQueue`、`loop`、`autoPlayOnSelect`。
- 支持上一首/下一首与列表切换，适合连续播放。

### MarkdownPreviewCard
- 场景：Markdown 内容预览（本地 `.md` 文件或 AI 返回的 markdown 字符串）。
- 关键参数：`markdown`、`content`、`filePath`、`title`、`description`、`dialogHeight`、`previewLines`。
- 聊天窗口先渲染摘要卡片，点击后全屏只读预览（不可编辑）。
- 顶部提供“另存为”按钮，保存到本地 Markdown 文件。
- 桌面 App 支持“本地文件读取 + 内联内容预览 + 另存为”。
- Web 环境仅支持“内联 markdown 预览 + 下载保存”，不支持本地文件读取。

### OfficePreviewCard
- 场景：Office 文档预览（Word/Excel/PDF/PPTX）聊天卡片。
- 关键参数：`src/url/path/file`、`fileType`、`title`、`description`、`fileName`、`dialogHeight`。
- 聊天窗口展示文件名与类型徽标，点击后全屏预览。
- 支持本地文件与网络 URL；本地文件读取仅限桌面 App。
- 顶部提供“保存”按钮；网络 URL 在支持时可“浏览器打开”。
- `fileType` 不传时按扩展名推断；推荐明确传入以避免歧义。

### OptionSelector
- 场景：让用户在聊天流内直接做“下一步选择”，并把隐藏内容提交给 AI。
- 关键参数：`mode`、`options`、`submitAction`、`joinWith`、`minSelect`、`maxSelect`、`disabledAfterSubmit`。
- 选项结构建议：`label`（展示文案）+ `prompt`（提交给 AI 的隐藏内容，不展示）。
- 单选模式（`mode=single`）：点击即触发动作并立即进入下一轮，无需再点提交。
- 多选模式（`mode=multiple`）：先勾选，再点提交按钮触发；支持最少/最多选择约束。
- 触发后默认禁用（`disabledAfterSubmit=true`），按钮显示“已选择/已提交”，避免重复触发。
- 交互动作回传建议统一使用 `submit_option`（或兼容别名），payload 中包含 `prompt/prompts/selected`。
- 聊天策略：该组件触发的是“静默发送”（不新增用户气泡），LLM 直接继续下一轮输出。
- 常用混排方式：先给 1~3 句结果摘要，再放 `OptionSelector` 作为尾部交互区，不单独另起长段解释。
- 文案建议：`label` 控制在 4~12 字；`hint` 控制在 1 行；`prompt` 使用完整指令句，便于下一轮直接执行。
- 单选建议 2~4 个选项；多选建议 3~8 个选项，避免过多造成点击成本。

#### OptionSelector 推荐模板（单选）

- 适用：分支决策、是否继续、选择输出格式。
- 要点：`mode=single`，每个选项的 `prompt` 直接写下一轮执行指令。

#### OptionSelector 推荐模板（多选）

- 适用：一次提交多个任务（如“修复+测试+文档”）。
- 要点：`mode=multiple`，设置 `minSelect/maxSelect`，提交后由 `joinWith` 拼接为单条静默消息。

### ChartCard（通用图表）
- 场景：结构化数据可视化展示，减少纯 Markdown 列表。
- 关键参数：`chartType`（`line|bar|area|pie|radar`）、`data`、`title`、`description`、`height`、`showLegend`、`showGrid`、`compact`。
- 适合“先结论后图表”：先 1~2 句摘要，再给图表组件。

### PieChartCard
- 场景：占比、份额、构成（如渠道占比、预算分配）。
- 数据建议：`data=[{name:\"A\",value:40},{name:\"B\",value:60}]`。
- 关键参数：`data`、`dataKey`、`nameKey`、`innerRadius`、`outerRadius`、`maxItems`。

### BarChartCard
- 场景：类别对比（如城市销量、模型评分）。
- 数据建议：`data=[{name:\"上海\",sales:120},{name:\"北京\",sales:98}]` + `series=[{\"key\":\"sales\",\"label\":\"销量\"}]`。
- 关键参数：`data`、`xKey`、`series`、`height`、`showLegend`、`showGrid`。

### LineChartCard
- 场景：时间趋势（如周活、价格变化）。
- 数据建议：`data=[{date:\"03-01\",uv:1200},{date:\"03-02\",uv:1350}]` + `xKey=\"date\"`。
- 关键参数：`data`、`xKey`、`series`、`height`、`showLegend`、`compact`。

### AreaChartCard
- 场景：趋势 + 面积累积表达（如消耗曲线、累计量）。
- 关键参数：`data`、`xKey`、`series`、`height`、`showLegend`、`showGrid`。

### RadarChartCard
- 场景：多维能力雷达（如模型评估、人员能力画像）。
- 数据建议：`data=[{metric:\"推理\",score:86},{metric:\"编码\",score:92}]` + `xKey=\"metric\"`。
- 关键参数：`data`、`xKey`、`series`、`height`、`showLegend`。

## 本地与网络图片规则

- 网络图：`http://`、`https://`
- 本地图：`file:///`、Windows 盘符路径（如 `C:\\images\\a.jpg`）、Unix 绝对路径
- 传入路径应可被前端归一化后访问；无法访问时应给出可替代的文本说明。

## 本地与流媒体视频规则

- 本地/直链视频支持：`file:///`、Windows 盘符路径、`http(s)` 直链（`mp4/webm/mov/m3u8` 等）。
- 流媒体平台链接支持：`youtube`、`tiktok`、`bilibili` 等 URL。
- 对流媒体链接，默认使用 `openMode=dialog`，保证在聊天内弹窗可播放；仅当明确需要登录态/站点强限制时，才使用 `openMode=webview`。
- `Video*` 的 `src` 必须是可播放直链（YouTube watch/shorts/youtu.be、B站 video/BV、TikTok video）；禁止使用 `results?search_query=`、频道页、主页链接。
- 图表组件要求 `data` 为对象数组；字段名保持稳定，不要一行一个不同 key。
- 占比优先 `PieChartCard`，趋势优先 `LineChartCard`/`AreaChartCard`，类别对比优先 `BarChartCard`，多维评分优先 `RadarChartCard`。
- 如果只有 1~2 个数字，不强制出图；若是多项/多时段数据，优先图表而不是长 Markdown 列表。
- 非 App 环境（纯 Web）不显示 MPV 操作入口，避免无效调用。
- 需要发送视频到输入框时，使用组件动作回填（默认 `insert_video`）。

### 流媒体站点输出规范（强制）

- YouTube：优先 `VideoCover`/`VideoGallery`，`kind=stream`，`src` 使用原始 `watch` 或 `youtu.be` 链接。
- Bilibili：优先 `VideoCover`/`VideoGallery`，`kind=stream`，`src` 使用完整 `https://www.bilibili.com/video/BV...` 链接。
- TikTok：优先 `VideoCover`/`VideoGallery`，`kind=stream`，`src` 使用完整 `https://www.tiktok.com/.../video/...` 链接。
- 回答中若提供了这些链接，必须同步给出视频卡片，不得仅给文本和 `OptionSelector`。
- 需要登录态或站点限制明显时，可同时给一个 `WebViewCard` 作为备用打开方式。

### 视频输出最小模板（推荐）

- 单视频：`VideoCover` + `src` + `kind="stream"` + `openMode="dialog"` + `title` + `duration`。
- 播放列表：`VideoGallery` + `videos[]`（每项至少包含 `src/title`，可补 `duration/poster`）。
- 若尾部需要下一步交互，再追加 `OptionSelector`，不要用它替代视频卡片本体。

## WebView 规则

- `url` 模式：用于打开外部网站，卡片展示站点预览信息，点击进入弹窗无头浏览。
- `html` 模式：用于渲染 AI 返回的 HTML 片段或 `div` 结构，弹窗中通过 `srcDoc` 渲染。
- 当 `url` 与 `html` 同时存在时，优先按 `url` 模式处理。
- 非 App 环境下，URL 模式仍可弹窗 iframe 渲染；若站点禁止嵌入，用户可走“当前浏览器打开”。

## 音频规则

- 本地音频支持：`file:///`、Windows 路径、Unix 绝对路径。
- 网络音频支持：`http(s)` 直链（如 mp3/aac/ogg/wav）与流媒体地址（如 m3u8/radio/fm）。
- `live=true` 或可识别为流媒体时，组件按直播模式显示（无固定总时长）。
- 桌面 App 优先保障长时流媒体稳定播放，可使用 MPV 外部播放；网页端以内置 `<audio>` 为主。

## Markdown 预览规则

- 当传入 `filePath/path/file` 时，优先从本地读取 Markdown 文件内容。
- 当传入 `markdown/content/text` 时，按内联内容直接渲染。
- 若同时传入文件路径与内联内容，优先使用内联内容。
- 预览为只读展示，不提供编辑能力；仅提供“另存为”落地文件。
- Web 端不支持本地文件读取；但支持内联 markdown 预览与浏览器下载保存。

## 组件选择策略

- 单图优先 `ImageCover`；多图瀑布/网格优先 `ImageAlbum`；连续浏览优先 `ImageCarousel`。
- 单视频优先 `VideoCover`；多视频列表优先 `VideoGallery`；连续浏览优先 `VideoCarousel`。
- `ComfyUIImageCard` / `ComfyUIVideoCard` 只用于组件执行与结果回填，不是普通图片/视频展示卡。
- 使用 `ComfyUIImageCard` / `ComfyUIVideoCard` 时，`props.componentName` 必填；已识别参数统一放到 `props.initialValues`。
- 若只有 `prompt/width/height/count` 这类生成请求参数，没有真实媒体结果，就不要输出 `ComfyUIImageCard` / `ComfyUIVideoCard`。
- 已拿到图片结果时，优先用 `ImageCover` / `ImageAlbum` / `ImageCarousel` 直接展示。
- 数据可视化优先：占比=`PieChartCard`，对比=`BarChartCard`，趋势=`LineChartCard/AreaChartCard`，多维=`RadarChartCard`；不确定时用 `ChartCard + chartType`。
- 网页预览或 HTML 片段优先 `WebViewCard`。
- 单条语音/音乐优先 `AudioPlayer`；多条节目列表优先 `AudioPlaylist`。
- 文档类结果（Markdown）优先 `MarkdownPreviewCard`。
- 办公文档（docx/xlsx/pdf/pptx）优先 `OfficePreviewCard`。
- 需要用户从若干后续路径中选择时，优先 `OptionSelector`。
- 若答案结尾存在“请回复 1/2/3”倾向，应改写为 `OptionSelector` 按钮交互。
- 先保证信息可读与交互可达，再考虑复杂布局。
- 当组件无法确定可渲染时，降级为文本描述，不输出无效 UI_JSON。
- 性能上限：单条回复最多 `1` 个图片组件 + `1` 个视频组件；图片最多 `10` 张，视频最多 `6` 条。
- 若候选素材很多，先展示前几项，并用 `OptionSelector` 给出“查看更多/下一页”入口，不要一次性塞满。

## 图表 UI_JSON 示例区（可直接复用）

### 1) 销量对比（BarChartCard）

<UI_JSON>
{"type":"BarChartCard","props":{"title":"各城市本周销量对比","description":"单位：件","xKey":"city","series":[{"key":"sales","label":"销量","color":"#2563eb"}],"data":[{"city":"上海","sales":1320},{"city":"北京","sales":1180},{"city":"深圳","sales":1095},{"city":"杭州","sales":940}],"height":280,"showLegend":true,"showGrid":true}}
</UI_JSON>

### 2) 趋势变化（LineChartCard）

<UI_JSON>
{"type":"LineChartCard","props":{"title":"近7日活跃用户趋势","description":"单位：人","xKey":"date","series":[{"key":"dau","label":"DAU","color":"#22c55e"}],"data":[{"date":"03-01","dau":1200},{"date":"03-02","dau":1325},{"date":"03-03","dau":1288},{"date":"03-04","dau":1410},{"date":"03-05","dau":1496},{"date":"03-06","dau":1530},{"date":"03-07","dau":1612}],"height":280,"showLegend":true,"showGrid":true}}
</UI_JSON>

### 3) 占比构成（PieChartCard）

<UI_JSON>
{"type":"PieChartCard","props":{"title":"渠道来源占比","description":"本月新增用户","data":[{"name":"自然搜索","value":42,"color":"#2563eb"},{"name":"广告投放","value":28,"color":"#f97316"},{"name":"社媒引流","value":18,"color":"#22c55e"},{"name":"老客转介绍","value":12,"color":"#a855f7"}],"dataKey":"value","nameKey":"name","innerRadius":58,"outerRadius":96,"height":300,"showLegend":true}}
</UI_JSON>

### 4) 雷达评估（RadarChartCard）

<UI_JSON>
{"type":"RadarChartCard","props":{"title":"模型能力雷达评估","description":"满分 100","xKey":"metric","series":[{"key":"score","label":"评分","color":"#06b6d4"}],"data":[{"metric":"推理","score":88},{"metric":"编码","score":93},{"metric":"多轮对话","score":85},{"metric":"工具调用","score":90},{"metric":"稳定性","score":87}],"height":320,"showLegend":true}}
</UI_JSON>
