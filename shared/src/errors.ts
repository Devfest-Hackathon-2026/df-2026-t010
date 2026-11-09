import { z } from 'zod'

export const ERROR_CODES = {
  UNAUTHENTICATED: 'unauthenticated', VALIDATION_FAILED: 'invalid-argument', CRAFT_NOT_FOUND: 'not-found',
  NOT_CRAFT_OWNER: 'permission-denied', INVALID_CRAFT_STATE: 'failed-precondition',
  IDEMPOTENCY_CONFLICT: 'already-exists', STALE_REVISION: 'failed-precondition', CANDIDATES_NOT_READY: 'failed-precondition',
  DEPENDENCY_NOT_COMPLETED: 'failed-precondition', RATE_LIMITED: 'resource-exhausted',
  PRODUCTION_NOT_READY: 'failed-precondition', STEP_NOT_FOUND: 'not-found',
  STEPS_NOT_COMPLETED: 'failed-precondition',
  PHOTO_LIMIT_REACHED: 'resource-exhausted',
  AI_RESPONSE_INVALID: 'internal', TEMPORARILY_UNAVAILABLE: 'unavailable', INTERNAL_ERROR: 'internal',
  AI_UNSAFE_PROJECT: 'failed-precondition',
  INVALID_IMAGE: 'invalid-argument', IMAGE_NOT_FOUND: 'not-found', AI_DISABLED: 'failed-precondition',
  AI_REQUEST_IN_PROGRESS: 'unavailable', AI_TIMEOUT: 'deadline-exceeded', AI_UNAVAILABLE: 'unavailable',
  AI_BUDGET_EXHAUSTED: 'resource-exhausted',
} as const
export type ErrorReason = keyof typeof ERROR_CODES
export const ErrorReasonSchema = z.enum(Object.keys(ERROR_CODES) as [ErrorReason, ...ErrorReason[]])
export const GatewayErrorDetailsSchema = z.strictObject({ schemaVersion: z.literal(2), reason: ErrorReasonSchema })
export type GatewayErrorDetails = z.infer<typeof GatewayErrorDetailsSchema>

export class GatewayError extends Error {
  readonly reason: ErrorReason
  constructor(reason: ErrorReason) { super(reason); this.name = 'GatewayError'; this.reason = reason }
}
