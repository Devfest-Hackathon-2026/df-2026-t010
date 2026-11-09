import { createContext, useContext } from 'react'
import type { CraftSnapshot, ProductionSnapshot } from '@rekt/shared'
import type { CraftGateway } from '../data/contracts'

export type CraftSessionSnapshot = CraftSnapshot | ProductionSnapshot
export interface CraftContextValue { snapshot: CraftSessionSnapshot; uid: string; gateway: CraftGateway; applySnapshot: (snapshot: CraftSessionSnapshot) => void }
export const CraftContext = createContext<CraftContextValue | null>(null)
export function useCraft() {
  const context = useContext(CraftContext)
  if (!context) throw new Error('Craft context is required')
  return context
}
export function latestSnapshot(current: CraftSessionSnapshot | null, incoming: CraftSessionSnapshot) {
  if (current?.craft.id !== incoming.craft.id) return incoming
  if (current.craft.revision > incoming.craft.revision) return current
  if (current.craft.revision === incoming.craft.revision && 'production' in current && !('production' in incoming)) return current
  return incoming
}
