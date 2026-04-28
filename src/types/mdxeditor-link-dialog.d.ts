type MiraNodeRef<T = unknown> = symbol & {
  valType: T
}

declare module '@mdxeditor/editor' {
  export const updateLink$: MiraNodeRef<{ url?: string; title?: string; text?: string }>
  export const cancelLinkEdit$: MiraNodeRef<void>
  export const removeLink$: MiraNodeRef<void>
  export const onWindowChange$: MiraNodeRef<void>
}

export {}
