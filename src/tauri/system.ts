import { invoke } from '@tauri-apps/api/core'

/** 弹出系统目录选择框，具体系统能力由 Rust 统一审查 */
export async function pickDirectory(title: string): Promise<string | null> {
  return await invoke<string | null>('system_pick_directory', { title })
}

/** 打开外部链接，协议白名单由 Rust 统一审查 */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke('system_open_external_url', { url })
}
