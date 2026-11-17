import type { Expr, Funcoes } from './tipos'

// Avaliador puro: nunca lança, nunca usa eval/Function, só lê dados próprios do escopo.
// Valor ausente propaga como `undefined` (renderiza vazio), nunca como erro.

const PROIBIDAS = new Set(['__proto__', 'constructor', 'prototype'])

export const verdadeiro = (v: unknown): boolean => {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  if (typeof v === 'number' && Number.isNaN(v)) return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function campo(base: unknown, nome: string): unknown {
  if (PROIBIDAS.has(nome)) return undefined
  if (typeof base === 'string' || Array.isArray(base)) return nome === 'length' ? base.length : undefined
  if (ehObjeto(base) && Object.prototype.hasOwnProperty.call(base, nome)) return base[nome]
  return undefined
}

function indice(base: unknown, i: unknown): unknown {
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

export function avalia(e: Expr, escopo: Escopo, funcoes: Funcoes): unknown {
  switch (e.t) {
    case 'lit': return e.v
    case 'var': return !PROIBIDAS.has(e.nome) && Object.prototype.hasOwnProperty.call(escopo, e.nome) ? escopo[e.nome] : undefined
    case 'mem': return campo(avalia(e.obj, escopo, funcoes), e.nome)
    case 'idx': return indice(avalia(e.obj, escopo, funcoes), avalia(e.idx, escopo, funcoes))
    case 'lista': return e.itens.map((x) => avalia(x, escopo, funcoes))
    case 'un': {
      const v = avalia(e.x, escopo, funcoes)
      return e.op === '!' ? !verdadeiro(v) : num(v) ? -v : undefined
    }
    case 'cond': return verdadeiro(avalia(e.c, escopo, funcoes)) ? avalia(e.a, escopo, funcoes) : avalia(e.b, escopo, funcoes)
    case 'bin': {
      if (e.op === '&&') { const a = avalia(e.a, escopo, funcoes); return verdadeiro(a) ? avalia(e.b, escopo, funcoes) : a }
      if (e.op === '||') { const a = avalia(e.a, escopo, funcoes); return verdadeiro(a) ? a : avalia(e.b, escopo, funcoes) }
      if (e.op === '??') { const a = avalia(e.a, escopo, funcoes); return a === null || a === undefined ? avalia(e.b, escopo, funcoes) : a }
      return binario(e.op, avalia(e.a, escopo, funcoes), avalia(e.b, escopo, funcoes))
    }
    case 'call': {
      const f = Object.prototype.hasOwnProperty.call(funcoes, e.fn) ? funcoes[e.fn] : undefined
      if (!f || e.args.length < f.min || e.args.length > f.max) return undefined
      try { return f.fn(...e.args.map((a) => avalia(a, escopo, funcoes))) } catch { return undefined }
    }
  }
}
