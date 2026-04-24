import { readTextFile, writeTextFile, readDir, mkdir, remove, exists } from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'

/** 弹出系统目录选择框 */
export async function selectDirectory(title: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title })
  return typeof result === 'string' ? result : null
}

/** 确保目录存在（递归创建） */
export async function ensureDir(path: string): Promise<void> {
  const dirExists = await exists(path)
  if (!dirExists) await mkdir(path, { recursive: true })
}

/** 读取文本文件，不存在时返回 null */
export async function readFile(path: string): Promise<string | null> {
  const fileExists = await exists(path)
  if (!fileExists) return null
  return await readTextFile(path)
}

/** 写入文本文件 */
export async function writeFile(path: string, content: string): Promise<void> {
  await writeTextFile(path, content)
}

/** 列出目录下所有文件名（仅文件，不含子目录） */
export async function listFiles(dirPath: string): Promise<string[]> {
  const dirExists = await exists(dirPath)
  if (!dirExists) return []
  const entries = await readDir(dirPath)
  return entries
    .filter((e) => e.isFile && e.name)
    .map((e) => e.name as string)
}

/** 删除文件（不存在时静默忽略） */
export async function removeFile(path: string): Promise<void> {
  const fileExists = await exists(path)
  if (fileExists) await remove(path)
}
