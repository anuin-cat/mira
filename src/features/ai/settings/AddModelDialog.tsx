import { useDeferredValue, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, LoaderCircle, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { AiProviderConfig } from '../../../domain/ai'
import { fetchAiModelCatalog, sortAiModelCatalog } from '../../../services/aiModelCatalogService'

interface Props {
  provider: AiProviderConfig
  onClose: () => void
  onAddModel: (modelId: string) => void
}

/** 提取错误里的可展示信息 */
function getModelCatalogErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message
  return '获取模型列表失败，请稍后重试'
}

/** 添加模型弹窗：自动读取当前 provider 的 models 接口并支持模糊搜索 */
export function AddModelDialog({ provider, onClose, onAddModel }: Props) {
  const searchInputId = useId()
  const [keyword, setKeyword] = useState('')
  const [models, setModels] = useState<{ id: string; label: string; ownedBy: string | null }[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const deferredKeyword = useDeferredValue(keyword)

  const visibleModels = sortAiModelCatalog(models, deferredKeyword)
  const existingModelIds = new Set(provider.models.map((m) => m.id))

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    void loadModelCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id, provider.baseURL, provider.apiKey])

  /** 拉取当前 provider 的 models 列表 */
  async function loadModelCatalog() {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const nextModels = await fetchAiModelCatalog({ baseURL: provider.baseURL, apiKey: provider.apiKey })
      setModels(nextModels)
    } catch (error) {
      setModels([])
      setErrorMessage(getModelCatalogErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm"
      onClick={(e) => { e.stopPropagation(); onClose() }}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-xl animate-in fade-in-0 zoom-in-97 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold text-foreground">添加模型</div>
            <div className="text-[11px] text-muted-foreground">供应商：{provider.label}</div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="flex gap-2 border-b border-border/50 px-4 py-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchInputId}
              autoFocus
              autoComplete="off"
              className="h-8 pl-8 text-[13px]"
              placeholder="搜索模型 ID..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            onClick={() => void loadModelCatalog()}
            disabled={isLoading}
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            刷新
          </button>
        </div>

        {/* 模型列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在获取模型列表...
            </div>
          ) : errorMessage ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-4 text-[13px] text-destructive">
              <div className="font-medium">无法获取模型列表</div>
              <div className="mt-1 text-[12px]">{errorMessage}</div>
            </div>
          ) : visibleModels.length > 0 ? (
            <div className="space-y-1">
              {visibleModels.map((model) => {
                const isAdded = existingModelIds.has(model.id)
                return (
                  <div
                    key={model.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-foreground">{model.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{model.id}</div>
                    </div>
                    <button
                      type="button"
                      className={cn(
                        'shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                        isAdded
                          ? 'bg-muted text-muted-foreground cursor-default'
                          : 'bg-primary text-primary-foreground hover:bg-primary/90'
                      )}
                      onClick={() => !isAdded && onAddModel(model.id)}
                      disabled={isAdded}
                    >
                      {isAdded ? <><Check className="mr-1 inline size-3" />已添加</> : '添加'}
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-10 text-center text-[13px] text-muted-foreground">没有匹配到模型</div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-border/50 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span>共 {models.length} 个模型</span>
          <Button type="button" variant="ghost" className="h-7 px-3 text-[12px]" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
