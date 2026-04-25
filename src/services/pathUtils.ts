export const MIRA_DIR = '.mira'
export const MIRA_MAP_FILE = 'Mira Map.md'
export const MARKDOWN_EXTENSION = '.md'

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/

/** 将路径片段拼成 vault 内部统一使用的相对路径 */
export function joinRelativePath(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
}

/** 获取相对路径的父目录，根目录返回 null */
export function getParentPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length > 0 ? parts.join('/') : null
}

/** 获取相对路径的最后一段 */
export function getBaseName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

/** 去掉 Markdown 扩展名 */
export function stripMarkdownExtension(name: string): string {
  return name.toLowerCase().endsWith(MARKDOWN_EXTENSION)
    ? name.slice(0, -MARKDOWN_EXTENSION.length)
    : name
}

/** 文件树和标题栏展示名：Markdown 文件隐藏 .md */
export function getDisplayName(path: string, kind: 'file' | 'directory'): string {
  const name = getBaseName(path)
  return kind === 'file' ? stripMarkdownExtension(name) : name
}

/** 判断 maybeChild 是否位于 directoryPath 内部 */
export function isPathInsideDirectory(maybeChild: string, directoryPath: string): boolean {
  return maybeChild === directoryPath || maybeChild.startsWith(`${directoryPath}/`)
}

/** 根据旧目录和新目录计算移动后的相对路径 */
export function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix
  return joinRelativePath(newPrefix, path.slice(oldPrefix.length + 1))
}

/** 标准化用户输入的文件名，自动补齐 .md */
export function normalizeMarkdownFileName(input: string): string {
  const name = input.trim()
  return name.toLowerCase().endsWith(MARKDOWN_EXTENSION) ? name : `${name}${MARKDOWN_EXTENSION}`
}

/** 标准化 vault 内相对路径，保留大小写与中文文件名 */
export function normalizeRelativePath(input: string): string {
  return input
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/|\/$/g, '')
}

/** 校验用户可创建/移动/重命名的相对路径 */
export function validateUserRelativePath(path: string, expectedKind: 'file' | 'directory'): void {
  const normalizedPath = normalizeRelativePath(path)
  const segments = normalizedPath.split('/').filter(Boolean)

  if (!normalizedPath) throw new Error('名称不能为空')
  if (path.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(path) || path.startsWith('~')) {
    throw new Error('不能使用绝对路径')
  }
  if (segments.length === 0) throw new Error('名称不能为空')

  for (const segment of segments) {
    if (segment === '.' || segment === '..') throw new Error('不能使用 . 或 ..')
    if (segment.startsWith('.')) throw new Error('不能创建隐藏文件或隐藏目录')
    if (segment.includes(':')) throw new Error('名称不能包含冒号')
  }

  const baseName = segments[segments.length - 1]
  if (expectedKind === 'file' && !baseName.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
    throw new Error('文件必须使用 .md 扩展名')
  }
  if (expectedKind === 'directory' && baseName.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
    throw new Error('文件夹名称不能以 .md 结尾')
  }
}
