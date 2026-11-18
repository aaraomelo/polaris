import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export { resolvePreco, operacoesCatalogo, type Candidato, type Preco } from './catalogo'
export { compara, normaliza, paraCentavos4 } from './dinheiro'

/** Os nós (JSON) de um pack, prontos para `registry.registra`. */
export function nosDoPack(pack: 'catalogo'): unknown[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'nos', pack)
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => { const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown; return Array.isArray(j) ? j : [j] })
}
