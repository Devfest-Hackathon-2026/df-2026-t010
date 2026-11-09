import { z } from 'zod'
import { DateTimeSchema, IdSchema } from './common'
import { MaterialImageMimeSchema, MAX_MATERIAL_IMAGE_BYTES } from './material-recognition'

export const PHOTO_LIMITS = {
  materials: 10, completion: 3, craftBytes: 20 * 1024 * 1024,
  uidDailyFiles: 20, uidDailyBytes: 50 * 1024 * 1024,
  projectDailyFiles: 100, projectDailyBytes: 200 * 1024 * 1024,
} as const
export const ReservePhotoUploadInputSchema = z.strictObject({
  craftId: IdSchema, photoId: IdSchema, kind: z.enum(['materials', 'completion']),
  contentType: MaterialImageMimeSchema, sizeBytes: z.int().positive().max(MAX_MATERIAL_IMAGE_BYTES),
})
export type ReservePhotoUploadInput = z.infer<typeof ReservePhotoUploadInputSchema>
export function photoUploadPath(input: Pick<ReservePhotoUploadInput, 'craftId' | 'photoId' | 'kind' | 'contentType'>) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[input.contentType]
  return `crafts/${input.craftId}/${input.kind}/${input.photoId}.${extension}`
}
export const PhotoUploadReservationSchema = ReservePhotoUploadInputSchema.extend({
  schemaVersion: z.literal(2), path: z.string().max(420), createdAt: DateTimeSchema,
}).refine((value) => value.path === photoUploadPath(value), 'Reservation path must match the photo')
export type PhotoUploadReservation = z.infer<typeof PhotoUploadReservationSchema>
