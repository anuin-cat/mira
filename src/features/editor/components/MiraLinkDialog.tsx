import {
  cancelLinkEdit$,
  linkDialogState$,
  onWindowChange$,
  removeLink$,
  switchFromPreviewToLinkEdit$,
  updateLink$,
  useCellValue,
  usePublisher,
  type EditLinkDialog,
  type PreviewLinkDialog,
  type RectData,
} from '@mdxeditor/editor'
import { Check, Copy, ExternalLink, Link2Off, Pencil } from 'lucide-react'
import { type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { isImeComposing } from '../../../lib/keyboard'

const LINK_DIALOG_WIDTH = 340
const LINK_DIALOG_MARGIN = 12
const LINK_DIALOG_ESTIMATED_HEIGHT = 158

interface LinkFormState {
  url: string
  title: string
  text: string
}

/** 根据选区位置计算 macOS 风格小浮层的屏幕坐标 */
function getLinkDialogStyle(rectangle: RectData): CSSProperties {
  const preferredLeft = rectangle.left + rectangle.width / 2 - LINK_DIALOG_WIDTH / 2
  const maxLeft = Math.max(LINK_DIALOG_MARGIN, window.innerWidth - LINK_DIALOG_WIDTH - LINK_DIALOG_MARGIN)
  const topBelowSelection = rectangle.top + rectangle.height + 8
  const maxTop = Math.max(LINK_DIALOG_MARGIN, window.innerHeight - LINK_DIALOG_ESTIMATED_HEIGHT - LINK_DIALOG_MARGIN)

  return {
    left: Math.min(Math.max(LINK_DIALOG_MARGIN, preferredLeft), maxLeft),
    top: Math.min(Math.max(LINK_DIALOG_MARGIN, topBelowSelection), maxTop),
    width: LINK_DIALOG_WIDTH,
  }
}

/** 让 MDXEditor 在窗口变化时重新计算链接浮层锚点 */
function usePublishWindowChange() {
  const publishWindowChange = usePublisher(onWindowChange$)

  useEffect(() => {
    const handleWindowChange = () => publishWindowChange(true)

    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)
    return () => {
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
    }
  }, [publishWindowChange])
}

/** Mira 自定义链接编辑浮层，替换 MDXEditor 默认的大表单 */
export function MiraLinkDialog() {
  const linkDialogState = useCellValue(linkDialogState$)
  const updateLink = usePublisher(updateLink$)
  const cancelLinkEdit = usePublisher(cancelLinkEdit$)
  const switchToLinkEdit = usePublisher(switchFromPreviewToLinkEdit$)
  const removeLink = usePublisher(removeLink$)
  const [copiedUrl, setCopiedUrl] = useState('')
  const [formState, setFormState] = useState<LinkFormState>({ url: '', title: '', text: '' })
  usePublishWindowChange()

  useEffect(() => {
    if (linkDialogState.type !== 'edit') return

    setFormState({
      url: linkDialogState.url,
      title: linkDialogState.title,
      text: linkDialogState.text,
    })
  }, [linkDialogState])

  useEffect(() => {
    if (!copiedUrl) return

    const timerId = window.setTimeout(() => setCopiedUrl(''), 1100)
    return () => window.clearTimeout(timerId)
  }, [copiedUrl])

  if (linkDialogState.type === 'inactive') return <></>

  const style = getLinkDialogStyle(linkDialogState.rectangle)

  if (linkDialogState.type === 'preview') {
    return (
      <LinkPreviewPopover
        state={linkDialogState}
        style={style}
        copiedUrl={copiedUrl}
        onCopyUrl={(url) => {
          void window.navigator.clipboard.writeText(url).then(() => setCopiedUrl(url))
        }}
        onEdit={() => switchToLinkEdit(undefined)}
        onRemove={() => removeLink(undefined)}
      />
    )
  }

  return (
    <LinkEditPopover
      state={linkDialogState}
      style={style}
      formState={formState}
      onFormStateChange={setFormState}
      onCancel={() => cancelLinkEdit(undefined)}
      onSubmit={() => updateLink(formState)}
    />
  )
}

function LinkEditPopover({
  state,
  style,
  formState,
  onFormStateChange,
  onCancel,
  onSubmit,
}: {
  state: EditLinkDialog
  style: CSSProperties
  formState: LinkFormState
  onFormStateChange: (value: LinkFormState) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const shouldShowTextField = state.withAnchorText

  /** 提交链接表单，输入法组合期间的 Enter 不会触发到这里 */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    onSubmit()
  }

  /** 处理 Escape 与输入法组合态，避免拼音确认时误提交 */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }

    if (event.key === 'Enter' && isImeComposing(event)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <form
      className="mira-link-dialog-popover mira-link-dialog-edit"
      style={style}
      onSubmit={handleSubmit}
      onReset={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
      onKeyDown={handleKeyDown}
    >
      <LinkField label="地址" htmlFor="mira-link-url">
        <Input
          id="mira-link-url"
          autoFocus
          className="mira-link-dialog-input"
          value={formState.url}
          placeholder="https://..."
          onChange={(event) => onFormStateChange({ ...formState, url: event.target.value })}
        />
      </LinkField>
      {shouldShowTextField ? (
        <LinkField label="文本" htmlFor="mira-link-text">
          <Input
            id="mira-link-text"
            className="mira-link-dialog-input"
            value={formState.text}
            placeholder="显示文本"
            onChange={(event) => onFormStateChange({ ...formState, text: event.target.value })}
          />
        </LinkField>
      ) : null}
      <LinkField label="标题" htmlFor="mira-link-title">
        <Input
          id="mira-link-title"
          className="mira-link-dialog-input"
          value={formState.title}
          placeholder="可选"
          onChange={(event) => onFormStateChange({ ...formState, title: event.target.value })}
        />
      </LinkField>
      <div className="mira-link-dialog-actions">
        <Button type="reset" variant="outline" size="sm" className="mira-link-dialog-button">
          取消
        </Button>
        <Button type="submit" size="sm" className="mira-link-dialog-button mira-link-dialog-primary">
          保存
        </Button>
      </div>
    </form>
  )
}

function LinkField({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="mira-link-dialog-field">
      <Label className="mira-link-dialog-label" htmlFor={htmlFor}>
        {label}
      </Label>
      {children}
    </div>
  )
}

function LinkPreviewPopover({
  state,
  style,
  copiedUrl,
  onCopyUrl,
  onEdit,
  onRemove,
}: {
  state: PreviewLinkDialog
  style: CSSProperties
  copiedUrl: string
  onCopyUrl: (url: string) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const isExternalUrl = useMemo(() => /^https?:\/\//i.test(state.url), [state.url])

  return (
    <div className="mira-link-dialog-popover mira-link-dialog-preview" style={style}>
      <a
        className="mira-link-dialog-preview-url"
        href={state.url}
        title={state.url}
        {...(isExternalUrl ? { target: '_blank', rel: 'noreferrer' } : {})}
      >
        <span>{state.url}</span>
        {isExternalUrl ? <ExternalLink aria-hidden="true" /> : null}
      </a>
      <div className="mira-link-dialog-preview-actions">
        <IconButton label="编辑链接" onClick={onEdit}>
          <Pencil />
        </IconButton>
        <IconButton label={copiedUrl === state.url ? '已复制' : '复制链接'} onClick={() => onCopyUrl(state.url)}>
          {copiedUrl === state.url ? <Check /> : <Copy />}
        </IconButton>
        <IconButton label="移除链接" onClick={onRemove}>
          <Link2Off />
        </IconButton>
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="mira-link-dialog-icon-button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </Button>
  )
}
