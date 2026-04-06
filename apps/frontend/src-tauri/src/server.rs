use std::env;
use std::fs;
use std::io;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use serde_json::Value;
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
const LEGACY_CHAT_TASK_PROMPT_MARKER: &str = "你是任务执行助手。请直接执行以下任务并给出简洁结果：";

fn files_equal(source: &PathBuf, target: &PathBuf) -> io::Result<bool> {
    if !target.is_file() {
        return Ok(false);
    }

    let source_meta = fs::metadata(source)?;
    let target_meta = fs::metadata(target)?;
    if source_meta.len() != target_meta.len() {
        return Ok(false);
    }

    Ok(fs::read(source)? == fs::read(target)?)
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

    let resource_roots = bundled_resource_roots();

    for root in resource_roots {
        let candidate = root.join("openfang").join(binary_name);
        if candidate.is_file() {
            return Some((candidate, root.join("openfang")));
        }
        for alias in &aliases {
            let candidate = root.join("openfang").join(alias).join(binary_name);
            if candidate.is_file() {
                return Some((candidate, root.join("openfang").join(alias)));
            }
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

fn resolve_bundled_comfyui_dir() -> Option<PathBuf> {
    for root in bundled_resource_roots() {
        let candidate = root.join("comfyui");
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_candidate = manifest_dir.join("../../../comfyui");
    if dev_candidate.is_dir() {
        return Some(dev_candidate);
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

fn sync_dir_recursive(source: &PathBuf, target: &PathBuf) -> Result<bool, String> {
    if !source.is_dir() {
        return Err(format!("默认目录不存在: {}", source.display()));
    }

    fs::create_dir_all(target)
        .map_err(|err| format!("创建目标目录失败({}): {err}", target.display()))?;

    let mut changed = false;
    let mut source_entries = std::collections::HashSet::new();

    let entries = fs::read_dir(source)
        .map_err(|err| format!("读取默认目录失败({}): {err}", source.display()))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("读取默认目录项失败: {err}"))?;
        let source_path = entry.path();
        let file_name = entry.file_name();
        let target_path = target.join(&file_name);
        let file_type = entry
            .file_type()
            .map_err(|err| format!("读取默认目录文件类型失败({}): {err}", source_path.display()))?;
        source_entries.insert(file_name);

        if file_type.is_dir() {
            if target_path.is_file() {
                fs::remove_file(&target_path)
                    .map_err(|err| format!("删除冲突文件失败({}): {err}", target_path.display()))?;
                changed = true;
            }
            if sync_dir_recursive(&source_path, &target_path)? {
                changed = true;
            }
            continue;
        }

        if target_path.is_dir() {
            fs::remove_dir_all(&target_path)
                .map_err(|err| format!("删除冲突目录失败({}): {err}", target_path.display()))?;
            changed = true;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("创建目标父目录失败({}): {err}", parent.display()))?;
        }

        if !files_equal(&source_path, &target_path)
            .map_err(|err| format!("比较文件失败({}): {err}", source_path.display()))?
        {
            fs::copy(&source_path, &target_path).map_err(|err| {
                format!(
                    "复制默认资源失败({} -> {}): {err}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
            changed = true;
        }
    }

    let target_entries = fs::read_dir(target)
        .map_err(|err| format!("读取目标目录失败({}): {err}", target.display()))?;
    for entry in target_entries {
        let entry = entry.map_err(|err| format!("读取目标目录项失败: {err}"))?;
        if source_entries.contains(&entry.file_name()) {
            continue;
        }
        let target_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|err| format!("读取目标目录文件类型失败({}): {err}", target_path.display()))?;
        if file_type.is_dir() {
            fs::remove_dir_all(&target_path)
                .map_err(|err| format!("删除多余目录失败({}): {err}", target_path.display()))?;
        } else {
            fs::remove_file(&target_path)
                .map_err(|err| format!("删除多余文件失败({}): {err}", target_path.display()))?;
        }
        changed = true;
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

fn ensure_default_comfyui_assets(webot_home: &PathBuf) -> Result<(), String> {
    let Some(source_dir) = resolve_bundled_comfyui_dir() else {
        return Ok(());
    };

    let target_dir = webot_home.join("comfyui");
    let _ = sync_dir_recursive(&source_dir, &target_dir)?;
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
    ensure_default_comfyui_assets(&webot_home)?;
    if let Err(err) = disable_legacy_chat_cron_jobs(&webot_home) {
        eprintln!("[webot-desktop] 停用旧版聊天 cron 失败: {err}");
    }

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
    wait_for_embedded_service_ready(handle.listen_addr)?;

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

fn disable_legacy_chat_cron_jobs(webot_home: &PathBuf) -> Result<(), String> {
    let cron_jobs_path = webot_home.join("cron_jobs.json");
    if !cron_jobs_path.is_file() {
        return Ok(());
    }

    let raw = fs::read_to_string(&cron_jobs_path).map_err(|err| {
        format!(
            "读取 cron_jobs.json 失败({}): {err}",
            cron_jobs_path.display()
        )
    })?;
    let mut entries = serde_json::from_str::<Vec<Value>>(&raw).map_err(|err| {
        format!(
            "解析 cron_jobs.json 失败({}): {err}",
            cron_jobs_path.display()
        )
    })?;

    let mut changed = false;
    let mut disabled_job_ids: Vec<String> = Vec::new();

    for entry in &mut entries {
        let Some(job) = entry.get_mut("job").and_then(Value::as_object_mut) else {
            continue;
        };
        if !is_legacy_chat_cron_job(job) {
            continue;
        }
        let enabled = job.get("enabled").and_then(Value::as_bool).unwrap_or(false);
        if !enabled {
            continue;
        }
        job.insert("enabled".to_string(), Value::Bool(false));
        let job_id = job
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown");
        disabled_job_ids.push(job_id.to_string());
        changed = true;
    }

    if !changed {
        return Ok(());
    }

    let backup_path = webot_home.join(format!(
        "cron_jobs.legacy-chat-backup-{}.json",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default()
    ));
    fs::copy(&cron_jobs_path, &backup_path).map_err(|err| {
        format!(
            "备份旧 cron_jobs.json 失败({} -> {}): {err}",
            cron_jobs_path.display(),
            backup_path.display()
        )
    })?;

    let serialized = serde_json::to_string_pretty(&entries).map_err(|err| {
        format!(
            "序列化更新后的 cron_jobs.json 失败({}): {err}",
            cron_jobs_path.display()
        )
    })?;
    fs::write(&cron_jobs_path, serialized).map_err(|err| {
        format!(
            "写回 cron_jobs.json 失败({}): {err}",
            cron_jobs_path.display()
        )
    })?;

    eprintln!(
        "[webot-desktop] 已停用 {} 个旧版聊天 cron 任务: {}",
        disabled_job_ids.len(),
        disabled_job_ids.join(", ")
    );
    Ok(())
}

fn is_legacy_chat_cron_job(job: &serde_json::Map<String, Value>) -> bool {
    let name = job
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let action_kind = job
        .get("action")
        .and_then(Value::as_object)
        .and_then(|action| action.get("kind"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let prompt = job
        .get("action")
        .and_then(Value::as_object)
        .and_then(|action| action.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();

    if !action_kind.eq_ignore_ascii_case("agent_turn") {
        return false;
    }

    prompt.contains(LEGACY_CHAT_TASK_PROMPT_MARKER)
        || name.starts_with("chat-task-")
        || name.starts_with("chat_task_")
}

pub fn shutdown(state: &DesktopState) {
    if let Ok(mut guard) = state.handle.lock() {
        if let Some(handle) = guard.take() {
            handle.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::is_legacy_chat_cron_job;

    #[test]
    fn detects_legacy_chat_cron_by_prompt_marker() {
        let payload = json!({
            "name": "黄金监控",
            "action": {
                "kind": "agent_turn",
                "message": "你是任务执行助手。请直接执行以下任务并给出简洁结果：\n监控黄金价格"
            }
        });
        let job = payload.as_object().expect("job object");
        assert!(is_legacy_chat_cron_job(job));
    }

    #[test]
    fn ignores_manual_non_chat_cron_jobs() {
        let payload = json!({
            "name": "黄金日报",
            "action": {
                "kind": "agent_turn",
                "message": "请整理今天的黄金日报"
            }
        });
        let job = payload.as_object().expect("job object");
        assert!(!is_legacy_chat_cron_job(job));
    }
}

fn wait_for_embedded_service_ready(listen_addr: SocketAddr) -> Result<(), String> {
    let url = format!("http://{listen_addr}");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(12);
    let request = b"GET /api/ping HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    let mut last_error = String::new();

    while std::time::Instant::now() < deadline {
        match TcpStream::connect_timeout(&listen_addr, std::time::Duration::from_millis(400)) {
            Ok(mut stream) => {
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(800)));
                let _ = stream.set_write_timeout(Some(std::time::Duration::from_millis(800)));
                match stream.write_all(request) {
                    Ok(()) => {
                        let mut buffer = Vec::new();
                        match stream.read_to_end(&mut buffer) {
                            Ok(_) => {
                                let response = String::from_utf8_lossy(&buffer);
                                if response.starts_with("HTTP/1.1 200")
                                    || response.starts_with("HTTP/1.0 200")
                                {
                                    return Ok(());
                                }
                                if !response.trim().is_empty() {
                                    let first_line =
                                        response.lines().next().unwrap_or("未知 HTTP 响应");
                                    last_error = format!("服务返回异常响应: {first_line}");
                                } else {
                                    last_error = "服务未返回任何 HTTP 内容".to_string();
                                }
                            }
                            Err(err) => {
                                last_error = format!("读取服务响应失败: {err}");
                            }
                        }
                    }
                    Err(err) => {
                        last_error = format!("发送服务探针失败: {err}");
                    }
                }
            }
            Err(err) => {
                last_error = format!("连接服务失败: {err}");
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(250));
    }

    Err(format!(
        "等待 service-rs HTTP 就绪超时({url}): {}",
        if last_error.is_empty() {
            "未知错误"
        } else {
            &last_error
        }
    ))
}
