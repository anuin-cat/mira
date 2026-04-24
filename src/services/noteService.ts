import { readFile, writeFile, listFiles, removeFile } from '../tauri/fs'
import type { Note, NoteMeta } from '../domain/note'

/** 从 Markdown 内容提取标题（取第一行非空文本，去掉 # 前缀） */
function extractTitle(content: string): string {
  for (const line of content.split('\n')) {
    const trimmed = line.replace(/^#+\s*/, '').trim()
    if (trimmed) return trimmed.slice(0, 60)
  }
  return '无标题'
}

/** 生成基于时间戳的 note ID（文件名安全格式） */
function generateId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

// 路径构建辅助
const noteFilePath = (vault: string, id: string) => `${vault}/notes/${id}.md`
const metaFilePath = (vault: string, id: string) => `${vault}/meta/${id}.json`

/** 列出所有 note 的元数据，按创建时间倒序排列 */
export async function listNotes(vaultPath: string): Promise<NoteMeta[]> {
  const files = await listFiles(`${vaultPath}/meta`)
  const metas: NoteMeta[] = []

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const raw = await readFile(`${vaultPath}/meta/${file}`)
    if (!raw) continue
    try {
      metas.push(JSON.parse(raw) as NoteMeta)
    } catch {
      // 跳过损坏的 meta 文件
    }
  }

  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 读取单条 note（内容 + 元数据） */
export async function readNote(vaultPath: string, id: string): Promise<Note | null> {
  const [raw, content] = await Promise.all([
    readFile(metaFilePath(vaultPath, id)),
    readFile(noteFilePath(vaultPath, id)),
  ])
  if (!raw || content === null) return null

  return {
    meta: JSON.parse(raw) as NoteMeta,
    content,
  }
}

/** 创建新 note，返回元数据 */
export async function createNote(vaultPath: string): Promise<NoteMeta> {
  const id = generateId()
  const now = new Date().toISOString()
  const meta: NoteMeta = {
    id,
    title: '无标题',
    createdAt: now,
    updatedAt: now,
    tags: [],
  }

  await Promise.all([
    writeFile(noteFilePath(vaultPath, id), ''),
    writeFile(metaFilePath(vaultPath, id), JSON.stringify(meta, null, 2)),
  ])

  return meta
}

/** 保存 note 内容，同步更新 meta 中的标题和修改时间 */
export async function saveNote(
  vaultPath: string,
  id: string,
  content: string
): Promise<NoteMeta> {
  const raw = await readFile(metaFilePath(vaultPath, id))
  const meta: NoteMeta = raw
    ? JSON.parse(raw)
    : { id, title: '无标题', createdAt: new Date().toISOString(), updatedAt: '', tags: [] }

  // 更新标题和修改时间
  meta.title = extractTitle(content)
  meta.updatedAt = new Date().toISOString()

  await Promise.all([
    writeFile(noteFilePath(vaultPath, id), content),
    writeFile(metaFilePath(vaultPath, id), JSON.stringify(meta, null, 2)),
  ])

  return meta
}

/** 删除 note（内容文件 + 元数据文件） */
export async function deleteNote(vaultPath: string, id: string): Promise<void> {
  await Promise.all([
    removeFile(noteFilePath(vaultPath, id)),
    removeFile(metaFilePath(vaultPath, id)),
  ])
}
