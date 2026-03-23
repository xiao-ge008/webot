use std::fs;
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
use tokio::time::sleep;

use crate::error::ApiError;
use crate::path_resolver;
use crate::AppState;

const COMPONENT_DEFINITION_FILE: &str = "component-center.definition.json";
const COMPONENT_MANIFEST_FILE: &str = "components.manifest.json";
const COMPONENT_SKILL_FILE: &str = "SKILL.md";
const COMPONENT_PROMPT_CONTEXT_FILE: &str = "prompt_context.md";
const COMPONENT_SKILL_TOML_FILE: &str = "skill.toml";

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

#[derive(Debug, Serialize)]
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
            invoke_runninghub_component(&item, &configs.runninghub, &payload.params).await?
        }
    };
    Ok(Json(result))
}

fn internal_error(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message.into())
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
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "组件标识不能为空",
        ));
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
    if item.workflow.parameter_mappings.is_empty() {
        return Err("组件参数映射不能为空".to_string());
    }
    Ok(())
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
    let component_tsx_path = dir.join(format!("{}.tsx", item.component_type));

    let definition_content =
        serde_json::to_string_pretty(item).map_err(|err| format!("序列化组件定义失败: {err}"))?;
    let prompt_context = build_prompt_context_markdown(item);
    let skill_markdown = build_skill_markdown(item);
    let manifest_content = serde_json::to_string_pretty(&build_manifest_value(item))
        .map_err(|err| format!("序列化组件清单失败: {err}"))?;
    let skill_toml = build_skill_toml(item, &prompt_context);
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
                "invokeGuide": {
                    "renderType": item.component_type,
                    "componentName": item.english_name,
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
    } else if mapping.parameter_name.trim().eq_ignore_ascii_case("language")
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
    } else if mapping.parameter_name.trim().eq_ignore_ascii_case("language")
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
    lines.push("- 如果仍然走渲染通道并且参数已齐，可设置 `props.autoRun=true` 让组件打开后自动执行。".to_string());
    lines.push("- 不要把 `english_name` 写进渲染 `type`，也不要把 `component_type` 写进 `componentName`。".to_string());
    lines.push(String::new());
    lines.push("## 输出示例".to_string());
    lines.push(String::new());
    lines.push(format!("- 打开组件：`<UI_JSON>{render_example}</UI_JSON>`"));
    lines.push(format!("- 直接调用并回填结果：`<UI_JSON>{invoke_example}</UI_JSON>`"));
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
    lines.push("- 对参数还不完整、需要用户补充或希望用户手动确认的请求，优先走渲染通道。".to_string());
    lines.push("- 当用户已经明确要求“直接生成 / 直接调用 / 直接执行”时，只要必填参数齐了，就必须直接输出 `ComponentInvokeAction`，不要解释自己不会用组件，也不要说当前上下文没有入口。".to_string());
    lines.push("- `params` 中只能放当前组件声明过的参数；用户额外提到的 title / style / prompt / note 等字段，如果组件未声明，不要原样塞进去，也不要因为它们不存在映射就拒绝调用。".to_string());
    lines.push("- 可选参数缺失不会阻止执行；判断是否能直调时，只看必填参数是否已满足。".to_string());
    lines.push("- 若用户多给的是风格、氛围、主题、补充要求，而组件存在描述型字符串参数（如 `tags` / `prompt` / `description` / `text`），可把这些额外要求合并进去；否则忽略这些额外字段，继续调用。".to_string());
    lines.push("- 若用户要求直接执行，并且你仍选择渲染通道，可设置 `props.autoRun=true`。".to_string());
    lines.push("- 不要混淆 `component_type` 与 `english_name`：前者只用于渲染 `type`，后者只用于 `componentName`。".to_string());
    lines.push(String::new());
    lines.push("## 输出规范".to_string());
    lines.push(String::new());
    lines.push(format!("- 仅打开组件：`<UI_JSON>{render_example}</UI_JSON>`"));
    lines.push(format!("- 直接调用并回填结果：`<UI_JSON>{invoke_example}</UI_JSON>`"));
    lines.join("\n")
}

fn build_component_skill_tags(item: &ComponentDefinition) -> Vec<String> {
    let provider_tag = component_provider_tag(&item.provider_type);
    let capability_tag = component_capability_tag(&item.return_type);
    let capability_label = component_capability_label(&item.return_type);

    vec![
        "generated".to_string(),
        "component-center".to_string(),
        "component-skill".to_string(),
        provider_tag.to_string(),
        format!("provider:{provider_tag}"),
        capability_tag.to_string(),
        capability_label.to_string(),
    ]
}

fn build_skill_toml(item: &ComponentDefinition, prompt_context: &str) -> String {
    let prompt_literal = prompt_context.replace("'''", "'''\"\"\"'''");
    let tags_literal = serde_json::to_string(&build_component_skill_tags(item))
        .unwrap_or_else(|_| "[]".to_string());
    format!(
        "prompt_context = '''\n{prompt_literal}\n'''\n\n[skill]\nname = \"{skill_name}\"\nversion = \"0.1.0\"\ndescription = {description}\nauthor = \"\"\nlicense = \"\"\ntags = {tags_literal}\n\n[runtime]\ntype = \"promptonly\"\nentry = \"\"\n\n[tools]\nprovided = []\n\n[requirements]\ntools = []\ncapabilities = []\n\n[source]\ntype = \"native\"\n",
        skill_name = item.english_name,
        description = serde_json::to_string(&item.description).unwrap_or_else(|_| "\"\"".to_string()),
        tags_literal = tags_literal
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
        .filter_map(|mapping| match resolve_component_param_value(mapping, params) {
            Some(value) if !is_effectively_empty_value(&value) => None,
            _ => Some(mapping.parameter_name.clone()),
        })
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
    let base_url = normalize_url_or_default(&config.server_url, &default_comfyui_server_url());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("创建 ComfyUI 客户端失败: {err}"),
            )
        })?;
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

    let history = poll_comfyui_history(
        &client,
        &headers,
        &base_url,
        prompt_id,
        comfyui_poll_attempts_for_component(item),
    )
    .await?;
    let items = extract_comfyui_items(&base_url, &history, &item.return_type);
    let text = if items.is_empty() {
        "ComfyUI 已完成，但未发现可展示输出".to_string()
    } else {
        String::new()
    };
    Ok(ComponentInvokeResult {
        output_type: item.return_type.clone(),
        text,
        items,
        raw: history,
    })
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
            return Some(value);
        }
    }

    for alias in infer_component_param_aliases(mapping) {
        if let Some(value) = params.get(alias).cloned() {
            return Some(value);
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
            "src",
            "url",
            "path",
            "photo",
            "photo_url",
            "photoUrl",
        ]);
    }
    if is_component_text_mapping(mapping) {
        aliases.extend(["prompt", "text", "message", "description"]);
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
    if combined.contains("negative") || mapping.label.contains("负") || mapping.description.contains("负") {
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
    combined.contains("height") || mapping.label.contains('高') || mapping.description.contains('高')
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
    if summary.contains("video") || item.name.contains("视频") || item.description.contains("视频") {
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

    let (bytes, mime_type) =
        resolve_component_image_source(state, client, agent_id, &text).await?;
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
    let path = Path::new(trimmed);
    if path.is_absolute() || path.components().count() == 0 {
        return false;
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let has_image_extension = normalize_image_mime_type(extension).is_some();
    has_image_extension
        && (trimmed.contains('/') || trimmed.contains('\\'))
}

fn resolve_relative_component_image_path(
    roots: &[PathBuf],
    source: &str,
) -> Option<PathBuf> {
    let trimmed = source.trim();
    if !looks_like_relative_image_source_path(trimmed) {
        return None;
    }
    let relative = Path::new(trimmed);
    roots.iter()
        .map(|root| root.join(relative))
        .find(|candidate| candidate.is_file())
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
    if Path::new(trimmed).is_file() {
        let bytes = tokio::fs::read(trimmed).await.map_err(|err| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("读取组件图片参数失败({trimmed}): {err}"),
            )
        })?;
        let mime_type = detect_image_mime_from_path_or_bytes(Some(trimmed), &bytes).ok_or_else(|| {
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
        let mime_type = detect_image_mime_from_path_or_bytes(
            path.to_str(),
            &bytes,
        )
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("无法识别组件工作区图片格式: {}", path.display()),
            )
        })?;
        return Ok((bytes, mime_type.to_string()));
    }

    if looks_like_relative_image_source_path(trimmed) {
        let detail = if let Some(agent_id) = agent_id.map(str::trim).filter(|value| !value.is_empty()) {
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

    let (header, encoded) = trimmed.split_once(',').ok_or_else(|| {
        ApiError::new(StatusCode::BAD_REQUEST, "data:image 参数格式无效")
    })?;
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
        .post(format!(
            "{}/upload/image",
            base_url.trim_end_matches('/')
        ))
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|err| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("创建 RunningHub 客户端失败: {err}"),
            )
        })?;
    let request_url = item.workflow.request_url.trim().to_string();
    let mut headers = build_provider_headers(config)?;
    if !headers.contains_key(CONTENT_TYPE) {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }
    let response = client
        .post(&request_url)
        .headers(headers)
        .json(&Value::Object(payload))
        .send()
        .await
        .map_err(|err| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("请求 RunningHub 失败: {err}"),
            )
        })?;
    let status = response.status();
    let text = response.text().await.map_err(|err| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("读取 RunningHub 响应失败: {err}"),
        )
    })?;
    if !status.is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("RunningHub 返回错误({status}): {}", text.trim()),
        ));
    }
    let raw = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::String(text.clone()));
    let items = extract_generic_output_items(&raw, &item.return_type);
    let response_text = if items.is_empty() {
        extract_generic_text(&raw).unwrap_or_else(|| stringify_value_compact(&raw))
    } else {
        extract_generic_text(&raw).unwrap_or_default()
    };
    Ok(ComponentInvokeResult {
        output_type: item.return_type.clone(),
        text: response_text,
        items,
        raw,
    })
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
}
