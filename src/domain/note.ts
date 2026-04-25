export type VaultEntryKind = 'file' | 'directory'

/** Vault 文件树节点，path 为相对 vault 根目录的稳定身份 */
export interface VaultTreeNode {
  id: string
  path: string
  name: string
  kind: VaultEntryKind
  updatedAt: string | null
  children?: VaultTreeNode[]
}

/** Markdown 文件元数据，全部可从文件系统和内容重建 */
export interface NoteMeta {
  path: string
  title: string
  updatedAt: string | null
}

/** 完整 Markdown 文件 */
export interface Note {
  meta: NoteMeta
  content: string
}

/** 字体大小选项 */
export type FontSize = 'small' | 'medium' | 'large' | 'xlarge'

/** .mira/state.json 中的可丢弃 UI 状态 */
export interface VaultState {
  version: 1
  lastOpenedPath: string | null
  expandedDirs: string[]
  fontSize?: FontSize
}
