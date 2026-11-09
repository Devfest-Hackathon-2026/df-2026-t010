import { describe, expect, it } from 'vitest'
import { HealthResponseSchema, LanguageSchema } from './contracts'

describe('API境界の検証', () => {
  it('未対応の言語を拒否する', () => {
    expect(LanguageSchema.safeParse('fr').success).toBe(false)
  })
  it('別サービスや未対応バージョンの応答を拒否する', () => {
    expect(HealthResponseSchema.safeParse({ service: 'other', status: 'ok', version: 1 }).success).toBe(false)
    expect(HealthResponseSchema.safeParse({ service: 'co-make', status: 'ok', version: 2 }).success).toBe(false)
  })
})
