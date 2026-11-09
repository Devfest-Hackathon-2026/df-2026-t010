import { MaterialRecognitionResponseSchema } from './material-recognition'

const requestId = '00000000-0000-4000-8000-000000000010'
const base = {
  schemaVersion: 2, requestId, craftId: 'fixture-craft', craftRevision: 2,
  imagePath: 'crafts/fixture-craft/materials/photo.png', imageGeneration: '1',
  engine: 'fixture', promptVersion: 'materials-v1', requiresConfirmation: true,
} as const

// FEの認識待ち/編集/手動入力の開発用。実画像から得た結果ではない。
export const materialRecognitionResponseFixtures = {
  success: MaterialRecognitionResponseSchema.parse({ ...base, status: 'succeeded', result: {
    items: [{ id: `ai-${requestId}-1`, name: '段ボール', quantity: 2, unit: '枚', confidence: 0.82, source: 'ai' }],
    warnings: ['固定応答による開発用データです。実画像の認識結果ではありません。'],
  } }),
  noMaterials: MaterialRecognitionResponseSchema.parse({ ...base, status: 'succeeded', result: {
    items: [], warnings: ['材料を特定できません。実物を見て手動で入力してください。'],
  } }),
  invalidOutput: MaterialRecognitionResponseSchema.parse({ ...base, status: 'failed', reason: 'AI_RESPONSE_INVALID' }),
  timeout: MaterialRecognitionResponseSchema.parse({ ...base, status: 'failed', reason: 'AI_TIMEOUT' }),
}
