import type { AiCompatibilityAdapter } from './types'
import { createOpenAiAssistantMessage, createOpenAiChatCompletionParams, extractDeltaText, toRecord } from './utils'

export const siliconFlowCompatibility: AiCompatibilityAdapter = {
  mode: 'siliconflow',
  createChatCompletionParams(input) {
    return createOpenAiChatCompletionParams(input, false)
  },
  createAssistantMessage(input) {
    return createOpenAiAssistantMessage(input)
  },
  extractReasoningDelta(delta) {
    return extractDeltaText(toRecord(delta)?.reasoning_content)
  },
}
