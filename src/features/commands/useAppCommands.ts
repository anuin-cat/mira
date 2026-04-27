import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { FontSize, Theme } from '../../domain/note'
import type { AiSidebarHandle } from '../ai/AiSidebar'
import type { MdxEditorHandle } from '../editor/MdxEditor'
import type { FileTreeHandle } from '../file-tree/FileTree'
import { COMMAND_MENU_EVENTS, getCommandIdByMenuEvent, type CommandId } from './commandRegistry'

const FONT_SIZE_ORDER: FontSize[] = ['small', 'medium', 'large', 'xlarge']
const CURRENT_NOTE_PROMPT = '请总结当前笔记，并提出 3 个值得继续追问的问题。'
type GitCommandAction = 'init-github' | 'stage-all' | 'commit' | 'push'

export type ActiveCommandDialog = 'command-palette' | 'quick-open' | 'vault-search' | null

interface AppCommandContext {
  vaultPathRef: RefObject<string | null>
  activePathRef: RefObject<string | null>
  fileTreeRef: RefObject<FileTreeHandle | null>
  editorHandleRef: RefObject<MdxEditorHandle | null>
  aiSidebarRef: RefObject<AiSidebarHandle | null>
  setActiveCommandDialog: (dialog: ActiveCommandDialog) => void
  isAiSidebarOpen: () => boolean
  openAiSidebar: () => void
  handleToggleAiSidebar: () => void
  openGitPanel: (action?: GitCommandAction | null) => void
  handleChangeVault: () => Promise<void>
  handleRefreshVault: () => Promise<void>
  handleUpdateMiraMap: () => Promise<void>
  handleNavigateHistory: (offset: -1 | 1) => Promise<void>
  handleRevealInFinder: () => Promise<void>
  handleToggleFileSidebar: () => void
  handleFontSizeChange: (size: FontSize) => void
  handleThemeChange: (theme: Theme) => void
  flushActiveSave: () => Promise<void>
}

/** 菜单：按顺序调整字体大小 */
function handleFontSizeStep(context: AppCommandContext, step: -1 | 1) {
  const currentSize = document.documentElement.dataset.fontSize as FontSize | undefined
  const currentIndex = FONT_SIZE_ORDER.indexOf(currentSize ?? 'medium')
  const nextIndex = Math.min(Math.max(currentIndex + step, 0), FONT_SIZE_ORDER.length - 1)
  context.handleFontSizeChange(FONT_SIZE_ORDER[nextIndex])
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
    case 'rename-entry':
      context.fileTreeRef.current?.renameActive()
      break
    case 'delete-entry':
      context.fileTreeRef.current?.deleteActive()
      break
    case 'reveal-in-finder':
      await context.handleRevealInFinder()
      break
    case 'update-mira-map':
      await context.handleUpdateMiraMap()
      break
    case 'find-in-file':
      context.editorHandleRef.current?.toggleSearch()
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
    case 'git-panel':
      context.openGitPanel()
      break
    case 'git-init-github':
      context.openGitPanel('init-github')
      break
    case 'git-stage-all':
      context.openGitPanel('stage-all')
      break
    case 'git-commit':
      context.openGitPanel('commit')
      break
    case 'git-push':
      context.openGitPanel('push')
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

  return runCommand
}
