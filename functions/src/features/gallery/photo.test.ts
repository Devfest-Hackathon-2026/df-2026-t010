import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStorage } from 'firebase-admin/storage'
import { getGalleryPhotoUrl } from './photo'

vi.mock('firebase-admin/storage', () => ({ getStorage: vi.fn() }))

const path = 'crafts/test/completion/finished.jpg'
const signed = 'https://example.test/finished.jpg'
const original = { generation: '1700000000000001', metageneration: '1', metadata: { firebaseStorageDownloadTokens: 'fixture-token' } }
const sanitized = { generation: original.generation, metageneration: '2', metadata: {}, cacheControl: 'private,no-store' }
const getMetadata = vi.fn()
const setMetadata = vi.fn()
const getSignedUrl = vi.fn()
const file = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('FUNCTIONS_EMULATOR', 'false')
  file.mockReturnValue({ getMetadata, setMetadata, getSignedUrl })
  vi.mocked(getStorage).mockReturnValue({ bucket: () => ({ file }) } as unknown as ReturnType<typeof getStorage>)
  getMetadata.mockResolvedValue([original])
  setMetadata.mockResolvedValue([sanitized])
  getSignedUrl.mockResolvedValue([signed])
})
afterEach(() => vi.unstubAllEnvs())

describe('gallery photo signing', () => {
  it('removes download credentials and signs only the sanitized generation until the earlier deadline', async () => {
    const deleteAfter = Date.now() + 60_000
    expect(await getGalleryPhotoUrl(path, new Date(deleteAfter).toISOString())).toBe(signed)
    expect(file).toHaveBeenCalledWith(path, { preconditionOpts: { ifGenerationMatch: original.generation, ifMetagenerationMatch: '1' } })
    expect(setMetadata).toHaveBeenCalledWith({ cacheControl: 'private,no-store', metadata: { firebaseStorageDownloadTokens: null } })
    expect(setMetadata.mock.invocationCallOrder[0]).toBeLessThan(getSignedUrl.mock.invocationCallOrder[0]!)
    expect(getSignedUrl).toHaveBeenCalledWith({ action: 'read', version: 'v4', expires: deleteAfter, queryParams: { generation: original.generation } })
  })

  it('uses a concurrent sanitized result and caps the URL at ten minutes', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      setMetadata.mockRejectedValue({ code: 412 })
      getMetadata.mockResolvedValueOnce([original]).mockResolvedValueOnce([sanitized])
      expect(await getGalleryPhotoUrl(path, new Date(now + 3_600_000).toISOString())).toBe(signed)
      expect(getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ expires: now + 600_000 }))
    } finally { clock.mockRestore() }
  })

  it('does not sign a response when download credentials remain', async () => {
    setMetadata.mockResolvedValue([original])
    await expect(getGalleryPhotoUrl(path, new Date(Date.now() + 60_000).toISOString())).rejects.toMatchObject({ details: { reason: 'TEMPORARILY_UNAVAILABLE' } })
    expect(getSignedUrl).not.toHaveBeenCalled()
  })
})
