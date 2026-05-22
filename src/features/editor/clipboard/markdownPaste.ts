const MARKDOWN_PASTE_BLOCK_RE =
  /(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+|```|~~~|\|.+\|\s*$|(?:[-*_]\s*){3,}$)/m
const MARKDOWN_PASTE_INLINE_RE =
  /(?:!\[[^\]]*]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`)/
const MARKDOWN_PASTE_DISPLAY_MATH_RE = /(?:^|\n)\s{0,3}\$\$[\s\S]*?\S[\s\S]*?\$\$\s*(?=\n|$)/
const MARKDOWN_PASTE_INLINE_MATH_RE = /(^|[^\\$])\$((?:\\.|[^$\n])+)\$(?!\$)/
const MARKDOWN_REFERENCE_LINK_RE = /!?\[(?:\\.|[^\]\\\n])+\]\[(?:\\.|[^\]\\\n])*\]/
const MARKDOWN_REFERENCE_DEFINITION_RE = /^\s{0,3}\[((?:\\.|[^\]\\\n])+)]:(.*)$/
const FENCED_CODE_BLOCK_RE = /^(\s*)(`{3,}|~{3,})(.*)$/
const MDX_SUPPORTED_HTML_TAGS = new Set(['img', 'sub', 'sup', 'u'])
const MDX_TAG_NAME_START_RE = /[A-Za-z/$!?]/
const MARKDOWN_PLAIN_TEXT_ESCAPE_RE = /[\\`*_[\]{}()#+\-.!|<>~$]/g
const URL_AUTOLINK_RE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]+$/
const EMAIL_AUTOLINK_RE = /^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/

export type MarkdownPasteMode = 'markdown' | 'plain-text' | 'native'

interface MarkdownReferenceDefinition {
  url: string
  title: string | null
}

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
function hasReferenceStyleMarkdown(text: string) {
  const normalizedText = normalizeMarkdownPasteText(text)

  // 1. 去掉行内代码片段，避免代码里的引用链接字面量触发 Markdown 导入
  return normalizedText
    .split('\n')
    .some((line) => {
      const searchableLine = stripInlineCodeSpans(line)
      return MARKDOWN_REFERENCE_LINK_RE.test(searchableLine) || MARKDOWN_REFERENCE_DEFINITION_RE.test(searchableLine)
    })
}

/** 判断一段纯文本是否明显带有 Markdown 语法，避免误伤普通粘贴 */
export function looksLikeMarkdown(text: string) {
  // 1. 先过滤空白内容，避免无意义的语法判断
  const normalizedText = text.trim()
  if (!normalizedText) return false

  // 2. 公式需要主动走 Markdown 导入，否则会被 Lexical 当普通文本粘贴
  if (hasMarkdownMath(normalizedText)) return true

  // 3. reference-style link 需要先局部改写，否则 MDXEditor 会因 linkReference 中断
  if (hasReferenceStyleMarkdown(normalizedText)) return true

  // 4. 优先识别标题、列表、引用、代码块、表格等块级语法
  if (MARKDOWN_PASTE_BLOCK_RE.test(normalizedText)) return true

  // 5. 再补充识别粗体、链接、行内代码等常见行内语法
  return MARKDOWN_PASTE_INLINE_RE.test(normalizedText)
}

/** 判断剪贴板文本应以何种方式进入 MDXEditor */
export function getMarkdownPasteMode(text: string): MarkdownPasteMode {
  // 1. 普通纯文本交给浏览器和 Lexical 原生粘贴，减少不必要的接管
  if (!looksLikeMarkdown(text)) return 'native'

  return 'markdown'
}

/** 判断当前行是否开启或关闭了围栏代码块 */
function matchFence(line: string) {
  return FENCED_CODE_BLOCK_RE.exec(line)
}

/** 按 CommonMark 规则归一化引用链接标签 */
function normalizeReferenceLabel(label: string) {
  return label
    .replace(/\\([\\[\]])/g, '$1')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** 解析 Markdown reference definition 的 URL 与可选标题 */
function parseReferenceDefinition(restText: string): MarkdownReferenceDefinition | null {
  const trimmedText = restText.trim()
  if (!trimmedText) return null

  // 1. URL 可以写成 <...>，否则取第一个非空白片段
  let url = ''
  let cursor = 0
  if (trimmedText.startsWith('<')) {
    const closingIndex = trimmedText.indexOf('>')
    if (closingIndex === -1) return null
    url = trimmedText.slice(1, closingIndex)
    cursor = closingIndex + 1
  } else {
    const urlMatch = /^\S+/.exec(trimmedText)
    if (!urlMatch) return null
    url = urlMatch[0]
    cursor = url.length
  }

  // 2. 标题只做轻量反包裹，交给后续 inline link formatter 再转义
  const rawTitle = trimmedText.slice(cursor).trim()
  if (!rawTitle) return { url, title: null }
  const titleStart = rawTitle[0]
  const titleEnd = rawTitle[rawTitle.length - 1]
  const title =
    (titleStart === '"' && titleEnd === '"') ||
    (titleStart === "'" && titleEnd === "'") ||
    (titleStart === '(' && titleEnd === ')')
      ? rawTitle.slice(1, -1)
      : rawTitle

  return { url, title }
}

/** 收集引用链接定义行，并记录它们的位置，避免后续导入 definition 节点 */
function collectReferenceDefinitions(lines: string[]) {
  const definitions = new Map<string, MarkdownReferenceDefinition>()
  const definitionLineIndexes = new Set<number>()
  let activeFence: { marker: '`' | '~'; length: number } | null = null

  // 1. 只在非代码块区域识别 definition，代码块内容必须原样保留
  lines.forEach((line, index) => {
    const fenceMatch = matchFence(line)
    if (activeFence) {
      if (
        fenceMatch &&
        fenceMatch[2][0] === activeFence.marker &&
        fenceMatch[2].length >= activeFence.length
      ) {
        activeFence = null
      }
      return
    }

    if (fenceMatch) {
      activeFence = {
        marker: fenceMatch[2][0] as '`' | '~',
        length: fenceMatch[2].length,
      }
      return
    }

    // 2. MDXEditor 没有 definition visitor；能解析的 definition 应转成 inline link 后移除
    const definitionMatch = MARKDOWN_REFERENCE_DEFINITION_RE.exec(line)
    if (!definitionMatch) return

    const definition = parseReferenceDefinition(definitionMatch[2])
    if (!definition) return
    definitions.set(normalizeReferenceLabel(definitionMatch[1]), definition)
    definitionLineIndexes.add(index)
  })

  return { definitions, definitionLineIndexes }
}

/** 查找方括号闭合位置，兼容反斜杠转义的右括号 */
function findClosingBracket(text: string, startIndex: number) {
  for (let cursor = startIndex + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === '\\') {
      cursor += 1
      continue
    }
    if (text[cursor] === ']') return cursor
  }

  return -1
}

/** 格式化 inline link 的目标 URL 与标题 */
function formatInlineLinkDestination(definition: MarkdownReferenceDefinition) {
  const escapedUrl = /[\s()<>]/.test(definition.url)
    ? `<${definition.url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`
    : definition.url.replace(/[()\\]/g, '\\$&')

  if (!definition.title) return escapedUrl

  const escapedTitle = definition.title
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
  return `${escapedUrl} "${escapedTitle}"`
}

/** 把一个 reference-style link 局部改写成 MDXEditor 支持的 inline link */
function formatInlineReferenceLink(prefix: '' | '!', label: string, definition: MarkdownReferenceDefinition) {
  return `${prefix}[${label}](${formatInlineLinkDestination(definition)})`
}

/** 改写单行中的 reference-style link，行内代码片段保持原样 */
function rewriteReferenceLinksInLine(line: string, definitions: Map<string, MarkdownReferenceDefinition>) {
  let result = ''
  let cursor = 0

  // 1. 顺序扫描，避免一个 unsupported reference 影响同一行其它 Markdown 语法
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

    const isImageReference = line[cursor] === '!' && line[cursor + 1] === '['
    const labelStart = isImageReference ? cursor + 1 : cursor
    if (line[labelStart] === '[') {
      const labelEnd = findClosingBracket(line, labelStart)
      if (labelEnd !== -1) {
        const label = line.slice(labelStart + 1, labelEnd)
        const afterLabel = labelEnd + 1
        const prefix = isImageReference ? '!' : ''

        if (line[afterLabel] === '[') {
          const referenceEnd = findClosingBracket(line, afterLabel)
          if (referenceEnd !== -1) {
            const explicitReferenceLabel = line.slice(afterLabel + 1, referenceEnd)
            const referenceLabel = explicitReferenceLabel.trim() ? explicitReferenceLabel : label
            const definition = definitions.get(normalizeReferenceLabel(referenceLabel))
            result += definition
              ? formatInlineReferenceLink(prefix, label, definition)
              : line.slice(cursor, referenceEnd + 1)
            cursor = referenceEnd + 1
            continue
          }
        }

        // 2. 只有存在匹配 definition 时才把 shortcut reference 转 inline link
        if (line[afterLabel] !== '(') {
          const definition = definitions.get(normalizeReferenceLabel(label))
          if (definition) {
            result += formatInlineReferenceLink(prefix, label, definition)
            cursor = labelEnd + 1
            continue
          }
        }
      }
    }

    result += line[cursor]
    cursor += 1
  }

  return result
}

/** 将 reference-style link 局部改写成 inline link，保留其它 Markdown 结构 */
function rewriteReferenceLinksForMdx(text: string) {
  const normalizedText = normalizeMarkdownPasteText(text)
  const lines = normalizedText.split('\n')
  const { definitions, definitionLineIndexes } = collectReferenceDefinitions(lines)
  if (definitions.size === 0) return normalizedText

  // 1. definition 行本身在 Markdown 渲染中不可见，移除可避免 MDXEditor 生成 unsupported 节点
  return lines
    .map((line, index) => {
      if (definitionLineIndexes.has(index)) return ''
      return rewriteReferenceLinksInLine(line, definitions)
    })
    .join('\n')
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

/** 准备粘贴导入用 Markdown：局部改写 unsupported 语法，再清洗 MDX 危险片段 */
export function prepareMarkdownForMdxPaste(text: string) {
  return sanitizeMarkdownForMdxPaste(rewriteReferenceLinksForMdx(text))
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
