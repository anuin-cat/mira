import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { isImeComposing } from '../../lib/keyboard'
import type { EditorSearchSelectionResult } from './currentFileSearch'

const SEARCH_SYNC_DELAY_MS = 160

export interface EditorSearchControlsHandle {
  openSearch: () => void
  closeSearch: () => void
}

interface EditorSearchControlsProps {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  onSelectMatch: (query: string, matchOrdinal: number) => EditorSearchSelectionResult
}

/** MDXEditor 当前文件搜索条 */
export const EditorSearchControls = forwardRef<EditorSearchControlsHandle, EditorSearchControlsProps>(function EditorSearchControls(
  { isOpen, onOpen, onClose, onSelectMatch },
  ref
) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draftSearch, setDraftSearch] = useState('')
  const [resultCount, setResultCount] = useState(0)
  const [currentCursor, setCurrentCursor] = useState(0)
  const syncTimerRef = useRef<number | null>(null)
  const draftSearchRef = useRef('')
  const selectedOrdinalRef = useRef(0)
  const isComposingRef = useRef(false)

  /** 清理待同步搜索，避免关闭搜索框后继续触发重型搜索 */
  function clearPendingSearchSync() {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
  }

  /** 执行当前文件搜索并同步结果计数 */
  function applySearch(nextSearch: string, matchOrdinal: number) {
    const result = onSelectMatch(nextSearch, matchOrdinal)
    const nextOrdinal = result.cursor > 0 ? result.cursor - 1 : 0
    selectedOrdinalRef.current = nextOrdinal
    setResultCount(result.total)
    setCurrentCursor(result.cursor)
    return result
  }

  /** 延迟搜索，让输入框保持即时响应 */
  function scheduleSearchSync(nextSearch: string, matchOrdinal = 0) {
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current)
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null
      applySearch(nextSearch, matchOrdinal)
    }, SEARCH_SYNC_DELAY_MS)
  }

  /** 立即同步搜索词，用于 Enter / 上下一个按钮这类显式导航 */
  function flushSearchSync(nextSearch = draftSearchRef.current, matchOrdinal = selectedOrdinalRef.current) {
    clearPendingSearchSync()
    return applySearch(nextSearch, matchOrdinal)
  }

  /** 关闭当前文件搜索条 */
  function handleCloseSearch() {
    clearPendingSearchSync()
    applySearch('', 0)
    onClose()
  }

  /** 搜索词变化时先更新本地输入，再把搜索工作延后 */
  function handleSearchChange(nextSearch: string) {
    draftSearchRef.current = nextSearch
    setDraftSearch(nextSearch)
    selectedOrdinalRef.current = 0
    setCurrentCursor(0)
    setResultCount(0)
    if (!nextSearch) {
      clearPendingSearchSync()
      applySearch('', 0)
      return
    }
    if (!isComposingRef.current) scheduleSearchSync(nextSearch)
  }

  /** 按当前输入词跳转到上一个或下一个命中 */
  function handleNavigate(direction: 'prev' | 'next') {
    const nextOrdinal = direction === 'prev' ? selectedOrdinalRef.current - 1 : selectedOrdinalRef.current + 1
    flushSearchSync(draftSearchRef.current, nextOrdinal)
  }

  useImperativeHandle(ref, () => ({
    openSearch() {
      onOpen()
      window.requestAnimationFrame(() => {
        inputRef.current?.focus()
        if (draftSearchRef.current) applySearch(draftSearchRef.current, selectedOrdinalRef.current)
      })
    },
    closeSearch() {
      handleCloseSearch()
    },
  }))

  useEffect(() => {
    if (isOpen) window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [isOpen])

  useEffect(() => {
    if (isOpen) return
    clearPendingSearchSync()
    applySearch('', 0)
  }, [isOpen])

  useEffect(() => () => {
    clearPendingSearchSync()
    onSelectMatch('', 0)
  }, [onSelectMatch])

  if (!isOpen) return null

  return (
    <div className="fixed right-4 top-12 z-[90] flex h-9 max-w-[calc(100vw-2rem)] items-center gap-1 rounded-lg border border-[color:var(--theme-border-primary)] bg-[color:var(--theme-bg-primary)] px-2 shadow-[0_12px_32px_color-mix(in_srgb,var(--theme-text-primary)_20%,transparent_80%)]">
      <Search className="size-4 shrink-0 text-[color:var(--theme-text-secondary)]" aria-hidden />
      <input
        ref={inputRef}
        className="h-7 w-[min(260px,42vw)] min-w-0 bg-transparent text-sm text-[color:var(--theme-text-primary)] outline-none placeholder:text-[color:var(--theme-text-secondary)]"
        value={draftSearch}
        onChange={(event) => handleSearchChange(event.target.value)}
        onCompositionStart={() => {
          isComposingRef.current = true
          clearPendingSearchSync()
        }}
        onCompositionEnd={(event) => {
          isComposingRef.current = false
          handleSearchChange(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            handleCloseSearch()
          }
          if (event.key === 'Enter') {
            if (isImeComposing(event)) return
            event.preventDefault()
            if (event.shiftKey) {
              handleNavigate('prev')
            } else {
              handleNavigate('next')
            }
          }
        }}
        placeholder="查找当前文件"
      />
      <span className="min-w-10 text-center text-[11px] text-[color:var(--theme-text-secondary)]">
        {resultCount > 0 ? `${currentCursor}/${resultCount}` : '0/0'}
      </span>
      <button
        type="button"
        className="grid size-7 place-items-center rounded-md text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-hover-bg)]"
        onClick={() => handleNavigate('prev')}
        aria-label="上一个"
      >
        <ChevronUp className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className="grid size-7 place-items-center rounded-md text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-hover-bg)]"
        onClick={() => handleNavigate('next')}
        aria-label="下一个"
      >
        <ChevronDown className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className="grid size-7 place-items-center rounded-md text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-hover-bg)]"
        onClick={handleCloseSearch}
        aria-label="关闭查找"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
})
