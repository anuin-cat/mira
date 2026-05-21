const PLAIN_TEXT_INPUT_TYPES = new Set([
  'email',
  'password',
  'search',
  'tel',
  'text',
  'url',
])

/** 向当前聚焦的输入控件插入纯文本，统一兼容表单控件与 contenteditable */
export function insertPlainTextIntoFocusedTarget(text: string) {
  const activeElement = document.activeElement

  // 1. 表单控件用原生 selection API，保证 React 受控值能收到 input 事件
  if (activeElement instanceof HTMLTextAreaElement) {
    const selectionStart = activeElement.selectionStart ?? activeElement.value.length
    const selectionEnd = activeElement.selectionEnd ?? selectionStart
    activeElement.setRangeText(text, selectionStart, selectionEnd, 'end')
    activeElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    return true
  }

  if (activeElement instanceof HTMLInputElement && PLAIN_TEXT_INPUT_TYPES.has(activeElement.type)) {
    const selectionStart = activeElement.selectionStart ?? activeElement.value.length
    const selectionEnd = activeElement.selectionEnd ?? selectionStart
    activeElement.setRangeText(text, selectionStart, selectionEnd, 'end')
    activeElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    return true
  }

  // 2. 富文本编辑区交给浏览器标准插入命令，Lexical 会接收 beforeinput/input
  if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
    return document.execCommand('insertText', false, text)
  }

  return false
}
