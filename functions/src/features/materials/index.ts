import { getApp } from 'firebase-admin/app'
import { defineString } from 'firebase-functions/params'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { RecognizeMaterialsInputSchema } from '@rekt/shared'
import { requireUserId } from '../../lib/auth'
import { fail, parseInput } from '../../lib/errors'
import { DEFAULT_GEMINI_MODEL } from '../ai/gemini'
import { recognitionEngine } from '../ai/mode'
import { aiSecrets, createAiClient } from '../ai/provider'
import { MATERIALS_SYSTEM_PROMPT, MATERIALS_JSON_SCHEMA } from '../../prompts/materials-v1'
import { loadMaterialImage } from './image'
import { materialRecognitionFixtures } from './fixtures'
import { runMaterialRecognition } from './service'

const mode = defineString('MATERIAL_RECOGNITION_MODE', { default: 'disabled' })
const model = defineString('MATERIAL_RECOGNITION_MODEL', { default: DEFAULT_GEMINI_MODEL })
const emulator = process.env.FUNCTIONS_EMULATOR === 'true'

export const recognizeMaterials = onCall({
  region: 'asia-northeast1', timeoutSeconds: 60, memory: '256MiB', maxInstances: 1, minInstances: 0, concurrency: 1,
  secrets: aiSecrets(process.env.MATERIAL_RECOGNITION_MODE, emulator),
}, async (request) => {
  const uid = requireUserId(request.auth)
  const input = parseInput(RecognizeMaterialsInputSchema, request.data)
  const selected = process.env.CO_MAKE_AI_FIXTURES === '1' ? 'fixture' : mode.value()
  const engine = recognitionEngine(selected, emulator, getApp().options.projectId)
  const generate = engine === 'fixture' ? null : createAiClient(engine, model.value(), 25_000)
  try {
    return await runMaterialRecognition(uid, input, {
      engine, loadImage: loadMaterialImage,
      infer: async (image, operation) => {
        if (!generate) return materialRecognitionFixtures[operation.locale]
        return generate({ systemPrompt: MATERIALS_SYSTEM_PROMPT, prompt: operation.locale === 'ja' ? '写真に写る工作材料を日本語で抽出してください。Write all names and units in Japanese.' : 'Extract the visible craft materials. Write all names and units in English.', jsonSchema: MATERIALS_JSON_SCHEMA, image })
      },
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    return fail('TEMPORARILY_UNAVAILABLE')
  }
})
