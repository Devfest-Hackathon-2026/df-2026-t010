// @vitest-environment happy-dom
import '../../test/setup'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildGeneratedProjects, createProductionDocument, craftFixture, demoProjectIdeas, GatewayError } from '@rekt/shared'
import type { CandidatesDocument, CraftSnapshot, MaterialsDocument } from '@rekt/shared'
import i18n from '../../i18n'
import { CraftContext } from '../../app/CraftContext'
import type { CraftGateway } from '../../data/contracts'
import ProjectsPage from './ProjectsPage'
const mocks = vi.hoisted(() => ({ materials: null as MaterialsDocument | null, candidates: null as CandidatesDocument | null, error: null as GatewayError | null,
  generate: vi.fn(), translate: vi.fn(), start: vi.fn(), apply: vi.fn(), edit: vi.fn(), listener: null as ((document: CandidatesDocument | null) => void) | null,
}))
vi.mock('../../data', () => ({
  getMaterialsGateway: async () => ({ editMaterials: mocks.edit, subscribeToMaterials: (_id: string, next: (document: MaterialsDocument | null) => void) => { queueMicrotask(() => next(mocks.materials)); return () => {} } }),
  getExperienceGateway: async () => ({ startCraft: mocks.start }),
  getProjectsGateway: async () => ({ listTemplates: async () => [], generateProjects: mocks.generate, translateProjects: mocks.translate,
    subscribeToCandidates: (_id: string, next: (document: CandidatesDocument | null) => void, error: (cause: GatewayError) => void) => { mocks.listener = next; queueMicrotask(() => { if (mocks.error) error(mocks.error); else next(mocks.candidates) }); return () => {} },
  }),
}))
const at = '2026-11-06T01:00:00.000Z'; const craft = craftFixture()
const selecting: CraftSnapshot = { ...craft, craft: { ...craft.craft, status: 'project_selection', revision: 2 } }
const materials: MaterialsDocument = { schemaVersion: 2, revision: 3, tools: [], checks: [], updatedAt: at, confirmedAt: at, items: [{ id: 'paper', name: '紙', quantity: 2, unit: '枚', source: 'manual', confidence: null }] }
const generated = () => buildGeneratedProjects(demoProjectIdeas(materials), materials, at, 'fixture')
beforeEach(async () => {
  sessionStorage.clear(); mocks.materials = materials; mocks.candidates = generated(); mocks.error = null; mocks.listener = null
  mocks.edit.mockReset(); mocks.start.mockReset(); mocks.apply.mockReset(); mocks.translate.mockReset().mockResolvedValue(undefined); mocks.generate.mockReset().mockImplementation(async () => { const result = generated(); mocks.listener?.(result); return result })
  await i18n.changeLanguage('ja')
})
function mount() { return render(<MemoryRouter><CraftContext.Provider value={{ snapshot: selecting, uid: craft.craft.ownerUid, gateway: {} as CraftGateway, applySnapshot: mocks.apply }}><ProjectsPage /></CraftContext.Provider></MemoryRouter>) }
describe('AIが材料から考えた3案', () => {
  it('公開作品が未登録でも3件の案・時間・難しさを表示する', async () => {
    mount()
    expect(await screen.findByRole('listitem', { name: '紙のロボット' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByText('約15分')).toBeInTheDocument()
    expect(screen.getAllByText('かんたん')).toHaveLength(3)
    expect(screen.getByText('サンプル')).toBeInTheDocument()
  })
  it('選択後に材料を確認し、二重確認せず制作を開始する', async () => {
    const template = generated().templates![0]!
    mocks.start.mockResolvedValue({ ...selecting, craft: { ...selecting.craft, status: 'crafting', selectedTemplateId: template.id, revision: 3 }, production: createProductionDocument(template, 3, at) })
    mount(); fireEvent.click(await screen.findAllByRole('radio').then((radios) => radios[0]!))
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(screen.getAllByText('紙').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'つくりはじめる' }))
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument()
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ craftId: craft.craft.id, templateId: template.id, materialRevision: 3 })))
    expect(mocks.apply).toHaveBeenCalledTimes(1)
  })
  it('開始中は開始・材料編集・戻るを重ねて押せない', async () => {
    mocks.start.mockReturnValue(new Promise(() => {}))
    mount(); fireEvent.click((await screen.findAllByRole('radio'))[0]!)
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: 'つくりはじめる' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'つくりはじめる' })).toBeDisabled())
    expect(screen.getByRole('button', { name: '材料を修正する' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '前に戻る' })).toBeDisabled()
    expect(mocks.start).toHaveBeenCalledTimes(1)
  })
  it('開始結果が不明でも確認画面に残り、同じ操作IDで再試行できる', async () => {
    mocks.start.mockRejectedValue(new GatewayError('TEMPORARILY_UNAVAILABLE'))
    mount(); fireEvent.click((await screen.findAllByRole('radio'))[0]!)
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    fireEvent.click(screen.getByRole('button', { name: 'つくりはじめる' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'つくりはじめる' }))
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2))
    expect(mocks.start.mock.calls[1]?.[0]).toEqual(mocks.start.mock.calls[0]?.[0])
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it('ブラウザー保存領域を読めなくても制作を開始できる', async () => {
    const template = generated().templates![0]!
    const started = { ...selecting, craft: { ...selecting.craft, status: 'crafting', selectedTemplateId: template.id }, production: createProductionDocument(template, 3, at) }
    mocks.start.mockResolvedValue(started)
    const storage = sessionStorage
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new DOMException('Storage unavailable', 'SecurityError') },
      setItem: storage.setItem.bind(storage),
      removeItem: storage.removeItem.bind(storage),
    })
    try {
      mount()
      fireEvent.click((await screen.findAllByRole('radio'))[0]!)
      fireEvent.click(screen.getByRole('button', { name: '次へ' }))
      fireEvent.click(screen.getByRole('button', { name: 'つくりはじめる' }))
      await vi.waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(started))
      expect(mocks.start).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('古い版や候補なしの場合、3案を新しく生成してから表示する', async () => {
    mocks.candidates = { ...generated(), materialRevision: 2 }
    mount()
    await screen.findByRole('listitem', { name: '紙のロボット' })
    expect(mocks.generate).toHaveBeenCalledWith({ craftId: craft.craft.id, materialRevision: 3, locale: 'ja' })
  })
  it('生成失敗では古い候補を出さず、再試行で3案を表示する', async () => {
    mocks.candidates = null; mocks.generate.mockRejectedValueOnce(new GatewayError('AI_UNAVAILABLE'))
    mount()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    expect(await screen.findAllByRole('radio')).toHaveLength(3)
    expect(mocks.generate).toHaveBeenLastCalledWith({ craftId: craft.craft.id, materialRevision: 3, locale: 'ja', retry: true })
  })
  it('保存済みの危険な案を隠し、本人が操作した場合だけ再生成する', async () => {
    const cached = generated()
    cached.templates![0]!.steps[0]!.instructions.en = 'Use a utility knife.'
    mocks.candidates = { ...cached, source: 'ai' }
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('errors.AI_UNSAFE_PROJECT'))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(mocks.generate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    expect(await screen.findAllByRole('radio')).toHaveLength(3)
    expect(mocks.generate).toHaveBeenCalledExactlyOnceWith({ craftId: craft.craft.id, materialRevision: 3, locale: 'ja', retry: true })
  })
  it('材料の修正は確認してから既存APIへ渡す', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: '材料を修正する' }))
    fireEvent.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: '材料を修正する', hidden: true }))
    await vi.waitFor(() => expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3, items: materials.items, tools: [] })))
  })
  it('購読エラーでは理由と再試行を示す', async () => {
    mocks.error = new GatewayError('NOT_CRAFT_OWNER'); mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('権限がありません')
  })
  it('英語でも同じ3案を選べる', async () => {
    await i18n.changeLanguage('en'); mount()
    expect(await screen.findByRole('listitem', { name: 'Upcycled robot' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByText('About 15 min')).toBeInTheDocument()
  })
  it('未翻訳の言語へ切り替えると同じ案を翻訳し、選択を保って再利用する', async () => {
    const bilingual = generated()
    const source = demoProjectIdeas(materials)
    const monolingual = buildGeneratedProjects({ ideas: source.ideas.map((idea) => ({ ...idea, title: idea.title.ja, description: idea.description.ja,
      steps: idea.steps.map((step) => ({ title: step.title.ja, instructions: step.instructions.ja })),
    })) }, materials, at, 'fixture', 'ja')
    mocks.candidates = monolingual
    mocks.translate.mockImplementation(async () => mocks.listener?.({ ...monolingual, templates: bilingual.templates!.map((template, n) => ({ ...template, id: monolingual.templates![n]!.id })) }))
    mount()
    fireEvent.click(await screen.findByRole('radio', { name: monolingual.templates![0]!.title.ja }))
    expect(mocks.translate).not.toHaveBeenCalled()
    await act(async () => { await i18n.changeLanguage('en') })
    expect(await screen.findByRole('radio', { name: bilingual.templates![0]!.title.en })).toBeChecked()
    await act(async () => { await i18n.changeLanguage('ja'); await i18n.changeLanguage('en') })
    expect(mocks.translate).toHaveBeenCalledExactlyOnceWith({ craftId: craft.craft.id, materialRevision: 3, locale: 'en' })
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('作品名で選択を区別し、言語切替後も選んだ作品を保つ', async () => {
    const templates = generated().templates!
    mount()
    fireEvent.click(await screen.findByRole('radio', { name: templates[1]!.title.ja }))
    expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled()
    for (const template of templates) expect(screen.getByRole('radio', { name: template.title.ja })).toBeInTheDocument()
    await act(async () => { await i18n.changeLanguage('en') })
    for (const template of templates) expect(screen.getByRole('radio', { name: template.title.en })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: templates[1]!.title.en })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })
})
