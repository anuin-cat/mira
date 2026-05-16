const TASK_LIST_ITEM_SELECTOR = "li[class*='_listItemChecked_'], li[class*='_listItemUnchecked_']"
const TASK_NUMBERED_CLASS = 'mira-task-list-numbered'
const TASK_ORDINAL_ATTR = 'data-mira-task-ordinal'
const TASK_NUMBER_WIDTH_PROPERTY = '--mira-task-number-width'

interface TaskListAutoNumberController {
  refresh: () => void
  destroy: () => void
}

/** 判断节点是否是 MDXEditor 渲染出的待办列表项 */
function isTaskListItem(element: Element): element is HTMLLIElement {
  return element instanceof HTMLLIElement && element.matches(TASK_LIST_ITEM_SELECTOR)
}

/** 清理待办项上的视觉编号标记 */
function clearTaskListNumber(item: HTMLLIElement) {
  if (item.hasAttribute(TASK_ORDINAL_ATTR)) item.removeAttribute(TASK_ORDINAL_ATTR)
  if (item.classList.contains(TASK_NUMBERED_CLASS)) item.classList.remove(TASK_NUMBERED_CLASS)
  if (item.style.getPropertyValue(TASK_NUMBER_WIDTH_PROPERTY)) item.style.removeProperty(TASK_NUMBER_WIDTH_PROPERTY)
}

/** 给一组连续待办项写入从 1 开始的视觉编号 */
function applyTaskListNumberGroup(group: HTMLLIElement[]) {
  const numberWidth = `${String(group.length).length + 1}ch`

  group.forEach((item, index) => {
    const ordinal = String(index + 1)
    if (item.getAttribute(TASK_ORDINAL_ATTR) !== ordinal) item.setAttribute(TASK_ORDINAL_ATTR, ordinal)
    if (!item.classList.contains(TASK_NUMBERED_CLASS)) item.classList.add(TASK_NUMBERED_CLASS)
    if (item.style.getPropertyValue(TASK_NUMBER_WIDTH_PROPERTY) !== numberWidth) {
      item.style.setProperty(TASK_NUMBER_WIDTH_PROPERTY, numberWidth)
    }
  })
}

/** 根据组长度决定保留或移除待办项视觉编号 */
function flushTaskListNumberGroup(group: HTMLLIElement[]) {
  if (group.length >= 2) {
    applyTaskListNumberGroup(group)
    return
  }

  group.forEach(clearTaskListNumber)
}

/** 刷新编辑器里所有连续待办组的视觉编号 */
export function refreshTaskListAutoNumbers(root: HTMLElement) {
  const parentLists = new Set<HTMLElement>()

  // 1. 先清理已经不再是待办项的旧标记，避免转换块类型后残留编号
  root.querySelectorAll<HTMLLIElement>(`li[${TASK_ORDINAL_ATTR}], li.${TASK_NUMBERED_CLASS}`).forEach((item) => {
    if (!isTaskListItem(item)) clearTaskListNumber(item)
  })

  // 2. 按父列表分组；同一个父列表的直接子项代表相同缩进层级
  root.querySelectorAll<HTMLLIElement>(TASK_LIST_ITEM_SELECTOR).forEach((item) => {
    if (item.parentElement instanceof HTMLElement) parentLists.add(item.parentElement)
  })

  // 3. 只给连续相邻且数量至少为 2 的待办组编号，遇到任何非待办子项就断组
  parentLists.forEach((listElement) => {
    let currentGroup: HTMLLIElement[] = []

    Array.from(listElement.children).forEach((child) => {
      if (isTaskListItem(child)) {
        currentGroup.push(child)
        return
      }

      flushTaskListNumberGroup(currentGroup)
      currentGroup = []
    })

    flushTaskListNumberGroup(currentGroup)
  })
}

/** 创建待办视觉编号控制器，跟随编辑器 DOM 变化自动刷新 */
export function createTaskListAutoNumberController(root: HTMLElement): TaskListAutoNumberController {
  let frameId: number | null = null

  /** 合并频繁 DOM 变化，避免输入时同步扫描编辑器 */
  const scheduleRefresh = () => {
    if (frameId !== null) return

    frameId = window.requestAnimationFrame(() => {
      frameId = null
      refreshTaskListAutoNumbers(root)
    })
  }

  const observer = new MutationObserver(scheduleRefresh)

  // 1. 首次挂载后立即补齐编号
  refreshTaskListAutoNumbers(root)

  // 2. 监听结构与 class 变化；编号属性和行内变量由本模块维护，不纳入观察
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  })

  return {
    refresh: scheduleRefresh,
    destroy() {
      observer.disconnect()
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = null
    },
  }
}
