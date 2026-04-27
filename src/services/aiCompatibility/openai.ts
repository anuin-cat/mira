import type { AiCompatibilityAdapter } from './types'
import { createOpenAiAssistantMessage, createOpenAiChatCompletionParams } from './utils'

export const openAiCompatibility: AiCompatibilityAdapter = {
  mode: 'openai',
  createChatCompletionParams(input) {
    return createOpenAiChatCompletionParams(input, true)
  },
  createAssistantMessage(input) {
    return createOpenAiAssistantMessage(input)
  },
  extractReasoningDelta() {
    return ''
  },
}
