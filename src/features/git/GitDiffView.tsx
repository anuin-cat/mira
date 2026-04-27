import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseGitDiff, type GitDiffVisualLine } from './gitDiffParser'
import './git-diff-view.css'

interface GitDiffViewProps {
  diff: string
  emptyState: string
  isLoading: boolean
  isTruncated: boolean
}

/** 渲染结构化 Git diff，突出新增、删除与 hunk 边界。 */
export function GitDiffView({ diff, emptyState, isLoading, isTruncated }: GitDiffViewProps) {
  const parsedDiff = useMemo(() => parseGitDiff(diff), [diff])

  if (isLoading) {
    return <div className="git-diff-state">正在读取 diff...</div>
  }

  if (!diff.trim()) {
    return <div className="git-diff-state">{emptyState}</div>
  }

  return (
    <div className="git-diff-scroll">
      <div className="git-diff-document">
        {isTruncated ? (
          <div className="git-diff-truncated-banner">
            <AlertTriangle aria-hidden />
            <span>当前 diff 过长，只显示了前一部分内容。</span>
          </div>
        ) : null}

        {parsedDiff.metaLines.length ? (
          <section className="git-diff-meta-block" aria-label="Diff 文件信息">
            {parsedDiff.metaLines.map((line, index) => (
              <div key={`meta-${index}`} className="git-diff-meta-line">
                {line}
              </div>
            ))}
          </section>
        ) : null}

        {parsedDiff.hunks.map((hunk) => (
          <section key={hunk.id} className="git-diff-hunk">
            <header className="git-diff-hunk-header">{hunk.header}</header>
            <div className="git-diff-hunk-body">
              {hunk.lines.map((line) => (
                <DiffLineRow key={line.id} line={line} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

/** 渲染一行 diff，并显示行号与行内变化。 */
function DiffLineRow({ line }: { line: GitDiffVisualLine }) {
  return (
    <div className={cn('git-diff-line', `git-diff-line-${line.kind}`)}>
      <span className="git-diff-line-sign" aria-hidden>
        {getLineSign(line.kind)}
      </span>
      <span className="git-diff-line-number">{formatLineNumber(line.oldLineNumber)}</span>
      <span className="git-diff-line-number">{formatLineNumber(line.newLineNumber)}</span>
      <span className="git-diff-line-content">
        {line.segments.map((segment, index) => (
          <span
            key={`${line.id}-${index}`}
            className={cn('git-diff-inline-segment', segment.isChanged && 'is-changed')}
          >
            {segment.text}
          </span>
        ))}
      </span>
    </div>
  )
}

/** 根据 diff 行类型返回左侧符号。 */
function getLineSign(kind: GitDiffVisualLine['kind']): string {
  if (kind === 'addition') return '+'
  if (kind === 'deletion') return '-'
  if (kind === 'note') return '\\'
  return ' '
}

/** 将空行号转成占位，避免视觉跳动。 */
function formatLineNumber(value: number | null): string {
  return value === null ? '' : String(value)
}
