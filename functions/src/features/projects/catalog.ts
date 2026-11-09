import { createHash } from 'node:crypto'
import { z } from 'zod'
import { VerifiedTemplateCatalogSchema } from '@rekt/shared'
import type { Template } from '@rekt/shared'
import { fail } from '../../lib/errors'

// Filled at build time from content/templates/*.json, never from a request or mock.
declare const REKT_TEMPLATE_CATALOG: unknown
export type ProjectCatalog = { revision: string; templates: Template[] }
// Server-only metadata for check-answer freshness and #14's atomic start operation.
export const ProjectStateSchema = z.strictObject({
  schemaVersion: z.literal(2), materialRevision: z.int().nonnegative(),
  catalogRevision: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.boolean(),
})
export function parseProjectCatalog(value: unknown): ProjectCatalog {
  const parsed = VerifiedTemplateCatalogSchema.safeParse(value)
  if (!parsed.success) fail('CANDIDATES_NOT_READY')
  const templates = parsed.data.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return { revision: createHash('sha256').update(JSON.stringify(templates)).digest('hex'), templates }
}
export function getProjectCatalog(): ProjectCatalog { return parseProjectCatalog(REKT_TEMPLATE_CATALOG) }
