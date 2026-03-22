use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::Path as AxumPath;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Digest;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::error::ApiError;
use crate::path_resolver;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const FLORENCE_PROVIDER: &str = "florence2";
const FLORENCE_MODEL_ID: &str = "laub/Florence-2-large-PromptGen-v2.0-onnx";
const LEGACY_FLORENCE_MODEL_ID: &str = "onnx-community/Florence-2-large-ft";
const FLORENCE_TASK_PROMPT: &str = "<MORE_DETAILED_CAPTION>";
const FLORENCE_VENDOR: &str = "laub";
const FLORENCE_REPO: &str = "Florence-2-large-PromptGen-v2.0-onnx";
const FLORENCE_RESOLVE_BASE: &str =
    "https://hf-mirror.com/laub/Florence-2-large-PromptGen-v2.0-onnx/resolve/main";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionAnalysisConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_model_id")]
    pub model_id: String,
    #[serde(default = "default_task_prompt")]
    pub task_prompt: String,
    #[serde(default = "default_cache_enabled")]
    pub cache_enabled: bool,
    #[serde(default = "default_auto_analyze_chat_images")]
    pub auto_analyze_chat_images: bool,
    #[serde(default = "default_auto_download_on_enable")]
    pub auto_download_on_enable: bool,
}

impl Default for VisionAnalysisConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: default_provider(),
            model_id: default_model_id(),
            task_prompt: default_task_prompt(),
            cache_enabled: default_cache_enabled(),
            auto_analyze_chat_images: default_auto_analyze_chat_images(),
            auto_download_on_enable: default_auto_download_on_enable(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionModelFileStatus {
    pub relative_path: String,
    pub expected_size: Option<u64>,
    pub present: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionAnalysisStatus {
    pub config: VisionAnalysisConfig,
    pub provider_available: bool,
    pub model_ready: bool,
    pub download_active: bool,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub progress_percent: f64,
    pub current_file: Option<String>,
    pub last_error: Option<String>,
    pub model_root_dir: String,
    pub model_dir: String,
    pub cache_dir: String,
    pub missing_files: Vec<String>,
    pub files: Vec<VisionModelFileStatus>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionCacheRecord {
    pub sha256: String,
    pub summary: String,
    pub mime_type: String,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub task_prompt: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub relative_path: Option<String>,
    #[serde(default)]
    pub saved_path: Option<String>,
    #[serde(default)]
    pub upstream_file_id: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertVisionCacheRequest {
    pub sha256: String,
    pub summary: String,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub task_prompt: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub relative_path: Option<String>,
    #[serde(default)]
    pub saved_path: Option<String>,
    #[serde(default)]
    pub upstream_file_id: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeVisionImageRequest {
    pub image_path: String,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub relative_path: Option<String>,
    #[serde(default)]
    pub saved_path: Option<String>,
    #[serde(default)]
    pub upstream_file_id: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub user_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeVisionImageResponse {
    pub sha256: String,
    pub summary: String,
    pub provider: String,
    pub model: String,
    pub task_prompt: String,
    pub mime_type: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub cached: bool,
}

#[derive(Debug, Clone, Default)]
struct VisionDownloadState {
    active: bool,
    downloaded_bytes: u64,
    total_bytes: u64,
    current_file: Option<String>,
    last_error: Option<String>,
    updated_at_ms: u64,
}

struct FlorenceSidecarProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FlorenceSidecarRequest {
    r#type: &'static str,
    request_id: String,
    model_id: String,
    model_root_dir: String,
    image_path: String,
    task_prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlorenceSidecarReadyResponse {
    r#type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlorenceSidecarResultResponse {
    r#type: String,
    request_id: String,
    summary: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VisionFocusMode {
    General,
    Clothing,
    Pose,
    Background,
    Face,
    Accessories,
    Prompt,
}

struct VisionFocusPlan {
    mode: VisionFocusMode,
    task_prompt: String,
    cacheable: bool,
}

#[derive(Debug, Clone, Copy)]
struct VisionModelFile {
    relative_path: &'static str,
    size_bytes: Option<u64>,
}

const FLORENCE_MODEL_FILES: &[VisionModelFile] = &[
    VisionModelFile {
        relative_path: "added_tokens.json",
        size_bytes: Some(22_410),
    },
    VisionModelFile {
        relative_path: "config.json",
        size_bytes: Some(3_828),
    },
    VisionModelFile {
        relative_path: "generation_config.json",
        size_bytes: Some(292),
    },
    VisionModelFile {
        relative_path: "merges.txt",
        size_bytes: Some(456_318),
    },
    VisionModelFile {
        relative_path: "preprocessor_config.json",
        size_bytes: Some(603),
    },
    VisionModelFile {
        relative_path: "special_tokens_map.json",
        size_bytes: Some(146_627),
    },
    VisionModelFile {
        relative_path: "tokenizer.json",
        size_bytes: Some(2_297_961),
    },
    VisionModelFile {
        relative_path: "tokenizer_config.json",
        size_bytes: Some(197_658),
    },
    VisionModelFile {
        relative_path: "vocab.json",
        size_bytes: Some(798_293),
    },
    VisionModelFile {
        relative_path: "onnx/decoder_model.onnx",
        size_bytes: Some(387_995_899),
    },
    VisionModelFile {
        relative_path: "onnx/decoder_model_merged.onnx",
        size_bytes: Some(388_209_807),
    },
    VisionModelFile {
        relative_path: "onnx/decoder_with_past_model.onnx",
        size_bytes: Some(359_626_414),
    },
    VisionModelFile {
        relative_path: "onnx/embed_tokens.onnx",
        size_bytes: Some(157_560_044),
    },
    VisionModelFile {
        relative_path: "onnx/encoder_model.onnx",
        size_bytes: Some(173_380_907),
    },
    VisionModelFile {
        relative_path: "onnx/vision_encoder.onnx",
        size_bytes: Some(366_564_017),
    },
];

fn default_provider() -> String {
    FLORENCE_PROVIDER.to_string()
}

fn default_model_id() -> String {
    FLORENCE_MODEL_ID.to_string()
}

fn default_task_prompt() -> String {
    FLORENCE_TASK_PROMPT.to_string()
}

fn default_cache_enabled() -> bool {
    true
}

fn default_auto_analyze_chat_images() -> bool {
    true
}

fn default_auto_download_on_enable() -> bool {
    true
}

fn internal_error(message: String) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message)
}

fn download_state() -> &'static Mutex<VisionDownloadState> {
    static DOWNLOAD_STATE: OnceLock<Mutex<VisionDownloadState>> = OnceLock::new();
    DOWNLOAD_STATE.get_or_init(|| Mutex::new(VisionDownloadState::default()))
}

fn florence_sidecar_state() -> &'static Mutex<Option<FlorenceSidecarProcess>> {
    static FLORENCE_SIDECAR_STATE: OnceLock<Mutex<Option<FlorenceSidecarProcess>>> =
        OnceLock::new();
    FLORENCE_SIDECAR_STATE.get_or_init(|| Mutex::new(None))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_focus_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn text_contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn resolve_focus_plan(user_text: &str, default_task_prompt: &str) -> VisionFocusPlan {
    let normalized = normalize_focus_text(user_text).to_ascii_lowercase();
    if normalized.is_empty() {
        return VisionFocusPlan {
            mode: VisionFocusMode::General,
            task_prompt: default_task_prompt.to_string(),
            cacheable: true,
        };
    }

    if text_contains_any(
        &normalized,
        &["提示词", "prompt", "tag", "标签", "生图", "改图", "复现", "同款"],
    ) {
        return VisionFocusPlan {
            mode: VisionFocusMode::Prompt,
            task_prompt: "<MIXED_CAPTION_PLUS>".to_string(),
            cacheable: false,
        };
    }

    if text_contains_any(
        &normalized,
        &["背景", "布景", "场景", "环境", "构图", "机位", "镜头", "光影"],
    ) {
        return VisionFocusPlan {
            mode: VisionFocusMode::Background,
            task_prompt: "<ANALYZE>".to_string(),
            cacheable: false,
        };
    }

    let mode = if text_contains_any(
        &normalized,
        &[
            "衣服", "穿搭", "服装", "裙", "丝袜", "鞋", "高跟", "内衣", "胸衣", "领结", "外套",
            "材质", "蕾丝", "丝绒", "裙子", "上衣", "下装", "dress", "outfit", "clothing",
            "clothes", "stocking", "heels", "shoe", "shirt", "skirt", "lace",
        ],
    ) {
        VisionFocusMode::Clothing
    } else if text_contains_any(
        &normalized,
        &[
            "姿势", "动作", "体态", "站姿", "坐姿", "跪姿", "pose", "posture", "standing",
            "sitting", "kneeling", "arms", "legs",
        ],
    ) {
        VisionFocusMode::Pose
    } else if text_contains_any(
        &normalized,
        &[
            "脸", "表情", "发型", "头发", "眼睛", "五官", "face", "expression", "hair",
            "eyes",
        ],
    ) {
        VisionFocusMode::Face
    } else if text_contains_any(
        &normalized,
        &[
            "配饰", "饰品", "项链", "耳环", "耳坠", "手套", "项圈", "首饰", "accessory",
            "necklace", "earring", "collar", "jewelry",
        ],
    ) {
        VisionFocusMode::Accessories
    } else {
        VisionFocusMode::General
    };

    VisionFocusPlan {
        mode,
        task_prompt: default_task_prompt.to_string(),
        cacheable: true,
    }
}

fn focus_mode_label(mode: VisionFocusMode) -> Option<&'static str> {
    match mode {
        VisionFocusMode::General => None,
        VisionFocusMode::Clothing => Some("衣服与穿搭"),
        VisionFocusMode::Pose => Some("姿势与动作"),
        VisionFocusMode::Background => Some("背景与构图"),
        VisionFocusMode::Face => Some("面部与发型"),
        VisionFocusMode::Accessories => Some("配饰细节"),
        VisionFocusMode::Prompt => Some("提示词与可复现要素"),
    }
}

fn focus_mode_keywords(mode: VisionFocusMode) -> &'static [&'static str] {
    match mode {
        VisionFocusMode::General => &[],
        VisionFocusMode::Clothing => &[
            "dress", "outfit", "clothing", "clothes", "shirt", "skirt", "gown", "nightgown",
            "nightdress", "lace", "velvet", "stocking", "stockings", "heels", "shoe", "bra",
            "lingerie", "collar", "tie", "ribbon", "sleeve", "boots", "丝袜", "鞋", "裙",
            "衣", "蕾丝", "丝绒", "领结", "项圈",
        ],
        VisionFocusMode::Pose => &[
            "pose", "posture", "standing", "sitting", "kneeling", "arms", "legs", "barefoot",
            "lying", "looking", "跪", "站", "坐", "姿", "动作", "手", "腿",
        ],
        VisionFocusMode::Background => &[
            "background", "bedroom", "bed", "room", "wall", "lighting", "camera", "angle",
            "composition", "palette", "atmosphere", "背景", "床", "房间", "构图", "镜头",
        ],
        VisionFocusMode::Face => &[
            "face", "eyes", "hair", "smile", "expression", "mouth", "blush", "五官", "头发",
            "眼", "表情", "脸",
        ],
        VisionFocusMode::Accessories => &[
            "necklace", "earring", "collar", "jewelry", "ring", "bracelet", "配饰", "项链",
            "耳环", "项圈", "首饰",
        ],
        VisionFocusMode::Prompt => &[
            "1girl", "solo", "camera_angle", "art_style", "background", "dress", "outfit",
            "style", "lighting",
        ],
    }
}

fn extract_focus_segments(summary: &str, mode: VisionFocusMode) -> Option<String> {
    let keywords = focus_mode_keywords(mode);
    if keywords.is_empty() {
        return None;
    }
    let segments = summary
        .split(|ch| matches!(ch, '\n' | '\r' | ',' | '，' | ';' | '；' | '.' | '。'))
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .filter(|item| {
            let item_normalized = item.to_ascii_lowercase();
            keywords
                .iter()
                .any(|keyword| item_normalized.contains(keyword))
        })
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return None;
    }
    let joined = segments.join("；");
    if joined.len() < 12 {
        None
    } else {
        Some(joined)
    }
}

fn build_presented_summary(summary: &str, user_text: &str, mode: VisionFocusMode) -> String {
    let normalized_summary = summary.trim();
    let normalized_user_text = normalize_focus_text(user_text);
    if normalized_user_text.is_empty() {
        return normalized_summary.to_string();
    }

    if let Some(label) = focus_mode_label(mode) {
        if let Some(focused) = extract_focus_segments(normalized_summary, mode) {
            return [
                "本地视觉已按本轮要求完成聚焦。".to_string(),
                format!("用户要求：{normalized_user_text}"),
                format!("关注维度：{label}"),
                format!("结果：{focused}"),
            ]
            .join("\n");
        }
        return [
            "本地视觉已按本轮要求完成聚焦。".to_string(),
            format!("用户要求：{normalized_user_text}"),
            format!("关注维度：{label}"),
            format!("结果：{normalized_summary}"),
        ]
        .join("\n");
    }

    [
        "本地视觉结果已结合本轮用户要求。".to_string(),
        format!("用户要求：{normalized_user_text}"),
        format!("结果：{normalized_summary}"),
    ]
    .join("\n")
}

fn normalize_model_id(model_id: &str) -> String {
    let trimmed = model_id.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case(LEGACY_FLORENCE_MODEL_ID) {
        FLORENCE_MODEL_ID.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_config(config: &mut VisionAnalysisConfig) {
    config.provider = if config.provider.trim().is_empty() {
        FLORENCE_PROVIDER.to_string()
    } else {
        config.provider.trim().to_ascii_lowercase()
    };
    config.model_id = normalize_model_id(&config.model_id);
    config.task_prompt = if config.task_prompt.trim().is_empty() {
        FLORENCE_TASK_PROMPT.to_string()
    } else {
        config.task_prompt.trim().to_string()
    };
}

fn vision_analysis_config_path() -> Result<PathBuf, String> {
    Ok(path_resolver::openfang_runtime_home_dir()?.join("vision-analysis.json"))
}

fn vision_model_root_dir() -> Result<PathBuf, String> {
    Ok(path_resolver::webot_home_dir()?
        .join("shared")
        .join("models")
        .join("vision"))
}

fn vision_model_dir() -> Result<PathBuf, String> {
    Ok(vision_model_root_dir()?
        .join(FLORENCE_VENDOR)
        .join(FLORENCE_REPO))
}

fn vision_cache_dir() -> Result<PathBuf, String> {
    Ok(path_resolver::webot_home_dir()?
        .join("shared")
        .join("data")
        .join("vision-cache"))
}

fn vision_cache_path(sha256: &str) -> Result<PathBuf, String> {
    Ok(vision_cache_dir()?.join(format!("{sha256}.json")))
}

fn florence_sidecar_script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("florence2-local-server.mjs")
}

fn guess_image_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn read_cached_record(sha256: &str) -> Result<Option<VisionCacheRecord>, String> {
    let path = vision_cache_path(sha256)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|err| format!("读取视觉缓存失败({}): {err}", path.display()))?;
    let record = serde_json::from_str::<VisionCacheRecord>(&content)
        .map_err(|err| format!("解析视觉缓存失败({}): {err}", path.display()))?;
    Ok(Some(record))
}

fn read_vision_analysis_config() -> Result<VisionAnalysisConfig, String> {
    let path = vision_analysis_config_path()?;
    if !path.exists() {
        return Ok(VisionAnalysisConfig::default());
    }
    let content =
        fs::read_to_string(&path).map_err(|err| format!("读取视觉分析配置失败: {err}"))?;
    let mut config = serde_json::from_str::<VisionAnalysisConfig>(&content)
        .map_err(|err| format!("解析视觉分析配置失败: {err}"))?;
    normalize_config(&mut config);
    Ok(config)
}

fn write_vision_analysis_config(
    mut config: VisionAnalysisConfig,
) -> Result<VisionAnalysisConfig, String> {
    normalize_config(&mut config);
    let path = vision_analysis_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建视觉分析配置目录失败: {err}"))?;
    }
    let content = serde_json::to_string_pretty(&config)
        .map_err(|err| format!("序列化视觉分析配置失败: {err}"))?;
    fs::write(&path, content).map_err(|err| format!("写入视觉分析配置失败: {err}"))?;
    Ok(config)
}

fn write_vision_cache_record(
    payload: UpsertVisionCacheRequest,
) -> Result<VisionCacheRecord, String> {
    let sha256 = payload.sha256.trim().to_ascii_lowercase();
    if !is_hex_sha256(&sha256) {
        return Err("sha256 无效，必须是 64 位十六进制字符串".to_string());
    }

    let summary = payload.summary.trim().to_string();
    if summary.is_empty() {
        return Err("summary 不能为空".to_string());
    }

    let cache_dir = vision_cache_dir()?;
    fs::create_dir_all(&cache_dir).map_err(|err| format!("创建视觉缓存目录失败: {err}"))?;

    let path = vision_cache_path(&sha256)?;
    let existing = read_cached_record(&sha256)?;
    let now = now_ms();
    let record = VisionCacheRecord {
        sha256,
        summary,
        mime_type: if payload.mime_type.trim().is_empty() {
            "image/jpeg".to_string()
        } else {
            payload.mime_type.trim().to_string()
        },
        provider: if payload.provider.trim().is_empty() {
            FLORENCE_PROVIDER.to_string()
        } else {
            payload.provider.trim().to_string()
        },
        model: if payload.model.trim().is_empty() {
            FLORENCE_MODEL_ID.to_string()
        } else {
            payload.model.trim().to_string()
        },
        task_prompt: if payload.task_prompt.trim().is_empty() {
            FLORENCE_TASK_PROMPT.to_string()
        } else {
            payload.task_prompt.trim().to_string()
        },
        source: if payload.source.trim().is_empty() {
            "frontend".to_string()
        } else {
            payload.source.trim().to_string()
        },
        width: payload.width,
        height: payload.height,
        relative_path: payload
            .relative_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        saved_path: payload
            .saved_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        upstream_file_id: payload
            .upstream_file_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        file_name: payload
            .file_name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        created_at_ms: existing
            .as_ref()
            .map(|item| item.created_at_ms)
            .unwrap_or(now),
        updated_at_ms: now,
    };

    let content = serde_json::to_string_pretty(&record)
        .map_err(|err| format!("序列化视觉缓存失败: {err}"))?;
    fs::write(&path, content)
        .map_err(|err| format!("写入视觉缓存失败({}): {err}", path.display()))?;
    Ok(record)
}

async fn spawn_florence_sidecar() -> Result<FlorenceSidecarProcess, String> {
    let script_path = florence_sidecar_script_path();
    if !script_path.is_file() {
        return Err(format!(
            "Florence-2 本地服务脚本不存在: {}",
            script_path.display()
        ));
    }

    let mut command = Command::new("node");
    command.arg(&script_path);
    command.current_dir(env!("CARGO_MANIFEST_DIR"));
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|err| format!("启动 Florence-2 本地服务失败: {err}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or("启动 Florence-2 本地服务失败: stdin 不可用")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("启动 Florence-2 本地服务失败: stdout 不可用")?;
    let mut stdout = BufReader::new(stdout);
    let mut line = String::new();
    let bytes = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        stdout.read_line(&mut line),
    )
    .await
    .map_err(|_| "等待 Florence-2 本地服务启动超时".to_string())?
    .map_err(|err| format!("读取 Florence-2 本地服务启动消息失败: {err}"))?;
    if bytes == 0 {
        return Err("Florence-2 本地服务启动后立即退出".to_string());
    }
    let ready = serde_json::from_str::<FlorenceSidecarReadyResponse>(line.trim())
        .map_err(|err| format!("解析 Florence-2 本地服务启动消息失败: {err}"))?;
    if ready.r#type != "ready" {
        return Err(format!("Florence-2 本地服务启动响应非法: {}", ready.r#type));
    }

    Ok(FlorenceSidecarProcess {
        child,
        stdin,
        stdout,
    })
}

async fn ensure_florence_sidecar_running(
    state: &mut Option<FlorenceSidecarProcess>,
) -> Result<&mut FlorenceSidecarProcess, String> {
    let should_spawn = match state.as_mut() {
        Some(process) => process
            .child
            .try_wait()
            .map_err(|err| format!("检查 Florence-2 本地服务状态失败: {err}"))?
            .is_some(),
        None => true,
    };
    if should_spawn {
        *state = Some(spawn_florence_sidecar().await?);
    }
    state
        .as_mut()
        .ok_or("Florence-2 本地服务状态异常".to_string())
}

async fn analyze_with_florence_sidecar(
    image_path: &Path,
    model_id: &str,
    task_prompt: &str,
) -> Result<FlorenceSidecarResultResponse, String> {
    let model_root_dir = vision_model_root_dir()?;
    let request = FlorenceSidecarRequest {
        r#type: "analyze",
        request_id: format!("vision_{}", now_ms()),
        model_id: model_id.to_string(),
        model_root_dir: model_root_dir.to_string_lossy().to_string(),
        image_path: image_path.to_string_lossy().to_string(),
        task_prompt: task_prompt.to_string(),
    };
    let request_json = serde_json::to_string(&request)
        .map_err(|err| format!("序列化 Florence-2 请求失败: {err}"))?;

    let mut attempts = 0u8;
    loop {
        attempts = attempts.saturating_add(1);
        let mut guard = florence_sidecar_state().lock().await;
        let process = ensure_florence_sidecar_running(&mut guard).await?;
        process
            .stdin
            .write_all(request_json.as_bytes())
            .await
            .map_err(|err| format!("向 Florence-2 本地服务发送请求失败: {err}"))?;
        process
            .stdin
            .write_all(b"\n")
            .await
            .map_err(|err| format!("向 Florence-2 本地服务发送换行失败: {err}"))?;
        process
            .stdin
            .flush()
            .await
            .map_err(|err| format!("刷新 Florence-2 本地服务请求失败: {err}"))?;

        let mut line = String::new();
        let bytes = process
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|err| format!("读取 Florence-2 本地服务响应失败: {err}"))?;
        if bytes == 0 {
            *guard = None;
            if attempts < 2 {
                continue;
            }
            return Err("Florence-2 本地服务已退出".to_string());
        }

        let response = serde_json::from_str::<FlorenceSidecarResultResponse>(line.trim())
            .map_err(|err| format!("解析 Florence-2 本地服务响应失败: {err}"))?;
        if response.request_id != request.request_id {
            *guard = None;
            if attempts < 2 {
                continue;
            }
            return Err("Florence-2 本地服务响应 requestId 不匹配".to_string());
        }
        if response.r#type == "error" {
            return Err(response
                .error
                .unwrap_or_else(|| "Florence-2 本地服务返回错误".to_string()));
        }
        if response.r#type != "result" {
            return Err(format!(
                "Florence-2 本地服务返回未知响应类型: {}",
                response.r#type
            ));
        }
        return Ok(response);
    }
}

fn is_hex_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|item| item.is_ascii_hexdigit())
}

fn model_file_download_url(relative_path: &str) -> String {
    format!("{FLORENCE_RESOLVE_BASE}/{relative_path}?download=1")
}

fn compute_model_status(
    config: VisionAnalysisConfig,
    state: &VisionDownloadState,
) -> VisionAnalysisStatus {
    let model_root = vision_model_root_dir().unwrap_or_else(|_| PathBuf::from("."));
    let model_dir =
        vision_model_dir().unwrap_or_else(|_| model_root.join(FLORENCE_VENDOR).join(FLORENCE_REPO));
    let cache_dir = vision_cache_dir().unwrap_or_else(|_| PathBuf::from("."));

    let files = FLORENCE_MODEL_FILES
        .iter()
        .map(|item| {
            let path = model_dir.join(item.relative_path);
            let metadata = fs::metadata(&path).ok();
            VisionModelFileStatus {
                relative_path: item.relative_path.to_string(),
                expected_size: item.size_bytes,
                present: metadata.is_some(),
                size: metadata.map(|row| row.len()),
            }
        })
        .collect::<Vec<_>>();
    let missing_files = files
        .iter()
        .filter(|item| !item.present)
        .map(|item| item.relative_path.clone())
        .collect::<Vec<_>>();
    let provider_available = config.enabled && config.provider == FLORENCE_PROVIDER;
    let model_ready = provider_available && missing_files.is_empty();

    let total_bytes = state.total_bytes.max(
        FLORENCE_MODEL_FILES
            .iter()
            .filter_map(|item| item.size_bytes)
            .sum::<u64>(),
    );
    let downloaded_bytes = state.downloaded_bytes.min(total_bytes);
    let progress_percent = if total_bytes == 0 {
        if model_ready {
            100.0
        } else {
            0.0
        }
    } else {
        ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    };

    VisionAnalysisStatus {
        config,
        provider_available,
        model_ready,
        download_active: state.active,
        downloaded_bytes: if model_ready && !state.active {
            total_bytes
        } else {
            downloaded_bytes
        },
        total_bytes,
        progress_percent,
        current_file: state.current_file.clone(),
        last_error: state.last_error.clone(),
        model_root_dir: model_root.to_string_lossy().to_string(),
        model_dir: model_dir.to_string_lossy().to_string(),
        cache_dir: cache_dir.to_string_lossy().to_string(),
        missing_files,
        files,
        updated_at_ms: state.updated_at_ms,
    }
}

async fn refresh_status() -> Result<VisionAnalysisStatus, String> {
    let config = read_vision_analysis_config()?;
    let state = download_state().lock().await.clone();
    Ok(compute_model_status(config, &state))
}

async fn set_download_state(
    active: bool,
    downloaded_bytes: u64,
    total_bytes: u64,
    current_file: Option<String>,
    last_error: Option<String>,
) {
    let mut guard = download_state().lock().await;
    guard.active = active;
    guard.downloaded_bytes = downloaded_bytes;
    guard.total_bytes = total_bytes;
    guard.current_file = current_file;
    guard.last_error = last_error;
    guard.updated_at_ms = now_ms();
}

async fn download_model_files() -> Result<(), String> {
    let model_dir = vision_model_dir()?;
    fs::create_dir_all(&model_dir).map_err(|err| format!("创建视觉模型目录失败: {err}"))?;

    let total_bytes = FLORENCE_MODEL_FILES
        .iter()
        .filter_map(|item| item.size_bytes)
        .sum::<u64>();
    let mut completed_bytes = 0u64;
    for item in FLORENCE_MODEL_FILES {
        let target = model_dir.join(item.relative_path);
        if let Ok(metadata) = fs::metadata(&target) {
            completed_bytes = completed_bytes.saturating_add(metadata.len());
        }
    }
    set_download_state(true, completed_bytes, total_bytes, None, None).await;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|err| format!("创建视觉模型下载客户端失败: {err}"))?;

    for item in FLORENCE_MODEL_FILES {
        let target = model_dir.join(item.relative_path);
        if target.is_file() {
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("创建视觉模型子目录失败({}): {err}", parent.display()))?;
        }

        let temp = target.with_extension("download");
        let url = model_file_download_url(item.relative_path);
        set_download_state(
            true,
            completed_bytes,
            total_bytes,
            Some(item.relative_path.to_string()),
            None,
        )
        .await;

        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|err| format!("下载视觉模型文件失败({}): {err}", item.relative_path))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "下载视觉模型文件失败({}): HTTP {} {}",
                item.relative_path, status, body
            ));
        }

        let mut file = tokio::fs::File::create(&temp)
            .await
            .map_err(|err| format!("创建临时模型文件失败({}): {err}", temp.display()))?;
        let mut stream = response.bytes_stream();
        let mut file_written = 0u64;
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result
                .map_err(|err| format!("写入视觉模型文件失败({}): {err}", item.relative_path))?;
            file.write_all(&chunk)
                .await
                .map_err(|err| format!("写入视觉模型文件失败({}): {err}", item.relative_path))?;
            file_written = file_written.saturating_add(chunk.len() as u64);
            set_download_state(
                true,
                completed_bytes.saturating_add(file_written),
                total_bytes,
                Some(item.relative_path.to_string()),
                None,
            )
            .await;
        }
        file.flush()
            .await
            .map_err(|err| format!("刷新视觉模型文件失败({}): {err}", item.relative_path))?;

        if target.exists() {
            let _ = fs::remove_file(&target);
        }
        fs::rename(&temp, &target).map_err(|err| {
            format!(
                "保存视觉模型文件失败({} -> {}): {err}",
                temp.display(),
                target.display()
            )
        })?;
        completed_bytes = completed_bytes.saturating_add(file_written);
    }

    set_download_state(false, total_bytes, total_bytes, None, None).await;
    Ok(())
}

fn guess_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or_default()
    {
        "json" => "application/json; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        "onnx" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

pub async fn get_vision_analysis_config() -> Result<Json<Value>, ApiError> {
    let config = read_vision_analysis_config().map_err(internal_error)?;
    Ok(Json(json!({ "config": config })))
}

pub async fn set_vision_analysis_config(
    Json(payload): Json<VisionAnalysisConfig>,
) -> Result<Json<Value>, ApiError> {
    let config = write_vision_analysis_config(payload).map_err(internal_error)?;
    Ok(Json(json!({ "config": config })))
}

pub async fn get_vision_analysis_status() -> Result<Json<Value>, ApiError> {
    let status = refresh_status().await.map_err(internal_error)?;
    Ok(Json(json!({ "status": status })))
}

pub async fn start_vision_analysis_download() -> Result<Json<Value>, ApiError> {
    let status = refresh_status().await.map_err(internal_error)?;
    if status.model_ready {
        return Ok(Json(json!({ "status": status })));
    }

    {
        let guard = download_state().lock().await;
        if guard.active {
            return Ok(Json(
                json!({ "status": compute_model_status(status.config, &guard) }),
            ));
        }
    }

    let config = status.config.clone();
    tokio::spawn(async move {
        if let Err(err) = download_model_files().await {
            set_download_state(false, 0, 0, None, Some(err)).await;
        } else {
            let _ = write_vision_analysis_config(config);
        }
    });

    let next = refresh_status().await.map_err(internal_error)?;
    Ok(Json(json!({ "status": next })))
}

pub async fn analyze_vision_image(
    Json(payload): Json<AnalyzeVisionImageRequest>,
) -> Result<Json<Value>, ApiError> {
    let status = refresh_status().await.map_err(internal_error)?;
    if !status.config.enabled || status.config.provider != FLORENCE_PROVIDER {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "本地 Florence-2 视觉未启用",
        ));
    }
    if !status.model_ready {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Florence-2 模型尚未就绪",
        ));
    }

    let image_path = payload.image_path.trim();
    if image_path.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "imagePath 不能为空"));
    }

    let path = PathBuf::from(image_path);
    if !path.is_absolute() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "imagePath 必须是本地绝对路径",
        ));
    }
    if !path.is_file() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            format!("图片文件不存在: {}", path.display()),
        ));
    }

    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|err| internal_error(format!("读取图片文件失败({}): {err}", path.display())))?;
    let focus_plan = resolve_focus_plan(&payload.user_text, &status.config.task_prompt);
    let sha256 = payload
        .sha256
        .as_deref()
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| is_hex_sha256(item))
        .unwrap_or_else(|| format!("{:x}", sha2::Sha256::digest(bytes.as_slice())));

    if status.config.cache_enabled && focus_plan.cacheable {
        if let Some(record) = read_cached_record(&sha256).map_err(internal_error)? {
            let response = AnalyzeVisionImageResponse {
                sha256: record.sha256,
                summary: build_presented_summary(
                    &record.summary,
                    &payload.user_text,
                    focus_plan.mode,
                ),
                provider: record.provider,
                model: record.model,
                task_prompt: record.task_prompt,
                mime_type: record.mime_type,
                width: record.width,
                height: record.height,
                cached: true,
            };
            return Ok(Json(json!({ "analysis": response })));
        }
    }

    let sidecar = analyze_with_florence_sidecar(
        &path,
        &status.config.model_id,
        &focus_plan.task_prompt,
    )
        .await
        .map_err(internal_error)?;
    let raw_summary = sidecar
        .summary
        .clone()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| internal_error("Florence-2 未返回可用摘要".to_string()))?;
    let presented_summary =
        build_presented_summary(&raw_summary, &payload.user_text, focus_plan.mode);
    let mime_type = if payload.mime_type.trim().is_empty() {
        guess_image_mime_type(&path).to_string()
    } else {
        payload.mime_type.trim().to_string()
    };
    let provider = sidecar
        .provider
        .clone()
        .unwrap_or_else(|| FLORENCE_PROVIDER.to_string());
    let model = sidecar
        .model
        .clone()
        .unwrap_or_else(|| status.config.model_id.clone());
    let response = if status.config.cache_enabled && focus_plan.cacheable {
        let record = write_vision_cache_record(UpsertVisionCacheRequest {
            sha256: sha256.clone(),
            summary: raw_summary.clone(),
            mime_type: mime_type.clone(),
            provider,
            model,
            task_prompt: focus_plan.task_prompt.clone(),
            source: if payload.source.trim().is_empty() {
                "service-rs".to_string()
            } else {
                payload.source.trim().to_string()
            },
            width: sidecar.width,
            height: sidecar.height,
            relative_path: payload.relative_path.clone(),
            saved_path: payload
                .saved_path
                .clone()
                .or_else(|| Some(path.to_string_lossy().to_string())),
            upstream_file_id: payload.upstream_file_id.clone(),
            file_name: payload.file_name.clone(),
        })
        .map_err(internal_error)?;
        AnalyzeVisionImageResponse {
            sha256: record.sha256,
            summary: build_presented_summary(
                &record.summary,
                &payload.user_text,
                focus_plan.mode,
            ),
            provider: record.provider,
            model: record.model,
            task_prompt: record.task_prompt,
            mime_type: record.mime_type,
            width: record.width,
            height: record.height,
            cached: false,
        }
    } else {
        AnalyzeVisionImageResponse {
            sha256,
            summary: presented_summary,
            provider,
            model,
            task_prompt: focus_plan.task_prompt,
            mime_type,
            width: sidecar.width,
            height: sidecar.height,
            cached: false,
        }
    };
    Ok(Json(json!({ "analysis": response })))
}

pub async fn upsert_vision_analysis_cache(
    Json(payload): Json<UpsertVisionCacheRequest>,
) -> Result<Json<Value>, ApiError> {
    let record = write_vision_cache_record(payload).map_err(|message| {
        let status = if message.contains("不能为空") || message.contains("sha256 无效") {
            StatusCode::BAD_REQUEST
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        ApiError::new(status, message)
    })?;
    Ok(Json(json!({ "cache": record })))
}

pub async fn get_vision_analysis_model_file(
    AxumPath((vendor, repo, remainder)): AxumPath<(String, String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    if vendor.trim() != FLORENCE_VENDOR || repo.trim() != FLORENCE_REPO {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "模型目录不存在"));
    }
    let requested = remainder.trim_start_matches('/').trim();
    if requested.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "缺少模型文件路径"));
    }

    let model_dir = vision_model_dir().map_err(internal_error)?;
    let target = model_dir.join(requested);
    if !target.starts_with(&model_dir) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "模型文件路径非法"));
    }
    if !target.is_file() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "模型文件不存在"));
    }

    let bytes = fs::read(&target)
        .map_err(|err| internal_error(format!("读取模型文件失败({}): {err}", target.display())))?;
    let content_type = guess_content_type(&target);
    Ok((
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(content_type)),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=3600"),
            ),
        ],
        bytes,
    ))
}
