import { z } from 'zod'
import { CRAFT_HISTORY_STATUSES, CompleteCraftInputSchema, CompleteStepInputSchema, CompletionDocumentSchema, CompletionSnapshotSchema, createCompletionDocument, createProductionDocument, evaluateProjectCandidates, GalleryActionInputSchema, GalleryPostSchema, GatewayError, getProductionProgress, ProductionDocumentSchema, ProductionSnapshotSchema, PublishCraftInputSchema, StartCraftInputSchema, GALLERY_PAGE_SIZE, GetGalleryPostInputSchema, ListGalleryPageInputSchema, compareGalleryPosition } from '@rekt/shared'
import type { CraftSnapshot } from '@rekt/shared'
import type { ExperienceGateway } from '../contracts'
import { gatewayError } from '../errors'
import { getMockUserId, listMockCrafts, readMockCraft, writeMockCraft } from './crafts'
import { readMockCandidates } from './candidates'
import { readMockMaterials } from './materials'
import { getMockPhoto, getMockPhotoBlob, putMockPhoto } from './photoStore'

const key = 'co-make:mock-experience:v3'
const event = 'co-make:experience-change'
const StoreSchema = z.object({ production: z.record(z.string(), ProductionDocumentSchema), completion: z.record(z.string(), CompletionDocumentSchema), photos: z.record(z.string(), z.string()), posts: z.record(z.string(), GalleryPostSchema), receipts: z.record(z.string(), z.string()), reactions: z.record(z.string(), z.object({ likes: z.array(z.string()), bookmarks: z.array(z.string()) })).default({}) })
const empty = '{"production":{},"completion":{},"photos":{},"posts":{},"receipts":{}}'
export function createMockExperienceGateway(storage: Storage, uid: string): ExperienceGateway {
  const read = () => StoreSchema.parse(JSON.parse(storage.getItem(key) ?? empty))
  const save = (store: z.infer<typeof StoreSchema>) => { storage.setItem(key, JSON.stringify(store)); window.dispatchEvent(new Event(event)) }
  const owner = (id: string) => {
    const snapshot = readMockCraft(storage, id)
    if (!snapshot) throw new GatewayError('CRAFT_NOT_FOUND')
    if (snapshot.craft.ownerUid !== uid) throw new GatewayError('NOT_CRAFT_OWNER')
    return snapshot
  }
  async function publicPost(post: z.infer<typeof StoreSchema>['posts'][string], store = read()) {
    const path = store.completion[post.id]?.photoPath
    const photoUrl = path && store.photos[path] === 'indexeddb' ? await getMockPhoto(path) : post.photoUrl
    const reactions = store.reactions[post.id]
    return { ...post, photoUrl, ...(reactions ? { likes: reactions.likes.length, liked: reactions.likes.includes(uid), bookmarked: reactions.bookmarks.includes(uid) } : {}) }
  }
  function productionSnapshot(id: string) {
    return ProductionSnapshotSchema.parse({ ...owner(id), production: read().production[id] })
  }
  function receipt(store: z.infer<typeof StoreSchema>, operation: string, input: { requestId: string }) {
    const id = `${uid}:${operation}:${input.requestId}`; const payload = JSON.stringify(input)
    if (store.receipts[id] && store.receipts[id] !== payload) throw new GatewayError('IDEMPOTENCY_CONFLICT')
    return { id, payload, exists: !!store.receipts[id] }
  }
  const update = (snapshot: CraftSnapshot, status: CraftSnapshot['craft']['status'] = snapshot.craft.status): CraftSnapshot => ({ schemaVersion: 2, craft: { ...snapshot.craft, status, revision: snapshot.craft.revision + 1, updatedAt: new Date().toISOString() } })
  return {
    async startCraft(raw) {
      const input = StartCraftInputSchema.parse(raw); const snapshot = owner(input.craftId); const store = read(); const received = receipt(store, 'start', input)
      if (received.exists) return productionSnapshot(input.craftId)
      if (snapshot.craft.status !== 'project_selection') throw new GatewayError('INVALID_CRAFT_STATE')
      const materials = readMockMaterials(storage, input.craftId); const candidates = readMockCandidates(storage, input.craftId)
      if (!materials?.confirmedAt || materials.revision !== input.materialRevision || candidates?.materialRevision !== input.materialRevision) throw new GatewayError('STALE_REVISION')
      const template = candidates.templates?.find((item) => item.id === input.templateId)
      if (!template || !candidates.candidates.some((item) => item.templateId === input.templateId && item.feasible) || !evaluateProjectCandidates([template], materials, new Date().toISOString()).candidates[0]?.feasible) throw new GatewayError('CANDIDATES_NOT_READY')
      store.production[input.craftId] = createProductionDocument(template, input.materialRevision, new Date().toISOString())
      store.receipts[received.id] = received.payload; save(store)
      const next = update(snapshot, 'crafting'); next.craft.selectedTemplateId = template.id; writeMockCraft(storage, next)
      return productionSnapshot(input.craftId)
    },
    async completeStep(raw) {
      const input = CompleteStepInputSchema.parse(raw); const snapshot = productionSnapshot(input.craftId); const store = read(); const received = receipt(store, 'step', input)
      if (received.exists) return snapshot
      const step = snapshot.production.steps.find((item) => item.stepId === input.stepId)
      if (!step) throw new GatewayError('STEP_NOT_FOUND')
      if (input.expectedRevision > snapshot.production.revision) throw new GatewayError('STALE_REVISION')
      if (!step.completedAt) {
        if (snapshot.craft.status !== 'crafting') throw new GatewayError('INVALID_CRAFT_STATE')
        if (input.expectedRevision !== snapshot.production.revision) throw new GatewayError('STALE_REVISION')
        if (getProductionProgress(snapshot.production).nextStepId !== input.stepId) throw new GatewayError('DEPENDENCY_NOT_COMPLETED')
        step.completedAt = new Date().toISOString(); snapshot.production.revision++
        store.production[input.craftId] = snapshot.production
        store.receipts[received.id] = received.payload; save(store); writeMockCraft(storage, update(snapshot))
      } else { store.receipts[received.id] = received.payload; save(store) }
      return productionSnapshot(input.craftId)
    },
    async completeCraft(raw) {
      const input = CompleteCraftInputSchema.parse(raw); const snapshot = productionSnapshot(input.craftId); const store = read(); const received = receipt(store, 'complete', input)
      if (!getProductionProgress(snapshot.production).allStepsCompleted) throw new GatewayError('STEPS_NOT_COMPLETED')
      if (snapshot.craft.status === 'completed') {
        if (!received.exists && store.completion[input.craftId]?.photoPath !== input.photoPath) throw new GatewayError('INVALID_CRAFT_STATE')
        return CompletionSnapshotSchema.parse({ ...snapshot, completion: store.completion[input.craftId] })
      }
      if (input.photoPath && !store.photos[input.photoPath]) throw new GatewayError('IMAGE_NOT_FOUND')
      const completion = createCompletionDocument(new Date().toISOString(), input.photoPath)
      store.completion[input.craftId] = completion; store.receipts[received.id] = received.payload; save(store)
      const next = update(snapshot, 'completed'); next.craft.completedAt = completion.completedAt; writeMockCraft(storage, next)
      return CompletionSnapshotSchema.parse({ ...next, production: snapshot.production, completion })
    },
    subscribeToProduction(craftId, next, error) {
      let active = true
      const notify = () => { if (active) { try { owner(craftId); next(read().production[craftId] ?? null) } catch (cause) { error(gatewayError(cause)) } } }
      window.addEventListener(event, notify); window.addEventListener('storage', notify); queueMicrotask(notify)
      return () => { active = false; window.removeEventListener(event, notify); window.removeEventListener('storage', notify) }
    },
    async getCompletionPhoto(craftId) {
      owner(craftId)
      const completion = read().completion[craftId]
      if (!completion?.photoPath || Date.parse(completion.deleteAfter) <= Date.now()) return null
      if (!completion.photoPath.startsWith(`crafts/${craftId}/completion/`)) throw new GatewayError('INVALID_IMAGE')
      const blob = await getMockPhotoBlob(completion.photoPath)
      if (!blob) throw new GatewayError('IMAGE_NOT_FOUND')
      return blob
    },
    async uploadCompletionPhoto({ craftId, photoId, blob }) {
      const snapshot = productionSnapshot(craftId)
      if (!getProductionProgress(snapshot.production).allStepsCompleted || snapshot.craft.status !== 'crafting') throw new GatewayError('INVALID_CRAFT_STATE')
      if (blob.type !== 'image/jpeg' || blob.size > 5 * 1024 * 1024 || blob.size <= 0 || !/^[A-Za-z0-9_-]{1,128}$/.test(photoId)) throw new GatewayError('INVALID_IMAGE')
      const photoPath = `crafts/${craftId}/completion/${photoId}.jpg`
      await putMockPhoto(photoPath, blob)
      const store = read()
      store.photos[photoPath] = 'indexeddb'
      save(store)
      return { photoPath }
    },
    async listMyCrafts() {
      const store = read()
      return listMockCrafts(storage)
        .filter(({ craft }) => craft.ownerUid === uid && CRAFT_HISTORY_STATUSES.some((status) => status === craft.status))
        .sort((a, b) => b.craft.updatedAt.localeCompare(a.craft.updatedAt))
        .slice(0, 100)
        .map((snapshot) => ({ snapshot, title: store.production[snapshot.craft.id]?.template.title ?? null, visual: store.production[snapshot.craft.id]?.template.visual ?? 'art' }))
    },
    async listGallery() { const store = read(); return Promise.all(Object.values(store.posts).filter((post) => Date.parse(post.deleteAfter) > Date.now()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((post) => publicPost(post, store))) },
    async getGalleryPost(postId) {
      GetGalleryPostInputSchema.parse({ postId })
      const store = read(); const post = store.posts[postId]
      return post && Date.parse(post.deleteAfter) > Date.now() ? publicPost(post, store) : null
    },
    async listGalleryPage(raw) {
      const input = ListGalleryPageInputSchema.parse(raw); const store = read()
      const posts = Object.values(store.posts).filter((post) => Date.parse(post.deleteAfter) > Date.now()
        && (!input.savedOnly || store.reactions[post.id]?.bookmarks.includes(uid))
        && (!input.cursor || compareGalleryPosition(post, input.cursor) > 0)).sort(compareGalleryPosition)
      const page = posts.slice(0, GALLERY_PAGE_SIZE); const last = page.at(-1)
      return { posts: await Promise.all(page.map((post) => publicPost(post, store))), nextCursor: posts.length > GALLERY_PAGE_SIZE && last ? { deleteAfter: last.deleteAfter, id: last.id } : null }
    },
    async publishCraft(raw) {
      const input = PublishCraftInputSchema.parse(raw); const snapshot = productionSnapshot(input.craftId); const store = read(); const completion = store.completion[input.craftId]
      if (snapshot.craft.status !== 'completed' || !completion || Date.parse(completion.deleteAfter) <= Date.now()) throw new GatewayError('INVALID_CRAFT_STATE')
      const existing = store.posts[input.craftId]
      if (existing) return publicPost(existing, store)
      const post = GalleryPostSchema.parse({ id: input.craftId, title: snapshot.production.template.title, visual: snapshot.production.template.visual ?? 'art', author: input.author, caption: input.caption, photoUrl: null, createdAt: completion.completedAt, deleteAfter: completion.deleteAfter, likes: 0, liked: false, bookmarked: false, comments: [] })
      store.posts[post.id] = post; save(store); return publicPost(post, store)
    },
    async galleryAction(raw) {
      const input = GalleryActionInputSchema.parse(raw); const store = read(); const post = store.posts[input.postId]; const received = receipt(store, 'gallery', input)
      if (!post || Date.parse(post.deleteAfter) <= Date.now()) throw new GatewayError('CRAFT_NOT_FOUND')
      if (received.exists) return publicPost(post, store)
      const reactions = store.reactions[post.id] ??= { likes: [], bookmarks: [] }
      if (input.action !== 'comment') {
        const values = input.action === 'like' ? reactions.likes : reactions.bookmarks
        if (input.active && !values.includes(uid)) values.push(uid)
        if (!input.active && values.includes(uid)) values.splice(values.indexOf(uid), 1)
      }
      if (input.action === 'comment') {
        if (post.comments.length >= 50) throw new GatewayError('RATE_LIMITED')
        post.comments.push({ id: input.requestId, author: input.author!, text: input.text!, createdAt: new Date().toISOString() })
      }
      store.receipts[received.id] = received.payload; save(store); return publicPost(post, store)
    },
  }
}
export function getMockExperienceGateway() { return createMockExperienceGateway(localStorage, getMockUserId()) }
