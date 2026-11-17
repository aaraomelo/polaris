import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Fonte } from './registry'

/** Fonte de disco: lê recursivamente todos os *.json de um diretório (um nó ou um array por arquivo). */
export function fonteDiretorio(dir: string): Fonte {
  return () => {
    const nos: unknown[] = []
    const anda = (d: string) => {
      for (const nome of readdirSync(d).sort()) {
        const p = join(d, nome)
        if (statSync(p).isDirectory()) anda(p)
        else if (nome.endsWith('.json')) {
          const j = JSON.parse(readFileSync(p, 'utf8'))
          Array.isArray(j) ? nos.push(...j) : nos.push(j)
        }
      }
    }
    anda(dir)
    return nos
  }
}
