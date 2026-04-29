import { invoke } from '@tauri-apps/api/core'

export interface WebFetchRequest {
  url: string
  maxBytes?: number
}

export interface WebFetchResult {
  finalUrl: string
  status: number
  contentType: string | null
  html: string
  bytesRead: number
  isTruncated: boolean
}

/** 通过 Tauri 后端读取公开网页 HTML，避免 WebView CORS 限制 */
export async function fetchWebUrl(request: WebFetchRequest): Promise<WebFetchResult> {
  return await invoke<WebFetchResult>('web_fetch_url', { request })
}
