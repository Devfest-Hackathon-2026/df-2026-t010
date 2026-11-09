import { useState } from 'react'
import { z } from 'zod'
import { EditMaterialsInputSchema, IdSchema, MaterialSchema } from '@rekt/shared'
import { MAX_TOOLS } from './materialDraft'

export const MaterialFieldsSchema = z.strictObject({ name: z.string().max(80), quantity: z.string().max(64), unit: z.string().max(20) })
export const MaterialEditorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('new'),
    fields: MaterialFieldsSchema,
    id: IdSchema.optional(),
    attempt: EditMaterialsInputSchema.optional(),
  }),
  z.strictObject({ kind: z.literal('edit'), original: MaterialSchema, fields: MaterialFieldsSchema }),
])
export const MaterialUndoSchema = z.strictObject({ item: MaterialSchema, index: z.int().min(0).max(49), revision: z.int().positive(), expiresAt: z.number().finite() })
export type MaterialEditor = z.infer<typeof MaterialEditorSchema>
export const UNDO_MATERIAL_MS = 30_000
export const ToolDraftSchema = z.string().max(80)
export const ToolSelectionSchema = z.strictObject({
  base: EditMaterialsInputSchema.shape.tools,
  selected: z.array(EditMaterialsInputSchema.shape.tools.element).max(MAX_TOOLS * 2),
})

const fallback = new Map<string, string | null>()
function read<T>(key: string, schema: z.ZodType<T>): T | null {
  try {
    const raw = fallback.has(key) ? fallback.get(key) : sessionStorage.getItem(key)
    return schema.safeParse(JSON.parse(raw ?? 'null')).data ?? null
  } catch {
    return null
  }
}
function write<T>(key: string, value: T | null) {
  const raw = value === null ? null : JSON.stringify(value)
  try { if (raw === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, raw); fallback.delete(key) }
  catch { fallback.set(key, raw) }
}
/** Per-tab drafts survive route changes/reloads and are never sent as saved materials. */
export function useMaterialSession<T>(key: string, schema: z.ZodType<T>) {
  const [state, setState] = useState(() => ({ key, value: read(key, schema) }))
  const value = state.key === key ? state.value : read(key, schema)
  function setValue(next: T | null) { write(key, next); setState({ key, value: next }) }
  return [value, setValue] as const
}
