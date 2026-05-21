import { listen } from '@tauri-apps/api/event'

export type AppMenuUnlisten = () => void | Promise<void>

/** 监听 Rust 原生菜单派发到前端的应用命令事件 */
export async function listenAppMenuEvent(
  menuEvent: string,
  handler: () => void
): Promise<AppMenuUnlisten> {
  return await listen(menuEvent, handler)
}
