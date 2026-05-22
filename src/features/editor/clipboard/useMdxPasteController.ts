import { type MDXEditorMethods } from '@mdxeditor/editor'
import { useEffect, useRef, type RefObject } from 'react'
import { insertPlainTextIntoFocusedTarget } from '../../../lib/plainTextInput'
import {
  escapePlainTextForMdxMarkdown,
  getMarkdownPasteMode,
  prepareMarkdownForMdxPaste,
} from './markdownPaste'

interface PendingMarkdownPaste {
  beforeMarkdown: string
  sourceMarkdown: string
  plainText: string
  clearTimerId: number | null
  isRecoveryScheduled: boolean
}

interface MdxPasteControllerOptions {
  editorRef: RefObject<MDXEditorMethods | null>
  latestMarkdownRef: RefObject<string>
  onChange: (markdown: string) => void
}

/** 计算两段文本从开头开始的公共长度 */
function getCommonPrefixLength(left: string, right: string) {
  const maxLength = Math.min(left.length, right.length)
  let index = 0

  while (index < maxLength && left[index] === right[index]) index += 1
  return index
}

/** 计算两段文本从末尾开始的公共长度，避免和已知前缀重叠 */
function getCommonSuffixLength(left: string, right: string, prefixLength: number) {
  const maxLength = Math.min(left.length, right.length) - prefixLength
  let index = 0

  while (
    index < maxLength &&
    left[left.length - 1 - index] === right[right.length - 1 - index]
  ) {
    index += 1
  }

  return index
}

/** 用纯文本替换一次失败 Markdown 导入造成的源码变更区域 */
function replaceChangedMarkdownRange(beforeMarkdown: string, afterMarkdown: string, replacementMarkdown: string) {
  const prefixLength = getCommonPrefixLength(beforeMarkdown, afterMarkdown)
  const suffixLength = getCommonSuffixLength(beforeMarkdown, afterMarkdown, prefixLength)
  const suffixStart = beforeMarkdown.length - suffixLength

  return `${beforeMarkdown.slice(0, prefixLength)}${replacementMarkdown}${beforeMarkdown.slice(suffixStart)}`
}

/** 创建 MDXEditor 粘贴控制器，统一处理 Markdown 导入与纯文本兜底 */
export function useMdxPasteController({ editorRef, latestMarkdownRef, onChange }: MdxPasteControllerOptions) {
  const pendingMarkdownPasteRef = useRef<PendingMarkdownPaste | null>(null)

  useEffect(() => () => clearPendingMarkdownPaste(), [])

  /** 清理待兜底的 Markdown 粘贴记录 */
  function clearPendingMarkdownPaste(pendingPaste: PendingMarkdownPaste | null = pendingMarkdownPasteRef.current) {
    const currentPaste = pendingMarkdownPasteRef.current
    if (!currentPaste || currentPaste !== pendingPaste) return

    // 1. 清掉延迟任务，避免成功导入后又触发过期恢复
    if (currentPaste.clearTimerId !== null) {
      window.clearTimeout(currentPaste.clearTimerId)
    }
    pendingMarkdownPasteRef.current = null
  }

  /** 记录一次 Markdown 导入，后续若 MDXEditor 报错可回退为纯文本 */
  function rememberMarkdownPaste(sourceMarkdown: string, plainText: string) {
    clearPendingMarkdownPaste()

    // 1. 只给同步解析链路留短暂窗口；成功导入时自然过期
    const pendingPaste: PendingMarkdownPaste = {
      beforeMarkdown: latestMarkdownRef.current,
      sourceMarkdown,
      plainText,
      clearTimerId: null,
      isRecoveryScheduled: false,
    }
    pendingPaste.clearTimerId = window.setTimeout(() => clearPendingMarkdownPaste(pendingPaste), 1000)
    pendingMarkdownPasteRef.current = pendingPaste
  }

  /** 向编辑器插入纯文本；必要时退到转义 Markdown，保证内容至少落入文档 */
  function insertPlainTextIntoEditor(text: string) {
    // 1. 优先走原生纯文本插入，避免 Markdown 标记被解释成格式
    editorRef.current?.focus()
    if (insertPlainTextIntoFocusedTarget(text)) return

    // 2. 极端情况下 contenteditable 未成为 activeElement，则用转义 Markdown 兜底
    editorRef.current?.insertMarkdown(escapePlainTextForMdxMarkdown(text))
  }

  /** 执行安全 Markdown 导入，并为未知解析失败准备纯文本兜底 */
  function insertMarkdownIntoEditor(markdownText: string) {
    const sanitizedMarkdown = prepareMarkdownForMdxPaste(markdownText)

    // 1. MDXEditor 的 insertMarkdown 失败不会抛错，只会触发 onError，因此先记录上下文
    rememberMarkdownPaste(sanitizedMarkdown, markdownText)
    editorRef.current?.insertMarkdown(sanitizedMarkdown)
  }

  /** 将失败的 Markdown 粘贴恢复为纯文本内容 */
  function recoverFailedMarkdownPaste(pendingPaste: PendingMarkdownPaste) {
    if (pendingMarkdownPasteRef.current !== pendingPaste) return

    // 1. 等待 Lexical 把可能的半截导入同步到 latestMarkdownRef，再统一修正
    const afterMarkdown = latestMarkdownRef.current
    const replacementMarkdown = escapePlainTextForMdxMarkdown(pendingPaste.plainText)
    clearPendingMarkdownPaste(pendingPaste)

    if (afterMarkdown !== pendingPaste.beforeMarkdown) {
      const nextMarkdown = replaceChangedMarkdownRange(
        pendingPaste.beforeMarkdown,
        afterMarkdown,
        replacementMarkdown
      )
      editorRef.current?.setMarkdown(nextMarkdown)
      latestMarkdownRef.current = nextMarkdown
      onChange(nextMarkdown)
      return
    }

    // 2. 若解析阶段完全没有改动文档，保留当前选区直接插入纯文本
    insertPlainTextIntoEditor(pendingPaste.plainText)
  }

  /** 安排 Markdown 粘贴失败后的纯文本恢复，避免在 Lexical update 内嵌套写入 */
  function scheduleMarkdownPasteRecovery(sourceMarkdown: string) {
    const pendingPaste = pendingMarkdownPasteRef.current
    if (
      !pendingPaste ||
      pendingPaste.sourceMarkdown !== sourceMarkdown ||
      pendingPaste.isRecoveryScheduled
    ) {
      return false
    }

    // 1. 解析错误回调可能发生在编辑器 update 内，延后一拍再恢复内容
    pendingPaste.isRecoveryScheduled = true
    if (pendingPaste.clearTimerId !== null) {
      window.clearTimeout(pendingPaste.clearTimerId)
      pendingPaste.clearTimerId = null
    }
    window.setTimeout(() => recoverFailedMarkdownPaste(pendingPaste), 0)
    return true
  }

  /** 从系统剪贴板读取文本并按编辑器粘贴策略插入 */
  async function pasteClipboardTextIntoEditor() {
    try {
      const clipboardText = await navigator.clipboard?.readText?.()
      if (!clipboardText) return

      const pasteMode = getMarkdownPasteMode(clipboardText)
      if (pasteMode === 'markdown') {
        insertMarkdownIntoEditor(clipboardText)
      } else {
        insertPlainTextIntoEditor(clipboardText)
      }
    } catch {
      document.execCommand('paste')
    }
  }

  return {
    insertMarkdownIntoEditor,
    insertPlainTextIntoEditor,
    pasteClipboardTextIntoEditor,
    scheduleMarkdownPasteRecovery,
  }
}
