use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 1. 构建 File 菜单
            let change_vault = MenuItem::with_id(app, "change_vault", "更换 Vault...", true, None::<&str>)?;
            let file_menu = Submenu::with_items(app, "File", true, &[&change_vault])?;
            let menu = Menu::with_items(app, &[&file_menu])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            // 2. 菜单点击时向前端发送事件
            if event.id() == "change_vault" {
                app.emit("menu:change-vault", ()).unwrap();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
