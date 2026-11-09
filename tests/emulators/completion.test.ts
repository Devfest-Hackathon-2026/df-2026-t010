import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { reserveForPath } from './photo-reservation-helper'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { COMPLETION_RETENTION_MS, CompletionSnapshotSchema, CraftSnapshotSchema, GalleryPostSchema, materialsFixture, templateFixture } from '@rekt/shared'
import { parseProjectCatalog } from '../../functions/src/features/projects/catalog'
import { toWire as clientToWire } from '../../src/data/firebase/crafts'

const project = 'demo-co-make'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=', 'base64')
type Guest = { idToken: string; localId: string }
let environment: RulesTestEnvironment
let materialService: typeof import('../../functions/src/features/materials/operations').runMaterialsOperation
let productionService: typeof import('../../functions/src/features/production/operations').runProductionOperation
let service: typeof import('../../functions/src/features/completion/operations').runCompleteCraft
let toWire: typeof import('../../functions/src/lib/database').toWire
const catalog = () => parseProjectCatalog([templateFixture])
const denied = (reason: string) => ({ details: { schemaVersion: 2, reason } })
async function guest(): Promise<Guest> {
  const response = await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })
  expect(response.ok).toBe(true)
  return response.json() as Promise<Guest>
}
async function call(name: string, user: Guest | undefined, data: unknown) {
  const response = await fetch(`http://127.0.0.1:5002/${project}/asia-northeast1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.idToken}` } : {}) }, body: JSON.stringify({ data }) })
  const body = await response.json() as { result?: unknown; error?: { details?: { reason?: string } } }
  return { status: response.status, data: body.result, reason: body.error?.details?.reason }
}
async function ready(finishedSteps = 2) {
  const owner = await guest(); const other = await guest()
  const created = CraftSnapshotSchema.parse((await call('createCraft', owner, { requestId: randomUUID(), locale: 'ja' })).data)
  const craftId = created.craft.id
  const edit = { requestId: randomUUID(), craftId, expectedRevision: 0, items: materialsFixture.items, tools: materialsFixture.tools, checks: [] }
  await materialService('editMaterials', owner.localId, edit, catalog)
  await materialService('editMaterials', owner.localId, { ...edit, requestId: randomUUID(), expectedRevision: 1, checks: [{ id: 'dry', confirmed: true }] }, catalog)
  await materialService('confirmMaterials', owner.localId, { requestId: randomUUID(), craftId, expectedRevision: 2 }, catalog)
  const start = { requestId: randomUUID(), craftId, templateId: templateFixture.id, materialRevision: 2 }
  await productionService('startCraft', owner.localId, start, catalog)
  for (let i = 0; i < finishedSteps; i++) await productionService('completeStep', owner.localId, { requestId: randomUUID(), craftId, stepId: templateFixture.steps[i]!.id, expectedRevision: i })
  const ref = getFirestore().doc(`crafts/${craftId}`)
  return { owner, other, craftId, ref, start, input: { requestId: randomUUID(), craftId, photoPath: null },
    production: ref.collection('workshop').doc('production'), completion: ref.collection('workshop').doc('completion'),
    path: `crafts/${craftId}/completion/${randomUUID()}.png`,
    storage: environment.authenticatedContext(owner.localId).storage(`gs://${project}.appspot.com`),
  }
}
async function savePhoto(path: string, bytes = png, contentType = 'image/png') {
  await getStorage().bucket(`${project}.appspot.com`).file(path).save(bytes, { resumable: false, metadata: { contentType } })
}
function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.STORAGE_EMULATOR_HOST) throw new Error('Run npm run test:emulators; real services are forbidden')
  process.env.GCLOUD_PROJECT = project
  if (!getApps().length) initializeApp({ projectId: project, storageBucket: `${project}.appspot.com` })
  materialService = (await import('../../functions/src/features/materials/operations')).runMaterialsOperation
  productionService = (await import('../../functions/src/features/production/operations')).runProductionOperation
  service = (await import('../../functions/src/features/completion/operations')).runCompleteCraft
  toWire = (await import('../../functions/src/lib/database')).toWire
  environment = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') }, storage: { host: '127.0.0.1', port: 9198, rules: await readFile('storage.rules', 'utf8') } })
})
afterAll(async () => { await environment?.cleanup() })

describe('本人の完成記録と7日後の削除予定', () => {
  it('写真なしで実callableから完成し、時刻/削除予定/状態を同時保存する', async () => {
    const r = await ready()
    const result = CompletionSnapshotSchema.parse((await call('completeCraft', r.owner, r.input)).data)
    expect(result.craft).toMatchObject({ status: 'completed', revision: 7 })
    expect(result.completion.photoPath).toBeNull()
    expect(Date.parse(result.completion.deleteAfter) - Date.parse(result.completion.completedAt)).toBe(COMPLETION_RETENTION_MS)
    expect(result.craft.completedAt).toBe(result.completion.completedAt)
    const saved = (await r.completion.get()).data()!
    expect(saved.completedAt).toBeInstanceOf(Timestamp)
    expect(saved.deleteAfter).toBeInstanceOf(Timestamp)
    const db = environment.authenticatedContext(r.owner.localId).firestore()
    const doc = await assertSucceeds(db.doc(r.completion.path).get())
    expect(clientToWire(doc.data())).toEqual(result.completion)
    await assertFails(db.doc(r.completion.path).update({ deleteAfter: new Date() }))
    await assertFails(environment.authenticatedContext(r.other.localId).firestore().doc(r.completion.path).get())
    await assertFails(environment.unauthenticatedContext().firestore().doc(r.completion.path).get())
  })
  it('本人の完成写真をRulesでアップロードし、実バイト検証後に登録できる', async () => {
    const r = await ready()
    await reserveForPath(r.owner.localId, r.path, png.length)
    await assertSucceeds(Promise.resolve(r.storage.ref(r.path).put(png, { contentType: 'image/png' })))
    const result = await call('completeCraft', r.owner, { ...r.input, photoPath: r.path })
    expect(result.status).toBe(200)
    expect(CompletionSnapshotSchema.parse(result.data).completion.photoPath).toBe(r.path)
    await assertSucceeds(Promise.resolve(r.storage.ref(r.path).getMetadata()))
    const url = `http://127.0.0.1:9198/v0/b/${project}.appspot.com/o/${encodeURIComponent(r.path)}?alt=media`
    const download = (user?: Guest) => fetch(url, { headers: user ? { Authorization: `Firebase ${user.idToken}` } : {} })
    const owned = await download(r.owner)
    expect(owned.ok).toBe(true)
    expect(Buffer.from(await owned.arrayBuffer())).toEqual(png)
    expect((await download(r.other)).ok).toBe(false)
    expect((await download()).ok).toBe(false)
    const lookup = { postId: r.craftId }
    expect((await call('getGalleryPost', r.other, lookup)).data).toBeNull()
    const publish = { requestId: randomUUID(), craftId: r.craftId, author: 'Test', caption: '' }
    expect((await call('publishCraft', r.other, publish)).reason).toBe('NOT_CRAFT_OWNER')
    expect((await call('publishCraft', r.owner, publish)).status).toBe(200)
    const shared = GalleryPostSchema.parse((await call('getGalleryPost', r.other, lookup)).data)
    expect(shared.photoUrl).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect((await download(r.other)).ok).toBe(false)
    await assertFails(Promise.resolve(r.storage.ref(`crafts/${r.craftId}/completion/late.png`).put(png, { contentType: 'image/png' })))
  })
  it('未認証/別UID/未存在/旧入力/任意の完成日時や削除期限を拒否する', async () => {
    const r = await ready()
    expect((await call('completeCraft', undefined, r.input)).reason).toBe('UNAUTHENTICATED')
    expect((await call('completeCraft', r.other, r.input)).reason).toBe('NOT_CRAFT_OWNER')
    expect((await call('completeCraft', r.owner, { ...r.input, craftId: 'missing-craft' })).reason).toBe('CRAFT_NOT_FOUND')
    for (const extra of [{ ownerUid: r.owner.localId }, { roomId: r.craftId }, { completedAt: new Date().toISOString() }, { deleteAfter: new Date().toISOString() }, { schemaVersion: 1 }]) expect((await call('completeCraft', r.owner, { ...r.input, ...extra })).reason).toBe('VALIDATION_FAILED')
    expect((await r.completion.get()).exists).toBe(false)
  })
  it('未完了の制作を拒否し、本人確認/工程確認の前にStorageを読まない', async () => {
    const r = await ready(1)
    let loaded = false
    const loader = async () => { loaded = true }
    await expect(service(r.owner.localId, { ...r.input, photoPath: r.path }, loader)).rejects.toMatchObject(denied('STEPS_NOT_COMPLETED'))
    await expect(service(r.other.localId, { ...r.input, photoPath: r.path }, loader)).rejects.toMatchObject(denied('NOT_CRAFT_OWNER'))
    expect(loaded).toBe(false)
    expect((await r.completion.get()).exists).toBe(false)
  })
  it('別制作/材料写真/URLを入力できず、写真の未存在・偽装・大容量を拒否する', async () => {
    const r = await ready()
    for (const photoPath of ['crafts/other/completion/a.png', `crafts/${r.craftId}/materials/a.png`, 'https://example.com/a.png']) expect((await call('completeCraft', r.owner, { ...r.input, photoPath })).reason).toBe('VALIDATION_FAILED')
    expect((await call('completeCraft', r.owner, { ...r.input, photoPath: r.path })).reason).toBe('IMAGE_NOT_FOUND')
    await savePhoto(r.path, Buffer.from('not an image'))
    expect((await call('completeCraft', r.owner, { ...r.input, photoPath: r.path })).reason).toBe('INVALID_IMAGE')
    const mismatch = `crafts/${r.craftId}/completion/mismatch.jpg`
    await savePhoto(mismatch)
    expect((await call('completeCraft', r.owner, { ...r.input, photoPath: mismatch })).reason).toBe('INVALID_IMAGE')
    const huge = `crafts/${r.craftId}/completion/huge.png`
    await savePhoto(huge, Buffer.alloc(5 * 1024 * 1024 + 1))
    expect((await call('completeCraft', r.owner, { ...r.input, photoPath: huge })).reason).toBe('INVALID_IMAGE')
    expect((await r.ref.get()).data()?.status).toBe('crafting')
  })
  it('同じ完成の4重再送と別IDの同内容でも日時・期限・版を一度だけ更新する', async () => {
    const r = await ready()
    const results = await Promise.all(Array.from({ length: 4 }, () => service(r.owner.localId, r.input)))
    expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true)
    expect(await service(r.owner.localId, { ...r.input, requestId: randomUUID() })).toEqual(results[0])
    expect((await r.ref.get()).data()?.revision).toBe(7)
    await expect(service(r.owner.localId, { ...r.input, photoPath: r.path })).rejects.toMatchObject(denied('IDEMPOTENCY_CONFLICT'))
  })
  it('異なる写真の同時完成は一方だけを採用し、後から写真を差し替えない', async () => {
    const r = await ready(); const otherPath = `crafts/${r.craftId}/completion/second.png`
    await savePhoto(r.path); await savePhoto(otherPath)
    const results = await Promise.all([call('completeCraft', r.owner, { ...r.input, photoPath: r.path }), call('completeCraft', r.owner, { ...r.input, requestId: randomUUID(), photoPath: otherPath })])
    expect(results.filter((result) => result.status === 200)).toHaveLength(1)
    expect(results.find((result) => result.status !== 200)?.reason).toBe('INVALID_CRAFT_STATE')
    expect((await r.ref.get()).data()?.revision).toBe(7)
    const chosen = (await r.completion.get()).data()?.photoPath
    expect([r.path, otherPath]).toContain(chosen)
  })
  it('最終工程と完成の競合で、未完了の完成記録や工程の巻き戻りを作らない', async () => {
    const r = await ready(1)
    const results = await Promise.allSettled([
      productionService('completeStep', r.owner.localId, { requestId: randomUUID(), craftId: r.craftId, stepId: 'b', expectedRevision: 1 }),
      service(r.owner.localId, r.input),
    ])
    expect(results[0]?.status).toBe('fulfilled')
    if (results[1]?.status === 'rejected') expect(results[1].reason).toMatchObject(denied('STEPS_NOT_COMPLETED'))
    const completed = await service(r.owner.localId, r.input)
    expect(completed.production.steps.every((step) => step.completedAt !== null)).toBe(true)
    expect(completed.craft.status).toBe('completed')
    expect((await productionService('startCraft', r.owner.localId, r.start)).craft.status).toBe('completed')
  })
  it('写真確認中に別の完成が確定しても、その写真/期限を上書きしない', async () => {
    const r = await ready(); const entered = gate(); const release = gate()
    const pending = service(r.owner.localId, { ...r.input, photoPath: r.path }, async () => { entered.resolve(); await release.promise })
    const rejected = expect(pending).rejects.toMatchObject(denied('INVALID_CRAFT_STATE'))
    await entered.promise
    const winner = await service(r.owner.localId, { ...r.input, requestId: randomUUID() })
    release.resolve(); await rejected
    expect(toWire((await r.completion.get()).data())).toEqual(winner.completion)
  })
  it('成功再送は写真を再取得せず、所有者変更は再送でも拒否する', async () => {
    const r = await ready(); await savePhoto(r.path)
    const input = { ...r.input, photoPath: r.path }
    const first = CompletionSnapshotSchema.parse((await call('completeCraft', r.owner, input)).data)
    await getStorage().bucket(`${project}.appspot.com`).file(r.path).delete()
    expect(CompletionSnapshotSchema.parse((await call('completeCraft', r.owner, input)).data)).toEqual(first)
    await r.ref.update({ ownerUid: r.other.localId })
    expect((await call('completeCraft', r.owner, input)).reason).toBe('NOT_CRAFT_OWNER')
  })
  it('既存の壊れた完成データや工程カウンターの不一致を上書きしない', async () => {
    const r = await ready(); await r.completion.set({ sentinel: 'keep' })
    await expect(service(r.owner.localId, r.input)).rejects.toMatchObject(denied('PRODUCTION_NOT_READY'))
    expect((await r.completion.get()).data()).toEqual({ sentinel: 'keep' })
    await r.completion.delete(); await r.production.update({ revision: 99 })
    await expect(service(r.owner.localId, r.input)).rejects.toMatchObject(denied('PRODUCTION_NOT_READY'))
    const s = await ready(); await service(s.owner.localId, s.input)
    await s.completion.update({ deleteAfter: Timestamp.now() })
    await expect(service(s.owner.localId, s.input)).rejects.toMatchObject(denied('PRODUCTION_NOT_READY'))
  })
  it('失敗10回で制限し、成功済み再送は制限中でも期限を延長せず返す', async () => {
    const r = await ready(0)
    for (let i = 0; i < 10; i++) await expect(service(r.owner.localId, { ...r.input, requestId: randomUUID() })).rejects.toMatchObject(denied('STEPS_NOT_COMPLETED'))
    await expect(service(r.owner.localId, r.input)).rejects.toMatchObject(denied('RATE_LIMITED'))
    const s = await ready(); const first = await service(s.owner.localId, s.input)
    const hash = createHash('sha256').update(`${s.owner.localId}\0completeCraft`).digest('hex')
    await getFirestore().doc(`operationLimits/${hash}`).set({ windowStart: Timestamp.now(), attempts: 10 })
    expect(await service(s.owner.localId, s.input)).toEqual(first)
    await expect(service(s.owner.localId, { ...s.input, requestId: randomUUID() })).rejects.toMatchObject(denied('RATE_LIMITED'))
  })
})

describe('完成写真のStorage Rules', () => {
  it('本人でも未完了中は作成できず、完了後は不変の写真を作成/getできる', async () => {
    const r = await ready(1)
    const ref = r.storage.ref(r.path)
    await assertFails(Promise.resolve(ref.put(png, { contentType: 'image/png' })))
    await productionService('completeStep', r.owner.localId, { requestId: randomUUID(), craftId: r.craftId, stepId: 'b', expectedRevision: 1 })
    await reserveForPath(r.owner.localId, r.path, png.length)
    await assertSucceeds(Promise.resolve(ref.put(png, { contentType: 'image/png' })))
    await assertSucceeds(Promise.resolve(ref.getMetadata()))
    await assertFails(Promise.resolve(ref.put(png, { contentType: 'image/png' })))
    await assertFails(Promise.resolve(ref.updateMetadata({ contentType: 'image/jpeg' })))
    await assertFails(Promise.resolve(ref.delete()))
    await assertFails(Promise.resolve(r.storage.ref(`crafts/${r.craftId}/completion`).listAll()))
  })
  it('別UID/未認証・型/MIME/容量/余分なメタデータ・旧経路を拒否する', async () => {
    const r = await ready(); await reserveForPath(r.owner.localId, r.path, png.length); await r.storage.ref(r.path).put(png, { contentType: 'image/png' })
    for (const context of [environment.authenticatedContext(r.other.localId), environment.unauthenticatedContext()]) {
      await assertFails(Promise.resolve(context.storage(`gs://${project}.appspot.com`).ref(r.path).getMetadata()))
      await assertFails(Promise.resolve(context.storage(`gs://${project}.appspot.com`).ref(`crafts/${r.craftId}/completion/foreign.png`).put(png, { contentType: 'image/png' })))
    }
    for (const [name, contentType] of [['bad.jpg', 'image/png'], ['bad.txt', 'text/plain'], ['BAD.PNG', 'image/png']]) await assertFails(Promise.resolve(r.storage.ref(`crafts/${r.craftId}/completion/${name}`).put(png, { contentType })))
    await assertFails(Promise.resolve(r.storage.ref(`crafts/${r.craftId}/completion/empty.png`).put(new Uint8Array(), { contentType: 'image/png' })))
    await assertFails(Promise.resolve(r.storage.ref(`crafts/${r.craftId}/completion/huge.png`).put(new Uint8Array(5 * 1024 * 1024 + 1), { contentType: 'image/png' })))
    await assertFails(Promise.resolve(r.storage.ref(`crafts/${r.craftId}/completion/meta.png`).put(png, { contentType: 'image/png', customMetadata: { ownerUid: r.owner.localId } })))
    await assertFails(Promise.resolve(r.storage.ref('rooms/old/completion/a.png').put(png, { contentType: 'image/png' })))
    await assertFails(Promise.resolve(r.storage.ref('crafts/orphan/completion/a.png').put(png, { contentType: 'image/png' })))
  })
  it('v1・選択作品不一致・欠けた工程・不正カウンターから写真を作成できない', async () => {
    for (const patch of [{ schemaVersion: 1 }, { revision: 99 }, { steps: [] }, { template: { id: 'different', steps: [] } }]) {
      const r = await ready(); await r.production.update(patch)
      await assertFails(Promise.resolve(r.storage.ref(r.path).put(png, { contentType: 'image/png' })))
    }
  })
})
