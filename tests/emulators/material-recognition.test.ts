import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { MaterialRecognitionResponseSchema, CraftSnapshotSchema } from '@rekt/shared'
import type { RecognizeMaterialsInput } from '@rekt/shared'
import { loadMaterialImage } from '../../functions/src/features/materials/image'
import { materialRecognitionFixtures } from '../../functions/src/features/materials/fixtures'

const project = 'demo-co-make'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=', 'base64')
let service: typeof import('../../functions/src/features/materials/service').runMaterialRecognition
let environment: RulesTestEnvironment
type Guest = { idToken: string; localId: string }
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
async function readyCraft() {
  const owner = await guest(); const other = await guest()
  const snapshot = CraftSnapshotSchema.parse((await call('createCraft', owner, { requestId: randomUUID(), locale: 'ja' })).data)
  const path = `crafts/${snapshot.craft.id}/materials/${randomUUID()}.png`
  const file = getStorage().bucket(`${project}.appspot.com`).file(path)
  await file.save(png, { resumable: false, metadata: { contentType: 'image/png' } })
  const [metadata] = await file.getMetadata()
  const input: RecognizeMaterialsInput = { requestId: randomUUID(), craftId: snapshot.craft.id, expectedCraftRevision: snapshot.craft.revision, imagePath: path, imageGeneration: String(metadata.generation), locale: 'ja' }
  return { owner, other, input, snapshot, file }
}
const fakeImage = async () => ({ bytes: png, mimeType: 'image/png' as const })
const fakeDependencies = (infer = vi.fn().mockResolvedValue(materialRecognitionFixtures.ja)) => ({ engine: 'fixture' as const, loadImage: fakeImage, infer })

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.FIREBASE_STORAGE_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Run npm run test:emulators; real services are forbidden')
  process.env.GCLOUD_PROJECT = project
  if (!getApps().length) initializeApp({ projectId: project, storageBucket: `${project}.appspot.com` })
  service = (await import('../../functions/src/features/materials/service')).runMaterialRecognition
  environment = await initializeTestEnvironment({ projectId: project,
    firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9198, rules: await readFile('storage.rules', 'utf8') },
  })
})
afterAll(async () => { await environment?.cleanup() })

describe('材料認識callableの受け渡しと認可', () => {
  it('実際のStorage画像を参照し、候補だけを返して材料/状態を自動確定しない', async () => {
    const { owner, input, snapshot } = await readyCraft()
    const response = await call('recognizeMaterials', owner, input)
    expect(response.status).toBe(200)
    const result = MaterialRecognitionResponseSchema.parse(response.data)
    expect(result).toMatchObject({ engine: 'fixture', status: 'succeeded', requiresConfirmation: true })
    if (result.status !== 'succeeded') throw new Error(result.reason)
    expect(result.result.items[0]).toMatchObject({ source: 'ai', name: '段ボール', quantity: 2 })
    expect(result.result.warnings[0]).toContain('固定応答')
    const craft = await getFirestore().doc(`crafts/${input.craftId}`).get()
    expect(craft.data()?.status).toBe(snapshot.craft.status)
    expect(craft.data()?.revision).toBe(snapshot.craft.revision)
    expect((await craft.ref.collection('workshop').get()).size).toBe(0)
    expect((await call('recognizeMaterials', owner, input)).data).toEqual(response.data)
  })
  it('未認証・別UID・別制作の画像を拒否する', async () => {
    const { owner, other, input } = await readyCraft()
    expect((await call('recognizeMaterials', undefined, input)).reason).toBe('UNAUTHENTICATED')
    expect((await call('recognizeMaterials', other, input)).reason).toBe('NOT_CRAFT_OWNER')
    expect((await call('recognizeMaterials', owner, { ...input, imagePath: input.imagePath.replace(input.craftId, 'other-craft') })).reason).toBe('VALIDATION_FAILED')
    expect((await call('recognizeMaterials', owner, { ...input, expectedCraftRevision: 99 })).reason).toBe('STALE_REVISION')
  })
  it('世代違いとMIME偽装はGeminiを呼ばず失敗する', async () => {
    const { owner, input, file } = await readyCraft()
    const infer = vi.fn().mockResolvedValue(materialRecognitionFixtures.ja)
    const missing = await service(owner.localId, { ...input, imageGeneration: (BigInt(input.imageGeneration) + 1n).toString() }, { engine: 'fixture', loadImage: loadMaterialImage, infer })
    expect(missing).toMatchObject({ status: 'failed', reason: 'IMAGE_NOT_FOUND' })
    await file.setMetadata({ contentType: 'image/jpeg' })
    const invalid = await service(owner.localId, { ...input, requestId: randomUUID() }, { engine: 'fixture', loadImage: loadMaterialImage, infer })
    expect(invalid).toMatchObject({ status: 'failed', reason: 'INVALID_IMAGE' })
    expect(infer).not.toHaveBeenCalled()
  })
  it('認識記録と試行上限はメンバーにも公開しない', async () => {
    const { owner, other, input } = await readyCraft()
    await call('recognizeMaterials', owner, input)
    const firestore = environment.authenticatedContext(owner.localId).firestore()
    await assertFails(firestore.collection(`crafts/${input.craftId}/recognitionRequests`).get())
    await assertFails(firestore.doc('aiUsage/materials-global').get())
    await assertFails(firestore.doc('aiUsage/materials-global').set({ dayCount: 0 }))
    await assertFails(Promise.resolve(environment.authenticatedContext(other.localId).storage().ref(input.imagePath).getMetadata()))
  })
})

describe('有料処理の重複防止と変更競合', () => {
  it('成功と失敗を保存し、同じ要求で再推論しない', async () => {
    const { owner, input } = await readyCraft()
    const dependencies = fakeDependencies()
    const first = await service(owner.localId, input, dependencies)
    expect(await service(owner.localId, input, dependencies)).toEqual(first)
    expect(dependencies.infer).toHaveBeenCalledTimes(1)
    await expect(service(owner.localId, { ...input, locale: 'en' }, dependencies)).rejects.toMatchObject({ details: { schemaVersion: 2, reason: 'IDEMPOTENCY_CONFLICT' } })
    const bad = fakeDependencies(vi.fn().mockResolvedValue(materialRecognitionFixtures.malformed))
    const retry = { ...input, requestId: randomUUID() }
    const failure = await service(owner.localId, retry, bad)
    expect(failure).toMatchObject({ status: 'failed', reason: 'AI_RESPONSE_INVALID' })
    expect(await service(owner.localId, retry, bad)).toEqual(failure)
    expect(bad.infer).toHaveBeenCalledTimes(1)
  })
  it('同時要求は処理中を返し、タイムアウト後も同じIDの推論を再起動しない', async () => {
    const { owner, input } = await readyCraft()
    let release!: (value: unknown) => void
    const infer = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const dependencies = fakeDependencies(infer)
    const first = service(owner.localId, input, dependencies)
    await vi.waitFor(() => expect(infer).toHaveBeenCalledTimes(1))
    await expect(service(owner.localId, input, dependencies)).rejects.toMatchObject({ details: { schemaVersion: 2, reason: 'AI_REQUEST_IN_PROGRESS' } })
    const records = await getFirestore().collection(`crafts/${input.craftId}/recognitionRequests`).get()
    await records.docs[0]!.ref.update({ deadline: Timestamp.fromMillis(Date.now() - 1) })
    const expired = await service(owner.localId, input, dependencies)
    expect(expired).toMatchObject({ status: 'failed', reason: 'AI_TIMEOUT' })
    release(materialRecognitionFixtures.ja)
    expect(await first).toEqual(expired)
    expect(infer).toHaveBeenCalledTimes(1)
  })
  it('認識中に材料の版が変わったら古い結果を適用させない', async () => {
    const { owner, input } = await readyCraft()
    const infer = vi.fn(async () => { await getFirestore().doc(`crafts/${input.craftId}`).update({ revision: input.expectedCraftRevision + 1 }); return materialRecognitionFixtures.ja })
    expect(await service(owner.localId, input, fakeDependencies(infer))).toMatchObject({ status: 'failed', reason: 'STALE_REVISION' })
  })
  it('UIDの分/日上限とプロジェクトの日上限を超えて推論しない', async () => {
    const { owner, input } = await readyCraft()
    const dependencies = fakeDependencies()
    for (let index = 0; index < 3; index++) await service(owner.localId, { ...input, requestId: randomUUID() }, dependencies)
    await expect(service(owner.localId, input, dependencies)).rejects.toMatchObject({ details: { schemaVersion: 2, reason: 'RATE_LIMITED' } })
    const uidHash = createHash('sha256').update(owner.localId).digest('hex')
    await getFirestore().doc(`aiUsage/materials-${uidHash}`).update({ windowStartedAt: Timestamp.fromMillis(Date.now() - 61_000), dayCount: 20 })
    await expect(service(owner.localId, input, dependencies)).rejects.toMatchObject({ details: { schemaVersion: 2, reason: 'AI_BUDGET_EXHAUSTED' } })
    const other = await readyCraft()
    const global = getFirestore().doc('aiUsage/materials-global')
    const previous = (await global.get()).data()!
    try {
      await global.update({ dayCount: 50 })
      await expect(service(other.owner.localId, other.input, dependencies)).rejects.toMatchObject({ details: { schemaVersion: 2, reason: 'AI_BUDGET_EXHAUSTED' } })
    } finally { await global.set(previous) }
    expect(dependencies.infer).toHaveBeenCalledTimes(3)
  })
})
