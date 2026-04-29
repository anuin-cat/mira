import { useCallback, useState } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { VaultSetup } from './features/vault/VaultSetup'
import {
  AI_SIDEBAR_DEFAULT_WIDTH,
  AI_SIDEBAR_MAX_WIDTH,
  AI_SIDEBAR_MIN_WIDTH,
  AppLayout,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './features/app/AppLayout'
import { useVaultWorkspace } from './features/app/useVaultWorkspace'

/** 判断当前是否运行在 macOS，用于适配原生窗口按钮位置 */
function isMacOSPlatform() {
  return navigator.userAgent.toLowerCase().includes('mac')
}

/** 把面板宽度收敛为整数，避免拖拽结果在小数像素间抖动 */
function toPanelPixels(width: number) {
  return Math.round(width)
}

/** 把面板宽度限制在允许范围内，避免异常值污染记忆宽度 */
function clampPanelPixels(width: number, minWidth: number, maxWidth: number) {
  return Math.min(Math.max(toPanelPixels(width), minWidth), maxWidth)
}

/** 管理应用三栏布局的展开状态、记忆宽度和 Panel 引用 */
function useAppPanels() {
  const isMacOS = isMacOSPlatform()
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [isFileSidebarOpen, setIsFileSidebarOpen] = useState(true)
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false)
  const [aiSidebarWidth, setAiSidebarWidth] = useState(AI_SIDEBAR_DEFAULT_WIDTH)
  const fileSidebarPanelRef = usePanelRef()
  const aiSidebarPanelRef = usePanelRef()

  /** 同步三栏最终宽度，避免拖拽过程触发 React 重渲染 */
  const handleLayoutChanged = useCallback(() => {
    // 1. 读取左侧文件树最终像素宽度
    const filePanel = fileSidebarPanelRef.current
    const nextSidebarWidth = filePanel?.getSize().inPixels
    if (filePanel && nextSidebarWidth !== undefined) {
      const isFileOpen = !filePanel.isCollapsed()
      setIsFileSidebarOpen((currentValue) => (currentValue === isFileOpen ? currentValue : isFileOpen))
    }
    if (filePanel && !filePanel.isCollapsed() && nextSidebarWidth !== undefined && nextSidebarWidth > 0) {
      const nextPixels = clampPanelPixels(nextSidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
      setSidebarWidth((currentWidth) => (currentWidth === nextPixels ? currentWidth : nextPixels))
    }

    // 2. 读取 AI 面板最终像素宽度，并同步开关状态与记忆宽度
    const aiPanel = aiSidebarPanelRef.current
    const nextAiWidth = aiPanel?.getSize().inPixels
    if (!aiPanel || nextAiWidth === undefined) return

    const isAiOpen = !aiPanel.isCollapsed()
    setIsAiSidebarOpen((currentValue) => (currentValue === isAiOpen ? currentValue : isAiOpen))

    if (!isAiOpen) return
    const nextPixels = clampPanelPixels(nextAiWidth, AI_SIDEBAR_MIN_WIDTH, AI_SIDEBAR_MAX_WIDTH)
    setAiSidebarWidth((currentWidth) => (currentWidth === nextPixels ? currentWidth : nextPixels))
  }, [fileSidebarPanelRef, aiSidebarPanelRef])

  /** 显式切换 AI 面板展开状态，避免 effect 与布局回调互相触发 */
  const handleToggleAiSidebar = useCallback(() => {
    // 1. 读取当前 AI 面板实例，优先用真实尺寸做决策
    const aiPanel = aiSidebarPanelRef.current
    if (!aiPanel) {
      setIsAiSidebarOpen((currentValue) => !currentValue)
      return
    }

    const isCurrentlyOpen = !aiPanel.isCollapsed()
    if (isCurrentlyOpen) {
      // 2. 关闭前记住当前宽度，方便下次恢复
      const currentPixels = clampPanelPixels(
        aiPanel.getSize().inPixels,
        AI_SIDEBAR_MIN_WIDTH,
        AI_SIDEBAR_MAX_WIDTH
      )
      setAiSidebarWidth((currentWidth) => (currentWidth === currentPixels ? currentWidth : currentPixels))
      aiPanel.collapse()
      setIsAiSidebarOpen(false)
      return
    }

    // 3. 展开时直接恢复记忆宽度，避免再走额外同步 effect
    aiPanel.resize(clampPanelPixels(aiSidebarWidth, AI_SIDEBAR_MIN_WIDTH, AI_SIDEBAR_MAX_WIDTH))
    setIsAiSidebarOpen(true)
  }, [aiSidebarPanelRef, aiSidebarWidth])

  /** 显式切换文件侧栏展开状态 */
  const handleToggleFileSidebar = useCallback(() => {
    const filePanel = fileSidebarPanelRef.current
    if (!filePanel) {
      setIsFileSidebarOpen((currentValue) => !currentValue)
      return
    }

    const isCurrentlyOpen = !filePanel.isCollapsed()
    if (isCurrentlyOpen) {
      const currentPixels = clampPanelPixels(
        filePanel.getSize().inPixels,
        SIDEBAR_MIN_WIDTH,
        SIDEBAR_MAX_WIDTH
      )
      setSidebarWidth((currentWidth) => (currentWidth === currentPixels ? currentWidth : currentPixels))
      filePanel.collapse()
      setIsFileSidebarOpen(false)
      return
    }

    filePanel.resize(clampPanelPixels(sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH))
    setIsFileSidebarOpen(true)
  }, [fileSidebarPanelRef, sidebarWidth])

  /** 展开 AI 侧栏但不反向关闭，供命令入口复用 */
  const openAiSidebar = useCallback(() => {
    const aiPanel = aiSidebarPanelRef.current
    if (!aiPanel) {
      setIsAiSidebarOpen(true)
      return
    }

    if (aiPanel.isCollapsed()) {
      aiPanel.resize(clampPanelPixels(aiSidebarWidth, AI_SIDEBAR_MIN_WIDTH, AI_SIDEBAR_MAX_WIDTH))
    }
    setIsAiSidebarOpen(true)
  }, [aiSidebarPanelRef, aiSidebarWidth])

  return {
    isMacOS,
    sidebarWidth,
    isFileSidebarOpen,
    isAiSidebarOpen,
    fileSidebarPanelRef,
    aiSidebarPanelRef,
    handleLayoutChanged,
    handleToggleAiSidebar,
    handleToggleFileSidebar,
    openAiSidebar,
  }
}

export default function App() {
  const panels = useAppPanels()
  const workspace = useVaultWorkspace({
    isAiSidebarOpen: panels.isAiSidebarOpen,
    openAiSidebar: panels.openAiSidebar,
    handleToggleAiSidebar: panels.handleToggleAiSidebar,
    handleToggleFileSidebar: panels.handleToggleFileSidebar,
  })

  if (workspace.isLoading) {
    return <div className="loading">加载中...</div>
  }

  if (workspace.loadError) {
    return <div className="loading">加载失败：{workspace.loadError}</div>
  }

  if (!workspace.vaultPath) {
    return <VaultSetup onVaultReady={(path) => workspace.initVault(path)} />
  }

  return <AppLayout panels={panels} workspace={workspace} />
}
