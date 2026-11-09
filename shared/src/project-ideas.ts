import { z } from 'zod'
import { GatewayError } from './errors'
import { LanguageSchema } from './contracts'
import type { Language } from './contracts'
import { evaluateProjectCandidates, normalizeInventoryText } from './project-candidates'
import { inventoryForAiProjects, isAllowedAiProject, mentionsAiTool } from './project-ideas-policy'
import { CandidatesDocumentSchema, LocalizedTextSchema, TemplateSchema } from './workshop'
import type { MaterialsDocument, Template } from './workshop'

export const GenerateProjectsInputSchema = z.strictObject({ craftId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), materialRevision: z.int().nonnegative(), retry: z.boolean().optional(), locale: LanguageSchema.optional() })
export type GenerateProjectsInput = z.infer<typeof GenerateProjectsInputSchema>
export const TranslateProjectsInputSchema = GenerateProjectsInputSchema.extend({ action: z.literal('translate'), locale: LanguageSchema })
export type TranslateProjectsInput = Omit<z.infer<typeof TranslateProjectsInputSchema>, 'action'>
const ProjectMaterialSchema = z.strictObject({ inventoryId: z.string().min(1).max(128), quantity: z.number().positive().max(10000) })
const ProjectIdeaSchema = z.strictObject({
  title: LocalizedTextSchema, description: LocalizedTextSchema, estimatedMinutes: z.int().min(5).max(120),
  difficulty: z.enum(['easy', 'medium', 'hard']), visual: z.enum(['robot', 'car', 'organizer', 'flower', 'art']),
  materials: z.array(ProjectMaterialSchema).min(1).max(20),
  tools: z.array(z.string().min(1).max(80)).max(10),
  steps: z.array(z.strictObject({ title: LocalizedTextSchema, instructions: LocalizedTextSchema })).min(3).max(8),
})
export const ProjectIdeasOutputSchema = z.strictObject({ ideas: z.array(ProjectIdeaSchema).length(3) })
const projectText = LocalizedTextSchema.shape.ja
const SingleLanguageIdeaSchema = ProjectIdeaSchema.extend({
  title: projectText, description: projectText,
  steps: z.array(z.strictObject({ title: projectText, instructions: projectText })).min(3).max(8),
})
const SingleLanguageIdeasSchema = ProjectIdeasOutputSchema.extend({ ideas: z.array(SingleLanguageIdeaSchema).length(3) })

export function projectIdeasSchemaForInventory({ items, tools }: Pick<MaterialsDocument, 'items' | 'tools'>, locale?: Language) {
  const idea = (locale ? SingleLanguageIdeaSchema : ProjectIdeaSchema).extend({
    materials: z.array(ProjectMaterialSchema.extend({ inventoryId: z.enum(items.map(({ id }) => id)) })).min(1).max(20),
    tools: tools.length ? z.array(z.enum([...new Set(tools)])).max(10) : z.array(z.string()).max(0),
  })
  return ProjectIdeasOutputSchema.extend({ ideas: z.array(idea).length(3) })
}

export function buildGeneratedProjects(raw: unknown, materials: MaterialsDocument, now: string, source: 'ai' | 'fixture' = 'ai', locale?: Language) {
  if (locale) {
    const single = SingleLanguageIdeasSchema.safeParse(raw)
    if (!single.success) throw new GatewayError('AI_RESPONSE_INVALID')
    const fallback = (text: string) => ({ ja: text, en: text })
    raw = { ideas: single.data.ideas.map((idea) => ({
      ...idea, title: fallback(idea.title), description: fallback(idea.description),
      steps: idea.steps.map((step) => ({ title: fallback(step.title), instructions: fallback(step.instructions) })),
    })) }
  }
  const parsed = ProjectIdeasOutputSchema.safeParse(raw)
  if (!parsed.success) throw new GatewayError('AI_RESPONSE_INVALID')
  for (const language of LanguageSchema.options) {
    const titles = parsed.data.ideas.map(({ title }) => normalizeInventoryText(title[language]))
    if (new Set(titles).size !== titles.length) throw new GatewayError('AI_RESPONSE_INVALID')
  }
  const available = source === 'ai' ? inventoryForAiProjects(materials) : materials
  const templates = parsed.data.ideas.map((idea, index): Template => {
    if (new Set(idea.materials.map((item) => item.inventoryId)).size !== idea.materials.length) throw new GatewayError('AI_RESPONSE_INVALID')
    if (idea.tools.some((tool) => !materials.tools.includes(tool))) throw new GatewayError('AI_RESPONSE_INVALID')
    const requirements = idea.materials.map((need) => {
      const owned = available.items.find((item) => item.id === need.inventoryId)
      if (!owned || need.quantity > owned.quantity) throw new GatewayError('AI_RESPONSE_INVALID')
      return { materialId: owned.id, name: { ja: owned.name, en: owned.name }, quantity: need.quantity, unit: { ja: owned.unit, en: owned.unit } }
    })
    const template = TemplateSchema.parse({ schemaVersion: 2, id: `idea-${materials.revision}-${index + 1}${locale ? `-${locale}` : ''}`, verified: false, origin: source === 'ai' ? 'ai' : 'demo',
      title: idea.title, description: idea.description, estimatedMinutes: idea.estimatedMinutes, difficulty: idea.difficulty, visual: idea.visual,
      materials: requirements, tools: idea.tools, checks: [], steps: idea.steps.map((step, i) => ({ ...step, id: `step-${i + 1}`, safety: { ja: 'なし', en: 'None' }, photoPath: null })),
    })
    if (source === 'ai') {
      if (!isAllowedAiProject(template)) throw new GatewayError('AI_UNSAFE_PROJECT')
      if (idea.tools.some((tool) => !available.tools.includes(tool))) throw new GatewayError('AI_UNSAFE_PROJECT')
      const instructions = idea.steps.flatMap((step) => [step.instructions.ja, step.instructions.en]).map(normalizeInventoryText)
      if (idea.tools.some((tool) => !mentionsAiTool(tool, instructions))) throw new GatewayError('AI_RESPONSE_INVALID')
    }
    return template
  })
  const evaluated = evaluateProjectCandidates(templates, materials, now)
  if (evaluated.candidates.some((candidate) => !candidate.feasible)) throw new GatewayError('AI_RESPONSE_INVALID')
  return CandidatesDocumentSchema.parse({ ...evaluated, source, templates })
}

/** Offline preview only. Never presented as a live AI response. */
export function demoProjectIdeas(materials: MaterialsDocument) {
  const first = materials.items[0]
  if (!first) throw new GatewayError('VALIDATION_FAILED')
  const names = [
    { ja: `${first.name}のロボット`, en: 'Upcycled robot', visual: 'robot', description: { ja: '材料の模様をロボットの顔に見立てます。', en: 'Use patterns in the material to create a robot face.' } },
    { ja: `${first.name}のまち`, en: 'Miniature town', visual: 'art', description: { ja: '机の上に、建物と道に見立てた小さなまちを作ります。', en: 'Lay out a miniature town of buildings and paths.' } },
    { ja: `${first.name}のアート`, en: 'Material art', visual: 'flower', description: { ja: '材料の色や質感を使って模様を作ります。', en: 'Create a design from the colors and textures of your material.' } },
  ]
  return { ideas: names.map((name, i) => ({ title: { ja: name.ja, en: name.en }, visual: name.visual, estimatedMinutes: 15 + i * 5, difficulty: 'easy',
    description: name.description,
    materials: [{ inventoryId: first.id, quantity: Math.min(1, first.quantity) }], tools: [] as string[],
    steps: [
      { title: { ja: '材料を置く', en: 'Set out your material' }, instructions: { ja: `${first.name}を机に置き、表と裏の模様や色を見比べます。`, en: 'Set the material on a table and compare the colors and patterns on each side.' } },
      { title: { ja: 'かたちを考える', en: 'Plan your shape' }, instructions: { ja: ['ロボットの顔とからだをイメージして、材料を置く向きを決めます。', '小さなまちをイメージして、建物や道になる部分を考えます。', '花や好きな模様をイメージして、材料の見せたい面を選びます。'][i], en: ['Imagine a robot face and body and choose an orientation.', 'Imagine a little town and plan the buildings and paths.', 'Imagine a flower or pattern and choose a side to display.'][i] } },
      { title: { ja: '並べてみる', en: 'Arrange the design' }, instructions: { ja: '机の上で材料を並べ、やわらかい部分は無理のない範囲で折ってみます。', en: 'Arrange the materials on the table. Gently fold any soft parts if possible.' } },
      { title: { ja: 'バランスを整える', en: 'Adjust the balance' }, instructions: { ja: '見え方をたしかめ、倒れないように平らな場所で位置を調整します。', en: 'Check the design and adjust its position on a flat surface.' } },
      { title: { ja: '仕上げて飾る', en: 'Finish and display' }, instructions: { ja: 'お気に入りの角度から眺めて完成。写真に残しましょう。', en: 'Find your favorite angle. Your creation is ready for a photo.' } },
    ],
  })) }
}
