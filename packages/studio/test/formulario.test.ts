import { Registry } from '@polaris/schema'
import { registraBase } from '@polaris/engine'
import { describe, expect, it } from 'vitest'
import { camposDe, converte, defineValor, ehBinding, leValor, validaProps } from '../src'

const reg = new Registry(); registraBase(reg)
const blocos = reg.ids('bloco')
const props = (id: string) => (reg.resolve('bloco', id)!.no.spec as { props?: Record<string, any> }).props

describe('formulário gerado do schema', () => {
  it('todo bloco base gera campos coerentes com o schema (tipo, obrigatório, enum, limites)', () => {
    let n = 0
    for (const id of blocos) { const p = props(id); if (!p) continue; for (const c of camposDe(p)) { n++; expect(c.rotulo.length).toBeGreaterThan(0); expect(c.caminho[c.caminho.length - 1]).toBe(c.nome) } }
    expect(n).toBeGreaterThan(20)
    const titulo = camposDe(props('texto/titulo')!); expect(titulo.find((c) => c.nome === 'texto')).toMatchObject({ tipo: 'texto', obrigatorio: true })
    expect(titulo.find((c) => c.nome === 'nivel')).toMatchObject({ tipo: 'inteiro', min: 1, max: 6, padrao: 1, obrigatorio: false })
    expect(camposDe(props('feedback/selo')!).find((c) => c.nome === 'tom')).toMatchObject({ tipo: 'escolha', opcoes: ['neutro', 'sucesso', 'alerta', 'erro'] })
    expect(camposDe(props('nav/botao')!).find((c) => c.nome === 'desabilitado')).toMatchObject({ tipo: 'booleano' })
  })
  it('o que o schema não descreve de forma simples vira campo json, nunca some; objetos e listas aninham', () => {
    const cs = camposDe({ type: 'object', required: ['a'], properties: { a: { oneOf: [{ type: 'string' }, { type: 'number' }] }, b: { type: ['string', 'null'] }, c: { type: 'object', properties: { x: { type: 'number', minimum: 0 }, y: { type: 'string' } } }, d: { type: 'array', items: { type: 'string' } }, e: { type: 'object' }, f: { $ref: '#/x' }, g: { type: 'array', items: { oneOf: [{ type: 'string' }] } }, h: { const: 'fixo' } } })
    expect(cs.map((c) => [c.nome, c.tipo])).toEqual([['a', 'json'], ['b', 'json'], ['c', 'objeto'], ['d', 'lista'], ['e', 'json'], ['f', 'json'], ['g', 'json'], ['h', 'escolha']])
    expect(cs[2]!.filhos!.map((c) => c.caminho)).toEqual([['c', 'x'], ['c', 'y']]); expect(cs[3]!.item).toMatchObject({ tipo: 'texto', caminho: ['d', '*'] }); expect(cs[0]!.obrigatorio).toBe(true)
    expect(camposDe({}).length).toBe(0)
  })
  it('aninhamento profundo demais vira json (sem laço)', () => {
    let s: any = { type: 'string' }; for (let i = 0; i < 10; i++) s = { type: 'object', properties: { x: s } }
    let c = camposDe(s)[0]!, d = 0; while (c.filhos) { c = c.filhos[0]!; d++ } expect(d).toBeLessThan(7); expect(c.tipo).toBe('json')
  })
  it('converte: números, inteiros, limites, escolha, json, vazio (remove) e binding (passa direto)', () => {
    const [txt, n, i, esc, js] = [{ tipo: 'texto' }, { tipo: 'numero', min: 0, max: 10 }, { tipo: 'inteiro', min: 1, max: 6 }, { tipo: 'escolha', opcoes: ['a', 2] }, { tipo: 'json' }].map((c) => ({ nome: 'x', caminho: ['x'], rotulo: 'X', obrigatorio: false, ...c })) as any[]
    expect(converte(txt, ' oi ')).toEqual({ ok: true, valor: ' oi ' }); expect(converte(txt, '')).toEqual({ ok: true, valor: undefined }); expect(converte(txt, '   ')).toEqual({ ok: true, valor: undefined })
    expect(converte(n, '2,5')).toEqual({ ok: true, valor: 2.5 }); expect(converte(n, 'abc')).toMatchObject({ ok: false }); expect(converte(n, '11')).toMatchObject({ ok: false, erro: 'o máximo é 10' }); expect(converte(n, '-1')).toMatchObject({ ok: false })
    expect(converte(n, '1e2')).toMatchObject({ ok: false }); expect(converte(n, '0x10')).toMatchObject({ ok: false }); expect(converte(n, 'Infinity')).toMatchObject({ ok: false })
    expect(converte(i, '3.5')).toMatchObject({ ok: false, erro: 'digite um número inteiro' }); expect(converte(i, '0')).toMatchObject({ ok: false }); expect(converte(i, '6')).toEqual({ ok: true, valor: 6 })
    expect(converte(i, '{estado.n}')).toEqual({ ok: true, valor: '{estado.n}' }); expect(converte(esc, '2')).toEqual({ ok: true, valor: 2 }); expect(converte(esc, 'z')).toMatchObject({ ok: false })
    expect(converte(js, '{"a":[1]}')).toEqual({ ok: true, valor: { a: [1] } }); expect(converte(js, '{a')).toMatchObject({ ok: false }); expect(converte(txt, true)).toMatchObject({ ok: false })
    expect(converte({ ...txt, tipo: 'booleano' }, true)).toEqual({ ok: true, valor: true }); expect(converte({ ...txt, tipo: 'objeto' }, 'x')).toMatchObject({ ok: false })
  })
  it('ehBinding: binding real sim; chave escapada e literais não', () => {
    expect(ehBinding('{estado.a}')).toBe(true); expect(ehBinding('Olá, {nome}!')).toBe(true); expect(ehBinding({ $expr: { var: 'x' } })).toBe(true)
    expect(ehBinding('\\{não\\}')).toBe(false); expect(ehBinding('texto')).toBe(false); expect(ehBinding({ $expr: 1, b: 2 })).toBe(false); expect(ehBinding(5)).toBe(false); expect(ehBinding(['{a}'])).toBe(false)
  })
  it('defineValor: imutável, poda vazios, cria caminhos e recusa chaves perigosas', () => {
    const base = { a: 1, o: { x: 1, y: 2 } }, c = JSON.stringify(base)
    expect(defineValor(base, ['o', 'x'], 9)).toEqual({ a: 1, o: { x: 9, y: 2 } }); expect(JSON.stringify(base)).toBe(c)
    expect(defineValor(base, ['o', 'x'], undefined)).toEqual({ a: 1, o: { y: 2 } }); expect(defineValor({ o: { x: 1 } }, ['o', 'x'], undefined)).toEqual({})
    expect(defineValor(undefined, ['p', 'q', 'r'], 1)).toEqual({ p: { q: { r: 1 } } }); expect(defineValor({ a: 5 }, ['a', 'b'], 1)).toEqual({ a: { b: 1 } })
    for (const k of ['__proto__', 'constructor', 'prototype']) expect(() => defineValor({}, [k, 'x'], 1)).toThrow(); expect(() => defineValor({}, [], 1)).toThrow()
    expect(({} as any).x).toBeUndefined(); expect(leValor(base, ['o', 'y'])).toBe(2); expect(leValor(base, ['o', 'z'])).toBeUndefined(); expect(leValor(base, ['constructor'])).toBeUndefined(); expect(leValor('s', ['a'])).toBeUndefined()
  })
  it('validaProps: erros por campo em português; binding não é validado contra o tipo nem conta como faltando', () => {
    const p = props('texto/titulo')!
    expect(validaProps(p, { texto: 'Olá', nivel: 2 })).toEqual([])
    expect(validaProps(p, { nivel: 2 })[0]!.mensagem).toMatch(/obrigatório/)
    const e = validaProps(p, { texto: 'x', nivel: 9 }); expect(e[0]!.caminho).toEqual(['nivel']); expect(e[0]!.mensagem).toMatch(/maior|máximo|6/)
    expect(validaProps(p, { texto: '{dados.t}', nivel: '{estado.n}' })).toEqual([]); expect(validaProps(p, { texto: { $expr: { var: 'x' } } })).toEqual([])
    expect(validaProps(p, { nivel: '{estado.n}' })[0]!.mensagem).toMatch(/obrigatório/) // texto continua faltando
    expect(validaProps(p, undefined).length).toBe(1)
  })
})
