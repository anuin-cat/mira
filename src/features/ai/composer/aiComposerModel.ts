import type { AiTextReference } from '@/domain/ai'
import { serializeAiUserReferencePrompt } from '../references/aiReferenceText'

export type AiComposerPart =
  | {
      id: string
      type: 'text'
      text: string
    }
  | {
      id: string
      type: 'reference'
      reference: AiTextReference
    }

/** 生成 composer 内部片段 id */
function createComposerPartId(prefix: string) {
  return typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 创建文本片段 */
export function createAiComposerTextPart(text: string): AiComposerPart {
  return {
    id: createComposerPartId('text'),
    type: 'text',
    text,
  }
}

/** 创建引用片段 */
export function createAiComposerReferencePart(reference: AiTextReference): AiComposerPart {
  return {
    id: createComposerPartId('ref'),
    type: 'reference',
    reference,
  }
}

/** 合并相邻文本片段，并移除空文本片段 */
export function normalizeAiComposerParts(parts: AiComposerPart[]): AiComposerPart[] {
  const normalizedParts: AiComposerPart[] = []

  parts.forEach((part) => {
    if (part.type === 'reference') {
      normalizedParts.push(part)
      return
    }

    if (!part.text) return
    const previousPart = normalizedParts[normalizedParts.length - 1]
    if (previousPart?.type === 'text') {
      previousPart.text += part.text
      return
    }
    normalizedParts.push(part)
  })

  return normalizedParts
}

/** 判断 composer 是否有可发送内容 */
export function hasAiComposerContent(parts: AiComposerPart[]): boolean {
  return parts.some((part) => (part.type === 'reference' ? true : part.text.trim().length > 0))
}

/** 将混排输入组装为实际发送给模型的用户消息 */
export function buildAiUserPrompt(parts: AiComposerPart[]): string {
  const normalizedParts = normalizeAiComposerParts(parts)
  const references: AiTextReference[] = []
  const questionParts: string[] = []

  normalizedParts.forEach((part) => {
    if (part.type === 'text') {
      questionParts.push(part.text)
      return
    }

    references.push(part.reference)
    questionParts.push(`[${references.length}]`)
  })

  const userQuestion = questionParts.join('').trim()
  if (references.length === 0) return userQuestion

  return serializeAiUserReferencePrompt(references, userQuestion)
}
