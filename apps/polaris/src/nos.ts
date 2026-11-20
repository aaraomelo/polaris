import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Registry } from '@polaris/schema'

/** Carrega todos os nós *.json (recursivo) num Registry; qualquer nó inválido derruba a partida, listando todos. */
/** `trocar` (opcional) reescreve o TEXTO de cada arquivo antes de lê-lo (ex.: trocar `@img/hero` pelo endereço da foto no site). */
export function carregaNos(dir: string, reg = new Registry(), trocar?: (texto: string) => string): Registry {
  const erros: string[] = []
  const anda = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) { anda(p); continue }
      if (!e.endsWith('.json')) continue
      try { const texto = readFileSync(p, 'utf8'), j = JSON.parse(trocar ? trocar(texto) : texto) as unknown; for (const n of Array.isArray(j) ? j : [j]) reg.registra(n) } catch (x) { erros.push(`${p}: ${(x as Error).message.split('\n')[0]}`) }
    }
  }
  anda(dir)
  if (erros.length) throw new Error(`nós inválidos:\n${erros.map((e) => `  - ${e}`).join('\n')}`)
  return reg
}
