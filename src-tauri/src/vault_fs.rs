use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct VaultRootState {
    root: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDirEntry {
    name: String,
    is_file: bool,
    is_directory: bool,
    is_symlink: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFileInfo {
    is_file: bool,
    is_directory: bool,
    is_symlink: bool,
    size: u64,
    mtime: Option<u64>,
}

fn normalize_relative_input(relative_path: Option<String>) -> Result<Option<String>, String> {
    let Some(raw_path) = relative_path else {
        return Ok(None);
    };
    let path = raw_path.trim().replace('\\', "/");
    if path.is_empty() {
        return Ok(None);
    }
    if path.starts_with('/') || path.starts_with('~') {
        return Err("不能使用绝对路径".to_string());
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err("不能使用绝对路径".to_string());
    }

    Ok(Some(
        path.split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>()
            .join("/"),
    ))
}

fn current_root(state: &State<'_, VaultRootState>) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "Vault 状态不可用".to_string())?
        .clone()
        .ok_or_else(|| "尚未打开 Vault".to_string())
}

fn assert_path_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("路径不能指向 vault 外部".to_string())
    }
}

fn canonicalize_existing_parent(root: &Path, path: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "路径无效".to_string())?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    assert_path_inside_root(root, &canonical_parent)
}

fn resolve_vault_path_with_root(
    root: &Path,
    relative_path: Option<String>,
    must_exist: bool,
    check_existing_parent: bool,
) -> Result<PathBuf, String> {
    let normalized_path = normalize_relative_input(relative_path)?;
    let mut target_path = root.to_path_buf();

    if let Some(path) = normalized_path {
        for component in Path::new(&path).components() {
            match component {
                Component::Normal(segment) => target_path.push(segment),
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err("路径不能指向 vault 外部".to_string());
                }
            }
        }
    }

    if target_path.exists() {
        let canonical_path = fs::canonicalize(&target_path).map_err(|error| error.to_string())?;
        assert_path_inside_root(root, &canonical_path)?;
        Ok(target_path)
    } else {
        if must_exist {
            return Err("路径不存在".to_string());
        }
        if check_existing_parent {
            canonicalize_existing_parent(root, &target_path)?;
        }
        Ok(target_path)
    }
}

fn resolve_vault_path(
    state: &State<'_, VaultRootState>,
    relative_path: Option<String>,
    must_exist: bool,
    check_existing_parent: bool,
) -> Result<PathBuf, String> {
    let root = current_root(state)?;
    resolve_vault_path_with_root(&root, relative_path, must_exist, check_existing_parent)
}

fn file_info_from_metadata(metadata: fs::Metadata) -> VaultFileInfo {
    let file_type = metadata.file_type();
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);

    VaultFileInfo {
        is_file: file_type.is_file(),
        is_directory: file_type.is_dir(),
        is_symlink: file_type.is_symlink(),
        size: metadata.len(),
        mtime,
    }
}

fn assert_not_symlink(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("不支持操作符号链接".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn vault_set_root(
    app: AppHandle,
    state: State<'_, VaultRootState>,
    path: String,
) -> Result<(), String> {
    let root = PathBuf::from(path);
    if !root.is_absolute() {
        return Err("Vault 路径必须是绝对路径".to_string());
    }

    let canonical_root = fs::canonicalize(&root).map_err(|error| error.to_string())?;
    if !canonical_root.is_dir() {
        return Err("Vault 路径必须是文件夹".to_string());
    }

    app.asset_protocol_scope()
        .allow_directory(&canonical_root, true)
        .map_err(|error| error.to_string())?;

    *state
        .root
        .lock()
        .map_err(|_| "Vault 状态不可用".to_string())? = Some(canonical_root);
    Ok(())
}

#[tauri::command]
pub fn vault_exists(
    state: State<'_, VaultRootState>,
    relative_path: Option<String>,
) -> Result<bool, String> {
    match resolve_vault_path(&state, relative_path, false, false) {
        Ok(path) => Ok(path.exists()),
        Err(error) if error == "路径不存在" => Ok(false),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub fn vault_stat(
    state: State<'_, VaultRootState>,
    relative_path: Option<String>,
) -> Result<Option<VaultFileInfo>, String> {
    let path = resolve_vault_path(&state, relative_path, false, false)?;
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    Ok(Some(file_info_from_metadata(metadata)))
}

#[tauri::command]
pub fn vault_read_dir(
    state: State<'_, VaultRootState>,
    relative_path: Option<String>,
) -> Result<Vec<VaultDirEntry>, String> {
    let path = resolve_vault_path(&state, relative_path, false, false)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    assert_not_symlink(&path)?;

    let entries = fs::read_dir(path).map_err(|error| error.to_string())?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        result.push(VaultDirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_file: file_type.is_file(),
            is_directory: file_type.is_dir(),
            is_symlink: file_type.is_symlink(),
        });
    }
    Ok(result)
}

#[tauri::command]
pub fn vault_read_text(
    state: State<'_, VaultRootState>,
    relative_path: String,
) -> Result<Option<String>, String> {
    let path = resolve_vault_path(&state, Some(relative_path), false, false)?;
    if !path.exists() {
        return Ok(None);
    }
    assert_not_symlink(&path)?;
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn vault_write_text(
    state: State<'_, VaultRootState>,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let path = resolve_vault_path(&state, Some(relative_path), false, true)?;
    if path.exists() {
        assert_not_symlink(&path)?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn vault_write_binary(
    state: State<'_, VaultRootState>,
    relative_path: String,
    content: Vec<u8>,
) -> Result<(), String> {
    let path = resolve_vault_path(&state, Some(relative_path), false, true)?;
    if path.exists() {
        assert_not_symlink(&path)?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn vault_create_dir(
    state: State<'_, VaultRootState>,
    relative_path: String,
) -> Result<(), String> {
    let path = resolve_vault_path(&state, Some(relative_path), false, true)?;
    if path.exists() {
        assert_not_symlink(&path)?;
    }
    fs::create_dir_all(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn vault_rename(
    state: State<'_, VaultRootState>,
    from_relative_path: String,
    to_relative_path: String,
) -> Result<(), String> {
    let from_path = resolve_vault_path(&state, Some(from_relative_path), true, false)?;
    let to_path = resolve_vault_path(&state, Some(to_relative_path), false, true)?;
    assert_not_symlink(&from_path)?;
    if to_path.exists() {
        return Err("目标位置已有同名文件或文件夹".to_string());
    }
    fs::rename(from_path, to_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn vault_remove(
    state: State<'_, VaultRootState>,
    relative_path: String,
    recursive: bool,
) -> Result<(), String> {
    let path = resolve_vault_path(&state, Some(relative_path), false, false)?;
    if !path.exists() {
        return Ok(());
    }
    assert_not_symlink(&path)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        if recursive {
            fs::remove_dir_all(path).map_err(|error| error.to_string())
        } else {
            fs::remove_dir(path).map_err(|error| error.to_string())
        }
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn vault_reveal_in_finder(
    state: State<'_, VaultRootState>,
    relative_path: Option<String>,
) -> Result<(), String> {
    let path = resolve_vault_path(&state, relative_path, true, false)?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn vault_get_asset_file_path(
    app: AppHandle,
    state: State<'_, VaultRootState>,
    relative_path: String,
) -> Result<String, String> {
    let path = resolve_vault_path(&state, Some(relative_path), false, true)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::resolve_vault_path_with_root;
    use std::{fs, path::PathBuf};

    fn create_test_root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("mira-vault-fs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test vault root");
        root
    }

    #[test]
    fn rejects_parent_directory_escape() {
        let root = create_test_root("escape");
        let result =
            resolve_vault_path_with_root(&root, Some("../outside.md".to_string()), false, false);

        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn allows_missing_path_when_parent_check_is_not_required() {
        let root = create_test_root("missing");
        let result =
            resolve_vault_path_with_root(&root, Some("missing/child.md".to_string()), false, false)
                .expect("resolve missing path");

        assert_eq!(result, root.join("missing").join("child.md"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_missing_parent_when_parent_check_is_required() {
        let root = create_test_root("parent");
        let result =
            resolve_vault_path_with_root(&root, Some("missing/child.md".to_string()), false, true);

        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }
}
