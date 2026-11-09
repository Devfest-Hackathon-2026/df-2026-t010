import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CameraIcon } from '@phosphor-icons/react/dist/csr/Camera'
import { ImageIcon } from '@phosphor-icons/react/dist/csr/Image'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { ListPlusIcon } from '@phosphor-icons/react/dist/csr/ListPlus'
import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import { GatewayError, LanguageSchema } from '@rekt/shared'
import type { Language, Material, MaterialRecognitionResponse } from '@rekt/shared'
import { useCraft } from '../../app/CraftContext'
import { Button } from '../../components/ui/Button'
import { ErrorNotice } from '../../components/feedback/Feedback'
import { useOperation } from '../../components/feedback/useOperation'
import { getMaterialsGateway } from '../../data'
import { PhotoError, preparePhoto } from './preparePhoto'
import type { PhotoProblem, PreparedPhoto } from './preparePhoto'
import './materials.css'

export interface MergeSummary { added: number; duplicates: number; overflow: number }

/** 本人の写真→AI候補（#9/#10）。候補は材料リストへ追加するまで保存しない（#11）。 */
export default function MaterialPhotoSection({ onAddCandidates, onBusyChange, adding = false, screen = false }: { onAddCandidates?: (items: Material[]) => Promise<MergeSummary | undefined>; onBusyChange?: (busy: boolean) => void; adding?: boolean; screen?: boolean }) {
  const { snapshot, uid } = useCraft()
  const { t, i18n } = useTranslation()
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const selection = useRef(0)
  const attempt = useRef<{ photoId: string; revision: number; locale: Language } | null>(null)
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [attemptPhotoId, setAttemptPhotoId] = useState<string | null>(null)
  const [problem, setProblem] = useState<PhotoProblem | null>(null)
  const [result, setResult] = useState<MaterialRecognitionResponse | null>(null)
  const [merged, setMerged] = useState<MergeSummary | null>(null)
  const operation = useOperation()
  const craftId = snapshot.craft.id
  const analyzing = preparing || operation.pending
  const busy = analyzing || adding

  useEffect(() => () => { selection.current++ }, [])
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.previewUrl) }, [photo])
  useEffect(() => { onBusyChange?.(analyzing) }, [analyzing, onBusyChange])

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    const version = ++selection.current
    attempt.current = null
    setAttemptPhotoId(null)
    setPhoto(null); setProblem(null); setResult(null); setMerged(null); setPreparing(true)
    try {
      const prepared = await preparePhoto(file)
      if (selection.current === version) setPhoto(prepared)
      else URL.revokeObjectURL(prepared.previewUrl)
    } catch (error) {
      if (selection.current === version) setProblem(error instanceof PhotoError ? error.problem : 'unreadable')
    } finally { if (selection.current === version) setPreparing(false) }
  }

  async function send() {
    if (!photo || busy) return
    const version = selection.current
    setAttemptPhotoId(photo.id)
    const identity = attempt.current ??= { photoId: photo.id, revision: snapshot.craft.revision, locale: LanguageSchema.safeParse(i18n.language).data ?? 'ja' }
    const output = await operation.run(`recognizeMaterials:${craftId}`, { craftId, ...identity }, async (requestId) => {
      const gateway = await getMaterialsGateway()
      setUploading(true)
      let image: Awaited<ReturnType<typeof gateway.uploadMaterialPhoto>>
      try { image = await gateway.uploadMaterialPhoto({ craftId, photoId: photo.id, blob: photo.blob }) } finally { setUploading(false) }
      if (selection.current !== version) return
      return gateway.recognizeMaterials({ requestId, craftId, expectedCraftRevision: identity.revision, locale: identity.locale, ...image })
    })
    if (output && selection.current === version) setResult(output)
  }

  function retake() {
    if (busy) return
    selection.current++
    attempt.current = null
    setAttemptPhotoId(null); setPhoto(null); setResult(null); setMerged(null); setProblem(null)
  }
  async function addCandidates(items: Material[]) {
    const summary = await onAddCandidates?.(items)
    if (summary) setMerged(summary)
  }
  const candidates = result?.status === 'succeeded' ? result.result : null
  if (snapshot.craft.ownerUid !== uid || snapshot.craft.status !== 'materials') return null

  return <section className="material-photo" aria-label={t('materialPhotoTitle')}>
    <input ref={cameraInput} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" disabled={busy} onChange={(event) => { void choose(event) }} data-testid="camera-input" />
    <input ref={libraryInput} className="visually-hidden" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" disabled={busy} onChange={(event) => { void choose(event) }} data-testid="library-input" />
    <div className="stack form" aria-busy={busy}>
      {screen && !photo && !preparing && <div className="camera-placeholder" aria-hidden="true"><ImageIcon size={86} weight="duotone" /><span className="camera-frame" /></div>}
      {screen && operation.pending && <div className="ai-analyzing" role="status"><div className="ai-robot"><RobotIcon size={104} weight="duotone" /></div><strong>{t('flow.analyzing')}</strong><div className="indeterminate-progress" /><span className="loading-dots">● ● ●</span></div>}
      {photo && !(screen && operation.pending) && <img className="photo-preview" src={photo.previewUrl} alt={t('materialPhotoPreview')} />}
      {preparing && <p role="status" className="muted">{t('preparingPhoto')}</p>}
      {problem && <p className="field-error" role="alert">{t(`photoProblems.${problem}`)}</p>}
      {photo && !result && <>
        {operation.error && attemptPhotoId === photo.id && <ErrorNotice error={operation.error} />}
        <Button disabled={busy} onClick={() => { void send() }}>{operation.pending ? t(uploading ? 'uploadingPhoto' : 'sendingPhoto') : operation.error && attemptPhotoId === photo.id ? t('resendPhoto') : t('sendPhoto')}</Button>
      </>}
      {!result && !(screen && operation.pending) && <div className="photo-actions">
        <Button variant={photo ? 'secondary' : 'primary'} disabled={busy} onClick={() => cameraInput.current?.click()}><CameraIcon size={22} aria-hidden="true" />{t(photo ? 'retakePhoto' : 'takePhoto')}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => libraryInput.current?.click()}><ImageIcon size={22} aria-hidden="true" />{t('choosePhoto')}</Button>
      </div>}
    </div>
    {result?.status === 'failed' && <div className="material-results"><ErrorNotice error={new GatewayError(result.reason)} /></div>}
    {candidates && <section className="material-results" aria-labelledby="material-results-heading">
      <h2 id="material-results-heading">{t('materialCandidatesTitle')}</h2>
      {result?.engine === 'fixture' && <span className="mode-badge">{t('flow.sample')}</span>}
      {candidates.items.length === 0 && <p className="muted">{t('materialCandidatesEmpty')}</p>}
      <ul className="material-candidates">{candidates.items.map((item) => <li key={item.id}><span className="material-name">{item.name}</span><span>{item.quantity} {item.unit}</span></li>)}</ul>
      {onAddCandidates && candidates.items.length > 0 && !merged && <Button className="result-add" disabled={adding} onClick={() => { void addCandidates(candidates.items) }}><ListPlusIcon size={22} aria-hidden="true" />{t(adding ? 'working' : 'addCandidates')}</Button>}
      {merged && <p role="status" className="result-add">{t('candidatesAdded', { n: merged.added })}{merged.duplicates > 0 && ` ${t('candidatesDuplicated', { n: merged.duplicates })}`}{merged.overflow > 0 && ` ${t('candidatesOverflow', { n: merged.overflow })}`}</p>}
    </section>}
    {result && <div className="stack result-actions"><Button variant="secondary" disabled={busy} onClick={retake}><ArrowCounterClockwiseIcon size={20} aria-hidden="true" />{t('recognizeAgain')}</Button></div>}
  </section>
}
