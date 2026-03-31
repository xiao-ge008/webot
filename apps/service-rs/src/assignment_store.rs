use std::collections::{BTreeMap, HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use rusqlite::{params, types::Value as SqlValue, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::path_resolver;

const APP_PREF_KEY_PROVIDER_MODEL_STATE_NORMALIZED_V1: &str = "provider_model_state_normalized_v2";
const APP_PREF_KEY_TTS_CONFIG: &str = "tts_config";
static PROVIDER_MODEL_STATE_MIGRATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static PROVIDER_MODEL_STATE_MIGRATED_IN_PROCESS: OnceLock<()> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub struct ImportedSkillRecord {
    pub name: String,
    pub source_path: String,
    pub installed_path: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GlobalMcpConfigRecord {
    pub config: Value,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderConfigRecord {
    pub provider_id: String,
    pub display_name: Option<String>,
    pub protocol: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub models: Vec<String>,
    pub is_custom: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelAssignmentRecord {
    pub model_id: String,
    pub provider_id: String,
    pub model_name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentProfileOverrideRecord {
    pub agent_id: String,
    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub collaboration: Option<Value>,
    pub channel_binding: Option<Value>,
    pub avatar_url: Option<String>,
    pub portrait_url: Option<String>,
    pub english_name: Option<String>,
    pub nickname: Option<String>,
    pub tts_config: Option<Value>,
    pub speaker_profiles: Option<Value>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentCollaborationAclRecord {
    pub caller_agent_id: String,
    pub callee_agent_id: String,
    pub scope: String,
    pub enabled: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentContextFileRecord {
    pub agent_id: String,
    pub file_name: String,
    pub content: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentWorkspaceFolderRecord {
    pub agent_id: String,
    pub folder_path: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaAssetRecord {
    pub asset_id: String,
    pub agent_id: Option<String>,
    pub owner_scope: String,
    pub asset_family: String,
    pub media_kind: String,
    pub source_tool: Option<String>,
    pub purpose: Option<String>,
    pub prompt_text: Option<String>,
    pub negative_prompt: Option<String>,
    pub model: Option<String>,
    pub mime_type: String,
    pub sha256: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub byte_size: u64,
    pub file_name: Option<String>,
    pub saved_path: Option<String>,
    pub image_url: Option<String>,
    pub relative_path: Option<String>,
    pub vision_summary: Option<String>,
    pub tags: Vec<String>,
    pub metadata: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct UpsertMediaAssetRecord {
    pub agent_id: Option<String>,
    pub owner_scope: String,
    pub asset_family: String,
    pub media_kind: String,
    pub source_tool: Option<String>,
    pub purpose: Option<String>,
    pub prompt_text: Option<String>,
    pub negative_prompt: Option<String>,
    pub model: Option<String>,
    pub mime_type: String,
    pub sha256: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub byte_size: u64,
    pub file_name: Option<String>,
    pub saved_path: Option<String>,
    pub image_url: Option<String>,
    pub relative_path: Option<String>,
    pub vision_summary: Option<String>,
    pub tags: Vec<String>,
    pub metadata: Value,
}

#[derive(Debug, Clone, Default)]
pub struct MediaAssetListQuery {
    pub agent_id: Option<String>,
    pub owner_scope: Option<String>,
    pub asset_family: Option<String>,
    pub media_kind: Option<String>,
    pub query: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatGroupRecord {
    pub group_id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub leader_agent_id: String,
    pub system_prompt: String,
    pub admin_agent_ids: Vec<String>,
    pub member_agent_ids: Vec<String>,
    pub group_mode: String,
    pub limits: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskDeliveryRecord {
    pub id: String,
    pub task_id: String,
    pub owner_agent_id: String,
    pub runtime_key: Option<String>,
    pub delivery_kind: String,
    pub dedupe_key: String,
    pub status: String,
    pub origin_conversation_type: Option<String>,
    pub origin_conversation_id: Option<String>,
    pub origin_chat_session_id: Option<String>,
    pub origin_message_id: Option<String>,
    pub creator_participant_id: Option<String>,
    pub creator_participant_name: Option<String>,
    pub executor_agent_id: Option<String>,
    pub executor_agent_name: Option<String>,
    pub report_actor_agent_id: Option<String>,
    pub report_actor_agent_name: Option<String>,
    pub task_name: Option<String>,
    pub run_count: Option<i64>,
    pub summary_text: Option<String>,
    pub error_text: Option<String>,
    pub payload: Value,
    pub created_at: String,
    pub updated_at: String,
    pub reported_at: Option<String>,
    pub acknowledged_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityDescriptorRecord {
    pub key: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityProviderRecord {
    pub provider_id: String,
    pub provider_type: String,
    pub display_name: Option<String>,
    pub capabilities: Vec<CapabilityDescriptorRecord>,
    pub supported_scopes: Vec<String>,
    pub priority: i64,
    pub requirements: Value,
    pub supports_job: bool,
    pub enabled: bool,
    pub health_state: String,
    pub input_contract: Value,
    pub output_contract: Value,
    pub metadata: Value,
    pub is_removed: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityProviderBindingRecord {
    pub capability_key: String,
    pub capability_scope: String,
    pub provider_id: String,
    pub enabled: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCapabilityBindingRecord {
    pub agent_id: String,
    pub capability_key: String,
    pub capability_scope: String,
    pub provider_id: Option<String>,
    pub binding_type: String,
    pub enabled: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RendererBindingRecord {
    pub channel: String,
    pub result_kind: String,
    pub media_type: Option<String>,
    pub document_type: Option<String>,
    pub renderer_key: String,
    pub enabled: bool,
    pub fallback_channel: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealthStateRecord {
    pub provider_id: String,
    pub health_state: String,
    pub message: Option<String>,
    pub checked_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityAuditLogRecord {
    pub id: String,
    pub event_type: String,
    pub provider_id: Option<String>,
    pub agent_id: Option<String>,
    pub capability_key: Option<String>,
    pub capability_scope: Option<String>,
    pub payload: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityJobRecord {
    pub job_id: String,
    pub owner_agent_id: String,
    pub capability_key: String,
    pub capability_scope: String,
    pub provider_id: Option<String>,
    pub provider_type: Option<String>,
    pub route: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub status: String,
    pub progress_percent: Option<f64>,
    pub stage: Option<String>,
    pub job_type: Option<String>,
    pub input_payload: Value,
    pub result_payload: Value,
    pub error_message: Option<String>,
    pub metadata: Value,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub last_heartbeat_at: Option<String>,
}

pub fn normalize_provider_id(value: &str) -> String {
    value.trim().to_string()
}

pub fn normalize_model_name(value: &str) -> String {
    value.trim().to_string()
}

pub fn make_model_id(provider_id: &str, model_name: &str) -> String {
    format!(
        "{}::{}",
        normalize_provider_id(provider_id),
        normalize_model_name(model_name)
    )
}

pub fn normalize_model_id(value: &str) -> String {
    let trimmed = value.trim();
    if let Some((provider_id, model_name)) = trimmed.split_once("::") {
        return make_model_id(provider_id, model_name);
    }
    trimmed.to_string()
}

fn normalize_provider_record(record: ProviderConfigRecord) -> ProviderConfigRecord {
    let mut seen = HashSet::new();
    let models = record
        .models
        .into_iter()
        .map(|item| normalize_model_name(&item))
        .filter(|item| !item.is_empty())
        .filter(|item| seen.insert(item.to_ascii_lowercase()))
        .collect::<Vec<_>>();
    ProviderConfigRecord {
        provider_id: normalize_provider_id(&record.provider_id),
        display_name: record
            .display_name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        protocol: record.protocol.trim().to_ascii_lowercase(),
        base_url: record
            .base_url
            .map(|value| value.trim().trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty()),
        api_key: record
            .api_key
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        models,
        is_custom: record.is_custom,
        updated_at: record.updated_at,
    }
}

fn merge_provider_records(current: &mut ProviderConfigRecord, incoming: ProviderConfigRecord) {
    let prefer_incoming = incoming.updated_at >= current.updated_at;
    if prefer_incoming {
        if incoming.display_name.is_some() {
            current.display_name = incoming.display_name.clone();
        }
        if !incoming.protocol.trim().is_empty() {
            current.protocol = incoming.protocol.clone();
        }
        if incoming.base_url.is_some() {
            current.base_url = incoming.base_url.clone();
        }
        if incoming.api_key.is_some() {
            current.api_key = incoming.api_key.clone();
        }
        current.updated_at = incoming.updated_at.clone();
    } else {
        if current.display_name.is_none() {
            current.display_name = incoming.display_name.clone();
        }
        if current.base_url.is_none() {
            current.base_url = incoming.base_url.clone();
        }
        if current.api_key.is_none() {
            current.api_key = incoming.api_key.clone();
        }
        if current.protocol.trim().is_empty() {
            current.protocol = incoming.protocol.clone();
        }
    }
    current.is_custom = current.is_custom && incoming.is_custom;
    let mut seen = current
        .models
        .iter()
        .map(|item| item.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    for item in incoming.models {
        if seen.insert(item.to_ascii_lowercase()) {
            current.models.push(item);
        }
    }
}

fn normalize_provider_toggle_map(input: HashMap<String, bool>) -> HashMap<String, bool> {
    let mut output = HashMap::new();
    for (provider_id, enabled) in input {
        let normalized = normalize_provider_id(&provider_id);
        if normalized.is_empty() {
            continue;
        }
        output.insert(normalized, enabled);
    }
    output
}

fn normalize_model_toggle_map(input: HashMap<String, bool>) -> HashMap<String, bool> {
    let mut output = HashMap::new();
    for (model_id, enabled) in input {
        let normalized = normalize_model_id(&model_id);
        if normalized.is_empty() {
            continue;
        }
        output.insert(normalized, enabled);
    }
    output
}

fn normalize_provider_config_records(rows: Vec<ProviderConfigRecord>) -> Vec<ProviderConfigRecord> {
    let mut merged = BTreeMap::<String, ProviderConfigRecord>::new();
    for row in rows {
        let normalized = normalize_provider_record(row);
        if normalized.provider_id.is_empty() {
            continue;
        }
        if let Some(existing) = merged.get_mut(&normalized.provider_id) {
            merge_provider_records(existing, normalized);
        } else {
            merged.insert(normalized.provider_id.clone(), normalized);
        }
    }
    merged.into_values().collect()
}

fn normalize_default_model_value(value: Option<String>) -> Option<String> {
    value
        .map(|item| normalize_model_id(&item))
        .filter(|item| !item.is_empty())
}

pub fn ensure_db() -> Result<PathBuf, String> {
    let db_path = db_path()?;
    let parent = db_path
        .parent()
        .ok_or_else(|| "数据库目录无效".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建数据库目录失败: {e}"))?;

    let mut conn = open_sqlite_connection(&db_path)?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS agent_skill_toggles (
            agent_id TEXT NOT NULL,
            skill_name TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (agent_id, skill_name)
        );

        CREATE TABLE IF NOT EXISTS agent_mcp_toggles (
            agent_id TEXT NOT NULL,
            server_name TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (agent_id, server_name)
        );

        CREATE TABLE IF NOT EXISTS imported_skills (
            name TEXT PRIMARY KEY,
            source_path TEXT NOT NULL,
            installed_path TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS global_mcp_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            config_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS provider_toggles (
            provider_id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS model_toggles (
            model_id TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS app_prefs (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS provider_configs (
            provider_id TEXT PRIMARY KEY,
            display_name TEXT NULL,
            protocol TEXT NOT NULL DEFAULT 'openai',
            base_url TEXT NULL,
            api_key TEXT NULL,
            models_json TEXT NOT NULL DEFAULT '[]',
            is_custom INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS agent_profile_overrides (
            agent_id TEXT PRIMARY KEY,
            tags_json TEXT NULL,
            system_prompt TEXT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS agent_collaboration_acl (
            caller_agent_id TEXT NOT NULL,
            callee_agent_id TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'private',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (caller_agent_id, callee_agent_id, scope)
        );

        CREATE TABLE IF NOT EXISTS agent_context_files (
            agent_id TEXT NOT NULL,
            file_name TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (agent_id, file_name)
        );

        CREATE TABLE IF NOT EXISTS agent_workspace_folders (
            agent_id TEXT NOT NULL,
            folder_path TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (agent_id, folder_path)
        );

        CREATE TABLE IF NOT EXISTS media_assets (
            asset_id TEXT PRIMARY KEY,
            agent_id TEXT NULL,
            owner_scope TEXT NOT NULL DEFAULT 'other',
            asset_family TEXT NOT NULL DEFAULT 'photo',
            media_kind TEXT NOT NULL DEFAULT 'image',
            source_tool TEXT NULL,
            purpose TEXT NULL,
            prompt_text TEXT NULL,
            negative_prompt TEXT NULL,
            model TEXT NULL,
            mime_type TEXT NOT NULL DEFAULT 'image/png',
            sha256 TEXT NOT NULL,
            width INTEGER NULL,
            height INTEGER NULL,
            byte_size INTEGER NOT NULL DEFAULT 0,
            file_name TEXT NULL,
            saved_path TEXT NULL,
            image_url TEXT NULL,
            relative_path TEXT NULL,
            vision_summary TEXT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_media_assets_agent_scope
            ON media_assets(agent_id, owner_scope, asset_family, media_kind, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_media_assets_sha256
            ON media_assets(sha256);

        CREATE TABLE IF NOT EXISTS capability_providers (
            provider_id TEXT PRIMARY KEY,
            provider_type TEXT NOT NULL,
            display_name TEXT NULL,
            capabilities_json TEXT NOT NULL DEFAULT '[]',
            supported_scopes_json TEXT NOT NULL DEFAULT '[]',
            priority INTEGER NOT NULL DEFAULT 100,
            requirements_json TEXT NOT NULL DEFAULT '{}',
            supports_job INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            health_state TEXT NOT NULL DEFAULT 'unknown',
            input_contract_json TEXT NOT NULL DEFAULT '{}',
            output_contract_json TEXT NOT NULL DEFAULT '{}',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            is_removed INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS capability_provider_bindings (
            capability_key TEXT NOT NULL,
            capability_scope TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (capability_key, capability_scope, provider_id)
        );

        CREATE INDEX IF NOT EXISTS idx_capability_provider_bindings_provider
            ON capability_provider_bindings(provider_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS agent_capability_bindings (
            agent_id TEXT NOT NULL,
            capability_key TEXT NOT NULL,
            capability_scope TEXT NOT NULL,
            provider_id TEXT NOT NULL DEFAULT '',
            binding_type TEXT NOT NULL DEFAULT 'capability',
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (agent_id, capability_key, capability_scope, provider_id, binding_type)
        );

        CREATE INDEX IF NOT EXISTS idx_agent_capability_bindings_agent
            ON agent_capability_bindings(agent_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS renderer_bindings (
            channel TEXT NOT NULL,
            result_kind TEXT NOT NULL,
            media_type TEXT NOT NULL DEFAULT '',
            document_type TEXT NOT NULL DEFAULT '',
            renderer_key TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            fallback_channel TEXT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (channel, result_kind, media_type, document_type)
        );

        CREATE TABLE IF NOT EXISTS provider_health_state (
            provider_id TEXT PRIMARY KEY,
            health_state TEXT NOT NULL DEFAULT 'unknown',
            message TEXT NULL,
            checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS capability_audit_logs (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            provider_id TEXT NULL,
            agent_id TEXT NULL,
            capability_key TEXT NULL,
            capability_scope TEXT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_capability_audit_logs_created
            ON capability_audit_logs(created_at DESC);

        CREATE TABLE IF NOT EXISTS capability_jobs (
            job_id TEXT PRIMARY KEY,
            owner_agent_id TEXT NOT NULL,
            capability_key TEXT NOT NULL,
            capability_scope TEXT NOT NULL DEFAULT 'generic',
            provider_id TEXT NULL,
            provider_type TEXT NULL,
            route TEXT NULL,
            title TEXT NULL,
            summary TEXT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            progress_percent REAL NULL,
            stage TEXT NULL,
            job_type TEXT NULL,
            input_payload_json TEXT NOT NULL DEFAULT '{}',
            result_payload_json TEXT NOT NULL DEFAULT '{}',
            error_message TEXT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at TEXT NULL,
            finished_at TEXT NULL,
            last_heartbeat_at TEXT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_capability_jobs_owner_updated
            ON capability_jobs(owner_agent_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_capability_jobs_status_updated
            ON capability_jobs(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS hidden_agents (
            agent_id TEXT PRIMARY KEY,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chat_groups (
            group_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            tags_json TEXT NOT NULL DEFAULT '[]',
            leader_agent_id TEXT NOT NULL,
            system_prompt TEXT NOT NULL DEFAULT '',
            group_mode TEXT NOT NULL DEFAULT 'leader_dispatch',
            limits_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chat_group_members (
            group_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, agent_id)
        );

        CREATE INDEX IF NOT EXISTS idx_chat_group_members_group_id
            ON chat_group_members(group_id);

        CREATE TABLE IF NOT EXISTS chat_group_admins (
            group_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, agent_id)
        );

        CREATE INDEX IF NOT EXISTS idx_chat_group_admins_group_id
            ON chat_group_admins(group_id);

        CREATE TABLE IF NOT EXISTS task_deliveries (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            owner_agent_id TEXT NOT NULL,
            runtime_key TEXT NULL,
            delivery_kind TEXT NOT NULL DEFAULT 'final',
            dedupe_key TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'pending',
            origin_conversation_type TEXT NULL,
            origin_conversation_id TEXT NULL,
            origin_chat_session_id TEXT NULL,
            origin_message_id TEXT NULL,
            creator_participant_id TEXT NULL,
            creator_participant_name TEXT NULL,
            executor_agent_id TEXT NULL,
            executor_agent_name TEXT NULL,
            report_actor_agent_id TEXT NULL,
            report_actor_agent_name TEXT NULL,
            task_name TEXT NULL,
            run_count INTEGER NULL,
            summary_text TEXT NULL,
            error_text TEXT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reported_at TEXT NULL,
            acknowledged_at TEXT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_task_deliveries_task_id
            ON task_deliveries(task_id);

        CREATE INDEX IF NOT EXISTS idx_task_deliveries_runtime_status
            ON task_deliveries(runtime_key, status, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_task_deliveries_session_status
            ON task_deliveries(origin_chat_session_id, status, created_at DESC);

        DROP TABLE IF EXISTS task_runtime_bindings;
        "#,
    )
    .map_err(|e| format!("初始化数据库结构失败: {e}"))?;
    ensure_agent_profile_override_columns(&conn)?;
    ensure_chat_group_columns(&conn)?;
    ensure_media_assets_columns(&conn)?;
    ensure_provider_model_state_migrated(&mut conn)?;

    Ok(db_path)
}

fn ensure_provider_model_state_migrated(conn: &mut Connection) -> Result<(), String> {
    if PROVIDER_MODEL_STATE_MIGRATED_IN_PROCESS.get().is_some() {
        return Ok(());
    }

    let _guard = PROVIDER_MODEL_STATE_MIGRATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "provider/model 迁移锁不可用".to_string())?;

    if PROVIDER_MODEL_STATE_MIGRATED_IN_PROCESS.get().is_some() {
        return Ok(());
    }

    if has_provider_model_state_migration_marker(conn)? {
        let _ = PROVIDER_MODEL_STATE_MIGRATED_IN_PROCESS.set(());
        return Ok(());
    }

    migrate_provider_model_state(conn)?;
    let _ = PROVIDER_MODEL_STATE_MIGRATED_IN_PROCESS.set(());
    Ok(())
}

fn has_provider_model_state_migration_marker(conn: &Connection) -> Result<bool, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM app_prefs WHERE key = ?1")
        .map_err(|e| format!("查询 provider/model 迁移标记失败: {e}"))?;
    let mut rows = stmt
        .query(params![APP_PREF_KEY_PROVIDER_MODEL_STATE_NORMALIZED_V1])
        .map_err(|e| format!("读取 provider/model 迁移标记失败: {e}"))?;
    let Some(row) = rows
        .next()
        .map_err(|e| format!("读取 provider/model 迁移标记行失败: {e}"))?
    else {
        return Ok(false);
    };
    let value: String = row
        .get(0)
        .map_err(|e| format!("解析 provider/model 迁移标记失败: {e}"))?;
    Ok(value == "1")
}

fn migrate_provider_model_state(conn: &mut Connection) -> Result<(), String> {
    let provider_rows = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT provider_id, display_name, protocol, base_url, api_key, models_json, is_custom, updated_at
                FROM provider_configs
                ORDER BY updated_at ASC, provider_id ASC
                "#,
            )
            .map_err(|e| format!("查询 provider 配置列表失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                let models_json: String = row.get(5)?;
                let models = serde_json::from_str::<Vec<String>>(&models_json).unwrap_or_default();
                Ok(ProviderConfigRecord {
                    provider_id: row.get(0)?,
                    display_name: row.get(1)?,
                    protocol: row.get(2)?,
                    base_url: row.get(3)?,
                    api_key: row.get(4)?,
                    models,
                    is_custom: row.get::<_, i64>(6)? != 0,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| format!("读取 provider 配置列表失败: {e}"))?;
        let mut output = Vec::new();
        for row in rows {
            output.push(row.map_err(|e| format!("解析 provider 配置记录失败: {e}"))?);
        }
        output
    };
    let normalized_providers = normalize_provider_config_records(provider_rows);

    let provider_toggles = {
        let mut stmt = conn
            .prepare("SELECT provider_id, enabled FROM provider_toggles")
            .map_err(|e| format!("查询 provider 开关失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                let provider_id: String = row.get(0)?;
                let enabled: i64 = row.get(1)?;
                Ok((provider_id, enabled != 0))
            })
            .map_err(|e| format!("读取 provider 开关失败: {e}"))?;
        let mut output = HashMap::new();
        for row in rows {
            let (provider_id, enabled) = row.map_err(|e| format!("解析 provider 开关失败: {e}"))?;
            output.insert(provider_id, enabled);
        }
        normalize_provider_toggle_map(output)
    };

    let model_toggles = {
        let mut stmt = conn
            .prepare("SELECT model_id, enabled FROM model_toggles")
            .map_err(|e| format!("查询 model 开关失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                let model_id: String = row.get(0)?;
                let enabled: i64 = row.get(1)?;
                Ok((model_id, enabled != 0))
            })
            .map_err(|e| format!("读取 model 开关失败: {e}"))?;
        let mut output = HashMap::new();
        for row in rows {
            let (model_id, enabled) = row.map_err(|e| format!("解析 model 开关失败: {e}"))?;
            output.insert(model_id, enabled);
        }
        normalize_model_toggle_map(output)
    };

    let default_model = {
        let mut stmt = conn
            .prepare("SELECT value FROM app_prefs WHERE key = 'default_model_id'")
            .map_err(|e| format!("查询默认模型失败: {e}"))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| format!("读取默认模型失败: {e}"))?;
        match rows
            .next()
            .map_err(|e| format!("读取默认模型行失败: {e}"))?
        {
            Some(row) => Some(
                row.get::<_, String>(0)
                    .map_err(|e| format!("解析默认模型失败: {e}"))?,
            ),
            None => None,
        }
    };
    let normalized_default_model = normalize_default_model_value(default_model);

    let tx = conn
        .transaction()
        .map_err(|e| format!("开启 provider/model 迁移事务失败: {e}"))?;

    tx.execute("DELETE FROM provider_configs", [])
        .map_err(|e| format!("清理 provider 配置失败: {e}"))?;
    for record in normalized_providers {
        tx.execute(
            r#"
            INSERT INTO provider_configs(
                provider_id, display_name, protocol, base_url, api_key, models_json, is_custom, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
            "#,
            params![
                record.provider_id,
                record.display_name,
                record.protocol,
                record.base_url,
                record.api_key,
                serde_json::to_string(&record.models)
                    .map_err(|e| format!("序列化模型列表失败: {e}"))?,
                if record.is_custom { 1 } else { 0 },
            ],
        )
        .map_err(|e| format!("回写 provider 配置失败: {e}"))?;
    }

    tx.execute("DELETE FROM provider_toggles", [])
        .map_err(|e| format!("清理 provider 开关失败: {e}"))?;
    for (provider_id, enabled) in provider_toggles {
        tx.execute(
            r#"
            INSERT INTO provider_toggles(provider_id, enabled, updated_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            "#,
            params![provider_id, if enabled { 1 } else { 0 }],
        )
        .map_err(|e| format!("回写 provider 开关失败: {e}"))?;
    }

    tx.execute("DELETE FROM model_toggles", [])
        .map_err(|e| format!("清理 model 开关失败: {e}"))?;
    for (model_id, enabled) in model_toggles {
        tx.execute(
            r#"
            INSERT INTO model_toggles(model_id, enabled, updated_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            "#,
            params![model_id, if enabled { 1 } else { 0 }],
        )
        .map_err(|e| format!("回写 model 开关失败: {e}"))?;
    }

    tx.execute("DELETE FROM app_prefs WHERE key = 'default_model_id'", [])
        .map_err(|e| format!("清理默认模型失败: {e}"))?;
    if let Some(model_id) = normalized_default_model {
        tx.execute(
            r#"
            INSERT INTO app_prefs(key, value, updated_at)
            VALUES ('default_model_id', ?1, CURRENT_TIMESTAMP)
            "#,
            params![model_id],
        )
        .map_err(|e| format!("回写默认模型失败: {e}"))?;
    }

    tx.execute(
        r#"
        INSERT INTO app_prefs(key, value, updated_at)
        VALUES (?1, '1', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![APP_PREF_KEY_PROVIDER_MODEL_STATE_NORMALIZED_V1],
    )
    .map_err(|e| format!("写入 provider/model 迁移标记失败: {e}"))?;

    tx.commit()
        .map_err(|e| format!("提交 provider/model 迁移事务失败: {e}"))?;
    Ok(())
}

pub fn bootstrap_storage() -> Result<(), String> {
    if should_enable_legacy_migration() {
        path_resolver::migrate_legacy_openfang_layout()?;
    }
    path_resolver::migrate_runtime_agents_media_to_workspaces()?;

    let db = db_path()?;
    if let Some(parent) = db.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建数据库目录失败: {e}"))?;
    }

    let skills = skills_root()?;
    fs::create_dir_all(&skills).map_err(|e| format!("创建 skills 目录失败: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        capability_job_is_placeholder, capability_job_status_rank, make_model_id,
        merge_capability_job_records, normalize_model_id, normalize_provider_id,
        CapabilityJobRecord,
    };
    use serde_json::json;

    #[test]
    fn normalize_provider_id_only_trims() {
        assert_eq!(normalize_provider_id(" nvidia-nim "), "nvidia-nim");
        assert_eq!(normalize_provider_id("NVIDIA"), "NVIDIA");
    }

    #[test]
    fn normalize_model_id_keeps_provider_and_model_raw_value() {
        assert_eq!(
            normalize_model_id("nvidia-nim::xianyu/glm-4.7"),
            "nvidia-nim::xianyu/glm-4.7"
        );
        assert_eq!(
            make_model_id("nvidia-nim", "xianyu/glm-4.7"),
            "nvidia-nim::xianyu/glm-4.7"
        );
    }

    #[test]
    fn capability_job_placeholder_detection_matches_frontend_clobber_shape() {
        let record = CapabilityJobRecord {
            job_id: "job-1".to_string(),
            owner_agent_id: "agent-1".to_string(),
            capability_key: "generate.video".to_string(),
            capability_scope: "generic".to_string(),
            provider_id: Some("component_skill:image2video".to_string()),
            provider_type: Some("component_skill".to_string()),
            route: Some("component_skill".to_string()),
            title: Some("LTX2.3图片生成视频".to_string()),
            summary: Some("LTX2.3图片生成视频 已提交，正在生成视频".to_string()),
            status: "queued".to_string(),
            progress_percent: None,
            stage: Some("dispatching".to_string()),
            job_type: Some("video".to_string()),
            input_payload: json!({}),
            result_payload: json!({}),
            error_message: None,
            metadata: json!({
                "componentEnglishName": "image2video",
                "dispatchPending": true
            }),
            created_at: String::new(),
            updated_at: String::new(),
            started_at: None,
            finished_at: None,
            last_heartbeat_at: None,
        };

        assert!(capability_job_is_placeholder(&record));
        assert_eq!(capability_job_status_rank(&record.status), 0);
    }

    #[test]
    fn merge_capability_job_records_keeps_richer_submitted_component_state() {
        let existing = CapabilityJobRecord {
            job_id: "job-2".to_string(),
            owner_agent_id: "agent-1".to_string(),
            capability_key: "generate.video".to_string(),
            capability_scope: "generic".to_string(),
            provider_id: Some("component_skill:image2video".to_string()),
            provider_type: Some("component_skill".to_string()),
            route: Some("component_skill".to_string()),
            title: Some("LTX2.3图片生成视频".to_string()),
            summary: Some("LTX2.3图片生成视频 已提交到 ComfyUI，正在生成视频".to_string()),
            status: "running".to_string(),
            progress_percent: None,
            stage: Some("submitted".to_string()),
            job_type: Some("video".to_string()),
            input_payload: json!({}),
            result_payload: json!({
                "presentable_result": {
                    "kind": "job_result",
                    "job_id": "job-2",
                    "status": "running"
                },
                "raw": {
                    "prompt_id": "remote-1"
                }
            }),
            error_message: None,
            metadata: json!({
                "componentEnglishName": "image2video",
                "dispatchPending": false,
                "providerRequestId": "remote-1"
            }),
            created_at: String::new(),
            updated_at: String::new(),
            started_at: Some("2026-03-27 08:00:00".to_string()),
            finished_at: None,
            last_heartbeat_at: Some("2026-03-27 08:00:02".to_string()),
        };
        let incoming = CapabilityJobRecord {
            job_id: "job-2".to_string(),
            owner_agent_id: "agent-1".to_string(),
            capability_key: "generate.video".to_string(),
            capability_scope: "generic".to_string(),
            provider_id: Some("component_skill:image2video".to_string()),
            provider_type: Some("component_skill".to_string()),
            route: Some("component_skill".to_string()),
            title: Some("LTX2.3图片生成视频".to_string()),
            summary: Some("LTX2.3图片生成视频 已提交，正在生成视频".to_string()),
            status: "queued".to_string(),
            progress_percent: None,
            stage: Some("dispatching".to_string()),
            job_type: Some("video".to_string()),
            input_payload: json!({}),
            result_payload: json!({}),
            error_message: None,
            metadata: json!({
                "componentEnglishName": "image2video",
                "dispatchPending": true
            }),
            created_at: String::new(),
            updated_at: String::new(),
            started_at: None,
            finished_at: None,
            last_heartbeat_at: None,
        };

        let merged = merge_capability_job_records(&existing, incoming);
        assert_eq!(merged.status, "running");
        assert_eq!(merged.stage.as_deref(), Some("submitted"));
        assert_eq!(
            merged
                .metadata
                .get("providerRequestId")
                .and_then(|value| value.as_str()),
            Some("remote-1")
        );
        assert_eq!(
            merged
                .result_payload
                .get("presentable_result")
                .and_then(|value| value.get("kind"))
                .and_then(|value| value.as_str()),
            Some("job_result")
        );
        assert_eq!(
            merged
                .metadata
                .get("dispatchPending")
                .and_then(|value| value.as_bool()),
            Some(false)
        );
    }

    #[test]
    fn merge_capability_job_records_keeps_dispatch_pending_false_sticky() {
        let existing = CapabilityJobRecord {
            job_id: "job-3".to_string(),
            owner_agent_id: "agent-1".to_string(),
            capability_key: "generate.video".to_string(),
            capability_scope: "generic".to_string(),
            provider_id: Some("component_skill:image2video".to_string()),
            provider_type: Some("component_skill".to_string()),
            route: Some("component_skill".to_string()),
            title: Some("LTX2.3图片生成视频".to_string()),
            summary: Some("已提交到 ComfyUI".to_string()),
            status: "running".to_string(),
            progress_percent: None,
            stage: Some("submitted".to_string()),
            job_type: Some("video".to_string()),
            input_payload: json!({}),
            result_payload: json!({
                "presentable_result": {
                    "kind": "job_result",
                    "job_id": "job-3",
                    "status": "running"
                }
            }),
            error_message: None,
            metadata: json!({
                "dispatchPending": false,
                "providerRequestId": "remote-3",
                "source": "component_center"
            }),
            created_at: String::new(),
            updated_at: String::new(),
            started_at: Some("2026-03-27 08:00:00".to_string()),
            finished_at: None,
            last_heartbeat_at: Some("2026-03-27 08:00:02".to_string()),
        };
        let incoming = CapabilityJobRecord {
            job_id: "job-3".to_string(),
            owner_agent_id: "agent-1".to_string(),
            capability_key: "generate.video".to_string(),
            capability_scope: "generic".to_string(),
            provider_id: Some("component_skill:image2video".to_string()),
            provider_type: Some("component_skill".to_string()),
            route: Some("component_skill".to_string()),
            title: Some("LTX2.3图片生成视频".to_string()),
            summary: Some("已提交，正在生成视频".to_string()),
            status: "running".to_string(),
            progress_percent: None,
            stage: Some("submitted".to_string()),
            job_type: Some("video".to_string()),
            input_payload: json!({}),
            result_payload: json!({
                "presentable_result": {
                    "kind": "job_result",
                    "job_id": "job-3",
                    "status": "running"
                }
            }),
            error_message: None,
            metadata: json!({
                "dispatchPending": true,
                "providerRequestId": "remote-3",
                "source": "openfang_runtime"
            }),
            created_at: String::new(),
            updated_at: String::new(),
            started_at: Some("2026-03-27 08:00:00".to_string()),
            finished_at: None,
            last_heartbeat_at: Some("2026-03-27 08:00:03".to_string()),
        };

        let merged = merge_capability_job_records(&existing, incoming);
        assert_eq!(
            merged
                .metadata
                .get("dispatchPending")
                .and_then(|value| value.as_bool()),
            Some(false)
        );
        assert_eq!(
            merged
                .metadata
                .get("providerRequestId")
                .and_then(|value| value.as_str()),
            Some("remote-3")
        );
    }
}

fn should_enable_legacy_migration() -> bool {
    env::var("WEBOT_ENABLE_LEGACY_MIGRATION")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn ensure_agent_profile_override_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(agent_profile_overrides)")
        .map_err(|e| format!("读取 agent_profile_overrides 字段失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("解析 agent_profile_overrides 字段失败: {e}"))?;

    let mut columns = std::collections::HashSet::new();
    for row in rows {
        columns.insert(row.map_err(|e| format!("读取字段名失败: {e}"))?);
    }

    for column in [
        "description",
        "avatar_url",
        "portrait_url",
        "english_name",
        "nickname",
        "collaboration_json",
        "channel_binding_json",
        "tts_config_json",
        "speaker_profiles_json",
    ] {
        if columns.contains(column) {
            continue;
        }
        let sql = format!("ALTER TABLE agent_profile_overrides ADD COLUMN {column} TEXT NULL");
        conn.execute(&sql, [])
            .map_err(|e| format!("为 agent_profile_overrides 增加字段 {column} 失败: {e}"))?;
    }
    Ok(())
}

pub fn set_tts_config(config: &Value) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO app_prefs(key, value, updated_at)
        VALUES (?1, ?2, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![APP_PREF_KEY_TTS_CONFIG, config.to_string()],
    )
    .map_err(|e| format!("写入 TTS 配置失败: {e}"))?;
    Ok(())
}

pub fn get_tts_config() -> Result<Option<Value>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare("SELECT value FROM app_prefs WHERE key = ?1")
        .map_err(|e| format!("查询 TTS 配置失败: {e}"))?;
    let mut rows = stmt
        .query(params![APP_PREF_KEY_TTS_CONFIG])
        .map_err(|e| format!("读取 TTS 配置失败: {e}"))?;
    let Some(row) = rows
        .next()
        .map_err(|e| format!("读取 TTS 配置行失败: {e}"))?
    else {
        return Ok(None);
    };
    let value: String = row.get(0).map_err(|e| format!("解析 TTS 配置失败: {e}"))?;
    let config =
        serde_json::from_str::<Value>(&value).map_err(|e| format!("反序列化 TTS 配置失败: {e}"))?;
    Ok(Some(config))
}

fn ensure_chat_group_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(chat_groups)")
        .map_err(|e| format!("读取 chat_groups 字段失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("解析 chat_groups 字段失败: {e}"))?;

    let mut columns = std::collections::HashSet::new();
    for row in rows {
        columns.insert(row.map_err(|e| format!("读取字段名失败: {e}"))?);
    }

    for (column, default_value) in [
        ("group_mode", "TEXT NOT NULL DEFAULT 'leader_dispatch'"),
        ("limits_json", "TEXT NOT NULL DEFAULT '{}'"),
    ] {
        if columns.contains(column) {
            continue;
        }
        let sql = format!("ALTER TABLE chat_groups ADD COLUMN {column} {default_value}");
        conn.execute_batch(&sql)
            .map_err(|e| format!("补充 chat_groups.{column} 失败: {e}"))?;
    }
    Ok(())
}

pub fn skills_root() -> Result<PathBuf, String> {
    path_resolver::skills_root()
}

pub fn set_agent_skill_enabled(
    agent_id: &str,
    skill_name: &str,
    enabled: bool,
) -> Result<(), String> {
    let conn = open_conn()?;
    if enabled {
        conn.execute(
            r#"
            INSERT INTO agent_skill_toggles(agent_id, skill_name, updated_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            ON CONFLICT(agent_id, skill_name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            "#,
            params![agent_id, skill_name],
        )
        .map_err(|e| format!("写入 skill 开关失败: {e}"))?;
    } else {
        conn.execute(
            "DELETE FROM agent_skill_toggles WHERE agent_id = ?1 AND skill_name = ?2",
            params![agent_id, skill_name],
        )
        .map_err(|e| format!("删除 skill 开关失败: {e}"))?;
    }
    Ok(())
}

pub fn list_agent_enabled_skills(agent_id: &str) -> Result<Vec<String>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT skill_name FROM agent_skill_toggles WHERE agent_id = ?1 ORDER BY skill_name ASC",
        )
        .map_err(|e| format!("查询 skill 开关失败: {e}"))?;

    let rows = stmt
        .query_map(params![agent_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取 skill 开关失败: {e}"))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("解析 skill 开关失败: {e}"))?);
    }
    Ok(result)
}

pub fn set_agent_mcp_enabled(
    agent_id: &str,
    server_name: &str,
    enabled: bool,
) -> Result<(), String> {
    let conn = open_conn()?;
    if enabled {
        conn.execute(
            r#"
            INSERT INTO agent_mcp_toggles(agent_id, server_name, updated_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            ON CONFLICT(agent_id, server_name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            "#,
            params![agent_id, server_name],
        )
        .map_err(|e| format!("写入 MCP 开关失败: {e}"))?;
    } else {
        conn.execute(
            "DELETE FROM agent_mcp_toggles WHERE agent_id = ?1 AND server_name = ?2",
            params![agent_id, server_name],
        )
        .map_err(|e| format!("删除 MCP 开关失败: {e}"))?;
    }
    Ok(())
}

pub fn list_agent_enabled_mcp_servers(agent_id: &str) -> Result<Vec<String>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT server_name FROM agent_mcp_toggles WHERE agent_id = ?1 ORDER BY server_name ASC",
        )
        .map_err(|e| format!("查询 MCP 开关失败: {e}"))?;

    let rows = stmt
        .query_map(params![agent_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取 MCP 开关失败: {e}"))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("解析 MCP 开关失败: {e}"))?);
    }
    Ok(result)
}

pub fn list_all_enabled_mcp_servers() -> Result<Vec<String>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT server_name FROM agent_mcp_toggles ORDER BY server_name ASC")
        .map_err(|e| format!("查询全局 MCP 开关失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取全局 MCP 开关失败: {e}"))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("解析全局 MCP 开关失败: {e}"))?);
    }
    Ok(result)
}

pub fn list_agent_workspace_folders(agent_id: &str) -> Result<Vec<String>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT folder_path FROM agent_workspace_folders WHERE agent_id = ?1 ORDER BY folder_path ASC",
        )
        .map_err(|e| format!("查询智能体工作空间目录失败: {e}"))?;

    let rows = stmt
        .query_map(params![agent_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取智能体工作空间目录失败: {e}"))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("解析智能体工作空间目录失败: {e}"))?);
    }
    Ok(result)
}

pub fn replace_agent_workspace_folders(agent_id: &str, folders: &[String]) -> Result<(), String> {
    let mut conn = open_conn()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启工作空间目录事务失败: {e}"))?;

    tx.execute(
        "DELETE FROM agent_workspace_folders WHERE agent_id = ?1",
        params![agent_id],
    )
    .map_err(|e| format!("清空工作空间目录失败: {e}"))?;

    for folder in folders {
        tx.execute(
            r#"
            INSERT INTO agent_workspace_folders(agent_id, folder_path, updated_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            ON CONFLICT(agent_id, folder_path) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            "#,
            params![agent_id, folder],
        )
        .map_err(|e| format!("写入工作空间目录失败: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("提交工作空间目录事务失败: {e}"))?;
    Ok(())
}

pub fn list_hidden_agent_ids() -> Result<Vec<String>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare("SELECT agent_id FROM hidden_agents ORDER BY agent_id ASC")
        .map_err(|e| format!("查询隐藏智能体列表失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取隐藏智能体列表失败: {e}"))?;
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析隐藏智能体 ID 失败: {e}"))?);
    }
    Ok(output)
}

pub fn set_agent_hidden(agent_id: &str, hidden: bool) -> Result<(), String> {
    let conn = open_conn()?;
    if hidden {
        conn.execute(
            r#"
            INSERT INTO hidden_agents(agent_id, updated_at)
            VALUES (?1, CURRENT_TIMESTAMP)
            ON CONFLICT(agent_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            "#,
            params![agent_id],
        )
        .map_err(|e| format!("写入隐藏智能体失败: {e}"))?;
    } else {
        conn.execute(
            "DELETE FROM hidden_agents WHERE agent_id = ?1",
            params![agent_id],
        )
        .map_err(|e| format!("删除隐藏智能体标记失败: {e}"))?;
    }
    Ok(())
}

pub fn clear_agent_local_data(agent_id: &str) -> Result<(), String> {
    let mut conn = open_conn()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启清理智能体本地数据事务失败: {e}"))?;
    for sql in [
        "DELETE FROM agent_skill_toggles WHERE agent_id = ?1",
        "DELETE FROM agent_mcp_toggles WHERE agent_id = ?1",
        "DELETE FROM agent_profile_overrides WHERE agent_id = ?1",
        "DELETE FROM agent_context_files WHERE agent_id = ?1",
        "DELETE FROM agent_workspace_folders WHERE agent_id = ?1",
        "DELETE FROM media_assets WHERE agent_id = ?1",
    ] {
        tx.execute(sql, params![agent_id])
            .map_err(|e| format!("清理智能体本地数据失败: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("提交清理智能体本地数据事务失败: {e}"))?;
    Ok(())
}

pub fn upsert_imported_skill(
    name: &str,
    source_path: &Path,
    installed_path: &Path,
) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO imported_skills(name, source_path, installed_path, updated_at)
        VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
        ON CONFLICT(name) DO UPDATE SET
            source_path = excluded.source_path,
            installed_path = excluded.installed_path,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            name,
            source_path.to_string_lossy().to_string(),
            installed_path.to_string_lossy().to_string()
        ],
    )
    .map_err(|e| format!("写入导入 skill 记录失败: {e}"))?;
    Ok(())
}

pub fn list_imported_skills() -> Result<Vec<ImportedSkillRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT name, source_path, installed_path, updated_at
            FROM imported_skills
            ORDER BY name ASC
            "#,
        )
        .map_err(|e| format!("查询导入 skill 记录失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ImportedSkillRecord {
                name: row.get(0)?,
                source_path: row.get(1)?,
                installed_path: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("读取导入 skill 记录失败: {e}"))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("解析导入 skill 记录失败: {e}"))?);
    }
    Ok(result)
}

pub fn delete_imported_skill(name: &str) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute("DELETE FROM imported_skills WHERE name = ?1", params![name])
        .map_err(|e| format!("删除导入 skill 记录失败: {e}"))?;
    Ok(())
}

pub fn set_global_mcp_config(config: &Value) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO global_mcp_config(id, config_json, updated_at)
        VALUES (1, ?1, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            config_json = excluded.config_json,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![config.to_string()],
    )
    .map_err(|e| format!("写入全局 MCP 配置失败: {e}"))?;
    Ok(())
}

pub fn get_global_mcp_config() -> Result<Option<GlobalMcpConfigRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare("SELECT config_json, updated_at FROM global_mcp_config WHERE id = 1")
        .map_err(|e| format!("查询全局 MCP 配置失败: {e}"))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| format!("读取全局 MCP 配置失败: {e}"))?;
    let Some(row) = rows
        .next()
        .map_err(|e| format!("读取全局 MCP 配置行失败: {e}"))?
    else {
        return Ok(None);
    };

    let config_json: String = row
        .get(0)
        .map_err(|e| format!("解析全局 MCP 配置失败: {e}"))?;
    let updated_at: String = row
        .get(1)
        .map_err(|e| format!("解析全局 MCP 更新时间失败: {e}"))?;
    let config = serde_json::from_str::<Value>(&config_json)
        .map_err(|e| format!("全局 MCP 配置 JSON 反序列化失败: {e}"))?;
    Ok(Some(GlobalMcpConfigRecord { config, updated_at }))
}

pub fn clear_global_mcp_config() -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute("DELETE FROM global_mcp_config WHERE id = 1", [])
        .map_err(|e| format!("清空全局 MCP 配置失败: {e}"))?;
    Ok(())
}

pub fn set_provider_enabled(provider_id: &str, enabled: bool) -> Result<(), String> {
    let provider_id = normalize_provider_id(provider_id);
    if provider_id.is_empty() {
        return Err("provider id 不能为空".to_string());
    }
    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO provider_toggles(provider_id, enabled, updated_at)
        VALUES (?1, ?2, CURRENT_TIMESTAMP)
        ON CONFLICT(provider_id) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![provider_id, if enabled { 1 } else { 0 }],
    )
    .map_err(|e| format!("写入 provider 开关失败: {e}"))?;
    Ok(())
}

fn ensure_media_assets_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(media_assets)")
        .map_err(|e| format!("读取 media_assets 字段失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("解析 media_assets 字段失败: {e}"))?;

    let mut columns = std::collections::HashSet::new();
    for row in rows {
        columns.insert(row.map_err(|e| format!("读取 media_assets 字段名失败: {e}"))?);
    }

    for (column, definition) in [
        ("agent_id", "TEXT NULL"),
        ("owner_scope", "TEXT NOT NULL DEFAULT 'other'"),
        ("asset_family", "TEXT NOT NULL DEFAULT 'photo'"),
        ("media_kind", "TEXT NOT NULL DEFAULT 'image'"),
        ("source_tool", "TEXT NULL"),
        ("purpose", "TEXT NULL"),
        ("prompt_text", "TEXT NULL"),
        ("negative_prompt", "TEXT NULL"),
        ("model", "TEXT NULL"),
        ("mime_type", "TEXT NOT NULL DEFAULT 'image/png'"),
        ("sha256", "TEXT NOT NULL DEFAULT ''"),
        ("width", "INTEGER NULL"),
        ("height", "INTEGER NULL"),
        ("byte_size", "INTEGER NOT NULL DEFAULT 0"),
        ("file_name", "TEXT NULL"),
        ("saved_path", "TEXT NULL"),
        ("image_url", "TEXT NULL"),
        ("relative_path", "TEXT NULL"),
        ("vision_summary", "TEXT NULL"),
        ("tags_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("metadata_json", "TEXT NOT NULL DEFAULT '{}'"),
        ("created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"),
        ("updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"),
    ] {
        if columns.contains(column) {
            continue;
        }
        let sql = format!("ALTER TABLE media_assets ADD COLUMN {column} {definition}");
        conn.execute(&sql, [])
            .map_err(|e| format!("为 media_assets 增加字段 {column} 失败: {e}"))?;
    }

    Ok(())
}

pub fn delete_provider_toggle(provider_id: &str) -> Result<(), String> {
    let provider_id = normalize_provider_id(provider_id);
    if provider_id.is_empty() {
        return Ok(());
    }
    let conn = open_conn()?;
    conn.execute(
        "DELETE FROM provider_toggles WHERE provider_id = ?1",
        params![provider_id],
    )
    .map_err(|e| format!("删除 provider 开关失败: {e}"))?;
    Ok(())
}

pub fn list_provider_enabled_map() -> Result<HashMap<String, bool>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare("SELECT provider_id, enabled FROM provider_toggles")
        .map_err(|e| format!("查询 provider 开关失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let provider_id: String = row.get(0)?;
            let enabled: i64 = row.get(1)?;
            Ok((provider_id, enabled != 0))
        })
        .map_err(|e| format!("读取 provider 开关失败: {e}"))?;

    let mut output = HashMap::new();
    for row in rows {
        let (provider_id, enabled) = row.map_err(|e| format!("解析 provider 开关失败: {e}"))?;
        output.insert(provider_id, enabled);
    }
    Ok(normalize_provider_toggle_map(output))
}

pub fn set_model_enabled(model_id: &str, enabled: bool) -> Result<(), String> {
    let model_id = normalize_model_id(model_id);
    if model_id.is_empty() {
        return Err("model id 不能为空".to_string());
    }
    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO model_toggles(model_id, enabled, updated_at)
        VALUES (?1, ?2, CURRENT_TIMESTAMP)
        ON CONFLICT(model_id) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![model_id, if enabled { 1 } else { 0 }],
    )
    .map_err(|e| format!("写入 model 开关失败: {e}"))?;
    Ok(())
}

pub fn delete_model_toggles_by_provider(provider_id: &str) -> Result<usize, String> {
    let provider_id = normalize_provider_id(provider_id);
    if provider_id.is_empty() {
        return Ok(0);
    }
    let conn = open_conn()?;
    conn.execute(
        "DELETE FROM model_toggles WHERE lower(model_id) LIKE lower(?1 || '::%')",
        params![provider_id],
    )
    .map_err(|e| format!("删除 provider 关联 model 开关失败: {e}"))
}

pub fn list_model_enabled_map() -> Result<HashMap<String, bool>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare("SELECT model_id, enabled FROM model_toggles")
        .map_err(|e| format!("查询 model 开关失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let model_id: String = row.get(0)?;
            let enabled: i64 = row.get(1)?;
            Ok((model_id, enabled != 0))
        })
        .map_err(|e| format!("读取 model 开关失败: {e}"))?;

    let mut output = HashMap::new();
    for row in rows {
        let (model_id, enabled) = row.map_err(|e| format!("解析 model 开关失败: {e}"))?;
        output.insert(model_id, enabled);
    }
    Ok(normalize_model_toggle_map(output))
}

pub fn set_default_model(model_id: &str) -> Result<(), String> {
    let model_id = normalize_model_id(model_id);
    if model_id.is_empty() {
        return Err("默认模型不能为空".to_string());
    }
    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO app_prefs(key, value, updated_at)
        VALUES ('default_model_id', ?1, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![model_id],
    )
    .map_err(|e| format!("写入默认模型失败: {e}"))?;
    Ok(())
}

const APP_PREF_KEY_MEMORY_ENHANCEMENT_CONFIG: &str = "memory_enhancement_config";

pub fn set_memory_enhancement_config(config: &Value) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO app_prefs(key, value, updated_at)
        VALUES (?1, ?2, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![APP_PREF_KEY_MEMORY_ENHANCEMENT_CONFIG, config.to_string()],
    )
    .map_err(|e| format!("写入记忆增强配置失败: {e}"))?;
    Ok(())
}

pub fn get_memory_enhancement_config() -> Result<Option<Value>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare("SELECT value FROM app_prefs WHERE key = ?1")
        .map_err(|e| format!("查询记忆增强配置失败: {e}"))?;
    let mut rows = stmt
        .query(params![APP_PREF_KEY_MEMORY_ENHANCEMENT_CONFIG])
        .map_err(|e| format!("读取记忆增强配置失败: {e}"))?;
    let Some(row) = rows
        .next()
        .map_err(|e| format!("读取记忆增强配置行失败: {e}"))?
    else {
        return Ok(None);
    };
    let value: String = row
        .get(0)
        .map_err(|e| format!("解析记忆增强配置失败: {e}"))?;
    let config = serde_json::from_str::<Value>(&value)
        .map_err(|e| format!("反序列化记忆增强配置失败: {e}"))?;
    Ok(Some(config))
}

pub fn clear_default_model() -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute("DELETE FROM app_prefs WHERE key = 'default_model_id'", [])
        .map_err(|e| format!("清空默认模型失败: {e}"))?;
    Ok(())
}

pub fn get_default_model() -> Result<Option<String>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare("SELECT value FROM app_prefs WHERE key = 'default_model_id'")
        .map_err(|e| format!("查询默认模型失败: {e}"))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("读取默认模型失败: {e}"))?;
    let Some(row) = rows
        .next()
        .map_err(|e| format!("读取默认模型行失败: {e}"))?
    else {
        return Ok(None);
    };
    let value: String = row.get(0).map_err(|e| format!("解析默认模型失败: {e}"))?;
    Ok(normalize_default_model_value(Some(value)))
}

pub fn list_model_assignments() -> Result<Vec<ModelAssignmentRecord>, String> {
    let provider_configs = list_provider_configs()?;
    let model_enabled = list_model_enabled_map()?;
    let mut output = Vec::new();

    for provider in provider_configs {
        for model_name in provider.models {
            let normalized_name = model_name.trim().to_string();
            if normalized_name.is_empty() {
                continue;
            }
            let model_id = make_model_id(&provider.provider_id, &normalized_name);
            output.push(ModelAssignmentRecord {
                model_id: model_id.clone(),
                provider_id: provider.provider_id.clone(),
                model_name: normalized_name,
                enabled: model_enabled.get(&model_id).copied().unwrap_or(true),
            });
        }
    }

    Ok(output)
}

pub fn upsert_provider_config(record: &ProviderConfigRecord) -> Result<(), String> {
    let record = normalize_provider_record(record.clone());
    if record.provider_id.is_empty() {
        return Err("provider id 不能为空".to_string());
    }
    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO provider_configs(
            provider_id, display_name, protocol, base_url, api_key, models_json, is_custom, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
        ON CONFLICT(provider_id) DO UPDATE SET
            display_name = excluded.display_name,
            protocol = excluded.protocol,
            base_url = excluded.base_url,
            api_key = excluded.api_key,
            models_json = excluded.models_json,
            is_custom = excluded.is_custom,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            record.provider_id,
            record.display_name,
            record.protocol,
            record.base_url,
            record.api_key,
            serde_json::to_string(&record.models).map_err(|e| format!("序列化模型列表失败: {e}"))?,
            if record.is_custom { 1 } else { 0 },
        ],
    )
    .map_err(|e| format!("写入 provider 配置失败: {e}"))?;
    Ok(())
}

pub fn get_provider_config(provider_id: &str) -> Result<Option<ProviderConfigRecord>, String> {
    let provider_id = normalize_provider_id(provider_id);
    if provider_id.is_empty() {
        return Ok(None);
    }
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT provider_id, display_name, protocol, base_url, api_key, models_json, is_custom, updated_at
            FROM provider_configs
            WHERE provider_id = ?1
            "#,
        )
        .map_err(|e| format!("查询 provider 配置失败: {e}"))?;

    let mut rows = stmt
        .query(params![provider_id])
        .map_err(|e| format!("读取 provider 配置失败: {e}"))?;
    let Some(row) = rows
        .next()
        .map_err(|e| format!("读取 provider 配置行失败: {e}"))?
    else {
        return Ok(None);
    };

    let models_json: String = row
        .get(5)
        .map_err(|e| format!("读取 provider models_json 失败: {e}"))?;
    let models = serde_json::from_str::<Vec<String>>(&models_json)
        .map_err(|e| format!("反序列化 provider models_json 失败: {e}"))?;
    Ok(Some(normalize_provider_record(ProviderConfigRecord {
        provider_id: row
            .get(0)
            .map_err(|e| format!("读取 provider_id 失败: {e}"))?,
        display_name: row
            .get(1)
            .map_err(|e| format!("读取 display_name 失败: {e}"))?,
        protocol: row.get(2).map_err(|e| format!("读取 protocol 失败: {e}"))?,
        base_url: row.get(3).map_err(|e| format!("读取 base_url 失败: {e}"))?,
        api_key: row.get(4).map_err(|e| format!("读取 api_key 失败: {e}"))?,
        models,
        is_custom: row
            .get::<_, i64>(6)
            .map_err(|e| format!("读取 is_custom 失败: {e}"))?
            != 0,
        updated_at: row
            .get(7)
            .map_err(|e| format!("读取 updated_at 失败: {e}"))?,
    })))
}

pub fn list_provider_configs() -> Result<Vec<ProviderConfigRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT provider_id, display_name, protocol, base_url, api_key, models_json, is_custom, updated_at
            FROM provider_configs
            ORDER BY provider_id ASC
            "#,
        )
        .map_err(|e| format!("查询 provider 配置列表失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let models_json: String = row.get(5)?;
            let models = serde_json::from_str::<Vec<String>>(&models_json).unwrap_or_default();
            Ok(ProviderConfigRecord {
                provider_id: row.get(0)?,
                display_name: row.get(1)?,
                protocol: row.get(2)?,
                base_url: row.get(3)?,
                api_key: row.get(4)?,
                models,
                is_custom: row.get::<_, i64>(6)? != 0,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("读取 provider 配置列表失败: {e}"))?;

    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析 provider 配置记录失败: {e}"))?);
    }
    Ok(normalize_provider_config_records(output))
}

pub fn delete_provider_config(provider_id: &str) -> Result<(), String> {
    let provider_id = normalize_provider_id(provider_id);
    if provider_id.is_empty() {
        return Ok(());
    }
    let conn = open_conn()?;
    conn.execute(
        "DELETE FROM provider_configs WHERE provider_id = ?1",
        params![provider_id],
    )
    .map_err(|e| format!("删除 provider 配置失败: {e}"))?;
    Ok(())
}

pub fn get_agent_profile_override(
    agent_id: &str,
) -> Result<Option<AgentProfileOverrideRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT agent_id, tags_json, description, system_prompt, collaboration_json, channel_binding_json, avatar_url, portrait_url, english_name, nickname, tts_config_json, speaker_profiles_json, updated_at
            FROM agent_profile_overrides
            WHERE agent_id = ?1
            "#,
        )
        .map_err(|e| format!("查询智能体资料覆盖失败: {e}"))?;

    let mut rows = stmt
        .query(params![agent_id])
        .map_err(|e| format!("读取智能体资料覆盖失败: {e}"))?;
    let Some(row) = rows
        .next()
        .map_err(|e| format!("读取智能体资料覆盖行失败: {e}"))?
    else {
        return Ok(None);
    };

    let agent_id: String = row.get(0).map_err(|e| format!("解析智能体 ID 失败: {e}"))?;
    let tags_json: Option<String> = row.get(1).map_err(|e| format!("解析标签 JSON 失败: {e}"))?;
    let description: Option<String> = row.get(2).map_err(|e| format!("解析简介失败: {e}"))?;
    let system_prompt: Option<String> =
        row.get(3).map_err(|e| format!("解析系统提示词失败: {e}"))?;
    let collaboration_json: Option<String> = row
        .get(4)
        .map_err(|e| format!("解析协同配置 JSON 失败: {e}"))?;
    let channel_binding_json: Option<String> = row
        .get(5)
        .map_err(|e| format!("解析渠道绑定 JSON 失败: {e}"))?;
    let avatar_url: Option<String> = row.get(6).map_err(|e| format!("解析头像地址失败: {e}"))?;
    let portrait_url: Option<String> = row.get(7).map_err(|e| format!("解析立绘地址失败: {e}"))?;
    let english_name: Option<String> = row.get(8).map_err(|e| format!("解析英文昵称失败: {e}"))?;
    let nickname: Option<String> = row.get(9).map_err(|e| format!("解析昵称失败: {e}"))?;
    let tts_config_json: Option<String> = row
        .get(10)
        .map_err(|e| format!("解析 TTS 配置 JSON 失败: {e}"))?;
    let speaker_profiles_json: Option<String> = row
        .get(11)
        .map_err(|e| format!("解析音色样本 JSON 失败: {e}"))?;
    let updated_at: String = row.get(12).map_err(|e| format!("解析更新时间失败: {e}"))?;

    let tags = match tags_json {
        Some(raw) => Some(
            serde_json::from_str::<Vec<String>>(&raw)
                .map_err(|e| format!("反序列化标签 JSON 失败: {e}"))?,
        ),
        None => None,
    };
    let collaboration = match collaboration_json {
        Some(raw) => Some(
            serde_json::from_str::<Value>(&raw)
                .map_err(|e| format!("反序列化协同配置 JSON 失败: {e}"))?,
        ),
        None => None,
    };
    let channel_binding = match channel_binding_json {
        Some(raw) => Some(
            serde_json::from_str::<Value>(&raw)
                .map_err(|e| format!("反序列化渠道绑定 JSON 失败: {e}"))?,
        ),
        None => None,
    };
    let tts_config = match tts_config_json {
        Some(raw) => Some(
            serde_json::from_str::<Value>(&raw)
                .map_err(|e| format!("反序列化 TTS 配置 JSON 失败: {e}"))?,
        ),
        None => None,
    };
    let speaker_profiles = match speaker_profiles_json {
        Some(raw) => Some(
            serde_json::from_str::<Value>(&raw)
                .map_err(|e| format!("反序列化音色样本 JSON 失败: {e}"))?,
        ),
        None => None,
    };

    Ok(Some(AgentProfileOverrideRecord {
        agent_id,
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
        updated_at,
    }))
}

pub fn list_agent_profile_overrides() -> Result<HashMap<String, AgentProfileOverrideRecord>, String>
{
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT agent_id, tags_json, description, system_prompt, collaboration_json, channel_binding_json, avatar_url, portrait_url, english_name, nickname, tts_config_json, speaker_profiles_json, updated_at
            FROM agent_profile_overrides
            ORDER BY agent_id ASC
            "#,
        )
        .map_err(|e| format!("查询智能体资料覆盖列表失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, String>(12)?,
            ))
        })
        .map_err(|e| format!("读取智能体资料覆盖列表失败: {e}"))?;

    let mut output = HashMap::new();
    for row in rows {
        let (
            agent_id,
            tags_json,
            description,
            system_prompt,
            collaboration_json,
            channel_binding_json,
            avatar_url,
            portrait_url,
            english_name,
            nickname,
            tts_config_json,
            speaker_profiles_json,
            updated_at,
        ) = row.map_err(|e| format!("解析智能体资料覆盖记录失败: {e}"))?;
        let tags = match tags_json {
            Some(raw) => Some(
                serde_json::from_str::<Vec<String>>(&raw)
                    .map_err(|e| format!("反序列化标签 JSON 失败: {e}"))?,
            ),
            None => None,
        };
        let collaboration = match collaboration_json {
            Some(raw) => Some(
                serde_json::from_str::<Value>(&raw)
                    .map_err(|e| format!("反序列化协同配置 JSON 失败: {e}"))?,
            ),
            None => None,
        };
        let channel_binding = match channel_binding_json {
            Some(raw) => Some(
                serde_json::from_str::<Value>(&raw)
                    .map_err(|e| format!("反序列化渠道绑定 JSON 失败: {e}"))?,
            ),
            None => None,
        };
        let tts_config = match tts_config_json {
            Some(raw) => Some(
                serde_json::from_str::<Value>(&raw)
                    .map_err(|e| format!("反序列化 TTS 配置 JSON 失败: {e}"))?,
            ),
            None => None,
        };
        let speaker_profiles = match speaker_profiles_json {
            Some(raw) => Some(
                serde_json::from_str::<Value>(&raw)
                    .map_err(|e| format!("反序列化音色样本 JSON 失败: {e}"))?,
            ),
            None => None,
        };
        output.insert(
            agent_id.clone(),
            AgentProfileOverrideRecord {
                agent_id,
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
                updated_at,
            },
        );
    }
    Ok(output)
}

pub fn upsert_agent_profile_override(
    agent_id: &str,
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
) -> Result<(), String> {
    let current = get_agent_profile_override(agent_id)?;
    let merged_tags = if tags.is_some() {
        tags
    } else {
        current.as_ref().and_then(|item| item.tags.clone())
    };
    let merged_description = if description.is_some() {
        description.and_then(normalize_nullable_text)
    } else {
        current.as_ref().and_then(|item| item.description.clone())
    };
    let merged_prompt = if system_prompt.is_some() {
        system_prompt
    } else {
        current.as_ref().and_then(|item| item.system_prompt.clone())
    };
    let merged_collaboration = if collaboration.is_some() {
        collaboration
    } else {
        current.as_ref().and_then(|item| item.collaboration.clone())
    };
    let merged_channel_binding = if channel_binding.is_some() {
        channel_binding.and_then(normalize_nullable_json)
    } else {
        current
            .as_ref()
            .and_then(|item| item.channel_binding.clone())
    };
    let merged_avatar_url = if avatar_url.is_some() {
        avatar_url.and_then(normalize_nullable_text)
    } else {
        current.as_ref().and_then(|item| item.avatar_url.clone())
    };
    let merged_portrait_url = if portrait_url.is_some() {
        portrait_url.and_then(normalize_nullable_text)
    } else {
        current.as_ref().and_then(|item| item.portrait_url.clone())
    };
    let merged_english_name = if english_name.is_some() {
        english_name.and_then(normalize_nullable_text)
    } else {
        current.as_ref().and_then(|item| item.english_name.clone())
    };
    let merged_nickname = if nickname.is_some() {
        nickname.and_then(normalize_nullable_text)
    } else {
        current.as_ref().and_then(|item| item.nickname.clone())
    };
    let merged_tts_config = if tts_config.is_some() {
        tts_config.and_then(normalize_nullable_json)
    } else {
        current.as_ref().and_then(|item| item.tts_config.clone())
    };
    let merged_speaker_profiles = if speaker_profiles.is_some() {
        speaker_profiles.and_then(normalize_nullable_json)
    } else {
        current
            .as_ref()
            .and_then(|item| item.speaker_profiles.clone())
    };

    if merged_tags.is_none()
        && merged_description.is_none()
        && merged_prompt.is_none()
        && merged_collaboration.is_none()
        && merged_channel_binding.is_none()
        && merged_avatar_url.is_none()
        && merged_portrait_url.is_none()
        && merged_english_name.is_none()
        && merged_nickname.is_none()
        && merged_tts_config.is_none()
        && merged_speaker_profiles.is_none()
    {
        return delete_agent_profile_override(agent_id);
    }

    let tags_json = match merged_tags {
        Some(values) => {
            Some(serde_json::to_string(&values).map_err(|e| format!("序列化标签 JSON 失败: {e}"))?)
        }
        None => None,
    };
    let collaboration_json = match merged_collaboration {
        Some(value) => Some(
            serde_json::to_string(&value).map_err(|e| format!("序列化协同配置 JSON 失败: {e}"))?,
        ),
        None => None,
    };
    let channel_binding_json = match merged_channel_binding {
        Some(value) => Some(
            serde_json::to_string(&value).map_err(|e| format!("序列化渠道绑定 JSON 失败: {e}"))?,
        ),
        None => None,
    };
    let tts_config_json = match merged_tts_config {
        Some(value) => Some(
            serde_json::to_string(&value).map_err(|e| format!("序列化 TTS 配置 JSON 失败: {e}"))?,
        ),
        None => None,
    };
    let speaker_profiles_json = match merged_speaker_profiles {
        Some(value) => Some(
            serde_json::to_string(&value).map_err(|e| format!("序列化音色样本 JSON 失败: {e}"))?,
        ),
        None => None,
    };

    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO agent_profile_overrides(
            agent_id, tags_json, description, system_prompt, collaboration_json, channel_binding_json, avatar_url, portrait_url, english_name, nickname, tts_config_json, speaker_profiles_json, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP)
        ON CONFLICT(agent_id) DO UPDATE SET
            tags_json = excluded.tags_json,
            description = excluded.description,
            system_prompt = excluded.system_prompt,
            collaboration_json = excluded.collaboration_json,
            channel_binding_json = excluded.channel_binding_json,
            avatar_url = excluded.avatar_url,
            portrait_url = excluded.portrait_url,
            english_name = excluded.english_name,
            nickname = excluded.nickname,
            tts_config_json = excluded.tts_config_json,
            speaker_profiles_json = excluded.speaker_profiles_json,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            agent_id,
            tags_json,
            merged_description,
            merged_prompt,
            collaboration_json,
            channel_binding_json,
            merged_avatar_url,
            merged_portrait_url,
            merged_english_name,
            merged_nickname,
            tts_config_json,
            speaker_profiles_json
        ],
    )
    .map_err(|e| format!("写入智能体资料覆盖失败: {e}"))?;
    Ok(())
}

fn normalize_nullable_text(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_nullable_json(value: Value) -> Option<Value> {
    if value.is_null() {
        None
    } else {
        Some(value)
    }
}

pub fn delete_agent_profile_override(agent_id: &str) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        "DELETE FROM agent_profile_overrides WHERE agent_id = ?1",
        params![agent_id],
    )
    .map_err(|e| format!("删除智能体资料覆盖失败: {e}"))?;
    Ok(())
}

pub fn create_chat_group(record: &ChatGroupRecord) -> Result<(), String> {
    let group_id = record.group_id.trim();
    if group_id.is_empty() {
        return Err("group_id 不能为空".to_string());
    }
    let name = record.name.trim();
    if name.is_empty() {
        return Err("群名称不能为空".to_string());
    }
    let leader = record.leader_agent_id.trim();
    if leader.is_empty() {
        return Err("leader_agent_id 不能为空".to_string());
    }

    let tags_json =
        serde_json::to_string(&record.tags).map_err(|e| format!("序列化群标签 JSON 失败: {e}"))?;
    let limits_json = serde_json::to_string(&record.limits)
        .map_err(|e| format!("序列化群阈值 JSON 失败: {e}"))?;

    let mut conn = open_conn()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启群创建事务失败: {e}"))?;

    tx.execute(
        r#"
        INSERT INTO chat_groups(group_id, name, description, tags_json, leader_agent_id, system_prompt, group_mode, limits_json, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        "#,
        params![
            group_id,
            name,
            record.description.trim(),
            tags_json,
            leader,
            record.system_prompt.trim(),
            record.group_mode.trim(),
            limits_json,
        ],
    )
    .map_err(|e| format!("写入群记录失败: {e}"))?;

    for agent_id in record.member_agent_ids.iter() {
        let id = agent_id.trim();
        if id.is_empty() {
            continue;
        }
        tx.execute(
            r#"
            INSERT INTO chat_group_members(group_id, agent_id, created_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            ON CONFLICT(group_id, agent_id) DO NOTHING
            "#,
            params![group_id, id],
        )
        .map_err(|e| format!("写入群成员失败: {e}"))?;
    }

    let mut admin_ids = record
        .admin_agent_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if !admin_ids.iter().any(|id| id == leader) {
        admin_ids.push(leader.to_string());
    }
    admin_ids.sort();
    admin_ids.dedup();
    for agent_id in admin_ids.iter() {
        tx.execute(
            r#"
            INSERT INTO chat_group_admins(group_id, agent_id, created_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            ON CONFLICT(group_id, agent_id) DO NOTHING
            "#,
            params![group_id, agent_id],
        )
        .map_err(|e| format!("写入群管理员失败: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("提交群创建事务失败: {e}"))?;
    Ok(())
}

pub fn update_chat_group(record: &ChatGroupRecord) -> Result<(), String> {
    let group_id = record.group_id.trim();
    if group_id.is_empty() {
        return Err("group_id 不能为空".to_string());
    }
    let name = record.name.trim();
    if name.is_empty() {
        return Err("群名称不能为空".to_string());
    }
    let leader = record.leader_agent_id.trim();
    if leader.is_empty() {
        return Err("leader_agent_id 不能为空".to_string());
    }

    let tags_json =
        serde_json::to_string(&record.tags).map_err(|e| format!("序列化群标签 JSON 失败: {e}"))?;
    let limits_json = serde_json::to_string(&record.limits)
        .map_err(|e| format!("序列化群阈值 JSON 失败: {e}"))?;

    let mut conn = open_conn()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启群更新事务失败: {e}"))?;

    let changed = tx
        .execute(
            r#"
            UPDATE chat_groups
            SET name = ?2,
                description = ?3,
                tags_json = ?4,
                leader_agent_id = ?5,
                system_prompt = ?6,
                group_mode = ?7,
                limits_json = ?8,
                updated_at = CURRENT_TIMESTAMP
            WHERE group_id = ?1
            "#,
            params![
                group_id,
                name,
                record.description.trim(),
                tags_json,
                leader,
                record.system_prompt.trim(),
                record.group_mode.trim(),
                limits_json,
            ],
        )
        .map_err(|e| format!("更新群记录失败: {e}"))?;

    if changed == 0 {
        return Err("群不存在".to_string());
    }

    tx.execute(
        "DELETE FROM chat_group_members WHERE group_id = ?1",
        params![group_id],
    )
    .map_err(|e| format!("清理旧群成员失败: {e}"))?;

    for agent_id in record.member_agent_ids.iter() {
        let id = agent_id.trim();
        if id.is_empty() {
            continue;
        }
        tx.execute(
            r#"
            INSERT INTO chat_group_members(group_id, agent_id, created_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            ON CONFLICT(group_id, agent_id) DO NOTHING
            "#,
            params![group_id, id],
        )
        .map_err(|e| format!("写入群成员失败: {e}"))?;
    }

    tx.execute(
        "DELETE FROM chat_group_admins WHERE group_id = ?1",
        params![group_id],
    )
    .map_err(|e| format!("清理旧群管理员失败: {e}"))?;

    let mut admin_ids = record
        .admin_agent_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if !admin_ids.iter().any(|id| id == leader) {
        admin_ids.push(leader.to_string());
    }
    admin_ids.sort();
    admin_ids.dedup();
    for agent_id in admin_ids.iter() {
        tx.execute(
            r#"
            INSERT INTO chat_group_admins(group_id, agent_id, created_at)
            VALUES (?1, ?2, CURRENT_TIMESTAMP)
            ON CONFLICT(group_id, agent_id) DO NOTHING
            "#,
            params![group_id, agent_id],
        )
        .map_err(|e| format!("写入群管理员失败: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("提交群更新事务失败: {e}"))?;
    Ok(())
}

pub fn get_chat_group(group_id: &str) -> Result<Option<ChatGroupRecord>, String> {
    let id = group_id.trim();
    if id.is_empty() {
        return Ok(None);
    }

    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT group_id, name, description, tags_json, leader_agent_id, system_prompt, group_mode, limits_json, created_at, updated_at
            FROM chat_groups
            WHERE group_id = ?1
            "#,
        )
        .map_err(|e| format!("查询群信息失败: {e}"))?;

    let mut rows = stmt
        .query(params![id])
        .map_err(|e| format!("执行群查询失败: {e}"))?;

    let Some(row) = rows
        .next()
        .map_err(|e| format!("读取群查询结果失败: {e}"))?
    else {
        return Ok(None);
    };

    let tags_json: String = row.get(3).map_err(|e| format!("读取群标签失败: {e}"))?;
    let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
    let group_id: String = row.get(0).map_err(|e| format!("读取群ID失败: {e}"))?;
    let name: String = row.get(1).map_err(|e| format!("读取群名称失败: {e}"))?;
    let description: String = row.get(2).map_err(|e| format!("读取群描述失败: {e}"))?;
    let leader_agent_id: String = row.get(4).map_err(|e| format!("读取群主失败: {e}"))?;
    let system_prompt: String = row.get(5).map_err(|e| format!("读取群提示词失败: {e}"))?;
    let group_mode: String = row.get(6).map_err(|e| format!("读取群模式失败: {e}"))?;
    let limits_json: String = row.get(7).map_err(|e| format!("读取群阈值失败: {e}"))?;
    let created_at: String = row.get(8).map_err(|e| format!("读取创建时间失败: {e}"))?;
    let updated_at: String = row.get(9).map_err(|e| format!("读取更新时间失败: {e}"))?;
    let limits =
        serde_json::from_str::<Value>(&limits_json).unwrap_or_else(|_| serde_json::json!({}));

    let member_agent_ids = list_chat_group_member_ids(&group_id)?;
    let mut admin_agent_ids = list_chat_group_admin_ids(&group_id)?;
    if admin_agent_ids.is_empty() {
        admin_agent_ids = vec![leader_agent_id.clone()];
    }

    Ok(Some(ChatGroupRecord {
        group_id,
        name,
        description,
        tags,
        leader_agent_id,
        system_prompt,
        admin_agent_ids,
        member_agent_ids,
        group_mode,
        limits,
        created_at,
        updated_at,
    }))
}

pub fn list_chat_groups() -> Result<Vec<ChatGroupRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT group_id, name, description, tags_json, leader_agent_id, system_prompt, group_mode, limits_json, created_at, updated_at
            FROM chat_groups
            ORDER BY updated_at DESC, created_at DESC
            "#,
        )
        .map_err(|e| format!("查询群列表失败: {e}"))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| format!("执行群列表查询失败: {e}"))?;

    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("读取群列表失败: {e}"))? {
        let group_id: String = row.get(0).map_err(|e| format!("读取群ID失败: {e}"))?;
        let tags_json: String = row.get(3).map_err(|e| format!("读取群标签失败: {e}"))?;
        let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
        let member_agent_ids = list_chat_group_member_ids(&group_id)?;
        let leader_agent_id: String = row.get(4).map_err(|e| format!("读取群主失败: {e}"))?;
        let mut admin_agent_ids = list_chat_group_admin_ids(&group_id)?;
        if admin_agent_ids.is_empty() {
            admin_agent_ids = vec![leader_agent_id.clone()];
        }
        let group_mode: String = row.get(6).map_err(|e| format!("读取群模式失败: {e}"))?;
        let limits_json: String = row.get(7).map_err(|e| format!("读取群阈值失败: {e}"))?;
        let limits =
            serde_json::from_str::<Value>(&limits_json).unwrap_or_else(|_| serde_json::json!({}));
        out.push(ChatGroupRecord {
            group_id,
            name: row.get(1).map_err(|e| format!("读取群名称失败: {e}"))?,
            description: row.get(2).map_err(|e| format!("读取群描述失败: {e}"))?,
            tags,
            leader_agent_id,
            system_prompt: row.get(5).map_err(|e| format!("读取群提示词失败: {e}"))?,
            admin_agent_ids,
            member_agent_ids,
            group_mode,
            limits,
            created_at: row.get(8).map_err(|e| format!("读取创建时间失败: {e}"))?,
            updated_at: row.get(9).map_err(|e| format!("读取更新时间失败: {e}"))?,
        });
    }
    Ok(out)
}

pub fn delete_chat_group(group_id: &str) -> Result<(), String> {
    let id = group_id.trim();
    if id.is_empty() {
        return Ok(());
    }
    let mut conn = open_conn()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启删除群事务失败: {e}"))?;
    tx.execute(
        "DELETE FROM chat_group_members WHERE group_id = ?1",
        params![id],
    )
    .map_err(|e| format!("删除群成员失败: {e}"))?;
    tx.execute(
        "DELETE FROM chat_group_admins WHERE group_id = ?1",
        params![id],
    )
    .map_err(|e| format!("删除群管理员失败: {e}"))?;
    tx.execute("DELETE FROM chat_groups WHERE group_id = ?1", params![id])
        .map_err(|e| format!("删除群记录失败: {e}"))?;
    tx.commit()
        .map_err(|e| format!("提交删除群事务失败: {e}"))?;
    Ok(())
}

fn list_chat_group_member_ids(group_id: &str) -> Result<Vec<String>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT agent_id
            FROM chat_group_members
            WHERE group_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .map_err(|e| format!("查询群成员失败: {e}"))?;
    let mut rows = stmt
        .query(params![group_id])
        .map_err(|e| format!("执行群成员查询失败: {e}"))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("读取群成员失败: {e}"))? {
        let agent_id: String = row.get(0).map_err(|e| format!("读取群成员ID失败: {e}"))?;
        if !agent_id.trim().is_empty() {
            out.push(agent_id);
        }
    }
    Ok(out)
}

fn list_chat_group_admin_ids(group_id: &str) -> Result<Vec<String>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT agent_id
            FROM chat_group_admins
            WHERE group_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .map_err(|e| format!("查询群管理员失败: {e}"))?;

    let rows = stmt
        .query_map(params![group_id.trim()], |row| row.get::<_, String>(0))
        .map_err(|e| format!("执行群管理员查询失败: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        let id = row.map_err(|e| format!("读取群管理员失败: {e}"))?;
        let trimmed = id.trim();
        if !trimmed.is_empty() {
            out.push(trimmed.to_string());
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

pub fn replace_agent_collaboration_acl(
    caller_agent_id: &str,
    scope: &str,
    callee_agent_ids: &[String],
) -> Result<(), String> {
    let scope = scope.trim();
    if scope.is_empty() {
        return Err("scope 不能为空".to_string());
    }
    let mut conn = open_conn()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启 ACL 事务失败: {e}"))?;
    tx.execute(
        "DELETE FROM agent_collaboration_acl WHERE caller_agent_id = ?1 AND scope = ?2",
        params![caller_agent_id, scope],
    )
    .map_err(|e| format!("清理旧 ACL 记录失败: {e}"))?;

    let mut stmt = tx
        .prepare(
            r#"
            INSERT INTO agent_collaboration_acl(
                caller_agent_id, callee_agent_id, scope, enabled, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(caller_agent_id, callee_agent_id, scope) DO UPDATE SET
                enabled = 1,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .map_err(|e| format!("准备写入 ACL 语句失败: {e}"))?;

    for callee_agent_id in callee_agent_ids {
        let trimmed = callee_agent_id.trim();
        if trimmed.is_empty() || trimmed == caller_agent_id {
            continue;
        }
        stmt.execute(params![caller_agent_id, trimmed, scope])
            .map_err(|e| format!("写入 ACL 记录失败: {e}"))?;
    }
    drop(stmt);

    tx.commit().map_err(|e| format!("提交 ACL 事务失败: {e}"))?;
    Ok(())
}

pub fn list_agent_collaboration_acl(
    caller_agent_id: &str,
    scope: &str,
) -> Result<Vec<AgentCollaborationAclRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT caller_agent_id, callee_agent_id, scope, enabled, updated_at
            FROM agent_collaboration_acl
            WHERE caller_agent_id = ?1 AND scope = ?2
            ORDER BY callee_agent_id ASC
            "#,
        )
        .map_err(|e| format!("查询 ACL 列表失败: {e}"))?;

    let rows = stmt
        .query_map(params![caller_agent_id, scope], |row| {
            Ok(AgentCollaborationAclRecord {
                caller_agent_id: row.get(0)?,
                callee_agent_id: row.get(1)?,
                scope: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("读取 ACL 列表失败: {e}"))?;

    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析 ACL 记录失败: {e}"))?);
    }
    Ok(output)
}

pub fn list_agent_context_files(
    agent_id: &str,
) -> Result<HashMap<String, AgentContextFileRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT agent_id, file_name, content, updated_at
            FROM agent_context_files
            WHERE agent_id = ?1
            ORDER BY file_name ASC
            "#,
        )
        .map_err(|e| format!("查询身份文件失败: {e}"))?;

    let rows = stmt
        .query_map(params![agent_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("读取身份文件失败: {e}"))?;

    let mut output = HashMap::new();
    for row in rows {
        let (row_agent_id, file_name, content, updated_at) =
            row.map_err(|e| format!("解析身份文件失败: {e}"))?;
        output.insert(
            file_name.clone(),
            AgentContextFileRecord {
                agent_id: row_agent_id,
                file_name,
                content,
                updated_at,
            },
        );
    }
    Ok(output)
}

pub fn get_agent_context_file(
    agent_id: &str,
    file_name: &str,
) -> Result<Option<AgentContextFileRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT agent_id, file_name, content, updated_at
            FROM agent_context_files
            WHERE agent_id = ?1 AND file_name = ?2
            "#,
        )
        .map_err(|e| format!("查询身份文件失败: {e}"))?;

    let mut rows = stmt
        .query(params![agent_id, file_name])
        .map_err(|e| format!("读取身份文件失败: {e}"))?;
    let Some(row) = rows
        .next()
        .map_err(|e| format!("读取身份文件行失败: {e}"))?
    else {
        return Ok(None);
    };

    let row_agent_id: String = row.get(0).map_err(|e| format!("解析智能体 ID 失败: {e}"))?;
    let row_file_name: String = row.get(1).map_err(|e| format!("解析文件名失败: {e}"))?;
    let content: String = row.get(2).map_err(|e| format!("解析文件内容失败: {e}"))?;
    let updated_at: String = row.get(3).map_err(|e| format!("解析更新时间失败: {e}"))?;

    Ok(Some(AgentContextFileRecord {
        agent_id: row_agent_id,
        file_name: row_file_name,
        content,
        updated_at,
    }))
}

pub fn upsert_agent_context_file(
    agent_id: &str,
    file_name: &str,
    content: &str,
) -> Result<(), String> {
    let normalized_agent_id = agent_id.trim();
    if normalized_agent_id.is_empty() {
        return Err("智能体 ID 不能为空".to_string());
    }
    let normalized_file_name = file_name.trim();
    if normalized_file_name.is_empty() {
        return Err("身份文件名不能为空".to_string());
    }

    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO agent_context_files(agent_id, file_name, content, updated_at)
        VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
        ON CONFLICT(agent_id, file_name) DO UPDATE SET
            content = excluded.content,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![normalized_agent_id, normalized_file_name, content],
    )
    .map_err(|e| format!("写入身份文件失败: {e}"))?;
    Ok(())
}

pub fn create_or_update_task_delivery(record: &TaskDeliveryRecord) -> Result<(), String> {
    let delivery_id = record.id.trim();
    if delivery_id.is_empty() {
        return Err("delivery id 不能为空".to_string());
    }
    let task_id = record.task_id.trim();
    if task_id.is_empty() {
        return Err("task_id 不能为空".to_string());
    }
    let owner_agent_id = record.owner_agent_id.trim();
    if owner_agent_id.is_empty() {
        return Err("owner_agent_id 不能为空".to_string());
    }
    let dedupe_key = record.dedupe_key.trim();
    if dedupe_key.is_empty() {
        return Err("dedupe_key 不能为空".to_string());
    }
    let payload_json = serde_json::to_string(&record.payload)
        .map_err(|e| format!("序列化任务投递载荷失败: {e}"))?;
    let conn = open_conn()?;
    conn.execute(
        r#"
        INSERT INTO task_deliveries(
            id,
            task_id,
            owner_agent_id,
            runtime_key,
            delivery_kind,
            dedupe_key,
            status,
            origin_conversation_type,
            origin_conversation_id,
            origin_chat_session_id,
            origin_message_id,
            creator_participant_id,
            creator_participant_name,
            executor_agent_id,
            executor_agent_name,
            report_actor_agent_id,
            report_actor_agent_name,
            task_name,
            run_count,
            summary_text,
            error_text,
            payload_json,
            created_at,
            updated_at
        )
        VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
            ?19, ?20, ?21, ?22, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT(dedupe_key) DO UPDATE SET
            owner_agent_id = excluded.owner_agent_id,
            runtime_key = excluded.runtime_key,
            delivery_kind = excluded.delivery_kind,
            status = excluded.status,
            origin_conversation_type = excluded.origin_conversation_type,
            origin_conversation_id = excluded.origin_conversation_id,
            origin_chat_session_id = excluded.origin_chat_session_id,
            origin_message_id = excluded.origin_message_id,
            creator_participant_id = excluded.creator_participant_id,
            creator_participant_name = excluded.creator_participant_name,
            executor_agent_id = excluded.executor_agent_id,
            executor_agent_name = excluded.executor_agent_name,
            report_actor_agent_id = excluded.report_actor_agent_id,
            report_actor_agent_name = excluded.report_actor_agent_name,
            task_name = excluded.task_name,
            run_count = excluded.run_count,
            summary_text = excluded.summary_text,
            error_text = excluded.error_text,
            payload_json = excluded.payload_json,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            delivery_id,
            task_id,
            owner_agent_id,
            record.runtime_key.as_deref(),
            record.delivery_kind.trim(),
            dedupe_key,
            record.status.trim(),
            record.origin_conversation_type.as_deref(),
            record.origin_conversation_id.as_deref(),
            record.origin_chat_session_id.as_deref(),
            record.origin_message_id.as_deref(),
            record.creator_participant_id.as_deref(),
            record.creator_participant_name.as_deref(),
            record.executor_agent_id.as_deref(),
            record.executor_agent_name.as_deref(),
            record.report_actor_agent_id.as_deref(),
            record.report_actor_agent_name.as_deref(),
            record.task_name.as_deref(),
            record.run_count,
            record.summary_text.as_deref(),
            record.error_text.as_deref(),
            payload_json,
        ],
    )
    .map_err(|e| format!("写入任务投递失败: {e}"))?;
    Ok(())
}

pub fn list_pending_task_deliveries(
    runtime_key: Option<&str>,
    chat_session_id: Option<&str>,
    conversation_type: Option<&str>,
    conversation_id: Option<&str>,
) -> Result<Vec<TaskDeliveryRecord>, String> {
    let conn = open_conn()?;
    let runtime_key = runtime_key.map(str::trim).filter(|value| !value.is_empty());
    let chat_session_id = chat_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let conversation_type = conversation_type
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let conversation_id = conversation_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                id,
                task_id,
                owner_agent_id,
                runtime_key,
                delivery_kind,
                dedupe_key,
                status,
                origin_conversation_type,
                origin_conversation_id,
                origin_chat_session_id,
                origin_message_id,
                creator_participant_id,
                creator_participant_name,
                executor_agent_id,
                executor_agent_name,
                report_actor_agent_id,
                report_actor_agent_name,
                task_name,
                run_count,
                summary_text,
                error_text,
                payload_json,
                created_at,
                updated_at,
                reported_at,
                acknowledged_at
            FROM task_deliveries
            WHERE status = 'pending'
              AND (?1 IS NULL OR runtime_key = ?1)
              AND (?2 IS NULL OR origin_chat_session_id = ?2)
              AND (?3 IS NULL OR origin_conversation_type = ?3)
              AND (?4 IS NULL OR origin_conversation_id = ?4)
            ORDER BY created_at ASC
            "#,
        )
        .map_err(|e| format!("准备任务投递查询失败: {e}"))?;
    let rows = stmt
        .query_map(
            params![
                runtime_key,
                chat_session_id,
                conversation_type,
                conversation_id
            ],
            map_task_delivery_row,
        )
        .map_err(|e| format!("执行任务投递查询失败: {e}"))?;
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析任务投递失败: {e}"))?);
    }
    Ok(output)
}

pub fn get_task_delivery(delivery_id: &str) -> Result<Option<TaskDeliveryRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                id,
                task_id,
                owner_agent_id,
                runtime_key,
                delivery_kind,
                dedupe_key,
                status,
                origin_conversation_type,
                origin_conversation_id,
                origin_chat_session_id,
                origin_message_id,
                creator_participant_id,
                creator_participant_name,
                executor_agent_id,
                executor_agent_name,
                report_actor_agent_id,
                report_actor_agent_name,
                task_name,
                run_count,
                summary_text,
                error_text,
                payload_json,
                created_at,
                updated_at,
                reported_at,
                acknowledged_at
            FROM task_deliveries
            WHERE id = ?1
            "#,
        )
        .map_err(|e| format!("准备读取任务投递失败: {e}"))?;
    let mut rows = stmt
        .query(params![delivery_id.trim()])
        .map_err(|e| format!("执行读取任务投递失败: {e}"))?;
    let Some(row) = rows.next().map_err(|e| format!("读取任务投递失败: {e}"))? else {
        return Ok(None);
    };
    map_task_delivery_row(row)
        .map(Some)
        .map_err(|e| format!("解析任务投递失败: {e}"))
}

pub fn mark_task_delivery_status(delivery_id: &str, status: &str) -> Result<(), String> {
    let normalized_status = status.trim();
    if normalized_status.is_empty() {
        return Err("status 不能为空".to_string());
    }
    let conn = open_conn()?;
    conn.execute(
        r#"
        UPDATE task_deliveries
        SET
            status = ?2,
            reported_at = CASE
                WHEN ?2 = 'reported' AND reported_at IS NULL THEN CURRENT_TIMESTAMP
                ELSE reported_at
            END,
            acknowledged_at = CASE
                WHEN ?2 = 'acknowledged' THEN CURRENT_TIMESTAMP
                ELSE acknowledged_at
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?1
        "#,
        params![delivery_id.trim(), normalized_status],
    )
    .map_err(|e| format!("更新任务投递状态失败: {e}"))?;
    Ok(())
}

fn map_task_delivery_row(row: &rusqlite::Row<'_>) -> Result<TaskDeliveryRecord, rusqlite::Error> {
    let payload_json: String = row.get(21)?;
    let payload = serde_json::from_str(&payload_json).unwrap_or(Value::Object(Default::default()));
    Ok(TaskDeliveryRecord {
        id: row.get(0)?,
        task_id: row.get(1)?,
        owner_agent_id: row.get(2)?,
        runtime_key: row.get(3)?,
        delivery_kind: row.get(4)?,
        dedupe_key: row.get(5)?,
        status: row.get(6)?,
        origin_conversation_type: row.get(7)?,
        origin_conversation_id: row.get(8)?,
        origin_chat_session_id: row.get(9)?,
        origin_message_id: row.get(10)?,
        creator_participant_id: row.get(11)?,
        creator_participant_name: row.get(12)?,
        executor_agent_id: row.get(13)?,
        executor_agent_name: row.get(14)?,
        report_actor_agent_id: row.get(15)?,
        report_actor_agent_name: row.get(16)?,
        task_name: row.get(17)?,
        run_count: row.get(18)?,
        summary_text: row.get(19)?,
        error_text: row.get(20)?,
        payload,
        created_at: row.get(22)?,
        updated_at: row.get(23)?,
        reported_at: row.get(24)?,
        acknowledged_at: row.get(25)?,
    })
}

fn normalize_media_owner_scope(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "self" => "self".to_string(),
        "shared" => "shared".to_string(),
        _ => "other".to_string(),
    }
}

fn normalize_media_family(value: &str) -> String {
    let trimmed = value.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        "photo".to_string()
    } else {
        trimmed
    }
}

fn normalize_media_kind(value: &str) -> String {
    let trimmed = value.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed
    }
}

fn normalize_media_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    for tag in tags {
        let normalized = tag.trim().to_ascii_lowercase();
        if normalized.is_empty() || !seen.insert(normalized.clone()) {
            continue;
        }
        output.push(normalized);
        if output.len() >= 32 {
            break;
        }
    }
    output
}

fn parse_json_string_array(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn parse_json_value_or_default(raw: &str, fallback: Value) -> Value {
    serde_json::from_str::<Value>(raw).unwrap_or(fallback)
}

fn parse_media_asset_row(row: &rusqlite::Row<'_>) -> Result<MediaAssetRecord, rusqlite::Error> {
    let width = row
        .get::<_, Option<i64>>(11)?
        .and_then(|value| u32::try_from(value).ok());
    let height = row
        .get::<_, Option<i64>>(12)?
        .and_then(|value| u32::try_from(value).ok());
    let byte_size = row
        .get::<_, i64>(13)
        .ok()
        .and_then(|value| u64::try_from(value).ok())
        .unwrap_or(0);
    let tags_json: String = row.get(19)?;
    let metadata_json: String = row.get(20)?;

    Ok(MediaAssetRecord {
        asset_id: row.get(0)?,
        agent_id: row.get(1)?,
        owner_scope: row.get(2)?,
        asset_family: row.get(3)?,
        media_kind: row.get(4)?,
        source_tool: row.get(5)?,
        purpose: row.get(6)?,
        prompt_text: row.get(7)?,
        negative_prompt: row.get(8)?,
        model: row.get(9)?,
        mime_type: row.get(10)?,
        width,
        height,
        byte_size,
        sha256: row.get(14)?,
        file_name: row.get(15)?,
        saved_path: row.get(16)?,
        image_url: row.get(17)?,
        relative_path: row.get(18)?,
        tags: parse_json_string_array(&tags_json),
        metadata: parse_json_value_or_default(&metadata_json, Value::Object(Default::default())),
        vision_summary: row.get(21)?,
        created_at: row.get(22)?,
        updated_at: row.get(23)?,
    })
}

pub fn upsert_media_asset(input: UpsertMediaAssetRecord) -> Result<MediaAssetRecord, String> {
    let conn = open_conn()?;
    let agent_id = input.agent_id.and_then(normalize_nullable_text);
    let owner_scope = normalize_media_owner_scope(&input.owner_scope);
    let asset_family = normalize_media_family(&input.asset_family);
    let media_kind = normalize_media_kind(&input.media_kind);
    let source_tool = input.source_tool.and_then(normalize_nullable_text);
    let purpose = input.purpose.and_then(normalize_nullable_text);
    let prompt_text = input.prompt_text.and_then(normalize_nullable_text);
    let negative_prompt = input.negative_prompt.and_then(normalize_nullable_text);
    let model = input.model.and_then(normalize_nullable_text);
    let mime_type =
        normalize_nullable_text(input.mime_type).unwrap_or_else(|| "image/png".to_string());
    let sha256 = input.sha256.trim().to_ascii_lowercase();
    if sha256.len() != 64 || !sha256.chars().all(|item| item.is_ascii_hexdigit()) {
        return Err("media asset sha256 无效".to_string());
    }
    let file_name = input.file_name.and_then(normalize_nullable_text);
    let saved_path = input.saved_path.and_then(normalize_nullable_text);
    let image_url = input.image_url.and_then(normalize_nullable_text);
    let relative_path = input.relative_path.and_then(normalize_nullable_text);
    let vision_summary = input.vision_summary.and_then(normalize_nullable_text);
    let tags = normalize_media_tags(input.tags);
    let metadata = if input.metadata.is_null() {
        Value::Object(Default::default())
    } else {
        input.metadata
    };
    let tags_json = serde_json::to_string(&tags).map_err(|e| format!("序列化媒体标签失败: {e}"))?;
    let metadata_json =
        serde_json::to_string(&metadata).map_err(|e| format!("序列化媒体元数据失败: {e}"))?;
    let lookup_agent = agent_id.clone().unwrap_or_default();

    let existing_asset_id = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT asset_id
                FROM media_assets
                WHERE sha256 = ?1
                  AND ifnull(agent_id, '') = ?2
                  AND owner_scope = ?3
                  AND asset_family = ?4
                  AND media_kind = ?5
                ORDER BY updated_at DESC
                LIMIT 1
                "#,
            )
            .map_err(|e| format!("查询媒体资产失败: {e}"))?;
        let mut rows = stmt
            .query(params![
                &sha256,
                &lookup_agent,
                &owner_scope,
                &asset_family,
                &media_kind
            ])
            .map_err(|e| format!("读取媒体资产失败: {e}"))?;
        rows.next()
            .map_err(|e| format!("读取媒体资产记录失败: {e}"))?
            .map(|row| row.get::<_, String>(0))
            .transpose()
            .map_err(|e| format!("解析媒体资产 ID 失败: {e}"))?
    };
    let asset_id = existing_asset_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    conn.execute(
        r#"
        INSERT INTO media_assets(
            asset_id, agent_id, owner_scope, asset_family, media_kind, source_tool, purpose,
            prompt_text, negative_prompt, model, mime_type, width, height, byte_size, sha256,
            file_name, saved_path, image_url, relative_path, tags_json, metadata_json,
            vision_summary, created_at, updated_at
        )
        VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
            ?16, ?17, ?18, ?19, ?20, ?21,
            ?22, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT(asset_id) DO UPDATE SET
            agent_id = excluded.agent_id,
            owner_scope = excluded.owner_scope,
            asset_family = excluded.asset_family,
            media_kind = excluded.media_kind,
            source_tool = excluded.source_tool,
            purpose = excluded.purpose,
            prompt_text = excluded.prompt_text,
            negative_prompt = excluded.negative_prompt,
            model = excluded.model,
            mime_type = excluded.mime_type,
            width = excluded.width,
            height = excluded.height,
            byte_size = excluded.byte_size,
            sha256 = excluded.sha256,
            file_name = excluded.file_name,
            saved_path = excluded.saved_path,
            image_url = excluded.image_url,
            relative_path = excluded.relative_path,
            tags_json = excluded.tags_json,
            metadata_json = excluded.metadata_json,
            vision_summary = excluded.vision_summary,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            asset_id,
            agent_id,
            owner_scope,
            asset_family,
            media_kind,
            source_tool,
            purpose,
            prompt_text,
            negative_prompt,
            model,
            mime_type,
            input.width.map(i64::from),
            input.height.map(i64::from),
            i64::try_from(input.byte_size).unwrap_or(i64::MAX),
            sha256,
            file_name,
            saved_path,
            image_url,
            relative_path,
            tags_json,
            metadata_json,
            vision_summary
        ],
    )
    .map_err(|e| format!("写入媒体资产失败: {e}"))?;

    get_media_asset(&asset_id)?.ok_or_else(|| "媒体资产写入后读取失败".to_string())
}

pub fn get_media_asset(asset_id: &str) -> Result<Option<MediaAssetRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                asset_id, agent_id, owner_scope, asset_family, media_kind, source_tool, purpose,
                prompt_text, negative_prompt, model, mime_type, width, height, byte_size, sha256,
                file_name, saved_path, image_url, relative_path, tags_json, metadata_json,
                vision_summary, created_at, updated_at
            FROM media_assets
            WHERE asset_id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|e| format!("查询媒体资产详情失败: {e}"))?;
    let mut rows = stmt
        .query(params![asset_id.trim()])
        .map_err(|e| format!("读取媒体资产详情失败: {e}"))?;
    rows.next()
        .map_err(|e| format!("读取媒体资产详情行失败: {e}"))?
        .map(parse_media_asset_row)
        .transpose()
        .map_err(|e| format!("解析媒体资产详情失败: {e}"))
}

pub fn list_media_assets(filter: MediaAssetListQuery) -> Result<Vec<MediaAssetRecord>, String> {
    let conn = open_conn()?;
    let mut sql = String::from(
        r#"
        SELECT
            asset_id, agent_id, owner_scope, asset_family, media_kind, source_tool, purpose,
            prompt_text, negative_prompt, model, mime_type, width, height, byte_size, sha256,
            file_name, saved_path, image_url, relative_path, tags_json, metadata_json,
            vision_summary, created_at, updated_at
        FROM media_assets
        WHERE 1 = 1
        "#,
    );
    let mut params_vec: Vec<SqlValue> = Vec::new();

    if let Some(agent_id) = filter.agent_id.and_then(normalize_nullable_text) {
        sql.push_str(" AND agent_id = ?");
        params_vec.push(SqlValue::Text(agent_id));
    }
    if let Some(owner_scope) = filter.owner_scope.and_then(normalize_nullable_text) {
        let normalized = owner_scope.trim().to_ascii_lowercase();
        if normalized != "all" {
            sql.push_str(" AND owner_scope = ?");
            params_vec.push(SqlValue::Text(normalize_media_owner_scope(&normalized)));
        }
    }
    if let Some(asset_family) = filter.asset_family.and_then(normalize_nullable_text) {
        sql.push_str(" AND asset_family = ?");
        params_vec.push(SqlValue::Text(normalize_media_family(&asset_family)));
    }
    if let Some(media_kind) = filter.media_kind.and_then(normalize_nullable_text) {
        sql.push_str(" AND media_kind = ?");
        params_vec.push(SqlValue::Text(normalize_media_kind(&media_kind)));
    }
    if let Some(query) = filter.query.and_then(normalize_nullable_text) {
        let like = format!("%{}%", query.to_ascii_lowercase());
        sql.push_str(
            " AND (lower(ifnull(file_name, '')) LIKE ? OR lower(ifnull(prompt_text, '')) LIKE ? OR lower(ifnull(vision_summary, '')) LIKE ? OR lower(tags_json) LIKE ?)",
        );
        for _ in 0..4 {
            params_vec.push(SqlValue::Text(like.clone()));
        }
    }

    sql.push_str(" ORDER BY updated_at DESC LIMIT ?");
    params_vec.push(SqlValue::Integer(i64::from(
        filter.limit.unwrap_or(120).clamp(1, 500),
    )));

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备媒体资产列表查询失败: {e}"))?;
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(params_vec),
            parse_media_asset_row,
        )
        .map_err(|e| format!("查询媒体资产列表失败: {e}"))?;

    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析媒体资产列表失败: {e}"))?);
    }
    Ok(output)
}

pub fn upsert_capability_provider(
    record: CapabilityProviderRecord,
) -> Result<CapabilityProviderRecord, String> {
    let conn = open_conn()?;
    let normalized = normalize_capability_provider_record(record)?;
    conn.execute(
        r#"
        INSERT INTO capability_providers(
            provider_id,
            provider_type,
            display_name,
            capabilities_json,
            supported_scopes_json,
            priority,
            requirements_json,
            supports_job,
            enabled,
            health_state,
            input_contract_json,
            output_contract_json,
            metadata_json,
            is_removed,
            updated_at
        )
        VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, CURRENT_TIMESTAMP
        )
        ON CONFLICT(provider_id) DO UPDATE SET
            provider_type = excluded.provider_type,
            display_name = excluded.display_name,
            capabilities_json = excluded.capabilities_json,
            supported_scopes_json = excluded.supported_scopes_json,
            priority = excluded.priority,
            requirements_json = excluded.requirements_json,
            supports_job = excluded.supports_job,
            enabled = excluded.enabled,
            health_state = excluded.health_state,
            input_contract_json = excluded.input_contract_json,
            output_contract_json = excluded.output_contract_json,
            metadata_json = excluded.metadata_json,
            is_removed = excluded.is_removed,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            normalized.provider_id,
            normalized.provider_type,
            normalized.display_name,
            serde_json::to_string(&normalized.capabilities)
                .map_err(|e| format!("序列化 capability provider capabilities 失败: {e}"))?,
            serde_json::to_string(&normalized.supported_scopes)
                .map_err(|e| format!("序列化 capability provider scopes 失败: {e}"))?,
            normalized.priority,
            normalized.requirements.to_string(),
            if normalized.supports_job { 1 } else { 0 },
            if normalized.enabled { 1 } else { 0 },
            normalized.health_state,
            normalized.input_contract.to_string(),
            normalized.output_contract.to_string(),
            normalized.metadata.to_string(),
            if normalized.is_removed { 1 } else { 0 },
        ],
    )
    .map_err(|e| format!("写入 capability provider 失败: {e}"))?;
    get_capability_provider(&normalized.provider_id)?
        .ok_or_else(|| "capability provider 写入后读取失败".to_string())
}

pub fn get_capability_provider(
    provider_id: &str,
) -> Result<Option<CapabilityProviderRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                provider_id,
                provider_type,
                display_name,
                capabilities_json,
                supported_scopes_json,
                priority,
                requirements_json,
                supports_job,
                enabled,
                health_state,
                input_contract_json,
                output_contract_json,
                metadata_json,
                is_removed,
                updated_at
            FROM capability_providers
            WHERE provider_id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|e| format!("准备查询 capability provider 失败: {e}"))?;
    let mut rows = stmt
        .query(params![provider_id.trim()])
        .map_err(|e| format!("读取 capability provider 失败: {e}"))?;
    rows.next()
        .map_err(|e| format!("读取 capability provider 结果失败: {e}"))?
        .map(parse_capability_provider_row)
        .transpose()
        .map_err(|e| format!("解析 capability provider 失败: {e}"))
}

pub fn list_capability_providers(
    include_removed: bool,
) -> Result<Vec<CapabilityProviderRecord>, String> {
    let conn = open_conn()?;
    let mut sql = String::from(
        r#"
        SELECT
            provider_id,
            provider_type,
            display_name,
            capabilities_json,
            supported_scopes_json,
            priority,
            requirements_json,
            supports_job,
            enabled,
            health_state,
            input_contract_json,
            output_contract_json,
            metadata_json,
            is_removed,
            updated_at
        FROM capability_providers
        "#,
    );
    if !include_removed {
        sql.push_str(" WHERE is_removed = 0");
    }
    sql.push_str(" ORDER BY priority ASC, provider_id ASC");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备 capability provider 列表失败: {e}"))?;
    let rows = stmt
        .query_map([], parse_capability_provider_row)
        .map_err(|e| format!("查询 capability provider 列表失败: {e}"))?;
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析 capability provider 列表失败: {e}"))?);
    }
    Ok(output)
}

pub fn upsert_capability_provider_binding(
    record: CapabilityProviderBindingRecord,
) -> Result<CapabilityProviderBindingRecord, String> {
    let conn = open_conn()?;
    let normalized = normalize_capability_provider_binding_record(record)?;
    conn.execute(
        r#"
        INSERT INTO capability_provider_bindings(
            capability_key,
            capability_scope,
            provider_id,
            enabled,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
        ON CONFLICT(capability_key, capability_scope, provider_id) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            normalized.capability_key,
            normalized.capability_scope,
            normalized.provider_id,
            if normalized.enabled { 1 } else { 0 },
        ],
    )
    .map_err(|e| format!("写入 capability provider binding 失败: {e}"))?;
    Ok(normalized)
}

pub fn delete_capability_provider_binding(
    capability_key: &str,
    capability_scope: &str,
    provider_id: &str,
) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        r#"
        DELETE FROM capability_provider_bindings
        WHERE capability_key = ?1 AND capability_scope = ?2 AND provider_id = ?3
        "#,
        params![
            normalize_capability_key(capability_key),
            normalize_capability_scope(capability_scope),
            normalize_required_text(provider_id, "provider_id")?,
        ],
    )
    .map_err(|e| format!("删除 capability provider binding 失败: {e}"))?;
    Ok(())
}

pub fn list_capability_provider_bindings() -> Result<Vec<CapabilityProviderBindingRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT capability_key, capability_scope, provider_id, enabled, updated_at
            FROM capability_provider_bindings
            ORDER BY capability_key ASC, capability_scope ASC, provider_id ASC
            "#,
        )
        .map_err(|e| format!("准备 capability provider binding 列表失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CapabilityProviderBindingRecord {
                capability_key: row.get(0)?,
                capability_scope: row.get(1)?,
                provider_id: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("查询 capability provider binding 列表失败: {e}"))?;
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析 capability provider binding 失败: {e}"))?);
    }
    Ok(output)
}

pub fn upsert_agent_capability_binding(
    record: AgentCapabilityBindingRecord,
) -> Result<AgentCapabilityBindingRecord, String> {
    let conn = open_conn()?;
    let normalized = normalize_agent_capability_binding_record(record)?;
    let provider_id = normalized.provider_id.clone().unwrap_or_default();
    conn.execute(
        r#"
        INSERT INTO agent_capability_bindings(
            agent_id,
            capability_key,
            capability_scope,
            provider_id,
            binding_type,
            enabled,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
        ON CONFLICT(agent_id, capability_key, capability_scope, provider_id, binding_type) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            normalized.agent_id,
            normalized.capability_key,
            normalized.capability_scope,
            provider_id,
            normalized.binding_type,
            if normalized.enabled { 1 } else { 0 },
        ],
    )
    .map_err(|e| format!("写入 agent capability binding 失败: {e}"))?;
    Ok(normalized)
}

pub fn delete_agent_capability_binding(
    agent_id: &str,
    capability_key: &str,
    capability_scope: &str,
    provider_id: Option<&str>,
    binding_type: &str,
) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        r#"
        DELETE FROM agent_capability_bindings
        WHERE agent_id = ?1
          AND capability_key = ?2
          AND capability_scope = ?3
          AND provider_id = ?4
          AND binding_type = ?5
        "#,
        params![
            normalize_required_text(agent_id, "agent_id")?,
            normalize_capability_key(capability_key),
            normalize_capability_scope(capability_scope),
            provider_id
                .map(|value| normalize_optional_text(value))
                .unwrap_or_default(),
            normalize_binding_type(binding_type),
        ],
    )
    .map_err(|e| format!("删除 agent capability binding 失败: {e}"))?;
    Ok(())
}

pub fn list_agent_capability_bindings(
    agent_id: Option<&str>,
) -> Result<Vec<AgentCapabilityBindingRecord>, String> {
    let conn = open_conn()?;
    let normalized_agent_id = agent_id.map(normalize_optional_text);
    let mut sql = String::from(
        r#"
        SELECT
            agent_id,
            capability_key,
            capability_scope,
            provider_id,
            binding_type,
            enabled,
            updated_at
        FROM agent_capability_bindings
        "#,
    );
    let mut params_vec: Vec<SqlValue> = Vec::new();
    if let Some(value) = normalized_agent_id {
        sql.push_str(" WHERE agent_id = ?");
        params_vec.push(SqlValue::Text(value));
    }
    sql.push_str(" ORDER BY agent_id ASC, updated_at DESC");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备 agent capability binding 列表失败: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_vec), |row| {
            let provider_id: String = row.get(3)?;
            Ok(AgentCapabilityBindingRecord {
                agent_id: row.get(0)?,
                capability_key: row.get(1)?,
                capability_scope: row.get(2)?,
                provider_id: if provider_id.trim().is_empty() {
                    None
                } else {
                    Some(provider_id)
                },
                binding_type: row.get(4)?,
                enabled: row.get::<_, i64>(5)? != 0,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("查询 agent capability binding 列表失败: {e}"))?;
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析 agent capability binding 失败: {e}"))?);
    }
    Ok(output)
}

pub fn upsert_renderer_binding(
    record: RendererBindingRecord,
) -> Result<RendererBindingRecord, String> {
    let conn = open_conn()?;
    let normalized = normalize_renderer_binding_record(record)?;
    conn.execute(
        r#"
        INSERT INTO renderer_bindings(
            channel,
            result_kind,
            media_type,
            document_type,
            renderer_key,
            enabled,
            fallback_channel,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
        ON CONFLICT(channel, result_kind, media_type, document_type) DO UPDATE SET
            renderer_key = excluded.renderer_key,
            enabled = excluded.enabled,
            fallback_channel = excluded.fallback_channel,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            normalized.channel,
            normalized.result_kind,
            normalized.media_type.clone().unwrap_or_default(),
            normalized.document_type.clone().unwrap_or_default(),
            normalized.renderer_key,
            if normalized.enabled { 1 } else { 0 },
            normalized.fallback_channel,
        ],
    )
    .map_err(|e| format!("写入 renderer binding 失败: {e}"))?;
    Ok(normalized)
}

pub fn delete_renderer_binding(
    channel: &str,
    result_kind: &str,
    media_type: Option<&str>,
    document_type: Option<&str>,
) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        r#"
        DELETE FROM renderer_bindings
        WHERE channel = ?1
          AND result_kind = ?2
          AND media_type = ?3
          AND document_type = ?4
        "#,
        params![
            normalize_required_text(channel, "channel")?,
            normalize_required_text(result_kind, "result_kind")?,
            media_type.map(normalize_optional_text).unwrap_or_default(),
            document_type
                .map(normalize_optional_text)
                .unwrap_or_default(),
        ],
    )
    .map_err(|e| format!("删除 renderer binding 失败: {e}"))?;
    Ok(())
}

pub fn list_renderer_bindings() -> Result<Vec<RendererBindingRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                channel,
                result_kind,
                media_type,
                document_type,
                renderer_key,
                enabled,
                fallback_channel,
                updated_at
            FROM renderer_bindings
            ORDER BY channel ASC, result_kind ASC, media_type ASC, document_type ASC
            "#,
        )
        .map_err(|e| format!("准备 renderer binding 列表失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            let media_type: String = row.get(2)?;
            let document_type: String = row.get(3)?;
            Ok(RendererBindingRecord {
                channel: row.get(0)?,
                result_kind: row.get(1)?,
                media_type: if media_type.trim().is_empty() {
                    None
                } else {
                    Some(media_type)
                },
                document_type: if document_type.trim().is_empty() {
                    None
                } else {
                    Some(document_type)
                },
                renderer_key: row.get(4)?,
                enabled: row.get::<_, i64>(5)? != 0,
                fallback_channel: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("查询 renderer binding 列表失败: {e}"))?;
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析 renderer binding 失败: {e}"))?);
    }
    Ok(output)
}

pub fn upsert_provider_health_state(
    record: ProviderHealthStateRecord,
) -> Result<ProviderHealthStateRecord, String> {
    let conn = open_conn()?;
    let normalized = normalize_provider_health_state_record(record)?;
    conn.execute(
        r#"
        INSERT INTO provider_health_state(
            provider_id,
            health_state,
            message,
            checked_at,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
        ON CONFLICT(provider_id) DO UPDATE SET
            health_state = excluded.health_state,
            message = excluded.message,
            checked_at = excluded.checked_at,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            normalized.provider_id,
            normalized.health_state,
            normalized.message,
            normalized.checked_at,
        ],
    )
    .map_err(|e| format!("写入 provider health state 失败: {e}"))?;
    Ok(normalized)
}

pub fn list_provider_health_states() -> Result<Vec<ProviderHealthStateRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT provider_id, health_state, message, checked_at, updated_at
            FROM provider_health_state
            ORDER BY updated_at DESC, provider_id ASC
            "#,
        )
        .map_err(|e| format!("准备 provider health state 列表失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProviderHealthStateRecord {
                provider_id: row.get(0)?,
                health_state: row.get(1)?,
                message: row.get(2)?,
                checked_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("查询 provider health state 列表失败: {e}"))?;
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析 provider health state 失败: {e}"))?);
    }
    Ok(output)
}

pub fn append_capability_audit_log(
    event_type: &str,
    provider_id: Option<&str>,
    agent_id: Option<&str>,
    capability_key: Option<&str>,
    capability_scope: Option<&str>,
    payload: &Value,
) -> Result<CapabilityAuditLogRecord, String> {
    let conn = open_conn()?;
    let id = Uuid::new_v4().to_string();
    let normalized_event_type = normalize_required_text(event_type, "event_type")?;
    let normalized_provider_id = provider_id.map(normalize_optional_text);
    let normalized_agent_id = agent_id.map(normalize_optional_text);
    let normalized_capability_key = capability_key.map(normalize_capability_key);
    let normalized_capability_scope = capability_scope.map(normalize_capability_scope);
    conn.execute(
        r#"
        INSERT INTO capability_audit_logs(
            id,
            event_type,
            provider_id,
            agent_id,
            capability_key,
            capability_scope,
            payload_json,
            created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
        "#,
        params![
            id,
            normalized_event_type,
            normalized_provider_id,
            normalized_agent_id,
            normalized_capability_key,
            normalized_capability_scope,
            payload.to_string(),
        ],
    )
    .map_err(|e| format!("写入 capability audit log 失败: {e}"))?;
    let mut logs = list_capability_audit_logs(Some(1))?;
    logs.pop()
        .ok_or_else(|| "capability audit log 写入后读取失败".to_string())
}

pub fn upsert_capability_job(record: CapabilityJobRecord) -> Result<CapabilityJobRecord, String> {
    let existing = get_capability_job(&record.job_id)?;
    let conn = open_conn()?;
    let mut normalized = normalize_capability_job_record(record)?;
    if let Some(existing) = existing.as_ref() {
        normalized = merge_capability_job_records(existing, normalized);
    }
    conn.execute(
        r#"
        INSERT INTO capability_jobs(
            job_id,
            owner_agent_id,
            capability_key,
            capability_scope,
            provider_id,
            provider_type,
            route,
            title,
            summary,
            status,
            progress_percent,
            stage,
            job_type,
            input_payload_json,
            result_payload_json,
            error_message,
            metadata_json,
            created_at,
            updated_at,
            started_at,
            finished_at,
            last_heartbeat_at
        )
        VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
            ?11, ?12, ?13, ?14, ?15, ?16, ?17,
            COALESCE(NULLIF(?18, ''), CURRENT_TIMESTAMP),
            CURRENT_TIMESTAMP,
            ?19, ?20, ?21
        )
        ON CONFLICT(job_id) DO UPDATE SET
            owner_agent_id = excluded.owner_agent_id,
            capability_key = excluded.capability_key,
            capability_scope = excluded.capability_scope,
            provider_id = excluded.provider_id,
            provider_type = excluded.provider_type,
            route = excluded.route,
            title = excluded.title,
            summary = excluded.summary,
            status = excluded.status,
            progress_percent = excluded.progress_percent,
            stage = excluded.stage,
            job_type = excluded.job_type,
            input_payload_json = excluded.input_payload_json,
            result_payload_json = excluded.result_payload_json,
            error_message = excluded.error_message,
            metadata_json = excluded.metadata_json,
            updated_at = CURRENT_TIMESTAMP,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at,
            last_heartbeat_at = excluded.last_heartbeat_at
        "#,
        params![
            normalized.job_id,
            normalized.owner_agent_id,
            normalized.capability_key,
            normalized.capability_scope,
            normalized.provider_id,
            normalized.provider_type,
            normalized.route,
            normalized.title,
            normalized.summary,
            normalized.status,
            normalized.progress_percent,
            normalized.stage,
            normalized.job_type,
            normalized.input_payload.to_string(),
            normalized.result_payload.to_string(),
            normalized.error_message,
            normalized.metadata.to_string(),
            normalized.created_at,
            normalized.started_at,
            normalized.finished_at,
            normalized.last_heartbeat_at,
        ],
    )
    .map_err(|e| format!("写入 capability job 失败: {e}"))?;
    get_capability_job(&normalized.job_id)?
        .ok_or_else(|| "capability job 写入后读取失败".to_string())
}

fn merge_capability_job_records(
    existing: &CapabilityJobRecord,
    mut incoming: CapabilityJobRecord,
) -> CapabilityJobRecord {
    if existing.job_id != incoming.job_id {
        return incoming;
    }

    let existing_rank = capability_job_status_rank(&existing.status);
    let incoming_rank = capability_job_status_rank(&incoming.status);
    let existing_terminal = is_capability_job_terminal_status_local(&existing.status);
    let incoming_terminal = is_capability_job_terminal_status_local(&incoming.status);
    let existing_is_richer = capability_job_is_richer(existing);
    let incoming_is_placeholder = capability_job_is_placeholder(&incoming);

    if existing_terminal && !incoming_terminal {
        return existing.clone();
    }

    if existing_rank > incoming_rank || (existing_is_richer && incoming_is_placeholder) {
        incoming.provider_id = incoming
            .provider_id
            .or_else(|| existing.provider_id.clone());
        incoming.provider_type = incoming
            .provider_type
            .or_else(|| existing.provider_type.clone());
        incoming.route = incoming.route.or_else(|| existing.route.clone());
        incoming.title = incoming.title.or_else(|| existing.title.clone());
        incoming.summary = if incoming.summary.is_some() && !incoming_is_placeholder {
            incoming.summary
        } else {
            incoming.summary.or_else(|| existing.summary.clone())
        };
        incoming.status = existing.status.clone();
        incoming.progress_percent = incoming.progress_percent.or(existing.progress_percent);
        incoming.stage = existing.stage.clone().or(incoming.stage);
        incoming.job_type = incoming.job_type.or_else(|| existing.job_type.clone());
        incoming.input_payload =
            merge_json_objects(&existing.input_payload, &incoming.input_payload);
        incoming.result_payload =
            merge_capability_job_json_payload(&existing.result_payload, &incoming.result_payload);
        incoming.error_message = incoming
            .error_message
            .or_else(|| existing.error_message.clone());
        incoming.metadata = merge_capability_job_metadata(&existing.metadata, &incoming.metadata);
        incoming.created_at = pick_preferred_timestamp(&incoming.created_at, &existing.created_at);
        incoming.started_at = incoming.started_at.or_else(|| existing.started_at.clone());
        incoming.finished_at = incoming
            .finished_at
            .or_else(|| existing.finished_at.clone());
        incoming.last_heartbeat_at = incoming
            .last_heartbeat_at
            .or_else(|| existing.last_heartbeat_at.clone());
        return incoming;
    }

    incoming.provider_id = incoming
        .provider_id
        .or_else(|| existing.provider_id.clone());
    incoming.provider_type = incoming
        .provider_type
        .or_else(|| existing.provider_type.clone());
    incoming.route = incoming.route.or_else(|| existing.route.clone());
    incoming.title = incoming.title.or_else(|| existing.title.clone());
    incoming.summary = incoming.summary.or_else(|| existing.summary.clone());
    incoming.progress_percent = incoming.progress_percent.or(existing.progress_percent);
    incoming.stage = incoming.stage.or_else(|| existing.stage.clone());
    incoming.job_type = incoming.job_type.or_else(|| existing.job_type.clone());
    incoming.input_payload = merge_json_objects(&existing.input_payload, &incoming.input_payload);
    incoming.result_payload =
        merge_capability_job_json_payload(&existing.result_payload, &incoming.result_payload);
    incoming.error_message = incoming
        .error_message
        .or_else(|| existing.error_message.clone());
    incoming.metadata = merge_capability_job_metadata(&existing.metadata, &incoming.metadata);
    incoming.created_at = pick_preferred_timestamp(&incoming.created_at, &existing.created_at);
    incoming.started_at = incoming.started_at.or_else(|| existing.started_at.clone());
    if incoming_terminal {
        incoming.finished_at = incoming
            .finished_at
            .or_else(|| existing.finished_at.clone());
    } else if existing_terminal {
        incoming.finished_at = existing.finished_at.clone();
    }
    incoming.last_heartbeat_at = incoming
        .last_heartbeat_at
        .or_else(|| existing.last_heartbeat_at.clone());
    incoming
}

fn merge_capability_job_json_payload(existing: &Value, incoming: &Value) -> Value {
    if json_value_is_meaningfully_empty(incoming) {
        return existing.clone();
    }
    merge_json_objects(existing, incoming)
}

fn merge_capability_job_metadata(existing: &Value, incoming: &Value) -> Value {
    let mut merged = merge_json_objects(existing, incoming);
    let Some(merged_object) = merged.as_object_mut() else {
        return merged;
    };

    let existing_dispatch_pending = metadata_dispatch_pending(existing);
    let incoming_dispatch_pending = metadata_dispatch_pending(incoming);
    if matches!(existing_dispatch_pending, Some(false))
        || matches!(incoming_dispatch_pending, Some(false))
    {
        merged_object.insert("dispatchPending".to_string(), Value::Bool(false));
    }

    if metadata_provider_request_id(&Value::Object(merged_object.clone())).is_none() {
        if let Some(provider_request_id) = metadata_provider_request_id(incoming)
            .or_else(|| metadata_provider_request_id(existing))
        {
            merged_object.insert(
                "providerRequestId".to_string(),
                Value::String(provider_request_id.to_string()),
            );
        }
    }

    Value::Object(merged_object.clone())
}

fn merge_json_objects(existing: &Value, incoming: &Value) -> Value {
    if let (Some(existing_map), Some(incoming_map)) = (existing.as_object(), incoming.as_object()) {
        let mut merged = existing_map.clone();
        for (key, value) in incoming_map {
            if let Some(previous) = merged.get(key) {
                merged.insert(key.clone(), merge_json_objects(previous, value));
            } else {
                merged.insert(key.clone(), value.clone());
            }
        }
        return Value::Object(merged);
    }

    if !json_value_is_meaningfully_empty(incoming) {
        return incoming.clone();
    }

    existing.clone()
}

fn json_value_is_meaningfully_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        Value::Array(items) => items.is_empty(),
        Value::Object(map) => map.is_empty(),
        _ => false,
    }
}

fn pick_preferred_timestamp(primary: &str, fallback: &str) -> String {
    let trimmed = primary.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    fallback.trim().to_string()
}

fn metadata_dispatch_pending(value: &Value) -> Option<bool> {
    value.as_object().and_then(|object| {
        object
            .get("dispatchPending")
            .or_else(|| object.get("dispatch_pending"))
            .and_then(Value::as_bool)
    })
}

fn metadata_provider_request_id(value: &Value) -> Option<&str> {
    value.as_object().and_then(|object| {
        object
            .get("providerRequestId")
            .or_else(|| object.get("provider_request_id"))
            .or_else(|| object.get("taskId"))
            .or_else(|| object.get("task_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
    })
}

fn capability_job_is_placeholder(record: &CapabilityJobRecord) -> bool {
    let status = record.status.trim().to_ascii_lowercase();
    let stage = record
        .stage
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    matches!(status.as_str(), "queued" | "running")
        && matches!(stage.as_str(), "" | "dispatching" | "queued")
        && metadata_dispatch_pending(&record.metadata).unwrap_or(false)
        && metadata_provider_request_id(&record.metadata).is_none()
        && json_value_is_meaningfully_empty(&record.result_payload)
}

fn capability_job_is_richer(record: &CapabilityJobRecord) -> bool {
    metadata_provider_request_id(&record.metadata).is_some()
        || metadata_dispatch_pending(&record.metadata) == Some(false)
        || !json_value_is_meaningfully_empty(&record.result_payload)
        || capability_job_status_rank(&record.status) > 0
}

fn capability_job_status_rank(status: &str) -> u8 {
    match status.trim().to_ascii_lowercase().as_str() {
        "queued" | "pending" => 0,
        "running" | "processing" | "progress" | "submitted" => 1,
        "completed" | "done" | "success" | "failed" | "error" | "cancelled" | "canceled" => 2,
        _ => 0,
    }
}

fn is_capability_job_terminal_status_local(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "completed" | "done" | "success" | "failed" | "error" | "cancelled" | "canceled"
    )
}

pub fn get_capability_job(job_id: &str) -> Result<Option<CapabilityJobRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                job_id,
                owner_agent_id,
                capability_key,
                capability_scope,
                provider_id,
                provider_type,
                route,
                title,
                summary,
                status,
                progress_percent,
                stage,
                job_type,
                input_payload_json,
                result_payload_json,
                error_message,
                metadata_json,
                created_at,
                updated_at,
                started_at,
                finished_at,
                last_heartbeat_at
            FROM capability_jobs
            WHERE job_id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|e| format!("准备查询 capability job 失败: {e}"))?;
    let mut rows = stmt
        .query(params![normalize_required_text(job_id, "job_id")?])
        .map_err(|e| format!("读取 capability job 失败: {e}"))?;
    rows.next()
        .map_err(|e| format!("读取 capability job 结果失败: {e}"))?
        .map(parse_capability_job_row)
        .transpose()
        .map_err(|e| format!("解析 capability job 失败: {e}"))
}

pub fn list_capability_jobs(
    owner_agent_id: Option<&str>,
    status: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<CapabilityJobRecord>, String> {
    let conn = open_conn()?;
    let normalized_owner_agent_id = owner_agent_id
        .map(|value| value.trim().to_string())
        .and_then(normalize_nullable_text);
    let normalized_status = status
        .map(|value| value.trim().to_string())
        .and_then(normalize_nullable_text)
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| value != "all");
    let mut sql = String::from(
        r#"
        SELECT
            job_id,
            owner_agent_id,
            capability_key,
            capability_scope,
            provider_id,
            provider_type,
            route,
            title,
            summary,
            status,
            progress_percent,
            stage,
            job_type,
            input_payload_json,
            result_payload_json,
            error_message,
            metadata_json,
            created_at,
            updated_at,
            started_at,
            finished_at,
            last_heartbeat_at
        FROM capability_jobs
        WHERE 1 = 1
        "#,
    );
    let mut params_vec: Vec<SqlValue> = Vec::new();
    if let Some(agent_id) = normalized_owner_agent_id {
        sql.push_str(" AND owner_agent_id = ?");
        params_vec.push(SqlValue::Text(agent_id));
    }
    if let Some(status) = normalized_status {
        sql.push_str(" AND status = ?");
        params_vec.push(SqlValue::Text(status));
    }
    sql.push_str(" ORDER BY updated_at DESC LIMIT ?");
    params_vec.push(SqlValue::Integer(i64::from(
        limit.unwrap_or(200).clamp(1, 500),
    )));
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("准备 capability job 列表失败: {e}"))?;
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(params_vec),
            parse_capability_job_row,
        )
        .map_err(|e| format!("查询 capability job 列表失败: {e}"))?;
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析 capability job 列表失败: {e}"))?);
    }
    Ok(output)
}

pub fn list_capability_audit_logs(
    limit: Option<u32>,
) -> Result<Vec<CapabilityAuditLogRecord>, String> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, event_type, provider_id, agent_id, capability_key, capability_scope, payload_json, created_at
            FROM capability_audit_logs
            ORDER BY created_at DESC
            LIMIT ?1
            "#,
        )
        .map_err(|e| format!("准备 capability audit log 列表失败: {e}"))?;
    let rows = stmt
        .query_map(
            params![i64::from(limit.unwrap_or(200).clamp(1, 500))],
            |row| {
                let payload_json: String = row.get(6)?;
                Ok(CapabilityAuditLogRecord {
                    id: row.get(0)?,
                    event_type: row.get(1)?,
                    provider_id: row.get(2)?,
                    agent_id: row.get(3)?,
                    capability_key: row.get(4)?,
                    capability_scope: row.get(5)?,
                    payload: parse_json_value_or_default(
                        &payload_json,
                        Value::Object(Default::default()),
                    ),
                    created_at: row.get(7)?,
                })
            },
        )
        .map_err(|e| format!("查询 capability audit log 列表失败: {e}"))?;
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|e| format!("解析 capability audit log 失败: {e}"))?);
    }
    Ok(output)
}

fn normalize_capability_provider_record(
    record: CapabilityProviderRecord,
) -> Result<CapabilityProviderRecord, String> {
    let provider_id = normalize_required_text(&record.provider_id, "provider_id")?;
    let provider_type = normalize_required_text(&record.provider_type, "provider_type")?;
    let display_name = record.display_name.and_then(normalize_nullable_text);
    let capabilities = record
        .capabilities
        .into_iter()
        .map(normalize_capability_descriptor_record)
        .collect::<Result<Vec<_>, _>>()?;
    let supported_scopes = record
        .supported_scopes
        .into_iter()
        .map(|value| normalize_capability_scope(&value))
        .collect::<Vec<_>>();
    Ok(CapabilityProviderRecord {
        provider_id,
        provider_type,
        display_name,
        capabilities,
        supported_scopes,
        priority: record.priority,
        requirements: normalize_json_object_like(record.requirements),
        supports_job: record.supports_job,
        enabled: record.enabled,
        health_state: normalize_optional_text(&record.health_state),
        input_contract: normalize_json_object_like(record.input_contract),
        output_contract: normalize_json_object_like(record.output_contract),
        metadata: normalize_json_object_like(record.metadata),
        is_removed: record.is_removed,
        updated_at: record.updated_at,
    })
}

fn normalize_capability_descriptor_record(
    record: CapabilityDescriptorRecord,
) -> Result<CapabilityDescriptorRecord, String> {
    Ok(CapabilityDescriptorRecord {
        key: normalize_capability_key(&record.key),
        scope: normalize_capability_scope(&record.scope),
    })
}

fn normalize_capability_provider_binding_record(
    record: CapabilityProviderBindingRecord,
) -> Result<CapabilityProviderBindingRecord, String> {
    Ok(CapabilityProviderBindingRecord {
        capability_key: normalize_capability_key(&record.capability_key),
        capability_scope: normalize_capability_scope(&record.capability_scope),
        provider_id: normalize_required_text(&record.provider_id, "provider_id")?,
        enabled: record.enabled,
        updated_at: record.updated_at,
    })
}

fn normalize_agent_capability_binding_record(
    record: AgentCapabilityBindingRecord,
) -> Result<AgentCapabilityBindingRecord, String> {
    Ok(AgentCapabilityBindingRecord {
        agent_id: normalize_required_text(&record.agent_id, "agent_id")?,
        capability_key: normalize_capability_key(&record.capability_key),
        capability_scope: normalize_capability_scope(&record.capability_scope),
        provider_id: record.provider_id.and_then(normalize_nullable_text),
        binding_type: normalize_binding_type(&record.binding_type),
        enabled: record.enabled,
        updated_at: record.updated_at,
    })
}

fn normalize_renderer_binding_record(
    record: RendererBindingRecord,
) -> Result<RendererBindingRecord, String> {
    Ok(RendererBindingRecord {
        channel: normalize_required_text(&record.channel, "channel")?,
        result_kind: normalize_required_text(&record.result_kind, "result_kind")?,
        media_type: record.media_type.and_then(normalize_nullable_text),
        document_type: record.document_type.and_then(normalize_nullable_text),
        renderer_key: normalize_required_text(&record.renderer_key, "renderer_key")?,
        enabled: record.enabled,
        fallback_channel: record.fallback_channel.and_then(normalize_nullable_text),
        updated_at: record.updated_at,
    })
}

fn normalize_provider_health_state_record(
    record: ProviderHealthStateRecord,
) -> Result<ProviderHealthStateRecord, String> {
    Ok(ProviderHealthStateRecord {
        provider_id: normalize_required_text(&record.provider_id, "provider_id")?,
        health_state: normalize_optional_text(&record.health_state),
        message: record.message.and_then(normalize_nullable_text),
        checked_at: normalize_required_text(&record.checked_at, "checked_at")?,
        updated_at: record.updated_at,
    })
}

fn normalize_capability_job_record(
    record: CapabilityJobRecord,
) -> Result<CapabilityJobRecord, String> {
    Ok(CapabilityJobRecord {
        job_id: normalize_required_text(&record.job_id, "job_id")?,
        owner_agent_id: normalize_required_text(&record.owner_agent_id, "owner_agent_id")?,
        capability_key: normalize_capability_key(&record.capability_key),
        capability_scope: normalize_capability_scope(&record.capability_scope),
        provider_id: record.provider_id.and_then(normalize_nullable_text),
        provider_type: record.provider_type.and_then(normalize_nullable_text),
        route: record.route.and_then(normalize_nullable_text),
        title: record.title.and_then(normalize_nullable_text),
        summary: record.summary.and_then(normalize_nullable_text),
        status: normalize_required_text(&record.status, "status")?.to_ascii_lowercase(),
        progress_percent: record.progress_percent.map(|value| value.clamp(0.0, 100.0)),
        stage: record.stage.and_then(normalize_nullable_text),
        job_type: record.job_type.and_then(normalize_nullable_text),
        input_payload: normalize_json_object_like(record.input_payload),
        result_payload: normalize_json_object_like(record.result_payload),
        error_message: record.error_message.and_then(normalize_nullable_text),
        metadata: normalize_json_object_like(record.metadata),
        created_at: record.created_at,
        updated_at: record.updated_at,
        started_at: record.started_at.and_then(normalize_nullable_text),
        finished_at: record.finished_at.and_then(normalize_nullable_text),
        last_heartbeat_at: record.last_heartbeat_at.and_then(normalize_nullable_text),
    })
}

fn normalize_json_object_like(value: Value) -> Value {
    if value.is_null() {
        Value::Object(Default::default())
    } else {
        value
    }
}

fn normalize_optional_text(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_required_text(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} 不能为空"));
    }
    Ok(trimmed.to_string())
}

fn normalize_capability_key(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn normalize_capability_scope(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "self" => "self".to_string(),
        _ => "generic".to_string(),
    }
}

fn normalize_binding_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "provider" => "provider".to_string(),
        _ => "capability".to_string(),
    }
}

fn parse_capability_provider_row(
    row: &rusqlite::Row<'_>,
) -> Result<CapabilityProviderRecord, rusqlite::Error> {
    let capabilities_json: String = row.get(3)?;
    let supported_scopes_json: String = row.get(4)?;
    let requirements_json: String = row.get(6)?;
    let input_contract_json: String = row.get(10)?;
    let output_contract_json: String = row.get(11)?;
    let metadata_json: String = row.get(12)?;
    let capabilities = serde_json::from_str::<Vec<CapabilityDescriptorRecord>>(&capabilities_json)
        .unwrap_or_default();
    let supported_scopes = serde_json::from_str::<Vec<String>>(&supported_scopes_json)
        .unwrap_or_default()
        .into_iter()
        .map(|value| normalize_capability_scope(&value))
        .collect::<Vec<_>>();
    Ok(CapabilityProviderRecord {
        provider_id: row.get(0)?,
        provider_type: row.get(1)?,
        display_name: row.get(2)?,
        capabilities,
        supported_scopes,
        priority: row.get(5)?,
        requirements: parse_json_value_or_default(
            &requirements_json,
            Value::Object(Default::default()),
        ),
        supports_job: row.get::<_, i64>(7)? != 0,
        enabled: row.get::<_, i64>(8)? != 0,
        health_state: row.get(9)?,
        input_contract: parse_json_value_or_default(
            &input_contract_json,
            Value::Object(Default::default()),
        ),
        output_contract: parse_json_value_or_default(
            &output_contract_json,
            Value::Object(Default::default()),
        ),
        metadata: parse_json_value_or_default(&metadata_json, Value::Object(Default::default())),
        is_removed: row.get::<_, i64>(13)? != 0,
        updated_at: row.get(14)?,
    })
}

fn parse_capability_job_row(
    row: &rusqlite::Row<'_>,
) -> Result<CapabilityJobRecord, rusqlite::Error> {
    let input_payload_json: String = row.get(13)?;
    let result_payload_json: String = row.get(14)?;
    let metadata_json: String = row.get(16)?;
    Ok(CapabilityJobRecord {
        job_id: row.get(0)?,
        owner_agent_id: row.get(1)?,
        capability_key: row.get(2)?,
        capability_scope: row.get(3)?,
        provider_id: row.get(4)?,
        provider_type: row.get(5)?,
        route: row.get(6)?,
        title: row.get(7)?,
        summary: row.get(8)?,
        status: row.get(9)?,
        progress_percent: row.get(10)?,
        stage: row.get(11)?,
        job_type: row.get(12)?,
        input_payload: parse_json_value_or_default(
            &input_payload_json,
            Value::Object(Default::default()),
        ),
        result_payload: parse_json_value_or_default(
            &result_payload_json,
            Value::Object(Default::default()),
        ),
        error_message: row.get(15)?,
        metadata: parse_json_value_or_default(&metadata_json, Value::Object(Default::default())),
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        started_at: row.get(19)?,
        finished_at: row.get(20)?,
        last_heartbeat_at: row.get(21)?,
    })
}

fn open_conn() -> Result<Connection, String> {
    let db = ensure_db()?;
    open_sqlite_connection(&db)
}

fn db_path() -> Result<PathBuf, String> {
    path_resolver::management_db_path()
}

fn open_sqlite_connection(db: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("设置数据库 busy_timeout 失败: {e}"))?;
    Ok(conn)
}
