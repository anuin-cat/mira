import type { VaultEntryKind, VaultTreeNode, VaultTreeOrder } from '../domain/note'
import { getParentPath, isPathInsideDirectory, replacePathPrefix } from './pathUtils'

export const TREE_ORDER_ROOT = ''

/** 获取文件树排序状态中使用的父目录 key */
export function getTreeOrderParentKey(parentPath: string | null): string {
  return parentPath ?? TREE_ORDER_ROOT
}

/** 校验并清理从 .mira/state.json 读取到的文件树排序状态 */
export function normalizeTreeOrder(value: unknown): VaultTreeOrder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const result: VaultTreeOrder = {}
  for (const [parentPath, paths] of Object.entries(value)) {
    if (!Array.isArray(paths)) continue
    const normalizedPaths = paths.filter((path): path is string => typeof path === 'string')
    if (normalizedPaths.length > 0) result[parentPath] = Array.from(new Set(normalizedPaths))
  }
  return result
}

/** 复制排序状态，避免直接修改 React state 引用 */
function cloneTreeOrder(treeOrder: VaultTreeOrder): VaultTreeOrder {
  return Object.fromEntries(
    Object.entries(treeOrder).map(([parentPath, paths]) => [parentPath, [...paths]])
  )
}

/** 按路径在文件树中查找节点 */
function findNodeByPath(nodes: VaultTreeNode[], path: string): VaultTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    const childNode = findNodeByPath(node.children ?? [], path)
    if (childNode) return childNode
  }
  return null
}

/** 读取指定父目录下当前存在的直接子节点路径 */
function getDirectChildPaths(nodes: VaultTreeNode[], parentPath: string | null): string[] {
  if (!parentPath) return nodes.map((node) => node.path)
  return findNodeByPath(nodes, parentPath)?.children?.map((node) => node.path) ?? []
}

/** 写入某个父目录的完整同级顺序，空列表不保留冗余 key */
function setParentOrder(treeOrder: VaultTreeOrder, parentPath: string | null, orderedPaths: string[]): void {
  const parentKey = getTreeOrderParentKey(parentPath)
  if (orderedPaths.length === 0) {
    delete treeOrder[parentKey]
    return
  }
  treeOrder[parentKey] = orderedPaths
}

/** 把条目插入到 beforePath 之前；beforePath 为空时插入末尾 */
function insertIntoSiblingOrder(
  currentPaths: string[],
  sourcePath: string,
  insertedPath: string,
  beforePath: string | null
): string[] {
  const nextPaths = currentPaths.filter((path) => path !== sourcePath && path !== insertedPath)
  const insertIndex = beforePath ? nextPaths.indexOf(beforePath) : -1

  if (insertIndex >= 0) {
    nextPaths.splice(insertIndex, 0, insertedPath)
  } else {
    nextPaths.push(insertedPath)
  }

  return nextPaths
}

/** 根据拖拽插入位置更新文件树排序状态 */
export function updateTreeOrderForPlacement(
  treeOrder: VaultTreeOrder,
  nodes: VaultTreeNode[],
  sourcePath: string,
  insertedPath: string,
  targetParentPath: string | null,
  beforePath: string | null
): VaultTreeOrder {
  // 1. 复制当前状态，并在跨目录移动时清理来源目录顺序
  const nextOrder = cloneTreeOrder(treeOrder)
  const sourceParentPath = getParentPath(sourcePath)
  if (sourceParentPath !== targetParentPath) {
    const sourcePaths = getDirectChildPaths(nodes, sourceParentPath).filter((path) => path !== sourcePath)
    setParentOrder(nextOrder, sourceParentPath, sourcePaths)
  }

  // 2. 用当前树中的同级节点生成目标目录的完整顺序
  const targetPaths = getDirectChildPaths(nodes, targetParentPath)
  const orderedPaths = insertIntoSiblingOrder(targetPaths, sourcePath, insertedPath, beforePath)
  setParentOrder(nextOrder, targetParentPath, orderedPaths)
  return nextOrder
}

/** 根据移动到目录末尾的操作更新文件树排序状态 */
export function updateTreeOrderForMove(
  treeOrder: VaultTreeOrder,
  nodes: VaultTreeNode[],
  sourcePath: string,
  movedPath: string,
  targetParentPath: string | null
): VaultTreeOrder {
  return updateTreeOrderForPlacement(treeOrder, nodes, sourcePath, movedPath, targetParentPath, null)
}

/** 重命名后同步排序状态中保存的路径 */
export function updateTreeOrderAfterRename(
  treeOrder: VaultTreeOrder,
  oldPath: string,
  newPath: string,
  kind: VaultEntryKind
): VaultTreeOrder {
  const renamedOrder: VaultTreeOrder = {}

  // 1. 文件只替换自身路径；文件夹需要替换自身和所有后代路径
  function renamePath(path: string): string {
    if (kind === 'file') return path === oldPath ? newPath : path
    return isPathInsideDirectory(path, oldPath) ? replacePathPrefix(path, oldPath, newPath) : path
  }

  // 2. 逐个 key 和同级路径列表做兼容迁移
  for (const [parentPath, paths] of Object.entries(treeOrder)) {
    const nextParentPath = parentPath === TREE_ORDER_ROOT ? TREE_ORDER_ROOT : renamePath(parentPath)
    const existingPaths = renamedOrder[nextParentPath] ?? []
    const nextPaths = paths.map(renamePath)
    renamedOrder[nextParentPath] = Array.from(new Set([...existingPaths, ...nextPaths]))
  }

  return renamedOrder
}

/** 删除条目后移除排序状态里对应的路径与子树 key */
export function updateTreeOrderAfterDelete(
  treeOrder: VaultTreeOrder,
  deletedPath: string,
  kind: VaultEntryKind
): VaultTreeOrder {
  const nextOrder: VaultTreeOrder = {}

  // 1. 判断某条排序路径是否随删除失效
  function isDeletedPath(path: string): boolean {
    return kind === 'directory' ? isPathInsideDirectory(path, deletedPath) : path === deletedPath
  }

  // 2. 清理被删除目录下的 key，并过滤所有同级列表
  for (const [parentPath, paths] of Object.entries(treeOrder)) {
    if (parentPath !== TREE_ORDER_ROOT && kind === 'directory' && isPathInsideDirectory(parentPath, deletedPath)) {
      continue
    }

    const nextPaths = paths.filter((path) => !isDeletedPath(path))
    if (nextPaths.length > 0) nextOrder[parentPath] = nextPaths
  }

  return nextOrder
}
