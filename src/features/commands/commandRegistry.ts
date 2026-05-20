import { getPlatformShortcut, type PlatformShortcut } from '../../lib/platform'

export type CommandGroup = 'file' | 'edit' | 'search' | 'navigate' | 'view' | 'ai' | 'app'

export type CommandId =
  | 'change-vault'
  | 'new-file'
  | 'new-folder'
  | 'save-file'
  | 'refresh-vault'
  | 'rename-entry'
  | 'delete-entry'
  | 'reveal-in-finder'
  | 'paste-and-match-style'
  | 'find-in-file'
  | 'find-next-in-file'
  | 'find-previous-in-file'
  | 'search-vault'
  | 'quick-open'
  | 'command-palette'
  | 'history-back'
  | 'history-forward'
  | 'toggle-file-sidebar'
  | 'toggle-ai-sidebar'
  | 'font-decrease'
  | 'font-increase'
  | 'font-reset'
  | 'font-small'
  | 'font-medium'
  | 'font-large'
  | 'font-xlarge'
  | 'theme-default'
  | 'theme-warm-paper'
  | 'theme-twilight'
  | 'theme-forest'
  | 'theme-dark-classic'
  | 'ai-new-chat'
  | 'ai-ask-current-note'
  | 'ai-stop-generating'
  | 'app-settings'

export interface CommandDefinition {
  id: CommandId
  title: string
  group: CommandGroup
  menuEvent?: string
  shortcut?: PlatformShortcut
}

export type WorkspaceMenuSubmenuId = 'font-size' | 'theme'

export type WorkspaceMenuEntry =
  | { type: 'command'; commandId: CommandId }
  | { type: 'submenu'; id: WorkspaceMenuSubmenuId; title: string; commandIds: CommandId[] }

export const COMMAND_DEFINITIONS: CommandDefinition[] = [
  { id: 'change-vault', title: '更换 Vault...', group: 'file', menuEvent: 'menu:change-vault', shortcut: { mac: '⌘O', windows: 'Ctrl+O' } },
  { id: 'new-file', title: '新建文件', group: 'file', menuEvent: 'menu:new-file', shortcut: { mac: '⌘N', windows: 'Ctrl+N' } },
  { id: 'new-folder', title: '新建文件夹', group: 'file', menuEvent: 'menu:new-folder', shortcut: { mac: '⇧⌘N', windows: 'Ctrl+Shift+N' } },
  { id: 'save-file', title: '保存当前文件', group: 'file', menuEvent: 'menu:save-file', shortcut: { mac: '⌘S', windows: 'Ctrl+S' } },
  { id: 'refresh-vault', title: '刷新 Vault', group: 'file', menuEvent: 'menu:refresh-vault', shortcut: { mac: '⌘R', windows: 'Ctrl+R' } },
  { id: 'rename-entry', title: '重命名', group: 'file', menuEvent: 'menu:rename-entry', shortcut: { mac: 'F2', windows: 'F2' } },
  { id: 'delete-entry', title: '删除', group: 'file', menuEvent: 'menu:delete-entry', shortcut: { mac: '⌘⌫', windows: 'Ctrl+Backspace' } },
  { id: 'reveal-in-finder', title: '在文件管理器中显示', group: 'file', menuEvent: 'menu:reveal-in-finder', shortcut: { mac: '⌥⌘R', windows: 'Ctrl+Alt+R' } },
  { id: 'paste-and-match-style', title: '粘贴并匹配样式', group: 'edit', menuEvent: 'menu:paste-and-match-style', shortcut: { mac: '⇧⌥⌘V', windows: 'Ctrl+Shift+V' } },
  { id: 'find-in-file', title: '当前文件内搜索', group: 'search', menuEvent: 'menu:find-in-file', shortcut: { mac: '⌘F', windows: 'Ctrl+F' } },
  { id: 'find-next-in-file', title: '查找下一个', group: 'search', menuEvent: 'menu:find-next-in-file', shortcut: { mac: '⌘G', windows: 'F3' } },
  { id: 'find-previous-in-file', title: '查找上一个', group: 'search', menuEvent: 'menu:find-previous-in-file', shortcut: { mac: '⇧⌘G', windows: 'Shift+F3' } },
  { id: 'search-vault', title: '全 Vault 搜索', group: 'search', menuEvent: 'menu:search-vault', shortcut: { mac: '⇧⌘F', windows: 'Ctrl+Shift+F' } },
  { id: 'quick-open', title: '快速打开文件', group: 'navigate', menuEvent: 'menu:quick-open', shortcut: { mac: '⌘P', windows: 'Ctrl+P' } },
  { id: 'command-palette', title: '命令面板', group: 'navigate', menuEvent: 'menu:command-palette', shortcut: { mac: '⇧⌘P', windows: 'Ctrl+Shift+P' } },
  { id: 'history-back', title: '返回上一个文件', group: 'navigate', menuEvent: 'menu:history-back', shortcut: { mac: '⌘[', windows: 'Ctrl+[' } },
  { id: 'history-forward', title: '前进到下一个文件', group: 'navigate', menuEvent: 'menu:history-forward', shortcut: { mac: '⌘]', windows: 'Ctrl+]' } },
  { id: 'toggle-file-sidebar', title: '显示/隐藏文件侧栏', group: 'view', menuEvent: 'menu:toggle-file-sidebar', shortcut: { mac: '⌘\\', windows: 'Ctrl+\\' } },
  { id: 'toggle-ai-sidebar', title: '显示/隐藏 AI 对话栏', group: 'view', menuEvent: 'menu:toggle-ai-sidebar', shortcut: { mac: '⌘L', windows: 'Ctrl+L' } },
  { id: 'font-decrease', title: '缩小字体', group: 'view', menuEvent: 'menu:font-decrease', shortcut: { mac: '⌘-', windows: 'Ctrl+-' } },
  { id: 'font-increase', title: '放大字体', group: 'view', menuEvent: 'menu:font-increase', shortcut: { mac: '⌘+', windows: 'Ctrl++' } },
  { id: 'font-reset', title: '重置字体大小', group: 'view', menuEvent: 'menu:font-reset', shortcut: { mac: '⌘0', windows: 'Ctrl+0' } },
  { id: 'font-small', title: '字体：小', group: 'view', menuEvent: 'menu:font-size-small' },
  { id: 'font-medium', title: '字体：中', group: 'view', menuEvent: 'menu:font-size-medium' },
  { id: 'font-large', title: '字体：大', group: 'view', menuEvent: 'menu:font-size-large' },
  { id: 'font-xlarge', title: '字体：特大', group: 'view', menuEvent: 'menu:font-size-xlarge' },
  { id: 'theme-default', title: '主题：默认', group: 'view', menuEvent: 'menu:theme-default' },
  { id: 'theme-warm-paper', title: '主题：纸质书页', group: 'view', menuEvent: 'menu:theme-warm-paper' },
  { id: 'theme-twilight', title: '主题：暮光蓝', group: 'view', menuEvent: 'menu:theme-twilight' },
  { id: 'theme-forest', title: '主题：森林绿', group: 'view', menuEvent: 'menu:theme-forest' },
  { id: 'theme-dark-classic', title: '主题：经典深色', group: 'view', menuEvent: 'menu:theme-dark-classic' },
  { id: 'ai-new-chat', title: '新建 AI 对话', group: 'ai', menuEvent: 'menu:ai-new-chat', shortcut: { mac: '⌥⌘N', windows: 'Ctrl+Alt+N' } },
  { id: 'ai-ask-current-note', title: '基于当前笔记提问', group: 'ai', menuEvent: 'menu:ai-ask-current-note', shortcut: { mac: '⌥⌘↩', windows: 'Ctrl+Alt+Enter' } },
  { id: 'ai-stop-generating', title: '停止 AI 生成', group: 'ai', shortcut: { mac: 'Esc', windows: 'Esc' } },
  { id: 'app-settings', title: '设置', group: 'app', menuEvent: 'menu:app-settings', shortcut: { mac: '⌘,', windows: 'Ctrl+,' } },
]

const workspaceCommand = (commandId: CommandId): WorkspaceMenuEntry => ({ type: 'command', commandId })

export const WORKSPACE_MENU_COMMAND_SECTIONS: WorkspaceMenuEntry[][] = [
  [workspaceCommand('new-file'), workspaceCommand('new-folder')],
  [workspaceCommand('change-vault'), workspaceCommand('refresh-vault'), workspaceCommand('reveal-in-finder')],
  [workspaceCommand('quick-open'), workspaceCommand('search-vault'), workspaceCommand('command-palette')],
  [
    { type: 'submenu', id: 'font-size', title: '字体大小', commandIds: ['font-small', 'font-medium', 'font-large', 'font-xlarge'] },
    {
      type: 'submenu',
      id: 'theme',
      title: '主题',
      commandIds: ['theme-default', 'theme-warm-paper', 'theme-twilight', 'theme-forest', 'theme-dark-classic'],
    },
  ],
  [workspaceCommand('ai-new-chat'), workspaceCommand('ai-ask-current-note')],
  [workspaceCommand('app-settings')],
]

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
