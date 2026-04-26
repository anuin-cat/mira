import type {
  AiChatMessage,
  AiChatSession,
  AiProviderId,
  AiProviderPreset,
  AiProviderSettings,
} from '../domain/ai'

const AI_SETTINGS_STORAGE_KEY = 'mira:ai:settings:v1'
const AI_SESSIONS_STORAGE_PREFIX = 'mira:ai:sessions:'
const DEFAULT_SYSTEM_PROMPT =
  '你是 Mira 的本地笔记陪伴助手。请结合当前笔记内容，用中文给出清晰、温和、务实的回答。若信息不足，请明确说明，不要编造事实。'

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
    id: 'modelscope',
    label: '魔搭',
    defaultBaseUrl: 'https://api-inference.modelscope.cn/v1',
    defaultModel: 'Qwen/Qwen3-32B',
    apiKeyPlaceholder: 'ms-...',
  },
  {
    id: 'custom',
    label: '自定义兼容接口',
    defaultBaseUrl: 'https://api.example.com/v1',
    defaultModel: '',
    apiKeyPlaceholder: '输入你的 API Key',
  },
]

/** 根据 provider id 读取预设，不存在时回退到 DeepSeek */
export function getAiProviderPreset(providerId: AiProviderId): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === providerId) ?? AI_PROVIDER_PRESETS[0]
}

/** 创建默认 AI 设置 */
export function createDefaultAiSettings(providerId: AiProviderId = 'deepseek'): AiProviderSettings {
  const preset = getAiProviderPreset(providerId)
  return {
    providerId: preset.id,
    apiKey: '',
    baseURL: preset.defaultBaseUrl,
    model: preset.defaultModel,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
  }
}

/** 归一化温度值，避免异常输入破坏请求 */
function normalizeTemperature(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.7
  return Math.min(1.5, Math.max(0, Math.round(value * 10) / 10))
}

/** 把外部输入整理成合法的 AI 设置 */
export function normalizeAiSettings(input: Partial<AiProviderSettings> | null | undefined): AiProviderSettings {
  const providerId = input?.providerId && getAiProviderPreset(input.providerId).id
  const defaults = createDefaultAiSettings(providerId ?? 'deepseek')

  return {
    providerId: defaults.providerId,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey.trim() : defaults.apiKey,
    baseURL:
      typeof input?.baseURL === 'string' && input.baseURL.trim()
        ? input.baseURL.trim().replace(/\/$/, '')
        : defaults.baseURL,
    model: typeof input?.model === 'string' ? input.model.trim() : defaults.model,
    systemPrompt:
      typeof input?.systemPrompt === 'string' && input.systemPrompt.trim()
        ? input.systemPrompt.trim()
        : defaults.systemPrompt,
    temperature: normalizeTemperature(input?.temperature),
  }
}

/** 从 localStorage 读取 AI 设置 */
export function loadAiSettings(): AiProviderSettings {
  const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
  if (!raw) return createDefaultAiSettings()

  try {
    return normalizeAiSettings(JSON.parse(raw) as Partial<AiProviderSettings>)
  } catch {
    return createDefaultAiSettings()
  }
}

/** 保存 AI 设置到当前设备 */
export function saveAiSettings(settings: AiProviderSettings): void {
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeAiSettings(settings)))
}

/** 切换提供商预设，并尽量保留用户手动修改过的设置 */
export function switchAiProviderPreset(
  settings: AiProviderSettings,
  providerId: AiProviderId
): AiProviderSettings {
  // 1. 判断当前 baseURL / model 是否仍是旧预设值
  const previousPreset = getAiProviderPreset(settings.providerId)
  const nextPreset = getAiProviderPreset(providerId)
  const shouldReplaceBaseUrl = settings.baseURL === previousPreset.defaultBaseUrl
  const shouldReplaceModel = !settings.model || settings.model === previousPreset.defaultModel

  // 2. 只覆盖没有被用户手动改过的字段，避免快速切换时丢失自定义配置
  return normalizeAiSettings({
    ...settings,
    providerId,
    baseURL: shouldReplaceBaseUrl ? nextPreset.defaultBaseUrl : settings.baseURL,
    model: shouldReplaceModel ? nextPreset.defaultModel : settings.model,
  })
}

/** 直接选中一个提供商预设，用于紧凑模型选择器 */
export function selectAiProviderPreset(
  settings: AiProviderSettings,
  providerId: AiProviderId
): AiProviderSettings {
  // 1. 读取目标预设，明确使用该预设的 baseURL 与默认模型
  const preset = getAiProviderPreset(providerId)

  // 2. 保留 API Key、系统提示词等个人设置，只切换请求入口和模型
  return normalizeAiSettings({
    ...settings,
    providerId,
    baseURL: preset.defaultBaseUrl,
    model: preset.defaultModel,
  })
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
