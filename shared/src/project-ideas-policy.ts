import { normalizeInventoryText } from './project-candidates'
import type { MaterialsDocument, Template } from './workshop'

const scissors = ['はさみ', 'ハサミ', '鋏', 'scissors']
const toolNames = [scissors, ['定規', 'ruler'], ['セロハンテープ', 'clear tape', 'cellophane tape'],
  ['両面テープ', 'double-sided tape'], ['スティックのり', 'glue stick'], ['油性ペン', 'permanent marker']]
const allowedTools = new Set(toolNames.flat())

export function isAllowedAiTool(name: string) {
  return allowedTools.has(normalizeInventoryText(name))
}

export function mentionsAiTool(tool: string, instructions: string[]) {
  const names = toolNames.find((group) => group.includes(normalizeInventoryText(tool))) ?? []
  return names.some((name) => instructions.some((instruction) => instruction.includes(name)))
}

export function inventoryForAiProjects(materials: Pick<MaterialsDocument, 'items' | 'tools'>) {
  const flexible = materials.items.filter(({ name }) => !/ガラス|びん|瓶|缶|金属|アルミ|ペットボトル|プラスチック|厚手の段ボール|\b(?:glass|bottles?|metal|cans?|alumin(?:um|ium)|plastic|thick cardboard)\b/.test(normalizeInventoryText(name)))
  const hasRigidMaterial = flexible.length !== materials.items.length
  const tools = materials.tools.filter((tool) => isAllowedAiTool(tool) && (!hasRigidMaterial || !scissors.includes(normalizeInventoryText(tool))))
  return { items: flexible.length ? flexible : materials.items, tools }
}

// Screen both languages for common hazards even when the model omitted the tool from its list.
const hazardousText = [
  /カッター|ナイフ|刃物|かみそり|カミソリ|包丁|キリで|目打ち|ドリル|のこぎり|ノコギリ|ホッチキス|ホチキス|グルーガン|はんだ|半田|ライター|マッチで|火をつけ|火で|加熱|熱湯|電子レンジ|コンセント|通電|漂白剤|シンナー|穴を[開あ]け|突き刺|鋭利な道具/,
  /\b(?:cutters?|knife|knives|razors?|blades?|awls?|drills?|saws?|staplers?|hot glue|solder(?:ing)?|lighter|flame|fire|microwave|boiling water|heat gun|electrical outlet|bleach|solvent|puncture|pierce|make a hole|sharp object)\b/,
  /(?:ガラス|びん|瓶|缶|金属|アルミ|ペットボトル|硬いプラスチック|厚手の段ボール)[^。！？\n]{0,25}(?:切る|切り|切っ|削る|削り|割る|割っ|砕く|砕い|溶か)/,
  /\b(?:cut|trim|score|break|shatter|melt)\b\s+(?:(?:through|into|off|the|a|an|your|rigid|pet|top|bottom|side|neck|rim|base|part|of)\s+){0,12}(?:glass|bottles?|cans?|metal|alumin(?:um|ium)|plastic|thick cardboard)\b/,
  /割れたガラス|ガラスの破片|電池を分解|体重を支え|食べ物を入れ|飲み物を入れ|\b(?:broken glass|glass shards|load.bearing|support (?:your|body) weight|food contact|serve food|hold drinks)\b/,
]

export function isAllowedAiProject(project: Pick<Template, 'title' | 'description' | 'materials' | 'tools' | 'steps'>) {
  if (!project.tools.every(isAllowedAiTool)) return false
  const fields = [project.title, project.description, ...project.materials.map((item) => item.name), ...project.steps.flatMap((step) => [step.title, step.instructions])]
  return fields.every((field) => [field.ja, field.en].every((value) => {
    const normalized = value.normalize('NFKC').toLowerCase()
    return !hazardousText.some((pattern) => pattern.test(normalized))
  }))
}
