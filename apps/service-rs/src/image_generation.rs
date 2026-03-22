use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::http::StatusCode;
use axum::Json;
use base64::Engine;
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::sleep;

use crate::error::ApiError;
use crate::path_resolver;

const DEFAULT_OUTPUT_PREFIX: &str = "webot-image";
const MAX_BASE64_BYTES: usize = 10 * 1024 * 1024;
const FIXED_IMAGE_EDIT_INSTRUCTION_PREFIX: &str = "Describe the key features of the input image (color, shape, size, texture, objects, background), then explain how the user's text instruction should alter or modify the image. Generate a new image that meets the user's requirements while maintaining consistency with the original input where appropriate.";
const MODELSCOPE_ASYNC_HEADER: &str = "x-modelscope-async-mode";
const MODELSCOPE_TASK_TYPE_HEADER: &str = "x-modelscope-task-type";
const MODELSCOPE_SECRET_HEADER: &str = "x-modelscope-api-secret";
const COMFYUI_TEMPLATE_ROOT_DIR: &str = "comfyui";
const COMFYUI_GENERATE_TEMPLATE_REL_PATH: &str = "generate/Z-Image-Turbo-api.json";
const COMFYUI_EDIT_TEMPLATE_REL_PATH: &str = "edit/Qwen-AIO-api.json";
const COMFYUI_GENERATE_REQUIRED_NODES: &[(&str, &str)] = &[
    (
        "CheckpointLoaderSimple",
        "生成 workflow 的 CheckpointLoaderSimple",
    ),
    (
        "Lora Loader Stack (rgthree)",
        "生成 workflow 的 rgthree LoRA Stack",
    ),
    ("KSampler", "生成 workflow 的 KSampler"),
    (
        "EmptySD3LatentImage",
        "生成 workflow 的 EmptySD3LatentImage",
    ),
    ("CLIPTextEncode", "生成 workflow 的 CLIPTextEncode"),
    ("SaveImage", "生成 workflow 的 SaveImage"),
];

const COMFYUI_EDIT_REQUIRED_NODES: &[(&str, &str)] = &[
    (
        "CheckpointLoaderSimple",
        "修改 workflow 的 CheckpointLoaderSimple",
    ),
    (
        "QwenImageIntegratedKSampler",
        "修改 workflow 的 QwenImageIntegratedKSampler",
    ),
    (
        "LoraLoaderModelOnly",
        "修改 workflow 的 LoraLoaderModelOnly",
    ),
    (
        "LayerUtility: ImageScaleByAspectRatio V2",
        "修改 workflow 的 LayerUtility 缩放节点",
    ),
    ("CR Prompt Text", "修改 workflow 的 CR Prompt Text"),
    ("LoadImage", "修改 workflow 的 LoadImage"),
    ("SaveImage", "修改 workflow 的 SaveImage"),
];

#[derive(Debug, Default, Clone, Copy)]
struct ImageEditScope {
    changes_composition: bool,
    changes_pose: bool,
    changes_camera: bool,
    changes_outfit: bool,
    changes_background: bool,
    changes_hair: bool,
    changes_accessories: bool,
    changes_makeup: bool,
    changes_body: bool,
}

fn default_comfyui_server_url() -> String {
    "http://127.0.0.1:8188".to_string()
}

fn default_comfyui_steps() -> u32 {
    20
}

fn default_comfyui_cfg_scale() -> f32 {
    7.0
}

fn default_comfyui_sampler_name() -> String {
    "euler".to_string()
}

fn default_comfyui_scheduler() -> String {
    "normal".to_string()
}

fn default_comfyui_width() -> u32 {
    1024
}

fn default_comfyui_height() -> u32 {
    1024
}

fn default_modelscope_base_url() -> String {
    "https://api-inference.modelscope.cn".to_string()
}

fn default_modelscope_model() -> String {
    "Tongyi-MAI/Z-Image-Turbo".to_string()
}

fn default_empty_model() -> String {
    String::new()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImageGenerationProvider {
    Comfyui,
    Modelscope,
}

impl Default for ImageGenerationProvider {
    fn default() -> Self {
        Self::Comfyui
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyuiGenerationDefaults {
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub lora_name: String,
    #[serde(default = "default_comfyui_steps")]
    pub default_steps: u32,
    #[serde(default = "default_comfyui_cfg_scale")]
    pub cfg_scale: f32,
    #[serde(default = "default_comfyui_sampler_name")]
    pub sampler_name: String,
    #[serde(default = "default_comfyui_scheduler")]
    pub scheduler: String,
    #[serde(default = "default_comfyui_width")]
    pub default_width: u32,
    #[serde(default = "default_comfyui_height")]
    pub default_height: u32,
}

impl Default for ComfyuiGenerationDefaults {
    fn default() -> Self {
        Self {
            model_name: String::new(),
            lora_name: String::new(),
            default_steps: default_comfyui_steps(),
            cfg_scale: default_comfyui_cfg_scale(),
            sampler_name: default_comfyui_sampler_name(),
            scheduler: default_comfyui_scheduler(),
            default_width: default_comfyui_width(),
            default_height: default_comfyui_height(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyuiEditDefaults {
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub lora_name: String,
    #[serde(default = "default_comfyui_steps")]
    pub default_steps: u32,
    #[serde(default = "default_comfyui_cfg_scale")]
    pub cfg_scale: f32,
    #[serde(default = "default_comfyui_sampler_name")]
    pub sampler_name: String,
    #[serde(default = "default_comfyui_scheduler")]
    pub scheduler: String,
}

impl Default for ComfyuiEditDefaults {
    fn default() -> Self {
        Self {
            model_name: String::new(),
            lora_name: String::new(),
            default_steps: default_comfyui_steps(),
            cfg_scale: default_comfyui_cfg_scale(),
            sampler_name: default_comfyui_sampler_name(),
            scheduler: default_comfyui_scheduler(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyuiImageGenerationConfig {
    pub server_url: String,
    #[serde(default)]
    pub api_key: String,
    // Legacy generation fields for backward compatibility.
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub lora_name: String,
    #[serde(default = "default_comfyui_steps")]
    pub default_steps: u32,
    #[serde(default = "default_comfyui_cfg_scale")]
    pub cfg_scale: f32,
    #[serde(default = "default_comfyui_sampler_name")]
    pub sampler_name: String,
    #[serde(default = "default_comfyui_scheduler")]
    pub scheduler: String,
    #[serde(default = "default_comfyui_width")]
    pub default_width: u32,
    #[serde(default = "default_comfyui_height")]
    pub default_height: u32,
    #[serde(default)]
    pub generate: ComfyuiGenerationDefaults,
    #[serde(default)]
    pub edit: ComfyuiEditDefaults,
}

impl Default for ComfyuiImageGenerationConfig {
    fn default() -> Self {
        Self {
            server_url: default_comfyui_server_url(),
            api_key: String::new(),
            model_name: String::new(),
            lora_name: String::new(),
            default_steps: default_comfyui_steps(),
            cfg_scale: default_comfyui_cfg_scale(),
            sampler_name: default_comfyui_sampler_name(),
            scheduler: default_comfyui_scheduler(),
            default_width: default_comfyui_width(),
            default_height: default_comfyui_height(),
            generate: ComfyuiGenerationDefaults::default(),
            edit: ComfyuiEditDefaults::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelscopeGenerationDefaults {
    pub model: String,
}

impl Default for ModelscopeGenerationDefaults {
    fn default() -> Self {
        Self {
            model: default_modelscope_model(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelscopeEditDefaults {
    #[serde(default = "default_empty_model")]
    pub model: String,
}

impl Default for ModelscopeEditDefaults {
    fn default() -> Self {
        Self {
            model: default_empty_model(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelscopeImageGenerationConfig {
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub api_secret: String,
    pub model: String,
    #[serde(default)]
    pub generate: ModelscopeGenerationDefaults,
    #[serde(default)]
    pub edit: ModelscopeEditDefaults,
}

impl Default for ModelscopeImageGenerationConfig {
    fn default() -> Self {
        Self {
            base_url: default_modelscope_base_url(),
            api_key: String::new(),
            api_secret: String::new(),
            model: default_modelscope_model(),
            generate: ModelscopeGenerationDefaults::default(),
            edit: ModelscopeEditDefaults::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationConfig {
    #[serde(default)]
    pub provider: ImageGenerationProvider,
    #[serde(default)]
    pub comfyui: ComfyuiImageGenerationConfig,
    #[serde(default)]
    pub modelscope: ModelscopeImageGenerationConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyuiModelProbeRequest {
    #[serde(default)]
    pub server_url: String,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ComfyuiProbeResponse {
    connected: bool,
    message: String,
    #[serde(default)]
    items: Vec<String>,
    #[serde(default)]
    loras: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteImageGenerateRequest {
    pub prompt: String,
    #[serde(default)]
    pub negative_prompt: String,
    #[serde(default = "default_image_size")]
    pub size: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default = "default_image_quality")]
    pub quality: String,
    #[serde(default = "default_image_count")]
    pub count: u8,
    #[serde(default)]
    pub workspace_root: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteImageEditRequest {
    pub prompt: String,
    #[serde(default)]
    pub negative_prompt: String,
    #[serde(default = "default_image_size")]
    pub size: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default = "default_image_quality")]
    pub quality: String,
    #[serde(default = "default_image_count")]
    pub count: u8,
    #[serde(default)]
    pub image_path: String,
    #[serde(default)]
    pub image_url: String,
    #[serde(default)]
    pub image_base64: String,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub workspace_root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteImageServiceEnvelope {
    handled: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    response: Option<Value>,
}

#[derive(Debug)]
struct ProviderImageData {
    bytes: Vec<u8>,
    mime_type: String,
}

#[derive(Debug)]
struct ProviderImageResult {
    images: Vec<ProviderImageData>,
    model: String,
    revised_prompt: Option<String>,
}

fn default_image_size() -> String {
    "1024x1024".to_string()
}

fn default_image_quality() -> String {
    "standard".to_string()
}

fn default_image_count() -> u8 {
    1
}

pub async fn get_image_generation_config() -> Result<Json<Value>, ApiError> {
    let config = read_image_generation_config().map_err(internal_error)?;
    Ok(Json(json!({ "config": config })))
}

pub async fn set_image_generation_config(
    Json(payload): Json<ImageGenerationConfig>,
) -> Result<Json<Value>, ApiError> {
    let config = write_image_generation_config(payload).map_err(internal_error)?;
    Ok(Json(json!({ "config": config })))
}

pub async fn probe_comfyui_models(
    Json(payload): Json<ComfyuiModelProbeRequest>,
) -> Result<Json<Value>, ApiError> {
    let server_url = normalize_url_or_default(&payload.server_url, &default_comfyui_server_url());
    let api_key = payload.api_key.trim().to_string();
    let probe = probe_comfyui_resources(&server_url, &api_key).await;
    Ok(Json(json!(probe)))
}

pub async fn execute_image_generate(
    Json(payload): Json<ExecuteImageGenerateRequest>,
) -> Result<Json<Value>, ApiError> {
    let config = read_image_generation_config().map_err(internal_error)?;
    let response = execute_image_generate_inner(&config, payload)
        .await
        .map_err(internal_error)?;
    Ok(Json(json!(response)))
}

pub async fn execute_image_edit(
    Json(payload): Json<ExecuteImageEditRequest>,
) -> Result<Json<Value>, ApiError> {
    let config = read_image_generation_config().map_err(internal_error)?;
    let response = execute_image_edit_inner(&config, payload)
        .await
        .map_err(internal_error)?;
    Ok(Json(json!(response)))
}

fn image_generation_config_path() -> Result<PathBuf, String> {
    Ok(path_resolver::openfang_runtime_home_dir()?.join("image-generation.json"))
}

fn read_image_generation_config() -> Result<ImageGenerationConfig, String> {
    let path = image_generation_config_path()?;
    if !path.exists() {
        return Ok(ImageGenerationConfig::default());
    }

    let content =
        fs::read_to_string(&path).map_err(|err| format!("读取图片生成配置失败: {err}"))?;
    let mut config = serde_json::from_str::<ImageGenerationConfig>(&content)
        .map_err(|err| format!("解析图片生成配置失败: {err}"))?;
    normalize_config(&mut config);
    Ok(config)
}

fn write_image_generation_config(
    mut config: ImageGenerationConfig,
) -> Result<ImageGenerationConfig, String> {
    normalize_config(&mut config);
    let path = image_generation_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("创建图片生成配置目录失败: {err}"))?;
    }
    let content = serde_json::to_string_pretty(&config)
        .map_err(|err| format!("序列化图片生成配置失败: {err}"))?;
    fs::write(&path, content).map_err(|err| format!("写入图片生成配置失败: {err}"))?;
    Ok(config)
}

fn normalize_config(config: &mut ImageGenerationConfig) {
    config.comfyui.server_url =
        normalize_url_or_default(&config.comfyui.server_url, &default_comfyui_server_url());
    config.comfyui.api_key = config.comfyui.api_key.trim().to_string();
    config.comfyui.model_name = config.comfyui.model_name.trim().to_string();
    config.comfyui.lora_name = config.comfyui.lora_name.trim().to_string();
    config.comfyui.default_steps =
        normalize_u32_or_default(config.comfyui.default_steps, default_comfyui_steps());
    config.comfyui.cfg_scale =
        normalize_f32_or_default(config.comfyui.cfg_scale, default_comfyui_cfg_scale());
    config.comfyui.sampler_name = normalize_string_or_default(
        &config.comfyui.sampler_name,
        &default_comfyui_sampler_name(),
    );
    config.comfyui.scheduler =
        normalize_string_or_default(&config.comfyui.scheduler, &default_comfyui_scheduler());
    config.comfyui.default_width =
        normalize_u32_or_default(config.comfyui.default_width, default_comfyui_width());
    config.comfyui.default_height =
        normalize_u32_or_default(config.comfyui.default_height, default_comfyui_height());
    if config.comfyui.generate.model_name.trim().is_empty() && !config.comfyui.model_name.is_empty()
    {
        config.comfyui.generate.model_name = config.comfyui.model_name.clone();
        config.comfyui.generate.lora_name = config.comfyui.lora_name.clone();
        config.comfyui.generate.default_steps = config.comfyui.default_steps;
        config.comfyui.generate.cfg_scale = config.comfyui.cfg_scale;
        config.comfyui.generate.sampler_name = config.comfyui.sampler_name.clone();
        config.comfyui.generate.scheduler = config.comfyui.scheduler.clone();
        config.comfyui.generate.default_width = config.comfyui.default_width;
        config.comfyui.generate.default_height = config.comfyui.default_height;
    }
    normalize_comfyui_generation_defaults(&mut config.comfyui.generate);
    normalize_comfyui_edit_defaults(&mut config.comfyui.edit);
    config.comfyui.model_name = config.comfyui.generate.model_name.clone();
    config.comfyui.lora_name = config.comfyui.generate.lora_name.clone();
    config.comfyui.default_steps = config.comfyui.generate.default_steps;
    config.comfyui.cfg_scale = config.comfyui.generate.cfg_scale;
    config.comfyui.sampler_name = config.comfyui.generate.sampler_name.clone();
    config.comfyui.scheduler = config.comfyui.generate.scheduler.clone();
    config.comfyui.default_width = config.comfyui.generate.default_width;
    config.comfyui.default_height = config.comfyui.generate.default_height;

    config.modelscope.base_url =
        normalize_url_or_default(&config.modelscope.base_url, &default_modelscope_base_url());
    config.modelscope.api_key = config.modelscope.api_key.trim().to_string();
    config.modelscope.api_secret = config.modelscope.api_secret.trim().to_string();
    config.modelscope.model =
        normalize_string_or_default(&config.modelscope.model, &default_modelscope_model());
    if config.modelscope.generate.model.trim().is_empty() {
        config.modelscope.generate.model = config.modelscope.model.clone();
    }
    config.modelscope.generate.model = normalize_string_or_default(
        &config.modelscope.generate.model,
        &default_modelscope_model(),
    );
    config.modelscope.edit.model = config.modelscope.edit.model.trim().to_string();
    config.modelscope.model = config.modelscope.generate.model.clone();
}

fn normalize_comfyui_generation_defaults(config: &mut ComfyuiGenerationDefaults) {
    config.model_name = config.model_name.trim().to_string();
    config.lora_name = config.lora_name.trim().to_string();
    config.default_steps = normalize_u32_or_default(config.default_steps, default_comfyui_steps());
    config.cfg_scale = normalize_f32_or_default(config.cfg_scale, default_comfyui_cfg_scale());
    config.sampler_name =
        normalize_string_or_default(&config.sampler_name, &default_comfyui_sampler_name());
    config.scheduler = normalize_string_or_default(&config.scheduler, &default_comfyui_scheduler());
    config.default_width = normalize_u32_or_default(config.default_width, default_comfyui_width());
    config.default_height =
        normalize_u32_or_default(config.default_height, default_comfyui_height());
}

fn normalize_comfyui_edit_defaults(config: &mut ComfyuiEditDefaults) {
    config.model_name = config.model_name.trim().to_string();
    config.lora_name = config.lora_name.trim().to_string();
    config.default_steps = normalize_u32_or_default(config.default_steps, default_comfyui_steps());
    config.cfg_scale = normalize_f32_or_default(config.cfg_scale, default_comfyui_cfg_scale());
    config.sampler_name =
        normalize_string_or_default(&config.sampler_name, &default_comfyui_sampler_name());
    config.scheduler = normalize_string_or_default(&config.scheduler, &default_comfyui_scheduler());
}

fn normalize_string_or_default(input: &str, fallback: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_url_or_default(input: &str, fallback: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        fallback.trim_end_matches('/').to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_u32_or_default(input: u32, fallback: u32) -> u32 {
    if input == 0 {
        fallback
    } else {
        input
    }
}

fn normalize_f32_or_default(input: f32, fallback: f32) -> f32 {
    if input.is_finite() && input > 0.0 {
        input
    } else {
        fallback
    }
}

async fn probe_comfyui_resources(server_url: &str, api_key: &str) -> ComfyuiProbeResponse {
    match probe_comfyui_resources_inner(server_url, api_key).await {
        Ok(mut probe) => {
            probe.items.sort();
            probe.items.dedup();
            probe.loras.sort();
            probe.loras.dedup();
            if probe.message.trim().is_empty() {
                probe.message = if probe.connected {
                    "ComfyUI 已连接".to_string()
                } else {
                    "ComfyUI 不可用".to_string()
                };
            }
            probe
        }
        Err(message) => ComfyuiProbeResponse {
            connected: false,
            message,
            items: Vec::new(),
            loras: Vec::new(),
        },
    }
}

async fn probe_comfyui_resources_inner(
    server_url: &str,
    api_key: &str,
) -> Result<ComfyuiProbeResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|err| format!("创建 ComfyUI 客户端失败: {err}"))?;

    let headers = build_auth_headers(api_key)?;
    let checkpoint_direct_url = format!("{server_url}/object_info/CheckpointLoaderSimple");
    let lora_direct_url = format!("{server_url}/object_info/LoraLoader");
    let fallback_url = format!("{server_url}/object_info");

    let checkpoint_direct = fetch_json(&client, &headers, &checkpoint_direct_url)
        .await
        .ok();
    let lora_direct = fetch_json(&client, &headers, &lora_direct_url).await.ok();
    let mut full_object_info = None;

    let mut items = checkpoint_direct
        .as_ref()
        .map(parse_checkpoint_models)
        .unwrap_or_default();
    let mut loras = lora_direct
        .as_ref()
        .map(parse_lora_models)
        .unwrap_or_default();
    let mut connected = checkpoint_direct.is_some() || lora_direct.is_some();
    let mut message_parts = Vec::new();

    if items.is_empty() || loras.is_empty() || !connected {
        match fetch_json(&client, &headers, &fallback_url).await {
            Ok(payload) => {
                connected = true;
                full_object_info = Some(payload.clone());
                if items.is_empty() {
                    items = parse_checkpoint_models(&payload);
                }
                if loras.is_empty() {
                    loras = parse_lora_models(&payload);
                }
            }
            Err(err) => {
                if !connected {
                    return Err(err.message);
                }
                message_parts.push(format!("部分资源探测失败: {}", err.message));
            }
        }
    }

    if let Some(payload) = full_object_info.as_ref() {
        let missing_nodes = collect_missing_required_nodes(payload);
        if !missing_nodes.is_empty() {
            connected = false;
            message_parts.push(format!(
                "缺少内置图片服务 workflow 所需节点: {}",
                missing_nodes.join("、")
            ));
        }
    } else if connected {
        message_parts.push("已获取资源列表，但未能验证内置 workflow 节点完整性".to_string());
    }

    if connected {
        message_parts.insert(
            0,
            format!(
                "ComfyUI 已连接，检测到 {} 个 checkpoint、{} 个 LoRA",
                items.len(),
                loras.len()
            ),
        );
    } else {
        message_parts.push("ComfyUI 不可用".to_string());
    }

    Ok(ComfyuiProbeResponse {
        connected,
        message: message_parts.join("；"),
        items,
        loras,
    })
}

async fn fetch_json(
    client: &reqwest::Client,
    headers: &HeaderMap,
    url: &str,
) -> Result<Value, ApiError> {
    let response = client
        .get(url)
        .headers(headers.clone())
        .send()
        .await
        .map_err(|err| {
            ApiError::new(StatusCode::BAD_GATEWAY, format!("请求 ComfyUI 失败: {err}"))
        })?;
    let status = response.status();
    let text = response.text().await.map_err(|err| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取 ComfyUI 响应失败: {err}"),
        )
    })?;
    if !status.is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("ComfyUI 返回错误({status}): {}", text.trim()),
        ));
    }
    serde_json::from_str::<Value>(&text).map_err(|err| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("ComfyUI 返回非 JSON: {err}; body={text}"),
        )
    })
}

fn parse_checkpoint_models(payload: &Value) -> Vec<String> {
    parse_comfyui_option_items(payload, "ckpt_name", &["CheckpointLoaderSimple"])
}

fn parse_lora_models(payload: &Value) -> Vec<String> {
    let mut items =
        parse_comfyui_option_items(payload, "lora_name", &["LoraLoader", "LoraLoaderModelOnly"]);
    items.extend(parse_comfyui_option_items(
        payload,
        "lora_01",
        &["Lora Loader Stack (rgthree)"],
    ));
    items
}

fn parse_comfyui_option_items(
    payload: &Value,
    input_name: &str,
    node_keys: &[&str],
) -> Vec<String> {
    let mut candidates = Vec::new();

    if let Some(value) = payload
        .get("input")
        .and_then(|value| value.get("required"))
        .and_then(|value| value.get(input_name))
    {
        candidates.push(value);
    }
    if let Some(value) = payload
        .get("input")
        .and_then(|value| value.get("optional"))
        .and_then(|value| value.get(input_name))
    {
        candidates.push(value);
    }

    for node_key in node_keys {
        if let Some(value) = payload
            .get(*node_key)
            .and_then(|value| value.get("input"))
            .and_then(|value| value.get("required"))
            .and_then(|value| value.get(input_name))
        {
            candidates.push(value);
        }
        if let Some(value) = payload
            .get(*node_key)
            .and_then(|value| value.get("input"))
            .and_then(|value| value.get("optional"))
            .and_then(|value| value.get(input_name))
        {
            candidates.push(value);
        }
    }

    for candidate in candidates {
        let items = extract_option_items(candidate);
        if !items.is_empty() {
            return items;
        }
    }

    Vec::new()
}

fn extract_option_items(candidate: &Value) -> Vec<String> {
    let values = if let Some(array) = candidate.get(0).and_then(Value::as_array) {
        array
    } else if let Some(array) = candidate.get("options").and_then(Value::as_array) {
        array
    } else if let Some(array) = candidate.as_array() {
        array
    } else {
        return Vec::new();
    };

    values
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn collect_missing_required_nodes(payload: &Value) -> Vec<String> {
    let mut missing = Vec::new();
    for (class_name, label) in COMFYUI_GENERATE_REQUIRED_NODES
        .iter()
        .chain(COMFYUI_EDIT_REQUIRED_NODES.iter())
    {
        if payload.get(*class_name).is_none() {
            missing.push((*label).to_string());
        }
    }
    missing.sort();
    missing.dedup();
    missing
}

fn build_auth_headers(api_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Ok(headers);
    }
    let value = HeaderValue::from_str(&format!("Bearer {trimmed}"))
        .map_err(|err| format!("API Key 头无效: {err}"))?;
    headers.insert(AUTHORIZATION, value);
    Ok(headers)
}

fn internal_error(message: String) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message)
}

async fn execute_image_generate_inner(
    config: &ImageGenerationConfig,
    payload: ExecuteImageGenerateRequest,
) -> Result<ExecuteImageServiceEnvelope, String> {
    validate_prompt_text(&payload.prompt, "图片生成提示词")?;
    let workspace_root = resolve_workspace_root(&payload.workspace_root);
    let (width, height) = resolve_dimensions(&payload.size, payload.width, payload.height)?;
    let count = payload.count.clamp(1, 4);

    let result = match config.provider {
        ImageGenerationProvider::Comfyui => {
            if config.comfyui.server_url.trim().is_empty()
                || config.comfyui.generate.model_name.trim().is_empty()
            {
                return Ok(ExecuteImageServiceEnvelope {
                    handled: false,
                    message: "未配置可用的 ComfyUI 通用图片生成服务".to_string(),
                    response: None,
                });
            }
            generate_image_via_comfyui_provider(
                &config.comfyui,
                &config.comfyui.generate,
                payload.prompt.trim(),
                payload.negative_prompt.trim(),
                width,
                height,
                count,
            )
            .await?
        }
        ImageGenerationProvider::Modelscope => {
            if config.modelscope.base_url.trim().is_empty()
                || config.modelscope.api_key.trim().is_empty()
                || config.modelscope.generate.model.trim().is_empty()
            {
                return Ok(ExecuteImageServiceEnvelope {
                    handled: false,
                    message: "未配置可用的 ModelScope 通用图片生成服务".to_string(),
                    response: None,
                });
            }
            generate_image_via_modelscope_provider(
                &config.modelscope,
                &config.modelscope.generate,
                payload.prompt.trim(),
                payload.negative_prompt.trim(),
                width,
                height,
                count,
            )
            .await?
        }
    };

    Ok(ExecuteImageServiceEnvelope {
        handled: true,
        message: "ok".to_string(),
        response: Some(build_tool_image_response(
            result,
            workspace_root.as_deref(),
        )?),
    })
}

async fn execute_image_edit_inner(
    config: &ImageGenerationConfig,
    payload: ExecuteImageEditRequest,
) -> Result<ExecuteImageServiceEnvelope, String> {
    validate_prompt_text(&payload.prompt, "图片修改提示词")?;
    validate_edit_source(&payload)?;
    let workspace_root = resolve_workspace_root(&payload.workspace_root);
    let (width, height) = resolve_dimensions(&payload.size, payload.width, payload.height)?;
    let count = payload.count.clamp(1, 4);

    let result = match config.provider {
        ImageGenerationProvider::Comfyui => {
            if config.comfyui.server_url.trim().is_empty()
                || config.comfyui.edit.model_name.trim().is_empty()
            {
                return Ok(ExecuteImageServiceEnvelope {
                    handled: false,
                    message: "未配置可用的 ComfyUI 通用图片修改服务".to_string(),
                    response: None,
                });
            }
            generate_image_edit_via_comfyui_provider(
                &config.comfyui,
                &config.comfyui.edit,
                &payload,
                width.max(height),
                count,
            )
            .await?
        }
        ImageGenerationProvider::Modelscope => {
            if config.modelscope.base_url.trim().is_empty()
                || config.modelscope.api_key.trim().is_empty()
                || config.modelscope.edit.model.trim().is_empty()
            {
                return Ok(ExecuteImageServiceEnvelope {
                    handled: false,
                    message: "未配置可用的 ModelScope 通用图片修改服务".to_string(),
                    response: None,
                });
            }
            return Err("ModelScope 图片修改链路暂未实现，请先使用 ComfyUI 编辑模型".to_string());
        }
    };

    Ok(ExecuteImageServiceEnvelope {
        handled: true,
        message: "ok".to_string(),
        response: Some(build_tool_image_response(
            result,
            workspace_root.as_deref(),
        )?),
    })
}

fn resolve_workspace_root(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn validate_prompt_text(prompt: &str, label: &str) -> Result<(), String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err(format!("{label}不能为空"));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    {
        return Err(format!("{label}包含非法控制字符"));
    }
    Ok(())
}

fn build_image_edit_instruction_prompt(prompt: &str) -> String {
    let user_prompt = prompt.trim();
    let scope = infer_image_edit_scope(user_prompt);
    let mut requested_change_groups = Vec::new();

    if scope.changes_composition {
        requested_change_groups.push("framing/composition");
    }
    if scope.changes_camera {
        requested_change_groups.push("camera angle/viewpoint");
    }
    if scope.changes_pose {
        requested_change_groups.push("pose/gesture");
    }
    if scope.changes_outfit {
        requested_change_groups.push("outfit/fabric/clothing details");
    }
    if scope.changes_accessories {
        requested_change_groups.push("accessories/jewelry");
    }
    if scope.changes_hair {
        requested_change_groups.push("hair/hairstyle");
    }
    if scope.changes_makeup {
        requested_change_groups.push("makeup/beauty details");
    }
    if scope.changes_body {
        requested_change_groups.push("body visibility/body-detail emphasis");
    }
    if scope.changes_background {
        requested_change_groups.push("background/scene");
    }

    let requested_change_instruction = if requested_change_groups.is_empty() {
        "The requested edit is a local or medium modification. Keep framing, pose, outfit, background, and camera language unchanged unless the user explicitly says otherwise.".to_string()
    } else {
        format!(
            "The user explicitly requested changes to {}. Those requested changes must happen. Preserve identity and every other unspecified element.",
            requested_change_groups.join(", ")
        )
    };

    format!(
        "{}\n\nEdit the provided source image instead of creating a brand-new image. Preserve the same subject identity, face, recognizable person, hairstyle, body characteristics, lighting style, color palette, and overall visual language unless the user explicitly asked to change them. {} Only modify the exact parts requested below. Do not add extra accessories, props, beautification, outfit redesigns, pose changes, background rewrites, or scene inventions beyond the user's request. Everything not explicitly requested must remain unchanged.\n\nRequested edit:\n{}",
        FIXED_IMAGE_EDIT_INSTRUCTION_PREFIX,
        requested_change_instruction,
        user_prompt
    )
}

fn build_image_edit_negative_prompt(prompt: &str, negative_prompt: &str) -> String {
    let scope = infer_image_edit_scope(prompt);
    let mut preservation_terms = vec![
        "different person",
        "different face",
        "identity drift",
        "changed skin tone",
        "changed lighting",
        "changed color palette",
        "extra details",
        "style drift",
        "scene redesign",
        "unintended changes",
    ];
    if !scope.changes_hair {
        preservation_terms.push("changed hairstyle");
    }
    if !scope.changes_body {
        preservation_terms.push("changed body shape");
    }
    if !scope.changes_pose {
        preservation_terms.push("changed pose");
    }
    if !(scope.changes_camera || scope.changes_composition) {
        preservation_terms.push("changed camera angle");
        preservation_terms.push("changed composition");
    }
    if !scope.changes_background {
        preservation_terms.push("changed background");
    }
    if !scope.changes_outfit {
        preservation_terms.push("changed outfit");
    }
    if !scope.changes_accessories {
        preservation_terms.push("extra accessories");
        preservation_terms.push("extra props");
    }
    if !scope.changes_makeup {
        preservation_terms.push("beauty retouching");
        preservation_terms.push("changed makeup");
    }

    let preservation_guard = preservation_terms.join(", ");
    let trimmed = negative_prompt.trim();
    if trimmed.is_empty() {
        preservation_guard
    } else {
        format!("{trimmed}, {preservation_guard}")
    }
}

fn infer_image_edit_scope(prompt: &str) -> ImageEditScope {
    let normalized = prompt.trim().to_ascii_lowercase();
    ImageEditScope {
        changes_composition: contains_any_edit_keyword(
            &normalized,
            &[
                "full body",
                "full-body",
                "upper body",
                "close-up",
                "close up",
                "wide shot",
                "long shot",
                "portrait crop",
                "framing",
                "composition",
                "shot",
                "全身",
                "半身",
                "特写",
                "近景",
                "远景",
                "构图",
                "景别",
                "镜头",
            ],
        ),
        changes_pose: contains_any_edit_keyword(
            &normalized,
            &[
                "pose", "posing", "gesture", "holding", "stand", "standing", "sit", "sitting",
                "kneel", "kneeling", "双手", "手持", "姿势", "动作", "站姿", "坐姿", "跪姿",
            ],
        ),
        changes_camera: contains_any_edit_keyword(
            &normalized,
            &[
                "camera angle",
                "viewpoint",
                "angle",
                "perspective",
                "视角",
                "角度",
                "机位",
            ],
        ),
        changes_outfit: contains_any_edit_keyword(
            &normalized,
            &[
                "outfit",
                "dress",
                "gown",
                "clothes",
                "clothing",
                "wearing",
                "v-neck",
                "deep v",
                "slit",
                "stockings",
                "pantyhose",
                "丝袜",
                "服装",
                "衣服",
                "裙子",
                "领口",
                "高开叉",
                "晚礼服",
                "换装",
            ],
        ),
        changes_background: contains_any_edit_keyword(
            &normalized,
            &[
                "background",
                "scene",
                "setting",
                "location",
                "indoors",
                "outdoors",
                "背景",
                "场景",
                "环境",
                "宫殿",
                "办公室",
            ],
        ),
        changes_hair: contains_any_edit_keyword(
            &normalized,
            &[
                "hair",
                "hairstyle",
                "bangs",
                "ponytail",
                "发型",
                "头发",
                "刘海",
                "马尾",
            ],
        ),
        changes_accessories: contains_any_edit_keyword(
            &normalized,
            &[
                "accessory",
                "accessories",
                "jewelry",
                "necklace",
                "earring",
                "earrings",
                "bracelet",
                "choker",
                "collar",
                "配饰",
                "首饰",
                "项链",
                "耳环",
                "耳坠",
                "手链",
                "颈圈",
            ],
        ),
        changes_makeup: contains_any_edit_keyword(
            &normalized,
            &[
                "makeup",
                "beauty",
                "lipstick",
                "eyeliner",
                "retouch",
                "face more beautiful",
                "妆容",
                "美化",
                "美颜",
                "修脸",
            ],
        ),
        changes_body: contains_any_edit_keyword(
            &normalized,
            &[
                "body", "figure", "legs", "waist", "bust", "胸", "腿", "身材", "腰", "曲线",
            ],
        ),
    }
}

fn contains_any_edit_keyword(value: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| value.contains(keyword))
}

fn validate_edit_source(payload: &ExecuteImageEditRequest) -> Result<(), String> {
    let mut count = 0u8;
    if !payload.image_path.trim().is_empty() {
        count += 1;
    }
    if !payload.image_url.trim().is_empty() {
        count += 1;
    }
    if !payload.image_base64.trim().is_empty() {
        count += 1;
        if payload.mime_type.trim().is_empty() {
            return Err("image_base64 模式下必须提供 mime_type".to_string());
        }
    }
    match count {
        0 => Err("image_edit 需要提供 image_path、image_url 或 image_base64 其中之一".to_string()),
        1 => Ok(()),
        _ => Err("image_edit 只能提供一个输入图片来源".to_string()),
    }
}

fn resolve_dimensions(
    size: &str,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(u32, u32), String> {
    match (width, height) {
        (Some(width), Some(height)) if width > 0 && height > 0 => Ok((width, height)),
        (None, None) => parse_size(size),
        _ => Err("图片宽高必须同时提供或同时留空".to_string()),
    }
}

fn parse_size(size: &str) -> Result<(u32, u32), String> {
    let trimmed = size.trim();
    let (width, height) = trimmed
        .split_once('x')
        .ok_or_else(|| format!("无效的图片尺寸: {trimmed}"))?;
    let width = width
        .trim()
        .parse::<u32>()
        .map_err(|err| format!("解析图片宽度失败: {err}"))?;
    let height = height
        .trim()
        .parse::<u32>()
        .map_err(|err| format!("解析图片高度失败: {err}"))?;
    if width == 0 || height == 0 {
        return Err("图片宽高必须大于 0".to_string());
    }
    Ok((width, height))
}

async fn generate_image_via_comfyui_provider(
    config: &ComfyuiImageGenerationConfig,
    defaults: &ComfyuiGenerationDefaults,
    prompt: &str,
    negative_prompt: &str,
    width: u32,
    height: u32,
    count: u8,
) -> Result<ProviderImageResult, String> {
    let client = build_http_client(120)?;
    let headers = build_auth_headers(&config.api_key)?;
    let workflow = build_comfyui_generate_prompt_from_template(
        defaults,
        prompt,
        negative_prompt,
        width,
        height,
        count,
    )?;
    let history = submit_and_wait_comfyui_prompt(
        &client,
        &headers,
        &config.server_url,
        "webot-image-generation",
        workflow,
        "ComfyUI 图片生成",
    )
    .await?;
    let refs = extract_comfyui_output_images(&history);
    if refs.is_empty() {
        return Err("ComfyUI 已完成，但没有返回图片输出".to_string());
    }

    let mut images = Vec::new();
    for image_ref in refs {
        let view_url = build_comfyui_view_url(&config.server_url, &image_ref)?;
        let (bytes, mime_type) = fetch_binary_with_mime(&client, &headers, &view_url).await?;
        images.push(ProviderImageData { bytes, mime_type });
    }

    Ok(ProviderImageResult {
        images,
        model: format!("comfyui:{}", defaults.model_name),
        revised_prompt: None,
    })
}

async fn generate_image_edit_via_comfyui_provider(
    config: &ComfyuiImageGenerationConfig,
    defaults: &ComfyuiEditDefaults,
    payload: &ExecuteImageEditRequest,
    longest_side: u32,
    count: u8,
) -> Result<ProviderImageResult, String> {
    let client = build_http_client(180)?;
    let headers = build_auth_headers(&config.api_key)?;
    let (image_bytes, mime_type) = load_image_edit_source(payload, &client).await?;
    let uploaded_image = upload_image_to_comfyui(
        &client,
        &headers,
        &config.server_url,
        &image_bytes,
        &mime_type,
    )
    .await?;
    let workflow = build_comfyui_edit_prompt_from_template(
        defaults,
        payload.prompt.trim(),
        payload.negative_prompt.trim(),
        &uploaded_image,
        longest_side,
        count,
    )?;
    let history = submit_and_wait_comfyui_prompt(
        &client,
        &headers,
        &config.server_url,
        "webot-image-edit",
        workflow,
        "ComfyUI 图片修改",
    )
    .await?;
    let refs = extract_comfyui_output_images(&history);
    if refs.is_empty() {
        return Err("ComfyUI 图片修改已完成，但没有返回图片输出".to_string());
    }

    let mut images = Vec::new();
    for image_ref in refs {
        let view_url = build_comfyui_view_url(&config.server_url, &image_ref)?;
        let (bytes, resolved_mime_type) =
            fetch_binary_with_mime(&client, &headers, &view_url).await?;
        images.push(ProviderImageData {
            bytes,
            mime_type: resolved_mime_type,
        });
    }

    Ok(ProviderImageResult {
        images,
        model: format!("comfyui-edit:{}", defaults.model_name),
        revised_prompt: None,
    })
}

async fn generate_image_via_modelscope_provider(
    config: &ModelscopeImageGenerationConfig,
    defaults: &ModelscopeGenerationDefaults,
    prompt: &str,
    negative_prompt: &str,
    width: u32,
    height: u32,
    count: u8,
) -> Result<ProviderImageResult, String> {
    let client = build_http_client(120)?;
    let mut submit_headers = build_modelscope_headers(&config.api_key, &config.api_secret)?;
    submit_headers.insert(
        HeaderName::from_static(MODELSCOPE_ASYNC_HEADER),
        HeaderValue::from_static("true"),
    );

    let mut body = json!({
        "model": defaults.model,
        "prompt": prompt,
        "width": width,
        "height": height,
    });
    if !negative_prompt.trim().is_empty() {
        body["negative_prompt"] = json!(negative_prompt.trim());
    }
    if count > 1 {
        body["n"] = json!(count);
    }

    let submit_url = join_endpoint(&config.base_url, "v1/images/generations");
    let submit_response = client
        .post(&submit_url)
        .headers(submit_headers)
        .header(USER_AGENT, "weBot Image Service")
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("请求 ModelScope 图片生成失败: {err}"))?;
    let submit_status = submit_response.status();
    let submit_text = submit_response
        .text()
        .await
        .map_err(|err| format!("读取 ModelScope 响应失败: {err}"))?;
    if !submit_status.is_success() {
        return Err(format!(
            "ModelScope 图片生成返回错误({submit_status}): {}",
            submit_text.trim()
        ));
    }

    let submit_json = serde_json::from_str::<Value>(&submit_text)
        .map_err(|err| format!("ModelScope 返回非 JSON: {err}; body={submit_text}"))?;
    let result_payload = if let Some(task_id) = submit_json.get("task_id").and_then(Value::as_str) {
        poll_modelscope_task(&client, config, task_id).await?
    } else {
        submit_json
    };

    let urls = extract_modelscope_output_urls(&result_payload);
    if urls.is_empty() {
        return Err("ModelScope 已返回结果，但未发现图片链接".to_string());
    }

    let mut download_headers = build_modelscope_headers(&config.api_key, &config.api_secret)?;
    download_headers.remove(CONTENT_TYPE);

    let mut images = Vec::new();
    for url in urls {
        let (bytes, mime_type) = fetch_binary_with_mime(&client, &download_headers, &url).await?;
        images.push(ProviderImageData { bytes, mime_type });
    }

    Ok(ProviderImageResult {
        images,
        model: defaults.model.clone(),
        revised_prompt: None,
    })
}

fn build_tool_image_response(
    result: ProviderImageResult,
    workspace_root: Option<&Path>,
) -> Result<Value, String> {
    let saved_paths = save_provider_images_to_workspace(&result.images, workspace_root)?;
    let image_urls = save_provider_images_to_upload_cache(&result.images)?;
    Ok(json!({
        "model": result.model,
        "images_generated": result.images.len(),
        "saved_to": saved_paths,
        "revised_prompt": result.revised_prompt,
        "image_urls": image_urls,
    }))
}

fn save_provider_images_to_workspace(
    images: &[ProviderImageData],
    workspace_root: Option<&Path>,
) -> Result<Vec<String>, String> {
    let Some(workspace_root) = workspace_root else {
        return Ok(Vec::new());
    };
    let output_dir = workspace_root.join("output");
    fs::create_dir_all(&output_dir).map_err(|err| {
        format!(
            "创建工作目录输出文件夹失败({}): {err}",
            output_dir.display()
        )
    })?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("读取系统时间失败: {err}"))?
        .as_secs();

    let mut paths = Vec::new();
    for (index, image) in images.iter().enumerate() {
        let ext = extension_from_mime_type(&image.mime_type).unwrap_or("png");
        let filename = format!("image_{timestamp}_{index}.{ext}");
        let path = output_dir.join(filename);
        fs::write(&path, &image.bytes)
            .map_err(|err| format!("写入生成图片失败({}): {err}", path.display()))?;
        paths.push(path.to_string_lossy().to_string());
    }
    Ok(paths)
}

fn save_provider_images_to_upload_cache(
    images: &[ProviderImageData],
) -> Result<Vec<String>, String> {
    let upload_dir = env::temp_dir().join("openfang_uploads");
    fs::create_dir_all(&upload_dir)
        .map_err(|err| format!("创建上传缓存目录失败({}): {err}", upload_dir.display()))?;

    let mut urls = Vec::new();
    for image in images {
        let file_id = uuid::Uuid::new_v4().to_string();
        let path = upload_dir.join(&file_id);
        fs::write(&path, &image.bytes)
            .map_err(|err| format!("写入上传缓存失败({}): {err}", path.display()))?;
        urls.push(format!("/api/uploads/{file_id}"));
    }
    Ok(urls)
}

fn build_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|err| format!("创建图片服务 HTTP 客户端失败: {err}"))
}

fn resolve_comfyui_workflow_template_path(relative_path: &str) -> Result<PathBuf, String> {
    let comfyui_dir = path_resolver::openfang_runtime_home_dir()?.join(COMFYUI_TEMPLATE_ROOT_DIR);
    let template_path = comfyui_dir.join(relative_path);
    if template_path.is_file() {
        Ok(template_path)
    } else {
        Err(format!(
            "未找到内置 ComfyUI workflow 模板: {}。请确认 comfyui 资源已同步到 {}",
            relative_path,
            comfyui_dir.display()
        ))
    }
}

fn load_comfyui_workflow_template(relative_path: &str) -> Result<Value, String> {
    let path = resolve_comfyui_workflow_template_path(relative_path)?;
    let content = fs::read_to_string(&path)
        .map_err(|err| format!("读取 ComfyUI workflow 模板失败({}): {err}", path.display()))?;
    serde_json::from_str::<Value>(&content)
        .map_err(|err| format!("解析 ComfyUI workflow 模板失败({}): {err}", path.display()))
}

fn build_comfyui_generate_prompt_from_template(
    defaults: &ComfyuiGenerationDefaults,
    prompt: &str,
    negative_prompt: &str,
    width: u32,
    height: u32,
    count: u8,
) -> Result<Value, String> {
    let mut workflow = load_comfyui_workflow_template(COMFYUI_GENERATE_TEMPLATE_REL_PATH)?;
    set_workflow_input(&mut workflow, "35", "ckpt_name", json!(defaults.model_name))?;
    set_workflow_input(
        &mut workflow,
        "24",
        "lora_01",
        json!(normalize_optional_comfyui_lora(&defaults.lora_name)),
    )?;
    set_workflow_input(&mut workflow, "7", "seed", json!(random_seed()))?;
    set_workflow_input(&mut workflow, "7", "steps", json!(defaults.default_steps))?;
    set_workflow_input(&mut workflow, "7", "cfg", json!(defaults.cfg_scale))?;
    set_workflow_input(
        &mut workflow,
        "7",
        "sampler_name",
        json!(defaults.sampler_name),
    )?;
    set_workflow_input(&mut workflow, "7", "scheduler", json!(defaults.scheduler))?;
    set_workflow_input(&mut workflow, "16", "width", json!(width))?;
    set_workflow_input(&mut workflow, "16", "height", json!(height))?;
    set_workflow_input(&mut workflow, "16", "batch_size", json!(count))?;
    set_workflow_input(&mut workflow, "31:1", "text", json!(prompt))?;
    set_workflow_input(&mut workflow, "39", "text", json!(negative_prompt))?;
    set_workflow_input(
        &mut workflow,
        "10",
        "filename_prefix",
        json!(DEFAULT_OUTPUT_PREFIX),
    )?;
    Ok(workflow)
}

fn build_comfyui_edit_prompt_from_template(
    defaults: &ComfyuiEditDefaults,
    prompt: &str,
    negative_prompt: &str,
    uploaded_image: &str,
    longest_side: u32,
    count: u8,
) -> Result<Value, String> {
    let mut workflow = load_comfyui_workflow_template(COMFYUI_EDIT_TEMPLATE_REL_PATH)?;
    let edit_prompt = build_image_edit_instruction_prompt(prompt);
    let edit_negative_prompt = build_image_edit_negative_prompt(prompt, negative_prompt);
    set_workflow_input(
        &mut workflow,
        "372",
        "ckpt_name",
        json!(defaults.model_name),
    )?;
    let lora_name = defaults.lora_name.trim();
    if lora_name.is_empty() {
        set_workflow_input(&mut workflow, "373", "lora_name", json!("None"))?;
        set_workflow_input(&mut workflow, "371", "model", json!(["372", 0]))?;
    } else {
        set_workflow_input(&mut workflow, "373", "lora_name", json!(lora_name))?;
        set_workflow_input(&mut workflow, "371", "model", json!(["373", 0]))?;
    }
    set_workflow_input(&mut workflow, "371", "seed", json!(random_seed()))?;
    set_workflow_input(&mut workflow, "371", "steps", json!(defaults.default_steps))?;
    set_workflow_input(&mut workflow, "371", "cfg", json!(defaults.cfg_scale))?;
    set_workflow_input(
        &mut workflow,
        "371",
        "sampler_name",
        json!(defaults.sampler_name),
    )?;
    set_workflow_input(&mut workflow, "371", "scheduler", json!(defaults.scheduler))?;
    set_workflow_input(&mut workflow, "371", "batch_size", json!(count))?;
    if !edit_negative_prompt.trim().is_empty() {
        let template_negative_prompt = workflow
            .get("371")
            .and_then(|node| node.get("inputs"))
            .and_then(|inputs| inputs.get("negative_prompt"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let merged_negative_prompt = if template_negative_prompt.is_empty() {
            edit_negative_prompt.clone()
        } else {
            format!("{template_negative_prompt}\n{edit_negative_prompt}")
        };
        set_workflow_input(
            &mut workflow,
            "371",
            "negative_prompt",
            json!(merged_negative_prompt),
        )?;
    }
    set_workflow_input(&mut workflow, "374", "image", json!(uploaded_image))?;
    set_workflow_input(&mut workflow, "380", "value", json!(longest_side.max(64)))?;
    set_workflow_input(&mut workflow, "547", "prompt", json!(edit_prompt))?;
    set_workflow_input(
        &mut workflow,
        "379",
        "filename_prefix",
        json!(DEFAULT_OUTPUT_PREFIX),
    )?;
    set_workflow_input(
        &mut workflow,
        "371",
        "output_filename_prefix",
        json!(DEFAULT_OUTPUT_PREFIX),
    )?;
    Ok(workflow)
}

fn set_workflow_input(
    workflow: &mut Value,
    node_id: &str,
    input_name: &str,
    value: Value,
) -> Result<(), String> {
    let inputs = workflow
        .get_mut(node_id)
        .and_then(|node| node.get_mut("inputs"))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| format!("ComfyUI workflow 缺少节点 {node_id}.{input_name}"))?;
    inputs.insert(input_name.to_string(), value);
    Ok(())
}

fn normalize_optional_comfyui_lora(lora_name: &str) -> String {
    let trimmed = lora_name.trim();
    if trimmed.is_empty() {
        "None".to_string()
    } else {
        trimmed.to_string()
    }
}

fn random_seed() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| (duration.as_nanos() & (u64::MAX as u128)) as u64)
        .unwrap_or(1)
}

fn unique_id_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| format!("{}-{}", std::process::id(), duration.as_nanos()))
        .unwrap_or_else(|_| format!("{}-fallback", std::process::id()))
}

async fn submit_and_wait_comfyui_prompt(
    client: &reqwest::Client,
    headers: &HeaderMap,
    base_url: &str,
    client_id: &str,
    workflow: Value,
    label: &str,
) -> Result<Value, String> {
    let enqueue_url = join_endpoint(base_url, "prompt");
    let response = client
        .post(&enqueue_url)
        .headers(headers.clone())
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "weBot Image Service")
        .json(&json!({
            "client_id": client_id,
            "prompt": workflow,
        }))
        .send()
        .await
        .map_err(|err| format!("请求 {label} 失败: {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取 {label} 响应失败: {err}"))?;
    if !status.is_success() {
        return Err(format!("{label}返回错误({status}): {}", text.trim()));
    }
    let enqueue_json = serde_json::from_str::<Value>(&text)
        .map_err(|err| format!("{label}返回非 JSON: {err}; body={text}"))?;
    let prompt_id = enqueue_json
        .get("prompt_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{label}未返回 prompt_id"))?;
    poll_comfyui_history(client, headers, base_url, prompt_id).await
}

async fn poll_comfyui_history(
    client: &reqwest::Client,
    headers: &HeaderMap,
    base_url: &str,
    prompt_id: &str,
) -> Result<Value, String> {
    let history_url = join_endpoint(base_url, &format!("history/{prompt_id}"));
    let mut last_body = Value::Null;
    for _ in 0..90 {
        let response = client
            .get(&history_url)
            .headers(headers.clone())
            .header(USER_AGENT, "weBot Image Service")
            .send()
            .await
            .map_err(|err| format!("轮询 ComfyUI 历史失败: {err}"))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|err| format!("读取 ComfyUI 历史响应失败: {err}"))?;
        if !status.is_success() {
            return Err(format!(
                "ComfyUI 历史接口返回错误({status}): {}",
                text.trim()
            ));
        }
        let payload = serde_json::from_str::<Value>(&text)
            .map_err(|err| format!("ComfyUI 历史接口返回非 JSON: {err}; body={text}"))?;
        if let Some(found) = payload.get(prompt_id) {
            if found
                .get("outputs")
                .and_then(Value::as_object)
                .map(|outputs| !outputs.is_empty())
                .unwrap_or(false)
            {
                return Ok(found.clone());
            }
            last_body = found.clone();
        } else {
            last_body = payload;
        }
        sleep(Duration::from_secs(1)).await;
    }

    Err(format!("ComfyUI 执行超时，最后状态: {}", last_body))
}

#[derive(Debug, Clone)]
struct ComfyImageRef {
    filename: String,
    subfolder: String,
    file_type: String,
}

fn extract_comfyui_output_images(history: &Value) -> Vec<ComfyImageRef> {
    let mut items = Vec::new();
    let outputs = history
        .get("outputs")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    for (_, node_output) in outputs {
        let Some(node_object) = node_output.as_object() else {
            continue;
        };
        let Some(entries) = node_object.get("images").and_then(Value::as_array) else {
            continue;
        };
        for entry in entries {
            let Some(entry_object) = entry.as_object() else {
                continue;
            };
            let filename = entry_object
                .get("filename")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string();
            if filename.is_empty() {
                continue;
            }
            items.push(ComfyImageRef {
                filename,
                subfolder: entry_object
                    .get("subfolder")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                file_type: entry_object
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("output")
                    .to_string(),
            });
        }
    }

    items
}

fn build_comfyui_view_url(base_url: &str, image_ref: &ComfyImageRef) -> Result<String, String> {
    let mut url = reqwest::Url::parse(&join_endpoint(base_url, "view"))
        .map_err(|err| format!("无效的 ComfyUI 地址: {err}"))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("filename", &image_ref.filename);
        query.append_pair("subfolder", &image_ref.subfolder);
        query.append_pair("type", &image_ref.file_type);
    }
    Ok(url.to_string())
}

async fn load_image_edit_source(
    payload: &ExecuteImageEditRequest,
    client: &reqwest::Client,
) -> Result<(Vec<u8>, String), String> {
    if !payload.image_base64.trim().is_empty() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.image_base64.trim())
            .map_err(|err| format!("解析 image_base64 失败: {err}"))?;
        let mime_type = normalize_image_mime_type(payload.mime_type.trim())
            .ok_or_else(|| format!("不支持的 MIME 类型: {}", payload.mime_type.trim()))?;
        return Ok((bytes, mime_type.to_string()));
    }

    if !payload.image_path.trim().is_empty() {
        let path = PathBuf::from(payload.image_path.trim());
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|err| format!("读取原图失败({}): {err}", path.display()))?;
        let mime_type = detect_image_mime_from_path_or_bytes(path.to_str(), &bytes)
            .ok_or_else(|| format!("不支持的图片格式: {}", path.display()))?;
        return Ok((bytes, mime_type.to_string()));
    }

    let image_url = payload.image_url.trim();
    if let Some(file_id) = extract_local_upload_id(image_url) {
        let cache_path = env::temp_dir().join("openfang_uploads").join(file_id);
        let workspace_root = resolve_workspace_root(&payload.workspace_root);
        let (bytes, mime_hint_path) = match tokio::fs::read(&cache_path).await {
            Ok(bytes) => (bytes, cache_path.clone()),
            Err(cache_err) => {
                let restored_path =
                    recover_persisted_upload_path(file_id, workspace_root.as_deref()).ok_or_else(
                        || format!("读取上传缓存失败({}): {cache_err}", cache_path.display()),
                    )?;
                let restored_bytes = tokio::fs::read(&restored_path).await.map_err(|err| {
                    format!("读取恢复后的原图失败({}): {err}", restored_path.display())
                })?;
                if let Err(err) = repopulate_local_upload_cache(file_id, &restored_bytes) {
                    eprintln!("failed to repopulate upload cache for {file_id}: {err}");
                }
                (restored_bytes, restored_path)
            }
        };
        let mime_type = detect_image_mime_from_path_or_bytes(mime_hint_path.to_str(), &bytes)
            .ok_or_else(|| format!("不支持的缓存图片格式: {}", mime_hint_path.display()))?;
        return Ok((bytes, mime_type.to_string()));
    }

    if !(image_url.starts_with("http://") || image_url.starts_with("https://")) {
        return Err(format!(
            "不支持的 image_url：{}，请使用 image_path、/api/uploads/... 或 http(s) 地址",
            image_url
        ));
    }

    let (bytes, mime_type) = fetch_binary_with_mime(client, &HeaderMap::new(), image_url).await?;
    Ok((bytes, mime_type))
}

fn repopulate_local_upload_cache(file_id: &str, bytes: &[u8]) -> Result<(), String> {
    let upload_dir = env::temp_dir().join("openfang_uploads");
    fs::create_dir_all(&upload_dir)
        .map_err(|err| format!("创建上传缓存目录失败({}): {err}", upload_dir.display()))?;
    fs::write(upload_dir.join(file_id), bytes).map_err(|err| format!("回填上传缓存失败: {err}"))
}

fn recover_persisted_upload_path(file_id: &str, workspace_root: Option<&Path>) -> Option<PathBuf> {
    for root in candidate_workspace_roots(workspace_root) {
        if !root.exists() {
            continue;
        }

        let direct_sessions_dir = root.join("sessions");
        if direct_sessions_dir.exists() {
            if let Some(saved_path) =
                recover_persisted_upload_path_from_sessions(&direct_sessions_dir, file_id)
            {
                return Some(saved_path);
            }
        }

        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }

            let sessions_dir = path.join("sessions");
            if !sessions_dir.exists() {
                continue;
            }

            if let Some(saved_path) =
                recover_persisted_upload_path_from_sessions(&sessions_dir, file_id)
            {
                return Some(saved_path);
            }
        }
    }

    None
}

fn candidate_workspace_roots(workspace_root: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = workspace_root {
        if let Some(parent) = root.parent() {
            roots.push(parent.to_path_buf());
        }
        roots.push(root.to_path_buf());
    }
    if let Ok(root) = path_resolver::workspaces_root() {
        roots.push(root);
    }
    if let Ok(root) = path_resolver::legacy_openfang_home_dir() {
        roots.push(root.join("workspaces"));
    }

    let mut deduped = Vec::new();
    for root in roots {
        if deduped.iter().any(|existing| existing == &root) {
            continue;
        }
        deduped.push(root);
    }
    deduped
}

fn recover_persisted_upload_path_from_sessions(
    sessions_dir: &Path,
    file_id: &str,
) -> Option<PathBuf> {
    let entries = fs::read_dir(sessions_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }

        let file = fs::File::open(&path).ok()?;
        let reader = BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(saved_path) =
                recover_persisted_upload_path_from_session_line(&line, file_id)
            {
                return Some(saved_path);
            }
        }
    }
    None
}

fn recover_persisted_upload_path_from_session_line(line: &str, file_id: &str) -> Option<PathBuf> {
    let payload = serde_json::from_str::<Value>(line).ok()?;
    let tool_use_entries = payload.get("tool_use")?.as_array()?;
    for entry in tool_use_entries {
        let Some(content) = entry.get("content").and_then(Value::as_str) else {
            continue;
        };
        if let Some(saved_path) = recover_persisted_upload_path_from_tool_result(content, file_id) {
            return Some(saved_path);
        }
    }
    None
}

fn recover_persisted_upload_path_from_tool_result(content: &str, file_id: &str) -> Option<PathBuf> {
    let payload = serde_json::from_str::<Value>(content).ok()?;
    let image_urls = payload.get("image_urls")?.as_array()?;
    let saved_to = payload.get("saved_to")?.as_array()?;

    for (image_url, saved_path) in image_urls.iter().zip(saved_to.iter()) {
        let Some(image_url) = image_url.as_str() else {
            continue;
        };
        let Some(saved_path) = saved_path.as_str() else {
            continue;
        };
        if extract_local_upload_id(image_url) != Some(file_id) {
            continue;
        }
        let path = PathBuf::from(saved_path.trim());
        if path.exists() {
            return Some(path);
        }
    }

    None
}

async fn upload_image_to_comfyui(
    client: &reqwest::Client,
    headers: &HeaderMap,
    base_url: &str,
    bytes: &[u8],
    mime_type: &str,
) -> Result<String, String> {
    let ext = extension_from_mime_type(mime_type).unwrap_or("png");
    let fallback_name = format!("webot-edit-{}.{}", unique_id_string(), ext);
    let part = reqwest::multipart::Part::bytes(bytes.to_vec())
        .file_name(fallback_name.clone())
        .mime_str(mime_type)
        .map_err(|err| format!("无效的上传 MIME 类型 {mime_type}: {err}"))?;
    let form = reqwest::multipart::Form::new()
        .text("type", "input")
        .text("overwrite", "true")
        .part("image", part);

    let response = client
        .post(join_endpoint(base_url, "upload/image"))
        .headers(headers.clone())
        .header(USER_AGENT, "weBot Image Service")
        .multipart(form)
        .send()
        .await
        .map_err(|err| format!("上传图片到 ComfyUI 失败: {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取 ComfyUI 上传响应失败: {err}"))?;
    if !status.is_success() {
        return Err(format!("ComfyUI 上传图片失败({status}): {}", text.trim()));
    }
    let payload = serde_json::from_str::<Value>(&text).unwrap_or(Value::Null);
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| payload.get("filename").and_then(Value::as_str))
        .unwrap_or(&fallback_name)
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("ComfyUI 上传成功但未返回文件名".to_string());
    }
    Ok(name)
}

async fn fetch_binary_with_mime(
    client: &reqwest::Client,
    headers: &HeaderMap,
    url: &str,
) -> Result<(Vec<u8>, String), String> {
    let response = client
        .get(url)
        .headers(headers.clone())
        .header(USER_AGENT, "weBot Image Service")
        .send()
        .await
        .map_err(|err| format!("下载图片失败: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("下载图片失败({status}): {}", text.trim()));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(normalize_image_mime_type)
        .map(str::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取图片字节失败: {err}"))?
        .to_vec();
    if bytes.len() > MAX_BASE64_BYTES {
        return Err("图片结果超过 10MB 上限".to_string());
    }
    let mime_type = content_type
        .or_else(|| detect_image_mime_from_path_or_bytes(None, &bytes).map(str::to_string))
        .ok_or_else(|| format!("无法识别图片 MIME 类型: {url}"))?;
    Ok((bytes, mime_type))
}

async fn poll_modelscope_task(
    client: &reqwest::Client,
    config: &ModelscopeImageGenerationConfig,
    task_id: &str,
) -> Result<Value, String> {
    let mut headers = build_modelscope_headers(&config.api_key, &config.api_secret)?;
    headers.insert(
        HeaderName::from_static(MODELSCOPE_TASK_TYPE_HEADER),
        HeaderValue::from_static("image_generation"),
    );
    let task_url = join_endpoint(&config.base_url, &format!("v1/tasks/{task_id}"));
    let mut last_body = Value::Null;

    for _ in 0..90 {
        let response = client
            .get(&task_url)
            .headers(headers.clone())
            .header(USER_AGENT, "weBot Image Service")
            .send()
            .await
            .map_err(|err| format!("轮询 ModelScope 任务失败: {err}"))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|err| format!("读取 ModelScope 任务响应失败: {err}"))?;
        if !status.is_success() {
            return Err(format!(
                "ModelScope 任务接口返回错误({status}): {}",
                text.trim()
            ));
        }
        let payload = serde_json::from_str::<Value>(&text)
            .map_err(|err| format!("ModelScope 任务接口返回非 JSON: {err}; body={text}"))?;
        match payload
            .get("task_status")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "SUCCEED" => return Ok(payload),
            "FAILED" => return Err(format!("ModelScope 图片生成失败: {}", payload)),
            _ => {
                last_body = payload;
                sleep(Duration::from_secs(2)).await;
            }
        }
    }

    Err(format!("ModelScope 图片生成超时，最后状态: {}", last_body))
}

fn extract_modelscope_output_urls(payload: &Value) -> Vec<String> {
    let mut urls = Vec::new();
    for key in ["output_images", "images", "results"] {
        if let Some(value) = payload.get(key) {
            collect_urls_from_value(value, &mut urls);
        }
    }
    if let Some(output) = payload.get("output") {
        collect_urls_from_value(output, &mut urls);
    }
    urls.sort();
    urls.dedup();
    urls
}

fn collect_urls_from_value(value: &Value, urls: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                urls.push(trimmed.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_urls_from_value(item, urls);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_urls_from_value(item, urls);
            }
        }
        _ => {}
    }
}

fn build_modelscope_headers(api_key: &str, api_secret: &str) -> Result<HeaderMap, String> {
    let mut headers = build_auth_headers(api_key)?;
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let trimmed_secret = api_secret.trim();
    if !trimmed_secret.is_empty() {
        headers.insert(
            HeaderName::from_static(MODELSCOPE_SECRET_HEADER),
            HeaderValue::from_str(trimmed_secret)
                .map_err(|err| format!("ModelScope Secret 头无效: {err}"))?,
        );
    }
    Ok(headers)
}

fn join_endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn extract_local_upload_id(image_url: &str) -> Option<&str> {
    let trimmed = image_url.trim();
    trimmed
        .strip_prefix("/api/uploads/")
        .or_else(|| trimmed.strip_prefix("api/uploads/"))
        .or_else(|| {
            let marker = "/api/uploads/";
            let index = trimmed.find(marker)?;
            let rest = &trimmed[index + marker.len()..];
            let id = rest.split(['/', '?', '#']).next()?;
            if id.is_empty() {
                None
            } else {
                Some(id)
            }
        })
        .filter(|value| !value.is_empty())
}

fn normalize_image_mime_type(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "image/png" | "png" => Some("image/png"),
        "image/jpeg" | "image/jpg" | "jpg" | "jpeg" => Some("image/jpeg"),
        "image/webp" | "webp" => Some("image/webp"),
        "image/gif" | "gif" => Some("image/gif"),
        "image/bmp" | "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn extension_from_mime_type(mime_type: &str) -> Option<&'static str> {
    match normalize_image_mime_type(mime_type)? {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/bmp" => Some("bmp"),
        _ => None,
    }
}

fn detect_image_mime_from_path_or_bytes(path: Option<&str>, bytes: &[u8]) -> Option<&'static str> {
    if let Some(path) = path {
        let extension = Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if let Some(mime_type) = normalize_image_mime_type(extension) {
            return Some(mime_type);
        }
    }

    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    None
}
