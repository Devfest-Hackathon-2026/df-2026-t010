import { useRef, useState } from 'react'
import { z } from 'zod'
import { RequestIdSchema } from '@rekt/shared'
import type { GatewayError } from '@rekt/shared'
import { gatewayError } from '../../data/errors'
import { requestId } from '../../data/request-id'
import { readEnvironment } from '../../data/environment'

const PendingOperationSchema = z.strictObject({ payloadKey: z.string(), requestId: RequestIdSchema })
type PendingOperation = z.infer<typeof PendingOperationSchema>
const pendingOperations = new Map<string, PendingOperation | null>()

function readPending(key: string): PendingOperation | null {
  if (pendingOperations.has(key)) return pendingOperations.get(key) ?? null
  try {
    const serialized = sessionStorage.getItem(key)
    return PendingOperationSchema.safeParse(JSON.parse(serialized ?? 'null')).data ?? null
  } catch {
    return null
  }
}

function rememberPending(key: string, operation: PendingOperation) {
  pendingOperations.set(key, operation)
  try {
    sessionStorage.setItem(key, JSON.stringify(operation))
  } catch {
    // The in-memory entry still supports retries during this page session.
  }
}

function acknowledgePending(key: string, id: string) {
  if (pendingOperations.get(key)?.requestId !== id) return
  try {
    sessionStorage.removeItem(key)
    pendingOperations.delete(key)
  } catch {
    // Ignore the acknowledged ID if a later read can still see it in storage.
    pendingOperations.set(key, null)
  }
}

export function useOperation() {
  const running = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<GatewayError | null>(null)
  async function run<T>(operation: string, payload: unknown, action: (id: string) => Promise<T>): Promise<T | undefined> {
    if (running.current) return undefined
    running.current = true
    setPending(true); setError(null)
    try {
      const key = `co-make:pending:${readEnvironment(import.meta.env).VITE_DATA_MODE}:${operation}`
      const payloadKey = JSON.stringify(payload)
      const saved = readPending(key)
      const id = saved?.payloadKey === payloadKey ? saved.requestId : requestId()
      rememberPending(key, { payloadKey, requestId: id })
      const result = await action(id)
      acknowledgePending(key, id)
      return result
    } catch (cause) { setError(gatewayError(cause)); return undefined } finally { running.current = false; setPending(false) }
  }
  return { pending, error, run }
}
