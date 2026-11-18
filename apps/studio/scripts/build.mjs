import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

// Empacota o Studio (cliente) em dist/: um JS, um CSS e o HTML. Sem `eval` e sem CDN: a CSP do servidor permite só 'self'.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..'), dist = join(raiz, 'dist')
mkdirSync(dist, { recursive: true })
const r = await build({ entryPoints: [join(raiz, 'src/cliente/main.tsx')], outfile: join(dist, 'studio.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', minify: true, sourcemap: false, define: { 'process.env.NODE_ENV': '"production"' }, metafile: true, logLevel: 'warning', loader: { '.tsx': 'tsx' } })
// o Studio v2: a PÁGINA da plataforma (nós JSON compilados para um programa) + o hospedeiro que a monta com o runtime vivo
await build({ entryPoints: [join(raiz, 'src/host/main.ts')], outfile: join(dist, 'studio-v2.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', minify: true, sourcemap: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning', loader: { '.tsx': 'tsx' } })
execFileSync('node', ['--import', 'tsx', join(raiz, 'scripts/compila-programa.ts')], { cwd: raiz, stdio: 'inherit' })
copyFileSync(join(raiz, 'public/studio.css'), join(dist, 'studio.css')); copyFileSync(join(raiz, 'public/index.html'), join(dist, 'index.html')); copyFileSync(join(raiz, 'public/v2.html'), join(dist, 'v2.html'))
writeFileSync(join(dist, 'meta.json'), JSON.stringify({ bytes: Object.values(r.metafile.outputs)[0].bytes }))
console.log(`studio.js ${(Object.values(r.metafile.outputs)[0].bytes / 1024).toFixed(0)} KiB`)
