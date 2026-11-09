import { describe, expect, it } from 'vitest'
import { buildProjectCandidates, VerifiedTemplateCatalogSchema } from './project-candidates'
import { materialsFixture as inventory, templateFixture as template } from './fixtures'

const at = inventory.updatedAt
const checked = { ...inventory, checks: [{ id: 'dry', confirmed: true }] }
const build = (items = inventory.items, tools = inventory.tools) => buildProjectCandidates([template], { ...checked, items, tools }, at).candidates[0]!
describe('単独制作の決定的な候補判定', () => {
  it('日英の名前/単位と工具を照合し、本人だけで制作可能になる', () => {
    expect(build([{ ...inventory.items[0]!, id: 'another-id', name: ' ＰＡＰＥＲ ', unit: 'sheet' }], ['Scissors']).feasible).toBe(true)
    expect(build().feasible).toBe(true)
  })
  it('異なる単位、部分一致、数量不足、工具不足を通さない', () => {
    for (const patch of [{ unit: 'cm' }, { name: '紙コップ' }, { quantity: 1.9999999999999998 }]) expect(build([{ ...inventory.items[0]!, ...patch }]).feasible).toBe(false)
    expect(build(inventory.items, []).feasible).toBe(false)
    expect(build(inventory.items, ['子供用はさみ']).feasible).toBe(false)
  })
  it('具体的な工具の種類を一般名で代用しない', () => {
    const glue = { ...template, tools: ['glue stick'] }
    expect(buildProjectCandidates([glue], { ...checked, tools: ['のり'] }, at).candidates[0]?.feasible).toBe(false)
    expect(buildProjectCandidates([glue], { ...checked, tools: ['スティックのり'] }, at).candidates[0]?.feasible).toBe(true)
  })
  it('同じ名前と単位の複数行だけを正確に合計する', () => {
    const calculate = (amounts: number[]) => buildProjectCandidates([{ ...template, materials: [{ ...template.materials[0]!, quantity: 0.8 }] }], { ...checked, items: amounts.map((quantity, i) => ({ ...inventory.items[0]!, id: `r-${i}`, quantity })) }, at).candidates[0]?.feasible
    expect(calculate([0.1, 0.7])).toBe(true)
    expect(calculate([0.7999999999999999])).toBe(false)
    expect(calculate([1e-30])).toBe(false)
    expect(build([{ ...inventory.items[0]!, quantity: 1 }, { ...inventory.items[0]!, id: 'g', unit: 'g', quantity: 1000 }]).feasible).toBe(false)
  })
  it('対象条件への明示trueだけを合格とし、未回答・false・null・別IDを通さない', () => {
    for (const checks of [[], [{ id: 'dry', confirmed: false }], [{ id: 'dry', confirmed: null }], [{ id: 'different', confirmed: true }]]) {
      const result = buildProjectCandidates([template], { ...inventory, checks }, at).candidates[0]!
      expect(result.feasible).toBe(false)
      expect(result.missing[0]?.en).toContain('Is the material dry?')
    }
  })
  it('空カタログは候補0件を返す', () => {
    expect(buildProjectCandidates([], checked, at)).toMatchObject({ schemaVersion: 2, materialRevision: 1, candidates: [] })
  })
  it('未検証/旧形式/重複/21作品以上/在庫を二重計上する要件を拒否する', () => {
    for (const catalog of [[{ ...template, verified: false }], [{ ...template, minMembers: 2 }], [template, template], Array.from({ length: 21 }, (_, i) => ({ ...template, id: `t-${i}` })), [{ ...template, materials: [...template.materials, { ...template.materials[0]!, materialId: 'alias' }] }]]) expect(VerifiedTemplateCatalogSchema.safeParse(catalog).success).toBe(false)
  })
  it('同じ条件IDで異なる質問を使うカタログを拒否する', () => {
    const other = { ...template, id: 'other', checks: [{ id: 'dry', label: { ja: '別の条件', en: 'A different condition' } }] }
    expect(VerifiedTemplateCatalogSchema.safeParse([template, other]).success).toBe(false)
    expect(VerifiedTemplateCatalogSchema.safeParse([template, { ...template, id: 'same-check' }]).success).toBe(true)
  })
  it('最大の不足件数でも全条件を判定し、表示を50件以内へまとめる', () => {
    const large = { ...template,
      materials: Array.from({ length: 50 }, (_, i) => ({ ...template.materials[0]!, materialId: `m-${i}`, name: { ja: `材料${i}`, en: `Material ${i}` } })),
      tools: Array.from({ length: 30 }, (_, i) => `tool-${i}`),
      checks: Array.from({ length: 30 }, (_, i) => ({ id: `c-${i}`, label: { ja: `条件${i}`, en: `Check ${i}` } })),
    }
    const result = buildProjectCandidates([large], { ...inventory, items: [], tools: [], checks: [] }, at).candidates[0]!
    expect(result.feasible).toBe(false)
    expect(result.missing).toHaveLength(50)
    expect(result.missing[49]?.en).toContain('61 additional')
  })
})
