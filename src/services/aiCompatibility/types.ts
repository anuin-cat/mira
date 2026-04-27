import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'
import type { AiCompatibilityMode } from '../../domain/ai'

export interface AiProviderIdentity {
  id: string
  presetId: string | null
  label: string
  baseURL: string
  model: string
}

export interface CreateChatCompletionParamsInput {
  model: string
  temperature: number
  messages: ChatCompletionMessageParam[]
  tools: ChatCompletionTool[]
}

export interface CreateAssistantMessageInput {
  content: string
  reasoningContent: string
  toolCalls: ChatCompletionMessageToolCall[]
}

export type ChatCompletionAssistantMessageWithReasoning = ChatCompletionAssistantMessageParam & {
  reasoning_content?: string
}

export interface AiCompatibilityAdapter {
  mode: AiCompatibilityMode
  createChatCompletionParams: (input: CreateChatCompletionParamsInput) => ChatCompletionCreateParamsStreaming
  createAssistantMessage: (input: CreateAssistantMessageInput) => ChatCompletionMessageParam
  extractReasoningDelta: (delta: unknown) => string
}
