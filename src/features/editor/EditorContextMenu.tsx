import { type MDXEditorMethods } from '@mdxeditor/editor'
import { Bold, ClipboardPaste, Code2, Copy, Italic, Link, Scissors, Strikethrough, Underline } from 'lucide-react'
import { type ReactNode, type RefObject } from 'react'
import { sanitizeMarkdownForMdxPaste } from './markdownPaste'

const EDITOR_CONTEXT_MENU_WIDTH = 172
const EDITOR_CONTEXT_MENU_HEIGHT = 284
const EDITOR_CONTEXT_MENU_VIEWPORT_MARGIN = 8

export interface EditorContextMenuState {
  x: number
  y: number
}

export type EditorContextMenuActionId =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'inline-code'
  | 'link'
  | 'cut'
  | 'copy'
  | 'paste'

interface EditorContextMenuAction {
  id: EditorContextMenuActionId
  label: string
  shortcut?: string
  icon: ReactNode
}

const EDITOR_CONTEXT_MENU_ACTIONS: Array<EditorContextMenuAction | 'separator'> = [
  { id: 'bold', label: '加粗', shortcut: '⌘B', icon: <Bold /> },
  { id: 'italic', label: '斜体', shortcut: '⌘I', icon: <Italic /> },
  { id: 'underline', label: '下划线', shortcut: '⌘U', icon: <Underline /> },
  { id: 'strikethrough', label: '删除线', icon: <Strikethrough /> },
  { id: 'inline-code', label: '行内代码', shortcut: '⌘E', icon: <Code2 /> },
  'separator',
  { id: 'link', label: '插入链接', shortcut: '⌘K', icon: <Link /> },
  'separator',
  { id: 'cut', label: '剪切', shortcut: '⌘X', icon: <Scissors /> },
  { id: 'copy', label: '复制', shortcut: '⌘C', icon: <Copy /> },
  { id: 'paste', label: '粘贴', shortcut: '⌘V', icon: <ClipboardPaste /> },
]

/** 安全判断 Range 是否与节点相交，兼容断开连接节点 */
function doesRangeIntersectNode(range: Range, node: Node) {
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}

/** 判断当前浏览器选区是否落在编辑器正文内 */
export function hasEditorTextSelection(contentElement: HTMLElement | null) {
  const selection = window.getSelection()
  if (!contentElement || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false

  // 1. 只接管正文内的文本选择，避免误拦截其它输入控件
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    if (doesRangeIntersectNode(range, contentElement)) return true
  }

  return false
}

/** 把右键菜单约束在当前窗口可见区域内 */
export function getClampedContextMenuPosition(clientX: number, clientY: number): EditorContextMenuState {
  const maxX = Math.max(window.innerWidth - EDITOR_CONTEXT_MENU_WIDTH - EDITOR_CONTEXT_MENU_VIEWPORT_MARGIN, 0)
  const maxY = Math.max(window.innerHeight - EDITOR_CONTEXT_MENU_HEIGHT - EDITOR_CONTEXT_MENU_VIEWPORT_MARGIN, 0)

  return {
    x: Math.max(EDITOR_CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(clientX, maxX)),
    y: Math.max(EDITOR_CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(clientY, maxY)),
  }
}

/** 从现有工具栏按钮触发 MDXEditor 命令，保证右键菜单与工具栏行为一致 */
export function clickToolbarButtonByLabel(shellElement: HTMLElement | null, labels: string[]) {
  const toolbarElement = shellElement?.querySelector<HTMLElement>('.mira-mdx-toolbar')
  if (!toolbarElement) return false

  // 1. 工具栏会按窗口宽度折叠，测量区里也保留了完整按钮，因此统一按可访问名称查找
  const buttons = Array.from(toolbarElement.querySelectorAll<HTMLButtonElement>('button'))
  const button = buttons.find((element) => {
    const accessibleNames = [element.getAttribute('aria-label'), element.getAttribute('title')]
      .filter(Boolean)
      .map((value) => value?.trim())
    return accessibleNames.some((name) => name && labels.includes(name))
  })
  if (!button) return false

  button.click()
  return true
}

/** 粘贴剪贴板文本，优先复用 Markdown 导入逻辑 */
export async function pasteClipboardTextIntoEditor(editorRef: RefObject<MDXEditorMethods | null>) {
  try {
    const clipboardText = await navigator.clipboard?.readText?.()
    if (!clipboardText) return false

    editorRef.current?.insertMarkdown(sanitizeMarkdownForMdxPaste(clipboardText))
    return true
  } catch {
    return document.execCommand('paste')
  }
}

/** 编辑器选中文本时显示的轻量右键菜单，只保留 Mira 编辑相关操作 */
export function EditorContextMenu({
  menu,
  onAction,
}: {
  menu: EditorContextMenuState | null
  onAction: (actionId: EditorContextMenuActionId) => void
}) {
  if (!menu) return null

  return (
    <div
      className="mira-editor-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      aria-label="编辑器上下文菜单"
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {EDITOR_CONTEXT_MENU_ACTIONS.map((action, index) => {
        if (action === 'separator') {
          return <div key={`separator-${index}`} className="mira-editor-context-menu-separator" />
        }

        return (
          <button
            key={action.id}
            type="button"
            className="mira-editor-context-menu-item"
            role="menuitem"
            onClick={() => onAction(action.id)}
          >
            <span className="mira-editor-context-menu-icon" aria-hidden="true">
              {action.icon}
            </span>
            <span className="mira-editor-context-menu-label">{action.label}</span>
            {action.shortcut ? <span className="mira-editor-context-menu-shortcut">{action.shortcut}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
