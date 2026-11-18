import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compilaPrograma, registraBase } from '@polaris/engine'
import { registraTemas } from '@polaris/engine/tema'
import { registroDaPlataforma } from '@polaris/packs'

// Compila a página `studio.app` (nós JSON do pack studio) para o PROGRAMA que o hospedeiro carrega: JSON puro, sem código. Roda no build.
const reg = registroDaPlataforma(); registraBase(reg); registraTemas(reg)
const r = compilaPrograma(reg, reg.resolve('pagina', 'studio.app')!.no)
if (!r.ok) { console.error(JSON.stringify(r.erros.slice(0, 10), null, 1)); process.exit(1) }
const dist = join(import.meta.dirname, '..', 'dist'); mkdirSync(dist, { recursive: true })
const json = JSON.stringify(r.programa); writeFileSync(join(dist, 'studio.programa.json'), json)
console.log(`studio.programa.json ${(json.length / 1024).toFixed(0)} KiB`)
