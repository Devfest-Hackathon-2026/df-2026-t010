// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { GatewayError, TemplateSchema, templateFixture } from '@rekt/shared'
import type { CandidatesDocument, Material, MaterialsDocument } from '@rekt/shared'
import { buildMockCandidates, readMockCandidates } from './candidates'
import { createMockCraftGateway } from './crafts'
import { createMockMaterialsGateway } from './materials'
import { createMockProjectsGateway } from './projects'

const id = () => crypto.randomUUID()
const now = '2026-11-06T02:00:00.000Z'
let serial = 0
const item = (name: string, quantity: number, unit = '枚'): Material => ({ id: `manual-${++serial}`, name, quantity, unit, source: 'manual', confidence: null })
const doc = (items: Material[], tools: string[], checks: MaterialsDocument['checks'] = []): MaterialsDocument => ({ schemaVersion: 2, revision: 4, items, tools, checks, updatedAt: now, confirmedAt: now })
// テスト専用の作品。templateFixtureは紙2枚・はさみ・確認条件「乾いている」を要求する。
const noCheck = TemplateSchema.parse({ ...templateFixture, id: 'test-no-check', checks: [] })

describe('体験版とサーバー共通の制作可否判定', () => {
  it('材料・工具・確認条件がそろった作品だけを作れると判定し、人数は条件にしない', () => {
    const result = buildMockCandidates([templateFixture, noCheck], doc([item('紙', 2)], ['はさみ']), now)
    expect(result).toMatchObject({ schemaVersion: 2, materialRevision: 4 })
    expect(result.candidates.map((c) => [c.templateId, c.feasible])).toEqual([['test-no-check', true], ['contract-test', false]])
    expect(result.candidates[1]!.missing[0]?.en).toContain(templateFixture.checks[0]!.label.en)
  })

  it('確認条件は明示的にtrueと答えたときだけ満たす', () => {
    const answer = (confirmed: boolean | null) => buildMockCandidates([templateFixture], doc([item('紙', 2)], ['はさみ'], [{ id: 'dry', confirmed }]), now).candidates[0]!.feasible
    expect(answer(true)).toBe(true)
    expect(answer(false)).toBe(false)
    expect(answer(null)).toBe(false)
  })

  it('足りない材料・工具を日英で示す', () => {
    const result = buildMockCandidates([noCheck], doc([item('紙', 0.5)], []), now)
    expect(result.candidates[0]!.missing).toEqual([
      { ja: '紙が不足しています（必要: 2枚）', en: 'Insufficient Paper (need 2 sheets)' },
      { ja: '工具「はさみ」が必要です', en: 'Tool needed: はさみ' },
    ])
  })

  it('英語で入力した材料・工具名も同じものとして数える', () => {
    expect(buildMockCandidates([noCheck], doc([item('paper', 2, 'sheets')], ['Scissors']), now).candidates[0]!.feasible).toBe(true)
  })

  it('同名でも異なる単位の数量は合算しない', () => {
    expect(buildMockCandidates([noCheck], doc([item('紙', 100, 'g')], ['はさみ']), now).candidates[0]!.feasible).toBe(false)
  })

  it('作品がなければ候補0件にする', () => {
    expect(buildMockCandidates([], doc([item('紙', 2)], ['はさみ']), now).candidates).toEqual([])
  })
})

describe('体験版の候補の生成と購読（#13）', () => {
  beforeEach(() => localStorage.clear())
  async function confirmedCraft(items: Material[], tools: string[]) {
    const craft = await createMockCraftGateway(localStorage, 'owner').createCraft({ requestId: id(), locale: 'ja' })
    const materials = createMockMaterialsGateway(localStorage, 'owner', [noCheck])
    await materials.editMaterials({ requestId: id(), craftId: craft.craft.id, expectedRevision: 0, items, tools })
    await materials.confirmMaterials({ requestId: id(), craftId: craft.craft.id, expectedRevision: 1 })
    return { craftId: craft.craft.id, materials }
  }
  const latest = (craftId: string, uid = 'owner') => new Promise<CandidatesDocument | null>((resolve, reject) => {
    const stop = createMockProjectsGateway(localStorage, uid, [noCheck]).subscribeToCandidates(craftId, (document) => { stop(); resolve(document) }, (error) => { stop(); reject(error) })
  })

  it('材料を確定すると、確定した版の候補を本人が購読できる', async () => {
    const { craftId } = await confirmedCraft([item('紙', 2)], ['はさみ'])
    expect(readMockCandidates(localStorage, craftId)).toMatchObject({ materialRevision: 1, candidates: [{ templateId: 'test-no-check', feasible: true }] })
    expect((await latest(craftId))?.materialRevision).toBe(1)
  })

  it('別のUIDからは候補を読めない', async () => {
    const { craftId } = await confirmedCraft([item('紙', 2)], ['はさみ'])
    await expect(latest(craftId, 'someone-else')).rejects.toEqual(new GatewayError('NOT_CRAFT_OWNER'))
  })

  it('材料を修正すると古い候補を無効にする', async () => {
    const { craftId, materials } = await confirmedCraft([item('紙', 2)], ['はさみ'])
    await materials.editMaterials({ requestId: id(), craftId, expectedRevision: 1, items: [item('紙', 3)], tools: ['はさみ'] })
    expect(readMockCandidates(localStorage, craftId)).toBeNull()
    expect(await latest(craftId)).toBeNull()
  })

  it('材料変更時に確認回答を無効にし、同じ材料への再回答後だけ候補を合格にする', async () => {
    const craft = await createMockCraftGateway(localStorage, 'owner').createCraft({ requestId: id(), locale: 'ja' })
    const craftId = craft.craft.id
    const materials = createMockMaterialsGateway(localStorage, 'owner', [templateFixture])
    const input = { craftId, items: [item('紙', 2)], tools: ['はさみ'], checks: [{ id: 'dry', confirmed: true }] }
    await materials.editMaterials({ ...input, requestId: id(), expectedRevision: 0 })
    await materials.confirmMaterials({ requestId: id(), craftId, expectedRevision: 1 })
    expect(readMockCandidates(localStorage, craftId)?.candidates[0]?.feasible).toBe(false)
    await materials.editMaterials({ ...input, requestId: id(), expectedRevision: 1 })
    await materials.confirmMaterials({ requestId: id(), craftId, expectedRevision: 2 })
    expect(readMockCandidates(localStorage, craftId)?.candidates[0]?.feasible).toBe(true)
    await materials.editMaterials({ ...input, items: [item('紙', 3)], requestId: id(), expectedRevision: 2 })
    await materials.confirmMaterials({ requestId: id(), craftId, expectedRevision: 3 })
    expect(readMockCandidates(localStorage, craftId)?.candidates[0]?.feasible).toBe(false)
    await expect(materials.editMaterials({ ...input, requestId: id(), expectedRevision: 3, checks: [{ id: 'unknown', confirmed: true }] })).rejects.toMatchObject({ reason: 'VALIDATION_FAILED' })
  })
})
