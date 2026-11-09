import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToCraftDocument } from './craftDocuments'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  listen: vi.fn(),
  reference: {},
  stop: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({ doc: () => mocks.reference, onSnapshot: mocks.listen }))
vi.mock('./auth', () => ({ ensureGuestUserId: mocks.authenticate }))
vi.mock('./client', () => ({ getFirebaseServices: () => ({ firestore: {} }) }))

const snapshot = (fromCache: boolean, exists: boolean) => ({ metadata: { fromCache }, exists: () => exists })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.authenticate.mockResolvedValue('owner')
  mocks.listen.mockReturnValue(mocks.stop)
})

describe('craft document recovery', () => {
  it('waits past a cache miss and delivers both confirmed absence and recovered data', async () => {
    const next = vi.fn()
    const error = vi.fn()
    const stop = subscribeToCraftDocument(['crafts', 'test', 'workshop', 'candidates'], next, error)
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce())
    const [reference, options, receive] = mocks.listen.mock.calls[0]!
    expect(reference).toBe(mocks.reference)
    expect(options).toEqual({ includeMetadataChanges: true })

    receive(snapshot(true, false))
    expect(next).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()

    const missing = snapshot(false, false)
    const recovered = snapshot(false, true)
    receive(missing)
    receive(recovered)
    expect(next.mock.calls).toEqual([[missing], [recovered]])
    stop()
    expect(mocks.stop).toHaveBeenCalledOnce()
    receive(snapshot(false, true))
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('keeps usable cached data and surfaces an actual permission error', async () => {
    const next = vi.fn()
    const error = vi.fn()
    const stop = subscribeToCraftDocument(['crafts', 'test'], next, error)
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce())
    const [, , receive, fail] = mocks.listen.mock.calls[0]!
    const cached = snapshot(true, true)
    receive(cached)
    expect(next).toHaveBeenCalledWith(cached)
    fail({ code: 'permission-denied' })
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ reason: 'NOT_CRAFT_OWNER' }))
    stop()
  })
})
