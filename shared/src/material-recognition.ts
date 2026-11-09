import { z } from 'zod'
import { LanguageSchema } from './contracts'
import { IdSchema, RequestIdSchema } from './common'
import { MaterialRecognitionOutputSchema } from './workshop'

export const MAX_MATERIAL_IMAGE_BYTES = 5 * 1024 * 1024
export const MaterialImageMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])
export const MaterialImagePathSchema = z.string().max(420).regex(/^crafts\/[A-Za-z0-9_-]{1,128}\/materials\/[A-Za-z0-9_-]{1,128}\.(jpg|jpeg|png|webp)$/)
export const RecognizeMaterialsInputSchema = z.strictObject({
  requestId: RequestIdSchema, craftId: IdSchema, expectedCraftRevision: z.int().nonnegative(),
  imagePath: MaterialImagePathSchema, imageGeneration: z.string().regex(/^[1-9][0-9]{0,19}$/), locale: LanguageSchema,
}).refine((input) => input.imagePath.startsWith(`crafts/${input.craftId}/materials/`), 'Image must belong to the craft')
export type RecognizeMaterialsInput = z.infer<typeof RecognizeMaterialsInputSchema>
export const RecognitionFailureReasonSchema = z.enum(['INVALID_IMAGE', 'IMAGE_NOT_FOUND', 'AI_RESPONSE_INVALID', 'AI_TIMEOUT', 'AI_UNAVAILABLE', 'AI_BUDGET_EXHAUSTED', 'STALE_REVISION', 'INVALID_CRAFT_STATE'])
const ResponseBaseSchema = z.strictObject({
  schemaVersion: z.literal(2), requestId: RequestIdSchema, craftId: IdSchema, craftRevision: z.int().nonnegative(),
  imagePath: MaterialImagePathSchema, imageGeneration: z.string().regex(/^[1-9][0-9]{0,19}$/),
  engine: z.enum(['gemini', 'fixture', 'workers-ai']), promptVersion: z.literal('materials-v1'), requiresConfirmation: z.literal(true),
})
export const MaterialRecognitionResponseSchema = z.discriminatedUnion('status', [
  ResponseBaseSchema.extend({ status: z.literal('succeeded'), result: MaterialRecognitionOutputSchema }),
  ResponseBaseSchema.extend({ status: z.literal('failed'), reason: RecognitionFailureReasonSchema }),
])
export type MaterialRecognitionResponse = z.infer<typeof MaterialRecognitionResponseSchema>
export type RecognitionFailureReason = z.infer<typeof RecognitionFailureReasonSchema>
