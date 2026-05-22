import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { jsonrepair } from 'jsonrepair'
import type {
  AgentTool,
  AgentToolCall,
  AgentToolContext,
  AgentToolExecutionTrace,
  AgentToolInput,
  AgentToolRegistryLike,
} from './types'

/** 校验已解析的工具入参必须是 JSON object */
function normalizeParsedToolArguments(parsed: unknown): AgentToolInput {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('工具参数必须是 JSON object')
  }

  return parsed as AgentToolInput
}

/** 提取 JSON 解析错误摘要，避免把超长工具参数重复塞回上下文 */
function formatJsonParseError(error: unknown): string {
  return error instanceof Error ? error.message : 'JSON 解析失败'
}

/** 解析模型生成的 JSON 工具入参；失败时修复常见的未转义引号/换行问题 */
function parseToolArguments(argumentsText: string): AgentToolInput {
  const trimmedArguments = argumentsText.trim()
  if (!trimmedArguments) return {}

  try {
    return normalizeParsedToolArguments(JSON.parse(trimmedArguments) as unknown)
  } catch (strictError) {
    if (!(strictError instanceof SyntaxError)) throw strictError

    try {
      const repairedArguments = jsonrepair(trimmedArguments)
      return normalizeParsedToolArguments(JSON.parse(repairedArguments) as unknown)
    } catch (repairError) {
      throw new Error(
        `工具参数无法解析为 JSON object：${formatJsonParseError(
          repairError instanceof SyntaxError ? strictError : repairError
        )}。常见原因是字符串内容里的英文双引号没有写成 \\"，或把原始换行直接放进了 JSON 字符串。`
      )
    }
  }
}

/** 把工具错误稳定编码为 tool message，让模型有机会修正调用 */
function createToolErrorContent(message: string): string {
  return JSON.stringify({
    ok: false,
    error: message,
  })
}

/** 管理 agent 可用工具，并负责把工具定义转换为 Chat Completions tools */
export class AgentToolRegistry implements AgentToolRegistryLike {
  private readonly toolMap = new Map<string, AgentTool>()

  readonly chatCompletionTools: ChatCompletionTool[]

  constructor(tools: AgentTool[]) {
    tools.forEach((tool) => {
      this.toolMap.set(tool.name, tool)
    })

    this.chatCompletionTools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }

  /** 执行一次模型请求的工具调用，并返回可追加进 messages 的内容 */
  async executeToolCall(
    toolCall: AgentToolCall,
    context: AgentToolContext
  ): Promise<{ content: string; trace: AgentToolExecutionTrace }> {
    const startedAt = Date.now()
    let isError = false
    let content = ''

    try {
      const tool = this.toolMap.get(toolCall.name)
      if (!tool) throw new Error(`未知工具：${toolCall.name}`)

      const input = parseToolArguments(toolCall.argumentsText)
      const result = await tool.execute(input, {
        ...context,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      })

      isError = result.isError === true
      content = result.content
    } catch (error) {
      isError = true
      content = createToolErrorContent(error instanceof Error ? error.message : '工具调用失败')
    }

    return {
      content,
      trace: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        argumentsText: toolCall.argumentsText,
        durationMs: Math.max(0, Date.now() - startedAt),
        isError,
      },
    }
  }
}
