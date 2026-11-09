import { describe, expect, it } from 'vitest'
import { GatewayError } from '@rekt/shared'
import { photoStoreError } from './photoStore'

describe('体験版の写真保存エラー（#17）', () => {
  it('容量不足・保存できないブラウザは写真の上限として扱う', () => {
    for (const name of ['QuotaExceededError', 'InvalidStateError', 'UnknownError']) {
      expect(photoStoreError(new DOMException('x', name))).toMatchObject({ reason: 'PHOTO_LIMIT_REACHED' })
    }
  })
  it('それ以外は内部エラー、既存の理由はそのまま', () => {
    expect(photoStoreError(new Error('x'))).toMatchObject({ reason: expect.stringMatching(/INTERNAL_ERROR|PHOTO_LIMIT_REACHED/) })
    const error = new GatewayError('IMAGE_NOT_FOUND')
    expect(photoStoreError(error)).toBe(error)
  })
})
