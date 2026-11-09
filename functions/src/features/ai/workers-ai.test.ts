import { describe, expect, it, vi } from 'vitest'
import { createWorkersAiJsonClient } from './workers-ai'

const accountId = '0'.repeat(32)
const request = { systemPrompt: 'Extract materials', prompt: 'Use Japanese', jsonSchema: { type: 'object' } }
const respond = (result: object) => Response.json({ success: true, result })
const createClient = (fetcher: typeof fetch) => createWorkersAiJsonClient({
  accountId, apiToken: 'test-only-token', timeoutMs: 1000, fetcher,
})

describe('Workers AI inference', () => {
  it('sends the photo inline to the vision model and parses its JSON answer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(respond({
      choices: [{ finish_reason: 'stop', message: { content: '\u0060\u0060\u0060json\n{"items":[],"warnings":[]}\n\u0060\u0060\u0060' } }],
      usage: { input_tokens: 12, output_tokens: 9 },
    }))
    const bytes = Buffer.from('photo')
    await expect(createClient(fetcher)({ ...request, image: { mimeType: 'image/jpeg', bytes } }))
      .resolves.toEqual({ items: [], warnings: [] })
    const [url, options] = fetcher.mock.calls[0]!
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/qwen/qwen3.8-27b`)
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-only-token' })
    expect(options?.body).not.toContain('test-only-token')
    expect(JSON.parse(String(options?.body))).toMatchObject({
      messages: [{ role: 'system' }, { role: 'user', content: [
        { type: 'text', text: request.prompt },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,cGhvdG8=' } },
      ] }],
      response_format: { type: 'json_schema', json_schema: request.jsonSchema },
      reasoning_effort: 'low', stream: false,
    })
  })

  it('requests the project schema from the text model and accepts structured JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(respond({ response: { ideas: [] } }))
    await expect(createClient(fetcher)({ ...request, maxOutputTokens: 12000 })).resolves.toEqual({ ideas: [] })
    const [url, options] = fetcher.mock.calls[0]!
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/qwen/qwen3-30b-a3b-fp8`)
    expect(JSON.parse(String(options?.body))).toMatchObject({
      response_format: { type: 'json_schema', json_schema: request.jsonSchema }, max_tokens: 6000, stream: false,
    })
  })

  it('reports a quota rejection without issuing another request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    await expect(createClient(fetcher)(request)).rejects.toMatchObject({ reason: 'AI_BUDGET_EXHAUSTED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
