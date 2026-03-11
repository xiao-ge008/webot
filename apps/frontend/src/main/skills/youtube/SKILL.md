---
name: youtube
description: YouTube 搜索和播放
---

# YouTube 搜索播放

## 🎯 适用场景

1. 用户要求搜索/观看 YouTube 视频
2. 播放音乐视频
3. 查找教程或学习内容

## 🔧 核心工具

| 工具 | 用途 |
|------|------|
| `youtube_search_videos` | 搜索视频 |
| `youtube_play` | 网页播放（推荐） |
| `youtube_open` | 本地播放器播放 |
| `youtube_download` | 下载视频 |

## 📋 使用流程

### 搜索视频

```json
{
  "tool": "mcp_hub_call",
  "arguments": {
    "server_id": "youtube",
    "tool": "youtube_search_videos",
    "args": {"query": "猫咪视频", "maxResults": 5}
  }
}
```

### 播放视频

```json
{
  "tool": "mcp_hub_call",
  "arguments": {
    "server_id": "youtube",
    "tool": "youtube_play",
    "args": {"videoId": "xxx"}
  }
}
```

## ⚠️ 注意事项

- 需配置 `YOUTUBE_API_KEY` 环境变量
- `youtube_open` 需要本地安装 mpv/vlc/potplayer
