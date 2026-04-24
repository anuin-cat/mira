import { useState, useEffect, useRef, useCallback } from 'react'
import { getVaultPath, ensureVaultDirs } from './services/vaultService'
import {
  listEntries,
  readEntry,
  createEntry,
  saveEntry,
  deleteEntry,
} from './services/entryService'
import { VaultSetup } from './features/vault/VaultSetup'
import { EntryList } from './features/entry/EntryList'
import { MilkdownEditor } from './features/editor/MilkdownEditor'
import type { EntryMeta } from './domain/entry'
import './App.css'

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<EntryMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  // debounce 自动保存的 timer；activeIdRef 防止切换 entry 时保存到错误文件
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeIdRef = useRef<string | null>(null)

  // 1. 初始化：读取已保存的 vault 路径
  useEffect(() => {
    const savedPath = getVaultPath()
    if (savedPath) {
      initVault(savedPath)
    } else {
      setIsLoading(false)
    }
  }, [])

  /** 初始化 vault（确保目录存在，加载 entry 列表，打开第一条） */
  async function initVault(path: string) {
    setIsLoading(true)
    await ensureVaultDirs(path)
    setVaultPath(path)
    const metas = await listEntries(path)
    setEntries(metas)
    if (metas.length > 0) {
      await openEntry(path, metas[0].id)
    }
    setIsLoading(false)
  }

  /** 打开并加载指定 entry */
  async function openEntry(path: string, id: string) {
    const entry = await readEntry(path, id)
    if (!entry) return
    setActiveId(id)
    activeIdRef.current = id
    setActiveContent(entry.content)
  }

  /** 切换 entry（取消 pending 的自动保存后再切换） */
  async function handleSelectEntry(id: string) {
    if (id === activeId || !vaultPath) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    await openEntry(vaultPath, id)
  }

  /** 新建 entry */
  async function handleNewEntry() {
    if (!vaultPath) return
    const meta = await createEntry(vaultPath)
    setEntries((prev) => [meta, ...prev])
    setActiveId(meta.id)
    activeIdRef.current = meta.id
    setActiveContent('')
  }

  /** 删除 entry，删后自动切换到列表第一条 */
  async function handleDeleteEntry(id: string) {
    if (!vaultPath) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    await deleteEntry(vaultPath, id)
    const updated = await listEntries(vaultPath)
    setEntries(updated)
    if (id === activeId) {
      if (updated.length > 0) {
        await openEntry(vaultPath, updated[0].id)
      } else {
        setActiveId(null)
        activeIdRef.current = null
        setActiveContent('')
      }
    }
  }

  /** 编辑器内容变化：debounce 1s 后自动保存，更新侧边栏标题 */
  const handleContentChange = useCallback(
    (markdown: string) => {
      if (!vaultPath || !activeIdRef.current) return
      const currentId = activeIdRef.current

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        const updatedMeta = await saveEntry(vaultPath, currentId, markdown)
        setEntries((prev) => prev.map((m) => (m.id === currentId ? updatedMeta : m)))
      }, 1000)
    },
    [vaultPath]
  )

  if (isLoading) {
    return <div className="loading">加载中...</div>
  }

  if (!vaultPath) {
    return <VaultSetup onVaultReady={(path) => initVault(path)} />
  }

  return (
    <div className="app-layout">
      <EntryList
        entries={entries}
        activeId={activeId}
        onSelect={handleSelectEntry}
        onNew={handleNewEntry}
        onDelete={handleDeleteEntry}
      />
      <main className="editor-pane">
        {activeId ? (
          // key 变化时强制重新挂载编辑器，加载新 entry 内容
          <MilkdownEditor
            key={activeId}
            initialContent={activeContent}
            onChange={handleContentChange}
          />
        ) : (
          <div className="editor-empty">
            <p>点击左侧 + 新建一篇笔记</p>
          </div>
        )}
      </main>
    </div>
  )
}
