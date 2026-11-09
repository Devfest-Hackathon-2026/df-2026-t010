import { useEffect, useState } from 'react'
import type { GatewayError, MaterialsDocument } from '@rekt/shared'
import { getMaterialsGateway } from '../../data'
import { gatewayError } from '../../data/errors'

type MaterialsSubscription = { status: 'loading' } | { status: 'ready'; document: MaterialsDocument | null } | { status: 'error'; error: GatewayError }

/** 接続層の購読（crafts/{id}/workshop/materials）をそのまま使う。古いrevisionで新しい内容を戻さない。 */
export function useMaterials(craftId: string) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<MaterialsSubscription>({ status: 'loading' })
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void getMaterialsGateway().then((gateway) => {
      if (!active) return
      unsubscribe = gateway.subscribeToMaterials(craftId, (incoming) => {
        if (!active) return
        setState((old) => old.status === 'ready' && old.document && incoming && old.document.revision > incoming.revision ? old : { status: 'ready', document: incoming })
      }, (error) => { if (active) setState({ status: 'error', error }) })
    }).catch((cause: unknown) => { if (active) setState({ status: 'error', error: gatewayError(cause) }) })
    return () => { active = false; unsubscribe?.() }
  }, [craftId, attempt])
  return { state, retry: () => { setState({ status: 'loading' }); setAttempt((n) => n + 1) } }
}
