import { CompletionSnapshotSchema, createCompletionDocument } from './completion'
import { GatewayErrorDetailsSchema } from './errors'
import { productionSnapshots } from './production-fixtures'

// Synthetic contract data only. No public work or photograph is included.
const production = productionSnapshots.allStepsCompleted
const at = '2026-11-06T00:02:00.000Z'
const craft = { ...production.craft, status: 'completed', completedAt: at, updatedAt: at, revision: production.craft.revision + 1 }
export const completionSnapshots = {
  withoutPhoto: CompletionSnapshotSchema.parse({ ...production, craft, completion: createCompletionDocument(at, null) }),
  withPhoto: CompletionSnapshotSchema.parse({ ...production, craft, completion: createCompletionDocument(at, `crafts/${craft.id}/completion/contract-only.jpg`) }),
}
export const completionErrorFixtures = {
  unfinished: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'STEPS_NOT_COMPLETED' }),
  forbidden: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'NOT_CRAFT_OWNER' }),
  missingPhoto: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'IMAGE_NOT_FOUND' }),
  unavailable: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'TEMPORARILY_UNAVAILABLE' }),
}
