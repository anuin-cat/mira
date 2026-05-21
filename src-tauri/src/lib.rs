mod search_api;
mod web_fetch;

use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

const TRASH_ROOT_DIR: &str = "trash";
const TRASH_METADATA_FILE: &str = ".mira-trash.json";

/** 校验回收站批次 id，只允许路径安全字符 */
fn is_safe_trash_item_id(item_id: &str) -> bool {
    !item_id.is_empty()
        && item_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/** 允许前端访问用户选择的 vault 目录及其附件预览资源 */
#[tauri::command]
fn allow_vault_path_access(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let vault_path = PathBuf::from(path);
    if !vault_path.is_absolute() {
        return Err("Vault 路径必须是绝对路径".to_string());
    }

    app.fs_scope()
        .allow_directory(&vault_path, true)
        .map_err(|error| error.to_string())?;

    app.asset_protocol_scope()
        .allow_directory(&vault_path, true)
        .map_err(|error| error.to_string())?;

    Ok(())
}

/** 允许前端访问单个回收站元数据文件，覆盖 Unix 点文件默认不匹配通配符的问题 */
#[tauri::command]
fn allow_trash_metadata_access(
    app: tauri::AppHandle,
    vault_path: String,
    item_id: String,
) -> Result<(), String> {
    let vault_path = PathBuf::from(vault_path);
    if !vault_path.is_absolute() {
        return Err("Vault 路径必须是绝对路径".to_string());
    }
    if !is_safe_trash_item_id(&item_id) {
        return Err("回收站条目无效".to_string());
    }

    let metadata_path = vault_path
        .join(TRASH_ROOT_DIR)
        .join(item_id)
        .join(TRASH_METADATA_FILE);

    app.fs_scope()
        .allow_file(&metadata_path)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            allow_trash_metadata_access,
            allow_vault_path_access,
            search_api::search_api_post_json,
            web_fetch::web_fetch_url,
        ])
        .setup(|app| {
            if !cfg!(target_os = "macos") {
                return Ok(());
            }

            // 1. 构建 App 菜单，承接 macOS 系统级快捷键
            let app_settings =
                MenuItem::with_id(app, "app_settings", "设置", true, Some("CmdOrCtrl+Comma"))?;
            let app_separator_1 = PredefinedMenuItem::separator(app)?;
            let app_separator_2 = PredefinedMenuItem::separator(app)?;
            let hide = PredefinedMenuItem::hide(app, None::<&str>)?;
            let hide_others = PredefinedMenuItem::hide_others(app, None::<&str>)?;
            let show_all = PredefinedMenuItem::show_all(app, None::<&str>)?;
            let quit = PredefinedMenuItem::quit(app, None::<&str>)?;
            let app_menu = Submenu::with_items(
                app,
                "Mira",
                true,
                &[
                    &app_settings,
                    &app_separator_1,
                    &hide,
                    &hide_others,
                    &show_all,
                    &app_separator_2,
                    &quit,
                ],
            )?;

            // 2. 构建 File 菜单
            let change_vault = MenuItem::with_id(
                app,
                "change_vault",
                "更换 Vault...",
                true,
                Some("CmdOrCtrl+KeyO"),
            )?;
            let new_file =
                MenuItem::with_id(app, "new_file", "新建文件", true, Some("CmdOrCtrl+KeyN"))?;
            let new_folder = MenuItem::with_id(
                app,
                "new_folder",
                "新建文件夹",
                true,
                Some("CmdOrCtrl+Shift+KeyN"),
            )?;
            let save_file = MenuItem::with_id(
                app,
                "save_file",
                "保存当前文件",
                true,
                Some("CmdOrCtrl+KeyS"),
            )?;
            let refresh_vault = MenuItem::with_id(
                app,
                "refresh_vault",
                "刷新 Vault",
                true,
                Some("CmdOrCtrl+KeyR"),
            )?;
            let open_trash = MenuItem::with_id(app, "open_trash", "回收站...", true, None::<&str>)?;
            let rename_entry = MenuItem::with_id(app, "rename_entry", "重命名", true, Some("F2"))?;
            let delete_entry = MenuItem::with_id(
                app,
                "delete_entry",
                "删除",
                true,
                Some("CmdOrCtrl+Backspace"),
            )?;
            let reveal_in_finder = MenuItem::with_id(
                app,
                "reveal_in_finder",
                "在文件管理器中显示",
                true,
                Some("CmdOrCtrl+Alt+KeyR"),
            )?;
            let file_separator_1 = PredefinedMenuItem::separator(app)?;
            let file_separator_2 = PredefinedMenuItem::separator(app)?;
            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &new_file,
                    &new_folder,
                    &file_separator_1,
                    &save_file,
                    &refresh_vault,
                    &open_trash,
                    &change_vault,
                    &file_separator_2,
                    &rename_entry,
                    &delete_entry,
                    &reveal_in_finder,
                ],
            )?;

            // 3. 构建 Edit 菜单，承接 macOS 原生文本编辑快捷键
            let undo = PredefinedMenuItem::undo(app, None::<&str>)?;
            let redo = PredefinedMenuItem::redo(app, None::<&str>)?;
            let edit_separator = PredefinedMenuItem::separator(app)?;
            let edit_separator_2 = PredefinedMenuItem::separator(app)?;
            let cut = PredefinedMenuItem::cut(app, None::<&str>)?;
            let copy = PredefinedMenuItem::copy(app, None::<&str>)?;
            let paste = PredefinedMenuItem::paste(app, None::<&str>)?;
            let paste_and_match_style = MenuItem::with_id(
                app,
                "paste_and_match_style",
                "粘贴并匹配样式",
                true,
                Some("CmdOrCtrl+Alt+Shift+KeyV"),
            )?;
            let select_all = PredefinedMenuItem::select_all(app, None::<&str>)?;
            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &undo,
                    &redo,
                    &edit_separator,
                    &cut,
                    &copy,
                    &paste,
                    &paste_and_match_style,
                    &edit_separator_2,
                    &select_all,
                ],
            )?;

            // 4. 构建 Search 菜单
            let find_in_file = MenuItem::with_id(
                app,
                "find_in_file",
                "当前文件内搜索",
                true,
                Some("CmdOrCtrl+KeyF"),
            )?;
            let find_next_in_file = MenuItem::with_id(
                app,
                "find_next_in_file",
                "查找下一个",
                true,
                Some("CmdOrCtrl+KeyG"),
            )?;
            let find_previous_in_file = MenuItem::with_id(
                app,
                "find_previous_in_file",
                "查找上一个",
                true,
                Some("CmdOrCtrl+Shift+KeyG"),
            )?;
            let search_vault = MenuItem::with_id(
                app,
                "search_vault",
                "全 Vault 搜索",
                true,
                Some("CmdOrCtrl+Shift+KeyF"),
            )?;
            let search_separator = PredefinedMenuItem::separator(app)?;
            let search_menu = Submenu::with_items(
                app,
                "Search",
                true,
                &[
                    &find_in_file,
                    &find_next_in_file,
                    &find_previous_in_file,
                    &search_separator,
                    &search_vault,
                ],
            )?;

            // 5. 构建 Navigate 菜单
            let quick_open = MenuItem::with_id(
                app,
                "quick_open",
                "快速打开文件",
                true,
                Some("CmdOrCtrl+KeyP"),
            )?;
            let command_palette = MenuItem::with_id(
                app,
                "command_palette",
                "命令面板",
                true,
                Some("CmdOrCtrl+Shift+KeyP"),
            )?;
            let history_back = MenuItem::with_id(
                app,
                "history_back",
                "返回上一个文件",
                true,
                Some("CmdOrCtrl+BracketLeft"),
            )?;
            let history_forward = MenuItem::with_id(
                app,
                "history_forward",
                "前进到下一个文件",
                true,
                Some("CmdOrCtrl+BracketRight"),
            )?;
            let navigate_separator = PredefinedMenuItem::separator(app)?;
            let navigate_menu = Submenu::with_items(
                app,
                "Navigate",
                true,
                &[
                    &quick_open,
                    &command_palette,
                    &navigate_separator,
                    &history_back,
                    &history_forward,
                ],
            )?;

            // 6. 构建 View 菜单
            let toggle_file_sidebar = MenuItem::with_id(
                app,
                "toggle_file_sidebar",
                "显示/隐藏文件侧栏",
                true,
                Some("CmdOrCtrl+Backslash"),
            )?;
            let toggle_ai_sidebar = MenuItem::with_id(
                app,
                "toggle_ai_sidebar",
                "显示/隐藏 AI 对话栏",
                true,
                Some("CmdOrCtrl+KeyL"),
            )?;
            let font_decrease = MenuItem::with_id(
                app,
                "font_decrease",
                "缩小字体",
                true,
                Some("CmdOrCtrl+Minus"),
            )?;
            let font_increase = MenuItem::with_id(
                app,
                "font_increase",
                "放大字体",
                true,
                Some("CmdOrCtrl+Shift+Equal"),
            )?;
            let font_reset = MenuItem::with_id(
                app,
                "font_reset",
                "重置字体大小",
                true,
                Some("CmdOrCtrl+Digit0"),
            )?;
            let font_small = MenuItem::with_id(app, "font_small", "小", true, None::<&str>)?;
            let font_medium = MenuItem::with_id(app, "font_medium", "中", true, None::<&str>)?;
            let font_large = MenuItem::with_id(app, "font_large", "大", true, None::<&str>)?;
            let font_xlarge = MenuItem::with_id(app, "font_xlarge", "特大", true, None::<&str>)?;
            let font_size_menu = Submenu::with_items(
                app,
                "字体大小",
                true,
                &[&font_small, &font_medium, &font_large, &font_xlarge],
            )?;
            let theme_default =
                MenuItem::with_id(app, "theme_default", "默认", true, None::<&str>)?;
            let theme_warm_paper =
                MenuItem::with_id(app, "theme_warm_paper", "纸质书页", true, None::<&str>)?;
            let theme_twilight =
                MenuItem::with_id(app, "theme_twilight", "暮光蓝", true, None::<&str>)?;
            let theme_forest =
                MenuItem::with_id(app, "theme_forest", "森林绿", true, None::<&str>)?;
            let theme_dark_classic =
                MenuItem::with_id(app, "theme_dark_classic", "经典深色", true, None::<&str>)?;
            let theme_menu = Submenu::with_items(
                app,
                "主题",
                true,
                &[
                    &theme_default,
                    &theme_warm_paper,
                    &theme_twilight,
                    &theme_forest,
                    &theme_dark_classic,
                ],
            )?;
            let view_separator = PredefinedMenuItem::separator(app)?;
            let view_menu = Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &toggle_file_sidebar,
                    &toggle_ai_sidebar,
                    &view_separator,
                    &font_decrease,
                    &font_increase,
                    &font_reset,
                    &font_size_menu,
                    &theme_menu,
                ],
            )?;

            // 7. 构建 Window 菜单
            let minimize = PredefinedMenuItem::minimize(app, None::<&str>)?;
            let fullscreen = PredefinedMenuItem::fullscreen(app, None::<&str>)?;
            let window_menu = Submenu::with_items(app, "Window", true, &[&minimize, &fullscreen])?;

            // 8. 构建 AI 菜单
            let ai_new_chat = MenuItem::with_id(
                app,
                "ai_new_chat",
                "新建 AI 对话",
                true,
                Some("CmdOrCtrl+Alt+KeyN"),
            )?;
            let ai_ask_current_note = MenuItem::with_id(
                app,
                "ai_ask_current_note",
                "基于当前笔记提问",
                true,
                Some("CmdOrCtrl+Alt+Enter"),
            )?;
            let ai_menu =
                Submenu::with_items(app, "AI", true, &[&ai_new_chat, &ai_ask_current_note])?;

            let menu = Menu::with_items(
                app,
                &[
                    &app_menu,
                    &file_menu,
                    &edit_menu,
                    &search_menu,
                    &navigate_menu,
                    &view_menu,
                    &window_menu,
                    &ai_menu,
                ],
            )?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            // 9. 菜单点击时向前端发送事件
            let event_name = match event.id().as_ref() {
                "change_vault" => "menu:change-vault",
                "new_file" => "menu:new-file",
                "new_folder" => "menu:new-folder",
                "save_file" => "menu:save-file",
                "refresh_vault" => "menu:refresh-vault",
                "open_trash" => "menu:open-trash",
                "rename_entry" => "menu:rename-entry",
                "delete_entry" => "menu:delete-entry",
                "reveal_in_finder" => "menu:reveal-in-finder",
                "paste_and_match_style" => "menu:paste-and-match-style",
                "find_in_file" => "menu:find-in-file",
                "find_next_in_file" => "menu:find-next-in-file",
                "find_previous_in_file" => "menu:find-previous-in-file",
                "search_vault" => "menu:search-vault",
                "quick_open" => "menu:quick-open",
                "command_palette" => "menu:command-palette",
                "history_back" => "menu:history-back",
                "history_forward" => "menu:history-forward",
                "toggle_file_sidebar" => "menu:toggle-file-sidebar",
                "toggle_ai_sidebar" => "menu:toggle-ai-sidebar",
                "font_decrease" => "menu:font-decrease",
                "font_increase" => "menu:font-increase",
                "font_reset" => "menu:font-reset",
                "font_small" => "menu:font-size-small",
                "font_medium" => "menu:font-size-medium",
                "font_large" => "menu:font-size-large",
                "font_xlarge" => "menu:font-size-xlarge",
                "theme_default" => "menu:theme-default",
                "theme_warm_paper" => "menu:theme-warm-paper",
                "theme_twilight" => "menu:theme-twilight",
                "theme_forest" => "menu:theme-forest",
                "theme_dark_classic" => "menu:theme-dark-classic",
                "ai_new_chat" => "menu:ai-new-chat",
                "ai_ask_current_note" => "menu:ai-ask-current-note",
                "app_settings" => "menu:app-settings",
                _ => return,
            };
            app.emit(event_name, ()).unwrap();
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
