import type { AiChatSession } from '@/domain/ai'
import { AiAssistantMessage } from '../messages/AiAssistantMessage'
import { AiUserMessage } from '../messages/AiUserMessage'

interface Props {
  currentSession: AiChatSession | null
  streamingMessageId: string | null
  collapsedReasoningMessageIds: Record<string, boolean>
  revertingBatchIds: Record<string, boolean>
  onToggleReasoning: (messageId: string) => void
  onCopy: (text: string) => void
  onRegenerate: (messageId: string) => void
  onRevertFileEdits: (messageId: string) => void
}

/** 侧栏消息列表：只负责把会话消息映射成用户气泡或 assistant 回复 */
export function AiSidebarMessages({
  currentSession,
  streamingMessageId,
  collapsedReasoningMessageIds,
  revertingBatchIds,
  onToggleReasoning,
  onCopy,
  onRegenerate,
  onRevertFileEdits,
}: Props) {
  if (!currentSession?.messages.length) {
    return (
      <div className="ai-empty-state">
        <strong>可以直接围绕当前笔记提问</strong>
        <p>例如让它总结、追问、提炼结构，或者帮你把这篇笔记延展开来。</p>
      </div>
    )
  }

  return currentSession.messages.map((message) =>
    message.role === 'assistant' ? (
      <article key={message.id} className="ai-message ai-message-assistant">
        <AiAssistantMessage
          message={message}
          isStreaming={streamingMessageId === message.id}
          isReasoningExpanded={!collapsedReasoningMessageIds[message.id]}
          onToggleReasoning={() => onToggleReasoning(message.id)}
          onCopy={() => onCopy(message.content)}
          onRegenerate={() => onRegenerate(message.id)}
          onRevertFileEdits={() => onRevertFileEdits(message.id)}
          isRevertingFileEdits={message.fileEditBatch ? revertingBatchIds[message.fileEditBatch.id] === true : false}
        />
      </article>
    ) : (
      <article key={message.id} className="ai-message ai-message-user">
        <AiUserMessage content={message.content} />
      </article>
    )
  )
}
