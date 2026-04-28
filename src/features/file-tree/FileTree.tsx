import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Tree } from 'react-arborist'
import type { NodeApi, NodeRendererProps, RenameHandler, TreeApi } from 'react-arborist'
import type { MouseEvent } from 'react'
import { GitFork, Plus } from 'lucide-react'
import type { VaultEntryKind, VaultTreeNode } from '../../domain/note'
import { isImeComposing } from '../../lib/keyboard'
import { getParentPath, MARKDOWN_EXTENSION } from '../../services/pathUtils'
import { startWindowDrag, toggleWindowMaximize } from '../../tauri/window'

const DRAG_THRESHOLD = 10
const AUTO_SCROLL_SPEED = 12
const AUTO_SCROLL_ZONE = 40
const AUTO_OPEN_DELAY = 700
const TREE_ROW_HEIGHT = 32
const TREE_VERTICAL_PADDING = 6
const DIRECTORY_REORDER_ZONE_RATIO = 0.28
const WINDOW_DRAG_IGNORE_SELECTOR = 'button, input, textarea, select, a, [role="button"]'
const TREE_DRAG_IGNORE_SELECTOR = 'button, input, textarea, select, a, [role="button"]'

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
  onOpenGitPanel: () => void
  gitChangeCount?: number
  style?: React.CSSProperties
}

export interface FileTreeHandle {
  createFile: () => void
  createFolder: () => void
  renameActive: () => void
  deleteActive: () => void
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
  dropIntent: DropIntent | null
}

interface TargetInfo {
  node: NodeApi<VaultTreeNode>
  offsetY: number
}

type DropIntent =
  | {
      type: 'move-into'
      targetDir: string | null
      highlightPath: string | null
    }
  | {
      type: 'reorder'
      targetParentPath: string | null
      beforePath: string | null
      highlightPath: string
      position: 'before' | 'after'
    }

interface VaultNodeProps extends NodeRendererProps<VaultTreeNode> {
  onContextMenuOpen: (event: MouseEvent, node: VaultTreeNode) => void
  onSelectNode: (node: VaultTreeNode) => void
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

/** 查找指定父目录下的直接子节点 */
function findDirectChildren(nodes: VaultTreeNode[], parentPath: string | null): VaultTreeNode[] {
  if (!parentPath) return nodes
  return findNodeByPath(nodes, parentPath)?.children ?? []
}

/** 查找同级下一个节点路径，用于表达“插入到某节点之后” */
function findNextSiblingPath(nodes: VaultTreeNode[], path: string): string | null {
  const siblings = findDirectChildren(nodes, getParentPath(path))
  const index = siblings.findIndex((node) => node.path === path)
  return index >= 0 ? siblings[index + 1]?.path ?? null : null
}

/** 转义 data-path 选择器中的路径值 */
function escapeDataPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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
  onSelectNode,
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
    onSelectNode(data)
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
            if (event.key === 'Enter' && !isImeComposing(event)) submitRename()
          }}
        />
      ) : (
        <span className="tree-node-name">{data.name}</span>
      )}
    </div>
  )
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
    onOpenGitPanel,
    gitChangeCount = 0,
    style,
  },
  ref
) {
  const treeRef = useRef<TreeApi<VaultTreeNode> | undefined>(undefined)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const [treeHeight, setTreeHeight] = useState(600)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [pendingEditId, setPendingEditId] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<VaultTreeNode | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const onMoveEntryRef = useRef(onMoveEntry)
  onMoveEntryRef.current = onMoveEntry
  const onReorderEntryRef = useRef(onReorderEntry)
  onReorderEntryRef.current = onReorderEntry
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

    function isMenuInnerTarget(target: EventTarget | null): boolean {
      return target instanceof Node && contextMenuRef.current?.contains(target) === true
    }

    function handleDocumentMouseDown(event: globalThis.MouseEvent) {
      if (event.button !== 0) return
      if (isMenuInnerTarget(event.target)) return
      setContextMenu(null)
    }

    function handleWindowKeyDown() {
      setContextMenu(null)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    window.addEventListener('keydown', handleWindowKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true)
      window.removeEventListener('keydown', handleWindowKeyDown)
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

  // ========== 自定义拖拽实现（替换 react-arborist 内置 react-dnd DnD） ==========
  // 原因：Tauri macOS 默认拖放处理会影响 HTML5 DnD，react-dnd-html5-backend 不稳定

  /** 获取 react-arborist 实际滚动容器 */
  function getTreeScrollElement(): HTMLDivElement | null {
    return treeRef.current?.listEl.current ?? null
  }

  /** 根据鼠标 Y 坐标计算当前悬停的目标节点与行内位置 */
  function getTargetInfo(clientY: number): TargetInfo | null {
    const container = getTreeScrollElement()
    const tree = treeRef.current
    if (!container || !tree) return null

    const rect = container.getBoundingClientRect()
    const relativeY = clientY - rect.top + container.scrollTop - TREE_VERTICAL_PADDING
    const index = Math.floor(relativeY / TREE_ROW_HEIGHT)
    if (index < 0) return null
    const node = tree.at(index)
    return node ? { node, offsetY: relativeY - index * TREE_ROW_HEIGHT } : null
  }

  /** 获取某个可见节点对应的 DOM 元素 */
  function getTreeNodeElement(path: string): HTMLElement | null {
    const container = getTreeScrollElement()
    return container?.querySelector(`.tree-node[data-path="${escapeDataPath(path)}"]`) as HTMLElement | null
  }

  /** 验证拖拽放入目录是否合法 */
  function isValidMoveInto(drag: DragState, targetDir: string | null): boolean {
    // 已在目标目录中
    if (getParentPath(drag.sourcePath) === targetDir) return false
    // 防止目录自嵌套
    if (targetDir && isDescendantOf(drag.sourcePath, drag.sourceKind, targetDir)) return false
    return true
  }

  /** 验证拖拽插入排序是否合法 */
  function isValidReorder(
    drag: DragState,
    targetParentPath: string | null,
    beforePath: string | null
  ): boolean {
    // 1. 防止目录插入到自身内部
    if (targetParentPath && isDescendantOf(drag.sourcePath, drag.sourceKind, targetParentPath)) return false

    // 2. 同目录下拖到自身原本位置时不触发持久化
    const sourceParentPath = getParentPath(drag.sourcePath)
    if (sourceParentPath !== targetParentPath) return true
    const currentNextPath = findNextSiblingPath(treeData, drag.sourcePath)
    return beforePath !== drag.sourcePath && beforePath !== currentNextPath
  }

  /** 根据当前悬停节点解析最终拖拽意图 */
  function resolveDropIntent(drag: DragState, clientY: number): DropIntent | null {
    const targetInfo = getTargetInfo(clientY)
    if (!targetInfo) {
      return isValidMoveInto(drag, null)
        ? { type: 'move-into', targetDir: null, highlightPath: null }
        : null
    }

    const { node, offsetY } = targetInfo
    const target = node.data
    if (target.path === drag.sourcePath) return null

    if (target.kind === 'directory') {
      const topReorderZone = TREE_ROW_HEIGHT * DIRECTORY_REORDER_ZONE_RATIO
      const bottomReorderZone = TREE_ROW_HEIGHT * (1 - DIRECTORY_REORDER_ZONE_RATIO)
      if (offsetY >= topReorderZone && offsetY <= bottomReorderZone) {
        return isValidMoveInto(drag, target.path)
          ? { type: 'move-into', targetDir: target.path, highlightPath: target.path }
          : null
      }
    }

    const targetParentPath = getParentPath(target.path)
    const isBefore = offsetY < TREE_ROW_HEIGHT / 2
    const beforePath = isBefore ? target.path : findNextSiblingPath(treeData, target.path)

    if (!isValidReorder(drag, targetParentPath, beforePath)) return null
    return {
      type: 'reorder',
      targetParentPath,
      beforePath,
      highlightPath: target.path,
      position: isBefore ? 'before' : 'after',
    }
  }

  /** 清理所有落点视觉提示 */
  function clearDropIndicators() {
    document.querySelectorAll('.tree-node.drag-target, .tree-node.drop-before, .tree-node.drop-after')
      .forEach((el) => {
        el.classList.remove('drag-target', 'drop-before', 'drop-after')
      })
  }

  /** 展示当前落点视觉提示 */
  function applyDropIndicator(intent: DropIntent | null) {
    clearDropIndicators()
    if (!intent?.highlightPath) return

    const el = getTreeNodeElement(intent.highlightPath)
    if (!el) return
    if (intent.type === 'move-into') {
      el.classList.add('drag-target')
      return
    }
    el.classList.add(intent.position === 'before' ? 'drop-before' : 'drop-after')
  }

  /** 清理拖拽状态 */
  function cleanupDrag() {
    const drag = dragRef.current
    if (!drag) return

    // 移除 source 拖拽样式
    drag.sourceEl.classList.remove('dragging')
    bodyRef.current?.classList.remove('is-dragging')

    // 移除所有落点高亮
    clearDropIndicators()

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
      bodyRef.current?.classList.add('is-dragging')
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
    const nextDropIntent = resolveDropIntent(drag, event.clientY)
    drag.dropIntent = nextDropIntent
    applyDropIndicator(nextDropIntent)

    // 4.5 只在“放入文件夹”意图下自动展开目录
    const newAutoTarget = nextDropIntent?.type === 'move-into' ? nextDropIntent.highlightPath : null
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
  }, [treeData])

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

    // 计算最终落点并执行对应操作
    const dropIntent = drag.dropIntent ?? resolveDropIntent(drag, event.clientY)
    if (dropIntent?.type === 'move-into') {
      onMoveEntryRef.current(drag.sourcePath, dropIntent.targetDir, drag.sourceKind).catch((error) => {
        window.alert(getErrorMessage(error))
      })
    }
    if (dropIntent?.type === 'reorder') {
      onReorderEntryRef.current(
        drag.sourcePath,
        dropIntent.targetParentPath,
        dropIntent.beforePath,
        drag.sourceKind
      ).catch((error) => {
        window.alert(getErrorMessage(error))
      })
    }

    cleanupDrag()
  }, [handleDragMove, treeData])

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

    // 编辑输入框、展开按钮等交互控件内不触发拖拽
    if ((event.target as HTMLElement).closest(TREE_DRAG_IGNORE_SELECTOR)) return

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
      dropIntent: null,
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
    setSelectedEntry(target)
    setContextMenu({ x: event.clientX, y: event.clientY, target })
  }

  /** 顶部空白区域按下鼠标时触发原生窗口拖动 */
  function handleHeaderMouseDown(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0 || event.detail > 1) return
    if (isWindowDragIgnoredTarget(event.target)) return

    event.preventDefault()
    void startWindowDrag().catch((error) => {
      console.warn('窗口拖动启动失败', error)
    })
  }

  /** 顶部空白区域双击时切换窗口最大化 */
  function handleHeaderDoubleClick(event: React.MouseEvent<HTMLElement>) {
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
  const selectedPath = selectedEntry?.path ?? activePath ?? undefined

  return (
    <aside className="file-sidebar" style={style}>
      <div
        className="file-sidebar-header"
        onMouseDown={handleHeaderMouseDown}
        onDoubleClick={handleHeaderDoubleClick}
      >
        <div className="file-sidebar-header-title" />
        <div className="file-sidebar-header-actions">
          <button
            className="btn-sidebar-icon"
            onClick={onOpenGitPanel}
            title="Git 操作"
            aria-label="打开 Git 面板"
          >
            <GitFork aria-hidden />
            {gitChangeCount > 0 ? <span className="git-sidebar-badge">{gitChangeCount}</span> : null}
          </button>
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
