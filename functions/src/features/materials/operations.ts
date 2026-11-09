import { Timestamp } from 'firebase-admin/firestore'
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore'
import { buildProjectCandidates, craftDocumentToSnapshot, MaterialsDocumentSchema } from '@rekt/shared'
import type { ConfirmMaterialsInput, EditMaterialsInput, CraftSnapshot } from '@rekt/shared'
import { requireCraftOwner, requireState } from '../../lib/auth'
import { database, readCraft, storeCraft, toWire } from '../../lib/database'
import { fail } from '../../lib/errors'
import { consumeOperationLimit, operationRecord, receiptCraftId } from '../../lib/operation'
import { getProjectCatalog, ProjectStateSchema } from '../projects/catalog'
import type { ProjectCatalog } from '../projects/catalog'

type Inputs = { editMaterials: EditMaterialsInput; confirmMaterials: ConfirmMaterialsInput }
type Operation = keyof Inputs
async function existingResult(snapshot: DocumentSnapshot, inputHash: string, uid: string, transaction?: Transaction): Promise<CraftSnapshot | undefined> {
  const craftId = receiptCraftId(snapshot, inputHash)
  if (craftId === undefined) return undefined
  const ref = database.doc(`crafts/${craftId}`)
  const document = transaction ? await transaction.get(ref) : await ref.get()
  if (!document.exists) fail('CRAFT_NOT_FOUND')
  const craft = readCraft(document.id, document.data())
  requireCraftOwner(craft, uid)
  // Return current state: retries never reapply an earlier edit/confirmation.
  return craftDocumentToSnapshot(document.id, craft)
}
export async function runMaterialsOperation<O extends Operation>(operation: O, uid: string, input: Inputs[O], catalogProvider: () => ProjectCatalog = getProjectCatalog): Promise<CraftSnapshot> {
  const { receiptRef, inputHash } = operationRecord(uid, operation, input)
  const previous = await existingResult(await receiptRef.get(), inputHash, uid)
  if (previous) return previous
  // Failed state/ownership/revision attempts count too, outside the business tx.
  await consumeOperationLimit(uid, operation, operation === 'editMaterials' ? 60 : 10)
  const catalog = catalogProvider()
  return database.runTransaction(async (transaction) => {
    const cached = await existingResult(await transaction.get(receiptRef), inputHash, uid, transaction)
    if (cached) return cached
    const craftRef = database.doc(`crafts/${input.craftId}`)
    const materialsRef = craftRef.collection('workshop').doc('materials')
    const candidatesRef = craftRef.collection('workshop').doc('candidates')
    const stateRef = craftRef.collection('projectState').doc('current')
    const [craftSnapshot, materialsSnapshot, stateSnapshot] = await transaction.getAll(craftRef, materialsRef, stateRef)
    if (!craftSnapshot || !materialsSnapshot || !stateSnapshot) fail('INTERNAL_ERROR')
    if (!craftSnapshot.exists) fail('CRAFT_NOT_FOUND')
    const craft = readCraft(input.craftId, craftSnapshot.data())
    requireCraftOwner(craft, uid)
    requireState(craft, operation === 'editMaterials' ? ['materials', 'project_selection'] : ['materials'])
    const materials = materialsSnapshot.exists ? MaterialsDocumentSchema.parse(toWire(materialsSnapshot.data())) : undefined
    const revision = materials?.revision ?? 0
    if (input.expectedRevision !== revision) fail('STALE_REVISION')
    const state = ProjectStateSchema.safeParse(stateSnapshot.data())
    const fresh = state.success && state.data.materialRevision === revision && state.data.catalogRevision === catalog.revision
    const now = Timestamp.now()
    if (operation === 'editMaterials') {
      const data = input as EditMaterialsInput
      const answers = data.checks ?? []
      const knownChecks = new Set(catalog.templates.flatMap((template) => template.checks.map((check) => check.id)))
      // A removed catalog question may still be in a stored form. Drop that stale
      // answer on reopen, while rejecting newly invented/unknown question IDs.
      const retiredChecks = new Set(!fresh ? materials?.checks.map((answer) => answer.id) ?? [] : [])
      if (answers.some((answer) => !knownChecks.has(answer.id) && !retiredChecks.has(answer.id))) fail('VALIDATION_FAILED')
      // Copied answers from older material/catalog content are never accepted as fresh.
      // After this reset the owner answers the current questions in a separate edit.
      const invalidateChecks = !fresh || JSON.stringify(materials?.items ?? []) !== JSON.stringify(data.items)
      const checks = answers.filter((answer) => knownChecks.has(answer.id)).map((answer) => ({ ...answer, confirmed: invalidateChecks ? null : answer.confirmed }))
      const updated = MaterialsDocumentSchema.parse({ schemaVersion: 2, revision: revision + 1, items: data.items, tools: data.tools, checks, updatedAt: now.toDate().toISOString(), confirmedAt: null })
      transaction.set(materialsRef, { ...updated, updatedAt: now })
      transaction.delete(candidatesRef)
      transaction.set(stateRef, { schemaVersion: 2, materialRevision: revision + 1, catalogRevision: catalog.revision, confirmed: false })
      craft.status = 'materials'
    } else {
      if (!materials?.items.length) fail('VALIDATION_FAILED')
      if (!fresh || state.data.confirmed) fail('CANDIDATES_NOT_READY')
      const candidates = buildProjectCandidates(catalog.templates, materials, now.toDate().toISOString())
      transaction.update(materialsRef, { confirmedAt: now })
      transaction.set(candidatesRef, { ...candidates, generatedAt: now })
      transaction.set(stateRef, { ...state.data, confirmed: true })
      craft.status = 'project_selection'
    }
    craft.revision++
    craft.updatedAt = now.toDate().toISOString()
    transaction.set(craftRef, storeCraft(craft))
    transaction.create(receiptRef, { inputHash, craftId: input.craftId, createdAt: now })
    return craftDocumentToSnapshot(input.craftId, craft)
  })
}
