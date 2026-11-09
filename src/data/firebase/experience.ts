import { z } from 'zod'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getBlob, getMetadata, ref, uploadBytes } from 'firebase/storage'
import { CompletionDocumentSchema, CompletionSnapshotSchema, CraftHistoryItemSchema, GalleryPostSchema, GalleryPageSchema, GetGalleryPostInputSchema, ListGalleryPageInputSchema, GatewayError, IdSchema, MAX_MATERIAL_IMAGE_BYTES, ProductionDocumentSchema, ProductionSnapshotSchema } from '@rekt/shared'
import type { ExperienceGateway } from '../contracts'
import { gatewayError } from '../errors'
import { ensureGuestUserId } from './auth'
import { getFirebaseServices } from './client'
import { toWire } from './crafts'
import { subscribeToCraftDocument } from './craftDocuments'
import { reservePhotoUpload } from './photoUploads'
async function call<T>(name: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
  try { await ensureGuestUserId(); const response = await httpsCallable(getFirebaseServices().functions, name)(input); return schema.parse(response.data) } catch (cause) { throw gatewayError(cause) }
}
export const firebaseExperienceGateway: ExperienceGateway = {
  startCraft: (input) => call('startCraft', input, ProductionSnapshotSchema),
  completeStep: (input) => call('completeStep', input, ProductionSnapshotSchema),
  completeCraft: (input) => call('completeCraft', input, CompletionSnapshotSchema),
  listMyCrafts: () => call('listMyCrafts', {}, z.array(CraftHistoryItemSchema)),
  listGallery: () => call('listGallery', {}, z.array(GalleryPostSchema)),
  getGalleryPost: (postId) => call('getGalleryPost', GetGalleryPostInputSchema.parse({ postId }), GalleryPostSchema.nullable()),
  listGalleryPage: (input) => call('listGalleryPage', ListGalleryPageInputSchema.parse(input), GalleryPageSchema),
  publishCraft: (input) => call('publishCraft', input, GalleryPostSchema),
  galleryAction: (input) => call('galleryAction', input, GalleryPostSchema),
  async getCompletionPhoto(craftId) {
    try {
      await ensureGuestUserId()
      const { firestore, storage } = getFirebaseServices()
      const saved = await getDoc(doc(firestore, 'crafts', craftId, 'workshop', 'completion'))
      if (!saved.exists()) return null
      const { photoPath, deleteAfter } = CompletionDocumentSchema.parse(toWire(saved.data()))
      if (!photoPath || Date.parse(deleteAfter) <= Date.now()) return null
      if (!photoPath.startsWith(`crafts/${craftId}/completion/`)) throw new GatewayError('INVALID_IMAGE')
      storage.maxOperationRetryTime = 15_000
      return await getBlob(ref(storage, photoPath), MAX_MATERIAL_IMAGE_BYTES)
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'storage/object-not-found') throw new GatewayError('IMAGE_NOT_FOUND')
      throw gatewayError(cause)
    }
  },
  subscribeToProduction(craftId, next, error) {
    return subscribeToCraftDocument(['crafts', craftId, 'workshop', 'production'], (snapshot) => {
      next(snapshot.exists() ? ProductionDocumentSchema.parse(toWire(snapshot.data())) : null)
    }, error)
  },
  async uploadCompletionPhoto({ craftId, photoId, blob }) {
    try {
      if (!IdSchema.safeParse(craftId).success || !IdSchema.safeParse(photoId).success || blob.type !== 'image/jpeg' || blob.size > 5 * 1024 * 1024 || blob.size <= 0) throw new GatewayError('INVALID_IMAGE')
      await ensureGuestUserId()
      const storage = getFirebaseServices().storage; storage.maxUploadRetryTime = 25_000; storage.maxOperationRetryTime = 15_000
      const file = ref(storage, `crafts/${craftId}/completion/${photoId}.jpg`)
      const existing = await getMetadata(file).catch((error: unknown) => { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'storage/object-not-found') return null; throw error })
      if (!existing) { await reservePhotoUpload({ craftId, photoId, kind: 'completion', contentType: 'image/jpeg', sizeBytes: blob.size }); await uploadBytes(file, blob, { contentType: 'image/jpeg', cacheControl: 'private,no-store' }) }
      else if (existing.size !== blob.size || existing.contentType !== 'image/jpeg') throw new GatewayError('INVALID_IMAGE')
      return { photoPath: file.fullPath }
    } catch (cause) { throw gatewayError(cause) }
  },
}
