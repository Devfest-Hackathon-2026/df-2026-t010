import { CompletionDocumentSchema, CraftDocumentSchema, IdSchema, unfinishedDeleteAfter } from '@rekt/shared'

// Input has already crossed the Firestore Timestamp -> ISO boundary.
export function isExpiredCompletion(craftId: string, root: unknown, saved: unknown, now: number): boolean {
  const craft = CraftDocumentSchema.safeParse(root)
  const completion = CompletionDocumentSchema.safeParse(saved)
  return IdSchema.safeParse(craftId).success && Number.isFinite(now)
    && craft.success && craft.data.status === 'completed'
    && Date.parse(craft.data.createdAt) <= Date.parse(craft.data.completedAt!)
    && completion.success
    && Date.parse(craft.data.completedAt!) === Date.parse(completion.data.completedAt)
    && Date.parse(completion.data.deleteAfter) <= now
    && (completion.data.photoPath === null || completion.data.photoPath.startsWith(`crafts/${craftId}/completion/`))
}

export function isExpiredUnfinished(craftId: string, root: unknown, now: number): boolean {
  const craft = CraftDocumentSchema.safeParse(root)
  return IdSchema.safeParse(craftId).success && Number.isFinite(now)
    && craft.success && craft.data.status !== 'completed'
    && Date.parse(craft.data.createdAt) <= Date.parse(craft.data.updatedAt)
    && Date.parse(unfinishedDeleteAfter(craft.data.updatedAt)) <= now
}
