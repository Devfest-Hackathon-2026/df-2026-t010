import { MaterialSchema } from '@rekt/shared'
import type { Material, MaterialsDocument } from '@rekt/shared'

export const MAX_MATERIALS = 50
export const MAX_TOOLS = 30

/** 未作成の材料文書は空・revision 0として扱う（data-model-v1）。 */
export function materialsState(document: MaterialsDocument | null) {
  return { revision: document?.revision ?? 0, items: document?.items ?? [], tools: document?.tools ?? [], checks: document?.checks ?? [], confirmed: document?.confirmedAt != null }
}

// 契約のsourceはai/manualの2値。AI候補を人が直した行はmanualにし、AI由来のIDを残して「AIの候補を修正」と区別する。
// 手入力の行は必ず manual- で始まるIDを使う。
export type MaterialOrigin = 'ai' | 'aiEdited' | 'manual'
export function materialOrigin(item: Material): MaterialOrigin {
  if (item.source === 'ai') return 'ai'
  return item.id.startsWith('manual-') ? 'manual' : 'aiEdited'
}

export interface MaterialFields { name: string; quantity: string; unit: string }
export type FieldProblem = 'name' | 'quantity' | 'unit'
export function readFields(fields: MaterialFields): { value: Pick<Material, 'name' | 'quantity' | 'unit'> } | { problems: FieldProblem[] } {
  const name = fields.name.trim()
  const unit = fields.unit.trim()
  const text = fields.quantity.trim().replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  const quantity = /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN
  const problems: FieldProblem[] = []
  if (!MaterialSchema.shape.name.safeParse(name).success) problems.push('name')
  if (!MaterialSchema.shape.quantity.safeParse(quantity).success) problems.push('quantity')
  if (!MaterialSchema.shape.unit.safeParse(unit).success) problems.push('unit')
  return problems.length ? { problems } : { value: { name, quantity, unit } }
}
export function toFields(item?: Material): MaterialFields {
  return item ? { name: item.name, quantity: String(item.quantity), unit: item.unit } : { name: '', quantity: '1', unit: '' }
}

export function addManual(items: Material[], id: string, value: Pick<Material, 'name' | 'quantity' | 'unit'>): Material[] {
  return [...items, { id: `manual-${id}`, ...value, source: 'manual', confidence: null }]
}
/** 値が変わったときだけ人の修正として記録する。見つからなければnull（別のタブで削除済み）。 */
export function updateItem(items: Material[], id: string, value: Pick<Material, 'name' | 'quantity' | 'unit'>, original?: Material): Material[] | null {
  const current = items.find((item) => item.id === id)
  if (!current) return null
  if (current.name === value.name && current.quantity === value.quantity && current.unit === value.unit) return items
  if (original && (current.name !== original.name || current.quantity !== original.quantity || current.unit !== original.unit || current.source !== original.source || current.confidence !== original.confidence)) return null
  return items.map((item) => item.id === id ? { ...item, ...value, source: 'manual', confidence: null } : item)
}
export function removeItem(items: Material[], id: string): Material[] | null {
  return items.some((item) => item.id === id) ? items.filter((item) => item.id !== id) : null
}

const sameMaterial = (a: Material, b: Material) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && a.unit.trim().toLowerCase() === b.unit.trim().toLowerCase()
/**
 * AI候補を材料一覧へ統合する。同じIDや、名前と単位が同じ材料はすでに一覧にあるとみなして追加しない
 * （同じ材料を写真で読み直したときに数量を二重に数えない）。上限を超える分も追加しない。
 */
export function mergeCandidates(items: Material[], candidates: Material[]) {
  const merged = [...items]
  let duplicates = 0
  let overflow = 0
  for (const candidate of candidates) {
    if (merged.some((item) => item.id === candidate.id || sameMaterial(item, candidate))) duplicates++
    else if (merged.length >= MAX_MATERIALS) overflow++
    else merged.push(candidate)
  }
  return { items: merged, added: merged.length - items.length, duplicates, overflow }
}

export function toggleTool(tools: string[], tool: string, owned: boolean): string[] {
  const rest = tools.filter((entry) => entry !== tool)
  return owned ? [...rest, tool] : rest
}

/** Restore only the removed row; never replace newer rows or a reused ID. */
export function restoreItem(items: Material[], item: Material, index: number): Material[] | null {
  const existing = items.find((entry) => entry.id === item.id)
  if (existing) return existing.name === item.name && existing.quantity === item.quantity && existing.unit === item.unit && existing.source === item.source && existing.confidence === item.confidence ? items : null
  if (items.length >= MAX_MATERIALS) return null
  const restored = [...items]
  restored.splice(Math.min(index, restored.length), 0, item)
  return restored
}
