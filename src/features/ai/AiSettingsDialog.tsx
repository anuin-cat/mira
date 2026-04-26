import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, EyeOff, Layers, Plus, Settings2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { AiProviderConfig, AiProviderModel, AiSettingsState } from '../../domain/ai'
import {
  addAiProvider,
  addAiProviderModel,
  createCustomAiProvider,
  getAiProviderById,
  getAiProviderPresetForConfig,
  isBuiltInAiProvider,
  normalizeAiSettings,
  patchAiProvider,
  removeAiProvider,
  removeAiProviderModel,
  setActiveAiProvider,
} from '../../services/aiSettingsService'
import { AddModelDialog } from './settings/AddModelDialog'
import { AddProviderDialog } from './settings/AddProviderDialog'

type NavSection = 'providers' | 'chat-params'

interface Props {
  initialSettings: AiSettingsState
  onClose: () => void
  /** closeDialog：true 表示保存后关闭弹层（底部「保存设置」），false 表示保留弹层（API Key 旁「保存」） */
  onSave: (settings: AiSettingsState, closeDialog: boolean) => void
}

/** 统一提取 provider 的 API Key 占位文案 */
function getApiKeyPlaceholder(provider: AiProviderConfig): string {
  return getAiProviderPresetForConfig(provider)?.apiKeyPlaceholder ?? '输入你的 API Key'
}

/** 计算模型当前应展示的状态文案 */
function getModelBadgeLabel(
  settings: AiSettingsState,
  provider: AiProviderConfig,
  model: AiProviderModel
): string | null {
  if (provider.selectedModelId !== model.id) return null
  return settings.activeProviderId === provider.id ? '当前使用' : '默认模型'
}

/** AI 设置弹层：三栏布局，左侧导航 / 中间供应商列表 / 右侧详情 */
export function AiSettingsDialog({ initialSettings, onClose, onSave }: Props) {
  const [draftSettings, setDraftSettings] = useState<AiSettingsState>(initialSettings)
  const [activeNav, setActiveNav] = useState<NavSection>('providers')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    initialSettings.activeProviderId ?? initialSettings.providers[0]?.id ?? null
  )
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false)
  const [isAddModelOpen, setIsAddModelOpen] = useState(false)

  const selectedProvider =
    getAiProviderById(draftSettings, selectedProviderId) ?? draftSettings.providers[0] ?? null

  useEffect(() => {
    setDraftSettings(initialSettings)
    setSelectedProviderId(initialSettings.activeProviderId ?? initialSettings.providers[0]?.id ?? null)
    setIsApiKeyVisible(false)
  }, [initialSettings])

  useEffect(() => {
    // 1. 当当前选中的 provider 被删除后，自动回退到列表中的首项
    const hasSelectedProvider = draftSettings.providers.some((p) => p.id === selectedProviderId)
    if (hasSelectedProvider) return
    setSelectedProviderId(draftSettings.providers[0]?.id ?? null)
  }, [draftSettings.providers, selectedProviderId])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (isAddProviderOpen || isAddModelOpen) return
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAddModelOpen, isAddProviderOpen, onClose])

  /** 更新顶层 AI 设置字段 */
  function patchDraftSettings(patch: Partial<AiSettingsState>) {
    setDraftSettings((current) => normalizeAiSettings({ ...current, ...patch }))
  }

  /** 更新当前选中 provider 的局部字段 */
  function patchSelectedProvider(patch: Partial<AiProviderConfig>) {
    if (!selectedProvider) return
    setDraftSettings((current) => patchAiProvider(current, selectedProvider.id, patch))
  }

  /** 添加一个新的自定义 provider，并自动切到详情面板 */
  function handleAddProvider(label: string, baseURL: string) {
    const nextProvider = createCustomAiProvider(label, baseURL)
    const nextSettings = addAiProvider(draftSettings, nextProvider)
    setDraftSettings(nextSettings)
    setSelectedProviderId(nextProvider.id)
    setIsAddProviderOpen(false)
  }

  /** 删除指定的自定义 provider */
  function handleDeleteProvider(providerId: string) {
    const targetProvider = getAiProviderById(draftSettings, providerId)
    if (!targetProvider || isBuiltInAiProvider(targetProvider)) return
    const nextSettings = removeAiProvider(draftSettings, providerId)
    const nextSelectedProviderId =
      selectedProviderId === providerId
        ? nextSettings.activeProviderId ?? nextSettings.providers[0]?.id ?? null
        : selectedProviderId
    setDraftSettings(nextSettings)
    setSelectedProviderId(nextSelectedProviderId)
  }

  /** 把当前 provider 设为聊天默认入口 */
  function handleActivateProvider(providerId: string) {
    setDraftSettings((current) => setActiveAiProvider(current, providerId))
  }

  /** 添加一个模型到当前 provider */
  function handleAddModel(modelId: string) {
    if (!selectedProvider) return
    setDraftSettings((current) => addAiProviderModel(current, selectedProvider.id, modelId))
    setIsAddModelOpen(false)
  }

  /** 删除当前 provider 下的某个模型 */
  function handleDeleteModel(modelId: string) {
    if (!selectedProvider) return
    setDraftSettings((current) => removeAiProviderModel(current, selectedProvider.id, modelId))
  }

  /** 将当前草稿写入本地；是否关闭弹层由调用方决定 */
  function persistSettings(closeDialog: boolean) {
    onSave(normalizeAiSettings(draftSettings), closeDialog)
  }

  return createPortal(
    <>
      <div
        role="presentation"
        className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm animate-in fade-in-0 duration-150"
        onClick={onClose}
      >
        <div
          className="relative flex max-h-[88vh] w-full max-w-[920px] overflow-hidden rounded-2xl border border-border/60 bg-background shadow-xl animate-in fade-in-0 zoom-in-97 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex min-h-0 w-full" style={{ minHeight: '560px' }}>
            {/* 最左侧导航栏 */}
            <nav className="flex w-[200px] shrink-0 flex-col border-r border-border/50 bg-muted/20 px-3 py-4">
              <div className="mb-4 flex items-center justify-between px-2">
                <span className="text-sm font-semibold text-foreground">设置</span>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={onClose}
                  aria-label="关闭"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="space-y-0.5">
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    activeNav === 'providers'
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                  )}
                  onClick={() => setActiveNav('providers')}
                >
                  <Layers className="size-4 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">模型服务</div>
                    <div className="text-xs text-muted-foreground">管理AI模型和API配置</div>
                  </div>
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    activeNav === 'chat-params'
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                  )}
                  onClick={() => setActiveNav('chat-params')}
                >
                  <Settings2 className="size-4 shrink-0" />
                  <div>
                    <div className="text-sm font-medium">对话参数</div>
                    <div className="text-xs text-muted-foreground">温度与最大回复长度</div>
                  </div>
                </button>
              </div>
            </nav>

            {/* 中间供应商列表（仅模型服务页显示） */}
            {activeNav === 'providers' ? (
              <aside className="flex w-[260px] shrink-0 flex-col border-r border-border/50">
                <div className="px-4 pb-2 pt-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">供应商</span>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => setIsAddProviderOpen(true)}
                      aria-label="添加供应商"
                    >
                      <Plus className="size-4 shrink-0" aria-hidden />
                      添加
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                  {draftSettings.providers.map((provider) => {
                    const isSelected = provider.id === selectedProvider?.id
                    const isActive = provider.id === draftSettings.activeProviderId
                    const isCustom = !isBuiltInAiProvider(provider)

                    return (
                      <button
                        key={provider.id}
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors',
                          isSelected ? 'bg-primary/8 text-foreground' : 'text-foreground/80 hover:bg-muted'
                        )}
                        onClick={() => {
                          setSelectedProviderId(provider.id)
                          setIsApiKeyVisible(false)
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{provider.label}</span>
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
                            isCustom
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'bg-primary/10 text-primary'
                          )}
                        >
                          {isCustom ? '自定义' : '内置'}
                        </span>
                        {isCustom ? (
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteProvider(provider.id)
                            }}
                            aria-label="删除供应商"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ) : null}
                        {/* toggle：点击切换是否为当前使用 */}
                        <button
                          type="button"
                          className={cn(
                            'relative shrink-0 h-4 w-7 rounded-full transition-colors',
                            isActive ? 'bg-primary' : 'bg-muted-foreground/25'
                          )}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleActivateProvider(provider.id)
                          }}
                          aria-label={isActive ? '当前使用' : '设为使用'}
                        >
                          <span
                            className={cn(
                              'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
                              isActive ? 'left-[14px]' : 'left-0.5'
                            )}
                          />
                        </button>
                      </button>
                    )
                  })}
                </div>
              </aside>
            ) : null}

            {/* 右侧内容区 */}
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* 顶部标题栏 */}
              <div className="flex items-center border-b border-border/50 px-6 py-4">
                {activeNav === 'providers' ? (
                  <div>
                    <div className="text-base font-semibold text-foreground">
                      {selectedProvider?.label ?? 'AI 设置'}
                    </div>
                    {selectedProvider ? (
                      <div className="text-xs text-muted-foreground">
                        Base URL: {selectedProvider.baseURL}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-base font-semibold text-foreground">对话参数</div>
                )}
              </div>

              {/* 内容区 */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {activeNav === 'providers' && selectedProvider ? (
                  <div className="space-y-6">
                    {/* API Key 区块 */}
                    <div>
                      <div className="mb-2.5 text-sm font-semibold text-foreground">API Key</div>
                      <div className="flex gap-2">
                        <Input
                          className="h-9 min-w-0 flex-1 font-mono text-sm"
                          type={isApiKeyVisible ? 'text' : 'password'}
                          autoComplete="off"
                          placeholder={getApiKeyPlaceholder(selectedProvider)}
                          value={selectedProvider.apiKey}
                          onChange={(e) => patchSelectedProvider({ apiKey: e.target.value })}
                        />
                        <button
                          type="button"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-muted"
                          onClick={() => setIsApiKeyVisible((v) => !v)}
                          aria-label={isApiKeyVisible ? '隐藏密钥' : '显示密钥'}
                        >
                          {isApiKeyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                        <Button type="button" className="h-9 shrink-0 px-4 text-sm" onClick={() => persistSettings(false)}>
                          保存
                        </Button>
                      </div>
                    </div>

                    {/* 模型管理区块 */}
                    <div>
                      <div className="mb-2.5 flex items-center justify-between">
                        <div className="text-sm font-semibold text-foreground">模型管理</div>
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => setIsAddModelOpen(true)}
                        >
                          <Plus className="size-3.5" />
                          添加模型
                        </button>
                      </div>

                      {selectedProvider.models.length > 0 ? (
                        <div className="space-y-2">
                          {selectedProvider.models.map((model) => {
                            const badgeLabel = getModelBadgeLabel(draftSettings, selectedProvider, model)

                            return (
                              <div
                                key={model.id}
                                className="flex items-center gap-3 rounded-lg border border-border/50 px-4 py-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-foreground">{model.label}</div>
                                  <div className="truncate text-xs text-muted-foreground">{model.id}</div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {badgeLabel ? (
                                    <span
                                      className={cn(
                                        'rounded px-1.5 py-0.5 text-[11px] font-medium',
                                        badgeLabel === '当前使用'
                                          ? 'bg-primary/10 text-primary'
                                          : 'bg-muted text-muted-foreground'
                                      )}
                                    >
                                      {badgeLabel}
                                    </span>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="rounded p-1 text-muted-foreground/50 transition-colors hover:text-destructive"
                                    onClick={() => handleDeleteModel(model.id)}
                                    aria-label="删除模型"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center">
                          <div className="text-sm text-muted-foreground">还没有保存任何模型</div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : activeNav === 'chat-params' ? (
                  <div className="max-w-md space-y-6">
                    <div className="flex items-center gap-4">
                      <Label className="w-16 shrink-0 text-sm text-muted-foreground">温度</Label>
                      <Input
                        type="number"
                        min={0}
                        max={1.5}
                        step={0.1}
                        className="h-9 w-28 text-sm"
                        value={draftSettings.temperature}
                        onChange={(e) => patchDraftSettings({ temperature: Number(e.target.value || 0) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground">系统提示词</Label>
                      <Textarea
                        className="min-h-[120px] resize-y text-sm leading-relaxed"
                        placeholder="定义 AI 的回答语气、边界和任务偏好"
                        rows={4}
                        value={draftSettings.systemPrompt}
                        onChange={(e) => patchDraftSettings({ systemPrompt: e.target.value })}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* 底部按钮栏 */}
              <div className="flex items-center justify-end gap-2 border-t border-border/50 px-6 py-3">
                <Button type="button" variant="ghost" className="h-9 px-4 text-sm" onClick={onClose}>
                  取消
                </Button>
                <Button type="button" className="h-9 px-4 text-sm" onClick={() => persistSettings(true)}>
                  保存设置
                </Button>
              </div>
            </section>
          </div>
        </div>
      </div>

      {isAddProviderOpen ? (
        <AddProviderDialog onClose={() => setIsAddProviderOpen(false)} onSubmit={handleAddProvider} />
      ) : null}

      {isAddModelOpen && selectedProvider ? (
        <AddModelDialog
          provider={selectedProvider}
          onClose={() => setIsAddModelOpen(false)}
          onAddModel={handleAddModel}
        />
      ) : null}
    </>,
    document.body
  )
}
