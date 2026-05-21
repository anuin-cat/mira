const MARKDOWN_PASTE_BLOCK_RE =
  /(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+|```|~~~|\|.+\|\s*$|(?:[-*_]\s*){3,}$)/m
const MARKDOWN_PASTE_INLINE_RE =
  /(?:!\[[^\]]*]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`)/
const MARKDOWN_PASTE_DISPLAY_MATH_RE = /(?:^|\n)\s{0,3}\$\$[\s\S]*?\S[\s\S]*?\$\$\s*(?=\n|$)/
const MARKDOWN_PASTE_INLINE_MATH_RE = /(^|[^\\$])\$((?:\\.|[^$\n])+)\$(?!\$)/
const MARKDOWN_REFERENCE_LINK_RE = /!?\[(?:\\.|[^\]\\\n])+\]\[(?:\\.|[^\]\\\n])*\]/
const MARKDOWN_REFERENCE_DEFINITION_RE = /^\s{0,3}\[(?:\\.|[^\]\\\n])+]:/
const MARKDOWN_FOOTNOTE_REFERENCE_RE = /\[\^(?:\\.|[^\]\\\n])+\]/
const MARKDOWN_FOOTNOTE_DEFINITION_RE = /^\s{0,3}\[\^(?:\\.|[^\]\\\n])+]:/
const FENCED_CODE_BLOCK_RE = /^(\s*)(`{3,}|~{3,})(.*)$/
const MDX_SUPPORTED_HTML_TAGS = new Set(['img', 'sub', 'sup', 'u'])
const MDX_TAG_NAME_START_RE = /[A-Za-z/$!?]/
const MARKDOWN_PLAIN_TEXT_ESCAPE_RE = /[\\`*_[\]{}()#+\-.!|<>~$]/g
const URL_AUTOLINK_RE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]+$/
const EMAIL_AUTOLINK_RE = /^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/

export type MarkdownPasteMode = 'markdown' | 'plain-text' | 'native'

/** 归一化剪贴板里的 Markdown 文本，减少 BOM 与换行差异干扰 */
function normalizeMarkdownPasteText(text: string) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

/** 判断纯文本里是否有需要走 Markdown 导入的数学公式 */
function hasMarkdownMath(text: string) {
  if (MARKDOWN_PASTE_DISPLAY_MATH_RE.test(text)) return true
  return MARKDOWN_PASTE_INLINE_MATH_RE.test(text)
}

/** 去掉行内代码片段，避免代码里的 Markdown 字面量影响粘贴策略 */
function stripInlineCodeSpans(line: string) {
  let result = ''
  let cursor = 0

  // 1. 顺序扫描整行，只把成对反引号中的内容排除出语法探测
  while (cursor < line.length) {
    if (line[cursor] === '`') {
      const delimiterMatch = /^`+/.exec(line.slice(cursor))
      const delimiter = delimiterMatch?.[0] ?? '`'
      const closingIndex = line.indexOf(delimiter, cursor + delimiter.length)
      if (closingIndex !== -1) {
        cursor = closingIndex + delimiter.length
        continue
      }
    }

    // 2. 未闭合反引号按普通文本处理，避免误吞掉整行
    result += line[cursor]
    cursor += 1
  }

  return result
}

/** 判断当前行是否含有 MDXEditor 已知不能稳定导入的 Markdown 结构 */
function hasKnownUnsupportedMdxSyntaxLine(line: string) {
  const searchableLine = stripInlineCodeSpans(line)

  return (
    MARKDOWN_REFERENCE_DEFINITION_RE.test(searchableLine) ||
    MARKDOWN_REFERENCE_LINK_RE.test(searchableLine) ||
    MARKDOWN_FOOTNOTE_DEFINITION_RE.test(searchableLine) ||
    MARKDOWN_FOOTNOTE_REFERENCE_RE.test(searchableLine)
  )
}

/** 判断 Markdown 是否包含会让 MDXEditor 部分导入后中断的已知结构 */
function hasKnownUnsupportedMdxPasteSyntax(text: string) {
  const normalizedText = normalizeMarkdownPasteText(text)
  const lines = normalizedText.split('\n')
  let activeFence: { marker: '`' | '~'; length: number } | null = null

  // 1. 围栏代码块里的内容应按代码保留，不参与 Markdown 结构探测
  for (const line of lines) {
    const fenceMatch = matchFence(line)
    if (activeFence) {
      if (
        fenceMatch &&
        fenceMatch[2][0] === activeFence.marker &&
        fenceMatch[2].length >= activeFence.length
      ) {
        activeFence = null
      }
      continue
    }

    if (fenceMatch) {
      activeFence = {
        marker: fenceMatch[2][0] as '`' | '~',
        length: fenceMatch[2].length,
      }
      continue
    }

    // 2. reference link、definition、footnote 会生成 MDXEditor 无 visitor 的 mdast 节点
    if (hasKnownUnsupportedMdxSyntaxLine(line)) return true
  }

  return false
}

/** 判断一段纯文本是否明显带有 Markdown 语法，避免误伤普通粘贴 */
export function looksLikeMarkdown(text: string) {
  // 1. 先过滤空白内容，避免无意义的语法判断
  const normalizedText = text.trim()
  if (!normalizedText) return false

  // 2. 公式需要主动走 Markdown 导入，否则会被 Lexical 当普通文本粘贴
  if (hasMarkdownMath(normalizedText)) return true

  // 3. 优先识别标题、列表、引用、代码块、表格等块级语法
  if (MARKDOWN_PASTE_BLOCK_RE.test(normalizedText)) return true

  // 4. 再补充识别粗体、链接、行内代码等常见行内语法
  return MARKDOWN_PASTE_INLINE_RE.test(normalizedText)
}

/** 判断剪贴板文本应以何种方式进入 MDXEditor */
export function getMarkdownPasteMode(text: string): MarkdownPasteMode {
  // 1. 普通纯文本交给浏览器和 Lexical 原生粘贴，减少不必要的接管
  if (!looksLikeMarkdown(text)) return 'native'

  // 2. MDXEditor 已知不支持的 Markdown 结构按纯文本插入，优先保证内容完整
  if (hasKnownUnsupportedMdxPasteSyntax(text)) return 'plain-text'

  return 'markdown'
}

/** 判断当前行是否开启或关闭了围栏代码块 */
function matchFence(line: string) {
  return FENCED_CODE_BLOCK_RE.exec(line)
}

/** 判断原始 HTML 片段是否是编辑器自身可稳定回读的少数标签 */
function isSafeMdxHtmlTag(segment: string) {
  const inner = segment.slice(1, -1).trim()
  const tagNameMatch = /^\/?\s*([A-Za-z_$][A-Za-z0-9_$:-]*)/.exec(inner)
  if (!tagNameMatch) return false

  return MDX_SUPPORTED_HTML_TAGS.has(tagNameMatch[1].toLowerCase())
}

/** 判断尖括号包裹内容是否是 Markdown 自动链接 */
function getAutolinkReplacement(segment: string) {
  const inner = segment.slice(1, -1).trim()
  if (URL_AUTOLINK_RE.test(inner) || EMAIL_AUTOLINK_RE.test(inner)) return inner
  return null
}

/** 转义一整段尖括号内容，避免被 MDX 当成 JSX / HTML 解析 */
function escapeAngleBracketSegment(segment: string) {
  return segment.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 判断 `<` 后首个有效字符是否足以触发 MDX 标签解析 */
function canStartMdxTagLikeSyntax(line: string, startIndex: number) {
  for (let cursor = startIndex + 1; cursor < line.length; cursor += 1) {
    const char = line[cursor]
    if (char === ' ' || char === '\t') continue
    return MDX_TAG_NAME_START_RE.test(char)
  }

  return false
}

/** 清洗单行普通 Markdown，跳过行内代码后再处理危险尖括号 */
function sanitizeMarkdownLine(line: string) {
  let result = ''
  let cursor = 0

  // 1. 顺序扫描当前行，优先保留行内代码内容不做任何改写
  while (cursor < line.length) {
    if (line[cursor] === '`') {
      const delimiterMatch = /^`+/.exec(line.slice(cursor))
      const delimiter = delimiterMatch?.[0] ?? '`'
      const closingIndex = line.indexOf(delimiter, cursor + delimiter.length)
      if (closingIndex !== -1) {
        result += line.slice(cursor, closingIndex + delimiter.length)
        cursor = closingIndex + delimiter.length
        continue
      }
    }

    // 2. 非代码区遇到 `<` 时，优先处理会触发 MDX 解析的危险片段
    if (line[cursor] === '<') {
      if (!canStartMdxTagLikeSyntax(line, cursor)) {
        result += '&lt;'
        cursor += 1
        continue
      }

      const closingIndex = line.indexOf('>', cursor + 1)
      if (closingIndex === -1) {
        result += '&lt;'
        cursor += 1
        continue
      }

      const segment = line.slice(cursor, closingIndex + 1)
      const autolinkReplacement = getAutolinkReplacement(segment)
      if (autolinkReplacement) {
        result += autolinkReplacement
        cursor = closingIndex + 1
        continue
      }
      if (!isSafeMdxHtmlTag(segment)) {
        result += escapeAngleBracketSegment(segment)
        cursor = closingIndex + 1
        continue
      }
    }

    // 3. 其余字符保持原样，尽量不改动正常 Markdown
    result += line[cursor]
    cursor += 1
  }

  return result
}

/** 预处理粘贴进 MDXEditor 的 Markdown，避免被非预期 JSX / HTML 语法卡死 */
export function sanitizeMarkdownForMdxPaste(text: string) {
  const normalizedText = normalizeMarkdownPasteText(text)
  const lines = normalizedText.split('\n')
  const sanitizedLines: string[] = []
  let activeFence: { marker: '`' | '~'; length: number } | null = null

  // 1. 逐行处理，围栏代码块里的内容完全保留
  for (const line of lines) {
    const fenceMatch = matchFence(line)
    if (activeFence) {
      sanitizedLines.push(line)
      if (
        fenceMatch &&
        fenceMatch[2][0] === activeFence.marker &&
        fenceMatch[2].length >= activeFence.length
      ) {
        activeFence = null
      }
      continue
    }

    // 2. 开始新的围栏代码块时只记录状态，不碰正文
    if (fenceMatch) {
      sanitizedLines.push(line)
      activeFence = {
        marker: fenceMatch[2][0] as '`' | '~',
        length: fenceMatch[2].length,
      }
      continue
    }

    // 3. 普通文本行只清洗可能触发 MDX 解析错误的危险尖括号片段
    sanitizedLines.push(sanitizeMarkdownLine(line))
  }

  return sanitizedLines.join('\n')
}

/** 把任意纯文本转成可被 Markdown 安全解析的字面量文本 */
export function escapePlainTextForMdxMarkdown(text: string) {
  const normalizedText = normalizeMarkdownPasteText(text)

  // 1. 反斜杠转义所有常见 Markdown / MDX 触发字符，保证显示内容不被重新解释
  return normalizedText
    .split('\n')
    .map((line) => line.replace(MARKDOWN_PLAIN_TEXT_ESCAPE_RE, '\\$&'))
    .join('\n')
}
