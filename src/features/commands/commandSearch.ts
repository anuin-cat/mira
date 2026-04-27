import type { VaultTreeNode } from '../../domain/note'
import { readNote } from '../../services/noteService'
import { getDisplayName } from '../../services/pathUtils'

const MAX_QUICK_OPEN_RESULTS = 80
const MAX_VAULT_SEARCH_RESULTS = 80
const MAX_MATCHES_PER_FILE = 3
const SNIPPET_CONTEXT_CHARS = 42

export interface VaultFileItem {
  path: string
  title: string
  updatedAt: string | null
}

export interface VaultSearchMatch {
  kind: 'path' | 'content'
  lineNumber: number | null
  snippet: string
  query: string | null
  matchOrdinal: number | null
}

export interface VaultSearchResult {
  path: string
  title: string
  matches: VaultSearchMatch[]
}

/** 递归收集文件树中的 Markdown 文件 */
export function collectVaultFiles(nodes: VaultTreeNode[]): VaultFileItem[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'file') {
      return [
        {
          path: node.path,
          title: getDisplayName(node.path, 'file'),
          updatedAt: node.updatedAt,
        },
      ]
    }

    return collectVaultFiles(node.children ?? [])
  })
}

/** 统一搜索用的宽松小写文本 */
function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase()
}

/** 判断文件是否命中快速打开查询 */
function doesFileMatchQuery(file: VaultFileItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true
  const haystack = normalizeSearchText(`${file.title} ${file.path}`)
  return haystack.includes(normalizedQuery)
}

/** 快速打开文件过滤：文件名优先，其次路径 */
export function filterVaultFiles(files: VaultFileItem[], query: string): VaultFileItem[] {
  const normalizedQuery = normalizeSearchText(query.trim())
  const matchedFiles = files.filter((file) => doesFileMatchQuery(file, normalizedQuery))

  return matchedFiles
    .sort((a, b) => {
      const aTitle = normalizeSearchText(a.title)
      const bTitle = normalizeSearchText(b.title)
      const aStartsWith = normalizedQuery ? aTitle.startsWith(normalizedQuery) : false
      const bStartsWith = normalizedQuery ? bTitle.startsWith(normalizedQuery) : false
      if (aStartsWith !== bStartsWith) return aStartsWith ? -1 : 1
      return a.path.localeCompare(b.path, 'zh-Hans-CN', { numeric: true })
    })
    .slice(0, MAX_QUICK_OPEN_RESULTS)
}

/** 为全文搜索结果生成短片段 */
function createContentSnippet(line: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT_CHARS)
  const end = Math.min(line.length, matchIndex + queryLength + SNIPPET_CONTEXT_CHARS)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < line.length ? '...' : ''

  return `${prefix}${line.slice(start, end).trim()}${suffix}`
}

/** 统计一行内的非重叠命中次数，用于定位可见文本序号 */
function countLineMatches(normalizedLine: string, normalizedQuery: string): number {
  let count = 0
  let searchStart = 0

  while (searchStart < normalizedLine.length) {
    const matchIndex = normalizedLine.indexOf(normalizedQuery, searchStart)
    if (matchIndex < 0) break
    count += 1
    searchStart = matchIndex + normalizedQuery.length
  }

  return count
}

/** 搜索单篇 Markdown 的路径与正文 */
async function searchSingleNote(
  vaultPath: string,
  file: VaultFileItem,
  query: string,
  normalizedQuery: string
): Promise<VaultSearchResult | null> {
  const matches: VaultSearchMatch[] = []
  const normalizedTitleAndPath = normalizeSearchText(`${file.title} ${file.path}`)
  let contentMatchOrdinal = 0

  if (normalizedTitleAndPath.includes(normalizedQuery)) {
    matches.push({
      kind: 'path',
      lineNumber: null,
      snippet: file.path,
      query: null,
      matchOrdinal: null,
    })
  }

  const note = await readNote(vaultPath, file.path)
  const lines = note?.content.split('\n') ?? []
  for (let index = 0; index < lines.length; index += 1) {
    if (matches.length >= MAX_MATCHES_PER_FILE) break
    const line = lines[index] ?? ''
    const normalizedLine = normalizeSearchText(line)
    const matchIndex = normalizedLine.indexOf(normalizedQuery)
    if (matchIndex < 0) continue

    matches.push({
      kind: 'content',
      lineNumber: index + 1,
      snippet: createContentSnippet(line, matchIndex, normalizedQuery.length),
      query,
      matchOrdinal: contentMatchOrdinal,
    })
    contentMatchOrdinal += countLineMatches(normalizedLine, normalizedQuery)
  }

  if (matches.length === 0) return null
  return {
    path: file.path,
    title: file.title,
    matches,
  }
}

/** 即时搜索 vault 中的 Markdown 文件，不写入索引或缓存 */
export async function searchVaultNotes(
  vaultPath: string,
  nodes: VaultTreeNode[],
  query: string
): Promise<VaultSearchResult[]> {
  const normalizedQuery = normalizeSearchText(query.trim())
  if (!normalizedQuery) return []

  const trimmedQuery = query.trim()
  const files = collectVaultFiles(nodes)
  const results = await Promise.all(
    files.map((file) => searchSingleNote(vaultPath, file, trimmedQuery, normalizedQuery))
  )

  return results.filter((result): result is VaultSearchResult => Boolean(result)).slice(0, MAX_VAULT_SEARCH_RESULTS)
}
