import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { Tree } from 'react-arborist'
import type { NodeApi, RenameHandler, TreeApi } from 'react-arborist'
import {
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
} from '../commands/commandRegistry'
import { TREE_ROW_HEIGHT, TREE_VERTICAL_PADDING, useFileTreeDrag } from './useFileTreeDrag'
import { VaultNode } from './VaultNode'

const WINDOW_DRAG_IGNORE_SELECTOR = 'button, input, textarea, select, a, [role="button"]'

interface ContextMenuState {
  x: number
  y: number
  target: VaultTreeNode | null
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
      setContextMenu(null)
      setIsWorkspaceMenuOpen(false)
    }

    function handleWindowKeyDown() {
      setContextMenu(null)
      setIsWorkspaceMenuOpen(false)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    window.addEventListener('keydown', handleWindowKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true)
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
    setContextMenu(null)
    onRunCommand(commandId)
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
              onClick={() => {
                setContextMenu(null)
                setIsWorkspaceMenuOpen((value) => !value)
              }}
              title="工作区菜单"
              aria-label="工作区菜单"
              aria-haspopup="menu"
              aria-expanded={isWorkspaceMenuOpen}
            >
              <MoreHorizontal aria-hidden />
            </button>
            {isWorkspaceMenuOpen ? (
              <div ref={workspaceMenuRef} className="workspace-menu" role="menu" aria-label="工作区菜单">
                {WORKSPACE_MENU_COMMAND_SECTIONS.map((section, sectionIndex) => (
                  <div key={`section-${sectionIndex}`} className="workspace-menu-section">
                    {section.map((commandId) => {
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
                    })}
                  </div>
                ))}
              </div>
            ) : null}
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
    </aside>
  )
})
