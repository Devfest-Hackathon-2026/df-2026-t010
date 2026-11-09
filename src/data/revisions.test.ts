import { describe, expect, it } from 'vitest'
import { productionSnapshots } from '@rekt/shared'
import { latestSnapshot } from '../app/CraftContext'
import { latestProduction } from './revisions'

const { started, firstStepCompleted, allStepsCompleted } = productionSnapshots
describe('古いrevisionの排除（#17）', () => {
  it('遅れて届いた応答や購読で、新しい進捗を巻き戻さない', () => {
    expect(latestProduction(allStepsCompleted.production, firstStepCompleted.production)).toBe(allStepsCompleted.production)
    expect(latestProduction(started.production, firstStepCompleted.production)).toBe(firstStepCompleted.production)
    expect(latestProduction(null, started.production)).toBe(started.production)
    expect(latestProduction(firstStepCompleted.production, null)).toBe(firstStepCompleted.production)
  })
  it('同じ版は手元のものを維持する', () => {
    expect(latestProduction(started.production, { ...started.production })).toBe(started.production)
  })
  it('制作開始の工程は同じ版の制作状態だけで置き換えない', () => {
    const withoutSteps = { schemaVersion: started.schemaVersion, craft: started.craft }
    expect(latestSnapshot(withoutSteps, started)).toBe(started)
    expect(latestSnapshot(started, withoutSteps)).toBe(started)
    expect(latestSnapshot(firstStepCompleted, started)).toBe(firstStepCompleted)
  })
})
