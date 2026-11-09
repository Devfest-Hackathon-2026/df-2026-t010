import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { CandidatesDocumentSchema, CraftSnapshotSchema, MaterialsDocumentSchema, materialsFixture, templateFixture } from '@rekt/shared'
import { parseProjectCatalog, ProjectStateSchema } from '../../functions/src/features/projects/catalog'
import { toWire as clientToWire } from '../../src/data/firebase/crafts'

type Guest = { idToken: string; localId: string }
let environment: RulesTestEnvironment
let service: typeof import('../../functions/src/features/materials/operations').runMaterialsOperation
let toWire: typeof import('../../functions/src/lib/database').toWire
const catalog = () => parseProjectCatalog([templateFixture])
const inventory = { items: materialsFixture.items, tools: materialsFixture.tools, checks: [] }
const denied = (reason: string) => ({ details: { schemaVersion: 2, reason } })
async function guest(): Promise<Guest> {
  const response = await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })
  expect(response.ok).toBe(true)
  return response.json() as Promise<Guest>
}
async function call(name: string, user: Guest | undefined, data: unknown) {
  const response = await fetch(`http://127.0.0.1:5002/demo-co-make/asia-northeast1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.idToken}` } : {}) }, body: JSON.stringify({ data }) })
  const body = await response.json() as { result?: unknown; error?: { details?: { reason?: string } } }
  return { status: response.status, data: body.result, reason: body.error?.details?.reason }
}
async function ready() {
  const owner = await guest(); const other = await guest()
  const snapshot = CraftSnapshotSchema.parse((await call('createCraft', owner, { requestId: randomUUID(), locale: 'ja' })).data)
  const craftId = snapshot.craft.id
  const ref = getFirestore().doc(`crafts/${craftId}`)
  return { owner, other, snapshot, craftId, ref,
    materials: ref.collection('workshop').doc('materials'), candidates: ref.collection('workshop').doc('candidates'), state: ref.collection('projectState').doc('current'),
    edit: { requestId: randomUUID(), craftId, expectedRevision: 0, ...inventory },
    confirm: { requestId: randomUUID(), craftId, expectedRevision: 1 },
  }
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Run npm run test:emulators; real services are forbidden')
  process.env.GCLOUD_PROJECT = 'demo-co-make'
  if (!getApps().length) initializeApp({ projectId: 'demo-co-make' })
  service = (await import('../../functions/src/features/materials/operations')).runMaterialsOperation
  toWire = (await import('../../functions/src/lib/database')).toWire
  environment = await initializeTestEnvironment({ projectId: 'demo-co-make', firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') } })
})
afterAll(async () => { await environment?.cleanup() })

describe('実callableと既存の画面/購読契約', () => {
  it('本人が保存・確定し、現在の空カタログを候補0件として購読できる', async () => {
    const r = await ready()
    const edited = await call('editMaterials', r.owner, r.edit)
    expect(CraftSnapshotSchema.parse(edited.data).craft).toMatchObject({ status: 'materials', revision: 1 })
    expect((await r.materials.get()).data()?.updatedAt).toBeInstanceOf(Timestamp)
    expect(MaterialsDocumentSchema.parse(toWire((await r.materials.get()).data()))).toMatchObject({ schemaVersion: 2, revision: 1, checks: [], confirmedAt: null })
    const confirmed = await call('confirmMaterials', r.owner, r.confirm)
    expect(CraftSnapshotSchema.parse(confirmed.data).craft).toMatchObject({ status: 'project_selection', revision: 2 })
    const db = environment.authenticatedContext(r.owner.localId).firestore()
    const document = await assertSucceeds(db.doc(r.candidates.path).get())
    expect(CandidatesDocumentSchema.parse(clientToWire(document.data()))).toMatchObject({ schemaVersion: 2, materialRevision: 1, candidates: [] })
    expect(ProjectStateSchema.parse((await r.state.get()).data())).toMatchObject({ confirmed: true, materialRevision: 1 })
  })
  it('未認証、所有者以外、未存在を拒否し、候補/証明の直接操作も拒否する', async () => {
    const r = await ready()
    for (const [name, input] of [['editMaterials', r.edit], ['confirmMaterials', r.confirm]] as const) {
      expect((await call(name, undefined, input)).reason).toBe('UNAUTHENTICATED')
      expect((await call(name, r.other, input)).reason).toBe('NOT_CRAFT_OWNER')
      expect((await call(name, r.owner, { ...input, craftId: 'missing-material-craft' })).reason).toBe('CRAFT_NOT_FOUND')
    }
    await call('editMaterials', r.owner, r.edit); await call('confirmMaterials', r.owner, r.confirm)
    const db = environment.authenticatedContext(r.owner.localId).firestore()
    await assertFails(db.doc(r.candidates.path).update({ candidates: [] }))
    await assertFails(db.doc(r.state.path).get())
    await assertFails(db.doc(r.state.path).set({ confirmed: true }))
    await assertFails(environment.authenticatedContext(r.other.localId).firestore().doc(r.candidates.path).get())
  })
  it('未知フィールド、旧入力、重複ID、不正数量/工具/確認条件を拒否する', async () => {
    const r = await ready()
    const bad = [{ ownerUid: r.owner.localId }, { items: [inventory.items[0], inventory.items[0]] }, { items: [{ ...inventory.items[0], quantity: -1 }] }, { tools: [' '] }, { checks: [{ id: 'invented', confirmed: true }] }]
    for (const patch of bad) expect((await call('editMaterials', r.owner, { ...r.edit, ...patch })).reason).toBe('VALIDATION_FAILED')
    expect((await call('confirmMaterials', r.owner, { ...r.confirm, confirmedAt: new Date().toISOString() })).reason).toBe('VALIDATION_FAILED')
    expect((await call('editMaterials', r.owner, { ...r.edit, roomId: r.craftId })).reason).toBe('VALIDATION_FAILED')
    expect((await r.materials.get()).exists).toBe(false)
  })
  it('空材料の確定と古い材料版を拒否する', async () => {
    const r = await ready()
    expect((await call('confirmMaterials', r.owner, { ...r.confirm, expectedRevision: 0 })).reason).toBe('VALIDATION_FAILED')
    expect((await call('editMaterials', r.owner, { ...r.edit, expectedRevision: 2 })).reason).toBe('STALE_REVISION')
    await call('editMaterials', r.owner, r.edit)
    expect((await call('confirmMaterials', r.owner, { ...r.confirm, expectedRevision: 0 })).reason).toBe('STALE_REVISION')
    expect((await r.candidates.get()).exists).toBe(false)
  })
})

describe('合成カタログでの確認条件・版・原子性', () => {
  it('初回の材料保存では確認を未回答へ戻し、同じ材料への明示回答後だけ制作可能になる', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, { ...r.edit, checks: [{ id: 'dry', confirmed: true }] }, catalog)
    expect((await r.materials.get()).data()?.checks).toEqual([{ id: 'dry', confirmed: null }])
    await service('confirmMaterials', r.owner.localId, r.confirm, catalog)
    expect(CandidatesDocumentSchema.parse(toWire((await r.candidates.get()).data())).candidates[0]?.feasible).toBe(false)
    await service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 1, checks: [{ id: 'dry', confirmed: true }] }, catalog)
    expect((await r.candidates.get()).exists).toBe(false)
    expect((await r.state.get()).data()?.confirmed).toBe(false)
    await service('confirmMaterials', r.owner.localId, { ...r.confirm, requestId: randomUUID(), expectedRevision: 2 }, catalog)
    expect(CandidatesDocumentSchema.parse(toWire((await r.candidates.get()).data())).candidates[0]?.feasible).toBe(true)
    expect((await r.materials.get()).data()?.revision).toBe(2)
  })
  it('材料/数量の変更はコピーされたtrueを無効にし、知らない条件IDは拒否する', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, r.edit, catalog)
    await service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 1, checks: [{ id: 'dry', confirmed: true }] }, catalog)
    await service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 2, items: [{ ...inventory.items[0]!, quantity: 3 }], checks: [{ id: 'dry', confirmed: true }] }, catalog)
    expect((await r.materials.get()).data()?.checks).toEqual([{ id: 'dry', confirmed: null }])
    await expect(service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 3, checks: [{ id: 'forged', confirmed: true }] }, catalog)).rejects.toMatchObject(denied('VALIDATION_FAILED'))
    expect((await r.materials.get()).data()?.revision).toBe(3)
  })
  it('カタログが変わったら古い確認で確定できず、再編集でも回答を使い回さない', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, r.edit, catalog)
    await service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 1, checks: [{ id: 'dry', confirmed: true }] }, catalog)
    const changed = () => parseProjectCatalog([{ ...templateFixture, checks: [{ id: 'dry', label: { ja: '新しい確認', en: 'New condition' } }] }])
    await expect(service('confirmMaterials', r.owner.localId, { ...r.confirm, expectedRevision: 2 }, changed)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
    await service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 2, checks: [{ id: 'dry', confirmed: true }] }, changed)
    expect((await r.materials.get()).data()?.checks).toEqual([{ id: 'dry', confirmed: null }])
    await service('confirmMaterials', r.owner.localId, { ...r.confirm, requestId: randomUUID(), expectedRevision: 3 }, changed)
    expect(CandidatesDocumentSchema.parse(toWire((await r.candidates.get()).data())).candidates[0]?.feasible).toBe(false)
  })
  it('材料/工具不足でも確定できるが、制作可能の候補にはしない', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, { ...r.edit, items: [{ ...inventory.items[0]!, quantity: 1 }], tools: [] }, catalog)
    await service('confirmMaterials', r.owner.localId, r.confirm, catalog)
    const candidate = CandidatesDocumentSchema.parse(toWire((await r.candidates.get()).data())).candidates[0]!
    expect(candidate.feasible).toBe(false)
    expect(candidate.missing).toHaveLength(3)
  })
  it('削除された質問を含む古いフォームからも再編集で復帰できる', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, r.edit, catalog)
    await service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 1, checks: [{ id: 'dry', confirmed: true }] }, catalog)
    const removed = () => parseProjectCatalog([{ ...templateFixture, checks: [] }])
    await service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 2, checks: [{ id: 'dry', confirmed: true }] }, removed)
    expect((await r.materials.get()).data()?.checks).toEqual([])
    await service('confirmMaterials', r.owner.localId, { ...r.confirm, expectedRevision: 3 }, removed)
    expect(CandidatesDocumentSchema.parse(toWire((await r.candidates.get()).data())).candidates[0]?.feasible).toBe(true)
  })
  it('同じ内容の再編集でも未確定へ戻し、古い成功再送で再確定しない', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, r.edit, catalog)
    await service('confirmMaterials', r.owner.localId, r.confirm, catalog)
    const reopened = await service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 1 }, catalog)
    expect(reopened.craft).toMatchObject({ status: 'materials', revision: 3, selectedTemplateId: null })
    expect((await r.candidates.get()).exists).toBe(false)
    expect((await r.materials.get()).data()).toMatchObject({ revision: 2, confirmedAt: null })
    expect((await service('confirmMaterials', r.owner.localId, r.confirm, catalog)).craft.status).toBe('materials')
    expect((await r.materials.get()).data()?.confirmedAt).toBeNull()
  })
  it('同時編集は1件だけ成功し、同じrequestIdの同時送信は一度だけ反映する', async () => {
    const r = await ready()
    const results = await Promise.allSettled([
      service('editMaterials', r.owner.localId, r.edit, catalog),
      service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), tools: [] }, catalog),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')?.reason).toMatchObject(denied('STALE_REVISION'))
    const input = { ...r.edit, requestId: randomUUID(), expectedRevision: 1 }
    const repeated = await Promise.all([service('editMaterials', r.owner.localId, input, catalog), service('editMaterials', r.owner.localId, input, catalog)])
    expect(repeated[0]).toEqual(repeated[1])
    expect((await r.materials.get()).data()?.revision).toBe(2)
  })
  it('確定の同時再送は一度だけ進み、別IDの二重確定は拒否する', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, r.edit, catalog)
    const results = await Promise.all([service('confirmMaterials', r.owner.localId, r.confirm, catalog), service('confirmMaterials', r.owner.localId, r.confirm, catalog)])
    expect(results[0]).toEqual(results[1])
    expect((await r.ref.get()).data()?.revision).toBe(2)
    await expect(service('confirmMaterials', r.owner.localId, { ...r.confirm, requestId: randomUUID() }, catalog)).rejects.toMatchObject(denied('INVALID_CRAFT_STATE'))
    await expect(service('confirmMaterials', r.owner.localId, { ...r.confirm, expectedRevision: 9 }, catalog)).rejects.toMatchObject(denied('IDEMPOTENCY_CONFLICT'))
    await expect(service('editMaterials', r.owner.localId, { ...r.edit, tools: [] }, catalog)).rejects.toMatchObject(denied('IDEMPOTENCY_CONFLICT'))
  })
  it('編集と確定の競合で古い材料・候補を残さない', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, r.edit, catalog)
    const results = await Promise.allSettled([
      service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 1, tools: [] }, catalog),
      service('confirmMaterials', r.owner.localId, r.confirm, catalog),
    ])
    expect(results[0]?.status).toBe('fulfilled')
    if (results[1]?.status === 'rejected') expect(results[1].reason).toMatchObject(denied('STALE_REVISION'))
    expect((await r.ref.get()).data()?.status).toBe('materials')
    expect((await r.materials.get()).data()).toMatchObject({ revision: 2, tools: [], confirmedAt: null })
    expect((await r.candidates.get()).exists).toBe(false)
  })
  it('制作開始後は新しい編集/確定を拒否し、成功再送は状態を戻さない', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, r.edit, catalog)
    await r.ref.update({ status: 'crafting', selectedTemplateId: templateFixture.id })
    await expect(service('editMaterials', r.owner.localId, { ...r.edit, requestId: randomUUID(), expectedRevision: 1 }, catalog)).rejects.toMatchObject(denied('INVALID_CRAFT_STATE'))
    await expect(service('confirmMaterials', r.owner.localId, r.confirm, catalog)).rejects.toMatchObject(denied('INVALID_CRAFT_STATE'))
    expect((await service('editMaterials', r.owner.localId, r.edit, catalog)).craft.status).toBe('crafting')
    expect((await r.materials.get()).data()?.revision).toBe(1)
  })
  it('失敗した版/状態の試行も回数制限に含め、成功再送は消費しない', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, r.edit, catalog)
    for (let i = 0; i < 10; i++) await expect(service('confirmMaterials', r.owner.localId, { ...r.confirm, requestId: randomUUID(), expectedRevision: 99 }, catalog)).rejects.toMatchObject(denied('STALE_REVISION'))
    await expect(service('confirmMaterials', r.owner.localId, r.confirm, catalog)).rejects.toMatchObject(denied('RATE_LIMITED'))
    expect((await service('editMaterials', r.owner.localId, r.edit, catalog)).craft.status).toBe('materials')
  })
  it('成功済みrequestの再送でも現在の所有者を再確認する', async () => {
    const r = await ready()
    await service('editMaterials', r.owner.localId, r.edit, catalog)
    await r.ref.update({ ownerUid: r.other.localId })
    await expect(service('editMaterials', r.owner.localId, r.edit, catalog)).rejects.toMatchObject(denied('NOT_CRAFT_OWNER'))
  })
})
