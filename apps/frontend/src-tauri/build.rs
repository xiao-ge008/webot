use std::fs;
use std::io;
use std::path::Path;

fn copy_dir_recursive(source: &Path, target: &Path) -> io::Result<()> {
    if !source.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("默认技能目录不存在: {}", source.display()),
        ));
    }

    if target.exists() {
        fs::remove_dir_all(target)?;
    }
    fs::create_dir_all(target)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
            continue;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&source_path, &target_path)?;
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

    emit_rerun_if_changed(ui_skill_source).expect("failed to watch ui-skill resources");
    copy_dir_recursive(ui_skill_source, ui_skill_target)
        .expect("failed to stage bundled ui-skill resources");

    tauri_build::build()
}
