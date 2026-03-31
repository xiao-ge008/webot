//! Request/response types for the OpenFang API.

use serde::{Deserialize, Serialize};

/// Request to spawn an agent from a TOML manifest string.
#[derive(Debug, Deserialize)]
pub struct SpawnRequest {
    /// Agent manifest as TOML string.
    pub manifest_toml: String,
    /// Optional Ed25519 signed manifest envelope (JSON).
    /// When present, the signature is verified before spawning.
    #[serde(default)]
    pub signed_manifest: Option<String>,
}

/// Response after spawning an agent.
#[derive(Debug, Serialize)]
pub struct SpawnResponse {
    pub agent_id: String,
    pub name: String,
}

/// A file attachment reference (from a prior upload).
#[derive(Debug, Clone, Deserialize)]
pub struct AttachmentRef {
    pub file_id: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub content_type: String,
}

/// Request to send a message to an agent.
#[derive(Debug, Deserialize)]
pub struct MessageRequest {
    pub message: String,
    /// Optional file attachments (uploaded via /upload endpoint).
    #[serde(default)]
    pub attachments: Vec<AttachmentRef>,
    /// Optional request-origin hint used for quota routing.
    #[serde(default)]
    pub request_origin: Option<String>,
    /// Optional tool blocklist applied only for this chat turn.
    #[serde(default)]
    pub blocked_tools: Vec<String>,
}

/// Response from sending a message.
#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub response: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub iterations: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
}

/// Request to install a skill from the marketplace.
#[derive(Debug, Deserialize)]
pub struct SkillInstallRequest {
    pub name: String,
}

/// Request to uninstall a skill.
#[derive(Debug, Deserialize)]
pub struct SkillUninstallRequest {
    pub name: String,
}

/// Request to update an agent's manifest.
#[derive(Debug, Deserialize)]
pub struct AgentUpdateRequest {
    pub manifest_toml: String,
}

/// Request to change an agent's operational mode.
#[derive(Debug, Deserialize)]
pub struct SetModeRequest {
    pub mode: openfang_types::agent::AgentMode,
}

/// Request to run a migration.
#[derive(Debug, Deserialize)]
pub struct MigrateRequest {
    pub source: String,
    pub source_dir: String,
    pub target_dir: String,
    #[serde(default)]
    pub dry_run: bool,
}

/// Request to scan a directory for migration.
#[derive(Debug, Deserialize)]
pub struct MigrateScanRequest {
    pub path: String,
}

/// Request to install a skill from ClawHub.
#[derive(Debug, Deserialize)]
pub struct ClawHubInstallRequest {
    /// ClawHub skill slug (e.g., "github-helper").
    pub slug: String,
}

#[derive(Debug, Deserialize)]
pub struct ManagedTaskListQuery {
    #[serde(default)]
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ManagedTaskPendingDeliveriesQuery {
    #[serde(default)]
    pub target_kind: Option<String>,
    #[serde(default)]
    pub origin_chat_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ManagedTaskDeliveryStatusUpdateRequest {
    pub status: openfang_types::tasks::ManagedTaskDeliveryStatus,
}

#[derive(Debug, Deserialize)]
pub struct ManagedTaskDeliveryAttemptCreateRequest {
    pub task_id: String,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub event_id: Option<String>,
    pub target_kind: openfang_types::tasks::ManagedTaskDeliveryTargetKind,
    pub consumer_kind: openfang_types::tasks::ManagedTaskDeliveryConsumerKind,
    pub status: openfang_types::tasks::ManagedTaskDeliveryAttemptStatus,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub metadata_json: serde_json::Value,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub finished_at: Option<String>,
}
