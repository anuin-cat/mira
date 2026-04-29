import type { AiTextReference } from '../../domain/ai'

export interface AiReferencePreview {
  index?: number
  title: string
  path: string
  startLine: number
  endLine: number
  content: string
}

export interface AiUserMessageReference extends AiReferencePreview {
  index: number
}

export interface ParsedAiUserMessageReferences {
  references: AiUserMessageReference[]
  question: string
}

const AI_REFERENCE_SECTION_TITLE = '引用：'
const AI_USER_QUESTION_TITLE = '用户问题：'
const AI_REFERENCE_START_PATTERN = /^<mira-reference index="(\d+)">$/
const AI_REFERENCE_END_MARKER = '</mira-reference>'
const TITLE_PREFIX = '标题：'
const PATH_PREFIX = '路径：'
const LINE_RANGE_PREFIX = '行号：'
const CONTENT_PREFIX = '内容：'

/** 统一换行，避免不同平台的换行符影响解析 */
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

/** 格式化引用行号范围 */
export function formatAiReferenceLineRange(reference: Pick<AiReferencePreview, 'startLine' | 'endLine'>): string {
  return `L${reference.startLine}-L${reference.endLine}`
}

/** 格式化引用胶囊标签 */
export function formatAiReferenceLabel(reference: Pick<AiReferencePreview, 'title' | 'startLine' | 'endLine'>): string {
  return `${reference.title}：${formatAiReferenceLineRange(reference)}`
}

/** 从元信息行里读取指定前缀的值 */
function readMetadataValue(lines: string[], prefix: string): string {
  return lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? ''
}

/** 从 L1-L3 这类文本中解析行号范围 */
function parseLineRange(value: string): { startLine: number; endLine: number } {
  const match = value.match(/L(\d+)-L(\d+)/)
  if (!match) return { startLine: 1, endLine: 1 }

  const startLine = Number.parseInt(match[1], 10)
  const endLine = Number.parseInt(match[2], 10)
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
    return { startLine: 1, endLine: 1 }
  }

  return {
    startLine: Math.max(1, startLine),
    endLine: Math.max(Math.max(1, startLine), endLine),
  }
}

/** 从旧版“标题：L1-L3”标签中拆出标题和行号 */
function parseLegacyReferenceLabel(label: string): Pick<AiUserMessageReference, 'title' | 'startLine' | 'endLine'> {
  const match = label.match(/^(.*)[：:]\s*(L\d+-L\d+)$/)
  if (!match) return { title: label.trim() || '引用', startLine: 1, endLine: 1 }

  return {
    title: match[1].trim() || '引用',
    ...parseLineRange(match[2]),
  }
}

/** 把单个带标记的引用块解析为可展示结构 */
function parseMarkedReferenceBlock(index: number, blockLines: string[]): AiUserMessageReference | null {
  const contentLineIndex = blockLines.findIndex((line) => line === CONTENT_PREFIX)
  if (contentLineIndex === -1) return null

  const metadataLines = blockLines.slice(0, contentLineIndex)
  const title = readMetadataValue(metadataLines, TITLE_PREFIX) || '引用'
  const path = readMetadataValue(metadataLines, PATH_PREFIX)
  const lineRange = parseLineRange(readMetadataValue(metadataLines, LINE_RANGE_PREFIX))
  const content = blockLines.slice(contentLineIndex + 1).join('\n').trim()

  return {
    index,
    title,
    path,
    startLine: lineRange.startLine,
    endLine: lineRange.endLine,
    content,
  }
}

/** 解析新版带 mira-reference 标记的引用区块 */
function parseMarkedReferences(referenceSection: string): AiUserMessageReference[] {
  const lines = referenceSection.split('\n')
  const references: AiUserMessageReference[] = []
  let cursor = 0

  while (cursor < lines.length) {
    const startMatch = lines[cursor].trim().match(AI_REFERENCE_START_PATTERN)
    if (!startMatch) {
      cursor += 1
      continue
    }

    const referenceIndex = Number.parseInt(startMatch[1], 10)
    const blockLines: string[] = []
    cursor += 1

    while (cursor < lines.length && lines[cursor].trim() !== AI_REFERENCE_END_MARKER) {
      blockLines.push(lines[cursor])
      cursor += 1
    }

    if (cursor < lines.length && Number.isFinite(referenceIndex)) {
      const reference = parseMarkedReferenceBlock(referenceIndex, blockLines)
      if (reference) references.push(reference)
    }
    cursor += 1
  }

  return references
}

/** 解析旧版未打标记的引用区块，保证已有聊天历史也能美化展示 */
function parseLegacyReferences(referenceSection: string): AiUserMessageReference[] {
  const references: AiUserMessageReference[] = []
  const legacyBlockPattern = /^\[(\d+)]\s+(.+)\n路径：([^\n]*)\n内容：\n([\s\S]*?)(?=\n\n\[\d+]\s+.+\n路径：|\s*$)/gm
  let match: RegExpExecArray | null = legacyBlockPattern.exec(referenceSection)

  while (match) {
    const index = Number.parseInt(match[1], 10)
    const label = parseLegacyReferenceLabel(match[2])
    references.push({
      index,
      title: label.title,
      path: match[3].trim(),
      startLine: label.startLine,
      endLine: label.endLine,
      content: match[4].trim(),
    })
    match = legacyBlockPattern.exec(referenceSection)
  }

  return references
}

/** 将引用和问题组装为实际发送给模型、并保存进历史的纯文本 */
export function serializeAiUserReferencePrompt(references: AiTextReference[], userQuestion: string): string {
  const referenceText = references
    .map((reference, index) => {
      const content = reference.content.trim() || '(空白)'
      return [
        `<mira-reference index="${index + 1}">`,
        `${TITLE_PREFIX}${reference.title}`,
        `${PATH_PREFIX}${reference.path}`,
        `${LINE_RANGE_PREFIX}${formatAiReferenceLineRange(reference)}`,
        CONTENT_PREFIX,
        content,
        AI_REFERENCE_END_MARKER,
      ].join('\n')
    })
    .join('\n\n')
  const fallbackQuestion = references.map((_, index) => `[${index + 1}]`).join(' ')

  return [
    AI_REFERENCE_SECTION_TITLE,
    referenceText,
    AI_USER_QUESTION_TITLE,
    userQuestion || fallbackQuestion,
  ].join('\n\n')
}

/** 解析用户消息中的引用纯文本；无法识别时返回 null，让 UI 退回普通文本 */
export function parseAiUserMessageReferences(content: string): ParsedAiUserMessageReferences | null {
  const normalizedContent = normalizeLineEndings(content).trim()
  if (!normalizedContent.startsWith(AI_REFERENCE_SECTION_TITLE)) return null

  const questionMarker = `\n\n${AI_USER_QUESTION_TITLE}`
  const questionMarkerIndex = normalizedContent.lastIndexOf(questionMarker)
  if (questionMarkerIndex === -1) return null

  const referenceSection = normalizedContent
    .slice(AI_REFERENCE_SECTION_TITLE.length, questionMarkerIndex)
    .trim()
  const rawQuestion = normalizedContent
    .slice(questionMarkerIndex + questionMarker.length)
    .trim()
  const question = rawQuestion.startsWith('\n') ? rawQuestion.trimStart() : rawQuestion
  const references = parseMarkedReferences(referenceSection)
  const fallbackReferences = references.length > 0 ? references : parseLegacyReferences(referenceSection)

  if (fallbackReferences.length === 0) return null
  return {
    references: fallbackReferences.sort((a, b) => a.index - b.index),
    question,
  }
}
