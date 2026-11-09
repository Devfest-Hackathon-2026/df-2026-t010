import type { Transaction } from 'firebase-admin/firestore'
import { craftDocumentToSnapshot, MaterialsDocumentSchema, ProductionDocumentSchema, ProductionSnapshotSchema } from '@rekt/shared'
import { requireCraftOwner, requireState } from '../../lib/auth'
import { database, readCraft, toWire } from '../../lib/database'
import { fail } from '../../lib/errors'

export async function readCurrentProduction(transaction: Transaction, craftId: string, uid: string) {
  const craftRef = database.doc(`crafts/${craftId}`)
  const productionRef = craftRef.collection('workshop').doc('production')
  const materialsRef = craftRef.collection('workshop').doc('materials')
  const [root, saved, inventory] = await transaction.getAll(craftRef, productionRef, materialsRef)
  if (!root?.exists) fail('CRAFT_NOT_FOUND')
  const craft = readCraft(craftId, root.data())
  requireCraftOwner(craft, uid)
  requireState(craft, ['crafting', 'completed'])
  const production = ProductionDocumentSchema.safeParse(toWire(saved?.data()))
  const materials = MaterialsDocumentSchema.safeParse(toWire(inventory?.data()))
  if (!production.success || !materials.success || materials.data.confirmedAt === null || materials.data.revision !== production.data.materialRevision) fail('PRODUCTION_NOT_READY')
  const snapshot = ProductionSnapshotSchema.safeParse({ ...craftDocumentToSnapshot(craftId, craft), production: production.data })
  if (!snapshot.success) fail('PRODUCTION_NOT_READY')
  return { craftRef, productionRef, craft, production: production.data, snapshot: snapshot.data }
}
