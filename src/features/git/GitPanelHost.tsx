import { forwardRef, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { GitStatusResult } from '../../domain/git'
import { GitPanel, type GitPanelAction, type GitPanelRequest } from './GitPanel'
import type { GitPanelOpenSession } from './gitPanelPerf'

interface GitPanelHostProps {
  vaultPath: string
  getInitialStatus: () => GitStatusResult | null
  onBeforeWrite: () => Promise<void>
  onFilesChanged: (paths: string[]) => Promise<void>
  onStatusChange: (status: GitStatusResult) => void
}

export interface GitPanelHostHandle {
  open: (action?: GitPanelAction | null) => void
}

/** 管理 Git 面板自身的开关状态，避免打开时触发整个 App 重渲染。 */
export const GitPanelHost = forwardRef<GitPanelHostHandle, GitPanelHostProps>(function GitPanelHost(
  { vaultPath, getInitialStatus, onBeforeWrite, onFilesChanged, onStatusChange }: GitPanelHostProps,
  ref: Ref<GitPanelHostHandle>
) {
  const [isOpen, setIsOpen] = useState(false)
  const [request, setRequest] = useState<GitPanelRequest | null>(null)
  const [openSession, setOpenSession] = useState<GitPanelOpenSession | null>(null)
  const [initialStatus, setInitialStatus] = useState<GitStatusResult | null>(null)
  const openSessionIdRef = useRef(0)

  useImperativeHandle(
    ref,
    () => ({
      open(action: GitPanelAction | null = null) {
        // 1. 记录这次打开时刻，供 Git 面板性能埋点复用
        openSessionIdRef.current += 1
        setOpenSession({
          id: openSessionIdRef.current,
          openedAtMs: performance.now(),
        })

        // 2. 优先带上最近一次已知状态，确保面板能更快出首屏
        setInitialStatus(getInitialStatus())
        setRequest(
          action
            ? {
                id: Date.now(),
                action,
              }
            : null
        )
        setIsOpen(true)
      },
    }),
    [getInitialStatus]
  )

  return (
    <GitPanel
      isOpen={isOpen}
      vaultPath={vaultPath}
      openSession={openSession}
      initialStatus={initialStatus}
      request={request}
      onClose={() => setIsOpen(false)}
      onBeforeWrite={onBeforeWrite}
      onFilesChanged={onFilesChanged}
      onStatusChange={onStatusChange}
    />
  )
})
