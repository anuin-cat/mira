import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
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
  updateMiraMap,
} from './services/noteService'
import {
  getDisplayName,
  getParentPath,
  isPathInsideDirectory,
  MIRA_MAP_FILE,
} from './services/pathUtils'
import { VaultSetup } from './features/vault/VaultSetup'
import { FileTree } from './features/file-tree/FileTree'
import { MilkdownEditor } from './features/editor/MilkdownEditor'
import type { VaultEntryKind, VaultState, VaultTreeNode } from './domain/note'
import './App.css'

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 480
const SIDEBAR_DEFAULT_WIDTH = 280

const DEFAULT_VAULT_STATE: VaultState = {
  version: 1,
  lastOpenedPath: null,
  expandedDirs: [],
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

/** 优先打开上次文件，其次 Mira Map，最后第一个 Markdown 文件 */
function chooseOpenPath(nodes: VaultTreeNode[], preferredPath: string | null): string | null {
  if (hasFile(nodes, preferredPath)) return preferredPath
  if (hasFile(nodes, MIRA_MAP_FILE)) return MIRA_MAP_FILE
  return findFirstFile(nodes)
}

/** 获取目录及其所有祖先目录 */
function collectAncestorDirs(path: string | null): string[] {
  if (!path) return []
  const segments = path.split('/').filter(Boolean)
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
}

interface EditorTitleProps {
  activePath: string | null
  onRename: (name: string) => Promise<string | null>
}

/** 编辑器内嵌标题输入框，只重命名文件，不写入 Markdown 正文 */
function EditorTitle({ activePath, onRename }: EditorTitleProps) {
  const [value, setValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setValue(activePath ? getDisplayName(activePath, 'file') : '')
  }, [activePath])

  async function commitRename() {
    if (!activePath || isSaving) return
    const currentName = getDisplayName(activePath, 'file')
    const nextName = value.trim()

    if (!nextName || nextName === currentName) {
      setValue(currentName)
      return
    }

    try {
      setIsSaving(true)
      const renamedPath = await onRename(nextName)
      setValue(renamedPath ? getDisplayName(renamedPath, 'file') : currentName)
    } catch (error) {
      window.alert(getErrorMessage(error))
      setValue(currentName)
    } finally {
      setIsSaving(false)
    }
  }

  if (!activePath) return null

  return (
    <input
      className="editor-title-input"
      value={value}
      disabled={isSaving}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commitRename()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setValue(getDisplayName(activePath, 'file'))
          event.currentTarget.blur()
        }
      }}
      aria-label="文件名"
    />
  )
}

export default function App() {
  const [vaultPath, setVaultPathState] = useState<string | null>(null)
  const [treeData, setTreeData] = useState<VaultTreeNode[]>([])
  const [vaultState, setVaultState] = useState<VaultState>(DEFAULT_VAULT_STATE)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vaultPathRef = useRef<string | null>(null)
  const vaultStateRef = useRef<VaultState>(DEFAULT_VAULT_STATE)
  const activePathRef = useRef<string | null>(null)
  const latestContentRef = useRef('')
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  /** 开始拖拽分隔条 */
  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = sidebarWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return
      const delta = moveEvent.clientX - dragStartXRef.current
      const newWidth = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, dragStartWidthRef.current + delta)
      )
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      isDraggingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

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
    const unlistenChangeVault = listen('menu:change-vault', () => {
      void handleChangeVault()
    })
    const unlistenRefreshVault = listen('menu:refresh-vault', () => {
      void handleRefreshVault()
    })
    const unlistenUpdateMap = listen('menu:update-mira-map', () => {
      void handleUpdateMiraMap()
    })

    return () => {
      unlistenChangeVault.then((fn) => fn())
      unlistenRefreshVault.then((fn) => fn())
      unlistenUpdateMap.then((fn) => fn())
    }
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  /** 持久化 vault 状态，.mira 被删除时会自动重建 */
  function persistVaultState(patch: Partial<VaultState>) {
    const path = vaultPathRef.current
    if (!path) return

    const nextState: VaultState = {
      ...vaultStateRef.current,
      ...patch,
      version: 1,
    }

    vaultStateRef.current = nextState
    setVaultState(nextState)
    void writeVaultState(path, nextState)
  }

  /** 加载指定文件到编辑器 */
  async function openFileFromDisk(path: string, filePath: string, shouldPersist = true) {
    const note = await readNote(path, filePath)
    if (!note) return false

    activePathRef.current = filePath
    latestContentRef.current = note.content
    setActivePath(filePath)
    setActiveContent(note.content)

    if (shouldPersist) persistVaultState({ lastOpenedPath: filePath })
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

    await ensureVaultSystem(path)
    const [state, tree] = await Promise.all([readVaultState(path), scanVaultTree(path)])

    vaultPathRef.current = path
    vaultStateRef.current = state
    setVaultPathState(path)
    setVaultState(state)
    setTreeData(tree)

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
      return tree
    }

    if (nextActivePath !== activePathRef.current) {
      await openFileFromDisk(path, nextActivePath)
    }

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

  /** 顶部标题栏重命名当前文件 */
  async function handleTitleRename(name: string): Promise<string | null> {
    const currentActivePath = activePathRef.current
    if (!currentActivePath) return null
    return await handleRenameEntry(currentActivePath, name, 'file')
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

  /** 菜单：显式更新 Mira Map.md */
  async function handleUpdateMiraMap() {
    const path = vaultPathRef.current
    if (!path) return
    if (!window.confirm('更新 Mira Map.md 会覆盖当前文件内容，确认继续？')) return

    await flushActiveSave()
    const content = await updateMiraMap(path)
    await reloadTree(activePathRef.current)

    if (activePathRef.current === MIRA_MAP_FILE) {
      latestContentRef.current = content
      setActiveContent(content)
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
        })
        .catch((error) => {
          window.alert(getErrorMessage(error))
        })
    }, 1000)
  }, [])

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
    <div className="app-layout">
      <FileTree
        key={vaultPath}
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
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      />
      <div className="sidebar-resizer" onMouseDown={handleResizerMouseDown} />
      <main className="editor-pane">
        {activePath ? (
          <MilkdownEditor
            key={activePath}
            initialContent={activeContent}
            onChange={handleContentChange}
            titleSlot={<EditorTitle activePath={activePath} onRename={handleTitleRename} />}
          />
        ) : (
          <div className="editor-empty">
            <p>右键左侧空白区域新建 Markdown 文件</p>
          </div>
        )}
      </main>
    </div>
  )
}
