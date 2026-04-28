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
import type { Note, NoteMeta, VaultEntryKind, VaultTreeNode, VaultTreeOrder } from '../domain/note'
import {
  getBaseName,
  getDisplayName,
  getParentPath,
  isPathInsideDirectory,
  joinRelativePath,
  MARKDOWN_EXTENSION,
  normalizeMarkdownFileName,
  normalizeRelativePath,
  replacePathPrefix,
  stripMarkdownExtension,
  validateUserRelativePath,
} from './pathUtils'
import { getTreeOrderParentKey } from './treeOrderService'

const UNTITLED_FILE_BASE = '未命名'
const UNTITLED_DIR_BASE = '新建文件夹'
const LEGACY_MIRA_MAP_FILE = 'Mira Map.md'

/** 拼接 vault 绝对路径与相对路径 */
function absoluteVaultPath(vaultPath: string, relativePath: string | null): string {
  return relativePath ? `${vaultPath}/${relativePath}` : vaultPath
}

/** 将 Date-like 值转成 ISO 字符串 */
function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** 判断目录实体是否需要从用户文件树中隐藏 */
function shouldSkipEntry(relativeDir: string | null, name: string): boolean {
  return name.startsWith('.') || (!relativeDir && name === LEGACY_MIRA_MAP_FILE)
}

/** 按人类文件管理器心智排序：文件夹优先，其余按名称排序 */
function compareNodesByDefault(a: VaultTreeNode, b: VaultTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
}

/** 按 .mira 中保存的同类型顺序排序；文件夹始终显示在文件上方 */
function sortNodes(
  nodes: VaultTreeNode[],
  relativeDir: string | null,
  treeOrder: VaultTreeOrder
): VaultTreeNode[] {
  const defaultSortedNodes = [...nodes].sort(compareNodesByDefault)
  const orderedPaths = treeOrder[getTreeOrderParentKey(relativeDir)] ?? []
  if (orderedPaths.length === 0) return defaultSortedNodes

  const orderIndex = new Map(orderedPaths.map((path, index) => [path, index]))
  return defaultSortedNodes.sort((a, b) => {
    if (a.kind !== b.kind) return compareNodesByDefault(a, b)

    const aIndex = orderIndex.get(a.path)
    const bIndex = orderIndex.get(b.path)
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex
    if (aIndex !== undefined) return -1
    if (bIndex !== undefined) return 1
    return compareNodesByDefault(a, b)
  })
}

/** 扫描目录并生成文件树节点 */
async function scanDirectory(
  vaultPath: string,
  relativeDir: string | null,
  treeOrder: VaultTreeOrder
): Promise<VaultTreeNode[]> {
  const entries = await listEntries(absoluteVaultPath(vaultPath, relativeDir))
  const nodes: VaultTreeNode[] = []

  for (const entry of entries) {
    if (!entry.name || entry.isSymlink || shouldSkipEntry(relativeDir, entry.name)) continue
    const relativePath = joinRelativePath(relativeDir, entry.name)

    if (entry.isDirectory) {
      const info = await getFileInfo(absoluteVaultPath(vaultPath, relativePath))
      nodes.push({
        id: relativePath,
        path: relativePath,
        name: entry.name,
        kind: 'directory',
        updatedAt: toIsoString(info?.mtime),
        sizeBytes: null,
        children: await scanDirectory(vaultPath, relativePath, treeOrder),
      })
      continue
    }

    if (entry.isFile && entry.name.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
      const info = await getFileInfo(absoluteVaultPath(vaultPath, relativePath))
      nodes.push({
        id: relativePath,
        path: relativePath,
        name: stripMarkdownExtension(entry.name),
        kind: 'file',
        updatedAt: toIsoString(info?.mtime),
        sizeBytes: info?.size ?? null,
      })
    }
  }

  return sortNodes(nodes, relativeDir, treeOrder)
}

/** 扫描 vault 下所有可见目录和 Markdown 文件 */
export async function scanVaultTree(
  vaultPath: string,
  treeOrder: VaultTreeOrder = {}
): Promise<VaultTreeNode[]> {
  return await scanDirectory(vaultPath, null, treeOrder)
}

/** 读取 Markdown 文件 */
export async function readNote(vaultPath: string, relativePath: string): Promise<Note | null> {
  const content = await readFile(absoluteVaultPath(vaultPath, relativePath))
  if (content === null) return null

  const info = await getFileInfo(absoluteVaultPath(vaultPath, relativePath))
  const meta: NoteMeta = {
    path: relativePath,
    title: getDisplayName(relativePath, 'file'),
    updatedAt: toIsoString(info?.mtime),
  }

  return { meta, content }
}

/** 只读取 Markdown 正文内容，用于搜索等不需要元数据的路径 */
export async function readNoteContent(vaultPath: string, relativePath: string): Promise<string | null> {
  return await readFile(absoluteVaultPath(vaultPath, relativePath))
}

/** 保存 Markdown 文件内容 */
export async function saveNote(vaultPath: string, relativePath: string, content: string): Promise<NoteMeta> {
  await writeFile(absoluteVaultPath(vaultPath, relativePath), content)
  const info = await getFileInfo(absoluteVaultPath(vaultPath, relativePath))
  return {
    path: relativePath,
    title: getDisplayName(relativePath, 'file'),
    updatedAt: toIsoString(info?.mtime),
  }
}

/** 找到 parentDir 下不会冲突的默认文件/文件夹路径 */
async function nextAvailablePath(
  vaultPath: string,
  parentDir: string | null,
  baseName: string,
  kind: VaultEntryKind
): Promise<string> {
  let index = 1

  while (true) {
    const name = index === 1 ? baseName : `${baseName} ${index}`
    const entryName = kind === 'file' ? `${name}${MARKDOWN_EXTENSION}` : name
    const relativePath = joinRelativePath(parentDir, entryName)
    const exists = await pathExists(absoluteVaultPath(vaultPath, relativePath))
    if (!exists) return relativePath
    index += 1
  }
}

/** 创建一个空 Markdown 文件，返回相对路径 */
export async function createMarkdownFile(vaultPath: string, parentDir: string | null): Promise<string> {
  const relativePath = await nextAvailablePath(vaultPath, parentDir, UNTITLED_FILE_BASE, 'file')
  const normalizedPath = normalizeRelativePath(relativePath)
  validateUserRelativePath(normalizedPath, 'file')

  const parentPath = getParentPath(normalizedPath)
  if (parentPath) await ensureDir(absoluteVaultPath(vaultPath, parentPath))
  await writeFile(absoluteVaultPath(vaultPath, normalizedPath), '')
  return normalizedPath
}

/** 创建文件夹，返回相对路径 */
export async function createFolder(vaultPath: string, parentDir: string | null): Promise<string> {
  const relativePath = await nextAvailablePath(vaultPath, parentDir, UNTITLED_DIR_BASE, 'directory')
  const normalizedPath = normalizeRelativePath(relativePath)
  validateUserRelativePath(normalizedPath, 'directory')

  await ensureDir(absoluteVaultPath(vaultPath, normalizedPath))
  return normalizedPath
}

/** 重命名文件或文件夹，返回新的相对路径 */
export async function renameEntry(
  vaultPath: string,
  relativePath: string,
  newName: string,
  kind: VaultEntryKind
): Promise<string> {
  const parentPath = getParentPath(relativePath)
  const entryName = kind === 'file' ? normalizeMarkdownFileName(newName) : newName.trim()
  const targetPath = normalizeRelativePath(joinRelativePath(parentPath, entryName))

  validateUserRelativePath(targetPath, kind)
  if (targetPath === relativePath) return relativePath

  const targetExists = await pathExists(absoluteVaultPath(vaultPath, targetPath))
  if (targetExists) throw new Error('同名文件或文件夹已存在')

  await movePath(absoluteVaultPath(vaultPath, relativePath), absoluteVaultPath(vaultPath, targetPath))
  return targetPath
}

/** 将文件或文件夹移动到目标目录下，返回新的相对路径 */
export async function moveEntry(
  vaultPath: string,
  relativePath: string,
  targetDir: string | null,
  kind: VaultEntryKind
): Promise<string> {
  const baseName = getBaseName(relativePath)
  const targetPath = normalizeRelativePath(joinRelativePath(targetDir, baseName))

  validateUserRelativePath(targetPath, kind)
  if (targetPath === relativePath) return relativePath

  if (kind === 'directory' && targetDir && isPathInsideDirectory(targetDir, relativePath)) {
    throw new Error('不能把文件夹移动到自身内部')
  }

  const targetAbsPath = absoluteVaultPath(vaultPath, targetPath)
  const sourceAbsPath = absoluteVaultPath(vaultPath, relativePath)

  const targetExists = await pathExists(targetAbsPath)
  if (targetExists) throw new Error('目标位置已有同名文件或文件夹')

  await movePath(sourceAbsPath, targetAbsPath)
  return targetPath
}

/** 删除文件或文件夹 */
export async function deleteEntry(vaultPath: string, relativePath: string, kind: VaultEntryKind): Promise<void> {
  await removePath(absoluteVaultPath(vaultPath, relativePath), kind === 'directory')
}

/** 根据重命名前缀计算当前打开文件的新路径 */
export function resolvePathAfterEntryRename(
  activePath: string,
  oldPath: string,
  newPath: string,
  kind: VaultEntryKind
): string {
  if (kind === 'file') return activePath === oldPath ? newPath : activePath
  return isPathInsideDirectory(activePath, oldPath)
    ? replacePathPrefix(activePath, oldPath, newPath)
    : activePath
}
