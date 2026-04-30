import { Copy, FilePenLine, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AiChatMessage } from '@/domain/ai'
import { AiMarkdown } from '../markdown/AiMarkdown'
import { AgentTranscriptFlow, getReasoningTitle, formatReasoningDuration, ReasoningBlock, shouldShowReasoningBlock } from './AiAgentTranscript'
import { getMessageMetaData, MetaPill } from './AiMessageMeta'
import './ai-message.css'

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
