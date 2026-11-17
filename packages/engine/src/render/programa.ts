import type { Contexto, Erro, No, Registry } from '@polaris/schema'
import { compilaBloco, compilaPagina } from '../ir/compila'
import type { IRBlocoModelo, IRNo, IRPagina } from '../ir/tipos'

/**
 * Programa: tudo o que o runtime precisa para renderizar uma página, sem consultar o registry.
 * É JSON puro: pode ser cacheado, enviado ao cliente e usado na hidratação.
 */
export type Programa = {
  pagina: IRPagina
  /** interface → IR do modelo, para todo bloco composto usado (direta ou transitivamente) */
  blocos: Record<string, IRBlocoModelo>
}

export type ResultadoPrograma = { ok: true; programa: Programa } | { ok: false; erros: Erro[] }

function interfacesCompostas(no: IRNo, acc: Set<string>): void {
  if (no.tipo === 'elemento') {
    if (no.bloco.impl === 'composto') acc.add(no.bloco.interface)
    for (const lista of Object.values(no.slots)) for (const f of lista) interfacesCompostas(f, acc)
  }
}

/** Compila a página e, transitivamente, os modelos de todos os blocos compostos que ela usa. */
export function compilaPrograma(reg: Registry, no: No, ctx: Contexto = {}): ResultadoPrograma {
  const p = compilaPagina(reg, no, ctx)
  if (!p.ok) return p
  const blocos: Record<string, IRBlocoModelo> = {}
  const erros: Erro[] = []
  const fila = new Set<string>()
  interfacesCompostas(p.ir.raiz, fila)
  const vistos = new Set<string>()
  for (const i of fila) {
    if (vistos.has(i)) continue
    vistos.add(i)
    const b = compilaBloco(reg, i, ctx)
    if (!b.ok) {
      erros.push(...b.erros.map((e) => ({ ...e, mensagem: `bloco '${i}': ${e.mensagem}` })))
      continue
    }
    blocos[i] = b.ir
    const novos = new Set<string>()
    interfacesCompostas(b.ir.modelo, novos)
    for (const n of novos) if (!vistos.has(n)) fila.add(n) // Set itera inclusive o que é adicionado durante a iteração
  }
  return erros.length ? { ok: false, erros } : { ok: true, programa: { pagina: p.ir, blocos } }
}
