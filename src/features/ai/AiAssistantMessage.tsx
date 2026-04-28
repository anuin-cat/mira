import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  LoaderCircle,
  RefreshCw,
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
}

type AiAgentToolTranscriptMessage = Extract<AiAgentTranscriptMessage, { role: 'tool' }>

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

/** 展示可持久化 agent transcript，让工具调用与中间思考按时间线可见 */
function AgentTranscriptTimeline({
  transcript,
  messageContent,
}: {
  transcript: AiAgentTranscriptMessage[]
  messageContent: string
}) {
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({})
  const [nowMs, setNowMs] = useState(() => Date.now())
  const toolResultMap = createToolResultMap(transcript)
  const hasPendingTools = hasPendingToolCalls(transcript, toolResultMap)

  useEffect(() => {
    if (!hasPendingTools) return

    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [hasPendingTools])

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

  const renderedItems = transcript.map((item, index) => {
    if (item.role === 'tool') return null

    const toolCalls = item.toolCalls ?? []
    const hasToolCalls = toolCalls.length > 0
    const hasReasoning = Boolean(item.reasoningContent?.trim())
    const shouldShowContent = shouldShowAssistantTranscriptContent(
      transcript,
      index,
      item.content,
      messageContent,
      hasToolCalls
    )

    if (!hasReasoning && !hasToolCalls && !shouldShowContent) return null

    return (
      <div key={`assistant-${index}`} className="ai-agent-step">
        {hasReasoning ? (
          <div className="ai-agent-step-body ai-agent-step-body--reasoning">
            <AiMarkdown content={item.reasoningContent ?? ''} />
          </div>
        ) : null}

        {shouldShowContent ? (
          <div className="ai-agent-step-section">
            <div className="ai-agent-step-title">
              <FileText className="size-[14px]" aria-hidden="true" />
              <span>中间回复</span>
            </div>
            <div className="ai-agent-step-body">
              <AiMarkdown content={item.content} />
            </div>
          </div>
        ) : null}

        {toolCalls.map((toolCall) => (
          <ToolInvocationCard
            key={toolCall.id}
            toolCall={toolCall}
            result={toolResultMap.get(toolCall.id)}
            isExpanded={expandedToolIds[toolCall.id] === true}
            nowMs={nowMs}
            onToggle={() => handleToggleToolCard(toolCall.id)}
          />
        ))}
      </div>
    )
  })

  return (
    <div className="ai-agent-timeline">
      {renderedItems.some(Boolean) ? renderedItems : (
        <div className="ai-reasoning-placeholder">正在等待模型返回可展示的思考过程...</div>
      )}
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
}: Props) {
  const hasReasoningBlock = shouldShowReasoningBlock(message, isStreaming)
  const hasReasoningContent = Boolean(message.reasoningContent?.trim())
  const hasAgentTranscript = Boolean(message.agentTranscript?.length)
  const reasoningDurationLabel = formatReasoningDuration(message.reasoningDurationMs)
  const reasoningTitle = getReasoningTitle(hasAgentTranscript, isStreaming, message.isReasoningComplete)
  const meta = getMessageMetaData(message)
  const hasMetaData = meta.cacheStats || meta.promptTokens || meta.completionTokens || meta.reasoningTokens

  return (
    <div className="ai-assistant-shell">
      {hasReasoningBlock ? (
        <section className="ai-reasoning-block">
          <button
            type="button"
            className="ai-reasoning-toggle"
            aria-expanded={isReasoningExpanded}
            onClick={onToggleReasoning}
          >
            <span className="ai-reasoning-toggle-main">
              <span className="ai-reasoning-icon" aria-hidden="true">
                <Sparkles className="size-[15px]" />
              </span>
              <span className="ai-reasoning-title">{reasoningTitle}</span>
              {reasoningDurationLabel ? (
                <span className="ai-reasoning-duration">（{reasoningDurationLabel}）</span>
              ) : null}
            </span>
            <ChevronDown
              className={cn(
                'ai-reasoning-chevron size-[15px]',
                isReasoningExpanded ? 'rotate-180' : 'rotate-0'
              )}
              aria-hidden="true"
            />
          </button>

          {isReasoningExpanded ? (
            <div className="ai-reasoning-panel">
              {hasAgentTranscript ? (
                <AgentTranscriptTimeline
                  transcript={message.agentTranscript ?? []}
                  messageContent={message.content}
                />
              ) : hasReasoningContent ? (
                <div className="ai-reasoning-body">
                  <AiMarkdown content={message.reasoningContent ?? ''} />
                </div>
              ) : (
                <div className="ai-reasoning-placeholder">
                  正在等待模型返回可展示的思考过程...
                </div>
              )}
            </div>
          ) : null}
        </section>
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
