import { mkdirSync, copyFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

// Empacota o Studio em dist/: o hospedeiro (JS), o PROGRAMA compilado da página (JSON), o CSS e o HTML. Sem `eval` e sem CDN: a CSP do servidor permite só 'self'.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..'), dist = join(raiz, 'dist')
mkdirSync(dist, { recursive: true })
// o Studio: a PÁGINA da plataforma (nós JSON compilados para um programa) + o hospedeiro que a monta com o runtime vivo
await build({ entryPoints: [join(raiz, 'src/host/main.ts')], outfile: join(dist, 'studio.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', minify: true, sourcemap: false, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning', loader: { '.tsx': 'tsx' } })
execFileSync('node', ['--import', 'tsx', join(raiz, 'scripts/compila-programa.ts')], { cwd: raiz, stdio: 'inherit' })
console.log(`studio.js ${(statSync(join(dist, 'studio.js')).size / 1024).toFixed(0)} KiB`)
copyFileSync(join(raiz, 'public/studio.css'), join(dist, 'studio.css')); copyFileSync(join(raiz, 'public/index.html'), join(dist, 'index.html'))
