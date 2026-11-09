import { httpsCallable } from 'firebase/functions'
import { CandidatesDocumentSchema, GenerateProjectsInputSchema, TranslateProjectsInputSchema } from '@rekt/shared'
import type { ProjectsGateway } from '../contracts'
import { gatewayError } from '../errors'
import { verifiedTemplates } from '../templates'
import { getFirebaseServices } from './client'
import { ensureGuestUserId } from './auth'
import { toWire } from './crafts'
import { subscribeToCraftDocument } from './craftDocuments'

// 候補の生成は #33 のFunctionsで行う。画面は本人の候補文書を購読するだけ。
export const firebaseProjectsGateway: ProjectsGateway = {
  async generateProjects(input) {
    try {
      await ensureGuestUserId()
      const result = await httpsCallable(getFirebaseServices().functions, 'generateProjects', { timeout: 90_000 })(GenerateProjectsInputSchema.parse(input))
      return CandidatesDocumentSchema.parse(result.data)
    } catch (cause) { throw gatewayError(cause) }
  },
  async translateProjects(input) {
    try {
      await ensureGuestUserId()
      await httpsCallable(getFirebaseServices().functions, 'generateProjects', { timeout: 90_000 })(TranslateProjectsInputSchema.parse({ ...input, action: 'translate' }))
    } catch (cause) { throw gatewayError(cause) }
  },
  listTemplates: async () => verifiedTemplates,
  subscribeToCandidates(craftId, next, error) {
    return subscribeToCraftDocument(['crafts', craftId, 'workshop', 'candidates'], (snapshot) => {
      next(snapshot.exists() ? CandidatesDocumentSchema.parse(toWire(snapshot.data())) : null)
    }, error)
  },
}
