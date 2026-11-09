import { z } from 'zod'
import { CreateCraftInputSchema, CraftSnapshotSchema, GatewayError, IdSchema } from '@rekt/shared'
import type { CraftSnapshot } from '@rekt/shared'
import type { CraftGateway } from '../contracts'
import { requestId } from '../request-id'
import { gatewayError } from '../errors'

const key = 'co-make:mock-crafts:v2'
const StoreSchema = z.strictObject({ crafts: z.record(z.string(), CraftSnapshotSchema), receipts: z.record(z.string(), z.strictObject({ payload: z.string(), craftId: z.string() })) })
const read = (storage: Storage) => StoreSchema.parse(JSON.parse(storage.getItem(key) ?? '{"crafts":{},"receipts":{}}'))
export function readMockCraft(storage: Storage, craftId: string) { return read(storage).crafts[craftId] }
export function listMockCrafts(storage: Storage) { return Object.values(read(storage).crafts) }
export function writeMockCraft(storage: Storage, snapshot: CraftSnapshot) {
  const store = read(storage)
  store.crafts[snapshot.craft.id] = CraftSnapshotSchema.parse(snapshot)
  storage.setItem(key, JSON.stringify(store))
  window.dispatchEvent(new Event('co-make:craft-change'))
}
export function createMockCraftGateway(storage: Storage, uid: string): CraftGateway {
  return {
    getUserId: async () => uid,
    async createCraft(raw) {
      const input = CreateCraftInputSchema.parse(raw)
      const store = read(storage)
      const receiptKey = `${uid}:createCraft:${input.requestId}`
      const previous = store.receipts[receiptKey]
      if (previous) {
        if (previous.payload !== JSON.stringify(input)) throw new GatewayError('IDEMPOTENCY_CONFLICT')
        const snapshot = store.crafts[previous.craftId]
        if (!snapshot) throw new GatewayError('CRAFT_NOT_FOUND')
        if (snapshot.craft.ownerUid !== uid) throw new GatewayError('NOT_CRAFT_OWNER')
        return snapshot
      }
      const id = requestId(); const at = new Date().toISOString()
      const result = CraftSnapshotSchema.parse({ schemaVersion: 2, craft: { id, ownerUid: uid, locale: input.locale, status: 'materials', revision: 0, selectedTemplateId: null, createdAt: at, updatedAt: at, completedAt: null } })
      store.crafts[id] = result
      store.receipts[receiptKey] = { payload: JSON.stringify(input), craftId: id }
      storage.setItem(key, JSON.stringify(store))
      window.dispatchEvent(new Event('co-make:craft-change'))
      return result
    },
    subscribeToCraft(craftId, next, error) {
      let active = true
      const notify = () => {
        if (!active) return
        try {
          const snapshot = readMockCraft(storage, craftId)
          if (!snapshot) throw new GatewayError('CRAFT_NOT_FOUND')
          if (snapshot.craft.ownerUid !== uid) throw new GatewayError('NOT_CRAFT_OWNER')
          next(snapshot)
        } catch (cause) { error(gatewayError(cause)) }
      }
      window.addEventListener('storage', notify); window.addEventListener('co-make:craft-change', notify)
      queueMicrotask(notify)
      return () => { active = false; window.removeEventListener('storage', notify); window.removeEventListener('co-make:craft-change', notify) }
    },
  }
}
let tabUserId: string | undefined
export function getMockUserId(): string {
  if (tabUserId) return tabUserId
  const saved = localStorage.getItem('co-make:mock-uid')
  tabUserId = IdSchema.safeParse(saved).success ? saved! : requestId()
  localStorage.setItem('co-make:mock-uid', tabUserId)
  return tabUserId
}
export function getMockCraftGateway(): CraftGateway { return createMockCraftGateway(localStorage, getMockUserId()) }
