import { describe, expect, it } from 'vitest'
import { MAX_MATERIAL_IMAGE_BYTES } from '@rekt/shared'
import { validateMaterialImage } from './image'
import { parseMaterialCandidates } from './output'
import { materialRecognitionFixtures } from './fixtures'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=', 'base64')
describe('材料画像と候補', () => {
  it('JPEG/PNG/WebP以外、MIME不一致・空・過大・破損ヘッダーを拒否する', () => {
    expect(validateMaterialImage(png, 'image/png').mimeType).toBe('image/png')
    for (const [bytes, type] of [[png, 'image/svg+xml'], [png, 'image/jpeg'], [Buffer.alloc(0), 'image/png'], [Buffer.alloc(MAX_MATERIAL_IMAGE_BYTES + 1), 'image/png'], [png.subarray(0, 8), 'image/png'], [Buffer.from('not an image'), 'image/webp']] as const) expect(() => validateMaterialImage(bytes, type)).toThrow(expect.objectContaining({ reason: 'INVALID_IMAGE' }))
  })
  it('IDとsourceはサーバーが付与し、人間が編集できる候補を返す', () => {
    const result = parseMaterialCandidates(materialRecognitionFixtures.ja, '00000000-0000-4000-8000-000000000001')
    expect(result.items[0]).toMatchObject({ id: 'ai-00000000-0000-4000-8000-000000000001-1', source: 'ai', name: '段ボール', quantity: 2, confidence: 0.82 })
    expect(parseMaterialCandidates(materialRecognitionFixtures.empty, 'operation').items).toEqual([])
  })
  it('不完全な出力・負の数量・権限の混入を共通エラーへ変換する', () => {
    for (const value of [null, materialRecognitionFixtures.malformed, { items: [{ name: 'Paper' }], warnings: [] }, { ...materialRecognitionFixtures.ja, hostUid: 'attacker' }]) expect(() => parseMaterialCandidates(value, 'operation')).toThrow(expect.objectContaining({ reason: 'AI_RESPONSE_INVALID' }))
  })
})
