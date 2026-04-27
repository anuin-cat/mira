export type CommandGroup = 'file' | 'search' | 'navigate' | 'view' | 'ai' | 'app'

export type CommandId =
  | 'change-vault'
  | 'new-file'
  | 'new-folder'
  | 'save-file'
  | 'refresh-vault'
  | 'rename-entry'
  | 'delete-entry'
  | 'reveal-in-finder'
  | 'update-mira-map'
  | 'find-in-file'
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
  | 'app-settings'

export interface CommandDefinition {
  id: CommandId
  title: string
  group: CommandGroup
  menuEvent?: string
  shortcut?: string
}

export const COMMAND_DEFINITIONS: CommandDefinition[] = [
  { id: 'change-vault', title: '更换 Vault...', group: 'file', menuEvent: 'menu:change-vault' },
  { id: 'new-file', title: '新建文件', group: 'file', menuEvent: 'menu:new-file', shortcut: '⌘N' },
  { id: 'new-folder', title: '新建文件夹', group: 'file', menuEvent: 'menu:new-folder', shortcut: '⇧⌘N' },
  { id: 'save-file', title: '保存当前文件', group: 'file', menuEvent: 'menu:save-file', shortcut: '⌘S' },
  { id: 'refresh-vault', title: '刷新 Vault', group: 'file', menuEvent: 'menu:refresh-vault', shortcut: '⌘R' },
  { id: 'rename-entry', title: '重命名', group: 'file', menuEvent: 'menu:rename-entry', shortcut: 'F2' },
  { id: 'delete-entry', title: '删除', group: 'file', menuEvent: 'menu:delete-entry', shortcut: '⌘⌫' },
  { id: 'reveal-in-finder', title: '在 Finder 中显示', group: 'file', menuEvent: 'menu:reveal-in-finder', shortcut: '⌥⌘R' },
  { id: 'update-mira-map', title: '更新 Mira Map', group: 'file', menuEvent: 'menu:update-mira-map', shortcut: '⇧⌘M' },
  { id: 'find-in-file', title: '当前文件内搜索', group: 'search', menuEvent: 'menu:find-in-file', shortcut: '⌘F' },
  { id: 'search-vault', title: '全 Vault 搜索', group: 'search', menuEvent: 'menu:search-vault', shortcut: '⇧⌘F' },
  { id: 'quick-open', title: '快速打开文件', group: 'navigate', menuEvent: 'menu:quick-open', shortcut: '⌘P' },
  { id: 'command-palette', title: '命令面板', group: 'navigate', menuEvent: 'menu:command-palette', shortcut: '⇧⌘P' },
  { id: 'history-back', title: '返回上一个文件', group: 'navigate', menuEvent: 'menu:history-back', shortcut: '⌘[' },
  { id: 'history-forward', title: '前进到下一个文件', group: 'navigate', menuEvent: 'menu:history-forward', shortcut: '⌘]' },
  { id: 'toggle-file-sidebar', title: '显示/隐藏文件侧栏', group: 'view', menuEvent: 'menu:toggle-file-sidebar', shortcut: '⌘\\' },
  { id: 'toggle-ai-sidebar', title: '显示/隐藏 AI 对话栏', group: 'view', menuEvent: 'menu:toggle-ai-sidebar', shortcut: '⌘L' },
  { id: 'font-decrease', title: '缩小字体', group: 'view', menuEvent: 'menu:font-decrease', shortcut: '⌘-' },
  { id: 'font-increase', title: '放大字体', group: 'view', menuEvent: 'menu:font-increase', shortcut: '⌘=' },
  { id: 'font-reset', title: '重置字体大小', group: 'view', menuEvent: 'menu:font-reset', shortcut: '⌘0' },
  { id: 'font-small', title: '字体：小', group: 'view', menuEvent: 'menu:font-size-small' },
  { id: 'font-medium', title: '字体：中', group: 'view', menuEvent: 'menu:font-size-medium' },
  { id: 'font-large', title: '字体：大', group: 'view', menuEvent: 'menu:font-size-large' },
  { id: 'font-xlarge', title: '字体：特大', group: 'view', menuEvent: 'menu:font-size-xlarge' },
  { id: 'theme-default', title: '主题：默认', group: 'view', menuEvent: 'menu:theme-default' },
  { id: 'theme-warm-paper', title: '主题：纸质书页', group: 'view', menuEvent: 'menu:theme-warm-paper' },
  { id: 'theme-twilight', title: '主题：暮光蓝', group: 'view', menuEvent: 'menu:theme-twilight' },
  { id: 'theme-forest', title: '主题：森林绿', group: 'view', menuEvent: 'menu:theme-forest' },
  { id: 'theme-dark-classic', title: '主题：经典深色', group: 'view', menuEvent: 'menu:theme-dark-classic' },
  { id: 'ai-new-chat', title: '新建 AI 对话', group: 'ai', menuEvent: 'menu:ai-new-chat', shortcut: '⌥⌘N' },
  { id: 'ai-ask-current-note', title: '基于当前笔记提问', group: 'ai', menuEvent: 'menu:ai-ask-current-note', shortcut: '⌥⌘↩' },
  { id: 'app-settings', title: '设置', group: 'app', menuEvent: 'menu:app-settings', shortcut: '⌘,' },
]

export const COMMAND_MENU_EVENTS = COMMAND_DEFINITIONS.flatMap((command) =>
  command.menuEvent ? [command.menuEvent] : []
)

/** 按菜单事件查找命令 id */
export function getCommandIdByMenuEvent(menuEvent: string): CommandId | null {
  return COMMAND_DEFINITIONS.find((command) => command.menuEvent === menuEvent)?.id ?? null
}

/** 过滤命令面板候选项 */
export function filterCommands(query: string, commands = COMMAND_DEFINITIONS): CommandDefinition[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return commands

  return commands.filter((command) => {
    const haystack = `${command.title} ${command.shortcut ?? ''} ${command.id}`.toLocaleLowerCase()
    return haystack.includes(normalizedQuery)
  })
}
