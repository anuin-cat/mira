import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  FilePenLine,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Progress } from '@/components/ui/progress'
import type { AiAgentTranscriptMessage, AiAgentTranscriptToolCall, AiChatMessage, AiTokenUsage } from '../../domain/ai'
import { AiMarkdown } from './AiMarkdown'

interface Props {
  message: AiChatMessage
  isStreaming: boolean
  isReasoningExpanded: boolean
  onToggleReasoning: () => void
  onCopy: () => void
  onRegenerate: () => void
  onRevertFileEdits: () => void
  isRevertingFileEdits: boolean
}

type AiAgentToolTranscriptMessage = Extract<AiAgentTranscriptMessage, { role: 'tool' }>
type AgentReasoningEntry =
  | { type: 'reasoning'; key: string; content: string }
  | { type: 'tool'; key: string; toolCall: AiAgentTranscriptToolCall }
type AgentDisplaySegment =
  | { type: 'reasoning'; key: string; entries: AgentReasoningEntry[]; reasoningDurationMs: number | null }
  | { type: 'content'; key: string; content: string }
type AgentReasoningDisplaySegment = Extract<AgentDisplaySegment, { type: 'reasoning' }>
type AgentReasoningSegmentToggleState = 'expanded' | 'collapsed'

/** 把思考耗时整理成适合标题展示的短文本 */
function formatReasoningDuration(reasoningDurationMs: number | null | undefined): string | null {
  if (reasoningDurationMs === null || reasoningDurationMs === undefined) return null

  const durationSeconds = reasoningDurationMs / 1000
  if (durationSeconds < 10) return `用时 ${durationSeconds.toFixed(1)} 秒`
  return `用时 ${Math.round(durationSeconds)} 秒`
}

/** 把工具耗时整理成短文本 */
function formatToolDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined) return null
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)} s`
}

/** 把等待时长整理成紧凑文本 */
function formatWaitingDuration(startedAt: string | undefined, nowMs: number): string {
  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN
  if (!Number.isFinite(startedAtMs)) return '等待中'

  const elapsedMs = Math.max(0, nowMs - startedAtMs)
  return formatToolDuration(elapsedMs) ?? '等待中'
}

/** 尽量把 JSON 参数和结果格式化展示；失败时保留原文，避免丢信息 */
function formatJsonLikeText(value: string): string {
  const trimmedValue = value.trim()
  if (!trimmedValue) return '(空)'

  try {
    return JSON.stringify(JSON.parse(trimmedValue) as unknown, null, 2)
  } catch {
    return value
  }
}

/** 判断当前 assistant 消息是否需要展示思考/执行过程折叠块 */
function shouldShowReasoningBlock(message: AiChatMessage, isStreaming: boolean): boolean {
  return (
    Boolean(message.agentTranscript?.length) ||
    Boolean(message.reasoningContent?.trim()) ||
    (isStreaming && !message.content.trim())
  )
}

/** 根据当前消息状态生成折叠块标题 */
function getReasoningTitle(
  hasAgentTranscript: boolean,
  isStreaming: boolean,
  isReasoningComplete: boolean | undefined
): string {
  if (hasAgentTranscript) return isStreaming ? '执行中' : '思考过程'
  return isStreaming && !isReasoningComplete ? '思考中' : '已思考'
}

/** 把 token 数整理成紧凑文本 */
function formatTokenCount(value: number | undefined): string | null {
  if (value === undefined) return null
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return `${value}`
}

/** 计算 provider prompt cache 命中比例，优先使用 DeepSeek 的 hit/miss 字段 */
function getPromptCacheStats(tokenUsage: AiTokenUsage | undefined): {
  hitTokens: number
  missTokens: number | null
  hitRate: number
} | null {
  if (!tokenUsage) return null

  const hasDeepSeekCache =
    tokenUsage.promptCacheHitTokens !== undefined || tokenUsage.promptCacheMissTokens !== undefined
  if (hasDeepSeekCache) {
    const hitTokens = tokenUsage.promptCacheHitTokens ?? 0
    const missTokens = tokenUsage.promptCacheMissTokens ?? 0
    const totalCacheTokens = hitTokens + missTokens
    if (totalCacheTokens <= 0) return null

    return {
      hitTokens,
      missTokens,
      hitRate: hitTokens / totalCacheTokens,
    }
  }

  if (tokenUsage.promptCachedTokens !== undefined && tokenUsage.promptTokens !== undefined) {
    const hitTokens = tokenUsage.promptCachedTokens
    const missTokens = Math.max(0, tokenUsage.promptTokens - hitTokens)
    if (tokenUsage.promptTokens <= 0) return null

    return {
      hitTokens,
      missTokens,
      hitRate: hitTokens / tokenUsage.promptTokens,
    }
  }

  return null
}

interface MessageMetaData {
  cacheStats: { hitTokens: number; missTokens: number | null; hitRate: number } | null
  promptTokens: string | null
  completionTokens: string | null
  reasoningTokens: string | null
}

/** 提取 assistant 消息底部所需的结构化数据 */
function getMessageMetaData(message: AiChatMessage): MessageMetaData {
  const tokenUsage = message.tokenUsage
  return {
    cacheStats: getPromptCacheStats(tokenUsage),
    promptTokens: formatTokenCount(tokenUsage?.promptTokens),
    completionTokens: formatTokenCount(tokenUsage?.completionTokens),
    reasoningTokens: formatTokenCount(tokenUsage?.reasoningTokens),
  }
}

/** 所有用量数据合并在一个胶囊内，各段 hover 显示 shadcn Tooltip */
function MetaPill({ meta }: { meta: MessageMetaData }) {
  const { cacheStats, promptTokens, completionTokens, reasoningTokens } = meta
  const pct = cacheStats ? Math.round(cacheStats.hitRate * 100) : null
  const hitFmt = cacheStats ? (formatTokenCount(cacheStats.hitTokens) ?? '') : ''
  const missFmt = cacheStats?.missTokens != null ? (formatTokenCount(cacheStats.missTokens) ?? '') : null

  return (
    <span className="ai-meta-pill">
      {cacheStats && pct !== null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ai-meta-seg ai-meta-seg--cache">
              <Progress value={pct} className="ai-meta-progress" />
              <span className="ai-meta-cache-pct">{pct}%</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            缓存命中率：已命中 {hitFmt} token{missFmt ? `，未命中 ${missFmt} token` : ''}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {(promptTokens || completionTokens || reasoningTokens) ? (
        <>
          {cacheStats ? <span className="ai-meta-divider" aria-hidden="true" /> : null}
          <span className="ai-meta-seg--tokens">
          {promptTokens ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ai-meta-token-item">
                  <span className="ai-meta-sym">↑</span>
                  <span className="ai-meta-val">{promptTokens}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>输入 token：发送给模型的提示词长度</TooltipContent>
            </Tooltip>
          ) : null}
          {completionTokens ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ai-meta-token-item ai-meta-token-item--out">
                  <span className="ai-meta-sym">↓</span>
                  <span className="ai-meta-val">{completionTokens}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>输出 token：模型生成的回复长度</TooltipContent>
            </Tooltip>
          ) : null}
          {reasoningTokens ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ai-meta-token-item">
                  <span className="ai-meta-sym">◈</span>
                  <span className="ai-meta-val">{reasoningTokens}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>推理 token：模型内部思考消耗的 token</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        </>
      ) : null}
    </span>
  )
}

/** 按正/负/零返回行数颜色语义，方便统一映射到样式类 */
function getLineDeltaTone(value: number): 'positive' | 'negative' | 'zero' {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'zero'
}

/** 把增删行数拆成独立节点，支持分别着色 */
function FileEditLineSummary({
  addedLines,
  removedLines,
  className,
}: {
  addedLines: number
  removedLines: number
  className?: string
}) {
  return (
    <span className={cn('ai-file-edit-line-stats', className)}>
      <span className={cn('ai-file-edit-line-stat', `is-${getLineDeltaTone(addedLines)}`)}>+{addedLines}</span>
      <span className={cn('ai-file-edit-line-stat', `is-${getLineDeltaTone(-removedLines)}`)}>-{removedLines}</span>
    </span>
  )
}

/** 展示 agent 本次实际写入的文件列表，并提供整批回退 */
function FileEditSummaryCard({
  message,
  isReverting,
  onRevert,
}: {
  message: AiChatMessage
  isReverting: boolean
  onRevert: () => void
}) {
  const batch = message.fileEditBatch
  if (!batch || batch.files.length === 0) return null

  const fileCountLabel = `${batch.files.length} 个文件`

  return (
    <section className={cn('ai-file-edit-summary', batch.isReverted && 'is-reverted')}>
      <div className="ai-file-edit-summary-header">
        <span className="ai-file-edit-summary-title">
          <FilePenLine className="size-[14px]" aria-hidden="true" />
          <span>已修改 {fileCountLabel}</span>
        </span>
        <div className="ai-file-edit-summary-actions">
          {batch.isReverted ? (
            <span className="ai-file-edit-reverted-label">已回退</span>
          ) : (
            <button
              type="button"
              className="ai-file-edit-revert-btn"
              onClick={onRevert}
              disabled={isReverting}
              aria-label="回退本次 AI 修改"
            >
              {isReverting ? (
                <LoaderCircle className="ai-agent-tool-spinner size-[13px]" aria-hidden="true" />
              ) : (
                <RotateCcw className="size-[13px]" aria-hidden="true" />
              )}
              <span>{isReverting ? '回退中' : '回退修改'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="ai-file-edit-list">
        {batch.files.map((file) => (
          <div key={file.path} className="ai-file-edit-row">
            <code title={file.path}>{file.path}</code>
            <FileEditLineSummary addedLines={file.addedLines} removedLines={file.removedLines} />
          </div>
        ))}
      </div>
    </section>
  )
}

/** 判断 transcript 中最后一条 assistant 是否只是最终正文，避免和主回答重复展示 */
function shouldShowAssistantTranscriptContent(
  transcript: AiAgentTranscriptMessage[],
  transcriptIndex: number,
  transcriptContent: string,
  messageContent: string,
  hasToolCalls: boolean
): boolean {
  const normalizedTranscriptContent = transcriptContent.trim()
  if (!normalizedTranscriptContent) return false
  if (hasToolCalls) return true

  const isLastTranscriptItem = transcriptIndex === transcript.length - 1
  const isSameAsFinalAnswer = normalizedTranscriptContent === messageContent.trim()
  return !(isLastTranscriptItem && isSameAsFinalAnswer)
}

/** 按“思考/工具一段、正文一段”的规则，把 transcript 重组为更自然的展示流 */
function buildAgentDisplaySegments(
  transcript: AiAgentTranscriptMessage[],
  messageContent: string
): AgentDisplaySegment[] {
  const segments: AgentDisplaySegment[] = []
  let currentReasoningEntries: AgentReasoningEntry[] = []
  let currentReasoningDurationMs = 0
  let hasCurrentReasoningDuration = false

  /** 把当前累计的思考条目落成一个独立思考过程 */
  function flushReasoningSegment() {
    if (currentReasoningEntries.length === 0) return

    const firstEntryKey = currentReasoningEntries[0]?.key ?? `reasoning-${segments.length}`
    const lastEntryKey = currentReasoningEntries[currentReasoningEntries.length - 1]?.key ?? firstEntryKey

    segments.push({
      type: 'reasoning',
      key: `${firstEntryKey}__${lastEntryKey}`,
      entries: currentReasoningEntries,
      reasoningDurationMs: hasCurrentReasoningDuration ? currentReasoningDurationMs : null,
    })
    currentReasoningEntries = []
    currentReasoningDurationMs = 0
    hasCurrentReasoningDuration = false
  }

  transcript.forEach((item, index) => {
    if (item.role !== 'assistant') return

    const toolCalls = item.toolCalls ?? []
    const shouldShowContent = shouldShowAssistantTranscriptContent(
      transcript,
      index,
      item.content,
      messageContent,
      toolCalls.length > 0
    )

    if (item.reasoningContent?.trim()) {
      currentReasoningEntries.push({
        type: 'reasoning',
        key: `assistant-${index}-reasoning`,
        content: item.reasoningContent,
      })

      if (item.reasoningDurationMs !== null && item.reasoningDurationMs !== undefined) {
        currentReasoningDurationMs += item.reasoningDurationMs
        hasCurrentReasoningDuration = true
      }
    }

    if (shouldShowContent) {
      flushReasoningSegment()
      segments.push({
        type: 'content',
        key: `assistant-${index}-content`,
        content: item.content,
      })
    }

    toolCalls.forEach((toolCall) => {
      currentReasoningEntries.push({
        type: 'tool',
        key: toolCall.id,
        toolCall,
      })
    })
  })

  flushReasoningSegment()
  return segments
}

/** 建立工具结果索引，让调用参数和对应结果可以合并成同一卡片 */
function createToolResultMap(transcript: AiAgentTranscriptMessage[]): Map<string, AiAgentToolTranscriptMessage> {
  const toolResultMap = new Map<string, AiAgentToolTranscriptMessage>()
  transcript.forEach((item) => {
    if (item.role === 'tool') toolResultMap.set(item.toolCallId, item)
  })
  return toolResultMap
}

/** 判断当前 transcript 中是否还有等待结果的工具调用 */
function hasPendingToolCalls(
  transcript: AiAgentTranscriptMessage[],
  toolResultMap: Map<string, AiAgentToolTranscriptMessage>
): boolean {
  return transcript.some((item) => {
    if (item.role !== 'assistant') return false
    return (item.toolCalls ?? []).some((toolCall) => !toolResultMap.has(toolCall.id))
  })
}

/** 单张工具卡：默认折叠，只在展开后展示参数和结果 */
function ToolInvocationCard({
  toolCall,
  result,
  isExpanded,
  nowMs,
  onToggle,
}: {
  toolCall: AiAgentTranscriptToolCall
  result: AiAgentToolTranscriptMessage | undefined
  isExpanded: boolean
  nowMs: number
  onToggle: () => void
}) {
  const isPending = result === undefined
  const isError = result?.isError === true
  const durationLabel = isPending
    ? formatWaitingDuration(toolCall.startedAt, nowMs)
    : (formatToolDuration(result.durationMs) ?? '已完成')

  return (
    <div className={cn('ai-agent-tool-card', isExpanded && 'is-expanded', isError && 'is-error')}>
      <button
        type="button"
        className="ai-agent-tool-card-header"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <span className="ai-agent-tool-title">
          <Wrench className="size-[14px]" aria-hidden="true" />
          <code>{toolCall.name}</code>
        </span>
        <span className="ai-agent-tool-status">
          <span className="ai-agent-tool-duration">{durationLabel}</span>
          {isPending ? (
            <LoaderCircle className="ai-agent-tool-spinner size-[14px]" aria-hidden="true" />
          ) : isError ? (
            <AlertCircle className="size-[14px]" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-[14px]" aria-hidden="true" />
          )}
          <ChevronDown
            className={cn('ai-agent-tool-chevron size-[14px]', isExpanded ? 'rotate-180' : 'rotate-0')}
            aria-hidden="true"
          />
        </span>
      </button>

      {isExpanded ? (
        <div className="ai-agent-tool-card-body">
          <section className="ai-agent-tool-section">
            <div className="ai-agent-tool-section-title">参数</div>
            <pre className="ai-agent-tool-code">{formatJsonLikeText(toolCall.argumentsText)}</pre>
          </section>
          <section className="ai-agent-tool-section">
            <div className="ai-agent-tool-section-title">{isError ? '错误结果' : '结果'}</div>
            {result ? (
              <pre className="ai-agent-tool-code">{formatJsonLikeText(result.content)}</pre>
            ) : (
              <div className="ai-agent-tool-pending">正在等待工具返回结果...</div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}

/** 通用思考块：负责标题、展开收起和统一的折叠面板样式 */
function ReasoningBlock({
  title,
  durationLabel,
  isExpanded,
  onToggle,
  children,
}: {
  title: string
  durationLabel: string | null
  isExpanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="ai-reasoning-block">
      <button
        type="button"
        className="ai-reasoning-toggle"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <span className="ai-reasoning-toggle-main">
          <span className="ai-reasoning-icon" aria-hidden="true">
            <Sparkles className="size-[15px]" />
          </span>
          <span className="ai-reasoning-title">{title}</span>
          {durationLabel ? <span className="ai-reasoning-duration">（{durationLabel}）</span> : null}
        </span>
        <ChevronDown
          className={cn('ai-reasoning-chevron size-[15px]', isExpanded ? 'rotate-180' : 'rotate-0')}
          aria-hidden="true"
        />
      </button>

      {isExpanded ? <div className="ai-reasoning-panel">{children}</div> : null}
    </section>
  )
}

/** 单个思考过程面板：正文被剥离后，这里只保留思考内容和工具调用 */
function AgentReasoningSegment({
  entries,
  toolResultMap,
  expandedToolIds,
  nowMs,
  onToggleToolCard,
}: {
  entries: AgentReasoningEntry[]
  toolResultMap: Map<string, AiAgentToolTranscriptMessage>
  expandedToolIds: Record<string, boolean>
  nowMs: number
  onToggleToolCard: (toolCallId: string) => void
}) {
  return (
    <div className="ai-agent-timeline">
      {entries.map((entry) => {
        if (entry.type === 'reasoning') {
          return (
            <div key={entry.key} className="ai-agent-step-body ai-agent-step-body--reasoning">
              <AiMarkdown content={entry.content} />
            </div>
          )
        }

        return (
          <ToolInvocationCard
            key={entry.key}
            toolCall={entry.toolCall}
            result={toolResultMap.get(entry.toolCall.id)}
            isExpanded={expandedToolIds[entry.toolCall.id] === true}
            nowMs={nowMs}
            onToggle={() => onToggleToolCard(entry.toolCall.id)}
          />
        )
      })}
    </div>
  )
}

/** 展示可持久化 agent transcript，并在正文出现时切断思考过程 */
function AgentTranscriptFlow({
  transcript,
  messageContent,
  isStreaming,
  isReasoningExpanded,
  onToggleReasoning,
  reasoningTitle,
  reasoningDurationLabel,
}: {
  transcript: AiAgentTranscriptMessage[]
  messageContent: string
  isStreaming: boolean
  isReasoningExpanded: boolean
  onToggleReasoning: () => void
  reasoningTitle: string
  reasoningDurationLabel: string | null
}) {
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({})
  const [reasoningSegmentToggleStates, setReasoningSegmentToggleStates] = useState<
    Record<string, AgentReasoningSegmentToggleState>
  >({})
  const [nowMs, setNowMs] = useState(() => Date.now())
  const toolResultMap = createToolResultMap(transcript)
  const hasPendingTools = hasPendingToolCalls(transcript, toolResultMap)
  const segments = buildAgentDisplaySegments(transcript, messageContent)
  const reasoningSegments = segments.filter(
    (segment): segment is AgentReasoningDisplaySegment => segment.type === 'reasoning'
  )
  const lastReasoningSegmentKey = reasoningSegments[reasoningSegments.length - 1]?.key ?? null
  const activeReasoningSegmentKey = isStreaming ? lastReasoningSegmentKey : null

  useEffect(() => {
    if (!hasPendingTools) return

    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [hasPendingTools])

  useEffect(() => {
    const validSegmentKeys = new Set(reasoningSegments.map((segment) => segment.key))
    setReasoningSegmentToggleStates((current) => {
      const nextState = Object.fromEntries(
        Object.entries(current).filter(([segmentKey]) => validSegmentKeys.has(segmentKey))
      ) as Record<string, AgentReasoningSegmentToggleState>
      const hasSameKeys =
        Object.keys(nextState).length === Object.keys(current).length &&
        Object.entries(nextState).every(([segmentKey, toggleState]) => current[segmentKey] === toggleState)

      return hasSameKeys ? current : nextState
    })
  }, [reasoningSegments])

  /** 切换某个工具卡片的展开状态；默认始终保持折叠 */
  function handleToggleToolCard(toolCallId: string) {
    setExpandedToolIds((current) => {
      if (current[toolCallId]) {
        const nextState = { ...current }
        delete nextState[toolCallId]
        return nextState
      }
      return {
        ...current,
        [toolCallId]: true,
      }
    })
  }

  /** 切换单个思考过程的展开状态：流式中的当前段默认展开，完成段默认收起 */
  function handleToggleReasoningSegment(segmentKey: string) {
    setReasoningSegmentToggleStates((current) => {
      const toggleState = current[segmentKey]
      const isActiveSegment = segmentKey === activeReasoningSegmentKey
      const isExpandedByDefault = isActiveSegment

      if (toggleState === undefined) {
        return {
          ...current,
          [segmentKey]: isExpandedByDefault ? 'collapsed' : 'expanded',
        }
      }

      const nextState = { ...current }
      delete nextState[segmentKey]
      return nextState
    })
  }

  /** 计算单个思考过程的当前展开状态 */
  function getReasoningSegmentExpanded(segmentKey: string): boolean {
    const toggleState = reasoningSegmentToggleStates[segmentKey]
    if (toggleState === 'expanded') return true
    if (toggleState === 'collapsed') return false
    return segmentKey === activeReasoningSegmentKey
  }

  if (segments.length === 0) {
    if (!isStreaming) return null

    return (
      <ReasoningBlock
        title={reasoningTitle}
        durationLabel={reasoningDurationLabel}
        isExpanded={isReasoningExpanded}
        onToggle={onToggleReasoning}
      >
        <div className="ai-reasoning-placeholder">正在等待模型返回可展示的思考过程...</div>
      </ReasoningBlock>
    )
  }

  return (
    <div className="ai-assistant-flow">
      {segments.map((segment) => {
        if (segment.type === 'content') {
          return (
            <div key={segment.key} className="ai-message-content ai-assistant-content ai-assistant-content--intermediate">
              <AiMarkdown content={segment.content} />
            </div>
          )
        }

        return (
          <ReasoningBlock
            key={segment.key}
            title={segment.key === lastReasoningSegmentKey ? reasoningTitle : '思考过程'}
            durationLabel={
              formatReasoningDuration(segment.reasoningDurationMs) ??
              (segment.key === lastReasoningSegmentKey ? reasoningDurationLabel : null)
            }
            isExpanded={getReasoningSegmentExpanded(segment.key)}
            onToggle={() => handleToggleReasoningSegment(segment.key)}
          >
            <AgentReasoningSegment
              entries={segment.entries}
              toolResultMap={toolResultMap}
              expandedToolIds={expandedToolIds}
              nowMs={nowMs}
              onToggleToolCard={handleToggleToolCard}
            />
          </ReasoningBlock>
        )
      })}
    </div>
  )
}

/** assistant 消息：区分思考轨与正文轨，并负责思考折叠交互 */
export function AiAssistantMessage({
  message,
  isStreaming,
  isReasoningExpanded,
  onToggleReasoning,
  onCopy,
  onRegenerate,
  onRevertFileEdits,
  isRevertingFileEdits,
}: Props) {
  const hasReasoningContent = Boolean(message.reasoningContent?.trim())
  const hasAgentTranscript = Boolean(message.agentTranscript?.length)
  const hasStandaloneReasoningBlock = !hasAgentTranscript && shouldShowReasoningBlock(message, isStreaming)
  const reasoningDurationLabel = formatReasoningDuration(message.reasoningDurationMs)
  const reasoningTitle = getReasoningTitle(hasAgentTranscript, isStreaming, message.isReasoningComplete)
  const meta = getMessageMetaData(message)
  const hasMetaData = meta.cacheStats || meta.promptTokens || meta.completionTokens || meta.reasoningTokens

  return (
    <div className="ai-assistant-shell">
      {hasAgentTranscript ? (
        <AgentTranscriptFlow
          transcript={message.agentTranscript ?? []}
          messageContent={message.content}
          isStreaming={isStreaming}
          isReasoningExpanded={isReasoningExpanded}
          onToggleReasoning={onToggleReasoning}
          reasoningTitle={reasoningTitle}
          reasoningDurationLabel={reasoningDurationLabel}
        />
      ) : hasStandaloneReasoningBlock ? (
        <ReasoningBlock
          title={reasoningTitle}
          durationLabel={reasoningDurationLabel}
          isExpanded={isReasoningExpanded}
          onToggle={onToggleReasoning}
        >
          {hasReasoningContent ? (
            <div className="ai-reasoning-body">
              <AiMarkdown content={message.reasoningContent ?? ''} />
            </div>
          ) : (
            <div className="ai-reasoning-placeholder">正在等待模型返回可展示的思考过程...</div>
          )}
        </ReasoningBlock>
      ) : null}

      {message.content ? (
        <div className="ai-message-content ai-assistant-content">
          <AiMarkdown content={message.content} />
          {isStreaming ? <span className="ai-streaming-cursor" aria-hidden="true" /> : null}
        </div>
      ) : isStreaming ? (
        <div className="ai-answer-streaming-placeholder">
          <span>正在生成回复</span>
          <span className="ai-streaming-cursor" aria-hidden="true" />
        </div>
      ) : null}

      {!isStreaming ? (
        <FileEditSummaryCard
          message={message}
          isReverting={isRevertingFileEdits}
          onRevert={onRevertFileEdits}
        />
      ) : null}

      <div className="ai-message-footer">
        {hasMetaData ? (
          <div className="ai-message-meta" aria-label="缓存与用量">
            <MetaPill meta={meta} />
          </div>
        ) : null}
        {!isStreaming ? (
          <div className="ai-assistant-actions">
            <button
              type="button"
              className="ai-action-btn"
              onClick={onCopy}
              aria-label="复制"
              title="复制"
            >
              <Copy className="size-3.5" />
            </button>
            <button
              type="button"
              className="ai-action-btn"
              onClick={onRegenerate}
              aria-label="重新生成"
              title="重新生成"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
