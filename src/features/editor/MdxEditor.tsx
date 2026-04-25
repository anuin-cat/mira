import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  MDXEditor,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  headingsPlugin,
  imagePlugin,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  linkDialogPlugin,
  linkPlugin,
  ListsToggle,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  searchPlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCodeBlockEditorContext,
  type CodeBlockEditorProps,
  type MDXEditorMethods,
  type RealmPlugin,
} from '@mdxeditor/editor'
import {
  type ClipboardEvent as ReactClipboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { startWindowDrag, toggleWindowMaximize } from '../../tauri/window'

const IMAGE_AUTOCOMPLETE_SUGGESTIONS = ['./', '../', 'assets/', 'images/']
const CODE_TOKEN_RE =
  /(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|import|export|from|if|else|for|while|class|interface|type|async|await|true|false|null|undefined)\b)/g
const MARKDOWN_PASTE_BLOCK_RE =
  /(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+|```|~~~|\|.+\|\s*$|(?:[-*_]\s*){3,}$)/m
const MARKDOWN_PASTE_INLINE_RE =
  /(?:!\[[^\]]*]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`)/
const TOOLBAR_TRANSLATIONS: Record<string, string> = {
  'toolbar.bold': '加粗',
  'toolbar.removeBold': '取消加粗',
  'toolbar.italic': '斜体',
  'toolbar.removeItalic': '取消斜体',
  'toolbar.underline': '下划线',
  'toolbar.removeUnderline': '取消下划线',
  'toolbar.inlineCode': '行内代码',
  'toolbar.removeInlineCode': '取消行内代码',
  'toolbar.strikethrough': '删除线',
  'toolbar.removeStrikethrough': '取消删除线',
  'toolbar.bulletedList': '无序列表',
  'toolbar.numberedList': '有序列表',
  'toolbar.checkList': '任务列表',
  'toolbar.blockTypeSelect.selectBlockTypeTooltip': '选择段落类型',
  'toolbar.blockTypeSelect.placeholder': '段落类型',
  'toolbar.blockTypes.paragraph': '正文',
  'toolbar.blockTypes.quote': '引用',
  'toolbar.link': '插入链接',
  'toolbar.image': '插入图片',
  'toolbar.table': '插入表格',
  'toolbar.thematicBreak': '插入分隔线',
  'toolbar.codeBlock': '插入代码块',
}
const TOOLBAR_ACTION_GAP = 6
const TOOLBAR_LAYOUT_GAP = 6
const TOOLBAR_OVERFLOW_TRIGGER_FALLBACK_WIDTH = 30
const TOOLBAR_FIXED_CONTROLS_FALLBACK_WIDTH = 30
const EDITOR_SCROLL_CONTAINER_SELECTOR = '.mdxeditor-root-contenteditable'
const BLOCK_TYPE_SELECT_INTERACTION_SELECTOR = [
  '.mira-toolbar-primary [class*="_selectTrigger_"][data-toolbar-item="true"]',
  'body > .mdxeditor-popup-container.mira-mdx-editor .mdxeditor-select-content[class*="_selectContainer_"]',
].join(', ')
const WINDOW_DRAG_IGNORE_SELECTOR =
  'button, input, textarea, select, a, [role="button"], [contenteditable="true"], [data-window-drag-ignore="true"]'

interface ToolbarOverflowAction {
  key: string
  render: () => React.ReactNode
}

interface Props {
  initialContent: string
  isAiSidebarOpen: boolean
  onChange: (markdown: string) => void
  onToggleAiSidebar: () => void
}

interface EditorScrollSnapshot {
  element: HTMLElement
  left: number
  top: number
}

/** 转义代码内容，避免高亮时把用户文本当作 HTML */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 根据代码片段内容判断高亮分类 */
function getCodeTokenClass(token: string) {
  if (token.startsWith('//') || token.startsWith('#')) return 'mira-code-token-comment'
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
    return 'mira-code-token-string'
  }
  return 'mira-code-token-keyword'
}

/** 判断一段纯文本是否明显带有 Markdown 语法，避免误伤普通粘贴 */
function looksLikeMarkdown(text: string) {
  // 1. 先过滤空白内容，避免无意义的语法判断
  const normalizedText = text.trim()
  if (!normalizedText) return false

  // 2. 优先识别标题、列表、引用、代码块、表格等块级语法
  if (MARKDOWN_PASTE_BLOCK_RE.test(normalizedText)) return true

  // 3. 再补充识别粗体、链接、行内代码等常见行内语法
  return MARKDOWN_PASTE_INLINE_RE.test(normalizedText)
}

/** 判断工具栏点击是否落在按钮、输入框等交互控件上 */
function isWindowDragIgnoredTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(WINDOW_DRAG_IGNORE_SELECTOR))
}

/** 获取 MDXEditor 正文滚动容器 */
function getEditorScrollElement(shellElement: HTMLElement | null) {
  return shellElement?.querySelector<HTMLElement>(EDITOR_SCROLL_CONTAINER_SELECTOR) ?? null
}

/** 记录编辑器当前滚动位置，避免工具栏异步聚焦后跳走 */
function captureEditorScrollSnapshot(shellElement: HTMLElement | null): EditorScrollSnapshot | null {
  const element = getEditorScrollElement(shellElement)
  if (!element) return null

  return {
    element,
    left: element.scrollLeft,
    top: element.scrollTop,
  }
}

/** 判断事件是否来自段落格式下拉菜单 */
function isBlockTypeSelectInteractionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(BLOCK_TYPE_SELECT_INTERACTION_SELECTOR))
}

/** 恢复编辑器滚动位置，断开连接的旧节点直接跳过 */
function restoreEditorScrollSnapshot(snapshot: EditorScrollSnapshot | null) {
  if (!snapshot || !snapshot.element.isConnected) return
  snapshot.element.scrollTo({
    left: snapshot.left,
    top: snapshot.top,
    behavior: 'auto',
  })
}

/** 判断本次粘贴是否应该走 Markdown 导入，而不是按普通文本插入 */
function shouldImportMarkdownFromPaste(event: ReactClipboardEvent<HTMLDivElement>) {
  // 1. 输入框和 textarea 里应保留原生粘贴，避免代码块与弹窗输入被自动格式化
  const targetElement = event.target instanceof HTMLElement ? event.target : null
  if (targetElement?.closest('input, textarea')) return false

  // 2. 文件/图片粘贴交给编辑器现有逻辑处理，不在这里接管
  const clipboardData = event.clipboardData
  if (!clipboardData || clipboardData.files.length > 0) return false

  // 3. 只有纯文本里出现明显 Markdown 语法时，才触发自动导入
  return looksLikeMarkdown(clipboardData.getData('text/plain'))
}

/** 根据工具栏宽度计算居中工具组还能保留几个快捷按钮 */
function calculateVisibleOverflowActionCount({
  layoutWidth,
  primaryWidth,
  actionWidths,
  overflowTriggerWidth,
  fixedControlsWidth,
}: {
  layoutWidth: number
  primaryWidth: number
  actionWidths: number[]
  overflowTriggerWidth: number
  fixedControlsWidth: number
}) {
  // 1. 从“全部可见”开始回退，直到居中工具组仍能放进右侧固定按钮左边的可用区域
  for (let visibleCount = actionWidths.length; visibleCount >= 0; visibleCount -= 1) {
    const visibleActionsWidth =
      actionWidths.slice(0, visibleCount).reduce((sum, width) => sum + width, 0) +
      Math.max(visibleCount - 1, 0) * TOOLBAR_ACTION_GAP
    const currentFixedControlsWidth =
      fixedControlsWidth +
      (visibleCount < actionWidths.length ? overflowTriggerWidth + TOOLBAR_ACTION_GAP : 0)
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

/** 给轻量代码块做最小语法高亮，不引入额外高亮库 */
function highlightCode(code: string) {
  let html = ''
  let cursor = 0

  for (const match of code.matchAll(CODE_TOKEN_RE)) {
    const index = match.index ?? 0
    const token = match[0]
    html += escapeHtml(code.slice(cursor, index))
    html += `<span class="${getCodeTokenClass(token)}">${escapeHtml(token)}</span>`
    cursor = index + token.length
  }

  return html + escapeHtml(code.slice(cursor))
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

/** 轻量代码块编辑器：保留语言和内容编辑，避免拉入完整 CodeMirror 代码块编辑器 */
function LightCodeBlockEditor({ code, language, focusEmitter }: CodeBlockEditorProps) {
  // 1. 维护轻量编辑态，并响应 MDXEditor 的聚焦请求
  const { setCode, setLanguage } = useCodeBlockEditorContext()
  const [isEditing, setIsEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    focusEmitter.subscribe(() => {
      setIsEditing(true)
      window.requestAnimationFrame(() => textareaRef.current?.focus())
    })
  }, [focusEmitter])

  useEffect(() => {
    if (isEditing) window.requestAnimationFrame(() => textareaRef.current?.focus())
  }, [isEditing])

  // 2. 预览态展示轻量高亮，编辑态使用原生 textarea 写回 Markdown
  return (
    <div className="mira-code-block">
      <div className="mira-code-block-toolbar">
        <input
          className="mira-code-block-language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          placeholder="txt"
          aria-label="代码语言"
        />
        <button type="button" onClick={() => setIsEditing((value) => !value)}>
          {isEditing ? '完成' : '编辑'}
        </button>
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="mira-code-block-textarea"
          value={code}
          spellCheck={false}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              setIsEditing(false)
            }
            if (event.key === 'Escape') setIsEditing(false)
          }}
        />
      ) : (
        <pre className="mira-code-block-preview" onDoubleClick={() => setIsEditing(true)}>
          <code dangerouslySetInnerHTML={{ __html: highlightCode(code) }} />
        </pre>
      )}
    </div>
  )
}

/** Mira 使用的 MDXEditor 顶部工具栏 */
function MiraToolbar({
  isAiSidebarOpen,
  onToggleAiSidebar,
}: Pick<Props, 'isAiSidebarOpen' | 'onToggleAiSidebar'>) {
  const layoutRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLDivElement>(null)
  const fixedControlsRef = useRef<HTMLDivElement>(null)
  const aiSidebarToggleRef = useRef<HTMLButtonElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const overflowMenuRef = useRef<HTMLDivElement>(null)
  const overflowTriggerRef = useRef<HTMLButtonElement>(null)
  const [visibleActionCount, setVisibleActionCount] = useState(0)
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false)
  const overflowActions = useMemo<ToolbarOverflowAction[]>(
    () => [
      { key: 'formatting', render: () => <BoldItalicUnderlineToggles /> },
      { key: 'inline-code', render: () => <CodeToggle /> },
      {
        key: 'strikethrough',
        render: () => <StrikeThroughSupSubToggles options={['Strikethrough']} />,
      },
      { key: 'lists', render: () => <ListsToggle /> },
      { key: 'link', render: () => <CreateLink /> },
      { key: 'image', render: () => <InsertImage /> },
      { key: 'table', render: () => <InsertTable /> },
      { key: 'thematic-break', render: () => <InsertThematicBreak /> },
      { key: 'code-block', render: () => <InsertCodeBlock /> },
    ],
    []
  )
  const visibleActions = overflowActions.slice(0, visibleActionCount)
  const hiddenActions = overflowActions.slice(visibleActionCount)

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
      const actionWidths = Array.from(
        measureElement.querySelectorAll<HTMLElement>('[data-overflow-item="true"]')
      ).map((element) => element.offsetWidth)
      const overflowTriggerElement = measureElement.querySelector<HTMLElement>(
        '[data-overflow-trigger="true"]'
      )

      // 2. 根据可用空间决定可见按钮数量
      const nextVisibleCount = calculateVisibleOverflowActionCount({
        layoutWidth: layoutElement.clientWidth,
        primaryWidth: primaryElement.offsetWidth,
        actionWidths,
        overflowTriggerWidth: overflowTriggerElement?.offsetWidth ?? TOOLBAR_OVERFLOW_TRIGGER_FALLBACK_WIDTH,
        fixedControlsWidth: aiSidebarToggleElement.offsetWidth || TOOLBAR_FIXED_CONTROLS_FALLBACK_WIDTH,
      })

      // 3. 只有数量真的变化时才更新状态，避免无意义重渲染
      setVisibleActionCount((currentCount) =>
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
  }, [overflowActions])

  useEffect(() => {
    if (hiddenActions.length === 0 && isOverflowMenuOpen) setIsOverflowMenuOpen(false)
  }, [hiddenActions.length, isOverflowMenuOpen])

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
            {visibleActions.length > 0 ? <Separator /> : null}
          </div>
          <div className="mira-toolbar-actions">
            {visibleActions.map((action) => (
              <div key={action.key} className="mira-toolbar-action">
                {action.render()}
              </div>
            ))}
          </div>
        </div>
        <div ref={fixedControlsRef} className="mira-toolbar-fixed-controls">
          {hiddenActions.length > 0 ? (
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
          {isOverflowMenuOpen && hiddenActions.length > 0 ? (
            <div
              ref={overflowMenuRef}
              className="mira-toolbar-overflow-popover"
              data-window-drag-ignore="true"
            >
              {hiddenActions.map((action) => (
                <div key={action.key} className="mira-toolbar-action">
                  {action.render()}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div ref={measureRef} className="mira-toolbar-overflow-measure" aria-hidden="true">
          {overflowActions.map((action) => (
            <div
              key={action.key}
              className="mira-toolbar-action"
              data-overflow-item="true"
            >
              {action.render()}
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
    </>
  )
}

/** 创建 MDXEditor 插件集合，只保留 Mira 当前要评估的 Markdown 能力 */
function createEditorPlugins({
  isAiSidebarOpen,
  onToggleAiSidebar,
}: Pick<Props, 'isAiSidebarOpen' | 'onToggleAiSidebar'>): RealmPlugin[] {
  return [
    headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin({ showLinkTitleField: true }),
    imagePlugin({
      imageAutocompleteSuggestions: IMAGE_AUTOCOMPLETE_SUGGESTIONS,
      disableImageResize: false,
      disableImageSettingsButton: false,
      allowSetImageDimensions: true,
    }),
    tablePlugin(),
    codeBlockPlugin({
      defaultCodeBlockLanguage: 'txt',
      codeBlockEditorDescriptors: [
        {
          priority: 1,
          match: () => true,
          Editor: LightCodeBlockEditor,
        },
      ],
    }),
    searchPlugin(),
    markdownShortcutPlugin(),
    toolbarPlugin({
      toolbarContents: () => (
        <MiraToolbar isAiSidebarOpen={isAiSidebarOpen} onToggleAiSidebar={onToggleAiSidebar} />
      ),
      toolbarClassName: 'mira-mdx-toolbar',
    }),
  ]
}

/** MDXEditor 富文本 Markdown 编辑器，输入输出均保持 .md 文本内容 */
export function MdxEditor({ initialContent, isAiSidebarOpen, onChange, onToggleAiSidebar }: Props) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MDXEditorMethods>(null)
  const pendingScrollSnapshotRef = useRef<EditorScrollSnapshot | null>(null)
  const plugins = useMemo(
    () => createEditorPlugins({ isAiSidebarOpen, onToggleAiSidebar }),
    [isAiSidebarOpen, onToggleAiSidebar]
  )

  useEffect(() => {
    const restoreFrameIds = new Set<number>()
    const restoreTimerIds = new Set<number>()

    /** 延迟多轮恢复，覆盖 MDXEditor 设置块类型后的异步 focus */
    const scheduleEditorScrollRestore = (snapshot: EditorScrollSnapshot | null) => {
      if (!snapshot) return

      const restore = () => restoreEditorScrollSnapshot(snapshot)
      const scheduleFrame = (callback: () => void) => {
        const frameId = window.requestAnimationFrame(() => {
          restoreFrameIds.delete(frameId)
          callback()
        })
        restoreFrameIds.add(frameId)
      }
      const scheduleTimer = (callback: () => void, delay: number) => {
        const timerId = window.setTimeout(() => {
          restoreTimerIds.delete(timerId)
          callback()
        }, delay)
        restoreTimerIds.add(timerId)
      }

      restore()
      scheduleTimer(restore, 0)
      scheduleFrame(() => {
        restore()
        scheduleFrame(restore)
      })
      scheduleTimer(restore, 80)
      scheduleTimer(() => {
        restore()
        if (pendingScrollSnapshotRef.current === snapshot) pendingScrollSnapshotRef.current = null
      }, 160)
    }

    /** 段落格式菜单开始交互前，先记住用户当前阅读位置 */
    const handleBlockTypeSelectInteractionStart = (event: PointerEvent | KeyboardEvent) => {
      if (!isBlockTypeSelectInteractionTarget(event.target)) return
      pendingScrollSnapshotRef.current = captureEditorScrollSnapshot(shellRef.current)
    }

    /** 段落格式变更会触发异步聚焦，结束交互后把滚动位置拉回原处 */
    const handleBlockTypeSelectInteractionEnd = (event: PointerEvent | MouseEvent | KeyboardEvent) => {
      if (!pendingScrollSnapshotRef.current) return
      if (!isBlockTypeSelectInteractionTarget(event.target)) return
      scheduleEditorScrollRestore(pendingScrollSnapshotRef.current)
    }

    document.addEventListener('pointerdown', handleBlockTypeSelectInteractionStart, true)
    document.addEventListener('keydown', handleBlockTypeSelectInteractionStart, true)
    document.addEventListener('pointerup', handleBlockTypeSelectInteractionEnd, true)
    document.addEventListener('click', handleBlockTypeSelectInteractionEnd)
    document.addEventListener('keyup', handleBlockTypeSelectInteractionEnd, true)
    return () => {
      document.removeEventListener('pointerdown', handleBlockTypeSelectInteractionStart, true)
      document.removeEventListener('keydown', handleBlockTypeSelectInteractionStart, true)
      document.removeEventListener('pointerup', handleBlockTypeSelectInteractionEnd, true)
      document.removeEventListener('click', handleBlockTypeSelectInteractionEnd)
      document.removeEventListener('keyup', handleBlockTypeSelectInteractionEnd, true)
      restoreFrameIds.forEach((frameId) => window.cancelAnimationFrame(frameId))
      restoreTimerIds.forEach((timerId) => window.clearTimeout(timerId))
    }
  }, [])

  useEffect(() => {
    const toolbarElement = shellRef.current?.querySelector<HTMLElement>('.mira-mdx-toolbar')
    if (!toolbarElement) return

    const handleToolbarMouseDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || event.detail > 1) return
      if (isWindowDragIgnoredTarget(event.target)) return

      event.preventDefault()
      void startWindowDrag().catch((error) => {
        console.warn('窗口拖动启动失败', error)
      })
    }
    const handleToolbarDoubleClick = (event: globalThis.MouseEvent) => {
      if (isWindowDragIgnoredTarget(event.target)) return

      event.preventDefault()
      void toggleWindowMaximize().catch((error) => {
        console.warn('窗口最大化切换失败', error)
      })
    }

    toolbarElement.addEventListener('mousedown', handleToolbarMouseDown)
    toolbarElement.addEventListener('dblclick', handleToolbarDoubleClick)
    return () => {
      toolbarElement.removeEventListener('mousedown', handleToolbarMouseDown)
      toolbarElement.removeEventListener('dblclick', handleToolbarDoubleClick)
    }
  }, [])

  /** 捕获粘贴事件，把明显的 Markdown 纯文本按语法导入为富文本块 */
  function handleEditorPasteCapture(event: ReactClipboardEvent<HTMLDivElement>) {
    // 1. 先判断当前粘贴是否适合走 Markdown 导入
    if (!shouldImportMarkdownFromPaste(event)) return

    // 2. 阻止浏览器与 Lexical 的默认粘贴链路，避免 Markdown 被插入两次
    const markdownText = event.clipboardData.getData('text/plain')
    if (!markdownText) return

    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation?.()

    // 3. 改用 MDXEditor 的 Markdown 解析能力，把纯文本导入为富文本块
    editorRef.current?.insertMarkdown(markdownText)
  }

  return (
    <div ref={shellRef} className="mdx-editor-shell">
      <div className="mdx-editor-root" onPasteCapture={handleEditorPasteCapture}>
        <MDXEditor
          ref={editorRef}
          className="mira-mdx-editor"
          contentEditableClassName="mira-mdx-content"
          markdown={initialContent}
          plugins={plugins}
          translation={(key, defaultValue, interpolations) => {
            if (key === 'toolbar.undo') {
              const shortcut = String(interpolations?.shortcut ?? '')
              return `撤销 ${shortcut}`.trim()
            }
            if (key === 'toolbar.redo') {
              const shortcut = String(interpolations?.shortcut ?? '')
              return `重做 ${shortcut}`.trim()
            }
            if (key === 'toolbar.blockTypes.heading') {
              const level = String(interpolations?.level ?? '')
              return `标题 ${level}`.trim()
            }
            return TOOLBAR_TRANSLATIONS[key] ?? defaultValue
          }}
          placeholder="开始记录..."
          trim={false}
          toMarkdownOptions={{
            bullet: '-',
            rule: '-',
            emphasis: '*',
            strong: '*',
            listItemIndent: 'one',
          }}
          onChange={(markdown, initialMarkdownNormalize) => {
            if (!initialMarkdownNormalize) onChange(markdown)
          }}
          onError={({ error, source }) => {
            console.warn('MDXEditor 解析 Markdown 失败', { error, source })
          }}
        />
      </div>
    </div>
  )
}
