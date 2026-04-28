import type { AiFileEditBatch, AiFileEditOperation, AiFileEditSummary } from '../../domain/ai'
import { readNote, saveNote } from '../noteService'
import type { AgentAppliedFileEdit } from './types'
import { countChangedLines, hashTextContent, revertTextEdit } from './utils/fileEdit'

/** 生成稳定的本地批次 id */
function createFileEditBatchId(): string {
  return typeof crypto.randomUUID === 'function'
    ? `edit-${crypto.randomUUID()}`
    : `edit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 把 agent 运行时编辑日志整理成可持久化、可回退的批次 */
export function buildAiFileEditBatch(edits: AgentAppliedFileEdit[]): AiFileEditBatch | undefined {
  if (edits.length === 0) return undefined

  const fileStates = new Map<
    string,
    {
      beforeContent: string
      afterContent: string
      beforeHash: string
      afterHash: string
      operationCount: number
    }
  >()
  const operations: AiFileEditOperation[] = []

  edits.forEach((edit) => {
    const currentState = fileStates.get(edit.path)
    if (!currentState) {
      fileStates.set(edit.path, {
        beforeContent: edit.beforeContent,
        afterContent: edit.afterContent,
        beforeHash: edit.beforeHash,
        afterHash: edit.afterHash,
        operationCount: edit.operations.length,
      })
    } else {
      currentState.afterContent = edit.afterContent
      currentState.afterHash = edit.afterHash
      currentState.operationCount += edit.operations.length
    }

    operations.push(...edit.operations)
  })

  const files: AiFileEditSummary[] = [...fileStates.entries()].map(([path, state]) => {
    const changedLines = countChangedLines(state.beforeContent, state.afterContent)
    return {
      path,
      beforeHash: state.beforeHash,
      afterHash: state.afterHash,
      addedLines: changedLines.addedLines,
      removedLines: changedLines.removedLines,
      operationCount: state.operationCount,
    }
  })

  return {
    id: createFileEditBatchId(),
    createdAt: edits[0]?.createdAt ?? new Date().toISOString(),
    files,
    operations,
  }
}

/** 按文件分组并保持原始操作顺序，方便逐文件安全回退 */
function groupOperationsByPath(operations: AiFileEditOperation[]): Map<string, AiFileEditOperation[]> {
  const groupedOperations = new Map<string, AiFileEditOperation[]>()
  operations.forEach((operation) => {
    const operationsForPath = groupedOperations.get(operation.path) ?? []
    operationsForPath.push(operation)
    groupedOperations.set(operation.path, operationsForPath)
  })
  return groupedOperations
}

/** 回退一次 assistant 回复产生的文件编辑；当前内容不等于 AI 写入后的 hash 时拒绝覆盖 */
export async function revertAiFileEditBatch(vaultPath: string, batch: AiFileEditBatch): Promise<string[]> {
  if (batch.isReverted) throw new Error('这次修改已经回退过了')

  const groupedOperations = groupOperationsByPath(batch.operations)
  const pendingWrites: Array<{ path: string; content: string }> = []

  for (const fileSummary of batch.files) {
    const note = await readNote(vaultPath, fileSummary.path)
    if (!note) throw new Error(`找不到文章，无法回退：${fileSummary.path}`)

    const currentHash = await hashTextContent(note.content)
    if (currentHash !== fileSummary.afterHash) {
      throw new Error(`文件已在 AI 修改后发生变化，已停止回退：${fileSummary.path}`)
    }

    let nextContent = note.content
    const operations = groupedOperations.get(fileSummary.path) ?? []
    for (const operation of [...operations].reverse()) {
      nextContent = revertTextEdit(nextContent, operation)
    }

    const restoredHash = await hashTextContent(nextContent)
    if (restoredHash !== fileSummary.beforeHash) {
      throw new Error(`回退校验失败，未写入文件：${fileSummary.path}`)
    }

    pendingWrites.push({
      path: fileSummary.path,
      content: nextContent,
    })
  }

  for (const pendingWrite of pendingWrites) {
    await saveNote(vaultPath, pendingWrite.path, pendingWrite.content)
  }

  return pendingWrites.map((pendingWrite) => pendingWrite.path)
}
