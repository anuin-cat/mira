import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AiChatMessage, AiChatRequest, AiChatResult, AiNoteContext, AiTokenUsage } from '../domain/ai'
import {
  AgentToolRegistry,
  convertAgentTranscriptToCompletionMessages,
  createVaultAgentTools,
  runChatCompletionAgent,
} from './agent'

const NOTE_CONTEXT_CHAR_LIMIT = 12000

export interface AiChatStreamUpdate {
  content: string
  reasoningContent: string
  isReasoningComplete: boolean
  reasoningDurationMs: number | null
}

interface RequestAiChatReplyOptions {
  assistantMessageId?: string
  onUpdate?: (update: AiChatStreamUpdate) => void
  signal?: AbortSignal
}

/** 创建统一的取消异常，方便上层识别“主动中断”而不是“请求失败” */
function createAbortError(): Error {
  try {
    return new DOMException('请求已取消', 'AbortError')
  } catch {
    const error = new Error('请求已取消')
    error.name = 'AbortError'
    return error
  }
}

/** 在关键节点检查请求是否已被取消，避免继续回推 UI */
function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw createAbortError()
}

/** 生成消息 id，兼容不支持 randomUUID 的环境 */
function createAiMessageId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 截断长文本，避免单条笔记直接占满上下文窗口 */
function clipText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n\n[已截断剩余内容，共 ${value.length - limit} 个字符未发送]`
}

/** 把当前笔记整理为模型更容易理解的上下文说明 */
function buildNoteContextPrompt(noteContext: AiNoteContext): string | null {
  if (!noteContext.path && !noteContext.content.trim()) return null

  const sections = ['以下是当前用户正在编辑的 Markdown 笔记，请结合内容回答：']

  if (noteContext.title) sections.push(`标题：${noteContext.title}`)
  if (noteContext.path) sections.push(`路径：${noteContext.path}`)
  sections.push('内容：')
  sections.push(clipText(noteContext.content, NOTE_CONTEXT_CHAR_LIMIT) || '(空白文档)')

  return sections.join('\n')
}

/** 把内部聊天消息转换为 OpenAI 兼容消息数组 */
function buildCompletionMessages(request: AiChatRequest): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: request.settings.systemPrompt },
  ]
  const noteContextPrompt = buildNoteContextPrompt(request.noteContext)
  if (noteContextPrompt) messages.push({ role: 'system', content: noteContextPrompt })

  const historyMessages = request.session.messages.flatMap((message): ChatCompletionMessageParam[] => {
    if (message.role === 'user') {
      return [
        {
          role: 'user',
          content: message.content,
        },
      ]
    }

    const transcriptMessages = convertAgentTranscriptToCompletionMessages(message.agentTranscript)
    if (transcriptMessages.length > 0) return transcriptMessages

    return [
      {
        role: 'assistant',
        content: message.content,
      },
    ]
  })

  messages.push(...historyMessages, { role: 'user', content: request.userMessage })
  return messages
}

/** 创建统一的 assistant 消息对象 */
function createAssistantMessage(
  content: string,
  options: {
    id?: string
    reasoningContent?: string
    reasoningDurationMs?: number | null
    isReasoningComplete?: boolean
    tokenUsage?: AiTokenUsage | null
    agentTranscript?: AiChatMessage['agentTranscript']
  } = {}
): AiChatMessage {
  const message: AiChatMessage = {
    id: options.id ?? createAiMessageId(),
    role: 'assistant',
    content,
    createdAt: new Date().toISOString(),
  }

  if (typeof options.reasoningContent === 'string' && options.reasoningContent.length > 0) {
    message.reasoningContent = options.reasoningContent
  }
  if (options.reasoningDurationMs !== undefined) {
    message.reasoningDurationMs = options.reasoningDurationMs
  }
  if (typeof options.isReasoningComplete === 'boolean') {
    message.isReasoningComplete = options.isReasoningComplete
  }
  if (options.tokenUsage) {
    message.tokenUsage = options.tokenUsage
  }
  if (options.agentTranscript?.length) {
    message.agentTranscript = options.agentTranscript
  }

  return message
}

/** 向 OpenAI 兼容接口发送一次对话请求，支持流式正文与思考轨 */
export async function requestAiChatReply(
  request: AiChatRequest,
  options: RequestAiChatReplyOptions = {}
): Promise<AiChatResult> {
  // 1. 先校验必填设置，避免发出无意义请求
  throwIfAborted(options.signal)
  const { apiKey, baseURL, model, temperature } = request.settings
  if (!apiKey.trim()) throw new Error('请先在设置中填写 API Key')
  if (!baseURL.trim()) throw new Error('请先在设置中填写 Base URL')
  if (!model.trim()) throw new Error('请先在设置中填写模型名称')

  // 2. 生成消息数组；展示元数据不发送，但持久化的 agent transcript 会原样重放
  const messages = buildCompletionMessages(request)

  // 3. 走 agent 循环，把工具调用结果追加在原始消息之后
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({
    apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
  })

  const toolRegistry = new AgentToolRegistry(createVaultAgentTools())
  const agentResult = await runChatCompletionAgent({
    client,
    model,
    temperature,
    messages,
    vaultPath: request.vaultPath,
    toolRegistry,
    onUpdate: options.onUpdate,
    signal: options.signal,
  })

  // 4. 收尾补全状态；接口缓存统计只写入本地聊天记录，agent transcript 用于后续前缀缓存
  const normalizedContent = agentResult.content.trim()
  throwIfAborted(options.signal)

  return {
    message: createAssistantMessage(normalizedContent, {
      id: options.assistantMessageId,
      reasoningContent: agentResult.reasoningContent || undefined,
      reasoningDurationMs: agentResult.reasoningDurationMs,
      isReasoningComplete: agentResult.reasoningContent ? agentResult.isReasoningComplete : undefined,
      tokenUsage: agentResult.tokenUsage,
      agentTranscript: agentResult.agentTranscript,
    }),
  }
}
