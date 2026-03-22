use std::fs;
use std::io;
use std::path::Path;
use std::{collections::HashSet, ffi::OsString};

fn files_equal(source: &Path, target: &Path) -> io::Result<bool> {
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

fn sync_dir_recursive(source: &Path, target: &Path) -> io::Result<()> {
    if !source.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("默认技能目录不存在: {}", source.display()),
        ));
    }

    fs::create_dir_all(target)?;
    let mut source_entries: HashSet<OsString> = HashSet::new();

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let file_name = entry.file_name();
        source_entries.insert(file_name.clone());
        let target_path = target.join(&file_name);
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            if target_path.is_file() {
                fs::remove_file(&target_path)?;
            }
            sync_dir_recursive(&source_path, &target_path)?;
            continue;
        }

        if target_path.is_dir() {
            fs::remove_dir_all(&target_path)?;
        }
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }

        if !files_equal(&source_path, &target_path)? {
            fs::copy(&source_path, &target_path)?;
        }
    }

    for entry in fs::read_dir(target)? {
        let entry = entry?;
        let target_path = entry.path();
        if source_entries.contains(&entry.file_name()) {
            continue;
        }

        if entry.file_type()?.is_dir() {
            fs::remove_dir_all(target_path)?;
        } else {
            fs::remove_file(target_path)?;
        }
    }

    Ok(())
}

fn emit_rerun_if_changed(path: &Path) -> io::Result<()> {
    println!("cargo:rerun-if-changed={}", path.display());
    if !path.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        emit_rerun_if_changed(&entry.path())?;
    }

    Ok(())
}

fn main() {
    let ui_skill_source = Path::new("../skills/ui-skill");
    let ui_skill_target = Path::new("resources/skills/ui-skill");
    let comfyui_source = Path::new("../../../comfyui");

    emit_rerun_if_changed(ui_skill_source).expect("failed to watch ui-skill resources");
    emit_rerun_if_changed(comfyui_source).expect("failed to watch comfyui resources");
    sync_dir_recursive(ui_skill_source, ui_skill_target)
        .expect("failed to stage bundled ui-skill resources");

    tauri_build::build()
}
