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

/** 判断当前是否运行在 Tauri WebView 内 */
export function canUseSearchApiProxy(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === 'object'
  )
}

/** 通过 Tauri 后端调用搜索 API，避免 WebView CORS 限制 */
export async function postSearchApiJson(request: SearchApiPostJsonRequest): Promise<SearchApiPostJsonResult> {
  return await invoke<SearchApiPostJsonResult>('search_api_post_json', { request })
}
