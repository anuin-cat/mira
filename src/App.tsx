import { useState, useEffect, useRef, useCallback } from 'react'
import { getVaultPath, ensureVaultDirs } from './services/vaultService'
import {
  listNotes,
  readNote,
  createNote,
  saveNote,
  deleteNote,
} from './services/noteService'
import { VaultSetup } from './features/vault/VaultSetup'
import { NoteList } from './features/note/NoteList'
import { MilkdownEditor } from './features/editor/MilkdownEditor'
import type { NoteMeta } from './domain/note'
import './App.css'

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeContent, setActiveContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  // debounce 自动保存的 timer；activeIdRef 防止切换 note 时保存到错误文件
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

  /** 初始化 vault（确保目录存在，加载 note 列表，打开第一条） */
  async function initVault(path: string) {
    setIsLoading(true)
    await ensureVaultDirs(path)
    setVaultPath(path)
    const metas = await listNotes(path)
    setNotes(metas)
    if (metas.length > 0) {
      await openNote(path, metas[0].id)
    }
    setIsLoading(false)
  }

  /** 打开并加载指定 note */
  async function openNote(path: string, id: string) {
    const note = await readNote(path, id)
    if (!note) return
    setActiveId(id)
    activeIdRef.current = id
    setActiveContent(note.content)
  }

  /** 切换 note（取消 pending 的自动保存后再切换） */
  async function handleSelectNote(id: string) {
    if (id === activeId || !vaultPath) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    await openNote(vaultPath, id)
  }

  /** 新建 note */
  async function handleNewNote() {
    if (!vaultPath) return
    const meta = await createNote(vaultPath)
    setNotes((prev) => [meta, ...prev])
    setActiveId(meta.id)
    activeIdRef.current = meta.id
    setActiveContent('')
  }

  /** 删除 note，删后自动切换到列表第一条 */
  async function handleDeleteNote(id: string) {
    if (!vaultPath) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    await deleteNote(vaultPath, id)
    const updated = await listNotes(vaultPath)
    setNotes(updated)
    if (id === activeId) {
      if (updated.length > 0) {
        await openNote(vaultPath, updated[0].id)
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
        const updatedMeta = await saveNote(vaultPath, currentId, markdown)
        setNotes((prev) => prev.map((m) => (m.id === currentId ? updatedMeta : m)))
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
      <NoteList
        notes={notes}
        activeId={activeId}
        onSelect={handleSelectNote}
        onNew={handleNewNote}
        onDelete={handleDeleteNote}
      />
      <main className="editor-pane">
        {activeId ? (
          // key 变化时强制重新挂载编辑器，加载新 note 内容
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
