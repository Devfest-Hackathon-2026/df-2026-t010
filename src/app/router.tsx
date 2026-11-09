import { Link, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import App from './App'
import HomePage from './HomePage'
import { LoadingNotice } from '../components/feedback/Feedback'

const CraftProvider = lazy(() => import('./CraftProvider'))
const StagePage = lazy(() => import('./StagePage'))
const MaterialsPage = lazy(() => import('../features/materials/MaterialJourney'))
const ProjectsPage = lazy(() => import('../features/projects/ProjectsPage'))
const StartPage = lazy(() => import('../features/workshop/StartPage'))
const GalleryPage = lazy(() => import('../features/gallery/GalleryPage'))
function MissingPage({ legacy = false }: { legacy?: boolean }) {
  const { t } = useTranslation()
  return <div className="page"><h1>{t(legacy ? 'legacyLinkTitle' : 'notFound')}</h1>{legacy && <p>{t('legacyLinkDescription')}</p>}<Link className="text-link" to="/">{t('home')}</Link></div>
}
export default function AppRouter() {
  return <Suspense fallback={<LoadingNotice />}><Routes><Route element={<App />}>
    <Route index element={<HomePage />} />
    <Route path="start" element={<StartPage />} />
    <Route path="my-crafts" element={<StartPage history />} />
    <Route path="gallery" element={<GalleryPage />} />
    <Route path="gallery/:postId" element={<GalleryPage />} />
    <Route path="gallery/:postId/comments" element={<GalleryPage commentsOnly />} />
    <Route path="crafts/:craftId" element={<CraftProvider />}>
      <Route index element={<StagePage />} />
      <Route path="materials" element={<MaterialsPage />} />
      <Route path="projects" element={<ProjectsPage />} />
      <Route path="craft" element={<StagePage />} />
      <Route path="complete" element={<StagePage />} />
    </Route>
    {['rooms/*', 'host/*', 'join/*'].map((path) => <Route key={path} path={path} element={<MissingPage legacy />} />)}
    <Route path="*" element={<MissingPage />} />
  </Route></Routes></Suspense>
}
