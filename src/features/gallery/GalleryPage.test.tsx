// @vitest-environment happy-dom
import '../../test/setup'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { GatewayError } from '@rekt/shared'
import type { GalleryPage as GalleryPageResult, GalleryPost } from '@rekt/shared'
import i18n from '../../i18n'
import GalleryPage from './GalleryPage'
import { invalidateGalleryFeed } from './galleryView'

const mocks = vi.hoisted(() => ({ page: vi.fn(), detail: vi.fn(), action: vi.fn() }))
vi.mock('../../data', () => ({ getCraftGateway: async () => ({ getUserId: async () => 'viewer' }), getExperienceGateway: async () => ({ listGalleryPage: mocks.page, getGalleryPost: mocks.detail, galleryAction: mocks.action }) }))
const post = (id: string): GalleryPost => ({ id, title: { ja: id, en: id }, author: 'Maker', caption: '', visual: 'robot', photoUrl: null, createdAt: new Date().toISOString(), deleteAfter: new Date(Date.now() + 60_000).toISOString(), likes: 0, liked: false, bookmarked: true, comments: [] })
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }
function mount(path = '/gallery') { return render(<MemoryRouter initialEntries={[path]}><Location /><Routes><Route path="/gallery" element={<GalleryPage />} /><Route path="/gallery/:postId" element={<GalleryPage />} /><Route path="/gallery/:postId/comments" element={<GalleryPage commentsOnly />} /></Routes></MemoryRouter>) }
beforeEach(async () => {
  invalidateGalleryFeed(); sessionStorage.clear(); await i18n.changeLanguage('en')
  mocks.page.mockReset().mockResolvedValue({ posts: [post('Robot')], nextCursor: null })
  mocks.detail.mockReset().mockImplementation(async (id: string) => post(id)); mocks.action.mockReset()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0))
})
it('keeps Popular when switching to Saved, and restores the detail return position', async () => {
  mount('/gallery?sort=popular')
  fireEvent.click(await screen.findByRole('button', { name: 'Saved' }))
  await waitFor(() => expect(mocks.page).toHaveBeenLastCalledWith({ savedOnly: true }))
  await screen.findByRole('link', { name: 'Robot' })
  expect(screen.getByRole('combobox')).toHaveValue('popular')
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })
  fireEvent.click(screen.getByRole('link', { name: 'Robot' }))
  await screen.findByRole('heading', { name: 'Robot' })
  expect(mocks.detail).toHaveBeenCalledWith('Robot')
  fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
  await screen.findByRole('link', { name: 'Robot' })
  expect(screen.getByRole('combobox')).toHaveValue('popular')
  expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(window.scrollTo).toHaveBeenLastCalledWith(0, 640))
})
it('opens an older direct link without depending on the first gallery page', async () => {
  mount('/gallery/Older-work')
  expect(await screen.findByRole('heading', { name: 'Older-work' })).toBeInTheDocument()
  expect(mocks.detail).toHaveBeenCalledWith('Older-work'); expect(mocks.page).not.toHaveBeenCalled()
})
it('names a photo card link once and keeps an alternative text on its detail photo', async () => {
  const featured = { ...post('Robot'), photoUrl: 'https://example.test/photo.png' }
  mocks.page.mockResolvedValue({ posts: [featured], nextCursor: null })
  mocks.detail.mockResolvedValue(featured)
  mount()
  fireEvent.click(await screen.findByRole('link', { name: 'Robot' }))
  expect(await screen.findByRole('img', { name: 'Robot' })).toBeInTheDocument()
})
it('displays comment markup as literal text', async () => {
  const comment = '<b>Great work</b>'
  mocks.detail.mockResolvedValue({
    ...post('Robot'),
    comments: [{ id: 'comment', author: 'Viewer', text: comment, createdAt: new Date().toISOString() }],
  })
  mount('/gallery/Robot/comments')
  const rendered = await screen.findByText(comment)
  expect(rendered).toHaveTextContent(comment)
  expect(rendered.querySelector('b')).toBeNull()
})
it('can retry an initial loading failure and provides an exit to Home', async () => {
  mocks.page.mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE'))
  mount(); await screen.findByRole('alert')
  expect(screen.getByRole('link', { name: 'Go back' })).toHaveAttribute('href', '/')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('link', { name: 'Robot' })).toBeInTheDocument()
})
it('keeps loaded posts on a page failure and retries the same cursor without duplicates', async () => {
  const first = post('First'); const cursor = { id: first.id, deleteAfter: first.deleteAfter }
  mocks.page.mockResolvedValueOnce({ posts: [first], nextCursor: cursor }).mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE')).mockResolvedValueOnce({ posts: [first, post('Second')], nextCursor: null })
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'First' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('link', { name: 'Second' })
  expect(screen.getAllByRole('link', { name: 'First' })).toHaveLength(1)
  expect(mocks.page.mock.calls[2]).toEqual(mocks.page.mock.calls[1])
})
it('removes an unbookmarked post from Saved without disturbing the other posts', async () => {
  const first = post('First'); mocks.page.mockResolvedValue({ posts: [first, post('Second')], nextCursor: null }); mocks.action.mockResolvedValue({ ...first, bookmarked: false })
  mount('/gallery?tab=saved&sort=popular')
  fireEvent.click((await screen.findAllByRole('button', { name: 'Save work' }))[0]!)
  await waitFor(() => expect(screen.queryByRole('link', { name: 'First' })).not.toBeInTheDocument())
  expect(screen.getByRole('link', { name: 'Second' })).toBeInTheDocument()
})
it('keeps a bookmark removal when an in-flight page finishes and after returning from detail', async () => {
  const first = post('First')
  const second = post('Second')
  const cursor = { id: first.id, deleteAfter: first.deleteAfter }
  let finishPage!: (result: GalleryPageResult) => void
  const nextPage = new Promise<GalleryPageResult>((resolve) => { finishPage = resolve })
  mocks.page.mockResolvedValueOnce({ posts: [first], nextCursor: cursor }).mockReturnValueOnce(nextPage)
  mocks.action.mockResolvedValue({ ...first, bookmarked: false })

  mount('/gallery?tab=saved')
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
  await waitFor(() => expect(mocks.page).toHaveBeenLastCalledWith({ savedOnly: true, cursor }))
  fireEvent.click(screen.getByRole('button', { name: 'Save work' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'First' })).not.toBeInTheDocument())

  finishPage({ posts: [second], nextCursor: null })
  const detail = await screen.findByRole('link', { name: 'Second' })
  expect(screen.queryByRole('link', { name: 'First' })).not.toBeInTheDocument()
  fireEvent.click(detail)
  await screen.findByRole('heading', { name: 'Second' })
  fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
  expect(await screen.findByRole('link', { name: 'Second' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'First' })).not.toBeInTheDocument()
})
it('shows missing state for an expired or unpublished direct link', async () => {
  mocks.detail.mockResolvedValue(null); mount('/gallery/missing')
  expect(await screen.findByText(i18n.t('flow.postMissing'))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save work' })).not.toBeInTheDocument()
})
