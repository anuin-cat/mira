use serde::Deserialize;
use std::{collections::HashMap, error::Error};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager, Runtime,
};

const APP_COMMAND_MANIFEST: &str =
    include_str!("../../src/features/commands/appCommandManifest.json");

type AppMenuResult<T> = Result<T, Box<dyn Error>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandManifest {
    commands: Vec<CommandDefinition>,
    native_menus: Vec<NativeMenuDefinition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandDefinition {
    id: String,
    title: String,
    menu_event: Option<String>,
    native: Option<NativeCommandItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeCommandItem {
    item_id: String,
    label: Option<String>,
    accelerator: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeMenuDefinition {
    title: String,
    sections: Vec<Vec<NativeMenuEntry>>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum NativeMenuEntry {
    Command {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    Predefined {
        value: String,
    },
    Submenu {
        title: String,
        sections: Vec<Vec<NativeMenuEntry>>,
    },
}

/** 读取共享命令清单，前端命令面板与 macOS 原生菜单都以它为唯一来源 */
fn load_manifest() -> AppMenuResult<CommandManifest> {
    Ok(serde_json::from_str(APP_COMMAND_MANIFEST)?)
}

/** 构建命令 id 到命令定义的索引 */
fn create_command_map(manifest: &CommandManifest) -> HashMap<&str, &CommandDefinition> {
    manifest
        .commands
        .iter()
        .map(|command| (command.id.as_str(), command))
        .collect()
}

/** 追加一组菜单分区，分区之间自动插入原生分隔线 */
fn append_sections<R, M>(
    manager: &M,
    menu: &Submenu<R>,
    command_map: &HashMap<&str, &CommandDefinition>,
    sections: &[Vec<NativeMenuEntry>],
) -> AppMenuResult<()>
where
    R: Runtime,
    M: Manager<R>,
{
    for (section_index, section) in sections.iter().enumerate() {
        if section_index > 0 {
            let separator = PredefinedMenuItem::separator(manager)?;
            menu.append(&separator)?;
        }

        for entry in section {
            append_entry(manager, menu, command_map, entry)?;
        }
    }

    Ok(())
}

/** 追加单个菜单项，可递归处理子菜单 */
fn append_entry<R, M>(
    manager: &M,
    menu: &Submenu<R>,
    command_map: &HashMap<&str, &CommandDefinition>,
    entry: &NativeMenuEntry,
) -> AppMenuResult<()>
where
    R: Runtime,
    M: Manager<R>,
{
    match entry {
        NativeMenuEntry::Command { command_id } => {
            append_command_item(manager, menu, command_map, command_id)
        }
        NativeMenuEntry::Predefined { value } => append_predefined_item(manager, menu, value),
        NativeMenuEntry::Submenu { title, sections } => {
            let submenu = Submenu::new(manager, title, true)?;
            append_sections(manager, &submenu, command_map, sections)?;
            menu.append(&submenu)?;
            Ok(())
        }
    }
}

/** 从共享命令定义创建原生菜单命令项 */
fn append_command_item<R, M>(
    manager: &M,
    menu: &Submenu<R>,
    command_map: &HashMap<&str, &CommandDefinition>,
    command_id: &str,
) -> AppMenuResult<()>
where
    R: Runtime,
    M: Manager<R>,
{
    let command = command_map
        .get(command_id)
        .ok_or_else(|| format!("原生菜单引用了未知命令：{command_id}"))?;
    let native = command
        .native
        .as_ref()
        .ok_or_else(|| format!("命令缺少原生菜单配置：{command_id}"))?;
    let label = native.label.as_deref().unwrap_or(command.title.as_str());
    let item = MenuItem::with_id(
        manager,
        native.item_id.as_str(),
        label,
        true,
        native.accelerator.as_deref(),
    )?;
    menu.append(&item)?;
    Ok(())
}

/** 追加系统预定义菜单项，保留 macOS 原生编辑和窗口行为 */
fn append_predefined_item<R, M>(manager: &M, menu: &Submenu<R>, value: &str) -> AppMenuResult<()>
where
    R: Runtime,
    M: Manager<R>,
{
    let item = match value {
        "undo" => PredefinedMenuItem::undo(manager, None::<&str>)?,
        "redo" => PredefinedMenuItem::redo(manager, None::<&str>)?,
        "cut" => PredefinedMenuItem::cut(manager, None::<&str>)?,
        "copy" => PredefinedMenuItem::copy(manager, None::<&str>)?,
        "paste" => PredefinedMenuItem::paste(manager, None::<&str>)?,
        "selectAll" => PredefinedMenuItem::select_all(manager, None::<&str>)?,
        "hide" => PredefinedMenuItem::hide(manager, None::<&str>)?,
        "hideOthers" => PredefinedMenuItem::hide_others(manager, None::<&str>)?,
        "showAll" => PredefinedMenuItem::show_all(manager, None::<&str>)?,
        "quit" => PredefinedMenuItem::quit(manager, None::<&str>)?,
        "minimize" => PredefinedMenuItem::minimize(manager, None::<&str>)?,
        "fullscreen" => PredefinedMenuItem::fullscreen(manager, None::<&str>)?,
        _ => return Err(format!("不支持的原生菜单预定义项：{value}").into()),
    };
    menu.append(&item)?;
    Ok(())
}

/** 根据共享命令清单安装 macOS 原生菜单 */
pub fn install_macos_menu(app: &mut tauri::App) -> AppMenuResult<()> {
    let manifest = load_manifest()?;
    let command_map = create_command_map(&manifest);
    let menu = Menu::new(app)?;

    for native_menu in &manifest.native_menus {
        let submenu = Submenu::new(app, &native_menu.title, true)?;
        append_sections(app, &submenu, &command_map, &native_menu.sections)?;
        menu.append(&submenu)?;
    }

    app.set_menu(menu)?;
    Ok(())
}

/** 菜单点击时按共享命令清单查找前端事件并发送 */
pub fn emit_menu_event(app: &tauri::AppHandle, item_id: &str) {
    let Ok(manifest) = load_manifest() else {
        return;
    };

    let event_name = manifest.commands.iter().find_map(|command| {
        let native = command.native.as_ref()?;
        if native.item_id == item_id {
            command.menu_event.as_deref()
        } else {
            None
        }
    });

    if let Some(event_name) = event_name {
        let _ = app.emit(event_name, ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /** 递归校验原生菜单引用的命令都存在且有 native 配置 */
    fn assert_native_entries_are_valid(
        command_map: &HashMap<&str, &CommandDefinition>,
        entries: &[NativeMenuEntry],
    ) {
        for entry in entries {
            match entry {
                NativeMenuEntry::Command { command_id } => {
                    let command = command_map
                        .get(command_id.as_str())
                        .unwrap_or_else(|| panic!("未知命令：{command_id}"));
                    assert!(
                        command.native.is_some(),
                        "命令缺少 native 配置：{command_id}"
                    );
                    assert!(
                        command.menu_event.is_some(),
                        "原生菜单命令缺少 menuEvent：{command_id}"
                    );
                }
                NativeMenuEntry::Submenu { sections, .. } => {
                    for section in sections {
                        assert_native_entries_are_valid(command_map, section);
                    }
                }
                NativeMenuEntry::Predefined { .. } => {}
            }
        }
    }

    #[test]
    fn native_menu_references_are_valid() {
        let manifest = load_manifest().expect("命令清单应可解析");
        let command_map = create_command_map(&manifest);

        for native_menu in &manifest.native_menus {
            for section in &native_menu.sections {
                assert_native_entries_are_valid(&command_map, section);
            }
        }
    }

    #[test]
    fn command_ids_and_native_item_ids_are_unique() {
        let manifest = load_manifest().expect("命令清单应可解析");
        let mut command_ids = HashSet::new();
        let mut native_item_ids = HashSet::new();

        for command in &manifest.commands {
            assert!(
                command_ids.insert(&command.id),
                "命令 id 重复：{}",
                command.id
            );
            if let Some(native) = &command.native {
                assert!(
                    native_item_ids.insert(&native.item_id),
                    "原生菜单 itemId 重复：{}",
                    native.item_id
                );
            }
        }
    }
}
