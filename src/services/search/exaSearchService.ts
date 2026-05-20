import type { AiSearchFreshnessPreset } from '../../domain/ai'
import { canUseSearchApiProxy, postSearchApiJson } from '../../tauri/search'

const EXA_SEARCH_ENDPOINT = 'https://api.exa.ai/search'
const DEFAULT_SEARCH_COUNT = 10
const MIN_SEARCH_COUNT = 1
const MAX_SEARCH_COUNT = 100
const MAX_DOMAIN_FILTERS = 1200
const MAX_ADDITIONAL_QUERIES = 5
const MAX_SYSTEM_PROMPT_CHARS = 1200
const MAX_OUTPUT_SCHEMA_CHARS = 4000
const MAX_SUBPAGES = 10
const MAX_EXTRA_LINKS = 20
const MAX_TEXT_CHARACTERS = 20000
const MAX_HIGHLIGHT_CHARACTERS = 3000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/
const ISO_DATE_LIKE_RE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/

export type ExaSearchType = 'auto' | 'fast' | 'instant' | 'deep-lite' | 'deep' | 'deep-reasoning'
export type ExaSearchCategory = 'company' | 'people' | 'research paper' | 'news' | 'personal site' | 'financial report'
export type ExaTextVerbosity = 'compact' | 'standard' | 'full'
export type ExaTextSection = 'header' | 'navigation' | 'banner' | 'body' | 'sidebar' | 'footer' | 'metadata'

const EXA_SEARCH_TYPES: ExaSearchType[] = ['auto', 'fast', 'instant', 'deep-lite', 'deep', 'deep-reasoning']
const EXA_SEARCH_CATEGORIES: ExaSearchCategory[] = [
  'company',
  'people',
  'research paper',
  'news',
  'personal site',
  'financial report',
]
const EXA_TEXT_VERBOSITIES: ExaTextVerbosity[] = ['compact', 'standard', 'full']
const EXA_TEXT_SECTIONS: ExaTextSection[] = ['header', 'navigation', 'banner', 'body', 'sidebar', 'footer', 'metadata']
const PRESET_FRESHNESS_VALUES: AiSearchFreshnessPreset[] = [
  'noLimit',
  'oneDay',
  'oneWeek',
  'oneMonth',
  'oneYear',
]

export interface ExaSearchOptions {
  apiKey: string
  query: string
  type?: ExaSearchType
  category?: ExaSearchCategory | null
  userLocation?: string | null
  count?: number
  freshness?: string
  includeDomains?: string | string[] | null
  excludeDomains?: string | string[] | null
  startPublishedDate?: string | null
  endPublishedDate?: string | null
  startCrawlDate?: string | null
  endCrawlDate?: string | null
  additionalQueries?: string[] | null
  systemPrompt?: string | null
  outputSchema?: Record<string, unknown> | null
  moderation?: boolean
  includeText?: boolean
  textMaxCharacters?: number
  textIncludeHtmlTags?: boolean
  textVerbosity?: ExaTextVerbosity | null
  textIncludeSections?: string | string[] | null
  textExcludeSections?: string | string[] | null
  includeHighlights?: boolean
  highlightsQuery?: string | null
  highlightsMaxCharacters?: number
  includeSummary?: boolean
  summaryQuery?: string | null
  summarySchema?: Record<string, unknown> | null
  maxAgeHours?: number
  livecrawlTimeout?: number
  subpages?: number
  subpageTarget?: string | string[] | null
  extraLinks?: number
  extraImageLinks?: number
  signal?: AbortSignal
}

export interface ExaSubpageResult {
  id: string | null
  title: string | null
  url: string
  publishedDate: string | null
  author: string | null
  text: string | null
  highlights: string[]
  highlightScores: number[]
  summary: string | null
}

export interface ExaWebPageResult extends ExaSubpageResult {
  image: string | null
  favicon: string | null
  subpages: ExaSubpageResult[]
  extraLinks: string[]
  extraImageLinks: string[]
}

export interface ExaSearchResult {
  requestId: string | null
  searchType: string | null
  resolvedSearchType: string | null
  costDollarsTotal: number | null
  results: ExaWebPageResult[]
  output: unknown
}

interface ResolvedExaDateFilters {
  startPublishedDate?: string
  endPublishedDate?: string
  startCrawlDate?: string
  endCrawlDate?: string
}

/** 把搜索条数限制在 Exa Search API 支持范围内 */
export function normalizeExaSearchCount(value: unknown, fallback = DEFAULT_SEARCH_COUNT): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(MAX_SEARCH_COUNT, Math.max(MIN_SEARCH_COUNT, Math.round(value)))
}

/** 判断 Exa 搜索类型是否可用 */
export function isValidExaSearchType(value: string): value is ExaSearchType {
  return EXA_SEARCH_TYPES.includes(value as ExaSearchType)
}

/** 判断 Exa 垂直类别是否可用 */
export function isValidExaSearchCategory(value: string): value is ExaSearchCategory {
  return EXA_SEARCH_CATEGORIES.includes(value as ExaSearchCategory)
}

/** 把未知对象收窄为可读取字段的普通记录 */
function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 从未知对象中读取字符串字段 */
function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

/** 从未知对象中读取数字字段 */
function readNumber(source: Record<string, unknown> | null, key: string): number | null {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 从未知对象中读取字符串数组字段 */
function readStringArray(source: Record<string, unknown> | null, key: string): string[] {
  const value = source?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

/** 从未知对象中读取数字数组字段 */
function readNumberArray(source: Record<string, unknown> | null, key: string): number[] {
  const value = source?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
}

/** 归一化字符串列表参数，兼容 UI 字符串和 agent 数组入参 */
function normalizeStringList(value: string | string[] | null | undefined, fieldName: string, maxCount: number): string[] {
  if (Array.isArray(value)) {
    const items = value.map((item) => item.trim()).filter(Boolean)
    if (items.length > maxCount) throw new Error(`${fieldName} 最多只能包含 ${maxCount} 项`)
    return items
  }
  if (!value?.trim()) return []

  const items = value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (items.length > maxCount) throw new Error(`${fieldName} 最多只能包含 ${maxCount} 项`)
  return items
}

/** 校验 Exa 支持的日期格式，保持官方示例中的 YYYY-MM-DD 写法 */
function normalizeDateFilter(value: string | null | undefined, fieldName: string): string | undefined {
  const normalizedValue = value?.trim()
  if (!normalizedValue) return undefined
  if (!ISO_DATE_LIKE_RE.test(normalizedValue) || Number.isNaN(Date.parse(normalizedValue))) {
    throw new Error(`${fieldName} 必须是 YYYY-MM-DD 或 ISO 8601 日期时间`)
  }
  return normalizedValue
}

/** 将默认 freshness 预设转换为 Exa 的发布时间过滤 */
function resolvePresetFreshness(freshness: AiSearchFreshnessPreset): ResolvedExaDateFilters {
  if (freshness === 'noLimit') return {}

  const now = new Date()
  const startDate = new Date(now)
  if (freshness === 'oneDay') startDate.setDate(now.getDate() - 1)
  if (freshness === 'oneWeek') startDate.setDate(now.getDate() - 7)
  if (freshness === 'oneMonth') startDate.setMonth(now.getMonth() - 1)
  if (freshness === 'oneYear') startDate.setFullYear(now.getFullYear() - 1)

  return {
    startPublishedDate: startDate.toISOString(),
    endPublishedDate: now.toISOString(),
  }
}

/** 解析通用 freshness 参数到 Exa 支持的日期过滤 */
function resolveFreshnessDateFilters(freshness: string | null | undefined): ResolvedExaDateFilters {
  const normalizedFreshness = freshness?.trim()
  if (!normalizedFreshness) return {}

  if (PRESET_FRESHNESS_VALUES.includes(normalizedFreshness as AiSearchFreshnessPreset)) {
    return resolvePresetFreshness(normalizedFreshness as AiSearchFreshnessPreset)
  }

  const dateRangeMatch = normalizedFreshness.match(DATE_RANGE_RE)
  if (dateRangeMatch) {
    return {
      startPublishedDate: dateRangeMatch[1],
      endPublishedDate: dateRangeMatch[2],
    }
  }

  if (DATE_RE.test(normalizedFreshness)) {
    return {
      startPublishedDate: normalizedFreshness,
      endPublishedDate: normalizedFreshness,
    }
  }

  throw new Error('搜索时间范围格式不正确')
}

/** 合并显式日期过滤和通用 freshness 过滤 */
function resolveDateFilters(options: ExaSearchOptions): ResolvedExaDateFilters {
  const freshnessFilters = resolveFreshnessDateFilters(options.freshness)
  return {
    startPublishedDate: normalizeDateFilter(options.startPublishedDate, 'startPublishedDate') ?? freshnessFilters.startPublishedDate,
    endPublishedDate: normalizeDateFilter(options.endPublishedDate, 'endPublishedDate') ?? freshnessFilters.endPublishedDate,
    startCrawlDate: normalizeDateFilter(options.startCrawlDate, 'startCrawlDate'),
    endCrawlDate: normalizeDateFilter(options.endCrawlDate, 'endCrawlDate'),
  }
}

/** 限制可选数字参数的范围 */
function normalizeOptionalInteger(value: unknown, fieldName: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`${fieldName} 必须是数字`)
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 校验并裁剪短文本参数 */
function normalizeOptionalText(value: string | null | undefined, fieldName: string, maxChars: number): string | undefined {
  const normalizedValue = value?.trim()
  if (!normalizedValue) return undefined
  if (normalizedValue.length > maxChars) throw new Error(`${fieldName} 不能超过 ${maxChars} 个字符`)
  return normalizedValue
}

/** 校验 Exa 支持的枚举入参 */
function normalizeEnum<T extends string>(value: string | null | undefined, values: readonly T[], fieldName: string): T | undefined {
  const normalizedValue = value?.trim()
  if (!normalizedValue) return undefined
  if (!values.includes(normalizedValue as T)) throw new Error(`${fieldName} 不受支持`)
  return normalizedValue as T
}

/** 校验输出结构化 schema，避免把超大对象直接传给外部 API */
function normalizeOutputSchema(value: Record<string, unknown> | null | undefined, fieldName: string): Record<string, unknown> | undefined {
  if (!value) return undefined
  const serialized = JSON.stringify(value)
  if (serialized.length > MAX_OUTPUT_SCHEMA_CHARS) {
    throw new Error(`${fieldName} 不能超过 ${MAX_OUTPUT_SCHEMA_CHARS} 个字符`)
  }
  return value
}

/** 校验 company / people 类别的官方限制，提前给模型可修正的错误 */
function validateCategoryFilters(
  category: ExaSearchCategory | undefined,
  includeDomains: string[],
  excludeDomains: string[],
  dateFilters: ResolvedExaDateFilters
) {
  if (category !== 'company' && category !== 'people') return

  const hasDateFilters = Boolean(
    dateFilters.startPublishedDate || dateFilters.endPublishedDate || dateFilters.startCrawlDate || dateFilters.endCrawlDate
  )
  if (excludeDomains.length > 0 || hasDateFilters) {
    throw new Error('Exa 的 company / people 类别不支持 excludeDomains 或日期过滤')
  }
  if (category === 'people' && includeDomains.some((domain) => !domain.toLowerCase().includes('linkedin.com'))) {
    throw new Error('Exa 的 people 类别只支持 LinkedIn 相关 includeDomains')
  }
}

/** 构造 Exa contents 参数，默认返回 highlights，按需深取 text / summary */
function createContentsPayload(options: ExaSearchOptions): Record<string, unknown> {
  const contents: Record<string, unknown> = {}

  if (options.includeText === true) {
    const textPayload: Record<string, unknown> = {}
    const maxCharacters = normalizeOptionalInteger(options.textMaxCharacters, 'textMaxCharacters', 1, MAX_TEXT_CHARACTERS)
    const includeSections = normalizeStringList(options.textIncludeSections, 'textIncludeSections', EXA_TEXT_SECTIONS.length)
    const excludeSections = normalizeStringList(options.textExcludeSections, 'textExcludeSections', EXA_TEXT_SECTIONS.length)
    const verbosity = normalizeEnum(options.textVerbosity, EXA_TEXT_VERBOSITIES, 'textVerbosity')

    if (maxCharacters !== undefined) textPayload.maxCharacters = maxCharacters
    if (options.textIncludeHtmlTags === true) textPayload.includeHtmlTags = true
    if (verbosity) textPayload.verbosity = verbosity
    if (includeSections.length > 0) textPayload.includeSections = includeSections
    if (excludeSections.length > 0) textPayload.excludeSections = excludeSections
    contents.text = Object.keys(textPayload).length > 0 ? textPayload : true
  }

  if (options.includeHighlights !== false) {
    const highlightsPayload: Record<string, unknown> = {}
    const query = normalizeOptionalText(options.highlightsQuery, 'highlightsQuery', 500)
    const maxCharacters = normalizeOptionalInteger(
      options.highlightsMaxCharacters,
      'highlightsMaxCharacters',
      1,
      MAX_HIGHLIGHT_CHARACTERS
    )

    if (query) highlightsPayload.query = query
    if (maxCharacters !== undefined) highlightsPayload.maxCharacters = maxCharacters
    contents.highlights = Object.keys(highlightsPayload).length > 0 ? highlightsPayload : true
  }

  if (options.includeSummary === true) {
    const summaryPayload: Record<string, unknown> = {}
    const query = normalizeOptionalText(options.summaryQuery, 'summaryQuery', 500)
    const schema = normalizeOutputSchema(options.summarySchema, 'summarySchema')

    if (query) summaryPayload.query = query
    if (schema) summaryPayload.schema = schema
    contents.summary = Object.keys(summaryPayload).length > 0 ? summaryPayload : true
  }

  const maxAgeHours = normalizeOptionalInteger(options.maxAgeHours, 'maxAgeHours', -1, 24 * 365)
  const livecrawlTimeout = normalizeOptionalInteger(options.livecrawlTimeout, 'livecrawlTimeout', 1000, 60000)
  const subpages = normalizeOptionalInteger(options.subpages, 'subpages', 0, MAX_SUBPAGES)
  const subpageTarget = normalizeStringList(options.subpageTarget, 'subpageTarget', 10)
  const extraLinks = normalizeOptionalInteger(options.extraLinks, 'extraLinks', 0, MAX_EXTRA_LINKS)
  const extraImageLinks = normalizeOptionalInteger(options.extraImageLinks, 'extraImageLinks', 0, MAX_EXTRA_LINKS)

  if (maxAgeHours !== undefined) contents.maxAgeHours = maxAgeHours
  if (livecrawlTimeout !== undefined) contents.livecrawlTimeout = livecrawlTimeout
  if (subpages !== undefined) contents.subpages = subpages
  if (subpageTarget.length > 0) contents.subpageTarget = subpageTarget.length === 1 ? subpageTarget[0] : subpageTarget
  if (extraLinks !== undefined || extraImageLinks !== undefined) {
    contents.extras = {
      ...(extraLinks !== undefined ? { links: extraLinks } : {}),
      ...(extraImageLinks !== undefined ? { imageLinks: extraImageLinks } : {}),
    }
  }

  return contents
}

/** 从 Exa 异常响应中提取可展示错误 */
function readExaErrorMessage(payload: unknown): string | null {
  const record = toRecord(payload)
  if (!record) return null

  const error = record.error
  if (typeof error === 'string' && error.trim()) return error

  const errorRecord = toRecord(error)
  return readString(record, 'message') ?? readString(record, 'detail') ?? readString(errorRecord, 'message')
}

/** 判断 HTTP 状态码是否为成功响应 */
function isSuccessfulHttpStatus(status: number): boolean {
  return status >= 200 && status < 300
}

/** 解析单条 Exa subpage 结果 */
function parseSubpageResult(item: unknown): ExaSubpageResult | null {
  const page = toRecord(item)
  const url = readString(page, 'url')
  if (!page || !url) return null

  return {
    id: readString(page, 'id'),
    title: readString(page, 'title'),
    url,
    publishedDate: readString(page, 'publishedDate'),
    author: readString(page, 'author'),
    text: readString(page, 'text'),
    highlights: readStringArray(page, 'highlights'),
    highlightScores: readNumberArray(page, 'highlightScores'),
    summary: readString(page, 'summary'),
  }
}

/** 解析单条 Exa 搜索结果 */
function parseWebPageResult(item: unknown): ExaWebPageResult | null {
  const baseResult = parseSubpageResult(item)
  const page = toRecord(item)
  if (!baseResult || !page) return null

  const rawSubpages = page.subpages
  const subpages = Array.isArray(rawSubpages) ? rawSubpages.flatMap((subpage) => parseSubpageResult(subpage) ?? []) : []

  return {
    ...baseResult,
    image: readString(page, 'image'),
    favicon: readString(page, 'favicon'),
    subpages,
    extraLinks: readStringArray(page, 'extraLinks'),
    extraImageLinks: readStringArray(page, 'extraImageLinks'),
  }
}

/** 调用 Exa Search API 并整理成 Mira 内部稳定结构 */
export async function searchExaWeb(options: ExaSearchOptions): Promise<ExaSearchResult> {
  const apiKey = options.apiKey.trim()
  const query = options.query.trim()
  const searchType = options.type ?? 'auto'
  const category = options.category ?? undefined
  const count = normalizeExaSearchCount(options.count)
  const includeDomains = normalizeStringList(options.includeDomains, 'includeDomains', MAX_DOMAIN_FILTERS)
  const excludeDomains = normalizeStringList(options.excludeDomains, 'excludeDomains', MAX_DOMAIN_FILTERS)
  const dateFilters = resolveDateFilters(options)
  const contents = createContentsPayload(options)
  const additionalQueries = (options.additionalQueries ?? []).map((item) => item.trim()).filter(Boolean)
  const systemPrompt = normalizeOptionalText(options.systemPrompt, 'systemPrompt', MAX_SYSTEM_PROMPT_CHARS)
  const outputSchema = normalizeOutputSchema(options.outputSchema, 'outputSchema')

  if (!apiKey) throw new Error('请先填写 Exa API Key')
  if (!query) throw new Error('缺少搜索词')
  if (!isValidExaSearchType(searchType)) throw new Error('Exa 搜索类型不受支持')
  if (category && !isValidExaSearchCategory(category)) throw new Error('Exa 搜索类别不受支持')
  if (additionalQueries.length > MAX_ADDITIONAL_QUERIES) {
    throw new Error(`additionalQueries 最多只能包含 ${MAX_ADDITIONAL_QUERIES} 条`)
  }
  validateCategoryFilters(category, includeDomains, excludeDomains, dateFilters)

  const requestBody = {
    query,
    type: searchType,
    numResults: count,
    contents,
    ...(category ? { category } : {}),
    ...(options.userLocation?.trim() ? { userLocation: options.userLocation.trim() } : {}),
    ...(includeDomains.length > 0 ? { includeDomains } : {}),
    ...(excludeDomains.length > 0 ? { excludeDomains } : {}),
    ...(dateFilters.startPublishedDate ? { startPublishedDate: dateFilters.startPublishedDate } : {}),
    ...(dateFilters.endPublishedDate ? { endPublishedDate: dateFilters.endPublishedDate } : {}),
    ...(dateFilters.startCrawlDate ? { startCrawlDate: dateFilters.startCrawlDate } : {}),
    ...(dateFilters.endCrawlDate ? { endCrawlDate: dateFilters.endCrawlDate } : {}),
    ...(additionalQueries.length > 0 ? { additionalQueries } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    ...(options.moderation !== undefined ? { moderation: options.moderation } : {}),
  }
  let responseStatus: number
  let payload: unknown

  if (canUseSearchApiProxy()) {
    const result = await postSearchApiJson({
      providerId: 'exa',
      apiKey,
      body: requestBody,
    })
    responseStatus = result.status
    payload = result.body
  } else {
    const response = await fetch(EXA_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    })
    responseStatus = response.status
    payload = (await response.json().catch(() => null)) as unknown
  }

  if (!isSuccessfulHttpStatus(responseStatus)) {
    const message = readExaErrorMessage(payload) ?? `Exa 搜索请求失败（HTTP ${responseStatus}）`
    throw new Error(message)
  }

  const payloadRecord = toRecord(payload)
  const rawResults = payloadRecord?.results
  const costDollars = toRecord(payloadRecord?.costDollars)

  return {
    requestId: readString(payloadRecord, 'requestId'),
    searchType: readString(payloadRecord, 'searchType'),
    resolvedSearchType: readString(payloadRecord, 'resolvedSearchType'),
    costDollarsTotal: readNumber(costDollars, 'total'),
    results: Array.isArray(rawResults) ? rawResults.flatMap((item) => parseWebPageResult(item) ?? []) : [],
    output: payloadRecord?.output ?? null,
  }
}
