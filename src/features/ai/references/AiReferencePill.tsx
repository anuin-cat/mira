import type { CSSProperties } from 'react'
import { FileText } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  formatAiReferenceLabel,
  formatAiReferenceLineRange,
  type AiReferencePreview,
} from './aiReferenceText'

interface AiReferencePillProps {
  reference: AiReferencePreview
}

interface AiReferenceFloatingTooltipProps {
  reference: AiReferencePreview
  anchorRect: DOMRect
}

const FLOATING_TOOLTIP_WIDTH = 360
const FLOATING_TOOLTIP_GAP = 8
const FLOATING_TOOLTIP_MARGIN = 12

/** 引用浮层里的统一内容结构 */
function AiReferenceTooltipBody({ reference }: { reference: AiReferencePreview }) {
  const lineRange = formatAiReferenceLineRange(reference)
  const content = reference.content.trim() || '(空白)'

  return (
    <>
      <div className="ai-reference-tooltip-header">
        <span className="ai-reference-tooltip-icon" aria-hidden="true">
          <FileText className="size-[13px]" />
        </span>
        <div className="ai-reference-tooltip-title">
          <strong>{reference.title}</strong>
          <span>{lineRange}</span>
        </div>
      </div>
      <div className="ai-reference-tooltip-path">路径：{reference.path || '(未知路径)'}</div>
      <pre className="ai-reference-tooltip-content">{content}</pre>
    </>
  )
}

/** 计算输入框 DOM 胶囊使用的 fixed 浮层位置，避免被 contentEditable 裁剪 */
function getFloatingTooltipStyle(anchorRect: DOMRect): CSSProperties {
  const maxLeft = Math.max(
    FLOATING_TOOLTIP_MARGIN,
    window.innerWidth - FLOATING_TOOLTIP_WIDTH - FLOATING_TOOLTIP_MARGIN
  )
  const left = Math.min(maxLeft, Math.max(FLOATING_TOOLTIP_MARGIN, anchorRect.left))
  const shouldPlaceBelow = anchorRect.top < 170

  return {
    left,
    top: shouldPlaceBelow
      ? anchorRect.bottom + FLOATING_TOOLTIP_GAP
      : anchorRect.top - FLOATING_TOOLTIP_GAP,
    transform: shouldPlaceBelow ? undefined : 'translateY(-100%)',
  }
}

/** React 消息中的引用胶囊；hover/focus 时展示完整引用内容 */
export function AiReferencePill({ reference }: AiReferencePillProps) {
  const lineRange = formatAiReferenceLineRange(reference)
  const indexLabel = reference.index === undefined ? null : `#${reference.index}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="ai-reference-pill ai-reference-pill--inline"
          tabIndex={0}
          aria-label={`引用 ${formatAiReferenceLabel(reference)}`}
        >
          {indexLabel ? <span className="ai-reference-index">{indexLabel}</span> : null}
          <span className="ai-reference-title">{reference.title}</span>
          <span className="ai-reference-lines">{lineRange}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" sideOffset={8} className="ai-reference-tooltip">
        <AiReferenceTooltipBody reference={reference} />
      </TooltipContent>
    </Tooltip>
  )
}

/** 输入框 DOM 胶囊对应的悬浮预览 */
export function AiReferenceFloatingTooltip({ reference, anchorRect }: AiReferenceFloatingTooltipProps) {
  return (
    <div className="ai-reference-tooltip ai-reference-tooltip--floating" style={getFloatingTooltipStyle(anchorRect)}>
      <AiReferenceTooltipBody reference={reference} />
    </div>
  )
}
