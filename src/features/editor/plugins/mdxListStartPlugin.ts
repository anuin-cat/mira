import {
  addExportVisitor$,
  addImportVisitor$,
  realmPlugin,
  type LexicalExportVisitor,
  type MdastImportVisitor,
  type RealmPlugin,
} from '@mdxeditor/editor'
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListNode,
  type ListType,
} from '@lexical/list'

const LIST_START_VISITOR_PRIORITY = 20

interface MdastListItemLike {
  type: 'listItem'
  checked?: boolean | null
  children: never[]
}

interface MdastListLike {
  type: 'list'
  ordered?: boolean | null
  start?: number | null
  spread?: boolean | null
  children: MdastListItemLike[]
}

/** 根据 mdast 列表节点推断 Lexical 列表类型 */
function resolveListType(mdastNode: MdastListLike): ListType {
  const hasCheckedItem = mdastNode.children.some((item) => typeof item.checked === 'boolean')
  if (hasCheckedItem) return 'check'
  return mdastNode.ordered ? 'number' : 'bullet'
}

/** 只为有序列表读取合法起始序号，避免无序和任务列表带入无意义 start */
function resolveOrderedListStart(mdastNode: MdastListLike, listType: ListType): number | undefined {
  if (listType !== 'number') return undefined
  if (typeof mdastNode.start !== 'number' || !Number.isFinite(mdastNode.start)) return undefined
  return mdastNode.start
}

const mdastListStartVisitor: MdastImportVisitor<MdastListLike> = {
  priority: LIST_START_VISITOR_PRIORITY,
  testNode: 'list',
  visitNode({ mdastNode, lexicalParent, actions }) {
    // 1. 创建 Lexical 列表时保留 mdast 的有序列表 start
    const listType = resolveListType(mdastNode)
    const listNode = $createListNode(listType, resolveOrderedListStart(mdastNode, listType))

    // 2. 保持 MDXEditor 内置 visitor 的嵌套列表兼容逻辑
    if ($isListItemNode(lexicalParent)) {
      const dedicatedParent = $createListItemNode()
      dedicatedParent.append(listNode)
      lexicalParent.insertAfter(dedicatedParent)
      actions.visitChildren(mdastNode, listNode)
    } else {
      actions.addAndStepInto(listNode)
    }
  },
}

const lexicalListStartVisitor: LexicalExportVisitor<ListNode, MdastListLike> = {
  priority: LIST_START_VISITOR_PRIORITY,
  testLexicalNode: $isListNode,
  visitLexicalNode({ lexicalNode, actions }) {
    // 1. 导出 mdast 时写回 Lexical 有序列表的 start
    const isOrdered = lexicalNode.getListType() === 'number'
    const start = lexicalNode.getStart()
    const props: Record<string, unknown> = {
      ordered: isOrdered,
      spread: false,
    }

    // 2. start=1 是 Markdown 默认值，只有非默认起始序号需要显式保存
    if (isOrdered && start !== 1) props.start = start

    actions.addAndStepInto('list', props)
  },
}

/** 保留拆分有序列表的起始序号，弥补 MDXEditor 内置列表 visitor 丢失 start 的问题 */
export function mdxListStartPlugin(): RealmPlugin {
  return realmPlugin({
    init(realm) {
      realm.pubIn({
        [addImportVisitor$]: mdastListStartVisitor,
        [addExportVisitor$]: lexicalListStartVisitor,
      })
    },
  })()
}
