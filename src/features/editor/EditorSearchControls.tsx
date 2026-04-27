import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useEditorSearch } from '@mdxeditor/editor'

export interface EditorSearchControlsHandle {
  openSearch: () => void
}

/** MDXEditor 当前文件搜索条 */
export const EditorSearchControls = forwardRef<EditorSearchControlsHandle>(function EditorSearchControls(
  _props,
  ref
) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const {
    closeSearch,
    cursor,
    isSearchOpen,
    next,
    openSearch,
    prev,
    search,
    setSearch,
    total,
  } = useEditorSearch()

  useImperativeHandle(ref, () => ({
    openSearch() {
      openSearch()
      window.requestAnimationFrame(() => inputRef.current?.focus())
    },
  }))

  useEffect(() => {
    if (isSearchOpen) window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [isSearchOpen])

  if (!isSearchOpen) return null

  return (
    <div className="fixed right-4 top-12 z-[90] flex h-9 max-w-[calc(100vw-2rem)] items-center gap-1 rounded-lg border border-[color:var(--theme-border-primary)] bg-[color:var(--theme-bg-primary)] px-2 shadow-[0_12px_32px_color-mix(in_srgb,var(--theme-text-primary)_20%,transparent_80%)]">
      <Search className="size-4 shrink-0 text-[color:var(--theme-text-secondary)]" aria-hidden />
      <input
        ref={inputRef}
        className="h-7 w-[min(260px,42vw)] min-w-0 bg-transparent text-sm text-[color:var(--theme-text-primary)] outline-none placeholder:text-[color:var(--theme-text-secondary)]"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeSearch()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) {
              prev()
            } else {
              next()
            }
          }
        }}
        placeholder="查找当前文件"
      />
      <span className="min-w-10 text-center text-[11px] text-[color:var(--theme-text-secondary)]">
        {total > 0 ? `${cursor}/${total}` : '0/0'}
      </span>
      <button
        type="button"
        className="grid size-7 place-items-center rounded-md text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-hover-bg)]"
        onClick={prev}
        aria-label="上一个"
      >
        <ChevronUp className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className="grid size-7 place-items-center rounded-md text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-hover-bg)]"
        onClick={next}
        aria-label="下一个"
      >
        <ChevronDown className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className="grid size-7 place-items-center rounded-md text-[color:var(--theme-text-secondary)] hover:bg-[color:var(--theme-hover-bg)]"
        onClick={closeSearch}
        aria-label="关闭查找"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
})
