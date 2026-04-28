import { useCallback, useEffect, useRef, useState } from 'react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  usePanelRef,
} from 'react-resizable-panels'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  ensureVaultSystem,
  getVaultPath,
  readVaultState,
  setupVault,
  writeVaultState,
} from './services/vaultService'
import {
  createFolder,
  createMarkdownFile,
  deleteEntry,
  moveEntry,
  readNote,
  renameEntry,
  resolvePathAfterEntryRename,
  saveNote,
  scanVaultTree,
} from './services/noteService'
import { getDisplayName, getParentPath, isPathInsideDirectory } from './services/pathUtils'
import { VaultSetup } from './features/vault/VaultSetup'
import { FileTree, type FileTreeHandle } from './features/file-tree/FileTree'
import { MdxEditor, type MdxEditorHandle } from './features/editor/MdxEditor'
import { AiSidebar, type AiSidebarHandle } from './features/ai/AiSidebar'
import { GitPanel, type GitPanelAction, type GitPanelRequest } from './features/git/GitPanel'
import {
  COMMAND_DEFINITIONS,
  CommandPalette,
  QuickOpenDialog,
  VaultSearchDialog,
  useAppCommands,
  type ActiveCommandDialog,
  type VaultSearchMatch,
} from './features/commands'
import { getGitStatus } from './services/gitService'
import type { GitStatusResult } from './domain/git'
import type { FontSize, Theme, VaultEntryKind, VaultState, VaultTreeNode } from './domain/note'

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 480
const SIDEBAR_DEFAULT_WIDTH = 280
const AI_SIDEBAR_MIN_WIDTH = 290
const AI_SIDEBAR_MAX_WIDTH = 560
const AI_SIDEBAR_DEFAULT_WIDTH = 380

const DEFAULT_VAULT_STATE: VaultState = {
  version: 1,
  lastOpenedPath: null,
  expandedDirs: [],
  fontSize: 'medium',
  theme: 'default',
}

interface NavigationHistory {
  paths: string[]
  index: number
}

interface PendingEditorSelection {
  path: string
  query: string
  matchOrdinal: number
}

/** 从未知异常中提取可展示消息 */
function getErrorMessage(error: unknown): string {
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
function chooseOpenPath(nodes: VaultTreeNode[], preferredPath: string | null): string | null {
  if (hasFile(nodes, preferredPath)) return preferredPath
  return findFirstFile(nodes)
}

/** 获取目录及其所有祖先目录 */
function collectAncestorDirs(path: string | null): string[] {
  if (!path) return []
  const segments = path.split('/').filter(Boolean)
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
}

/** 判断当前是否运行在 macOS，用于适配原生窗口按钮位置 */
function isMacOSPlatform() {
  return navigator.userAgent.toLowerCase().includes('mac')
}

/** 把面板宽度收敛为整数，避免拖拽结果在小数像素间抖动 */
function toPanelPixels(width: number) {
  return Math.round(width)
}

/** 把面板宽度限制在允许范围内，避免异常值污染记忆宽度 */
function clampPanelPixels(width: number, minWidth: number, maxWidth: number) {
  return Math.min(Math.max(toPanelPixels(width), minWidth), maxWidth)
}

export default function App() {
  const isMacOS = isMacOSPlatform()
  const [vaultPath, setVaultPathState] = useState<string | null>(null)
  const [treeData, setTreeData] = useState<VaultTreeNode[]>([])
  const [vaultState, setVaultState] = useState<VaultState>(DEFAULT_VAULT_STATE)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [editorInstanceVersion, setEditorInstanceVersion] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [isFileSidebarOpen, setIsFileSidebarOpen] = useState(true)
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false)
  const [aiSidebarWidth, setAiSidebarWidth] = useState(AI_SIDEBAR_DEFAULT_WIDTH)
  const [activeCommandDialog, setActiveCommandDialog] = useState<ActiveCommandDialog>(null)
  const [isGitPanelOpen, setIsGitPanelOpen] = useState(false)
  const [gitPanelRequest, setGitPanelRequest] = useState<GitPanelRequest | null>(null)
  const [gitChangeCount, setGitChangeCount] = useState(0)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vaultPathRef = useRef<string | null>(null)
  const vaultStateRef = useRef<VaultState>(DEFAULT_VAULT_STATE)
  const activePathRef = useRef<string | null>(null)
  const latestContentRef = useRef('')
  const navigationHistoryRef = useRef<NavigationHistory>({ paths: [], index: -1 })
  const pendingEditorSelectionRef = useRef<PendingEditorSelection | null>(null)
  const fileTreeRef = useRef<FileTreeHandle>(null)
  const editorHandleRef = useRef<MdxEditorHandle>(null)
  const aiSidebarRef = useRef<AiSidebarHandle>(null)
  const fileSidebarPanelRef = usePanelRef()
  const aiSidebarPanelRef = usePanelRef()

  /** 同步三栏最终宽度，避免拖拽过程触发 React 重渲染 */
  const handleLayoutChanged = useCallback(() => {
    // 1. 读取左侧文件树最终像素宽度
    const filePanel = fileSidebarPanelRef.current
    const nextSidebarWidth = filePanel?.getSize().inPixels
    if (filePanel && nextSidebarWidth !== undefined) {
      const isFileOpen = !filePanel.isCollapsed()
      setIsFileSidebarOpen((currentValue) => (currentValue === isFileOpen ? currentValue : isFileOpen))
    }
    if (filePanel && !filePanel.isCollapsed() && nextSidebarWidth !== undefined && nextSidebarWidth > 0) {
      const nextPixels = clampPanelPixels(nextSidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
      setSidebarWidth((currentWidth) => (currentWidth === nextPixels ? currentWidth : nextPixels))
    }

    // 2. 读取 AI 面板最终像素宽度，并同步开关状态与记忆宽度
    const aiPanel = aiSidebarPanelRef.current
    const nextAiWidth = aiPanel?.getSize().inPixels
    if (!aiPanel || nextAiWidth === undefined) return

    const isAiOpen = !aiPanel.isCollapsed()
    setIsAiSidebarOpen((currentValue) => (currentValue === isAiOpen ? currentValue : isAiOpen))

    if (!isAiOpen) return
    const nextPixels = clampPanelPixels(nextAiWidth, AI_SIDEBAR_MIN_WIDTH, AI_SIDEBAR_MAX_WIDTH)
    setAiSidebarWidth((currentWidth) => (currentWidth === nextPixels ? currentWidth : nextPixels))
  }, [fileSidebarPanelRef, aiSidebarPanelRef])

  /** 显式切换 AI 面板展开状态，避免 effect 与布局回调互相触发 */
  const handleToggleAiSidebar = useCallback(() => {
    // 1. 读取当前 AI 面板实例，优先用真实尺寸做决策
    const aiPanel = aiSidebarPanelRef.current
    if (!aiPanel) {
      setIsAiSidebarOpen((currentValue) => !currentValue)
      return
    }

    const isCurrentlyOpen = !aiPanel.isCollapsed()
    if (isCurrentlyOpen) {
      // 2. 关闭前记住当前宽度，方便下次恢复
      const currentPixels = clampPanelPixels(
        aiPanel.getSize().inPixels,
        AI_SIDEBAR_MIN_WIDTH,
        AI_SIDEBAR_MAX_WIDTH
      )
      setAiSidebarWidth((currentWidth) => (currentWidth === currentPixels ? currentWidth : currentPixels))
      aiPanel.collapse()
      setIsAiSidebarOpen(false)
      return
    }

    // 3. 展开时直接恢复记忆宽度，避免再走额外同步 effect
    aiPanel.resize(clampPanelPixels(aiSidebarWidth, AI_SIDEBAR_MIN_WIDTH, AI_SIDEBAR_MAX_WIDTH))
    setIsAiSidebarOpen(true)
  }, [aiSidebarPanelRef, aiSidebarWidth])

  /** 显式切换文件侧栏展开状态 */
  function handleToggleFileSidebar() {
    const filePanel = fileSidebarPanelRef.current
    if (!filePanel) {
      setIsFileSidebarOpen((currentValue) => !currentValue)
      return
    }

    const isCurrentlyOpen = !filePanel.isCollapsed()
    if (isCurrentlyOpen) {
      const currentPixels = clampPanelPixels(
        filePanel.getSize().inPixels,
        SIDEBAR_MIN_WIDTH,
        SIDEBAR_MAX_WIDTH
      )
      setSidebarWidth((currentWidth) => (currentWidth === currentPixels ? currentWidth : currentPixels))
      filePanel.collapse()
      setIsFileSidebarOpen(false)
      return
    }

    filePanel.resize(clampPanelPixels(sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH))
    setIsFileSidebarOpen(true)
  }

  /** 展开 AI 侧栏但不反向关闭，供命令入口复用 */
  function openAiSidebar() {
    const aiPanel = aiSidebarPanelRef.current
    if (!aiPanel) {
      setIsAiSidebarOpen(true)
      return
    }

    if (aiPanel.isCollapsed()) {
      aiPanel.resize(clampPanelPixels(aiSidebarWidth, AI_SIDEBAR_MIN_WIDTH, AI_SIDEBAR_MAX_WIDTH))
    }
    setIsAiSidebarOpen(true)
  }

  /** 打开 Git 面板，可选择触发一个菜单动作 */
  function openGitPanel(action: GitPanelAction | null = null) {
    setIsGitPanelOpen(true)
    if (action) {
      setGitPanelRequest({
        id: Date.now(),
        action,
      })
    }
  }

  /** 根据 Git 状态更新左侧入口 badge */
  function handleGitStatusChange(status: GitStatusResult) {
    const nextCount = status.isGitRepository && status.isVaultGitRoot ? status.changedFiles.length : 0
    setGitChangeCount(nextCount)
  }

  /** 轻量刷新 Git badge，失败时不打断笔记编辑 */
  async function refreshGitStatusBadge(path = vaultPathRef.current) {
    if (!path) {
      setGitChangeCount(0)
      return
    }

    try {
      const status = await getGitStatus(path)
      handleGitStatusChange(status)
    } catch {
      setGitChangeCount(0)
    }
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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
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
    const nextState: VaultState = {
      ...vaultStateRef.current,
      ...patch,
      version: 1,
    }

    vaultStateRef.current = nextState
    setVaultState(nextState)

    const path = vaultPathRef.current
    if (path) void writeVaultState(path, nextState)
  }

  /** 记录文件访问历史，用于菜单后退/前进 */
  function recordNavigation(filePath: string) {
    const history = navigationHistoryRef.current
    if (history.paths[history.index] === filePath) return

    const nextPaths = history.paths.slice(0, history.index + 1)
    nextPaths.push(filePath)
    if (nextPaths.length > 80) nextPaths.shift()

    navigationHistoryRef.current = {
      paths: nextPaths,
      index: nextPaths.length - 1,
    }
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
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (!path || !filePath) return
    await saveNote(path, filePath, latestContentRef.current)
  }

  /** 初始化 vault：重建内部状态、扫描 Markdown、打开默认文件 */
  async function initVault(path: string) {
    setIsLoading(true)
    setLoadError(null)
    navigationHistoryRef.current = { paths: [], index: -1 }

    await ensureVaultSystem(path)
    const [state, tree] = await Promise.all([readVaultState(path), scanVaultTree(path)])

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

    const tree = await scanVaultTree(path)
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

  /** 新建 Markdown 文件并打开 */
  async function handleCreateFile(parentPath: string | null): Promise<string | null> {
    const path = vaultPathRef.current
    if (!path) return null

    const createdPath = await createMarkdownFile(path, parentPath)
    const parentDir = getParentPath(createdPath)
    if (parentDir) {
      persistVaultState({
        expandedDirs: Array.from(new Set([...vaultStateRef.current.expandedDirs, ...collectAncestorDirs(parentDir)])),
      })
    }

    await reloadTree(createdPath)
    await openFileFromDisk(path, createdPath)
    return createdPath
  }

  /** 新建文件夹 */
  async function handleCreateFolder(parentPath: string | null): Promise<string | null> {
    const path = vaultPathRef.current
    if (!path) return null

    const createdPath = await createFolder(path, parentPath)
    const parentDir = getParentPath(createdPath)
    persistVaultState({
      expandedDirs: Array.from(new Set([...vaultStateRef.current.expandedDirs, ...collectAncestorDirs(parentDir)])),
    })
    await reloadTree()
    return createdPath
  }

  /** 重命名文件或文件夹，并同步当前打开文件路径 */
  async function handleRenameEntry(
    filePath: string,
    name: string,
    kind: VaultEntryKind
  ): Promise<string | null> {
    const path = vaultPathRef.current
    const currentActivePath = activePathRef.current
    if (!path) return null

    const affectsActiveFile = currentActivePath
      ? kind === 'file'
        ? currentActivePath === filePath
        : isPathInsideDirectory(currentActivePath, filePath)
      : false

    if (affectsActiveFile) await flushActiveSave()

    const renamedPath = await renameEntry(path, filePath, name, kind)
    const nextActivePath = currentActivePath
      ? resolvePathAfterEntryRename(currentActivePath, filePath, renamedPath, kind)
      : null

    await reloadTree(nextActivePath)
    if (nextActivePath && nextActivePath !== currentActivePath) {
      activePathRef.current = nextActivePath
      setActivePath(nextActivePath)
      recordNavigation(nextActivePath)
      persistVaultState({ lastOpenedPath: nextActivePath })
    }

    return renamedPath
  }

  /** 拖拽移动文件或文件夹，并同步当前打开文件路径 */
  async function handleMoveEntry(filePath: string, targetDir: string | null, kind: VaultEntryKind) {
    const path = vaultPathRef.current
    const currentActivePath = activePathRef.current
    if (!path) return

    const affectsActiveFile = currentActivePath
      ? kind === 'file'
        ? currentActivePath === filePath
        : isPathInsideDirectory(currentActivePath, filePath)
      : false

    if (affectsActiveFile) await flushActiveSave()

    const movedPath = await moveEntry(path, filePath, targetDir, kind)
    const nextActivePath = currentActivePath
      ? resolvePathAfterEntryRename(currentActivePath, filePath, movedPath, kind)
      : null

    await reloadTree(nextActivePath)
    if (nextActivePath && nextActivePath !== currentActivePath) {
      activePathRef.current = nextActivePath
      setActivePath(nextActivePath)
      recordNavigation(nextActivePath)
      persistVaultState({ lastOpenedPath: nextActivePath })
    }
  }

  /** 删除文件或文件夹 */
  async function handleDeleteEntry(filePath: string, kind: VaultEntryKind) {
    const path = vaultPathRef.current
    const currentActivePath = activePathRef.current
    if (!path) return

    const deletesActiveFile = currentActivePath
      ? kind === 'file'
        ? currentActivePath === filePath
        : isPathInsideDirectory(currentActivePath, filePath)
      : false

    if (deletesActiveFile && saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    await deleteEntry(path, filePath, kind)
    await reloadTree(deletesActiveFile ? null : currentActivePath)
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
    const tree = await scanVaultTree(path)
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
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      await openFileFromDisk(path, currentActivePath, true, false)
    }

    await reloadTree(activePathRef.current)
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
    setActiveContent(markdown)

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

  const editorWorkspace = activePath ? (
    <section className="editor-workspace">
      <MdxEditor
        key={`${activePath}:${editorInstanceVersion}`}
        ref={editorHandleRef}
        initialContent={activeContent}
        isAiSidebarOpen={isAiSidebarOpen}
        onChange={handleContentChange}
        onToggleAiSidebar={handleToggleAiSidebar}
      />
    </section>
  ) : null

  if (isLoading) {
    return <div className="loading">加载中...</div>
  }

  if (loadError) {
    return <div className="loading">加载失败：{loadError}</div>
  }

  if (!vaultPath) {
    return <VaultSetup onVaultReady={(path) => initVault(path)} />
  }

  return (
    <TooltipProvider delayDuration={100}>
      <>
        <PanelGroup
          orientation="horizontal"
          className="app-layout"
          id="app-layout"
          onLayoutChanged={handleLayoutChanged}
          data-font-size={vaultState.fontSize || 'medium'}
          data-theme={vaultState.theme || 'default'}
          data-platform={isMacOS ? 'macos' : 'default'}
        >
          <Panel
            id="file-sidebar-panel"
            className="app-sidebar-panel"
            defaultSize={sidebarWidth}
            minSize={SIDEBAR_MIN_WIDTH}
            maxSize={SIDEBAR_MAX_WIDTH}
            collapsedSize={0}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            panelRef={fileSidebarPanelRef}
          >
            <FileTree
              key={vaultPath}
              ref={fileTreeRef}
              treeData={treeData}
              activePath={activePath}
              expandedDirs={vaultState.expandedDirs}
              onOpenFile={handleOpenFile}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onRenameEntry={handleRenameEntry}
              onMoveEntry={handleMoveEntry}
              onDeleteEntry={handleDeleteEntry}
              onExpandedDirsChange={handleExpandedDirsChange}
              onOpenGitPanel={() => openGitPanel()}
              gitChangeCount={gitChangeCount}
            />
          </Panel>
          <PanelResizeHandle
            id="file-sidebar-separator"
            className={`panel-resizer${isFileSidebarOpen ? '' : ' panel-resizer-hidden'}`}
            disabled={!isFileSidebarOpen}
          />
          <Panel
            id="editor-workspace-panel"
            className={`editor-pane${isAiSidebarOpen ? '' : ' is-ai-sidebar-collapsed'}`}
          >
            {activePath ? (
              editorWorkspace
            ) : (
              <div className="editor-empty">
                <p>右键左侧空白区域新建 Markdown 文件</p>
              </div>
            )}
          </Panel>
          <PanelResizeHandle
            id="ai-sidebar-separator"
            className={`panel-resizer${isAiSidebarOpen ? '' : ' panel-resizer-hidden'}`}
            disabled={!isAiSidebarOpen}
          />
          <Panel
            id="ai-sidebar-panel"
            className="ai-sidebar-panel-shell"
            defaultSize={0}
            minSize={AI_SIDEBAR_MIN_WIDTH}
            maxSize={AI_SIDEBAR_MAX_WIDTH}
            collapsedSize={0}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            panelRef={aiSidebarPanelRef}
          >
            <AiSidebar
              key={vaultPath}
              ref={aiSidebarRef}
              vaultPath={vaultPath}
              notePath={activePath}
              noteTitle={activePath ? getDisplayName(activePath, 'file') : null}
              noteContent={activeContent}
              onBeforeAgentRequest={flushActiveSave}
              getCurrentNoteSnapshot={getCurrentNoteSnapshot}
              onAgentFilesChanged={handleAgentFilesChanged}
            />
          </Panel>
        </PanelGroup>
        <CommandPalette
          isOpen={activeCommandDialog === 'command-palette'}
          commands={COMMAND_DEFINITIONS}
          onClose={() => setActiveCommandDialog(null)}
          onRunCommand={(commandId) => {
            runCommand(commandId)
          }}
        />
        <QuickOpenDialog
          isOpen={activeCommandDialog === 'quick-open'}
          treeData={treeData}
          activePath={activePath}
          onClose={() => setActiveCommandDialog(null)}
          onOpenFile={(filePath) => {
            void handleOpenFile(filePath)
          }}
        />
        <VaultSearchDialog
          isOpen={activeCommandDialog === 'vault-search'}
          vaultPath={vaultPath}
          treeData={treeData}
          onClose={() => setActiveCommandDialog(null)}
          onOpenFile={(filePath, match) => {
            void handleOpenSearchResult(filePath, match)
          }}
        />
        <GitPanel
          isOpen={isGitPanelOpen}
          vaultPath={vaultPath}
          request={gitPanelRequest}
          onClose={() => setIsGitPanelOpen(false)}
          onBeforeWrite={flushActiveSave}
          onStatusChange={handleGitStatusChange}
        />
      </>
    </TooltipProvider>
  )
}
