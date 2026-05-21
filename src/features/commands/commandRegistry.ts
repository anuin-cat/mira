import { getPlatformShortcut, type PlatformShortcut } from '../../lib/platform'
import commandManifest from './appCommandManifest.json'

export type CommandGroup = 'file' | 'edit' | 'search' | 'navigate' | 'view' | 'ai' | 'app'
export type CommandId = string

export interface CommandDefinition {
  id: CommandId
  title: string
  group: CommandGroup
  menuEvent?: string
  shortcut?: PlatformShortcut
}

export type WorkspaceMenuSubmenuId = string

export type WorkspaceMenuEntry =
  | { type: 'command'; commandId: CommandId }
  | { type: 'submenu'; id: WorkspaceMenuSubmenuId; title: string; commandIds: CommandId[] }

interface CommandManifest {
  commands: CommandDefinition[]
  workspaceMenuSections: WorkspaceMenuEntry[][]
}

const APP_COMMAND_MANIFEST = commandManifest as CommandManifest

export const COMMAND_DEFINITIONS: CommandDefinition[] = APP_COMMAND_MANIFEST.commands.map((command) => ({
  id: command.id,
  title: command.title,
  group: command.group,
  menuEvent: command.menuEvent,
  shortcut: command.shortcut,
}))

export const WORKSPACE_MENU_COMMAND_SECTIONS: WorkspaceMenuEntry[][] = APP_COMMAND_MANIFEST.workspaceMenuSections

export const COMMAND_MENU_EVENTS = COMMAND_DEFINITIONS.flatMap((command) =>
  command.menuEvent ? [command.menuEvent] : []
)

/** 按菜单事件查找命令 id */
export function getCommandIdByMenuEvent(menuEvent: string): CommandId | null {
  return COMMAND_DEFINITIONS.find((command) => command.menuEvent === menuEvent)?.id ?? null
}

/** 按命令 id 查找命令定义，供工作区菜单等非搜索入口复用 */
export function getCommandDefinition(commandId: CommandId) {
  return COMMAND_DEFINITIONS.find((command) => command.id === commandId) ?? null
}

/** 按当前平台返回命令面板中展示的快捷键 */
export function getCommandShortcut(command: CommandDefinition) {
  return getPlatformShortcut(command.shortcut)
}

/** 汇总命令的所有平台快捷键，保证搜索时 macOS 与 Windows 写法都能命中 */
function getCommandShortcutSearchText(command: CommandDefinition) {
  if (!command.shortcut) return ''
  return `${command.shortcut.mac} ${command.shortcut.windows}`
}

/** 过滤命令面板候选项 */
export function filterCommands(query: string, commands = COMMAND_DEFINITIONS): CommandDefinition[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return commands

  return commands.filter((command) => {
    const haystack = `${command.title} ${getCommandShortcutSearchText(command)} ${command.id}`.toLocaleLowerCase()
    return haystack.includes(normalizedQuery)
  })
}
