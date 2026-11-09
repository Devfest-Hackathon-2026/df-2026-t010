import { createHash, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { CandidatesDocumentSchema, craftFixture, CraftSnapshotSchema, GalleryPostSchema, GalleryPageSchema, pendingProjectLocale, ProductionSnapshotSchema, productionSnapshots, TemplateSchema } from '@rekt/shared'
type Guest = { idToken: string; localId: string }
async function guest(): Promise<Guest> {
  const result = await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })
  return result.json() as Promise<Guest>
}
async function call(user: Guest | undefined, name: string, data: unknown) {
  const result = await fetch(`http://127.0.0.1:5002/demo-co-make/asia-northeast1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.idToken}` } : {}) }, body: JSON.stringify({ data }) })
  const body = await result.json() as { result?: unknown; error?: { details?: { reason?: string } } }
  return { data: body.result, reason: body.error?.details?.reason }
}
async function confirmedInventory(owner: Guest) {
  const { craft } = CraftSnapshotSchema.parse((await call(owner, 'createCraft', { requestId: randomUUID(), locale: 'ja' })).data)
  const inventory = { craftId: craft.id, tools: [], items: [{ id: 'paper', name: '紙', unit: '枚', quantity: 2, source: 'manual', confidence: null }], checks: [] }
  expect((await call(owner, 'editMaterials', { ...inventory, requestId: randomUUID(), expectedRevision: 0 })).reason).toBeUndefined()
  expect((await call(owner, 'confirmMaterials', { craftId: craft.id, requestId: randomUUID(), expectedRevision: 1 })).reason).toBeUndefined()
  return inventory
}
async function exhaustLimit(user: Guest, operation: string, attempts: number) {
  const id = createHash('sha256').update(`${user.localId}\0${operation}`).digest('hex')
  const ref = getFirestore().doc(`operationLimits/${id}`)
  await ref.set({ attempts, windowStart: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 60_000) })
  return ref
}
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Real services are forbidden')
  if (!getApps().length) initializeApp({ projectId: 'demo-co-make' })
})

it('lists only owned creations that reached the instructions, even after many drafts', async () => {
  const owner = await guest()
  const other = await guest()
  const database = getFirestore()
  const batch = database.batch()
  const { id: fixtureId, ...fields } = craftFixture().craft
  const prefix = `${fixtureId}-${randomUUID()}`
  const now = new Date().toISOString()
  const draft = { ...fields, schemaVersion: 2, ownerUid: owner.localId, createdAt: now, updatedAt: now }
  const { started, allStepsCompleted } = productionSnapshots
  const active = database.doc(`crafts/${prefix}-started`)
  const complete = database.doc(`crafts/${prefix}-complete`)
  for (let index = 0; index < 101; index++) {
    batch.set(database.doc(`crafts/${prefix}-00-draft-${index}`), draft)
  }
  batch.set(database.doc(`crafts/${prefix}-selecting`), { ...draft, status: 'project_selection' })
  const entry = { ...draft, status: 'crafting', selectedTemplateId: started.production.template.id }
  batch.set(active, entry)
  batch.set(active.collection('workshop').doc('production'), started.production)
  batch.set(complete, { ...entry, status: 'completed', completedAt: draft.updatedAt })
  batch.set(complete.collection('workshop').doc('production'), allStepsCompleted.production)
  batch.set(database.doc(`crafts/${prefix}-other`), { ...entry, ownerUid: other.localId })
  await batch.commit()

  const result = await call(owner, 'listMyCrafts', {})
  expect(result.reason).toBeUndefined()
  expect(result.data).toHaveLength(2)
  expect(result.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ snapshot: expect.objectContaining({ craft: expect.objectContaining({ id: active.id, status: 'crafting' }) }), title: started.production.template.title }),
    expect.objectContaining({ snapshot: expect.objectContaining({ craft: expect.objectContaining({ id: complete.id, status: 'completed' }) }), title: allStepsCompleted.production.template.title }),
  ]))
})

describe('gallery operation receipts', () => {
  it('returns valid successful replays at the limit while rejecting new or unauthorized requests', async () => {
    const user = await guest()
    const other = await guest()
    const id = randomUUID()
    const postRef = getFirestore().doc(`galleryPosts/${id}`)
    await postRef.set({
      id, ownerUid: user.localId, photoPath: null, title: { ja: '試験', en: 'Test' }, visual: 'art',
      author: 'Maker', caption: '', createdAt: new Date().toISOString(), deleteAfter: new Date(Date.now() + 60_000).toISOString(),
      likedBy: [], bookmarkedBy: [], comments: [],
    })
    const comment = { postId: id, requestId: randomUUID(), action: 'comment', author: 'Viewer', text: 'One comment' }
    const like = { postId: id, requestId: randomUUID(), action: 'like', active: true }
    const bookmark = { postId: id, requestId: randomUUID(), action: 'bookmark', active: true }
    const first = await Promise.all([call(user, 'galleryAction', comment), call(user, 'galleryAction', comment)])
    for (const result of first) expect(GalleryPostSchema.parse(result.data).comments).toHaveLength(1)
    for (const input of [like, bookmark]) expect((await call(user, 'galleryAction', input)).reason).toBeUndefined()

    const limit = await exhaustLimit(user, 'galleryAction', 60)
    const replays = await Promise.all([comment, comment, like, bookmark].map((input) => call(user, 'galleryAction', input)))
    for (const result of replays) {
      const post = GalleryPostSchema.parse(result.data)
      expect(post).toMatchObject({ likes: 1, liked: true, bookmarked: true })
      expect(post.comments).toHaveLength(1)
    }
    expect((await limit.get()).get('attempts')).toBe(60)
    expect((await call(user, 'galleryAction', { ...comment, requestId: randomUUID() })).reason).toBe('RATE_LIMITED')
    expect((await call(user, 'galleryAction', { ...comment, text: 'Different input' })).reason).toBe('IDEMPOTENCY_CONFLICT')
    await exhaustLimit(other, 'galleryAction', 60)
    expect((await call(other, 'galleryAction', comment)).reason).toBe('RATE_LIMITED')
    expect((await call(undefined, 'galleryAction', comment)).reason).toBe('UNAUTHENTICATED')

    await postRef.update({ deleteAfter: new Date(Date.now() - 1000).toISOString() })
    expect((await call(user, 'galleryAction', comment)).reason).toBe('CRAFT_NOT_FOUND')
    await postRef.delete()
    expect((await call(user, 'galleryAction', comment)).reason).toBe('CRAFT_NOT_FOUND')
  })
})

describe('explicit retry for project generation', () => {
  it('generates once in the selected language and caches translation of the started project without changing progress', async () => {
    const owner = await guest()
    const other = await guest()
    const { craftId } = await confirmedInventory(owner)
    const input = { craftId, materialRevision: 1 }
    const generated = CandidatesDocumentSchema.parse((await call(owner, 'generateProjects', { ...input, locale: 'ja' })).data)
    expect(generated.templates!.map(pendingProjectLocale)).toEqual(['en', 'en', 'en'])
    expect((await call(owner, 'generateProjects', { ...input, locale: 'en' })).data).toEqual(generated)
    const template = generated.templates![0]!
    const started = ProductionSnapshotSchema.parse((await call(owner, 'startCraft', { ...input, templateId: template.id, requestId: randomUUID() })).data)
    const step = started.production.steps[0]!
    const advanced = ProductionSnapshotSchema.parse((await call(owner, 'completeStep', { craftId, stepId: step.stepId, expectedRevision: started.production.revision, requestId: randomUUID() })).data)
    const translate = { ...input, action: 'translate', locale: 'en' }
    expect((await call(other, 'generateProjects', translate)).reason).toBe('NOT_CRAFT_OWNER')
    expect((await call(owner, 'generateProjects', translate)).data).toBe(true)
    expect((await call(owner, 'generateProjects', translate)).data).toBe(true)
    const db = getFirestore()
    const saved = await db.doc(`crafts/${craftId}/workshop/production`).get()
    const translated = TemplateSchema.parse(saved.get('template'))
    expect(translated.id).toBe(template.id)
    expect(pendingProjectLocale(translated)).toBeNull()
    expect(translated.title.ja).toBe(template.title.ja)
    expect(translated.title.en).not.toBe(template.title.en)
    expect(saved.get('revision')).toBe(advanced.production.revision)
    expect(saved.get('steps')[0].completedAt.toDate().toISOString()).toBe(advanced.production.steps[0]!.completedAt)
    expect((await db.doc(`aiUsage/projects-${owner.localId}`).get()).get('count')).toBe(2)
  })
  it('blocks previously cached hazardous ideas until the owner requests new ideas', async () => {
    const owner = await guest()
    const { craftId } = await confirmedInventory(owner)
    const input = { craftId, materialRevision: 1 }
    const document = CandidatesDocumentSchema.parse((await call(owner, 'generateProjects', input)).data)
    const template = document.templates![0]!
    template.origin = 'ai'
    template.steps[0]!.instructions.en = 'Use a utility knife.'
    await getFirestore().doc(`crafts/${craftId}/workshop/candidates`).set({ ...document, source: 'ai' })
    expect((await call(owner, 'generateProjects', input)).reason).toBe('AI_UNSAFE_PROJECT')
    expect((await call(owner, 'startCraft', { ...input, requestId: randomUUID(), templateId: template.id })).reason).toBe('AI_UNSAFE_PROJECT')
    const retried = CandidatesDocumentSchema.parse((await call(owner, 'generateProjects', { ...input, retry: true })).data)
    expect(retried.source).toBe('fixture')
    expect(retried.templates).toHaveLength(3)
  })
  it.each([
    { job: { state: 'failed', reason: 'AI_RESPONSE_INVALID' }, reason: 'AI_RESPONSE_INVALID' },
    { job: { state: 'failed' }, reason: 'AI_UNAVAILABLE' },
    { job: { state: 'pending', deadline: Timestamp.fromMillis(Date.now() - 1000) }, reason: 'AI_TIMEOUT' },
  ])('requires explicit retry after $reason and only claims one attempt', async ({ job, reason }) => {
    const owner = await guest()
    const { craftId } = await confirmedInventory(owner)
    const db = getFirestore()
    const jobRef = db.doc(`crafts/${craftId}/projectGeneration/revision-1`)
    const usage = db.doc(`aiUsage/projects-${owner.localId}`)
    const global = db.doc('aiUsage/projects-global')
    const before = (await global.get()).get('count') ?? 0
    const input = { craftId, materialRevision: 1 }
    await jobRef.set({ state: 'pending', deadline: Timestamp.fromMillis(Date.now() + 60_000) })
    expect((await call(owner, 'generateProjects', { ...input, retry: true })).reason).toBe('AI_REQUEST_IN_PROGRESS')
    await jobRef.set(job)
    expect((await call(owner, 'generateProjects', input)).reason).toBe(reason)
    expect((await usage.get()).exists).toBe(false)
    expect((await global.get()).get('count') ?? 0).toBe(before)
    expect((await jobRef.get()).data()).toEqual(job)

    const retries = await Promise.all([call(owner, 'generateProjects', { ...input, retry: true }), call(owner, 'generateProjects', { ...input, retry: true })])
    const success = retries.find((result) => result.data !== undefined)
    const candidates = CandidatesDocumentSchema.parse(success?.data)
    expect(candidates.templates).toHaveLength(3)
    for (const result of retries) {
      if (result.reason) expect(result.reason).toBe('AI_REQUEST_IN_PROGRESS')
      else expect(result.data).toEqual(candidates)
    }
    expect((await call(owner, 'generateProjects', input)).data).toEqual(candidates)
    expect((await usage.get()).get('count')).toBe(1)
    expect((await global.get()).get('count')).toBe(before + 1)
  })

  it('generates normally for a new materials revision after an earlier failure', async () => {
    const owner = await guest()
    const inventory = await confirmedInventory(owner)
    const { craftId } = inventory
    await getFirestore().doc(`crafts/${craftId}/projectGeneration/revision-1`).set({ state: 'failed', reason: 'AI_TIMEOUT' })
    expect((await call(owner, 'editMaterials', { ...inventory, requestId: randomUUID(), expectedRevision: 1, items: [{ ...inventory.items[0], quantity: 3 }] })).reason).toBeUndefined()
    expect((await call(owner, 'confirmMaterials', { craftId, requestId: randomUUID(), expectedRevision: 2 })).reason).toBeUndefined()
    expect(CandidatesDocumentSchema.parse((await call(owner, 'generateProjects', { craftId, materialRevision: 2 })).data)).toMatchObject({ materialRevision: 2, source: 'fixture' })
  })

  it('rejects new jobs at either generation budget and preserves a cached result', async () => {
    const owner = await guest()
    const db = getFirestore()
    const usage = db.doc(`aiUsage/projects-${owner.localId}`)
    const global = db.doc('aiUsage/projects-global')
    const previous = await global.get()
    const day = new Date().toISOString().slice(0, 10)
    try {
      await global.set({ day, count: 0 })
      const cached = { craftId: (await confirmedInventory(owner)).craftId, materialRevision: 1 }
      const fresh = { craftId: (await confirmedInventory(owner)).craftId, materialRevision: 1 }
      const result = CandidatesDocumentSchema.parse((await call(owner, 'generateProjects', cached)).data)
      await usage.set({ day, count: 20 })
      expect((await call(owner, 'generateProjects', { ...fresh, retry: true })).reason).toBe('AI_BUDGET_EXHAUSTED')
      expect((await global.get()).get('count')).toBe(1)

      await usage.set({ day, count: 1 })
      await global.set({ day, count: 50 })
      expect((await call(owner, 'generateProjects', fresh)).reason).toBe('AI_BUDGET_EXHAUSTED')
      expect((await db.doc(`crafts/${fresh.craftId}/projectGeneration/revision-1`).get()).exists).toBe(false)
      expect((await call(owner, 'generateProjects', cached)).data).toEqual(result)
      expect((await usage.get()).get('count')).toBe(1)
      expect((await global.get()).get('count')).toBe(50)
    } finally {
      await usage.delete()
      if (previous.exists) await global.set(previous.data()!)
      else await global.delete()
    }
  })
})

describe('gallery detail and saved pagination', () => {
  it('paginates 26 bookmarks with tied expiry, retrieves older details and keeps each viewer independent', async () => {
    const owner = await guest(); const other = await guest(); const prefix = randomUUID()
    const ids = Array.from({ length: 26 }, (_, n) => `${prefix}-${String(n).padStart(2, '0')}`)
    const batch = getFirestore().batch(); const expiry = new Date(Date.now() + 6 * 86400_000).toISOString()
    for (const id of ids) batch.set(getFirestore().doc(`galleryPosts/${id}`), {
      id, ownerUid: owner.localId, photoPath: null, title: { ja: id, en: id }, visual: 'robot', author: 'Maker', caption: '',
      createdAt: new Date().toISOString(), deleteAfter: expiry, likedBy: [], bookmarkedBy: [owner.localId], comments: [],
    })
    // Exact ties exercise the document ID cursor as well as the expiry cursor.
    await batch.commit()
    const first = GalleryPageSchema.parse((await call(owner, 'listGalleryPage', { savedOnly: true })).data)
    expect(first.posts).toHaveLength(20); expect(first.posts.every((post) => post.bookmarked)).toBe(true)
    expect(first.posts.map((post) => post.id)).not.toContain(ids[0])
    const second = GalleryPageSchema.parse((await call(owner, 'listGalleryPage', { savedOnly: true, cursor: first.nextCursor })).data)
    expect(second.posts).toHaveLength(6); expect(second.nextCursor).toBeNull()
    expect(new Set([...first.posts, ...second.posts].map((post) => post.id))).toEqual(new Set(ids))
    const older = GalleryPostSchema.parse((await call(other, 'getGalleryPost', { postId: ids[0] })).data)
    expect(older).toMatchObject({ id: ids[0], bookmarked: false, liked: false })
    expect(older).not.toHaveProperty('ownerUid'); expect(older).not.toHaveProperty('photoPath'); expect(older).not.toHaveProperty('bookmarkedBy')
    expect(GalleryPageSchema.parse((await call(other, 'listGalleryPage', { savedOnly: true })).data).posts).toEqual([])
    await call(owner, 'galleryAction', { requestId: randomUUID(), postId: ids[0], action: 'bookmark', active: false })
    expect(GalleryPostSchema.parse((await call(owner, 'getGalleryPost', { postId: ids[0] })).data).bookmarked).toBe(false)
  })
  it('excludes expired and unpublished private crafts from detail and Saved', async () => {
    const owner = await guest(); const other = await guest(); const id = randomUUID()
    const craft = CraftSnapshotSchema.parse((await call(owner, 'createCraft', { requestId: randomUUID(), locale: 'ja' })).data).craft
    expect((await call(other, 'getGalleryPost', { postId: craft.id })).data).toBeNull()
    await getFirestore().doc(`galleryPosts/${id}`).set({ id, ownerUid: owner.localId, photoPath: `crafts/${id}/completion/private.jpg`, title: { ja: '期限切れ', en: 'Expired' }, visual: 'art', author: 'Maker', caption: '', createdAt: new Date().toISOString(), deleteAfter: new Date(Date.now() - 1000).toISOString(), likedBy: [], bookmarkedBy: [owner.localId], comments: [] })
    expect((await call(owner, 'getGalleryPost', { postId: id })).data).toBeNull()
    expect(GalleryPageSchema.parse((await call(owner, 'listGalleryPage', { savedOnly: true })).data).posts).toEqual([])
    expect((await call(other, 'getGalleryPost', { postId: 'missing' })).data).toBeNull()
  })
  it('requires authentication and rejects path traversal and malformed cursors', async () => {
    const owner = await guest()
    expect((await call(owner, 'getGalleryPost', { postId: '../crafts/private' })).reason).toBe('VALIDATION_FAILED')
    expect((await call(owner, 'listGalleryPage', { cursor: { id: 'post', deleteAfter: 'yesterday' } })).reason).toBe('VALIDATION_FAILED')
    for (const name of ['getGalleryPost', 'listGalleryPage']) {
      const response = await fetch(`http://127.0.0.1:5002/demo-co-make/asia-northeast1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: name === 'getGalleryPost' ? { postId: 'missing' } : {} }) })
      expect(response.status).toBe(401)
    }
  })
})
describe('AI ideas → production → optional gallery', () => {
  it('keeps ownership, freezes three generated choices, completes and shares with independent reactions', async () => {
    const owner = await guest(); const other = await guest()
    const { craftId } = await confirmedInventory(owner)
    const input = { craftId, materialRevision: 1 }
    expect((await call(other, 'generateProjects', input)).reason).toBe('NOT_CRAFT_OWNER')
    const candidates = CandidatesDocumentSchema.parse((await call(owner, 'generateProjects', input)).data)
    expect(candidates.templates).toHaveLength(3); expect(candidates.source).toBe('fixture')
    expect((await call(owner, 'generateProjects', input)).data).toEqual(candidates)
    expect((await call(owner, 'generateProjects', { ...input, materialRevision: 0 })).reason).toBe('STALE_REVISION')
    const start = { ...input, requestId: randomUUID(), templateId: candidates.templates![0]!.id }
    expect((await call(other, 'startCraft', start)).reason).toBe('NOT_CRAFT_OWNER')
    let current = ProductionSnapshotSchema.parse((await call(owner, 'startCraft', start)).data)
    expect(current.production.template.verified).toBe(false)
    expect((await call(owner, 'completeStep', { requestId: randomUUID(), craftId, stepId: current.production.steps[1]!.stepId, expectedRevision: 0 })).reason).toBe('DEPENDENCY_NOT_COMPLETED')
    for (const step of current.production.steps) current = ProductionSnapshotSchema.parse((await call(owner, 'completeStep', { requestId: randomUUID(), craftId, stepId: step.stepId, expectedRevision: current.production.revision })).data)
    const completed = await call(owner, 'completeCraft', { requestId: randomUUID(), craftId, photoPath: null })
    expect(completed.reason).toBeUndefined()
    const before = (await call(other, 'listGallery', {})).data as { id: string }[]
    expect(before.some((post) => post.id === craftId)).toBe(false)
    const publish = { craftId, requestId: randomUUID(), author: 'テスト', caption: '完成しました' }
    expect((await call(other, 'publishCraft', publish)).reason).toBe('NOT_CRAFT_OWNER')
    const post = GalleryPostSchema.parse((await call(owner, 'publishCraft', publish)).data)
    const publishLimit = await exhaustLimit(owner, 'publishCraft', 10)
    expect((await call(owner, 'publishCraft', publish)).data).toEqual(post)
    expect((await publishLimit.get()).get('attempts')).toBe(10)
    expect((await call(other, 'publishCraft', publish)).reason).toBe('NOT_CRAFT_OWNER')
    expect('ownerUid' in post).toBe(false); expect('photoPath' in post).toBe(false)
    const like = { requestId: randomUUID(), postId: post.id, action: 'like', active: true }
    expect(GalleryPostSchema.parse((await call(other, 'galleryAction', like)).data)).toMatchObject({ likes: 1, liked: true })
    expect(GalleryPostSchema.parse((await call(other, 'galleryAction', like)).data).likes).toBe(1)
    const comment = { requestId: randomUUID(), postId: post.id, action: 'comment', text: 'すてきです', author: '見る人' }
    await call(other, 'galleryAction', comment)
    const reacted = GalleryPostSchema.parse((await call(other, 'galleryAction', comment)).data)
    expect(reacted.comments).toHaveLength(1)
    const feed = (await call(owner, 'listGallery', {})).data as unknown[]
    expect(feed.map((value) => GalleryPostSchema.parse(value)).find((entry) => entry.id === post.id)).toMatchObject({ likes: 1, liked: false })
    await getFirestore().doc(`galleryPosts/${post.id}`).update({ deleteAfter: new Date(Date.now() - 1_000).toISOString() })
    expect(((await call(owner, 'listGallery', {})).data as { id: string }[]).some((entry) => entry.id === post.id)).toBe(false)
    expect((await call(owner, 'publishCraft', publish)).reason).toBe('CRAFT_NOT_FOUND')
  })
})
