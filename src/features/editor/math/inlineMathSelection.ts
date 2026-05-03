import {
  $createTextNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
  type TextNode,
} from 'lexical'
import {
  INLINE_MATH_CARET_MARKER_LENGTH,
  isBareInlineMathCaretMarker,
  isInlineMathCaretMarker,
  stripInlineMathCaretMarkers,
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
    if (!$isTextNode(node)) return null

    if (isInlineMathCaretMarker(node) && point.offset <= INLINE_MATH_CARET_MARKER_LENGTH) {
      const nextSibling = node.getNextSibling()
      return isInlineMathNode(nextSibling) && nextSibling.isInline() ? nextSibling : null
    }

    if (point.offset !== node.getTextContentSize()) return null
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

/** 普通退格 / 删除只处理无修饰键的单字符删除语义 */
function isPlainDeleteEvent(event: globalThis.KeyboardEvent) {
  return !event.altKey && !event.ctrlKey && !event.metaKey
}

/** 把零宽锚点还原成普通文本，保留用户可能输入在同一节点里的正文 */
function replaceInlineMathCaretMarkerWithText(node: LexicalNode | null | undefined) {
  if (!isInlineMathCaretMarker(node)) return null

  const textContent = stripInlineMathCaretMarkers(node.getTextContent())
  if (!textContent) {
    node.remove(true)
    return null
  }

  const textNode = $createTextNode(textContent)
  node.replace(textNode)
  return textNode
}

/** 删除公式后把光标放回公式原本位置，避免继续落在已删除的零宽锚点上 */
function restoreSelectionAfterInlineMathDelete(
  parentNode: ElementNode | null,
  deletedIndex: number,
  previousTextNode: TextNode | null,
  nextTextNode: TextNode | null
) {
  if (nextTextNode?.isAttached()) {
    nextTextNode.select(0, 0)
    return
  }

  if (previousTextNode?.isAttached()) {
    previousTextNode.selectEnd()
    return
  }

  if (!parentNode?.isAttached()) return
  const selectionOffset = Math.min(deletedIndex, parentNode.getChildrenSize())
  parentNode.select(selectionOffset, selectionOffset)
}

/** 删除行内公式及其两侧零宽锚点，公式后方正文应继续保留 */
function removeInlineMathNode(node: InlineMathSelectionNode) {
  const parentNode = node.getParent()
  const deletedIndex = node.getIndexWithinParent()
  const previousSibling = node.getPreviousSibling()
  const nextSibling = node.getNextSibling()
  const previousTextBeforeMarker = previousSibling?.getPreviousSibling()
  const nextTextAfterMarker = nextSibling?.getNextSibling()
  const previousTextNode = replaceInlineMathCaretMarkerWithText(previousSibling)
  const nextTextNode = replaceInlineMathCaretMarkerWithText(nextSibling)

  node.remove(true)
  restoreSelectionAfterInlineMathDelete(
    parentNode,
    deletedIndex,
    $isTextNode(previousTextNode) ? previousTextNode : $isTextNode(previousTextBeforeMarker) ? previousTextBeforeMarker : null,
    $isTextNode(nextTextNode) ? nextTextNode : $isTextNode(nextTextAfterMarker) ? nextTextAfterMarker : null
  )
}

/** 处理紧贴行内公式边界的退格和删除，让公式作为一个整体被移除 */
function handleInlineMathDelete<TNode extends InlineMathSelectionNode>(
  event: globalThis.KeyboardEvent,
  direction: 'backward' | 'forward',
  options: InlineMathShiftSelectionOptions<TNode>
) {
  if (!isPlainDeleteEvent(event)) return false

  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

  const mathNode =
    direction === 'backward'
      ? getInlineMathBeforeSelectionFocus(selection, options.isInlineMathNode)
      : getInlineMathAfterSelectionFocus(selection, options.isInlineMathNode)
  if (!mathNode) return false

  event.preventDefault()
  options.ensureCaretMarker(mathNode)
  removeInlineMathNode(mathNode)
  return true
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

/** 注册行内公式边界键盘控制：扩选、退格和删除都把公式当成一个整体 */
export function registerInlineMathBoundaryControls<TNode extends InlineMathSelectionNode>(
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
  const unregisterBackspace = editor.registerCommand(
    KEY_BACKSPACE_COMMAND,
    (event) => handleInlineMathDelete(event, 'backward', options),
    COMMAND_PRIORITY_HIGH
  )
  const unregisterDelete = editor.registerCommand(
    KEY_DELETE_COMMAND,
    (event) => handleInlineMathDelete(event, 'forward', options),
    COMMAND_PRIORITY_HIGH
  )

  return () => {
    unregisterShiftRight()
    unregisterShiftLeft()
    unregisterBackspace()
    unregisterDelete()
  }
}
