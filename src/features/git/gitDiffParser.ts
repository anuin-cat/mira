export type GitDiffVisualLineKind = 'context' | 'addition' | 'deletion' | 'note'

export interface GitDiffInlineSegment {
  text: string
  isChanged: boolean
}

export interface GitDiffVisualLine {
  id: string
  kind: GitDiffVisualLineKind
  oldLineNumber: number | null
  newLineNumber: number | null
  text: string
  segments: GitDiffInlineSegment[]
  hasPairedCounterpart: boolean
}

export interface GitDiffHunk {
  id: string
  header: string
  lines: GitDiffVisualLine[]
}

export interface ParsedGitDiff {
  hunks: GitDiffHunk[]
  metaLines: string[]
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
const HIDDEN_META_PREFIXES = ['diff --git ', 'index ', '--- ', '+++ ']

/** 解析原始 unified diff，供 UI 做结构化渲染。 */
export function parseGitDiff(diff: string): ParsedGitDiff {
  // 1. 预处理文本与容器
  const normalizedLines = diff.replace(/\r\n/g, '\n').split('\n')
  const metaLines: string[] = []
  const hunks: GitDiffHunk[] = []
  let currentHunk: GitDiffHunk | null = null
  let oldLineNumber = 0
  let newLineNumber = 0

  // 2. 逐行解析 hunk、正文与补充说明
  normalizedLines.forEach((rawLine, index) => {
    if (!rawLine && index === normalizedLines.length - 1) return

    const hunkMatch = rawLine.match(HUNK_HEADER_RE)
    if (hunkMatch) {
      currentHunk = {
        id: `hunk-${hunks.length}`,
        header: rawLine,
        lines: [],
      }
      hunks.push(currentHunk)
      oldLineNumber = Number(hunkMatch[1])
      newLineNumber = Number(hunkMatch[3])
      return
    }

    if (!currentHunk) {
      if (shouldKeepMetaLine(rawLine)) metaLines.push(rawLine)
      return
    }

    if (rawLine.startsWith('+')) {
      currentHunk.lines.push(
        createVisualLine(`line-${index}`, 'addition', null, newLineNumber, rawLine.slice(1))
      )
      newLineNumber += 1
      return
    }

    if (rawLine.startsWith('-')) {
      currentHunk.lines.push(
        createVisualLine(`line-${index}`, 'deletion', oldLineNumber, null, rawLine.slice(1))
      )
      oldLineNumber += 1
      return
    }

    if (rawLine.startsWith(' ')) {
      currentHunk.lines.push(
        createVisualLine(`line-${index}`, 'context', oldLineNumber, newLineNumber, rawLine.slice(1))
      )
      oldLineNumber += 1
      newLineNumber += 1
      return
    }

    if (rawLine.startsWith('\\')) {
      currentHunk.lines.push(
        createVisualLine(`line-${index}`, 'note', null, null, rawLine.slice(1).trimStart())
      )
      return
    }

    if (shouldKeepMetaLine(rawLine)) metaLines.push(rawLine)
  })

  // 3. 为相邻的删除/新增块补行内高亮
  hunks.forEach((hunk) => {
    applyInlineHighlights(hunk.lines)
    applyStandaloneChangeHighlights(hunk.lines)
  })

  return { hunks, metaLines }
}

/** 创建带默认分段的可视化 diff 行。 */
function createVisualLine(
  id: string,
  kind: GitDiffVisualLineKind,
  oldLineNumber: number | null,
  newLineNumber: number | null,
  text: string
): GitDiffVisualLine {
  return {
    id,
    kind,
    oldLineNumber,
    newLineNumber,
    text,
    segments: [{ text, isChanged: false }],
    hasPairedCounterpart: false,
  }
}

/** 过滤掉重复度高、对当前视图帮助不大的元信息行。 */
function shouldKeepMetaLine(line: string): boolean {
  return Boolean(line) && !HIDDEN_META_PREFIXES.some((prefix) => line.startsWith(prefix))
}

/** 为同一变更块里的删除/新增行打上行内差异高亮。 */
function applyInlineHighlights(lines: GitDiffVisualLine[]) {
  // 1. 逐段寻找连续的删除/新增块
  let startIndex = 0
  while (startIndex < lines.length) {
    if (!isDiffChangeLine(lines[startIndex])) {
      startIndex += 1
      continue
    }

    let endIndex = startIndex
    while (endIndex < lines.length && isDiffChangeLine(lines[endIndex])) {
      endIndex += 1
    }

    const block = lines.slice(startIndex, endIndex)
    const deletions = block.filter((line) => line.kind === 'deletion')
    const additions = block.filter((line) => line.kind === 'addition')
    const pairCount = Math.min(deletions.length, additions.length)

    // 2. 对同位置的删除/新增行做一个轻量级字符差异标注
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const deletionLine = deletions[pairIndex]
      const additionLine = additions[pairIndex]
      deletionLine.hasPairedCounterpart = true
      additionLine.hasPairedCounterpart = true
      const { beforeSegments, afterSegments } = buildInlineSegments(deletionLine.text, additionLine.text)
      deletionLine.segments = beforeSegments
      additionLine.segments = afterSegments
    }

    startIndex = endIndex
  }
}

/** 给纯新增 / 纯删除行补一层整行内容高亮，避免视觉语义不一致。 */
function applyStandaloneChangeHighlights(lines: GitDiffVisualLine[]) {
  // 1. 只处理真正的新增 / 删除正文
  lines.forEach((line) => {
    if (!isDiffChangeLine(line)) return
    if (line.hasPairedCounterpart) return
    if (line.segments.some((segment) => segment.isChanged)) return
    if (!line.text) return

    // 2. 只有完全没有对应行的纯新增 / 纯删除，才把整段正文标成变化内容
    line.segments = [{ text: line.text, isChanged: true }]
  })
}

/** 判断当前行是否属于删除/新增正文。 */
function isDiffChangeLine(line: GitDiffVisualLine): boolean {
  return line.kind === 'addition' || line.kind === 'deletion'
}

/** 用公共前后缀提取一段简单、稳定的行内差异。 */
function buildInlineSegments(beforeText: string, afterText: string) {
  // 1. 计算公共前缀
  let prefixLength = 0
  const prefixLimit = Math.min(beforeText.length, afterText.length)
  while (prefixLength < prefixLimit && beforeText[prefixLength] === afterText[prefixLength]) {
    prefixLength += 1
  }

  // 2. 在不与前缀重叠的前提下计算公共后缀
  let suffixLength = 0
  while (
    suffixLength < beforeText.length - prefixLength &&
    suffixLength < afterText.length - prefixLength &&
    beforeText[beforeText.length - 1 - suffixLength] === afterText[afterText.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  // 3. 输出删除侧与新增侧的分段
  return {
    beforeSegments: createInlineSegments(beforeText, prefixLength, beforeText.length - suffixLength),
    afterSegments: createInlineSegments(afterText, prefixLength, afterText.length - suffixLength),
  }
}

/** 根据变化区间拆出普通文本与高亮文本。 */
function createInlineSegments(text: string, changeStart: number, changeEnd: number): GitDiffInlineSegment[] {
  if (!text) return [{ text: '', isChanged: false }]

  const segments: GitDiffInlineSegment[] = []
  if (changeStart > 0) {
    segments.push({ text: text.slice(0, changeStart), isChanged: false })
  }

  if (changeEnd > changeStart) {
    segments.push({ text: text.slice(changeStart, changeEnd), isChanged: true })
  }

  if (changeEnd < text.length) {
    segments.push({ text: text.slice(changeEnd), isChanged: false })
  }

  return segments.length ? segments : [{ text, isChanged: false }]
}
