import type { GitChangedFile, GitDiffMode, GitStatusResult } from '../../domain/git'

export const REMOTE_RECONNECT_ERROR_MARKERS = [
  'could not read from remote repository',
  'does not appear to be a git repository',
  'authentication failed',
  'permission denied',
  'access denied',
  'not authorized',
  'the requested url returned error: 403',
  'the requested url returned error: 404',
  'no such remote',
  'no configured push destination',
]
export const REMOTE_RECONNECT_MESSAGE =
  '远端仓库可能已删除、不可访问，或当前 Git 凭据没有权限。可以重新在 GitHub 创建仓库，然后把新的 remote URL 粘贴到这里。'
export const MISSING_REMOTE_PUSH_MESSAGE = '目前没有连接远端。点击右上角“连接远端”按钮连接后，再 Push。'
export const COMMIT_INPUT_MIN_LINES = 2
export const COMMIT_INPUT_MAX_LINES = 3

export type GitPanelAction = 'connect-remote' | 'stage-all' | 'commit' | 'push'

export interface GitPanelRequest {
  id: number
  action: GitPanelAction
}

export interface RunOperationOptions {
  onSuccess?: (status: GitStatusResult) => void | Promise<void>
  onError?: (message: string) => void
}

export interface GitToastState {
  id: number
  message: string
  variant: 'success' | 'warning'
}

/** 从未知异常中提取可展示消息 */
export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : 'Git 操作失败'
}

/** 判断 Git 错误是否适合引导用户重新连接远端 */
export function shouldOfferRemoteReconnect(message: string): boolean {
  const normalized = message.toLowerCase()
  if (normalized.includes('repository') && normalized.includes('not found')) return true
  if (normalized.includes('remote') && normalized.includes('not found')) return true
  return REMOTE_RECONNECT_ERROR_MARKERS.some((marker) => normalized.includes(marker))
}

/** 将 Git 状态转换为短标签 */
export function getFileStatusLabel(file: GitChangedFile): string {
  if (file.kind === 'untracked') return '新增'
  if (file.kind === 'added') return '新增'
  if (file.kind === 'deleted') return '删除'
  if (file.kind === 'renamed') return '重命名'
  if (file.kind === 'conflicted') return '冲突'
  return '修改'
}

/** 读取指定分组下的行数变化 */
export function getFileLineStats(file: GitChangedFile, mode: GitDiffMode) {
  return mode === 'staged'
    ? { additions: file.stagedAdditions, deletions: file.stagedDeletions }
    : { additions: file.unstagedAdditions, deletions: file.unstagedDeletions }
}

/** 获取行数变化的颜色状态 */
export function getLineStatClassName(value: number, kind: 'addition' | 'deletion'): string {
  if (value === 0) return 'muted'
  return kind
}

/** 获取当前文件默认 diff 视图 */
export function getDefaultDiffMode(file: GitChangedFile | null): GitDiffMode {
  if (!file) return 'unstaged'
  if (file.isUnstaged) return 'unstaged'
  return 'staged'
}

/** 生成 Git 面板标题下方的仓库摘要 */
export function getGitStatusSummary(
  status: GitStatusResult | null,
  isWaitingForFirstStatus: boolean,
  isRefreshingStatus: boolean
) {
  if (isWaitingForFirstStatus) return '正在读取 Git 状态...'
  return `${status?.branch ? status.branch : 'Vault 备份'}${status?.remoteUrl ? ' · origin' : ''}${
    status?.ahead ? ` · ahead ${status.ahead}` : ''
  }${status?.behind ? ` · behind ${status.behind}` : ''}${isRefreshingStatus ? ' · 正在刷新' : ''}`
}
