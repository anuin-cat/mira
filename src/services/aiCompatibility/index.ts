import type { AiCompatibilityMode } from '../../domain/ai'
import { deepSeekCompatibility } from './deepseek'
import { kimiCompatibility } from './kimi'
import { openAiCompatibility } from './openai'
import { siliconFlowCompatibility } from './siliconflow'
import type { AiCompatibilityAdapter, AiProviderIdentity } from './types'

const COMPATIBILITY_BY_MODE: Record<AiCompatibilityMode, AiCompatibilityAdapter> = {
  openai: openAiCompatibility,
  deepseek: deepSeekCompatibility,
  kimi: kimiCompatibility,
  siliconflow: siliconFlowCompatibility,
}

/** 读取指定 provider 的兼容适配器 */
export function getAiCompatibilityAdapter(mode: AiCompatibilityMode): AiCompatibilityAdapter {
  return COMPATIBILITY_BY_MODE[mode] ?? openAiCompatibility
}

/** 按 provider 身份信息判断需要启用哪套兼容逻辑 */
export function resolveAiCompatibilityMode(identity: AiProviderIdentity): AiCompatibilityMode {
  // 1. 内置 provider 优先按 preset 明确分流，避免互相误判
  if (identity.presetId === 'deepseek') return 'deepseek'
  if (identity.presetId === 'kimi') return 'kimi'
  if (identity.presetId === 'siliconflow') return 'siliconflow'

  // 2. 自定义 provider 只做轻量识别；未命中时保持普通 OpenAI 兼容格式
  const markers = [
    identity.id,
    identity.label,
    identity.baseURL,
    identity.model,
  ].map((value) => value.toLowerCase())

  if (markers.some((value) => value.includes('deepseek'))) return 'deepseek'
  if (markers.some((value) => value.includes('moonshot') || value.includes('kimi'))) return 'kimi'
  if (markers.some((value) => value.includes('siliconflow'))) return 'siliconflow'
  return 'openai'
}

export type { AiCompatibilityAdapter }
