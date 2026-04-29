import { useCallback, useEffect, useRef, useState } from 'react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  ensureVaultSystem,
  getVaultPath,
  readVaultState,
  setupVault,
  writeVaultState,
} from '../../services/vaultService'
import {
  readNote,
  saveNote,
  scanVaultTree,
} from '../../services/noteService'
import { getGitStatus } from '../../services/gitService'
import type { GitStatusResult } from '../../domain/git'
import type { AiTextReference } from '../../domain/ai'
import type { FontSize, Theme, VaultState, VaultTreeNode } from '../../domain/note'
import type { FileTreeHandle } from '../file-tree/FileTree'
import type { MdxEditorHandle } from '../editor/MdxEditor'
import type { AiSidebarHandle } from '../ai/AiSidebar'
import type { GitPanelAction } from '../git/GitPanel'
import type { GitPanelHostHandle } from '../git/GitPanelHost'
import {
  useAppCommands,
  type ActiveCommandDialog,
  type VaultSearchMatch,
} from '../commands'
import {
  DEFAULT_VAULT_STATE,
  chooseOpenPath,
  createNavigationHistoryEntry,
  createNextVaultState,
  createVaultWorkspaceFileActions,
  getErrorMessage,
  type NavigationHistory,
  type PendingEditorSelection,
} from './vaultWorkspaceModel'

const AI_REFERENCE_DEDUP_WINDOW_MS = 800

interface UseVaultWorkspaceOptions {
  isAiSidebarOpen: boolean
  openAiSidebar: () => void
  handleToggleAiSidebar: () => void
  handleToggleFileSidebar: () => void
}

interface LastAiTextReference {
  signature: string
  addedAt: number
}

/** 生成用于短时间去重的引用签名，忽略每次新建时随机生成的 id */
function getAiTextReferenceSignature(reference: AiTextReference) {
  return [
    reference.path,
    reference.title,
    reference.startLine,
    reference.endLine,
    reference.content,
  ].join('\u001f')
}

/** 管理 vault、文件树、编辑器内容、菜单命令和 Git badge 状态 */
export function useVaultWorkspace({
  isAiSidebarOpen,
  openAiSidebar,
  handleToggleAiSidebar,
  handleToggleFileSidebar,
}: UseVaultWorkspaceOptions) {
  const [vaultPath, setVaultPathState] = useState<string | null>(null)
  const [treeData, setTreeData] = useState<VaultTreeNode[]>([])
  const [vaultState, setVaultState] = useState<VaultState>(DEFAULT_VAULT_STATE)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [editorInstanceVersion, setEditorInstanceVersion] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeCommandDialog, setActiveCommandDialog] = useState<ActiveCommandDialog>(null)
  const [gitChangeCount, setGitChangeCount] = useState(0)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vaultPathRef = useRef<string | null>(null)
  const vaultStateRef = useRef<VaultState>(DEFAULT_VAULT_STATE)
  const activePathRef = useRef<string | null>(null)
  const latestContentRef = useRef('')
  const lastGitStatusRef = useRef<GitStatusResult | null>(null)
  const navigationHistoryRef = useRef<NavigationHistory>({ paths: [], index: -1 })
  const pendingEditorSelectionRef = useRef<PendingEditorSelection | null>(null)
  const gitPanelHostRef = useRef<GitPanelHostHandle>(null)
  const fileTreeRef = useRef<FileTreeHandle>(null)
  const editorHandleRef = useRef<MdxEditorHandle>(null)
  const aiSidebarRef = useRef<AiSidebarHandle>(null)
  const lastAiTextReferenceRef = useRef<LastAiTextReference | null>(null)
  const fileActions = createVaultWorkspaceFileActions({
    getActivePath: () => activePathRef.current,
    getTreeData: () => treeData,
    getVaultPath: () => vaultPathRef.current,
    getVaultState: () => vaultStateRef.current,
    clearPendingSave,
    flushActiveSave,
    openFileFromDisk,
    persistVaultState,
    reloadTree,
    syncActivePathAfterEntryPathChange,
  })

  /** 清理尚未执行的延迟保存任务 */
  function clearPendingSave() {
    if (!saveTimerRef.current) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
  }

  /** 打开 Git 面板，可选择触发一个菜单动作 */
  function openGitPanel(action: GitPanelAction | null = null) {
    gitPanelHostRef.current?.open(action)
  }

  /** 根据 Git 状态更新左侧入口 badge */
  function handleGitStatusChange(status: GitStatusResult) {
    lastGitStatusRef.current = status
    const nextCount = status.isGitRepository && status.isVaultGitRoot ? status.changedFiles.length : 0
    setGitChangeCount(nextCount)
  }

  /** 轻量刷新 Git badge，失败时不打断笔记编辑 */
  async function refreshGitStatusBadge(path = vaultPathRef.current) {
    if (!path) {
      lastGitStatusRef.current = null
      setGitChangeCount(0)
      return
    }

    try {
      const status = await getGitStatus(path)
      handleGitStatusChange(status)
    } catch {
      lastGitStatusRef.current = null
      setGitChangeCount(0)
    }
  }

  /** 跳过同一选区在同一次快捷键链路中被重复加入 */
  function shouldSkipDuplicateAiTextReference(reference: AiTextReference) {
    const signature = getAiTextReferenceSignature(reference)
    const now = performance.now()
    const lastReference = lastAiTextReferenceRef.current
    lastAiTextReferenceRef.current = { signature, addedAt: now }

    return Boolean(
      lastReference &&
        lastReference.signature === signature &&
        now - lastReference.addedAt <= AI_REFERENCE_DEDUP_WINDOW_MS
    )
  }

  /** 把指定编辑器引用加入 AI 输入框，并确保侧栏打开聚焦 */
  function addTextReferenceToAiComposer(reference: AiTextReference) {
    if (shouldSkipDuplicateAiTextReference(reference)) return

    openAiSidebar()
    window.requestAnimationFrame(() => {
      aiSidebarRef.current?.addReference(reference)
      aiSidebarRef.current?.focusComposer()
    })
  }

  /** 从当前编辑器选区创建引用并加入 AI 输入框 */
  function addSelectedTextToAiComposer() {
    const reference = editorHandleRef.current?.getSelectionReference()
    if (!reference) return false

    addTextReferenceToAiComposer(reference)
    return true
  }

  const runCommand = useAppCommands({
    vaultPathRef,
    activePathRef,
    fileTreeRef,
    editorHandleRef,
    aiSidebarRef,
    setActiveCommandDialog,
    isAiSidebarOpen: () => isAiSidebarOpen,
    openAiSidebar,
    addSelectedTextToAiComposer,
    handleToggleAiSidebar,
    openGitPanel,
    handleChangeVault,
    handleRefreshVault,
    handleNavigateHistory,
    handleRevealInFinder,
    handleToggleFileSidebar,
    handleFontSizeChange,
    handleThemeChange,
    flushActiveSave,
  })

  useEffect(() => {
    const savedPath = getVaultPath()
    if (savedPath) {
      initVault(savedPath).catch((error) => {
        setLoadError(getErrorMessage(error))
        setIsLoading(false)
      })
    } else {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      clearPendingSave()
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.fontSize = vaultState.fontSize || 'medium'
    document.documentElement.dataset.theme = vaultState.theme || 'default'

    return () => {
      delete document.documentElement.dataset.fontSize
      delete document.documentElement.dataset.theme
    }
  }, [vaultState.fontSize, vaultState.theme])

  useEffect(() => {
    schedulePendingEditorSelection()
  }, [activePath, activeContent])

  /** 持久化 vault 状态，.mira 被删除时会自动重建 */
  function persistVaultState(patch: Partial<VaultState>) {
    const nextState = createNextVaultState(vaultStateRef.current, patch)

    vaultStateRef.current = nextState
    setVaultState(nextState)

    const path = vaultPathRef.current
    if (path) void writeVaultState(path, nextState)
  }

  /** 记录文件访问历史，用于菜单后退/前进 */
  function recordNavigation(filePath: string) {
    navigationHistoryRef.current = createNavigationHistoryEntry(navigationHistoryRef.current, filePath)
  }

  /** 文件路径变更后，同步当前打开文件路径、访问历史和持久状态 */
  function syncActivePathAfterEntryPathChange(nextActivePath: string | null, previousActivePath: string | null) {
    if (!nextActivePath || nextActivePath === previousActivePath) return
    activePathRef.current = nextActivePath
    setActivePath(nextActivePath)
    recordNavigation(nextActivePath)
    persistVaultState({ lastOpenedPath: nextActivePath })
  }

  /** 在编辑器渲染完成后尝试恢复全局搜索命中选区 */
  function schedulePendingEditorSelection() {
    let attemptCount = 0

    const trySelect = () => {
      const pendingSelection = pendingEditorSelectionRef.current
      if (!pendingSelection || activePathRef.current !== pendingSelection.path) return

      const isSelected = editorHandleRef.current?.selectSearchMatch(
        pendingSelection.query,
        pendingSelection.matchOrdinal
      ) ?? false
      if (isSelected || attemptCount >= 12) {
        pendingEditorSelectionRef.current = null
        return
      }

      attemptCount += 1
      window.setTimeout(() => window.requestAnimationFrame(trySelect), 30)
    }

    window.requestAnimationFrame(trySelect)
  }

  /** 暂存全局搜索命中，等待目标文件打开后由编辑器选中 */
  function queueEditorSelection(filePath: string, match: VaultSearchMatch | null) {
    if (match?.kind !== 'content' || !match.query || match.matchOrdinal === null) return

    pendingEditorSelectionRef.current = {
      path: filePath,
      query: match.query,
      matchOrdinal: match.matchOrdinal,
    }
  }

  /** 加载指定文件到编辑器 */
  async function openFileFromDisk(path: string, filePath: string, shouldPersist = true, shouldRecordHistory = true) {
    const note = await readNote(path, filePath)
    if (!note) return false

    const previousActivePath = activePathRef.current
    activePathRef.current = filePath
    latestContentRef.current = note.content
    setActivePath(filePath)
    setActiveContent(note.content)
    if (previousActivePath === filePath) setEditorInstanceVersion((version) => version + 1)

    if (shouldPersist) persistVaultState({ lastOpenedPath: filePath })
    if (shouldRecordHistory) recordNavigation(filePath)
    return true
  }

  /** 清空当前编辑器状态 */
  function clearActiveFile() {
    activePathRef.current = null
    latestContentRef.current = ''
    setActivePath(null)
    setActiveContent('')
    persistVaultState({ lastOpenedPath: null })
  }

  /** 保存当前待写入内容，避免切换/移动/重命名时丢失 debounce 内容 */
  async function flushActiveSave() {
    const path = vaultPathRef.current
    const filePath = activePathRef.current
    clearPendingSave()
    if (!path || !filePath) return
    await saveNote(path, filePath, latestContentRef.current)
  }

  /** 初始化 vault：重建内部状态、扫描 Markdown、打开默认文件 */
  async function initVault(path: string) {
    setIsLoading(true)
    setLoadError(null)
    lastGitStatusRef.current = null
    navigationHistoryRef.current = { paths: [], index: -1 }

    await ensureVaultSystem(path)
    const state = await readVaultState(path)
    const tree = await scanVaultTree(path, state.treeOrder)

    vaultPathRef.current = path
    vaultStateRef.current = state
    setVaultPathState(path)
    setVaultState(state)
    setTreeData(tree)
    void refreshGitStatusBadge(path)

    const openPath = chooseOpenPath(tree, state.lastOpenedPath)
    if (openPath) {
      await openFileFromDisk(path, openPath)
    } else {
      clearActiveFile()
    }

    setIsLoading(false)
  }

  /** 重新扫描文件树，可选择新的激活文件 */
  async function reloadTree(preferredActivePath: string | null = activePathRef.current) {
    const path = vaultPathRef.current
    if (!path) return []

    const tree = await scanVaultTree(path, vaultStateRef.current.treeOrder)
    setTreeData(tree)

    const nextActivePath = chooseOpenPath(tree, preferredActivePath)
    if (!nextActivePath) {
      clearActiveFile()
      void refreshGitStatusBadge(path)
      return tree
    }

    if (nextActivePath !== activePathRef.current) {
      await openFileFromDisk(path, nextActivePath)
    }

    void refreshGitStatusBadge(path)
    return tree
  }

  /** 打开文件树中的 Markdown 文件 */
  async function handleOpenFile(filePath: string) {
    const path = vaultPathRef.current
    if (!path || filePath === activePathRef.current) return

    await flushActiveSave()
    const opened = await openFileFromDisk(path, filePath)
    if (!opened) await reloadTree()
  }

  /** 打开全局搜索结果，并在编辑器中选中正文命中 */
  async function handleOpenSearchResult(filePath: string, match: VaultSearchMatch | null) {
    queueEditorSelection(filePath, match)
    await handleOpenFile(filePath)
    schedulePendingEditorSelection()
  }

  /** 记录文件树展开状态 */
  function handleExpandedDirsChange(paths: string[]) {
    persistVaultState({ expandedDirs: paths })
  }

  /** 菜单：重新选择 vault */
  async function handleChangeVault() {
    await flushActiveSave()
    const newPath = await setupVault()
    if (!newPath) return

    lastGitStatusRef.current = null
    activePathRef.current = null
    latestContentRef.current = ''
    setActivePath(null)
    setActiveContent('')
    setTreeData([])
    await initVault(newPath)
  }

  /** 菜单：刷新外部编辑器带来的文件变化 */
  async function handleRefreshVault() {
    const path = vaultPathRef.current
    if (!path) return

    await flushActiveSave()
    await ensureVaultSystem(path)
    const tree = await scanVaultTree(path, vaultStateRef.current.treeOrder)
    setTreeData(tree)

    const nextActivePath = chooseOpenPath(tree, activePathRef.current)
    if (nextActivePath) {
      await openFileFromDisk(path, nextActivePath)
    } else {
      clearActiveFile()
    }
  }

  /** 菜单：调整字体大小 */
  function handleFontSizeChange(size: FontSize) {
    persistVaultState({ fontSize: size })
  }

  /** 菜单：切换主题 */
  function handleThemeChange(theme: Theme) {
    persistVaultState({ theme })
  }

  /** 菜单：按访问历史后退或前进 */
  async function handleNavigateHistory(offset: -1 | 1) {
    const path = vaultPathRef.current
    const history = navigationHistoryRef.current
    const nextIndex = history.index + offset
    const nextPath = history.paths[nextIndex]
    if (!path || !nextPath) return

    await flushActiveSave()
    navigationHistoryRef.current = {
      ...history,
      index: nextIndex,
    }
    const opened = await openFileFromDisk(path, nextPath, true, false)
    if (!opened) await reloadTree()
  }

  /** 菜单：在 Finder 中显示当前文件或 vault 根目录 */
  async function handleRevealInFinder() {
    const path = vaultPathRef.current
    if (!path) return

    const targetPath = activePathRef.current ? `${path}/${activePathRef.current}` : path
    try {
      await revealItemInDir(targetPath)
    } catch (error) {
      window.alert(getErrorMessage(error))
    }
  }

  /** agent 写入或回退文件后，同步文件树、Git badge 和当前编辑器内容 */
  async function handleAgentFilesChanged(changedPaths: string[]) {
    const path = vaultPathRef.current
    if (!path) return

    const uniqueChangedPaths = Array.from(new Set(changedPaths))
    const currentActivePath = activePathRef.current
    const shouldReloadActiveFile = currentActivePath ? uniqueChangedPaths.includes(currentActivePath) : false

    if (shouldReloadActiveFile && currentActivePath) {
      clearPendingSave()
      await openFileFromDisk(path, currentActivePath, true, false)
    }

    await reloadTree(activePathRef.current)
  }

  /** Git 撤销修改后，沿用同一套磁盘刷新逻辑同步编辑器与文件树 */
  async function handleGitFilesChanged(changedPaths: string[]) {
    await handleAgentFilesChanged(changedPaths)
  }

  /** 提供给 agent 工具的当前编辑器快照，用于拒绝覆盖未保存内容 */
  function getCurrentNoteSnapshot() {
    return {
      path: activePathRef.current,
      content: latestContentRef.current,
    }
  }

  /** 编辑器内容变化：debounce 1s 后保存 Markdown 文件 */
  const handleContentChange = useCallback((markdown: string) => {
    const path = vaultPathRef.current
    const filePath = activePathRef.current
    latestContentRef.current = markdown

    if (!path || !filePath) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      saveNote(path, filePath, markdown)
        .then(() => {
          if (activePathRef.current === filePath) void reloadTree(filePath)
          void refreshGitStatusBadge(path)
        })
        .catch((error) => {
          window.alert(getErrorMessage(error))
        })
      }, 1000)
  }, [])

  return {
    addTextReferenceToAiComposer,
    activeCommandDialog,
    activeContent,
    activePath,
    aiSidebarRef,
    editorHandleRef,
    editorInstanceVersion,
    fileTreeRef,
    flushActiveSave,
    getCurrentNoteSnapshot,
    gitChangeCount,
    gitPanelHostRef,
    handleAgentFilesChanged,
    handleContentChange,
    handleCreateFile: fileActions.handleCreateFile,
    handleCreateFolder: fileActions.handleCreateFolder,
    handleDeleteEntry: fileActions.handleDeleteEntry,
    handleExpandedDirsChange,
    handleGitFilesChanged,
    handleGitStatusChange,
    handleMoveEntry: fileActions.handleMoveEntry,
    handleOpenFile,
    handleOpenSearchResult,
    handleRenameEntry: fileActions.handleRenameEntry,
    handleReorderEntry: fileActions.handleReorderEntry,
    initVault,
    isLoading,
    lastGitStatusRef,
    loadError,
    runCommand,
    setActiveCommandDialog,
    treeData,
    vaultPath,
    vaultState,
  }
}

export type VaultWorkspace = ReturnType<typeof useVaultWorkspace>
