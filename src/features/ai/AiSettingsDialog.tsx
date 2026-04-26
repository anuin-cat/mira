import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, EyeOff, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { AiProviderSettings } from '../../domain/ai'
import {
  AI_PROVIDER_PRESETS,
  getAiProviderPreset,
  normalizeAiSettings,
  switchAiProviderPreset,
} from '../../services/aiSettingsService'

interface Props {
  initialSettings: AiProviderSettings
  onClose: () => void
  onSave: (settings: AiProviderSettings) => void
}

/** AI 设置弹层：编辑 provider、key、模型和提示词 */
export function AiSettingsDialog({ initialSettings, onClose, onSave }: Props) {
  const formId = useId()
  const [draftSettings, setDraftSettings] = useState<AiProviderSettings>(initialSettings)
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)

  useEffect(() => {
    setDraftSettings(initialSettings)
  }, [initialSettings])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function patchDraftSettings(patch: Partial<AiProviderSettings>) {
    const nextSettings = normalizeAiSettings({
      ...draftSettings,
      ...patch,
    })
    setDraftSettings(nextSettings)
  }

  function handleProviderChange(providerId: AiProviderSettings['providerId']) {
    setDraftSettings(switchAiProviderPreset(draftSettings, providerId))
  }

  function handleSubmit() {
    onSave(normalizeAiSettings(draftSettings))
  }

  return createPortal(
    <div
      role="presentation"
      className={cn(
        'fixed inset-0 z-[1100] flex items-center justify-center overflow-y-auto overscroll-contain p-4 sm:p-6',
        'bg-foreground/10 backdrop-blur-md dark:bg-background/60',
        'animate-in fade-in-0 duration-200'
      )}
      onClick={onClose}
    >
      <Card
        className={cn(
          'relative w-full max-w-xl gap-0 border-border/80 py-0 shadow-2xl ring-1 ring-foreground/10',
          'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-300'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <CardHeader className="relative gap-2 border-b border-border/50 bg-linear-to-br from-muted/40 via-card to-card px-5 pb-4 pt-5 sm:px-6">
          <CardTitle className="flex items-center gap-3 pr-10 text-xl font-semibold tracking-tight">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"
              aria-hidden
            >
              <Sparkles className="size-5" strokeWidth={1.75} />
            </span>
            AI 设置
          </CardTitle>
          <CardDescription className="text-pretty text-[13px] leading-relaxed">
            配置 OpenAI 兼容接口。密钥与偏好仅保存在本机，不会上传。
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-lg text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="关闭"
            >
              <X className="size-4" />
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-5 px-5 py-5 sm:px-6">
          <div className="space-y-2">
            <Label htmlFor={`${formId}-provider`} className="text-muted-foreground">
              提供商
            </Label>
            <Select
              value={draftSettings.providerId}
              onValueChange={(value) =>
                handleProviderChange(value as AiProviderSettings['providerId'])
              }
            >
              <SelectTrigger id={`${formId}-provider`} className="h-9 w-full">
                <SelectValue placeholder="选择提供商" />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[1200]">
                <SelectGroup>
                  {AI_PROVIDER_PRESETS.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor={`${formId}-model`} className="text-muted-foreground">
                模型
              </Label>
              <Input
                id={`${formId}-model`}
                autoComplete="off"
                placeholder="例如 deepseek-chat"
                value={draftSettings.model}
                onChange={(event) => patchDraftSettings({ model: event.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor={`${formId}-temperature`} className="text-muted-foreground">
                温度
              </Label>
              <Input
                id={`${formId}-temperature`}
                type="number"
                min={0}
                max={1.5}
                step={0.1}
                value={draftSettings.temperature}
                onChange={(event) =>
                  patchDraftSettings({ temperature: Number(event.target.value || 0) })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-base`} className="text-muted-foreground">
              Base URL
            </Label>
            <Input
              id={`${formId}-base`}
              autoComplete="off"
              placeholder="https://api.example.com/v1"
              value={draftSettings.baseURL}
              onChange={(event) => patchDraftSettings({ baseURL: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-key`} className="text-muted-foreground">
              API Key
            </Label>
            <div className="flex gap-2">
              <Input
                id={`${formId}-key`}
                className="min-w-0 flex-1 font-mono text-[13px] tracking-tight"
                type={isApiKeyVisible ? 'text' : 'password'}
                autoComplete="off"
                placeholder={getAiProviderPreset(draftSettings.providerId).apiKeyPlaceholder}
                value={draftSettings.apiKey}
                onChange={(event) => patchDraftSettings({ apiKey: event.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => setIsApiKeyVisible((v) => !v)}
                aria-label={isApiKeyVisible ? '隐藏密钥' : '显示密钥'}
              >
                {isApiKeyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-system`} className="text-muted-foreground">
              系统提示词
            </Label>
            <Textarea
              id={`${formId}-system`}
              className="min-h-[120px] resize-y text-[13px] leading-relaxed"
              placeholder="可选：定义助手的行为与回答风格…"
              rows={5}
              value={draftSettings.systemPrompt}
              onChange={(event) => patchDraftSettings({ systemPrompt: event.target.value })}
            />
          </div>
        </CardContent>

        <CardFooter className="flex justify-end gap-2 border-t border-border/50 bg-muted/25 px-5 py-4 sm:px-6">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={handleSubmit}>
            保存
          </Button>
        </CardFooter>
      </Card>
    </div>,
    document.body
  )
}
