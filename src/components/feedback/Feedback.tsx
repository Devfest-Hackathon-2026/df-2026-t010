import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { useTranslation } from 'react-i18next'
import type { GatewayError } from '@rekt/shared'
import { Button } from '../ui/Button'

export function ErrorNotice({ error, onRetry }: { error: GatewayError; onRetry?: () => void }) {
  const { t } = useTranslation()
  return <div className="feedback feedback--error" role="alert">
    <WarningCircleIcon size={22} aria-hidden="true" />
    <div><p>{t(`errors.${error.reason}`)}</p>{onRetry && <Button variant="secondary" onClick={onRetry}>{t('retry')}</Button>}</div>
  </div>
}
export function LoadingNotice() {
  const { t } = useTranslation()
  return <p role="status" className="muted loading">{t('loading')}</p>
}
