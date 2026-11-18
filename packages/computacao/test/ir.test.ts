import { describe, expect, it } from 'vitest'
import { compilaKernel, KernelErro } from '../src'

const k = (corpo: any, extra: any = {}) => compilaKernel('k', { entradas: { a: { tipo: 'decimal', lista: true }, c: { tipo: 'decimal' }, m: { tipo: 'inteiro' }, f: { tipo: 'booleano' } }, saidas: { r: { tipo: 'decimal', lista: true } }, corpo, ...extra })
const erro = (corpo: any, extra?: any) => { try { k(corpo, extra); return '' } catch (e) { expect(e).toBeInstanceOf(KernelErro); return (e as Error).message } }

describe('tipagem do kernel', () => {
  it('aceita o caso feliz e promove inteiro para decimal na saída', () => {
    const ker = k({ saidas: { r: 'a * 2 + m' } }); expect(ker.saidas[0]!.expr.tipo).toBe('f32')
    expect(compilaKernel('k', { entradas: { m: { tipo: 'inteiro' } }, saidas: { r: { tipo: 'decimal', lista: true } }, corpo: { saidas: { r: 'm * 2' } } }).saidas[0]!.expr).toMatchObject({ k: 'fn', nome: 'f32' })
  })
  it('recusa o que não existe em kernels, com o ponto do erro', () => {
    expect(erro({ saidas: { r: 'sin(a)' } })).toMatch(/corpo\.saidas\.r: função "sin" não existe/)
    expect(erro({ saidas: { r: 'a % 2' } })).toMatch(/operador % não existe/)
    expect(erro({ saidas: { r: 'a ?? 1' } })).toMatch(/\?\? não existe/)
    expect(erro({ saidas: { r: 'x' } })).toMatch(/"x" não é uma entrada/)
    expect(erro({ saidas: { r: 'a.b' } })).toMatch(/acesso a campo/)
    expect(erro({ saidas: { r: '[1,2]' } })).toMatch(/listas/)
    expect(erro({ saidas: { r: '"oi"' } })).toMatch(/só literais numéricos/)
    expect(erro({ saidas: { r: 'a +' } })).toMatch(/corpo\.saidas\.r/)
  })
  it('tipos: booleano não é número; condição é booleana; saída respeita a declaração', () => {
    expect(erro({ saidas: { r: 'f + 1' } })).toMatch(/espera número, veio booleano/)
    expect(erro({ saidas: { r: 'a ? 1 : 2' } })).toMatch(/espera booleano/)
    expect(erro({ saidas: { r: 'f == 1' } })).toMatch(/não se compara booleano/)
    expect(erro({ saidas: { r: 'f ? f : a' } })).toMatch(/mesmo tipo/)
    expect(erro({ saidas: { r: 'a > 1' } })).toMatch(/saída foi declarada decimal/)
    expect(() => compilaKernel('k', { entradas: { a: { tipo: 'decimal', lista: true } }, saidas: { r: { tipo: 'inteiro', lista: true } }, corpo: { saidas: { r: 'a' } } })).toThrow(/use i32/)
  })
  it('nomes: reservados, repetidos e locais usados antes de declarar', () => {
    expect(() => compilaKernel('k', { entradas: { i: { tipo: 'decimal' } }, saidas: { r: { tipo: 'decimal', lista: true } }, corpo: { saidas: { r: '1' } } })).toThrow(/reservado/)
    expect(erro({ locais: [{ nome: 'a', valor: '1' }], saidas: { r: '1' } })).toMatch(/já existe/)
    expect(erro({ locais: [{ nome: 'x', valor: 'y' }, { nome: 'y', valor: '1' }], saidas: { r: '1' } })).toMatch(/"y" não é/)
    expect(erro({ saidas: { r: '1', z: '2' } })).toMatch(/não foi declarada/)
    expect(() => compilaKernel('k', { saidas: { r: { tipo: 'decimal', lista: true } }, corpo: { saidas: {} } })).toThrow(/ssem expressão|não tem expressão/)
    expect(() => compilaKernel('k', { saidas: { r: { tipo: 'decimal' } }, corpo: { saidas: { r: '1' } } })).toThrow(/toda saída é uma lista/)
  })
  it('tipos suportados e limites', () => {
    expect(() => compilaKernel('k', { entradas: { t: { tipo: 'texto' } }, saidas: { r: { tipo: 'decimal', lista: true } }, corpo: { saidas: { r: '1' } } })).toThrow(/não é suportado/)
    expect(erro({ saidas: { r: '2147483648' } })).toMatch(/fora de i32/)
    expect(erro({ saidas: { r: Array.from({ length: 2100 }, () => '1').join(' + ') } })).toMatch(/grande demais|longa demais/)
  })
  it('restrições: só escalares, e booleanas', () => {
    expect(() => k({ saidas: { r: 'a' } }, { restricoes: ['c > 0 && m < 10'] })).not.toThrow()
    expect(erro({ saidas: { r: 'a' } }, { restricoes: ['a > 0'] })).toMatch(/restricoes\[0\]: "a" é uma lista/)
    expect(erro({ saidas: { r: 'a' } }, { restricoes: ['c + 1'] })).toMatch(/booleana|booleano/)
  })
})
