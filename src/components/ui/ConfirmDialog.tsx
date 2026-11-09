import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

export function ConfirmDialog({ title, description, confirmLabel, pending, onCancel, onConfirm }: { title: string; description?: string; confirmLabel: string; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const id = useId()
  const { t } = useTranslation()
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    dialog?.showModal()
    cancel.current?.focus()
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return <dialog ref={ref} className="confirm-dialog" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} onCancel={(event) => { event.preventDefault(); if (!pending) onCancel() }}>
    <h2 id={`${id}-title`}>{title}</h2>
    {description && <p id={`${id}-description`}>{description}</p>}
    <div className="actions">
      <Button variant="secondary" ref={cancel} disabled={pending} onClick={onCancel}>{t('cancel')}</Button>
      <Button disabled={pending} onClick={onConfirm}>{pending ? t('working') : confirmLabel}</Button>
    </div>
  </dialog>
}
