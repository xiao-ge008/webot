pub mod assignment_store;
pub mod capability_registry;
pub mod component_center;
pub mod config;
pub mod error;
pub mod image_generation;
pub mod media_index;
pub mod ocr_service;
pub mod openfang;
pub mod path_resolver;
pub mod routes;
pub mod tts_management;
pub mod vision_analysis;

use std::fs;
use std::io;
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Once};
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use config::ServiceConfig;
use openfang::OpenFangClient;
use serde_json::json;
use serde_json::Value;
use socket2::{Domain, Protocol, Socket, Type};
use tokio::process::{Child, Command};
use tokio::sync::{watch, Mutex, RwLock};
use tokio::time::sleep;
use toml::value::Table as TomlTable;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const LEGACY_CHAT_TASK_STARTUP_RECONCILE_ATTEMPTS: usize = 16;

#[derive(Clone)]
pub struct AppState {
    pub config: ServiceConfig,
    pub openfang: OpenFangClient,
    pub power_state: Arc<RwLock<ServicePowerState>>,
    pub managed_openfang: Arc<Mutex<Option<ManagedOpenfangProcess>>>,
    pub provider_cache: Arc<RwLock<Option<serde_json::Value>>>,
    pub model_cache: Arc<RwLock<Option<serde_json::Value>>>,
}

#[derive(Debug)]
pub struct ServicePowerState {
    pub online: bool,
    pub last_error: Option<String>,
}

pub struct ManagedOpenfangProcess {
    pub child: Child,
    pub launch_desc: String,
}

pub struct PowerOnResult {
    pub health: Value,
    pub launched: bool,
    pub launch: Option<String>,
}

struct OpenfangLaunchCandidate {
    command: String,
    args: Vec<String>,
    workdir: Option<PathBuf>,
}

pub struct EmbeddedServerHandle {
    pub listen_addr: SocketAddr,
    shutdown_tx: watch::Sender<bool>,
    server_thread: Option<std::thread::JoinHandle<()>>,
}

impl EmbeddedServerHandle {
    pub fn shutdown(mut self) {
        let _ = self.shutdown_tx.send(true);
        if let Some(thread) = self.server_thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for EmbeddedServerHandle {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.send(true);
    }
}

pub fn init_tracing() {
    static TRACING_INIT: Once = Once::new();
    TRACING_INIT.call_once(|| {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "webot_service_rs=info,tower_http=info".into()),
            )
            .init();
    });
}

pub fn reconcile_runtime_config_from_storage() -> Result<(), String> {
    assignment_store::bootstrap_storage()?;
    let provider_configs = assignment_store::list_provider_configs()?;
    let provider_enabled = assignment_store::list_provider_enabled_map()?;
    let model_enabled = assignment_store::list_model_enabled_map()?;
    let mut default_model = assignment_store::get_default_model()?;

    let config_path = path_resolver::openfang_config_path()?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 OpenFang 配置目录失败: {e}"))?;
    }

    let mut root: TomlTable = if config_path.exists() {
        let content =
            fs::read_to_string(&config_path).map_err(|e| format!("读取 OpenFang 配置失败: {e}"))?;
        toml::from_str::<TomlTable>(&content).unwrap_or_default()
    } else {
        TomlTable::new()
    };

    let mut toml_providers = Vec::new();
    let mut valid_default = false;
    for cfg in provider_configs {
        let provider_id = assignment_store::normalize_provider_id(&cfg.provider_id);
        if provider_id.is_empty() {
            continue;
        }
        if !provider_enabled.get(&provider_id).copied().unwrap_or(true) {
            continue;
        }
        let provider_ready = cfg
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
            || cfg
                .base_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_some();

        let mut models = cfg
            .models
            .iter()
            .map(|item| assignment_store::normalize_model_name(item))
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>();
        models.sort_by_key(|item| item.to_ascii_lowercase());
        models.dedup_by(|left, right| left.eq_ignore_ascii_case(right));

        let mut provider_table = TomlTable::new();
        provider_table.insert("id".to_string(), toml::Value::String(provider_id.clone()));
        provider_table.insert(
            "protocol".to_string(),
            toml::Value::String(cfg.protocol.trim().to_ascii_lowercase()),
        );
        if let Some(base_url) = cfg
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            provider_table.insert(
                "base_url".to_string(),
                toml::Value::String(base_url.trim_end_matches('/').to_string()),
            );
        }
        if let Some(api_key) = cfg
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            provider_table.insert(
                "api_key".to_string(),
                toml::Value::String(api_key.to_string()),
            );
        }
        toml_providers.push(toml::Value::Table(provider_table));

        if let Some(default_id) = default_model.as_deref() {
            for model_name in &models {
                let model_id = assignment_store::make_model_id(&provider_id, model_name);
                if !model_enabled.get(&model_id).copied().unwrap_or(true) {
                    continue;
                }
                if provider_ready && model_id == default_id {
                    valid_default = true;
                    break;
                }
            }
        }
    }

    if !valid_default {
        if default_model.is_some() {
            assignment_store::clear_default_model()?;
        }
        default_model = None;
    }

    root.insert("providers".to_string(), toml::Value::Array(toml_providers));
    if let Some(default_id) = default_model {
        if let Some((provider_id, model_name)) = default_id.split_once("::") {
            let normalized_provider_id = assignment_store::normalize_provider_id(provider_id);
            let provider_config = assignment_store::get_provider_config(&normalized_provider_id)
                .ok()
                .flatten();
            let mut default_table = TomlTable::new();
            default_table.insert(
                "provider".to_string(),
                toml::Value::String(normalized_provider_id.clone()),
            );
            default_table.insert(
                "model".to_string(),
                toml::Value::String(assignment_store::normalize_model_name(model_name)),
            );
            let api_key_env = provider_config
                .as_ref()
                .and_then(resolve_provider_api_key_env)
                .unwrap_or_else(|| default_provider_api_key_env(&normalized_provider_id));
            if !api_key_env.is_empty() {
                default_table.insert("api_key_env".to_string(), toml::Value::String(api_key_env));
            }
            if let Some(base_url) = provider_config
                .as_ref()
                .and_then(|cfg| cfg.base_url.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                default_table.insert(
                    "base_url".to_string(),
                    toml::Value::String(base_url.trim_end_matches('/').to_string()),
                );
            }
            root.insert(
                "default_model".to_string(),
                toml::Value::Table(default_table),
            );
        } else {
            root.remove("default_model");
        }
    } else {
        root.remove("default_model");
    }

    let output =
        toml::to_string_pretty(&root).map_err(|e| format!("序列化 OpenFang 配置失败: {e}"))?;
    fs::write(&config_path, output).map_err(|e| format!("写入 OpenFang 配置失败: {e}"))?;
    Ok(())
}

fn resolve_provider_api_key_env(
    provider: &assignment_store::ProviderConfigRecord,
) -> Option<String> {
    let normalized_provider_id = assignment_store::normalize_provider_id(&provider.provider_id);
    if normalized_provider_id.is_empty() {
        return None;
    }

    if provider
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return Some(default_provider_api_key_env(&normalized_provider_id));
    }

    None
}

fn default_provider_api_key_env(provider_id: &str) -> String {
    match provider_id.trim().to_ascii_lowercase().as_str() {
        "groq" => "GROQ_API_KEY".to_string(),
        "anthropic" => "ANTHROPIC_API_KEY".to_string(),
        "openai" => "OPENAI_API_KEY".to_string(),
        "gemini" => "GEMINI_API_KEY".to_string(),
        "google" => "GOOGLE_API_KEY".to_string(),
        "deepseek" => "DEEPSEEK_API_KEY".to_string(),
        "openrouter" => "OPENROUTER_API_KEY".to_string(),
        "together" => "TOGETHER_API_KEY".to_string(),
        "mistral" => "MISTRAL_API_KEY".to_string(),
        "fireworks" => "FIREWORKS_API_KEY".to_string(),
        "perplexity" => "PERPLEXITY_API_KEY".to_string(),
        "cohere" => "COHERE_API_KEY".to_string(),
        "ai21" => "AI21_API_KEY".to_string(),
        "cerebras" => "CEREBRAS_API_KEY".to_string(),
        "sambanova" => "SAMBANOVA_API_KEY".to_string(),
        "huggingface" => "HF_API_KEY".to_string(),
        "xai" => "XAI_API_KEY".to_string(),
        "replicate" => "REPLICATE_API_TOKEN".to_string(),
        "github-copilot" | "copilot" => "GITHUB_TOKEN".to_string(),
        "codex" | "openai-codex" => "OPENAI_API_KEY".to_string(),
        "claude-code" => String::new(),
        "moonshot" | "kimi" => "MOONSHOT_API_KEY".to_string(),
        "qwen" | "dashscope" => "DASHSCOPE_API_KEY".to_string(),
        "minimax" => "MINIMAX_API_KEY".to_string(),
        "zhipu" | "glm" | "zhipu_coding" | "codegeex" | "zai" | "zai_coding" => {
            "ZHIPU_API_KEY".to_string()
        }
        "qianfan" | "baidu" => "QIANFAN_API_KEY".to_string(),
        "volcengine" | "doubao" | "volcengine_coding" => "VOLCENGINE_API_KEY".to_string(),
        "nvidia" | "nvidia-nim" => "NVIDIA_API_KEY".to_string(),
        other => {
            let mut env_key = String::with_capacity(other.len() + "_API_KEY".len());
            for ch in other.chars() {
                if ch.is_ascii_alphanumeric() {
                    env_key.push(ch.to_ascii_uppercase());
                } else {
                    env_key.push('_');
                }
            }
            env_key.push_str("_API_KEY");
            env_key
        }
    }
}

pub async fn run_from_env() -> Result<(), Box<dyn std::error::Error>> {
    if ocr_service::should_run_sidecar_from_env() {
        ocr_service::run_sidecar_from_env()
            .await
            .map_err(|error| std::io::Error::other(error))?;
        return Ok(());
    }
    let config = ServiceConfig::from_env();
    run_with_config(config).await
}

pub async fn run_with_config(config: ServiceConfig) -> Result<(), Box<dyn std::error::Error>> {
    assignment_store::bootstrap_storage()
        .map_err(|e| std::io::Error::other(format!("初始化本地存储失败: {e}")))?;

    let openfang = OpenFangClient::new(
        config.openfang_base_url.clone(),
        config.openfang_api_key.clone(),
        config.request_timeout_ms,
    )?;

    let state = build_state(config, openfang);
    let listen_addr = state.config.listen_addr;
    spawn_auto_power_on(state.clone());
    spawn_task_delivery_dispatcher(state.clone());
    let app = build_app(state);
    let std_listener = create_reusable_listener(listen_addr)?;
    std_listener.set_nonblocking(true)?;
    let listener = tokio::net::TcpListener::from_std(std_listener)?;

    write_service_url_file(listen_addr);
    info!("webot-service-rs listening on http://{listen_addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

pub fn start_embedded(
    mut config: ServiceConfig,
) -> Result<EmbeddedServerHandle, Box<dyn std::error::Error>> {
    let std_listener = create_reusable_listener(config.listen_addr)?;
    let listen_addr = std_listener.local_addr()?;
    config.listen_addr = listen_addr;

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_thread = std::thread::Builder::new()
        .name("webot-service-rs".to_string())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("failed to create tokio runtime for embedded service");

            runtime.block_on(async move {
                std_listener
                    .set_nonblocking(true)
                    .expect("failed to set std listener nonblocking");

                let listener = tokio::net::TcpListener::from_std(std_listener)
                    .expect("failed to convert std listener to tokio listener");

                if let Err(err) = serve_with_shutdown(config, listener, shutdown_rx).await {
                    error!("embedded webot-service-rs stopped with error: {err}");
                }
            });
        })?;

    Ok(EmbeddedServerHandle {
        listen_addr,
        shutdown_tx,
        server_thread: Some(server_thread),
    })
}

fn create_reusable_listener(listen_addr: SocketAddr) -> io::Result<TcpListener> {
    let domain = if listen_addr.is_ipv4() {
        Domain::IPV4
    } else {
        Domain::IPV6
    };
    let socket = Socket::new(domain, Type::STREAM, Some(Protocol::TCP))?;
    socket.set_reuse_address(true)?;
    socket.bind(&listen_addr.into())?;
    socket.listen(1024)?;
    Ok(socket.into())
}

async fn serve_with_shutdown(
    config: ServiceConfig,
    listener: tokio::net::TcpListener,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), String> {
    assignment_store::bootstrap_storage().map_err(|e| format!("初始化本地存储失败: {e}"))?;

    let openfang = OpenFangClient::new(
        config.openfang_base_url.clone(),
        config.openfang_api_key.clone(),
        config.request_timeout_ms,
    )
    .map_err(|e| format!("创建 OpenFang 客户端失败: {e}"))?;

    let state = build_state(config.clone(), openfang);
    let state_for_shutdown = state.clone();
    spawn_auto_power_on(state.clone());
    spawn_task_delivery_dispatcher(state.clone());

    write_service_url_file(config.listen_addr);
    info!(
        "embedded webot-service-rs listening on http://{}",
        config.listen_addr
    );

    axum::serve(listener, build_app(state))
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx
                .wait_for(|should_shutdown| *should_shutdown)
                .await;
            info!("embedded webot-service-rs received shutdown signal");
        })
        .await
        .map_err(|e| format!("embedded webot-service-rs runtime error: {e}"))?;

    if let Err(err) = state_for_shutdown.shutdown_managed_openfang().await {
        warn!("shutdown managed openfang failed: {err}");
    }

    Ok(())
}

fn build_state(config: ServiceConfig, openfang: OpenFangClient) -> Arc<AppState> {
    Arc::new(AppState {
        config,
        openfang,
        power_state: Arc::new(RwLock::new(ServicePowerState {
            online: false,
            last_error: None,
        })),
        managed_openfang: Arc::new(Mutex::new(None)),
        provider_cache: Arc::new(RwLock::new(None)),
        model_cache: Arc::new(RwLock::new(None)),
    })
}

fn write_service_url_file(listen_addr: SocketAddr) {
    let Ok(home) = path_resolver::webot_home_dir() else {
        return;
    };
    if fs::create_dir_all(&home).is_err() {
        return;
    }
    let path = home.join("service-url.txt");
    let _ = fs::write(&path, format!("http://{listen_addr}"));
}

fn spawn_auto_power_on(state: Arc<AppState>) {
    if !state.config.openfang_auto_start {
        info!("OPENFANG_AUTO_START=false, skip auto power-on");
        return;
    }

    tokio::spawn(async move {
        match state.power_on().await {
            Ok(result) => {
                if result.launched {
                    info!(
                        "auto power-on succeeded after spawning OpenFang: {}",
                        result
                            .launch
                            .unwrap_or_else(|| "unknown launcher".to_string())
                    );
                } else {
                    info!("auto power-on succeeded (OpenFang already reachable)");
                }
                if let Err(err) = quarantine_legacy_chat_tasks_on_startup(state.clone()).await {
                    warn!(error = %err, "legacy chat task startup quarantine failed");
                }
            }
            Err(err) => {
                warn!("auto power-on failed: {err}");
            }
        }
    });
}

async fn quarantine_legacy_chat_tasks_on_startup(state: Arc<AppState>) -> Result<(), String> {
    wait_for_openfang_health(&state).await?;

    let payload = state
        .openfang
        .get_json("/api/tasks")
        .await
        .map_err(|error| error.message)?;
    let rows = payload
        .as_array()
        .ok_or_else(|| "OpenFang /api/tasks 返回格式异常".to_string())?;

    let mut candidates: Vec<LegacyChatTaskCandidate> = Vec::new();
    for row in rows {
        if let Some(candidate) = extract_legacy_chat_task_candidate(row) {
            candidates.push(candidate);
        }
    }

    if candidates.is_empty() {
        info!("startup legacy chat task quarantine skipped: no legacy chat tasks");
        return Ok(());
    }

    let mut paused_ids: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    let mut already_inactive = 0usize;

    for candidate in candidates {
        if !candidate.enabled {
            already_inactive += 1;
            continue;
        }
        let path = format!("/api/tasks/{}/pause", candidate.task_id);
        match state.openfang.post_json(&path, json!({})).await {
            Ok(_) => paused_ids.push(format!("{}({})", candidate.task_id, candidate.reason)),
            Err(error) => failed.push(format!(
                "{}({}): {}",
                candidate.task_id, candidate.reason, error.message
            )),
        }
    }

    if !paused_ids.is_empty() {
        info!(
            paused = %paused_ids.join(", "),
            already_inactive,
            "startup legacy chat tasks quarantined"
        );
    }
    if !failed.is_empty() {
        warn!(
            failed = %failed.join(" | "),
            already_inactive,
            "startup legacy chat tasks quarantine partially failed"
        );
    }

    Ok(())
}

async fn wait_for_openfang_health(state: &Arc<AppState>) -> Result<(), String> {
    for attempt in 1..=LEGACY_CHAT_TASK_STARTUP_RECONCILE_ATTEMPTS {
        match state.openfang.get_json("/api/health").await {
            Ok(_) => return Ok(()),
            Err(error) => {
                if attempt == LEGACY_CHAT_TASK_STARTUP_RECONCILE_ATTEMPTS {
                    return Err(error.message);
                }
                sleep(Duration::from_millis(750)).await;
            }
        }
    }
    Err("等待 OpenFang 就绪超时".to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LegacyChatTaskCandidate {
    task_id: String,
    enabled: bool,
    reason: &'static str,
}

fn extract_legacy_chat_task_candidate(row: &Value) -> Option<LegacyChatTaskCandidate> {
    let task_id = row
        .pointer("/spec/id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let source_type = row
        .pointer("/spec/source_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if !source_type.eq_ignore_ascii_case("chat") {
        return None;
    }

    let session_target = row
        .pointer("/spec/action/session_target")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let origin_chat_session_id = row
        .pointer("/spec/binding/origin_chat_session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let origin_message_id = row
        .pointer("/spec/binding/origin_message_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let reason = if session_target.is_none() {
        "missing_session_target"
    } else if origin_chat_session_id.is_none() {
        "missing_origin_chat_session_id"
    } else if origin_message_id.is_none() {
        "missing_origin_message_id"
    } else {
        return None;
    };

    Some(LegacyChatTaskCandidate {
        task_id,
        enabled: row
            .pointer("/spec/enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        reason,
    })
}

fn spawn_task_delivery_dispatcher(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            if let Err(err) = routes::run_task_delivery_dispatch_cycle(state.clone()).await {
                warn!(error = %err.message, "task delivery dispatcher cycle failed");
            }
            sleep(Duration::from_secs(5)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::extract_legacy_chat_task_candidate;

    #[test]
    fn identifies_legacy_chat_task_without_session_target() {
        let payload = json!({
            "spec": {
                "id": "task-1",
                "source_type": "chat",
                "enabled": true,
                "action": {
                    "session_target": null
                },
                "binding": {
                    "origin_chat_session_id": "session-1",
                    "origin_message_id": "message-1"
                }
            }
        });

        let candidate = extract_legacy_chat_task_candidate(&payload).expect("candidate");
        assert_eq!(candidate.task_id, "task-1");
        assert_eq!(candidate.reason, "missing_session_target");
        assert!(candidate.enabled);
    }

    #[test]
    fn ignores_new_chat_task_with_complete_binding() {
        let payload = json!({
            "spec": {
                "id": "task-2",
                "source_type": "chat",
                "enabled": true,
                "action": {
                    "session_target": "chat-task::nuwa::session::message"
                },
                "binding": {
                    "origin_chat_session_id": "session-1",
                    "origin_message_id": "message-1"
                }
            }
        });

        assert!(extract_legacy_chat_task_candidate(&payload).is_none());
    }
}

impl AppState {
    pub async fn power_on(&self) -> Result<PowerOnResult, String> {
        match self.openfang.get_json("/api/health").await {
            Ok(upstream) => {
                self.set_power_state(true, None).await;
                Ok(PowerOnResult {
                    health: upstream,
                    launched: false,
                    launch: None,
                })
            }
            Err(first_error) => {
                let launch_desc = match self.ensure_openfang_process().await {
                    Ok(desc) => desc,
                    Err(spawn_error) => {
                        let message = format!(
                            "启动失败：{}；拉起 OpenFang 失败：{}",
                            first_error.message, spawn_error
                        );
                        self.set_power_state(false, Some(message.clone())).await;
                        return Err(message);
                    }
                };

                match self.wait_openfang_ready().await {
                    Ok(upstream) => {
                        self.set_power_state(true, None).await;
                        Ok(PowerOnResult {
                            health: upstream,
                            launched: true,
                            launch: Some(launch_desc),
                        })
                    }
                    Err(wait_error) => {
                        let _ = self.shutdown_managed_openfang().await;
                        let message =
                            format!("启动失败：{}；启动命令：{}", wait_error, launch_desc);
                        self.set_power_state(false, Some(message.clone())).await;
                        Err(message)
                    }
                }
            }
        }
    }

    pub async fn set_power_state(&self, online: bool, error: Option<String>) {
        let mut power = self.power_state.write().await;
        power.online = online;
        power.last_error = error;
    }

    async fn wait_openfang_ready(&self) -> Result<Value, String> {
        let timeout = Duration::from_millis(self.config.openfang_startup_wait_ms.max(1_000));
        let started_at = std::time::Instant::now();

        loop {
            match self.openfang.get_json("/api/health").await {
                Ok(upstream) => return Ok(upstream),
                Err(err) => {
                    if let Some(exit_desc) = self.take_managed_openfang_exit().await? {
                        return Err(format!(
                            "OpenFang 进程异常退出：{}。请检查 OPENFANG_HOME（默认 ~/.webot）下 config.toml 的 default_model.api_key_env 对应环境变量是否已设置（例如 NVIDIA_API_KEY）",
                            exit_desc
                        ));
                    }
                    if started_at.elapsed() >= timeout {
                        return Err(err.message);
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }

    pub async fn ensure_openfang_process(&self) -> Result<String, String> {
        let mut guard = self.managed_openfang.lock().await;

        if let Some(process) = guard.as_mut() {
            match process.child.try_wait() {
                Ok(Some(status)) => {
                    warn!("managed openfang exited early: {status}");
                    *guard = None;
                }
                Ok(None) => {
                    return Ok(format!("已存在受管 OpenFang 进程: {}", process.launch_desc));
                }
                Err(err) => {
                    warn!("check managed openfang status failed: {err}");
                    *guard = None;
                }
            }
        }

        let candidates = self.launch_candidates();
        if candidates.is_empty() {
            return Err("没有可用的 OpenFang 启动命令，请设置 OPENFANG_START_COMMAND".to_string());
        }

        let mut spawn_errors: Vec<String> = Vec::new();
        let service_host = if self.config.listen_addr.ip().is_unspecified() {
            if self.config.listen_addr.is_ipv4() {
                "127.0.0.1".to_string()
            } else {
                "[::1]".to_string()
            }
        } else if self.config.listen_addr.is_ipv6() {
            format!("[{}]", self.config.listen_addr.ip())
        } else {
            self.config.listen_addr.ip().to_string()
        };
        let service_base_url =
            format!("http://{}:{}", service_host, self.config.listen_addr.port());

        for candidate in candidates {
            let desc = format_launch_desc(
                &candidate.command,
                &candidate.args,
                candidate.workdir.as_ref(),
            );

            let mut command = Command::new(&candidate.command);
            command.args(&candidate.args);
            if let Some(workdir) = &candidate.workdir {
                command.current_dir(workdir);
            }
            if let Ok(runtime_home) = crate::path_resolver::openfang_runtime_home_dir() {
                command.env("OPENFANG_HOME", &runtime_home);
                command.env("WEBOT_HOME", &runtime_home);
            }
            command.env("WEBOT_SERVICE_BASE_URL", &service_base_url);
            command.stdin(Stdio::null());
            command.stdout(Stdio::null());
            command.stderr(Stdio::null());
            #[cfg(target_os = "windows")]
            {
                command.creation_flags(CREATE_NO_WINDOW);
            }
            match command.spawn() {
                Ok(child) => {
                    let pid_text = child
                        .id()
                        .map(|id| id.to_string())
                        .unwrap_or_else(|| "unknown".to_string());
                    let launch_desc = format!("{desc} (pid={pid_text})");
                    *guard = Some(ManagedOpenfangProcess {
                        child,
                        launch_desc: launch_desc.clone(),
                    });
                    info!("spawned managed openfang: {launch_desc}");
                    return Ok(launch_desc);
                }
                Err(err) => {
                    spawn_errors.push(format!("{desc} => {err}"));
                }
            }
        }

        Err(format!(
            "尝试启动 OpenFang 失败: {}",
            spawn_errors.join(" | ")
        ))
    }

    pub async fn shutdown_managed_openfang(&self) -> Result<(), String> {
        let mut guard = self.managed_openfang.lock().await;
        let Some(mut managed) = guard.take() else {
            return Ok(());
        };

        match managed.child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {}
            Err(err) => return Err(format!("检查 OpenFang 进程状态失败: {err}")),
        }

        managed
            .child
            .start_kill()
            .map_err(|err| format!("发送 OpenFang 停止信号失败: {err}"))?;

        match tokio::time::timeout(Duration::from_secs(8), managed.child.wait()).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(err)) => Err(format!("等待 OpenFang 退出失败: {err}")),
            Err(_) => Err("等待 OpenFang 退出超时".to_string()),
        }
    }

    pub async fn take_managed_openfang_exit(&self) -> Result<Option<String>, String> {
        let mut guard = self.managed_openfang.lock().await;
        let Some(process) = guard.as_mut() else {
            return Ok(None);
        };

        match process.child.try_wait() {
            Ok(Some(status)) => {
                let desc = format!("{} 已退出，status={status}", process.launch_desc);
                *guard = None;
                Ok(Some(desc))
            }
            Ok(None) => Ok(None),
            Err(err) => Err(format!("检查 OpenFang 进程状态失败: {err}")),
        }
    }

    fn launch_candidates(&self) -> Vec<OpenfangLaunchCandidate> {
        if let Some(command) = self.config.openfang_start_command.clone() {
            return vec![OpenfangLaunchCandidate {
                command,
                args: self.config.openfang_start_args.clone(),
                workdir: self.config.openfang_workdir.clone(),
            }];
        }

        let mut candidates = vec![OpenfangLaunchCandidate {
            command: "openfang".to_string(),
            args: vec!["start".to_string()],
            workdir: None,
        }];

        if let Some(workdir) = self.config.openfang_workdir.clone() {
            if let Some(binary) = discover_openfang_binary(&workdir) {
                candidates.push(OpenfangLaunchCandidate {
                    command: binary.to_string_lossy().to_string(),
                    args: vec!["start".to_string()],
                    workdir: Some(workdir.clone()),
                });
            }

            candidates.push(OpenfangLaunchCandidate {
                command: "cargo".to_string(),
                args: vec![
                    "run".to_string(),
                    "-p".to_string(),
                    "openfang-cli".to_string(),
                    "--".to_string(),
                    "start".to_string(),
                ],
                workdir: Some(workdir),
            });
        }

        candidates
    }
}

fn format_launch_desc(command: &str, args: &[String], workdir: Option<&PathBuf>) -> String {
    let cmdline = if args.is_empty() {
        command.to_string()
    } else {
        format!("{command} {}", args.join(" "))
    };

    if let Some(dir) = workdir {
        format!("{cmdline} @ {}", dir.display())
    } else {
        cmdline
    }
}

fn discover_openfang_binary(workdir: &PathBuf) -> Option<PathBuf> {
    let binary_name = if cfg!(windows) {
        "openfang.exe"
    } else {
        "openfang"
    };

    let candidates = [
        workdir.join(binary_name),
        workdir.join("win").join(binary_name),
        workdir.join("macos").join(binary_name),
        workdir.join("linux").join(binary_name),
        workdir.join("target").join("debug").join(binary_name),
        workdir.join("target").join("release").join(binary_name),
    ];

    candidates.into_iter().find(|path| path.is_file())
}

fn build_app(state: Arc<AppState>) -> Router {
    // 导入智能体 zip 可能较大，这里统一放宽管理接口请求体上限。
    const MANAGEMENT_MAX_BODY_BYTES: usize = 128 * 1024 * 1024;
    Router::new()
        .route(
            "/api/ping",
            get(|| async { Json(json!({ "ok": true, "service": "webot-service-rs" })) }),
        )
        .route("/api/health", get(routes::health))
        .route(
            "/api/service/power/status",
            get(routes::service_power_status),
        )
        .route(
            "/api/service/power/start",
            post(routes::service_power_start),
        )
        .route("/api/service/power/stop", post(routes::service_power_stop))
        .nest(
            "/api/management",
            routes::management_router().layer(DefaultBodyLimit::max(MANAGEMENT_MAX_BODY_BYTES)),
        )
        .nest("/api/chat", routes::chat_router())
        .nest("/api/groups", routes::groups_router())
        .route("/api/compose/dashboard", get(routes::compose_dashboard))
        .route(
            "/api/compose/tasks/overview",
            get(routes::compose_tasks_overview),
        )
        .route(
            "/api/compose/tasks/{id}/full",
            get(routes::compose_task_full),
        )
        .route(
            "/internal/task-deliveries/send",
            post(routes::send_internal_task_delivery),
        )
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
