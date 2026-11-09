import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { GatewayError, MaterialRecognitionResponseSchema, RecognitionFailureReasonSchema } from '@rekt/shared'
import type { RecognizeMaterialsInput, MaterialRecognitionResponse } from '@rekt/shared'
import { database, readCraft } from '../../lib/database'
import { requireCraftOwner, requireState } from '../../lib/auth'
import { fail } from '../../lib/errors'
import type { MaterialImage } from './image'
import { parseMaterialCandidates } from './output'
import { MATERIALS_PROMPT_VERSION } from '../../prompts/materials-v1'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const JOB_TTL_MS = 90_000
export interface RecognitionDependencies {
  engine: MaterialRecognitionResponse['engine']
  loadImage: (input: RecognizeMaterialsInput) => Promise<MaterialImage>
  infer: (image: MaterialImage, input: RecognizeMaterialsInput) => Promise<unknown>
}

export async function runMaterialRecognition(uid: string, input: RecognizeMaterialsInput, dependencies: RecognitionDependencies): Promise<MaterialRecognitionResponse> {
  if (!input.imagePath.startsWith(`crafts/${input.craftId}/materials/`)) fail('VALIDATION_FAILED')
  const craftRef = database.doc(`crafts/${input.craftId}`)
  const requestRef = craftRef.collection('recognitionRequests').doc(hash(`${uid}\0${input.requestId}`))
  const inputHash = hash(JSON.stringify(input))
  const base = {
    schemaVersion: 2 as const, requestId: input.requestId, craftId: input.craftId, craftRevision: input.expectedCraftRevision,
    imagePath: input.imagePath, imageGeneration: input.imageGeneration, engine: dependencies.engine,
    promptVersion: MATERIALS_PROMPT_VERSION, requiresConfirmation: true as const,
  }
  const claim = await database.runTransaction(async (transaction) => {
    const [craftSnapshot, requestSnapshot] = await transaction.getAll(craftRef, requestRef)
    if (!craftSnapshot || !requestSnapshot) fail('INTERNAL_ERROR')
    if (!craftSnapshot.exists) fail('CRAFT_NOT_FOUND')
    const craft = readCraft(input.craftId, craftSnapshot.data())
    requireCraftOwner(craft, uid)
    requireState(craft, ['materials', 'project_selection'])
    if (requestSnapshot.exists && requestSnapshot.data()!.inputHash !== inputHash) fail('IDEMPOTENCY_CONFLICT')
    if (craft.revision !== input.expectedCraftRevision) fail('STALE_REVISION')
    const now = Timestamp.now()
    if (requestSnapshot.exists) {
      const job = requestSnapshot.data()!
      if (job.state === 'completed') return { kind: 'completed' as const, response: MaterialRecognitionResponseSchema.parse(job.response) }
      if (job.state !== 'pending' || !(job.deadline instanceof Timestamp)) fail('INTERNAL_ERROR')
      if (job.deadline.toMillis() > now.toMillis()) fail('AI_REQUEST_IN_PROGRESS')
      // A killed/timed-out invocation is never restarted with the same ID.
      const response = MaterialRecognitionResponseSchema.parse({ ...job.base, status: 'failed', reason: 'AI_TIMEOUT' })
      transaction.update(requestRef, { state: 'completed', response, finishedAt: now })
      return { kind: 'completed' as const, response }
    }
    const uidUsage = database.doc(`aiUsage/materials-${hash(uid)}`)
    const globalUsage = database.doc('aiUsage/materials-global')
    const [uidCounter, globalCounter] = await transaction.getAll(uidUsage, globalUsage)
    if (!uidCounter || !globalCounter) fail('INTERNAL_ERROR')
    const day = now.toDate().toISOString().slice(0, 10)
    const previous = uidCounter.data()
    const activeWindow = previous?.windowStartedAt instanceof Timestamp && now.toMillis() - previous.windowStartedAt.toMillis() < 60_000
    const minuteCount = activeWindow ? Number(previous!.minuteCount) || 0 : 0
    const dayCount = previous?.day === day ? Number(previous.dayCount) || 0 : 0
    const globalCount = globalCounter.data()?.day === day ? Number(globalCounter.data()!.dayCount) || 0 : 0
    if (minuteCount >= 3) fail('RATE_LIMITED')
    if (dayCount >= 20 || globalCount >= 50) fail('AI_BUDGET_EXHAUSTED')
    transaction.set(uidUsage, { day, dayCount: dayCount + 1, minuteCount: minuteCount + 1, windowStartedAt: activeWindow ? previous!.windowStartedAt : now })
    transaction.set(globalUsage, { day, dayCount: globalCount + 1 })
    transaction.create(requestRef, { schemaVersion: 2, inputHash, base, state: 'pending', createdAt: now, deadline: Timestamp.fromMillis(now.toMillis() + JOB_TTL_MS) })
    return { kind: 'run' as const }
  })
  if (claim.kind === 'completed') return claim.response
  let response: MaterialRecognitionResponse
  try {
    const image = await dependencies.loadImage(input)
    const result = parseMaterialCandidates(await dependencies.infer(image, input), input.requestId)
    response = MaterialRecognitionResponseSchema.parse({ ...base, status: 'succeeded', result })
  } catch (error) {
    const reason = RecognitionFailureReasonSchema.safeParse(error instanceof GatewayError ? error.reason : undefined)
    response = MaterialRecognitionResponseSchema.parse({ ...base, status: 'failed', reason: reason.success ? reason.data : 'AI_UNAVAILABLE' })
  }
  return database.runTransaction(async (transaction) => {
    const [craftSnapshot, requestSnapshot] = await transaction.getAll(craftRef, requestRef)
    if (!craftSnapshot || !requestSnapshot) fail('INTERNAL_ERROR')
    const job = requestSnapshot.data()
    if (!job || job.inputHash !== inputHash) fail('INTERNAL_ERROR')
    if (job.state === 'completed') return MaterialRecognitionResponseSchema.parse(job.response)
    if (!craftSnapshot.exists) fail('CRAFT_NOT_FOUND')
    const craft = readCraft(input.craftId, craftSnapshot.data())
    requireCraftOwner(craft, uid)
    if (!['materials', 'project_selection'].includes(craft.status)) response = MaterialRecognitionResponseSchema.parse({ ...base, status: 'failed', reason: 'INVALID_CRAFT_STATE' })
    else if (craft.revision !== input.expectedCraftRevision) response = MaterialRecognitionResponseSchema.parse({ ...base, status: 'failed', reason: 'STALE_REVISION' })
    transaction.update(requestRef, { state: 'completed', response, finishedAt: Timestamp.now() })
    return response
  })
}
