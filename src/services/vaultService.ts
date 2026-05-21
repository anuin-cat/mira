import { selectDirectory } from '../tauri/fs'
import { ensureDir, pathExists, readFile, setVaultRoot, writeFile } from '../tauri/vaultFs'
import type { FontSize, VaultState } from '../domain/note'
import { MIRA_DIR } from './pathUtils'
import { normalizeTreeOrder } from './treeOrderService'

const VAULT_PATH_KEY = 'mira:vaultPath'
const STATE_FILE = `${MIRA_DIR}/state.json`

const DEFAULT_VAULT_STATE: VaultState = {
  version: 1,
  lastOpenedPath: null,
  expandedDirs: [],
  treeOrder: {},
  fontSize: 'medium',
}

/** 判断配置中的字体大小是否为支持值 */
function isFontSize(value: unknown): value is FontSize {
  return value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge'
}

/** 获取已保存的 vault 路径（来自 localStorage） */
export function getVaultPath(): string | null {
  return localStorage.getItem(VAULT_PATH_KEY)
}

/** 持久化 vault 路径 */
export function setVaultPath(path: string): void {
  localStorage.setItem(VAULT_PATH_KEY, path)
}

/** 初始化 vault 内部状态目录，用户内容目录不由 Mira 创建 */
export async function ensureVaultSystem(vaultPath: string): Promise<void> {
  await setVaultRoot(vaultPath)
  await ensureDir(MIRA_DIR)
}

/** 读取 .mira/state.json，不存在或损坏时返回默认状态 */
export async function readVaultState(_vaultPath: string): Promise<VaultState> {
  const raw = await readFile(STATE_FILE)
  if (!raw) return { ...DEFAULT_VAULT_STATE }

  try {
    const parsed = JSON.parse(raw) as Partial<VaultState>
    return {
      version: 1,
      lastOpenedPath: typeof parsed.lastOpenedPath === 'string' ? parsed.lastOpenedPath : null,
      expandedDirs: Array.isArray(parsed.expandedDirs)
        ? parsed.expandedDirs.filter((path): path is string => typeof path === 'string')
        : [],
      treeOrder: normalizeTreeOrder(parsed.treeOrder),
      fontSize: isFontSize(parsed.fontSize) ? parsed.fontSize : DEFAULT_VAULT_STATE.fontSize,
    }
  } catch {
    return { ...DEFAULT_VAULT_STATE }
  }
}

/** 写入可丢弃 UI 状态，.mira 被删除时会自动重建 */
export async function writeVaultState(_vaultPath: string, state: VaultState): Promise<void> {
  const dirExists = await pathExists(MIRA_DIR)
  if (!dirExists) await ensureDir(MIRA_DIR)
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}

/** 弹出目录选择框，保存路径并初始化内部状态 */
export async function setupVault(): Promise<string | null> {
  const path = await selectDirectory('选择 Mira Vault 目录')
  if (!path) return null
  await ensureVaultSystem(path)
  setVaultPath(path)
  return path
}
