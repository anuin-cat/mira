import type {
  AiSearchFreshnessPreset,
  AiSearchProviderConfig,
  AiSearchProviderId,
  AiSearchProviderPreset,
  AiSearchRequestSettings,
  AiSearchSettings,
} from '../../domain/ai'

const DEFAULT_BOCHA_SEARCH_COUNT = 10
const MIN_BOCHA_SEARCH_COUNT = 1
const MAX_BOCHA_SEARCH_COUNT = 50

export const AI_SEARCH_PROVIDER_PRESETS: AiSearchProviderPreset[] = [
  {
    id: 'bocha',
    label: '博查',
    apiKeyPlaceholder: 'sk-...',
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

/** 归一化搜索结果条数，避免异常值打到外部 API */
export function normalizeSearchResultCount(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_BOCHA_SEARCH_COUNT
  return Math.min(MAX_BOCHA_SEARCH_COUNT, Math.max(MIN_BOCHA_SEARCH_COUNT, Math.round(value)))
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
    defaultCount: normalizeSearchResultCount(input?.defaultCount),
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

/** 切换搜索 provider 是否启用 */
export function setAiSearchProviderEnabled(
  searchSettings: AiSearchSettings,
  providerId: AiSearchProviderId,
  isEnabled: boolean
): AiSearchSettings {
  return patchAiSearchProvider(searchSettings, providerId, { isEnabled })
}

/** 解析出当前真正可用于 agent 的搜索服务配置 */
export function resolveActiveSearchRequestSettings(searchSettings: AiSearchSettings): AiSearchRequestSettings | null {
  const activeProvider =
    getAiSearchProviderById(searchSettings, searchSettings.activeProviderId) ?? searchSettings.providers[0] ?? null
  if (!activeProvider || !activeProvider.isEnabled || !activeProvider.apiKey.trim()) return null

  return {
    providerId: activeProvider.id,
    providerLabel: activeProvider.label,
    apiKey: activeProvider.apiKey,
    defaultFreshness: activeProvider.defaultFreshness,
    defaultCount: activeProvider.defaultCount,
  }
}
