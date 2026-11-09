import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import type { DocumentSnapshot } from 'firebase-admin/firestore'
import { database } from './database'
import { fail } from './errors'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export function operationRecord(uid: string, operation: string, input: { requestId: string }) {
  return { receiptRef: database.doc(`operationReceipts/${hash(`${uid}\0${operation}\0${input.requestId}`)}`), inputHash: hash(JSON.stringify(input)) }
}
export function receiptCraftId(snapshot: DocumentSnapshot, inputHash: string): string | undefined {
  if (!snapshot.exists) return undefined
  const receipt = snapshot.data()!
  if (receipt.inputHash !== inputHash) fail('IDEMPOTENCY_CONFLICT')
  if (typeof receipt.craftId !== 'string') fail('INTERNAL_ERROR')
  return receipt.craftId
}
// Consume in a separate transaction so rejected business attempts also count.
// A known successful retry must be resolved before calling this function.
export async function consumeOperationLimit(uid: string, operation: string, maximum: number) {
  const ref = database.doc(`operationLimits/${hash(`${uid}\0${operation}`)}`)
  const now = Timestamp.now()
  await database.runTransaction(async (transaction) => {
    const previous = (await transaction.get(ref)).data()
    const current = previous?.windowStart instanceof Timestamp && now.toMillis() - previous.windowStart.toMillis() < 60_000
    const attempts = current && typeof previous?.attempts === 'number' ? previous.attempts : 0
    if (attempts >= maximum) fail('RATE_LIMITED')
    transaction.set(ref, { windowStart: current ? previous!.windowStart : now, attempts: attempts + 1, expiresAt: Timestamp.fromMillis(now.toMillis() + 60_000) })
  })
}
