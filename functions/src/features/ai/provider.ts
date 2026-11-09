import { defineSecret } from 'firebase-functions/params'
import { fail } from '../../lib/errors'
import { createGeminiJsonClient } from './gemini'
import { createWorkersAiJsonClient } from './workers-ai'

const geminiKey = defineSecret('GEMINI_API_KEY')
const workersToken = defineSecret('WORKERS_AI_API_TOKEN')

export function aiSecrets(mode: string | undefined, emulator: boolean) {
  if (emulator) return []
  return mode === 'workers-ai' ? [workersToken] : [geminiKey]
}

export function createAiClient(engine: 'gemini' | 'workers-ai', model: string, timeoutMs: number) {
  if (engine === 'workers-ai') {
    const apiToken = workersToken.value()
    const accountId = process.env.WORKERS_AI_ACCOUNT_ID ?? ''
    if (!apiToken?.trim() || !/^[a-f0-9]{32}$/i.test(accountId)) fail('AI_DISABLED')
    return createWorkersAiJsonClient({
      apiToken,
      accountId,
      timeoutMs,
    })
  }
  const apiKey = geminiKey.value()
  if (!apiKey?.trim()) fail('AI_DISABLED')
  return createGeminiJsonClient({ apiKey, model, timeoutMs })
}
