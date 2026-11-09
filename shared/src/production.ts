import { CraftSnapshotSchema } from './crafts'
import { ProductionDocumentSchema } from './workshop'
import type { ProductionDocument, Template } from './workshop'

export const ProductionSnapshotSchema = CraftSnapshotSchema.extend({ production: ProductionDocumentSchema }).refine(
  ({ craft, production }) => ['crafting', 'completed'].includes(craft.status)
    && craft.selectedTemplateId === production.template.id
    && (craft.status !== 'completed' || production.steps.every((step) => step.completedAt !== null)),
  'Craft and frozen production do not match',
)
export type ProductionSnapshot = ReturnType<typeof ProductionSnapshotSchema.parse>

export function createProductionDocument(template: Template, materialRevision: number, startedAt: string): ProductionDocument {
  return ProductionDocumentSchema.parse({ schemaVersion: 2, revision: 0, template, materialRevision, startedAt,
    steps: template.steps.map((step) => ({ stepId: step.id, completedAt: null })),
  })
}
// Display helper only. The server independently authorizes and validates each mutation.
// All steps belong to the owner; the first unfinished step is the only available one.
export function getProductionProgress(production: ProductionDocument) {
  const nextStepId = production.steps.find((step) => step.completedAt === null)?.stepId ?? null
  return { nextStepId, allStepsCompleted: nextStepId === null,
    steps: production.steps.map((step) => ({ stepId: step.stepId,
      status: step.completedAt !== null ? 'completed' as const : step.stepId === nextStepId ? 'available' as const : 'locked' as const,
    })),
  }
}
