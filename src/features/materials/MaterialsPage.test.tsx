// @vitest-environment happy-dom
import '../../test/setup'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GatewayError, craftFixture, templateFixture } from '@rekt/shared'
import type { MaterialsDocument, CraftSnapshot, Template } from '@rekt/shared'
import i18n from '../../i18n'
import { CraftContext } from '../../app/CraftContext'
import type { CraftGateway } from '../../data/contracts'
import MaterialsPage from './MaterialsPage'
import ProjectsPage from '../projects/ProjectsPage'

const mocks = vi.hoisted(() => ({ editMaterials: vi.fn(), confirmMaterials: vi.fn(), document: null as MaterialsDocument | null, listener: null as ((document: MaterialsDocument | null) => void) | null, subscribeErrors: [] as GatewayError[], templates: [] as Template[], listTemplates: vi.fn() }))
vi.mock('../../data', () => ({
  getMaterialsGateway: async () => ({
    editMaterials: mocks.editMaterials, confirmMaterials: mocks.confirmMaterials,
    subscribeToMaterials: (_craftId: string, next: (document: MaterialsDocument | null) => void, error: (error: GatewayError) => void) => {
      mocks.listener = next
      // subscribeErrorsに積んだエラーを購読ごとに1つずつ返す（再試行の確認用）。
      const failure = mocks.subscribeErrors.shift()
      queueMicrotask(() => { if (failure) error(failure); else next(mocks.document) })
      return () => {}
    },
  }),
  // 材料画面が旧カタログの質問を読み込まないことも確認する。
  getProjectsGateway: async () => ({ listTemplates: mocks.listTemplates, subscribeToCandidates: (_craftId: string, next: (document: null) => void) => { queueMicrotask(() => next(null)); return () => {} } }),
}))

const craft = craftFixture()
const at = '2026-11-05T01:00:00.000Z'
const doc = (patch: Partial<MaterialsDocument> = {}): MaterialsDocument => ({
  schemaVersion: 2, revision: 3, tools: ['はさみ'], checks: [], updatedAt: at, confirmedAt: null,
  items: [{ id: 'ai-req-1', name: '段ボール', quantity: 2, unit: '枚', source: 'ai', confidence: 0.8 }], ...patch,
})

beforeEach(async () => {
  sessionStorage.clear(); mocks.document = doc(); mocks.listener = null; mocks.subscribeErrors = []; mocks.templates = []
  mocks.listTemplates.mockReset().mockImplementation(async () => mocks.templates)
  mocks.editMaterials.mockReset().mockResolvedValue(undefined); mocks.confirmMaterials.mockReset().mockResolvedValue(undefined)
  await i18n.changeLanguage('ja')
})
function mount(page: 'materials' | 'projects' = 'materials', uid = craft.craft.ownerUid, snapshot: CraftSnapshot = craft) {
  return render(<CraftContext.Provider value={{ snapshot, uid, gateway: {} as CraftGateway, applySnapshot: () => {} }}>{page === 'materials' ? <MaterialsPage /> : <ProjectsPage />}</CraftContext.Provider>)
}

describe('材料の確認・修正・確定（#11）', () => {
  it('保存の応答だけ失われた場合も、購読済みの同じ内容を再度上書きしない', async () => {
    mocks.editMaterials.mockImplementationOnce(async () => {
      mocks.listener?.(doc({ revision: 4, items: [{ ...doc().items[0]!, quantity: 5, source: 'manual', confidence: null }] }))
      throw new GatewayError('TEMPORARILY_UNAVAILABLE')
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '段ボールを編集' }))
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(screen.queryByLabelText('数量')).not.toBeInTheDocument())
    expect(mocks.editMaterials).toHaveBeenCalledTimes(1)
  })
  it('編集中に同じ行を別のタブが変更したら、古い入力で上書きしない', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '段ボールを編集' }))
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '5' } })
    await act(async () => mocks.listener?.(doc({ revision: 4, items: [{ ...doc().items[0]!, quantity: 9, source: 'manual', confidence: null }] })))
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('内容が更新されています')
    expect(mocks.editMaterials).not.toHaveBeenCalled()
    expect(screen.getByLabelText('数量')).toHaveValue('5')
  })

  it('他の行の追加は残し、変わっていない編集中の行だけ最新revisionで保存する', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '段ボールを編集' }))
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '5' } })
    const added = { ...doc().items[0]!, id: 'manual-other', name: '紙コップ', source: 'manual' as const, confidence: null }
    await act(async () => mocks.listener?.(doc({ revision: 4, items: [...doc().items, added] })))
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(mocks.editMaterials).toHaveBeenCalledTimes(1))
    expect(mocks.editMaterials.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: 4, items: [{ ...doc().items[0], quantity: 5, source: 'manual', confidence: null }, added] })
  })

  it('編集中の行を別のタブが削除しても、キャンセルして一覧操作へ戻れる', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '段ボールを編集' }))
    await act(async () => mocks.listener?.(doc({ revision: 4, items: [] })))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cancelEdit') }))
    expect(screen.getByRole('button', { name: '材料を追加する' })).toBeEnabled()
    expect(mocks.editMaterials).not.toHaveBeenCalled()
  })

  it('材料フォームの未保存入力がある間は本人も確定できない', async () => {
    mount('materials', craft.craft.ownerUid)
    fireEvent.click(await screen.findByRole('button', { name: '段ボールを編集' }))
    expect(screen.getByRole('button', { name: 'この材料で確定する' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cancelEdit') }))
    expect(screen.getByRole('button', { name: 'この材料で確定する' })).toBeEnabled()
  })

  it('未追加の工具名は保存かキャンセルしてから確定する', async () => {
    mount('materials', craft.craft.ownerUid)
    fireEvent.change(await screen.findByLabelText(i18n.t('otherTool')), { target: { value: '定規' } })
    expect(screen.getByRole('button', { name: 'この材料で確定する' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cancelEdit') }))
    expect(screen.getByRole('button', { name: 'この材料で確定する' })).toBeEnabled()
  })

  it('確定のクリック後に新しい材料版を受け取っても、選んだ版で一度だけ送る', async () => {
    let finish!: () => void
    mocks.confirmMaterials.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
    mount('materials', craft.craft.ownerUid)
    const confirm = await screen.findByRole('button', { name: 'この材料で確定する' })
    fireEvent.click(confirm)
    await act(async () => mocks.listener?.(doc({ revision: 4, items: [{ ...doc().items[0]!, quantity: 9 }] })))
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(mocks.confirmMaterials).toHaveBeenCalledTimes(1)
    expect(mocks.confirmMaterials.mock.calls[0]?.[0].expectedRevision).toBe(3)
    await act(async () => finish())
  })
  it('本人が数量を直せ、AI候補を人が直したことを記録して保存する', async () => {
    mount()
    await screen.findByRole('button', { name: '段ボールを編集' })
    fireEvent.click(screen.getByRole('button', { name: '段ボールを編集' }))
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(mocks.editMaterials).toHaveBeenCalledTimes(1))
    expect(mocks.editMaterials.mock.calls[0]?.[0]).toMatchObject({
      craftId: craft.craft.id, expectedRevision: 3, tools: ['はさみ'],
      items: [{ id: 'ai-req-1', name: '段ボール', quantity: 5, unit: '枚', source: 'manual', confidence: null }],
    })
    expect(screen.getByRole('button', { name: 'この材料で確定する' })).toBeInTheDocument()
  })

  it('不正な入力は項目ごとに理由を出し、保存しない', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '材料を追加する' }))
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    expect(screen.getByText('材料の名前を1〜80文字で入力してください。')).toBeInTheDocument()
    expect(screen.getByText(/0より大きく/)).toBeInTheDocument()
    expect(mocks.editMaterials).not.toHaveBeenCalled()
  })

  it('手入力の材料を追加できる', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '材料を追加する' }))
    fireEvent.change(screen.getByLabelText('材料の名前'), { target: { value: 'ストロー' } })
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText(/^単位/), { target: { value: '本' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(mocks.editMaterials).toHaveBeenCalledTimes(1))
    const items = mocks.editMaterials.mock.calls[0]?.[0].items
    expect(items[1]).toMatchObject({ name: 'ストロー', quantity: 10, unit: '本', source: 'manual', confidence: null })
    expect(items[1].id).toMatch(/^manual-/)
  })

  it('工具の所持チェックを保存する', async () => {
    mount()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'スティックのり' }))
    await waitFor(() => expect(mocks.editMaterials).toHaveBeenCalledTimes(1))
    expect(mocks.editMaterials.mock.calls[0]?.[0].tools).toEqual(['はさみ', 'スティックのり'])
  })

  it('ブラウザー保存領域の容量不足でも材料の数量を保存できる', async () => {
    const storage = sessionStorage
    vi.stubGlobal('sessionStorage', {
      getItem: storage.getItem.bind(storage),
      setItem: () => { throw new DOMException('Storage unavailable', 'QuotaExceededError') },
      removeItem: storage.removeItem.bind(storage),
    })
    try {
      mount()
      fireEvent.click(await screen.findByRole('button', { name: '段ボールを編集' }))
      fireEvent.change(screen.getByLabelText('数量'), { target: { value: '8' } })
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
      await waitFor(() => expect(screen.queryByLabelText('数量')).not.toBeInTheDocument())
      expect(mocks.editMaterials).toHaveBeenCalledWith(expect.objectContaining({
        items: [expect.objectContaining({ id: 'ai-req-1', quantity: 8 })],
      }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('別のタブと競合したら理由を表示する', async () => {
    mocks.editMaterials.mockRejectedValueOnce(new GatewayError('STALE_REVISION'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '段ボールを削除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('内容が更新されています')
  })

  it('本人は材料一覧から直接確定でき、通信失敗時は同じ操作IDで再試行できる', async () => {
    mocks.confirmMaterials.mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE'))
    mount('materials', craft.craft.ownerUid)
    fireEvent.click(await screen.findByRole('button', { name: 'この材料で確定する' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument()
    expect(mocks.confirmMaterials.mock.calls[0]?.[0]).toMatchObject({ craftId: craft.craft.id, expectedRevision: 3 })
    fireEvent.click(screen.getByRole('button', { name: 'この材料で確定する' }))
    await waitFor(() => expect(mocks.confirmMaterials).toHaveBeenCalledTimes(2))
    expect(mocks.confirmMaterials.mock.calls[1]?.[0]).toEqual(mocks.confirmMaterials.mock.calls[0]?.[0])
  })

  it('材料が空なら本人も確定できず、手入力を案内する', async () => {
    mocks.document = null
    mount('materials', craft.craft.ownerUid)
    expect(await screen.findByText(/まだ材料がありません/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この材料で確定する' })).toBeDisabled()
  })
})

describe('確定済みの表示（#11）', () => {
  const selecting: CraftSnapshot = { ...craft, craft: { ...craft.craft, status: 'project_selection', revision: craft.craft.revision + 1 } }

  it('本人に確定済みの材料・工具を表示し、その場では編集させない', async () => {
    mocks.document = doc({ confirmedAt: at })
    mount('projects', craft.craft.ownerUid, selecting)
    await screen.findByText('段ボール')
    expect(screen.getByText('段ボール')).toBeInTheDocument()
    expect(screen.getByText('はさみ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '段ボールを編集' })).not.toBeInTheDocument()
  })

  it('作品決定前の修正は確認のうえ、同じ内容で編集して材料確認へ戻す', async () => {
    mocks.document = doc({ confirmedAt: at })
    mount('projects', craft.craft.ownerUid, selecting)
    fireEvent.click(await screen.findByRole('button', { name: '材料を修正する' }))
    fireEvent.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: '材料を修正する', hidden: true }))
    await waitFor(() => expect(mocks.editMaterials).toHaveBeenCalledTimes(1))
    expect(mocks.editMaterials.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: 3, items: doc().items, tools: ['はさみ'] })
  })
})

// #19（日英対応）・#23/#40（共通UI・通信フィードバック）を材料画面で確認する。
describe('英語表示（#11）', () => {
  // 利用者が入力した材料名以外に、日本語の文言が残っていないこと。
  const japanese = /[぀-ヿ一-龯]/
  const english = (patch: Partial<MaterialsDocument> = {}) => doc({ tools: ['Scissors'], items: [{ id: 'ai-req-1', name: 'Cardboard', quantity: 2, unit: 'sheets', source: 'ai', confidence: 0.8 }], ...patch })
  beforeEach(async () => { mocks.document = english(); await i18n.changeLanguage('en') })

  it('通常: 材料・工具・確定操作を英語で表示する', async () => {
    mount()
    expect(await screen.findByRole('button', { name: 'Edit Cardboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Cardboard' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Scissors' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Confirm these materials' })).toBeEnabled()
    expect(document.body.textContent).not.toMatch(japanese)
  })

  it('処理中: 読み込み中を英語で表示する', () => {
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  })

  it('空: 材料がないときは手入力を英語で案内し、確定できない', async () => {
    mocks.document = null
    mount()
    expect(await screen.findByText(/No materials yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm these materials' })).toBeDisabled()
    expect(document.body.textContent).not.toMatch(japanese)
  })

  it('入力エラー: 項目ごとの理由を英語で表示する', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a material' }))
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Enter a material name of 1–80 characters.')).toBeInTheDocument()
    expect(screen.getByText('Enter a number greater than 0 and up to 10000.')).toBeInTheDocument()
    expect(mocks.editMaterials).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(japanese)
  })

  it('通信結果不明: 理由を英語で表示し、再送は同じ操作IDを使う', async () => {
    mocks.editMaterials.mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Cardboard' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't connect. Check your connection and try again.")
    fireEvent.click(screen.getByRole('button', { name: 'Remove Cardboard' }))
    await waitFor(() => expect(mocks.editMaterials).toHaveBeenCalledTimes(2))
    expect(mocks.editMaterials.mock.calls[1]?.[0].requestId).toBe(mocks.editMaterials.mock.calls[0]?.[0].requestId)
  })

  it('再試行: 読み込みに失敗したら英語の理由と再試行を出し、押すと読み込み直す', async () => {
    mocks.subscribeErrors = [new GatewayError('TEMPORARILY_UNAVAILABLE')]
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't connect.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Edit Cardboard' })).toBeInTheDocument()
  })

  it('確定ダイアログと確定済み表示も英語で表示する', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm these materials' }))
    expect(document.body.textContent).not.toMatch(japanese)
    mocks.document = english({ confirmedAt: at })
    const selecting: CraftSnapshot = { ...craft, craft: { ...craft.craft, status: 'project_selection', revision: craft.craft.revision + 1 } }
    mount('projects', craft.craft.ownerUid, selecting)
    expect(await screen.findByRole('button', { name: 'Fix materials' })).toBeInTheDocument()
  })
})

describe('AIの3案で不要になったカタログ質問', () => {
  it.each(['ja', 'en'])('旧作品があっても質問を読み込まず、材料を編集できる（%s）', async (language) => {
    mocks.templates = [templateFixture]
    await i18n.changeLanguage(language)
    mount()
    await screen.findByRole('button', { name: i18n.t('editMaterialNamed', { name: '段ボール' }) })
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(mocks.listTemplates).not.toHaveBeenCalled()
  })
  it('工具を変えたときも、旧質問の回答を推測・再送しない', async () => {
    mocks.document = doc({ checks: [{ id: 'dry', confirmed: true }] })
    mount()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'スティックのり' }))
    await waitFor(() => expect(mocks.editMaterials).toHaveBeenCalledTimes(1))
    expect(mocks.editMaterials.mock.calls[0]?.[0].checks).toEqual([])
  })
})

describe('下書きと削除取り消し', () => {
  async function addDraft() {
    fireEvent.click(await screen.findByRole('button', { name: '材料を追加する' }))
    fireEvent.change(screen.getByLabelText('材料の名前'), { target: { value: '段ボール' } })
    fireEvent.change(screen.getByLabelText(/^単位/), { target: { value: '枚' } })
  }

  it('保存の応答を失っても購読に届いた同じIDを認識し、同名の別材料と区別する', async () => {
    mocks.editMaterials.mockImplementationOnce(async (input) => {
      mocks.listener?.(doc({ items: input.items, revision: 4 }))
      throw new GatewayError('TEMPORARILY_UNAVAILABLE')
    })
    mount()
    await addDraft()
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(screen.queryByLabelText('材料の名前')).not.toBeInTheDocument())
    expect(mocks.editMaterials).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('button', { name: '段ボールを編集' })).toHaveLength(2)
  })

  it('購読より先に再表示しても、追加時のrequestIdと材料版をそのまま再送する', async () => {
    mocks.editMaterials.mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE'))
    const first = mount()
    await addDraft()
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await screen.findByRole('alert')
    first.unmount()
    mocks.document = doc({ revision: 4, tools: ['はさみ', '定規'] })
    mount()
    expect(await screen.findByLabelText('材料の名前')).toHaveAttribute('readonly')
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(screen.queryByLabelText('材料の名前')).not.toBeInTheDocument())
    expect(mocks.editMaterials).toHaveBeenCalledTimes(2)
    expect(mocks.editMaterials.mock.calls[1]?.[0]).toEqual(mocks.editMaterials.mock.calls[0]?.[0])
  })

  it('未保存と分かった古い版は新しい版で追加し直し、別タブの材料と工具を残す', async () => {
    mocks.editMaterials.mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE')).mockRejectedValueOnce(new GatewayError('STALE_REVISION'))
    mount()
    await addDraft()
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await screen.findByRole('alert')
    const other = { ...doc().items[0]!, id: 'manual-other', name: '紙コップ' }
    await act(async () => mocks.listener?.(doc({ revision: 5, items: [other], tools: ['定規'] })))
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('内容が更新されています')
    expect(screen.getByLabelText('材料の名前')).not.toHaveAttribute('readonly')
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(screen.queryByLabelText('材料の名前')).not.toBeInTheDocument())
    const [initial, replay, rebased] = mocks.editMaterials.mock.calls.map(([input]) => input)
    expect(replay).toEqual(initial)
    expect(rebased).toMatchObject({ expectedRevision: 5, tools: ['定規'], items: [other, initial.items[1]] })
    expect(rebased.requestId).not.toBe(initial.requestId)
  })

  it('追加を取りやめて同じ材料を入力し直した場合は別の材料IDで保存する', async () => {
    mocks.editMaterials.mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE'))
    mount()
    await addDraft()
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cancelEdit') }))
    await addDraft()
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(screen.queryByLabelText('材料の名前')).not.toBeInTheDocument())
    const [first, second] = mocks.editMaterials.mock.calls.map(([input]) => input)
    expect(second.requestId).not.toBe(first.requestId)
    expect(second.items[1].id).not.toBe(first.items[1].id)
  })

  it('材料リストに戻ると工具の入力欄を開いて復元し、未追加のまま確定させない', async () => {
    const renderReview = (snapshot = craft) => render(<CraftContext.Provider value={{ snapshot, uid: snapshot.craft.ownerUid, gateway: {} as CraftGateway, applySnapshot: () => {} }}><MaterialsPage compact /></CraftContext.Provider>)
    const first = renderReview()
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('flow.editTools') }))
    fireEvent.change(screen.getByLabelText(i18n.t('otherTool')), { target: { value: 'ピンセット' } })
    first.unmount()
    const other = renderReview({ ...craft, craft: { ...craft.craft, id: 'other-craft' } })
    expect(await screen.findByRole('button', { name: 'この材料で確定する' })).toBeEnabled()
    expect(screen.queryByLabelText(i18n.t('otherTool'))).not.toBeInTheDocument()
    other.unmount()
    mocks.document = doc({ revision: 5, tools: ['定規'] })
    renderReview()
    expect(await screen.findByLabelText(i18n.t('otherTool'))).toHaveValue('ピンセット')
    expect(screen.getByRole('button', { name: 'この材料で確定する' })).toBeDisabled()
    expect(mocks.editMaterials).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('addTool') }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'この材料で確定する' })).toBeEnabled())
    expect(mocks.editMaterials.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: 5, tools: ['定規', 'ピンセット'] })
  })

  it('画面を離れて戻っても未保存入力を復元し、キャンセルで消す', async () => {
    const first = mount()
    fireEvent.click(await screen.findByRole('button', { name: '材料を追加する' }))
    fireEvent.change(screen.getByLabelText('材料の名前'), { target: { value: '下書きの紙' } })
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '２.５' } })
    fireEvent.change(screen.getByLabelText(/^単位/), { target: { value: '枚' } })
    first.unmount()
    const restored = mount()
    expect(await screen.findByLabelText('材料の名前')).toHaveValue('下書きの紙')
    expect(screen.getByLabelText('数量')).toHaveValue('２.５')
    expect(screen.getByRole('button', { name: 'この材料で確定する' })).toBeDisabled()
    expect(mocks.editMaterials).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('cancelEdit') }))
    restored.unmount(); mount()
    await screen.findByRole('button', { name: '材料を追加する' })
    expect(screen.queryByLabelText('材料の名前')).not.toBeInTheDocument()
  })
  it('復元した編集内容も、別タブで変更された元データを上書きしない', async () => {
    const first = mount()
    fireEvent.click(await screen.findByRole('button', { name: '段ボールを編集' }))
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '7' } })
    first.unmount(); mocks.document = doc({ revision: 4, items: [{ ...doc().items[0]!, quantity: 9 }] })
    mount(); fireEvent.click(await screen.findByRole('button', { name: '保存する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('内容が更新されています')
    expect(screen.getByLabelText('数量')).toHaveValue('7')
    expect(mocks.editMaterials).not.toHaveBeenCalled()
  })
  it('削除後に増えた材料と工具を残し、最新revisionで1件だけ元に戻す', async () => {
    mocks.editMaterials.mockImplementation(async (input) => { mocks.document = doc({ ...input, revision: input.expectedRevision + 1 }); mocks.listener?.(mocks.document) })
    mount(); fireEvent.click(await screen.findByRole('button', { name: '段ボールを削除' }))
    const undo = await screen.findByRole('button', { name: '段ボールの削除を元に戻す' })
    await waitFor(() => expect(undo).toBeEnabled())
    const other = { ...doc().items[0]!, id: 'manual-other', name: 'ストロー', source: 'manual' as const }
    await act(async () => mocks.listener?.(doc({ revision: 5, items: [other], tools: ['定規'] })))
    fireEvent.click(undo)
    await waitFor(() => expect(mocks.editMaterials).toHaveBeenCalledTimes(2))
    expect(mocks.editMaterials.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 5, tools: ['定規'], items: [doc().items[0], other] })
    await waitFor(() => expect(screen.queryByRole('button', { name: '段ボールの削除を元に戻す' })).not.toBeInTheDocument())
  })
  it('取り消しに失敗しても同じ操作IDで再試行できる', async () => {
    mocks.editMaterials.mockImplementationOnce(async (input) => { mocks.listener?.(doc({ ...input, revision: 4 })) }).mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE')).mockResolvedValue(undefined)
    mount(); fireEvent.click(await screen.findByRole('button', { name: '段ボールを削除' }))
    const undo = await screen.findByRole('button', { name: '段ボールの削除を元に戻す' })
    await waitFor(() => expect(undo).toBeEnabled()); fireEvent.click(undo)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '段ボールの削除を元に戻す' }))
    await waitFor(() => expect(mocks.editMaterials).toHaveBeenCalledTimes(3))
    expect(mocks.editMaterials.mock.calls[2]?.[0]).toEqual(mocks.editMaterials.mock.calls[1]?.[0])
  })
  it('同じIDの材料が別タブで変わっていたら取り消しで上書きしない', async () => {
    mocks.editMaterials.mockImplementationOnce(async (input) => { mocks.listener?.(doc({ ...input, revision: 4 })) })
    mount(); fireEvent.click(await screen.findByRole('button', { name: '段ボールを削除' }))
    const undo = await screen.findByRole('button', { name: '段ボールの削除を元に戻す' })
    await waitFor(() => expect(undo).toBeEnabled())
    await act(async () => mocks.listener?.(doc({ revision: 5, items: [{ ...doc().items[0]!, quantity: 8 }] })))
    fireEvent.click(undo)
    expect(await screen.findByRole('alert')).toHaveTextContent('内容が更新されています')
    expect(mocks.editMaterials).toHaveBeenCalledTimes(1)
  })
})
