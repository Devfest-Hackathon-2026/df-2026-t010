import { getStorage } from 'firebase-admin/storage'
import { GatewayError, MAX_MATERIAL_IMAGE_BYTES, MaterialImageMimeSchema } from '@rekt/shared'
import type { RecognizeMaterialsInput } from '@rekt/shared'

export interface MaterialImage { bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }
export function validateMaterialImage(bytes: Buffer, contentType: unknown): MaterialImage {
  const parsed = MaterialImageMimeSchema.safeParse(contentType)
  if (!parsed.success || !bytes.length || bytes.length > MAX_MATERIAL_IMAGE_BYTES) throw new GatewayError('INVALID_IMAGE')
  const png = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR'
    && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(16) <= 4096 && bytes.readUInt32BE(20) <= 4096
    && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND'
  const jpeg = bytes.length >= 16 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
  const webp = bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length
  if (!({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[parsed.data]) throw new GatewayError('INVALID_IMAGE')
  return { bytes, mimeType: parsed.data }
}
export async function loadMaterialImage(input: RecognizeMaterialsInput): Promise<MaterialImage> {
  try {
    const file = getStorage().bucket().file(input.imagePath, { generation: input.imageGeneration })
    const [metadata] = await file.getMetadata()
    const size = Number(metadata.size)
    const expectedType = /\.jpe?g$/.test(input.imagePath) ? 'image/jpeg' : input.imagePath.endsWith('.png') ? 'image/png' : 'image/webp'
    if (metadata.contentType !== expectedType) throw new GatewayError('INVALID_IMAGE')
    if (String(metadata.generation) !== input.imageGeneration) throw new GatewayError('IMAGE_NOT_FOUND')
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MATERIAL_IMAGE_BYTES) throw new GatewayError('INVALID_IMAGE')
    const [bytes] = await file.download({ decompress: false })
    if (bytes.length !== size) throw new GatewayError('INVALID_IMAGE')
    return validateMaterialImage(bytes, metadata.contentType)
  } catch (error) {
    if (error instanceof GatewayError) throw error
    if (typeof error === 'object' && error !== null && 'code' in error && Number(error.code) === 404) throw new GatewayError('IMAGE_NOT_FOUND')
    throw new GatewayError('AI_UNAVAILABLE')
  }
}
