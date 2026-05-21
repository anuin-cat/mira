use reqwest::Url;
use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const DEFAULT_DIRECTORY_PICKER_TITLE: &str = "选择文件夹";
const ALLOWED_EXTERNAL_URL_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMessageRequest {
    title: Option<String>,
    message: String,
    kind: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemConfirmRequest {
    title: Option<String>,
    message: String,
    kind: Option<String>,
    confirm_label: Option<String>,
    cancel_label: Option<String>,
}

/** 归一化目录选择框标题，避免前端传入空标题 */
fn normalize_picker_title(title: Option<String>) -> String {
    title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_DIRECTORY_PICKER_TITLE.to_string())
}

/** 归一化对话框标题，空标题交给系统使用应用名 */
fn normalize_dialog_title(title: Option<String>) -> Option<String> {
    title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/** 校验系统消息正文，避免弹出空对话框 */
fn normalize_dialog_message(message: String) -> Result<String, String> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("缺少消息内容".to_string());
    }
    Ok(message)
}

/** 归一化系统消息类型 */
fn normalize_message_kind(kind: Option<String>) -> MessageDialogKind {
    match kind
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("warning") => MessageDialogKind::Warning,
        Some("error") => MessageDialogKind::Error,
        _ => MessageDialogKind::Info,
    }
}

/** 归一化按钮文案，避免传入空按钮 */
fn normalize_button_label(value: Option<String>, fallback: &str) -> String {
    value
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
        .unwrap_or_else(|| fallback.to_string())
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

/** 通过 Rust 弹出系统消息框，前端不直接持有 dialog 插件权限 */
#[tauri::command]
pub async fn system_show_message(
    app: AppHandle,
    request: SystemMessageRequest,
) -> Result<(), String> {
    let title = normalize_dialog_title(request.title);
    let message = normalize_dialog_message(request.message)?;
    let kind = normalize_message_kind(request.kind);

    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .message(message)
            .kind(kind)
            .buttons(MessageDialogButtons::Ok);
        if let Some(title) = title {
            dialog = dialog.title(title);
        }
        dialog.blocking_show();
    })
    .await
    .map_err(|error| format!("显示系统消息失败：{error}"))?;

    Ok(())
}

/** 通过 Rust 弹出系统确认框，前端不直接持有 dialog 插件权限 */
#[tauri::command]
pub async fn system_confirm(app: AppHandle, request: SystemConfirmRequest) -> Result<bool, String> {
    let title = normalize_dialog_title(request.title);
    let message = normalize_dialog_message(request.message)?;
    let kind = normalize_message_kind(request.kind);
    let confirm_label = normalize_button_label(request.confirm_label, "确定");
    let cancel_label = normalize_button_label(request.cancel_label, "取消");

    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog =
            app.dialog()
                .message(message)
                .kind(kind)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    confirm_label,
                    cancel_label,
                ));
        if let Some(title) = title {
            dialog = dialog.title(title);
        }
        dialog.blocking_show()
    })
    .await
    .map_err(|error| format!("显示系统确认失败：{error}"))
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
