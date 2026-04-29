import { ArrowUp, BrushCleaning } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import type { AiTextReference } from '../../domain/ai'
import { isImeComposing } from '../../lib/keyboard'
import {
  createAiComposerReferencePart,
  createAiComposerTextPart,
  formatAiReferenceLabel,
  hasAiComposerContent,
  normalizeAiComposerParts,
  type AiComposerPart,
} from './aiComposerModel'

const AI_COMPOSER_MIN_ROWS = 3
const AI_COMPOSER_MAX_ROWS = 8
const AI_COMPOSER_FALLBACK_LINE_HEIGHT = 22

interface AiComposerModelGroup {
  providerId: string
  providerLabel: string
  options: Array<{
    value: string
    label: string
  }>
}

interface AiComposerProps {
  modelGroups: AiComposerModelGroup[]
  modelValue: string
  isSending: boolean
  onModelChange: (value: string) => void
  onCreateSession: () => void
  onSend: (parts: AiComposerPart[]) => void
}

export interface AiComposerHandle {
  addReference: (reference: AiTextReference) => void
  clear: () => void
  focus: () => void
  getParts: () => AiComposerPart[]
  hasContent: () => boolean
  isFocused: () => boolean
  setParts: (parts: AiComposerPart[]) => void
  setPlainText: (text: string) => void
}

/** 根据内容把富文本输入区高度限制在 3 到 8 行之间 */
function resizeComposerInput(inputElement: HTMLElement) {
  // 1. 先恢复自动高度，让删除内容时输入区也能收回
  inputElement.style.height = 'auto'

  // 2. 根据当前字体行高计算 3 行和 8 行的真实像素高度
  const styles = window.getComputedStyle(inputElement)
  const lineHeight = Number.parseFloat(styles.lineHeight) || AI_COMPOSER_FALLBACK_LINE_HEIGHT
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0
  const minHeight = lineHeight * AI_COMPOSER_MIN_ROWS + paddingTop + paddingBottom
  const maxHeight = lineHeight * AI_COMPOSER_MAX_ROWS + paddingTop + paddingBottom
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, inputElement.scrollHeight))

  // 3. 超过 8 行后固定高度并开启内部滚动
  inputElement.style.height = `${nextHeight}px`
  inputElement.style.overflowY = inputElement.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

/** 判断某个节点是否位于 composer 输入区内 */
function isNodeInsideComposer(rootElement: HTMLElement, node: Node | null) {
  return Boolean(node && (node === rootElement || rootElement.contains(node)))
}

/** 把光标放到指定节点之后 */
function placeCaretAfterNode(rootElement: HTMLElement, node: Node) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  rootElement.focus()
}

/** 把光标放到输入区末尾 */
function placeCaretAtEnd(rootElement: HTMLElement) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.selectNodeContents(rootElement)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
  rootElement.focus()
}

/** 创建引用胶囊 DOM，避免 React 重绘打断 contentEditable 光标 */
function createReferencePillElement(reference: AiTextReference) {
  const pillElement = document.createElement('span')
  pillElement.className = 'ai-composer-reference-pill'
  pillElement.contentEditable = 'false'
  pillElement.dataset.aiReferenceId = reference.id
  pillElement.setAttribute('role', 'button')
  pillElement.setAttribute('aria-label', `引用 ${formatAiReferenceLabel(reference)}`)

  const labelElement = document.createElement('span')
  labelElement.className = 'ai-composer-reference-label'
  labelElement.textContent = formatAiReferenceLabel(reference)
  pillElement.append(labelElement)

  const removeElement = document.createElement('span')
  removeElement.className = 'ai-composer-reference-remove'
  removeElement.dataset.aiReferenceRemove = 'true'
  removeElement.setAttribute('aria-hidden', 'true')
  removeElement.textContent = '×'
  pillElement.append(removeElement)

  return pillElement
}

/** 创建普通文本节点 */
function createTextNode(text: string) {
  return document.createTextNode(text)
}

/** 在当前光标位置插入文本 */
function insertTextAtSelection(rootElement: HTMLElement, text: string) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !isNodeInsideComposer(rootElement, selection.anchorNode)) {
    rootElement.append(createTextNode(text))
    placeCaretAtEnd(rootElement)
    return
  }

  const range = selection.getRangeAt(0)
  range.deleteContents()
  const textNode = createTextNode(text)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** 读取紧邻光标左侧的引用胶囊 */
function getReferencePillBeforeCaret(rootElement: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
  if (!isNodeInsideComposer(rootElement, selection.anchorNode)) return null

  const range = selection.getRangeAt(0)
  const container = range.startContainer
  const offset = range.startOffset

  if (container === rootElement) {
    return findPreviousReferencePill(rootElement.childNodes[offset - 1] ?? null)
  }

  if (container.nodeType === Node.TEXT_NODE && offset === 0) {
    return findPreviousReferencePill(container.previousSibling)
  }

  return null
}

/** 跳过空文本节点，寻找左侧最近的引用胶囊 */
function findPreviousReferencePill(node: Node | null): HTMLElement | null {
  let currentNode = node
  while (currentNode) {
    if (currentNode instanceof HTMLElement && currentNode.dataset.aiReferenceId) return currentNode
    if (currentNode.nodeType === Node.TEXT_NODE && (currentNode.textContent ?? '') === '') {
      currentNode = currentNode.previousSibling
      continue
    }
    return null
  }

  return null
}

/** 把 DOM 子树读回 composer 片段 */
function collectComposerPartsFromNode(
  node: Node,
  referencesById: Map<string, AiTextReference>,
  parts: AiComposerPart[]
) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\u200b/g, '')
    if (text) parts.push(createAiComposerTextPart(text))
    return
  }
  if (!(node instanceof HTMLElement)) return

  const referenceId = node.dataset.aiReferenceId
  if (referenceId) {
    const reference = referencesById.get(referenceId)
    if (reference) parts.push(createAiComposerReferencePart(reference))
    return
  }

  if (node.tagName === 'BR') {
    parts.push(createAiComposerTextPart('\n'))
    return
  }

  const isBlockElement = node.tagName === 'DIV' || node.tagName === 'P'
  if (isBlockElement && parts.length > 0) parts.push(createAiComposerTextPart('\n'))
  Array.from(node.childNodes).forEach((childNode) => {
    collectComposerPartsFromNode(childNode, referencesById, parts)
  })
}

/** 从输入区 DOM 读取所有片段 */
function readComposerParts(rootElement: HTMLElement | null, referencesById: Map<string, AiTextReference>) {
  if (!rootElement) return []

  const parts: AiComposerPart[] = []
  Array.from(rootElement.childNodes).forEach((node) => {
    collectComposerPartsFromNode(node, referencesById, parts)
  })

  return normalizeAiComposerParts(parts)
}

/** 支持引用胶囊和文本混排的 AI 输入区 */
export const AiComposer = forwardRef<AiComposerHandle, AiComposerProps>(function AiComposer(
  { modelGroups, modelValue, isSending, onModelChange, onCreateSession, onSend },
  ref
) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const referencesByIdRef = useRef(new Map<string, AiTextReference>())
  const partsRef = useRef<AiComposerPart[]>([])
  const [hasContent, setHasContent] = useState(false)
  const [composerVersion, setComposerVersion] = useState(0)

  /** 同步 DOM、ref 和可发送状态 */
  function syncComposerState() {
    const parts = readComposerParts(editorRef.current, referencesByIdRef.current)
    partsRef.current = parts
    setHasContent(hasAiComposerContent(parts))
    setComposerVersion((version) => version + 1)
  }

  /** 用片段重建输入区 DOM */
  function renderPartsToDom(parts: AiComposerPart[], shouldFocus = false) {
    const editorElement = editorRef.current
    if (!editorElement) return

    referencesByIdRef.current.clear()
    editorElement.replaceChildren()
    parts.forEach((part) => {
      if (part.type === 'text') {
        editorElement.append(createTextNode(part.text))
        return
      }

      referencesByIdRef.current.set(part.reference.id, part.reference)
      editorElement.append(createReferencePillElement(part.reference))
    })

    partsRef.current = normalizeAiComposerParts(parts)
    setHasContent(hasAiComposerContent(partsRef.current))
    setComposerVersion((version) => version + 1)
    if (shouldFocus) placeCaretAtEnd(editorElement)
  }

  /** 在当前光标位置插入引用胶囊 */
  function insertReference(reference: AiTextReference) {
    const editorElement = editorRef.current
    if (!editorElement) return

    referencesByIdRef.current.set(reference.id, reference)
    editorElement.focus()

    const selection = window.getSelection()
    const pillElement = createReferencePillElement(reference)
    if (!selection || selection.rangeCount === 0 || !isNodeInsideComposer(editorElement, selection.anchorNode)) {
      editorElement.append(pillElement)
      placeCaretAfterNode(editorElement, pillElement)
      syncComposerState()
      return
    }

    const range = selection.getRangeAt(0)
    range.deleteContents()
    range.insertNode(pillElement)
    range.setStartAfter(pillElement)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    syncComposerState()
  }

  useImperativeHandle(ref, () => ({
    addReference(reference) {
      insertReference(reference)
    },
    clear() {
      renderPartsToDom([])
    },
    focus() {
      const editorElement = editorRef.current
      if (!editorElement) return
      placeCaretAtEnd(editorElement)
    },
    getParts() {
      syncComposerState()
      return partsRef.current
    },
    hasContent() {
      syncComposerState()
      return hasAiComposerContent(partsRef.current)
    },
    isFocused() {
      const editorElement = editorRef.current
      return Boolean(editorElement && document.activeElement && editorElement.contains(document.activeElement))
    },
    setParts(parts) {
      renderPartsToDom(parts, true)
    },
    setPlainText(text) {
      renderPartsToDom(text ? [createAiComposerTextPart(text)] : [], true)
    },
  }))

  useEffect(() => {
    const editorElement = editorRef.current
    if (!editorElement) return
    resizeComposerInput(editorElement)
  }, [composerVersion])

  /** 处理输入变化 */
  function handleInput() {
    syncComposerState()
  }

  /** 处理键盘发送、换行与胶囊删除 */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter') {
      if (isImeComposing(event)) return
      event.preventDefault()

      if (event.shiftKey && !(event.metaKey || event.ctrlKey)) {
        const editorElement = editorRef.current
        if (editorElement) {
          insertTextAtSelection(editorElement, '\n')
          syncComposerState()
        }
        return
      }

      handleSend()
      return
    }

    if (event.key !== 'Backspace') return
    const editorElement = editorRef.current
    if (!editorElement) return

    const previousPill = getReferencePillBeforeCaret(editorElement)
    if (!previousPill) return

    event.preventDefault()
    previousPill.remove()
    syncComposerState()
  }

  /** 粘贴时只接收纯文本，避免外部 HTML 破坏胶囊结构 */
  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const pastedText = event.clipboardData.getData('text/plain')
    if (!pastedText) return

    event.preventDefault()
    const editorElement = editorRef.current
    if (!editorElement) return
    insertTextAtSelection(editorElement, pastedText)
    syncComposerState()
  }

  /** 删除引用胶囊，或点击胶囊时把光标放到胶囊后 */
  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    const targetElement = event.target instanceof HTMLElement ? event.target : null
    const pillElement = targetElement?.closest<HTMLElement>('[data-ai-reference-id]') ?? null
    if (!pillElement) return

    event.preventDefault()
    event.stopPropagation()

    if (targetElement?.closest('[data-ai-reference-remove]')) {
      pillElement.remove()
      syncComposerState()
      editorRef.current?.focus()
      return
    }

    const editorElement = editorRef.current
    if (editorElement) placeCaretAfterNode(editorElement, pillElement)
  }

  /** 发送当前 composer 内容 */
  function handleSend() {
    syncComposerState()
    const parts = partsRef.current
    if (!hasAiComposerContent(parts) || isSending) return
    onSend(parts)
  }

  return (
    <div className="ai-composer">
      <div className="ai-composer-box">
        <div className="ai-composer-editor-wrap">
          <div
            ref={editorRef}
            className="ai-composer-rich-input"
            contentEditable
            role="textbox"
            aria-label="AI 对话输入"
            aria-multiline="true"
            spellCheck
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onMouseDown={handleMouseDown}
          />
          {!hasContent ? <div className="ai-composer-placeholder">基于当前笔记继续聊...</div> : null}
        </div>
        <div className="ai-composer-controls">
          <Select value={modelValue} onValueChange={onModelChange}>
            <SelectTrigger>
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent position="popper" side="top">
              {modelGroups.map((group) => (
                <SelectGroup key={group.providerId}>
                  <SelectLabel>{group.providerLabel}</SelectLabel>
                  {group.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label || '选择模型'}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <div className="ai-composer-actions">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ai-composer-new-session-btn"
              onClick={onCreateSession}
              disabled={isSending}
              aria-label="开启新对话"
              title="开启新对话"
            >
              <BrushCleaning className="size-[17px]" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="size-8 shrink-0 rounded-full shadow-[0_4px_12px_color-mix(in_srgb,var(--theme-text-primary)_18%,transparent_82%)] transition-[transform,box-shadow,opacity] hover:-translate-y-px hover:shadow-[0_8px_18px_color-mix(in_srgb,var(--theme-text-primary)_22%,transparent_78%)] active:translate-y-0 active:shadow-[0_3px_10px_color-mix(in_srgb,var(--theme-text-primary)_14%,transparent_86%)] disabled:opacity-[0.36] disabled:shadow-none disabled:hover:translate-y-0"
              onClick={handleSend}
              disabled={!hasContent || isSending}
              aria-label="发送消息"
            >
              <ArrowUp className="size-[18px] stroke-[2.2]" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
})
