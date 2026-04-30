import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  type AiChatMessage,
  type AiChatSession,
  type AiSettingsState,
} from '@/domain/ai'
import { revertAiFileEditBatch } from '@/services/agent'
import {
  getAiChatErrorFileEditBatch,
  requestAiChatReply,
  type AiChatStreamUpdate,
} from '@/services/aiService'
import {
  createAiChatSession,
  createAiSessionTitle,
  loadAiChatSessions,
  loadAiSettings,
  resolveActiveAiRequestSettings,
  saveAiChatSessions,
  saveAiSettings,
  selectAiProviderModel,
} from '@/services/aiSettingsService'
import { AiComposer, buildAiUserPrompt, type AiComposerHandle, type AiComposerPart } from '../composer'
import { AiSettingsDialog } from '../settings'
import { AiHistoryPanel } from './AiHistoryPanel'
import { AiSidebarHeader } from './AiSidebarHeader'
import { AiSidebarMessages } from './AiSidebarMessages'
import './ai-sidebar.css'

import {
  buildComposerModelGroups,
  createAssistantPlaceholderMessage,
  createUserMessage,
  getAiErrorMessage,
  isAbortError,
  isMessageListNearBottom,
  parseComposerModelValue,
  pickSessionIdForNote,
  replaceMessageInSession,
  type AiSidebarHandle,
  type AiSidebarProps,
} from './aiSidebarModel'

export type { AiSidebarHandle } from './aiSidebarModel'

/** 侧边聊天栏：负责会话切换、设置编辑、流式发送与思考展示 */
export const AiSidebar = forwardRef<AiSidebarHandle, AiSidebarProps>(function AiSidebar(
  { vaultPath, notePath, noteTitle, noteContent, onBeforeAgentRequest, getCurrentNoteSnapshot, onAgentFilesChanged },
  ref
) {
  const [settings, setSettings] = useState<AiSettingsState>(() => loadAiSettings())
  const [sessions, setSessions] = useState<AiChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [revertingBatchIds, setRevertingBatchIds] = useState<Record<string, boolean>>({})
  const [collapsedReasoningMessageIds, setCollapsedReasoningMessageIds] = useState<Record<string, boolean>>({})
  const [isMessageListPinnedToBottom, setIsMessageListPinnedToBottom] = useState(true)

  const messageListRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<AiComposerHandle | null>(null)
  const previousScrolledSessionIdRef = useRef<string | null>(null)
  const activeRequestIdRef = useRef(0)
  const activeAbortControllerRef = useRef<AbortController | null>(null)
  const isMessageListPinnedToBottomRef = useRef(true)

  /** 同步“是否吸底”的 ref 与 state，避免滚动事件里反复触发无效 setState */
  function updateMessageListPinnedState(nextPinnedToBottom: boolean) {
    // 1. 先用 ref 挡掉重复值，减少滚动时的无意义重渲染
    if (isMessageListPinnedToBottomRef.current === nextPinnedToBottom) return

    // 2. 再同步到 ref 和 React state，让后续 effect 能基于最新状态决定是否滚动
    isMessageListPinnedToBottomRef.current = nextPinnedToBottom
    setIsMessageListPinnedToBottom(nextPinnedToBottom)
  }

  /** 统一切换某条 assistant 消息的思考面板展开状态 */
  function setReasoningExpanded(messageId: string, shouldExpand: boolean) {
    setCollapsedReasoningMessageIds((current) => {
      const isCollapsed = current[messageId] === true
      if (shouldExpand) {
        if (!isCollapsed) return current

        const nextState = { ...current }
        delete nextState[messageId]
        return nextState
      }

      if (isCollapsed) return current
      return {
        ...current,
        [messageId]: true,
      }
    })
  }

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
    previousScrolledSessionIdRef.current = null
    isMessageListPinnedToBottomRef.current = true
    setIsMessageListPinnedToBottom(true)
  }, [vaultPath])

  useEffect(() => {
    return () => {
      invalidateActiveRequest()
    }
  }, [])

  useEffect(() => {
    const messageList = messageListRef.current
    if (!messageList) return
    const currentMessageList: HTMLDivElement = messageList

    /** 根据用户是否仍贴底，决定要不要继续自动滚动 */
    function handleScroll() {
      updateMessageListPinnedState(isMessageListNearBottom(currentMessageList))
    }

    handleScroll()
    currentMessageList.addEventListener('scroll', handleScroll, { passive: true })
    return () => currentMessageList.removeEventListener('scroll', handleScroll)
  }, [currentSessionId])

  useEffect(() => {
    const messageList = messageListRef.current
    if (!messageList) return

    const hasSessionChanged = previousScrolledSessionIdRef.current !== currentSessionId
    previousScrolledSessionIdRef.current = currentSessionId
    if (!hasSessionChanged && !isMessageListPinnedToBottom) return

    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior: streamingMessageId || hasSessionChanged ? 'auto' : 'smooth',
    })
  }, [currentSessionId, isMessageListPinnedToBottom, sessions, streamingMessageId])

  const currentSession = sessions.find((session) => session.id === currentSessionId) ?? null
  const activeRequestSettings = resolveActiveAiRequestSettings(settings)
  const composerModelGroups = buildComposerModelGroups(settings)
  const rawComposerModelValue = activeRequestSettings.model
    ? `${activeRequestSettings.providerId}::${activeRequestSettings.model}`
    : ''
  const composerModelValue =
    rawComposerModelValue &&
    composerModelGroups.some((group) => group.options.some((option) => option.value === rawComposerModelValue))
      ? rawComposerModelValue
      : ''

  useImperativeHandle(ref, () => ({
    createSession() {
      handleCreateSession()
    },
    focusComposer() {
      window.requestAnimationFrame(() => composerRef.current?.focus())
    },
    fillCurrentNotePrompt(prompt: string) {
      if (!composerRef.current?.hasContent()) composerRef.current?.setPlainText(prompt)
      setIsHistoryOpen(false)
      setErrorMessage(null)
      window.requestAnimationFrame(() => composerRef.current?.focus())
    },
    addReference(reference) {
      composerRef.current?.addReference(reference)
      setIsHistoryOpen(false)
      setErrorMessage(null)
      window.requestAnimationFrame(() => composerRef.current?.focus())
    },
    openSettings() {
      setIsSettingsOpen(true)
    },
    isComposerFocused() {
      return composerRef.current?.isFocused() ?? false
    },
  }))

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
    if (isSending) return

    if (!currentSession || currentSession.messages.length) createAndSelectSession()
    setIsHistoryOpen(false)
    setErrorMessage(null)
    composerRef.current?.clear()
    window.requestAnimationFrame(() => composerRef.current?.focus())
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

  /** 复制文本到剪贴板 */
  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 静默失败
    }
  }

  /** 回退某条 assistant 消息产生的所有 agent 文件修改 */
  async function handleRevertFileEdits(messageId: string) {
    if (!currentSession || isSending) return

    const targetMessage = currentSession.messages.find((message) => message.id === messageId)
    const batch = targetMessage?.fileEditBatch
    if (!targetMessage || !batch || batch.isReverted || revertingBatchIds[batch.id]) return

    setErrorMessage(null)
    setRevertingBatchIds((current) => ({ ...current, [batch.id]: true }))

    try {
      await onBeforeAgentRequest()
      const changedPaths = await revertAiFileEditBatch(vaultPath, batch)
      const revertedMessage: AiChatMessage = {
        ...targetMessage,
        fileEditBatch: {
          ...batch,
          isReverted: true,
          revertedAt: new Date().toISOString(),
        },
      }
      const nextSession = replaceMessageInSession(
        {
          ...currentSession,
          updatedAt: revertedMessage.fileEditBatch?.revertedAt ?? currentSession.updatedAt,
        },
        revertedMessage
      )
      const remainingSessions = sessions.filter((session) => session.id !== currentSession.id)
      commitSessions([nextSession, ...remainingSessions], nextSession.id)
      await onAgentFilesChanged(changedPaths)
    } catch (error) {
      setErrorMessage(getAiErrorMessage(error))
    } finally {
      setRevertingBatchIds((current) => {
        const nextState = { ...current }
        delete nextState[batch.id]
        return nextState
      })
    }
  }

  /** 核心发送逻辑：用指定内容和会话发起 AI 请求 */
  async function doSendMessage(
    trimmedMessage: string,
    baseSession: AiChatSession,
    previousSessions: AiChatSession[],
    restoreComposerParts: AiComposerPart[] | null = null
  ) {
    if (isSending) return

    const userMessage = createUserMessage(trimmedMessage)
    const assistantPlaceholderMessage = createAssistantPlaceholderMessage()
    const requestId = activeRequestIdRef.current + 1
    const abortController = new AbortController()
    const nextTitle =
      baseSession.messages.length === 0 ? createAiSessionTitle(trimmedMessage, noteTitle) : baseSession.title
    const remainingSessions = previousSessions.filter((session) => session.id !== baseSession.id)
    const optimisticSession: AiChatSession = {
      ...baseSession,
      title: nextTitle,
      notePath,
      noteTitle,
      updatedAt: userMessage.createdAt,
      messages: [...baseSession.messages, userMessage, assistantPlaceholderMessage],
    }

    setErrorMessage(null)
    setIsSending(true)
    setStreamingMessageId(assistantPlaceholderMessage.id)
    setReasoningExpanded(assistantPlaceholderMessage.id, true)
    updateMessageListPinnedState(true)
    activeRequestIdRef.current = requestId
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = abortController
    commitSessions([optimisticSession, ...remainingSessions], optimisticSession.id, false)
    let latestAssistantMessage = assistantPlaceholderMessage

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
      if (update.agentTranscript.length > 0) {
        streamingMessage.agentTranscript = update.agentTranscript
      }
      latestAssistantMessage = streamingMessage

      // 3. 未完成时保持展开，完成后自动收起，方便用户继续看后续正文
      if (update.reasoningContent || update.agentTranscript.length > 0 || update.isReasoningComplete) {
        setReasoningExpanded(assistantPlaceholderMessage.id, !update.isReasoningComplete)
      }

      // 4. 再覆盖 optimistic 会话里的占位消息，让 UI 实时刷新
      const streamingSession = replaceMessageInSession(optimisticSession, streamingMessage)
      commitSessions([streamingSession, ...remainingSessions], streamingSession.id, false)
    }

    try {
      await onBeforeAgentRequest()
      const currentNoteSnapshot = getCurrentNoteSnapshot()
      const noteContextContent = currentNoteSnapshot?.path === notePath ? currentNoteSnapshot.content : noteContent

      // 3. 发起流式请求；命中缓存时也复用同一条 assistant 消息落位
      const result = await requestAiChatReply(
        {
          vaultPath,
          settings: activeRequestSettings,
          session: baseSession,
          noteContext: {
            path: notePath,
            title: noteTitle,
            content: noteContextContent,
          },
          userMessage: trimmedMessage,
        },
        {
          assistantMessageId: assistantPlaceholderMessage.id,
          onUpdate: handleStreamUpdate,
          getCurrentNoteSnapshot,
          onVaultFilesChanged: onAgentFilesChanged,
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
      if (result.message.reasoningContent?.trim() || result.message.agentTranscript?.length) {
        setReasoningExpanded(result.message.id, false)
      }
      commitSessions([completedSession, ...remainingSessions], completedSession.id)
    } catch (error) {
      if (activeRequestIdRef.current !== requestId) return
      const fileEditBatch = getAiChatErrorFileEditBatch(error)
      if (!fileEditBatch && isAbortError(error)) return
      if (fileEditBatch) {
        const failedMessage: AiChatMessage = {
          ...latestAssistantMessage,
          content: latestAssistantMessage.content || '文件修改已完成，但后续回复生成失败。',
          fileEditBatch,
          isReasoningComplete: true,
        }
        const failedSession = replaceMessageInSession(
          {
            ...optimisticSession,
            updatedAt: new Date().toISOString(),
          },
          failedMessage
        )
        commitSessions([failedSession, ...remainingSessions], failedSession.id)
        setErrorMessage(getAiErrorMessage(error))
        return
      }

      // 5. 请求失败时回滚 optimistic 结果，并恢复输入框，方便用户修改后重试
      commitSessions(previousSessions, baseSession.id)
      if (!composerRef.current?.hasContent()) {
        if (restoreComposerParts) {
          composerRef.current?.setParts(restoreComposerParts)
        } else {
          composerRef.current?.setPlainText(trimmedMessage)
        }
      }
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

  /** 从输入框发送一条用户消息 */
  async function handleSendMessage(parts: AiComposerPart[]) {
    const composerParts = parts.length > 0 ? parts : composerRef.current?.getParts() ?? []
    const trimmedMessage = buildAiUserPrompt(composerParts).trim()
    if (!trimmedMessage || isSending) return

    const baseSession = currentSession ?? createAndSelectSession()
    const previousSessions = currentSession ? sessions : [baseSession, ...sessions]

    composerRef.current?.clear()
    await doSendMessage(trimmedMessage, baseSession, previousSessions, composerParts)
  }

  /** 重新生成某条 assistant 消息的回复 */
  async function handleRegenerate(assistantMessageId: string) {
    if (!currentSession || isSending) return

    const assistantIndex = currentSession.messages.findIndex((m) => m.id === assistantMessageId)
    if (assistantIndex <= 0) return

    // 1. 找到上一条 user 消息
    let userMessageIndex = -1
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (currentSession.messages[i].role === 'user') {
        userMessageIndex = i
        break
      }
    }
    if (userMessageIndex === -1) return

    const userMessage = currentSession.messages[userMessageIndex]

    // 2. 截断历史到 userMessage 之前（不包含 userMessage）
    const truncatedMessages = currentSession.messages.slice(0, userMessageIndex)
    const truncatedSession: AiChatSession = {
      ...currentSession,
      messages: truncatedMessages,
      updatedAt: new Date().toISOString(),
    }

    const otherSessions = sessions.filter((s) => s.id !== currentSession.id)
    const previousSessions = [truncatedSession, ...otherSessions]
    commitSessions(previousSessions, truncatedSession.id, false)

    // 3. 用那条 user 消息重新发送
    await doSendMessage(userMessage.content, truncatedSession, previousSessions)
  }

  return (
    <aside className="ai-sidebar">
      <AiSidebarHeader
        currentSession={currentSession}
        onToggleHistory={() => setIsHistoryOpen((value) => !value)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

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
        <AiSidebarMessages
          currentSession={currentSession}
          streamingMessageId={streamingMessageId}
          collapsedReasoningMessageIds={collapsedReasoningMessageIds}
          revertingBatchIds={revertingBatchIds}
          onToggleReasoning={handleToggleReasoning}
          onCopy={(text) => void handleCopy(text)}
          onRegenerate={(messageId) => void handleRegenerate(messageId)}
          onRevertFileEdits={(messageId) => void handleRevertFileEdits(messageId)}
        />
      </div>

      {errorMessage ? <div className="ai-error-banner">{errorMessage}</div> : null}

      <AiComposer
        ref={composerRef}
        modelGroups={composerModelGroups}
        modelValue={composerModelValue}
        isSending={isSending}
        onModelChange={handleComposerModelChange}
        onCreateSession={handleCreateSession}
        onSend={(parts) => void handleSendMessage(parts)}
      />

      {isSettingsOpen ? (
        <AiSettingsDialog
          initialSettings={settings}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      ) : null}
    </aside>
  )
})
