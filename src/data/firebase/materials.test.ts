import { beforeEach, describe, expect, it, vi } from 'vitest'
import { materialRecognitionResponseFixtures } from '@rekt/shared'

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), upload: vi.fn(), call: vi.fn(), uid: vi.fn(), storage: {} }))
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, fullPath: string) => ({ fullPath }), getMetadata: mocks.metadata, uploadBytes: mocks.upload }))
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.call }))
vi.mock('./client', () => ({ getFirebaseServices: () => ({ storage: mocks.storage, functions: {} }) }))
vi.mock('./auth', () => ({ ensureGuestUserId: mocks.uid }))
import { firebaseMaterialsGateway } from './materials'

const input = { craftId: 'fixture-craft', photoId: 'photo', blob: new Blob(['jpeg'], { type: 'image/jpeg' }) }
const metadata = { contentType: 'image/jpeg', size: 4, generation: '1234567890123456' }
beforeEach(() => {
  vi.resetAllMocks(); mocks.uid.mockResolvedValue('fixture-owner')
  mocks.call.mockResolvedValue({ data: { schemaVersion: 2, craftId: input.craftId, photoId: input.photoId, kind: 'materials', contentType: 'image/jpeg', sizeBytes: 4, path: 'crafts/fixture-craft/materials/photo.jpg', createdAt: '2026-11-06T00:00:00.000Z' } })
})

describe('Storage画像と材料認識の接続', () => {
  it('認証UIDのパスへアップロードし、世代を文字列のまま渡す', async () => {
    mocks.metadata.mockRejectedValue({ code: 'storage/object-not-found' }); mocks.upload.mockResolvedValue({ metadata })
    expect(await firebaseMaterialsGateway.uploadMaterialPhoto(input)).toEqual({ imagePath: 'crafts/fixture-craft/materials/photo.jpg', imageGeneration: metadata.generation })
    expect(mocks.upload.mock.calls[0]?.[0].fullPath).toBe('crafts/fixture-craft/materials/photo.jpg')
    expect(mocks.call).toHaveBeenCalledWith({ craftId: input.craftId, photoId: input.photoId, kind: 'materials', contentType: 'image/jpeg', sizeBytes: 4 })
  })
  it('前回のアップロード完了後に通信が切れていても上書きしない', async () => {
    mocks.metadata.mockResolvedValue(metadata)
    expect((await firebaseMaterialsGateway.uploadMaterialPhoto(input)).imageGeneration).toBe(metadata.generation)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalled()
  })
  it('メタデータの取得失敗では勝手に再アップロードしない', async () => {
    mocks.metadata.mockRejectedValue({ code: 'storage/unauthorized' })
    await expect(firebaseMaterialsGateway.uploadMaterialPhoto(input)).rejects.toHaveProperty('reason')
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('予約の上限拒否や不正な応答ではStorageへ送らず、同じphotoIdで予約を再送する', async () => {
    mocks.metadata.mockRejectedValue({ code: 'storage/object-not-found' })
    mocks.call.mockRejectedValue({ details: { schemaVersion: 2, reason: 'PHOTO_LIMIT_REACHED' } })
    await expect(firebaseMaterialsGateway.uploadMaterialPhoto(input)).rejects.toMatchObject({ reason: 'PHOTO_LIMIT_REACHED' })
    await expect(firebaseMaterialsGateway.uploadMaterialPhoto(input)).rejects.toMatchObject({ reason: 'PHOTO_LIMIT_REACHED' })
    expect(mocks.call.mock.calls[0]).toEqual(mocks.call.mock.calls[1])
    expect(mocks.upload).not.toHaveBeenCalled()
    mocks.call.mockResolvedValue({ data: {} })
    await expect(firebaseMaterialsGateway.uploadMaterialPhoto(input)).rejects.toHaveProperty('reason')
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('認識の終端失敗を契約どおり返し、旧形式の画像inline入力を拒否する', async () => {
    const response = materialRecognitionResponseFixtures.timeout
    const operation = { requestId: response.requestId, craftId: response.craftId, expectedCraftRevision: 2, locale: 'ja' as const, imagePath: response.imagePath, imageGeneration: response.imageGeneration }
    mocks.call.mockResolvedValue({ data: response })
    expect(await firebaseMaterialsGateway.recognizeMaterials(operation)).toEqual(response)
    await expect(firebaseMaterialsGateway.recognizeMaterials({ ...operation, image: { data: 'jpeg' } } as typeof operation)).rejects.toMatchObject({ reason: 'VALIDATION_FAILED' })
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })
})
