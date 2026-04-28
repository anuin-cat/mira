export interface SearchTermMatch {
  term: string
  index: number
}

interface SearchTermOptions {
  caseSensitive?: boolean
  haystackIsNormalized?: boolean
}

/** 统一搜索文本的大小写归一化 */
export function normalizeSearchText(value: string): string {
  // 1. 用 locale 小写，兼顾英文大小写搜索
  return value.toLocaleLowerCase()
}

/** 按空白拆分普通搜索词，自动去重并移除空项 */
export function splitSearchTerms(query: string, options: Pick<SearchTermOptions, 'caseSensitive'> = {}): string[] {
  // 1. 去掉首尾空白，空查询直接返回
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  // 2. 按大小写策略规范化，再按空白切词
  const comparableQuery = options.caseSensitive ? trimmedQuery : normalizeSearchText(trimmedQuery)
  const rawTerms = comparableQuery.split(/\s+/).filter(Boolean)

  // 3. 保持原始顺序去重，避免重复词放大匹配成本
  return Array.from(new Set(rawTerms))
}

/** 根据大小写配置获取可直接比较的文本 */
function getComparableHaystack(haystack: string, options: SearchTermOptions = {}): string {
  // 1. 已归一化文本直接复用，避免重复转换
  if (options.haystackIsNormalized) return haystack

  // 2. 大小写敏感时保留原文，否则统一转小写
  return options.caseSensitive ? haystack : normalizeSearchText(haystack)
}

/** 判断文本是否命中任一搜索词 */
export function containsAnySearchTerm(
  haystack: string,
  terms: string[],
  options: SearchTermOptions = {}
): boolean {
  // 1. 无搜索词时直接视为不命中
  if (terms.length === 0) return false

  // 2. 逐词检查，命中任一词即可
  const comparableHaystack = getComparableHaystack(haystack, options)
  return terms.some((term) => comparableHaystack.includes(term))
}

/** 判断文本是否同时命中全部搜索词 */
export function containsAllSearchTerms(
  haystack: string,
  terms: string[],
  options: SearchTermOptions = {}
): boolean {
  // 1. 无搜索词时直接视为命中，方便上层复用
  if (terms.length === 0) return true

  // 2. 逐词检查，缺任一词都算不命中
  const comparableHaystack = getComparableHaystack(haystack, options)
  return terms.every((term) => comparableHaystack.includes(term))
}

/** 找到一段文本中最靠前的搜索词命中 */
export function findEarliestSearchTermMatch(
  haystack: string,
  terms: string[],
  options: SearchTermOptions = {}
): SearchTermMatch | null {
  // 1. 无搜索词时直接返回空
  if (terms.length === 0) return null

  // 2. 逐词查找，优先返回最靠前的命中；同位置优先更长的词
  const comparableHaystack = getComparableHaystack(haystack, options)
  let earliestMatch: SearchTermMatch | null = null

  for (const term of terms) {
    const matchIndex = comparableHaystack.indexOf(term)
    if (matchIndex < 0) continue

    if (
      !earliestMatch ||
      matchIndex < earliestMatch.index ||
      (matchIndex === earliestMatch.index && term.length > earliestMatch.term.length)
    ) {
      earliestMatch = {
        term,
        index: matchIndex,
      }
    }
  }

  return earliestMatch
}

/** 统计一段文本里某个搜索词的非重叠命中次数 */
export function countSearchTermOccurrences(
  haystack: string,
  term: string,
  options: SearchTermOptions = {}
): number {
  // 1. 空词直接返回 0，避免死循环
  if (!term) return 0

  // 2. 线性扫描所有非重叠命中
  const comparableHaystack = getComparableHaystack(haystack, options)
  let count = 0
  let searchStart = 0

  while (searchStart < comparableHaystack.length) {
    const matchIndex = comparableHaystack.indexOf(term, searchStart)
    if (matchIndex < 0) break
    count += 1
    searchStart = matchIndex + term.length
  }

  return count
}

/** 判断搜索词是否全部达到指定最小长度 */
export function areSearchTermsLongEnough(terms: string[], minLength: number): boolean {
  // 1. 空搜索词视为未达标，由上层决定是否继续搜索
  if (terms.length === 0) return false

  // 2. 仅当每个词都满足长度要求时才返回 true
  return terms.every((term) => term.length >= minLength)
}
