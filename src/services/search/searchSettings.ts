import type {
  AiSearchFreshnessPreset,
  AiSearchProviderConfig,
  AiSearchProviderId,
  AiSearchProviderPreset,
  AiSearchRequestProviderSettings,
  AiSearchRequestSettings,
  AiSearchSettings,
} from '../../domain/ai'

const DEFAULT_SEARCH_COUNT = 10
const MIN_SEARCH_COUNT = 1
const MAX_BOCHA_SEARCH_COUNT = 50
const MAX_EXA_SEARCH_COUNT = 100

export const AI_SEARCH_PROVIDER_PRESETS: AiSearchProviderPreset[] = [
  {
    id: 'bocha',
    label: '博查',
    apiKeyPlaceholder: 'sk-...',
    apiEndpoint: 'https://api.bocha.cn/v1/web-search',
    scopeDescription: '中文与中国国内网页搜索服务，适合国内新闻、平台内容与中文资料。',
  },
  {
    id: 'exa',
    label: 'Exa',
    apiKeyPlaceholder: 'exa_...',
    apiEndpoint: 'https://api.exa.ai/search',
    scopeDescription: '全球搜索工具，适合外网资料、GitHub、技术文档与论文内容。',
  },
]

const SEARCH_FRESHNESS_PRESETS: AiSearchFreshnessPreset[] = [
  'noLimit',
  'oneDay',
  'oneWeek',
  'oneMonth',
  'oneYear',
]

/** 判断是否为设置页可选的搜索时间范围 */
function isSearchFreshnessPreset(value: unknown): value is AiSearchFreshnessPreset {
  return typeof value === 'string' && SEARCH_FRESHNESS_PRESETS.includes(value as AiSearchFreshnessPreset)
}

/** 获取不同搜索 provider 支持的返回条数范围 */
export function getAiSearchProviderResultCountRange(providerId: AiSearchProviderId): { min: number; max: number } {
  return {
    min: MIN_SEARCH_COUNT,
    max: providerId === 'exa' ? MAX_EXA_SEARCH_COUNT : MAX_BOCHA_SEARCH_COUNT,
  }
}

/** 归一化搜索结果条数，避免异常值打到外部 API */
export function normalizeSearchResultCount(
  value: unknown,
  providerId: AiSearchProviderId = 'bocha',
  fallback = DEFAULT_SEARCH_COUNT
): number {
  const range = getAiSearchProviderResultCountRange(providerId)
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

/** 根据 provider id 读取搜索服务预设 */
export function getAiSearchProviderPreset(providerId: AiSearchProviderId): AiSearchProviderPreset {
  return AI_SEARCH_PROVIDER_PRESETS.find((preset) => preset.id === providerId) ?? AI_SEARCH_PROVIDER_PRESETS[0]
}

/** 规范化内置搜索 provider，保证新增字段能兼容旧设置 */
function normalizeSearchProvider(
  input: Partial<AiSearchProviderConfig> | null | undefined,
  presetId: AiSearchProviderId
): AiSearchProviderConfig {
  const preset = getAiSearchProviderPreset(presetId)
  return {
    id: preset.id,
    label: preset.label,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : '',
    isEnabled: typeof input?.isEnabled === 'boolean' ? input.isEnabled : false,
    defaultFreshness: isSearchFreshnessPreset(input?.defaultFreshness) ? input.defaultFreshness : 'noLimit',
    defaultCount: normalizeSearchResultCount(input?.defaultCount, preset.id),
  }
}

/** 创建默认搜索设置 */
export function createDefaultSearchSettings(): AiSearchSettings {
  return normalizeSearchSettings({
    activeProviderId: 'bocha',
    providers: [],
  })
}

/** 把外部输入整理成合法的搜索设置 */
export function normalizeSearchSettings(input: Partial<AiSearchSettings> | null | undefined): AiSearchSettings {
  const rawProviders = Array.isArray(input?.providers) ? input.providers : []
  const providers = AI_SEARCH_PROVIDER_PRESETS.map((preset) => {
    const matchedProvider = rawProviders.find((provider) => provider?.id === preset.id)
    return normalizeSearchProvider(matchedProvider, preset.id)
  })
  const activeProviderId =
    typeof input?.activeProviderId === 'string' &&
    providers.some((provider) => provider.id === input.activeProviderId)
      ? input.activeProviderId
      : providers[0]?.id ?? null

  return {
    activeProviderId,
    providers,
  }
}

/** 按 id 读取一个搜索 provider */
export function getAiSearchProviderById(
  searchSettings: AiSearchSettings,
  providerId: string | null | undefined
): AiSearchProviderConfig | null {
  if (!providerId) return null
  return searchSettings.providers.find((provider) => provider.id === providerId) ?? null
}

/** 更新单个搜索 provider 的局部字段 */
export function patchAiSearchProvider(
  searchSettings: AiSearchSettings,
  providerId: AiSearchProviderId,
  patch: Partial<AiSearchProviderConfig>
): AiSearchSettings {
  return normalizeSearchSettings({
    ...searchSettings,
    providers: searchSettings.providers.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            ...patch,
          }
        : provider
    ),
  })
}

/** 设置 agent 默认优先使用的搜索 provider */
export function setActiveAiSearchProvider(
  searchSettings: AiSearchSettings,
  providerId: AiSearchProviderId
): AiSearchSettings {
  if (!searchSettings.providers.some((provider) => provider.id === providerId)) return searchSettings
  return normalizeSearchSettings({
    ...searchSettings,
    activeProviderId: providerId,
  })
}

/** 切换搜索 provider 是否启用 */
export function setAiSearchProviderEnabled(
  searchSettings: AiSearchSettings,
  providerId: AiSearchProviderId,
  isEnabled: boolean
): AiSearchSettings {
  return patchAiSearchProvider(searchSettings, providerId, { isEnabled })
}

/** 将保存态 provider 转成 agent 请求态 provider */
function createSearchRequestProviderSettings(provider: AiSearchProviderConfig): AiSearchRequestProviderSettings {
  return {
    providerId: provider.id,
    providerLabel: provider.label,
    apiKey: provider.apiKey,
    defaultFreshness: provider.defaultFreshness,
    defaultCount: provider.defaultCount,
  }
}

/** 解析出当前真正可用于 agent 的搜索服务配置 */
export function resolveActiveSearchRequestSettings(searchSettings: AiSearchSettings): AiSearchRequestSettings | null {
  const availableProviders = searchSettings.providers
    .filter((provider) => provider.isEnabled && provider.apiKey.trim())
    .map(createSearchRequestProviderSettings)
  if (availableProviders.length === 0) return null

  const activeProvider =
    availableProviders.find((provider) => provider.providerId === searchSettings.activeProviderId) ??
    availableProviders[0]

  return {
    ...activeProvider,
    activeProviderId: activeProvider.providerId,
    providers: availableProviders,
  }
}
