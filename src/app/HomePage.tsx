import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ScissorsIcon } from '@phosphor-icons/react/dist/csr/Scissors'
import { ImagesIcon } from '@phosphor-icons/react/dist/csr/Images'
import { PencilRulerIcon } from '@phosphor-icons/react/dist/csr/PencilRuler'
import { RulerIcon } from '@phosphor-icons/react/dist/csr/Ruler'
import { IdSchema } from '@rekt/shared'
export default function HomePage() {
  const { t } = useTranslation()
  let last: string | null = null
  try { last = IdSchema.safeParse(localStorage.getItem('co-make:last-craft:v2')).data ?? null } catch { /* New crafts remain available. */ }
  return <div className="page home-page">
    <div className="home-heading"><h1>{t('homeTitleFirst')}<br />{t('homeTitleSecond')}</h1></div>
    <div className="home-actions">
      <Link className="home-action home-action--make" to="/start"><span className="home-action-icon"><ScissorsIcon size={52} weight="duotone" /></span><span><strong>{t('flow.create')}</strong></span><span className="round-arrow"><ArrowRightIcon size={20} /></span></Link>
      <Link className="home-action home-action--gallery" to="/gallery"><span className="home-action-icon"><ImagesIcon size={48} weight="duotone" /></span><span><strong>{t('flow.gallery')}</strong></span><span className="round-arrow"><ArrowRightIcon size={20} /></span></Link>
    </div>
    {last && <Link className="resume-link" to={`/crafts/${encodeURIComponent(last)}`}>{t('resumeCraft')}<ArrowRightIcon size={18} /></Link>}
    <div className="home-table" aria-hidden="true"><span className="table-paper" /><PencilRulerIcon className="table-pencil" size={126} weight="duotone" /><RulerIcon className="table-ruler" size={114} weight="duotone" /><ScissorsIcon className="table-scissors" size={106} weight="duotone" /></div>
  </div>
}
