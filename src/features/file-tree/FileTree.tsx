import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tree } from 'react-arborist'
import type { NodeApi, NodeRendererProps, RenameHandler, TreeApi } from 'react-arborist'
import type { MouseEvent } from 'react'
import type { VaultEntryKind, VaultTreeNode } from '../../domain/note'
import { getParentPath, MARKDOWN_EXTENSION } from '../../services/pathUtils'

const DRAG_THRESHOLD = 5
const AUTO_SCROLL_SPEED = 12
const AUTO_SCROLL_ZONE = 40
const AUTO_OPEN_DELAY = 700
const TREE_ROW_HEIGHT = 32
const TREE_VERTICAL_PADDING = 6

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

interface DragState {
  sourcePath: string
  sourceKind: VaultEntryKind
  sourceEl: HTMLElement
  startX: number
  startY: number
  hasMoved: boolean
  previewEl: HTMLDivElement
  autoOpenTimer: ReturnType<typeof setTimeout> | null
  autoOpenTarget: string | null
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

/** 判断拖拽节点是否属于 targetDir 的子树（防止自嵌套） */
function isDescendantOf(sourcePath: string, sourceKind: VaultEntryKind, targetDir: string): boolean {
  if (sourceKind !== 'directory') return false
  return sourcePath === targetDir || targetDir.startsWith(`${sourcePath}/`)
}

/** 创建拖拽预览元素 */
function createPreviewElement(name: string, kind: VaultEntryKind): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'tree-node drag-preview'
  el.innerHTML = `<span class="tree-node-icon ${kind}"></span><span class="tree-node-name">${name}</span>`
  el.style.cssText = [
    'position: fixed',
    'z-index: 9999',
    'pointer-events: none',
    'display: flex',
    'align-items: center',
    'height: 32px',
    'padding: 0 8px 0 4px',
    'background: rgba(255,255,255,0.92)',
    'border: 1px solid #d0d0cc',
    'border-radius: 6px',
    'box-shadow: 0 4px 16px rgba(0,0,0,0.12)',
    'font-size: 14px',
    'color: #2b2b2b',
    'width: max-content',
    'min-width: 120px',
  ].join(';')
  return el
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
      className={['tree-node', node.isSelected ? 'active' : ''].join(' ')}
      data-path={data.path}
      data-kind={data.kind}
      onClick={handleNodeClick}
      onContextMenu={(event) => onContextMenuOpen(event, data)}
    >
      <button
        type="button"
        className={`tree-node-toggle ${isDirectory ? '' : 'hidden'} ${node.isOpen ? 'open' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
          node.toggle()
        }}
        tabIndex={-1}
      />
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
  const dragRef = useRef<DragState | null>(null)
  const onMoveEntryRef = useRef(onMoveEntry)
  onMoveEntryRef.current = onMoveEntry
  const onExpandedDirsChangeRef = useRef(onExpandedDirsChange)
  onExpandedDirsChangeRef.current = onExpandedDirsChange

  const initialOpenState = useMemo(
    () => Object.fromEntries(expandedDirs.map((path) => [path, true])),
    []
  )

  // 1. 自适应高度
  useEffect(() => {
    function updateHeight() {
      setTreeHeight(bodyRef.current?.clientHeight ?? 600)
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  // 2. 右键菜单自动关闭
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

  // 4. 收集当前已展开目录
  function collectOpenDirs(): string[] {
    const openState = treeRef.current?.openState ?? {}
    return Object.entries(openState)
      .filter(([, isOpen]) => isOpen)
      .map(([path]) => path)
  }

  // ========== 自定义拖拽实现（替换 react-arborist 内置 react-dnd DnD） ==========
  // 原因：Tauri macOS 默认拖放处理会影响 HTML5 DnD，react-dnd-html5-backend 不稳定

  /** 获取 react-arborist 实际滚动容器 */
  function getTreeScrollElement(): HTMLDivElement | null {
    return treeRef.current?.listEl.current ?? null
  }

  /** 根据鼠标 Y 坐标计算当前悬停的目标节点 */
  function getTargetNode(clientY: number): NodeApi<VaultTreeNode> | null {
    const container = getTreeScrollElement()
    const tree = treeRef.current
    if (!container || !tree) return null

    const rect = container.getBoundingClientRect()
    const index = Math.floor(
      (clientY - rect.top + container.scrollTop - TREE_VERTICAL_PADDING) / TREE_ROW_HEIGHT
    )
    if (index < 0) return null
    return tree.at(index) ?? null
  }

  /** 根据目标节点计算目标目录路径 */
  function resolveTargetDir(targetNode: NodeApi<VaultTreeNode> | null): string | null {
    if (!targetNode) return null
    return targetNode.data.kind === 'directory' ? targetNode.data.path : getParentPath(targetNode.data.path)
  }

  /** 验证拖拽落点是否合法 */
  function isValidDrop(drag: DragState, targetDir: string | null): boolean {
    // 已在目标目录中
    if (getParentPath(drag.sourcePath) === targetDir) return false
    // 防止目录自嵌套
    if (targetDir && isDescendantOf(drag.sourcePath, drag.sourceKind, targetDir)) return false
    return true
  }

  /** 清理拖拽状态 */
  function cleanupDrag() {
    const drag = dragRef.current
    if (!drag) return

    // 移除 source 拖拽样式
    drag.sourceEl.classList.remove('dragging')

    // 移除所有 drop target 高亮
    document.querySelectorAll('.tree-node.drag-target').forEach((el) => {
      el.classList.remove('drag-target')
    })

    // 移除预览元素
    if (drag.previewEl.parentNode) {
      drag.previewEl.parentNode.removeChild(drag.previewEl)
    }

    // 清除自动展开定时器
    if (drag.autoOpenTimer) {
      clearTimeout(drag.autoOpenTimer)
    }

    // 恢复 body 样式
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    dragRef.current = null
  }

  /** document mousemove 处理 */
  const handleDragMove = useCallback((event: globalThis.MouseEvent) => {
    const drag = dragRef.current
    if (!drag) return

    // 4.1 检查拖拽阈值
    if (!drag.hasMoved) {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      drag.hasMoved = true

      // 首次超过阈值：展示预览，锁定 UI
      drag.sourceEl.classList.add('dragging')
      document.body.appendChild(drag.previewEl)
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    // 4.2 更新预览位置
    drag.previewEl.style.left = `${event.clientX + 8}px`
    drag.previewEl.style.top = `${event.clientY - 15}px`

    // 4.3 自动滚动
    const container = getTreeScrollElement()
    if (container) {
      const rect = container.getBoundingClientRect()
      const relativeY = event.clientY - rect.top
      if (relativeY < AUTO_SCROLL_ZONE) {
        container.scrollTop -= AUTO_SCROLL_SPEED
      } else if (relativeY > rect.height - AUTO_SCROLL_ZONE) {
        container.scrollTop += AUTO_SCROLL_SPEED
      }
    }

    // 4.4 计算并更新落点高亮
    const targetNode = getTargetNode(event.clientY)
    const targetDir = resolveTargetDir(targetNode)

    // 移除旧高亮
    document.querySelectorAll('.tree-node.drag-target').forEach((el) => {
      el.classList.remove('drag-target')
    })

    // 添加新高亮
    if (targetNode && targetNode.data.kind === 'directory' && isValidDrop(drag, targetDir)) {
      const container = getTreeScrollElement()
      const escapedPath = targetNode.data.path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const el = container?.querySelector(`.tree-node[data-path="${escapedPath}"]`) as HTMLElement | null
      if (el) el.classList.add('drag-target')
    }

    // 4.5 自动展开目录
    const newAutoTarget = targetNode?.data.kind === 'directory' ? targetNode.data.path : null
    if (newAutoTarget !== drag.autoOpenTarget) {
      if (drag.autoOpenTimer) {
        clearTimeout(drag.autoOpenTimer)
        drag.autoOpenTimer = null
      }
      drag.autoOpenTarget = newAutoTarget

      if (newAutoTarget && !treeRef.current?.isOpen(newAutoTarget)) {
        drag.autoOpenTimer = setTimeout(() => {
          treeRef.current?.open(newAutoTarget)
          onExpandedDirsChangeRef.current(collectOpenDirs())
        }, AUTO_OPEN_DELAY)
      }
    }
  }, [])

  /** document mouseup 处理：执行移动 */
  const handleDragEnd = useCallback((event: globalThis.MouseEvent) => {
    const drag = dragRef.current
    if (!drag) return

    // 移除 document 监听
    document.removeEventListener('mousemove', handleDragMove)
    document.removeEventListener('mouseup', handleDragEnd)

    if (!drag.hasMoved) {
      cleanupDrag()
      return
    }

    // 计算最终落点
    const targetNode = getTargetNode(event.clientY)
    const targetDir = resolveTargetDir(targetNode)

    // 执行移动
    if (isValidDrop(drag, targetDir)) {
      onMoveEntryRef.current(drag.sourcePath, targetDir, drag.sourceKind).catch((error) => {
        window.alert(getErrorMessage(error))
      })
    }

    cleanupDrag()
  }, [handleDragMove])

  /** tree 容器 mousedown：检测拖拽意图 */
  function handleTreeMouseDown(event: React.MouseEvent) {
    // 仅处理左键
    if (event.button !== 0) return

    // 清理可能残留的拖拽状态（上一次 mouseup 未在 document 内触发时）
    if (dragRef.current) {
      cleanupDrag()
      document.removeEventListener('mousemove', handleDragMove)
      document.removeEventListener('mouseup', handleDragEnd)
    }

    // 找到被点击的 tree-node 元素
    const nodeEl = (event.target as HTMLElement).closest('.tree-node') as HTMLElement | null
    if (!nodeEl) return

    // 编辑输入框内不触发拖拽
    if ((event.target as HTMLElement).tagName === 'INPUT') return

    const path = nodeEl.dataset.path
    const kind = nodeEl.dataset.kind as VaultEntryKind | undefined
    if (!path || !kind) return

    // 初始化拖拽状态
    const nameEl = nodeEl.querySelector('.tree-node-name') as HTMLElement | null
    const displayName = nameEl?.textContent ?? path.split('/').pop() ?? path

    dragRef.current = {
      sourcePath: path,
      sourceKind: kind,
      sourceEl: nodeEl,
      startX: event.clientX,
      startY: event.clientY,
      hasMoved: false,
      previewEl: createPreviewElement(displayName, kind),
      autoOpenTimer: null,
      autoOpenTarget: null,
    }

    document.addEventListener('mousemove', handleDragMove)
    document.addEventListener('mouseup', handleDragEnd)
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
      <div className="file-sidebar-header" data-tauri-drag-region>
        <div className="file-sidebar-header-title" />
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
        onMouseDown={handleTreeMouseDown}
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
            selection={activePath ?? undefined}
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
