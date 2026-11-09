import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { COMPLETION_RETENTION_MS, completionSnapshots, createCompletionDocument } from '@rekt/shared'
import type { CleanupEffects } from '../../functions/src/features/cleanup/operations'

const project = 'demo-co-make'
const bucketName = `${project}.appspot.com`
// Earlier than every other suite's fixtures: never age another suite's craft.
const completedAt = '2025-01-01T00:00:00.000Z'
const now = Timestamp.fromDate(new Date('2025-01-08T00:00:00.000Z'))
const owned = new Set<string>()
let env: RulesTestEnvironment
let service: typeof import('../../functions/src/features/cleanup/operations')
let storeCraft: typeof import('../../functions/src/lib/database').storeCraft
let completeCraft: typeof import('../../functions/src/features/completion/operations').runCompleteCraft

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
async function seed(photos = false) {
  const id = `cleanup-${randomUUID()}`
  owned.add(id)
  const owner = `owner-${randomUUID()}`
  const ref = getFirestore().doc(`crafts/${id}`)
  const { id: fixtureId, ...fields } = completionSnapshots.withoutPhoto.craft
  expect(fixtureId).toBeTruthy()
  const craft = { schemaVersion: 2 as const, ...fields, ownerUid: owner, createdAt: completedAt, completedAt, updatedAt: completedAt }
  const completion = createCompletionDocument(completedAt, photos ? `crafts/${id}/completion/chosen.png` : null)
  const batch = getFirestore().batch()
  batch.set(ref, storeCraft(craft))
  batch.set(ref.collection('workshop').doc('completion'), { ...completion, completedAt: Timestamp.fromDate(new Date(completedAt)), deleteAfter: now })
  for (const name of ['materials', 'candidates', 'production']) batch.set(ref.collection('workshop').doc(name), { fixture: name })
  batch.set(ref.collection('recognitionRequests').doc('request'), { input: 'private' })
  batch.set(ref.collection('projectState').doc('current').collection('nested').doc('child'), { private: true })
  batch.set(getFirestore().collection('operationReceipts').doc(`receipt-${id}`), { craftId: id, inputHash: 'private' })
  await batch.commit()
  if (photos) {
    for (const suffix of ['materials/source.png', 'completion/chosen.png', 'completion/unused.png']) await getStorage().bucket().file(`crafts/${id}/${suffix}`).save('contract-only', { resumable: false, contentType: 'image/png' })
  }
  return { id, owner, ref, completion: ref.collection('workshop').doc('completion'), job: getFirestore().collection(service.CLEANUP_JOBS).doc(id) }
}
async function exists(path: string) { return (await getStorage().bucket().file(path).exists())[0] }
async function waitUntilDeleted(path: string) {
  const deadline = Date.now() + 15_000
  while (await exists(path)) {
    if (Date.now() >= deadline) throw new Error('Storage finalize cleanup did not run')
    await new Promise((done) => setTimeout(done, 100))
  }
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.STORAGE_EMULATOR_HOST?.startsWith('http://127.0.0.1:')) throw new Error('Run test:emulators; real services are forbidden')
  process.env.GCLOUD_PROJECT = project
  if (!getApps().length) initializeApp({ projectId: project, storageBucket: bucketName })
  service = await import('../../functions/src/features/cleanup/operations')
  storeCraft = (await import('../../functions/src/lib/database')).storeCraft
  completeCraft = (await import('../../functions/src/features/completion/operations')).runCompleteCraft
  env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') }, storage: { host: '127.0.0.1', port: 9198, rules: await readFile('storage.rules', 'utf8') } })
})
afterEach(async () => {
  for (const id of owned) {
    await getFirestore().recursiveDelete(getFirestore().doc(`crafts/${id}`))
    await getFirestore().collection(service.CLEANUP_JOBS).doc(id).delete()
    const receipts = await getFirestore().collection('operationReceipts').where('craftId', '==', id).get()
    for (const receipt of receipts.docs) await receipt.ref.delete()
    await getStorage().bucket().deleteFiles({ prefix: `crafts/${id}/`, force: true })
  }
  owned.clear()
  await getFirestore().recursiveDelete(getFirestore().collection(service.CLEANUP_SCAN))
})
afterAll(async () => { await env?.cleanup() })

describe('seven-day retention cleanup', () => {
  it('preserves the craft until its exact deadline and deletes its public post, children, receipts and photos', async () => {
    const r = await seed(true)
    const neighbour = await seed(true)
    await neighbour.ref.update({ completedAt: Timestamp.fromMillis(now.toMillis()) })
    const prefixNeighbour = `crafts/${r.id}-other/materials/source.png`
    const post = getFirestore().collection('galleryPosts').doc(r.id)
    const neighbourPost = getFirestore().collection('galleryPosts').doc(neighbour.id)
    const publication = (craft: typeof r, deleteAfter: string) => ({
      id: craft.id, ownerUid: craft.owner, photoPath: `crafts/${craft.id}/completion/chosen.png`,
      title: { ja: '検証用作品', en: 'Test work' }, visual: 'art', author: 'Maker', caption: '',
      createdAt: completedAt, deleteAfter, likedBy: ['reader'], bookmarkedBy: ['reader'],
      comments: [{ id: 'comment', author: 'Viewer', text: 'Great work', createdAt: completedAt }],
    })
    await post.set(publication(r, now.toDate().toISOString()))
    await neighbourPost.set(publication(neighbour, new Date(now.toMillis() + COMPLETION_RETENTION_MS).toISOString()))
    await getStorage().bucket().file(prefixNeighbour).save('other', { resumable: false })
    try {
      expect((await service.runRetentionCleanup(Timestamp.fromMillis(now.toMillis() - 1))).queued).toBe(0)
      expect((await r.ref.get()).exists).toBe(true)
      expect((await post.get()).exists).toBe(true)
      expect((await service.runRetentionCleanup(now)).purged).toBe(1)
      expect((await r.ref.get()).exists).toBe(false)
      expect((await post.get()).exists).toBe(false)
      expect(await r.ref.listCollections()).toHaveLength(0)
      expect((await getFirestore().collection('operationReceipts').where('craftId', '==', r.id).get()).empty).toBe(true)
      expect((await getStorage().bucket().getFiles({ prefix: `crafts/${r.id}/` }))[0]).toHaveLength(0)
      expect((await neighbour.ref.get()).exists).toBe(true)
      expect((await neighbourPost.get()).exists).toBe(true)
      expect((await getFirestore().collection('operationReceipts').where('craftId', '==', neighbour.id).get()).empty).toBe(false)
      expect(await exists(`crafts/${neighbour.id}/completion/chosen.png`)).toBe(true)
      expect(await exists(prefixNeighbour)).toBe(true)
      expect((await r.job.get()).data()).toMatchObject({ phase: 'tombstone', token: null, attempts: 1 })
      expect(Object.keys((await r.job.get()).data()!)).not.toContain('ownerUid')
      expect((await service.runRetentionCleanup(now)).purged).toBe(0)
    } finally {
      await Promise.all([post.delete(), neighbourPost.delete(), getStorage().bucket().file(prefixNeighbour).delete({ ignoreNotFound: true })])
    }
  })
  it('never treats missing, corrupt, legacy, foreign-photo or unfinished records as deletion permission', async () => {
    const records = await Promise.all(Array.from({ length: 6 }, () => seed()))
    await records[0]!.completion.delete()
    await records[1]!.completion.update({ deleteAfter: Timestamp.fromMillis(now.toMillis() - 1) })
    await records[2]!.ref.update({ schemaVersion: 1 })
    await records[3]!.completion.update({ photoPath: `crafts/${records[0]!.id}/completion/a.png` })
    await records[4]!.ref.update({ status: 'materials', selectedTemplateId: null, completedAt: null, updatedAt: now })
    await records[5]!.completion.update({ deleteAfter: now.toDate().toISOString() })
    expect(await service.runRetentionCleanup(now)).toMatchObject({ queued: 0, invalid: 5 })
    for (const r of records) expect((await r.ref.get()).exists).toBe(true)
  })
  it.each(['objects', 'documents', 'receipts'] as const)('recovers from a partial %s failure with a durable job and backoff', async (stage) => {
    const r = await seed(true)
    const effects: CleanupEffects = { ...service.cleanupEffects, [stage]: async () => { throw new Error('simulated private failure') } }
    expect((await service.runRetentionCleanup(now, effects)).failed).toBe(1)
    expect((await r.ref.get()).exists).toBe(false)
    expect((await r.job.get()).data()).toMatchObject({ phase: 'purging', token: null, attempts: 1 })
    expect((await service.runRetentionCleanup(Timestamp.fromMillis(now.toMillis() + 299_999))).purged).toBe(0)
    expect((await service.runRetentionCleanup(Timestamp.fromMillis(now.toMillis() + 300_000))).purged).toBe(1)
    expect((await r.job.get()).data()).toMatchObject({ phase: 'tombstone', attempts: 2 })
  })
  it('leases a job once across overlapping runs, revokes client access and prevents successful retries from resurrecting it', async () => {
    const r = await seed()
    const entered = gate(); const release = gate()
    const first = service.runRetentionCleanup(now, { ...service.cleanupEffects, objects: async () => { entered.resolve(); await release.promise; return true } })
    await entered.promise
    try {
      expect((await service.runRetentionCleanup(now)).purged).toBe(0)
      const db = env.authenticatedContext(r.owner).firestore()
      await assertFails(db.doc(r.ref.path).get())
      await assertFails(db.doc(r.job.path).get())
      await assertFails(db.doc(r.job.path).set({ availableAfter: new Date() }))
      await assertFails(db.doc(`${r.ref.path}/workshop/completion`).get())
      await assertFails(Promise.resolve(env.authenticatedContext(r.owner).storage(`gs://${bucketName}`).ref(`crafts/${r.id}/materials/late.png`).putString('late')))
      await expect(completeCraft(r.owner, { requestId: randomUUID(), craftId: r.id, photoPath: null })).rejects.toMatchObject({ details: { reason: 'CRAFT_NOT_FOUND' } })
    } finally { release.resolve() }
    expect((await first).purged).toBe(1)
    expect((await r.ref.get()).exists).toBe(false)
  })
  it('takes over a timed-out lease and refuses to delete an unexpectedly recreated parent', async () => {
    const r = await seed()
    await service.runRetentionCleanup(now, { ...service.cleanupEffects, objects: async () => false })
    await r.job.update({ token: randomUUID(), availableAfter: Timestamp.fromMillis(now.toMillis() + 600_000) })
    expect((await service.runRetentionCleanup(Timestamp.fromMillis(now.toMillis() + 599_999))).purged).toBe(0)
    expect((await service.runRetentionCleanup(Timestamp.fromMillis(now.toMillis() + 600_000))).purged).toBe(1)
    await r.ref.set({ ownerUid: 'new-owner', schemaVersion: 2, status: 'materials' })
    const due = (await r.job.get()).data()!.availableAfter as Timestamp
    expect((await service.runRetentionCleanup(due)).failed).toBe(1)
    expect((await r.ref.get()).data()?.ownerUid).toBe('new-owner')
  })
  it('leaves a resumable job after the receipt work limit and finishes its remaining page next run', async () => {
    const r = await seed()
    for (let offset = 0; offset < 501; offset += 250) {
      const batch = getFirestore().batch()
      for (let i = offset; i < Math.min(offset + 250, 501); i++) batch.set(getFirestore().collection('operationReceipts').doc(`${r.id}-${i}`), { craftId: r.id })
      await batch.commit()
    }
    expect((await service.runRetentionCleanup(now)).pending).toBe(1)
    expect((await r.job.get()).data()?.phase).toBe('purging')
    expect((await getFirestore().collection('operationReceipts').where('craftId', '==', r.id).get()).size).toBe(2)
    expect((await service.runRetentionCleanup(Timestamp.fromMillis(now.toMillis() + 300_000))).purged).toBe(1)
  })
  it('handles more than one scheduler batch without skipping other expired crafts', async () => {
    const records = []
    for (let i = 0; i < 26; i++) records.push(await seed())
    expect((await service.runRetentionCleanup(now)).purged).toBe(25)
    expect((await service.runRetentionCleanup(now)).purged).toBe(1)
    for (const r of records) expect((await r.ref.get()).exists).toBe(false)
  }, 30_000)
  it('continues scanning after a full budget of malformed records instead of starving later valid crafts', async () => {
    const good = await seed()
    const batch = getFirestore().batch()
    for (let i = 0; i < 100; i++) {
      const id = `cleanup-bad-${randomUUID()}`
      owned.add(id)
      batch.set(getFirestore().doc(`crafts/${id}`), { status: 'completed', completedAt: Timestamp.fromMillis(Date.parse(completedAt) - 1) })
    }
    await batch.commit()
    expect(await service.runRetentionCleanup(now)).toMatchObject({ queued: 0, invalid: 100 })
    expect((await good.ref.get()).exists).toBe(true)
    expect((await service.runRetentionCleanup(now)).purged).toBe(1)
    expect((await good.ref.get()).exists).toBe(false)
  }, 30_000)
  it.each(['materials', 'project_selection', 'crafting'] as const)('expires unfinished %s work from updatedAt, with the same descendant and photo cleanup', async (status) => {
    const r = await seed(true)
    await r.completion.delete()
    await r.ref.update({ status, selectedTemplateId: status === 'crafting' ? 'contract-test' : null, completedAt: null })
    expect((await service.runRetentionCleanup(Timestamp.fromMillis(now.toMillis() - 1))).queued).toBe(0)
    expect((await service.runRetentionCleanup(now)).purged).toBe(1)
    expect((await r.ref.get()).exists).toBe(false)
    expect(await r.ref.listCollections()).toHaveLength(0)
    expect((await getStorage().bucket().getFiles({ prefix: `crafts/${r.id}/` }))[0]).toHaveLength(0)
  })
  it('uses the latest persisted edit, skips an inconsistent unfinished completion and keeps active work', async () => {
    const active = await seed()
    await active.completion.delete()
    await active.ref.update({ status: 'materials', selectedTemplateId: null, completedAt: null, updatedAt: now })
    const corrupt = await seed()
    await corrupt.ref.update({ status: 'materials', selectedTemplateId: null, completedAt: null })
    expect(await service.runRetentionCleanup(now)).toMatchObject({ queued: 0, invalid: 1 })
    expect((await active.ref.get()).exists).toBe(true)
    expect((await corrupt.ref.get()).exists).toBe(true)
    await corrupt.ref.update({ updatedAt: now })
    expect((await service.runRetentionCleanup(Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60_000 - 1))).queued).toBe(0)
  })
  it('rechecks a fresh edit committed after discovery and before the deletion transaction', async () => {
    const r = await seed()
    await r.completion.delete()
    await r.ref.update({ status: 'materials', selectedTemplateId: null, completedAt: null })
    const db = getFirestore()
    const original = db.runTransaction.bind(db)
    const spy = vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (update) => {
      await r.ref.update({ updatedAt: now, revision: 100 })
      return original(update)
    })
    try {
      expect(await service.runRetentionCleanup(now)).toMatchObject({ queued: 0, invalid: 0 })
      expect((await r.ref.get()).data()?.revision).toBe(100)
      expect((await r.job.get()).exists).toBe(false)
    } finally { spy.mockRestore() }
  })
  it('removes a photo finalized after deletion through the real Storage trigger and retires the minimal marker after its final sweep', async () => {
    const r = await seed()
    await service.runRetentionCleanup(now)
    const late = `crafts/${r.id}/completion/late.png`
    await getStorage().bucket().file(late).save('late contract-only upload', { resumable: false })
    await waitUntilDeleted(late)
    await service.purgeLateCraftObject(bucketName, late, '1') // duplicate/404 is successful
    const due = (await r.job.get()).data()!.retireAfter as Timestamp
    expect(due.toMillis() - now.toMillis()).toBe(service.CLEANUP_MARKER_MS)
    expect((await service.runRetentionCleanup(Timestamp.fromMillis(due.toMillis() - 1))).retired).toBe(0)
    expect((await service.runRetentionCleanup(due)).retired).toBe(1)
    expect((await r.job.get()).exists).toBe(false)
  })
  it('keeps a normal craft photo, unrelated orphan and anonymous account outside this cleanup scope', async () => {
    const r = await seed(true)
    const db = env.authenticatedContext(r.owner).firestore()
    await assertSucceeds(db.doc(r.ref.path).get())
    const name = `crafts/${r.id}/completion/chosen.png`
    const [meta] = await getStorage().bucket().file(name).getMetadata()
    await service.purgeLateCraftObject(bucketName, name, String(meta.generation))
    expect(await exists(name)).toBe(true)
    await service.purgeLateCraftObject('foreign-bucket', name, String(meta.generation))
    await service.purgeLateCraftObject(bucketName, 'public/steps/real.png', '1')
    const orphanId = `cleanup-orphan-${randomUUID()}`
    owned.add(orphanId)
    const orphan = `crafts/${orphanId}/materials/a.png`
    await getStorage().bucket().file(orphan).save('unclassified orphan', { resumable: false })
    await service.purgeLateCraftObject(bucketName, orphan, '1')
    const auth = await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })
    const credentials = await auth.json() as { localId: string }
    await service.runRetentionCleanup(now)
    const { getAuth } = await import('firebase-admin/auth')
    expect((await getAuth().getUser(credentials.localId)).uid).toBe(credentials.localId)
    expect(await exists(orphan)).toBe(true)
  })
})
