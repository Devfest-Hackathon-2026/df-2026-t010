import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { GatewayError, IdSchema, craftPath } from '@rekt/shared'
import { useTranslation } from 'react-i18next'
import { getCraftGateway } from '../data'
import type { CraftGateway } from '../data/contracts'
import { gatewayError } from '../data/errors'
import { ErrorNotice, LoadingNotice } from '../components/feedback/Feedback'
import { CraftContext, latestSnapshot } from './CraftContext'
import type { CraftSessionSnapshot } from './CraftContext'

export default function CraftProvider() {
  const { craftId = '' } = useParams()
  return <CraftSession key={craftId} craftId={craftId} />
}
function CraftSession({ craftId }: { craftId: string }) {
  const location = useLocation()
  const { t } = useTranslation()
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState<CraftSessionSnapshot | null>(null)
  const [connection, setConnection] = useState<{ uid: string; gateway: CraftGateway } | null>(null)
  const [error, setError] = useState<GatewayError | null>(null)
  useEffect(() => {
    let active = true
    let received = false
    let unsubscribe: (() => void) | undefined
    const timer = window.setTimeout(() => { if (active && !received) setError(new GatewayError('TEMPORARILY_UNAVAILABLE')) }, 15_000)
    void (async () => {
      if (!IdSchema.safeParse(craftId).success) throw new GatewayError('CRAFT_NOT_FOUND')
      const gateway = await getCraftGateway()
      const uid = await gateway.getUserId()
      if (!active) return
      setConnection({ uid, gateway })
      unsubscribe = gateway.subscribeToCraft(craftId, (incoming) => {
        if (!active) return
        received = true; window.clearTimeout(timer)
        setSnapshot((old) => latestSnapshot(old, incoming)); setError(null)
      }, (cause) => { window.clearTimeout(timer); if (active) setError(cause) })
    })().catch((cause: unknown) => { window.clearTimeout(timer); if (active) setError(gatewayError(cause)) })
    return () => { active = false; window.clearTimeout(timer); unsubscribe?.() }
  }, [craftId, attempt])
  if (error) return <div className="page"><h1>{t('craftUnavailable')}</h1><ErrorNotice error={error} onRetry={() => { setError(null); setConnection(null); setAttempt((n) => n + 1) }} /><Link className="text-link" to="/">{t('home')}</Link></div>
  if (!snapshot || !connection || snapshot.craft.id !== craftId) return <LoadingNotice />
  const canonical = craftPath(snapshot.craft)
  if (snapshot.craft.ownerUid !== connection.uid) return <ErrorNotice error={new GatewayError('NOT_CRAFT_OWNER')} />
  if (location.pathname !== canonical) return <Navigate to={canonical} replace />
  return <CraftContext.Provider value={{ snapshot, ...connection, applySnapshot: (incoming) => setSnapshot((old) => latestSnapshot(old, incoming)) }}><Outlet /></CraftContext.Provider>
}
