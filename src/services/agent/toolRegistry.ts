import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type {
  AgentTool,
  AgentToolCall,
  AgentToolContext,
  AgentToolExecutionTrace,
  AgentToolInput,
  AgentToolRegistryLike,
} from './types'

/** 解析模型生成的 JSON 工具入参 */
function parseToolArguments(argumentsText: string): AgentToolInput {
  if (!argumentsText.trim()) return {}

  const parsed = JSON.parse(argumentsText) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('工具参数必须是 JSON object')
  }

  return parsed as AgentToolInput
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
