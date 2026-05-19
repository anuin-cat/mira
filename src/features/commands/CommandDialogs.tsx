import { FileText, Search, Settings2, TerminalSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CommandDefinition, CommandId } from './commandRegistry'
import { filterCommands, getCommandShortcut } from './commandRegistry'
import {
  collectVaultFiles,
  filterVaultFiles,
  getVaultSearchHint,
  isVaultBodySearchQueryTooShort,
  prepareVaultSearch,
  searchVaultNotes,
  type PreparedVaultSearch,
  type VaultFileItem,
  type VaultSearchMatch,
  type VaultSearchResult,
} from '../vault/search'
import type { VaultTreeNode } from '../../domain/note'
import { isImeComposing } from '../../lib/keyboard'
import './commands.css'

interface DialogShellProps {
  title: string
  placeholder: string
  query: string
  onQueryChange: (query: string) => void
  onClose: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  children: ReactNode
}

interface CommandPaletteProps {
  isOpen: boolean
  commands: CommandDefinition[]
  onClose: () => void
  onRunCommand: (commandId: CommandId) => void
}

interface QuickOpenDialogProps {
  isOpen: boolean
  treeData: VaultTreeNode[]
  activePath: string | null
  onClose: () => void
  onOpenFile: (path: string) => void
}

interface VaultSearchDialogProps {
  isOpen: boolean
  vaultPath: string | null
  treeData: VaultTreeNode[]
  onClose: () => void
  onOpenFile: (path: string, match: VaultSearchMatch | null) => void
}

/** 命令弹层共用外壳 */
function DialogShell({
  title,
  placeholder,
  query,
  onQueryChange,
  onClose,
  onKeyDown,
  children,
}: DialogShellProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  return createPortal(
    <div className="command-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="command-backdrop" onClick={onClose} />
      <section className="command-panel">
        <header className="command-header">
          <Search className="command-header-icon" aria-hidden />
          <input
            ref={inputRef}
            className="command-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
          />
        </header>
        <div className="command-results">{children}</div>
      </section>
    </div>,
    document.body
  )
}

/** 命令面板 */
export function CommandPalette({ isOpen, commands, onClose, onRunCommand }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const results = useMemo(() => filterCommands(query, commands), [commands, query])

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!isOpen) return null

  /** 处理命令面板键盘选择 */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isImeComposing(event)) return

    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter' && results[selectedIndex]) {
      event.preventDefault()
      const command = results[selectedIndex]
      onClose()
      onRunCommand(command.id)
    }
  }

  return (
    <DialogShell
      title="命令面板"
      placeholder="搜索命令"
      query={query}
      onQueryChange={setQuery}
      onClose={onClose}
      onKeyDown={handleKeyDown}
    >
      {results.length > 0 ? (
        results.map((command, index) => {
          const shortcut = getCommandShortcut(command)

          return (
            <button
              key={command.id}
              type="button"
              className={`command-result-row${index === selectedIndex ? ' active' : ''}`}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => {
                onClose()
                onRunCommand(command.id)
              }}
            >
              <TerminalSquare className="command-result-icon" aria-hidden />
              <span className="command-result-main">
                <span className="command-result-title">{command.title}</span>
                <span className="command-result-meta">{command.group}</span>
              </span>
              {shortcut ? <span className="command-shortcut">{shortcut}</span> : null}
            </button>
          )
        })
      ) : (
        <div className="command-empty">没有匹配的命令</div>
      )}
    </DialogShell>
  )
}

/** 快速打开文件弹层 */
export function QuickOpenDialog({
  isOpen,
  treeData,
  activePath,
  onClose,
  onOpenFile,
}: QuickOpenDialogProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const files = useMemo(() => collectVaultFiles(treeData), [treeData])
  const results = useMemo(() => filterVaultFiles(files, query), [files, query])

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!isOpen) return null

  /** 打开当前选中的快速打开结果 */
  function openSelectedFile(file: VaultFileItem | undefined) {
    if (!file) return
    onClose()
    onOpenFile(file.path)
  }

  /** 处理快速打开键盘选择 */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isImeComposing(event)) return

    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      openSelectedFile(results[selectedIndex])
    }
  }

  return (
    <DialogShell
      title="快速打开"
      placeholder="搜索文件"
      query={query}
      onQueryChange={setQuery}
      onClose={onClose}
      onKeyDown={handleKeyDown}
    >
      {results.length > 0 ? (
        results.map((file, index) => (
          <button
            key={file.path}
            type="button"
            className={`command-result-row${index === selectedIndex ? ' active' : ''}${file.path === activePath ? ' current' : ''}`}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => openSelectedFile(file)}
          >
            <FileText className="command-result-icon" aria-hidden />
            <span className="command-result-main">
              <span className="command-result-title">{file.title}</span>
              <span className="command-result-meta">{file.path}</span>
            </span>
          </button>
        ))
      ) : (
        <div className="command-empty">没有匹配的文件</div>
      )}
    </DialogShell>
  )
}

/** 全 Vault 搜索弹层 */
export function VaultSearchDialog({
  isOpen,
  vaultPath,
  treeData,
  onClose,
  onOpenFile,
}: VaultSearchDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<VaultSearchResult[]>([])
  const [preparedSearch, setPreparedSearch] = useState<PreparedVaultSearch | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isPreparing, setIsPreparing] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const prepareRequestIdRef = useRef(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setResults([])
      setPreparedSearch(null)
      setSelectedIndex(0)
      setIsPreparing(false)
      setIsSearching(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !vaultPath) {
      prepareRequestIdRef.current += 1
      setPreparedSearch(null)
      setIsPreparing(false)
      return
    }

    const requestId = prepareRequestIdRef.current + 1
    prepareRequestIdRef.current = requestId
    setIsPreparing(true)
    setResults([])

    prepareVaultSearch(vaultPath, treeData)
      .then((nextPreparedSearch) => {
        if (prepareRequestIdRef.current !== requestId) return
        setPreparedSearch(nextPreparedSearch)
      })
      .catch(() => {
        if (prepareRequestIdRef.current !== requestId) return
        setPreparedSearch(null)
      })
      .finally(() => {
        if (prepareRequestIdRef.current === requestId) setIsPreparing(false)
      })
  }, [isOpen, treeData, vaultPath])

  useEffect(() => {
    if (!isOpen || isPreparing || !preparedSearch || !vaultPath || !query.trim()) {
      requestIdRef.current += 1
      setResults([])
      setIsSearching(false)
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setIsSearching(true)

    const timerId = window.setTimeout(() => {
      searchVaultNotes(vaultPath, preparedSearch, query, {
        shouldCancel: () => requestIdRef.current !== requestId,
      })
        .then((nextResults) => {
          if (requestIdRef.current !== requestId) return
          setResults(nextResults)
          setSelectedIndex(0)
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return
          setResults([])
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setIsSearching(false)
        })
    }, 120)

    return () => window.clearTimeout(timerId)
  }, [isOpen, isPreparing, preparedSearch, query, vaultPath])

  if (!isOpen) return null

  const isBodyQueryTooShort =
    Boolean(preparedSearch && preparedSearch.mode !== 'indexed' && query.trim() && isVaultBodySearchQueryTooShort(query))

  /** 优先使用正文命中，路径命中只负责打开文件 */
  function getPrimaryMatch(result: VaultSearchResult): VaultSearchMatch | null {
    return result.matches.find((match) => match.kind === 'content') ?? result.matches[0] ?? null
  }

  /** 打开当前选中的全文搜索结果 */
  function openSelectedResult(result: VaultSearchResult | undefined) {
    if (!result) return
    onClose()
    onOpenFile(result.path, getPrimaryMatch(result))
  }

  /** 处理全库搜索键盘选择 */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isImeComposing(event)) return

    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      openSelectedResult(results[selectedIndex])
    }
  }

  return (
    <DialogShell
      title="全 Vault 搜索"
      placeholder="搜索文件名或内容"
      query={query}
      onQueryChange={setQuery}
      onClose={onClose}
      onKeyDown={handleKeyDown}
    >
      {isPreparing ? <div className="command-empty">正在准备搜索...</div> : null}
      {!isPreparing && isSearching ? <div className="command-empty">搜索中...</div> : null}
      {!isPreparing && !isSearching && query.trim() && !isBodyQueryTooShort && results.length === 0 ? (
        <div className="command-empty">没有匹配的内容</div>
      ) : null}
      {!isPreparing && !query.trim() ? (
        <div className="command-empty">{getVaultSearchHint(preparedSearch, query)}</div>
      ) : null}
      {!isPreparing && isBodyQueryTooShort ? (
        <div className="command-empty">{getVaultSearchHint(preparedSearch, query)}</div>
      ) : null}
      {results.map((result, index) => (
        <button
          key={result.path}
          type="button"
          className={`command-result-row command-result-row-tall${index === selectedIndex ? ' active' : ''}`}
          onMouseEnter={() => setSelectedIndex(index)}
          onClick={() => openSelectedResult(result)}
        >
          <Settings2 className="command-result-icon" aria-hidden />
          <span className="command-result-main">
            <span className="command-result-title">{result.title}</span>
            <span className="command-result-meta">{result.path}</span>
            <span className="command-result-snippet">
              {getPrimaryMatch(result)?.lineNumber ? `第 ${getPrimaryMatch(result)?.lineNumber} 行 · ` : ''}
              {getPrimaryMatch(result)?.snippet ?? ''}
            </span>
          </span>
        </button>
      ))}
    </DialogShell>
  )
}
