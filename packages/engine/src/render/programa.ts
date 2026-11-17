import type { Contexto, Erro, No, Registry } from '@polaris/schema'
import { compilaBloco, compilaPagina } from '../ir/compila'
import { compilaCodigo, type CodigoDef } from '../codigo/def'
import type { IRBlocoModelo, IRNo, IRPagina } from '../ir/tipos'

/**
 * Programa: tudo o que o runtime precisa para renderizar uma página, sem consultar o registry.
 * É JSON puro: pode ser cacheado, enviado ao cliente e usado na hidratação.
 */
export type Programa = {
  pagina: IRPagina
  /** interface → IR do modelo, para todo bloco composto usado (direta ou transitivamente) */
  blocos: Record<string, IRBlocoModelo>
  /** interface → definição validada de cada bloco de código usado (execução isolada: ver docs/sandbox.md) */
  codigos: Record<string, CodigoDef>
}

export type ResultadoPrograma = { ok: true; programa: Programa } | { ok: false; erros: Erro[] }

type Coleta = { compostas: Set<string>; codigos: Set<string> }

/** Blocos compostos e de código usados numa árvore: slots E esqueletos (que também renderizam). */
function coleta(no: IRNo, acc: Coleta): void {
  if (no.tipo !== 'elemento') return
  if (no.bloco.impl === 'composto') acc.compostas.add(no.bloco.interface)
  if (no.bloco.impl === 'codigo') acc.codigos.add(no.bloco.interface)
  for (const lista of Object.values(no.slots)) for (const f of lista) coleta(f, acc)
  if (no.esqueleto) coleta(no.esqueleto, acc)
}

/** Compila a página e, transitivamente, os modelos de todos os blocos compostos que ela usa. */
export function compilaPrograma(reg: Registry, no: No, ctx: Contexto = {}): ResultadoPrograma {
  const p = compilaPagina(reg, no, ctx)
  if (!p.ok) return p
  const blocos: Record<string, IRBlocoModelo> = {}
  const erros: Erro[] = []
  const achados: Coleta = { compostas: new Set(), codigos: new Set() }
  coleta(p.ir.raiz, achados)
  const fila = achados.compostas
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
    const novos: Coleta = { compostas: new Set(), codigos: new Set() }
    coleta(b.ir.modelo, novos)
    for (const n of novos.compostas) if (!vistos.has(n)) fila.add(n) // Set itera inclusive o que é adicionado durante a iteração
    for (const c of novos.codigos) achados.codigos.add(c)
  }
  const codigos: Record<string, CodigoDef> = {}
  for (const i of achados.codigos) {
    const c = compilaCodigo(reg, i, ctx)
    if (c.ok) codigos[i] = c.def
    else erros.push(...c.erros)
  }
  return erros.length ? { ok: false, erros } : { ok: true, programa: { pagina: p.ir, blocos, codigos } }
}
