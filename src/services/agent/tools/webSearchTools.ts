import type {
  AiSearchProviderId,
  AiSearchRequestProviderSettings,
  AiSearchRequestSettings,
} from '../../../domain/ai'
import {
  normalizeBochaSearchCount,
  normalizeExaSearchCount,
  normalizeWebReadMaxChars,
  readWebPage,
  searchBochaWeb,
  searchExaWeb,
} from '../../search'
import type {
  BochaImageResult,
  BochaWebPageResult,
  ExaSearchCategory,
  ExaSearchType,
  ExaSubpageResult,
  ExaWebPageResult,
} from '../../search'
import type { AgentTool, AgentToolInput, AgentToolResult } from '../types'
import { clipWithMeta, readStringInput } from '../utils/text'

const MAX_SEARCH_QUERY_CHARS = 500
const MAX_IMAGE_RESULTS_FOR_AGENT = 10
const MAX_SNIPPET_CHARS = 240
const MAX_SUMMARY_CHARS = 700
const MAX_EXA_TEXT_CHARS = 2200
const MAX_EXA_HIGHLIGHT_CHARS = 900
const MAX_EXA_SUBPAGES_FOR_AGENT = 4
const MAX_EXA_EXTRA_LINKS_FOR_AGENT = 8
const MAX_EXA_OUTPUT_CHARS = 3000
const EXA_SEARCH_TYPES: ExaSearchType[] = ['auto', 'fast', 'instant', 'deep-lite', 'deep', 'deep-reasoning']
const EXA_SEARCH_CATEGORIES: ExaSearchCategory[] = [
  'company',
  'people',
  'research paper',
  'news',
  'personal site',
  'financial report',
]
const EXA_TEXT_VERBOSITIES = ['compact', 'standard', 'full'] as const

/** 将工具结果稳定序列化为紧凑 JSON，方便模型继续读取 */
function createJsonToolResult(value: unknown): AgentToolResult {
  return {
    content: JSON.stringify(value),
  }
}

/** 将错误也作为工具结果交还给模型，避免整轮对话直接失败 */
function createErrorToolResult(message: string): AgentToolResult {
  return {
    content: JSON.stringify({
      ok: false,
      error: message,
    }),
    isError: true,
  }
}

/** 裁剪长文本字段，减少单次搜索结果占用的上下文 */
function clipOptionalText(value: string | null, limit: number): string | null {
  if (!value) return null
  const clipped = clipWithMeta(value, limit)
  return clipped.isTruncated ? `${clipped.text}...` : clipped.text
}

/** 裁剪长文本字段，并保留是否被截断的信息 */
function clipOptionalTextWithMeta(value: string | null, limit: number) {
  if (!value) {
    return {
      text: null,
      isTruncated: false,
      remainingChars: 0,
    }
  }

  const clipped = clipWithMeta(value, limit)
  return {
    text: clipped.text,
    isTruncated: clipped.isTruncated,
    remainingChars: clipped.remainingChars,
  }
}

/** 从工具入参中读取布尔值 */
function readBooleanInput(input: AgentToolInput, key: string): boolean | undefined {
  const value = input[key]
  return typeof value === 'boolean' ? value : undefined
}

/** 从工具入参中读取数字值 */
function readNumberInput(input: AgentToolInput, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 从工具入参中读取字符串数组 */
function readStringArrayInput(input: AgentToolInput, key: string): string[] | undefined {
  const value = input[key]
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

/** 从工具入参中读取普通对象 */
function readRecordInput(input: AgentToolInput, key: string): Record<string, unknown> | undefined {
  const value = input[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 把网页结果压缩成 agent 继续推理需要的字段 */
function serializeBochaWebResult(result: BochaWebPageResult) {
  return {
    title: result.title,
    url: result.url,
    displayUrl: result.displayUrl,
    snippet: clipOptionalText(result.snippet, MAX_SNIPPET_CHARS),
    summary: clipOptionalText(result.summary, MAX_SUMMARY_CHARS),
    siteName: result.siteName,
    datePublished: result.datePublished,
    language: result.language,
  }
}

/** 把图片结果压缩成 agent 可引用的字段 */
function serializeBochaImageResult(result: BochaImageResult) {
  return {
    name: result.name,
    thumbnailUrl: result.thumbnailUrl,
    contentUrl: result.contentUrl,
    hostPageUrl: result.hostPageUrl,
    width: result.width,
    height: result.height,
    datePublished: result.datePublished,
  }
}

/** 序列化 Exa 子页面结果，避免子页面正文过长 */
function serializeExaSubpageResult(result: ExaSubpageResult) {
  const text = clipOptionalTextWithMeta(result.text, MAX_EXA_TEXT_CHARS)

  return {
    id: result.id,
    title: result.title,
    url: result.url,
    publishedDate: result.publishedDate,
    author: result.author,
    summary: clipOptionalText(result.summary, MAX_SUMMARY_CHARS),
    highlights: result.highlights.map((highlight) => clipOptionalText(highlight, MAX_EXA_HIGHLIGHT_CHARS)),
    highlightScores: result.highlightScores,
    text: text.text,
    isTextTruncated: text.isTruncated,
    remainingTextChars: text.remainingChars,
  }
}

/** 序列化 Exa 主结果，保留 highlights / summary / text 等 agent 关键证据 */
function serializeExaWebResult(result: ExaWebPageResult) {
  return {
    ...serializeExaSubpageResult(result),
    image: result.image,
    favicon: result.favicon,
    subpages: result.subpages.slice(0, MAX_EXA_SUBPAGES_FOR_AGENT).map(serializeExaSubpageResult),
    extraLinks: result.extraLinks.slice(0, MAX_EXA_EXTRA_LINKS_FOR_AGENT),
    extraImageLinks: result.extraImageLinks.slice(0, MAX_EXA_EXTRA_LINKS_FOR_AGENT),
  }
}

/** 裁剪 Exa structured output，防止结构化答案吃掉过多上下文 */
function serializeExaOutput(value: unknown) {
  if (value === null || value === undefined) return null

  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  const clipped = clipWithMeta(serialized, MAX_EXA_OUTPUT_CHARS)
  if (!clipped.isTruncated) return value

  return {
    isTruncated: true,
    remainingChars: clipped.remainingChars,
    content: clipped.text,
  }
}

/** 读取当前可供 agent 选择的搜索 provider */
function getAvailableSearchProviders(searchService: AiSearchRequestSettings): AiSearchRequestProviderSettings[] {
  return searchService.providers.length > 0 ? searchService.providers : [searchService]
}

/** 根据工具参数选择搜索 provider，未指定时使用设置里的默认 provider */
function resolveSearchProvider(
  searchService: AiSearchRequestSettings,
  input: AgentToolInput
): AiSearchRequestProviderSettings | null {
  const availableProviders = getAvailableSearchProviders(searchService)
  const requestedProviderId = readStringInput(input, 'provider') as AiSearchProviderId | null
  const defaultProvider =
    availableProviders.find((provider) => provider.providerId === searchService.activeProviderId) ??
    availableProviders[0]

  if (!requestedProviderId) return defaultProvider
  return availableProviders.find((provider) => provider.providerId === requestedProviderId) ?? null
}

/** 为工具描述生成当前 provider 的差异化使用提示 */
function createProviderUsageGuide(searchService: AiSearchRequestSettings): string {
  return getAvailableSearchProviders(searchService)
    .map((provider) => {
      if (provider.providerId === 'bocha') {
        return 'bocha=博查，中国国内与中文网页搜索，适合国内新闻、中文平台和本土资料。'
      }
      return 'exa=Exa，全球搜索工具，适合外网资料、GitHub/repo/技术文档、arXiv/Papers with Code/论文和国际新闻。'
    })
    .join(' ')
}

interface SearchToolSchemaContext {
  providerIds: AiSearchProviderId[]
  hasBochaProvider: boolean
  hasExaProvider: boolean
  hasMultipleProviders: boolean
}

/** 生成通用搜索参数；只在多个搜索源同时可用时暴露 provider 选择 */
function createCommonSearchProperties(context: SearchToolSchemaContext): Record<string, unknown> {
  const properties: Record<string, unknown> = {}

  if (context.hasMultipleProviders) {
    properties.provider = {
      type: 'string',
      enum: context.providerIds,
      description: '搜索源。不填时使用设置里的默认搜索源。bocha 适合国内中文；exa 是全球搜索工具。',
    }
  }

  properties.query = {
    type: 'string',
    description: context.hasExaProvider
      ? '搜索查询，尽量包含关键词、限定词、地区、年份或目标来源。Exa 支持自然语言问题，也支持代码/论文意图查询。'
      : '搜索查询，尽量包含关键词、地区、时间等限定信息。',
  }
  properties.freshness = {
    type: 'string',
    description:
      '搜索时间范围。可用 noLimit、oneDay、oneWeek、oneMonth、oneYear，也可用 YYYY-MM-DD 或 YYYY-MM-DD..YYYY-MM-DD。默认使用设置值。',
  }
  properties.include = {
    type: 'string',
    description: context.hasExaProvider
      ? '限定搜索网站范围，多个域名用 | 或 , 分隔。Exa 搜 GitHub 可填 github.com，搜论文可填 arxiv.org|paperswithcode.com|semanticscholar.org。'
      : '限定搜索网站范围，多个域名用 | 或 , 分隔，最多 100 个，例如 qq.com|m.163.com。',
  }
  properties.exclude = {
    type: 'string',
    description: context.hasBochaProvider
      ? '排除搜索网站范围，多个域名用 | 或 , 分隔。博查最多 100 个域名。'
      : '排除搜索网站范围，多个域名用 | 或 , 分隔。',
  }
  properties.count = {
    type: 'number',
    description: context.hasExaProvider
      ? '返回结果数量。Exa 范围 1-100；博查范围 1-50。默认使用设置值。'
      : '返回结果数量，范围 1-50，默认使用设置值。',
  }

  return properties
}

/** 生成博查独有参数；只有博查启用时才暴露 */
function createBochaSearchProperties(): Record<string, unknown> {
  return {
    includeImages: {
      type: 'boolean',
      description: '仅博查使用：是否在结果中附带图片搜索结果，默认 false。',
    },
  }
}

/** 生成 Exa 独有参数；只有 Exa 启用时才暴露，避免模型在纯博查场景看到过多无关字段 */
function createExaSearchProperties(): Record<string, unknown> {
  return {
    exaType: {
      type: 'string',
      enum: EXA_SEARCH_TYPES,
      description:
        '仅 Exa 使用：auto 让 Exa 自动选择策略；fast/instant 更快；deep-lite/deep/deep-reasoning 用于复杂研究和高质量资料收集。',
    },
    exaCategory: {
      type: 'string',
      enum: EXA_SEARCH_CATEGORIES,
      description:
        '仅 Exa 使用：垂直搜索类别。论文优先用 research paper；新闻用 news；公司/人物/财报/个人站点按需选择。',
    },
    userLocation: {
      type: 'string',
      description: '仅 Exa 使用：搜索位置提示，例如 US、China、San Francisco，用于本地化或区域性问题。',
    },
    startPublishedDate: {
      type: 'string',
      description: '仅 Exa 使用：结果发布时间下限，YYYY-MM-DD 或 ISO 8601。会覆盖 freshness 的开始时间。',
    },
    endPublishedDate: {
      type: 'string',
      description: '仅 Exa 使用：结果发布时间上限，YYYY-MM-DD 或 ISO 8601。会覆盖 freshness 的结束时间。',
    },
    startCrawlDate: {
      type: 'string',
      description: '仅 Exa 使用：Exa 抓取时间下限，YYYY-MM-DD 或 ISO 8601，适合找最近被索引的页面。',
    },
    endCrawlDate: {
      type: 'string',
      description: '仅 Exa 使用：Exa 抓取时间上限，YYYY-MM-DD 或 ISO 8601。',
    },
    additionalQueries: {
      type: 'array',
      items: { type: 'string' },
      description: '仅 Exa 使用：与主查询一起执行的额外查询，最多 5 条，适合覆盖同义词、论文题名、库名。',
    },
    systemPrompt: {
      type: 'string',
      description: '仅 Exa 使用：指导 Exa 如何理解查询或生成 structured output，保持简短。',
    },
    outputSchema: {
      type: 'object',
      description: '仅 Exa 使用：请求 Exa 返回结构化 output 的 JSON Schema。只在确实需要表格化抽取时使用。',
      additionalProperties: true,
    },
    moderation: {
      type: 'boolean',
      description: '仅 Exa 使用：是否启用 Exa moderation。',
    },
    includeText: {
      type: 'boolean',
      description:
        '仅 Exa 使用：是否返回页面正文片段。默认 false；需要直接比较 GitHub README、论文摘要或技术文档时设为 true。',
    },
    textMaxCharacters: {
      type: 'number',
      description: '仅 Exa 使用：每条结果最多返回多少正文字符，最大 20000。返回内容仍会被 Mira 再裁剪。',
    },
    textIncludeHtmlTags: {
      type: 'boolean',
      description: '仅 Exa 使用：正文是否保留 HTML 标签，默认 false。',
    },
    textVerbosity: {
      type: 'string',
      enum: EXA_TEXT_VERBOSITIES,
      description: '仅 Exa 使用：正文详细程度，默认 standard。compact 更省上下文，full 更适合精读少量页面。',
    },
    textIncludeSections: {
      type: 'array',
      items: { type: 'string' },
      description: '仅 Exa 使用：只包含指定页面区块，例如 body、metadata。',
    },
    textExcludeSections: {
      type: 'array',
      items: { type: 'string' },
      description: '仅 Exa 使用：排除指定页面区块，例如 header、navigation、banner、footer、sidebar。',
    },
    includeHighlights: {
      type: 'boolean',
      description: '仅 Exa 使用：是否返回命中 highlights，默认 true。通常先用 highlights，再对少量 URL 调 web_read_url。',
    },
    highlightsQuery: {
      type: 'string',
      description: '仅 Exa 使用：用于生成 highlights 的查询，可比 query 更聚焦。',
    },
    highlightsMaxCharacters: {
      type: 'number',
      description: '仅 Exa 使用：每条 highlight 最多字符数，最大 3000。',
    },
    includeSummary: {
      type: 'boolean',
      description: '仅 Exa 使用：是否让 Exa 生成摘要，适合论文/长文初筛。',
    },
    summaryQuery: {
      type: 'string',
      description: '仅 Exa 使用：指导摘要关注什么，例如 方法、结论、限制、API 参数。',
    },
    summarySchema: {
      type: 'object',
      description: '仅 Exa 使用：summary 的结构化 JSON Schema，通常不需要。',
      additionalProperties: true,
    },
    maxAgeHours: {
      type: 'number',
      description: '仅 Exa 使用：可接受缓存内容的最大小时数。设为 0 强制实时抓取最新内容；设为 -1 不实时抓取。',
    },
    livecrawlTimeout: {
      type: 'number',
      description: '仅 Exa 使用：livecrawl 超时毫秒数，范围 1000-60000。',
    },
    subpages: {
      type: 'number',
      description: '仅 Exa 使用：每个结果追加抓取多少相关子页面，适合 docs 站点或 GitHub 仓库文档。',
    },
    subpageTarget: {
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
      description: '仅 Exa 使用：指定子页面目标，例如 docs、api、README、examples。',
    },
    extraLinks: {
      type: 'number',
      description: '仅 Exa 使用：每条结果附带多少额外链接，最大 20。',
    },
    extraImageLinks: {
      type: 'number',
      description: '仅 Exa 使用：每条结果附带多少图片链接，最大 20。',
    },
  }
}

/** 按当前启用 provider 动态生成 web_search 入参 schema */
function createWebSearchParameters(context: SearchToolSchemaContext): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      ...createCommonSearchProperties(context),
      ...(context.hasBochaProvider ? createBochaSearchProperties() : {}),
      ...(context.hasExaProvider ? createExaSearchProperties() : {}),
    },
    required: ['query'],
    additionalProperties: false,
  }
}

/** 按当前启用 provider 动态生成 web_search 描述，避免提示不可用搜索源 */
function createWebSearchDescription(context: SearchToolSchemaContext, providerUsageGuide: string): string {
  const providerSelectionGuide = context.hasMultipleProviders
    ? '根据任务选择 provider：国内中文内容优先 bocha；外网、GitHub、论文、英文技术资料和国际来源优先 exa。'
    : context.hasExaProvider
      ? '当前只启用 Exa，它是全球搜索工具，优先用于外网、GitHub、论文、英文技术资料和国际来源。'
      : '当前只启用博查，优先用于中国国内与中文网页搜索。'

  return (
    `搜索公开网页信息。当前可用搜索源：${providerUsageGuide} ` +
    providerSelectionGuide +
    '不要用它搜索用户本地笔记；本地笔记请用 vault_search_notes。不要把当前笔记全文或隐私内容直接作为搜索词。' +
    '需要阅读全文时，再对高相关结果调用 web_read_url。回答使用搜索结果时，应尽量引用结果里的 title 和 url。'
  )
}

/** 执行博查搜索并整理结果 */
async function executeBochaSearch(
  provider: AiSearchRequestProviderSettings,
  input: AgentToolInput,
  query: string,
  signal: AbortSignal | undefined
): Promise<AgentToolResult> {
  const freshness = readStringInput(input, 'freshness') ?? provider.defaultFreshness
  const include = readStringInput(input, 'include')
  const exclude = readStringInput(input, 'exclude')
  const count = normalizeBochaSearchCount(
    typeof input.count === 'number' ? input.count : provider.defaultCount,
    provider.defaultCount
  )
  const includeImages = input.includeImages === true

  const result = await searchBochaWeb({
    apiKey: provider.apiKey,
    query,
    freshness,
    summary: true,
    include,
    exclude,
    count,
    signal,
  })

  return createJsonToolResult({
    ok: true,
    provider: provider.providerId,
    providerLabel: provider.providerLabel,
    query: result.originalQuery,
    freshness,
    count,
    totalEstimatedMatches: result.totalEstimatedMatches,
    someResultsRemoved: result.someResultsRemoved,
    results: result.webResults.map(serializeBochaWebResult),
    images: includeImages
      ? result.imageResults.slice(0, MAX_IMAGE_RESULTS_FOR_AGENT).map(serializeBochaImageResult)
      : undefined,
  })
}

/** 执行 Exa 全球搜索并整理结果 */
async function executeExaSearch(
  provider: AiSearchRequestProviderSettings,
  input: AgentToolInput,
  query: string,
  signal: AbortSignal | undefined
): Promise<AgentToolResult> {
  const freshness = readStringInput(input, 'freshness') ?? provider.defaultFreshness
  const include = readStringInput(input, 'include')
  const exclude = readStringInput(input, 'exclude')
  const count = normalizeExaSearchCount(readNumberInput(input, 'count') ?? provider.defaultCount, provider.defaultCount)
  const exaType = (readStringInput(input, 'exaType') ?? 'auto') as ExaSearchType
  const exaCategory = readStringInput(input, 'exaCategory') as ExaSearchCategory | null

  const result = await searchExaWeb({
    apiKey: provider.apiKey,
    query,
    type: exaType,
    category: exaCategory,
    userLocation: readStringInput(input, 'userLocation'),
    count,
    freshness,
    includeDomains: include,
    excludeDomains: exclude,
    startPublishedDate: readStringInput(input, 'startPublishedDate'),
    endPublishedDate: readStringInput(input, 'endPublishedDate'),
    startCrawlDate: readStringInput(input, 'startCrawlDate'),
    endCrawlDate: readStringInput(input, 'endCrawlDate'),
    additionalQueries: readStringArrayInput(input, 'additionalQueries'),
    systemPrompt: readStringInput(input, 'systemPrompt'),
    outputSchema: readRecordInput(input, 'outputSchema'),
    moderation: readBooleanInput(input, 'moderation'),
    includeText: readBooleanInput(input, 'includeText'),
    textMaxCharacters: readNumberInput(input, 'textMaxCharacters'),
    textIncludeHtmlTags: readBooleanInput(input, 'textIncludeHtmlTags'),
    textVerbosity: readStringInput(input, 'textVerbosity') as 'compact' | 'standard' | 'full' | null,
    textIncludeSections: readStringArrayInput(input, 'textIncludeSections'),
    textExcludeSections: readStringArrayInput(input, 'textExcludeSections'),
    includeHighlights: readBooleanInput(input, 'includeHighlights'),
    highlightsQuery: readStringInput(input, 'highlightsQuery'),
    highlightsMaxCharacters: readNumberInput(input, 'highlightsMaxCharacters'),
    includeSummary: readBooleanInput(input, 'includeSummary'),
    summaryQuery: readStringInput(input, 'summaryQuery'),
    summarySchema: readRecordInput(input, 'summarySchema'),
    maxAgeHours: readNumberInput(input, 'maxAgeHours'),
    livecrawlTimeout: readNumberInput(input, 'livecrawlTimeout'),
    subpages: readNumberInput(input, 'subpages'),
    subpageTarget: readStringArrayInput(input, 'subpageTarget') ?? readStringInput(input, 'subpageTarget'),
    extraLinks: readNumberInput(input, 'extraLinks'),
    extraImageLinks: readNumberInput(input, 'extraImageLinks'),
    signal,
  })

  return createJsonToolResult({
    ok: true,
    provider: provider.providerId,
    providerLabel: provider.providerLabel,
    query,
    freshness,
    exaType,
    exaCategory,
    count,
    searchType: result.searchType,
    resolvedSearchType: result.resolvedSearchType,
    requestId: result.requestId,
    costDollarsTotal: result.costDollarsTotal,
    results: result.results.map(serializeExaWebResult),
    output: serializeExaOutput(result.output),
  })
}

/** 创建 agent 可用的联网搜索工具集合 */
export function createWebSearchAgentTools(searchService: AiSearchRequestSettings | null): AgentTool[] {
  if (!searchService) return []

  const availableProviders = getAvailableSearchProviders(searchService)
  const providerIds = availableProviders.map((provider) => provider.providerId)
  const hasBochaProvider = providerIds.includes('bocha')
  const hasExaProvider = providerIds.includes('exa')
  const providerUsageGuide = createProviderUsageGuide(searchService)
  const searchToolSchemaContext: SearchToolSchemaContext = {
    providerIds,
    hasBochaProvider,
    hasExaProvider,
    hasMultipleProviders: providerIds.length > 1,
  }

  return [
    {
      name: 'web_search',
      description: createWebSearchDescription(searchToolSchemaContext, providerUsageGuide),
      parameters: createWebSearchParameters(searchToolSchemaContext),
      async execute(input, context) {
        const query = readStringInput(input, 'query')
        if (!query) return createErrorToolResult('缺少 query')
        if (query.length > MAX_SEARCH_QUERY_CHARS) {
          return createErrorToolResult(`query 不能超过 ${MAX_SEARCH_QUERY_CHARS} 个字符`)
        }

        const provider = resolveSearchProvider(searchService, input)
        if (!provider) {
          return createErrorToolResult('指定的搜索 provider 未启用或未填写 API Key')
        }

        try {
          if (provider.providerId === 'bocha') {
            return await executeBochaSearch(provider, input, query, context.signal)
          }
          return await executeExaSearch(provider, input, query, context.signal)
        } catch (error) {
          return createErrorToolResult(error instanceof Error ? error.message : '联网搜索失败')
        }
      },
    },
    {
      name: 'web_read_url',
      description:
        '读取公开网页 URL 的正文，并清洗为适合 AI 使用的 Markdown。适合在 web_search 找到候选链接后深读 1-3 个高相关网页。只允许 http/https 公网地址；不要读取 localhost、内网、登录后页面或用户隐私链接。回答引用网页内容时，应附带原始 URL。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要读取的公开网页 URL，必须是 http 或 https。',
          },
          maxChars: {
            type: 'number',
            description: '最多返回多少字符，默认 12000，最大 30000。',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      async execute(input) {
        const url = readStringInput(input, 'url')
        if (!url) return createErrorToolResult('缺少 url')

        try {
          const result = await readWebPage({
            url,
            maxChars: normalizeWebReadMaxChars(input.maxChars),
          })

          return createJsonToolResult({
            ok: true,
            url: result.url,
            finalUrl: result.finalUrl,
            title: result.title,
            byline: result.byline,
            siteName: result.siteName,
            description: result.description,
            publishedAt: result.publishedAt,
            language: result.language,
            wordCount: result.wordCount,
            contentType: result.contentType,
            bytesRead: result.bytesRead,
            isFetchTruncated: result.isFetchTruncated,
            isContentTruncated: result.isContentTruncated,
            remainingChars: result.remainingChars,
            content: result.content,
          })
        } catch (error) {
          return createErrorToolResult(error instanceof Error ? error.message : '网页读取失败')
        }
      },
    },
  ]
}
