import { describe, expect, it } from 'vitest'
import { compilaJs, compilaKernel, executaInterpretado, KernelErro, sat } from '../src'
import { geraKernel } from './gera'

const saxpy = compilaKernel('saxpy', { entradas: { a: { tipo: 'decimal' }, x: { tipo: 'decimal', lista: true }, y: { tipo: 'decimal', lista: true } }, saidas: { r: { tipo: 'decimal', lista: true } }, restricoes: ['a >= 0'], corpo: { locais: [{ nome: 't', valor: 'a * x' }], saidas: { r: 't + y' } } })

describe('referência js', () => {
  it('saxpy em f32: o resultado é o de Math.fround, não o de double', () => {
    const x = [0.1, 1 / 3, 16777216, 1e-8], y = [0.2, 0.7, 1, 3], a = 0.3
    const r = executaInterpretado(saxpy, { a, x, y }, 4)
    for (let i = 0; i < 4; i++) expect(r.r![i]).toBe(Math.fround(Math.fround(Math.fround(a) * Math.fround(x[i]!)) + Math.fround(y[i]!)))
    expect(r.r).toBeInstanceOf(Float32Array); expect(r.r![0]).not.toBe(0.3 * 0.1 + 0.2)
  })
  it('contrato de entrada: faltando, sobrando, tamanho, tipo, restrição, n', () => {
    const e = (x: any, n = 2) => () => executaInterpretado(saxpy, x, n)
    expect(e({ a: 1, x: [1, 2] })).toThrow(/falta a entrada y/); expect(e({ a: 1, x: [1, 2], y: [1, 2], z: 1 })).toThrow(/desconhecida/)
    expect(e({ a: 1, x: [1], y: [1, 2] })).toThrow(/lista de 2 elementos/); expect(e({ a: 1, x: 5, y: [1, 2] })).toThrow(/lista/)
    expect(e({ a: [1], x: [1, 2], y: [1, 2] })).toThrow(/valor único/); expect(e({ a: NaN, x: [1, 2], y: [1, 2] })).toThrow(/finito/)
    expect(e({ a: 1e39, x: [1, 2], y: [1, 2] })).toThrow(/faixa de f32/); expect(e({ a: -1, x: [1, 2], y: [1, 2] })).toThrow(/restrição 1 violada/)
    expect(e({ a: 1, x: [1, 2], y: [1, 2] }, -1)).toThrow(KernelErro); expect(e({ a: 1, x: [1, 2], y: [1, 2] }, 1.5)).toThrow(KernelErro)
    const lim = compilaKernel('l', { entradas: {}, saidas: { r: { tipo: 'inteiro', lista: true } }, dominio: { maxElementos: 3 }, corpo: { saidas: { r: 'i' } } })
    expect(() => executaInterpretado(lim, {}, 4)).toThrow(/acima do limite/); expect(Array.from(executaInterpretado(lim, {}, 3).r!)).toEqual([0, 1, 2])
  })
  it('inteiros: soma/produto dão a volta em 32 bits; i32() satura e NaN vira 0', () => {
    const ker = compilaKernel('k', { entradas: { a: { tipo: 'inteiro', lista: true }, f: { tipo: 'decimal', lista: true } }, saidas: { s: { tipo: 'inteiro', lista: true }, p: { tipo: 'inteiro', lista: true }, t: { tipo: 'inteiro', lista: true } }, corpo: { saidas: { s: 'a + 1', p: 'a * a', t: 'i32(f)' } } })
    const r = executaInterpretado(ker, { a: [2147483647, 65536], f: [1e20, -2.9] }, 2)
    expect(Array.from(r.s!)).toEqual([-2147483648, 65537]); expect(Array.from(r.p!)).toEqual([1, 0]); expect(Array.from(r.t!)).toEqual([2147483647, -2])
    expect([sat(NaN), sat(-1e20), sat(2.99), sat(-2.99)]).toEqual([0, -2147483648, 2, -2])
  })
  it('booleanos e seleção', () => {
    const ker = compilaKernel('k', { entradas: { a: { tipo: 'decimal', lista: true }, f: { tipo: 'booleano' } }, saidas: { r: { tipo: 'decimal', lista: true }, b: { tipo: 'booleano', lista: true } }, corpo: { saidas: { r: 'f && a > 1 ? a : -a', b: '!(a > 1) || f == false' } } })
    const r = executaInterpretado(ker, { a: [0, 2], f: true }, 2); expect(Array.from(r.r!)).toEqual([-0, 2]); expect(Array.from(r.b!)).toEqual([1, 0])
  })
  it('FUZZ: o js compilado ≡ o interpretador, bit a bit (400 kernels × 3 tamanhos)', () => {
    let kernels = 0
    for (let s = 1; s <= 400; s++) {
      const g = geraKernel(s); const k = compilaKernel(`g${s}`, g.spec); kernels++
      const f = compilaJs(k)
      for (const n of [0, 1, 37]) { const e = g.entradas(n); const a = executaInterpretado(k, e as any, n), b = f(e as any, n); for (const nome of Object.keys(a)) expect(Object.is(a[nome]!.length, b[nome]!.length) && Array.from(a[nome]!).every((v, i) => Object.is(v, b[nome]![i])), `${s}:${nome}`).toBe(true) }
    }
    expect(kernels).toBe(400)
  })
})
