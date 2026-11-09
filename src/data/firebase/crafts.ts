import { Timestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { GatewayError, CraftSnapshotSchema, craftDocumentToSnapshot } from '@rekt/shared'
import type { CraftGateway } from '../contracts'
import { gatewayError } from '../errors'
import { getFirebaseServices } from './client'
import { ensureGuestUserId } from './auth'
import { subscribeToCraftDocument } from './craftDocuments'

export function toWire(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(toWire)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toWire(entry)]))
  return value
}
async function mutate(name: string, input: unknown) {
  try {
    await ensureGuestUserId()
    const response = await httpsCallable(getFirebaseServices().functions, name)(input)
    return CraftSnapshotSchema.parse(response.data)
  } catch (error) { throw gatewayError(error) }
}
export const firebaseCraftGateway: CraftGateway = {
  getUserId: ensureGuestUserId,
  createCraft: (input) => mutate('createCraft', input),
  subscribeToCraft(craftId, next, error) {
    return subscribeToCraftDocument(['crafts', craftId], (snapshot) => {
      if (!snapshot.exists()) { error(new GatewayError('CRAFT_NOT_FOUND')); return }
      next(craftDocumentToSnapshot(snapshot.id, toWire(snapshot.data())))
    }, error)
  },
}
