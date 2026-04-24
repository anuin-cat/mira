/** Note 元数据（存储于 meta/<id>.json） */
export interface NoteMeta {
  id: string
  title: string
  createdAt: string // ISO 8601
  updatedAt: string
  tags: string[]
}

/** 完整 Note（元数据 + Markdown 内容） */
export interface Note {
  meta: NoteMeta
  content: string
}
