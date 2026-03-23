use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use axum::Json;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::assignment_store;
use crate::error::ApiError;
use crate::path_resolver;

const F5_ENGINE_ID: &str = "f5-tts-onnx";
const F5_MODEL_VERSION: &str = "dakeqq-f5-tts-onnx";
const F5_ARCHIVE_NAME: &str = "CPU_F32.zip";
const F5_ARCHIVE_URLS: &[&str] = &[
    "https://huggingface.co/H5N1AIDS/F5-TTS-ONNX/resolve/main/CPU_F32.zip?download=1",
    "https://hf-mirror.com/H5N1AIDS/F5-TTS-ONNX/resolve/main/CPU_F32.zip?download=1",
];
const F5_VOCAB_URLS: &[&str] = &[
    "https://huggingface.co/SWivid/F5-TTS/resolve/main/F5TTS_v1_Base/vocab.txt?download=1",
    "https://hf-mirror.com/SWivid/F5-TTS/resolve/main/F5TTS_v1_Base/vocab.txt?download=1",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppTtsSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_tts_mode")]
    pub mode: String,
    #[serde(default = "default_local_engine")]
    pub active_local_engine: String,
    #[serde(default)]
    pub local: LocalTtsSettings,
    #[serde(default)]
    pub remote: RemoteTtsSettings,
}

impl Default for AppTtsSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: default_tts_mode(),
            active_local_engine: default_local_engine(),
            local: LocalTtsSettings::default(),
            remote: RemoteTtsSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTtsSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_local_engine")]
    pub engine: String,
    #[serde(default)]
    pub model_dir: String,
    #[serde(default = "default_true")]
    pub auto_download: bool,
    #[serde(default = "default_true")]
    pub auto_load: bool,
    #[serde(default = "default_tts_device")]
    pub device: String,
    #[serde(default = "default_local_status")]
    pub status: String,
    #[serde(default = "default_model_version")]
    pub model_version: String,
    #[serde(default)]
    pub last_error: Option<String>,
}

impl Default for LocalTtsSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            engine: default_local_engine(),
            model_dir: default_model_dir_string(),
            auto_download: true,
            auto_load: true,
            device: default_tts_device(),
            status: default_local_status(),
            model_version: default_model_version(),
            last_error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTtsProviderConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub voice: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub timeout_secs: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTtsSettings {
    #[serde(default = "default_remote_provider")]
    pub active_provider: String,
    #[serde(default)]
    pub openai: RemoteTtsProviderConfig,
    #[serde(default)]
    pub cosyvoice3: RemoteTtsProviderConfig,
    #[serde(default)]
    pub indextts: RemoteTtsProviderConfig,
    #[serde(default)]
    pub qwen_tts: RemoteTtsProviderConfig,
}

impl Default for RemoteTtsSettings {
    fn default() -> Self {
        Self {
            active_provider: default_remote_provider(),
            openai: RemoteTtsProviderConfig {
                api_key_env: Some("OPENAI_API_KEY".to_string()),
                model: Some("gpt-4o-mini-tts".to_string()),
                voice: Some("alloy".to_string()),
                format: Some("mp3".to_string()),
                timeout_secs: Some(30),
                ..RemoteTtsProviderConfig::default()
            },
            cosyvoice3: RemoteTtsProviderConfig::default(),
            indextts: RemoteTtsProviderConfig::default(),
            qwen_tts: RemoteTtsProviderConfig::default(),
        }
    }
}

impl Default for RemoteTtsProviderConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            api_key_env: None,
            model: None,
            voice: None,
            format: None,
            timeout_secs: Some(30),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsModelFileStatus {
    pub relative_path: String,
    pub expected_size: Option<u64>,
    pub present: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsManagementStatus {
    pub config: AppTtsSettings,
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
    pub files: Vec<TtsModelFileStatus>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Default)]
struct TtsDownloadState {
    active: bool,
    downloaded_bytes: u64,
    total_bytes: u64,
    current_file: Option<String>,
    last_error: Option<String>,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Copy)]
struct TtsModelFile {
    relative_path: &'static str,
}

const F5_MODEL_FILES: &[TtsModelFile] = &[
    TtsModelFile {
        relative_path: "F5_Transformer.onnx",
    },
    TtsModelFile {
        relative_path: "F5_Preprocess.onnx",
    },
    TtsModelFile {
        relative_path: "F5_Decode.onnx",
    },
    TtsModelFile {
        relative_path: "config.json",
    },
    TtsModelFile {
        relative_path: "vocab.txt",
    },
];

fn default_tts_mode() -> String {
    "local".to_string()
}

fn default_local_engine() -> String {
    F5_ENGINE_ID.to_string()
}

fn default_tts_device() -> String {
    "auto".to_string()
}

fn default_local_status() -> String {
    "not_installed".to_string()
}

fn default_model_version() -> String {
    F5_MODEL_VERSION.to_string()
}

fn default_remote_provider() -> String {
    "openai".to_string()
}

fn default_true() -> bool {
    true
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn default_model_dir() -> PathBuf {
    path_resolver::webot_home_dir()
        .unwrap_or_else(|_| PathBuf::from(".webot"))
        .join("shared")
        .join("models")
        .join("tts")
        .join(F5_ENGINE_ID)
}

fn default_model_dir_string() -> String {
    default_model_dir().to_string_lossy().to_string()
}

fn normalize_config(mut config: AppTtsSettings) -> AppTtsSettings {
    if config.mode.trim().is_empty() {
        config.mode = default_tts_mode();
    }
    if config.active_local_engine.trim().is_empty() {
        config.active_local_engine = default_local_engine();
    }
    if config.local.engine.trim().is_empty() {
        config.local.engine = default_local_engine();
    }
    if config.local.model_dir.trim().is_empty() {
        config.local.model_dir = default_model_dir_string();
    }
    if config.local.device.trim().is_empty() {
        config.local.device = default_tts_device();
    }
    if config.local.status.trim().is_empty() {
        config.local.status = default_local_status();
    }
    if config.local.model_version.trim().is_empty() {
        config.local.model_version = default_model_version();
    }
    if config.remote.active_provider.trim().is_empty() {
        config.remote.active_provider = default_remote_provider();
    }
    config
}

fn internal_error(message: String) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message)
}

fn download_state() -> &'static Mutex<TtsDownloadState> {
    static DOWNLOAD_STATE: OnceLock<Mutex<TtsDownloadState>> = OnceLock::new();
    DOWNLOAD_STATE.get_or_init(|| Mutex::new(TtsDownloadState::default()))
}

fn model_dir_from_config(config: &AppTtsSettings) -> PathBuf {
    let trimmed = config.local.model_dir.trim();
    if trimmed.is_empty() {
        default_model_dir()
    } else {
        PathBuf::from(trimmed)
    }
}

fn compute_model_status(config: AppTtsSettings, state: &TtsDownloadState) -> TtsManagementStatus {
    let model_dir = model_dir_from_config(&config);
    let model_root_dir = model_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| model_dir.clone());

    let mut missing_files = Vec::new();
    let mut files = Vec::with_capacity(F5_MODEL_FILES.len());
    let mut total_present_bytes = 0_u64;
    for item in F5_MODEL_FILES {
        let path = model_dir.join(item.relative_path);
        let metadata = fs::metadata(&path).ok();
        let present = metadata.is_some();
        let size = metadata.as_ref().map(|value| value.len());
        if !present {
            missing_files.push(item.relative_path.to_string());
        } else if let Some(file_size) = size {
            total_present_bytes = total_present_bytes.saturating_add(file_size);
        }
        files.push(TtsModelFileStatus {
            relative_path: item.relative_path.to_string(),
            expected_size: None,
            present,
            size,
        });
    }

    let model_ready = missing_files.is_empty();
    let total_bytes = if state.total_bytes > 0 {
        state.total_bytes
    } else {
        total_present_bytes
    };
    let downloaded_bytes = if state.active {
        state.downloaded_bytes.min(total_bytes.max(state.downloaded_bytes))
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

    TtsManagementStatus {
        config,
        provider_available: true,
        model_ready,
        download_active: state.active,
        downloaded_bytes,
        total_bytes,
        progress_percent,
        current_file: state.current_file.clone(),
        last_error: state.last_error.clone(),
        model_root_dir: model_root_dir.to_string_lossy().to_string(),
        model_dir: model_dir.to_string_lossy().to_string(),
        missing_files,
        files,
        updated_at_ms: state.updated_at_ms,
    }
}

async fn load_config() -> Result<AppTtsSettings, String> {
    let stored = assignment_store::get_tts_config()?;
    match stored {
        Some(value) => serde_json::from_value::<AppTtsSettings>(value)
            .map(normalize_config)
            .map_err(|error| format!("解析 TTS 配置失败: {error}")),
        None => Ok(AppTtsSettings::default()),
    }
}

async fn persist_config(config: &AppTtsSettings) -> Result<(), String> {
    assignment_store::set_tts_config(
        &serde_json::to_value(config).map_err(|error| format!("序列化 TTS 配置失败: {error}"))?,
    )
}

async fn refresh_status() -> Result<TtsManagementStatus, String> {
    let config = load_config().await?;
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

async fn estimate_total_bytes() -> u64 {
    let client = match reqwest::Client::builder().user_agent("weBot/1.0").build() {
        Ok(value) => value,
        Err(_) => return 0,
    };
    let archive_len = head_content_length(&client, F5_ARCHIVE_URLS).await.unwrap_or(0);
    let vocab_len = head_content_length(&client, F5_VOCAB_URLS).await.unwrap_or(0);
    archive_len.saturating_add(vocab_len)
}

async fn head_content_length(client: &reqwest::Client, urls: &[&str]) -> Option<u64> {
    for url in urls {
        let response = match client.head(*url).send().await {
            Ok(value) => value,
            Err(_) => continue,
        };
        if response.status().is_success() {
            return response.content_length();
        }
    }
    None
}

async fn get_with_fallback(
    client: &reqwest::Client,
    urls: &[&str],
    label: &str,
) -> Result<reqwest::Response, String> {
    let mut failures = Vec::new();
    for url in urls {
        let response = match client.get(*url).send().await {
            Ok(value) => value,
            Err(error) => {
                failures.push(format!("{url} -> {error}"));
                continue;
            }
        };
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        failures.push(format!("{url} -> HTTP {status}: {snippet}"));
    }
    Err(format!(
        "下载 {label} 失败，已尝试 {} 个地址: {}",
        urls.len(),
        failures.join(" | ")
    ))
}

fn has_required_archive_files(model_dir: &Path) -> bool {
    F5_MODEL_FILES
        .iter()
        .filter(|item| item.relative_path != "vocab.txt")
        .all(|item| model_dir.join(item.relative_path).is_file())
}

fn extract_required_files_from_archive(archive_path: &Path, model_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path)
        .map_err(|error| format!("打开模型压缩包失败({}): {error}", archive_path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("解析模型压缩包失败({}): {error}", archive_path.display()))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取模型压缩包条目失败({}): {error}", archive_path.display()))?;
        if entry.is_dir() {
            continue;
        }
        let entry_path = Path::new(entry.name());
        let Some(file_name) = entry_path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !F5_MODEL_FILES
            .iter()
            .filter(|item| item.relative_path != "vocab.txt")
            .any(|item| item.relative_path == file_name)
        {
            continue;
        }
        let target_path = model_dir.join(file_name);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("创建模型解压目录失败({}): {error}", parent.display())
            })?;
        }
        let mut output = fs::File::create(&target_path)
            .map_err(|error| format!("创建解压文件失败({}): {error}", target_path.display()))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("写入解压文件失败({}): {error}", target_path.display()))?;
        output
            .flush()
            .map_err(|error| format!("刷新解压文件失败({}): {error}", target_path.display()))?;
    }

    let missing = F5_MODEL_FILES
        .iter()
        .filter(|item| item.relative_path != "vocab.txt")
        .map(|item| item.relative_path)
        .filter(|relative_path| !model_dir.join(relative_path).is_file())
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "模型压缩包缺少关键文件: {}",
            missing.join(", ")
        ));
    }
    Ok(())
}

async fn download_model_files(config: &AppTtsSettings) -> Result<(), String> {
    let model_dir = model_dir_from_config(config);
    fs::create_dir_all(&model_dir)
        .map_err(|error| format!("创建 TTS 模型目录失败({}): {error}", model_dir.display()))?;

    let client = reqwest::Client::builder()
        .user_agent("weBot/1.0")
        .build()
        .map_err(|error| format!("初始化 TTS 下载客户端失败: {error}"))?;
    let mut completed_bytes = 0_u64;
    let mut total_bytes = estimate_total_bytes().await;
    let need_archive = !has_required_archive_files(&model_dir);
    let vocab_path = model_dir.join("vocab.txt");
    let need_vocab = !vocab_path.is_file();
    set_download_state(true, 0, total_bytes, None, None).await;

    if need_archive {
        let temp_archive_path = model_dir.join("CPU_F32.zip.download");
        set_download_state(
            true,
            completed_bytes,
            total_bytes,
            Some(F5_ARCHIVE_NAME.to_string()),
            None,
        )
        .await;

        let response = get_with_fallback(&client, F5_ARCHIVE_URLS, F5_ARCHIVE_NAME).await?;
        let expected_len = response.content_length().unwrap_or(0);
        total_bytes = total_bytes.max(expected_len);
        let mut stream = response.bytes_stream();
        let mut output = tokio::fs::File::create(&temp_archive_path).await.map_err(|error| {
            format!(
                "创建模型压缩包临时文件失败({}): {error}",
                temp_archive_path.display()
            )
        })?;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("读取下载流失败: {error}"))?;
            tokio::io::AsyncWriteExt::write_all(&mut output, &chunk)
                .await
                .map_err(|error| {
                    format!(
                        "写入模型压缩包失败({}): {error}",
                        temp_archive_path.display()
                    )
                })?;
            completed_bytes = completed_bytes.saturating_add(chunk.len() as u64);
            let next_total = total_bytes.max(completed_bytes);
            set_download_state(
                true,
                completed_bytes,
                next_total,
                Some(F5_ARCHIVE_NAME.to_string()),
                None,
            )
            .await;
        }
        tokio::io::AsyncWriteExt::flush(&mut output).await.map_err(|error| {
            format!(
                "刷新模型压缩包失败({}): {error}",
                temp_archive_path.display()
            )
        })?;
        drop(output);

        extract_required_files_from_archive(&temp_archive_path, &model_dir)?;
        let _ = fs::remove_file(&temp_archive_path);
    }

    if need_vocab {
        let temp_vocab_path = vocab_path.with_extension("download");
        set_download_state(
            true,
            completed_bytes,
            total_bytes,
            Some("vocab.txt".to_string()),
            None,
        )
        .await;

        let response = get_with_fallback(&client, F5_VOCAB_URLS, "vocab.txt").await?;
        let expected_len = response.content_length().unwrap_or(0);
        total_bytes = total_bytes.max(completed_bytes.saturating_add(expected_len));
        let mut stream = response.bytes_stream();
        let mut output = tokio::fs::File::create(&temp_vocab_path).await.map_err(|error| {
            format!("创建词表临时文件失败({}): {error}", temp_vocab_path.display())
        })?;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("读取下载流失败: {error}"))?;
            tokio::io::AsyncWriteExt::write_all(&mut output, &chunk)
                .await
                .map_err(|error| {
                    format!("写入词表文件失败({}): {error}", temp_vocab_path.display())
                })?;
            completed_bytes = completed_bytes.saturating_add(chunk.len() as u64);
            let next_total = total_bytes.max(completed_bytes);
            set_download_state(
                true,
                completed_bytes,
                next_total,
                Some("vocab.txt".to_string()),
                None,
            )
            .await;
        }
        tokio::io::AsyncWriteExt::flush(&mut output)
            .await
            .map_err(|error| format!("刷新词表文件失败({}): {error}", temp_vocab_path.display()))?;
        drop(output);
        fs::rename(&temp_vocab_path, &vocab_path).map_err(|error| {
            format!(
                "写入词表文件失败({} -> {}): {error}",
                temp_vocab_path.display(),
                vocab_path.display()
            )
        })?;
    }

    let missing_files = F5_MODEL_FILES
        .iter()
        .map(|item| item.relative_path)
        .filter(|relative_path| !model_dir.join(relative_path).is_file())
        .collect::<Vec<_>>();
    if !missing_files.is_empty() {
        return Err(format!(
            "模型下载完成后仍缺少文件: {}",
            missing_files.join(", ")
        ));
    }

    set_download_state(false, completed_bytes, total_bytes, None, None).await;
    Ok(())
}

async fn save_status_override(status: &str, last_error: Option<String>) -> Result<(), String> {
    let mut config = load_config().await?;
    config.local.status = status.to_string();
    config.local.last_error = last_error;
    persist_config(&config).await
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentTtsConfigRecord {
    #[serde(default)]
    enabled: bool,
    #[serde(default = "default_agent_service_mode")]
    service_mode: String,
    #[serde(default)]
    speaker_profile_id: Option<String>,
    #[serde(default)]
    speed: Option<f32>,
    #[serde(default)]
    pitch: Option<f32>,
    #[serde(default = "default_split_strategy")]
    split_strategy: String,
    #[serde(default = "default_max_chunk_chars")]
    max_chunk_chars: usize,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentSpeakerProfileRecord {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default = "default_local_engine")]
    engine: String,
    #[serde(default)]
    ref_audio_path: Option<String>,
    #[serde(default)]
    ref_text: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LocalF5SynthesisPlan {
    pub requested_text: String,
    pub chunks: Vec<String>,
    pub model_dir: PathBuf,
    pub reference_audio_path: PathBuf,
    pub reference_text: String,
    pub speaker_profile_id: String,
    pub speaker_name: String,
    pub device: String,
    pub speed: f32,
    pub pitch: f32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct LocalF5SynthesisResult {
    pub audio_bytes: Vec<u8>,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub provider: String,
    pub engine: String,
    pub speaker_profile_id: String,
    pub speaker_name: String,
    pub warnings: Vec<String>,
    pub device: String,
    pub requested_text: String,
    pub chunk_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonSynthesisResponse {
    #[serde(default)]
    output_path: String,
    #[serde(default)]
    sample_rate: u32,
    #[serde(default)]
    duration_secs: f64,
    #[serde(default)]
    chunks: usize,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    engine: String,
    #[serde(default)]
    device: String,
    #[serde(default)]
    warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct PythonCommandCandidate {
    program: String,
    args: Vec<String>,
}

fn default_agent_service_mode() -> String {
    "inherit_global".to_string()
}

fn default_split_strategy() -> String {
    "sentence".to_string()
}

fn default_max_chunk_chars() -> usize {
    180
}

fn normalize_agent_tts_config(mut config: AgentTtsConfigRecord) -> AgentTtsConfigRecord {
    if config.service_mode.trim().is_empty() {
        config.service_mode = default_agent_service_mode();
    }
    if config.split_strategy.trim().is_empty() {
        config.split_strategy = default_split_strategy();
    }
    if config.max_chunk_chars == 0 {
        config.max_chunk_chars = default_max_chunk_chars();
    }
    config
}

fn normalize_speaker_profile(mut profile: AgentSpeakerProfileRecord) -> Option<AgentSpeakerProfileRecord> {
    profile.id = profile.id.trim().to_string();
    profile.name = profile.name.trim().to_string();
    profile.engine = if profile.engine.trim().is_empty() {
        default_local_engine()
    } else {
        profile.engine.trim().to_string()
    };
    profile.ref_audio_path = profile
        .ref_audio_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    profile.ref_text = profile
        .ref_text
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    profile.language = profile
        .language
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    profile.notes = profile
        .notes
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if profile.id.is_empty() || profile.name.is_empty() {
        return None;
    }
    Some(profile)
}

fn parse_agent_tts_config(raw: Option<&Value>) -> Result<AgentTtsConfigRecord, String> {
    match raw {
        Some(value) if !value.is_null() => serde_json::from_value::<AgentTtsConfigRecord>(value.clone())
            .map(normalize_agent_tts_config)
            .map_err(|error| format!("解析智能体 TTS 配置失败: {error}")),
        _ => Ok(AgentTtsConfigRecord::default()),
    }
}

fn parse_speaker_profiles(raw: Option<&Value>) -> Result<Vec<AgentSpeakerProfileRecord>, String> {
    match raw {
        Some(value) if !value.is_null() => serde_json::from_value::<Vec<AgentSpeakerProfileRecord>>(value.clone())
            .map_err(|error| format!("解析音色样本配置失败: {error}"))
            .map(|items| items.into_iter().filter_map(normalize_speaker_profile).collect()),
        _ => Ok(Vec::new()),
    }
}

fn normalize_relative_data_path(data_root: &Path, raw: &str) -> Result<PathBuf, String> {
    let relative = PathBuf::from(raw.trim());
    if relative.is_absolute() {
        return Ok(relative);
    }
    if relative
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("参考音频路径不允许包含 ..".to_string());
    }
    Ok(data_root.join(relative))
}

fn resolve_reference_audio_path(data_root: &Path, raw: &str) -> Result<PathBuf, String> {
    let candidate = normalize_relative_data_path(data_root, raw)?;
    if !candidate.is_file() {
        return Err(format!(
            "参考音频不存在，请先上传有效的 WAV 样本: {}",
            candidate.display()
        ));
    }
    let is_wav = candidate
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("wav"))
        .unwrap_or(false);
    if !is_wav {
        return Err(format!(
            "当前本地 F5 仅支持 WAV 参考音频，请重新上传 .wav 文件: {}",
            candidate.display()
        ));
    }
    Ok(candidate)
}

fn resolve_effective_service_mode(global: &AppTtsSettings, agent: &AgentTtsConfigRecord) -> String {
    match agent.service_mode.trim() {
        "local_f5" => "local_f5".to_string(),
        "remote_openai" => "remote_openai".to_string(),
        "remote_cosyvoice3" => "remote_cosyvoice3".to_string(),
        "remote_indextts" => "remote_indextts".to_string(),
        "remote_qwen_tts" => "remote_qwen_tts".to_string(),
        _ => {
            if global.mode.eq_ignore_ascii_case("remote") {
                format!("remote_{}", global.remote.active_provider.trim())
            } else {
                "local_f5".to_string()
            }
        }
    }
}

fn pick_speaker_profile<'a>(
    profiles: &'a [AgentSpeakerProfileRecord],
    requested_id: Option<&str>,
    config_default_id: Option<&str>,
) -> Option<&'a AgentSpeakerProfileRecord> {
    let requested = requested_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(target) = requested {
        if let Some(hit) = profiles.iter().find(|item| item.id.eq_ignore_ascii_case(target)) {
            return Some(hit);
        }
    }
    let config_default = config_default_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(target) = config_default {
        if let Some(hit) = profiles.iter().find(|item| item.id.eq_ignore_ascii_case(target)) {
            return Some(hit);
        }
    }
    profiles.first()
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn split_by_boundaries(text: &str, boundary_chars: &[char]) -> Vec<String> {
    let mut buffer = String::new();
    let mut output = Vec::new();
    for ch in text.chars() {
        buffer.push(ch);
        if boundary_chars.contains(&ch) {
            let trimmed = buffer.trim();
            if !trimmed.is_empty() {
                output.push(trimmed.to_string());
            }
            buffer.clear();
        }
    }
    let tail = buffer.trim();
    if !tail.is_empty() {
        output.push(tail.to_string());
    }
    output
}

fn hard_wrap_text(text: &str, max_chars: usize) -> Vec<String> {
    let limit = max_chars.max(1);
    let chars = text.chars().collect::<Vec<_>>();
    let mut output = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + limit).min(chars.len());
        let chunk = chars[start..end].iter().collect::<String>();
        let trimmed = chunk.trim();
        if !trimmed.is_empty() {
            output.push(trimmed.to_string());
        }
        start = end;
    }
    output
}

fn chunk_segments_with_limit(segments: Vec<String>, max_chars: usize) -> Vec<String> {
    let limit = max_chars.max(1);
    let mut output = Vec::new();
    let mut current = String::new();
    for segment in segments {
        let normalized = collapse_whitespace(&segment);
        if normalized.is_empty() {
            continue;
        }
        if normalized.chars().count() > limit {
            if !current.trim().is_empty() {
                output.push(current.trim().to_string());
                current.clear();
            }
            output.extend(hard_wrap_text(&normalized, limit));
            continue;
        }
        let current_len = current.chars().count();
        let next_len = normalized.chars().count();
        if current_len > 0 && current_len + 1 + next_len > limit {
            output.push(current.trim().to_string());
            current.clear();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(&normalized);
    }
    if !current.trim().is_empty() {
        output.push(current.trim().to_string());
    }
    output
}

fn split_text_chunks(text: &str, strategy: &str, max_chars: usize) -> Vec<String> {
    let normalized = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string();
    if normalized.is_empty() {
        return Vec::new();
    }

    let paragraph_segments = normalized
        .split("\n\n")
        .flat_map(|block| block.lines())
        .map(collapse_whitespace)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    let sentence_boundaries = ['。', '！', '？', '.', '!', '?', ';', '；'];
    let comma_boundaries = ['，', ',', '、', '：', ':'];

    let mut base_segments = match strategy.trim() {
        "paragraph" => paragraph_segments,
        "sentence" => paragraph_segments
            .into_iter()
            .flat_map(|item| split_by_boundaries(&item, &sentence_boundaries))
            .collect::<Vec<_>>(),
        _ => paragraph_segments
            .into_iter()
            .flat_map(|item| split_by_boundaries(&item, &sentence_boundaries))
            .collect::<Vec<_>>(),
    };

    if base_segments.is_empty() {
        base_segments.push(normalized.clone());
    }

    let mut merged = chunk_segments_with_limit(base_segments, max_chars);
    if merged.iter().any(|item| item.chars().count() > max_chars.max(1)) {
        merged = merged
            .into_iter()
            .flat_map(|item| {
                if item.chars().count() <= max_chars.max(1) {
                    return vec![item];
                }
                let refined = split_by_boundaries(&item, &comma_boundaries);
                let refined_chunks = chunk_segments_with_limit(refined, max_chars);
                if refined_chunks.is_empty() {
                    hard_wrap_text(&item, max_chars)
                } else {
                    refined_chunks
                }
            })
            .collect();
    }
    if merged.is_empty() {
        merged.push(collapse_whitespace(&normalized));
    }
    merged
}

fn python_command_candidates(preferred_paths: &[PathBuf]) -> Vec<PythonCommandCandidate> {
    let mut output = Vec::new();
    for path in preferred_paths {
        let value = path.to_string_lossy().trim().to_string();
        if !value.is_empty() {
            output.push(PythonCommandCandidate {
                program: value,
                args: Vec::new(),
            });
        }
    }
    if let Some(raw) = env::var_os("WEBOT_TTS_PYTHON") {
        let value = PathBuf::from(raw).to_string_lossy().trim().to_string();
        if !value.is_empty() {
            output.push(PythonCommandCandidate {
                program: value,
                args: Vec::new(),
            });
        }
    }
    output.push(PythonCommandCandidate {
        program: "python".to_string(),
        args: Vec::new(),
    });
    output.push(PythonCommandCandidate {
        program: "python3".to_string(),
        args: Vec::new(),
    });
    output.push(PythonCommandCandidate {
        program: "py".to_string(),
        args: vec!["-3".to_string()],
    });
    output
}

fn preferred_tts_python_paths(model_dir: &Path) -> Vec<PathBuf> {
    let mut output = Vec::new();
    let venv_root = model_dir.join(".venv");
    if cfg!(windows) {
        output.push(venv_root.join("Scripts").join("python.exe"));
    } else {
        output.push(venv_root.join("bin").join("python3"));
        output.push(venv_root.join("bin").join("python"));
    }
    output
}

async fn run_command_capture(command: &mut Command, label: &str) -> Result<String, String> {
    let output = command
        .output()
        .await
        .map_err(|error| format!("{label}失败: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        if stdout.is_empty() && !stderr.is_empty() {
            Ok(stderr)
        } else {
            Ok(stdout)
        }
    } else if !stderr.is_empty() {
        Err(format!("{label}失败: {stderr}"))
    } else if !stdout.is_empty() {
        Err(format!("{label}失败: {stdout}"))
    } else {
        Err(format!("{label}失败: 退出码 {}", output.status))
    }
}

fn runtime_package_specs() -> Vec<&'static str> {
    let mut packages = vec!["pip", "setuptools", "wheel", "numpy", "jieba", "pypinyin"];
    if cfg!(windows) {
        packages.push("onnxruntime-directml==1.24.4");
    } else {
        packages.push("onnxruntime==1.23.2");
    }
    packages
}

async fn install_tts_runtime_dependencies(model_dir: &Path) -> Result<PathBuf, String> {
    let preferred_paths = preferred_tts_python_paths(model_dir);
    let venv_python = preferred_paths
        .first()
        .cloned()
        .ok_or_else(|| "无法确定 TTS 专用 Python 路径".to_string())?;
    if !venv_python.is_file() {
        let venv_root = venv_python
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| "无法确定 TTS 虚拟环境目录".to_string())?;
        fs::create_dir_all(venv_root)
            .map_err(|error| format!("创建 TTS 虚拟环境目录失败({}): {error}", venv_root.display()))?;
        let bootstrap_candidates = python_command_candidates(&[]);
        let mut last_error = String::new();
        let mut created = false;
        for candidate in bootstrap_candidates {
            let mut command = Command::new(&candidate.program);
            command.args(&candidate.args);
            command.arg("-m");
            command.arg("venv");
            command.arg(venv_root);
            match run_command_capture(&mut command, "创建 TTS 专用 Python 环境").await {
                Ok(_) => {
                    created = true;
                    break;
                }
                Err(error) => {
                    last_error = error;
                }
            }
        }
        if !created {
            return Err(if last_error.is_empty() {
                "未找到可用的 Python 解释器，无法创建 TTS 专用环境".to_string()
            } else {
                last_error
            });
        }
    }

    let mut install_command = Command::new(&venv_python);
    install_command.arg("-m");
    install_command.arg("pip");
    install_command.arg("install");
    install_command.arg("--upgrade");
    install_command.args(runtime_package_specs());
    run_command_capture(&mut install_command, "安装 TTS 加速运行时").await?;

    let mut probe_command = Command::new(&venv_python);
    probe_command.arg("-c");
    probe_command.arg("import json, onnxruntime as ort; print(json.dumps(ort.get_available_providers(), ensure_ascii=False))");
    let providers = run_command_capture(&mut probe_command, "验证 TTS 运行时").await?;
    if cfg!(windows) && !providers.contains("DmlExecutionProvider") {
        return Err(format!(
            "TTS 加速环境安装完成，但未检测到 DirectML 执行器: {providers}"
        ));
    }
    Ok(venv_python)
}

pub async fn build_local_f5_synthesis_plan(
    agent_id: &str,
    data_root: &Path,
    text: &str,
    speaker_profile_id_override: Option<&str>,
) -> Result<LocalF5SynthesisPlan, String> {
    let requested_text = collapse_whitespace(text);
    if requested_text.is_empty() {
        return Err("待合成文本不能为空".to_string());
    }

    let global_config = load_config().await?;
    if !global_config.enabled {
        return Err("全局 TTS 尚未开启，请先在设置中启用本地语音服务".to_string());
    }

    let status = {
        let state = download_state().lock().await.clone();
        compute_model_status(global_config.clone(), &state)
    };
    if !status.model_ready {
        return Err("本地 F5-TTS-ONNX 模型尚未下载完整，请先在设置页完成下载".to_string());
    }
    if !global_config.local.enabled {
        return Err("本地 TTS 引擎未开启，请先在设置页启用本地 F5".to_string());
    }

    let profile = assignment_store::get_agent_profile_override(agent_id)?;
    let agent_config = parse_agent_tts_config(profile.as_ref().and_then(|item| item.tts_config.as_ref()))?;
    if !agent_config.enabled {
        return Err("当前智能体未开启 TTS，请先在智能体编辑页启用 TTS 服务".to_string());
    }

    let effective_mode = resolve_effective_service_mode(&global_config, &agent_config);
    if effective_mode != "local_f5" {
        return Err(format!(
            "当前智能体选择的是 `{effective_mode}`，远程 TTS 仍为预留状态，本期仅支持本地 F5-TTS-ONNX"
        ));
    }

    let speaker_profiles = parse_speaker_profiles(profile.as_ref().and_then(|item| item.speaker_profiles.as_ref()))?;
    let speaker = pick_speaker_profile(
        &speaker_profiles,
        speaker_profile_id_override,
        agent_config.speaker_profile_id.as_deref(),
    )
    .ok_or_else(|| "当前智能体尚未配置可用音色样本，请先上传参考音频并填写参考文本".to_string())?;

    if !speaker.engine.eq_ignore_ascii_case(F5_ENGINE_ID) {
        return Err(format!(
            "音色 `{}` 使用的引擎不是 F5-TTS-ONNX，当前版本暂不支持",
            speaker.name
        ));
    }

    let raw_ref_path = speaker
        .ref_audio_path
        .as_deref()
        .ok_or_else(|| format!("音色 `{}` 缺少参考音频路径", speaker.name))?;
    let reference_audio_path = resolve_reference_audio_path(data_root, raw_ref_path)?;
    let reference_text = speaker
        .ref_text
        .as_ref()
        .map(|value| collapse_whitespace(value))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("音色 `{}` 缺少参考文本", speaker.name))?;

    let speed = agent_config.speed.unwrap_or(1.0).clamp(0.3, 2.5);
    let pitch = agent_config.pitch.unwrap_or(1.0).clamp(0.5, 2.0);
    let chunks = split_text_chunks(
        &requested_text,
        &agent_config.split_strategy,
        agent_config.max_chunk_chars.max(40),
    );
    let mut warnings = Vec::new();
    if (pitch - 1.0).abs() > 0.01 {
        warnings.push("当前本地 F5-TTS-ONNX 接口暂未实现音调偏移，已忽略 pitch 参数".to_string());
    }

    Ok(LocalF5SynthesisPlan {
        requested_text,
        chunks,
        model_dir: model_dir_from_config(&global_config),
        reference_audio_path,
        reference_text,
        speaker_profile_id: speaker.id.clone(),
        speaker_name: speaker.name.clone(),
        device: global_config.local.device.clone(),
        speed,
        pitch,
        warnings,
    })
}

fn script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("f5_tts_infer.py")
}

pub async fn synthesize_local_f5(plan: &LocalF5SynthesisPlan) -> Result<LocalF5SynthesisResult, String> {
    let script = script_path();
    if !script.is_file() {
        return Err(format!("本地 F5 推理脚本不存在: {}", script.display()));
    }

    let temp_root = env::temp_dir().join("webot-f5-tts");
    fs::create_dir_all(&temp_root)
        .map_err(|error| format!("创建 TTS 临时目录失败({}): {error}", temp_root.display()))?;
    let request_path = temp_root.join(format!("request-{}.json", Uuid::new_v4()));
    let output_path = temp_root.join(format!("output-{}.wav", Uuid::new_v4()));

    let payload = json!({
        "modelDir": plan.model_dir.to_string_lossy().to_string(),
        "refAudioPath": plan.reference_audio_path.to_string_lossy().to_string(),
        "refText": plan.reference_text,
        "texts": plan.chunks,
        "speed": plan.speed,
        "device": plan.device,
        "outputPath": output_path.to_string_lossy().to_string()
    });
    fs::write(
        &request_path,
        serde_json::to_vec_pretty(&payload).map_err(|error| format!("序列化 TTS 请求失败: {error}"))?,
    )
    .map_err(|error| format!("写入 TTS 请求文件失败({}): {error}", request_path.display()))?;

    let preferred_paths = preferred_tts_python_paths(&plan.model_dir);
    let candidates = python_command_candidates(&preferred_paths);
    let mut last_error = String::new();
    for candidate in candidates {
        let mut command = Command::new(&candidate.program);
        command.args(&candidate.args);
        command.arg(&script);
        command.arg("--request");
        command.arg(&request_path);
        let output = match command.output().await {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                last_error = format!("未找到 Python 命令: {}", candidate.program);
                continue;
            }
            Err(error) => {
                last_error = format!("启动 Python 推理进程失败({}): {error}", candidate.program);
                continue;
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !output.status.success() {
            last_error = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("Python 推理进程退出码异常: {}", output.status)
            };
            continue;
        }

        let parsed = serde_json::from_str::<PythonSynthesisResponse>(&stdout)
            .map_err(|error| format!("解析 Python 推理结果失败: {error}; 原始输出: {stdout}"))?;
        let audio_path = if parsed.output_path.trim().is_empty() {
            output_path.clone()
        } else {
            PathBuf::from(parsed.output_path.trim())
        };
        let audio_bytes = fs::read(&audio_path)
            .map_err(|error| format!("读取生成音频失败({}): {error}", audio_path.display()))?;
        let _ = fs::remove_file(&request_path);
        let _ = fs::remove_file(&audio_path);
        let mut warnings = plan.warnings.clone();
        warnings.extend(parsed.warnings);
        warnings.sort();
        warnings.dedup();
        return Ok(LocalF5SynthesisResult {
            audio_bytes,
            duration_secs: parsed.duration_secs,
            sample_rate: parsed.sample_rate.max(24_000),
            provider: if parsed.provider.trim().is_empty() {
                "local".to_string()
            } else {
                parsed.provider
            },
            engine: if parsed.engine.trim().is_empty() {
                F5_ENGINE_ID.to_string()
            } else {
                parsed.engine
            },
            speaker_profile_id: plan.speaker_profile_id.clone(),
            speaker_name: plan.speaker_name.clone(),
            warnings,
            device: if parsed.device.trim().is_empty() {
                plan.device.clone()
            } else {
                parsed.device
            },
            requested_text: plan.requested_text.clone(),
            chunk_count: parsed.chunks.max(plan.chunks.len()),
        });
    }

    let _ = fs::remove_file(&request_path);
    let _ = fs::remove_file(&output_path);
    if last_error.is_empty() {
        last_error = "未找到可用的 Python 解释器，请安装 Python 3 或设置 WEBOT_TTS_PYTHON".to_string();
    }
    Err(last_error)
}

pub async fn get_tts_config() -> Result<Json<Value>, ApiError> {
    let config = load_config().await.map_err(internal_error)?;
    Ok(Json(json!({ "config": config })))
}

pub async fn set_tts_config(Json(payload): Json<Value>) -> Result<Json<Value>, ApiError> {
    let config = serde_json::from_value::<AppTtsSettings>(payload)
        .map(normalize_config)
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("TTS 配置格式错误: {error}"),
            )
        })?;
    persist_config(&config).await.map_err(internal_error)?;
    Ok(Json(json!({ "config": config })))
}

pub async fn get_tts_status() -> Result<Json<Value>, ApiError> {
    let status = refresh_status().await.map_err(internal_error)?;
    Ok(Json(json!({ "status": status })))
}

pub async fn start_tts_download() -> Result<Json<Value>, ApiError> {
    let status = refresh_status().await.map_err(internal_error)?;
    if status.model_ready {
        return Ok(Json(json!({ "status": status })));
    }

    {
        let guard = download_state().lock().await;
        if guard.active {
            return Ok(Json(json!({ "status": compute_model_status(status.config, &guard) })));
        }
    }

    let config = status.config.clone();
    tokio::spawn(async move {
        if let Err(error) = save_status_override("downloading", None).await {
            tracing::warn!(error = %error, "persist tts downloading status failed");
        }
        match download_model_files(&config).await {
            Ok(_) => {
                if let Err(error) = save_status_override("downloaded", None).await {
                    tracing::warn!(error = %error, "persist tts downloaded status failed");
                }
            }
            Err(error) => {
                set_download_state(false, 0, 0, None, Some(error.clone())).await;
                if let Err(persist_error) = save_status_override("failed", Some(error.clone())).await {
                    tracing::warn!(
                        error = %persist_error,
                        cause = %error,
                        "persist tts failed status failed"
                    );
                }
            }
        }
    });

    let next = refresh_status().await.map_err(internal_error)?;
    Ok(Json(json!({ "status": next })))
}

pub async fn load_tts_engine() -> Result<Json<Value>, ApiError> {
    let status = refresh_status().await.map_err(internal_error)?;
    if !status.model_ready {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "本地 F5-TTS-ONNX 模型未下载完整，无法加载",
        ));
    }
    let config = status.config.clone();
    let model_dir = model_dir_from_config(&config);
    if !model_dir.is_dir() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "本地 TTS 模型目录不存在",
        ));
    }
    save_status_override("loaded", None)
        .await
        .map_err(internal_error)?;
    let next = refresh_status().await.map_err(internal_error)?;
    Ok(Json(json!({ "status": next })))
}

pub async fn unload_tts_engine() -> Result<Json<Value>, ApiError> {
    save_status_override("downloaded", None)
        .await
        .map_err(internal_error)?;
    let next = refresh_status().await.map_err(internal_error)?;
    Ok(Json(json!({ "status": next })))
}

pub async fn install_tts_runtime() -> Result<Json<Value>, ApiError> {
    let config = load_config().await.map_err(internal_error)?;
    let model_dir = model_dir_from_config(&config);
    install_tts_runtime_dependencies(&model_dir)
        .await
        .map_err(internal_error)?;
    let next = refresh_status().await.map_err(internal_error)?;
    Ok(Json(json!({ "status": next })))
}
