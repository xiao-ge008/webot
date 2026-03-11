use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const WEBOT_HOME_DIR_NAME: &str = ".webot";
const LEGACY_OPENFANG_DIR_NAME: &str = ".openfang";
const WORKSPACES_DIR_NAME: &str = "workspaces";
const MIGRATION_MARKER_FILE: &str = ".migration_openfang_to_webot_done";

pub fn user_home_dir() -> Result<PathBuf, String> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "未找到用户目录环境变量(USERPROFILE/HOME)".to_string())
}

pub fn webot_home_dir() -> Result<PathBuf, String> {
    if let Some(raw) = env::var_os("WEBOT_HOME") {
        let path = PathBuf::from(raw);
        if path.as_os_str().is_empty() {
            return Err("WEBOT_HOME 路径无效".to_string());
        }
        return Ok(path);
    }

    Ok(user_home_dir()?.join(WEBOT_HOME_DIR_NAME))
}

pub fn openfang_runtime_home_dir() -> Result<PathBuf, String> {
    webot_home_dir()
}

pub fn legacy_openfang_home_dir() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(LEGACY_OPENFANG_DIR_NAME))
}

pub fn skills_root() -> Result<PathBuf, String> {
    Ok(webot_home_dir()?.join("skills"))
}

pub fn workspaces_root() -> Result<PathBuf, String> {
    Ok(webot_home_dir()?.join(WORKSPACES_DIR_NAME))
}

pub fn management_db_path() -> Result<PathBuf, String> {
    Ok(webot_home_dir().map(|home| home.join("shared").join("data").join("management.sqlite3"))?)
}

pub fn openfang_config_path() -> Result<PathBuf, String> {
    Ok(openfang_runtime_home_dir()?.join("config.toml"))
}

pub fn migrate_runtime_agents_media_to_workspaces() -> Result<(), String> {
    let runtime_home = openfang_runtime_home_dir()?;
    let legacy_agents_root = runtime_home.join("agents");
    let workspace_root = workspaces_root()?;

    merge_agent_media_to_workspaces(&legacy_agents_root, &workspace_root)?;
    cleanup_legacy_agents_root(&legacy_agents_root)?;
    Ok(())
}

pub fn migrate_legacy_openfang_layout() -> Result<(), String> {
    if migration_disabled() {
        return Ok(());
    }

    let webot_home = webot_home_dir()?;
    fs::create_dir_all(&webot_home).map_err(|e| format!("创建 WEBOT_HOME 目录失败: {e}"))?;

    let marker_path = webot_home.join(MIGRATION_MARKER_FILE);
    if marker_path.exists() {
        return Ok(());
    }

    let legacy_home = legacy_openfang_home_dir()?;
    if !legacy_home.exists() || legacy_home == webot_home {
        write_migration_marker(
            &marker_path,
            &[],
            &["跳过迁移：旧目录不存在或与目标目录相同".to_string()],
        )?;
        return Ok(());
    }

    let mut migrated = Vec::new();
    let mut warnings = Vec::new();

    try_copy_file_if_missing(
        &legacy_home.join("webot").join("management.sqlite3"),
        &management_db_path()?,
        "management.sqlite3",
        &mut migrated,
        &mut warnings,
    );
    try_merge_dir(
        &legacy_home.join("skills"),
        &skills_root()?,
        "skills",
        &mut migrated,
        &mut warnings,
    );
    try_copy_file_if_missing(
        &legacy_home.join("config.toml"),
        &openfang_config_path()?,
        "config.toml",
        &mut migrated,
        &mut warnings,
    );
    try_copy_file_if_missing(
        &legacy_home.join("data").join("openfang.db"),
        &openfang_runtime_home_dir()?
            .join("data")
            .join("openfang.db"),
        "openfang.db",
        &mut migrated,
        &mut warnings,
    );
    try_merge_agent_media_only(
        &legacy_home.join("agents"),
        &workspaces_root()?,
        "agents_media_to_workspaces",
        &mut migrated,
        &mut warnings,
    );
    if let Err(err) = migrate_runtime_agents_media_to_workspaces() {
        warnings.push(format!("迁移运行时 agents 媒体到 workspaces 失败：{err}"));
    }

    write_migration_marker(&marker_path, &migrated, &warnings)?;
    Ok(())
}

fn migration_disabled() -> bool {
    env::var("WEBOT_MIGRATION_DISABLE")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn try_copy_file_if_missing(
    source: &Path,
    target: &Path,
    label: &str,
    migrated: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    if !source.is_file() || target.exists() {
        return;
    }

    if let Some(parent) = target.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            warnings.push(format!("迁移 {label} 失败：创建目标目录失败: {err}"));
            return;
        }
    }

    match fs::copy(source, target) {
        Ok(_) => migrated.push(format!(
            "{label}: {} -> {}",
            source.display(),
            target.display()
        )),
        Err(err) => warnings.push(format!("迁移 {label} 失败：{err}")),
    }
}

fn try_merge_dir(
    source: &Path,
    target: &Path,
    label: &str,
    migrated: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    if !source.is_dir() {
        return;
    }

    match merge_dir_if_missing_entries(source, target) {
        Ok(changed) => {
            if changed {
                migrated.push(format!(
                    "{label}: {} -> {}",
                    source.display(),
                    target.display()
                ));
            }
        }
        Err(err) => warnings.push(format!("迁移 {label} 失败：{err}")),
    }
}

fn try_merge_agent_media_only(
    source_agents_root: &Path,
    target_workspaces_root: &Path,
    label: &str,
    migrated: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    match merge_agent_media_to_workspaces(source_agents_root, target_workspaces_root) {
        Ok(changed) if changed => migrated.push(format!(
            "{label}: {} -> {}",
            source_agents_root.display(),
            target_workspaces_root.display()
        )),
        Ok(_) => {}
        Err(err) => warnings.push(format!("迁移 {label} 失败：{err}")),
    }
}

fn merge_agent_media_to_workspaces(
    source_agents_root: &Path,
    target_workspaces_root: &Path,
) -> Result<bool, String> {
    if !source_agents_root.is_dir() {
        return Ok(false);
    }

    fs::create_dir_all(target_workspaces_root).map_err(|e| {
        format!(
            "创建 workspaces 目录失败({}): {e}",
            target_workspaces_root.display()
        )
    })?;

    let mut changed = false;
    let entries = fs::read_dir(source_agents_root).map_err(|e| {
        format!(
            "读取 agents 目录失败({}): {e}",
            source_agents_root.display()
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取 agents 目录项失败: {e}"))?;
        let source_agent_dir = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败({}): {e}", source_agent_dir.display()))?;
        if !file_type.is_dir() {
            continue;
        }

        let target_agent_dir = target_workspaces_root.join(entry.file_name());
        for media_dir in ["avatar", "portrait"] {
            let source_media_dir = source_agent_dir.join(media_dir);
            if !source_media_dir.is_dir() {
                continue;
            }
            let target_media_dir = target_agent_dir.join(media_dir);
            if merge_dir_if_missing_entries(&source_media_dir, &target_media_dir)? {
                changed = true;
            }
        }
    }

    Ok(changed)
}

fn cleanup_legacy_agents_root(agents_root: &Path) -> Result<(), String> {
    if !agents_root.exists() {
        return Ok(());
    }
    fs::remove_dir_all(agents_root)
        .map_err(|e| format!("删除旧 agents 目录失败({}): {e}", agents_root.display()))
}

fn merge_dir_if_missing_entries(source: &Path, target: &Path) -> Result<bool, String> {
    fs::create_dir_all(target).map_err(|e| format!("创建目录失败({}): {e}", target.display()))?;

    let mut changed = false;
    let entries =
        fs::read_dir(source).map_err(|e| format!("读取目录失败({}): {e}", source.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败({}): {e}", source_path.display()))?;

        if file_type.is_dir() {
            if merge_dir_if_missing_entries(&source_path, &target_path)? {
                changed = true;
            }
            continue;
        }

        if file_type.is_file() && !target_path.exists() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录失败({}): {e}", parent.display()))?;
            }
            fs::copy(&source_path, &target_path).map_err(|e| {
                format!(
                    "复制文件失败({} -> {}): {e}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
            changed = true;
        }
    }

    Ok(changed)
}

fn write_migration_marker(
    marker_path: &Path,
    migrated: &[String],
    warnings: &[String],
) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();

    let mut lines = vec![format!("timestamp_unix={timestamp}")];
    if migrated.is_empty() {
        lines.push("migrated=none".to_string());
    } else {
        lines.push(format!("migrated_count={}", migrated.len()));
        lines.extend(migrated.iter().map(|item| format!("migrated={item}")));
    }
    if warnings.is_empty() {
        lines.push("warnings=none".to_string());
    } else {
        lines.push(format!("warning_count={}", warnings.len()));
        lines.extend(warnings.iter().map(|item| format!("warning={item}")));
    }

    fs::write(marker_path, lines.join("\n"))
        .map_err(|e| format!("写入迁移标记失败({}): {e}", marker_path.display()))
}
