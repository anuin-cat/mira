import { openUrl } from '@tauri-apps/plugin-opener'
import 'katex/dist/katex.min.css'
import rehypeKatex from 'rehype-katex'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { remarkAiMarkdownCompat } from './aiMarkdownCompat'
import './ai-markdown.css'

interface Props {
  content: string
}

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 把 Markdown 链接整理为允许打开的外部地址 */
function normalizeExternalHref(href: string | undefined): string | null {
  // 1. 先过滤空值和锚点，避免在 WebView 内触发无意义跳转
  const trimmedHref = href?.trim()
  if (!trimmedHref || trimmedHref.startsWith('#')) return null

  // 2. 再校验协议，只放行明确白名单里的外链
  try {
    const url = new URL(trimmedHref)
    return SAFE_URL_PROTOCOLS.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

const MARKDOWN_COMPONENTS: Components = {
  a({ node: _node, href, children, ...props }) {
    const safeHref = normalizeExternalHref(href)

    return (
      <a
        {...props}
        href={safeHref ?? undefined}
        className={safeHref ? 'ai-markdown-link' : 'ai-markdown-link ai-markdown-link-disabled'}
        rel="noreferrer"
        title={safeHref ?? '暂不支持打开这类链接'}
        onClick={(event) => {
          event.preventDefault()
          if (!safeHref) return
          void openUrl(safeHref)
        }}
      >
        {children}
      </a>
    )
  },
}

/** AI 回复的只读 Markdown 渲染组件 */
export function AiMarkdown({ content }: Props) {
  return (
    <div className="ai-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath, remarkAiMarkdownCompat]}
        rehypePlugins={[rehypeKatex]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </Markdown>
    </div>
  )
}
