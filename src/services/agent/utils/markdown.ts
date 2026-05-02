import {
  containsAllSearchTerms,
  findEarliestSearchTermMatch,
  normalizeSearchText,
  splitSearchTerms,
} from '../../../lib/searchTerms'

export interface MarkdownHeading {
  level: number
  text: string
  lineNumber: number
}

export interface MarkdownSearchMatch {
  lineNumber: number
  startLine: number
  endLine: number
  snippet: string
}

const SNIPPET_SIDE_CHARS = 70
const MAX_LINE_SNIPPET_CHARS = 180

/** 提取 Markdown 标题结构，跳过 fenced code block 内的伪标题 */
export function extractMarkdownHeadings(content: string, maxHeadings: number): MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  let isInFence = false

  content.split('\n').some((line, index) => {
    const trimmedLine = line.trim()
    if (/^(```|~~~)/.test(trimmedLine)) {
      isInFence = !isInFence
      return false
    }
    if (isInFence) return false

    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (!match) return false

    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      lineNumber: index + 1,
    })

    return headings.length >= maxHeadings
  })

  return headings
}

/** 为搜索结果生成短片段，优先保留命中词附近文本 */
function createLineSearchSnippet(line: string, matchIndex: number, matchLength: number): string {
  const normalizedLine = line.replace(/\s+/g, ' ').trim()
  if (normalizedLine.length <= MAX_LINE_SNIPPET_CHARS) return normalizedLine

  const start = Math.max(0, matchIndex - SNIPPET_SIDE_CHARS)
  const end = Math.min(line.length, matchIndex + matchLength + SNIPPET_SIDE_CHARS)
  const snippet = line.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '...' : ''}${snippet}${end < line.length ? '...' : ''}`
}

/** 为普通上下文行生成受限长度的片段 */
function createContextLineSnippet(line: string): string {
  const normalizedLine = line.replace(/\s+/g, ' ').trim()
  if (normalizedLine.length <= MAX_LINE_SNIPPET_CHARS) return normalizedLine
  return `${normalizedLine.slice(0, MAX_LINE_SNIPPET_CHARS)}...`
}

/** 生成带上下文范围的搜索命中结果 */
function createSearchMatch(
  lines: string[],
  lineIndex: number,
  matchIndex: number,
  matchLength: number,
  contextLines: number
): MarkdownSearchMatch {
  const startIndex = Math.max(0, lineIndex - contextLines)
  const endIndex = Math.min(lines.length - 1, lineIndex + contextLines)
  const snippet = lines
    .slice(startIndex, endIndex + 1)
    .map((line, index) => {
      const sourceIndex = startIndex + index
      if (sourceIndex === lineIndex) return createLineSearchSnippet(line, matchIndex, matchLength)
      return createContextLineSnippet(line)
    })
    .join('\n')

  return {
    lineNumber: lineIndex + 1,
    startLine: startIndex + 1,
    endLine: endIndex + 1,
    snippet,
  }
}

/** 在单篇 Markdown 中搜索 literal 或 regex 查询 */
export function searchMarkdownContent(
  content: string,
  query: string,
  options: {
    isCaseSensitive: boolean
    isRegex: boolean
    maxMatches: number
    contextLines?: number
  }
): MarkdownSearchMatch[] {
  const matches: MarkdownSearchMatch[] = []
  const lines = content.split('\n')
  const contextLines = Math.max(0, Math.round(options.contextLines ?? 0))

  if (options.isRegex) {
    const flags = options.isCaseSensitive ? '' : 'i'
    const regex = new RegExp(query, flags)

    lines.some((line, index) => {
      const match = regex.exec(line)
      if (!match) return false

      matches.push(createSearchMatch(lines, index, match.index, match[0].length, contextLines))

      return matches.length >= options.maxMatches
    })

    return matches
  }

  const searchTerms = splitSearchTerms(query, { caseSensitive: options.isCaseSensitive })
  if (searchTerms.length === 0) return matches

  const comparableContent = options.isCaseSensitive ? content : normalizeSearchText(content)
  if (!containsAllSearchTerms(comparableContent, searchTerms, { haystackIsNormalized: true })) {
    return matches
  }

  lines.some((line, index) => {
    const comparableLine = options.isCaseSensitive ? line : normalizeSearchText(line)
    const matchedTerm = findEarliestSearchTermMatch(comparableLine, searchTerms, { haystackIsNormalized: true })
    if (!matchedTerm) return false

    matches.push(createSearchMatch(lines, index, matchedTerm.index, matchedTerm.term.length, contextLines))

    return matches.length >= options.maxMatches
  })

  return matches
}
