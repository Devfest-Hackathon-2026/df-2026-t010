import { DateTimeSchema } from './common'

export const UNFINISHED_RETENTION_DAYS = 7
export const UNFINISHED_RETENTION_MS = UNFINISHED_RETENTION_DAYS * 24 * 60 * 60 * 1000
export function unfinishedDeleteAfter(updatedAt: string) {
  return new Date(Date.parse(DateTimeSchema.parse(updatedAt)) + UNFINISHED_RETENTION_MS).toISOString()
}
