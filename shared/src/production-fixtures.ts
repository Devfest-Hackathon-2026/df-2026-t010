import { GatewayErrorDetailsSchema } from './errors'
import { craftFixture, productionFixture, templateFixture } from './fixtures'
import { ProductionSnapshotSchema } from './production'

// Synthetic contract data only; never a published/physically verified project.
const at = '2026-11-06T00:01:00.000Z'
const started = { ...craftFixture(), craft: { ...craftFixture().craft, status: 'crafting', revision: 3, selectedTemplateId: templateFixture.id }, production: productionFixture }
const firstStepCompleted = { ...started, production: { ...productionFixture, revision: 1,
  steps: productionFixture.steps.map((step, i) => ({ ...step, completedAt: i === 0 ? at : null })),
} }
export const productionSnapshots = {
  started: ProductionSnapshotSchema.parse(started),
  firstStepCompleted: ProductionSnapshotSchema.parse({ ...firstStepCompleted, craft: { ...started.craft, revision: 4, updatedAt: at } }),
  allStepsCompleted: ProductionSnapshotSchema.parse({ ...started, craft: { ...started.craft, revision: 5, updatedAt: at }, production: {
    ...productionFixture, revision: 2, steps: productionFixture.steps.map((step) => ({ ...step, completedAt: at })),
  } }),
}
export const productionErrorFixtures = {
  locked: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'DEPENDENCY_NOT_COMPLETED' }),
  forbidden: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'NOT_CRAFT_OWNER' }),
  stale: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'STALE_REVISION' }),
  notReady: GatewayErrorDetailsSchema.parse({ schemaVersion: 2, reason: 'PRODUCTION_NOT_READY' }),
}
