import { getStorage } from 'firebase-admin/storage'
import { MaterialImageMimeSchema } from '@rekt/shared'
import { fail } from '../../lib/errors'

const privateCache = 'private,no-store'

export async function getGalleryPhotoUrl(photoPath: string, deleteAfter: string): Promise<string | null> {
  const bucket = getStorage().bucket()
  const file = bucket.file(photoPath)
  try {
    let [metadata] = await file.getMetadata()
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      const contentType = MaterialImageMimeSchema.parse(metadata.contentType)
      const [bytes] = await file.download()
      return `data:${contentType};base64,${bytes.toString('base64')}`
    }

    // XML API responses from signed URLs expose custom metadata as headers.
    // Remove bearer tokens and other custom metadata before signing.
    const keys = Object.keys(metadata.metadata ?? {})
    if (keys.length || metadata.cacheControl !== privateCache) {
      if (!metadata.generation || !metadata.metageneration) fail('TEMPORARILY_UNAVAILABLE')
      const sameObject = bucket.file(photoPath, { preconditionOpts: {
        ifGenerationMatch: metadata.generation,
        ifMetagenerationMatch: metadata.metageneration,
      } })
      try {
        const [sanitized] = await sameObject.setMetadata({
          cacheControl: privateCache,
          metadata: Object.fromEntries(keys.map((key) => [key, null])),
        })
        metadata = sanitized
      } catch (cause) {
        // Another gallery request may already have sanitized the object.
        if (typeof cause !== 'object' || cause === null || !('code' in cause) || Number(cause.code) !== 412) throw cause
        const [latest] = await file.getMetadata()
        metadata = latest
      }
    }
    if (!metadata.generation || Object.keys(metadata.metadata ?? {}).length || metadata.cacheControl !== privateCache) fail('TEMPORARILY_UNAVAILABLE')
    const now = Date.now()
    const expires = Math.min(Date.parse(deleteAfter), now + 10 * 60_000)
    if (expires <= now) return null
    const [url] = await file.getSignedUrl({ action: 'read', version: 'v4', expires, queryParams: { generation: String(metadata.generation) } })
    return url
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && Number(cause.code) === 404) return null
    throw cause
  }
}
