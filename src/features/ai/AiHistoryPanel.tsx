import type { AiChatSession } from '../../domain/ai'

interface Props {
  sessions: AiChatSession[]
  currentSessionId: string | null
  onClose: () => void
  onCreateSession: () => void
  onDeleteSession: (sessionId: string) => void
  onSelectSession: (sessionId: string) => void
}

/** 把 ISO 时间转成简短的本地显示文本 */
function formatSessionTime(isoString: string): string {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** 聊天历史浮层：切换、删除与新建会话 */
export function AiHistoryPanel({
  sessions,
  currentSessionId,
  onClose,
  onCreateSession,
  onDeleteSession,
  onSelectSession,
}: Props) {
  return (
    <div className="ai-history-panel">
      <div className="ai-history-panel-header">
        <div>
          <h3>聊天历史</h3>
          <p>按最近更新时间排序。</p>
        </div>
        <button type="button" className="ai-ghost-button" onClick={onClose}>
          收起
        </button>
      </div>

      <button type="button" className="ai-secondary-button ai-history-new-button" onClick={onCreateSession}>
        新对话
      </button>

      {sessions.length === 0 ? (
        <div className="ai-history-empty">还没有历史对话，发出第一条消息后会出现在这里。</div>
      ) : (
        <div className="ai-history-list">
          {sessions.map((session) => (
            <article
              key={session.id}
              className={`ai-history-item${session.id === currentSessionId ? ' active' : ''}`}
            >
              <button
                type="button"
                className="ai-history-item-main"
                onClick={() => onSelectSession(session.id)}
              >
                <strong>{session.title}</strong>
                <span>{session.noteTitle || '未关联笔记'}</span>
                <time>{formatSessionTime(session.updatedAt)}</time>
              </button>
              <button
                type="button"
                className="ai-history-delete"
                onClick={() => onDeleteSession(session.id)}
              >
                删除
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
