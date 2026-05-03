import {
  NESTED_EDITOR_UPDATED_COMMAND,
  addActivePlugin$,
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addSyntaxExtension$,
  addToMarkdownExtension$,
  createRootEditorSubscription$,
  realmPlugin,
  type LexicalExportVisitor,
  type MdastImportVisitor,
} from '@mdxeditor/editor'
import { renderToString } from 'katex'
import { mathFromMarkdown, mathToMarkdown, type InlineMath, type Math as BlockMath } from 'mdast-util-math'
import { math } from 'micromark-extension-math'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
} from 'react'
import {
  $applyNodeReplacement,
  $isTextNode,
  $nodesOfType,
  DecoratorNode,
  type TextNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical'
import type { JSX } from 'react'
import {
  createInlineMathCaretMarker,
  INLINE_MATH_CARET_MARKER,
  isInlineMathCaretMarker,
  stripInlineMathCaretMarkers,
} from './inlineMathCaret'
import { registerInlineMathBoundaryControls } from './inlineMathSelection'
import { registerMathTextAutoConversion } from './mathAutoConvert'

const MATH_PLUGIN_ID = 'math'
const INLINE_EDITOR_MIN_CH = 8
const INLINE_EDITOR_MAX_CH = 56
const BLOCK_EDITOR_MIN_ROWS = 3
const BLOCK_EDITOR_MAX_ROWS = 12

type MathKind = 'inline' | 'block'

interface FocusEmitter {
  publish: () => void
  subscribe: (callback: () => void) => () => void
}

type SerializedMiraMathNode = SerializedLexicalNode & {
  kind: MathKind
  value: string
  type: 'mira-math'
  version: 1
}

/** 创建公式节点的轻量聚焦通知器，用于快捷输入后自动进入编辑态 */
function createFocusEmitter(): FocusEmitter {
  const callbacks = new Set<() => void>()

  return {
    publish: () => callbacks.forEach((callback) => callback()),
    subscribe: (callback) => {
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    },
  }
}

/** 判断键盘事件是否还在 IME 组合输入中 */
function isComposingEvent(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
  return event.nativeEvent.isComposing || event.keyCode === 229
}

/** 把 KaTeX 异常收敛为可展示的短错误 */
function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return '公式语法错误'
}

/** 使用 KaTeX 渲染公式源码，失败时交给 UI 展示源码与错误态 */
function renderMathSource(value: string, isInline: boolean) {
  const source = value.trim()
  if (!source) return { html: '', error: null }

  try {
    return {
      html: renderToString(source, {
        displayMode: !isInline,
        output: 'html',
        strict: false,
        throwOnError: true,
      }),
      error: null,
    }
  } catch (error) {
    return { html: '', error: getErrorMessage(error) }
  }
}

/** 为行内公式补齐两侧光标锚点，避免方向键和选区边界跳转 */
function ensureInlineMathCaretMarker(node: MiraMathNode) {
  if (!node.isInline()) return
  if (!isInlineMathCaretMarker(node.getPreviousSibling())) node.insertBefore(createInlineMathCaretMarker())
  if (isInlineMathCaretMarker(node.getNextSibling())) return
  node.insertAfter(createInlineMathCaretMarker())
}

/** 生成公式节点对应的 Markdown 源文本，用于复制、剪切和纯文本语义 */
function getMathMarkdownText(value: string, kind: MathKind) {
  return kind === 'inline' ? `$${value}$` : `$$\n${value}\n$$`
}

interface MathEditorProps {
  editor: LexicalEditor
  focusEmitter: FocusEmitter
  kind: MathKind
  node: MiraMathNode
  value: string
}

interface MathSourceEditorProps {
  draft: string
  inputRef: MutableRefObject<HTMLInputElement | HTMLTextAreaElement | null>
  isInline: boolean
  onBlur: () => void
  onDraftChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}

interface MathRenderedViewProps {
  error: string | null
  html: string
  isInline: boolean
  onEdit: () => void
  value: string
}

/** 公式源码输入态，行内用 input，块级用 textarea */
function MathSourceEditor({ draft, inputRef, isInline, onBlur, onDraftChange, onKeyDown }: MathSourceEditorProps) {
  const inlineEditorStyle = {
    '--mira-math-inline-editor-width': `${Math.min(
      Math.max(draft.length + 2, INLINE_EDITOR_MIN_CH),
      INLINE_EDITOR_MAX_CH
    )}ch`,
  } as CSSProperties
  const textareaRows = Math.min(Math.max(draft.split('\n').length, BLOCK_EDITOR_MIN_ROWS), BLOCK_EDITOR_MAX_ROWS)

  if (!isInline) {
    return (
      <textarea
        ref={(element) => {
          inputRef.current = element
        }}
        aria-label="编辑块级公式"
        className="mira-math-source mira-math-source-block"
        contentEditable={false}
        rows={textareaRows}
        spellCheck={false}
        value={draft}
        onBlur={onBlur}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      />
    )
  }

  return (
    <input
      ref={(element) => {
        inputRef.current = element
      }}
      aria-label="编辑行内公式"
      className="mira-math-source mira-math-source-inline"
      contentEditable={false}
      spellCheck={false}
      style={inlineEditorStyle}
      value={draft}
      onBlur={onBlur}
      onChange={(event) => onDraftChange(event.target.value)}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
    />
  )
}

/** 公式渲染态，点击后交还给外层进入源码编辑 */
function MathRenderedView({ error, html, isInline, onEdit, value }: MathRenderedViewProps) {
  /** 渲染态点击后直接进入原位源码编辑 */
  function handleMouseDown(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    onEdit()
  }

  const className = [
    isInline ? 'mira-math-render mira-math-render-inline' : 'mira-math-render mira-math-render-block',
    error ? 'mira-math-render-error' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const commonProps = {
    className,
    contentEditable: false,
    'data-mira-math-kind': isInline ? 'inline' : 'block',
    'data-mira-math-value': value,
    title: error ?? '点击编辑公式',
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onEdit()
    },
    onMouseDown: handleMouseDown,
  }

  if (error || !html) {
    const label = value.trim() || '空公式'
    return isInline ? (
      <span {...commonProps}>
        <code>{label}</code>
      </span>
    ) : (
      <div {...commonProps} role="button" tabIndex={0}>
        <code>{label}</code>
      </div>
    )
  }

  return isInline ? (
    <span {...commonProps} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div {...commonProps} role="button" tabIndex={0} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

/** 原位公式编辑器：默认渲染，点击后切换为源码，失焦提交 */
function MiraMathEditor({ editor, focusEmitter, kind, node, value }: MathEditorProps) {
  const isInline = kind === 'inline'
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const shouldCommitOnBlurRef = useRef(true)
  const rendered = useMemo(() => renderMathSource(value, isInline), [isInline, value])

  useEffect(() => {
    if (!isEditing) setDraft(value)
  }, [isEditing, value])

  useEffect(() => {
    return focusEmitter.subscribe(() => setIsEditing(true))
  }, [focusEmitter])

  useEffect(() => {
    if (!isEditing) return

    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [isEditing])

  /** 提交源码并通知 MDXEditor 重新导出 Markdown */
  function commitDraft() {
    const nextValue = draft
    setIsEditing(false)
    shouldCommitOnBlurRef.current = true

    if (nextValue === value) return
    editor.update(() => {
      node.setValue(nextValue)
      window.setTimeout(() => editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined), 0)
    })
  }

  /** 放弃本次编辑，避免 Esc 后 blur 又触发提交 */
  function cancelDraft() {
    shouldCommitOnBlurRef.current = false
    setDraft(value)
    setIsEditing(false)
  }

  /** 处理源码输入键盘提交，兼容中文 IME 候选确认 */
  function handleEditorKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    event.stopPropagation()
    if (isComposingEvent(event)) return

    if (event.key === 'Escape') {
      event.preventDefault()
      cancelDraft()
      return
    }

    if (isInline && event.key === 'Enter') {
      event.preventDefault()
      commitDraft()
      return
    }

    if (!isInline && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      commitDraft()
    }
  }

  /** 源码框失焦时自动提交，Esc 取消除外 */
  function handleEditorBlur() {
    if (!shouldCommitOnBlurRef.current) {
      shouldCommitOnBlurRef.current = true
      return
    }
    commitDraft()
  }

  if (isEditing) {
    return (
      <MathSourceEditor
        draft={draft}
        inputRef={inputRef}
        isInline={isInline}
        onBlur={handleEditorBlur}
        onDraftChange={setDraft}
        onKeyDown={handleEditorKeyDown}
      />
    )
  }

  return (
    <MathRenderedView
      error={rendered.error}
      html={rendered.html}
      isInline={isInline}
      value={value}
      onEdit={() => setIsEditing(true)}
    />
  )
}

/** Mira Markdown 公式节点，统一承载行内和块级公式 */
export class MiraMathNode extends DecoratorNode<JSX.Element> {
  __focusEmitter: FocusEmitter
  __kind: MathKind
  __value: string

  static getType() {
    return 'mira-math'
  }

  static clone(node: MiraMathNode) {
    return new MiraMathNode(node.__value, node.__kind, node.__key)
  }

  static importJSON(serializedNode: SerializedMiraMathNode) {
    return $createMiraMathNode(serializedNode.value, serializedNode.kind)
  }

  constructor(value: string, kind: MathKind, key?: NodeKey) {
    super(key)
    this.__value = value
    this.__kind = kind
    this.__focusEmitter = createFocusEmitter()
  }

  afterCloneFrom(prevNode: this) {
    super.afterCloneFrom(prevNode)
    this.__value = prevNode.__value
    this.__kind = prevNode.__kind
    this.__focusEmitter = createFocusEmitter()
  }

  exportJSON(): SerializedMiraMathNode {
    return {
      type: 'mira-math',
      version: 1,
      value: this.getValue(),
      kind: this.getKind(),
    }
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement(this.isInline() ? 'span' : 'div')
    element.textContent = getMathMarkdownText(this.getValue(), this.getKind())
    return { element }
  }

  getTextContent() {
    return getMathMarkdownText(this.getValue(), this.getKind())
  }

  createDOM(_config: EditorConfig, _editor: LexicalEditor) {
    const element = document.createElement(this.isInline() ? 'span' : 'div')
    element.className = this.isInline() ? 'mira-math-host mira-math-host-inline' : 'mira-math-host mira-math-host-block'
    return element
  }

  updateDOM() {
    return false
  }

  getKind() {
    return this.__kind
  }

  getValue() {
    return this.__value
  }

  setValue(value: string) {
    if (value !== this.__value) this.getWritable().__value = value
  }

  select() {
    this.__focusEmitter.publish()
  }

  decorate(editor: LexicalEditor) {
    return (
      <MiraMathEditor
        editor={editor}
        focusEmitter={this.__focusEmitter}
        kind={this.getKind()}
        node={this}
        value={this.getValue()}
      />
    )
  }

  isInline() {
    return this.__kind === 'inline'
  }

  isKeyboardSelectable() {
    return false
  }
}

/** 创建 Mira 公式节点并交给 Lexical 完成节点替换登记 */
export function $createMiraMathNode(value: string, kind: MathKind) {
  return $applyNodeReplacement(new MiraMathNode(value, kind))
}

/** 判断是否为 Mira 公式节点 */
export function $isMiraMathNode(node: LexicalNode | null | undefined): node is MiraMathNode {
  return node instanceof MiraMathNode
}

const MdastInlineMathVisitor: MdastImportVisitor<InlineMath> = {
  testNode: 'inlineMath',
  visitNode({ mdastNode, actions }) {
    actions.addAndStepInto(createInlineMathCaretMarker())
    actions.addAndStepInto($createMiraMathNode(mdastNode.value, 'inline'))
    actions.addAndStepInto(createInlineMathCaretMarker())
  },
}

const MdastBlockMathVisitor: MdastImportVisitor<BlockMath> = {
  testNode: 'math',
  visitNode({ mdastNode, actions }) {
    actions.addAndStepInto($createMiraMathNode(mdastNode.value, 'block'))
  },
}

const LexicalMathVisitor: LexicalExportVisitor<MiraMathNode, InlineMath | BlockMath> = {
  testLexicalNode: $isMiraMathNode,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const node = lexicalNode.isInline()
      ? ({ type: 'inlineMath', value: lexicalNode.getValue() } satisfies InlineMath)
      : ({ type: 'math', value: lexicalNode.getValue() } satisfies BlockMath)
    actions.appendToParent(mdastParent, node)
  },
}

const LexicalInlineMathCaretMarkerVisitor: LexicalExportVisitor<TextNode, InlineMath | BlockMath> = {
  priority: 100,
  testLexicalNode: (lexicalNode): lexicalNode is TextNode =>
    $isTextNode(lexicalNode) && lexicalNode.getTextContent().includes(INLINE_MATH_CARET_MARKER),
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const textContent = stripInlineMathCaretMarkers(lexicalNode.getTextContent())
    if (!textContent) return
    actions.appendToParent(mdastParent, { type: 'text', value: textContent })
  },
}

/** MDXEditor 公式插件：接入 Markdown math 解析、导出和自定义公式节点 */
export const mdxMathPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addActivePlugin$]: MATH_PLUGIN_ID,
      [addSyntaxExtension$]: math({ singleDollarTextMath: true }),
      [addMdastExtension$]: mathFromMarkdown(),
      [addToMarkdownExtension$]: mathToMarkdown({ singleDollarTextMath: true }),
      [addLexicalNode$]: MiraMathNode,
      [addImportVisitor$]: [MdastInlineMathVisitor, MdastBlockMathVisitor],
      [addExportVisitor$]: [LexicalInlineMathCaretMarkerVisitor, LexicalMathVisitor],
      [createRootEditorSubscription$]: (editor: LexicalEditor) => {
        editor.update(() => {
          $nodesOfType(MiraMathNode).forEach(ensureInlineMathCaretMarker)
        })
        const unregisterNodeTransform = editor.registerNodeTransform(MiraMathNode, ensureInlineMathCaretMarker)
        const unregisterBoundaryControls = registerInlineMathBoundaryControls(editor, {
          ensureCaretMarker: ensureInlineMathCaretMarker,
          isInlineMathNode: $isMiraMathNode,
        })
        const unregisterTextAutoConversion = registerMathTextAutoConversion(editor, {
          createBlockMathNode: (value) => $createMiraMathNode(value, 'block'),
          createInlineMathNode: (value) => $createMiraMathNode(value, 'inline'),
          ensureInlineMathCaretMarker,
        })

        return () => {
          unregisterNodeTransform()
          unregisterBoundaryControls()
          unregisterTextAutoConversion()
        }
      },
    })
  },
})
