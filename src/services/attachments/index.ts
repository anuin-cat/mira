import { convertFileSrc } from '@tauri-apps/api/core'
import {
  ensureDir,
  pathExists,
  writeBinaryFile,
} from '../../tauri/fs'
import {
  ATTACHMENTS_ROOT_DIR,
  getBaseName,
  getParentPath,
  joinRelativePath,
} from '../pathUtils'

export { ATTACHMENTS_ROOT_DIR }

const IMAGE_NAME_PREFIX_MAX_LENGTH = 36
const FALLBACK_IMAGE_NAME = 'image'
const IMAGE_MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
  'image/heif': '.heif',
}
const IMAGE_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.ico',
])
const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/
const URL_LIKE_SOURCE_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/g
const UNSAFE_FILE_NAME_CHAR_RE = /[\/\\:*?"<>|#%&{}$!`'@+=\[\]()]/g

interface ImageAttachmentContext {
  vaultPath: string
  notePath: string
}

/** 拼接 vault 绝对路径与相对路径 */
function absoluteVaultPath(vaultPath: string, relativePath: string | null): string {
  const rootPath = vaultPath.replace(/\/+$/, '')
  return relativePath ? `${rootPath}/${relativePath}` : rootPath
}

/** 使用本地时间生成附件年月目录 */
function getAttachmentMonthPath(date: Date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return joinRelativePath(ATTACHMENTS_ROOT_DIR, year, month)
}

/** 从文件名或 MIME 类型中推断图片扩展名 */
function getImageExtension(file: File) {
  const fileName = getBaseName(file.name.replace(/\\/g, '/'))
  const extensionMatch = /\.[A-Za-z0-9]{1,8}$/.exec(fileName)
  const extension = extensionMatch?.[0].toLowerCase() ?? null
  if (extension && IMAGE_FILE_EXTENSIONS.has(extension)) return extension

  return IMAGE_MIME_EXTENSION_MAP[file.type.toLowerCase()] ?? '.png'
}

/** 去掉扩展名，保留用户原始文件名中的可读主体 */
function getOriginalNameStem(fileName: string, extension: string) {
  const baseName = getBaseName(fileName.replace(/\\/g, '/'))
  return baseName.toLowerCase().endsWith(extension.toLowerCase())
    ? baseName.slice(0, -extension.length)
    : baseName
}

/** 生成适合 Markdown 相对路径使用的附件文件名前缀 */
function sanitizeImageNamePrefix(fileName: string, extension: string) {
  const stem = getOriginalNameStem(fileName, extension)
    .normalize('NFC')
    .replace(CONTROL_CHAR_RE, '')
    .replace(UNSAFE_FILE_NAME_CHAR_RE, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .replace(/^-+|-+$/g, '')

  const truncatedStem = Array.from(stem)
    .slice(0, IMAGE_NAME_PREFIX_MAX_LENGTH)
    .join('')
    .replace(/-+$/g, '')
  return truncatedStem || FALLBACK_IMAGE_NAME
}

/** 校验当前文件是否是图片 */
function assertImageFile(file: File) {
  // 1. 浏览器能提供 MIME 时，优先遵循 image/* 校验
  if (file.type) {
    if (!file.type.toLowerCase().startsWith('image/')) throw new Error('只能插入图片文件')
    return
  }

  // 2. 少数拖拽文件可能没有 MIME，回退到扩展名识别
  const extensionMatch = /\.[A-Za-z0-9]{1,8}$/.exec(file.name)
  if (!extensionMatch || !IMAGE_FILE_EXTENSIONS.has(extensionMatch[0].toLowerCase())) {
    throw new Error('只能插入图片文件')
  }
}

/** 找到不会覆盖已有图片的附件相对路径 */
async function resolveAvailableAttachmentPath(vaultPath: string, directoryPath: string, file: File) {
  // 1. 根据原始文件名生成基础名称
  const extension = getImageExtension(file)
  const namePrefix = sanitizeImageNamePrefix(file.name, extension)

  // 2. 仅在重名时追加序号，避免无意义改名
  let index = 1
  while (true) {
    const suffix = index === 1 ? '' : `-${index}`
    const fileName = `${namePrefix}${suffix}${extension}`
    const relativePath = joinRelativePath(directoryPath, fileName)
    const exists = await pathExists(absoluteVaultPath(vaultPath, relativePath))
    if (!exists) return relativePath
    index += 1
  }
}

/** 计算从当前笔记目录到目标附件的 Markdown 相对路径 */
function getMarkdownRelativePath(notePath: string, targetPath: string) {
  // 1. 拆分当前笔记目录和目标路径，寻找公共前缀
  const noteDirSegments = (getParentPath(notePath) ?? '').split('/').filter(Boolean)
  const targetSegments = targetPath.split('/').filter(Boolean)
  let commonLength = 0
  while (
    commonLength < noteDirSegments.length &&
    commonLength < targetSegments.length &&
    noteDirSegments[commonLength] === targetSegments[commonLength]
  ) {
    commonLength += 1
  }

  // 2. 用 ../ 回到公共父级，再进入附件目录
  const parentSegments = Array(noteDirSegments.length - commonLength).fill('..')
  return [...parentSegments, ...targetSegments.slice(commonLength)].join('/')
}

/** 判断图片源是否是无需本地解析的 URL */
function isUrlLikeImageSource(src: string) {
  return URL_LIKE_SOURCE_RE.test(src) || src.startsWith('//')
}

/** 尽量还原 Markdown 图片路径里的 URL 编码字符 */
function decodeImageSource(src: string) {
  try {
    return decodeURI(src)
  } catch {
    return src
  }
}

/** 把笔记内相对图片路径解析为 vault 内相对路径，越界时返回 null */
function resolveVaultRelativeImagePath(src: string, notePath: string) {
  // 1. 绝对路径和用户目录路径不属于 vault 相对引用
  const decodedSrc = decodeImageSource(src).trim().replace(/\\/g, '/')
  if (
    !decodedSrc ||
    decodedSrc.startsWith('/') ||
    decodedSrc.startsWith('~') ||
    WINDOWS_ABSOLUTE_PATH_RE.test(decodedSrc)
  ) {
    return null
  }

  // 2. 从当前笔记目录开始解析 . 和 ..
  const resolvedSegments = (getParentPath(notePath) ?? '').split('/').filter(Boolean)
  for (const segment of decodedSrc.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (resolvedSegments.length === 0) return null
      resolvedSegments.pop()
      continue
    }
    resolvedSegments.push(segment)
  }

  return resolvedSegments.join('/')
}

/** 保存图片附件，并返回写入 Markdown 的当前笔记相对路径 */
export async function saveImageAttachment(file: File, { vaultPath, notePath }: ImageAttachmentContext) {
  // 1. 校验图片并准备附件目录
  assertImageFile(file)
  const attachmentDir = getAttachmentMonthPath(new Date())
  await ensureDir(absoluteVaultPath(vaultPath, attachmentDir))

  // 2. 写入二进制文件，已有同名文件时自动追加序号
  const attachmentPath = await resolveAvailableAttachmentPath(vaultPath, attachmentDir, file)
  const content = new Uint8Array(await file.arrayBuffer())
  await writeBinaryFile(absoluteVaultPath(vaultPath, attachmentPath), content)

  // 3. 返回相对当前笔记的 Markdown 图片路径
  return getMarkdownRelativePath(notePath, attachmentPath)
}

/** 解析 Markdown 图片源为 WebView 可展示的地址 */
export async function resolveImagePreviewSource(src: string, { vaultPath, notePath }: ImageAttachmentContext) {
  // 1. 网络、data/blob 等 URL 不做本地路径转换
  if (isUrlLikeImageSource(src)) return src

  // 2. vault 内相对路径转换为 Tauri asset URL
  const vaultRelativePath = resolveVaultRelativeImagePath(src, notePath)
  if (!vaultRelativePath) throw new Error('图片路径不能指向 vault 外部')

  return convertFileSrc(absoluteVaultPath(vaultPath, vaultRelativePath))
}
