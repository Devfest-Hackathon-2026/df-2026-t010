import { DateTimeSchema } from './common'

export const COMPLETION_RETENTION_DAYS = 7
export const COMPLETION_RETENTION_MS = COMPLETION_RETENTION_DAYS * 24 * 60 * 60 * 1000
export function completionDeleteAfter(completedAt: string) {
  return new Date(Date.parse(DateTimeSchema.parse(completedAt)) + COMPLETION_RETENTION_MS).toISOString()
}
