import * as Q from '../num/racional'
import type { Funcoes } from './tipos'

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

export const FUNCOES_EXATAS: Funcoes = {
  racional: { min: 1, max: 1, fn: (x) => saida(r(x)) },
  qsoma: { min: 1, max: 16, fn: (...a) => dobra(a, Q.soma) },
  qmul: { min: 1, max: 16, fn: (...a) => dobra(a, Q.mul) },
  qsub: binaria(Q.sub),
  qdiv: binaria(Q.div),
  qresto: binaria(Q.resto),
  qneg: { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? saida(Q.neg(q)) : undefined } },
  qabs: { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? saida(Q.absQ(q)) : undefined } },
  qcmp: { min: 2, max: 2, fn: (a, b) => { const x = r(a), y = r(b); return x && y ? Q.cmp(x, y) : undefined } },
  qpot: { min: 2, max: 2, fn: (a, k) => { const q = r(a); return q && typeof k === 'number' ? saida(Q.pot(q, k)) : undefined } },
  qpiso: { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? String(Q.piso(q)) : undefined } },
  qnumerador: { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? String(q.n) : undefined } },
  qdenominador: { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? String(q.d) : undefined } },
  qmdc: { min: 2, max: 2, fn: (a, b) => { const p = inteiros(a, b); return p ? String(Q.mdc(p[0], p[1])) : undefined } },
  qmmc: { min: 2, max: 2, fn: (a, b) => { const p = inteiros(a, b); if (!p) return undefined; const m = Q.mmc(p[0], p[1]); return Q.classe(m, 1n) ? String(m) : undefined } },
  qmin: { min: 1, max: 16, fn: (...a) => dobra(a, (x, y) => (Q.cmp(x, y) <= 0 ? x : y)) },
  qmax: { min: 1, max: 16, fn: (...a) => dobra(a, (x, y) => (Q.cmp(x, y) >= 0 ? x : y)) },
  qdec: { min: 1, max: 3, fn: (x, c, m) => {
    const q = r(x), k = casas(c, 2), md = modo(m)
    if (!q || k === undefined || !md) return undefined
    const e = Q.arredondaEscalado(q, k, md)
    return e === undefined ? undefined : Q.decimal(e, k)
  } },
  qformata: { min: 1, max: 3, fn: (x, c, m) => {
    const q = r(x), k = casas(c, 2), md = modo(m)
    if (!q || k === undefined || !md) return undefined
    const e = Q.arredondaEscalado(q, k, md)
    return e === undefined ? undefined : Q.decimalPtBR(e, k)
  } },
  qbrl: { min: 1, max: 1, fn: (x) => {
    const q = r(x)
    if (!q) return undefined
    const e = Q.arredondaEscalado(q, 2, 'longe')
    return e === undefined ? undefined : `${e < 0n ? '-' : ''}R$ ${Q.decimalPtBR(e < 0n ? -e : e, 2)}`
  } },
  qnum: { min: 1, max: 1, fn: (x) => { const q = r(x); return q ? Q.paraNumero(q) : undefined } },
}
