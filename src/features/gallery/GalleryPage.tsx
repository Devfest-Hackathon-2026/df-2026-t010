import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { HeartIcon } from '@phosphor-icons/react/dist/csr/Heart'
import { ChatCircleIcon } from '@phosphor-icons/react/dist/csr/ChatCircle'
import { BookmarkSimpleIcon } from '@phosphor-icons/react/dist/csr/BookmarkSimple'
import { ShareNetworkIcon } from '@phosphor-icons/react/dist/csr/ShareNetwork'
import { PaperPlaneRightIcon } from '@phosphor-icons/react/dist/csr/PaperPlaneRight'
import { ImagesIcon } from '@phosphor-icons/react/dist/csr/Images'
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { LanguageSchema } from '@rekt/shared'
import type { GalleryActionInput, GalleryPost, GatewayError } from '@rekt/shared'
import { getExperienceGateway } from '../../data'
import { gatewayError } from '../../data/errors'
import { useOperation } from '../../components/feedback/useOperation'
import { ErrorNotice, LoadingNotice } from '../../components/feedback/Feedback'
import { CraftVisual } from '../../components/ui/CraftVisual'
import { ScreenTitle } from '../../components/ui/ScreenTitle'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { galleryReturn, galleryScroll, invalidateGalleryFeed, rememberGalleryScroll } from './galleryView'
import { useGalleryFeed } from './useGalleryFeed'
export default function GalleryPage({ commentsOnly = false }: { commentsOnly?: boolean }) {
  const { postId } = useParams(); const { t, i18n } = useTranslation(); const [params, setParams] = useSearchParams()
  const location = useLocation(); const navigate = useNavigate(); const navigationType = useNavigationType()
  const previous = galleryReturn(location.state)
  const popular = params.get('sort') === 'popular'; const saved = params.get('tab') === 'saved'
  const feed = useGalleryFeed(!postId, saved, previous?.pages ?? 1)
  const [detail, setDetail] = useState<{ id: string; post: GalleryPost | null; error: GatewayError | null } | null>(null)
  const selected = detail && detail.id === postId ? detail.post : undefined
  const error = detail && detail.id === postId ? detail.error : null
  const [attempt, setAttempt] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  const restored = useRef('')
  const returnState = postId ? previous : { search: location.search, entry: location.key, pages: feed.feed?.pages ?? 1 }
  const detailState = { galleryReturn: returnState }
  const remember = () => { if (!postId) rememberGalleryScroll(location.key) }
  function back() {
    const destination = commentsOnly && postId ? `/gallery/${postId}` : `/gallery${previous?.search ?? ''}`
    navigate(destination, { state: detailState })
  }
  const [status, setStatus] = useState(''); const [author, setAuthor] = useState(''); const [comment, setComment] = useState('')
  const operation = useOperation(); const lang = LanguageSchema.safeParse(i18n.language).data ?? 'ja'
  useEffect(() => {
    if (!postId) return
    let active = true
    void getExperienceGateway().then((gateway) => gateway.getGalleryPost(postId)).then((post) => { if (active) setDetail({ id: postId, post, error: null }) }).catch((cause: unknown) => { if (active) setDetail({ id: postId, post: null, error: gatewayError(cause) }) })
    return () => { active = false }
  }, [attempt, postId])
  useEffect(() => {
    if (postId || !feed.feed || feed.pending || restored.current === location.key) return
    const entry = previous?.entry ?? (navigationType === 'POP' ? location.key : '')
    const frame = requestAnimationFrame(() => { window.scrollTo(0, entry ? galleryScroll(entry) : 0); restored.current = location.key })
    return () => cancelAnimationFrame(frame)
  }, [postId, feed.feed, feed.pending, location.key, previous?.entry, navigationType])
  useEffect(() => {
    const posts = postId ? selected ? [selected] : [] : feed.feed?.posts ?? []
    const deadline = Math.min(...posts.map((post) => Date.parse(post.deleteAfter)).filter((time) => time > clock))
    if (!Number.isFinite(deadline)) return
    const timer = window.setTimeout(() => setClock(Date.now()), Math.max(0, deadline - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [postId, selected, feed.feed, clock])
  async function action(input: Omit<GalleryActionInput, 'requestId'>) {
    const result = await operation.run(`galleryAction:${input.postId}`, input, async (requestId) => (await getExperienceGateway()).galleryAction({ ...input, requestId }))
    if (result) { if (postId) setDetail({ id: postId, post: result, error: null }); feed.update(result); invalidateGalleryFeed(); if (input.action === 'comment') setComment('') }
  }
  async function share(post: GalleryPost) {
    const url = new URL(`/gallery/${encodeURIComponent(post.id)}`, window.location.origin).href
    try {
      if (navigator.share) await navigator.share({ title: post.title[lang], url })
      else { await navigator.clipboard.writeText(url); setStatus(t('flow.linkCopied')) }
    } catch { setStatus(t('flow.shareCancelled')) }
  }
  const reactions = (post: GalleryPost) => <div className="gallery-reactions"><button className={`reaction-button${post.liked ? ' is-liked' : ''}`} aria-label={t('flow.like')} aria-pressed={post.liked} disabled={operation.pending} onClick={() => { void action({ postId: post.id, action: 'like', active: !post.liked }) }}><HeartIcon size={23} weight={post.liked ? 'fill' : 'regular'} /><span>{post.likes}</span></button><Link className="reaction-button" to={`/gallery/${post.id}/comments`} state={detailState} onClick={remember} aria-label={t('flow.comments')}><ChatCircleIcon size={23} /><span>{post.comments.length}</span></Link><button className="reaction-button bookmark-button" aria-label={t('flow.bookmark')} aria-pressed={post.bookmarked} disabled={operation.pending} onClick={() => { void action({ postId: post.id, action: 'bookmark', active: !post.bookmarked }) }}><BookmarkSimpleIcon size={23} weight={post.bookmarked ? 'fill' : 'regular'} /></button><button className="reaction-button" aria-label={t('flow.shareLink')} onClick={() => { void share(post) }}><ShareNetworkIcon size={23} /></button></div>
  const image = (post: GalleryPost, alt = post.title[lang]) => post.photoUrl ? <img className="gallery-photo" src={post.photoUrl} alt={alt} /> : <CraftVisual kind={post.visual} className="gallery-art" />
  const problem = postId ? error : feed.error
  if (problem && (postId || !feed.feed)) return <div className="page"><ScreenTitle {...(postId ? { onBack: back } : { back: '/' })}>{t('flow.gallery')}</ScreenTitle><ErrorNotice error={problem} onRetry={() => { setDetail(null); setAttempt((n) => n + 1); feed.retry() }} /></div>
  if (postId ? selected === undefined || (selected !== null && selected.id !== postId) : !feed.feed) return <LoadingNotice />
  if (postId && (!selected || Date.parse(selected.deleteAfter) <= clock)) return <div className="page"><ScreenTitle onBack={back}>{t('flow.workDetails')}</ScreenTitle><p className="empty-state">{t('flow.postMissing')}</p><Link to={`/gallery${previous?.search ?? ''}`} state={detailState} className="button button--primary wide">{t('flow.viewGallery')}</Link></div>
  const displayed = (feed.feed?.posts ?? []).filter((post) => Date.parse(post.deleteAfter) > clock).sort((a, b) => popular ? b.likes - a.likes || b.createdAt.localeCompare(a.createdAt) : b.createdAt.localeCompare(a.createdAt))
  function setSaved(next: boolean) { const search = new URLSearchParams(params); if (next) search.set('tab', 'saved'); else search.delete('tab'); setParams(search) }
  return <div className="page gallery-page"><ScreenTitle {...(postId ? { onBack: back } : { back: '/' })}>{t(postId ? commentsOnly ? 'flow.comments' : 'flow.workDetails' : 'flow.gallery')}</ScreenTitle>
    {status && <p role="status" className="small">{status}</p>}{operation.error && <ErrorNotice error={operation.error} />}{!postId && feed.error && <ErrorNotice error={feed.error} onRetry={() => { void feed.loadMore() }} />}
    {postId && selected ? <>
      {!commentsOnly && <article className="gallery-detail">{image(selected)}<h2>{selected.title[lang]}</h2><div className="post-author"><strong>{selected.author}</strong><time>{new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(new Date(selected.createdAt))}</time></div>{reactions(selected)}{selected.caption && <p className="post-caption">{selected.caption}</p>}</article>}
      <section className="comments-section" aria-label={t('flow.comments')}>{!commentsOnly && <h2>{t('flow.comments')}<span>{selected.comments.length}</span></h2>}<ul className="comment-list">{selected.comments.map((item) => <li key={item.id}><p><strong>{item.author}</strong><time>{new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(new Date(item.createdAt))}</time></p><p>{item.text}</p></li>)}</ul><form className="comment-form" onSubmit={(event) => { event.preventDefault(); void action({ postId: selected.id, action: 'comment', author: author.trim(), text: comment.trim() }) }}><TextField id="comment-author" label={t('flow.author')} value={author} maxLength={40} required disabled={operation.pending} onChange={(event) => setAuthor(event.target.value)} /><label className="visually-hidden" htmlFor="comment-text">{t('flow.commentInput')}</label><div className="comment-input-row"><input id="comment-text" value={comment} maxLength={500} required placeholder={t('flow.commentInput')} disabled={operation.pending} onChange={(event) => setComment(event.target.value)} /><Button type="submit" aria-label={t('flow.sendComment')} disabled={operation.pending || !author.trim() || !comment.trim()}><PaperPlaneRightIcon size={22} weight="fill" /></Button></div></form></section>
    </> : <><div className="gallery-tabs"><button className={!saved ? 'active' : ''} aria-pressed={!saved} onClick={() => setSaved(false)}>{t('flow.allWorks')}</button><button className={saved ? 'active' : ''} aria-pressed={saved} onClick={() => setSaved(true)}>{t('flow.savedWorks')}</button><label className="visually-hidden" htmlFor="gallery-sort">{t('flow.sort')}</label><select id="gallery-sort" value={popular ? 'popular' : 'newest'} onChange={(event) => setParams({ ...(saved ? { tab: 'saved' } : {}), sort: event.target.value })}><option value="newest">{t('flow.newest')}</option><option value="popular">{t('flow.popular')}</option></select></div>
      {displayed.length === 0 && !feed.feed?.nextCursor ? <div className="gallery-empty"><ImagesIcon size={66} weight="duotone" /><p>{t(saved ? 'flow.noBookmarks' : 'flow.galleryEmpty')}</p><Link className="button button--primary" to="/start">{t('flow.create')}<ArrowRightIcon size={20} /></Link></div> : <div className="gallery-feed">{displayed.map((post) => <article className="gallery-post" key={post.id}><div className="post-author"><strong>{post.author}</strong><time>{new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(new Date(post.createdAt))}</time></div><Link to={`/gallery/${post.id}`} state={detailState} onClick={remember} className="gallery-post-link">{image(post, '')}<h2>{post.title[lang]}</h2></Link>{post.caption && <p className="post-caption">{post.caption}</p>}{reactions(post)}</article>)}</div>}
      {feed.feed?.nextCursor && <Button className="wide" variant="secondary" disabled={feed.pending} onClick={() => { void feed.loadMore() }}>{t(feed.pending ? 'working' : 'loadMoreWorks')}</Button>}
    </>}
  </div>
}
