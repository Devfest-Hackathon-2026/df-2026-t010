import { httpsCallable } from 'firebase/functions'
import { ref, getMetadata, uploadBytes } from 'firebase/storage'
import { ConfirmMaterialsInputSchema, EditMaterialsInputSchema, GatewayError, IdSchema, MAX_MATERIAL_IMAGE_BYTES, MaterialRecognitionResponseSchema, MaterialsDocumentSchema, RecognizeMaterialsInputSchema } from '@rekt/shared'
import type { z } from 'zod'
import type { MaterialsGateway } from '../contracts'
import { gatewayError } from '../errors'
import { getFirebaseServices } from './client'
import { ensureGuestUserId } from './auth'
import { toWire } from './crafts'
import { subscribeToCraftDocument } from './craftDocuments'
import { reservePhotoUpload } from './photoUploads'

// 材料保存/確定の結果は材料・制作状態の購読で受け取るため応答本文は使わない。
async function mutate(name: string, schema: z.ZodType, input: unknown) {
  try {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new GatewayError('VALIDATION_FAILED')
    await ensureGuestUserId()
    await httpsCallable(getFirebaseServices().functions, name)(parsed.data)
  } catch (error) { throw gatewayError(error) }
}

export const firebaseMaterialsGateway: MaterialsGateway = {
  async uploadMaterialPhoto({ craftId, photoId, blob }) {
    try {
      if (!IdSchema.safeParse(craftId).success || !IdSchema.safeParse(photoId).success || blob.type !== 'image/jpeg' || blob.size <= 0 || blob.size > MAX_MATERIAL_IMAGE_BYTES) throw new GatewayError('INVALID_IMAGE')
      await ensureGuestUserId()
      const storage = getFirebaseServices().storage
      storage.maxUploadRetryTime = 25_000; storage.maxOperationRetryTime = 15_000
      const image = ref(storage, `crafts/${craftId}/materials/${photoId}.jpg`)
      // Immutable path: recover a lost upload acknowledgement instead of overwriting it.
      const existing = await getMetadata(image).catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'storage/object-not-found') return null
        throw error
      })
      if (!existing) await reservePhotoUpload({ craftId, photoId, kind: 'materials', contentType: 'image/jpeg', sizeBytes: blob.size })
      const metadata = existing ?? (await uploadBytes(image, blob, { contentType: 'image/jpeg', cacheControl: 'private,no-store' })).metadata
      if (metadata.contentType !== 'image/jpeg' || metadata.size !== blob.size || !/^[1-9][0-9]{0,19}$/.test(metadata.generation)) throw new GatewayError('INVALID_IMAGE')
      return { imagePath: image.fullPath, imageGeneration: metadata.generation }
    } catch (error) { throw gatewayError(error) }
  },
  async recognizeMaterials(input) {
    try {
      const parsed = RecognizeMaterialsInputSchema.safeParse(input)
      if (!parsed.success) throw new GatewayError('VALIDATION_FAILED')
      await ensureGuestUserId()
      const response = await httpsCallable(getFirebaseServices().functions, 'recognizeMaterials', { timeout: 60_000 })(parsed.data)
      return MaterialRecognitionResponseSchema.parse(response.data)
    } catch (error) { throw gatewayError(error) }
  },
  subscribeToMaterials(craftId, next, error) {
    return subscribeToCraftDocument(['crafts', craftId, 'workshop', 'materials'], (snapshot) => {
      next(snapshot.exists() ? MaterialsDocumentSchema.parse(toWire(snapshot.data())) : null)
    }, error)
  },
  editMaterials: (input) => mutate('editMaterials', EditMaterialsInputSchema, input),
  confirmMaterials: (input) => mutate('confirmMaterials', ConfirmMaterialsInputSchema, input),
}
