import {
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
  type RealmPlugin,
} from '@mdxeditor/editor'
import { type Ref } from 'react'
import { EditorSearchControlsHandle } from './EditorSearchControls'
import type { EditorSearchSelectionResult } from './currentFileSearch'
import { MiraLinkDialog } from './MiraLinkDialog'
import { MiraToolbar } from './MiraToolbar'
import { miraMarkdownShortcutPlugin } from './miraMarkdownShortcutPlugin'
import { mdxListStartPlugin } from './mdxListStartPlugin'
import { singleTildeStrikethroughPlugin } from './singleTildeStrikethroughPlugin'

const IMAGE_AUTOCOMPLETE_SUGGESTIONS = ['./', '../', 'assets/', 'images/']
const CODE_BLOCK_LANGUAGES = {
  txt: 'Plain Text',
  js: 'JavaScript',
  jsx: 'JavaScript (React)',
  ts: 'TypeScript',
  tsx: 'TypeScript (React)',
  css: 'CSS',
  html: 'HTML',
  json: 'JSON',
  md: 'Markdown',
  sh: 'Shell',
  bash: 'Bash',
  py: 'Python',
  rust: 'Rust',
} satisfies Record<string, string>
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
  'codeBlock.selectLanguage': '选择代码块语言',
  'codeBlock.inlineLanguage': '语言',
  'codeBlock.language': '代码块语言',
  'codeblock.delete': '删除代码块',
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
    singleTildeStrikethroughPlugin(),
    headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
    listsPlugin(),
    mdxListStartPlugin(),
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
    codeBlockPlugin({ defaultCodeBlockLanguage: 'txt' }),
    codeMirrorPlugin({
      codeBlockLanguages: CODE_BLOCK_LANGUAGES,
      autoLoadLanguageSupport: true,
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
