import {
  getEditorTables,
  getSelectedTableCellTexts,
  isWholeTableCellSelection,
  normalizeTableCellText,
  type MdxTableCellSelection,
  type MdxTableCellSelectionRect,
} from './tableSelection'

const MARKDOWN_TABLE_DELIMITER_CELL_RE = /^:?-{3,}:?$/

interface ClipboardWriteEvent {
  clipboardData: DataTransfer | null
  nativeEvent?: {
    stopImmediatePropagation?: () => void
  }
  preventDefault: () => void
  stopImmediatePropagation?: () => void
  stopPropagation: () => void
}

export interface MarkdownTableBlock {
  startLine: number
  endLine: number
  markdown: string
}

interface ParsedMarkdownTable {
  rows: string[][]
  delimiterCells: string[]
}

export interface SelectedTablePayload {
  markdown: string
  block: MarkdownTableBlock | null
  cellSelection: MdxTableCellSelection | null
  isWholeTable: boolean
}

/** 拆分 GFM 表格行，转义竖线不作为列分隔符 */
function splitMarkdownTableRow(line: string) {
  const trimmedLine = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''

  // 1. 逐字符扫描，避免把 \| 当成分隔符
  for (let index = 0; index < trimmedLine.length; index += 1) {
    const char = trimmedLine[index]
    const previousChar = trimmedLine[index - 1]
    if (char === '|' && previousChar !== '\\') {
      cells.push(cell.trim())
      cell = ''
      continue
    }

    cell += char
  }

  // 2. 收尾列也统一 trim，后续可直接做分隔行判断
  cells.push(cell.trim())
  return cells
}

/** 判断一行是否为 Markdown 表格分隔行 */
function isMarkdownTableDelimiterLine(line: string) {
  const cells = splitMarkdownTableRow(line)
  return cells.length > 1 && cells.every((cell) => MARKDOWN_TABLE_DELIMITER_CELL_RE.test(cell.trim()))
}

/** 扫描 Markdown 中所有 GFM 表格块，保留原始文本用于复制 */
function findMarkdownTableBlocks(markdown: string): MarkdownTableBlock[] {
  const lines = markdown.split('\n')
  const blocks: MarkdownTableBlock[] = []

  // 1. 用“表头 + 分隔行”定位表格起点，再连续收集后续表格行
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index]
    const delimiterLine = lines[index + 1]
    if (!headerLine.includes('|') || !isMarkdownTableDelimiterLine(delimiterLine)) continue

    let endLine = index + 1
    while (endLine + 1 < lines.length && lines[endLine + 1].includes('|') && lines[endLine + 1].trim()) {
      endLine += 1
    }

    blocks.push({
      startLine: index,
      endLine,
      markdown: lines.slice(index, endLine + 1).join('\n'),
    })
    index = endLine
  }

  // 2. 按文档顺序返回，方便和 DOM 表格顺序对应
  return blocks
}

/** 删除指定 Markdown 表格块，只合并一层相邻空行 */
function removeMarkdownTableBlock(markdown: string, block: MarkdownTableBlock) {
  const lines = markdown.split('\n')
  const beforeLines = lines.slice(0, block.startLine)
  const afterLines = lines.slice(block.endLine + 1)

  // 1. 表格上下各有空行时，删除其中一个，避免剪切后留下过宽空洞
  if (beforeLines[beforeLines.length - 1]?.trim() === '' && afterLines[0]?.trim() === '') {
    afterLines.shift()
  }

  // 2. 其余文本不重排，尽量保持用户原文格式
  return [...beforeLines, ...afterLines].join('\n')
}

/** 安全判断 Range 是否与节点相交，兼容断开连接节点 */
function doesRangeIntersectNode(range: Range, node: Node) {
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}

/** 判断当前浏览器选区是否覆盖了整张 MDXEditor 表格 */
function isWholeEditorTableSelected(table: HTMLTableElement, selection: Selection) {
  const contentCells = Array.from(
    table.querySelectorAll<HTMLElement>('tbody > tr > :is(td, th):not([data-tool-cell])')
  )
  if (!contentCells.length || selection.rangeCount === 0 || selection.isCollapsed) return false

  // 1. 所有真实单元格都被选区碰到时，视为整表选择
  const hasEveryCellSelected = contentCells.every((cell) => {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      if (doesRangeIntersectNode(selection.getRangeAt(index), cell)) return true
    }
    return false
  })
  if (!hasEveryCellSelected) return false

  // 2. 单格表额外确认文本完整，避免普通局部选中文字被误判
  if (contentCells.length > 1) return true
  return normalizeTableCellText(selection.toString()) === normalizeTableCellText(contentCells[0]?.textContent ?? '')
}

/** 转义 Markdown 表格单元格文本 */
function escapeMarkdownTableCell(value: string) {
  return normalizeTableCellText(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

/** 根据 Markdown 分隔列推断对齐写法 */
function getMarkdownDelimiterCell(sourceCell: string | undefined) {
  const cell = sourceCell?.trim() ?? ''
  const hasLeftColon = cell.startsWith(':')
  const hasRightColon = cell.endsWith(':')
  if (hasLeftColon && hasRightColon) return ':---:'
  if (hasRightColon) return '---:'
  if (hasLeftColon) return ':---'
  return '---'
}

/** 把单元格矩阵序列化为可粘贴回编辑器的 Markdown 表格 */
function serializeRowsToMarkdownTable(rows: string[][], delimiterCells?: string[]) {
  if (!rows.length) return ''

  const columnCount = Math.max(...rows.map((row) => row.length))
  const normalizedRows = rows.map((row) => [
    ...row.map((cell) => escapeMarkdownTableCell(cell)),
    ...Array.from({ length: columnCount - row.length }, () => ''),
  ])
  const delimiter = Array.from({ length: columnCount }, (_, index) =>
    getMarkdownDelimiterCell(delimiterCells?.[index])
  )

  return [normalizedRows[0], delimiter, ...normalizedRows.slice(1)]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')
}

/** DOM 兜底序列化：找不到原始 Markdown 块时仍能复制整表文本 */
function serializeEditorTableToMarkdown(table: HTMLTableElement) {
  const rows = getSelectedTableCellTexts(table, {
    startRowIndex: 0,
    endRowIndex: table.querySelectorAll('tbody > tr').length - 1,
    startColIndex: 0,
    endColIndex: Math.max(
      0,
      ...Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody > tr')).map(
        (row) => row.querySelectorAll(':scope > :is(td, th):not([data-tool-cell])').length - 1
      )
    ),
  })

  return serializeRowsToMarkdownTable(rows)
}

/** 解析 Markdown 表格块，供局部剪切时清空单元格 */
function parseMarkdownTableBlock(block: MarkdownTableBlock): ParsedMarkdownTable | null {
  const lines = block.markdown.split('\n')
  if (lines.length < 2 || !isMarkdownTableDelimiterLine(lines[1])) return null

  // 1. rows 不包含分隔行，索引与 DOM 里的表格行保持一致
  return {
    rows: [splitMarkdownTableRow(lines[0]), ...lines.slice(2).map(splitMarkdownTableRow)],
    delimiterCells: splitMarkdownTableRow(lines[1]),
  }
}

/** 序列化完整解析表格，用于把修改后的单元格写回 Markdown */
function serializeParsedMarkdownTable(parsedTable: ParsedMarkdownTable) {
  const columnCount = Math.max(parsedTable.delimiterCells.length, ...parsedTable.rows.map((row) => row.length))
  const normalizedRows = parsedTable.rows.map((row) => [
    ...row,
    ...Array.from({ length: columnCount - row.length }, () => ''),
  ])
  const delimiter = Array.from({ length: columnCount }, (_, index) =>
    getMarkdownDelimiterCell(parsedTable.delimiterCells[index])
  )

  return [normalizedRows[0] ?? [], delimiter, ...normalizedRows.slice(1)]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')
}

/** 用新表格文本替换原 Markdown 中的表格块 */
function replaceMarkdownTableBlock(markdown: string, block: MarkdownTableBlock, nextBlockMarkdown: string) {
  const lines = markdown.split('\n')
  return [
    ...lines.slice(0, block.startLine),
    ...nextBlockMarkdown.split('\n'),
    ...lines.slice(block.endLine + 1),
  ].join('\n')
}

/** 按矩形坐标清空 Markdown 表格中的一片单元格 */
function clearMarkdownTableCells(markdown: string, block: MarkdownTableBlock, rect: MdxTableCellSelectionRect) {
  const parsedTable = parseMarkdownTableBlock(block)
  if (!parsedTable) return null

  // 1. row 索引与 DOM 保持一致，col 索引与 Markdown 单元格保持一致
  for (let rowIndex = rect.startRowIndex; rowIndex <= rect.endRowIndex; rowIndex += 1) {
    const row = parsedTable.rows[rowIndex]
    if (!row) continue

    for (let colIndex = rect.startColIndex; colIndex <= rect.endColIndex; colIndex += 1) {
      if (colIndex < row.length) row[colIndex] = ''
    }
  }

  // 2. 只重写当前表格块，不触碰上下文 Markdown
  return replaceMarkdownTableBlock(markdown, block, serializeParsedMarkdownTable(parsedTable))
}

/** 获取表格对应的原始 Markdown 块 */
function getMarkdownBlockForTable(shellElement: HTMLElement, sourceMarkdown: string, table: HTMLTableElement) {
  const tableIndex = getEditorTables(shellElement).indexOf(table)
  if (tableIndex < 0) return null

  return findMarkdownTableBlocks(sourceMarkdown)[tableIndex] ?? null
}

/** 根据自定义单元格选区生成复制内容 */
function getCellSelectionPayload(
  shellElement: HTMLElement,
  sourceMarkdown: string,
  cellSelection: MdxTableCellSelection
): SelectedTablePayload | null {
  const block = getMarkdownBlockForTable(shellElement, sourceMarkdown, cellSelection.table)
  const isWholeTable = isWholeTableCellSelection(cellSelection.table, cellSelection.rect)
  if (isWholeTable && block) {
    return {
      markdown: block.markdown,
      block,
      cellSelection,
      isWholeTable: true,
    }
  }

  const selectedRows = getSelectedTableCellTexts(cellSelection.table, cellSelection.rect)
  const selectedCellCount =
    (cellSelection.rect.endRowIndex - cellSelection.rect.startRowIndex + 1) *
    (cellSelection.rect.endColIndex - cellSelection.rect.startColIndex + 1)
  const parsedTable = block ? parseMarkdownTableBlock(block) : null
  const delimiterCells = parsedTable?.delimiterCells.slice(
    cellSelection.rect.startColIndex,
    cellSelection.rect.endColIndex + 1
  )
  const markdown =
    selectedCellCount === 1 ? selectedRows[0]?.[0] ?? '' : serializeRowsToMarkdownTable(selectedRows, delimiterCells)
  if (!markdown) return null

  return {
    markdown,
    block,
    cellSelection,
    isWholeTable,
  }
}

/** 获取当前表格选区对应的 Markdown 内容 */
export function getSelectedTablePayload(
  shellElement: HTMLElement,
  sourceMarkdown: string,
  cellSelection: MdxTableCellSelection | null
): SelectedTablePayload | null {
  if (cellSelection) return getCellSelectionPayload(shellElement, sourceMarkdown, cellSelection)

  const selection = window.getSelection()
  if (!selection) return null

  const tables = getEditorTables(shellElement)
  const table = tables.find((candidate) => isWholeEditorTableSelected(candidate, selection))
  if (!table) return null

  const block = getMarkdownBlockForTable(shellElement, sourceMarkdown, table)
  const markdown = block?.markdown ?? serializeEditorTableToMarkdown(table)
  if (!markdown) return null

  return {
    markdown,
    block,
    cellSelection: null,
    isWholeTable: true,
  }
}

/** 根据表格复制载荷计算剪切后的 Markdown */
export function getMarkdownAfterTableCut(sourceMarkdown: string, payload: SelectedTablePayload) {
  if (!payload.block) return null
  if (payload.isWholeTable) return removeMarkdownTableBlock(sourceMarkdown, payload.block)
  if (payload.cellSelection) return clearMarkdownTableCells(sourceMarkdown, payload.block, payload.cellSelection.rect)

  return null
}

/** 把表格选区内容写入剪贴板 */
export function writeTableMarkdownToClipboard(event: ClipboardWriteEvent, markdown: string) {
  // 1. 接管本次复制/剪切，避免浏览器输出破碎 DOM 文本
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
  event.nativeEvent?.stopImmediatePropagation?.()

  // 2. text/plain 方便外部编辑器，text/markdown 方便支持 Markdown 的目标
  event.clipboardData?.setData('text/plain', markdown)
  event.clipboardData?.setData('text/markdown', markdown)
}
