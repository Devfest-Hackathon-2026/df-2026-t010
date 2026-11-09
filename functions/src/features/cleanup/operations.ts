import { randomUUID } from 'node:crypto'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import type { DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { error, warn } from 'firebase-functions/logger'
import { COMPLETION_RETENTION_MS, UNFINISHED_RETENTION_MS, IdSchema, RequestIdSchema } from '@rekt/shared'
import { database, toWire } from '../../lib/database'
import { isExpiredCompletion, isExpiredUnfinished } from './policy'
import { deleteCraftObjects, deleteObjectGeneration } from './storage'

const PAGE_SIZE = 25
const LEASE_MS = 10 * 60_000 // Longer than the function's five-minute timeout.
const RETRY_MS = 5 * 60_000
// A resumable upload started before removal can finish for up to one week.
// Keep only a private deletion marker for eight days, then sweep once more.
export const CLEANUP_MARKER_MS = 8 * 24 * 60 * 60_000
export const CLEANUP_JOBS = 'craftCleanupJobs'
export const CLEANUP_SCAN = 'craftCleanupState'
type ExpiryKind = 'completed' | 'unfinished'
type Job = {
  schemaVersion: 1; phase: 'purging' | 'tombstone'; startedAt: Timestamp
  availableAfter: Timestamp; retireAfter: Timestamp | null; attempts: number
  token: string | null; lastFailure: string | null
}
export type CleanupEffects = {
  objects: (craftId: string) => Promise<boolean>
  documents: (craftId: string) => Promise<void>
  receipts: (craftId: string) => Promise<boolean>
}
export const cleanupEffects: CleanupEffects = {
  objects: deleteCraftObjects,
  documents: async (id) => {
    await database.collection('galleryPosts').doc(id).delete()
    await database.recursiveDelete(database.doc(`crafts/${id}`))
  },
  receipts: async (id) => {
    const query = database.collection('operationReceipts').where('craftId', '==', id).limit(100)
    for (let page = 0; page < 5; page++) {
      const saved = await query.get()
      if (saved.empty) return true
      const batch = database.batch()
      for (const doc of saved.docs) batch.delete(doc.ref)
      await batch.commit()
    }
    return (await query.limit(1).get()).empty
  },
}

function readJob(saved: DocumentSnapshot): Job {
  const job = saved.data()
  if (!IdSchema.safeParse(saved.id).success || job?.schemaVersion !== 1
    || !['purging', 'tombstone'].includes(job.phase)
    || !(job.startedAt instanceof Timestamp) || !(job.availableAfter instanceof Timestamp)
    || !Number.isSafeInteger(job.attempts) || job.attempts < 0
    || (job.token !== null && !RequestIdSchema.safeParse(job.token).success)
    || (job.lastFailure !== null && !['root', 'storage', 'documents', 'receipts'].includes(job.lastFailure))
    || (job.phase === 'purging' ? job.retireAfter !== null : !(job.retireAfter instanceof Timestamp)
      || job.retireAfter.toMillis() < job.startedAt.toMillis() + CLEANUP_MARKER_MS
      || job.availableAfter.toMillis() < job.retireAfter.toMillis())) throw new Error('Invalid cleanup job')
  return job as Job
}

async function enqueueExpired(craftId: string, kind: ExpiryKind, now: Timestamp): Promise<'queued' | 'invalid' | 'skipped'> {
  const root = database.doc(`crafts/${craftId}`)
  const job = database.collection(CLEANUP_JOBS).doc(craftId)
  return database.runTransaction(async (tx) => {
    const [saved, completion, previous] = await tx.getAll(root, root.collection('workshop').doc('completion'), job)
    if (!saved?.exists || previous?.exists) return 'skipped'
    const current = saved.data()!
    if (kind === 'unfinished' && (current.status === 'completed'
      || (current.updatedAt instanceof Timestamp && current.updatedAt.toMillis() + UNFINISHED_RETENTION_MS > now.toMillis()))) return 'skipped'
    if (kind === 'completed' && (current.status !== 'completed'
      || (current.completedAt instanceof Timestamp && current.completedAt.toMillis() + COMPLETION_RETENTION_MS > now.toMillis()))) return 'skipped'
    const valid = kind === 'completed'
      ? saved.data()?.completedAt instanceof Timestamp && completion?.data()?.deleteAfter instanceof Timestamp
        && completion.data()?.completedAt instanceof Timestamp
        && isExpiredCompletion(craftId, toWire(saved.data()), toWire(completion.data()), now.toMillis())
      : saved.data()?.updatedAt instanceof Timestamp && !completion?.exists
        && isExpiredUnfinished(craftId, toWire(saved.data()), now.toMillis())
    // Another business transaction may have just refreshed the unfinished craft.
    // Validate its current state and deadline, never the earlier query snapshot.
    if (!valid) return 'invalid'
    // Durable recovery and loss of client/backend access are atomic. All business
    // transactions read the parent, so in-flight writes cannot resurrect children.
    tx.create(job, { schemaVersion: 1, phase: 'purging', startedAt: now, availableAfter: now,
      retireAfter: null, attempts: 0, token: null, lastFailure: null } satisfies Job)
    tx.delete(root)
    return 'queued'
  })
}

async function claim(ref: DocumentReference, now: Timestamp) {
  return database.runTransaction(async (tx) => {
    const saved = await tx.get(ref)
    if (!saved.exists) return undefined
    const job = readJob(saved)
    if (job.availableAfter.toMillis() > now.toMillis()) return undefined
    const token = randomUUID()
    tx.update(ref, { token, attempts: job.attempts + 1, availableAfter: Timestamp.fromMillis(now.toMillis() + LEASE_MS) })
    return { ...job, attempts: job.attempts + 1, token }
  })
}

async function finish(ref: DocumentReference, job: Job, now: Timestamp, complete: boolean, failure: string | null) {
  await database.runTransaction(async (tx) => {
    const saved = await tx.get(ref)
    if (!saved.exists || saved.data()?.token !== job.token) return
    if (complete && job.phase === 'tombstone') { tx.delete(ref); return }
    const retireAfter = complete ? Timestamp.fromMillis(now.toMillis() + CLEANUP_MARKER_MS) : job.retireAfter
    tx.update(ref, {
      phase: complete ? 'tombstone' : job.phase, retireAfter,
      availableAfter: complete ? retireAfter : Timestamp.fromMillis(now.toMillis() + RETRY_MS),
      token: null, lastFailure: failure,
    })
  })
}

async function discoverExpired(kind: ExpiryKind, now: Timestamp) {
  let queued = 0; let invalid = 0
  const field = kind === 'completed' ? 'completedAt' : 'updatedAt'
  const cutoff = Timestamp.fromMillis(now.toMillis() - (kind === 'completed' ? COMPLETION_RETENTION_MS : UNFINISHED_RETENTION_MS))
  const crafts = database.collection('crafts')
  const states = kind === 'completed' ? crafts.where('status', '==', 'completed') : crafts.where('status', 'in', ['materials', 'project_selection', 'crafting'])
  const query = states.where(field, '<=', cutoff).orderBy(field).orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
  const scanRef = database.collection(CLEANUP_SCAN).doc(kind)
  let cursor = (await scanRef.get()).data()
  if (cursor && (!(cursor.at instanceof Timestamp) || typeof cursor.craftId !== 'string' || !cursor.craftId || cursor.craftId.includes('/'))) throw new Error('Invalid cleanup scan cursor')
  // Resume bounded scans across invocations too: a large set of malformed
  // candidates must not permanently hide valid records later in the index.
  for (let page = 0; page < 4 && queued < PAGE_SIZE; page++) {
    const candidates = await (cursor ? query.startAfter(cursor.at, cursor.craftId) : query).get()
    for (const candidate of candidates.docs) {
      const result = await enqueueExpired(candidate.id, kind, now)
      cursor = { at: candidate.data()[field], craftId: candidate.id }
      if (result === 'queued') queued++
      if (result === 'invalid') { invalid++; warn('craft_cleanup_invalid_candidate', { craftId: candidate.id, kind }) }
      if (queued === PAGE_SIZE) break
    }
    if (candidates.size < PAGE_SIZE) { cursor = undefined; break }
  }
  if (cursor) await scanRef.set(cursor)
  else await scanRef.delete()
  return { queued, invalid }
}

export async function runRetentionCleanup(now = Timestamp.now(), effects: CleanupEffects = cleanupEffects) {
  const summary = { queued: 0, invalid: 0, purged: 0, retired: 0, pending: 0, failed: 0 }
  for (const kind of ['completed', 'unfinished'] as const) {
    const result = await discoverExpired(kind, now)
    summary.queued += result.queued; summary.invalid += result.invalid
  }
  const due = await database.collection(CLEANUP_JOBS).where('availableAfter', '<=', now).orderBy('availableAfter').limit(PAGE_SIZE * 2).get()
  for (const saved of due.docs) {
    let job: Job | undefined
    let stage = 'root'
    try {
      job = await claim(saved.ref, now)
      if (!job) continue
      // An unexpected parent is an operational conflict, never permission to
      // delete a new craft that happens to reuse this ID.
      if ((await database.doc(`crafts/${saved.id}`).get()).exists) throw new Error('Parent reappeared')
      stage = 'storage'
      const objectsDone = await effects.objects(saved.id)
      stage = 'documents'
      await effects.documents(saved.id)
      stage = 'receipts'
      const receiptsDone = await effects.receipts(saved.id)
      const complete = objectsDone && receiptsDone
      await finish(saved.ref, job, now, complete, null)
      if (!complete) summary.pending++
      else if (job.phase === 'purging') summary.purged++
      else summary.retired++
    } catch {
      summary.failed++
      error('craft_cleanup_failed', { craftId: saved.id, stage, attempts: job?.attempts })
      if (job) await finish(saved.ref, job, now, false, stage)
    }
  }
  return summary
}

export async function purgeLateCraftObject(bucket: string, name: string, generation: string) {
  const match = /^crafts\/([A-Za-z0-9_-]{1,128})\/.+/.exec(name)
  if (!match || bucket !== getStorage().bucket().name) return
  const [saved, root] = await database.getAll(database.collection(CLEANUP_JOBS).doc(match[1]!), database.doc(`crafts/${match[1]}`))
  if (!saved?.exists || root?.exists) return
  readJob(saved)
  await deleteObjectGeneration(bucket, name, generation)
}
