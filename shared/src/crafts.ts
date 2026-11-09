import { z } from 'zod'
import { DateTimeSchema, IdSchema, RequestIdSchema } from './common'
import { LanguageSchema } from './contracts'

export const CraftStatusSchema = z.enum(['materials', 'project_selection', 'crafting', 'completed'])
export type CraftStatus = z.infer<typeof CraftStatusSchema>
const CraftFieldsSchema = z.strictObject({
  id: IdSchema, ownerUid: IdSchema, locale: LanguageSchema, status: CraftStatusSchema,
  revision: z.int().nonnegative(), selectedTemplateId: IdSchema.nullable(),
  createdAt: DateTimeSchema, updatedAt: DateTimeSchema, completedAt: DateTimeSchema.nullable(),
})
const validState = (craft: { status: CraftStatus; selectedTemplateId: string | null; completedAt: string | null }) =>
  (craft.status === 'completed') === (craft.completedAt !== null) && ['crafting', 'completed'].includes(craft.status) === (craft.selectedTemplateId !== null)
export const CraftSchema = CraftFieldsSchema.refine(validState, 'Inconsistent craft state')
export const CraftDocumentSchema = CraftFieldsSchema.omit({ id: true }).extend({ schemaVersion: z.literal(2) }).refine(validState, 'Inconsistent craft state')
export const CraftSnapshotSchema = z.strictObject({ schemaVersion: z.literal(2), craft: CraftSchema })
export type Craft = z.infer<typeof CraftSchema>
export type CraftDocument = z.infer<typeof CraftDocumentSchema>
export type CraftSnapshot = z.infer<typeof CraftSnapshotSchema>
export const CreateCraftInputSchema = z.strictObject({ requestId: RequestIdSchema, locale: LanguageSchema })
export type CreateCraftInput = z.infer<typeof CreateCraftInputSchema>
export function craftDocumentToSnapshot(id: string, value: unknown): CraftSnapshot {
  const { schemaVersion, ...craft } = CraftDocumentSchema.parse(value)
  return CraftSnapshotSchema.parse({ schemaVersion, craft: { id, ...craft } })
}
export const CRAFT_STAGE_PATHS: Record<CraftStatus, string> = { materials: 'materials', project_selection: 'projects', crafting: 'craft', completed: 'complete' }
export function craftPath(craft: CraftSnapshot['craft']) { return `/crafts/${encodeURIComponent(craft.id)}/${CRAFT_STAGE_PATHS[craft.status]}` }
