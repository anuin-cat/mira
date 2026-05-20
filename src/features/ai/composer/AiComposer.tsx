import { ArrowUp, BrushCleaning, Square } from 'lucide-react'
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
} from '@/components/ui/select'
import type { AiTextReference } from '@/domain/ai'
import { isImeComposing } from '@/lib/keyboard'
import { AiReferenceFloatingTooltip } from '../references/AiReferencePill'
import {
  createAiComposerTextPart,
  hasAiComposerContent,
  normalizeAiComposerParts,
  type AiComposerPart,
} from './aiComposerModel'
import {
  AI_REFERENCE_REMOVE_SELECTOR,
  AI_REFERENCE_SELECTOR,
  applyComposerSelection,
  createReferencePillNodes,
  createTextNode,
  getCurrentComposerRange,
  getReferencePillAfterCaret,
  getReferencePillBeforeCaret,
  insertTextAtSelection,
  isComposerRangeUsable,
  placeCaretAfterReferencePill,
  placeCaretAtEnd,
  placeCaretBeforeReferencePill,
  placeCaretInTextNode,
  readComposerParts,
  removeReferencePill,
  resizeComposerInput,
} from './aiComposerDom'
import './ai-composer.css'

interface HoveredReference {
  reference: AiTextReference
  anchorRect: DOMRect
}

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
  onStopGenerating: () => void
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

/** 支持引用胶囊和文本混排的 AI 输入区 */
export const AiComposer = forwardRef<AiComposerHandle, AiComposerProps>(function AiComposer(
  { modelGroups, modelValue, isSending, onModelChange, onCreateSession, onSend, onStopGenerating },
  ref
) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const referencesByIdRef = useRef(new Map<string, AiTextReference>())
  const partsRef = useRef<AiComposerPart[]>([])
  const lastSelectionRangeRef = useRef<Range | null>(null)
  const [hasContent, setHasContent] = useState(false)
  const [composerVersion, setComposerVersion] = useState(0)
  const [hoveredReference, setHoveredReference] = useState<HoveredReference | null>(null)

  /** 记录输入框最近一次有效选区，方便从编辑器划词回来后按原位置插入胶囊 */
  function saveComposerSelection() {
    const editorElement = editorRef.current
    if (!editorElement) return

    const range = getCurrentComposerRange(editorElement)
    if (range) lastSelectionRangeRef.current = range.cloneRange()
  }

  /** 获取引用插入位置：优先当前选区，其次上次输入框选区 */
  function getReferenceInsertionRange(editorElement: HTMLElement) {
    const currentRange = getCurrentComposerRange(editorElement)
    if (currentRange) return currentRange.cloneRange()

    const savedRange = lastSelectionRangeRef.current
    if (isComposerRangeUsable(editorElement, savedRange)) return savedRange?.cloneRange() ?? null

    return null
  }

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
    lastSelectionRangeRef.current = null
    editorElement.replaceChildren()
    parts.forEach((part) => {
      if (part.type === 'text') {
        editorElement.append(createTextNode(part.text))
        return
      }

      referencesByIdRef.current.set(part.reference.id, part.reference)
      const { pillElement, spacerNode } = createReferencePillNodes(part.reference)
      editorElement.append(pillElement, spacerNode)
    })

    partsRef.current = normalizeAiComposerParts(parts)
    setHasContent(hasAiComposerContent(partsRef.current))
    setComposerVersion((version) => version + 1)
    if (shouldFocus) {
      placeCaretAtEnd(editorElement)
      saveComposerSelection()
    }
  }

  /** 在当前光标位置插入引用胶囊 */
  function insertReference(reference: AiTextReference) {
    const editorElement = editorRef.current
    if (!editorElement) return

    referencesByIdRef.current.set(reference.id, reference)
    const { pillElement, spacerNode } = createReferencePillNodes(reference)
    const insertionRange = getReferenceInsertionRange(editorElement)

    if (!insertionRange) {
      editorElement.append(pillElement, spacerNode)
      placeCaretInTextNode(editorElement, spacerNode, spacerNode.data.length)
      syncComposerState()
      saveComposerSelection()
      return
    }

    const fragment = document.createDocumentFragment()
    fragment.append(pillElement, spacerNode)
    insertionRange.deleteContents()
    insertionRange.insertNode(fragment)
    placeCaretInTextNode(editorElement, spacerNode, spacerNode.data.length)
    syncComposerState()
    saveComposerSelection()
  }

  /** 读取鼠标事件命中的引用胶囊和对应引用数据 */
  function getReferencePillFromEventTarget(target: EventTarget | null) {
    const targetElement = target instanceof HTMLElement ? target : null
    const pillElement = targetElement?.closest<HTMLElement>(AI_REFERENCE_SELECTOR) ?? null
    if (!pillElement || !editorRef.current?.contains(pillElement)) return null

    const referenceId = pillElement.dataset.aiReferenceId
    const reference = referenceId ? referencesByIdRef.current.get(referenceId) : null
    return reference ? { pillElement, reference } : null
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

      const currentRange = getCurrentComposerRange(editorElement)
      if (currentRange) {
        applyComposerSelection(editorElement, currentRange.cloneRange())
        saveComposerSelection()
        return
      }

      const savedRange = lastSelectionRangeRef.current
      if (isComposerRangeUsable(editorElement, savedRange) && savedRange) {
        applyComposerSelection(editorElement, savedRange.cloneRange())
        saveComposerSelection()
        return
      }

      placeCaretAtEnd(editorElement)
      saveComposerSelection()
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

  useEffect(() => {
    document.addEventListener('selectionchange', saveComposerSelection)
    return () => document.removeEventListener('selectionchange', saveComposerSelection)
  }, [])

  /** 处理输入变化 */
  function handleInput() {
    syncComposerState()
    saveComposerSelection()
  }

  /** 处理普通选区变化 */
  function handleSelectionChange() {
    saveComposerSelection()
  }

  /** 处理键盘发送、换行与胶囊作为文本单位的跳转/删除 */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const editorElement = editorRef.current

    if (event.key === 'ArrowRight' && editorElement) {
      const nextPill = getReferencePillAfterCaret(editorElement)
      if (nextPill) {
        event.preventDefault()
        placeCaretAfterReferencePill(editorElement, nextPill)
        saveComposerSelection()
      }
      return
    }

    if (event.key === 'ArrowLeft' && editorElement) {
      const previousPill = getReferencePillBeforeCaret(editorElement)
      if (previousPill) {
        event.preventDefault()
        placeCaretBeforeReferencePill(editorElement, previousPill)
        saveComposerSelection()
      }
      return
    }

    if (event.key === 'Enter') {
      if (isImeComposing(event)) return
      event.preventDefault()

      if (event.shiftKey && !(event.metaKey || event.ctrlKey)) {
        if (editorElement) {
          insertTextAtSelection(editorElement, '\n')
          syncComposerState()
          saveComposerSelection()
        }
        return
      }

      handleSend()
      return
    }

    if (!editorElement) return

    if (event.key === 'Backspace') {
      const previousPill = getReferencePillBeforeCaret(editorElement)
      if (!previousPill) return

      event.preventDefault()
      removeReferencePill(editorElement, previousPill)
      syncComposerState()
      saveComposerSelection()
      return
    }

    if (event.key === 'Delete') {
      const nextPill = getReferencePillAfterCaret(editorElement)
      if (!nextPill) return

      event.preventDefault()
      removeReferencePill(editorElement, nextPill)
      syncComposerState()
      saveComposerSelection()
    }
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
    saveComposerSelection()
  }

  /** 删除引用胶囊，或点击胶囊时把光标放到胶囊后 */
  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    const targetElement = event.target instanceof HTMLElement ? event.target : null
    const pillElement = targetElement?.closest<HTMLElement>(AI_REFERENCE_SELECTOR) ?? null
    if (!pillElement) return

    const editorElement = editorRef.current
    if (!editorElement) return

    event.preventDefault()
    event.stopPropagation()

    if (targetElement?.closest(AI_REFERENCE_REMOVE_SELECTOR)) {
      setHoveredReference(null)
      removeReferencePill(editorElement, pillElement)
      syncComposerState()
      saveComposerSelection()
      return
    }

    placeCaretAfterReferencePill(editorElement, pillElement)
    saveComposerSelection()
  }

  /** 鼠标悬浮输入区胶囊时展示同款引用预览 */
  function handleMouseOver(event: MouseEvent<HTMLDivElement>) {
    const matchedReference = getReferencePillFromEventTarget(event.target)
    if (!matchedReference) return

    setHoveredReference({
      reference: matchedReference.reference,
      anchorRect: matchedReference.pillElement.getBoundingClientRect(),
    })
  }

  /** 鼠标离开当前胶囊后隐藏引用预览 */
  function handleMouseOut(event: MouseEvent<HTMLDivElement>) {
    const matchedReference = getReferencePillFromEventTarget(event.target)
    if (!matchedReference) return

    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && matchedReference.pillElement.contains(relatedTarget)) return
    setHoveredReference(null)
  }

  /** 发送当前 composer 内容 */
  function handleSend() {
    syncComposerState()
    const parts = partsRef.current
    if (!hasAiComposerContent(parts) || isSending) return
    onSend(parts)
  }

  /** 根据当前生成状态执行发送或停止 */
  function handlePrimaryAction() {
    if (isSending) {
      onStopGenerating()
      return
    }

    handleSend()
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
            onKeyUp={handleSelectionChange}
            onFocus={handleSelectionChange}
            onMouseUp={handleSelectionChange}
            onPaste={handlePaste}
            onMouseDown={handleMouseDown}
            onMouseOver={handleMouseOver}
            onMouseOut={handleMouseOut}
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
              className={`ai-composer-primary-btn${isSending ? ' is-stopping' : ''}`}
              onClick={handlePrimaryAction}
              disabled={!hasContent && !isSending}
              aria-label={isSending ? '停止生成' : '发送消息'}
              title={isSending ? '停止生成 · Esc' : '发送消息'}
            >
              {isSending ? (
                <Square className="size-[13px] fill-current stroke-[2.4]" aria-hidden />
              ) : (
                <ArrowUp className="size-[18px] stroke-[2.2]" aria-hidden />
              )}
            </Button>
          </div>
        </div>
      </div>
      {hoveredReference ? (
        <AiReferenceFloatingTooltip
          reference={hoveredReference.reference}
          anchorRect={hoveredReference.anchorRect}
        />
      ) : null}
    </div>
  )
})
