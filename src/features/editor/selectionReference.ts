import type { AiTextReference } from '../../domain/ai'
import { getDisplayName } from '../../services/pathUtils'
import { getEditorContentElement } from './mdxEditorDom'
import { getSelectionMarkdownFromDom } from './clipboard/markdownCopy'

interface CreateSelectionReferenceInput {
  shellElement: HTMLElement | null
  path: string | null
  title: string | null
  sourceMarkdown: string
}

interface LineRange {
  startLine: number
  endLine: number
}

/** 生成引用 id */
function createTextReferenceId() {
  return typeof crypto.randomUUID === 'function'
    ? `ref-${crypto.randomUUID()}`
    : `ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 统一换行，避免 macOS / 外部编辑器换行差异影响定位 */
function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, '\n')
}

/** 查找所有非重叠命中位置 */
function findAllOccurrences(source: string, query: string) {
  const matches: number[] = []
  if (!query) return matches

  let cursor = 0
  while (cursor <= source.length) {
    const index = source.indexOf(query, cursor)
    if (index === -1) break
    matches.push(index)
    cursor = index + Math.max(query.length, 1)
  }

  return matches
}

/** 根据 offset 计算 Markdown 行号范围 */
function getLineRangeFromOffset(source: string, startOffset: number, endOffset: number): LineRange {
  const safeStartOffset = Math.max(0, Math.min(startOffset, source.length))
  const safeEndOffset = Math.max(safeStartOffset, Math.min(endOffset, source.length))
  const startLine = source.slice(0, safeStartOffset).split('\n').length
  const endLine = source.slice(0, Math.max(safeStartOffset, safeEndOffset - 1)).split('\n').length

  return {
    startLine,
    endLine: Math.max(startLine, endLine),
  }
}

/** 计算当前选中文本在编辑器可见文本里的第几次出现 */
function getSelectionPlainTextOrdinal(shellElement: HTMLElement | null) {
  const contentElement = getEditorContentElement(shellElement)
  const selection = window.getSelection()
  if (!contentElement || !selection || selection.rangeCount === 0 || selection.isCollapsed) return 0

  const selectedText = selection.toString()
  if (!selectedText) return 0

  try {
    const range = selection.getRangeAt(0)
    const beforeRange = document.createRange()
    beforeRange.setStart(contentElement, 0)
    beforeRange.setEnd(range.startContainer, range.startOffset)
    return findAllOccurrences(beforeRange.toString(), selectedText).length
  } catch {
    return 0
  }
}

/** 根据命中列表和 DOM 顺序挑选最可能的 Markdown 命中 */
function pickOccurrenceByOrdinal(matches: number[], ordinal: number) {
  if (matches.length === 0) return null
  return matches[Math.min(Math.max(ordinal, 0), matches.length - 1)] ?? matches[0]
}

/** 尝试用一段 query 定位引用在 Markdown 源文中的行号 */
function locateLineRangeByQuery(sourceMarkdown: string, query: string, ordinal: number): LineRange | null {
  const normalizedQuery = normalizeLineEndings(query).trim()
  if (!normalizedQuery) return null

  const matches = findAllOccurrences(sourceMarkdown, normalizedQuery)
  const offset = pickOccurrenceByOrdinal(matches, ordinal)
  if (offset === null) return null

  return getLineRangeFromOffset(sourceMarkdown, offset, offset + normalizedQuery.length)
}

/** 兜底用选区首个非空行定位，保证引用仍有可展示的行号 */
function locateLineRangeByFirstSelectedLine(sourceMarkdown: string, selectedMarkdown: string): LineRange {
  const selectedLines = normalizeLineEndings(selectedMarkdown)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const firstSelectedLine = selectedLines[0] ?? ''
  const fallbackLineCount = Math.max(selectedLines.length, 1)

  if (!firstSelectedLine) {
    return {
      startLine: 1,
      endLine: Math.max(1, sourceMarkdown.split('\n').length),
    }
  }

  const offset = sourceMarkdown.indexOf(firstSelectedLine)
  if (offset === -1) {
    return {
      startLine: 1,
      endLine: Math.max(1, fallbackLineCount),
    }
  }

  const startLine = sourceMarkdown.slice(0, offset).split('\n').length
  const totalLineCount = Math.max(1, sourceMarkdown.split('\n').length)
  return {
    startLine,
    endLine: Math.min(totalLineCount, startLine + fallbackLineCount - 1),
  }
}

/** 从当前编辑器选区创建 AI 引用对象 */
export function createSelectionTextReference({
  shellElement,
  path,
  title,
  sourceMarkdown,
}: CreateSelectionReferenceInput): AiTextReference | null {
  if (!shellElement || !path) return null

  const selectedMarkdown = getSelectionMarkdownFromDom(shellElement)
  const selectedPlainText = window.getSelection()?.toString() ?? ''
  if (!selectedMarkdown.trim() && !selectedPlainText.trim()) return null

  const normalizedSource = normalizeLineEndings(sourceMarkdown)
  const occurrenceOrdinal = getSelectionPlainTextOrdinal(shellElement)
  const lineRange =
    locateLineRangeByQuery(normalizedSource, selectedMarkdown, occurrenceOrdinal) ??
    locateLineRangeByQuery(normalizedSource, selectedPlainText, occurrenceOrdinal) ??
    locateLineRangeByFirstSelectedLine(normalizedSource, selectedMarkdown || selectedPlainText)

  return {
    id: createTextReferenceId(),
    path,
    title: title || getDisplayName(path, 'file'),
    startLine: lineRange.startLine,
    endLine: lineRange.endLine,
    content: selectedMarkdown.trim() || selectedPlainText.trim(),
  }
}
