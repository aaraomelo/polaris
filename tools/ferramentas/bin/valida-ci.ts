import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { validaWorkflow } from '../src/ci.ts'

// uso: valida-ci.ts   (da raiz do repositório)
const raiz = process.cwd()
const scripts = Object.keys((JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {})
const dir = join(raiz, '.github', 'workflows')
let total = 0
for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
  const erros = validaWorkflow(readFileSync(join(dir, f), 'utf8'), scripts)
  for (const e of erros) console.error(`✗ ${f}: ${e}`)
  total += erros.length
}
console.log(total ? `${total} problema(s) nos workflows` : 'ok: workflows conferidos')
process.exit(total ? 1 : 0)
