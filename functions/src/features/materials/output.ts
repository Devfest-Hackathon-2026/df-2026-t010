import { z } from 'zod'
import { MaterialRecognitionOutputSchema, parseAiOutput } from '@rekt/shared'

const ModelOutputSchema = z.strictObject({
  items: z.array(z.strictObject({ name: z.string().trim().min(1).max(80), quantity: z.number().positive().max(10000), unit: z.string().trim().min(1).max(20), confidence: z.number().min(0).max(1).nullable() })).max(50),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
})
export function parseMaterialCandidates(value: unknown, requestId: string) {
  const model = parseAiOutput(ModelOutputSchema, value)
  return MaterialRecognitionOutputSchema.parse({
    items: model.items.map((item, index) => ({ ...item, id: `ai-${requestId}-${index + 1}`, source: 'ai' })), warnings: model.warnings,
  })
}
