const EDITOR_SCROLL_CONTAINER_SELECTOR = '.mdxeditor-root-contenteditable'
const EDITOR_CONTENT_SELECTOR = '.mira-mdx-content'
const CURRENT_FILE_SEARCH_HIGHLIGHT_NAME = 'mira-current-file-search-match'
const CURRENT_FILE_SEARCH_FOCUS_HIGHLIGHT_NAME = 'mira-current-file-search-active'
const CURRENT_FILE_SEARCH_STYLE_ID = 'mira-current-file-search-highlight-style'

export interface EditorSearchSelectionResult {
  total: number
  cursor: number
  selected: boolean
}

interface TextNodeRange {
  node: Text
  start: number
  end: number
}

interface TextPosition {
  node: Text
  offset: number
}

interface CssHighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

type CssHighlightConstructor = new (...ranges: Range[]) => unknown

/** 获取编辑器正文滚动容器 */
function getEditorScrollElement(shellElement: HTMLElement | null) {
  return shellElement?.querySelector<HTMLElement>(EDITOR_SCROLL_CONTAINER_SELECTOR) ?? null
}

/** 获取编辑器真实正文根节点 */
function getEditorContentElement(shellElement: HTMLElement | null) {
  return shellElement?.querySelector<HTMLElement>(EDITOR_CONTENT_SELECTOR) ?? getEditorScrollElement(shellElement)
}

/** 判断文本节点是否属于用户正文，而不是控件文案 */
function isSearchableTextNode(node: Text) {
  const parentElement = node.parentElement
  if (!parentElement) return false
  if (!node.textContent?.trim()) return false
  return !parentElement.closest('button, input, textarea, select, [role="button"], [data-tool-cell]')
}

/** 为正文可见文本建立 DOM offset 映射 */
function buildVisibleTextIndex(rootElement: HTMLElement) {
  const ranges: TextNodeRange[] = []
  const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT)
  let allText = ''

  // 1. 按 DOM 顺序收集正文文本节点，保留全局 offset
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!(node instanceof Text) || !isSearchableTextNode(node)) continue

    const start = allText.length
    allText += node.textContent ?? ''
    ranges.push({
      node,
      start,
      end: allText.length,
    })
  }

  // 2. 返回连续文本和 offset 映射，方便跨 inline 节点选区
  return { allText, ranges }
}

/** 把全局文本 offset 映射回具体 DOM 文本节点位置 */
function findTextPosition(ranges: TextNodeRange[], offset: number, isEndPosition = false): TextPosition | null {
  for (const range of ranges) {
    const isInsideStart = !isEndPosition && offset >= range.start && offset < range.end
    const isInsideEnd = isEndPosition && offset > range.start && offset <= range.end
    if (!isInsideStart && !isInsideEnd) continue

    return {
      node: range.node,
      offset: offset - range.start,
    }
  }

  return null
}

/** 获取 CSS Custom Highlight 注册表，旧 WebView 不支持时返回空 */
function getCssHighlightRegistry() {
  const css = globalThis.CSS as (typeof CSS & { highlights?: CssHighlightRegistry }) | undefined
  return css?.highlights ?? null
}

/** 获取 CSS Custom Highlight API，旧 WebView 不支持时返回空 */
function getCssHighlightTools() {
  const registry = getCssHighlightRegistry()
  const HighlightConstructor = (globalThis as typeof globalThis & {
    Highlight?: CssHighlightConstructor
  }).Highlight
  if (!registry || !HighlightConstructor) return null

  return {
    registry,
    HighlightConstructor,
  }
}

/** 清理当前文件搜索的自定义高亮 */
export function clearCurrentFileSearchHighlights() {
  const registry = getCssHighlightRegistry()
  if (registry) {
    registry.delete(CURRENT_FILE_SEARCH_HIGHLIGHT_NAME)
    registry.delete(CURRENT_FILE_SEARCH_FOCUS_HIGHLIGHT_NAME)
  }

  document.getElementById(CURRENT_FILE_SEARCH_STYLE_ID)?.remove()
}

/** 注入 CSS Highlight 样式，避开构建器对新伪元素的误报 */
function ensureCurrentFileSearchHighlightStyles() {
  if (document.getElementById(CURRENT_FILE_SEARCH_STYLE_ID)) return

  const styleElement = document.createElement('style')
  styleElement.id = CURRENT_FILE_SEARCH_STYLE_ID
  styleElement.textContent = `
::highlight(${CURRENT_FILE_SEARCH_HIGHLIGHT_NAME}) {
  color: inherit;
  background: color-mix(in srgb, var(--theme-accent) 20%, transparent 80%);
}

::highlight(${CURRENT_FILE_SEARCH_FOCUS_HIGHLIGHT_NAME}) {
  color: inherit;
  background: color-mix(in srgb, var(--theme-accent) 42%, transparent 58%);
}
`
  document.head.appendChild(styleElement)
}

/** 规范化搜索序号，允许 Enter 前后循环 */
function normalizeSearchOrdinal(matchOrdinal: number, total: number) {
  return ((matchOrdinal % total) + total) % total
}

/** 生成当前文件搜索用的可见文本 Range 列表 */
function createVisibleTextMatchRanges(rootElement: HTMLElement, query: string) {
  const normalizedQuery = query.toLocaleLowerCase()
  if (!normalizedQuery) return []

  const { allText, ranges } = buildVisibleTextIndex(rootElement)
  const normalizedText = allText.toLocaleLowerCase()
  const matchRanges: Range[] = []
  let searchStart = 0

  // 1. 在连续可见文本中找出所有非重叠命中
  while (searchStart < normalizedText.length) {
    const matchStart = normalizedText.indexOf(normalizedQuery, searchStart)
    if (matchStart < 0) break

    const matchEnd = matchStart + normalizedQuery.length
    const startPosition = findTextPosition(ranges, matchStart)
    const endPosition = findTextPosition(ranges, matchEnd, true)
    if (startPosition && endPosition) {
      const range = document.createRange()
      range.setStart(startPosition.node, startPosition.offset)
      range.setEnd(endPosition.node, endPosition.offset)
      matchRanges.push(range)
    }
    searchStart = matchEnd
  }

  return matchRanges
}

/** 把指定 Range 滚动到编辑器视口中部附近 */
function scrollRangeIntoEditorView(shellElement: HTMLElement | null, range: Range) {
  const scrollElement = getEditorScrollElement(shellElement)
  const rangeRect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  const scrollRect = scrollElement?.getBoundingClientRect()
  if (!rangeRect || !scrollElement || !scrollRect) return

  const nextTop = scrollElement.scrollTop + rangeRect.top - scrollRect.top - scrollElement.clientHeight * 0.32
  scrollElement.scrollTo({
    top: Math.max(nextTop, 0),
    behavior: 'smooth',
  })
}

/** 高亮并跳转当前文件内搜索命中 */
export function selectCurrentFileSearchMatch(
  shellElement: HTMLElement | null,
  query: string,
  matchOrdinal: number
): EditorSearchSelectionResult {
  if (!query.trim()) {
    clearCurrentFileSearchHighlights()
    return { total: 0, cursor: 0, selected: false }
  }

  clearCurrentFileSearchHighlights()

  const contentElement = getEditorContentElement(shellElement)
  if (!contentElement) return { total: 0, cursor: 0, selected: false }

  const ranges = createVisibleTextMatchRanges(contentElement, query)
  const total = ranges.length
  if (total === 0) return { total: 0, cursor: 0, selected: false }

  const selectedOrdinal = normalizeSearchOrdinal(matchOrdinal, total)
  const selectedRange = ranges[selectedOrdinal]
  const tools = getCssHighlightTools()
  if (tools) {
    ensureCurrentFileSearchHighlightStyles()
    tools.registry.set(CURRENT_FILE_SEARCH_HIGHLIGHT_NAME, new tools.HighlightConstructor(...ranges))
    tools.registry.set(CURRENT_FILE_SEARCH_FOCUS_HIGHLIGHT_NAME, new tools.HighlightConstructor(selectedRange))
  }
  scrollRangeIntoEditorView(shellElement, selectedRange)

  return {
    total,
    cursor: selectedOrdinal + 1,
    selected: true,
  }
}

/** 让浏览器原生选区选中全局搜索命中的可见文本 */
export function selectVisibleTextMatch(shellElement: HTMLElement | null, query: string, matchOrdinal: number) {
  const normalizedQuery = query.toLocaleLowerCase()
  if (!normalizedQuery) return false

  const contentElement = getEditorContentElement(shellElement)
  if (!contentElement) return false

  contentElement.focus({ preventScroll: true })
  const { allText, ranges } = buildVisibleTextIndex(contentElement)
  const normalizedText = allText.toLocaleLowerCase()
  let currentOrdinal = 0
  let searchStart = 0

  // 1. 找到第 N 个可见文本命中
  while (searchStart < normalizedText.length) {
    const matchStart = normalizedText.indexOf(normalizedQuery, searchStart)
    if (matchStart < 0) return false
    const matchEnd = matchStart + query.length

    if (currentOrdinal === matchOrdinal) {
      const startPosition = findTextPosition(ranges, matchStart)
      const endPosition = findTextPosition(ranges, matchEnd, true)
      if (!startPosition || !endPosition) return false

      // 2. 使用浏览器原生 Selection，后续粘贴会直接替换这段文字
      const range = document.createRange()
      range.setStart(startPosition.node, startPosition.offset)
      range.setEnd(endPosition.node, endPosition.offset)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return true
    }

    currentOrdinal += 1
    searchStart = matchEnd
  }

  return false
}

/** 把浏览器选区滚动到编辑器视口中部附近 */
export function scrollSelectionIntoView(shellElement: HTMLElement | null) {
  const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null
  const scrollElement = getEditorScrollElement(shellElement)
  const rangeRect = range?.getBoundingClientRect()
  const scrollRect = scrollElement?.getBoundingClientRect()
  if (!rangeRect || !scrollElement || !scrollRect) return

  const nextTop = scrollElement.scrollTop + rangeRect.top - scrollRect.top - scrollElement.clientHeight * 0.32
  scrollElement.scrollTo({
    top: Math.max(nextTop, 0),
    behavior: 'smooth',
  })
}
