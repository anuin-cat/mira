import type { AiFileEditOperation } from '../../../domain/ai'
import { createMarkdownFileAtPath, prepareMarkdownFileCreation, readNote, saveNote } from '../../noteService'
import type { AgentTool, AgentToolInput, AgentToolResult } from '../types'
import { applyTextEdit, hashTextContent, type TextEditInput } from '../utils/fileEdit'
import { normalizeReadableNotePath } from '../utils/pathGuard'
import { clampNumber } from '../utils/text'

const MAX_EDITS_PER_CALL = 20
const MAX_EDIT_TEXT_CHARS = 60000
const MAX_CREATE_CONTENT_CHARS = 60000

interface NormalizedEditInput extends TextEditInput {
  index: number
}

type EditMode = TextEditInput['mode']

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

/** 从工具入参中读取保留首尾空白的字符串 */
function readRawStringInput(input: AgentToolInput, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' ? value : null
}

/** 规范化单个编辑项，保留文本片段原始空白 */
function normalizeEditInput(value: unknown, index: number): NormalizedEditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`edits[${index}] 必须是 object`)
  }

  const input = value as Record<string, unknown>
  const mode = normalizeEditMode(input.mode)
  const oldText = typeof input.oldText === 'string' ? input.oldText : null
  const anchorText = typeof input.anchorText === 'string' ? input.anchorText : null
  const startAnchor = typeof input.startAnchor === 'string' ? input.startAnchor : null
  const endAnchor = typeof input.endAnchor === 'string' ? input.endAnchor : null
  const newText = typeof input.newText === 'string' ? input.newText : null
  if (newText === null) throw new Error(`edits[${index}] 缺少 newText`)
  if (newText.length > MAX_EDIT_TEXT_CHARS) {
    throw new Error(`edits[${index}] 文本片段过长`)
  }

  if (mode === 'replace') {
    if (!oldText) throw new Error(`edits[${index}] 缺少 oldText`)
    if (oldText.length > MAX_EDIT_TEXT_CHARS) throw new Error(`edits[${index}] 文本片段过长`)
    if (oldText === newText) throw new Error(`edits[${index}] oldText 与 newText 不能完全相同`)
  }

  if (mode === 'replace_between') {
    if (!startAnchor) throw new Error(`edits[${index}] 缺少 startAnchor`)
    if (!endAnchor) throw new Error(`edits[${index}] 缺少 endAnchor`)
    if (startAnchor.length > MAX_EDIT_TEXT_CHARS || endAnchor.length > MAX_EDIT_TEXT_CHARS) {
      throw new Error(`edits[${index}] 范围锚点片段过长`)
    }
    if (typeof input.includeStart !== 'boolean' || typeof input.includeEnd !== 'boolean') {
      throw new Error(`edits[${index}] replace_between 必须显式提供 includeStart 和 includeEnd`)
    }
  }

  if ((mode === 'insert_before' || mode === 'insert_after') && !anchorText) {
    throw new Error(`edits[${index}] 缺少 anchorText`)
  }
  if (anchorText && anchorText.length > MAX_EDIT_TEXT_CHARS) throw new Error(`edits[${index}] 锚点片段过长`)
  if (mode !== 'replace' && mode !== 'replace_between' && !newText) {
    throw new Error(`edits[${index}] 新增文本不能为空`)
  }

  const replaceAll = input.replaceAll === true
  const expectedOccurrences = clampNumber(input.expectedOccurrences, replaceAll ? 0 : 1, 0, Number.MAX_SAFE_INTEGER)
  if (replaceAll && expectedOccurrences < 1) {
    throw new Error(`edits[${index}] 使用 replaceAll 时必须提供 expectedOccurrences`)
  }
  if (mode !== 'replace' && replaceAll) throw new Error(`edits[${index}] ${mode} 不支持 replaceAll`)
  if ((mode === 'insert_before' || mode === 'insert_after') && expectedOccurrences !== 1) {
    throw new Error(`edits[${index}] 新增位置必须由唯一 anchorText 确定`)
  }

  return {
    index,
    mode,
    oldText: mode === 'replace' ? (oldText ?? '') : '',
    anchorText: anchorText ?? '',
    startAnchor: startAnchor ?? '',
    endAnchor: endAnchor ?? '',
    newText,
    replaceAll: mode === 'replace' ? replaceAll : false,
    expectedOccurrences: mode === 'replace' && replaceAll ? expectedOccurrences : 1,
    includeStart: input.includeStart === true,
    includeEnd: input.includeEnd === true,
  }
}

/** 规范化编辑模式；兼容旧调用，不传 mode 时按替换处理 */
function normalizeEditMode(value: unknown): EditMode {
  if (value === undefined || value === null) return 'replace'
  if (
    value === 'replace' ||
    value === 'replace_between' ||
    value === 'insert_before' ||
    value === 'insert_after' ||
    value === 'prepend' ||
    value === 'append'
  ) {
    return value
  }

  throw new Error('edit mode 只支持 replace、replace_between、insert_before、insert_after、prepend、append')
}

/** 规范化 edits 数组，限制单次工具调用规模 */
function normalizeEdits(input: AgentToolInput): NormalizedEditInput[] {
  const rawEdits = input.edits
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) throw new Error('缺少 edits')
  if (rawEdits.length > MAX_EDITS_PER_CALL) throw new Error(`一次最多提交 ${MAX_EDITS_PER_CALL} 个编辑项`)

  return rawEdits.map((edit, index) => normalizeEditInput(edit, index))
}

/** 统计新建文件内容的行数，空文件按 0 行展示 */
function countCreatedContentLines(content: string): number {
  if (!content) return 0
  return content.split('\n').length
}

/** 创建 agent 可用的安全 Markdown 编辑工具集合 */
export function createVaultEditAgentTools(): AgentTool[] {
  return [
    {
      name: 'vault_create_note',
      description:
        '在当前 Mira vault 内创建一篇新的 Markdown 文章。path 必须是用户可见的 vault 相对路径并以 .md 结尾；目标文件或同名文件夹已存在时会拒绝覆盖；父目录不存在时最多自动递归创建 3 层。适合在用户明确要求新建笔记、整理生成新文档或拆分内容到新文章时使用。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要创建的 Markdown 文件相对路径，例如“项目/Mira 设计.md”。必须以 .md 结尾。',
          },
          content: {
            type: 'string',
            description: '新文件的初始 Markdown 内容；可以为空字符串。',
          },
          dryRun: {
            type: 'boolean',
            description: '只校验并返回摘要，不写入文件，默认 false。',
          },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      async execute(input, context) {
        const path = readRawStringInput(input, 'path')?.trim()
        const content = readRawStringInput(input, 'content')
        if (!path) return createErrorToolResult('缺少 path')
        if (content === null) return createErrorToolResult('缺少 content')
        if (content.length > MAX_CREATE_CONTENT_CHARS) return createErrorToolResult('新文件内容过长')

        try {
          const creationPlan = await prepareMarkdownFileCreation(context.vaultPath, path)
          const normalizedPath = creationPlan.normalizedPath
          const beforeHash = await hashTextContent('')
          const afterHash = await hashTextContent(content)

          if (input.dryRun !== true) {
            const createdNote = await createMarkdownFileAtPath(context.vaultPath, normalizedPath, content)
            context.fileEditJournal?.recordAppliedEdit({
              path: normalizedPath,
              changeKind: 'create',
              createdDirectories: createdNote.createdDirectories,
              beforeContent: '',
              afterContent: content,
              beforeHash,
              afterHash,
              operations: [],
              toolCallId: context.toolCallId,
              createdAt: new Date().toISOString(),
            })
            try {
              await context.onVaultFilesChanged?.([normalizedPath])
            } catch {
              // 文件已经成功创建；UI 同步失败不应让模型误以为创建未发生。
            }
          }

          return createJsonToolResult({
            ok: true,
            path: normalizedPath,
            dryRun: input.dryRun === true,
            beforeHash,
            afterHash,
            createdDirectories: creationPlan.createdDirectories,
            addedLines: countCreatedContentLines(content),
          })
        } catch (error) {
          return createErrorToolResult(error instanceof Error ? error.message : '创建文章失败')
        }
      },
    },
    {
      name: 'vault_edit_note',
      description:
        '安全修改当前 Mira vault 内某一篇 Markdown 文章。必须先调用 vault_read_note 获取 contentHash，然后把该 hash 作为 expectedContentHash 传入。支持精确替换、删除、新增与大段改写：replace 用 oldText 精确替换，newText 为空即删除；replace_between 用唯一 startAnchor/endAnchor 精确确定范围，newText 为空即删除该范围；insert_before/insert_after 用唯一 anchorText 精确确定新增位置；prepend/append 分别插入文首/文末。任一编辑不满足条件则整次调用失败且不会写文件。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'vault 内 Markdown 文件的相对路径，例如“日常/今天想法.md”。',
          },
          expectedContentHash: {
            type: 'string',
            description: '最近一次 vault_read_note 返回的 contentHash。写入前必须完全一致，否则拒绝修改。',
          },
          edits: {
            type: 'array',
            description: '按顺序应用的精确编辑列表；任何一项失败都会取消整次调用。',
            items: {
              type: 'object',
              properties: {
                mode: {
                  type: 'string',
                  enum: ['replace', 'replace_between', 'insert_before', 'insert_after', 'prepend', 'append'],
                  description:
                    '编辑模式，默认 replace。replace=小段替换/删除；replace_between=用开始/结束锚点大段替换/删除；insert_before/insert_after=在唯一 anchorText 前/后新增；prepend/append=文首/文末新增。',
                },
                oldText: {
                  type: 'string',
                  description: 'replace 模式下要替换或删除的原文片段，必须逐字匹配，包括空格、换行和标点。',
                },
                anchorText: {
                  type: 'string',
                  description:
                    'insert_before/insert_after 模式下用于定位新增位置的锚点文本，必须在当前内容中唯一命中；若不唯一，请扩大上下文。',
                },
                startAnchor: {
                  type: 'string',
                  description:
                    'replace_between 模式下用于定位范围起点的锚点文本，必须在当前内容中唯一命中；若不唯一，请扩大上下文。',
                },
                endAnchor: {
                  type: 'string',
                  description:
                    'replace_between 模式下用于定位范围终点的锚点文本，必须在当前内容中唯一命中，并且必须位于 startAnchor 之后。',
                },
                includeStart: {
                  type: 'boolean',
                  description: 'replace_between 是否把 startAnchor 本身包含进替换范围，必须显式提供。',
                },
                includeEnd: {
                  type: 'boolean',
                  description: 'replace_between 是否把 endAnchor 本身包含进替换范围，必须显式提供。',
                },
                newText: {
                  type: 'string',
                  description: '替换后的文本或新增文本；replace 和 replace_between 模式允许为空字符串，用于删除片段或范围；新增模式不能为空。',
                },
                replaceAll: {
                  type: 'boolean',
                  description: 'replace 模式下是否替换所有命中，默认 false；新增模式不支持。',
                },
                expectedOccurrences: {
                  type: 'number',
                  description:
                    'replaceAll=true 时为期望 oldText 命中次数；insert_before/insert_after 固定要求 anchorText 唯一命中。',
                },
              },
              required: ['newText'],
              additionalProperties: false,
            },
          },
          dryRun: {
            type: 'boolean',
            description: '只校验并返回摘要，不写入文件，默认 false。',
          },
        },
        required: ['path', 'expectedContentHash', 'edits'],
        additionalProperties: false,
      },
      async execute(input, context) {
        const path = readRawStringInput(input, 'path')?.trim()
        const expectedContentHash = readRawStringInput(input, 'expectedContentHash')?.trim()
        if (!path) return createErrorToolResult('缺少 path')
        if (!expectedContentHash) return createErrorToolResult('缺少 expectedContentHash，请先调用 vault_read_note')

        try {
          const normalizedPath = normalizeReadableNotePath(path)
          const edits = normalizeEdits(input)
          const note = await readNote(context.vaultPath, normalizedPath)
          if (!note) return createErrorToolResult(`找不到文章：${normalizedPath}`)

          const beforeContent = note.content
          const beforeHash = await hashTextContent(beforeContent)
          if (beforeHash !== expectedContentHash) {
            return createErrorToolResult(`文件内容已变化，expectedContentHash 与当前 contentHash 不一致：${normalizedPath}`)
          }

          const currentSnapshot = context.getCurrentNoteSnapshot?.()
          if (currentSnapshot?.path === normalizedPath) {
            const currentEditorHash = await hashTextContent(currentSnapshot.content)
            if (currentEditorHash !== beforeHash) {
              return createErrorToolResult(`当前打开文件仍有未保存编辑，已拒绝修改：${normalizedPath}`)
            }
          }

          let nextContent = beforeContent
          const operations: AiFileEditOperation[] = []
          for (const edit of edits) {
            const appliedEdit = applyTextEdit(nextContent, edit)
            nextContent = appliedEdit.content
            operations.push({
              path: normalizedPath,
              ...appliedEdit.operation,
            })
          }
          if (nextContent === beforeContent) return createErrorToolResult('编辑后内容没有变化')

          const afterHash = await hashTextContent(nextContent)
          if (input.dryRun !== true) {
            await saveNote(context.vaultPath, normalizedPath, nextContent)
            context.fileEditJournal?.recordAppliedEdit({
              path: normalizedPath,
              beforeContent,
              afterContent: nextContent,
              beforeHash,
              afterHash,
              operations,
              toolCallId: context.toolCallId,
              createdAt: new Date().toISOString(),
            })
            try {
              await context.onVaultFilesChanged?.([normalizedPath])
            } catch {
              // 文件已经成功写入；UI 同步失败不应让模型误以为编辑未发生。
            }
          }

          return createJsonToolResult({
            ok: true,
            path: normalizedPath,
            dryRun: input.dryRun === true,
            beforeHash,
            afterHash,
            appliedEdits: operations.length,
            replacedOccurrences: operations.reduce((count, operation) => count + operation.occurrenceCount, 0),
          })
        } catch (error) {
          return createErrorToolResult(error instanceof Error ? error.message : '编辑文章失败')
        }
      },
    },
  ]
}
