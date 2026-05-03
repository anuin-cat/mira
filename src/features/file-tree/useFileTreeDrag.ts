import { useCallback, useEffect, useRef } from 'react'
import type { MouseEvent, RefObject } from 'react'
import type { NodeApi, TreeApi } from 'react-arborist'
import type { VaultEntryKind, VaultTreeNode } from '../../domain/note'
import { getParentPath } from '../../services/pathUtils'

export const TREE_ROW_HEIGHT = 32
export const TREE_VERTICAL_PADDING = 6

const DRAG_THRESHOLD = 10
const AUTO_SCROLL_SPEED = 12
const AUTO_SCROLL_ZONE = 40
const AUTO_OPEN_DELAY = 700
const DIRECTORY_REORDER_ZONE_RATIO = 0.28
const PRIMARY_MOUSE_BUTTONS = 1
const TREE_DRAG_IGNORE_SELECTOR = 'button, input, textarea, select, a, [role="button"]'

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

interface UseFileTreeDragOptions {
  treeData: VaultTreeNode[]
  treeRef: RefObject<TreeApi<VaultTreeNode> | undefined>
  bodyRef: RefObject<HTMLDivElement | null>
  onMoveEntry: (path: string, targetDir: string | null, kind: VaultEntryKind) => Promise<void>
  onReorderEntry: (
    path: string,
    targetParentPath: string | null,
    beforePath: string | null,
    kind: VaultEntryKind
  ) => Promise<void>
  onExpandedDirsChange: (paths: string[]) => void
}

/** 从未知异常中提取可展示消息 */
function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : '操作失败'
}

/** 转义 data-path 选择器中的路径值 */
function escapeDataPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** 判断鼠标主键是否仍处于按下状态 */
function isPrimaryMouseButtonPressed(event: { buttons: number }): boolean {
  return event.buttons === PRIMARY_MOUSE_BUTTONS
}

/** 查找文件树节点是否属于 targetDir 的子树（防止自嵌套） */
function isDescendantOf(sourcePath: string, sourceKind: VaultEntryKind, targetDir: string): boolean {
  if (sourceKind !== 'directory') return false
  return sourcePath === targetDir || targetDir.startsWith(`${sourcePath}/`)
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

/** 文件树原生鼠标拖拽逻辑，避开 Tauri macOS 下 HTML5 DnD 不稳定问题 */
export function useFileTreeDrag({
  treeData,
  treeRef,
  bodyRef,
  onMoveEntry,
  onReorderEntry,
  onExpandedDirsChange,
}: UseFileTreeDragOptions) {
  const dragRef = useRef<DragState | null>(null)
  const detachDragListenersRef = useRef<() => void>(() => {})
  const onMoveEntryRef = useRef(onMoveEntry)
  onMoveEntryRef.current = onMoveEntry
  const onReorderEntryRef = useRef(onReorderEntry)
  onReorderEntryRef.current = onReorderEntry
  const onExpandedDirsChangeRef = useRef(onExpandedDirsChange)
  onExpandedDirsChangeRef.current = onExpandedDirsChange

  /** 收集当前已展开目录 */
  function collectOpenDirs(): string[] {
    const openState = treeRef.current?.openState ?? {}
    return Object.entries(openState)
      .filter(([, isOpen]) => isOpen)
      .map(([path]) => path)
  }

  /** 获取 react-arborist 实际滚动容器 */
  function getTreeScrollElement(): HTMLDivElement | null {
    return treeRef.current?.listEl.current ?? null
  }

  /** 移除当前拖拽注册的全局监听 */
  function detachDragListeners() {
    detachDragListenersRef.current()
    detachDragListenersRef.current = () => {}
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
    if (getParentPath(drag.sourcePath) === targetDir) return false
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

    drag.sourceEl.classList.remove('dragging')
    bodyRef.current?.classList.remove('is-dragging')
    clearDropIndicators()

    if (drag.previewEl.parentNode) {
      drag.previewEl.parentNode.removeChild(drag.previewEl)
    }
    if (drag.autoOpenTimer) clearTimeout(drag.autoOpenTimer)

    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    dragRef.current = null
  }

  /** 取消拖拽并释放所有临时状态 */
  function cancelDrag() {
    detachDragListeners()
    cleanupDrag()
  }

  // 组件卸载时兜底释放 document/window 监听，避免残留拖拽状态影响后续点击。
  useEffect(() => {
    return () => {
      cancelDrag()
    }
  }, [])

  /** document mousemove 处理 */
  const handleDragMove = useCallback((event: globalThis.MouseEvent) => {
    const drag = dragRef.current
    if (!drag) return

    if (!isPrimaryMouseButtonPressed(event)) {
      cancelDrag()
      return
    }

    // 1. 检查拖拽阈值
    if (!drag.hasMoved) {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      drag.hasMoved = true

      drag.sourceEl.classList.add('dragging')
      bodyRef.current?.classList.add('is-dragging')
      document.body.appendChild(drag.previewEl)
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    // 2. 更新预览位置
    drag.previewEl.style.left = `${event.clientX + 8}px`
    drag.previewEl.style.top = `${event.clientY - 15}px`

    // 3. 自动滚动
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

    // 4. 计算落点并处理自动展开
    const nextDropIntent = resolveDropIntent(drag, event.clientY)
    drag.dropIntent = nextDropIntent
    applyDropIndicator(nextDropIntent)

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

    detachDragListeners()

    if (!drag.hasMoved) {
      cleanupDrag()
      return
    }

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

  /** 外部中断时取消当前拖拽 */
  function handleDragCancel() {
    cancelDrag()
  }

  /** tree 容器 mousedown：检测拖拽意图 */
  function handleTreeMouseDown(event: MouseEvent) {
    if (event.button !== 0 || !isPrimaryMouseButtonPressed(event)) return

    cancelDrag()

    const nodeEl = (event.target as HTMLElement).closest('.tree-node') as HTMLElement | null
    if (!nodeEl) return
    if ((event.target as HTMLElement).closest(TREE_DRAG_IGNORE_SELECTOR)) return

    const path = nodeEl.dataset.path
    const kind = nodeEl.dataset.kind as VaultEntryKind | undefined
    if (!path || !kind) return

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
    document.addEventListener('contextmenu', handleDragCancel)
    window.addEventListener('blur', handleDragCancel)
    detachDragListenersRef.current = () => {
      document.removeEventListener('mousemove', handleDragMove)
      document.removeEventListener('mouseup', handleDragEnd)
      document.removeEventListener('contextmenu', handleDragCancel)
      window.removeEventListener('blur', handleDragCancel)
    }
  }

  return { handleTreeMouseDown }
}
