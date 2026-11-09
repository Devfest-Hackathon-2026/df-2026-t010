import type { GalleryCursor, GalleryPost } from '@rekt/shared'

export interface GalleryReturn { search: string; entry: string; pages: number }
export interface GalleryFeed { posts: GalleryPost[]; nextCursor: GalleryCursor | null; pages: number; fetchedAt: number }
const feeds = new Map<string, GalleryFeed>()
const scrolls = new Map<string, number>()
const key = (uid: string, saved: boolean) => `${uid}:${saved}`
export function readGalleryFeed(uid: string, saved: boolean): GalleryFeed | undefined {
  const feed = feeds.get(key(uid, saved))
  return feed && Date.now() - feed.fetchedAt < 60_000 ? { ...feed, posts: feed.posts.filter((post) => Date.parse(post.deleteAfter) > Date.now()) } : undefined
}
export function writeGalleryFeed(uid: string, saved: boolean, feed: GalleryFeed) { if (feeds.size >= 8) feeds.delete(feeds.keys().next().value!); feeds.set(key(uid, saved), feed) }
export function invalidateGalleryFeed() { feeds.clear() }
export function rememberGalleryScroll(entry: string) {
  scrolls.set(entry, window.scrollY)
  try { sessionStorage.setItem(`co-make:gallery-scroll:${entry}`, String(window.scrollY)) } catch { /* Memory still supports Back. */ }
}
export function galleryScroll(entry: string) {
  let value = scrolls.get(entry)
  try { value ??= Number(sessionStorage.getItem(`co-make:gallery-scroll:${entry}`) ?? 0) } catch { /* Use memory. */ }
  return Number.isFinite(value) && value! >= 0 ? Math.min(value!, 100_000) : 0
}
export function galleryReturn(state: unknown): GalleryReturn | null {
  if (!state || typeof state !== 'object' || !('galleryReturn' in state)) return null
  const value = state.galleryReturn
  if (!value || typeof value !== 'object' || !('search' in value) || !('entry' in value) || !('pages' in value)) return null
  if (typeof value.search !== 'string' || typeof value.entry !== 'string' || value.entry.length > 128 || !Number.isInteger(value.pages)) return null
  const params = new URLSearchParams(value.search)
  const safe = new URLSearchParams()
  if (params.get('tab') === 'saved') safe.set('tab', 'saved')
  if (params.get('sort') === 'popular') safe.set('sort', 'popular')
  return { search: safe.size ? `?${safe}` : '', entry: value.entry, pages: Math.max(1, Math.min(Number(value.pages), 20)) }
}
