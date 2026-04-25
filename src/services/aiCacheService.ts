import { ensureDir, readFile, writeFile } from '../tauri/fs'
import { MIRA_DIR, joinRelativePath } from './pathUtils'

const AI_CACHE_DIR = joinRelativePath(MIRA_DIR, 'cache', 'llm')

export interface AiCacheEntry {
  assistantMessage: string
  createdAt: string
}

/** 计算稳定哈希，用于生成缓存 key */
export async function createAiCacheKey(payload: unknown): Promise<string> {
  // 1. 先把 payload 规范化为稳定 JSON 字符串
  const normalized = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(normalized)

  // 2. 再用浏览器内置 SHA-256 生成跨平台可复用 key
  const buffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 确保 AI 缓存目录存在，并返回绝对目录路径 */
async function ensureAiCacheDir(vaultPath: string): Promise<string> {
  const cacheDir = `${vaultPath}/${AI_CACHE_DIR}`
  await ensureDir(cacheDir)
  return cacheDir
}

/** 读取某个缓存 key 对应的 AI 返回 */
export async function readAiCacheEntry(vaultPath: string, cacheKey: string): Promise<AiCacheEntry | null> {
  const cacheFilePath = `${vaultPath}/${AI_CACHE_DIR}/${cacheKey}.json`
  const raw = await readFile(cacheFilePath)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<AiCacheEntry>
    if (typeof parsed.assistantMessage !== 'string' || typeof parsed.createdAt !== 'string') {
      return null
    }
    return {
      assistantMessage: parsed.assistantMessage,
      createdAt: parsed.createdAt,
    }
  } catch {
    return null
  }
}

/** 写入 AI 返回缓存 */
export async function writeAiCacheEntry(
  vaultPath: string,
  cacheKey: string,
  entry: AiCacheEntry
): Promise<void> {
  const cacheDir = await ensureAiCacheDir(vaultPath)
  await writeFile(`${cacheDir}/${cacheKey}.json`, JSON.stringify(entry, null, 2))
}
