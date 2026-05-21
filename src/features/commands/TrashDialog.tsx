import { FileText, Folder, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TrashItem } from '../../domain/note'
import { cleanupExpiredTrash, listTrashItems } from '../../services/trashService'
import { confirmSystemAction, showSystemMessage } from '../../tauri/system'
import './commands.css'

interface TrashDialogProps {
  isOpen: boolean
  vaultPath: string | null
  onClose: () => void
  onRestoreItem: (itemId: string) => Promise<void>
  onDeleteItem: (itemId: string) => Promise<void>
}

const TRASH_DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const DAY_MS = 24 * 60 * 60 * 1000

/** 取路径最后一段作为回收站列表主标题 */
function getTrashItemTitle(item: TrashItem) {
  const segments = item.originalPath.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? item.originalPath
}

/** 格式化回收站删除时间 */
function formatTrashDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return TRASH_DATE_FORMATTER.format(date)
}

/** 计算回收站条目剩余保留天数 */
function getTrashRemainingDays(item: TrashItem) {
  const expiresAt = new Date(item.expiresAt).getTime()
  if (Number.isNaN(expiresAt)) return 0
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS))
}

/** 回收站弹层 */
export function TrashDialog({
  isOpen,
  vaultPath,
  onClose,
  onRestoreItem,
  onDeleteItem,
}: TrashDialogProps) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!isOpen) {
      setItems([])
      setIsLoading(false)
      setBusyItemId(null)
      setErrorMessage(null)
      requestIdRef.current += 1
      return
    }

    void loadItems()
  }, [isOpen, vaultPath])

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  /** 从磁盘加载回收站列表，打开时顺手清理过期条目 */
  async function loadItems() {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (!vaultPath) {
      setItems([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setErrorMessage(null)
    try {
      await cleanupExpiredTrash(vaultPath)
      const nextItems = await listTrashItems(vaultPath)
      if (requestIdRef.current === requestId) setItems(nextItems)
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setItems([])
        setErrorMessage(error instanceof Error ? error.message : '回收站读取失败')
      }
    } finally {
      if (requestIdRef.current === requestId) setIsLoading(false)
    }
  }

  /** 恢复回收站条目，并刷新当前弹层列表 */
  async function handleRestoreItem(item: TrashItem) {
    setBusyItemId(item.id)
    try {
      await onRestoreItem(item.id)
      await loadItems()
    } catch (error) {
      await showSystemMessage(error instanceof Error ? error.message : '恢复失败', { kind: 'error' })
    } finally {
      setBusyItemId(null)
    }
  }

  /** 永久删除回收站条目，并刷新当前弹层列表 */
  async function handleDeleteItem(item: TrashItem) {
    const isConfirmed = await confirmSystemAction(`永久删除「${item.originalPath}」？此操作不可撤销。`, {
      confirmLabel: '永久删除',
      cancelLabel: '取消',
      kind: 'warning',
    })
    if (!isConfirmed) return

    setBusyItemId(item.id)
    try {
      await onDeleteItem(item.id)
      await loadItems()
    } catch (error) {
      await showSystemMessage(error instanceof Error ? error.message : '永久删除失败', { kind: 'error' })
    } finally {
      setBusyItemId(null)
    }
  }

  return createPortal(
    <div className="command-overlay" role="dialog" aria-modal="true" aria-label="回收站">
      <div className="command-backdrop" onClick={onClose} />
      <section className="command-panel trash-panel">
        <header className="trash-header">
          <div className="trash-header-copy">
            <Trash2 className="trash-header-icon" aria-hidden />
            <div>
              <h2 className="trash-title">回收站</h2>
              <p className="trash-subtitle">保留 30 天</p>
            </div>
          </div>
          <button type="button" className="trash-close-button" onClick={onClose} aria-label="关闭回收站">
            <X aria-hidden />
          </button>
        </header>
        <div className="command-results trash-results">
          {isLoading ? <div className="command-empty">正在读取回收站...</div> : null}
          {!isLoading && errorMessage ? <div className="command-empty">{errorMessage}</div> : null}
          {!isLoading && !errorMessage && items.length === 0 ? (
            <div className="command-empty">回收站为空</div>
          ) : null}
          {!isLoading && !errorMessage
            ? items.map((item) => {
                const isBusy = busyItemId === item.id
                const Icon = item.kind === 'directory' ? Folder : FileText

                return (
                  <div key={item.id} className="trash-row">
                    <Icon className="trash-row-icon" aria-hidden />
                    <span className="trash-row-main">
                      <span className="trash-row-title">{getTrashItemTitle(item)}</span>
                      <span className="trash-row-meta">
                        {item.originalPath} · 删除于 {formatTrashDate(item.deletedAt)} · 剩余 {getTrashRemainingDays(item)} 天
                      </span>
                    </span>
                    <span className="trash-row-actions">
                      <button
                        type="button"
                        className="trash-action-button"
                        disabled={isBusy || Boolean(busyItemId)}
                        onClick={() => void handleRestoreItem(item)}
                      >
                        <RotateCcw aria-hidden />
                        恢复
                      </button>
                      <button
                        type="button"
                        className="trash-action-button danger"
                        disabled={isBusy || Boolean(busyItemId)}
                        onClick={() => void handleDeleteItem(item)}
                      >
                        <Trash2 aria-hidden />
                        永久删除
                      </button>
                    </span>
                  </div>
                )
              })
            : null}
        </div>
      </section>
    </div>,
    document.body
  )
}
