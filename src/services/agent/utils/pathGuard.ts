import { MARKDOWN_EXTENSION, normalizeRelativePath, validateUserRelativePath } from '../../pathUtils'

/** 校验 agent 工具可读取的 vault 内 Markdown 相对路径 */
export function normalizeReadableNotePath(value: string): string {
  const normalizedPath = normalizeRelativePath(value)
  validateUserRelativePath(normalizedPath, 'file')

  if (!normalizedPath.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
    throw new Error('只能读取 Markdown 文件')
  }

  return normalizedPath
}
