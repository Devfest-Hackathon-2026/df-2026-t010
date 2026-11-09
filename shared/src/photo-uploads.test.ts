import { describe, expect, it } from 'vitest'
import { PhotoUploadReservationSchema, ReservePhotoUploadInputSchema, photoUploadPath } from './photo-uploads'

const input = { craftId: 'craft', photoId: 'photo', kind: 'materials' as const, contentType: 'image/jpeg' as const, sizeBytes: 4 }
describe('photo reservation contract', () => {
  it('binds the returned path to the craft, kind, photo and MIME', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp'] as const) {
      const value = { ...input, contentType }
      const permit = { ...value, schemaVersion: 2, path: photoUploadPath(value), createdAt: '2026-11-06T00:00:00.000Z' }
      expect(PhotoUploadReservationSchema.parse(permit).path).toBe(photoUploadPath(value))
      expect(PhotoUploadReservationSchema.safeParse({ ...permit, path: 'crafts/other/materials/photo.jpg' }).success).toBe(false)
    }
  })
  it('rejects zero/oversize photos, path injection, unsupported MIME and client authority', () => {
    for (const patch of [{ sizeBytes: 0 }, { sizeBytes: 5 * 1024 * 1024 + 1 }, { photoId: '../other' }, { craftId: 'a/b' }, { contentType: 'text/plain' }, { ownerUid: 'other' }, { createdAt: '2026-11-06T00:00:00.000Z' }]) expect(ReservePhotoUploadInputSchema.safeParse({ ...input, ...patch }).success).toBe(false)
  })
})
