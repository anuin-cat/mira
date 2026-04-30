import type { ReactNode } from 'react'
import {
  parseAiUserMessageReferences,
  type AiUserMessageReference,
} from '../references/aiReferenceText'
import { AiReferencePill } from '../references/AiReferencePill'
import './ai-message.css'

interface Props {
  content: string
}

/** 按编号建立引用索引，方便把问题里的 [1] 替换为胶囊 */
function createReferenceMap(references: AiUserMessageReference[]): Map<number, AiUserMessageReference> {
  return new Map(references.map((reference) => [reference.index, reference]))
}

/** 把用户问题中的 [1] 这类引用占位符替换成可悬浮胶囊 */
function renderQuestionContent(question: string, referenceMap: Map<number, AiUserMessageReference>): ReactNode[] {
  const nodes: ReactNode[] = []
  const referencePattern = /\[(\d+)]/g
  let cursor = 0
  let match: RegExpExecArray | null = referencePattern.exec(question)

  while (match) {
    if (match.index > cursor) nodes.push(question.slice(cursor, match.index))

    const referenceIndex = Number.parseInt(match[1], 10)
    const reference = referenceMap.get(referenceIndex)
    nodes.push(
      reference ? (
        <AiReferencePill key={`${match.index}-${referenceIndex}`} reference={reference} />
      ) : (
        match[0]
      )
    )

    cursor = match.index + match[0].length
    match = referencePattern.exec(question)
  }

  if (cursor < question.length) nodes.push(question.slice(cursor))
  return nodes
}

/** 用户消息展示：引用纯文本保存不变，只在 UI 中渲染成引用胶囊 */
export function AiUserMessage({ content }: Props) {
  const parsedMessage = parseAiUserMessageReferences(content)
  if (!parsedMessage) {
    return (
      <div className="ai-message-content">
        <div className="ai-message-plain-text">{content}</div>
      </div>
    )
  }

  const referenceMap = createReferenceMap(parsedMessage.references)

  return (
    <div className="ai-message-content ai-user-message-content">
      {parsedMessage.question ? renderQuestionContent(parsedMessage.question, referenceMap) : null}
    </div>
  )
}
