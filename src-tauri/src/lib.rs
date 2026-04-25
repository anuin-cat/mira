use tauri::menu::{Menu, MenuItem, Submenu};
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
            let menu = Menu::with_items(app, &[&file_menu])?;
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
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
