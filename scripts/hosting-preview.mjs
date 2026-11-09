import { spawnSync } from 'node:child_process'
import { error as logError } from 'node:console'
import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { URL, fileURLToPath, pathToFileURL } from 'node:url'

export const PREVIEW_PROJECT = 'gdgoc2026-comake'
export const PREVIEW_DIRECTORY = 'dist-preview'
export function previewChannel(value) {
  if (typeof value !== 'string' || !/^dev-[a-z0-9](?:[a-z0-9-]{0,35}[a-z0-9])?$/.test(value)) throw new Error('Use a dev- channel, for example dev-27. Live deployment is not supported.')
  return value
}
export function previewEnvironment(source) {
  const result = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('VITE_') && !/GEMINI|FIREBASE_CONFIG/.test(key)))
  return { ...result, VITE_DATA_MODE: 'mock', VITE_FIREBASE_PROJECT_ID: 'demo-co-make', VITE_FIREBASE_FUNCTIONS_REGION: 'asia-northeast1' }
}
export function validatePreviewConfig(config) {
  if (Object.keys(config).length !== 1 || !config.hosting || Array.isArray(config.hosting)
    || Object.keys(config.hosting).some((key) => !['site', 'public', 'ignore', 'rewrites', 'headers'].includes(key))
    || config.hosting.site !== PREVIEW_PROJECT || config.hosting.public !== PREVIEW_DIRECTORY
    || JSON.stringify(config.hosting.rewrites) !== JSON.stringify([{ source: '**', destination: '/index.html' }])
    || config.hosting.predeploy || config.hosting.postdeploy) throw new Error('Preview must contain only the fixed static Hosting site and SPA rewrite.')
}
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Command failed: ${file} (exit ${result.status})`)
  return result
}
export async function main(args) {
  const [action, ...rest] = args
  if (!['build', 'deploy'].includes(action) || (action === 'build' ? rest.length !== 0 : rest.length !== 1)) throw new Error('Use build, or deploy dev-CHANNEL.')
  const channel = action === 'deploy' ? previewChannel(rest[0]) : null
  const config = JSON.parse(await readFile(new URL('../firebase.preview.json', import.meta.url), 'utf8'))
  validatePreviewConfig(config)
  const state = run('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout.trim()
  if (action === 'deploy' && state) throw new Error('Commit or preserve your changes before deploying so the Preview identifies an exact commit.')
  const sourceCommit = run('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout.trim()
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Cannot identify the source commit')
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'preview', '--outDir', PREVIEW_DIRECTORY, '--emptyOutDir'], { env: previewEnvironment(process.env) })
  await writeFile(new URL(`../${PREVIEW_DIRECTORY}/release.json`, import.meta.url), `${JSON.stringify({ sourceCommit, dirty: Boolean(state), builtAt: new Date().toISOString(), dataMode: 'mock', backendProjectId: null, hostingProjectId: PREVIEW_PROJECT }, null, 2)}\n`)
  if (channel) run(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'hosting:channel:deploy', channel,
    '--project', PREVIEW_PROJECT, '--config', 'firebase.preview.json', '--expires', '7d', '--no-authorized-domains', '--non-interactive'])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((cause) => { logError(cause.message); process.exitCode = 1 })
}
