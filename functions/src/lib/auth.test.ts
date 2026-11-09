import { describe, expect, it } from 'vitest'
import { requireUserId } from './auth'

describe('requireUserId', () => {
  it('認証のない呼び出しを拒否する', () => {
    expect(() => requireUserId(undefined)).toThrow(expect.objectContaining({ code: 'unauthenticated' }))
  })
  it('認証済みUIDを引き渡す', () => {
    expect(requireUserId({ uid: 'member-1' })).toBe('member-1')
  })
})
