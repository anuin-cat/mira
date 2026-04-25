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
import type { Note, NoteMeta, VaultEntryKind, VaultTreeNode } from '../domain/note'
import {
  getBaseName,
  getDisplayName,
  getParentPath,
  isPathInsideDirectory,
  joinRelativePath,
  MARKDOWN_EXTENSION,
  MIRA_MAP_FILE,
  normalizeMarkdownFileName,
  normalizeRelativePath,
  replacePathPrefix,
  stripMarkdownExtension,
  validateUserRelativePath,
} from './pathUtils'

const UNTITLED_FILE_BASE = '未命名'
const UNTITLED_DIR_BASE = '新建文件夹'
const MAP_SUMMARY_LIMIT = 90

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
function shouldSkipEntry(name: string): boolean {
  return name.startsWith('.')
}

/** 按人类文件管理器心智排序：Mira Map 固定在根目录顶部，文件夹优先 */
function sortNodes(nodes: VaultTreeNode[], isRoot = false): VaultTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (isRoot && a.path === MIRA_MAP_FILE) return -1
    if (isRoot && b.path === MIRA_MAP_FILE) return 1
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
  })
}

/** 扫描目录并生成文件树节点 */
async function scanDirectory(vaultPath: string, relativeDir: string | null): Promise<VaultTreeNode[]> {
  const entries = await listEntries(absoluteVaultPath(vaultPath, relativeDir))
  const nodes: VaultTreeNode[] = []

  for (const entry of entries) {
    if (!entry.name || entry.isSymlink || shouldSkipEntry(entry.name)) continue
    const relativePath = joinRelativePath(relativeDir, entry.name)

    if (entry.isDirectory) {
      const info = await getFileInfo(absoluteVaultPath(vaultPath, relativePath))
      nodes.push({
        id: relativePath,
        path: relativePath,
        name: entry.name,
        kind: 'directory',
        updatedAt: toIsoString(info?.mtime),
        children: await scanDirectory(vaultPath, relativePath),
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
      })
    }
  }

  return sortNodes(nodes, !relativeDir)
}

/** 扫描 vault 下所有可见目录和 Markdown 文件 */
export async function scanVaultTree(vaultPath: string): Promise<VaultTreeNode[]> {
  return await scanDirectory(vaultPath, null)
}

/** 从 Markdown 内容提取一个人类可读摘要，跳过 frontmatter */
function extractReadableLine(content: string): string {
  const lines = content.split('\n')
  let startIndex = 0

  if (lines[0]?.trim() === '---') {
    const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (endIndex > 0) startIndex = endIndex + 1
  }

  for (const line of lines.slice(startIndex)) {
    const cleaned = line
      .replace(/^#+\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (cleaned) return cleaned.slice(0, MAP_SUMMARY_LIMIT)
  }

  return '空白文档'
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

/** 递归收集文件节点 */
function collectFiles(nodes: VaultTreeNode[]): VaultTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'file') return [node]
    return collectFiles(node.children ?? [])
  })
}

/** 生成 text tree 的单行内容 */
function appendTreeLines(nodes: VaultTreeNode[], lines: string[], prefix = ''): void {
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1
    const marker = isLast ? '└── ' : '├── '
    const label = node.kind === 'directory' ? `${node.name}/` : `${node.name}${MARKDOWN_EXTENSION}`
    lines.push(`${prefix}${marker}${label}`)
    if (node.kind === 'directory') {
      appendTreeLines(node.children ?? [], lines, `${prefix}${isLast ? '    ' : '│   '}`)
    }
  })
}

/** 转义 Markdown 链接文本 */
function escapeMarkdownText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

/** 生成人类可读的 Mira Map 内容 */
export async function generateMiraMapContent(vaultPath: string): Promise<string> {
  const tree = await scanVaultTree(vaultPath)
  const visibleTree = tree.filter((node) => node.path !== MIRA_MAP_FILE)
  const treeLines = ['.']
  const files = collectFiles(visibleTree)

  appendTreeLines(visibleTree, treeLines)

  const descriptions = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(absoluteVaultPath(vaultPath, file.path))
      const summary = extractReadableLine(content ?? '')
      const label = escapeMarkdownText(stripMarkdownExtension(file.path))
      return `- [${label}](<${file.path}>): ${summary}`
    })
  )

  return [
    '# Mira Map',
    '',
    '这个文件用于描述当前 vault 的目录结构，可以直接修改。',
    '',
    '## 目录结构',
    '',
    '```text',
    ...treeLines,
    '```',
    '',
    '## 文件说明',
    '',
    descriptions.length > 0 ? descriptions.join('\n') : '- 暂无 Markdown 文件',
    '',
  ].join('\n')
}

/** 确保根目录存在 Mira Map.md，已存在时绝不覆盖 */
export async function ensureMiraMap(vaultPath: string): Promise<void> {
  const mapExists = await pathExists(absoluteVaultPath(vaultPath, MIRA_MAP_FILE))
  if (mapExists) return
  await writeFile(absoluteVaultPath(vaultPath, MIRA_MAP_FILE), await generateMiraMapContent(vaultPath))
}

/** 显式重写 Mira Map.md */
export async function updateMiraMap(vaultPath: string): Promise<string> {
  const content = await generateMiraMapContent(vaultPath)
  await writeFile(absoluteVaultPath(vaultPath, MIRA_MAP_FILE), content)
  return content
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
