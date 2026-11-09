import { httpsCallable } from 'firebase/functions'
import { HealthResponseSchema } from '@rekt/shared'
import type { HealthGateway } from '../contracts'
import { getFirebaseServices } from './client'
import { ensureGuestUserId } from './auth'

export const firebaseHealthGateway: HealthGateway = {
  async check() {
    const { functions } = getFirebaseServices()
    await ensureGuestUserId()
    const response = await httpsCallable(functions, 'health')({})
    return HealthResponseSchema.parse(response.data)
  },
}
