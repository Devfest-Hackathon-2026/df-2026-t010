// @vitest-environment happy-dom
import '../../test/setup'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GatewayError, materialRecognitionResponseFixtures, craftFixture } from '@rekt/shared'
import i18n from '../../i18n'
import { CraftContext } from '../../app/CraftContext'
import type { CraftGateway } from '../../data/contracts'
import MaterialPhotoSection from './MaterialPhotoSection'
import { PhotoError } from './preparePhoto'

const mocks = vi.hoisted(() => ({ uploadMaterialPhoto: vi.fn(), recognizeMaterials: vi.fn(), preparePhoto: vi.fn() }))
vi.mock('../../data', () => ({ getMaterialsGateway: async () => ({ uploadMaterialPhoto: mocks.uploadMaterialPhoto, recognizeMaterials: mocks.recognizeMaterials }) }))
vi.mock('./preparePhoto', async (original) => ({ ...(await original<typeof import('./preparePhoto')>()), preparePhoto: mocks.preparePhoto }))

const snapshot = craftFixture()
const photo = (id = 'photo-1') => ({ id, mimeType: 'image/jpeg' as const, blob: new Blob(['jpeg'], { type: 'image/jpeg' }), previewUrl: `blob:${id}` })
const output = { ...materialRecognitionResponseFixtures.success, result: { items: [{ id: 'paper-cup', name: '紙コップ', quantity: 6, unit: '個', source: 'ai' as const, confidence: 0.9 }], warnings: ['端の材料は読み取れなかった可能性があります。'] } }

beforeEach(async () => {
  sessionStorage.clear(); mocks.recognizeMaterials.mockReset(); mocks.preparePhoto.mockReset()
  mocks.uploadMaterialPhoto.mockReset().mockResolvedValue({ imagePath: 'crafts/fixture-craft/materials/photo.jpg', imageGeneration: '1234567890123456' })
  URL.revokeObjectURL = vi.fn()
  await i18n.changeLanguage('ja')
})
function mount(uid = snapshot.craft.ownerUid, props: ComponentProps<typeof MaterialPhotoSection> = {}) {
  return render(<CraftContext.Provider value={{ snapshot, uid, gateway: {} as CraftGateway, applySnapshot: () => {} }}><MaterialPhotoSection {...props} /></CraftContext.Provider>)
}
function pick(testId = 'camera-input', file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })) {
  fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } })
}

describe('材料写真の送信（#9）', () => {
  it('撮影用はカメラ指定、選択用はアルバムから選べる', () => {
    mount()
    expect(screen.getByTestId('camera-input')).toHaveAttribute('capture', 'environment')
    expect(screen.getByTestId('library-input')).not.toHaveAttribute('capture')
    expect(screen.getByRole('button', { name: 'カメラで撮る' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '写真を選ぶ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この写真を送る' })).not.toBeInTheDocument()
  })

  it('写真を選ぶとプレビューを出し、送ると候補を表示する', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockResolvedValueOnce(output)
    mount(); pick('library-input')
    expect(await screen.findByRole('img', { name: '送信する材料の写真' })).toHaveAttribute('src', 'blob:photo-1')
    fireEvent.click(screen.getByRole('button', { name: 'この写真を送る' }))
    expect(await screen.findByRole('heading', { name: 'AIが見つけた材料の候補' })).toBeInTheDocument()
    expect(screen.getByText('紙コップ')).toBeInTheDocument()
    expect(mocks.recognizeMaterials.mock.calls[0]?.[0]).toMatchObject({ craftId: snapshot.craft.id, expectedCraftRevision: 0, locale: 'ja', imagePath: 'crafts/fixture-craft/materials/photo.jpg', imageGeneration: '1234567890123456' })
    expect(screen.getByText('サンプル')).toBeInTheDocument()
  })

  it('送信中は二重に送れない', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockReturnValueOnce(new Promise(() => {}))
    mount(); pick()
    fireEvent.click(await screen.findByRole('button', { name: 'この写真を送る' }))
    const sending = await screen.findByRole('button', { name: '材料を読み取っています…' })
    expect(sending).toBeDisabled()
    fireEvent.click(sending)
    expect(mocks.recognizeMaterials).toHaveBeenCalledTimes(1)
  })

  it('認識結果の自由文の注意を表示せず、候補を残す', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockResolvedValueOnce({ ...output, engine: 'gemini' })
    mount(); pick()
    fireEvent.click(await screen.findByRole('button', { name: 'この写真を送る' }))
    expect(await screen.findByText('紙コップ')).toBeInTheDocument()
    expect(screen.queryByText(output.result.warnings[0]!)).not.toBeInTheDocument()
  })

  it('通信失敗では写真を残し、再送で同じ操作IDを使う', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE')).mockResolvedValueOnce(output)
    mount(); pick()
    fireEvent.click(await screen.findByRole('button', { name: 'この写真を送る' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信状態')
    expect(screen.getByRole('img', { name: '送信する材料の写真' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度送る' }))
    expect(await screen.findByText('紙コップ')).toBeInTheDocument()
    const [first, second] = mocks.recognizeMaterials.mock.calls
    expect(first?.[0].requestId).toBe(second?.[0].requestId)
  })

  it('画像でないファイルは理由を出して送信ボタンを出さない', async () => {
    mocks.preparePhoto.mockRejectedValueOnce(new PhotoError('notImage'))
    mount(); pick('library-input', new File(['x'], 'a.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('画像ファイルを選んでください')
    expect(screen.queryByRole('button', { name: 'この写真を送る' })).not.toBeInTheDocument()
  })

  it('撮り直すと前の写真のプレビューを捨てる', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo('photo-1')).mockResolvedValueOnce(photo('photo-2'))
    mount(); pick()
    await screen.findByRole('img', { name: '送信する材料の写真' })
    pick()
    await waitFor(() => expect(screen.getByRole('img', { name: '送信する材料の写真' })).toHaveAttribute('src', 'blob:photo-2'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1')
  })

  it('材料が見つからなかったときは撮り直しを案内する', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockResolvedValueOnce({ ...output, result: { items: [], warnings: [] } })
    mount(); pick()
    fireEvent.click(await screen.findByRole('button', { name: 'この写真を送る' }))
    expect(await screen.findByText(/材料を見つけられませんでした/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '別の写真で読み取り直す' }))
    expect(screen.getByRole('button', { name: 'カメラで撮る' })).toBeInTheDocument()
  })

  it('制作データの所有者以外には撮影・選択・送信を出さない', () => {
    mount('fixture-member-1')
    expect(screen.queryByTestId('camera-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('library-input')).not.toBeInTheDocument()
    expect(mocks.uploadMaterialPhoto).not.toHaveBeenCalled()
  })

  it('写真の差し替えが失敗したら前の写真を送信しない', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo()).mockRejectedValueOnce(new PhotoError('unreadable'))
    mount(); pick()
    await screen.findByRole('img')
    pick('library-input')
    await screen.findByRole('alert')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この写真を送る' })).not.toBeInTheDocument()
  })

  it('終端失敗はエラーとして表示し、自動で再認識しない', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockResolvedValueOnce(materialRecognitionResponseFixtures.timeout)
    mount(); pick()
    fireEvent.click(await screen.findByRole('button', { name: 'この写真を送る' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('時間がかかりました')
    expect(screen.queryByRole('heading', { name: 'AIが見つけた材料の候補' })).not.toBeInTheDocument()
    expect(mocks.recognizeMaterials).toHaveBeenCalledTimes(1)
  })

  it('候補は追加操作をするまで材料リストへ入れず、追加後は結果を伝える（#11）', async () => {
    const onAddCandidates = vi.fn().mockResolvedValue({ added: 1, duplicates: 0, overflow: 0 })
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockResolvedValueOnce(output)
    mount(snapshot.craft.ownerUid, { onAddCandidates }); pick()
    fireEvent.click(await screen.findByRole('button', { name: 'この写真を送る' }))
    await screen.findByRole('button', { name: '候補を材料リストに追加' })
    expect(onAddCandidates).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '候補を材料リストに追加' }))
    expect(await screen.findByText('1件を材料リストに追加しました。')).toBeInTheDocument()
    expect(onAddCandidates).toHaveBeenCalledWith(output.result.items)
    expect(screen.queryByRole('button', { name: '候補を材料リストに追加' })).not.toBeInTheDocument()
  })

  it('認識失敗では再試行でき、候補の追加をしない', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockResolvedValueOnce(materialRecognitionResponseFixtures.timeout)
    mount(snapshot.craft.ownerUid, { onAddCandidates: vi.fn() }); pick()
    fireEvent.click(await screen.findByRole('button', { name: 'この写真を送る' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('時間がかかりました')
    expect(screen.queryByRole('button', { name: '候補を材料リストに追加' })).not.toBeInTheDocument()
  })
})

// #19（日英対応）: 写真なし・認識失敗・候補0件の案内を英語でも確認する。
describe('材料写真の英語表示（#9/#11）', () => {
  const japanese = /[぀-ヿ一-龯]/
  beforeEach(async () => { await i18n.changeLanguage('en') })

  it('写真なし: 撮影・選択の操作を英語で表示する', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(japanese)
  })

  it('認識失敗: 英語の理由を出し、英語のlocaleで認識を頼む', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockResolvedValueOnce(materialRecognitionResponseFixtures.timeout)
    mount(snapshot.craft.ownerUid, { onAddCandidates: vi.fn() }); pick()
    fireEvent.click(await screen.findByRole('button', { name: 'Send this photo' }))
    expect(await screen.findByText(/Recognition took too long/)).toBeInTheDocument()
    expect(mocks.recognizeMaterials.mock.calls[0]?.[0]).toMatchObject({ locale: 'en' })
    expect(document.body.textContent).not.toMatch(japanese)
  })

  it('候補0件: 英語で撮り直しと手入力を案内する', async () => {
    mocks.preparePhoto.mockResolvedValueOnce(photo())
    mocks.recognizeMaterials.mockResolvedValueOnce({ ...output, result: { items: [], warnings: [] } })
    mount(); pick()
    fireEvent.click(await screen.findByRole('button', { name: 'Send this photo' }))
    expect(await screen.findByText(/No materials were found/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try another photo' }))
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeInTheDocument()
  })
})
