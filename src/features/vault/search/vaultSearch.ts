import type { VaultTreeNode } from '../../../domain/note'
import {
  areSearchTermsLongEnough,
  containsAllSearchTerms,
  containsAnySearchTerm,
  countSearchTermOccurrences,
  findEarliestSearchTermMatch,
  normalizeSearchText,
  splitSearchTerms,
} from '../../../lib/searchTerms'
import { readNoteContent } from '../../../services/noteService'
import { getDisplayName } from '../../../services/pathUtils'

const MAX_QUICK_OPEN_RESULTS = 80
const MAX_VAULT_SEARCH_RESULTS = 80
const MAX_MATCHES_PER_FILE = 3
const SNIPPET_CONTEXT_CHARS = 42
const INDEXED_FILE_COUNT_LIMIT = 300
const INDEXED_TOTAL_BYTES_LIMIT = 20 * 1024 * 1024
const INDEXED_SINGLE_FILE_BYTES_LIMIT = 512 * 1024
const HUGE_FILE_BODY_SEARCH_BYTES_LIMIT = 10 * 1024 * 1024
const STREAM_BODY_QUERY_MIN_LENGTH = 2

export type VaultSearchMode = 'indexed' | 'mixed' | 'streaming'

export interface VaultFileItem {
  path: string
  title: string
  updatedAt: string | null
  sizeBytes: number | null
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

export interface VaultSearchIndexItem extends VaultFileItem {
  content: string
  normalizedTitleAndPath: string
  normalizedContent: string
}

export interface VaultSearchStats {
  fileCount: number
  totalBytes: number
  largestFileBytes: number
  largeFileCount: number
  hugeFileCount: number
}

export interface PreparedVaultSearch {
  mode: VaultSearchMode
  stats: VaultSearchStats
  files: VaultFileItem[]
  indexItems: VaultSearchIndexItem[]
  streamFiles: VaultFileItem[]
}

interface VaultSearchPlan {
  mode: VaultSearchMode
  stats: VaultSearchStats
  indexFiles: VaultFileItem[]
  streamFiles: VaultFileItem[]
}

interface SearchOptions {
  shouldCancel?: () => boolean
}

interface ParsedVaultSearchQuery {
  normalizedTerms: string[]
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
          sizeBytes: node.sizeBytes ?? null,
        },
      ]
    }

    return collectVaultFiles(node.children ?? [])
  })
}

/** 把用户输入转成 vault 搜索可复用的查询结构 */
function parseVaultSearchQuery(query: string): ParsedVaultSearchQuery {
  // 1. 普通搜索按空白拆词，避免把整串文本当成单个短语
  return {
    normalizedTerms: splitSearchTerms(query),
  }
}

/** 判断文件是否命中快速打开查询 */
function doesFileMatchQuery(file: VaultFileItem, parsedQuery: ParsedVaultSearchQuery): boolean {
  if (parsedQuery.normalizedTerms.length === 0) return true
  const haystack = normalizeSearchText(`${file.title} ${file.path}`)
  return containsAllSearchTerms(haystack, parsedQuery.normalizedTerms, { haystackIsNormalized: true })
}

/** 快速打开文件过滤：文件名优先，其次路径 */
export function filterVaultFiles(files: VaultFileItem[], query: string): VaultFileItem[] {
  const parsedQuery = parseVaultSearchQuery(query)
  const primaryTerm = parsedQuery.normalizedTerms[0] ?? ''
  const matchedFiles = files.filter((file) => doesFileMatchQuery(file, parsedQuery))

  return matchedFiles
    .sort((a, b) => {
      const aTitle = normalizeSearchText(a.title)
      const bTitle = normalizeSearchText(b.title)
      const aStartsWith = primaryTerm ? aTitle.startsWith(primaryTerm) : false
      const bStartsWith = primaryTerm ? bTitle.startsWith(primaryTerm) : false
      if (aStartsWith !== bStartsWith) return aStartsWith ? -1 : 1
      return a.path.localeCompare(b.path, 'zh-Hans-CN', { numeric: true })
    })
    .slice(0, MAX_QUICK_OPEN_RESULTS)
}

/** 统计 vault 搜索规模，决定后续走索引还是流式扫描 */
function getVaultSearchStats(files: VaultFileItem[]): VaultSearchStats {
  const sizes = files.map((file) => file.sizeBytes ?? 0)
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0)
  const largestFileBytes = Math.max(0, ...sizes)

  return {
    fileCount: files.length,
    totalBytes,
    largestFileBytes,
    largeFileCount: sizes.filter((size) => size > INDEXED_SINGLE_FILE_BYTES_LIMIT).length,
    hugeFileCount: sizes.filter((size) => size > HUGE_FILE_BODY_SEARCH_BYTES_LIMIT).length,
  }
}

/** 根据文件数量和体积创建混合搜索计划 */
function createVaultSearchPlan(files: VaultFileItem[]): VaultSearchPlan {
  const stats = getVaultSearchStats(files)
  const isLargeVault =
    stats.fileCount > INDEXED_FILE_COUNT_LIMIT ||
    stats.totalBytes > INDEXED_TOTAL_BYTES_LIMIT

  if (isLargeVault) {
    return {
      mode: 'streaming',
      stats,
      indexFiles: [],
      streamFiles: files,
    }
  }

  const indexFiles = files.filter((file) => (file.sizeBytes ?? 0) <= INDEXED_SINGLE_FILE_BYTES_LIMIT)
  const streamFiles = files.filter((file) => (file.sizeBytes ?? 0) > INDEXED_SINGLE_FILE_BYTES_LIMIT)
  return {
    mode: streamFiles.length > 0 ? 'mixed' : 'indexed',
    stats,
    indexFiles,
    streamFiles,
  }
}

/** 为全文搜索结果生成短片段 */
function createContentSnippet(line: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT_CHARS)
  const end = Math.min(line.length, matchIndex + queryLength + SNIPPET_CONTEXT_CHARS)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < line.length ? '...' : ''

  return `${prefix}${line.slice(start, end).trim()}${suffix}`
}

/** 判断流式正文搜索是否因为词太短而应当退化 */
function isBodySearchTermsTooShort(normalizedTerms: string[]): boolean {
  // 1. 空查询交给上层拦截，这里只处理“词太短”的情况
  if (normalizedTerms.length === 0) return false

  // 2. 只要存在不足最小长度的词，就不扫描大文件正文
  return !areSearchTermsLongEnough(normalizedTerms, STREAM_BODY_QUERY_MIN_LENGTH)
}

/** 判断查询是否应该扫描正文，避免大 vault 单字搜索压满文件读取 */
function shouldSearchStreamedBody(
  preparedSearch: PreparedVaultSearch,
  parsedQuery: ParsedVaultSearchQuery
): boolean {
  if (preparedSearch.mode === 'indexed') return true
  return !isBodySearchTermsTooShort(parsedQuery.normalizedTerms)
}

/** 判断当前查询在流式模式下是否过短，只能匹配文件名 */
export function isVaultBodySearchQueryTooShort(query: string): boolean {
  // 1. 普通搜索按空白拆词，逐词检查长度门槛
  const normalizedTerms = splitSearchTerms(query)
  return isBodySearchTermsTooShort(normalizedTerms)
}

/** 判断某个大文件正文是否允许读取 */
function canReadFileBody(file: VaultFileItem): boolean {
  return (file.sizeBytes ?? 0) <= HUGE_FILE_BODY_SEARCH_BYTES_LIMIT
}

/** 创建路径命中结果 */
function createPathMatch(file: VaultFileItem, parsedQuery: ParsedVaultSearchQuery): VaultSearchMatch | null {
  const normalizedTitleAndPath = normalizeSearchText(`${file.title} ${file.path}`)
  if (!containsAnySearchTerm(normalizedTitleAndPath, parsedQuery.normalizedTerms, { haystackIsNormalized: true })) {
    return null
  }

  return {
    kind: 'path',
    lineNumber: null,
    snippet: file.path,
    query: null,
    matchOrdinal: null,
  }
}

/** 从正文中找出少量命中行 */
function createContentMatches(content: string, parsedQuery: ParsedVaultSearchQuery): VaultSearchMatch[] {
  const matches: VaultSearchMatch[] = []
  const lines = content.split('\n')
  const termOrdinals = new Map(parsedQuery.normalizedTerms.map((term) => [term, 0]))

  // 1. 逐行查找，单文件最多返回少量命中，避免结果面板过载
  for (let index = 0; index < lines.length; index += 1) {
    if (matches.length >= MAX_MATCHES_PER_FILE) break
    const line = lines[index] ?? ''
    const normalizedLine = normalizeSearchText(line)
    const matchedTerm = findEarliestSearchTermMatch(normalizedLine, parsedQuery.normalizedTerms, {
      haystackIsNormalized: true,
    })
    if (!matchedTerm) continue

    matches.push({
      kind: 'content',
      lineNumber: index + 1,
      snippet: createContentSnippet(line, matchedTerm.index, matchedTerm.term.length),
      query: matchedTerm.term,
      matchOrdinal: termOrdinals.get(matchedTerm.term) ?? 0,
    })

    for (const term of parsedQuery.normalizedTerms) {
      const currentCount = termOrdinals.get(term) ?? 0
      termOrdinals.set(
        term,
        currentCount + countSearchTermOccurrences(normalizedLine, term, { haystackIsNormalized: true })
      )
    }
  }

  return matches
}

/** 搜索已经进入内存的小文件索引 */
function searchIndexedNote(file: VaultSearchIndexItem, parsedQuery: ParsedVaultSearchQuery): VaultSearchResult | null {
  const isCombinedMatch = containsAllSearchTerms(
    `${file.normalizedTitleAndPath}\n${file.normalizedContent}`,
    parsedQuery.normalizedTerms,
    { haystackIsNormalized: true }
  )
  if (!isCombinedMatch) return null

  const matches: VaultSearchMatch[] = []
  const pathMatch = createPathMatch(file, parsedQuery)
  if (pathMatch) matches.push(pathMatch)

  if (containsAnySearchTerm(file.normalizedContent, parsedQuery.normalizedTerms, { haystackIsNormalized: true })) {
    matches.push(...createContentMatches(file.content, parsedQuery))
  }

  if (matches.length === 0) return null
  return {
    path: file.path,
    title: file.title,
    matches,
  }
}

/** 搜索一个按需读取的文件，读取后不保留正文 */
async function searchStreamedNote(
  vaultPath: string,
  file: VaultFileItem,
  parsedQuery: ParsedVaultSearchQuery,
  canSearchBody: boolean
): Promise<VaultSearchResult | null> {
  const normalizedTitleAndPath = normalizeSearchText(`${file.title} ${file.path}`)
  const isPathFullMatch = containsAllSearchTerms(normalizedTitleAndPath, parsedQuery.normalizedTerms, {
    haystackIsNormalized: true,
  })
  const matches: VaultSearchMatch[] = []
  const pathMatch = createPathMatch(file, parsedQuery)
  if (pathMatch) matches.push(pathMatch)

  if (!canSearchBody || !canReadFileBody(file)) {
    if (!isPathFullMatch) return null
  } else {
    const content = (await readNoteContent(vaultPath, file.path).catch(() => null)) ?? ''
    const normalizedContent = normalizeSearchText(content)
    const isCombinedMatch = containsAllSearchTerms(
      `${normalizedTitleAndPath}\n${normalizedContent}`,
      parsedQuery.normalizedTerms,
      { haystackIsNormalized: true }
    )
    if (!isCombinedMatch) return null

    if (containsAnySearchTerm(normalizedContent, parsedQuery.normalizedTerms, { haystackIsNormalized: true })) {
      matches.push(...createContentMatches(content, parsedQuery))
    }
  }

  if (matches.length === 0) return null
  return {
    path: file.path,
    title: file.title,
    matches,
  }
}

/** 为小文件构建内存索引，大文件由流式搜索兜底 */
async function buildVaultSearchIndex(vaultPath: string, files: VaultFileItem[]): Promise<VaultSearchIndexItem[]> {
  const indexItems: VaultSearchIndexItem[] = []

  // 1. 小 vault / 小文件才进入索引，降低长期内存占用
  for (const file of files) {
    const content = await readNoteContent(vaultPath, file.path).catch(() => null) ?? ''
    indexItems.push({
      ...file,
      content,
      normalizedTitleAndPath: normalizeSearchText(`${file.title} ${file.path}`),
      normalizedContent: normalizeSearchText(content),
    })
  }

  return indexItems
}

/** 打开搜索面板时只按策略准备必要数据 */
export async function prepareVaultSearch(vaultPath: string, nodes: VaultTreeNode[]): Promise<PreparedVaultSearch> {
  const files = collectVaultFiles(nodes)
  const plan = createVaultSearchPlan(files)
  const indexItems = plan.indexFiles.length > 0 ? await buildVaultSearchIndex(vaultPath, plan.indexFiles) : []

  return {
    mode: plan.mode,
    stats: plan.stats,
    files,
    indexItems,
    streamFiles: plan.streamFiles,
  }
}

/** 搜索 vault 中的 Markdown 文件，小 vault 查内存，大 vault 按文件流式扫描 */
export async function searchVaultNotes(
  vaultPath: string,
  preparedSearch: PreparedVaultSearch,
  query: string,
  options: SearchOptions = {}
): Promise<VaultSearchResult[]> {
  const parsedQuery = parseVaultSearchQuery(query)
  if (parsedQuery.normalizedTerms.length === 0) return []

  const results: VaultSearchResult[] = []

  // 1. 先查已进入内存的小文件索引
  for (const file of preparedSearch.indexItems) {
    if (options.shouldCancel?.()) return []
    const result = searchIndexedNote(file, parsedQuery)
    if (result) results.push(result)
    if (results.length >= MAX_VAULT_SEARCH_RESULTS) return results
  }

  // 2. 大文件或大 vault 按需逐个读取，不把正文长期留在内存里
  const canSearchBody = shouldSearchStreamedBody(preparedSearch, parsedQuery)
  for (const file of preparedSearch.streamFiles) {
    if (options.shouldCancel?.()) return []
    const result = await searchStreamedNote(vaultPath, file, parsedQuery, canSearchBody)
    if (options.shouldCancel?.()) return []
    if (result) results.push(result)
    if (results.length >= MAX_VAULT_SEARCH_RESULTS) break
  }

  return results
}

/** 生成全库搜索空状态提示 */
export function getVaultSearchHint(preparedSearch: PreparedVaultSearch | null, query: string): string {
  if (!preparedSearch) return '输入关键词后开始搜索'
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    if (preparedSearch.mode === 'indexed') return '输入关键词后开始搜索'
    return '输入关键词后开始搜索，大文件会按需扫描'
  }
  if (preparedSearch.mode !== 'indexed' && isVaultBodySearchQueryTooShort(trimmedQuery)) {
    return '输入至少 2 个字符后搜索正文；当前只匹配文件名'
  }
  return '输入关键词后开始搜索'
}
