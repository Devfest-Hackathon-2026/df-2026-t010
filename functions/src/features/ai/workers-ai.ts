import { z } from 'zod'
import { GatewayError } from '@rekt/shared'
import type { GeminiJsonRequest } from './gemini'
import { readAiJson } from './read-response'

const IMAGE_MODEL = '@cf/qwen/qwen3.8-27b'
const TEXT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'
const ResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    response: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    choices: z.array(z.object({
      finish_reason: z.literal('stop'),
      message: z.object({ content: z.string() }),
    })).length(1).optional(),
  }),
})

export function createWorkersAiJsonClient({ apiToken, accountId, timeoutMs, fetcher = fetch }: {
  apiToken: string
  accountId: string
  timeoutMs: number
  fetcher?: typeof fetch
}) {
  return async (input: GeminiJsonRequest): Promise<unknown> => {
    if (!apiToken.trim() || !/^[a-f0-9]{32}$/i.test(accountId)) throw new GatewayError('AI_DISABLED')
    const image = input.image
    const model = image ? IMAGE_MODEL : TEXT_MODEL
    const maxTokens = image ? 2048 : 6000
    const content = image ? [
      { type: 'text', text: input.prompt },
      { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}` } },
    ] : `${input.prompt}\n/no_think`
    const body = {
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content },
      ],
      response_format: { type: 'json_schema', json_schema: input.jsonSchema },
      max_tokens: Math.min(input.maxOutputTokens ?? maxTokens, maxTokens),
      ...(image ? { reasoning_effort: 'low' } : {}),
    }
    try {
      const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ ...body, stream: false, temperature: 0 }),
      })
      if (response.status === 429) throw new GatewayError('AI_BUDGET_EXHAUSTED')
      const parsed = ResponseSchema.safeParse(await readAiJson(response))
      if (!parsed.success) throw new GatewayError('AI_RESPONSE_INVALID')
      const payload = parsed.data.result
      const result = image ? payload.choices?.[0]?.message.content : payload.response
      if (typeof result === 'object' && result !== null) return result
      if (typeof result !== 'string' || !result.trim()) throw new GatewayError('AI_RESPONSE_INVALID')
      const text = result.trim().replace(/^<think>[\s\S]*?<\/think>\s*/, '')
      const fenced = text.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i)
      return JSON.parse(fenced?.[1] ?? text) as unknown
    } catch (error) {
      if (error instanceof GatewayError) throw error
      if (error instanceof SyntaxError) throw new GatewayError('AI_RESPONSE_INVALID')
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new GatewayError('AI_TIMEOUT')
      throw new GatewayError('AI_UNAVAILABLE')
    }
  }
}
