export type AiBuiltinProviderId = 'deepseek' | 'siliconflow' | 'kimi'
export type AiProviderSource = 'builtin' | 'custom'

/** OpenAI 兼容提供商预设 */
export interface AiProviderPreset {
  id: AiBuiltinProviderId
  label: string
  defaultBaseUrl: string
  defaultModel: string
  apiKeyPlaceholder: string
}

/** 用户在某个 provider 下已保存的模型 */
export interface AiProviderModel {
  id: string
  label: string
  addedAt: string
}

/** 单个 provider 配置 */
export interface AiProviderConfig {
  id: string
  source: AiProviderSource
  presetId: AiBuiltinProviderId | null
  label: string
  baseURL: string
  apiKey: string
  models: AiProviderModel[]
  selectedModelId: string | null
}

/** AI 设置：保存在当前设备本地，不进入 vault */
export interface AiSettingsState {
  activeProviderId: string | null
  providers: AiProviderConfig[]
  systemPrompt: string
  temperature: number
}

/** 发请求前解析出的当前有效 AI 配置 */
export interface AiRequestSettings {
  providerId: string
  providerLabel: string
  apiKey: string
  baseURL: string
  model: string
  systemPrompt: string
  temperature: number
}

/** 从 provider 的 models 接口拉回的一条模型 */
export interface AiModelCatalogItem {
  id: string
  label: string
  ownedBy: string | null
}

export type AiChatRole = 'user' | 'assistant'

/** 聊天消息 */
export interface AiChatMessage {
  id: string
  role: AiChatRole
  content: string
  createdAt: string
  isFromCache?: boolean
  reasoningContent?: string
  reasoningDurationMs?: number | null
  isReasoningComplete?: boolean
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
  settings: AiRequestSettings
  session: AiChatSession
  noteContext: AiNoteContext
  userMessage: string
}

/** 聊天返回结果 */
export interface AiChatResult {
  message: AiChatMessage
  isFromCache: boolean
}
