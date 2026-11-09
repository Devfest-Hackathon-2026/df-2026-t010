import { getStorage } from 'firebase-admin/storage'
import { GatewayError, MAX_MATERIAL_IMAGE_BYTES } from '@rekt/shared'
import { validateMaterialImage } from '../materials/image'

// Completion photos use the same bounded JPEG/PNG/WebP byte validation as materials.
// This runs outside Firestore transactions and is never an AI request.
export async function loadCompletionPhoto(path: string): Promise<void> {
  try {
    const bucket = getStorage().bucket()
    const [metadata] = await bucket.file(path).getMetadata()
    const size = Number(metadata.size)
    const generation = String(metadata.generation)
    const mimeType = /\.jpe?g$/.test(path) ? 'image/jpeg' : path.endsWith('.png') ? 'image/png' : 'image/webp'
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MATERIAL_IMAGE_BYTES || metadata.contentType !== mimeType || !/^[1-9][0-9]{0,19}$/.test(generation)) throw new GatewayError('INVALID_IMAGE')
    const [bytes] = await bucket.file(path, { generation }).download({ decompress: false })
    if (bytes.length !== size) throw new GatewayError('INVALID_IMAGE')
    validateMaterialImage(bytes, metadata.contentType)
  } catch (error) {
    if (error instanceof GatewayError) throw error
    if (typeof error === 'object' && error !== null && 'code' in error && Number(error.code) === 404) throw new GatewayError('IMAGE_NOT_FOUND')
    throw new GatewayError('TEMPORARILY_UNAVAILABLE')
  }
}
