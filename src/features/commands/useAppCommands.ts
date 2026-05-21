import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { FontSize, Theme } from '../../domain/note'
import type { AiSidebarHandle } from '../ai/sidebar'
import type { MdxEditorHandle } from '../editor/MdxEditor'
import type { FileTreeHandle } from '../file-tree/FileTree'
import { COMMAND_MENU_EVENTS, getCommandIdByMenuEvent, type CommandId } from './commandRegistry'
import { isMacOSPlatform } from '../../lib/platform'

const FONT_SIZE_ORDER: FontSize[] = ['small', 'medium', 'large', 'xlarge']
const CURRENT_NOTE_PROMPT = '请总结当前笔记，并提出 3 个值得继续追问的问题。'
const TEXT_INPUT_SELECTOR = 'input, textarea, select, [contenteditable="true"]'
const PLAIN_TEXT_INPUT_TYPES = new Set([
  'email',
  'password',
  'search',
  'tel',
  'text',
  'url',
])

export type ActiveCommandDialog = 'command-palette' | 'quick-open' | 'vault-search' | 'trash' | null

interface AppCommandContext {
  vaultPathRef: RefObject<string | null>
  activePathRef: RefObject<string | null>
  fileTreeRef: RefObject<FileTreeHandle | null>
  editorHandleRef: RefObject<MdxEditorHandle | null>
  aiSidebarRef: RefObject<AiSidebarHandle | null>
  setActiveCommandDialog: (dialog: ActiveCommandDialog) => void
  isAiSidebarOpen: () => boolean
  openAiSidebar: () => void
  addSelectedTextToAiComposer: () => boolean
  handleToggleAiSidebar: () => void
  handleChangeVault: () => Promise<void>
  handleRefreshVault: () => Promise<void>
  handleNavigateHistory: (offset: -1 | 1) => Promise<void>
  handleRevealInFinder: () => Promise<void>
  handleToggleFileSidebar: () => void
  handleFontSizeChange: (size: FontSize) => void
  handleThemeChange: (theme: Theme) => void
  flushActiveSave: () => Promise<void>
}

/** 判断快捷键事件是否使用当前平台的主修饰键 */
function hasPrimaryModifier(event: KeyboardEvent) {
  return isMacOSPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/** 判断当前事件修饰键是否只包含指定组合 */
function matchesModifiers(event: KeyboardEvent, options: { shift?: boolean; alt?: boolean; primary?: boolean }) {
  const wantsPrimary = options.primary ?? false
  const wantsShift = options.shift ?? false
  const wantsAlt = options.alt ?? false

  return (
    event.shiftKey === wantsShift &&
    event.altKey === wantsAlt &&
    hasPrimaryModifier(event) === wantsPrimary
  )
}

/** 判断事件目标是否处在文本输入区域内 */
function isTextInputTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(TEXT_INPUT_SELECTOR))
}

/** Windows/Linux 无原生菜单栏时，用前端快捷键补齐应用命令 */
function getCommandIdByKeyboardEvent(event: KeyboardEvent): CommandId | null {
  const key = event.key.toLowerCase()

  if (key === 'f3' && matchesModifiers(event, { shift: event.shiftKey })) {
    return event.shiftKey ? 'find-previous-in-file' : 'find-next-in-file'
  }
  if (!hasPrimaryModifier(event)) return null

  if (key === 'o' && matchesModifiers(event, { primary: true })) return 'change-vault'
  if (key === 'n' && matchesModifiers(event, { primary: true })) return 'new-file'
  if (key === 'n' && matchesModifiers(event, { primary: true, shift: true })) return 'new-folder'
  if (key === 'n' && matchesModifiers(event, { primary: true, alt: true })) return 'ai-new-chat'
  if (key === 's' && matchesModifiers(event, { primary: true })) return 'save-file'
  if (key === 'r' && matchesModifiers(event, { primary: true })) return 'refresh-vault'
  if (key === 'r' && matchesModifiers(event, { primary: true, alt: true })) return 'reveal-in-finder'
  if (key === 'backspace' && matchesModifiers(event, { primary: true })) return 'delete-entry'
  if (key === 'v' && matchesModifiers(event, { primary: true, shift: true })) return 'paste-and-match-style'
  if (key === 'f' && matchesModifiers(event, { primary: true })) return 'find-in-file'
  if (key === 'f' && matchesModifiers(event, { primary: true, shift: true })) return 'search-vault'
  if (key === 'g' && matchesModifiers(event, { primary: true })) return 'find-next-in-file'
  if (key === 'g' && matchesModifiers(event, { primary: true, shift: true })) return 'find-previous-in-file'
  if (key === 'p' && matchesModifiers(event, { primary: true })) return 'quick-open'
  if (key === 'p' && matchesModifiers(event, { primary: true, shift: true })) return 'command-palette'
  if (key === '[' && matchesModifiers(event, { primary: true })) return 'history-back'
  if (key === ']' && matchesModifiers(event, { primary: true })) return 'history-forward'
  if (key === '\\' && matchesModifiers(event, { primary: true })) return 'toggle-file-sidebar'
  if (key === 'l' && matchesModifiers(event, { primary: true })) return 'toggle-ai-sidebar'
  if (key === '-' && matchesModifiers(event, { primary: true })) return 'font-decrease'
  if (key === '=' && matchesModifiers(event, { primary: true })) return 'font-increase'
  if (key === '+' && matchesModifiers(event, { primary: true, shift: true })) return 'font-increase'
  if (key === '0' && matchesModifiers(event, { primary: true })) return 'font-reset'
  if (key === ',' && matchesModifiers(event, { primary: true })) return 'app-settings'
  if (key === 'enter' && matchesModifiers(event, { primary: true, alt: true })) return 'ai-ask-current-note'

  return null
}

/** 判断某些命令是否应避开正在编辑文本的目标 */
function canRunKeyboardCommand(commandId: CommandId, target: EventTarget | null) {
  if (commandId === 'delete-entry' || commandId === 'rename-entry') {
    return !isTextInputTarget(target)
  }
  return true
}

/** 菜单：按顺序调整字体大小 */
function handleFontSizeStep(context: AppCommandContext, step: -1 | 1) {
  const currentSize = document.documentElement.dataset.fontSize as FontSize | undefined
  const currentIndex = FONT_SIZE_ORDER.indexOf(currentSize ?? 'medium')
  const nextIndex = Math.min(Math.max(currentIndex + step, 0), FONT_SIZE_ORDER.length - 1)
  context.handleFontSizeChange(FONT_SIZE_ORDER[nextIndex])
}

/** 向当前聚焦的输入控件插入纯文本，供粘贴并匹配样式复用 */
function insertPlainTextIntoFocusedTarget(text: string) {
  const activeElement = document.activeElement

  if (activeElement instanceof HTMLTextAreaElement) {
    const selectionStart = activeElement.selectionStart ?? activeElement.value.length
    const selectionEnd = activeElement.selectionEnd ?? selectionStart
    activeElement.setRangeText(text, selectionStart, selectionEnd, 'end')
    activeElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    return true
  }

  if (activeElement instanceof HTMLInputElement && PLAIN_TEXT_INPUT_TYPES.has(activeElement.type)) {
    const selectionStart = activeElement.selectionStart ?? activeElement.value.length
    const selectionEnd = activeElement.selectionEnd ?? selectionStart
    activeElement.setRangeText(text, selectionStart, selectionEnd, 'end')
    activeElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    return true
  }

  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
    return document.execCommand('insertText', false, text)
  }

  return false
}

/** 粘贴纯文本，避免把外部富文本样式或 Markdown 结构带入当前输入区 */
async function handlePasteAndMatchStyle(context: AppCommandContext) {
  try {
    const clipboardText = await navigator.clipboard?.readText?.()
    if (!clipboardText) return

    if (insertPlainTextIntoFocusedTarget(clipboardText)) return

    context.editorHandleRef.current?.focusEditor()
    document.execCommand('insertText', false, clipboardText)
  } catch {
    document.execCommand('paste')
  }
}

/** 执行集中注册的应用命令 */
async function executeAppCommand(commandId: CommandId, context: AppCommandContext) {
  switch (commandId) {
    case 'change-vault':
      await context.handleChangeVault()
      break
    case 'new-file':
      if (context.aiSidebarRef.current?.isComposerFocused()) {
        context.openAiSidebar()
        context.aiSidebarRef.current.createSession()
      } else {
        context.fileTreeRef.current?.createFile()
      }
      break
    case 'new-folder':
      context.fileTreeRef.current?.createFolder()
      break
    case 'save-file':
      await context.flushActiveSave()
      break
    case 'refresh-vault':
      await context.handleRefreshVault()
      break
    case 'open-trash':
      context.setActiveCommandDialog(context.vaultPathRef.current ? 'trash' : null)
      break
    case 'rename-entry':
      context.fileTreeRef.current?.renameActive()
      break
    case 'delete-entry':
      context.fileTreeRef.current?.deleteActive()
      break
    case 'reveal-in-finder':
      await context.handleRevealInFinder()
      break
    case 'paste-and-match-style':
      await handlePasteAndMatchStyle(context)
      break
    case 'find-in-file':
      context.editorHandleRef.current?.toggleSearch()
      break
    case 'find-next-in-file':
      context.editorHandleRef.current?.findNext()
      break
    case 'find-previous-in-file':
      context.editorHandleRef.current?.findPrevious()
      break
    case 'search-vault':
      await context.flushActiveSave()
      context.setActiveCommandDialog(context.vaultPathRef.current ? 'vault-search' : null)
      break
    case 'quick-open':
      context.setActiveCommandDialog(context.vaultPathRef.current ? 'quick-open' : null)
      break
    case 'command-palette':
      context.setActiveCommandDialog('command-palette')
      break
    case 'history-back':
      await context.handleNavigateHistory(-1)
      break
    case 'history-forward':
      await context.handleNavigateHistory(1)
      break
    case 'toggle-file-sidebar':
      context.handleToggleFileSidebar()
      break
    case 'toggle-ai-sidebar':
      if (context.addSelectedTextToAiComposer()) break
      if (context.isAiSidebarOpen() && context.aiSidebarRef.current?.isComposerFocused()) {
        context.handleToggleAiSidebar()
        break
      }
      context.openAiSidebar()
      window.requestAnimationFrame(() => context.aiSidebarRef.current?.focusComposer())
      break
    case 'font-decrease':
      handleFontSizeStep(context, -1)
      break
    case 'font-increase':
      handleFontSizeStep(context, 1)
      break
    case 'font-reset':
      context.handleFontSizeChange('medium')
      break
    case 'font-small':
      context.handleFontSizeChange('small')
      break
    case 'font-medium':
      context.handleFontSizeChange('medium')
      break
    case 'font-large':
      context.handleFontSizeChange('large')
      break
    case 'font-xlarge':
      context.handleFontSizeChange('xlarge')
      break
    case 'theme-default':
      context.handleThemeChange('default')
      break
    case 'theme-warm-paper':
      context.handleThemeChange('warm-paper')
      break
    case 'theme-twilight':
      context.handleThemeChange('twilight')
      break
    case 'theme-forest':
      context.handleThemeChange('forest')
      break
    case 'theme-dark-classic':
      context.handleThemeChange('dark-classic')
      break
    case 'ai-new-chat':
      context.openAiSidebar()
      window.requestAnimationFrame(() => context.aiSidebarRef.current?.createSession())
      break
    case 'ai-ask-current-note':
      if (!context.activePathRef.current) return
      context.openAiSidebar()
      window.requestAnimationFrame(() => context.aiSidebarRef.current?.fillCurrentNotePrompt(CURRENT_NOTE_PROMPT))
      break
    case 'ai-stop-generating':
      context.aiSidebarRef.current?.stopGenerating()
      break
    case 'app-settings':
      context.openAiSidebar()
      window.requestAnimationFrame(() => context.aiSidebarRef.current?.openSettings())
      break
  }
}

/** 注册原生菜单事件并返回统一命令执行函数 */
export function useAppCommands(context: AppCommandContext) {
  const contextRef = useRef(context)
  contextRef.current = context

  const runCommand = useCallback((commandId: CommandId) => {
    void executeAppCommand(commandId, contextRef.current)
  }, [])

  useEffect(() => {
    const unlisteners: Array<() => void | Promise<void>> = []
    let isDisposed = false

    COMMAND_MENU_EVENTS.forEach((menuEvent) => {
      void listen(menuEvent, () => {
        const commandId = getCommandIdByMenuEvent(menuEvent)
        if (commandId) runCommand(commandId)
      })
        .then((unlisten) => {
          if (isDisposed) {
            void Promise.resolve(unlisten()).catch((error) => {
              console.warn('菜单事件监听清理失败', error)
            })
          } else {
            unlisteners.push(unlisten)
          }
        })
        .catch((error) => {
          console.warn('菜单事件监听注册失败', error)
        })
    })

    return () => {
      isDisposed = true
      unlisteners.splice(0).forEach((unlisten) => {
        void Promise.resolve(unlisten()).catch((error) => {
          console.warn('菜单事件监听清理失败', error)
        })
      })
    }
  }, [runCommand])

  useEffect(() => {
    if (isMacOSPlatform()) return

    /** Windows/Linux 没有原生菜单栏后，由前端统一接管应用级快捷键 */
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return

      const commandId = getCommandIdByKeyboardEvent(event)
      if (!commandId || !canRunKeyboardCommand(commandId, event.target)) return

      event.preventDefault()
      runCommand(commandId)
    }

    window.addEventListener('keydown', handleWindowKeyDown, true)
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true)
  }, [runCommand])

  return runCommand
}
