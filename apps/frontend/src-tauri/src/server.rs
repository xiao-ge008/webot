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

const DEFAULT_UI_SKILL_NAME: &str = "ui-skill";

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

    let resource_roots = bundled_resource_roots();

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

fn bundled_resource_roots() -> Vec<PathBuf> {
    let mut resource_roots = Vec::new();
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

    resource_roots
}

fn resolve_bundled_ui_skill_dir() -> Option<PathBuf> {
    for root in bundled_resource_roots() {
        let candidate = root.join("skills").join(DEFAULT_UI_SKILL_NAME);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

fn merge_missing_entries(source: &PathBuf, target: &PathBuf) -> Result<bool, String> {
    if !source.is_dir() {
        return Ok(false);
    }

    fs::create_dir_all(target)
        .map_err(|err| format!("创建默认技能目录失败({}): {err}", target.display()))?;

    let entries = fs::read_dir(source)
        .map_err(|err| format!("读取默认技能目录失败({}): {err}", source.display()))?;
    let mut changed = false;

    for entry in entries {
        let entry = entry.map_err(|err| format!("读取默认技能目录项失败: {err}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|err| format!("读取默认技能文件类型失败({}): {err}", source_path.display()))?;

        if file_type.is_dir() {
            if merge_missing_entries(&source_path, &target_path)? {
                changed = true;
            }
            continue;
        }

        if file_type.is_file() && !target_path.exists() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("创建技能目标目录失败({}): {err}", parent.display()))?;
            }
            fs::copy(&source_path, &target_path).map_err(|err| {
                format!(
                    "复制默认技能文件失败({} -> {}): {err}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
            changed = true;
        }
    }

    Ok(changed)
}

fn ensure_default_ui_skill(webot_home: &PathBuf) -> Result<(), String> {
    let Some(source_dir) = resolve_bundled_ui_skill_dir() else {
        return Ok(());
    };

    let target_dir = webot_home.join("skills").join(DEFAULT_UI_SKILL_NAME);
    let _ = merge_missing_entries(&source_dir, &target_dir)?;
    Ok(())
}

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
    ensure_default_ui_skill(&webot_home)?;

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
