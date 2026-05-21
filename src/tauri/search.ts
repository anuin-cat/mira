import { invoke } from '@tauri-apps/api/core'
import type { AiSearchProviderId } from '@/domain/ai'

export interface SearchApiPostJsonRequest {
  providerId: AiSearchProviderId
  apiKey: string
  body: unknown
}

export interface SearchApiPostJsonResult {
  status: number
  body: unknown
}

/** 通过 Tauri 后端调用搜索 API，避免 WebView CORS 限制 */
export async function postSearchApiJson(request: SearchApiPostJsonRequest): Promise<SearchApiPostJsonResult> {
  return await invoke<SearchApiPostJsonResult>('search_api_post_json', { request })
}
