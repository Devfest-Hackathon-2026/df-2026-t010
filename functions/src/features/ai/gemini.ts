import { z } from 'zod'
import { GatewayError } from '@rekt/shared'
import { readAiJson } from './read-response'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'
const EnvelopeSchema = z.object({ candidates: z.array(z.object({
  finishReason: z.literal('STOP'), content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).max(32) }),
})).length(1) })
export interface GeminiJsonRequest {
  systemPrompt: string; prompt: string; jsonSchema: object; maxOutputTokens?: number; image?: { mimeType: string; bytes: Buffer }
}
export function createGeminiJsonClient({ apiKey, model = DEFAULT_GEMINI_MODEL, fetcher = fetch, timeoutMs = 25_000 }: { apiKey: string; model?: string; fetcher?: typeof fetch; timeoutMs?: number }) {
  return async (input: GeminiJsonRequest): Promise<unknown> => {
    if (!apiKey.trim()) throw new GatewayError('AI_DISABLED')
    if (!/^gemini-[a-z0-9.-]{1,70}$/.test(model)) throw new GatewayError('AI_DISABLED')
    try {
      const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          contents: [{ role: 'user', parts: [
            ...(input.image ? [{ inlineData: { mimeType: input.image.mimeType, data: input.image.bytes.toString('base64') } }] : []),
            { text: input.prompt },
          ] }],
          generationConfig: { temperature: 0, maxOutputTokens: input.maxOutputTokens ?? 4096, thinkingConfig: { thinkingLevel: 'minimal' },
            responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: input.jsonSchema } } },
        }),
      })
      // No automatic retry: a network failure may still represent a billable generation.
      const parsed = EnvelopeSchema.safeParse(await readAiJson(response))
      if (!parsed.success) throw new GatewayError('AI_RESPONSE_INVALID')
      const text = parsed.data.candidates[0]!.content.parts.filter((part) => !part.thought).map((part) => part.text ?? '').join('').trim()
      if (!text) throw new GatewayError('AI_RESPONSE_INVALID')
      return JSON.parse(text) as unknown
    } catch (error) {
      if (error instanceof GatewayError) throw error
      if (error instanceof SyntaxError) throw new GatewayError('AI_RESPONSE_INVALID')
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new GatewayError('AI_TIMEOUT')
      throw new GatewayError('AI_UNAVAILABLE')
    }
  }
}
