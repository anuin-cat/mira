import { getCurrentWindow } from '@tauri-apps/api/window'

/** 开始原生窗口拖动，用于自定义标题栏空白区域 */
export async function startWindowDrag(): Promise<void> {
  await getCurrentWindow().startDragging()
}

/** 切换窗口最大化状态，用于保留自定义标题栏双击体验 */
export async function toggleWindowMaximize(): Promise<void> {
  await getCurrentWindow().toggleMaximize()
}
