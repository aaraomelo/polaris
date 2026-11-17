import { binario, campo, indice, num, PROIBIDAS } from './avalia'
import { LIMITES_EXPR, type Expr, type Funcoes } from './tipos'
import { paraTexto } from './texto'
import { verdadeiro } from './verdade'
import type { Valor } from '../ir/tipos'

// ---------------------------------------------------------------------------
// Expressão → CLOSURE. O avaliador (avalia.ts) percorre a AST a cada chamada; aqui a AST é percorrida UMA vez e vira uma árvore de
// funções que já sabem o que fazer: função resolvida e aridade checada na compilação, caminhos de variável sem `switch`, chamadas com 1/2/3
// argumentos sem arrays. A semântica é a MESMA (campo, indice, binario e as funções são os do avaliador; teste diferencial por fuzz).
//   - parâmetros de função anônima: lista encadeada `lig`, como no avaliador;
//   - orçamento de passos: cada invocação de função anônima cobra o custo ESTÁTICO do seu corpo (nós avaliados, sem os corpos de funções aninhadas,
//     que cobram quando rodam). É um teto do que o avaliador gasta (ele não conta o ramo que o `se`/`&&` não executa): estourou → ausente.
// ---------------------------------------------------------------------------

type Escopo = Record<string, unknown>
type Lig = { nome: string; valor: unknown; prox: Lig | null } | null
type Orc = { n: number }
type Fn = (esc: Escopo, lig: Lig, orc: Orc) => unknown
const ESGOTOU = Symbol('orcamento')
const tem = Object.prototype.hasOwnProperty

/** Nós avaliados ao rodar `e` uma vez, sem entrar nos corpos de funções anônimas (elas cobram nas próprias invocações). */
function custo(e: Expr): number {
  switch (e.t) {
    case 'lit': case 'var': return 1
    case 'fn': return 0
    case 'mem': return 1 + custo(e.obj)
    case 'idx': return 1 + custo(e.obj) + custo(e.idx)
    case 'un': return 1 + custo(e.x)
    case 'bin': return 1 + custo(e.a) + custo(e.b)
    case 'cond': return 1 + custo(e.c) + custo(e.a) + custo(e.b)
    case 'lista': return 1 + e.itens.reduce((s, i) => s + custo(i), 0)
    case 'call': return 1 + e.args.reduce((s, a) => s + custo(a), 0)
  }
}

function compila(e: Expr, funcoes: Funcoes, emFn: boolean): Fn {
  const c = (x: Expr) => compila(x, funcoes, emFn)
  switch (e.t) {
    case 'lit': { const v = e.v; return () => v }
    case 'var': {
      const nome = e.nome
      const global: Fn = PROIBIDAS.has(nome) ? () => undefined : (esc) => (tem.call(esc, nome) ? esc[nome] : undefined)
      if (!emFn) return global // fora de função anônima não há parâmetros ligados: caminho curto
      return (esc, lig, orc) => { for (let l = lig; l; l = l.prox) if (l.nome === nome) return l.valor; return global(esc, lig, orc) }
    }
    case 'mem': { const o = c(e.obj), nome = e.nome; return (esc, lig, orc) => campo(o(esc, lig, orc), nome) }
    case 'idx': { const o = c(e.obj), i = c(e.idx); return (esc, lig, orc) => indice(o(esc, lig, orc), i(esc, lig, orc)) }
    case 'lista': { const itens = e.itens.map(c); return (esc, lig, orc) => itens.map((f) => f(esc, lig, orc)) }
    case 'fn': return () => undefined // função anônima fora de um combinador não tem valor
    case 'un': {
      const x = c(e.x)
      if (e.op === '!') return (esc, lig, orc) => !verdadeiro(x(esc, lig, orc))
      return (esc, lig, orc) => { const v = x(esc, lig, orc); return num(v) ? -v : undefined }
    }
    case 'cond': { const k = c(e.c), a = c(e.a), b = c(e.b); return (esc, lig, orc) => (verdadeiro(k(esc, lig, orc)) ? a(esc, lig, orc) : b(esc, lig, orc)) }
    case 'bin': {
      const a = c(e.a), b = c(e.b), op = e.op
      if (op === '&&') return (esc, lig, orc) => { const x = a(esc, lig, orc); return verdadeiro(x) ? b(esc, lig, orc) : x }
      if (op === '||') return (esc, lig, orc) => { const x = a(esc, lig, orc); return verdadeiro(x) ? x : b(esc, lig, orc) }
      if (op === '??') return (esc, lig, orc) => { const x = a(esc, lig, orc); return x === null || x === undefined ? b(esc, lig, orc) : x }
      return (esc, lig, orc) => binario(op, a(esc, lig, orc), b(esc, lig, orc))
    }
    case 'call': {
      const f = tem.call(funcoes, e.fn) ? funcoes[e.fn] : undefined
      if (!f || e.args.length < f.min || e.args.length > f.max) return () => undefined
      if (f.os) { // combinador: a função anônima não é avaliada como valor, é aplicada a cada item
        const os = f.os
        const fn = e.args[os.fnPos]
        if (!fn || fn.t !== 'fn' || fn.params.length < 1 || fn.params.length > os.paramsMax || e.args.length !== os.fnPos + 1) return () => undefined
        const corpo = compila(fn.corpo, funcoes, true), params = fn.params, cobra = custo(fn.corpo)
        const args = e.args.map((x, i) => (i === os.fnPos ? null : c(x)))
        return (esc, lig, orc) => {
          const vals = args.map((g) => (g === null ? undefined : g(esc, lig, orc)))
          const aplica = (...v: unknown[]) => {
            if ((orc.n -= cobra) < 0) throw ESGOTOU
            let l: Lig = lig
            for (let i = 0; i < params.length; i++) l = { nome: params[i]!, valor: v[i], prox: l }
            return corpo(esc, l, orc)
          }
          return os.impl(vals, aplica)
        }
      }
      const a = e.args.map(c), fn = f.fn
      if (a.length === 1) { const a0 = a[0]!; return (esc, lig, orc) => { const x = a0(esc, lig, orc); try { return fn(x) } catch { return undefined } } }
      if (a.length === 2) { const a0 = a[0]!, a1 = a[1]!; return (esc, lig, orc) => { const x = a0(esc, lig, orc), y = a1(esc, lig, orc); try { return fn(x, y) } catch { return undefined } } }
      if (a.length === 3) { const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!; return (esc, lig, orc) => { const x = a0(esc, lig, orc), y = a1(esc, lig, orc), z = a2(esc, lig, orc); try { return fn(x, y, z) } catch { return undefined } } }
      return (esc, lig, orc) => { const v = a.map((g) => g(esc, lig, orc)); try { return fn(...v) } catch { return undefined } }
    }
  }
}

/** Closure de uma expressão: `(escopo) => valor`. Nunca lança; sempre termina (orçamento de passos nas funções anônimas). */
export function compilaExpr(e: Expr, funcoes: Funcoes): (esc: Escopo) => unknown {
  const f = compila(e, funcoes, false)
  const orcamento = LIMITES_EXPR.passos
  return (esc) => { try { return f(esc, null, { n: orcamento }) } catch (x) { if (x === ESGOTOU) return undefined; throw x } }
}

export type ValorFn = (esc: Escopo) => unknown

/** Closure de um Valor do IR: `expr` mantém o tipo; `tpl` sempre devolve texto; `arr`/`obj` constroem. */
export function compilaValor(v: Valor, funcoes: Funcoes): ValorFn {
  switch (v.t) {
    case 'lit': { const x = v.v; return () => x }
    case 'expr': return compilaExpr(v.ast, funcoes)
    case 'tpl': {
      const partes = v.partes.map((p) => (typeof p === 'string' ? p : compilaExpr(p.ast, funcoes)))
      if (partes.length === 1 && typeof partes[0] !== 'string') { const f = partes[0] as ValorFn; return (esc) => paraTexto(f(esc)) }
      return (esc) => { let r = ''; for (const p of partes) r += typeof p === 'string' ? p : paraTexto(p(esc)); return r }
    }
    case 'arr': { const itens = v.itens.map((x) => compilaValor(x, funcoes)); return (esc) => itens.map((f) => f(esc)) }
    case 'obj': {
      const campos = Object.entries(v.campos).map(([k, x]) => [k, compilaValor(x, funcoes)] as const)
      return (esc) => Object.fromEntries(campos.map(([k, f]) => [k, f(esc)])) // fromEntries: '__proto__' vira propriedade própria
    }
  }
}

// ---- cache por (biblioteca, nó): cada expressão do programa é compilada uma vez ----------------------------------------
const cache = new WeakMap<Funcoes, WeakMap<object, (esc: Escopo) => unknown>>()
function dosAlvos(funcoes: Funcoes) { let m = cache.get(funcoes); if (!m) { m = new WeakMap(); cache.set(funcoes, m) } return m }

/** Avalia com closure em cache (a AST/Valor do IR é imutável: a chave é o próprio objeto). Mesmo resultado de `avalia`. */
export function avaliaC(e: Expr, esc: Escopo, funcoes: Funcoes): unknown {
  const m = dosAlvos(funcoes)
  let f = m.get(e)
  if (!f) { f = compilaExpr(e, funcoes); m.set(e, f) }
  return f(esc)
}
/** Mesmo que `valorDe` (render/valor.ts), com closure em cache. */
export function valorDeC(v: Valor, esc: Escopo, funcoes: Funcoes): unknown {
  const m = dosAlvos(funcoes)
  let f = m.get(v)
  if (!f) { f = compilaValor(v, funcoes); m.set(v, f) }
  return f(esc)
}
