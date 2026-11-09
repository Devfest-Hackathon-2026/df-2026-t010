import { describe, expect, it } from 'vitest'
import { MaterialRecognitionResponseSchema, RecognizeMaterialsInputSchema } from './material-recognition'
import { materialRecognitionResponseFixtures } from './material-recognition-fixtures'

const input = { requestId: '00000000-0000-4000-8000-000000000001', craftId: 'craft', expectedCraftRevision: 2, imagePath: 'crafts/craft/materials/photo.png', imageGeneration: '1234567890123456', locale: 'ja' }
describe('材料認識の境界', () => {
  it('FE用の正常・空候補・不正出力・タイムアウトfixtureが契約に従う', () => {
    for (const response of Object.values(materialRecognitionResponseFixtures)) expect(MaterialRecognitionResponseSchema.safeParse(response).success).toBe(true)
  })
  it('URL・他ルーム・不正な世代・権限指定を受理しない', () => {
    expect(RecognizeMaterialsInputSchema.safeParse(input).success).toBe(true)
    for (const value of [{ ...input, imagePath: 'https://example.com/photo.png' }, { ...input, craftId: 'another-craft' }, { ...input, imageGeneration: '1.5' }, { ...input, role: 'host' }, { ...input, imagePath: 'crafts/craft/materials/../secret.png' }]) expect(RecognizeMaterialsInputSchema.safeParse(value).success).toBe(false)
  })
  it('成功でも人間による確認を省略できず、失敗は理由だけを返す', () => {
    const base = { schemaVersion: 2, requestId: input.requestId, craftId: input.craftId, craftRevision: 2, imagePath: input.imagePath, imageGeneration: input.imageGeneration, engine: 'fixture', promptVersion: 'materials-v1', requiresConfirmation: true }
    expect(MaterialRecognitionResponseSchema.safeParse({ ...base, status: 'succeeded', result: { items: [], warnings: [] } }).success).toBe(true)
    expect(MaterialRecognitionResponseSchema.safeParse({ ...base, requiresConfirmation: false, status: 'succeeded', result: { items: [], warnings: [] } }).success).toBe(false)
    expect(MaterialRecognitionResponseSchema.safeParse({ ...base, status: 'failed', reason: 'AI_TIMEOUT' }).success).toBe(true)
    expect(MaterialRecognitionResponseSchema.safeParse({ ...base, status: 'failed', reason: 'AI_TIMEOUT', providerBody: 'secret' }).success).toBe(false)
  })
})
