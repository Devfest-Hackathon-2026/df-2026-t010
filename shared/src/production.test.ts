import { describe, expect, it } from 'vitest'
import { createProductionDocument, getProductionProgress, ProductionSnapshotSchema } from './production'
import { productionSnapshots } from './production-fixtures'
import { templateFixture } from './fixtures'
import { CompleteStepInputSchema, StartCraftInputSchema } from './workshop'

describe('本人の制作開始・工程完了の共有契約', () => {
  it('作品全体をコピーし、配列順の全工程を未完了で初期化する', () => {
    const template = structuredClone(templateFixture)
    const result = createProductionDocument(template, 7, '2026-11-06T00:00:00.000Z')
    template.steps[0]!.title.ja = 'Changed after start'
    expect(result).toMatchObject({ schemaVersion: 2, revision: 0, materialRevision: 7, steps: [{ stepId: 'a', completedAt: null }, { stepId: 'b', completedAt: null }] })
    expect(result.template.steps[0]!.title.ja).not.toBe(template.steps[0]!.title.ja)
  })
  it('最初の未完了だけを操作可能にし、次工程と全工程完了を表示できる', () => {
    expect(getProductionProgress(productionSnapshots.started.production)).toEqual({ nextStepId: 'a', allStepsCompleted: false, steps: [{ stepId: 'a', status: 'available' }, { stepId: 'b', status: 'locked' }] })
    expect(getProductionProgress(productionSnapshots.firstStepCompleted.production).steps).toEqual([{ stepId: 'a', status: 'completed' }, { stepId: 'b', status: 'available' }])
    expect(getProductionProgress(productionSnapshots.allStepsCompleted.production)).toMatchObject({ nextStepId: null, allStepsCompleted: true })
    expect(productionSnapshots.allStepsCompleted.craft.status).toBe('crafting')
    expect(productionSnapshots.allStepsCompleted.craft.completedAt).toBeNull()
  })
  it('未開始、固定作品の不一致、未完了なのに完成状態の応答を拒否する', () => {
    const current = productionSnapshots.started
    for (const patch of [{ status: 'materials', selectedTemplateId: null }, { selectedTemplateId: 'another' }, { status: 'completed', completedAt: current.production.startedAt }]) {
      expect(ProductionSnapshotSchema.safeParse({ ...current, craft: { ...current.craft, ...patch } }).success).toBe(false)
    }
    expect(ProductionSnapshotSchema.safeParse({ ...current, schemaVersion: 1 }).success).toBe(false)
  })
  it('完成後の成功再送にも同じ固定作品と全工程の応答を使える', () => {
    const all = productionSnapshots.allStepsCompleted
    expect(ProductionSnapshotSchema.safeParse({ ...all, craft: { ...all.craft, status: 'completed', completedAt: all.craft.updatedAt } }).success).toBe(true)
  })
  it('入力に所有者/割当/工程内容を渡せず、版は非負整数に限る', () => {
    const common = { requestId: '00000000-0000-4000-8000-000000000001', craftId: 'mine' }
    const start = { ...common, templateId: templateFixture.id, materialRevision: 1 }
    const step = { ...common, stepId: 'a', expectedRevision: 0 }
    expect(StartCraftInputSchema.safeParse(start).success).toBe(true)
    expect(CompleteStepInputSchema.safeParse(step).success).toBe(true)
    for (const patch of [{ ownerUid: 'other' }, { template: templateFixture }, { materialRevision: -1 }, { materialRevision: 1.5 }]) expect(StartCraftInputSchema.safeParse({ ...start, ...patch }).success).toBe(false)
    for (const patch of [{ assignedUid: 'other' }, { completedAt: '2026-11-06T00:00:00.000Z' }, { expectedRevision: -1 }, { dependsOn: [] }]) expect(CompleteStepInputSchema.safeParse({ ...step, ...patch }).success).toBe(false)
  })
})
