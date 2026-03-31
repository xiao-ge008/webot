use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::Json;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::Digest;
use tokio::time::sleep;
use uuid::Uuid;

use crate::assignment_store::{
    self, CapabilityDescriptorRecord, CapabilityJobRecord, CapabilityProviderBindingRecord,
    CapabilityProviderRecord, ProviderHealthStateRecord,
};
use crate::error::ApiError;
use crate::path_resolver;
use crate::AppState;

const COMPONENT_DEFINITION_FILE: &str = "component-center.definition.json";
const COMPONENT_MANIFEST_FILE: &str = "components.manifest.json";
const COMPONENT_SKILL_FILE: &str = "SKILL.md";
const COMPONENT_PROMPT_CONTEXT_FILE: &str = "prompt_context.md";
const COMPONENT_SKILL_TOML_FILE: &str = "skill.toml";
const COMPONENT_TOOL_ADAPTER_FILE: &str = "tool-adapter.js";
const RUNNINGHUB_STATUS_ENDPOINT: &str = "/task/openapi/status";
const RUNNINGHUB_OUTPUTS_ENDPOINT: &str = "/task/openapi/outputs";
const COMFYUI_JOB_QUERY_TIMEOUT_SECS: u64 = 15;
const RUNNINGHUB_JOB_QUERY_TIMEOUT_SECS: u64 = 15;
const AGENT_PROFILE_DIR_NAME: &str = "agent_profile";

fn default_comfyui_server_url() -> String {
    "http://127.0.0.1:8188".to_string()
}

fn default_runninghub_server_url() -> String {
    "https://www.runninghub.ai".to_string()
}

fn default_runninghub_instance_type() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentServiceConfig {
    pub server_url: String,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentProviderConfigs {
    pub comfyui: ComponentServiceConfig,
    pub runninghub: ComponentServiceConfig,
}

impl Default for ComponentProviderConfigs {
    fn default() -> Self {
        Self {
            comfyui: ComponentServiceConfig {
                server_url: default_comfyui_server_url(),
                api_key: String::new(),
            },
            runninghub: ComponentServiceConfig {
                server_url: default_runninghub_server_url(),
                api_key: String::new(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ComponentProviderType {
    Comfyui,
    Runninghub,
}

impl Default for ComponentProviderType {
    fn default() -> Self {
        Self::Comfyui
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ComponentReturnType {
    Image,
    Text,
    Video,
    Audio,
}

impl Default for ComponentReturnType {
    fn default() -> Self {
        Self::Image
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ComponentParamValueType {
    String,
    Number,
    Boolean,
    Json,
}

impl Default for ComponentParamValueType {
    fn default() -> Self {
        Self::String
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNodeField {
    #[serde(default)]
    pub field_name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub value_type: ComponentParamValueType,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub default_value: Value,
    #[serde(default)]
    pub options: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNode {
    #[serde(default)]
    pub node_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub node_type: String,
    #[serde(default)]
    pub fields: Vec<WorkflowNodeField>,
    #[serde(default)]
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComponentParameterMapping {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub node_id: String,
    #[serde(default)]
    pub field_name: String,
    #[serde(default)]
    pub parameter_name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub value_type: ComponentParamValueType,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub default_value: Value,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComponentWorkflowConfig {
    #[serde(default)]
    pub request_url: String,
    #[serde(default)]
    pub app_id: String,
    #[serde(default)]
    pub raw_payload: Value,
    #[serde(default)]
    pub nodes: Vec<WorkflowNode>,
    #[serde(default)]
    pub parameter_mappings: Vec<ComponentParameterMapping>,
    #[serde(default = "default_runninghub_instance_type")]
    pub runninghub_instance_type: String,
    #[serde(default)]
    pub runninghub_use_personal_queue: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComponentCapabilityBinding {
    #[serde(default)]
    pub capability_key: String,
    #[serde(default)]
    pub capability_scope: String,
    #[serde(default)]
    pub base_tool: String,
    #[serde(default)]
    pub tool_mode: String,
    #[serde(default)]
    pub source_policy: String,
    #[serde(default)]
    pub fallback_policy: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub priority: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSelectorMeta {
    #[serde(default)]
    pub specialization: String,
    #[serde(default)]
    pub intent_tags: Vec<String>,
    #[serde(default)]
    pub subject_policy: String,
    #[serde(default)]
    pub supports_text_only: bool,
    #[serde(default)]
    pub requires_slots: Vec<String>,
    #[serde(default)]
    pub optional_slots: Vec<String>,
    #[serde(default)]
    pub preferred_mime_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDefinition {
    #[serde(default)]
    pub provider_type: ComponentProviderType,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub english_name: String,
    #[serde(default)]
    pub component_type: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub return_type: ComponentReturnType,
    #[serde(default)]
    pub capability_binding: ComponentCapabilityBinding,
    #[serde(default)]
    pub selector_meta: ComponentSelectorMeta,
    #[serde(default)]
    pub workflow: ComponentWorkflowConfig,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentInvokeRequest {
    #[serde(default)]
    pub params: Map<String, Value>,
    #[serde(default, alias = "agentId")]
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentCapabilityInvokeRequest {
    #[serde(default)]
    pub tool_name: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default, alias = "agentId")]
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentInvokeItem {
    pub kind: String,
    pub url: String,
    pub text: String,
    pub mime_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentInvokeResult {
    pub output_type: ComponentReturnType,
    pub text: String,
    pub items: Vec<ComponentInvokeItem>,
    pub raw: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presentable_result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_meta: Option<Value>,
}

#[derive(Debug, Clone)]
struct ComponentVideoLocalizationResult {
    raw: Value,
    items: Vec<ComponentInvokeItem>,
}

#[derive(Debug, Clone)]
struct ComponentVideoSavePlan {
    canonical_dir: PathBuf,
    public_dir: PathBuf,
    public_relative_dir: String,
    save_target: String,
    owner_scope: String,
    meta_label: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LegacyManifestFile {
    #[serde(default)]
    components: Vec<LegacyManifestComponent>,
}

#[derive(Debug, Deserialize)]
struct LegacyManifestComponent {
    #[serde(default)]
    name: String,
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    description: String,
}

pub async fn get_component_provider_configs() -> Result<Json<Value>, ApiError> {
    let config = read_component_provider_configs().map_err(internal_error)?;
    Ok(Json(json!({ "config": config })))
}

pub async fn set_component_provider_configs(
    Json(payload): Json<ComponentProviderConfigs>,
) -> Result<Json<Value>, ApiError> {
    let config = write_component_provider_configs(payload).map_err(internal_error)?;
    Ok(Json(json!({ "config": config })))
}

pub async fn list_component_definitions() -> Result<Json<Value>, ApiError> {
    let items = load_all_component_definitions().map_err(internal_error)?;
    Ok(Json(json!({ "items": items })))
}

pub async fn get_component_definition(
    AxumPath(component_key): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    let item = load_component_definition_by_lookup_key(&component_key)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "组件不存在"))?;
    Ok(Json(json!({ "item": item })))
}

pub async fn create_component_definition(
    Json(payload): Json<ComponentDefinition>,
) -> Result<Json<Value>, ApiError> {
    let item = upsert_component_definition(None, payload).map_err(map_upsert_error)?;
    Ok(Json(json!({ "item": item })))
}

pub async fn update_component_definition(
    AxumPath(english_name): AxumPath<String>,
    Json(payload): Json<ComponentDefinition>,
) -> Result<Json<Value>, ApiError> {
    let item = upsert_component_definition(Some(english_name.as_str()), payload)
        .map_err(map_upsert_error)?;
    Ok(Json(json!({ "item": item })))
}

pub async fn delete_component_definition(
    AxumPath(english_name): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    delete_component_definition_impl(&english_name).map_err(map_upsert_error)?;
    Ok(Json(json!({ "deleted": true })))
}

pub async fn invoke_component_definition(
    State(state): State<Arc<AppState>>,
    AxumPath(component_key): AxumPath<String>,
    Json(payload): Json<ComponentInvokeRequest>,
) -> Result<Json<ComponentInvokeResult>, ApiError> {
    let item = load_component_definition_by_lookup_key(&component_key)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "组件不存在"))?;
    let configs = read_component_provider_configs().map_err(internal_error)?;
    let result = match item.provider_type {
        ComponentProviderType::Comfyui => {
            invoke_comfyui_component(
                &state,
                &item,
                &configs.comfyui,
                &payload.params,
                payload.agent_id.as_deref(),
            )
            .await?
        }
        ComponentProviderType::Runninghub => {
            invoke_runninghub_component(
                &item,
                &configs.runninghub,
                &payload.params,
                payload.agent_id.as_deref(),
            )
            .await?
        }
    };
    Ok(Json(result))
}

pub async fn invoke_component_capability_definition(
    State(state): State<Arc<AppState>>,
    AxumPath(component_key): AxumPath<String>,
    Json(payload): Json<ComponentCapabilityInvokeRequest>,
) -> Result<Json<ComponentInvokeResult>, ApiError> {
    let item = load_component_definition_by_lookup_key(&component_key)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "组件不存在"))?;
    let tool_name = payload.tool_name.trim();
    if tool_name.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "toolName 不能为空"));
    }
    let params = build_component_params_from_capability_input(&item, tool_name, &payload.input)?;
    let configs = read_component_provider_configs().map_err(internal_error)?;
    let result = match item.provider_type {
        ComponentProviderType::Comfyui => {
            invoke_comfyui_component(
                &state,
                &item,
                &configs.comfyui,
                &params,
                payload.agent_id.as_deref(),
            )
            .await?
        }
        ComponentProviderType::Runninghub => {
            invoke_runninghub_component(
                &item,
                &configs.runninghub,
                &params,
                payload.agent_id.as_deref(),
            )
            .await?
        }
    };
    Ok(Json(result))
}

fn internal_error(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message.into())
}

fn component_return_type_to_media_kind(value: &ComponentReturnType) -> Option<&'static str> {
    match value {
        ComponentReturnType::Image => Some("image"),
        ComponentReturnType::Video => Some("video"),
        ComponentReturnType::Audio => Some("audio"),
        ComponentReturnType::Text => None,
    }
}

fn component_return_type_to_capability(value: &ComponentReturnType) -> Option<&'static str> {
    match value {
        ComponentReturnType::Image => Some("generate.image"),
        ComponentReturnType::Video => Some("generate.video"),
        ComponentReturnType::Audio => Some("generate.audio"),
        ComponentReturnType::Text => None,
    }
}

fn component_capability_key_to_media_kind(value: &str) -> Option<&'static str> {
    match value.trim() {
        "generate.image" | "edit.image" => Some("image"),
        "generate.video" | "edit.video" => Some("video"),
        "generate.audio" | "transcribe.audio" => Some("audio"),
        _ => None,
    }
}

fn is_document_capability_key(value: &str) -> bool {
    matches!(
        value.trim(),
        "parse.document"
            | "extract.document"
            | "summarize.document"
            | "convert.document"
            | "compare.document"
            | "preview.document"
            | "chunk.document"
    )
}

fn build_document_component_capability_binding(
    capability_key: &str,
) -> Option<ComponentCapabilityBinding> {
    let (base_tool, tool_mode) = match capability_key.trim() {
        "parse.document" => ("document_parse", "parse"),
        "extract.document" => ("document_extract", "extract"),
        "summarize.document" => ("document_summarize", "summarize"),
        "convert.document" => ("document_convert", "convert"),
        "compare.document" => ("document_compare", "compare"),
        "preview.document" => ("document_preview", "preview"),
        "chunk.document" => ("document_chunk", "chunk"),
        _ => return None,
    };
    Some(ComponentCapabilityBinding {
        capability_key: capability_key.trim().to_string(),
        capability_scope: "generic".to_string(),
        base_tool: base_tool.to_string(),
        tool_mode: tool_mode.to_string(),
        source_policy: "required".to_string(),
        fallback_policy: "allow_generic_provider".to_string(),
        enabled: true,
        priority: 100,
    })
}

fn infer_document_component_capability_key(item: &ComponentDefinition) -> Option<&'static str> {
    if item.return_type != ComponentReturnType::Text {
        return None;
    }
    let mapping_hints = item
        .workflow
        .parameter_mappings
        .iter()
        .map(|mapping| {
            format!(
                "{} {} {} {}",
                mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    let combined = format!(
        "{} {} {} {} {}",
        item.name, item.english_name, item.component_type, item.description, mapping_hints
    )
    .to_ascii_lowercase();
    if combined.is_empty() {
        return None;
    }
    if combined.contains("compare")
        || combined.contains("diff")
        || combined.contains("比较")
        || combined.contains("对比")
    {
        return Some("compare.document");
    }
    if combined.contains("convert")
        || combined.contains("conversion")
        || combined.contains("export")
        || combined.contains("转换")
        || combined.contains("导出")
    {
        return Some("convert.document");
    }
    if combined.contains("preview")
        || combined.contains("viewer")
        || combined.contains("render")
        || combined.contains("预览")
        || combined.contains("浏览")
    {
        return Some("preview.document");
    }
    if combined.contains("chunk")
        || combined.contains("segment")
        || combined.contains("split")
        || combined.contains("分块")
        || combined.contains("切片")
    {
        return Some("chunk.document");
    }
    if combined.contains("summary")
        || combined.contains("summarize")
        || combined.contains("摘要")
        || combined.contains("总结")
        || combined.contains("概括")
    {
        return Some("summarize.document");
    }
    if combined.contains("extract")
        || combined.contains("extractor")
        || combined.contains("抽取")
        || combined.contains("提取")
    {
        return Some("extract.document");
    }
    if combined.contains("parse")
        || combined.contains("parser")
        || combined.contains("reader")
        || combined.contains("ocr")
        || combined.contains("pdf")
        || combined.contains("docx")
        || combined.contains("xlsx")
        || combined.contains("pptx")
        || combined.contains("word")
        || combined.contains("excel")
        || combined.contains("office")
        || combined.contains("markdown")
        || combined.contains("json")
        || combined.contains("txt")
        || combined.contains("csv")
        || combined.contains("文档")
        || combined.contains("解析")
        || combined.contains("识别")
    {
        return Some("parse.document");
    }
    None
}

fn default_component_capability_binding(
    item: &ComponentDefinition,
) -> Option<ComponentCapabilityBinding> {
    if let Some(capability_key) = infer_document_component_capability_key(item) {
        return build_document_component_capability_binding(capability_key);
    }
    match item.return_type {
        ComponentReturnType::Image => Some(ComponentCapabilityBinding {
            capability_key: "generate.image".to_string(),
            capability_scope: "generic".to_string(),
            base_tool: "image_generate".to_string(),
            tool_mode: "generate".to_string(),
            source_policy: "optional".to_string(),
            fallback_policy: "allow_generic_provider".to_string(),
            enabled: true,
            priority: 100,
        }),
        ComponentReturnType::Video => Some(ComponentCapabilityBinding {
            capability_key: "generate.video".to_string(),
            capability_scope: "generic".to_string(),
            base_tool: "video_generate".to_string(),
            tool_mode: "generate".to_string(),
            source_policy: "optional".to_string(),
            fallback_policy: "allow_generic_provider".to_string(),
            enabled: true,
            priority: 100,
        }),
        ComponentReturnType::Audio => Some(ComponentCapabilityBinding {
            capability_key: "generate.audio".to_string(),
            capability_scope: "generic".to_string(),
            base_tool: "text_to_speech".to_string(),
            tool_mode: "generate".to_string(),
            source_policy: "text_only".to_string(),
            fallback_policy: "allow_generic_provider".to_string(),
            enabled: true,
            priority: 100,
        }),
        ComponentReturnType::Text => Some(ComponentCapabilityBinding {
            capability_key: "generate.text".to_string(),
            capability_scope: "generic".to_string(),
            base_tool: "component_invoke".to_string(),
            tool_mode: "generate".to_string(),
            source_policy: "optional".to_string(),
            fallback_policy: "manual_only".to_string(),
            enabled: true,
            priority: 100,
        }),
    }
}

fn normalized_mapping_search_text(mapping: &ComponentParameterMapping) -> String {
    format!(
        "{} {} {} {}",
        mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
    )
    .trim()
    .to_ascii_lowercase()
}

fn infer_mapping_slot(
    item: &ComponentDefinition,
    mapping: &ComponentParameterMapping,
) -> Option<&'static str> {
    let combined = normalized_mapping_search_text(mapping);
    if combined.is_empty() {
        return None;
    }
    if combined.contains("left_document")
        || combined.contains("left file")
        || combined.contains("左文档")
    {
        return Some("left_document");
    }
    if combined.contains("right_document")
        || combined.contains("right file")
        || combined.contains("右文档")
    {
        return Some("right_document");
    }
    if combined.contains("target_format")
        || combined.contains("target format")
        || combined.contains("目标格式")
    {
        return Some("target_format");
    }
    if combined.contains("document_type") || combined.contains("文档类型") {
        return Some("document_type");
    }
    if combined.contains("left_type") {
        return Some("left_type");
    }
    if combined.contains("right_type") {
        return Some("right_type");
    }
    if combined.contains("document")
        || combined.contains("file")
        || combined.contains("pdf")
        || combined.contains("docx")
        || combined.contains("xlsx")
        || combined.contains("pptx")
        || combined.contains("markdown")
        || combined.contains("文档")
        || combined.contains("文件")
    {
        return Some("document");
    }
    if combined.contains("source_image")
        || combined.contains("reference_image")
        || combined.contains("image")
        || combined.contains("photo")
        || combined.contains("poster")
        || combined.contains("cover")
        || combined.contains("图片")
        || combined.contains("图像")
    {
        return Some("image");
    }
    if combined.contains("source_video")
        || combined.contains("video")
        || combined.contains("clip")
        || combined.contains("movie")
        || combined.contains("视频")
    {
        return Some("video");
    }
    if combined.contains("voice") || combined.contains("speaker") || combined.contains("音色") {
        return Some("voice");
    }
    if combined.contains("audio")
        || combined.contains("record")
        || combined.contains("speech")
        || combined.contains("音频")
        || combined.contains("录音")
    {
        return Some("audio");
    }
    if combined.contains("prompt")
        || combined.contains("text")
        || combined.contains("message")
        || combined.contains("description")
        || combined.contains("question")
        || combined.contains("content")
        || combined.contains("script")
        || combined.contains("story")
        || combined.contains("tag")
        || combined.contains("lyrics")
        || combined.contains("提示词")
        || combined.contains("文本")
        || combined.contains("描述")
    {
        return Some(match item.return_type {
            ComponentReturnType::Audio => "text",
            _ => "prompt",
        });
    }
    None
}

fn is_selector_system_slot(slot: &str) -> bool {
    matches!(
        slot.trim().to_ascii_lowercase().as_str(),
        "prompt"
            | "text"
            | "image"
            | "video"
            | "audio"
            | "voice"
            | "document"
            | "left_document"
            | "right_document"
            | "document_type"
            | "left_type"
            | "right_type"
            | "target_format"
    )
}

fn push_unique_slot(slots: &mut Vec<String>, slot: &str) {
    if slots.iter().any(|item| item.eq_ignore_ascii_case(slot)) {
        return;
    }
    slots.push(slot.to_string());
}

fn apply_mapping_selector_inference(item: &mut ComponentDefinition) {
    let mut required_slots = item
        .selector_meta
        .requires_slots
        .iter()
        .filter(|slot| !is_selector_system_slot(slot))
        .cloned()
        .collect::<Vec<_>>();
    let mut optional_slots = item
        .selector_meta
        .optional_slots
        .iter()
        .filter(|slot| !is_selector_system_slot(slot))
        .cloned()
        .collect::<Vec<_>>();

    let mut has_required_text = false;
    let mut has_required_image = false;
    let mut has_required_video = false;
    let mut has_required_audio = false;

    for mapping in &item.workflow.parameter_mappings {
        let Some(slot) = infer_mapping_slot(item, mapping) else {
            continue;
        };
        if mapping.required {
            push_unique_slot(&mut required_slots, slot);
            optional_slots.retain(|current| !current.eq_ignore_ascii_case(slot));
            match slot {
                "prompt" | "text" => has_required_text = true,
                "image" => has_required_image = true,
                "video" => has_required_video = true,
                "audio" => has_required_audio = true,
                _ => {}
            }
        } else {
            push_unique_slot(&mut optional_slots, slot);
        }
    }

    item.selector_meta.requires_slots = normalize_string_vec(&required_slots);
    item.selector_meta.optional_slots = normalize_string_vec(&optional_slots);

    let requires_source = has_required_image || has_required_video || has_required_audio;
    if requires_source {
        item.selector_meta.supports_text_only = false;
    } else if has_required_text {
        item.selector_meta.supports_text_only = true;
    }

    let inferred_source_policy = if has_required_image {
        Some("requires_image")
    } else if has_required_video {
        Some("requires_video")
    } else if has_required_audio {
        Some("requires_audio")
    } else if has_required_text
        && matches!(
            item.return_type,
            ComponentReturnType::Audio | ComponentReturnType::Video
        )
    {
        Some("text_only")
    } else {
        None
    };
    if let Some(policy) = inferred_source_policy {
        let current = item
            .capability_binding
            .source_policy
            .trim()
            .to_ascii_lowercase();
        let should_replace = current.is_empty()
            || (matches!(
                current.as_str(),
                "optional" | "text_only" | "requires_image" | "requires_video" | "requires_audio"
            ) && current != policy);
        if should_replace {
            item.capability_binding.source_policy = policy.to_string();
        }
    }
}

fn build_document_selector_meta(capability_key: &str) -> ComponentSelectorMeta {
    let (specialization, requires_slots, optional_slots, supports_text_only) =
        match capability_key.trim() {
            "compare.document" => (
                "compare",
                vec!["left_document".to_string(), "right_document".to_string()],
                vec!["left_type".to_string(), "right_type".to_string()],
                false,
            ),
            "convert.document" => (
                "convert",
                vec!["document".to_string(), "target_format".to_string()],
                vec!["document_type".to_string()],
                false,
            ),
            "summarize.document" => (
                "summarize",
                vec!["document".to_string()],
                vec!["document_type".to_string()],
                true,
            ),
            "extract.document" => (
                "extract",
                vec!["document".to_string()],
                vec!["document_type".to_string()],
                false,
            ),
            "preview.document" => (
                "preview",
                vec!["document".to_string()],
                vec!["document_type".to_string()],
                false,
            ),
            "chunk.document" => (
                "chunk",
                vec!["document".to_string()],
                vec!["document_type".to_string(), "chunk_size".to_string()],
                true,
            ),
            _ => (
                "parse",
                vec!["document".to_string()],
                vec!["document_type".to_string()],
                false,
            ),
        };
    ComponentSelectorMeta {
        specialization: specialization.to_string(),
        intent_tags: vec!["document".to_string(), specialization.to_string()],
        subject_policy: "document".to_string(),
        supports_text_only,
        requires_slots,
        optional_slots,
        preferred_mime_types: vec![
            "application/pdf".to_string(),
            "application/msword".to_string(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".to_string(),
            "application/vnd.ms-excel".to_string(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string(),
            "text/csv".to_string(),
            "application/vnd.ms-powerpoint".to_string(),
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".to_string(),
            "text/plain".to_string(),
            "text/markdown".to_string(),
            "application/json".to_string(),
        ],
    }
}

fn default_selector_meta_for_component(item: &ComponentDefinition) -> ComponentSelectorMeta {
    let capability_key = item.capability_binding.capability_key.trim();
    if is_document_capability_key(capability_key) {
        return build_document_selector_meta(capability_key);
    }
    if let Some(inferred_document_key) = infer_document_component_capability_key(item) {
        return build_document_selector_meta(inferred_document_key);
    }
    match item.return_type {
        ComponentReturnType::Image => ComponentSelectorMeta {
            specialization: "general".to_string(),
            intent_tags: Vec::new(),
            subject_policy: "generic".to_string(),
            supports_text_only: true,
            requires_slots: vec!["prompt".to_string()],
            optional_slots: Vec::new(),
            preferred_mime_types: vec!["image/*".to_string()],
        },
        ComponentReturnType::Video => ComponentSelectorMeta {
            specialization: "general".to_string(),
            intent_tags: Vec::new(),
            subject_policy: "generic".to_string(),
            supports_text_only: true,
            requires_slots: vec!["prompt".to_string()],
            optional_slots: vec!["image".to_string()],
            preferred_mime_types: vec!["video/*".to_string()],
        },
        ComponentReturnType::Audio => ComponentSelectorMeta {
            specialization: "general".to_string(),
            intent_tags: Vec::new(),
            subject_policy: "generic".to_string(),
            supports_text_only: true,
            requires_slots: vec!["text".to_string()],
            optional_slots: vec!["voice".to_string()],
            preferred_mime_types: vec!["audio/*".to_string()],
        },
        ComponentReturnType::Text => ComponentSelectorMeta {
            specialization: "general".to_string(),
            intent_tags: Vec::new(),
            subject_policy: "generic".to_string(),
            supports_text_only: true,
            requires_slots: Vec::new(),
            optional_slots: Vec::new(),
            preferred_mime_types: vec!["text/plain".to_string()],
        },
    }
}

fn infer_document_type_from_hint(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if normalized.contains("application/pdf") || normalized.ends_with(".pdf") || normalized == "pdf"
    {
        return Some("pdf");
    }
    if normalized.contains("wordprocessingml")
        || normalized.ends_with(".docx")
        || normalized == "docx"
    {
        return Some("docx");
    }
    if normalized.contains("msword") || normalized.ends_with(".doc") || normalized == "doc" {
        return Some("doc");
    }
    if normalized.contains("spreadsheetml") || normalized.ends_with(".xlsx") || normalized == "xlsx"
    {
        return Some("xlsx");
    }
    if normalized.contains("ms-excel") || normalized.ends_with(".xls") || normalized == "xls" {
        return Some("xls");
    }
    if normalized.contains("text/csv") || normalized.ends_with(".csv") || normalized == "csv" {
        return Some("csv");
    }
    if normalized.contains("presentationml")
        || normalized.ends_with(".pptx")
        || normalized == "pptx"
    {
        return Some("pptx");
    }
    if normalized.contains("powerpoint") || normalized.ends_with(".ppt") || normalized == "ppt" {
        return Some("ppt");
    }
    if normalized.contains("markdown") || normalized.ends_with(".md") || normalized == "md" {
        return Some("md");
    }
    if normalized.contains("application/json")
        || normalized.ends_with(".json")
        || normalized == "json"
    {
        return Some("json");
    }
    if normalized.contains("text/plain") || normalized.ends_with(".txt") || normalized == "txt" {
        return Some("txt");
    }
    None
}

fn infer_asset_ref_kind(uri: &str) -> &'static str {
    let normalized = uri.trim().to_ascii_lowercase();
    if normalized.starts_with("data:") {
        return "data_url";
    }
    if normalized.starts_with("/api/uploads/") {
        return "upload_url";
    }
    if normalized.starts_with("/api/management/") {
        return "management_media_url";
    }
    if normalized.starts_with("http://") || normalized.starts_with("https://") {
        return "remote_url";
    }
    if normalized.starts_with("file://")
        || normalized.starts_with('/')
        || normalized
            .as_bytes()
            .get(1)
            .map(|byte| *byte == b':')
            .unwrap_or(false)
    {
        return "absolute_file";
    }
    "workspace_file"
}

fn infer_file_name_from_uri(uri: &str) -> Option<String> {
    let trimmed = uri.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_query = trimmed.split(['?', '#']).next().unwrap_or(trimmed);
    let candidate = without_query
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim();
    if candidate.is_empty() {
        None
    } else {
        Some(candidate.to_string())
    }
}

fn build_asset_ref(
    uri: &str,
    mime_type: &str,
    file_name: Option<&str>,
    extra_metadata: Option<Value>,
) -> Value {
    let mut asset = Map::new();
    asset.insert(
        "kind".to_string(),
        Value::String(infer_asset_ref_kind(uri).to_string()),
    );
    asset.insert("uri".to_string(), Value::String(uri.trim().to_string()));
    if !mime_type.trim().is_empty() {
        asset.insert(
            "mimeType".to_string(),
            Value::String(mime_type.trim().to_string()),
        );
    }
    let resolved_file_name = file_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| infer_file_name_from_uri(uri));
    if let Some(name) = resolved_file_name {
        asset.insert("fileName".to_string(), Value::String(name));
    }
    if let Some(Value::Object(metadata)) = extra_metadata {
        if !metadata.is_empty() {
            asset.insert("metadata".to_string(), Value::Object(metadata));
        }
    }
    Value::Object(asset)
}

fn build_component_provider_meta(item: &ComponentDefinition) -> Value {
    let provider_id = format!(
        "component_skill:{}",
        if item.english_name.trim().is_empty() {
            item.component_type.trim()
        } else {
            item.english_name.trim()
        }
    );
    let mut meta = Map::new();
    meta.insert("providerId".to_string(), Value::String(provider_id));
    meta.insert(
        "providerType".to_string(),
        Value::String("component_skill".to_string()),
    );
    let capability_key = if item.capability_binding.capability_key.trim().is_empty() {
        component_return_type_to_capability(&item.return_type)
            .map(str::to_string)
            .unwrap_or_default()
    } else {
        item.capability_binding.capability_key.trim().to_string()
    };
    let capability_scope = if item.capability_binding.capability_scope.trim().is_empty() {
        "generic".to_string()
    } else {
        item.capability_binding.capability_scope.trim().to_string()
    };
    if !capability_key.is_empty() {
        meta.insert("capability".to_string(), Value::String(capability_key));
        meta.insert("scope".to_string(), Value::String(capability_scope));
    }
    meta.insert(
        "capabilityBinding".to_string(),
        serde_json::to_value(&item.capability_binding).unwrap_or(Value::Null),
    );
    meta.insert(
        "selectorMeta".to_string(),
        serde_json::to_value(&item.selector_meta).unwrap_or(Value::Null),
    );
    if !item.component_type.trim().is_empty() {
        meta.insert(
            "componentType".to_string(),
            Value::String(item.component_type.trim().to_string()),
        );
    }
    if !item.english_name.trim().is_empty() {
        meta.insert(
            "componentEnglishName".to_string(),
            Value::String(item.english_name.trim().to_string()),
        );
    }
    if !item.name.trim().is_empty() {
        meta.insert(
            "componentName".to_string(),
            Value::String(item.name.trim().to_string()),
        );
    }
    meta.insert(
        "componentProvider".to_string(),
        Value::String(
            match item.provider_type {
                ComponentProviderType::Comfyui => "comfyui",
                ComponentProviderType::Runninghub => "runninghub",
            }
            .to_string(),
        ),
    );
    Value::Object(meta)
}

fn component_capability_provider_id(item: &ComponentDefinition) -> String {
    format!(
        "component_skill:{}",
        if item.english_name.trim().is_empty() {
            item.component_type.trim()
        } else {
            item.english_name.trim()
        }
    )
}

fn build_component_input_contract(item: &ComponentDefinition) -> Value {
    let properties = item
        .workflow
        .parameter_mappings
        .iter()
        .map(|mapping| {
            let value_type = match mapping.value_type {
                ComponentParamValueType::String => "string",
                ComponentParamValueType::Number => "number",
                ComponentParamValueType::Boolean => "boolean",
                ComponentParamValueType::Json => "object",
            };
            (
                mapping.parameter_name.clone(),
                json!({
                    "type": value_type,
                    "required": mapping.required,
                    "label": mapping.label,
                    "description": mapping.description,
                    "default": mapping.default_value,
                }),
            )
        })
        .collect::<Map<String, Value>>();
    json!({
        "type": "object",
        "baseTool": item.capability_binding.base_tool,
        "properties": properties,
    })
}

fn build_component_output_contract(item: &ComponentDefinition) -> Value {
    json!({
        "returnType": item.return_type,
        "componentType": item.component_type,
        "presentableResultKind": match item.return_type {
            ComponentReturnType::Image | ComponentReturnType::Video | ComponentReturnType::Audio => "media_result",
            ComponentReturnType::Text => "text_result",
        },
        "capabilityBinding": item.capability_binding,
        "selectorMeta": item.selector_meta,
    })
}

fn sync_component_capability_provider(item: &ComponentDefinition) -> Result<(), String> {
    if item.capability_binding.capability_key.trim().is_empty() {
        return Ok(());
    }
    let provider_id = component_capability_provider_id(item);
    let provider = assignment_store::upsert_capability_provider(CapabilityProviderRecord {
        provider_id: provider_id.clone(),
        provider_type: "component_skill".to_string(),
        display_name: Some(item.name.trim().to_string()),
        capabilities: vec![CapabilityDescriptorRecord {
            key: item.capability_binding.capability_key.trim().to_string(),
            scope: item.capability_binding.capability_scope.trim().to_string(),
        }],
        supported_scopes: vec![item.capability_binding.capability_scope.trim().to_string()],
        priority: item.capability_binding.priority,
        requirements: json!({
            "baseTool": item.capability_binding.base_tool,
            "toolMode": item.capability_binding.tool_mode,
            "sourcePolicy": item.capability_binding.source_policy,
            "fallbackPolicy": item.capability_binding.fallback_policy,
        }),
        supports_job: false,
        enabled: item.capability_binding.enabled,
        health_state: if item.capability_binding.enabled {
            "ready".to_string()
        } else {
            "disabled".to_string()
        },
        input_contract: build_component_input_contract(item),
        output_contract: build_component_output_contract(item),
        metadata: json!({
            "componentName": item.name,
            "componentEnglishName": item.english_name,
            "componentType": item.component_type,
            "providerType": match item.provider_type {
                ComponentProviderType::Comfyui => "comfyui",
                ComponentProviderType::Runninghub => "runninghub",
            },
            "capabilityBinding": item.capability_binding,
            "selectorMeta": item.selector_meta,
        }),
        is_removed: false,
        updated_at: String::new(),
    })?;
    assignment_store::upsert_capability_provider_binding(CapabilityProviderBindingRecord {
        capability_key: item.capability_binding.capability_key.trim().to_string(),
        capability_scope: item.capability_binding.capability_scope.trim().to_string(),
        provider_id: provider.provider_id.clone(),
        enabled: item.capability_binding.enabled,
        updated_at: String::new(),
    })?;
    let _ = assignment_store::upsert_provider_health_state(ProviderHealthStateRecord {
        provider_id: provider.provider_id.clone(),
        health_state: provider.health_state.clone(),
        message: if provider.enabled {
            Some("组件能力 provider 已同步".to_string())
        } else {
            Some("组件能力 provider 已禁用".to_string())
        },
        checked_at: current_unix_timestamp_string(),
        updated_at: String::new(),
    });
    let _ = assignment_store::append_capability_audit_log(
        "sync_component_provider",
        Some(&provider.provider_id),
        None,
        Some(&item.capability_binding.capability_key),
        Some(&item.capability_binding.capability_scope),
        &json!({
            "baseTool": item.capability_binding.base_tool,
            "enabled": item.capability_binding.enabled,
            "selectorMeta": item.selector_meta,
        }),
    );
    Ok(())
}

fn remove_component_capability_provider(item: &ComponentDefinition) -> Result<(), String> {
    if item.capability_binding.capability_key.trim().is_empty() {
        return Ok(());
    }
    let provider_id = component_capability_provider_id(item);
    let _ = assignment_store::delete_capability_provider_binding(
        &item.capability_binding.capability_key,
        &item.capability_binding.capability_scope,
        &provider_id,
    );
    let _ = assignment_store::upsert_provider_health_state(ProviderHealthStateRecord {
        provider_id: provider_id.clone(),
        health_state: "unavailable".to_string(),
        message: Some("组件能力 provider 已删除".to_string()),
        checked_at: current_unix_timestamp_string(),
        updated_at: String::new(),
    });
    if let Some(existing) = assignment_store::get_capability_provider(&provider_id)? {
        let _ = assignment_store::upsert_capability_provider(CapabilityProviderRecord {
            enabled: false,
            health_state: "unavailable".to_string(),
            is_removed: true,
            updated_at: String::new(),
            ..existing
        });
    }
    let _ = assignment_store::append_capability_audit_log(
        "remove_component_provider",
        Some(&provider_id),
        None,
        Some(&item.capability_binding.capability_key),
        Some(&item.capability_binding.capability_scope),
        &json!({
            "componentEnglishName": item.english_name,
        }),
    );
    Ok(())
}

fn build_component_presentable_result(
    item: &ComponentDefinition,
    text: &str,
    raw: &Value,
    items: &[ComponentInvokeItem],
    provider_meta: &Value,
) -> Option<Value> {
    let title = if item.name.trim().is_empty() {
        if item.component_type.trim().is_empty() {
            "组件结果".to_string()
        } else {
            item.component_type.trim().to_string()
        }
    } else {
        item.name.trim().to_string()
    };
    let summary = text.trim();
    let capability_key = item.capability_binding.capability_key.trim();
    if is_document_capability_key(capability_key) {
        let document_type = match capability_key {
            "compare.document" => "compare".to_string(),
            "convert.document" => "convert".to_string(),
            _ => {
                let explicit_hint = pick_component_text(
                    raw,
                    &[
                        "document_type",
                        "documentType",
                        "file_type",
                        "fileType",
                        "mime_type",
                        "mimeType",
                        "file_name",
                        "fileName",
                        "url",
                        "path",
                        "downloadUrl",
                        "download_url",
                        "previewUrl",
                        "preview_url",
                    ],
                );
                explicit_hint
                    .as_deref()
                    .and_then(infer_document_type_from_hint)
                    .or_else(|| {
                        items.iter().find_map(|entry| {
                            infer_document_type_from_hint(&entry.mime_type)
                                .or_else(|| infer_document_type_from_hint(&entry.url))
                        })
                    })
                    .unwrap_or("unknown")
                    .to_string()
            }
        };
        let title = if item.name.trim().is_empty() {
            if item.component_type.trim().is_empty() {
                "文档处理结果".to_string()
            } else {
                item.component_type.trim().to_string()
            }
        } else {
            item.name.trim().to_string()
        };
        let source_uri =
            pick_component_text(raw, &["sourceUrl", "source_url", "url", "path", "file"]).or_else(
                || {
                    items.iter().find_map(|entry| {
                        if entry.url.trim().is_empty() {
                            None
                        } else {
                            Some(entry.url.clone())
                        }
                    })
                },
            );
        let preview_uri = pick_component_text(
            raw,
            &[
                "previewUrl",
                "preview_url",
                "previewPath",
                "preview_path",
                "renderUrl",
                "render_url",
            ],
        )
        .or_else(|| source_uri.clone());
        let download_uri = pick_component_text(
            raw,
            &[
                "downloadUrl",
                "download_url",
                "outputFile",
                "output_file",
                "resultUrl",
                "result_url",
            ],
        )
        .or_else(|| source_uri.clone());
        let compare_diff = raw
            .get("compareDiff")
            .cloned()
            .or_else(|| raw.get("compare_diff").cloned());
        let conversion_outputs = if capability_key == "convert.document" {
            let mut outputs = raw
                .get("conversionOutputs")
                .and_then(Value::as_array)
                .cloned()
                .or_else(|| {
                    raw.get("conversion_outputs")
                        .and_then(Value::as_array)
                        .cloned()
                })
                .unwrap_or_default();
            if outputs.is_empty() {
                outputs = items
                    .iter()
                    .filter(|entry| !entry.url.trim().is_empty())
                    .map(|entry| {
                        json!({
                            "format": infer_document_type_from_hint(&entry.url).unwrap_or("output"),
                            "asset": build_asset_ref(&entry.url, &entry.mime_type, None, Some(json!({ "source": "component_center" }))),
                        })
                    })
                    .collect::<Vec<_>>();
            }
            outputs
        } else {
            Vec::new()
        };
        if source_uri.is_none()
            && preview_uri.is_none()
            && download_uri.is_none()
            && summary.is_empty()
            && !raw.get("text").is_some()
            && compare_diff.is_none()
            && conversion_outputs.is_empty()
        {
            return None;
        }
        let mut object = Map::new();
        object.insert(
            "kind".to_string(),
            Value::String("document_result".to_string()),
        );
        object.insert("title".to_string(), Value::String(title));
        object.insert(
            "documentType".to_string(),
            Value::String(document_type.clone()),
        );
        if let Some(source_uri) = source_uri {
            object.insert(
                "sourceAsset".to_string(),
                build_asset_ref(
                    &source_uri,
                    "",
                    None,
                    Some(json!({ "source": "component_center" })),
                ),
            );
        }
        if let Some(preview_uri) = preview_uri {
            object.insert(
                "previewAsset".to_string(),
                build_asset_ref(
                    &preview_uri,
                    "",
                    None,
                    Some(json!({ "source": "component_center" })),
                ),
            );
        }
        if let Some(download_uri) = download_uri {
            object.insert(
                "downloadAsset".to_string(),
                build_asset_ref(
                    &download_uri,
                    "",
                    None,
                    Some(json!({ "source": "component_center" })),
                ),
            );
        }
        if let Some(page_count) = pick_component_number(raw, &["pageCount", "page_count"]) {
            object.insert(
                "pageCount".to_string(),
                Value::Number(serde_json::Number::from(page_count.round() as i64)),
            );
        }
        if !summary.is_empty() {
            object.insert(
                "summaryText".to_string(),
                Value::String(summary.to_string()),
            );
        }
        if let Some(extracted_text) =
            pick_component_text(raw, &["extractedText", "extracted_text", "text", "content"])
        {
            object.insert("extractedText".to_string(), Value::String(extracted_text));
        }
        if let Some(compare_diff) = compare_diff {
            object.insert("compareDiff".to_string(), compare_diff);
        }
        if !conversion_outputs.is_empty() {
            object.insert(
                "conversionOutputs".to_string(),
                Value::Array(conversion_outputs),
            );
        }
        object.insert("providerMeta".to_string(), provider_meta.clone());
        return Some(Value::Object(object));
    }

    let media_type = component_capability_key_to_media_kind(capability_key)
        .or_else(|| component_return_type_to_media_kind(&item.return_type));
    if let Some(media_type) = media_type {
        if items.is_empty() {
            if summary.is_empty() {
                return None;
            }
            return Some(json!({
                "kind": "text_result",
                "title": title,
                "text": summary,
                "providerMeta": provider_meta.clone(),
            }));
        }
        let poster_candidates = if media_type == "video" {
            let mut posters = raw
                .get("poster_urls")
                .and_then(Value::as_array)
                .map(|items| {
                    items.iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            posters.extend(items.iter().filter_map(|entry| {
                let mime = entry.mime_type.trim().to_ascii_lowercase();
                if entry.kind.eq_ignore_ascii_case("image") || mime.starts_with("image/") {
                    let trimmed = entry.url.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                } else {
                    None
                }
            }));
            posters
        } else {
            Vec::new()
        };
        let normalized_items = items
            .iter()
            .filter(|entry| {
                if media_type != "video" {
                    return true;
                }
                let mime = entry.mime_type.trim().to_ascii_lowercase();
                entry.kind.eq_ignore_ascii_case("video") || mime.starts_with("video/")
            })
            .enumerate()
            .map(|entry| {
                let (index, entry) = entry;
                json!({
                    "mediaType": media_type,
                    "asset": build_asset_ref(
                        &entry.url,
                        &entry.mime_type,
                        None,
                        Some(json!({
                            "source": "component_center",
                            "kind": entry.kind,
                        })),
                    ),
                    "posterAsset": if media_type == "video" {
                        poster_candidates
                            .get(index)
                            .or_else(|| poster_candidates.first())
                            .map(|url| build_asset_ref(
                                url,
                                "image/png",
                                None,
                                Some(json!({
                                    "source": "component_center",
                                    "kind": "image",
                                })),
                            ))
                            .unwrap_or(Value::Null)
                    } else {
                        Value::Null
                    },
                    "caption": if entry.text.trim().is_empty() {
                        Value::String(title.clone())
                    } else {
                        Value::String(entry.text.trim().to_string())
                    },
                })
            })
            .collect::<Vec<_>>();
        if normalized_items.is_empty() {
            return None;
        }
        return Some(json!({
            "kind": "media_result",
            "mediaType": media_type,
            "title": title,
            "summary": if summary.is_empty() { Value::Null } else { Value::String(summary.to_string()) },
            "items": normalized_items,
            "providerMeta": provider_meta.clone(),
        }));
    }

    if summary.is_empty() {
        return None;
    }
    Some(json!({
        "kind": "text_result",
        "title": title,
        "text": summary,
        "providerMeta": provider_meta.clone(),
    }))
}

fn pick_component_text(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
    })
}

fn pick_component_number(value: &Value, keys: &[&str]) -> Option<f64> {
    let object = value.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_f64))
}

fn build_component_async_job_presentable_result(
    item: &ComponentDefinition,
    raw: &Value,
    text: &str,
    provider_meta: &Value,
) -> Option<Value> {
    let raw_object = raw.as_object()?;
    let job_id = pick_component_text(raw, &["job_id", "jobId", "task_id", "taskId", "id"])?;
    let status = pick_component_text(
        raw,
        &["status", "state", "task_status", "taskStatus", "phase"],
    )
    .unwrap_or_else(|| "queued".to_string());
    let normalized_status = status.trim().to_ascii_lowercase();
    let has_async_marker = raw_object.contains_key("job_id")
        || raw_object.contains_key("jobId")
        || raw_object.contains_key("task_id")
        || raw_object.contains_key("taskId")
        || matches!(
            normalized_status.as_str(),
            "queued" | "pending" | "running" | "processing" | "progress" | "submitted" | "waiting"
        );
    if !has_async_marker {
        return None;
    }
    let title = if item.name.trim().is_empty() {
        if item.component_type.trim().is_empty() {
            "组件任务".to_string()
        } else {
            item.component_type.trim().to_string()
        }
    } else {
        item.name.trim().to_string()
    };
    let summary = if text.trim().is_empty() {
        pick_component_text(raw, &["message", "msg", "detail", "summary"])
            .unwrap_or_else(|| format!("{title} 已提交，等待异步执行完成"))
    } else {
        text.trim().to_string()
    };
    Some(json!({
        "kind": "job_result",
        "title": title,
        "summary": summary,
        "status": normalized_status,
        "progress_percent": pick_component_number(raw, &["progress_percent", "progressPercent", "progress", "percent"]),
        "stage": pick_component_text(raw, &["stage", "current_stage", "currentStage", "phase"]),
        "job_type": item.return_type,
        "job_id": job_id,
        "capability_key": item.capability_binding.capability_key,
        "capability_scope": item.capability_binding.capability_scope,
        "provider_id": component_capability_provider_id(item),
        "provider_type": "component_skill",
        "route": "component_skill",
        "providerMeta": provider_meta.clone(),
        "resultPayload": raw.clone(),
        "metadata": {
            "componentName": item.name,
            "componentEnglishName": item.english_name,
            "componentType": item.component_type,
            "providerRequestId": pick_component_text(raw, &["request_id", "requestId", "task_id", "taskId"]),
        }
    }))
}

fn map_upsert_error(message: String) -> ApiError {
    let lowered = message.to_ascii_lowercase();
    if lowered.contains("不存在") {
        return ApiError::new(StatusCode::NOT_FOUND, message);
    }
    if lowered.contains("无效")
        || lowered.contains("不能为空")
        || lowered.contains("必须")
        || lowered.contains("已存在")
    {
        return ApiError::new(StatusCode::BAD_REQUEST, message);
    }
    internal_error(message)
}

fn component_center_root() -> Result<PathBuf, String> {
    Ok(path_resolver::webot_home_dir()?.join("component-center"))
}

fn component_provider_config_path() -> Result<PathBuf, String> {
    Ok(component_center_root()?.join("provider-configs.json"))
}

fn read_component_provider_configs() -> Result<ComponentProviderConfigs, String> {
    let path = component_provider_config_path()?;
    if !path.exists() {
        return Ok(ComponentProviderConfigs::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|err| format!("读取组件服务配置失败({}): {err}", path.display()))?;
    let mut config = serde_json::from_str::<ComponentProviderConfigs>(&content)
        .map_err(|err| format!("解析组件服务配置失败({}): {err}", path.display()))?;
    normalize_provider_configs(&mut config);
    Ok(config)
}

fn write_component_provider_configs(
    mut config: ComponentProviderConfigs,
) -> Result<ComponentProviderConfigs, String> {
    normalize_provider_configs(&mut config);
    let path = component_provider_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("创建组件服务配置目录失败({}): {err}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(&config)
        .map_err(|err| format!("序列化组件服务配置失败: {err}"))?;
    fs::write(&path, content)
        .map_err(|err| format!("写入组件服务配置失败({}): {err}", path.display()))?;
    Ok(config)
}

fn normalize_provider_configs(config: &mut ComponentProviderConfigs) {
    config.comfyui.server_url =
        normalize_url_or_default(&config.comfyui.server_url, &default_comfyui_server_url());
    config.runninghub.server_url = normalize_url_or_default(
        &config.runninghub.server_url,
        &default_runninghub_server_url(),
    );
    config.comfyui.api_key = config.comfyui.api_key.trim().to_string();
    config.runninghub.api_key = config.runninghub.api_key.trim().to_string();
}

fn normalize_url_or_default(value: &str, fallback: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn load_all_component_definitions() -> Result<Vec<ComponentDefinition>, String> {
    let skills_root = path_resolver::skills_root()?;
    fs::create_dir_all(&skills_root)
        .map_err(|err| format!("创建技能目录失败({}): {err}", skills_root.display()))?;
    let mut items = Vec::new();
    let entries = fs::read_dir(&skills_root)
        .map_err(|err| format!("读取技能目录失败({}): {err}", skills_root.display()))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("读取技能目录项失败: {err}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if !is_component_skill_dir(&path)? {
            continue;
        }
        if let Some(item) = load_component_definition_from_dir(&path)? {
            items.push(item);
        }
    }
    items.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.english_name.cmp(&right.english_name))
    });
    Ok(items)
}

pub(crate) fn sync_component_capability_providers_from_disk() -> Result<(), String> {
    for item in load_all_component_definitions()? {
        sync_component_capability_provider(&item)?;
    }
    Ok(())
}

fn load_component_definition_by_name(
    english_name: &str,
) -> Result<Option<ComponentDefinition>, ApiError> {
    let validated = validate_english_name(english_name)
        .map_err(|err| ApiError::new(StatusCode::BAD_REQUEST, err))?;
    let dir = path_resolver::skills_root()
        .map_err(internal_error)?
        .join(validated);
    if !dir.is_dir() {
        return Ok(None);
    }
    load_component_definition_from_dir(&dir).map_err(internal_error)
}

fn load_component_definition_by_lookup_key(
    component_key: &str,
) -> Result<Option<ComponentDefinition>, ApiError> {
    let trimmed = component_key.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "组件标识不能为空"));
    }

    if let Ok(validated) = validate_english_name(trimmed) {
        if let Some(item) = load_component_definition_by_name(&validated)? {
            return Ok(Some(item));
        }
    }

    let lowered = trimmed.to_ascii_lowercase();
    let items = load_all_component_definitions().map_err(internal_error)?;
    Ok(items.into_iter().find(|item| {
        item.english_name.eq_ignore_ascii_case(trimmed)
            || item.component_type.eq_ignore_ascii_case(trimmed)
            || item.name.to_ascii_lowercase() == lowered
    }))
}

pub(crate) fn is_component_skill_dir(dir: &Path) -> Result<bool, String> {
    if dir.join(COMPONENT_DEFINITION_FILE).is_file() {
        return Ok(true);
    }
    if !dir.join(COMPONENT_MANIFEST_FILE).is_file() {
        return Ok(false);
    }
    let Some(tags) = read_skill_tags(dir)? else {
        return Ok(false);
    };
    Ok(tags
        .iter()
        .any(|tag| tag.eq_ignore_ascii_case("component-center")))
}

fn read_skill_tags(dir: &Path) -> Result<Option<Vec<String>>, String> {
    let path = dir.join(COMPONENT_SKILL_TOML_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|err| format!("读取 skill.toml 失败({}): {err}", path.display()))?;
    let parsed = toml::from_str::<toml::Value>(&content)
        .map_err(|err| format!("解析 skill.toml 失败({}): {err}", path.display()))?;
    let tags = parsed
        .get("skill")
        .and_then(|value| value.get("tags"))
        .and_then(toml::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(toml::Value::as_str)
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        });
    Ok(tags)
}

fn load_component_definition_from_dir_internal(
    dir: &Path,
) -> Result<Option<ComponentDefinition>, String> {
    let definition_path = dir.join(COMPONENT_DEFINITION_FILE);
    if definition_path.is_file() {
        let content = fs::read_to_string(&definition_path)
            .map_err(|err| format!("读取组件定义失败({}): {err}", definition_path.display()))?;
        let mut item = serde_json::from_str::<ComponentDefinition>(&content)
            .map_err(|err| format!("解析组件定义失败({}): {err}", definition_path.display()))?;
        normalize_component_definition(&mut item)?;
        fill_component_timestamps(&mut item, dir);
        return Ok(Some(item));
    }
    load_legacy_component_definition(dir)
}

pub fn refresh_component_skill_artifacts_for_dir(dir: &Path) -> Result<(), String> {
    if let Some(item) = load_component_definition_from_dir_internal(dir)? {
        persist_component_definition(&item, dir, None)?;
    }
    Ok(())
}

fn load_component_definition_from_dir(dir: &Path) -> Result<Option<ComponentDefinition>, String> {
    let item = load_component_definition_from_dir_internal(dir)?;
    if let Some(ref component) = item {
        persist_component_definition(component, dir, None)?;
    }
    Ok(item)
}

fn load_legacy_component_definition(dir: &Path) -> Result<Option<ComponentDefinition>, String> {
    let manifest_path = dir.join(COMPONENT_MANIFEST_FILE);
    if !manifest_path.is_file() {
        return Ok(None);
    }
    let manifest_text = fs::read_to_string(&manifest_path)
        .map_err(|err| format!("读取旧组件清单失败({}): {err}", manifest_path.display()))?;
    let manifest = serde_json::from_str::<LegacyManifestFile>(&manifest_text)
        .map_err(|err| format!("解析旧组件清单失败({}): {err}", manifest_path.display()))?;
    let first = manifest
        .components
        .first()
        .ok_or_else(|| format!("旧组件清单缺少 components[0]({})", manifest_path.display()))?;
    let prompt_context = read_optional_text(&dir.join(COMPONENT_PROMPT_CONTEXT_FILE))?
        .or_else(|| {
            read_optional_text(&dir.join(COMPONENT_SKILL_FILE))
                .ok()
                .flatten()
        })
        .unwrap_or_default();
    let skill_toml = read_optional_text(&dir.join(COMPONENT_SKILL_TOML_FILE))?.unwrap_or_default();
    let provider_type = parse_provider_type_from_legacy(&skill_toml, &prompt_context);
    let return_type = parse_return_type_from_legacy(&prompt_context);
    let component_type = if !first.r#type.trim().is_empty() {
        first.r#type.trim().to_string()
    } else if !first.name.trim().is_empty() {
        first.name.trim().to_string()
    } else {
        derive_component_type(
            dir.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default(),
        )
    };
    let english_name = dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let name =
        parse_heading_from_markdown(&prompt_context).unwrap_or_else(|| component_type.clone());
    let description = parse_description_from_legacy(&skill_toml, &prompt_context)
        .unwrap_or_else(|| first.description.trim().to_string());
    let parameter_mappings = parse_parameter_mappings_from_markdown(&prompt_context);
    let raw_payload = json!({
        "legacy": true,
        "componentType": component_type,
        "englishName": english_name,
    });
    let fields = parameter_mappings
        .iter()
        .map(|mapping| WorkflowNodeField {
            field_name: mapping.field_name.clone(),
            label: mapping.label.clone(),
            value_type: mapping.value_type.clone(),
            description: mapping.description.clone(),
            default_value: mapping.default_value.clone(),
            options: mapping.options.clone(),
        })
        .collect::<Vec<_>>();
    let mut item = ComponentDefinition {
        provider_type,
        name,
        english_name,
        component_type,
        description,
        return_type,
        capability_binding: ComponentCapabilityBinding::default(),
        selector_meta: ComponentSelectorMeta::default(),
        workflow: ComponentWorkflowConfig {
            request_url: String::new(),
            app_id: String::new(),
            raw_payload,
            nodes: vec![WorkflowNode {
                node_id: "legacy".to_string(),
                title: "Legacy Imported Workflow".to_string(),
                node_type: "legacy".to_string(),
                fields,
                raw: Value::Null,
            }],
            parameter_mappings,
            runninghub_instance_type: default_runninghub_instance_type(),
            runninghub_use_personal_queue: false,
        },
        created_at: String::new(),
        updated_at: String::new(),
    };
    normalize_component_definition(&mut item)?;
    fill_component_timestamps(&mut item, dir);
    Ok(Some(item))
}

fn read_optional_text(path: &Path) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)
        .map_err(|err| format!("读取文件失败({}): {err}", path.display()))?;
    Ok(Some(text))
}

fn parse_provider_type_from_legacy(skill_toml: &str, markdown: &str) -> ComponentProviderType {
    if skill_toml.to_ascii_lowercase().contains("runninghub")
        || markdown.to_ascii_lowercase().contains("runninghub")
    {
        return ComponentProviderType::Runninghub;
    }
    ComponentProviderType::Comfyui
}

fn parse_return_type_from_legacy(markdown: &str) -> ComponentReturnType {
    for line in markdown.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("- ") || !trimmed.contains("返回类型") {
            continue;
        }
        let lowered = trimmed.to_ascii_lowercase();
        if lowered.contains("video") {
            return ComponentReturnType::Video;
        }
        if lowered.contains("audio") {
            return ComponentReturnType::Audio;
        }
        if lowered.contains("text") {
            return ComponentReturnType::Text;
        }
        if lowered.contains("image") {
            return ComponentReturnType::Image;
        }
    }
    ComponentReturnType::Image
}

fn parse_description_from_legacy(skill_toml: &str, markdown: &str) -> Option<String> {
    for line in skill_toml.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("description = ") {
            let value = rest.trim().trim_matches('"').trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    for line in markdown.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("- 描述：") {
            if !rest.trim().is_empty() {
                return Some(rest.trim().to_string());
            }
        }
        if let Some(rest) = trimmed.strip_prefix("- 组件描述：") {
            if !rest.trim().is_empty() {
                return Some(rest.trim().to_string());
            }
        }
    }
    None
}

fn parse_heading_from_markdown(markdown: &str) -> Option<String> {
    markdown
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_parameter_mappings_from_markdown(markdown: &str) -> Vec<ComponentParameterMapping> {
    let mut in_section = false;
    let mut items = Vec::new();
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            in_section = trimmed == "## 参数映射";
            continue;
        }
        if !in_section || !trimmed.starts_with("- `") {
            continue;
        }
        if let Some(mapping) = parse_parameter_mapping_line(trimmed) {
            items.push(mapping);
        }
    }
    items
}

fn parse_parameter_mapping_line(line: &str) -> Option<ComponentParameterMapping> {
    let remainder = line.strip_prefix("- `")?;
    let param_end = remainder.find('`')?;
    let parameter_name = remainder[..param_end].trim();
    if parameter_name.is_empty() {
        return None;
    }
    let after_param = remainder.get(param_end + 1..)?.trim();
    let field_name = extract_wrapped_segment(after_param, '（', '）')
        .or_else(|| extract_wrapped_segment(after_param, '(', ')'))
        .unwrap_or_else(|| parameter_name.to_string());
    let tail = after_param
        .split_once('：')
        .or_else(|| after_param.split_once(':'))
        .map(|(_, rest)| rest.trim())
        .unwrap_or_default();
    let value_type_label = split_once_any(tail, &['，', ',', '；', ';'])
        .map(|(head, _)| head.trim())
        .unwrap_or(tail)
        .to_ascii_lowercase();
    let value_type = match value_type_label.as_str() {
        "number" => ComponentParamValueType::Number,
        "boolean" => ComponentParamValueType::Boolean,
        "json" => ComponentParamValueType::Json,
        _ => ComponentParamValueType::String,
    };
    let required = tail.contains("必填");
    let default_value = extract_after_marker(tail, "默认值：")
        .or_else(|| extract_after_marker(tail, "默认值:"))
        .map(|text| parse_default_value(&text, &value_type))
        .unwrap_or(Value::Null);
    let description = extract_after_marker(tail, "说明：")
        .or_else(|| extract_after_marker(tail, "说明:"))
        .unwrap_or_default();
    Some(ComponentParameterMapping {
        id: format!("legacy__{}", parameter_name),
        node_id: "legacy".to_string(),
        field_name: field_name.clone(),
        parameter_name: parameter_name.to_string(),
        label: field_name,
        value_type,
        description,
        default_value,
        required,
        options: Vec::new(),
    })
}

fn split_once_any<'a>(input: &'a str, chars: &[char]) -> Option<(&'a str, &'a str)> {
    for (idx, ch) in input.char_indices() {
        if chars.contains(&ch) {
            let next = idx + ch.len_utf8();
            return Some((&input[..idx], &input[next..]));
        }
    }
    None
}

fn extract_wrapped_segment(input: &str, start: char, end: char) -> Option<String> {
    let start_idx = input.find(start)?;
    let rest = input.get(start_idx + start.len_utf8()..)?;
    let end_idx = rest.find(end)?;
    let value = rest[..end_idx].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn extract_after_marker(input: &str, marker: &str) -> Option<String> {
    let (_, rest) = input.split_once(marker)?;
    let head = split_once_any(rest, &['；', ';'])
        .map(|(value, _)| value.trim())
        .unwrap_or_else(|| rest.trim());
    if head.is_empty() {
        None
    } else {
        Some(head.to_string())
    }
}

fn parse_default_value(text: &str, value_type: &ComponentParamValueType) -> Value {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Value::Null;
    }
    match value_type {
        ComponentParamValueType::Number => trimmed
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(trimmed.to_string())),
        ComponentParamValueType::Boolean => {
            let lowered = trimmed.to_ascii_lowercase();
            Value::Bool(matches!(
                lowered.as_str(),
                "true" | "1" | "yes" | "on" | "已启用"
            ))
        }
        ComponentParamValueType::Json => {
            serde_json::from_str(trimmed).unwrap_or_else(|_| Value::String(trimmed.to_string()))
        }
        ComponentParamValueType::String => Value::String(trimmed.to_string()),
    }
}

fn fill_component_timestamps(item: &mut ComponentDefinition, dir: &Path) {
    let metadata_paths = [
        dir.join(COMPONENT_DEFINITION_FILE),
        dir.join(COMPONENT_MANIFEST_FILE),
        dir.join(COMPONENT_SKILL_TOML_FILE),
        dir.join(COMPONENT_PROMPT_CONTEXT_FILE),
        dir.join(COMPONENT_SKILL_FILE),
    ];
    let mut best = None;
    for path in metadata_paths {
        if !path.exists() {
            continue;
        }
        let modified = fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(system_time_to_unix_string);
        if let Some(value) = modified {
            best = Some(value);
            break;
        }
    }
    if item.created_at.trim().is_empty() {
        item.created_at = best.clone().unwrap_or_else(current_unix_timestamp_string);
    }
    if item.updated_at.trim().is_empty() {
        item.updated_at = best.unwrap_or_else(current_unix_timestamp_string);
    }
}

fn system_time_to_unix_string(value: SystemTime) -> Option<String> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs().to_string())
}

fn current_unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn upsert_component_definition(
    existing_english_name: Option<&str>,
    mut payload: ComponentDefinition,
) -> Result<ComponentDefinition, String> {
    normalize_component_definition(&mut payload)?;
    let previous_item = if let Some(name) = existing_english_name {
        load_component_definition_by_name(name).map_err(|err| err.message)?
    } else {
        None
    };
    if existing_english_name.is_some() && previous_item.is_none() {
        return Err("组件不存在".to_string());
    }
    let previous_english_name = previous_item.as_ref().map(|item| item.english_name.clone());
    let previous_component_type = previous_item
        .as_ref()
        .map(|item| item.component_type.clone());
    let skills_root = path_resolver::skills_root()?;
    fs::create_dir_all(&skills_root)
        .map_err(|err| format!("创建技能目录失败({}): {err}", skills_root.display()))?;

    let target_dir = skills_root.join(&payload.english_name);
    if previous_english_name.as_deref() != Some(payload.english_name.as_str())
        && target_dir.exists()
    {
        return Err(format!("组件目录已存在: {}", payload.english_name));
    }

    let mut created_at = previous_item
        .as_ref()
        .map(|item| item.created_at.clone())
        .unwrap_or_default();
    if created_at.trim().is_empty() {
        created_at = current_unix_timestamp_string();
    }
    payload.created_at = created_at;
    payload.updated_at = current_unix_timestamp_string();

    if let Some(previous_name) = previous_english_name {
        let previous_dir = skills_root.join(previous_name);
        if previous_dir != target_dir && previous_dir.exists() {
            fs::rename(&previous_dir, &target_dir).map_err(|err| {
                format!(
                    "重命名组件目录失败({} -> {}): {err}",
                    previous_dir.display(),
                    target_dir.display()
                )
            })?;
        }
    }

    persist_component_definition(&payload, &target_dir, previous_component_type.as_deref())?;
    if let Some(previous) = previous_item.as_ref() {
        remove_component_capability_provider(previous)?;
    }
    sync_component_capability_provider(&payload)?;
    Ok(payload)
}

fn delete_component_definition_impl(english_name: &str) -> Result<(), String> {
    let validated = validate_english_name(english_name)?;
    let dir = path_resolver::skills_root()?.join(validated);
    if !dir.exists() {
        return Err("组件不存在".to_string());
    }
    if !is_component_skill_dir(&dir)? {
        return Err("目标目录不是组件中心生成的组件".to_string());
    }
    if let Some(item) = load_component_definition_from_dir_internal(&dir)? {
        remove_component_capability_provider(&item)?;
    }
    fs::remove_dir_all(&dir).map_err(|err| format!("删除组件目录失败({}): {err}", dir.display()))
}

fn normalize_component_definition(item: &mut ComponentDefinition) -> Result<(), String> {
    item.name = item.name.trim().to_string();
    item.english_name = validate_english_name(&item.english_name)?;
    if item.name.is_empty() {
        return Err("组件名称不能为空".to_string());
    }
    if item.component_type.trim().is_empty() {
        item.component_type = derive_component_type(&item.english_name);
    } else {
        item.component_type = validate_component_type(&item.component_type)?;
    }
    item.description = item.description.trim().to_string();
    item.workflow.request_url = item.workflow.request_url.trim().to_string();
    item.workflow.app_id = item.workflow.app_id.trim().to_string();
    if item.workflow.runninghub_instance_type.trim().is_empty() {
        item.workflow.runninghub_instance_type = default_runninghub_instance_type();
    } else {
        item.workflow.runninghub_instance_type =
            item.workflow.runninghub_instance_type.trim().to_string();
    }
    for node in &mut item.workflow.nodes {
        node.node_id = node.node_id.trim().to_string();
        node.title = node.title.trim().to_string();
        node.node_type = node.node_type.trim().to_string();
        for field in &mut node.fields {
            field.field_name = field.field_name.trim().to_string();
            if field.label.trim().is_empty() {
                field.label = field.field_name.clone();
            } else {
                field.label = field.label.trim().to_string();
            }
            field.description = field.description.trim().to_string();
        }
    }
    for mapping in &mut item.workflow.parameter_mappings {
        mapping.parameter_name = validate_parameter_name(&mapping.parameter_name)?;
        mapping.field_name = mapping.field_name.trim().to_string();
        if mapping.field_name.is_empty() {
            mapping.field_name = mapping.parameter_name.clone();
        }
        mapping.node_id = mapping.node_id.trim().to_string();
        if mapping.node_id.is_empty() {
            mapping.node_id = "legacy".to_string();
        }
        mapping.label = if mapping.label.trim().is_empty() {
            mapping.field_name.clone()
        } else {
            mapping.label.trim().to_string()
        };
        mapping.description = mapping.description.trim().to_string();
        if mapping.id.trim().is_empty() {
            mapping.id = format!("{}__{}", mapping.node_id, mapping.field_name);
        } else {
            mapping.id = mapping.id.trim().to_string();
        }
    }
    if let Some(default_binding) = default_component_capability_binding(&item) {
        if item.capability_binding.capability_key.trim().is_empty() {
            item.capability_binding.capability_key = default_binding.capability_key;
        } else {
            item.capability_binding.capability_key =
                item.capability_binding.capability_key.trim().to_string();
        }
        if item.capability_binding.capability_scope.trim().is_empty() {
            item.capability_binding.capability_scope = default_binding.capability_scope;
        } else {
            item.capability_binding.capability_scope =
                item.capability_binding.capability_scope.trim().to_string();
        }
        if item.capability_binding.base_tool.trim().is_empty() {
            item.capability_binding.base_tool = default_binding.base_tool;
        } else {
            item.capability_binding.base_tool =
                item.capability_binding.base_tool.trim().to_string();
        }
        if item.capability_binding.tool_mode.trim().is_empty() {
            item.capability_binding.tool_mode = default_binding.tool_mode;
        } else {
            item.capability_binding.tool_mode =
                item.capability_binding.tool_mode.trim().to_string();
        }
        if item.capability_binding.source_policy.trim().is_empty() {
            item.capability_binding.source_policy = default_binding.source_policy;
        } else {
            item.capability_binding.source_policy =
                item.capability_binding.source_policy.trim().to_string();
        }
        if item.capability_binding.fallback_policy.trim().is_empty() {
            item.capability_binding.fallback_policy = default_binding.fallback_policy;
        } else {
            item.capability_binding.fallback_policy =
                item.capability_binding.fallback_policy.trim().to_string();
        }
        if item.capability_binding.priority <= 0 {
            item.capability_binding.priority = default_binding.priority;
        }
        if !item.capability_binding.enabled {
            item.capability_binding.enabled = default_binding.enabled;
        }
    }
    let default_selector = default_selector_meta_for_component(&item);
    if item.selector_meta.specialization.trim().is_empty() {
        item.selector_meta.specialization = default_selector.specialization;
    } else {
        item.selector_meta.specialization = item.selector_meta.specialization.trim().to_string();
    }
    if item.selector_meta.subject_policy.trim().is_empty() {
        item.selector_meta.subject_policy = default_selector.subject_policy;
    } else {
        item.selector_meta.subject_policy = item.selector_meta.subject_policy.trim().to_string();
    }
    if item.selector_meta.requires_slots.is_empty() {
        item.selector_meta.requires_slots = default_selector.requires_slots;
    } else {
        item.selector_meta.requires_slots =
            normalize_string_vec(&item.selector_meta.requires_slots);
    }
    if item.selector_meta.optional_slots.is_empty() {
        item.selector_meta.optional_slots = default_selector.optional_slots;
    } else {
        item.selector_meta.optional_slots =
            normalize_string_vec(&item.selector_meta.optional_slots);
    }
    if item.selector_meta.preferred_mime_types.is_empty() {
        item.selector_meta.preferred_mime_types = default_selector.preferred_mime_types;
    } else {
        item.selector_meta.preferred_mime_types =
            normalize_string_vec(&item.selector_meta.preferred_mime_types);
    }
    item.selector_meta.intent_tags = normalize_string_vec(&item.selector_meta.intent_tags);
    apply_mapping_selector_inference(item);
    if item.workflow.parameter_mappings.is_empty() {
        return Err("组件参数映射不能为空".to_string());
    }
    Ok(())
}

fn normalize_string_vec(values: &[String]) -> Vec<String> {
    let mut output = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if output
            .iter()
            .any(|item: &String| item.eq_ignore_ascii_case(trimmed))
        {
            continue;
        }
        output.push(trimmed.to_string());
    }
    output
}

fn validate_english_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("组件英文名不能为空".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
    {
        return Err("组件英文名只能包含小写字母、数字、短横线和下划线".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_component_type(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("组件类型不能为空".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err("组件类型只能包含字母、数字、下划线和短横线".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_parameter_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("参数名不能为空".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err(format!("参数名不合法: {trimmed}"));
    }
    Ok(trimmed.to_string())
}

fn derive_component_type(english_name: &str) -> String {
    let mut output = String::new();
    for chunk in english_name.split(['-', '_']) {
        if chunk.is_empty() {
            continue;
        }
        let mut chars = chunk.chars();
        if let Some(first) = chars.next() {
            output.push(first.to_ascii_uppercase());
            output.push_str(chars.as_str());
        }
    }
    if output.is_empty() {
        "GeneratedComponent".to_string()
    } else {
        output
    }
}

fn persist_component_definition(
    item: &ComponentDefinition,
    dir: &Path,
    previous_component_type: Option<&str>,
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| format!("创建组件目录失败({}): {err}", dir.display()))?;

    let definition_path = dir.join(COMPONENT_DEFINITION_FILE);
    let manifest_path = dir.join(COMPONENT_MANIFEST_FILE);
    let skill_path = dir.join(COMPONENT_SKILL_FILE);
    let prompt_context_path = dir.join(COMPONENT_PROMPT_CONTEXT_FILE);
    let skill_toml_path = dir.join(COMPONENT_SKILL_TOML_FILE);
    let tool_adapter_path = dir.join(COMPONENT_TOOL_ADAPTER_FILE);
    let component_tsx_path = dir.join(format!("{}.tsx", item.component_type));

    let definition_content =
        serde_json::to_string_pretty(item).map_err(|err| format!("序列化组件定义失败: {err}"))?;
    let prompt_context = build_prompt_context_markdown(item);
    let skill_markdown = build_skill_markdown(item);
    let manifest_content = serde_json::to_string_pretty(&build_manifest_value(item))
        .map_err(|err| format!("序列化组件清单失败: {err}"))?;
    let skill_toml = build_skill_toml(item, &prompt_context);
    let tool_adapter = build_component_tool_adapter_script(item);
    let component_tsx = build_component_runtime_tsx(item);

    fs::write(&definition_path, definition_content)
        .map_err(|err| format!("写入组件定义失败({}): {err}", definition_path.display()))?;
    fs::write(&manifest_path, manifest_content)
        .map_err(|err| format!("写入组件清单失败({}): {err}", manifest_path.display()))?;
    fs::write(&skill_path, skill_markdown)
        .map_err(|err| format!("写入组件说明失败({}): {err}", skill_path.display()))?;
    fs::write(&prompt_context_path, prompt_context).map_err(|err| {
        format!(
            "写入 prompt_context 失败({}): {err}",
            prompt_context_path.display()
        )
    })?;
    fs::write(&skill_toml_path, skill_toml)
        .map_err(|err| format!("写入 skill.toml 失败({}): {err}", skill_toml_path.display()))?;
    fs::write(&tool_adapter_path, tool_adapter).map_err(|err| {
        format!(
            "写入组件工具适配器失败({}): {err}",
            tool_adapter_path.display()
        )
    })?;
    fs::write(&component_tsx_path, component_tsx).map_err(|err| {
        format!(
            "写入组件运行文件失败({}): {err}",
            component_tsx_path.display()
        )
    })?;

    if let Some(previous) = previous_component_type {
        if previous != item.component_type {
            let previous_path = dir.join(format!("{}.tsx", previous));
            if previous_path.is_file() {
                let _ = fs::remove_file(previous_path);
            }
        }
    }

    Ok(())
}

fn build_manifest_value(item: &ComponentDefinition) -> Value {
    let mut initial_values = Map::new();
    for mapping in &item.workflow.parameter_mappings {
        let mut parts = Vec::new();
        parts.push(match mapping.value_type {
            ComponentParamValueType::String => "string".to_string(),
            ComponentParamValueType::Number => "number".to_string(),
            ComponentParamValueType::Boolean => "boolean".to_string(),
            ComponentParamValueType::Json => "json".to_string(),
        });
        parts.push(if mapping.required {
            "必填".to_string()
        } else {
            "可选".to_string()
        });
        if should_expose_default_value(mapping) {
            parts.push(format!(
                "默认值：{}",
                stringify_value_preview(&mapping.default_value, 96)
            ));
        }
        if !mapping.description.trim().is_empty() {
            parts.push(format!(
                "说明：{}",
                summarize_inline_text(mapping.description.trim(), 120)
            ));
        }
        initial_values.insert(
            mapping.parameter_name.clone(),
            Value::String(parts.join("；")),
        );
    }
    let render_example = build_component_render_example(item);
    json!({
        "version": "1.0",
        "components": [
            {
                "name": item.component_type,
                "type": item.component_type,
                "description": item.description,
                "propsSchema": {
                    "title": "string，可选，自定义标题",
                    "description": "string，可选，自定义补充说明",
                    "submitLabel": "string，可选，提交按钮文案",
                    "autoRun": "boolean，可选，值齐备后自动调用",
                "initialValues": Value::Object(initial_values)
                },
                "example": render_example,
                "invokeExample": build_component_invoke_example(item),
                "capabilityBinding": serde_json::to_value(&item.capability_binding).unwrap_or(Value::Null),
                "selectorMeta": serde_json::to_value(&item.selector_meta).unwrap_or(Value::Null),
                "invokeGuide": {
                    "renderType": item.component_type,
                    "componentName": item.english_name,
                    "baseTool": item.capability_binding.base_tool,
                    "capabilityKey": item.capability_binding.capability_key,
                    "requiredParams": build_required_parameter_names(item),
                    "strictSourceParams": item.workflow.parameter_mappings.iter().filter(|mapping| is_strict_source_parameter(mapping)).map(|mapping| mapping.parameter_name.clone()).collect::<Vec<_>>(),
                    "descriptiveParams": item.workflow.parameter_mappings.iter().filter(|mapping| is_descriptive_parameter(mapping)).map(|mapping| mapping.parameter_name.clone()).collect::<Vec<_>>(),
                    "ignoreUnsupportedExtras": true,
                    "optionalMissingDoesNotBlock": true,
                    "directInvokeRule": "当必填参数已满足且用户要求直接执行时，必须直接输出 ComponentInvokeAction。"
                }
            }
        ]
    })
}

fn summarize_inline_text(value: &str, max_chars: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = compact.chars();
    let preview: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

fn stringify_value_preview(value: &Value, max_chars: usize) -> String {
    match value {
        Value::String(text) => summarize_inline_text(text, max_chars),
        _ => summarize_inline_text(&stringify_value_compact(value), max_chars),
    }
}

fn is_prompt_like_parameter_name(name: &str) -> bool {
    let lowered = name.trim().to_ascii_lowercase();
    lowered.contains("lyrics")
        || lowered.contains("lyric")
        || lowered.contains("tag")
        || lowered.contains("prompt")
        || lowered.contains("style")
        || lowered.contains("theme")
        || lowered.contains("mood")
        || lowered.contains("desc")
        || lowered.contains("description")
        || lowered.contains("text")
        || lowered.contains("message")
        || lowered.contains("content")
        || lowered.contains("story")
        || lowered.contains("script")
}

fn should_expose_default_value(mapping: &ComponentParameterMapping) -> bool {
    match &mapping.default_value {
        Value::Null => false,
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return false;
            }
            if is_prompt_like_parameter_name(&mapping.parameter_name) {
                return false;
            }
            !trimmed.contains('\n') && trimmed.chars().count() <= 48
        }
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
        _ => true,
    }
}

fn is_strict_source_parameter(mapping: &ComponentParameterMapping) -> bool {
    let lowered = mapping.parameter_name.trim().to_ascii_lowercase();
    lowered.contains("lyrics")
        || lowered.contains("lyric")
        || lowered == "image"
        || lowered == "image_url"
        || lowered == "imageurl"
        || lowered == "src"
        || lowered == "url"
        || lowered == "path"
}

fn is_descriptive_parameter(mapping: &ComponentParameterMapping) -> bool {
    let lowered = mapping.parameter_name.trim().to_ascii_lowercase();
    lowered.contains("tag")
        || lowered.contains("prompt")
        || lowered.contains("style")
        || lowered.contains("theme")
        || lowered.contains("mood")
        || lowered.contains("desc")
        || lowered.contains("description")
}

fn parameter_role_label(mapping: &ComponentParameterMapping) -> &'static str {
    if is_strict_source_parameter(mapping) {
        "核心内容/源数据"
    } else if is_descriptive_parameter(mapping) {
        "描述承接"
    } else if mapping
        .parameter_name
        .trim()
        .eq_ignore_ascii_case("language")
        || mapping.parameter_name.trim().eq_ignore_ascii_case("lang")
    {
        "语言控制"
    } else if mapping
        .parameter_name
        .trim()
        .to_ascii_lowercase()
        .contains("duration")
        || mapping
            .parameter_name
            .trim()
            .to_ascii_lowercase()
            .contains("second")
    {
        "时长控制"
    } else {
        "通用参数"
    }
}

fn parameter_role_guidance(mapping: &ComponentParameterMapping) -> &'static str {
    if is_strict_source_parameter(mapping) {
        "应直接传入真实内容本身，不要用主题简介、情绪概述或自动生成占位来代替。"
    } else if is_descriptive_parameter(mapping) {
        "适合承接风格、氛围、乐器、节奏、主题等额外要求；组件未声明的同类要求可合并到这里。"
    } else if mapping
        .parameter_name
        .trim()
        .eq_ignore_ascii_case("language")
        || mapping.parameter_name.trim().eq_ignore_ascii_case("lang")
    {
        "只建议传语言代码，例如 zh、en、ja。"
    } else if mapping
        .parameter_name
        .trim()
        .to_ascii_lowercase()
        .contains("duration")
        || mapping
            .parameter_name
            .trim()
            .to_ascii_lowercase()
            .contains("second")
    {
        "优先传数字秒数，不要传自然语言描述。"
    } else {
        "保持命名与实际用途一致，避免让 AI 猜错字段语义。"
    }
}

fn build_mapping_example_value(mapping: &ComponentParameterMapping) -> Value {
    let parameter_name = mapping.parameter_name.trim().to_lowercase();
    let label = if mapping.label.trim().is_empty() {
        mapping.parameter_name.trim()
    } else {
        mapping.label.trim()
    };
    match mapping.value_type {
        ComponentParamValueType::String => {
            if should_expose_default_value(mapping) {
                if let Some(default_text) = mapping.default_value.as_str() {
                    let preview = summarize_inline_text(default_text, 72);
                    if !preview.is_empty() {
                        return Value::String(preview);
                    }
                }
            }
            let placeholder = if parameter_name.contains("lyrics") {
                "请填写真正的歌词正文，支持分段换行".to_string()
            } else if parameter_name.contains("tag")
                || parameter_name.contains("prompt")
                || parameter_name.contains("desc")
                || parameter_name.contains("style")
                || parameter_name.contains("theme")
                || parameter_name.contains("mood")
            {
                "请填写风格、情绪、乐器、节奏、主题与演唱方式等描述".to_string()
            } else if parameter_name.contains("language") {
                "zh".to_string()
            } else {
                format!("请填写{label}")
            };
            Value::String(placeholder)
        }
        ComponentParamValueType::Number => {
            if mapping.default_value.is_number() {
                mapping.default_value.clone()
            } else if parameter_name.contains("duration") || parameter_name.contains("second") {
                json!(120)
            } else {
                json!(1)
            }
        }
        ComponentParamValueType::Boolean => {
            if mapping.default_value.is_boolean() {
                mapping.default_value.clone()
            } else {
                Value::Bool(true)
            }
        }
        ComponentParamValueType::Json => {
            if mapping.default_value.is_null() {
                json!({})
            } else {
                mapping.default_value.clone()
            }
        }
    }
}

fn build_component_example_values(item: &ComponentDefinition) -> Map<String, Value> {
    let mut output = Map::new();
    let mut picked: Vec<&ComponentParameterMapping> = item
        .workflow
        .parameter_mappings
        .iter()
        .filter(|mapping| mapping.required)
        .collect();
    if picked.is_empty() {
        picked.extend(item.workflow.parameter_mappings.iter().take(3));
    }
    for mapping in picked {
        output.insert(
            mapping.parameter_name.clone(),
            build_mapping_example_value(mapping),
        );
    }
    output
}

fn build_component_render_example(item: &ComponentDefinition) -> Value {
    json!({
        "type": item.component_type.clone(),
        "props": {
            "autoRun": false,
            "initialValues": Value::Object(build_component_example_values(item))
        }
    })
}

fn build_component_invoke_example(item: &ComponentDefinition) -> Value {
    json!({
        "type": "ComponentInvokeAction",
        "props": {
            "componentName": item.english_name.clone(),
            "params": Value::Object(build_component_example_values(item)),
            "renderResult": !matches!(item.return_type, ComponentReturnType::Text),
            "exposeToAgent": true
        }
    })
}

fn build_required_parameter_names(item: &ComponentDefinition) -> Vec<String> {
    item.workflow
        .parameter_mappings
        .iter()
        .filter(|mapping| mapping.required && !mapping.parameter_name.trim().is_empty())
        .map(|mapping| mapping.parameter_name.trim().to_string())
        .collect()
}

fn build_required_parameters_line(item: &ComponentDefinition) -> String {
    let required = build_required_parameter_names(item);
    if required.is_empty() {
        "当前组件没有必填参数，可按用户意图直接调用。".to_string()
    } else {
        format!(
            "当前组件可直接执行的最小必填参数集合：`{}`。只要这些参数已经能从当前用户请求中得到，就直接调用，不要因为缺少可选参数或用户额外提到别的字段而退回成纯解释。",
            required.join("`, `")
        )
    }
}

fn build_skill_markdown(item: &ComponentDefinition) -> String {
    let render_example = serde_json::to_string(&build_component_render_example(item))
        .unwrap_or_else(|_| "{}".to_string());
    let invoke_example = serde_json::to_string(&build_component_invoke_example(item))
        .unwrap_or_else(|_| "{}".to_string());
    let mut lines = vec![
        format!("# {}", item.name),
        String::new(),
        format!("- 组件类型：`{}`", provider_type_label(&item.provider_type)),
        format!("- 返回类型：`{}`", return_type_label(&item.return_type)),
        format!("- 渲染组件类型名：`{}`", item.component_type),
        format!("- 直接调用组件名：`{}`", item.english_name),
        format!("- 组件描述：{}", item.description),
        String::new(),
        "## 参数映射".to_string(),
        String::new(),
    ];
    for mapping in &item.workflow.parameter_mappings {
        let required = if mapping.required { "必填" } else { "可选" };
        let default_text = if should_expose_default_value(mapping) {
            format!(
                "；默认值：{}",
                stringify_value_preview(&mapping.default_value, 96)
            )
        } else {
            String::new()
        };
        let description = if mapping.description.trim().is_empty() {
            String::new()
        } else {
            format!(
                "；说明：{}",
                summarize_inline_text(mapping.description.trim(), 120)
            )
        };
        lines.push(format!(
            "- `{}`（{}） [{}]：{}，{}；角色：{}{}{}；提示：{}",
            mapping.parameter_name,
            mapping.field_name,
            mapping.label,
            value_type_label(&mapping.value_type),
            required,
            parameter_role_label(mapping),
            default_text,
            description,
            parameter_role_guidance(mapping)
        ));
    }
    lines.push(String::new());
    lines.push("## 使用要求".to_string());
    lines.push(String::new());
    lines.push("- 这是 UI 组件 skill，不是 tool，也不是 MCP 调用；不要因为工具列表里没有同名 tool 就回答“找不到”。".to_string());
    lines.push("- 只在 GUI / App / Web 等可渲染 UI 的上下文里输出 `<UI_JSON>`。".to_string());
    lines.push("- 渲染通道使用组件类型名：`type` 必须等于上面的“渲染组件类型名”。".to_string());
    lines.push("- 调用通道使用组件目录名：`ComponentInvokeAction.props.componentName` 必须等于上面的“直接调用组件名”。".to_string());
    lines.push("- 参数名必须使用参数映射中的 parameter_name。".to_string());
    lines.push(format!("- {}", build_required_parameters_line(item)));
    lines.push("- 已知参数不完整，或需要用户继续编辑时，优先输出渲染通道，把已知值写进 `props.initialValues`。".to_string());
    lines.push("- 已知参数已经齐全，且用户要求马上生成时，优先输出 `ComponentInvokeAction`；图片/视频/音频组件把 `renderResult` 设为 `true`，让结果直接回填聊天。".to_string());
    lines.push("- 当用户明确说“直接调用 / 直接生成 / 直接执行”时，如果必填参数已满足，必须直接输出 `ComponentInvokeAction`；不要回答“没有入口”“不会用组件”“当前上下文没有安全规范”。".to_string());
    lines.push("- `params` 里只保留组件声明过的参数；用户多给的字段不要原样塞进去，也不要因为存在额外字段就拒绝调用。".to_string());
    lines.push("- 可选参数缺失不会阻止调用；只要必填参数齐了就可以执行。".to_string());
    lines.push("- 如果用户给了额外的风格、氛围、约束、主题等要求，但组件没有同名字段，可把这类要求合并进最接近的描述型字符串参数（例如 `tags` / `prompt` / `description` / `text`）；若没有合适字段，就忽略这些额外字段，不要因此拒绝。".to_string());
    lines.push(
        "- 如果仍然走渲染通道并且参数已齐，可设置 `props.autoRun=true` 让组件打开后自动执行。"
            .to_string(),
    );
    lines.push(
        "- 不要把 `english_name` 写进渲染 `type`，也不要把 `component_type` 写进 `componentName`。"
            .to_string(),
    );
    lines.push(String::new());
    lines.push("## 输出示例".to_string());
    lines.push(String::new());
    lines.push(format!("- 打开组件：`<UI_JSON>{render_example}</UI_JSON>`"));
    lines.push(format!(
        "- 直接调用并回填结果：`<UI_JSON>{invoke_example}</UI_JSON>`"
    ));
    lines.join("\n")
}

fn build_prompt_context_markdown(item: &ComponentDefinition) -> String {
    let render_example = serde_json::to_string(&build_component_render_example(item))
        .unwrap_or_else(|_| "{}".to_string());
    let invoke_example = serde_json::to_string(&build_component_invoke_example(item))
        .unwrap_or_else(|_| "{}".to_string());
    let capability_tag = component_capability_tag(&item.return_type);
    let capability_label = component_capability_label(&item.return_type);
    let mut lines = vec![
        format!("# {}", item.name),
        String::new(),
        format!("- 组件标识：`{}`", item.component_type),
        format!("- 技能目录：`{}`", item.english_name),
        format!("- 直接调用名：`{}`", item.english_name),
        format!("- 描述：{}", item.description),
        format!(
            "- Provider：`provider:{}`",
            component_provider_tag(&item.provider_type)
        ),
        format!("- 返回类型：`{}`", return_type_label(&item.return_type)),
        format!("- 能力标签：`{}` / `{}`", capability_tag, capability_label),
        String::new(),
        "## 参数映射".to_string(),
        String::new(),
    ];
    for mapping in &item.workflow.parameter_mappings {
        let required = if mapping.required { "必填" } else { "可选" };
        let default_text = if should_expose_default_value(mapping) {
            format!(
                "；默认值：{}",
                stringify_value_preview(&mapping.default_value, 96)
            )
        } else {
            String::new()
        };
        let description = if mapping.description.trim().is_empty() {
            String::new()
        } else {
            format!(
                "；说明：{}",
                summarize_inline_text(mapping.description.trim(), 120)
            )
        };
        lines.push(format!(
            "- `{}`（{}） [{}]：{}，{}；角色：{}{}{}；提示：{}",
            mapping.parameter_name,
            mapping.field_name,
            mapping.label,
            value_type_label(&mapping.value_type),
            required,
            parameter_role_label(mapping),
            default_text,
            description,
            parameter_role_guidance(mapping)
        ));
    }
    lines.push(String::new());
    lines.push("## 调用规则".to_string());
    lines.push(String::new());
    lines.push("- 这是组件 skill / UI 能力，不是 OpenFang function tool。".to_string());
    lines.push("- 当用户明确请求使用该组件时，输出 `<UI_JSON>`。".to_string());
    lines.push("- 渲染通道：直接输出组件卡片，`type` 必须精确等于 `组件标识`，已知参数写进 `props.initialValues`。".to_string());
    lines.push("- 调用通道：输出 `ComponentInvokeAction`，其中 `props.componentName` 必须精确等于 `直接调用名`。".to_string());
    lines.push(format!("- {}", build_required_parameters_line(item)));
    lines.push("- 对图片/视频/音频这类直接产出媒体结果的请求，只要参数已经齐全，就优先走调用通道，并设置 `renderResult=true`。".to_string());
    lines.push(
        "- 对参数还不完整、需要用户补充或希望用户手动确认的请求，优先走渲染通道。".to_string(),
    );
    lines.push("- 当用户已经明确要求“直接生成 / 直接调用 / 直接执行”时，只要必填参数齐了，就必须直接输出 `ComponentInvokeAction`，不要解释自己不会用组件，也不要说当前上下文没有入口。".to_string());
    lines.push("- `params` 中只能放当前组件声明过的参数；用户额外提到的 title / style / prompt / note 等字段，如果组件未声明，不要原样塞进去，也不要因为它们不存在映射就拒绝调用。".to_string());
    lines
        .push("- 可选参数缺失不会阻止执行；判断是否能直调时，只看必填参数是否已满足。".to_string());
    lines.push("- 若用户多给的是风格、氛围、主题、补充要求，而组件存在描述型字符串参数（如 `tags` / `prompt` / `description` / `text`），可把这些额外要求合并进去；否则忽略这些额外字段，继续调用。".to_string());
    lines.push(
        "- 若用户要求直接执行，并且你仍选择渲染通道，可设置 `props.autoRun=true`。".to_string(),
    );
    lines.push("- 不要混淆 `component_type` 与 `english_name`：前者只用于渲染 `type`，后者只用于 `componentName`。".to_string());
    lines.push(String::new());
    lines.push("## 输出规范".to_string());
    lines.push(String::new());
    lines.push(format!(
        "- 仅打开组件：`<UI_JSON>{render_example}</UI_JSON>`"
    ));
    lines.push(format!(
        "- 直接调用并回填结果：`<UI_JSON>{invoke_example}</UI_JSON>`"
    ));
    lines.join("\n")
}

fn build_component_skill_tags(item: &ComponentDefinition) -> Vec<String> {
    let provider_tag = component_provider_tag(&item.provider_type);
    let capability_tag = component_capability_tag(&item.return_type);
    let capability_label = component_capability_label(&item.return_type);
    let mut tags = vec![
        "generated".to_string(),
        "component-center".to_string(),
        "component-skill".to_string(),
        provider_tag.to_string(),
        format!("provider:{provider_tag}"),
        capability_tag.to_string(),
        capability_label.to_string(),
    ];
    if !item.capability_binding.base_tool.trim().is_empty() {
        tags.push(format!(
            "base-tool:{}",
            item.capability_binding.base_tool.trim()
        ));
    }
    if !item.capability_binding.capability_key.trim().is_empty() {
        tags.push(format!(
            "capability-key:{}",
            item.capability_binding.capability_key.trim()
        ));
    }
    if !item.capability_binding.capability_scope.trim().is_empty() {
        tags.push(format!(
            "capability-scope:{}",
            item.capability_binding.capability_scope.trim()
        ));
    }
    if !item.capability_binding.source_policy.trim().is_empty() {
        tags.push(format!(
            "source-policy:{}",
            item.capability_binding.source_policy.trim()
        ));
    }
    if !item.selector_meta.specialization.trim().is_empty() {
        tags.push(format!(
            "specialization:{}",
            item.selector_meta.specialization.trim()
        ));
    }
    if !item.selector_meta.subject_policy.trim().is_empty() {
        tags.push(format!(
            "subject-policy:{}",
            item.selector_meta.subject_policy.trim()
        ));
    }
    if item.selector_meta.supports_text_only {
        tags.push("supports-text-only".to_string());
    }
    for tag in &item.selector_meta.intent_tags {
        let trimmed = tag.trim();
        if !trimmed.is_empty() {
            tags.push(format!("intent:{trimmed}"));
        }
    }
    for slot in &item.selector_meta.requires_slots {
        let trimmed = slot.trim();
        if !trimmed.is_empty() {
            tags.push(format!("requires-slot:{trimmed}"));
        }
    }
    for mime in &item.selector_meta.preferred_mime_types {
        let trimmed = mime.trim();
        if !trimmed.is_empty() {
            tags.push(format!("preferred-mime:{trimmed}"));
        }
    }
    tags
}

fn build_skill_toml(item: &ComponentDefinition, prompt_context: &str) -> String {
    let prompt_literal = prompt_context.replace("'''", "'''\"\"\"'''");
    let tags_literal = serde_json::to_string(&build_component_skill_tags(item))
        .unwrap_or_else(|_| "[]".to_string());
    let description =
        serde_json::to_string(&item.description).unwrap_or_else(|_| "\"\"".to_string());
    let base_tool = item.capability_binding.base_tool.trim();
    if base_tool.is_empty() || base_tool == "component_invoke" {
        return format!(
            "prompt_context = '''\n{prompt_literal}\n'''\n\n[skill]\nname = \"{skill_name}\"\nversion = \"0.1.0\"\ndescription = {description}\nauthor = \"\"\nlicense = \"\"\ntags = {tags_literal}\n\n[runtime]\ntype = \"promptonly\"\nentry = \"\"\n\n[tools]\nprovided = []\n\n[requirements]\ntools = []\ncapabilities = []\n\n[source]\ntype = \"native\"\n",
            skill_name = item.english_name,
            description = description,
            tags_literal = tags_literal
        );
    }

    let tool_description = serde_json::to_string(&format!(
        "组件中心能力适配器：{}。绑定基础工具 {}，由 runtime selector 选择后执行。",
        item.name.trim(),
        base_tool
    ))
    .unwrap_or_else(|_| "\"组件中心能力适配器\"".to_string());

    format!(
        "prompt_context = '''\n{prompt_literal}\n'''\n\n[skill]\nname = \"{skill_name}\"\nversion = \"0.1.0\"\ndescription = {description}\nauthor = \"\"\nlicense = \"\"\ntags = {tags_literal}\n\n[runtime]\ntype = \"node\"\nentry = \"{entry}\"\n\n[[tools.provided]]\nname = \"{base_tool}\"\ndescription = {tool_description}\ninput_schema = {{ type = \"object\", additionalProperties = true }}\n\n[requirements]\ntools = []\ncapabilities = []\n\n[source]\ntype = \"native\"\n",
        skill_name = item.english_name,
        description = description,
        tags_literal = tags_literal,
        entry = COMPONENT_TOOL_ADAPTER_FILE,
        base_tool = base_tool,
        tool_description = tool_description,
    )
}

fn build_component_tool_adapter_script(item: &ComponentDefinition) -> String {
    let component_key =
        serde_json::to_string(&item.english_name).unwrap_or_else(|_| "\"\"".to_string());
    let base_tool = serde_json::to_string(&item.capability_binding.base_tool)
        .unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"const COMPONENT_KEY = {component_key};
const DEFAULT_TOOL = {base_tool};

function readStdin() {{
  return new Promise((resolve, reject) => {{
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  }});
}}

async function main() {{
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {{}};
  const toolName = typeof payload.tool === 'string' && payload.tool.trim() ? payload.tool.trim() : DEFAULT_TOOL;
  const input = payload && typeof payload.input === 'object' && payload.input !== null ? payload.input : {{}};
  const baseUrl = String(process.env.WEBOT_SERVICE_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {{
    throw new Error('WEBOT_SERVICE_BASE_URL 未配置，组件能力适配器无法调用管理服务');
  }}
  const agentId = typeof input.agentId === 'string' && input.agentId.trim()
    ? input.agentId.trim()
    : (typeof input.callerAgentId === 'string' && input.callerAgentId.trim() ? input.callerAgentId.trim() : undefined);
  const response = await fetch(`${{baseUrl}}/api/management/components/${{encodeURIComponent(COMPONENT_KEY)}}/capability-invoke`, {{
    method: 'POST',
    headers: {{
      'content-type': 'application/json',
      'accept': 'application/json',
    }},
    body: JSON.stringify({{
      toolName,
      input,
      ...(agentId ? {{ agentId }} : {{}}),
    }}),
  }});
  const text = await response.text();
  if (!response.ok) {{
    throw new Error(text || `HTTP ${{response.status}}`);
  }}
  process.stdout.write(text.trim() ? text : '{{}}');
}}

main().catch((error) => {{
  process.stdout.write(JSON.stringify({{
    error: error instanceof Error ? error.message : String(error || '组件能力适配器执行失败'),
  }}));
  process.exitCode = 1;
}});
"#
    )
}

fn build_component_runtime_tsx(item: &ComponentDefinition) -> String {
    let template = r#"import React from 'react';

const COMPONENT_KEY = __COMPONENT_KEY__;
const COMPONENT_TITLE = __COMPONENT_TITLE__;
const COMPONENT_DESCRIPTION = __COMPONENT_DESCRIPTION__;

function readApi() {
  const api = (window).__WEBOT_API__;
  if (!api || typeof api.requestJson !== 'function') {
    throw new Error('Webot API 不可用');
  }
  return api;
}

function normalizeValue(raw, valueType) {
  if (valueType === 'number') {
    if (raw === '' || raw === null || raw === undefined) return '';
    const next = Number(raw);
    return Number.isFinite(next) ? next : raw;
  }
  if (valueType === 'boolean') {
    return Boolean(raw);
  }
  if (valueType === 'json') {
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return raw;
      }
    }
    return raw;
  }
  return raw ?? '';
}

function buildInitialValues(item, presetValues) {
  const mappings = Array.isArray(item?.workflow?.parameterMappings) ? item.workflow.parameterMappings : [];
  const output = {};
  for (const mapping of mappings) {
    const key = typeof mapping?.parameterName === 'string' ? mapping.parameterName : '';
    if (!key) continue;
    if (presetValues && Object.prototype.hasOwnProperty.call(presetValues, key)) {
      output[key] = presetValues[key];
      continue;
    }
    if (mapping.defaultValue !== undefined && mapping.defaultValue !== null) {
      output[key] = mapping.defaultValue;
      continue;
    }
    output[key] = mapping.valueType === 'boolean' ? false : '';
  }
  return output;
}

function hasMeaningfulValue(raw, valueType) {
  if (valueType === 'boolean') return typeof raw === 'boolean';
  if (valueType === 'number') return raw !== '' && raw !== null && raw !== undefined && Number.isFinite(Number(raw));
  if (valueType === 'json') return raw !== '' && raw !== null && raw !== undefined;
  return typeof raw === 'string' ? raw.trim().length > 0 : raw !== null && raw !== undefined;
}

function hasAllRequiredValues(item, values) {
  const mappings = Array.isArray(item?.workflow?.parameterMappings) ? item.workflow.parameterMappings : [];
  return mappings
    .filter((mapping) => mapping?.required)
    .every((mapping) => hasMeaningfulValue(values?.[mapping.parameterName], mapping?.valueType || 'string'));
}

function formatHintLine(mapping) {
  const parts = [];
  parts.push(mapping?.required ? '必填' : '可选');
  if (typeof mapping?.valueType === 'string' && mapping.valueType) {
    parts.push(mapping.valueType);
  }
  if (typeof mapping?.description === 'string' && mapping.description.trim()) {
    parts.push(mapping.description.trim());
  }
  return parts.join(' · ');
}

function ResultView({ outputType, result }) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const text = typeof result?.text === 'string' ? result.text : '';
  if (outputType === 'image') return <div className="grid gap-3 sm:grid-cols-2">{items.map((item, index) => <img key={item.url || index} src={item.url} alt={item.text || `image-${index + 1}`} className="h-64 w-full rounded-2xl object-cover" />)}</div>;
  if (outputType === 'video') return <div className="grid gap-3">{items.map((item, index) => <video key={item.url || index} controls src={item.url} className="max-h-[360px] w-full rounded-xl bg-black" />)}</div>;
  if (outputType === 'audio') return <div className="grid gap-3">{items.map((item, index) => <audio key={item.url || index} controls src={item.url} className="w-full" />)}</div>;
  return <div className="rounded-2xl border border-black/10 bg-white/80 p-4 text-sm leading-6 text-slate-700">{text || '暂无文本输出'}</div>;
}

function RuntimeCard({ element }) {
  const props = (element && typeof element.props === 'object' && element.props) || {};
  const [definition, setDefinition] = React.useState(null);
  const [values, setValues] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState(null);
  const autoRunStateRef = React.useRef('');

  React.useEffect(() => {
    let active = true;
    readApi().requestJson(`/api/management/components/${encodeURIComponent(COMPONENT_KEY)}`).then((payload) => {
      if (!active) return;
      const item = payload?.item || null;
      setDefinition(item);
      setValues(buildInitialValues(item, props.initialValues || {}));
    }).catch((err) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : String(err || '加载组件失败'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [props.initialValues]);

  const invoke = React.useCallback(async () => {
    if (!definition) return;
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const payload = Object.fromEntries(Object.entries(values).map(([key, raw]) => {
        const mapping = definition.workflow.parameterMappings.find((item) => item.parameterName === key);
        return [key, normalizeValue(raw, mapping?.valueType || 'string')];
      }));
      const response = await readApi().requestJson(`/api/management/components/${encodeURIComponent(COMPONENT_KEY)}/invoke`, {
        method: 'POST',
        body: { params: payload },
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err || '调用失败'));
    } finally {
      setSubmitting(false);
    }
  }, [definition, values]);

  const autoRunEnabled = props.autoRun === true;
  const autoRunStateKey = React.useMemo(() => JSON.stringify({
    autoRun: autoRunEnabled,
    initialValues: props.initialValues || null,
  }), [autoRunEnabled, props.initialValues]);

  React.useEffect(() => {
    autoRunStateRef.current = '';
  }, [autoRunStateKey]);

  React.useEffect(() => {
    if (!autoRunEnabled || !definition || loading || submitting) return;
    if (!hasAllRequiredValues(definition, values)) return;
    if (autoRunStateRef.current === autoRunStateKey) return;
    autoRunStateRef.current = autoRunStateKey;
    void invoke();
  }, [autoRunEnabled, autoRunStateKey, definition, invoke, loading, submitting, values]);

  if (loading) return <div className="rounded-3xl border border-slate-200 bg-white/80 p-5 text-sm text-slate-500">组件初始化中...</div>;
  if (error && !definition) return <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{error}</div>;

  const mappings = Array.isArray(definition?.workflow?.parameterMappings) ? definition.workflow.parameterMappings : [];
  const outputType = definition?.returnType || 'image';

  return (
    <div className="rounded-[28px] border border-black/10 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-5 shadow-sm">
      <div className="mb-5">
        <div className="text-lg font-semibold text-slate-900">{props.title || definition?.name || COMPONENT_TITLE}</div>
        <div className="mt-1 text-sm leading-6 text-slate-600">{props.description || definition?.description || COMPONENT_DESCRIPTION}</div>
      </div>
      <div className="grid gap-4">
        {mappings.map((mapping) => {
          const key = mapping.parameterName;
          const currentValue = values[key] ?? (mapping.valueType === 'boolean' ? false : '');
          if (mapping.valueType === 'boolean') {
            return <label key={mapping.id || key} className="grid gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"><div className="inline-flex items-center gap-2"><input type="checkbox" checked={Boolean(currentValue)} onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.checked }))} disabled={submitting} /><span>{mapping.label || key}</span></div><div className="text-xs text-slate-500">{formatHintLine(mapping)}</div></label>;
          }
          if (mapping.valueType === 'number') {
            return <label key={mapping.id || key} className="grid gap-2"><div className="flex items-center gap-2"><div className="text-sm font-medium text-slate-800">{mapping.label || key}</div>{mapping.required ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-600">必填</span> : null}</div><div className="text-xs text-slate-500">{formatHintLine(mapping)}</div><input type="number" value={currentValue === '' ? '' : Number(currentValue)} onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))} disabled={submitting} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none" /></label>;
          }
          return <label key={mapping.id || key} className="grid gap-2"><div className="flex items-center gap-2"><div className="text-sm font-medium text-slate-800">{mapping.label || key}</div>{mapping.required ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-600">必填</span> : null}</div><div className="text-xs text-slate-500">{formatHintLine(mapping)}</div><textarea value={typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue ?? '', null, 2)} onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))} disabled={submitting} rows={mapping.valueType === 'json' ? 4 : (String(mapping.parameterName || '').toLowerCase().includes('lyrics') ? 8 : 3)} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none" /></label>;
        })}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button type="button" onClick={() => void invoke()} disabled={submitting} className="inline-flex h-11 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? '执行中...' : (typeof props.submitLabel === 'string' && props.submitLabel.trim() ? props.submitLabel.trim() : '立即执行')}</button>
        <div className="text-xs text-slate-500">返回类型：{outputType}</div>
        {autoRunEnabled ? <div className="text-xs text-emerald-600">已启用自动执行</div> : null}
      </div>
      {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
      {result ? <div className="mt-5 grid gap-4"><ResultView outputType={outputType} result={result} /></div> : null}
    </div>
  );
}

export default function GeneratedComponent({ element, emit }) {
  return <RuntimeCard element={element} emit={emit} />;
}
"#;
    template
        .replace(
            "__COMPONENT_KEY__",
            &serde_json::to_string(&item.english_name)
                .unwrap_or_else(|_| "\"component\"".to_string()),
        )
        .replace(
            "__COMPONENT_TITLE__",
            &serde_json::to_string(&item.name).unwrap_or_else(|_| "\"组件\"".to_string()),
        )
        .replace(
            "__COMPONENT_DESCRIPTION__",
            &serde_json::to_string(&item.description).unwrap_or_else(|_| "\"\"".to_string()),
        )
}

fn provider_type_label(value: &ComponentProviderType) -> &'static str {
    match value {
        ComponentProviderType::Comfyui => "ComfyUI",
        ComponentProviderType::Runninghub => "RunningHub",
    }
}

fn component_provider_tag(value: &ComponentProviderType) -> &'static str {
    match value {
        ComponentProviderType::Comfyui => "comfyui",
        ComponentProviderType::Runninghub => "runninghub",
    }
}

fn return_type_label(value: &ComponentReturnType) -> &'static str {
    match value {
        ComponentReturnType::Image => "image",
        ComponentReturnType::Text => "text",
        ComponentReturnType::Video => "video",
        ComponentReturnType::Audio => "audio",
    }
}

fn component_capability_tag(value: &ComponentReturnType) -> &'static str {
    match value {
        ComponentReturnType::Image => "capability:generate-image",
        ComponentReturnType::Text => "capability:generate-text",
        ComponentReturnType::Video => "capability:generate-video",
        ComponentReturnType::Audio => "capability:generate-audio",
    }
}

fn component_capability_label(value: &ComponentReturnType) -> &'static str {
    match value {
        ComponentReturnType::Image => "生成图片",
        ComponentReturnType::Text => "生成文字",
        ComponentReturnType::Video => "生成视频",
        ComponentReturnType::Audio => "生成音频",
    }
}

fn value_type_label(value: &ComponentParamValueType) -> &'static str {
    match value {
        ComponentParamValueType::String => "string",
        ComponentParamValueType::Number => "number",
        ComponentParamValueType::Boolean => "boolean",
        ComponentParamValueType::Json => "json",
    }
}

fn stringify_value_compact(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()),
    }
}

fn is_effectively_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        Value::Array(items) => items.is_empty(),
        Value::Object(map) => map.is_empty(),
        _ => false,
    }
}

fn collect_allowed_component_param_keys(mappings: &[ComponentParameterMapping]) -> Vec<String> {
    let mut keys = Vec::new();
    for mapping in mappings {
        let exact = mapping.parameter_name.trim();
        if !exact.is_empty() && !keys.iter().any(|item| item == exact) {
            keys.push(exact.to_string());
        }
        for alias in infer_component_param_aliases(mapping) {
            if !keys.iter().any(|item| item == alias) {
                keys.push(alias.to_string());
            }
        }
    }
    keys.sort();
    keys
}

fn validate_component_invoke_params(
    item: &ComponentDefinition,
    params: &Map<String, Value>,
) -> Result<(), ApiError> {
    let allowed_keys = collect_allowed_component_param_keys(&item.workflow.parameter_mappings);
    let unknown_keys = params
        .keys()
        .filter(|key| {
            let normalized = key.trim();
            !normalized.is_empty() && !allowed_keys.iter().any(|allowed| allowed == normalized)
        })
        .cloned()
        .collect::<Vec<_>>();
    if !unknown_keys.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "组件 {} 收到未声明参数: {}。允许参数: {}",
                item.english_name,
                unknown_keys.join(", "),
                if allowed_keys.is_empty() {
                    "无".to_string()
                } else {
                    allowed_keys.join(", ")
                }
            ),
        ));
    }

    let missing_required = item
        .workflow
        .parameter_mappings
        .iter()
        .filter(|mapping| mapping.required)
        .filter_map(
            |mapping| match resolve_component_param_value(mapping, params) {
                Some(value) if !is_effectively_empty_value(&value) => None,
                _ => Some(mapping.parameter_name.clone()),
            },
        )
        .collect::<Vec<_>>();
    if !missing_required.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!(
                "组件 {} 缺少必填参数: {}",
                item.english_name,
                missing_required.join(", ")
            ),
        ));
    }

    Ok(())
}

fn resolve_runtime_component_param_value(
    mapping: &ComponentParameterMapping,
    params: &Map<String, Value>,
) -> Result<Option<Value>, ApiError> {
    if let Some(value) = resolve_component_param_value(mapping, params) {
        if mapping.required && is_effectively_empty_value(&value) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("组件缺少必填参数: {}", mapping.parameter_name),
            ));
        }
        return Ok(Some(value));
    }
    if mapping.required {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("组件缺少必填参数: {}", mapping.parameter_name),
        ));
    }
    if !mapping.default_value.is_null() {
        return Ok(Some(mapping.default_value.clone()));
    }
    Ok(None)
}

fn build_component_params_from_capability_input(
    item: &ComponentDefinition,
    tool_name: &str,
    input: &Value,
) -> Result<Map<String, Value>, ApiError> {
    let raw = input
        .as_object()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "组件能力调用的 input 必须是对象"))?;
    let mut params = Map::new();
    let prompt_like = pick_first_non_empty_value(
        raw,
        &[
            "prompt",
            "text",
            "message",
            "description",
            "question",
            "instructions",
        ],
    );
    let image_like = pick_first_non_empty_value(
        raw,
        &[
            "image",
            "image_url",
            "imageUrl",
            "image_path",
            "imagePath",
            "source_image",
            "sourceImage",
            "reference_image",
            "referenceImage",
        ],
    );
    let video_like = pick_first_non_empty_value(
        raw,
        &[
            "video",
            "video_url",
            "videoUrl",
            "video_path",
            "videoPath",
            "source_video",
            "sourceVideo",
        ],
    );
    let audio_like = pick_first_non_empty_value(
        raw,
        &[
            "audio",
            "audio_url",
            "audioUrl",
            "audio_path",
            "audioPath",
            "path",
            "url",
        ],
    );

    for mapping in &item.workflow.parameter_mappings {
        if let Some(value) = resolve_component_param_value(mapping, raw) {
            params.insert(mapping.parameter_name.clone(), value);
            continue;
        }

        let mapping_key = mapping.parameter_name.trim().to_ascii_lowercase();
        let inferred = if is_component_video_mapping(mapping) {
            video_like.clone()
        } else if is_component_audio_mapping(mapping) {
            audio_like.clone()
        } else if is_component_image_mapping(mapping) {
            image_like.clone()
        } else if is_component_voice_mapping(mapping) {
            pick_first_non_empty_value(
                raw,
                &["voice", "speaker", "speaker_profile_id", "speakerProfileId"],
            )
        } else if is_component_language_mapping(mapping) {
            pick_first_non_empty_value(raw, &["language", "lang"])
        } else if is_component_duration_mapping(mapping) {
            raw.get("duration")
                .cloned()
                .or_else(|| raw.get("duration_secs").cloned())
                .or_else(|| raw.get("seconds").cloned())
        } else if tool_name == "speech_to_text"
            || tool_name == "image_analyze"
            || tool_name == "media_describe"
        {
            if is_strict_source_parameter(mapping) {
                image_like
                    .clone()
                    .or_else(|| audio_like.clone())
                    .or_else(|| video_like.clone())
            } else {
                prompt_like.clone()
            }
        } else if mapping_key.contains("negative") {
            raw.get("negative_prompt")
                .cloned()
                .or_else(|| raw.get("negativePrompt").cloned())
        } else if is_descriptive_parameter(mapping) || is_component_text_mapping(mapping) {
            prompt_like.clone()
        } else {
            None
        };

        if let Some(value) = inferred {
            params.insert(mapping.parameter_name.clone(), value);
        }
    }

    validate_component_invoke_params(item, &params)?;
    Ok(params)
}

fn pick_first_non_empty_value(params: &Map<String, Value>, keys: &[&str]) -> Option<Value> {
    keys.iter().find_map(|key| {
        let value = params.get(*key)?;
        if is_effectively_empty_value(value) {
            return None;
        }
        Some(value.clone())
    })
}

fn is_component_video_mapping(mapping: &ComponentParameterMapping) -> bool {
    let combined = format!(
        "{} {} {} {}",
        mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
    )
    .to_ascii_lowercase();
    combined.contains("video")
        || mapping.label.contains("视频")
        || mapping.description.contains("视频")
}

fn is_component_audio_mapping(mapping: &ComponentParameterMapping) -> bool {
    let combined = format!(
        "{} {} {} {}",
        mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
    )
    .to_ascii_lowercase();
    combined.contains("audio")
        || combined.contains("voice")
        || combined.contains("speech")
        || mapping.label.contains("音频")
        || mapping.label.contains("语音")
        || mapping.description.contains("音频")
        || mapping.description.contains("语音")
}

fn is_component_voice_mapping(mapping: &ComponentParameterMapping) -> bool {
    let combined = format!(
        "{} {} {} {}",
        mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
    )
    .to_ascii_lowercase();
    combined.contains("voice")
        || combined.contains("speaker")
        || mapping.label.contains("音色")
        || mapping.label.contains("音源")
}

fn is_component_language_mapping(mapping: &ComponentParameterMapping) -> bool {
    let key = mapping.parameter_name.trim().to_ascii_lowercase();
    key == "language" || key == "lang"
}

fn is_component_duration_mapping(mapping: &ComponentParameterMapping) -> bool {
    let combined = format!(
        "{} {} {} {}",
        mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
    )
    .to_ascii_lowercase();
    combined.contains("duration") || combined.contains("second") || mapping.label.contains("时长")
}

async fn invoke_comfyui_component(
    state: &Arc<AppState>,
    item: &ComponentDefinition,
    config: &ComponentServiceConfig,
    params: &Map<String, Value>,
    agent_id: Option<&str>,
) -> Result<ComponentInvokeResult, ApiError> {
    validate_component_invoke_params(item, params)?;
    if item
        .workflow
        .raw_payload
        .get("legacy")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "该旧组件只有参数说明，没有保存完整 ComfyUI 工作流；请在组件中心重新导入工作流并保存一次",
        ));
    }
    if item.workflow.raw_payload.is_null() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "组件缺少原始 ComfyUI 工作流，请重新在组件中心导入并保存工作流",
        ));
    }
    let owner_agent_id = agent_id.map(str::trim).filter(|value| !value.is_empty());
    let (_, headers, base_url, prompt) =
        prepare_comfyui_component_prompt(state, item, config, params, agent_id).await?;
    if should_run_comfyui_component_as_background_job(item, owner_agent_id) {
        return enqueue_comfyui_component_job(item, config, params, prompt, owner_agent_id);
    }
    let client = build_comfyui_client()?;
    let (prompt_id, _) = submit_comfyui_prompt(&client, &headers, &base_url, &prompt).await?;

    let history = poll_comfyui_history(
        &client,
        &headers,
        &base_url,
        &prompt_id,
        comfyui_poll_attempts_for_component(item),
    )
    .await?;
    let localized = localize_component_video_outputs(
        item,
        &history,
        &extract_comfyui_items(&base_url, &history, &item.return_type),
        owner_agent_id,
        Some(&Value::Object(params.clone())),
    )
    .await
    .map_err(internal_error)?;
    let items = localized.items;
    let text = if items.is_empty() {
        "ComfyUI 已完成，但未发现可展示输出".to_string()
    } else {
        String::new()
    };
    let provider_meta = build_component_provider_meta(item);
    let presentable_result =
        build_component_presentable_result(item, &text, &localized.raw, &items, &provider_meta);
    Ok(ComponentInvokeResult {
        output_type: item.return_type.clone(),
        text,
        items,
        raw: localized.raw,
        presentable_result,
        provider_meta: Some(provider_meta),
    })
}

fn build_comfyui_client() -> Result<reqwest::Client, ApiError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("创建 ComfyUI 客户端失败: {err}"),
            )
        })
}

async fn prepare_comfyui_component_prompt(
    state: &Arc<AppState>,
    item: &ComponentDefinition,
    config: &ComponentServiceConfig,
    params: &Map<String, Value>,
    agent_id: Option<&str>,
) -> Result<(reqwest::Client, HeaderMap, String, Value), ApiError> {
    let base_url = normalize_url_or_default(&config.server_url, &default_comfyui_server_url());
    let client = build_comfyui_client()?;
    let headers = build_provider_headers(config)?;
    let mut prompt = normalize_comfy_prompt_payload(&item.workflow.raw_payload)?;
    apply_component_params_to_prompt(
        &mut prompt,
        &item.workflow.parameter_mappings,
        params,
        true,
        state,
        &client,
        &headers,
        &base_url,
        agent_id,
    )
    .await?;
    Ok((client, headers, base_url, prompt))
}

async fn submit_comfyui_prompt(
    client: &reqwest::Client,
    headers: &HeaderMap,
    base_url: &str,
    prompt: &Value,
) -> Result<(String, Value), ApiError> {
    let enqueue_response = client
        .post(format!("{base_url}/prompt"))
        .headers(headers.clone())
        .json(&json!({
            "client_id": "webot-component-center",
            "prompt": prompt,
        }))
        .send()
        .await
        .map_err(|err| {
            ApiError::new(StatusCode::BAD_GATEWAY, format!("请求 ComfyUI 失败: {err}"))
        })?;
    let enqueue_status = enqueue_response.status();
    let enqueue_text = enqueue_response.text().await.map_err(|err| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取 ComfyUI 响应失败: {err}"),
        )
    })?;
    if !enqueue_status.is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "ComfyUI 返回错误({enqueue_status}): {}",
                enqueue_text.trim()
            ),
        ));
    }
    let enqueue_json = serde_json::from_str::<Value>(&enqueue_text).map_err(|err| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("ComfyUI 返回非 JSON: {err}; body={enqueue_text}"),
        )
    })?;
    let prompt_id = enqueue_json
        .get("prompt_id")
        .or_else(|| enqueue_json.get("promptId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "ComfyUI 未返回 prompt_id"))?;
    Ok((prompt_id.to_string(), enqueue_json))
}

fn normalize_comfy_prompt_payload(raw_payload: &Value) -> Result<Value, ApiError> {
    let Some(object) = raw_payload.as_object() else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "ComfyUI 工作流必须是 JSON 对象",
        ));
    };
    if let Some(nodes) = object.get("nodes").and_then(Value::as_array) {
        let mut prompt = Map::new();
        for node in nodes {
            let Some(node_obj) = node.as_object() else {
                continue;
            };
            let node_id = node_obj
                .get("id")
                .map(value_to_string)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "ComfyUI 节点缺少 id"))?;
            let class_type = node_obj
                .get("class_type")
                .or_else(|| node_obj.get("type"))
                .map(value_to_string)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    ApiError::new(StatusCode::BAD_REQUEST, "ComfyUI 节点缺少 class_type/type")
                })?;
            let inputs = node_obj
                .get("inputs")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let mut record = Map::new();
            record.insert("class_type".to_string(), Value::String(class_type));
            record.insert("inputs".to_string(), Value::Object(inputs));
            prompt.insert(node_id, Value::Object(record));
        }
        return Ok(Value::Object(prompt));
    }
    Ok(raw_payload.clone())
}

async fn apply_component_params_to_prompt(
    prompt: &mut Value,
    mappings: &[ComponentParameterMapping],
    params: &Map<String, Value>,
    require_raw_workflow: bool,
    state: &Arc<AppState>,
    client: &reqwest::Client,
    headers: &HeaderMap,
    comfyui_base_url: &str,
    agent_id: Option<&str>,
) -> Result<(), ApiError> {
    let Some(prompt_object) = prompt.as_object_mut() else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "组件工作流格式无效，无法写入参数",
        ));
    };
    for mapping in mappings {
        let chosen = resolve_runtime_component_param_value(mapping, params)?;
        let Some(value) = chosen else {
            continue;
        };
        let Some(node_value) = prompt_object.get_mut(&mapping.node_id) else {
            if require_raw_workflow {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("工作流中缺少节点 {}", mapping.node_id),
                ));
            }
            continue;
        };
        let Some(node_object) = node_value.as_object_mut() else {
            continue;
        };
        let node_class_type = node_object
            .get("class_type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let coerced = coerce_value_for_mapping(value, &mapping.value_type)?;
        let normalized_value = maybe_normalize_comfyui_asset_value(
            state,
            client,
            headers,
            comfyui_base_url,
            &node_class_type,
            mapping,
            coerced,
            agent_id,
        )
        .await?;
        let inputs = node_object
            .entry("inputs".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        let Some(input_object) = inputs.as_object_mut() else {
            continue;
        };
        input_object.insert(mapping.field_name.clone(), normalized_value);
    }
    Ok(())
}

fn resolve_component_param_value(
    mapping: &ComponentParameterMapping,
    params: &Map<String, Value>,
) -> Option<Value> {
    let exact_key = mapping.parameter_name.trim();
    if !exact_key.is_empty() {
        if let Some(value) = params.get(exact_key).cloned() {
            if !is_effectively_empty_value(&value) {
                return Some(value);
            }
        }
    }

    for alias in infer_component_param_aliases(mapping) {
        if let Some(value) = params.get(alias).cloned() {
            if !is_effectively_empty_value(&value) {
                return Some(value);
            }
        }
    }

    None
}

fn infer_component_param_aliases(mapping: &ComponentParameterMapping) -> Vec<&'static str> {
    let mut aliases = Vec::new();
    if is_component_image_mapping(mapping) {
        aliases.extend([
            "image",
            "image_url",
            "imageUrl",
            "image_path",
            "imagePath",
            "image_base64",
            "imageBase64",
            "source_image",
            "sourceImage",
            "reference_image",
            "referenceImage",
            "src",
            "url",
            "path",
            "photo",
            "photo_url",
            "photoUrl",
        ]);
    }
    if is_component_text_mapping(mapping) {
        aliases.extend([
            "prompt",
            "text",
            "message",
            "description",
            "instructions",
            "question",
            "script",
            "caption",
        ]);
    }
    if is_component_width_mapping(mapping) {
        aliases.extend(["width", "w"]);
    }
    if is_component_height_mapping(mapping) {
        aliases.extend(["height", "h"]);
    }

    let mut unique = Vec::new();
    for alias in aliases {
        if mapping.parameter_name == alias || unique.contains(&alias) {
            continue;
        }
        unique.push(alias);
    }
    unique
}

fn is_component_image_mapping(mapping: &ComponentParameterMapping) -> bool {
    let parameter_name = mapping.parameter_name.trim().to_ascii_lowercase();
    let field_name = mapping.field_name.trim().to_ascii_lowercase();
    if matches!(
        parameter_name.as_str(),
        "text" | "prompt" | "message" | "description" | "question" | "instructions"
    ) || matches!(
        field_name.as_str(),
        "text" | "prompt" | "message" | "description" | "question" | "instructions"
    ) {
        return false;
    }
    let combined = format!(
        "{} {} {} {}",
        mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
    )
    .to_ascii_lowercase();
    combined.contains("image")
        || combined.contains("photo")
        || mapping.parameter_name.contains('图')
        || mapping.label.contains('图')
        || mapping.description.contains('图')
}

fn is_component_text_mapping(mapping: &ComponentParameterMapping) -> bool {
    let combined = format!(
        "{} {} {} {}",
        mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
    )
    .to_ascii_lowercase();
    if combined.contains("negative")
        || mapping.label.contains("负")
        || mapping.description.contains("负")
    {
        return false;
    }
    combined.contains("prompt")
        || combined.contains("text")
        || combined.contains("message")
        || mapping.label.contains("提示词")
        || mapping.description.contains("提示词")
}

fn is_component_width_mapping(mapping: &ComponentParameterMapping) -> bool {
    let combined = format!(
        "{} {} {} {}",
        mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
    )
    .to_ascii_lowercase();
    combined.contains("width") || mapping.label.contains('宽') || mapping.description.contains('宽')
}

fn is_component_height_mapping(mapping: &ComponentParameterMapping) -> bool {
    let combined = format!(
        "{} {} {} {}",
        mapping.parameter_name, mapping.field_name, mapping.label, mapping.description
    )
    .to_ascii_lowercase();
    combined.contains("height")
        || mapping.label.contains('高')
        || mapping.description.contains('高')
}

fn comfyui_poll_attempts_for_component(item: &ComponentDefinition) -> u32 {
    if is_video_like_component(item) {
        600
    } else {
        180
    }
}

fn is_video_like_component(item: &ComponentDefinition) -> bool {
    if matches!(item.return_type, ComponentReturnType::Video) {
        return true;
    }
    let summary = format!(
        "{} {} {}",
        item.english_name, item.name, item.component_type
    )
    .to_ascii_lowercase();
    if summary.contains("video") || item.name.contains("视频") || item.description.contains("视频")
    {
        return true;
    }
    stringify_value_compact(&item.workflow.raw_payload)
        .to_ascii_lowercase()
        .contains("video")
}

async fn maybe_normalize_comfyui_asset_value(
    state: &Arc<AppState>,
    client: &reqwest::Client,
    headers: &HeaderMap,
    comfyui_base_url: &str,
    node_class_type: &str,
    mapping: &ComponentParameterMapping,
    value: Value,
    agent_id: Option<&str>,
) -> Result<Value, ApiError> {
    let Value::String(text) = value else {
        return Ok(value);
    };
    if !should_upload_value_to_comfyui(mapping, node_class_type, &text) {
        return Ok(Value::String(text));
    }

    let (bytes, mime_type) = resolve_component_image_source(state, client, agent_id, &text).await?;
    let uploaded_name =
        upload_image_to_comfyui(client, headers, comfyui_base_url, &bytes, &mime_type).await?;
    Ok(Value::String(uploaded_name))
}

fn should_upload_value_to_comfyui(
    mapping: &ComponentParameterMapping,
    node_class_type: &str,
    value: &str,
) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || !looks_like_image_source(trimmed) {
        return false;
    }

    let field_name = mapping.field_name.trim().to_ascii_lowercase();
    let parameter_name = mapping.parameter_name.trim().to_ascii_lowercase();
    let label = mapping.label.trim().to_ascii_lowercase();
    let node_type = node_class_type.trim().to_ascii_lowercase();

    field_name.contains("image")
        || field_name.contains("mask")
        || parameter_name.contains("image")
        || parameter_name.contains("photo")
        || mapping.parameter_name.contains('图')
        || label.contains("image")
        || label.contains("photo")
        || mapping.label.contains('图')
        || node_type.contains("loadimage")
        || node_type.contains("image")
}

fn looks_like_image_source(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with("data:image/")
        || trimmed.starts_with("/api/uploads/")
        || trimmed.starts_with("api/uploads/")
        || trimmed.starts_with("/api/management/agents/")
        || trimmed.contains("/api/uploads/")
        || trimmed.contains("/api/management/agents/")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || looks_like_relative_image_source_path(trimmed)
        || Path::new(trimmed).is_file()
}

fn looks_like_relative_image_source_path(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
        || trimmed.starts_with("blob:")
        || trimmed.starts_with("/api/")
        || trimmed.starts_with("api/")
        || trimmed.contains("://")
    {
        return false;
    }
    let path = Path::new(trimmed);
    if path.is_absolute() || path.components().count() == 0 {
        return false;
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let has_image_extension = normalize_image_mime_type(extension).is_some();
    has_image_extension && (trimmed.contains('/') || trimmed.contains('\\'))
}

fn resolve_relative_component_image_path(roots: &[PathBuf], source: &str) -> Option<PathBuf> {
    let trimmed = source.trim();
    if !looks_like_relative_image_source_path(trimmed) {
        return None;
    }
    let relative = Path::new(trimmed);
    roots
        .iter()
        .map(|root| root.join(relative))
        .find(|candidate| candidate.is_file())
}

fn parse_component_management_media_reference(
    source_url: &str,
) -> Option<(String, &'static str, String)> {
    let trimmed = source_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path_like = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let index = trimmed.find("/api/management/agents/")?;
        &trimmed[index..]
    } else {
        trimmed
    };
    let path_only = path_like
        .split('#')
        .next()
        .unwrap_or(path_like)
        .split('?')
        .next()
        .unwrap_or(path_like);
    let rest = path_only.strip_prefix("/api/management/agents/")?;
    let (agent_id, tail) = rest.split_once('/')?;
    if let Some(filename) = tail.strip_prefix("avatar/") {
        let normalized = filename.trim();
        if !normalized.is_empty() {
            return Some((agent_id.to_string(), "avatar", normalized.to_string()));
        }
    }
    if let Some(filename) = tail.strip_prefix("portrait/") {
        let normalized = filename.trim();
        if !normalized.is_empty() {
            return Some((agent_id.to_string(), "portrait", normalized.to_string()));
        }
    }
    None
}

fn normalize_component_management_asset_url(service_base: &str, source: &str) -> Option<String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("/api/management/") {
        return Some(format!(
            "{}{}",
            service_base.trim_end_matches('/'),
            trimmed
        ));
    }
    if trimmed.starts_with("api/management/") {
        return Some(format!(
            "{}/{}",
            service_base.trim_end_matches('/'),
            trimmed
        ));
    }
    let marker = "/api/management/";
    let index = trimmed.find(marker)?;
    Some(format!(
        "{}{}",
        service_base.trim_end_matches('/'),
        &trimmed[index..]
    ))
}

async fn resolve_component_management_image_path(
    state: &Arc<AppState>,
    source: &str,
) -> Result<Option<PathBuf>, ApiError> {
    let Some((source_agent_id, kind, filename)) = parse_component_management_media_reference(source)
    else {
        return Ok(None);
    };

    let binding =
        crate::routes::resolve_agent_workspace_binding(state, &source_agent_id, None).await?;
    for workspace_root in binding.all_workspaces() {
        let candidate = workspace_root
            .join(AGENT_PROFILE_DIR_NAME)
            .join(kind)
            .join(&filename);
        if candidate.is_file() {
            return Ok(Some(candidate));
        }
    }

    if let Ok(root) = path_resolver::workspaces_root() {
        let legacy_candidate = root.join(&source_agent_id).join(kind).join(&filename);
        if legacy_candidate.is_file() {
            return Ok(Some(legacy_candidate));
        }
    }

    Ok(None)
}

async fn resolve_component_workspace_image_path(
    state: &Arc<AppState>,
    agent_id: Option<&str>,
    source: &str,
) -> Result<Option<PathBuf>, ApiError> {
    let normalized_agent_id = agent_id.map(str::trim).filter(|value| !value.is_empty());
    let Some(agent_id) = normalized_agent_id else {
        return Ok(None);
    };
    let binding = crate::routes::resolve_agent_workspace_binding(state, agent_id, None).await?;
    Ok(resolve_relative_component_image_path(
        &binding.all_workspaces(),
        source,
    ))
}

async fn resolve_component_image_source(
    state: &Arc<AppState>,
    client: &reqwest::Client,
    agent_id: Option<&str>,
    source: &str,
) -> Result<(Vec<u8>, String), ApiError> {
    if let Some(decoded) = decode_image_data_url(source)? {
        return Ok(decoded);
    }

    let trimmed = source.trim();
    if let Some(path) = resolve_component_management_image_path(state, trimmed).await? {
        let bytes = tokio::fs::read(&path).await.map_err(|err| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("读取组件管理媒体图片参数失败({}): {err}", path.display()),
            )
        })?;
        let mime_type =
            detect_image_mime_from_path_or_bytes(path.to_str(), &bytes).ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("无法识别组件管理媒体图片格式: {}", path.display()),
                )
            })?;
        return Ok((bytes, mime_type.to_string()));
    }

    if let Some(path) = resolve_component_uploaded_image_path(state, agent_id, trimmed).await? {
        let bytes = tokio::fs::read(&path).await.map_err(|err| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("读取组件上传图片参数失败({}): {err}", path.display()),
            )
        })?;
        let mime_type =
            detect_image_mime_from_path_or_bytes(path.to_str(), &bytes).ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("无法识别组件上传图片格式: {}", path.display()),
                )
            })?;
        return Ok((bytes, mime_type.to_string()));
    }

    if Path::new(trimmed).is_file() {
        let bytes = tokio::fs::read(trimmed).await.map_err(|err| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("读取组件图片参数失败({trimmed}): {err}"),
            )
        })?;
        let mime_type =
            detect_image_mime_from_path_or_bytes(Some(trimmed), &bytes).ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("无法识别组件图片格式: {trimmed}"),
                )
            })?;
        return Ok((bytes, mime_type.to_string()));
    }

    if let Some(path) = resolve_component_workspace_image_path(state, agent_id, trimmed).await? {
        let bytes = tokio::fs::read(&path).await.map_err(|err| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("读取组件工作区图片参数失败({}): {err}", path.display()),
            )
        })?;
        let mime_type =
            detect_image_mime_from_path_or_bytes(path.to_str(), &bytes).ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("无法识别组件工作区图片格式: {}", path.display()),
                )
            })?;
        return Ok((bytes, mime_type.to_string()));
    }

    if looks_like_relative_image_source_path(trimmed) {
        let detail =
            if let Some(agent_id) = agent_id.map(str::trim).filter(|value| !value.is_empty()) {
                format!("无法在智能体 {agent_id} 的工作区中找到图片文件: {trimmed}")
            } else {
                format!("组件图片参数是相对工作区路径，但缺少 agentId 无法解析: {trimmed}")
            };
        return Err(ApiError::new(StatusCode::BAD_REQUEST, detail));
    }

    let (request_url, requires_openfang_auth) = build_component_asset_request_url(state, trimmed)?;
    let mut request = client.get(&request_url);
    if requires_openfang_auth {
        if let Some(api_key) = state
            .config
            .openfang_api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            request = request.bearer_auth(api_key);
        }
    }
    let response = request.send().await.map_err(|err| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("下载组件图片资源失败({request_url}): {err}"),
        )
    })?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let body = response.bytes().await.map_err(|err| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取组件图片资源响应失败({request_url}): {err}"),
        )
    })?;
    if !status.is_success() {
        let snippet = String::from_utf8_lossy(&body);
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "下载组件图片资源返回错误({status}, {request_url}): {}",
                snippet.trim()
            ),
        ));
    }

    let mime_type = content_type
        .as_deref()
        .and_then(normalize_image_mime_type)
        .or_else(|| detect_image_mime_from_path_or_bytes(Some(trimmed), &body))
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("无法识别组件图片资源格式: {trimmed}"),
            )
        })?;
    Ok((body.to_vec(), mime_type.to_string()))
}

fn extract_local_upload_id(source: &str) -> Option<&str> {
    let trimmed = source.trim();
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

async fn resolve_component_uploaded_image_path(
    state: &Arc<AppState>,
    agent_id: Option<&str>,
    source: &str,
) -> Result<Option<PathBuf>, ApiError> {
    let Some(file_id) = extract_local_upload_id(source) else {
        return Ok(None);
    };

    let cache_path = std::env::temp_dir().join("openfang_uploads").join(file_id);
    if cache_path.is_file() {
        return Ok(Some(cache_path));
    }

    let mut roots = Vec::new();
    if let Some(agent_id) = agent_id.map(str::trim).filter(|value| !value.is_empty()) {
        let binding = crate::routes::resolve_agent_workspace_binding(state, agent_id, None).await?;
        roots.extend(binding.all_workspaces());
    }
    if let Ok(root) = crate::path_resolver::workspaces_root() {
        roots.push(root);
    }
    if let Ok(root) = crate::path_resolver::legacy_openfang_home_dir() {
        roots.push(root.join("workspaces"));
    }

    let mut deduped = Vec::new();
    for root in roots {
        if deduped.iter().any(|existing: &PathBuf| existing == &root) {
            continue;
        }
        deduped.push(root);
    }

    Ok(recover_uploaded_image_path_from_roots(&deduped, file_id))
}

fn recover_uploaded_image_path_from_roots(roots: &[PathBuf], file_id: &str) -> Option<PathBuf> {
    for root in roots {
        if !root.exists() {
            continue;
        }

        let direct_sessions_dir = root.join("sessions");
        if direct_sessions_dir.exists() {
            if let Some(saved_path) =
                recover_uploaded_image_path_from_sessions(&direct_sessions_dir, file_id)
            {
                return Some(saved_path);
            }
        }

        let Ok(entries) = fs::read_dir(root) else {
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
                recover_uploaded_image_path_from_sessions(&sessions_dir, file_id)
            {
                return Some(saved_path);
            }
        }
    }
    None
}

fn recover_uploaded_image_path_from_sessions(
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
            if let Some(saved_path) = recover_uploaded_image_path_from_session_line(&line, file_id)
            {
                return Some(saved_path);
            }
        }
    }
    None
}

fn recover_uploaded_image_path_from_session_line(line: &str, file_id: &str) -> Option<PathBuf> {
    let payload = serde_json::from_str::<Value>(line).ok()?;
    let tool_use_entries = payload.get("tool_use")?.as_array()?;
    for entry in tool_use_entries {
        let Some(content) = entry.get("content").and_then(Value::as_str) else {
            continue;
        };
        if let Some(saved_path) = recover_uploaded_image_path_from_tool_result(content, file_id) {
            return Some(saved_path);
        }
    }
    None
}

fn recover_uploaded_image_path_from_tool_result(content: &str, file_id: &str) -> Option<PathBuf> {
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

fn build_component_asset_request_url(
    state: &Arc<AppState>,
    source: &str,
) -> Result<(String, bool), ApiError> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "组件图片参数不能为空",
        ));
    }

    let openfang_base = state.config.openfang_base_url.trim_end_matches('/');
    let service_base = local_service_base_url(state);

    if trimmed.starts_with("/api/uploads/") {
        return Ok((format!("{openfang_base}{trimmed}"), true));
    }
    if trimmed.starts_with("api/uploads/") {
        return Ok((format!("{openfang_base}/{trimmed}"), true));
    }
    if trimmed.starts_with("/api/management/") {
        return Ok((format!("{service_base}{trimmed}"), false));
    }
    if trimmed.starts_with("api/management/") {
        return Ok((format!("{service_base}/{trimmed}"), false));
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        if let Some(local_management_url) =
            normalize_component_management_asset_url(&service_base, trimmed)
        {
            return Ok((local_management_url, false));
        }
        let requires_openfang_auth = trimmed.starts_with(openfang_base)
            && trimmed[openfang_base.len()..].starts_with("/api/uploads/");
        return Ok((trimmed.to_string(), requires_openfang_auth));
    }

    Err(ApiError::new(
        StatusCode::BAD_REQUEST,
        format!("不支持的组件图片参数: {trimmed}"),
    ))
}

fn local_service_base_url(state: &AppState) -> String {
    let listen_addr = state.config.listen_addr;
    let host = if listen_addr.ip().is_unspecified() {
        if listen_addr.is_ipv4() {
            "127.0.0.1".to_string()
        } else {
            "[::1]".to_string()
        }
    } else if listen_addr.is_ipv6() {
        format!("[{}]", listen_addr.ip())
    } else {
        listen_addr.ip().to_string()
    };
    format!("http://{}:{}", host, listen_addr.port())
}

fn decode_image_data_url(source: &str) -> Result<Option<(Vec<u8>, String)>, ApiError> {
    let trimmed = source.trim();
    if !trimmed.starts_with("data:image/") {
        return Ok(None);
    }

    let (header, encoded) = trimmed
        .split_once(',')
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "data:image 参数格式无效"))?;
    if !header.to_ascii_lowercase().contains(";base64") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "data:image 参数必须使用 base64 编码",
        ));
    }
    let mime_type = if header.to_ascii_lowercase().starts_with("data:image/png") {
        "image/png"
    } else if header.to_ascii_lowercase().starts_with("data:image/jpeg")
        || header.to_ascii_lowercase().starts_with("data:image/jpg")
    {
        "image/jpeg"
    } else if header.to_ascii_lowercase().starts_with("data:image/webp") {
        "image/webp"
    } else if header.to_ascii_lowercase().starts_with("data:image/gif") {
        "image/gif"
    } else if header.to_ascii_lowercase().starts_with("data:image/bmp") {
        "image/bmp"
    } else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "暂不支持该 data:image 类型",
        ));
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|err| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("解析 data:image 参数失败: {err}"),
            )
        })?;
    Ok(Some((bytes, mime_type.to_string())))
}

async fn upload_image_to_comfyui(
    client: &reqwest::Client,
    headers: &HeaderMap,
    base_url: &str,
    bytes: &[u8],
    mime_type: &str,
) -> Result<String, ApiError> {
    let ext = extension_from_mime_type(mime_type).unwrap_or("png");
    let file_name = format!(
        "webot-component-{}.{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis().to_string())
            .unwrap_or_else(|_| "0".to_string()),
        ext
    );
    let part = reqwest::multipart::Part::bytes(bytes.to_vec())
        .file_name(file_name.clone())
        .mime_str(mime_type)
        .map_err(|err| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("组件图片 MIME 类型无效({mime_type}): {err}"),
            )
        })?;
    let form = reqwest::multipart::Form::new()
        .text("type", "input")
        .text("overwrite", "true")
        .part("image", part);
    let response = client
        .post(format!("{}/upload/image", base_url.trim_end_matches('/')))
        .headers(headers.clone())
        .multipart(form)
        .send()
        .await
        .map_err(|err| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("上传组件图片到 ComfyUI 失败: {err}"),
            )
        })?;
    let status = response.status();
    let text = response.text().await.map_err(|err| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取 ComfyUI 图片上传响应失败: {err}"),
        )
    })?;
    if !status.is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("ComfyUI 图片上传失败({status}): {}", text.trim()),
        ));
    }
    let payload = serde_json::from_str::<Value>(&text).unwrap_or(Value::Null);
    let uploaded_name = payload
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| payload.get("filename").and_then(Value::as_str))
        .unwrap_or(&file_name)
        .trim()
        .to_string();
    if uploaded_name.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "ComfyUI 上传组件图片成功但未返回文件名",
        ));
    }
    Ok(uploaded_name)
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

fn coerce_value_for_mapping(
    value: Value,
    value_type: &ComponentParamValueType,
) -> Result<Value, ApiError> {
    match value_type {
        ComponentParamValueType::String => match value {
            Value::Null => Ok(Value::String(String::new())),
            Value::String(_) => Ok(value),
            other => Ok(Value::String(stringify_value_compact(&other))),
        },
        ComponentParamValueType::Number => match value {
            Value::Number(_) => Ok(value),
            Value::String(text) => text
                .trim()
                .parse::<f64>()
                .ok()
                .and_then(serde_json::Number::from_f64)
                .map(Value::Number)
                .ok_or_else(|| {
                    ApiError::new(
                        StatusCode::BAD_REQUEST,
                        format!("无法将参数转换为数字: {text}"),
                    )
                }),
            other => Ok(other),
        },
        ComponentParamValueType::Boolean => match value {
            Value::Bool(_) => Ok(value),
            Value::String(text) => {
                let lowered = text.trim().to_ascii_lowercase();
                Ok(Value::Bool(matches!(
                    lowered.as_str(),
                    "true" | "1" | "yes" | "on"
                )))
            }
            other => Ok(other),
        },
        ComponentParamValueType::Json => match value {
            Value::String(text) => serde_json::from_str::<Value>(text.trim()).map_err(|err| {
                ApiError::new(StatusCode::BAD_REQUEST, format!("JSON 参数解析失败: {err}"))
            }),
            other => Ok(other),
        },
    }
}

async fn poll_comfyui_history(
    client: &reqwest::Client,
    headers: &HeaderMap,
    base_url: &str,
    prompt_id: &str,
    max_attempts: u32,
) -> Result<Value, ApiError> {
    let history_url = format!("{base_url}/history/{prompt_id}");
    let mut last_body = Value::Null;
    for _ in 0..max_attempts.max(1) {
        let response = client
            .get(&history_url)
            .headers(headers.clone())
            .send()
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    format!("轮询 ComfyUI 历史失败: {err}"),
                )
            })?;
        let status = response.status();
        let text = response.text().await.map_err(|err| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("读取 ComfyUI 历史响应失败: {err}"),
            )
        })?;
        if !status.is_success() {
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("ComfyUI 历史接口返回错误({status}): {}", text.trim()),
            ));
        }
        let payload = serde_json::from_str::<Value>(&text).map_err(|err| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("ComfyUI 历史接口返回非 JSON: {err}; body={text}"),
            )
        })?;
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
    Err(ApiError::new(
        StatusCode::BAD_GATEWAY,
        format!(
            "ComfyUI 执行超时，最后状态: {}",
            stringify_value_compact(&last_body)
        ),
    ))
}

fn extract_comfyui_items(
    base_url: &str,
    history: &Value,
    output_type: &ComponentReturnType,
) -> Vec<ComponentInvokeItem> {
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
        for field in ["images", "gifs", "videos", "audio"] {
            let Some(entries) = node_object.get(field).and_then(Value::as_array) else {
                continue;
            };
            for entry in entries {
                let Some(entry_object) = entry.as_object() else {
                    continue;
                };
                let filename = entry_object
                    .get("filename")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if filename.trim().is_empty() {
                    continue;
                }
                let subfolder = entry_object
                    .get("subfolder")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let file_type = entry_object
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("output");
                let url = format!(
                    "{}/view?filename={}&subfolder={}&type={}",
                    base_url,
                    urlencoding(filename),
                    urlencoding(subfolder),
                    urlencoding(file_type),
                );
                let (kind, mime_type) = match field {
                    "audio" => ("audio", "audio/mpeg"),
                    "videos" | "gifs" => ("video", "video/mp4"),
                    _ => ("image", "image/png"),
                };
                items.push(ComponentInvokeItem {
                    kind: kind.to_string(),
                    url,
                    text: String::new(),
                    mime_type: mime_type.to_string(),
                });
            }
        }
    }
    if items.is_empty() && matches!(output_type, ComponentReturnType::Text) {
        if let Some(text) = history
            .get("status")
            .and_then(|value| value.get("status_str"))
            .and_then(Value::as_str)
        {
            items.push(ComponentInvokeItem {
                kind: "text".to_string(),
                url: String::new(),
                text: text.to_string(),
                mime_type: "text/plain".to_string(),
            });
        }
    }
    items
}

async fn invoke_runninghub_component(
    item: &ComponentDefinition,
    config: &ComponentServiceConfig,
    params: &Map<String, Value>,
    agent_id: Option<&str>,
) -> Result<ComponentInvokeResult, ApiError> {
    validate_component_invoke_params(item, params)?;
    if item
        .workflow
        .raw_payload
        .get("legacy")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "该旧组件只有参数说明，没有保存完整 RunningHub 工作流；请在组件中心重新导入工作流并保存一次",
        ));
    }
    if item.workflow.request_url.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "RunningHub 组件缺少 requestUrl，请重新导入 curl/JSON 后保存",
        ));
    }
    let Some(mut payload) = item.workflow.raw_payload.as_object().cloned() else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "RunningHub 原始工作流格式无效",
        ));
    };
    let node_info_list = payload
        .get_mut("nodeInfoList")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "RunningHub 工作流缺少 nodeInfoList",
            )
        })?;
    for mapping in &item.workflow.parameter_mappings {
        let chosen = resolve_runtime_component_param_value(mapping, params)?;
        let Some(value) = chosen else {
            continue;
        };
        let coerced = coerce_value_for_mapping(value, &mapping.value_type)?;
        for entry in node_info_list.iter_mut() {
            let Some(obj) = entry.as_object_mut() else {
                continue;
            };
            let node_id = obj.get("nodeId").map(value_to_string).unwrap_or_default();
            let field_name = obj
                .get("fieldName")
                .map(value_to_string)
                .unwrap_or_default();
            if node_id == mapping.node_id && field_name == mapping.field_name {
                obj.insert("fieldValue".to_string(), coerced.clone());
            }
        }
    }
    if !item.workflow.app_id.trim().is_empty() && !payload.contains_key("appId") {
        payload.insert(
            "appId".to_string(),
            Value::String(item.workflow.app_id.clone()),
        );
    }
    payload.insert(
        "instanceType".to_string(),
        Value::String(item.workflow.runninghub_instance_type.clone()),
    );
    payload.insert(
        "usePersonalQueue".to_string(),
        Value::Bool(item.workflow.runninghub_use_personal_queue),
    );
    let request_payload = Value::Object(payload);
    let owner_agent_id = agent_id.map(str::trim).filter(|value| !value.is_empty());
    if should_run_runninghub_component_as_background_job(item, owner_agent_id) {
        return enqueue_runninghub_component_job(
            item,
            config,
            params,
            request_payload,
            owner_agent_id,
        );
    }
    let raw = request_runninghub_component_raw(item, config, &request_payload)
        .await
        .map_err(|err| ApiError::new(StatusCode::BAD_GATEWAY, err))?;
    build_runninghub_component_invoke_result(item, params, owner_agent_id, &raw).await
}

fn should_run_runninghub_component_as_background_job(
    item: &ComponentDefinition,
    owner_agent_id: Option<&str>,
) -> bool {
    owner_agent_id.is_some() && matches!(item.return_type, ComponentReturnType::Video)
}

fn should_run_comfyui_component_as_background_job(
    item: &ComponentDefinition,
    owner_agent_id: Option<&str>,
) -> bool {
    owner_agent_id.is_some() && matches!(item.return_type, ComponentReturnType::Video)
}

fn enqueue_comfyui_component_job(
    item: &ComponentDefinition,
    config: &ComponentServiceConfig,
    params: &Map<String, Value>,
    prompt_payload: Value,
    owner_agent_id: Option<&str>,
) -> Result<ComponentInvokeResult, ApiError> {
    let owner_agent_id = owner_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "异步组件任务缺少 agent id"))?;
    let provider_meta = build_component_provider_meta(item);
    let title = if item.name.trim().is_empty() {
        "组件任务".to_string()
    } else {
        item.name.trim().to_string()
    };
    let summary = format!("{title} 已提交，正在生成视频");
    let capability_key = if item.capability_binding.capability_key.trim().is_empty() {
        "generate.video".to_string()
    } else {
        item.capability_binding.capability_key.trim().to_string()
    };
    let capability_scope = if item.capability_binding.capability_scope.trim().is_empty() {
        "generic".to_string()
    } else {
        item.capability_binding.capability_scope.trim().to_string()
    };
    let provider_id = component_capability_provider_id(item);
    let job_type = component_return_type_to_media_kind(&item.return_type)
        .unwrap_or("video")
        .to_string();
    let local_job_id = format!("component-job-{}", Uuid::new_v4().simple());
    let initial_presentable = json!({
        "kind": "job_result",
        "title": title,
        "summary": summary,
        "status": "queued",
        "stage": "dispatching",
        "job_type": job_type,
        "job_id": local_job_id,
        "capability_key": capability_key,
        "capability_scope": capability_scope,
        "provider_id": provider_id,
        "provider_type": "component_skill",
        "route": "component_skill",
        "providerMeta": provider_meta.clone(),
        "metadata": {
            "componentName": item.name,
            "componentEnglishName": item.english_name,
            "componentType": item.component_type,
            "dispatchPending": true,
        }
    });
    let persisted = assignment_store::upsert_capability_job(CapabilityJobRecord {
        job_id: local_job_id.clone(),
        owner_agent_id: owner_agent_id.to_string(),
        capability_key: capability_key.clone(),
        capability_scope: capability_scope.clone(),
        provider_id: Some(provider_id.clone()),
        provider_type: Some("component_skill".to_string()),
        route: Some("component_skill".to_string()),
        title: Some(title.clone()),
        summary: Some(summary.clone()),
        status: "queued".to_string(),
        progress_percent: None,
        stage: Some("dispatching".to_string()),
        job_type: Some(job_type.clone()),
        input_payload: Value::Object(params.clone()),
        result_payload: json!({
            "presentable_result": initial_presentable.clone(),
            "request_payload": prompt_payload.clone(),
        }),
        error_message: None,
        metadata: json!({
            "componentName": item.name,
            "componentEnglishName": item.english_name,
            "componentType": item.component_type,
            "dispatchPending": true,
        }),
        created_at: String::new(),
        updated_at: String::new(),
        started_at: Some(current_unix_timestamp_string()),
        finished_at: None,
        last_heartbeat_at: Some(current_unix_timestamp_string()),
    })
    .map_err(|err| internal_error(format!("创建组件任务失败: {err}")))?;

    let item_owned = item.clone();
    let config_owned = config.clone();
    let prompt_payload_owned = prompt_payload.clone();
    let job_id_owned = local_job_id.clone();
    let owner_agent_id_owned = owner_agent_id.to_string();
    let capability_key_owned = capability_key.clone();
    let capability_scope_owned = capability_scope.clone();
    let provider_id_owned = provider_id.clone();
    let job_type_owned = job_type.clone();
    tokio::spawn(async move {
        let _ = assignment_store::upsert_capability_job(CapabilityJobRecord {
            status: "running".to_string(),
            stage: Some("submitting".to_string()),
            summary: Some(format!(
                "{} 正在提交到 ComfyUI",
                if item_owned.name.trim().is_empty() {
                    "组件任务"
                } else {
                    item_owned.name.trim()
                }
            )),
            last_heartbeat_at: Some(current_unix_timestamp_string()),
            ..persisted.clone()
        });

        let submit_result = async {
            let client = build_comfyui_client().map_err(|err| err.message)?;
            let headers = build_provider_headers(&config_owned).map_err(|err| err.message)?;
            let base_url =
                normalize_url_or_default(&config_owned.server_url, &default_comfyui_server_url());
            submit_comfyui_prompt(&client, &headers, &base_url, &prompt_payload_owned)
                .await
                .map_err(|err| err.message)
        }
        .await;

        match submit_result {
            Ok((provider_request_id, enqueue_raw)) => {
                let submitted_summary = format!(
                    "{} 已提交到 ComfyUI，正在生成视频",
                    if item_owned.name.trim().is_empty() {
                        "组件任务"
                    } else {
                        item_owned.name.trim()
                    }
                );
                let queued_presentable = bind_component_job_result_to_local_job(
                    &json!({
                        "kind": "job_result",
                        "title": persisted.title.clone().unwrap_or_else(|| "组件任务".to_string()),
                        "summary": submitted_summary,
                        "status": "running",
                        "stage": "submitted",
                        "job_type": job_type_owned,
                        "job_id": provider_request_id,
                        "capability_key": capability_key_owned,
                        "capability_scope": capability_scope_owned,
                        "provider_id": provider_id_owned,
                        "provider_type": "component_skill",
                        "route": "component_skill",
                        "providerMeta": build_component_provider_meta(&item_owned),
                        "metadata": {
                            "componentName": item_owned.name,
                            "componentEnglishName": item_owned.english_name,
                            "componentType": item_owned.component_type,
                            "providerRequestId": provider_request_id,
                        }
                    }),
                    &job_id_owned,
                    Some(&provider_request_id),
                );
                let _ = assignment_store::upsert_capability_job(CapabilityJobRecord {
                    job_id: job_id_owned,
                    owner_agent_id: owner_agent_id_owned,
                    capability_key: capability_key_owned,
                    capability_scope: capability_scope_owned,
                    provider_id: Some(provider_id_owned),
                    provider_type: Some("component_skill".to_string()),
                    route: Some("component_skill".to_string()),
                    title: persisted.title.clone(),
                    summary: Some(submitted_summary),
                    status: "running".to_string(),
                    progress_percent: None,
                    stage: Some("submitted".to_string()),
                    job_type: Some(job_type_owned),
                    input_payload: persisted.input_payload.clone(),
                    result_payload: json!({
                        "raw": enqueue_raw,
                        "presentable_result": queued_presentable,
                        "request_payload": prompt_payload_owned,
                    }),
                    error_message: None,
                    metadata: json!({
                        "componentName": item_owned.name,
                        "componentEnglishName": item_owned.english_name,
                        "componentType": item_owned.component_type,
                        "dispatchPending": false,
                        "providerRequestId": provider_request_id,
                    }),
                    created_at: persisted.created_at.clone(),
                    updated_at: String::new(),
                    started_at: persisted.started_at.clone(),
                    finished_at: None,
                    last_heartbeat_at: Some(current_unix_timestamp_string()),
                });
            }
            Err(error) => {
                let _ = assignment_store::upsert_capability_job(CapabilityJobRecord {
                    job_id: job_id_owned,
                    owner_agent_id: owner_agent_id_owned,
                    capability_key: capability_key_owned,
                    capability_scope: capability_scope_owned,
                    provider_id: Some(provider_id_owned),
                    provider_type: Some("component_skill".to_string()),
                    route: Some("component_skill".to_string()),
                    title: persisted.title.clone(),
                    summary: Some("视频生成失败".to_string()),
                    status: "failed".to_string(),
                    progress_percent: None,
                    stage: Some("failed".to_string()),
                    job_type: Some(job_type_owned),
                    input_payload: persisted.input_payload.clone(),
                    result_payload: json!({
                        "presentable_result": {
                            "kind": "error_result",
                            "title": persisted.title.clone().unwrap_or_else(|| "视频生成失败".to_string()),
                            "message": error.clone(),
                        },
                        "request_payload": prompt_payload_owned,
                    }),
                    error_message: Some(error),
                    metadata: json!({
                        "componentName": item_owned.name,
                        "componentEnglishName": item_owned.english_name,
                        "componentType": item_owned.component_type,
                        "dispatchPending": false,
                    }),
                    created_at: persisted.created_at.clone(),
                    updated_at: String::new(),
                    started_at: persisted.started_at.clone(),
                    finished_at: Some(current_unix_timestamp_string()),
                    last_heartbeat_at: Some(current_unix_timestamp_string()),
                });
            }
        }
    });

    Ok(ComponentInvokeResult {
        output_type: item.return_type.clone(),
        text: summary.clone(),
        items: Vec::new(),
        raw: json!({
            "job_id": local_job_id,
            "status": "queued",
            "message": summary,
            "provider_id": provider_id,
            "provider_type": "component_skill",
            "route": "component_skill",
        }),
        presentable_result: Some(initial_presentable),
        provider_meta: Some(provider_meta),
    })
}

fn enqueue_runninghub_component_job(
    item: &ComponentDefinition,
    config: &ComponentServiceConfig,
    params: &Map<String, Value>,
    request_payload: Value,
    owner_agent_id: Option<&str>,
) -> Result<ComponentInvokeResult, ApiError> {
    let owner_agent_id = owner_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "异步组件任务缺少 agent id"))?;
    let provider_meta = build_component_provider_meta(item);
    let title = if item.name.trim().is_empty() {
        "组件任务".to_string()
    } else {
        item.name.trim().to_string()
    };
    let summary = format!("{title} 已提交，正在生成视频");
    let capability_key = if item.capability_binding.capability_key.trim().is_empty() {
        "generate.video".to_string()
    } else {
        item.capability_binding.capability_key.trim().to_string()
    };
    let capability_scope = if item.capability_binding.capability_scope.trim().is_empty() {
        "generic".to_string()
    } else {
        item.capability_binding.capability_scope.trim().to_string()
    };
    let provider_id = component_capability_provider_id(item);
    let job_type = component_return_type_to_media_kind(&item.return_type)
        .unwrap_or("video")
        .to_string();
    let local_job_id = format!("component-job-{}", Uuid::new_v4().simple());
    let initial_presentable = json!({
        "kind": "job_result",
        "title": title,
        "summary": summary,
        "status": "queued",
        "stage": "dispatching",
        "job_type": job_type,
        "job_id": local_job_id,
        "capability_key": capability_key,
        "capability_scope": capability_scope,
        "provider_id": provider_id,
        "provider_type": "component_skill",
        "route": "component_skill",
        "providerMeta": provider_meta.clone(),
        "metadata": {
            "componentName": item.name,
            "componentEnglishName": item.english_name,
            "componentType": item.component_type,
            "dispatchPending": true,
        }
    });
    let persisted = assignment_store::upsert_capability_job(CapabilityJobRecord {
        job_id: local_job_id.clone(),
        owner_agent_id: owner_agent_id.to_string(),
        capability_key: capability_key.clone(),
        capability_scope: capability_scope.clone(),
        provider_id: Some(provider_id.clone()),
        provider_type: Some("component_skill".to_string()),
        route: Some("component_skill".to_string()),
        title: Some(title.clone()),
        summary: Some(summary.clone()),
        status: "queued".to_string(),
        progress_percent: None,
        stage: Some("dispatching".to_string()),
        job_type: Some(job_type.clone()),
        input_payload: Value::Object(params.clone()),
        result_payload: json!({
            "presentable_result": initial_presentable.clone(),
            "request_payload": request_payload.clone(),
        }),
        error_message: None,
        metadata: json!({
            "componentName": item.name,
            "componentEnglishName": item.english_name,
            "componentType": item.component_type,
            "dispatchPending": true,
        }),
        created_at: String::new(),
        updated_at: String::new(),
        started_at: Some(current_unix_timestamp_string()),
        finished_at: None,
        last_heartbeat_at: Some(current_unix_timestamp_string()),
    })
    .map_err(|err| internal_error(format!("创建组件任务失败: {err}")))?;

    let item_owned = item.clone();
    let config_owned = config.clone();
    let request_payload_owned = request_payload.clone();
    let job_id_owned = local_job_id.clone();
    let owner_agent_id_owned = owner_agent_id.to_string();
    let capability_key_owned = capability_key.clone();
    let capability_scope_owned = capability_scope.clone();
    let provider_id_owned = provider_id.clone();
    let job_type_owned = job_type.clone();
    tokio::spawn(async move {
        let _ = assignment_store::upsert_capability_job(CapabilityJobRecord {
            status: "running".to_string(),
            stage: Some("submitting".to_string()),
            summary: Some(format!(
                "{} 正在提交到云端",
                if item_owned.name.trim().is_empty() {
                    "组件任务"
                } else {
                    item_owned.name.trim()
                }
            )),
            last_heartbeat_at: Some(current_unix_timestamp_string()),
            ..persisted.clone()
        });

        match request_runninghub_component_raw(&item_owned, &config_owned, &request_payload_owned)
            .await
        {
            Ok(raw) => {
                let provider_meta = build_component_provider_meta(&item_owned);
                let response_text =
                    extract_generic_text(&raw).unwrap_or_else(|| stringify_value_compact(&raw));
                let async_presentable = build_component_async_job_presentable_result(
                    &item_owned,
                    &raw,
                    &response_text,
                    &provider_meta,
                );
                let provider_request_id = pick_component_text(
                    &raw,
                    &[
                        "request_id",
                        "requestId",
                        "task_id",
                        "taskId",
                        "id",
                        "job_id",
                        "jobId",
                    ],
                );
                let async_presentable = async_presentable.as_ref().map(|value| {
                    bind_component_job_result_to_local_job(
                        value,
                        &job_id_owned,
                        provider_request_id.as_deref(),
                    )
                });
                let items = extract_generic_output_items(&raw, &item_owned.return_type);
                let final_presentable = async_presentable.clone().or_else(|| {
                    build_component_presentable_result(
                        &item_owned,
                        &response_text,
                        &raw,
                        &items,
                        &provider_meta,
                    )
                });
                let remote_status = async_presentable
                    .as_ref()
                    .and_then(|value| pick_component_text(value, &["status", "state"]))
                    .unwrap_or_else(|| {
                        if final_presentable.is_some() {
                            "completed".to_string()
                        } else {
                            "running".to_string()
                        }
                    });
                let summary = if remote_status == "completed" && async_presentable.is_none() {
                    summarize_component_job_completion(
                        final_presentable.as_ref(),
                        &response_text,
                        persisted.summary.as_deref(),
                    )
                } else {
                    Some(response_text.clone())
                        .filter(|value| is_meaningful_component_output_text(value))
                        .or_else(|| persisted.summary.clone())
                };
                let _ = assignment_store::upsert_capability_job(CapabilityJobRecord {
                    job_id: job_id_owned,
                    owner_agent_id: owner_agent_id_owned,
                    capability_key: capability_key_owned,
                    capability_scope: capability_scope_owned,
                    provider_id: Some(provider_id_owned),
                    provider_type: Some("component_skill".to_string()),
                    route: Some("component_skill".to_string()),
                    title: persisted.title.clone(),
                    summary,
                    status: remote_status.clone(),
                    progress_percent: final_presentable.as_ref().and_then(|value| {
                        pick_component_number(
                            value,
                            &["progress_percent", "progressPercent", "progress", "percent"],
                        )
                    }),
                    stage: final_presentable
                        .as_ref()
                        .and_then(|value| {
                            pick_component_text(value, &["stage", "current_stage", "currentStage"])
                        })
                        .or_else(|| {
                            if remote_status == "completed" && async_presentable.is_none() {
                                Some("completed".to_string())
                            } else {
                                Some("submitted".to_string())
                            }
                        }),
                    job_type: Some(job_type_owned),
                    input_payload: persisted.input_payload.clone(),
                    result_payload: json!({
                        "raw": raw,
                        "presentable_result": final_presentable,
                        "request_payload": request_payload_owned,
                    }),
                    error_message: None,
                    metadata: json!({
                        "componentName": item_owned.name,
                        "componentEnglishName": item_owned.english_name,
                        "componentType": item_owned.component_type,
                        "dispatchPending": false,
                        "providerRequestId": provider_request_id,
                    }),
                    created_at: persisted.created_at.clone(),
                    updated_at: String::new(),
                    started_at: persisted.started_at.clone(),
                    finished_at: if remote_status == "completed" && async_presentable.is_none() {
                        Some(current_unix_timestamp_string())
                    } else {
                        None
                    },
                    last_heartbeat_at: Some(current_unix_timestamp_string()),
                });
            }
            Err(error) => {
                let _ = assignment_store::upsert_capability_job(CapabilityJobRecord {
                    job_id: job_id_owned,
                    owner_agent_id: owner_agent_id_owned,
                    capability_key: capability_key_owned,
                    capability_scope: capability_scope_owned,
                    provider_id: Some(provider_id_owned),
                    provider_type: Some("component_skill".to_string()),
                    route: Some("component_skill".to_string()),
                    title: persisted.title.clone(),
                    summary: Some("视频生成失败".to_string()),
                    status: "failed".to_string(),
                    progress_percent: None,
                    stage: Some("failed".to_string()),
                    job_type: Some(job_type_owned),
                    input_payload: persisted.input_payload.clone(),
                    result_payload: json!({
                        "presentable_result": {
                            "kind": "error_result",
                            "title": persisted.title.clone().unwrap_or_else(|| "视频生成失败".to_string()),
                            "message": error.clone(),
                        },
                        "request_payload": request_payload_owned,
                    }),
                    error_message: Some(error),
                    metadata: json!({
                        "componentName": item_owned.name,
                        "componentEnglishName": item_owned.english_name,
                        "componentType": item_owned.component_type,
                        "dispatchPending": false,
                    }),
                    created_at: persisted.created_at.clone(),
                    updated_at: String::new(),
                    started_at: persisted.started_at.clone(),
                    finished_at: Some(current_unix_timestamp_string()),
                    last_heartbeat_at: Some(current_unix_timestamp_string()),
                });
            }
        }
    });

    Ok(ComponentInvokeResult {
        output_type: item.return_type.clone(),
        text: summary.clone(),
        items: Vec::new(),
        raw: json!({
            "job_id": local_job_id,
            "status": "queued",
            "message": summary,
            "provider_id": provider_id,
            "provider_type": "component_skill",
            "route": "component_skill",
        }),
        presentable_result: Some(initial_presentable),
        provider_meta: Some(provider_meta),
    })
}

async fn request_runninghub_component_raw(
    item: &ComponentDefinition,
    config: &ComponentServiceConfig,
    payload: &Value,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|err| format!("创建 RunningHub 客户端失败: {err}"))?;
    let request_url = item.workflow.request_url.trim().to_string();
    let mut headers = build_provider_headers(config).map_err(|err| err.message)?;
    if !headers.contains_key(CONTENT_TYPE) {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }
    let response = client
        .post(&request_url)
        .headers(headers)
        .json(payload)
        .send()
        .await
        .map_err(|err| format!("请求 RunningHub 失败: {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取 RunningHub 响应失败: {err}"))?;
    if !status.is_success() {
        return Err(format!("RunningHub 返回错误({status}): {}", text.trim()));
    }
    Ok(serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::String(text)))
}

async fn build_runninghub_component_invoke_result(
    item: &ComponentDefinition,
    params: &Map<String, Value>,
    owner_agent_id: Option<&str>,
    raw: &Value,
) -> Result<ComponentInvokeResult, ApiError> {
    let localized = localize_component_video_outputs(
        item,
        raw,
        &extract_generic_output_items(raw, &item.return_type),
        owner_agent_id,
        Some(&Value::Object(params.clone())),
    )
    .await
    .map_err(internal_error)?;
    let items = localized.items;
    let response_text = if items.is_empty() {
        extract_generic_text(&localized.raw)
            .unwrap_or_else(|| stringify_value_compact(&localized.raw))
    } else {
        extract_generic_text(&localized.raw).unwrap_or_default()
    };
    let provider_meta = build_component_provider_meta(item);
    let presentable_result = build_component_async_job_presentable_result(
        item,
        &localized.raw,
        &response_text,
        &provider_meta,
    )
    .or_else(|| {
        build_component_presentable_result(
            item,
            &response_text,
            &localized.raw,
            &items,
            &provider_meta,
        )
    });
    Ok(ComponentInvokeResult {
        output_type: item.return_type.clone(),
        text: response_text,
        items,
        raw: localized.raw,
        presentable_result,
        provider_meta: Some(provider_meta),
    })
}

fn bind_component_job_result_to_local_job(
    value: &Value,
    local_job_id: &str,
    provider_request_id: Option<&str>,
) -> Value {
    let Some(object) = value.as_object() else {
        return value.clone();
    };
    let mut output = object.clone();
    output.insert(
        "job_id".to_string(),
        Value::String(local_job_id.to_string()),
    );
    output.insert("jobId".to_string(), Value::String(local_job_id.to_string()));
    let mut metadata = output
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Some(remote_id) = provider_request_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        metadata.insert(
            "providerRequestId".to_string(),
            Value::String(remote_id.to_string()),
        );
    }
    metadata.insert(
        "localJobId".to_string(),
        Value::String(local_job_id.to_string()),
    );
    output.insert("metadata".to_string(), Value::Object(metadata));
    Value::Object(output)
}

pub(crate) async fn refresh_component_capability_job(
    record: &CapabilityJobRecord,
) -> Result<Option<CapabilityJobRecord>, String> {
    let provider_type = record.provider_type.as_deref().unwrap_or_default().trim();
    let route = record.route.as_deref().unwrap_or_default().trim();
    if !provider_type.eq_ignore_ascii_case("component_skill")
        && !route.eq_ignore_ascii_case("component_skill")
    {
        return Ok(None);
    }
    let Some(component_key) = extract_component_job_component_key(record) else {
        return Ok(None);
    };
    let item = load_component_definition_by_lookup_key(&component_key)
        .map_err(|err| err.message)?
        .ok_or_else(|| format!("未找到组件定义: {component_key}"))?;
    let dispatch_pending = record
        .metadata
        .get("dispatchPending")
        .or_else(|| record.metadata.get("dispatch_pending"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let has_provider_request_id = extract_component_job_provider_request_id(record).is_some();
    if dispatch_pending && !has_provider_request_id {
        return Ok(None);
    }

    let Some(provider_request_id) = extract_component_job_provider_request_id(record) else {
        return Ok(None);
    };
    let configs = read_component_provider_configs()?;
    if item.provider_type == ComponentProviderType::Comfyui {
        let history_raw =
            request_comfyui_job_history(&configs.comfyui, &provider_request_id).await?;
        let base_url =
            normalize_url_or_default(&configs.comfyui.server_url, &default_comfyui_server_url());
        let localized = localize_component_video_outputs(
            &item,
            &history_raw,
            &extract_comfyui_items(&base_url, &history_raw, &item.return_type),
            Some(record.owner_agent_id.as_str()),
            Some(&record.input_payload),
        )
        .await?;
        let history_raw = localized.raw;
        let output_items = localized.items;
        let output_text = pick_component_text_deep(
            &history_raw,
            &["summary", "detail", "message", "msg", "status_str"],
        )
        .unwrap_or_default();
        let provider_meta = build_component_provider_meta(&item);
        let candidate_presentable_result = build_component_presentable_result(
            &item,
            &output_text,
            &history_raw,
            &output_items,
            &provider_meta,
        );
        let normalized_status = derive_comfyui_job_status(&history_raw, record.status.as_str());
        let error_message = extract_comfyui_job_error_message(Some(&history_raw)).or_else(|| {
            if normalized_status == "failed" {
                Some("ComfyUI 执行失败".to_string())
            } else {
                None
            }
        });
        let has_presentable_content = !output_items.is_empty()
            || is_meaningful_component_output_text(&output_text)
            || candidate_presentable_result
                .as_ref()
                .map(has_meaningful_component_presentable_result)
                .unwrap_or(false);
        let is_completed = normalized_status == "completed" && has_presentable_content;

        let mut refreshed = record.clone();
        refreshed.title = refreshed
            .title
            .clone()
            .or_else(|| Some(item.name.trim().to_string()).filter(|value| !value.is_empty()));
        refreshed.job_type = refreshed.job_type.clone().or_else(|| {
            component_return_type_to_media_kind(&item.return_type)
                .map(ToString::to_string)
                .or_else(|| {
                    Some(
                        match item.return_type {
                            ComponentReturnType::Text => "text",
                            ComponentReturnType::Image => "image",
                            ComponentReturnType::Video => "video",
                            ComponentReturnType::Audio => "audio",
                        }
                        .to_string(),
                    )
                })
        });
        refreshed.progress_percent = if is_completed {
            Some(100.0)
        } else {
            refreshed.progress_percent
        };
        refreshed.stage = pick_component_text_deep(
            &history_raw,
            &[
                "stage",
                "currentStage",
                "current_stage",
                "phase",
                "status_str",
            ],
        )
        .or_else(|| refreshed.stage.clone());
        refreshed.status = if is_completed {
            "completed".to_string()
        } else {
            normalized_status.clone()
        };
        refreshed.last_heartbeat_at = Some(current_unix_timestamp_string());
        if matches!(
            refreshed.status.as_str(),
            "running" | "processing" | "progress"
        ) && refreshed
            .started_at
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            refreshed.started_at = Some(current_unix_timestamp_string());
        }
        if matches!(refreshed.status.as_str(), "failed" | "error" | "cancelled") {
            refreshed.finished_at = Some(current_unix_timestamp_string());
            refreshed.error_message = error_message
                .clone()
                .or_else(|| refreshed.error_message.clone());
        } else if is_completed {
            refreshed.finished_at = Some(current_unix_timestamp_string());
            refreshed.error_message = None;
        }
        let mut result_payload = merge_component_job_result_payload(
            &record.result_payload,
            Some(&history_raw),
            if is_completed {
                Some(&history_raw)
            } else {
                None
            },
            if is_completed {
                candidate_presentable_result.as_ref()
            } else {
                None
            },
        );
        if let Some(object) = result_payload.as_object_mut() {
            object.insert("history_response".to_string(), history_raw.clone());
        }
        refreshed.result_payload = result_payload;
        refreshed.summary = if is_completed {
            summarize_component_job_completion(
                candidate_presentable_result.as_ref(),
                &output_text,
                refreshed.summary.as_deref(),
            )
            .or_else(|| refreshed.summary.clone())
        } else if matches!(refreshed.status.as_str(), "failed" | "error" | "cancelled") {
            error_message.or_else(|| refreshed.summary.clone())
        } else {
            summarize_component_job_progress(
                &history_raw,
                refreshed.summary.as_deref(),
                item.name.as_str(),
            )
            .or_else(|| refreshed.summary.clone())
        };

        let changed = refreshed.status != record.status
            || refreshed.progress_percent != record.progress_percent
            || refreshed.stage != record.stage
            || refreshed.summary != record.summary
            || refreshed.error_message != record.error_message
            || refreshed.finished_at != record.finished_at
            || refreshed.started_at != record.started_at
            || refreshed.result_payload != record.result_payload;
        if !changed {
            return Ok(None);
        }
        return assignment_store::upsert_capability_job(refreshed).map(Some);
    }
    if item.provider_type != ComponentProviderType::Runninghub {
        return Ok(None);
    }
    let outputs_raw = request_runninghub_job_endpoint(
        &configs.runninghub,
        RUNNINGHUB_OUTPUTS_ENDPOINT,
        &provider_request_id,
    )
    .await?;
    let localized = localize_component_video_outputs(
        &item,
        &outputs_raw,
        &extract_generic_output_items(&outputs_raw, &item.return_type),
        Some(record.owner_agent_id.as_str()),
        Some(&record.input_payload),
    )
    .await?;
    let outputs_raw = localized.raw;
    let output_items = localized.items;
    let output_text = extract_generic_text(&outputs_raw).unwrap_or_default();
    let provider_meta = build_component_provider_meta(&item);
    let candidate_presentable_result = build_component_presentable_result(
        &item,
        &output_text,
        &outputs_raw,
        &output_items,
        &provider_meta,
    );
    let should_query_status = output_items.is_empty()
        && !is_meaningful_component_output_text(&output_text)
        && !matches!(
            normalize_runninghub_job_status_from_value(&outputs_raw).as_deref(),
            Some("failed" | "cancelled")
        );
    let status_raw = if should_query_status {
        request_runninghub_job_endpoint(
            &configs.runninghub,
            RUNNINGHUB_STATUS_ENDPOINT,
            &provider_request_id,
        )
        .await
        .ok()
    } else {
        None
    };

    let normalized_status = derive_runninghub_job_status(
        &outputs_raw,
        status_raw.as_ref(),
        output_items.is_empty(),
        record.status.as_str(),
    );
    let stage = pick_component_text_deep(
        status_raw.as_ref().unwrap_or(&outputs_raw),
        &[
            "stage",
            "currentStage",
            "current_stage",
            "phase",
            "statusText",
            "status_text",
        ],
    )
    .or_else(|| {
        pick_component_text_deep(
            &outputs_raw,
            &[
                "stage",
                "currentStage",
                "current_stage",
                "phase",
                "statusText",
                "status_text",
            ],
        )
    });
    let progress_percent = pick_component_number_deep(
        status_raw.as_ref().unwrap_or(&outputs_raw),
        &["progressPercent", "progress_percent", "progress", "percent"],
    )
    .or_else(|| {
        pick_component_number_deep(
            &outputs_raw,
            &["progressPercent", "progress_percent", "progress", "percent"],
        )
    });
    let error_message = extract_runninghub_job_error_message(status_raw.as_ref())
        .or_else(|| extract_runninghub_job_error_message(Some(&outputs_raw)));
    let has_presentable_content = !output_items.is_empty()
        || is_meaningful_component_output_text(&output_text)
        || candidate_presentable_result
            .as_ref()
            .map(has_meaningful_component_presentable_result)
            .unwrap_or(false);
    let is_completed = normalized_status == "completed" && has_presentable_content;

    let mut refreshed = record.clone();
    refreshed.title = refreshed
        .title
        .clone()
        .or_else(|| Some(item.name.trim().to_string()).filter(|value| !value.is_empty()));
    refreshed.job_type = refreshed.job_type.clone().or_else(|| {
        component_return_type_to_media_kind(&item.return_type)
            .map(ToString::to_string)
            .or_else(|| {
                Some(
                    match item.return_type {
                        ComponentReturnType::Text => "text",
                        ComponentReturnType::Image => "image",
                        ComponentReturnType::Video => "video",
                        ComponentReturnType::Audio => "audio",
                    }
                    .to_string(),
                )
            })
    });
    refreshed.progress_percent = if is_completed {
        Some(100.0)
    } else {
        progress_percent.or(refreshed.progress_percent)
    };
    refreshed.stage = stage.or_else(|| refreshed.stage.clone());
    refreshed.status = if is_completed {
        "completed".to_string()
    } else {
        normalized_status.clone()
    };
    refreshed.last_heartbeat_at = Some(current_unix_timestamp_string());
    if matches!(
        refreshed.status.as_str(),
        "running" | "processing" | "progress"
    ) && refreshed
        .started_at
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        refreshed.started_at = Some(current_unix_timestamp_string());
    }
    if matches!(refreshed.status.as_str(), "failed" | "error" | "cancelled") {
        refreshed.finished_at = Some(current_unix_timestamp_string());
        refreshed.error_message = error_message
            .clone()
            .or_else(|| refreshed.error_message.clone());
    } else if is_completed {
        refreshed.finished_at = Some(current_unix_timestamp_string());
        refreshed.error_message = None;
    }
    refreshed.result_payload = merge_component_job_result_payload(
        &record.result_payload,
        status_raw.as_ref(),
        Some(&outputs_raw),
        if is_completed {
            candidate_presentable_result.as_ref()
        } else {
            None
        },
    );
    refreshed.summary = if is_completed {
        summarize_component_job_completion(
            candidate_presentable_result.as_ref(),
            &output_text,
            refreshed.summary.as_deref(),
        )
        .or_else(|| refreshed.summary.clone())
    } else if matches!(refreshed.status.as_str(), "failed" | "error" | "cancelled") {
        error_message.or_else(|| refreshed.summary.clone())
    } else {
        summarize_component_job_progress(
            status_raw.as_ref().unwrap_or(&outputs_raw),
            refreshed.summary.as_deref(),
            item.name.as_str(),
        )
        .or_else(|| refreshed.summary.clone())
    };

    let changed = refreshed.status != record.status
        || refreshed.progress_percent != record.progress_percent
        || refreshed.stage != record.stage
        || refreshed.summary != record.summary
        || refreshed.error_message != record.error_message
        || refreshed.finished_at != record.finished_at
        || refreshed.started_at != record.started_at
        || refreshed.result_payload != record.result_payload;
    if !changed {
        return Ok(None);
    }
    assignment_store::upsert_capability_job(refreshed).map(Some)
}

fn extract_component_job_component_key(record: &CapabilityJobRecord) -> Option<String> {
    pick_component_text_deep(
        &record.metadata,
        &[
            "componentEnglishName",
            "component_english_name",
            "componentName",
            "component_name",
        ],
    )
    .or_else(|| {
        pick_component_text_deep(
            &record.result_payload,
            &[
                "componentEnglishName",
                "component_english_name",
                "componentName",
                "component_name",
            ],
        )
    })
}

fn extract_component_job_provider_request_id(record: &CapabilityJobRecord) -> Option<String> {
    pick_component_text_deep(
        &record.metadata,
        &[
            "providerRequestId",
            "provider_request_id",
            "taskId",
            "task_id",
            "requestId",
            "request_id",
        ],
    )
    .or_else(|| {
        pick_component_text_deep(
            &record.result_payload,
            &[
                "providerRequestId",
                "provider_request_id",
                "taskId",
                "task_id",
                "requestId",
                "request_id",
            ],
        )
    })
}

async fn request_runninghub_job_endpoint(
    config: &ComponentServiceConfig,
    endpoint: &str,
    provider_request_id: &str,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(RUNNINGHUB_JOB_QUERY_TIMEOUT_SECS))
        .build()
        .map_err(|err| format!("创建 RunningHub 查询客户端失败: {err}"))?;
    let mut headers = build_provider_headers(config).map_err(|err| err.message)?;
    if !headers.contains_key(CONTENT_TYPE) {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }
    let url = format!("{}{}", config.server_url.trim_end_matches('/'), endpoint);
    let mut payload = Map::new();
    payload.insert(
        "taskId".to_string(),
        Value::String(provider_request_id.to_string()),
    );
    let api_key = config.api_key.trim();
    if !api_key.is_empty() {
        payload.insert("apiKey".to_string(), Value::String(api_key.to_string()));
    }
    let response = client
        .post(&url)
        .headers(headers)
        .json(&Value::Object(payload))
        .send()
        .await
        .map_err(|err| format!("请求 RunningHub 任务接口失败({url}): {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取 RunningHub 任务接口响应失败({url}): {err}"))?;
    if !status.is_success() {
        return Err(format!(
            "RunningHub 任务接口返回错误({status}, {url}): {}",
            text.trim()
        ));
    }
    Ok(serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::String(text)))
}

async fn request_comfyui_job_history(
    config: &ComponentServiceConfig,
    provider_request_id: &str,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(COMFYUI_JOB_QUERY_TIMEOUT_SECS))
        .build()
        .map_err(|err| format!("创建 ComfyUI 查询客户端失败: {err}"))?;
    let headers = build_provider_headers(config).map_err(|err| err.message)?;
    let base_url = normalize_url_or_default(&config.server_url, &default_comfyui_server_url());
    let history_url = format!("{base_url}/history/{provider_request_id}");
    let response = client
        .get(&history_url)
        .headers(headers)
        .send()
        .await
        .map_err(|err| format!("请求 ComfyUI 历史失败({history_url}): {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取 ComfyUI 历史响应失败({history_url}): {err}"))?;
    if !status.is_success() {
        return Err(format!(
            "ComfyUI 历史接口返回错误({status}, {history_url}): {}",
            text.trim()
        ));
    }
    let payload = serde_json::from_str::<Value>(&text)
        .map_err(|err| format!("ComfyUI 历史接口返回非 JSON({history_url}): {err}; body={text}"))?;
    Ok(payload.get(provider_request_id).cloned().unwrap_or(payload))
}

fn find_nested_value_by_keys<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(hit) = object.get(*key) {
                    return Some(hit);
                }
            }
            for nested in object.values() {
                if let Some(hit) = find_nested_value_by_keys(nested, keys) {
                    return Some(hit);
                }
            }
            None
        }
        Value::Array(items) => {
            for item in items {
                if let Some(hit) = find_nested_value_by_keys(item, keys) {
                    return Some(hit);
                }
            }
            None
        }
        _ => None,
    }
}

fn pick_component_text_deep(value: &Value, keys: &[&str]) -> Option<String> {
    let hit = find_nested_value_by_keys(value, keys)?;
    match hit {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn pick_component_number_deep(value: &Value, keys: &[&str]) -> Option<f64> {
    let hit = find_nested_value_by_keys(value, keys)?;
    match hit {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn normalize_runninghub_job_status(raw_status: &str) -> String {
    let lowered = raw_status.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return "queued".to_string();
    }
    match lowered.as_str() {
        "success" | "succeeded" | "succeed" | "done" | "completed" | "complete" | "finished"
        | "finish" => "completed".to_string(),
        "failed" | "fail" | "error" | "exception" => "failed".to_string(),
        "cancelled" | "canceled" | "cancel" | "aborted" => "cancelled".to_string(),
        "running" | "processing" | "progress" | "executing" | "working" | "in_progress"
        | "started" => "running".to_string(),
        "pending" | "queued" | "waiting" | "submitted" | "created" | "init" | "initializing" => {
            "queued".to_string()
        }
        _ if lowered.contains("fail") || lowered.contains("error") => "failed".to_string(),
        _ if lowered.contains("cancel") => "cancelled".to_string(),
        _ if lowered.contains("finish")
            || lowered.contains("complete")
            || lowered.contains("success") =>
        {
            "completed".to_string()
        }
        _ if lowered.contains("run")
            || lowered.contains("process")
            || lowered.contains("progress")
            || lowered.contains("execut") =>
        {
            "running".to_string()
        }
        _ if lowered.contains("queue")
            || lowered.contains("wait")
            || lowered.contains("pend")
            || lowered.contains("submit") =>
        {
            "queued".to_string()
        }
        _ => lowered,
    }
}

fn normalize_comfyui_job_status(raw_status: &str) -> String {
    let lowered = raw_status.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return "queued".to_string();
    }
    match lowered.as_str() {
        "success" | "succeeded" | "done" | "completed" | "complete" | "finished" | "finish" => {
            "completed".to_string()
        }
        "error" | "failed" | "failure" | "cancelled" | "canceled" => "failed".to_string(),
        _ if lowered.contains("error")
            || lowered.contains("fail")
            || lowered.contains("cancel")
            || lowered.contains("timeout") =>
        {
            "failed".to_string()
        }
        _ if lowered.contains("queue")
            || lowered.contains("wait")
            || lowered.contains("pend")
            || lowered.contains("submit") =>
        {
            "queued".to_string()
        }
        _ if lowered.contains("run")
            || lowered.contains("process")
            || lowered.contains("progress")
            || lowered.contains("execut") =>
        {
            "running".to_string()
        }
        _ => lowered,
    }
}

fn normalize_runninghub_job_status_from_value(value: &Value) -> Option<String> {
    pick_component_text_deep(
        value,
        &["taskStatus", "task_status", "status", "state", "phase"],
    )
    .map(|status| normalize_runninghub_job_status(&status))
}

fn normalize_comfyui_job_status_from_value(value: &Value) -> Option<String> {
    pick_component_text_deep(
        value,
        &[
            "status_str",
            "status",
            "state",
            "phase",
            "execution_status",
            "executionStatus",
        ],
    )
    .map(|status| normalize_comfyui_job_status(&status))
}

fn extract_runninghub_job_error_message(value: Option<&Value>) -> Option<String> {
    let Some(value) = value else {
        return None;
    };
    let message = pick_component_text_deep(
        value,
        &[
            "errorMessage",
            "error_message",
            "error",
            "reason",
            "detail",
            "message",
            "msg",
        ],
    )?;
    let code = pick_component_number_deep(value, &["code", "statusCode", "status_code"]);
    let success = find_nested_value_by_keys(value, &["success"]).and_then(Value::as_bool);
    let lowered = message.trim().to_ascii_lowercase();
    if lowered.is_empty()
        || lowered == "success"
        || lowered == "ok"
        || lowered == "queued"
        || lowered == "pending"
        || lowered == "running"
        || lowered == "processing"
    {
        return None;
    }
    if lowered.contains("fail")
        || lowered.contains("error")
        || lowered.contains("cancel")
        || lowered.contains("timeout")
        || lowered.contains("expired")
        || code.map(|item| item.abs() > f64::EPSILON).unwrap_or(false)
        || matches!(success, Some(false))
    {
        return Some(message);
    }
    None
}

fn extract_comfyui_job_error_message(value: Option<&Value>) -> Option<String> {
    let Some(value) = value else {
        return None;
    };
    let message = pick_component_text_deep(
        value,
        &[
            "exception_message",
            "exceptionMessage",
            "errorMessage",
            "error_message",
            "error",
            "reason",
            "detail",
            "message",
            "msg",
        ],
    )?;
    let lowered = message.trim().to_ascii_lowercase();
    if lowered.is_empty() {
        return None;
    }
    if lowered.contains("fail")
        || lowered.contains("error")
        || lowered.contains("cancel")
        || lowered.contains("timeout")
        || lowered.contains("exception")
    {
        return Some(message);
    }
    None
}

fn derive_runninghub_job_status(
    outputs_raw: &Value,
    status_raw: Option<&Value>,
    outputs_are_empty: bool,
    fallback_status: &str,
) -> String {
    if !outputs_are_empty {
        return "completed".to_string();
    }
    if let Some(status) = normalize_runninghub_job_status_from_value(outputs_raw) {
        return status;
    }
    if let Some(status) = status_raw.and_then(normalize_runninghub_job_status_from_value) {
        return status;
    }
    if extract_runninghub_job_error_message(Some(outputs_raw)).is_some()
        || status_raw
            .and_then(|value| extract_runninghub_job_error_message(Some(value)))
            .is_some()
    {
        return "failed".to_string();
    }
    normalize_runninghub_job_status(fallback_status)
}

fn derive_comfyui_job_status(history_raw: &Value, fallback_status: &str) -> String {
    let has_outputs = history_raw
        .get("outputs")
        .and_then(Value::as_object)
        .map(|outputs| !outputs.is_empty())
        .unwrap_or(false);
    if has_outputs {
        return "completed".to_string();
    }
    if let Some(status) = normalize_comfyui_job_status_from_value(history_raw) {
        return status;
    }
    if extract_comfyui_job_error_message(Some(history_raw)).is_some() {
        return "failed".to_string();
    }
    let fallback = normalize_comfyui_job_status(fallback_status);
    if fallback == "queued" {
        "running".to_string()
    } else {
        fallback
    }
}

fn merge_component_job_result_payload(
    existing: &Value,
    status_raw: Option<&Value>,
    outputs_raw: Option<&Value>,
    presentable_result: Option<&Value>,
) -> Value {
    let mut object = existing.as_object().cloned().unwrap_or_default();
    if let Some(previous_presentable) = object.get("presentable_result").cloned() {
        if previous_presentable
            .get("kind")
            .and_then(Value::as_str)
            .map(|kind| kind.eq_ignore_ascii_case("job_result"))
            .unwrap_or(false)
        {
            object.insert("job_result".to_string(), previous_presentable);
        }
    }
    if let Some(status_raw) = status_raw {
        object.insert("status_response".to_string(), status_raw.clone());
    }
    if let Some(outputs_raw) = outputs_raw {
        object.insert("outputs_response".to_string(), outputs_raw.clone());
    }
    if let Some(presentable_result) = presentable_result {
        object.insert("presentable_result".to_string(), presentable_result.clone());
    }
    Value::Object(object)
}

fn summarize_component_job_completion(
    presentable_result: Option<&Value>,
    output_text: &str,
    fallback_summary: Option<&str>,
) -> Option<String> {
    if let Some(presentable_result) = presentable_result {
        if let Some(summary) = pick_component_text(
            presentable_result,
            &["summary", "summaryText", "summary_text", "text", "title"],
        ) {
            if is_meaningful_component_output_text(&summary) {
                return Some(summary);
            }
        }
    }
    if is_meaningful_component_output_text(output_text) {
        return Some(output_text.trim().to_string());
    }
    fallback_summary
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn summarize_component_job_progress(
    value: &Value,
    fallback_summary: Option<&str>,
    component_name: &str,
) -> Option<String> {
    if let Some(summary) = pick_component_text_deep(
        value,
        &["summary", "detail", "message", "msg", "stage", "phase"],
    ) {
        let normalized = normalize_runninghub_job_status(&summary);
        if normalized != "completed" && normalized != "failed" && normalized != "cancelled" {
            return Some(summary);
        }
    }
    fallback_summary
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            let trimmed = component_name.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(format!("{trimmed} 正在处理中"))
            }
        })
}

fn is_meaningful_component_output_text(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lowered = trimmed.to_ascii_lowercase();
    !matches!(
        lowered.as_str(),
        "success" | "ok" | "queued" | "pending" | "running" | "processing" | "completed"
    )
}

fn has_meaningful_component_presentable_result(value: &Value) -> bool {
    match value
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "text_result" => pick_component_text(value, &["text", "summary", "summaryText"])
            .map(|text| is_meaningful_component_output_text(&text))
            .unwrap_or(false),
        "media_result" | "document_result" => true,
        _ => false,
    }
}

fn build_provider_headers(config: &ComponentServiceConfig) -> Result<HeaderMap, ApiError> {
    let mut headers = HeaderMap::new();
    let api_key = config.api_key.trim();
    if !api_key.is_empty() {
        let bearer = format!("Bearer {api_key}");
        let value = HeaderValue::from_str(&bearer).map_err(|err| {
            ApiError::new(StatusCode::BAD_REQUEST, format!("API Key 头无效: {err}"))
        })?;
        headers.insert(AUTHORIZATION, value);
    }
    Ok(headers)
}

fn extract_generic_output_items(
    raw: &Value,
    output_type: &ComponentReturnType,
) -> Vec<ComponentInvokeItem> {
    let mut urls = Vec::new();
    collect_urls(raw, &mut urls);
    urls.sort();
    urls.dedup();
    let (kind, mime_type) = match output_type {
        ComponentReturnType::Video => ("video", "video/mp4"),
        ComponentReturnType::Audio => ("audio", "audio/mpeg"),
        ComponentReturnType::Text => ("text", "text/plain"),
        ComponentReturnType::Image => ("image", "image/png"),
    };
    urls.into_iter()
        .map(|url| ComponentInvokeItem {
            kind: kind.to_string(),
            url,
            text: String::new(),
            mime_type: mime_type.to_string(),
        })
        .collect()
}

fn build_component_agent_chat_asset_url(agent_id: &str, relative_path: &str) -> String {
    format!("/api/management/agents/{agent_id}/chat-assets/file?path={relative_path}")
}

fn normalize_component_media_meta_label(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }
    let mut output = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric()
            || matches!(ch, '-' | '_')
            || matches!(ch as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x3040..=0x30FF)
        {
            output.push(ch);
        } else if (ch.is_whitespace() || matches!(ch, '/' | '\\' | ':' | '：' | '|'))
            && !output.ends_with('_')
        {
            output.push('_');
        }
    }
    let normalized = output.trim_matches('_').to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_component_media_save_target(raw: Option<&str>) -> &'static str {
    match raw.unwrap_or_default().trim().to_ascii_lowercase().as_str() {
        "agent_profile_meta" | "agent-profile-meta" | "profile_meta" | "self_media"
        | "agent_profile" => "agent_profile_meta",
        _ => "output",
    }
}

fn resolve_component_video_save_plan(
    owner_agent_id: &str,
    input_payload: Option<&Value>,
) -> Result<ComponentVideoSavePlan, String> {
    let workspace_root = path_resolver::workspaces_root()?.join(owner_agent_id.trim());
    let source_mode = input_payload
        .and_then(|value| pick_component_text_deep(value, &["source_mode", "sourceMode"]))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let explicit_save_target = input_payload.and_then(|value| {
        pick_component_text_deep(value, &["asset_save_target", "save_target", "saveTarget"])
    });
    let save_target = if normalize_component_media_save_target(explicit_save_target.as_deref())
        == "agent_profile_meta"
        || source_mode == "self_default"
    {
        "agent_profile_meta"
    } else {
        "output"
    };
    let explicit_owner_scope = input_payload.and_then(|value| {
        pick_component_text_deep(value, &["asset_owner_scope", "owner_scope", "ownerScope"])
    });
    let owner_scope = if explicit_owner_scope
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("self"))
        || save_target == "agent_profile_meta"
        || source_mode == "self_default"
    {
        "self".to_string()
    } else {
        "other".to_string()
    };
    let meta_label = input_payload
        .and_then(|value| {
            pick_component_text_deep(value, &["asset_meta_label", "meta_label", "metaLabel"])
                .or_else(|| pick_component_text_deep(value, &["purpose", "asset_purpose"]))
        })
        .or_else(|| {
            if owner_scope.eq_ignore_ascii_case("self") {
                Some("self_video".to_string())
            } else {
                None
            }
        });
    let normalized_label = normalize_component_media_meta_label(meta_label.as_deref())
        .unwrap_or_else(|| {
            if owner_scope.eq_ignore_ascii_case("self") {
                "self_video".to_string()
            } else {
                "component_video".to_string()
            }
        });
    let canonical_dir = if save_target == "agent_profile_meta" {
        workspace_root
            .join("agent_profile")
            .join("meta")
            .join("videos")
            .join(&normalized_label)
    } else {
        workspace_root.join("output")
    };
    let day_bucket = chrono::Local::now().format("%Y%m%d").to_string();
    let public_relative_dir = format!("uploads/component-center/videos/{day_bucket}");
    let public_dir = workspace_root.join("data").join(&public_relative_dir);
    Ok(ComponentVideoSavePlan {
        canonical_dir,
        public_dir,
        public_relative_dir,
        save_target: save_target.to_string(),
        owner_scope,
        meta_label: Some(normalized_label),
    })
}

fn infer_component_media_extension(
    url: &str,
    content_type: Option<&str>,
    fallback: &str,
) -> String {
    let content_type = content_type
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if content_type.contains("webm") {
        return "webm".to_string();
    }
    if content_type.contains("quicktime") || content_type.contains("mov") {
        return "mov".to_string();
    }
    if content_type.contains("gif") {
        return "gif".to_string();
    }
    if content_type.contains("mpeg")
        || content_type.contains("mp4")
        || content_type.contains("video/")
    {
        return "mp4".to_string();
    }
    let trimmed = url.trim();
    let without_query = trimmed.split(['?', '#']).next().unwrap_or(trimmed);
    let ext = Path::new(without_query)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    ext.unwrap_or_else(|| fallback.to_string())
}

async fn download_component_public_asset(
    client: &reqwest::Client,
    url: &str,
    public_dir: &Path,
    public_relative_dir: &str,
    agent_id: &str,
    file_prefix: &str,
    fallback_ext: &str,
) -> Result<Option<String>, String> {
    let response = match client.get(url).send().await {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            tracing::warn!(
                url = %url,
                status = %response.status(),
                "component public asset download returned non-success status"
            );
            return Ok(None);
        }
        Err(err) => {
            tracing::warn!(url = %url, error = %err, "component public asset download failed");
            return Ok(None);
        }
    };
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::warn!(
                url = %url,
                error = %err,
                "component public asset download body read failed"
            );
            return Ok(None);
        }
    };
    let ext = infer_component_media_extension(url, content_type.as_deref(), fallback_ext);
    let file_name = format!(
        "{file_prefix}_{}_{}.{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        Uuid::new_v4().simple(),
        ext
    );
    let public_relative_path = format!("{public_relative_dir}/{file_name}");
    let public_path = public_dir.join(&file_name);
    fs::write(&public_path, &bytes)
        .map_err(|err| format!("写入组件公共资源失败({}): {err}", public_path.display()))?;
    Ok(Some(build_component_agent_chat_asset_url(
        agent_id,
        &public_relative_path,
    )))
}

async fn best_effort_index_component_video_asset(
    agent_id: &str,
    item: &ComponentDefinition,
    source_url: &str,
    public_url: &str,
    saved_path: &Path,
    relative_path: &str,
    bytes: &[u8],
    mime_type: &str,
    owner_scope: &str,
    meta_label: Option<&str>,
    input_payload: Option<&Value>,
) {
    let prompt_text = input_payload
        .and_then(|value| pick_component_text_deep(value, &["prompt", "text", "message"]));
    let purpose = meta_label
        .map(ToString::to_string)
        .or_else(|| {
            input_payload
                .and_then(|value| pick_component_text_deep(value, &["purpose", "asset_purpose"]))
        })
        .or_else(|| Some(item.english_name.clone()).filter(|value| !value.trim().is_empty()));
    let metadata = json!({
        "componentName": item.name,
        "componentEnglishName": item.english_name,
        "providerType": match item.provider_type {
            ComponentProviderType::Comfyui => "comfyui",
            ComponentProviderType::Runninghub => "runninghub",
        },
        "remoteUrl": source_url,
        "localAssetUrl": public_url,
        "meta_label": meta_label,
        "save_target": if owner_scope.eq_ignore_ascii_case("self") { "agent_profile_meta" } else { "output" },
    });
    let sha256 = format!("{:x}", sha2::Sha256::digest(bytes));
    let byte_size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    let file_name = saved_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToString::to_string);
    let relative_path = Some(relative_path.replace('\\', "/"));
    let _ = assignment_store::upsert_media_asset(assignment_store::UpsertMediaAssetRecord {
        agent_id: Some(agent_id.to_string()),
        owner_scope: owner_scope.to_string(),
        asset_family: "video".to_string(),
        media_kind: "video".to_string(),
        source_tool: Some("component_center".to_string()),
        purpose,
        prompt_text,
        negative_prompt: input_payload.and_then(|value| {
            pick_component_text_deep(value, &["negative_prompt", "negativePrompt"])
        }),
        model: None,
        mime_type: mime_type.to_string(),
        sha256,
        width: None,
        height: None,
        byte_size,
        file_name,
        saved_path: Some(saved_path.to_string_lossy().to_string()),
        image_url: Some(public_url.to_string()),
        relative_path,
        vision_summary: None,
        tags: vec![
            "component".to_string(),
            "video".to_string(),
            owner_scope.to_ascii_lowercase(),
        ],
        metadata,
    });
}

async fn localize_component_video_outputs(
    item: &ComponentDefinition,
    raw: &Value,
    items: &[ComponentInvokeItem],
    owner_agent_id: Option<&str>,
    input_payload: Option<&Value>,
) -> Result<ComponentVideoLocalizationResult, String> {
    if !matches!(item.return_type, ComponentReturnType::Video) {
        return Ok(ComponentVideoLocalizationResult {
            raw: raw.clone(),
            items: items.to_vec(),
        });
    }
    let Some(agent_id) = owner_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(ComponentVideoLocalizationResult {
            raw: raw.clone(),
            items: items.to_vec(),
        });
    };
    let remote_items = items
        .iter()
        .enumerate()
        .filter(|(_, entry)| {
            entry.kind.eq_ignore_ascii_case("video")
                && (entry.url.starts_with("http://") || entry.url.starts_with("https://"))
        })
        .collect::<Vec<_>>();
    let remote_poster_items = items
        .iter()
        .enumerate()
        .filter(|(_, entry)| {
            entry.kind.eq_ignore_ascii_case("image")
                && (entry.url.starts_with("http://") || entry.url.starts_with("https://"))
        })
        .collect::<Vec<_>>();
    if remote_items.is_empty() && remote_poster_items.is_empty() {
        return Ok(ComponentVideoLocalizationResult {
            raw: raw.clone(),
            items: items.to_vec(),
        });
    }

    let plan = resolve_component_video_save_plan(agent_id, input_payload)?;
    fs::create_dir_all(&plan.canonical_dir).map_err(|err| {
        format!(
            "创建组件视频保存目录失败({}): {err}",
            plan.canonical_dir.display()
        )
    })?;
    fs::create_dir_all(&plan.public_dir).map_err(|err| {
        format!(
            "创建组件视频公开目录失败({}): {err}",
            plan.public_dir.display()
        )
    })?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|err| format!("创建组件视频下载客户端失败: {err}"))?;
    let mut next_items = items.to_vec();
    let mut saved_paths = Vec::new();
    let mut public_urls = Vec::new();
    let mut remote_urls = Vec::new();
    let mut next_poster_urls = Vec::new();

    for (index, entry) in remote_items {
        remote_urls.push(entry.url.clone());
        let response = match client.get(&entry.url).send().await {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                tracing::warn!(
                    component = %item.english_name,
                    url = %entry.url,
                    status = %response.status(),
                    "component video download returned non-success status"
                );
                continue;
            }
            Err(err) => {
                tracing::warn!(
                    component = %item.english_name,
                    url = %entry.url,
                    error = %err,
                    "component video download failed"
                );
                continue;
            }
        };
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(ToString::to_string)
            .unwrap_or_else(|| entry.mime_type.clone());
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(err) => {
                tracing::warn!(
                    component = %item.english_name,
                    url = %entry.url,
                    error = %err,
                    "component video download body read failed"
                );
                continue;
            }
        };
        let ext = infer_component_media_extension(&entry.url, Some(&content_type), "mp4");
        let file_name = format!(
            "component_video_{}_{}.{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            index,
            ext
        );
        let canonical_path = plan.canonical_dir.join(&file_name);
        let public_relative_path = format!("{}/{}", plan.public_relative_dir, file_name);
        let public_path = plan.public_dir.join(&file_name);
        fs::write(&canonical_path, &bytes)
            .map_err(|err| format!("写入组件视频文件失败({}): {err}", canonical_path.display()))?;
        fs::write(&public_path, &bytes)
            .map_err(|err| format!("写入组件视频公开缓存失败({}): {err}", public_path.display()))?;
        let public_url = build_component_agent_chat_asset_url(agent_id, &public_relative_path);
        if let Some(target) = next_items.get_mut(index) {
            target.url = public_url.clone();
            target.mime_type = if content_type.trim().is_empty() {
                entry.mime_type.clone()
            } else {
                content_type.clone()
            };
        }
        best_effort_index_component_video_asset(
            agent_id,
            item,
            &entry.url,
            &public_url,
            &canonical_path,
            &public_relative_path,
            bytes.as_ref(),
            if content_type.trim().is_empty() {
                &entry.mime_type
            } else {
                &content_type
            },
            &plan.owner_scope,
            plan.meta_label.as_deref(),
            input_payload,
        )
        .await;
        saved_paths.push(canonical_path.to_string_lossy().to_string());
        public_urls.push(public_url);
    }

    let localized_poster_urls = raw
        .get("poster_urls")
        .and_then(Value::as_array)
        .map(|posters| posters.to_vec())
        .unwrap_or_default();
    for poster in localized_poster_urls {
        let Some(url) = poster
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            next_poster_urls.push(Value::String(url.to_string()));
            continue;
        }
        if let Some(local_url) = download_component_public_asset(
            &client,
            url,
            &plan.public_dir,
            &plan.public_relative_dir,
            agent_id,
            "component_video_poster",
            "png",
        )
        .await?
        {
            next_poster_urls.push(Value::String(local_url));
        } else {
            next_poster_urls.push(Value::String(url.to_string()));
        }
    }

    for (_, entry) in remote_poster_items {
        if let Some(local_url) = download_component_public_asset(
            &client,
            &entry.url,
            &plan.public_dir,
            &plan.public_relative_dir,
            agent_id,
            "component_video_poster",
            "png",
        )
        .await?
        {
            next_poster_urls.push(Value::String(local_url));
        } else {
            next_poster_urls.push(Value::String(entry.url.clone()));
        }
    }

    next_items.retain(|entry| !entry.kind.eq_ignore_ascii_case("image"));

    if saved_paths.is_empty() {
        let mut next_raw = raw.clone();
        if let Some(object) = next_raw.as_object_mut() {
            if !next_poster_urls.is_empty() {
                object.insert("poster_urls".to_string(), Value::Array(next_poster_urls));
            }
        }
        return Ok(ComponentVideoLocalizationResult {
            raw: next_raw,
            items: next_items,
        });
    }

    let mut next_raw = raw.clone();
    if let Some(object) = next_raw.as_object_mut() {
        object.insert("saved_to".to_string(), json!(saved_paths));
        object.insert("video_urls".to_string(), json!(public_urls));
        object.insert("remote_video_urls".to_string(), json!(remote_urls));
        object.insert("save_target".to_string(), Value::String(plan.save_target));
        object.insert("owner_scope".to_string(), Value::String(plan.owner_scope));
        if !next_poster_urls.is_empty() {
            object.insert("poster_urls".to_string(), Value::Array(next_poster_urls));
        }
        if let Some(meta_label) = plan.meta_label {
            object.insert("meta_label".to_string(), Value::String(meta_label));
        }
    }

    Ok(ComponentVideoLocalizationResult {
        raw: next_raw,
        items: next_items,
    })
}

fn collect_urls(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                output.push(trimmed.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_urls(item, output);
            }
        }
        Value::Object(map) => {
            for (key, value) in map {
                if matches!(
                    key.as_str(),
                    "url" | "imageUrl" | "fileUrl" | "videoUrl" | "audioUrl" | "downloadUrl"
                ) {
                    if let Some(text) = value.as_str() {
                        let trimmed = text.trim();
                        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                            output.push(trimmed.to_string());
                        }
                    }
                }
                collect_urls(value, output);
            }
        }
        _ => {}
    }
}

fn extract_generic_text(raw: &Value) -> Option<String> {
    if let Some(text) = raw.get("message").and_then(Value::as_str) {
        return Some(text.trim().to_string());
    }
    if let Some(text) = raw.get("text").and_then(Value::as_str) {
        return Some(text.trim().to_string());
    }
    if let Some(text) = raw.get("msg").and_then(Value::as_str) {
        return Some(text.trim().to_string());
    }
    None
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.trim().to_string(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        other => stringify_value_compact(other),
    }
}

fn urlencoding(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect::<Vec<_>>(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_component_mapping(
        parameter_name: &str,
        label: &str,
        description: &str,
        required: bool,
    ) -> ComponentParameterMapping {
        ComponentParameterMapping {
            id: parameter_name.to_string(),
            node_id: "node".to_string(),
            field_name: parameter_name.to_string(),
            parameter_name: parameter_name.to_string(),
            label: label.to_string(),
            value_type: ComponentParamValueType::String,
            description: description.to_string(),
            default_value: Value::Null,
            required,
            options: Vec::new(),
        }
    }

    fn test_component_with_mappings(
        mappings: Vec<ComponentParameterMapping>,
    ) -> ComponentDefinition {
        ComponentDefinition {
            english_name: "image2video".to_string(),
            name: "图片生成视频".to_string(),
            return_type: ComponentReturnType::Video,
            workflow: ComponentWorkflowConfig {
                parameter_mappings: mappings,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn derive_component_type_from_slug() {
        assert_eq!(derive_component_type("myphotos"), "Myphotos");
        assert_eq!(derive_component_type("makeup-photos"), "MakeupPhotos");
        assert_eq!(derive_component_type("demo_skill_name"), "DemoSkillName");
    }

    #[test]
    fn parse_legacy_mapping_line() {
        let line =
            "- `prompt`（value） [内容参数]：string，必填；默认值：一个古装美女；说明：中文提示词";
        let mapping = parse_parameter_mapping_line(line).expect("mapping");
        assert_eq!(mapping.parameter_name, "prompt");
        assert_eq!(mapping.field_name, "value");
        assert!(mapping.required);
        assert_eq!(
            mapping.default_value,
            Value::String("一个古装美女".to_string())
        );
        assert_eq!(mapping.description, "中文提示词");
    }

    #[test]
    fn hide_long_prompt_defaults_from_skill_context() {
        let mapping = ComponentParameterMapping {
            id: "1".to_string(),
            node_id: "node".to_string(),
            field_name: "lyrics".to_string(),
            parameter_name: "lyrics".to_string(),
            label: "歌词".to_string(),
            value_type: ComponentParamValueType::String,
            description: "真正歌词正文".to_string(),
            default_value: Value::String(
                "[en]\n[Verse]\nThis is a very long default lyric template that should not leak into generated skill prompts."
                    .to_string(),
            ),
            required: true,
            options: Vec::new(),
        };
        assert!(!should_expose_default_value(&mapping));
        assert_eq!(
            build_mapping_example_value(&mapping),
            Value::String("请填写真正的歌词正文，支持分段换行".to_string())
        );
    }

    #[test]
    fn normalize_runninghub_job_status_variants() {
        assert_eq!(normalize_runninghub_job_status("success"), "completed");
        assert_eq!(normalize_runninghub_job_status("FAILED"), "failed");
        assert_eq!(normalize_runninghub_job_status("in_progress"), "running");
        assert_eq!(normalize_runninghub_job_status("pending"), "queued");
        assert_eq!(normalize_runninghub_job_status("cancelled"), "cancelled");
    }

    #[test]
    fn build_component_params_for_video_generate_prefers_non_empty_aliases() {
        let item = test_component_with_mappings(vec![
            test_component_mapping("image", "源图", "视频源图", true),
            test_component_mapping("text", "描述", "视频提示词", true),
        ]);
        let input = serde_json::json!({
            "image": "",
            "text": "",
            "image_url": "https://example.com/portrait.png",
            "prompt": "让她从远处走来并向主人请安"
        });

        let params = build_component_params_from_capability_input(&item, "video_generate", &input)
            .expect("params");

        assert_eq!(
            params.get("image"),
            Some(&Value::String(
                "https://example.com/portrait.png".to_string()
            ))
        );
        assert_eq!(
            params.get("text"),
            Some(&Value::String("让她从远处走来并向主人请安".to_string()))
        );
    }

    #[test]
    fn build_component_params_for_video_generate_does_not_push_image_into_numeric_video_param() {
        let mut image_mapping = test_component_mapping("image", "源图", "视频源图", true);
        image_mapping.value_type = ComponentParamValueType::String;
        let mut width_mapping = test_component_mapping("value", "value", "视频宽度默认就好", false);
        width_mapping.value_type = ComponentParamValueType::Number;
        let item = test_component_with_mappings(vec![image_mapping, width_mapping]);
        let input = serde_json::json!({
            "image_url": "/api/uploads/demo-file-id",
            "prompt": "让她微笑着鞠躬"
        });

        let params = build_component_params_from_capability_input(&item, "video_generate", &input)
            .expect("params");

        assert_eq!(
            params.get("image"),
            Some(&Value::String("/api/uploads/demo-file-id".to_string()))
        );
        assert!(!params.contains_key("value"));
    }

    #[test]
    fn build_component_params_for_video_generate_keeps_prompt_text_out_of_image_aliases() {
        let item = test_component_with_mappings(vec![
            test_component_mapping("image", "image", "加载上传图片，要求图像的分辨率清晰", true),
            test_component_mapping("text", "text", "图片生成视频提示词，要求描述详细 最好英文描述", true),
        ]);
        let input = serde_json::json!({
            "image_url": "http://127.0.0.1:60466/api/management/agents/demo/portrait/test.png",
            "prompt": "A graceful maid smiles at the camera and bows politely."
        });

        let params = build_component_params_from_capability_input(&item, "video_generate", &input)
            .expect("params");

        assert_eq!(
            params.get("image"),
            Some(&Value::String(
                "http://127.0.0.1:60466/api/management/agents/demo/portrait/test.png".to_string()
            ))
        );
        assert_eq!(
            params.get("text"),
            Some(&Value::String(
                "A graceful maid smiles at the camera and bows politely.".to_string()
            ))
        );
    }

    #[test]
    fn resolve_component_param_value_skips_empty_exact_value_and_uses_alias() {
        let mapping = test_component_mapping("image", "源图", "视频源图", true);
        let params = serde_json::json!({
            "image": "  ",
            "source_image": "https://example.com/source.png"
        })
        .as_object()
        .cloned()
        .expect("object");

        assert_eq!(
            resolve_component_param_value(&mapping, &params),
            Some(Value::String("https://example.com/source.png".to_string()))
        );
    }

    #[test]
    fn looks_like_relative_image_source_path_rejects_http_and_management_urls() {
        assert!(!looks_like_relative_image_source_path(
            "http://127.0.0.1:63453/api/management/agents/demo/portrait/test.png"
        ));
        assert!(!looks_like_relative_image_source_path(
            "/api/management/agents/demo/portrait/test.png"
        ));
        assert!(!looks_like_relative_image_source_path(
            "https://example.com/test.png"
        ));
        assert!(looks_like_relative_image_source_path(
            "agent_profile/portrait/test.png"
        ));
    }

    #[test]
    fn parse_component_management_media_reference_supports_full_and_relative_urls() {
        assert_eq!(
            parse_component_management_media_reference(
                "http://127.0.0.1:60466/api/management/agents/demo-agent/portrait/test.png?x=1"
            ),
            Some((
                "demo-agent".to_string(),
                "portrait",
                "test.png".to_string()
            ))
        );
        assert_eq!(
            parse_component_management_media_reference(
                "/api/management/agents/demo-agent/avatar/avatar.png"
            ),
            Some(("demo-agent".to_string(), "avatar", "avatar.png".to_string()))
        );
    }

    #[test]
    fn normalize_component_management_asset_url_rewrites_random_frontend_port() {
        assert_eq!(
            normalize_component_management_asset_url(
                "http://127.0.0.1:4310",
                "http://127.0.0.1:60466/api/management/agents/demo-agent/portrait/test.png?x=1"
            )
            .as_deref(),
            Some("http://127.0.0.1:4310/api/management/agents/demo-agent/portrait/test.png?x=1")
        );
        assert_eq!(
            normalize_component_management_asset_url(
                "http://127.0.0.1:4310",
                "/api/management/agents/demo-agent/portrait/test.png"
            )
            .as_deref(),
            Some("http://127.0.0.1:4310/api/management/agents/demo-agent/portrait/test.png")
        );
    }

    #[test]
    fn resolve_component_video_save_plan_defaults_self_video_to_agent_profile_meta() {
        let plan = resolve_component_video_save_plan(
            "agent-self",
            Some(&json!({
                "source_mode": "self_default",
                "meta_label": "今日自拍视频"
            })),
        )
        .expect("plan");

        assert_eq!(plan.save_target, "agent_profile_meta");
        assert_eq!(plan.owner_scope, "self");
        assert!(plan.canonical_dir.ends_with(
            Path::new("agent-self")
                .join("agent_profile")
                .join("meta")
                .join("videos")
                .join("今日自拍视频")
        ));
    }

    #[test]
    fn resolve_component_video_save_plan_keeps_normal_video_in_output() {
        let plan = resolve_component_video_save_plan(
            "agent-other",
            Some(&json!({
                "source_mode": "image_to_video"
            })),
        )
        .expect("plan");

        assert_eq!(plan.save_target, "output");
        assert_eq!(plan.owner_scope, "other");
        assert!(plan
            .canonical_dir
            .ends_with(Path::new("agent-other").join("output")));
    }

    #[test]
    fn build_component_presentable_result_for_video_uses_image_as_poster_only() {
        let item = ComponentDefinition {
            name: "问安视频".to_string(),
            english_name: "image2video".to_string(),
            return_type: ComponentReturnType::Video,
            capability_binding: ComponentCapabilityBinding {
                capability_key: "generate.video".to_string(),
                ..Default::default()
            },
            ..Default::default()
        };
        let result = build_component_presentable_result(
            &item,
            "视频已生成",
            &json!({
                "poster_urls": [
                    "/api/management/agents/demo-agent/chat-assets/file?path=uploads/component-center/videos/20260327/poster.png"
                ]
            }),
            &[
                ComponentInvokeItem {
                    kind: "image".to_string(),
                    url: "http://127.0.0.1:8188/view?filename=preview.png".to_string(),
                    text: String::new(),
                    mime_type: "image/png".to_string(),
                },
                ComponentInvokeItem {
                    kind: "video".to_string(),
                    url: "/api/management/agents/demo-agent/chat-assets/file?path=uploads/component-center/videos/20260327/result.mp4".to_string(),
                    text: "问安视频".to_string(),
                    mime_type: "video/mp4".to_string(),
                },
            ],
            &json!({
                "providerType": "component_skill"
            }),
        )
        .expect("presentable result");

        let object = result.as_object().expect("object");
        assert_eq!(
            object.get("kind").and_then(Value::as_str),
            Some("media_result")
        );
        assert_eq!(
            object.get("mediaType").and_then(Value::as_str),
            Some("video")
        );
        let items = object
            .get("items")
            .and_then(Value::as_array)
            .expect("items");
        assert_eq!(items.len(), 1);
        let first = items[0].as_object().expect("first item");
        assert_eq!(
            first
                .get("asset")
                .and_then(Value::as_object)
                .and_then(|asset| asset.get("uri"))
                .and_then(Value::as_str),
            Some(
                "/api/management/agents/demo-agent/chat-assets/file?path=uploads/component-center/videos/20260327/result.mp4"
            )
        );
        assert_eq!(
            first
                .get("posterAsset")
                .and_then(Value::as_object)
                .and_then(|asset| asset.get("uri"))
                .and_then(Value::as_str),
            Some(
                "/api/management/agents/demo-agent/chat-assets/file?path=uploads/component-center/videos/20260327/poster.png"
            )
        );
    }

    #[test]
    fn bind_component_job_result_keeps_local_job_id() {
        let source = serde_json::json!({
            "kind": "job_result",
            "job_id": "remote-task-1",
            "status": "queued",
            "metadata": {
                "componentEnglishName": "image2video"
            }
        });
        let bound =
            bind_component_job_result_to_local_job(&source, "local-job-1", Some("remote-task-1"));
        assert_eq!(
            bound.get("job_id").and_then(Value::as_str),
            Some("local-job-1")
        );
        assert_eq!(
            bound.get("jobId").and_then(Value::as_str),
            Some("local-job-1")
        );
        assert_eq!(
            bound
                .get("metadata")
                .and_then(Value::as_object)
                .and_then(|meta| meta.get("providerRequestId"))
                .and_then(Value::as_str),
            Some("remote-task-1")
        );
    }

    #[test]
    fn runninghub_video_component_uses_background_job_when_agent_present() {
        let item = ComponentDefinition {
            return_type: ComponentReturnType::Video,
            ..Default::default()
        };
        assert!(should_run_runninghub_component_as_background_job(
            &item,
            Some("agent-1"),
        ));
        assert!(!should_run_runninghub_component_as_background_job(
            &item, None
        ));
    }

    #[test]
    fn comfyui_video_component_uses_background_job_when_agent_present() {
        let item = ComponentDefinition {
            return_type: ComponentReturnType::Video,
            ..Default::default()
        };
        assert!(should_run_comfyui_component_as_background_job(
            &item,
            Some("agent-1"),
        ));
        assert!(!should_run_comfyui_component_as_background_job(&item, None));
    }

    #[test]
    fn derive_comfyui_job_status_prefers_outputs_completion() {
        let history = serde_json::json!({
            "outputs": {
                "9": {
                    "videos": [
                        { "filename": "demo.mp4", "subfolder": "", "type": "output" }
                    ]
                }
            }
        });
        assert_eq!(
            derive_comfyui_job_status(&history, "running"),
            "completed".to_string()
        );
    }
}
