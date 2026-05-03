import {
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_SPACE_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
  type TextNode,
} from 'lexical'

const INLINE_MATH_BEFORE_CURSOR_RE = /(^|[^\\$])\$((?:\\.|[^$\n])+)\$$/
const DISPLAY_MATH_BLOCK_RE = /^\s{0,3}\$\$\s*\n?([\s\S]*?)\n?\$\$\s*$/
const DISPLAY_MATH_DELIMITER_RE = /^\s{0,3}\$\$\s*$/
const INLINE_MATH_CARET_OFFSET = 1

interface MathTextAutoConversionOptions<TNode extends LexicalNode> {
  createBlockMathNode: (value: string) => TNode
  createInlineMathNode: (value: string) => TNode
  ensureInlineMathCaretMarker: (node: TNode) => void
}

/** 判断空格键是否应触发公式收束，排除快捷键和 IME 组合输入 */
function isPlainSpaceEvent(event: KeyboardEvent) {
  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && event.keyCode !== 229
}

/** 向上查找当前光标所在的段落节点 */
function getParagraphAncestor(node: LexicalNode) {
  let current: LexicalNode | null = node
  while (current) {
    if ($isParagraphNode(current)) return current
    current = current.getParent()
  }

  return null
}

/** 计算文本光标在指定祖先元素内的纯文本偏移 */
function getTextOffsetInElement(element: ElementNode, targetNode: TextNode, targetOffset: number): number | null {
  let offset = 0

  // 1. 按文档顺序遍历子树，找到目标文本节点前的累计文本长度
  for (const child of element.getChildren()) {
    if (child === targetNode) return offset + targetOffset

    if ($isElementNode(child)) {
      const childOffset: number | null = getTextOffsetInElement(child, targetNode, targetOffset)
      if (childOffset !== null) return offset + childOffset
    }

    offset += child.getTextContentSize()
  }

  return null
}

/** 获取当前折叠光标所在的文本节点与段落上下文 */
function getCollapsedTextSelectionContext() {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.focus.type !== 'text') return null

  const textNode = selection.focus.getNode()
  if (!$isTextNode(textNode)) return null

  const paragraph = getParagraphAncestor(textNode)
  if (!paragraph) return null

  const paragraphOffset = getTextOffsetInElement(paragraph, textNode, selection.focus.offset)
  if (paragraphOffset === null) return null

  return {
    paragraph,
    paragraphOffset,
    textNode,
    textOffset: selection.focus.offset,
  }
}

/** 截出文本节点中的公式源码片段 */
function splitTextRange(textNode: TextNode, startOffset: number, endOffset: number) {
  const textSize = textNode.getTextContentSize()
  if (startOffset === 0 && endOffset === textSize) return textNode
  if (startOffset === 0) return textNode.splitText(endOffset)[0] ?? null
  if (endOffset === textSize) return textNode.splitText(startOffset)[1] ?? null
  return textNode.splitText(startOffset, endOffset)[1] ?? null
}

/** 把光标前刚闭合的行内公式文本替换成公式节点 */
function convertInlineMathBeforeCursor<TNode extends LexicalNode>(options: MathTextAutoConversionOptions<TNode>) {
  const context = getCollapsedTextSelectionContext()
  if (!context || context.textNode.hasFormat('code')) return false

  // 1. 只处理紧贴光标左侧的 `$...$`，避免扫描并改写用户未触碰的普通文本
  const textBeforeCursor = context.textNode.getTextContent().slice(0, context.textOffset)
  const match = INLINE_MATH_BEFORE_CURSOR_RE.exec(textBeforeCursor)
  if (!match || !match[2].trim()) return false

  // 2. 保留公式前缀文本，只把 `$...$` 这一段替换成自定义公式节点
  const matchStart = (match.index ?? 0) + match[1].length
  const mathTextNode = splitTextRange(context.textNode, matchStart, context.textOffset)
  if (!mathTextNode) return false

  const mathNode = options.createInlineMathNode(match[2])
  mathTextNode.replace(mathNode)
  options.ensureInlineMathCaretMarker(mathNode)
  mathNode.selectNext(INLINE_MATH_CARET_OFFSET, INLINE_MATH_CARET_OFFSET)
  return true
}

/** 把单段落里的完整 `$$...$$` 文本替换成行间公式 */
function convertSingleParagraphDisplayMath<TNode extends LexicalNode>(
  paragraph: ParagraphNode,
  paragraphOffset: number,
  options: MathTextAutoConversionOptions<TNode>
) {
  const text = paragraph.getTextContent()
  const textBeforeCursor = text.slice(0, paragraphOffset)
  const textAfterCursor = text.slice(paragraphOffset)
  if (textAfterCursor.trim()) return false

  const match = DISPLAY_MATH_BLOCK_RE.exec(textBeforeCursor)
  if (!match || !match[1].trim()) return false

  const mathNode = options.createBlockMathNode(match[1])
  paragraph.replace(mathNode)
  mathNode.selectNext(0, 0)
  return true
}

/** 把多段落里的 `$$` 起止块替换成行间公式 */
function convertMultiParagraphDisplayMath<TNode extends LexicalNode>(
  paragraph: ParagraphNode,
  paragraphOffset: number,
  options: MathTextAutoConversionOptions<TNode>
) {
  const text = paragraph.getTextContent()
  const textBeforeCursor = text.slice(0, paragraphOffset)
  const textAfterCursor = text.slice(paragraphOffset)
  if (!DISPLAY_MATH_DELIMITER_RE.test(textBeforeCursor) || textAfterCursor.trim()) return false

  const nodesToRemove: LexicalNode[] = [paragraph]
  const sourceLines: string[] = []
  let sibling = paragraph.getPreviousSibling()

  // 1. 从结束 `$$` 向前找开始 `$$`，只跨越普通段落，避免误吞列表、表格等结构
  while (sibling) {
    if (!$isParagraphNode(sibling)) return false

    const siblingText = sibling.getTextContent()
    if (DISPLAY_MATH_DELIMITER_RE.test(siblingText)) {
      const source = sourceLines.join('\n')
      if (!source.trim()) return false

      const mathNode = options.createBlockMathNode(source)
      sibling.replace(mathNode)
      nodesToRemove.forEach((node) => node.remove())
      mathNode.selectNext(0, 0)
      return true
    }

    sourceLines.unshift(siblingText)
    nodesToRemove.unshift(sibling)
    sibling = sibling.getPreviousSibling()
  }

  return false
}

/** 把光标前刚闭合的行间公式文本替换成公式节点 */
function convertDisplayMathBeforeCursor<TNode extends LexicalNode>(options: MathTextAutoConversionOptions<TNode>) {
  const context = getCollapsedTextSelectionContext()
  if (!context) return false

  return (
    convertSingleParagraphDisplayMath(context.paragraph, context.paragraphOffset, options) ||
    convertMultiParagraphDisplayMath(context.paragraph, context.paragraphOffset, options)
  )
}

/** 注册公式纯文本自动收束：在结束定界符后按空格即可转成渲染公式 */
export function registerMathTextAutoConversion<TNode extends LexicalNode>(
  editor: LexicalEditor,
  options: MathTextAutoConversionOptions<TNode>
) {
  return editor.registerCommand(
    KEY_SPACE_COMMAND,
    (event) => {
      if (!isPlainSpaceEvent(event)) return false
      const hasConverted = convertDisplayMathBeforeCursor(options) || convertInlineMathBeforeCursor(options)
      if (!hasConverted) return false

      event.preventDefault()
      return true
    },
    COMMAND_PRIORITY_HIGH
  )
}
