import { z } from 'zod'
import { DateTimeSchema, IdSchema, RequestIdSchema } from './common'
import { GatewayError } from './errors'
import { COMPLETION_RETENTION_MS } from './completion-retention'

export const LocalizedTextSchema = z.strictObject({ ja: z.string().trim().min(1).max(2000), en: z.string().trim().min(1).max(2000) })
export const MaterialSchema = z.strictObject({
  id: IdSchema, name: z.string().trim().min(1).max(80), quantity: z.number().positive().max(10000),
  unit: z.string().trim().min(1).max(20), source: z.enum(['ai', 'manual']), confidence: z.number().min(0).max(1).nullable(),
})
const uniqueIds = (items: { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length
const ItemsSchema = z.array(MaterialSchema).max(50).refine(uniqueIds, 'Duplicate material IDs')
// A physical check (e.g. width, thickness, clean/dry condition) is defined by a template.
// Only true satisfies it; false, null or a missing answer never implies suitability.
const CheckAnswersSchema = z.array(z.strictObject({ id: IdSchema, confirmed: z.boolean().nullable() })).max(30).refine(uniqueIds, 'Duplicate check IDs')
export const MaterialsDocumentSchema = z.strictObject({
  schemaVersion: z.literal(2), revision: z.int().nonnegative(), items: ItemsSchema,
  tools: z.array(z.string().trim().min(1).max(80)).max(30), checks: CheckAnswersSchema,
  updatedAt: DateTimeSchema, confirmedAt: DateTimeSchema.nullable(),
})
export const RequirementSchema = z.strictObject({ materialId: IdSchema, name: LocalizedTextSchema, quantity: z.number().positive().max(10000), unit: LocalizedTextSchema })
export const TemplateStepSchema = z.strictObject({
  id: IdSchema, title: LocalizedTextSchema, instructions: LocalizedTextSchema, safety: LocalizedTextSchema,
  photoPath: z.string().max(200).regex(/^\/steps\/[A-Za-z0-9_/-]+\.(jpg|jpeg|png|webp)$/).nullable(),
})
export const TemplateSchema = z.strictObject({
  schemaVersion: z.literal(2), id: IdSchema, verified: z.boolean(), title: LocalizedTextSchema, description: LocalizedTextSchema,
  origin: z.enum(['ai', 'demo']).optional(), difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  visual: z.enum(['robot', 'car', 'organizer', 'flower', 'art']).optional(),
  estimatedMinutes: z.int().positive().max(240), materials: z.array(RequirementSchema).min(1).max(50),
  tools: z.array(z.string().trim().min(1).max(80)).max(30),
  checks: z.array(z.strictObject({ id: IdSchema, label: LocalizedTextSchema })).max(30).refine(uniqueIds, 'Duplicate check IDs'),
  // The owner performs all steps in this order; there is no assignment or shared DAG.
  steps: z.array(TemplateStepSchema).min(1).max(100).refine(uniqueIds, 'Duplicate step IDs'),
}).refine((template) => template.verified ? !template.origin && template.steps.every((step) => step.photoPath !== null) : !!template.origin && template.steps.every((step) => step.photoPath === null), 'Project provenance and photos must agree')
  .refine((template) => new Set(template.materials.map((item) => item.materialId)).size === template.materials.length, 'Duplicate requirements')
  .refine((template) => new TextEncoder().encode(JSON.stringify(template)).length <= 512_000, 'Template snapshot is too large')
export const CandidatesDocumentSchema = z.strictObject({
  schemaVersion: z.literal(2), materialRevision: z.int().nonnegative(), generatedAt: DateTimeSchema,
  candidates: z.array(z.strictObject({ templateId: IdSchema, feasible: z.boolean(), missing: z.array(LocalizedTextSchema).max(50), reason: LocalizedTextSchema })).max(20),
  source: z.enum(['ai', 'fixture']).optional(), templates: z.array(TemplateSchema).length(3).optional(),
}).refine((document) => new Set(document.candidates.map((item) => item.templateId)).size === document.candidates.length, 'Duplicate candidates')
  .refine((document) => !document.source || (document.templates?.length === 3 && document.candidates.length === 3 && document.templates.every((template) => !template.verified && document.candidates.some((candidate) => candidate.templateId === template.id))), 'Generated projects require three matching ideas')
export const ProductionDocumentSchema = z.strictObject({
  schemaVersion: z.literal(2), revision: z.int().nonnegative(), template: TemplateSchema, materialRevision: z.int().nonnegative(),
  steps: z.array(z.strictObject({ stepId: IdSchema, completedAt: DateTimeSchema.nullable() })).min(1).max(100), startedAt: DateTimeSchema,
}).refine((production) => production.steps.length === production.template.steps.length && production.steps.every((step, i) => step.stepId === production.template.steps[i]?.id && (step.completedAt === null || production.steps.slice(0, i).every((previous) => previous.completedAt !== null))), 'Inconsistent ordered progress')
export const CompletionPhotoPathSchema = z.string().max(300).regex(/^crafts\/[A-Za-z0-9_-]{1,128}\/completion\/[A-Za-z0-9_-]{1,128}\.(jpg|jpeg|png|webp)$/)
export const CompletionDocumentSchema = z.strictObject({ schemaVersion: z.literal(2), completedAt: DateTimeSchema, deleteAfter: DateTimeSchema, photoPath: CompletionPhotoPathSchema.nullable() })
  .refine((completion) => Date.parse(completion.deleteAfter) - Date.parse(completion.completedAt) === COMPLETION_RETENTION_MS, 'Completion retention must be seven days')
const MutationSchema = z.strictObject({ requestId: RequestIdSchema, craftId: IdSchema })
export const EditMaterialsInputSchema = MutationSchema.extend({ expectedRevision: z.int().nonnegative(), items: ItemsSchema, tools: z.array(z.string().trim().min(1).max(80)).max(30), checks: CheckAnswersSchema.default([]) })
export const ConfirmMaterialsInputSchema = MutationSchema.extend({ expectedRevision: z.int().nonnegative() })
export const StartCraftInputSchema = MutationSchema.extend({ templateId: IdSchema, materialRevision: z.int().nonnegative() })
export const CompleteStepInputSchema = MutationSchema.extend({ stepId: IdSchema, expectedRevision: z.int().nonnegative() })
export const CompleteCraftInputSchema = MutationSchema.extend({ photoPath: CompletionPhotoPathSchema.nullable() }).refine((input) => input.photoPath === null || input.photoPath.startsWith(`crafts/${input.craftId}/completion/`), 'Photo belongs to another craft')
export const MaterialRecognitionOutputSchema = z.strictObject({ items: z.array(MaterialSchema.extend({ source: z.literal('ai') })).max(50).refine(uniqueIds, 'Duplicate material IDs'), warnings: z.array(z.string().min(1).max(500)).max(20) })
export type Material = z.infer<typeof MaterialSchema>
export type MaterialsDocument = z.infer<typeof MaterialsDocumentSchema>
export type Template = z.infer<typeof TemplateSchema>
export type CandidatesDocument = z.infer<typeof CandidatesDocumentSchema>
export type ProductionDocument = z.infer<typeof ProductionDocumentSchema>
export type CompletionDocument = z.infer<typeof CompletionDocumentSchema>
export type MaterialRecognitionOutput = z.infer<typeof MaterialRecognitionOutputSchema>
export type EditMaterialsInput = z.input<typeof EditMaterialsInputSchema>
export type ConfirmMaterialsInput = z.infer<typeof ConfirmMaterialsInputSchema>
export type StartCraftInput = z.infer<typeof StartCraftInputSchema>
export type CompleteStepInput = z.infer<typeof CompleteStepInputSchema>
export type CompleteCraftInput = z.infer<typeof CompleteCraftInputSchema>
export function parseAiOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new GatewayError('AI_RESPONSE_INVALID')
  return parsed.data
}
