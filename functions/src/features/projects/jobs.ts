import { Timestamp } from 'firebase-admin/firestore'
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore'
import { ErrorReasonSchema } from '@rekt/shared'
import type { ErrorReason } from '@rekt/shared'
import { database } from '../../lib/database'
import { fail } from '../../lib/errors'

export async function claimProjectJob(tx: Transaction, uid: string, jobRef: DocumentReference, job: DocumentSnapshot | undefined, leaseId: string, retry?: boolean) {
  const now = Timestamp.now()
  const previous = job?.data()
  if (previous?.state === 'pending') {
    if (previous.deadline instanceof Timestamp && previous.deadline.toMillis() > now.toMillis()) fail('AI_REQUEST_IN_PROGRESS')
    if (!retry) fail('AI_TIMEOUT')
  }
  if (previous?.state === 'failed' && !retry) fail(ErrorReasonSchema.safeParse(previous.reason).data ?? 'AI_UNAVAILABLE')
  const usageRef = database.doc(`aiUsage/projects-${uid}`)
  const globalRef = database.doc('aiUsage/projects-global')
  const [usage, global] = await tx.getAll(usageRef, globalRef)
  const day = now.toDate().toISOString().slice(0, 10)
  const count = usage?.data()?.day === day ? Number(usage.data()!.count) || 0 : 0
  const total = global?.data()?.day === day ? Number(global.data()!.count) || 0 : 0
  if (count >= 20 || total >= 50) fail('AI_BUDGET_EXHAUSTED')
  tx.set(usageRef, { day, count: count + 1 }); tx.set(globalRef, { day, count: total + 1 })
  tx.set(jobRef, { state: 'pending', leaseId, createdAt: now, deadline: Timestamp.fromMillis(now.toMillis() + 90_000) })
}

export async function recordProjectFailure(jobRef: DocumentReference, leaseId: string, reason: ErrorReason) {
  await database.runTransaction(async (tx) => {
    const job = await tx.get(jobRef)
    if (job.data()?.leaseId !== leaseId) return
    tx.set(jobRef, { state: 'failed', reason, finishedAt: Timestamp.now() })
  })
}
