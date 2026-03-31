use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskSourceType {
    Chat,
    Manual,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskConversationType {
    Dm,
    Group,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskState {
    Draft,
    Scheduled,
    Running,
    Paused,
    Completed,
    Failed,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskStatus {
    Idle,
    Running,
    Ok,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskDeliveryMode {
    None,
    Announce,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskDeliveryTargetKind {
    ChatMessage,
    PcNotice,
    Webhook,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskDeliveryStatus {
    Pending,
    Reported,
    Acknowledged,
    Failed,
}

impl Default for ManagedTaskDeliveryStatus {
    fn default() -> Self {
        Self::Pending
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskDeliveryAttemptStatus {
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskDeliveryConsumerKind {
    ChatMessageDispatcher,
    PcNoticeBridge,
    WebhookDispatcher,
    InternalAdapter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskEventType {
    Created,
    Published,
    Paused,
    Started,
    Progress,
    Anomaly,
    Succeeded,
    Failed,
    Completed,
    DeliveryPending,
    DeliverySent,
    DeliveryFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedTaskRunTriggerType {
    Schedule,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskSchedule {
    pub kind: String,
    pub expr: Option<String>,
    pub tz: Option<String>,
    pub at: Option<String>,
    pub every_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManagedTaskBinding {
    pub origin_conversation_type: Option<ManagedTaskConversationType>,
    pub origin_conversation_id: Option<String>,
    pub origin_chat_session_id: Option<String>,
    pub origin_message_id: Option<String>,
    pub remote_chat_session_id: Option<String>,
    pub remote_chat_session_owner_agent_id: Option<String>,
    pub creator_participant_id: Option<String>,
    pub creator_participant_name: Option<String>,
    pub executor_agent_id: Option<String>,
    pub executor_agent_name: Option<String>,
    pub report_actor_agent_id: Option<String>,
    pub report_actor_agent_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManagedTaskAction {
    pub job_type: String,
    pub prompt: Option<String>,
    pub command: Option<String>,
    pub session_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskDeliveryConfig {
    pub mode: ManagedTaskDeliveryMode,
    pub channel: Option<String>,
    pub to: Option<String>,
    pub best_effort: Option<bool>,
    pub final_summary_prompt: Option<String>,
    pub notify_on_final: Option<bool>,
}

impl Default for ManagedTaskDeliveryConfig {
    fn default() -> Self {
        Self {
            mode: ManagedTaskDeliveryMode::None,
            channel: None,
            to: None,
            best_effort: Some(true),
            final_summary_prompt: None,
            notify_on_final: Some(true),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskSpec {
    pub id: String,
    pub agent_id: String,
    pub name: String,
    pub source_type: ManagedTaskSourceType,
    pub source_ref: Option<String>,
    pub report_condition: Option<String>,
    pub summary_style: Option<String>,
    pub enabled: bool,
    pub schedule: ManagedTaskSchedule,
    pub action: ManagedTaskAction,
    pub delivery: ManagedTaskDeliveryConfig,
    pub max_runs: Option<u64>,
    pub binding: ManagedTaskBinding,
    pub cron_job_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskRuntime {
    pub state: ManagedTaskState,
    pub next_run: Option<String>,
    pub last_run: Option<String>,
    pub last_status: ManagedTaskStatus,
    pub last_output: Option<String>,
    pub run_count: u64,
    pub consecutive_errors: u32,
    pub latest_summary: Option<String>,
    pub last_error: Option<String>,
    pub completed_at: Option<String>,
    pub disabled_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskDetail {
    pub spec: ManagedTaskSpec,
    pub runtime: ManagedTaskRuntime,
    #[serde(default)]
    pub final_summary: Option<ManagedTaskFinalSummary>,
    #[serde(default)]
    pub delivery_stats: ManagedTaskDeliveryStats,
    #[serde(default)]
    pub capabilities: ManagedTaskCapabilities,
    #[serde(default)]
    pub timeline: Vec<ManagedTaskTimelineEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskRun {
    pub id: String,
    pub task_id: String,
    pub run_no: u64,
    pub trigger_type: ManagedTaskRunTriggerType,
    pub status: ManagedTaskStatus,
    pub output: Option<String>,
    pub error: Option<String>,
    pub summary: Option<String>,
    pub start_time: String,
    pub end_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskEvent {
    pub id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub event_type: ManagedTaskEventType,
    pub summary: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskDelivery {
    pub id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub event_id: Option<String>,
    pub target_kind: ManagedTaskDeliveryTargetKind,
    pub status: ManagedTaskDeliveryStatus,
    pub origin_chat_session_id: Option<String>,
    pub origin_message_id: Option<String>,
    pub title: String,
    pub body: String,
    pub payload: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
    pub delivered_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskDeliveryAttempt {
    pub id: String,
    pub delivery_id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub event_id: Option<String>,
    pub target_kind: ManagedTaskDeliveryTargetKind,
    pub consumer_kind: ManagedTaskDeliveryConsumerKind,
    pub status: ManagedTaskDeliveryAttemptStatus,
    pub error: Option<String>,
    pub metadata_json: serde_json::Value,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManagedTaskFinalSummary {
    pub run_count: u64,
    pub status: Option<String>,
    pub content: String,
    pub created_at: String,
    pub run_id: Option<String>,
    pub event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManagedTaskDeliveryStats {
    pub total: u64,
    pub pending: u64,
    pub reported: u64,
    pub acknowledged: u64,
    pub failed: u64,
    pub attempts: u64,
    pub attempt_failures: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManagedTaskCapabilities {
    pub publish: bool,
    pub pause: bool,
    pub run_once: bool,
    pub delete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskTimelineEntry {
    pub id: String,
    pub source_kind: String,
    pub source_id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub event_id: Option<String>,
    pub target_kind: Option<ManagedTaskDeliveryTargetKind>,
    pub status: Option<String>,
    pub summary: String,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedTaskCreateRequest {
    pub agent_id: String,
    pub name: String,
    pub source_type: ManagedTaskSourceType,
    pub source_ref: Option<String>,
    pub report_condition: Option<String>,
    pub summary_style: Option<String>,
    pub enabled: Option<bool>,
    pub schedule: ManagedTaskSchedule,
    pub action: ManagedTaskAction,
    pub delivery: Option<ManagedTaskDeliveryConfig>,
    pub max_runs: Option<u64>,
    pub binding: Option<ManagedTaskBinding>,
}
