import type { AiTextReference } from '../../domain/ai'
import {
  createAiComposerReferencePart,
  createAiComposerTextPart,
  normalizeAiComposerParts,
  type AiComposerPart,
} from './aiComposerModel'
import {
  formatAiReferenceLabel,
  formatAiReferenceLineRange,
} from './aiReferenceText'

const AI_COMPOSER_MIN_ROWS = 3
const AI_COMPOSER_MAX_ROWS = 8
const AI_COMPOSER_FALLBACK_LINE_HEIGHT = 22
const AI_COMPOSER_CARET_SPACER = '\u200b'

export const AI_REFERENCE_SELECTOR = '[data-ai-reference-id]'
export const AI_REFERENCE_REMOVE_SELECTOR = '[data-ai-reference-remove]'

/** 根据内容把富文本输入区高度限制在 3 到 8 行之间 */
export function resizeComposerInput(inputElement: HTMLElement) {
  // 1. 先恢复自动高度，让删除内容时输入区也能收回
  inputElement.style.height = 'auto'

  // 2. 根据当前字体行高计算 3 行和 8 行的真实像素高度
  const styles = window.getComputedStyle(inputElement)
  const lineHeight = Number.parseFloat(styles.lineHeight) || AI_COMPOSER_FALLBACK_LINE_HEIGHT
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0
  const minHeight = lineHeight * AI_COMPOSER_MIN_ROWS + paddingTop + paddingBottom
  const maxHeight = lineHeight * AI_COMPOSER_MAX_ROWS + paddingTop + paddingBottom
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, inputElement.scrollHeight))

  // 3. 超过 8 行后固定高度并开启内部滚动
  inputElement.style.height = `${nextHeight}px`
  inputElement.style.overflowY = inputElement.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

/** 判断某个节点是否位于 composer 输入区内 */
function isNodeInsideComposer(rootElement: HTMLElement, node: Node | null) {
  return Boolean(node && (node === rootElement || rootElement.contains(node)))
}

/** 把输入区焦点和浏览器选区同步到指定 range */
export function applyComposerSelection(rootElement: HTMLElement, range: Range) {
  const selection = window.getSelection()
  if (!selection) return

  rootElement.focus({ preventScroll: true })
  selection.removeAllRanges()
  selection.addRange(range)
}

/** 把光标放到指定节点之前 */
function placeCaretBeforeNode(rootElement: HTMLElement, node: Node) {
  const range = document.createRange()
  range.setStartBefore(node)
  range.collapse(true)
  applyComposerSelection(rootElement, range)
}

/** 把光标放到输入区根节点的指定子节点偏移 */
function placeCaretAtRootOffset(rootElement: HTMLElement, offset: number) {
  const range = document.createRange()
  range.setStart(rootElement, Math.min(Math.max(offset, 0), rootElement.childNodes.length))
  range.collapse(true)
  applyComposerSelection(rootElement, range)
}

/** 把光标放到文本节点中的指定偏移 */
export function placeCaretInTextNode(rootElement: HTMLElement, textNode: Text, offset: number) {
  const range = document.createRange()
  range.setStart(textNode, Math.min(Math.max(offset, 0), textNode.data.length))
  range.collapse(true)
  applyComposerSelection(rootElement, range)
}

/** 把光标放到输入区末尾 */
export function placeCaretAtEnd(rootElement: HTMLElement) {
  const lastChild = rootElement.lastChild
  if (isTextNode(lastChild)) {
    placeCaretInTextNode(rootElement, lastChild, lastChild.data.length)
    return
  }
  if (isReferencePillNode(lastChild)) {
    placeCaretAfterReferencePill(rootElement, lastChild)
    return
  }

  const range = document.createRange()
  range.selectNodeContents(rootElement)
  range.collapse(false)
  applyComposerSelection(rootElement, range)
}

/** 创建引用胶囊 DOM，避免 React 重绘打断 contentEditable 光标 */
function createReferencePillElement(reference: AiTextReference) {
  const pillElement = document.createElement('span')
  pillElement.className = 'ai-reference-pill ai-reference-pill--composer'
  pillElement.contentEditable = 'false'
  pillElement.dataset.aiReferenceId = reference.id
  pillElement.setAttribute('role', 'button')
  pillElement.setAttribute('aria-label', `引用 ${formatAiReferenceLabel(reference)}`)

  const titleElement = document.createElement('span')
  titleElement.className = 'ai-reference-title'
  titleElement.textContent = reference.title
  pillElement.append(titleElement)

  const lineRangeElement = document.createElement('span')
  lineRangeElement.className = 'ai-reference-lines'
  lineRangeElement.textContent = formatAiReferenceLineRange(reference)
  pillElement.append(lineRangeElement)

  const removeElement = document.createElement('span')
  removeElement.className = 'ai-reference-remove'
  removeElement.dataset.aiReferenceRemove = 'true'
  removeElement.setAttribute('aria-hidden', 'true')
  removeElement.textContent = '×'
  pillElement.append(removeElement)

  return pillElement
}

/** 创建普通文本节点 */
export function createTextNode(text: string) {
  return document.createTextNode(text)
}

/** 创建胶囊后的零宽光标锚点，保证 WebKit 能稳定在胶囊右侧输入 */
function createCaretSpacerNode() {
  return createTextNode(AI_COMPOSER_CARET_SPACER)
}

/** 创建引用胶囊和紧随其后的光标锚点 */
export function createReferencePillNodes(reference: AiTextReference) {
  const pillElement = createReferencePillElement(reference)
  const spacerNode = createCaretSpacerNode()
  return { pillElement, spacerNode }
}

/** 判断节点是否为文本节点 */
function isTextNode(node: Node | null): node is Text {
  return node?.nodeType === Node.TEXT_NODE
}

/** 判断节点是否为引用胶囊 */
function isReferencePillNode(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && Boolean(node.dataset.aiReferenceId)
}

/** 去掉输入区内部用于光标定位的零宽字符 */
function stripCaretSpacers(text: string) {
  return text.replace(/\u200b/g, '')
}

/** 判断文本节点是否只包含内部光标锚点 */
function isIgnorableComposerTextNode(node: Node | null) {
  return isTextNode(node) && stripCaretSpacers(node.textContent ?? '') === ''
}

/** 读取节点在父节点中的序号 */
function getNodeIndex(node: Node) {
  let index = 0
  let currentNode = node.previousSibling
  while (currentNode) {
    index += 1
    currentNode = currentNode.previousSibling
  }
  return index
}

/** 确保引用胶囊左侧存在可落光标的零宽锚点 */
function ensureCaretSpacerBeforeReference(pillElement: HTMLElement) {
  const previousNode = pillElement.previousSibling
  if (isTextNode(previousNode)) {
    if (!previousNode.data.endsWith(AI_COMPOSER_CARET_SPACER)) {
      previousNode.data += AI_COMPOSER_CARET_SPACER
    }
    return previousNode
  }

  const spacerNode = createCaretSpacerNode()
  pillElement.before(spacerNode)
  return spacerNode
}

/** 确保引用胶囊右侧存在可落光标的零宽锚点 */
function ensureCaretSpacerAfterReference(pillElement: HTMLElement) {
  const nextNode = pillElement.nextSibling
  if (isTextNode(nextNode)) {
    if (!nextNode.data.startsWith(AI_COMPOSER_CARET_SPACER)) {
      nextNode.data = `${AI_COMPOSER_CARET_SPACER}${nextNode.data}`
    }
    return nextNode
  }

  const spacerNode = createCaretSpacerNode()
  pillElement.after(spacerNode)
  return spacerNode
}

/** 把光标放到引用胶囊左侧，并保留可见文本顺序 */
export function placeCaretBeforeReferencePill(rootElement: HTMLElement, pillElement: HTMLElement) {
  const spacerNode = ensureCaretSpacerBeforeReference(pillElement)
  placeCaretInTextNode(rootElement, spacerNode, spacerNode.data.length)
}

/** 把光标放到引用胶囊右侧，并保留可见文本顺序 */
export function placeCaretAfterReferencePill(rootElement: HTMLElement, pillElement: HTMLElement) {
  const spacerNode = ensureCaretSpacerAfterReference(pillElement)
  placeCaretInTextNode(rootElement, spacerNode, AI_COMPOSER_CARET_SPACER.length)
}

/** 清理引用胶囊相邻的内部光标锚点 */
function removeReferenceBoundarySpacers(pillElement: HTMLElement) {
  const previousNode = pillElement.previousSibling
  if (isTextNode(previousNode) && previousNode.data.endsWith(AI_COMPOSER_CARET_SPACER)) {
    previousNode.data = previousNode.data.slice(0, -AI_COMPOSER_CARET_SPACER.length)
    if (!previousNode.data) previousNode.remove()
  }

  const nextNode = pillElement.nextSibling
  if (isTextNode(nextNode) && nextNode.data.startsWith(AI_COMPOSER_CARET_SPACER)) {
    nextNode.data = nextNode.data.slice(AI_COMPOSER_CARET_SPACER.length)
    if (!nextNode.data) nextNode.remove()
  }
}

/** 删除引用胶囊，并把光标留在删除位置 */
export function removeReferencePill(rootElement: HTMLElement, pillElement: HTMLElement) {
  const fallbackOffset = getNodeIndex(pillElement)
  removeReferenceBoundarySpacers(pillElement)
  const nextNode = pillElement.nextSibling
  pillElement.remove()

  if (isTextNode(nextNode)) {
    placeCaretInTextNode(rootElement, nextNode, 0)
    return
  }
  if (nextNode) {
    placeCaretBeforeNode(rootElement, nextNode)
    return
  }
  placeCaretAtRootOffset(rootElement, fallbackOffset)
}

/** 读取当前输入区内的浏览器选区 */
export function getCurrentComposerRange(rootElement: HTMLElement, shouldBeCollapsed = false) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  if (shouldBeCollapsed && !selection.isCollapsed) return null
  if (!isNodeInsideComposer(rootElement, selection.anchorNode)) return null
  if (!isNodeInsideComposer(rootElement, selection.focusNode)) return null
  return selection.getRangeAt(0)
}

/** 判断缓存的选区是否仍属于当前输入区 DOM */
export function isComposerRangeUsable(rootElement: HTMLElement, range: Range | null) {
  return Boolean(
    range &&
      isNodeInsideComposer(rootElement, range.startContainer) &&
      isNodeInsideComposer(rootElement, range.endContainer)
  )
}

/** 在当前光标位置插入文本 */
export function insertTextAtSelection(rootElement: HTMLElement, text: string) {
  const range = getCurrentComposerRange(rootElement)
  if (!range) {
    rootElement.append(createTextNode(text))
    placeCaretAtEnd(rootElement)
    return
  }

  range.deleteContents()
  const textNode = createTextNode(text)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  applyComposerSelection(rootElement, range)
}

/** 读取紧邻光标左侧的引用胶囊 */
export function getReferencePillBeforeCaret(rootElement: HTMLElement) {
  const range = getCurrentComposerRange(rootElement, true)
  if (!range) return null
  const container = range.startContainer
  const offset = range.startOffset

  if (container === rootElement) {
    return findPreviousReferencePill(rootElement.childNodes[offset - 1] ?? null)
  }

  if (isTextNode(container) && stripCaretSpacers(container.data.slice(0, offset)) === '') {
    return findPreviousReferencePill(container.previousSibling)
  }

  return null
}

/** 读取紧邻光标右侧的引用胶囊 */
export function getReferencePillAfterCaret(rootElement: HTMLElement) {
  const range = getCurrentComposerRange(rootElement, true)
  if (!range) return null
  const container = range.startContainer
  const offset = range.startOffset

  if (container === rootElement) {
    return findNextReferencePill(rootElement.childNodes[offset] ?? null)
  }

  if (isTextNode(container) && stripCaretSpacers(container.data.slice(offset)) === '') {
    return findNextReferencePill(container.nextSibling)
  }

  return null
}

/** 跳过空文本节点，寻找左侧最近的引用胶囊 */
function findPreviousReferencePill(node: Node | null): HTMLElement | null {
  let currentNode = node
  while (currentNode) {
    if (isReferencePillNode(currentNode)) return currentNode
    if (isIgnorableComposerTextNode(currentNode)) {
      currentNode = currentNode.previousSibling
      continue
    }
    return null
  }

  return null
}

/** 跳过空文本节点，寻找右侧最近的引用胶囊 */
function findNextReferencePill(node: Node | null): HTMLElement | null {
  let currentNode = node
  while (currentNode) {
    if (isReferencePillNode(currentNode)) return currentNode
    if (isIgnorableComposerTextNode(currentNode)) {
      currentNode = currentNode.nextSibling
      continue
    }
    return null
  }

  return null
}

/** 把 DOM 子树读回 composer 片段 */
function collectComposerPartsFromNode(
  node: Node,
  referencesById: Map<string, AiTextReference>,
  parts: AiComposerPart[]
) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = stripCaretSpacers(node.textContent ?? '')
    if (text) parts.push(createAiComposerTextPart(text))
    return
  }
  if (!(node instanceof HTMLElement)) return

  const referenceId = node.dataset.aiReferenceId
  if (referenceId) {
    const reference = referencesById.get(referenceId)
    if (reference) parts.push(createAiComposerReferencePart(reference))
    return
  }

  if (node.tagName === 'BR') {
    parts.push(createAiComposerTextPart('\n'))
    return
  }

  const isBlockElement = node.tagName === 'DIV' || node.tagName === 'P'
  if (isBlockElement && parts.length > 0) parts.push(createAiComposerTextPart('\n'))
  Array.from(node.childNodes).forEach((childNode) => {
    collectComposerPartsFromNode(childNode, referencesById, parts)
  })
}

/** 从输入区 DOM 读取所有片段 */
export function readComposerParts(rootElement: HTMLElement | null, referencesById: Map<string, AiTextReference>) {
  if (!rootElement) return []

  const parts: AiComposerPart[] = []
  Array.from(rootElement.childNodes).forEach((node) => {
    collectComposerPartsFromNode(node, referencesById, parts)
  })

  return normalizeAiComposerParts(parts)
}
