import { analisa } from '../expr/analise'
import type { Expr } from '../expr/tipos'
import type { IRAcao, IRNo, Valor } from '../ir/tipos'
import type { Programa } from '../render/programa'

// O que uma página USA: as funções da biblioteca chamadas por qualquer expressão (página, modelos dos blocos compostos, ações) e
// os blocos nativos (interfaces) que ela instancia. É a entrada do bundle por página (AOT): o resto da biblioteca fica de fora.

export type Uso = { funcoes: string[]; interfaces: string[]; /** blocos de código (executam isolados; o pacote leva o plugin) */ codigos: string[] }

export function usoDoPrograma(programa: Programa): Uso {
  const funcoes = new Set<string>(), interfaces = new Set<string>(), codigos = new Set<string>()
  const expr = (e: Expr) => { for (const c of analisa(e).chamadas) funcoes.add(c.fn) }
  const valor = (v: Valor): void => {
    switch (v.t) {
      case 'lit': break
      case 'expr': expr(v.ast); break
      case 'tpl': for (const p of v.partes) if (typeof p !== 'string') expr(p.ast); break
      case 'arr': v.itens.forEach(valor); break
      case 'obj': Object.values(v.campos).forEach(valor)
    }
  }
  const acao = (a: IRAcao): void => {
    if (a.acao === 'definir') expr(a.valor)
    else if (a.acao === 'navegar') valor(a.para)
    else if (a.acao === 'baixar') { valor(a.nome); expr(a.conteudo) }
    else { Object.values(a.args).forEach(valor); a.depois.forEach(acao); a.emErro.forEach(acao) }
  }
  const visto = new WeakSet<IRNo>()
  const no = (n: IRNo): void => {
    if (visto.has(n)) return
    visto.add(n)
    if (n.se) expr(n.se)
    if (n.repetir) { expr(n.repetir.cada); if (n.repetir.chave) expr(n.repetir.chave) }
    if (n.tipo !== 'elemento') return
    if (n.bloco.impl === 'nativo') for (const c of n.bloco.cadeia) interfaces.add(c)
    if (n.bloco.impl === 'codigo') { codigos.add(n.bloco.interface); for (const p of programa.codigos?.[n.bloco.interface]?.partes ?? []) if (typeof p !== 'string') expr(p.ast) } // {{ }} do html em iframe também chama funções
    Object.values(n.props).forEach(valor)
    for (const l of Object.values(n.slots)) l.forEach(no)
    for (const l of Object.values(n.eventos ?? {})) l.forEach(acao)
    if (n.esqueleto) no(n.esqueleto)
  }
  no(programa.pagina.raiz)
  if (programa.pagina.titulo) valor(programa.pagina.titulo)
  for (const d of Object.values(programa.pagina.dados)) Object.values(d.args).forEach(valor)
  for (const m of Object.values(programa.blocos)) no(m.modelo)
  return { funcoes: [...funcoes].sort(), interfaces: [...interfaces].sort(), codigos: [...codigos].sort() }
}
