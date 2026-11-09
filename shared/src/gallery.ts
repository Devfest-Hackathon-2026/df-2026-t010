import { z } from 'zod'
import { DateTimeSchema, IdSchema, RequestIdSchema } from './common'
import { CraftSnapshotSchema } from './crafts'
import { LocalizedTextSchema } from './workshop'

export const GalleryCommentSchema = z.strictObject({ id: IdSchema, author: z.string().min(1).max(40), text: z.string().trim().min(1).max(500), createdAt: DateTimeSchema })
export const GalleryPostSchema = z.strictObject({
  id: IdSchema, title: LocalizedTextSchema, author: z.string().min(1).max(40), caption: z.string().max(1000),
  visual: z.enum(['robot', 'car', 'organizer', 'flower', 'art']), photoUrl: z.string().max(8_000_000).nullable(),
  createdAt: DateTimeSchema, deleteAfter: DateTimeSchema, likes: z.int().nonnegative(), liked: z.boolean(), bookmarked: z.boolean(),
  comments: z.array(GalleryCommentSchema).max(50),
})
export const PublishCraftInputSchema = z.strictObject({ craftId: IdSchema, requestId: RequestIdSchema, author: z.string().trim().min(1).max(40), caption: z.string().trim().max(1000) })
export const GalleryActionInputSchema = z.strictObject({ postId: IdSchema, requestId: RequestIdSchema, action: z.enum(['like', 'bookmark', 'comment']), active: z.boolean().optional(), text: z.string().trim().min(1).max(500).optional(), author: z.string().trim().min(1).max(40).optional() })
  .refine((input) => input.action === 'comment' ? !!input.text && !!input.author : typeof input.active === 'boolean', 'Missing action details')
export const CraftHistoryItemSchema = z.strictObject({ snapshot: CraftSnapshotSchema, title: LocalizedTextSchema.nullable(), visual: z.enum(['robot', 'car', 'organizer', 'flower', 'art']) })
export const CRAFT_HISTORY_STATUSES = ['crafting', 'completed'] as const
export type GalleryPost = z.infer<typeof GalleryPostSchema>
export type PublishCraftInput = z.infer<typeof PublishCraftInputSchema>
export type GalleryActionInput = z.infer<typeof GalleryActionInputSchema>
export type CraftHistoryItem = z.infer<typeof CraftHistoryItemSchema>

export const GALLERY_PAGE_SIZE = 20
export const GalleryCursorSchema = z.strictObject({ deleteAfter: DateTimeSchema, id: IdSchema })
export const ListGalleryPageInputSchema = z.strictObject({ savedOnly: z.boolean().default(false), cursor: GalleryCursorSchema.optional() })
export const GetGalleryPostInputSchema = z.strictObject({ postId: IdSchema })
export const GalleryPageSchema = z.strictObject({ posts: z.array(GalleryPostSchema).max(GALLERY_PAGE_SIZE), nextCursor: GalleryCursorSchema.nullable() })
export type GalleryCursor = z.infer<typeof GalleryCursorSchema>
export type ListGalleryPageInput = z.input<typeof ListGalleryPageInputSchema>
export type GalleryPage = z.infer<typeof GalleryPageSchema>

/** Matches the server's deleteAfter DESC, document ID DESC cursor order. */
export function compareGalleryPosition(a: GalleryCursor, b: GalleryCursor) {
  if (a.deleteAfter !== b.deleteAfter) return a.deleteAfter > b.deleteAfter ? -1 : 1
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1
}
