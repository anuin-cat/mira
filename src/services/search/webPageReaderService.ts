import { fetchWebUrl } from '../../tauri/web'
import type { WebFetchResult } from '../../tauri/web'

const DEFAULT_WEB_READ_MAX_CHARS = 12000
const MAX_WEB_READ_CHARS = 30000
const DEFAULT_WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024
const MIN_EXTRACTED_CONTENT_CHARS = 80

export interface WebPageReadOptions {
  url: string
  maxChars?: number
}

export interface WebPageReadResult {
  ok: true
  url: string
  finalUrl: string
  title: string | null
  byline: string | null
  siteName: string | null
  description: string | null
  publishedAt: string | null
  language: string | null
  content: string
  wordCount: number | null
  contentType: string | null
  bytesRead: number
  isFetchTruncated: boolean
  isContentTruncated: boolean
  remainingChars: number
}

/** 把数字限制在网页读取允许的字符范围内 */
export function normalizeWebReadMaxChars(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_WEB_READ_MAX_CHARS
  return Math.min(MAX_WEB_READ_CHARS, Math.max(1, Math.round(value)))
}

/** 按字符数裁剪文本，并返回裁剪元信息 */
function clipTextWithMeta(value: string, limit: number): {
  text: string
  isTruncated: boolean
  remainingChars: number
} {
  if (value.length <= limit) {
    return {
      text: value,
      isTruncated: false,
      remainingChars: 0,
    }
  }

  return {
    text: value.slice(0, limit),
    isTruncated: true,
    remainingChars: value.length - limit,
  }
}

/** 从 HTML 文档中提取纯文本，作为正文抽取失败时的低保真回退 */
function extractFallbackText(document: Document): string {
  const body = document.body?.cloneNode(true)
  if (!(body instanceof HTMLElement)) return ''

  body.querySelectorAll('script, style, noscript, svg, canvas, iframe, nav, header, footer, aside, form').forEach((node) => {
    node.remove()
  })

  return normalizeMarkdownText(body.textContent ?? '')
}

/** 判断响应是否是纯文本，纯文本无需再走 HTML 正文抽取 */
function isPlainTextContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('text/plain') ?? false
}

/** 进一步压缩 Defuddle 结果中的空白，避免污染 agent 上下文 */
function normalizeMarkdownText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

/** 将纯文本响应整理成与网页正文抽取一致的结果结构 */
function extractPlainTextContent(text: string): Awaited<ReturnType<typeof extractReadableContent>> {
  return {
    title: null,
    byline: null,
    siteName: null,
    description: null,
    publishedAt: null,
    language: null,
    content: normalizeMarkdownText(text),
    wordCount: null,
  }
}

/** 解析网页 HTML，优先用 Defuddle 生成 AI 友好的 Markdown 内容 */
async function extractReadableContent(html: string, url: string): Promise<{
  title: string | null
  byline: string | null
  siteName: string | null
  description: string | null
  publishedAt: string | null
  language: string | null
  content: string
  wordCount: number | null
}> {
  const document = new DOMParser().parseFromString(html, 'text/html')

  try {
    const { default: Defuddle } = await import('defuddle/full')
    const defuddle = new Defuddle(document, {
      url,
      markdown: true,
      removeImages: true,
      includeReplies: false,
      useAsync: false,
    })
    const result = defuddle.parse()
    const content = normalizeMarkdownText(result.contentMarkdown ?? result.content ?? '')

    return {
      title: result.title || document.title || null,
      byline: result.author || null,
      siteName: result.site || result.domain || null,
      description: result.description || null,
      publishedAt: result.published || null,
      language: result.language || document.documentElement.lang || null,
      content: content.length >= MIN_EXTRACTED_CONTENT_CHARS ? content : extractFallbackText(document),
      wordCount: typeof result.wordCount === 'number' && Number.isFinite(result.wordCount) ? result.wordCount : null,
    }
  } catch {
    return {
      title: document.title || null,
      byline: null,
      siteName: null,
      description: null,
      publishedAt: null,
      language: document.documentElement.lang || null,
      content: extractFallbackText(document),
      wordCount: null,
    }
  }
}

/** 将网页抓取与正文清洗结果合并成 agent 可消费的结构 */
function createReadResult(
  originalUrl: string,
  fetched: WebFetchResult,
  extracted: Awaited<ReturnType<typeof extractReadableContent>>,
  maxChars: number
): WebPageReadResult {
  const clipped = clipTextWithMeta(extracted.content, maxChars)

  return {
    ok: true,
    url: originalUrl,
    finalUrl: fetched.finalUrl,
    title: extracted.title,
    byline: extracted.byline,
    siteName: extracted.siteName,
    description: extracted.description,
    publishedAt: extracted.publishedAt,
    language: extracted.language,
    content: clipped.text,
    wordCount: extracted.wordCount,
    contentType: fetched.contentType,
    bytesRead: fetched.bytesRead,
    isFetchTruncated: fetched.isTruncated,
    isContentTruncated: clipped.isTruncated,
    remainingChars: clipped.remainingChars,
  }
}

/** 本地读取公开网页并清洗为 Markdown 正文 */
export async function readWebPage(options: WebPageReadOptions): Promise<WebPageReadResult> {
  const url = options.url.trim()
  if (!url) throw new Error('缺少 URL')

  const maxChars = normalizeWebReadMaxChars(options.maxChars)
  const fetched = await fetchWebUrl({
    url,
    maxBytes: DEFAULT_WEB_FETCH_MAX_BYTES,
  })
  const extracted = isPlainTextContentType(fetched.contentType)
    ? extractPlainTextContent(fetched.html)
    : await extractReadableContent(fetched.html, fetched.finalUrl)
  if (!extracted.content.trim()) throw new Error('未能从网页中提取到可读正文')

  return createReadResult(url, fetched, extracted, maxChars)
}
