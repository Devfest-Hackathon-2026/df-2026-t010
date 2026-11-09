import { useEffect, useState } from 'react'
import type { CandidatesDocument, GatewayError, Template } from '@rekt/shared'
import { getProjectsGateway } from '../../data'
import { gatewayError } from '../../data/errors'

type CandidatesState = { status: 'loading' } | { status: 'ready'; document: CandidatesDocument | null; templates: Template[] } | { status: 'error'; error: GatewayError }

/** Subscribe to the saved ideas and their embedded templates; keep the catalog available for older records. */
export function useCandidates(craftId: string) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<CandidatesState>({ status: 'loading' })
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void getProjectsGateway().then(async (gateway) => {
      const templates = await gateway.listTemplates()
      if (!active) return
      unsubscribe = gateway.subscribeToCandidates(craftId, (incoming) => {
        if (!active) return
        // 古い材料版の候補で新しい候補を上書きしない。
        setState((old) => old.status === 'ready' && old.document && incoming && old.document.materialRevision > incoming.materialRevision ? old : { status: 'ready', document: incoming, templates: incoming?.templates ?? templates })
      }, (error) => { if (active) setState({ status: 'error', error }) })
    }).catch((cause: unknown) => { if (active) setState({ status: 'error', error: gatewayError(cause) }) })
    return () => { active = false; unsubscribe?.() }
  }, [craftId, attempt])
  return { state, retry: () => { setState({ status: 'loading' }); setAttempt((n) => n + 1) } }
}
