// @vitest-environment happy-dom
import '../../test/setup'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GatewayError } from '@rekt/shared'
import { readEnvironment } from '../../data/environment'
import { useOperation } from './useOperation'

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

const storageKey = (operation: string) => `co-make:pending:${readEnvironment(import.meta.env).VITE_DATA_MODE}:${operation}`
const payload = { revision: 1 }

function denyStorage(method: 'getItem' | 'setItem' | 'removeItem', name: string) {
  const storage = sessionStorage
  vi.stubGlobal('sessionStorage', {
    getItem: storage.getItem.bind(storage),
    setItem: storage.setItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
    [method]: () => { throw new DOMException('Storage unavailable', name) },
  })
}

it.each([
  ['getItem', 'SecurityError'],
  ['setItem', 'QuotaExceededError'],
] as const)('reuses the request ID across remounts when %s fails', async (method, name) => {
  const action = vi.fn().mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE')).mockResolvedValue(true)
  denyStorage(method, name)
  const first = renderHook(useOperation)
  await act(async () => { await first.result.current.run(method, payload, action) })
  expect(first.result.current.error?.reason).toBe('TEMPORARILY_UNAVAILABLE')
  first.unmount()

  const second = renderHook(useOperation)
  await act(async () => { expect(await second.result.current.run(method, payload, action)).toBe(true) })
  expect(action.mock.calls[1]).toEqual(action.mock.calls[0])
  await act(async () => { await second.result.current.run(method, payload, action) })
  expect(action.mock.calls[2]).not.toEqual(action.mock.calls[0])
})

it('recovers a persisted operation, then clears its record after success', async () => {
  const operation = 'persisted'
  const key = storageKey(operation)
  const requestId = crypto.randomUUID()
  sessionStorage.setItem(key, JSON.stringify({ payloadKey: JSON.stringify(payload), requestId }))
  const { result } = renderHook(useOperation)
  const action = vi.fn().mockResolvedValue(true)
  await act(async () => { await result.current.run(operation, payload, action) })
  expect(action).toHaveBeenCalledWith(requestId)
  expect(sessionStorage.getItem(key)).toBeNull()
})

it('ignores corrupt storage and starts a new request when the payload changes', async () => {
  const operation = 'corrupt'
  sessionStorage.setItem(storageKey(operation), '{')
  const action = vi.fn().mockRejectedValueOnce(new GatewayError('TEMPORARILY_UNAVAILABLE')).mockResolvedValue(true)
  const { result } = renderHook(useOperation)
  await act(async () => { await result.current.run(operation, payload, action) })
  await act(async () => { await result.current.run(operation, { revision: 2 }, action) })
  expect(action).toHaveBeenCalledTimes(2)
  expect(action.mock.calls[1]).not.toEqual(action.mock.calls[0])
})

it('starts a new request even if an acknowledged record could not be removed', async () => {
  const operation = 'remove-blocked'
  denyStorage('removeItem', 'SecurityError')
  const action = vi.fn().mockResolvedValue(true)
  const { result } = renderHook(useOperation)
  await act(async () => { await result.current.run(operation, payload, action) })
  expect(sessionStorage.getItem(storageKey(operation))).not.toBeNull()
  await act(async () => { await result.current.run(operation, payload, action) })
  expect(action.mock.calls[1]).not.toEqual(action.mock.calls[0])
})
