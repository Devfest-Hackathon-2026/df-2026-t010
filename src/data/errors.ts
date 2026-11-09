import { GatewayError, GatewayErrorDetailsSchema } from '@rekt/shared'

export function gatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error
  if (typeof error === 'object' && error !== null) {
    const details = GatewayErrorDetailsSchema.safeParse('details' in error ? error.details : undefined)
    if (details.success) return new GatewayError(details.data.reason)
    const code = 'code' in error ? String(error.code) : ''
    if (/permission-denied/.test(code)) return new GatewayError('NOT_CRAFT_OWNER')
    if (/unavailable|network-request-failed|deadline-exceeded/.test(code)) return new GatewayError('TEMPORARILY_UNAVAILABLE')
    if (/unauthenticated/.test(code)) return new GatewayError('UNAUTHENTICATED')
  }
  return new GatewayError('INTERNAL_ERROR')
}
