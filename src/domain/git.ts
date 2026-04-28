export type GitFileChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export type GitDiffMode = 'staged' | 'unstaged'

/** Git 文件变更摘要，path 始终是 vault 内相对路径 */
export interface GitChangedFile {
  path: string
  oldPath: string | null
  indexStatus: string
  worktreeStatus: string
  kind: GitFileChangeKind
  isStaged: boolean
  isUnstaged: boolean
  stagedAdditions: number
  stagedDeletions: number
  unstagedAdditions: number
  unstagedDeletions: number
  additions: number
  deletions: number
}

/** Git 状态读取过程中的单个耗时节点 */
export interface GitTimingStep {
  id: string
  label: string
  durationMs: number
}

/** Git 状态读取过程的后端耗时摘要 */
export interface GitStatusTiming {
  totalMs: number
  steps: GitTimingStep[]
}

/** 当前 vault 的 Git 仓库状态 */
export interface GitStatusResult {
  isGitRepository: boolean
  isVaultGitRoot: boolean
  repositoryProblem: string | null
  branch: string | null
  remoteUrl: string | null
  upstream: string | null
  ahead: number
  behind: number
  hasHead: boolean
  changedFiles: GitChangedFile[]
  timing: GitStatusTiming | null
}

/** 单文件 diff 内容 */
export interface GitDiffResult {
  path: string
  mode: GitDiffMode
  diff: string
  isTruncated: boolean
}

/** 写操作后的输出与最新状态 */
export interface GitOperationResult {
  status: GitStatusResult
  stdout: string
  stderr: string
}

/** agent 只读命令执行结果 */
export interface GitReadonlyResult {
  commandId: string
  stdout: string
  stderr: string
  code: number
  isTruncated: boolean
}
