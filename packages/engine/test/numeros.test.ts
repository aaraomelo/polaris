import { describe, expect, it } from 'vitest'
import { FUNCOES_PADRAO, avalia, parseExpr } from '../src/expr/index'
import * as Q from '../src/num/racional'

const ev = (src: string, esc: Record<string, unknown> = {}) => avalia(parseExpr(src), esc, FUNCOES_PADRAO)
let seed = 77
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const ri = (n: number) => Math.floor(rnd() * n)

describe('racional exato: classe, parse e formato', () => {
  it('a classe é única: (a,b) e (ka,kb) são o mesmo número (§Q1 do Tiffany)', () => {
    for (let a = -6; a <= 6; a++) for (let b = 1; b <= 8; b++) for (let k = -5; k <= 5; k++) {
      if (k === 0) continue
      const x = Q.classe(BigInt(a), BigInt(b))!, y = Q.classe(BigInt(k * a), BigInt(k * b))!
      expect(Q.formata(x)).toBe(Q.formata(y))
      expect(x.d > 0n).toBe(true)
      expect(Q.mdc(x.n, x.d)).toBe(a === 0 ? x.d : 1n)
    }
  })
  it('parse: inteiro, decimal, expoente, fração, número JS; rejeita o resto', () => {
    const f = (x: unknown) => { const q = Q.parse(x); return q ? Q.formata(q) : undefined }
    expect(f('12')).toBe('12'); expect(f('+12')).toBe('12'); expect(f('-0')).toBe('0'); expect(f('007')).toBe('7')
    expect(f('12.34')).toBe('617/50'); expect(f('.5')).toBe('1/2'); expect(f('5.')).toBe('5'); expect(f('-0.25')).toBe('-1/4')
    expect(f('1e3')).toBe('1000'); expect(f('1.5E-2')).toBe('3/200'); expect(f('25e-1')).toBe('5/2')
    expect(f('6/4')).toBe('3/2'); expect(f('-6/4')).toBe('-3/2')
    expect(f(0.1)).toBe('1/10'); expect(f(1e21)).toBe('1000000000000000000000'); expect(f(-2.5)).toBe('-5/2'); expect(f(5e-7)).toBe('1/2000000')
    for (const ruim of ['', ' 1', '1 ', '1/0', '1/-2', '1/2/3', 'a', '1,5', '--1', '.', 'e3', '1e', '0x10', '1_0', Infinity, NaN, null, undefined, true, [], {}]) expect(f(ruim), JSON.stringify(ruim)).toBeUndefined()
  })
  it('teto explícito: acima de 1000 dígitos é ausente (nunca valor errado)', () => {
    const grande = '9'.repeat(1000)
    expect(Q.parse(grande)).toBeDefined() // o teto é 10^1000 (exclusive): 1000 noves ainda cabem
    expect(ev('racional(x)', { x: '9'.repeat(999) })).toBe('9'.repeat(999))
    expect(ev('racional(x)', { x: '1'.padEnd(1001, '0') })).toBeUndefined()
    expect(ev('racional(x)', { x: '1e1001' })).toBeUndefined()
    expect(ev('racional(x)', { x: '1e-1001' })).toBeUndefined()
    expect(ev('qmul(x, x)', { x: '9'.repeat(600) })).toBeUndefined() // o produto passaria do teto
    expect(ev('qpot(10, 999)')).toBe('1'.padEnd(1000, '0'))
    expect(ev('qpot(10, 1000)')).toBeUndefined()
    expect(ev('qpot(2, 100000)')).toBeUndefined()
    expect(ev('racional(x)', { x: '1'.repeat(5000) })).toBeUndefined() // entrada longa demais nem é lida
    // potência gigante é recusada ANTES de calcular (senão 10^900 elevado a 1000 levaria segundos de BigInt)
    const t0 = performance.now()
    expect(ev('qpot(x, 1000)', { x: '9'.repeat(900) })).toBeUndefined()
    expect(ev('qpot(x, -1000)', { x: `1/${'9'.repeat(900)}` })).toBeUndefined()
    expect(performance.now() - t0).toBeLessThan(100)
  })
})

describe('as leis do Tiffany (racional_pg.c §Q1–§Q4) sobre o nosso Q', () => {
  const R = (n: number, d: number) => Q.classe(BigInt(n), BigInt(d))!
  it('§Q2/§Q3: ⊗ e ⊕ só dependem das classes; ⊗ distribui sobre ⊕ (exaustivo em pequenos)', () => {
    let casos = 0
    for (let a = -4; a <= 4; a++) for (let b = 1; b <= 5; b++) for (let c = -4; c <= 4; c++) for (let d = 1; d <= 5; d++) for (let k = 1; k <= 3; k++) {
      const x = R(a, b), y = R(c, d)
      // escalar os pares (não as classes) não muda o resultado: a classe é construída do par bruto
      const p2 = Q.classe(BigInt(k * a) * BigInt(2 * c), BigInt(k * b) * BigInt(2 * d))!
      expect(Q.formata(Q.mul(x, y)!)).toBe(Q.formata(p2))
      const s2 = Q.classe(BigInt(3 * a) * BigInt(2 * d) + BigInt(3 * b) * BigInt(2 * c), BigInt(3 * b) * BigInt(2 * d))!
      expect(Q.formata(Q.soma(x, y)!)).toBe(Q.formata(s2))
      casos++
    }
    for (let a = -3; a <= 3; a++) for (let b = 1; b <= 4; b++) for (let c = -3; c <= 3; c++) for (let d = 1; d <= 4; d++) for (let e = -3; e <= 3; e++) {
      const x = R(a, b), y = R(c, d), z = R(e, 2)
      expect(Q.formata(Q.mul(x, Q.soma(y, z)!)!)).toBe(Q.formata(Q.soma(Q.mul(x, y)!, Q.mul(x, z)!)!))
    }
    expect(casos).toBeGreaterThan(5000)
  })
  it('§Q4: comparação sem divisão — tricotomia, antissimetria, transitividade, compatível com a soma', () => {
    const xs: Q.Q[] = []
    for (let a = -5; a <= 5; a++) for (let b = 1; b <= 4; b++) xs.push(R(a, b))
    for (const x of xs) for (const y of xs) {
      expect(Q.cmp(x, y) + Q.cmp(y, x)).toBe(0) // antissimetria
      expect(Q.cmp(x, y) === 0).toBe(Q.formata(x) === Q.formata(y)) // igual ⟺ mesma classe
      // confere com a divisão exata em BigInt
      expect(Q.cmp(x, y)).toBe(x.n * y.d < y.n * x.d ? -1 : x.n * y.d > y.n * x.d ? 1 : 0)
    }
    for (let i = 0; i < 3000; i++) {
      const [x, y, z] = [xs[ri(xs.length)]!, xs[ri(xs.length)]!, xs[ri(xs.length)]!]
      if (Q.cmp(x, y) < 0 && Q.cmp(y, z) < 0) expect(Q.cmp(x, z)).toBe(-1)
      if (Q.cmp(x, y) < 0) expect(Q.cmp(Q.soma(x, z)!, Q.soma(y, z)!)).toBe(-1)
    }
  })
  it('o que o Tiffany MEDE como teto da palavra aqui não existe: 1% ao mês por 120 meses (PG) é exato e confere com a fórmula fechada', () => {
    // p/q = 101/100: com `long` (64 bits) o Tiffany para em ~4 passos; com BigInt a PG vai até o teto de 1000 dígitos
    let acc = R(1, 1)
    const razao = R(101, 100)
    for (let k = 1; k <= 120; k++) acc = Q.mul(acc, razao)!
    expect(acc.n).toBe(101n ** 120n); expect(acc.d).toBe(100n ** 120n)
    expect(Q.formata(Q.pot(razao, 120)!)).toBe(Q.formata(acc))
    expect(ev('qdec(qpot("1.01", 120), 6)')).toBe(Q.decimal(Q.arredondaEscalado(acc, 6, 'longe')!, 6))
    // e o double já errou (nos últimos dígitos) onde o racional não erra
    expect(Math.abs(Number(ev('qnum(qpot("1.01", 120))')) - 1.01 ** 120)).toBeLessThan(1e-9)
  })
})

describe('dinheiro: o que o double erra e o racional não', () => {
  it('0,1 + 0,2, somas longas, parcelas e arredondamento comercial', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(ev('qsoma("0.1", "0.2") == racional("0.3")')).toBe(true)
    expect(ev('qdec(dobra(intervalo(1000), "0", (s, i) => qsoma(s, "0.1")), 2)')).toBe('100.00') // 1000 × 0,10 exato (no double dá 99.9999999999986)
    expect(ev('dobra(intervalo(1000), 0, (s, i) => s + 0.1)')).not.toBe(100)
    expect(ev('qdec("2.675", 2)')).toBe('2.68'); expect((2.675).toFixed(2)).toBe('2.67') // o toFixed do JS erra por causa do double
    // dividir 100,00 em 3 parcelas SEM perder um centavo (a última absorve o resto)
    expect(ev('mapeia(intervalo(3), i => i)')).toEqual([0, 1, 2])
    const parcelas = ev('dobra(intervalo(3), [], (acc, i) => concat(acc, [i < 2 ? qdec(qdiv("100", 3), 2, "baixo") : qdec(qsub("100", qmul(qdec(qdiv("100", 3), 2, "baixo"), 2)), 2)]))') as string[]
    expect(parcelas).toEqual(['33.33', '33.33', '33.34'])
    expect(ev('qdec(qsoma(a, b, c), 2)', { a: parcelas[0], b: parcelas[1], c: parcelas[2] })).toBe('100.00')
  })
  it('qbrl e qformata batem com brl/Intl onde o double é exato, e acertam onde não é', () => {
    for (const v of [0, 1, 1234.5, 0.07, 99.99, 1e6, 123456.78, -42.1]) expect(ev('qbrl(x)', { x: v }), String(v)).toBe(ev('brl(x)', { x: v }))
    expect(ev('qformata("12345678901234567890.125", 2)')).toBe('12.345.678.901.234.567.890,13') // acima de 2^53: o double nem representa
    expect(ev('qbrl("12345678901234567890.125")')).toBe('R$ 12.345.678.901.234.567.890,13')
  })
  it('qdec: todos os modos conferem com a definição (exaustivo em 1/8 de passo)', () => {
    for (let k = -40; k <= 40; k++) {
      const x = Q.classe(BigInt(k), 8n)!
      const v = k / 8
      const esperado = { zero: Math.trunc(v), baixo: Math.floor(v), cima: Math.ceil(v), longe: Math.sign(v) * Math.round(Math.abs(v)), par: (() => { const f = Math.floor(v), r = v - f; return r < 0.5 ? f : r > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1) })() }
      for (const m of Q.MODOS) {
        const e = Q.arredondaEscalado(x, 0, m)!
        expect(Number(e), `${k}/8 ${m}`).toBe(esperado[m] === 0 ? 0 : esperado[m])
      }
    }
  })
})

describe('totalidade: ausente em vez de erro', () => {
  it('entradas inválidas e divisão por zero em todas as funções q', () => {
    for (const f of ['qsoma', 'qsub', 'qmul', 'qdiv', 'qresto', 'qcmp', 'qmdc', 'qmmc']) expect(ev(`${f}(1, "x")`), f).toBeUndefined()
    expect(ev('qdiv(1, 0)')).toBeUndefined(); expect(ev('qdiv(1, "0/5")')).toBeUndefined(); expect(ev('qresto(1, 0)')).toBeUndefined()
    expect(ev('qpot(0, -1)')).toBeUndefined(); expect(ev('qpot(2, "x")')).toBeUndefined(); expect(ev('qpot(2, 1.5)')).toBeUndefined()
    expect(ev('qdec("x")')).toBeUndefined(); expect(ev('qdec(1, -1)')).toBeUndefined(); expect(ev('qdec(1, 2, "meio")')).toBeUndefined()
    expect(ev('qnum("x")')).toBeUndefined(); expect(ev('qnum(x)', { x: null })).toBeUndefined()
  })
  it('FUZZ: nenhuma função q lança, qualquer que seja a entrada', () => {
    const lixo = () => [null, undefined, true, '', 'abc', '1/0', '9'.repeat(2000), 1e308, -1e-308, NaN, Infinity, [], {}, '1e999', '0.', '.0', '-', '+', '١٢٣'][ri(19)]
    const nomes = Object.keys(FUNCOES_PADRAO).filter((n) => n.startsWith('q') || n === 'racional')
    expect(nomes.length).toBeGreaterThan(15)
    for (const n of nomes) { const f = FUNCOES_PADRAO[n]!; for (let i = 0; i < 200; i++) { const args = Array.from({ length: f.min + ri(Math.min(3, f.max - f.min + 1)) }, lixo); expect(() => f.fn(...args), n).not.toThrow() } }
  })
})
