use base64::engine::general_purpose;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use serde::Deserialize;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

use crate::server::DesktopState;

#[derive(Serialize)]
pub struct DesktopStatus {
    pub status: &'static str,
    pub port: u16,
    pub api_base_url: String,
    pub uptime_secs: u64,
}

#[derive(Serialize)]
pub struct AppMetadata {
    pub version: String,
    pub platform: String,
    pub arch: String,
}

#[derive(Serialize)]
pub struct UpdateInstallResult {
    pub installer_path: String,
    pub launched: bool,
}

const UPDATE_INSTALL_PROGRESS_EVENT: &str = "update-install-progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallProgressPayload {
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installer_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launched: Option<bool>,
}

fn compute_progress_percent(downloaded_bytes: u64, total_bytes: Option<u64>) -> Option<f64> {
    total_bytes.and_then(|total| {
        if total == 0 {
            None
        } else {
            Some(((downloaded_bytes as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
        }
    })
}

fn emit_update_install_progress(app: &AppHandle, payload: UpdateInstallProgressPayload) {
    let _ = app.emit(UPDATE_INSTALL_PROGRESS_EVENT, payload);
}

fn emit_update_install_failed(app: &AppHandle, file_name: &str, message: String) {
    emit_update_install_progress(
        app,
        UpdateInstallProgressPayload {
            phase: "failed".to_string(),
            downloaded_bytes: None,
            total_bytes: None,
            progress_percent: None,
            message: Some(message),
            file_name: Some(file_name.to_string()),
            installer_path: None,
            launched: None,
        },
    );
}

#[tauri::command]
pub fn get_port(state: State<'_, DesktopState>) -> u16 {
    state.port
}

#[tauri::command]
pub fn get_api_base_url(state: State<'_, DesktopState>) -> String {
    state.api_base_url.clone()
}

#[tauri::command]
pub fn get_openfang_base_url(state: State<'_, DesktopState>) -> String {
    state.openfang_base_url.clone()
}

#[tauri::command]
pub fn get_status(state: State<'_, DesktopState>) -> DesktopStatus {
    DesktopStatus {
        status: "running",
        port: state.port,
        api_base_url: state.api_base_url.clone(),
        uptime_secs: state.started_at.elapsed().as_secs(),
    }
}

#[tauri::command]
pub fn get_app_metadata(app: AppHandle) -> AppMetadata {
    AppMetadata {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[tauri::command]
pub fn pick_skill_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择技能文件夹")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[derive(Serialize)]
pub struct SkillComponentSource {
    pub source: String,
    pub file_path: String,
}

#[derive(serde::Serialize)]
pub struct SkillPromptContextPayload {
    pub content: String,
    pub file_path: String,
}

#[derive(serde::Serialize)]
pub struct SkillAvailableComponentsPayload {
    pub components: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct SkillComponentManifestPayload {
    pub name: String,
    pub r#type: String,
    pub description: String,
    pub props_schema: serde_json::Value,
    pub example: serde_json::Value,
    pub invoke_example: serde_json::Value,
    pub file_path: String,
}

#[derive(serde::Serialize)]
pub struct GlobalAgentRulesPayload {
    pub content: String,
    pub file_path: String,
}

#[derive(Debug, Deserialize)]
struct SkillManifestComponent {
    #[serde(default)]
    name: String,
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    description: String,
    #[serde(default, rename = "propsSchema")]
    props_schema: serde_json::Value,
    #[serde(default)]
    example: serde_json::Value,
    #[serde(default, rename = "invokeExample")]
    invoke_example: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct SkillManifestFile {
    #[serde(default)]
    components: Vec<SkillManifestComponent>,
}

fn normalize_component_name(raw: &str) -> String {
    raw.trim()
        .trim_matches('/')
        .strip_suffix("/main.js")
        .or_else(|| raw.trim().trim_matches('/').strip_suffix("/index.js"))
        .unwrap_or(raw.trim().trim_matches('/'))
        .trim()
        .to_string()
}

fn is_component_file(path: &Path, component_name: &str) -> bool {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    let Some(ext) = ext else {
        return false;
    };
    if !matches!(ext.as_str(), "tsx" | "jsx" | "ts" | "js") {
        return false;
    }

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if stem.eq_ignore_ascii_case(component_name) {
        return true;
    }

    if !stem.eq_ignore_ascii_case("index") {
        return false;
    }

    path.parent()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(component_name))
        .unwrap_or(false)
}

fn find_component_in_dir(dir: &Path, component_name: &str) -> Result<Option<PathBuf>, String> {
    let entries =
        fs::read_dir(dir).map_err(|err| format!("读取目录失败: {} ({err})", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("读取目录项失败: {} ({err})", dir.display()))?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_component_in_dir(&path, component_name)? {
                return Ok(Some(found));
            }
            continue;
        }
        if path.is_file() && is_component_file(&path, component_name) {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

fn resolve_component_path(
    component_name: &str,
    agent_id: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let mut roots = Vec::new();
    roots.push(webot_service_rs::assignment_store::skills_root()?);
    if let Some(agent) = agent_id {
        let normalized = agent.trim();
        if !normalized.is_empty() {
            roots.push(
                webot_service_rs::path_resolver::workspaces_root()?
                    .join(normalized)
                    .join("skills"),
            );
        }
    }

    for root in roots {
        if !root.exists() || !root.is_dir() {
            continue;
        }
        if let Some(found) = find_component_in_dir(&root, component_name)? {
            return Ok(Some(found));
        }
    }
    Ok(None)
}

fn manifest_allows_component(skill_dir: &Path, component_name: &str) -> Result<bool, String> {
    let manifest_path = skill_dir.join("components.manifest.json");
    if !manifest_path.is_file() {
        return Ok(false);
    }

    let raw = fs::read_to_string(&manifest_path).map_err(|err| {
        format!(
            "Failed to read component manifest: {} ({err})",
            manifest_path.display()
        )
    })?;
    let manifest: SkillManifestFile = serde_json::from_str(&raw).map_err(|err| {
        format!(
            "Failed to read component manifest: {} ({err})",
            manifest_path.display()
        )
    })?;

    Ok(manifest.components.iter().any(|item| {
        item.r#type.eq_ignore_ascii_case(component_name)
            || item.name.eq_ignore_ascii_case(component_name)
    }))
}

#[tauri::command]
pub fn load_skill_component_source(
    component_name: String,
    agent_id: Option<String>,
) -> Result<SkillComponentSource, String> {
    let component = normalize_component_name(&component_name);
    if component.is_empty() {
        return Err("组件名称为空".to_string());
    }

    let file_path = resolve_component_path(&component, agent_id.as_deref())?
        .ok_or_else(|| format!("Component not found: {component}"))?;
    let skill_dir = file_path
        .parent()
        .ok_or_else(|| format!("Invalid component directory: {}", file_path.display()))?;
    if !manifest_allows_component(skill_dir, &component)? {
        return Err(format!("Component not declared in manifest: {component}"));
    }
    let source = fs::read_to_string(&file_path)
        .map_err(|err| format!("读取组件源码失败: {} ({err})", file_path.display()))?;

    Ok(SkillComponentSource {
        source,
        file_path: file_path.to_string_lossy().to_string(),
    })
}

fn read_manifest_components(skill_dir: &Path) -> Result<Vec<String>, String> {
    let manifest_path = skill_dir.join("components.manifest.json");
    if !manifest_path.is_file() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&manifest_path).map_err(|err| {
        format!(
            "Failed to read component manifest: {} ({err})",
            manifest_path.display()
        )
    })?;
    let manifest: SkillManifestFile = serde_json::from_str(&raw).map_err(|err| {
        format!(
            "Failed to read component manifest: {} ({err})",
            manifest_path.display()
        )
    })?;

    Ok(manifest
        .components
        .into_iter()
        .filter_map(|item| {
            let ty = item.r#type.trim();
            if ty.is_empty() {
                None
            } else {
                Some(ty.to_string())
            }
        })
        .collect())
}

#[tauri::command]
pub fn load_skill_prompt_context(
    component_name: String,
    agent_id: Option<String>,
) -> Result<SkillPromptContextPayload, String> {
    let component = normalize_component_name(&component_name);
    if component.is_empty() {
        return Err("组件名称为空".to_string());
    }

    let file_path = resolve_component_path(&component, agent_id.as_deref())?
        .ok_or_else(|| format!("Component not found: {component}"))?;
    let skill_dir = file_path
        .parent()
        .ok_or_else(|| format!("Invalid component directory: {}", file_path.display()))?;
    webot_service_rs::component_center::refresh_component_skill_artifacts_for_dir(skill_dir)?;

    let candidates = [
        skill_dir.join("prompt_context.md"),
        skill_dir.join("SKILL.md"),
    ];
    for candidate in candidates {
        if candidate.is_file() {
            let content = fs::read_to_string(&candidate).map_err(|err| {
                format!("读取 skill 提示上下文失败: {} ({err})", candidate.display())
            })?;
            return Ok(SkillPromptContextPayload {
                content,
                file_path: candidate.to_string_lossy().to_string(),
            });
        }
    }

    Err(format!(
        "Skill prompt context not found for component: {component}"
    ))
}

#[tauri::command]
pub fn list_available_skill_components(
    skill_names: Vec<String>,
    agent_id: Option<String>,
) -> Result<SkillAvailableComponentsPayload, String> {
    let mut roots = Vec::new();
    roots.push(webot_service_rs::assignment_store::skills_root()?);
    if let Some(agent) = agent_id.as_deref() {
        let normalized = agent.trim();
        if !normalized.is_empty() {
            roots.push(
                webot_service_rs::path_resolver::workspaces_root()?
                    .join(normalized)
                    .join("skills"),
            );
        }
    }

    let mut components = Vec::new();
    for skill_name in skill_names {
        let normalized = skill_name.trim();
        if normalized.is_empty() {
            continue;
        }
        for root in &roots {
            let skill_dir = root.join(normalized);
            if skill_dir.is_dir() {
                webot_service_rs::component_center::refresh_component_skill_artifacts_for_dir(
                    &skill_dir,
                )?;
                components.extend(read_manifest_components(&skill_dir)?);
                break;
            }
        }
    }

    components.sort();
    components.dedup();
    Ok(SkillAvailableComponentsPayload { components })
}

#[tauri::command]
pub fn load_skill_component_manifest(
    component_name: String,
    agent_id: Option<String>,
) -> Result<SkillComponentManifestPayload, String> {
    let component = normalize_component_name(&component_name);
    if component.is_empty() {
        return Err("组件名称为空".to_string());
    }

    let file_path = resolve_component_path(&component, agent_id.as_deref())?
        .ok_or_else(|| format!("Component not found: {component}"))?;
    let skill_dir = file_path
        .parent()
        .ok_or_else(|| format!("Invalid component directory: {}", file_path.display()))?;
    webot_service_rs::component_center::refresh_component_skill_artifacts_for_dir(skill_dir)?;
    let manifest_path = skill_dir.join("components.manifest.json");
    let raw = fs::read_to_string(&manifest_path).map_err(|err| {
        format!(
            "Failed to read component manifest: {} ({err})",
            manifest_path.display()
        )
    })?;
    let manifest: SkillManifestFile = serde_json::from_str(&raw).map_err(|err| {
        format!(
            "Failed to read component manifest: {} ({err})",
            manifest_path.display()
        )
    })?;

    let item = manifest
        .components
        .into_iter()
        .find(|entry| {
            entry.r#type.eq_ignore_ascii_case(&component)
                || entry.name.eq_ignore_ascii_case(&component)
        })
        .ok_or_else(|| format!("Component not declared in manifest: {component}"))?;

    Ok(SkillComponentManifestPayload {
        name: item.name,
        r#type: item.r#type,
        description: item.description,
        props_schema: item.props_schema,
        example: item.example,
        invoke_example: item.invoke_example,
        file_path: manifest_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn load_global_agent_rules() -> Result<GlobalAgentRulesPayload, String> {
    let webot_root = webot_service_rs::path_resolver::webot_home_dir()?;
    let candidates = [
        webot_root.join("AGENTS.md"),
        webot_root.join("prompts").join("global-system-prompt.md"),
        webot_root.join("global-system-prompt.md"),
    ];

    for candidate in candidates {
        if candidate.is_file() {
            let content = fs::read_to_string(&candidate)
                .map_err(|err| format!("读取全局提示失败: {} ({err})", candidate.display()))?;
            return Ok(GlobalAgentRulesPayload {
                content,
                file_path: candidate.to_string_lossy().to_string(),
            });
        }
    }

    Ok(GlobalAgentRulesPayload {
        content: String::new(),
        file_path: String::new(),
    })
}

#[tauri::command]
pub fn pick_avatar_file() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择头像图片")
        .add_filter("图片文件", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_markdown_file(path: String) -> Result<String, String> {
    let target = path.trim();
    if target.is_empty() {
        return Err("文件路径为空".to_string());
    }

    let file_path = PathBuf::from(target);
    if !file_path.exists() {
        return Err("文件不存在".to_string());
    }

    let metadata = fs::metadata(&file_path).map_err(|err| format!("读取文件信息失败: {err}"))?;
    const MAX_MARKDOWN_FILE_BYTES: u64 = 8 * 1024 * 1024;
    if metadata.len() > MAX_MARKDOWN_FILE_BYTES {
        return Err(format!(
            "文件过大，超过 {} MB",
            MAX_MARKDOWN_FILE_BYTES / 1024 / 1024
        ));
    }

    fs::read_to_string(&file_path).map_err(|err| format!("读取 Markdown 文件失败: {err}"))
}

#[tauri::command]
pub fn save_markdown_as(content: String, suggested_name: Option<String>) -> Result<String, String> {
    if content.trim().is_empty() {
        return Err("无可保存内容".to_string());
    }

    let default_name = suggested_name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "preview.md".to_string());

    let target = rfd::FileDialog::new()
        .set_title("另存为 Markdown")
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md", "markdown"])
        .save_file()
        .ok_or_else(|| "已取消保存".to_string())?;

    fs::write(&target, content).map_err(|err| format!("保存 Markdown 失败: {err}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_binary_file_base64(path: String) -> Result<String, String> {
    let target = path.trim();
    if target.is_empty() {
        return Err("文件路径为空".to_string());
    }

    let file_path = PathBuf::from(target);
    if !file_path.exists() {
        return Err("文件不存在".to_string());
    }

    let metadata = fs::metadata(&file_path).map_err(|err| format!("读取文件信息失败: {err}"))?;
    const MAX_BINARY_FILE_BYTES: u64 = 120 * 1024 * 1024;
    if metadata.len() > MAX_BINARY_FILE_BYTES {
        return Err(format!(
            "文件过大，超过 {} MB",
            MAX_BINARY_FILE_BYTES / 1024 / 1024
        ));
    }

    let bytes = fs::read(&file_path).map_err(|err| format!("读取文件失败: {err}"))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn save_binary_file_as(
    base64_content: String,
    suggested_name: Option<String>,
) -> Result<String, String> {
    let payload = base64_content
        .split(',')
        .next_back()
        .unwrap_or("")
        .trim()
        .to_string();
    if payload.is_empty() {
        return Err("无可保存内容".to_string());
    }

    let bytes = general_purpose::STANDARD
        .decode(payload.as_bytes())
        .map_err(|err| format!("二进制解码失败: {err}"))?;
    if bytes.is_empty() {
        return Err("无可保存内容".to_string());
    }

    let default_name = suggested_name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "office-file".to_string());

    let target = rfd::FileDialog::new()
        .set_title("另存为文件")
        .set_file_name(&default_name)
        .save_file()
        .ok_or_else(|| "已取消保存".to_string())?;

    fs::write(&target, bytes).map_err(|err| format!("保存文件失败: {err}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_file_with_system(path: String) -> Result<(), String> {
    let target = path.trim();
    if target.is_empty() {
        return Err("文件路径为空".to_string());
    }

    let file_path = PathBuf::from(target);
    if !file_path.exists() {
        return Err("文件不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", target])
            .spawn()
            .map_err(|err| format!("调用系统打开文件失败: {err}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|err| format!("调用系统打开文件失败: {err}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|err| format!("调用系统打开文件失败: {err}"))?;
    }

    Ok(())
}

fn mpv_candidate_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let arch = std::env::consts::ARCH;

    #[cfg(target_os = "windows")]
    let platform_aliases = vec![
        format!("win-{arch}"),
        "win".to_string(),
        "windows".to_string(),
    ];
    #[cfg(target_os = "macos")]
    let platform_aliases = vec![
        format!("macos-{arch}"),
        "macos".to_string(),
        "darwin".to_string(),
        "mac".to_string(),
    ];
    #[cfg(target_os = "linux")]
    let platform_aliases = vec![format!("linux-{arch}"), "linux".to_string()];

    #[cfg(target_os = "windows")]
    let binary_name = "mpv.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "mpv";

    if let Ok(resource_dir) = app.path().resource_dir() {
        let resource_dir: PathBuf = resource_dir;
        for alias in &platform_aliases {
            candidates.push(resource_dir.join("mpv").join(alias).join(binary_name));
        }
        candidates.push(resource_dir.join("mpv").join(binary_name));
        candidates.push(resource_dir.join(binary_name));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for alias in &platform_aliases {
                candidates.push(exe_dir.join("mpv").join(alias).join(binary_name));
            }
            candidates.push(exe_dir.join("mpv").join(binary_name));
            candidates.push(exe_dir.join(binary_name));
        }
    }

    candidates
}

fn spawn_mpv(command_path: &str, target: &str) -> Result<(), String> {
    Command::new(command_path)
        .args(["--force-window=yes", "--keep-open=yes", "--hwdec=auto"])
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("启动 MPV 失败: {err}"))
}

#[tauri::command]
pub fn launch_mpv(app: AppHandle, url: String) -> Result<(), String> {
    let target = url.trim();
    if target.is_empty() {
        return Err("视频地址为空".to_string());
    }

    for candidate in mpv_candidate_paths(&app) {
        if !candidate.exists() {
            continue;
        }
        if let Some(path) = candidate.to_str() {
            match spawn_mpv(path, target) {
                Ok(()) => return Ok(()),
                Err(_) => continue,
            }
        }
    }

    #[cfg(target_os = "windows")]
    let fallback = "mpv.exe";
    #[cfg(not(target_os = "windows"))]
    let fallback = "mpv";

    spawn_mpv(fallback, target)
}

fn sanitize_download_name(raw_name: &str) -> String {
    let trimmed = raw_name.trim();
    if trimmed.is_empty() {
        return "webot-update-installer".to_string();
    }

    let mut output = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        let invalid =
            matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control();
        output.push(if invalid { '_' } else { ch });
    }

    let normalized = output.trim_matches('.').trim();
    if normalized.is_empty() {
        "webot-update-installer".to_string()
    } else {
        normalized.to_string()
    }
}

fn launch_installer(path: &Path) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_default();

        if extension == "msi" {
            Command::new("msiexec")
                .arg("/i")
                .arg(path)
                .spawn()
                .map_err(|err| format!("启动 MSI 安装程序失败: {err}"))?;
            return Ok(true);
        }

        Command::new(path)
            .spawn()
            .map_err(|err| format!("启动安装程序失败: {err}"))?;
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|err| format!("打开更新包失败: {err}"))?;
        return Ok(false);
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|err| format!("打开更新包失败: {err}"))?;
        return Ok(false);
    }

    #[allow(unreachable_code)]
    Err("当前平台暂不支持自动安装更新".to_string())
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    download_url: String,
    file_name: String,
) -> Result<UpdateInstallResult, String> {
    let url = download_url.trim();
    if url.is_empty() {
        return Err("更新下载地址为空".to_string());
    }

    let sanitized_name = sanitize_download_name(&file_name);
    emit_update_install_progress(
        &app,
        UpdateInstallProgressPayload {
            phase: "preparing".to_string(),
            downloaded_bytes: Some(0),
            total_bytes: None,
            progress_percent: Some(0.0),
            message: Some("正在准备下载安装包...".to_string()),
            file_name: Some(sanitized_name.clone()),
            installer_path: None,
            launched: None,
        },
    );

    let temp_root = app
        .path()
        .temp_dir()
        .map_err(|err| {
            let message = format!("读取临时目录失败: {err}");
            emit_update_install_failed(&app, &sanitized_name, message.clone());
            message
        })?
        .join("webot-updates");
    fs::create_dir_all(&temp_root).map_err(|err| {
        let message = format!("创建更新目录失败: {err}");
        emit_update_install_failed(&app, &sanitized_name, message.clone());
        message
    })?;

    let installer_path = temp_root.join(sanitized_name);

    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("WeBot-Updater"));
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|err| {
            let message = format!("创建下载客户端失败: {err}");
            emit_update_install_failed(&app, &file_name, message.clone());
            message
        })?;

    let mut response = client.get(url).send().await.map_err(|err| {
        let message = format!("下载更新包失败: {err}");
        emit_update_install_failed(&app, &file_name, message.clone());
        message
    })?;
    if !response.status().is_success() {
        let message = format!("下载更新包失败: HTTP {}", response.status());
        emit_update_install_failed(&app, &file_name, message.clone());
        return Err(message);
    }

    let total_bytes = response.content_length();
    emit_update_install_progress(
        &app,
        UpdateInstallProgressPayload {
            phase: "downloading".to_string(),
            downloaded_bytes: Some(0),
            total_bytes,
            progress_percent: Some(0.0),
            message: Some("正在下载更新包...".to_string()),
            file_name: Some(file_name.clone()),
            installer_path: None,
            launched: None,
        },
    );

    let mut installer_file = fs::File::create(&installer_path).map_err(|err| {
        let message = format!("创建更新包文件失败: {err}");
        emit_update_install_failed(&app, &file_name, message.clone());
        message
    })?;

    let mut downloaded_bytes = 0_u64;
    let mut last_reported_bytes = 0_u64;
    let mut last_reported_percent = -1_i64;
    while let Some(chunk) = response.chunk().await.map_err(|err| {
        let message = format!("读取更新包失败: {err}");
        emit_update_install_failed(&app, &file_name, message.clone());
        message
    })? {
        if chunk.is_empty() {
            continue;
        }

        installer_file.write_all(&chunk).map_err(|err| {
            let message = format!("写入更新包失败: {err}");
            emit_update_install_failed(&app, &file_name, message.clone());
            message
        })?;

        downloaded_bytes += chunk.len() as u64;
        let progress_percent = compute_progress_percent(downloaded_bytes, total_bytes);
        let current_percent = progress_percent
            .map(|value| value.floor() as i64)
            .unwrap_or(-1);
        let percent_changed = current_percent != last_reported_percent;
        let byte_threshold_reached =
            downloaded_bytes.saturating_sub(last_reported_bytes) >= 512 * 1024;
        let is_finished = total_bytes
            .map(|total| downloaded_bytes >= total)
            .unwrap_or(false);

        if percent_changed || byte_threshold_reached || is_finished {
            last_reported_percent = current_percent;
            last_reported_bytes = downloaded_bytes;
            emit_update_install_progress(
                &app,
                UpdateInstallProgressPayload {
                    phase: "downloading".to_string(),
                    downloaded_bytes: Some(downloaded_bytes),
                    total_bytes,
                    progress_percent,
                    message: Some("正在下载更新包...".to_string()),
                    file_name: Some(file_name.clone()),
                    installer_path: None,
                    launched: None,
                },
            );
        }
    }

    installer_file.flush().map_err(|err| {
        let message = format!("刷新更新包失败: {err}");
        emit_update_install_failed(&app, &file_name, message.clone());
        message
    })?;
    if downloaded_bytes == 0 {
        let message = "更新包为空".to_string();
        emit_update_install_failed(&app, &file_name, message.clone());
        return Err(message);
    }

    emit_update_install_progress(
        &app,
        UpdateInstallProgressPayload {
            phase: "downloaded".to_string(),
            downloaded_bytes: Some(downloaded_bytes),
            total_bytes: Some(total_bytes.unwrap_or(downloaded_bytes)),
            progress_percent: Some(100.0),
            message: Some("更新包下载完成，正在启动安装程序...".to_string()),
            file_name: Some(file_name.clone()),
            installer_path: Some(installer_path.to_string_lossy().to_string()),
            launched: None,
        },
    );

    emit_update_install_progress(
        &app,
        UpdateInstallProgressPayload {
            phase: "launching_installer".to_string(),
            downloaded_bytes: Some(downloaded_bytes),
            total_bytes: Some(total_bytes.unwrap_or(downloaded_bytes)),
            progress_percent: Some(100.0),
            message: Some("正在启动安装程序...".to_string()),
            file_name: Some(file_name.clone()),
            installer_path: Some(installer_path.to_string_lossy().to_string()),
            launched: None,
        },
    );

    let launched = launch_installer(&installer_path).map_err(|err| {
        emit_update_install_failed(&app, &file_name, err.clone());
        err
    })?;
    emit_update_install_progress(
        &app,
        UpdateInstallProgressPayload {
            phase: "installer_started".to_string(),
            downloaded_bytes: Some(downloaded_bytes),
            total_bytes: Some(total_bytes.unwrap_or(downloaded_bytes)),
            progress_percent: Some(100.0),
            message: Some(if launched {
                "安装程序已启动，应用即将退出完成升级。".to_string()
            } else {
                "更新包已打开，请按系统提示继续完成安装。".to_string()
            }),
            file_name: Some(file_name.clone()),
            installer_path: Some(installer_path.to_string_lossy().to_string()),
            launched: Some(launched),
        },
    );
    if launched {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1200));
            app_handle.exit(0);
        });
    }

    Ok(UpdateInstallResult {
        installer_path: installer_path.to_string_lossy().to_string(),
        launched,
    })
}
