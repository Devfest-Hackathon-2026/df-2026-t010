import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { URL } from 'node:url'
import { previewChannel, previewEnvironment, validatePreviewConfig } from './hosting-preview.mjs'

test('deployment rejects live, arbitrary projects and flag/shell injection before running any command', () => {
  assert.equal(previewChannel('dev-27'), 'dev-27')
  for (const value of ['live', 'production', 'gdgoc2026-comake', '--project', 'dev-27; echo unsafe', '../live', '', undefined, 'dev-']) assert.throws(() => previewChannel(value))
})
test('preview cannot inherit Firebase mode, public env secrets or Gemini credentials', () => {
  const env = previewEnvironment({ PATH: '/test', VITE_DATA_MODE: 'firebase', VITE_FIREBASE_PROJECT_ID: 'production', VITE_PRIVATE_KEY: 'sentinel', GEMINI_API_KEY: 'secret', FIREBASE_CONFIG: 'secret' })
  assert.deepEqual(env, { PATH: '/test', VITE_DATA_MODE: 'mock', VITE_FIREBASE_PROJECT_ID: 'demo-co-make', VITE_FIREBASE_FUNCTIONS_REGION: 'asia-northeast1' })
})
test('preview config refuses backend deployment, a changed site, another build or dynamic rewrites', async () => {
  const config = JSON.parse(await readFile(new URL('../firebase.preview.json', import.meta.url), 'utf8'))
  assert.doesNotThrow(() => validatePreviewConfig(config))
  for (const altered of [
    { ...config, functions: [] },
    { ...config, hosting: { ...config.hosting, site: 'another-project' } },
    { ...config, hosting: { ...config.hosting, public: 'dist' } },
    { ...config, hosting: { ...config.hosting, predeploy: ['firebase deploy'] } },
    { ...config, hosting: { ...config.hosting, source: 'functions' } },
    { ...config, hosting: { ...config.hosting, rewrites: [{ source: '**', function: 'backend' }] } },
  ]) assert.throws(() => validatePreviewConfig(altered))
})
