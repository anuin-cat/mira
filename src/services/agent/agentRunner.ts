import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import type { AiAgentTranscriptMessage, AiAgentTranscriptToolCall, AiTokenUsage } from '../../domain/ai'
import type { AiCompatibilityAdapter } from '../aiCompatibility'
import { extractDeltaText } from '../aiCompatibility/utils'
import type {
  AgentCurrentNoteSnapshot,
  AgentFileEditJournal,
  AgentRunResult,
  AgentRunStreamUpdate,
  AgentToolCall,
  AgentToolExecutionTrace,
  AgentToolRegistryLike,
} from './types'

const MAX_AGENT_STEPS = 6

interface RunChatCompletionAgentOptions {
  client: OpenAI
  model: string
  temperature: number
  messages: ChatCompletionMessageParam[]
  vaultPath: string
  toolRegistry: AgentToolRegistryLike
  compatibility: AiCompatibilityAdapter
  fileEditJournal?: AgentFileEditJournal
  getCurrentNoteSnapshot?: () => AgentCurrentNoteSnapshot | null
  onVaultFilesChanged?: (paths: string[]) => void | Promise<void>
  onUpdate?: (update: AgentRunStreamUpdate) => void
  signal?: AbortSignal
}

interface ToolCallDraft {
  index: number
  id: string
  name: string
  argumentsText: string
  startedAt: string
}

interface ModelTurnResult {
  content: string
  reasoningContent: string
  toolCalls: AgentToolCall[]
  isReasoningComplete: boolean
  reasoningDurationMs: number | null
  tokenUsage: AiTokenUsage | null
}

/** 创建统一的取消异常，方便上层识别主动中断 */
function createAbortError(): Error {
  try {
    return new DOMException('请求已取消', 'AbortError')
  } catch {
    const error = new Error('请求已取消')
    error.name = 'AbortError'
    return error
  }
}

/** 在关键节点检查请求是否已被取消 */
function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw createAbortError()
}

/** 把未知对象收窄为可按键读取的 Record */
function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** 从 provider 返回对象中读取非负数字段 */
function readUsageNumber(source: Record<string, unknown> | null, key: string): number | undefined {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** 提取 OpenAI 标准 usage 以及兼容接口扩展的缓存字段 */
function extractTokenUsage(value: unknown): AiTokenUsage | null {
  const usage = toRecord(value)
  if (!usage) return null

  const promptTokenDetails = toRecord(usage.prompt_tokens_details)
  const completionTokenDetails = toRecord(usage.completion_tokens_details)
  const tokenUsage: AiTokenUsage = {
    promptTokens: readUsageNumber(usage, 'prompt_tokens'),
    completionTokens: readUsageNumber(usage, 'completion_tokens'),
    totalTokens: readUsageNumber(usage, 'total_tokens'),
    promptCacheHitTokens: readUsageNumber(usage, 'prompt_cache_hit_tokens'),
    promptCacheMissTokens: readUsageNumber(usage, 'prompt_cache_miss_tokens'),
    promptCachedTokens: readUsageNumber(promptTokenDetails, 'cached_tokens'),
    reasoningTokens: readUsageNumber(completionTokenDetails, 'reasoning_tokens'),
  }

  const hasTokenUsage = Object.values(tokenUsage).some((item) => typeof item === 'number')
  return hasTokenUsage ? tokenUsage : null
}

/** 合并多轮工具调用产生的接口 usage */
function mergeTokenUsage(current: AiTokenUsage | null, next: AiTokenUsage | null): AiTokenUsage | null {
  if (!next) return current
  if (!current) return next

  return {
    promptTokens: mergeUsageNumber(current.promptTokens, next.promptTokens),
    completionTokens: mergeUsageNumber(current.completionTokens, next.completionTokens),
    totalTokens: mergeUsageNumber(current.totalTokens, next.totalTokens),
    promptCacheHitTokens: mergeUsageNumber(current.promptCacheHitTokens, next.promptCacheHitTokens),
    promptCacheMissTokens: mergeUsageNumber(current.promptCacheMissTokens, next.promptCacheMissTokens),
    promptCachedTokens: mergeUsageNumber(current.promptCachedTokens, next.promptCachedTokens),
    reasoningTokens: mergeUsageNumber(current.reasoningTokens, next.reasoningTokens),
  }
}

/** 累加两个可选 usage 数值 */
function mergeUsageNumber(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined
  return (left ?? 0) + (right ?? 0)
}

/** 提取兼容接口 chunk 中的正文增量 */
function extractContentDelta(delta: unknown): string {
  const candidate = toRecord(delta)
  if (!candidate) return ''
  return extractDeltaText(candidate.content)
}

/** 计算思考耗时；思考尚未结束时返回 null */
function getReasoningDurationMs(
  reasoningStartedAt: number | null,
  reasoningCompletedAt: number | null
): number | null {
  if (reasoningStartedAt === null || reasoningCompletedAt === null) return null
  return Math.max(0, reasoningCompletedAt - reasoningStartedAt)
}

/** 向上层派发一次流式快照，统一保证字段形状稳定 */
function emitStreamUpdate(
  onUpdate: RunChatCompletionAgentOptions['onUpdate'],
  content: string,
  reasoningContent: string,
  isReasoningComplete: boolean,
  reasoningDurationMs: number | null,
  agentTranscript: AiAgentTranscriptMessage[] = []
) {
  onUpdate?.({
    content,
    reasoningContent,
    isReasoningComplete,
    reasoningDurationMs,
    agentTranscript,
  })
}

/** 累积流式 tool_call 片段，兼容参数分片返回 */
function appendToolCallDeltas(toolCallDrafts: Map<number, ToolCallDraft>, delta: unknown, stepIndex: number): boolean {
  const candidate = toRecord(delta)
  const toolCalls = candidate?.tool_calls
  if (!Array.isArray(toolCalls)) return false

  for (const rawToolCall of toolCalls) {
    const toolCall = toRecord(rawToolCall)
    if (!toolCall || typeof toolCall.index !== 'number') continue

    const draft = toolCallDrafts.get(toolCall.index) ?? {
      index: toolCall.index,
      id: `mira_tool_${stepIndex}_${toolCall.index}`,
      name: '',
      argumentsText: '',
      startedAt: new Date().toISOString(),
    }

    if (typeof toolCall.id === 'string' && toolCall.id) draft.id = toolCall.id

    const functionDelta = toRecord(toolCall.function)
    if (typeof functionDelta?.name === 'string') draft.name += functionDelta.name
    if (typeof functionDelta?.arguments === 'string') draft.argumentsText += functionDelta.arguments

    toolCallDrafts.set(draft.index, draft)
  }

  return true
}

/** 把内部 tool call 转成 Chat Completions 的 assistant 消息格式 */
function createAssistantToolCallMessage(
  content: string,
  reasoningContent: string,
  compatibility: AiCompatibilityAdapter,
  toolCalls: AgentToolCall[]
): ChatCompletionMessageParam {
  return compatibility.createAssistantMessage({
    content,
    reasoningContent,
    toolCalls: toolCalls.map(
      (toolCall): ChatCompletionMessageToolCall => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.argumentsText,
        },
      })
    ),
  })
}

/** 把 agent 内部工具调用转换为可持久化 transcript */
function serializeToolCalls(toolCalls: AgentToolCall[]): AiAgentTranscriptToolCall[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    argumentsText: toolCall.argumentsText,
    startedAt: toolCall.startedAt,
  }))
}

/** 把流式工具调用草稿整理为稳定顺序，便于 UI 实时展示 */
function serializeToolCallDrafts(toolCallDrafts: Map<number, ToolCallDraft>): AgentToolCall[] {
  return [...toolCallDrafts.values()]
    .sort((a, b) => a.index - b.index)
    .filter((toolCall) => toolCall.name)
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      argumentsText: toolCall.argumentsText,
      startedAt: toolCall.startedAt,
    }))
}

/** 创建可持久化、可重放的 assistant transcript 消息 */
function createAssistantTranscriptMessage(
  content: string,
  reasoningContent: string,
  toolCalls: AgentToolCall[],
  reasoningDurationMs: number | null = null
): AiAgentTranscriptMessage {
  const message: AiAgentTranscriptMessage = {
    role: 'assistant',
    content,
  }

  if (reasoningContent) message.reasoningContent = reasoningContent
  if (reasoningDurationMs !== null) message.reasoningDurationMs = reasoningDurationMs
  if (toolCalls.length > 0) message.toolCalls = serializeToolCalls(toolCalls)

  return message
}

/** 创建可持久化、可展示的 tool transcript 消息 */
function createToolTranscriptMessage(
  toolCall: AgentToolCall,
  execution: { content: string; trace: AgentToolExecutionTrace }
): AiAgentTranscriptMessage {
  return {
    role: 'tool',
    toolCallId: toolCall.id,
    toolName: execution.trace.toolName,
    argumentsText: execution.trace.argumentsText,
    content: execution.content,
    durationMs: execution.trace.durationMs,
    isError: execution.trace.isError,
  }
}

/** 生成当前流式轮次的 transcript 快照，既用于即时展示也用于最终历史 */
function createTranscriptSnapshot(
  transcriptPrefix: AiAgentTranscriptMessage[],
  content: string,
  reasoningContent: string,
  toolCalls: AgentToolCall[],
  reasoningDurationMs: number | null
): AiAgentTranscriptMessage[] {
  const hasAssistantSnapshot = Boolean(content.trim()) || Boolean(reasoningContent) || toolCalls.length > 0
  if (!hasAssistantSnapshot) return [...transcriptPrefix]

  return [...transcriptPrefix, createAssistantTranscriptMessage(content, reasoningContent, toolCalls, reasoningDurationMs)]
}

/** 把持久化 transcript 转回 Chat Completions messages */
export function convertAgentTranscriptToCompletionMessages(
  transcript: AiAgentTranscriptMessage[] | undefined,
  compatibility: AiCompatibilityAdapter
): ChatCompletionMessageParam[] {
  if (!transcript?.length) return []

  return transcript.flatMap((message): ChatCompletionMessageParam[] => {
    if (message.role === 'tool') {
      return [
        {
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: message.content,
        },
      ]
    }

    return [
      compatibility.createAssistantMessage({
        content: message.content,
        reasoningContent: message.reasoningContent ?? '',
        toolCalls: (message.toolCalls ?? []).map(
          (toolCall): ChatCompletionMessageToolCall => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.argumentsText,
            },
          })
        ),
      }),
    ]
  })
}

/** 流式执行一轮模型调用，并收集正文、思考与工具调用 */
async function runModelTurn(
  options: RunChatCompletionAgentOptions,
  messages: ChatCompletionMessageParam[],
  stepIndex: number,
  progressContext: {
    reasoningPrefix: string
    reasoningDurationPrefixMs: number
    transcriptPrefix: AiAgentTranscriptMessage[]
  }
): Promise<ModelTurnResult> {
  const stream = await options.client.chat.completions.create(
    options.compatibility.createChatCompletionParams({
      model: options.model,
      temperature: options.temperature,
      messages,
      tools: options.toolRegistry.chatCompletionTools,
    }),
    {
      signal: options.signal,
    }
  )

  let content = ''
  let reasoningContent = ''
  let reasoningStartedAt: number | null = null
  let reasoningCompletedAt: number | null = null
  let isReasoningComplete = false
  let hasToolCall = false
  let tokenUsage: AiTokenUsage | null = null
  const toolCallDrafts = new Map<number, ToolCallDraft>()

  for await (const chunk of stream) {
    throwIfAborted(options.signal)
    tokenUsage = extractTokenUsage(chunk.usage) ?? tokenUsage

    const choice = chunk.choices[0]
    if (!choice) continue

    const reasoningDelta = options.compatibility.extractReasoningDelta(choice.delta)
    const contentDelta = extractContentDelta(choice.delta)
    const receivedToolCall = appendToolCallDeltas(toolCallDrafts, choice.delta, stepIndex)

    if (reasoningDelta) {
      if (reasoningStartedAt === null) reasoningStartedAt = Date.now()
      reasoningContent += reasoningDelta
    }

    if (contentDelta) {
      content += contentDelta
      if (reasoningContent && !isReasoningComplete) {
        isReasoningComplete = true
        reasoningCompletedAt = Date.now()
      }
    }

    if (receivedToolCall) {
      hasToolCall = true
    }

    if (choice.finish_reason && reasoningContent && !isReasoningComplete) {
      isReasoningComplete = true
      reasoningCompletedAt = Date.now()
    }

    if (reasoningDelta || contentDelta || receivedToolCall || choice.finish_reason) {
      const currentToolCalls = serializeToolCallDrafts(toolCallDrafts)
      const shouldEmitTranscript = progressContext.transcriptPrefix.length > 0 || currentToolCalls.length > 0
      const currentReasoningDurationMs = getReasoningDurationMs(reasoningStartedAt, reasoningCompletedAt)
      emitStreamUpdate(
        options.onUpdate,
        hasToolCall ? '' : content,
        `${progressContext.reasoningPrefix}${reasoningContent}`,
        isReasoningComplete,
        currentReasoningDurationMs === null
          ? progressContext.reasoningDurationPrefixMs || null
          : progressContext.reasoningDurationPrefixMs + currentReasoningDurationMs,
        shouldEmitTranscript
          ? createTranscriptSnapshot(
              progressContext.transcriptPrefix,
              content,
              reasoningContent,
              currentToolCalls,
              currentReasoningDurationMs
            )
          : []
      )
    }
  }

  if (reasoningContent && !isReasoningComplete) {
    isReasoningComplete = true
    reasoningCompletedAt = Date.now()
  }

  return {
    content,
    reasoningContent,
    toolCalls: serializeToolCallDrafts(toolCallDrafts),
    isReasoningComplete,
    reasoningDurationMs: getReasoningDurationMs(reasoningStartedAt, reasoningCompletedAt),
    tokenUsage,
  }
}

/** 执行 Chat Completions 兼容的 agent 循环，首轮 messages 顺序由调用方保持 */
export async function runChatCompletionAgent(
  options: RunChatCompletionAgentOptions
): Promise<AgentRunResult> {
  const workingMessages: ChatCompletionMessageParam[] = [...options.messages]
  const agentTranscript: AiAgentTranscriptMessage[] = []
  const toolTraces: AgentToolExecutionTrace[] = []
  let allReasoningContent = ''
  let totalReasoningDurationMs = 0
  let reasoningDurationMs: number | null = null
  let isReasoningComplete = false
  let tokenUsage: AiTokenUsage | null = null

  for (let stepIndex = 0; stepIndex < MAX_AGENT_STEPS; stepIndex += 1) {
    throwIfAborted(options.signal)

    const turn = await runModelTurn(options, workingMessages, stepIndex, {
      reasoningPrefix: allReasoningContent,
      reasoningDurationPrefixMs: totalReasoningDurationMs,
      transcriptPrefix: [...agentTranscript],
    })
    if (turn.reasoningContent) allReasoningContent += turn.reasoningContent
    if (turn.reasoningDurationMs !== null) totalReasoningDurationMs += turn.reasoningDurationMs
    reasoningDurationMs = totalReasoningDurationMs > 0 ? totalReasoningDurationMs : null
    isReasoningComplete = turn.isReasoningComplete
    tokenUsage = mergeTokenUsage(tokenUsage, turn.tokenUsage)

    if (turn.toolCalls.length === 0) {
      const content = turn.content.trim()
      if (!content) throw new Error('模型没有返回可用内容')
      if (agentTranscript.length > 0) {
        agentTranscript.push(createAssistantTranscriptMessage(content, turn.reasoningContent, [], turn.reasoningDurationMs))
        emitStreamUpdate(
          options.onUpdate,
          content,
          allReasoningContent,
          isReasoningComplete,
          reasoningDurationMs,
          [...agentTranscript]
        )
      }

      return {
        content,
        reasoningContent: allReasoningContent,
        reasoningDurationMs,
        isReasoningComplete,
        tokenUsage,
        agentTranscript,
        toolTraces,
      }
    }

    workingMessages.push(
      createAssistantToolCallMessage(turn.content, turn.reasoningContent, options.compatibility, turn.toolCalls)
    )
    agentTranscript.push(
      createAssistantTranscriptMessage(turn.content, turn.reasoningContent, turn.toolCalls, turn.reasoningDurationMs)
    )
    emitStreamUpdate(
      options.onUpdate,
      '',
      allReasoningContent,
      isReasoningComplete,
      reasoningDurationMs,
      [...agentTranscript]
    )

    for (const toolCall of turn.toolCalls) {
      throwIfAborted(options.signal)
      const execution = await options.toolRegistry.executeToolCall(toolCall, {
        vaultPath: options.vaultPath,
        signal: options.signal,
        fileEditJournal: options.fileEditJournal,
        getCurrentNoteSnapshot: options.getCurrentNoteSnapshot,
        onVaultFilesChanged: options.onVaultFilesChanged,
      })

      toolTraces.push(execution.trace)
      agentTranscript.push(createToolTranscriptMessage(toolCall, execution))
      workingMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: execution.content,
      })
      emitStreamUpdate(
        options.onUpdate,
        '',
        allReasoningContent,
        isReasoningComplete,
        reasoningDurationMs,
        [...agentTranscript]
      )
    }
  }

  throw new Error('Agent 工具调用次数过多，请缩小问题范围后重试')
}
