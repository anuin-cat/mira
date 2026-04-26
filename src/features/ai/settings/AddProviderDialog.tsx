import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  onClose: () => void
  onSubmit: (label: string, baseURL: string) => void
}

/** 添加自定义供应商弹窗 */
export function AddProviderDialog({ onClose, onSubmit }: Props) {
  const formId = useId()
  const [label, setLabel] = useState('')
  const [baseURL, setBaseURL] = useState('https://api.example.com/v1')

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  /** 提交自定义 provider 表单 */
  function handleSubmit() {
    // 1. 先做最基本的非空校验
    const nextLabel = label.trim()
    const nextBaseURL = baseURL.trim()
    if (!nextLabel || !nextBaseURL) return

    // 2. 通过回调把数据交给父层统一落草稿
    onSubmit(nextLabel, nextBaseURL)
  }

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl animate-in fade-in-0 zoom-in-97 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold text-foreground">添加供应商</div>
            <div className="text-[11px] text-muted-foreground">新增 OpenAI 兼容接口</div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="space-y-1">
            <Label htmlFor={`${formId}-provider-name`} className="text-[12px] text-muted-foreground">
              供应商名称
            </Label>
            <Input
              id={`${formId}-provider-name`}
              autoFocus
              autoComplete="off"
              className="h-8 text-[13px]"
              placeholder="例如：我的 AI 服务"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${formId}-provider-baseurl`} className="text-[12px] text-muted-foreground">
              Base URL
            </Label>
            <Input
              id={`${formId}-provider-baseurl`}
              autoComplete="off"
              className="h-8 text-[13px]"
              placeholder="https://api.example.com/v1"
              value={baseURL}
              onChange={(event) => setBaseURL(event.target.value)}
            />
          </div>

          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-[11px] leading-[1.6] text-muted-foreground">
            Base URL 指向 OpenAI 兼容接口根路径（通常以 <code className="font-mono">/v1</code> 结尾），模型列表通过 <code className="font-mono">/models</code> 自动获取。
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-4 py-2.5">
          <Button type="button" variant="ghost" className="h-8 px-3 text-[13px]" onClick={onClose}>
            取消
          </Button>
          <Button type="button" className="h-8 px-3 text-[13px]" onClick={handleSubmit} disabled={!label.trim() || !baseURL.trim()}>
            添加供应商
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
