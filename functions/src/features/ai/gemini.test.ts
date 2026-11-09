import { describe, expect, it, vi } from 'vitest'
import { createGeminiJsonClient } from './gemini'
import { recognitionEngine } from './mode'

const request = { systemPrompt: 'Extract visible materials only', prompt: 'Use Japanese', jsonSchema: { type: 'object' }, image: { mimeType: 'image/png', bytes: Buffer.from('image-data') } }
const envelope = (text: string, finishReason = 'STOP') => JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] })
describe('Gemini JSON接続', () => {
  it('キーをヘッダーだけに入れ、画像をinlineで送る', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(envelope('{"items":[],"warnings":[]}')))
    expect(await createGeminiJsonClient({ apiKey: 'test-only-key', fetcher })(request)).toEqual({ items: [], warnings: [] })
    const [url, options] = fetcher.mock.calls[0]!
    expect(String(url)).toMatch(/^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/gemini-3.5-flash-lite:generateContent$/)
    expect(url).not.toContain('test-only-key')
    expect(options?.headers).toMatchObject({ 'x-goog-api-key': 'test-only-key' })
    expect(options?.redirect).toBe('error')
    expect(options?.body).not.toContain('test-only-key')
    expect(JSON.parse(String(options?.body))).toMatchObject({ contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: request.image.bytes.toString('base64') } }, { text: request.prompt }] }], generationConfig: { maxOutputTokens: 4096, responseFormat: { text: { mimeType: 'APPLICATION_JSON' } } } })
  })
  it.each([429, 500, 503])('HTTP %iでも自動再試行しない', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider details', { status }))
    await expect(createGeminiJsonClient({ apiKey: 'test-only-key', fetcher })(request)).rejects.toMatchObject({ reason: 'AI_UNAVAILABLE', message: 'AI_UNAVAILABLE' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['', '{}', '{"candidates":[]}', envelope('{"items":'), envelope('{}', 'MAX_TOKENS'), envelope('```json\n{}\n```')])('空・拒否・打ち切り・不正JSONを安全な失敗にする', async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
    await expect(createGeminiJsonClient({ apiKey: 'test-only-key', fetcher })(request)).rejects.toMatchObject({ reason: 'AI_RESPONSE_INVALID' })
  })
  it('巨大応答とタイムアウトを上限付きの失敗にする', async () => {
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(129 * 1024)))
    await expect(createGeminiJsonClient({ apiKey: 'test-only-key', fetcher: oversized })(request)).rejects.toMatchObject({ reason: 'AI_RESPONSE_INVALID' })
    const timedOut = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error('private details'), { name: 'TimeoutError' }))
    await expect(createGeminiJsonClient({ apiKey: 'test-only-key', fetcher: timedOut })(request)).rejects.toMatchObject({ reason: 'AI_TIMEOUT', message: 'AI_TIMEOUT' })
    expect(timedOut).toHaveBeenCalledTimes(1)
  })
})
describe('有料推論と固定応答の切り替え', () => {
  it('固定応答はdemoプロジェクトのEmulatorだけで許可する', () => {
    expect(recognitionEngine('fixture', true, 'demo-co-make')).toBe('fixture')
    expect(recognitionEngine('gemini', false, 'gdgoc2026-comake')).toBe('gemini')
    for (const [mode, emulator, project] of [['fixture', false, 'demo-co-make'], ['fixture', true, 'gdgoc2026-comake'], ['gemini', true, 'demo-co-make'], ['disabled', false, 'gdgoc2026-comake']] as const) expect(() => recognitionEngine(mode, emulator, project)).toThrow(expect.objectContaining({ details: { schemaVersion: 2, reason: 'AI_DISABLED' } }))
  })
})
