import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  MDXEditor,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  headingsPlugin,
  imagePlugin,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  linkDialogPlugin,
  linkPlugin,
  ListsToggle,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  searchPlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCodeBlockEditorContext,
  type CodeBlockEditorProps,
  type MDXEditorMethods,
  type RealmPlugin,
} from '@mdxeditor/editor'
import { type ClipboardEvent as ReactClipboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { startWindowDrag, toggleWindowMaximize } from '../../tauri/window'

const IMAGE_AUTOCOMPLETE_SUGGESTIONS = ['./', '../', 'assets/', 'images/']
const CODE_TOKEN_RE =
  /(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|import|export|from|if|else|for|while|class|interface|type|async|await|true|false|null|undefined)\b)/g
const MARKDOWN_PASTE_BLOCK_RE =
  /(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+|```|~~~|\|.+\|\s*$|(?:[-*_]\s*){3,}$)/m
const MARKDOWN_PASTE_INLINE_RE =
  /(?:!\[[^\]]*]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`)/
const BLOCK_TYPE_TRANSLATIONS: Record<string, string> = {
  'toolbar.blockTypes.paragraph': '正文',
  'toolbar.blockTypes.quote': '引用',
}
const WINDOW_DRAG_IGNORE_SELECTOR =
  'button, input, textarea, select, a, [role="button"], [contenteditable="true"]'

interface Props {
  initialContent: string
  onChange: (markdown: string) => void
}

/** 转义代码内容，避免高亮时把用户文本当作 HTML */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 根据代码片段内容判断高亮分类 */
function getCodeTokenClass(token: string) {
  if (token.startsWith('//') || token.startsWith('#')) return 'mira-code-token-comment'
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
    return 'mira-code-token-string'
  }
  return 'mira-code-token-keyword'
}

/** 判断一段纯文本是否明显带有 Markdown 语法，避免误伤普通粘贴 */
function looksLikeMarkdown(text: string) {
  // 1. 先过滤空白内容，避免无意义的语法判断
  const normalizedText = text.trim()
  if (!normalizedText) return false

  // 2. 优先识别标题、列表、引用、代码块、表格等块级语法
  if (MARKDOWN_PASTE_BLOCK_RE.test(normalizedText)) return true

  // 3. 再补充识别粗体、链接、行内代码等常见行内语法
  return MARKDOWN_PASTE_INLINE_RE.test(normalizedText)
}

/** 判断工具栏点击是否落在按钮、输入框等交互控件上 */
function isWindowDragIgnoredTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(WINDOW_DRAG_IGNORE_SELECTOR))
}

/** 判断本次粘贴是否应该走 Markdown 导入，而不是按普通文本插入 */
function shouldImportMarkdownFromPaste(event: ReactClipboardEvent<HTMLDivElement>) {
  // 1. 输入框和 textarea 里应保留原生粘贴，避免代码块与弹窗输入被自动格式化
  const targetElement = event.target instanceof HTMLElement ? event.target : null
  if (targetElement?.closest('input, textarea')) return false

  // 2. 文件/图片粘贴交给编辑器现有逻辑处理，不在这里接管
  const clipboardData = event.clipboardData
  if (!clipboardData || clipboardData.files.length > 0) return false

  // 3. 只有纯文本里出现明显 Markdown 语法时，才触发自动导入
  return looksLikeMarkdown(clipboardData.getData('text/plain'))
}

/** 给轻量代码块做最小语法高亮，不引入额外高亮库 */
function highlightCode(code: string) {
  let html = ''
  let cursor = 0

  for (const match of code.matchAll(CODE_TOKEN_RE)) {
    const index = match.index ?? 0
    const token = match[0]
    html += escapeHtml(code.slice(cursor, index))
    html += `<span class="${getCodeTokenClass(token)}">${escapeHtml(token)}</span>`
    cursor = index + token.length
  }

  return html + escapeHtml(code.slice(cursor))
}

/** 轻量代码块编辑器：保留语言和内容编辑，避免拉入完整 CodeMirror 代码块编辑器 */
function LightCodeBlockEditor({ code, language, focusEmitter }: CodeBlockEditorProps) {
  // 1. 维护轻量编辑态，并响应 MDXEditor 的聚焦请求
  const { setCode, setLanguage } = useCodeBlockEditorContext()
  const [isEditing, setIsEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    focusEmitter.subscribe(() => {
      setIsEditing(true)
      window.requestAnimationFrame(() => textareaRef.current?.focus())
    })
  }, [focusEmitter])

  useEffect(() => {
    if (isEditing) window.requestAnimationFrame(() => textareaRef.current?.focus())
  }, [isEditing])

  // 2. 预览态展示轻量高亮，编辑态使用原生 textarea 写回 Markdown
  return (
    <div className="mira-code-block">
      <div className="mira-code-block-toolbar">
        <input
          className="mira-code-block-language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          placeholder="txt"
          aria-label="代码语言"
        />
        <button type="button" onClick={() => setIsEditing((value) => !value)}>
          {isEditing ? '完成' : '编辑'}
        </button>
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="mira-code-block-textarea"
          value={code}
          spellCheck={false}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              setIsEditing(false)
            }
            if (event.key === 'Escape') setIsEditing(false)
          }}
        />
      ) : (
        <pre className="mira-code-block-preview" onDoubleClick={() => setIsEditing(true)}>
          <code dangerouslySetInnerHTML={{ __html: highlightCode(code) }} />
        </pre>
      )}
    </div>
  )
}

/** Mira 使用的 MDXEditor 顶部工具栏 */
function MiraToolbar() {
  return (
    <>
      <div className="mira-toolbar-drag-spacer" />
      <UndoRedo />
      <Separator />
      <BoldItalicUnderlineToggles />
      <CodeToggle />
      <StrikeThroughSupSubToggles />
      <Separator />
      <ListsToggle />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <CreateLink />
      <InsertImage />
      <Separator />
      <InsertTable />
      <InsertThematicBreak />
      <Separator />
      <InsertCodeBlock />
      <div className="mira-toolbar-drag-spacer" />
    </>
  )
}

/** 创建 MDXEditor 插件集合，只保留 Mira 当前要评估的 Markdown 能力 */
function createEditorPlugins(): RealmPlugin[] {
  return [
    headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin({ showLinkTitleField: true }),
    imagePlugin({
      imageAutocompleteSuggestions: IMAGE_AUTOCOMPLETE_SUGGESTIONS,
      disableImageResize: false,
      disableImageSettingsButton: false,
      allowSetImageDimensions: true,
    }),
    tablePlugin(),
    codeBlockPlugin({
      defaultCodeBlockLanguage: 'txt',
      codeBlockEditorDescriptors: [
        {
          priority: 1,
          match: () => true,
          Editor: LightCodeBlockEditor,
        },
      ],
    }),
    searchPlugin(),
    markdownShortcutPlugin(),
    toolbarPlugin({
      toolbarContents: () => <MiraToolbar />,
      toolbarClassName: 'mira-mdx-toolbar',
    }),
  ]
}

/** MDXEditor 富文本 Markdown 编辑器，输入输出均保持 .md 文本内容 */
export function MdxEditor({ initialContent, onChange }: Props) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MDXEditorMethods>(null)
  const plugins = useMemo(() => createEditorPlugins(), [])

  useEffect(() => {
    const toolbarElement = shellRef.current?.querySelector<HTMLElement>('.mira-mdx-toolbar')
    if (!toolbarElement) return

    const handleToolbarMouseDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || event.detail > 1) return
      if (isWindowDragIgnoredTarget(event.target)) return

      event.preventDefault()
      void startWindowDrag().catch((error) => {
        console.warn('窗口拖动启动失败', error)
      })
    }
    const handleToolbarDoubleClick = (event: globalThis.MouseEvent) => {
      if (isWindowDragIgnoredTarget(event.target)) return

      event.preventDefault()
      void toggleWindowMaximize().catch((error) => {
        console.warn('窗口最大化切换失败', error)
      })
    }

    toolbarElement.addEventListener('mousedown', handleToolbarMouseDown)
    toolbarElement.addEventListener('dblclick', handleToolbarDoubleClick)
    return () => {
      toolbarElement.removeEventListener('mousedown', handleToolbarMouseDown)
      toolbarElement.removeEventListener('dblclick', handleToolbarDoubleClick)
    }
  }, [])

  /** 捕获粘贴事件，把明显的 Markdown 纯文本按语法导入为富文本块 */
  function handleEditorPasteCapture(event: ReactClipboardEvent<HTMLDivElement>) {
    // 1. 先判断当前粘贴是否适合走 Markdown 导入
    if (!shouldImportMarkdownFromPaste(event)) return

    // 2. 阻止浏览器与 Lexical 的默认粘贴链路，避免 Markdown 被插入两次
    const markdownText = event.clipboardData.getData('text/plain')
    if (!markdownText) return

    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation?.()

    // 3. 改用 MDXEditor 的 Markdown 解析能力，把纯文本导入为富文本块
    editorRef.current?.insertMarkdown(markdownText)
  }

  return (
    <div ref={shellRef} className="mdx-editor-shell">
      <div className="mdx-editor-root" onPasteCapture={handleEditorPasteCapture}>
        <MDXEditor
          ref={editorRef}
          className="mira-mdx-editor"
          contentEditableClassName="mira-mdx-content"
          markdown={initialContent}
          plugins={plugins}
          translation={(key, defaultValue, interpolations) => {
            if (key === 'toolbar.blockTypes.heading') {
              const level = String(interpolations?.level ?? '')
              return `标题 ${level}`.trim()
            }
            return BLOCK_TYPE_TRANSLATIONS[key] ?? defaultValue
          }}
          placeholder="开始记录..."
          trim={false}
          toMarkdownOptions={{
            bullet: '-',
            rule: '-',
            emphasis: '*',
            strong: '*',
            listItemIndent: 'one',
          }}
          onChange={(markdown, initialMarkdownNormalize) => {
            if (!initialMarkdownNormalize) onChange(markdown)
          }}
          onError={({ error, source }) => {
            console.warn('MDXEditor 解析 Markdown 失败', { error, source })
          }}
        />
      </div>
    </div>
  )
}
