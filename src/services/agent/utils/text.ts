/** 把数字限制在指定闭区间内，并处理异常输入 */
export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 从工具入参中读取字符串，空白值回退为 null */
export function readStringInput(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** 按字符数裁剪文本，并返回裁剪元信息 */
export function clipWithMeta(value: string, limit: number): {
  text: string
  isTruncated: boolean
  remainingChars: number
} {
  if (value.length <= limit) {
    return {
      text: value,
      isTruncated: false,
      remainingChars: 0,
    }
  }

  return {
    text: value.slice(0, limit),
    isTruncated: true,
    remainingChars: value.length - limit,
  }
}
