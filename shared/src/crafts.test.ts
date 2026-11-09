import { describe, expect, it } from 'vitest'
import { CraftDocumentSchema, CraftSnapshotSchema, CreateCraftInputSchema } from './crafts'
import { craftFixture, materialsFixture, noCandidatesFixture, productionFixture, templateFixture } from './fixtures'
import { CompleteCraftInputSchema, MaterialsDocumentSchema, ProductionDocumentSchema, TemplateSchema } from './workshop'

describe('単独制作v2の最小契約', () => {
  it('所有者一人で開始し、名前・人数・役割・v1文書を受け付けない', () => {
    const snapshot = craftFixture()
    expect(CraftSnapshotSchema.safeParse(snapshot).success).toBe(true)
    for (const patch of [{ hostUid: 'x' }, { members: {} }, { status: 'lobby' }, { status: 'assignment' }]) expect(CraftSnapshotSchema.safeParse({ ...snapshot, craft: { ...snapshot.craft, ...patch } }).success).toBe(false)
    const craft = Object.fromEntries(Object.entries(snapshot.craft).filter(([key]) => key !== 'id'))
    expect(CraftDocumentSchema.safeParse({ schemaVersion: 1, ...craft }).success).toBe(false)
    expect(CreateCraftInputSchema.safeParse({ requestId: '00000000-0000-4000-8000-000000000001', locale: 'ja', ownerUid: 'forged' }).success).toBe(false)
  })
  it('制作状態と確定作品・完成日時の不一致を拒否する', () => {
    const snapshot = craftFixture()
    for (const patch of [{ selectedTemplateId: 'x' }, { status: 'crafting' }, { status: 'completed', selectedTemplateId: 'x' }, { completedAt: snapshot.craft.createdAt }]) expect(CraftSnapshotSchema.safeParse({ ...snapshot, craft: { ...snapshot.craft, ...patch } }).success).toBe(false)
  })
  it('人数・担当パーツを持たず、重複しない順序付き工程を持つ', () => {
    expect(TemplateSchema.safeParse(templateFixture).success).toBe(true)
    for (const patch of [{ minMembers: 2 }, { parts: [] }, { steps: [templateFixture.steps[0], templateFixture.steps[0]] }, { verified: false }]) expect(TemplateSchema.safeParse({ ...templateFixture, ...patch }).success).toBe(false)
  })
  it('工程の重複・欠落・順序違い・飛ばして完了を拒否する', () => {
    expect(ProductionDocumentSchema.safeParse(productionFixture).success).toBe(true)
    for (const steps of [productionFixture.steps.slice(1), [...productionFixture.steps].reverse(), productionFixture.steps.map((step, i) => ({ ...step, completedAt: i === 1 ? productionFixture.startedAt : null }))]) expect(ProductionDocumentSchema.safeParse({ ...productionFixture, steps }).success).toBe(false)
  })
  it('Firestoreへ固定できない大きさの作品データを拒否する', () => {
    const text = { ja: 'x'.repeat(2000), en: 'x'.repeat(2000) }
    const huge = { ...templateFixture, steps: Array.from({ length: 100 }, (_, i) => ({ ...templateFixture.steps[0]!, id: `s-${i}`, title: text, instructions: text, safety: text })) }
    expect(TemplateSchema.safeParse(huge).success).toBe(false)
  })
  it('確認条件は明示したtrue/false/nullを扱い、重複IDを拒否する', () => {
    for (const confirmed of [true, false, null]) expect(MaterialsDocumentSchema.safeParse({ ...materialsFixture, checks: [{ id: 'dry', confirmed }] }).success).toBe(true)
    expect(MaterialsDocumentSchema.safeParse({ ...materialsFixture, checks: [{ id: 'dry', confirmed: true }, { id: 'dry', confirmed: null }] }).success).toBe(false)
    expect(MaterialsDocumentSchema.safeParse({ ...materialsFixture, confirmedBy: 'host' }).success).toBe(false)
    expect(noCandidatesFixture.candidates).toEqual([])
  })
  it('完成写真の別制作・URL・旧ルームパスを拒否する', () => {
    const input = { requestId: '00000000-0000-4000-8000-000000000001', craftId: 'mine', photoPath: null }
    expect(CompleteCraftInputSchema.safeParse(input).success).toBe(true)
    for (const photoPath of ['crafts/other/completion/a.jpg', 'https://example.com/a.jpg', 'rooms/mine/completion/a.jpg']) expect(CompleteCraftInputSchema.safeParse({ ...input, photoPath }).success).toBe(false)
  })
})
