import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { AiTokenUsage } from '../../domain/ai'

export type AgentToolInput = Record<string, unknown>

export interface AgentToolContext {
  vaultPath: string
  signal?: AbortSignal
}

export interface AgentToolExecutionContext extends AgentToolContext {
  toolCallId: string
  toolName: string
}

export interface AgentToolResult {
  content: string
  isError?: boolean
}

export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (input: AgentToolInput, context: AgentToolExecutionContext) => Promise<AgentToolResult>
}

export interface AgentToolCall {
  id: string
  name: string
  argumentsText: string
}

export interface AgentToolExecutionTrace {
  toolCallId: string
  toolName: string
  argumentsText: string
  durationMs: number
  isError: boolean
}

export interface AgentRunStreamUpdate {
  content: string
  reasoningContent: string
  isReasoningComplete: boolean
  reasoningDurationMs: number | null
}

export interface AgentRunResult {
  content: string
  reasoningContent: string
  reasoningDurationMs: number | null
  isReasoningComplete: boolean
  tokenUsage: AiTokenUsage | null
  toolTraces: AgentToolExecutionTrace[]
}

export interface AgentToolRegistryLike {
  readonly chatCompletionTools: ChatCompletionTool[]
  executeToolCall: (toolCall: AgentToolCall, context: AgentToolContext) => Promise<{
    content: string
    trace: AgentToolExecutionTrace
  }>
}
