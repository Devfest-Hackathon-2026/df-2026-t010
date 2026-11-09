import { useEffect, useState } from 'react'
import type { Language } from '@rekt/shared'
import { useOperation } from '../../components/feedback/useOperation'
import { getProjectsGateway } from '../../data'

export function useProjectTranslation(craftId: string, revision: number | null, locale: Language) {
  const operation = useOperation()
  const [requested, setRequested] = useState('')
  const key = revision === null ? '' : `${craftId}:${revision}:${locale}`
  async function translate(retry = false) {
    if (revision === null || operation.pending) return
    setRequested(key)
    const input = { craftId, materialRevision: revision, locale, ...(retry ? { retry: true } : {}) }
    await operation.run(`translateProjects:${key}`, input, async () => (await getProjectsGateway()).translateProjects(input))
  }
  useEffect(() => {
    if (!key || requested === key || operation.pending) return
    let active = true
    queueMicrotask(() => { if (active) void translate() })
    return () => { active = false }
    // The saved text subscription decides when this language is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, requested, operation.pending])
  return { pending: !!key && (operation.pending || requested !== key), error: key && key === requested ? operation.error : null, retry: () => { void translate(true) } }
}
