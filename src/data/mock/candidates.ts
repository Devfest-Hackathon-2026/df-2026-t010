import { z } from 'zod'
import { buildProjectCandidates, CandidatesDocumentSchema } from '@rekt/shared'
import type { CandidatesDocument } from '@rekt/shared'

// 体験版もFunctionsと同じ純粋な判定関数を使う。画面はゲートウェイの結果だけを表示する。
const key = 'co-make:mock-candidates:v2'
const StoreSchema = z.record(z.string(), CandidatesDocumentSchema)
const read = (storage: Storage) => StoreSchema.parse(JSON.parse(storage.getItem(key) ?? '{}'))
export const candidatesChangeEvent = 'co-make:candidates-change'

export function readMockCandidates(storage: Storage, craftId: string): CandidatesDocument | null {
  return read(storage)[craftId] ?? null
}
export function writeMockCandidates(storage: Storage, craftId: string, document: CandidatesDocument | null) {
  const store = read(storage)
  if (document) store[craftId] = CandidatesDocumentSchema.parse(document)
  else delete store[craftId]
  storage.setItem(key, JSON.stringify(store))
  window.dispatchEvent(new Event(candidatesChangeEvent))
}

// 単位や微小な数量不足も実サーバーと同じ規則で判定する。
export const buildMockCandidates = buildProjectCandidates
