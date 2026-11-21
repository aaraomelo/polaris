import * as Q from '../num/racional'
import type { Funcao } from './tipos'

// Funções de aritmética EXATA (prefixo `q`, de ℚ). Os valores viajam como TEXTO canônico ("12", "-3/4"), então cabem em
// JSON, em banco e em estado sem perda; entradas aceitas: inteiro, decimal ("12.34", "1e3"), fração ("3/4") ou número JS.
// Entrada inválida, divisão por zero e resultado acima do teto (1000 dígitos) são AUSENTES — nunca um valor errado.

const r = (x: unknown) => Q.parse(x)
const saida = (q: Q.Q | undefined) => (q ? Q.formata(q) : undefined)
const modo = (m: unknown): Q.ModoArredondamento | undefined => (m === undefined ? 'longe' : (Q.MODOS as readonly unknown[]).includes(m) ? (m as Q.ModoArredondamento) : undefined)
const casas = (c: unknown, padrao: number): number | undefined => (c === undefined ? padrao : typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= Q.MAX_CASAS ? c : undefined)

/** Reduz uma lista de operandos com uma operação binária total em Q (qualquer ausente contamina). */
function dobra(args: unknown[], op: (a: Q.Q, b: Q.Q) => Q.Q | undefined): string | undefined {
  let acc = r(args[0])
  for (let i = 1; acc && i < args.length; i++) { const b = r(args[i]); acc = b ? op(acc, b) : undefined }
  return saida(acc)
}

const binaria = (f: (a: Q.Q, b: Q.Q) => Q.Q | undefined) => ({ min: 2, max: 2, fn: (a: unknown, b: unknown) => { const x = r(a), y = r(b); return x && y ? saida(f(x, y)) : undefined } })
const inteiros = (a: unknown, b: unknown): [bigint, bigint] | undefined => { const x = r(a), y = r(b); return x && y && Q.ehInteiro(x) && Q.ehInteiro(y) ? [x.n, y.n] : undefined }

export const fq_racional: Funcao = { min: 1, max: 1, fn: (x) => saida(r(x)) }
export const fq_qsoma: Funcao = { min: 1, max: 16, fn: (...a) => dobra(a, Q.soma) }
export const fq_qmul: Funcao = { min: 1, max: 16, fn: (...a) => dobra(a, Q.mul) }
export const fq_qsub: Funcao = /* @__PURE__ */ binaria(Q.sub)
export const fq_qdiv: Funcao = /* @__PURE__ */ binaria(Q.div)
export const fq_qresto: Funcao = /* @__PURE__ */ binaria(Q.resto)
export const fq_qneg: Funcao = { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? saida(Q.neg(q)) : undefined } }
export const fq_qabs: Funcao = { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? saida(Q.absQ(q)) : undefined } }
export const fq_qcmp: Funcao = { min: 2, max: 2, fn: (a, b) => { const x = r(a), y = r(b); return x && y ? Q.cmp(x, y) : undefined } }
export const fq_qpot: Funcao = { min: 2, max: 2, fn: (a, k) => { const q = r(a); return q && typeof k === 'number' ? saida(Q.pot(q, k)) : undefined } }
export const fq_qpiso: Funcao = { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? String(Q.piso(q)) : undefined } }
export const fq_qnumerador: Funcao = { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? String(q.n) : undefined } }
export const fq_qdenominador: Funcao = { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? String(q.d) : undefined } }
export const fq_qmdc: Funcao = { min: 2, max: 2, fn: (a, b) => { const p = inteiros(a, b); return p ? String(Q.mdc(p[0], p[1])) : undefined } }
export const fq_qmmc: Funcao = { min: 2, max: 2, fn: (a, b) => { const p = inteiros(a, b); if (!p) return undefined; const m = Q.mmc(p[0], p[1]); return Q.classe(m, 1n) ? String(m) : undefined } }
export const fq_qmin: Funcao = { min: 1, max: 16, fn: (...a) => dobra(a, (x, y) => (Q.cmp(x, y) <= 0 ? x : y)) }
export const fq_qmax: Funcao = { min: 1, max: 16, fn: (...a) => dobra(a, (x, y) => (Q.cmp(x, y) >= 0 ? x : y)) }
export const fq_qdec: Funcao = { min: 1, max: 3, fn: (x, c, m) => {
    const q = r(x), k = casas(c, 2), md = modo(m)
    if (!q || k === undefined || !md) return undefined
    const e = Q.arredondaEscalado(q, k, md)
    return e === undefined ? undefined : Q.decimal(e, k)
  } }
export const fq_qformata: Funcao = { min: 1, max: 3, fn: (x, c, m) => {
    const q = r(x), k = casas(c, 2), md = modo(m)
    if (!q || k === undefined || !md) return undefined
    const e = Q.arredondaEscalado(q, k, md)
    return e === undefined ? undefined : Q.decimalPtBR(e, k)
  } }
export const fq_qbrl: Funcao = { min: 1, max: 1, fn: (x) => {
    const q = r(x)
    if (!q) return undefined
    const e = Q.arredondaEscalado(q, 2, 'longe')
    return e === undefined ? undefined : `${e < 0n ? '-' : ''}R$ ${Q.decimalPtBR(e < 0n ? -e : e, 2)}`
  } }
export const fq_qnum: Funcao = { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? Q.paraNumero(q) : undefined } }


/** Reais por idioma, exato e sem Intl: pt/es "R$ 1.234,50", en "R$1,234.50". Só para EXIBIR. */
export const fq_qmoeda: Funcao = { min: 2, max: 2, fn: (x, idioma) => {
  const q = r(x); if (!q) return undefined
  const e = Q.arredondaEscalado(q, 2, 'longe'); if (e === undefined) return undefined
  const base = (typeof idioma === 'string' ? idioma : '').split('-')[0], pt = Q.decimalPtBR(e < 0n ? -e : e, 2)
  const sinal = e < 0n ? '-' : ''
  return base === 'en' ? `${sinal}R$${pt.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'))}` : `${sinal}R$ ${pt}`
} }
