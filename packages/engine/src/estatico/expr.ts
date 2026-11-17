import { avalia, campo, indice, PROIBIDAS } from '../expr/avalia'
import type { Escopo } from '../expr/avalia'
import type { Expr, Funcoes } from '../expr/tipos'

// Expressão → closure. Os casos quentes (literal, variável, campo, índice, chamada de função) viram closures diretas;
// o resto delega ao `avalia` (mesma semântica, uma implementação só: `campo`/`indice`/PROIBIDAS são os do avaliador).

export type Fn = (esc: Escopo) => unknown
const tem = Object.prototype.hasOwnProperty

export function compilaExpr(e: Expr, funcoes: Funcoes): Fn {
  switch (e.t) {
    case 'lit': { const v = e.v; return () => v }
    case 'var': {
      const nome = e.nome
      if (PROIBIDAS.has(nome)) return () => undefined
      return (esc) => (tem.call(esc, nome) ? esc[nome] : undefined)
    }
    case 'mem': { const o = compilaExpr(e.obj, funcoes), nome = e.nome; return (esc) => campo(o(esc), nome) }
    case 'idx': { const o = compilaExpr(e.obj, funcoes), i = compilaExpr(e.idx, funcoes); return (esc) => indice(o(esc), i(esc)) }
    case 'call': {
      const f = tem.call(funcoes, e.fn) ? funcoes[e.fn] : undefined
      if (!f || e.args.length < f.min || e.args.length > f.max) return () => undefined
      const a = e.args.map((x) => compilaExpr(x, funcoes)), fn = f.fn
      if (a.length === 1) { const a0 = a[0]!; return (esc) => { try { return fn(a0(esc)) } catch { return undefined } } }
      if (a.length === 2) { const a0 = a[0]!, a1 = a[1]!; return (esc) => { try { return fn(a0(esc), a1(esc)) } catch { return undefined } } }
      return (esc) => { try { return fn(...a.map((g) => g(esc))) } catch { return undefined } }
    }
    default: return (esc) => avalia(e, esc, funcoes)
  }
}
