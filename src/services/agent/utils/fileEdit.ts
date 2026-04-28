import type { AiFileEditOperation } from '../../../domain/ai'

const HASH_PREFIX = 'sha256:'
const LINE_DIFF_CELL_LIMIT = 1_000_000

export interface TextEditInput {
  mode: 'replace' | 'replace_between' | 'insert_before' | 'insert_after' | 'prepend' | 'append'
  oldText: string
  anchorText: string
  startAnchor: string
  endAnchor: string
  newText: string
  replaceAll: boolean
  expectedOccurrences: number
  includeStart: boolean
  includeEnd: boolean
}

export interface AppliedTextEdit {
  content: string
  operation: Omit<AiFileEditOperation, 'path'>
}

/** 生成文本内容的 SHA-256 摘要，用于写入前后的并发校验 */
export async function hashTextContent(content: string): Promise<string> {
  if (!crypto.subtle) throw new Error('当前环境不支持安全哈希，已拒绝编辑')

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${HASH_PREFIX}${hex}`
}

/** 统计非重叠文本命中位置，保留 offset 供替换和回退使用 */
export function findTextOccurrences(content: string, needle: string): Array<{ start: number; end: number }> {
  if (!needle) return []

  const occurrences: Array<{ start: number; end: number }> = []
  let searchStart = 0

  while (searchStart <= content.length) {
    const start = content.indexOf(needle, searchStart)
    if (start === -1) break

    const end = start + needle.length
    occurrences.push({ start, end })
    searchStart = end
  }

  return occurrences
}

/** 在当前内容上执行一次严格文本替换，并记录替换后区间用于撤销 */
export function applyTextEdit(content: string, edit: TextEditInput): AppliedTextEdit {
  if (edit.mode === 'replace_between') return applyReplaceBetweenEdit(content, edit)
  if (edit.mode !== 'replace') return applyInsertEdit(content, edit)

  const occurrences = findTextOccurrences(content, edit.oldText)
  if (occurrences.length === 0) throw new Error('找不到 oldText 对应的原文片段')
  if (occurrences.length !== edit.expectedOccurrences) {
    throw new Error(`oldText 命中 ${occurrences.length} 处，与 expectedOccurrences=${edit.expectedOccurrences} 不一致`)
  }
  if (!edit.replaceAll && occurrences.length !== 1) {
    throw new Error('单处替换要求 oldText 在当前内容中唯一命中')
  }

  const targetOccurrences = edit.replaceAll ? occurrences : occurrences.slice(0, 1)
  let nextContent = ''
  let cursor = 0
  const ranges: Array<{ start: number; end: number }> = []

  targetOccurrences.forEach((occurrence) => {
    nextContent += content.slice(cursor, occurrence.start)
    const nextStart = nextContent.length
    nextContent += edit.newText
    ranges.push({
      start: nextStart,
      end: nextStart + edit.newText.length,
    })
    cursor = occurrence.end
  })
  nextContent += content.slice(cursor)

  return {
    content: nextContent,
    operation: {
      oldText: edit.oldText,
      newText: edit.newText,
      replaceAll: edit.replaceAll,
      occurrenceCount: targetOccurrences.length,
      ranges,
    },
  }
}

/** 用唯一的开始/结束锚点替换一段连续内容，适合大段改写或删除 */
function applyReplaceBetweenEdit(content: string, edit: TextEditInput): AppliedTextEdit {
  if (!edit.startAnchor) throw new Error('replace_between 缺少 startAnchor')
  if (!edit.endAnchor) throw new Error('replace_between 缺少 endAnchor')

  const startOccurrences = findTextOccurrences(content, edit.startAnchor)
  const endOccurrences = findTextOccurrences(content, edit.endAnchor)
  if (startOccurrences.length === 0) throw new Error('找不到 startAnchor 对应的范围起点')
  if (endOccurrences.length === 0) throw new Error('找不到 endAnchor 对应的范围终点')
  if (startOccurrences.length !== 1) throw new Error(`startAnchor 命中 ${startOccurrences.length} 处，请提供更长上下文让起点唯一`)
  if (endOccurrences.length !== 1) throw new Error(`endAnchor 命中 ${endOccurrences.length} 处，请提供更长上下文让终点唯一`)

  const startOccurrence = startOccurrences[0]
  const endOccurrence = endOccurrences[0]
  if (startOccurrence.end > endOccurrence.start) {
    throw new Error('replace_between 要求 startAnchor 位于 endAnchor 之前，且两者不能重叠')
  }

  const replaceStart = edit.includeStart ? startOccurrence.start : startOccurrence.end
  const replaceEnd = edit.includeEnd ? endOccurrence.end : endOccurrence.start
  if (replaceStart > replaceEnd) throw new Error('replace_between 计算出的替换范围无效')

  const oldText = content.slice(replaceStart, replaceEnd)
  const nextContent = `${content.slice(0, replaceStart)}${edit.newText}${content.slice(replaceEnd)}`

  return {
    content: nextContent,
    operation: {
      oldText,
      newText: edit.newText,
      replaceAll: false,
      occurrenceCount: 1,
      ranges: [
        {
          start: replaceStart,
          end: replaceStart + edit.newText.length,
        },
      ],
    },
  }
}

/** 在唯一锚点、文首或文末插入文本，并记录插入后区间用于撤销 */
function applyInsertEdit(content: string, edit: TextEditInput): AppliedTextEdit {
  if (!edit.newText) throw new Error('新增文本不能为空')

  let insertIndex = 0
  if (edit.mode === 'append') {
    insertIndex = content.length
  } else if (edit.mode === 'insert_before' || edit.mode === 'insert_after') {
    if (!edit.anchorText) throw new Error('锚点插入缺少 anchorText')
    if (edit.expectedOccurrences !== 1) throw new Error('锚点插入要求 anchorText 在当前内容中唯一命中')

    const occurrences = findTextOccurrences(content, edit.anchorText)
    if (occurrences.length === 0) throw new Error('找不到 anchorText 对应的插入锚点')
    if (occurrences.length !== 1) throw new Error(`anchorText 命中 ${occurrences.length} 处，请提供更长上下文让位置唯一`)

    insertIndex = edit.mode === 'insert_before' ? occurrences[0].start : occurrences[0].end
  }

  const nextContent = `${content.slice(0, insertIndex)}${edit.newText}${content.slice(insertIndex)}`
  return {
    content: nextContent,
    operation: {
      oldText: '',
      newText: edit.newText,
      replaceAll: false,
      occurrenceCount: 1,
      ranges: [
        {
          start: insertIndex,
          end: insertIndex + edit.newText.length,
        },
      ],
    },
  }
}

/** 按存储的替换后区间回退一次编辑；调用方需先校验整文件 hash */
export function revertTextEdit(content: string, operation: AiFileEditOperation): string {
  let nextContent = content

  const ranges = [...operation.ranges].sort((a, b) => b.start - a.start)
  ranges.forEach((range) => {
    if (range.start < 0 || range.end < range.start || range.end > nextContent.length) {
      throw new Error(`回退区间越界：${operation.path}`)
    }

    const currentText = nextContent.slice(range.start, range.end)
    if (currentText !== operation.newText) {
      throw new Error(`回退校验失败，文件内容已变化：${operation.path}`)
    }

    nextContent = `${nextContent.slice(0, range.start)}${operation.oldText}${nextContent.slice(range.end)}`
  })

  return nextContent
}

/** 统计文本里等价于 diff 的增删行数；大文件退化为首尾收缩估算 */
export function countChangedLines(beforeContent: string, afterContent: string): {
  addedLines: number
  removedLines: number
} {
  const beforeLines = splitComparableLines(beforeContent)
  const afterLines = splitComparableLines(afterContent)

  if (beforeLines.length * afterLines.length > LINE_DIFF_CELL_LIMIT) {
    return countChangedLinesByTrimmedMiddle(beforeLines, afterLines)
  }

  const lcsLength = countLcsLength(beforeLines, afterLines)
  return {
    addedLines: Math.max(0, afterLines.length - lcsLength),
    removedLines: Math.max(0, beforeLines.length - lcsLength),
  }
}

/** 把文本拆成适合统计的行数组，空文件按 0 行处理 */
function splitComparableLines(content: string): string[] {
  if (!content) return []
  return content.split('\n')
}

/** 用两行 DP 计算 LCS 长度，避免保存完整矩阵 */
function countLcsLength(leftLines: string[], rightLines: string[]): number {
  const shorterLines = leftLines.length <= rightLines.length ? leftLines : rightLines
  const longerLines = leftLines.length <= rightLines.length ? rightLines : leftLines
  let previousRow = new Array(shorterLines.length + 1).fill(0) as number[]
  let currentRow = new Array(shorterLines.length + 1).fill(0) as number[]

  for (let longerIndex = 1; longerIndex <= longerLines.length; longerIndex += 1) {
    for (let shorterIndex = 1; shorterIndex <= shorterLines.length; shorterIndex += 1) {
      currentRow[shorterIndex] =
        longerLines[longerIndex - 1] === shorterLines[shorterIndex - 1]
          ? previousRow[shorterIndex - 1] + 1
          : Math.max(previousRow[shorterIndex], currentRow[shorterIndex - 1])
    }

    const nextPreviousRow = currentRow
    currentRow = previousRow.fill(0)
    previousRow = nextPreviousRow
  }

  return previousRow[shorterLines.length] ?? 0
}

/** 大文件兜底：先剥离相同首尾，再把中间段视为增删 */
function countChangedLinesByTrimmedMiddle(beforeLines: string[], afterLines: string[]) {
  let start = 0
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    start += 1
  }

  let beforeEnd = beforeLines.length - 1
  let afterEnd = afterLines.length - 1
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd -= 1
    afterEnd -= 1
  }

  return {
    addedLines: Math.max(0, afterEnd - start + 1),
    removedLines: Math.max(0, beforeEnd - start + 1),
  }
}
