import type { AiCompatibilityAdapter, ChatCompletionAssistantMessageWithReasoning } from './types'
import { createOpenAiChatCompletionParams, extractDeltaText, toRecord } from './utils'

export const kimiCompatibility: AiCompatibilityAdapter = {
  mode: 'kimi',
  createChatCompletionParams(input) {
    return createOpenAiChatCompletionParams(input, false)
  },
  createAssistantMessage(input) {
    const message: ChatCompletionAssistantMessageWithReasoning = {
      role: 'assistant',
      content: input.content,
    }

    if (input.reasoningContent) {
      message.reasoning_content = input.reasoningContent
    }
    if (input.toolCalls.length > 0) {
      message.tool_calls = input.toolCalls
    }

    return message
  },
  extractReasoningDelta(delta) {
    return extractDeltaText(toRecord(delta)?.reasoning_content)
  },
}
