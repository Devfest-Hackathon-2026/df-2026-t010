import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple'
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus'
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash'
import type { Material } from '@rekt/shared'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { MAX_MATERIALS, readFields, toFields } from './materialDraft'
import type { FieldProblem, MaterialFields } from './materialDraft'
import type { MaterialEditor } from './materialSession'
import { requestId } from '../../data/request-id'

/** 確定済み表示・作品選択画面で使う読み取り専用の一覧。 */
export function MaterialSummary({ items }: { items: Material[] }) {
  return <ul className="material-list">{items.map((item) => <li key={item.id}>
    <div className="material-main"><span className="material-name">{item.name}</span><span className="material-amount">{item.quantity} {item.unit}</span></div>
  </li>)}</ul>
}

function MaterialForm({ fields, onFieldsChange, pending, frozen = false, onSubmit, onCancel }: { fields: MaterialFields; onFieldsChange: (fields: MaterialFields) => void; pending: boolean; frozen?: boolean; onSubmit: (value: Pick<Material, 'name' | 'quantity' | 'unit'>) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const id = useId()
  const [problems, setProblems] = useState<FieldProblem[]>([])
  const set = (key: keyof MaterialFields) => (event: { target: { value: string } }) => onFieldsChange({ ...fields, [key]: event.target.value })
  return <form className="material-form stack" noValidate onSubmit={(event) => {
    event.preventDefault()
    const result = readFields(fields)
    if ('problems' in result) { setProblems(result.problems); return }
    setProblems([]); onSubmit(result.value)
  }}>
    <TextField id={`${id}-name`} label={t('materialName')} value={fields.name} maxLength={80} autoComplete="off" disabled={pending} readOnly={frozen} onChange={set('name')} error={problems.includes('name') ? t('materialNameInvalid') : undefined} />
    <div className="material-form-row">
      <TextField id={`${id}-quantity`} label={t('materialQuantity')} value={fields.quantity} inputMode="decimal" maxLength={64} autoComplete="off" disabled={pending} readOnly={frozen} onChange={set('quantity')} error={problems.includes('quantity') ? t('materialQuantityInvalid') : undefined} />
      <TextField id={`${id}-unit`} label={t('materialUnit')} value={fields.unit} maxLength={20} autoComplete="off" disabled={pending} readOnly={frozen} onChange={set('unit')} error={problems.includes('unit') ? t('materialUnitInvalid') : undefined} />
    </div>
    <div className="actions">
      <Button type="submit" disabled={pending}>{t(pending ? 'working' : 'saveMaterial')}</Button>
      <Button variant="secondary" disabled={pending} onClick={onCancel}>{t('cancelEdit')}</Button>
    </div>
  </form>
}

export type ListChange = { kind: 'add'; value: Pick<Material, 'name' | 'quantity' | 'unit'> } | { kind: 'update'; id: string; original: Material; value: Pick<Material, 'name' | 'quantity' | 'unit'> } | { kind: 'remove'; id: string }

/** 材料の追加・編集・削除。保存は1操作ずつ、最新の材料文書に対して行う。 */
export function MaterialList({ items, pending, onChange, editor, setEditor }: { items: Material[]; pending: boolean; onChange: (change: ListChange) => Promise<boolean>; editor: MaterialEditor | null; setEditor: (editor: MaterialEditor | null) => void }) {
  const { t } = useTranslation()
  const editing = editor?.kind === 'edit' ? editor.original : editor ? 'new' : null
  const original = editor?.kind === 'edit' ? editor.original : null
  function changeEditor(next: Material | 'new' | null) {
    setEditor(next === null ? null : next === 'new' ? { kind: 'new', id: requestId(), fields: toFields() } : { kind: 'edit', original: next, fields: toFields(next) })
  }
  function changeFields(fields: MaterialFields) { if (editor && !(editor.kind === 'new' && editor.attempt)) setEditor({ ...editor, fields }) }
  function submit(change: ListChange) { void onChange(change) }
  return <>
    {items.length === 0 && <p className="muted material-empty">{t('materialsEmpty')}</p>}
    <ul className="material-list">{items.map((item) => <li key={item.id}>
      {original && original.id === item.id
        ? <MaterialForm fields={editor!.fields} onFieldsChange={changeFields} pending={pending} onSubmit={(value) => { void submit({ kind: 'update', id: item.id, original, value }) }} onCancel={() => changeEditor(null)} />
        : <>
          <div className="material-main"><span className="material-name">{item.name}</span><span className="material-amount">{item.quantity} {item.unit}</span></div>
          <div className="material-actions">
            <Button variant="quiet" disabled={pending || editing !== null} aria-label={t('editMaterialNamed', { name: item.name })} onClick={() => changeEditor({ ...item })}><PencilSimpleIcon size={22} aria-hidden="true" /></Button>
            <Button variant="quiet" disabled={pending || editing !== null} aria-label={t('removeMaterialNamed', { name: item.name })} onClick={() => { void onChange({ kind: 'remove', id: item.id }) }}><TrashIcon size={22} aria-hidden="true" /></Button>
          </div>
        </>}
    </li>)}</ul>
    {original && !items.some((item) => item.id === original.id) && <div className="stack">
      <p role="alert" className="field-error">{t('errors.STALE_REVISION')}</p>
      <Button variant="secondary" disabled={pending} onClick={() => changeEditor(null)}>{t('cancelEdit')}</Button>
    </div>}
    {editor?.kind === 'new'
      ? <MaterialForm fields={editor.fields} onFieldsChange={changeFields} pending={pending} frozen={!!editor.attempt} onSubmit={(value) => { void submit({ kind: 'add', value }) }} onCancel={() => changeEditor(null)} />
      : <Button variant="secondary" className="material-add" disabled={pending || editing !== null || items.length >= MAX_MATERIALS} onClick={() => changeEditor('new')}><PlusIcon size={22} aria-hidden="true" />{t('addMaterial')}</Button>}
    {items.length >= MAX_MATERIALS && <p className="muted small">{t('materialsLimit', { n: MAX_MATERIALS })}</p>}
  </>
}
