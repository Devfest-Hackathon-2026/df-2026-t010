import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import { GatewayError, isAllowedAiProject, LanguageSchema, pendingProjectLocale } from '@rekt/shared'
import { useCraft } from '../../app/CraftContext'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { JourneyProgress, ScreenTitle } from '../../components/ui/ScreenTitle'
import { CraftVisual } from '../../components/ui/CraftVisual'
import { ErrorNotice, LoadingNotice } from '../../components/feedback/Feedback'
import { useOperation } from '../../components/feedback/useOperation'
import { getExperienceGateway, getMaterialsGateway, getProjectsGateway } from '../../data'
import { MaterialSummary } from '../materials/MaterialList'
import { materialsState } from '../materials/materialDraft'
import { useMaterials } from '../materials/useMaterials'
import { CandidateList } from './CandidateList'
import { useCandidates } from './useCandidates'
import { useProjectTranslation } from './useProjectTranslation'
import '../materials/materials.css'
import './projects.css'

export default function ProjectsPage() {
  const { snapshot, applySnapshot } = useCraft(); const { t, i18n } = useTranslation()
  const lang = LanguageSchema.safeParse(i18n.language).data ?? 'ja'; const craftId = snapshot.craft.id
  const materials = useMaterials(craftId); const candidates = useCandidates(craftId)
  const reopen = useOperation(); const generation = useOperation(); const start = useOperation()
  const requested = useRef<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [selected, setSelected] = useState<string | null>(null); const [review, setReview] = useState(false)
  const materialDocument = materials.state.status === 'ready' ? materials.state.document : null
  const candidateDocument = candidates.state.status === 'ready' ? candidates.state.document : null
  const fresh = materialDocument?.confirmedAt && candidateDocument?.materialRevision === materialDocument.revision ? candidateDocument : null
  const unsafe = fresh?.source === 'ai' && !fresh.templates?.every(isAllowedAiProject)
  const translation = useProjectTranslation(craftId, fresh && !unsafe && fresh.templates?.some((template) => pendingProjectLocale(template) === lang) ? fresh.materialRevision : null, lang)
  async function generate(retry = false) {
    if (!materialDocument?.confirmedAt) return
    requested.current = materialDocument.revision
    const input = { craftId, materialRevision: materialDocument.revision, locale: lang }
    await generation.run(`generateProjects:${craftId}`, input, async () => {
      const gateway = await getProjectsGateway()
      return gateway.generateProjects({ ...input, ...(retry ? { retry: true } : {}) })
    })
  }
  useEffect(() => {
    if (materialDocument?.confirmedAt && candidates.state.status === 'ready' && (!candidateDocument?.source || candidateDocument.materialRevision !== materialDocument.revision) && requested.current !== materialDocument.revision) {
      void generate()
    }
    // Generation is keyed to the confirmed inventory version, never to render count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [craftId, lang, materialDocument?.revision, materialDocument?.confirmedAt, candidateDocument?.source, candidateDocument?.materialRevision, candidates.state.status])
  const failed = materials.state.status === 'error' ? materials.state : candidates.state.status === 'error' ? candidates.state : null
  if (failed) return <div className="page"><ScreenTitle>{t('flow.projectsTitle')}</ScreenTitle><ErrorNotice error={failed.error} onRetry={() => { materials.retry(); candidates.retry() }} /></div>
  if (materials.state.status !== 'ready' || candidates.state.status !== 'ready') return <LoadingNotice />
  const current = materialsState(materials.state.document)
  const { templates } = candidates.state
  const views = (fresh?.source && !unsafe ? fresh.candidates : []).map((candidate) => ({ candidate, template: templates.find((template) => template.id === candidate.templateId) }))
  const feasible = views.filter((view) => view.candidate.feasible && view.template)
  const choice = feasible.find((view) => view.candidate.templateId === selected)
  async function edit() {
    const input = { craftId, expectedRevision: current.revision, items: current.items, tools: current.tools, checks: [] }
    await reopen.run(`editMaterials:${craftId}`, input, async (requestId) => { await (await getMaterialsGateway()).editMaterials({ requestId, ...input }) })
    setAsking(false)
  }
  async function begin() {
    if (!choice?.template) return
    void import('../../app/StagePage').catch(() => { /* The route can load the module again. */ })
    const input = { craftId, templateId: choice.template.id, materialRevision: current.revision }
    const result = await start.run(`startCraft:${craftId}`, input, async (requestId) => (await getExperienceGateway()).startCraft({ ...input, requestId }))
    if (result) applySnapshot(result)
  }
  const waiting = generation.pending || (!fresh?.source && !generation.error)
  const generationError = generation.error ?? (unsafe ? new GatewayError('AI_UNSAFE_PROJECT') : null)
  return <div className="page projects-page"><JourneyProgress step={1} /><ScreenTitle backDisabled={start.pending || reopen.pending} onBack={review ? () => setReview(false) : () => setAsking(true)}>{t(review && choice ? 'flow.reviewTitle' : 'flow.projectsTitle')}</ScreenTitle>
    {translation.pending && <p role="status">{t('flow.translating')}</p>}
    {translation.error && <ErrorNotice error={translation.error} onRetry={translation.retry} />}
    {waiting ? <div className="ai-analyzing" role="status"><div className="ai-robot"><RobotIcon size={104} weight="duotone" /></div><h2>{t('flow.thinking')}</h2><div className="indeterminate-progress" /><span className="loading-dots">● ● ●</span></div> : <>
      {generationError && <ErrorNotice error={generationError} onRetry={() => { void generate(true) }} />}
      {fresh?.source === 'fixture' && <span className="mode-badge">{t('flow.sample')}</span>}
      {review && choice?.template ? <section className="project-review"><CraftVisual kind={choice.template.visual} /><h2>{choice.template.title[lang]}</h2><p>{choice.template.description[lang]}</p><h2>{t('candidateMaterials')}</h2><ul className="needs-list">{choice.template.materials.map((need) => <li key={need.materialId}><span>{need.name[lang]}</span><strong>{need.quantity} {need.unit[lang]}</strong></li>)}</ul><h2>{t('candidateTools')}</h2><p>{choice.template.tools.join(' / ') || t('noToolsNeeded')}</p>{start.error && <ErrorNotice error={start.error} />}<div className="sticky-action"><Button className="wide" disabled={start.pending || reopen.pending} onClick={() => { void begin() }}>{t('flow.begin')}<ArrowRightIcon size={22} /></Button></div></section> : fresh?.source && !unsafe && <>
        {!fresh ? <p className="candidate-empty">{t('candidatesPending')}</p> : <>
          {feasible.length === 0 && <p className="candidate-empty">{t(views.length ? 'noFeasibleCandidates' : 'noCandidates')}</p>}
          <CandidateList views={views} selected={choice ? selected : null} onSelect={setSelected} />
          {feasible.length > 0 && <div className="sticky-action"><Button className="wide" disabled={!choice} onClick={() => setReview(true)}>{t('flow.next')}<ArrowRightIcon size={22} /></Button></div>}
        </>}
      </>}
    </>}
    <details className="confirmed-details"><summary>{t('confirmedMaterialsTitle')}</summary><MaterialSummary items={current.items} /><h2 className="material-subheading">{t('ownedToolsTitle')}</h2><p>{current.tools.join(lang === 'ja' ? '、' : ', ') || t('noTools')}</p></details>
    {reopen.error && <ErrorNotice error={reopen.error} />}<Button className="wide edit-materials" variant="secondary" disabled={reopen.pending || generation.pending || start.pending} onClick={() => setAsking(true)}>{t('reopenMaterials')}</Button>
    {asking && <ConfirmDialog title={t('reopenMaterialsDialogTitle')} confirmLabel={t('reopenMaterials')} pending={reopen.pending} onCancel={() => setAsking(false)} onConfirm={() => { void edit() }} />}
  </div>
}
