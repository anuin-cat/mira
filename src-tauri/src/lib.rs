mod git;
mod git_policy;
mod git_process;
mod git_status;
#[cfg(test)]
mod git_status_tests;
mod git_types;
mod web_fetch;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            git::git_get_status,
            git::git_init_local_repository,
            git::git_get_diff,
            git::git_stage_paths,
            git::git_unstage_paths,
            git::git_discard_paths,
            git::git_commit,
            git::git_push,
            git::git_connect_remote_repository,
            git::git_run_readonly,
            web_fetch::web_fetch_url,
        ])
        .setup(|app| {
            // 1. 构建 File 菜单
            let change_vault =
                MenuItem::with_id(app, "change_vault", "更换 Vault...", true, None::<&str>)?;
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
                "在 Finder 中显示",
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
                    &change_vault,
                    &file_separator_2,
                    &rename_entry,
                    &delete_entry,
                    &reveal_in_finder,
                ],
            )?;

            // 2. 构建 Edit 菜单，承接 macOS 原生文本编辑快捷键
            let undo = PredefinedMenuItem::undo(app, None::<&str>)?;
            let redo = PredefinedMenuItem::redo(app, None::<&str>)?;
            let edit_separator = PredefinedMenuItem::separator(app)?;
            let cut = PredefinedMenuItem::cut(app, None::<&str>)?;
            let copy = PredefinedMenuItem::copy(app, None::<&str>)?;
            let paste = PredefinedMenuItem::paste(app, None::<&str>)?;
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
                    &select_all,
                ],
            )?;

            // 3. 构建 Search 菜单
            let find_in_file = MenuItem::with_id(
                app,
                "find_in_file",
                "当前文件内搜索",
                true,
                Some("CmdOrCtrl+KeyF"),
            )?;
            let search_vault = MenuItem::with_id(
                app,
                "search_vault",
                "全 Vault 搜索",
                true,
                Some("CmdOrCtrl+Shift+KeyF"),
            )?;
            let search_menu =
                Submenu::with_items(app, "Search", true, &[&find_in_file, &search_vault])?;

            // 4. 构建 Navigate 菜单
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

            // 5. 构建 View 菜单
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
                Some("CmdOrCtrl+Equal"),
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

            // 6. 构建 Git 菜单
            let git_panel = MenuItem::with_id(
                app,
                "git_panel",
                "打开 Git 面板",
                true,
                Some("CmdOrCtrl+Shift+KeyG"),
            )?;
            let git_connect_remote = MenuItem::with_id(
                app,
                "git_connect_remote",
                "连接 GitHub 远端...",
                true,
                None::<&str>,
            )?;
            let git_stage_all =
                MenuItem::with_id(app, "git_stage_all", "Stage 全部变更", true, None::<&str>)?;
            let git_commit = MenuItem::with_id(app, "git_commit", "Commit...", true, None::<&str>)?;
            let git_push = MenuItem::with_id(app, "git_push", "Push", true, None::<&str>)?;
            let git_separator_1 = PredefinedMenuItem::separator(app)?;
            let git_separator_2 = PredefinedMenuItem::separator(app)?;
            let git_menu = Submenu::with_items(
                app,
                "Git",
                true,
                &[
                    &git_panel,
                    &git_separator_1,
                    &git_connect_remote,
                    &git_separator_2,
                    &git_stage_all,
                    &git_commit,
                    &git_push,
                ],
            )?;

            // 7. 构建 AI 与 App 菜单
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
            let app_settings =
                MenuItem::with_id(app, "app_settings", "设置", true, Some("CmdOrCtrl+Comma"))?;
            let app_menu = Submenu::with_items(app, "App", true, &[&app_settings])?;

            let menu = Menu::with_items(
                app,
                &[
                    &file_menu,
                    &edit_menu,
                    &search_menu,
                    &navigate_menu,
                    &view_menu,
                    &git_menu,
                    &ai_menu,
                    &app_menu,
                ],
            )?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            // 8. 菜单点击时向前端发送事件
            let event_name = match event.id().as_ref() {
                "change_vault" => "menu:change-vault",
                "new_file" => "menu:new-file",
                "new_folder" => "menu:new-folder",
                "save_file" => "menu:save-file",
                "refresh_vault" => "menu:refresh-vault",
                "rename_entry" => "menu:rename-entry",
                "delete_entry" => "menu:delete-entry",
                "reveal_in_finder" => "menu:reveal-in-finder",
                "find_in_file" => "menu:find-in-file",
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
                "git_panel" => "menu:git-panel",
                "git_connect_remote" => "menu:git-connect-remote",
                "git_stage_all" => "menu:git-stage-all",
                "git_commit" => "menu:git-commit",
                "git_push" => "menu:git-push",
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
