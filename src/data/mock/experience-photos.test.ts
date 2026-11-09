// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayError } from '@rekt/shared'
import { createMockCraftGateway } from './crafts'
import { createMockMaterialsGateway } from './materials'
import { createMockProjectsGateway } from './projects'
import { createMockExperienceGateway } from './experience'

// IndexedDBの代わり（テスト環境にはない）。容量不足を再現できるようにする。
const photos = vi.hoisted(() => ({ saved: new Map<string, Blob>(), put: vi.fn() }))
vi.mock('./photoStore', () => ({
  putMockPhoto: photos.put,
  getMockPhotoBlob: async (path: string) => photos.saved.get(path) ?? null,
  getMockPhoto: async () => null,
}))
const id = () => crypto.randomUUID()
const jpeg = (text: string) => new Blob([text], { type: 'image/jpeg' })
async function finished() {
  const { craft } = await createMockCraftGateway(localStorage, 'owner').createCraft({ requestId: id(), locale: 'ja' })
  const materials = createMockMaterialsGateway(localStorage, 'owner')
  await materials.editMaterials({ requestId: id(), craftId: craft.id, expectedRevision: 0, tools: [], items: [{ id: 'cardboard', name: '段ボール', unit: '枚', quantity: 1, source: 'manual', confidence: null }] })
  await materials.confirmMaterials({ requestId: id(), craftId: craft.id, expectedRevision: 1 })
  const document = await createMockProjectsGateway(localStorage, 'owner').generateProjects({ craftId: craft.id, materialRevision: 1 })
  const experience = createMockExperienceGateway(localStorage, 'owner')
  let snapshot = await experience.startCraft({ requestId: id(), craftId: craft.id, templateId: document.templates![0]!.id, materialRevision: 1 })
  for (const step of snapshot.production.steps) snapshot = await experience.completeStep({ requestId: id(), craftId: craft.id, stepId: step.stepId, expectedRevision: snapshot.production.revision })
  return { craftId: craft.id, experience }
}
beforeEach(() => {
  localStorage.clear(); photos.saved.clear(); photos.put.mockReset()
  photos.put.mockImplementation(async (path: string, blob: Blob) => {
    if (!photos.saved.has(path)) photos.saved.set(path, blob)
  })
})

describe('体験版の完成写真（#17）', () => {
  it('結果不明のあとの再送では、同じパスの写真を上書きしない', async () => {
    const { craftId, experience } = await finished()
    const first = await experience.uploadCompletionPhoto({ craftId, photoId: 'p1', blob: jpeg('first') })
    const again = await experience.uploadCompletionPhoto({ craftId, photoId: 'p1', blob: jpeg('second') })
    expect(again).toEqual(first)
    expect(await photos.saved.get(first.photoPath)?.text()).toBe('first')
  })
  it('端末の容量不足では写真の上限として返し、写真なしで完成できる', async () => {
    const { craftId, experience } = await finished()
    photos.put.mockRejectedValueOnce(new GatewayError('PHOTO_LIMIT_REACHED'))
    await expect(experience.uploadCompletionPhoto({ craftId, photoId: 'p1', blob: jpeg('x') })).rejects.toMatchObject({ reason: 'PHOTO_LIMIT_REACHED' })
    const done = await experience.completeCraft({ requestId: id(), craftId, photoPath: null })
    expect(done.craft.status).toBe('completed')
    expect(await experience.getCompletionPhoto(craftId)).toBeNull()
  })
})
