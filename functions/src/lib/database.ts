import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { CraftDocumentSchema, craftDocumentToSnapshot } from '@rekt/shared'
import type { CraftDocument, ProductionDocument } from '@rekt/shared'

if (!getApps().length) initializeApp()
export const database = getFirestore()
export function toWire(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(toWire)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toWire(entry)]))
  return value
}
export function readCraft(id: string, value: unknown): CraftDocument {
  const craft = CraftDocumentSchema.parse(toWire(value))
  craftDocumentToSnapshot(id, craft)
  return craft
}
export function storeCraft(craft: CraftDocument) {
  return { ...craft, createdAt: Timestamp.fromDate(new Date(craft.createdAt)), updatedAt: Timestamp.fromDate(new Date(craft.updatedAt)), completedAt: craft.completedAt ? Timestamp.fromDate(new Date(craft.completedAt)) : null }
}
export function storeProduction(production: ProductionDocument) {
  return { ...production, startedAt: Timestamp.fromDate(new Date(production.startedAt)),
    steps: production.steps.map((step) => ({ ...step, completedAt: step.completedAt === null ? null : Timestamp.fromDate(new Date(step.completedAt)) })),
  }
}
