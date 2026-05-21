import {
  MDXEditor,
  type MDXEditorMethods,
} from '@mdxeditor/editor'
import {
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { startWindowDrag, toggleWindowMaximize } from '../../tauri/window'
import { type EditorSearchControlsHandle } from './search/EditorSearchControls'
import {
  clearCurrentFileSearchHighlights,
  scrollSelectionIntoView,
  selectCurrentFileSearchMatch,
  selectVisibleTextMatch,
} from './search/currentFileSearch'
import { getSelectionMarkdownFromDom } from './clipboard/markdownCopy'
import { sanitizeMarkdownForMdxPaste } from './clipboard/markdownPaste'
import {
  clickToolbarButtonByLabel,
  EditorContextMenu,
  type EditorContextMenuActionId,
  type EditorContextMenuState,
  getClampedContextMenuPosition,
  hasEditorTextSelection,
  pasteClipboardTextIntoEditor,
} from './components/EditorContextMenu'
import {
  getMarkdownAfterTableCut,
  getSelectedTablePayload,
  writeMarkdownToClipboard,
  writeTableMarkdownToClipboard,
} from './table/tableClipboard'
import {
  createMdxTableCellSelectionController,
  type MdxTableCellSelectionController,
} from './table/tableSelection'
import { createMdxTableInputLayoutController } from './table/tableInputLayout'
import {
  captureEditorScrollSnapshot,
  getEditorContentElement,
  isBlockTypeSelectInteractionTarget,
  isTaskCheckboxPointerTarget,
  isWholeEditorContentSelected,
  isWindowDragIgnoredTarget,
  restoreEditorScrollSnapshot,
  shouldImportMarkdownFromPaste,
  type EditorScrollSnapshot,
} from './mdxEditorDom'
import { createEditorPlugins, translateMdxToolbar } from './mdxEditorPlugins'
import type { AiTextReference } from '../../domain/ai'
import { createSelectionTextReference } from './selectionReference'
import { createTaskListAutoNumberController } from './taskListAutoNumber'

interface Props {
  initialContent: string
  isAiSidebarOpen: boolean
  vaultPath: string | null
  notePath: string | null
  noteTitle: string | null
  onChange: (markdown: string) => void
  onToggleAiSidebar: () => void
  onAddSelectionToAi: (reference: AiTextReference) => void
}

export interface MdxEditorHandle {
  openSearch: () => void
  toggleSearch: () => void
  findNext: () => void
  findPrevious: () => void
  focusEditor: () => void
  selectSearchMatch: (query: string, matchOrdinal: number) => boolean
  getSelectionReference: () => AiTextReference | null
}


/** MDXEditor 富文本 Markdown 编辑器，输入输出均保持 .md 文本内容 */
export const MdxEditor = forwardRef<MdxEditorHandle, Props>(function MdxEditor(
  { initialContent, isAiSidebarOpen, vaultPath, notePath, noteTitle, onChange, onToggleAiSidebar, onAddSelectionToAi },
  ref
) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MDXEditorMethods>(null)
  const searchControlsRef = useRef<EditorSearchControlsHandle>(null)
  const pendingScrollSnapshotRef = useRef<EditorScrollSnapshot | null>(null)
  const tableSelectionControllerRef = useRef<MdxTableCellSelectionController | null>(null)
  const latestMarkdownRef = useRef(initialContent)
  const [isEditorSearchOpen, setIsEditorSearchOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<EditorContextMenuState | null>(null)
  const handleSelectEditorSearchMatch = useCallback((query: string, matchOrdinal: number) => {
    return selectCurrentFileSearchMatch(shellRef.current, query, matchOrdinal)
  }, [])
  const handleEditorSearchOpen = useCallback(() => setIsEditorSearchOpen(true), [])
  const handleEditorSearchClose = useCallback(() => setIsEditorSearchOpen(false), [])
  const plugins = useMemo(
    () =>
      createEditorPlugins({
        isAiSidebarOpen,
        isEditorSearchOpen,
        vaultPath,
        notePath,
        onToggleAiSidebar,
        onEditorSearchOpen: handleEditorSearchOpen,
        onEditorSearchClose: handleEditorSearchClose,
        searchControlsRef,
        onSelectEditorSearchMatch: handleSelectEditorSearchMatch,
      }),
    [
      handleEditorSearchClose,
      handleEditorSearchOpen,
      handleSelectEditorSearchMatch,
      isAiSidebarOpen,
      isEditorSearchOpen,
      notePath,
      onToggleAiSidebar,
      vaultPath,
    ]
  )

  useImperativeHandle(ref, () => ({
    openSearch() {
      searchControlsRef.current?.openSearch()
    },
    toggleSearch() {
      if (isEditorSearchOpen) {
        if (searchControlsRef.current) {
          searchControlsRef.current.closeSearch()
        } else {
          clearCurrentFileSearchHighlights()
          setIsEditorSearchOpen(false)
        }
      } else {
        searchControlsRef.current?.openSearch()
      }
    },
    findNext() {
      searchControlsRef.current?.findNext()
    },
    findPrevious() {
      searchControlsRef.current?.findPrevious()
    },
    focusEditor() {
      editorRef.current?.focus()
    },
    selectSearchMatch(query, matchOrdinal) {
      const isSelected = selectVisibleTextMatch(shellRef.current, query, matchOrdinal)
      if (isSelected) scrollSelectionIntoView(shellRef.current)
      return isSelected
    },
    getSelectionReference() {
      return createSelectionTextReference({
        shellElement: shellRef.current,
        path: notePath,
        title: noteTitle,
        sourceMarkdown: latestMarkdownRef.current,
      })
    },
  }))

  useEffect(() => {
    latestMarkdownRef.current = initialContent
  }, [initialContent])

  useEffect(() => {
    if (!contextMenu) return

    /** 关闭轻量菜单，避免滚动或窗口失焦后位置悬空 */
    const handleDismissContextMenu = () => setContextMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }

    document.addEventListener('pointerdown', handleDismissContextMenu)
    document.addEventListener('scroll', handleDismissContextMenu, true)
    window.addEventListener('blur', handleDismissContextMenu)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handleDismissContextMenu)
      document.removeEventListener('scroll', handleDismissContextMenu, true)
      window.removeEventListener('blur', handleDismissContextMenu)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  useEffect(() => {
    const restoreFrameIds = new Set<number>()
    const restoreTimerIds = new Set<number>()
    let pendingTaskCheckboxScrollSnapshot: EditorScrollSnapshot | null = null

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

    /** 待办 checkbox 点击会触发 Lexical 聚焦旧光标，先记住当前阅读位置 */
    const handleTaskCheckboxInteractionStart = (event: PointerEvent) => {
      if (event.button !== 0 || !isTaskCheckboxPointerTarget(event)) return
      pendingTaskCheckboxScrollSnapshot = captureEditorScrollSnapshot(shellRef.current)
    }

    /** 段落格式变更会触发异步聚焦，结束交互后把滚动位置拉回原处 */
    const handleBlockTypeSelectInteractionEnd = (event: PointerEvent | MouseEvent | KeyboardEvent) => {
      if (!pendingScrollSnapshotRef.current) return
      if (!isBlockTypeSelectInteractionTarget(event.target)) return
      scheduleEditorScrollRestore(pendingScrollSnapshotRef.current)
    }

    /** 待办状态切换后，把窗口留在用户点击的位置 */
    const handleTaskCheckboxInteractionEnd = () => {
      if (!pendingTaskCheckboxScrollSnapshot) return

      const snapshot = pendingTaskCheckboxScrollSnapshot
      pendingTaskCheckboxScrollSnapshot = null
      scheduleEditorScrollRestore(snapshot)
    }

    document.addEventListener('pointerdown', handleTaskCheckboxInteractionStart, true)
    document.addEventListener('pointerdown', handleBlockTypeSelectInteractionStart, true)
    document.addEventListener('keydown', handleBlockTypeSelectInteractionStart, true)
    document.addEventListener('pointerup', handleTaskCheckboxInteractionEnd, true)
    document.addEventListener('pointerup', handleBlockTypeSelectInteractionEnd, true)
    document.addEventListener('click', handleTaskCheckboxInteractionEnd)
    document.addEventListener('click', handleBlockTypeSelectInteractionEnd)
    document.addEventListener('keyup', handleBlockTypeSelectInteractionEnd, true)
    return () => {
      document.removeEventListener('pointerdown', handleTaskCheckboxInteractionStart, true)
      document.removeEventListener('pointerdown', handleBlockTypeSelectInteractionStart, true)
      document.removeEventListener('keydown', handleBlockTypeSelectInteractionStart, true)
      document.removeEventListener('pointerup', handleTaskCheckboxInteractionEnd, true)
      document.removeEventListener('pointerup', handleBlockTypeSelectInteractionEnd, true)
      document.removeEventListener('click', handleTaskCheckboxInteractionEnd)
      document.removeEventListener('click', handleBlockTypeSelectInteractionEnd)
      document.removeEventListener('keyup', handleBlockTypeSelectInteractionEnd, true)
      restoreFrameIds.forEach((frameId) => window.cancelAnimationFrame(frameId))
      restoreTimerIds.forEach((timerId) => window.clearTimeout(timerId))
    }
  }, [])

  useEffect(() => {
    if (!isEditorSearchOpen) clearCurrentFileSearchHighlights()
  }, [isEditorSearchOpen])

  useEffect(() => () => clearCurrentFileSearchHighlights(), [])

  useEffect(() => {
    const shellElement = shellRef.current
    if (!shellElement) return

    const tableSelectionController = createMdxTableCellSelectionController(shellElement)
    const tableInputLayoutController = createMdxTableInputLayoutController(shellElement)
    const taskListAutoNumberController = createTaskListAutoNumberController(shellElement)
    tableSelectionControllerRef.current = tableSelectionController

    return () => {
      taskListAutoNumberController.destroy()
      tableInputLayoutController.destroy()
      tableSelectionController.destroy()
      if (tableSelectionControllerRef.current === tableSelectionController) {
        tableSelectionControllerRef.current = null
      }
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

  useEffect(() => {
    /** 捕获原生复制，确保表格选区在系统菜单触发时也能生效 */
    const handleDocumentCopy = (event: globalThis.ClipboardEvent) => {
      const shellElement = shellRef.current
      const cellSelection = tableSelectionControllerRef.current?.getSelection() ?? null
      if (!shellElement) return

      // 1. 自定义表格选区不一定有浏览器焦点，因此在 document 捕获
      const sourceMarkdown = latestMarkdownRef.current
      if (cellSelection) {
        const payload = getSelectedTablePayload(shellElement, sourceMarkdown, cellSelection)
        if (!payload) return

        writeTableMarkdownToClipboard(event, payload.markdown)
        return
      }

      // 2. 整篇正文选中时复制完整源文本；局部选区则从 DOM 结构还原 Markdown
      if (isWholeEditorContentSelected(shellElement)) {
        writeMarkdownToClipboard(event, sourceMarkdown)
        return
      }

      const selectionMarkdown = getSelectionMarkdownFromDom(shellElement)
      if (selectionMarkdown) writeMarkdownToClipboard(event, selectionMarkdown)
    }

    /** 捕获原生剪切，局部选区清空单元格，整表选区删除整张表 */
    const handleDocumentCut = (event: globalThis.ClipboardEvent) => {
      const shellElement = shellRef.current
      const tableSelectionController = tableSelectionControllerRef.current
      const cellSelection = tableSelectionController?.getSelection() ?? null
      if (!shellElement || !cellSelection) return

      // 1. 剪切需要能定位到原始 Markdown 块，避免误删相似内容
      const sourceMarkdown = latestMarkdownRef.current
      const payload = getSelectedTablePayload(shellElement, sourceMarkdown, cellSelection)
      if (!payload?.block) return

      const nextMarkdown = getMarkdownAfterTableCut(sourceMarkdown, payload)
      if (nextMarkdown === null) return

      // 2. 先写剪贴板，再把变更写回编辑器
      writeTableMarkdownToClipboard(event, payload.markdown)
      editorRef.current?.setMarkdown(nextMarkdown)
      latestMarkdownRef.current = nextMarkdown
      onChange(nextMarkdown)
      tableSelectionController?.clearSelection()
      window.getSelection()?.removeAllRanges()
    }

    document.addEventListener('copy', handleDocumentCopy, true)
    document.addEventListener('cut', handleDocumentCut, true)
    return () => {
      document.removeEventListener('copy', handleDocumentCopy, true)
      document.removeEventListener('cut', handleDocumentCut, true)
    }
  }, [onChange])

  /** 捕获复制事件，表格选中时输出可再次粘贴的 Markdown 表格 */
  function handleEditorCopyCapture(event: ReactClipboardEvent<HTMLDivElement>) {
    const shellElement = shellRef.current
    if (!shellElement) return

    // 1. 优先读取自定义单元格选区，没有时再兼容浏览器整表选区
    const sourceMarkdown = latestMarkdownRef.current
    const payload = getSelectedTablePayload(
      shellElement,
      sourceMarkdown,
      tableSelectionControllerRef.current?.getSelection() ?? null
    )
    if (payload) {
      // 2. 写入 Markdown，让粘贴时仍能恢复成表格
      writeTableMarkdownToClipboard(event, payload.markdown)
      return
    }

    // 2. 整篇正文选中时复制完整源文本；局部选区则从 DOM 结构还原 Markdown
    if (isWholeEditorContentSelected(shellElement)) {
      writeMarkdownToClipboard(event, sourceMarkdown)
      return
    }

    const selectionMarkdown = getSelectionMarkdownFromDom(shellElement)
    if (selectionMarkdown) writeMarkdownToClipboard(event, selectionMarkdown)
  }

  /** 捕获剪切事件，局部选区清空单元格，整表选区删除整张表 */
  function handleEditorCutCapture(event: ReactClipboardEvent<HTMLDivElement>) {
    const shellElement = shellRef.current
    if (!shellElement) return

    // 1. 剪切需要能定位到原始 Markdown 块，避免误删相似内容
    const sourceMarkdown = latestMarkdownRef.current
    const payload = getSelectedTablePayload(
      shellElement,
      sourceMarkdown,
      tableSelectionControllerRef.current?.getSelection() ?? null
    )
    if (!payload?.block) return

    const nextMarkdown = getMarkdownAfterTableCut(sourceMarkdown, payload)
    if (nextMarkdown === null) return

    // 2. 先写剪贴板，再把变更写回编辑器
    writeTableMarkdownToClipboard(event, payload.markdown)
    editorRef.current?.setMarkdown(nextMarkdown)
    latestMarkdownRef.current = nextMarkdown
    onChange(nextMarkdown)
    tableSelectionControllerRef.current?.clearSelection()
    window.getSelection()?.removeAllRanges()
  }

  /** 捕获粘贴事件，把明显的 Markdown 纯文本按语法导入为富文本块 */
  function handleEditorPasteCapture(event: ReactClipboardEvent<HTMLDivElement>) {
    // 1. 先判断当前粘贴是否适合走 Markdown 导入
    if (!shouldImportMarkdownFromPaste(event)) return

    // 2. 阻止浏览器与 Lexical 的默认粘贴链路，避免 Markdown 被插入两次
    const pastedMarkdown = event.clipboardData.getData('text/plain')
    if (!pastedMarkdown) return

    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation?.()

    // 3. 先清洗会把 MDX 解析器卡死的尖括号片段，再交给编辑器按 Markdown 导入
    const sanitizedMarkdown = sanitizeMarkdownForMdxPaste(pastedMarkdown)
    editorRef.current?.insertMarkdown(sanitizedMarkdown)
  }

  /** 接管正文选区右键，替换 WebView 的系统级上下文菜单 */
  function handleEditorContextMenuCapture(event: ReactMouseEvent<HTMLDivElement>) {
    const contentElement = getEditorContentElement(shellRef.current)
    const eventTarget = event.target instanceof Node ? event.target : null
    if (
      !contentElement ||
      !eventTarget ||
      !contentElement.contains(eventTarget) ||
      !hasEditorTextSelection(contentElement)
    ) {
      setContextMenu(null)
      return
    }

    // 1. 阻止 macOS/WKWebView 注入查询、翻译、服务等系统菜单
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation?.()

    // 2. 显示 Mira 自己的编辑菜单，选择内容保持给后续命令使用
    setContextMenu(getClampedContextMenuPosition(event.clientX, event.clientY))
  }

  /** 执行右键菜单动作，格式化命令复用现有工具栏按钮 */
  function handleEditorContextMenuAction(actionId: EditorContextMenuActionId) {
    const shellElement = shellRef.current
    const toolbarLabels: Partial<Record<EditorContextMenuActionId, string[]>> = {
      bold: ['加粗', '取消加粗', 'Bold', 'Remove bold'],
      italic: ['斜体', '取消斜体', 'Italic', 'Remove italic'],
      underline: ['下划线', '取消下划线', 'Underline', 'Remove underline'],
      strikethrough: ['删除线', '取消删除线', 'Strikethrough', 'Remove strikethrough'],
      'inline-code': ['行内代码', '取消行内代码', 'Inline code', 'Remove inline code'],
      link: ['插入链接', 'Create link'],
    }

    // 1. 引用动作必须先读取当前选区，再把焦点交给 AI 输入框
    if (actionId === 'add-to-ai') {
      const reference = createSelectionTextReference({
        shellElement,
        path: notePath,
        title: noteTitle,
        sourceMarkdown: latestMarkdownRef.current,
      })
      setContextMenu(null)
      if (reference) onAddSelectionToAi(reference)
      return
    }

    // 2. 先收起菜单，避免它遮挡 MDXEditor 自己的链接弹层
    setContextMenu(null)
    editorRef.current?.focus()

    // 3. 富文本命令走现有工具栏，剪贴板命令走浏览器标准命令
    const labels = toolbarLabels[actionId]
    if (labels && clickToolbarButtonByLabel(shellElement, labels)) return
    if (actionId === 'copy') document.execCommand('copy')
    if (actionId === 'cut') document.execCommand('cut')
    if (actionId === 'paste') void pasteClipboardTextIntoEditor(editorRef)
  }

  return (
    <div ref={shellRef} className="mdx-editor-shell">
      <div
        className="mdx-editor-root"
        onCopyCapture={handleEditorCopyCapture}
        onCutCapture={handleEditorCutCapture}
        onPasteCapture={handleEditorPasteCapture}
        onContextMenuCapture={handleEditorContextMenuCapture}
      >
        <MDXEditor
          ref={editorRef}
          className="mira-mdx-editor"
          contentEditableClassName="mira-mdx-content"
          markdown={initialContent}
          plugins={plugins}
          translation={translateMdxToolbar}
          placeholder="开始记录..."
          suppressHtmlProcessing
          trim={false}
          toMarkdownOptions={{
            bullet: '-',
            rule: '-',
            emphasis: '*',
            strong: '*',
            listItemIndent: 'one',
          }}
          onChange={(markdown, initialMarkdownNormalize) => {
            if (!initialMarkdownNormalize) {
              latestMarkdownRef.current = markdown
              onChange(markdown)
            }
          }}
          onError={({ error, source }) => {
            console.warn('MDXEditor 解析 Markdown 失败', { error, source })
          }}
        />
        <EditorContextMenu menu={contextMenu} onAction={handleEditorContextMenuAction} />
      </div>
    </div>
  )
})
