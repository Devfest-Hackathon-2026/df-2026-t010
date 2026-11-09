import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { CraftSnapshotSchema, getProductionProgress, materialsFixture, ProductionSnapshotSchema, templateFixture } from '@rekt/shared'
import { parseProjectCatalog } from '../../functions/src/features/projects/catalog'
import { toWire as clientToWire } from '../../src/data/firebase/crafts'

type Guest = { idToken: string; localId: string }
let environment: RulesTestEnvironment
let service: typeof import('../../functions/src/features/production/operations').runProductionOperation
let materialService: typeof import('../../functions/src/features/materials/operations').runMaterialsOperation
let toWire: typeof import('../../functions/src/lib/database').toWire
const catalog = () => parseProjectCatalog([templateFixture])
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
async function draft() {
  const owner = await guest(); const other = await guest()
  const snapshot = CraftSnapshotSchema.parse((await call('createCraft', owner, { requestId: randomUUID(), locale: 'ja' })).data)
  const craftId = snapshot.craft.id
  const ref = getFirestore().doc(`crafts/${craftId}`)
  return { owner, other, craftId, ref, snapshot,
    materials: ref.collection('workshop').doc('materials'), candidates: ref.collection('workshop').doc('candidates'),
    state: ref.collection('projectState').doc('current'), production: ref.collection('workshop').doc('production'),
    start: { requestId: randomUUID(), craftId, templateId: templateFixture.id, materialRevision: 2 },
    step: { requestId: randomUUID(), craftId, stepId: 'a', expectedRevision: 0 },
  }
}
async function ready(provider = catalog) {
  const r = await draft()
  const edit = { requestId: randomUUID(), craftId: r.craftId, expectedRevision: 0, items: materialsFixture.items, tools: materialsFixture.tools, checks: [] }
  await materialService('editMaterials', r.owner.localId, edit, provider)
  await materialService('editMaterials', r.owner.localId, { ...edit, requestId: randomUUID(), expectedRevision: 1, checks: [{ id: 'dry', confirmed: true }] }, provider)
  await materialService('confirmMaterials', r.owner.localId, { requestId: randomUUID(), craftId: r.craftId, expectedRevision: 2 }, provider)
  return r
}
async function started() {
  const r = await ready()
  const snapshot = await service('startCraft', r.owner.localId, r.start, catalog)
  return { ...r, started: snapshot }
}
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Run npm run test:emulators; real services are forbidden')
  process.env.GCLOUD_PROJECT = 'demo-co-make'
  if (!getApps().length) initializeApp({ projectId: 'demo-co-make' })
  service = (await import('../../functions/src/features/production/operations')).runProductionOperation
  materialService = (await import('../../functions/src/features/materials/operations')).runMaterialsOperation
  toWire = (await import('../../functions/src/lib/database')).toWire
  environment = await initializeTestEnvironment({ projectId: 'demo-co-make', firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') } })
})
afterAll(async () => { await environment?.cleanup() })

describe('開始APIの認可と原子的な作品固定', () => {
  it('現在の公開カタログへ合成作品を混ぜず、実callableは未登録作品を拒否する', async () => {
    const r = await ready()
    expect((await call('startCraft', r.owner, r.start)).reason).toBe('CANDIDATES_NOT_READY')
    expect((await r.production.get()).exists).toBe(false)
    expect((await r.ref.get()).data()?.status).toBe('project_selection')
  })
  it('両callableで未認証/別UID/未存在/未知フィールドと旧入力を拒否する', async () => {
    const r = await ready()
    for (const [name, input] of [['startCraft', r.start], ['completeStep', r.step]] as const) {
      expect((await call(name, undefined, input)).reason).toBe('UNAUTHENTICATED')
      expect((await call(name, r.other, input)).reason).toBe('NOT_CRAFT_OWNER')
      expect((await call(name, r.owner, { ...input, craftId: 'missing-production-craft' })).reason).toBe('CRAFT_NOT_FOUND')
      for (const extra of [{ ownerUid: r.owner.localId }, { roomId: r.craftId }, { schemaVersion: 1 }]) expect((await call(name, r.owner, { ...input, ...extra })).reason).toBe('VALIDATION_FAILED')
    }
    expect((await call('startCraft', r.owner, { ...r.start, template: templateFixture })).reason).toBe('VALIDATION_FAILED')
    expect((await call('completeStep', r.owner, { ...r.step, completedAt: new Date().toISOString() })).reason).toBe('VALIDATION_FAILED')
  })
  it('検証済み作品全体と順番どおりの全工程を同時保存し、本人だけが購読できる', async () => {
    const r = await started()
    expect(ProductionSnapshotSchema.parse(r.started)).toMatchObject({ schemaVersion: 2, craft: { status: 'crafting', selectedTemplateId: templateFixture.id, revision: 4 }, production: { revision: 0, materialRevision: 2, template: templateFixture, steps: [{ stepId: 'a', completedAt: null }, { stepId: 'b', completedAt: null }] } })
    expect((await r.production.get()).data()?.startedAt).toBeInstanceOf(Timestamp)
    const owner = environment.authenticatedContext(r.owner.localId).firestore()
    const document = await assertSucceeds(owner.doc(r.production.path).get())
    expect(clientToWire(document.data())).toEqual(r.started.production)
    await assertFails(owner.doc(r.production.path).update({ steps: [] }))
    await assertFails(owner.doc(r.ref.path).update({ status: 'completed' }))
    await assertFails(environment.authenticatedContext(r.other.localId).firestore().doc(r.production.path).get())
    await assertFails(environment.unauthenticatedContext().firestore().doc(r.production.path).get())
  })
  it('未確定・古い材料版・不正な候補/内部版を開始できない', async () => {
    const fresh = await draft()
    await expect(service('startCraft', fresh.owner.localId, fresh.start, catalog)).rejects.toMatchObject(denied('INVALID_CRAFT_STATE'))
    const r = await ready()
    await expect(service('startCraft', r.owner.localId, { ...r.start, materialRevision: 1 }, catalog)).rejects.toMatchObject(denied('STALE_REVISION'))
    for (const patch of [{ confirmed: false }, { materialRevision: 1 }, { catalogRevision: '0'.repeat(64) }]) {
      const saved = (await r.state.get()).data()!
      await r.state.update(patch)
      await expect(service('startCraft', r.owner.localId, { ...r.start, requestId: randomUUID() }, catalog)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
      await r.state.set(saved)
    }
    await r.candidates.update({ materialRevision: 1 })
    await expect(service('startCraft', r.owner.localId, { ...r.start, requestId: randomUUID() }, catalog)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
    expect((await r.production.get()).exists).toBe(false)
  })
  it('候補trueだけを信用せず材料/工具/確認を再判定し、欠けたデータも拒否する', async () => {
    for (const patch of [{ items: [{ ...materialsFixture.items[0]!, quantity: 1 }] }, { tools: [] }, { checks: [{ id: 'dry', confirmed: null }] }, { confirmedAt: null }]) {
      const r = await ready()
      await r.materials.update(patch)
      await expect(service('startCraft', r.owner.localId, r.start, catalog)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
      expect((await r.production.get()).exists).toBe(false)
    }
    for (const key of ['candidates', 'state', 'materials'] as const) {
      const r = await ready(); await r[key].delete()
      await expect(service('startCraft', r.owner.localId, r.start, catalog)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
    }
  })
  it('カタログ/質問変更・未知作品・候補から外れた作品・不足候補を拒否する', async () => {
    const r = await ready()
    const changed = () => parseProjectCatalog([{ ...templateFixture, checks: [{ id: 'dry', label: { ja: '新しい質問', en: 'New question' } }] }])
    await expect(service('startCraft', r.owner.localId, r.start, changed)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
    await expect(service('startCraft', r.owner.localId, { ...r.start, requestId: randomUUID(), templateId: 'unknown' }, catalog)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
    await r.candidates.update({ candidates: [] })
    await expect(service('startCraft', r.owner.localId, { ...r.start, requestId: randomUUID() }, catalog)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
    await r.candidates.update({ candidates: [{ templateId: templateFixture.id, feasible: false, missing: [], reason: { ja: '不足', en: 'Missing' } }] })
    await expect(service('startCraft', r.owner.localId, { ...r.start, requestId: randomUUID() }, catalog)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
  })
  it('既存の制作文書を上書きせず、開始後の新しい開始/材料変更も拒否する', async () => {
    const r = await ready(); await r.production.set({ sentinel: 'do not overwrite' })
    await expect(service('startCraft', r.owner.localId, r.start, catalog)).rejects.toMatchObject(denied('PRODUCTION_NOT_READY'))
    expect((await r.production.get()).data()).toEqual({ sentinel: 'do not overwrite' })
    const s = await started()
    await expect(service('startCraft', s.owner.localId, { ...s.start, requestId: randomUUID() }, catalog)).rejects.toMatchObject(denied('INVALID_CRAFT_STATE'))
    await expect(materialService('editMaterials', s.owner.localId, { requestId: randomUUID(), craftId: s.craftId, expectedRevision: 2, items: materialsFixture.items, tools: [] }, catalog)).rejects.toMatchObject(denied('INVALID_CRAFT_STATE'))
  })
  it('同じ開始の同時送信を一度に集約し、異なる入力のキー再利用を拒否する', async () => {
    const r = await ready()
    const results = await Promise.all(Array.from({ length: 4 }, () => service('startCraft', r.owner.localId, r.start, catalog)))
    expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true)
    expect((await r.ref.get()).data()?.revision).toBe(4)
    await expect(service('startCraft', r.owner.localId, { ...r.start, templateId: 'different' }, catalog)).rejects.toMatchObject(denied('IDEMPOTENCY_CONFLICT'))
  })
  it('別作品の同時開始では一方だけを固定する', async () => {
    const other = { ...templateFixture, id: 'second-template' }
    const provider = () => parseProjectCatalog([templateFixture, other])
    const r = await ready(provider)
    const results = await Promise.allSettled([
      service('startCraft', r.owner.localId, r.start, provider),
      service('startCraft', r.owner.localId, { ...r.start, requestId: randomUUID(), templateId: other.id }, provider),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')?.reason).toMatchObject(denied('INVALID_CRAFT_STATE'))
    expect((await r.ref.get()).data()?.selectedTemplateId).toBe((await r.production.get()).data()?.template.id)
  })
  it('再編集と開始の競合で、古い材料からの開始/候補利用を残さない', async () => {
    const r = await ready()
    const results = await Promise.allSettled([
      service('startCraft', r.owner.localId, r.start, catalog),
      materialService('editMaterials', r.owner.localId, { requestId: randomUUID(), craftId: r.craftId, expectedRevision: 2, items: materialsFixture.items, tools: [] }, catalog),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const root = (await r.ref.get()).data()!
    if (root.status === 'crafting') expect((await r.production.get()).data()?.materialRevision).toBe((await r.materials.get()).data()?.revision)
    else { expect(root.status).toBe('materials'); expect((await r.production.get()).exists).toBe(false); expect((await r.candidates.get()).exists).toBe(false) }
  })
})

describe('工程完了と成功再送', () => {
  it('実callableで一工程ずつ完了し、最終工程後も#34までcraftingを維持する', async () => {
    const r = await started()
    const first = ProductionSnapshotSchema.parse((await call('completeStep', r.owner, r.step)).data)
    expect(first.production.revision).toBe(1)
    expect(getProductionProgress(first.production).nextStepId).toBe('b')
    const last = ProductionSnapshotSchema.parse((await call('completeStep', r.owner, { ...r.step, requestId: randomUUID(), stepId: 'b', expectedRevision: 1 })).data)
    expect(getProductionProgress(last.production).allStepsCompleted).toBe(true)
    expect(last.craft).toMatchObject({ status: 'crafting', completedAt: null, revision: 6 })
    const saved = (await r.production.get()).data()!
    expect(saved.startedAt).toBeInstanceOf(Timestamp)
    expect(saved.steps.every((step: { completedAt: unknown }) => step.completedAt instanceof Timestamp)).toBe(true)
    expect(saved.template).toEqual(templateFixture)
  })
  it('飛ばし・未知工程・古い版/未来の版を構造化エラーで拒否する', async () => {
    const r = await started()
    expect((await call('completeStep', r.owner, { ...r.step, stepId: 'b' })).reason).toBe('DEPENDENCY_NOT_COMPLETED')
    expect((await call('completeStep', r.owner, { ...r.step, stepId: 'missing' })).reason).toBe('STEP_NOT_FOUND')
    expect((await call('completeStep', r.owner, { ...r.step, expectedRevision: 99 })).reason).toBe('STALE_REVISION')
    await service('completeStep', r.owner.localId, r.step)
    expect((await call('completeStep', r.owner, { ...r.step, requestId: randomUUID(), stepId: 'b' })).reason).toBe('STALE_REVISION')
    expect((await r.production.get()).data()?.revision).toBe(1)
  })
  it('同時再送/別IDの二重完了でも時刻と版を一度だけ更新する', async () => {
    const r = await started()
    const results = await Promise.all(Array.from({ length: 4 }, () => service('completeStep', r.owner.localId, r.step)))
    expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true)
    const again = await service('completeStep', r.owner.localId, { ...r.step, requestId: randomUUID() })
    expect(again).toEqual(results[0])
    expect((await r.production.get()).data()?.revision).toBe(1)
    await expect(service('completeStep', r.owner.localId, { ...r.step, stepId: 'b' })).rejects.toMatchObject(denied('IDEMPOTENCY_CONFLICT'))
  })
  it('前工程と次工程の同時要求でも、古い版で次工程を完了しない', async () => {
    const r = await started()
    const results = await Promise.allSettled([
      service('completeStep', r.owner.localId, r.step),
      service('completeStep', r.owner.localId, { ...r.step, requestId: randomUUID(), stepId: 'b' }),
    ])
    expect(results[0]?.status).toBe('fulfilled')
    expect(results[1]?.status).toBe('rejected')
    if (results[1]?.status === 'rejected') expect(['DEPENDENCY_NOT_COMPLETED', 'STALE_REVISION']).toContain(results[1].reason.details.reason)
    expect((await r.production.get()).data()?.steps[1]?.completedAt).toBeNull()
  })
  it('開始後のカタログを読み直さず、固定した作品で進捗/開始再送を返す', async () => {
    const r = await started()
    const unavailable = () => { throw new Error('The live catalog must not be used after start') }
    await service('completeStep', r.owner.localId, r.step, unavailable)
    const retried = await service('startCraft', r.owner.localId, r.start, unavailable)
    expect(retried.production.revision).toBe(1)
    expect(retried.production.template).toEqual(templateFixture)
  })
  it('完成状態からの成功再送/完了済み操作で制作を戻さず日時も変えない', async () => {
    const r = await started()
    await service('completeStep', r.owner.localId, r.step)
    await service('completeStep', r.owner.localId, { ...r.step, requestId: randomUUID(), stepId: 'b', expectedRevision: 1 })
    const completedAt = Timestamp.now()
    await r.ref.update({ status: 'completed', completedAt, revision: 7 }) // #34's future persisted state.
    const saved = toWire((await r.production.get()).data())
    const again = await service('completeStep', r.owner.localId, r.step)
    expect(again.craft).toMatchObject({ status: 'completed', revision: 7, completedAt: completedAt.toDate().toISOString() })
    expect((await service('startCraft', r.owner.localId, r.start)).craft.status).toBe('completed')
    await service('completeStep', r.owner.localId, { ...r.step, requestId: randomUUID() })
    expect(toWire((await r.production.get()).data())).toEqual(saved)
    expect((await r.ref.get()).data()?.revision).toBe(7)
  })
  it('欠落/v1/順序改変/作品不一致/材料版不一致を推測で補わない', async () => {
    for (const change of ['missing', 'v1', 'order', 'template', 'materials'] as const) {
      const r = await started()
      if (change === 'missing') await r.production.delete()
      if (change === 'v1') await r.production.update({ schemaVersion: 1 })
      if (change === 'order') await r.production.update({ steps: [...r.started.production.steps].reverse() })
      if (change === 'template') await r.ref.update({ selectedTemplateId: 'different' })
      if (change === 'materials') await r.materials.update({ revision: 3 })
      expect((await call('completeStep', r.owner, r.step)).reason).toBe('PRODUCTION_NOT_READY')
    }
  })
  it('成功再送でも所有者を再確認する', async () => {
    const r = await started()
    await service('completeStep', r.owner.localId, r.step)
    await r.ref.update({ ownerUid: r.other.localId })
    await expect(service('startCraft', r.owner.localId, r.start)).rejects.toMatchObject(denied('NOT_CRAFT_OWNER'))
    await expect(service('completeStep', r.owner.localId, r.step)).rejects.toMatchObject(denied('NOT_CRAFT_OWNER'))
  })
  it('開始の失敗10回で制限し、工程の制限中も成功済み再送は返す', async () => {
    const r = await ready()
    for (let i = 0; i < 10; i++) await expect(service('startCraft', r.owner.localId, { ...r.start, requestId: randomUUID(), templateId: 'unknown' }, catalog)).rejects.toMatchObject(denied('CANDIDATES_NOT_READY'))
    await expect(service('startCraft', r.owner.localId, r.start, catalog)).rejects.toMatchObject(denied('RATE_LIMITED'))
    const s = await started(); await service('completeStep', s.owner.localId, s.step)
    const hash = createHash('sha256').update(`${s.owner.localId}\0completeStep`).digest('hex')
    await getFirestore().doc(`operationLimits/${hash}`).set({ windowStart: Timestamp.now(), attempts: 119 })
    await expect(service('completeStep', s.owner.localId, { ...s.step, requestId: randomUUID(), stepId: 'missing' })).rejects.toMatchObject(denied('STEP_NOT_FOUND'))
    await expect(service('completeStep', s.owner.localId, { ...s.step, requestId: randomUUID(), stepId: 'b', expectedRevision: 1 })).rejects.toMatchObject(denied('RATE_LIMITED'))
    expect((await service('completeStep', s.owner.localId, s.step)).production.revision).toBe(1)
  })
})
