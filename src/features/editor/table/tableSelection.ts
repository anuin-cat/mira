import { MDX_TABLE_SELECTORS } from './tableSelectors'

const MIRA_TABLE_CELL_SELECTED_ATTR = 'data-mira-table-cell-selected'
const MIRA_TABLE_SELECTED_ATTR = 'data-mira-table-selected'
const MIRA_TABLE_SELECTING_CLASS = 'mira-mdx-table-selecting'

export interface MdxTableCellCoordinates {
  rowIndex: number
  colIndex: number
}

export interface MdxTableCellSelectionRect {
  startRowIndex: number
  endRowIndex: number
  startColIndex: number
  endColIndex: number
}

export interface MdxTableCellSelection {
  table: HTMLTableElement
  anchor: MdxTableCellCoordinates
  focus: MdxTableCellCoordinates
  rect: MdxTableCellSelectionRect
}

export interface MdxTableCellSelectionController {
  getSelection: () => MdxTableCellSelection | null
  clearSelection: () => void
  destroy: () => void
}

interface MdxTableCellLocation {
  table: HTMLTableElement
  cell: HTMLElement
  coordinates: MdxTableCellCoordinates
}

interface MdxTableCellDragState {
  pointerId: number
  table: HTMLTableElement
  anchor: MdxTableCellCoordinates
  isActive: boolean
}

/** 获取编辑器正文中的 MDXEditor 表格，排除弹层或其它 UI 表格 */
export function getEditorTables(shellElement: HTMLElement) {
  return Array.from(shellElement.querySelectorAll<HTMLTableElement>(MDX_TABLE_SELECTORS.editorTable))
}

/** 获取 MDXEditor 表格的真实内容行 */
export function getEditorTableRows(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody > tr'))
}

/** 获取一行里的真实内容单元格，跳过 MDXEditor 工具列 */
export function getEditorTableRowCells(row: HTMLTableRowElement) {
  return Array.from(row.children).filter((element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false
    if (!['TD', 'TH'].includes(element.tagName)) return false
    return !element.hasAttribute('data-tool-cell')
  })
}

/** 规整单元格文本，用于复制序列化与完整选区判断 */
export function normalizeTableCellText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

/** 读取选区矩形内的单元格文本 */
export function getSelectedTableCellTexts(table: HTMLTableElement, rect: MdxTableCellSelectionRect) {
  const rows = getEditorTableRows(table)
  const selectedRows: string[][] = []

  // 1. 按 DOM 中的表格顺序取出矩形内的真实单元格
  for (let rowIndex = rect.startRowIndex; rowIndex <= rect.endRowIndex; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!row) continue

    const cells = getEditorTableRowCells(row)
    const selectedCells: string[] = []
    for (let colIndex = rect.startColIndex; colIndex <= rect.endColIndex; colIndex += 1) {
      selectedCells.push(normalizeTableCellText(cells[colIndex]?.textContent ?? ''))
    }
    selectedRows.push(selectedCells)
  }

  // 2. 返回纯文本矩阵，Markdown 转义留给复制层处理
  return selectedRows
}

/** 判断矩形选区是否覆盖了整张表格 */
export function isWholeTableCellSelection(table: HTMLTableElement, rect: MdxTableCellSelectionRect) {
  const rows = getEditorTableRows(table)
  const rowCount = rows.length
  const colCount = Math.max(0, ...rows.map((row) => getEditorTableRowCells(row).length))

  return (
    rowCount > 0 &&
    colCount > 0 &&
    rect.startRowIndex === 0 &&
    rect.startColIndex === 0 &&
    rect.endRowIndex === rowCount - 1 &&
    rect.endColIndex === colCount - 1
  )
}

/** 根据首尾坐标得到标准化矩形选区 */
function getSelectionRect(anchor: MdxTableCellCoordinates, focus: MdxTableCellCoordinates) {
  return {
    startRowIndex: Math.min(anchor.rowIndex, focus.rowIndex),
    endRowIndex: Math.max(anchor.rowIndex, focus.rowIndex),
    startColIndex: Math.min(anchor.colIndex, focus.colIndex),
    endColIndex: Math.max(anchor.colIndex, focus.colIndex),
  }
}

/** 从 DOM 目标反查所在表格、单元格和坐标 */
function getTableCellLocation(target: EventTarget | null, shellElement: HTMLElement): MdxTableCellLocation | null {
  const targetElement = target instanceof Element ? target : null
  const cell = targetElement?.closest(':is(td, th):not([data-tool-cell])')
  if (!(cell instanceof HTMLElement)) return null

  const table = cell.closest(MDX_TABLE_SELECTORS.editorTable)
  if (!(table instanceof HTMLTableElement) || !shellElement.contains(table)) return null

  const row = cell.parentElement
  if (!(row instanceof HTMLTableRowElement)) return null

  const rows = getEditorTableRows(table)
  const rowIndex = rows.indexOf(row)
  const colIndex = getEditorTableRowCells(row).indexOf(cell)
  if (rowIndex < 0 || colIndex < 0) return null

  return {
    table,
    cell,
    coordinates: { rowIndex, colIndex },
  }
}

/** 根据鼠标位置反查当前经过的表格单元格 */
function getTableCellLocationAtPoint(
  clientX: number,
  clientY: number,
  shellElement: HTMLElement
): MdxTableCellLocation | null {
  return getTableCellLocation(document.elementFromPoint(clientX, clientY), shellElement)
}

/** 判断两个单元格坐标是否一致 */
function isSameCellCoordinates(first: MdxTableCellCoordinates, second: MdxTableCellCoordinates) {
  return first.rowIndex === second.rowIndex && first.colIndex === second.colIndex
}

/** 清理旧的表格单元格高亮标记 */
function clearTableSelectionMarks(shellElement: HTMLElement) {
  shellElement
    .querySelectorAll<HTMLElement>(`[${MIRA_TABLE_CELL_SELECTED_ATTR}]`)
    .forEach((cell) => cell.removeAttribute(MIRA_TABLE_CELL_SELECTED_ATTR))
  shellElement
    .querySelectorAll<HTMLElement>(`[${MIRA_TABLE_SELECTED_ATTR}]`)
    .forEach((table) => table.removeAttribute(MIRA_TABLE_SELECTED_ATTR))
}

/** 把矩形选区同步到 DOM，提供稳定的表格高亮效果 */
function applyTableCellSelectionMarks(shellElement: HTMLElement, selection: MdxTableCellSelection) {
  clearTableSelectionMarks(shellElement)
  selection.table.setAttribute(MIRA_TABLE_SELECTED_ATTR, 'true')

  // 1. 只给真实内容单元格打标记，避免工具行列一起高亮
  const rows = getEditorTableRows(selection.table)
  for (let rowIndex = selection.rect.startRowIndex; rowIndex <= selection.rect.endRowIndex; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!row) continue

    const cells = getEditorTableRowCells(row)
    for (let colIndex = selection.rect.startColIndex; colIndex <= selection.rect.endColIndex; colIndex += 1) {
      cells[colIndex]?.setAttribute(MIRA_TABLE_CELL_SELECTED_ATTR, 'true')
    }
  }
}

/** 阻止拖拽选格后的补发 click，避免光标落到最后一个单元格里 */
function preventEvent(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

/** 创建 MDXEditor 表格单元格鼠标选择控制器 */
export function createMdxTableCellSelectionController(shellElement: HTMLElement): MdxTableCellSelectionController {
  let dragState: MdxTableCellDragState | null = null
  let currentSelection: MdxTableCellSelection | null = null
  let shouldSuppressNextClick = false

  /** 清空自定义表格选区 */
  const clearSelection = () => {
    currentSelection = null
    clearTableSelectionMarks(shellElement)
  }

  /** 更新当前表格选区并刷新高亮 */
  const setSelection = (
    table: HTMLTableElement,
    anchor: MdxTableCellCoordinates,
    focus: MdxTableCellCoordinates
  ) => {
    currentSelection = {
      table,
      anchor,
      focus,
      rect: getSelectionRect(anchor, focus),
    }
    applyTableCellSelectionMarks(shellElement, currentSelection)
  }

  /** 鼠标按下时记录起点，单击仍交给原本的单元格编辑 */
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return

    const location = getTableCellLocation(event.target, shellElement)
    if (!location) {
      clearSelection()
      dragState = null
      return
    }

    clearSelection()
    dragState = {
      pointerId: event.pointerId,
      table: location.table,
      anchor: location.coordinates,
      isActive: false,
    }
  }

  /** 鼠标拖到其它单元格后进入表格选择模式 */
  const handlePointerMove = (event: PointerEvent) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return
    if ((event.buttons & 1) !== 1) {
      dragState = null
      shellElement.classList.remove(MIRA_TABLE_SELECTING_CLASS)
      return
    }

    const location = getTableCellLocationAtPoint(event.clientX, event.clientY, shellElement)
    if (!location || location.table !== dragState.table) return

    const hasEnteredAnotherCell = !isSameCellCoordinates(dragState.anchor, location.coordinates)
    if (!dragState.isActive && !hasEnteredAnotherCell) return

    preventEvent(event)
    window.getSelection()?.removeAllRanges()
    dragState.isActive = true
    shouldSuppressNextClick = true
    shellElement.classList.add(MIRA_TABLE_SELECTING_CLASS)
    setSelection(dragState.table, dragState.anchor, location.coordinates)
  }

  /** 鼠标松开后保留选区，供复制和剪切使用 */
  const handlePointerUp = (event: PointerEvent) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return

    if (dragState.isActive) preventEvent(event)
    dragState = null
    shellElement.classList.remove(MIRA_TABLE_SELECTING_CLASS)
  }

  /** 拖拽选择后的 click 只用于收尾，不再触发单元格聚焦 */
  const handleClick = (event: MouseEvent) => {
    if (!shouldSuppressNextClick) return

    shouldSuppressNextClick = false
    preventEvent(event)
  }

  /** 点击表格外区域时清空自定义选区 */
  const handleDocumentPointerDown = (event: PointerEvent) => {
    if (!currentSelection) return
    if (event.target instanceof Node && currentSelection.table.contains(event.target)) return

    clearSelection()
  }

  /** Escape 作为轻量撤销表格选区 */
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !currentSelection) return

    clearSelection()
  }

  shellElement.addEventListener('pointerdown', handlePointerDown, true)
  shellElement.addEventListener('click', handleClick, true)
  document.addEventListener('pointermove', handlePointerMove, true)
  document.addEventListener('pointerup', handlePointerUp, true)
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  document.addEventListener('keydown', handleKeyDown, true)

  return {
    getSelection() {
      if (!currentSelection?.table.isConnected || !shellElement.contains(currentSelection.table)) return null
      return currentSelection
    },
    clearSelection,
    destroy() {
      clearSelection()
      shellElement.classList.remove(MIRA_TABLE_SELECTING_CLASS)
      shellElement.removeEventListener('pointerdown', handlePointerDown, true)
      shellElement.removeEventListener('click', handleClick, true)
      document.removeEventListener('pointermove', handlePointerMove, true)
      document.removeEventListener('pointerup', handlePointerUp, true)
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    },
  }
}
