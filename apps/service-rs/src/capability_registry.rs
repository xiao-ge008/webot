use std::collections::BTreeMap;
use std::sync::Arc;

use axum::extract::{Path, Query};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::assignment_store::{
    self, AgentCapabilityBindingRecord, CapabilityDescriptorRecord, CapabilityJobRecord,
    CapabilityProviderRecord, ProviderHealthStateRecord, RendererBindingRecord,
};
use crate::component_center;
use crate::error::ApiError;
use crate::AppState;

pub fn management_router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/capabilities/providers",
            get(list_capability_providers_handler).post(register_capability_provider_handler),
        )
        .route(
            "/capabilities/providers/register",
            post(register_capability_provider_handler),
        )
        .route(
            "/capabilities/providers/{id}/disable",
            post(disable_capability_provider_handler),
        )
        .route(
            "/capabilities/providers/{id}",
            delete(remove_capability_provider_handler),
        )
        .route(
            "/capabilities/bindings/agent",
            get(list_agent_capability_bindings_handler)
                .post(bind_agent_capability_handler)
                .delete(unbind_agent_capability_handler),
        )
        .route(
            "/renderers/bind",
            get(list_renderer_bindings_handler)
                .post(bind_renderer_handler)
                .delete(unbind_renderer_handler),
        )
        .route(
            "/capabilities/jobs",
            get(list_capability_jobs_handler).post(upsert_capability_job_handler),
        )
        .route("/capabilities/jobs/{id}", get(get_capability_job_handler))
        .route("/documents/providers", get(list_document_providers_handler))
        .route(
            "/audit/capabilities",
            get(list_capability_audit_logs_handler).post(append_capability_audit_log_handler),
        )
}

#[derive(Debug, Deserialize)]
struct CapabilityAuditQuery {
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct CapabilityAuditAppendRequest {
    action: String,
    provider_id: Option<String>,
    agent_id: Option<String>,
    capability_key: Option<String>,
    capability_scope: Option<String>,
    payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct CapabilityProvidersQuery {
    agent_id: Option<String>,
    capability_key: Option<String>,
    capability_scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProviderDisableRequest {
    disabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct CapabilityProviderUpsertRequest {
    provider_id: String,
    provider_type: String,
    display_name: Option<String>,
    capabilities: Vec<CapabilityDescriptorRecord>,
    supported_scopes: Option<Vec<String>>,
    priority: Option<i64>,
    requirements: Option<Value>,
    supports_job: Option<bool>,
    enabled: Option<bool>,
    health_state: Option<String>,
    input_contract: Option<Value>,
    output_contract: Option<Value>,
    metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct AgentBindingRequest {
    agent_id: String,
    capability_key: String,
    capability_scope: Option<String>,
    provider_id: Option<String>,
    binding_type: Option<String>,
    enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct AgentBindingQuery {
    agent_id: Option<String>,
    capability_key: Option<String>,
    capability_scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RendererBindingRequest {
    channel: String,
    result_kind: String,
    media_type: Option<String>,
    document_type: Option<String>,
    renderer_key: Option<String>,
    enabled: Option<bool>,
    fallback_channel: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CapabilityJobsQuery {
    agent_id: Option<String>,
    status: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct CapabilityJobUpsertRequest {
    job_id: String,
    owner_agent_id: String,
    capability_key: String,
    capability_scope: Option<String>,
    provider_id: Option<String>,
    provider_type: Option<String>,
    route: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    status: Option<String>,
    progress_percent: Option<f64>,
    stage: Option<String>,
    job_type: Option<String>,
    input_payload: Option<Value>,
    result_payload: Option<Value>,
    error_message: Option<String>,
    metadata: Option<Value>,
    created_at: Option<String>,
    started_at: Option<String>,
    finished_at: Option<String>,
    last_heartbeat_at: Option<String>,
}

fn storage_error(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message)
}

fn bad_request(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

async fn list_capability_providers_handler(
    Query(query): Query<CapabilityProvidersQuery>,
) -> Result<Json<Value>, ApiError> {
    let capability_key = query
        .capability_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let capability_scope = query
        .capability_scope
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let providers = merged_capability_providers()
        .map_err(storage_error)?
        .into_iter()
        .filter(|provider| {
            if let Some(key) = capability_key.as_deref() {
                provider.capabilities.iter().any(|item| {
                    item.key == key
                        && capability_scope
                            .as_deref()
                            .map(|scope| item.scope == scope)
                            .unwrap_or(true)
                })
            } else {
                true
            }
        })
        .collect::<Vec<_>>();
    let bindings = assignment_store::list_capability_provider_bindings().map_err(storage_error)?;
    let health_states = assignment_store::list_provider_health_states().map_err(storage_error)?;
    let agent_bindings =
        assignment_store::list_agent_capability_bindings(query.agent_id.as_deref())
            .map_err(storage_error)?;
    Ok(Json(json!({
        "providers": providers,
        "bindings": bindings,
        "health_states": health_states,
        "agent_bindings": agent_bindings,
    })))
}

async fn register_capability_provider_handler(
    Json(payload): Json<CapabilityProviderUpsertRequest>,
) -> Result<Json<Value>, ApiError> {
    let provider = assignment_store::upsert_capability_provider(CapabilityProviderRecord {
        provider_id: payload.provider_id,
        provider_type: payload.provider_type,
        display_name: payload.display_name,
        capabilities: payload.capabilities,
        supported_scopes: payload
            .supported_scopes
            .unwrap_or_else(|| vec!["generic".to_string()]),
        priority: payload.priority.unwrap_or(100),
        requirements: payload
            .requirements
            .unwrap_or_else(|| Value::Object(Default::default())),
        supports_job: payload.supports_job.unwrap_or(false),
        enabled: payload.enabled.unwrap_or(true),
        health_state: payload
            .health_state
            .unwrap_or_else(|| "unknown".to_string()),
        input_contract: payload
            .input_contract
            .unwrap_or_else(|| Value::Object(Default::default())),
        output_contract: payload
            .output_contract
            .unwrap_or_else(|| Value::Object(Default::default())),
        metadata: payload
            .metadata
            .unwrap_or_else(|| Value::Object(Default::default())),
        is_removed: false,
        updated_at: String::new(),
    })
    .map_err(storage_error)?;
    let _ = assignment_store::upsert_provider_health_state(ProviderHealthStateRecord {
        provider_id: provider.provider_id.clone(),
        health_state: provider.health_state.clone(),
        message: None,
        checked_at: now_iso_like(),
        updated_at: String::new(),
    });
    let _ = assignment_store::append_capability_audit_log(
        "register_provider",
        Some(&provider.provider_id),
        None,
        None,
        None,
        &json!({
            "provider_type": provider.provider_type,
            "capabilities": provider.capabilities,
            "supported_scopes": provider.supported_scopes,
            "enabled": provider.enabled,
        }),
    );
    Ok(Json(json!({
        "ok": true,
        "provider": provider,
    })))
}

async fn disable_capability_provider_handler(
    Path(provider_id): Path<String>,
    Json(payload): Json<ProviderDisableRequest>,
) -> Result<Json<Value>, ApiError> {
    let disabled = payload.disabled.unwrap_or(true);
    let mut provider = resolve_provider_or_default(&provider_id)?;
    provider.enabled = !disabled;
    provider.health_state = if provider.enabled {
        "unknown".to_string()
    } else {
        "disabled".to_string()
    };
    provider.is_removed = false;
    let saved = assignment_store::upsert_capability_provider(provider).map_err(storage_error)?;
    let _ = assignment_store::upsert_provider_health_state(ProviderHealthStateRecord {
        provider_id: saved.provider_id.clone(),
        health_state: saved.health_state.clone(),
        message: if saved.enabled {
            None
        } else {
            Some("provider 已禁用".to_string())
        },
        checked_at: now_iso_like(),
        updated_at: String::new(),
    });
    let _ = assignment_store::append_capability_audit_log(
        if saved.enabled {
            "enable_provider"
        } else {
            "disable_provider"
        },
        Some(&saved.provider_id),
        None,
        None,
        None,
        &json!({
            "enabled": saved.enabled,
        }),
    );
    Ok(Json(json!({
        "ok": true,
        "provider": saved,
    })))
}

async fn remove_capability_provider_handler(
    Path(provider_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let mut provider = resolve_provider_or_default(&provider_id)?;
    provider.enabled = false;
    provider.is_removed = true;
    provider.health_state = "unavailable".to_string();
    let saved = assignment_store::upsert_capability_provider(provider).map_err(storage_error)?;
    let _ = assignment_store::upsert_provider_health_state(ProviderHealthStateRecord {
        provider_id: saved.provider_id.clone(),
        health_state: saved.health_state.clone(),
        message: Some("provider 已移除".to_string()),
        checked_at: now_iso_like(),
        updated_at: String::new(),
    });
    let _ = assignment_store::append_capability_audit_log(
        "remove_provider",
        Some(&saved.provider_id),
        None,
        None,
        None,
        &json!({ "removed": true }),
    );
    Ok(Json(json!({
        "ok": true,
        "provider": saved,
    })))
}

async fn bind_agent_capability_handler(
    Json(payload): Json<AgentBindingRequest>,
) -> Result<Json<Value>, ApiError> {
    let record = assignment_store::upsert_agent_capability_binding(AgentCapabilityBindingRecord {
        agent_id: payload.agent_id,
        capability_key: payload.capability_key,
        capability_scope: payload
            .capability_scope
            .unwrap_or_else(|| "generic".to_string()),
        provider_id: payload.provider_id,
        binding_type: payload
            .binding_type
            .unwrap_or_else(|| "capability".to_string()),
        enabled: payload.enabled.unwrap_or(true),
        updated_at: String::new(),
    })
    .map_err(storage_error)?;
    let _ = assignment_store::append_capability_audit_log(
        "bind_agent_capability",
        record.provider_id.as_deref(),
        Some(&record.agent_id),
        Some(&record.capability_key),
        Some(&record.capability_scope),
        &json!({
            "binding_type": record.binding_type,
            "enabled": record.enabled,
        }),
    );
    Ok(Json(json!({
        "ok": true,
        "binding": record,
    })))
}

async fn list_agent_capability_bindings_handler(
    Query(query): Query<AgentBindingQuery>,
) -> Result<Json<Value>, ApiError> {
    let capability_key = query
        .capability_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let capability_scope = query
        .capability_scope
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let bindings = assignment_store::list_agent_capability_bindings(query.agent_id.as_deref())
        .map_err(storage_error)?
        .into_iter()
        .filter(|item| {
            capability_key
                .as_deref()
                .map(|value| item.capability_key == value)
                .unwrap_or(true)
                && capability_scope
                    .as_deref()
                    .map(|value| item.capability_scope == value)
                    .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({
        "bindings": bindings,
    })))
}

async fn unbind_agent_capability_handler(
    Json(payload): Json<AgentBindingRequest>,
) -> Result<Json<Value>, ApiError> {
    let capability_scope = payload
        .capability_scope
        .unwrap_or_else(|| "generic".to_string());
    let binding_type = payload
        .binding_type
        .unwrap_or_else(|| "capability".to_string());
    assignment_store::delete_agent_capability_binding(
        &payload.agent_id,
        &payload.capability_key,
        &capability_scope,
        payload.provider_id.as_deref(),
        &binding_type,
    )
    .map_err(storage_error)?;
    let _ = assignment_store::append_capability_audit_log(
        "unbind_agent_capability",
        payload.provider_id.as_deref(),
        Some(&payload.agent_id),
        Some(&payload.capability_key),
        Some(&capability_scope),
        &json!({
            "binding_type": binding_type,
        }),
    );
    Ok(Json(json!({ "ok": true })))
}

async fn bind_renderer_handler(
    Json(payload): Json<RendererBindingRequest>,
) -> Result<Json<Value>, ApiError> {
    let record = assignment_store::upsert_renderer_binding(RendererBindingRecord {
        channel: payload.channel,
        result_kind: payload.result_kind,
        media_type: payload.media_type,
        document_type: payload.document_type,
        renderer_key: payload
            .renderer_key
            .ok_or_else(|| bad_request("renderer_key 不能为空"))?,
        enabled: payload.enabled.unwrap_or(true),
        fallback_channel: payload
            .fallback_channel
            .or_else(|| Some("plain_text".to_string())),
        updated_at: String::new(),
    })
    .map_err(storage_error)?;
    let _ = assignment_store::append_capability_audit_log(
        "bind_renderer",
        None,
        None,
        None,
        None,
        &json!({
            "channel": record.channel,
            "result_kind": record.result_kind,
            "media_type": record.media_type,
            "document_type": record.document_type,
            "renderer_key": record.renderer_key,
            "enabled": record.enabled,
            "fallback_channel": record.fallback_channel,
        }),
    );
    Ok(Json(json!({
        "ok": true,
        "binding": record,
    })))
}

async fn list_renderer_bindings_handler() -> Result<Json<Value>, ApiError> {
    let bindings = merged_renderer_bindings().map_err(storage_error)?;
    Ok(Json(json!({
        "bindings": bindings,
    })))
}

async fn unbind_renderer_handler(
    Json(payload): Json<RendererBindingRequest>,
) -> Result<Json<Value>, ApiError> {
    let existing = resolve_renderer_binding_or_default(
        &payload.channel,
        &payload.result_kind,
        payload.media_type.as_deref(),
        payload.document_type.as_deref(),
    )?;
    let record = assignment_store::upsert_renderer_binding(RendererBindingRecord {
        channel: existing.channel,
        result_kind: existing.result_kind,
        media_type: existing.media_type,
        document_type: existing.document_type,
        renderer_key: existing.renderer_key,
        enabled: false,
        fallback_channel: Some("plain_text".to_string()),
        updated_at: String::new(),
    })
    .map_err(storage_error)?;
    let _ = assignment_store::append_capability_audit_log(
        "unbind_renderer",
        None,
        None,
        None,
        None,
        &json!({
            "channel": record.channel,
            "result_kind": record.result_kind,
            "media_type": record.media_type,
            "document_type": record.document_type,
        }),
    );
    Ok(Json(json!({
        "ok": true,
        "binding": record,
    })))
}

async fn list_capability_jobs_handler(
    Query(query): Query<CapabilityJobsQuery>,
) -> Result<Json<Value>, ApiError> {
    let jobs = assignment_store::list_capability_jobs(
        query.agent_id.as_deref(),
        query.status.as_deref(),
        query.limit,
    )
    .map_err(storage_error)?;
    Ok(Json(json!({
        "jobs": jobs,
    })))
}

async fn get_capability_job_handler(Path(job_id): Path<String>) -> Result<Json<Value>, ApiError> {
    let job = assignment_store::get_capability_job(&job_id).map_err(storage_error)?;
    let mut job =
        job.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, format!("未找到 job: {job_id}")))?;
    if !is_capability_job_terminal_status(&job.status) {
        match component_center::refresh_component_capability_job(&job).await {
            Ok(Some(refreshed)) => {
                job = refreshed;
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!(
                    "[capability-job] refresh job failed: job_id={}, error={}",
                    job.job_id, error
                );
            }
        }
    }
    Ok(Json(json!({
        "job": job,
    })))
}

async fn upsert_capability_job_handler(
    Json(payload): Json<CapabilityJobUpsertRequest>,
) -> Result<Json<Value>, ApiError> {
    let status = payload.status.unwrap_or_else(|| "queued".to_string());
    let record = assignment_store::upsert_capability_job(CapabilityJobRecord {
        job_id: payload.job_id,
        owner_agent_id: payload.owner_agent_id,
        capability_key: payload.capability_key,
        capability_scope: payload
            .capability_scope
            .unwrap_or_else(|| "generic".to_string()),
        provider_id: payload.provider_id,
        provider_type: payload.provider_type,
        route: payload.route,
        title: payload.title,
        summary: payload.summary,
        status: status.clone(),
        progress_percent: payload.progress_percent,
        stage: payload.stage,
        job_type: payload.job_type,
        input_payload: payload
            .input_payload
            .unwrap_or_else(|| Value::Object(Default::default())),
        result_payload: payload
            .result_payload
            .unwrap_or_else(|| Value::Object(Default::default())),
        error_message: payload.error_message,
        metadata: payload
            .metadata
            .unwrap_or_else(|| Value::Object(Default::default())),
        created_at: payload.created_at.unwrap_or_default(),
        updated_at: String::new(),
        started_at: payload.started_at,
        finished_at: payload.finished_at,
        last_heartbeat_at: payload.last_heartbeat_at.or_else(|| Some(now_iso_like())),
    })
    .map_err(storage_error)?;
    let event_type = match status.as_str() {
        "queued" => "upsert_capability_job",
        "running" | "processing" | "progress" => "update_capability_job_status",
        "completed" | "done" | "success" | "failed" | "error" | "cancelled" | "canceled" => {
            "complete_capability_job"
        }
        _ => "upsert_capability_job",
    };
    let _ = assignment_store::append_capability_audit_log(
        event_type,
        record.provider_id.as_deref(),
        Some(&record.owner_agent_id),
        Some(&record.capability_key),
        Some(&record.capability_scope),
        &json!({
            "job_id": record.job_id,
            "status": record.status,
            "progress_percent": record.progress_percent,
            "stage": record.stage,
            "job_type": record.job_type,
            "route": record.route,
        }),
    );
    Ok(Json(json!({
        "ok": true,
        "job": record,
    })))
}

async fn list_document_providers_handler() -> Result<Json<Value>, ApiError> {
    let providers = merged_capability_providers().map_err(storage_error)?;
    let document_providers = providers
        .into_iter()
        .filter(|provider| {
            provider
                .capabilities
                .iter()
                .any(|item| item.key.ends_with(".document"))
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({
        "providers": document_providers,
        "mime_routes": document_mime_routes(),
    })))
}

async fn list_capability_audit_logs_handler(
    Query(query): Query<CapabilityAuditQuery>,
) -> Result<Json<Value>, ApiError> {
    let logs = assignment_store::list_capability_audit_logs(query.limit).map_err(storage_error)?;
    Ok(Json(json!({
        "logs": logs,
    })))
}

async fn append_capability_audit_log_handler(
    Json(payload): Json<CapabilityAuditAppendRequest>,
) -> Result<Json<Value>, ApiError> {
    let action = payload.action.trim();
    if action.is_empty() {
        return Err(bad_request("action 不能为空"));
    }
    let log = assignment_store::append_capability_audit_log(
        action,
        payload.provider_id.as_deref(),
        payload.agent_id.as_deref(),
        payload.capability_key.as_deref(),
        payload.capability_scope.as_deref(),
        payload
            .payload
            .as_ref()
            .unwrap_or(&Value::Object(Default::default())),
    )
    .map_err(storage_error)?;
    Ok(Json(json!({
        "log": log,
    })))
}

fn resolve_provider_or_default(provider_id: &str) -> Result<CapabilityProviderRecord, ApiError> {
    let merged = merged_capability_providers().map_err(storage_error)?;
    merged
        .into_iter()
        .find(|item| item.provider_id == provider_id.trim())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                format!("未找到 provider: {provider_id}"),
            )
        })
}

fn resolve_renderer_binding_or_default(
    channel: &str,
    result_kind: &str,
    media_type: Option<&str>,
    document_type: Option<&str>,
) -> Result<RendererBindingRecord, ApiError> {
    let merged = merged_renderer_bindings().map_err(storage_error)?;
    let media_type = media_type.map(|value| value.trim().to_string());
    let document_type = document_type.map(|value| value.trim().to_string());
    merged
        .into_iter()
        .find(|item| {
            item.channel == channel.trim()
                && item.result_kind == result_kind.trim()
                && item.media_type == media_type
                && item.document_type == document_type
        })
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "未找到 renderer binding"))
}

fn merged_capability_providers() -> Result<Vec<CapabilityProviderRecord>, String> {
    let _ = component_center::sync_component_capability_providers_from_disk();
    let mut merged = BTreeMap::<String, CapabilityProviderRecord>::new();
    for provider in default_capability_providers() {
        merged.insert(provider.provider_id.clone(), provider);
    }
    for provider in assignment_store::list_capability_providers(true)? {
        if provider.is_removed {
            merged.remove(&provider.provider_id);
            continue;
        }
        merged.insert(provider.provider_id.clone(), provider);
    }
    let health_map = assignment_store::list_provider_health_states()?
        .into_iter()
        .map(|item| (item.provider_id.clone(), item))
        .collect::<BTreeMap<_, _>>();
    let mut output = merged.into_values().collect::<Vec<_>>();
    output.sort_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| left.provider_id.cmp(&right.provider_id))
    });
    for item in &mut output {
        if let Some(health) = health_map.get(&item.provider_id) {
            item.health_state = health.health_state.clone();
        }
    }
    Ok(output)
}

fn is_capability_job_terminal_status(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "completed" | "done" | "success" | "failed" | "error" | "cancelled" | "canceled"
    )
}

fn merged_renderer_bindings() -> Result<Vec<RendererBindingRecord>, String> {
    let mut merged = BTreeMap::<String, RendererBindingRecord>::new();
    for binding in default_renderer_bindings() {
        merged.insert(renderer_binding_key(&binding), binding);
    }
    for binding in assignment_store::list_renderer_bindings()? {
        merged.insert(renderer_binding_key(&binding), binding);
    }
    Ok(merged.into_values().collect())
}

fn renderer_binding_key(binding: &RendererBindingRecord) -> String {
    format!(
        "{}::{}::{}::{}",
        binding.channel,
        binding.result_kind,
        binding.media_type.clone().unwrap_or_default(),
        binding.document_type.clone().unwrap_or_default()
    )
}

fn default_capability_providers() -> Vec<CapabilityProviderRecord> {
    vec![
        provider(
            "component_skill:image_generation",
            "component_skill",
            Some("图片生成组件"),
            &[("generate.image", "generic"), ("edit.image", "generic")],
            &["generic"],
            40,
            true,
        ),
        provider(
            "generic_provider:configured_image_service",
            "generic_provider",
            Some("通用图片服务"),
            &[("generate.image", "generic"), ("edit.image", "generic")],
            &["generic"],
            60,
            true,
        ),
        provider(
            "model_fallback:native_image_model",
            "model_fallback",
            Some("图片模型回退"),
            &[("generate.image", "generic"), ("edit.image", "generic")],
            &["generic"],
            120,
            true,
        ),
        provider(
            "runtime_native:self_image_runtime",
            "runtime_native",
            Some("自我图片运行时"),
            &[("generate.image", "self"), ("edit.image", "self")],
            &["self"],
            20,
            true,
        ),
        provider(
            "model_fallback:native_video_model",
            "model_fallback",
            Some("视频模型回退"),
            &[("generate.video", "generic"), ("edit.video", "generic")],
            &["generic"],
            120,
            true,
        ),
        provider(
            "runtime_native:f5_tts_onnx",
            "runtime_native",
            Some("本地 F5 TTS"),
            &[("generate.audio", "generic")],
            &["generic"],
            20,
            true,
        ),
        provider(
            "generic_provider:openai_tts",
            "generic_provider",
            Some("OpenAI TTS"),
            &[("generate.audio", "generic")],
            &["generic"],
            50,
            true,
        ),
        provider(
            "generic_provider:cosyvoice3",
            "generic_provider",
            Some("CosyVoice3"),
            &[("generate.audio", "generic")],
            &["generic"],
            60,
            true,
        ),
        provider(
            "generic_provider:indextts",
            "generic_provider",
            Some("IndexTTS"),
            &[("generate.audio", "generic")],
            &["generic"],
            70,
            true,
        ),
        provider(
            "generic_provider:qwen_tts",
            "generic_provider",
            Some("Qwen TTS"),
            &[("generate.audio", "generic")],
            &["generic"],
            80,
            true,
        ),
        provider(
            "runtime_native:local_vision_service",
            "runtime_native",
            Some("本地混合视觉"),
            &[("analyze.media", "generic")],
            &["generic"],
            15,
            true,
        ),
        provider(
            "runtime_native:ocr_service",
            "runtime_native",
            Some("Paddle OCR 服务"),
            &[
                ("analyze.media", "generic"),
                ("parse.document", "generic"),
                ("extract.document", "generic"),
            ],
            &["generic"],
            18,
            true,
        ),
        provider(
            "runtime_native:local_stt",
            "runtime_native",
            Some("本地 STT"),
            &[
                ("transcribe.audio", "generic"),
                ("analyze.media", "generic"),
            ],
            &["generic"],
            20,
            true,
        ),
        provider(
            "generic_provider:openai_stt",
            "generic_provider",
            Some("OpenAI STT"),
            &[
                ("transcribe.audio", "generic"),
                ("analyze.media", "generic"),
            ],
            &["generic"],
            50,
            true,
        ),
        provider(
            "generic_provider:whisper_service",
            "generic_provider",
            Some("Whisper 服务"),
            &[
                ("transcribe.audio", "generic"),
                ("analyze.media", "generic"),
            ],
            &["generic"],
            60,
            true,
        ),
        provider(
            "model_fallback:native_vision_model",
            "model_fallback",
            Some("视觉模型回退"),
            &[("analyze.media", "generic")],
            &["generic"],
            120,
            true,
        ),
        provider(
            "runtime_native:pdf_reader",
            "runtime_native",
            Some("PDF 解析器"),
            &[
                ("parse.document", "generic"),
                ("extract.document", "generic"),
                ("preview.document", "generic"),
            ],
            &["generic"],
            20,
            true,
        ),
        provider(
            "runtime_native:office_preview_adapter",
            "runtime_native",
            Some("Office 预览适配器"),
            &[
                ("preview.document", "generic"),
                ("convert.document", "generic"),
            ],
            &["generic"],
            25,
            true,
        ),
        provider(
            "component_skill:document_parser_component",
            "component_skill",
            Some("文档解析组件"),
            &[
                ("parse.document", "generic"),
                ("extract.document", "generic"),
                ("chunk.document", "generic"),
            ],
            &["generic"],
            40,
            true,
        ),
        provider(
            "generic_provider:ocr_service",
            "generic_provider",
            Some("OCR 服务"),
            &[
                ("parse.document", "generic"),
                ("extract.document", "generic"),
            ],
            &["generic"],
            50,
            true,
        ),
        provider(
            "generic_provider:document_convert_service",
            "generic_provider",
            Some("文档转换服务"),
            &[
                ("convert.document", "generic"),
                ("compare.document", "generic"),
                ("summarize.document", "generic"),
            ],
            &["generic"],
            60,
            true,
        ),
        provider(
            "model_fallback:native_doc_reasoner",
            "model_fallback",
            Some("文档推理回退"),
            &[
                ("summarize.document", "generic"),
                ("compare.document", "generic"),
            ],
            &["generic"],
            120,
            true,
        ),
        provider(
            "runtime_native:self_management",
            "runtime_native",
            Some("自我管理运行时"),
            &[
                ("patch.identity", "self"),
                ("patch.memory", "self"),
                ("review.upgrade", "self"),
                ("apply.upgrade", "self"),
            ],
            &["self"],
            10,
            false,
        ),
    ]
}

fn default_renderer_bindings() -> Vec<RendererBindingRecord> {
    vec![
        renderer(
            "desktop",
            "media_result",
            Some("image"),
            None,
            "ImageCover",
            true,
        ),
        renderer(
            "desktop",
            "media_result",
            Some("video"),
            None,
            "VideoCover",
            true,
        ),
        renderer(
            "desktop",
            "media_result",
            Some("audio"),
            None,
            "AudioPlayer",
            true,
        ),
        renderer(
            "desktop",
            "document_result",
            None,
            Some("pdf"),
            "OfficePreviewCard",
            true,
        ),
        renderer(
            "desktop",
            "document_result",
            None,
            Some("docx"),
            "OfficePreviewCard",
            true,
        ),
        renderer(
            "desktop",
            "document_result",
            None,
            Some("xlsx"),
            "OfficePreviewCard",
            true,
        ),
        renderer(
            "desktop",
            "document_result",
            None,
            Some("pptx"),
            "OfficePreviewCard",
            true,
        ),
        renderer(
            "desktop",
            "document_result",
            None,
            Some("md"),
            "MarkdownPreviewCard",
            true,
        ),
        renderer(
            "desktop",
            "document_result",
            None,
            Some("txt"),
            "MarkdownPreviewCard",
            true,
        ),
        renderer(
            "desktop",
            "document_result",
            None,
            Some("compare"),
            "MarkdownPreviewCard",
            true,
        ),
        renderer(
            "desktop",
            "document_result",
            None,
            Some("convert"),
            "MarkdownPreviewCard",
            true,
        ),
        renderer(
            "desktop",
            "patch_result",
            None,
            None,
            "PatchResultCard",
            true,
        ),
        renderer("desktop", "job_result", None, None, "JobProgressCard", true),
        renderer(
            "desktop",
            "confirm_result",
            None,
            None,
            "ConfirmResultCard",
            true,
        ),
        renderer(
            "desktop",
            "review_result",
            None,
            None,
            "ReviewResultCard",
            true,
        ),
        renderer("plain_text", "text_result", None, None, "plain_text", true),
        renderer("plain_text", "media_result", None, None, "plain_text", true),
        renderer(
            "plain_text",
            "document_result",
            None,
            None,
            "plain_text",
            true,
        ),
        renderer("plain_text", "job_result", None, None, "plain_text", true),
        renderer("plain_text", "error_result", None, None, "plain_text", true),
    ]
}

fn provider(
    provider_id: &str,
    provider_type: &str,
    display_name: Option<&str>,
    capabilities: &[(&str, &str)],
    supported_scopes: &[&str],
    priority: i64,
    supports_job: bool,
) -> CapabilityProviderRecord {
    CapabilityProviderRecord {
        provider_id: provider_id.to_string(),
        provider_type: provider_type.to_string(),
        display_name: display_name.map(|value| value.to_string()),
        capabilities: capabilities
            .iter()
            .map(|(key, scope)| CapabilityDescriptorRecord {
                key: (*key).to_string(),
                scope: (*scope).to_string(),
            })
            .collect(),
        supported_scopes: supported_scopes
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        priority,
        requirements: Value::Object(Default::default()),
        supports_job,
        enabled: true,
        health_state: "unknown".to_string(),
        input_contract: Value::Object(Default::default()),
        output_contract: Value::Object(Default::default()),
        metadata: Value::Object(Default::default()),
        is_removed: false,
        updated_at: String::new(),
    }
}

fn renderer(
    channel: &str,
    result_kind: &str,
    media_type: Option<&str>,
    document_type: Option<&str>,
    renderer_key: &str,
    enabled: bool,
) -> RendererBindingRecord {
    RendererBindingRecord {
        channel: channel.to_string(),
        result_kind: result_kind.to_string(),
        media_type: media_type.map(|value| value.to_string()),
        document_type: document_type.map(|value| value.to_string()),
        renderer_key: renderer_key.to_string(),
        enabled,
        fallback_channel: Some("plain_text".to_string()),
        updated_at: String::new(),
    }
}

fn document_mime_routes() -> Value {
    json!({
        "pdf": ["runtime_native:pdf_reader", "runtime_native:ocr_service", "runtime_native:office_preview_adapter"],
        "doc/docx": ["component_skill:document_parser_component", "runtime_native:office_preview_adapter", "generic_provider:document_convert_service"],
        "xls/xlsx/csv": ["component_skill:document_parser_component", "runtime_native:office_preview_adapter", "generic_provider:document_convert_service"],
        "ppt/pptx": ["component_skill:document_parser_component", "runtime_native:office_preview_adapter", "generic_provider:document_convert_service"],
        "txt/md/json": ["component_skill:document_parser_component", "model_fallback:native_doc_reasoner"],
        "unsupported": ["attachment_passthrough"]
    })
}

fn now_iso_like() -> String {
    chrono_like_now()
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}
