export type AiProviderId = 'deepseek' | 'siliconflow' | 'modelscope' | 'custom'

/** OpenAI 兼容提供商预设 */
export interface AiProviderPreset {
  id: AiProviderId
  label: string
  defaultBaseUrl: string
  defaultModel: string
  apiKeyPlaceholder: string
}

/** AI 设置：保存在当前设备本地，不进入 vault */
export interface AiProviderSettings {
  providerId: AiProviderId
  apiKey: string
  baseURL: string
  model: string
  systemPrompt: string
  temperature: number
}

export type AiChatRole = 'user' | 'assistant'

/** 聊天消息 */
export interface AiChatMessage {
  id: string
  role: AiChatRole
  content: string
  createdAt: string
  isFromCache?: boolean
}

/** 单个聊天会话 */
export interface AiChatSession {
  id: string
  title: string
  vaultPath: string
  notePath: string | null
  noteTitle: string | null
  createdAt: string
  updatedAt: string
  messages: AiChatMessage[]
}

/** 当前编辑中的笔记上下文 */
export interface AiNoteContext {
  path: string | null
  title: string | null
  content: string
}

/** 发起一次聊天请求所需的上下文 */
export interface AiChatRequest {
  vaultPath: string
  settings: AiProviderSettings
  session: AiChatSession
  noteContext: AiNoteContext
  userMessage: string
}

/** 聊天返回结果 */
export interface AiChatResult {
  message: AiChatMessage
  isFromCache: boolean
}
