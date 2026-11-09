import { useTranslation } from 'react-i18next'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { ClockIcon } from '@phosphor-icons/react/dist/csr/Clock'
import { CellSignalHighIcon } from '@phosphor-icons/react/dist/csr/CellSignalHigh'
import { LanguageSchema } from '@rekt/shared'
import type { CandidatesDocument, Template } from '@rekt/shared'
import { CraftVisual } from '../../components/ui/CraftVisual'
export type Candidate = CandidatesDocument['candidates'][number]
export interface CandidateView { candidate: Candidate; template: Template | undefined }
export function CandidateList({ views, selected, onSelect }: { views: CandidateView[]; selected: string | null; onSelect: (templateId: string) => void }) {
  const { t, i18n } = useTranslation(); const lang = LanguageSchema.safeParse(i18n.language).data ?? 'ja'
  return <ul className="candidate-list">{views.map(({ candidate, template }, index) => {
    const id = `candidate-${candidate.templateId}`; const choosable = candidate.feasible && !!template
    return <li key={candidate.templateId} className={`candidate candidate--${index % 3}${selected === candidate.templateId ? ' candidate--selected' : ''}`} aria-labelledby={`${id}-title`}>
      <div className="candidate-top"><CraftVisual kind={template?.visual} /><div className="candidate-info"><p id={`${id}-title`} className="candidate-title">{template?.title[lang] ?? t('unknownTemplate')}</p>{template && <><p className="candidate-meta"><ClockIcon size={16} />{t('candidateMeta', { minutes: template.estimatedMinutes })}</p><p className="difficulty"><CellSignalHighIcon size={18} weight="fill" />{t(`flow.difficulty.${template.difficulty ?? 'easy'}`)}</p></>}</div>{choosable && <label className="candidate-choice"><input type="radio" name="project" value={candidate.templateId} aria-labelledby={`${id}-title`} checked={selected === candidate.templateId} onChange={() => onSelect(candidate.templateId)} /></label>}</div>
      {!template?.origin && <p className={`candidate-state ${candidate.feasible ? 'candidate-state--ok' : 'candidate-state--ng'}`}>{candidate.feasible ? <CheckCircleIcon size={17} /> : <WarningCircleIcon size={17} />}{t(candidate.feasible ? 'candidateFeasible' : 'candidateNotFeasible')}</p>}
      {!template?.origin && <details className="candidate-details"><summary>{t('flow.details')}</summary>{template && <p>{template.description[lang]}</p>}<p className="candidate-reason">{candidate.reason[lang]}</p>{candidate.missing.length > 0 && <ul className="candidate-missing">{candidate.missing.map((item, i) => <li key={i}>{item[lang]}</li>)}</ul>}{template && <div className="candidate-needs"><p className="candidate-label">{t('candidateMaterials')}</p><ul>{template.materials.map((need) => <li key={need.materialId}>{need.name[lang]} {need.quantity}{lang === 'en' ? ' ' : ''}{need.unit[lang]}</li>)}</ul><p className="candidate-label">{t('candidateTools')}</p><p>{template.tools.join(lang === 'ja' ? '、' : ', ') || t('noToolsNeeded')}</p></div>}</details>}
    </li>
  })}</ul>
}
