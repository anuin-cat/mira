import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CHECK_LIST,
  CODE,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  UNORDERED_LIST,
  type ElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from '@lexical/markdown'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from '@lexical/react/LexicalHorizontalRuleNode'
import { $createHeadingNode, $isHeadingNode, HeadingNode } from '@lexical/rich-text'
import {
  $createCodeBlockNode,
  CodeBlockNode,
  activePlugins$,
  addComposerChild$,
  addNestedEditorChild$,
  allowedHeadingLevels$,
  realmPlugin,
} from '@mdxeditor/editor'
import { $createMiraMathNode, $isMiraMathNode, MiraMathNode } from '../math/mdxMathPlugin'
import { createInlineMathCaretMarker } from '../math/inlineMathCaret'

const LIST_TRANSFORMERS = new Set<Transformer>([ORDERED_LIST, UNORDERED_LIST, CHECK_LIST])

/** 创建块级 Markdown 快捷替换器 */
function createBlockNode(createNode: (match: string[]) => ReturnType<typeof $createHeadingNode>): ElementTransformer['replace'] {
  return (parentNode, children, match) => {
    const node = createNode(match)
    node.append(...children)
    parentNode.replace(node)
    node.select(0, 0)
  }
}

const THEMATIC_BREAK: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '***' : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const line = $createHorizontalRuleNode()
    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(line)
    } else {
      parentNode.insertBefore(line)
    }
    line.selectNext()
  },
  type: 'element',
}

const INLINE_MATH: TextMatchTransformer = {
  dependencies: [MiraMathNode],
  export: (node) => {
    if (!$isMiraMathNode(node) || !node.isInline()) return null
    return `$${node.getValue()}$`
  },
  importRegExp: /(^|[^$])\$((?:\\.|[^$\n])+)\$/,
  regExp: /(^|[^$])\$((?:\\.|[^$\n])+)\$$/,
  replace: (textNode, match) => {
    const prefix = match[1]
    const mathNode = $createMiraMathNode(match[2], 'inline')
    if (!prefix) {
      textNode.replace(mathNode)
      mathNode.insertBefore(createInlineMathCaretMarker())
      mathNode.insertAfter(createInlineMathCaretMarker())
      return
    }

    textNode.setTextContent(prefix)
    textNode.insertAfter(mathNode)
    mathNode.insertBefore(createInlineMathCaretMarker())
    mathNode.insertAfter(createInlineMathCaretMarker())
  },
  trigger: '$',
  type: 'text-match',
}

const BLOCK_MATH: ElementTransformer = {
  dependencies: [MiraMathNode],
  export: (node) => {
    if (!$isMiraMathNode(node) || node.isInline()) return null
    return `$$\n${node.getValue()}\n$$`
  },
  regExp: /^\$\$\s?$/,
  replace: (parentNode) => {
    const mathNode = $createMiraMathNode('', 'block')
    parentNode.selectPrevious()
    parentNode.replace(mathNode)
    window.setTimeout(() => mathNode.select(), 80)
  },
  type: 'element',
}

/** 根据已启用的 MDXEditor 插件生成主编辑区 Markdown 快捷输入规则 */
function pickTransformersForActivePlugins(pluginIds: string[], allowedHeadingLevels: readonly number[]) {
  const transformers: Transformer[] = [
    BOLD_ITALIC_STAR,
    BOLD_ITALIC_UNDERSCORE,
    BOLD_STAR,
    BOLD_UNDERSCORE,
    INLINE_CODE,
    ITALIC_STAR,
    ITALIC_UNDERSCORE,
  ]

  if (pluginIds.includes('headings')) {
    const minHeadingLevel = Math.min(...allowedHeadingLevels)
    const maxHeadingLevel = Math.max(...allowedHeadingLevels)
    transformers.push({
      dependencies: [HeadingNode],
      export: (node, exportChildren) => {
        if (!$isHeadingNode(node)) return null
        const level = Number(node.getTag().slice(1))
        return '#'.repeat(level) + ' ' + exportChildren(node)
      },
      regExp: new RegExp(`^(#{${minHeadingLevel},${maxHeadingLevel}})\\s`),
      replace: createBlockNode((match) => {
        const headingTag = `h${match[1].length}` as Parameters<typeof $createHeadingNode>[0]
        return $createHeadingNode(headingTag)
      }),
      type: 'element',
    })
  }

  if (pluginIds.includes('thematicBreak')) transformers.push(THEMATIC_BREAK)
  if (pluginIds.includes('quote')) transformers.push(QUOTE)
  if (pluginIds.includes('link')) transformers.push(LINK)
  if (pluginIds.includes('lists')) transformers.push(ORDERED_LIST, UNORDERED_LIST, CHECK_LIST)
  if (pluginIds.includes('math')) transformers.push(INLINE_MATH, BLOCK_MATH)
  if (pluginIds.includes('codeblock')) {
    const codeTransformer: typeof CODE = {
      ...CODE,
      dependencies: [CodeBlockNode],
      replace: (parentNode, _children, match) => {
        const codeBlockNode = $createCodeBlockNode({ code: '', language: match[1] ?? '', meta: '' })
        parentNode.selectPrevious()
        parentNode.replace(codeBlockNode)
        window.setTimeout(() => codeBlockNode.select(), 80)
      },
    }
    transformers.push(codeTransformer)
  }

  return transformers
}

/** Mira 版 Markdown 快捷输入：不注入表格单元格，避免中文 IME 输入路径卡顿 */
export const miraMarkdownShortcutPlugin = realmPlugin({
  init(realm) {
    const pluginIds = realm.getValue(activePlugins$)
    const allowedHeadingLevels = pluginIds.includes('headings') ? realm.getValue(allowedHeadingLevels$) : []
    const transformers = pickTransformersForActivePlugins(pluginIds, allowedHeadingLevels)
    const nestedTransformers = transformers.filter((transformer) => !LIST_TRANSFORMERS.has(transformer))

    realm.pubIn({
      [addComposerChild$]: () => <MarkdownShortcutPlugin transformers={transformers} />,
      [addNestedEditorChild$]: () => <MarkdownShortcutPlugin transformers={nestedTransformers} />,
    })
  },
})
