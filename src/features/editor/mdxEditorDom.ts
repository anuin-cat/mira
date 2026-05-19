import type { ClipboardEvent as ReactClipboardEvent } from 'react'
import { looksLikeMarkdown } from './markdownPaste'

const EDITOR_SCROLL_CONTAINER_SELECTOR = '.mdxeditor-root-contenteditable'
const EDITOR_CONTENT_SELECTOR = [
  '.mira-mdx-content[contenteditable="true"]',
  '.mira-mdx-content [contenteditable="true"]',
  '[contenteditable="true"].mira-mdx-content',
].join(', ')
const BLOCK_TYPE_SELECT_INTERACTION_SELECTOR = [
  '.mira-toolbar-primary [class*="_selectTrigger_"][data-toolbar-item="true"]',
  'body > .mdxeditor-popup-container.mira-mdx-editor .mdxeditor-select-content[class*="_selectContainer_"]',
].join(', ')
const TASK_LIST_ITEM_SELECTOR = "li[class*='_listItemChecked_'], li[class*='_listItemUnchecked_']"
const PASTE_MARKDOWN_IMPORT_IGNORED_TARGET_SELECTOR = [
  'input',
  'textarea',
  '.mira-code-mirror-block',
  '.cm-editor',
  '.cm-content',
].join(', ')
const WINDOW_DRAG_IGNORE_SELECTOR =
  'button, input, textarea, select, a, [role="button"], [contenteditable="true"], [data-window-drag-ignore="true"]'
const TASK_CHECKBOX_HITBOX_LEFT_PADDING = 4
const TASK_CHECKBOX_HITBOX_RIGHT = 20

export interface EditorScrollSnapshot {
  element: HTMLElement
  left: number
  top: number
}

/** 判断工具栏点击是否落在按钮、输入框等交互控件上 */
export function isWindowDragIgnoredTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(WINDOW_DRAG_IGNORE_SELECTOR))
}

/** 获取 MDXEditor 正文滚动容器 */
export function getEditorScrollElement(shellElement: HTMLElement | null) {
  return shellElement?.querySelector<HTMLElement>(EDITOR_SCROLL_CONTAINER_SELECTOR) ?? null
}

/** 获取 MDXEditor 正文可编辑节点 */
export function getEditorContentElement(shellElement: HTMLElement | null) {
  return shellElement?.querySelector<HTMLElement>(EDITOR_CONTENT_SELECTOR) ?? null
}

/** 规整浏览器选区文本，用于判断是否覆盖整篇正文 */
function normalizeSelectionText(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 安全判断 Range 是否与节点相交，兼容断开连接节点 */
function doesRangeIntersectNode(range: Range, node: Node) {
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}

/** 判断当前浏览器选区是否覆盖了整篇编辑器正文 */
export function isWholeEditorContentSelected(shellElement: HTMLElement | null) {
  const contentElement = getEditorContentElement(shellElement)
  const selection = window.getSelection()
  if (!contentElement || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false

  // 1. 先确认选区确实落在编辑器正文里，避免页面其它区域全选时误接管
  let hasContentRange = false
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    if (doesRangeIntersectNode(range, contentElement)) {
      hasContentRange = true
      break
    }
  }
  if (!hasContentRange) return false

  // 2. MDXEditor 隐藏了 Markdown 标记，只能用渲染文本判断是否整篇选中
  const selectedText = normalizeSelectionText(selection.toString())
  const contentText = normalizeSelectionText(contentElement.innerText || contentElement.textContent || '')
  return Boolean(contentText) && selectedText === contentText
}

/** 记录编辑器当前滚动位置，避免工具栏异步聚焦后跳走 */
export function captureEditorScrollSnapshot(shellElement: HTMLElement | null): EditorScrollSnapshot | null {
  const element = getEditorScrollElement(shellElement)
  if (!element) return null

  return {
    element,
    left: element.scrollLeft,
    top: element.scrollTop,
  }
}

/** 判断事件是否来自段落格式下拉菜单 */
export function isBlockTypeSelectInteractionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(BLOCK_TYPE_SELECT_INTERACTION_SELECTOR))
}

/** 判断指针是否点在 MDXEditor 待办项左侧 checkbox 热区 */
export function isTaskCheckboxPointerTarget(event: PointerEvent | MouseEvent): boolean {
  const targetElement = event.target instanceof Element ? event.target : null
  const listItemElement = targetElement?.closest<HTMLLIElement>(TASK_LIST_ITEM_SELECTOR) ?? null
  if (!listItemElement) return false

  // 1. MDXEditor 的 checkbox 是 li::before 伪元素，只能用坐标反推点击热区
  const rect = listItemElement.getBoundingClientRect()
  const isInsideVerticalRange = event.clientY >= rect.top && event.clientY <= rect.bottom
  const isInsideCheckboxRange =
    event.clientX >= rect.left - TASK_CHECKBOX_HITBOX_LEFT_PADDING &&
    event.clientX <= rect.left + TASK_CHECKBOX_HITBOX_RIGHT

  return isInsideVerticalRange && isInsideCheckboxRange
}

/** 恢复编辑器滚动位置，断开连接的旧节点直接跳过 */
export function restoreEditorScrollSnapshot(snapshot: EditorScrollSnapshot | null) {
  if (!snapshot || !snapshot.element.isConnected) return
  snapshot.element.scrollTo({
    left: snapshot.left,
    top: snapshot.top,
    behavior: 'auto',
  })
}

/** 判断本次粘贴是否应该走 Markdown 导入，而不是按普通文本插入 */
export function shouldImportMarkdownFromPaste(event: ReactClipboardEvent<HTMLDivElement>) {
  // 1. 表单控件和 CodeMirror 代码块应保留原生粘贴，避免 Markdown 自动导入吞掉文本
  const targetElement = event.target instanceof HTMLElement ? event.target : null
  if (targetElement?.closest(PASTE_MARKDOWN_IMPORT_IGNORED_TARGET_SELECTOR)) return false

  // 2. 文件/图片粘贴交给编辑器现有逻辑处理，不在这里接管
  const clipboardData = event.clipboardData
  if (!clipboardData || clipboardData.files.length > 0) return false

  // 3. 只有纯文本里出现明显 Markdown 语法时，才触发自动导入
  return looksLikeMarkdown(clipboardData.getData('text/plain'))
}
