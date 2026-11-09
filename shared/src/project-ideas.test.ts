import { describe, expect, it } from 'vitest'
import { buildGeneratedProjects, demoProjectIdeas, projectIdeasSchemaForInventory } from './project-ideas'
import { materialsFixture } from './fixtures'
import { VerifiedTemplateCatalogSchema } from './project-candidates'
import { inventoryForAiProjects, isAllowedAiTool } from './project-ideas-policy'
import { applyProjectTranslations, pendingProjectLocale, projectTextForLocale } from './project-translation'
const materials = { ...materialsFixture, confirmedAt: materialsFixture.updatedAt }
describe('material-based AI project ideas', () => {
  it('keeps English demo names and instructions in English for Japanese or unknown inventory names', () => {
    for (const name of ['段ボール', '紙コップ', '名前の分からない材料']) {
      const inventory = { ...materials, items: [{ ...materials.items[0]!, name }] }
      const ideas = demoProjectIdeas(inventory).ideas
      expect(new Set(ideas.map((idea) => idea.title.en)).size).toBe(3)
      for (const idea of ideas) {
        expect(idea.title.ja).toContain(name)
        expect([idea.title.en, idea.description.en, ...idea.steps.map((step) => step.instructions.en)].join(' ')).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/)
        expect(idea.materials[0]!.inventoryId).toBe(inventory.items[0]!.id)
      }
    }
  })
  it('accepts exactly three inventory-backed ideas without claiming physical verification', () => {
    const document = buildGeneratedProjects(demoProjectIdeas(materials), materials, materials.updatedAt)
    expect(document.candidates).toHaveLength(3)
    expect(document.candidates.every((idea) => idea.feasible)).toBe(true)
    expect(document.templates?.every((template) => !template.verified && template.origin === 'ai' && template.steps.every((step) => step.photoPath === null))).toBe(true)
    expect(VerifiedTemplateCatalogSchema.safeParse(document.templates).success).toBe(false)
  })
  it('rejects fewer or more than three ideas', () => {
    const raw = demoProjectIdeas(materials)
    for (const ideas of [raw.ideas.slice(0, 2), [...raw.ideas, raw.ideas[0]]]) expect(() => buildGeneratedProjects({ ideas }, materials, materials.updatedAt)).toThrow()
  })
  it('limits the response schema to the sent material IDs and tools', () => {
    const schema = projectIdeasSchemaForInventory({ items: materials.items, tools: [] })
    const raw = demoProjectIdeas(materials)
    expect(schema.safeParse(raw).success).toBe(true)
    raw.ideas[0]!.tools = ['はさみ']
    expect(schema.safeParse(raw).success).toBe(false)
    raw.ideas[0]!.tools = []
    raw.ideas[0]!.materials[0]!.inventoryId = 'not-sent'
    expect(schema.safeParse(raw).success).toBe(false)
  })
  it('stores single-language output and rejects changed IDs or unsafe translated text', () => {
    const demo = demoProjectIdeas(materials)
    const raw = { ideas: demo.ideas.map((idea) => ({ ...idea, title: idea.title.en, description: idea.description.en,
      steps: idea.steps.map((step) => ({ title: step.title.en, instructions: step.instructions.en })),
    })) }
    expect(projectIdeasSchemaForInventory(materials, 'en').safeParse(raw).success).toBe(true)
    const template = buildGeneratedProjects(raw, materials, materials.updatedAt, 'ai', 'en').templates![0]!
    expect(pendingProjectLocale(template)).toBe('ja')
    const text = projectTextForLocale(template, 'en')
    const translated = { ...text, title: '紙の作品' }
    expect(applyProjectTranslations([template], { projects: [translated] }, 'ja')[0]).toMatchObject({
      id: template.id, title: { ja: translated.title, en: template.title.en }, materials: template.materials, tools: template.tools,
    })
    expect(() => applyProjectTranslations([template], { projects: [{ ...translated, steps: [...translated.steps].reverse() }] }, 'ja')).toThrow(expect.objectContaining({ reason: 'AI_RESPONSE_INVALID' }))
    const unsafe = { ...translated, steps: translated.steps.map((step) => ({ ...step, instructions: 'カッターを使う。' })) }
    expect(() => applyProjectTranslations([template], { projects: [unsafe] }, 'ja')).toThrow(expect.objectContaining({ reason: 'AI_UNSAFE_PROJECT' }))
  })
  it('rejects duplicate titles in either language even when case or spacing differs', () => {
    for (const language of ['ja', 'en'] as const) {
      const raw = demoProjectIdeas(materials)
      const title = raw.ideas[0]!.title[language]
      raw.ideas[1]!.title[language] = title.toUpperCase().replace(' ', '　 ')
      expect(() => buildGeneratedProjects(raw, materials, materials.updatedAt)).toThrow(expect.objectContaining({ reason: 'AI_RESPONSE_INVALID' }))
    }
  })
  it('rejects invented materials, insufficient amounts, duplicate inventory and unowned tools', () => {
    for (const patch of [
      { materials: [{ inventoryId: 'invented', quantity: 1 }] },
      { materials: [{ inventoryId: materials.items[0]!.id, quantity: 3 }] },
      { materials: [{ inventoryId: materials.items[0]!.id, quantity: 1 }, { inventoryId: materials.items[0]!.id, quantity: 1 }] },
      { tools: ['a laser cutter'] },
    ]) {
      const raw = demoProjectIdeas(materials); raw.ideas[0] = { ...raw.ideas[0]!, ...patch }
      expect(() => buildGeneratedProjects(raw, materials, materials.updatedAt)).toThrow()
    }
  })
  it('accepts tool-free ideas and only lists a tool when the instructions use it', () => {
    const raw = demoProjectIdeas(materials)
    expect(buildGeneratedProjects(raw, materials, materials.updatedAt).templates?.every((template) => template.tools.length === 0)).toBe(true)
    raw.ideas[0]!.tools = ['はさみ']
    expect(() => buildGeneratedProjects(raw, materials, materials.updatedAt)).toThrow(expect.objectContaining({ reason: 'AI_RESPONSE_INVALID' }))
    raw.ideas[0]!.steps[0]!.instructions = { ja: 'はさみで紙を半分に切ります。', en: 'Cut the paper in half with scissors.' }
    expect(buildGeneratedProjects(raw, materials, materials.updatedAt).templates?.[0]?.tools).toEqual(['はさみ'])
    expect(raw.ideas[0]!.steps[0]).not.toHaveProperty('safety')
  })
  it('keeps hazardous or custom tools out of the AI input, even when owned', () => {
    const tools = [' Ｓｃｉｓｓｏｒｓ ', 'セロハンテープ', 'カッター', 'Craft knife', 'レーザーカッター', 'Scissors plus a knife']
    expect(tools.filter(isAllowedAiTool)).toEqual(tools.slice(0, 2))
    const bottle = { ...materials.items[0]!, id: 'bottle', name: 'ペットボトル' }
    expect(inventoryForAiProjects({ items: [...materials.items, bottle], tools })).toEqual({ items: materials.items, tools: ['セロハンテープ'] })
    expect(inventoryForAiProjects({ items: [bottle], tools })).toEqual({ items: [bottle], tools: ['セロハンテープ'] })
    const raw = demoProjectIdeas(materials)
    raw.ideas[0]!.tools = ['カッター']
    expect(() => buildGeneratedProjects(raw, { ...materials, tools }, materials.updatedAt)).toThrow(expect.objectContaining({ reason: 'AI_UNSAFE_PROJECT' }))
  })
  it.each([
    { ja: '紙を机に置きます。', en: 'Use a craft knife.' },
    { ja: 'ペットボトルを切ります。', en: 'Put the bottle on the table.' },
    { ja: '紙を机に置きます。', en: 'Use scissors to cut the top part of the PET bottle.' },
    { ja: '材料を手元に置きます。', en: 'Puncture the can.' },
    { ja: '電子レンジで加熱します。', en: 'Set it on a flat surface.' },
  ])('rejects a hazardous instruction even with no listed tools', (instructions) => {
    const raw = demoProjectIdeas(materials)
    raw.ideas[0]!.steps[0]!.instructions = instructions
    expect(() => buildGeneratedProjects(raw, materials, materials.updatedAt)).toThrow(expect.objectContaining({ reason: 'AI_UNSAFE_PROJECT' }))
  })
})
