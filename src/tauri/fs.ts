import { open } from '@tauri-apps/plugin-dialog'

/** 弹出系统目录选择框 */
export async function selectDirectory(title: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title })
  return typeof result === 'string' ? result : null
}
