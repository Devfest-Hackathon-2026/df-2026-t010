import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PlusCircleIcon } from '@phosphor-icons/react/dist/csr/PlusCircle'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight'
import { CRAFT_HISTORY_STATUSES, craftPath, LanguageSchema } from '@rekt/shared'
import type { CraftHistoryItem, GatewayError } from '@rekt/shared'
import { getCraftGateway, getExperienceGateway, getMaterialsGateway } from '../../data'
import { useOperation } from '../../components/feedback/useOperation'
import { ErrorNotice, LoadingNotice } from '../../components/feedback/Feedback'
import { ScreenTitle } from '../../components/ui/ScreenTitle'
import { CraftVisual } from '../../components/ui/CraftVisual'
import { gatewayError } from '../../data/errors'
export default function StartPage({ history = false }: { history?: boolean }) {
  const { t, i18n } = useTranslation(); const navigate = useNavigate(); const operation = useOperation()
  const [crafts, setCrafts] = useState<CraftHistoryItem[] | null>(null)
  const [loadError, setLoadError] = useState<GatewayError | null>(null); const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void getExperienceGateway().then((gateway) => gateway.listMyCrafts()).then((items) => {
      if (!active) return
      setCrafts(items.filter(({ snapshot }) => CRAFT_HISTORY_STATUSES.some((status) => status === snapshot.craft.status)).sort((a, b) => {
        const first = a.snapshot.craft; const second = b.snapshot.craft
        return Number(first.status === 'completed') - Number(second.status === 'completed')
          || second.updatedAt.localeCompare(first.updatedAt)
      }))
    }).catch((cause: unknown) => { if (active) setLoadError(gatewayError(cause)) })
    return () => { active = false }
  }, [attempt])
  const lang = LanguageSchema.safeParse(i18n.language).data ?? 'ja'
  const previous = crafts?.find((item) => item.snapshot.craft.status === 'completed')
  const formatDate = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' })
  async function start(reuse?: string) {
    const result = await operation.run('startJourney', { reuse, locale: lang }, async (id) => {
      const gateway = await getCraftGateway(); const created = await gateway.createCraft({ requestId: id, locale: lang })
      if (reuse) {
        const materialGateway = await getMaterialsGateway()
        const inventory = await new Promise<import('@rekt/shared').MaterialsDocument | null>((resolve, reject) => {
          let stop = () => {}; stop = materialGateway.subscribeToMaterials(reuse, (document) => { stop(); resolve(document) }, (error) => { stop(); reject(error) })
        })
        if (inventory) await materialGateway.editMaterials({ requestId: id, craftId: created.craft.id, expectedRevision: 0, items: inventory.items, tools: inventory.tools, checks: [] })
      }
      return created
    })
    if (result) { try { localStorage.setItem('co-make:last-craft:v2', result.craft.id); sessionStorage.setItem(`co-make:material-step:${result.craft.id}`, reuse ? 'review' : 'tools') } catch { /* Navigation still works. */ } navigate(craftPath(result.craft)) }
  }
  return <div className="page start-page"><ScreenTitle>{t(history ? 'flow.myCrafts' : 'flow.newStart')}</ScreenTitle>
    {operation.error && <ErrorNotice error={operation.error} />}
    {loadError && <ErrorNotice error={loadError} onRetry={() => { setLoadError(null); setAttempt((n) => n + 1) }} />}
    {!history && <div className="start-options"><button className="start-option" disabled={operation.pending} onClick={() => { void start() }}><PlusCircleIcon size={48} weight="duotone" /><strong>{t('flow.newCraft')}</strong></button><button className="start-option start-option--reuse" disabled={operation.pending || !previous} onClick={() => { if (previous) void start(previous.snapshot.craft.id) }}><ArrowCounterClockwiseIcon size={46} /><strong>{t('flow.reuse')}</strong><span>{previous?.title?.[lang] ?? t('flow.noPrevious')}</span></button></div>}
    {history && <>{!crafts && !loadError && <LoadingNotice />}<ul className="history-list">{crafts?.map(({ snapshot, title, visual }) => {
      const { craft } = snapshot
      return <li key={craft.id}><Link to={craftPath(craft)}><CraftVisual kind={visual} /><span><strong>{title?.[lang] ?? t('flow.untitled')}</strong><small>{t(craft.status === 'crafting' ? 'flow.inProgress' : 'stages.completed')} · {formatDate.format(new Date(craft.updatedAt))}</small></span><CaretRightIcon size={20} /></Link></li>
    })}</ul>{crafts?.length === 0 && <p className="empty-state">{t('flow.noHistory')}</p>}<Link className="button button--primary wide" to="/start">{t('flow.newCraft')}</Link></>}
  </div>
}
