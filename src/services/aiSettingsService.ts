import type {
  AiBuiltinProviderId,
  AiChatMessage,
  AiChatSession,
  AiProviderConfig,
  AiProviderModel,
  AiProviderPreset,
  AiRequestSettings,
  AiSettingsState,
} from '../domain/ai'

const AI_SETTINGS_STORAGE_KEY = 'mira:ai:settings:v2'
const AI_SESSIONS_STORAGE_PREFIX = 'mira:ai:sessions:'
const DEFAULT_SYSTEM_PROMPT =
  '你是 Mira 的本地笔记陪伴助手。请结合当前笔记内容，用中文给出清晰、温和、务实的回答。若信息不足，请明确说明，不要编造事实。'
const DEFAULT_PROVIDER_BASE_URL = 'https://api.example.com/v1'

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'kimi',
    label: 'KIMI',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    apiKeyPlaceholder: 'sk-...',
  },
]

/** 根据 provider id 读取预设，不存在时回退到 DeepSeek */
export function getAiProviderPreset(providerId: AiBuiltinProviderId): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === providerId) ?? AI_PROVIDER_PRESETS[0]
}

/** 创建当前时间戳，统一用于 provider / model 新增记录 */
function createNowIso(): string {
  return new Date().toISOString()
}

/** 生成稳定的本地 id，避免自定义 provider 冲突 */
function createAiLocalId(prefix: string): string {
  if (typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 去掉字符串首尾空白，并把结尾斜杠收一层 */
function normalizeBaseUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return value.trim().replace(/\/+$/, '')
}

/** 把模型名整理成可保存的结构 */
function normalizeProviderModel(input: Partial<AiProviderModel> | null | undefined): AiProviderModel | null {
  if (!input || typeof input.id !== 'string' || !input.id.trim()) return null

  const modelId = input.id.trim()
  return {
    id: modelId,
    label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : modelId,
    addedAt: typeof input.addedAt === 'string' && input.addedAt ? input.addedAt : createNowIso(),
  }
}

/** 删除重复模型，同时尽量保留原始顺序 */
function dedupeProviderModels(input: unknown): AiProviderModel[] {
  if (!Array.isArray(input)) return []

  const modelMap = new Map<string, AiProviderModel>()
  input.forEach((item) => {
    const normalizedModel = normalizeProviderModel(item as Partial<AiProviderModel>)
    if (normalizedModel) modelMap.set(normalizedModel.id, normalizedModel)
  })

  return [...modelMap.values()]
}

/** 为 provider 兜底选中模型，避免出现 active provider 却没有 model 的状态 */
function ensureSelectedModelId(
  models: AiProviderModel[],
  selectedModelId: unknown
): string | null {
  if (typeof selectedModelId === 'string' && models.some((model) => model.id === selectedModelId)) {
    return selectedModelId
  }
  return models[0]?.id ?? null
}

/** 创建默认 AI 设置（内置供应商不预填模型，由用户自行添加并选择） */
function createBuiltInProvider(presetId: AiBuiltinProviderId): AiProviderConfig {
  const preset = getAiProviderPreset(presetId)
  return {
    id: preset.id,
    source: 'builtin',
    presetId: preset.id,
    label: preset.label,
    apiKey: '',
    baseURL: preset.defaultBaseUrl,
    models: [],
    selectedModelId: null,
  }
}

/** 归一化温度值，避免异常输入破坏请求 */
function normalizeTemperature(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.7
  return Math.min(1.5, Math.max(0, Math.round(value * 10) / 10))
}

/** 规范化内置 provider，保证基础字段不丢失 */
function normalizeBuiltInProvider(
  input: Partial<AiProviderConfig> | null | undefined,
  presetId: AiBuiltinProviderId
): AiProviderConfig {
  const preset = getAiProviderPreset(presetId)
  const models = dedupeProviderModels(input?.models)

  return {
    id: preset.id,
    source: 'builtin',
    presetId: preset.id,
    label: preset.label,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : '',
    baseURL: normalizeBaseUrl(input?.baseURL, preset.defaultBaseUrl),
    models,
    selectedModelId: ensureSelectedModelId(models, input?.selectedModelId),
  }
}

/** 规范化自定义 provider，过滤掉空名称或空 id 的脏数据 */
function normalizeCustomProvider(input: Partial<AiProviderConfig> | null | undefined): AiProviderConfig | null {
  if (!input) return null

  const providerId =
    typeof input.id === 'string' && input.id.trim() ? input.id.trim() : createAiLocalId('provider')
  const label =
    typeof input.label === 'string' && input.label.trim() ? input.label.trim() : '自定义供应商'
  const models = dedupeProviderModels(input.models)

  return {
    id: providerId,
    source: 'custom',
    presetId: null,
    label,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey.trim() : '',
    baseURL: normalizeBaseUrl(input.baseURL, DEFAULT_PROVIDER_BASE_URL),
    models,
    selectedModelId: ensureSelectedModelId(models, input.selectedModelId),
  }
}

/** 把 provider 列表整理成“内置优先 + 自定义追加”的稳定顺序 */
function normalizeProviders(input: unknown): AiProviderConfig[] {
  const rawProviders = Array.isArray(input) ? input : []
  const builtInProviders = AI_PROVIDER_PRESETS.map((preset) => {
    const matchedProvider = rawProviders.find((provider) => {
      if (!provider || typeof provider !== 'object') return false
      const candidate = provider as Partial<AiProviderConfig>
      return candidate.id === preset.id || candidate.presetId === preset.id
    })
    return normalizeBuiltInProvider(matchedProvider as Partial<AiProviderConfig>, preset.id)
  })

  const customProviders = rawProviders
    .filter((provider) => {
      if (!provider || typeof provider !== 'object') return false
      const candidate = provider as Partial<AiProviderConfig>
      return candidate.source === 'custom' || (!candidate.presetId && !AI_PROVIDER_PRESETS.some((preset) => preset.id === candidate.id))
    })
    .map((provider) => normalizeCustomProvider(provider as Partial<AiProviderConfig>))
    .filter((provider): provider is AiProviderConfig => provider !== null)

  return [...builtInProviders, ...customProviders]
}

/** 创建默认 AI 设置 */
export function createDefaultAiSettings(): AiSettingsState {
  return {
    activeProviderId: 'deepseek',
    providers: normalizeProviders([]),
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
  }
}

/** 把外部输入整理成合法的 AI 设置 */
export function normalizeAiSettings(input: Partial<AiSettingsState> | null | undefined): AiSettingsState {
  const defaults = createDefaultAiSettings()
  const providers = normalizeProviders(input?.providers)
  const activeProviderId =
    typeof input?.activeProviderId === 'string' && providers.some((provider) => provider.id === input.activeProviderId)
      ? input.activeProviderId
      : providers[0]?.id ?? null

  return {
    activeProviderId,
    providers,
    systemPrompt:
      typeof input?.systemPrompt === 'string' && input.systemPrompt.trim()
        ? input.systemPrompt.trim()
        : defaults.systemPrompt,
    temperature: normalizeTemperature(input?.temperature),
  }
}

/** 从 localStorage 读取 AI 设置 */
export function loadAiSettings(): AiSettingsState {
  const nextRaw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
  if (!nextRaw) return createDefaultAiSettings()

  try {
    return normalizeAiSettings(JSON.parse(nextRaw) as Partial<AiSettingsState>)
  } catch {
    return createDefaultAiSettings()
  }
}

/** 保存 AI 设置到当前设备 */
export function saveAiSettings(settings: AiSettingsState): void {
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeAiSettings(settings)))
}

/** 创建一个自定义 provider */
export function createCustomAiProvider(label: string, baseURL: string): AiProviderConfig {
  return normalizeCustomProvider({
    id: createAiLocalId('provider'),
    source: 'custom',
    label,
    baseURL,
    models: [],
    selectedModelId: null,
  }) as AiProviderConfig
}

/** 按 id 读取一个 provider */
export function getAiProviderById(
  settings: AiSettingsState,
  providerId: string | null | undefined
): AiProviderConfig | null {
  if (!providerId) return null
  return settings.providers.find((provider) => provider.id === providerId) ?? null
}

/** 判断当前 provider 是否为内置项 */
export function isBuiltInAiProvider(provider: AiProviderConfig): boolean {
  return provider.source === 'builtin'
}

/** 根据 provider 读取对应的预设，只有内置 provider 才会有结果 */
export function getAiProviderPresetForConfig(provider: AiProviderConfig): AiProviderPreset | null {
  if (provider.presetId === null) return null
  return getAiProviderPreset(provider.presetId)
}

/** 更新单个 provider 的局部字段 */
export function patchAiProvider(
  settings: AiSettingsState,
  providerId: string,
  patch: Partial<AiProviderConfig>
): AiSettingsState {
  return normalizeAiSettings({
    ...settings,
    providers: settings.providers.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            ...patch,
          }
        : provider
    ),
  })
}

/** 添加一个自定义 provider */
export function addAiProvider(settings: AiSettingsState, provider: AiProviderConfig): AiSettingsState {
  return normalizeAiSettings({
    ...settings,
    providers: [...settings.providers, provider],
  })
}

/** 删除一个自定义 provider，内置 provider 不允许删除 */
export function removeAiProvider(settings: AiSettingsState, providerId: string): AiSettingsState {
  const provider = getAiProviderById(settings, providerId)
  if (!provider || provider.source === 'builtin') return settings

  const nextProviders = settings.providers.filter((item) => item.id !== providerId)
  const nextActiveProviderId =
    settings.activeProviderId === providerId ? nextProviders[0]?.id ?? null : settings.activeProviderId

  return normalizeAiSettings({
    ...settings,
    activeProviderId: nextActiveProviderId,
    providers: nextProviders,
  })
}

/** 把某个 provider 设为当前聊天默认入口 */
export function setActiveAiProvider(settings: AiSettingsState, providerId: string): AiSettingsState {
  if (!settings.providers.some((provider) => provider.id === providerId)) return settings
  return normalizeAiSettings({
    ...settings,
    activeProviderId: providerId,
  })
}

/** 兼容开发期旧 HMR 模块残留的导入，新代码不再直接使用该名称 */
export function switchAiProviderPreset(
  settings: AiSettingsState,
  providerId: AiBuiltinProviderId
): AiSettingsState {
  return setActiveAiProvider(settings, providerId)
}

/** 为 provider 增加一个模型，已存在则只更新选中状态 */
export function addAiProviderModel(
  settings: AiSettingsState,
  providerId: string,
  modelId: string
): AiSettingsState {
  const normalizedModelId = modelId.trim()
  if (!normalizedModelId) return settings

  const nextProviders = settings.providers.map((provider) => {
    if (provider.id !== providerId) return provider

    const hasModel = provider.models.some((model) => model.id === normalizedModelId)
    const nextModels = hasModel
      ? provider.models
      : [
          ...provider.models,
          {
            id: normalizedModelId,
            label: normalizedModelId,
            addedAt: createNowIso(),
          },
        ]

    return {
      ...provider,
      models: nextModels,
      selectedModelId: normalizedModelId,
    }
  })

  return normalizeAiSettings({
    ...settings,
    activeProviderId: providerId,
    providers: nextProviders,
  })
}

/** 删除 provider 下的一个模型，并在需要时自动回退到剩余首项 */
export function removeAiProviderModel(
  settings: AiSettingsState,
  providerId: string,
  modelId: string
): AiSettingsState {
  return normalizeAiSettings({
    ...settings,
    providers: settings.providers.map((provider) => {
      if (provider.id !== providerId) return provider

      const nextModels = provider.models.filter((model) => model.id !== modelId)
      return {
        ...provider,
        models: nextModels,
        selectedModelId:
          provider.selectedModelId === modelId ? nextModels[0]?.id ?? null : provider.selectedModelId,
      }
    }),
  })
}

/** 选中 provider 下的某个模型，并可选地同步切换当前 provider */
export function selectAiProviderModel(
  settings: AiSettingsState,
  providerId: string,
  modelId: string,
  activateProvider = false
): AiSettingsState {
  const provider = settings.providers.find((item) => item.id === providerId)
  if (!provider || !provider.models.some((model) => model.id === modelId)) return settings

  return normalizeAiSettings({
    ...settings,
    activeProviderId: activateProvider ? providerId : settings.activeProviderId,
    providers: settings.providers.map((item) =>
      item.id === providerId
        ? {
            ...item,
            selectedModelId: modelId,
          }
        : item
    ),
  })
}

/** 解析出当前真正会被聊天请求使用的 provider 与 model */
export function resolveActiveAiRequestSettings(settings: AiSettingsState): AiRequestSettings {
  const activeProvider =
    getAiProviderById(settings, settings.activeProviderId) ?? settings.providers[0] ?? createBuiltInProvider('deepseek')
  const selectedModelId = ensureSelectedModelId(activeProvider.models, activeProvider.selectedModelId) ?? ''

  return {
    providerId: activeProvider.id,
    providerLabel: activeProvider.label,
    apiKey: activeProvider.apiKey,
    baseURL: activeProvider.baseURL,
    model: selectedModelId,
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
  }
}

/** 为指定 vault 构造聊天历史存储键 */
function getAiSessionsStorageKey(vaultPath: string): string {
  return `${AI_SESSIONS_STORAGE_PREFIX}${vaultPath}`
}

/** 生成聊天会话或消息的稳定 id */
function createAiId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 校验一条历史消息是否可用 */
function isValidAiChatMessage(message: unknown): message is AiChatMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<AiChatMessage>
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'string'
  )
}

/** 校验一条历史会话是否可用 */
function isValidAiChatSession(session: unknown): session is AiChatSession {
  if (!session || typeof session !== 'object') return false
  const candidate = session as Partial<AiChatSession>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.vaultPath === 'string' &&
    (candidate.notePath === null || typeof candidate.notePath === 'string') &&
    (candidate.noteTitle === null || typeof candidate.noteTitle === 'string') &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isValidAiChatMessage)
  )
}

/** 从本地历史中读取当前 vault 的聊天会话 */
export function loadAiChatSessions(vaultPath: string): AiChatSession[] {
  const raw = localStorage.getItem(getAiSessionsStorageKey(vaultPath))
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter(isValidAiChatSession)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

/** 保存当前 vault 的聊天会话 */
export function saveAiChatSessions(vaultPath: string, sessions: AiChatSession[]): void {
  localStorage.setItem(getAiSessionsStorageKey(vaultPath), JSON.stringify(sessions))
}

/** 根据首条提问生成会话标题 */
export function createAiSessionTitle(firstPrompt: string, noteTitle: string | null): string {
  const normalizedPrompt = firstPrompt.replace(/\s+/g, ' ').trim()
  if (normalizedPrompt) return normalizedPrompt.slice(0, 28)
  return noteTitle ? `关于《${noteTitle}》` : '新对话'
}

/** 创建一条空聊天会话 */
export function createAiChatSession(
  vaultPath: string,
  notePath: string | null,
  noteTitle: string | null
): AiChatSession {
  const now = new Date().toISOString()
  return {
    id: createAiId(),
    title: '新对话',
    vaultPath,
    notePath,
    noteTitle,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}
