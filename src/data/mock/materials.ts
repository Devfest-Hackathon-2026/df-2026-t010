import { z } from 'zod'
import { ConfirmMaterialsInputSchema, EditMaterialsInputSchema, GatewayError, IdSchema, MAX_MATERIAL_IMAGE_BYTES, MaterialRecognitionResponseSchema, MaterialsDocumentSchema, RecognizeMaterialsInputSchema } from '@rekt/shared'
import type { MaterialsDocument, CraftSnapshot, Template } from '@rekt/shared'
import type { MaterialsGateway } from '../contracts'
import { gatewayError } from '../errors'
import { getMockUserId, readMockCraft, writeMockCraft } from './crafts'
import { buildMockCandidates, writeMockCandidates } from './candidates'
import { verifiedTemplates } from '../templates'

const key = 'co-make:mock-materials:v2'
const changeEvent = 'co-make:materials-change'
export function readMockMaterials(storage: Storage, craftId: string): MaterialsDocument | null {
  return StoreSchema.parse(JSON.parse(storage.getItem(key) ?? '{"documents":{},"receipts":{}}')).documents[craftId] ?? null
}
const StoreSchema = z.object({ documents: z.record(z.string(), MaterialsDocumentSchema), receipts: z.record(z.string(), z.string()) })
type Store = z.infer<typeof StoreSchema>
const editable = ['materials', 'project_selection']

// 体験版用。写真は保存せず、材料はこのブラウザのlocalStorageだけに置く。認可・競合の最終判定は #33 のFunctions。
// templatesは候補判定に使う作品一覧。テスト以外では公開済みの検証済み作品だけを渡す。
export function createMockMaterialsGateway(storage: Storage, uid: string, templates: Template[] = verifiedTemplates): MaterialsGateway {
  const read = (): Store => StoreSchema.parse(JSON.parse(storage.getItem(key) ?? '{"documents":{},"receipts":{}}'))
  function owner(craftId: string): CraftSnapshot {
    const snapshot = readMockCraft(storage, craftId)
    if (!snapshot) throw new GatewayError('CRAFT_NOT_FOUND')
    if (snapshot.craft.ownerUid !== uid) throw new GatewayError('NOT_CRAFT_OWNER')
    return snapshot
  }
  function editableCraft(craftId: string): CraftSnapshot {
    const snapshot = owner(craftId)
    if (!editable.includes(snapshot.craft.status)) throw new GatewayError('INVALID_CRAFT_STATE')
    return snapshot
  }
  // 同じrequestIdの再送は同じ入力なら何もしない。異なる入力での再利用は拒否する。
  // afterは材料の保存後・制作状態の更新前に呼ぶ（候補の更新を状態の変化より先に済ませる）。
  function mutate(operation: string, input: { requestId: string; craftId: string }, change: (store: Store, snapshot: CraftSnapshot, now: string) => CraftSnapshot | null, after?: (store: Store, now: string) => void) {
    const snapshot = owner(input.craftId)
    const store = read()
    const receipt = `${uid}:${operation}:${input.requestId}`
    const payload = JSON.stringify(input)
    if (store.receipts[receipt] !== undefined) {
      if (store.receipts[receipt] !== payload) throw new GatewayError('IDEMPOTENCY_CONFLICT')
      return
    }
    const now = new Date().toISOString()
    const nextCraft = change(store, snapshot, now)
    store.receipts[receipt] = payload
    storage.setItem(key, JSON.stringify(store))
    after?.(store, now)
    if (nextCraft) writeMockCraft(storage, nextCraft)
    window.dispatchEvent(new Event(changeEvent))
  }
  return {
    async uploadMaterialPhoto({ craftId, photoId, blob }) {
      if (!IdSchema.safeParse(photoId).success || blob.type !== 'image/jpeg' || blob.size <= 0 || blob.size > MAX_MATERIAL_IMAGE_BYTES) throw new GatewayError('INVALID_IMAGE')
      editableCraft(craftId)
      return { imagePath: `crafts/${craftId}/materials/${photoId}.jpg`, imageGeneration: '1' }
    },
    async recognizeMaterials(raw) {
      const parsed = RecognizeMaterialsInputSchema.safeParse(raw)
      if (!parsed.success) throw new GatewayError('VALIDATION_FAILED')
      const input = parsed.data
      const snapshot = editableCraft(input.craftId)
      if (!input.imagePath.startsWith(`crafts/${input.craftId}/materials/`)) throw new GatewayError('VALIDATION_FAILED')
      if (snapshot.craft.revision !== input.expectedCraftRevision) throw new GatewayError('STALE_REVISION')
      const ja = input.locale === 'ja'
      return MaterialRecognitionResponseSchema.parse({
        schemaVersion: 2, requestId: input.requestId, craftId: input.craftId, craftRevision: input.expectedCraftRevision,
        imagePath: input.imagePath, imageGeneration: input.imageGeneration, engine: 'fixture', promptVersion: 'materials-v1', requiresConfirmation: true,
        status: 'succeeded', result: {
          items: [
            { id: `ai-${input.requestId}-1`, name: ja ? '段ボール' : 'Cardboard', quantity: 2, unit: ja ? '枚' : 'sheets', source: 'ai', confidence: 0.82 },
            { id: `ai-${input.requestId}-2`, name: ja ? '紙コップ' : 'Paper cups', quantity: 6, unit: ja ? '個' : 'pcs', source: 'ai', confidence: 0.64 },
          ],
          warnings: [ja ? '固定応答による開発用データです。実画像の認識結果ではありません。' : 'Development fixture. This is not a recognition result from the uploaded image.'],
        },
      })
    },
    subscribeToMaterials(craftId, next, error) {
      let active = true
      const notify = () => {
        if (!active) return
        try { owner(craftId); next(read().documents[craftId] ?? null) } catch (cause) { error(gatewayError(cause)) }
      }
      window.addEventListener('storage', notify)
      window.addEventListener(changeEvent, notify)
      window.addEventListener('co-make:craft-change', notify)
      queueMicrotask(notify)
      return () => { active = false; window.removeEventListener('storage', notify); window.removeEventListener(changeEvent, notify); window.removeEventListener('co-make:craft-change', notify) }
    },
    async editMaterials(raw) {
      const parsed = EditMaterialsInputSchema.safeParse(raw)
      if (!parsed.success) throw new GatewayError('VALIDATION_FAILED')
      const input = parsed.data
      mutate('editMaterials', input, (store, snapshot, now) => {
        if (!editable.includes(snapshot.craft.status)) throw new GatewayError('INVALID_CRAFT_STATE')
        const current: MaterialsDocument | undefined = store.documents[input.craftId]
        if ((current?.revision ?? 0) !== input.expectedRevision) throw new GatewayError('STALE_REVISION')
        const knownChecks = new Set(templates.flatMap((template) => template.checks.map((check) => check.id)))
        if (input.checks.some((answer) => !knownChecks.has(answer.id))) throw new GatewayError('VALIDATION_FAILED')
        const changed = JSON.stringify(current?.items ?? []) !== JSON.stringify(input.items)
        store.documents[input.craftId] = MaterialsDocumentSchema.parse({
          schemaVersion: 2, revision: input.expectedRevision + 1, items: input.items, tools: input.tools,
          checks: input.checks.map((answer) => ({ ...answer, confirmed: !current || changed ? null : answer.confirmed })), updatedAt: now, confirmedAt: null,
        })
        // 作品選択中の修正は未確定へ戻し、古い候補を使わせない。
        return { ...snapshot, craft: { ...snapshot.craft, status: 'materials', revision: snapshot.craft.revision + 1, updatedAt: now } }
      }, () => writeMockCandidates(storage, input.craftId, null))
    },
    async confirmMaterials(raw) {
      const parsed = ConfirmMaterialsInputSchema.safeParse(raw)
      if (!parsed.success) throw new GatewayError('VALIDATION_FAILED')
      const input = parsed.data
      mutate('confirmMaterials', input, (store, snapshot, now) => {
        if (snapshot.craft.status !== 'materials') throw new GatewayError('INVALID_CRAFT_STATE')
        const current = store.documents[input.craftId]
        if ((current?.revision ?? 0) !== input.expectedRevision) throw new GatewayError('STALE_REVISION')
        if (!current || current.items.length === 0) throw new GatewayError('VALIDATION_FAILED')
        store.documents[input.craftId] = { ...current, confirmedAt: now }
        return { ...snapshot, craft: { ...snapshot.craft, status: 'project_selection', revision: snapshot.craft.revision + 1, updatedAt: now } }
      }, (store, now) => {
        // 確定した版の材料から共通関数で判定する。検証済み作品がなければ候補0件。
        writeMockCandidates(storage, input.craftId, buildMockCandidates(templates, store.documents[input.craftId]!, now))
      })
    },
  }
}

let shared: MaterialsGateway | undefined
export function getMockMaterialsGateway(): MaterialsGateway {
  shared ??= createMockMaterialsGateway(localStorage, getMockUserId())
  return shared
}
