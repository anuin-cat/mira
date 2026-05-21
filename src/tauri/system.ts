import { invoke } from '@tauri-apps/api/core'

export type SystemMessageKind = 'info' | 'warning' | 'error'

interface SystemMessageOptions {
  title?: string
  kind?: SystemMessageKind
}

interface SystemConfirmOptions extends SystemMessageOptions {
  confirmLabel?: string
  cancelLabel?: string
}

/** 弹出系统目录选择框，具体系统能力由 Rust 统一审查 */
export async function pickDirectory(title: string): Promise<string | null> {
  return await invoke<string | null>('system_pick_directory', { title })
}

/** 弹出系统消息框，具体系统能力由 Rust 统一审查 */
export async function showSystemMessage(message: string, options: SystemMessageOptions = {}): Promise<void> {
  await invoke('system_show_message', {
    request: {
      message,
      title: options.title,
      kind: options.kind ?? 'info',
    },
  })
}

/** 弹出系统确认框，具体系统能力由 Rust 统一审查 */
export async function confirmSystemAction(message: string, options: SystemConfirmOptions = {}): Promise<boolean> {
  return await invoke<boolean>('system_confirm', {
    request: {
      message,
      title: options.title,
      kind: options.kind ?? 'warning',
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
    },
  })
}

/** 打开外部链接，协议白名单由 Rust 统一审查 */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke('system_open_external_url', { url })
}
