import { describe, expect, it } from 'vitest'
import { completionDeleteAfter, COMPLETION_RETENTION_MS } from './completion-retention'
import { CompletionSnapshotSchema, createCompletionDocument } from './completion'
import { completionSnapshots } from './completion-fixtures'
import { CompleteCraftInputSchema, CompletionDocumentSchema } from './workshop'
import { productionSnapshots } from './production-fixtures'

describe('完成記録と7日保存の契約', () => {
  it('UTCで168時間後を求め、月末/年末/うるう年をまたげる', () => {
    expect(completionDeleteAfter('2026-12-28T17:30:00.000Z')).toBe('2027-01-04T17:30:00.000Z')
    expect(completionDeleteAfter('2028-02-26T09:00:00.000Z')).toBe('2028-03-04T09:00:00.000Z')
    expect(COMPLETION_RETENTION_MS).toBe(604800000)
    expect(() => completionDeleteAfter('not-a-date')).toThrow()
  })
  it('写真なし/写真ありの完成を同じ契約で返す', () => {
    expect(completionSnapshots.withoutPhoto).toMatchObject({ schemaVersion: 2, craft: { status: 'completed', completedAt: '2026-11-06T00:02:00.000Z' }, completion: { photoPath: null, deleteAfter: '2026-11-13T00:02:00.000Z' } })
    expect(CompletionSnapshotSchema.safeParse(completionSnapshots.withPhoto).success).toBe(true)
  })
  it('削除予定の欠落/7日以外/未知フィールドを拒否する', () => {
    const completion = createCompletionDocument('2026-11-06T00:00:00.000Z', null)
    for (const patch of [{ deleteAfter: undefined }, { deleteAfter: completion.completedAt }, { deleteAfter: '2026-11-13T00:01:00.000Z' }, { ownerUid: 'forged' }, { schemaVersion: 1 }]) expect(CompletionDocumentSchema.safeParse({ ...completion, ...patch }).success).toBe(false)
  })
  it('未完了/完成時刻の不一致/別制作の写真を含む応答を拒否する', () => {
    const current = completionSnapshots.withoutPhoto
    expect(CompletionSnapshotSchema.safeParse({ ...current, production: productionSnapshots.started.production }).success).toBe(false)
    expect(CompletionSnapshotSchema.safeParse({ ...current, craft: { ...current.craft, status: 'crafting', completedAt: null } }).success).toBe(false)
    expect(CompletionSnapshotSchema.safeParse({ ...current, craft: { ...current.craft, completedAt: '2026-11-06T01:00:00.000Z' } }).success).toBe(false)
    expect(CompletionSnapshotSchema.safeParse({ ...current, completion: { ...current.completion, photoPath: 'crafts/other/completion/a.jpg' } }).success).toBe(false)
  })
  it('写真パス以外の所有者/完成日時/削除予定を入力できない', () => {
    const input = { requestId: '00000000-0000-4000-8000-000000000001', craftId: 'mine', photoPath: null }
    expect(CompleteCraftInputSchema.safeParse(input).success).toBe(true)
    for (const patch of [{ ownerUid: 'other' }, { completedAt: '2026-11-06T00:00:00.000Z' }, { deleteAfter: '2026-11-13T00:00:00.000Z' }]) expect(CompleteCraftInputSchema.safeParse({ ...input, ...patch }).success).toBe(false)
    for (const photoPath of ['https://example.com/a.jpg', 'crafts/other/completion/a.jpg', 'crafts/mine/materials/a.jpg', `crafts/mine/completion/${'a'.repeat(129)}.jpg`]) expect(CompleteCraftInputSchema.safeParse({ ...input, photoPath }).success).toBe(false)
  })
})
