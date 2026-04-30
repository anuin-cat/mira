import { History, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AiChatSession } from '@/domain/ai'
import { getSidebarHeaderLabel } from './aiSidebarModel'

interface Props {
  currentSession: AiChatSession | null
  onToggleHistory: () => void
  onOpenSettings: () => void
}

/** 侧栏头部：展示当前会话标题，并承接历史与设置入口 */
export function AiSidebarHeader({ currentSession, onToggleHistory, onOpenSettings }: Props) {
  return (
    <header className="ai-sidebar-header">
      <div className="ai-sidebar-title">
        <span className="ai-sidebar-session-heading">{getSidebarHeaderLabel(currentSession)}</span>
      </div>
      <div className="ai-sidebar-actions">
        <Button type="button" variant="ghost" size="icon" onClick={onToggleHistory} aria-label="历史">
          <History className="size-[18px]" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={onOpenSettings} aria-label="设置">
          <Settings className="size-[18px]" aria-hidden />
        </Button>
      </div>
    </header>
  )
}
