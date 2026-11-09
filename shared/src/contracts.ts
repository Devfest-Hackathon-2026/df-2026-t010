import { z } from 'zod'

export const LanguageSchema = z.enum(['ja', 'en'])
export type Language = z.infer<typeof LanguageSchema>

export const HealthResponseSchema = z.object({
  service: z.literal('co-make'),
  status: z.literal('ok'),
  version: z.literal(1),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>
