import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compilaPrograma, registraBase } from '@polaris/engine'
import { registraSite } from '@polaris/engine/site'
import { TEMA_PADRAO, cssDoTema, registraTemas } from '@polaris/engine/tema'
import { registroDaPlataforma } from '@polaris/packs'

// Compila a página `studio.app` (nós JSON do pack studio) para o PROGRAMA que o hospedeiro carrega: JSON puro, sem código. Roda no build.
const reg = registroDaPlataforma(); registraBase(reg); registraTemas(reg); registraSite(reg)
const r = compilaPrograma(reg, reg.resolve('pagina', 'studio.app')!.no)
if (!r.ok) { console.error(JSON.stringify(r.erros.slice(0, 10), null, 1)); process.exit(1) }
const dist = join(import.meta.dirname, '..', 'dist'); mkdirSync(dist, { recursive: true })
const json = JSON.stringify(r.programa); writeFileSync(join(dist, 'studio.programa.json'), json)
// o CSS do tema (variáveis e a folha dos blocos, com o modo escuro): o Studio é uma página da plataforma e usa os mesmos blocos e tokens do site
writeFileSync(join(dist, 'tema.css'), cssDoTema(TEMA_PADRAO))
console.log(`studio.programa.json ${(json.length / 1024).toFixed(0)} KiB`)
