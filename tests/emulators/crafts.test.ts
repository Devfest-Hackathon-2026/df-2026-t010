import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { reserveForPath } from './photo-reservation-helper'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { CraftSnapshotSchema, materialsFixture } from '@rekt/shared'

let environment: RulesTestEnvironment
type Guest = { idToken: string; localId: string }
async function guest(): Promise<Guest> {
  const response = await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })
  expect(response.ok).toBe(true)
  return response.json() as Promise<Guest>
}
async function call(user: Guest | undefined, data: unknown) {
  const response = await fetch('http://127.0.0.1:5002/demo-co-make/asia-northeast1/createCraft', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.idToken}` } : {}) }, body: JSON.stringify({ data }) })
  const body = await response.json() as { result?: unknown; error?: { details?: { reason?: string } } }
  return { status: response.status, data: body.result, reason: body.error?.details?.reason }
}
async function ready() {
  const owner = await guest(); const other = await guest()
  const input = { requestId: randomUUID(), locale: 'ja' }
  const snapshot = CraftSnapshotSchema.parse((await call(owner, input)).data)
  const ref = getFirestore().doc(`crafts/${snapshot.craft.id}`)
  return { owner, other, input, snapshot, ref }
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Run npm run test:emulators; real services are forbidden')
  if (!getApps().length) initializeApp({ projectId: 'demo-co-make' })
  environment = await initializeTestEnvironment({ projectId: 'demo-co-make', firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') }, storage: { host: '127.0.0.1', port: 9198, rules: await readFile('storage.rules', 'utf8') } })
})
afterAll(async () => { await environment?.cleanup() })

describe('単独制作の入口・再送・制限', () => {
  it('認証なし・所有者の偽装・旧参加入力を拒否する', async () => {
    const input = { requestId: randomUUID(), locale: 'ja' }
    expect((await call(undefined, input)).reason).toBe('UNAUTHENTICATED')
    const owner = await guest()
    for (const extra of [{ ownerUid: 'forged' }, { displayName: 'Host' }, { joinCode: 'ABCD23' }, { members: {} }]) expect((await call(owner, { ...input, ...extra })).reason).toBe('VALIDATION_FAILED')
  })
  it('匿名の一人だけで材料確認へ進み、並行した成功再送は同じ制作にまとまる', async () => {
    const owner = await guest(); const input = { requestId: randomUUID(), locale: 'en' }
    const results = await Promise.all([call(owner, input), call(owner, input)])
    const snapshots = results.map((result) => CraftSnapshotSchema.parse(result.data))
    expect(snapshots[0]).toEqual(snapshots[1])
    expect(snapshots[0]?.craft).toMatchObject({ ownerUid: owner.localId, status: 'materials', revision: 0, locale: 'en' })
    expect((await call(owner, { ...input, locale: 'ja' })).reason).toBe('IDEMPOTENCY_CONFLICT')
  })
  it('保存済みの現在状態を再送で巻き戻さず、作成を1分10回に制限する', async () => {
    const r = await ready()
    await r.ref.update({ revision: 1 })
    expect(CraftSnapshotSchema.parse((await call(r.owner, r.input)).data).craft.revision).toBe(1)
    for (let i = 0; i < 9; i++) expect((await call(r.owner, { requestId: randomUUID(), locale: 'ja' })).status).toBe(200)
    expect((await call(r.owner, { requestId: randomUUID(), locale: 'ja' })).reason).toBe('RATE_LIMITED')
    expect((await call(r.owner, r.input)).status).toBe(200)
  })
})

describe('所有者限定Rulesと旧経路の遮断', () => {
  it('所有者だけが制作と固定子文書を読め、一覧・直接書込・昇格を拒否する', async () => {
    const r = await ready()
    await r.ref.collection('workshop').doc('materials').set({ ...materialsFixture, updatedAt: Timestamp.now() })
    for (const uid of [r.owner.localId, r.other.localId]) {
      const db = environment.authenticatedContext(uid).firestore()
      if (uid === r.owner.localId) {
        await assertSucceeds(db.doc(r.ref.path).get())
        await assertSucceeds(db.doc(`${r.ref.path}/workshop/materials`).get())
      } else {
        await assertFails(db.doc(r.ref.path).get())
        await assertFails(db.doc(`${r.ref.path}/workshop/materials`).get())
      }
      await assertFails(db.collection('crafts').get())
      await assertFails(db.doc('crafts/forged').set({ ownerUid: uid, schemaVersion: 2 }))
      for (const patch of [{ ownerUid: uid }, { ownerUid: r.other.localId }, { status: 'completed' }, { createdAt: new Date(0) }, { extraData: 'x'.repeat(10000) }, { revision: -1 }, { locale: 123 }]) await assertFails(db.doc(r.ref.path).update(patch))
      await assertFails(db.doc(`${r.ref.path}/workshop/materials`).set({ items: [] }))
      await assertFails(db.doc(r.ref.path).delete())
      await assertFails(db.collection('operationReceipts').get())
    }
    await assertFails(environment.unauthenticatedContext().firestore().doc(r.ref.path).get())
  })
  it('孤立・未知の子文書・schemaVersion1・旧ルームを読めない', async () => {
    const r = await ready(); const db = environment.authenticatedContext(r.owner.localId).firestore()
    await getFirestore().doc('crafts/orphan/workshop/materials').set({ items: [] })
    await getFirestore().doc('crafts/legacy').set({ schemaVersion: 1, ownerUid: r.owner.localId })
    await getFirestore().doc(`rooms/${r.snapshot.craft.id}`).set({ hostUid: r.owner.localId, members: { [r.owner.localId]: { role: 'host' } } })
    await assertFails(db.doc('crafts/orphan/workshop/materials').get())
    await assertFails(db.doc('crafts/legacy').get())
    await assertFails(db.doc(`${r.ref.path}/workshop/secrets`).get())
    await assertFails(db.doc(`rooms/${r.snapshot.craft.id}`).get())
  })
  it('所有者だけ材料写真を作成/getでき、上書き・型偽装・旧パス・別UIDを拒否する', async () => {
    const r = await ready()
    const path = `${r.ref.path}/materials/photo.png`
    const bytes = new Uint8Array([137, 80, 78, 71])
    const ownerStorage = environment.authenticatedContext(r.owner.localId).storage()
    const otherStorage = environment.authenticatedContext(r.other.localId).storage()
    const ref = ownerStorage.ref(path)
    await reserveForPath(r.owner.localId, path, bytes.length)
    await assertSucceeds(Promise.resolve(ref.put(bytes, { contentType: 'image/png' })))
    await assertSucceeds(Promise.resolve(ref.getMetadata()))
    await assertFails(Promise.resolve(ref.put(bytes, { contentType: 'image/png' })))
    await assertFails(Promise.resolve(ref.delete()))
    await assertFails(Promise.resolve(ref.updateMetadata({ contentType: 'image/jpeg' })))
    await assertFails(Promise.resolve(ownerStorage.ref(`${r.ref.path}/materials`).listAll()))
    await assertFails(Promise.resolve(otherStorage.ref(path).getMetadata()))
    await assertFails(Promise.resolve(environment.unauthenticatedContext().storage().ref(path).getMetadata()))
    await assertFails(Promise.resolve(otherStorage.ref(`${r.ref.path}/materials/other.png`).put(bytes, { contentType: 'image/png' })))
    for (const [name, type] of [['bad.jpg', 'image/png'], ['bad.txt', 'text/plain']]) await assertFails(Promise.resolve(ownerStorage.ref(`${r.ref.path}/materials/${name}`).put(bytes, { contentType: type })))
    await assertFails(Promise.resolve(ownerStorage.ref(`${r.ref.path}/materials/huge.png`).put(new Uint8Array(5 * 1024 * 1024 + 1), { contentType: 'image/png' })))
    await assertFails(Promise.resolve(ownerStorage.ref(`${r.ref.path}/materials/extra.png`).put(bytes, { contentType: 'image/png', customMetadata: { unexpected: 'x' } })))
    await assertFails(Promise.resolve(ownerStorage.ref('rooms/legacy/materials/photo.png').put(bytes, { contentType: 'image/png' })))
    await assertFails(Promise.resolve(ownerStorage.ref(`${r.ref.path}/completion/photo.png`).put(bytes, { contentType: 'image/png' })))
    await assertFails(Promise.resolve(ownerStorage.ref('crafts/orphan/materials/photo.png').put(bytes, { contentType: 'image/png' })))
    await r.ref.update({ status: 'crafting', selectedTemplateId: 'test' })
    await assertSucceeds(Promise.resolve(ref.getMetadata()))
    await assertFails(Promise.resolve(ownerStorage.ref(`${r.ref.path}/materials/late.png`).put(bytes, { contentType: 'image/png' })))
  })
})
