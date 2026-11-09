import { z } from 'zod'
export const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
export const RequestIdSchema = z.uuid({ version: 'v4' })
export const DateTimeSchema = z.iso.datetime()
