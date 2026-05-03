import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
} from 'lexical'
import {
  INLINE_MATH_CARET_MARKER_LENGTH,
  isBareInlineMathCaretMarker,
  isInlineMathCaretMarker,
} from './inlineMathCaret'

type InlineMathSelectionNode = LexicalNode & {
  isInline: () => boolean
}

type SelectionBoundary = {
  key: string
  offset: number
  type: 'text'
}

interface InlineMathShiftSelectionOptions<TNode extends InlineMathSelectionNode> {
  ensureCaretMarker: (node: TNode) => void
  isInlineMathNode: (node: LexicalNode | null | undefined) => node is TNode
}

/** 获取公式左侧的零宽文本边界，裸锚点用起点能避免反向选区被浏览器扩成整行 */
function getBoundaryBeforeInlineMath(node: InlineMathSelectionNode): SelectionBoundary {
  const previousSibling = node.getPreviousSibling()
  if (!$isTextNode(previousSibling)) {
    throw new Error('行内公式左侧缺少光标锚点')
  }
  const previousTextSize = previousSibling.getTextContentSize()

  return {
    key: previousSibling.getKey(),
    offset:
      isInlineMathCaretMarker(previousSibling) && previousTextSize === INLINE_MATH_CARET_MARKER_LENGTH
        ? 0
        : previousTextSize,
    type: 'text',
  }
}

/** 获取公式右侧的零宽文本边界，只包住公式节点，不选中后续正文 */
function getBoundaryAfterInlineMath<TNode extends InlineMathSelectionNode>(
  node: TNode,
  ensureCaretMarker: (node: TNode) => void
): SelectionBoundary {
  ensureCaretMarker(node)
  const nextSibling = node.getNextSibling()
  if (!$isTextNode(nextSibling)) {
    throw new Error('行内公式右侧缺少光标锚点')
  }

  return {
    key: nextSibling.getKey(),
    offset: INLINE_MATH_CARET_MARKER_LENGTH,
    type: 'text',
  }
}

/** 第一次从折叠光标扩选公式时，同时重置锚点，避免锚点落在零宽文本后导致 DOM 选区失真 */
function setSelectionAcrossInlineMath(selection: RangeSelection, start: SelectionBoundary, end: SelectionBoundary) {
  if (selection.isCollapsed()) {
    selection.anchor.set(start.key, start.offset, start.type)
  }
  selection.focus.set(end.key, end.offset, end.type)
}

/** 判断选区焦点是否紧贴在某个行内公式左侧 */
function getInlineMathAfterSelectionFocus<TNode extends InlineMathSelectionNode>(
  selection: RangeSelection,
  isInlineMathNode: (node: LexicalNode | null | undefined) => node is TNode
) {
  const point = selection.focus
  const node = point.getNode()

  if (point.type === 'text') {
    if (!$isTextNode(node) || point.offset !== node.getTextContentSize()) return null
    const nextSibling = node.getNextSibling()
    if (isInlineMathCaretMarker(nextSibling)) {
      const mathNode = nextSibling.getNextSibling()
      return isInlineMathNode(mathNode) && mathNode.isInline() ? mathNode : null
    }
    return isInlineMathNode(nextSibling) && nextSibling.isInline() ? nextSibling : null
  }

  if (!$isElementNode(node)) return null
  const nextChild = node.getChildAtIndex(point.offset)
  return isInlineMathNode(nextChild) && nextChild.isInline() ? nextChild : null
}

/** 判断选区焦点是否紧贴在某个行内公式右侧 */
function getInlineMathBeforeSelectionFocus<TNode extends InlineMathSelectionNode>(
  selection: RangeSelection,
  isInlineMathNode: (node: LexicalNode | null | undefined) => node is TNode
) {
  const point = selection.focus
  const node = point.getNode()

  if (point.type === 'text') {
    if (!$isTextNode(node)) return null

    if (isInlineMathCaretMarker(node) && point.offset <= INLINE_MATH_CARET_MARKER_LENGTH) {
      const previousSibling = node.getPreviousSibling()
      return isInlineMathNode(previousSibling) && previousSibling.isInline() ? previousSibling : null
    }

    if (point.offset !== 0) return null
    const previousSibling = node.getPreviousSibling()
    if (isInlineMathNode(previousSibling) && previousSibling.isInline()) return previousSibling
    if (!isBareInlineMathCaretMarker(previousSibling)) return null

    const mathNode = previousSibling.getPreviousSibling()
    return isInlineMathNode(mathNode) && mathNode.isInline() ? mathNode : null
  }

  if (!$isElementNode(node)) return null
  const previousChild = node.getChildAtIndex(point.offset - 1)
  if (isInlineMathNode(previousChild) && previousChild.isInline()) return previousChild
  if (!isBareInlineMathCaretMarker(previousChild)) return null

  const mathNode = previousChild.getPreviousSibling()
  return isInlineMathNode(mathNode) && mathNode.isInline() ? mathNode : null
}

/** 处理 Shift+方向键跨过行内公式边界，让公式能作为整体进入选区 */
function handleInlineMathShiftSelection<TNode extends InlineMathSelectionNode>(
  event: globalThis.KeyboardEvent,
  direction: 'left' | 'right',
  options: InlineMathShiftSelectionOptions<TNode>
) {
  if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false

  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false

  const mathNode =
    direction === 'right'
      ? getInlineMathAfterSelectionFocus(selection, options.isInlineMathNode)
      : getInlineMathBeforeSelectionFocus(selection, options.isInlineMathNode)
  if (!mathNode) return false
  options.ensureCaretMarker(mathNode)

  const boundary =
    direction === 'right'
      ? getBoundaryAfterInlineMath(mathNode, options.ensureCaretMarker)
      : getBoundaryBeforeInlineMath(mathNode)
  const oppositeBoundary =
    direction === 'right'
      ? getBoundaryBeforeInlineMath(mathNode)
      : getBoundaryAfterInlineMath(mathNode, options.ensureCaretMarker)

  event.preventDefault()
  setSelectionAcrossInlineMath(selection, oppositeBoundary, boundary)
  return true
}

/** 注册行内公式 Shift+方向键选区兜底，只接管紧贴公式边界的移动 */
export function registerInlineMathShiftSelection<TNode extends InlineMathSelectionNode>(
  editor: LexicalEditor,
  options: InlineMathShiftSelectionOptions<TNode>
) {
  const unregisterShiftRight = editor.registerCommand(
    KEY_ARROW_RIGHT_COMMAND,
    (event) => handleInlineMathShiftSelection(event, 'right', options),
    COMMAND_PRIORITY_HIGH
  )
  const unregisterShiftLeft = editor.registerCommand(
    KEY_ARROW_LEFT_COMMAND,
    (event) => handleInlineMathShiftSelection(event, 'left', options),
    COMMAND_PRIORITY_HIGH
  )

  return () => {
    unregisterShiftRight()
    unregisterShiftLeft()
  }
}
