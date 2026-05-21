use reqwest::Url;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const DEFAULT_DIRECTORY_PICKER_TITLE: &str = "选择文件夹";
const ALLOWED_EXTERNAL_URL_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/** 归一化目录选择框标题，避免前端传入空标题 */
fn normalize_picker_title(title: Option<String>) -> String {
    title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_DIRECTORY_PICKER_TITLE.to_string())
}

/** 校验外部链接协议，系统打开能力只允许明确白名单 */
fn normalize_external_url(value: &str) -> Result<String, String> {
    let trimmed_url = value.trim();
    if trimmed_url.is_empty() {
        return Err("缺少要打开的链接".to_string());
    }

    let url = Url::parse(trimmed_url).map_err(|_| "链接格式不正确".to_string())?;
    if !ALLOWED_EXTERNAL_URL_SCHEMES.contains(&url.scheme()) {
        return Err("不支持打开这类链接".to_string());
    }
    if url.scheme() == "mailto" && url.path().trim().is_empty() {
        return Err("mailto 链接缺少收件人".to_string());
    }

    Ok(url.to_string())
}

/** 通过 Rust 弹出系统目录选择框，前端不直接持有 dialog 插件权限 */
#[tauri::command]
pub async fn system_pick_directory(
    app: AppHandle,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let title = normalize_picker_title(title);
    let selected_path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title(title).blocking_pick_folder()
    })
    .await
    .map_err(|error| format!("打开目录选择框失败：{error}"))?;

    let Some(selected_path) = selected_path else {
        return Ok(None);
    };
    let path = selected_path
        .into_path()
        .map_err(|error| format!("读取目录路径失败：{error}"))?;
    if !path.is_dir() {
        return Err("请选择文件夹".to_string());
    }

    Ok(Some(path.to_string_lossy().to_string()))
}

/** 通过 Rust 打开外部链接，前端不直接持有 opener 插件权限 */
#[tauri::command]
pub fn system_open_external_url(url: String) -> Result<(), String> {
    let url = normalize_external_url(&url)?;
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|error| format!("打开链接失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::normalize_external_url;

    #[test]
    fn allows_safe_external_url_schemes() {
        assert!(normalize_external_url("https://example.com").is_ok());
        assert!(normalize_external_url("http://example.com").is_ok());
        assert!(normalize_external_url("mailto:user@example.com").is_ok());
    }

    #[test]
    fn rejects_unsupported_external_url_schemes() {
        assert!(normalize_external_url("file:///tmp/test.md").is_err());
        assert!(normalize_external_url("javascript:alert(1)").is_err());
        assert!(normalize_external_url("mira://settings").is_err());
    }
}
