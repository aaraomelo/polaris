import { describe, expect, it } from 'vitest'
import { FUNCOES_PADRAO, ExprErro, avalia, parseExpr } from '../src/index'
import { compilaExpr } from '../src/estatico/expr'

// O compilador de closures de expressão precisa ser EQUIVALENTE ao avaliador (uma só semântica), inclusive com dados hostis.
const hostil = JSON.parse('{"__proto__":{"x":1},"constructor":{"y":2},"prototype":3,"a":{"__proto__":{"z":1},"constructor":"c","b":[1,2,{"c":"fundo"}],"s":"texto","n":42,"nulo":null,"vazio":"","zero":0,"lista":[],"u":"é"},"n":3.5,"t":"abc","l":[10,20,30],"o":{"k":"v"},"nulo":null,"bool":true}')
const iguais = (src: string, esc: Record<string, unknown> = hostil) => {
  const ast = parseExpr(src)
  expect(compilaExpr(ast, FUNCOES_PADRAO)(esc), src).toEqual(avalia(ast, esc, FUNCOES_PADRAO))
}

describe('compilaExpr ≡ avalia', () => {
  it.each([
    '1', '"x"', 'true', 'null', 'a.n', 'a.s', 'a.b[1]', 'a.b[2].c', 'a.nada', 'a.nada.x.y', 'nada', 'l[0]', 'l[1+1]', 'l[-1]', 'l[1.5]', 'o["k"]', 'o[t]', 'a.s.length', 'l.length', 't[0]',
    '__proto__', 'constructor', 'prototype', 'a.__proto__', 'a.constructor', '__proto__.x', 'o.toString', 'l.map', 'a.s.constructor',
    'n * 2', 'n + t', 't + n', 'a.n > 40', 'a.n == 42', 'nulo ?? "padrao"', 'a.vazio || "vazio"', 'bool && a.s', '!a.lista', 'bool ? a.s : n', '[1, a.n, t]',
    'tamanho(l)', 'maiusculas(t)', 'a.n | brl', 'n | arredonda(0)', 'l | junta("-")', 't | maiusculas | contem("B")', 'brl(a.n)', 'naoexiste(1)', 'tamanho()', 'tamanho(1, 2)', 'minimo(1, 2, 3)', 'padrao(nulo, "x")', 'data("2026-06-08")', 'numero(n, 2)', 'pct(0.256, 1)',
  ])('%s', (src) => iguais(src))

  it('funções que lançam viram undefined, como no avaliador', () => {
    const f = { boom: { min: 1, max: 2, fn: () => { throw new Error('x') } }, soma: { min: 2, max: 2, fn: (a: unknown, b: unknown) => (a as number) + (b as number) } }
    for (const src of ['boom(1)', 'boom(1, 2)', 'soma(1, 2)', 'soma(1)']) {
      const ast = parseExpr(src)
      expect(compilaExpr(ast, f)({}), src).toEqual(avalia(ast, {}, f))
    }
  })

  it('FUZZ: expressões e escopos aleatórios dão o mesmo valor nos dois avaliadores', () => {
    let s = 21
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!
    const atomos = ['a', 'a.b', 'a.n', 'a.s', 'l', 'l[0]', 'l[1]', 'o.k', 'n', 't', 'nulo', 'nada', '1', '2.5', '"x"', 'true', 'null', '__proto__', 'a.__proto__', '[1,2]']
    const ops = ['+', '-', '*', '/', '%', '==', '!=', '<', '>=', '&&', '||', '??']
    const gera = (p: number): string => {
      if (p === 0 || rnd() < 0.25) return pick(atomos)
      const k = rnd()
      if (k < 0.5) return `${gera(p - 1)} ${pick(ops)} ${gera(p - 1)}`
      if (k < 0.65) return `(${gera(p - 1)} ? ${gera(p - 1)} : ${gera(p - 1)})`
      if (k < 0.8) return `${pick(['tamanho', 'maiusculas', 'texto', 'absoluto', 'arredonda', 'brl'])}(${gera(p - 1)})`
      if (k < 0.9) return `${gera(p - 1)} | ${pick(['brl', 'texto', 'tamanho', 'maiusculas'])}`
      return `!${gera(p - 1)}`
    }
    let comparadas = 0
    for (let i = 0; i < 3000; i++) {
      const src = gera(3)
      let ast
      try { ast = parseExpr(src) } catch (e) { if (e instanceof ExprErro) continue; throw e }
      comparadas++
      const esc = rnd() < 0.5 ? hostil : { a: { b: [1], n: 7, s: 'ç<' }, l: [1, 'x', null], o: { k: 'v' }, n: -2, t: '', nulo: null }
      expect(compilaExpr(ast, FUNCOES_PADRAO)(esc), src).toEqual(avalia(ast, esc, FUNCOES_PADRAO))
    }
    expect(comparadas).toBeGreaterThan(2500)
  })
})
