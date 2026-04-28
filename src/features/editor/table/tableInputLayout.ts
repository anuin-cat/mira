import { MDX_TABLE_SELECTORS } from './tableSelectors'
import { getEditorTableRowCells, getEditorTableRows } from './tableSelection'

const MIRA_TABLE_INPUT_ACTIVE_ATTR = 'data-mira-table-input-active'
const MIRA_TABLE_FROZEN_COL_ATTR = 'data-mira-table-frozen-col'
const TABLE_INPUT_IDLE_DELAY_MS = 140
const TABLE_COMPOSITION_END_DELAY_MS = 80

export interface MdxTableInputLayoutController {
  destroy: () => void
}

/** 从事件目标反查正在编辑的 MDXEditor 表格 */
function getInputTable(target: EventTarget | null, shellElement: HTMLElement) {
  const targetElement = target instanceof Element ? target : null
  const table = targetElement?.closest(MDX_TABLE_SELECTORS.editorTable)
  if (!(table instanceof HTMLTableElement) || !shellElement.contains(table)) return null
  return table
}

/** 获取编辑态表格中的 colgroup 列定义 */
function getTableCols(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'))
}

/** 清理本模块写入的冻结列宽 */
function clearFrozenColumnWidths(table: HTMLTableElement) {
  table.querySelectorAll<HTMLTableColElement>(`col[${MIRA_TABLE_FROZEN_COL_ATTR}]`).forEach((col) => {
    col.style.removeProperty('width')
    col.removeAttribute(MIRA_TABLE_FROZEN_COL_ATTR)
  })
}

/** 冻结当前 auto 布局算出的内容列宽，避免切到 fixed 时变成均分列 */
function freezeCurrentColumnWidths(table: HTMLTableElement) {
  const rows = getEditorTableRows(table)
  const firstContentRow = rows.find((row) => getEditorTableRowCells(row).length > 0)
  if (!firstContentRow) return

  const cells = getEditorTableRowCells(firstContentRow)
  const cols = getTableCols(table)
  const contentColOffset = cols.length === cells.length + 2 ? 1 : 0

  cells.forEach((cell, colIndex) => {
    const col = cols[colIndex + contentColOffset]
    if (!col) return

    const width = cell.getBoundingClientRect().width
    if (width <= 0) return

    col.style.setProperty('width', `${width}px`, 'important')
    col.setAttribute(MIRA_TABLE_FROZEN_COL_ATTR, 'true')
  })
}

/** 创建表格输入布局控制器：输入期间冻结布局，空闲后恢复自动列宽 */
export function createMdxTableInputLayoutController(shellElement: HTMLElement): MdxTableInputLayoutController {
  const releaseTimerByTable = new Map<HTMLTableElement, number>()
  const activeTables = new Set<HTMLTableElement>()
  const composingTables = new Set<HTMLTableElement>()

  /** 标记表格正在输入，避免输入过程中反复触发 auto 布局测宽 */
  function markTableInputActive(table: HTMLTableElement) {
    if (!table.hasAttribute(MIRA_TABLE_INPUT_ACTIVE_ATTR)) freezeCurrentColumnWidths(table)

    activeTables.add(table)
    table.setAttribute(MIRA_TABLE_INPUT_ACTIVE_ATTR, 'true')
  }

  /** 清理单张表格的输入冻结状态 */
  function releaseTableInput(table: HTMLTableElement) {
    const timerId = releaseTimerByTable.get(table)
    if (timerId !== undefined) window.clearTimeout(timerId)

    releaseTimerByTable.delete(table)
    composingTables.delete(table)
    activeTables.delete(table)
    table.removeAttribute(MIRA_TABLE_INPUT_ACTIVE_ATTR)
    clearFrozenColumnWidths(table)
  }

  /** 输入短暂停顿后恢复 auto 布局，让第一列宽度重新按内容计算 */
  function scheduleTableInputRelease(table: HTMLTableElement, delay = TABLE_INPUT_IDLE_DELAY_MS) {
    if (composingTables.has(table)) return

    const currentTimerId = releaseTimerByTable.get(table)
    if (currentTimerId !== undefined) window.clearTimeout(currentTimerId)

    const nextTimerId = window.setTimeout(() => {
      releaseTableInput(table)
    }, delay)
    releaseTimerByTable.set(table, nextTimerId)
  }

  /** 处理普通输入与 IME 组合输入期间的布局冻结 */
  function handleBeforeInput(event: InputEvent) {
    const table = getInputTable(event.target, shellElement)
    if (!table) return

    markTableInputActive(table)
    scheduleTableInputRelease(table)
  }

  /** 兼容部分 WebView 在 beforeinput 后仍会补发 input 的情况 */
  function handleInput(event: Event) {
    const table = getInputTable(event.target, shellElement)
    if (!table) return

    markTableInputActive(table)
    scheduleTableInputRelease(table)
  }

  /** IME 组合输入开始时持续冻结布局，直到候选上屏后再恢复自动列宽 */
  function handleCompositionStart(event: CompositionEvent) {
    const table = getInputTable(event.target, shellElement)
    if (!table) return

    composingTables.add(table)
    markTableInputActive(table)
  }

  /** IME 组合结束后延迟恢复，避开上屏瞬间的 DOM 与 Lexical 同步 */
  function handleCompositionEnd(event: CompositionEvent) {
    const table = getInputTable(event.target, shellElement)
    if (!table) return

    composingTables.delete(table)
    scheduleTableInputRelease(table, TABLE_COMPOSITION_END_DELAY_MS)
  }

  shellElement.addEventListener('beforeinput', handleBeforeInput as EventListener, true)
  shellElement.addEventListener('input', handleInput, true)
  shellElement.addEventListener('compositionstart', handleCompositionStart as EventListener, true)
  shellElement.addEventListener('compositionend', handleCompositionEnd as EventListener, true)

  return {
    destroy() {
      shellElement.removeEventListener('beforeinput', handleBeforeInput as EventListener, true)
      shellElement.removeEventListener('input', handleInput, true)
      shellElement.removeEventListener('compositionstart', handleCompositionStart as EventListener, true)
      shellElement.removeEventListener('compositionend', handleCompositionEnd as EventListener, true)
      activeTables.forEach((table) => releaseTableInput(table))
      releaseTimerByTable.forEach((timerId) => window.clearTimeout(timerId))
      releaseTimerByTable.clear()
      composingTables.clear()
      activeTables.clear()
    },
  }
}
