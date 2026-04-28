import type { GitStatusResult, GitStatusTiming } from '../../domain/git'

export interface GitPanelOpenSession {
  id: number
  openedAtMs: number
}

export interface GitPanelOpenTrace {
  sessionId: number
  openedAtMs: number
  panelMountedAtMs: number | null
  statusRequestStartedAtMs: number | null
  statusResolvedAtMs: number | null
  statusPaintedAtMs: number | null
  changedFileCount: number
  backendTiming: GitStatusTiming | null
  errorMessage: string | null
  hasLoggedSummary: boolean
}

interface GitPanelPerfRow {
  stage: string
  step: string
  durationMs: number
}

/** 创建一轮 Git 面板打开链路的性能跟踪对象。 */
export function createGitPanelOpenTrace(session: GitPanelOpenSession): GitPanelOpenTrace {
  return {
    sessionId: session.id,
    openedAtMs: session.openedAtMs,
    panelMountedAtMs: null,
    statusRequestStartedAtMs: null,
    statusResolvedAtMs: null,
    statusPaintedAtMs: null,
    changedFileCount: 0,
    backendTiming: null,
    errorMessage: null,
    hasLoggedSummary: false,
  }
}

/** 记录面板首次挂载完成时刻。 */
export function markGitPanelMounted(trace: GitPanelOpenTrace, timestampMs = performance.now()) {
  if (trace.panelMountedAtMs !== null) return
  trace.panelMountedAtMs = timestampMs
}

/** 记录首次 Git 状态请求开始时刻。 */
export function markGitPanelStatusRequestStarted(
  trace: GitPanelOpenTrace,
  timestampMs = performance.now()
) {
  if (trace.statusRequestStartedAtMs !== null) return
  trace.statusRequestStartedAtMs = timestampMs
}

/** 记录首次 Git 状态请求返回时刻。 */
export function markGitPanelStatusResolved(
  trace: GitPanelOpenTrace,
  status: GitStatusResult,
  timestampMs = performance.now()
) {
  if (trace.statusResolvedAtMs !== null) return
  trace.statusResolvedAtMs = timestampMs
  trace.changedFileCount = status.changedFiles.length
  trace.backendTiming = status.timing
}

/** 记录首次状态渲染完成后的首帧时刻。 */
export function markGitPanelStatusPainted(trace: GitPanelOpenTrace, timestampMs = performance.now()) {
  if (trace.statusPaintedAtMs !== null) return
  trace.statusPaintedAtMs = timestampMs
}

/** 记录首次状态请求失败信息。 */
export function markGitPanelStatusFailed(
  trace: GitPanelOpenTrace,
  errorMessage: string,
  timestampMs = performance.now()
) {
  if (trace.statusResolvedAtMs === null) {
    trace.statusResolvedAtMs = timestampMs
  }
  trace.errorMessage = errorMessage
}

/** 把本轮打开链路的耗时汇总输出到控制台。 */
export function logGitPanelOpenTrace(trace: GitPanelOpenTrace) {
  // 1. 避免同一轮打开重复刷屏
  if (trace.hasLoggedSummary) return
  trace.hasLoggedSummary = true

  // 2. 组装前端与后端的统一耗时行
  const rows: GitPanelPerfRow[] = []
  pushPerfRow(rows, 'frontend', '打开请求 -> 面板挂载', diffMs(trace.openedAtMs, trace.panelMountedAtMs))
  pushPerfRow(
    rows,
    'frontend',
    '面板挂载 -> 发起状态请求',
    diffMs(trace.panelMountedAtMs, trace.statusRequestStartedAtMs)
  )
  pushPerfRow(
    rows,
    'frontend',
    '状态请求往返（含 Tauri bridge）',
    diffMs(trace.statusRequestStartedAtMs, trace.statusResolvedAtMs)
  )
  pushPerfRow(
    rows,
    'frontend',
    '状态返回 -> 首帧绘制',
    diffMs(trace.statusResolvedAtMs, trace.statusPaintedAtMs)
  )
  pushPerfRow(rows, 'frontend', '打开请求 -> 首帧绘制', diffMs(trace.openedAtMs, trace.statusPaintedAtMs))

  const statusRoundtripMs = diffMs(trace.statusRequestStartedAtMs, trace.statusResolvedAtMs)
  if (statusRoundtripMs !== null && trace.backendTiming) {
    pushPerfRow(
      rows,
      'frontend',
      'Tauri bridge / 序列化 / JS 处理',
      Math.max(statusRoundtripMs - trace.backendTiming.totalMs, 0)
    )
  }

  if (trace.backendTiming) {
    pushPerfRow(rows, 'backend', 'git_get_status 总耗时', trace.backendTiming.totalMs)
    trace.backendTiming.steps.forEach((step) => {
      pushPerfRow(rows, 'backend', step.label, step.durationMs)
    })
  }

  // 3. 输出一组便于截图的摘要
  const totalMs = diffMs(trace.openedAtMs, trace.statusPaintedAtMs)
  const titleParts = [`[GitPanel][open#${trace.sessionId}]`]
  if (totalMs !== null) titleParts.push(`首帧 ${formatMs(totalMs)}`)
  if (trace.backendTiming) titleParts.push(`后端 ${formatMs(trace.backendTiming.totalMs)}`)
  titleParts.push(`变更文件 ${trace.changedFileCount}`)
  if (trace.errorMessage) titleParts.push('状态请求失败')

  console.groupCollapsed(titleParts.join(' | '))
  console.table(
    rows.map((row) => ({
      阶段: row.stage,
      节点: row.step,
      耗时Ms: Number(row.durationMs.toFixed(1)),
    }))
  )
  console.log('summary', {
    sessionId: trace.sessionId,
    changedFileCount: trace.changedFileCount,
    totalOpenToPaintMs: toFixedNumber(totalMs),
    backendTotalMs: toFixedNumber(trace.backendTiming?.totalMs ?? null),
    errorMessage: trace.errorMessage,
  })
  if (trace.errorMessage) {
    console.warn(`[GitPanel][open#${trace.sessionId}] status error:`, trace.errorMessage)
  }
  console.groupEnd()
}

/** 计算两个时间点之间的毫秒差。 */
function diffMs(startMs: number | null, endMs: number | null): number | null {
  if (startMs === null || endMs === null) return null
  return endMs - startMs
}

/** 向结果列表里追加一条合法的耗时行。 */
function pushPerfRow(rows: GitPanelPerfRow[], stage: string, step: string, durationMs: number | null) {
  if (durationMs === null || Number.isNaN(durationMs)) return
  rows.push({ stage, step, durationMs })
}

/** 统一格式化毫秒文案。 */
function formatMs(durationMs: number): string {
  return `${durationMs.toFixed(1)}ms`
}

/** 把可空数字整理成适合 console 的输出。 */
function toFixedNumber(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) return null
  return Number(value.toFixed(1))
}
