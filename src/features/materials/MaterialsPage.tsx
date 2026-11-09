import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUUpLeft'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import type { Material, MaterialsDocument } from '@rekt/shared'
import { GatewayError } from '@rekt/shared'
import { useCraft } from '../../app/CraftContext'
import { Button } from '../../components/ui/Button'
import { ErrorNotice, LoadingNotice } from '../../components/feedback/Feedback'
import { useOperation } from '../../components/feedback/useOperation'
import { getMaterialsGateway } from '../../data'
import { gatewayError } from '../../data/errors'
import { requestId as newId } from '../../data/request-id'
import MaterialPhotoSection from './MaterialPhotoSection'
import { MaterialList } from './MaterialList'
import type { ListChange } from './MaterialList'
import { ToolChecklist } from './ToolChecklist'
import { addManual, materialsState, MAX_MATERIALS, mergeCandidates, removeItem, restoreItem, updateItem } from './materialDraft'
import { useMaterials } from './useMaterials'
import { MaterialEditorSchema, MaterialUndoSchema, ToolDraftSchema, UNDO_MATERIAL_MS, useMaterialSession } from './materialSession'
import './materials.css'

/** /crafts/:craftId/materials。本人が材料・工具を確認して確定する（#11）。サーバーの検証・確定は #33。 */
export default function MaterialsPage({ compact = false }: { compact?: boolean }) {
  const { snapshot } = useCraft()
  const { t } = useTranslation()
  const { state, retry } = useMaterials(snapshot.craft.id)
  if (state.status === 'loading') return <LoadingNotice />
  if (state.status === 'error') return <div className="page"><h1>{t('stages.materials')}</h1><ErrorNotice error={state.error} onRetry={retry} /></div>
  return <MaterialsReview document={state.document} compact={compact} />
}

export function MaterialsReview({ document, compact }: { document: MaterialsDocument | null; compact: boolean }) {
  const { snapshot, uid } = useCraft()
  const { t } = useTranslation()
  const craftId = snapshot.craft.id
  const edit = useOperation()
  const confirm = useOperation()
  const [stale, setStale] = useState(false)
  const [showTools, setShowTools] = useState(!compact)
  const sessionKey = `co-make:material-editor:v1:${uid}:${craftId}`
  const [editor, setEditor] = useMaterialSession(sessionKey, MaterialEditorSchema)
  const [toolDraft, setToolDraft] = useMaterialSession(`${sessionKey}:tool`, ToolDraftSchema)
  const [undo, setUndo] = useMaterialSession(`${sessionKey}:undo`, MaterialUndoSchema)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), Math.max(0, undo.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
    // The deadline belongs to this undo record; the setter intentionally writes synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo?.expiresAt, sessionKey])

  const current = materialsState(document)
  const busy = edit.pending || confirm.pending
  const drafting = editor !== null
  const toolDrafting = !!toolDraft?.trim()
  const canConfirm = !busy && !drafting && !toolDrafting && current.items.length > 0

  async function save(items: Material[], tools: string[]): Promise<boolean> {
    setStale(false)
    const input = { craftId, expectedRevision: current.revision, items, tools, checks: [] }
    const done = await edit.run(`editMaterials:${craftId}`, input, async (requestId) => {
      await (await getMaterialsGateway()).editMaterials({ requestId, ...input })
      return true
    })
    return done === true
  }
  async function addMaterial(value: Pick<Material, 'name' | 'quantity' | 'unit'>) {
    if (editor?.kind !== 'new') return false
    const id = editor.id ?? newId()
    const alreadySaved = current.items.some((item) => item.id === `manual-${id}`)
    if (!alreadySaved && !editor.attempt && current.items.length >= MAX_MATERIALS) {
      setStale(true)
      return false
    }
    const { requestId: previousId, ...input } = editor.attempt ?? {
      requestId: undefined,
      craftId,
      expectedRevision: current.revision,
      items: addManual(current.items, id, value),
      tools: current.tools,
      checks: [],
    }
    setStale(false)
    const saved = await edit.run(`addMaterial:${craftId}`, input, async (requestId) => {
      if (alreadySaved) return true
      const attempt = { ...input, requestId: previousId ?? requestId }
      setEditor({ ...editor, id, attempt })
      try {
        await (await getMaterialsGateway()).editMaterials(attempt)
        return true
      } catch (cause) {
        const reason = gatewayError(cause).reason
        if (active.current && reason !== 'TEMPORARILY_UNAVAILABLE' && reason !== 'INTERNAL_ERROR') {
          setEditor({ ...editor, id, attempt: undefined })
        }
        throw cause
      }
    })
    return saved === true
  }
  async function changeList(change: ListChange) {
    if (change.kind === 'add') {
      const saved = await addMaterial(change.value)
      if (saved && active.current) setEditor(null)
      return saved
    }
    const items = change.kind === 'update'
      ? updateItem(current.items, change.id, change.value, change.original)
      : removeItem(current.items, change.id)
    // 別のタブで先に削除された行は直せない。最新の一覧を見てもらう。
    if (!items) { setStale(true); return false }
    if (items === current.items) {
      if (change.kind === 'update') setEditor(null)
      return true
    }
    const removed = change.kind === 'remove' ? current.items.find((item) => item.id === change.id) : undefined
    const done = await save(items, current.tools)
    if (done && change.kind === 'update' && active.current) setEditor(null)
    if (done && removed) setUndo({ item: removed, index: current.items.findIndex((item) => item.id === removed.id), revision: current.revision + 1, expiresAt: Date.now() + UNDO_MATERIAL_MS })
    return done
  }
  async function undoRemoval() {
    if (!undo || current.revision < undo.revision) return
    const items = restoreItem(current.items, undo.item, undo.index)
    if (!items) { setStale(true); return }
    setUndo({ ...undo, expiresAt: Date.now() + UNDO_MATERIAL_MS })
    if (items === current.items || await save(items, current.tools)) setUndo(null)
  }
  async function addCandidates(candidates: Material[]) {
    const merged = mergeCandidates(current.items, candidates)
    if (merged.added === 0) return merged
    return await save(merged.items, current.tools) ? merged : undefined
  }
  async function confirmMaterials() {
    if (!canConfirm) return
    const input = { craftId, expectedRevision: current.revision }
    await confirm.run(`confirmMaterials:${craftId}`, input, async (requestId) => {
      await (await getMaterialsGateway()).confirmMaterials({ requestId, ...input })
    })
  }

  const editError = stale ? new GatewayError('STALE_REVISION') : edit.error
  return <div className={compact ? 'materials-review' : 'page'}>
    {!compact && <h1>{t('stages.materials')}</h1>}
    {!compact && <MaterialPhotoSection onAddCandidates={addCandidates} adding={busy} />}

    <section className="material-section" aria-label={t('materialListTitle')}>
      {!compact && <h2>{t('materialListTitle')}</h2>}
      {editError && <ErrorNotice error={editError} />}
      <MaterialList editor={editor} setEditor={setEditor} items={current.items} pending={busy} onChange={changeList} />
      {undo && <Button variant="quiet" disabled={busy || current.revision < undo.revision} aria-label={t('undoMaterialNamed', { name: undo.item.name })} onClick={() => { void undoRemoval() }}><ArrowUUpLeftIcon size={22} aria-hidden="true" />{t('undoMaterial')}</Button>}
    </section>

    <section className="material-section" aria-labelledby="tool-heading">
      <h2 id="tool-heading">{t('toolsTitle')}</h2>
      {compact && <p className="muted small">{current.tools.join(' / ') || t('noTools')}</p>}
      {showTools || toolDrafting
        ? <ToolChecklist tools={current.tools} pending={busy} onChange={(tools) => save(current.items, tools)} draft={toolDraft} onDraftChange={setToolDraft} />
        : <Button variant="quiet" onClick={() => setShowTools(true)}>{t('flow.editTools')}</Button>}
    </section>

    <section className="material-section material-confirm" aria-label={t('confirmMaterialsTitle')}>
      {(drafting || toolDrafting) && <p className="muted">{t('finishMaterialDraft')}</p>}
      {confirm.error && <ErrorNotice error={confirm.error} />}
      <Button disabled={!canConfirm} onClick={() => { void confirmMaterials() }}><CheckCircleIcon size={22} aria-hidden="true" />{t(confirm.pending ? 'working' : 'confirmMaterials')}</Button>
    </section>
  </div>
}
