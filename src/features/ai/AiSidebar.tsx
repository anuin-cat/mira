import { useEffect, useRef, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import type { AiChatMessage, AiChatSession, AiProviderSettings } from '../../domain/ai'
import { requestAiChatReply } from '../../services/aiService'
import {
  AI_PROVIDER_PRESETS,
  createAiChatSession,
  createAiSessionTitle,
  getAiProviderPreset,
  loadAiChatSessions,
  loadAiSettings,
  saveAiChatSessions,
  saveAiSettings,
  selectAiProviderPreset,
} from '../../services/aiSettingsService'
import { AiMarkdown } from './AiMarkdown'
import { AiHistoryPanel } from './AiHistoryPanel'
import { AiSettingsDialog } from './AiSettingsDialog'
import './ai-sidebar.css'

const AI_COMPOSER_MIN_ROWS = 3
const AI_COMPOSER_MAX_ROWS = 8
const AI_COMPOSER_FALLBACK_LINE_HEIGHT = 22

interface Props {
  vaultPath: string
  notePath: string | null
  noteTitle: string | null
  noteContent: string
}

/** 统一生成 user 消息对象 */
function createUserMessage(content: string): AiChatMessage {
  return {
    id:
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  }
}

/** 提取错误里的可展示信息 */
function getAiErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message
  return '请求失败，请稍后重试'
}

/** 选择当前笔记最合适的会话：优先同笔记，其次最近一条 */
function pickSessionIdForNote(sessions: AiChatSession[], notePath: string | null): string | null {
  if (sessions.length === 0) return null
  const matchedSession = sessions.find((session) => session.notePath === notePath)
  return matchedSession?.id ?? sessions[0]?.id ?? null
}

/** 根据内容把输入框高度限制在 3 到 8 行之间 */
function resizeComposerInput(textarea: HTMLTextAreaElement) {
  // 1. 先恢复自动高度，让删除内容时输入框也能收回
  textarea.style.height = 'auto'

  // 2. 根据当前字体行高计算 3 行和 8 行的真实像素高度
  const styles = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(styles.lineHeight) || AI_COMPOSER_FALLBACK_LINE_HEIGHT
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0
  const minHeight = lineHeight * AI_COMPOSER_MIN_ROWS + paddingTop + paddingBottom
  const maxHeight = lineHeight * AI_COMPOSER_MAX_ROWS + paddingTop + paddingBottom
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight))

  // 3. 超过 8 行后固定高度并开启内部滚动
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

/** 侧边聊天栏：负责会话切换、设置编辑与消息发送 */
export function AiSidebar({ vaultPath, notePath, noteTitle, noteContent }: Props) {
  const [settings, setSettings] = useState<AiProviderSettings>(() => loadAiSettings())
  const [sessions, setSessions] = useState<AiChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [draftMessage, setDraftMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const messageListRef = useRef<HTMLDivElement | null>(null)
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const previousNotePathRef = useRef<string | null>(notePath)

  /** 同步会话到内存与 localStorage */
  function commitSessions(nextSessions: AiChatSession[], nextCurrentSessionId = currentSessionId) {
    // 1. 先按更新时间倒序，保证历史面板和默认选择都稳定
    const sortedSessions = [...nextSessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    // 2. 再同步到 React state 和当前 vault 的本地历史
    setSessions(sortedSessions)
    setCurrentSessionId(nextCurrentSessionId)
    saveAiChatSessions(vaultPath, sortedSessions)
  }

  /** 创建并选中一个新会话 */
  function createAndSelectSession(): AiChatSession {
    // 1. 基于当前笔记创建一条空会话，方便用户在同一篇笔记下连续追问
    const nextSession = createAiChatSession(vaultPath, notePath, noteTitle)

    // 2. 写回历史并切换当前会话
    commitSessions([nextSession, ...sessions], nextSession.id)
    return nextSession
  }

  useEffect(() => {
    const nextSessions = loadAiChatSessions(vaultPath)
    setSessions(nextSessions)
    setCurrentSessionId(pickSessionIdForNote(nextSessions, notePath))
    setIsHistoryOpen(false)
  }, [vaultPath, notePath])

  useEffect(() => {
    if (previousNotePathRef.current === notePath) return
    previousNotePathRef.current = notePath
    setCurrentSessionId(pickSessionIdForNote(sessions, notePath))
  }, [notePath, sessions])

  useEffect(() => {
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [currentSessionId, sessions, isSending])

  useEffect(() => {
    if (!composerInputRef.current) return
    resizeComposerInput(composerInputRef.current)
  }, [draftMessage])

  const currentSession = sessions.find((session) => session.id === currentSessionId) ?? null
  const currentProviderPreset = getAiProviderPreset(settings.providerId)
  const hasCustomModelLabel =
    Boolean(settings.model) && settings.model !== currentProviderPreset.defaultModel
  const composerModelOptions = [
    ...(hasCustomModelLabel
      ? [
          {
            value: 'current',
            id: settings.providerId,
            label: settings.model,
          },
        ]
      : []),
    ...AI_PROVIDER_PRESETS.map((preset) => ({
      value: preset.id,
      id: preset.id,
      label: preset.defaultModel || preset.label,
    })),
  ]
  const composerModelValue = hasCustomModelLabel ? 'current' : settings.providerId

  /** 保存设置并立刻生效 */
  function handleSaveSettings(nextSettings: AiProviderSettings) {
    setSettings(nextSettings)
    saveAiSettings(nextSettings)
    setIsSettingsOpen(false)
  }

  /** 从输入框内的紧凑选择器切换模型预设 */
  function handleComposerModelChange(providerId: AiProviderSettings['providerId']) {
    // 1. 下拉选择代表明确选中目标模型预设，因此直接套用对应默认模型
    const nextSettings = selectAiProviderPreset(settings, providerId)

    // 2. 立即保存到本机设置，让下一条消息使用新模型
    setSettings(nextSettings)
    saveAiSettings(nextSettings)
  }

  /** 新建会话并关闭历史面板 */
  function handleCreateSession() {
    createAndSelectSession()
    setIsHistoryOpen(false)
    setErrorMessage(null)
  }

  /** 删除会话，并尽量保留合理的当前选中项 */
  function handleDeleteSession(sessionId: string) {
    // 1. 先从会话列表中移除目标项
    const nextSessions = sessions.filter((session) => session.id !== sessionId)

    // 2. 如果删掉的是当前会话，则自动切换到同笔记最近会话
    const nextCurrentSessionId =
      currentSessionId === sessionId ? pickSessionIdForNote(nextSessions, notePath) : currentSessionId

    commitSessions(nextSessions, nextCurrentSessionId)
  }

  /** 发送一条用户消息，并用当前笔记作为额外上下文 */
  async function handleSendMessage() {
    // 1. 先做基础校验，避免空消息和重复提交
    const trimmedMessage = draftMessage.trim()
    if (!trimmedMessage || isSending) return

    // 2. 准备会话快照与 optimistic UI
    const baseSession = currentSession ?? createAndSelectSession()
    const userMessage = createUserMessage(trimmedMessage)
    const nextTitle =
      baseSession.messages.length === 0 ? createAiSessionTitle(trimmedMessage, noteTitle) : baseSession.title
    const previousSessions = currentSession ? sessions : [baseSession, ...sessions]
    const optimisticSession: AiChatSession = {
      ...baseSession,
      title: nextTitle,
      notePath,
      noteTitle,
      updatedAt: userMessage.createdAt,
      messages: [...baseSession.messages, userMessage],
    }
    const nextSessions = [
      optimisticSession,
      ...sessions.filter((session) => session.id !== optimisticSession.id),
    ]

    setDraftMessage('')
    setErrorMessage(null)
    setIsSending(true)
    commitSessions(nextSessions, optimisticSession.id)

    try {
      // 3. 发起模型请求，命中缓存时也走同一展示链路
      const result = await requestAiChatReply({
        vaultPath,
        settings,
        session: baseSession,
        noteContext: {
          path: notePath,
          title: noteTitle,
          content: noteContent,
        },
        userMessage: trimmedMessage,
      })

      // 4. 把 assistant 消息补进刚才的 optimistic 会话，并刷新历史排序
      const completedSession: AiChatSession = {
        ...optimisticSession,
        updatedAt: result.message.createdAt,
        messages: [...optimisticSession.messages, result.message],
      }
      commitSessions(
        [completedSession, ...nextSessions.filter((session) => session.id !== completedSession.id)],
        completedSession.id
      )
    } catch (error) {
      // 5. 请求失败时回滚 optimistic 结果，并恢复输入框，方便用户修改后重试
      commitSessions(previousSessions, baseSession.id)
      setDraftMessage(trimmedMessage)
      setErrorMessage(getAiErrorMessage(error))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <aside className="ai-sidebar">
      <header className="ai-sidebar-header">
        <div className="ai-sidebar-title">
          <strong>AI 对话</strong>
          <span>{noteTitle || '当前笔记'}</span>
        </div>
        <div className="ai-sidebar-actions">
          <button type="button" className="ai-toolbar-button" onClick={() => setIsHistoryOpen((value) => !value)}>
            历史
          </button>
          <button type="button" className="ai-toolbar-button" onClick={() => setIsSettingsOpen(true)}>
            设置
          </button>
        </div>
      </header>

      {isHistoryOpen ? (
        <AiHistoryPanel
          sessions={sessions}
          currentSessionId={currentSessionId}
          onClose={() => setIsHistoryOpen(false)}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          onSelectSession={(sessionId) => {
            setCurrentSessionId(sessionId)
            setIsHistoryOpen(false)
          }}
        />
      ) : null}

      <div ref={messageListRef} className="ai-message-list">
        {currentSession?.messages.length ? (
          currentSession.messages.map((message) => (
            <article key={message.id} className={`ai-message ai-message-${message.role}`}>
              {message.isFromCache ? (
                <div className="ai-message-label">
                  <span>缓存命中</span>
                </div>
              ) : null}
              <div className="ai-message-content">
                {message.role === 'assistant' ? (
                  <AiMarkdown content={message.content} />
                ) : (
                  <div className="ai-message-plain-text">{message.content}</div>
                )}
              </div>
            </article>
          ))
        ) : (
          <div className="ai-empty-state">
            <strong>可以直接围绕当前笔记提问</strong>
            <p>例如让它总结、追问、提炼结构，或者帮你把这篇笔记延展开来。</p>
          </div>
        )}
        {isSending ? <div className="ai-loading-bubble">正在思考...</div> : null}
      </div>

      {errorMessage ? <div className="ai-error-banner">{errorMessage}</div> : null}

      <div className="ai-composer">
        <div className="ai-composer-box">
          <textarea
            ref={composerInputRef}
            className="ai-composer-input"
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            placeholder="基于当前笔记继续聊..."
            rows={AI_COMPOSER_MIN_ROWS}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSendMessage()
              }
            }}
          />
          <div className="ai-composer-controls">
            <Select
              value={composerModelValue}
              onValueChange={(value) => {
                if (value === 'current') return
                handleComposerModelChange(value as AiProviderSettings['providerId'])
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="top">
                {composerModelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label || '选择模型'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              className="ai-send-button"
              onClick={() => void handleSendMessage()}
              disabled={!draftMessage.trim() || isSending}
              aria-label="发送消息"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 16V4m0 0L5.5 8.5M10 4l4.5 4.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {isSettingsOpen ? (
        <AiSettingsDialog
          initialSettings={settings}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      ) : null}
    </aside>
  )
}
