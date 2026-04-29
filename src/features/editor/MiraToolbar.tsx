import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
} from '@mdxeditor/editor'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { EditorSearchControls, type EditorSearchControlsHandle } from './EditorSearchControls'
import type { EditorSearchSelectionResult } from './currentFileSearch'

const TOOLBAR_ACTION_GAP = 6
const TOOLBAR_LAYOUT_GAP = 6
const TOOLBAR_OVERFLOW_TRIGGER_FALLBACK_WIDTH = 30
const TOOLBAR_FIXED_CONTROLS_FALLBACK_WIDTH = 30

interface ToolbarOverflowItem {
  key: string
  kind: 'group' | 'separator'
  render?: () => ReactNode
}

export interface MiraToolbarProps {
  isAiSidebarOpen: boolean
  isEditorSearchOpen: boolean
  onToggleAiSidebar: () => void
  onEditorSearchOpen: () => void
  onEditorSearchClose: () => void
  searchControlsRef: Ref<EditorSearchControlsHandle>
  onSelectEditorSearchMatch: (query: string, matchOrdinal: number) => EditorSearchSelectionResult
}

/** 根据工具栏宽度计算居中工具组还能保留几个快捷按钮 */
function calculateVisibleOverflowActionCount({
  layoutWidth,
  primaryWidth,
  itemWidths,
  items,
  overflowTriggerWidth,
  fixedControlsWidth,
}: {
  layoutWidth: number
  primaryWidth: number
  itemWidths: number[]
  items: ToolbarOverflowItem[]
  overflowTriggerWidth: number
  fixedControlsWidth: number
}) {
  // 1. 从“全部可见”开始回退，直到居中工具组仍能放进右侧固定按钮左边的可用区域
  for (let visibleCount = itemWidths.length; visibleCount >= 0; visibleCount -= 1) {
    if (visibleCount > 0 && items[visibleCount - 1]?.kind === 'separator') continue

    const visibleActionsWidth =
      itemWidths.slice(0, visibleCount).reduce((sum, width) => sum + width, 0) +
      Math.max(visibleCount - 1, 0) * TOOLBAR_ACTION_GAP
    const currentFixedControlsWidth =
      fixedControlsWidth + (visibleCount < itemWidths.length ? overflowTriggerWidth + TOOLBAR_ACTION_GAP : 0)
    const availableWidth = Math.max(
      layoutWidth - primaryWidth - currentFixedControlsWidth - TOOLBAR_LAYOUT_GAP,
      0
    )

    // 2. 找到第一个能放下的方案后立即返回，保证可见按钮尽量多
    if (visibleActionsWidth <= availableWidth) return visibleCount
  }

  // 3. 理论上不会走到这里，兜底返回 0 保证布局稳定
  return 0
}

/** 判断是否为工具栏分割线项 */
function isToolbarOverflowSeparator(item: ToolbarOverflowItem | undefined) {
  return item?.kind === 'separator'
}

/** 清理隐藏区首尾多余分割线，避免弹层里出现孤立竖线 */
function trimOverflowBoundarySeparators(items: ToolbarOverflowItem[]) {
  let startIndex = 0
  let endIndex = items.length

  while (startIndex < endIndex && isToolbarOverflowSeparator(items[startIndex])) startIndex += 1
  while (endIndex > startIndex && isToolbarOverflowSeparator(items[endIndex - 1])) endIndex -= 1

  return items.slice(startIndex, endIndex)
}

/** 工具栏“更多”菜单图标，使用矢量圆点避免文本省略号显得发飘 */
function OverflowMenuIcon() {
  return (
    <svg className="mira-toolbar-overflow-icon" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="4" cy="9" r="1.4" />
      <circle cx="9" cy="9" r="1.4" />
      <circle cx="14" cy="9" r="1.4" />
    </svg>
  )
}

/** Mira 使用的 MDXEditor 顶部工具栏 */
export function MiraToolbar({
  isAiSidebarOpen,
  isEditorSearchOpen,
  onToggleAiSidebar,
  onEditorSearchOpen,
  onEditorSearchClose,
  searchControlsRef,
  onSelectEditorSearchMatch,
}: MiraToolbarProps) {
  const layoutRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLDivElement>(null)
  const fixedControlsRef = useRef<HTMLDivElement>(null)
  const aiSidebarToggleRef = useRef<HTMLButtonElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const overflowMenuRef = useRef<HTMLDivElement>(null)
  const overflowTriggerRef = useRef<HTMLButtonElement>(null)
  const [visibleItemCount, setVisibleItemCount] = useState(0)
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false)
  const overflowItems = useMemo<ToolbarOverflowItem[]>(
    () => [
      {
        key: 'formatting',
        kind: 'group',
        render: () => <BoldItalicUnderlineToggles />,
      },
      { key: 'separator-formatting', kind: 'separator' },
      {
        key: 'code-tools',
        kind: 'group',
        render: () => (
          <div className="mira-toolbar-code-group">
            <StrikeThroughSupSubToggles options={['Strikethrough']} />
            <CodeToggle />
            <InsertCodeBlock />
          </div>
        ),
      },
      { key: 'separator-inline', kind: 'separator' },
      { key: 'lists', kind: 'group', render: () => <ListsToggle /> },
      { key: 'separator-lists', kind: 'separator' },
      {
        key: 'insertions',
        kind: 'group',
        render: () => (
          <>
            <CreateLink />
            <InsertTable />
            <InsertThematicBreak />
          </>
        ),
      },
    ],
    []
  )
  const visibleItems = overflowItems.slice(0, visibleItemCount)
  const hiddenItems = useMemo(
    () => trimOverflowBoundarySeparators(overflowItems.slice(visibleItemCount)),
    [overflowItems, visibleItemCount]
  )

  useLayoutEffect(() => {
    const layoutElement = layoutRef.current
    const primaryElement = primaryRef.current
    const fixedControlsElement = fixedControlsRef.current
    const aiSidebarToggleElement = aiSidebarToggleRef.current
    const measureElement = measureRef.current
    if (!layoutElement || !primaryElement || !fixedControlsElement || !aiSidebarToggleElement || !measureElement) {
      return
    }

    let frameId = 0

    /** 重新测量工具栏，并决定中间居中区还能保留几个快捷按钮 */
    const measureToolbarOverflow = () => {
      // 1. 收集当前布局与测量容器的宽度数据
      const itemWidths = Array.from(
        measureElement.querySelectorAll<HTMLElement>('[data-overflow-item="true"]')
      ).map((element) => element.offsetWidth)
      const overflowTriggerElement = measureElement.querySelector<HTMLElement>(
        '[data-overflow-trigger="true"]'
      )

      // 2. 根据可用空间决定可见按钮数量
      const nextVisibleCount = calculateVisibleOverflowActionCount({
        layoutWidth: layoutElement.clientWidth,
        primaryWidth: primaryElement.offsetWidth,
        itemWidths,
        items: overflowItems,
        overflowTriggerWidth: overflowTriggerElement?.offsetWidth ?? TOOLBAR_OVERFLOW_TRIGGER_FALLBACK_WIDTH,
        fixedControlsWidth: aiSidebarToggleElement.offsetWidth || TOOLBAR_FIXED_CONTROLS_FALLBACK_WIDTH,
      })

      // 3. 只有数量真的变化时才更新状态，避免无意义重渲染
      setVisibleItemCount((currentCount) =>
        currentCount === nextVisibleCount ? currentCount : nextVisibleCount
      )
    }

    const handleResize = () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(measureToolbarOverflow)
    }

    handleResize()
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(layoutElement)
    resizeObserver.observe(primaryElement)
    resizeObserver.observe(fixedControlsElement)
    resizeObserver.observe(aiSidebarToggleElement)
    resizeObserver.observe(measureElement)

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [overflowItems])

  useEffect(() => {
    if (hiddenItems.length === 0 && isOverflowMenuOpen) setIsOverflowMenuOpen(false)
  }, [hiddenItems.length, isOverflowMenuOpen])

  useEffect(() => {
    if (!isOverflowMenuOpen) return

    /** 点击工具栏外部时自动收起更多菜单 */
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (overflowMenuRef.current?.contains(target)) return
      if (overflowTriggerRef.current?.contains(target)) return
      setIsOverflowMenuOpen(false)
    }

    /** 按下 Escape 时关闭更多菜单 */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOverflowMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOverflowMenuOpen])

  return (
    <>
      <div ref={layoutRef} className="mira-toolbar-layout">
        <div className="mira-toolbar-center">
          <div ref={primaryRef} className="mira-toolbar-primary">
            <UndoRedo />
            <Separator />
            <BlockTypeSelect />
            {visibleItems.length > 0 ? <Separator /> : null}
          </div>
          <div className="mira-toolbar-actions">
            {visibleItems.map((item) => (
              <div
                key={item.key}
                className={item.kind === 'separator' ? 'mira-toolbar-separator' : 'mira-toolbar-action'}
              >
                {item.kind === 'separator' ? <Separator /> : item.render?.()}
              </div>
            ))}
          </div>
        </div>
        <div ref={fixedControlsRef} className="mira-toolbar-fixed-controls">
          {hiddenItems.length > 0 ? (
            <button
              ref={overflowTriggerRef}
              type="button"
              className={`mira-toolbar-overflow-trigger${isOverflowMenuOpen ? ' active' : ''}`}
              aria-label="显示更多工具"
              aria-expanded={isOverflowMenuOpen}
              onClick={() => setIsOverflowMenuOpen((value) => !value)}
            >
              <OverflowMenuIcon />
            </button>
          ) : null}
          <button
            ref={aiSidebarToggleRef}
            type="button"
            className={`mira-ai-sidebar-toggle${isAiSidebarOpen ? ' active' : ''}`}
            aria-label={isAiSidebarOpen ? '收起 AI 侧边栏' : '展开 AI 侧边栏'}
            aria-pressed={isAiSidebarOpen}
            onClick={() => {
              setIsOverflowMenuOpen(false)
              onToggleAiSidebar()
            }}
          >
            <span className="mira-ai-sidebar-toggle-icon" aria-hidden="true">
              <span className="mira-ai-sidebar-toggle-divider" />
            </span>
          </button>
          {isOverflowMenuOpen && hiddenItems.length > 0 ? (
            <div
              ref={overflowMenuRef}
              className="mira-toolbar-overflow-popover"
              data-window-drag-ignore="true"
            >
              {hiddenItems.map((item) => (
                <div
                  key={item.key}
                  className={item.kind === 'separator' ? 'mira-toolbar-separator' : 'mira-toolbar-action'}
                >
                  {item.kind === 'separator' ? <Separator /> : item.render?.()}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div ref={measureRef} className="mira-toolbar-overflow-measure" aria-hidden="true">
          {overflowItems.map((item) => (
            <div
              key={item.key}
              className={item.kind === 'separator' ? 'mira-toolbar-separator' : 'mira-toolbar-action'}
              data-overflow-item="true"
            >
              {item.kind === 'separator' ? <Separator /> : item.render?.()}
            </div>
          ))}
          <button
            type="button"
            className="mira-toolbar-overflow-trigger"
            data-overflow-trigger="true"
            tabIndex={-1}
          >
            <OverflowMenuIcon />
          </button>
        </div>
      </div>
      <EditorSearchControls
        ref={searchControlsRef}
        isOpen={isEditorSearchOpen}
        onOpen={onEditorSearchOpen}
        onClose={onEditorSearchClose}
        onSelectMatch={onSelectEditorSearchMatch}
      />
    </>
  )
}
