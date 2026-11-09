// @vitest-environment happy-dom
import '../../test/setup'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { GatewayError, craftFixture, materialRecognitionResponseFixtures } from '@rekt/shared'
import type { MaterialRecognitionResponse, MaterialsDocument } from '@rekt/shared'
import { CraftContext } from '../../app/CraftContext'
import type { CraftGateway } from '../../data/contracts'
import i18n from '../../i18n'
import MaterialJourney from './MaterialJourney'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  upload: vi.fn(),
  recognize: vi.fn(),
  edit: vi.fn(),
  document: null as MaterialsDocument | null,
}))
vi.mock('../../data', () => ({ getMaterialsGateway: async () => ({
  uploadMaterialPhoto: mocks.upload,
  recognizeMaterials: mocks.recognize,
  editMaterials: mocks.edit,
  subscribeToMaterials: (_id: string, next: (document: MaterialsDocument | null) => void) => {
    queueMicrotask(() => next(mocks.document))
    return () => {}
  },
}) }))
vi.mock('./preparePhoto', async (original) => ({ ...await original<typeof import('./preparePhoto')>(), preparePhoto: mocks.prepare }))

const snapshot = craftFixture()
const craftId = snapshot.craft.id
const photo = { id: 'photo-1', mimeType: 'image/jpeg' as const, blob: new Blob(['jpeg'], { type: 'image/jpeg' }), previewUrl: 'blob:photo-1' }
const image = { imagePath: `crafts/${craftId}/materials/photo-1.jpg`, imageGeneration: '1' }
const recognized = materialRecognitionResponseFixtures.success
function deferred<T>() {
  let resolve!: (result: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function mount() {
  return render(<MemoryRouter><CraftContext.Provider value={{ snapshot, uid: snapshot.craft.ownerUid, gateway: {} as CraftGateway, applySnapshot: () => {} }}>
    <MaterialJourney />
  </CraftContext.Provider></MemoryRouter>)
}
function selectPhoto() {
  fireEvent.change(screen.getByTestId('library-input'), { target: { files: [new File(['jpeg'], 'materials.jpg', { type: 'image/jpeg' })] } })
}
beforeEach(async () => {
  sessionStorage.clear()
  mocks.document = null
  mocks.prepare.mockReset().mockResolvedValue(photo)
  mocks.upload.mockReset().mockResolvedValue(image)
  mocks.recognize.mockReset().mockResolvedValue(recognized)
  mocks.edit.mockReset().mockResolvedValue(undefined)
  URL.revokeObjectURL = vi.fn()
  await i18n.changeLanguage('ja')
})

it('keeps the photo screen in place during preparation, analysis and saving, then allows retry', async () => {
  sessionStorage.setItem(`co-make:material-step:${craftId}`, 'photo')
  const preparation = deferred<typeof photo>()
  const upload = deferred<typeof image>()
  const analysis = deferred<MaterialRecognitionResponse>()
  const save = deferred<void>()
  mocks.prepare.mockReturnValueOnce(preparation.promise)
  mocks.upload.mockReturnValueOnce(upload.promise)
  mocks.recognize.mockReturnValueOnce(analysis.promise)
  mocks.edit.mockReturnValueOnce(save.promise)
  mount()
  const manual = await screen.findByRole('button', { name: i18n.t('flow.enterManually') })
  const back = screen.getByRole('button', { name: i18n.t('flow.back') })
  selectPhoto()
  expect(manual).toBeDisabled()
  expect(back).toBeDisabled()
  await act(async () => preparation.resolve(photo))
  expect(manual).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('sendPhoto') }))
  await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1))
  expect(manual).toBeDisabled()
  expect(back).toBeDisabled()
  await act(async () => upload.resolve(image))
  await waitFor(() => expect(mocks.recognize).toHaveBeenCalledTimes(1))
  expect(manual).toBeDisabled()
  expect(back).toBeDisabled()
  await act(async () => analysis.reject(new GatewayError('TEMPORARILY_UNAVAILABLE')))
  expect(manual).toBeEnabled()
  expect(back).toBeEnabled()
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('resendPhoto') }))
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('addCandidates') }))
  expect(mocks.recognize.mock.calls[1]?.[0]).toEqual(mocks.recognize.mock.calls[0]?.[0])
  expect(manual).toBeDisabled()
  expect(back).toBeDisabled()
  expect(screen.getByRole('button', { name: i18n.t('recognizeAgain') })).toBeDisabled()
  await act(async () => save.resolve())
  expect(await screen.findByRole('heading', { name: i18n.t('flow.materialList') })).toBeInTheDocument()
})

it('does not start recognition if the photo upload finishes after leaving the journey', async () => {
  sessionStorage.setItem(`co-make:material-step:${craftId}`, 'photo')
  const upload = deferred<typeof image>()
  mocks.upload.mockReturnValueOnce(upload.promise)
  const first = mount()
  await screen.findByRole('button', { name: i18n.t('flow.enterManually') })
  selectPhoto()
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('sendPhoto') }))
  await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1))
  first.unmount()
  await act(async () => upload.resolve(image))
  expect(mocks.recognize).not.toHaveBeenCalled()
  mount()
  expect(await screen.findByRole('button', { name: i18n.t('flow.enterManually') })).toBeEnabled()
  expect(screen.queryByRole('button', { name: i18n.t('sendPhoto') })).not.toBeInTheDocument()
})

it('restores tool selections, batches them on Next and keeps them on a save failure', async () => {
  const first = mount()
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('flow.moreTools') }))
  fireEvent.change(screen.getByLabelText(i18n.t('otherTool')), { target: { value: 'ピンセット' } })
  first.unmount()
  await i18n.changeLanguage('en')
  mount()
  expect(await screen.findByLabelText(i18n.t('otherTool'))).toHaveValue('ピンセット')
  const next = screen.getByRole('button', { name: i18n.t('flow.next') })
  expect(next).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('addTool') }))
  const custom = await screen.findByRole('checkbox', { name: 'ピンセット' })
  const scissors = screen.getByRole('checkbox', { name: 'Scissors' })
  fireEvent.click(scissors)
  expect(custom).toBeChecked()
  expect(scissors).toBeChecked()
  expect(screen.getByLabelText(i18n.t('otherTool'))).toHaveValue('')
  expect(mocks.edit).not.toHaveBeenCalled()
  expect(next).toBeEnabled()
  mocks.edit.mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE'))
  fireEvent.click(next)
  await screen.findByRole('alert')
  expect(custom).toBeChecked()
  expect(scissors).toBeChecked()
  expect(mocks.edit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tools: ['ピンセット', 'Scissors'] }))
  fireEvent.click(next)
  expect(await screen.findByRole('heading', { name: i18n.t('flow.photoTitle') })).toBeInTheDocument()
  expect(mocks.edit.mock.calls[1]).toEqual(mocks.edit.mock.calls[0])
})
