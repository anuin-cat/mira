import type { RefObject } from 'react'
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  type PanelImperativeHandle,
} from 'react-resizable-panels'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FileTree } from '../file-tree/FileTree'
import { MdxEditor } from '../editor/MdxEditor'
import { AiSidebar } from '../ai/sidebar/AiSidebar'
import {
  COMMAND_DEFINITIONS,
  CommandPalette,
  QuickOpenDialog,
  VaultSearchDialog,
} from '../commands'
import { getDisplayName } from '../../services/pathUtils'
import type { VaultWorkspace } from './useVaultWorkspace'

export const SIDEBAR_MIN_WIDTH = 160
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 280
export const AI_SIDEBAR_MIN_WIDTH = 290
export const AI_SIDEBAR_MAX_WIDTH = 560
export const AI_SIDEBAR_DEFAULT_WIDTH = 380

export interface AppPanels {
  isMacOS: boolean
  sidebarWidth: number
  isFileSidebarOpen: boolean
  isAiSidebarOpen: boolean
  fileSidebarPanelRef: RefObject<PanelImperativeHandle | null>
  aiSidebarPanelRef: RefObject<PanelImperativeHandle | null>
  handleLayoutChanged: () => void
  handleToggleAiSidebar: () => void
}

interface AppLayoutProps {
  panels: AppPanels
  workspace: VaultWorkspace
}

/** 应用主布局：文件树、编辑器、AI 侧栏和命令弹层 */
export function AppLayout({ panels, workspace }: AppLayoutProps) {
  const editorWorkspace = workspace.activePath ? (
    <section className="editor-workspace">
      <MdxEditor
        key={`${workspace.activePath}:${workspace.editorInstanceVersion}`}
        ref={workspace.editorHandleRef}
        initialContent={workspace.activeContent}
        isAiSidebarOpen={panels.isAiSidebarOpen}
        notePath={workspace.activePath}
        noteTitle={workspace.activePath ? getDisplayName(workspace.activePath, 'file') : null}
        onChange={workspace.handleContentChange}
        onToggleAiSidebar={panels.handleToggleAiSidebar}
        onAddSelectionToAi={workspace.addTextReferenceToAiComposer}
      />
    </section>
  ) : null

  return (
    <TooltipProvider delayDuration={100}>
      <>
        <PanelGroup
          orientation="horizontal"
          className="app-layout"
          id="app-layout"
          onLayoutChanged={panels.handleLayoutChanged}
          data-font-size={workspace.vaultState.fontSize || 'medium'}
          data-theme={workspace.vaultState.theme || 'default'}
          data-platform={panels.isMacOS ? 'macos' : 'default'}
        >
          <Panel
            id="file-sidebar-panel"
            className="app-sidebar-panel"
            defaultSize={panels.sidebarWidth}
            minSize={SIDEBAR_MIN_WIDTH}
            maxSize={SIDEBAR_MAX_WIDTH}
            collapsedSize={0}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            panelRef={panels.fileSidebarPanelRef}
          >
            <FileTree
              key={workspace.vaultPath}
              ref={workspace.fileTreeRef}
              treeData={workspace.treeData}
              activePath={workspace.activePath}
              expandedDirs={workspace.vaultState.expandedDirs}
              onOpenFile={workspace.handleOpenFile}
              onCreateFile={workspace.handleCreateFile}
              onCreateFolder={workspace.handleCreateFolder}
              onRenameEntry={workspace.handleRenameEntry}
              onMoveEntry={workspace.handleMoveEntry}
              onReorderEntry={workspace.handleReorderEntry}
              onDeleteEntry={workspace.handleDeleteEntry}
              onExpandedDirsChange={workspace.handleExpandedDirsChange}
            />
          </Panel>
          <PanelResizeHandle
            id="file-sidebar-separator"
            className={`panel-resizer${panels.isFileSidebarOpen ? '' : ' panel-resizer-hidden'}`}
            disabled={!panels.isFileSidebarOpen}
          />
          <Panel
            id="editor-workspace-panel"
            className={`editor-pane${panels.isAiSidebarOpen ? '' : ' is-ai-sidebar-collapsed'}`}
          >
            {workspace.activePath ? (
              editorWorkspace
            ) : (
              <div className="editor-empty">
                <p>右键左侧空白区域新建 Markdown 文件</p>
              </div>
            )}
          </Panel>
          <PanelResizeHandle
            id="ai-sidebar-separator"
            className={`panel-resizer${panels.isAiSidebarOpen ? '' : ' panel-resizer-hidden'}`}
            disabled={!panels.isAiSidebarOpen}
          />
          <Panel
            id="ai-sidebar-panel"
            className="ai-sidebar-panel-shell"
            defaultSize={0}
            minSize={AI_SIDEBAR_MIN_WIDTH}
            maxSize={AI_SIDEBAR_MAX_WIDTH}
            collapsedSize={0}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            panelRef={panels.aiSidebarPanelRef}
          >
            <AiSidebar
              key={workspace.vaultPath}
              ref={workspace.aiSidebarRef}
              vaultPath={workspace.vaultPath ?? ''}
              notePath={workspace.activePath}
              noteTitle={workspace.activePath ? getDisplayName(workspace.activePath, 'file') : null}
              noteContent={workspace.activeContent}
              onBeforeAgentRequest={workspace.flushActiveSave}
              getCurrentNoteSnapshot={workspace.getCurrentNoteSnapshot}
              onAgentFilesChanged={workspace.handleAgentFilesChanged}
            />
          </Panel>
        </PanelGroup>
        <CommandPalette
          isOpen={workspace.activeCommandDialog === 'command-palette'}
          commands={COMMAND_DEFINITIONS}
          onClose={() => workspace.setActiveCommandDialog(null)}
          onRunCommand={(commandId) => {
            workspace.runCommand(commandId)
          }}
        />
        <QuickOpenDialog
          isOpen={workspace.activeCommandDialog === 'quick-open'}
          treeData={workspace.treeData}
          activePath={workspace.activePath}
          onClose={() => workspace.setActiveCommandDialog(null)}
          onOpenFile={(filePath) => {
            void workspace.handleOpenFile(filePath)
          }}
        />
        <VaultSearchDialog
          isOpen={workspace.activeCommandDialog === 'vault-search'}
          vaultPath={workspace.vaultPath ?? ''}
          treeData={workspace.treeData}
          onClose={() => workspace.setActiveCommandDialog(null)}
          onOpenFile={(filePath, match) => {
            void workspace.handleOpenSearchResult(filePath, match)
          }}
        />
      </>
    </TooltipProvider>
  )
}
