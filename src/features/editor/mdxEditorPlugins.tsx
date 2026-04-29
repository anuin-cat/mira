import {
  codeBlockPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCodeBlockEditorContext,
  type CodeBlockEditorProps,
  type RealmPlugin,
} from '@mdxeditor/editor'
import { useEffect, useRef, useState, type Ref } from 'react'
import { isImeComposing } from '../../lib/keyboard'
import { EditorSearchControlsHandle } from './EditorSearchControls'
import type { EditorSearchSelectionResult } from './currentFileSearch'
import { MiraLinkDialog } from './MiraLinkDialog'
import { MiraToolbar } from './MiraToolbar'
import { miraMarkdownShortcutPlugin } from './miraMarkdownShortcutPlugin'

const IMAGE_AUTOCOMPLETE_SUGGESTIONS = ['./', '../', 'assets/', 'images/']
const CODE_BLOCK_MAX_EDIT_LINES = 8
const CODE_TOKEN_RE =
  /(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|import|export|from|if|else|for|while|class|interface|type|async|await|true|false|null|undefined)\b)/g
const TOOLBAR_TRANSLATIONS: Record<string, string> = {
  'toolbar.bold': '加粗',
  'toolbar.removeBold': '取消加粗',
  'toolbar.italic': '斜体',
  'toolbar.removeItalic': '取消斜体',
  'toolbar.underline': '下划线',
  'toolbar.removeUnderline': '取消下划线',
  'toolbar.inlineCode': '行内代码',
  'toolbar.removeInlineCode': '取消行内代码',
  'toolbar.strikethrough': '删除线',
  'toolbar.removeStrikethrough': '取消删除线',
  'toolbar.bulletedList': '无序列表',
  'toolbar.numberedList': '有序列表',
  'toolbar.checkList': '任务列表',
  'toolbar.blockTypeSelect.selectBlockTypeTooltip': '选择段落类型',
  'toolbar.blockTypeSelect.placeholder': '段落类型',
  'toolbar.blockTypes.paragraph': '正文',
  'toolbar.blockTypes.quote': '引用',
  'toolbar.link': '插入链接',
  'toolbar.image': '插入图片',
  'toolbar.table': '插入表格',
  'toolbar.thematicBreak': '插入分隔线',
  'toolbar.codeBlock': '插入代码块',
  'createLink.url': '链接地址',
  'createLink.urlPlaceholder': '粘贴或输入 URL',
  'createLink.title': '链接标题',
  'createLink.titleTooltip': '鼠标悬停时显示的标题，可留空',
  'createLink.saveTooltip': '保存链接',
  'createLink.cancelTooltip': '取消编辑',
  'dialogControls.save': '保存',
  'dialogControls.cancel': '取消',
  'linkPreview.edit': '编辑链接',
  'linkPreview.copyToClipboard': '复制链接',
  'linkPreview.copied': '已复制',
  'linkPreview.remove': '移除链接',
}

export interface CreateEditorPluginsOptions {
  isAiSidebarOpen: boolean
  isEditorSearchOpen: boolean
  onToggleAiSidebar: () => void
  onEditorSearchOpen: () => void
  onEditorSearchClose: () => void
  searchControlsRef: Ref<EditorSearchControlsHandle>
  onSelectEditorSearchMatch: (query: string, matchOrdinal: number) => EditorSearchSelectionResult
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

/** 按内容同步代码块 textarea 高度，最多展示 8 行后再内部滚动 */
function syncCodeBlockTextareaHeight(textarea: HTMLTextAreaElement) {
  const styles = window.getComputedStyle(textarea)
  const fontSize = Number.parseFloat(styles.fontSize) || 13
  const lineHeight = Number.parseFloat(styles.lineHeight) || fontSize * 1.62
  const paddingBlock =
    (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
  const borderBlock =
    (Number.parseFloat(styles.borderTopWidth) || 0) + (Number.parseFloat(styles.borderBottomWidth) || 0)
  const maxHeight = lineHeight * CODE_BLOCK_MAX_EDIT_LINES + paddingBlock + borderBlock

  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight + borderBlock, maxHeight)}px`
  textarea.style.overflowY = textarea.scrollHeight + borderBlock > maxHeight ? 'auto' : 'hidden'
}

/** 轻量代码块编辑器：保留语言和内容编辑，避免拉入完整 CodeMirror 代码块编辑器 */
function LightCodeBlockEditor({ code, language, focusEmitter }: CodeBlockEditorProps) {
  // 1. 维护轻量编辑态，并响应 MDXEditor 的聚焦请求
  const { setCode, setLanguage } = useCodeBlockEditorContext()
  const [isEditing, setIsEditing] = useState(false)
  const [copyLabel, setCopyLabel] = useState('复制')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /** 聚焦编辑框并在进入编辑态时立即同步高度 */
  function focusAndResizeTextarea() {
    const textarea = textareaRef.current
    if (!textarea) return
    syncCodeBlockTextareaHeight(textarea)
    textarea.focus()
  }

  useEffect(() => {
    focusEmitter.subscribe(() => {
      setIsEditing(true)
      window.requestAnimationFrame(focusAndResizeTextarea)
    })
  }, [focusEmitter])

  useEffect(() => {
    if (isEditing) window.requestAnimationFrame(focusAndResizeTextarea)
  }, [code, isEditing])

  /** 复制代码块文本，优先走 Clipboard API，失败后给出重试提示 */
  async function handleCopyClick() {
    try {
      await navigator.clipboard.writeText(code)
      setCopyLabel('已复制')
      window.setTimeout(() => setCopyLabel('复制'), 1200)
    } catch {
      setCopyLabel('复制失败')
      window.setTimeout(() => setCopyLabel('复制'), 1200)
    }
  }

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
        <div className="mira-code-block-actions">
          <button type="button" onClick={handleCopyClick}>
            {copyLabel}
          </button>
          <button type="button" onClick={() => setIsEditing((value) => !value)}>
            {isEditing ? '完成' : '编辑'}
          </button>
        </div>
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="mira-code-block-textarea"
          value={code}
          rows={1}
          spellCheck={false}
          aria-label="代码内容"
          onChange={(event) => {
            setCode(event.target.value)
            syncCodeBlockTextareaHeight(event.target)
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              if (isImeComposing(event)) return
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

/** 翻译 MDXEditor 工具栏文案，并保留带快捷键的动态项 */
export function translateMdxToolbar(
  key: string,
  defaultValue: string,
  interpolations?: Record<string, unknown>
) {
  if (key === 'toolbar.undo') {
    const shortcut = String(interpolations?.shortcut ?? '')
    return `撤销 ${shortcut}`.trim()
  }
  if (key === 'toolbar.redo') {
    const shortcut = String(interpolations?.shortcut ?? '')
    return `重做 ${shortcut}`.trim()
  }
  if (key === 'toolbar.blockTypes.heading') {
    const level = String(interpolations?.level ?? '')
    return `标题 ${level}`.trim()
  }
  return TOOLBAR_TRANSLATIONS[key] ?? defaultValue
}

/** 创建 MDXEditor 插件集合，只保留 Mira 当前要评估的 Markdown 能力 */
export function createEditorPlugins({
  isAiSidebarOpen,
  isEditorSearchOpen,
  onToggleAiSidebar,
  onEditorSearchOpen,
  onEditorSearchClose,
  searchControlsRef,
  onSelectEditorSearchMatch,
}: CreateEditorPluginsOptions): RealmPlugin[] {
  return [
    headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin({ disableAutoLink: true }),
    linkDialogPlugin({ LinkDialog: MiraLinkDialog, showLinkTitleField: true }),
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
    miraMarkdownShortcutPlugin(),
    toolbarPlugin({
      toolbarContents: () => (
        <MiraToolbar
          isAiSidebarOpen={isAiSidebarOpen}
          isEditorSearchOpen={isEditorSearchOpen}
          onToggleAiSidebar={onToggleAiSidebar}
          onEditorSearchOpen={onEditorSearchOpen}
          onEditorSearchClose={onEditorSearchClose}
          searchControlsRef={searchControlsRef}
          onSelectEditorSearchMatch={onSelectEditorSearchMatch}
        />
      ),
      toolbarClassName: 'mira-mdx-toolbar',
    }),
  ]
}
