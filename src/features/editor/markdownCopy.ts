/** 从编辑器 DOM 选区生成 Markdown 复制文本 */

import { INLINE_MATH_CARET_MARKER } from './math/inlineMathCaret'

const MIRA_MATH_KIND_ATTR = 'data-mira-math-kind'
const MIRA_MATH_VALUE_ATTR = 'data-mira-math-value'

const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
])

/** 轻量处理 Markdown 行内纯文本，尽量贴近用户原始输入 */
function normalizeInlineText(value: string) {
  return value
}

/** 规整块之间的空行，避免 DOM 换行被复制成过宽空洞 */
function normalizeMarkdownBlocks(value: string) {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 判断节点是否是块级节点 */
function isBlockElement(node: Node) {
  return node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName)
}

/** 为块级片段补齐前后换行 */
function asBlock(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue ? `\n\n${trimmedValue}\n\n` : ''
}

/** 获取元素的普通文本内容 */
function getNodeText(node: Node) {
  return (node.textContent ?? '').replace(/\u00a0/g, ' ').split(INLINE_MATH_CARET_MARKER).join('')
}

/** 还原公式 DOM 节点对应的 Markdown 源文本 */
function serializeMathElement(element: HTMLElement, options: SerializeOptions) {
  const kind = element.getAttribute(MIRA_MATH_KIND_ATTR)
  const value = element.getAttribute(MIRA_MATH_VALUE_ATTR) ?? ''
  if (kind === 'inline') return `$${value}$`
  if (kind === 'block') {
    const markdown = `$$\n${value}\n$$`
    return options.isInline ? markdown : asBlock(markdown)
  }
  return null
}

/** 序列化行内子节点 */
function serializeChildrenAsInline(node: Node, options: SerializeOptions) {
  return Array.from(node.childNodes)
    .map((child) => serializeNodeToMarkdown(child, { ...options, isInline: true }))
    .join('')
}

/** 序列化块级子节点 */
function serializeChildrenAsBlocks(node: Node, options: SerializeOptions) {
  return Array.from(node.childNodes)
    .map((child) => serializeNodeToMarkdown(child, options))
    .join('')
}

/** 给多行内容添加引用前缀 */
function prefixBlockquote(value: string) {
  return value
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n')
}

/** 给列表项内的换行添加缩进 */
function indentListItemContinuation(value: string) {
  return value.replace(/\n/g, '\n  ')
}

/** 序列化列表节点 */
function serializeList(element: HTMLElement, options: SerializeOptions) {
  const items = Array.from(element.children).filter((child) => child.tagName === 'LI')
  const isOrdered = element.tagName === 'OL'

  return asBlock(
    items
      .map((item, index) => {
        const marker = isOrdered ? `${index + 1}. ` : '- '
        const markdown = serializeChildrenAsBlocks(item, options).trim()
        return `${marker}${indentListItemContinuation(markdown)}`
      })
      .join('\n')
  )
}

/** 序列化表格节点 */
function serializeTable(element: HTMLElement) {
  const rows = Array.from(element.querySelectorAll('tr'))
    .map((row) =>
      Array.from(row.querySelectorAll('th, td'))
        .filter((cell) => !cell.hasAttribute('data-tool-cell'))
        .map((cell) => getNodeText(cell).trim().replace(/\|/g, '\\|'))
    )
    .filter((cells) => cells.length > 0)
  if (!rows.length) return ''

  const columnCount = Math.max(...rows.map((row) => row.length))
  const normalizedRows = rows.map((row) => [
    ...row,
    ...Array.from({ length: columnCount - row.length }, () => ''),
  ])
  const delimiter = Array.from({ length: columnCount }, () => '---')

  return asBlock(
    [normalizedRows[0], delimiter, ...normalizedRows.slice(1)]
      .map((row) => `| ${row.join(' | ')} |`)
      .join('\n')
  )
}

interface SerializeOptions {
  isInline?: boolean
}

/** 将克隆出来的 DOM 节点递归转成 Markdown */
function serializeNodeToMarkdown(node: Node, options: SerializeOptions = {}): string {
  // 1. 文本节点按当前上下文决定是否转义
  if (node.nodeType === Node.TEXT_NODE) {
    const text = getNodeText(node)
    return options.isInline ? normalizeInlineText(text) : normalizeInlineText(text)
  }
  if (!(node instanceof HTMLElement)) return ''

  // 2. 行内语义节点恢复 Markdown 标记
  const mathMarkdown = serializeMathElement(node, options)
  if (mathMarkdown !== null) return mathMarkdown

  const tagName = node.tagName
  if (tagName === 'BR') return '\n'
  if (tagName === 'STRONG' || tagName === 'B') return `**${serializeChildrenAsInline(node, options)}**`
  if (tagName === 'EM' || tagName === 'I') return `*${serializeChildrenAsInline(node, options)}*`
  if (tagName === 'S' || tagName === 'DEL') return `~~${serializeChildrenAsInline(node, options)}~~`
  if (tagName === 'CODE' && node.closest('pre') === null) return `\`${getNodeText(node).replace(/`/g, '\\`')}\``
  if (tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    const label = serializeChildrenAsInline(node, options) || href
    return href ? `[${label}](${href})` : label
  }
  if (tagName === 'IMG') {
    const alt = node.getAttribute('alt') ?? ''
    const src = node.getAttribute('src') ?? ''
    return src ? `![${normalizeInlineText(alt)}](${src})` : ''
  }

  // 3. 块级节点恢复 Markdown 块结构
  if (/^H[1-6]$/.test(tagName)) {
    const level = Number(tagName.slice(1))
    return asBlock(`${'#'.repeat(level)} ${serializeChildrenAsInline(node, options).trim()}`)
  }
  if (tagName === 'P') return asBlock(serializeChildrenAsInline(node, options))
  if (tagName === 'BLOCKQUOTE') return asBlock(prefixBlockquote(serializeChildrenAsBlocks(node, options)))
  if (tagName === 'UL' || tagName === 'OL') return serializeList(node, options)
  if (tagName === 'PRE') return asBlock(`\`\`\`\n${getNodeText(node).replace(/\n$/, '')}\n\`\`\``)
  if (tagName === 'HR') return asBlock('---')
  if (tagName === 'TABLE') return serializeTable(node)

  // 4. 其它容器按块/行内上下文继续展开
  const childrenMarkdown = isBlockElement(node)
    ? serializeChildrenAsBlocks(node, options)
    : serializeChildrenAsInline(node, options)
  return options.isInline || !isBlockElement(node) ? childrenMarkdown : asBlock(childrenMarkdown)
}

/** 根据浏览器当前选区生成 Markdown，保留用户实际选中的范围 */
export function getSelectionMarkdownFromDom(shellElement: HTMLElement | null) {
  const selection = window.getSelection()
  if (!shellElement || !selection || selection.rangeCount === 0 || selection.isCollapsed) return ''

  // 1. 只处理落在编辑器里的选区，避免接管页面其它区域复制
  const fragments: string[] = []
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    if (!shellElement.contains(range.commonAncestorContainer)) continue

    const wrapper = document.createElement('div')
    wrapper.appendChild(range.cloneContents())
    fragments.push(serializeChildrenAsBlocks(wrapper, {}))
  }

  // 2. 输出稳定 Markdown 文本；空选区交回浏览器默认复制
  return normalizeMarkdownBlocks(fragments.join('\n\n'))
}
