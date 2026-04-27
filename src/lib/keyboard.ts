interface KeyboardEventLike {
  isComposing?: boolean
  keyCode?: number
  which?: number
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
    which?: number
  }
}

/** 判断键盘事件是否仍处于 IME 组合态，避免 Enter 误触提交 */
export function isImeComposing(event: KeyboardEventLike): boolean {
  return Boolean(
    event.isComposing ||
      event.keyCode === 229 ||
      event.which === 229 ||
      event.nativeEvent?.isComposing ||
      event.nativeEvent?.keyCode === 229 ||
      event.nativeEvent?.which === 229
  )
}
