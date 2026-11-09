import { describe, expect, it } from 'vitest'
import { checkPhotoFile, fitWithin, MAX_SOURCE_BYTES, PhotoError } from './preparePhoto'

describe('材料写真の下ごしらえ（#9）', () => {
  it('長い辺を1600pxに収め、小さい写真は拡大しない', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })
  it('画像以外と大きすぎるファイルを断る', () => {
    expect(() => checkPhotoFile(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toThrow(PhotoError)
    const big = { type: 'image/jpeg', size: MAX_SOURCE_BYTES + 1 } as File
    expect(() => checkPhotoFile(big)).toThrow(expect.objectContaining({ problem: 'tooLarge' }) as Error)
    expect(() => checkPhotoFile(new File(['x'], 'a.heic', { type: 'image/heic' }))).not.toThrow()
    expect(() => checkPhotoFile(new File(['x'], 'a.jpg'))).not.toThrow()
  })
})
