/** MDXEditor 表格内部 class 片段，集中在这里便于后续交互补丁复用 */
export const MDX_TABLE_CLASS_FRAGMENTS = {
  tableEditor: '_tableEditor_',
  tableColumnEditorTrigger: '_tableColumnEditorTrigger_',
  tableRowEditorTrigger: '_tableRowEditorTrigger_',
  tableToolsColumn: '_tableToolsColumn_',
  toolCell: '_toolCell_',
  addRowButton: '_addRowButton_',
  addColumnButton: '_addColumnButton_',
  iconButton: '_iconButton_',
} as const

/** MDXEditor 表格常用 DOM 选择器，后续键盘与选择行为补丁只从这里取值 */
export const MDX_TABLE_SELECTORS = {
  editorTable: `table[class*='${MDX_TABLE_CLASS_FRAGMENTS.tableEditor}']`,
  toolCell: '[data-tool-cell]',
  contentCell: `table[class*='${MDX_TABLE_CLASS_FRAGMENTS.tableEditor}'] > tbody > tr > :is(td, th):not([data-tool-cell])`,
  toolColumn: `:is([class*='${MDX_TABLE_CLASS_FRAGMENTS.tableToolsColumn}'], [class*='${MDX_TABLE_CLASS_FRAGMENTS.toolCell}'])`,
  tableAction: [
    `[class*='${MDX_TABLE_CLASS_FRAGMENTS.tableColumnEditorTrigger}']`,
    `[class*='${MDX_TABLE_CLASS_FRAGMENTS.tableRowEditorTrigger}']`,
    `[class*='${MDX_TABLE_CLASS_FRAGMENTS.addRowButton}']`,
    `[class*='${MDX_TABLE_CLASS_FRAGMENTS.addColumnButton}']`,
    `[class*='${MDX_TABLE_CLASS_FRAGMENTS.iconButton}']`,
  ].join(', '),
} as const

export type MdxTableSelectorKey = keyof typeof MDX_TABLE_SELECTORS
