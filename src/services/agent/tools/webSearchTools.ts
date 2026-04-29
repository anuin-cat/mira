import type { AiSearchRequestSettings } from '../../../domain/ai'
import { normalizeBochaSearchCount, normalizeWebReadMaxChars, readWebPage, searchBochaWeb } from '../../search'
import type { BochaImageResult, BochaWebPageResult } from '../../search'
import type { AgentTool, AgentToolResult } from '../types'
import { clipWithMeta, readStringInput } from '../utils/text'

const MAX_SEARCH_QUERY_CHARS = 500
const MAX_IMAGE_RESULTS_FOR_AGENT = 10
const MAX_SNIPPET_CHARS = 240
const MAX_SUMMARY_CHARS = 700

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

/** 把网页结果压缩成 agent 继续推理需要的字段 */
function serializeWebResult(result: BochaWebPageResult) {
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
function serializeImageResult(result: BochaImageResult) {
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

/** 创建 agent 可用的联网搜索工具集合 */
export function createWebSearchAgentTools(searchService: AiSearchRequestSettings | null): AgentTool[] {
  if (!searchService || searchService.providerId !== 'bocha') return []

  return [
    {
      name: 'web_search',
      description:
        '搜索公开网页信息。适合查询最新事实、外部资料、新闻、产品文档、网页来源。不要用它搜索用户本地笔记；本地笔记请用 vault_search_notes。不要把当前笔记全文或隐私内容直接作为搜索词。需要阅读全文时，再对高相关结果调用 web_read_url。回答使用搜索结果时，应尽量引用结果里的 title 和 url。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询，尽量包含关键词、地区、时间等限定信息。',
          },
          freshness: {
            type: 'string',
            description:
              '搜索时间范围。可用 noLimit、oneDay、oneWeek、oneMonth、oneYear，也可用 YYYY-MM-DD 或 YYYY-MM-DD..YYYY-MM-DD。默认使用设置值。',
          },
          include: {
            type: 'string',
            description: '限定搜索网站范围，多个域名用 | 或 , 分隔，最多 100 个，例如 qq.com|m.163.com。',
          },
          exclude: {
            type: 'string',
            description: '排除搜索网站范围，多个域名用 | 或 , 分隔，最多 100 个。',
          },
          count: {
            type: 'number',
            description: '返回结果数量，范围 1-50，默认使用设置值。',
          },
          includeImages: {
            type: 'boolean',
            description: '是否在结果中附带图片搜索结果，默认 false。',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async execute(input, context) {
        const query = readStringInput(input, 'query')
        if (!query) return createErrorToolResult('缺少 query')
        if (query.length > MAX_SEARCH_QUERY_CHARS) {
          return createErrorToolResult(`query 不能超过 ${MAX_SEARCH_QUERY_CHARS} 个字符`)
        }

        const freshness = readStringInput(input, 'freshness') ?? searchService.defaultFreshness
        const include = readStringInput(input, 'include')
        const exclude = readStringInput(input, 'exclude')
        const count = normalizeBochaSearchCount(
          typeof input.count === 'number' ? input.count : searchService.defaultCount,
          searchService.defaultCount
        )
        const includeImages = input.includeImages === true

        try {
          const result = await searchBochaWeb({
            apiKey: searchService.apiKey,
            query,
            freshness,
            summary: true,
            include,
            exclude,
            count,
            signal: context.signal,
          })

          return createJsonToolResult({
            ok: true,
            provider: searchService.providerId,
            query: result.originalQuery,
            freshness,
            count,
            totalEstimatedMatches: result.totalEstimatedMatches,
            someResultsRemoved: result.someResultsRemoved,
            results: result.webResults.map(serializeWebResult),
            images: includeImages
              ? result.imageResults.slice(0, MAX_IMAGE_RESULTS_FOR_AGENT).map(serializeImageResult)
              : undefined,
          })
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
