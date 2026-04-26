import type { AiModelCatalogItem } from '../domain/ai'

interface FetchAiModelCatalogOptions {
  baseURL: string
  apiKey: string
}

/** 统一整理模型接口地址，避免出现双斜杠 */
function buildModelsEndpoint(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

/** 把任意字符串转成适合模糊匹配的形式 */
function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[\s\-_.:/]+/g, '')
}

/** 提取 models 响应体中的 id 字段，并去重排序 */
function extractModelCatalogItems(payload: unknown): AiModelCatalogItem[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown[] }).data)) {
    return []
  }

  const modelMap = new Map<string, AiModelCatalogItem>()
  ;(payload as { data: unknown[] }).data.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const candidate = item as { id?: unknown; owned_by?: unknown }
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) return

    const modelId = candidate.id.trim()
    modelMap.set(modelId, {
      id: modelId,
      label: modelId,
      ownedBy: typeof candidate.owned_by === 'string' ? candidate.owned_by : null,
    })
  })

  return [...modelMap.values()].sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN'))
}

/** 尝试从错误响应里取出更可读的信息 */
async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string }; message?: string }
    const message = payload.error?.message ?? payload.message
    if (typeof message === 'string' && message.trim()) return message.trim()
  } catch {
    // ignore
  }

  return `获取模型列表失败（${response.status}）`
}

/** 通过 OpenAI 兼容的 models 接口拉取 provider 的模型列表 */
export async function fetchAiModelCatalog(
  options: FetchAiModelCatalogOptions
): Promise<AiModelCatalogItem[]> {
  // 1. 先校验 provider 关键配置，避免打出无效请求
  const baseURL = options.baseURL.trim().replace(/\/+$/, '')
  const apiKey = options.apiKey.trim()
  if (!baseURL) throw new Error('请先填写 Base URL')
  if (!apiKey) throw new Error('请先填写 API Key')

  // 2. 请求 models 接口，并尽量返回服务端原始错误
  const response = await fetch(buildModelsEndpoint(baseURL), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })
  if (!response.ok) throw new Error(await extractErrorMessage(response))

  // 3. 提取模型 id 列表；接口为空时也返回空数组而不是抛错
  return extractModelCatalogItems((await response.json()) as unknown)
}

/** 计算 query 对某个模型名的匹配分数，分数越高越靠前 */
export function scoreAiModelMatch(modelId: string, query: string): number {
  const trimmedQuery = query.trim().toLowerCase()
  if (!trimmedQuery) return 0

  const source = modelId.toLowerCase()
  const normalizedSource = normalizeSearchText(modelId)
  const normalizedQuery = normalizeSearchText(trimmedQuery)
  if (!normalizedQuery) return 0

  if (source === trimmedQuery) return 5000
  if (normalizedSource === normalizedQuery) return 4700

  if (source.startsWith(trimmedQuery)) return 4200 - Math.max(0, modelId.length - query.length)
  if (normalizedSource.startsWith(normalizedQuery)) {
    return 4000 - Math.max(0, normalizedSource.length - normalizedQuery.length)
  }

  const containsIndex = source.indexOf(trimmedQuery)
  if (containsIndex >= 0) return 3400 - containsIndex * 12 - Math.max(0, source.length - trimmedQuery.length)

  const normalizedContainsIndex = normalizedSource.indexOf(normalizedQuery)
  if (normalizedContainsIndex >= 0) {
    return (
      3000 -
      normalizedContainsIndex * 10 -
      Math.max(0, normalizedSource.length - normalizedQuery.length)
    )
  }

  let queryIndex = 0
  let gapPenalty = 0
  let lastMatchedIndex = -1

  for (let sourceIndex = 0; sourceIndex < normalizedSource.length; sourceIndex += 1) {
    if (normalizedSource[sourceIndex] !== normalizedQuery[queryIndex]) continue

    if (lastMatchedIndex >= 0) gapPenalty += sourceIndex - lastMatchedIndex - 1
    lastMatchedIndex = sourceIndex
    queryIndex += 1
    if (queryIndex === normalizedQuery.length) break
  }

  if (queryIndex !== normalizedQuery.length) return Number.NEGATIVE_INFINITY
  return 2200 - gapPenalty * 8 - Math.max(0, normalizedSource.length - normalizedQuery.length)
}

/** 按查询词对模型列表做模糊匹配排序；空查询时按字典序返回 */
export function sortAiModelCatalog(
  models: AiModelCatalogItem[],
  query: string
): AiModelCatalogItem[] {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return [...models].sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN'))

  return [...models]
    .map((model) => ({
      model,
      score: scoreAiModelMatch(model.id, trimmedQuery),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.model.id.length !== b.model.id.length) return a.model.id.length - b.model.id.length
      return a.model.id.localeCompare(b.model.id, 'zh-Hans-CN')
    })
    .map((entry) => entry.model)
}
