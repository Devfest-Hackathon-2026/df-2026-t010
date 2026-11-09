import { ERROR_CODES } from '@rekt/shared'
import type { ErrorReason } from '@rekt/shared'
import { HttpsError } from 'firebase-functions/v2/https'
import type { z } from 'zod'

export function fail(reason: ErrorReason): never {
  throw new HttpsError(ERROR_CODES[reason], reason, { schemaVersion: 2, reason })
}
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) fail('VALIDATION_FAILED')
  return parsed.data
}
