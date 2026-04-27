import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Link as LinkIcon,
  Loader2,
  Minus,
  Plus,
  RefreshCcw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { GitChangedFile, GitDiffMode, GitStatusResult } from '../../domain/git'
import {
  commitGitChanges,
  connectGitRemoteRepository,
  getGitDiff,
  getGitStatus,
  initLocalGitRepository,
  pushGitBranch,
  stageGitPaths,
  unstageGitPaths,
} from '../../services/gitService'
import './git-panel.css'

const REMOTE_RECONNECT_ERROR_MARKERS = [
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
const REMOTE_RECONNECT_MESSAGE =
  '远端仓库可能已删除、不可访问，或当前 Git 凭据没有权限。可以重新在 GitHub 创建仓库，然后把新的 remote URL 粘贴到这里。'
const MISSING_REMOTE_PUSH_MESSAGE = '目前没有连接远端。点击右上角“连接远端”按钮连接后，再 Push。'

export type GitPanelAction = 'connect-remote' | 'stage-all' | 'commit' | 'push'

export interface GitPanelRequest {
  id: number
  action: GitPanelAction
}

interface GitPanelProps {
  isOpen: boolean
  vaultPath: string
  request: GitPanelRequest | null
  onClose: () => void
  onBeforeWrite: () => Promise<void>
  onStatusChange: (status: GitStatusResult) => void
}

interface RunOperationOptions {
  onSuccess?: (status: GitStatusResult) => void
  onError?: (message: string) => void
}

/** 从未知异常中提取可展示消息 */
function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : 'Git 操作失败'
}

/** 判断 Git 错误是否适合引导用户重新连接远端 */
function shouldOfferRemoteReconnect(message: string): boolean {
  const normalized = message.toLowerCase()
  if (normalized.includes('repository') && normalized.includes('not found')) return true
  if (normalized.includes('remote') && normalized.includes('not found')) return true
  return REMOTE_RECONNECT_ERROR_MARKERS.some((marker) => normalized.includes(marker))
}

/** 将 Git 状态转换为短标签 */
function getFileStatusLabel(file: GitChangedFile): string {
  if (file.kind === 'untracked') return '新增'
  if (file.kind === 'added') return '新增'
  if (file.kind === 'deleted') return '删除'
  if (file.kind === 'renamed') return '重命名'
  if (file.kind === 'conflicted') return '冲突'
  return '修改'
}

/** 读取指定分组下的行数变化 */
function getFileLineStats(file: GitChangedFile, mode: GitDiffMode) {
  return mode === 'staged'
    ? { additions: file.stagedAdditions, deletions: file.stagedDeletions }
    : { additions: file.unstagedAdditions, deletions: file.unstagedDeletions }
}

/** 获取行数变化的颜色状态 */
function getLineStatClassName(value: number, kind: 'addition' | 'deletion'): string {
  if (value === 0) return 'muted'
  return kind
}

/** 获取当前文件默认 diff 视图 */
function getDefaultDiffMode(file: GitChangedFile | null): GitDiffMode {
  if (!file) return 'unstaged'
  if (file.isUnstaged) return 'unstaged'
  return 'staged'
}

/** 居中的 Git 操作面板 */
export function GitPanel({
  isOpen,
  vaultPath,
  request,
  onClose,
  onBeforeWrite,
  onStatusChange,
}: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<GitDiffMode>('unstaged')
  const [diff, setDiff] = useState('')
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [isLoadingDiff, setIsLoadingDiff] = useState(false)
  const [isOperating, setIsOperating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [isRemoteSetupOpen, setIsRemoteSetupOpen] = useState(false)
  const [remoteRecoveryMessage, setRemoteRecoveryMessage] = useState<string | null>(null)
  const [isUnstagedOpen, setIsUnstagedOpen] = useState(true)
  const [isStagedOpen, setIsStagedOpen] = useState(true)
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null)
  const remoteInputRef = useRef<HTMLInputElement | null>(null)
  const handledRequestIdRef = useRef<number | null>(null)
  const selectedPathRef = useRef<string | null>(null)
  const selectedDiffModeRef = useRef<GitDiffMode>('unstaged')
  const onStatusChangeRef = useRef(onStatusChange)

  const selectedFile = useMemo(
    () => status?.changedFiles.find((file) => file.path === selectedPath) ?? null,
    [selectedPath, status]
  )
  const stagedCount = status?.changedFiles.filter((file) => file.isStaged).length ?? 0
  const unstagedCount = status?.changedFiles.filter((file) => file.isUnstaged).length ?? 0
  const stagedFiles = useMemo(() => status?.changedFiles.filter((file) => file.isStaged) ?? [], [status])
  const unstagedFiles = useMemo(() => status?.changedFiles.filter((file) => file.isUnstaged) ?? [], [status])
  const selectedLineStats = selectedFile ? getFileLineStats(selectedFile, diffMode) : null
  const canUseGit = Boolean(status?.isGitRepository && status.isVaultGitRoot)
  const hasRemote = Boolean(status?.remoteUrl)
  const shouldShowRemoteButton = Boolean(canUseGit && !hasRemote)
  const shouldShowRemoteSetup = Boolean(canUseGit && isRemoteSetupOpen)

  /** 同步外部状态回调，避免父组件重渲染触发重复刷新 */
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  /** 选择文件并按文件状态切换默认 diff 视图 */
  function handleSelectFile(file: GitChangedFile, mode: GitDiffMode = getDefaultDiffMode(file)) {
    selectedPathRef.current = file.path
    selectedDiffModeRef.current = mode
    setSelectedPath(file.path)
    setDiffMode(mode)
  }

  /** 切换当前文件的 diff 视图 */
  function handleDiffModeChange(mode: GitDiffMode) {
    selectedDiffModeRef.current = mode
    setDiffMode(mode)
  }

  /** 刷新 Git 状态，并同步当前选择 */
  const refreshStatus = useCallback(async () => {
    // 1. 读取状态
    setIsLoadingStatus(true)
    setErrorMessage(null)
    try {
      const nextStatus = await getGitStatus(vaultPath)
      setStatus(nextStatus)
      onStatusChangeRef.current(nextStatus)

      // 2. 只保持用户已经选择过的文件，避免打开面板时立即触发首个 diff
      const currentSelectedPath = selectedPathRef.current
      const nextSelected = currentSelectedPath
        ? nextStatus.changedFiles.find((file) => file.path === currentSelectedPath) ?? null
        : null
      const currentDiffMode = selectedDiffModeRef.current
      const nextDiffMode =
        nextSelected && currentDiffMode === 'staged' && nextSelected.isStaged
          ? 'staged'
          : nextSelected && currentDiffMode === 'unstaged' && nextSelected.isUnstaged
            ? 'unstaged'
            : getDefaultDiffMode(nextSelected)
      selectedPathRef.current = nextSelected?.path ?? null
      selectedDiffModeRef.current = nextDiffMode
      setSelectedPath(nextSelected?.path ?? null)
      setDiffMode(nextDiffMode)
      if (!nextSelected) setDiff('')
      return nextStatus
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      return null
    } finally {
      setIsLoadingStatus(false)
    }
  }, [vaultPath])

  /** 执行写操作并刷新状态 */
  async function runOperation(
    operation: () => Promise<GitStatusResult>,
    successMessage: string,
    options: RunOperationOptions = {}
  ) {
    // 1. 先落盘当前编辑器内容，避免提交漏掉 debounce 中的正文
    setIsOperating(true)
    setErrorMessage(null)
    setNoticeMessage(null)
    setRemoteRecoveryMessage(null)
    try {
      await onBeforeWrite()
      const nextStatus = await operation()
      setStatus(nextStatus)
      onStatusChangeRef.current(nextStatus)
      setNoticeMessage(successMessage)
      options.onSuccess?.(nextStatus)
    } catch (error) {
      const message = getErrorMessage(error)
      options.onError?.(message)
      setErrorMessage(message)
    } finally {
      setIsOperating(false)
    }
  }

  async function handleStage(paths: string[], successMessage: string) {
    await runOperation(async () => (await stageGitPaths(vaultPath, paths)).status, successMessage)
  }

  async function handleUnstage(paths: string[], successMessage: string) {
    await runOperation(async () => (await unstageGitPaths(vaultPath, paths)).status, successMessage)
  }

  async function handleCommit() {
    const message = commitMessage.trim()
    if (!message) {
      setErrorMessage('提交信息不能为空')
      commitInputRef.current?.focus()
      return
    }
    await runOperation(async () => (await commitGitChanges(vaultPath, message)).status, 'Commit 已完成')
    setCommitMessage('')
  }

  /** 打开右上角入口对应的远端连接表单 */
  function handleOpenRemoteSetup() {
    setIsRemoteSetupOpen(true)
    setRemoteRecoveryMessage(null)
    setErrorMessage((message) => (message === MISSING_REMOTE_PUSH_MESSAGE ? null : message))
  }

  async function handlePush() {
    const currentStatus = status ?? (await refreshStatus())
    if (!currentStatus) return
    const canPushFromCurrentStatus = Boolean(currentStatus?.isGitRepository && currentStatus.isVaultGitRoot)
    if (canPushFromCurrentStatus && !currentStatus?.remoteUrl) {
      setNoticeMessage(null)
      setRemoteRecoveryMessage(null)
      setErrorMessage(MISSING_REMOTE_PUSH_MESSAGE)
      return
    }

    await runOperation(async () => (await pushGitBranch(vaultPath)).status, 'Push 已完成', {
      onError: (message) => {
        if (!shouldOfferRemoteReconnect(message)) return
        setIsRemoteSetupOpen(true)
        setRemoteRecoveryMessage(REMOTE_RECONNECT_MESSAGE)
      },
    })
  }

  async function handleInitLocalRepository() {
    await runOperation(async () => (await initLocalGitRepository(vaultPath)).status, '本地 Git 仓库已初始化')
  }

  async function handleOpenGitHubNewRepository() {
    setErrorMessage(null)
    try {
      await openUrl('https://github.com/new')
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  async function handleConnectRemote() {
    await runOperation(
      async () => (await connectGitRemoteRepository(vaultPath, remoteUrl)).status,
      'Remote 已连接并推送',
      {
        onSuccess: () => setIsRemoteSetupOpen(false),
        onError: (message) => {
          setIsRemoteSetupOpen(true)
          if (shouldOfferRemoteReconnect(message)) {
            setRemoteRecoveryMessage(REMOTE_RECONNECT_MESSAGE)
          }
        },
      }
    )
  }

  useEffect(() => {
    if (!isOpen) return
    void refreshStatus()
  }, [isOpen, refreshStatus, vaultPath])

  useEffect(() => {
    selectedPathRef.current = null
    selectedDiffModeRef.current = 'unstaged'
    setSelectedPath(null)
    setDiff('')
    setDiffMode('unstaged')
    setRemoteUrl('')
    setIsRemoteSetupOpen(false)
    setRemoteRecoveryMessage(null)
  }, [vaultPath])

  useEffect(() => {
    if (!isRemoteSetupOpen) return
    window.requestAnimationFrame(() => remoteInputRef.current?.focus())
  }, [isRemoteSetupOpen])

  useEffect(() => {
    if (!isOpen || !selectedFile || !canUseGit) {
      setDiff('')
      return
    }

    let isDisposed = false
    setIsLoadingDiff(true)
    setErrorMessage(null)
    setDiff('')
    void getGitDiff(vaultPath, selectedFile.path, diffMode)
      .then((result) => {
        if (!isDisposed) setDiff(result.diff || '当前视图没有 diff')
      })
      .catch((error) => {
        if (!isDisposed) setErrorMessage(getErrorMessage(error))
      })
      .finally(() => {
        if (!isDisposed) setIsLoadingDiff(false)
      })

    return () => {
      isDisposed = true
    }
  }, [canUseGit, diffMode, isOpen, selectedFile, vaultPath])

  useEffect(() => {
    if (!isOpen || !request || handledRequestIdRef.current === request.id) return
    handledRequestIdRef.current = request.id

    if (request.action === 'stage-all') {
      void handleStage([], '全部变更已 staged')
      return
    }
    if (request.action === 'push') {
      void handlePush()
      return
    }
    if (request.action === 'commit') {
      window.requestAnimationFrame(() => commitInputRef.current?.focus())
      return
    }
    if (request.action === 'connect-remote') {
      handleOpenRemoteSetup()
    }
  }, [isOpen, request])

  /** 支持键盘选择变更文件 */
  function handleChangeRowKeyDown(event: KeyboardEvent<HTMLDivElement>, file: GitChangedFile, mode: GitDiffMode) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleSelectFile(file, mode)
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
            handler: () => handleUnstage([file.path], '文件已 unstaged'),
            disabled: isOperating,
          }
        : {
            icon: <Plus aria-hidden />,
            label: `Stage ${file.path}`,
            handler: () => handleStage([file.path], '文件已 staged'),
            disabled: isOperating,
          }

    return (
      <div
        key={`${mode}:${file.path}`}
        className={`git-change-row${isSelected ? ' active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => handleSelectFile(file, mode)}
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
            void action.handler()
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

  if (!isOpen) return null

  return createPortal(
    <div className="git-panel-overlay" role="dialog" aria-modal="true" aria-label="Git 面板">
      <div className="git-panel-backdrop" onClick={onClose} />
      <section className="git-panel">
        <header className="git-panel-header">
          <div className="git-panel-title">
            <GitBranch aria-hidden />
            <div>
              <h2>Git</h2>
              <p>
                {status?.branch ? status.branch : 'Vault 备份'}
                {status?.remoteUrl ? ` · origin` : ''}
                {status?.ahead ? ` · ahead ${status.ahead}` : ''}
                {status?.behind ? ` · behind ${status.behind}` : ''}
              </p>
            </div>
          </div>
          <div className="git-panel-header-actions">
            {shouldShowRemoteButton ? (
              <Button
                className="git-connect-remote-button"
                variant="outline"
                size="sm"
                onClick={handleOpenRemoteSetup}
                disabled={isOperating}
                aria-expanded={isRemoteSetupOpen}
              >
                <LinkIcon aria-hidden />
                连接远端
              </Button>
            ) : null}
            <Button variant="ghost" size="icon-sm" onClick={refreshStatus} disabled={isLoadingStatus || isOperating}>
              {isLoadingStatus ? <Loader2 className="git-spin" aria-hidden /> : <RefreshCcw aria-hidden />}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭 Git 面板">
              <X aria-hidden />
            </Button>
          </div>
        </header>

        {errorMessage ? (
          <div className={`git-panel-alert ${errorMessage === MISSING_REMOTE_PUSH_MESSAGE ? 'warning' : 'error'}`}>
            {errorMessage}
          </div>
        ) : null}
        {noticeMessage ? <div className="git-panel-alert success">{noticeMessage}</div> : null}

        {status && (!status.isGitRepository || !status.isVaultGitRoot) ? (
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
                <Button className="git-local-init-button" onClick={handleInitLocalRepository} disabled={isOperating}>
                  {isOperating ? <Loader2 className="git-spin" aria-hidden /> : <GitBranch aria-hidden />}
                  本地初始化
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {shouldShowRemoteSetup ? (
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
                onClick={() => setIsRemoteSetupOpen(false)}
                aria-label="收起连接远端"
              >
                <X aria-hidden />
              </Button>
            </div>
            {remoteRecoveryMessage ? <div className="git-remote-recovery">{remoteRecoveryMessage}</div> : null}
            <div className="git-remote-actions">
              <Button variant="outline" onClick={handleOpenGitHubNewRepository} disabled={isOperating}>
                <ExternalLink aria-hidden />
                打开 GitHub 新建仓库
              </Button>
            </div>
            <div className="git-remote-row">
              <Input
                ref={remoteInputRef}
                value={remoteUrl}
                onChange={(event) => {
                  setRemoteUrl(event.target.value)
                  setRemoteRecoveryMessage(null)
                }}
                placeholder="https://github.com/you/repo.git 或 git@github.com:you/repo.git"
              />
              <Button variant="outline" onClick={handleConnectRemote} disabled={isOperating || !remoteUrl.trim()}>
                连接远端
              </Button>
            </div>
          </section>
        ) : null}

        <div className="git-panel-grid">
          <aside className="git-changes">
            <div className="git-section-header">
              <span>变更</span>
              <span>{status?.changedFiles.length ?? 0}</span>
            </div>
            <div className="git-change-list">
              {!status?.changedFiles.length ? (
                <div className="git-empty">没有未提交变更</div>
              ) : (
                <>
                  <section className="git-change-group">
                    <header className="git-change-group-header">
                      <button type="button" className="git-change-group-toggle" onClick={() => setIsUnstagedOpen((value) => !value)}>
                        {isUnstagedOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                        <span>未 staged</span>
                        <span>{unstagedFiles.length}</span>
                      </button>
                      <button
                        type="button"
                        className="git-change-group-action"
                        onClick={() => void handleStage([], '全部变更已 staged')}
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

                  <section className="git-change-group">
                    <header className="git-change-group-header">
                      <button type="button" className="git-change-group-toggle" onClick={() => setIsStagedOpen((value) => !value)}>
                        {isStagedOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                        <span>Staged</span>
                        <span>{stagedFiles.length}</span>
                      </button>
                      <button
                        type="button"
                        className="git-change-group-action"
                        onClick={() => void handleUnstage([], '全部变更已 unstaged')}
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
                </>
              )}
            </div>
          </aside>

          <main className="git-diff-pane">
            <div className="git-diff-toolbar">
              <div className="git-selected-file">
                <span>{selectedFile?.path ?? '未选择文件'}</span>
                {selectedLineStats ? <span>+{selectedLineStats.additions} -{selectedLineStats.deletions}</span> : null}
              </div>
              <div className="git-diff-actions">
                {selectedFile?.isUnstaged ? (
                  <Button
                    variant={diffMode === 'unstaged' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => handleDiffModeChange('unstaged')}
                  >
                    Working
                  </Button>
                ) : null}
                {selectedFile?.isStaged ? (
                  <Button
                    variant={diffMode === 'staged' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => handleDiffModeChange('staged')}
                  >
                    Staged
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedFile && handleStage([selectedFile.path], '文件已 staged')}
                  disabled={!selectedFile?.isUnstaged || isOperating}
                >
                  <Check aria-hidden />
                  Stage
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => selectedFile && handleUnstage([selectedFile.path], '文件已 unstaged')}
                  disabled={!selectedFile?.isStaged || isOperating}
                >
                  Unstage
                </Button>
              </div>
            </div>
            <pre className="git-diff-content">
              {isLoadingDiff ? '正在读取 diff...' : diff || '选择一个文件查看 diff'}
            </pre>

            <section className="git-commit-box">
              <div className="git-commit-meta">
                <span>
                  <ShieldCheck aria-hidden />
                  {stagedCount} 个 staged 文件
                </span>
                <span>{unstagedCount} 个 working 变更</span>
              </div>
              <Textarea
                ref={commitInputRef}
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Commit message"
                rows={3}
              />
              <div className="git-commit-actions">
                <Button onClick={handleCommit} disabled={!canUseGit || isOperating || stagedCount === 0}>
                  {isOperating ? <Loader2 className="git-spin" aria-hidden /> : <Check aria-hidden />}
                  Commit
                </Button>
                <Button variant="outline" onClick={handlePush} disabled={!canUseGit || isOperating}>
                  <Send aria-hidden />
                  Push
                </Button>
              </div>
            </section>
          </main>
        </div>
      </section>
    </div>,
    document.body
  )
}
