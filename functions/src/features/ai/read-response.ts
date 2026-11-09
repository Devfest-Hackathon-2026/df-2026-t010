import { GatewayError } from '@rekt/shared'

const MAX_RESPONSE_BYTES = 128 * 1024

export async function readAiJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new GatewayError('AI_UNAVAILABLE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new GatewayError('AI_RESPONSE_INVALID')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
