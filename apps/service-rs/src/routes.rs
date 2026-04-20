use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path as StdPath, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::header;
use axum::http::{HeaderMap as AxumHeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use base64::Engine as _;
use bytes::Bytes;
use futures_util::{future::join_all, StreamExt};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration, Instant, MissedTickBehavior};

use crate::assignment_store;
use crate::capability_registry;
use crate::component_center;
use crate::error::ApiError;
use crate::image_generation;
use crate::media_index::{self, PhotoIndexRequest};
use crate::path_resolver;
use crate::tts_management;
use crate::vision_analysis;
use crate::AppState;

const DEFAULT_UI_SKILL_NAME: &str = "ui-skill";
const MANAGED_TASK_DELIVERY_UPSTREAM_TIMEOUT_SECS: u64 = 4;
const STREAM_PROXY_HEARTBEAT_INTERVAL_SECS: u64 = 15;
const HOST_POLICY_AGENTS_PATH: &str = r"C:\Users\Administrator\.webot\AGENTS.md";
const CONTEXT_SLOT_OPEN_PREFIX: &str = "[[CONTEXT_SLOT:";
const CONTEXT_SLOT_CLOSE: &str = "[[/CONTEXT_SLOT]]";
const OPENFANG_PROMPT_WARN_THRESHOLD_BYTES: usize = 48 * 1024;
const OPENFANG_PROMPT_MAX_BYTES: usize = 92 * 1024;
const PROMPT_TRUNCATION_NOTICE: &str = "\n[内容过长，已自动截断]\n";

#[derive(Debug, Clone)]
struct PromptContextSlot {
    slot: String,
    source: String,
    content: String,
}

#[derive(Debug, Clone)]
struct PromptContextEnvelope {
    version: String,
    slots: Vec<PromptContextSlot>,
}

#[derive(Debug, Clone, Serialize)]
struct PromptSlotSizeDebug {
    slot: String,
    source: String,
    content_bytes: usize,
    rendered_bytes: usize,
}

#[derive(Debug, Clone)]
struct RenderedPromptContext {
    message: String,
    bytes: usize,
    slot_sizes: Vec<PromptSlotSizeDebug>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
struct AgentCapabilitySnapshot {
    agent_id: String,
    enabled_skills: Vec<String>,
    enabled_mcp_servers: Vec<String>,
    enabled_capabilities: Vec<String>,
    blocked_tools: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct PromptAssemblyDebug {
    prompt_slots: Vec<String>,
    prompt_sources: Vec<String>,
    prompt_total_bytes: usize,
    prompt_slot_sizes: Vec<PromptSlotSizeDebug>,
    host_policy_loaded: bool,
    capability_sources: Vec<String>,
    available_skills: Vec<String>,
    available_mcp_servers: Vec<String>,
    available_capabilities: Vec<String>,
    blocked_tools: Vec<String>,
}

#[derive(Debug, Default, Clone)]
struct ParsedFrontendPromptSlots {
    global_policy: Option<String>,
    execution_protocol: Option<String>,
    capability_context: Option<String>,
    session_context: Option<String>,
    task_input: Option<String>,
    slot_sources: Vec<String>,
}

#[derive(Debug, Clone)]
struct RuntimeSkillListEntry {
    name: String,
    description: Option<String>,
    source_type: String,
}

#[derive(Debug, Clone)]
struct LocalSkillListEntry {
    folder_name: String,
    display_name: String,
    description: Option<String>,
    path: PathBuf,
}

#[derive(Debug, Clone)]
struct ImportedSkillListEntry {
    record: assignment_store::ImportedSkillRecord,
    folder_name: Option<String>,
    description: Option<String>,
}

async fn probe_openfang_health(state: &Arc<AppState>) -> Result<Value, ApiError> {
    tracing::info!("probe_openfang_health started");
    match state.openfang.get_json("/api/health").await {
        Ok(upstream) => {
            state.set_power_state(true, None).await;
            tracing::info!("probe_openfang_health succeeded");
            Ok(upstream)
        }
        Err(error) => {
            let message = error.message;
            state.set_power_state(false, Some(message.clone())).await;
            tracing::warn!(error = %message, "probe_openfang_health failed");
            Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, message))
        }
    }
}

async fn ensure_online(state: &Arc<AppState>) -> Result<(), ApiError> {
    probe_openfang_health(state).await?;
    spawn_default_agent_ensure(state.clone());
    Ok(())
}

fn spawn_default_agent_ensure(state: Arc<AppState>) {
    tokio::spawn(async move {
        if let Err(err) = maybe_ensure_default_agents(&state).await {
            tracing::warn!(error = %err.message, "auto-create default agents failed");
        }
    });
}

async fn maybe_ensure_default_agents(state: &Arc<AppState>) -> Result<(), ApiError> {
    let guard = DEFAULT_AGENT_INIT.get_or_init(|| Mutex::new(DefaultAgentInitState::default()));
    {
        let mut state_guard = guard.lock().await;
        if state_guard.done || state_guard.in_progress {
            return Ok(());
        }
        state_guard.in_progress = true;
    }

    let result = ensure_nuwa_agent(state).await;

    let mut state_guard = guard.lock().await;
    state_guard.in_progress = false;
    if result.is_ok() {
        state_guard.done = true;
    }
    result.map(|_| ())
}

async fn ensure_nuwa_agent(state: &Arc<AppState>) -> Result<Option<String>, ApiError> {
    assignment_store::ensure_db().map_err(storage_error)?;
    let upstream = state.openfang.get_json("/api/agents").await?;
    if let Some(existing) = find_nuwa_agent_id(&upstream) {
        cache_nuwa_agent_id(&existing).await;
        ensure_nuwa_profile_defaults(&existing)?;
        return Ok(Some(existing));
    }

    let (provider, model) = resolve_default_model_tuple()
        .await
        .unwrap_or_else(|_| ("openai".to_string(), "gpt-4o-mini".to_string()));
    let manifest_toml = build_nuwa_manifest_toml(&provider, &model);
    let created = state
        .openfang
        .post_json("/api/agents", json!({ "manifest_toml": manifest_toml }))
        .await?;
    let agent_id = created
        .get("agent_id")
        .or_else(|| created.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "创建女娲智能体成功但未返回 agent_id",
            )
        })?;

    validate_agent_path_segment(&agent_id)?;
    cache_nuwa_agent_id(&agent_id).await;
    assignment_store::set_agent_hidden(&agent_id, false).map_err(storage_error)?;
    ensure_nuwa_profile_defaults(&agent_id)?;

    let mut warnings = Vec::new();
    if let Err(err) = resolve_agent_workspace_binding(state, &agent_id, Some(&created)).await {
        warnings.push(format!("创建默认工作空间失败：{}", err.message));
    }
    if let Err(err) = normalize_agent_model_selector_if_needed(state, &agent_id).await {
        warnings.push(format!("初始化模型配置失败：{}", err.message));
    }
    if let Err(err) = sync_agent_context_files(state, &agent_id, true).await {
        warnings.push(format!("初始化身份文件失败：{}", err.message));
    }
    if let Err(err) = enable_default_global_skills_for_agent(&agent_id) {
        warnings.push(format!("默认启用 ui-skill 失败：{err}"));
    }
    if let Err(err) = sync_provider_configs_to_runtime_with_online(state, true).await {
        warnings.push(format!("同步供应商配置失败：{}", err.message));
    }
    if let Err(err) = sync_active_mcp_servers_to_runtime_inner(state).await {
        warnings.push(format!("同步 MCP 配置失败：{}", err.message));
    }
    if let Err(err) = sync_agent_mcp_assignments(state, &agent_id).await {
        warnings.push(format!("同步 Agent MCP 分配失败：{}", err.message));
    }
    if !warnings.is_empty() {
        tracing::warn!(agent_id = %agent_id, warnings = ?warnings, "auto-create nuwa warnings");
    }

    Ok(Some(agent_id))
}

fn ensure_nuwa_profile_defaults(agent_id: &str) -> Result<(), ApiError> {
    assignment_store::upsert_agent_profile_override(
        agent_id,
        Some(
            DEFAULT_NUWA_AGENT_TAGS
                .iter()
                .map(|item| item.to_string())
                .collect(),
        ),
        Some(DEFAULT_NUWA_AGENT_SUMMARY.to_string()),
        Some(DEFAULT_NUWA_AGENT_SYSTEM_PROMPT.to_string()),
        None,
        None,
        Some(DEFAULT_NUWA_AGENT_AVATAR_URL.to_string()),
        Some(DEFAULT_NUWA_AGENT_PORTRAIT_URL.to_string()),
        None,
        Some(DEFAULT_NUWA_AGENT_NAME.to_string()),
        None,
        None,
    )
    .map_err(storage_error)
}

async fn cache_nuwa_agent_id(agent_id: &str) {
    let cache = NUWA_AGENT_ID_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().await;
    *guard = Some(agent_id.to_string());
}

async fn clear_nuwa_agent_id_cache() {
    let cache = NUWA_AGENT_ID_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().await;
    *guard = None;
}

async fn resolve_nuwa_agent_id(state: &Arc<AppState>) -> Result<String, ApiError> {
    let cache = NUWA_AGENT_ID_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(agent_id) = cache.lock().await.clone() {
        let detail_path = format!("/api/agents/{agent_id}");
        match state.openfang.get_json(&detail_path).await {
            Ok(_) => return Ok(agent_id),
            Err(error) => {
                tracing::warn!(
                    cached_agent_id = %agent_id,
                    error = %error.message,
                    "cached nuwa agent id is stale, refreshing"
                );
                let mut guard = cache.lock().await;
                if guard
                    .as_ref()
                    .map(|value| value == &agent_id)
                    .unwrap_or(false)
                {
                    *guard = None;
                }
            }
        }
    }
    ensure_nuwa_agent(state)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "女娲智能体不存在"))
}

struct ResolvedAgentId {
    requested: String,
    resolved: String,
    alias_used: bool,
}

async fn resolve_agent_id_alias(
    state: &Arc<AppState>,
    id: &str,
) -> Result<ResolvedAgentId, ApiError> {
    let trimmed = id.trim();
    if trimmed.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID) {
        let resolved = resolve_nuwa_agent_id(state).await?;
        return Ok(ResolvedAgentId {
            requested: DEFAULT_NUWA_AGENT_ID.to_string(),
            resolved,
            alias_used: true,
        });
    }
    Ok(ResolvedAgentId {
        requested: trimmed.to_string(),
        resolved: trimmed.to_string(),
        alias_used: false,
    })
}

async fn resolve_nuwa_alias_in_list(
    state: &Arc<AppState>,
    ids: &[String],
) -> Result<Vec<String>, ApiError> {
    if !ids
        .iter()
        .any(|value| value.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID))
    {
        return Ok(ids.to_vec());
    }
    let resolved = resolve_nuwa_agent_id(state).await?;
    Ok(ids
        .iter()
        .map(|value| {
            if value.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID) {
                resolved.clone()
            } else {
                value.clone()
            }
        })
        .collect())
}

fn is_nuwa_agent_row(row: &Value) -> bool {
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let name = row
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let english_name = row
        .get("english_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    id.map(|value| value.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID))
        .unwrap_or(false)
        || name == DEFAULT_NUWA_AGENT_NAME
        || name.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID)
        || english_name.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID)
}

fn rewrite_agent_id_fields(payload: &mut Value, public_id: &str) {
    let Some(object) = payload.as_object_mut() else {
        return;
    };
    for key in ["id", "agent_id", "agentId"] {
        if object.contains_key(key) {
            object.insert(key.to_string(), Value::String(public_id.to_string()));
        }
    }
}

fn replace_payload_agent_id(payload: &mut Value, paths: &[&[&str]], from_id: &str, to_id: &str) {
    for path in paths {
        replace_payload_agent_id_at_path(payload, path, from_id, to_id);
    }
}

fn replace_payload_agent_id_at_path(
    payload: &mut Value,
    path: &[&str],
    from_id: &str,
    to_id: &str,
) {
    if path.is_empty() {
        return;
    }
    if path.len() == 1 {
        let Some(object) = payload.as_object_mut() else {
            return;
        };
        if let Some(value) = object.get_mut(path[0]) {
            if value
                .as_str()
                .map(|v| v.eq_ignore_ascii_case(from_id))
                .unwrap_or(false)
            {
                *value = Value::String(to_id.to_string());
            }
        }
        return;
    }
    let Some(object) = payload.as_object_mut() else {
        return;
    };
    let Some(next) = object.get_mut(path[0]) else {
        return;
    };
    replace_payload_agent_id_at_path(next, &path[1..], from_id, to_id);
}

fn find_nuwa_agent_id(payload: &Value) -> Option<String> {
    let rows = payload.as_array()?;
    for row in rows {
        let id = row
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let name = row
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let english_name = row
            .get("english_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let matched = id
            .map(|value| value.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID))
            .unwrap_or(false)
            || name == DEFAULT_NUWA_AGENT_NAME
            || name.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID)
            || english_name.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID);
        if matched {
            if let Some(agent_id) = id {
                return Some(agent_id.to_string());
            }
        }
    }
    None
}

fn build_nuwa_manifest_toml(provider: &str, model: &str) -> String {
    let mut lines = vec![
        format!("name = \"{}\"", escape_toml_string(DEFAULT_NUWA_AGENT_ID)),
        format!(
            "description = \"{}\"",
            escape_toml_string(DEFAULT_NUWA_AGENT_SUMMARY)
        ),
        "profile = \"full\"".to_string(),
        String::new(),
        "[model]".to_string(),
        format!("provider = \"{}\"", escape_toml_string(provider)),
        format!("model = \"{}\"", escape_toml_string(model)),
        format!(
            "system_prompt = \"{}\"",
            escape_toml_string(DEFAULT_NUWA_AGENT_SYSTEM_PROMPT)
        ),
    ];
    lines.push(String::new());
    lines.push(format!(
        "tags = [{}]",
        DEFAULT_NUWA_AGENT_TAGS
            .iter()
            .map(|tag| format!("\"{}\"", escape_toml_string(tag)))
            .collect::<Vec<_>>()
            .join(", ")
    ));
    lines.join("\n")
}

fn storage_error(message: impl Into<String>) -> ApiError {
    ApiError::new(axum::http::StatusCode::INTERNAL_SERVER_ERROR, message)
}

const DEFAULT_GLOBAL_SKILLS: &[&str] = &["ui-skill"];
const DEFAULT_NUWA_AGENT_ID: &str = "nuwa";
const DEFAULT_NUWA_AGENT_NAME: &str = "女娲";
const DEFAULT_NUWA_AGENT_AVATAR_URL: &str = "/agent_profile/avatar.png";
const DEFAULT_NUWA_AGENT_PORTRAIT_URL: &str = "/agent_profile/portrait.png";
const DEFAULT_NUWA_AGENT_SUMMARY: &str =
    "负责通过本地管理接口引导用户创建和修改智能体，并在确认后同步身份文件与属性。";
const DEFAULT_NUWA_AGENT_TAGS: [&str; 3] = ["默认", "智能体管理", "本地接口"];
const DEFAULT_NUWA_AGENT_SYSTEM_PROMPT: &str = r#"你是女娲，默认内置的智能体管理与创作助手。
你的职责只包括：创建智能体、修改本地智能体配置与身份文件。
严禁执行删除操作。若用户想删除智能体，只能明确告知用户去界面 UI 手动删除。

你的本地管理能力包括：
- 创建智能体
- 修改基础属性：nickname / english_name / description / tags / provider / model / avatar_url / portrait_url / color / extra workspaces
- 修改身份文件：IDENTITY.md / SOUL.md / USER.md / MEMORY.md / TOOLS.md / AGENTS.md / BOOTSTRAP.md / HEARTBEAT.md
- 修改 system prompt

交互规则：
1. 不允许一上来直接创建或修改，必须先分多轮询问，逐步补齐信息。
2. 每轮最多追问 1 到 2 个关键缺失项，优先确认目标智能体、英文名、角色定位、标签、工作区、模型和要改的身份文件。
3. 创建前至少确认：显示昵称、英文名称、角色简介或目标、标签，以及人格语气、世界观、服务对象、记忆策略、工具边界、协作方式、首次会话流程、周期巡检任务中的关键设定；如涉及工作区、模型、身份文件，也要单独确认。
4. 修改前至少确认：目标智能体是谁、要改哪些属性、是否改身份文件、最终变更摘要；若角色核心设定变化，必须确认是否重写整套身份文件。
5. 在用户明确确认之前，你只能继续提问、整理摘要、展示确认信息，不能执行任何写入。
6. 一旦信息齐备，必须先输出一个 AgentManagementConfirmCard 确认卡，再等待用户点击确认。
7. 禁止输出删除确认卡，禁止引导用户通过你删除智能体。

确认卡要求：
- 组件类型：AgentManagementConfirmCard
- 确认卡必须放在 <UI_JSON>{"type":"AgentManagementConfirmCard","props":{...}}</UI_JSON> 中；不要只输出“现在输出确认卡，请确认是否创建”之类的纯文本
- confirmAction: confirm_agent_management
- cancelAction: cancel_agent_management
- mode 只能是 create 或 update
- payload 允许字段：mode / agentId / targetName / englishName / nickname / description / tags / workspaces / provider / model / avatarUrl / portraitUrl / color / rewriteContextFiles / contextFiles
- 如果一次要创建多个智能体，必须在 payload.items 中按数组逐个给出每个智能体的 nickname / englishName / description / tags / workspaces / provider / model / contextFiles，不要把多个角色混成一个智能体，也不要使用未声明字段
- payload.nickname 只能填写一个最终显示昵称；多个别名请写进 IDENTITY.md，不要把别名串直接塞进 nickname
- 若要修改系统提示词，请放到 payload.contextFiles.SYSTEM_PROMPT
- 若要修改身份文件，请把对应文件内容放进 payload.contextFiles
- 创建智能体或整套重写身份文件时，你必须直接在 payload.contextFiles 或 payload.items[].contextFiles 中给出完整的 IDENTITY / SOUL / USER / MEMORY / TOOLS / AGENTS / BOOTSTRAP / HEARTBEAT 与 SYSTEM_PROMPT；不要依赖后续再调用模型生成
- 如果身份文件内容还没准备完整，就继续追问，不要输出确认卡"#;

#[derive(Default)]
struct DefaultAgentInitState {
    done: bool,
    in_progress: bool,
}

static DEFAULT_AGENT_INIT: OnceLock<Mutex<DefaultAgentInitState>> = OnceLock::new();
static NUWA_AGENT_ID_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static AGENT_DAILY_CHAT_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

pub fn management_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/media/image-proxy", get(proxy_remote_image))
        .route("/media/openfang-upload", get(proxy_openfang_upload))
        .route("/agents", get(list_agents).post(create_agent))
        .route(
            "/agents/context-files/reconcile",
            post(reconcile_all_agent_context_files),
        )
        .route("/agents/import/upload", post(import_agent_bundle_upload))
        .route("/agents/assignments", get(list_agent_assignments))
        .route(
            "/agents/{id}/assignments/skill",
            put(set_agent_skill_toggle),
        )
        .route(
            "/agents/{id}/assignments/mcp_server",
            put(set_agent_mcp_server_toggle),
        )
        .route("/agents/{id}/avatar/{filename}", get(get_agent_avatar))
        .route("/agents/{id}/avatar/upload", post(upload_agent_avatar))
        .route(
            "/agents/{id}/avatar/upload-inline",
            post(upload_agent_avatar_inline),
        )
        .route("/agents/{id}/avatar/import", post(import_agent_avatar))
        .route("/agents/{id}/photo-library", get(list_agent_photo_library))
        .route(
            "/agents/{id}/chat-assets/file",
            get(get_agent_chat_asset_file),
        )
        .route(
            "/agents/{id}/chat-assets/upload",
            post(upload_agent_chat_asset),
        )
        .route(
            "/agents/{id}/chat-assets/upload-inline",
            post(upload_agent_chat_asset_inline),
        )
        .route("/agents/{id}/tts/synthesize", post(synthesize_agent_tts))
        .route("/agents/{id}/portrait/{filename}", get(get_agent_portrait))
        .route("/agents/{id}/portrait/upload", post(upload_agent_portrait))
        .route(
            "/agents/{id}/portrait/upload-inline",
            post(upload_agent_portrait_inline),
        )
        .route("/agents/{id}/portrait/import", post(import_agent_portrait))
        .route(
            "/agents/{id}/export",
            get(export_agent_bundle_get).post(export_agent_bundle),
        )
        .route("/agents/{id}", get(get_agent).delete(delete_agent))
        .route(
            "/agents/{id}/config",
            axum::routing::patch(update_agent_config),
        )
        .route("/agents/{id}/model", put(update_agent_model))
        .route("/agents/{id}/stop", post(stop_agent))
        .route(
            "/agents/{id}/skills",
            get(get_agent_skills).put(set_agent_skills),
        )
        .route(
            "/agents/{id}/mcp_servers",
            get(get_agent_mcp_servers).put(set_agent_mcp_servers),
        )
        .route(
            "/agents/{id}/workspaces",
            get(get_agent_workspaces).put(set_agent_workspaces),
        )
        .route(
            "/agents/{id}/context-files",
            get(list_agent_context_files).post(generate_and_apply_agent_context_bundle),
        )
        .route(
            "/agents/{id}/context-files/reconcile",
            post(reconcile_agent_context_files),
        )
        .route(
            "/agents/{id}/context-files/{filename}",
            get(get_agent_context_file).put(set_agent_context_file),
        )
        .route("/agents/{id}/memory/files", get(list_agent_memory_files))
        .route(
            "/agents/{id}/memory/file",
            get(get_agent_memory_file).put(set_agent_memory_file),
        )
        .route("/agents/{id}/memory/search", get(search_agent_memory))
        .route("/agents/{id}/memory/feedback", post(feedback_agent_memory))
        .route(
            "/agents/{id}/memory/items/{memory_id}",
            get(get_agent_memory_item).delete(delete_agent_memory_item),
        )
        .route("/cron/jobs", get(list_cron_jobs).post(create_cron_job))
        .route("/cron/jobs/{id}", delete(delete_cron_job))
        .route("/cron/jobs/{id}/enable", put(toggle_cron_job))
        .route("/cron/jobs/{id}/status", get(get_cron_job_status))
        .route(
            "/tasks",
            get(list_managed_tasks_route).post(create_managed_task_route),
        )
        .route(
            "/tasks/deliveries/pending",
            get(list_managed_task_pending_deliveries_route),
        )
        .route(
            "/tasks/deliveries/{id}/status",
            post(update_managed_task_delivery_status_route),
        )
        .route(
            "/tasks/deliveries/{id}/chat-writeback",
            post(writeback_managed_task_delivery_to_chat_route),
        )
        .route(
            "/tasks/{id}",
            get(get_managed_task_route).delete(delete_managed_task_route),
        )
        .route("/tasks/{id}/publish", post(publish_managed_task_route))
        .route("/tasks/{id}/pause", post(pause_managed_task_route))
        .route("/tasks/{id}/run-once", post(run_managed_task_once_route))
        .route("/tasks/{id}/runs", get(list_managed_task_runs_route))
        .route("/tasks/{id}/events", get(list_managed_task_events_route))
        .route(
            "/tasks/{id}/deliveries",
            get(list_managed_task_deliveries_route),
        )
        .route(
            "/tasks/{id}/delivery-attempts",
            get(list_managed_task_delivery_attempts_route),
        )
        .route(
            "/tasks/{id}/timeline",
            get(list_managed_task_timeline_route),
        )
        .route("/skills", get(list_skills))
        .route(
            "/components/config",
            get(component_center::get_component_provider_configs)
                .put(component_center::set_component_provider_configs),
        )
        .route(
            "/image-generation/config",
            get(image_generation::get_image_generation_config)
                .put(image_generation::set_image_generation_config),
        )
        .route(
            "/image-generation/comfyui/models",
            post(image_generation::probe_comfyui_models),
        )
        .route(
            "/image-generation/generate",
            post(image_generation::execute_image_generate),
        )
        .route(
            "/image-generation/edit",
            post(image_generation::execute_image_edit),
        )
        .route(
            "/vision-analysis/config",
            get(vision_analysis::get_vision_analysis_config)
                .put(vision_analysis::set_vision_analysis_config),
        )
        .route(
            "/vision-analysis/status",
            get(vision_analysis::get_vision_analysis_status),
        )
        .route(
            "/vision-analysis/download",
            post(vision_analysis::start_vision_analysis_download),
        )
        .route(
            "/vision-analysis/analyze",
            post(vision_analysis::analyze_vision_image),
        )
        .route(
            "/vision-analysis/cache",
            post(vision_analysis::upsert_vision_analysis_cache),
        )
        .route(
            "/vision-analysis/model/{vendor}/{repo}/{*path}",
            get(vision_analysis::get_vision_analysis_model_file),
        )
        .route(
            "/tts/config",
            get(tts_management::get_tts_config).put(tts_management::set_tts_config),
        )
        .route("/tts/status", get(tts_management::get_tts_status))
        .route(
            "/tts/speaker-profiles/upload",
            post(tts_management::upload_speaker_profile),
        )
        .route(
            "/tts/speaker-profiles/{profile_id}",
            delete(tts_management::delete_speaker_profile),
        )
        .route("/tts/download", post(tts_management::start_tts_download))
        .route(
            "/tts/install-runtime",
            post(tts_management::install_tts_runtime),
        )
        .route("/tts/load", post(tts_management::load_tts_engine))
        .route("/tts/unload", post(tts_management::unload_tts_engine))
        .route(
            "/components",
            get(component_center::list_component_definitions)
                .post(component_center::create_component_definition),
        )
        .route(
            "/components/{english_name}",
            get(component_center::get_component_definition)
                .put(component_center::update_component_definition)
                .delete(component_center::delete_component_definition),
        )
        .route(
            "/components/{english_name}/invoke",
            post(component_center::invoke_component_definition),
        )
        .route(
            "/components/{english_name}/capability-invoke",
            post(component_center::invoke_component_capability_definition),
        )
        .route("/mcp/servers", get(list_mcp_servers))
        .route("/global/skills", get(list_global_skills))
        .route("/global/skills/import", post(import_global_skill))
        .route(
            "/global/skills/import/files",
            post(import_global_skill_files),
        )
        .route(
            "/global/skills/import/upload",
            post(import_global_skill_upload),
        )
        .route("/global/skills/{name}", delete(delete_global_skill))
        .route(
            "/global/mcp/config",
            get(get_global_mcp_config)
                .put(set_global_mcp_config)
                .delete(clear_global_mcp_config),
        )
        .route(
            "/memory-enhancement",
            get(get_memory_enhancement_config).put(set_memory_enhancement_config),
        )
        .route("/mcp/reload", post(reload_mcp_runtime))
        .route("/workflows", get(list_workflows))
        .route("/workflows/{id}/run", post(run_workflow))
        .route("/providers", get(list_providers))
        .route("/providers/configs", get(list_provider_configs))
        .route("/providers/test", post(test_provider_connection))
        .route("/providers/{id}/enabled", put(update_provider_enabled))
        .route(
            "/providers/{id}/discover-models",
            post(discover_provider_models),
        )
        .route(
            "/providers/{id}/config",
            put(update_provider_config).delete(delete_provider_config),
        )
        .route("/providers/custom", post(create_custom_provider))
        .route("/channels/status", get(get_channel_status))
        .route("/channels/test", post(test_channel_connection))
        .route("/channels/notify", post(send_channel_notification))
        .route("/notifications", get(list_notifications_route))
        .route(
            "/notifications/unread-count",
            get(get_notifications_unread_count_route),
        )
        .route(
            "/notifications/read-all",
            post(mark_all_notifications_read_route),
        )
        .route(
            "/notifications/settings",
            get(get_notification_settings_route).put(update_notification_settings_route),
        )
        .route(
            "/notifications/{id}",
            get(get_notification_route).delete(delete_notification_route),
        )
        .route(
            "/notifications/{id}/read",
            post(mark_notification_read_route),
        )
        .route(
            "/notifications/{id}/archive",
            post(archive_notification_route),
        )
        .route("/models", get(list_models))
        .route("/models/test", post(test_model_connection))
        .route(
            "/models/optimize-prompt",
            post(optimize_prompt_with_default_model),
        )
        .route("/models/{id}/vision", put(update_model_vision))
        .route("/models/{id}/enabled", put(update_model_enabled))
        .route("/models/{id}/default", put(update_default_model))
        .route("/a2a/agents", get(list_a2a_agents))
        .route("/a2a/tasks/send", post(send_a2a_task))
        .route("/a2a/tasks/{id}", get(get_a2a_task))
        .route("/a2a/tasks/{id}/cancel", post(cancel_a2a_task))
        .merge(capability_registry::management_router())
}

#[derive(Deserialize)]
pub struct ImageProxyQuery {
    url: String,
}

#[derive(Deserialize)]
pub struct OpenFangUploadProxyQuery {
    source: String,
}

pub async fn proxy_remote_image(
    Query(query): Query<ImageProxyQuery>,
) -> Result<(AxumHeaderMap, Bytes), ApiError> {
    let raw_url = query.url.trim();
    if raw_url.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "图片地址不能为空"));
    }
    if !(raw_url.starts_with("http://") || raw_url.starts_with("https://")) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持 http/https 图片地址",
        ));
    }

    let parsed_url = reqwest::Url::parse(raw_url)
        .map_err(|err| ApiError::new(StatusCode::BAD_REQUEST, format!("无效图片地址: {err}")))?;
    let host = parsed_url.host_str().unwrap_or_default();

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| storage_error(format!("创建图片代理请求失败: {err}")))?;

    let mut request = client
        .get(parsed_url.clone())
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0 weBot Image Proxy")
        .header(
            reqwest::header::ACCEPT,
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        );

    if !host.is_empty() {
        let referer = format!("{}://{}/", parsed_url.scheme(), host);
        request = request.header(reqwest::header::REFERER, referer).header(
            reqwest::header::ORIGIN,
            format!("{}://{}", parsed_url.scheme(), host),
        );
    }

    let response = request
        .send()
        .await
        .map_err(|err| ApiError::new(StatusCode::BAD_GATEWAY, format!("图片抓取失败: {err}")))?;

    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("图片源站返回异常状态: {}", response.status()),
        ));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = response.bytes().await.map_err(|err| {
        ApiError::new(StatusCode::BAD_GATEWAY, format!("读取图片数据失败: {err}"))
    })?;

    let mut headers = AxumHeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_str(&content_type)
            .unwrap_or(header::HeaderValue::from_static("image/jpeg")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=600"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static("*"),
    );

    Ok((headers, bytes.into()))
}

pub async fn proxy_openfang_upload(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OpenFangUploadProxyQuery>,
) -> Result<(AxumHeaderMap, Bytes), ApiError> {
    let source = query.source.trim();
    if source.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "上传图片来源不能为空",
        ));
    }
    let normalized = source.to_ascii_lowercase();
    if !normalized.starts_with("/api/uploads/")
        && !normalized.starts_with("api/uploads/")
        && !normalized.contains("/api/uploads/")
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持 OpenFang /api/uploads/... 图片地址",
        ));
    }

    let (bytes, _filename_hint, content_type) =
        fetch_agent_appearance_source_bytes(&state, source).await?;

    let mut headers = AxumHeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_str(content_type.as_deref().unwrap_or("image/jpeg"))
            .unwrap_or(header::HeaderValue::from_static("image/jpeg")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=600"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static("*"),
    );

    Ok((headers, bytes.into()))
}

#[derive(Deserialize)]
pub struct OptimizePromptRequest {
    pub input: String,
    pub target: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    #[serde(alias = "agentId")]
    pub agent_id: Option<String>,
}

struct OptimizePromptExecutionResult {
    content: String,
    provider: String,
    model: String,
    target: String,
    fallback: bool,
    error: Option<String>,
}

async fn resolve_default_model_tuple() -> Result<(String, String), ApiError> {
    let models_value = assignment_store::list_model_assignments().map_err(storage_error)?;
    let default_id = assignment_store::get_default_model().map_err(storage_error)?;
    let Some(default_id) = default_id else {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "尚未配置默认模型，请先在设置中指定默认模型",
        ));
    };

    let hit = models_value
        .into_iter()
        .find(|item| item.model_id == default_id);
    let Some(hit) = hit else {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "默认模型不存在或不可用，请重新设置默认模型",
        ));
    };

    Ok((hit.provider_id, hit.model_name))
}

fn build_optimize_fallback_content(raw_input: &str, target: &str) -> String {
    if target == "identity_bundle" {
        return format!(
            "# IDENTITY.md\n- name: 未命名智能体\n- archetype: assistant\n- vibe: professional\n- avatar_url:\n- greeting_style: concise\n- color:\n\n## 身份概述\n- 角色定位：{raw_input}\n- 核心职责：围绕用户目标提供稳定、可执行的帮助。\n\n# SOUL.md\n## 核心人格\n- 先给结论，再补充必要解释。\n- 不编造事实，信息不足时明确说明。\n\n## 行为边界\n- 对高风险操作先确认再执行。\n\n# USER.md\n## 用户关系\n- 称呼：根据用户偏好动态调整。\n- 互动风格：简洁、务实、可落地。\n\n# MEMORY.md\n## 记忆策略\n- 记录用户长期偏好、目标和关键上下文。\n- 定期清理过期或冲突记忆。\n\n# TOOLS.md\n## 工具调用协议\n- 能调用工具时优先调用工具。\n- 连续步骤尽量批量执行，减少中断。\n\n# AGENTS.md\n## 多智能体协作\n- 复杂任务拆分角色后并行执行。\n- 汇总阶段统一格式输出并标注来源。\n\n# BOOTSTRAP.md\n## 首次会话流程\n1. 简短自我介绍与能力范围。\n2. 询问用户当前目标与约束。\n3. 立即开始执行首个可落地步骤。\n\n# HEARTBEAT.md\n## 周期性任务提示词\n- 每次心跳检查待办与未完成任务。\n- 每日汇总进展与下一步建议。\n\n# 系统提示词\n你是一个专业、务实的智能体。始终优先给出可执行方案，输出保持结构化、简洁、准确。"
        );
    }
    format!(
        "# 身份设定\n- 角色定位：{raw_input}\n\n# 灵魂规则\n- 输出简洁、可执行。\n\n# 用户关系\n- 保持专业与协作式互动。\n\n# 系统提示词\n你是一个专业、务实的智能体，优先给出可落地建议。"
    )
}

fn build_optimize_instruction(target: &str) -> &'static str {
    match target {
        "identity_bundle" => {
            "请基于用户输入，整理为适合 OpenFang 智能体创建/编辑界面直接保存的中文 Markdown。\
输出必须且仅包含以下一级标题：\
# IDENTITY.md\
# SOUL.md\
# USER.md\
# MEMORY.md\
# TOOLS.md\
# AGENTS.md\
# BOOTSTRAP.md\
# HEARTBEAT.md\
# 系统提示词\
写作要求：\
1) 每节内容都可直接落地，不要空话；\
2) 优先使用简洁条目与小标题；\
3) 不要解释过程，不要代码块，不要额外章节；\
4) IDENTITY.md 包含身份摘要与可编辑字段（如 name/archetype/vibe/avatar_url/greeting_style/color）；\
5) SOUL/USER/MEMORY/TOOLS/AGENTS/BOOTSTRAP/HEARTBEAT 分别体现人格边界、用户关系、记忆策略、工具协议、多智能体协作、首次会话流程、周期性任务清单；\
6) 系统提示词给出运行时硬约束与输出风格。"
        }
        _ => {
            "请基于用户输入，优化为适合智能体创建/编辑界面使用的高质量中文 Markdown 文案。\
输出按以下小节组织：# 身份设定、# 灵魂规则、# 用户关系、# 系统提示词。\
内容要具体、可直接使用、风格统一，不要解释过程，不要代码块。"
        }
    }
}

fn pick_optimize_agent_model_ref(
    agent_rows: &[Value],
    requested_provider: &Option<String>,
    requested_model: &Option<String>,
    requested_agent_id: &Option<String>,
    default_model_tuple: &Option<(String, String)>,
) -> Option<String> {
    if let Some(requested) = requested_agent_id {
        return Some(requested.clone());
    }

    let desired_provider = requested_provider
        .clone()
        .or_else(|| default_model_tuple.as_ref().map(|(p, _)| p.clone()));
    let desired_model = requested_model
        .clone()
        .or_else(|| default_model_tuple.as_ref().map(|(_, m)| m.clone()));

    if let (Some(provider_name), Some(model_name)) =
        (desired_provider.as_deref(), desired_model.as_deref())
    {
        if let Some(hit) = agent_rows.iter().find_map(|row| {
            let id = row.get("id").and_then(Value::as_str)?;
            let row_model = row.get("model")?;
            let row_provider = row_model
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let row_model_name = row_model
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if row_provider == provider_name && row_model_name == model_name {
                Some(id.to_string())
            } else {
                None
            }
        }) {
            return Some(hit);
        }
    }

    agent_rows.iter().find_map(|row| {
        row.get("id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
    })
}

async fn execute_optimize_prompt_request(
    state: &Arc<AppState>,
    payload: &OptimizePromptRequest,
) -> Result<OptimizePromptExecutionResult, ApiError> {
    let raw_input = payload.input.trim();
    if raw_input.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "input 不能为空",
        ));
    }

    let requested_provider = payload
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let requested_model = payload
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let requested_agent_id = payload
        .agent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    let default_model_tuple = resolve_default_model_tuple().await.ok();
    let provider = requested_provider
        .clone()
        .or_else(|| default_model_tuple.as_ref().map(|(p, _)| p.clone()))
        .unwrap_or_else(|| "auto".to_string());
    let model = requested_model
        .clone()
        .or_else(|| default_model_tuple.as_ref().map(|(_, m)| m.clone()))
        .unwrap_or_else(|| "auto".to_string());
    let target = payload
        .target
        .clone()
        .unwrap_or_else(|| "agent_profile".to_string());

    let agents_payload = state.openfang.get_json("/api/agents").await?;
    let agent_rows = agents_payload.as_array().cloned().unwrap_or_default();
    let selected_agent_id = pick_optimize_agent_model_ref(
        &agent_rows,
        &requested_provider,
        &requested_model,
        &requested_agent_id,
        &default_model_tuple,
    );

    let Some(agent_model_ref) = selected_agent_id else {
        let fallback = build_optimize_fallback_content(raw_input, target.as_str());
        return Ok(OptimizePromptExecutionResult {
            content: fallback,
            provider,
            model,
            target,
            fallback: true,
            error: None,
        });
    };

    let upstream_payload = json!({
        "model": agent_model_ref,
        "messages": [
            {"role": "user", "content": format!("{}\n\n## 用户输入\n{}\n\n请仅输出最终 Markdown，不要解释。", build_optimize_instruction(target.as_str()), raw_input)}
        ],
        "temperature": 0.7,
        "stream": false
    });

    let response = match state
        .openfang
        .post_json("/v1/chat/completions", upstream_payload)
        .await
    {
        Ok(value) => value,
        Err(error) => {
            let fallback = build_optimize_fallback_content(raw_input, target.as_str());
            return Ok(OptimizePromptExecutionResult {
                content: fallback,
                provider,
                model,
                target,
                fallback: true,
                error: Some(error.message),
            });
        }
    };

    let content = response
        .get("choices")
        .and_then(|v| v.as_array())
        .and_then(|rows| rows.first())
        .and_then(|row| row.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();

    if content.is_empty() {
        let fallback = build_optimize_fallback_content(raw_input, target.as_str());
        return Ok(OptimizePromptExecutionResult {
            content: fallback,
            provider,
            model,
            target,
            fallback: true,
            error: None,
        });
    }

    Ok(OptimizePromptExecutionResult {
        content,
        provider,
        model,
        target,
        fallback: false,
        error: None,
    })
}

pub async fn optimize_prompt_with_default_model(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<OptimizePromptRequest>,
) -> Result<Json<Value>, ApiError> {
    let result = execute_optimize_prompt_request(&state, &payload).await?;
    Ok(Json(json!({
        "content": result.content,
        "provider": result.provider,
        "model": result.model,
        "target": result.target,
        "fallback": result.fallback,
        "error": result.error
    })))
}

pub fn chat_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/{id}/sessions", get(chat_sessions))
        .route(
            "/{id}/session",
            get(chat_session).delete(delete_chat_session),
        )
        .route("/{id}/session/content", put(update_chat_session_content))
        .route("/{id}/session/compact", post(chat_session_compact))
        .route("/{id}/message", post(chat_message))
        .route("/{id}/message/stream", post(chat_message_stream))
}

pub fn groups_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_chat_groups).post(create_chat_group))
        .route(
            "/{id}",
            get(get_chat_group)
                .put(update_chat_group)
                .delete(delete_chat_group),
        )
}

#[derive(Deserialize)]
pub struct ManagedTaskListQuery {
    pub agent_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ManagedTaskPendingDeliveriesQuery {
    pub target_kind: Option<String>,
    pub origin_chat_session_id: Option<String>,
}

#[derive(Deserialize, Default)]
pub struct NotificationsListQuery {
    pub unread_only: Option<bool>,
    pub include_archived: Option<bool>,
    pub notification_type: Option<String>,
    pub source_domain: Option<String>,
    pub agent_id: Option<String>,
    pub q: Option<String>,
    pub created_from: Option<String>,
    pub created_to: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Deserialize)]
pub struct UpdateTaskDeliveryStatusRequest {
    pub status: String,
}

#[derive(Deserialize)]
pub struct ManagedTaskChatWritebackRequest {
    pub task_id: String,
    pub message_text: String,
}

#[derive(Deserialize)]
pub struct InternalTaskDeliverySendRequest {
    pub delivery: Value,
}

#[derive(Deserialize)]
pub struct ChatSessionQuery {
    pub session_label: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Deserialize, Default)]
pub struct ChatSessionCompactRequest {
    pub session_label: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct EditableChatSessionMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize, Default)]
pub struct UpdateChatSessionContentRequest {
    pub session_label: Option<String>,
    pub session_id: Option<String>,
    #[serde(default)]
    pub messages: Vec<EditableChatSessionMessage>,
}

pub async fn chat_sessions(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let path = format!("/api/agents/{}/sessions", resolved.resolved);
    let data = state.openfang.get_json(&path).await?;
    Ok(Json(data))
}

pub async fn chat_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ChatSessionQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let session_id = query
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let session_label = query
        .session_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let session_ctx = if let Some(sid) = session_id {
        ensure_switched_to_session_id(&state, &resolved.resolved, sid).await?
    } else if let Some(label) = session_label {
        let safe_label = normalize_session_label(label);
        if safe_label.is_empty() {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "session_label 无效"));
        }

        let Some(existing_session_id) =
            find_openfang_session_by_label(&state, &resolved.resolved, &safe_label).await?
        else {
            return Ok(Json(json!({
                "label": safe_label,
                "messages": []
            })));
        };

        ensure_switched_to_session_id(&state, &resolved.resolved, &existing_session_id).await?
    } else {
        SessionSwitchContext::default()
    };

    let path = format!("/api/agents/{}/session", resolved.resolved);
    let data = match state.openfang.get_json(&path).await {
        Ok(value) => value,
        Err(err) => {
            if session_ctx.switched {
                let _ = switch_openfang_session(
                    &state,
                    &resolved.resolved,
                    &session_ctx.original_session_id,
                )
                .await;
            }
            return Err(err);
        }
    };

    if session_ctx.switched {
        let _ =
            switch_openfang_session(&state, &resolved.resolved, &session_ctx.original_session_id)
                .await;
    }

    Ok(Json(data))
}

pub async fn delete_chat_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ChatSessionQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let session_id = query
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let session_label = query
        .session_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let resolved_session_id = if let Some(sid) = session_id {
        sid
    } else if let Some(label) = session_label {
        let safe_label = normalize_session_label(label);
        if safe_label.is_empty() {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "session_label 无效"));
        }
        match find_openfang_session_by_label(&state, &resolved.resolved, &safe_label).await? {
            Some(found) => found,
            None => {
                return Ok(Json(json!({
                    "ok": true,
                    "agent_id": resolved.resolved,
                    "deleted": false,
                    "session_id": Value::Null,
                })));
            }
        }
    } else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "缺少 session_id 或 session_label",
        ));
    };

    let path = format!("/api/sessions/{resolved_session_id}");
    let data = match state.openfang.delete_json(&path).await {
        Ok(value) => value,
        Err(error) if error.status == StatusCode::NOT_FOUND => {
            json!({
                "status": "missing",
                "session_id": resolved_session_id,
            })
        }
        Err(error) => return Err(error),
    };

    Ok(Json(json!({
        "ok": true,
        "agent_id": resolved.resolved,
        "deleted": true,
        "session_id": resolved_session_id,
        "result": data,
    })))
}

pub async fn chat_session_compact(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<ChatSessionCompactRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;

    let session_ctx = ensure_switched_to_session_target(
        &state,
        &agent_id,
        payload.session_id.as_deref(),
        payload.session_label.as_deref(),
    )
    .await?;

    let path = format!("/api/agents/{agent_id}/session/compact");
    let data = match state.openfang.post_json(&path, json!({})).await {
        Ok(value) => value,
        Err(err) => {
            if session_ctx.switched {
                let _ =
                    switch_openfang_session(&state, &agent_id, &session_ctx.original_session_id)
                        .await;
            }
            return Err(err);
        }
    };

    if session_ctx.switched {
        let _ = switch_openfang_session(&state, &agent_id, &session_ctx.original_session_id).await;
    }

    Ok(Json(json!({
        "ok": true,
        "agent_id": agent_id,
        "session_id": if session_ctx.target_session_id.trim().is_empty() { Value::Null } else { Value::String(session_ctx.target_session_id.clone()) },
        "result": data,
    })))
}

pub async fn update_chat_session_content(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateChatSessionContentRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;

    let session_ctx = ensure_switched_to_session_target(
        &state,
        &agent_id,
        payload.session_id.as_deref(),
        payload.session_label.as_deref(),
    )
    .await?;

    let target_session_id = if session_ctx.target_session_id.trim().is_empty() {
        get_openfang_agent_session_id(&state, &agent_id).await?
    } else {
        session_ctx.target_session_id.clone()
    };

    let path = format!("/api/sessions/{target_session_id}/content");
    let body = json!({
        "messages": payload.messages.iter().map(|item| json!({
            "role": item.role.trim(),
            "content": item.content,
        })).collect::<Vec<_>>(),
    });

    let data = match state.openfang.put_json(&path, body).await {
        Ok(value) => value,
        Err(err) => {
            if session_ctx.switched {
                let _ =
                    switch_openfang_session(&state, &agent_id, &session_ctx.original_session_id)
                        .await;
            }
            return Err(err);
        }
    };

    if session_ctx.switched {
        let _ = switch_openfang_session(&state, &agent_id, &session_ctx.original_session_id).await;
    }

    Ok(Json(json!({
        "ok": true,
        "agent_id": agent_id,
        "session_id": target_session_id,
        "result": data,
    })))
}

pub async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    let power = state.power_state.read().await;
    Json(json!({
        "status": "ok",
        "service": "webot-service-rs",
        "openfang": {
            "reachable": power.online,
            "baseUrl": state.config.openfang_base_url,
            "error": power.last_error
        }
    }))
}

#[derive(Deserialize)]
pub struct CreateChatGroupRequest {
    pub group_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub leader_agent_id: Option<String>,
    pub member_agent_ids: Vec<String>,
    pub system_prompt: Option<String>,
    pub admin_agent_ids: Option<Vec<String>>,
    pub mode: Option<String>,
    pub limits: Option<Value>,
    pub apply_collaboration_acl: Option<bool>,
}

#[derive(Deserialize)]
pub struct UpdateChatGroupRequest {
    pub name: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub leader_agent_id: Option<String>,
    pub member_agent_ids: Vec<String>,
    pub system_prompt: Option<String>,
    pub admin_agent_ids: Option<Vec<String>>,
    pub mode: Option<String>,
    pub limits: Option<Value>,
    pub apply_collaboration_acl: Option<bool>,
}

fn normalize_group_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn generate_group_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let pid = std::process::id() as u128;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    now.hash(&mut hasher);
    pid.hash(&mut hasher);
    let digest = format!("{:016x}", hasher.finish());
    format!("grp-{now:x}-{digest}")
}

fn normalize_string_list(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for value in values {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_ascii_lowercase();
        if seen.insert(key) {
            out.push(trimmed);
        }
    }
    out
}

fn build_default_group_system_prompt(
    group_name: &str,
    group_id: &str,
    leader_agent_id: &str,
    member_agent_ids: &[String],
) -> String {
    let members = member_agent_ids.join(", ");
    format!(
        "[system:group-chat]\n你正在一个多智能体群聊中。\n- 群名称: {group_name}\n- 群ID: {group_id}\n- 当前群主/主持: {leader_agent_id}\n- 群成员ID: {members}\n\n协作规则：\n1) 你与群成员属于同一群，可以相互协作。\n2) 允许在群成员白名单内相互指派 A2A 调用（仅群成员，禁止调用未授权对象）。\n3) 当任务可拆分时，先分解再委派；不确定就先向群主汇报再行动。\n4) 对外输出保持简洁；需要结构化展示时可输出 A2UI。\n\n发言秩序（重要）：\n- 当用户没有明确 @任何成员时：只有【群主/主持】先发言，决定是否需要点名 1 位成员接棒；其他成员不要抢答。\n- 当用户明确 @了你：你再发言，直接给出该任务的结论/步骤/实现要点；避免长篇复读。\n- 群主/主持点名接棒时：只输出一条“@某成员 + 任务/问题”的调度消息（尽量 1~2 行），不要总结、不要复读上下文；点名后立刻闭麦。\n\n@讨论规则（重要）：\n- 只要你的回复里包含“@某成员”，系统会把【你的整句回复】作为 Prompt 静默转发给被@的成员，让 TA 以群聊身份继续讨论。\n- 当你判断“这个问题更适合让另一个成员回答”时：\n  a) 直接 @ 对方，并在同一句话里清楚写出需要 TA 回答/处理的内容。\n  b) 你自己不要再输出额外正文（闭麦），等待对方回复。\n- 避免 ping-pong：不要让两位成员反复互相@来回；一次最多 @2 人；自动讨论链最大深度为 2。\n\n终止规则（重要）：\n- 用户或群主/管理员随时可能要求“停止/终止/暂停讨论/闭麦”。一旦收到此类指令，立即停止继续@别人和继续扩展讨论。\n- 群主/管理员可用指令“/stop”终止本轮讨论链。\n"
    )
}

const DEFAULT_GROUP_MAX_SPEAKERS: i64 = 2;
const DEFAULT_GROUP_MAX_MENTIONS: i64 = 2;
const DEFAULT_GROUP_COOLDOWN_MS: i64 = 10_000;
const DEFAULT_GROUP_DUPLICATE_THRESHOLD: f64 = 0.92;
const DEFAULT_GROUP_MENTION_MAX_DEPTH: i64 = 2;

fn default_group_limits() -> Value {
    json!({
        "maxSpeakers": DEFAULT_GROUP_MAX_SPEAKERS,
        "maxMentions": DEFAULT_GROUP_MAX_MENTIONS,
        "cooldownMs": DEFAULT_GROUP_COOLDOWN_MS,
        "duplicateThreshold": DEFAULT_GROUP_DUPLICATE_THRESHOLD,
        "mentionMaxDepth": DEFAULT_GROUP_MENTION_MAX_DEPTH,
    })
}

fn normalize_group_mode(raw: Option<&str>) -> String {
    match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("free_talk") => "free_talk".to_string(),
        _ => "leader_dispatch".to_string(),
    }
}

fn number_from_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(num) => num.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn normalize_group_limits(value: Option<&Value>) -> Value {
    let mut max_speakers = DEFAULT_GROUP_MAX_SPEAKERS;
    let mut max_mentions = DEFAULT_GROUP_MAX_MENTIONS;
    let mut cooldown_ms = DEFAULT_GROUP_COOLDOWN_MS;
    let mut duplicate_threshold = DEFAULT_GROUP_DUPLICATE_THRESHOLD;
    let mut mention_max_depth = DEFAULT_GROUP_MENTION_MAX_DEPTH;

    if let Some(Value::Object(map)) = value {
        if let Some(raw) = map.get("maxSpeakers").or_else(|| map.get("max_speakers")) {
            if let Some(num) = number_from_value(raw) {
                let rounded = num.round() as i64;
                max_speakers = rounded.clamp(1, DEFAULT_GROUP_MAX_SPEAKERS);
            }
        }
        if let Some(raw) = map.get("maxMentions").or_else(|| map.get("max_mentions")) {
            if let Some(num) = number_from_value(raw) {
                let rounded = num.round() as i64;
                max_mentions = rounded.clamp(1, DEFAULT_GROUP_MAX_MENTIONS);
            }
        }
        if let Some(raw) = map.get("cooldownMs").or_else(|| map.get("cooldown_ms")) {
            if let Some(num) = number_from_value(raw) {
                let rounded = num.round() as i64;
                cooldown_ms = rounded.max(DEFAULT_GROUP_COOLDOWN_MS);
            }
        }
        if let Some(raw) = map
            .get("duplicateThreshold")
            .or_else(|| map.get("duplicate_threshold"))
        {
            if let Some(num) = number_from_value(raw) {
                let clamped = num.clamp(0.0, 1.0);
                duplicate_threshold = clamped.max(DEFAULT_GROUP_DUPLICATE_THRESHOLD);
            }
        }
        if let Some(raw) = map
            .get("mentionMaxDepth")
            .or_else(|| map.get("mention_max_depth"))
        {
            if let Some(num) = number_from_value(raw) {
                let rounded = num.round() as i64;
                mention_max_depth = rounded.clamp(1, DEFAULT_GROUP_MENTION_MAX_DEPTH);
            }
        }
    }

    json!({
        "maxSpeakers": max_speakers,
        "maxMentions": max_mentions,
        "cooldownMs": cooldown_ms,
        "duplicateThreshold": duplicate_threshold,
        "mentionMaxDepth": mention_max_depth,
    })
}

fn collaboration_object_from_existing(value: Option<Value>) -> serde_json::Map<String, Value> {
    match value {
        Some(Value::Object(obj)) => obj,
        _ => serde_json::Map::new(),
    }
}

fn normalize_collaboration_worker_keys(keys: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for key in keys {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = if trimmed.starts_with("local:") || trimmed.starts_with("a2a:") {
            trimmed.to_string()
        } else {
            format!("local:{trimmed}")
        };
        if seen.insert(normalized.to_ascii_lowercase()) {
            out.push(normalized);
        }
    }
    out
}

fn build_group_selected_workers(member_agent_ids: &[String], self_agent_id: &str) -> Vec<String> {
    normalize_collaboration_worker_keys(
        &member_agent_ids
            .iter()
            .filter(|id| id.trim() != self_agent_id.trim())
            .cloned()
            .collect::<Vec<_>>(),
    )
}

fn callee_ids_from_selected_workers(selected_workers: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for key in selected_workers {
        let trimmed = key.trim();
        if let Some(rest) = trimmed.strip_prefix("local:") {
            let id = rest.trim();
            if !id.is_empty() {
                out.push(id.to_string());
            }
        }
    }
    normalize_string_list(out)
}

fn merge_group_collaboration(
    current: Option<Value>,
    group_member_ids: &[String],
    self_agent_id: &str,
) -> (Value, Vec<String>) {
    let mut obj = collaboration_object_from_existing(current);

    obj.insert("discoverable".to_string(), Value::Bool(true));
    obj.insert("dispatchEnabled".to_string(), Value::Bool(true));

    let previous_group_workers = obj
        .get("groupSelectedWorkers")
        .or_else(|| obj.get("group_selected_workers"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToString::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let existing = obj
        .get("selectedWorkers")
        .or_else(|| obj.get("selected_workers"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToString::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let previous_group_worker_keys = previous_group_workers
        .iter()
        .map(|item| item.trim().to_ascii_lowercase())
        .collect::<HashSet<String>>();
    let preserved_manual_workers = existing
        .into_iter()
        .filter(|item| !previous_group_worker_keys.contains(&item.trim().to_ascii_lowercase()))
        .collect::<Vec<_>>();
    let next_group_workers = build_group_selected_workers(group_member_ids, self_agent_id);

    let merged = normalize_collaboration_worker_keys(
        &[preserved_manual_workers, next_group_workers.clone()].concat(),
    );

    obj.insert(
        "selectedWorkers".to_string(),
        Value::Array(merged.iter().map(|s| Value::String(s.clone())).collect()),
    );
    obj.insert(
        "groupSelectedWorkers".to_string(),
        Value::Array(
            next_group_workers
                .iter()
                .map(|s| Value::String(s.clone()))
                .collect(),
        ),
    );

    let callee_ids = callee_ids_from_selected_workers(&merged);
    (Value::Object(obj), callee_ids)
}

fn apply_group_collaboration_acl(group_member_ids: &[String]) -> Result<(), String> {
    for agent_id in group_member_ids {
        let id = agent_id.trim();
        if id.is_empty() {
            continue;
        }
        let current = assignment_store::get_agent_profile_override(id)?;
        let (collaboration, callee_ids) = merge_group_collaboration(
            current.as_ref().and_then(|item| item.collaboration.clone()),
            group_member_ids,
            id,
        );
        assignment_store::upsert_agent_profile_override(
            id,
            None,
            None,
            None,
            Some(collaboration),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )?;
        assignment_store::replace_agent_collaboration_acl(id, "private", &callee_ids)?;
    }
    Ok(())
}

pub async fn list_chat_groups(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    assignment_store::ensure_db().map_err(storage_error)?;
    let groups = assignment_store::list_chat_groups().map_err(storage_error)?;
    Ok(Json(json!({ "groups": groups })))
}

pub async fn get_chat_group(
    State(_state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    assignment_store::ensure_db().map_err(storage_error)?;
    let group = assignment_store::get_chat_group(&id).map_err(storage_error)?;
    match group {
        Some(group) => Ok(Json(json!({ "group": group }))),
        None => Err(ApiError::new(StatusCode::NOT_FOUND, "群不存在")),
    }
}

pub async fn delete_chat_group(
    State(_state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    assignment_store::ensure_db().map_err(storage_error)?;
    assignment_store::delete_chat_group(&id).map_err(storage_error)?;
    Ok(Json(json!({ "status": "deleted", "group_id": id })))
}

pub async fn create_chat_group(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateChatGroupRequest>,
) -> Result<Json<Value>, ApiError> {
    assignment_store::ensure_db().map_err(storage_error)?;

    let mut group_id = payload
        .group_id
        .as_deref()
        .map(normalize_group_id)
        .unwrap_or_default();
    if group_id.is_empty() {
        group_id = generate_group_id();
    }

    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "群名称不能为空"));
    }

    let mut member_agent_ids = normalize_string_list(payload.member_agent_ids);
    if member_agent_ids.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "至少选择 1 个群成员",
        ));
    }

    let leader_agent_id = payload
        .leader_agent_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| member_agent_ids[0].clone());

    if !member_agent_ids.iter().any(|id| id == &leader_agent_id) {
        member_agent_ids.insert(0, leader_agent_id.clone());
        member_agent_ids = normalize_string_list(member_agent_ids);
    }

    let tags = payload
        .tags
        .unwrap_or_default()
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    let tags = normalize_string_list(tags);

    let description = payload.description.unwrap_or_default();
    let system_prompt =
        build_default_group_system_prompt(&name, &group_id, &leader_agent_id, &member_agent_ids);
    let group_mode = normalize_group_mode(payload.mode.as_deref());
    let limits = if payload.limits.is_some() {
        normalize_group_limits(payload.limits.as_ref())
    } else {
        default_group_limits()
    };

    let mut admin_agent_ids = normalize_string_list(payload.admin_agent_ids.unwrap_or_default());
    if admin_agent_ids.is_empty() {
        admin_agent_ids.push(leader_agent_id.clone());
    }
    if !admin_agent_ids.iter().any(|id| id == &leader_agent_id) {
        admin_agent_ids.push(leader_agent_id.clone());
        admin_agent_ids = normalize_string_list(admin_agent_ids);
    }
    let member_set: HashSet<String> = member_agent_ids.iter().cloned().collect();
    admin_agent_ids.retain(|id| member_set.contains(id));
    if admin_agent_ids.is_empty() {
        admin_agent_ids.push(leader_agent_id.clone());
    }
    admin_agent_ids = normalize_string_list(admin_agent_ids);

    let record = assignment_store::ChatGroupRecord {
        group_id: group_id.clone(),
        name,
        description,
        tags,
        leader_agent_id: leader_agent_id.clone(),
        system_prompt,
        admin_agent_ids,
        member_agent_ids: member_agent_ids.clone(),
        group_mode,
        limits,
        created_at: String::new(),
        updated_at: String::new(),
    };

    assignment_store::create_chat_group(&record).map_err(storage_error)?;

    let apply_acl = payload.apply_collaboration_acl.unwrap_or(true);
    if apply_acl {
        let acl_member_ids = resolve_nuwa_alias_in_list(&state, &member_agent_ids).await?;
        apply_group_collaboration_acl(&acl_member_ids).map_err(storage_error)?;
    }

    let group = assignment_store::get_chat_group(&group_id).map_err(storage_error)?;
    Ok(Json(json!({ "group": group, "applied_acl": apply_acl })))
}

pub async fn update_chat_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateChatGroupRequest>,
) -> Result<Json<Value>, ApiError> {
    assignment_store::ensure_db().map_err(storage_error)?;

    let group_id = id.trim().to_string();
    if group_id.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "群ID不能为空"));
    }

    let existing = assignment_store::get_chat_group(&group_id).map_err(storage_error)?;
    let Some(existing) = existing else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "群不存在"));
    };

    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "群名称不能为空"));
    }

    let mut member_agent_ids = normalize_string_list(payload.member_agent_ids);
    if member_agent_ids.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "至少选择 1 个群成员",
        ));
    }

    let leader_agent_id = payload
        .leader_agent_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| existing.leader_agent_id.clone());

    if !member_agent_ids.iter().any(|id| id == &leader_agent_id) {
        member_agent_ids.insert(0, leader_agent_id.clone());
        member_agent_ids = normalize_string_list(member_agent_ids);
    }

    let tags = payload
        .tags
        .unwrap_or_default()
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    let tags = normalize_string_list(tags);

    let description = payload.description.unwrap_or_default();
    let system_prompt =
        build_default_group_system_prompt(&name, &group_id, &leader_agent_id, &member_agent_ids);
    let group_mode = if payload.mode.is_some() {
        normalize_group_mode(payload.mode.as_deref())
    } else {
        existing.group_mode.clone()
    };
    let limits = if payload.limits.is_some() {
        normalize_group_limits(payload.limits.as_ref())
    } else {
        normalize_group_limits(Some(&existing.limits))
    };
    let mut admin_agent_ids = if let Some(ids) = payload.admin_agent_ids {
        normalize_string_list(ids)
    } else {
        existing.admin_agent_ids.clone()
    };
    if admin_agent_ids.is_empty() {
        admin_agent_ids.push(leader_agent_id.clone());
    }
    if !admin_agent_ids.iter().any(|id| id == &leader_agent_id) {
        admin_agent_ids.push(leader_agent_id.clone());
        admin_agent_ids = normalize_string_list(admin_agent_ids);
    }
    let member_set: HashSet<String> = member_agent_ids.iter().cloned().collect();
    admin_agent_ids.retain(|id| member_set.contains(id));
    if admin_agent_ids.is_empty() {
        admin_agent_ids.push(leader_agent_id.clone());
    }
    admin_agent_ids = normalize_string_list(admin_agent_ids);

    let record = assignment_store::ChatGroupRecord {
        group_id: group_id.clone(),
        name,
        description,
        tags,
        leader_agent_id: leader_agent_id.clone(),
        system_prompt,
        admin_agent_ids,
        member_agent_ids: member_agent_ids.clone(),
        group_mode,
        limits,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
    };

    assignment_store::update_chat_group(&record).map_err(storage_error)?;

    let membership_changed = existing.member_agent_ids != member_agent_ids
        || existing.leader_agent_id != leader_agent_id;
    let apply_acl = payload.apply_collaboration_acl.unwrap_or(true);
    if apply_acl || membership_changed {
        let acl_member_ids = resolve_nuwa_alias_in_list(&state, &member_agent_ids).await?;
        apply_group_collaboration_acl(&acl_member_ids).map_err(storage_error)?;
    }

    let group = assignment_store::get_chat_group(&group_id).map_err(storage_error)?;
    Ok(Json(json!({ "group": group, "applied_acl": apply_acl })))
}

pub async fn service_power_status(State(state): State<Arc<AppState>>) -> Json<Value> {
    let power = state.power_state.read().await;
    Json(json!({
        "status": if power.online { "online" } else if power.last_error.is_some() { "error" } else { "offline" },
        "online": power.online,
        "error": power.last_error,
        "openfangBaseUrl": state.config.openfang_base_url
    }))
}

pub async fn service_power_start(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    match state.power_on().await {
        Ok(result) => Ok(Json(json!({
            "status": "online",
            "online": true,
            "health": result.health,
            "launched": result.launched,
            "launch": result.launch
        }))),
        Err(message) => Err(ApiError::new(axum::http::StatusCode::BAD_GATEWAY, message)),
    }
}

pub async fn service_power_stop(State(state): State<Arc<AppState>>) -> Json<Value> {
    let stop_error = state.shutdown_managed_openfang().await.err();
    state.set_power_state(false, stop_error.clone()).await;

    Json(json!({
        "status": "offline",
        "online": false,
        "error": stop_error
    }))
}

#[derive(Deserialize)]
pub struct CreateAgentRequest {
    #[serde(alias = "manifestToml")]
    pub manifest_toml: String,
}

fn sanitize_tags(values: &[Value]) -> Vec<String> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for item in values {
        let Some(raw) = item.as_str() else {
            continue;
        };
        let tag = raw.trim();
        if tag.is_empty() {
            continue;
        }
        if seen.insert(tag.to_string()) {
            output.push(tag.to_string());
        }
    }
    output
}

fn normalize_management_asset_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with("/api/management/") {
        return trimmed.to_string();
    }
    if let Ok(parsed) = reqwest::Url::parse(trimmed) {
        let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
        let path = parsed.path();
        if (host == "127.0.0.1" || host == "localhost") && path.starts_with("/api/management/") {
            return path.to_string();
        }
    }
    trimmed.to_string()
}

#[derive(Default)]
struct ProfileOverridePatch {
    tags: Option<Vec<String>>,
    description: Option<String>,
    system_prompt: Option<String>,
    collaboration: Option<Value>,
    channel_binding: Option<Value>,
    avatar_url: Option<String>,
    portrait_url: Option<String>,
    english_name: Option<String>,
    nickname: Option<String>,
    tts_config: Option<Value>,
    speaker_profiles: Option<Value>,
}

const COLLAB_TAG_DISCOVERABLE: &str = "webot:collab_discoverable";
const COLLAB_TAG_DISPATCHER: &str = "webot:collab_dispatcher";

fn normalize_collaboration_worker_key(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("local:") || trimmed.starts_with("a2a:") {
        return Some(trimmed.to_string());
    }
    Some(format!("local:{trimmed}"))
}

fn sanitize_collaboration_worker_keys(values: &[Value]) -> Vec<String> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for item in values {
        let Some(raw) = item.as_str() else {
            continue;
        };
        let Some(key) = normalize_collaboration_worker_key(raw) else {
            continue;
        };
        if seen.insert(key.clone()) {
            output.push(key);
        }
    }
    output
}

fn parse_local_worker_ids(worker_keys: &[String]) -> Vec<String> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for key in worker_keys {
        let trimmed = key.trim();
        if !trimmed.starts_with("local:") {
            continue;
        }
        let agent_id = trimmed["local:".len()..].trim();
        if agent_id.is_empty() {
            continue;
        }
        if seen.insert(agent_id.to_string()) {
            output.push(agent_id.to_string());
        }
    }
    output
}

fn parse_collaboration_patch(raw: &Value) -> Option<Value> {
    let Value::Object(object) = raw else {
        return None;
    };

    let discoverable = object
        .get("discoverable")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let dispatch_enabled = object
        .get("dispatchEnabled")
        .or_else(|| object.get("dispatch_enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let selected_workers = object
        .get("selectedWorkers")
        .or_else(|| object.get("selected_workers"))
        .and_then(Value::as_array)
        .map(|items| sanitize_collaboration_worker_keys(items))
        .unwrap_or_default();

    Some(json!({
        "discoverable": discoverable,
        "dispatchEnabled": dispatch_enabled,
        "selectedWorkers": selected_workers
    }))
}

fn upsert_tag_case_insensitive(tags: &mut Vec<String>, target: &str, enabled: bool) {
    let normalized = target.to_ascii_lowercase();
    if enabled {
        if tags
            .iter()
            .any(|item| item.trim().to_ascii_lowercase() == normalized)
        {
            return;
        }
        tags.push(target.to_string());
        return;
    }
    tags.retain(|item| item.trim().to_ascii_lowercase() != normalized);
}

fn extract_profile_override_patch(payload: &Value) -> ProfileOverridePatch {
    let Some(object) = payload.as_object() else {
        return ProfileOverridePatch::default();
    };

    let tags = if let Some(raw) = object.get("tags") {
        match raw {
            Value::Array(values) => Some(sanitize_tags(values)),
            Value::Null => Some(Vec::new()),
            _ => None,
        }
    } else {
        None
    };

    let description = if let Some(raw) = object.get("description") {
        match raw {
            Value::String(text) => Some(text.clone()),
            Value::Null => Some(String::new()),
            _ => None,
        }
    } else {
        None
    };

    let system_prompt = if let Some(raw) = object.get("system_prompt") {
        match raw {
            Value::String(text) => Some(text.clone()),
            Value::Null => Some(String::new()),
            _ => None,
        }
    } else {
        None
    };

    let collaboration = if let Some(raw) = object.get("collaboration") {
        match raw {
            Value::Object(_) => parse_collaboration_patch(raw),
            Value::Null => Some(json!({
                "discoverable": false,
                "dispatchEnabled": false,
                "selectedWorkers": []
            })),
            _ => None,
        }
    } else {
        None
    };

    let channel_binding = if let Some(raw) = object.get("channel_binding") {
        match raw {
            Value::Object(_) => Some(raw.clone()),
            Value::Null => Some(Value::Null),
            _ => None,
        }
    } else {
        None
    };

    let avatar_url = if let Some(raw) = object.get("avatar_url") {
        match raw {
            Value::String(text) => Some(normalize_management_asset_url(text)),
            Value::Null => Some(String::new()),
            _ => None,
        }
    } else {
        None
    };

    let portrait_url = if let Some(raw) = object.get("portrait_url") {
        match raw {
            Value::String(text) => Some(normalize_management_asset_url(text)),
            Value::Null => Some(String::new()),
            _ => None,
        }
    } else {
        None
    };

    let english_name = if let Some(raw) = object.get("english_name") {
        match raw {
            Value::String(text) => Some(text.clone()),
            Value::Null => Some(String::new()),
            _ => None,
        }
    } else {
        None
    };

    let nickname = if let Some(raw) = object.get("nickname") {
        match raw {
            Value::String(text) => Some(text.clone()),
            Value::Null => Some(String::new()),
            _ => None,
        }
    } else {
        None
    };

    let tts_config = if let Some(raw) = object.get("tts_config") {
        match raw {
            Value::Object(_) => Some(raw.clone()),
            Value::Null => Some(Value::Null),
            _ => None,
        }
    } else {
        None
    };

    let speaker_profiles = if let Some(raw) = object.get("speaker_profiles") {
        match raw {
            Value::Array(_) => Some(raw.clone()),
            Value::Null => Some(Value::Null),
            _ => None,
        }
    } else {
        None
    };

    ProfileOverridePatch {
        tags,
        description,
        system_prompt,
        collaboration,
        channel_binding,
        avatar_url,
        portrait_url,
        english_name,
        nickname,
        tts_config,
        speaker_profiles,
    }
}

fn merge_agent_profile_override(
    row: &mut Value,
    profile: &assignment_store::AgentProfileOverrideRecord,
) {
    let Some(object) = row.as_object_mut() else {
        return;
    };
    let mut display_name_override: Option<String> = None;

    if let Some(tags) = &profile.tags {
        object.insert("tags".to_string(), json!(tags));
    }
    if let Some(description) = &profile.description {
        object.insert(
            "description".to_string(),
            Value::String(description.clone()),
        );
    }

    if let Some(prompt) = &profile.system_prompt {
        object.insert("system_prompt".to_string(), Value::String(prompt.clone()));
        if let Some(model) = object.get_mut("model").and_then(Value::as_object_mut) {
            model.insert("system_prompt".to_string(), Value::String(prompt.clone()));
        }
    }
    if let Some(collaboration) = &profile.collaboration {
        object.insert("collaboration".to_string(), collaboration.clone());
    }
    if let Some(channel_binding) = &profile.channel_binding {
        object.insert("channel_binding".to_string(), channel_binding.clone());
    }

    if let Some(english_name) = &profile.english_name {
        object.insert(
            "english_name".to_string(),
            Value::String(english_name.clone()),
        );
    }
    if let Some(nickname) = &profile.nickname {
        object.insert("nickname".to_string(), Value::String(nickname.clone()));
        if display_name_override.is_none() && !nickname.trim().is_empty() {
            display_name_override = Some(nickname.clone());
        }
    }
    if let Some(tts_config) = &profile.tts_config {
        object.insert("tts_config".to_string(), tts_config.clone());
    }
    if let Some(speaker_profiles) = &profile.speaker_profiles {
        object.insert("speaker_profiles".to_string(), speaker_profiles.clone());
    }
    if let Some(display_name) = display_name_override {
        object.insert("name".to_string(), Value::String(display_name));
    }

    if profile.avatar_url.is_some() || profile.portrait_url.is_some() {
        let identity = object
            .entry("identity".to_string())
            .or_insert_with(|| json!({}));
        if let Some(identity_obj) = identity.as_object_mut() {
            if let Some(avatar_url) = &profile.avatar_url {
                identity_obj.insert("avatar_url".to_string(), Value::String(avatar_url.clone()));
            }
            if let Some(portrait_url) = &profile.portrait_url {
                identity_obj.insert(
                    "portrait_url".to_string(),
                    Value::String(portrait_url.clone()),
                );
            }
        }
    }
}

const MAX_AVATAR_SIZE: usize = 15 * 1024 * 1024;
const MAX_CHAT_ASSET_SIZE: usize = 64 * 1024 * 1024;
const CHAT_UPLOAD_DIR_NAME: &str = "chat-uploads";
const MAX_CONTEXT_FILE_SIZE: usize = 32 * 1024;
const MAX_MEMORY_FILE_SIZE: usize = 512 * 1024;
const DEFAULT_MEMORY_QUERY_DAYS: i64 = 7;
const DEFAULT_MEMORY_PAGE_SIZE: usize = 20;
const MAX_MEMORY_PAGE_SIZE: usize = 100;
const WORKSPACE_MCP_SERVER_PREFIX: &str = "agent-workspace-";
const WORKSPACE_MCP_TIMEOUT_SECS: u64 = 20;
const SYSTEM_HIDDEN_MCP_SERVER_NAMES: [&str; 2] = ["agent", "mcp"];
const AGENT_PROFILE_DIR_NAME: &str = "agent_profile";
const EMBODIMENT_CONTEXT_FILE_NAME: &str = "EMBODIMENT.json";
const KNOWN_CONTEXT_FILES: [&str; 9] = [
    "SOUL.md",
    "USER.md",
    "TOOLS.md",
    "MEMORY.md",
    "AGENTS.md",
    "BOOTSTRAP.md",
    "IDENTITY.md",
    "HEARTBEAT.md",
    EMBODIMENT_CONTEXT_FILE_NAME,
];

#[derive(Debug, Clone)]
pub(crate) struct AgentWorkspaceBinding {
    server_name: String,
    private_workspace: PathBuf,
    shared_workspace: PathBuf,
    extra_workspaces: Vec<PathBuf>,
}

impl AgentWorkspaceBinding {
    pub(crate) fn all_workspaces(&self) -> Vec<PathBuf> {
        let mut output = Vec::with_capacity(2 + self.extra_workspaces.len());
        output.push(self.private_workspace.clone());
        output.push(self.shared_workspace.clone());
        output.extend(self.extra_workspaces.iter().cloned());
        output
    }
}

fn normalize_context_file_name(file_name: &str) -> Option<&'static str> {
    let trimmed = file_name.trim();
    KNOWN_CONTEXT_FILES
        .iter()
        .copied()
        .find(|item| item.eq_ignore_ascii_case(trimmed))
}

fn default_embodiment_json() -> Value {
    json!({
        "version": 1,
        "assets": {}
    })
}

fn normalize_embodiment_asset_kind(raw: Option<&str>, fallback: &str) -> String {
    match raw.unwrap_or(fallback).trim() {
        "avatar" | "portrait" | "self_photo" | "video_source" => {
            raw.unwrap_or(fallback).trim().to_string()
        }
        _ => fallback.to_string(),
    }
}

fn normalize_embodiment_asset_ref(
    raw: &Value,
    fallback_kind: &str,
    fallback_url: Option<&str>,
) -> Option<Value> {
    let object = raw.as_object()?;
    let url = object
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            fallback_url
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })?;
    let mut next = Map::new();
    let source = object
        .get("source")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| {
            matches!(
                *value,
                "managed_asset" | "managed_identity" | "external_url"
            )
        })
        .unwrap_or("external_url");
    next.insert("source".to_string(), Value::String(source.to_string()));
    next.insert(
        "kind".to_string(),
        Value::String(normalize_embodiment_asset_kind(
            object.get("kind").and_then(Value::as_str),
            fallback_kind,
        )),
    );
    next.insert("url".to_string(), Value::String(url.to_string()));
    if let Some(asset_id) = object
        .get("assetId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        next.insert("assetId".to_string(), Value::String(asset_id.to_string()));
    }
    if let Some(label) = object
        .get("label")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        next.insert("label".to_string(), Value::String(label.to_string()));
    }
    if let Some(mime_type) = object
        .get("mimeType")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        next.insert("mimeType".to_string(), Value::String(mime_type.to_string()));
    }
    if let Some(metadata) = object.get("metadata").and_then(Value::as_object) {
        next.insert("metadata".to_string(), Value::Object(metadata.clone()));
    }
    Some(Value::Object(next))
}

fn managed_identity_asset_ref(url: &str, kind: &str, label: &str) -> Value {
    json!({
        "source": "managed_identity",
        "kind": kind,
        "url": url,
        "label": label,
    })
}

fn media_asset_public_url(
    agent_id: &str,
    asset: &assignment_store::MediaAssetRecord,
) -> Option<String> {
    asset
        .image_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            asset
                .relative_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| build_agent_chat_asset_url(agent_id, value))
        })
}

fn media_asset_embodiment_label(asset: &assignment_store::MediaAssetRecord) -> Option<String> {
    asset
        .metadata
        .get("meta_label")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            asset
                .purpose
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .or_else(|| {
            asset
                .file_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

fn media_asset_to_embodiment_ref(
    agent_id: &str,
    asset: &assignment_store::MediaAssetRecord,
    kind: &str,
) -> Option<Value> {
    let url = media_asset_public_url(agent_id, asset)?;
    let mut object = Map::new();
    object.insert(
        "source".to_string(),
        Value::String("managed_asset".to_string()),
    );
    object.insert("kind".to_string(), Value::String(kind.to_string()));
    object.insert("assetId".to_string(), Value::String(asset.asset_id.clone()));
    object.insert("url".to_string(), Value::String(url));
    if !asset.mime_type.trim().is_empty() {
        object.insert(
            "mimeType".to_string(),
            Value::String(asset.mime_type.trim().to_string()),
        );
    }
    if let Some(label) = media_asset_embodiment_label(asset) {
        object.insert("label".to_string(), Value::String(label));
    }
    if let Some(metadata) = asset.metadata.as_object() {
        object.insert("metadata".to_string(), Value::Object(metadata.clone()));
    }
    Some(Value::Object(object))
}

fn build_self_photo_embodiment_refs(
    agent_id: &str,
    photo_assets: &[assignment_store::MediaAssetRecord],
) -> Vec<Value> {
    photo_assets
        .iter()
        .filter(|asset| asset.owner_scope.eq_ignore_ascii_case("self"))
        .filter_map(|asset| media_asset_to_embodiment_ref(agent_id, asset, "self_photo"))
        .collect()
}

fn normalize_embodiment_voice_ref(raw: &Value) -> Option<Value> {
    let object = raw.as_object()?;
    let mode = match object
        .get("mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("speaker_profile")
    {
        "provider_voice" => "provider_voice",
        _ => "speaker_profile",
    };
    let speaker_profile_id = object
        .get("speakerProfileId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let provider = object
        .get("provider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let voice = object
        .get("voice")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if speaker_profile_id.is_none() && provider.is_none() && voice.is_none() {
        return None;
    }
    let mut next = Map::new();
    next.insert("mode".to_string(), Value::String(mode.to_string()));
    if let Some(value) = speaker_profile_id {
        next.insert(
            "speakerProfileId".to_string(),
            Value::String(value.to_string()),
        );
    }
    if let Some(value) = provider {
        next.insert("provider".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = voice {
        next.insert("voice".to_string(), Value::String(value.to_string()));
    }
    if let Some(label) = object
        .get("label")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        next.insert("label".to_string(), Value::String(label.to_string()));
    }
    if let Some(metadata) = object.get("metadata").and_then(Value::as_object) {
        next.insert("metadata".to_string(), Value::Object(metadata.clone()));
    }
    Some(Value::Object(next))
}

fn build_legacy_embodiment_json(
    profile: Option<&assignment_store::AgentProfileOverrideRecord>,
    photo_assets: &[assignment_store::MediaAssetRecord],
) -> Value {
    let mut embodiment = default_embodiment_json();
    let Some(object) = embodiment.as_object_mut() else {
        return embodiment;
    };
    let Some(assets) = object.get_mut("assets").and_then(Value::as_object_mut) else {
        return embodiment;
    };

    let default_avatar = profile
        .and_then(|item| item.avatar_url.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| managed_identity_asset_ref(value, "avatar", "当前头像"));
    let default_portrait = profile
        .and_then(|item| item.portrait_url.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| managed_identity_asset_ref(value, "portrait", "当前立绘"));

    if let Some(value) = default_avatar {
        assets.insert("defaultAvatar".to_string(), value);
    }
    if let Some(value) = default_portrait {
        assets.insert("defaultPortrait".to_string(), value.clone());
        assets.insert(
            "defaultVideoSource".to_string(),
            managed_identity_asset_ref(
                value.get("url").and_then(Value::as_str).unwrap_or_default(),
                "video_source",
                "当前视频源图",
            ),
        );
    }
    let agent_id = profile
        .map(|item| item.agent_id.trim())
        .filter(|value| !value.is_empty());
    if let Some(agent_id) = agent_id {
        let self_photos = build_self_photo_embodiment_refs(agent_id, photo_assets);
        if !self_photos.is_empty() {
            assets.insert("selfPhotos".to_string(), Value::Array(self_photos));
        }
    }

    if let Some(tts_config) = profile.and_then(|item| item.tts_config.as_ref()) {
        if let Some(speaker_profile_id) = tts_config
            .get("speakerProfileId")
            .or_else(|| tts_config.get("speaker_profile_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let label = profile
                .and_then(|item| item.speaker_profiles.as_ref())
                .and_then(Value::as_array)
                .and_then(|items| {
                    items.iter().find_map(|item| {
                        let id = item.get("id").and_then(Value::as_str)?.trim();
                        if id != speaker_profile_id {
                            return None;
                        }
                        item.get("name")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(ToString::to_string)
                    })
                });
            object.insert(
                "voice".to_string(),
                json!({
                    "defaultVoice": {
                        "mode": "speaker_profile",
                        "speakerProfileId": speaker_profile_id,
                        "label": label,
                    }
                }),
            );
        }
    }

    embodiment
}

fn normalize_embodiment_json(
    raw: Option<&Value>,
    profile: Option<&assignment_store::AgentProfileOverrideRecord>,
    photo_assets: &[assignment_store::MediaAssetRecord],
) -> Value {
    let mut normalized = build_legacy_embodiment_json(profile, photo_assets);
    let Some(raw_object) = raw.and_then(Value::as_object) else {
        return normalized;
    };
    let Some(root) = normalized.as_object_mut() else {
        return normalized;
    };

    root.insert("version".to_string(), Value::Number(1.into()));

    let legacy_assets = root
        .get("assets")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let raw_assets = raw_object.get("assets").and_then(Value::as_object);
    let default_avatar = raw_assets
        .and_then(|item| item.get("defaultAvatar"))
        .and_then(|value| normalize_embodiment_asset_ref(value, "avatar", None))
        .or_else(|| legacy_assets.get("defaultAvatar").cloned());
    let default_portrait = raw_assets
        .and_then(|item| item.get("defaultPortrait"))
        .and_then(|value| normalize_embodiment_asset_ref(value, "portrait", None))
        .or_else(|| legacy_assets.get("defaultPortrait").cloned());
    let default_video_source = raw_assets
        .and_then(|item| item.get("defaultVideoSource"))
        .and_then(|value| normalize_embodiment_asset_ref(value, "video_source", None));
    let legacy_self_photos = legacy_assets
        .get("selfPhotos")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let self_photos = raw_assets
        .and_then(|item| item.get("selfPhotos"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|value| normalize_embodiment_asset_ref(value, "self_photo", None))
                .collect::<Vec<_>>()
        })
        .unwrap_or(legacy_self_photos);

    root.insert(
        "assets".to_string(),
        json!({
            "defaultAvatar": default_avatar,
            "defaultPortrait": default_portrait,
            "defaultVideoSource": default_video_source,
            "selfPhotos": if self_photos.is_empty() { Value::Null } else { Value::Array(self_photos) },
        }),
    );

    let legacy_voice = root.get("voice").cloned();
    let raw_voice = raw_object.get("voice").and_then(Value::as_object);
    let normalized_voice = raw_voice
        .and_then(|value| value.get("defaultVoice"))
        .and_then(normalize_embodiment_voice_ref)
        .or_else(|| {
            legacy_voice
                .as_ref()
                .and_then(Value::as_object)
                .and_then(|item| item.get("defaultVoice"))
                .cloned()
        });
    if normalized_voice.is_some() {
        root.insert(
            "voice".to_string(),
            json!({
                "defaultVoice": normalized_voice,
            }),
        );
    }

    normalized
}

fn embodiment_mirror_fields(
    embodiment: &Value,
) -> (Option<String>, Option<String>, Option<String>) {
    let avatar_url = embodiment
        .get("assets")
        .and_then(|value| value.get("defaultAvatar"))
        .and_then(|value| value.get("url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let portrait_url = embodiment
        .get("assets")
        .and_then(|value| value.get("defaultPortrait"))
        .and_then(|value| value.get("url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let speaker_profile_id = embodiment
        .get("voice")
        .and_then(|value| value.get("defaultVoice"))
        .and_then(|value| value.get("speakerProfileId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    (avatar_url, portrait_url, speaker_profile_id)
}

fn normalize_generated_heading(raw: &str) -> String {
    let mut output = String::new();
    let mut skip_ascii_paren = 0usize;
    let mut skip_cn_paren = 0usize;
    for ch in raw.chars() {
        match ch {
            '(' => {
                skip_ascii_paren += 1;
                continue;
            }
            ')' => {
                skip_ascii_paren = skip_ascii_paren.saturating_sub(1);
                continue;
            }
            '（' => {
                skip_cn_paren += 1;
                continue;
            }
            '）' => {
                skip_cn_paren = skip_cn_paren.saturating_sub(1);
                continue;
            }
            _ => {}
        }
        if skip_ascii_paren > 0 || skip_cn_paren > 0 {
            continue;
        }
        if ch.is_whitespace()
            || matches!(ch, '`' | '*' | '_' | ':' | '：' | '-' | '|' | '【' | '】')
        {
            continue;
        }
        output.extend(ch.to_lowercase());
    }
    output
}

fn split_generated_markdown_sections(text: &str) -> HashMap<String, String> {
    let normalized = text.replace("\r\n", "\n");
    let mut sections = HashMap::new();
    let mut current_heading = String::new();
    let mut buffer: Vec<String> = Vec::new();

    let flush = |sections: &mut HashMap<String, String>,
                 current_heading: &String,
                 buffer: &mut Vec<String>| {
        if !current_heading.is_empty() {
            sections.insert(
                current_heading.clone(),
                buffer.join("\n").trim().to_string(),
            );
        }
    };

    for line in normalized.lines() {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_prefix("# ") {
            let heading = stripped.trim();
            if !heading.is_empty() {
                flush(&mut sections, &current_heading, &mut buffer);
                current_heading = normalize_generated_heading(heading);
                buffer.clear();
                continue;
            }
        }
        if !current_heading.is_empty() {
            buffer.push(line.to_string());
        }
    }
    flush(&mut sections, &current_heading, &mut buffer);
    sections
}

fn read_generated_section(sections: &HashMap<String, String>, aliases: &[&str]) -> Option<String> {
    aliases
        .iter()
        .find_map(|alias| sections.get(&normalize_generated_heading(alias)).cloned())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[derive(Default)]
struct ParsedGeneratedIdentityBundle {
    context_files: HashMap<&'static str, String>,
    system_prompt: Option<String>,
}

fn parse_generated_identity_bundle_markdown(text: &str) -> ParsedGeneratedIdentityBundle {
    let normalized = text.trim();
    if normalized.is_empty() {
        return ParsedGeneratedIdentityBundle::default();
    }
    let sections = split_generated_markdown_sections(normalized);
    let mut parsed = ParsedGeneratedIdentityBundle::default();

    let mappings: [(&'static str, [&str; 3]); 8] = [
        ("IDENTITY.md", ["IDENTITY.md", "身份设定", "identity"]),
        ("SOUL.md", ["SOUL.md", "灵魂规则", "soul"]),
        ("USER.md", ["USER.md", "用户关系", "user"]),
        ("MEMORY.md", ["MEMORY.md", "记忆规则", "长期记忆"]),
        ("TOOLS.md", ["TOOLS.md", "工具规范", "tools"]),
        ("AGENTS.md", ["AGENTS.md", "多智能体协作", "agents"]),
        (
            "BOOTSTRAP.md",
            ["BOOTSTRAP.md", "首次会话流程", "首次运行流程"],
        ),
        (
            "HEARTBEAT.md",
            ["HEARTBEAT.md", "周期性任务提示词", "heartbeatchecklist"],
        ),
    ];

    for (file_name, aliases) in mappings {
        if let Some(content) = read_generated_section(&sections, &aliases) {
            parsed.context_files.insert(file_name, content);
        }
    }
    parsed.system_prompt = read_generated_section(&sections, &["系统提示词", "SYSTEM"]);

    if parsed.context_files.is_empty() {
        parsed
            .context_files
            .insert("IDENTITY.md", normalized.to_string());
    }
    parsed
}

fn complete_generated_identity_bundle(
    raw_input: &str,
    text: &str,
) -> ParsedGeneratedIdentityBundle {
    let mut parsed = parse_generated_identity_bundle_markdown(text);
    let fallback_markdown = build_optimize_fallback_content(raw_input, "identity_bundle");
    let fallback = parse_generated_identity_bundle_markdown(&fallback_markdown);

    for file_name in KNOWN_CONTEXT_FILES {
        if !parsed.context_files.contains_key(file_name) {
            if let Some(content) = fallback.context_files.get(file_name) {
                parsed.context_files.insert(file_name, content.to_string());
            }
        }
    }
    if parsed.system_prompt.is_none() {
        parsed.system_prompt = fallback.system_prompt;
    }
    parsed
}

async fn read_context_file_from_openfang(
    state: &Arc<AppState>,
    agent_id: &str,
    file_name: &str,
) -> Result<Option<String>, ApiError> {
    let path = format!("/api/agents/{agent_id}/files/{file_name}");
    match state.openfang.get_json(&path).await {
        Ok(payload) => Ok(payload
            .get("content")
            .and_then(Value::as_str)
            .map(ToString::to_string)),
        Err(err) if err.status == axum::http::StatusCode::NOT_FOUND => Ok(None),
        Err(err) => Err(err),
    }
}

async fn write_context_file_to_openfang(
    state: &Arc<AppState>,
    agent_id: &str,
    file_name: &str,
    content: &str,
) -> Result<(), ApiError> {
    let path = format!("/api/agents/{agent_id}/files/{file_name}");
    state
        .openfang
        .put_json(&path, json!({ "content": content }))
        .await?;
    let binding = resolve_agent_workspace_binding(state, agent_id, None).await?;
    let file_path = binding.private_workspace.join(file_name);
    fs::write(&file_path, content).map_err(|e| {
        storage_error(format!(
            "写入工作区身份文件失败({}): {e}",
            file_path.display()
        ))
    })?;
    Ok(())
}

async fn load_agent_embodiment_value(
    state: &Arc<AppState>,
    agent_id: &str,
    profile: Option<&assignment_store::AgentProfileOverrideRecord>,
) -> Result<Value, ApiError> {
    let raw_value = if let Some(record) =
        assignment_store::get_agent_context_file(agent_id, EMBODIMENT_CONTEXT_FILE_NAME)
            .map_err(storage_error)?
    {
        serde_json::from_str::<Value>(&record.content).ok()
    } else if let Some(content) =
        read_context_file_from_openfang(state, agent_id, EMBODIMENT_CONTEXT_FILE_NAME).await?
    {
        serde_json::from_str::<Value>(&content).ok()
    } else {
        None
    };
    let photo_assets = assignment_store::list_media_assets(assignment_store::MediaAssetListQuery {
        agent_id: Some(agent_id.to_string()),
        owner_scope: None,
        asset_family: Some("photo".to_string()),
        media_kind: Some("image".to_string()),
        query: None,
        limit: Some(64),
    })
    .map_err(storage_error)?;
    Ok(normalize_embodiment_json(
        raw_value.as_ref(),
        profile,
        &photo_assets,
    ))
}

#[derive(Default, Debug, Clone)]
struct AgentContextSyncStats {
    imported_to_db: usize,
    pushed_to_runtime: usize,
    initialized_empty: usize,
}

impl AgentContextSyncStats {
    fn as_json(&self) -> Value {
        json!({
            "imported_to_db": self.imported_to_db,
            "pushed_to_runtime": self.pushed_to_runtime,
            "initialized_empty": self.initialized_empty
        })
    }
}

async fn sync_agent_context_files(
    state: &Arc<AppState>,
    agent_id: &str,
    initialize_missing: bool,
) -> Result<AgentContextSyncStats, ApiError> {
    validate_agent_path_segment(agent_id)?;
    let cached = assignment_store::list_agent_context_files(agent_id).map_err(storage_error)?;
    let mut stats = AgentContextSyncStats::default();

    for file_name in KNOWN_CONTEXT_FILES {
        let db_content = cached.get(file_name).map(|record| record.content.clone());
        let runtime_content = read_context_file_from_openfang(state, agent_id, file_name).await?;

        match (db_content, runtime_content) {
            (Some(db), Some(runtime)) => {
                if db != runtime {
                    // 如果文件内容非空且与数据库不同，说明很可能是被手动从外部（磁盘）修改了
                    // 此时我们将磁盘内容同步回数据库。
                    // 免责声明：如果是在 Web 界面保存失败导致的差异，这会导致数据库回退。
                    // 但考虑到用户主要场景是磁盘文件编辑，这种权衡通常是正确的。
                    if !runtime.trim().is_empty() {
                        assignment_store::upsert_agent_context_file(agent_id, file_name, &runtime)
                            .map_err(storage_error)?;
                        stats.imported_to_db += 1;
                    } else {
                        // 否则（文件为空但数据库有内容），同步数据库到磁盘
                        write_context_file_to_openfang(state, agent_id, file_name, &db).await?;
                        stats.pushed_to_runtime += 1;
                    }
                }
            }
            (Some(db), None) => {
                write_context_file_to_openfang(state, agent_id, file_name, &db).await?;
                stats.pushed_to_runtime += 1;
            }
            (None, Some(runtime)) => {
                assignment_store::upsert_agent_context_file(agent_id, file_name, &runtime)
                    .map_err(storage_error)?;
                stats.imported_to_db += 1;
            }
            (None, None) => {
                if initialize_missing {
                    assignment_store::upsert_agent_context_file(agent_id, file_name, "")
                        .map_err(storage_error)?;
                    write_context_file_to_openfang(state, agent_id, file_name, "").await?;
                    stats.imported_to_db += 1;
                    stats.pushed_to_runtime += 1;
                    stats.initialized_empty += 1;
                }
            }
        }
    }

    Ok(stats)
}

async fn list_upstream_agent_ids(state: &Arc<AppState>) -> Result<Vec<String>, ApiError> {
    let data = state.openfang.get_json("/api/agents").await?;
    let mut output = Vec::new();
    if let Some(rows) = data.as_array() {
        for row in rows {
            let agent_id = row
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
            if let Some(agent_id) = agent_id {
                output.push(agent_id);
            }
        }
    }
    output.sort();
    output.dedup();
    Ok(output)
}

fn validate_agent_path_segment(agent_id: &str) -> Result<(), ApiError> {
    let trimmed = agent_id.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "无效的 agent id",
        ));
    }
    Ok(())
}

fn validate_memory_id_segment(memory_id: &str) -> Result<(), ApiError> {
    let trimmed = memory_id.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "无效的 memory id",
        ));
    }
    Ok(())
}

fn validate_task_path_segment(task_id: &str) -> Result<(), ApiError> {
    let trimmed = task_id.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "无效的 task id"));
    }
    Ok(())
}

fn remove_dir_if_empty(path: &StdPath) {
    let entries = match fs::read_dir(path) {
        Ok(value) => value,
        Err(_) => return,
    };
    if entries.count() > 0 {
        return;
    }
    let _ = fs::remove_dir(path);
}

fn merge_dir_if_missing_entries(source: &StdPath, target: &StdPath) -> Result<(), ApiError> {
    fs::create_dir_all(target)
        .map_err(|e| storage_error(format!("创建目录失败({}): {e}", target.display())))?;
    let entries = fs::read_dir(source)
        .map_err(|e| storage_error(format!("读取目录失败({}): {e}", source.display())))?;
    for entry in entries {
        let entry = entry.map_err(|e| storage_error(format!("读取目录项失败: {e}")))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|e| {
            storage_error(format!("读取文件类型失败({}): {e}", source_path.display()))
        })?;
        if file_type.is_dir() {
            merge_dir_if_missing_entries(&source_path, &target_path)?;
            continue;
        }
        if file_type.is_file() && !target_path.exists() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    storage_error(format!("创建目录失败({}): {e}", parent.display()))
                })?;
            }
            fs::copy(&source_path, &target_path).map_err(|e| {
                storage_error(format!(
                    "复制文件失败({} -> {}): {e}",
                    source_path.display(),
                    target_path.display()
                ))
            })?;
        }
    }
    Ok(())
}

fn ensure_agent_media_dir_with_legacy_migration(
    legacy_dir: &StdPath,
    target_dir: &StdPath,
) -> Result<(), ApiError> {
    fs::create_dir_all(target_dir).map_err(|e| {
        storage_error(format!(
            "创建智能体媒体目录失败({}): {e}",
            target_dir.display()
        ))
    })?;

    if !legacy_dir.is_dir() || path_identity_key(legacy_dir) == path_identity_key(target_dir) {
        return Ok(());
    }

    merge_dir_if_missing_entries(legacy_dir, target_dir)?;
    if let Err(err) = fs::remove_dir_all(legacy_dir) {
        if err.kind() != std::io::ErrorKind::NotFound {
            eprintln!(
                "[management] 清理旧媒体目录失败({}): {err}",
                legacy_dir.display()
            );
        }
    }
    if let Some(parent) = legacy_dir.parent() {
        remove_dir_if_empty(parent);
    }
    Ok(())
}

async fn resolve_agent_media_dirs(
    state: &Arc<AppState>,
    agent_id: &str,
    upstream_hint: Option<&Value>,
) -> Result<(PathBuf, PathBuf), ApiError> {
    let binding = resolve_agent_workspace_binding(state, agent_id, upstream_hint).await?;
    let profile_root = binding.private_workspace.join(AGENT_PROFILE_DIR_NAME);
    let avatar_dir = profile_root.join("avatar");
    let portrait_dir = profile_root.join("portrait");

    let workspaces_root = path_resolver::workspaces_root().map_err(storage_error)?;
    let legacy_root = workspaces_root.join(agent_id);
    let legacy_avatar_dir = legacy_root.join("avatar");
    let legacy_portrait_dir = legacy_root.join("portrait");

    ensure_agent_media_dir_with_legacy_migration(&legacy_avatar_dir, &avatar_dir)?;
    ensure_agent_media_dir_with_legacy_migration(&legacy_portrait_dir, &portrait_dir)?;
    remove_dir_if_empty(&legacy_root);
    Ok((avatar_dir, portrait_dir))
}

async fn resolve_agent_avatar_dir(
    state: &Arc<AppState>,
    agent_id: &str,
    upstream_hint: Option<&Value>,
) -> Result<PathBuf, ApiError> {
    let (avatar_dir, _) = resolve_agent_media_dirs(state, agent_id, upstream_hint).await?;
    Ok(avatar_dir)
}

async fn resolve_agent_portrait_dir(
    state: &Arc<AppState>,
    agent_id: &str,
    upstream_hint: Option<&Value>,
) -> Result<PathBuf, ApiError> {
    let (_, portrait_dir) = resolve_agent_media_dirs(state, agent_id, upstream_hint).await?;
    Ok(portrait_dir)
}

fn normalize_workspace_segment(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value.contains("..")
        || value.contains(':')
    {
        return None;
    }
    if value.chars().any(|ch| !ch.is_ascii()) {
        return None;
    }
    Some(value.to_string())
}

fn is_valid_english_name(raw: &str) -> bool {
    let value = raw.trim();
    if value.is_empty() || value.starts_with('-') || value.ends_with('-') {
        return false;
    }
    let mut prev_dash = false;
    for ch in value.chars() {
        let valid = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        if valid {
            prev_dash = false;
            continue;
        }
        if ch == '-' && !prev_dash {
            prev_dash = true;
            continue;
        }
        return false;
    }
    true
}

fn looks_like_uuid(raw: &str) -> bool {
    let value = raw.trim().to_ascii_lowercase();
    if value.is_empty() {
        return false;
    }
    let parts = value.split('-').collect::<Vec<_>>();
    if parts.len() != 5 {
        return false;
    }
    let expected = [8usize, 4, 4, 4, 12];
    for (idx, part) in parts.iter().enumerate() {
        if part.len() != expected[idx] {
            return false;
        }
        if !part.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return false;
        }
    }
    true
}

fn is_safe_workspace_segment_for_migration(raw: &str) -> bool {
    let value = raw.trim();
    !(value.is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value.contains("..")
        || value.contains(':'))
}

fn maybe_migrate_workspace_dir(from_segment: &str, to_segment: &str) -> Result<bool, ApiError> {
    let from = from_segment.trim();
    let to = to_segment.trim();
    if from.is_empty() || to.is_empty() || from == to {
        return Ok(false);
    }
    if !is_safe_workspace_segment_for_migration(from)
        || !is_safe_workspace_segment_for_migration(to)
    {
        return Ok(false);
    }
    let root = path_resolver::workspaces_root().map_err(storage_error)?;
    let from_dir = root.join(from);
    if !from_dir.is_dir() {
        return Ok(false);
    }
    let to_dir = root.join(to);
    if to_dir.exists() {
        return Ok(false);
    }
    fs::rename(&from_dir, &to_dir)
        .map_err(|e| storage_error(format!("迁移工作区目录失败({from} -> {to}): {e}")))?;
    Ok(true)
}

fn workspace_mcp_server_name(agent_id: &str) -> String {
    format!("{WORKSPACE_MCP_SERVER_PREFIX}{agent_id}")
}

fn is_workspace_mcp_server(name: &str) -> bool {
    name.trim().starts_with(WORKSPACE_MCP_SERVER_PREFIX)
}

fn is_system_hidden_mcp_server(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return false;
    }
    if is_workspace_mcp_server(trimmed) {
        return true;
    }
    SYSTEM_HIDDEN_MCP_SERVER_NAMES
        .iter()
        .any(|item| item.eq_ignore_ascii_case(trimmed))
}

fn strip_workspace_mcp_names(names: Vec<String>) -> Vec<String> {
    names
        .into_iter()
        .filter(|name| !is_system_hidden_mcp_server(name))
        .collect()
}

fn is_probably_chat_model(provider: &str, model: &str) -> bool {
    if provider.trim().eq_ignore_ascii_case("nvidia-nim")
        || provider.trim().eq_ignore_ascii_case("nvidia")
    {
        let lower = model.to_ascii_lowercase();
        // NVIDIA NIM catalog includes embedding/safety/reward/utility models that
        // do not support chat/completions. Filter obvious non-chat models to
        // avoid "LLM request failed" on selection.
        let blocked = [
            "embed",
            "embedding",
            "embedqa",
            "rerank",
            "ranker",
            "reward",
            "guard",
            "safety",
            "pii",
            "clip",
            "retriever",
            "classifier",
            "translate",
            "asr",
            "tts",
            "speech",
            "ocr",
            "segmentation",
            "detector",
            "parse",
        ];
        if blocked.iter().any(|token| lower.contains(token)) {
            return false;
        }
    }
    true
}

fn payload_models_array<'a>(payload: &'a Value) -> Vec<&'a Value> {
    if let Some(items) = payload.as_array() {
        return items.iter().collect();
    }
    payload
        .get("models")
        .and_then(Value::as_array)
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

async fn ensure_runtime_model_available(
    state: &Arc<AppState>,
    provider: &str,
    model: &str,
) -> Result<(), ApiError> {
    let model = model.trim();
    let payload = state.openfang.get_json("/api/models").await?;
    let exists = payload_models_array(&payload).into_iter().any(|item| {
        let item_provider = item
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let item_model = item
            .get("model")
            .or_else(|| item.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        item_provider.eq_ignore_ascii_case(provider) && item_model.eq_ignore_ascii_case(model)
    });

    if exists {
        return Ok(());
    }

    let display_name = format!("{provider}/{model}");
    let _ = state
        .openfang
        .post_json(
            "/api/models/custom",
            json!({
                "id": model,
                "provider": provider,
                "display_name": display_name
            }),
        )
        .await?;
    Ok(())
}

async fn apply_runtime_agent_model(
    state: &Arc<AppState>,
    agent_id: &str,
    provider: &str,
    model: &str,
) -> Result<Value, ApiError> {
    ensure_runtime_model_available(state, provider, model).await?;

    let path = format!("/api/agents/{agent_id}/config");
    state
        .openfang
        .patch_json(
            &path,
            json!({
                "provider": provider,
                "model": model
            }),
        )
        .await?;

    let detail_path = format!("/api/agents/{agent_id}");
    let detail = state.openfang.get_json(&detail_path).await?;
    let applied_provider = detail
        .pointer("/model/provider")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let applied_model_raw = detail
        .pointer("/model/model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    if !applied_provider.eq_ignore_ascii_case(provider) || applied_model_raw != model {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!(
                "OpenFang 未应用目标模型，当前为 {}/{}，期望为 {}/{}",
                applied_provider, applied_model_raw, provider, model
            ),
        ));
    }

    Ok(detail)
}

fn is_local_provider_configured(provider_id: &str) -> Result<bool, ApiError> {
    assignment_store::get_provider_config(provider_id)
        .map(|record| record.is_some())
        .map_err(storage_error)
}

fn path_identity_key(path: &StdPath) -> String {
    let value = path.to_string_lossy().trim().to_string();
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

fn path_to_string(path: &StdPath) -> String {
    path.to_string_lossy().to_string()
}

fn parse_workspace_absolute_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return None;
    }
    Some(path)
}

fn ensure_workspace_dirs(paths: &[PathBuf]) -> Result<(), ApiError> {
    for path in paths {
        fs::create_dir_all(path)
            .map_err(|e| storage_error(format!("创建工作空间目录失败({}): {e}", path.display())))?;
    }
    Ok(())
}

fn remove_workspace_dir(path: &StdPath) -> Result<bool, ApiError> {
    match fs::remove_dir_all(path) {
        Ok(_) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(storage_error(format!(
            "删除工作空间目录失败({}): {err}",
            path.display()
        ))),
    }
}

fn remove_agent_workspace_dirs(binding: &AgentWorkspaceBinding) -> Result<Vec<String>, ApiError> {
    let mut removed = Vec::new();
    if remove_workspace_dir(&binding.private_workspace)? {
        removed.push(path_to_string(&binding.private_workspace));
    }
    for extra in &binding.extra_workspaces {
        if path_identity_key(extra) == path_identity_key(&binding.shared_workspace) {
            continue;
        }
        if remove_workspace_dir(extra)? {
            removed.push(path_to_string(extra));
        }
    }
    Ok(removed)
}

fn collect_segment_candidates_from_payload(payload: &Value) -> Vec<String> {
    let mut output = Vec::new();
    if let Some(value) = payload.get("english_name").and_then(Value::as_str) {
        output.push(value.to_string());
    }
    if let Some(value) = payload.get("name").and_then(Value::as_str) {
        output.push(value.to_string());
    }
    output
}

async fn resolve_agent_workspace_segment(
    state: &Arc<AppState>,
    agent_id: &str,
    upstream_hint: Option<&Value>,
) -> Result<String, ApiError> {
    let mut candidates = Vec::new();
    if let Some(profile) =
        assignment_store::get_agent_profile_override(agent_id).map_err(storage_error)?
    {
        if let Some(english_name) = profile.english_name {
            candidates.push(english_name);
        }
    }

    if let Some(hint) = upstream_hint {
        candidates.extend(collect_segment_candidates_from_payload(hint));
    } else {
        let detail_path = format!("/api/agents/{agent_id}");
        if let Ok(detail) = state.openfang.get_json(&detail_path).await {
            candidates.extend(collect_segment_candidates_from_payload(&detail));
        }
    }

    candidates.push(agent_id.to_string());
    for candidate in candidates {
        if let Some(segment) = normalize_workspace_segment(&candidate) {
            return Ok(segment);
        }
    }
    Err(ApiError::new(
        axum::http::StatusCode::BAD_REQUEST,
        "无法解析智能体工作空间目录名",
    ))
}

pub(crate) async fn resolve_agent_workspace_binding(
    state: &Arc<AppState>,
    agent_id: &str,
    upstream_hint: Option<&Value>,
) -> Result<AgentWorkspaceBinding, ApiError> {
    validate_agent_path_segment(agent_id)?;
    let workspace_segment = resolve_agent_workspace_segment(state, agent_id, upstream_hint).await?;
    if workspace_segment != agent_id {
        let mut migration_candidates = Vec::new();
        migration_candidates.push(agent_id.to_string());
        if let Some(hint) = upstream_hint {
            migration_candidates.extend(collect_segment_candidates_from_payload(hint));
        } else {
            let detail_path = format!("/api/agents/{agent_id}");
            if let Ok(detail) = state.openfang.get_json(&detail_path).await {
                migration_candidates.extend(collect_segment_candidates_from_payload(&detail));
            }
        }
        migration_candidates.retain(|item| item.trim() != workspace_segment);
        migration_candidates.dedup();
        for from in migration_candidates {
            match maybe_migrate_workspace_dir(&from, &workspace_segment) {
                Ok(true) => break,
                Ok(false) => continue,
                Err(err) => {
                    tracing::warn!(
                        agent_id = %agent_id,
                        from = %from,
                        to = %workspace_segment,
                        error = %err.message,
                        "workspace binding migrate failed"
                    );
                    break;
                }
            }
        }
    }
    let private_workspace = path_resolver::workspaces_root()
        .map_err(storage_error)?
        .join(&workspace_segment);
    let shared_workspace = path_resolver::webot_home_dir()
        .map_err(storage_error)?
        .join("shared");

    let mut seen = HashSet::new();
    seen.insert(path_identity_key(&private_workspace));
    seen.insert(path_identity_key(&shared_workspace));

    let mut extra_workspaces = Vec::new();
    let extra_rows =
        assignment_store::list_agent_workspace_folders(agent_id).map_err(storage_error)?;
    for row in extra_rows {
        if let Some(path) = parse_workspace_absolute_path(&row) {
            let key = path_identity_key(&path);
            if seen.insert(key) {
                extra_workspaces.push(path);
            }
        }
    }

    let mut all_paths = vec![private_workspace.clone(), shared_workspace.clone()];
    all_paths.extend(extra_workspaces.iter().cloned());
    ensure_workspace_dirs(&all_paths)?;

    Ok(AgentWorkspaceBinding {
        server_name: workspace_mcp_server_name(agent_id),
        private_workspace,
        shared_workspace,
        extra_workspaces,
    })
}

fn build_workspace_mcp_entry(private_workspace: &PathBuf, workspaces: &[PathBuf]) -> Value {
    let mut args = vec![
        "-y".to_string(),
        "@modelcontextprotocol/server-filesystem".to_string(),
    ];
    for workspace in workspaces {
        args.push(path_to_string(workspace));
    }

    json!({
        "timeout_secs": WORKSPACE_MCP_TIMEOUT_SECS,
        "transport": {
            "type": "stdio",
            "command": "npx",
            "args": args,
            "cwd": path_to_string(private_workspace)
        }
    })
}

async fn collect_workspace_mcp_server_map(
    state: &Arc<AppState>,
) -> Result<HashMap<String, Value>, ApiError> {
    let hidden_agent_ids = assignment_store::list_hidden_agent_ids()
        .map_err(storage_error)?
        .into_iter()
        .collect::<HashSet<_>>();
    let payload = state.openfang.get_json("/api/agents").await?;
    let rows = payload.as_array().cloned().unwrap_or_default();
    let mut map = HashMap::new();

    for row in rows {
        let Some(agent_id) = row
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if validate_agent_path_segment(agent_id).is_err() {
            continue;
        }
        if hidden_agent_ids.contains(agent_id) {
            continue;
        }
        let binding = resolve_agent_workspace_binding(state, agent_id, Some(&row)).await?;
        map.insert(
            binding.server_name.clone(),
            build_workspace_mcp_entry(&binding.private_workspace, &binding.all_workspaces()),
        );
    }

    Ok(map)
}

async fn collect_agent_workspace_segments(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<Vec<String>, ApiError> {
    let mut output = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let push = |raw: &str, output: &mut Vec<String>, seen: &mut HashSet<String>| {
        if let Some(segment) = normalize_workspace_segment(raw) {
            let key = segment.to_ascii_lowercase();
            if seen.insert(key) {
                output.push(segment);
            }
        }
    };

    push(agent_id, &mut output, &mut seen);
    if let Some(profile) =
        assignment_store::get_agent_profile_override(agent_id).map_err(storage_error)?
    {
        if let Some(english_name) = profile.english_name {
            push(&english_name, &mut output, &mut seen);
        }
    }

    let detail_path = format!("/api/agents/{agent_id}");
    if let Ok(detail) = state.openfang.get_json(&detail_path).await {
        if let Some(name) = detail.get("name").and_then(Value::as_str) {
            push(name, &mut output, &mut seen);
        }
        if let Some(english_name) = detail.get("english_name").and_then(Value::as_str) {
            push(english_name, &mut output, &mut seen);
        }
    }

    if output.is_empty() {
        push(agent_id, &mut output, &mut seen);
    }
    Ok(output)
}

async fn resolve_agent_memory_dir_smart(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<PathBuf, ApiError> {
    validate_agent_path_segment(agent_id)?;
    let workspaces_root = path_resolver::workspaces_root().map_err(storage_error)?;
    let candidates = collect_agent_workspace_segments(state, agent_id).await?;

    let mut picked: Option<(PathBuf, usize)> = None;
    for segment in &candidates {
        let memory_dir = workspaces_root.join(segment).join("memory");
        if !memory_dir.is_dir() {
            continue;
        }
        let score = collect_markdown_files(&memory_dir)
            .map(|files| files.len())
            .unwrap_or(0);
        match &picked {
            Some((_, best_score)) if score <= *best_score => {}
            _ => picked = Some((memory_dir, score)),
        }
    }

    if let Some((dir, _)) = picked {
        return Ok(dir);
    }

    // 没有任何可用目录时，退回 agent_id 工作区并创建。
    let fallback = workspaces_root.join(agent_id).join("memory");
    fs::create_dir_all(&fallback).map_err(|e| storage_error(format!("创建记忆目录失败: {e}")))?;
    Ok(fallback)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn system_time_to_millis(value: SystemTime) -> i64 {
    value
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn normalize_memory_relative_path(raw: &str) -> Result<String, ApiError> {
    let normalized = raw.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "path 不能为空",
        ));
    }

    let mut segments: Vec<String> = Vec::new();
    for segment in normalized.split('/') {
        let part = segment.trim();
        if part.is_empty() || part == "." || part == ".." {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "path 非法（不允许空路径、. 或 ..）",
            ));
        }
        if part.contains(':') {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "path 非法（不允许绝对路径）",
            ));
        }
        segments.push(part.to_string());
    }

    let joined = segments.join("/");
    let is_markdown = StdPath::new(&joined)
        .extension()
        .and_then(OsStr::to_str)
        .map(|ext| ext.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if !is_markdown {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "仅支持 .md 记忆文件",
        ));
    }

    Ok(joined)
}

fn resolve_memory_file_path(memory_root: &StdPath, relative_path: &str) -> PathBuf {
    relative_path
        .split('/')
        .fold(memory_root.to_path_buf(), |mut output, segment| {
            output.push(segment);
            output
        })
}

fn to_memory_relative_path(memory_root: &StdPath, absolute_path: &StdPath) -> Option<String> {
    let relative = absolute_path.strip_prefix(memory_root).ok()?;
    let mut segments = Vec::new();
    for component in relative.components() {
        let std::path::Component::Normal(part) = component else {
            return None;
        };
        let segment = part.to_string_lossy().trim().to_string();
        if segment.is_empty() {
            return None;
        }
        segments.push(segment);
    }
    if segments.is_empty() {
        None
    } else {
        Some(segments.join("/"))
    }
}

fn collect_markdown_files(root: &StdPath) -> Result<Vec<PathBuf>, ApiError> {
    let mut output = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        let entries = fs::read_dir(&current_dir).map_err(|e| {
            storage_error(format!(
                "读取记忆目录失败({}): {e}",
                current_dir.to_string_lossy()
            ))
        })?;

        for entry in entries {
            let entry = entry.map_err(|e| storage_error(format!("读取记忆目录项失败: {e}")))?;
            let file_type = entry.file_type().map_err(|e| {
                storage_error(format!("读取文件类型失败({}): {e}", entry.path().display()))
            })?;
            let path = entry.path();
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let is_markdown = path
                .extension()
                .and_then(OsStr::to_str)
                .map(|ext| ext.eq_ignore_ascii_case("md"))
                .unwrap_or(false);
            if is_markdown {
                output.push(path);
            }
        }
    }

    Ok(output)
}

fn detect_avatar_ext_from_name(filename: &str) -> Option<&'static str> {
    let ext = StdPath::new(filename)
        .extension()
        .and_then(OsStr::to_str)
        .map(|v| v.to_ascii_lowercase())?;
    match ext.as_str() {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpg"),
        "gif" => Some("gif"),
        "webp" => Some("webp"),
        "bmp" => Some("bmp"),
        _ => None,
    }
}

fn detect_avatar_ext_from_content_type(content_type: &str) -> Option<&'static str> {
    let normalized = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" => Some("bmp"),
        _ => None,
    }
}

fn detect_avatar_ext_from_magic(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Some("png");
    }
    if bytes.len() >= 3 && bytes.starts_with(&[255, 216, 255]) {
        return Some("jpg");
    }
    if bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return Some("gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.len() >= 2 && bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    None
}

fn avatar_content_type(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

fn build_avatar_url(agent_id: &str, filename: &str) -> String {
    format!("/api/management/agents/{agent_id}/avatar/{filename}")
}

fn chat_asset_kind_from_name(filename: &str) -> &'static str {
    let ext = StdPath::new(filename)
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "avif" => "image",
        "mp4" | "webm" | "mov" | "m4v" | "avi" | "mkv" => "video",
        "mp3" | "wav" | "ogg" | "m4a" | "flac" => "audio",
        _ => "file",
    }
}

fn chat_asset_content_type(filename: &str) -> &'static str {
    let ext = StdPath::new(filename)
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "txt" | "log" | "md" => "text/plain; charset=utf-8",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "csv" => "text/csv; charset=utf-8",
        "zip" => "application/zip",
        "rar" => "application/vnd.rar",
        "7z" => "application/x-7z-compressed",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn parse_http_byte_range_header(range_header: &str, file_size: u64) -> Result<(u64, u64), ()> {
    if file_size == 0 {
        return Err(());
    }
    let trimmed = range_header.trim();
    let Some(spec) = trimmed.strip_prefix("bytes=") else {
        return Err(());
    };
    if spec.contains(',') {
        return Err(());
    }
    let Some((raw_start, raw_end)) = spec.split_once('-') else {
        return Err(());
    };
    if raw_start.is_empty() {
        let suffix_len = raw_end.parse::<u64>().map_err(|_| ())?;
        if suffix_len == 0 {
            return Err(());
        }
        let start = file_size.saturating_sub(suffix_len);
        return Ok((start, file_size - 1));
    }

    let start = raw_start.parse::<u64>().map_err(|_| ())?;
    if start >= file_size {
        return Err(());
    }
    let end = if raw_end.trim().is_empty() {
        file_size - 1
    } else {
        let parsed = raw_end.parse::<u64>().map_err(|_| ())?;
        if parsed < start {
            return Err(());
        }
        parsed.min(file_size - 1)
    };
    Ok((start, end))
}

fn read_file_byte_range(path: &StdPath, start: u64, end: u64) -> Result<Vec<u8>, ApiError> {
    let len = end
        .checked_sub(start)
        .and_then(|value| value.checked_add(1))
        .ok_or_else(|| storage_error("读取附件分片范围非法"))?;
    let mut file = fs::File::open(path)
        .map_err(|e| storage_error(format!("打开聊天附件失败({}): {e}", path.display())))?;
    file.seek(SeekFrom::Start(start))
        .map_err(|e| storage_error(format!("定位聊天附件失败({}): {e}", path.display())))?;
    let mut buffer = vec![
        0u8;
        usize::try_from(len)
            .map_err(|_| storage_error("附件分片过大，无法读取"))?
    ];
    file.read_exact(&mut buffer)
        .map_err(|e| storage_error(format!("读取聊天附件分片失败({}): {e}", path.display())))?;
    Ok(buffer)
}

fn sanitize_chat_asset_filename(raw: Option<&str>) -> String {
    let fallback = "upload.bin".to_string();
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return fallback;
    };

    let file_name = StdPath::new(value)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("upload.bin")
        .trim();
    if file_name.is_empty() {
        return fallback;
    }

    let mut stem = String::new();
    let mut ext = String::new();
    let mut saw_dot = false;
    for ch in file_name.chars() {
        if ch == '.' && !saw_dot {
            saw_dot = true;
            continue;
        }
        let target = if saw_dot { &mut ext } else { &mut stem };
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            target.push(ch);
        } else {
            target.push('_');
        }
    }

    stem = stem.trim_matches('_').to_string();
    ext = ext.trim_matches('_').to_string();
    if stem.is_empty() {
        stem = "upload".to_string();
    }
    if ext.is_empty() {
        format!("{stem}.bin")
    } else {
        format!("{stem}.{ext}")
    }
}

fn build_agent_chat_asset_url(agent_id: &str, relative_path: &str) -> String {
    format!("/api/management/agents/{agent_id}/chat-assets/file?path={relative_path}")
}

fn build_portrait_url(agent_id: &str, filename: &str) -> String {
    format!("/api/management/agents/{agent_id}/portrait/{filename}")
}

async fn index_agent_photo_asset_best_effort(
    agent_id: &str,
    source_tool: &str,
    purpose: &str,
    image_url: &str,
    file_name: &str,
    saved_path: &str,
) {
    if let Err(err) = media_index::index_photo_asset(PhotoIndexRequest {
        agent_id: Some(agent_id.to_string()),
        owner_scope: "self".to_string(),
        asset_family: "photo".to_string(),
        media_kind: "image".to_string(),
        source_tool: source_tool.to_string(),
        purpose: Some(purpose.to_string()),
        prompt_text: None,
        negative_prompt: None,
        model: None,
        mime_type: None,
        file_name: Some(file_name.to_string()),
        saved_path: saved_path.to_string(),
        image_url: Some(image_url.to_string()),
        relative_path: None,
        metadata: json!({
            "source": "agent_appearance",
            "appearance_kind": purpose,
        }),
    })
    .await
    {
        tracing::warn!(
            agent_id = %agent_id,
            source_tool = %source_tool,
            purpose = %purpose,
            error = %err,
            "failed to index agent appearance photo"
        );
    }
}

async fn resolve_agent_chat_upload_root(
    state: &Arc<AppState>,
    agent_id: &str,
    upstream_hint: Option<&Value>,
) -> Result<PathBuf, ApiError> {
    let binding = resolve_agent_workspace_binding(state, agent_id, upstream_hint).await?;
    let data_root = binding.private_workspace.join("data");
    let chat_root = data_root.join(CHAT_UPLOAD_DIR_NAME);
    fs::create_dir_all(&chat_root).map_err(|e| {
        storage_error(format!(
            "创建聊天附件目录失败({}): {e}",
            chat_root.display()
        ))
    })?;
    Ok(chat_root)
}

async fn save_agent_chat_asset_bytes(
    state: &Arc<AppState>,
    agent_id: &str,
    filename_hint: Option<&str>,
    bytes: &[u8],
    upstream_hint: Option<&Value>,
) -> Result<
    (
        String,
        String,
        String,
        String,
        String,
        String,
        usize,
        Option<String>,
        String,
    ),
    ApiError,
> {
    use sha2::{Digest, Sha256};

    if bytes.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "上传文件为空",
        ));
    }
    if bytes.len() > MAX_CHAT_ASSET_SIZE {
        return Err(ApiError::new(
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "附件过大（最大 {} MB）",
                MAX_CHAT_ASSET_SIZE / (1024 * 1024)
            ),
        ));
    }

    let safe_name = sanitize_chat_asset_filename(filename_hint);
    let upload_root = resolve_agent_chat_upload_root(state, agent_id, upstream_hint).await?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let day_bucket = now / 86_400_000;
    let file_name = format!("{now}-{safe_name}");
    let relative_path = format!("{CHAT_UPLOAD_DIR_NAME}/{day_bucket}/{file_name}");
    let target = upload_root.join(day_bucket.to_string()).join(&file_name);

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| storage_error(format!("创建附件子目录失败({}): {e}", parent.display())))?;
    }
    fs::write(&target, bytes).map_err(|e| storage_error(format!("写入聊天附件失败: {e}")))?;

    let kind = chat_asset_kind_from_name(&file_name).to_string();
    let mime_type = chat_asset_content_type(&file_name).to_string();
    let sha256 = format!("{:x}", Sha256::digest(bytes));
    let asset_url = build_agent_chat_asset_url(agent_id, &relative_path);
    let upstream_file_id =
        mirror_agent_chat_asset_to_openfang(state, agent_id, &file_name, &mime_type, bytes).await;
    Ok((
        asset_url,
        file_name,
        relative_path,
        target.to_string_lossy().to_string(),
        kind,
        mime_type,
        bytes.len(),
        upstream_file_id,
        sha256,
    ))
}

async fn mirror_agent_chat_asset_to_openfang(
    state: &Arc<AppState>,
    agent_id: &str,
    filename: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Option<String> {
    let path = format!("/api/agents/{agent_id}/upload");
    let headers = vec![("X-Filename".to_string(), filename.to_string())];
    match state
        .openfang
        .post_bytes_json(&path, bytes.to_vec(), Some(mime_type), &headers)
        .await
    {
        Ok(payload) => payload
            .get("file_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        Err(error) => {
            tracing::warn!(
                agent_id = %agent_id,
                filename = %filename,
                mime_type = %mime_type,
                error = %error.message,
                "chat asset mirror to OpenFang upload skipped"
            );
            None
        }
    }
}

async fn save_agent_avatar_bytes(
    state: &Arc<AppState>,
    agent_id: &str,
    filename_hint: Option<&str>,
    content_type_hint: Option<&str>,
    bytes: &[u8],
    upstream_hint: Option<&Value>,
) -> Result<(String, String, String), ApiError> {
    if bytes.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "头像文件为空",
        ));
    }
    if bytes.len() > MAX_AVATAR_SIZE {
        return Err(ApiError::new(
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            format!("头像过大（最大 {} MB）", MAX_AVATAR_SIZE / (1024 * 1024)),
        ));
    }

    let ext = filename_hint
        .and_then(detect_avatar_ext_from_name)
        .or_else(|| content_type_hint.and_then(detect_avatar_ext_from_content_type))
        .or_else(|| detect_avatar_ext_from_magic(bytes))
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "不支持的头像格式，仅支持 png/jpg/gif/webp/bmp",
            )
        })?;

    let avatar_dir = resolve_agent_avatar_dir(state, agent_id, upstream_hint).await?;
    let tick = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let filename = format!("avatar-{tick}.{ext}");
    let target = avatar_dir.join(&filename);
    fs::write(&target, bytes).map_err(|e| storage_error(format!("写入头像失败: {e}")))?;

    let url = build_avatar_url(agent_id, &filename);
    Ok((url, filename, target.to_string_lossy().to_string()))
}

async fn save_agent_portrait_bytes(
    state: &Arc<AppState>,
    agent_id: &str,
    filename_hint: Option<&str>,
    content_type_hint: Option<&str>,
    bytes: &[u8],
    upstream_hint: Option<&Value>,
) -> Result<(String, String, String), ApiError> {
    if bytes.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "立绘文件为空",
        ));
    }
    if bytes.len() > MAX_AVATAR_SIZE {
        return Err(ApiError::new(
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            format!("立绘过大（最大 {} MB）", MAX_AVATAR_SIZE / (1024 * 1024)),
        ));
    }

    let ext = filename_hint
        .and_then(detect_avatar_ext_from_name)
        .or_else(|| content_type_hint.and_then(detect_avatar_ext_from_content_type))
        .or_else(|| detect_avatar_ext_from_magic(bytes))
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "不支持的立绘格式，仅支持 png/jpg/gif/webp/bmp",
            )
        })?;

    let portrait_dir = resolve_agent_portrait_dir(state, agent_id, upstream_hint).await?;
    let tick = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let filename = format!("portrait-{tick}.{ext}");
    let target = portrait_dir.join(&filename);
    fs::write(&target, bytes).map_err(|e| storage_error(format!("写入立绘失败: {e}")))?;

    let url = build_portrait_url(agent_id, &filename);
    Ok((url, filename, target.to_string_lossy().to_string()))
}

pub async fn list_agents(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    tracing::info!("route /api/management/agents started");
    ensure_online(&state).await?;
    tracing::info!("route /api/management/agents after ensure_online");
    let mut data = state.openfang.get_json("/api/agents").await?;
    tracing::info!("route /api/management/agents upstream /api/agents returned");
    let profiles = assignment_store::list_agent_profile_overrides().map_err(storage_error)?;
    let hidden = assignment_store::list_hidden_agent_ids()
        .map_err(storage_error)?
        .into_iter()
        .collect::<HashSet<_>>();
    if let Some(rows) = data.as_array_mut() {
        rows.retain(|row| {
            let agent_id = row
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_default();
            !agent_id.is_empty() && !hidden.contains(&agent_id)
        });
        for row in rows {
            let is_nuwa = is_nuwa_agent_row(row);
            let agent_id = row
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_default();
            if agent_id.is_empty() {
                continue;
            }
            // 列表接口只负责返回摘要，避免在首屏阶段串行触发工作空间/媒体目录迁移。
            // 这类磁盘整理在详情页或真正读写媒体资产时再懒执行，避免把桌面启动链路拖死。
            if let Some(profile) = profiles.get(&agent_id) {
                merge_agent_profile_override(row, profile);
            }
            if is_nuwa {
                if let Some(object) = row.as_object_mut() {
                    object.insert(
                        "resolved_agent_id".to_string(),
                        Value::String(agent_id.clone()),
                    );
                    object.insert(
                        "id".to_string(),
                        Value::String(DEFAULT_NUWA_AGENT_ID.to_string()),
                    );
                }
            }
        }
    }
    tracing::info!("route /api/management/agents finished");
    Ok(Json(data))
}

pub async fn list_agent_assignments(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    assignment_store::ensure_db().map_err(storage_error)?;

    let (agents_res, skills_res, mcp_servers_res) = tokio::join!(
        state.openfang.get_json("/api/agents"),
        state.openfang.get_json("/api/skills"),
        state.openfang.get_json("/api/mcp/servers")
    );

    let mut errors = serde_json::Map::new();
    let agents = unwrap_or_record("agents", agents_res, &mut errors);
    let global_skills = unwrap_or_record("global_skills", skills_res, &mut errors);
    let mut global_mcp_servers =
        unwrap_or_record("global_mcp_servers", mcp_servers_res, &mut errors);
    strip_workspace_mcp_servers_payload(&mut global_mcp_servers);
    let hidden_agent_ids = assignment_store::list_hidden_agent_ids()
        .map_err(storage_error)?
        .into_iter()
        .collect::<HashSet<_>>();

    let agent_rows = agents
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|agent| {
            let agent_id = agent
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_default();
            !agent_id.is_empty() && !hidden_agent_ids.contains(&agent_id)
        })
        .collect::<Vec<_>>();
    let openfang = state.openfang.clone();
    let jobs = agent_rows.into_iter().map(move |agent| {
        let openfang = openfang.clone();
        async move {
            let mut row_errors = serde_json::Map::new();
            let mut agent = agent;
            let agent_id = agent
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_default();
            let is_nuwa = is_nuwa_agent_row(&agent);

            if agent_id.is_empty() {
                row_errors.insert("agent".to_string(), json!("agent id 缺失"));
                return json!({
                    "agent": agent,
                    "skills": Value::Null,
                    "mcp_servers": Value::Null,
                    "errors": row_errors
                });
            }

            let skills_path = format!("/api/agents/{agent_id}/skills");
            let mcp_path = format!("/api/agents/{agent_id}/mcp_servers");
            let (skills_res, mcp_res) = tokio::join!(
                openfang.get_json(&skills_path),
                openfang.get_json(&mcp_path)
            );

            let skills = unwrap_or_record("skills", skills_res, &mut row_errors);
            let mut mcp_servers = unwrap_or_record("mcp_servers", mcp_res, &mut row_errors);
            strip_workspace_mcp_servers_payload(&mut mcp_servers);
            let desired_skills = match assignment_store::list_agent_enabled_skills(&agent_id) {
                Ok(value) => value,
                Err(err) => {
                    row_errors.insert("desired_skills".to_string(), json!(err));
                    Vec::new()
                }
            };
            let desired_mcp_servers =
                match assignment_store::list_agent_enabled_mcp_servers(&agent_id) {
                    Ok(value) => value
                        .into_iter()
                        .filter(|name| !is_system_hidden_mcp_server(name))
                        .collect::<Vec<_>>(),
                    Err(err) => {
                        row_errors.insert("desired_mcp_servers".to_string(), json!(err));
                        Vec::new()
                    }
                };

            if is_nuwa {
                if let Some(object) = agent.as_object_mut() {
                    object.insert(
                        "id".to_string(),
                        Value::String(DEFAULT_NUWA_AGENT_ID.to_string()),
                    );
                }
            }

            json!({
                "agent": agent,
                "skills": skills,
                "mcp_servers": mcp_servers,
                "desired": {
                    "skills": desired_skills,
                    "mcp_servers": desired_mcp_servers
                },
                "errors": row_errors
            })
        }
    });

    let items = join_all(jobs).await;
    let item_error_count = items
        .iter()
        .map(|item| {
            item.get("errors")
                .and_then(Value::as_object)
                .map(|v| v.len())
                .unwrap_or(0)
        })
        .sum::<usize>();
    let total_error_count = errors.len() + item_error_count;
    let status = if total_error_count == 0 {
        "ok"
    } else {
        "partial"
    };

    Ok(Json(json!({
        "status": status,
        "summary": {
            "agentCount": items.len(),
            "errorCount": total_error_count
        },
        "global": {
            "skills": global_skills,
            "mcp_servers": global_mcp_servers,
            "storage": {
                "dbPath": assignment_store::ensure_db()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| "unavailable".to_string())
            }
        },
        "items": items,
        "errors": errors
    })))
}

pub async fn create_agent(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateAgentRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let manifest_toml = payload.manifest_toml.clone();
    let mut preferred_workspace_segment: Option<String> = None;
    if let Ok(parsed) = manifest_toml.parse::<toml::Value>() {
        preferred_workspace_segment = parsed
            .get("name")
            .and_then(toml::Value::as_str)
            .map(str::trim)
            .filter(|value| is_valid_english_name(value))
            .and_then(normalize_workspace_segment);
    }
    let body = json!({
        "manifest_toml": manifest_toml
    });
    let mut data = state.openfang.post_json("/api/agents", body).await?;
    let created_agent_id = data
        .get("agent_id")
        .or_else(|| data.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    if let Some(agent_id) = created_agent_id {
        let _ = assignment_store::set_agent_hidden(&agent_id, false);
        if let Some(english_name) = preferred_workspace_segment.clone() {
            let _ = assignment_store::upsert_agent_profile_override(
                &agent_id,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(english_name),
                None,
                None,
                None,
            );
        }
        let workspace_result =
            resolve_agent_workspace_binding(&state, &agent_id, Some(&data)).await;
        let model_result = normalize_agent_model_selector_if_needed(&state, &agent_id).await;
        let context_sync_result = sync_agent_context_files(&state, &agent_id, true).await;
        let default_skill_result = enable_default_global_skills_for_agent(&agent_id);
        let _ = sync_provider_configs_to_runtime(&state).await;
        let sync_result = sync_active_mcp_servers_to_runtime(&state).await;
        let assignment_result = sync_agent_mcp_assignments(&state, &agent_id).await;
        let mut warnings = Vec::new();
        if let Err(err) = workspace_result {
            warnings.push(format!("创建默认工作空间失败：{}", err.message));
        }
        if let Err(err) = model_result {
            warnings.push(format!("初始化模型配置失败：{}", err.message));
        }
        if let Err(err) = context_sync_result {
            warnings.push(format!("初始化身份文件失败：{}", err.message));
        }
        if let Err(err) = default_skill_result {
            warnings.push(format!("默认启用 ui-skill 失败：{err}"));
        }
        if let Err(err) = sync_result {
            warnings.push(format!("同步 MCP 配置失败：{}", err.message));
        }
        if let Err(err) = assignment_result {
            warnings.push(format!("同步 Agent MCP 分配失败：{}", err.message));
        }
        if !warnings.is_empty() {
            if let Some(object) = data.as_object_mut() {
                object.insert(
                    "workspace_warning".to_string(),
                    Value::String(warnings.join("；")),
                );
            }
        }
    }

    Ok(Json(data))
}

pub async fn get_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let path = format!("/api/agents/{}", resolved.resolved);
    let mut data = state.openfang.get_json(&path).await?;
    let profile =
        assignment_store::get_agent_profile_override(&resolved.resolved).map_err(storage_error)?;
    if let Some(profile) = profile.as_ref() {
        merge_agent_profile_override(&mut data, &profile);
    }
    let embodiment =
        load_agent_embodiment_value(&state, &resolved.resolved, profile.as_ref()).await?;
    if let Some(object) = data.as_object_mut() {
        object.insert("embodiment".to_string(), embodiment);
    }
    if resolved.alias_used {
        if let Some(object) = data.as_object_mut() {
            object.insert(
                "resolved_agent_id".to_string(),
                Value::String(resolved.resolved.clone()),
            );
            object.insert(
                "id".to_string(),
                Value::String(DEFAULT_NUWA_AGENT_ID.to_string()),
            );
        }
    }
    Ok(Json(data))
}

pub async fn update_agent_config(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved.clone();
    let public_id = resolved.requested.clone();
    let mut overrides = extract_profile_override_patch(&payload);
    let current_override =
        assignment_store::get_agent_profile_override(&agent_id).map_err(storage_error)?;
    let embodiment_payload = payload.get("embodiment").cloned();
    let mut workspace_migration_from: Option<String> = None;
    let mut workspace_migration_to: Option<String> = None;

    let normalized_embodiment = if let Some(raw) = embodiment_payload.as_ref() {
        if raw.is_null() {
            Some(default_embodiment_json())
        } else {
            let photo_assets =
                assignment_store::list_media_assets(assignment_store::MediaAssetListQuery {
                    agent_id: Some(agent_id.clone()),
                    owner_scope: None,
                    asset_family: Some("photo".to_string()),
                    media_kind: Some("image".to_string()),
                    query: None,
                    limit: Some(64),
                })
                .map_err(storage_error)?;
            Some(normalize_embodiment_json(
                Some(raw),
                current_override.as_ref(),
                &photo_assets,
            ))
        }
    } else {
        None
    };
    if let Some(embodiment) = normalized_embodiment.as_ref() {
        let (avatar_url, portrait_url, speaker_profile_id) = embodiment_mirror_fields(embodiment);
        overrides.avatar_url = Some(avatar_url.unwrap_or_default());
        overrides.portrait_url = Some(portrait_url.unwrap_or_default());
        let mut merged_tts_config = overrides
            .tts_config
            .clone()
            .filter(Value::is_object)
            .or_else(|| {
                current_override
                    .as_ref()
                    .and_then(|item| item.tts_config.clone())
                    .filter(Value::is_object)
            })
            .unwrap_or_else(|| json!({}));
        if let Some(object) = merged_tts_config.as_object_mut() {
            if let Some(value) = speaker_profile_id {
                object.insert("speakerProfileId".to_string(), Value::String(value));
                if !object.contains_key("enabled") {
                    object.insert("enabled".to_string(), Value::Bool(true));
                }
                if !object.contains_key("serviceMode") && !object.contains_key("service_mode") {
                    object.insert(
                        "serviceMode".to_string(),
                        Value::String("inherit_global".to_string()),
                    );
                }
            } else {
                object.remove("speakerProfileId");
                object.remove("speaker_profile_id");
            }
        }
        overrides.tts_config = Some(merged_tts_config);
    }

    if let Some(requested_english_name) = overrides.english_name.clone() {
        let requested = requested_english_name.trim().to_string();
        if requested.is_empty() {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "英文名称不能为空",
            ));
        }
        if !is_valid_english_name(&requested) {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "英文名称仅支持小写英文、数字和中杠（-）",
            ));
        }
        let current_override_english_name = current_override
            .clone()
            .and_then(|record| record.english_name)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if let Some(current) = current_override_english_name {
            if requested != current {
                if looks_like_uuid(&current) {
                    workspace_migration_from = Some(current.clone());
                    workspace_migration_to = Some(requested.clone());
                    overrides.english_name = Some(requested);
                } else {
                    return Err(ApiError::new(
                        axum::http::StatusCode::BAD_REQUEST,
                        "英文名称创建后不可修改（涉及工作区路径）",
                    ));
                }
            } else {
                overrides.english_name = None;
            }
        } else {
            overrides.english_name = Some(requested);
            workspace_migration_to = overrides.english_name.clone();
        }
    }

    let mut acl_local_callee_ids: Option<Vec<String>> = None;
    if let Some(collaboration_value) = overrides.collaboration.as_mut() {
        if let Some(collaboration_object) = collaboration_value.as_object_mut() {
            let discoverable = collaboration_object
                .get("discoverable")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let dispatch_enabled = collaboration_object
                .get("dispatchEnabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let selected_worker_keys = collaboration_object
                .get("selectedWorkers")
                .and_then(Value::as_array)
                .map(|items| sanitize_collaboration_worker_keys(items))
                .unwrap_or_default()
                .into_iter()
                .filter(|item| {
                    item != &format!("local:{public_id}") && item != &format!("local:{agent_id}")
                })
                .collect::<Vec<String>>();
            collaboration_object.insert("selectedWorkers".to_string(), json!(selected_worker_keys));

            let mut next_tags = overrides
                .tags
                .clone()
                .or_else(|| current_override.as_ref().and_then(|item| item.tags.clone()))
                .unwrap_or_default();
            upsert_tag_case_insensitive(&mut next_tags, COLLAB_TAG_DISCOVERABLE, discoverable);
            upsert_tag_case_insensitive(&mut next_tags, COLLAB_TAG_DISPATCHER, dispatch_enabled);
            overrides.tags = Some(next_tags);

            acl_local_callee_ids = if dispatch_enabled {
                Some(parse_local_worker_ids(
                    &collaboration_object
                        .get("selectedWorkers")
                        .and_then(Value::as_array)
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(Value::as_str)
                                .map(ToString::to_string)
                                .collect::<Vec<String>>()
                        })
                        .unwrap_or_default(),
                ))
            } else {
                Some(Vec::new())
            };
            if let Some(callee_ids) = acl_local_callee_ids.as_mut() {
                let needs_alias = callee_ids
                    .iter()
                    .any(|value| value.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID));
                if needs_alias {
                    let nuwa_id = resolve_nuwa_agent_id(&state).await?;
                    for callee_id in callee_ids.iter_mut() {
                        if callee_id.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID) {
                            *callee_id = nuwa_id.clone();
                        }
                    }
                }
            }
        }
    }

    let mut forwarded_payload = payload;
    if let Some(object) = forwarded_payload.as_object_mut() {
        // 这几个字段由 webot 本地覆盖管理，不直接透传给 openfang，避免 URL 校验和自定义字段冲突。
        object.remove("avatar_url");
        object.remove("portrait_url");
        object.remove("english_name");
        object.remove("nickname");
        object.remove("collaboration");
        object.remove("channel_binding");
        object.remove("tts_config");
        object.remove("speaker_profiles");
        object.remove("embodiment");
        if let Some(tags) = overrides.tags.as_ref() {
            object.insert("tags".to_string(), json!(tags));
        }
    }
    let path = format!("/api/agents/{agent_id}/config");
    let mut data = state.openfang.patch_json(&path, forwarded_payload).await?;
    let has_channel_binding = overrides.channel_binding.is_some();
    if overrides.tags.is_some()
        || overrides.description.is_some()
        || overrides.system_prompt.is_some()
        || overrides.collaboration.is_some()
        || overrides.channel_binding.is_some()
        || overrides.avatar_url.is_some()
        || overrides.portrait_url.is_some()
        || overrides.english_name.is_some()
        || overrides.nickname.is_some()
        || overrides.tts_config.is_some()
        || overrides.speaker_profiles.is_some()
    {
        assignment_store::upsert_agent_profile_override(
            &agent_id,
            overrides.tags,
            overrides.description,
            overrides.system_prompt,
            overrides.collaboration,
            overrides.channel_binding,
            overrides.avatar_url,
            overrides.portrait_url,
            overrides.english_name,
            overrides.nickname,
            overrides.tts_config,
            overrides.speaker_profiles,
        )
        .map_err(storage_error)?;
    }
    if let Some(callee_ids) = acl_local_callee_ids {
        assignment_store::replace_agent_collaboration_acl(&agent_id, "private", &callee_ids)
            .map_err(storage_error)?;
    }
    if has_channel_binding {
        sync_channel_bindings_to_runtime(&state).await?;
    }
    if let Some(embodiment) = normalized_embodiment.as_ref() {
        let content = serde_json::to_string_pretty(embodiment)
            .map_err(|err| storage_error(format!("序列化 EMBODIMENT.json 失败: {err}")))?;
        let _ =
            persist_agent_context_file(&state, &agent_id, EMBODIMENT_CONTEXT_FILE_NAME, &content)
                .await?;
        if let Some(object) = data.as_object_mut() {
            object.insert("embodiment".to_string(), embodiment.clone());
        }
    } else {
        let embodiment =
            load_agent_embodiment_value(&state, &agent_id, current_override.as_ref()).await?;
        if let Some(object) = data.as_object_mut() {
            object.insert("embodiment".to_string(), embodiment);
        }
    }
    if let Some(to_segment) = workspace_migration_to
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let mut migrated = false;
        let mut used_from: Option<String> = None;
        let mut candidates = Vec::new();
        if let Some(from) = workspace_migration_from
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            candidates.push(from.to_string());
        }
        let detail_path = format!("/api/agents/{agent_id}");
        if let Ok(detail) = state.openfang.get_json(&detail_path).await {
            if let Some(value) = detail.get("name").and_then(Value::as_str) {
                let value = value.trim();
                if !value.is_empty() {
                    candidates.push(value.to_string());
                }
            }
        }
        candidates.push(agent_id.clone());
        candidates.retain(|item| item.trim() != to_segment);
        candidates.dedup();

        for from in candidates {
            match maybe_migrate_workspace_dir(&from, to_segment) {
                Ok(true) => {
                    migrated = true;
                    used_from = Some(from);
                    break;
                }
                Ok(false) => continue,
                Err(err) => {
                    tracing::warn!(
                        agent_id = %agent_id,
                        error = %err.message,
                        "workspace migrate failed"
                    );
                    break;
                }
            }
        }
        if migrated {
            tracing::info!(
                agent_id = %agent_id,
                from = %used_from.clone().unwrap_or_default(),
                to = %to_segment,
                "workspace migrated"
            );
        }
    }
    if resolved.alias_used {
        if let Some(object) = data.as_object_mut() {
            object.insert(
                "id".to_string(),
                Value::String(DEFAULT_NUWA_AGENT_ID.to_string()),
            );
        }
    }
    Ok(Json(data))
}

pub async fn update_agent_model(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let object = payload
        .as_object()
        .ok_or_else(|| ApiError::new(axum::http::StatusCode::BAD_REQUEST, "请求体必须是对象"))?;
    let provider = object
        .get("provider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(provider) = provider else {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "provider 不能为空",
        ));
    };
    let raw_model = object
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let Some(target_model) = raw_model else {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "model 不能为空",
        ));
    };
    let runtime_provider_ids = get_upstream_provider_ids_quick(&state).await;
    if !runtime_provider_ids.is_empty()
        && !runtime_provider_ids.contains(provider)
        && !is_local_provider_configured(provider)?
    {
        let mut providers: Vec<String> = runtime_provider_ids.into_iter().collect();
        providers.sort();
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!(
                "provider `{}` 当前运行时不支持。支持列表: {}",
                provider,
                providers.join(", ")
            ),
        ));
    }

    let mut data =
        apply_runtime_agent_model(&state, &resolved.resolved, provider, &target_model).await?;
    if resolved.alias_used {
        rewrite_agent_id_fields(&mut data, DEFAULT_NUWA_AGENT_ID);
    }
    Ok(Json(data))
}

async fn normalize_agent_model_selector_if_needed(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<bool, ApiError> {
    let detail_path = format!("/api/agents/{agent_id}");
    let detail = state.openfang.get_json(&detail_path).await?;
    let model_obj = detail.get("model").and_then(Value::as_object);
    let provider = model_obj
        .and_then(|obj| obj.get("provider"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let raw_model = model_obj
        .and_then(|obj| obj.get("model"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let current_provider = provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());
    let current_model = raw_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let provider_config_map: HashMap<String, assignment_store::ProviderConfigRecord> =
        assignment_store::list_provider_configs()
            .map_err(storage_error)?
            .into_iter()
            .map(|item| (item.provider_id.clone(), item))
            .collect();

    let target_pair = if let Some(current_model) = raw_model.as_deref() {
        if let Some((candidate_provider, candidate_model)) = current_model.split_once('/') {
            let candidate_provider = assignment_store::normalize_provider_id(candidate_provider);
            let candidate_model = candidate_model.trim();
            let matches_local_config = provider_config_map
                .get(&candidate_provider)
                .map(|cfg| {
                    cfg.models
                        .iter()
                        .any(|item| item.trim().eq_ignore_ascii_case(candidate_model))
                })
                .unwrap_or(false);
            if !candidate_provider.is_empty() && !candidate_model.is_empty() && matches_local_config
            {
                Some((candidate_provider, candidate_model.to_string()))
            } else {
                None
            }
        } else {
            None
        }
    } else if current_provider.is_none() {
        resolve_default_model_tuple().await.ok()
    } else {
        None
    };

    let Some((target_provider, target_model)) = target_pair else {
        return Ok(false);
    };
    let runtime_provider_ids = get_upstream_provider_ids_quick(state).await;
    if !runtime_provider_ids.is_empty()
        && !runtime_provider_ids.contains(target_provider.as_str())
        && !is_local_provider_configured(&target_provider)?
    {
        return Ok(false);
    }

    let provider_changed = current_provider
        .as_deref()
        .map(|value| !value.eq_ignore_ascii_case(&target_provider))
        .unwrap_or(true);
    let model_changed = current_model
        .as_deref()
        .map(|value| !value.eq_ignore_ascii_case(&target_model))
        .unwrap_or(true);

    if !provider_changed && !model_changed {
        return Ok(false);
    }

    let _ = apply_runtime_agent_model(state, agent_id, &target_provider, &target_model).await?;
    Ok(true)
}

pub async fn list_agent_context_files(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    let sync_stats = sync_agent_context_files(&state, &resolved.resolved, true).await?;

    let cached =
        assignment_store::list_agent_context_files(&resolved.resolved).map_err(storage_error)?;
    let mut items = Vec::with_capacity(KNOWN_CONTEXT_FILES.len());
    for file_name in KNOWN_CONTEXT_FILES {
        if let Some(record) = cached.get(file_name) {
            items.push(json!({
                "name": file_name,
                "content": record.content.clone(),
                "exists": true,
                "source": "sqlite",
                "updated_at": record.updated_at.clone()
            }));
            continue;
        }
        items.push(json!({
            "name": file_name,
            "content": "",
            "exists": false,
            "source": "default"
        }));
    }

    Ok(Json(json!({
        "files": items,
        "sync": sync_stats.as_json()
    })))
}

#[derive(Deserialize, Default)]
pub struct ReconcileContextFilesRequest {
    pub initialize_empty: Option<bool>,
}

pub async fn reconcile_agent_context_files(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    payload: Option<Json<ReconcileContextFilesRequest>>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let request = payload.map(|body| body.0).unwrap_or_default();
    let stats = sync_agent_context_files(
        &state,
        &resolved.resolved,
        request.initialize_empty.unwrap_or(true),
    )
    .await?;
    Ok(Json(json!({
        "status": "ok",
        "agent_id": id,
        "sync": stats.as_json()
    })))
}

pub async fn reconcile_all_agent_context_files(
    State(state): State<Arc<AppState>>,
    payload: Option<Json<ReconcileContextFilesRequest>>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let request = payload.map(|body| body.0).unwrap_or_default();
    let initialize_empty = request.initialize_empty.unwrap_or(true);
    let ids = list_upstream_agent_ids(&state).await?;

    let mut items = Vec::with_capacity(ids.len());
    let mut success_count = 0usize;
    let mut failed_count = 0usize;
    let mut total_imported_to_db = 0usize;
    let mut total_pushed_to_runtime = 0usize;
    let mut total_initialized_empty = 0usize;

    for agent_id in ids {
        match sync_agent_context_files(&state, &agent_id, initialize_empty).await {
            Ok(stats) => {
                success_count += 1;
                total_imported_to_db += stats.imported_to_db;
                total_pushed_to_runtime += stats.pushed_to_runtime;
                total_initialized_empty += stats.initialized_empty;
                items.push(json!({
                    "agent_id": agent_id,
                    "status": "ok",
                    "sync": stats.as_json()
                }));
            }
            Err(err) => {
                failed_count += 1;
                items.push(json!({
                    "agent_id": agent_id,
                    "status": "failed",
                    "error": err.message
                }));
            }
        }
    }

    let status = if failed_count == 0 { "ok" } else { "partial" };
    Ok(Json(json!({
        "status": status,
        "summary": {
            "total": success_count + failed_count,
            "success": success_count,
            "failed": failed_count,
            "imported_to_db": total_imported_to_db,
            "pushed_to_runtime": total_pushed_to_runtime,
            "initialized_empty": total_initialized_empty
        },
        "items": items
    })))
}

pub async fn get_agent_context_file(
    State(state): State<Arc<AppState>>,
    Path((id, filename)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    let normalized_file_name = normalize_context_file_name(&filename).ok_or_else(|| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "不支持的身份文件（仅允许 SOUL.md/USER.md/TOOLS.md/MEMORY.md/AGENTS.md/BOOTSTRAP.md/IDENTITY.md/HEARTBEAT.md/EMBODIMENT.json）",
        )
    })?;

    if let Some(record) =
        assignment_store::get_agent_context_file(&resolved.resolved, normalized_file_name)
            .map_err(storage_error)?
    {
        return Ok(Json(json!({
            "name": normalized_file_name,
            "content": record.content.clone(),
            "exists": true,
            "source": "sqlite",
            "updated_at": record.updated_at
        })));
    }

    let upstream =
        read_context_file_from_openfang(&state, &resolved.resolved, normalized_file_name).await?;
    if let Some(content) = upstream {
        assignment_store::upsert_agent_context_file(
            &resolved.resolved,
            normalized_file_name,
            &content,
        )
        .map_err(storage_error)?;
        return Ok(Json(json!({
            "name": normalized_file_name,
            "content": content,
            "exists": true,
            "source": "openfang"
        })));
    }

    Ok(Json(json!({
        "name": normalized_file_name,
        "content": "",
        "exists": false,
        "source": "default"
    })))
}

#[derive(Deserialize)]
pub struct SetAgentContextFileRequest {
    pub content: String,
}

async fn persist_agent_context_file(
    state: &Arc<AppState>,
    agent_id: &str,
    file_name: &'static str,
    content: &str,
) -> Result<Option<String>, ApiError> {
    if content.len() > MAX_CONTEXT_FILE_SIZE {
        return Err(ApiError::new(
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            format!("文件过大，单文件最大 {} 字节", MAX_CONTEXT_FILE_SIZE),
        ));
    }
    write_context_file_to_openfang(state, agent_id, file_name, content).await?;
    assignment_store::upsert_agent_context_file(agent_id, file_name, content)
        .map_err(storage_error)?;
    let updated_at = assignment_store::get_agent_context_file(agent_id, file_name)
        .map_err(storage_error)?
        .map(|record| record.updated_at);
    Ok(updated_at)
}

async fn persist_agent_system_prompt(
    state: &Arc<AppState>,
    agent_id: &str,
    system_prompt: &str,
) -> Result<(), ApiError> {
    let path = format!("/api/agents/{agent_id}/config");
    state
        .openfang
        .patch_json(&path, json!({ "system_prompt": system_prompt }))
        .await?;
    assignment_store::upsert_agent_profile_override(
        agent_id,
        None,
        None,
        Some(system_prompt.to_string()),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .map_err(storage_error)?;
    Ok(())
}

pub async fn set_agent_context_file(
    State(state): State<Arc<AppState>>,
    Path((id, filename)): Path<(String, String)>,
    Json(payload): Json<SetAgentContextFileRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    let normalized_file_name = normalize_context_file_name(&filename).ok_or_else(|| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "不支持的身份文件（仅允许 SOUL.md/USER.md/TOOLS.md/MEMORY.md/AGENTS.md/BOOTSTRAP.md/IDENTITY.md/HEARTBEAT.md/EMBODIMENT.json）",
        )
    })?;
    let content = payload.content;
    let updated_at =
        persist_agent_context_file(&state, &resolved.resolved, normalized_file_name, &content)
            .await?;

    Ok(Json(json!({
        "status": "ok",
        "name": normalized_file_name,
        "content": content,
        "exists": true,
        "source": "sqlite",
        "updated_at": updated_at,
        "upstream": { "status": "ok" }
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAndApplyAgentContextBundleRequest {
    pub input: String,
    pub provider: Option<String>,
    pub model: Option<String>,
}

pub async fn generate_and_apply_agent_context_bundle(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<GenerateAndApplyAgentContextBundleRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;

    let optimize_result = execute_optimize_prompt_request(
        &state,
        &OptimizePromptRequest {
            input: payload.input.clone(),
            target: Some("identity_bundle".to_string()),
            provider: payload.provider.clone(),
            model: payload.model.clone(),
            agent_id: Some(resolved.resolved.clone()),
        },
    )
    .await?;
    let parsed = complete_generated_identity_bundle(&payload.input, &optimize_result.content);

    let mut files = Vec::with_capacity(KNOWN_CONTEXT_FILES.len());
    for file_name in KNOWN_CONTEXT_FILES {
        let content = parsed
            .context_files
            .get(file_name)
            .cloned()
            .unwrap_or_default();
        let updated_at =
            persist_agent_context_file(&state, &resolved.resolved, file_name, &content).await?;
        files.push(json!({
            "name": file_name,
            "content": content,
            "exists": true,
            "source": "sqlite",
            "updated_at": updated_at,
        }));
    }

    let system_prompt = parsed.system_prompt.unwrap_or_default();
    persist_agent_system_prompt(&state, &resolved.resolved, &system_prompt).await?;

    Ok(Json(json!({
        "status": "ok",
        "agent_id": id,
        "provider": optimize_result.provider,
        "model": optimize_result.model,
        "target": optimize_result.target,
        "fallback": optimize_result.fallback,
        "error": optimize_result.error,
        "content": optimize_result.content,
        "system_prompt": system_prompt,
        "files": files
    })))
}

#[derive(Deserialize)]
pub struct ListAgentMemoryFilesQuery {
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub days: Option<i64>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
    pub keyword: Option<String>,
}

pub async fn list_agent_memory_files(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ListAgentMemoryFilesQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    let memory_root = resolve_agent_memory_dir_smart(&state, &resolved.resolved).await?;

    let now = now_millis();
    let mut end_ms = query.end_ms.unwrap_or(now);
    let mut start_ms = if let Some(start) = query.start_ms {
        start
    } else {
        let days = query
            .days
            .unwrap_or(DEFAULT_MEMORY_QUERY_DAYS)
            .clamp(1, 3650);
        end_ms.saturating_sub(days.saturating_mul(24 * 60 * 60 * 1000))
    };
    if start_ms > end_ms {
        std::mem::swap(&mut start_ms, &mut end_ms);
    }

    let page_size = query
        .page_size
        .unwrap_or(DEFAULT_MEMORY_PAGE_SIZE)
        .clamp(1, MAX_MEMORY_PAGE_SIZE);
    let page = query.page.unwrap_or(1).max(1);
    let keyword = query
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);

    let files = collect_markdown_files(&memory_root)?;
    let mut rows: Vec<(i64, Value)> = Vec::new();
    for file_path in files {
        let Some(relative_path) = to_memory_relative_path(&memory_root, &file_path) else {
            continue;
        };
        if let Some(filter) = &keyword {
            if !relative_path.to_ascii_lowercase().contains(filter) {
                continue;
            }
        }

        let metadata = fs::metadata(&file_path).map_err(|e| {
            storage_error(format!(
                "读取记忆文件元数据失败({}): {e}",
                file_path.display()
            ))
        })?;
        let modified_ms = metadata
            .modified()
            .map(system_time_to_millis)
            .unwrap_or_default();
        if modified_ms < start_ms || modified_ms > end_ms {
            continue;
        }

        let size = metadata.len();
        let name = StdPath::new(&relative_path)
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_string();
        rows.push((
            modified_ms,
            json!({
                "path": relative_path,
                "name": name,
                "size": size,
                "modified_ms": modified_ms
            }),
        ));
    }

    rows.sort_by(|a, b| b.0.cmp(&a.0));
    let total = rows.len();
    let total_pages = if total == 0 {
        0
    } else {
        (total + page_size - 1) / page_size
    };
    let start_index = (page - 1).saturating_mul(page_size);
    let items = if start_index >= total {
        Vec::new()
    } else {
        rows.into_iter()
            .skip(start_index)
            .take(page_size)
            .map(|(_, item)| item)
            .collect::<Vec<_>>()
    };

    Ok(Json(json!({
        "items": items,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages
        },
        "filter": {
            "start_ms": start_ms,
            "end_ms": end_ms,
            "default_days": DEFAULT_MEMORY_QUERY_DAYS,
            "keyword": keyword
        }
    })))
}

#[derive(Deserialize)]
pub struct AgentMemoryFilePathQuery {
    pub path: String,
}

pub async fn get_agent_memory_file(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<AgentMemoryFilePathQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    let memory_root = resolve_agent_memory_dir_smart(&state, &resolved.resolved).await?;
    let normalized_path = normalize_memory_relative_path(&query.path)?;
    let file_path = resolve_memory_file_path(&memory_root, &normalized_path);
    if !file_path.exists() || !file_path.is_file() {
        return Err(ApiError::new(
            axum::http::StatusCode::NOT_FOUND,
            "记忆文件不存在",
        ));
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| storage_error(format!("读取记忆文件失败({}): {e}", file_path.display())))?;
    let metadata = fs::metadata(&file_path).map_err(|e| {
        storage_error(format!(
            "读取记忆文件元数据失败({}): {e}",
            file_path.display()
        ))
    })?;
    let modified_ms = metadata
        .modified()
        .map(system_time_to_millis)
        .unwrap_or_default();

    Ok(Json(json!({
        "path": normalized_path,
        "content": content,
        "size": metadata.len(),
        "modified_ms": modified_ms
    })))
}

#[derive(Deserialize)]
pub struct SetAgentMemoryFileRequest {
    pub path: String,
    pub content: String,
}

pub async fn set_agent_memory_file(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<SetAgentMemoryFileRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    if payload.content.len() > MAX_MEMORY_FILE_SIZE {
        return Err(ApiError::new(
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            format!("记忆文件过大，单文件最大 {} 字节", MAX_MEMORY_FILE_SIZE),
        ));
    }

    let memory_root = resolve_agent_memory_dir_smart(&state, &resolved.resolved).await?;
    let normalized_path = normalize_memory_relative_path(&payload.path)?;
    let file_path = resolve_memory_file_path(&memory_root, &normalized_path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            storage_error(format!(
                "创建记忆文件目录失败({}): {e}",
                parent.to_string_lossy()
            ))
        })?;
    }

    fs::write(&file_path, payload.content.as_bytes())
        .map_err(|e| storage_error(format!("写入记忆文件失败({}): {e}", file_path.display())))?;
    let metadata = fs::metadata(&file_path).map_err(|e| {
        storage_error(format!(
            "读取记忆文件元数据失败({}): {e}",
            file_path.display()
        ))
    })?;
    let modified_ms = metadata
        .modified()
        .map(system_time_to_millis)
        .unwrap_or_default();

    Ok(Json(json!({
        "status": "ok",
        "path": normalized_path,
        "size": metadata.len(),
        "modified_ms": modified_ms
    })))
}

#[derive(Deserialize)]
pub struct AgentMemorySearchQuery {
    pub q: Option<String>,
    pub limit: Option<usize>,
    pub scope: Option<String>,
    pub memory_type: Option<String>,
    pub min_confidence: Option<f32>,
}

fn is_semantic_memory_endpoint_unavailable(error: &ApiError) -> bool {
    if error.status != StatusCode::NOT_FOUND {
        return false;
    }
    if !error.message.contains("/api/memory/agents/") {
        return false;
    }
    if !(error.message.contains("/search")
        || error.message.contains("/unified-search")
        || error.message.contains("/unified-debug")
        || error.message.contains("/feedback")
        || error.message.contains("/items/"))
    {
        return false;
    }

    let lower = error.message.to_lowercase();
    if lower.contains("memory not found") || lower.contains("\"error\"") {
        return false;
    }

    match error.message.rsplit_once("):") {
        Some((_, tail)) => {
            let tail = tail.trim();
            tail.is_empty() || tail.eq_ignore_ascii_case("not found")
        }
        None => false,
    }
}

fn normalize_legacy_semantic_rows(
    rows: Vec<Value>,
    min_confidence: f32,
    apply_threshold: bool,
) -> Vec<Value> {
    let mut normalized = rows
        .into_iter()
        .map(|mut row| {
            let confidence = row
                .get("confidence")
                .and_then(Value::as_f64)
                .unwrap_or_default();
            if row.get("kind").is_none() {
                row["kind"] = Value::String("semantic_memory".to_string());
            }
            if row.get("score").is_none() {
                row["score"] = Value::from(confidence);
            }
            if row.get("explain").is_none() {
                row["explain"] = json!({
                    "channel": "legacy_semantic_search",
                    "reason": "旧版 /search 兼容回退"
                });
            }
            row
        })
        .collect::<Vec<_>>();

    if apply_threshold {
        normalized.retain(|row| {
            row.get("score").and_then(Value::as_f64).unwrap_or(0.0) >= min_confidence as f64
        });
    }

    normalized
}

fn semantic_memory_unavailable_error() -> ApiError {
    ApiError::new(
        StatusCode::NOT_IMPLEMENTED,
        "当前 OpenFang 运行时未启用语义记忆接口，请升级并重启 OpenFang 后重试。",
    )
}

pub async fn search_agent_memory(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<AgentMemorySearchQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;

    let mut params: Vec<(String, String)> = Vec::new();
    if let Some(q) = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        params.push(("q".to_string(), q.to_string()));
    }
    if let Some(limit) = query.limit {
        params.push(("limit".to_string(), limit.clamp(1, 50).to_string()));
    }
    if let Some(scope) = query
        .scope
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        params.push(("scope".to_string(), scope.to_string()));
    }
    if let Some(memory_type) = query
        .memory_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        params.push(("memory_type".to_string(), memory_type.to_string()));
    }
    if let Some(min_confidence) = query.min_confidence {
        params.push((
            "min_confidence".to_string(),
            min_confidence.clamp(0.0, 1.0).to_string(),
        ));
    }

    let path = format!("/api/memory/agents/{}/search", resolved.resolved);
    match state.openfang.get_json_with_query(&path, &params).await {
        Ok(data) => Ok(Json(data)),
        Err(error) if is_semantic_memory_endpoint_unavailable(&error) => {
            let fallback_query = query.q.unwrap_or_default();
            let fallback_limit = query.limit.unwrap_or(20).clamp(1, 50);
            tracing::warn!(
                "semantic memory endpoint unavailable, fallback to empty result for agent {}: {}",
                id,
                error.message
            );
            Ok(Json(json!({
                "query": fallback_query,
                "limit": fallback_limit,
                "memories": [],
                "semantic_memory_supported": false
            })))
        }
        Err(error) => Err(error),
    }
}

pub async fn get_agent_memory_item(
    State(state): State<Arc<AppState>>,
    Path((id, memory_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    validate_memory_id_segment(&memory_id)?;
    let path = format!("/api/memory/agents/{}/items/{memory_id}", resolved.resolved);
    let data = match state.openfang.get_json(&path).await {
        Ok(data) => data,
        Err(error) if is_semantic_memory_endpoint_unavailable(&error) => {
            return Err(semantic_memory_unavailable_error());
        }
        Err(error) => return Err(error),
    };
    Ok(Json(data))
}

#[derive(Deserialize)]
pub struct AgentMemoryFeedbackRequest {
    pub memory_id: String,
    pub action: String,
    pub reason: Option<String>,
    #[serde(alias = "correctedContent")]
    pub corrected_content: Option<String>,
}

pub async fn feedback_agent_memory(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<AgentMemoryFeedbackRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    validate_memory_id_segment(&payload.memory_id)?;
    let action = payload.action.trim();
    if action.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "action 不能为空",
        ));
    }

    let path = format!("/api/memory/agents/{}/feedback", resolved.resolved);
    let body = json!({
        "memory_id": payload.memory_id.trim(),
        "action": action,
        "reason": payload.reason,
        "corrected_content": payload.corrected_content
    });
    let data = match state.openfang.post_json(&path, body).await {
        Ok(data) => data,
        Err(error) if is_semantic_memory_endpoint_unavailable(&error) => {
            return Err(semantic_memory_unavailable_error());
        }
        Err(error) => return Err(error),
    };
    Ok(Json(data))
}

pub async fn delete_agent_memory_item(
    State(state): State<Arc<AppState>>,
    Path((id, memory_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    validate_memory_id_segment(&memory_id)?;
    let path = format!("/api/memory/agents/{}/items/{memory_id}", resolved.resolved);
    let data = match state.openfang.delete_json(&path).await {
        Ok(data) => data,
        Err(error) if is_semantic_memory_endpoint_unavailable(&error) => {
            return Err(semantic_memory_unavailable_error());
        }
        Err(error) => return Err(error),
    };
    Ok(Json(data))
}

#[derive(Deserialize, Default, Clone)]
pub struct ExportAgentBundleRequest {
    #[serde(default, alias = "includeProfile")]
    pub include_profile: Option<bool>,
    #[serde(default, alias = "includeContextFiles")]
    pub include_context_files: Option<bool>,
    #[serde(default, alias = "includeMemoryFiles")]
    pub include_memory_files: Option<bool>,
    #[serde(default, alias = "includeMediaFiles")]
    pub include_media_files: Option<bool>,
    #[serde(default, alias = "includeAssignments")]
    pub include_assignments: Option<bool>,
    #[serde(default, alias = "includeChatHistory")]
    pub include_chat_history: Option<bool>,
}

#[derive(Debug, Clone)]
struct ExportAgentBundleOptions {
    include_profile: bool,
    include_context_files: bool,
    include_memory_files: bool,
    include_media_files: bool,
    include_assignments: bool,
    include_chat_history: bool,
}

fn resolve_export_flag(input: Option<bool>) -> bool {
    input.unwrap_or(true)
}

impl ExportAgentBundleOptions {
    fn from_request(request: &ExportAgentBundleRequest) -> Self {
        Self {
            include_profile: resolve_export_flag(request.include_profile),
            include_context_files: resolve_export_flag(request.include_context_files),
            include_memory_files: resolve_export_flag(request.include_memory_files),
            include_media_files: resolve_export_flag(request.include_media_files),
            include_assignments: resolve_export_flag(request.include_assignments),
            include_chat_history: resolve_export_flag(request.include_chat_history),
        }
    }

    fn any_enabled(&self) -> bool {
        self.include_profile
            || self.include_context_files
            || self.include_memory_files
            || self.include_media_files
            || self.include_assignments
            || self.include_chat_history
    }
}

fn sanitize_export_filename_segment(raw: &str) -> String {
    let mut output = String::new();
    for ch in raw.chars() {
        let valid = ch.is_ascii_alphanumeric() || ch == '-' || ch == '_';
        output.push(if valid { ch } else { '-' });
    }
    let trimmed = output.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "agent".to_string()
    } else {
        trimmed
    }
}

pub async fn export_agent_bundle(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    payload: Option<Json<ExportAgentBundleRequest>>,
) -> Result<(AxumHeaderMap, Bytes), ApiError> {
    let request = payload.map(|body| body.0).unwrap_or_default();
    export_agent_bundle_inner(state, id, request).await
}

pub async fn export_agent_bundle_get(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    query: Query<ExportAgentBundleRequest>,
) -> Result<(AxumHeaderMap, Bytes), ApiError> {
    export_agent_bundle_inner(state, id, query.0).await
}

async fn export_agent_bundle_inner(
    state: Arc<AppState>,
    id: String,
    request: ExportAgentBundleRequest,
) -> Result<(AxumHeaderMap, Bytes), ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    validate_agent_path_segment(&agent_id)?;
    let options = ExportAgentBundleOptions::from_request(&request);
    if !options.any_enabled() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "请至少选择 1 项导出内容",
        ));
    }

    let detail_path = format!("/api/agents/{agent_id}");
    let mut detail = state.openfang.get_json(&detail_path).await?;
    let profile_override =
        assignment_store::get_agent_profile_override(&agent_id).map_err(storage_error)?;
    if let Some(profile) = profile_override.as_ref() {
        merge_agent_profile_override(&mut detail, profile);
    }

    let workspace_binding =
        resolve_agent_workspace_binding(&state, &agent_id, Some(&detail)).await?;
    let workspace_name = workspace_binding
        .private_workspace
        .file_name()
        .and_then(OsStr::to_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(public_id.as_str());
    let safe_segment = sanitize_export_filename_segment(workspace_name);
    let bundle_root = format!("agent_bundle_{safe_segment}");
    let manifest_agent_id = if resolved.alias_used {
        public_id.clone()
    } else {
        agent_id.clone()
    };

    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::<u8>::new()));
    let exported_at_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();

    write_zip_json_entry(
        &mut zip,
        &format!("{bundle_root}/manifest.json"),
        &json!({
            "version": 1,
            "exported_at_unix": exported_at_unix,
            "agent_id": manifest_agent_id,
            "workspace_name": workspace_name,
            "options": {
                "include_profile": options.include_profile,
                "include_context_files": options.include_context_files,
                "include_memory_files": options.include_memory_files,
                "include_media_files": options.include_media_files,
                "include_assignments": options.include_assignments,
                "include_chat_history": options.include_chat_history
            }
        }),
    )?;

    if options.include_profile {
        write_zip_json_entry(
            &mut zip,
            &format!("{bundle_root}/profile/agent.detail.json"),
            &detail,
        )?;
        if let Some(profile) = profile_override.as_ref() {
            write_zip_json_entry(
                &mut zip,
                &format!("{bundle_root}/profile/profile_override.json"),
                &json!(profile),
            )?;
        }
    }

    if options.include_assignments {
        let hidden = assignment_store::list_hidden_agent_ids()
            .map_err(storage_error)?
            .into_iter()
            .any(|hidden_id| hidden_id == agent_id);
        let assignments = json!({
            "skills": assignment_store::list_agent_enabled_skills(&agent_id).map_err(storage_error)?,
            "mcp_servers": assignment_store::list_agent_enabled_mcp_servers(&agent_id).map_err(storage_error)?,
            "extra_workspaces": assignment_store::list_agent_workspace_folders(&agent_id).map_err(storage_error)?,
            "collaboration_acl_private": assignment_store::list_agent_collaboration_acl(&agent_id, "private").map_err(storage_error)?,
            "hidden": hidden
        });
        write_zip_json_entry(
            &mut zip,
            &format!("{bundle_root}/assignments/assignment_store.json"),
            &assignments,
        )?;
    }

    if options.include_context_files {
        let sync_stats = sync_agent_context_files(&state, &agent_id, true).await?;
        let cached =
            assignment_store::list_agent_context_files(&agent_id).map_err(storage_error)?;
        let mut index_rows = Vec::with_capacity(KNOWN_CONTEXT_FILES.len());
        for file_name in KNOWN_CONTEXT_FILES {
            let (content, exists, updated_at) = if let Some(record) = cached.get(file_name) {
                (
                    record.content.clone(),
                    true,
                    Some(record.updated_at.clone()),
                )
            } else {
                (String::new(), false, None)
            };
            write_zip_text_entry(
                &mut zip,
                &format!("{bundle_root}/context/{file_name}"),
                content.as_bytes(),
            )?;
            index_rows.push(json!({
                "name": file_name,
                "exists": exists,
                "updated_at": updated_at
            }));
        }
        write_zip_json_entry(
            &mut zip,
            &format!("{bundle_root}/context/_index.json"),
            &json!({
                "sync": sync_stats.as_json(),
                "files": index_rows
            }),
        )?;
    }

    if options.include_memory_files {
        let memory_root = resolve_agent_memory_dir_smart(&state, &agent_id).await?;
        let memory_file_count = append_directory_files_to_zip(
            &mut zip,
            &memory_root,
            &format!("{bundle_root}/memory"),
        )?;
        write_zip_json_entry(
            &mut zip,
            &format!("{bundle_root}/memory/_index.json"),
            &json!({
                "source_dir": memory_root.to_string_lossy().to_string(),
                "file_count": memory_file_count
            }),
        )?;
    }

    if options.include_media_files {
        let (avatar_dir, portrait_dir) =
            resolve_agent_media_dirs(&state, &agent_id, Some(&detail)).await?;
        let avatar_count = append_directory_files_to_zip(
            &mut zip,
            &avatar_dir,
            &format!("{bundle_root}/media/avatar"),
        )?;
        let portrait_count = append_directory_files_to_zip(
            &mut zip,
            &portrait_dir,
            &format!("{bundle_root}/media/portrait"),
        )?;
        write_zip_json_entry(
            &mut zip,
            &format!("{bundle_root}/media/_index.json"),
            &json!({
                "avatar_dir": avatar_dir.to_string_lossy().to_string(),
                "portrait_dir": portrait_dir.to_string_lossy().to_string(),
                "avatar_file_count": avatar_count,
                "portrait_file_count": portrait_count
            }),
        )?;
    }

    if options.include_chat_history {
        let session_path = format!("/api/agents/{agent_id}/session");
        if let Ok(session_payload) = state.openfang.get_json(&session_path).await {
            write_zip_json_entry(
                &mut zip,
                &format!("{bundle_root}/chat/session.json"),
                &session_payload,
            )?;
        }
    }

    let archive = zip
        .finish()
        .map_err(|e| storage_error(format!("写入压缩包失败: {e}")))?
        .into_inner();
    let archive_name = format!("agent-export-{safe_segment}-{exported_at_unix}.zip");
    let mut headers = AxumHeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache, must-revalidate"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{archive_name}\""))
            .map_err(|e| storage_error(format!("构造下载响应头失败: {e}")))?,
    );
    Ok((headers, Bytes::from(archive)))
}

#[derive(Deserialize, Default)]
pub struct ImportAgentBundleUploadQuery {
    pub filename: Option<String>,
}

#[derive(Default, Debug, Clone)]
struct ImportAgentBundleStats {
    context_files: usize,
    memory_files: usize,
    avatar_files: usize,
    portrait_files: usize,
    skill_assignments: usize,
    mcp_assignments: usize,
}

fn collect_agent_bundle_roots(
    root: &StdPath,
    depth: usize,
    output: &mut Vec<PathBuf>,
) -> Result<(), ApiError> {
    if root.join("manifest.json").is_file() {
        output.push(root.to_path_buf());
    }
    if depth == 0 {
        return Ok(());
    }
    let entries =
        fs::read_dir(root).map_err(|e| storage_error(format!("读取导入目录失败: {e}")))?;
    for entry in entries {
        let entry = entry.map_err(|e| storage_error(format!("读取导入目录项失败: {e}")))?;
        let file_type = entry
            .file_type()
            .map_err(|e| storage_error(format!("读取导入文件类型失败: {e}")))?;
        if file_type.is_dir() {
            collect_agent_bundle_roots(&entry.path(), depth.saturating_sub(1), output)?;
        }
    }
    Ok(())
}

fn find_agent_bundle_root(root: &StdPath) -> Result<PathBuf, ApiError> {
    let mut candidates = Vec::new();
    collect_agent_bundle_roots(root, 4, &mut candidates)?;
    candidates.sort();
    candidates.dedup();
    if candidates.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "导入包中缺少 manifest.json，请确认选择的是智能体导出 zip",
        ));
    }
    if candidates.len() > 1 {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "导入包中检测到多个 manifest.json，暂不支持一次导入多个智能体",
        ));
    }
    Ok(candidates.remove(0))
}

fn read_json_file(path: &StdPath) -> Result<Value, ApiError> {
    let raw = fs::read_to_string(path)
        .map_err(|e| storage_error(format!("读取文件失败({}): {e}", path.display())))?;
    serde_json::from_str::<Value>(&raw).map_err(|e| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!("JSON 解析失败({}): {e}", path.display()),
        )
    })
}

fn read_json_file_if_exists(path: &StdPath) -> Result<Option<Value>, ApiError> {
    if !path.is_file() {
        return Ok(None);
    }
    read_json_file(path).map(Some)
}

fn merge_profile_override_patch(base: &mut ProfileOverridePatch, incoming: ProfileOverridePatch) {
    if incoming.tags.is_some() {
        base.tags = incoming.tags;
    }
    if incoming.description.is_some() {
        base.description = incoming.description;
    }
    if incoming.system_prompt.is_some() {
        base.system_prompt = incoming.system_prompt;
    }
    if incoming.collaboration.is_some() {
        base.collaboration = incoming.collaboration;
    }
    if incoming.channel_binding.is_some() {
        base.channel_binding = incoming.channel_binding;
    }
    if incoming.avatar_url.is_some() {
        base.avatar_url = incoming.avatar_url;
    }
    if incoming.portrait_url.is_some() {
        base.portrait_url = incoming.portrait_url;
    }
    if incoming.english_name.is_some() {
        base.english_name = incoming.english_name;
    }
    if incoming.nickname.is_some() {
        base.nickname = incoming.nickname;
    }
    if incoming.tts_config.is_some() {
        base.tts_config = incoming.tts_config;
    }
    if incoming.speaker_profiles.is_some() {
        base.speaker_profiles = incoming.speaker_profiles;
    }
}

fn escape_toml_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace("\r\n", "\\n")
        .replace('\r', "\\n")
        .replace('\n', "\\n")
        .replace('\t', "\\t")
}

fn extract_string_array(value: Option<&Value>) -> Vec<String> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        let Some(text) = item.as_str() else {
            continue;
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            output.push(trimmed.to_string());
        }
    }
    output
}

fn build_manifest_toml_for_import(
    detail: &Value,
    fallback_provider: &str,
    fallback_model: &str,
) -> String {
    let name = detail
        .get("english_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .or_else(|| {
            detail
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
        })
        .unwrap_or("imported-agent");
    let description = detail
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let provider = detail
        .pointer("/model/provider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback_provider);
    let model = detail
        .pointer("/model/model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .or_else(|| {
            detail
                .get("model_name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
        })
        .unwrap_or(fallback_model);
    let system_prompt = detail
        .get("system_prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .or_else(|| {
            detail
                .pointer("/model/system_prompt")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
        })
        .unwrap_or("You are a helpful AI agent.");
    let tags = extract_string_array(detail.get("tags"));

    let mut lines = vec![
        format!("name = \"{}\"", escape_toml_string(name)),
        format!("description = \"{}\"", escape_toml_string(description)),
        "profile = \"full\"".to_string(),
        String::new(),
        "[model]".to_string(),
        format!("provider = \"{}\"", escape_toml_string(provider)),
        format!("model = \"{}\"", escape_toml_string(model)),
        format!("system_prompt = \"{}\"", escape_toml_string(system_prompt)),
    ];
    if !tags.is_empty() {
        lines.push(String::new());
        lines.push(format!(
            "tags = [{}]",
            tags.iter()
                .map(|item| format!("\"{}\"", escape_toml_string(item)))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    lines.join("\n")
}

fn collect_file_names_in_dir(dir: &StdPath) -> Result<Vec<String>, ApiError> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    let entries = fs::read_dir(dir)
        .map_err(|e| storage_error(format!("读取目录失败({}): {e}", dir.display())))?;
    for entry in entries {
        let entry = entry.map_err(|e| storage_error(format!("读取目录项失败: {e}")))?;
        let file_type = entry
            .file_type()
            .map_err(|e| storage_error(format!("读取文件类型失败: {e}")))?;
        if !file_type.is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                names.push(trimmed.to_string());
            }
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

fn select_preferred_media_filename(files: &[String]) -> Option<String> {
    let mut preferred = files
        .iter()
        .find(|name| {
            StdPath::new(name.as_str())
                .extension()
                .and_then(OsStr::to_str)
                .map(|ext| {
                    matches!(
                        ext.to_ascii_lowercase().as_str(),
                        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"
                    )
                })
                .unwrap_or(false)
        })
        .cloned();
    if preferred.is_none() {
        preferred = files.first().cloned();
    }
    preferred
}

pub async fn import_agent_bundle_upload(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ImportAgentBundleUploadQuery>,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    if body.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "上传内容为空，请选择智能体导出 zip",
        ));
    }

    let tick = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_root = std::env::temp_dir().join(format!(
        "webot-agent-import-{}-{}",
        std::process::id(),
        tick
    ));
    fs::create_dir_all(&temp_root).map_err(|e| storage_error(format!("创建临时目录失败: {e}")))?;
    extract_zip_to_dir(&body, &temp_root)?;

    let import_result = async {
        let bundle_root = find_agent_bundle_root(&temp_root)?;
        let manifest = read_json_file(&bundle_root.join("manifest.json"))?;
        let detail = read_json_file(&bundle_root.join("profile").join("agent.detail.json"))?;
        let profile_override_file =
            read_json_file_if_exists(&bundle_root.join("profile").join("profile_override.json"))?;
        let chat_session_file =
            read_json_file_if_exists(&bundle_root.join("chat").join("session.json"))?;

        let (fallback_provider, fallback_model) = resolve_default_model_tuple()
            .await
            .unwrap_or_else(|_| ("openai".to_string(), "gpt-4o-mini".to_string()));
        let manifest_toml =
            build_manifest_toml_for_import(&detail, &fallback_provider, &fallback_model);

        let created = state
            .openfang
            .post_json("/api/agents", json!({ "manifest_toml": manifest_toml }))
            .await?;
        let agent_id = created
            .get("agent_id")
            .or_else(|| created.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .ok_or_else(|| {
                ApiError::new(
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "创建智能体成功但未返回 agent_id",
                )
            })?;
        validate_agent_path_segment(&agent_id)?;

        let mut stats = ImportAgentBundleStats::default();
        let mut warnings: Vec<String> = Vec::new();
        let source_agent_id = manifest
            .get("agent_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or_default()
            .to_string();
        let source_workspace = manifest
            .get("workspace_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or_default()
            .to_string();

        let mut profile_patch = extract_profile_override_patch(&detail);
        if let Some(profile_override) = profile_override_file.as_ref() {
            let override_patch = extract_profile_override_patch(profile_override);
            merge_profile_override_patch(&mut profile_patch, override_patch);
        }

        // 先写入英文名/昵称等基础覆盖，确保后续资源目录解析在目标工作区下进行。
        assignment_store::upsert_agent_profile_override(
            &agent_id,
            profile_patch.tags.clone(),
            profile_patch.description.clone(),
            profile_patch.system_prompt.clone(),
            profile_patch.collaboration.clone(),
            profile_patch.channel_binding.clone(),
            None,
            None,
            profile_patch.english_name.clone(),
            profile_patch.nickname.clone(),
            None,
            None,
        )
        .map_err(storage_error)?;

        let context_root = bundle_root.join("context");
        if context_root.is_dir() {
            for file_name in KNOWN_CONTEXT_FILES {
                let source_file = context_root.join(file_name);
                if !source_file.is_file() {
                    continue;
                }
                let content = fs::read_to_string(&source_file).map_err(|e| {
                    storage_error(format!("读取上下文文件失败({}): {e}", source_file.display()))
                })?;
                assignment_store::upsert_agent_context_file(&agent_id, file_name, &content)
                    .map_err(storage_error)?;
                write_context_file_to_openfang(&state, &agent_id, file_name, &content).await?;
                stats.context_files += 1;
            }
        }

        let memory_source = bundle_root.join("memory");
        if memory_source.is_dir() {
            let memory_target = resolve_agent_memory_dir_smart(&state, &agent_id).await?;
            copy_dir_recursive(&memory_source, &memory_target)?;
            stats.memory_files = collect_markdown_files(&memory_source)
                .map(|items| items.len())
                .unwrap_or(0);
        }

        let media_root = bundle_root.join("media");
        if media_root.is_dir() {
            let (avatar_target, portrait_target) =
                resolve_agent_media_dirs(&state, &agent_id, None).await?;
            let avatar_source = media_root.join("avatar");
            let portrait_source = media_root.join("portrait");

            if avatar_source.is_dir() {
                copy_dir_recursive(&avatar_source, &avatar_target)?;
                let files = collect_file_names_in_dir(&avatar_target)?;
                stats.avatar_files = files.len();
                if let Some(file_name) = select_preferred_media_filename(&files) {
                    profile_patch.avatar_url = Some(build_avatar_url(&agent_id, &file_name));
                }
            }
            if portrait_source.is_dir() {
                copy_dir_recursive(&portrait_source, &portrait_target)?;
                let files = collect_file_names_in_dir(&portrait_target)?;
                stats.portrait_files = files.len();
                if let Some(file_name) = select_preferred_media_filename(&files) {
                    profile_patch.portrait_url = Some(build_portrait_url(&agent_id, &file_name));
                }
            }
        }

        assignment_store::upsert_agent_profile_override(
            &agent_id,
            profile_patch.tags.clone(),
            profile_patch.description.clone(),
            profile_patch.system_prompt.clone(),
            profile_patch.collaboration.clone(),
            profile_patch.channel_binding.clone(),
            profile_patch.avatar_url.clone(),
            profile_patch.portrait_url.clone(),
            profile_patch.english_name.clone(),
            profile_patch.nickname.clone(),
            None,
            None,
        )
        .map_err(storage_error)?;

        let assignments_file = bundle_root.join("assignments").join("assignment_store.json");
        if assignments_file.is_file() {
            let assignments = read_json_file(&assignments_file)?;
            let skills = extract_string_array(assignments.get("skills"));
            for skill in &skills {
                if let Err(err) = assignment_store::set_agent_skill_enabled(&agent_id, skill, true)
                {
                    warnings.push(format!("恢复 skill 分配失败({skill}): {err}"));
                }
            }
            stats.skill_assignments = skills.len();

            let mcp_servers = extract_string_array(assignments.get("mcp_servers"))
                .into_iter()
                .filter(|name| !is_system_hidden_mcp_server(name))
                .collect::<Vec<_>>();
            for server in &mcp_servers {
                if let Err(err) = assignment_store::set_agent_mcp_enabled(&agent_id, server, true)
                {
                    warnings.push(format!("恢复 MCP 分配失败({server}): {err}"));
                }
            }
            stats.mcp_assignments = mcp_servers.len();

            let extra_workspaces =
                extract_string_array(assignments.get("extra_workspaces"));
            if let Err(err) =
                assignment_store::replace_agent_workspace_folders(&agent_id, &extra_workspaces)
            {
                warnings.push(format!("恢复额外工作区失败: {err}"));
            }

            let acl_private = extract_string_array(assignments.get("collaboration_acl_private"));
            if let Err(err) =
                assignment_store::replace_agent_collaboration_acl(&agent_id, "private", &acl_private)
            {
                warnings.push(format!("恢复协同 ACL 失败: {err}"));
            }

            let hidden = assignments
                .get("hidden")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if let Err(err) = assignment_store::set_agent_hidden(&agent_id, hidden) {
                warnings.push(format!("恢复隐藏状态失败: {err}"));
            }
        }

        if let Err(err) = enable_default_global_skills_for_agent(&agent_id) {
            warnings.push(format!("默认启用 ui-skill 失败: {err}"));
        }

        if let Err(err) = sync_active_mcp_servers_to_runtime(&state).await {
            warnings.push(format!("同步 MCP 运行时失败: {}", err.message));
        }
        if let Err(err) = sync_agent_mcp_assignments(&state, &agent_id).await {
            warnings.push(format!("同步智能体 MCP 分配失败: {}", err.message));
        }

        let detail_path = format!("/api/agents/{agent_id}");
        let mut imported_detail = state.openfang.get_json(&detail_path).await?;
        if let Some(profile) =
            assignment_store::get_agent_profile_override(&agent_id).map_err(storage_error)?
        {
            merge_agent_profile_override(&mut imported_detail, &profile);
        }

        Ok::<Value, ApiError>(json!({
            "status": "imported",
            "agent_id": agent_id,
            "source_agent_id": source_agent_id,
            "source_workspace_name": source_workspace,
            "source_filename": query.filename.clone().unwrap_or_else(|| "agent-bundle.zip".to_string()),
            "chat_session": chat_session_file,
            "stats": {
                "context_files": stats.context_files,
                "memory_files": stats.memory_files,
                "avatar_files": stats.avatar_files,
                "portrait_files": stats.portrait_files,
                "skill_assignments": stats.skill_assignments,
                "mcp_assignments": stats.mcp_assignments
            },
            "warnings": warnings,
            "agent": imported_detail
        }))
    }
    .await;

    let _ = fs::remove_dir_all(&temp_root);
    Ok(Json(import_result?))
}

#[derive(Deserialize)]
pub struct ImportAgentAvatarRequest {
    #[serde(alias = "sourcePath")]
    pub source_path: String,
}

#[derive(Deserialize, Default)]
pub struct ListAgentPhotoLibraryQuery {
    #[serde(default, alias = "ownerScope")]
    pub owner_scope: Option<String>,
    #[serde(default, alias = "q")]
    pub query: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

pub async fn list_agent_photo_library(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ListAgentPhotoLibraryQuery>,
) -> Result<Json<Value>, ApiError> {
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    let items = assignment_store::list_media_assets(assignment_store::MediaAssetListQuery {
        agent_id: Some(resolved.resolved.clone()),
        owner_scope: query.owner_scope.clone(),
        asset_family: Some("photo".to_string()),
        media_kind: Some("image".to_string()),
        query: query.query.clone(),
        limit: query.limit,
    })
    .map_err(storage_error)?;

    Ok(Json(json!({
        "agent_id": resolved.requested,
        "resolved_agent_id": resolved.resolved,
        "items": items,
    })))
}

pub async fn import_agent_avatar(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<ImportAgentAvatarRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    let detail_path = format!("/api/agents/{agent_id}");
    let _ = state.openfang.get_json(&detail_path).await?;

    let source = PathBuf::from(payload.source_path.trim());
    if !source.is_file() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "source_path 必须是存在的图片文件",
        ));
    }

    let bytes = fs::read(&source).map_err(|e| storage_error(format!("读取头像源文件失败: {e}")))?;
    let source_name = source
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("avatar");
    let (mut avatar_url, filename, saved_path) =
        save_agent_avatar_bytes(&state, &agent_id, Some(source_name), None, &bytes, None).await?;
    if resolved.alias_used {
        avatar_url = build_avatar_url(&public_id, &filename);
    }
    index_agent_photo_asset_best_effort(
        &agent_id,
        "avatar_import",
        "avatar",
        &avatar_url,
        &filename,
        &saved_path,
    )
    .await;

    Ok(Json(json!({
        "status": "ok",
        "mode": "copy",
        "avatar_url": avatar_url,
        "filename": filename,
        "saved_path": saved_path,
        "size": bytes.len()
    })))
}

pub async fn upload_agent_avatar(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    let detail_path = format!("/api/agents/{agent_id}");
    let _ = state.openfang.get_json(&detail_path).await?;

    let mut picked_name: Option<String> = None;
    let mut picked_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!("读取上传内容失败: {e}"),
        )
    })? {
        let field_name = field.name().unwrap_or_default().to_string();
        if field_name != "file" {
            continue;
        }
        picked_name = field
            .file_name()
            .map(ToString::to_string)
            .or_else(|| Some("avatar".to_string()));
        let bytes = field.bytes().await.map_err(|e| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("读取上传文件失败: {e}"),
            )
        })?;
        picked_bytes = Some(bytes.to_vec());
        break;
    }

    let bytes = picked_bytes.ok_or_else(|| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "未检测到 file 字段，请检查上传参数",
        )
    })?;

    let (mut avatar_url, filename, saved_path) = save_agent_avatar_bytes(
        &state,
        &agent_id,
        picked_name.as_deref(),
        None,
        &bytes,
        None,
    )
    .await?;
    if resolved.alias_used {
        avatar_url = build_avatar_url(&public_id, &filename);
    }
    index_agent_photo_asset_best_effort(
        &agent_id,
        "avatar_upload",
        "avatar",
        &avatar_url,
        &filename,
        &saved_path,
    )
    .await;

    Ok(Json(json!({
        "status": "ok",
        "mode": "upload",
        "avatar_url": avatar_url,
        "filename": filename,
        "saved_path": saved_path,
        "size": bytes.len()
    })))
}

#[derive(Deserialize)]
pub struct UploadInlineImageRequest {
    pub filename: Option<String>,
    pub content_base64: String,
    pub content_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTtsSynthesisRequest {
    pub text: String,
    #[serde(default)]
    pub speaker_profile_id: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
}

#[derive(Deserialize)]
pub struct AgentChatAssetFileQuery {
    pub path: String,
}

pub async fn get_agent_chat_asset_file(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<AgentChatAssetFileQuery>,
    headers: AxumHeaderMap,
) -> Result<Response<Body>, ApiError> {
    validate_agent_path_segment(&id)?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    let relative = sanitize_upload_relative_path(&query.path)?;
    let binding = resolve_agent_workspace_binding(&state, &resolved.resolved, None).await?;
    let file_path = binding.private_workspace.join("data").join(&relative);
    let root = binding
        .private_workspace
        .join("data")
        .join(CHAT_UPLOAD_DIR_NAME);
    if !file_path.starts_with(&root) {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "附件路径非法",
        ));
    }
    if !file_path.is_file() {
        return Err(ApiError::new(
            axum::http::StatusCode::NOT_FOUND,
            "附件不存在",
        ));
    }

    let file_name = file_path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("attachment.bin");
    let content_type = chat_asset_content_type(file_name);
    let disposition = if matches!(
        chat_asset_kind_from_name(file_name),
        "image" | "video" | "audio"
    ) {
        "inline"
    } else {
        "attachment"
    };
    let file_size = fs::metadata(&file_path)
        .map_err(|e| {
            storage_error(format!(
                "读取聊天附件元数据失败({}): {e}",
                file_path.display()
            ))
        })?
        .len();
    let range_header = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(range_header) = range_header {
        let (start, end) = match parse_http_byte_range_header(range_header, file_size) {
            Ok(range) => range,
            Err(_) => {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(header::CACHE_CONTROL, "private, max-age=300")
                    .header(header::CONTENT_DISPOSITION, disposition)
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CONTENT_RANGE, format!("bytes */{file_size}"))
                    .body(Body::empty())
                    .map_err(|e| storage_error(format!("构建 Range 错误响应失败: {e}")));
            }
        };
        let chunk = read_file_byte_range(&file_path, start, end)?;
        return Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .header(header::CONTENT_DISPOSITION, disposition)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{file_size}"),
            )
            .header(header::CONTENT_LENGTH, chunk.len().to_string())
            .body(Body::from(chunk))
            .map_err(|e| storage_error(format!("构建聊天附件分片响应失败: {e}")));
    }

    let bytes = fs::read(&file_path)
        .map_err(|e| storage_error(format!("读取聊天附件失败({}): {e}", file_path.display())))?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "private, max-age=300")
        .header(header::CONTENT_DISPOSITION, disposition)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, bytes.len().to_string())
        .body(Body::from(bytes))
        .map_err(|e| storage_error(format!("构建聊天附件响应失败: {e}")))
}

pub async fn upload_agent_chat_asset(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    let detail_path = format!("/api/agents/{agent_id}");
    let _ = state.openfang.get_json(&detail_path).await?;

    let mut picked_name: Option<String> = None;
    let mut picked_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!("读取上传内容失败: {e}"),
        )
    })? {
        let field_name = field.name().unwrap_or_default().to_string();
        if field_name != "file" {
            continue;
        }
        picked_name = field
            .file_name()
            .map(ToString::to_string)
            .or_else(|| Some("upload.bin".to_string()));
        let bytes = field.bytes().await.map_err(|e| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("读取上传文件失败: {e}"),
            )
        })?;
        picked_bytes = Some(bytes.to_vec());
        break;
    }

    let bytes = picked_bytes.ok_or_else(|| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "未检测到 file 字段，请检查上传参数",
        )
    })?;

    let (
        mut asset_url,
        filename,
        relative_path,
        saved_path,
        kind,
        mime_type,
        size,
        upstream_file_id,
        sha256,
    ) = save_agent_chat_asset_bytes(&state, &agent_id, picked_name.as_deref(), &bytes, None)
        .await?;
    if resolved.alias_used {
        asset_url = build_agent_chat_asset_url(&public_id, &relative_path);
    }

    Ok(Json(json!({
        "status": "ok",
        "mode": "upload",
        "asset_url": asset_url,
        "filename": filename,
        "relative_path": relative_path,
        "saved_path": saved_path,
        "kind": kind,
        "mime_type": mime_type,
        "size": size,
        "upstream_file_id": upstream_file_id,
        "sha256": sha256
    })))
}

pub async fn upload_agent_chat_asset_inline(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UploadInlineImageRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    let detail_path = format!("/api/agents/{agent_id}");
    let _ = state.openfang.get_json(&detail_path).await?;

    let bytes = decode_inline_upload_base64(&payload.content_base64)?;
    let (
        mut asset_url,
        filename,
        relative_path,
        saved_path,
        kind,
        mime_type,
        size,
        upstream_file_id,
        sha256,
    ) = save_agent_chat_asset_bytes(&state, &agent_id, payload.filename.as_deref(), &bytes, None)
        .await?;
    if resolved.alias_used {
        asset_url = build_agent_chat_asset_url(&public_id, &relative_path);
    }

    Ok(Json(json!({
        "status": "ok",
        "mode": "inline",
        "asset_url": asset_url,
        "filename": filename,
        "relative_path": relative_path,
        "saved_path": saved_path,
        "kind": kind,
        "mime_type": mime_type,
        "size": size,
        "upstream_file_id": upstream_file_id,
        "sha256": sha256
    })))
}

fn map_tts_plan_error(message: String) -> ApiError {
    let status = if message.contains("不能为空")
        || message.contains("不存在")
        || message.contains("缺少")
        || message.contains("WAV")
        || message.contains("样本")
    {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::CONFLICT
    };
    ApiError::new(status, message)
}

pub async fn synthesize_agent_tts(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<AgentTtsSynthesisRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    let output_format = payload
        .format
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("wav");
    if !output_format.eq_ignore_ascii_case("wav") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "当前本地 F5-TTS-ONNX 仅支持 WAV 输出，请将 format 设为 wav 或留空",
        ));
    }

    let detail_path = format!("/api/agents/{agent_id}");
    let detail = state.openfang.get_json(&detail_path).await?;
    let binding = resolve_agent_workspace_binding(&state, &agent_id, Some(&detail)).await?;
    let data_root = binding.private_workspace.join("data");
    let plan = tts_management::build_local_f5_synthesis_plan(
        &agent_id,
        &data_root,
        &payload.text,
        payload.speaker_profile_id.as_deref(),
    )
    .await
    .map_err(map_tts_plan_error)?;
    let synthesis = tts_management::synthesize_local_f5(&plan)
        .await
        .map_err(|message| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message))?;

    let filename_hint = payload
        .message_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("tts-{value}.wav"))
        .unwrap_or_else(|| "tts-reply.wav".to_string());

    let (
        mut asset_url,
        filename,
        relative_path,
        saved_path,
        _kind,
        mime_type,
        size,
        upstream_file_id,
        sha256,
    ) = save_agent_chat_asset_bytes(
        &state,
        &agent_id,
        Some(&filename_hint),
        &synthesis.audio_bytes,
        Some(&detail),
    )
    .await?;
    if resolved.alias_used {
        asset_url = build_agent_chat_asset_url(&public_id, &relative_path);
    }

    Ok(Json(json!({
        "status": "ok",
        "asset_url": asset_url,
        "filename": filename,
        "relative_path": relative_path,
        "saved_path": saved_path,
        "mime_type": mime_type,
        "size": size,
        "duration_secs": synthesis.duration_secs,
        "sample_rate": synthesis.sample_rate,
        "provider": synthesis.provider,
        "engine": synthesis.engine,
        "speaker_profile_id": synthesis.speaker_profile_id,
        "speaker_name": synthesis.speaker_name,
        "message_id": payload.message_id,
        "requested_text": synthesis.requested_text,
        "warnings": synthesis.warnings,
        "device": synthesis.device,
        "chunk_count": synthesis.chunk_count,
        "upstream_file_id": upstream_file_id,
        "sha256": sha256
    })))
}

fn decode_inline_upload_base64(raw: &str) -> Result<Vec<u8>, ApiError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "content_base64 不能为空",
        ));
    }
    let payload = if let Some(index) = trimmed.find(";base64,") {
        &trimmed[index + ";base64,".len()..]
    } else if trimmed.starts_with("data:") {
        if let Some(index) = trimmed.find(',') {
            &trimmed[index + 1..]
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    base64::engine::general_purpose::STANDARD
        .decode(payload.as_bytes())
        .map_err(|e| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("content_base64 解码失败: {e}"),
            )
        })
}

pub async fn upload_agent_avatar_inline(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UploadInlineImageRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    let detail_path = format!("/api/agents/{agent_id}");
    let _ = state.openfang.get_json(&detail_path).await?;

    let bytes = decode_inline_upload_base64(&payload.content_base64)?;
    let (mut avatar_url, filename, saved_path) = save_agent_avatar_bytes(
        &state,
        &agent_id,
        payload.filename.as_deref(),
        payload.content_type.as_deref(),
        &bytes,
        None,
    )
    .await?;
    if resolved.alias_used {
        avatar_url = build_avatar_url(&public_id, &filename);
    }
    index_agent_photo_asset_best_effort(
        &agent_id,
        "avatar_upload_inline",
        "avatar",
        &avatar_url,
        &filename,
        &saved_path,
    )
    .await;

    Ok(Json(json!({
        "status": "ok",
        "mode": "inline",
        "avatar_url": avatar_url,
        "filename": filename,
        "saved_path": saved_path,
        "size": bytes.len()
    })))
}

pub async fn get_agent_avatar(
    State(state): State<Arc<AppState>>,
    Path((id, filename)): Path<(String, String)>,
) -> Result<impl axum::response::IntoResponse, ApiError> {
    validate_agent_path_segment(&id)?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    let safe_filename = filename.trim();
    if safe_filename.is_empty()
        || safe_filename.contains('/')
        || safe_filename.contains('\\')
        || safe_filename.contains("..")
    {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "无效的头像文件名",
        ));
    }
    let ext = detect_avatar_ext_from_name(safe_filename)
        .ok_or_else(|| ApiError::new(axum::http::StatusCode::BAD_REQUEST, "不支持的头像格式"))?;
    let avatar_dir = resolve_agent_avatar_dir(&state, &resolved.resolved, None).await?;
    let avatar_path = avatar_dir.join(safe_filename);
    if !avatar_path.exists() {
        return Err(ApiError::new(
            axum::http::StatusCode::NOT_FOUND,
            "头像文件不存在",
        ));
    }

    let bytes =
        fs::read(&avatar_path).map_err(|e| storage_error(format!("读取头像文件失败: {e}")))?;
    Ok((
        [
            (header::CONTENT_TYPE, avatar_content_type(ext)),
            (header::CACHE_CONTROL, "public, max-age=300"),
        ],
        bytes,
    ))
}

pub async fn import_agent_portrait(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<ImportAgentAvatarRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    let detail_path = format!("/api/agents/{agent_id}");
    let _ = state.openfang.get_json(&detail_path).await?;

    let source = PathBuf::from(payload.source_path.trim());
    if !source.is_file() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "source_path 必须是存在的图片文件",
        ));
    }

    let bytes = fs::read(&source).map_err(|e| storage_error(format!("读取立绘源文件失败: {e}")))?;
    let source_name = source
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("portrait");
    let (mut portrait_url, filename, saved_path) =
        save_agent_portrait_bytes(&state, &agent_id, Some(source_name), None, &bytes, None).await?;
    if resolved.alias_used {
        portrait_url = build_portrait_url(&public_id, &filename);
    }
    index_agent_photo_asset_best_effort(
        &agent_id,
        "portrait_import",
        "portrait",
        &portrait_url,
        &filename,
        &saved_path,
    )
    .await;

    Ok(Json(json!({
        "status": "ok",
        "mode": "copy",
        "portrait_url": portrait_url,
        "filename": filename,
        "saved_path": saved_path,
        "size": bytes.len()
    })))
}

pub async fn upload_agent_portrait(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    let detail_path = format!("/api/agents/{agent_id}");
    let _ = state.openfang.get_json(&detail_path).await?;

    let mut picked_name: Option<String> = None;
    let mut picked_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!("读取上传内容失败: {e}"),
        )
    })? {
        let field_name = field.name().unwrap_or_default().to_string();
        if field_name != "file" {
            continue;
        }
        picked_name = field
            .file_name()
            .map(ToString::to_string)
            .or_else(|| Some("portrait".to_string()));
        let bytes = field.bytes().await.map_err(|e| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("读取上传文件失败: {e}"),
            )
        })?;
        picked_bytes = Some(bytes.to_vec());
        break;
    }

    let bytes = picked_bytes.ok_or_else(|| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "未检测到 file 字段，请检查上传参数",
        )
    })?;

    let (mut portrait_url, filename, saved_path) = save_agent_portrait_bytes(
        &state,
        &agent_id,
        picked_name.as_deref(),
        None,
        &bytes,
        None,
    )
    .await?;
    if resolved.alias_used {
        portrait_url = build_portrait_url(&public_id, &filename);
    }
    index_agent_photo_asset_best_effort(
        &agent_id,
        "portrait_upload",
        "portrait",
        &portrait_url,
        &filename,
        &saved_path,
    )
    .await;

    Ok(Json(json!({
        "status": "ok",
        "mode": "upload",
        "portrait_url": portrait_url,
        "filename": filename,
        "saved_path": saved_path,
        "size": bytes.len()
    })))
}

pub async fn upload_agent_portrait_inline(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UploadInlineImageRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let public_id = resolved.requested;
    let detail_path = format!("/api/agents/{agent_id}");
    let _ = state.openfang.get_json(&detail_path).await?;

    let bytes = decode_inline_upload_base64(&payload.content_base64)?;
    let (mut portrait_url, filename, saved_path) = save_agent_portrait_bytes(
        &state,
        &agent_id,
        payload.filename.as_deref(),
        payload.content_type.as_deref(),
        &bytes,
        None,
    )
    .await?;
    if resolved.alias_used {
        portrait_url = build_portrait_url(&public_id, &filename);
    }
    index_agent_photo_asset_best_effort(
        &agent_id,
        "portrait_upload_inline",
        "portrait",
        &portrait_url,
        &filename,
        &saved_path,
    )
    .await;

    Ok(Json(json!({
        "status": "ok",
        "mode": "inline",
        "portrait_url": portrait_url,
        "filename": filename,
        "saved_path": saved_path,
        "size": bytes.len()
    })))
}

pub async fn get_agent_portrait(
    State(state): State<Arc<AppState>>,
    Path((id, filename)): Path<(String, String)>,
) -> Result<impl axum::response::IntoResponse, ApiError> {
    validate_agent_path_segment(&id)?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;
    let safe_filename = filename.trim();
    if safe_filename.is_empty()
        || safe_filename.contains('/')
        || safe_filename.contains('\\')
        || safe_filename.contains("..")
    {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "无效的立绘文件名",
        ));
    }
    let ext = detect_avatar_ext_from_name(safe_filename)
        .ok_or_else(|| ApiError::new(axum::http::StatusCode::BAD_REQUEST, "不支持的立绘格式"))?;
    let portrait_dir = resolve_agent_portrait_dir(&state, &resolved.resolved, None).await?;
    let portrait_path = portrait_dir.join(safe_filename);
    if !portrait_path.exists() {
        return Err(ApiError::new(
            axum::http::StatusCode::NOT_FOUND,
            "立绘文件不存在",
        ));
    }

    let bytes =
        fs::read(&portrait_path).map_err(|e| storage_error(format!("读取立绘文件失败: {e}")))?;
    Ok((
        [
            (header::CONTENT_TYPE, avatar_content_type(ext)),
            (header::CACHE_CONTROL, "public, max-age=300"),
        ],
        bytes,
    ))
}

pub async fn delete_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<DeleteAgentQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    validate_agent_path_segment(&agent_id)?;
    let mode = query.mode.unwrap_or(DeleteAgentMode::Purge);

    match mode {
        DeleteAgentMode::LocalOnly => {
            assignment_store::clear_agent_local_data(&agent_id).map_err(storage_error)?;
            assignment_store::set_agent_hidden(&agent_id, true).map_err(storage_error)?;
            if resolved.alias_used {
                clear_nuwa_agent_id_cache().await;
            }
            let runtime = sync_active_mcp_servers_to_runtime(&state).await?;
            Ok(Json(json!({
                "status": "ok",
                "agent_id": id,
                "mode": "local_only",
                "deleted_openfang": false,
                "deleted_workspace_dirs": [],
                "runtime_sync": runtime
            })))
        }
        DeleteAgentMode::Purge => {
            let workspace_binding = resolve_agent_workspace_binding(&state, &agent_id, None)
                .await
                .ok();
            let path = format!("/api/agents/{agent_id}");
            let openfang_data = state.openfang.delete_json(&path).await?;
            assignment_store::clear_agent_local_data(&agent_id).map_err(storage_error)?;
            assignment_store::set_agent_hidden(&agent_id, false).map_err(storage_error)?;
            if resolved.alias_used {
                clear_nuwa_agent_id_cache().await;
            }

            let removed_workspace_dirs = if let Some(binding) = workspace_binding.as_ref() {
                remove_agent_workspace_dirs(binding)?
            } else {
                Vec::new()
            };
            let runtime = sync_active_mcp_servers_to_runtime(&state).await?;
            Ok(Json(json!({
                "status": "ok",
                "agent_id": id,
                "mode": "purge",
                "deleted_openfang": true,
                "deleted_workspace_dirs": removed_workspace_dirs,
                "openfang": openfang_data,
                "runtime_sync": runtime
            })))
        }
    }
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "snake_case")]
pub enum DeleteAgentMode {
    Purge,
    LocalOnly,
}

#[derive(Deserialize)]
pub struct DeleteAgentQuery {
    #[serde(default)]
    pub mode: Option<DeleteAgentMode>,
}

pub async fn stop_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let path = format!("/api/agents/{}/stop", resolved.resolved);
    let data = state.openfang.post_json(&path, json!({})).await?;
    Ok(Json(data))
}

#[derive(Deserialize)]
pub struct ListCronJobsQuery {
    #[serde(alias = "agentId")]
    pub agent_id: Option<String>,
}

pub async fn list_cron_jobs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListCronJobsQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let path = if let Some(agent_id) = query.agent_id.filter(|id| !id.trim().is_empty()) {
        let resolved = if agent_id.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID) {
            resolve_nuwa_agent_id(&state).await?
        } else {
            agent_id
        };
        format!("/api/cron/jobs?agent_id={resolved}")
    } else {
        "/api/cron/jobs".to_string()
    };
    let data = state.openfang.get_json(&path).await?;
    Ok(Json(data))
}

pub async fn create_cron_job(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let data = state.openfang.post_json("/api/cron/jobs", payload).await?;
    Ok(Json(data))
}

pub async fn delete_cron_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let path = format!("/api/cron/jobs/{id}");
    let data = state.openfang.delete_json(&path).await?;
    Ok(Json(data))
}

#[derive(Deserialize)]
pub struct ToggleCronJobRequest {
    pub enabled: bool,
}

pub async fn toggle_cron_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<ToggleCronJobRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let path = format!("/api/cron/jobs/{id}/enable");
    let data = state
        .openfang
        .put_json(&path, json!({ "enabled": payload.enabled }))
        .await?;
    Ok(Json(data))
}

pub async fn get_cron_job_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let path = format!("/api/cron/jobs/{id}/status");
    let data = state.openfang.get_json(&path).await?;
    Ok(Json(data))
}

pub async fn list_skills(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let data = state.openfang.get_json("/api/skills").await?;
    Ok(Json(data))
}

pub async fn list_mcp_servers(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let mut data = state.openfang.get_json("/api/mcp/servers").await?;
    if let Some(object) = data.as_object_mut() {
        for key in ["configured", "connected", "available"] {
            let next_items = object
                .get(key)
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter(|item| {
                            let name = item
                                .as_str()
                                .or_else(|| item.get("name").and_then(Value::as_str))
                                .map(str::trim)
                                .unwrap_or_default();
                            !name.is_empty() && !is_system_hidden_mcp_server(name)
                        })
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            object.insert(key.to_string(), Value::Array(next_items));
        }
    }
    Ok(Json(data))
}

pub async fn get_agent_skills(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let skill_aliases = skill_name_alias_map()?;
    let runtime_available = canonicalize_skill_names(
        openfang_known_skill_names(&state, &agent_id).await?,
        &skill_aliases,
    );
    let (global_custom_skills, global_component_skills) = global_skill_name_groups()?;
    let mut custom_available = canonicalize_skill_names(global_custom_skills, &skill_aliases);
    let mut component_available = canonicalize_skill_names(global_component_skills, &skill_aliases);
    let custom_available_set = custom_available
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let component_available_set = component_available
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    custom_available.sort();
    custom_available.dedup();
    component_available.sort();
    component_available.dedup();

    let mut builtin_available: Vec<String> = runtime_available
        .iter()
        .filter(|name| !name.eq_ignore_ascii_case(DEFAULT_UI_SKILL_NAME))
        .filter(|name| !custom_available_set.contains(&name.to_ascii_lowercase()))
        .filter(|name| !component_available_set.contains(&name.to_ascii_lowercase()))
        .cloned()
        .collect();
    builtin_available.sort();
    builtin_available.dedup();

    let mut available = custom_available.clone();
    available.extend(component_available.iter().cloned());
    available.extend(builtin_available.iter().cloned());
    available.extend(runtime_available.iter().cloned());
    let mut assigned = canonicalize_skill_names(
        assignment_store::list_agent_enabled_skills(&agent_id).map_err(storage_error)?,
        &skill_aliases,
    );
    available.extend(assigned.iter().cloned());
    available.sort();
    available.dedup();
    assigned.sort();
    assigned.dedup();
    Ok(Json(json!({
        "assigned": assigned,
        "available": available,
        "mode": "allowlist",
        "runtime_available": runtime_available,
        "custom_available": custom_available,
        "component_available": component_available,
        "builtin_available": builtin_available,
        "source": "assignment_store"
    })))
}

#[derive(Deserialize)]
pub struct SetAgentSkillsRequest {
    #[serde(default)]
    pub skills: Option<Vec<String>>,
    #[serde(default)]
    pub assigned: Option<Vec<String>>,
    #[serde(default)]
    pub mode: Option<String>,
}

pub async fn set_agent_skills(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<SetAgentSkillsRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let mut desired = resolve_assignment(
        payload.mode.as_deref(),
        payload.skills,
        payload.assigned,
        "skills",
    )?;
    let skill_aliases = skill_name_alias_map()?;
    desired = canonicalize_skill_names(desired, &skill_aliases);

    let (global_custom_skills, global_component_skills) = global_skill_name_groups()?;
    let mut available = canonicalize_skill_names(global_custom_skills, &skill_aliases);
    available.extend(canonicalize_skill_names(
        global_component_skills,
        &skill_aliases,
    ));
    available.extend(canonicalize_skill_names(
        openfang_known_skill_names(&state, &agent_id).await?,
        &skill_aliases,
    ));
    let previous_raw =
        assignment_store::list_agent_enabled_skills(&agent_id).map_err(storage_error)?;
    let mut previous = canonicalize_skill_names(previous_raw.clone(), &skill_aliases);
    available.extend(previous.iter().cloned());
    available.sort();
    available.dedup();
    if payload
        .mode
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
        == Some("all")
    {
        desired = available.clone();
    }

    for skill in &desired {
        if !available.iter().any(|name| name == skill) {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("未知 skill: {skill}"),
            ));
        }
    }
    desired.sort();
    desired.dedup();
    previous.sort();
    previous.dedup();
    let previous_raw = unique_trimmed_names(previous_raw);

    for skill in &previous_raw {
        assignment_store::set_agent_skill_enabled(&agent_id, skill, false)
            .map_err(storage_error)?;
    }
    for skill in &desired {
        assignment_store::set_agent_skill_enabled(&agent_id, skill, true).map_err(storage_error)?;
    }

    match sync_agent_skill_assignments(&state, &agent_id).await {
        Ok(mut result) => {
            if resolved.alias_used {
                rewrite_agent_id_fields(&mut result, DEFAULT_NUWA_AGENT_ID);
            }
            Ok(Json(result))
        }
        Err(err) => {
            for skill in &desired {
                let _ = assignment_store::set_agent_skill_enabled(&agent_id, skill, false);
            }
            for skill in &previous_raw {
                let _ = assignment_store::set_agent_skill_enabled(&agent_id, skill, true);
            }
            Err(err)
        }
    }
}

pub async fn get_agent_workspaces(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let binding = resolve_agent_workspace_binding(&state, &resolved.resolved, None).await?;
    let private_workspace = path_to_string(&binding.private_workspace);
    let shared_workspace = path_to_string(&binding.shared_workspace);
    let extra_workspaces = binding
        .extra_workspaces
        .iter()
        .map(|item| path_to_string(item))
        .collect::<Vec<_>>();
    let all_workspaces = binding
        .all_workspaces()
        .iter()
        .map(|item| path_to_string(item))
        .collect::<Vec<_>>();

    Ok(Json(json!({
        "agent_id": id,
        "private_workspace": private_workspace,
        "shared_workspace": shared_workspace,
        "extra_workspaces": extra_workspaces,
        "all_workspaces": all_workspaces,
        "workspace_mcp_server": binding.server_name,
        "workspace_mcp_managed": true
    })))
}

#[derive(Deserialize)]
pub struct SetAgentWorkspacesRequest {
    #[serde(default)]
    pub extra_workspaces: Option<Vec<String>>,
    #[serde(default)]
    pub folders: Option<Vec<String>>,
}

pub async fn set_agent_workspaces(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<SetAgentWorkspacesRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    validate_agent_path_segment(&resolved.resolved)?;

    let candidate_list = payload
        .extra_workspaces
        .or(payload.folders)
        .unwrap_or_default();
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for raw in candidate_list {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(path) = parse_workspace_absolute_path(trimmed) else {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("工作空间路径必须是绝对路径: {trimmed}"),
            ));
        };
        let key = path_identity_key(&path);
        if seen.insert(key) {
            normalized.push(path_to_string(&path));
        }
    }

    assignment_store::replace_agent_workspace_folders(&resolved.resolved, &normalized)
        .map_err(storage_error)?;
    let runtime = sync_active_mcp_servers_to_runtime(&state).await?;
    let assignment = sync_agent_mcp_assignments(&state, &resolved.resolved).await?;
    let binding = resolve_agent_workspace_binding(&state, &resolved.resolved, None).await?;

    Ok(Json(json!({
        "agent_id": id,
        "private_workspace": path_to_string(&binding.private_workspace),
        "shared_workspace": path_to_string(&binding.shared_workspace),
        "extra_workspaces": binding.extra_workspaces.iter().map(|item| path_to_string(item)).collect::<Vec<_>>(),
        "all_workspaces": binding.all_workspaces().iter().map(|item| path_to_string(item)).collect::<Vec<_>>(),
        "workspace_mcp_server": binding.server_name,
        "workspace_mcp_managed": true,
        "sync": {
            "runtime": runtime,
            "assignment": assignment
        }
    })))
}

pub async fn get_agent_mcp_servers(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let workspace_server = workspace_mcp_server_name(&agent_id);
    let mut runtime_available =
        strip_workspace_mcp_names(openfang_known_mcp_server_names(&state, &agent_id).await?);
    runtime_available.retain(|name| name != &workspace_server);
    let mut available = known_mcp_server_names(&state).await?;
    available.extend(runtime_available.iter().cloned());
    let mut assigned = strip_workspace_mcp_names(
        assignment_store::list_agent_enabled_mcp_servers(&agent_id).map_err(storage_error)?,
    );
    assigned.retain(|name| name != &workspace_server);
    available.extend(assigned.iter().cloned());
    available.retain(|name| name != &workspace_server && !is_system_hidden_mcp_server(name));
    available.sort();
    available.dedup();
    assigned.sort();
    assigned.dedup();
    Ok(Json(json!({
        "assigned": assigned,
        "available": available,
        "mode": "allowlist",
        "runtime_available": runtime_available,
        "workspace_mcp_server": workspace_server,
        "workspace_mcp_managed": true,
        "source": "assignment_store"
    })))
}

#[derive(Deserialize)]
pub struct SetAgentMcpServersRequest {
    #[serde(default)]
    pub mcp_servers: Option<Vec<String>>,
    #[serde(default)]
    pub assigned: Option<Vec<String>>,
    #[serde(default)]
    pub mode: Option<String>,
}

pub async fn set_agent_mcp_servers(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<SetAgentMcpServersRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let workspace_server = workspace_mcp_server_name(&agent_id);
    let mut desired = resolve_assignment(
        payload.mode.as_deref(),
        payload.mcp_servers,
        payload.assigned,
        "mcp_servers",
    )?;
    desired.retain(|name| name != &workspace_server && !is_system_hidden_mcp_server(name));

    let mut known = known_mcp_server_names(&state).await?;
    known.extend(openfang_known_mcp_server_names(&state, &agent_id).await?);
    known.retain(|name| name != &workspace_server && !is_system_hidden_mcp_server(name));
    known.sort();
    known.dedup();
    if payload
        .mode
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
        == Some("all")
    {
        desired = known.clone();
    }

    for server in &desired {
        if !known.iter().any(|name| name == server) {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("未知 mcp_server: {server}"),
            ));
        }
    }
    desired.sort();
    desired.dedup();

    let mut previous = strip_workspace_mcp_names(
        assignment_store::list_agent_enabled_mcp_servers(&agent_id).map_err(storage_error)?,
    );
    previous.retain(|name| name != &workspace_server);
    previous.sort();
    previous.dedup();

    for server in &previous {
        assignment_store::set_agent_mcp_enabled(&agent_id, server, false).map_err(storage_error)?;
    }
    for server in &desired {
        assignment_store::set_agent_mcp_enabled(&agent_id, server, true).map_err(storage_error)?;
    }

    if let Err(err) = sync_active_mcp_servers_to_runtime(&state).await {
        for server in &desired {
            let _ = assignment_store::set_agent_mcp_enabled(&agent_id, server, false);
        }
        for server in &previous {
            let _ = assignment_store::set_agent_mcp_enabled(&agent_id, server, true);
        }
        return Err(err);
    }

    match sync_agent_mcp_assignments(&state, &agent_id).await {
        Ok(mut result) => {
            if resolved.alias_used {
                rewrite_agent_id_fields(&mut result, DEFAULT_NUWA_AGENT_ID);
            }
            Ok(Json(result))
        }
        Err(err) => {
            for server in &desired {
                let _ = assignment_store::set_agent_mcp_enabled(&agent_id, server, false);
            }
            for server in &previous {
                let _ = assignment_store::set_agent_mcp_enabled(&agent_id, server, true);
            }
            let _ = sync_active_mcp_servers_to_runtime(&state).await;
            Err(err)
        }
    }
}

#[derive(Deserialize)]
pub struct SetAgentSkillToggleRequest {
    #[serde(alias = "skillName")]
    pub skill: String,
    pub enabled: bool,
}

pub async fn set_agent_skill_toggle(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<SetAgentSkillToggleRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let skill = payload.skill.trim();
    if skill.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "skill 不能为空",
        ));
    }
    let skill_aliases = skill_name_alias_map()?;
    let Some(skill) = canonicalize_skill_name(skill, &skill_aliases) else {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "skill 不能为空",
        ));
    };

    if payload.enabled {
        let (global_custom_skills, global_component_skills) = global_skill_name_groups()?;
        let mut available = canonicalize_skill_names(global_custom_skills, &skill_aliases);
        available.extend(canonicalize_skill_names(
            global_component_skills,
            &skill_aliases,
        ));
        available.extend(canonicalize_skill_names(
            openfang_known_skill_names(&state, &agent_id).await?,
            &skill_aliases,
        ));
        available.sort();
        available.dedup();
        if !available.iter().any(|name| name == &skill) {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("未知 skill: {skill}"),
            ));
        }
    }

    let previous_raw =
        assignment_store::list_agent_enabled_skills(&agent_id).map_err(storage_error)?;
    let previous_canonical = canonicalize_skill_names(previous_raw.clone(), &skill_aliases);
    let prev_enabled = previous_canonical.iter().any(|name| name == &skill);
    let mut desired = previous_canonical.clone();
    if payload.enabled {
        desired.push(skill.clone());
    } else {
        desired.retain(|name| name != &skill);
    }
    desired.sort();
    desired.dedup();
    let previous_raw = unique_trimmed_names(previous_raw);

    for raw_name in &previous_raw {
        assignment_store::set_agent_skill_enabled(&agent_id, raw_name, false)
            .map_err(storage_error)?;
    }
    for name in &desired {
        assignment_store::set_agent_skill_enabled(&agent_id, name, true).map_err(storage_error)?;
    }

    match sync_agent_skill_assignments(&state, &agent_id).await {
        Ok(mut result) => {
            if resolved.alias_used {
                rewrite_agent_id_fields(&mut result, DEFAULT_NUWA_AGENT_ID);
            }
            Ok(Json(result))
        }
        Err(err) => {
            for name in &desired {
                let _ = assignment_store::set_agent_skill_enabled(&agent_id, name, false);
            }
            for raw_name in &previous_raw {
                let _ = assignment_store::set_agent_skill_enabled(&agent_id, raw_name, true);
            }
            if !prev_enabled {
                let _ = assignment_store::set_agent_skill_enabled(&agent_id, &skill, false);
            }
            Err(err)
        }
    }
}

#[derive(Deserialize)]
pub struct SetAgentMcpServerToggleRequest {
    #[serde(alias = "mcpServer", alias = "serverName")]
    pub mcp_server: String,
    pub enabled: bool,
}

pub async fn set_agent_mcp_server_toggle(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<SetAgentMcpServerToggleRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let agent_id = resolved.resolved;
    let server = payload.mcp_server.trim();
    if server.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "mcp_server 不能为空",
        ));
    }
    let workspace_server = workspace_mcp_server_name(&agent_id);
    if server == workspace_server || is_system_hidden_mcp_server(server) {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "工作空间 MCP 由系统托管，不允许手动开关",
        ));
    }

    if payload.enabled {
        let mut known = known_mcp_server_names(&state).await?;
        known.extend(openfang_known_mcp_server_names(&state, &agent_id).await?);
        known.retain(|name| name != &workspace_server && !is_system_hidden_mcp_server(name));
        known.sort();
        known.dedup();
        if !known.iter().any(|name| name == server) {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("未知 mcp_server: {server}"),
            ));
        }
    }

    let prev_enabled = assignment_store::list_agent_enabled_mcp_servers(&agent_id)
        .map_err(storage_error)?
        .iter()
        .any(|name| name == server && !is_system_hidden_mcp_server(name));
    assignment_store::set_agent_mcp_enabled(&agent_id, server, payload.enabled)
        .map_err(storage_error)?;

    if let Err(err) = sync_active_mcp_servers_to_runtime(&state).await {
        let _ = assignment_store::set_agent_mcp_enabled(&agent_id, server, prev_enabled);
        return Err(err);
    }

    match sync_agent_mcp_assignments(&state, &agent_id).await {
        Ok(mut result) => {
            if resolved.alias_used {
                rewrite_agent_id_fields(&mut result, DEFAULT_NUWA_AGENT_ID);
            }
            Ok(Json(result))
        }
        Err(err) => {
            let _ = assignment_store::set_agent_mcp_enabled(&agent_id, server, prev_enabled);
            let _ = sync_active_mcp_servers_to_runtime(&state).await;
            Err(err)
        }
    }
}

pub async fn list_global_skills(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let db_path = assignment_store::ensure_db().map_err(storage_error)?;
    let skills_root = assignment_store::skills_root().map_err(storage_error)?;
    if !skills_root.exists() {
        fs::create_dir_all(&skills_root)
            .map_err(|e| storage_error(format!("创建技能目录失败: {e}")))?;
    }
    let imported = assignment_store::list_imported_skills().map_err(storage_error)?;
    let local_dirs = list_child_dirs(&skills_root)
        .map_err(|e| storage_error(format!("读取技能目录失败: {e}")))?;
    let local_entries = local_dirs
        .iter()
        .map(|folder_name| {
            let path = skills_root.join(folder_name);
            LocalSkillListEntry {
                folder_name: folder_name.clone(),
                display_name: read_skill_name_from_dir(&path)
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| folder_name.clone()),
                description: read_skill_description_from_dir(&path),
                path,
            }
        })
        .collect::<Vec<_>>();
    let local_folder_set = local_entries
        .iter()
        .map(|entry| entry.folder_name.clone())
        .collect::<HashSet<_>>();

    let runtime = if is_service_online(&state).await {
        match state.openfang.get_json("/api/skills").await {
            Ok(value) => value,
            Err(err) => json!({ "error": err.message, "skills": [], "total": 0 }),
        }
    } else {
        json!({ "skills": [], "total": 0 })
    };
    let runtime_entries = extract_runtime_skill_entries(&runtime);

    let mut stale_imported_names = Vec::new();
    let imported_entries = imported
        .iter()
        .filter_map(|record| {
            let mut candidates = Vec::new();
            if !record.installed_path.trim().is_empty() {
                candidates.push(PathBuf::from(record.installed_path.trim()));
            }
            if !record.source_path.trim().is_empty() {
                candidates.push(PathBuf::from(record.source_path.trim()));
            }
            let installed_path = PathBuf::from(record.installed_path.trim());
            let folder_name = skill_folder_name_from_record(record);
            let path_exists = installed_path.is_dir();
            let folder_exists = folder_name
                .as_ref()
                .map(|name| local_folder_set.contains(name))
                .unwrap_or(false);
            if !path_exists && !folder_exists {
                stale_imported_names.push(record.name.clone());
                return None;
            }
            Some(ImportedSkillListEntry {
                record: record.clone(),
                folder_name,
                description: read_skill_description_from_candidates(&candidates),
            })
        })
        .collect::<Vec<_>>();
    for stale_name in stale_imported_names {
        if let Err(err) = assignment_store::delete_imported_skill(&stale_name) {
            tracing::warn!(skill = %stale_name, error = %err, "failed to prune stale imported skill record");
        }
    }

    let mut description_map = serde_json::Map::new();
    for local in &local_entries {
        if let Some(description) = local.description.as_ref() {
            description_map.insert(
                local.folder_name.clone(),
                Value::String(description.clone()),
            );
            if !local.display_name.eq_ignore_ascii_case(&local.folder_name) {
                description_map
                    .entry(local.display_name.clone())
                    .or_insert_with(|| Value::String(description.clone()));
            }
        }
    }

    let mut runtime_by_name = runtime_entries
        .iter()
        .cloned()
        .map(|entry| (entry.name.clone(), entry))
        .collect::<HashMap<_, _>>();
    let mut imported_by_folder = imported_entries
        .iter()
        .filter_map(|entry| {
            entry
                .folder_name
                .as_ref()
                .map(|folder_name| (folder_name.clone(), entry.clone()))
        })
        .collect::<HashMap<_, _>>();
    let mut imported_by_name = imported_entries
        .iter()
        .cloned()
        .map(|entry| (entry.record.name.clone(), entry))
        .collect::<HashMap<_, _>>();
    let mut normalized_items = Vec::new();
    let mut seen_display_names = HashSet::new();

    for local in &local_entries {
        let runtime_entry = runtime_by_name
            .remove(&local.display_name)
            .or_else(|| runtime_by_name.remove(&local.folder_name));
        let imported_entry = imported_by_folder
            .remove(&local.folder_name)
            .or_else(|| imported_by_name.remove(&local.folder_name))
            .or_else(|| imported_by_name.remove(&local.display_name));
        let is_ui_skill = local
            .folder_name
            .eq_ignore_ascii_case(DEFAULT_UI_SKILL_NAME)
            || local
                .display_name
                .eq_ignore_ascii_case(DEFAULT_UI_SKILL_NAME);
        let is_component_skill = if is_ui_skill {
            false
        } else {
            component_center::is_component_skill_dir(&local.path).unwrap_or(false)
        };
        let source_type = runtime_entry
            .as_ref()
            .map(|entry| entry.source_type.clone())
            .unwrap_or_else(|| "local".to_string());
        let description = runtime_entry
            .as_ref()
            .and_then(|entry| entry.description.clone())
            .or_else(|| local.description.clone())
            .or_else(|| {
                imported_entry
                    .as_ref()
                    .and_then(|entry| entry.description.clone())
            })
            .unwrap_or_else(|| "未提供功能描述".to_string());
        description_map
            .entry(local.display_name.clone())
            .or_insert_with(|| Value::String(description.clone()));
        description_map
            .entry(local.folder_name.clone())
            .or_insert_with(|| Value::String(description.clone()));
        seen_display_names.insert(local.display_name.to_ascii_lowercase());
        let item_id = local.folder_name.clone();
        let item_name = local.display_name.clone();
        let folder_name = local.folder_name.clone();
        let item_path = local.path.to_string_lossy().to_string();
        let item_source_type = if is_ui_skill {
            "ui".to_string()
        } else if is_component_skill {
            "component".to_string()
        } else {
            source_type.clone()
        };
        normalized_items.push(json!({
            "id": item_id,
            "name": item_name,
            "folderName": folder_name,
            "description": description,
            "path": item_path,
            "sourceType": item_source_type,
            "category": if is_ui_skill {
                "system_ui"
            } else if is_component_skill {
                "component"
            } else {
                "custom"
            },
            "isSystem": is_ui_skill,
            "isImported": imported_entry.is_some(),
            "canDelete": !is_ui_skill
        }));
    }

    for entry in runtime_entries {
        let lowered = entry.name.to_ascii_lowercase();
        if seen_display_names.contains(&lowered) {
            continue;
        }
        seen_display_names.insert(lowered);
        let is_ui_skill = entry.name.eq_ignore_ascii_case(DEFAULT_UI_SKILL_NAME);
        let is_bundled = entry.source_type.eq_ignore_ascii_case("bundled");
        let is_system = is_ui_skill || is_bundled;
        let category = if is_ui_skill {
            "system_ui"
        } else if is_bundled {
            "builtin"
        } else {
            "custom"
        };
        let description = entry
            .description
            .clone()
            .unwrap_or_else(|| "未提供功能描述".to_string());
        description_map
            .entry(entry.name.clone())
            .or_insert_with(|| Value::String(description.clone()));
        let item_id = entry.name.clone();
        let item_name = entry.name.clone();
        let runtime_source_type = if is_ui_skill {
            "ui".to_string()
        } else {
            entry.source_type.clone()
        };
        normalized_items.push(json!({
            "id": item_id,
            "name": item_name.clone(),
            "folderName": Value::Null,
            "description": description,
            "path": format!("runtime://{}/{}", runtime_source_type, item_name),
            "sourceType": runtime_source_type,
            "category": category,
            "isSystem": is_system,
            "isImported": false,
            "canDelete": false
        }));
    }

    let imported_payload = imported_entries
        .iter()
        .map(|entry| {
            let description = entry.description.clone();
            if let Some(value) = description.as_ref() {
                description_map
                    .entry(entry.record.name.clone())
                    .or_insert_with(|| Value::String(value.clone()));
            }
            json!({
                "name": entry.record.name,
                "source_path": entry.record.source_path,
                "installed_path": entry.record.installed_path,
                "updated_at": entry.record.updated_at,
                "description": description
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(json!({
        "storage": {
            "dbPath": db_path.to_string_lossy().to_string(),
            "skillsRoot": skills_root.to_string_lossy().to_string()
        },
        "descriptions": Value::Object(description_map),
        "items": normalized_items,
        "imported": imported_payload,
        "localFolders": local_dirs,
        "runtime": runtime
    })))
}

#[derive(Deserialize)]
pub struct ImportGlobalSkillRequest {
    #[serde(alias = "sourcePath")]
    pub source_path: String,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Deserialize)]
pub struct ImportGlobalSkillUploadQuery {
    pub name: Option<String>,
    pub filename: Option<String>,
    pub overwrite: Option<bool>,
}

pub async fn import_global_skill(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<ImportGlobalSkillRequest>,
) -> Result<Json<Value>, ApiError> {
    let source = PathBuf::from(payload.source_path.trim());
    if !source.is_dir() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "source_path 必须是已存在的目录",
        ));
    }

    let payload = install_skill_from_dir(
        &source,
        None,
        payload.overwrite,
        source.to_string_lossy().as_ref(),
    )?;
    Ok(Json(payload))
}

pub async fn import_global_skill_upload(
    State(_state): State<Arc<AppState>>,
    Query(query): Query<ImportGlobalSkillUploadQuery>,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    if body.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "上传内容为空，请选择 zip 文件",
        ));
    }

    let tick = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_root = std::env::temp_dir().join(format!(
        "webot-skill-upload-{}-{}",
        std::process::id(),
        tick
    ));
    fs::create_dir_all(&temp_root).map_err(|e| storage_error(format!("创建临时目录失败: {e}")))?;
    extract_zip_to_dir(&body, &temp_root)?;

    let candidates = find_skill_dirs(&temp_root)?;
    if candidates.is_empty() {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "zip 内未找到 SKILL.md，请确认压缩包结构正确",
        ));
    }

    let requested_name = query
        .name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string);
    let selected = if let Some(name) = requested_name.as_deref() {
        if let Some(found) = candidates.iter().find(|path| {
            path.file_name()
                .and_then(|v| v.to_str())
                .map(|v| v.eq_ignore_ascii_case(name))
                .unwrap_or(false)
        }) {
            found.clone()
        } else if candidates.len() == 1 {
            candidates[0].clone()
        } else {
            let _ = fs::remove_dir_all(&temp_root);
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "zip 内包含多个 skill 目录，请传入 name 指定目标目录",
            ));
        }
    } else if candidates.len() == 1 {
        candidates[0].clone()
    } else {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "zip 内包含多个 skill 目录，请在导入时填写技能名称",
        ));
    };

    let payload = install_skill_from_dir(
        &selected,
        requested_name,
        query.overwrite.unwrap_or(true),
        &format!(
            "upload://{}",
            query
                .filename
                .as_deref()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or("skill.zip")
        ),
    )?;
    let _ = fs::remove_dir_all(&temp_root);
    Ok(Json(payload))
}

pub async fn import_global_skill_files(
    State(_state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    let tick = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_root = std::env::temp_dir().join(format!(
        "webot-skill-folder-upload-{}-{}",
        std::process::id(),
        tick
    ));
    fs::create_dir_all(&temp_root).map_err(|e| storage_error(format!("创建临时目录失败: {e}")))?;

    let mut requested_name: Option<String> = None;
    let mut overwrite = true;
    let mut file_count = 0usize;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!("读取上传内容失败: {e}"),
        )
    })? {
        let field_name = field.name().unwrap_or_default().to_string();
        if field_name == "name" {
            let value = field.text().await.map_err(|e| {
                ApiError::new(
                    axum::http::StatusCode::BAD_REQUEST,
                    format!("读取 name 失败: {e}"),
                )
            })?;
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                requested_name = Some(trimmed);
            }
            continue;
        }
        if field_name == "overwrite" {
            let value = field.text().await.map_err(|e| {
                ApiError::new(
                    axum::http::StatusCode::BAD_REQUEST,
                    format!("读取 overwrite 失败: {e}"),
                )
            })?;
            overwrite = matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            );
            continue;
        }
        if field_name != "files" {
            continue;
        }

        let Some(raw_filename) = field.file_name() else {
            continue;
        };
        let rel_path = sanitize_upload_relative_path(raw_filename)?;
        let output_path = temp_root.join(rel_path);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| storage_error(format!("创建目录失败: {e}")))?;
        }
        let bytes = field.bytes().await.map_err(|e| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("读取文件内容失败: {e}"),
            )
        })?;
        fs::write(&output_path, &bytes).map_err(|e| storage_error(format!("写入文件失败: {e}")))?;
        file_count += 1;
    }

    if file_count == 0 {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "未检测到上传文件，请选择技能文件夹后重试",
        ));
    }

    let candidates = find_skill_dirs(&temp_root)?;
    if candidates.is_empty() {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "上传目录中未找到 SKILL.md",
        ));
    }

    let selected = if let Some(name) = requested_name.as_deref() {
        if let Some(found) = candidates.iter().find(|path| {
            path.file_name()
                .and_then(|v| v.to_str())
                .map(|v| v.eq_ignore_ascii_case(name))
                .unwrap_or(false)
        }) {
            found.clone()
        } else if candidates.len() == 1 {
            candidates[0].clone()
        } else {
            let _ = fs::remove_dir_all(&temp_root);
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "检测到多个技能目录，请填写技能名称以指定导入目标",
            ));
        }
    } else if candidates.len() == 1 {
        candidates[0].clone()
    } else {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "检测到多个技能目录，请填写技能名称以指定导入目标",
        ));
    };

    let payload = install_skill_from_dir(&selected, requested_name, overwrite, "upload://folder")?;
    let _ = fs::remove_dir_all(&temp_root);
    Ok(Json(payload))
}

pub async fn delete_global_skill(
    State(_state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let skill_name = name.trim();
    if skill_name.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "skill 名称不能为空",
        ));
    }

    let skills_root = assignment_store::skills_root().map_err(storage_error)?;
    let target = skills_root.join(skill_name);
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|e| storage_error(format!("删除 skill 目录失败: {e}")))?;
    }
    assignment_store::delete_imported_skill(skill_name).map_err(storage_error)?;

    Ok(Json(json!({
        "status": "deleted",
        "name": skill_name,
        "removedPath": target.to_string_lossy().to_string(),
        "note": "若该 skill 已被 OpenFang 运行时加载，请重启 OpenFang 使移除完全生效。"
    })))
}

pub async fn get_global_mcp_config(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let db_path = assignment_store::ensure_db().map_err(storage_error)?;
    let config = assignment_store::get_global_mcp_config().map_err(storage_error)?;
    Ok(Json(json!({
        "dbPath": db_path.to_string_lossy().to_string(),
        "config": config
    })))
}

pub async fn set_global_mcp_config(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    assignment_store::set_global_mcp_config(&payload).map_err(storage_error)?;
    let known = extract_mcp_server_map(&payload);
    let db_path = assignment_store::ensure_db().map_err(storage_error)?;
    Ok(Json(json!({
        "status": "ok",
        "dbPath": db_path.to_string_lossy().to_string(),
        "config": payload,
        "known_mcp_servers": known.keys().cloned().collect::<Vec<_>>(),
        "note": "全局 MCP 配置仅保存，不会立即连接。开启智能体的 MCP 开关时再按需加载。"
    })))
}

pub async fn clear_global_mcp_config(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    assignment_store::clear_global_mcp_config().map_err(storage_error)?;
    let db_path = assignment_store::ensure_db().map_err(storage_error)?;
    Ok(Json(json!({
        "status": "cleared",
        "dbPath": db_path.to_string_lossy().to_string()
    })))
}

fn default_memory_enhancement_config() -> Value {
    json!({
        "enabled": true,
        "mode": "remote",
        "base_url": "",
        "api_key": "",
        "agent_id": "",
        "timeout_ms": 60000,
        "target_uri": "viking://user/memories",
        "recall_limit": 8,
        "recall_score_threshold": 0.45,
        "auto_recall": true,
        "auto_capture": true,
        "embedding": {
            "provider": "openai",
            "api_base": "",
            "api_key": "",
            "model": "",
            "dimension": 1536
        },
        "llm": {
            "provider": "openai",
            "api_base": "",
            "api_key": "",
            "model": ""
        },
        "group_memory_strategy": {
            "mode": "group_isolation",
            "personal_overlay": true,
            "personal_types": ["preference", "fact"],
            "note": "群聊按群隔离；同时叠加当前发言人的个人记忆（与该人相关）。"
        }
    })
}

fn normalize_memory_enhancement_config(mut config: Value) -> Value {
    if let Some(obj) = config.as_object_mut() {
        let strategy = obj
            .entry("group_memory_strategy".to_string())
            .or_insert_with(|| json!({}));
        if let Some(strategy_obj) = strategy.as_object_mut() {
            strategy_obj.insert(
                "mode".to_string(),
                Value::String("group_isolation".to_string()),
            );
            strategy_obj.insert("personal_overlay".to_string(), Value::Bool(true));
            strategy_obj.insert(
                "personal_types".to_string(),
                Value::Array(vec![
                    Value::String("preference".to_string()),
                    Value::String("fact".to_string()),
                ]),
            );
            strategy_obj.insert(
                "note".to_string(),
                Value::String(
                    "群聊按群隔离；同时叠加当前发言人的个人记忆（与该人相关）。".to_string(),
                ),
            );
        } else {
            obj.insert(
                "group_memory_strategy".to_string(),
                json!({
                    "mode": "group_isolation",
                    "personal_overlay": true,
                    "personal_types": ["preference", "fact"],
                    "note": "群聊按群隔离；同时叠加当前发言人的个人记忆（与该人相关）。"
                }),
            );
        }
    }
    config
}

#[derive(Debug, Clone, Copy)]
struct MemoryEnhancementRuntimeConfig {
    enabled: bool,
    auto_recall: bool,
    recall_limit: usize,
    recall_score_threshold: f32,
}

#[derive(Debug, Clone)]
struct SemanticMemoryRecallContext {
    prompt: String,
    query: String,
    hit_count: usize,
    log_detail: String,
}

async fn fetch_semantic_memory_rows(
    state: &Arc<AppState>,
    agent_id: &str,
    query: &str,
    limit: usize,
    min_confidence: f32,
) -> Result<Option<Vec<Value>>, ApiError> {
    let params = vec![
        ("q".to_string(), query.to_string()),
        ("limit".to_string(), limit.to_string()),
        ("min_confidence".to_string(), min_confidence.to_string()),
    ];
    let unified_path = format!("/api/memory/agents/{agent_id}/unified-search");
    let payload = match state
        .openfang
        .get_json_with_query(&unified_path, &params)
        .await
    {
        Ok(data) => data,
        Err(error) if is_semantic_memory_endpoint_unavailable(&error) => {
            let legacy_path = format!("/api/memory/agents/{agent_id}/search");
            tracing::warn!(
                agent_id = %agent_id,
                "unified memory endpoint unavailable, fallback to legacy semantic search"
            );
            match state
                .openfang
                .get_json_with_query(&legacy_path, &params)
                .await
            {
                Ok(data) => {
                    let rows = data
                        .get("memories")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    return Ok(Some(normalize_legacy_semantic_rows(
                        rows,
                        min_confidence,
                        !query.trim().is_empty(),
                    )));
                }
                Err(legacy_error) if is_semantic_memory_endpoint_unavailable(&legacy_error) => {
                    tracing::warn!(
                        agent_id = %agent_id,
                        "semantic memory auto recall skipped because upstream memory endpoints are unavailable"
                    );
                    return Ok(None);
                }
                Err(legacy_error) => return Err(legacy_error),
            }
        }
        Err(error) => return Err(error),
    };

    let mut rows = payload
        .get("memories")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // upstream unified-search 当前不会使用 min_confidence，这里按 score 阈值做本地过滤。
    // 注意：recent window (query="") 不应被阈值过滤，否则会导致完全无候选。
    if !query.trim().is_empty() {
        rows.retain(|row| {
            row.get("score").and_then(Value::as_f64).unwrap_or(0.0) >= min_confidence as f64
        });
    }
    Ok(Some(rows))
}

async fn fetch_unified_memory_debug_plan_lines(
    state: &Arc<AppState>,
    agent_id: &str,
    query: &str,
    limit: usize,
) -> Result<Option<Vec<String>>, ApiError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let params = vec![
        ("q".to_string(), trimmed.to_string()),
        ("limit".to_string(), limit.to_string()),
    ];
    let path = format!("/api/memory/agents/{agent_id}/unified-debug");
    let payload = match state.openfang.get_json_with_query(&path, &params).await {
        Ok(data) => data,
        Err(error) if is_semantic_memory_endpoint_unavailable(&error) => return Ok(None),
        Err(error) => return Err(error),
    };

    let mut lines = Vec::new();
    if let Some(plan) = payload.get("query_plan") {
        let seed = plan
            .get("projection_seed_count")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let subj_type = plan
            .get("subject_type")
            .and_then(Value::as_str)
            .unwrap_or("");
        let subj_id = plan.get("subject_id").and_then(Value::as_str).unwrap_or("");
        lines.push(format!(
            "query_plan: subject={}:{} seed_events={} limit={}",
            subj_type, subj_id, seed, limit
        ));
    }

    let subject_plan = payload
        .get("subject_plan")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !subject_plan.is_empty() {
        lines.push(format!("subject_plan: {} subjects", subject_plan.len()));
        for row in subject_plan.into_iter().take(10) {
            let st = row
                .get("subject_type")
                .and_then(Value::as_str)
                .unwrap_or("");
            let sid = row.get("subject_id").and_then(Value::as_str).unwrap_or("");
            let depth = row.get("depth").and_then(Value::as_u64).unwrap_or(0);
            let w = row.get("weight").and_then(Value::as_f64).unwrap_or(0.0);
            let rel = row
                .get("relation_strength")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            lines.push(format!(
                "- {}:{} depth={} w={:.2} rel={:.2}",
                st, sid, depth, w, rel
            ));
        }
    }

    if lines.is_empty() {
        Ok(None)
    } else {
        Ok(Some(lines))
    }
}

fn merge_semantic_memory_rows(
    relevant_rows: Vec<Value>,
    recent_rows: Vec<Value>,
    limit: usize,
) -> Vec<Value> {
    let mut merged = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut seen_contents = HashSet::new();

    for row in relevant_rows.into_iter().chain(recent_rows.into_iter()) {
        let row_id = row
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let row_content = row
            .get("content")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);

        let duplicate = row_id
            .as_ref()
            .map(|value| seen_ids.contains(value))
            .unwrap_or(false)
            || row_content
                .as_ref()
                .map(|value| seen_contents.contains(value))
                .unwrap_or(false);
        if duplicate {
            continue;
        }

        if let Some(row_id) = row_id {
            seen_ids.insert(row_id);
        }
        if let Some(row_content) = row_content {
            seen_contents.insert(row_content);
        }
        merged.push(row);
        if merged.len() >= limit {
            break;
        }
    }

    merged
}

fn resolve_memory_enhancement_runtime_config() -> Result<MemoryEnhancementRuntimeConfig, ApiError> {
    let stored = assignment_store::get_memory_enhancement_config().map_err(storage_error)?;
    let config = normalize_memory_enhancement_config(
        stored.unwrap_or_else(default_memory_enhancement_config),
    );
    let enabled = config
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let auto_recall = config
        .get("auto_recall")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let recall_limit = config
        .get("recall_limit")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(1, 12) as usize)
        .unwrap_or(8);
    let recall_score_threshold = config
        .get("recall_score_threshold")
        .and_then(Value::as_f64)
        .map(|value| value.clamp(0.0, 1.0) as f32)
        .unwrap_or(0.45);

    Ok(MemoryEnhancementRuntimeConfig {
        enabled,
        auto_recall,
        recall_limit,
        recall_score_threshold,
    })
}

pub async fn get_memory_enhancement_config(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let db_path = assignment_store::ensure_db().map_err(storage_error)?;
    let stored = assignment_store::get_memory_enhancement_config().map_err(storage_error)?;
    let (config, source, configured) = match stored {
        Some(value) => (normalize_memory_enhancement_config(value), "stored", true),
        None => (
            normalize_memory_enhancement_config(default_memory_enhancement_config()),
            "default",
            false,
        ),
    };
    Ok(Json(json!({
        "dbPath": db_path.to_string_lossy().to_string(),
        "source": source,
        "configured": configured,
        "config": config,
        "note": "默认关闭且不影响现有记忆链路，仅在开启后才参与记忆增强。"
    })))
}

pub async fn set_memory_enhancement_config(
    State(_state): State<Arc<AppState>>,
    Json(mut payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if !payload.is_object() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "记忆增强配置必须是 JSON 对象",
        ));
    }
    payload = normalize_memory_enhancement_config(payload);
    assignment_store::set_memory_enhancement_config(&payload).map_err(storage_error)?;
    let db_path = assignment_store::ensure_db().map_err(storage_error)?;
    let enabled = payload
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(Json(json!({
        "status": "ok",
        "dbPath": db_path.to_string_lossy().to_string(),
        "enabled": enabled,
        "config": payload,
        "note": "该配置为旁路增强配置；关闭时不会影响当前默认记忆系统。"
    })))
}

pub async fn reload_mcp_runtime(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let runtime = sync_active_mcp_servers_to_runtime(&state).await?;
    let status = state.openfang.get_json("/api/mcp/servers").await?;
    Ok(Json(json!({
        "status": "ok",
        "runtime": runtime,
        "mcp": status
    })))
}

pub async fn list_workflows(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let data = state.openfang.get_json("/api/workflows").await?;
    Ok(Json(data))
}

#[derive(Deserialize)]
pub struct RunWorkflowRequest {
    #[serde(default)]
    pub input: Option<Value>,
}

pub async fn run_workflow(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<RunWorkflowRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let path = format!("/api/workflows/{id}/run");
    let body = json!({
        "input": payload.input.unwrap_or_else(|| json!(""))
    });
    let data = state.openfang.post_json(&path, body).await?;
    Ok(Json(data))
}

pub async fn list_managed_tasks_route(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ManagedTaskListQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let mut params = Vec::new();
    if let Some(agent_id) = query
        .agent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        validate_agent_path_segment(agent_id)?;
        params.push(("agent_id".to_string(), agent_id.to_string()));
    }
    let data = state
        .openfang
        .get_json_with_query("/api/tasks", &params)
        .await?;
    Ok(Json(data))
}

pub async fn create_managed_task_route(
    State(state): State<Arc<AppState>>,
    Json(mut payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    normalize_managed_task_create_payload(&state, &mut payload).await?;
    let data = state.openfang.post_json("/api/tasks", payload).await?;
    Ok(Json(data))
}

async fn normalize_managed_task_create_payload(
    state: &Arc<AppState>,
    payload: &mut Value,
) -> Result<(), ApiError> {
    let Some(object) = payload.as_object_mut() else {
        return Ok(());
    };
    normalize_agent_id_alias_field(state, object, "agent_id").await?;
    if let Some(binding) = object.get_mut("binding").and_then(Value::as_object_mut) {
        normalize_agent_id_alias_field(state, binding, "remote_chat_session_owner_agent_id")
            .await?;
        normalize_agent_id_alias_field(state, binding, "executor_agent_id").await?;
        normalize_agent_id_alias_field(state, binding, "report_actor_agent_id").await?;
    }
    Ok(())
}

async fn normalize_agent_id_alias_field(
    state: &Arc<AppState>,
    object: &mut serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), ApiError> {
    let Some(raw_id) = object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let resolved = resolve_agent_id_alias(state, raw_id).await?;
    if resolved.alias_used {
        object.insert(key.to_string(), Value::String(resolved.resolved));
    }
    Ok(())
}

pub async fn get_managed_task_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}");
    let data = state.openfang.get_json(&path).await?;
    Ok(Json(data))
}

pub async fn delete_managed_task_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}");
    let data = state.openfang.delete_json(&path).await?;
    Ok(Json(data))
}

pub async fn publish_managed_task_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}/publish");
    let data = state.openfang.post_json(&path, json!({})).await?;
    Ok(Json(data))
}

pub async fn pause_managed_task_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}/pause");
    let data = state.openfang.post_json(&path, json!({})).await?;
    Ok(Json(data))
}

pub async fn run_managed_task_once_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}/run-once");
    let state_for_run = state.clone();
    let task_id = id.clone();
    let path_for_run = path.clone();
    tokio::spawn(async move {
        match state_for_run
            .openfang
            .post_json_with_timeout(
                &path_for_run,
                json!({}),
                std::time::Duration::from_secs(240),
            )
            .await
        {
            Ok(_) => {
                tracing::info!(task_id = %task_id, "managed task run-once accepted by OpenFang");
            }
            Err(error) => {
                tracing::warn!(task_id = %task_id, error = %error.message, "managed task run-once background trigger failed");
            }
        }
    });
    Ok(Json(json!({
        "status": "accepted",
        "task_id": id,
    })))
}

pub async fn list_managed_task_runs_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}/runs");
    let data = state.openfang.get_json(&path).await?;
    Ok(Json(data))
}

pub async fn list_managed_task_events_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}/events");
    let data = state.openfang.get_json(&path).await?;
    Ok(Json(data))
}

pub async fn list_managed_task_deliveries_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}/deliveries");
    let data = state.openfang.get_json(&path).await?;
    if let Some(rows) = data.as_array() {
        for row in rows {
            let _ = upsert_local_task_delivery_from_upstream(row);
        }
    }
    Ok(Json(data))
}

pub async fn list_managed_task_delivery_attempts_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}/delivery-attempts");
    let data = state.openfang.get_json(&path).await?;
    Ok(Json(data))
}

pub async fn list_managed_task_timeline_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/{id}/timeline");
    let data = state.openfang.get_json(&path).await?;
    Ok(Json(data))
}

pub async fn list_managed_task_pending_deliveries_route(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ManagedTaskPendingDeliveriesQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let mut params = Vec::new();
    if let Some(target_kind) = query
        .target_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        params.push(("target_kind".to_string(), target_kind.to_string()));
    }
    if let Some(chat_session_id) = query
        .origin_chat_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        params.push((
            "origin_chat_session_id".to_string(),
            chat_session_id.to_string(),
        ));
    }
    let data = timeout(
        Duration::from_secs(MANAGED_TASK_DELIVERY_UPSTREAM_TIMEOUT_SECS),
        state
            .openfang
            .get_json_with_query("/api/tasks/deliveries/pending", &params),
    )
    .await
    .map_err(|_| {
        ApiError::new(
            StatusCode::GATEWAY_TIMEOUT,
            "任务投递查询超时，请稍后重试。",
        )
    })??;
    if let Some(rows) = data.as_array() {
        for row in rows {
            let _ = upsert_local_task_delivery_from_upstream(row);
        }
    }
    Ok(Json(data))
}

pub async fn list_notifications_route(
    State(state): State<Arc<AppState>>,
    Query(query): Query<NotificationsListQuery>,
) -> Result<Json<Value>, ApiError> {
    let _ = sync_notifications_from_runtime(&state).await;
    let rows = assignment_store::list_notifications(&assignment_store::NotificationListQuery {
        unread_only: query.unread_only.unwrap_or(false),
        include_archived: query.include_archived.unwrap_or(false),
        notification_type: query
            .notification_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        source_domain: query
            .source_domain
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        agent_id: query
            .agent_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        query: query
            .q
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        created_from: query
            .created_from
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        created_to: query
            .created_to
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        limit: query.limit,
    })
    .map_err(storage_error)?;
    Ok(Json(json!({ "notifications": rows })))
}

pub async fn get_notification_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let _ = sync_notifications_from_runtime(&state).await;
    let record = assignment_store::get_notification_by_id(id.trim())
        .map_err(storage_error)?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "通知不存在"))?;
    Ok(Json(json!({ "notification": record })))
}

pub async fn mark_notification_read_route(Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    assignment_store::mark_notification_read(id.trim()).map_err(storage_error)?;
    let record = assignment_store::get_notification_by_id(id.trim()).map_err(storage_error)?;
    Ok(Json(json!({ "notification": record })))
}

pub async fn mark_all_notifications_read_route() -> Result<Json<Value>, ApiError> {
    let updated = assignment_store::mark_all_notifications_read().map_err(storage_error)?;
    Ok(Json(json!({ "updated_count": updated })))
}

pub async fn archive_notification_route(Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    assignment_store::archive_notification(id.trim()).map_err(storage_error)?;
    let record = assignment_store::get_notification_by_id(id.trim()).map_err(storage_error)?;
    Ok(Json(json!({ "notification": record })))
}

pub async fn delete_notification_route(Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let deleted = assignment_store::delete_notification(id.trim()).map_err(storage_error)?;
    if deleted == 0 {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "通知不存在"));
    }
    Ok(Json(json!({
        "status": "deleted",
        "notification_id": id.trim(),
    })))
}

pub async fn get_notifications_unread_count_route(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let _ = sync_notifications_from_runtime(&state).await;
    let unread_count = assignment_store::count_unread_notifications().map_err(storage_error)?;
    Ok(Json(json!({ "unread_count": unread_count })))
}

pub async fn get_notification_settings_route() -> Result<Json<Value>, ApiError> {
    let value = merge_notification_settings_with_defaults(
        assignment_store::get_notification_settings().map_err(storage_error)?,
    );
    Ok(Json(value))
}

pub async fn update_notification_settings_route(
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let normalized = merge_notification_settings_with_defaults(Some(payload));
    assignment_store::set_notification_settings(&normalized).map_err(storage_error)?;
    Ok(Json(normalized))
}

pub async fn update_managed_task_delivery_status_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateTaskDeliveryStatusRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let path = format!("/api/tasks/deliveries/{id}/status");
    let data = timeout(
        Duration::from_secs(MANAGED_TASK_DELIVERY_UPSTREAM_TIMEOUT_SECS),
        state
            .openfang
            .post_json(&path, json!({ "status": payload.status })),
    )
    .await
    .map_err(|_| {
        ApiError::new(
            StatusCode::GATEWAY_TIMEOUT,
            "任务投递状态更新超时，请稍后重试。",
        )
    })??;
    Ok(Json(data))
}

fn parse_editable_messages_from_session_payload(
    payload: &Value,
) -> Vec<EditableChatSessionMessage> {
    payload
        .get("messages")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|item| {
                    let role = item
                        .get("role")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())?;
                    let content = item
                        .get("content")
                        .and_then(|value| {
                            value.as_str().map(ToString::to_string).or_else(|| {
                                value
                                    .get("text")
                                    .and_then(Value::as_str)
                                    .map(ToString::to_string)
                            })
                        })
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty())?;
                    Some(EditableChatSessionMessage {
                        role: role.to_string(),
                        content,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn read_trimmed_value<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
    })
}

fn default_notification_settings_value() -> Value {
    json!({
        "version": 1,
        "enabled_channels": ["system"],
        "targets": {
            "telegram": "",
            "feishu": "",
            "qqbot": "",
            "whatsapp": ""
        },
        "fallback_to_system": true
    })
}

fn merge_notification_settings_with_defaults(input: Option<Value>) -> Value {
    let mut base = default_notification_settings_value();
    let Some(next) = input.and_then(|value| value.as_object().cloned()) else {
        return base;
    };
    if let Some(object) = base.as_object_mut() {
        for (key, value) in next {
            object.insert(key, value);
        }
        let enabled_channels = object
            .get("enabled_channels")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(Value::as_str)
                    .map(|item| item.trim().to_ascii_lowercase())
                    .filter(|item| {
                        matches!(
                            item.as_str(),
                            "system" | "telegram" | "feishu" | "qqbot" | "whatsapp"
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| vec!["system".to_string()]);
        object.insert(
            "enabled_channels".to_string(),
            Value::Array(
                enabled_channels
                    .into_iter()
                    .map(Value::String)
                    .collect::<Vec<_>>(),
            ),
        );
    }
    base
}

fn notification_settings_enabled_channels(settings: &Value) -> Vec<String> {
    settings
        .get("enabled_channels")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(|item| item.trim().to_ascii_lowercase())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec!["system".to_string()])
}

fn upsert_local_task_delivery_from_upstream(delivery: &Value) -> Result<(), ApiError> {
    let id = read_trimmed_value(delivery, &["id"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.id 缺失"))?;
    let task_id = read_trimmed_value(delivery, &["task_id", "taskId"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.task_id 缺失"))?;
    let owner_agent_id =
        read_trimmed_value(delivery, &["owner_agent_id", "ownerAgentId"]).unwrap_or_default();
    let source_run_id = read_trimmed_value(delivery, &["run_id", "runId"]).map(ToString::to_string);
    let payload = delivery
        .get("payload")
        .cloned()
        .unwrap_or_else(|| Value::Object(Default::default()));
    let delivery_kind = read_trimmed_value(delivery, &["delivery_kind", "deliveryKind"])
        .or_else(|| read_trimmed_value(&payload, &["delivery_kind", "deliveryKind"]))
        .unwrap_or("final")
        .to_string();
    let task_name = read_trimmed_value(delivery, &["task_name", "taskName"])
        .or_else(|| read_trimmed_value(&payload, &["task_name", "taskName"]))
        .map(ToString::to_string);
    let run_count = delivery
        .get("run_count")
        .and_then(Value::as_i64)
        .or_else(|| payload.get("run_count").and_then(Value::as_i64));
    assignment_store::create_or_update_task_delivery(&assignment_store::TaskDeliveryRecord {
        id: id.to_string(),
        task_id: task_id.to_string(),
        owner_agent_id: owner_agent_id.to_string(),
        runtime_key: read_trimmed_value(delivery, &["runtime_key", "runtimeKey"])
            .map(ToString::to_string),
        delivery_kind,
        dedupe_key: read_trimmed_value(delivery, &["dedupe_key", "dedupeKey"])
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("task-delivery:{id}")),
        status: read_trimmed_value(delivery, &["status"])
            .unwrap_or("pending")
            .to_string(),
        origin_conversation_type: read_trimmed_value(
            delivery,
            &["origin_conversation_type", "originConversationType"],
        )
        .map(ToString::to_string),
        origin_conversation_id: read_trimmed_value(
            delivery,
            &["origin_conversation_id", "originConversationId"],
        )
        .map(ToString::to_string),
        origin_chat_session_id: read_trimmed_value(
            delivery,
            &["origin_chat_session_id", "originChatSessionId"],
        )
        .map(ToString::to_string),
        origin_message_id: read_trimmed_value(delivery, &["origin_message_id", "originMessageId"])
            .map(ToString::to_string),
        creator_participant_id: read_trimmed_value(
            delivery,
            &["creator_participant_id", "creatorParticipantId"],
        )
        .map(ToString::to_string),
        creator_participant_name: read_trimmed_value(
            delivery,
            &["creator_participant_name", "creatorParticipantName"],
        )
        .map(ToString::to_string),
        executor_agent_id: read_trimmed_value(delivery, &["executor_agent_id", "executorAgentId"])
            .map(ToString::to_string),
        executor_agent_name: read_trimmed_value(
            delivery,
            &["executor_agent_name", "executorAgentName"],
        )
        .map(ToString::to_string),
        report_actor_agent_id: read_trimmed_value(
            delivery,
            &["report_actor_agent_id", "reportActorAgentId"],
        )
        .map(ToString::to_string),
        report_actor_agent_name: read_trimmed_value(
            delivery,
            &["report_actor_agent_name", "reportActorAgentName"],
        )
        .map(ToString::to_string),
        task_name,
        run_count,
        summary_text: read_trimmed_value(delivery, &["summary_text", "summaryText", "body"])
            .map(ToString::to_string),
        error_text: read_trimmed_value(delivery, &["error_text", "errorText"])
            .map(ToString::to_string),
        payload,
        created_at: read_trimmed_value(delivery, &["created_at", "createdAt"])
            .unwrap_or_default()
            .to_string(),
        updated_at: read_trimmed_value(delivery, &["updated_at", "updatedAt"])
            .unwrap_or_default()
            .to_string(),
        reported_at: read_trimmed_value(delivery, &["reported_at", "reportedAt"])
            .map(ToString::to_string),
        acknowledged_at: read_trimmed_value(delivery, &["acknowledged_at", "acknowledgedAt"])
            .map(ToString::to_string),
    })
    .map_err(storage_error)?;
    let local = assignment_store::get_task_delivery(id)
        .map_err(storage_error)?
        .ok_or_else(|| storage_error("同步本地任务投递失败"))?;
    let (notification_type, severity) =
        match local.delivery_kind.trim().to_ascii_lowercase().as_str() {
            "progress" => ("progress", "info"),
            "anomaly" => ("anomaly", "error"),
            "final" => {
                if local
                    .summary_text
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_some()
                {
                    ("summary", "success")
                } else {
                    ("completed", "success")
                }
            }
            _ => ("system", "info"),
        };
    let title_prefix = match notification_type {
        "progress" => "任务进展",
        "anomaly" => "任务异常",
        "summary" => "任务总结",
        "completed" => "任务完成",
        _ => "任务通知",
    };
    let task_name = local
        .task_name
        .clone()
        .unwrap_or_else(|| "未命名任务".to_string());
    let mut detail_lines = Vec::new();
    if let Some(agent_name) = local
        .report_actor_agent_name
        .clone()
        .or_else(|| local.executor_agent_name.clone())
    {
        detail_lines.push(format!("发送智能体：{agent_name}"));
    } else if !local.owner_agent_id.trim().is_empty() {
        detail_lines.push(format!("发送智能体：{}", local.owner_agent_id.trim()));
    }
    detail_lines.push(format!("关联任务：{task_name}"));
    if let Some(run_count) = local.run_count {
        detail_lines.push(format!("执行轮次：第 {run_count} 次"));
    }
    if let Some(summary) = local
        .summary_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        detail_lines.push(summary.to_string());
    }
    if let Some(error_text) = local
        .error_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        detail_lines.push(error_text.to_string());
    }
    let source_domain = if local
        .origin_chat_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        "chat_task"
    } else {
        "manual_task"
    };
    assignment_store::upsert_notification(assignment_store::UpsertNotificationInput {
        source_key: format!("task_delivery:{}", local.id),
        source_domain: source_domain.to_string(),
        source_record_id: local.id.clone(),
        notification_type: notification_type.to_string(),
        severity: severity.to_string(),
        title: format!("{title_prefix}：{task_name}"),
        summary: local
            .summary_text
            .clone()
            .or_else(|| local.error_text.clone())
            .or_else(|| Some(format!("{title_prefix}已更新"))),
        detail: Some(detail_lines.join("\n")),
        agent_id: local
            .report_actor_agent_id
            .clone()
            .or_else(|| local.executor_agent_id.clone())
            .or_else(|| Some(local.owner_agent_id.clone())),
        agent_name: local
            .report_actor_agent_name
            .clone()
            .or_else(|| local.executor_agent_name.clone()),
        task_id: Some(local.task_id.clone()),
        task_name: Some(task_name),
        session_id: local.origin_chat_session_id.clone(),
        source_run_id,
        payload: local.payload.clone(),
        delivery_status: json!({
            "source_updated_at": local.updated_at,
            "task_delivery_status": local.status,
            "target_kind": read_trimmed_value(delivery, &["target_kind", "targetKind"]).unwrap_or_default(),
        }),
    })
    .map_err(storage_error)?;
    Ok(())
}

fn sync_capability_job_notifications_from_store() -> Result<(), ApiError> {
    let jobs =
        assignment_store::list_capability_jobs(None, None, Some(300)).map_err(storage_error)?;
    for job in jobs {
        let status = job.status.trim().to_ascii_lowercase();
        let (notification_type, severity) =
            if matches!(status.as_str(), "failed" | "error" | "cancelled") {
                ("failed", "error")
            } else if matches!(status.as_str(), "completed" | "succeeded" | "done") {
                if job
                    .summary
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_some()
                {
                    ("summary", "success")
                } else {
                    ("completed", "success")
                }
            } else {
                ("progress", "info")
            };
        let source_domain = if job
            .job_type
            .as_deref()
            .map(|value| value.to_ascii_lowercase().contains("video"))
            .unwrap_or(false)
        {
            "video_job"
        } else {
            "agent_workflow"
        };
        let title = format!(
            "{}：{}",
            match notification_type {
                "progress" => "异步任务进展",
                "failed" => "异步任务失败",
                "summary" => "异步任务总结",
                "completed" => "异步任务完成",
                _ => "异步任务通知",
            },
            job.title.clone().unwrap_or_else(|| job.job_id.clone())
        );
        let mut detail_lines = vec![
            format!("发送智能体：{}", job.owner_agent_id),
            format!(
                "关联任务：{}",
                job.title.clone().unwrap_or_else(|| job.job_id.clone())
            ),
            format!("状态：{}", job.status),
        ];
        if let Some(stage) = job
            .stage
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            detail_lines.push(format!("阶段：{stage}"));
        }
        if let Some(progress) = job.progress_percent {
            detail_lines.push(format!("进度：{}%", progress.round() as i64));
        }
        if let Some(summary) = job
            .summary
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            detail_lines.push(summary.to_string());
        }
        if let Some(error_message) = job
            .error_message
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            detail_lines.push(error_message.to_string());
        }
        assignment_store::upsert_notification(assignment_store::UpsertNotificationInput {
            source_key: format!("capability_job:{}", job.job_id),
            source_domain: source_domain.to_string(),
            source_record_id: job.job_id.clone(),
            notification_type: notification_type.to_string(),
            severity: severity.to_string(),
            title,
            summary: job.summary.clone().or_else(|| job.error_message.clone()),
            detail: Some(detail_lines.join("\n")),
            agent_id: Some(job.owner_agent_id.clone()),
            agent_name: None,
            task_id: None,
            task_name: job.title.clone(),
            session_id: None,
            source_run_id: None,
            payload: job.result_payload.clone(),
            delivery_status: json!({
                "source_updated_at": job.updated_at,
                "job_status": job.status,
                "progress_percent": job.progress_percent,
            }),
        })
        .map_err(storage_error)?;
    }
    Ok(())
}

fn notification_settings_target(settings: &Value, channel: &str) -> Option<String> {
    settings
        .get("targets")
        .and_then(Value::as_object)
        .and_then(|targets| targets.get(channel))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn notification_source_updated_at(record: &assignment_store::NotificationRecord) -> String {
    read_trimmed_value(&record.delivery_status, &["source_updated_at"])
        .map(ToString::to_string)
        .unwrap_or_else(|| record.updated_at.clone())
}

fn notification_delivery_attempts(status: &Value) -> Vec<Value> {
    status
        .get("delivery_attempts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn notification_attempt_exists(attempts: &[Value], channel: &str, source_updated_at: &str) -> bool {
    attempts.iter().any(|item| {
        read_trimmed_value(item, &["channel"]) == Some(channel)
            && read_trimmed_value(item, &["source_updated_at", "sourceUpdatedAt"])
                == Some(source_updated_at)
    })
}

fn notification_message_body(record: &assignment_store::NotificationRecord) -> String {
    record
        .detail
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            record
                .summary
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| record.title.clone())
}

fn build_system_delivery_attempt(source_updated_at: &str) -> Value {
    json!({
        "channel": "system",
        "status": "delegated",
        "handler": "desktop_client",
        "source_updated_at": source_updated_at,
        "created_at": chrono::Utc::now().to_rfc3339(),
    })
}

async fn deliver_notification_to_channel(
    record: &assignment_store::NotificationRecord,
    channel: &str,
    target: Option<&str>,
) -> Value {
    let title = record.title.trim();
    let message = notification_message_body(record);
    let source_updated_at = notification_source_updated_at(record);
    let resolved_channel = channel.trim().to_ascii_lowercase();
    let rendered = notification_text(title, &message, Some(record.severity.as_str()));
    let attempt_time = chrono::Utc::now().to_rfc3339();

    let (binding, targets) = if resolved_channel == "whatsapp" {
        (None, split_notification_targets(target))
    } else {
        let binding = match resolve_channel_binding_for_notification(
            record.agent_id.as_deref(),
            Some(resolved_channel.as_str()),
        ) {
            Ok(next) => next,
            Err(error) => {
                return json!({
                    "channel": resolved_channel,
                    "status": "failed",
                    "reason": error.message,
                    "created_at": attempt_time,
                    "source_updated_at": source_updated_at,
                });
            }
        };
        let Some(binding) = binding else {
            return json!({
                "channel": resolved_channel,
                "status": "failed",
                "reason": "当前智能体未配置可用通知渠道",
                "created_at": attempt_time,
                "source_updated_at": source_updated_at,
            });
        };
        let (missing, missing_env) = validate_channel_binding_requirements(&binding);
        if !missing.is_empty() || !missing_env.is_empty() {
            return json!({
                "channel": resolved_channel,
                "status": "failed",
                "reason": if !missing.is_empty() {
                    format!("渠道配置缺少字段: {}", missing.join(", "))
                } else {
                    format!("渠道缺少环境变量: {}", missing_env.join(", "))
                },
                "created_at": attempt_time,
                "source_updated_at": source_updated_at,
            });
        }
        let targets = resolve_notification_targets(&binding, target);
        (Some(binding), targets)
    };

    if targets.is_empty() {
        return json!({
            "channel": resolved_channel,
            "status": "failed",
            "reason": "渠道已配置，但没有可用通知目标",
            "created_at": attempt_time,
            "source_updated_at": source_updated_at,
        });
    }

    let result = match binding.as_ref() {
        Some(binding) => dispatch_channel_notification(binding, &targets, &rendered).await,
        None if resolved_channel == "whatsapp" => {
            send_whatsapp_notification(&targets, &rendered).await
        }
        None => Err(format!("暂不支持的渠道类型: {resolved_channel}")),
    };

    match result {
        Ok(delivered_targets) => json!({
            "channel": resolved_channel,
            "status": "succeeded",
            "delivered_targets": delivered_targets,
            "created_at": attempt_time,
            "source_updated_at": source_updated_at,
        }),
        Err(reason) => json!({
            "channel": resolved_channel,
            "status": "failed",
            "resolved_target": targets.join(","),
            "reason": reason,
            "created_at": attempt_time,
            "source_updated_at": source_updated_at,
        }),
    }
}

async fn dispatch_notifications_from_store() -> Result<(), ApiError> {
    let settings = merge_notification_settings_with_defaults(
        assignment_store::get_notification_settings().map_err(storage_error)?,
    );
    let enabled_channels = notification_settings_enabled_channels(&settings);
    if enabled_channels.is_empty() {
        return Ok(());
    }
    let include_system = enabled_channels.iter().any(|item| item == "system");
    let fallback_to_system = settings
        .get("fallback_to_system")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let notifications =
        assignment_store::list_notifications(&assignment_store::NotificationListQuery {
            unread_only: false,
            include_archived: false,
            notification_type: None,
            source_domain: None,
            agent_id: None,
            query: None,
            created_from: None,
            created_to: None,
            limit: Some(200),
        })
        .map_err(storage_error)?;

    for record in notifications {
        let source_updated_at = notification_source_updated_at(&record);
        let mut attempts = notification_delivery_attempts(&record.delivery_status);
        let mut changed = false;
        let mut fallback_needed = false;

        for channel in enabled_channels
            .iter()
            .filter(|item| item.as_str() != "system")
        {
            if notification_attempt_exists(&attempts, channel, &source_updated_at) {
                continue;
            }
            let target = notification_settings_target(&settings, channel);
            let attempt =
                deliver_notification_to_channel(&record, channel, target.as_deref()).await;
            if read_trimmed_value(&attempt, &["status"]) == Some("failed") {
                fallback_needed = true;
            }
            attempts.push(attempt);
            changed = true;
        }

        if (include_system || (fallback_to_system && fallback_needed))
            && !notification_attempt_exists(&attempts, "system", &source_updated_at)
        {
            attempts.push(build_system_delivery_attempt(&source_updated_at));
            changed = true;
        }

        if changed {
            let mut next_status = match record.delivery_status.clone() {
                Value::Object(map) => map,
                _ => Map::new(),
            };
            next_status.insert(
                "source_updated_at".to_string(),
                Value::String(source_updated_at.clone()),
            );
            next_status.insert("delivery_attempts".to_string(), Value::Array(attempts));
            assignment_store::replace_notification_delivery_status(
                &record.id,
                &Value::Object(next_status),
            )
            .map_err(storage_error)?;
        }
    }
    Ok(())
}

async fn sync_notifications_from_runtime(state: &Arc<AppState>) -> Result<(), ApiError> {
    ensure_online(state).await?;
    for target_kind in ["pc_notice", "chat_message"] {
        let payload = timeout(
            Duration::from_secs(MANAGED_TASK_DELIVERY_UPSTREAM_TIMEOUT_SECS),
            state.openfang.get_json_with_query(
                "/api/tasks/deliveries/pending",
                &[("target_kind".to_string(), target_kind.to_string())],
            ),
        )
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::GATEWAY_TIMEOUT,
                "同步通知 pending deliveries 超时",
            )
        })??;
        if let Some(rows) = payload.as_array() {
            for row in rows {
                let _ = upsert_local_task_delivery_from_upstream(row);
            }
        }
    }
    sync_capability_job_notifications_from_store()?;
    dispatch_notifications_from_store().await?;
    Ok(())
}

async fn resolve_managed_task_remote_chat_binding(
    state: &Arc<AppState>,
    task_id: &str,
) -> Result<(String, String), ApiError> {
    let detail_path = format!("/api/tasks/{task_id}");
    let detail = state.openfang.get_json(&detail_path).await?;
    let spec = detail
        .get("spec")
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "任务详情不存在"))?;
    let binding = spec.get("binding").unwrap_or(&Value::Null);
    let owner_agent_id = read_trimmed_value(
        binding,
        &[
            "remote_chat_session_owner_agent_id",
            "remoteChatSessionOwnerAgentId",
        ],
    )
    .or_else(|| read_trimmed_value(spec, &["agent_id", "agentId"]))
    .map(ToString::to_string);
    let remote_session_id =
        read_trimmed_value(binding, &["remote_chat_session_id", "remoteChatSessionId"])
            .map(ToString::to_string);

    if let (Some(remote_session_id), Some(owner_agent_id)) = (remote_session_id, owner_agent_id) {
        return Ok((remote_session_id, owner_agent_id));
    }
    Err(ApiError::new(StatusCode::CONFLICT, "任务未绑定远端会话 ID"))
}

async fn fail_unrecoverable_chat_delivery(
    state: &Arc<AppState>,
    delivery_id: &str,
    current_status: &str,
) {
    if current_status.eq_ignore_ascii_case("failed")
        || current_status.eq_ignore_ascii_case("acknowledged")
    {
        return;
    }
    let _ = update_task_delivery_status_upstream(state, delivery_id, "failed").await;
}

async fn append_message_to_remote_chat_session(
    state: &Arc<AppState>,
    owner_agent_id: &str,
    session_id: &str,
    message_text: &str,
) -> Result<usize, ApiError> {
    let session_ctx = ensure_switched_to_session_id(state, owner_agent_id, session_id).await?;
    let path = format!("/api/agents/{owner_agent_id}/session");
    let session_payload = match state.openfang.get_json(&path).await {
        Ok(value) => value,
        Err(err) => {
            if session_ctx.switched {
                let _ = switch_openfang_session(
                    state,
                    owner_agent_id,
                    &session_ctx.original_session_id,
                )
                .await;
            }
            return Err(err);
        }
    };

    let mut messages = parse_editable_messages_from_session_payload(&session_payload);
    let normalized_message = message_text.trim();
    if !messages.iter().any(|item| {
        item.role.eq_ignore_ascii_case("assistant") && item.content.trim() == normalized_message
    }) {
        messages.push(EditableChatSessionMessage {
            role: "assistant".to_string(),
            content: normalized_message.to_string(),
        });
    }

    let update_path = format!("/api/sessions/{session_id}/content");
    let update_result = state
        .openfang
        .put_json(
            &update_path,
            json!({
                "messages": messages.iter().map(|item| json!({
                    "role": item.role,
                    "content": item.content,
                })).collect::<Vec<_>>(),
            }),
        )
        .await;

    if session_ctx.switched {
        let _ =
            switch_openfang_session(state, owner_agent_id, &session_ctx.original_session_id).await;
    }

    match update_result {
        Ok(_) => Ok(messages.len()),
        Err(err) => Err(err),
    }
}

pub async fn writeback_managed_task_delivery_to_chat_route(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<ManagedTaskChatWritebackRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;

    let task_id = payload.task_id.trim();
    if task_id.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "task_id 不能为空"));
    }
    let message_text = payload.message_text.trim();
    if message_text.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "message_text 不能为空",
        ));
    }

    let deliveries_path = format!("/api/tasks/{task_id}/deliveries");
    let deliveries = state.openfang.get_json(&deliveries_path).await?;
    let delivery = deliveries
        .as_array()
        .and_then(|rows| {
            rows.iter().find(|row| {
                row.get("id").and_then(Value::as_str).map(str::trim) == Some(id.as_str())
            })
        })
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "任务 delivery 不存在"))?;

    let target_kind = delivery
        .get("target_kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if target_kind != "chat_message" {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "仅支持 chat_message 类型的 delivery 回写",
        ));
    }

    let current_status = delivery
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("pending");

    let (remote_session_id, remote_session_owner_agent_id) =
        match resolve_managed_task_remote_chat_binding(&state, task_id).await {
            Ok(binding) => binding,
            Err(err) => {
                if err.status == StatusCode::CONFLICT {
                    fail_unrecoverable_chat_delivery(&state, &id, current_status).await;
                }
                return Err(err);
            }
        };

    let message_count = match append_message_to_remote_chat_session(
        &state,
        &remote_session_owner_agent_id,
        &remote_session_id,
        message_text,
    )
    .await
    {
        Ok(count) => count,
        Err(err) => {
            if matches!(err.status, StatusCode::CONFLICT | StatusCode::NOT_FOUND) {
                fail_unrecoverable_chat_delivery(&state, &id, current_status).await;
            }
            return Err(err);
        }
    };

    let synced_delivery = if current_status == "acknowledged" {
        delivery.clone()
    } else {
        let status_path = format!("/api/tasks/deliveries/{id}/status");
        state
            .openfang
            .post_json(&status_path, json!({ "status": "acknowledged" }))
            .await?
    };
    let synced_delivery =
        enrich_delivery_owner_agent(&synced_delivery, &remote_session_owner_agent_id);
    upsert_local_task_delivery_from_upstream(&synced_delivery)?;

    Ok(Json(json!({
        "ok": true,
        "task_id": task_id,
        "delivery_id": id,
        "remote_session_id": remote_session_id,
        "remote_session_owner_agent_id": remote_session_owner_agent_id,
        "message_count": message_count,
        "delivery_status": "acknowledged",
    })))
}

fn value_array(payload: &Value) -> Vec<Value> {
    payload.as_array().cloned().unwrap_or_default()
}

fn read_delivery_field<'a>(delivery: &'a Value, keys: &[&str]) -> Option<&'a str> {
    read_trimmed_value(delivery, keys)
}

fn enrich_delivery_owner_agent(delivery: &Value, owner_agent_id: &str) -> Value {
    let normalized_owner_agent_id = owner_agent_id.trim();
    if normalized_owner_agent_id.is_empty() {
        return delivery.clone();
    }
    let mut enriched = delivery.clone();
    if let Value::Object(map) = &mut enriched {
        map.entry("owner_agent_id".to_string())
            .or_insert_with(|| Value::String(normalized_owner_agent_id.to_string()));
        map.entry("ownerAgentId".to_string())
            .or_insert_with(|| Value::String(normalized_owner_agent_id.to_string()));
    }
    enriched
}

fn parse_rfc3339_utc(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|item| item.with_timezone(&chrono::Utc))
}

fn retry_delay_seconds(failure_count: usize) -> Option<i64> {
    match failure_count {
        1 => Some(5),
        2 => Some(30),
        3 => Some(120),
        4 => Some(600),
        5 => Some(1800),
        _ => None,
    }
}

async fn list_task_delivery_attempts_upstream(
    state: &Arc<AppState>,
    task_id: &str,
) -> Result<Vec<Value>, ApiError> {
    let path = format!("/api/tasks/{task_id}/delivery-attempts");
    let payload = state.openfang.get_json(&path).await?;
    Ok(value_array(&payload))
}

async fn record_task_delivery_attempt_upstream(
    state: &Arc<AppState>,
    delivery: &Value,
    consumer_kind: &str,
    status: &str,
    error: Option<String>,
    metadata_json: Value,
) -> Result<Value, ApiError> {
    let delivery_id = read_delivery_field(delivery, &["id"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.id 缺失"))?;
    let task_id = read_delivery_field(delivery, &["task_id", "taskId"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.task_id 缺失"))?;
    let target_kind = read_delivery_field(delivery, &["target_kind", "targetKind"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.target_kind 缺失"))?;
    let path = format!("/api/tasks/deliveries/{delivery_id}/attempts");
    state
        .openfang
        .post_json(
            &path,
            json!({
                "task_id": task_id,
                "run_id": read_delivery_field(delivery, &["run_id", "runId"]),
                "event_id": read_delivery_field(delivery, &["event_id", "eventId"]),
                "target_kind": target_kind,
                "consumer_kind": consumer_kind,
                "status": status,
                "error": error,
                "metadata_json": metadata_json,
                "started_at": chrono::Utc::now().to_rfc3339(),
                "finished_at": chrono::Utc::now().to_rfc3339(),
            }),
        )
        .await
}

async fn update_task_delivery_status_upstream(
    state: &Arc<AppState>,
    delivery_id: &str,
    status: &str,
) -> Result<Value, ApiError> {
    let path = format!("/api/tasks/deliveries/{delivery_id}/status");
    state
        .openfang
        .post_json(&path, json!({ "status": status }))
        .await
}

async fn should_dispatch_delivery_now(
    state: &Arc<AppState>,
    delivery: &Value,
) -> Result<bool, ApiError> {
    let task_id = read_delivery_field(delivery, &["task_id", "taskId"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.task_id 缺失"))?;
    let delivery_id = read_delivery_field(delivery, &["id"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.id 缺失"))?;
    let attempts = list_task_delivery_attempts_upstream(state, task_id).await?;
    let related = attempts.into_iter().filter(|item| {
        read_delivery_field(item, &["delivery_id", "deliveryId"]) == Some(delivery_id)
    });
    let mut failure_count = 0usize;
    let mut latest_finished_at = None;
    let mut unrecoverable = false;
    for attempt in related {
        let status = read_delivery_field(&attempt, &["status"]).unwrap_or_default();
        if status.eq_ignore_ascii_case("failed") {
            failure_count += 1;
        }
        if let Some(value) = attempt
            .get("metadata_json")
            .or_else(|| attempt.get("metadata"))
            .and_then(Value::as_object)
            .and_then(|row| row.get("unrecoverable"))
            .and_then(Value::as_bool)
        {
            unrecoverable = unrecoverable || value;
        }
        if let Some(finished_at) = read_delivery_field(&attempt, &["finished_at", "finishedAt"])
            .and_then(parse_rfc3339_utc)
        {
            latest_finished_at = Some(match latest_finished_at {
                Some(current) if current > finished_at => current,
                _ => finished_at,
            });
        }
    }
    if unrecoverable || failure_count == 0 {
        return Ok(true);
    }
    let Some(delay_seconds) = retry_delay_seconds(failure_count) else {
        return Ok(true);
    };
    let Some(latest_finished_at) = latest_finished_at else {
        return Ok(true);
    };
    Ok(chrono::Utc::now() >= latest_finished_at + chrono::Duration::seconds(delay_seconds))
}

async fn dispatch_chat_message_delivery(
    state: &Arc<AppState>,
    delivery: &Value,
) -> Result<Value, ApiError> {
    let delivery_id = read_delivery_field(delivery, &["id"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.id 缺失"))?;
    let task_id = read_delivery_field(delivery, &["task_id", "taskId"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.task_id 缺失"))?;
    let message_text = read_delivery_field(delivery, &["body"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.body 缺失"))?;

    let attempts = list_task_delivery_attempts_upstream(state, task_id).await?;
    let previous_failures = attempts
        .iter()
        .filter(|item| {
            read_delivery_field(item, &["delivery_id", "deliveryId"]) == Some(delivery_id)
                && read_delivery_field(item, &["status"]) == Some("failed")
        })
        .count();

    match resolve_managed_task_remote_chat_binding(state, task_id).await {
        Ok((remote_session_id, owner_agent_id)) => {
            let message_count = append_message_to_remote_chat_session(
                state,
                &owner_agent_id,
                &remote_session_id,
                message_text,
            )
            .await?;
            let _ = record_task_delivery_attempt_upstream(
                state,
                delivery,
                "chat_message_dispatcher",
                "succeeded",
                None,
                json!({
                    "message_count": message_count,
                    "remote_session_id": remote_session_id,
                    "remote_chat_session_owner_agent_id": owner_agent_id,
                }),
            )
            .await?;
            let updated =
                update_task_delivery_status_upstream(state, delivery_id, "acknowledged").await?;
            let updated = enrich_delivery_owner_agent(&updated, &owner_agent_id);
            upsert_local_task_delivery_from_upstream(&updated)?;
            Ok(json!({
                "ok": true,
                "delivery": updated,
                "message_count": message_count,
            }))
        }
        Err(err) => {
            let unrecoverable = err.status == StatusCode::CONFLICT;
            let failure_count = previous_failures + 1;
            let retry_after_seconds = if unrecoverable {
                None
            } else {
                retry_delay_seconds(failure_count)
            };
            let error_text = err.message.clone();
            let _ = record_task_delivery_attempt_upstream(
                state,
                delivery,
                "chat_message_dispatcher",
                "failed",
                Some(error_text.clone()),
                json!({
                    "failure_count": failure_count,
                    "retry_after_seconds": retry_after_seconds,
                    "unrecoverable": unrecoverable,
                }),
            )
            .await?;
            if unrecoverable || failure_count >= 5 {
                let updated =
                    update_task_delivery_status_upstream(state, delivery_id, "failed").await?;
                return Ok(json!({
                    "ok": false,
                    "delivery": updated,
                    "failure_count": failure_count,
                    "error": error_text,
                }));
            }
            Err(ApiError::new(StatusCode::BAD_GATEWAY, error_text))
        }
    }
}

async fn dispatch_pc_notice_delivery(
    state: &Arc<AppState>,
    delivery: &Value,
) -> Result<Value, ApiError> {
    let delivery_id = read_delivery_field(delivery, &["id"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.id 缺失"))?;
    let _ = record_task_delivery_attempt_upstream(
        state,
        delivery,
        "pc_notice_bridge",
        "succeeded",
        None,
        json!({
            "reported_via": "compose_notice_feed",
        }),
    )
    .await?;
    Ok(json!({
        "ok": true,
        "delivery": delivery,
        "delivery_id": delivery_id,
    }))
}

async fn dispatch_webhook_delivery(
    state: &Arc<AppState>,
    delivery: &Value,
) -> Result<Value, ApiError> {
    let delivery_id = read_delivery_field(delivery, &["id"])
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "delivery.id 缺失"))?;
    let _ = record_task_delivery_attempt_upstream(
        state,
        delivery,
        "webhook_dispatcher",
        "failed",
        Some("webhook sender not implemented".to_string()),
        json!({
            "reserved": true,
        }),
    )
    .await?;
    let updated = update_task_delivery_status_upstream(state, delivery_id, "failed").await?;
    Ok(json!({
        "ok": false,
        "delivery": updated,
        "error": "webhook sender not implemented",
    }))
}

async fn dispatch_managed_task_delivery(
    state: &Arc<AppState>,
    delivery: &Value,
) -> Result<Value, ApiError> {
    match read_delivery_field(delivery, &["target_kind", "targetKind"]).unwrap_or_default() {
        "chat_message" => dispatch_chat_message_delivery(state, delivery).await,
        "pc_notice" => dispatch_pc_notice_delivery(state, delivery).await,
        "webhook" => dispatch_webhook_delivery(state, delivery).await,
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "不支持的任务 delivery target_kind",
        )),
    }
}

fn should_skip_auto_dispatch_for_frontend_bound_chat_delivery(delivery: &Value) -> bool {
    let target_kind =
        read_delivery_field(delivery, &["target_kind", "targetKind"]).unwrap_or_default();
    if !target_kind.eq_ignore_ascii_case("chat_message") {
        return false;
    }
    read_delivery_field(delivery, &["origin_chat_session_id", "originChatSessionId"])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
}

pub async fn run_task_delivery_dispatch_cycle(state: Arc<AppState>) -> Result<usize, ApiError> {
    let deliveries = state
        .openfang
        .get_json_with_query(
            "/api/tasks/deliveries/pending",
            &[("target_kind".to_string(), "chat_message".to_string())],
        )
        .await?;
    let rows = value_array(&deliveries);
    let mut handled = 0usize;
    for delivery in rows {
        if should_skip_auto_dispatch_for_frontend_bound_chat_delivery(&delivery) {
            continue;
        }
        if !should_dispatch_delivery_now(&state, &delivery).await? {
            continue;
        }
        match dispatch_managed_task_delivery(&state, &delivery).await {
            Ok(_) => handled += 1,
            Err(err) => {
                tracing::warn!(error = %err.message, "task delivery dispatcher send failed");
            }
        }
    }
    Ok(handled)
}

pub async fn send_internal_task_delivery(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<InternalTaskDeliverySendRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    Ok(Json(
        dispatch_managed_task_delivery(&state, &payload.delivery).await?,
    ))
}

#[derive(Clone, Deserialize)]
pub struct ChatMessageAttachmentRequest {
    pub file_id: Option<String>,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub local_vision_summary: Option<String>,
    pub local_vision_provider: Option<String>,
    pub local_vision_model: Option<String>,
}

#[derive(Deserialize)]
pub struct ChatMessageRequest {
    pub message: String,
    #[serde(default)]
    pub raw_user_message: Option<String>,
    pub session_id: Option<String>,
    pub session_label: Option<String>,
    pub request_origin: Option<String>,
    #[serde(default)]
    pub attachments: Vec<ChatMessageAttachmentRequest>,
}

fn normalize_session_label(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(trimmed.len().min(120));
    for ch in trimmed.chars() {
        if out.len() >= 120 {
            break;
        }
        let normalized = if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            ch
        } else {
            '_'
        };
        out.push(normalized);
    }
    out.trim_matches('_').to_string()
}

fn resolve_upstream_request_origin(
    request_origin: Option<&str>,
    session_label: Option<&str>,
) -> Option<&'static str> {
    let normalized_origin = request_origin
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_label = session_label
        .map(normalize_session_label)
        .filter(|value| !value.is_empty());
    match (normalized_origin, normalized_label.as_deref()) {
        (Some("group_auto"), Some(label)) if label.starts_with("groupmem_") => Some("group_auto"),
        _ => None,
    }
}

fn webot_chat_blocked_tools() -> Vec<&'static str> {
    Vec::new()
}

async fn get_openfang_agent_session_id(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<String, ApiError> {
    let path = format!("/api/agents/{agent_id}/session");
    let payload = state.openfang.get_json(&path).await?;
    let session_id = payload
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "读取上游 session_id 失败",
            )
        })?;
    Ok(session_id.to_string())
}

async fn find_openfang_session_by_label(
    state: &Arc<AppState>,
    agent_id: &str,
    label: &str,
) -> Result<Option<String>, ApiError> {
    let safe_label = normalize_session_label(label);
    if safe_label.is_empty() {
        return Ok(None);
    }
    let path = format!("/api/agents/{agent_id}/sessions/by-label/{safe_label}");
    match state.openfang.get_json(&path).await {
        Ok(payload) => Ok(payload
            .get("session_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToString::to_string)),
        Err(err) => {
            if err.status == StatusCode::NOT_FOUND {
                return Ok(None);
            }
            Err(err)
        }
    }
}

async fn create_openfang_session_with_label(
    state: &Arc<AppState>,
    agent_id: &str,
    label: &str,
) -> Result<String, ApiError> {
    let safe_label = normalize_session_label(label);
    if safe_label.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "session_label 无效"));
    }
    let path = format!("/api/agents/{agent_id}/sessions");
    let payload = state
        .openfang
        .post_json(&path, json!({ "label": safe_label }))
        .await?;

    let session_id = payload
        .get("session_id")
        .and_then(Value::as_str)
        .or_else(|| payload.get("id").and_then(Value::as_str))
        .or_else(|| {
            payload
                .get("id")
                .and_then(|v| v.get("0"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "创建上游会话失败：缺少 session_id",
            )
        })?;

    Ok(session_id.to_string())
}

async fn switch_openfang_session(
    state: &Arc<AppState>,
    agent_id: &str,
    session_id: &str,
) -> Result<(), ApiError> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return Ok(());
    }
    let path = format!("/api/agents/{agent_id}/sessions/{sid}/switch");
    let _ = state.openfang.post_json(&path, json!({})).await?;
    Ok(())
}

#[derive(Debug, Clone, Default)]
struct SessionSwitchContext {
    original_session_id: String,
    target_session_id: String,
    switched: bool,
    created_session_id: Option<String>,
}

async fn restore_openfang_session_with_client(
    openfang: &crate::openfang::OpenFangClient,
    agent_id: &str,
    session_id: &str,
) {
    let sid = session_id.trim();
    if sid.is_empty() {
        return;
    }
    let path = format!("/api/agents/{agent_id}/sessions/{sid}/switch");
    if let Err(err) = openfang.post_json(&path, json!({})).await {
        tracing::warn!(
            agent_id = %agent_id,
            session_id = %sid,
            error = %err.message,
            "failed to restore original session"
        );
    }
}

fn is_strictly_empty_session_payload(session: &Value, expected_session_id: &str) -> bool {
    let expected = expected_session_id.trim();
    if expected.is_empty() {
        return false;
    }
    let Some(current_session_id) = session
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    if current_session_id != expected {
        return false;
    }
    matches!(
        session.get("messages").and_then(Value::as_array),
        Some(messages) if messages.is_empty()
    )
}

async fn delete_openfang_session_if_current_empty(
    openfang: &crate::openfang::OpenFangClient,
    agent_id: &str,
    session_id: &str,
) {
    let sid = session_id.trim();
    if sid.is_empty() {
        return;
    }
    let session_path = format!("/api/agents/{agent_id}/session");
    let session_payload = match openfang.get_json(&session_path).await {
        Ok(payload) => payload,
        Err(err) => {
            tracing::warn!(
                agent_id = %agent_id,
                session_id = %sid,
                error = %err.message,
                "failed to inspect current session before cleanup"
            );
            return;
        }
    };
    if !is_strictly_empty_session_payload(&session_payload, sid) {
        return;
    }
    let delete_path = format!("/api/sessions/{sid}");
    match openfang.delete_json(&delete_path).await {
        Ok(_) => {
            tracing::info!(
                agent_id = %agent_id,
                session_id = %sid,
                "deleted newly created empty session"
            );
        }
        Err(err) => {
            tracing::warn!(
                agent_id = %agent_id,
                session_id = %sid,
                error = %err.message,
                "failed to delete newly created empty session"
            );
        }
    }
}

async fn restore_and_cleanup_switched_session(
    openfang: &crate::openfang::OpenFangClient,
    agent_id: &str,
    session_ctx: &SessionSwitchContext,
) {
    if let Some(created_session_id) = session_ctx
        .created_session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let cleanup_session_id =
            if session_ctx.target_session_id.trim() == created_session_id.trim() {
                session_ctx.target_session_id.as_str()
            } else {
                created_session_id
            };
        delete_openfang_session_if_current_empty(openfang, agent_id, cleanup_session_id).await;
    }
    if session_ctx.switched {
        restore_openfang_session_with_client(openfang, agent_id, &session_ctx.original_session_id)
            .await;
    }
}

async fn ensure_switched_to_session_label(
    state: &Arc<AppState>,
    agent_id: &str,
    label: &str,
) -> Result<SessionSwitchContext, ApiError> {
    let safe_label = normalize_session_label(label);
    if safe_label.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "session_label 无效"));
    }
    let original_session_id = get_openfang_agent_session_id(state, agent_id).await?;
    let (target_session_id, created_session_id) =
        match find_openfang_session_by_label(state, agent_id, &safe_label).await? {
            Some(existing) => (existing, None),
            None => {
                let created =
                    create_openfang_session_with_label(state, agent_id, &safe_label).await?;
                (created.clone(), Some(created))
            }
        };
    let switched = original_session_id != target_session_id;
    if switched {
        switch_openfang_session(state, agent_id, &target_session_id).await?;
    }
    Ok(SessionSwitchContext {
        original_session_id,
        target_session_id,
        switched,
        created_session_id,
    })
}

async fn ensure_switched_to_session_id(
    state: &Arc<AppState>,
    agent_id: &str,
    session_id: &str,
) -> Result<SessionSwitchContext, ApiError> {
    let target_session_id = session_id.trim();
    if target_session_id.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "session_id 无效"));
    }
    let original_session_id = get_openfang_agent_session_id(state, agent_id).await?;
    let switched = original_session_id != target_session_id;
    if switched {
        switch_openfang_session(state, agent_id, target_session_id).await?;
    }
    Ok(SessionSwitchContext {
        original_session_id,
        target_session_id: target_session_id.to_string(),
        switched,
        created_session_id: None,
    })
}

async fn ensure_switched_to_session_target(
    state: &Arc<AppState>,
    agent_id: &str,
    session_id: Option<&str>,
    session_label: Option<&str>,
) -> Result<SessionSwitchContext, ApiError> {
    if let Some(sid) = session_id.map(str::trim).filter(|v| !v.is_empty()) {
        return ensure_switched_to_session_id(state, agent_id, sid).await;
    }
    if let Some(label) = session_label.map(str::trim).filter(|v| !v.is_empty()) {
        return ensure_switched_to_session_label(state, agent_id, label).await;
    }
    Ok(SessionSwitchContext::default())
}

fn resolve_agent_system_prompt(
    agent_id: &str,
    include_bootstrap: bool,
) -> Result<Option<String>, ApiError> {
    // 读取 profile 中保存的 system_prompt（系统提示词 Tab 内容）
    let profile = assignment_store::get_agent_profile_override(agent_id).map_err(storage_error)?;
    let workspace_segment = profile
        .as_ref()
        .and_then(|item| item.english_name.as_deref())
        .and_then(normalize_workspace_segment)
        .unwrap_or_else(|| agent_id.trim().to_string());
    let base_system_prompt = profile
        .and_then(|item| item.system_prompt)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    // 读取身份文件内容（IDENTITY.md, SOUL.md, USER.md 等）
    let context_files =
        assignment_store::list_agent_context_files(agent_id).map_err(storage_error)?;

    // 按顺序拼装身份文件块（只拼接有内容的文件）
    let identity_file_order: &[(&str, &str)] = &[
        ("IDENTITY.md", "角色身份设定"),
        ("SOUL.md", "核心行为准则"),
        ("USER.md", "用户关系定义"),
        ("MEMORY.md", "长期记忆偏好"),
        ("TOOLS.md", "工具调用协议"),
        ("AGENTS.md", "多智能体协作背景"),
        ("BOOTSTRAP.md", "引导对话范式"),
        ("HEARTBEAT.md", "自主意识循环"),
    ];

    let mut identity_blocks: Vec<String> = Vec::new();
    let mut resolved_user_address: Option<String> = None;
    for (file_name, section_title) in identity_file_order {
        if *file_name == "BOOTSTRAP.md" && !include_bootstrap {
            continue;
        }
        if let Some(record) = context_files.get(*file_name) {
            let content = record.content.trim();
            if !content.is_empty() {
                // 使用结构化的强引导格式
                identity_blocks.push(format!(
                    "<IDENTITY_FILE name=\"{}\" title=\"{}\">\n{}\n</IDENTITY_FILE>",
                    file_name, section_title, content
                ));
                if *file_name == "USER.md" {
                    resolved_user_address = extract_user_address_from_user_md(content);
                }
            }
        }
    }
    identity_blocks.extend(load_extra_workspace_markdown_blocks(agent_id, &workspace_segment));

    // 合并：构造一个封闭的系统配置区域
    let mut final_parts = Vec::new();

    if !identity_blocks.is_empty() {
        final_parts.push(format!(
            "[AGENT_IDENTITY_PROFILE]\n{}\n[/AGENT_IDENTITY_PROFILE]",
            identity_blocks.join("\n\n")
        ));
    }

    if let Some(prompt) = base_system_prompt {
        final_parts.push(format!(
            "[SYSTEM_BEHAVIOR_INSTRUCTION]\n{}\n[/SYSTEM_BEHAVIOR_INSTRUCTION]",
            prompt
        ));
    }
    if let Some(user_address) = resolved_user_address {
        final_parts.push(format!(
            "[SYSTEM_USER_ADDRESS_GUARD]\n当前 user_address 已确认为「{}」。后续称呼必须保持一致。\n[/SYSTEM_USER_ADDRESS_GUARD]",
            user_address
        ));
    } else {
        final_parts.push(
            "[SYSTEM_USER_ADDRESS_GUARD]\n当前 user_address 为空。你必须使用中性表达，不得生成任何身份称谓式称呼；先询问用户希望的称呼，再写入 USER.md。\n[/SYSTEM_USER_ADDRESS_GUARD]"
                .to_string(),
        );
    }

    if final_parts.is_empty() {
        return Ok(None);
    }

    let merged = final_parts.join("\n\n");
    let trimmed = merged.trim().to_string();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed))
    }
}

fn load_extra_workspace_markdown_blocks(agent_id: &str, workspace_segment: &str) -> Vec<String> {
    let trimmed_agent_id = agent_id.trim();
    let trimmed_workspace_segment = workspace_segment.trim();
    if trimmed_agent_id.is_empty() || trimmed_workspace_segment.is_empty() {
        return Vec::new();
    }

    let workspace_root = match path_resolver::workspaces_root() {
        Ok(path) => path,
        Err(err) => {
            tracing::warn!(agent_id = %trimmed_agent_id, error = %err, "resolve workspace root failed");
            return Vec::new();
        }
    };
    let private_workspace = workspace_root.join(trimmed_workspace_segment);
    let entries = match fs::read_dir(&private_workspace) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(err) => {
            tracing::warn!(
                agent_id = %trimmed_agent_id,
                workspace = %private_workspace.display(),
                error = %err,
                "read private workspace failed"
            );
            return Vec::new();
        }
    };

    let known_names: HashSet<String> = KNOWN_CONTEXT_FILES
        .iter()
        .map(|item| item.to_ascii_lowercase())
        .collect();
    let mut extra_files: Vec<(String, PathBuf)> = Vec::new();
    for entry_result in entries {
        let entry = match entry_result {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(
                    agent_id = %trimmed_agent_id,
                    workspace = %private_workspace.display(),
                    error = %err,
                    "iterate private workspace entry failed"
                );
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(OsStr::to_str) else {
            continue;
        };
        let lowered = file_name.to_ascii_lowercase();
        if !lowered.ends_with(".md") || known_names.contains(&lowered) {
            continue;
        }
        extra_files.push((file_name.to_string(), path));
    }

    extra_files.sort_by(|left, right| {
        left.0
            .to_ascii_lowercase()
            .cmp(&right.0.to_ascii_lowercase())
            .then_with(|| left.0.cmp(&right.0))
    });

    let mut blocks = Vec::new();
    for (file_name, path) in extra_files {
        match fs::read_to_string(&path) {
            Ok(content) => {
                let trimmed = content.trim();
                if trimmed.is_empty() {
                    continue;
                }
                blocks.push(format!(
                    "<WORKSPACE_MARKDOWN_FILE name=\"{}\" title=\"工作区附加 Markdown\">\n{}\n</WORKSPACE_MARKDOWN_FILE>",
                    file_name, trimmed
                ));
            }
            Err(err) => {
                tracing::warn!(
                    agent_id = %trimmed_agent_id,
                    file = %path.display(),
                    error = %err,
                    "read extra workspace markdown failed"
                );
            }
        }
    }

    blocks
}

fn extract_user_address_from_user_md(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((key, value)) = split_key_value_line(trimmed) {
            let k = key.trim().to_ascii_lowercase();
            if (k == "user_address" || k == "用户称呼" || k == "称呼") && !value.trim().is_empty()
            {
                return Some(value.trim().to_string());
            }
        }
    }
    None
}

fn clean_markdown_text(raw: &str) -> String {
    raw.trim()
        .trim_matches('#')
        .trim_matches('-')
        .trim_matches('*')
        .trim()
        .replace("**", "")
        .replace('`', "")
}

fn split_key_value_line(line: &str) -> Option<(String, String)> {
    let trimmed = clean_markdown_text(line);
    if trimmed.is_empty() {
        return None;
    }
    if let Some((k, v)) = trimmed.split_once(':') {
        return Some((k.trim().to_ascii_lowercase(), v.trim().to_string()));
    }
    if let Some((k, v)) = trimmed.split_once('：') {
        return Some((k.trim().to_ascii_lowercase(), v.trim().to_string()));
    }
    None
}

fn normalize_candidate_name(raw: &str) -> String {
    clean_markdown_text(raw)
        .trim_matches('「')
        .trim_matches('」')
        .trim_matches('(')
        .trim_matches(')')
        .trim()
        .to_string()
}

fn looks_like_placeholder_name(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }
    normalized.contains("未命名")
        || normalized == "智能体"
        || normalized == "助手"
        || normalized == "assistant"
        || normalized == "agent"
}

fn extract_identity_name(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((key, value)) = split_key_value_line(trimmed) {
            if key == "name" || key == "中文名" {
                let candidate = normalize_candidate_name(&value);
                if !candidate.is_empty() && !looks_like_placeholder_name(&candidate) {
                    return Some(candidate);
                }
            }
        }
        if let Some((_, suffix)) = trimmed.split_once("身份设定：") {
            let candidate = normalize_candidate_name(suffix);
            if !candidate.is_empty() && !looks_like_placeholder_name(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn has_user_address_info(content: &str) -> bool {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((key, value)) = split_key_value_line(trimmed) {
            let has_key = key.contains("user_address")
                || key.contains("useraddress")
                || key.contains("用户称呼")
                || key.contains("称呼");
            if has_key && !value.trim().is_empty() {
                return true;
            }
        }
    }
    false
}

fn is_default_stub_context(file_name: &str, content: &str) -> bool {
    let normalized_name = file_name.trim().to_ascii_uppercase();
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    match normalized_name.as_str() {
        "IDENTITY.MD" => {
            lower.contains("# identity")
                && lower.contains("visual identity and personality at a glance")
        }
        "USER.MD" => {
            lower.starts_with("# user")
                && lower.contains("- name:")
                && lower.contains("- timezone:")
                && lower.contains("- preferences:")
        }
        "SOUL.MD" => lower.starts_with("# soul") && lower.contains("be genuinely helpful"),
        "MEMORY.MD" => lower.starts_with("# long-term memory"),
        "TOOLS.MD" => lower.starts_with("# tools & environment"),
        "AGENTS.MD" => lower.starts_with("# agent behavioral guidelines"),
        "BOOTSTRAP.MD" => lower.starts_with("# first-run bootstrap"),
        "HEARTBEAT.MD" => trimmed.is_empty(),
        _ => false,
    }
}

fn has_meaningful_history(session: &Value) -> bool {
    let Some(rows) = session.get("messages").and_then(Value::as_array) else {
        return false;
    };
    for row in rows {
        let role = row
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if role != "user" && role != "assistant" && role != "agent" {
            continue;
        }
        if let Some(content) = row.get("content") {
            if let Some(text) = extract_text_from_json(content) {
                if !looks_like_protocol_only_text(&text) {
                    return true;
                }
            }
        }
        if let Some(message) = row.get("message") {
            if let Some(text) = extract_text_from_json(message) {
                if !looks_like_protocol_only_text(&text) {
                    return true;
                }
            }
        }
    }
    false
}

fn has_meaningful_user_history(session: &Value) -> bool {
    let Some(rows) = session.get("messages").and_then(Value::as_array) else {
        return false;
    };
    for row in rows {
        let role = row
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if role != "user" {
            continue;
        }
        if let Some(content) = row.get("content") {
            if let Some(text) = extract_text_from_json(content) {
                if !looks_like_protocol_only_text(&text) {
                    return true;
                }
            }
        }
        if let Some(message) = row.get("message") {
            if let Some(text) = extract_text_from_json(message) {
                if !looks_like_protocol_only_text(&text) {
                    return true;
                }
            }
        }
    }
    false
}

fn build_agent_bootstrap_name(agent_id: &str, identity_content: &str) -> String {
    if let Some(name) = extract_identity_name(identity_content) {
        return name;
    }
    let normalized = agent_id
        .trim()
        .replace('-', " ")
        .replace('_', " ")
        .trim()
        .to_string();
    if normalized.is_empty() {
        "你的专属智能体".to_string()
    } else {
        normalized
    }
}

fn build_first_run_identity_bundle(agent_name: &str) -> Vec<(&'static str, String)> {
    let safe_name = if agent_name.trim().is_empty() {
        "你的专属智能体"
    } else {
        agent_name.trim()
    };

    let soul = "# SOUL.md
## 核心人格
- 务实：输出以可落地为第一优先级。
- 诚实：信息不足时直接说明，并给出补齐路径。
- 进化：每次会话后提炼可复用经验并推动自我优化。

## 边界与一致性
- 禁止编造事实、进度、结果。
- 高风险操作先确认，再执行。"
        .to_string();
    let user = format!(
        "# USER.md
## 用户画像
- user_address:
- relation: 长期协作伙伴
- tone_preference: 简洁直接、先结论后解释

## 交互约定
- user_address 仅来源于用户明确指定，不做默认推断。
- 当用户明确要求新的称呼时，立即更新并沿用。
- 对同类任务优先复用用户历史偏好。"
    );
    let memory = "# MEMORY.md
## 长期记忆策略
- 记录：用户目标、偏好、禁忌、常用流程、验收标准。
- 清理：过期或冲突记忆定期标记并剔除。
- 应用：回答前优先匹配历史偏好，减少重复确认。"
        .to_string();
    let tools = "# TOOLS.md
## 工具使用协议
- 能用工具验证的事实，优先工具验证。
- 多步骤操作优先批量执行，减少往返。
- 失败时保留错误上下文并给出可执行回退方案。"
        .to_string();
    let agents = "# AGENTS.md
## 多智能体协作
- 复杂任务按职责拆解，明确输入/输出边界。
- 汇总阶段统一结构与术语，避免信息冲突。
- 对外只输出最终整合结论与关键证据。"
        .to_string();
    let bootstrap = format!(
        "# BOOTSTRAP.md
## 首次引导（仅在第一次对话执行）
本文件只用于首次会话引导。首次会话完成后，不再加载本文件。
当前智能体名称参考：{safe_name}

## 引导流程
### 1. 开场定位
- 开场白：\"系统上线，记忆为空。咱们定一下规矩：我是谁？\"
- 读取并遵循现有 `IDENTITY.md`，以既定身份进入协作。
- 禁止覆写 `IDENTITY.md` 的已存在身份内容（除非用户明确要求改名或改定位）。

### 2. 需求建档
- 先询问并记录 user_address：仅接收用户明确指定，不做默认推断。
- 再根据 `IDENTITY.md` 的角色定位，主动询问用户关键规则：
  1) 输出风格（简洁/详细、结构化格式）
  2) 交付标准（是否要步骤、表格、代码、风险提示）
  3) 禁忌与边界（不希望出现的内容或行为）
- 将确认结果写入 `USER.md` / `SOUL.md` / `MEMORY.md`。

### 3. 连接渠道
- 向用户确认后续协作方式：任务输入格式、交付格式、反馈节奏。
- 产出一条可立即执行的首个任务建议，并进入常规协作。"
    );
    let heartbeat = "# HEARTBEAT.md
## 周期自检清单
- 检查是否沿用了最新用户称呼、语气偏好、交付格式偏好。
- 检查当前规则是否仍匹配用户近期需求。
- 检查工具使用策略是否可再提速或降错。

## 自我优化闭环
1. 观察：从最近会话提炼高频偏好与反馈。
2. 决策：判断应更新哪个文件（IDENTITY/SOUL/USER/MEMORY/TOOLS/AGENTS/BOOTSTRAP）。
3. 执行：写入更新并在下次会话生效。
4. 复盘：验证更新是否提升用户满意度与任务成功率。"
        .to_string();

    vec![
        ("SOUL.md", soul),
        ("USER.md", user),
        ("MEMORY.md", memory),
        ("TOOLS.md", tools),
        ("AGENTS.md", agents),
        ("BOOTSTRAP.md", bootstrap),
        ("HEARTBEAT.md", heartbeat),
    ]
}

async fn maybe_auto_initialize_agent_identity_once(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<bool, ApiError> {
    validate_agent_path_segment(agent_id)?;
    let session_path = format!("/api/agents/{agent_id}/session");
    let session_payload = match state.openfang.get_json(&session_path).await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                agent_id = %agent_id,
                error = %err.message,
                "auto-init: skip because session cannot be fetched"
            );
            return Ok(false);
        }
    };
    let has_history = has_meaningful_history(&session_payload);
    if has_history {
        return Ok(false);
    }

    let context_files =
        assignment_store::list_agent_context_files(agent_id).map_err(storage_error)?;
    let identity_content = context_files
        .get("IDENTITY.md")
        .map(|v| v.content.as_str())
        .unwrap_or("");
    let user_content = context_files
        .get("USER.md")
        .map(|v| v.content.as_str())
        .unwrap_or("");
    let bootstrap_content = context_files
        .get("BOOTSTRAP.md")
        .map(|v| v.content.as_str())
        .unwrap_or("");

    let has_user_address = has_user_address_info(user_content);
    let user_is_stub = is_default_stub_context("USER.md", user_content);
    let bootstrap_is_stub = is_default_stub_context("BOOTSTRAP.md", bootstrap_content);
    let should_initialize = !has_user_address || user_is_stub || bootstrap_is_stub;
    if !should_initialize {
        return Ok(false);
    }

    let agent_name = build_agent_bootstrap_name(agent_id, identity_content);
    let bundle = build_first_run_identity_bundle(&agent_name);
    let mut wrote_any = false;
    for (file_name, content) in bundle {
        let existing_content = context_files
            .get(file_name)
            .map(|v| v.content.as_str())
            .unwrap_or("");
        let replace_allowed = existing_content.trim().is_empty()
            || is_default_stub_context(file_name, existing_content);
        if !replace_allowed {
            continue;
        }
        assignment_store::upsert_agent_context_file(agent_id, file_name, &content)
            .map_err(storage_error)?;
        write_context_file_to_openfang(state, agent_id, file_name, &content).await?;
        wrote_any = true;
    }
    if wrote_any {
        tracing::info!(
            agent_id = %agent_id,
            "auto-init: identity bundle initialized"
        );
    }
    Ok(wrote_any)
}

async fn should_include_bootstrap_for_turn(state: &Arc<AppState>, agent_id: &str) -> bool {
    if validate_agent_path_segment(agent_id).is_err() {
        return false;
    }
    let session_path = format!("/api/agents/{agent_id}/session");
    match state.openfang.get_json(&session_path).await {
        Ok(payload) => !has_meaningful_history(&payload),
        Err(err) => {
            tracing::warn!(
                agent_id = %agent_id,
                error = %err.message,
                "bootstrap: failed to fetch session state, skip bootstrap injection"
            );
            false
        }
    }
}


#[derive(Debug, Clone)]
struct DailyOpeningContext {
    temporal_context: String,
    opening_context: Option<String>,
    is_first_chat_today_with_agent: bool,
}

fn parse_json_timestamp_utc(value: &Value) -> Option<chrono::DateTime<chrono::Utc>> {
    match value {
        Value::String(text) => parse_rfc3339_utc(text.trim()),
        Value::Number(number) => {
            let raw = number.as_i64()?;
            let (seconds, nanos) = if raw.abs() >= 1_000_000_000_000 {
                let seconds = raw.div_euclid(1000);
                let millis = raw.rem_euclid(1000) as u32;
                (seconds, millis * 1_000_000)
            } else {
                (raw, 0)
            };
            chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, nanos)
        }
        _ => None,
    }
}

fn extract_timestamp_from_value(value: &Value, keys: &[&str]) -> Option<chrono::DateTime<chrono::Utc>> {
    for key in keys {
        if let Some(timestamp) = value.get(*key).and_then(parse_json_timestamp_utc) {
            return Some(timestamp);
        }
    }
    None
}

fn max_timestamp(
    current: Option<chrono::DateTime<chrono::Utc>>,
    next: Option<chrono::DateTime<chrono::Utc>>,
) -> Option<chrono::DateTime<chrono::Utc>> {
    match (current, next) {
        (Some(left), Some(right)) => Some(if right > left { right } else { left }),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn current_local_date_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn agent_daily_chat_cache() -> &'static Mutex<HashMap<String, String>> {
    AGENT_DAILY_CHAT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn was_agent_seen_today_in_runtime(agent_id: &str, today_key: &str) -> bool {
    let cache = agent_daily_chat_cache().lock().await;
    cache
        .get(agent_id)
        .map(|value| value == today_key)
        .unwrap_or(false)
}

async fn remember_agent_seen_today(agent_id: &str, today_key: &str) {
    let mut cache = agent_daily_chat_cache().lock().await;
    cache.insert(agent_id.to_string(), today_key.to_string());
}

fn utc_to_local_date_key(value: chrono::DateTime<chrono::Utc>) -> String {
    value
        .with_timezone(&chrono::Local)
        .format("%Y-%m-%d")
        .to_string()
}

fn local_weekday_label(now: &chrono::DateTime<chrono::Local>) -> &'static str {
    match now.format("%u").to_string().as_str() {
        "1" => "星期一",
        "2" => "星期二",
        "3" => "星期三",
        "4" => "星期四",
        "5" => "星期五",
        "6" => "星期六",
        _ => "星期日",
    }
}

fn build_temporal_context(is_first_chat_today_with_agent: bool) -> String {
    let now = chrono::Local::now();
    let timezone = format!("UTC{}", now.format("%:z"));
    let date_key = now.format("%Y-%m-%d").to_string();
    [
        "[system:temporal-context]".to_string(),
        "时间定位必须先于身份定位。".to_string(),
        format!("当前本地日期时间：{}", now.format("%Y年%m月%d日 %H:%M:%S")),
        format!("当前本地时区：{timezone}"),
        format!("当前星期：{}", local_weekday_label(&now)),
        format!("当天日期键：{date_key}"),
        format!(
            "is_first_chat_today_with_agent={}",
            if is_first_chat_today_with_agent { "true" } else { "false" }
        ),
    ]
    .join("\n")
}


fn sanitize_opening_recall_text(text: &str) -> String {
    let sanitized = sanitize_prompt_wrapped_user_text(text);
    let trimmed = sanitized.trim();
    if trimmed.is_empty() || is_legacy_task_draft_artifact(trimmed) || looks_like_protocol_only_text(trimmed) {
        return String::new();
    }

    let filtered = trimmed
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            !(lower.starts_with("[system:")
                || lower.starts_with("[stage:")
                || lower.starts_with("[/")
                || lower.starts_with("[[context_slot:")
                || lower.starts_with("[prompt-context v=")
                || lower.starts_with("query:")
                || lower.starts_with("tool:")
                || lower.starts_with("args:")
                || lower.starts_with("name:")
                || lower.starts_with("id:")
                || lower.starts_with("type:")
                || lower.starts_with("debugprompt")
                || lower.starts_with("phase:")
                || lower.starts_with("event:")
                || lower.starts_with("<tool_call"))
        })
        .collect::<Vec<_>>()
        .join(" ");

    filtered.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn build_opening_summary_line(text: &str) -> Option<String> {
    let cleaned = sanitize_opening_recall_text(text);
    if cleaned.is_empty() {
        return None;
    }

    let mut summary = String::new();
    let mut char_count = 0usize;
    let mut saw_sentence_end = false;
    for ch in cleaned.chars() {
        summary.push(ch);
        char_count += 1;
        if matches!(ch, '。' | '！' | '？' | '!' | '?' | '；' | ';') {
            saw_sentence_end = true;
            if char_count >= 18 {
                break;
            }
        }
        if char_count >= 48 {
            break;
        }
    }

    let mut summary = summary
        .trim()
        .trim_matches(|ch: char| matches!(ch, '-' | '*' | '•' | '`' | '"' | '\'' | '“' | '”'))
        .to_string();
    if summary.is_empty() || summary.chars().count() < 6 {
        return None;
    }
    if summary.chars().count() < cleaned.chars().count() && !saw_sentence_end {
        summary.push('…');
    }
    Some(summary)
}

fn extract_effective_history_text(row: &Value) -> Option<String> {
    let role = row
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if role != "user" && role != "assistant" && role != "agent" {
        return None;
    }

    row.get("content")
        .and_then(extract_text_from_json)
        .or_else(|| row.get("message").and_then(extract_text_from_json))
        .and_then(|text| {
            let cleaned = sanitize_opening_recall_text(&text);
            if cleaned.is_empty() {
                None
            } else {
                Some(cleaned)
            }
        })
}

fn latest_effective_timestamp_from_session(session: &Value) -> Option<chrono::DateTime<chrono::Utc>> {
    const TIMESTAMP_KEYS: &[&str] = &[
        "updated_at",
        "updatedAt",
        "created_at",
        "createdAt",
        "timestamp",
        "ts",
        "time",
        "message_time",
        "messageTime",
        "occurred_at",
        "occurredAt",
        "last_message_at",
        "lastMessageAt",
    ];

    let mut latest = None;
    let mut has_effective_history = false;
    if let Some(rows) = session.get("messages").and_then(Value::as_array) {
        for row in rows {
            if extract_effective_history_text(row).is_none() {
                continue;
            }
            has_effective_history = true;
            latest = max_timestamp(latest, extract_timestamp_from_value(row, TIMESTAMP_KEYS));
        }
    }

    if latest.is_some() {
        latest
    } else if has_effective_history {
        extract_timestamp_from_value(session, TIMESTAMP_KEYS)
    } else {
        None
    }
}


fn session_list_item_has_effective_history(item: &Value) -> bool {
    if item
        .get("message_count")
        .and_then(Value::as_u64)
        .filter(|count| *count > 0)
        .is_some()
    {
        return true;
    }
    if item
        .get("messageCount")
        .and_then(Value::as_u64)
        .filter(|count| *count > 0)
        .is_some()
    {
        return true;
    }

    ["preview", "last_message", "lastMessage", "summary"]
        .iter()
        .filter_map(|key| item.get(*key).and_then(extract_text_from_json))
        .any(|text| !sanitize_opening_recall_text(&text).is_empty())
}

fn latest_effective_timestamp_from_session_list(payload: &Value) -> Option<chrono::DateTime<chrono::Utc>> {
    const SESSION_KEYS: &[&str] = &[
        "last_message_at",
        "lastMessageAt",
        "updated_at",
        "updatedAt",
        "created_at",
        "createdAt",
        "timestamp",
        "ts",
        "time",
    ];

    let rows = payload
        .get("sessions")
        .and_then(Value::as_array)
        .or_else(|| payload.get("items").and_then(Value::as_array))
        .or_else(|| payload.as_array());
    let Some(rows) = rows else {
        return None;
    };

    let mut latest = None;
    for row in rows {
        if !session_list_item_has_effective_history(row) {
            continue;
        }
        latest = max_timestamp(latest, extract_timestamp_from_value(row, SESSION_KEYS));
    }
    latest
}

fn latest_effective_timestamp_from_memory_rows(rows: &[Value]) -> Option<chrono::DateTime<chrono::Utc>> {
    const MEMORY_KEYS: &[&str] = &[
        "updated_at",
        "updatedAt",
        "created_at",
        "createdAt",
        "timestamp",
        "ts",
        "time",
        "memory_time",
        "memoryTime",
        "occurred_at",
        "occurredAt",
        "last_seen_at",
        "lastSeenAt",
    ];

    let mut latest = None;
    for row in rows {
        let Some(content) = row.get("content").and_then(Value::as_str) else {
            continue;
        };
        if sanitize_opening_recall_text(content).is_empty() {
            continue;
        }
        latest = max_timestamp(latest, extract_timestamp_from_value(row, MEMORY_KEYS));
    }
    latest
}

fn collect_opening_summary_from_session(session: &Value, limit: usize) -> Vec<String> {
    let Some(rows) = session.get("messages").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut summaries = Vec::new();
    for row in rows.iter().rev() {
        let Some(text) = extract_effective_history_text(row) else {
            continue;
        };
        let Some(summary) = build_opening_summary_line(&text) else {
            continue;
        };
        summaries.push(summary);
        if summaries.len() >= limit {
            break;
        }
    }
    summaries.reverse();
    summaries
}

fn collect_opening_summary_from_memory(rows: &[Value], limit: usize) -> Vec<String> {
    let mut summaries = Vec::new();
    for row in rows {
        let Some(content) = row.get("content").and_then(Value::as_str) else {
            continue;
        };
        let Some(summary) = build_opening_summary_line(content) else {
            continue;
        };
        summaries.push(summary);
        if summaries.len() >= limit {
            break;
        }
    }
    summaries
}

fn normalize_opening_summary_key(summary: &str) -> String {
    summary
        .chars()
        .filter(|ch| !ch.is_whitespace() && !matches!(ch, '。' | '，' | '！' | '？' | '；' | ',' | '.' | '!' | '?' | ';' | ':' | '：' | '-' | '_' | '"' | '\''))
        .collect::<String>()
        .to_ascii_lowercase()
}

fn merge_opening_summaries(session_summaries: Vec<String>, memory_summaries: Vec<String>) -> Vec<String> {
    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for summary in session_summaries.into_iter().chain(memory_summaries.into_iter()) {
        let key = normalize_opening_summary_key(&summary);
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        merged.push(summary);
        if merged.len() >= 3 {
            break;
        }
    }
    merged
}

fn build_opening_context(summaries: &[String]) -> String {
    let mut lines = vec![
        "[system:opening-context]".to_string(),
        "检测到：这是当前智能体今天第一次有效会话。".to_string(),
        "开篇策略：先轻量问安，再自然带出当前时间语境，再按需要衔接近期连续性信息。".to_string(),
        "如果用户首句只是寒暄、继续、在吗、早安、晚安或空泛开启语：先问安，用 1 到 2 句总结最近相关进展，最后询问今天想先做什么。".to_string(),
        "如果用户首句已经是明确任务或问题：最多一句轻量问安或连续性提示，随后直接回答或执行，不要额外反问接下来要做什么。".to_string(),
        "如果当前没有可安全复用的近期记忆：保留时间定位和轻问安，直接进入需求确认或任务处理，不要编造历史回顾。".to_string(),
        "禁止把协议文本、旧 prompt、系统包装文本、工具日志、阶段标记或检索细节当成历史回顾内容。".to_string(),
    ];

    if summaries.is_empty() {
        lines.push("近期可复用记忆摘要：当前没有可安全复用的近期记忆摘要。".to_string());
    } else {
        lines.push("近期可复用记忆摘要（最多参考 1 到 3 条）：".to_string());
        lines.extend(summaries.iter().map(|summary| format!("- {summary}")));
    }

    lines.join("\n")
}

async fn fetch_recent_opening_memory_rows(state: &Arc<AppState>, agent_id: &str) -> Option<Vec<Value>> {
    match fetch_semantic_memory_rows(state, agent_id, "", 6, 0.0).await {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(
                agent_id = %agent_id,
                error = %error.message,
                "opening-context: recent memory lookup skipped due to error"
            );
            None
        }
    }
}

async fn build_daily_opening_context(
    state: &Arc<AppState>,
    agent_id: &str,
    include_bootstrap: bool,
) -> DailyOpeningContext {
    let current_session = match state
        .openfang
        .get_json(&format!("/api/agents/{agent_id}/session"))
        .await
    {
        Ok(payload) => Some(payload),
        Err(error) => {
            tracing::warn!(
                agent_id = %agent_id,
                error = %error.message,
                "opening-context: failed to fetch current session"
            );
            None
        }
    };
    let session_list = match state
        .openfang
        .get_json(&format!("/api/agents/{agent_id}/sessions"))
        .await
    {
        Ok(payload) => Some(payload),
        Err(error) => {
            tracing::warn!(
                agent_id = %agent_id,
                error = %error.message,
                "opening-context: failed to fetch session list"
            );
            None
        }
    };
    let recent_memory_rows = fetch_recent_opening_memory_rows(state, agent_id).await;

    let latest_session_time = max_timestamp(
        current_session
            .as_ref()
            .and_then(latest_effective_timestamp_from_session),
        session_list
            .as_ref()
            .and_then(latest_effective_timestamp_from_session_list),
    );
    let latest_memory_time = recent_memory_rows
        .as_ref()
        .and_then(|rows| latest_effective_timestamp_from_memory_rows(rows));
    let today_key = current_local_date_key();
    let runtime_seen_today = was_agent_seen_today_in_runtime(agent_id, &today_key).await;
    let is_first_chat_today_with_agent = if runtime_seen_today {
        false
    } else {
        latest_session_time
            .map(utc_to_local_date_key)
            .or_else(|| latest_memory_time.map(utc_to_local_date_key))
            .map(|date_key| date_key != today_key)
            .unwrap_or(false)
    };

    let temporal_context = build_temporal_context(is_first_chat_today_with_agent);
    let opening_context = if include_bootstrap || !is_first_chat_today_with_agent {
        None
    } else {
        let session_summaries = current_session
            .as_ref()
            .map(|session| collect_opening_summary_from_session(session, 2))
            .unwrap_or_default();
        let memory_summaries = recent_memory_rows
            .as_ref()
            .map(|rows| collect_opening_summary_from_memory(rows, 3))
            .unwrap_or_default();
        Some(build_opening_context(&merge_opening_summaries(
            session_summaries,
            memory_summaries,
        )))
    };

    DailyOpeningContext {
        temporal_context,
        opening_context,
        is_first_chat_today_with_agent,
    }
}

#[derive(Default, Debug, Clone)]
struct UserProfilePatch {
    user_address: Option<String>,
    investment_preferences: Vec<String>,
}

fn trim_cn_modal_suffix(raw: &str) -> String {
    let mut value = raw.trim().to_string();
    let suffixes = [
        "吧", "呀", "啊", "哦", "呢", "哈", "啦", "嘛", "呗", "哇", "喔",
    ];
    loop {
        let mut changed = false;
        for suffix in suffixes {
            if value.ends_with(suffix) {
                value = value.trim_end_matches(suffix).trim().to_string();
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    value
}

fn take_short_token(raw: &str) -> String {
    let trimmed = raw
        .trim_start_matches([' ', '\t', '\n', '\r', '，', ',', '。', '.', '：', ':'])
        .trim();
    let mut out = String::new();
    for ch in trimmed.chars() {
        let is_delimiter = matches!(
            ch,
            ' ' | '\t'
                | '\n'
                | '\r'
                | '，'
                | ','
                | '。'
                | '.'
                | '！'
                | '!'
                | '？'
                | '?'
                | '；'
                | ';'
                | '：'
                | ':'
                | '、'
                | '/'
        );
        if is_delimiter {
            break;
        }
        out.push(ch);
        if out.chars().count() >= 12 {
            break;
        }
    }
    trim_cn_modal_suffix(&out)
}

fn is_invalid_user_address(value: &str, agent_id: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return true;
    }
    if !agent_id.trim().is_empty() && trimmed.eq_ignore_ascii_case(agent_id.trim()) {
        return true;
    }
    let blacklist = [
        "我", "你", "我们", "大家", "一下", "这个", "那个", "短线", "长线", "a股", "A股", "股票",
    ];
    blacklist
        .iter()
        .any(|item| item.eq_ignore_ascii_case(trimmed))
}

fn extract_user_message_segment(message: &str) -> String {
    let normalized = message.replace("\r\n", "\n");
    let segment = if let Some(task_input) = extract_task_input_from_prompt_context(&normalized) {
        task_input
    } else if let Some(index) = normalized.rfind("\n[user]\n") {
        normalized[index + "\n[user]\n".len()..].trim().to_string()
    } else if let Some(index) = normalized.rfind("[user]\n") {
        normalized[index + "[user]\n".len()..].trim().to_string()
    } else {
        message.trim().to_string()
    };
    let sanitized = sanitize_prompt_wrapped_user_text(&segment);
    let lowered = sanitized.to_ascii_lowercase();
    if lowered.starts_with("[system:auto-idle]") || lowered.starts_with("[system:") {
        return String::new();
    }
    sanitized
}

fn extract_tagged_prompt_block(content: &str, open_tag: &str, close_tag: &str) -> Option<String> {
    let start = content.rfind(open_tag)?;
    let remainder = &content[start + open_tag.len()..];
    let end = remainder.find(close_tag)?;
    let value = remainder[..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn extract_task_input_from_prompt_context(message: &str) -> Option<String> {
    let normalized = message.replace("\r\n", "\n");
    let candidates = [
        ("[task_input]\n", "\n[/task_input]"),
        ("[task_input]", "[/task_input]"),
        ("[[CONTEXT_SLOT:task_input]]\n", "\n[[/CONTEXT_SLOT]]"),
        ("[[CONTEXT_SLOT:task_input]]", "[[/CONTEXT_SLOT]]"),
    ];
    for (open_tag, close_tag) in candidates {
        if let Some(value) = extract_tagged_prompt_block(&normalized, open_tag, close_tag) {
            return Some(value);
        }
    }
    None
}

fn is_legacy_task_draft_artifact(text: &str) -> bool {
    let trimmed = text.trim();
    !trimmed.is_empty()
        && (trimmed.contains("分析这条消息是否是在创建或补充聊天任务草案")
            || trimmed.contains("当前智能体的任务草案分析暂时不可用，本次没有生成任务卡"))
}

fn sanitize_prompt_wrapped_user_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if is_legacy_task_draft_artifact(trimmed) {
        return String::new();
    }

    if trimmed
        .to_ascii_lowercase()
        .starts_with("[prompt-context v=")
    {
        return extract_task_input_from_prompt_context(trimmed)
            .unwrap_or_else(|| trimmed.to_string());
    }

    if let Some(index) = trimmed.find("[prompt-context v=") {
        if let Some(task_input) = extract_task_input_from_prompt_context(&trimmed[index..]) {
            let prefix = trimmed[..index].trim();
            return if prefix.is_empty() {
                task_input
            } else {
                format!("{prefix} {task_input}").trim().to_string()
            };
        }
    }

    if trimmed.contains("[task_input]") || trimmed.contains("[[CONTEXT_SLOT:task_input]]") {
        if let Some(task_input) = extract_task_input_from_prompt_context(trimmed) {
            return task_input;
        }
    }

    trimmed.to_string()
}

fn build_sanitized_session_messages(session: &Value) -> Option<Vec<Value>> {
    let rows = session.get("messages").and_then(Value::as_array)?;
    let mut changed = false;
    let mut messages = Vec::with_capacity(rows.len());

    for row in rows {
        let Some(raw_role) = row.get("role").and_then(Value::as_str) else {
            continue;
        };
        let normalized_role = match raw_role.trim().to_ascii_lowercase().as_str() {
            "system" => "system",
            "user" => "user",
            "assistant" | "agent" => "assistant",
            _ => continue,
        };
        let Some(original_text) = row
            .get("content")
            .and_then(extract_text_from_json)
            .or_else(|| row.get("message").and_then(extract_text_from_json))
        else {
            continue;
        };
        let original_trimmed = original_text.trim();
        if original_trimmed.is_empty() {
            continue;
        }

        let sanitized_content = if normalized_role == "user" {
            sanitize_prompt_wrapped_user_text(original_trimmed)
        } else {
            original_trimmed.to_string()
        };
        let final_content = if sanitized_content.trim().is_empty() {
            original_trimmed.to_string()
        } else {
            sanitized_content.trim().to_string()
        };
        if final_content != original_trimmed {
            changed = true;
        }
        messages.push(json!({
            "role": normalized_role,
            "content": final_content,
        }));
    }

    if changed { Some(messages) } else { None }
}

async fn maybe_sanitize_current_openfang_session(
    state: &Arc<AppState>,
    agent_id: &str,
    session_id: Option<&str>,
) -> Result<bool, ApiError> {
    let Some(session_id) = session_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(false);
    };
    let session_path = format!("/api/agents/{agent_id}/session");
    let session = state.openfang.get_json(&session_path).await?;
    let Some(messages) = build_sanitized_session_messages(&session) else {
        return Ok(false);
    };

    let path = format!("/api/sessions/{session_id}/content");
    state
        .openfang
        .put_json(&path, json!({ "messages": messages }))
        .await?;
    Ok(true)
}

fn extract_user_address_from_message(message: &str, agent_id: &str) -> Option<String> {
    let patterns = [
        "你可以叫我",
        "你就叫我",
        "以后叫我",
        "请叫我",
        "叫我",
        "称呼我",
        "喊我",
        "我叫",
        "我是",
    ];
    for pattern in patterns {
        if let Some(index) = message.find(pattern) {
            let rest = &message[index + pattern.len()..];
            let candidate = take_short_token(rest);
            if !is_invalid_user_address(&candidate, agent_id) {
                return Some(candidate);
            }
        }
    }
    None
}

fn push_unique_preference(out: &mut Vec<String>, value: &str) {
    if out.iter().any(|item| item == value) {
        return;
    }
    out.push(value.to_string());
}

fn collect_investment_preferences(message: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = message.to_ascii_lowercase();

    if message.contains("短线") {
        push_unique_preference(&mut out, "短线交易");
    }
    if message.contains("长线") || message.contains("价值投资") {
        push_unique_preference(&mut out, "长线价值投资");
    }
    if message.contains("波段") {
        push_unique_preference(&mut out, "波段交易");
    }

    if lower.contains("a股") || message.contains("沪深") {
        push_unique_preference(&mut out, "A股");
    }
    if message.contains("港股") {
        push_unique_preference(&mut out, "港股");
    }
    if message.contains("美股") {
        push_unique_preference(&mut out, "美股");
    }

    if message.contains("科技") {
        push_unique_preference(&mut out, "科技");
    }
    if message.contains("消费") {
        push_unique_preference(&mut out, "消费");
    }
    if message.contains("新能源") {
        push_unique_preference(&mut out, "新能源");
    }
    if message.contains("医药") {
        push_unique_preference(&mut out, "医药");
    }
    if message.contains("金融") {
        push_unique_preference(&mut out, "金融");
    }
    if message.contains("半导体") {
        push_unique_preference(&mut out, "半导体");
    }
    let has_ai_keyword = message.contains("AI")
        || message.contains("A I")
        || message.contains("人工智能")
        || lower.contains(" a.i")
        || lower.contains(" ai ");
    if has_ai_keyword {
        push_unique_preference(&mut out, "AI");
    }

    out
}

fn extract_user_profile_patch_from_message(
    message: &str,
    agent_id: &str,
) -> Option<UserProfilePatch> {
    let user_segment = extract_user_message_segment(message);
    let trimmed = user_segment.trim();
    if trimmed.is_empty() {
        return None;
    }
    let user_address = extract_user_address_from_message(trimmed, agent_id);
    let investment_preferences = collect_investment_preferences(trimmed);
    if user_address.is_none() && investment_preferences.is_empty() {
        return None;
    }
    Some(UserProfilePatch {
        user_address,
        investment_preferences,
    })
}

fn replace_or_append_markdown_field(
    content: &str,
    key_aliases: &[&str],
    canonical_key: &str,
    value: &str,
) -> String {
    let aliases = key_aliases
        .iter()
        .map(|item| item.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    let mut output_lines = Vec::new();
    let mut replaced = false;

    for line in content.lines() {
        let line_trimmed = line.trim();
        if let Some((key, _)) = split_key_value_line(line_trimmed) {
            if aliases.iter().any(|alias| alias == &key) {
                if !replaced {
                    output_lines.push(format!("- {canonical_key}: {value}"));
                    replaced = true;
                }
                continue;
            }
        }
        output_lines.push(line.to_string());
    }

    if !replaced {
        if output_lines
            .last()
            .map(|line| !line.trim().is_empty())
            .unwrap_or(false)
        {
            output_lines.push(String::new());
        }
        output_lines.push(format!("- {canonical_key}: {value}"));
    }

    output_lines.join("\n")
}

fn merge_user_markdown(existing_content: &str, patch: &UserProfilePatch) -> String {
    let mut next = if existing_content.trim().is_empty()
        || is_default_stub_context("USER.md", existing_content)
    {
        "# USER.md\n## 用户画像\n- user_address:\n- relation: 长期协作伙伴\n- investment_preferences:\n- tone_preference: 简洁直接、先结论后解释".to_string()
    } else {
        existing_content.to_string()
    };

    if let Some(user_address) = patch.user_address.as_deref() {
        next = replace_or_append_markdown_field(
            &next,
            &["user_address", "name", "用户称呼", "称呼"],
            "user_address",
            user_address,
        );
    }
    if !patch.investment_preferences.is_empty() {
        let value = patch.investment_preferences.join("、");
        next = replace_or_append_markdown_field(
            &next,
            &["investment_preferences", "preferences", "偏好"],
            "investment_preferences",
            &value,
        );
    }
    next
}

fn merge_memory_markdown(existing_content: &str, patch: &UserProfilePatch) -> String {
    if patch.user_address.is_none() && patch.investment_preferences.is_empty() {
        return existing_content.to_string();
    }
    let mut next = if existing_content.trim().is_empty()
        || is_default_stub_context("MEMORY.md", existing_content)
    {
        "# MEMORY.md\n## 长期记忆策略\n- 记录用户长期目标、偏好与限制。\n- 定期清理冲突或过期信息。\n\n## 用户偏好快照".to_string()
    } else {
        existing_content.to_string()
    };

    let user_address = patch
        .user_address
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("未指定");
    let pref_text = if patch.investment_preferences.is_empty() {
        "未指定".to_string()
    } else {
        patch.investment_preferences.join("、")
    };
    let dedup_key = format!("user_address: {user_address} | investment_preferences: {pref_text}");
    if next.contains(&dedup_key) {
        return next;
    }

    if !next.contains("## 用户偏好快照") {
        if next
            .lines()
            .last()
            .map(|line| !line.trim().is_empty())
            .unwrap_or(false)
        {
            next.push('\n');
        }
        next.push_str("\n## 用户偏好快照");
    }
    if !next.ends_with('\n') {
        next.push('\n');
    }
    let snapshot = format!(
        "- ts: {} | user_address: {} | investment_preferences: {}",
        now_millis(),
        user_address,
        pref_text
    );
    next.push_str(&snapshot);
    next
}

async fn maybe_persist_user_profile_patch(
    state: &Arc<AppState>,
    agent_id: &str,
    message: &str,
) -> Result<bool, ApiError> {
    validate_agent_path_segment(agent_id)?;
    let Some(patch) = extract_user_profile_patch_from_message(message, agent_id) else {
        return Ok(false);
    };

    let context_files =
        assignment_store::list_agent_context_files(agent_id).map_err(storage_error)?;
    let existing_user = context_files
        .get("USER.md")
        .map(|item| item.content.as_str())
        .unwrap_or("");
    let existing_memory = context_files
        .get("MEMORY.md")
        .map(|item| item.content.as_str())
        .unwrap_or("");

    let next_user = merge_user_markdown(existing_user, &patch);
    let next_memory = merge_memory_markdown(existing_memory, &patch);

    let mut changed = false;
    if next_user.trim() != existing_user.trim() {
        assignment_store::upsert_agent_context_file(agent_id, "USER.md", &next_user)
            .map_err(storage_error)?;
        write_context_file_to_openfang(state, agent_id, "USER.md", &next_user).await?;
        changed = true;
    }
    if next_memory.trim() != existing_memory.trim() {
        assignment_store::upsert_agent_context_file(agent_id, "MEMORY.md", &next_memory)
            .map_err(storage_error)?;
        write_context_file_to_openfang(state, agent_id, "MEMORY.md", &next_memory).await?;
        changed = true;
    }

    if changed {
        tracing::info!(
            agent_id = %agent_id,
            user_address = patch.user_address.clone().unwrap_or_default(),
            preference_count = patch.investment_preferences.len(),
            "auto-profile: persisted user profile patch"
        );
    }

    Ok(changed)
}

fn to_trimmed_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn truncate_for_prompt(raw: &str, max_chars: usize) -> String {
    let text = raw.trim();
    if text.is_empty() {
        return "暂无简介".to_string();
    }
    let mut out = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    if out.is_empty() {
        "暂无简介".to_string()
    } else {
        out
    }
}

async fn resolve_collaboration_prompt(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<Option<String>, ApiError> {
    let profile = assignment_store::get_agent_profile_override(agent_id).map_err(storage_error)?;
    let Some(profile) = profile else {
        return Ok(None);
    };
    let Some(collaboration) = profile.collaboration.as_ref() else {
        return Ok(None);
    };
    let dispatch_enabled = collaboration
        .get("dispatchEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !dispatch_enabled {
        return Ok(None);
    }

    let acl_rows = assignment_store::list_agent_collaboration_acl(agent_id, "private")
        .map_err(storage_error)?;
    let allowed_ids = acl_rows
        .into_iter()
        .filter(|row| row.enabled)
        .map(|row| row.callee_agent_id)
        .collect::<Vec<String>>();
    if allowed_ids.is_empty() {
        return Ok(Some(
            "[system:multi-agent-collaboration]\n你当前未配置可调用员工。禁止调用其他智能体。"
                .to_string(),
        ));
    }

    let overrides = assignment_store::list_agent_profile_overrides().map_err(storage_error)?;
    let upstream_agents = state
        .openfang
        .get_json("/api/agents")
        .await
        .unwrap_or_else(|_| Value::Array(vec![]));
    let rows = upstream_agents.as_array().cloned().unwrap_or_default();
    let mut upstream_map: HashMap<String, (String, String)> = HashMap::new();
    for row in rows {
        let Some(id) = to_trimmed_string(row.get("id")) else {
            continue;
        };
        let display_name = to_trimmed_string(row.get("name")).unwrap_or_else(|| id.clone());
        let description = to_trimmed_string(row.get("description"))
            .or_else(|| to_trimmed_string(row.get("profile")))
            .or_else(|| to_trimmed_string(row.get("summary")))
            .unwrap_or_else(|| "暂无简介".to_string());
        upstream_map.insert(id, (display_name, description));
    }

    let mut lines = Vec::new();
    for callee_id in allowed_ids {
        let override_profile = overrides.get(&callee_id);
        let display_name = override_profile
            .and_then(|item| item.nickname.as_deref())
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToString::to_string)
            .or_else(|| {
                override_profile
                    .and_then(|item| item.english_name.as_deref())
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(ToString::to_string)
            })
            .or_else(|| upstream_map.get(&callee_id).map(|item| item.0.clone()))
            .unwrap_or_else(|| callee_id.clone());
        let description = override_profile
            .and_then(|item| item.description.as_deref())
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToString::to_string)
            .or_else(|| upstream_map.get(&callee_id).map(|item| item.1.clone()))
            .unwrap_or_else(|| "暂无简介".to_string());
        lines.push(format!(
            "- {} (id={}): {}",
            display_name,
            callee_id,
            truncate_for_prompt(&description, 120)
        ));
    }

    if lines.is_empty() {
        return Ok(Some(
            "[system:multi-agent-collaboration]\n你当前未配置可调用员工。禁止调用其他智能体。"
                .to_string(),
        ));
    }

    Ok(Some(
        [
            "[system:multi-agent-collaboration]",
            "你当前可调用的员工白名单（仅以下对象允许委派）：",
            &lines.join("\n"),
            "严格规则：仅允许调用白名单中的智能体；禁止调用未授权对象。",
            "只有在你本轮确实调用了其他智能体进行委派时，最终答复才需要汇总各个子任务状态（工作中 / 已完成 / 失败）。",
            "如果本轮没有实际发生任何委派，就禁止伪造“子任务状态”“子智能体状态”“协作状态汇总”等措辞。",
            "普通单智能体回答、组件直接调用、组件异步执行回填、视频/音频/图片生成都不属于子任务委派；这类场景应直接描述组件执行状态，不要包装成子任务。",
        ]
        .join("\n"),
    ))
}

fn parse_frontend_prompt_slots(message: &str) -> ParsedFrontendPromptSlots {
    let mut parsed = ParsedFrontendPromptSlots::default();
    let mut cursor = message;
    while let Some(open_index) = cursor.find(CONTEXT_SLOT_OPEN_PREFIX) {
        let after_open = &cursor[open_index + CONTEXT_SLOT_OPEN_PREFIX.len()..];
        let Some(name_end) = after_open.find("]]") else {
            break;
        };
        let slot_name = after_open[..name_end].trim().to_ascii_lowercase();
        let content_start = open_index + CONTEXT_SLOT_OPEN_PREFIX.len() + name_end + 2;
        let remainder = &cursor[content_start..];
        let Some(close_index) = remainder.find(CONTEXT_SLOT_CLOSE) else {
            break;
        };
        let content = remainder[..close_index].trim().to_string();
        if !content.is_empty() {
            parsed.slot_sources.push(format!("frontend:{slot_name}"));
            match slot_name.as_str() {
                "global_policy" => parsed.global_policy = Some(content),
                "execution_protocol" => parsed.execution_protocol = Some(content),
                "capability_context" => parsed.capability_context = Some(content),
                "session_context" => parsed.session_context = Some(content),
                "task_input" => parsed.task_input = Some(content),
                _ => {}
            }
        }
        cursor = &remainder[close_index + CONTEXT_SLOT_CLOSE.len()..];
    }
    parsed
}

fn wrap_final_prompt_slot(slot: &PromptContextSlot) -> String {
    format!("[{}]\n{}\n[/{}]", slot.slot, slot.content.trim(), slot.slot)
}

fn truncate_utf8_by_bytes(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = 0;
    for (index, ch) in text.char_indices() {
        let next = index + ch.len_utf8();
        if next > max_bytes {
            break;
        }
        end = next;
    }
    &text[..end]
}

fn truncate_prompt_block_by_bytes(content: &str, max_bytes: usize) -> String {
    let trimmed = content.trim();
    if trimmed.is_empty() || trimmed.len() <= max_bytes {
        return trimmed.to_string();
    }

    if max_bytes <= PROMPT_TRUNCATION_NOTICE.len() + 16 {
        return truncate_utf8_by_bytes(trimmed, max_bytes).trim().to_string();
    }

    let keep_bytes = max_bytes.saturating_sub(PROMPT_TRUNCATION_NOTICE.len());
    let prefix = truncate_utf8_by_bytes(trimmed, keep_bytes).trim_end();
    format!("{prefix}{PROMPT_TRUNCATION_NOTICE}").trim().to_string()
}

fn prompt_slot_soft_cap_bytes(slot: &str) -> Option<usize> {
    match slot {
        "host_policy" => Some(8 * 1024),
        "global_policy" => Some(4 * 1024),
        "execution_protocol" => Some(4 * 1024),
        "temporal_context" => Some(2 * 1024),
        "opening_context" => Some(3 * 1024),
        "identity_context" => Some(32 * 1024),
        "capability_context" => Some(8 * 1024),
        "memory_context" => Some(6 * 1024),
        "session_context" => Some(8 * 1024),
        "task_input" => Some(4 * 1024),
        _ => None,
    }
}

fn apply_prompt_slot_soft_caps(slots: &mut [PromptContextSlot]) {
    for slot in slots {
        if let Some(limit) = prompt_slot_soft_cap_bytes(&slot.slot) {
            slot.content = truncate_prompt_block_by_bytes(&slot.content, limit);
        }
    }
}

fn enforce_prompt_budget(mut slots: Vec<PromptContextSlot>) -> Vec<PromptContextSlot> {
    apply_prompt_slot_soft_caps(&mut slots);

    let byte_len = |items: &[PromptContextSlot]| {
        render_prompt_context_envelope(&PromptContextEnvelope {
            version: "structured-context/v1".to_string(),
            slots: items.to_vec(),
        })
        .bytes
    };

    if byte_len(&slots) <= OPENFANG_PROMPT_MAX_BYTES {
        return slots;
    }

    let shrink_plan: [(&str, usize); 10] = [
        ("memory_context", 3 * 1024),
        ("opening_context", 2 * 1024),
        ("session_context", 3 * 1024),
        ("capability_context", 4 * 1024),
        ("host_policy", 4 * 1024),
        ("global_policy", 2 * 1024),
        ("execution_protocol", 2 * 1024),
        ("temporal_context", 1024),
        ("identity_context", 20 * 1024),
        ("task_input", 2 * 1024),
    ];
    for (slot_name, target_bytes) in shrink_plan {
        if byte_len(&slots) <= OPENFANG_PROMPT_MAX_BYTES {
            break;
        }
        if let Some(slot) = slots.iter_mut().find(|item| item.slot == slot_name) {
            slot.content = truncate_prompt_block_by_bytes(&slot.content, target_bytes);
        }
    }

    let remove_order = [
        "memory_context",
        "opening_context",
        "session_context",
        "capability_context",
        "global_policy",
        "execution_protocol",
        "temporal_context",
        "host_policy",
    ];
    for slot_name in remove_order {
        if byte_len(&slots) <= OPENFANG_PROMPT_MAX_BYTES {
            break;
        }
        slots.retain(|item| item.slot != slot_name);
    }

    if byte_len(&slots) > OPENFANG_PROMPT_MAX_BYTES {
        if let Some(slot) = slots.iter_mut().find(|item| item.slot == "identity_context") {
            slot.content = truncate_prompt_block_by_bytes(&slot.content, 12 * 1024);
        }
    }
    if byte_len(&slots) > OPENFANG_PROMPT_MAX_BYTES {
        if let Some(slot) = slots.iter_mut().find(|item| item.slot == "task_input") {
            slot.content = truncate_prompt_block_by_bytes(&slot.content, 1024);
        }
    }
    if byte_len(&slots) > OPENFANG_PROMPT_MAX_BYTES {
        slots.retain(|item| item.slot == "identity_context" || item.slot == "task_input");
    }
    if byte_len(&slots) > OPENFANG_PROMPT_MAX_BYTES {
        if let Some(slot) = slots.iter_mut().find(|item| item.slot == "identity_context") {
            slot.content = truncate_prompt_block_by_bytes(&slot.content, 6 * 1024);
        }
    }
    if byte_len(&slots) > OPENFANG_PROMPT_MAX_BYTES {
        if let Some(slot) = slots.iter_mut().find(|item| item.slot == "task_input") {
            slot.content = truncate_prompt_block_by_bytes(&slot.content, 512);
        }
    }

    slots
}

fn compact_prompt_block(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    let mut lines = Vec::new();
    let mut prev_blank = false;

    for line in normalized.lines() {
        let trimmed_end = line.trim_end();
        if trimmed_end.trim().is_empty() {
            if prev_blank {
                continue;
            }
            prev_blank = true;
            lines.push(String::new());
            continue;
        }
        prev_blank = false;
        lines.push(trimmed_end.to_string());
    }

    lines.join("\n").trim().to_string()
}

fn resolve_host_policy_prompt() -> (Option<String>, bool) {
    match fs::read_to_string(HOST_POLICY_AGENTS_PATH) {
        Ok(content) => {
            let trimmed = content.trim().to_string();
            if trimmed.is_empty() {
                (None, false)
            } else {
                (Some(trimmed), true)
            }
        }
        Err(_) => (None, false),
    }
}

fn build_visible_reply_requirement_block() -> String {
    [
        "[system:require-visible-reply]",
        "这是用户在当前聊天窗口主动发起的一次明确提问或指令。",
        "必须给出面向用户的可见正文回复。",
        "禁止仅返回 NO_REPLY、[[silent]]、空字符串，或只有工具/记忆日志。",
        "如果需要先检索记忆、调用工具或做中间步骤，完成后仍必须继续输出最终正文。",
        "当前轮次只是聊天交互，不代表任何任务、提醒、监控、定时器已经创建、发布、启动或设置完成。",
        "只有在你已经实际调用工具成功创建了任务后，才能明确告知“已创建”“已开始监控”“提醒已设置完成”；否则只能说明计划、理解或待确认参数。",
        "当用户表达监控、提醒、定时、周期执行诉求时，你必须先判断用户是否真的要创建任务，而不是把所有相关聊天都当成任务。",
        "如果创建意图不明确，或你不确定用户是在聊天、举例、讨论方案，还是要求立即创建任务，必须先用自然语言追问确认。",
        "如果用户明确要创建任务，但频率、触发条件、执行时长、目标对象等关键参数不足，必须先补问缺失参数。",
        "只有当用户明确同意创建且关键参数已经足够时，才可以调用调度相关工具创建任务；创建失败时要如实说明失败原因。",
    ]
    .join("\n")
}

fn format_string_list_block(title: &str, items: &[String], empty_text: &str) -> String {
    if items.is_empty() {
        return format!("{title}\n- {empty_text}");
    }
    let mut lines = vec![title.to_string()];
    lines.extend(items.iter().map(|item| format!("- {item}")));
    lines.join("\n")
}

fn format_capability_binding_line(
    binding: &assignment_store::AgentCapabilityBindingRecord,
) -> String {
    let provider = binding
        .provider_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default");
    format!(
        "{} | scope={} | provider={} | binding_type={}",
        binding.capability_key, binding.capability_scope, provider, binding.binding_type
    )
}

async fn resolve_capability_context(
    _state: &Arc<AppState>,
    agent_id: &str,
    frontend_capability_context: Option<&str>,
    collaboration_prompt: Option<&str>,
) -> Result<(Option<String>, AgentCapabilitySnapshot, Vec<String>), ApiError> {
    let enabled_skills =
        assignment_store::list_agent_enabled_skills(agent_id).map_err(storage_error)?;
    let enabled_mcp_servers = strip_workspace_mcp_names(
        assignment_store::list_agent_enabled_mcp_servers(agent_id).map_err(storage_error)?,
    );
    let capability_bindings = assignment_store::list_agent_capability_bindings(Some(agent_id))
        .map_err(storage_error)?
        .into_iter()
        .filter(|item| item.enabled)
        .collect::<Vec<_>>();
    let provider_bindings = assignment_store::list_capability_provider_bindings()
        .map_err(storage_error)?
        .into_iter()
        .filter(|item| item.enabled)
        .collect::<Vec<_>>();
    let providers = assignment_store::list_capability_providers(false)
        .map_err(storage_error)?
        .into_iter()
        .filter(|item| item.enabled && !item.is_removed)
        .collect::<Vec<_>>();
    let blocked_tools = webot_chat_blocked_tools()
        .into_iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let provider_health = assignment_store::list_provider_health_states().map_err(storage_error)?;
    let mut capability_sources = vec![
        "frontend:capability_context".to_string(),
        "backend:enabled_skills".to_string(),
        "backend:enabled_mcp_servers".to_string(),
        "backend:agent_capability_bindings".to_string(),
        "backend:capability_provider_bindings".to_string(),
        "backend:capability_providers".to_string(),
        "backend:blocked_tools".to_string(),
    ];
    if collaboration_prompt.is_some() {
        capability_sources.push("backend:multi_agent_acl".to_string());
    }

    let capability_lines = capability_bindings
        .iter()
        .map(format_capability_binding_line)
        .collect::<Vec<_>>();
    let provider_route_lines = provider_bindings
        .iter()
        .map(|item| {
            format!(
                "{} | scope={} | provider={}",
                item.capability_key, item.capability_scope, item.provider_id
            )
        })
        .collect::<Vec<_>>();
    let provider_lines = providers
        .iter()
        .map(|item| {
            let capability_text = item
                .capabilities
                .iter()
                .map(|cap| format!("{}:{}", cap.key, cap.scope))
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "{} | type={} | scopes={} | capabilities={}",
                item.provider_id,
                item.provider_type,
                if item.supported_scopes.is_empty() {
                    "none".to_string()
                } else {
                    item.supported_scopes.join(", ")
                },
                if capability_text.is_empty() {
                    "none".to_string()
                } else {
                    capability_text
                }
            )
        })
        .collect::<Vec<_>>();
    let provider_health_lines = provider_health
        .iter()
        .map(|item| {
            let message = item
                .message
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("no message");
            format!(
                "{} | health={} | {}",
                item.provider_id, item.health_state, message
            )
        })
        .collect::<Vec<_>>();
    let runtime_scope_lines = providers
        .iter()
        .flat_map(|item| item.supported_scopes.iter().cloned())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    let mut sections = Vec::new();
    if let Some(frontend_context) = frontend_capability_context {
        let trimmed = frontend_context.trim();
        if !trimmed.is_empty() {
            sections.push(format!(
                "[capability:tool-routing-and-component-runtime]\n{}",
                trimmed
            ));
        }
    }
    if let Some(collaboration) = collaboration_prompt {
        let trimmed = collaboration.trim();
        if !trimmed.is_empty() {
            sections.push(trimmed.to_string());
        }
    }
    sections.push(format_string_list_block(
        "[capability:enabled-skills]",
        &enabled_skills,
        "当前未启用额外 skills",
    ));
    sections.push(format_string_list_block(
        "[capability:enabled-mcp-servers]",
        &enabled_mcp_servers,
        "当前未启用额外 MCP servers",
    ));
    sections.push(format_string_list_block(
        "[capability:agent-bindings]",
        &capability_lines,
        "当前未绑定额外 capability providers",
    ));
    sections.push(format_string_list_block(
        "[capability:provider-routes]",
        &provider_route_lines,
        "当前未配置 capability provider routes",
    ));
    sections.push(format_string_list_block(
        "[capability:runtime-providers]",
        &provider_lines,
        "当前未发现已启用 capability providers",
    ));
    sections.push(format_string_list_block(
        "[capability:runtime-scopes]",
        &runtime_scope_lines,
        "当前未发现额外 runtime scopes",
    ));
    sections.push(format_string_list_block(
        "[capability:provider-health]",
        &provider_health_lines,
        "当前没有 provider health 记录",
    ));
    sections.push(format_string_list_block(
        "[capability:blocked-tools]",
        &blocked_tools,
        "当前没有额外 blocked tools",
    ));
    sections.push(format!(
        "[capability:runtime-restrictions]\n- 能验证的事实必须优先走已启用的底层能力验证。\n- 若当前能力快照未列出某项能力，则禁止伪造可调用。\n- 若调用失败，必须保留错误上下文并明确说明降级路径。"
    ));

    let snapshot = AgentCapabilitySnapshot {
        agent_id: agent_id.to_string(),
        enabled_skills: enabled_skills.clone(),
        enabled_mcp_servers: enabled_mcp_servers.clone(),
        enabled_capabilities: capability_lines.clone(),
        blocked_tools: blocked_tools.clone(),
    };
    let merged = sections.join("\n\n");
    let merged = merged.trim().to_string();
    if merged.is_empty() {
        Ok((None, snapshot, capability_sources))
    } else {
        Ok((Some(merged), snapshot, capability_sources))
    }
}

fn compose_prompt_context_envelope(
    _agent_id: &str,
    raw_message: &str,
    raw_user_message: Option<&str>,
    parsed_frontend_slots: ParsedFrontendPromptSlots,
    temporal_context: Option<String>,
    opening_context: Option<String>,
    identity_context: Option<String>,
    memory_context: Option<String>,
    capability_context: Option<String>,
) -> (PromptContextEnvelope, PromptAssemblyDebug) {
    let (host_policy, host_policy_loaded) = resolve_host_policy_prompt();
    let mut debug = PromptAssemblyDebug {
        host_policy_loaded,
        prompt_slots: Vec::new(),
        prompt_sources: Vec::new(),
        prompt_total_bytes: 0,
        prompt_slot_sizes: Vec::new(),
        capability_sources: Vec::new(),
        available_skills: Vec::new(),
        available_mcp_servers: Vec::new(),
        available_capabilities: Vec::new(),
        blocked_tools: Vec::new(),
    };
    let ParsedFrontendPromptSlots {
        global_policy,
        execution_protocol,
        capability_context: _frontend_capability_slot,
        session_context,
        task_input,
        slot_sources,
    } = parsed_frontend_slots;
    debug.prompt_sources.extend(slot_sources);
    let fallback_task = raw_user_message
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| raw_message.trim())
        .to_string();
    let final_task_input = task_input
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| fallback_task.clone());
    let session_slot = {
        let mut blocks = Vec::new();
        if let Some(session_context) = session_context {
            let trimmed = session_context.trim();
            if !trimmed.is_empty() {
                blocks.push(trimmed.to_string());
            }
        }
        blocks.push(build_visible_reply_requirement_block());
        Some(blocks.join("\n\n"))
    };

    let ordered = vec![
        (
            "host_policy",
            "host:C:\\Users\\Administrator\\.webot\\AGENTS.md".to_string(),
            host_policy,
        ),
        (
            "global_policy",
            "frontend:global_policy".to_string(),
            global_policy,
        ),
        (
            "execution_protocol",
            "frontend:execution_protocol".to_string(),
            execution_protocol,
        ),
        (
            "temporal_context",
            "backend:temporal_context".to_string(),
            temporal_context,
        ),
        (
            "opening_context",
            "backend:opening_context".to_string(),
            opening_context,
        ),
        (
            "identity_context",
            "backend:agent_identity_context".to_string(),
            identity_context,
        ),
        (
            "capability_context",
            "backend:capability_context".to_string(),
            capability_context,
        ),
        (
            "memory_context",
            "backend:memory_context".to_string(),
            memory_context,
        ),
        (
            "session_context",
            "merged:session_context".to_string(),
            session_slot,
        ),
        (
            "task_input",
            "frontend_or_request:task_input".to_string(),
            Some(final_task_input.clone()),
        ),
    ];

    let mut slots = Vec::new();
    for (slot, source, content) in ordered {
        let Some(content) = content else {
            continue;
        };
        let trimmed = content.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = if slot == "task_input" {
            trimmed.to_string()
        } else {
            compact_prompt_block(trimmed)
        };
        if normalized.is_empty() {
            continue;
        }
        slots.push(PromptContextSlot {
            slot: slot.to_string(),
            source: source.clone(),
            content: normalized,
        });
        debug.prompt_slots.push(slot.to_string());
        debug.prompt_sources.push(source);
    }

    let slots = enforce_prompt_budget(slots);
    let envelope = PromptContextEnvelope {
        version: "structured-context/v1".to_string(),
        slots,
    };
    debug.prompt_slots = envelope
        .slots
        .iter()
        .map(|slot| slot.slot.clone())
        .collect::<Vec<_>>();
    debug.prompt_sources = envelope
        .slots
        .iter()
        .map(|slot| slot.source.clone())
        .collect::<Vec<_>>();
    (envelope, debug)
}

fn render_prompt_context_envelope(envelope: &PromptContextEnvelope) -> RenderedPromptContext {
    let mut blocks = Vec::with_capacity(envelope.slots.len() + 1);
    blocks.push(format!("[prompt-context v={}]", envelope.version));

    let mut slot_sizes = Vec::with_capacity(envelope.slots.len());
    for slot in &envelope.slots {
        let rendered = wrap_final_prompt_slot(slot);
        slot_sizes.push(PromptSlotSizeDebug {
            slot: slot.slot.clone(),
            source: slot.source.clone(),
            content_bytes: slot.content.len(),
            rendered_bytes: rendered.len(),
        });
        blocks.push(rendered);
    }

    let message = blocks.join("\n");
    RenderedPromptContext {
        bytes: message.len(),
        message,
        slot_sizes,
    }
}

#[allow(dead_code)]
fn apply_system_prompt_guard(
    message: &str,
    system_prompt: Option<&str>,
    collaboration_prompt: Option<&str>,
    semantic_memory_prompt: Option<&str>,
    include_prompt_blocks: bool,
) -> String {
    if message.contains("[system:profile]") {
        return message.to_string();
    }
    if !include_prompt_blocks {
        return message.to_string();
    }

    let mut blocks: Vec<String> = Vec::new();
    if let Some(system_prompt) = system_prompt {
        let trimmed_prompt = system_prompt.trim();
        if !trimmed_prompt.is_empty() {
            blocks.push(format!("[system:profile]\n{trimmed_prompt}"));
        }
    }
    if let Some(collaboration_prompt) = collaboration_prompt {
        let trimmed = collaboration_prompt.trim();
        if !trimmed.is_empty() {
            blocks.push(trimmed.to_string());
        }
    }
    if let Some(semantic_memory_prompt) = semantic_memory_prompt {
        let trimmed = semantic_memory_prompt.trim();
        if !trimmed.is_empty() {
            blocks.push(trimmed.to_string());
        }
    }
    if blocks.is_empty() {
        return message.to_string();
    }
    format!("{}\n\n{}", blocks.join("\n\n"), message)
}

#[allow(dead_code)]
fn ensure_visible_reply_for_chat_turn(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() || message.contains("[system:require-visible-reply]") {
        return message.to_string();
    }

    [
        build_visible_reply_requirement_block(),
        "".to_string(),
        message.to_string(),
    ]
    .join("\n")
}

async fn resolve_semantic_memory_prompt(
    state: &Arc<AppState>,
    agent_id: &str,
    message: &str,
) -> Result<Option<SemanticMemoryRecallContext>, ApiError> {
    let config = resolve_memory_enhancement_runtime_config()?;
    if !config.enabled || !config.auto_recall {
        return Ok(None);
    }

    let query = extract_user_message_segment(message);
    if query.is_empty() {
        return Ok(None);
    }
    let relevant_rows = fetch_semantic_memory_rows(
        state,
        agent_id,
        &query,
        config.recall_limit,
        config.recall_score_threshold,
    )
    .await?;
    let Some(relevant_rows) = relevant_rows else {
        return Ok(None);
    };
    let recent_rows = fetch_semantic_memory_rows(
        state,
        agent_id,
        "",
        config.recall_limit,
        config.recall_score_threshold,
    )
    .await?
    .unwrap_or_default();
    let rows = merge_semantic_memory_rows(relevant_rows, recent_rows, config.recall_limit);
    if rows.is_empty() {
        return Ok(None);
    }

    let debug_plan_lines =
        match fetch_unified_memory_debug_plan_lines(state, agent_id, &query, config.recall_limit)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(
                    agent_id = %agent_id,
                    error = %error.message,
                    "semantic memory debug plan skipped due to error"
                );
                None
            }
        };

    let mut lines = Vec::new();
    for (index, row) in rows.into_iter().enumerate() {
        let Some(content) = row.get("content").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        let cleaned_content = sanitize_prompt_wrapped_user_text(content);
        if cleaned_content.is_empty() {
            continue;
        }
        let confidence = row
            .get("confidence")
            .and_then(Value::as_f64)
            .unwrap_or_default();
        let scope = row
            .get("scope")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown");
        let source = row
            .get("source")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("semantic");
        let kind = row
            .get("kind")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("semantic_memory");
        let score = row.get("score").and_then(Value::as_f64).unwrap_or_default();
        let event_type = row
            .get("event_type")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let explain = row.get("explain");
        let query_subject_type = explain
            .and_then(|value| value.get("query_subject_type"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let query_subject_id = explain
            .and_then(|value| value.get("query_subject_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let query_subject_depth = explain
            .and_then(|value| value.get("query_subject_depth"))
            .and_then(Value::as_u64);
        let query_subject_weight = explain
            .and_then(|value| value.get("query_subject_weight"))
            .and_then(Value::as_f64);
        let related_from_subject_type = explain
            .and_then(|value| value.get("related_from_subject_type"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let related_from_subject_id = explain
            .and_then(|value| value.get("related_from_subject_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let reason = row
            .get("explain")
            .and_then(|value| value.get("reason"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("统一记忆召回");
        let summary = truncate_for_prompt(&cleaned_content, 180);
        let mut prefix = format!(
            "- #{idx} [kind={kind}] [score={score:.2}] [confidence={confidence:.2}] [scope={scope}] [source={source}]",
            idx = index + 1
        );
        if let Some(event_type) = event_type {
            prefix.push_str(&format!(" [event_type={event_type}]"));
        }
        if let (Some(st), Some(sid)) = (query_subject_type, query_subject_id) {
            prefix.push_str(&format!(" [subject={st}:{sid}]"));
        }
        if let Some(depth) = query_subject_depth {
            prefix.push_str(&format!(" [depth={depth}]"));
        }
        if let Some(w) = query_subject_weight {
            prefix.push_str(&format!(" [w={w:.2}]"));
        }
        if let (Some(from_type), Some(from_id)) =
            (related_from_subject_type, related_from_subject_id)
        {
            prefix.push_str(&format!(" [from={from_type}:{from_id}]"));
        }
        lines.push(format!("{prefix} {summary} ({reason})"));
    }

    if lines.is_empty() {
        return Ok(None);
    }

    let prompt = [
        "[system:semantic-memory]",
        "以下是与当前用户输入相关的跨会话长期记忆，仅在相关时参考。",
        "若与用户本轮明确表述冲突，必须以本轮表述为准；不要把旧记忆当作绝对事实。",
        &lines.join("\n"),
    ]
    .join("\n");
    let mut log_sections = Vec::new();
    log_sections.push(format!("query: {}", query));
    if let Some(plan_lines) = debug_plan_lines {
        log_sections.push("debug_plan:".to_string());
        log_sections.extend(plan_lines);
    }
    log_sections.push(format!("hits: {}", lines.len()));
    log_sections.push(lines.join("\n"));
    let log_detail = log_sections.join("\n");

    Ok(Some(SemanticMemoryRecallContext {
        prompt,
        query,
        hit_count: lines.len(),
        log_detail,
    }))
}

fn find_sse_frame_boundary(buffer: &str) -> Option<(usize, usize)> {
    if let Some(index) = buffer.find("\r\n\r\n") {
        return Some((index, 4));
    }
    if let Some(index) = buffer.find("\n\n") {
        return Some((index, 2));
    }
    None
}

fn parse_sse_event_frame(frame: &str) -> Option<(String, String)> {
    let normalized = frame.replace("\r\n", "\n");
    let mut event_name = String::from("message");
    let mut data_lines: Vec<String> = Vec::new();

    for line in normalized.lines() {
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("event:") {
            let name = rest.trim();
            if !name.is_empty() {
                event_name = name.to_string();
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start().to_string());
        }
    }

    if data_lines.is_empty() {
        return None;
    }
    Some((event_name, data_lines.join("\n")))
}

fn extract_done_usage_tokens(data: &str) -> (Option<u64>, Option<u64>) {
    let Ok(parsed) = serde_json::from_str::<Value>(data) else {
        return (None, None);
    };

    let usage = parsed.get("usage");
    let input_tokens = usage
        .and_then(|item| item.get("input_tokens"))
        .and_then(Value::as_u64)
        .or_else(|| parsed.get("input_tokens").and_then(Value::as_u64));
    let output_tokens = usage
        .and_then(|item| item.get("output_tokens"))
        .and_then(Value::as_u64)
        .or_else(|| parsed.get("output_tokens").and_then(Value::as_u64));

    (input_tokens, output_tokens)
}

async fn send_sse_json_event(
    tx: &tokio::sync::mpsc::Sender<Result<Bytes, Infallible>>,
    event: &str,
    payload: Value,
) -> bool {
    let body = payload.to_string();
    tx.send(Ok(Bytes::from(format!("event: {event}\ndata: {body}\n\n"))))
        .await
        .is_ok()
}

async fn send_sse_phase_event(
    tx: &tokio::sync::mpsc::Sender<Result<Bytes, Infallible>>,
    phase: &str,
    detail: Option<String>,
) -> bool {
    let detail = detail
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut payload = json!({ "phase": phase });
    if let Some(detail) = detail {
        payload["detail"] = Value::String(detail);
    }
    send_sse_json_event(tx, "phase", payload).await
}

fn extract_text_from_json(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Array(list) => {
            let mut lines: Vec<String> = Vec::new();
            for item in list {
                if let Some(text) = extract_text_from_json(item) {
                    if !text.is_empty() {
                        lines.push(text);
                    }
                }
            }
            if lines.is_empty() {
                None
            } else {
                Some(lines.join("\n"))
            }
        }
        Value::Object(map) => {
            let preferred = [
                "text", "content", "message", "response", "output", "result", "value",
            ];
            for key in preferred {
                if let Some(candidate) = map.get(key) {
                    if let Some(text) = extract_text_from_json(candidate) {
                        if !text.is_empty() {
                            return Some(text);
                        }
                    }
                }
            }

            for candidate in map.values() {
                if let Some(text) = extract_text_from_json(candidate) {
                    if !text.is_empty() {
                        return Some(text);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

#[derive(Debug, Clone)]
struct AgentSelfAppearanceAction {
    avatar_url: Option<String>,
    portrait_url: Option<String>,
    reason: Option<String>,
}

fn normalize_agent_ui_action_type(raw: &str) -> String {
    raw.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn read_agent_action_prop_text(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        if let Some(text) = to_trimmed_string(object.get(*key)) {
            return Some(text);
        }
    }
    None
}

fn parse_agent_self_appearance_action_value(value: &Value) -> Option<AgentSelfAppearanceAction> {
    let object = value.as_object()?;
    let action_type = to_trimmed_string(object.get("type"))
        .or_else(|| to_trimmed_string(object.get("component")))
        .unwrap_or_default();
    if normalize_agent_ui_action_type(&action_type) != "agentselfappearanceaction" {
        return None;
    }

    let props = object
        .get("props")
        .or_else(|| object.get("payload"))
        .unwrap_or(value);
    let avatar_url = read_agent_action_prop_text(props, &["avatarUrl", "avatar_url"]);
    let portrait_url = read_agent_action_prop_text(props, &["portraitUrl", "portrait_url"]);
    let reason = read_agent_action_prop_text(props, &["reason"]);

    if avatar_url.is_none() && portrait_url.is_none() {
        return None;
    }

    Some(AgentSelfAppearanceAction {
        avatar_url,
        portrait_url,
        reason,
    })
}

fn extract_agent_self_appearance_action_from_text(text: &str) -> Option<AgentSelfAppearanceAction> {
    let mut remaining = text;
    let mut latest: Option<AgentSelfAppearanceAction> = None;
    let open_tags = ["<UI_JSON>", "<ui_json>", "<ui-json>"];
    let close_tags = ["</UI_JSON>", "</ui_json>", "</ui-json>"];

    loop {
        let start_hit = open_tags
            .iter()
            .filter_map(|tag| remaining.find(tag).map(|index| (index, *tag)))
            .min_by_key(|(index, _)| *index);
        let Some((start, open_tag)) = start_hit else {
            break;
        };

        let after_start = &remaining[start + open_tag.len()..];
        let end_hit = close_tags
            .iter()
            .filter_map(|tag| after_start.find(tag).map(|index| (index, *tag)))
            .min_by_key(|(index, _)| *index);
        let Some((end, close_tag)) = end_hit else {
            break;
        };
        let raw_json = after_start[..end].trim();
        if !raw_json.is_empty() {
            if let Ok(value) = serde_json::from_str::<Value>(raw_json) {
                if let Some(hit) = parse_agent_self_appearance_action_value(&value) {
                    latest = Some(hit);
                }
            }
        }
        remaining = &after_start[end + close_tag.len()..];
    }

    if latest.is_some() {
        return latest;
    }

    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            return parse_agent_self_appearance_action_value(&value);
        }
    }

    None
}

fn extract_chat_response_text(value: &Value) -> Option<String> {
    let preferred_paths: &[&[&str]] = &[
        &["content"],
        &["text"],
        &["response"],
        &["message"],
        &["data", "content"],
        &["data", "text"],
        &["data", "response"],
        &["result", "content"],
        &["result", "text"],
        &["result", "response"],
    ];

    for path in preferred_paths {
        let mut current = value;
        let mut found = true;
        for key in *path {
            let Some(next) = current.get(*key) else {
                found = false;
                break;
            };
            current = next;
        }
        if !found {
            continue;
        }
        if let Some(text) = extract_text_from_json(current) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    extract_text_from_json(value).and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn parse_management_media_reference(source_url: &str) -> Option<(String, &'static str, String)> {
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

fn extract_filename_hint_from_url(source_url: &str) -> Option<String> {
    let trimmed = source_url.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") {
        return None;
    }
    let path_only = trimmed
        .split('#')
        .next()
        .unwrap_or(trimmed)
        .split('?')
        .next()
        .unwrap_or(trimmed);
    StdPath::new(path_only)
        .file_name()
        .and_then(OsStr::to_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn infer_image_filename_from_content_type(content_type: &str) -> Option<String> {
    let normalized = content_type.trim().to_ascii_lowercase();
    let ext = if normalized.starts_with("image/png") {
        "png"
    } else if normalized.starts_with("image/jpeg") || normalized.starts_with("image/jpg") {
        "jpg"
    } else if normalized.starts_with("image/gif") {
        "gif"
    } else if normalized.starts_with("image/webp") {
        "webp"
    } else if normalized.starts_with("image/bmp") {
        "bmp"
    } else {
        return None;
    };
    Some(format!("image.{ext}"))
}

fn decode_data_url_image_bytes(
    source_url: &str,
) -> Result<Option<(Vec<u8>, Option<String>, Option<String>)>, ApiError> {
    let trimmed = source_url.trim();
    if !trimmed.starts_with("data:image/") {
        return Ok(None);
    }

    let header = trimmed
        .split(',')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_lowercase();
    let (filename_hint, content_type) = if header.starts_with("data:image/png") {
        (Some("image.png".to_string()), Some("image/png".to_string()))
    } else if header.starts_with("data:image/jpeg") || header.starts_with("data:image/jpg") {
        (
            Some("image.jpg".to_string()),
            Some("image/jpeg".to_string()),
        )
    } else if header.starts_with("data:image/gif") {
        (Some("image.gif".to_string()), Some("image/gif".to_string()))
    } else if header.starts_with("data:image/webp") {
        (
            Some("image.webp".to_string()),
            Some("image/webp".to_string()),
        )
    } else if header.starts_with("data:image/bmp") {
        (Some("image.bmp".to_string()), Some("image/bmp".to_string()))
    } else {
        (None, None)
    };

    let bytes = decode_inline_upload_base64(trimmed)?;
    Ok(Some((bytes, filename_hint, content_type)))
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

async fn fetch_agent_appearance_source_bytes(
    state: &Arc<AppState>,
    source_url: &str,
) -> Result<(Vec<u8>, Option<String>, Option<String>), ApiError> {
    if let Some((bytes, filename_hint, content_type)) = decode_data_url_image_bytes(source_url)? {
        return Ok((bytes, filename_hint, content_type));
    }

    let trimmed = source_url.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "外观资源地址不能为空",
        ));
    }

    let openfang_base = state.config.openfang_base_url.trim_end_matches('/');
    let service_base = local_service_base_url(state);
    let request_url = if trimmed.starts_with("/api/uploads/") {
        format!("{openfang_base}{trimmed}")
    } else if trimmed.starts_with('/') {
        format!("{service_base}{trimmed}")
    } else {
        trimmed.to_string()
    };
    let requires_openfang_auth = trimmed.starts_with("/api/uploads/")
        || (trimmed.starts_with(openfang_base)
            && trimmed[openfang_base.len()..].starts_with("/api/uploads/"));

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(state.config.request_timeout_ms))
        .timeout(Duration::from_millis(state.config.request_timeout_ms))
        .build()
        .map_err(|e| storage_error(format!("创建外观资源下载客户端失败: {e}")))?;
    let mut request = client.get(&request_url);
    if requires_openfang_auth {
        if let Some(key) = state
            .config
            .openfang_api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            request = request.bearer_auth(key);
        }
    }

    let response = request.send().await.map_err(|e| {
        ApiError::new(
            axum::http::StatusCode::BAD_GATEWAY,
            format!("拉取外观资源失败({request_url}): {e}"),
        )
    })?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let body = response.bytes().await.map_err(|e| {
        ApiError::new(
            axum::http::StatusCode::BAD_GATEWAY,
            format!("读取外观资源响应失败({request_url}): {e}"),
        )
    })?;

    if !status.is_success() {
        let snippet = String::from_utf8_lossy(&body);
        return Err(ApiError::new(
            status,
            format!("外观资源下载返回错误({request_url}): {}", snippet.trim()),
        ));
    }

    let filename_hint = extract_filename_hint_from_url(trimmed).or_else(|| {
        content_type
            .as_deref()
            .and_then(infer_image_filename_from_content_type)
    });
    Ok((body.to_vec(), filename_hint, content_type))
}

async fn resolve_agent_self_appearance_asset(
    state: &Arc<AppState>,
    public_agent_id: &str,
    resolved_agent_id: &str,
    source_url: &str,
    kind: &'static str,
) -> Result<Option<String>, ApiError> {
    let trimmed = source_url.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if let Some((source_agent_id, source_kind, filename)) =
        parse_management_media_reference(trimmed)
    {
        let same_agent = source_agent_id.eq_ignore_ascii_case(public_agent_id)
            || source_agent_id.eq_ignore_ascii_case(resolved_agent_id);
        if same_agent && source_kind == kind {
            return Ok(Some(match kind {
                "avatar" => build_avatar_url(public_agent_id, &filename),
                _ => build_portrait_url(public_agent_id, &filename),
            }));
        }
    }

    let (bytes, filename_hint, content_type_hint) =
        fetch_agent_appearance_source_bytes(state, trimmed).await?;
    let public_url = match kind {
        "avatar" => {
            let (_, filename, saved_path) = save_agent_avatar_bytes(
                state,
                resolved_agent_id,
                filename_hint.as_deref(),
                content_type_hint.as_deref(),
                &bytes,
                None,
            )
            .await?;
            let public_url = build_avatar_url(public_agent_id, &filename);
            index_agent_photo_asset_best_effort(
                resolved_agent_id,
                "avatar_self_materialize",
                "avatar",
                &public_url,
                &filename,
                &saved_path,
            )
            .await;
            public_url
        }
        _ => {
            let (_, filename, saved_path) = save_agent_portrait_bytes(
                state,
                resolved_agent_id,
                filename_hint.as_deref(),
                content_type_hint.as_deref(),
                &bytes,
                None,
            )
            .await?;
            let public_url = build_portrait_url(public_agent_id, &filename);
            index_agent_photo_asset_best_effort(
                resolved_agent_id,
                "portrait_self_materialize",
                "portrait",
                &public_url,
                &filename,
                &saved_path,
            )
            .await;
            public_url
        }
    };
    Ok(Some(public_url))
}

async fn apply_agent_self_appearance_update_from_text(
    state: &Arc<AppState>,
    public_agent_id: &str,
    resolved_agent_id: &str,
    response_text: &str,
) -> Result<Option<Value>, ApiError> {
    let Some(action) = extract_agent_self_appearance_action_from_text(response_text) else {
        return Ok(None);
    };

    let avatar_url = if let Some(source_url) = action.avatar_url.as_deref() {
        resolve_agent_self_appearance_asset(
            state,
            public_agent_id,
            resolved_agent_id,
            source_url,
            "avatar",
        )
        .await?
    } else {
        None
    };
    let portrait_url = if let Some(source_url) = action.portrait_url.as_deref() {
        resolve_agent_self_appearance_asset(
            state,
            public_agent_id,
            resolved_agent_id,
            source_url,
            "portrait",
        )
        .await?
    } else {
        None
    };

    let mut updated_fields = Vec::new();
    if avatar_url.is_some() {
        updated_fields.push("avatar");
    }
    if portrait_url.is_some() {
        updated_fields.push("portrait");
    }
    if updated_fields.is_empty() {
        return Ok(None);
    }

    assignment_store::upsert_agent_profile_override(
        resolved_agent_id,
        None,
        None,
        None,
        None,
        None,
        avatar_url.clone(),
        portrait_url.clone(),
        None,
        None,
        None,
        None,
    )
    .map_err(storage_error)?;

    Ok(Some(json!({
        "agent_id": public_agent_id,
        "resolved_agent_id": resolved_agent_id,
        "avatar_url": avatar_url,
        "portrait_url": portrait_url,
        "reason": action.reason,
        "updated_fields": updated_fields,
    })))
}

async fn emit_stream_agent_appearance_updated_event(
    tx: &tokio::sync::mpsc::Sender<Result<Bytes, Infallible>>,
    state: &Arc<AppState>,
    public_agent_id: &str,
    resolved_agent_id: &str,
    response_text: &str,
) {
    match apply_agent_self_appearance_update_from_text(
        state,
        public_agent_id,
        resolved_agent_id,
        response_text,
    )
    .await
    {
        Ok(Some(payload)) => {
            let event = Bytes::from(format!("event: appearance_updated\ndata: {}\n\n", payload));
            let _ = tx.send(Ok(event)).await;
        }
        Ok(None) => {}
        Err(err) => {
            tracing::warn!(
                agent_id = %resolved_agent_id,
                error = %err.message,
                "chat appearance auto-apply skipped due to error"
            );
        }
    }
}

fn append_renderable_stream_text(buffer: &mut String, data: &str) {
    if let Ok(parsed) = serde_json::from_str::<Value>(data) {
        if let Some(text) = extract_text_from_json(&parsed) {
            if !text.is_empty() {
                buffer.push_str(&text);
            }
        }
        return;
    }

    let trimmed = data.trim();
    if !trimmed.is_empty() {
        buffer.push_str(trimmed);
    }
}

fn looks_like_protocol_only_text(text: &str) -> bool {
    let normalized = text.trim();
    if normalized.is_empty() {
        return true;
    }
    if normalized
        .to_ascii_lowercase()
        .starts_with("[prompt-context v=")
    {
        return true;
    }
    if normalized.to_ascii_lowercase().starts_with("<tool_call>") {
        return true;
    }
    let lines: Vec<&str> = normalized
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        return true;
    }
    lines.iter().all(|line| {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("query:")
            || lower.starts_with("tool:")
            || lower.starts_with("args:")
            || lower.starts_with("name:")
            || lower.starts_with("id:")
            || lower.starts_with("type:")
            || lower.starts_with("<tool_call>")
    })
}

fn extract_assistant_texts(session: &Value) -> Vec<String> {
    let Some(rows) = session.get("messages").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut results = Vec::new();
    for row in rows {
        let role = row
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if role != "assistant" && role != "agent" {
            continue;
        }

        if let Some(content) = row.get("content") {
            if let Some(text) = extract_text_from_json(content) {
                let trimmed = text.trim();
                if !trimmed.is_empty() && !looks_like_protocol_only_text(trimmed) {
                    results.push(trimmed.to_string());
                    continue;
                }
            }
        }
        if let Some(message) = row.get("message") {
            if let Some(text) = extract_text_from_json(message) {
                let trimmed = text.trim();
                if !trimmed.is_empty() && !looks_like_protocol_only_text(trimmed) {
                    results.push(trimmed.to_string());
                }
            }
        }
    }
    results
}

fn should_inject_prompt_blocks_for_session(session: Option<&Value>) -> bool {
    match session {
        Some(payload) => !has_meaningful_user_history(payload),
        None => true,
    }
}

fn extract_new_assistant_text(session: &Value, baseline_count: usize) -> Option<String> {
    let texts = extract_assistant_texts(session);
    if texts.len() <= baseline_count {
        return None;
    }
    texts.into_iter().skip(baseline_count).last()
}

fn build_openfang_attachment_payload(attachments: &[ChatMessageAttachmentRequest]) -> Vec<Value> {
    attachments
        .iter()
        .filter_map(|item| {
            let file_id = item
                .file_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or_default();
            let local_vision_summary = item
                .local_vision_summary
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or_default();
            if file_id.is_empty() && local_vision_summary.is_empty() {
                return None;
            }
            Some(json!({
                "file_id": file_id,
                "filename": item.filename.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or_default(),
                "content_type": item.content_type.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or_default(),
                "local_vision_summary": local_vision_summary,
                "local_vision_provider": item.local_vision_provider.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or_default(),
                "local_vision_model": item.local_vision_model.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or_default()
            }))
        })
        .collect()
}

pub async fn chat_message(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<ChatMessageRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let public_agent_id = resolved.requested;
    let agent_id = resolved.resolved;
    if let Err(err) = normalize_agent_model_selector_if_needed(&state, &agent_id).await {
        tracing::warn!(
            agent_id = %agent_id,
            error = %err.message,
            "chat_message: model normalize skipped due to error"
        );
    }
    if let Err(err) = sync_agent_context_files(&state, &agent_id, false).await {
        tracing::warn!(agent_id = %agent_id, error = %err.message, "chat_message: context sync skipped due to error");
    }
    if let Err(err) = maybe_auto_initialize_agent_identity_once(&state, &agent_id).await {
        tracing::warn!(agent_id = %agent_id, error = %err.message, "chat_message: auto-init skipped due to error");
    }
    let semantic_input_message = payload
        .raw_user_message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(payload.message.as_str())
        .to_string();
    if let Err(err) =
        maybe_persist_user_profile_patch(&state, &agent_id, &semantic_input_message).await
    {
        tracing::warn!(agent_id = %agent_id, error = %err.message, "chat_message: auto-profile skipped due to error");
    }
    let include_bootstrap = should_include_bootstrap_for_turn(&state, &agent_id).await;
    let daily_opening_context = build_daily_opening_context(&state, &agent_id, include_bootstrap).await;
    remember_agent_seen_today(&agent_id, &current_local_date_key()).await;
    let identity_context = resolve_agent_system_prompt(&agent_id, include_bootstrap)?;
    let collaboration_prompt = match resolve_collaboration_prompt(&state, &agent_id).await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(agent_id = %agent_id, error = %error.message, "chat_message: collaboration prompt skipped due to error");
            None
        }
    };
    let semantic_memory_context = match resolve_semantic_memory_prompt(
        &state,
        &agent_id,
        &semantic_input_message,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(agent_id = %agent_id, error = %error.message, "chat_message: semantic memory recall skipped due to error");
            None
        }
    };
    if let Some(context) = semantic_memory_context.as_ref() {
        tracing::info!(
            agent_id = %agent_id,
            query = %context.query,
            hit_count = context.hit_count,
            "chat_message: semantic memory recalled"
        );
    }
    let parsed_frontend_slots = parse_frontend_prompt_slots(&payload.message);
    let (capability_context, capability_snapshot, capability_sources) =
        match resolve_capability_context(
            &state,
            &agent_id,
            parsed_frontend_slots.capability_context.as_deref(),
            collaboration_prompt.as_deref(),
        )
        .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(agent_id = %agent_id, error = %error.message, "chat_message: capability context skipped due to error");
                (
                    None,
                    AgentCapabilitySnapshot::default(),
                    vec!["backend:capability_context:error".to_string()],
                )
            }
        };

    let session_ctx = ensure_switched_to_session_target(
        &state,
        &agent_id,
        payload.session_id.as_deref(),
        payload.session_label.as_deref(),
    )
    .await?;
    let session_path = format!("/api/agents/{agent_id}/session");
    let current_session = state.openfang.get_json(&session_path).await.ok();
    let _include_prompt_blocks = should_inject_prompt_blocks_for_session(current_session.as_ref());

    let memory_context = semantic_memory_context
        .as_ref()
        .map(|item| item.prompt.clone());
    let (envelope, mut prompt_debug) = compose_prompt_context_envelope(
        &agent_id,
        &payload.message,
        payload.raw_user_message.as_deref(),
        parsed_frontend_slots,
        Some(daily_opening_context.temporal_context.clone()),
        daily_opening_context.opening_context.clone(),
        identity_context,
        memory_context,
        capability_context,
    );
    if daily_opening_context.is_first_chat_today_with_agent {
        tracing::info!(
            agent_id = %agent_id,
            include_bootstrap,
            "chat_message: first effective chat today detected for current agent"
        );
    }
    prompt_debug.capability_sources = capability_sources;
    prompt_debug.available_skills = capability_snapshot.enabled_skills.clone();
    prompt_debug.available_mcp_servers = capability_snapshot.enabled_mcp_servers.clone();
    prompt_debug.available_capabilities = capability_snapshot.enabled_capabilities.clone();
    prompt_debug.blocked_tools = capability_snapshot.blocked_tools.clone();
    let rendered_prompt = render_prompt_context_envelope(&envelope);
    prompt_debug.prompt_total_bytes = rendered_prompt.bytes;
    prompt_debug.prompt_slot_sizes = rendered_prompt.slot_sizes.clone();
    if prompt_debug.prompt_total_bytes >= OPENFANG_PROMPT_WARN_THRESHOLD_BYTES {
        tracing::warn!(
            agent_id = %agent_id,
            prompt_bytes = prompt_debug.prompt_total_bytes,
            slot_sizes = ?prompt_debug.prompt_slot_sizes,
            "chat_message: large upstream prompt assembled"
        );
    }
    let outgoing_message = rendered_prompt.message;
    let attachments = build_openfang_attachment_payload(&payload.attachments);
    let request_origin = resolve_upstream_request_origin(
        payload.request_origin.as_deref(),
        payload.session_label.as_deref(),
    );
    let path = format!("/api/agents/{agent_id}/message");
    let blocked_tools = webot_chat_blocked_tools();
    let mut data = match state
        .openfang
        .post_json(
            &path,
            json!({
                "message": outgoing_message,
                "attachments": attachments,
                "request_origin": request_origin,
                "blocked_tools": blocked_tools,
            }),
        )
        .await
    {
        Ok(value) => value,
        Err(err) => {
            restore_and_cleanup_switched_session(&state.openfang, &agent_id, &session_ctx).await;
            return Err(err);
        }
    };

    let bound_session_id = if session_ctx.target_session_id.trim().is_empty() {
        get_openfang_agent_session_id(&state, &agent_id).await.ok()
    } else {
        Some(session_ctx.target_session_id.clone())
    };
    let bound_session_label = payload
        .session_label
        .as_deref()
        .map(normalize_session_label)
        .filter(|value| !value.is_empty());

    if let Err(error) =
        maybe_sanitize_current_openfang_session(&state, &agent_id, bound_session_id.as_deref())
            .await
    {
        tracing::warn!(
            agent_id = %agent_id,
            error = %error.message,
            "chat_message: session sanitize skipped due to error"
        );
    }

    if session_ctx.switched {
        let _ = switch_openfang_session(&state, &agent_id, &session_ctx.original_session_id).await;
    }

    if let Some(response_text) = extract_chat_response_text(&data) {
        match apply_agent_self_appearance_update_from_text(
            &state,
            &public_agent_id,
            &agent_id,
            &response_text,
        )
        .await
        {
            Ok(Some(appearance_updated)) => {
                if let Some(object) = data.as_object_mut() {
                    object.insert("appearance_updated".to_string(), appearance_updated);
                } else {
                    tracing::warn!(
                        agent_id = %agent_id,
                        "chat_message: upstream response is not an object, skipped appearance_updated injection"
                    );
                }
            }
            Ok(None) => {}
            Err(err) => {
                tracing::warn!(
                    agent_id = %agent_id,
                    error = %err.message,
                    "chat_message: appearance auto-apply skipped due to error"
                );
            }
        }
    }

    if let Some(object) = data.as_object_mut() {
        if let Some(session_id) = bound_session_id
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            object.insert("session_id".to_string(), Value::String(session_id.clone()));
        }
        if let Some(session_label) = bound_session_label.as_ref() {
            object.insert(
                "session_label".to_string(),
                Value::String(session_label.clone()),
            );
        }
        object.insert(
            "debugPromptSlots".to_string(),
            json!(prompt_debug.prompt_slots),
        );
        object.insert(
            "debugPromptSources".to_string(),
            json!(prompt_debug.prompt_sources),
        );
        object.insert(
            "debugPromptBytes".to_string(),
            json!(prompt_debug.prompt_total_bytes),
        );
        object.insert(
            "debugPromptSlotSizes".to_string(),
            json!(prompt_debug.prompt_slot_sizes),
        );
        object.insert(
            "debugHostPolicyLoaded".to_string(),
            json!(prompt_debug.host_policy_loaded),
        );
        object.insert(
            "debugCapabilitySources".to_string(),
            json!(prompt_debug.capability_sources),
        );
        object.insert(
            "debugAvailableSkills".to_string(),
            json!(prompt_debug.available_skills),
        );
        object.insert(
            "debugAvailableMcpServers".to_string(),
            json!(prompt_debug.available_mcp_servers),
        );
        object.insert(
            "debugAvailableCapabilities".to_string(),
            json!(prompt_debug.available_capabilities),
        );
        object.insert(
            "debugBlockedTools".to_string(),
            json!(prompt_debug.blocked_tools),
        );
    }

    Ok(Json(data))
}

pub async fn chat_message_stream(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<ChatMessageRequest>,
) -> Result<axum::response::Response, ApiError> {
    ensure_online(&state).await?;
    let resolved = resolve_agent_id_alias(&state, &id).await?;
    let public_agent_id = resolved.requested;
    let agent_id = resolved.resolved;
    if let Err(err) = normalize_agent_model_selector_if_needed(&state, &agent_id).await {
        tracing::warn!(
            agent_id = %agent_id,
            error = %err.message,
            "chat_message_stream: model normalize skipped due to error"
        );
    }
    if let Err(err) = sync_agent_context_files(&state, &agent_id, false).await {
        tracing::warn!(agent_id = %agent_id, error = %err.message, "chat_message_stream: context sync skipped due to error");
    }
    if let Err(err) = maybe_auto_initialize_agent_identity_once(&state, &agent_id).await {
        tracing::warn!(agent_id = %agent_id, error = %err.message, "chat_message_stream: auto-init skipped due to error");
    }
    let semantic_input_message = payload
        .raw_user_message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(payload.message.as_str())
        .to_string();
    if let Err(err) =
        maybe_persist_user_profile_patch(&state, &agent_id, &semantic_input_message).await
    {
        tracing::warn!(agent_id = %agent_id, error = %err.message, "chat_message_stream: auto-profile skipped due to error");
    }
    let include_bootstrap = should_include_bootstrap_for_turn(&state, &agent_id).await;
    let daily_opening_context = build_daily_opening_context(&state, &agent_id, include_bootstrap).await;
    remember_agent_seen_today(&agent_id, &current_local_date_key()).await;
    let identity_context = resolve_agent_system_prompt(&agent_id, include_bootstrap)?;
    let collaboration_prompt = match resolve_collaboration_prompt(&state, &agent_id).await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(agent_id = %agent_id, error = %error.message, "chat_message_stream: collaboration prompt skipped due to error");
            None
        }
    };
    let semantic_memory_context = match resolve_semantic_memory_prompt(
        &state,
        &agent_id,
        &semantic_input_message,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(agent_id = %agent_id, error = %error.message, "chat_message_stream: semantic memory recall skipped due to error");
            None
        }
    };
    if let Some(context) = semantic_memory_context.as_ref() {
        tracing::info!(
            agent_id = %agent_id,
            query = %context.query,
            hit_count = context.hit_count,
            "chat_message_stream: semantic memory recalled"
        );
    }

    let ChatMessageRequest {
        message: user_message,
        raw_user_message,
        session_id: requested_session_id,
        session_label: requested_session_label,
        request_origin: requested_request_origin,
        attachments: requested_attachments,
    } = payload;
    let parsed_frontend_slots = parse_frontend_prompt_slots(&user_message);
    let (capability_context, capability_snapshot, capability_sources) =
        match resolve_capability_context(
            &state,
            &agent_id,
            parsed_frontend_slots.capability_context.as_deref(),
            collaboration_prompt.as_deref(),
        )
        .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(agent_id = %agent_id, error = %error.message, "chat_message_stream: capability context skipped due to error");
                (
                    None,
                    AgentCapabilitySnapshot::default(),
                    vec!["backend:capability_context:error".to_string()],
                )
            }
        };
    let openfang = state.openfang.clone();
    let state_for_post_process = state.clone();
    let public_agent_id = public_agent_id;
    let agent_id = agent_id;
    let semantic_memory_context = semantic_memory_context;
    let memory_context = semantic_memory_context
        .as_ref()
        .map(|item| item.prompt.clone());
    let (envelope, mut prompt_debug) = compose_prompt_context_envelope(
        &agent_id,
        &user_message,
        raw_user_message.as_deref(),
        parsed_frontend_slots,
        Some(daily_opening_context.temporal_context.clone()),
        daily_opening_context.opening_context.clone(),
        identity_context,
        memory_context,
        capability_context,
    );
    if daily_opening_context.is_first_chat_today_with_agent {
        tracing::info!(
            agent_id = %agent_id,
            include_bootstrap,
            "chat_message_stream: first effective chat today detected for current agent"
        );
    }
    prompt_debug.capability_sources = capability_sources;
    prompt_debug.available_skills = capability_snapshot.enabled_skills.clone();
    prompt_debug.available_mcp_servers = capability_snapshot.enabled_mcp_servers.clone();
    prompt_debug.available_capabilities = capability_snapshot.enabled_capabilities.clone();
    prompt_debug.blocked_tools = capability_snapshot.blocked_tools.clone();
    let rendered_prompt = render_prompt_context_envelope(&envelope);
    prompt_debug.prompt_total_bytes = rendered_prompt.bytes;
    prompt_debug.prompt_slot_sizes = rendered_prompt.slot_sizes.clone();
    if prompt_debug.prompt_total_bytes >= OPENFANG_PROMPT_WARN_THRESHOLD_BYTES {
        tracing::warn!(
            agent_id = %agent_id,
            prompt_bytes = prompt_debug.prompt_total_bytes,
            slot_sizes = ?prompt_debug.prompt_slot_sizes,
            "chat_message_stream: large upstream prompt assembled"
        );
    }
    let outgoing_message = rendered_prompt.message;

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, Infallible>>(128);
    tokio::spawn(async move {
        if let Some(context) = semantic_memory_context.as_ref() {
            if !send_sse_json_event(
                &tx,
                "phase",
                json!({
                    "phase": "unified_memory_recall",
                    "detail": context.log_detail,
                    "query": context.query,
                    "hits": context.hit_count,
                }),
            )
            .await
            {
                return;
            }
        }

        let session_prepare_detail = match (
            requested_session_label
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
            requested_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        ) {
            (Some(label), _) => Some(format!("正在准备会话标签：{label}")),
            (None, Some(session_id)) => Some(format!("正在准备会话 ID：{session_id}")),
            (None, None) => Some("当前请求未指定会话目标，将沿用 OpenFang 当前会话。".to_string()),
        };
        if !send_sse_phase_event(&tx, "session_prepare", session_prepare_detail).await {
            return;
        }

        let session_ctx = match ensure_switched_to_session_target(
            &state_for_post_process,
            &agent_id,
            requested_session_id.as_deref(),
            requested_session_label.as_deref(),
        )
        .await
        {
            Ok(value) => value,
            Err(err) => {
                let _ = send_sse_json_event(
                    &tx,
                    "error",
                    json!({
                        "error": err.message,
                        "fallback": "session_prepare",
                    }),
                )
                .await;
                return;
            }
        };

        let restore_original_session = || async {
            if !session_ctx.switched {
                return;
            }
            restore_openfang_session_with_client(
                &openfang,
                &agent_id,
                &session_ctx.original_session_id,
            )
            .await;
        };
        let restore_and_cleanup = || async {
            restore_and_cleanup_switched_session(&openfang, &agent_id, &session_ctx).await;
        };

        let session_path = format!("/api/agents/{agent_id}/session");
        let current_session = match openfang.get_json(&session_path).await {
            Ok(session) => Some(session),
            Err(err) => {
                tracing::warn!(
                    agent_id = %agent_id,
                    error = %err.message,
                    "chat_message_stream: failed to inspect session after switch"
                );
                None
            }
        };
        let bound_session_id = if session_ctx.target_session_id.trim().is_empty() {
            get_openfang_agent_session_id(&state_for_post_process, &agent_id)
                .await
                .ok()
                .filter(|value| !value.trim().is_empty())
        } else {
            Some(session_ctx.target_session_id.clone())
        };
        let bound_session_label = requested_session_label
            .as_deref()
            .map(normalize_session_label)
            .filter(|value| !value.is_empty());
        let sanitize_and_restore = || async {
            if let Err(error) = maybe_sanitize_current_openfang_session(
                &state_for_post_process,
                &agent_id,
                bound_session_id.as_deref(),
            )
            .await
            {
                tracing::warn!(
                    agent_id = %agent_id,
                    error = %error.message,
                    "chat_message_stream: session sanitize skipped due to error"
                );
            }
            restore_original_session().await;
        };

        let session_ready_detail = if session_ctx.switched {
            Some(format!(
                "已切换到目标会话，session_id={}",
                session_ctx.target_session_id
            ))
        } else if !session_ctx.target_session_id.trim().is_empty() {
            Some(format!(
                "目标会话已就绪，session_id={}",
                session_ctx.target_session_id
            ))
        } else {
            Some("沿用当前会话继续发送。".to_string())
        };
        if !send_sse_json_event(
            &tx,
            "phase",
            json!({
                "phase": "session_ready",
                "detail": session_ready_detail,
                "session_id": bound_session_id.clone(),
                "session_label": bound_session_label.clone(),
            }),
        )
        .await
        {
            restore_and_cleanup().await;
            return;
        }

        let attachments = build_openfang_attachment_payload(&requested_attachments);
        let request_origin = resolve_upstream_request_origin(
            requested_request_origin.as_deref(),
            requested_session_label.as_deref(),
        );
        let baseline_assistant_count = current_session
            .as_ref()
            .map(|session| extract_assistant_texts(session).len())
            .unwrap_or(0);

        if !send_sse_phase_event(
            &tx,
            "upstream_connecting",
            Some("会话已准备完成，正在连接上游模型流。".to_string()),
        )
        .await
        {
            restore_and_cleanup().await;
            return;
        }
        if !send_sse_json_event(
            &tx,
            "prompt_debug",
            json!({
                "debugPromptSlots": prompt_debug.prompt_slots,
                "debugPromptSources": prompt_debug.prompt_sources,
                "debugPromptBytes": prompt_debug.prompt_total_bytes,
                "debugPromptSlotSizes": prompt_debug.prompt_slot_sizes,
                "debugHostPolicyLoaded": prompt_debug.host_policy_loaded,
                "debugCapabilitySources": prompt_debug.capability_sources,
                "debugAvailableSkills": prompt_debug.available_skills,
                "debugAvailableMcpServers": prompt_debug.available_mcp_servers,
                "debugAvailableCapabilities": prompt_debug.available_capabilities,
                "debugBlockedTools": prompt_debug.blocked_tools,
            }),
        )
        .await
        {
            restore_and_cleanup().await;
            return;
        }

        let path = format!("/api/agents/{agent_id}/message/stream");
        let blocked_tools = webot_chat_blocked_tools();
        let upstream = match openfang
            .post_stream(
                &path,
                json!({
                    "message": outgoing_message,
                    "attachments": attachments,
                    "request_origin": request_origin,
                    "blocked_tools": blocked_tools,
                }),
            )
            .await
        {
            Ok(stream) => stream,
            Err(err) => {
                let _ = send_sse_json_event(
                    &tx,
                    "error",
                    json!({
                        "error": err.message,
                        "fallback": "upstream_connecting",
                    }),
                )
                .await;
                restore_and_cleanup().await;
                return;
            }
        };

        if !send_sse_phase_event(
            &tx,
            "upstream_connected",
            Some("已建立上游流式连接，等待模型返回首个内容块。".to_string()),
        )
        .await
        {
            restore_and_cleanup().await;
            return;
        }

        let mut upstream_stream = upstream.bytes_stream();
        let mut frame_buffer = String::new();
        let mut streamed_text = String::new();
        let mut saw_tool_result = false;
        let mut saw_upstream_done = false;
        let mut saw_upstream_error = false;
        let mut upstream_done_input_tokens: Option<u64> = None;
        let mut upstream_done_output_tokens: Option<u64> = None;
        let message = outgoing_message;
        let heartbeat_interval = Duration::from_secs(STREAM_PROXY_HEARTBEAT_INTERVAL_SECS);
        let mut heartbeat = tokio::time::interval(heartbeat_interval);
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut last_forwarded_at = Instant::now();

        loop {
            tokio::select! {
                _ = heartbeat.tick() => {
                    if last_forwarded_at.elapsed() < heartbeat_interval {
                        continue;
                    }
                    if !send_sse_json_event(
                        &tx,
                        "heartbeat",
                        json!({
                            "alive": true,
                            "stage": "upstream_waiting",
                            "idle_seconds": last_forwarded_at.elapsed().as_secs(),
                        }),
                    )
                    .await
                    {
                        restore_and_cleanup().await;
                        return;
                    }
                    last_forwarded_at = Instant::now();
                }
                maybe_chunk = upstream_stream.next() => {
                    let Some(chunk) = maybe_chunk else {
                        break;
                    };
                    match chunk {
                        Ok(bytes) => {
                            if tx.send(Ok(bytes.clone())).await.is_err() {
                                restore_and_cleanup().await;
                                return;
                            }
                            last_forwarded_at = Instant::now();

                            frame_buffer.push_str(&String::from_utf8_lossy(&bytes));
                            while let Some((index, delimiter_len)) = find_sse_frame_boundary(&frame_buffer)
                            {
                                let frame = frame_buffer[..index].to_string();
                                frame_buffer = frame_buffer[index + delimiter_len..].to_string();

                                if let Some((event_name, data)) = parse_sse_event_frame(&frame) {
                                    if event_name == "chunk" || event_name == "message" {
                                        append_renderable_stream_text(&mut streamed_text, &data);
                                    }
                                    if event_name == "tool_result" {
                                        saw_tool_result = true;
                                    }
                                    if event_name == "error" {
                                        saw_upstream_error = true;
                                    }
                                    if event_name == "done" {
                                        saw_upstream_done = true;
                                        let (input_tokens, output_tokens) =
                                            extract_done_usage_tokens(&data);
                                        if input_tokens.is_some() {
                                            upstream_done_input_tokens = input_tokens;
                                        }
                                        if output_tokens.is_some() {
                                            upstream_done_output_tokens = output_tokens;
                                        }
                                        append_renderable_stream_text(&mut streamed_text, &data);
                                    }
                                }
                            }
                        }
                        Err(err) => {
                            let _ = send_sse_json_event(&tx, "error", json!({ "error": err.to_string() }))
                                .await;
                            restore_and_cleanup().await;
                            return;
                        }
                    }
                }
            }
        }

        let final_streamed_text = streamed_text.trim().to_string();
        if !final_streamed_text.is_empty() && !looks_like_protocol_only_text(&final_streamed_text) {
            emit_stream_agent_appearance_updated_event(
                &tx,
                &state_for_post_process,
                &public_agent_id,
                &agent_id,
                &final_streamed_text,
            )
            .await;
            sanitize_and_restore().await;
            return;
        }

        let recovered = match openfang.get_json(&session_path).await {
            Ok(session) => extract_new_assistant_text(&session, baseline_assistant_count),
            Err(_) => None,
        };

        if let Some(text) = recovered {
            if !text.trim().is_empty() {
                tracing::info!(agent_id = %agent_id, baseline_assistant_count = baseline_assistant_count, recovered_len = text.len(), "chat stream recovered final assistant text from session fallback");
                let _ = send_sse_json_event(
                    &tx,
                    "chunk",
                    json!({
                        "content": text,
                        "done": false,
                        "fallback": "session"
                    }),
                )
                .await;
                let _ = send_sse_json_event(
                    &tx,
                    "done",
                    json!({
                        "done": true,
                        "session_id": bound_session_id.clone(),
                        "session_label": bound_session_label.clone(),
                        "usage": {
                            "input_tokens": 0,
                            "output_tokens": 0
                        },
                        "fallback": "session"
                    }),
                )
                .await;
                emit_stream_agent_appearance_updated_event(
                    &tx,
                    &state_for_post_process,
                    &public_agent_id,
                    &agent_id,
                    &text,
                )
                .await;
                sanitize_and_restore().await;
                return;
            }
        }

        if saw_upstream_done
            && !saw_upstream_error
            && matches!(upstream_done_output_tokens, Some(0))
        {
            let fallback_text = if saw_tool_result {
                "本次请求在记忆召回或工具调用后提前结束，未生成正文回复，请重试。"
            } else {
                "本次请求已结束，但未生成正文回复，请重试。"
            };
            tracing::warn!(
                agent_id = %agent_id,
                input_tokens = upstream_done_input_tokens.unwrap_or(0),
                output_tokens = upstream_done_output_tokens.unwrap_or(0),
                saw_tool_result = saw_tool_result,
                "chat stream completed with zero output tokens and no renderable text; emitted fallback reply"
            );
            let _ = send_sse_json_event(
                &tx,
                "chunk",
                json!({
                    "content": fallback_text,
                    "done": false,
                    "fallback": "zero_output_done"
                }),
            )
            .await;
            let _ = send_sse_json_event(
                &tx,
                "done",
                json!({
                    "done": true,
                    "session_id": bound_session_id.clone(),
                    "session_label": bound_session_label.clone(),
                    "usage": {
                        "input_tokens": upstream_done_input_tokens.unwrap_or(0),
                        "output_tokens": upstream_done_output_tokens.unwrap_or(0)
                    },
                    "fallback": "zero_output_done"
                }),
            )
            .await;
            sanitize_and_restore().await;
            return;
        }

        if saw_tool_result {
            tracing::info!(
                agent_id = %agent_id,
                "chat stream finished with tool_result only; skipping empty-stream error"
            );
            sanitize_and_restore().await;
            return;
        }

        if saw_upstream_error {
            tracing::info!(
                agent_id = %agent_id,
                "chat stream finished with upstream error event; skipping empty-stream error"
            );
            sanitize_and_restore().await;
            return;
        }

        tracing::warn!(agent_id = %agent_id, streamed_text = %streamed_text, "chat stream ended without renderable final text");
        let _ = send_sse_json_event(
            &tx,
            "error",
            json!({
                "error": "后端流式通道未返回可展示内容。",
                "fallback": "empty_stream",
                "agent_id": agent_id,
                "message": message
            }),
        )
        .await;

        sanitize_and_restore().await;
    });

    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    });

    let body = Body::from_stream(stream);
    let response = axum::response::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("x-accel-buffering", "no")
        .body(body)
        .expect("valid sse response");
    Ok(response)
}

pub async fn list_a2a_agents(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let data = state.openfang.get_json("/a2a/agents").await?;
    Ok(Json(data))
}

fn read_nested_string(payload: &Value, path: &[&str]) -> Option<String> {
    let mut current = payload;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn pick_agent_id_from_payload(payload: &Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        if let Some(hit) = read_nested_string(payload, path) {
            return Some(hit);
        }
    }
    None
}

fn profile_collaboration_flag(
    profile: &assignment_store::AgentProfileOverrideRecord,
    key: &str,
) -> bool {
    profile
        .collaboration
        .as_ref()
        .and_then(|value| value.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn profile_has_tag(profile: &assignment_store::AgentProfileOverrideRecord, tag: &str) -> bool {
    let normalized = tag.to_ascii_lowercase();
    profile
        .tags
        .as_ref()
        .map(|tags| {
            tags.iter()
                .any(|item| item.trim().to_ascii_lowercase() == normalized)
        })
        .unwrap_or(false)
}

pub async fn send_a2a_task(
    State(state): State<Arc<AppState>>,
    Json(mut payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let caller_paths: &[&[&str]] = &[
        &["caller_agent_id"],
        &["callerAgentId"],
        &["params", "caller_agent_id"],
        &["params", "callerAgentId"],
        &["params", "metadata", "caller_agent_id"],
        &["params", "metadata", "callerAgentId"],
        &["metadata", "caller_agent_id"],
        &["metadata", "callerAgentId"],
    ];
    let callee_paths: &[&[&str]] = &[
        &["callee_agent_id"],
        &["calleeAgentId"],
        &["agent_id"],
        &["agentId"],
        &["params", "callee_agent_id"],
        &["params", "calleeAgentId"],
        &["params", "agent_id"],
        &["params", "agentId"],
        &["params", "metadata", "callee_agent_id"],
        &["params", "metadata", "calleeAgentId"],
        &["params", "metadata", "agent_id"],
        &["params", "metadata", "agentId"],
    ];
    let mut caller_agent_id = pick_agent_id_from_payload(&payload, caller_paths);
    let mut callee_agent_id = pick_agent_id_from_payload(&payload, callee_paths);

    let needs_alias = caller_agent_id
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID))
        .unwrap_or(false)
        || callee_agent_id
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID))
            .unwrap_or(false);
    if needs_alias {
        let resolved_nuwa = resolve_nuwa_agent_id(&state).await?;
        if caller_agent_id
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID))
            .unwrap_or(false)
        {
            caller_agent_id = Some(resolved_nuwa.clone());
        }
        if callee_agent_id
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(DEFAULT_NUWA_AGENT_ID))
            .unwrap_or(false)
        {
            callee_agent_id = Some(resolved_nuwa.clone());
        }
        replace_payload_agent_id(
            &mut payload,
            caller_paths,
            DEFAULT_NUWA_AGENT_ID,
            &resolved_nuwa,
        );
        replace_payload_agent_id(
            &mut payload,
            callee_paths,
            DEFAULT_NUWA_AGENT_ID,
            &resolved_nuwa,
        );
    }

    if let (Some(caller), Some(callee)) = (caller_agent_id.clone(), callee_agent_id.clone()) {
        if caller == callee {
            return Err(ApiError::new(StatusCode::FORBIDDEN, "不允许调度调用自身"));
        }

        let caller_profile =
            assignment_store::get_agent_profile_override(&caller).map_err(storage_error)?;
        let caller_dispatch_enabled = caller_profile
            .as_ref()
            .map(|profile| {
                profile_collaboration_flag(profile, "dispatchEnabled")
                    || profile_has_tag(profile, COLLAB_TAG_DISPATCHER)
            })
            .unwrap_or(false);
        if !caller_dispatch_enabled {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "调用者未开启调度能力，禁止发起委派",
            ));
        }

        let callee_profile =
            assignment_store::get_agent_profile_override(&callee).map_err(storage_error)?;
        let callee_discoverable = callee_profile
            .as_ref()
            .map(|profile| {
                profile_collaboration_flag(profile, "discoverable")
                    || profile_has_tag(profile, COLLAB_TAG_DISCOVERABLE)
            })
            .unwrap_or(false);
        if !callee_discoverable {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "被调用者未开启“被调度（被发现）”",
            ));
        }

        let acl_rows = assignment_store::list_agent_collaboration_acl(&caller, "private")
            .map_err(storage_error)?;
        let allowed = acl_rows
            .iter()
            .any(|row| row.enabled && row.callee_agent_id == callee);
        if !allowed {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "不在调用者白名单中，拒绝委派",
            ));
        }
    }

    let data = state.openfang.post_json("/a2a/tasks/send", payload).await?;
    Ok(Json(data))
}

pub async fn get_a2a_task(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let path = format!("/a2a/tasks/{id}");
    let data = state.openfang.get_json(&path).await?;
    Ok(Json(data))
}

pub async fn cancel_a2a_task(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let path = format!("/a2a/tasks/{id}/cancel");
    let data = state.openfang.post_json(&path, json!({})).await?;
    Ok(Json(data))
}

fn normalize_protocol(input: &str) -> Option<&'static str> {
    let normalized = input.trim().to_lowercase();
    match normalized.as_str() {
        "openai" | "openai-compatible" => Some("openai"),
        "claude" | "anthropic" => Some("claude"),
        _ => None,
    }
}

fn mask_api_key(api_key: &str) -> String {
    if api_key.len() <= 8 {
        return "****".to_string();
    }
    format!(
        "{}****{}",
        &api_key[..4],
        &api_key[api_key.len().saturating_sub(4)..]
    )
}

fn to_models_endpoint(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.ends_with("/v1") {
        return Some(format!("{trimmed}/models"));
    }
    Some(format!("{trimmed}/v1/models"))
}

fn provider_uses_manual_model_configuration(provider_id: &str, base_url: &str) -> bool {
    let normalized_provider = provider_id.trim().to_ascii_lowercase();
    if normalized_provider == "minimax" {
        return true;
    }
    let normalized_base_url = base_url.trim().to_ascii_lowercase();
    normalized_base_url.contains("api.minimaxi.com")
        || normalized_base_url.contains("api.minimax.io")
}

fn manual_model_configuration_message(provider_id: &str, configured_model_count: usize) -> String {
    let provider_label = match provider_id.trim().to_ascii_lowercase().as_str() {
        "minimax" => "MiniMax",
        _ => provider_id.trim(),
    };
    if configured_model_count > 0 {
        return format!(
            "{provider_label} 官方兼容接口不提供 `/v1/models` 自动探测，请以手动填写的模型列表为准（当前已配置 {configured_model_count} 个模型）。"
        );
    }
    format!(
        "{provider_label} 官方兼容接口不提供 `/v1/models` 自动探测，请手动填写模型列表后再使用。"
    )
}

fn parse_model_ids_from_payload(payload: &Value) -> Vec<String> {
    payload
        .get("data")
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row.get("id").and_then(|v| v.as_str()))
                .map(|id| id.trim().to_string())
                .filter(|id| !id.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

async fn discover_models_from_provider(
    provider_id: &str,
    protocol: &str,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let endpoint =
        to_models_endpoint(base_url).ok_or_else(|| "base_url 为空，无法探测模型".to_string())?;
    let mut header_candidates: Vec<HeaderMap> = Vec::new();

    let mut h1 = HeaderMap::new();
    h1.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
            .map_err(|e| format!("构造鉴权头失败: {e}"))?,
    );
    header_candidates.push(h1);

    if protocol == "claude" {
        let mut h2 = HeaderMap::new();
        h2.insert(
            HeaderName::from_static("x-api-key"),
            HeaderValue::from_str(api_key.trim())
                .map_err(|e| format!("构造 x-api-key 失败: {e}"))?,
        );
        h2.insert(
            HeaderName::from_static("anthropic-version"),
            HeaderValue::from_static("2023-06-01"),
        );
        header_candidates.push(h2);
    } else if provider_id == "nvidia-nim" || provider_id == "nvidia" {
        for key in ["x-api-key", "api-key", "nvidia-api-key"] {
            let mut h = HeaderMap::new();
            h.insert(
                HeaderName::from_bytes(key.as_bytes())
                    .map_err(|e| format!("构造请求头失败: {e}"))?,
                HeaderValue::from_str(api_key.trim())
                    .map_err(|e| format!("构造请求头失败: {e}"))?,
            );
            header_candidates.push(h);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let mut last_error = String::new();
    for headers in header_candidates {
        let response = client.get(&endpoint).headers(headers).send().await;
        match response {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_error = format!("HTTP {}", resp.status());
                    continue;
                }
                let payload = resp
                    .json::<Value>()
                    .await
                    .map_err(|e| format!("解析模型列表失败: {e}"))?;
                let models = parse_model_ids_from_payload(&payload);
                if !models.is_empty() {
                    return Ok(models);
                }
                last_error = "返回 data 为空".to_string();
            }
            Err(err) => {
                last_error = err.to_string();
            }
        }
    }
    Err(format!("自动探测模型失败: {}", last_error))
}

async fn probe_model_via_chat_completion(
    provider_id: &str,
    protocol: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<(), String> {
    let trimmed_base_url = base_url.trim().trim_end_matches('/');
    if trimmed_base_url.is_empty() {
        return Err("base_url 为空，无法测试模型".to_string());
    }
    let trimmed_model = model.trim();
    if trimmed_model.is_empty() {
        return Err("model 为空，无法测试模型".to_string());
    }

    let endpoint = format!("{trimmed_base_url}/chat/completions");
    let mut header_candidates: Vec<HeaderMap> = Vec::new();

    let mut bearer_headers = HeaderMap::new();
    bearer_headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
            .map_err(|e| format!("构造鉴权头失败: {e}"))?,
    );
    header_candidates.push(bearer_headers);

    if protocol == "claude" {
        let mut claude_headers = HeaderMap::new();
        claude_headers.insert(
            HeaderName::from_static("x-api-key"),
            HeaderValue::from_str(api_key.trim())
                .map_err(|e| format!("构造 x-api-key 失败: {e}"))?,
        );
        claude_headers.insert(
            HeaderName::from_static("anthropic-version"),
            HeaderValue::from_static("2023-06-01"),
        );
        header_candidates.push(claude_headers);
    } else if provider_id == "nvidia-nim" || provider_id == "nvidia" {
        for key in ["x-api-key", "api-key", "nvidia-api-key"] {
            let mut headers = HeaderMap::new();
            headers.insert(
                HeaderName::from_bytes(key.as_bytes())
                    .map_err(|e| format!("构造请求头失败: {e}"))?,
                HeaderValue::from_str(api_key.trim())
                    .map_err(|e| format!("构造请求头失败: {e}"))?,
            );
            header_candidates.push(headers);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let request_body = json!({
        "model": trimmed_model,
        "messages": [
            { "role": "user", "content": "Hi" }
        ],
        "max_tokens": 1,
        "temperature": 0.0,
        "stream": false
    });

    let mut last_error = String::new();
    for headers in header_candidates {
        match client
            .post(&endpoint)
            .headers(headers)
            .json(&request_body)
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() {
                    return Ok(());
                }
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                let body = body.trim();
                last_error = if body.is_empty() {
                    format!("HTTP {status}")
                } else {
                    let snippet: String = body.chars().take(200).collect();
                    format!("HTTP {status}: {}", snippet)
                };
            }
            Err(err) => {
                last_error = err.to_string();
            }
        }
    }

    Err(format!("模型连通性测试失败: {last_error}"))
}

async fn get_upstream_json_quick(state: &Arc<AppState>, path: &str) -> Option<Value> {
    let (cache, timeout_ms) = match path {
        "/api/providers" => (&state.provider_cache, 1_200u64),
        "/api/models" => (&state.model_cache, 1_200u64),
        _ => (&state.provider_cache, 1_200u64),
    };
    let has_cache = cache.read().await.is_some();
    let effective_timeout_ms = if has_cache {
        timeout_ms
    } else {
        timeout_ms.max(8_000u64)
    };

    match timeout(
        Duration::from_millis(effective_timeout_ms),
        state.openfang.get_json(path),
    )
    .await
    {
        Ok(Ok(data)) => {
            let mut guard = cache.write().await;
            *guard = Some(data.clone());
            Some(data)
        }
        _ => cache.read().await.clone(),
    }
}

fn extract_provider_ids_from_payload(payload: &Value) -> HashSet<String> {
    payload
        .get("providers")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row.get("id").and_then(Value::as_str))
                .map(assignment_store::normalize_provider_id)
                .filter(|value| !value.is_empty())
                .collect::<HashSet<String>>()
        })
        .unwrap_or_default()
}

async fn get_upstream_provider_ids_quick(state: &Arc<AppState>) -> HashSet<String> {
    get_upstream_json_quick(state, "/api/providers")
        .await
        .as_ref()
        .map(extract_provider_ids_from_payload)
        .unwrap_or_default()
}

pub async fn list_providers(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let provider_enabled = assignment_store::list_provider_enabled_map().map_err(storage_error)?;
    let provider_configs = assignment_store::list_provider_configs().map_err(storage_error)?;
    let config_map: HashMap<String, assignment_store::ProviderConfigRecord> = provider_configs
        .into_iter()
        .map(|item| (item.provider_id.clone(), item))
        .collect();

    let upstream = get_upstream_json_quick(&state, "/api/providers").await;
    let mut providers = upstream
        .as_ref()
        .and_then(|v| v.get("providers"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut seen = HashSet::new();
    let upstream_provider_ids = upstream
        .as_ref()
        .map(extract_provider_ids_from_payload)
        .unwrap_or_default();

    for row in &mut providers {
        let Some(obj) = row.as_object_mut() else {
            continue;
        };
        let provider_id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        if provider_id.is_empty() {
            continue;
        }
        seen.insert(provider_id.clone());
        if let Some(cfg) = config_map.get(&provider_id) {
            if let Some(display_name) = cfg.display_name.as_ref() {
                obj.insert("display_name".to_string(), json!(display_name));
            }
            if let Some(base_url) = cfg.base_url.as_ref() {
                obj.insert("base_url".to_string(), json!(base_url));
            }
            obj.insert("protocol".to_string(), json!(cfg.protocol));
            obj.insert("is_custom".to_string(), json!(false));
            if let Some(api_key) = cfg.api_key.as_ref() {
                if !api_key.trim().is_empty() {
                    obj.insert("auth_status".to_string(), json!("configured"));
                }
            }
            if !cfg.models.is_empty() {
                obj.insert("model_count".to_string(), json!(cfg.models.len()));
            }
        }
        let enabled = provider_enabled.get(&provider_id).copied().unwrap_or(true);
        let auth_status = obj
            .get("auth_status")
            .and_then(|v| v.as_str())
            .unwrap_or("missing")
            .to_lowercase();
        let has_key = config_map
            .get(&provider_id)
            .and_then(|cfg| cfg.api_key.as_ref())
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        let has_base_url = config_map
            .get(&provider_id)
            .and_then(|cfg| cfg.base_url.as_ref())
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        let configured = has_key
            || has_base_url
            || (!auth_status.contains("missing") && !auth_status.contains("none"));
        let runtime_loaded = upstream_provider_ids.contains(&provider_id);
        let model_discovered = obj
            .get("model_count")
            .and_then(Value::as_u64)
            .map(|value| value > 0)
            .unwrap_or(false);
        let healthy = enabled && configured && runtime_loaded && model_discovered;
        let linked = enabled && configured;
        let health_status = if !enabled {
            "disabled"
        } else if !configured {
            "incomplete"
        } else if !runtime_loaded {
            "configured"
        } else if !model_discovered {
            "no_models"
        } else {
            "healthy"
        };
        obj.insert("enabled".to_string(), json!(enabled));
        obj.insert("has_api_key".to_string(), json!(has_key));
        obj.insert("has_base_url".to_string(), json!(has_base_url));
        obj.insert("configured".to_string(), json!(configured));
        obj.insert("runtime_loaded".to_string(), json!(runtime_loaded));
        obj.insert("model_discovered".to_string(), json!(model_discovered));
        obj.insert("healthy".to_string(), json!(healthy));
        obj.insert("health_status".to_string(), json!(health_status));
        obj.insert("linked".to_string(), json!(linked));
        obj.insert("source".to_string(), json!("upstream"));
    }

    for cfg in config_map.values() {
        if seen.contains(&cfg.provider_id) {
            continue;
        }
        let enabled = provider_enabled
            .get(&cfg.provider_id)
            .copied()
            .unwrap_or(true);
        let has_key = cfg.api_key.as_deref().unwrap_or("").trim().len() > 0;
        let has_base_url = cfg.base_url.as_deref().unwrap_or("").trim().len() > 0;
        let configured = has_key || has_base_url;
        let runtime_loaded = upstream_provider_ids.contains(&cfg.provider_id);
        let model_discovered = !cfg.models.is_empty();
        let healthy = enabled && configured && runtime_loaded && model_discovered;
        let linked = enabled && configured;
        let health_status = if !enabled {
            "disabled"
        } else if !configured {
            "incomplete"
        } else if !runtime_loaded {
            "configured"
        } else if !model_discovered {
            "no_models"
        } else {
            "healthy"
        };
        providers.push(json!({
            "id": cfg.provider_id,
            "display_name": cfg.display_name.clone().unwrap_or_else(|| cfg.provider_id.clone()),
            "auth_status": if configured { "configured" } else { "missing" },
            "base_url": cfg.base_url.clone().unwrap_or_default(),
            "model_count": cfg.models.len(),
            "enabled": enabled,
            "linked": linked,
            "has_api_key": has_key,
            "has_base_url": has_base_url,
            "configured": configured,
            "runtime_loaded": runtime_loaded,
            "model_discovered": model_discovered,
            "healthy": healthy,
            "health_status": health_status,
            "source": if cfg.is_custom { "custom" } else { "local" },
            "is_custom": cfg.is_custom,
            "protocol": cfg.protocol
        }));
    }

    providers.sort_by(|a, b| {
        let an = a
            .get("display_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let bn = b
            .get("display_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        an.cmp(bn)
    });

    Ok(Json(json!({
        "providers": providers,
        "upstream": {
            "reachable": upstream.is_some()
        }
    })))
}

pub async fn list_models(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let provider_enabled = assignment_store::list_provider_enabled_map().map_err(storage_error)?;
    let model_enabled = assignment_store::list_model_enabled_map().map_err(storage_error)?;
    let default_model = assignment_store::get_default_model().map_err(storage_error)?;
    let provider_configs = assignment_store::list_provider_configs().map_err(storage_error)?;
    let config_map: HashMap<String, assignment_store::ProviderConfigRecord> = provider_configs
        .iter()
        .cloned()
        .map(|item| (item.provider_id.clone(), item))
        .collect();

    let upstream = get_upstream_json_quick(&state, "/api/models").await;
    let upstream_providers = get_upstream_json_quick(&state, "/api/providers").await;
    let mut upstream_auth_map = HashMap::new();
    if let Some(rows) = upstream_providers
        .as_ref()
        .and_then(|v| v.get("providers"))
        .and_then(|v| v.as_array())
    {
        for row in rows {
            let provider_id = row.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            if provider_id.is_empty() {
                continue;
            }
            let auth_status = row
                .get("auth_status")
                .and_then(|v| v.as_str())
                .unwrap_or("missing")
                .to_lowercase();
            let configured = !auth_status.contains("missing") && !auth_status.contains("none");
            upstream_auth_map.insert(provider_id.to_string(), configured);
        }
    }
    let upstream_provider_ids = upstream_providers
        .as_ref()
        .map(extract_provider_ids_from_payload)
        .unwrap_or_default();
    let upstream_provider_snapshot_ready =
        upstream_providers.is_some() && !upstream_provider_ids.is_empty();

    let provider_linked = |provider_id: &str| -> bool {
        let local_cfg = config_map.get(provider_id);
        let has_local_config = local_cfg.is_some();
        if upstream_provider_snapshot_ready
            && !has_local_config
            && !upstream_provider_ids.contains(provider_id)
        {
            return false;
        }
        let enabled = provider_enabled.get(provider_id).copied().unwrap_or(true);
        let upstream_configured = upstream_auth_map.get(provider_id).copied().unwrap_or(false);
        let local_key = local_cfg
            .and_then(|cfg| cfg.api_key.as_ref())
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        enabled && (upstream_configured || local_key)
    };

    let mut models = upstream
        .as_ref()
        .and_then(|v| v.get("models"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut synthetic_seen = HashSet::new();
    for cfg in provider_configs.iter() {
        if !provider_linked(&cfg.provider_id) {
            continue;
        }
        for model_name in &cfg.models {
            let model_name = model_name.trim().to_string();
            if model_name.is_empty() {
                continue;
            }
            if !is_probably_chat_model(&cfg.provider_id, &model_name) {
                continue;
            }
            let model_id = assignment_store::make_model_id(&cfg.provider_id, &model_name);
            if synthetic_seen.contains(&model_id) {
                continue;
            }
            synthetic_seen.insert(model_id.clone());
            models.push(json!({
                "id": model_id,
                "model": model_name,
                "provider": cfg.provider_id,
                "display_name": format!("{}/{}", cfg.display_name.clone().unwrap_or_else(|| cfg.provider_id.clone()), model_name),
                "available": true,
                "supports_tools": true,
                "supports_vision": false,
                "source": if cfg.is_custom { "custom" } else { "local" }
            }));
        }
    }

    let mut filtered_models = Vec::new();
    let mut seen_model_ids = HashSet::new();
    for mut row in models {
        let Some(obj) = row.as_object_mut() else {
            continue;
        };
        let raw_provider_id = obj
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let raw_model = obj
            .get("model")
            .and_then(Value::as_str)
            .or_else(|| obj.get("id").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string();
        let provider_id = raw_provider_id.trim().to_string();
        if provider_id.is_empty() || raw_model.is_empty() {
            continue;
        }
        if !provider_linked(&provider_id) {
            continue;
        }
        let model_id = assignment_store::make_model_id(&provider_id, &raw_model);
        if !seen_model_ids.insert(model_id.clone()) {
            continue;
        }
        obj.insert("id".to_string(), json!(model_id.clone()));
        obj.insert("provider".to_string(), json!(provider_id.clone()));
        obj.insert("model".to_string(), json!(raw_model.clone()));
        let display_name = obj
            .get("display_name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let provider_prefix = format!("{}/", provider_id);
        if display_name.is_empty()
            || display_name == model_id
            || display_name == raw_model
            || display_name
                .to_ascii_lowercase()
                .starts_with(&provider_prefix.to_ascii_lowercase())
        {
            obj.insert(
                "display_name".to_string(),
                json!(format!("{}/{}", provider_id, raw_model)),
            );
        }
        if !obj.contains_key("available") {
            obj.insert("available".to_string(), json!(true));
        }
        let provider_on = provider_enabled.get(&provider_id).copied().unwrap_or(true);
        let model_on = model_enabled.get(&model_id).copied().unwrap_or(false);
        let enabled = provider_on && model_on;
        let is_default = default_model.as_deref() == Some(model_id.as_str());
        obj.insert("enabled".to_string(), json!(enabled));
        obj.insert("is_default".to_string(), json!(is_default));
        filtered_models.push(row);
    }

    let default_model_visible = default_model.and_then(|default_id| {
        let visible = filtered_models.iter().any(|row| {
            row.get("id")
                .and_then(|v| v.as_str())
                .map(|id| id == default_id)
                .unwrap_or(false)
        });
        if visible {
            Some(default_id)
        } else {
            None
        }
    });
    let default_model_valid = default_model_visible.is_some();
    let default_model_reason = if default_model_valid {
        "ok"
    } else {
        "missing_or_unavailable"
    };

    Ok(Json(json!({
        "models": filtered_models,
        "default_model_id": default_model_visible,
        "default_model_valid": default_model_valid,
        "default_model_reason": default_model_reason,
        "upstream": {
            "reachable": upstream.is_some()
        }
    })))
}

#[derive(Deserialize)]
pub struct ModelTestRequest {
    pub provider: String,
    pub model: String,
    pub model_id: Option<String>,
}

pub async fn test_model_connection(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ModelTestRequest>,
) -> Result<Json<Value>, ApiError> {
    let provider_id = canonical_provider_id(&payload.provider);
    if provider_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "provider 不能为空",
        ));
    }
    let raw_model = payload.model.trim().to_string();
    if raw_model.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "model 不能为空",
        ));
    }

    let local_provider_config =
        assignment_store::get_provider_config(&provider_id).map_err(storage_error)?;
    if let Some(cfg) = local_provider_config {
        let protocol = normalize_protocol(&cfg.protocol).unwrap_or("openai");
        let Some(base_url) = cfg
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        else {
            return Ok(Json(json!({
                "ok": false,
                "status": "missing_base_url",
                "message": "未配置 Base URL，无法进行模型连通性测试"
            })));
        };
        let Some(api_key) = cfg
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        else {
            return Ok(Json(json!({
                "ok": false,
                "status": "missing_api_key",
                "message": "未配置 API Key，无法进行模型连通性测试"
            })));
        };

        if provider_uses_manual_model_configuration(&provider_id, base_url) {
            return match probe_model_via_chat_completion(
                &provider_id,
                protocol,
                base_url,
                api_key,
                &raw_model,
            )
            .await
            {
                Ok(()) => Ok(Json(json!({
                    "ok": true,
                    "status": "ok",
                    "message": "连接正常，模型通信可用"
                }))),
                Err(error) => Ok(Json(json!({
                    "ok": false,
                    "status": "connection_error",
                    "message": error
                }))),
            };
        }

        return match discover_models_from_provider(&provider_id, protocol, base_url, api_key).await
        {
            Ok(found_models) => {
                let matched = found_models
                    .iter()
                    .any(|item| item.trim().eq_ignore_ascii_case(raw_model.as_str()));
                if matched {
                    Ok(Json(json!({
                        "ok": true,
                        "status": "ok",
                        "message": "连接正常，模型通信可用"
                    })))
                } else {
                    Ok(Json(json!({
                        "ok": false,
                        "status": "model_not_found",
                        "message": format!("连接成功，但提供商返回的模型列表中未找到 `{}`", raw_model)
                    })))
                }
            }
            Err(error) => Ok(Json(json!({
                "ok": false,
                "status": "connection_error",
                "message": error
            }))),
        };
    }

    let runtime_online = probe_openfang_health(&state).await.is_ok();
    if !runtime_online {
        return Ok(Json(json!({
            "ok": false,
            "status": "runtime_offline",
            "message": "OpenFang 运行时离线，无法进行连接测试"
        })));
    }

    let models_payload = match state.openfang.get_json("/api/models").await {
        Ok(value) => value,
        Err(error) => {
            return Ok(Json(json!({
                "ok": false,
                "status": "runtime_error",
                "message": error.message
            })));
        }
    };
    let rows = models_payload
        .get("models")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let matched = rows.iter().any(|row| {
        let row_provider = row
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !row_provider.eq_ignore_ascii_case(&provider_id) {
            return false;
        }
        let row_model = row
            .get("model")
            .and_then(Value::as_str)
            .or_else(|| row.get("id").and_then(Value::as_str))
            .unwrap_or_default();
        row_model.trim().eq_ignore_ascii_case(raw_model.as_str())
    });

    if matched {
        Ok(Json(json!({
            "ok": true,
            "status": "ok",
            "message": "连接正常，模型通信可用"
        })))
    } else {
        Ok(Json(json!({
            "ok": false,
            "status": "model_not_found",
            "message": format!(
                "运行时未发现模型 `{}`（provider: `{}`）",
                raw_model,
                provider_id
            ),
            "model_id": payload.model_id
        })))
    }
}

#[derive(Deserialize)]
pub struct ProviderConnectionTestRequest {
    pub provider_id: String,
}

pub async fn test_provider_connection(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ProviderConnectionTestRequest>,
) -> Result<Json<Value>, ApiError> {
    let provider_id = canonical_provider_id(&payload.provider_id);
    if provider_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "provider id 不能为空",
        ));
    }

    let local_provider_config =
        assignment_store::get_provider_config(&provider_id).map_err(storage_error)?;
    if let Some(cfg) = local_provider_config {
        let protocol = normalize_protocol(&cfg.protocol).unwrap_or("openai");
        let has_base_url = cfg
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let has_api_key = cfg
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());

        if let (Some(base_url), Some(api_key)) = (has_base_url, has_api_key) {
            if provider_uses_manual_model_configuration(&provider_id, base_url) {
                return Ok(Json(json!({
                    "ok": false,
                    "status": "configured",
                    "message": manual_model_configuration_message(&provider_id, cfg.models.len()),
                    "model_count": cfg.models.len()
                })));
            }
            return match discover_models_from_provider(&provider_id, protocol, base_url, api_key)
                .await
            {
                Ok(models) => Ok(Json(json!({
                    "ok": true,
                    "status": "ok",
                    "message": if models.is_empty() {
                        "API 已连通".to_string()
                    } else {
                        format!("API 已连通，探测到 {} 个模型", models.len())
                    },
                    "model_count": models.len()
                }))),
                Err(error) => Ok(Json(json!({
                    "ok": false,
                    "status": "connection_error",
                    "message": error
                }))),
            };
        }
    }

    let upstream = get_upstream_json_quick(&state, "/api/providers").await;
    let matched = upstream
        .as_ref()
        .and_then(|value| value.get("providers"))
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter().find(|row| {
                row.get("id")
                    .and_then(Value::as_str)
                    .map(assignment_store::normalize_provider_id)
                    .map(|value| value == provider_id)
                    .unwrap_or(false)
            })
        });

    if let Some(row) = matched {
        let auth_status = row
            .get("auth_status")
            .and_then(Value::as_str)
            .unwrap_or("missing")
            .to_ascii_lowercase();
        let configured = !auth_status.contains("missing") && !auth_status.contains("none");
        if configured {
            let model_count = row.get("model_count").and_then(Value::as_u64).unwrap_or(0);
            return Ok(Json(json!({
                "ok": true,
                "status": "ok",
                "message": if model_count > 0 {
                    format!("运行时已加载，当前可见 {} 个模型", model_count)
                } else {
                    "运行时已加载，API 鉴权正常".to_string()
                },
                "model_count": model_count
            })));
        }
    }

    let record = assignment_store::get_provider_config(&provider_id).map_err(storage_error)?;
    let has_api_key = record
        .as_ref()
        .and_then(|cfg| cfg.api_key.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    let has_base_url = record
        .as_ref()
        .and_then(|cfg| cfg.base_url.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();

    Ok(Json(json!({
        "ok": false,
        "status": if has_api_key || has_base_url {
            "unverified"
        } else {
            "not_configured"
        },
        "message": if has_api_key || has_base_url {
            "已保存配置，但暂时无法确认 API 连通性"
        } else {
            "尚未配置可用的 API Key / Base URL"
        }
    })))
}

#[derive(Deserialize)]
pub struct UpdateProviderConfigRequest {
    pub display_name: Option<String>,
    pub protocol: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub clear_api_key: Option<bool>,
    pub models: Option<Vec<String>>,
    pub is_custom: Option<bool>,
}

#[derive(Deserialize)]
pub struct CreateCustomProviderRequest {
    pub id: String,
    pub display_name: String,
    pub protocol: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    pub enabled: Option<bool>,
}

pub async fn list_provider_configs(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let rows = assignment_store::list_provider_configs().map_err(storage_error)?;
    let payload: Vec<Value> = rows
        .into_iter()
        .map(|item| {
            json!({
                "provider_id": item.provider_id,
                "display_name": item.display_name,
                "protocol": item.protocol,
                "base_url": item.base_url,
                "has_api_key": item.api_key.as_deref().unwrap_or("").trim().len() > 0,
                "api_key_masked": item.api_key.as_deref().map(mask_api_key),
                "models": item.models,
                "is_custom": item.is_custom,
                "updated_at": item.updated_at
            })
        })
        .collect();
    Ok(Json(json!({ "providers": payload })))
}

async fn clear_runtime_agent_model_selection(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<(), ApiError> {
    let path = format!("/api/agents/{agent_id}/config");
    state
        .openfang
        .patch_json(
            &path,
            json!({
                "provider": "",
                "model": ""
            }),
        )
        .await?;

    let detail_path = format!("/api/agents/{agent_id}");
    let detail = state.openfang.get_json(&detail_path).await?;
    let provider = detail
        .pointer("/model/provider")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let model = detail
        .pointer("/model/model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    if !provider.is_empty() || !model.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            format!("清空智能体模型失败，当前仍为 {}/{}", provider, model),
        ));
    }
    Ok(())
}

async fn clear_runtime_agent_model_assignments_for_provider(
    state: &Arc<AppState>,
    provider_id: &str,
) -> Result<Vec<String>, ApiError> {
    ensure_online(state).await?;
    let payload = state.openfang.get_json("/api/agents").await?;
    let agent_rows = payload.as_array().cloned().unwrap_or_default();
    let mut cleared_agent_ids = Vec::new();

    for row in agent_rows {
        let Some(agent_id) = row.get("id").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        if agent_id.is_empty() {
            continue;
        }
        let detail_path = format!("/api/agents/{agent_id}");
        let detail = state.openfang.get_json(&detail_path).await?;
        let bound_provider = detail
            .pointer("/model/provider")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if !bound_provider.eq_ignore_ascii_case(provider_id) {
            continue;
        }
        clear_runtime_agent_model_selection(state, agent_id).await?;
        cleared_agent_ids.push(agent_id.to_string());
    }

    Ok(cleared_agent_ids)
}

pub async fn discover_provider_models(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let provider_id = canonical_provider_id(&id);
    if provider_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "provider id 不能为空",
        ));
    }

    let mut record = assignment_store::get_provider_config(&provider_id)
        .map_err(storage_error)?
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "供应商尚未保存配置，无法获取模型",
            )
        })?;
    let protocol = normalize_protocol(&record.protocol).unwrap_or("openai");
    let base_url = record
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "未配置 Base URL，无法获取模型",
            )
        })?;
    let api_key = record
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "未配置 API Key，无法获取模型",
            )
        })?;

    if provider_uses_manual_model_configuration(&provider_id, base_url) {
        return Ok(Json(json!({
            "ok": !record.models.is_empty(),
            "status": "manual_configuration_required",
            "message": manual_model_configuration_message(&provider_id, record.models.len()),
            "model_count": record.models.len(),
            "models": record.models
        })));
    }

    match discover_models_from_provider(&provider_id, protocol, base_url, api_key).await {
        Ok(found_models) => {
            if !found_models.is_empty() {
                record.models = found_models.clone();
                assignment_store::upsert_provider_config(&record).map_err(storage_error)?;
                let _ = sync_provider_configs_to_runtime(&state).await;
            }
            Ok(Json(json!({
                "ok": true,
                "status": "ok",
                "message": if found_models.is_empty() {
                    "已连接，但供应商未返回可用模型".to_string()
                } else {
                    format!("已获取 {} 个模型", found_models.len())
                },
                "model_count": found_models.len(),
                "models": found_models
            })))
        }
        Err(error) => Ok(Json(json!({
            "ok": false,
            "status": "connection_error",
            "message": error,
            "model_count": record.models.len(),
            "models": record.models
        }))),
    }
}

pub async fn create_custom_provider(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<CreateCustomProviderRequest>,
) -> Result<Json<Value>, ApiError> {
    let provider_id = canonical_provider_id(&payload.id);
    if provider_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "provider id 不能为空",
        ));
    }
    let protocol = normalize_protocol(&payload.protocol).ok_or_else(|| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "protocol 仅支持 openai/claude",
        )
    })?;
    let models = payload
        .models
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let base_url = payload
        .base_url
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty());
    let api_key = payload
        .api_key
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let record = assignment_store::ProviderConfigRecord {
        provider_id: provider_id.clone(),
        display_name: Some(payload.display_name.trim().to_string()),
        protocol: protocol.to_string(),
        base_url,
        api_key,
        models,
        is_custom: true,
        updated_at: "".to_string(),
    };
    assignment_store::upsert_provider_config(&record).map_err(storage_error)?;
    assignment_store::set_provider_enabled(&provider_id, payload.enabled.unwrap_or(true))
        .map_err(storage_error)?;
    let _ = sync_provider_configs_to_runtime(&_state).await;
    Ok(Json(json!({
        "status": "ok",
        "provider_id": provider_id,
        "model_count": record.models.len()
    })))
}

pub async fn update_provider_config(
    State(_state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateProviderConfigRequest>,
) -> Result<Json<Value>, ApiError> {
    let provider_id = canonical_provider_id(&id);
    if provider_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "provider id 不能为空",
        ));
    }

    let mut record = assignment_store::get_provider_config(&provider_id)
        .map_err(storage_error)?
        .unwrap_or(assignment_store::ProviderConfigRecord {
            provider_id: provider_id.clone(),
            display_name: None,
            protocol: "openai".to_string(),
            base_url: None,
            api_key: None,
            models: Vec::new(),
            is_custom: false,
            updated_at: "".to_string(),
        });

    if let Some(display_name) = payload.display_name {
        let display_name = display_name.trim().to_string();
        record.display_name = if display_name.is_empty() {
            None
        } else {
            Some(display_name)
        };
    }
    if let Some(protocol) = payload.protocol {
        record.protocol = normalize_protocol(&protocol)
            .ok_or_else(|| {
                ApiError::new(
                    axum::http::StatusCode::BAD_REQUEST,
                    "protocol 仅支持 openai/claude",
                )
            })?
            .to_string();
    }
    if let Some(base_url) = payload.base_url {
        let base_url = base_url.trim().trim_end_matches('/').to_string();
        record.base_url = if base_url.is_empty() {
            None
        } else {
            Some(base_url)
        };
    }
    if payload.clear_api_key.unwrap_or(false) {
        record.api_key = None;
    } else if let Some(api_key) = payload.api_key {
        let api_key = api_key.trim().to_string();
        if !api_key.is_empty() {
            record.api_key = Some(api_key);
        }
    }
    if let Some(models) = payload.models {
        record.models = models
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
    }
    if let Some(is_custom) = payload.is_custom {
        record.is_custom = is_custom;
    }

    assignment_store::upsert_provider_config(&record).map_err(storage_error)?;
    let _ = sync_provider_configs_to_runtime(&_state).await;
    Ok(Json(json!({
        "status": "ok",
        "provider_id": provider_id,
        "protocol": record.protocol,
        "has_api_key": record.api_key.as_deref().unwrap_or("").trim().len() > 0,
        "model_count": record.models.len()
    })))
}

pub async fn delete_provider_config(
    State(_state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let provider_id = canonical_provider_id(&id);
    if provider_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "provider id 不能为空",
        ));
    }

    let existing = assignment_store::get_provider_config(&provider_id)
        .map_err(storage_error)?
        .ok_or_else(|| ApiError::new(axum::http::StatusCode::NOT_FOUND, "供应商配置不存在"))?;
    let enabled = assignment_store::list_provider_enabled_map()
        .map_err(storage_error)?
        .get(&provider_id)
        .copied()
        .unwrap_or(true);
    if enabled {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "请先断开供应商，再执行删除",
        ));
    }

    let cleared_agent_ids =
        clear_runtime_agent_model_assignments_for_provider(&_state, &provider_id).await?;
    let removed_model_toggle_count =
        assignment_store::delete_model_toggles_by_provider(&provider_id).map_err(storage_error)?;
    assignment_store::delete_provider_toggle(&provider_id).map_err(storage_error)?;
    let current_default = assignment_store::get_default_model().map_err(storage_error)?;
    let default_cleared = current_default
        .as_deref()
        .and_then(|value| value.split_once("::"))
        .map(|(provider, _)| provider.eq_ignore_ascii_case(&provider_id))
        .unwrap_or(false);
    if default_cleared {
        assignment_store::clear_default_model().map_err(storage_error)?;
    }
    assignment_store::delete_provider_config(&provider_id).map_err(storage_error)?;
    let _ = sync_provider_configs_to_runtime(&_state).await;
    Ok(Json(json!({
        "status": "deleted",
        "provider_id": provider_id,
        "deleted_model_count": existing.models.len(),
        "removed_model_toggle_count": removed_model_toggle_count,
        "default_model_cleared": default_cleared,
        "cleared_agent_ids": cleared_agent_ids
    })))
}

#[derive(Deserialize)]
pub struct UpdateEnabledRequest {
    pub enabled: bool,
}

#[derive(Deserialize)]
pub struct UpdateModelVisionRequest {
    pub provider: String,
    pub model: String,
    pub supports_vision: bool,
}

pub async fn update_provider_enabled(
    State(_state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateEnabledRequest>,
) -> Result<Json<Value>, ApiError> {
    let provider_id = canonical_provider_id(&id);
    if provider_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "provider id 不能为空",
        ));
    }

    assignment_store::set_provider_enabled(&provider_id, payload.enabled).map_err(storage_error)?;
    let _ = sync_provider_configs_to_runtime(&_state).await;
    Ok(Json(json!({
        "status": "ok",
        "provider_id": provider_id,
        "enabled": payload.enabled
    })))
}

pub async fn update_model_enabled(
    State(_state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateEnabledRequest>,
) -> Result<Json<Value>, ApiError> {
    let model_id = canonical_model_id(&id);
    if model_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "model id 不能为空",
        ));
    }

    assignment_store::set_model_enabled(&model_id, payload.enabled).map_err(storage_error)?;

    if !payload.enabled {
        let current_default = assignment_store::get_default_model().map_err(storage_error)?;
        if current_default.as_deref() == Some(model_id.as_str()) {
            assignment_store::clear_default_model().map_err(storage_error)?;
        }
    }

    Ok(Json(json!({
        "status": "ok",
        "model_id": model_id,
        "enabled": payload.enabled
    })))
}

pub async fn update_model_vision(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateModelVisionRequest>,
) -> Result<Json<Value>, ApiError> {
    let model_id = canonical_model_id(&id);
    if model_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "model id 不能为空",
        ));
    }

    let provider_id = canonical_provider_id(&payload.provider);
    if provider_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "provider 不能为空",
        ));
    }

    let model_name = assignment_store::normalize_model_name(&payload.model);
    if model_name.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "model 不能为空",
        ));
    }

    let expected_model_id = assignment_store::make_model_id(&provider_id, &model_name);
    if model_id != expected_model_id {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!("模型标识不匹配，期望为 {expected_model_id}"),
        ));
    }

    ensure_runtime_model_available(&state, &provider_id, &model_name).await?;

    let encoded_model_name = urlencoding(&model_name);
    state
        .openfang
        .patch_json(
            &format!("/api/models/custom/{encoded_model_name}"),
            json!({
                "provider": provider_id,
                "supports_vision": payload.supports_vision
            }),
        )
        .await?;

    Ok(Json(json!({
        "status": "ok",
        "model_id": model_id,
        "provider": payload.provider,
        "model": model_name,
        "supports_vision": payload.supports_vision
    })))
}

pub async fn update_default_model(
    State(_state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let model_id = canonical_model_id(&id);
    if model_id.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "model id 不能为空",
        ));
    }

    let model_assignments = assignment_store::list_model_assignments().map_err(storage_error)?;
    let hit = model_assignments
        .iter()
        .find(|item| item.model_id == model_id)
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "默认模型不存在，请先配置并启用对应供应商/模型",
            )
        })?;
    if !hit.enabled {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "默认模型已被禁用，请先启用后再设置为默认模型",
        ));
    }
    let provider_enabled = assignment_store::list_provider_enabled_map().map_err(storage_error)?;
    if !provider_enabled
        .get(&hit.provider_id)
        .copied()
        .unwrap_or(true)
    {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "默认模型所属供应商已被禁用，请先启用供应商",
        ));
    }
    let provider_config = assignment_store::get_provider_config(&hit.provider_id)
        .map_err(storage_error)?
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "默认模型所属供应商不存在，请先重新配置供应商",
            )
        })?;
    let provider_ready = provider_config
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
        || provider_config
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some();
    if !provider_ready {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "默认模型所属供应商尚未完成配置，请先填写可用的 API Key 或 Base URL",
        ));
    }

    assignment_store::set_model_enabled(&model_id, true).map_err(storage_error)?;
    assignment_store::set_default_model(&model_id).map_err(storage_error)?;
    sync_provider_configs_to_runtime(&_state).await?;

    Ok(Json(json!({
        "status": "ok",
        "default_model_id": model_id
    })))
}

pub async fn compose_dashboard(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let (status_res, agents_res, workflows_res, skills_res, providers_res) = tokio::join!(
        state.openfang.get_json("/api/status"),
        state.openfang.get_json("/api/agents"),
        state.openfang.get_json("/api/workflows"),
        state.openfang.get_json("/api/skills"),
        state.openfang.get_json("/api/providers")
    );

    let mut errors = serde_json::Map::new();

    let status = unwrap_or_record("status", status_res, &mut errors);
    let agents = unwrap_or_record("agents", agents_res, &mut errors);
    let workflows = unwrap_or_record("workflows", workflows_res, &mut errors);
    let skills = unwrap_or_record("skills", skills_res, &mut errors);
    let providers = unwrap_or_record("providers", providers_res, &mut errors);

    let summary = json!({
        "agentCount": agents.as_array().map(|v| v.len()).unwrap_or(0),
        "workflowCount": workflows.as_array().map(|v| v.len()).unwrap_or(0),
        "skillCount": skills
            .get("skills")
            .and_then(|v| v.as_array())
            .map(|v| v.len())
            .or_else(|| skills.as_array().map(|v| v.len()))
            .unwrap_or(0),
        "providerCount": providers
            .get("providers")
            .and_then(|v| v.as_array())
            .map(|v| v.len())
            .unwrap_or(0)
    });

    let health = if errors.is_empty() { "ok" } else { "partial" };

    Ok(Json(json!({
        "status": health,
        "source": state.config.openfang_base_url,
        "summary": summary,
        "data": {
            "status": status,
            "agents": agents,
            "workflows": workflows,
            "skills": skills,
            "providers": providers
        },
        "errors": errors
    })))
}

pub async fn compose_tasks_overview(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ManagedTaskListQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    let mut params = Vec::new();
    if let Some(agent_id) = query
        .agent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        params.push(("agent_id".to_string(), agent_id.to_string()));
    }
    let payload = if params.is_empty() {
        state.openfang.get_json("/api/tasks").await?
    } else {
        state
            .openfang
            .get_json_with_query("/api/tasks", &params)
            .await?
    };
    Ok(Json(payload))
}

pub async fn compose_task_full(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_online(&state).await?;
    validate_task_path_segment(&id)?;
    let detail_path = format!("/api/tasks/{id}");
    let runs_path = format!("/api/tasks/{id}/runs");
    let events_path = format!("/api/tasks/{id}/events");
    let deliveries_path = format!("/api/tasks/{id}/deliveries");
    let attempts_path = format!("/api/tasks/{id}/delivery-attempts");
    let timeline_path = format!("/api/tasks/{id}/timeline");

    let (detail, runs, events, deliveries, attempts, timeline) = tokio::join!(
        state.openfang.get_json(&detail_path),
        state.openfang.get_json(&runs_path),
        state.openfang.get_json(&events_path),
        state.openfang.get_json(&deliveries_path),
        state.openfang.get_json(&attempts_path),
        state.openfang.get_json(&timeline_path),
    );

    let detail = detail?;
    let full = json!({
        "task": detail.clone(),
        "runs": runs?,
        "events": events?,
        "deliveries": deliveries?,
        "delivery_attempts": attempts?,
        "final_summary": detail.get("final_summary").cloned().unwrap_or(Value::Null),
        "timeline": timeline?,
        "capabilities": detail.get("capabilities").cloned().unwrap_or_else(|| json!({})),
        "delivery_stats": detail.get("delivery_stats").cloned().unwrap_or_else(|| json!({})),
    });
    Ok(Json(full))
}

async fn sync_agent_skill_assignments(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<Value, ApiError> {
    let skill_aliases = skill_name_alias_map()?;
    let desired = canonicalize_skill_names(
        assignment_store::list_agent_enabled_skills(agent_id).map_err(storage_error)?,
        &skill_aliases,
    );
    let known = canonicalize_skill_names(
        openfang_known_skill_names(state, agent_id).await?,
        &skill_aliases,
    );
    let known_set = known.iter().cloned().collect::<HashSet<_>>();
    let desired_runtime: Vec<String> = desired
        .iter()
        .filter(|name| known_set.contains(*name))
        .cloned()
        .collect();
    let skipped_local_only: Vec<String> = desired
        .iter()
        .filter(|name| !known_set.contains(*name))
        .cloned()
        .collect();
    let path = format!("/api/agents/{agent_id}/skills");
    let effective = state.openfang.get_json(&path).await?;

    if desired_runtime.is_empty() && !desired.is_empty() {
        let warning = if skipped_local_only.is_empty() {
            "OpenFang 当前语义下空 skills 等于 all，无法在运行时表达“全关闭”".to_string()
        } else {
            format!(
                "以下 skill 为 Webot 本地技能，已跳过 OpenFang 同步: {}",
                skipped_local_only.join(", ")
            )
        };
        return Ok(json!({
            "status": "ok",
            "agentId": agent_id,
            "desired": {
                "skills": desired,
                "runtime_skills": desired_runtime,
                "skipped_local_only": skipped_local_only
            },
            "effective": effective,
            "upstream": null,
            "warning": warning
        }));
    }

    let upstream = state
        .openfang
        .put_json(&path, json!({ "skills": desired_runtime }))
        .await?;

    let mut warnings = Vec::new();
    if desired_runtime.is_empty() {
        warnings
            .push("OpenFang 当前语义下空 skills 等于 all，无法在运行时表达“全关闭”".to_string());
    }
    if !skipped_local_only.is_empty() {
        warnings.push(format!(
            "以下 skill 为 Webot 本地技能，未同步到 OpenFang: {}",
            skipped_local_only.join(", ")
        ));
    }
    let warning = if warnings.is_empty() {
        None
    } else {
        Some(warnings.join("；"))
    };

    Ok(json!({
        "status": "ok",
        "agentId": agent_id,
        "desired": {
            "skills": desired,
            "runtime_skills": desired_runtime,
            "skipped_local_only": skipped_local_only
        },
        "effective": effective,
        "upstream": upstream,
        "warning": warning
    }))
}

fn string_names_from_value_array(values: &[Value]) -> Vec<String> {
    let mut names = Vec::new();
    for value in values {
        if let Some(raw) = value.as_str() {
            let name = raw.trim();
            if !name.is_empty() {
                names.push(name.to_string());
            }
            continue;
        }
        if let Some(raw) = value.get("name").and_then(Value::as_str) {
            let name = raw.trim();
            if !name.is_empty() {
                names.push(name.to_string());
            }
        }
    }
    names
}

fn extract_openfang_skill_names(payload: &Value) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(available) = payload.get("available").and_then(Value::as_array) {
        names.extend(string_names_from_value_array(available));
    }
    if let Some(skills) = payload.get("skills").and_then(Value::as_array) {
        names.extend(string_names_from_value_array(skills));
    }
    if let Some(items) = payload.as_array() {
        names.extend(string_names_from_value_array(items));
    }
    names.sort();
    names.dedup();
    names
}

fn enable_default_global_skills_for_agent(agent_id: &str) -> Result<Vec<String>, String> {
    let skills_root = assignment_store::skills_root()?;
    let mut enabled = Vec::new();

    for skill in DEFAULT_GLOBAL_SKILLS {
        let skill_name = skill.trim();
        if skill_name.is_empty() {
            continue;
        }
        if !skills_root.join(skill_name).is_dir() {
            continue;
        }

        assignment_store::set_agent_skill_enabled(agent_id, skill_name, true)?;
        enabled.push(skill_name.to_string());
    }

    Ok(enabled)
}

async fn openfang_known_skill_names(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<Vec<String>, ApiError> {
    let path = format!("/api/agents/{agent_id}/skills");
    let payload = state.openfang.get_json(&path).await?;
    let mut names = extract_openfang_skill_names(&payload);
    if names.is_empty() {
        let payload = state.openfang.get_json("/api/skills").await?;
        names = extract_openfang_skill_names(&payload);
    }
    Ok(names)
}

async fn sync_agent_mcp_assignments(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<Value, ApiError> {
    let binding = resolve_agent_workspace_binding(state, agent_id, None).await?;
    let workspace_server = binding.server_name.clone();
    let mut desired = strip_workspace_mcp_names(
        assignment_store::list_agent_enabled_mcp_servers(agent_id).map_err(storage_error)?,
    );
    desired.retain(|name| name != &workspace_server);
    desired.push(workspace_server);
    desired.sort();
    desired.dedup();
    let runtime_known = openfang_known_mcp_server_names(state, agent_id).await?;
    let runtime_known_set = runtime_known.iter().cloned().collect::<HashSet<_>>();
    let desired_runtime: Vec<String> = desired
        .iter()
        .filter(|name| runtime_known_set.contains(*name))
        .cloned()
        .collect();
    let skipped_local_only: Vec<String> = desired
        .iter()
        .filter(|name| !runtime_known_set.contains(*name))
        .cloned()
        .collect();
    let path = format!("/api/agents/{agent_id}/mcp_servers");
    let effective = state.openfang.get_json(&path).await?;

    if desired_runtime.is_empty() && !desired.is_empty() {
        let warning = if skipped_local_only.is_empty() {
            "OpenFang 当前语义下空 mcp_servers 等于 all，无法在运行时表达“全关闭”".to_string()
        } else {
            format!(
                "以下 MCP 服务在 OpenFang 运行时尚未就绪，已跳过同步: {}",
                skipped_local_only.join(", ")
            )
        };
        return Ok(json!({
            "status": "ok",
            "agentId": agent_id,
            "desired": {
                "mcp_servers": desired,
                "runtime_mcp_servers": desired_runtime,
                "skipped_local_only": skipped_local_only
            },
            "effective": effective,
            "upstream": null,
            "warning": warning
        }));
    }

    let upstream = state
        .openfang
        .put_json(&path, json!({ "mcp_servers": desired_runtime }))
        .await?;

    let mut warnings = Vec::new();
    if desired_runtime.is_empty() {
        warnings.push(
            "OpenFang 当前语义下空 mcp_servers 等于 all，无法在运行时表达“全关闭”".to_string(),
        );
    }
    if !skipped_local_only.is_empty() {
        warnings.push(format!(
            "以下 MCP 服务在 OpenFang 运行时尚未就绪，未同步: {}",
            skipped_local_only.join(", ")
        ));
    }
    let warning = if warnings.is_empty() {
        None
    } else {
        Some(warnings.join("；"))
    };

    Ok(json!({
        "status": "ok",
        "agentId": agent_id,
        "desired": {
            "mcp_servers": desired,
            "runtime_mcp_servers": desired_runtime,
            "skipped_local_only": skipped_local_only
        },
        "effective": effective,
        "upstream": upstream,
        "warning": warning
    }))
}

async fn known_mcp_server_names(_state: &Arc<AppState>) -> Result<Vec<String>, ApiError> {
    let stored = assignment_store::get_global_mcp_config().map_err(storage_error)?;
    let mut names = stored
        .as_ref()
        .map(|cfg| {
            extract_mcp_server_map(&cfg.config)
                .keys()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    names.retain(|name| !is_system_hidden_mcp_server(name));
    names.sort();
    names.dedup();
    Ok(names)
}

fn extract_openfang_mcp_server_names(payload: &Value) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(available) = payload.get("available").and_then(Value::as_array) {
        names.extend(string_names_from_value_array(available));
    }
    // /api/mcp/servers 返回 configured / connected；只取 connected，避免把“未连通”服务误判为可分配。
    if let Some(connected) = payload.get("connected").and_then(Value::as_array) {
        names.extend(string_names_from_value_array(connected));
    }
    names.retain(|name| !is_system_hidden_mcp_server(name));
    names.sort();
    names.dedup();
    names
}

async fn openfang_known_mcp_server_names(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<Vec<String>, ApiError> {
    let path = format!("/api/agents/{agent_id}/mcp_servers");
    let payload = state.openfang.get_json(&path).await?;
    let mut names = extract_openfang_mcp_server_names(&payload);
    if names.is_empty() {
        let payload = state.openfang.get_json("/api/mcp/servers").await?;
        names = extract_openfang_mcp_server_names(&payload);
    }
    Ok(names)
}

fn global_skill_name_groups() -> Result<(Vec<String>, Vec<String>), ApiError> {
    let mut custom_names = Vec::new();
    let mut component_names = Vec::new();
    let skills_root = assignment_store::skills_root().map_err(storage_error)?;
    if skills_root.exists() {
        let dirs = list_child_dirs(&skills_root)
            .map_err(|e| storage_error(format!("读取技能目录失败: {e}")))?;
        for folder_name in dirs {
            let trimmed = folder_name.trim();
            if trimmed.is_empty() {
                continue;
            }
            let skill_dir = skills_root.join(trimmed);
            let display_name = read_skill_name_from_dir(&skill_dir)
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| trimmed.to_string());
            if display_name.eq_ignore_ascii_case(DEFAULT_UI_SKILL_NAME) {
                continue;
            }
            if component_center::is_component_skill_dir(&skill_dir).unwrap_or(false) {
                component_names.push(display_name);
            } else {
                custom_names.push(display_name);
            }
        }
    }

    custom_names.sort();
    custom_names.dedup();
    component_names.sort();
    component_names.dedup();
    Ok((custom_names, component_names))
}

fn skill_name_alias_map() -> Result<HashMap<String, String>, ApiError> {
    let skills_root = assignment_store::skills_root().map_err(storage_error)?;
    let imported = assignment_store::list_imported_skills().map_err(storage_error)?;
    let mut aliases = HashMap::new();
    let mut folder_to_display = HashMap::new();

    if skills_root.exists() {
        let dirs = list_child_dirs(&skills_root)
            .map_err(|e| storage_error(format!("读取技能目录失败: {e}")))?;
        for folder_name in dirs {
            let trimmed = folder_name.trim();
            if trimmed.is_empty() {
                continue;
            }
            let skill_dir = skills_root.join(trimmed);
            let display_name = read_skill_name_from_dir(&skill_dir)
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| trimmed.to_string());
            folder_to_display.insert(trimmed.to_ascii_lowercase(), display_name.clone());
            aliases
                .entry(trimmed.to_ascii_lowercase())
                .or_insert_with(|| display_name.clone());
            aliases
                .entry(display_name.to_ascii_lowercase())
                .or_insert(display_name);
        }
    }

    for record in imported {
        let record_name = record.name.trim();
        if record_name.is_empty() {
            continue;
        }
        let canonical = skill_folder_name_from_record(&record)
            .and_then(|folder_name| {
                folder_to_display
                    .get(&folder_name.to_ascii_lowercase())
                    .cloned()
            })
            .unwrap_or_else(|| record_name.to_string());
        aliases
            .entry(record_name.to_ascii_lowercase())
            .or_insert_with(|| canonical.clone());
        if let Some(folder_name) = skill_folder_name_from_record(&record) {
            let trimmed = folder_name.trim();
            if !trimmed.is_empty() {
                aliases
                    .entry(trimmed.to_ascii_lowercase())
                    .or_insert(canonical);
            }
        }
    }

    Ok(aliases)
}

fn canonicalize_skill_name(name: &str, aliases: &HashMap<String, String>) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(
        aliases
            .get(&trimmed.to_ascii_lowercase())
            .cloned()
            .unwrap_or_else(|| trimmed.to_string()),
    )
}

fn canonicalize_skill_names(
    names: impl IntoIterator<Item = String>,
    aliases: &HashMap<String, String>,
) -> Vec<String> {
    let mut normalized = Vec::new();
    for name in names {
        if let Some(canonical) = canonicalize_skill_name(&name, aliases) {
            normalized.push(canonical);
        }
    }
    normalized.sort();
    normalized.dedup();
    normalized
}

fn unique_trimmed_names(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for name in names {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        normalized.push(trimmed.to_string());
    }
    normalized.sort();
    normalized.dedup();
    normalized
}

async fn sync_active_mcp_servers_to_runtime(state: &Arc<AppState>) -> Result<Value, ApiError> {
    ensure_online(state).await?;
    sync_active_mcp_servers_to_runtime_inner(state).await
}

async fn sync_active_mcp_servers_to_runtime_inner(
    state: &Arc<AppState>,
) -> Result<Value, ApiError> {
    let stored = assignment_store::get_global_mcp_config().map_err(storage_error)?;
    let mut all_map = stored
        .as_ref()
        .map(|cfg| extract_mcp_server_map(&cfg.config))
        .unwrap_or_default();
    let enabled = assignment_store::list_all_enabled_mcp_servers().map_err(storage_error)?;
    let enabled_set = enabled.into_iter().collect::<HashSet<_>>();

    all_map.retain(|name, _| enabled_set.contains(name));
    let workspace_map = collect_workspace_mcp_server_map(state).await?;
    for (server_name, entry) in workspace_map {
        all_map.insert(server_name, entry);
    }

    let payload = json!({
        "mcpServers": all_map
    });
    let applied = apply_mcp_config_to_openfang_file(&payload)?;
    let reload = trigger_openfang_reload(state).await?;
    Ok(json!({
        "applied": applied,
        "reload": reload
    }))
}

async fn is_service_online(state: &Arc<AppState>) -> bool {
    probe_openfang_health(state).await.is_ok()
}

fn extract_mcp_server_map(config: &Value) -> HashMap<String, Value> {
    let mut map = HashMap::new();
    let Some(root) = config.as_object() else {
        return map;
    };

    let container = if let Some(mcp_servers) = root.get("mcpServers").and_then(Value::as_object) {
        Some(mcp_servers)
    } else if let Some(servers) = root.get("servers").and_then(Value::as_object) {
        Some(servers)
    } else {
        let all_object_values = root.values().all(Value::is_object);
        if all_object_values {
            Some(root)
        } else {
            None
        }
    };

    if let Some(entries) = container {
        for (name, value) in entries {
            if name.trim().is_empty() || !value.is_object() {
                continue;
            }
            map.insert(name.trim().to_string(), value.clone());
        }
    }
    map
}

fn to_toml_i64(value: Option<u64>, fallback: u64) -> i64 {
    value.unwrap_or(fallback).try_into().unwrap_or(i64::MAX)
}

fn convert_mcp_entry_to_toml(name: &str, value: &Value) -> Option<toml::value::Table> {
    let entry_obj = value.as_object()?;
    let transport_obj = entry_obj
        .get("transport")
        .and_then(Value::as_object)
        .or_else(|| value.as_object())?;
    let transport_type = transport_obj
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| entry_obj.get("type").and_then(Value::as_str))
        .unwrap_or("stdio")
        .trim()
        .to_ascii_lowercase();

    let mut transport = toml::value::Table::new();
    match transport_type.as_str() {
        "stdio" => {
            let command = transport_obj
                .get("command")
                .or_else(|| entry_obj.get("command"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())?;
            let args = transport_obj
                .get("args")
                .or_else(|| entry_obj.get("args"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|item| item.as_str().map(|v| v.trim().to_string()))
                .filter(|v| !v.is_empty())
                .map(toml::Value::String)
                .collect::<Vec<_>>();
            let cwd = transport_obj
                .get("cwd")
                .or_else(|| entry_obj.get("cwd"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty());
            transport.insert("type".to_string(), toml::Value::String("stdio".to_string()));
            transport.insert(
                "command".to_string(),
                toml::Value::String(command.to_string()),
            );
            if !args.is_empty() {
                transport.insert("args".to_string(), toml::Value::Array(args));
            }
            if let Some(cwd) = cwd {
                transport.insert("cwd".to_string(), toml::Value::String(cwd.to_string()));
            }
        }
        "sse" | "streamablehttp" | "streamable_http" => {
            let url = transport_obj
                .get("url")
                .or_else(|| entry_obj.get("url"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())?;
            transport.insert("type".to_string(), toml::Value::String("sse".to_string()));
            transport.insert("url".to_string(), toml::Value::String(url.to_string()));
        }
        _ => return None,
    }

    let timeout = entry_obj
        .get("timeout_secs")
        .and_then(Value::as_u64)
        .or_else(|| entry_obj.get("timeout").and_then(Value::as_u64));

    let mut entry = toml::value::Table::new();
    entry.insert("name".to_string(), toml::Value::String(name.to_string()));
    entry.insert(
        "timeout_secs".to_string(),
        toml::Value::Integer(to_toml_i64(timeout, 30)),
    );
    entry.insert("transport".to_string(), toml::Value::Table(transport));
    Some(entry)
}

fn resolve_openfang_config_path() -> Result<PathBuf, ApiError> {
    path_resolver::openfang_config_path().map_err(storage_error)
}

fn canonical_provider_id(value: &str) -> String {
    assignment_store::normalize_provider_id(value)
}

fn canonical_model_id(value: &str) -> String {
    assignment_store::normalize_model_id(value)
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

#[derive(Clone)]
struct ChannelBindingCandidate {
    channel_type: String,
    agent_id: String,
    updated_at: String,
    config: Value,
}

fn parse_channel_binding_candidate(
    profile: &assignment_store::AgentProfileOverrideRecord,
) -> Option<ChannelBindingCandidate> {
    let binding = profile.channel_binding.as_ref()?;
    let object = binding.as_object()?;
    let channel_type = object
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_ascii_lowercase();
    let config = object
        .get("config")
        .and_then(Value::as_object)
        .map(|value| Value::Object(value.clone()))
        .unwrap_or_else(|| json!({}));
    Some(ChannelBindingCandidate {
        channel_type,
        agent_id: profile.agent_id.clone(),
        updated_at: profile.updated_at.clone(),
        config,
    })
}

fn select_latest_channel_bindings(
    profiles: &HashMap<String, assignment_store::AgentProfileOverrideRecord>,
) -> HashMap<String, ChannelBindingCandidate> {
    let mut output = HashMap::new();
    for profile in profiles.values() {
        let Some(candidate) = parse_channel_binding_candidate(profile) else {
            continue;
        };
        let entry = output
            .entry(candidate.channel_type.clone())
            .or_insert(candidate.clone());
        if candidate.updated_at > entry.updated_at
            || (candidate.updated_at == entry.updated_at && candidate.agent_id > entry.agent_id)
        {
            *entry = candidate;
        }
    }
    output
}

fn read_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn read_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(num)) => num.as_u64().or_else(|| {
            num.as_i64()
                .and_then(|v| if v >= 0 { Some(v as u64) } else { None })
        }),
        Some(Value::String(text)) => text.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn read_string_list(value: Option<&Value>) -> Vec<String> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut output = Vec::new();
    for item in items {
        match item {
            Value::String(text) => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    output.push(trimmed.to_string());
                }
            }
            Value::Number(num) => {
                if let Some(value) = num.as_i64() {
                    output.push(value.to_string());
                }
            }
            _ => {}
        }
    }
    output
}

fn read_u64_list(value: Option<&Value>) -> Vec<u64> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut output = Vec::new();
    for item in items {
        let parsed = match item {
            Value::Number(num) => num.as_u64().or_else(|| {
                num.as_i64()
                    .and_then(|v| if v >= 0 { Some(v as u64) } else { None })
            }),
            Value::String(text) => text.trim().parse::<u64>().ok(),
            _ => None,
        };
        if let Some(value) = parsed {
            output.push(value);
        }
    }
    output
}

fn qqbot_bridge_status_path() -> Option<PathBuf> {
    path_resolver::webot_home_dir()
        .ok()
        .map(|home| home.join("qqbot").join("bridge-status.json"))
}

fn read_qqbot_bridge_status() -> Option<Value> {
    let path = qqbot_bridge_status_path()?;
    if !path.is_file() {
        return None;
    }
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<Value>(&raw).ok()
}

fn env_has_value(name: &str) -> bool {
    env::var(name)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn read_channels_in_config() -> Result<HashSet<String>, ApiError> {
    let config_path = resolve_openfang_config_path()?;
    if !config_path.exists() {
        return Ok(HashSet::new());
    }
    let content = fs::read_to_string(&config_path)
        .map_err(|e| storage_error(format!("读取 OpenFang 配置失败: {e}")))?;
    let root = toml::from_str::<toml::value::Table>(&content).unwrap_or_default();
    let mut output = HashSet::new();
    if let Some(toml::Value::Table(channels)) = root.get("channels") {
        for key in channels.keys() {
            if !key.trim().is_empty() {
                output.insert(key.trim().to_string());
            }
        }
    }
    Ok(output)
}

fn validate_channel_binding_requirements(
    binding: &ChannelBindingCandidate,
) -> (Vec<String>, Vec<String>) {
    let mut missing = Vec::new();
    let mut missing_env = Vec::new();
    let config = binding.config.as_object();

    match binding.channel_type.as_str() {
        "telegram" => {
            let bot_token_env = read_string(config.and_then(|value| value.get("bot_token_env")));
            match bot_token_env {
                Some(name) => {
                    if !env_has_value(&name) {
                        missing_env.push(name);
                    }
                }
                None => missing.push("bot_token_env".to_string()),
            }
        }
        "discord" => {
            let bot_token_env = read_string(config.and_then(|value| value.get("bot_token_env")));
            match bot_token_env {
                Some(name) => {
                    if !env_has_value(&name) {
                        missing_env.push(name);
                    }
                }
                None => missing.push("bot_token_env".to_string()),
            }
        }
        "email" => {
            let imap_host = read_string(config.and_then(|value| value.get("imap_host")));
            let smtp_host = read_string(config.and_then(|value| value.get("smtp_host")));
            let username = read_string(config.and_then(|value| value.get("username")));
            let password_env = read_string(config.and_then(|value| value.get("password_env")));
            if imap_host.is_none() {
                missing.push("imap_host".to_string());
            }
            if smtp_host.is_none() {
                missing.push("smtp_host".to_string());
            }
            if username.is_none() {
                missing.push("username".to_string());
            }
            match password_env {
                Some(name) => {
                    if !env_has_value(&name) {
                        missing_env.push(name);
                    }
                }
                None => missing.push("password_env".to_string()),
            }
        }
        "feishu" => {
            let app_id = read_string(config.and_then(|value| value.get("app_id")));
            let app_secret_env = read_string(config.and_then(|value| value.get("app_secret_env")));
            if app_id.is_none() {
                missing.push("app_id".to_string());
            }
            match app_secret_env {
                Some(name) => {
                    if !env_has_value(&name) {
                        missing_env.push(name);
                    }
                }
                None => missing.push("app_secret_env".to_string()),
            }
        }
        "qqbot" => {
            let app_id = read_string(config.and_then(|value| value.get("app_id")))
                .or_else(|| read_string(config.and_then(|value| value.get("appId"))));
            let client_secret = read_string(config.and_then(|value| value.get("client_secret")))
                .or_else(|| read_string(config.and_then(|value| value.get("clientSecret"))));
            if app_id.is_none() {
                missing.push("app_id".to_string());
            }
            if client_secret.is_none() {
                missing.push("client_secret".to_string());
            }
        }
        _ => {}
    }

    (missing, missing_env)
}

fn to_toml_array_strings(values: &[String]) -> toml::Value {
    toml::Value::Array(
        values
            .iter()
            .map(|value| toml::Value::String(value.to_string()))
            .collect(),
    )
}

fn to_toml_array_ints(values: &[u64]) -> toml::Value {
    toml::Value::Array(
        values
            .iter()
            .map(|value| toml::Value::Integer((*value).try_into().unwrap_or(i64::MAX)))
            .collect(),
    )
}

fn channel_binding_to_toml(
    binding: &ChannelBindingCandidate,
    warnings: &mut Vec<String>,
) -> Option<toml::value::Table> {
    let config = binding.config.as_object()?;
    let default_agent =
        read_string(config.get("default_agent")).unwrap_or_else(|| binding.agent_id.clone());
    let mut table = toml::value::Table::new();
    table.insert(
        "default_agent".to_string(),
        toml::Value::String(default_agent),
    );

    match binding.channel_type.as_str() {
        "telegram" => {
            let bot_token_env = read_string(config.get("bot_token_env"))
                .unwrap_or_else(|| "TELEGRAM_BOT_TOKEN".to_string());
            let allowed_users = read_u64_list(config.get("allowed_users"));
            let poll_interval_secs = read_u64(config.get("poll_interval_secs")).unwrap_or(1);
            table.insert(
                "bot_token_env".to_string(),
                toml::Value::String(bot_token_env),
            );
            table.insert(
                "allowed_users".to_string(),
                to_toml_array_ints(&allowed_users),
            );
            table.insert(
                "poll_interval_secs".to_string(),
                toml::Value::Integer(to_toml_i64(Some(poll_interval_secs), 1)),
            );
            Some(table)
        }
        "discord" => {
            let bot_token_env = read_string(config.get("bot_token_env"))
                .unwrap_or_else(|| "DISCORD_BOT_TOKEN".to_string());
            let allowed_guilds = read_u64_list(config.get("allowed_guilds"));
            let intents = read_u64(config.get("intents")).unwrap_or(33280);
            table.insert(
                "bot_token_env".to_string(),
                toml::Value::String(bot_token_env),
            );
            table.insert(
                "allowed_guilds".to_string(),
                to_toml_array_ints(&allowed_guilds),
            );
            table.insert(
                "intents".to_string(),
                toml::Value::Integer(to_toml_i64(Some(intents), 33280)),
            );
            Some(table)
        }
        "email" => {
            let imap_host = read_string(config.get("imap_host")).unwrap_or_default();
            let smtp_host = read_string(config.get("smtp_host")).unwrap_or_default();
            let username = read_string(config.get("username")).unwrap_or_default();
            if imap_host.is_empty() || smtp_host.is_empty() || username.is_empty() {
                warnings.push(format!(
                    "Email 渠道({}) 配置不完整，请检查 IMAP/SMTP/用户名",
                    binding.agent_id
                ));
            }
            let imap_port = read_u64(config.get("imap_port")).unwrap_or(993);
            let smtp_port = read_u64(config.get("smtp_port")).unwrap_or(587);
            let password_env = read_string(config.get("password_env"))
                .unwrap_or_else(|| "EMAIL_PASSWORD".to_string());
            let poll_interval_secs = read_u64(config.get("poll_interval_secs")).unwrap_or(30);
            let mut folders = read_string_list(config.get("folders"));
            if folders.is_empty() {
                folders.push("INBOX".to_string());
            }
            let allowed_senders = read_string_list(config.get("allowed_senders"));
            table.insert("imap_host".to_string(), toml::Value::String(imap_host));
            table.insert(
                "imap_port".to_string(),
                toml::Value::Integer(to_toml_i64(Some(imap_port), 993)),
            );
            table.insert("smtp_host".to_string(), toml::Value::String(smtp_host));
            table.insert(
                "smtp_port".to_string(),
                toml::Value::Integer(to_toml_i64(Some(smtp_port), 587)),
            );
            table.insert("username".to_string(), toml::Value::String(username));
            table.insert(
                "password_env".to_string(),
                toml::Value::String(password_env),
            );
            table.insert(
                "poll_interval_secs".to_string(),
                toml::Value::Integer(to_toml_i64(Some(poll_interval_secs), 30)),
            );
            table.insert("folders".to_string(), to_toml_array_strings(&folders));
            table.insert(
                "allowed_senders".to_string(),
                to_toml_array_strings(&allowed_senders),
            );
            Some(table)
        }
        "feishu" => {
            let app_id = read_string(config.get("app_id")).unwrap_or_default();
            if app_id.is_empty() {
                warnings.push(format!("飞书渠道({}) 缺少 App ID", binding.agent_id));
            }
            let app_secret_env = read_string(config.get("app_secret_env"))
                .unwrap_or_else(|| "FEISHU_APP_SECRET".to_string());
            let webhook_port = read_u64(config.get("webhook_port")).unwrap_or(8453);
            table.insert("app_id".to_string(), toml::Value::String(app_id));
            table.insert(
                "app_secret_env".to_string(),
                toml::Value::String(app_secret_env),
            );
            table.insert(
                "webhook_port".to_string(),
                toml::Value::Integer(to_toml_i64(Some(webhook_port), 8453)),
            );
            Some(table)
        }
        "qqbot" => {
            let app_id = read_string(config.get("app_id"))
                .or_else(|| read_string(config.get("appId")))
                .unwrap_or_default();
            let client_secret = read_string(config.get("client_secret"))
                .or_else(|| read_string(config.get("clientSecret")))
                .unwrap_or_default();
            let default_agent = read_string(config.get("default_agent"))
                .or_else(|| read_string(config.get("defaultAgent")));
            if app_id.is_empty() || client_secret.is_empty() {
                warnings.push(format!(
                    "QQ 渠道({}) 缺少 AppID / AppSecret",
                    binding.agent_id
                ));
            }
            table.insert("appId".to_string(), toml::Value::String(app_id));
            table.insert(
                "clientSecret".to_string(),
                toml::Value::String(client_secret),
            );
            if let Some(agent_id) = default_agent {
                table.insert("default_agent".to_string(), toml::Value::String(agent_id));
            }
            Some(table)
        }
        _ => None,
    }
}

pub async fn sync_channel_bindings_to_runtime(state: &Arc<AppState>) -> Result<Value, ApiError> {
    ensure_online(state).await?;
    let profiles = assignment_store::list_agent_profile_overrides().map_err(storage_error)?;
    let selected = select_latest_channel_bindings(&profiles);

    let config_path = resolve_openfang_config_path()?;
    let mut root: toml::value::Table = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| storage_error(format!("读取 OpenFang 配置失败: {e}")))?;
        toml::from_str::<toml::value::Table>(&content).unwrap_or_default()
    } else {
        toml::value::Table::new()
    };

    let channels_value = root
        .entry("channels".to_string())
        .or_insert_with(|| toml::Value::Table(toml::value::Table::new()));
    let channels = channels_value
        .as_table_mut()
        .ok_or_else(|| storage_error("OpenFang channels 配置格式异常"))?;

    let mut warnings = Vec::new();
    let mut applied = Vec::new();
    for channel_type in ["telegram", "discord", "email", "feishu", "qqbot"] {
        if let Some(binding) = selected.get(channel_type) {
            if let Some(table) = channel_binding_to_toml(binding, &mut warnings) {
                channels.insert(channel_type.to_string(), toml::Value::Table(table));
                applied.push(channel_type.to_string());
            }
        } else {
            channels.remove(channel_type);
        }
    }

    let output = toml::to_string_pretty(&root)
        .map_err(|e| storage_error(format!("序列化 OpenFang 配置失败: {e}")))?;
    fs::write(&config_path, output)
        .map_err(|e| storage_error(format!("写入 OpenFang 配置失败: {e}")))?;

    let reload = trigger_openfang_reload(state).await?;
    Ok(json!({
        "config_path": config_path.to_string_lossy().to_string(),
        "applied_channels": applied,
        "warnings": warnings,
        "reload": reload
    }))
}

#[derive(Deserialize)]
pub struct ChannelTestRequest {
    channel: String,
}

#[derive(Deserialize)]
pub struct ChannelNotifyRequest {
    agent_id: Option<String>,
    preferred_channel: Option<String>,
    target: Option<String>,
    title: String,
    message: String,
    tag: Option<String>,
    level: Option<String>,
}

pub async fn get_channel_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, ApiError> {
    let runtime_online = probe_openfang_health(&state).await.is_ok();
    let profiles = assignment_store::list_agent_profile_overrides().map_err(storage_error)?;
    let selected = select_latest_channel_bindings(&profiles);
    let applied_channels = read_channels_in_config()?;
    let qqbot_bridge_status = read_qqbot_bridge_status();

    let mut results = Vec::new();
    for channel_type in ["telegram", "discord", "email", "feishu", "qqbot"] {
        let binding = selected.get(channel_type);
        let (configured, missing, missing_env, source_agent) = if let Some(binding) = binding {
            let (missing, missing_env) = validate_channel_binding_requirements(binding);
            (
                missing.is_empty(),
                missing,
                missing_env,
                Some(binding.agent_id.clone()),
            )
        } else {
            (false, Vec::new(), Vec::new(), None)
        };
        let applied = applied_channels.contains(channel_type);
        let secrets_ready = missing_env.is_empty();

        let status = if !configured {
            "unconfigured"
        } else if !secrets_ready {
            "missing_env"
        } else if !applied {
            "not_applied"
        } else if !runtime_online {
            "runtime_offline"
        } else {
            "ok"
        };

        let mut entry = json!({
            "type": channel_type,
            "configured": configured,
            "secrets_ready": secrets_ready,
            "applied": applied,
            "runtime_online": runtime_online,
            "missing": missing,
            "missing_env": missing_env,
            "source_agent": source_agent,
            "status": status
        });
        if channel_type == "qqbot" {
            if let Some(status_value) = qqbot_bridge_status.as_ref() {
                if let Some(object) = entry.as_object_mut() {
                    object.insert(
                        "bridge_connected".to_string(),
                        status_value
                            .get("connected")
                            .cloned()
                            .unwrap_or(Value::Bool(false)),
                    );
                    if let Some(last_event) = status_value.get("last_event_at") {
                        object.insert("bridge_last_event_at".to_string(), last_event.clone());
                    }
                    if let Some(last_error) = status_value.get("last_error") {
                        object.insert("bridge_last_error".to_string(), last_error.clone());
                    }
                }
            }
        }
        results.push(entry);
    }

    Ok(Json(json!({
        "runtime_online": runtime_online,
        "channels": results
    })))
}

pub async fn test_channel_connection(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ChannelTestRequest>,
) -> Result<Json<Value>, ApiError> {
    let channel = payload.channel.trim().to_ascii_lowercase();
    if channel.is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "channel 不能为空",
        ));
    }

    let profiles = assignment_store::list_agent_profile_overrides().map_err(storage_error)?;
    let selected = select_latest_channel_bindings(&profiles);
    let Some(binding) = selected.get(channel.as_str()) else {
        return Ok(Json(json!({
            "ok": false,
            "status": "unconfigured",
            "message": "未找到该渠道绑定配置"
        })));
    };

    let (missing, missing_env) = validate_channel_binding_requirements(binding);
    if !missing.is_empty() {
        return Ok(Json(json!({
            "ok": false,
            "status": "missing_fields",
            "message": format!("缺少必要字段: {}", missing.join(", ")),
            "missing": missing
        })));
    }
    if !missing_env.is_empty() {
        return Ok(Json(json!({
            "ok": false,
            "status": "missing_env",
            "message": format!("缺少环境变量: {}", missing_env.join(", ")),
            "missing_env": missing_env
        })));
    }

    let applied_channels = read_channels_in_config()?;
    if !applied_channels.contains(channel.as_str()) {
        return Ok(Json(json!({
            "ok": false,
            "status": "not_applied",
            "message": "尚未写入 OpenFang 配置，请先保存并等待配置同步"
        })));
    }

    if channel == "qqbot" {
        let bridge = read_qqbot_bridge_status();
        let bridge_connected = bridge
            .as_ref()
            .and_then(|value| value.get("connected"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !bridge_connected {
            return Ok(Json(json!({
                "ok": false,
                "status": "bridge_offline",
                "message": "QQ 桥接未连接（请启动 qqbot-bridge 并等待连接成功）"
            })));
        }
    }

    let runtime_online = probe_openfang_health(&state).await.is_ok();
    if !runtime_online {
        return Ok(Json(json!({
            "ok": false,
            "status": "runtime_offline",
            "message": "OpenFang 运行时离线，无法进行连接测试"
        })));
    }

    Ok(Json(json!({
        "ok": true,
        "status": "ok",
        "message": "配置完整且运行时在线（仅校验配置与运行时状态）"
    })))
}

fn normalize_channel_name(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("system"))
        .map(|value| value.to_ascii_lowercase())
}

fn split_notification_targets(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    raw.split(|ch| matches!(ch, ',' | ';' | '\n' | '\r' | '|' | '，' | '；'))
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("system"))
        .map(ToString::to_string)
        .collect()
}

fn resolve_channel_binding_for_notification(
    agent_id: Option<&str>,
    preferred_channel: Option<&str>,
) -> Result<Option<ChannelBindingCandidate>, ApiError> {
    let preferred = normalize_channel_name(preferred_channel);
    if let Some(agent_id) = agent_id.map(str::trim).filter(|value| !value.is_empty()) {
        let profile =
            assignment_store::get_agent_profile_override(agent_id).map_err(storage_error)?;
        if let Some(profile) = profile {
            if let Some(candidate) = parse_channel_binding_candidate(&profile) {
                if preferred
                    .as_deref()
                    .map(|channel| channel == candidate.channel_type)
                    .unwrap_or(true)
                {
                    return Ok(Some(candidate));
                }
            }
        }
    }

    let Some(channel) = preferred else {
        return Ok(None);
    };
    let profiles = assignment_store::list_agent_profile_overrides().map_err(storage_error)?;
    Ok(select_latest_channel_bindings(&profiles)
        .get(channel.as_str())
        .cloned())
}

fn resolve_notification_targets(
    binding: &ChannelBindingCandidate,
    explicit_target: Option<&str>,
) -> Vec<String> {
    let explicit = split_notification_targets(explicit_target);
    if !explicit.is_empty() {
        return explicit;
    }
    let config = binding.config.as_object();
    match binding.channel_type.as_str() {
        "telegram" => read_string_list(config.and_then(|value| value.get("allowed_users"))),
        "qqbot" | "whatsapp" => {
            let mut targets =
                read_string_list(config.and_then(|value| value.get("default_targets")));
            if targets.is_empty() {
                if let Some(target) =
                    read_string(config.and_then(|value| value.get("default_target")))
                {
                    targets = split_notification_targets(Some(target.as_str()));
                }
            }
            if targets.is_empty() {
                if let Some(target) = read_string(config.and_then(|value| value.get("to"))) {
                    targets = split_notification_targets(Some(target.as_str()));
                }
            }
            targets
        }
        _ => Vec::new(),
    }
}

fn notification_text(title: &str, message: &str, level: Option<&str>) -> String {
    let level_label = match level
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "error" => "失败",
        "success" => "完成",
        "warning" => "告警",
        _ => "通知",
    };
    format!("【{}】{}\n\n{}", level_label, title.trim(), message.trim())
}

async fn send_telegram_notification(
    binding: &ChannelBindingCandidate,
    targets: &[String],
    text: &str,
) -> Result<Vec<String>, String> {
    let config = binding
        .config
        .as_object()
        .ok_or_else(|| "Telegram 渠道配置格式异常".to_string())?;
    let token_env = read_string(config.get("bot_token_env"))
        .ok_or_else(|| "Telegram 渠道缺少 bot_token_env".to_string())?;
    let token = env::var(&token_env)
        .map_err(|_| format!("缺少环境变量: {token_env}"))?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err(format!("环境变量 {token_env} 为空"));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("初始化 Telegram 客户端失败: {e}"))?;
    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    let mut delivered = Vec::new();
    let mut failures = Vec::new();
    for target in targets {
        match client
            .post(&url)
            .json(&json!({
                "chat_id": target,
                "text": text,
                "disable_web_page_preview": true,
            }))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                delivered.push(target.clone());
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                failures.push(format!("{target}: HTTP {status} {}", body.trim()));
            }
            Err(error) => {
                failures.push(format!("{target}: {error}"));
            }
        }
    }

    if delivered.is_empty() {
        return Err(failures.join("；"));
    }
    if !failures.is_empty() {
        tracing::warn!(
            channel = "telegram",
            agent_id = %binding.agent_id,
            failed_targets = %failures.join("；"),
            "channel notify partially failed"
        );
    }
    Ok(delivered)
}

async fn send_discord_notification(
    binding: &ChannelBindingCandidate,
    targets: &[String],
    text: &str,
) -> Result<Vec<String>, String> {
    let config = binding
        .config
        .as_object()
        .ok_or_else(|| "Discord 渠道配置格式异常".to_string())?;
    let token_env = read_string(config.get("bot_token_env"))
        .ok_or_else(|| "Discord 渠道缺少 bot_token_env".to_string())?;
    let token = env::var(&token_env)
        .map_err(|_| format!("缺少环境变量: {token_env}"))?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err(format!("环境变量 {token_env} 为空"));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("初始化 Discord 客户端失败: {e}"))?;
    let mut delivered = Vec::new();
    let mut failures = Vec::new();
    for target in targets {
        let url = format!("https://discord.com/api/v10/channels/{target}/messages");
        match client
            .post(&url)
            .header(AUTHORIZATION, format!("Bot {token}"))
            .json(&json!({
                "content": text.chars().take(1_900).collect::<String>(),
            }))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                delivered.push(target.clone());
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                failures.push(format!("{target}: HTTP {status} {}", body.trim()));
            }
            Err(error) => {
                failures.push(format!("{target}: {error}"));
            }
        }
    }

    if delivered.is_empty() {
        return Err(failures.join("；"));
    }
    if !failures.is_empty() {
        tracing::warn!(
            channel = "discord",
            agent_id = %binding.agent_id,
            failed_targets = %failures.join("；"),
            "channel notify partially failed"
        );
    }
    Ok(delivered)
}

async fn fetch_feishu_tenant_access_token(
    app_id: &str,
    app_secret: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("初始化飞书客户端失败: {e}"))?;
    let response = client
        .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
        .json(&json!({
            "app_id": app_id,
            "app_secret": app_secret,
        }))
        .send()
        .await
        .map_err(|e| format!("获取飞书 tenant_access_token 失败: {e}"))?;

    let status = response.status();
    let payload = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("飞书鉴权失败: HTTP {status} {payload}"));
    }
    let data = serde_json::from_str::<Value>(&payload)
        .map_err(|e| format!("飞书鉴权返回解析失败: {e}; body={payload}"))?;
    data.get("tenant_access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "飞书鉴权未返回 tenant_access_token".to_string())
}

fn parse_feishu_target(raw: &str) -> (String, String) {
    let trimmed = raw.trim();
    if let Some((target_type, target_id)) = trimmed.split_once(':') {
        let normalized_type = match target_type.trim().to_ascii_lowercase().as_str() {
            "open_id" | "user_id" | "union_id" | "email" | "chat_id" => {
                target_type.trim().to_ascii_lowercase()
            }
            _ => "chat_id".to_string(),
        };
        return (normalized_type, target_id.trim().to_string());
    }
    ("chat_id".to_string(), trimmed.to_string())
}

async fn send_feishu_notification(
    binding: &ChannelBindingCandidate,
    targets: &[String],
    text: &str,
) -> Result<Vec<String>, String> {
    let config = binding
        .config
        .as_object()
        .ok_or_else(|| "飞书渠道配置格式异常".to_string())?;
    let app_id =
        read_string(config.get("app_id")).ok_or_else(|| "飞书渠道缺少 app_id".to_string())?;
    let app_secret_env = read_string(config.get("app_secret_env"))
        .ok_or_else(|| "飞书渠道缺少 app_secret_env".to_string())?;
    let app_secret = env::var(&app_secret_env)
        .map_err(|_| format!("缺少环境变量: {app_secret_env}"))?
        .trim()
        .to_string();
    if app_secret.is_empty() {
        return Err(format!("环境变量 {app_secret_env} 为空"));
    }
    let access_token = fetch_feishu_tenant_access_token(&app_id, &app_secret).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("初始化飞书消息客户端失败: {e}"))?;

    let mut delivered = Vec::new();
    let mut failures = Vec::new();
    for target in targets {
        let (receive_id_type, receive_id) = parse_feishu_target(target);
        if receive_id.is_empty() {
            failures.push("empty_target".to_string());
            continue;
        }
        let url = format!(
            "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={receive_id_type}"
        );
        let body = json!({
            "receive_id": receive_id,
            "msg_type": "text",
            "content": json!({ "text": text }).to_string(),
        });
        match client
            .post(&url)
            .bearer_auth(&access_token)
            .json(&body)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                delivered.push(target.clone());
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                failures.push(format!("{target}: HTTP {status} {}", body.trim()));
            }
            Err(error) => {
                failures.push(format!("{target}: {error}"));
            }
        }
    }

    if delivered.is_empty() {
        return Err(failures.join("；"));
    }
    if !failures.is_empty() {
        tracing::warn!(
            channel = "feishu",
            agent_id = %binding.agent_id,
            failed_targets = %failures.join("；"),
            "channel notify partially failed"
        );
    }
    Ok(delivered)
}

async fn fetch_qqbot_access_token(app_id: &str, client_secret: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("初始化 QQBot 客户端失败: {e}"))?;
    let response = client
        .post("https://bots.qq.com/app/getAppAccessToken")
        .json(&json!({
            "appId": app_id,
            "clientSecret": client_secret,
        }))
        .send()
        .await
        .map_err(|e| format!("获取 QQBot access_token 失败: {e}"))?;
    let status = response.status();
    let payload = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("QQBot 鉴权失败: HTTP {status} {payload}"));
    }
    let data = serde_json::from_str::<Value>(&payload)
        .map_err(|e| format!("解析 QQBot 鉴权结果失败: {e}; body={payload}"))?;
    data.get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "QQBot 鉴权未返回 access_token".to_string())
}

fn parse_qqbot_target(raw: &str) -> (String, String) {
    let trimmed = raw.trim();
    if let Some((target_type, target_id)) = trimmed.split_once(':') {
        let normalized = match target_type.trim().to_ascii_lowercase().as_str() {
            "group" | "group_openid" => "group".to_string(),
            "guild" | "channel" => "channel".to_string(),
            _ => "user".to_string(),
        };
        return (normalized, target_id.trim().to_string());
    }
    ("user".to_string(), trimmed.to_string())
}

async fn send_qqbot_notification(
    binding: &ChannelBindingCandidate,
    targets: &[String],
    text: &str,
) -> Result<Vec<String>, String> {
    let config = binding
        .config
        .as_object()
        .ok_or_else(|| "QQBot 渠道配置格式异常".to_string())?;
    let app_id = read_string(config.get("app_id"))
        .or_else(|| read_string(config.get("appId")))
        .ok_or_else(|| "QQBot 渠道缺少 app_id".to_string())?;
    let client_secret = read_string(config.get("client_secret"))
        .or_else(|| read_string(config.get("clientSecret")))
        .ok_or_else(|| "QQBot 渠道缺少 client_secret".to_string())?;
    let access_token = fetch_qqbot_access_token(&app_id, &client_secret).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("初始化 QQBot 消息客户端失败: {e}"))?;

    let mut delivered = Vec::new();
    let mut failures = Vec::new();
    for target in targets {
        let (target_type, target_id) = parse_qqbot_target(target);
        if target_id.is_empty() {
            failures.push("empty_target".to_string());
            continue;
        }
        let path = match target_type.as_str() {
            "group" => format!("https://api.sgroup.qq.com/v2/groups/{target_id}/messages"),
            "channel" => format!("https://api.sgroup.qq.com/channels/{target_id}/messages"),
            _ => format!("https://api.sgroup.qq.com/v2/users/{target_id}/messages"),
        };
        match client
            .post(&path)
            .header(AUTHORIZATION, format!("QQBot {access_token}"))
            .json(&json!({
                "content": text.chars().take(1900).collect::<String>(),
                "msg_type": 0,
            }))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                delivered.push(target.clone());
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                failures.push(format!("{target}: HTTP {status} {}", body.trim()));
            }
            Err(error) => {
                failures.push(format!("{target}: {error}"));
            }
        }
    }

    if delivered.is_empty() {
        return Err(failures.join("；"));
    }
    if !failures.is_empty() {
        tracing::warn!(
            channel = "qqbot",
            agent_id = %binding.agent_id,
            failed_targets = %failures.join("；"),
            "channel notify partially failed"
        );
    }
    Ok(delivered)
}

async fn send_whatsapp_notification(targets: &[String], text: &str) -> Result<Vec<String>, String> {
    let gateway_url = env::var("WHATSAPP_GATEWAY_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            let port = env::var("WHATSAPP_GATEWAY_PORT")
                .ok()
                .and_then(|value| value.trim().parse::<u16>().ok())
                .unwrap_or(3009);
            format!("http://127.0.0.1:{port}")
        });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("初始化 WhatsApp 网关客户端失败: {e}"))?;
    let mut delivered = Vec::new();
    let mut failures = Vec::new();
    for target in targets {
        match client
            .post(format!("{gateway_url}/message/send"))
            .json(&json!({
                "to": target,
                "text": text,
            }))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                delivered.push(target.clone());
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                failures.push(format!("{target}: HTTP {status} {}", body.trim()));
            }
            Err(error) => {
                failures.push(format!("{target}: {error}"));
            }
        }
    }
    if delivered.is_empty() {
        return Err(failures.join("；"));
    }
    if !failures.is_empty() {
        tracing::warn!(
            channel = "whatsapp",
            failed_targets = %failures.join("；"),
            "channel notify partially failed"
        );
    }
    Ok(delivered)
}

async fn dispatch_channel_notification(
    binding: &ChannelBindingCandidate,
    targets: &[String],
    text: &str,
) -> Result<Vec<String>, String> {
    match binding.channel_type.as_str() {
        "telegram" => send_telegram_notification(binding, targets, text).await,
        "discord" => send_discord_notification(binding, targets, text).await,
        "feishu" => send_feishu_notification(binding, targets, text).await,
        "qqbot" => send_qqbot_notification(binding, targets, text).await,
        "email" => Err("Email 渠道暂未接入主动任务通知发送".to_string()),
        _ => Err(format!("暂不支持的渠道类型: {}", binding.channel_type)),
    }
}

pub async fn send_channel_notification(
    Json(payload): Json<ChannelNotifyRequest>,
) -> Result<Json<Value>, ApiError> {
    let title = payload.title.trim();
    let message = payload.message.trim();
    if title.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "title 不能为空"));
    }
    if message.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "message 不能为空"));
    }

    let preferred_channel = payload
        .preferred_channel
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());
    let binding = if preferred_channel.as_deref() == Some("whatsapp") {
        None
    } else {
        resolve_channel_binding_for_notification(
            payload.agent_id.as_deref(),
            preferred_channel.as_deref(),
        )?
    };
    let resolved_channel = if let Some(channel) = preferred_channel.clone() {
        channel
    } else if let Some(binding) = binding.as_ref() {
        binding.channel_type.clone()
    } else {
        return Ok(Json(json!({
            "ok": false,
            "delivered": false,
            "fallback_recommended": true,
            "reason": "当前智能体未配置可用通知渠道",
            "delivery_attempts": []
        })));
    };

    if let Some(binding) = binding.as_ref() {
        let (missing, missing_env) = validate_channel_binding_requirements(binding);
        if !missing.is_empty() || !missing_env.is_empty() {
            return Ok(Json(json!({
                "ok": false,
                "delivered": false,
                "resolved_channel": resolved_channel,
                "fallback_recommended": true,
                "reason": if !missing.is_empty() {
                    format!("渠道配置缺少字段: {}", missing.join(", "))
                } else {
                    format!("渠道缺少环境变量: {}", missing_env.join(", "))
                },
                "delivery_attempts": [{
                    "channel": resolved_channel,
                    "status": "failed",
                    "reason": if !missing.is_empty() {
                        format!("渠道配置缺少字段: {}", missing.join(", "))
                    } else {
                        format!("渠道缺少环境变量: {}", missing_env.join(", "))
                    }
                }]
            })));
        }
    }

    let targets = if let Some(binding) = binding.as_ref() {
        resolve_notification_targets(binding, payload.target.as_deref())
    } else {
        split_notification_targets(payload.target.as_deref())
    };
    if targets.is_empty() {
        return Ok(Json(json!({
            "ok": false,
            "delivered": false,
            "resolved_channel": resolved_channel,
            "fallback_recommended": true,
            "reason": "渠道已配置，但没有可用通知目标",
            "delivery_attempts": [{
                "channel": resolved_channel,
                "status": "failed",
                "reason": "渠道已配置，但没有可用通知目标"
            }]
        })));
    }

    let rendered = notification_text(title, message, payload.level.as_deref());
    let delivery_result = match binding.as_ref() {
        Some(binding) => dispatch_channel_notification(binding, &targets, &rendered).await,
        None if resolved_channel == "whatsapp" => {
            send_whatsapp_notification(&targets, &rendered).await
        }
        None => Err(format!("暂不支持的渠道类型: {resolved_channel}")),
    };
    match delivery_result {
        Ok(delivered_targets) => Ok(Json(json!({
            "ok": true,
            "delivered": true,
            "resolved_channel": resolved_channel,
            "resolved_target": delivered_targets.join(","),
            "delivered_targets": delivered_targets,
            "tag": payload.tag,
            "fallback_recommended": false,
            "delivery_attempts": [{
                "channel": resolved_channel,
                "status": "succeeded",
                "delivered_targets": delivered_targets,
                "created_at": chrono::Utc::now().to_rfc3339(),
            }]
        }))),
        Err(reason) => Ok(Json(json!({
            "ok": false,
            "delivered": false,
            "resolved_channel": resolved_channel,
            "resolved_target": targets.join(","),
            "fallback_recommended": true,
            "reason": reason,
            "tag": payload.tag,
            "delivery_attempts": [{
                "channel": resolved_channel,
                "status": "failed",
                "reason": reason,
                "resolved_target": targets.join(","),
                "created_at": chrono::Utc::now().to_rfc3339(),
            }]
        }))),
    }
}

fn apply_mcp_config_to_openfang_file(payload: &Value) -> Result<Value, ApiError> {
    let config_path = resolve_openfang_config_path()?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| storage_error(format!("创建 OpenFang 配置目录失败: {e}")))?;
    }

    let mut root: toml::value::Table = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| storage_error(format!("读取 OpenFang 配置失败: {e}")))?;
        toml::from_str::<toml::value::Table>(&content).unwrap_or_default()
    } else {
        toml::value::Table::new()
    };

    let mut entries = extract_mcp_server_map(payload)
        .into_iter()
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut applied_names = Vec::new();
    let mut skipped = Vec::new();
    let mut toml_entries = Vec::new();
    for (name, value) in entries {
        if let Some(table) = convert_mcp_entry_to_toml(&name, &value) {
            toml_entries.push(toml::Value::Table(table));
            applied_names.push(name);
        } else {
            skipped.push(name);
        }
    }

    root.insert("mcp_servers".to_string(), toml::Value::Array(toml_entries));
    let output = toml::to_string_pretty(&root)
        .map_err(|e| storage_error(format!("序列化 OpenFang 配置失败: {e}")))?;
    fs::write(&config_path, output)
        .map_err(|e| storage_error(format!("写入 OpenFang 配置失败: {e}")))?;

    Ok(json!({
        "config_path": config_path.to_string_lossy().to_string(),
        "applied_count": applied_names.len(),
        "applied_names": applied_names,
        "skipped": skipped
    }))
}

async fn trigger_openfang_reload(state: &Arc<AppState>) -> Result<Value, ApiError> {
    let current = state.openfang.get_json("/api/config").await?;
    let language = current
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("en")
        .to_string();
    let reload = state
        .openfang
        .post_json(
            "/api/config/set",
            json!({
                "path": "language",
                "value": language
            }),
        )
        .await?;
    Ok(reload)
}

pub async fn sync_provider_configs_to_runtime(state: &Arc<AppState>) -> Result<Value, ApiError> {
    let online = ensure_online(state).await.is_ok();
    sync_provider_configs_to_runtime_with_online(state, online).await
}

async fn sync_provider_configs_to_runtime_with_online(
    state: &Arc<AppState>,
    online: bool,
) -> Result<Value, ApiError> {
    crate::reconcile_runtime_config_from_storage().map_err(storage_error)?;
    let reload = if online {
        Some(trigger_openfang_reload(state).await?)
    } else {
        None
    };
    // Provider 配置变更需要重启 OpenFang 才能生效（内核不支持热更新 providers）
    let mut restarted = false;
    let mut restart_error: Option<String> = None;
    if state.config.openfang_auto_start && online {
        if let Err(err) = state.shutdown_managed_openfang().await {
            restart_error = Some(format!("停止 OpenFang 失败: {err}"));
        }
        match state.power_on().await {
            Ok(_) => restarted = true,
            Err(err) => {
                let msg = format!("重启 OpenFang 失败: {err}");
                restart_error = Some(match restart_error {
                    Some(prev) => format!("{prev}; {msg}"),
                    None => msg,
                });
            }
        }
    }
    Ok(json!({
        "status": "ok",
        "online": online,
        "reload": reload,
        "restarted": restarted,
        "restart_error": restart_error
    }))
}

fn normalize_skill_description_text(raw: &str) -> Option<String> {
    let text = raw.trim().trim_matches('"').trim_matches('\'').trim();
    if text.is_empty() {
        return None;
    }
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return None;
    }
    Some(compact.chars().take(220).collect())
}

fn parse_skill_description_from_markdown(content: &str) -> Option<String> {
    let normalized = content.replace("\r\n", "\n");
    let lines = normalized.lines().collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }

    if lines.first().map(|line| line.trim()) == Some("---") {
        for line in lines.iter().skip(1) {
            let trimmed = line.trim();
            if trimmed == "---" {
                break;
            }
            if let Some((key, value)) = trimmed.split_once(':') {
                let key = key.trim();
                if key.eq_ignore_ascii_case("description") || key.eq_ignore_ascii_case("desc") {
                    if let Some(found) = normalize_skill_description_text(value) {
                        return Some(found);
                    }
                }
            }
        }
    }

    for line in lines.iter().take(80) {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with('|')
            || trimmed.starts_with("```")
        {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim();
            if key.eq_ignore_ascii_case("description") || key.eq_ignore_ascii_case("desc") {
                if let Some(found) = normalize_skill_description_text(value) {
                    return Some(found);
                }
            }
        }
        let candidate = trimmed
            .trim_start_matches("- ")
            .trim_start_matches("* ")
            .trim();
        if let Some(found) = normalize_skill_description_text(candidate) {
            return Some(found);
        }
    }
    None
}

fn read_skill_frontmatter_field(markdown: &str, field_name: &str) -> Option<String> {
    let mut lines = markdown.lines();
    if lines.next().map(str::trim) != Some("---") {
        return None;
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case(field_name) {
            continue;
        }
        let value = value.trim().trim_matches('"').trim_matches('\'').trim();
        if value.is_empty() || value == "|" || value == ">" {
            return None;
        }
        return Some(value.to_string());
    }
    None
}

fn read_skill_name_from_dir(skill_dir: &StdPath) -> Option<String> {
    let skill_md = skill_dir.join("SKILL.md");
    if !skill_md.is_file() {
        return None;
    }
    let content = fs::read_to_string(skill_md).ok()?;
    read_skill_frontmatter_field(&content, "name")
}

fn read_skill_description_from_dir(skill_dir: &StdPath) -> Option<String> {
    let skill_md = skill_dir.join("SKILL.md");
    if !skill_md.is_file() {
        return None;
    }
    let content = fs::read_to_string(skill_md).ok()?;
    parse_skill_description_from_markdown(&content)
}

fn read_skill_description_from_candidates(paths: &[PathBuf]) -> Option<String> {
    for candidate in paths {
        if candidate.is_dir() {
            if let Some(found) = read_skill_description_from_dir(candidate) {
                return Some(found);
            }
            continue;
        }
        if candidate.is_file() {
            let file_name = candidate
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if file_name.eq_ignore_ascii_case("SKILL.md") {
                let content = fs::read_to_string(candidate).ok()?;
                if let Some(found) = parse_skill_description_from_markdown(&content) {
                    return Some(found);
                }
            }
            continue;
        }
        if let Some(parent) = candidate.parent() {
            if let Some(found) = read_skill_description_from_dir(parent) {
                return Some(found);
            }
        }
    }
    None
}

fn list_child_dirs(root: &StdPath) -> Result<Vec<String>, std::io::Error> {
    let mut names = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            names.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    names.sort();
    Ok(names)
}

fn skill_folder_name_from_record(record: &assignment_store::ImportedSkillRecord) -> Option<String> {
    let installed = record.installed_path.trim();
    if !installed.is_empty() {
        if let Some(folder_name) = PathBuf::from(installed)
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
        {
            return Some(folder_name);
        }
    }

    let name = record.name.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn extract_runtime_skill_entries(payload: &Value) -> Vec<RuntimeSkillListEntry> {
    let Some(skills) = payload.get("skills").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    for skill in skills {
        let Some(name_raw) = skill.get("name").and_then(Value::as_str) else {
            continue;
        };
        let name = name_raw.trim();
        if name.is_empty() {
            continue;
        }
        let description = skill
            .get("description")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let source_type = skill
            .get("source")
            .and_then(Value::as_object)
            .and_then(|source| source.get("type"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("local")
            .to_string();
        entries.push(RuntimeSkillListEntry {
            name: name.to_string(),
            description,
            source_type,
        });
    }
    entries
}

fn normalize_zip_entry_path(raw: &str) -> String {
    raw.trim_matches('/')
        .replace('\\', "/")
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn write_zip_bytes_entry(
    zip: &mut zip::ZipWriter<Cursor<Vec<u8>>>,
    entry_path: &str,
    content: &[u8],
) -> Result<(), ApiError> {
    let normalized = normalize_zip_entry_path(entry_path);
    if normalized.is_empty() {
        return Err(storage_error("zip 条目路径为空"));
    }
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    zip.start_file(&normalized, options)
        .map_err(|e| storage_error(format!("创建压缩条目失败({normalized}): {e}")))?;
    zip.write_all(content)
        .map_err(|e| storage_error(format!("写入压缩条目失败({normalized}): {e}")))?;
    Ok(())
}

fn write_zip_text_entry(
    zip: &mut zip::ZipWriter<Cursor<Vec<u8>>>,
    entry_path: &str,
    content: &[u8],
) -> Result<(), ApiError> {
    write_zip_bytes_entry(zip, entry_path, content)
}

fn write_zip_json_entry(
    zip: &mut zip::ZipWriter<Cursor<Vec<u8>>>,
    entry_path: &str,
    payload: &Value,
) -> Result<(), ApiError> {
    let serialized = serde_json::to_vec_pretty(payload)
        .map_err(|e| storage_error(format!("序列化 JSON 失败: {e}")))?;
    write_zip_bytes_entry(zip, entry_path, &serialized)
}

fn append_directory_files_to_zip(
    zip: &mut zip::ZipWriter<Cursor<Vec<u8>>>,
    source_root: &StdPath,
    zip_root: &str,
) -> Result<usize, ApiError> {
    if !source_root.is_dir() {
        return Ok(0);
    }
    let mut stack = vec![source_root.to_path_buf()];
    let mut total = 0usize;

    while let Some(current_dir) = stack.pop() {
        let entries = fs::read_dir(&current_dir).map_err(|e| {
            storage_error(format!(
                "读取目录失败({}): {e}",
                current_dir.to_string_lossy()
            ))
        })?;
        for entry in entries {
            let entry = entry.map_err(|e| storage_error(format!("读取目录项失败: {e}")))?;
            let file_type = entry
                .file_type()
                .map_err(|e| storage_error(format!("读取文件类型失败: {e}")))?;
            let path = entry.path();
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let relative = path.strip_prefix(source_root).map_err(|e| {
                storage_error(format!(
                    "解析目录相对路径失败({}): {e}",
                    path.to_string_lossy()
                ))
            })?;
            let relative_text = relative.to_string_lossy().replace('\\', "/");
            if relative_text.trim().is_empty() {
                continue;
            }
            let zip_entry = format!("{}/{}", normalize_zip_entry_path(zip_root), relative_text);
            let bytes = fs::read(&path)
                .map_err(|e| storage_error(format!("读取文件失败({}): {e}", path.display())))?;
            write_zip_bytes_entry(zip, &zip_entry, &bytes)?;
            total += 1;
        }
    }

    Ok(total)
}

fn copy_dir_recursive(source: &StdPath, target: &StdPath) -> Result<(), ApiError> {
    fs::create_dir_all(target).map_err(|e| storage_error(format!("创建目录失败: {e}")))?;
    for entry in fs::read_dir(source).map_err(|e| storage_error(format!("读取目录失败: {e}")))?
    {
        let entry = entry.map_err(|e| storage_error(format!("读取目录项失败: {e}")))?;
        let file_type = entry
            .file_type()
            .map_err(|e| storage_error(format!("读取文件类型失败: {e}")))?;
        let src_path = entry.path();
        let dst_path = target.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
            continue;
        }
        if file_type.is_file() {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| storage_error(format!("复制文件失败({}): {e}", src_path.display())))?;
        }
    }
    Ok(())
}

fn validate_skill_dir(source: &StdPath) -> Result<(), ApiError> {
    let skill_md = source.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!("技能目录缺少 SKILL.md: {}", source.display()),
        ));
    }
    Ok(())
}

fn infer_skill_name(source: &StdPath) -> Result<String, ApiError> {
    if let Some(name) = read_skill_name_from_dir(source).filter(|name| !name.trim().is_empty()) {
        return Ok(name);
    }
    source
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "无法从技能目录推导 skill 名称",
            )
        })
}

fn install_skill_from_dir(
    source: &StdPath,
    skill_name_override: Option<String>,
    overwrite: bool,
    source_label: &str,
) -> Result<Value, ApiError> {
    validate_skill_dir(source)?;
    let skill_name = skill_name_override.unwrap_or(infer_skill_name(source)?);

    let skills_root = assignment_store::skills_root().map_err(storage_error)?;
    fs::create_dir_all(&skills_root)
        .map_err(|e| storage_error(format!("创建 skills 目录失败: {e}")))?;
    let target = skills_root.join(&skill_name);

    if target.exists() {
        if overwrite {
            fs::remove_dir_all(&target)
                .map_err(|e| storage_error(format!("删除旧技能目录失败: {e}")))?;
        } else {
            return Err(ApiError::new(
                axum::http::StatusCode::CONFLICT,
                format!("目标技能目录已存在: {}", target.display()),
            ));
        }
    }

    copy_dir_recursive(source, &target)?;
    assignment_store::upsert_imported_skill(&skill_name, &PathBuf::from(source_label), &target)
        .map_err(storage_error)?;
    let db_path = assignment_store::ensure_db().map_err(storage_error)?;

    Ok(json!({
        "status": "imported",
        "name": skill_name,
        "sourcePath": source_label,
        "installedPath": target.to_string_lossy().to_string(),
        "dbPath": db_path.to_string_lossy().to_string(),
        "note": "技能已导入。若 OpenFang 运行时尚未识别该 skill，请重启 OpenFang 使其生效。"
    }))
}

fn extract_zip_to_dir(content: &Bytes, target: &StdPath) -> Result<(), ApiError> {
    let reader = Cursor::new(content.to_vec());
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!("zip 解析失败: {e}"),
        )
    })?;

    if archive.len() == 0 {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "zip 文件为空",
        ));
    }

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("读取 zip 条目失败: {e}"),
            )
        })?;
        let Some(rel_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let output_path = target.join(rel_path);

        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|e| storage_error(format!("创建目录失败: {e}")))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|e| storage_error(format!("创建目录失败: {e}")))?;
        }
        let mut output = fs::File::create(&output_path)
            .map_err(|e| storage_error(format!("创建文件失败: {e}")))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|e| storage_error(format!("写入文件失败: {e}")))?;
    }

    Ok(())
}

fn walk_skill_dirs(
    root: &StdPath,
    max_depth: usize,
    output: &mut Vec<PathBuf>,
) -> Result<(), ApiError> {
    if max_depth == 0 {
        return Ok(());
    }
    if root.join("SKILL.md").is_file() {
        output.push(root.to_path_buf());
    }
    for entry in fs::read_dir(root).map_err(|e| storage_error(format!("读取目录失败: {e}")))?
    {
        let entry = entry.map_err(|e| storage_error(format!("读取目录项失败: {e}")))?;
        if !entry
            .file_type()
            .map_err(|e| storage_error(format!("读取文件类型失败: {e}")))?
            .is_dir()
        {
            continue;
        }
        walk_skill_dirs(&entry.path(), max_depth.saturating_sub(1), output)?;
    }
    Ok(())
}

fn find_skill_dirs(root: &StdPath) -> Result<Vec<PathBuf>, ApiError> {
    let mut dirs = Vec::new();
    walk_skill_dirs(root, 4, &mut dirs)?;
    dirs.sort();
    dirs.dedup();
    Ok(dirs)
}

fn sanitize_upload_relative_path(raw: &str) -> Result<PathBuf, ApiError> {
    let normalized = raw.replace('\\', "/");
    let mut output = PathBuf::new();
    for component in StdPath::new(&normalized).components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::Normal(seg) => output.push(seg),
            _ => {
                return Err(ApiError::new(
                    axum::http::StatusCode::BAD_REQUEST,
                    "上传文件路径非法",
                ))
            }
        }
    }

    if output.as_os_str().is_empty() {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "上传文件路径为空",
        ));
    }
    Ok(output)
}

fn unwrap_or_record(
    key: &str,
    result: Result<Value, ApiError>,
    errors: &mut serde_json::Map<String, Value>,
) -> Value {
    match result {
        Ok(value) => value,
        Err(err) => {
            errors.insert(key.to_string(), json!(err.message));
            Value::Null
        }
    }
}

fn strip_workspace_mcp_servers_payload(payload: &mut Value) {
    let Some(object) = payload.as_object_mut() else {
        return;
    };
    for key in ["configured", "connected", "available", "mcp_servers"] {
        let filtered = object
            .get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter(|item| {
                        let name = item
                            .as_str()
                            .or_else(|| item.get("name").and_then(Value::as_str))
                            .map(str::trim)
                            .unwrap_or_default();
                        !name.is_empty() && !is_system_hidden_mcp_server(name)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        object.insert(key.to_string(), Value::Array(filtered));
    }
}

fn resolve_assignment(
    mode: Option<&str>,
    primary: Option<Vec<String>>,
    fallback: Option<Vec<String>>,
    field_name: &str,
) -> Result<Vec<String>, ApiError> {
    let parsed_mode = mode
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_ascii_lowercase);

    match parsed_mode.as_deref() {
        Some("all") => Ok(Vec::new()),
        Some("allowlist") => primary.or(fallback).ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                format!("mode=allowlist 时必须提供 {field_name}"),
            )
        }),
        Some(other) => Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            format!("不支持的 mode: {other}（仅支持 all / allowlist）"),
        )),
        None => Ok(primary.or(fallback).unwrap_or_default()),
    }
}

#[cfg(test)]
mod tests {
    use crate::assignment_store::{make_model_id, normalize_provider_id};

    use super::parse_http_byte_range_header;

    #[test]
    fn provider_id_keeps_original_config_value() {
        assert_eq!(normalize_provider_id(" nvidia-nim "), "nvidia-nim");
        assert_eq!(normalize_provider_id("NVIDIA"), "NVIDIA");
    }

    #[test]
    fn model_id_keeps_namespaced_model_value() {
        assert_eq!(
            make_model_id("nvidia-nim", "xianyu/glm-4.7"),
            "nvidia-nim::xianyu/glm-4.7"
        );
    }

    #[test]
    fn parse_http_byte_range_header_supports_explicit_range() {
        assert_eq!(
            parse_http_byte_range_header("bytes=100-199", 1_000),
            Ok((100, 199))
        );
    }

    #[test]
    fn parse_http_byte_range_header_supports_open_ended_range() {
        assert_eq!(
            parse_http_byte_range_header("bytes=900-", 1_000),
            Ok((900, 999))
        );
    }

    #[test]
    fn parse_http_byte_range_header_supports_suffix_range() {
        assert_eq!(
            parse_http_byte_range_header("bytes=-128", 1_000),
            Ok((872, 999))
        );
    }

    #[test]
    fn parse_http_byte_range_header_rejects_invalid_range() {
        assert!(parse_http_byte_range_header("bytes=999-100", 1_000).is_err());
        assert!(parse_http_byte_range_header("bytes=1000-1001", 1_000).is_err());
        assert!(parse_http_byte_range_header("items=0-1", 1_000).is_err());
        assert!(parse_http_byte_range_header("bytes=0-1,4-5", 1_000).is_err());
    }

}
