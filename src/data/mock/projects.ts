import { GatewayError, GenerateProjectsInputSchema, buildGeneratedProjects, demoProjectIdeas } from '@rekt/shared'
import type { Template } from '@rekt/shared'
import type { ProjectsGateway } from '../contracts'
import { gatewayError } from '../errors'
import { verifiedTemplates } from '../templates'
import { candidatesChangeEvent, readMockCandidates, writeMockCandidates } from './candidates'
import { readMockMaterials } from './materials'
import { getMockUserId, readMockCraft } from './crafts'

// Catalog data remains available for compatibility. New journeys use three
// inventory-based preview ideas, visibly marked as samples rather than live AI.
export function createMockProjectsGateway(storage: Storage, uid: string, templates: Template[] = verifiedTemplates): ProjectsGateway {
  function owner(craftId: string) {
    const snapshot = readMockCraft(storage, craftId)
    if (!snapshot) throw new GatewayError('CRAFT_NOT_FOUND')
    if (snapshot.craft.ownerUid !== uid) throw new GatewayError('NOT_CRAFT_OWNER')
  }
  return {
    async generateProjects(raw) {
      const input = GenerateProjectsInputSchema.parse(raw)
      owner(input.craftId)
      if (readMockCraft(storage, input.craftId)!.craft.status !== 'project_selection') throw new GatewayError('INVALID_CRAFT_STATE')
      const materials = readMockMaterials(storage, input.craftId)
      if (!materials?.confirmedAt || materials.revision !== input.materialRevision) throw new GatewayError('STALE_REVISION')
      const existing = readMockCandidates(storage, input.craftId)
      if (existing?.source && existing.materialRevision === input.materialRevision) return existing
      const document = buildGeneratedProjects(demoProjectIdeas(materials), materials, new Date().toISOString(), 'fixture')
      writeMockCandidates(storage, input.craftId, document)
      return document
    },
    async translateProjects({ craftId }) { owner(craftId) },
    listTemplates: async () => templates,
    subscribeToCandidates(craftId, next, error) {
      let active = true
      const notify = () => {
        if (!active) return
        try { owner(craftId); next(readMockCandidates(storage, craftId)) } catch (cause) { error(gatewayError(cause)) }
      }
      const events = ['storage', candidatesChangeEvent, 'co-make:craft-change']
      events.forEach((event) => window.addEventListener(event, notify))
      queueMicrotask(notify)
      return () => { active = false; events.forEach((event) => window.removeEventListener(event, notify)) }
    },
  }
}

let shared: ProjectsGateway | undefined
export function getMockProjectsGateway(): ProjectsGateway {
  shared ??= createMockProjectsGateway(localStorage, getMockUserId())
  return shared
}
