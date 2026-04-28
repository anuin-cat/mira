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
function createSearchSnippet(line: string, matchIndex: number, matchLength: number): string {
  const normalizedLine = line.replace(/\s+/g, ' ').trim()
  if (normalizedLine.length <= MAX_LINE_SNIPPET_CHARS) return normalizedLine

  const start = Math.max(0, matchIndex - SNIPPET_SIDE_CHARS)
  const end = Math.min(line.length, matchIndex + matchLength + SNIPPET_SIDE_CHARS)
  const snippet = line.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '...' : ''}${snippet}${end < line.length ? '...' : ''}`
}

/** 在单篇 Markdown 中搜索 literal 或 regex 查询 */
export function searchMarkdownContent(
  content: string,
  query: string,
  options: {
    isCaseSensitive: boolean
    isRegex: boolean
    maxMatches: number
  }
): MarkdownSearchMatch[] {
  const matches: MarkdownSearchMatch[] = []
  if (options.isRegex) {
    const flags = options.isCaseSensitive ? '' : 'i'
    const regex = new RegExp(query, flags)

    content.split('\n').some((line, index) => {
      const match = regex.exec(line)
      if (!match) return false

      matches.push({
        lineNumber: index + 1,
        snippet: createSearchSnippet(line, match.index, match[0].length),
      })

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

  content.split('\n').some((line, index) => {
    const comparableLine = options.isCaseSensitive ? line : normalizeSearchText(line)
    const matchedTerm = findEarliestSearchTermMatch(comparableLine, searchTerms, { haystackIsNormalized: true })
    if (!matchedTerm) return false

    matches.push({
      lineNumber: index + 1,
      snippet: createSearchSnippet(line, matchedTerm.index, matchedTerm.term.length),
    })

    return matches.length >= options.maxMatches
  })

  return matches
}
