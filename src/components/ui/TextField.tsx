import type { ComponentProps } from 'react'

export function TextField({ id, label, hint, error, ...props }: ComponentProps<'input'> & { id: string; label: string; hint?: string; error?: string }) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    {hint && <p id={`${id}-hint`} className="muted small">{hint}</p>}
    <input id={id} aria-invalid={Boolean(error)} aria-describedby={[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined} {...props} />
    {error && <p id={`${id}-error`} className="field-error" role="alert">{error}</p>}
  </div>
}
