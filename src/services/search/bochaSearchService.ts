import type { AiSearchFreshnessPreset } from '../../domain/ai'

const BOCHA_WEB_SEARCH_ENDPOINT = 'https://api.bocha.cn/v1/web-search'
const DEFAULT_SEARCH_COUNT = 10
const MIN_SEARCH_COUNT = 1
const MAX_SEARCH_COUNT = 50
const MAX_DOMAIN_FILTERS = 100
const DATE_FRESHNESS_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_RANGE_FRESHNESS_RE = /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/
const PRESET_FRESHNESS_VALUES: AiSearchFreshnessPreset[] = [
  'noLimit',
  'oneDay',
  'oneWeek',
  'oneMonth',
  'oneYear',
]

export interface BochaWebSearchOptions {
  apiKey: string
  query: string
  freshness?: string
  summary?: boolean
  include?: string | null
  exclude?: string | null
  count?: number
  signal?: AbortSignal
}

export interface BochaWebPageResult {
  title: string
  url: string
  displayUrl: string | null
  snippet: string | null
  summary: string | null
  siteName: string | null
  siteIcon: string | null
  datePublished: string | null
  dateLastCrawled: string | null
  cachedPageUrl: string | null
  language: string | null
}

export interface BochaImageResult {
  name: string | null
  thumbnailUrl: string | null
  contentUrl: string | null
  hostPageUrl: string | null
  hostPageDisplayUrl: string | null
  width: number | null
  height: number | null
  datePublished: string | null
}

export interface BochaWebSearchResult {
  logId: string | null
  originalQuery: string
  totalEstimatedMatches: number | null
  someResultsRemoved: boolean | null
  webResults: BochaWebPageResult[]
  imageResults: BochaImageResult[]
}

/** 判断 freshness 是否符合博查支持的预设或日期格式 */
export function isValidBochaFreshness(value: string): boolean {
  return (
    PRESET_FRESHNESS_VALUES.includes(value as AiSearchFreshnessPreset) ||
    DATE_FRESHNESS_RE.test(value) ||
    DATE_RANGE_FRESHNESS_RE.test(value)
  )
}

/** 把搜索条数限制在博查 Web Search API 支持范围内 */
export function normalizeBochaSearchCount(value: unknown, fallback = DEFAULT_SEARCH_COUNT): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(MAX_SEARCH_COUNT, Math.max(MIN_SEARCH_COUNT, Math.round(value)))
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

/** 从未知对象中读取布尔字段 */
function readBoolean(source: Record<string, unknown> | null, key: string): boolean | null {
  const value = source?.[key]
  return typeof value === 'boolean' ? value : null
}

/** 检查 include / exclude 域名列表长度，避免请求被博查拒绝 */
function normalizeDomainFilter(value: string | null | undefined, fieldName: string): string | undefined {
  if (!value?.trim()) return undefined

  const normalizedValue = value.trim()
  const domainCount = normalizedValue.split(/[|,]/).filter((item) => item.trim()).length
  if (domainCount > MAX_DOMAIN_FILTERS) {
    throw new Error(`${fieldName} 最多只能包含 ${MAX_DOMAIN_FILTERS} 个域名`)
  }
  return normalizedValue
}

/** 博查 dateLastCrawled 兼容字段实际表达 UTC+8，必要时修正成可解析的发布时间 */
function normalizePublishedDate(page: Record<string, unknown>): string | null {
  const datePublished = readString(page, 'datePublished')
  if (datePublished) return datePublished

  const dateLastCrawled = readString(page, 'dateLastCrawled')
  if (!dateLastCrawled) return null
  return dateLastCrawled.replace(/Z$/, '+08:00')
}

/** 从博查异常响应中提取可展示错误 */
function readBochaErrorMessage(payload: unknown): string | null {
  const record = toRecord(payload)
  if (!record) return null
  return readString(record, 'message') ?? readString(record, 'msg')
}

/** 解析博查 Web Search API 返回的网页结果 */
function parseWebPageResults(webPages: Record<string, unknown> | null): BochaWebPageResult[] {
  const rawItems = webPages?.value
  if (!Array.isArray(rawItems)) return []

  return rawItems.flatMap((item) => {
    const page = toRecord(item)
    const title = readString(page, 'name')
    const url = readString(page, 'url')
    if (!page || !title || !url) return []

    return [
      {
        title,
        url,
        displayUrl: readString(page, 'displayUrl'),
        snippet: readString(page, 'snippet'),
        summary: readString(page, 'summary'),
        siteName: readString(page, 'siteName'),
        siteIcon: readString(page, 'siteIcon'),
        datePublished: normalizePublishedDate(page),
        dateLastCrawled: readString(page, 'dateLastCrawled'),
        cachedPageUrl: readString(page, 'cachedPageUrl'),
        language: readString(page, 'language'),
      },
    ]
  })
}

/** 解析博查 Web Search API 返回的图片结果 */
function parseImageResults(images: Record<string, unknown> | null): BochaImageResult[] {
  const rawItems = images?.value
  if (!Array.isArray(rawItems)) return []

  return rawItems.flatMap((item) => {
    const image = toRecord(item)
    if (!image) return []

    return [
      {
        name: readString(image, 'name'),
        thumbnailUrl: readString(image, 'thumbnailUrl'),
        contentUrl: readString(image, 'contentUrl'),
        hostPageUrl: readString(image, 'hostPageUrl'),
        hostPageDisplayUrl: readString(image, 'hostPageDisplayUrl'),
        width: readNumber(image, 'width'),
        height: readNumber(image, 'height'),
        datePublished: readString(image, 'datePublished'),
      },
    ]
  })
}

/** 调用博查 Web Search API 并整理成 Mira 内部稳定结构 */
export async function searchBochaWeb(options: BochaWebSearchOptions): Promise<BochaWebSearchResult> {
  const apiKey = options.apiKey.trim()
  const query = options.query.trim()
  const freshness = options.freshness?.trim() || 'noLimit'
  const count = normalizeBochaSearchCount(options.count)
  const include = normalizeDomainFilter(options.include, 'include')
  const exclude = normalizeDomainFilter(options.exclude, 'exclude')

  if (!apiKey) throw new Error('请先填写博查 API Key')
  if (!query) throw new Error('缺少搜索词')
  if (!isValidBochaFreshness(freshness)) {
    throw new Error('搜索时间范围格式不正确')
  }

  const response = await fetch(BOCHA_WEB_SEARCH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      freshness,
      summary: options.summary === true,
      count,
      ...(include ? { include } : {}),
      ...(exclude ? { exclude } : {}),
    }),
    signal: options.signal,
  })
  const payload = (await response.json().catch(() => null)) as unknown
  const payloadRecord = toRecord(payload)
  const bodyCode = payloadRecord?.code

  if (!response.ok || (bodyCode !== undefined && bodyCode !== 200 && bodyCode !== '200')) {
    const message = readBochaErrorMessage(payload) ?? `博查搜索请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }

  const data = toRecord(payloadRecord?.data)
  const queryContext = toRecord(data?.queryContext)
  const webPages = toRecord(data?.webPages)
  const images = toRecord(data?.images)

  return {
    logId: readString(payloadRecord, 'log_id'),
    originalQuery: readString(queryContext, 'originalQuery') ?? query,
    totalEstimatedMatches: readNumber(webPages, 'totalEstimatedMatches'),
    someResultsRemoved: readBoolean(webPages, 'someResultsRemoved'),
    webResults: parseWebPageResults(webPages),
    imageResults: parseImageResults(images),
  }
}
