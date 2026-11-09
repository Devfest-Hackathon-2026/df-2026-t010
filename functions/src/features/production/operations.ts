import { Timestamp } from 'firebase-admin/firestore'
import type { Transaction } from 'firebase-admin/firestore'
import { buildProjectCandidates, evaluateProjectCandidates, CandidatesDocumentSchema, createProductionDocument, craftDocumentToSnapshot, getProductionProgress, isAllowedAiProject, MaterialsDocumentSchema, ProductionSnapshotSchema } from '@rekt/shared'
import type { CompleteStepInput, ProductionSnapshot, StartCraftInput } from '@rekt/shared'
import { requireCraftOwner, requireState } from '../../lib/auth'
import { database, readCraft, storeCraft, storeProduction, toWire } from '../../lib/database'
import { fail } from '../../lib/errors'
import { consumeOperationLimit, operationRecord, receiptCraftId } from '../../lib/operation'
import { getProjectCatalog, ProjectStateSchema } from '../projects/catalog'
import type { ProjectCatalog } from '../projects/catalog'
import { readCurrentProduction } from './state'

type Inputs = { startCraft: StartCraftInput; completeStep: CompleteStepInput }
type Operation = keyof Inputs

export async function runProductionOperation<O extends Operation>(operation: O, uid: string, input: Inputs[O], catalogProvider: () => ProjectCatalog = getProjectCatalog): Promise<ProductionSnapshot> {
  const { receiptRef, inputHash } = operationRecord(uid, operation, input)
  const cachedResult = async (transaction: Transaction) => {
    const craftId = receiptCraftId(await transaction.get(receiptRef), inputHash)
    return craftId === undefined ? undefined : (await readCurrentProduction(transaction, craftId, uid)).snapshot
  }
  // A successful retry rechecks ownership and returns current frozen progress,
  // including after completion or a later catalog deployment. It never restarts.
  const previous = await database.runTransaction(cachedResult)
  if (previous) return previous
  await consumeOperationLimit(uid, operation, operation === 'startCraft' ? 10 : 120)
  const catalog = operation === 'startCraft' ? catalogProvider() : undefined
  return database.runTransaction(async (transaction) => {
    const cached = await cachedResult(transaction)
    if (cached) return cached
    const now = Timestamp.now()
    const at = now.toDate().toISOString()
    let snapshot: ProductionSnapshot
    if (operation === 'startCraft') {
      const data = input as StartCraftInput
      const craftRef = database.doc(`crafts/${data.craftId}`)
      const materialsRef = craftRef.collection('workshop').doc('materials')
      const candidatesRef = craftRef.collection('workshop').doc('candidates')
      const stateRef = craftRef.collection('projectState').doc('current')
      const productionRef = craftRef.collection('workshop').doc('production')
      const [root, inventory, choices, state, existing] = await transaction.getAll(craftRef, materialsRef, candidatesRef, stateRef, productionRef)
      if (!root?.exists) fail('CRAFT_NOT_FOUND')
      const craft = readCraft(data.craftId, root.data())
      requireCraftOwner(craft, uid)
      requireState(craft, ['project_selection'])
      const materials = MaterialsDocumentSchema.safeParse(toWire(inventory?.data()))
      if (!materials.success || materials.data.confirmedAt === null) fail('CANDIDATES_NOT_READY')
      if (materials.data.revision !== data.materialRevision) fail('STALE_REVISION')
      const candidates = CandidatesDocumentSchema.safeParse(toWire(choices?.data()))
      const proof = ProjectStateSchema.safeParse(state?.data())
      if (!candidates.success || candidates.data.materialRevision !== data.materialRevision || !proof.success || !proof.data.confirmed || proof.data.materialRevision !== data.materialRevision || (!candidates.data.source && proof.data.catalogRevision !== catalog!.revision)) fail('CANDIDATES_NOT_READY')
      const choicesCatalog = candidates.data.source ? candidates.data.templates! : catalog!.templates
      const template = choicesCatalog.find((entry) => entry.id === data.templateId)
      const offered = candidates.data.candidates.find((entry) => entry.templateId === data.templateId)
      const recalculated = (candidates.data.source ? evaluateProjectCandidates : buildProjectCandidates)(choicesCatalog, materials.data, at).candidates.find((entry) => entry.templateId === data.templateId)
      if (!template || !offered?.feasible || offered.missing.length || !recalculated?.feasible) fail('CANDIDATES_NOT_READY')
      if (candidates.data.source === 'ai' && !template.verified && !isAllowedAiProject(template)) fail('AI_UNSAFE_PROJECT')
      if (existing?.exists) fail('PRODUCTION_NOT_READY')
      const production = createProductionDocument(template, data.materialRevision, at)
      craft.status = 'crafting'
      craft.selectedTemplateId = template.id
      craft.revision++
      craft.updatedAt = at
      snapshot = ProductionSnapshotSchema.parse({ ...craftDocumentToSnapshot(data.craftId, craft), production })
      transaction.create(productionRef, storeProduction(production))
      transaction.set(craftRef, storeCraft(craft))
    } else {
      const data = input as CompleteStepInput
      const current = await readCurrentProduction(transaction, data.craftId, uid)
      const { craft, production } = current
      const step = production.steps.find((entry) => entry.stepId === data.stepId)
      if (!step) fail('STEP_NOT_FOUND')
      if (data.expectedRevision > production.revision) fail('STALE_REVISION')
      // Already finished steps are harmless, even with a different requestId.
      // Save a receipt, but preserve all timestamps/revisions and completed state.
      if (step.completedAt !== null) snapshot = current.snapshot
      else {
        if (data.expectedRevision !== production.revision) fail('STALE_REVISION')
        requireState(craft, ['crafting'])
        if (getProductionProgress(production).nextStepId !== data.stepId) fail('DEPENDENCY_NOT_COMPLETED')
        step.completedAt = at
        production.revision++
        craft.revision++
        craft.updatedAt = at
        snapshot = ProductionSnapshotSchema.parse({ ...craftDocumentToSnapshot(data.craftId, craft), production })
        transaction.set(current.productionRef, storeProduction(production))
        transaction.set(current.craftRef, storeCraft(craft))
      }
    }
    transaction.create(receiptRef, { inputHash, craftId: input.craftId, createdAt: now })
    return snapshot
  })
}
