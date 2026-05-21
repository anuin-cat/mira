import { convertFileSrc, invoke } from '@tauri-apps/api/core'

export interface VaultDirEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
}

export interface VaultFileInfo {
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  size: number
  mtime: number | null
}

/** 设置当前 vault 根目录，后续文件操作只接受 vault 相对路径 */
export async function setVaultRoot(path: string): Promise<void> {
  await invoke('vault_set_root', { path })
}

/** 判断 vault 相对路径是否存在 */
export async function pathExists(relativePath: string | null): Promise<boolean> {
  return await invoke<boolean>('vault_exists', { relativePath })
}

/** 获取 vault 相对路径信息，不存在时返回 null */
export async function getFileInfo(relativePath: string | null): Promise<VaultFileInfo | null> {
  return await invoke<VaultFileInfo | null>('vault_stat', { relativePath })
}

/** 读取 vault 相对目录实体，保留文件/目录/symlink 信息 */
export async function listEntries(relativePath: string | null): Promise<VaultDirEntry[]> {
  return await invoke<VaultDirEntry[]>('vault_read_dir', { relativePath })
}

/** 读取 vault 相对文本文件，不存在时返回 null */
export async function readFile(relativePath: string): Promise<string | null> {
  return await invoke<string | null>('vault_read_text', { relativePath })
}

/** 写入 vault 相对文本文件 */
export async function writeFile(relativePath: string, content: string): Promise<void> {
  await invoke('vault_write_text', { relativePath, content })
}

/** 写入 vault 相对二进制文件 */
export async function writeBinaryFile(relativePath: string, content: Uint8Array): Promise<void> {
  await invoke('vault_write_binary', { relativePath, content: Array.from(content) })
}

/** 确保 vault 相对目录存在（递归创建） */
export async function ensureDir(relativePath: string): Promise<void> {
  await invoke('vault_create_dir', { relativePath })
}

/** 移动或重命名 vault 相对文件/目录 */
export async function movePath(fromRelativePath: string, toRelativePath: string): Promise<void> {
  await invoke('vault_rename', { fromRelativePath, toRelativePath })
}

/** 删除 vault 相对文件或目录（不存在时静默忽略） */
export async function removePath(relativePath: string, recursive = false): Promise<void> {
  await invoke('vault_remove', { relativePath, recursive })
}

/** 在系统文件管理器中显示 vault 根目录或指定相对路径 */
export async function revealInFinder(relativePath: string | null): Promise<void> {
  await invoke('vault_reveal_in_finder', { relativePath })
}

/** 将 vault 相对路径转换为 WebView 可加载的 asset URL */
export async function getAssetFileSource(relativePath: string): Promise<string> {
  const filePath = await invoke<string>('vault_get_asset_file_path', { relativePath })
  return convertFileSrc(filePath)
}
