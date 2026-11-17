import type { Expr } from '../expr/index'
import type { IRNo, Valor } from '../ir/tipos'

// Dependências: de quais "chaves de mudança" uma expressão depende. O store imutável gera, a cada ação, o conjunto de chaves
// que mudaram (por referência); só o que depende delas é reavaliado.
//   estado / status / erros / props são granulares:  `estado.nome` depende de 'estado.nome'; acesso dinâmico depende de 'estado'.
//   as demais variáveis (dados, params, item do repetir, indice…) dependem do nome inteiro.
// Toda mudança em `estado` também marca a chave-curinga 'estado' (idem os outros três).

const GRANULARES = new Set(['estado', 'status', 'erros', 'props'])

export function depsExpr(e: Expr, out: Set<string>): void {
  switch (e.t) {
    case 'var': out.add(e.nome); break
    case 'mem':
      if (e.obj.t === 'var' && GRANULARES.has(e.obj.nome)) out.add(`${e.obj.nome}.${e.nome}`)
      else depsExpr(e.obj, out)
      break
    case 'idx':
      if (e.obj.t === 'var' && GRANULARES.has(e.obj.nome) && e.idx.t === 'lit' && typeof e.idx.v === 'string') out.add(`${e.obj.nome}.${e.idx.v}`)
      else { depsExpr(e.obj, out); depsExpr(e.idx, out) }
      break
    case 'un': depsExpr(e.x, out); break
    case 'bin': depsExpr(e.a, out); depsExpr(e.b, out); break
    case 'cond': depsExpr(e.c, out); depsExpr(e.a, out); depsExpr(e.b, out); break
    case 'lista': for (const i of e.itens) depsExpr(i, out); break
    case 'fn': {
      // o que o corpo lê, menos os parâmetros (ligados dentro da função)
      const dentro = new Set<string>()
      depsExpr(e.corpo, dentro)
      for (const k of dentro) { const r = k.indexOf('.') < 0 ? k : k.slice(0, k.indexOf('.')); if (!e.params.includes(r)) out.add(k) }
      break
    }
    case 'call': for (const a of e.args) depsExpr(a, out); break
    case 'lit': break
  }
}

export function depsValor(v: Valor, out: Set<string>): void {
  switch (v.t) {
    case 'lit': break
    case 'expr': depsExpr(v.ast, out); break
    case 'tpl': for (const p of v.partes) if (typeof p !== 'string') depsExpr(p.ast, out); break
    case 'arr': for (const i of v.itens) depsValor(i, out); break
    case 'obj': for (const x of Object.values(v.campos)) depsValor(x, out)
  }
}

export const cruza = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  const [p, g] = a.size <= b.size ? [a, b] : [b, a]
  for (const x of p) if (g.has(x)) return true
  return false
}

const raiz = (k: string) => { const i = k.indexOf('.'); return i < 0 ? k : k.slice(0, i) }
export { raiz as raizDe }

const cacheCabeca = new WeakMap<IRNo, { se: Set<string>; cabeca: Set<string> }>()
const cacheTotal = new WeakMap<IRNo, Set<string>>()

/** Dependências da expressão `se` e da cabeça do `repetir` (cada + chave), cada qual no escopo em que é avaliada. */
export function depsCabeca(no: IRNo): { se: Set<string>; cabeca: Set<string> } {
  let r = cacheCabeca.get(no)
  if (!r) {
    const se = new Set<string>(), cabeca = new Set<string>()
    if (no.se) depsExpr(no.se, se)
    if (no.repetir) { depsExpr(no.repetir.cada, cabeca); if (no.repetir.chave) depsExpr(no.repetir.chave, cabeca) }
    r = { se, cabeca }
    cacheCabeca.set(no, r)
  }
  return r
}

/** Dependências de um nó e de TUDO que ele constrói (props, se, repetir, filhos), sem o que o próprio repetir define. */
export function usaTotal(no: IRNo): Set<string> {
  let r = cacheTotal.get(no)
  if (r) return r
  r = new Set<string>()
  cacheTotal.set(no, r) // entra antes de calcular: sem recursão infinita
  const { se, cabeca } = depsCabeca(no)
  const interno = new Set<string>()
  if (no.tipo === 'elemento') {
    for (const v of Object.values(no.props)) depsValor(v, interno)
    for (const lista of Object.values(no.slots)) for (const f of lista) for (const k of usaTotal(f)) interno.add(k)
  }
  if (no.repetir) { interno.delete(no.repetir.como); interno.delete('indice'); for (const k of [...interno]) if (raiz(k) === no.repetir.como) interno.delete(k) }
  for (const k of se) r.add(k)
  for (const k of cabeca) { if (no.repetir && (raiz(k) === no.repetir.como || raiz(k) === 'indice')) continue; r.add(k) }
  for (const k of interno) r.add(k)
  return r
}
