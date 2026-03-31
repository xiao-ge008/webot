use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
use futures_util::StreamExt;
#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
use paddle_ocr_rs::ocr_lite::OcrLite;
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
use std::fs;
#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
use std::sync::Mutex;

use crate::path_resolver;

pub const OCR_PROVIDER_NAME: &str = "builtin";
pub const OCR_PROVIDER_BUILTIN: &str = "builtin";
pub const OCR_PROVIDER_SIDECAR_LOCAL: &str = "sidecar_local";
pub const OCR_PROVIDER_SIDECAR_HTTP: &str = "sidecar_http";
pub const OCR_MODEL_VARIANT_PPOCRV5_MOBILE: &str = "ppocrv5_mobile";

const OCR_VENDOR: &str = "rapidocr";
const OCR_REPO: &str = "paddle-ocr-rs";
const OCR_SIDECAR_MODE_ENV: &str = "WEBOT_OCR_SIDECAR_MODE";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(all(target_os = "windows", target_env = "gnu"))]
const OCR_UNSUPPORTED_MESSAGE: &str =
    "当前 Windows GNU 构建暂不支持内置 Paddle OCR：`ort-sys` 没有 x86_64-pc-windows-gnu 预编译运行时。请改用 MSVC/源码编译 ONNX Runtime，或在当前 GNU 构建中保持 OCR 关闭。";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrModelFileStatus {
    pub relative_path: String,
    pub expected_size: Option<u64>,
    pub present: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRuntimeStatus {
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
    pub missing_files: Vec<String>,
    pub files: Vec<OcrModelFileStatus>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPoint {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub text: String,
    pub score: f32,
    pub box_score: f32,
    pub angle_index: i32,
    pub angle_score: f32,
    pub box_points: Vec<OcrPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrAnalysisResult {
    pub summary: String,
    pub text: String,
    pub text_count: usize,
    pub avg_score: Option<f32>,
    pub provider: String,
    pub model: String,
    pub lines: Vec<OcrLine>,
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
#[derive(Debug, Clone, Default)]
struct OcrDownloadState {
    active: bool,
    downloaded_bytes: u64,
    total_bytes: u64,
    current_file: Option<String>,
    last_error: Option<String>,
    updated_at_ms: u64,
}

#[cfg_attr(all(target_os = "windows", target_env = "gnu"), allow(dead_code))]
#[derive(Debug, Clone, Copy)]
struct OcrModelFile {
    relative_path: &'static str,
    url: &'static str,
    sha256: &'static str,
    expected_size: Option<u64>,
}

struct OcrSidecarProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrSidecarRequest {
    pub r#type: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_variant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrSidecarEnvelope {
    pub r#type: String,
    #[serde(default)]
    pub request_id: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub status: Option<OcrRuntimeStatus>,
    #[serde(default)]
    pub analysis: Option<OcrAnalysisResult>,
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
struct LoadedOcrEngine {
    model_dir: String,
    ocr: OcrLite,
}

const PPOCRV5_MOBILE_MODEL_FILES: &[OcrModelFile] = &[
    OcrModelFile {
        relative_path: "det/ch_PP-OCRv5_mobile_det.onnx",
        url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.7.0/onnx/PP-OCRv5/det/ch_PP-OCRv5_mobile_det.onnx",
        sha256: "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae",
        expected_size: None,
    },
    OcrModelFile {
        relative_path: "cls/ch_ppocr_mobile_v2.0_cls_infer.onnx",
        url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.7.0/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_infer.onnx",
        sha256: "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
        expected_size: None,
    },
    OcrModelFile {
        relative_path: "rec/ch_PP-OCRv5_rec_mobile_infer.onnx",
        url: "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.7.0/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile_infer.onnx",
        sha256: "5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5",
        expected_size: None,
    },
];

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

pub fn normalize_provider_name(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "sidecar_local" | "local_sidecar" | "local-sidecar" | "sidecar-local" => {
            OCR_PROVIDER_SIDECAR_LOCAL.to_string()
        }
        "builtin" | "local" | "paddle_ocr_rs" | "paddle-ocr-rs" => OCR_PROVIDER_BUILTIN.to_string(),
        "sidecar_http" | "sidecar" | "http" | "remote" => OCR_PROVIDER_SIDECAR_HTTP.to_string(),
        "" => OCR_PROVIDER_SIDECAR_LOCAL.to_string(),
        _ => OCR_PROVIDER_SIDECAR_LOCAL.to_string(),
    }
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
fn normalize_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
fn download_state() -> &'static tokio::sync::Mutex<OcrDownloadState> {
    static OCR_DOWNLOAD_STATE: OnceLock<tokio::sync::Mutex<OcrDownloadState>> = OnceLock::new();
    OCR_DOWNLOAD_STATE.get_or_init(|| tokio::sync::Mutex::new(OcrDownloadState::default()))
}

fn sidecar_state() -> &'static tokio::sync::Mutex<Option<OcrSidecarProcess>> {
    static OCR_SIDECAR_STATE: OnceLock<tokio::sync::Mutex<Option<OcrSidecarProcess>>> =
        OnceLock::new();
    OCR_SIDECAR_STATE.get_or_init(|| tokio::sync::Mutex::new(None))
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
fn engine_state() -> &'static Mutex<Option<LoadedOcrEngine>> {
    static OCR_ENGINE_STATE: OnceLock<Mutex<Option<LoadedOcrEngine>>> = OnceLock::new();
    OCR_ENGINE_STATE.get_or_init(|| Mutex::new(None))
}

pub fn default_model_variant() -> String {
    OCR_MODEL_VARIANT_PPOCRV5_MOBILE.to_string()
}

pub fn should_run_sidecar_from_env() -> bool {
    env::var(OCR_SIDECAR_MODE_ENV)
        .ok()
        .is_some_and(|value| value.trim() == "1")
}

pub fn normalize_model_variant(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | OCR_MODEL_VARIANT_PPOCRV5_MOBILE => OCR_MODEL_VARIANT_PPOCRV5_MOBILE.to_string(),
        _ => OCR_MODEL_VARIANT_PPOCRV5_MOBILE.to_string(),
    }
}

fn model_files_for_variant(model_variant: &str) -> &'static [OcrModelFile] {
    let _ = model_variant;
    PPOCRV5_MOBILE_MODEL_FILES
}

fn empty_status_with_options(
    enabled: bool,
    provider_available: bool,
    model_variant: &str,
    last_error: Option<String>,
    model_dir_override: Option<&str>,
) -> Result<OcrRuntimeStatus, String> {
    let root_dir = model_root_dir()?;
    let model_dir = model_dir_override
        .map(PathBuf::from)
        .unwrap_or(model_dir(model_variant)?);
    Ok(OcrRuntimeStatus {
        provider_available: enabled && provider_available,
        model_ready: false,
        download_active: false,
        downloaded_bytes: 0,
        total_bytes: 0,
        progress_percent: 0.0,
        current_file: None,
        last_error,
        model_root_dir: root_dir.to_string_lossy().to_string(),
        model_dir: model_dir.to_string_lossy().to_string(),
        missing_files: model_files_for_variant(model_variant)
            .iter()
            .map(|item| item.relative_path.to_string())
            .collect(),
        files: model_files_for_variant(model_variant)
            .iter()
            .map(|item| OcrModelFileStatus {
                relative_path: item.relative_path.to_string(),
                expected_size: item.expected_size,
                present: false,
                size: None,
            })
            .collect(),
        updated_at_ms: now_ms(),
    })
}

async fn refresh_sidecar_status(
    enabled: bool,
    model_variant: &str,
    service_url: Option<&str>,
) -> Result<OcrRuntimeStatus, String> {
    let url = service_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OCR sidecar_http 未配置服务地址".to_string());
    let Some(url) = url.ok() else {
        return empty_status_with_options(
            enabled,
            false,
            model_variant,
            Some("OCR sidecar_http 未配置服务地址".to_string()),
            Some("sidecar_http://unconfigured"),
        );
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|error| format!("初始化 OCR sidecar 客户端失败: {error}"))?;
    let candidates = [format!("{url}/status"), format!("{url}/health")];
    let mut last_error = None;
    for endpoint in candidates {
        match client.get(&endpoint).send().await {
            Ok(response) if response.status().is_success() => {
                let payload = response.json::<Value>().await.unwrap_or(Value::Null);
                let object = payload.as_object();
                let ready = object
                    .and_then(|item| item.get("modelReady").or_else(|| item.get("ready")))
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                let provider_available = object
                    .and_then(|item| {
                        item.get("providerAvailable")
                            .or_else(|| item.get("available"))
                    })
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                let download_active = object
                    .and_then(|item| {
                        item.get("downloadActive")
                            .or_else(|| item.get("downloading"))
                    })
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let downloaded_bytes = object
                    .and_then(|item| item.get("downloadedBytes"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                let total_bytes = object
                    .and_then(|item| item.get("totalBytes"))
                    .and_then(Value::as_u64)
                    .unwrap_or(downloaded_bytes);
                let progress_percent = object
                    .and_then(|item| item.get("progressPercent").or_else(|| item.get("progress")))
                    .and_then(Value::as_f64)
                    .unwrap_or_else(|| if ready { 100.0 } else { 0.0 });
                return Ok(OcrRuntimeStatus {
                    provider_available: enabled && provider_available,
                    model_ready: enabled && ready,
                    download_active,
                    downloaded_bytes,
                    total_bytes,
                    progress_percent,
                    current_file: object
                        .and_then(|item| item.get("currentFile"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    last_error: object
                        .and_then(|item| item.get("lastError").or_else(|| item.get("error")))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    model_root_dir: String::new(),
                    model_dir: url.to_string(),
                    missing_files: Vec::new(),
                    files: Vec::new(),
                    updated_at_ms: now_ms(),
                });
            }
            Ok(response) => {
                last_error = Some(format!("OCR sidecar 状态接口返回 {}", response.status()));
            }
            Err(error) => {
                last_error = Some(format!("连接 OCR sidecar 失败: {error}"));
            }
        }
    }
    empty_status_with_options(enabled, false, model_variant, last_error, Some(url))
}

fn sidecar_request_id(prefix: &str) -> String {
    format!("{}_{}", prefix, now_ms())
}

async fn spawn_local_sidecar() -> Result<OcrSidecarProcess, String> {
    let current_exe =
        env::current_exe().map_err(|error| format!("定位 OCR sidecar 可执行文件失败: {error}"))?;
    let mut command = Command::new(&current_exe);
    command.env(OCR_SIDECAR_MODE_ENV, "1");
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|error| {
        format!(
            "启动 OCR 本地 sidecar 失败({}): {error}",
            current_exe.display()
        )
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "启动 OCR 本地 sidecar 失败: stdin 不可用".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "启动 OCR 本地 sidecar 失败: stdout 不可用".to_string())?;
    let mut stdout = BufReader::new(stdout);
    let mut line = String::new();
    let bytes = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        stdout.read_line(&mut line),
    )
    .await
    .map_err(|_| "等待 OCR 本地 sidecar 启动超时".to_string())?
    .map_err(|error| format!("读取 OCR 本地 sidecar 启动消息失败: {error}"))?;
    if bytes == 0 {
        return Err("OCR 本地 sidecar 启动后立即退出".to_string());
    }
    let ready = serde_json::from_str::<OcrSidecarEnvelope>(line.trim())
        .map_err(|error| format!("解析 OCR 本地 sidecar 启动消息失败: {error}"))?;
    if ready.r#type != "ready" {
        return Err(format!("OCR 本地 sidecar 启动响应非法: {}", ready.r#type));
    }
    Ok(OcrSidecarProcess {
        child,
        stdin,
        stdout,
    })
}

async fn ensure_local_sidecar_running(
    state: &mut Option<OcrSidecarProcess>,
) -> Result<&mut OcrSidecarProcess, String> {
    let should_spawn = match state.as_mut() {
        Some(process) => process
            .child
            .try_wait()
            .map_err(|error| format!("检查 OCR 本地 sidecar 状态失败: {error}"))?
            .is_some(),
        None => true,
    };
    if should_spawn {
        *state = Some(spawn_local_sidecar().await?);
    }
    state
        .as_mut()
        .ok_or_else(|| "OCR 本地 sidecar 状态异常".to_string())
}

async fn request_local_sidecar(request: &OcrSidecarRequest) -> Result<OcrSidecarEnvelope, String> {
    let request_json = serde_json::to_string(request)
        .map_err(|error| format!("序列化 OCR sidecar 请求失败: {error}"))?;
    let mut attempts = 0u8;
    loop {
        attempts = attempts.saturating_add(1);
        let mut guard = sidecar_state().lock().await;
        let process = ensure_local_sidecar_running(&mut guard).await?;
        process
            .stdin
            .write_all(request_json.as_bytes())
            .await
            .map_err(|error| format!("向 OCR sidecar 发送请求失败: {error}"))?;
        process
            .stdin
            .write_all(b"\n")
            .await
            .map_err(|error| format!("向 OCR sidecar 发送换行失败: {error}"))?;
        process
            .stdin
            .flush()
            .await
            .map_err(|error| format!("刷新 OCR sidecar 请求失败: {error}"))?;

        let mut line = String::new();
        let bytes = process
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|error| format!("读取 OCR sidecar 响应失败: {error}"))?;
        if bytes == 0 {
            *guard = None;
            if attempts < 2 {
                continue;
            }
            return Err("OCR 本地 sidecar 在响应前已退出".to_string());
        }
        let response = serde_json::from_str::<OcrSidecarEnvelope>(line.trim())
            .map_err(|error| format!("解析 OCR sidecar 响应失败: {error}"))?;
        if !response.request_id.is_empty() && response.request_id != request.request_id {
            *guard = None;
            if attempts < 2 {
                continue;
            }
            return Err("OCR sidecar 响应 requestId 不匹配".to_string());
        }
        return Ok(response);
    }
}

async fn analyze_image_with_local_sidecar(
    path: &Path,
    model_variant: &str,
) -> Result<OcrAnalysisResult, String> {
    let request = OcrSidecarRequest {
        r#type: "analyze".to_string(),
        request_id: sidecar_request_id("ocr_analyze"),
        enabled: None,
        model_variant: Some(normalize_model_variant(model_variant)),
        image_path: Some(path.to_string_lossy().to_string()),
    };
    let response = request_local_sidecar(&request).await?;
    if response.r#type == "error" {
        return Err(response
            .error
            .unwrap_or_else(|| "OCR 本地 sidecar 分析失败".to_string()));
    }
    let mut analysis = response
        .analysis
        .ok_or_else(|| "OCR 本地 sidecar 未返回分析结果".to_string())?;
    analysis.provider = OCR_PROVIDER_SIDECAR_LOCAL.to_string();
    Ok(analysis)
}

async fn analyze_image_with_sidecar(
    path: &Path,
    model_variant: &str,
    service_url: Option<&str>,
) -> Result<OcrAnalysisResult, String> {
    let url = service_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OCR sidecar_http 未配置服务地址".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| format!("初始化 OCR sidecar 客户端失败: {error}"))?;
    let response = client
        .post(format!("{url}/analyze"))
        .json(&serde_json::json!({
            "imagePath": path.to_string_lossy().to_string(),
            "modelVariant": normalize_model_variant(model_variant),
        }))
        .send()
        .await
        .map_err(|error| format!("请求 OCR sidecar 失败: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("OCR sidecar 返回错误({status}): {body}"));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("解析 OCR sidecar 响应失败: {error}"))?;
    let analysis = payload.get("analysis").cloned().unwrap_or(payload);
    serde_json::from_value::<OcrAnalysisResult>(analysis)
        .map_err(|error| format!("OCR sidecar 响应结构无效: {error}"))
}

pub async fn refresh_status_with_provider(
    enabled: bool,
    provider: &str,
    model_variant: &str,
    service_url: Option<&str>,
) -> Result<OcrRuntimeStatus, String> {
    match normalize_provider_name(provider).as_str() {
        OCR_PROVIDER_SIDECAR_LOCAL => refresh_status(enabled, model_variant).await,
        OCR_PROVIDER_SIDECAR_HTTP => {
            refresh_sidecar_status(enabled, model_variant, service_url).await
        }
        _ => refresh_status(enabled, model_variant).await,
    }
}

pub async fn download_model_files_with_provider(
    provider: &str,
    model_variant: &str,
    service_url: Option<&str>,
) -> Result<(), String> {
    match normalize_provider_name(provider).as_str() {
        OCR_PROVIDER_SIDECAR_LOCAL => download_model_files(model_variant).await,
        OCR_PROVIDER_SIDECAR_HTTP => {
            let url = service_url
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "OCR sidecar_http 未配置服务地址".to_string())?;
            Err(format!(
                "当前 OCR provider=sidecar_http，模型生命周期由外部服务管理，请在 sidecar 服务端处理模型下载与预热。当前地址：{url}"
            ))
        }
        _ => download_model_files(model_variant).await,
    }
}

pub async fn analyze_image_with_provider(
    path: &Path,
    provider: &str,
    model_variant: &str,
    service_url: Option<&str>,
) -> Result<OcrAnalysisResult, String> {
    match normalize_provider_name(provider).as_str() {
        OCR_PROVIDER_SIDECAR_LOCAL => analyze_image_with_local_sidecar(path, model_variant).await,
        OCR_PROVIDER_SIDECAR_HTTP => {
            analyze_image_with_sidecar(path, model_variant, service_url).await
        }
        _ => analyze_image(path, model_variant).await,
    }
}

pub async fn run_sidecar_from_env() -> Result<(), String> {
    let mut stdout = tokio::io::stdout();
    stdout
        .write_all(
            format!(
                "{}\n",
                serde_json::to_string(&OcrSidecarEnvelope {
                    r#type: "ready".to_string(),
                    request_id: String::new(),
                    error: None,
                    status: None,
                    analysis: None,
                })
                .map_err(|error| format!("序列化 OCR sidecar ready 消息失败: {error}"))?
            )
            .as_bytes(),
        )
        .await
        .map_err(|error| format!("写入 OCR sidecar ready 消息失败: {error}"))?;
    stdout
        .flush()
        .await
        .map_err(|error| format!("刷新 OCR sidecar ready 消息失败: {error}"))?;

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .await
            .map_err(|error| format!("读取 OCR sidecar 输入失败: {error}"))?;
        if bytes == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<OcrSidecarRequest>(trimmed) {
            Ok(request) => request,
            Err(error) => {
                let payload = OcrSidecarEnvelope {
                    r#type: "error".to_string(),
                    request_id: "invalid-json".to_string(),
                    error: Some(format!("OCR sidecar 请求 JSON 解析失败: {error}")),
                    status: None,
                    analysis: None,
                };
                stdout
                    .write_all(
                        format!(
                            "{}\n",
                            serde_json::to_string(&payload)
                                .map_err(|err| format!("序列化 OCR sidecar 错误响应失败: {err}"))?
                        )
                        .as_bytes(),
                    )
                    .await
                    .map_err(|err| format!("写入 OCR sidecar 错误响应失败: {err}"))?;
                stdout
                    .flush()
                    .await
                    .map_err(|err| format!("刷新 OCR sidecar 错误响应失败: {err}"))?;
                continue;
            }
        };

        let response = match request.r#type.as_str() {
            "status" => match refresh_status(
                request.enabled.unwrap_or(true),
                request
                    .model_variant
                    .as_deref()
                    .unwrap_or(OCR_MODEL_VARIANT_PPOCRV5_MOBILE),
            )
            .await
            {
                Ok(status) => OcrSidecarEnvelope {
                    r#type: "status".to_string(),
                    request_id: request.request_id,
                    error: None,
                    status: Some(status),
                    analysis: None,
                },
                Err(error) => OcrSidecarEnvelope {
                    r#type: "error".to_string(),
                    request_id: request.request_id,
                    error: Some(error),
                    status: None,
                    analysis: None,
                },
            },
            "download" => {
                let model_variant = request
                    .model_variant
                    .as_deref()
                    .unwrap_or(OCR_MODEL_VARIANT_PPOCRV5_MOBILE);
                match download_model_files(model_variant).await {
                    Ok(_) => match refresh_status(true, model_variant).await {
                        Ok(status) => OcrSidecarEnvelope {
                            r#type: "status".to_string(),
                            request_id: request.request_id,
                            error: None,
                            status: Some(status),
                            analysis: None,
                        },
                        Err(error) => OcrSidecarEnvelope {
                            r#type: "error".to_string(),
                            request_id: request.request_id,
                            error: Some(error),
                            status: None,
                            analysis: None,
                        },
                    },
                    Err(error) => OcrSidecarEnvelope {
                        r#type: "error".to_string(),
                        request_id: request.request_id,
                        error: Some(error),
                        status: None,
                        analysis: None,
                    },
                }
            }
            "analyze" => {
                let image_path = request
                    .image_path
                    .as_deref()
                    .ok_or_else(|| "OCR sidecar analyze 缺少 imagePath".to_string());
                match image_path {
                    Ok(image_path) => match analyze_image(
                        Path::new(image_path),
                        request
                            .model_variant
                            .as_deref()
                            .unwrap_or(OCR_MODEL_VARIANT_PPOCRV5_MOBILE),
                    )
                    .await
                    {
                        Ok(mut analysis) => {
                            analysis.provider = OCR_PROVIDER_SIDECAR_LOCAL.to_string();
                            OcrSidecarEnvelope {
                                r#type: "result".to_string(),
                                request_id: request.request_id,
                                error: None,
                                status: None,
                                analysis: Some(analysis),
                            }
                        }
                        Err(error) => OcrSidecarEnvelope {
                            r#type: "error".to_string(),
                            request_id: request.request_id,
                            error: Some(error),
                            status: None,
                            analysis: None,
                        },
                    },
                    Err(error) => OcrSidecarEnvelope {
                        r#type: "error".to_string(),
                        request_id: request.request_id,
                        error: Some(error),
                        status: None,
                        analysis: None,
                    },
                }
            }
            other => OcrSidecarEnvelope {
                r#type: "error".to_string(),
                request_id: request.request_id,
                error: Some(format!("不支持的 OCR sidecar 请求类型: {other}")),
                status: None,
                analysis: None,
            },
        };

        stdout
            .write_all(
                format!(
                    "{}\n",
                    serde_json::to_string(&response)
                        .map_err(|error| format!("序列化 OCR sidecar 响应失败: {error}"))?
                )
                .as_bytes(),
            )
            .await
            .map_err(|error| format!("写入 OCR sidecar 响应失败: {error}"))?;
        stdout
            .flush()
            .await
            .map_err(|error| format!("刷新 OCR sidecar 响应失败: {error}"))?;
    }
    Ok(())
}

pub fn model_root_dir() -> Result<PathBuf, String> {
    Ok(path_resolver::webot_home_dir()?
        .join("shared")
        .join("models")
        .join("ocr")
        .join(OCR_VENDOR)
        .join(OCR_REPO))
}

pub fn model_dir(model_variant: &str) -> Result<PathBuf, String> {
    Ok(model_root_dir()?.join(normalize_model_variant(model_variant)))
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
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

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
fn file_sha256(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("读取 OCR 模型文件失败({}): {error}", path.display()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
fn file_is_ready(path: &Path, spec: &OcrModelFile) -> bool {
    path.is_file()
        && file_sha256(path)
            .map(|digest| digest.eq_ignore_ascii_case(spec.sha256))
            .unwrap_or(false)
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
fn clear_loaded_engine() {
    if let Ok(mut guard) = engine_state().lock() {
        *guard = None;
    }
}

#[cfg(all(target_os = "windows", target_env = "gnu"))]
pub async fn refresh_status(
    enabled: bool,
    model_variant: &str,
) -> Result<OcrRuntimeStatus, String> {
    let root_dir = model_root_dir()?;
    let model_dir = model_dir(model_variant)?;
    Ok(OcrRuntimeStatus {
        provider_available: false,
        model_ready: false,
        download_active: false,
        downloaded_bytes: 0,
        total_bytes: 0,
        progress_percent: 0.0,
        current_file: None,
        last_error: if enabled {
            Some(OCR_UNSUPPORTED_MESSAGE.to_string())
        } else {
            None
        },
        model_root_dir: root_dir.to_string_lossy().to_string(),
        model_dir: model_dir.to_string_lossy().to_string(),
        missing_files: model_files_for_variant(model_variant)
            .iter()
            .map(|item| item.relative_path.to_string())
            .collect(),
        files: model_files_for_variant(model_variant)
            .iter()
            .map(|item| OcrModelFileStatus {
                relative_path: item.relative_path.to_string(),
                expected_size: item.expected_size,
                present: false,
                size: None,
            })
            .collect(),
        updated_at_ms: now_ms(),
    })
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
pub async fn refresh_status(
    enabled: bool,
    model_variant: &str,
) -> Result<OcrRuntimeStatus, String> {
    let root_dir = model_root_dir()?;
    let model_dir = model_dir(model_variant)?;
    let state = download_state().lock().await.clone();

    let files = model_files_for_variant(model_variant)
        .iter()
        .map(|item| {
            let path = model_dir.join(item.relative_path);
            let metadata = fs::metadata(&path).ok();
            let present = metadata.is_some() && file_is_ready(&path, item);
            OcrModelFileStatus {
                relative_path: item.relative_path.to_string(),
                expected_size: item.expected_size,
                present,
                size: metadata.map(|value| value.len()),
            }
        })
        .collect::<Vec<_>>();
    let missing_files = files
        .iter()
        .filter(|item| !item.present)
        .map(|item| item.relative_path.clone())
        .collect::<Vec<_>>();
    let model_ready = enabled && missing_files.is_empty();

    let total_present_bytes = files.iter().filter_map(|item| item.size).sum::<u64>();
    let total_bytes = if state.total_bytes > 0 {
        state.total_bytes
    } else {
        total_present_bytes
    };
    let downloaded_bytes = if state.active {
        state
            .downloaded_bytes
            .min(total_bytes.max(state.downloaded_bytes))
    } else {
        total_present_bytes
    };
    let progress_percent = if total_bytes > 0 {
        ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    } else if model_ready {
        100.0
    } else {
        0.0
    };

    Ok(OcrRuntimeStatus {
        provider_available: enabled,
        model_ready,
        download_active: state.active,
        downloaded_bytes,
        total_bytes,
        progress_percent,
        current_file: state.current_file,
        last_error: state.last_error,
        model_root_dir: root_dir.to_string_lossy().to_string(),
        model_dir: model_dir.to_string_lossy().to_string(),
        missing_files,
        files,
        updated_at_ms: state.updated_at_ms,
    })
}

#[cfg(all(target_os = "windows", target_env = "gnu"))]
pub async fn download_model_files(_model_variant: &str) -> Result<(), String> {
    Err(OCR_UNSUPPORTED_MESSAGE.to_string())
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
pub async fn download_model_files(model_variant: &str) -> Result<(), String> {
    let model_variant = normalize_model_variant(model_variant);
    let model_dir = model_dir(&model_variant)?;
    fs::create_dir_all(&model_dir)
        .map_err(|error| format!("创建 OCR 模型目录失败({}): {error}", model_dir.display()))?;

    let mut completed_bytes = model_files_for_variant(&model_variant)
        .iter()
        .filter_map(|item| {
            let path = model_dir.join(item.relative_path);
            if file_is_ready(&path, item) {
                fs::metadata(path).ok().map(|value| value.len())
            } else {
                None
            }
        })
        .sum::<u64>();
    set_download_state(true, completed_bytes, completed_bytes, None, None).await;

    let client = reqwest::Client::builder()
        .user_agent("weBot/1.0")
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|error| format!("初始化 OCR 下载客户端失败: {error}"))?;

    for item in model_files_for_variant(&model_variant) {
        let target = model_dir.join(item.relative_path);
        if file_is_ready(&target, item) {
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("创建 OCR 模型子目录失败({}): {error}", parent.display())
            })?;
        }

        let temp_path = target.with_extension("download");
        set_download_state(
            true,
            completed_bytes,
            completed_bytes,
            Some(item.relative_path.to_string()),
            None,
        )
        .await;

        let response =
            client.get(item.url).send().await.map_err(|error| {
                format!("下载 OCR 模型文件失败({}): {error}", item.relative_path)
            })?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "下载 OCR 模型文件失败({}): HTTP {} {}",
                item.relative_path, status, body
            ));
        }

        let response_len = response.content_length().unwrap_or(0);
        let total_bytes = completed_bytes.saturating_add(response_len);
        set_download_state(
            true,
            completed_bytes,
            total_bytes,
            Some(item.relative_path.to_string()),
            None,
        )
        .await;

        let mut output = tokio::fs::File::create(&temp_path).await.map_err(|error| {
            format!(
                "创建 OCR 模型临时文件失败({}): {error}",
                temp_path.display()
            )
        })?;
        let mut stream = response.bytes_stream();
        let mut file_written = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| {
                format!("读取 OCR 模型下载流失败({}): {error}", item.relative_path)
            })?;
            output.write_all(&chunk).await.map_err(|error| {
                format!("写入 OCR 模型文件失败({}): {error}", item.relative_path)
            })?;
            file_written = file_written.saturating_add(chunk.len() as u64);
            set_download_state(
                true,
                completed_bytes.saturating_add(file_written),
                total_bytes.max(completed_bytes.saturating_add(file_written)),
                Some(item.relative_path.to_string()),
                None,
            )
            .await;
        }
        output
            .flush()
            .await
            .map_err(|error| format!("刷新 OCR 模型文件失败({}): {error}", item.relative_path))?;
        drop(output);

        let actual_sha = file_sha256(&temp_path)?;
        if !actual_sha.eq_ignore_ascii_case(item.sha256) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!(
                "OCR 模型文件校验失败({})，期望 {}，实际 {}",
                item.relative_path, item.sha256, actual_sha
            ));
        }

        if target.exists() {
            let _ = fs::remove_file(&target);
        }
        fs::rename(&temp_path, &target).map_err(|error| {
            format!(
                "保存 OCR 模型文件失败({} -> {}): {error}",
                temp_path.display(),
                target.display()
            )
        })?;
        completed_bytes = completed_bytes.saturating_add(file_written);
    }

    clear_loaded_engine();
    set_download_state(false, completed_bytes, completed_bytes, None, None).await;
    Ok(())
}

#[cfg(all(target_os = "windows", target_env = "gnu"))]
pub async fn analyze_image(
    _path: &Path,
    _model_variant: &str,
) -> Result<OcrAnalysisResult, String> {
    Err(OCR_UNSUPPORTED_MESSAGE.to_string())
}

#[cfg(not(all(target_os = "windows", target_env = "gnu")))]
pub async fn analyze_image(path: &Path, model_variant: &str) -> Result<OcrAnalysisResult, String> {
    if !path.is_file() {
        return Err(format!("OCR 输入图片不存在: {}", path.display()));
    }

    let model_variant = normalize_model_variant(model_variant);
    let model_dir = model_dir(&model_variant)?;
    let det_path = model_dir.join("det").join("ch_PP-OCRv5_mobile_det.onnx");
    let cls_path = model_dir
        .join("cls")
        .join("ch_ppocr_mobile_v2.0_cls_infer.onnx");
    let rec_path = model_dir
        .join("rec")
        .join("ch_PP-OCRv5_rec_mobile_infer.onnx");
    for required in [&det_path, &cls_path, &rec_path] {
        if !required.is_file() {
            return Err(format!("OCR 模型文件缺失: {}", required.display()));
        }
    }

    let path_string = path.to_string_lossy().to_string();
    let model_dir_string = model_dir.to_string_lossy().to_string();
    tokio::task::spawn_blocking(move || -> Result<OcrAnalysisResult, String> {
        let mut guard = engine_state()
            .lock()
            .map_err(|_| "OCR 引擎状态锁定失败".to_string())?;
        let should_reload = guard
            .as_ref()
            .map(|engine| engine.model_dir != model_dir_string)
            .unwrap_or(true);
        if should_reload {
            let mut ocr = OcrLite::new();
            ocr.init_models(
                det_path.to_string_lossy().as_ref(),
                cls_path.to_string_lossy().as_ref(),
                rec_path.to_string_lossy().as_ref(),
                2,
            )
            .map_err(|error| format!("初始化 Paddle OCR 模型失败: {error}"))?;
            *guard = Some(LoadedOcrEngine {
                model_dir: model_dir_string.clone(),
                ocr,
            });
        }

        let result = guard
            .as_mut()
            .ok_or_else(|| "OCR 引擎未初始化".to_string())?
            .ocr
            .detect_from_path(&path_string, 32, 1536, 0.5, 0.3, 1.6, true, false)
            .map_err(|error| format!("执行 Paddle OCR 失败: {error}"))?;

        let mut line_count = 0usize;
        let mut total_score = 0f32;
        let mut text_lines = Vec::new();
        let lines = result
            .text_blocks
            .into_iter()
            .filter_map(|item| {
                let text = normalize_text(&item.text);
                if text.is_empty() {
                    return None;
                }
                line_count = line_count.saturating_add(1);
                total_score += item.text_score;
                text_lines.push(text.clone());
                Some(OcrLine {
                    text,
                    score: item.text_score,
                    box_score: item.box_score,
                    angle_index: item.angle_index,
                    angle_score: item.angle_score,
                    box_points: item
                        .box_points
                        .into_iter()
                        .map(|point| OcrPoint {
                            x: point.x,
                            y: point.y,
                        })
                        .collect(),
                })
            })
            .collect::<Vec<_>>();
        let avg_score = if line_count == 0 {
            None
        } else {
            Some(total_score / line_count as f32)
        };
        let text = text_lines.join("\n");
        let summary = if text_lines.is_empty() {
            String::new()
        } else if text_lines.len() <= 4 {
            text_lines.join(" | ")
        } else {
            format!(
                "{} 等 {} 段文本",
                text_lines[..4].join(" | "),
                text_lines.len()
            )
        };

        Ok(OcrAnalysisResult {
            summary,
            text,
            text_count: line_count,
            avg_score,
            provider: OCR_PROVIDER_NAME.to_string(),
            model: model_variant,
            lines,
        })
    })
    .await
    .map_err(|error| format!("等待 OCR 线程完成失败: {error}"))?
}
