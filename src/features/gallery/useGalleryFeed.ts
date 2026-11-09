import { useEffect, useRef, useState } from 'react'
import type { GalleryPost, GatewayError } from '@rekt/shared'
import { getCraftGateway, getExperienceGateway } from '../../data'
import { gatewayError } from '../../data/errors'
import { readGalleryFeed, writeGalleryFeed } from './galleryView'
import type { GalleryFeed } from './galleryView'
interface FeedState { saved: boolean; feed: GalleryFeed | null; error: GatewayError | null; pending: boolean; uid: string }
export function useGalleryFeed(enabled: boolean, saved: boolean, pages: number) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<FeedState>({ saved, feed: null, error: null, pending: false, uid: '' })
  const epoch = useRef(0); const busy = useRef(false)
  useEffect(() => {
    if (!enabled) return
    const token = ++epoch.current; busy.current = true
    setState((old) => ({ ...old, saved, feed: null, error: null, pending: true }))
    void (async () => {
      const uid = await (await getCraftGateway()).getUserId()
      if (token !== epoch.current) return
      let feed = attempt === 0 ? readGalleryFeed(uid, saved) : undefined
      if (!feed) {
        const gateway = await getExperienceGateway()
        feed = { posts: [], nextCursor: null, pages: 0, fetchedAt: Date.now() }
        for (let page = 0; page < pages; page++) {
          const result = await gateway.listGalleryPage({ savedOnly: saved, ...(feed.nextCursor ? { cursor: feed.nextCursor } : {}) })
          feed = { posts: [...feed.posts, ...result.posts], nextCursor: result.nextCursor, pages: feed.pages + 1, fetchedAt: Date.now() }
          if (token !== epoch.current) return
          if (!result.nextCursor) break
        }
      }
      if (token !== epoch.current) return
      setState({ saved, feed, error: null, pending: false, uid })
    })().catch((cause: unknown) => { if (token === epoch.current) setState((old) => ({ ...old, error: gatewayError(cause), pending: false })) }).finally(() => { if (token === epoch.current) busy.current = false })
    return () => { epoch.current = token + 1; busy.current = false }
  }, [enabled, saved, attempt, pages])
  const { feed, uid, saved: loadedTab } = state
  useEffect(() => {
    if (feed) writeGalleryFeed(uid, loadedTab, feed)
  }, [feed, uid, loadedTab])
  async function loadMore() {
    const cursor = feed?.nextCursor
    if (busy.current || !enabled || loadedTab !== saved || !cursor) return
    busy.current = true; const token = epoch.current
    setState((old) => ({ ...old, pending: true, error: null }))
    try {
      const result = await (await getExperienceGateway()).listGalleryPage({ savedOnly: saved, cursor })
      if (token !== epoch.current) return
      const fetchedAt = Date.now()
      setState((old) => {
        const current = old.feed
        if (!current || current.nextCursor !== cursor) return old
        const ids = new Set(current.posts.map((post) => post.id))
        const posts = [...current.posts, ...result.posts.filter((post) => !ids.has(post.id))]
        return { ...old, feed: { posts, nextCursor: result.nextCursor, pages: current.pages + 1, fetchedAt }, pending: false }
      })
    } catch (cause) { if (token === epoch.current) setState((old) => ({ ...old, error: gatewayError(cause), pending: false })) }
    finally { if (token === epoch.current) busy.current = false }
  }
  function update(post: GalleryPost) {
    setState((old) => {
      if (!old.feed?.posts.some((item) => item.id === post.id)) return old
      const posts = old.feed.posts.map((item) => item.id === post.id ? post : item).filter((item) => !old.saved || item.bookmarked)
      return { ...old, feed: { ...old.feed, posts } }
    })
  }
  return { ...state, feed: state.saved === saved ? state.feed : null, loadMore, update, retry: () => setAttempt((n) => n + 1) }
}
