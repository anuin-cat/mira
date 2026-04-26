import { ChevronDown, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AiChatMessage, AiTokenUsage } from '../../domain/ai'
import { AiMarkdown } from './AiMarkdown'

interface Props {
  message: AiChatMessage
  isStreaming: boolean
  isReasoningExpanded: boolean
  onToggleReasoning: () => void
}

/** 把思考耗时整理成适合标题展示的短文本 */
function formatReasoningDuration(reasoningDurationMs: number | null | undefined): string | null {
  if (reasoningDurationMs === null || reasoningDurationMs === undefined) return null

  const durationSeconds = reasoningDurationMs / 1000
  if (durationSeconds < 10) return `用时 ${durationSeconds.toFixed(1)} 秒`
  return `用时 ${Math.round(durationSeconds)} 秒`
}

/** 判断当前 assistant 消息是否需要展示思考折叠块 */
function shouldShowReasoningBlock(message: AiChatMessage, isStreaming: boolean): boolean {
  return Boolean(message.reasoningContent?.trim()) || (isStreaming && !message.content.trim())
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

/** 生成 assistant 消息底部的缓存与 token 用量说明 */
function getMessageMetaItems(message: AiChatMessage): string[] {
  const items: string[] = []
  const tokenUsage = message.tokenUsage
  const cacheStats = getPromptCacheStats(tokenUsage)

  if (message.isFromCache) items.push('Mira 本地缓存命中')

  if (cacheStats) {
    items.push(`接口缓存 ${Math.round(cacheStats.hitRate * 100)}%`)
    items.push(`命中 ${formatTokenCount(cacheStats.hitTokens)}`)
    if (cacheStats.missTokens !== null) items.push(`未命中 ${formatTokenCount(cacheStats.missTokens)}`)
  }

  const promptTokens = formatTokenCount(tokenUsage?.promptTokens)
  const completionTokens = formatTokenCount(tokenUsage?.completionTokens)
  const reasoningTokens = formatTokenCount(tokenUsage?.reasoningTokens)

  if (promptTokens) items.push(`输入 ${promptTokens}`)
  if (completionTokens) items.push(`输出 ${completionTokens}`)
  if (reasoningTokens) items.push(`推理 ${reasoningTokens}`)

  return items.filter(Boolean)
}

/** assistant 消息：区分思考轨与正文轨，并负责思考折叠交互 */
export function AiAssistantMessage({
  message,
  isStreaming,
  isReasoningExpanded,
  onToggleReasoning,
}: Props) {
  const hasReasoningBlock = shouldShowReasoningBlock(message, isStreaming)
  const hasReasoningContent = Boolean(message.reasoningContent?.trim())
  const reasoningDurationLabel = formatReasoningDuration(message.reasoningDurationMs)
  const reasoningTitle = isStreaming && !message.isReasoningComplete ? '思考中' : '已思考'
  const metaItems = getMessageMetaItems(message)

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
              {hasReasoningContent ? (
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

      {metaItems.length > 0 ? (
        <div className="ai-message-meta" aria-label="缓存与用量">
          {metaItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
