import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft'
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight'
import { CameraIcon } from '@phosphor-icons/react/dist/csr/Camera'
import { ImageIcon } from '@phosphor-icons/react/dist/csr/Image'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { ShareNetworkIcon } from '@phosphor-icons/react/dist/csr/ShareNetwork'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { getProductionProgress, GatewayError, isAllowedAiProject, LanguageSchema, pendingProjectLocale } from '@rekt/shared'
import type { ProductionDocument } from '@rekt/shared'
import { useCraft } from './CraftContext'
import { getExperienceGateway } from '../data'
import { gatewayError } from '../data/errors'
import { latestProduction } from '../data/revisions'
import { Button } from '../components/ui/Button'
import { CraftVisual } from '../components/ui/CraftVisual'
import { JourneyProgress, ScreenTitle } from '../components/ui/ScreenTitle'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { ErrorNotice, LoadingNotice } from '../components/feedback/Feedback'
import { useOperation } from '../components/feedback/useOperation'
import { preparePhoto, PhotoError } from '../features/materials/preparePhoto'
import type { PreparedPhoto } from '../features/materials/preparePhoto'
import { TextField } from '../components/ui/TextField'
import { useProjectTranslation } from '../features/projects/useProjectTranslation'

export default function StagePage() {
  const { snapshot, applySnapshot } = useCraft(); const { t, i18n } = useTranslation()
  const craftId = snapshot.craft.id; const lang = LanguageSchema.safeParse(i18n.language).data ?? 'ja'
  const [subscribed, setProduction] = useState<ProductionDocument | null>(null)
  const production = latestProduction(subscribed, 'production' in snapshot ? snapshot.production : null)
  const [error, setError] = useState<GatewayError | null>(null); const [attempt, setAttempt] = useState(0)
  const [viewed, setViewed] = useState<number | null>(null); const [completing, setCompleting] = useState(false)
  const operation = useOperation()
  const unsafe = production?.template.origin === 'ai' && !isAllowedAiProject(production.template)
  const translation = useProjectTranslation(craftId, production && !unsafe && pendingProjectLocale(production.template) === lang ? production.materialRevision : null, lang)
  useEffect(() => {
    let active = true; let stop: (() => void) | undefined
    void getExperienceGateway().then((gateway) => {
      if (!active) return
      stop = gateway.subscribeToProduction(craftId, (incoming) => { if (active && incoming) { setProduction((old) => latestProduction(old, incoming)); setError(null) } else if (active) setError(new GatewayError('PRODUCTION_NOT_READY')) }, (cause) => { if (active) setError(cause) })
    }).catch((cause: unknown) => { if (active) setError(gatewayError(cause)) })
    return () => { active = false; stop?.() }
  }, [craftId, attempt])
  if (error) return <div className="page"><ErrorNotice error={error} onRetry={() => { setError(null); setAttempt((n) => n + 1) }} /></div>
  if (!production) return <LoadingNotice />
  const translationNotice = <>{translation.pending && <p role="status">{t('flow.translating')}</p>}{translation.error && <ErrorNotice error={translation.error} onRetry={translation.retry} />}</>
  if (snapshot.craft.status === 'completed') return <>{translationNotice}<CompletionSuccess production={production} /></>
  if (unsafe) return <div className="page">
    <ScreenTitle>{t('flow.howTo')}</ScreenTitle>
    <ErrorNotice error={new GatewayError('AI_UNSAFE_PROJECT')} />
    <Link className="button button--primary wide" to="/start">{t('flow.newCraft')}</Link>
  </div>
  const progress = getProductionProgress(production); const first = production.steps.findIndex((step) => step.completedAt === null)
  const index = viewed ?? (first === -1 ? production.steps.length : first)
  const step = production.template.steps[index]
  async function next() {
    if (!production || !step) return
    if (production.steps[index]?.completedAt) { setViewed(index + 1); return }
    const input = { craftId, stepId: step.id, expectedRevision: production.revision }
    const result = await operation.run(`completeStep:${craftId}`, input, async (requestId) => (await getExperienceGateway()).completeStep({ ...input, requestId }))
    if (result) { applySnapshot(result); setProduction((old) => latestProduction(old, result.production)); setViewed(index + 1); window.scrollTo(0, 0) }
  }
  if (!step && progress.allStepsCompleted) return <>{translationNotice}<CompletionPhoto onBack={() => setViewed(production.steps.length - 1)} onConfirm={() => setCompleting(true)} confirming={completing} onCancel={() => setCompleting(false)} /></>
  if (!step) return <LoadingNotice />
  return <div className="page production-page"><JourneyProgress step={2} /><ScreenTitle>{t('flow.howTo')}</ScreenTitle>
    {translationNotice}
    <p className="project-label">{production.template.title[lang]}</p>
    <div className="step-image">{step.photoPath ? <img src={step.photoPath} alt={step.title[lang]} /> : <CraftVisual kind={production.template.visual} />}</div>
    <div className="step-navigation"><button className="icon-button" aria-label={t('flow.previousStep')} disabled={index === 0 || operation.pending} onClick={() => setViewed(index - 1)}><CaretLeftIcon size={24} /></button><div><span className="step-count">{index + 1} / {production.steps.length}</span><div className="step-dots" aria-hidden="true">{production.steps.map((item, i) => <span key={item.stepId} className={i === index ? 'active' : item.completedAt ? 'done' : ''} />)}</div></div><button className="icon-button" aria-label={t('flow.nextStep')} disabled={!production.steps[index]?.completedAt || operation.pending} onClick={() => setViewed(index + 1)}><CaretRightIcon size={24} /></button></div>
    <div className="step-copy"><span className="step-number">{index + 1}</span><div><h2>{step.title[lang]}</h2><p>{step.instructions[lang]}</p></div></div>
    {operation.error && <ErrorNotice error={operation.error} />}
    <div className="sticky-action"><Button className="wide" disabled={operation.pending} onClick={() => { void next() }}>{t(operation.pending ? 'working' : index === production.steps.length - 1 ? 'flow.finishSteps' : 'flow.stepDone')}<ArrowRightIcon size={22} /></Button></div>
  </div>
}
function CompletionPhoto({ onBack, onConfirm, onCancel, confirming }: { onBack: () => void; onConfirm: () => void; onCancel: () => void; confirming: boolean }) {
  const { snapshot, applySnapshot } = useCraft(); const { t } = useTranslation(); const operation = useOperation()
  const camera = useRef<HTMLInputElement>(null); const library = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null); const [problem, setProblem] = useState<string | null>(null); const [preparing, setPreparing] = useState(false)
  const selection = useRef(0)
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.previewUrl) }, [photo])
  useEffect(() => () => { selection.current++ }, [])
  async function choose(file?: File) {
    if (!file) return
    const version = ++selection.current; setPreparing(true); setProblem(null)
    try { const result = await preparePhoto(file); if (selection.current === version) setPhoto(result); else URL.revokeObjectURL(result.previewUrl) } catch (cause) { if (selection.current === version) setProblem(cause instanceof PhotoError ? t(`photoProblems.${cause.problem}`) : t('error')) } finally { if (selection.current === version) setPreparing(false) }
  }
  async function complete() {
    const payload = { craftId: snapshot.craft.id, photoId: photo?.id ?? null }
    const result = await operation.run(`completeCraft:${snapshot.craft.id}`, payload, async (requestId) => {
      const gateway = await getExperienceGateway()
      const uploaded = photo ? await gateway.uploadCompletionPhoto({ craftId: snapshot.craft.id, photoId: photo.id, blob: photo.blob }) : null
      return gateway.completeCraft({ requestId, craftId: snapshot.craft.id, photoPath: uploaded?.photoPath ?? null })
    })
    if (result) applySnapshot(result)
    onCancel()
  }
  return <div className="page completion-photo-page"><ScreenTitle onBack={onBack} backDisabled={operation.pending || preparing}>{t('flow.completionPhoto')}</ScreenTitle>
    <div className="completion-viewfinder">{photo ? <img src={photo.previewUrl} alt={t('flow.completedPhotoAlt')} /> : <><CameraIcon size={76} weight="duotone" /></>}<span className="camera-frame" /></div>
    <input className="visually-hidden" ref={camera} type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" disabled={operation.pending || preparing} onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = '' }} />
    <input className="visually-hidden" ref={library} type="file" accept="image/*" tabIndex={-1} aria-hidden="true" disabled={operation.pending || preparing} onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = '' }} />
    <div className="camera-controls"><Button variant="quiet" aria-label={t('retakePhoto')} disabled={operation.pending || preparing} onClick={() => camera.current?.click()}><ArrowCounterClockwiseIcon size={26} /></Button><button className="shutter-button" aria-label={t('takePhoto')} disabled={operation.pending || preparing} onClick={() => camera.current?.click()}><span /></button><Button variant="quiet" aria-label={t('choosePhoto')} disabled={operation.pending || preparing} onClick={() => library.current?.click()}><ImageIcon size={27} /></Button></div>
    {preparing && <p role="status">{t('preparingPhoto')}</p>}{problem && <p role="alert" className="field-error">{problem}</p>}{operation.error && <ErrorNotice error={operation.error} />}
    <Button className="wide" disabled={operation.pending || preparing} onClick={onConfirm}>{t(photo ? 'flow.recordCompletion' : 'flow.completeWithoutPhoto')}<ArrowRightIcon size={22} /></Button>
    {photo && <Button className="wide" variant="quiet" disabled={operation.pending || preparing} onClick={() => setPhoto(null)}>{t('flow.removePhoto')}</Button>}
    {confirming && <ConfirmDialog title={t('flow.completeTitle')} confirmLabel={t('flow.recordCompletion')} pending={operation.pending} onCancel={onCancel} onConfirm={() => { void complete() }} />}
  </div>
}
function SavedCompletionPhoto({ craftId }: { craftId: string }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<GatewayError | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let previewUrl: string | undefined
    void getExperienceGateway().then((gateway) => gateway.getCompletionPhoto(craftId)).then((photo) => {
      if (!active || !photo) return
      previewUrl = URL.createObjectURL(photo)
      setUrl(previewUrl)
    }).catch((cause: unknown) => {
      if (active) setError(gatewayError(cause))
    })
    return () => {
      active = false
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [craftId, attempt])
  if (error) return <ErrorNotice error={error} onRetry={() => { setError(null); setAttempt((n) => n + 1) }} />
  if (!url) return null
  return <div className="completion-viewfinder"><img src={url} alt={t('flow.completedPhotoAlt')} /></div>
}
function CompletionSuccess({ production }: { production: ProductionDocument }) {
  const { snapshot } = useCraft(); const { t, i18n } = useTranslation(); const operation = useOperation()
  const lang = LanguageSchema.safeParse(i18n.language).data ?? 'ja'; const [shared, setShared] = useState(false); const [shareForm, setShareForm] = useState(false)
  const [author, setAuthor] = useState(''); const [caption, setCaption] = useState('')
  useEffect(() => { let active = true; void getExperienceGateway().then((gateway) => gateway.getGalleryPost(snapshot.craft.id)).then((post) => { if (active) setShared(post !== null) }).catch(() => {}); return () => { active = false } }, [snapshot.craft.id])
  async function publish() {
    const input = { craftId: snapshot.craft.id, author: author.trim(), caption: caption.trim() }
    const result = await operation.run(`publishCraft:${snapshot.craft.id}`, input, async (requestId) => (await getExperienceGateway()).publishCraft({ ...input, requestId }))
    if (result) { setShared(true); setShareForm(false) }
  }
  return <div className="page completion-success"><div className="success-celebration" aria-hidden="true"><CheckCircleIcon size={100} weight="fill" /><span /><span /><span /><span /></div><h1>{t('flow.complete')}</h1><p>{production.template.title[lang]}</p>{shared && <p role="status">{t('flow.shared')}</p>}
    <SavedCompletionPhoto key={snapshot.craft.id} craftId={snapshot.craft.id} />
    {shareForm ? <form className="share-form stack" onSubmit={(event) => { event.preventDefault(); void publish() }}><TextField id="share-author" label={t('flow.author')} required value={author} maxLength={40} onChange={(event) => setAuthor(event.target.value)} /><div className="field"><label htmlFor="share-caption">{t('flow.caption')}</label><textarea id="share-caption" value={caption} maxLength={1000} onChange={(event) => setCaption(event.target.value)} /></div>{operation.error && <ErrorNotice error={operation.error} />}<Button type="submit" disabled={operation.pending || !author.trim()}>{t('flow.publish')}</Button><Button variant="quiet" disabled={operation.pending} onClick={() => setShareForm(false)}>{t('cancelEdit')}</Button></form> : <div className="actions completion-actions">{!shared && <Button onClick={() => setShareForm(true)}><ShareNetworkIcon size={22} />{t('flow.shareGallery')}</Button>}<Link className={`button button--${shared ? 'primary' : 'secondary'}`} to="/gallery">{t('flow.viewGallery')}<ArrowRightIcon size={21} /></Link><Link className="button button--secondary" to="/start"><ArrowCounterClockwiseIcon size={21} />{t('flow.makeAgain')}</Link></div>}
  </div>
}
