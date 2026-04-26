interface MarkdownAstNode {
  type: string
  value?: string
  children?: MarkdownAstNode[]
}

interface StrongMatch {
  start: number
  openerEnd: number
  closerStart: number
  end: number
}

const STRONG_DELIMITERS = ['**', '__'] as const
const BLANK_LINE_RE = /\n\s*\n/
const PURE_NUMBER_RE = /^[+-]?\d+(?:[.,]\d+)*$/

/** 判断分隔符是否被反斜杠转义 */
function isEscaped(text: string, index: number): boolean {
  let slashCount = 0

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }

  return slashCount % 2 === 1
}

/** 判断当前位置是否是一个独立的 strong 分隔符 */
function isStrongDelimiterAt(text: string, index: number, delimiter: '**' | '__'): boolean {
  const marker = delimiter[0]

  return (
    text.startsWith(delimiter, index) &&
    text[index - 1] !== marker &&
    text[index + delimiter.length] !== marker &&
    !isEscaped(text, index)
  )
}

/** 判断 loose strong 内部是否值得按加粗处理 */
function isValidLooseStrongContent(content: string): boolean {
  const trimmedContent = content.trim()
  if (!trimmedContent || BLANK_LINE_RE.test(trimmedContent)) return false

  return !PURE_NUMBER_RE.test(trimmedContent)
}

/** 寻找与 opening delimiter 匹配的 closing delimiter */
function findStrongCloser(text: string, openerEnd: number, delimiter: '**' | '__'): number | null {
  for (let cursor = openerEnd; cursor < text.length; cursor += 1) {
    if (!isStrongDelimiterAt(text, cursor, delimiter)) continue

    const content = text.slice(openerEnd, cursor)
    if (isValidLooseStrongContent(content)) return cursor
  }

  return null
}

/** 从指定位置开始寻找下一段 loose strong */
function findNextStrongMatch(text: string, startIndex: number): StrongMatch | null {
  for (let cursor = startIndex; cursor < text.length; cursor += 1) {
    const delimiter = STRONG_DELIMITERS.find((candidate) => isStrongDelimiterAt(text, cursor, candidate))
    if (!delimiter) continue

    const openerEnd = cursor + delimiter.length
    const closerStart = findStrongCloser(text, openerEnd, delimiter)
    if (closerStart === null) continue

    return {
      start: cursor,
      openerEnd,
      closerStart,
      end: closerStart + delimiter.length,
    }
  }

  return null
}

/** 纯 ASCII 单词边界上的空格更可能是用户想保留的英文分词 */
function shouldKeepBoundarySpace(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && /[A-Za-z0-9]/.test(left) && /[A-Za-z0-9]/.test(right))
}

/** 创建文本节点，空字符串由调用方过滤 */
function createTextNode(value: string): MarkdownAstNode {
  return { type: 'text', value }
}

/** 创建 strong 节点 */
function createStrongNode(value: string): MarkdownAstNode {
  return {
    type: 'strong',
    children: [createTextNode(value)],
  }
}

/** 把单个 text 节点里的 loose strong 拆成可渲染的 mdast 节点 */
export function splitLooseStrongText(value: string): MarkdownAstNode[] | null {
  const nodes: MarkdownAstNode[] = []
  let cursor = 0
  let hasMatch = false

  // 1. 顺序扫描 text 节点，只有命中成对分隔符时才拆分
  while (cursor < value.length) {
    const match = findNextStrongMatch(value, cursor)
    if (!match) break

    const leadingText = value.slice(cursor, match.start)
    const rawStrongContent = value.slice(match.openerEnd, match.closerStart)
    const strongContent = rawStrongContent.trim()
    const leadingWhitespace = rawStrongContent.match(/^\s+/)?.[0] ?? ''
    const trailingWhitespace = rawStrongContent.match(/\s+$/)?.[0] ?? ''
    const firstStrongChar = strongContent[0]
    const lastStrongChar = strongContent[strongContent.length - 1]
    const previousChar = value[match.start - 1]
    const nextChar = value[match.end]

    if (leadingText) nodes.push(createTextNode(leadingText))
    if (leadingWhitespace && shouldKeepBoundarySpace(previousChar, firstStrongChar)) {
      nodes.push(createTextNode(leadingWhitespace))
    }
    nodes.push(createStrongNode(strongContent))
    if (trailingWhitespace && shouldKeepBoundarySpace(lastStrongChar, nextChar)) {
      nodes.push(createTextNode(trailingWhitespace))
    }

    hasMatch = true
    cursor = match.end
  }

  // 2. 没有命中时交还原始 text 节点，避免无意义改写 AST
  if (!hasMatch) return null

  const trailingText = value.slice(cursor)
  if (trailingText) nodes.push(createTextNode(trailingText))

  return nodes
}

/** 递归修复 AI 回复里常见的宽松加粗写法 */
function transformLooseStrongNodes(node: MarkdownAstNode): void {
  if (!node.children) return

  // 1. 先处理当前层级的 text 节点
  const nextChildren: MarkdownAstNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      const splitNodes = splitLooseStrongText(child.value)
      nextChildren.push(...(splitNodes ?? [child]))
      continue
    }

    nextChildren.push(child)
  }
  node.children = nextChildren

  // 2. 再递归处理原有结构，避开 code/math 这类非普通文本节点
  for (const child of node.children) {
    if (
      child.type === 'code' ||
      child.type === 'inlineCode' ||
      child.type === 'math' ||
      child.type === 'inlineMath'
    ) {
      continue
    }
    transformLooseStrongNodes(child)
  }
}

/** remark 插件：兼容聊天模型输出中不完全符合 CommonMark 的加粗标记 */
export function remarkAiMarkdownCompat() {
  return (tree: MarkdownAstNode) => {
    transformLooseStrongNodes(tree)
  }
}
