import { readdir, readFile, stat } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { fileURLToPath, URL } from 'node:url'
import { build } from 'esbuild'

const root = new URL('../../', import.meta.url)
const directory = new URL('content/templates/', root)
const files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort()
const catalog = await Promise.all(files.map(async (file) => JSON.parse(await readFile(new URL(file, directory), 'utf8'))))
// Run the same pure shared schema at build time, without installing a TS runner or
// keeping a second JavaScript copy of the contract. Nothing is written to disk.
const validator = await build({
  entryPoints: [fileURLToPath(new URL('shared/src/project-candidates.ts', root))],
  bundle: true, platform: 'node', target: 'node22', format: 'esm', write: false,
})
const { VerifiedTemplateCatalogSchema } = await import(`data:text/javascript;base64,${Buffer.from(validator.outputFiles[0].contents).toString('base64')}`)
VerifiedTemplateCatalogSchema.parse(catalog)
for (const template of catalog) {
  if (Buffer.byteLength(JSON.stringify(template), 'utf8') > 512_000) throw new Error('Template exceeds the snapshot size limit')
  for (const step of template.steps ?? []) {
    if (typeof step.photoPath !== 'string' || !/^\/steps\/[A-Za-z0-9_/-]+\.(jpg|jpeg|png|webp)$/.test(step.photoPath)) throw new Error('Invalid template photo path')
    // #12 supplies real, permission-cleared photographs. Missing assets block build.
    if (!(await stat(new URL(`public${step.photoPath}`, root))).isFile()) throw new Error('Template photo must be a file')
  }
}

await build({
  absWorkingDir: fileURLToPath(new URL('functions/', root)),
  entryPoints: ['src/index.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: 'lib/index.js',
  external: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],
  // Immutable server-owned catalog, included in the deployed bundle. No client JSON,
  // demo/sample templates, or network retrieval can enter the feasibility decision.
  define: { REKT_TEMPLATE_CATALOG: JSON.stringify(catalog) },
})
