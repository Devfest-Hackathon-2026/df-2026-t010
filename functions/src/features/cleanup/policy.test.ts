import { describe, expect, it } from 'vitest'
import { completionSnapshots, COMPLETION_RETENTION_MS, craftFixture, unfinishedDeleteAfter } from '@rekt/shared'
import { isExpiredCompletion, isExpiredUnfinished } from './policy'

const snapshot = completionSnapshots.withPhoto
const { id, ...fields } = snapshot.craft
const root = { schemaVersion: 2, ...fields }
const due = Date.parse(snapshot.completion.deleteAfter)

describe('completed craft deletion eligibility', () => {
  it('keeps the craft until the exact server deadline, including the last millisecond', () => {
    expect(isExpiredCompletion(id, root, snapshot.completion, due - 1)).toBe(false)
    expect(isExpiredCompletion(id, root, snapshot.completion, due)).toBe(true)
    expect(isExpiredCompletion(id, root, snapshot.completion, due + 1)).toBe(true)
  })
  it('uses the same seven days without a photo', () => {
    expect(isExpiredCompletion(id, root, completionSnapshots.withoutPhoto.completion, due)).toBe(true)
    expect(due - Date.parse(root.completedAt!)).toBe(COMPLETION_RETENTION_MS)
  })
  it('refuses unfinished, legacy, missing and malformed records', () => {
    for (const saved of [undefined, { ...root, schemaVersion: 1 }, { ...root, ownerUid: '' }, { ...root, status: 'crafting', completedAt: null }]) expect(isExpiredCompletion(id, saved, snapshot.completion, due)).toBe(false)
    for (const saved of [undefined, { ...snapshot.completion, schemaVersion: 1 }, { ...snapshot.completion, deleteAfter: new Date(due - 1).toISOString() }, { ...snapshot.completion, extra: true }]) expect(isExpiredCompletion(id, root, saved, due)).toBe(false)
  })
  it('refuses mismatched completion timestamps and foreign photo references', () => {
    expect(isExpiredCompletion(id, { ...root, completedAt: new Date(Date.parse(root.completedAt!) - 1).toISOString() }, snapshot.completion, due)).toBe(false)
    expect(isExpiredCompletion('other-craft', root, snapshot.completion, due)).toBe(false)
    expect(isExpiredCompletion('../other', root, snapshot.completion, due)).toBe(false)
    expect(isExpiredCompletion(id, root, snapshot.completion, NaN)).toBe(false)
    expect(isExpiredCompletion(id, { ...root, createdAt: snapshot.completion.deleteAfter }, snapshot.completion, due)).toBe(false)
  })
  it('expires unfinished work at seven days after its most recent persisted update', () => {
    const { id: craftId, ...craft } = craftFixture().craft
    const unfinished = { schemaVersion: 2, ...craft }
    const deadline = Date.parse(unfinishedDeleteAfter(craft.updatedAt))
    expect(isExpiredUnfinished(craftId, unfinished, deadline - 1)).toBe(false)
    expect(isExpiredUnfinished(craftId, unfinished, deadline)).toBe(true)
    expect(isExpiredUnfinished(craftId, { ...unfinished, updatedAt: new Date(deadline).toISOString() }, deadline)).toBe(false)
    expect(isExpiredUnfinished(id, root, due)).toBe(false)
    expect(isExpiredUnfinished(craftId, { ...unfinished, createdAt: new Date(deadline).toISOString() }, deadline)).toBe(false)
  })
  it('computes an unfinished deadline across a year boundary and rejects invalid dates', () => {
    expect(unfinishedDeleteAfter('2026-12-29T23:59:59.999Z')).toBe('2027-01-05T23:59:59.999Z')
    expect(() => unfinishedDeleteAfter('invalid')).toThrow()
  })
})
