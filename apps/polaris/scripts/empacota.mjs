// Empacota os dois runners em arquivos únicos (dist/servico.mjs, dist/gateway.mjs): a imagem não precisa de pnpm, workspace nem TypeScript.
import { build } from 'esbuild'
const comum = { bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, legalComments: 'none', logLevel: 'info', external: ['pg-native'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } }
await build({ ...comum, entryPoints: { servico: 'bin/servico.ts', gateway: 'bin/gateway.ts', migra: 'bin/migra.ts' }, outdir: 'dist', outExtension: { '.js': '.mjs' } })

// o cliente do Studio (JS, CSS, HTML) vai junto: o gateway o serve em /studio quando POLARIS_STUDIO_DIR aponta para dist/studio
import { cpSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
execFileSync('node', ['scripts/build.mjs'], { cwd: '../studio', stdio: 'inherit' })
mkdirSync('dist/studio', { recursive: true }); cpSync('../studio/dist', 'dist/studio', { recursive: true })
