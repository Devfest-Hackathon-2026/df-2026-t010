import { z } from 'zod'
import { completionDeleteAfter } from './completion-retention'
import { ProductionSnapshotSchema } from './production'
import { CompletionDocumentSchema } from './workshop'
import type { CompletionDocument } from './workshop'

export const CompletionSnapshotSchema = ProductionSnapshotSchema.safeExtend({ completion: CompletionDocumentSchema }).refine(
  ({ craft, completion }) => craft.status === 'completed'
    && Date.parse(craft.completedAt!) === Date.parse(completion.completedAt)
    && (completion.photoPath === null || completion.photoPath.startsWith(`crafts/${craft.id}/completion/`)),
  'Craft and completion do not match',
)
export type CompletionSnapshot = z.infer<typeof CompletionSnapshotSchema>
export function createCompletionDocument(completedAt: string, photoPath: string | null): CompletionDocument {
  return CompletionDocumentSchema.parse({ schemaVersion: 2, completedAt, deleteAfter: completionDeleteAfter(completedAt), photoPath })
}
