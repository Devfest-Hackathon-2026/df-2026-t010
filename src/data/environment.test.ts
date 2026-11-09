import { describe, expect, it } from 'vitest'
import { readEnvironment } from './environment'

describe('開発モードの接続先', () => {
  it('設定なしでは外部へ接続しないmockモードになる', () => {
    expect(readEnvironment({}).VITE_DATA_MODE).toBe('mock')
  })
  it('未知のモードを本番接続へフォールバックしない', () => {
    expect(() => readEnvironment({ VITE_DATA_MODE: 'production-typo' })).toThrow()
  })
  it('Emulatorから実プロジェクトへ接続する設定を拒否する', () => {
    expect(() => readEnvironment({ VITE_DATA_MODE: 'emulator', VITE_FIREBASE_PROJECT_ID: 'gdgoc2026-comake' })).toThrow('demo-')
  })
  it('設定不足の実環境接続を拒否する', () => {
    expect(() => readEnvironment({ VITE_DATA_MODE: 'firebase', VITE_FIREBASE_PROJECT_ID: 'gdgoc2026-comake' })).toThrow('Missing Firebase')
  })
  it('実環境には App Check のサイトキーが必要', () => {
    const settings = {
      VITE_DATA_MODE: 'firebase',
      VITE_FIREBASE_PROJECT_ID: 'gdgoc2026-comake',
      VITE_FIREBASE_API_KEY: 'test-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'gdgoc2026-comake.firebaseapp.com',
      VITE_FIREBASE_APP_ID: 'test-app',
      VITE_FIREBASE_STORAGE_BUCKET: 'gdgoc2026-comake.firebasestorage.app',
    }
    expect(() => readEnvironment(settings)).toThrow('VITE_FIREBASE_APP_CHECK_SITE_KEY')
    expect(readEnvironment({ ...settings, VITE_FIREBASE_APP_CHECK_SITE_KEY: 'test-site-key' }).VITE_DATA_MODE).toBe('firebase')
  })
})
