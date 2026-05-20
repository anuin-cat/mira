import type { AiChatMessage, AiChatSession, AiSettingsState, AiTextReference } from '@/domain/ai'
import { createAiSessionTitle } from '@/services/aiSettingsService'

const AI_MESSAGE_LIST_BOTTOM_THRESHOLD = 40

export interface AiSidebarProps {
  vaultPath: string
  notePath: string | null
  noteTitle: string | null
  noteContent: string
  onBeforeAgentRequest: () => Promise<void>
  getCurrentNoteSnapshot: () => { path: string | null; content: string } | null
  onAgentFilesChanged: (paths: string[]) => Promise<void> | void
}

export interface AiSidebarHandle {
  createSession: () => void
  focusComposer: () => void
  fillCurrentNotePrompt: (prompt: string) => void
  addReference: (reference: AiTextReference) => void
  openSettings: () => void
  isComposerFocused: () => boolean
  stopGenerating: () => void
}

/** 统一生成聊天消息 id */
function createChatMessageId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 统一生成 user 消息对象 */
export function createUserMessage(content: string): AiChatMessage {
  return {
    id: createChatMessageId(),
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  }
}

/** 创建一条空 assistant 占位消息，用于承接流式增量 */
export function createAssistantPlaceholderMessage(): AiChatMessage {
  return {
    id: createChatMessageId(),
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    isReasoningComplete: false,
  }
}

/** 提取错误里的可展示信息 */
export function getAiErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message
  return '请求失败，请稍后重试'
}

/** 判断失败是否来自主动取消，避免把切换笔记误报成请求错误 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** 选择当前笔记最合适的会话：优先同笔记，其次最近一条 */
export function pickSessionIdForNote(sessions: AiChatSession[], notePath: string | null): string | null {
  if (sessions.length === 0) return null
  const matchedSession = sessions.find((session) => session.notePath === notePath)
  return matchedSession?.id ?? sessions[0]?.id ?? null
}

/** 顶栏展示：有首条用户消息则用其摘要，否则占位 */
export function getSidebarHeaderLabel(session: AiChatSession | null): string {
  if (!session) return '新对话'
  const firstUser = session.messages.find((message) => message.role === 'user')
  if (firstUser?.content.trim()) return createAiSessionTitle(firstUser.content, null)
  return '新对话'
}

/** 判断消息列表是否还处在“吸底”范围内 */
export function isMessageListNearBottom(messageList: HTMLDivElement): boolean {
  const distanceToBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight
  return distanceToBottom <= AI_MESSAGE_LIST_BOTTOM_THRESHOLD
}

/** 为输入框下方的模型选择器生成分组结构 */
export function buildComposerModelGroups(settings: AiSettingsState) {
  return settings.providers
    .filter((provider) => provider.isEnabled && provider.models.length > 0)
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
export function parseComposerModelValue(value: string): { providerId: string; modelId: string } | null {
  const separatorIndex = value.indexOf('::')
  if (separatorIndex <= 0) return null

  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 2),
  }
}

/** 用一条新消息替换会话中的同 id 消息 */
export function replaceMessageInSession(session: AiChatSession, nextMessage: AiChatMessage): AiChatSession {
  return {
    ...session,
    messages: session.messages.map((message) => (message.id === nextMessage.id ? nextMessage : message)),
  }
}
