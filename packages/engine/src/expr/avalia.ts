import { LIMITES_EXPR, type Expr, type Funcoes } from './tipos'
import { verdadeiro } from './verdade'

export { verdadeiro }

// Avaliador puro: nunca lança, nunca usa eval/Function, só lê dados próprios do escopo.
// Valor ausente propaga como `undefined` (renderiza vazio), nunca como erro.

export const PROIBIDAS = new Set(['__proto__', 'constructor', 'prototype'])

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function campo(base: unknown, nome: string): unknown {
  if (PROIBIDAS.has(nome)) return undefined
  if (typeof base === 'string' || Array.isArray(base)) return nome === 'length' ? base.length : undefined
  if (ehObjeto(base) && Object.prototype.hasOwnProperty.call(base, nome)) return base[nome]
  return undefined
}

export function indice(base: unknown, i: unknown): unknown {
  if (Array.isArray(base) || typeof base === 'string') {
    return typeof i === 'number' && Number.isInteger(i) && i >= 0 ? (base as ArrayLike<unknown>)[i] : undefined
  }
  if (ehObjeto(base) && typeof i === 'string') return campo(base, i)
  return undefined
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const texto = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v))

function igual(a: unknown, b: unknown): boolean {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  return typeof a === typeof b && typeof a !== 'object' && a === b
}

function binario(op: string, a: unknown, b: unknown): unknown {
  switch (op) {
    case '==': return igual(a, b)
    case '!=': return !igual(a, b)
    case '<': case '<=': case '>': case '>=': {
      if (!((num(a) && num(b)) || (typeof a === 'string' && typeof b === 'string'))) return false
      return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b
    }
    case '+':
      if (num(a) && num(b)) return a + b
      if (typeof a === 'string' || typeof b === 'string') return texto(a) + texto(b)
      return undefined
    case '-': case '*': case '/': case '%': {
      if (!num(a) || !num(b)) return undefined
      if ((op === '/' || op === '%') && b === 0) return undefined
      const r = op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b
      return Number.isFinite(r) ? r : undefined
    }
  }
  return undefined
}

export type Escopo = Record<string, unknown>

/** Variáveis ligadas por funções anônimas (lista encadeada: o parâmetro mais interno primeiro). */
type Lig = { nome: string; valor: unknown; prox: Lig | null } | null
type Orc = { n: number }
const ESGOTOU = Symbol('orcamento')

function av(e: Expr, escopo: Escopo, funcoes: Funcoes, lig: Lig, orc: Orc): unknown {
  if (--orc.n < 0) throw ESGOTOU
  const a_ = (x: Expr) => av(x, escopo, funcoes, lig, orc)
  switch (e.t) {
    case 'lit': return e.v
    case 'var': {
      for (let l = lig; l; l = l.prox) if (l.nome === e.nome) return l.valor
      return !PROIBIDAS.has(e.nome) && Object.prototype.hasOwnProperty.call(escopo, e.nome) ? escopo[e.nome] : undefined
    }
    case 'mem': return campo(a_(e.obj), e.nome)
    case 'idx': return indice(a_(e.obj), a_(e.idx))
    case 'lista': return e.itens.map(a_)
    case 'fn': return undefined // função anônima fora de um combinador não tem valor
    case 'un': {
      const v = a_(e.x)
      return e.op === '!' ? !verdadeiro(v) : num(v) ? -v : undefined
    }
    case 'cond': return verdadeiro(a_(e.c)) ? a_(e.a) : a_(e.b)
    case 'bin': {
      if (e.op === '&&') { const a = a_(e.a); return verdadeiro(a) ? a_(e.b) : a }
      if (e.op === '||') { const a = a_(e.a); return verdadeiro(a) ? a : a_(e.b) }
      if (e.op === '??') { const a = a_(e.a); return a === null || a === undefined ? a_(e.b) : a }
      return binario(e.op, a_(e.a), a_(e.b))
    }
    case 'call': {
      const f = Object.prototype.hasOwnProperty.call(funcoes, e.fn) ? funcoes[e.fn] : undefined
      if (f?.os) {
        const os = f.os
        const fn = e.args[os.fnPos]
        if (!fn || fn.t !== 'fn' || fn.params.length < 1 || fn.params.length > os.paramsMax || e.args.length !== os.fnPos + 1) return undefined
        const args = e.args.map((x, i) => (i === os.fnPos ? undefined : a_(x)))
        const aplica = (...vals: unknown[]) => {
          let l: Lig = lig
          fn.params.forEach((p, i) => { l = { nome: p, valor: vals[i], prox: l } })
          return av(fn.corpo, escopo, funcoes, l, orc)
        }
        return os.impl(args, aplica)
      }
      if (!f || e.args.length < f.min || e.args.length > f.max) return undefined
      const vals = e.args.map(a_)
      try { return f.fn(...vals) } catch { return undefined }
    }
  }
}

/** Avalia com orçamento de passos (nós avaliados): estourou → ausente. Nunca lança, sempre termina. */
export function avalia(e: Expr, escopo: Escopo, funcoes: Funcoes): unknown {
  try { return av(e, escopo, funcoes, null, { n: LIMITES_EXPR.passos }) } catch (x) { if (x === ESGOTOU) return undefined; throw x }
}

/** Como `avalia`, mas diz quantos passos gastou e se o orçamento acabou (para testes e diagnóstico). */
export function avaliaMedindo(e: Expr, escopo: Escopo, funcoes: Funcoes, passos = LIMITES_EXPR.passos): { valor: unknown; passos: number; esgotou: boolean } {
  const orc = { n: passos }
  try { const valor = av(e, escopo, funcoes, null, orc); return { valor, passos: passos - orc.n, esgotou: false } } catch (x) {
    if (x === ESGOTOU) return { valor: undefined, passos, esgotou: true }
    throw x
  }
}
