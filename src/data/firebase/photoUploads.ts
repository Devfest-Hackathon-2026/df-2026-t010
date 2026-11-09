import { httpsCallable } from 'firebase/functions'
import { GatewayError, PhotoUploadReservationSchema, ReservePhotoUploadInputSchema, photoUploadPath } from '@rekt/shared'
import type { ReservePhotoUploadInput } from '@rekt/shared'
import { ensureGuestUserId } from './auth'
import { getFirebaseServices } from './client'

export async function reservePhotoUpload(raw: ReservePhotoUploadInput) {
  const input = ReservePhotoUploadInputSchema.parse(raw)
  await ensureGuestUserId()
  const response = await httpsCallable(getFirebaseServices().functions, 'reservePhotoUpload')(input)
  const permit = PhotoUploadReservationSchema.parse(response.data)
  if (permit.path !== photoUploadPath(input) || permit.sizeBytes !== input.sizeBytes || permit.contentType !== input.contentType) throw new GatewayError('INVALID_IMAGE')
  return permit
}
