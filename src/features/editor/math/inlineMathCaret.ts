import { $createTextNode, $isTextNode, type LexicalNode, type TextNode } from 'lexical'

export const INLINE_MATH_CARET_MARKER = '\u200B'
export const INLINE_MATH_CARET_MARKER_LENGTH = INLINE_MATH_CARET_MARKER.length

/** 创建行内公式后的零宽光标锚点，保证公式右侧存在真实落点 */
export function createInlineMathCaretMarker() {
  return $createTextNode(INLINE_MATH_CARET_MARKER).toggleUnmergeable()
}

/** 判断文本节点是否是行内公式使用的零宽光标锚点 */
export function isInlineMathCaretMarker(node: LexicalNode | null | undefined): node is TextNode {
  return $isTextNode(node) && node.getTextContent().startsWith(INLINE_MATH_CARET_MARKER)
}

/** 判断零宽锚点是否只包含锚点本身，没有承载用户正文 */
export function isBareInlineMathCaretMarker(node: LexicalNode | null | undefined): node is TextNode {
  return isInlineMathCaretMarker(node) && node.getTextContentSize() === INLINE_MATH_CARET_MARKER_LENGTH
}

/** 从导出文本中移除公式光标锚点 */
export function stripInlineMathCaretMarkers(textContent: string) {
  return textContent.split(INLINE_MATH_CARET_MARKER).join('')
}
