import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import type { Transaction } from 'firebase-admin/firestore'
import { z } from 'zod'
import { PHOTO_LIMITS, PhotoUploadReservationSchema, ReservePhotoUploadInputSchema, getProductionProgress, photoUploadPath } from '@rekt/shared'
import type { ReservePhotoUploadInput } from '@rekt/shared'
import { database, readCraft, toWire } from '../../lib/database'
import { requireCraftOwner, requireState } from '../../lib/auth'
import { fail, parseInput } from '../../lib/errors'
import { consumeOperationLimit } from '../../lib/operation'
import { readCurrentProduction } from '../production/state'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const CraftQuotaSchema = z.strictObject({ schemaVersion: z.literal(1), materials: z.int().nonnegative(), completion: z.int().nonnegative(), bytes: z.int().nonnegative() })
const DailyQuotaSchema = z.strictObject({ schemaVersion: z.literal(1), day: z.iso.date(), files: z.int().nonnegative(), bytes: z.int().nonnegative() })
function dailyQuota(value: unknown, day: string) {
  if (value === undefined) return { schemaVersion: 1 as const, day, files: 0, bytes: 0 }
  const parsed = DailyQuotaSchema.safeParse(value)
  if (!parsed.success) fail('INTERNAL_ERROR')
  return parsed.data.day === day ? parsed.data : { schemaVersion: 1 as const, day, files: 0, bytes: 0 }
}

export async function runReservePhotoUpload(uid: string, raw: ReservePhotoUploadInput) {
  const input = parseInput(ReservePhotoUploadInputSchema, raw)
  const path = photoUploadPath(input)
  const filename = path.slice(path.lastIndexOf('/') + 1)
  const root = database.doc(`crafts/${input.craftId}`)
  const permitRef = root.collection('photoUploads').doc(`${input.kind}-${filename}`)
  const inputHash = hash(JSON.stringify(input))
  const read = async (tx: Transaction) => {
    const [saved, permit] = await tx.getAll(root, permitRef)
    if (!saved?.exists) fail('CRAFT_NOT_FOUND')
    const craft = readCraft(input.craftId, saved.data())
    requireCraftOwner(craft, uid)
    if (!permit?.exists) return { craft, previous: undefined }
    const { ownerUid, inputHash: previousHash, ...data } = permit.data()!
    if (ownerUid !== uid) fail('NOT_CRAFT_OWNER')
    if (previousHash !== inputHash) fail('IDEMPOTENCY_CONFLICT')
    const result = PhotoUploadReservationSchema.safeParse(toWire(data))
    if (!result.success || result.data.path !== path) fail('INTERNAL_ERROR')
    return { craft, previous: result.data }
  }
  const previous = await database.runTransaction(async (tx) => (await read(tx)).previous)
  if (previous) return previous
  await consumeOperationLimit(uid, 'reservePhotoUpload', 30)
  return database.runTransaction(async (tx) => {
    const current = await read(tx)
    if (current.previous) return current.previous
    if (input.kind === 'materials') requireState(current.craft, ['materials', 'project_selection'])
    else {
      const production = await readCurrentProduction(tx, input.craftId, uid)
      requireState(production.craft, ['crafting'])
      if (!getProductionProgress(production.production).allStepsCompleted) fail('STEPS_NOT_COMPLETED')
      if (production.production.revision !== production.production.steps.length) fail('PRODUCTION_NOT_READY')
    }
    const quotaRef = root.collection('photoUploads').doc('_quota')
    const uidRef = database.doc(`photoUploadUsage/uid-${hash(uid)}`)
    const globalRef = database.doc('photoUploadUsage/global')
    const [quota, uidUsage, globalUsage] = await tx.getAll(quotaRef, uidRef, globalRef)
    const now = Timestamp.now()
    const day = now.toDate().toISOString().slice(0, 10)
    const craft = CraftQuotaSchema.safeParse(quota?.data() ?? { schemaVersion: 1, materials: 0, completion: 0, bytes: 0 })
    if (!craft.success) fail('INTERNAL_ERROR')
    const user = dailyQuota(uidUsage?.data(), day)
    const project = dailyQuota(globalUsage?.data(), day)
    if (craft.data[input.kind] >= PHOTO_LIMITS[input.kind] || craft.data.bytes + input.sizeBytes > PHOTO_LIMITS.craftBytes
      || user.files >= PHOTO_LIMITS.uidDailyFiles || user.bytes + input.sizeBytes > PHOTO_LIMITS.uidDailyBytes
      || project.files >= PHOTO_LIMITS.projectDailyFiles || project.bytes + input.sizeBytes > PHOTO_LIMITS.projectDailyBytes) fail('PHOTO_LIMIT_REACHED')
    const reservation = PhotoUploadReservationSchema.parse({ ...input, schemaVersion: 2, path, createdAt: now.toDate().toISOString() })
    tx.create(permitRef, { ...reservation, ownerUid: uid, inputHash, createdAt: now })
    tx.set(quotaRef, { ...craft.data, [input.kind]: craft.data[input.kind] + 1, bytes: craft.data.bytes + input.sizeBytes })
    tx.set(uidRef, { ...user, files: user.files + 1, bytes: user.bytes + input.sizeBytes })
    tx.set(globalRef, { ...project, files: project.files + 1, bytes: project.bytes + input.sizeBytes })
    return reservation
  })
}
