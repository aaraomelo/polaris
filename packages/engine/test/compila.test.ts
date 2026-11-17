import { describe, expect, it } from 'vitest'
import { FUNCOES_PADRAO, avalia, formata, parseExpr, type Expr } from '../src/expr/index'
import { avaliaMedindo } from '../src/expr/avalia'
import { avaliaC, compilaValor } from '../src/expr/compila'
import { valorDe } from '../src/render/valor'
import type { Valor } from '../src/ir/tipos'

// Teste DIFERENCIAL: o compilador de closures tem de dar exatamente o que o avaliador dá, em qualquer expressão e escopo (inclusive hostis).
let seed = 12
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const ri = (n: number) => Math.floor(rnd() * n)
const pick = <T,>(xs: readonly T[]): T => xs[ri(xs.length)]!

const VARS = ['a', 'b', 's', 'l', 'o', 'n', 'x', 'i', '__proto__', 'constructor', 'nada']
const BINS = ['??', '||', '&&', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%'] as const
const FNS = ['tamanho', 'maiusculas', 'brl', 'junta', 'texto', 'absoluto', 'minimo', 'padrao', 'contem', 'concat', 'soma', 'fatia', 'unicos', 'naoexiste', 'qsoma', 'qmul', 'racional', 'obter', 'com', 'igual', 'intervalo', 'entradas']
const HOS: Array<[string, number, number]> = [['mapeia', 2, 1], ['filtra', 2, 1], ['dobra', 3, 2], ['todos', 2, 1], ['algum', 2, 1], ['acha', 2, 1], ['ordena', 1, 1], ['agrupa', 1, 1], ['atualiza', 2, 1]]

function gera(prof: number, ligadas: string[]): Expr {
  const pos = 0
  if (prof <= 0 || rnd() < 0.2) {
    const k = ri(5)
    if (k === 0) return { t: 'lit', v: pick([0, 1, 2.5, 7, 1e21]), pos }
    if (k === 1) return { t: 'lit', v: pick(['', 'a', 'texto', '3', '1/2', '0.1', '__proto__']), pos }
    if (k === 2) return { t: 'lit', v: pick([true, false, null]), pos }
    return { t: 'var', nome: pick([...VARS, ...ligadas, ...ligadas]), pos }
  }
  const g = (p = prof - 1) => gera(p, ligadas)
  switch (ri(11)) {
    case 0: return { t: 'bin', op: pick(BINS), a: g(), b: g(), pos }
    case 1: return { t: 'un', op: pick(['!', '-'] as const), x: g(), pos }
    case 2: return { t: 'cond', c: g(), a: g(), b: g(), pos }
    case 3: return { t: 'mem', obj: g(), nome: pick(['length', 'nome', 'a', '__proto__', 'constructor', 'x']), pos }
    case 4: return { t: 'idx', obj: g(), idx: g(), pos }
    case 5: return { t: 'lista', itens: Array.from({ length: ri(4) }, () => g()), pos }
    case 6: case 7: return { t: 'call', fn: pick(FNS), args: Array.from({ length: ri(4) }, () => g()), pos }
    default: { // combinador com função anônima (corpo com acesso a parâmetros e ao escopo de fora)
      const [fn, aridade, fnPos] = pick(HOS)
      const nParams = 1 + ri(fn === 'dobra' ? 3 : 2)
      const params = ['x', 'i', 'y'].slice(0, nParams)
      const args: Expr[] = Array.from({ length: aridade }, () => g())
      args[fnPos] = { t: 'fn', params, corpo: gera(prof - 1, [...ligadas, ...params]), pos }
      if (fn === 'atualiza') args[1] = { t: 'lista', itens: [{ t: 'lit', v: pick(['a', 0, 'n']), pos }], pos }
      return { t: 'call', fn, args, pos }
    }
  }
}
const ESCOPOS: Array<Record<string, unknown>> = [
  { a: 3, b: 'x', s: 'texto', l: [1, 2, 3], o: { a: 1, nome: 'n', n: 2 }, n: null, x: [1, [2]], i: 0 },
  JSON.parse('{"__proto__":{"p":1},"constructor":"c","a":{"nome":"z"},"l":[],"o":{},"s":"","b":0,"n":-5}'),
  { a: [{ nome: 'a', n: 1 }, { nome: 'b', n: 2 }], l: [3, 1, 2], o: { a: [1, 2], n: 7 }, s: '12.5', b: true },
  {},
]

describe('closures ≡ avaliador', () => {
  it('FUZZ: 6000 expressões (com combinadores e funções anônimas) × escopos hostis dão o MESMO valor', () => {
    let comLambda = 0
    for (let i = 0; i < 6000; i++) {
      const e = gera(1 + ri(5), [])
      if (JSON.stringify(e).includes('"fn"')) comLambda++
      const esc = pick(ESCOPOS)
      const a = avalia(e, esc, FUNCOES_PADRAO), c = avaliaC(e, esc, FUNCOES_PADRAO)
      expect(c, formata(e)).toEqual(a)
    }
    expect(comLambda).toBeGreaterThan(500) // o fuzz realmente exercita funções anônimas
  })

  it('o escopo é lido a CADA chamada (a closure não congela valores) e o mesmo nó reaproveita a compilação', () => {
    const e = parseExpr('a + b * 2')
    const esc: Record<string, unknown> = { a: 1, b: 2 }
    expect(avaliaC(e, esc, FUNCOES_PADRAO)).toBe(5)
    esc.a = 10; esc.b = 5
    expect(avaliaC(e, esc, FUNCOES_PADRAO)).toBe(20)
    delete esc.b
    expect(avaliaC(e, esc, FUNCOES_PADRAO)).toBeUndefined()
  })

  it('nomes proibidos e funções inexistentes/aridade errada continuam ausentes', () => {
    for (const src of ['__proto__', 'constructor', 'o.__proto__', 'naoexiste(1)', 'tamanho()', 'tamanho(1, 2)', 'mapeia(l)', 'mapeia(l, 5)', 'o["constructor"]']) {
      const e = parseExpr(src)
      expect(avaliaC(e, ESCOPOS[1]!, FUNCOES_PADRAO), src).toEqual(avalia(e, ESCOPOS[1]!, FUNCOES_PADRAO))
    }
  })

  it('parâmetros de função anônima sombreiam o escopo, aninhados e com índice', () => {
    const casos = ['mapeia(l, x => mapeia(l, x => x * 10))', 'mapeia(l, (x, i) => x + i + a)', 'dobra(l, 0, (s, x) => s + x)', 'mapeia(l, x => mapeia(l, y => x * 100 + y))', 'mapeia(l, a => a)', 'filtra(l, x => x > a)']
    for (const src of casos) { const e = parseExpr(src); expect(avaliaC(e, ESCOPOS[0]!, FUNCOES_PADRAO), src).toEqual(avalia(e, ESCOPOS[0]!, FUNCOES_PADRAO)) }
  })

  it('orçamento: laços aninhados enormes e crescimento por concat terminam (ausente), rápido, nos dois', () => {
    for (const src of ['mapeia(intervalo(1000), a => mapeia(intervalo(1000), b => mapeia(intervalo(1000), c => a + b + c)))', 'tamanho(dobra(intervalo(40), l, (acc, x) => concat(acc, acc)))']) {
      const e = parseExpr(src)
      const t0 = performance.now()
      const c = avaliaC(e, { l: [1, 2, 3] }, FUNCOES_PADRAO)
      expect(performance.now() - t0, src).toBeLessThan(3000)
      expect(c, src).toEqual(avalia(e, { l: [1, 2, 3] }, FUNCOES_PADRAO))
    }
    expect(avaliaMedindo(parseExpr('mapeia(intervalo(1000), a => mapeia(intervalo(1000), b => mapeia(intervalo(1000), c => a)))'), {}, FUNCOES_PADRAO).esgotou).toBe(true)
  })

  it('uma função que lança vira ausente (não derruba a avaliação)', () => {
    const F = { ...FUNCOES_PADRAO, boom: { min: 1, max: 3, fn: () => { throw new Error('x') } } }
    for (const src of ['boom(1)', 'boom(1, 2)', 'boom(1, 2, 3)', 'boom(a) ?? "ok"']) expect(avaliaC(parseExpr(src), { a: 1 }, F), src).toEqual(avalia(parseExpr(src), { a: 1 }, F))
  })
})

describe('Valor compilado ≡ valorDe', () => {
  it('lit, expr, tpl (com ausentes, objetos e números), arr e obj (inclusive chave __proto__)', () => {
    const ex = (s: string) => ({ t: 'expr', ast: parseExpr(s), fonte: s }) as Valor
    const v: Valor = { t: 'obj', campos: { a: ex('l'), b: { t: 'tpl', partes: ['x=', { ast: parseExpr('s'), fonte: 's' }, ' y=', { ast: parseExpr('o'), fonte: 'o' }, ' z=', { ast: parseExpr('nada'), fonte: 'nada' }, ' n=', { ast: parseExpr('a + 1'), fonte: 'a+1' }] }, c: { t: 'arr', itens: [{ t: 'lit', v: 1 }, ex('s'), { t: 'lit', v: null }] }, d: { t: 'tpl', partes: [{ ast: parseExpr('b'), fonte: 'b' }] } } }
    for (const esc of ESCOPOS) expect(compilaValor(v, FUNCOES_PADRAO)(esc)).toEqual(valorDe(v, esc, FUNCOES_PADRAO))
    const hostil = JSON.parse('{"__proto__":{"t":"lit","v":"pwn"},"normal":{"t":"lit","v":"ok"}}') as Record<string, Valor>
    const r = compilaValor({ t: 'obj', campos: hostil }, FUNCOES_PADRAO)({}) as Record<string, unknown>
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype); expect(Object.keys(r).sort()).toEqual(['__proto__', 'normal']); expect(({} as Record<string, unknown>).t).toBeUndefined()
  })
})
