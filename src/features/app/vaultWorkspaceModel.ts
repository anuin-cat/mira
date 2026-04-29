import type { VaultEntryKind, VaultState, VaultTreeNode } from '../../domain/note'
import {
  createFolder,
  createMarkdownFile,
  deleteEntry,
  moveEntry,
  renameEntry,
  resolvePathAfterEntryRename,
} from '../../services/noteService'
import { getParentPath, isPathInsideDirectory } from '../../services/pathUtils'
import {
  updateTreeOrderAfterDelete,
  updateTreeOrderAfterRename,
  updateTreeOrderForMove,
  updateTreeOrderForPlacement,
} from '../../services/treeOrderService'

export const DEFAULT_VAULT_STATE: VaultState = {
  version: 1,
  lastOpenedPath: null,
  expandedDirs: [],
  treeOrder: {},
  fontSize: 'medium',
  theme: 'default',
}

export interface NavigationHistory {
  paths: string[]
  index: number
}

export interface PendingEditorSelection {
  path: string
  query: string
  matchOrdinal: number
}

/** 从未知异常中提取可展示消息 */
export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : '操作失败'
}

/** 递归判断文件是否存在于树中 */
function hasFile(nodes: VaultTreeNode[], path: string | null): boolean {
  if (!path) return false
  return nodes.some((node) => {
    if (node.kind === 'file') return node.path === path
    return hasFile(node.children ?? [], path)
  })
}

/** 取文件树中的第一个 Markdown 文件 */
function findFirstFile(nodes: VaultTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === 'file') return node.path
    const firstChildFile = findFirstFile(node.children ?? [])
    if (firstChildFile) return firstChildFile
  }
  return null
}

/** 优先打开上次文件，否则回退到第一个 Markdown 文件 */
export function chooseOpenPath(nodes: VaultTreeNode[], preferredPath: string | null): string | null {
  if (hasFile(nodes, preferredPath)) return preferredPath
  return findFirstFile(nodes)
}

/** 获取目录及其所有祖先目录 */
export function collectAncestorDirs(path: string | null): string[] {
  if (!path) return []
  const segments = path.split('/').filter(Boolean)
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
}

/** 根据 patch 生成下一版可持久化 vault 状态 */
export function createNextVaultState(currentState: VaultState, patch: Partial<VaultState>): VaultState {
  return {
    ...currentState,
    ...patch,
    version: 1,
  }
}

/** 判断文件或目录操作是否影响当前打开文件 */
export function doesEntryAffectActiveFile(
  currentActivePath: string | null,
  entryPath: string,
  kind: VaultEntryKind,
  isPathInsideDirectory: (path: string, dirPath: string) => boolean
) {
  if (!currentActivePath) return false
  return kind === 'file'
    ? currentActivePath === entryPath
    : isPathInsideDirectory(currentActivePath, entryPath)
}

/** 记录文件访问历史，用于菜单后退/前进 */
export function createNavigationHistoryEntry(history: NavigationHistory, filePath: string): NavigationHistory {
  if (history.paths[history.index] === filePath) return history

  const nextPaths = history.paths.slice(0, history.index + 1)
  nextPaths.push(filePath)
  if (nextPaths.length > 80) nextPaths.shift()

  return {
    paths: nextPaths,
    index: nextPaths.length - 1,
  }
}

interface VaultWorkspaceFileActionContext {
  getActivePath: () => string | null
  getTreeData: () => VaultTreeNode[]
  getVaultPath: () => string | null
  getVaultState: () => VaultState
  clearPendingSave: () => void
  flushActiveSave: () => Promise<void>
  openFileFromDisk: (vaultPath: string, filePath: string) => Promise<boolean>
  persistVaultState: (patch: Partial<VaultState>) => void
  reloadTree: (preferredActivePath?: string | null) => Promise<VaultTreeNode[]>
  syncActivePathAfterEntryPathChange: (nextActivePath: string | null, previousActivePath: string | null) => void
}

/** 创建文件树实体操作，集中处理路径变更、treeOrder 与打开文件同步 */
export function createVaultWorkspaceFileActions(context: VaultWorkspaceFileActionContext) {
  /** 新建 Markdown 文件并打开 */
  async function handleCreateFile(parentPath: string | null): Promise<string | null> {
    const path = context.getVaultPath()
    if (!path) return null

    const createdPath = await createMarkdownFile(path, parentPath)
    const parentDir = getParentPath(createdPath)
    if (parentDir) {
      context.persistVaultState({
        expandedDirs: Array.from(new Set([...context.getVaultState().expandedDirs, ...collectAncestorDirs(parentDir)])),
      })
    }

    await context.reloadTree(createdPath)
    await context.openFileFromDisk(path, createdPath)
    return createdPath
  }

  /** 新建文件夹 */
  async function handleCreateFolder(parentPath: string | null): Promise<string | null> {
    const path = context.getVaultPath()
    if (!path) return null

    const createdPath = await createFolder(path, parentPath)
    const parentDir = getParentPath(createdPath)
    context.persistVaultState({
      expandedDirs: Array.from(new Set([...context.getVaultState().expandedDirs, ...collectAncestorDirs(parentDir)])),
    })
    await context.reloadTree()
    return createdPath
  }

  /** 重命名文件或文件夹，并同步当前打开文件路径 */
  async function handleRenameEntry(
    filePath: string,
    name: string,
    kind: VaultEntryKind
  ): Promise<string | null> {
    const path = context.getVaultPath()
    const currentActivePath = context.getActivePath()
    if (!path) return null

    if (doesEntryAffectActiveFile(currentActivePath, filePath, kind, isPathInsideDirectory)) {
      await context.flushActiveSave()
    }

    const renamedPath = await renameEntry(path, filePath, name, kind)
    const nextActivePath = currentActivePath
      ? resolvePathAfterEntryRename(currentActivePath, filePath, renamedPath, kind)
      : null
    const nextTreeOrder = updateTreeOrderAfterRename(
      context.getVaultState().treeOrder,
      filePath,
      renamedPath,
      kind
    )

    context.persistVaultState({ treeOrder: nextTreeOrder })
    await context.reloadTree(nextActivePath)
    context.syncActivePathAfterEntryPathChange(nextActivePath, currentActivePath)
    return renamedPath
  }

  /** 拖拽移动文件或文件夹，并同步当前打开文件路径 */
  async function handleMoveEntry(filePath: string, targetDir: string | null, kind: VaultEntryKind) {
    const path = context.getVaultPath()
    const currentActivePath = context.getActivePath()
    if (!path) return

    if (doesEntryAffectActiveFile(currentActivePath, filePath, kind, isPathInsideDirectory)) {
      await context.flushActiveSave()
    }

    const movedPath = await moveEntry(path, filePath, targetDir, kind)
    const nextActivePath = currentActivePath
      ? resolvePathAfterEntryRename(currentActivePath, filePath, movedPath, kind)
      : null
    const placedTreeOrder = updateTreeOrderForMove(
      context.getVaultState().treeOrder,
      context.getTreeData(),
      filePath,
      movedPath,
      targetDir
    )
    const nextTreeOrder = updateTreeOrderAfterRename(placedTreeOrder, filePath, movedPath, kind)

    context.persistVaultState({ treeOrder: nextTreeOrder })
    await context.reloadTree(nextActivePath)
    context.syncActivePathAfterEntryPathChange(nextActivePath, currentActivePath)
  }

  /** 拖拽调整同级顺序，必要时先把条目移动到目标父目录 */
  async function handleReorderEntry(
    filePath: string,
    targetParentPath: string | null,
    beforePath: string | null,
    kind: VaultEntryKind
  ) {
    const path = context.getVaultPath()
    const currentActivePath = context.getActivePath()
    if (!path) return

    if (doesEntryAffectActiveFile(currentActivePath, filePath, kind, isPathInsideDirectory)) {
      await context.flushActiveSave()
    }

    const sourceParentPath = getParentPath(filePath)
    const movedPath = sourceParentPath === targetParentPath
      ? filePath
      : await moveEntry(path, filePath, targetParentPath, kind)
    const nextActivePath = currentActivePath
      ? resolvePathAfterEntryRename(currentActivePath, filePath, movedPath, kind)
      : null
    const placedTreeOrder = updateTreeOrderForPlacement(
      context.getVaultState().treeOrder,
      context.getTreeData(),
      filePath,
      movedPath,
      targetParentPath,
      beforePath
    )
    const nextTreeOrder = updateTreeOrderAfterRename(placedTreeOrder, filePath, movedPath, kind)

    context.persistVaultState({ treeOrder: nextTreeOrder })
    await context.reloadTree(nextActivePath)
    context.syncActivePathAfterEntryPathChange(nextActivePath, currentActivePath)
  }

  /** 删除文件或文件夹 */
  async function handleDeleteEntry(filePath: string, kind: VaultEntryKind) {
    const path = context.getVaultPath()
    const currentActivePath = context.getActivePath()
    if (!path) return

    const deletesActiveFile = doesEntryAffectActiveFile(
      currentActivePath,
      filePath,
      kind,
      isPathInsideDirectory
    )
    if (deletesActiveFile) context.clearPendingSave()

    await deleteEntry(path, filePath, kind)
    context.persistVaultState({
      treeOrder: updateTreeOrderAfterDelete(context.getVaultState().treeOrder, filePath, kind),
    })
    await context.reloadTree(deletesActiveFile ? null : currentActivePath)
  }

  return {
    handleCreateFile,
    handleCreateFolder,
    handleDeleteEntry,
    handleMoveEntry,
    handleRenameEntry,
    handleReorderEntry,
  }
}
