import { ChevronDown, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AiChatMessage } from '../../domain/ai'
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

  return (
    <div className="ai-assistant-shell">
      {message.isFromCache ? (
        <div className="ai-message-label">
          <span>缓存命中</span>
        </div>
      ) : null}

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
    </div>
  )
}
