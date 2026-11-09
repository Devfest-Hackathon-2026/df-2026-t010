import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { MAX_TOOLS, toggleTool } from './materialDraft'
import { toolIcon } from './toolIcons'

/** 工具の所持確認。チェックした工具が材料文書のtoolsになる（所持している工具の一覧）。 */
export function ToolChecklist({ tools, pending, onChange, draft, onDraftChange, compact = false }: { tools: string[]; pending: boolean; onChange: (tools: string[]) => Promise<boolean>; draft: string | null; onDraftChange: (draft: string | null) => void; compact?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const custom = draft ?? ''
  const [invalid, setInvalid] = useState(false)
  const [opened, setOpened] = useState(!compact || !!draft)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const expanded = opened || !!draft
  const suggested = t('toolSuggestions', { returnObjects: true }) as string[]
  const visible = expanded ? suggested : suggested.slice(0, 4)
  const options = [...visible, ...tools.filter((tool) => !visible.includes(tool))]
  const full = tools.length >= MAX_TOOLS
  function changeCustom(value: string) { onDraftChange(value || null) }
  async function addCustom() {
    const name = custom.trim()
    if (!name || name.length > 80) { setInvalid(true); return }
    setInvalid(false)
    if (tools.includes(name)) { changeCustom(''); return }
    if (await onChange([...tools, name]) && active.current) changeCustom('')
  }
  return <>
    <ul className="tool-list">{options.map((tool, index) => {
      const owned = tools.includes(tool)
      const Icon = toolIcon(tool)
      return <li key={tool}><label className="tool-option">
        <input type="checkbox" checked={owned} disabled={pending || (!owned && full)} onChange={(event) => { void onChange(toggleTool(tools, tool, event.target.checked)) }} />
        {compact && <Icon className={`tool-icon tool-icon--${index % 4}`} size={29} weight="duotone" aria-hidden="true" />}
        <span>{tool}</span>
      </label></li>
    })}</ul>
    {compact && !expanded && <Button className="wide tool-more" variant="secondary" onClick={() => setOpened(true)}><PlusIcon size={20} />{t('flow.moreTools')}</Button>}
    {expanded && <form className="tool-add" noValidate onSubmit={(event) => { event.preventDefault(); void addCustom() }}>
      <TextField id={`${id}-tool`} label={t('otherTool')} value={custom} maxLength={80} autoComplete="off" disabled={pending || full} onChange={(event) => changeCustom(event.target.value)} error={invalid ? t('toolInvalid') : undefined} />
      <Button type="submit" variant="secondary" disabled={pending || full}><PlusIcon size={22} aria-hidden="true" />{t('addTool')}</Button>
      {custom.trim() && <Button variant="quiet" disabled={pending} onClick={() => { changeCustom(''); setInvalid(false) }}>{t('cancelEdit')}</Button>}
    </form>}
    {full && <p className="muted small">{t('toolsLimit', { n: MAX_TOOLS })}</p>}
  </>
}
