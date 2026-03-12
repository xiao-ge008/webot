use std::env;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use std::fs;

use webot_service_rs::assignment_store;
use webot_service_rs::config::ServiceConfig;
use webot_service_rs::EmbeddedServerHandle;

pub struct DesktopState {
    pub port: u16,
    pub api_base_url: String,
    pub openfang_base_url: String,
    pub started_at: Instant,
    handle: Mutex<Option<EmbeddedServerHandle>>,
}

fn openfang_binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "openfang.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "openfang"
    }
}

fn openfang_platform_aliases() -> Vec<String> {
    let arch = std::env::consts::ARCH;

    #[cfg(target_os = "windows")]
    {
        return vec![
            format!("win-{arch}"),
            "win".to_string(),
            "windows".to_string(),
        ];
    }
    #[cfg(target_os = "macos")]
    {
        return vec![
            format!("macos-{arch}"),
            "macos".to_string(),
            "darwin".to_string(),
            "mac".to_string(),
        ];
    }
    #[cfg(target_os = "linux")]
    {
        return vec![format!("linux-{arch}"), "linux".to_string()];
    }
}

fn resolve_bundled_openfang() -> Option<(PathBuf, PathBuf)> {
    let binary_name = openfang_binary_name();
    let aliases = openfang_platform_aliases();

    let mut resource_roots = Vec::new();
    // Dev: src-tauri/resources (when running `tauri dev`)
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    resource_roots.push(manifest_dir.join("resources"));

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            resource_roots.push(exe_dir.join("resources"));
            resource_roots.push(exe_dir.join("..").join("Resources"));
            resource_roots.push(exe_dir.join("..").join("resources"));
            resource_roots.push(exe_dir.to_path_buf());
        }
    }

    for root in resource_roots {
        for alias in &aliases {
            let candidate = root.join("openfang").join(alias).join(binary_name);
            if candidate.is_file() {
                return Some((candidate, root.join("openfang").join(alias)));
            }
        }
        let candidate = root.join("openfang").join(binary_name);
        if candidate.is_file() {
            return Some((candidate, root.join("openfang")));
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn apply_no_window(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_command: &mut std::process::Command) {}

fn ensure_openfang_config(webot_home: &PathBuf) -> Result<(), String> {
    let config_path = webot_home.join("config.toml");
    if config_path.is_file() {
        return Ok(());
    }

    if let Err(err) = fs::create_dir_all(webot_home) {
        return Err(format!("创建 WEBOT_HOME 目录失败: {err}"));
    }

    let config_text = [
        "api_listen = \"127.0.0.1:4200\"",
        "language = \"en\"",
        "",
        "[channels]",
        "",
        "[memory]",
        "decay_rate = 0.05",
        "",
    ]
    .join("\n");
    fs::write(&config_path, config_text)
        .map_err(|err| format!("写入初始 OpenFang 配置失败: {err}"))?;

    let log_path = webot_home.join("openfang-setup.log");
    let setup_note = "Initialized minimal OpenFang config for WeBot package. No default provider or default model is preconfigured.\n";
    fs::write(&log_path, setup_note).map_err(|err| format!("无法写入初始化日志: {err}"))?;

    Ok(())
}


pub fn bootstrap() -> Result<DesktopState, String> {
    let webot_home = resolve_webot_home_dir()?;

    env::set_var("WEBOT_HOME", &webot_home);
    env::set_var("OPENFANG_HOME", &webot_home);
    env::set_var("WEBOT_ENABLE_LEGACY_MIGRATION", "0");
    assignment_store::bootstrap_storage().map_err(|err| format!("初始化本地目录失败: {err}"))?;

    env::set_var("OPENFANG_BASE_URL", "http://127.0.0.1:4200");

    let mut config = ServiceConfig::from_env();
    config.listen_addr = "127.0.0.1:0"
        .parse()
        .map_err(|err| format!("解析监听地址失败: {err}"))?;
    config.openfang_base_url = "http://127.0.0.1:4200".to_string();
    if config.openfang_start_command.is_none() {
        let (command, workdir) = resolve_bundled_openfang().ok_or_else(|| {
            "未找到 openfang 可执行文件，请将 openfang.exe 放到 resources/openfang 目录".to_string()
        })?;

        ensure_openfang_config(&webot_home)?;

        env::set_var("OPENFANG_START_COMMAND", &command);
        env::set_var("OPENFANG_START_ARGS", "start");
        env::set_var("OPENFANG_WORKDIR", &workdir);

        config.openfang_start_command = Some(command.to_string_lossy().to_string());
        config.openfang_start_args = vec!["start".to_string()];
        config.openfang_workdir = Some(workdir);
    }

    ensure_openfang_config(&webot_home)?;

    webot_service_rs::reconcile_runtime_config_from_storage()
        .map_err(|err| format!("重建 OpenFang 运行时配置失败: {err}"))?;

    env::set_var("WEBOT_HOME", &webot_home);
    env::set_var("OPENFANG_HOME", &webot_home);
    env::set_var("WEBOT_ENABLE_LEGACY_MIGRATION", "0");

    let openfang_base_url = config.openfang_base_url.clone();
    let handle = webot_service_rs::start_embedded(config)
        .map_err(|err| format!("启动内嵌 webot-service-rs 失败: {err}"))?;

    let port = handle.listen_addr.port();
    let api_base_url = format!("http://127.0.0.1:{port}");

    Ok(DesktopState {
        port,
        api_base_url,
        openfang_base_url,
        started_at: Instant::now(),
        handle: Mutex::new(Some(handle)),
    })
}

fn resolve_webot_home_dir() -> Result<PathBuf, String> {
    if let Some(raw) = env::var_os("WEBOT_HOME") {
        let path = PathBuf::from(raw);
        if path.as_os_str().is_empty() {
            return Err("WEBOT_HOME 路径无效".to_string());
        }
        return Ok(path);
    }

    let user_home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "未找到用户目录环境变量(USERPROFILE/HOME)".to_string())?;
    Ok(user_home.join(".webot"))
}

pub fn shutdown(state: &DesktopState) {
    if let Ok(mut guard) = state.handle.lock() {
        if let Some(handle) = guard.take() {
            handle.shutdown();
        }
    }
}
