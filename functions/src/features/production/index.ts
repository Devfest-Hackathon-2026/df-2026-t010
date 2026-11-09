import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { CompleteStepInputSchema, StartCraftInputSchema } from '@rekt/shared'
import type { z } from 'zod'
import { requireUserId } from '../../lib/auth'
import { fail, parseInput } from '../../lib/errors'
import { runProductionOperation } from './operations'

function productionCallable<O extends Parameters<typeof runProductionOperation>[0]>(operation: O, schema: z.ZodType<Parameters<typeof runProductionOperation<O>>[2]>) {
  return onCall({ region: 'asia-northeast1', timeoutSeconds: 20, memory: '256MiB', maxInstances: 1, minInstances: 0 }, async (request) => {
    const uid = requireUserId(request.auth)
    const input = parseInput(schema, request.data)
    try { return await runProductionOperation(operation, uid, input) } catch (error) {
      if (error instanceof HttpsError) throw error
      if (typeof error === 'object' && error !== null && 'code' in error && [10, 14, 'aborted', 'unavailable'].includes(error.code as number | string)) fail('TEMPORARILY_UNAVAILABLE')
      return fail('INTERNAL_ERROR')
    }
  })
}
export const startCraft = productionCallable('startCraft', StartCraftInputSchema)
export const completeStep = productionCallable('completeStep', CompleteStepInputSchema)
