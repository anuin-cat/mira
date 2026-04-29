import type { RefObject } from 'react'
import { Check, ExternalLink, GitBranch, Loader2, Minus, Plus, RotateCcw, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { GitChangedFile, GitStatusResult } from '../../domain/git'
import { COMMIT_INPUT_MIN_LINES } from './gitPanelModel'

interface GitSetupBandProps {
  status: GitStatusResult
  isOperating: boolean
  onInitLocalRepository: () => void
}

interface GitRemoteSetupProps {
  remoteRecoveryMessage: string | null
  remoteUrl: string
  remoteInputRef: RefObject<HTMLInputElement | null>
  isOperating: boolean
  onClose: () => void
  onOpenGitHubNewRepository: () => void
  onConnectRemote: () => void
  onRemoteUrlChange: (value: string) => void
}

interface GitCommitBoxProps {
  commitInputRef: RefObject<HTMLTextAreaElement | null>
  commitMessage: string
  canUseGit: boolean
  isOperating: boolean
  stagedCount: number
  onCommitMessageChange: (value: string) => void
  onCommit: () => void
  onPush: () => void
}

interface GitDiffToolbarProps {
  isWaitingForFirstStatus: boolean
  selectedFile: GitChangedFile | null
  selectedLineStats: { additions: number; deletions: number } | null
  shouldShowStageButton: boolean
  shouldShowDiscardButton: boolean
  shouldShowUnstageButton: boolean
  isOperating: boolean
  onStageSelected: () => void
  onDiscardSelected: () => void
  onUnstageSelected: () => void
}

/** 非仓库或根目录不匹配时展示本地初始化入口 */
export function GitSetupBand({ status, isOperating, onInitLocalRepository }: GitSetupBandProps) {
  return (
    <section className="git-setup-band">
      <div>
        <h3>{status.isGitRepository ? 'Vault 不是仓库根目录' : '初始化本地 Git 仓库'}</h3>
        <p>
          {status.repositoryProblem ??
            '本地初始化只会在 vault 根目录执行 git init，并默认忽略 .mira/。远端仓库可以之后再连接。'}
        </p>
      </div>
      {!status.repositoryProblem ? (
        <div className="git-setup-actions">
          <Button className="git-local-init-button" onClick={onInitLocalRepository} disabled={isOperating}>
            {isOperating ? <Loader2 className="git-spin" aria-hidden /> : <GitBranch aria-hidden />}
            本地初始化
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/** 远端连接表单，集中处理 GitHub 新仓库入口和 remote URL 输入 */
export function GitRemoteSetup({
  remoteRecoveryMessage,
  remoteUrl,
  remoteInputRef,
  isOperating,
  onClose,
  onOpenGitHubNewRepository,
  onConnectRemote,
  onRemoteUrlChange,
}: GitRemoteSetupProps) {
  return (
    <section className="git-remote-band">
      <div className="git-remote-heading">
        <div className="git-remote-heading-text">
          <h3>连接 GitHub 远端</h3>
          <p>先在 GitHub 网页创建一个空仓库，再把仓库地址粘贴到这里；Mira 只会执行本地 git remote 与 git push。</p>
        </div>
        <Button
          className="git-remote-close-button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="收起连接远端"
        >
          <X aria-hidden />
        </Button>
      </div>
      {remoteRecoveryMessage ? <div className="git-remote-recovery">{remoteRecoveryMessage}</div> : null}
      <div className="git-remote-actions">
        <Button variant="outline" onClick={onOpenGitHubNewRepository} disabled={isOperating}>
          <ExternalLink aria-hidden />
          打开 GitHub 新建仓库
        </Button>
      </div>
      <div className="git-remote-row">
        <Input
          ref={remoteInputRef}
          value={remoteUrl}
          onChange={(event) => onRemoteUrlChange(event.target.value)}
          placeholder="https://github.com/you/repo.git 或 git@github.com:you/repo.git"
        />
        <Button variant="outline" onClick={onConnectRemote} disabled={isOperating || !remoteUrl.trim()}>
          连接远端
        </Button>
      </div>
    </section>
  )
}

/** Git 提交与 push 操作区 */
export function GitCommitBox({
  commitInputRef,
  commitMessage,
  canUseGit,
  isOperating,
  stagedCount,
  onCommitMessageChange,
  onCommit,
  onPush,
}: GitCommitBoxProps) {
  return (
    <section className="git-commit-box">
      <div className="git-commit-row">
        <Textarea
          ref={commitInputRef}
          value={commitMessage}
          onChange={(event) => onCommitMessageChange(event.target.value)}
          placeholder="Commit message"
          rows={COMMIT_INPUT_MIN_LINES}
          className="git-commit-input"
        />
        <div className="git-commit-actions">
          <Button size="sm" onClick={onCommit} disabled={!canUseGit || isOperating || stagedCount === 0}>
            {isOperating ? <Loader2 className="git-spin" aria-hidden /> : <Check aria-hidden />}
            Commit
          </Button>
          <Button size="sm" variant="outline" onClick={onPush} disabled={!canUseGit || isOperating}>
            <Send aria-hidden />
            Push
          </Button>
        </div>
      </div>
    </section>
  )
}

/** Diff 区顶部文件信息与当前文件操作按钮 */
export function GitDiffToolbar({
  isWaitingForFirstStatus,
  selectedFile,
  selectedLineStats,
  shouldShowStageButton,
  shouldShowDiscardButton,
  shouldShowUnstageButton,
  isOperating,
  onStageSelected,
  onDiscardSelected,
  onUnstageSelected,
}: GitDiffToolbarProps) {
  return (
    <div className="git-diff-toolbar">
      <div className="git-selected-file">
        <span>{isWaitingForFirstStatus ? '正在读取变更列表...' : selectedFile?.path ?? '未选择文件'}</span>
        {selectedLineStats ? <span>+{selectedLineStats.additions} -{selectedLineStats.deletions}</span> : null}
      </div>
      <div className="git-diff-actions">
        {shouldShowStageButton ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onStageSelected}
            disabled={!selectedFile || isOperating}
          >
            <Plus aria-hidden />
            Stage
          </Button>
        ) : null}
        {shouldShowDiscardButton ? (
          <Button
            variant="outline"
            size="sm"
            className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
            onClick={onDiscardSelected}
            disabled={!selectedFile || isOperating}
          >
            <RotateCcw aria-hidden />
            撤销修改
          </Button>
        ) : null}
        {shouldShowUnstageButton ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onUnstageSelected}
            disabled={!selectedFile || isOperating}
          >
            <Minus aria-hidden />
            Unstage
          </Button>
        ) : null}
      </div>
    </div>
  )
}
