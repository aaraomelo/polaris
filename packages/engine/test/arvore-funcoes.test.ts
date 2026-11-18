import { describe, expect, it } from 'vitest'
import { FUNCOES_PADRAO, avalia, parseExpr } from '../src/index'
import { camposDoSchema, percorre } from '../src/expr/arvore'

const ev = (src: string, esc: Record<string, unknown> = {}) => avalia(parseExpr(src), esc, FUNCOES_PADRAO)

describe('percorre', () => {
  const r = { bloco: 'pilha', id: 'r', slots: { filhos: [{ bloco: 'a', id: 'a' }, { bloco: 'pilha', id: 'b', slots: { filhos: [{ bloco: 'c', id: 'c' }] , lado: [{ bloco: 'd', id: 'd' }] } }], vazio: [] } }
  it('pré-ordem com caminho pronto para obter/com/sem, e nível', () => {
    const l = percorre(r, 'slots')!
    expect(l.map((x) => (x.no as { id: string }).id)).toEqual(['r', 'a', 'b', 'c', 'd']); expect(l.map((x) => x.nivel)).toEqual([0, 1, 1, 2, 2])
    expect(l[3]!.caminho).toEqual(['slots', 'filhos', 1, 'slots', 'filhos', 0])
    for (const x of l) expect(ev('igual(obter(r, c), n)', { r, c: x.caminho, n: x.no })).toBe(true) // o caminho leva ao nó
    expect(ev('tamanho(sem(r, c).slots.filhos[1].slots.filhos)', { r, c: l[3]!.caminho })).toBe(0) // e serve para editar: remover o nó pelo caminho esvazia a lista dele
  })
  it('lista de filhos direta; só segue objetos; chave ausente → só a raiz', () => {
    expect(percorre({ id: 1, f: [{ id: 2, f: [{ id: 3 }, 7, null, 'x'] }, 5] }, 'f')!.map((x) => (x.no as { id: number }).id)).toEqual([1, 2, 3])
    expect(percorre({ id: 1 }, 'slots')!.length).toBe(1); expect(percorre({ id: 1, slots: 5 }, 'slots')!.length).toBe(1); expect(percorre({ slots: { a: 5, b: [1, 2] } }, 'slots')!.length).toBe(1)
  })
  it('total: não-objeto, chave inválida/proibida → ausente; chaves proibidas nunca são seguidas', () => {
    for (const x of [null, undefined, 5, 'a', [], [{}]]) expect(percorre(x, 'slots')).toBeUndefined()
    for (const k of [5, null, undefined, '__proto__', 'constructor', 'prototype']) expect(percorre({}, k)).toBeUndefined()
    const sujo = JSON.parse('{"id":1,"slots":{"__proto__":[{"id":"x"}],"ok":[{"id":2}]}}'); expect(percorre(sujo, 'slots')!.map((x) => (x.no as { id: unknown }).id)).toEqual([1, 2])
  })
  it('limite: árvore enorme (e DAG com referências compartilhadas) é ausente, não trava', () => {
    let no: Record<string, unknown> = { id: 0 }; for (let i = 0; i < 17; i++) no = { id: i + 1, f: [no, no] } // 2^17 caminhos, poucos objetos distintos
    expect(percorre(no, 'f')).toBeUndefined()
    let fundo: Record<string, unknown> = { id: 0 }; for (let i = 0; i < 300; i++) fundo = { f: [fundo] }; expect(percorre(fundo, 'f')).toBeUndefined()
  })
  it('a entrada não é mutada', () => { const c = JSON.stringify(r); percorre(r, 'slots'); expect(JSON.stringify(r)).toBe(c) })
})

describe('camposDoSchema', () => {
  it('tipos, obrigatório, limites, enum, padrão, descrição, regex e achatamento com rótulo', () => {
    const c = camposDoSchema({ type: 'object', required: ['a'], properties: {
      a: { type: 'string', pattern: '^x', description: 'um texto', default: 'x1' }, n: { type: 'integer', minimum: 1, maximum: 9 }, d: { type: 'number' }, b: { type: 'boolean' }, e: { enum: ['u', 'v'] }, k: { const: 'fixo' },
      o: { type: 'object', properties: { x: { type: 'string' }, p: { type: 'object', properties: { y: { type: 'boolean', title: 'Sim?' } } } } },
      l: { type: 'array', items: { type: 'string' } }, u: { oneOf: [{ type: 'string' }] }, j: { type: 'object' }, r: { $ref: '#/x' }, t: { type: ['string', 'null'] } } })!
    expect(c.map((x) => [x.nome, x.tipo])).toEqual([['a', 'texto'], ['n', 'inteiro'], ['d', 'numero'], ['b', 'booleano'], ['e', 'escolha'], ['k', 'escolha'], ['x', 'texto'], ['y', 'booleano'], ['l', 'json'], ['u', 'json'], ['j', 'json'], ['r', 'json'], ['t', 'json']])
    expect(c[0]).toMatchObject({ obrigatorio: true, regex: '^x', descricao: 'um texto', padrao: 'x1', rotulo: 'A' }); expect(c[1]).toMatchObject({ min: 1, max: 9, obrigatorio: false }); expect(c[4]!.opcoes).toEqual(['u', 'v'])
    expect(c[6]).toMatchObject({ caminho: ['o', 'x'], rotulo: 'O › X' }); expect(c[7]).toMatchObject({ caminho: ['o', 'p', 'y'], rotulo: 'O › P › Sim?' })
  })
  it('rótulos: title, dicionário acentuado e camelCase em palavras', () => { expect(camposDoSchema({ type: 'object', properties: { nivel: { type: 'integer' }, corDeFundo: { type: 'string' }, x: { type: 'string', title: 'Meu' } } })!.map((c) => c.rotulo)).toEqual(['Nível', 'Cor de fundo', 'Meu']) })
  it('total: não-objeto → ausente; sem properties → lista vazia; propriedade que não é objeto é ignorada; nomes proibidos fora; aninhamento fundo vira json; opções limitadas', () => {
    for (const x of [null, 5, 'a', [], undefined]) expect(camposDoSchema(x)).toBeUndefined()
    expect(camposDoSchema({})).toEqual([]); expect(camposDoSchema({ type: 'object', properties: { a: 5, b: null, c: { type: 'string' } } })!.map((c) => c.nome)).toEqual(['c'])
    expect(camposDoSchema(JSON.parse('{"properties":{"__proto__":{"type":"string"},"ok":{"type":"string"}}}'))!.map((c) => c.nome)).toEqual(['ok'])
    let s: Record<string, unknown> = { type: 'string' }; for (let i = 0; i < 10; i++) s = { type: 'object', properties: { x: s } }
    expect(camposDoSchema(s)!.map((c) => c.tipo)).toEqual(['json']); expect(camposDoSchema({ properties: { e: { enum: Array.from({ length: 500 }, (_, i) => i) } } })![0]!.opcoes!.length).toBe(200)
  })
  it('na linguagem: gera os campos de um bloco real e a entrada não é mutada', () => {
    const s = { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] }, c = JSON.stringify(s)
    expect(ev('mapeia(camposDoSchema(s), c => c.rotulo)', { s })).toEqual(['Texto']); expect(JSON.stringify(s)).toBe(c)
  })
})

describe('paraNumero', () => {
  const pn = (x: unknown) => ev('paraNumero(x)', { x })
  it('texto decimal (ponto ou vírgula), com sinal e expoente; número finito passa', () => {
    expect([pn('12'), pn(' 2,5 '), pn('-1e3'), pn('+7'), pn('.5'), pn('5.'), pn('1E2'), pn(0), pn(-3.5), pn('0'), pn('-0')]).toEqual([12, 2.5, -1000, 7, 0.5, 5, 100, 0, -3.5, 0, -0])
  })
  it('o que não é número decimal é ausente: vazio, hex, Infinity, NaN, mistura, ponto e vírgula juntos, tipos errados, texto enorme', () => {
    for (const x of ['', ' ', 'abc', '0x10', 'Infinity', '-Infinity', 'NaN', '1 2', '1_000', '1,234.5', '1.234,5', '1e', 'e5', '--1', '1e999', '٣', '１２', NaN, Infinity, null, undefined, true, [], {}, '1'.repeat(65)]) expect(pn(x), String(x)).toBeUndefined()
  })
  it('é o inverso de texto()/numero em ida e volta (inteiros e decimais simples)', () => { for (const n of [0, 1, -7, 3.25, 1e21]) expect(pn(ev('texto(n)', { n }))).toBe(n) })
})
