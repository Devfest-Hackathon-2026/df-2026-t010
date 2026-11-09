import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { CreateCraftInputSchema, craftDocumentToSnapshot } from '@rekt/shared'
import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { requireCraftOwner, requireUserId } from '../../lib/auth'
import { database, readCraft, storeCraft } from '../../lib/database'
import { fail, parseInput } from '../../lib/errors'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const createCraft = onCall({ region: 'asia-northeast1', timeoutSeconds: 20, memory: '256MiB', maxInstances: 1, minInstances: 0 }, async (request) => {
  const uid = requireUserId(request.auth)
  const input = parseInput(CreateCraftInputSchema, request.data)
  const receiptRef = database.doc(`operationReceipts/${hash(`${uid}\0createCraft\0${input.requestId}`)}`)
  const inputHash = hash(JSON.stringify(input))
  try {
    return await database.runTransaction(async (transaction) => {
      const receipt = (await transaction.get(receiptRef)).data()
      if (receipt) {
        if (receipt.inputHash !== inputHash) fail('IDEMPOTENCY_CONFLICT')
        if (typeof receipt.craftId !== 'string') fail('INTERNAL_ERROR')
        const saved = await transaction.get(database.doc(`crafts/${receipt.craftId}`))
        if (!saved.exists) fail('CRAFT_NOT_FOUND')
        const craft = readCraft(saved.id, saved.data())
        requireCraftOwner(craft, uid)
        return craftDocumentToSnapshot(saved.id, craft)
      }
      const limitRef = database.doc(`operationLimits/${hash(`${uid}\0createCraft`)}`)
      const previous = (await transaction.get(limitRef)).data()
      const now = Timestamp.now()
      const current = previous?.windowStart instanceof Timestamp && now.toMillis() - previous.windowStart.toMillis() < 60_000
      const count = current && typeof previous?.attempts === 'number' ? previous.attempts : 0
      if (count >= 10) fail('RATE_LIMITED')
      const reference = database.collection('crafts').doc()
      const at = now.toDate().toISOString()
      const craft = { schemaVersion: 2 as const, ownerUid: uid, locale: input.locale, status: 'materials' as const, revision: 0,
        selectedTemplateId: null, createdAt: at, updatedAt: at, completedAt: null }
      transaction.create(reference, storeCraft(craft))
      transaction.create(receiptRef, { inputHash, craftId: reference.id, createdAt: now })
      transaction.set(limitRef, { windowStart: current ? previous!.windowStart : now, attempts: count + 1, expiresAt: Timestamp.fromMillis(now.toMillis() + 60_000) })
      return craftDocumentToSnapshot(reference.id, craft)
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    return fail('TEMPORARILY_UNAVAILABLE')
  }
})
