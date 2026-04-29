import { type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react'
import type { GitChangedFile, GitDiffMode } from '../../domain/git'
import {
  getFileLineStats,
  getFileStatusLabel,
  getLineStatClassName,
} from './gitPanelModel'

interface GitChangeListProps {
  isWaitingForFirstStatus: boolean
  changedFileCount: number
  canUseGit: boolean
  isOperating: boolean
  stagedFiles: GitChangedFile[]
  unstagedFiles: GitChangedFile[]
  selectedPath: string | null
  diffMode: GitDiffMode
  isStagedOpen: boolean
  isUnstagedOpen: boolean
  onToggleStagedOpen: () => void
  onToggleUnstagedOpen: () => void
  onSelectFile: (file: GitChangedFile, mode: GitDiffMode) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
}

/** Git 变更文件列表，负责分组、选择和 stage/unstage 行操作 */
export function GitChangeList({
  isWaitingForFirstStatus,
  changedFileCount,
  canUseGit,
  isOperating,
  stagedFiles,
  unstagedFiles,
  selectedPath,
  diffMode,
  isStagedOpen,
  isUnstagedOpen,
  onToggleStagedOpen,
  onToggleUnstagedOpen,
  onSelectFile,
  onStage,
  onUnstage,
}: GitChangeListProps) {
  /** 支持键盘选择变更文件 */
  function handleChangeRowKeyDown(event: KeyboardEvent<HTMLDivElement>, file: GitChangedFile, mode: GitDiffMode) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelectFile(file, mode)
  }

  /** 渲染单行文件变更，保持列表紧凑 */
  function renderChangeRow(file: GitChangedFile, mode: GitDiffMode) {
    const stats = getFileLineStats(file, mode)
    const isSelected = file.path === selectedPath && diffMode === mode
    const action =
      mode === 'staged'
        ? {
            icon: <Minus aria-hidden />,
            label: `Unstage ${file.path}`,
            handler: () => onUnstage([file.path]),
            disabled: isOperating,
          }
        : {
            icon: <Plus aria-hidden />,
            label: `Stage ${file.path}`,
            handler: () => onStage([file.path]),
            disabled: isOperating,
          }

    return (
      <div
        key={`${mode}:${file.path}`}
        className={`git-change-row${isSelected ? ' active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelectFile(file, mode)}
        onKeyDown={(event) => handleChangeRowKeyDown(event, file, mode)}
      >
        <span className="git-change-path" title={file.path}>
          {file.path}
        </span>
        <span className="git-change-stats">
          <span className={getLineStatClassName(stats.additions, 'addition')}>+{stats.additions}</span>
          <span className={getLineStatClassName(stats.deletions, 'deletion')}>-{stats.deletions}</span>
        </span>
        <span className={`git-change-kind ${file.kind}`}>{getFileStatusLabel(file)}</span>
        <button
          type="button"
          className="git-change-row-action"
          onClick={(event) => {
            event.stopPropagation()
            action.handler()
          }}
          disabled={action.disabled}
          aria-label={action.label}
          title={action.label}
        >
          {action.icon}
        </button>
      </div>
    )
  }

  if (isWaitingForFirstStatus) {
    return <div className="git-empty loading">正在读取变更列表...</div>
  }

  if (!changedFileCount) {
    return <div className="git-empty">没有未提交变更</div>
  }

  return (
    <>
      <section className="git-change-group">
        <header className="git-change-group-header">
          <button type="button" className="git-change-group-toggle" onClick={onToggleStagedOpen}>
            {isStagedOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            <span>Staged</span>
            <span>{stagedFiles.length}</span>
          </button>
          <button
            type="button"
            className="git-change-group-action"
            onClick={() => onUnstage([])}
            disabled={!canUseGit || isOperating || stagedFiles.length === 0}
            aria-label="Unstage 全部 staged 变更"
            title="Unstage 全部"
          >
            <Minus aria-hidden />
          </button>
        </header>
        {isStagedOpen ? (
          <div className="git-change-group-list">
            {stagedFiles.length ? (
              stagedFiles.map((file) => renderChangeRow(file, 'staged'))
            ) : (
              <div className="git-change-group-empty">没有 staged 文件</div>
            )}
          </div>
        ) : null}
      </section>

      <section className="git-change-group">
        <header className="git-change-group-header">
          <button type="button" className="git-change-group-toggle" onClick={onToggleUnstagedOpen}>
            {isUnstagedOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            <span>未 staged</span>
            <span>{unstagedFiles.length}</span>
          </button>
          <button
            type="button"
            className="git-change-group-action"
            onClick={() => onStage([])}
            disabled={!canUseGit || isOperating || unstagedFiles.length === 0}
            aria-label="Stage 全部未 staged 变更"
            title="Stage 全部"
          >
            <Plus aria-hidden />
          </button>
        </header>
        {isUnstagedOpen ? (
          <div className="git-change-group-list">
            {unstagedFiles.length ? (
              unstagedFiles.map((file) => renderChangeRow(file, 'unstaged'))
            ) : (
              <div className="git-change-group-empty">没有未 staged 变更</div>
            )}
          </div>
        ) : null}
      </section>
    </>
  )
}
