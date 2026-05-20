import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Tree } from 'react-arborist'
import type { NodeApi, RenameHandler, TreeApi } from 'react-arborist'
import {
  ChevronRight,
  Command as CommandIcon,
  FilePlus,
  FolderOpen,
  FolderPlus,
  MessageSquarePlus,
  MoreHorizontal,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Type,
} from 'lucide-react'
import type { VaultEntryKind, VaultTreeNode } from '../../domain/note'
import { getParentPath, MARKDOWN_EXTENSION } from '../../services/pathUtils'
import { startWindowDrag, toggleWindowMaximize } from '../../tauri/window'
import {
  getCommandDefinition,
  getCommandShortcut,
  WORKSPACE_MENU_COMMAND_SECTIONS,
  type CommandId,
  type WorkspaceMenuEntry,
  type WorkspaceMenuSubmenuId,
} from '../commands/commandRegistry'
import { TREE_ROW_HEIGHT, TREE_VERTICAL_PADDING, useFileTreeDrag } from './useFileTreeDrag'
import { VaultNode } from './VaultNode'

const WINDOW_DRAG_IGNORE_SELECTOR = 'button, input, textarea, select, a, [role="button"]'
const WORKSPACE_MENU_WIDTH = 224
const WORKSPACE_MENU_VIEWPORT_MARGIN = 8

interface ContextMenuState {
  x: number
  y: number
  target: VaultTreeNode | null
}

interface WorkspaceMenuPosition {
  left: number
  top: number
}

interface FileTreeProps {
  treeData: VaultTreeNode[]
  activePath: string | null
  expandedDirs: string[]
  onOpenFile: (path: string) => Promise<void>
  onCreateFile: (parentPath: string | null) => Promise<string | null>
  onCreateFolder: (parentPath: string | null) => Promise<string | null>
  onRenameEntry: (path: string, name: string, kind: VaultEntryKind) => Promise<string | null>
  onMoveEntry: (path: string, targetDir: string | null, kind: VaultEntryKind) => Promise<void>
  onReorderEntry: (
    path: string,
    targetParentPath: string | null,
    beforePath: string | null,
    kind: VaultEntryKind
  ) => Promise<void>
  onDeleteEntry: (path: string, kind: VaultEntryKind) => Promise<void>
  onExpandedDirsChange: (paths: string[]) => void
  onRunCommand: (commandId: CommandId) => void
  style?: CSSProperties
}

export interface FileTreeHandle {
  createFile: () => void
  createFolder: () => void
  renameActive: () => void
  deleteActive: () => void
}

/** 查找文件树节点是否已经出现在最新数据中 */
function hasNode(nodes: VaultTreeNode[], id: string): boolean {
  return nodes.some((node) => node.id === id || hasNode(node.children ?? [], id))
}

/** 按路径查找文件树节点 */
function findNodeByPath(nodes: VaultTreeNode[], path: string | null): VaultTreeNode | null {
  if (!path) return null

  for (const node of nodes) {
    if (node.path === path) return node
    const childNode = findNodeByPath(node.children ?? [], path)
    if (childNode) return childNode
  }

  return null
}

/** 从未知异常中提取可展示消息 */
function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : '操作失败'
}

/** 判断标题栏点击是否落在交互控件上 */
function isWindowDragIgnoredTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(WINDOW_DRAG_IGNORE_SELECTOR))
}

/** 为工作区菜单命令选择轻量图标 */
function getWorkspaceMenuIcon(commandId: CommandId): ReactNode {
  switch (commandId) {
    case 'new-file':
      return <FilePlus />
    case 'new-folder':
      return <FolderPlus />
    case 'change-vault':
      return <FolderOpen />
    case 'refresh-vault':
      return <RefreshCw />
    case 'quick-open':
    case 'search-vault':
      return <Search />
    case 'command-palette':
      return <CommandIcon />
    case 'font-small':
    case 'font-medium':
    case 'font-large':
    case 'font-xlarge':
      return <Type />
    case 'theme-default':
    case 'theme-warm-paper':
    case 'theme-twilight':
    case 'theme-forest':
    case 'theme-dark-classic':
      return <Palette />
    case 'ai-new-chat':
    case 'ai-ask-current-note':
      return <MessageSquarePlus />
    case 'app-settings':
      return <Settings />
    default:
      return <CommandIcon />
  }
}

/** 为工作区二级菜单选择图标 */
function getWorkspaceSubmenuIcon(submenuId: WorkspaceMenuSubmenuId): ReactNode {
  if (submenuId === 'font-size') return <Type />
  return <Palette />
}

/** 左侧 Markdown 文件树 */
export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
  {
    treeData,
    activePath,
    expandedDirs,
    onOpenFile,
    onCreateFile,
    onCreateFolder,
    onRenameEntry,
    onMoveEntry,
    onReorderEntry,
    onDeleteEntry,
    onExpandedDirsChange,
    onRunCommand,
    style,
  },
  ref
) {
  const treeRef = useRef<TreeApi<VaultTreeNode> | undefined>(undefined)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null)
  const workspaceMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const [treeHeight, setTreeHeight] = useState(600)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false)
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState<WorkspaceMenuPosition | null>(null)
  const [openWorkspaceSubmenuId, setOpenWorkspaceSubmenuId] = useState<WorkspaceMenuSubmenuId | null>(null)
  const [pendingEditId, setPendingEditId] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<VaultTreeNode | null>(null)

  const initialOpenState = useMemo(
    () => Object.fromEntries(expandedDirs.map((path) => [path, true])),
    []
  )
  const { handleTreeMouseDown } = useFileTreeDrag({
    treeData,
    treeRef,
    bodyRef,
    onMoveEntry,
    onReorderEntry,
    onExpandedDirsChange,
  })

  // 1. 自适应高度
  useEffect(() => {
    function updateHeight() {
      setTreeHeight(bodyRef.current?.clientHeight ?? 600)
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  // 2. 右键菜单和工作区菜单自动关闭
  useEffect(() => {
    if (!contextMenu && !isWorkspaceMenuOpen) return

    const closeFloatingMenus = () => {
      setContextMenu(null)
      setIsWorkspaceMenuOpen(false)
      setWorkspaceMenuPosition(null)
      setOpenWorkspaceSubmenuId(null)
    }

    function isMenuInnerTarget(target: EventTarget | null): boolean {
      if (!(target instanceof Node)) return false
      return (
        contextMenuRef.current?.contains(target) === true ||
        workspaceMenuRef.current?.contains(target) === true ||
        workspaceMenuButtonRef.current?.contains(target) === true
      )
    }

    function handleDocumentMouseDown(event: globalThis.MouseEvent) {
      if (event.button !== 0) return
      if (isMenuInnerTarget(event.target)) return
      closeFloatingMenus()
    }

    function handleWindowKeyDown() {
      closeFloatingMenus()
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    document.addEventListener('scroll', closeFloatingMenus, true)
    window.addEventListener('resize', closeFloatingMenus)
    window.addEventListener('keydown', handleWindowKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true)
      document.removeEventListener('scroll', closeFloatingMenus, true)
      window.removeEventListener('resize', closeFloatingMenus)
      window.removeEventListener('keydown', handleWindowKeyDown)
    }
  }, [contextMenu, isWorkspaceMenuOpen])

  // 3. 新建后触发内联编辑
  useEffect(() => {
    if (!pendingEditId || !hasNode(treeData, pendingEditId)) return
    const editId = pendingEditId
    setPendingEditId(null)
    setTimeout(() => {
      treeRef.current?.scrollTo(editId)
      treeRef.current?.edit(editId)
    })
  }, [pendingEditId, treeData])

  // 4. 文件树刷新后清理已不存在的选中项
  useEffect(() => {
    if (selectedEntry && !findNodeByPath(treeData, selectedEntry.path)) setSelectedEntry(null)
  }, [selectedEntry, treeData])

  // 5. 收集当前已展开目录
  function collectOpenDirs(): string[] {
    const openState = treeRef.current?.openState ?? {}
    return Object.entries(openState)
      .filter(([, isOpen]) => isOpen)
      .map(([path]) => path)
  }

  // ========== 文件/文件夹操作 ==========

  async function handleCreateFile(parentPath: string | null) {
    try {
      if (parentPath) treeRef.current?.open(parentPath)
      const createdPath = await onCreateFile(parentPath)
      if (createdPath) setPendingEditId(createdPath)
    } catch (error) {
      window.alert(getErrorMessage(error))
    }
  }

  async function handleCreateFolder(parentPath: string | null) {
    try {
      if (parentPath) treeRef.current?.open(parentPath)
      const createdPath = await onCreateFolder(parentPath)
      if (createdPath) setPendingEditId(createdPath)
    } catch (error) {
      window.alert(getErrorMessage(error))
    }
  }

  const handleRename: RenameHandler<VaultTreeNode> = async ({ node, name }) => {
    try {
      await onRenameEntry(node.data.path, name, node.data.kind)
    } catch (error) {
      window.alert(getErrorMessage(error))
    }
  }

  function openContextMenu(event: MouseEvent, target: VaultTreeNode | null) {
    event.preventDefault()
    event.stopPropagation()
    bodyRef.current?.focus({ preventScroll: true })
    setIsWorkspaceMenuOpen(false)
    setWorkspaceMenuPosition(null)
    setOpenWorkspaceSubmenuId(null)
    setSelectedEntry(target)
    setContextMenu({ x: event.clientX, y: event.clientY, target })
  }

  /** 文件树区域获得焦点后承接局部快捷键 */
  function handleBodyMouseDown(event: MouseEvent<HTMLDivElement>) {
    bodyRef.current?.focus({ preventScroll: true })
    handleTreeMouseDown(event)
  }

  /** 文件树局部快捷键：只在用户明确聚焦文件树时生效 */
  function handleBodyKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) return

    if (event.key === 'F2') {
      const target = getCommandTarget()
      if (!target) return
      event.preventDefault()
      treeRef.current?.edit(target.id)
      return
    }

    if (event.key === 'Delete') {
      const target = getCommandTarget()
      if (!target) return
      event.preventDefault()
      confirmAndDeleteEntry(target)
    }
  }

  /** 顶部空白区域按下鼠标时触发原生窗口拖动 */
  function handleHeaderMouseDown(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || event.detail > 1) return
    if (isWindowDragIgnoredTarget(event.target)) return

    event.preventDefault()
    void startWindowDrag().catch((error) => {
      console.warn('窗口拖动启动失败', error)
    })
  }

  /** 顶部空白区域双击时切换窗口最大化 */
  function handleHeaderDoubleClick(event: MouseEvent<HTMLElement>) {
    if (isWindowDragIgnoredTarget(event.target)) return

    event.preventDefault()
    void toggleWindowMaximize().catch((error) => {
      console.warn('窗口最大化切换失败', error)
    })
  }

  function contextParentPath(): string | null {
    if (!contextMenu?.target) return null
    return contextMenu.target.kind === 'directory'
      ? contextMenu.target.path
      : getParentPath(contextMenu.target.path)
  }

  /** 执行工作区菜单命令，保持入口收起后再交给统一命令系统 */
  function handleWorkspaceCommand(commandId: CommandId) {
    setIsWorkspaceMenuOpen(false)
    setWorkspaceMenuPosition(null)
    setOpenWorkspaceSubmenuId(null)
    setContextMenu(null)
    onRunCommand(commandId)
  }

  /** 根据触发按钮位置打开工作区菜单，避免被侧栏布局层级裁切 */
  function handleWorkspaceMenuButtonClick() {
    if (isWorkspaceMenuOpen) {
      setIsWorkspaceMenuOpen(false)
      setWorkspaceMenuPosition(null)
      setOpenWorkspaceSubmenuId(null)
      return
    }

    const buttonRect = workspaceMenuButtonRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    const maxLeft = Math.max(
      WORKSPACE_MENU_VIEWPORT_MARGIN,
      window.innerWidth - WORKSPACE_MENU_WIDTH - WORKSPACE_MENU_VIEWPORT_MARGIN
    )
    setContextMenu(null)
    setWorkspaceMenuPosition({
      left: Math.max(WORKSPACE_MENU_VIEWPORT_MARGIN, Math.min(buttonRect.left, maxLeft)),
      top: buttonRect.bottom + 8,
    })
    setOpenWorkspaceSubmenuId(null)
    setIsWorkspaceMenuOpen(true)
  }

  /** 获取命令默认作用的文件树节点 */
  function getCommandTarget(): VaultTreeNode | null {
    const selectedNode = findNodeByPath(treeData, selectedEntry?.path ?? null)
    if (selectedNode) return selectedNode
    return findNodeByPath(treeData, activePath)
  }

  /** 确认后删除指定文件树节点 */
  function confirmAndDeleteEntry(target: VaultTreeNode) {
    const label = target.kind === 'file'
      ? `${target.name}${MARKDOWN_EXTENSION}`
      : target.name
    if (!window.confirm(`确认删除「${label}」？`)) return

    onDeleteEntry(target.path, target.kind).catch((error) => {
      window.alert(getErrorMessage(error))
    })
  }

  useImperativeHandle(ref, () => ({
    createFile() {
      void handleCreateFile(defaultCreateParent)
    },
    createFolder() {
      void handleCreateFolder(defaultCreateParent)
    },
    renameActive() {
      const target = getCommandTarget()
      if (target) treeRef.current?.edit(target.id)
    },
    deleteActive() {
      const target = getCommandTarget()
      if (target) confirmAndDeleteEntry(target)
    },
  }))

  const defaultCreateParent = selectedEntry
    ? selectedEntry.kind === 'directory'
      ? selectedEntry.path
      : getParentPath(selectedEntry.path)
    : activePath
      ? getParentPath(activePath)
      : null
  const menuTarget = contextMenu?.target ?? null
  const selectedPath = activePath ?? undefined

  /** 渲染工作区菜单里的普通命令 */
  function renderWorkspaceCommandItem(commandId: CommandId) {
    const command = getCommandDefinition(commandId)
    if (!command) return null
    const shortcut = getCommandShortcut(command)

    return (
      <button
        key={command.id}
        type="button"
        className="workspace-menu-item"
        role="menuitem"
        onClick={() => handleWorkspaceCommand(command.id)}
      >
        <span className="workspace-menu-item-icon" aria-hidden>
          {getWorkspaceMenuIcon(command.id)}
        </span>
        <span className="workspace-menu-item-label">{command.title}</span>
        {shortcut ? <span className="workspace-menu-item-shortcut">{shortcut}</span> : null}
      </button>
    )
  }

  /** 渲染工作区菜单条目，字体和主题使用二级菜单承载 */
  function renderWorkspaceMenuEntry(entry: WorkspaceMenuEntry) {
    if (entry.type === 'command') return renderWorkspaceCommandItem(entry.commandId)

    const isOpen = openWorkspaceSubmenuId === entry.id

    return (
      <div
        key={entry.id}
        className="workspace-menu-submenu-wrapper"
        onMouseEnter={() => setOpenWorkspaceSubmenuId(entry.id)}
        onMouseLeave={() => setOpenWorkspaceSubmenuId(null)}
      >
        <button
          type="button"
          className={`workspace-menu-item workspace-menu-submenu-trigger${isOpen ? ' active' : ''}`}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onFocus={() => setOpenWorkspaceSubmenuId(entry.id)}
          onClick={() => setOpenWorkspaceSubmenuId((current) => (current === entry.id ? null : entry.id))}
        >
          <span className="workspace-menu-item-icon" aria-hidden>
            {getWorkspaceSubmenuIcon(entry.id)}
          </span>
          <span className="workspace-menu-item-label">{entry.title}</span>
          <ChevronRight className="workspace-menu-item-chevron" aria-hidden />
        </button>
        {isOpen ? (
          <div className="workspace-menu workspace-submenu" role="menu" aria-label={entry.title}>
            {entry.commandIds.map((commandId) => renderWorkspaceCommandItem(commandId))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <aside className="file-sidebar" style={style}>
      <div
        className="file-sidebar-header"
        onMouseDown={handleHeaderMouseDown}
        onDoubleClick={handleHeaderDoubleClick}
      >
        <div className="file-sidebar-header-title" />
        <div className="file-sidebar-header-actions">
          <div className="workspace-menu-anchor">
            <button
              ref={workspaceMenuButtonRef}
              className={`btn-sidebar-icon${isWorkspaceMenuOpen ? ' active' : ''}`}
              type="button"
              onClick={handleWorkspaceMenuButtonClick}
              title="工作区菜单"
              aria-label="工作区菜单"
              aria-haspopup="menu"
              aria-expanded={isWorkspaceMenuOpen}
            >
              <MoreHorizontal aria-hidden />
            </button>
          </div>
          <button
            className="btn-new btn-sidebar-icon"
            onClick={() => handleCreateFile(defaultCreateParent)}
            title="新建 Markdown 文件"
            aria-label="新建 Markdown 文件"
          >
            <Plus aria-hidden />
          </button>
        </div>
      </div>

      <div
        ref={bodyRef}
        className="file-tree-body"
        tabIndex={-1}
        onMouseDown={handleBodyMouseDown}
        onKeyDown={handleBodyKeyDown}
        onContextMenu={(event) => openContextMenu(event, null)}
      >
        {treeData.length === 0 ? (
          <div className="note-list-empty">暂无 Markdown 文件</div>
        ) : (
          <Tree<VaultTreeNode>
            ref={treeRef}
            data={treeData}
            idAccessor="id"
            childrenAccessor="children"
            width="100%"
            height={treeHeight}
            rowHeight={TREE_ROW_HEIGHT}
            indent={16}
            paddingTop={TREE_VERTICAL_PADDING}
            paddingBottom={TREE_VERTICAL_PADDING}
            selection={selectedPath}
            initialOpenState={initialOpenState}
            openByDefault={false}
            disableMultiSelection
            disableDrag
            disableDrop
            onActivate={(node: NodeApi<VaultTreeNode>) => {
              if (node.data.kind === 'file') void onOpenFile(node.data.path)
            }}
            onRename={handleRename}
            onToggle={() => onExpandedDirsChange(collectOpenDirs())}
          >
            {(props) => (
              <VaultNode
                {...props}
                activePath={activePath}
                onContextMenuOpen={openContextMenu}
                onSelectNode={(node) => setSelectedEntry(node)}
              />
            )}
          </Tree>
        )}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {(!menuTarget || menuTarget.kind === 'directory') && (
            <>
              <button
                onClick={() => {
                  setContextMenu(null)
                  void handleCreateFile(contextParentPath())
                }}
              >
                新建文件
              </button>
              <button
                onClick={() => {
                  setContextMenu(null)
                  void handleCreateFolder(contextParentPath())
                }}
              >
                新建文件夹
              </button>
              {menuTarget ? <div className="context-menu-separator" /> : null}
            </>
          )}
          {menuTarget && (
            <>
              <button
                onClick={() => {
                  treeRef.current?.edit(menuTarget.id)
                  setContextMenu(null)
                }}
              >
                重命名
              </button>
              <button
                className="danger"
                onClick={() => {
                  setContextMenu(null)
                  confirmAndDeleteEntry(menuTarget)
                }}
              >
                删除
              </button>
            </>
          )}
        </div>
      )}
      {isWorkspaceMenuOpen && workspaceMenuPosition
        ? createPortal(
            <div
              ref={workspaceMenuRef}
              className="workspace-menu"
              style={{ left: workspaceMenuPosition.left, top: workspaceMenuPosition.top }}
              role="menu"
              aria-label="工作区菜单"
            >
              {WORKSPACE_MENU_COMMAND_SECTIONS.map((section, sectionIndex) => (
                <div key={`section-${sectionIndex}`} className="workspace-menu-section">
                  {section.map((entry) => renderWorkspaceMenuEntry(entry))}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </aside>
  )
})
