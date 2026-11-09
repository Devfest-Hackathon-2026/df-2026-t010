import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { CraftSnapshotSchema, PHOTO_LIMITS, PhotoUploadReservationSchema, materialsFixture, productionSnapshots } from '@rekt/shared'
import type { ReservePhotoUploadInput } from '@rekt/shared'

const project = 'demo-co-make'
const bucket = `gs://${project}.appspot.com`
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=', 'base64')
type Guest = { idToken: string; localId: string }
let env: RulesTestEnvironment
let reserve: typeof import('../../functions/src/features/photos/operations').runReservePhotoUpload
let storeProduction: typeof import('../../functions/src/lib/database').storeProduction
let previousGlobal: Record<string, unknown> | undefined
const roots: string[] = []
const users: string[] = []
const denied = (reason: string) => ({ details: { reason } })
const day = () => new Date().toISOString().slice(0, 10)
const globalRef = () => getFirestore().doc('photoUploadUsage/global')
const uidRef = (uid: string) => getFirestore().doc(`photoUploadUsage/uid-${createHash('sha256').update(uid).digest('hex')}`)
async function guest(): Promise<Guest> {
  const r = await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })
  expect(r.ok).toBe(true)
  const result = await r.json() as Guest
  users.push(result.localId)
  return result
}
async function call(name: string, user: Guest | undefined, data: unknown) {
  const r = await fetch(`http://127.0.0.1:5002/${project}/asia-northeast1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.idToken}` } : {}) }, body: JSON.stringify({ data }) })
  const body = await r.json() as { result?: unknown; error?: { details?: { reason?: string } } }
  return { status: r.status, result: body.result, reason: body.error?.details?.reason }
}
async function ready(completion: 'none' | 'unfinished' | 'ready' = 'none') {
  const owner = await guest(); const other = await guest()
  const created = CraftSnapshotSchema.parse((await call('createCraft', owner, { requestId: randomUUID(), locale: 'ja' })).result)
  const craftId = created.craft.id
  roots.push(craftId)
  const ref = getFirestore().doc(`crafts/${craftId}`)
  if (completion !== 'none') {
    const production = completion === 'ready' ? productionSnapshots.allStepsCompleted.production : productionSnapshots.firstStepCompleted.production
    await ref.update({ status: 'crafting', selectedTemplateId: production.template.id })
    await ref.collection('workshop').doc('production').set(storeProduction(production))
    await ref.collection('workshop').doc('materials').set({ ...materialsFixture, updatedAt: Timestamp.now(), confirmedAt: Timestamp.now() })
  }
  const input: ReservePhotoUploadInput = { craftId, photoId: randomUUID(), kind: completion === 'none' ? 'materials' : 'completion', contentType: 'image/png', sizeBytes: png.length }
  return { owner, other, ref, input, quota: ref.collection('photoUploads').doc('_quota'), storage: env.authenticatedContext(owner.localId).storage(bucket) }
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.STORAGE_EMULATOR_HOST) throw new Error('Use local test:emulators only')
  process.env.GCLOUD_PROJECT = project
  if (!getApps().length) initializeApp({ projectId: project, storageBucket: `${project}.appspot.com` })
  reserve = (await import('../../functions/src/features/photos/operations')).runReservePhotoUpload
  storeProduction = (await import('../../functions/src/lib/database')).storeProduction
  env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') }, storage: { host: '127.0.0.1', port: 9198, rules: await readFile('storage.rules', 'utf8') } })
})
beforeEach(async () => {
  previousGlobal = (await globalRef().get()).data()
  await globalRef().set({ schemaVersion: 1, day: day(), files: 0, bytes: 0 })
})
afterEach(async () => {
  for (const id of roots.splice(0)) await getFirestore().recursiveDelete(getFirestore().doc(`crafts/${id}`))
  for (const uid of users.splice(0)) await uidRef(uid).delete()
  if (previousGlobal) await globalRef().set(previousGlobal)
  else await globalRef().delete()
})
afterAll(async () => { await env?.cleanup() })

describe('server-reserved photo uploads', () => {
  it('rejects anonymous, foreign, missing and authority-bearing requests before reserving space', async () => {
    const r = await ready()
    expect((await call('reservePhotoUpload', undefined, r.input)).reason).toBe('UNAUTHENTICATED')
    expect((await call('reservePhotoUpload', r.other, r.input)).reason).toBe('NOT_CRAFT_OWNER')
    expect((await call('reservePhotoUpload', r.owner, { ...r.input, craftId: 'missing' })).reason).toBe('CRAFT_NOT_FOUND')
    for (const patch of [{ sizeBytes: 0 }, { sizeBytes: 5 * 1024 * 1024 + 1 }, { ownerUid: r.owner.localId }, { photoId: '../other' }, { kind: 'public' }, { contentType: 'text/plain' }]) expect((await call('reservePhotoUpload', r.owner, { ...r.input, ...patch })).reason).toBe('VALIDATION_FAILED')
    expect((await r.quota.get()).exists).toBe(false)
  })
  it('requires a reservation for real SDK upload and binds its owner, filename, size and MIME', async () => {
    const r = await ready()
    const path = `crafts/${r.input.craftId}/materials/${r.input.photoId}.png`
    const ref = r.storage.ref(path)
    await assertFails(Promise.resolve(ref.put(png, { contentType: 'image/png' })))
    const result = await call('reservePhotoUpload', r.owner, r.input)
    expect(result.status).toBe(200)
    expect(PhotoUploadReservationSchema.parse(result.result).path).toBe(path)
    await assertFails(Promise.resolve(ref.put(new Uint8Array(png.length + 1), { contentType: 'image/png' })))
    await assertFails(Promise.resolve(ref.put(png, { contentType: 'image/jpeg' })))
    await assertFails(Promise.resolve(ref.put(png, { contentType: 'image/png', customMetadata: { ownerUid: r.owner.localId } })))
    await assertFails(Promise.resolve(env.authenticatedContext(r.other.localId).storage(bucket).ref(path).put(png, { contentType: 'image/png' })))
    await assertSucceeds(Promise.resolve(ref.put(png, { contentType: 'image/png' })))
    await assertSucceeds(Promise.resolve(ref.getMetadata()))
    await assertFails(Promise.resolve(ref.put(png, { contentType: 'image/png' })))
    await assertFails(Promise.resolve(ref.updateMetadata({ contentType: 'image/jpeg' })))
    await assertFails(Promise.resolve(ref.delete()))
    await assertFails(Promise.resolve(r.storage.ref(`crafts/${r.input.craftId}/materials`).listAll()))
  })
  it('counts four simultaneous retries once and resolves successful retries even after a daily limit is reached', async () => {
    const r = await ready()
    const results = await Promise.all(Array.from({ length: 4 }, () => reserve(r.owner.localId, r.input)))
    expect(results.every((x) => JSON.stringify(x) === JSON.stringify(results[0]))).toBe(true)
    expect((await r.quota.get()).data()).toMatchObject({ materials: 1, completion: 0, bytes: png.length })
    expect((await globalRef().get()).data()?.files).toBe(1)
    await uidRef(r.owner.localId).update({ files: PHOTO_LIMITS.uidDailyFiles })
    expect(await reserve(r.owner.localId, r.input)).toEqual(results[0])
    await expect(reserve(r.owner.localId, { ...r.input, sizeBytes: png.length + 1 })).rejects.toMatchObject(denied('IDEMPOTENCY_CONFLICT'))
    expect((await globalRef().get()).data()?.files).toBe(1)
  })
  it('allows only one contender for the final material slot', async () => {
    const r = await ready()
    await r.quota.set({ schemaVersion: 1, materials: PHOTO_LIMITS.materials - 1, completion: 0, bytes: 0 })
    const attempts = await Promise.allSettled([reserve(r.owner.localId, r.input), reserve(r.owner.localId, { ...r.input, photoId: randomUUID() })])
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.find((x) => x.status === 'rejected')).toMatchObject({ reason: denied('PHOTO_LIMIT_REACHED') })
    expect((await r.quota.get()).data()?.materials).toBe(PHOTO_LIMITS.materials)
  })
  it('shares the craft byte allowance across both photo purposes and limits completion slots', async () => {
    const r = await ready('ready')
    await r.quota.set({ schemaVersion: 1, materials: 1, completion: 0, bytes: PHOTO_LIMITS.craftBytes - 1 })
    await reserve(r.owner.localId, { ...r.input, sizeBytes: 1 })
    await expect(reserve(r.owner.localId, { ...r.input, photoId: randomUUID(), sizeBytes: 1 })).rejects.toMatchObject(denied('PHOTO_LIMIT_REACHED'))
    await r.quota.set({ schemaVersion: 1, materials: 0, completion: PHOTO_LIMITS.completion, bytes: 0 })
    await expect(reserve(r.owner.localId, { ...r.input, photoId: randomUUID() })).rejects.toMatchObject(denied('PHOTO_LIMIT_REACHED'))
  })
  it.each(['uidFiles', 'uidBytes', 'globalFiles', 'globalBytes'] as const)('enforces the %s boundary atomically', async (kind) => {
    const r = await ready()
    const target = kind.startsWith('uid') ? uidRef(r.owner.localId) : globalRef()
    const files = kind === 'uidFiles' ? PHOTO_LIMITS.uidDailyFiles - 1 : kind === 'globalFiles' ? PHOTO_LIMITS.projectDailyFiles - 1 : 0
    const bytes = kind === 'uidBytes' ? PHOTO_LIMITS.uidDailyBytes - 1 : kind === 'globalBytes' ? PHOTO_LIMITS.projectDailyBytes - 1 : 0
    await target.set({ schemaVersion: 1, day: day(), files, bytes })
    const attempts = await Promise.allSettled([reserve(r.owner.localId, { ...r.input, sizeBytes: 1 }), reserve(r.owner.localId, { ...r.input, photoId: randomUUID(), sizeBytes: 1 })])
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.find((x) => x.status === 'rejected')).toMatchObject({ reason: denied('PHOTO_LIMIT_REACHED') })
  })
  it('rolls daily meters over in UTC without clearing the craft lifetime allowance', async () => {
    const r = await ready()
    await r.quota.set({ schemaVersion: 1, materials: 2, completion: 0, bytes: 100 })
    const yesterday = { schemaVersion: 1, day: '2000-01-01', files: 9999, bytes: 999999999 }
    await uidRef(r.owner.localId).set(yesterday); await globalRef().set(yesterday)
    await reserve(r.owner.localId, r.input)
    expect((await globalRef().get()).data()).toMatchObject({ day: day(), files: 1, bytes: png.length })
    expect((await r.quota.get()).data()).toMatchObject({ materials: 3, bytes: 100 + png.length })
  })
  it('fails closed on corrupt meters and hides all permits and usage counters from clients', async () => {
    const r = await ready()
    await globalRef().update({ files: '0' })
    await expect(reserve(r.owner.localId, r.input)).rejects.toMatchObject(denied('INTERNAL_ERROR'))
    expect((await r.quota.get()).exists).toBe(false)
    await globalRef().update({ files: 0 })
    const result = await reserve(r.owner.localId, r.input)
    const db = env.authenticatedContext(r.owner.localId).firestore()
    for (const path of [r.quota.path, `${r.ref.path}/photoUploads/materials-${r.input.photoId}.png`, uidRef(r.owner.localId).path, globalRef().path]) {
      await assertFails(db.doc(path).get())
      await assertFails(db.doc(path).set({ schemaVersion: 1, files: 0, bytes: 0 }))
      await assertFails(db.doc(path).delete())
    }
    expect(result).not.toHaveProperty('ownerUid')
    expect(result).not.toHaveProperty('inputHash')
  })
  it('grants completion permission only after all steps and denies creates after completion or parent deletion', async () => {
    const r = await ready('unfinished')
    await expect(reserve(r.owner.localId, r.input)).rejects.toMatchObject(denied('STEPS_NOT_COMPLETED'))
    await r.ref.collection('workshop').doc('production').set(storeProduction(productionSnapshots.allStepsCompleted.production))
    const permit = await reserve(r.owner.localId, r.input)
    await assertSucceeds(Promise.resolve(r.storage.ref(permit.path).put(png, { contentType: 'image/png' })))
    await expect(reserve(r.owner.localId, { ...r.input, kind: 'materials' })).rejects.toMatchObject(denied('INVALID_CRAFT_STATE'))
    const unused = await reserve(r.owner.localId, { ...r.input, photoId: randomUUID() })
    await r.ref.update({ status: 'completed', completedAt: Timestamp.now() })
    await assertFails(Promise.resolve(r.storage.ref(unused.path).put(png, { contentType: 'image/png' })))
    await expect(reserve(r.owner.localId, { ...r.input, photoId: randomUUID() })).rejects.toMatchObject(denied('INVALID_CRAFT_STATE'))
    await r.ref.delete()
    await assertFails(Promise.resolve(r.storage.ref(permit.path).getMetadata()))
    await assertFails(Promise.resolve(r.storage.ref(unused.path).put(png, { contentType: 'image/png' })))
  })
  it('rejects malformed production state before granting a completion reservation', async () => {
    for (const patch of [{ schemaVersion: 1 }, { revision: 99 }, { steps: [] }, { template: { id: 'other', steps: [] } }]) {
      const r = await ready('ready')
      await r.ref.collection('workshop').doc('production').update(patch)
      await expect(reserve(r.owner.localId, r.input)).rejects.toMatchObject(denied('PRODUCTION_NOT_READY'))
      expect((await r.quota.get()).exists).toBe(false)
    }
  })
})
