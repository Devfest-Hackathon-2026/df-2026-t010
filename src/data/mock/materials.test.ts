// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Material, MaterialsDocument } from '@rekt/shared'
import { createMockCraftGateway, readMockCraft, writeMockCraft } from './crafts'
import { createMockMaterialsGateway } from './materials'
const id = () => crypto.randomUUID()
const item: Material = { id: 'manual-paper', name: '紙', quantity: 2, unit: '枚', source: 'manual', confidence: null }
async function ready() {
  const gateway = createMockCraftGateway(localStorage, 'owner')
  const snapshot = await gateway.createCraft({ requestId: id(), locale: 'ja' })
  return { craftId: snapshot.craft.id, snapshot, materials: createMockMaterialsGateway(localStorage, 'owner') }
}
function latest(craftId: string, uid = 'owner') {
  return new Promise<MaterialsDocument | null>((resolve, reject) => {
    const stop = createMockMaterialsGateway(localStorage, uid).subscribeToMaterials(craftId, (doc) => { stop(); resolve(doc) }, reject)
  })
}
beforeEach(() => localStorage.clear())
describe('単独制作のmock契約', () => {
  it('一人で編集・確定・再編集できる', async () => {
    const { craftId, materials } = await ready()
    await materials.editMaterials({ requestId: id(), craftId, expectedRevision: 0, items: [item], tools: [] })
    await materials.confirmMaterials({ requestId: id(), craftId, expectedRevision: 1 })
    expect(readMockCraft(localStorage, craftId)?.craft.status).toBe('project_selection')
    await materials.editMaterials({ requestId: id(), craftId, expectedRevision: 1, items: [item], tools: [] })
    expect(readMockCraft(localStorage, craftId)?.craft.status).toBe('materials')
    expect(await latest(craftId)).toMatchObject({ schemaVersion: 2, revision: 2, confirmedAt: null })
  })
  it('別UIDの購読・編集・確定を拒否する', async () => {
    const { craftId } = await ready()
    const other = createMockMaterialsGateway(localStorage, 'other')
    await expect(latest(craftId, 'other')).rejects.toMatchObject({ reason: 'NOT_CRAFT_OWNER' })
    await expect(other.editMaterials({ requestId: id(), craftId, expectedRevision: 0, items: [], tools: [] })).rejects.toMatchObject({ reason: 'NOT_CRAFT_OWNER' })
    await expect(other.confirmMaterials({ requestId: id(), craftId, expectedRevision: 0 })).rejects.toMatchObject({ reason: 'NOT_CRAFT_OWNER' })
  })
  it('古い版・別入力のキー再利用を拒否し、再送を二重反映しない', async () => {
    const { craftId, materials } = await ready()
    const input = { requestId: id(), craftId, expectedRevision: 0, items: [item], tools: [] }
    await materials.editMaterials(input); await materials.editMaterials(input)
    expect((await latest(craftId))?.revision).toBe(1)
    await expect(materials.editMaterials({ ...input, requestId: id() })).rejects.toMatchObject({ reason: 'STALE_REVISION' })
    await expect(materials.editMaterials({ ...input, tools: ['はさみ'] })).rejects.toMatchObject({ reason: 'IDEMPOTENCY_CONFLICT' })
  })
  it('制作開始後の編集と空の確定を拒否する', async () => {
    const { craftId, snapshot, materials } = await ready()
    await expect(materials.confirmMaterials({ requestId: id(), craftId, expectedRevision: 0 })).rejects.toMatchObject({ reason: 'VALIDATION_FAILED' })
    writeMockCraft(localStorage, { ...snapshot, craft: { ...snapshot.craft, status: 'crafting', selectedTemplateId: 'test' } })
    await expect(materials.editMaterials({ requestId: id(), craftId, expectedRevision: 0, items: [item], tools: [] })).rejects.toMatchObject({ reason: 'INVALID_CRAFT_STATE' })
  })
})
