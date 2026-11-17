import { avalia, type Escopo } from '../expr/avalia'
import { funcoesPadrao } from '../expr/padrao'
import { paraTexto } from '../expr/texto'
import type { Funcoes } from '../expr/tipos'
import type { Valor } from '../ir/tipos'

export { paraTexto }

/** Avalia um Valor do IR no escopo. `expr` mantém o tipo; `tpl` sempre devolve texto. */
export function valorDe(v: Valor, escopo: Escopo, funcoes: Funcoes = funcoesPadrao()): unknown {
  switch (v.t) {
    case 'lit': return v.v
    case 'expr': return avalia(v.ast, escopo, funcoes)
    case 'tpl': return v.partes.map((p) => (typeof p === 'string' ? p : paraTexto(avalia(p.ast, escopo, funcoes)))).join('')
    case 'arr': return v.itens.map((x) => valorDe(x, escopo, funcoes))
    case 'obj': return Object.fromEntries(Object.entries(v.campos).map(([k, x]) => [k, valorDe(x, escopo, funcoes)]))
  }
}
