import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Progress } from '@/components/ui/progress'
import type { AiChatMessage, AiTokenUsage } from '@/domain/ai'

/** 把 token 数整理成紧凑文本 */
function formatTokenCount(value: number | undefined): string | null {
  if (value === undefined) return null
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return `${value}`
}

/** 计算 provider prompt cache 命中比例，优先使用 DeepSeek 的 hit/miss 字段 */
function getPromptCacheStats(tokenUsage: AiTokenUsage | undefined): {
  hitTokens: number
  missTokens: number | null
  hitRate: number
} | null {
  if (!tokenUsage) return null

  const hasDeepSeekCache =
    tokenUsage.promptCacheHitTokens !== undefined || tokenUsage.promptCacheMissTokens !== undefined
  if (hasDeepSeekCache) {
    const hitTokens = tokenUsage.promptCacheHitTokens ?? 0
    const missTokens = tokenUsage.promptCacheMissTokens ?? 0
    const totalCacheTokens = hitTokens + missTokens
    if (totalCacheTokens <= 0) return null

    return {
      hitTokens,
      missTokens,
      hitRate: hitTokens / totalCacheTokens,
    }
  }

  if (tokenUsage.promptCachedTokens !== undefined && tokenUsage.promptTokens !== undefined) {
    const hitTokens = tokenUsage.promptCachedTokens
    const missTokens = Math.max(0, tokenUsage.promptTokens - hitTokens)
    if (tokenUsage.promptTokens <= 0) return null

    return {
      hitTokens,
      missTokens,
      hitRate: hitTokens / tokenUsage.promptTokens,
    }
  }

  return null
}

export interface MessageMetaData {
  cacheStats: { hitTokens: number; missTokens: number | null; hitRate: number } | null
  promptTokens: string | null
  completionTokens: string | null
  reasoningTokens: string | null
}

/** 提取 assistant 消息底部所需的结构化数据 */
export function getMessageMetaData(message: AiChatMessage): MessageMetaData {
  const tokenUsage = message.tokenUsage
  return {
    cacheStats: getPromptCacheStats(tokenUsage),
    promptTokens: formatTokenCount(tokenUsage?.promptTokens),
    completionTokens: formatTokenCount(tokenUsage?.completionTokens),
    reasoningTokens: formatTokenCount(tokenUsage?.reasoningTokens),
  }
}

/** 所有用量数据合并在一个胶囊内，各段 hover 显示 shadcn Tooltip */
export function MetaPill({ meta }: { meta: MessageMetaData }) {
  const { cacheStats, promptTokens, completionTokens, reasoningTokens } = meta
  const pct = cacheStats ? Math.round(cacheStats.hitRate * 100) : null
  const hitFmt = cacheStats ? (formatTokenCount(cacheStats.hitTokens) ?? '') : ''
  const missFmt = cacheStats?.missTokens != null ? (formatTokenCount(cacheStats.missTokens) ?? '') : null

  return (
    <span className="ai-meta-pill">
      {cacheStats && pct !== null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ai-meta-seg ai-meta-seg--cache">
              <Progress value={pct} className="ai-meta-progress" />
              <span className="ai-meta-cache-pct">{pct}%</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            缓存命中率：已命中 {hitFmt} token{missFmt ? `，未命中 ${missFmt} token` : ''}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {(promptTokens || completionTokens || reasoningTokens) ? (
        <>
          {cacheStats ? <span className="ai-meta-divider" aria-hidden="true" /> : null}
          <span className="ai-meta-seg--tokens">
          {promptTokens ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ai-meta-token-item">
                  <span className="ai-meta-sym">↑</span>
                  <span className="ai-meta-val">{promptTokens}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>输入 token：发送给模型的提示词长度</TooltipContent>
            </Tooltip>
          ) : null}
          {completionTokens ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ai-meta-token-item ai-meta-token-item--out">
                  <span className="ai-meta-sym">↓</span>
                  <span className="ai-meta-val">{completionTokens}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>输出 token：模型生成的回复长度</TooltipContent>
            </Tooltip>
          ) : null}
          {reasoningTokens ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ai-meta-token-item">
                  <span className="ai-meta-sym">◈</span>
                  <span className="ai-meta-val">{reasoningTokens}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>推理 token：模型内部思考消耗的 token</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        </>
      ) : null}
    </span>
  )
}
