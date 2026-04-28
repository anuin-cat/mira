export type AiBuiltinProviderId = 'deepseek' | 'siliconflow' | 'kimi'
export type AiProviderSource = 'builtin' | 'custom'
export type AiCompatibilityMode = 'openai' | 'deepseek' | 'siliconflow' | 'kimi'

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
  isEnabled: boolean
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
  compatibilityMode: AiCompatibilityMode
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

/** 单次 AI 响应的 token 与接口缓存用量 */
export interface AiTokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  promptCacheHitTokens?: number
  promptCacheMissTokens?: number
  promptCachedTokens?: number
  reasoningTokens?: number
}

/** agent 文件编辑中用于回退的替换后区间 */
export interface AiFileEditRange {
  start: number
  end: number
}

/** agent 单次文本替换操作，按顺序回放可撤销本次 AI 修改 */
export interface AiFileEditOperation {
  path: string
  oldText: string
  newText: string
  replaceAll: boolean
  occurrenceCount: number
  ranges: AiFileEditRange[]
}

/** 单个文件在一次 assistant 回复中的修改摘要 */
export interface AiFileEditSummary {
  path: string
  beforeHash: string
  afterHash: string
  addedLines: number
  removedLines: number
  operationCount: number
}

/** 一次 assistant 回复产生的可回退文件修改批次 */
export interface AiFileEditBatch {
  id: string
  createdAt: string
  files: AiFileEditSummary[]
  operations: AiFileEditOperation[]
  isReverted?: boolean
  revertedAt?: string
}

/** agent 工具调用记录中的 function call */
export interface AiAgentTranscriptToolCall {
  id: string
  name: string
  argumentsText: string
  startedAt?: string
}

/** agent 完整 API transcript，用于后续请求复用工具结果与接口前缀缓存 */
export type AiAgentTranscriptMessage =
  | {
      role: 'assistant'
      content: string
      reasoningContent?: string
      reasoningDurationMs?: number | null
      toolCalls?: AiAgentTranscriptToolCall[]
    }
  | {
      role: 'tool'
      toolCallId: string
      toolName?: string
      argumentsText?: string
      content: string
      durationMs?: number
      isError?: boolean
    }

/** 聊天消息 */
export interface AiChatMessage {
  id: string
  role: AiChatRole
  content: string
  createdAt: string
  reasoningContent?: string
  reasoningDurationMs?: number | null
  isReasoningComplete?: boolean
  tokenUsage?: AiTokenUsage
  agentTranscript?: AiAgentTranscriptMessage[]
  fileEditBatch?: AiFileEditBatch
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
}
