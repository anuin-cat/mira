import type { VaultTreeNode } from '../../../domain/note'
import { readNote, scanVaultTree } from '../../noteService'
import { MARKDOWN_EXTENSION } from '../../pathUtils'
import type { AgentTool, AgentToolResult } from '../types'
import { hashTextContent } from '../utils/fileEdit'
import { extractMarkdownHeadings, searchMarkdownContent } from '../utils/markdown'
import { normalizeReadableNotePath } from '../utils/pathGuard'
import { clampNumber, clipWithMeta, readStringInput } from '../utils/text'

const DEFAULT_READ_NOTE_CHARS = 12000
const MAX_READ_NOTE_CHARS = 24000
const DEFAULT_TREE_DEPTH = 4
const MAX_TREE_DEPTH = 8
const DEFAULT_SEARCH_RESULTS = 20
const MAX_SEARCH_RESULTS = 60
const DEFAULT_HEADINGS = 80
const MAX_HEADINGS = 160
const MAX_REGEX_QUERY_CHARS = 120

interface SerializedTreeNode {
  path: string
  name: string
  kind: VaultTreeNode['kind']
  updatedAt: string | null
  children?: SerializedTreeNode[]
}

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

/** 递归收集 Markdown 文件节点 */
function collectFileNodes(nodes: VaultTreeNode[]): VaultTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'file') return [node]
    return collectFileNodes(node.children ?? [])
  })
}

/** 递归统计目录节点数量 */
function countDirectoryNodes(nodes: VaultTreeNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.kind !== 'directory') return count
    return count + 1 + countDirectoryNodes(node.children ?? [])
  }, 0)
}

/** 将完整文件树裁剪到工具可返回的深度 */
function serializeTree(nodes: VaultTreeNode[], maxDepth: number, depth = 1): SerializedTreeNode[] {
  return nodes.map((node) => {
    const serialized: SerializedTreeNode = {
      path: node.path,
      name: node.kind === 'file' ? `${node.name}${MARKDOWN_EXTENSION}` : node.name,
      kind: node.kind,
      updatedAt: node.updatedAt ?? null,
    }

    if (node.kind === 'directory' && depth < maxDepth) {
      serialized.children = serializeTree(node.children ?? [], maxDepth, depth + 1)
    }

    return serialized
  })
}

/** 创建读取 vault 只读内容的 agent 工具集合 */
export function createVaultAgentTools(): AgentTool[] {
  return [
    {
      name: 'vault_list_tree',
      description:
        '列出当前 Mira vault 中用户可见的目录和 Markdown 文件。适合先了解文章库结构，再决定读取或搜索哪些文章。',
      parameters: {
        type: 'object',
        properties: {
          maxDepth: {
            type: 'number',
            description: '返回目录树的最大深度，默认 4，最大 8。',
          },
        },
        additionalProperties: false,
      },
      async execute(input, context) {
        const maxDepth = clampNumber(input.maxDepth, DEFAULT_TREE_DEPTH, 1, MAX_TREE_DEPTH)
        const tree = await scanVaultTree(context.vaultPath)

        return createJsonToolResult({
          ok: true,
          maxDepth,
          totalFiles: collectFileNodes(tree).length,
          totalDirectories: countDirectoryNodes(tree),
          tree: serializeTree(tree, maxDepth),
        })
      },
    },
    {
      name: 'vault_read_note',
      description:
        '读取当前 Mira vault 内某一篇 Markdown 文章的内容。path 必须来自 vault_list_tree、vault_search_notes 或当前笔记路径。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'vault 内 Markdown 文件的相对路径，例如“日常/今天想法.md”。',
          },
          maxChars: {
            type: 'number',
            description: '最多返回多少个字符，默认 12000，最大 24000。',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      async execute(input, context) {
        const path = readStringInput(input, 'path')
        if (!path) return createErrorToolResult('缺少 path')

        try {
          const normalizedPath = normalizeReadableNotePath(path)
          const note = await readNote(context.vaultPath, normalizedPath)
          if (!note) return createErrorToolResult(`找不到文章：${normalizedPath}`)

          const maxChars = clampNumber(input.maxChars, DEFAULT_READ_NOTE_CHARS, 1, MAX_READ_NOTE_CHARS)
          const clipped = clipWithMeta(note.content, maxChars)

          return createJsonToolResult({
            ok: true,
            path: note.meta.path,
            title: note.meta.title,
            updatedAt: note.meta.updatedAt,
            contentHash: await hashTextContent(note.content),
            content: clipped.text,
            isTruncated: clipped.isTruncated,
            remainingChars: clipped.remainingChars,
          })
        } catch (error) {
          return createErrorToolResult(error instanceof Error ? error.message : '读取文章失败')
        }
      },
    },
    {
      name: 'vault_search_notes',
      description:
        '在当前 Mira vault 的所有可见 Markdown 文章中搜索关键词或正则。普通搜索会按空白拆分多个关键词，再返回同时命中这些词的文章片段；适合先找相关文章，再用 vault_read_note 深读。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索词或正则表达式。regex=false 时，普通关键词可用空格分隔多个词。',
          },
          maxResults: {
            type: 'number',
            description: '最多返回多少条命中，默认 20，最大 60。',
          },
          caseSensitive: {
            type: 'boolean',
            description: '是否区分大小写，默认 false。',
          },
          regex: {
            type: 'boolean',
            description: '是否把 query 当作正则表达式，默认 false。',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async execute(input, context) {
        const query = readStringInput(input, 'query')
        if (!query) return createErrorToolResult('缺少 query')

        const isRegex = input.regex === true
        if (isRegex && query.length > MAX_REGEX_QUERY_CHARS) {
          return createErrorToolResult(`正则查询不能超过 ${MAX_REGEX_QUERY_CHARS} 个字符`)
        }

        try {
          if (isRegex) new RegExp(query)

          const maxResults = clampNumber(input.maxResults, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS)
          const tree = await scanVaultTree(context.vaultPath)
          const files = collectFileNodes(tree)
          const matches: Array<{ path: string; title: string; lineNumber: number; snippet: string }> = []

          for (const file of files) {
            if (matches.length >= maxResults) break

            const note = await readNote(context.vaultPath, file.path)
            if (!note) continue

            const noteMatches = searchMarkdownContent(note.content, query, {
              isCaseSensitive: input.caseSensitive === true,
              isRegex,
              maxMatches: maxResults - matches.length,
            })

            matches.push(
              ...noteMatches.map((match) => ({
                path: note.meta.path,
                title: note.meta.title,
                lineNumber: match.lineNumber,
                snippet: match.snippet,
              }))
            )
          }

          return createJsonToolResult({
            ok: true,
            query,
            totalReturned: matches.length,
            isResultLimited: matches.length >= maxResults,
            matches,
          })
        } catch (error) {
          return createErrorToolResult(error instanceof Error ? error.message : '搜索失败')
        }
      },
    },
    {
      name: 'vault_get_note_outline',
      description:
        '读取某篇 Markdown 的标题大纲，只返回标题层级和行号。适合先判断文章结构，必要时再读取全文。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'vault 内 Markdown 文件的相对路径，例如“项目/Mira 设计.md”。',
          },
          maxHeadings: {
            type: 'number',
            description: '最多返回多少个标题，默认 80，最大 160。',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      async execute(input, context) {
        const path = readStringInput(input, 'path')
        if (!path) return createErrorToolResult('缺少 path')

        try {
          const normalizedPath = normalizeReadableNotePath(path)
          const note = await readNote(context.vaultPath, normalizedPath)
          if (!note) return createErrorToolResult(`找不到文章：${normalizedPath}`)

          const maxHeadings = clampNumber(input.maxHeadings, DEFAULT_HEADINGS, 1, MAX_HEADINGS)
          return createJsonToolResult({
            ok: true,
            path: note.meta.path,
            title: note.meta.title,
            headings: extractMarkdownHeadings(note.content, maxHeadings),
          })
        } catch (error) {
          return createErrorToolResult(error instanceof Error ? error.message : '读取标题大纲失败')
        }
      },
    },
  ]
}
