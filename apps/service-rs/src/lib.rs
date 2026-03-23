pub mod assignment_store;
pub mod component_center;
pub mod config;
pub mod error;
pub mod image_generation;
pub mod media_index;
pub mod openfang;
pub mod path_resolver;
pub mod routes;
pub mod tts_management;
pub mod vision_analysis;

use std::fs;
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Once};
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use config::ServiceConfig;
use openfang::OpenFangClient;
use serde_json::Value;
use tokio::process::{Child, Command};
use tokio::sync::{watch, Mutex, RwLock};
use toml::value::Table as TomlTable;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
            let mut default_table = TomlTable::new();
            default_table.insert(
                "provider".to_string(),
                toml::Value::String(assignment_store::normalize_provider_id(provider_id)),
            );
            default_table.insert(
                "model".to_string(),
                toml::Value::String(assignment_store::normalize_model_name(model_name)),
            );
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

pub async fn run_from_env() -> Result<(), Box<dyn std::error::Error>> {
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
    let app = build_app(state);
    let listener = tokio::net::TcpListener::bind(listen_addr).await?;

    write_service_url_file(listen_addr);
    info!("webot-service-rs listening on http://{listen_addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

pub fn start_embedded(
    mut config: ServiceConfig,
) -> Result<EmbeddedServerHandle, Box<dyn std::error::Error>> {
    let std_listener = TcpListener::bind(config.listen_addr)?;
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
            }
            Err(err) => {
                warn!("auto power-on failed: {err}");
            }
        }
    });
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
                // 避免在 Windows 上弹出黑色控制台窗口
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
        .nest("/api/tasks", routes::tasks_router())
        .route("/api/compose/dashboard", get(routes::compose_dashboard))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
