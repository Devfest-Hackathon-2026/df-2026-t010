import { describe, expect, it } from 'vitest'
import { craftFixture } from '@rekt/shared'
import { latestSnapshot } from './CraftContext'
it('遅い応答で新しい制作の購読結果を巻き戻さない', () => {
  const old = craftFixture()
  const recent = { ...old, craft: { ...old.craft, revision: 1 } }
  expect(latestSnapshot(recent, old)).toBe(recent)
  expect(latestSnapshot(old, recent)).toBe(recent)
})
describe('別の制作への移動', () => {
  it('別IDの制作を以前の大きいrevisionで隠さない', () => {
    const old = craftFixture()
    const next = { ...old, craft: { ...old.craft, id: 'next' } }
    expect(latestSnapshot({ ...old, craft: { ...old.craft, revision: 99 } }, next)).toBe(next)
  })
})
