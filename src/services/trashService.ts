import type { TrashItem, VaultEntryKind } from '../domain/note'
import {
  ensureDir,
  getFileInfo,
  listEntries,
  movePath,
  pathExists,
  readFile,
  removePath,
  writeFile,
} from '../tauri/fs'
import {
  ATTACHMENTS_ROOT_DIR,
  getParentPath,
  joinRelativePath,
  MIRA_DIR,
  normalizeRelativePath,
  TRASH_ROOT_DIR,
} from './pathUtils'

export { TRASH_ROOT_DIR }

const TRASH_METADATA_FILE = '.mira-trash.json'
const TRASH_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const SAFE_TRASH_ITEM_ID_RE = /^[A-Za-z0-9_-]+$/
const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/
const RESERVED_ROOT_DIR_NAMES = new Set([MIRA_DIR, ATTACHMENTS_ROOT_DIR, TRASH_ROOT_DIR])

interface TrashMetadata {
  id: string
  originalPath: string
  kind: VaultEntryKind
  deletedAt: string
}

/** 拼接 vault 绝对路径与相对路径 */
function absoluteVaultPath(vaultPath: string, relativePath: string | null): string {
  const rootPath = vaultPath.replace(/\/+$/, '')
  return relativePath ? `${rootPath}/${relativePath}` : rootPath
}

/** 给回收站批次生成稳定可读且不会含冒号的目录名 */
function createTrashBatchId(date: Date): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  const millisecond = String(date.getMilliseconds()).padStart(3, '0')
  const randomSuffix = crypto.randomUUID?.().replace(/-/g, '').slice(0, 8) ?? Math.random().toString(36).slice(2, 10)

  return `${year}${month}${day}-${hour}${minute}${second}-${millisecond}-${randomSuffix}`
}

/** 判断路径是否落在 Mira 根保留目录内 */
function isReservedRootPath(relativePath: string): boolean {
  const rootName = normalizeRelativePath(relativePath).split('/').filter(Boolean)[0]
  return Boolean(rootName && RESERVED_ROOT_DIR_NAMES.has(rootName))
}

/** 校验并返回安全的 vault 相对路径 */
function getSafeVaultRelativePath(relativePath: string): string | null {
  if (relativePath.startsWith('/') || relativePath.startsWith('~') || WINDOWS_ABSOLUTE_PATH_RE.test(relativePath)) {
    return null
  }

  const normalizedPath = normalizeRelativePath(relativePath)
  if (!normalizedPath || isReservedRootPath(normalizedPath)) return null
  if (normalizedPath.split('/').some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    return null
  }
  return normalizedPath
}

/** 校验用户可移动到回收站的路径，避免误处理内部目录 */
function assertTrashablePath(relativePath: string): string {
  const normalizedPath = getSafeVaultRelativePath(relativePath)
  if (!normalizedPath) throw new Error('不能删除 Mira 保留目录或隐藏路径')
  return normalizedPath
}

/** 校验回收站批次 id，避免把任意路径传给永久删除或恢复 */
function assertTrashItemId(itemId: string): string {
  if (!SAFE_TRASH_ITEM_ID_RE.test(itemId)) throw new Error('回收站条目无效')
  return itemId
}

/** 计算删除时间对应的过期时间 */
function getTrashExpiresAt(deletedAt: string): string | null {
  const deletedDate = new Date(deletedAt)
  if (Number.isNaN(deletedDate.getTime())) return null
  return new Date(deletedDate.getTime() + TRASH_RETENTION_DAYS * DAY_MS).toISOString()
}

/** 读取并校验回收站元数据 */
async function readTrashMetadata(vaultPath: string, itemId: string): Promise<TrashMetadata | null> {
  if (!SAFE_TRASH_ITEM_ID_RE.test(itemId)) return null
  const raw = await readFile(absoluteVaultPath(vaultPath, joinRelativePath(TRASH_ROOT_DIR, itemId, TRASH_METADATA_FILE)))
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<TrashMetadata>
    if (parsed.id !== itemId) return null
    if (parsed.kind !== 'file' && parsed.kind !== 'directory') return null
    if (typeof parsed.originalPath !== 'string') return null
    const originalPath = getSafeVaultRelativePath(parsed.originalPath)
    if (!originalPath) return null
    if (!getTrashExpiresAt(String(parsed.deletedAt))) return null

    return {
      id: itemId,
      originalPath,
      kind: parsed.kind,
      deletedAt: String(parsed.deletedAt),
    }
  } catch {
    return null
  }
}

/** 把回收站元数据转换成 UI 可展示条目 */
function createTrashItem(metadata: TrashMetadata): TrashItem | null {
  const expiresAt = getTrashExpiresAt(metadata.deletedAt)
  if (!expiresAt) return null
  return { ...metadata, expiresAt }
}

/** 找到不会冲突的回收站批次目录 */
async function resolveAvailableTrashItemId(vaultPath: string, date: Date): Promise<string> {
  while (true) {
    const itemId = createTrashBatchId(date)
    const exists = await pathExists(absoluteVaultPath(vaultPath, joinRelativePath(TRASH_ROOT_DIR, itemId)))
    if (!exists) return itemId
  }
}

/** 将文件或文件夹移动到 vault/trash，并写入可恢复元数据 */
export async function moveEntryToTrash(
  vaultPath: string,
  relativePath: string,
  kind: VaultEntryKind
): Promise<TrashItem> {
  // 1. 校验来源路径和实体类型
  const normalizedPath = assertTrashablePath(relativePath)
  const sourceAbsPath = absoluteVaultPath(vaultPath, normalizedPath)
  const sourceInfo = await getFileInfo(sourceAbsPath)
  if (!sourceInfo) throw new Error('要删除的文件或文件夹不存在')
  if (kind === 'file' && !sourceInfo.isFile) throw new Error('要删除的路径不是文件')
  if (kind === 'directory' && !sourceInfo.isDirectory) throw new Error('要删除的路径不是文件夹')

  // 2. 创建回收站批次目录，并先写入元数据
  const deletedAt = new Date().toISOString()
  const itemId = await resolveAvailableTrashItemId(vaultPath, new Date(deletedAt))
  const itemDir = joinRelativePath(TRASH_ROOT_DIR, itemId)
  const targetPath = joinRelativePath(itemDir, normalizedPath)
  const targetParentPath = getParentPath(targetPath)
  if (targetParentPath) await ensureDir(absoluteVaultPath(vaultPath, targetParentPath))

  const metadata: TrashMetadata = { id: itemId, originalPath: normalizedPath, kind, deletedAt }
  await writeFile(
    absoluteVaultPath(vaultPath, joinRelativePath(itemDir, TRASH_METADATA_FILE)),
    JSON.stringify(metadata, null, 2)
  )

  // 3. 移动原始内容；失败时移除空批次，避免留下不可恢复条目
  try {
    await movePath(sourceAbsPath, absoluteVaultPath(vaultPath, targetPath))
  } catch (error) {
    await removePath(absoluteVaultPath(vaultPath, itemDir), true)
    throw error
  }

  const item = createTrashItem(metadata)
  if (!item) throw new Error('回收站元数据无效')
  return item
}

/** 列出仍有有效元数据和内容的回收站条目 */
export async function listTrashItems(vaultPath: string): Promise<TrashItem[]> {
  // 1. 只读取 trash 根目录下一层批次目录
  const entries = await listEntries(absoluteVaultPath(vaultPath, TRASH_ROOT_DIR))
  const items: TrashItem[] = []

  // 2. 元数据无效或内容丢失的目录不显示，也不自动删除
  for (const entry of entries) {
    if (!entry.name || !entry.isDirectory || entry.isSymlink) continue
    const metadata = await readTrashMetadata(vaultPath, entry.name)
    const item = metadata ? createTrashItem(metadata) : null
    if (!item) continue

    const contentExists = await pathExists(
      absoluteVaultPath(vaultPath, joinRelativePath(TRASH_ROOT_DIR, item.id, item.originalPath))
    )
    if (contentExists) items.push(item)
  }

  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/** 从回收站恢复条目，恢复时不覆盖原路径已有内容 */
export async function restoreTrashItem(vaultPath: string, itemId: string): Promise<TrashItem> {
  // 1. 读取元数据并检查来源、目标路径
  const metadata = await readTrashMetadata(vaultPath, itemId)
  const item = metadata ? createTrashItem(metadata) : null
  if (!metadata || !item) throw new Error('回收站条目不存在或已损坏')

  const sourcePath = joinRelativePath(TRASH_ROOT_DIR, metadata.id, metadata.originalPath)
  const sourceAbsPath = absoluteVaultPath(vaultPath, sourcePath)
  const sourceExists = await pathExists(sourceAbsPath)
  if (!sourceExists) throw new Error('回收站内容不存在')

  const targetAbsPath = absoluteVaultPath(vaultPath, metadata.originalPath)
  const targetExists = await pathExists(targetAbsPath)
  if (targetExists) throw new Error('原位置已有同名文件或文件夹，无法恢复')

  // 2. 自动补齐原父目录，然后移动回原路径
  const targetParentPath = getParentPath(metadata.originalPath)
  if (targetParentPath) await ensureDir(absoluteVaultPath(vaultPath, targetParentPath))
  await movePath(sourceAbsPath, targetAbsPath)

  // 3. 清理回收站批次目录中残留的空父目录和元数据
  await removePath(absoluteVaultPath(vaultPath, joinRelativePath(TRASH_ROOT_DIR, metadata.id)), true)
  return item
}

/** 永久删除单个回收站批次 */
export async function deleteTrashItem(vaultPath: string, itemId: string): Promise<void> {
  const safeItemId = assertTrashItemId(itemId)
  await removePath(absoluteVaultPath(vaultPath, joinRelativePath(TRASH_ROOT_DIR, safeItemId)), true)
}

/** 清理超过保留期且元数据有效的回收站条目 */
export async function cleanupExpiredTrash(vaultPath: string): Promise<void> {
  // 1. 只清理可识别条目，避免误删用户手动放入 trash 的未知内容
  const now = Date.now()
  const items = await listTrashItems(vaultPath)

  // 2. 到期即删除整个批次目录
  await Promise.all(
    items
      .filter((item) => new Date(item.expiresAt).getTime() <= now)
      .map((item) => deleteTrashItem(vaultPath, item.id))
  )
}
