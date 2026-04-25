import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Tree } from 'react-arborist'
import type { MoveHandler, NodeApi, NodeRendererProps, RenameHandler, TreeApi } from 'react-arborist'
import type { MouseEvent } from 'react'
import type { VaultEntryKind, VaultTreeNode } from '../../domain/note'
import { getParentPath, MARKDOWN_EXTENSION } from '../../services/pathUtils'

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
  onDeleteEntry: (path: string, kind: VaultEntryKind) => Promise<void>
  onExpandedDirsChange: (paths: string[]) => void
  style?: React.CSSProperties
}

interface VaultNodeProps extends NodeRendererProps<VaultTreeNode> {
  onContextMenuOpen: (event: MouseEvent, node: VaultTreeNode) => void
}

/** 查找文件树节点是否已经出现在最新数据中 */
function hasNode(nodes: VaultTreeNode[], id: string): boolean {
  return nodes.some((node) => node.id === id || hasNode(node.children ?? [], id))
}

/** 从未知异常中提取可展示消息 */
function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : '操作失败'
}

/** 文件树节点渲染，目录点击展开，文件点击打开 */
function VaultNode({
  node,
  style,
  dragHandle,
  onContextMenuOpen,
}: VaultNodeProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const submittedRef = useRef(false)
  const data = node.data
  const isDirectory = data.kind === 'directory'

  useEffect(() => {
    if (!node.isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [node.isEditing])

  function handleNodeClick(event: MouseEvent) {
    event.stopPropagation()
    if (isDirectory) {
      node.toggle()
      return
    }
    node.handleClick(event)
  }

  function submitRename() {
    if (submittedRef.current) return
    submittedRef.current = true
    node.submit(inputRef.current?.value ?? '')
  }

  return (
    <div
      ref={dragHandle}
      style={style}
      className={[
        'tree-node',
        node.isSelected ? 'active' : '',
        node.isDragging ? 'dragging' : '',
        node.willReceiveDrop ? 'drag-target' : '',
      ].join(' ')}
      onClick={handleNodeClick}
      onContextMenu={(event) => onContextMenuOpen(event, data)}
    >
      <button
        type="button"
        className={`tree-node-toggle ${isDirectory ? '' : 'hidden'}`}
        onClick={(event) => {
          event.stopPropagation()
          node.toggle()
        }}
        tabIndex={-1}
      >
        {node.isOpen ? '⌄' : '›'}
      </button>
      <span className={`tree-node-icon ${isDirectory ? 'directory' : 'file'}`} />
      {node.isEditing ? (
        <input
          ref={inputRef}
          className="tree-node-input"
          defaultValue={data.name}
          onBlur={submitRename}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              submittedRef.current = true
              node.reset()
            }
            if (event.key === 'Enter') submitRename()
          }}
        />
      ) : (
        <span className="tree-node-name">{data.name}</span>
      )}
    </div>
  )
}

/** 左侧 Markdown 文件树 */
export function FileTree({
  treeData,
  activePath,
  expandedDirs,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRenameEntry,
  onMoveEntry,
  onDeleteEntry,
  onExpandedDirsChange,
  style,
}: FileTreeProps) {
  const treeRef = useRef<TreeApi<VaultTreeNode> | undefined>(undefined)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [treeHeight, setTreeHeight] = useState(600)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [pendingEditId, setPendingEditId] = useState<string | null>(null)
  const dndRootElement = useMemo(
    () => (typeof document === 'undefined' ? null : document.body),
    []
  )

  const initialOpenState = useMemo(
    () => Object.fromEntries(expandedDirs.map((path) => [path, true])),
    []
  )

  useEffect(() => {
    function updateHeight() {
      setTreeHeight(bodyRef.current?.clientHeight ?? 600)
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  useEffect(() => {
    if (!contextMenu) return

    function closeMenu() {
      setContextMenu(null)
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', closeMenu)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!pendingEditId || !hasNode(treeData, pendingEditId)) return
    const editId = pendingEditId
    setPendingEditId(null)
    setTimeout(() => {
      treeRef.current?.scrollTo(editId)
      treeRef.current?.edit(editId)
    })
  }, [pendingEditId, treeData])

  function collectOpenDirs(): string[] {
    const openState = treeRef.current?.openState ?? {}
    return Object.entries(openState)
      .filter(([, isOpen]) => isOpen)
      .map(([path]) => path)
  }

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

  const handleMove: MoveHandler<VaultTreeNode> = async ({ dragNodes, parentNode }) => {
    const targetDir = parentNode && !parentNode.isRoot ? parentNode.data.path : null
    try {
      for (const dragNode of dragNodes) {
        if (getParentPath(dragNode.data.path) === targetDir) continue
        await onMoveEntry(dragNode.data.path, targetDir, dragNode.data.kind)
      }
    } catch (error) {
      window.alert(getErrorMessage(error))
    }
  }

  function openContextMenu(event: MouseEvent, target: VaultTreeNode | null) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, target })
  }

  function contextParentPath(): string | null {
    if (!contextMenu?.target) return null
    return contextMenu.target.kind === 'directory'
      ? contextMenu.target.path
      : getParentPath(contextMenu.target.path)
  }

  const defaultCreateParent = activePath ? getParentPath(activePath) : null
  const menuTarget = contextMenu?.target ?? null

  return (
    <aside className="file-sidebar" style={style}>
      <div className="file-sidebar-header">
        <span className="app-name">Mira</span>
        <button
          className="btn-new"
          onClick={() => handleCreateFile(defaultCreateParent)}
          title="新建 Markdown 文件"
        >
          +
        </button>
      </div>

      <div
        ref={bodyRef}
        className="file-tree-body"
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
            rowHeight={30}
            indent={16}
            selection={activePath ?? undefined}
            initialOpenState={initialOpenState}
            openByDefault={false}
            disableMultiSelection
            disableDrop={({ parentNode, dragNodes }) => {
              if (!parentNode.isRoot && parentNode.data.kind !== 'directory') return true
              return dragNodes.some((dragNode) => (
                dragNode.data.kind === 'directory'
                && !parentNode.isRoot
                && (
                  parentNode.data.path === dragNode.data.path
                  || parentNode.data.path.startsWith(`${dragNode.data.path}/`)
                )
              ))
            }}
            dndRootElement={dndRootElement}
            onActivate={(node: NodeApi<VaultTreeNode>) => {
              if (node.data.kind === 'file') void onOpenFile(node.data.path)
            }}
            onMove={handleMove}
            onRename={handleRename}
            onToggle={() => onExpandedDirsChange(collectOpenDirs())}
          >
            {(props) => <VaultNode {...props} onContextMenuOpen={openContextMenu} />}
          </Tree>
        )}
      </div>

      {contextMenu && (
        <div
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
              <div className="context-menu-separator" />
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
                  const label = menuTarget.kind === 'file'
                    ? `${menuTarget.name}${MARKDOWN_EXTENSION}`
                    : menuTarget.name
                  if (!window.confirm(`确认删除「${label}」？`)) return
                  setContextMenu(null)
                  onDeleteEntry(menuTarget.path, menuTarget.kind).catch((error) => {
                    window.alert(getErrorMessage(error))
                  })
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
}
