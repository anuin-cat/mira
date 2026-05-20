import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, LoaderCircle, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import type { AiSearchFreshnessPreset, AiSearchProviderConfig, AiSearchSettings } from '@/domain/ai'
import {
  getAiSearchProviderResultCountRange,
  getAiSearchProviderById,
  getAiSearchProviderPreset,
  normalizeSearchResultCount,
  patchAiSearchProvider,
  searchBochaWeb,
  searchExaWeb,
  setActiveAiSearchProvider,
  setAiSearchProviderEnabled,
} from '@/services/search'

interface Props {
  searchSettings: AiSearchSettings
  onSearchSettingsChange: (settings: AiSearchSettings) => void
  onClose: () => void
  onPersist: (closeDialog: boolean) => void
}

type SearchTestState =
  | { status: 'idle'; message: string; results: SearchTestResult[] }
  | { status: 'loading'; message: string; results: SearchTestResult[] }
  | { status: 'success'; message: string; results: SearchTestResult[] }
  | { status: 'error'; message: string; results: SearchTestResult[] }

interface SearchTestResult {
  title: string
  url: string
  snippet: string | null
  publishedDate: string | null
}

const SEARCH_FRESHNESS_OPTIONS: Array<{ value: AiSearchFreshnessPreset; label: string }> = [
  { value: 'noLimit', label: '不限' },
  { value: 'oneDay', label: '一天内' },
  { value: 'oneWeek', label: '一周内' },
  { value: 'oneMonth', label: '一个月内' },
  { value: 'oneYear', label: '一年内' },
]
const DEFAULT_TEST_SEARCH_QUERY = 'GitHub 上有哪些优秀的 Markdown editor 项目？'

/** 统一提取搜索 provider 的 API Key 占位文案 */
function getSearchApiKeyPlaceholder(provider: AiSearchProviderConfig): string {
  return getAiSearchProviderPreset(provider.id).apiKeyPlaceholder
}

/** 读取搜索 provider 的服务范围说明 */
function getProviderScopeDescription(provider: AiSearchProviderConfig): string {
  return getAiSearchProviderPreset(provider.id).scopeDescription
}

/** 读取搜索 provider 的 API endpoint */
function getProviderApiEndpoint(provider: AiSearchProviderConfig): string {
  return getAiSearchProviderPreset(provider.id).apiEndpoint
}

/** 生成 provider 启用后的差异化提示 */
function getProviderEnabledMessage(provider: AiSearchProviderConfig): string {
  if (provider.id === 'exa') {
    return 'Exa 已启动并设为默认。它是全球搜索工具，更适合外网、GitHub、技术文档和论文；国内中文内容仍建议用博查。'
  }
  return '博查已启动并设为默认。它更适合中国国内与中文网页；外网、GitHub 和论文内容建议用 Exa。'
}

/** 把当前设置页测试结果整理成统一结构 */
function createSearchTestResults(provider: AiSearchProviderConfig, result: Awaited<ReturnType<typeof searchBochaWeb>> | Awaited<ReturnType<typeof searchExaWeb>>): SearchTestResult[] {
  if (provider.id === 'exa') {
    return (result as Awaited<ReturnType<typeof searchExaWeb>>).results.slice(0, 3).map((item) => ({
      title: item.title ?? item.url,
      url: item.url,
      snippet: item.highlights[0] ?? item.summary,
      publishedDate: item.publishedDate,
    }))
  }

  return (result as Awaited<ReturnType<typeof searchBochaWeb>>).webResults.slice(0, 3).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippet ?? item.summary,
    publishedDate: item.datePublished,
  }))
}

/** 搜索服务设置页：供应商列表、默认参数与测试搜索 */
export function SearchServiceSettings({ searchSettings, onSearchSettingsChange, onClose, onPersist }: Props) {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    searchSettings.activeProviderId ?? searchSettings.providers[0]?.id ?? null
  )
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [testSearchQuery, setTestSearchQuery] = useState(DEFAULT_TEST_SEARCH_QUERY)
  const [searchTestState, setSearchTestState] = useState<SearchTestState>({
    status: 'idle',
    message: '',
    results: [],
  })

  const selectedProvider =
    getAiSearchProviderById(searchSettings, selectedProviderId) ?? searchSettings.providers[0] ?? null
  const selectedProviderCountRange = selectedProvider
    ? getAiSearchProviderResultCountRange(selectedProvider.id)
    : { min: 1, max: 50 }
  const isSelectedProviderActive = selectedProvider?.id === searchSettings.activeProviderId

  useEffect(() => {
    const hasSelectedProvider = searchSettings.providers.some((provider) => provider.id === selectedProviderId)
    if (hasSelectedProvider) return
    setSelectedProviderId(searchSettings.providers[0]?.id ?? null)
  }, [searchSettings.providers, selectedProviderId])

  /** 更新当前选中搜索 provider 的局部字段 */
  function patchSelectedProvider(patch: Partial<AiSearchProviderConfig>) {
    if (!selectedProvider) return
    onSearchSettingsChange(patchAiSearchProvider(searchSettings, selectedProvider.id, patch))
    setSearchTestState({ status: 'idle', message: '', results: [] })
  }

  /** 把某个 provider 设为 agent 默认搜索源 */
  function handleActivateProvider(providerId: AiSearchProviderConfig['id']) {
    onSearchSettingsChange(setActiveAiSearchProvider(searchSettings, providerId))
    setSearchTestState({ status: 'success', message: '已设为 AI agent 默认搜索源，保存后生效', results: [] })
  }

  /** 切换搜索 provider 是否可供 agent 调用 */
  function handleToggleProviderEnabled(providerId: AiSearchProviderConfig['id'], isEnabled: boolean) {
    const targetProvider = getAiSearchProviderById(searchSettings, providerId)
    if (isEnabled && !targetProvider?.apiKey.trim()) {
      setSearchTestState({ status: 'error', message: `请先填写 ${targetProvider?.label ?? '搜索服务'} API Key 再启动`, results: [] })
      return
    }

    const toggledSettings = setAiSearchProviderEnabled(searchSettings, providerId, isEnabled)
    const fallbackProviderId =
      toggledSettings.providers.find((provider) => provider.id !== providerId && provider.isEnabled)?.id ??
      toggledSettings.providers.find((provider) => provider.id !== providerId)?.id
    const nextSettings = isEnabled
      ? setActiveAiSearchProvider(toggledSettings, providerId)
      : searchSettings.activeProviderId === providerId && fallbackProviderId
        ? setActiveAiSearchProvider(toggledSettings, fallbackProviderId)
        : toggledSettings
    onSearchSettingsChange(nextSettings)
    setSearchTestState({
      status: isEnabled ? 'success' : 'idle',
      message: isEnabled && targetProvider ? getProviderEnabledMessage(targetProvider) : '',
      results: [],
    })
  }

  /** 使用当前草稿配置发起一次小规模搜索，验证 API Key 与 CORS 是否可用 */
  async function handleTestSearch() {
    if (!selectedProvider) return

    const query = testSearchQuery.trim()
    if (!query) {
      setSearchTestState({ status: 'error', message: '请先填写测试搜索词', results: [] })
      return
    }
    if (!selectedProvider.apiKey.trim()) {
      setSearchTestState({ status: 'error', message: `请先填写 ${selectedProvider.label} API Key`, results: [] })
      return
    }

    setSearchTestState({ status: 'loading', message: `正在测试 ${selectedProvider.label} 搜索...`, results: [] })

    try {
      const result =
        selectedProvider.id === 'exa'
          ? await searchExaWeb({
              apiKey: selectedProvider.apiKey,
              query,
              freshness: selectedProvider.defaultFreshness,
              includeHighlights: true,
              includeSummary: true,
              count: Math.min(3, selectedProvider.defaultCount),
            })
          : await searchBochaWeb({
              apiKey: selectedProvider.apiKey,
              query,
              freshness: selectedProvider.defaultFreshness,
              summary: true,
              count: Math.min(3, selectedProvider.defaultCount),
            })
      const results = createSearchTestResults(selectedProvider, result)
      setSearchTestState({
        status: 'success',
        message: `搜索成功，返回 ${results.length} 条网页结果`,
        results,
      })
    } catch (error) {
      setSearchTestState({
        status: 'error',
        message: error instanceof Error ? error.message : '测试搜索失败',
        results: [],
      })
    }
  }

  return (
    <>
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border/50">
        <div className="px-4 pb-2 pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">搜索供应商</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {searchSettings.providers.map((provider) => {
            const isSelected = provider.id === selectedProvider?.id
            const isEnabled = provider.isEnabled
            const isActive = provider.id === searchSettings.activeProviderId

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
                  setSearchTestState({ status: 'idle', message: '', results: [] })
                }}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{provider.label}</span>
                {isActive ? (
                  <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    默认
                  </span>
                ) : null}
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  内置
                </span>
                <button
                  type="button"
                  className={cn(
                    'relative h-4 w-7 shrink-0 rounded-full transition-colors',
                    isEnabled ? 'bg-primary' : 'bg-muted-foreground/25'
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleProviderEnabled(provider.id, !isEnabled)
                  }}
                  aria-label={isEnabled ? '停用搜索服务' : '启动搜索服务'}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
                      isEnabled ? 'left-[14px]' : 'left-0.5'
                    )}
                  />
                </button>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center border-b border-border/50 px-6 py-4">
          <div>
            <div className="text-base font-semibold text-foreground">{selectedProvider?.label ?? '搜索服务'}</div>
            {selectedProvider ? (
              <div className="text-xs text-muted-foreground">Web Search API: {getProviderApiEndpoint(selectedProvider)}</div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {selectedProvider ? (
            <div className="space-y-6">
              <div>
                <div className="mb-2.5 text-sm font-semibold text-foreground">API Key</div>
                <div className="flex gap-2">
                  <Input
                    className="h-9 min-w-0 flex-1 font-mono text-sm"
                    type={isApiKeyVisible ? 'text' : 'password'}
                    autoComplete="off"
                    placeholder={getSearchApiKeyPlaceholder(selectedProvider)}
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
                  <Button type="button" className="h-9 shrink-0 px-4 text-sm" onClick={() => onPersist(false)}>
                    保存
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border/50 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">搜索工具</div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {getProviderScopeDescription(selectedProvider)}
                      启动后，AI agent 在需要外部网页信息时可以调用 web_search；同时启用博查与 Exa 时，模型会按国内中文 / 全球外网与论文 GitHub 场景差异化选择。
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant={isSelectedProviderActive ? 'secondary' : 'outline'}
                      className="h-8 px-3 text-xs"
                      onClick={() => handleActivateProvider(selectedProvider.id)}
                      disabled={isSelectedProviderActive}
                    >
                      {isSelectedProviderActive ? '默认搜索源' : '设为默认'}
                    </Button>
                    <button
                      type="button"
                      className={cn(
                        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                        selectedProvider.isEnabled ? 'bg-primary' : 'bg-muted-foreground/25'
                      )}
                      onClick={() => handleToggleProviderEnabled(selectedProvider.id, !selectedProvider.isEnabled)}
                      aria-label={selectedProvider.isEnabled ? '停用搜索服务' : '启动搜索服务'}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                          selectedProvider.isEnabled ? 'left-[22px]' : 'left-0.5'
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2.5 text-sm font-semibold text-foreground">默认搜索参数</div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">时间范围</Label>
                    <Select
                      value={selectedProvider.defaultFreshness}
                      onValueChange={(value) =>
                        patchSelectedProvider({ defaultFreshness: value as AiSearchFreshnessPreset })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {SEARCH_FRESHNESS_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">返回条数</Label>
                    <Input
                      type="number"
                      min={selectedProviderCountRange.min}
                      max={selectedProviderCountRange.max}
                      step={1}
                      className="h-9 text-sm"
                      value={selectedProvider.defaultCount}
                      onChange={(e) =>
                        patchSelectedProvider({
                          defaultCount: normalizeSearchResultCount(Number(e.target.value || 0), selectedProvider.id),
                        })
                      }
                    />
                    <div className="text-[11px] text-muted-foreground">
                      {selectedProvider.label} 支持 {selectedProviderCountRange.min}-{selectedProviderCountRange.max} 条
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2.5 text-sm font-semibold text-foreground">测试搜索</div>
                <div className="flex gap-2">
                  <Input
                    className="h-9 min-w-0 flex-1 text-sm"
                    value={testSearchQuery}
                    onChange={(e) => {
                      setTestSearchQuery(e.target.value)
                      setSearchTestState({ status: 'idle', message: '', results: [] })
                    }}
                    placeholder="输入测试搜索词"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 shrink-0 px-4 text-sm"
                    onClick={() => void handleTestSearch()}
                    disabled={searchTestState.status === 'loading'}
                  >
                    {searchTestState.status === 'loading' ? (
                      <LoaderCircle className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <Search className="mr-1.5 size-4" />
                    )}
                    测试搜索
                  </Button>
                </div>

                {searchTestState.status !== 'idle' ? (
                  <div
                    className={cn(
                      'mt-3 rounded-lg border px-3 py-3 text-sm',
                      searchTestState.status === 'error'
                        ? 'border-destructive/30 bg-destructive/5 text-destructive'
                        : 'border-border/60 bg-muted/30 text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {searchTestState.status === 'loading' ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : searchTestState.status === 'error' ? (
                        <AlertCircle className="size-4" />
                      ) : (
                        <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                      )}
                      <span>{searchTestState.message}</span>
                    </div>
                    {searchTestState.results.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {searchTestState.results.map((result) => (
                          <a
                            key={result.url}
                            className="block rounded-md border border-border/50 bg-background/70 px-3 py-2 text-foreground transition-colors hover:bg-muted"
                            href={result.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <div className="truncate text-sm font-medium">{result.title}</div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">{result.url}</div>
                            {result.snippet ? (
                              <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {result.snippet}
                              </div>
                            ) : null}
                            {result.publishedDate ? (
                              <div className="mt-1 text-[11px] text-muted-foreground">{result.publishedDate}</div>
                            ) : null}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-6 py-3">
          <Button type="button" variant="ghost" className="h-9 px-4 text-sm" onClick={onClose}>
            取消
          </Button>
          <Button type="button" className="h-9 px-4 text-sm" onClick={() => onPersist(true)}>
            保存设置
          </Button>
        </div>
      </section>
    </>
  )
}
