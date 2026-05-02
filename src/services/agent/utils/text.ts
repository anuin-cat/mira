/** 把数字限制在指定闭区间内，并处理异常输入 */
export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 从工具入参中读取字符串，空白值回退为 null */
export function readStringInput(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 按字符数裁剪文本，并返回裁剪元信息 */
export function clipWithMeta(value: string, limit: number): {
  text: string
  isTruncated: boolean
  remainingChars: number
} {
  if (value.length <= limit) {
    return {
      text: value,
      isTruncated: false,
      remainingChars: 0,
    }
  }

  return {
    text: value.slice(0, limit),
    isTruncated: true,
    remainingChars: value.length - limit,
  }
}

export type TextSliceTruncationReason = 'line_limit' | 'char_limit' | null

export interface LineRangeSliceOptions {
  startLine: number
  lineLimit: number
  maxChars: number
  startOffset?: number | null
}

export interface LineRangeSliceResult {
  text: string
  contentLength: number
  totalLines: number
  startLine: number
  endLine: number
  startOffset: number
  endOffset: number
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  nextStartLine: number | null
  nextStartOffset: number | null
  truncationReason: TextSliceTruncationReason
}

/** 收集每一行在原文中的起始字符偏移 */
function collectLineStartOffsets(content: string): number[] {
  if (!content) return []

  const offsets = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') offsets.push(index + 1)
  }

  return offsets
}

/** 根据字符偏移反查 1-based 行号 */
function resolveLineNumber(offsets: number[], offset: number): number {
  if (offsets.length === 0) return 0

  let left = 0
  let right = offsets.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    if (offsets[middle] <= offset) {
      left = middle + 1
    } else {
      right = middle - 1
    }
  }

  return Math.max(1, right + 1)
}

/** 根据 1-based 行号获取该行起始字符偏移 */
function resolveLineStartOffset(offsets: number[], lineNumber: number, contentLength: number): number {
  if (offsets.length === 0) return 0
  if (lineNumber < 1) return 0
  if (lineNumber > offsets.length) return contentLength
  return offsets[lineNumber - 1]
}

/** 按行号或字符偏移截取原文片段，并返回后续续读游标 */
export function sliceTextByLineRange(content: string, options: LineRangeSliceOptions): LineRangeSliceResult {
  const contentLength = content.length
  const lineStartOffsets = collectLineStartOffsets(content)
  const totalLines = lineStartOffsets.length
  const lineLimit = clampNumber(options.lineLimit, 1, 1, Number.MAX_SAFE_INTEGER)
  const maxChars = clampNumber(options.maxChars, contentLength || 1, 1, Number.MAX_SAFE_INTEGER)

  if (totalLines === 0) {
    return {
      text: '',
      contentLength,
      totalLines,
      startLine: 0,
      endLine: 0,
      startOffset: 0,
      endOffset: 0,
      hasMoreBefore: false,
      hasMoreAfter: false,
      nextStartLine: null,
      nextStartOffset: null,
      truncationReason: null,
    }
  }

  const hasStartOffset = typeof options.startOffset === 'number' && !Number.isNaN(options.startOffset)
  const startOffset = hasStartOffset
    ? clampNumber(options.startOffset, 0, 0, contentLength)
    : resolveLineStartOffset(
        lineStartOffsets,
        clampNumber(options.startLine, 1, 1, Number.MAX_SAFE_INTEGER),
        contentLength
      )
  const startLine = hasStartOffset
    ? resolveLineNumber(lineStartOffsets, startOffset)
    : clampNumber(options.startLine, 1, 1, Number.MAX_SAFE_INTEGER)

  if (startOffset >= contentLength) {
    return {
      text: '',
      contentLength,
      totalLines,
      startLine,
      endLine: Math.min(startLine, totalLines),
      startOffset: contentLength,
      endOffset: contentLength,
      hasMoreBefore: contentLength > 0,
      hasMoreAfter: false,
      nextStartLine: null,
      nextStartOffset: null,
      truncationReason: null,
    }
  }

  const lineLimitedEndLine = Math.min(totalLines, startLine + lineLimit - 1)
  const lineLimitedEndOffset =
    lineLimitedEndLine < totalLines ? lineStartOffsets[lineLimitedEndLine] : contentLength
  const charLimitedEndOffset = Math.min(contentLength, startOffset + maxChars)
  const endOffset = Math.min(lineLimitedEndOffset, charLimitedEndOffset)
  const hasMoreAfter = endOffset < contentLength
  const truncationReason: TextSliceTruncationReason =
    hasMoreAfter && charLimitedEndOffset < lineLimitedEndOffset ? 'char_limit' : hasMoreAfter ? 'line_limit' : null

  return {
    text: content.slice(startOffset, endOffset),
    contentLength,
    totalLines,
    startLine,
    endLine: resolveLineNumber(lineStartOffsets, Math.max(startOffset, endOffset - 1)),
    startOffset,
    endOffset,
    hasMoreBefore: startOffset > 0,
    hasMoreAfter,
    nextStartLine: hasMoreAfter ? resolveLineNumber(lineStartOffsets, endOffset) : null,
    nextStartOffset: hasMoreAfter ? endOffset : null,
    truncationReason,
  }
}
