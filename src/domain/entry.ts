/** Entry 元数据（存储于 meta/<id>.json） */
export interface EntryMeta {
  id: string
  title: string
  createdAt: string // ISO 8601
  updatedAt: string
  tags: string[]
}

/** 完整 Entry（元数据 + Markdown 内容） */
export interface Entry {
  meta: EntryMeta
  content: string
}
