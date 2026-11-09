import { Timestamp } from 'firebase-admin/firestore'
import type { Transaction } from 'firebase-admin/firestore'
import { CompleteCraftInputSchema, CompletionDocumentSchema, CompletionSnapshotSchema, createCompletionDocument, craftDocumentToSnapshot, getProductionProgress } from '@rekt/shared'
import type { CompleteCraftInput, CompletionSnapshot } from '@rekt/shared'
import { database, storeCraft, toWire } from '../../lib/database'
import { fail, parseInput } from '../../lib/errors'
import { consumeOperationLimit, operationRecord, receiptCraftId } from '../../lib/operation'
import { readCurrentProduction } from '../production/state'
import { loadCompletionPhoto } from './photo'

async function currentState(transaction: Transaction, uid: string, craftId: string) {
  const current = await readCurrentProduction(transaction, craftId, uid)
  const completionRef = current.craftRef.collection('workshop').doc('completion')
  const saved = await transaction.get(completionRef)
  if (!getProductionProgress(current.production).allStepsCompleted) fail('STEPS_NOT_COMPLETED')
  if (current.production.revision !== current.production.steps.length) fail('PRODUCTION_NOT_READY')
  let completed: CompletionSnapshot | undefined
  if (current.craft.status === 'completed') {
    const completion = CompletionDocumentSchema.safeParse(toWire(saved.data()))
    if (!completion.success) fail('PRODUCTION_NOT_READY')
    const result = CompletionSnapshotSchema.safeParse({ ...current.snapshot, completion: completion.data })
    if (!result.success) fail('PRODUCTION_NOT_READY')
    completed = result.data
  } else if (saved.exists) fail('PRODUCTION_NOT_READY')
  return { ...current, completionRef, completed }
}

export async function runCompleteCraft(uid: string, raw: CompleteCraftInput, photoLoader: (path: string) => Promise<void> = loadCompletionPhoto): Promise<CompletionSnapshot> {
  const input = parseInput(CompleteCraftInputSchema, raw)
  const { receiptRef, inputHash } = operationRecord(uid, 'completeCraft', input)
  const cachedResult = async (transaction: Transaction) => {
    const craftId = receiptCraftId(await transaction.get(receiptRef), inputHash)
    if (craftId === undefined) return undefined
    const current = await currentState(transaction, uid, craftId)
    if (!current.completed) fail('PRODUCTION_NOT_READY')
    return current.completed
  }
  const previous = await database.runTransaction(cachedResult)
  if (previous) return previous
  await consumeOperationLimit(uid, 'completeCraft', 10)
  const before = await database.runTransaction((transaction) => currentState(transaction, uid, input.craftId))
  if (before.completed && before.completed.completion.photoPath !== input.photoPath) fail('INVALID_CRAFT_STATE')
  // Authorize and verify all steps before any Storage access. Immutable photo paths
  // cannot be changed/deleted by a client. The final tx rechecks concurrent changes.
  if (!before.completed && input.photoPath !== null) await photoLoader(input.photoPath)
  return database.runTransaction(async (transaction) => {
    const cached = await cachedResult(transaction)
    if (cached) return cached
    const current = await currentState(transaction, uid, input.craftId)
    const now = Timestamp.now()
    let snapshot: CompletionSnapshot
    if (current.completed) {
      if (current.completed.completion.photoPath !== input.photoPath) fail('INVALID_CRAFT_STATE')
      snapshot = current.completed
    } else {
      const completedAt = now.toDate().toISOString()
      const completion = createCompletionDocument(completedAt, input.photoPath)
      current.craft.status = 'completed'
      current.craft.completedAt = completedAt
      current.craft.updatedAt = completedAt
      current.craft.revision++
      snapshot = CompletionSnapshotSchema.parse({ ...craftDocumentToSnapshot(input.craftId, current.craft), production: current.production, completion })
      transaction.create(current.completionRef, { ...completion, completedAt: now, deleteAfter: Timestamp.fromDate(new Date(completion.deleteAfter)) })
      transaction.set(current.craftRef, storeCraft(current.craft))
    }
    transaction.create(receiptRef, { inputHash, craftId: input.craftId, createdAt: now })
    return snapshot
  })
}
