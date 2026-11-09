import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GlobeSimpleIcon } from '@phosphor-icons/react/dist/csr/GlobeSimple'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { WifiSlashIcon } from '@phosphor-icons/react/dist/csr/WifiSlash'
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House'
import { ImagesIcon } from '@phosphor-icons/react/dist/csr/Images'
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack'
import { LanguageSchema } from '@rekt/shared'
import { readEnvironment } from '../data/environment'
import './App.css'

export default function App() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const [offline, setOffline] = useState(!navigator.onLine)
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    document.getElementById('main-content')?.focus({ preventScroll: true })
    if (location.pathname !== '/gallery') window.scrollTo(0, 0)
  }, [location.pathname])
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{t('skipToContent')}</a>
    <header className="app-header">
      <Link className="brand" to="/" aria-label={t('home')}>
        <img className="brand-symbol" src="/rekt-mark.svg" alt="" width="36" height="36" />
        <span>Rekt</span>
      </Link>
      {readEnvironment(import.meta.env).VITE_DATA_MODE === 'mock' && <span className="mode-badge">{t('flow.demo')}</span>}
      <div className="language-control"><GlobeSimpleIcon size={20} aria-hidden="true" /><label className="visually-hidden" htmlFor="display-language">{t('language')}</label>
        <select id="display-language" value={i18n.language} onChange={(event) => { const language = LanguageSchema.parse(event.target.value); void i18n.changeLanguage(language); try { localStorage.setItem('co-make:language', language) } catch { /* Session language still works. */ } }}><option value="ja">日本語</option><option value="en">English</option></select><CaretDownIcon className="language-caret" size={16} aria-hidden="true" />
      </div>
    </header>
    {offline && <p className="offline-note" role="status"><WifiSlashIcon size={20} aria-hidden="true" />{t('offline')}</p>}
    <main id="main-content" tabIndex={-1}><Outlet /></main>
    {!location.pathname.startsWith('/crafts/') && <nav className="bottom-nav" aria-label={t('flow.navigation')}><NavLink to="/" end><HouseIcon size={23} weight="duotone" /><span>{t('flow.home')}</span></NavLink><NavLink to="/gallery"><ImagesIcon size={23} weight="duotone" /><span>{t('flow.gallery')}</span></NavLink><NavLink to="/my-crafts"><StackIcon size={23} weight="duotone" /><span>{t('flow.myCrafts')}</span></NavLink></nav>}
  </div>
}
