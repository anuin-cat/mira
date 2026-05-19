/** 判断当前运行环境是否为 macOS，用于展示平台相关文案与快捷键 */
export function isMacOSPlatform() {
  return navigator.userAgent.toLowerCase().includes('mac')
}

export interface PlatformShortcut {
  mac: string
  windows: string
}

/** 按当前平台选择展示给用户看的快捷键标签 */
export function getPlatformShortcut(shortcut: PlatformShortcut | undefined) {
  if (!shortcut) return undefined
  return isMacOSPlatform() ? shortcut.mac : shortcut.windows
}

