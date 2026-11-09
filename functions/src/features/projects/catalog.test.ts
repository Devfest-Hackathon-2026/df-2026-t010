import { describe, expect, it } from 'vitest'
import { templateFixture } from '@rekt/shared'
import { parseProjectCatalog, ProjectStateSchema } from './catalog'
describe('v2のカタログ版と候補の証明', () => {
  it('空を許可し、順序に依存しないカタログ版を与える', () => {
    expect(parseProjectCatalog([]).templates).toEqual([])
    const other = { ...templateFixture, id: 'other' }
    expect(parseProjectCatalog([templateFixture, other]).revision).toBe(parseProjectCatalog([other, templateFixture]).revision)
    expect(parseProjectCatalog([templateFixture]).revision).not.toBe(parseProjectCatalog([{ ...templateFixture, estimatedMinutes: 11 }]).revision)
  })
  it('不正なカタログと、旧形式/未確定の証明を受け付けない', () => {
    expect(() => parseProjectCatalog([{ ...templateFixture, verified: false }])).toThrow('CANDIDATES_NOT_READY')
    const state = { schemaVersion: 2, materialRevision: 1, catalogRevision: parseProjectCatalog([templateFixture]).revision, confirmed: true }
    expect(ProjectStateSchema.safeParse(state).success).toBe(true)
    expect(ProjectStateSchema.safeParse({ ...state, schemaVersion: 1 }).success).toBe(false)
    expect(ProjectStateSchema.safeParse({ ...state, confirmed: undefined }).success).toBe(false)
  })
})
