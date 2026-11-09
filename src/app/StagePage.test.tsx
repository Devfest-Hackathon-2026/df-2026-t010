// @vitest-environment happy-dom
import '../test/setup'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { productionSnapshots } from '@rekt/shared'
import type { ProductionDocument } from '@rekt/shared'
import i18n from '../i18n'
import { CraftContext } from './CraftContext'
import type { CraftGateway } from '../data/contracts'
import StagePage from './StagePage'

const mocks = vi.hoisted(() => ({ listener: null as ((document: ProductionDocument | null) => void) | null, completeStep: vi.fn() }))
vi.mock('../data', () => ({ getExperienceGateway: async () => ({
  subscribeToProduction: (_id: string, next: (document: ProductionDocument | null) => void) => { mocks.listener = next; queueMicrotask(() => next(productionSnapshots.started.production)); return () => {} },
  completeStep: mocks.completeStep,
}) }))

const { started, firstStepCompleted, allStepsCompleted } = productionSnapshots
beforeEach(async () => { sessionStorage.clear(); mocks.listener = null; mocks.completeStep.mockReset(); await i18n.changeLanguage('ja'); window.scrollTo = vi.fn() })

describe('制作画面の保存・復帰（#17）', () => {
  it('制作開始の応答から、購読を待たずに最初の工程を表示する', async () => {
    render(<MemoryRouter><CraftContext.Provider value={{ snapshot: started, uid: started.craft.ownerUid, gateway: {} as CraftGateway, applySnapshot: () => {} }}><StagePage /></CraftContext.Provider></MemoryRouter>)
    expect(mocks.listener).toBeNull()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    await waitFor(() => expect(mocks.listener).not.toBeNull())
  })
  it('別タブ等で先に進んだ購読のあとに古い応答が届いても、進捗を巻き戻さない', async () => {
    let resolve: (value: typeof firstStepCompleted) => void = () => {}
    mocks.completeStep.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render(<MemoryRouter><CraftContext.Provider value={{ snapshot: { schemaVersion: 2, craft: started.craft }, uid: started.craft.ownerUid, gateway: {} as CraftGateway, applySnapshot: () => {} }}><StagePage /></CraftContext.Provider></MemoryRouter>)
    expect(await screen.findByText('1 / 2')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button').at(-1)!)
    act(() => mocks.listener?.(allStepsCompleted.production))
    await act(async () => { resolve(firstStepCompleted) })
    // 全工程完了の版が残る：2工程目も完了済みなので「次へ」が押せる（1工程目だけ完了の版へ戻らない）
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: i18n.t('flow.nextStep') })).toBeEnabled()
    expect(mocks.completeStep).toHaveBeenCalledTimes(1)
  })
})
