mod app_menu;
mod search_api;
mod system;
mod vault_fs;
mod web_fetch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(vault_fs::VaultRootState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            system::system_open_external_url,
            system::system_pick_directory,
            vault_fs::vault_create_dir,
            vault_fs::vault_exists,
            vault_fs::vault_get_asset_file_path,
            vault_fs::vault_read_dir,
            vault_fs::vault_read_text,
            vault_fs::vault_remove,
            vault_fs::vault_rename,
            vault_fs::vault_reveal_in_finder,
            vault_fs::vault_set_root,
            vault_fs::vault_stat,
            vault_fs::vault_write_binary,
            vault_fs::vault_write_text,
            search_api::search_api_post_json,
            web_fetch::web_fetch_url,
        ])
        .setup(|app| {
            if cfg!(target_os = "macos") {
                app_menu::install_macos_menu(app)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            app_menu::emit_menu_event(app, event.id().as_ref());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
