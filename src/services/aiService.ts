import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AiChatMessage, AiChatRequest, AiChatResult, AiNoteContext } from '../domain/ai'
import { createAiCacheKey, readAiCacheEntry, writeAiCacheEntry } from './aiCacheService'

const NOTE_CONTEXT_CHAR_LIMIT = 12000
const MAX_HISTORY_MESSAGES = 16

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

  const historyMessages = request.session.messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content,
  }))

  messages.push(...historyMessages, { role: 'user', content: request.userMessage })
  return messages
}

/** 提取兼容接口返回的文本内容 */
function extractCompletionText(content: unknown): string {
  if (typeof content === 'string') return content.trim()

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text
        }
        return ''
      })
      .join('\n')
      .trim()
  }

  return ''
}

/** 根据当前请求构建缓存 key，命中后直接返回历史结果 */
async function buildAiCacheKey(request: AiChatRequest, messages: ChatCompletionMessageParam[]): Promise<string> {
  return await createAiCacheKey({
    providerId: request.settings.providerId,
    baseURL: request.settings.baseURL,
    model: request.settings.model,
    systemPrompt: request.settings.systemPrompt,
    temperature: request.settings.temperature,
    notePath: request.noteContext.path,
    noteTitle: request.noteContext.title,
    messages,
  })
}

/** 创建统一的 assistant 消息对象 */
function createAssistantMessage(content: string, isFromCache = false): AiChatMessage {
  return {
    id: createAiMessageId(),
    role: 'assistant',
    content,
    createdAt: new Date().toISOString(),
    isFromCache,
  }
}

/** 向 OpenAI 兼容接口发送一次对话请求，并落本地缓存 */
export async function requestAiChatReply(request: AiChatRequest): Promise<AiChatResult> {
  // 1. 先校验必填设置，避免发出无意义请求
  const { apiKey, baseURL, model, temperature } = request.settings
  if (!apiKey.trim()) throw new Error('请先在设置中填写 API Key')
  if (!baseURL.trim()) throw new Error('请先在设置中填写 Base URL')
  if (!model.trim()) throw new Error('请先在设置中填写模型名称')

  // 2. 生成消息数组与缓存 key，优先命中本地 cache
  const messages = buildCompletionMessages(request)
  const cacheKey = await buildAiCacheKey(request, messages)
  const cachedEntry = await readAiCacheEntry(request.vaultPath, cacheKey)
  if (cachedEntry) {
    return {
      message: createAssistantMessage(cachedEntry.assistantMessage, true),
      isFromCache: true,
    }
  }

  // 3. 缓存未命中时调用 OpenAI 兼容接口，再把结果写回 .mira/cache/llm
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({
    apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
  })
  const completion = await client.chat.completions.create({
    model,
    temperature,
    messages,
  })

  const content = extractCompletionText(completion.choices[0]?.message?.content)
  if (!content) throw new Error('模型没有返回可用内容')

  await writeAiCacheEntry(request.vaultPath, cacheKey, {
    assistantMessage: content,
    createdAt: new Date().toISOString(),
  })

  return {
    message: createAssistantMessage(content),
    isFromCache: false,
  }
}
