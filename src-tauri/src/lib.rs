use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 1. 构建 File 菜单
            let change_vault = MenuItem::with_id(app, "change_vault", "更换 Vault...", true, None::<&str>)?;
            let refresh_vault = MenuItem::with_id(app, "refresh_vault", "刷新 Vault", true, None::<&str>)?;
            let update_mira_map = MenuItem::with_id(app, "update_mira_map", "更新 Mira Map", true, None::<&str>)?;
            let file_menu = Submenu::with_items(app, "File", true, &[&change_vault, &refresh_vault, &update_mira_map])?;

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
                &[&undo, &redo, &edit_separator, &cut, &copy, &paste, &select_all],
            )?;

            // 3. 构建 View 菜单
            let font_small = MenuItem::with_id(app, "font_small", "小", true, None::<&str>)?;
            let font_medium = MenuItem::with_id(app, "font_medium", "中", true, None::<&str>)?;
            let font_large = MenuItem::with_id(app, "font_large", "大", true, None::<&str>)?;
            let font_xlarge = MenuItem::with_id(app, "font_xlarge", "特大", true, None::<&str>)?;
            let view_menu = Submenu::with_items(app, "View", true, &[&font_small, &font_medium, &font_large, &font_xlarge])?;

            let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            // 2. 菜单点击时向前端发送事件
            if event.id() == "change_vault" {
                app.emit("menu:change-vault", ()).unwrap();
            } else if event.id() == "refresh_vault" {
                app.emit("menu:refresh-vault", ()).unwrap();
            } else if event.id() == "update_mira_map" {
                app.emit("menu:update-mira-map", ()).unwrap();
            } else if event.id() == "font_small" {
                app.emit("menu:font-size-small", ()).unwrap();
            } else if event.id() == "font_medium" {
                app.emit("menu:font-size-medium", ()).unwrap();
            } else if event.id() == "font_large" {
                app.emit("menu:font-size-large", ()).unwrap();
            } else if event.id() == "font_xlarge" {
                app.emit("menu:font-size-xlarge", ()).unwrap();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
