import { z } from 'zod'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { onCall } from 'firebase-functions/v2/https'
import { CRAFT_HISTORY_STATUSES, CompletionDocumentSchema, CompletionPhotoPathSchema, craftDocumentToSnapshot, GalleryActionInputSchema, GalleryPostSchema, ProductionDocumentSchema, PublishCraftInputSchema, GALLERY_PAGE_SIZE, GetGalleryPostInputSchema, ListGalleryPageInputSchema } from '@rekt/shared'
import { requireCraftOwner, requireUserId } from '../../lib/auth'
import { database, readCraft, toWire } from '../../lib/database'
import { fail, parseInput } from '../../lib/errors'
import { consumeOperationLimit, operationRecord, receiptCraftId } from '../../lib/operation'
import { getGalleryPhotoUrl } from './photo'

const StoredPostSchema = GalleryPostSchema.omit({ photoUrl: true, likes: true, liked: true, bookmarked: true }).extend({
  ownerUid: z.string(), photoPath: CompletionPhotoPathSchema.nullable(), likedBy: z.array(z.string()).max(500), bookmarkedBy: z.array(z.string()).max(500),
})
function activePost(raw: unknown) {
  if (raw === undefined) fail('CRAFT_NOT_FOUND')
  const post = StoredPostSchema.parse(raw)
  if (Date.parse(post.deleteAfter) <= Date.now()) fail('CRAFT_NOT_FOUND')
  return post
}

function publishableCompletion(craftId: string, uid: string, craftData: unknown, completionData: unknown) {
  if (craftData === undefined) fail('CRAFT_NOT_FOUND')
  const craft = readCraft(craftId, craftData)
  requireCraftOwner(craft, uid)
  if (craft.status !== 'completed') fail('INVALID_CRAFT_STATE')
  const completion = CompletionDocumentSchema.parse(toWire(completionData))
  if (Date.parse(completion.deleteAfter) <= Date.now()) fail('CRAFT_NOT_FOUND')
  if (completion.photoPath && !completion.photoPath.startsWith(`crafts/${craftId}/completion/`)) fail('INVALID_IMAGE')
  return completion
}
async function publicPost(raw: unknown, uid: string) {
  const saved = StoredPostSchema.parse(raw)
  const photoUrl = saved.photoPath?.startsWith(`crafts/${saved.id}/completion/`) ? await getGalleryPhotoUrl(saved.photoPath, saved.deleteAfter) : null
  return GalleryPostSchema.parse({ id: saved.id, title: saved.title, author: saved.author, caption: saved.caption, visual: saved.visual,
    createdAt: saved.createdAt, deleteAfter: saved.deleteAfter, comments: saved.comments,
    photoUrl, likes: saved.likedBy.length, liked: saved.likedBy.includes(uid), bookmarked: saved.bookmarkedBy.includes(uid),
  })
}
export const listGallery = onCall({ region: 'asia-northeast1', timeoutSeconds: 30 }, async (request) => {
  const uid = requireUserId(request.auth)
  await consumeOperationLimit(uid, 'listGallery', 30)
  // Expired posts never appear even before the scheduled craft cleanup runs.
  const posts = await database.collection('galleryPosts').where('deleteAfter', '>', new Date().toISOString()).orderBy('deleteAfter', 'desc').limit(20).get()
  return Promise.all(posts.docs.map((post) => publicPost(post.data(), uid)))
})
export const getGalleryPost = onCall({ region: 'asia-northeast1', timeoutSeconds: 30 }, async (request) => {
  const uid = requireUserId(request.auth)
  const input = parseInput(GetGalleryPostInputSchema, request.data)
  await consumeOperationLimit(uid, 'listGallery', 30)
  const document = await database.doc(`galleryPosts/${input.postId}`).get()
  if (!document.exists) return null
  const saved = StoredPostSchema.parse(document.data())
  if (Date.parse(saved.deleteAfter) <= Date.now()) return null
  return publicPost(saved, uid)
})
export const listGalleryPage = onCall({ region: 'asia-northeast1', timeoutSeconds: 30 }, async (request) => {
  const uid = requireUserId(request.auth)
  const input = parseInput(ListGalleryPageInputSchema, request.data)
  await consumeOperationLimit(uid, 'listGallery', 30)
  let query = database.collection('galleryPosts').where('deleteAfter', '>', new Date().toISOString())
  if (input.savedOnly) query = query.where('bookmarkedBy', 'array-contains', uid)
  query = query.orderBy('deleteAfter', 'desc').orderBy(FieldPath.documentId(), 'desc')
  if (input.cursor) query = query.startAfter(input.cursor.deleteAfter, input.cursor.id)
  const result = await query.limit(GALLERY_PAGE_SIZE + 1).get()
  const page = result.docs.slice(0, GALLERY_PAGE_SIZE)
  const last = page.at(-1)
  return {
    posts: await Promise.all(page.map((post) => publicPost(post.data(), uid))),
    nextCursor: result.size > GALLERY_PAGE_SIZE && last ? { deleteAfter: last.data().deleteAfter as string, id: last.id } : null,
  }
})
export const publishCraft = onCall({ region: 'asia-northeast1', timeoutSeconds: 30 }, async (request) => {
  const uid = requireUserId(request.auth); const input = parseInput(PublishCraftInputSchema, request.data)
  const root = database.doc(`crafts/${input.craftId}`)
  const postRef = database.doc(`galleryPosts/${input.craftId}`)
  const completionRef = root.collection('workshop').doc('completion')
  const existing = await postRef.get()
  if (existing.get('ownerUid') === uid) {
    // Publication is idempotent per craft, including posts made before this check.
    const [craft, completion] = await database.getAll(root, completionRef)
    publishableCompletion(input.craftId, uid, craft?.data(), completion?.data())
    return publicPost(activePost(existing.data()), uid)
  }
  await consumeOperationLimit(uid, 'publishCraft', 10)
  const result = await database.runTransaction(async (tx) => {
    const [craftDoc, productionDoc, completionDoc, postDoc] = await tx.getAll(root, root.collection('workshop').doc('production'), completionRef, postRef)
    const completion = publishableCompletion(input.craftId, uid, craftDoc?.data(), completionDoc?.data())
    if (postDoc?.exists) return activePost(postDoc.data())
    const production = ProductionDocumentSchema.parse(toWire(productionDoc?.data()))
    const post = StoredPostSchema.parse({ id: input.craftId, ownerUid: uid, title: production.template.title, visual: production.template.visual ?? 'art', author: input.author, caption: input.caption, photoPath: completion.photoPath, createdAt: completion.completedAt, deleteAfter: completion.deleteAfter, likedBy: [], bookmarkedBy: [], comments: [] })
    tx.create(postRef, post)
    return post
  })
  return publicPost(result, uid)
})
export const galleryAction = onCall({ region: 'asia-northeast1', timeoutSeconds: 30 }, async (request) => {
  const uid = requireUserId(request.auth); const input = parseInput(GalleryActionInputSchema, request.data)
  const { receiptRef, inputHash } = operationRecord(uid, 'galleryAction', input)
  const postRef = database.doc(`galleryPosts/${input.postId}`)
  if (receiptCraftId(await receiptRef.get(), inputHash) !== undefined) {
    return publicPost(activePost((await postRef.get()).data()), uid)
  }
  await consumeOperationLimit(uid, 'galleryAction', 60)
  const result = await database.runTransaction(async (tx) => {
    const [postDoc, receipt] = await tx.getAll(postRef, receiptRef)
    const post = activePost(postDoc?.data())
    if (receipt && receiptCraftId(receipt, inputHash) !== undefined) return post
    if (input.action === 'comment') {
      if (post.comments.length >= 50) fail('RATE_LIMITED')
      post.comments.push({ id: input.requestId, author: input.author!, text: input.text!, createdAt: new Date().toISOString() })
    } else {
      const values = input.action === 'like' ? post.likedBy : post.bookmarkedBy
      if (input.active && !values.includes(uid)) { if (values.length >= 500) fail('RATE_LIMITED'); values.push(uid) }
      if (!input.active && values.includes(uid)) values.splice(values.indexOf(uid), 1)
    }
    tx.set(postRef, post); tx.create(receiptRef, { inputHash, craftId: post.id, createdAt: Timestamp.now() })
    return post
  })
  return publicPost(result, uid)
})
export const listMyCrafts = onCall({ region: 'asia-northeast1', timeoutSeconds: 30 }, async (request) => {
  const uid = requireUserId(request.auth)
  await consumeOperationLimit(uid, 'listMyCrafts', 30)
  const documents = await database.collection('crafts').where('ownerUid', '==', uid).where('status', 'in', CRAFT_HISTORY_STATUSES).limit(100).get()
  if (documents.empty) return []
  const productions = await database.getAll(...documents.docs.map((doc) => doc.ref.collection('workshop').doc('production')))
  return documents.docs.map((doc, index) => {
    const craft = readCraft(doc.id, doc.data())
    const production = ProductionDocumentSchema.safeParse(toWire(productions[index]?.data()))
    return { snapshot: craftDocumentToSnapshot(doc.id, craft), title: production.success ? production.data.template.title : null, visual: production.success ? production.data.template.visual ?? 'art' : 'art' }
  })
})
