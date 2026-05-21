import { realmPlugin, syntaxExtensions$ } from '@mdxeditor/editor'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'

interface MicromarkConstruct {
  name?: string
}

interface MicromarkSyntaxExtensionShape {
  attentionMarkers?: {
    null?: number[]
  }
  insideSpan?: {
    null?: MicromarkConstruct[]
  }
  text?: Record<string, MicromarkConstruct>
}

/** 判断当前语法扩展是否为 MDXEditor 默认注入的删除线扩展 */
function isDefaultStrikethroughSyntaxExtension(extension: unknown): extension is MicromarkSyntaxExtensionShape {
  // 1. 先校验基础结构，避免读取到其它扩展时误判
  if (!extension || typeof extension !== 'object') return false

  const candidate = extension as MicromarkSyntaxExtensionShape
  const hasTildeTokenizer = candidate.text?.['126']?.name === 'strikethrough'
  const hasInlineResolver = candidate.insideSpan?.null?.some((construct) => construct.name === 'strikethrough') ?? false
  const hasTildeMarker = candidate.attentionMarkers?.null?.includes(126) ?? false

  // 2. 三个特征同时满足时，基本可以确认就是 GFM 删除线扩展
  return hasTildeTokenizer && hasInlineResolver && hasTildeMarker
}

/** 用 singleTilde=false 替换默认删除线扩展，避免普通文本里的单个 ~ 被当成删除线 */
function replaceSingleTildeBehavior<TExtension>(currentExtensions: TExtension[]) {
  // 1. 记录默认删除线扩展出现的位置，尽量保持其余扩展顺序稳定
  const firstMatchIndex = currentExtensions.findIndex((extension) => isDefaultStrikethroughSyntaxExtension(extension))
  const filteredExtensions = currentExtensions.filter((extension) => !isDefaultStrikethroughSyntaxExtension(extension))
  const strictStrikethroughExtension = gfmStrikethrough({ singleTilde: false }) as TExtension

  // 2. 若找到默认扩展，则原位替换；否则补上一份严格模式扩展
  if (firstMatchIndex === -1) return [...filteredExtensions, strictStrikethroughExtension]

  return [
    ...filteredExtensions.slice(0, firstMatchIndex),
    strictStrikethroughExtension,
    ...filteredExtensions.slice(firstMatchIndex),
  ]
}

/** 修正 MDXEditor 默认的单个 ~ 删除线解析 */
export const singleTildeStrikethroughPlugin = realmPlugin({
  init(realm) {
    // 1. 读取 corePlugin 已注册的语法扩展
    const currentExtensions = realm.getValue(syntaxExtensions$)

    // 2. 用 singleTilde=false 的官方扩展替换默认实现
    realm.pub(syntaxExtensions$, replaceSingleTildeBehavior(currentExtensions))
  },
})
