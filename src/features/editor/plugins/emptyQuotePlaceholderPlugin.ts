import { $isQuoteNode, QuoteNode } from '@lexical/rich-text'
import {
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $nodesOfType,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical'
import { createRootEditorSubscription$, realmPlugin } from '@mdxeditor/editor'

const PLACEHOLDER_ATTR = 'data-mira-empty-quote-placeholder'
const ACTIVE_ATTR = 'data-mira-empty-quote-active'
const INVISIBLE_TEXT_RE = /[\u200b\ufeff]/g

interface EmptyQuotePlaceholderState {
  hostKey: NodeKey
  isActive: boolean
}

/** 判断节点是否是当前选区所在的引用块 */
function getQuoteKeyFromNode(node: LexicalNode): NodeKey | null {
  if ($isQuoteNode(node)) return node.getKey()

  const topLevelElement = node.getTopLevelElement()
  return $isQuoteNode(topLevelElement) ? topLevelElement.getKey() : null
}

/** 获取当前光标所在的引用块 key */
function getActiveQuoteKey(): NodeKey | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null

  return getQuoteKeyFromNode(selection.anchor.getNode()) ?? getQuoteKeyFromNode(selection.focus.getNode())
}

/** 判断引用块是否只有不可见内容 */
function isQuoteVisuallyEmpty(quoteNode: QuoteNode) {
  return quoteNode.getTextContent().replace(INVISIBLE_TEXT_RE, '').trim().length === 0
}

/** 获取承载空引用提示的 DOM 节点 key */
function getPlaceholderHostKey(quoteNode: QuoteNode): NodeKey {
  const firstChild = quoteNode.getFirstChild()
  if (quoteNode.getChildrenSize() === 1 && $isParagraphNode(firstChild)) return firstChild.getKey()

  return quoteNode.getKey()
}

/** 从当前 Lexical 状态中收集需要展示提示的空引用块 */
function collectEmptyQuotePlaceholderStates(): EmptyQuotePlaceholderState[] {
  const activeQuoteKey = getActiveQuoteKey()

  return $nodesOfType(QuoteNode)
    .filter(isQuoteVisuallyEmpty)
    .map((quoteNode) => ({
      hostKey: getPlaceholderHostKey(quoteNode),
      isActive: quoteNode.getKey() === activeQuoteKey,
    }))
}

/** 清理单个空引用提示 DOM 标记 */
function clearPlaceholderElement(element: HTMLElement) {
  element.removeAttribute(PLACEHOLDER_ATTR)
  element.removeAttribute(ACTIVE_ATTR)
}

/** 同步空引用提示 DOM 标记，避免提示内容进入 Markdown 原文 */
function syncEmptyQuotePlaceholders(editor: LexicalEditor, managedElements: Set<HTMLElement>) {
  // 1. 读取 Lexical 状态，找出当前所有空引用和活动引用
  const quoteStates = editor.getEditorState().read(collectEmptyQuotePlaceholderStates)
  const nextManagedElements = new Set<HTMLElement>()

  // 2. 给当前仍为空的引用块设置提示标记
  for (const quoteState of quoteStates) {
    const element = editor.getElementByKey(quoteState.hostKey)
    if (!element) continue

    element.setAttribute(PLACEHOLDER_ATTR, 'true')
    if (quoteState.isActive) {
      element.setAttribute(ACTIVE_ATTR, 'true')
    } else {
      element.removeAttribute(ACTIVE_ATTR)
    }
    nextManagedElements.add(element)
  }

  // 3. 移除已经不再为空或已销毁节点上的旧标记
  for (const element of managedElements) {
    if (!nextManagedElements.has(element)) clearPlaceholderElement(element)
  }

  return nextManagedElements
}

/** 空引用块提示插件 */
export const emptyQuotePlaceholderPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [createRootEditorSubscription$]: (editor: LexicalEditor) => {
        let managedElements = new Set<HTMLElement>()

        const syncPlaceholders = () => {
          managedElements = syncEmptyQuotePlaceholders(editor, managedElements)
        }

        const unregisterUpdateListener = editor.registerUpdateListener(syncPlaceholders)
        const unregisterRootListener = editor.registerRootListener((rootElement, previousRootElement) => {
          previousRootElement?.removeEventListener('focusin', syncPlaceholders)
          previousRootElement?.removeEventListener('focusout', syncPlaceholders)
          rootElement?.addEventListener('focusin', syncPlaceholders)
          rootElement?.addEventListener('focusout', syncPlaceholders)
          window.setTimeout(syncPlaceholders)
        })

        return () => {
          unregisterUpdateListener()
          unregisterRootListener()
          for (const element of managedElements) clearPlaceholderElement(element)
          managedElements.clear()
        }
      },
    })
  },
})
