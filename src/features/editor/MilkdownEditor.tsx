import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { commonmark } from '@milkdown/preset-commonmark'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { history } from '@milkdown/plugin-history'
import type { ReactNode } from 'react'

interface Props {
  initialContent: string
  onChange: (markdown: string) => void
  titleSlot?: ReactNode
}

/** 内部编辑器（需嵌套在 MilkdownProvider 内） */
function EditorInner({ initialContent, onChange, titleSlot }: Props) {
  useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, initialContent)
        // 内容变化时通知父组件
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onChange(markdown)
        })
      })
      .use(commonmark)
      .use(listener)
      .use(history)
  )

  return (
    <>
      {titleSlot}
      <Milkdown />
    </>
  )
}

/** Milkdown 富文本 Markdown 编辑器，输入输出均为原生 .md 格式 */
export function MilkdownEditor({ initialContent, onChange, titleSlot }: Props) {
  return (
    <div className="milkdown-wrapper">
      <MilkdownProvider>
        <EditorInner initialContent={initialContent} onChange={onChange} titleSlot={titleSlot} />
      </MilkdownProvider>
    </div>
  )
}
