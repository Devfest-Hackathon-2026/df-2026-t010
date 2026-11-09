import { CraftSnapshotSchema } from './crafts'
import { GatewayErrorDetailsSchema } from './errors'
import { CandidatesDocumentSchema, MaterialsDocumentSchema, TemplateSchema, ProductionDocumentSchema } from './workshop'

const at = '2026-11-06T00:00:00.000Z'
export function craftFixture() {
  return CraftSnapshotSchema.parse({ schemaVersion: 2, craft: {
    id: 'fixture-craft', ownerUid: 'fixture-owner', locale: 'ja', status: 'materials', revision: 0,
    selectedTemplateId: null, createdAt: at, updatedAt: at, completedAt: null,
  } })
}
export const materialsFixture = MaterialsDocumentSchema.parse({ schemaVersion: 2, revision: 1,
  items: [{ id: 'manual-paper', name: '紙', quantity: 2, unit: '枚', source: 'manual', confidence: null }],
  tools: ['はさみ'], checks: [], updatedAt: at, confirmedAt: null,
})
// Contract-only fixture; no real photos/physical verification. Never publish it as a work.
const text = { ja: '契約テスト用', en: 'Contract test only' }
export const templateFixture = TemplateSchema.parse({ schemaVersion: 2, id: 'contract-test', verified: true,
  title: text, description: text, estimatedMinutes: 10,
  materials: [{ materialId: 'paper', name: { ja: '紙', en: 'Paper' }, quantity: 2, unit: { ja: '枚', en: 'sheets' } }],
  tools: ['はさみ'], checks: [{ id: 'dry', label: { ja: '材料は乾いていますか', en: 'Is the material dry?' } }],
  steps: ['a', 'b'].map((id) => ({ id, title: text, instructions: text, safety: text, photoPath: `/steps/contract-test/${id}.jpg` })),
})
export const productionFixture = ProductionDocumentSchema.parse({ schemaVersion: 2, revision: 0, template: templateFixture, materialRevision: 1,
  steps: templateFixture.steps.map((step) => ({ stepId: step.id, completedAt: null })), startedAt: at,
})
export const noCandidatesFixture = CandidatesDocumentSchema.parse({ schemaVersion: 2, materialRevision: 1, generatedAt: at, candidates: [] })
export const candidateFixtures = {
  empty: noCandidatesFixture,
  feasible: CandidatesDocumentSchema.parse({ ...noCandidatesFixture, candidates: [{ templateId: templateFixture.id, feasible: true, missing: [], reason: { ja: '確認した材料と条件で作れます。', en: 'Confirmed materials and conditions meet the requirements.' } }] }),
  insufficient: CandidatesDocumentSchema.parse({ ...noCandidatesFixture, candidates: [{ templateId: templateFixture.id, feasible: false, missing: [templateFixture.checks[0]!.label], reason: { ja: '必要な条件が未確認です。', en: 'A required condition is not confirmed.' } }] }),
}
export const resumableCraftFixture = CraftSnapshotSchema.parse({ ...craftFixture(), craft: { ...craftFixture().craft, status: 'crafting', revision: 3, selectedTemplateId: templateFixture.id } })
export const errorFixtures = {
  forbidden: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'NOT_CRAFT_OWNER' }),
  stale: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'STALE_REVISION' }),
}
