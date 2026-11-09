import { z } from 'zod'
import { CandidatesDocumentSchema, TemplateSchema } from './workshop'
import type { CandidatesDocument, MaterialsDocument, Template } from './workshop'

// Exact aliases only. No substring/fuzzy matching or implicit unit conversion.
export const normalizeInventoryText = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ')
const unitGroups = [
  ['sheet', 'sheets'], ['piece', 'pieces', 'pc', 'pcs'], ['bottle', 'bottles'],
  ['roll', 'rolls'], ['g', 'gram', 'grams'], ['cm', 'centimeter', 'centimeters'],
  ['m', 'meter', 'meters'], ['ml', 'milliliter', 'milliliters'],
]
const toolGroups = [
  ['はさみ', 'ハサミ', 'scissors'], ['カッター', 'craft knife'], ['定規', 'ruler'],
  ['セロハンテープ', 'clear tape'], ['両面テープ', 'double-sided tape'],
  ['スティックのり', 'glue stick'], ['木工用ボンド', 'wood glue'],
  ['ホッチキス', 'stapler'], ['油性ペン', 'permanent marker'], ['穴あけパンチ', 'hole punch'],
]
function alias(value: string, groups: string[][]) {
  const normalized = normalizeInventoryText(value)
  return groups.find((group) => group.includes(normalized))?.[0] ?? normalized
}
const unitKey = (value: string) => alias(value, unitGroups)
const toolKey = (value: string) => alias(value, toolGroups)
const names = (requirement: Template['materials'][number]) => [requirement.name.ja, requirement.name.en].map(normalizeInventoryText)

// Ambiguous requirements could count the same physical row twice. Reject the catalog
// instead of guessing which requirement owns it; one entry per material is required.
export const VerifiedTemplateCatalogSchema = z.array(TemplateSchema).max(20).superRefine((templates, context) => {
  const ids = new Set<string>()
  const checkLabels = new Map<string, string>()
  for (const template of templates) {
    const materialIds = new Set<string>()
    const materialNames = new Set<string>()
    let invalid = ids.has(template.id)
    invalid ||= !template.verified
    ids.add(template.id)
    for (const requirement of template.materials) {
      const aliases = new Set(names(requirement))
      invalid ||= materialIds.has(requirement.materialId) || [...aliases].some((name) => materialNames.has(name))
      invalid ||= Object.values(requirement.name).some((name) => name.length > 80) || Object.values(requirement.unit).some((unit) => unit.length > 20)
      materialIds.add(requirement.materialId)
      aliases.forEach((name) => materialNames.add(name))
    }
    for (const check of template.checks) {
      const label = JSON.stringify(check.label)
      invalid ||= checkLabels.has(check.id) && checkLabels.get(check.id) !== label
      checkLabels.set(check.id, label)
    }
    if (invalid) context.addIssue({ code: 'custom', message: `Duplicate or ambiguous catalog requirement: ${template.id}` })
  }
})

// Compare declared decimals exactly (e.g. 0.1 + 0.7 = 0.8), without rounding up shortages.
function decimal(value: number): { coefficient: bigint; scale: number } {
  const [mantissa = '', exponent = '0'] = value.toString().split('e')
  const [whole = '', fraction = ''] = mantissa.split('.')
  const scale = fraction.length - Number(exponent)
  return { coefficient: BigInt(whole + fraction) * 10n ** BigInt(Math.max(0, -scale)), scale: Math.max(0, scale) }
}
function enough(quantities: number[], required: number) {
  const values = [...quantities, required].map(decimal)
  const scale = Math.max(...values.map((value) => value.scale))
  const integers = values.map((value) => value.coefficient * 10n ** BigInt(scale - value.scale))
  const target = integers.pop()!
  return integers.reduce((sum, value) => sum + value, 0n) >= target
}

// Caller supplies only the validated server catalog. AI recommendations cannot add a
// template or change feasibility. UI consumes this result without re-evaluating it.
export function buildProjectCandidates(templates: Template[], materials: MaterialsDocument, now: string): CandidatesDocument {
  const catalog = VerifiedTemplateCatalogSchema.parse(templates)
  return evaluateProjectCandidates(catalog, materials, now)
}

/** Server-owned generated templates use the same inventory checks as the catalog. */
export function evaluateProjectCandidates(catalog: Template[], materials: MaterialsDocument, now: string): CandidatesDocument {
  const ownedTools = new Set(materials.tools.map(toolKey))
  const candidates = catalog.map((template) => {
    const missing: { ja: string; en: string }[] = []
    for (const requirement of template.materials) {
      const materialNames = names(requirement)
      const units = [requirement.unit.ja, requirement.unit.en].map(unitKey)
      const quantities = materials.items.filter((item) => materialNames.includes(normalizeInventoryText(item.name)) && units.includes(unitKey(item.unit))).map((item) => item.quantity)
      if (!enough(quantities, requirement.quantity)) missing.push({
        ja: `${requirement.name.ja}が不足しています（必要: ${requirement.quantity}${requirement.unit.ja}）`,
        en: `Insufficient ${requirement.name.en} (need ${requirement.quantity} ${requirement.unit.en})`,
      })
    }
    for (const tool of template.tools) {
      if (!ownedTools.has(toolKey(tool))) missing.push({ ja: `工具「${tool}」が必要です`, en: `Tool needed: ${tool}` })
    }
    for (const check of template.checks) {
      if (!materials.checks.some((answer) => answer.id === check.id && answer.confirmed === true)) missing.push({
        ja: `未確認の条件: ${check.label.ja}`, en: `Condition not confirmed: ${check.label.en}`,
      })
    }
    const feasible = missing.length === 0
    const count = missing.length
    if (count > 50) missing.splice(49, count - 49, { ja: `ほか${count - 49}件の条件が不足しています`, en: `${count - 49} additional conditions are unmet` })
    return {
      templateId: template.id, feasible, missing,
      reason: feasible
        ? { ja: '確認した材料・工具と必要な条件を満たしています。', en: 'Confirmed materials, tools, and required conditions meet the requirements.' }
        : { ja: '材料・工具と未確認の条件を確認してください。', en: 'Check the materials, tools, and unconfirmed conditions.' },
    }
  }).sort((a, b) => Number(b.feasible) - Number(a.feasible))
  return CandidatesDocumentSchema.parse({ schemaVersion: 2, materialRevision: materials.revision, generatedAt: now, candidates })
}
