import { signInAnonymously } from 'firebase/auth'
import type { UserCredential } from 'firebase/auth'
import { getFirebaseServices } from './client'

let signInFlight: Promise<UserCredential> | undefined
export async function ensureGuestUserId(): Promise<string> {
  const { auth } = getFirebaseServices()
  await auth.authStateReady()
  if (!auth.currentUser) {
    signInFlight ??= signInAnonymously(auth)
    try { await signInFlight } finally { signInFlight = undefined }
  }
  if (!auth.currentUser) throw new Error('Missing authentication state')
  return auth.currentUser.uid
}
