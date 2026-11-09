import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { HealthResponseSchema } from '@rekt/shared'

const projectId = 'demo-co-make'
const healthUrl = `http://127.0.0.1:5002/${projectId}/asia-northeast1/health`
let environment: RulesTestEnvironment

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Run npm run test:emulators; this suite must not use a real project.')
  }
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9198, rules: await readFile('storage.rules', 'utf8') },
  })
})
afterAll(async () => { await environment?.cleanup() })

describe('ローカル基盤の結合確認', () => {
  it('認証なしのFunctions呼び出しを拒否する', async () => {
    const response = await fetch(healthUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }),
    })
    expect(response.status).toBe(401)
  })

  it('匿名認証してからFunctionsへ接続できる', async () => {
    const signUp = await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
    })
    expect(signUp.ok).toBe(true)
    const credentials = await signUp.json() as { idToken: string }
    const response = await fetch(healthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.idToken}` },
      body: JSON.stringify({ data: {} }),
    })
    expect(response.ok).toBe(true)
    const result = await response.json() as { result: unknown }
    expect(HealthResponseSchema.safeParse(result.result).success).toBe(true)
  })

  it.each(['guest', 'authenticated'])('%sでも未許可のFirestoreパスに書き込めない', async (kind) => {
    const context = kind === 'guest' ? environment.unauthenticatedContext() : environment.authenticatedContext('member-1')
    await assertFails(context.firestore().doc('foundation-access-check/secret').set({ value: 'blocked' }))
    await assertFails(context.firestore().doc('foundation-access-check/secret').get())
  })

  it.each(['guest', 'authenticated'])('%sでも未許可のStorageパスに書き込めない', async (kind) => {
    const context = kind === 'guest' ? environment.unauthenticatedContext() : environment.authenticatedContext('member-1')
    await assertFails(Promise.resolve(context.storage().ref('foundation-access-check/secret').putString('blocked')))
  })
})
