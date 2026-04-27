import { runReadonlyGitCommand } from '../../gitService'
import type { AgentTool, AgentToolResult } from '../types'
import { readStringInput } from '../utils/text'

/** 将工具结果稳定序列化为紧凑 JSON，方便模型继续读取 */
function createJsonToolResult(value: unknown): AgentToolResult {
  return {
    content: JSON.stringify(value),
  }
}

/** 将错误也作为工具结果交还给模型，避免整轮对话直接失败 */
function createErrorToolResult(message: string): AgentToolResult {
  return {
    content: JSON.stringify({
      ok: false,
      error: message,
    }),
    isError: true,
  }
}

/** 创建 agent 可用的 Git 只读工具集合 */
export function createGitAgentTools(): AgentTool[] {
  return [
    {
      name: 'git_readonly',
      description:
        '在当前 Mira vault 的 Git 仓库根目录执行只读 Git 命令。只允许内置只读命令，例如 git status、git diff、git log、git show、git branch、git remote -v、git rev-parse、git ls-files、git grep。不能执行 add、commit、push、reset、checkout、merge、rebase、stash、clean 等会改变仓库状态的命令。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              '完整 Git 命令，例如 git status --short、git diff -- Mira Map.md、git log --oneline -20。命令必须以 git 开头。',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
      async execute(input, context) {
        const command = readStringInput(input, 'command')
        if (!command) return createErrorToolResult('缺少 command')

        try {
          const result = await runReadonlyGitCommand(context.vaultPath, command)
          return createJsonToolResult({
            ok: result.code === 0,
            commandId: result.commandId,
            code: result.code,
            stdout: result.stdout,
            stderr: result.stderr,
            isTruncated: result.isTruncated,
          })
        } catch (error) {
          return createErrorToolResult(error instanceof Error ? error.message : 'Git 只读命令执行失败')
        }
      },
    },
  ]
}
