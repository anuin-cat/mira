import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { CreateAssistantMessageInput, CreateChatCompletionParamsInput } from './types'

/** 把未知对象收窄为可按键读取的 Record */
export function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** 递归提取字符串片段，兼容 string / 数组 / { text } 这几类常见返回 */
export function collectTextParts(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((item) => collectTextParts(item))

  const candidate = toRecord(value)
  if (!candidate) return []
  if (typeof candidate.text === 'string') return [candidate.text]
  if ('content' in candidate) return collectTextParts(candidate.content)

  return []
}

/** 提取流式 delta 里的文本内容 */
export function extractDeltaText(content: unknown): string {
  return collectTextParts(content).join('')
}

/** 创建普通 OpenAI Chat Completions 流式请求参数 */
export function createOpenAiChatCompletionParams(
  input: CreateChatCompletionParamsInput,
  includeStreamUsage: boolean
): ChatCompletionCreateParamsStreaming {
  const params: ChatCompletionCreateParamsStreaming = {
    model: input.model,
    temperature: input.temperature,
    messages: input.messages,
    tools: input.tools,
    tool_choice: 'auto',
    stream: true,
  }

  if (includeStreamUsage) {
    params.stream_options = {
      include_usage: true,
    }
  }

  return params
}

/** 创建普通 OpenAI assistant 消息，只有标准 content 与 tool_calls */
export function createOpenAiAssistantMessage(input: CreateAssistantMessageInput): ChatCompletionMessageParam {
  const message: ChatCompletionMessageParam = {
    role: 'assistant',
    content: input.content,
  }

  if (input.toolCalls.length > 0) {
    message.tool_calls = input.toolCalls
  }

  return message
}
