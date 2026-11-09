import { requestId } from '../../data/request-id'

// 材料写真を送る前に端末の中で整える。
// - 長い辺を最大1600pxに縮小し、JPEGで描き直す（通信量を減らし、位置情報などのメタデータも消える）
// - プレビューはメモリだけ。送信操作でStorageにアップロードする
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024
export const MAX_EDGE = 1600
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

export type PhotoProblem = 'notImage' | 'tooLarge' | 'unreadable'
export class PhotoError extends Error {
  constructor(readonly problem: PhotoProblem) { super(problem) }
}
export interface PreparedPhoto {
  /** 同じ写真の再送で同じ操作IDを使うための目印 */
  id: string
  mimeType: 'image/jpeg'
  blob: Blob
  /** プレビュー表示用。不要になったら URL.revokeObjectURL する */
  previewUrl: string
}

export function checkPhotoFile(file: File) {
  if (file.type && !file.type.startsWith('image/')) throw new PhotoError('notImage')
  if (file.size > MAX_SOURCE_BYTES) throw new PhotoError('tooLarge')
}

export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function decodePhoto(file: File) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  } catch {
    // Some browsers can display an image their bitmap decoder cannot open.
    const url = URL.createObjectURL(file)
    const image = new Image()
    try {
      image.src = url
      await image.decode()
      if (image.naturalWidth && image.naturalHeight) {
        return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) }
      }
    } catch { /* Both decoders rejected the image. */ }
    URL.revokeObjectURL(url)
    throw new PhotoError('unreadable')
  }
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  checkPhotoFile(file)
  const { image, width, height, close } = await decodePhoto(file)
  try {
    const size = fitWithin(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = size.width; canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new PhotoError('unreadable')
    context.drawImage(image, 0, 0, size.width, size.height)
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (!blob?.size || blob.type !== 'image/jpeg') throw new PhotoError('unreadable')
      if (blob.size <= MAX_OUTPUT_BYTES) return { id: requestId(), mimeType: 'image/jpeg', blob, previewUrl: URL.createObjectURL(blob) }
    }
    throw new PhotoError('tooLarge')
  } finally { close() }
}
