import { z } from 'zod'
import type { Language } from './contracts'
import { GatewayError } from './errors'
import { isAllowedAiProject } from './project-ideas-policy'
import { normalizeInventoryText } from './project-candidates'
import { LocalizedTextSchema, TemplateSchema } from './workshop'
import type { Template } from './workshop'

const text = LocalizedTextSchema.shape.ja
export const ProjectTranslationSchema = z.strictObject({ projects: z.array(z.strictObject({
  id: z.string(), title: text, description: text,
  steps: z.array(z.strictObject({ id: z.string(), title: text, instructions: text })).min(3).max(8),
})).min(1).max(3) })

// A language suffix identifies new AI ideas. The unchanged v2 text shape also
// gives older clients the original text until a second language is saved.
export function pendingProjectLocale(template: Template): Language | null {
  if (!template.origin) return null
  const original = /^idea-\d+-\d+-(ja|en)$/.exec(template.id)?.[1]
  if (!original || template.title.ja !== template.title.en || template.description.ja !== template.description.en
    || template.steps.some((step) => step.title.ja !== step.title.en || step.instructions.ja !== step.instructions.en)) return null
  return original === 'ja' ? 'en' : 'ja'
}

export function projectTextForLocale(template: Template, locale: Language) {
  return {
    id: template.id, title: template.title[locale], description: template.description[locale],
    steps: template.steps.map((step) => ({ id: step.id, title: step.title[locale], instructions: step.instructions[locale] })),
  }
}

export function applyProjectTranslations(templates: Template[], raw: unknown, locale: Language) {
  const result = ProjectTranslationSchema.safeParse(raw)
  if (!result.success || result.data.projects.length !== templates.length) throw new GatewayError('AI_RESPONSE_INVALID')
  const translated = templates.map((template, index) => {
    const project = result.data.projects[index]!
    if (project.id !== template.id || project.steps.length !== template.steps.length
      || template.steps.some((step, n) => step.id !== project.steps[n]?.id)) throw new GatewayError('AI_RESPONSE_INVALID')
    const resultTemplate = TemplateSchema.parse({
      ...template, title: { ...template.title, [locale]: project.title }, description: { ...template.description, [locale]: project.description },
      steps: template.steps.map((step, n) => ({ ...step, title: { ...step.title, [locale]: project.steps[n]!.title }, instructions: { ...step.instructions, [locale]: project.steps[n]!.instructions } })),
    })
    if (pendingProjectLocale(resultTemplate)) throw new GatewayError('AI_RESPONSE_INVALID')
    if (resultTemplate.origin === 'ai' && !isAllowedAiProject(resultTemplate)) throw new GatewayError('AI_UNSAFE_PROJECT')
    return resultTemplate
  })
  if (new Set(translated.map((template) => normalizeInventoryText(template.title[locale]))).size !== translated.length) throw new GatewayError('AI_RESPONSE_INVALID')
  return translated
}
