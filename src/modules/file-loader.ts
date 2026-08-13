import type { AnalyzedFile, FileAnalysisStatus } from '../types/domain'

export const SUPPORTED_FILE_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png']
export const FUTURE_FILE_EXTENSIONS = ['dwg', 'dxf', 'ifc']

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

export function extensionOf(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

export function isSupportedFile(file: File) {
  const extension = extensionOf(file.name)
  return SUPPORTED_FILE_EXTENSIONS.includes(extension)
}

export function isFutureFile(file: File) {
  return FUTURE_FILE_EXTENSIONS.includes(extensionOf(file.name))
}

export function unsupportedMessage(fileName: string) {
  const extension = extensionOf(fileName).toUpperCase() || '알 수 없는'
  if (FUTURE_FILE_EXTENSIONS.includes(extension.toLowerCase())) {
    return `${extension} 형식: 현재 이 파일 형식은 자동 분석을 지원하지 않습니다.`
  }
  return '현재 이 파일 형식은 자동 분석을 지원하지 않습니다.'
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function makeFileId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${globalThis.crypto?.randomUUID?.() || Date.now()}`
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

export function createQueuedFile(file: File): AnalyzedFile {
  const extension = extensionOf(file.name)
  const status: FileAnalysisStatus = isSupportedFile(file) ? 'queued' : 'failed'
  return {
    id: makeFileId(file),
    name: file.name,
    extension,
    mimeType: file.type || MIME_BY_EXTENSION[extension] || 'application/octet-stream',
    size: file.size,
    status,
    stage: status === 'failed' ? 'failed' : 'uploading',
    progress: 0,
    kind: 'unknown',
    kindConfidence: 'low',
    pages: [],
    previewUrl: '',
    warnings: isSupportedFile(file) ? [] : [unsupportedMessage(file.name)],
    error: isSupportedFile(file) ? '' : unsupportedMessage(file.name),
    uploadedAt: new Date().toISOString(),
    canReanalyze: isSupportedFile(file),
    externalProcessing: false,
  }
}

export function asBlobUrl(file: Blob) {
  return URL.createObjectURL(file)
}

export function revokeBlobUrl(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
