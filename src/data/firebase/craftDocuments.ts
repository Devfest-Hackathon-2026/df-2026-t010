import { doc, onSnapshot } from 'firebase/firestore'
import type { DocumentSnapshot } from 'firebase/firestore'
import type { GatewayError } from '@rekt/shared'
import { gatewayError } from '../errors'
import { ensureGuestUserId } from './auth'
import { getFirebaseServices } from './client'

export function subscribeToCraftDocument(
  path: [string, ...string[]],
  next: (snapshot: DocumentSnapshot) => void,
  error: (cause: GatewayError) => void,
): () => void {
  let active = true
  let unsubscribe: (() => void) | undefined
  const report = (cause: unknown) => { if (active) error(gatewayError(cause)) }
  void ensureGuestUserId().then(() => {
    if (!active) return
    const reference = doc(getFirebaseServices().firestore, ...path)
    unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, (snapshot) => {
      // An empty cache cannot establish that the server document is missing.
      if (!active || (snapshot.metadata.fromCache && !snapshot.exists())) return
      try { next(snapshot) } catch (cause) { report(cause) }
    }, report)
  }).catch(report)
  return () => { active = false; unsubscribe?.() }
}
