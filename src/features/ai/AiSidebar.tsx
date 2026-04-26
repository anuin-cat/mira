import { History, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import type { AiChatMessage, AiChatSession, AiSettingsState } from '../../domain/ai'
import { requestAiChatReply, type AiChatStreamUpdate } from '../../services/aiService'
import {
  createAiChatSession,
  createAiSessionTitle,
  loadAiChatSessions,
  loadAiSettings,
  resolveActiveAiRequestSettings,
  saveAiChatSessions,
  saveAiSettings,
  selectAiProviderModel,
} from '../../services/aiSettingsService'
import { AiAssistantMessage } from './AiAssistantMessage'
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

/** 统一生成聊天消息 id */
function createChatMessageId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 统一生成 user 消息对象 */
function createUserMessage(content: string): AiChatMessage {
  return {
    id: createChatMessageId(),
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  }
}

/** 创建一条空 assistant 占位消息，用于承接流式增量 */
function createAssistantPlaceholderMessage(): AiChatMessage {
  return {
    id: createChatMessageId(),
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    isReasoningComplete: false,
  }
}

/** 提取错误里的可展示信息 */
function getAiErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message
  return '请求失败，请稍后重试'
}

/** 判断失败是否来自主动取消，避免把切换笔记误报成请求错误 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** 选择当前笔记最合适的会话：优先同笔记，其次最近一条 */
function pickSessionIdForNote(sessions: AiChatSession[], notePath: string | null): string | null {
  if (sessions.length === 0) return null
  const matchedSession = sessions.find((session) => session.notePath === notePath)
  return matchedSession?.id ?? sessions[0]?.id ?? null
}

/** 顶栏展示：有首条用户消息则用其摘要，否则占位 */
function getSidebarHeaderLabel(session: AiChatSession | null): string {
  if (!session) return '新对话'
  const firstUser = session.messages.find((message) => message.role === 'user')
  if (firstUser?.content.trim()) return createAiSessionTitle(firstUser.content, null)
  return '新对话'
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

/** 为输入框下方的模型选择器生成分组结构 */
function buildComposerModelGroups(settings: AiSettingsState) {
  return settings.providers
    .filter((provider) => provider.models.length > 0)
    .map((provider) => ({
      providerId: provider.id,
      providerLabel: provider.label,
      options: provider.models.map((model) => ({
        value: `${provider.id}::${model.id}`,
        label: model.label,
      })),
    }))
}

/** 解析下拉框里的 provider/model 复合值 */
function parseComposerModelValue(value: string): { providerId: string; modelId: string } | null {
  const separatorIndex = value.indexOf('::')
  if (separatorIndex <= 0) return null

  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 2),
  }
}

/** 用一条新消息替换会话中的同 id 消息 */
function replaceMessageInSession(session: AiChatSession, nextMessage: AiChatMessage): AiChatSession {
  return {
    ...session,
    messages: session.messages.map((message) => (message.id === nextMessage.id ? nextMessage : message)),
  }
}

/** 侧边聊天栏：负责会话切换、设置编辑、流式发送与思考展示 */
export function AiSidebar({ vaultPath, notePath, noteTitle, noteContent }: Props) {
  const [settings, setSettings] = useState<AiSettingsState>(() => loadAiSettings())
  const [sessions, setSessions] = useState<AiChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [draftMessage, setDraftMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [collapsedReasoningMessageIds, setCollapsedReasoningMessageIds] = useState<Record<string, boolean>>({})

  const messageListRef = useRef<HTMLDivElement | null>(null)
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const previousNotePathRef = useRef<string | null>(notePath)
  const activeRequestIdRef = useRef(0)
  const activeAbortControllerRef = useRef<AbortController | null>(null)

  /** 同步会话到内存与 localStorage */
  function commitSessions(
    nextSessions: AiChatSession[],
    nextCurrentSessionId = currentSessionId,
    shouldPersist = true
  ) {
    // 1. 先按更新时间倒序，保证历史面板和默认选择都稳定
    const sortedSessions = [...nextSessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    // 2. 再同步到 React state 和当前 vault 的本地历史
    setSessions(sortedSessions)
    setCurrentSessionId(nextCurrentSessionId)
    if (shouldPersist) saveAiChatSessions(vaultPath, sortedSessions)
  }

  /** 让当前流式请求失效，并尝试中断底层网络流 */
  function invalidateActiveRequest() {
    activeRequestIdRef.current += 1
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
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
    invalidateActiveRequest()
    const nextSessions = loadAiChatSessions(vaultPath)
    setSessions(nextSessions)
    setCurrentSessionId(pickSessionIdForNote(nextSessions, notePath))
    setIsHistoryOpen(false)
    setErrorMessage(null)
    setIsSending(false)
    setStreamingMessageId(null)
    setCollapsedReasoningMessageIds({})
  }, [notePath, vaultPath])

  useEffect(() => {
    if (previousNotePathRef.current === notePath) return
    previousNotePathRef.current = notePath
    setCurrentSessionId(pickSessionIdForNote(sessions, notePath))
  }, [notePath, sessions])

  useEffect(() => {
    return () => {
      invalidateActiveRequest()
    }
  }, [])

  useEffect(() => {
    const messageList = messageListRef.current
    if (!messageList) return

    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior: streamingMessageId ? 'auto' : 'smooth',
    })
  }, [currentSessionId, sessions, streamingMessageId])

  useEffect(() => {
    if (!composerInputRef.current) return
    resizeComposerInput(composerInputRef.current)
  }, [draftMessage])

  const currentSession = sessions.find((session) => session.id === currentSessionId) ?? null
  const activeRequestSettings = resolveActiveAiRequestSettings(settings)
  const composerModelGroups = buildComposerModelGroups(settings)
  const composerModelValue = activeRequestSettings.model
    ? `${activeRequestSettings.providerId}::${activeRequestSettings.model}`
    : ''

  /** 保存设置并立刻生效；closeDialog 为 true 时关闭设置弹层 */
  function handleSaveSettings(nextSettings: AiSettingsState, closeDialog: boolean) {
    setSettings(nextSettings)
    saveAiSettings(nextSettings)
    if (closeDialog) setIsSettingsOpen(false)
  }

  /** 从输入框内的紧凑选择器切换当前 provider 与 model */
  function handleComposerModelChange(value: string) {
    // 1. 先从下拉值里拆出 provider 和 model
    const parsedValue = parseComposerModelValue(value)
    if (!parsedValue) return

    // 2. 选中该 provider 下的模型，并把它切到当前默认使用
    const nextSettings = selectAiProviderModel(
      settings,
      parsedValue.providerId,
      parsedValue.modelId,
      true
    )

    // 3. 立即保存到本机设置，让下一条消息直接使用它
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

  /** 切换某条 assistant 消息的思考折叠状态 */
  function handleToggleReasoning(messageId: string) {
    setCollapsedReasoningMessageIds((current) => {
      if (current[messageId]) {
        const nextState = { ...current }
        delete nextState[messageId]
        return nextState
      }
      return {
        ...current,
        [messageId]: true,
      }
    })
  }

  /** 发送一条用户消息，并用当前笔记作为额外上下文 */
  async function handleSendMessage() {
    // 1. 先做基础校验，避免空消息和重复提交
    const trimmedMessage = draftMessage.trim()
    if (!trimmedMessage || isSending) return

    // 2. 准备会话快照、占位 assistant 消息与 optimistic UI
    const baseSession = currentSession ?? createAndSelectSession()
    const userMessage = createUserMessage(trimmedMessage)
    const assistantPlaceholderMessage = createAssistantPlaceholderMessage()
    const requestId = activeRequestIdRef.current + 1
    const abortController = new AbortController()
    const nextTitle =
      baseSession.messages.length === 0 ? createAiSessionTitle(trimmedMessage, noteTitle) : baseSession.title
    const previousSessions = currentSession ? sessions : [baseSession, ...sessions]
    const remainingSessions = previousSessions.filter((session) => session.id !== baseSession.id)
    const optimisticSession: AiChatSession = {
      ...baseSession,
      title: nextTitle,
      notePath,
      noteTitle,
      updatedAt: userMessage.createdAt,
      messages: [...baseSession.messages, userMessage, assistantPlaceholderMessage],
    }

    setDraftMessage('')
    setErrorMessage(null)
    setIsSending(true)
    setStreamingMessageId(assistantPlaceholderMessage.id)
    activeRequestIdRef.current = requestId
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = abortController
    commitSessions([optimisticSession, ...remainingSessions], optimisticSession.id, false)

    /** 把最新流式快照合并进 assistant 占位消息 */
    function handleStreamUpdate(update: AiChatStreamUpdate) {
      if (activeRequestIdRef.current !== requestId) return

      // 1. 先把推理轨和正文轨映射到本地消息结构
      const streamingMessage: AiChatMessage = {
        ...assistantPlaceholderMessage,
        content: update.content,
      }
      if (update.reasoningContent) {
        streamingMessage.reasoningContent = update.reasoningContent
        streamingMessage.reasoningDurationMs = update.reasoningDurationMs
        streamingMessage.isReasoningComplete = update.isReasoningComplete
      }

      // 2. 再覆盖 optimistic 会话里的占位消息，让 UI 实时刷新
      const streamingSession = replaceMessageInSession(optimisticSession, streamingMessage)
      commitSessions([streamingSession, ...remainingSessions], streamingSession.id, false)
    }

    try {
      // 3. 发起流式请求；命中缓存时也复用同一条 assistant 消息落位
      const result = await requestAiChatReply(
        {
          vaultPath,
          settings: activeRequestSettings,
          session: baseSession,
          noteContext: {
            path: notePath,
            title: noteTitle,
            content: noteContent,
          },
          userMessage: trimmedMessage,
        },
        {
          assistantMessageId: assistantPlaceholderMessage.id,
          onUpdate: handleStreamUpdate,
          signal: abortController.signal,
        }
      )
      if (activeRequestIdRef.current !== requestId) return

      // 4. 最终把完成态 assistant 消息补进会话，并更新排序时间
      const completedSession = replaceMessageInSession(
        {
          ...optimisticSession,
          updatedAt: result.message.createdAt,
        },
        result.message
      )
      commitSessions([completedSession, ...remainingSessions], completedSession.id)
    } catch (error) {
      if (activeRequestIdRef.current !== requestId || isAbortError(error)) return

      // 5. 请求失败时回滚 optimistic 结果，并恢复输入框，方便用户修改后重试
      commitSessions(previousSessions, baseSession.id)
      setDraftMessage(trimmedMessage)
      setErrorMessage(getAiErrorMessage(error))
    } finally {
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null
      }
      if (activeRequestIdRef.current !== requestId) return

      setIsSending(false)
      setStreamingMessageId(null)
    }
  }

  return (
    <aside className="ai-sidebar">
      <header className="ai-sidebar-header">
        <div className="ai-sidebar-title">
          <span className="ai-sidebar-session-heading">{getSidebarHeaderLabel(currentSession)}</span>
        </div>
        <div className="ai-sidebar-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsHistoryOpen((value) => !value)}
            aria-label="历史"
          >
            <History className="size-[18px]" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="设置"
          >
            <Settings className="size-[18px]" aria-hidden />
          </Button>
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
              {message.role === 'assistant' ? (
                <AiAssistantMessage
                  message={message}
                  isStreaming={streamingMessageId === message.id}
                  isReasoningExpanded={!collapsedReasoningMessageIds[message.id]}
                  onToggleReasoning={() => handleToggleReasoning(message.id)}
                />
              ) : (
                <div className="ai-message-content">
                  <div className="ai-message-plain-text">{message.content}</div>
                </div>
              )}
            </article>
          ))
        ) : (
          <div className="ai-empty-state">
            <strong>可以直接围绕当前笔记提问</strong>
            <p>例如让它总结、追问、提炼结构，或者帮你把这篇笔记延展开来。</p>
          </div>
        )}
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
            <Select value={composerModelValue} onValueChange={handleComposerModelChange}>
              <SelectTrigger>
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent position="popper" side="top">
                {composerModelGroups.map((group) => (
                  <SelectGroup key={group.providerId}>
                    <SelectLabel>{group.providerLabel}</SelectLabel>
                    {group.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label || '选择模型'}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="size-8 shrink-0 rounded-full shadow-[0_4px_12px_color-mix(in_srgb,var(--theme-text-primary)_18%,transparent_82%)] transition-[transform,box-shadow,opacity] hover:-translate-y-px hover:shadow-[0_8px_18px_color-mix(in_srgb,var(--theme-text-primary)_22%,transparent_78%)] active:translate-y-0 active:shadow-[0_3px_10px_color-mix(in_srgb,var(--theme-text-primary)_14%,transparent_86%)] disabled:opacity-[0.36] disabled:shadow-none disabled:hover:translate-y-0"
              onClick={() => void handleSendMessage()}
              disabled={!draftMessage.trim() || isSending}
              aria-label="发送消息"
            >
              <svg
                className="size-[18px] fill-none stroke-current stroke-[2.2] [stroke-linecap:round] [stroke-linejoin:round]"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path d="M10 16V4m0 0L5.5 8.5M10 4l4.5 4.5" />
              </svg>
            </Button>
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
