import { ensureDir, selectDirectory } from '../tauri/fs'

const VAULT_PATH_KEY = 'mira:vaultPath'

/** 获取已保存的 vault 路径（来自 localStorage） */
export function getVaultPath(): string | null {
  return localStorage.getItem(VAULT_PATH_KEY)
}

/** 持久化 vault 路径 */
export function setVaultPath(path: string): void {
  localStorage.setItem(VAULT_PATH_KEY, path)
}

/** 初始化 vault 目录结构（确保所有子目录存在） */
export async function ensureVaultDirs(vaultPath: string): Promise<void> {
  await Promise.all([
    ensureDir(`${vaultPath}/notes`),
    ensureDir(`${vaultPath}/meta`),
    ensureDir(`${vaultPath}/reflections`),
    ensureDir(`${vaultPath}/indexes`),
    ensureDir(`${vaultPath}/attachments`),
    ensureDir(`${vaultPath}/config`),
  ])
}

/** 弹出目录选择框，保存路径并初始化目录结构 */
export async function setupVault(): Promise<string | null> {
  const path = await selectDirectory('选择 Mira Vault 目录')
  if (!path) return null
  setVaultPath(path)
  await ensureVaultDirs(path)
  return path
}
