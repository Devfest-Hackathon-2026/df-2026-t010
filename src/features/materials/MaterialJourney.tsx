import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple'
import { useCraft } from '../../app/CraftContext'
import { Button } from '../../components/ui/Button'
import { JourneyProgress, ScreenTitle } from '../../components/ui/ScreenTitle'
import { ErrorNotice, LoadingNotice } from '../../components/feedback/Feedback'
import { useOperation } from '../../components/feedback/useOperation'
import { getMaterialsGateway } from '../../data'
import { materialsState, MAX_TOOLS, mergeCandidates } from './materialDraft'
import { useMaterials } from './useMaterials'
import { ToolChecklist } from './ToolChecklist'
import { MaterialsReview } from './MaterialsPage'
import MaterialPhotoSection from './MaterialPhotoSection'
import { ToolDraftSchema, ToolSelectionSchema, useMaterialSession } from './materialSession'
import type { Material } from '@rekt/shared'
import './materials.css'
type Step = 'tools' | 'photo' | 'review'

function ToolPreparation({ draftKey, tools, pending, save, next }: { draftKey: string; tools: string[]; pending: boolean; save: (tools: string[]) => Promise<boolean>; next: () => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useMaterialSession(draftKey, ToolDraftSchema)
  const [selection, setSelection] = useMaterialSession(`${draftKey}:selection`, ToolSelectionSchema)
  // Apply only the local selections that changed so saves from another tab stay intact.
  const selectedTools = selection ? [
    ...tools.filter((tool) => !selection.base.includes(tool) || selection.selected.includes(tool)),
    ...selection.selected.filter((tool) => !selection.base.includes(tool) && !tools.includes(tool)),
  ] : tools
  async function advance() {
    const changed = selectedTools.length !== tools.length || selectedTools.some((tool) => !tools.includes(tool))
    if (changed && !await save(selectedTools)) return
    setSelection(null)
    next()
  }
  return <>
    <ToolChecklist compact tools={selectedTools} pending={pending} onChange={async (selected) => { setSelection({ base: tools, selected }); return true }} draft={draft} onDraftChange={setDraft} />
    <div className="sticky-action">
      <Button className="wide" disabled={pending || !!draft?.trim() || selectedTools.length > MAX_TOOLS} onClick={() => { void advance() }}>{t(pending ? 'working' : 'flow.next')}<ArrowRightIcon size={22} /></Button>
    </div>
  </>
}

export default function MaterialJourney() {
  const { snapshot, uid } = useCraft(); const craftId = snapshot.craft.id; const { t } = useTranslation()
  const { state, retry } = useMaterials(craftId)
  const operation = useOperation()
  const [photoBusy, setPhotoBusy] = useState(false)
  const [step, setStep] = useState<Step>(() => {
    try { const saved = sessionStorage.getItem(`co-make:material-step:${craftId}`); if (saved === 'photo' || saved === 'review') return saved } catch { /* Use the first screen. */ }
    return 'tools'
  })
  function go(next: Step) { setStep(next); try { sessionStorage.setItem(`co-make:material-step:${craftId}`, next) } catch { /* Step remains in memory. */ } window.scrollTo(0, 0) }
  if (state.status === 'loading') return <LoadingNotice />
  if (state.status === 'error') return <ErrorNotice error={state.error} onRetry={retry} />
  const current = materialsState(state.document)
  const photoPending = photoBusy || operation.pending
  async function save(tools: string[], items = current.items) {
    const input = { craftId, expectedRevision: current.revision, items, tools, checks: [] }
    return await operation.run(`journeyMaterials:${craftId}`, input, async (requestId) => { await (await getMaterialsGateway()).editMaterials({ ...input, requestId }); return true }) === true
  }
  async function add(items: Material[]) {
    const merged = mergeCandidates(current.items, items)
    if (merged.added && !await save(current.tools, merged.items)) return undefined
    go('review'); return merged
  }
  return <div className="page material-journey"><JourneyProgress step={0} /><ScreenTitle backDisabled={step === 'photo' && photoPending} onBack={step === 'tools' ? undefined : () => go(step === 'photo' ? 'tools' : 'photo')}>{t(`flow.${step === 'tools' ? 'toolsTitle' : step === 'photo' ? 'photoTitle' : 'materialList'}`)}</ScreenTitle>
    {operation.error && <ErrorNotice error={operation.error} />}
    {step === 'tools' && <ToolPreparation draftKey={`co-make:material-editor:v1:${uid}:${craftId}:tool`} tools={current.tools} pending={operation.pending} save={save} next={() => go('photo')} />}
    {step === 'photo' && <>
      <MaterialPhotoSection screen adding={operation.pending} onAddCandidates={add} onBusyChange={setPhotoBusy} />
      <Button className="wide manual-entry" variant="secondary" disabled={photoPending} onClick={() => go('review')}><PencilSimpleIcon size={21} />{t('flow.enterManually')}</Button>
    </>}
    {step === 'review' && <><MaterialsReview document={state.document} compact /><Button className="wide" variant="quiet" onClick={() => go('photo')}>{t('flow.retakeMaterials')}</Button></>}
  </div>
}
