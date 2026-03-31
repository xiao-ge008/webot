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

use crate::assignment_store::{
    self, CapabilityDescriptorRecord, CapabilityProviderBindingRecord, CapabilityProviderRecord,
    ProviderHealthStateRecord,
};
use crate::error::ApiError;
use crate::ocr_service;
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
    #[serde(default)]
    pub ocr_enabled: bool,
    #[serde(default = "default_ocr_provider")]
    pub ocr_provider: String,
    #[serde(default)]
    pub ocr_service_url: String,
    #[serde(default = "default_ocr_model_variant")]
    pub ocr_model_variant: String,
    #[serde(default = "default_ocr_auto_download_on_enable")]
    pub ocr_auto_download_on_enable: bool,
    #[serde(default = "default_ocr_merge_into_summary")]
    pub ocr_merge_into_summary: bool,
    #[serde(default = "default_ocr_prefer_for_text_heavy_images")]
    pub ocr_prefer_for_text_heavy_images: bool,
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
            ocr_enabled: false,
            ocr_provider: default_ocr_provider(),
            ocr_service_url: String::new(),
            ocr_model_variant: default_ocr_model_variant(),
            ocr_auto_download_on_enable: default_ocr_auto_download_on_enable(),
            ocr_merge_into_summary: default_ocr_merge_into_summary(),
            ocr_prefer_for_text_heavy_images: default_ocr_prefer_for_text_heavy_images(),
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
    pub ocr_provider_available: bool,
    pub ocr_model_ready: bool,
    pub ocr_download_active: bool,
    pub ocr_downloaded_bytes: u64,
    pub ocr_total_bytes: u64,
    pub ocr_progress_percent: f64,
    pub ocr_current_file: Option<String>,
    pub ocr_last_error: Option<String>,
    pub ocr_model_root_dir: String,
    pub ocr_model_dir: String,
    pub ocr_missing_files: Vec<String>,
    pub ocr_files: Vec<ocr_service::OcrModelFileStatus>,
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
    #[serde(default)]
    pub ocr_enabled: bool,
    #[serde(default)]
    pub vision_summary: Option<String>,
    #[serde(default)]
    pub ocr_summary: Option<String>,
    #[serde(default)]
    pub ocr_text: Option<String>,
    #[serde(default)]
    pub ocr_lines: Vec<ocr_service::OcrLine>,
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
    #[serde(default)]
    pub ocr_enabled: bool,
    #[serde(default)]
    pub vision_summary: Option<String>,
    #[serde(default)]
    pub ocr_summary: Option<String>,
    #[serde(default)]
    pub ocr_text: Option<String>,
    #[serde(default)]
    pub ocr_lines: Vec<ocr_service::OcrLine>,
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
    pub vision_summary: Option<String>,
    pub ocr_summary: Option<String>,
    pub ocr_text: Option<String>,
    pub ocr_lines: Vec<ocr_service::OcrLine>,
    pub ocr_enabled: bool,
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

fn default_ocr_provider() -> String {
    ocr_service::OCR_PROVIDER_SIDECAR_LOCAL.to_string()
}

fn default_ocr_model_variant() -> String {
    ocr_service::default_model_variant()
}

fn default_ocr_auto_download_on_enable() -> bool {
    true
}

fn default_ocr_merge_into_summary() -> bool {
    true
}

fn default_ocr_prefer_for_text_heavy_images() -> bool {
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
        &[
            "提示词",
            "prompt",
            "tag",
            "标签",
            "生图",
            "改图",
            "复现",
            "同款",
        ],
    ) {
        return VisionFocusPlan {
            mode: VisionFocusMode::Prompt,
            task_prompt: "<MIXED_CAPTION_PLUS>".to_string(),
            cacheable: false,
        };
    }

    if text_contains_any(
        &normalized,
        &[
            "背景", "布景", "场景", "环境", "构图", "机位", "镜头", "光影",
        ],
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
            "脸",
            "表情",
            "发型",
            "头发",
            "眼睛",
            "五官",
            "face",
            "expression",
            "hair",
            "eyes",
        ],
    ) {
        VisionFocusMode::Face
    } else if text_contains_any(
        &normalized,
        &[
            "配饰",
            "饰品",
            "项链",
            "耳环",
            "耳坠",
            "手套",
            "项圈",
            "首饰",
            "accessory",
            "necklace",
            "earring",
            "collar",
            "jewelry",
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
            "dress",
            "outfit",
            "clothing",
            "clothes",
            "shirt",
            "skirt",
            "gown",
            "nightgown",
            "nightdress",
            "lace",
            "velvet",
            "stocking",
            "stockings",
            "heels",
            "shoe",
            "bra",
            "lingerie",
            "collar",
            "tie",
            "ribbon",
            "sleeve",
            "boots",
            "丝袜",
            "鞋",
            "裙",
            "衣",
            "蕾丝",
            "丝绒",
            "领结",
            "项圈",
        ],
        VisionFocusMode::Pose => &[
            "pose", "posture", "standing", "sitting", "kneeling", "arms", "legs", "barefoot",
            "lying", "looking", "跪", "站", "坐", "姿", "动作", "手", "腿",
        ],
        VisionFocusMode::Background => &[
            "background",
            "bedroom",
            "bed",
            "room",
            "wall",
            "lighting",
            "camera",
            "angle",
            "composition",
            "palette",
            "atmosphere",
            "背景",
            "床",
            "房间",
            "构图",
            "镜头",
        ],
        VisionFocusMode::Face => &[
            "face",
            "eyes",
            "hair",
            "smile",
            "expression",
            "mouth",
            "blush",
            "五官",
            "头发",
            "眼",
            "表情",
            "脸",
        ],
        VisionFocusMode::Accessories => &[
            "necklace", "earring", "collar", "jewelry", "ring", "bracelet", "配饰", "项链", "耳环",
            "项圈", "首饰",
        ],
        VisionFocusMode::Prompt => &[
            "1girl",
            "solo",
            "camera_angle",
            "art_style",
            "background",
            "dress",
            "outfit",
            "style",
            "lighting",
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

fn build_mixed_summary(
    vision_summary: Option<&str>,
    ocr_summary: Option<&str>,
    prefer_ocr_first: bool,
) -> String {
    let normalized_vision = vision_summary
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let normalized_ocr = ocr_summary
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    match (normalized_vision, normalized_ocr) {
        (Some(vision), Some(ocr)) => {
            if prefer_ocr_first {
                format!("检测到文本：{ocr}\n图像语义：{vision}")
            } else {
                format!("图像语义：{vision}\n检测到文本：{ocr}")
            }
        }
        (Some(vision), None) => vision,
        (None, Some(ocr)) => format!("检测到文本：{ocr}"),
        (None, None) => String::new(),
    }
}

fn should_prefer_ocr_first(user_text: &str, config: &VisionAnalysisConfig) -> bool {
    if !config.ocr_prefer_for_text_heavy_images {
        return false;
    }
    let normalized = normalize_focus_text(user_text).to_ascii_lowercase();
    normalized.is_empty()
        || text_contains_any(
            &normalized,
            &[
                "文字",
                "文本",
                "ocr",
                "识别",
                "读一下",
                "读出",
                "翻译",
                "字幕",
                "票据",
                "表格",
                "文档",
                "pdf",
                "海报",
                "界面",
                "ui",
                "截图",
                "标题",
                "logo",
                "数字",
            ],
        )
}

fn ocr_provider_supports_local_download(config: &VisionAnalysisConfig) -> bool {
    ocr_service::normalize_provider_name(&config.ocr_provider)
        != ocr_service::OCR_PROVIDER_SIDECAR_HTTP
}

fn build_local_vision_provider_record(
    config: &VisionAnalysisConfig,
    status: &VisionAnalysisStatus,
) -> CapabilityProviderRecord {
    let enabled = config.enabled || config.ocr_enabled;
    let health_state = if !enabled {
        "disabled".to_string()
    } else if status.model_ready || status.ocr_model_ready {
        "ready".to_string()
    } else if status.download_active || status.ocr_download_active {
        "downloading".to_string()
    } else {
        "degraded".to_string()
    };
    CapabilityProviderRecord {
        provider_id: "runtime_native:local_vision_service".to_string(),
        provider_type: "runtime_native".to_string(),
        display_name: Some("本地混合视觉".to_string()),
        capabilities: vec![CapabilityDescriptorRecord {
            key: "analyze.media".to_string(),
            scope: "generic".to_string(),
        }],
        supported_scopes: vec!["generic".to_string()],
        priority: 15,
        requirements: json!({
            "florence2Enabled": config.enabled,
            "ocrEnabled": config.ocr_enabled,
        }),
        supports_job: true,
        enabled,
        health_state,
        input_contract: json!({
            "type": "object",
            "required": ["imagePath"],
            "properties": {
                "imagePath": { "type": "string" },
                "mimeType": { "type": "string" },
                "userText": { "type": "string" }
            }
        }),
        output_contract: json!({
            "kind": "media_result",
            "mediaType": "image",
            "summaryFields": ["summary", "visionSummary", "ocrSummary", "ocrLines"]
        }),
        metadata: json!({
            "providerStack": {
                "florence2": {
                    "enabled": config.enabled,
                    "ready": status.model_ready,
                    "modelId": config.model_id,
                },
                "ocr": {
                    "enabled": config.ocr_enabled,
                    "ready": status.ocr_model_ready,
                    "provider": config.ocr_provider,
                    "modelVariant": config.ocr_model_variant,
                }
            }
        }),
        is_removed: false,
        updated_at: String::new(),
    }
}

fn build_ocr_provider_record(
    config: &VisionAnalysisConfig,
    status: &VisionAnalysisStatus,
) -> CapabilityProviderRecord {
    let health_state = if !config.ocr_enabled {
        "disabled".to_string()
    } else if status.ocr_model_ready {
        "ready".to_string()
    } else if status.ocr_download_active {
        "downloading".to_string()
    } else {
        "degraded".to_string()
    };
    let provider_kind = ocr_service::normalize_provider_name(&config.ocr_provider);
    let is_http_sidecar = provider_kind == ocr_service::OCR_PROVIDER_SIDECAR_HTTP;
    CapabilityProviderRecord {
        provider_id: if is_http_sidecar {
            "generic_provider:ocr_sidecar".to_string()
        } else {
            "runtime_native:ocr_service".to_string()
        },
        provider_type: if is_http_sidecar {
            "generic_provider".to_string()
        } else {
            "runtime_native".to_string()
        },
        display_name: Some(if is_http_sidecar {
            "OCR Remote Sidecar 服务".to_string()
        } else if provider_kind == ocr_service::OCR_PROVIDER_SIDECAR_LOCAL {
            "OCR Local Sidecar".to_string()
        } else {
            "Paddle OCR 服务".to_string()
        }),
        capabilities: vec![
            CapabilityDescriptorRecord {
                key: "analyze.media".to_string(),
                scope: "generic".to_string(),
            },
            CapabilityDescriptorRecord {
                key: "parse.document".to_string(),
                scope: "generic".to_string(),
            },
            CapabilityDescriptorRecord {
                key: "extract.document".to_string(),
                scope: "generic".to_string(),
            },
        ],
        supported_scopes: vec!["generic".to_string()],
        priority: 18,
        requirements: json!({
            "modelVariant": config.ocr_model_variant,
            "serviceUrl": if config.ocr_service_url.trim().is_empty() {
                Value::Null
            } else {
                Value::String(config.ocr_service_url.trim().to_string())
            },
        }),
        supports_job: true,
        enabled: config.ocr_enabled,
        health_state,
        input_contract: json!({
            "type": "object",
            "required": ["imagePath"],
            "properties": {
                "imagePath": { "type": "string" }
            }
        }),
        output_contract: json!({
            "kind": "text_result",
            "fields": ["summary", "text", "lines"]
        }),
        metadata: json!({
            "provider": provider_kind,
            "modelVariant": config.ocr_model_variant,
            "serviceUrl": if config.ocr_service_url.trim().is_empty() {
                Value::Null
            } else {
                Value::String(config.ocr_service_url.trim().to_string())
            },
            "documentCapabilities": ["parse.document", "extract.document"],
        }),
        is_removed: false,
        updated_at: String::new(),
    }
}

fn sync_capability_registry_status(config: &VisionAnalysisConfig, status: &VisionAnalysisStatus) {
    let local_provider = build_local_vision_provider_record(config, status);
    let local_message = if local_provider.enabled {
        Some(
            status
                .last_error
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "本地混合视觉状态已同步".to_string()),
        )
    } else {
        Some("本地混合视觉已禁用".to_string())
    };
    let _ = assignment_store::upsert_capability_provider(local_provider.clone());
    let _ = assignment_store::upsert_capability_provider_binding(CapabilityProviderBindingRecord {
        capability_key: "analyze.media".to_string(),
        capability_scope: "generic".to_string(),
        provider_id: local_provider.provider_id.clone(),
        enabled: local_provider.enabled,
        updated_at: String::new(),
    });
    let _ = assignment_store::upsert_provider_health_state(ProviderHealthStateRecord {
        provider_id: local_provider.provider_id.clone(),
        health_state: local_provider.health_state.clone(),
        message: local_message,
        checked_at: now_ms().to_string(),
        updated_at: String::new(),
    });

    let ocr_provider = build_ocr_provider_record(config, status);
    let ocr_message = if ocr_provider.enabled {
        Some(
            status
                .ocr_last_error
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "OCR 服务状态已同步".to_string()),
        )
    } else {
        Some("OCR 服务已禁用".to_string())
    };
    let _ = assignment_store::upsert_capability_provider(ocr_provider.clone());
    for capability_key in ["analyze.media", "parse.document", "extract.document"] {
        let _ =
            assignment_store::upsert_capability_provider_binding(CapabilityProviderBindingRecord {
                capability_key: capability_key.to_string(),
                capability_scope: "generic".to_string(),
                provider_id: ocr_provider.provider_id.clone(),
                enabled: ocr_provider.enabled,
                updated_at: String::new(),
            });
    }
    let _ = assignment_store::upsert_provider_health_state(ProviderHealthStateRecord {
        provider_id: ocr_provider.provider_id.clone(),
        health_state: ocr_provider.health_state.clone(),
        message: ocr_message,
        checked_at: now_ms().to_string(),
        updated_at: String::new(),
    });
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
    config.ocr_provider = if config.ocr_provider.trim().is_empty() {
        default_ocr_provider()
    } else {
        ocr_service::normalize_provider_name(&config.ocr_provider)
    };
    config.ocr_service_url = config
        .ocr_service_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    config.ocr_model_variant = ocr_service::normalize_model_variant(&config.ocr_model_variant);
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
        ocr_enabled: payload.ocr_enabled,
        vision_summary: payload
            .vision_summary
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        ocr_summary: payload
            .ocr_summary
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        ocr_text: payload
            .ocr_text
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        ocr_lines: payload.ocr_lines,
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
    ocr_status: ocr_service::OcrRuntimeStatus,
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
        ocr_provider_available: ocr_status.provider_available,
        ocr_model_ready: ocr_status.model_ready,
        ocr_download_active: ocr_status.download_active,
        ocr_downloaded_bytes: ocr_status.downloaded_bytes,
        ocr_total_bytes: ocr_status.total_bytes,
        ocr_progress_percent: ocr_status.progress_percent,
        ocr_current_file: ocr_status.current_file,
        ocr_last_error: ocr_status.last_error,
        ocr_model_root_dir: ocr_status.model_root_dir,
        ocr_model_dir: ocr_status.model_dir,
        ocr_missing_files: ocr_status.missing_files,
        ocr_files: ocr_status.files,
        updated_at_ms: state.updated_at_ms.max(ocr_status.updated_at_ms),
    }
}

async fn refresh_status() -> Result<VisionAnalysisStatus, String> {
    let config = read_vision_analysis_config()?;
    let state = download_state().lock().await.clone();
    let ocr_status = ocr_service::refresh_status_with_provider(
        config.ocr_enabled,
        &config.ocr_provider,
        &config.ocr_model_variant,
        Some(&config.ocr_service_url),
    )
    .await?;
    Ok(compute_model_status(config, &state, ocr_status))
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
    if let Ok(status) = refresh_status().await {
        sync_capability_registry_status(&config, &status);
    }
    Ok(Json(json!({ "config": config })))
}

pub async fn get_vision_analysis_status() -> Result<Json<Value>, ApiError> {
    let status = refresh_status().await.map_err(internal_error)?;
    sync_capability_registry_status(&status.config, &status);
    Ok(Json(json!({ "status": status })))
}

pub async fn start_vision_analysis_download() -> Result<Json<Value>, ApiError> {
    let status = refresh_status().await.map_err(internal_error)?;
    let ocr_needs_local_download = status.config.ocr_enabled
        && ocr_provider_supports_local_download(&status.config)
        && !status.ocr_model_ready;
    if (!status.config.enabled || status.model_ready) && !ocr_needs_local_download {
        return Ok(Json(json!({ "status": status })));
    }

    {
        let guard = download_state().lock().await;
        if guard.active || status.ocr_download_active {
            return Ok(Json(json!({
                "status": compute_model_status(
                    status.config.clone(),
                    &guard,
                    ocr_service::refresh_status_with_provider(
                        status.config.ocr_enabled,
                        &status.config.ocr_provider,
                        &status.config.ocr_model_variant,
                        Some(&status.config.ocr_service_url),
                    )
                    .await
                    .map_err(internal_error)?,
                )
            })));
        }
    }

    let config = status.config.clone();
    tokio::spawn(async move {
        let mut last_error = None;
        if config.enabled && !status.model_ready {
            if let Err(err) = download_model_files().await {
                set_download_state(false, 0, 0, None, Some(err.clone())).await;
                last_error = Some(err);
            }
        }
        if last_error.is_none()
            && config.ocr_enabled
            && ocr_provider_supports_local_download(&config)
            && !status.ocr_model_ready
        {
            if let Err(err) = ocr_service::download_model_files_with_provider(
                &config.ocr_provider,
                &config.ocr_model_variant,
                Some(&config.ocr_service_url),
            )
            .await
            {
                last_error = Some(err);
            }
        }
        if let Some(err) = last_error {
            let _ = ocr_service::refresh_status_with_provider(
                config.ocr_enabled,
                &config.ocr_provider,
                &config.ocr_model_variant,
                Some(&config.ocr_service_url),
            )
            .await;
            set_download_state(false, 0, 0, None, Some(err)).await;
        } else {
            let _ = write_vision_analysis_config(config.clone());
        }
        if let Ok(next_status) = refresh_status().await {
            sync_capability_registry_status(&config, &next_status);
        }
    });

    let next = refresh_status().await.map_err(internal_error)?;
    Ok(Json(json!({ "status": next })))
}

pub async fn analyze_vision_image(
    Json(payload): Json<AnalyzeVisionImageRequest>,
) -> Result<Json<Value>, ApiError> {
    let status = refresh_status().await.map_err(internal_error)?;
    let florence_enabled = status.config.enabled && status.config.provider == FLORENCE_PROVIDER;
    let ocr_enabled = status.config.ocr_enabled;
    if !florence_enabled && !ocr_enabled {
        return Err(ApiError::new(StatusCode::CONFLICT, "本地混合视觉未启用"));
    }
    if !status.model_ready && !status.ocr_model_ready {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "本地视觉与 OCR 模型都尚未就绪",
        ));
    }

    let response = analyze_vision_image_with_status(payload, status)
        .await
        .map_err(internal_error)?;
    Ok(Json(json!({ "analysis": response })))
}

pub async fn analyze_vision_image_best_effort(
    payload: AnalyzeVisionImageRequest,
) -> Result<Option<AnalyzeVisionImageResponse>, String> {
    let status = refresh_status().await?;
    let florence_enabled = status.config.enabled && status.config.provider == FLORENCE_PROVIDER;
    if (!florence_enabled || !status.model_ready)
        && (!status.config.ocr_enabled || !status.ocr_model_ready)
    {
        return Ok(None);
    }
    analyze_vision_image_with_status(payload, status)
        .await
        .map(Some)
}

async fn analyze_vision_image_with_status(
    payload: AnalyzeVisionImageRequest,
    status: VisionAnalysisStatus,
) -> Result<AnalyzeVisionImageResponse, String> {
    let image_path = payload.image_path.trim();
    if image_path.is_empty() {
        return Err("imagePath 不能为空".to_string());
    }

    let path = PathBuf::from(image_path);
    if !path.is_absolute() {
        return Err("imagePath 必须是本地绝对路径".to_string());
    }
    if !path.is_file() {
        return Err(format!("图片文件不存在: {}", path.display()));
    }

    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|err| format!("读取图片文件失败({}): {err}", path.display()))?;
    let focus_plan = resolve_focus_plan(&payload.user_text, &status.config.task_prompt);
    let should_use_florence =
        status.config.enabled && status.config.provider == FLORENCE_PROVIDER && status.model_ready;
    let should_use_ocr = status.config.ocr_enabled && status.ocr_model_ready;
    let sha256 = payload
        .sha256
        .as_deref()
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| is_hex_sha256(item))
        .unwrap_or_else(|| format!("{:x}", sha2::Sha256::digest(bytes.as_slice())));

    if status.config.cache_enabled && focus_plan.cacheable {
        if let Some(record) = read_cached_record(&sha256)? {
            if record.task_prompt == focus_plan.task_prompt && record.ocr_enabled == should_use_ocr
            {
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
                    vision_summary: record.vision_summary,
                    ocr_summary: record.ocr_summary,
                    ocr_text: record.ocr_text,
                    ocr_lines: record.ocr_lines,
                    ocr_enabled: record.ocr_enabled,
                    cached: true,
                };
                return Ok(response);
            }
        }
    }

    let florence_result = if should_use_florence {
        Some(
            analyze_with_florence_sidecar(&path, &status.config.model_id, &focus_plan.task_prompt)
                .await
                .map_err(|err| err.to_string())?,
        )
    } else {
        None
    };
    let ocr_result = if should_use_ocr {
        Some(
            ocr_service::analyze_image_with_provider(
                &path,
                &status.config.ocr_provider,
                &status.config.ocr_model_variant,
                Some(&status.config.ocr_service_url),
            )
            .await?,
        )
    } else {
        None
    };
    let vision_summary = florence_result
        .as_ref()
        .and_then(|result| result.summary.clone())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    let ocr_summary = ocr_result
        .as_ref()
        .map(|result| result.summary.trim().to_string())
        .filter(|item| !item.is_empty());
    let raw_summary = if status.config.ocr_merge_into_summary {
        build_mixed_summary(
            vision_summary.as_deref(),
            ocr_summary.as_deref(),
            should_prefer_ocr_first(&payload.user_text, &status.config),
        )
    } else {
        vision_summary
            .clone()
            .or(ocr_summary.clone())
            .unwrap_or_default()
    };
    if raw_summary.trim().is_empty() {
        return Err("本地视觉未返回可用摘要".to_string());
    }
    let presented_summary =
        build_presented_summary(&raw_summary, &payload.user_text, focus_plan.mode);
    let mime_type = if payload.mime_type.trim().is_empty() {
        guess_image_mime_type(&path).to_string()
    } else {
        payload.mime_type.trim().to_string()
    };
    let provider = match (florence_result.as_ref(), ocr_result.as_ref()) {
        (Some(_), Some(_)) => "local_vision_stack".to_string(),
        (Some(sidecar), None) => sidecar
            .provider
            .clone()
            .unwrap_or_else(|| FLORENCE_PROVIDER.to_string()),
        (None, Some(result)) => result.provider.clone(),
        (None, None) => FLORENCE_PROVIDER.to_string(),
    };
    let model = match (florence_result.as_ref(), ocr_result.as_ref()) {
        (Some(_), Some(result)) => format!("{} + {}", status.config.model_id, result.model),
        (Some(sidecar), None) => sidecar
            .model
            .clone()
            .unwrap_or_else(|| status.config.model_id.clone()),
        (None, Some(result)) => result.model.clone(),
        (None, None) => status.config.model_id.clone(),
    };
    let ocr_lines = ocr_result
        .as_ref()
        .map(|result| result.lines.clone())
        .unwrap_or_default();
    let ocr_text = ocr_result
        .as_ref()
        .map(|result| result.text.clone())
        .filter(|value| !value.trim().is_empty());
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
            width: florence_result.as_ref().and_then(|result| result.width),
            height: florence_result.as_ref().and_then(|result| result.height),
            relative_path: payload.relative_path.clone(),
            saved_path: payload
                .saved_path
                .clone()
                .or_else(|| Some(path.to_string_lossy().to_string())),
            upstream_file_id: payload.upstream_file_id.clone(),
            file_name: payload.file_name.clone(),
            ocr_enabled: should_use_ocr,
            vision_summary: vision_summary.clone(),
            ocr_summary: ocr_summary.clone(),
            ocr_text: ocr_text.clone(),
            ocr_lines: ocr_lines.clone(),
        })?;
        AnalyzeVisionImageResponse {
            sha256: record.sha256,
            summary: build_presented_summary(&record.summary, &payload.user_text, focus_plan.mode),
            provider: record.provider,
            model: record.model,
            task_prompt: record.task_prompt,
            mime_type: record.mime_type,
            width: record.width,
            height: record.height,
            vision_summary: record.vision_summary,
            ocr_summary: record.ocr_summary,
            ocr_text: record.ocr_text,
            ocr_lines: record.ocr_lines,
            ocr_enabled: record.ocr_enabled,
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
            width: florence_result.as_ref().and_then(|result| result.width),
            height: florence_result.as_ref().and_then(|result| result.height),
            vision_summary,
            ocr_summary,
            ocr_text,
            ocr_lines,
            ocr_enabled: should_use_ocr,
            cached: false,
        }
    };
    Ok(response)
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
