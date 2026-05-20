import {
  CodeMirrorEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
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
import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type MouseEvent, type Ref } from 'react'
import { getPlatformShortcut, type PlatformShortcut } from '../../lib/platform'
import { EditorSearchControlsHandle } from './EditorSearchControls'
import type { EditorSearchSelectionResult } from './currentFileSearch'
import { MiraLinkDialog } from './MiraLinkDialog'
import { MiraToolbar } from './MiraToolbar'
import { miraMarkdownShortcutPlugin } from './miraMarkdownShortcutPlugin'
import { mdxMathPlugin } from './math/mdxMathPlugin'
import { mdxListStartPlugin } from './mdxListStartPlugin'
import { singleTildeStrikethroughPlugin } from './singleTildeStrikethroughPlugin'
import {
  ATTACHMENTS_ROOT_DIR,
  resolveImagePreviewSource,
  saveImageAttachment,
} from '../../services/attachments'

const IMAGE_AUTOCOMPLETE_SUGGESTIONS = [`${ATTACHMENTS_ROOT_DIR}/`, './', '../', 'assets/', 'images/']
const DEFAULT_CODE_BLOCK_LANGUAGE = 'txt'
const CODE_BLOCK_COPY_RESET_MS = 1200
const CODE_BLOCK_LANGUAGE_DETECT_DELAY_MS = 260
const AUTO_MANAGED_CODE_LANGUAGES = new Set([
  '',
  'txt',
  'json',
  'html',
  'css',
  'bash',
  'sh',
  'py',
  'python',
  'ts',
  'tsx',
  'js',
  'jsx',
  'md',
  'markdown',
])
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
  'uploadImage.dialogTitle': '插入图片',
  'uploadImage.uploadInstructions': '从本机选择图片：',
  'uploadImage.addViaUrlInstructions': '或粘贴图片 URL：',
  'uploadImage.addViaUrlInstructionsNoUpload': '粘贴图片 URL：',
  'uploadImage.autoCompletePlaceholder': '选择或粘贴图片地址',
  'uploadImage.alt': '替代文本',
  'uploadImage.title': '标题',
}
const TOOLBAR_SHORTCUTS: Record<string, PlatformShortcut> = {
  'toolbar.bold': { mac: '⌘B', windows: 'Ctrl+B' },
  'toolbar.removeBold': { mac: '⌘B', windows: 'Ctrl+B' },
  'toolbar.italic': { mac: '⌘I', windows: 'Ctrl+I' },
  'toolbar.removeItalic': { mac: '⌘I', windows: 'Ctrl+I' },
  'toolbar.underline': { mac: '⌘U', windows: 'Ctrl+U' },
  'toolbar.removeUnderline': { mac: '⌘U', windows: 'Ctrl+U' },
  'toolbar.link': { mac: '⌘K', windows: 'Ctrl+K' },
  'toolbar.blockTypeSelect.selectBlockTypeTooltip': { mac: '⌥⌘0-6', windows: 'Ctrl+Alt+0-6' },
}

export interface CreateEditorPluginsOptions {
  isAiSidebarOpen: boolean
  isEditorSearchOpen: boolean
  vaultPath: string | null
  notePath: string | null
  onToggleAiSidebar: () => void
  onEditorSearchOpen: () => void
  onEditorSearchClose: () => void
  searchControlsRef: Ref<EditorSearchControlsHandle>
  onSelectEditorSearchMatch: (query: string, matchOrdinal: number) => EditorSearchSelectionResult
}

/** 判断代码内容是否是可高置信识别的 JSON */
function looksLikeJsonCode(source: string) {
  if (!/^[{\[]/.test(source)) return false

  try {
    JSON.parse(source)
    return true
  } catch {
    return false
  }
}

/** 根据代码内容做保守语言检测，避免低置信度时频繁切换 */
function detectCodeBlockLanguage(code: string) {
  const source = code.trim()
  if (!source) return DEFAULT_CODE_BLOCK_LANGUAGE

  if (looksLikeJsonCode(source)) return 'json'
  if (/^(<!doctype html|<html[\s>]|<[a-z][\w-]*(\s[^>]*)?>[\s\S]*<\/[a-z][\w-]*>)$/i.test(source)) {
    return 'html'
  }
  if (/(^|\n)\s*([.#]?[\w-]+|:root|\*)\s*\{[\s\S]*?:[\s\S]*?;[\s\S]*?\}/.test(source)) return 'css'
  if (/^(#!\/usr\/bin\/env\s+(ba)?sh|#!\/bin\/(ba)?sh)/.test(source)) return 'bash'
  if (/^\s*(npx|npm|pnpm|yarn|git|cd|mkdir|rm|cp|mv|curl|ssh|docker|cargo|node|deno|bun|brew)\b/m.test(source)) {
    return 'bash'
  }
  if (/\binterface\s+\w+|type\s+\w+\s*=|:\s*(string|number|boolean|unknown|Record<)/.test(source)) return 'ts'
  if (/\b(import\s+.+\s+from|export\s+|const\s+|let\s+|function\s+|\)\s*=>|console\.)/.test(source)) return 'js'
  if (/\bdef\s+\w+\(|\bclass\s+\w+[:(]|\bfrom\s+\S+\s+import\s+|\bif\s+__name__\s*==/.test(source)) return 'py'
  if (/^(#{1,6}\s+|- \[[ x]\]\s+|[-*]\s+|\d+\.\s+|>\s+|```)/m.test(source)) return 'md'

  return DEFAULT_CODE_BLOCK_LANGUAGE
}

/** 判断当前语言是否允许由内容检测接管 */
function canAutoManageCodeLanguage(language: string) {
  return AUTO_MANAGED_CODE_LANGUAGES.has(language.toLowerCase())
}

/** 拼接工具栏悬浮提示与快捷键，保持没有快捷键的按钮只展示原文案 */
function formatToolbarTooltip(label: string, shortcut: string | undefined) {
  if (!shortcut) return label
  return `${label} · ${shortcut}`
}

/** 按当前平台获取指定工具栏文案对应的快捷键 */
function getToolbarShortcutLabel(key: string) {
  return getPlatformShortcut(TOOLBAR_SHORTCUTS[key])
}

/** Mira 代码块编辑器：保留 CodeMirror 本体，外层只做自动语言和悬浮复制 */
function MiraCodeMirrorEditor(props: CodeBlockEditorProps) {
  const { code, language } = props
  const { setLanguage } = useCodeBlockEditorContext()
  const [isCopied, setIsCopied] = useState(false)

  useEffect(() => {
    if (!canAutoManageCodeLanguage(language)) return

    const timerId = window.setTimeout(() => {
      const nextLanguage = detectCodeBlockLanguage(code)
      if (nextLanguage !== language) setLanguage(nextLanguage)
    }, CODE_BLOCK_LANGUAGE_DETECT_DELAY_MS)

    return () => window.clearTimeout(timerId)
  }, [code, language, setLanguage])

  useEffect(() => {
    if (!isCopied) return

    const timerId = window.setTimeout(() => setIsCopied(false), CODE_BLOCK_COPY_RESET_MS)
    return () => window.clearTimeout(timerId)
  }, [isCopied])

  /** 复制代码块内容，按钮不抢走 CodeMirror 的焦点 */
  async function handleCopyClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
    } catch {
      setIsCopied(false)
    }
  }

  return (
    <div className="mira-code-mirror-block">
      <button
        type="button"
        className="mira-code-copy-button"
        aria-label={isCopied ? '已复制代码' : '复制代码'}
        title={isCopied ? '已复制' : '复制'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleCopyClick}
      >
        {isCopied ? <Check size={17} strokeWidth={2} /> : <Copy size={17} strokeWidth={2} />}
      </button>
      <CodeMirrorEditor {...props} />
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
    return formatToolbarTooltip('撤销', shortcut)
  }
  if (key === 'toolbar.redo') {
    const shortcut = String(interpolations?.shortcut ?? '')
    return formatToolbarTooltip('重做', shortcut)
  }
  if (key === 'toolbar.blockTypes.heading') {
    const level = String(interpolations?.level ?? '')
    return `标题 ${level}`.trim()
  }
  const label = TOOLBAR_TRANSLATIONS[key] ?? defaultValue
  return formatToolbarTooltip(label, getToolbarShortcutLabel(key))
}

/** 创建 MDXEditor 插件集合，只保留 Mira 当前要评估的 Markdown 能力 */
export function createEditorPlugins({
  isAiSidebarOpen,
  isEditorSearchOpen,
  vaultPath,
  notePath,
  onToggleAiSidebar,
  onEditorSearchOpen,
  onEditorSearchClose,
  searchControlsRef,
  onSelectEditorSearchMatch,
}: CreateEditorPluginsOptions): RealmPlugin[] {
  const imageAttachmentContext = vaultPath && notePath ? { vaultPath, notePath } : null

  return [
    singleTildeStrikethroughPlugin(),
    headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
    listsPlugin(),
    mdxListStartPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    mdxMathPlugin(),
    linkPlugin({ disableAutoLink: true }),
    linkDialogPlugin({ LinkDialog: MiraLinkDialog, showLinkTitleField: true }),
    imagePlugin({
      imageAutocompleteSuggestions: IMAGE_AUTOCOMPLETE_SUGGESTIONS,
      imageUploadHandler: imageAttachmentContext
        ? (image) => saveImageAttachment(image, imageAttachmentContext)
        : undefined,
      imagePreviewHandler: imageAttachmentContext
        ? (src) => resolveImagePreviewSource(src, imageAttachmentContext)
        : undefined,
      disableImageResize: true,
      disableImageSettingsButton: false,
      allowSetImageDimensions: false,
    }),
    tablePlugin(),
    codeBlockPlugin({
      defaultCodeBlockLanguage: DEFAULT_CODE_BLOCK_LANGUAGE,
      codeBlockEditorDescriptors: [
        {
          priority: 2,
          match: () => true,
          Editor: MiraCodeMirrorEditor,
        },
      ],
    }),
    codeMirrorPlugin(),
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
