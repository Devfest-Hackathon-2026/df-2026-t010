import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { ReservePhotoUploadInputSchema } from '@rekt/shared'
import { requireUserId } from '../../lib/auth'
import { fail, parseInput } from '../../lib/errors'
import { runReservePhotoUpload } from './operations'

export const reservePhotoUpload = onCall({ region: 'asia-northeast1', timeoutSeconds: 20, memory: '256MiB', maxInstances: 1, minInstances: 0 }, async (request) => {
  const uid = requireUserId(request.auth)
  const input = parseInput(ReservePhotoUploadInputSchema, request.data)
  try { return await runReservePhotoUpload(uid, input) } catch (error) {
    if (error instanceof HttpsError) throw error
    return fail('TEMPORARILY_UNAVAILABLE')
  }
})
