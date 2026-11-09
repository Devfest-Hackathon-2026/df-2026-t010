// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createMockCraftGateway, readMockCraft } from './crafts'
import { createMockMaterialsGateway } from './materials'
import { createMockProjectsGateway } from './projects'
import { createMockExperienceGateway } from './experience'
import type { GalleryPost } from '@rekt/shared'
const requestId = () => crypto.randomUUID()
async function setup() {
  const { craft } = await createMockCraftGateway(localStorage, 'owner').createCraft({ requestId: requestId(), locale: 'ja' })
  const materials = createMockMaterialsGateway(localStorage, 'owner')
  await materials.editMaterials({ requestId: requestId(), craftId: craft.id, expectedRevision: 0, tools: [], items: [{ id: 'cardboard', name: '段ボール', unit: '枚', quantity: 1, source: 'manual', confidence: null }] })
  await materials.confirmMaterials({ requestId: requestId(), craftId: craft.id, expectedRevision: 1 })
  const projects = createMockProjectsGateway(localStorage, 'owner')
  const document = await projects.generateProjects({ craftId: craft.id, materialRevision: 1 })
  const experience = createMockExperienceGateway(localStorage, 'owner')
  return { craft, materials, projects, document, experience }
}
beforeEach(() => localStorage.clear())
describe('three-idea craft journey', () => {
  it('generates three ideas, freezes one and preserves sequential progress across reloads', async () => {
    const { craft, document, projects, experience } = await setup()
    expect(document.templates).toHaveLength(3)
    expect(await projects.generateProjects({ craftId: craft.id, materialRevision: 1 })).toEqual(document)
    const input = { requestId: requestId(), craftId: craft.id, templateId: document.templates![0]!.id, materialRevision: 1 }
    const started = await experience.startCraft(input)
    await expect(experience.completeStep({ requestId: requestId(), craftId: craft.id, stepId: started.production.steps[1]!.stepId, expectedRevision: 0 })).rejects.toMatchObject({ reason: 'DEPENDENCY_NOT_COMPLETED' })
    const first = { requestId: requestId(), craftId: craft.id, stepId: started.production.steps[0]!.stepId, expectedRevision: 0 }
    await experience.completeStep(first)
    const reloaded = createMockExperienceGateway(localStorage, 'owner')
    expect((await reloaded.startCraft(input)).production.revision).toBe(1)
    await reloaded.completeStep(first)
    expect((await reloaded.startCraft(input)).production.revision).toBe(1)
    await expect(reloaded.completeCraft({ requestId: requestId(), craftId: craft.id, photoPath: null })).rejects.toMatchObject({ reason: 'STEPS_NOT_COMPLETED' })
  })
  it('invalidates generated ideas when materials are edited and rejects another owner', async () => {
    const { craft, materials, document, experience } = await setup()
    await expect(createMockExperienceGateway(localStorage, 'other').startCraft({ requestId: requestId(), craftId: craft.id, templateId: document.templates![0]!.id, materialRevision: 1 })).rejects.toMatchObject({ reason: 'NOT_CRAFT_OWNER' })
    await materials.editMaterials({ requestId: requestId(), craftId: craft.id, expectedRevision: 1, items: [], tools: [] })
    await expect(experience.startCraft({ requestId: requestId(), craftId: craft.id, templateId: document.templates![0]!.id, materialRevision: 1 })).rejects.toMatchObject({ reason: 'INVALID_CRAFT_STATE' })
  })
  it('completes without a photo and publishes once, with persistent idempotent reactions and comments', async () => {
    const { craft, document, experience } = await setup()
    let current = await experience.startCraft({ requestId: requestId(), craftId: craft.id, templateId: document.templates![0]!.id, materialRevision: 1 })
    for (const step of current.production.steps) current = await experience.completeStep({ requestId: requestId(), craftId: craft.id, stepId: step.stepId, expectedRevision: current.production.revision })
    const finish = { requestId: requestId(), craftId: craft.id, photoPath: null }
    const completed = await experience.completeCraft(finish)
    expect(readMockCraft(localStorage, craft.id)?.craft.status).toBe('completed')
    expect(await experience.completeCraft(finish)).toEqual(completed)
    expect(await experience.listGallery()).toHaveLength(0)
    const publish = { requestId: requestId(), craftId: craft.id, author: 'つくる人', caption: 'できました' }
    const post = await experience.publishCraft(publish)
    expect(await experience.publishCraft(publish)).toEqual(post)
    await experience.galleryAction({ requestId: requestId(), postId: post.id, action: 'like', active: true })
    const comment = { requestId: requestId(), postId: post.id, action: 'comment' as const, author: '見る人', text: 'いいね！' }
    await experience.galleryAction(comment); await experience.galleryAction(comment)
    const saved = (await createMockExperienceGateway(localStorage, 'owner').listGallery())[0]!
    expect(saved.likes).toBe(1); expect(saved.comments).toHaveLength(1)
    expect((await experience.listMyCrafts())[0]?.title).toEqual(document.templates![0]!.title)
  })
})

describe('paged public gallery', () => {
  function seed() {
    const expires = new Date(Date.now() + 60_000).toISOString()
    const posts = Object.fromEntries(Array.from({ length: 26 }, (_, n) => {
      const id = `post-${String(n).padStart(2, '0')}`
      const post: GalleryPost = { id, title: { ja: id, en: id }, visual: 'robot', author: 'Maker', caption: '', photoUrl: null, createdAt: new Date().toISOString(), deleteAfter: expires, likes: 0, liked: false, bookmarked: false, comments: [] }
      return [id, post]
    }))
    const reactions = Object.fromEntries(Object.keys(posts).map((id) => [id, { likes: [], bookmarks: ['owner'] }]))
    localStorage.setItem('co-make:mock-experience:v3', JSON.stringify({ production: {}, completion: {}, photos: {}, receipts: {}, posts, reactions }))
    return posts
  }
  it('paginates tied expiry dates without omissions and retrieves an older post directly', async () => {
    seed(); const gateway = createMockExperienceGateway(localStorage, 'owner')
    const first = await gateway.listGalleryPage({}); expect(first.posts).toHaveLength(20)
    expect(first.posts.some((post) => post.id === 'post-00')).toBe(false)
    const second = await gateway.listGalleryPage({ cursor: first.nextCursor! })
    expect(second.posts).toHaveLength(6); expect(second.nextCursor).toBeNull()
    expect(new Set([...first.posts, ...second.posts].map((post) => post.id)).size).toBe(26)
    expect(await gateway.getGalleryPost('post-00')).toMatchObject({ id: 'post-00', bookmarked: true })
  })
  it('queries only the current user’s bookmarks, including those beyond the first 20', async () => {
    seed(); const gateway = createMockExperienceGateway(localStorage, 'owner')
    const first = await gateway.listGalleryPage({ savedOnly: true })
    const second = await gateway.listGalleryPage({ savedOnly: true, cursor: first.nextCursor! })
    expect(first.posts.length + second.posts.length).toBe(26)
    expect((await createMockExperienceGateway(localStorage, 'other').listGalleryPage({ savedOnly: true })).posts).toEqual([])
    expect(await createMockExperienceGateway(localStorage, 'other').getGalleryPost('post-00')).toMatchObject({ bookmarked: false })
  })
  it('never returns expired or unpublished posts, and rejects malformed cursors', async () => {
    const posts = seed(); const store = JSON.parse(localStorage.getItem('co-make:mock-experience:v3')!)
    store.posts['post-00'].deleteAfter = new Date(Date.now() - 1000).toISOString()
    localStorage.setItem('co-make:mock-experience:v3', JSON.stringify(store))
    const gateway = createMockExperienceGateway(localStorage, 'owner')
    expect(await gateway.getGalleryPost('post-00')).toBeNull(); expect(await gateway.getGalleryPost('unpublished')).toBeNull()
    expect((await gateway.listGalleryPage({ cursor: { id: 'post-01', deleteAfter: posts['post-01']!.deleteAfter } })).posts).toEqual([])
    await expect(gateway.listGalleryPage({ cursor: { id: '../private', deleteAfter: posts['post-01']!.deleteAfter } })).rejects.toThrow()
  })
})
