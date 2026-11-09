import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft'
export function ScreenTitle({ children, back = '/', onBack, backDisabled = false }: { children: ReactNode; back?: string; onBack?: () => void; backDisabled?: boolean }) {
  const { t } = useTranslation()
  return <div className="screen-title">{onBack ? <button className="icon-button back-button" onClick={onBack} disabled={backDisabled} aria-label={t('flow.back')}><ArrowLeftIcon size={23} /></button> : <Link className="icon-button back-button" to={back} aria-label={t('flow.back')}><ArrowLeftIcon size={23} /></Link>}<h1>{children}</h1></div>
}
export function JourneyProgress({ step }: { step: number }) {
  const { t } = useTranslation()
  return <ol className="journey-progress" aria-label={t('flow.progress')}>{['prepare', 'choose', 'make'].map((key, i) => <li key={key} className={i <= step ? 'is-current' : ''} aria-current={i === step ? 'step' : undefined}><span className="journey-number">{String(i + 1).padStart(2, '0')}</span><span>{t(`flow.${key}`)}</span></li>)}</ol>
}
