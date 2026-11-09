import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { CompleteCraftInputSchema, GatewayError } from '@rekt/shared'
import { requireUserId } from '../../lib/auth'
import { fail, parseInput } from '../../lib/errors'
import { runCompleteCraft } from './operations'

export const completeCraft = onCall({ region: 'asia-northeast1', timeoutSeconds: 20, memory: '256MiB', maxInstances: 1, minInstances: 0 }, async (request) => {
  const uid = requireUserId(request.auth)
  const input = parseInput(CompleteCraftInputSchema, request.data)
  try { return await runCompleteCraft(uid, input) } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error instanceof GatewayError) fail(error.reason)
    if (typeof error === 'object' && error !== null && 'code' in error && [10, 14, 'aborted', 'unavailable'].includes(error.code as number | string)) fail('TEMPORARILY_UNAVAILABLE')
    return fail('INTERNAL_ERROR')
  }
})
