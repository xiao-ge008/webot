# UI Skill

## 加载规则

- 仅当会话支持 GUI / App / Web / json-render 时加载本技能。
- 若宿主声明 `channel=gui|desktop|app|web` 或 `renderMode=gui|json-render`，视为可用。
- 非 GUI 终端禁止输出 `<UI_JSON>`，仅输出纯 Markdown。

## 输出协议（强制）

- 仅允许两种格式：
  - A) 纯 Markdown：整条消息不含 `<UI_JSON>`。
  - B) 混合 UI：先 Markdown（可空），后一个或多个 `<UI_JSON>...</UI_JSON>`，每块仅一个合法 JSON 对象。
- 禁止输出其他协议内容（`<tool_call>`、XML、YAML、注释 JSON、未闭合标签等）。

## 组件分层

- 业务内置组件（优先）：`ImageCover`、`ImageAlbum`、`ImageCarousel`、`VideoCover`、`VideoGallery`、`VideoCarousel`、`WebViewCard`、`AudioPlayer`、`AudioPlaylist`、`MarkdownPreviewCard`、`OfficePreviewCard`、`OptionSelector`。
- 数据图表内置组件：`ChartCard`、`PieChartCard`、`BarChartCard`、`LineChartCard`、`AreaChartCard`、`RadarChartCard`。
- 通用基础组件（json-render/shadcn，36个）：`Card`、`Stack`、`Grid`、`Separator`、`Tabs`、`Accordion`、`Collapsible`、`Dialog`、`Drawer`、`Carousel`、`Table`、`Heading`、`Text`、`Image`、`Avatar`、`Badge`、`Alert`、`Progress`、`Skeleton`、`Spinner`、`Tooltip`、`Popover`、`Input`、`Textarea`、`Select`、`Checkbox`、`Radio`、`Switch`、`Slider`、`Button`、`Link`、`DropdownMenu`、`Toggle`、`ToggleGroup`、`ButtonGroup`、`Pagination`。

## 类型命名规范（避免渲染失败）

- 优先使用正式名（PascalCase），不要随意新造 `type`。
- 兼容别名：`video`/`videocover`/`videogallery`/`videocarousel`、`optionselector`/`option_selector`/`option.selector`、`chart`/`pie_chart`/`bar_chart`/`line_chart`/`area_chart`/`radar_chart`。

## 交互与媒体规则

- 需要用户选择下一步时，优先 `OptionSelector`，不要让用户输入“1/2/3”。
- `OptionSelector` 的 `prompt` 必须是完整可执行指令句，不用占位词。
- `ComfyUIImageCard` / `ComfyUIVideoCard` 是组件执行卡，不是普通媒体展示卡。
- 只有明确知道组件英文名时，才允许输出 `ComfyUIImageCard` / `ComfyUIVideoCard`，并且必须携带 `props.componentName`。
- 如果已经拿到了实际图片结果，优先用 `ImageCover` / `ImageAlbum` / `ImageCarousel` 展示，不要把 `prompt/width/height/count` 这类请求参数直接塞进 `ComfyUIImageCard`。
- 若没有真实可展示的 `src/url/path/images`，不要强行输出图片卡片，降级为 Markdown。
- 涉及“已打开视频/可播放/播放列表/点击播放”语义时，必须输出至少一个视频组件。
- `Video*` 的 `src` 必须可播放（YouTube watch/shorts/youtu.be，B站 BV/video，TikTok video）；不要输出搜索页链接。
- 遇到多项数据、时间序列、占比或评分对比时，优先输出图表组件，不要只给长 Markdown 列表。

## 性能上限

- 单条回复最多 `1` 个图片组件 + `1` 个视频组件。
- 图片最多 `10` 张，视频最多 `6` 条。
