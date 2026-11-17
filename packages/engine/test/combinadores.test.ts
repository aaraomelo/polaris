import { describe, expect, it } from 'vitest'
import { FUNCOES_PADRAO, analisa, avalia, deAst, formata, paraAst, parseExpr, semPos, validaAst, validaExpr, type Expr } from '../src/expr/index'
import { avaliaMedindo } from '../src/expr/avalia'
import { depsExpr } from '../src/vivo/dep'

const ev = (src: string, esc: Record<string, unknown> = {}) => avalia(parseExpr(src), esc, FUNCOES_PADRAO)
const problemas = (src: string, escopo: string[] = []) => validaExpr(parseExpr(src), escopo).map((p) => `${p.regra}: ${p.mensagem}${p.dica ? ` [${p.dica}]` : ''}`)

describe('função anônima: sintaxe, AST e texto canônico', () => {
  it('lê x => …, (a, b) => … e só como argumento de chamada', () => {
    expect(semPos(parseExpr('mapeia(l, x => x + 1)'))).toMatchObject({ t: 'call', fn: 'mapeia', args: [{ t: 'var', nome: 'l' }, { t: 'fn', params: ['x'], corpo: { t: 'bin', op: '+' } }] })
    expect(semPos(parseExpr('dobra(l, 0, (a, x) => a + x)'))).toMatchObject({ args: [{}, {}, { t: 'fn', params: ['a', 'x'] }] })
    expect(() => parseExpr('x => x')).toThrow() // função anônima solta não é uma expressão
    expect(() => parseExpr('a + (x => x)')).toThrow()
    expect(() => parseExpr('mapeia(l, x => )')).toThrow()
  })
  it('AST JSON: { fn: [params], corpo } e a volta; formata é ponto fixo', () => {
    const e = parseExpr('dobra(mapeia(l, x => x * 2), 0, (a, x, i) => a + x)')
    const ast = paraAst(e)
    expect(JSON.stringify(ast)).toContain('{"fn":["x"],"corpo"')
    expect(validaAst(JSON.parse(JSON.stringify(ast)))).toEqual([])
    const r = deAst(JSON.parse(JSON.stringify(ast)))
    expect(r.ok && semPos(r.expr)).toEqual(semPos(e))
    const t = formata(e)
    expect(t).toBe('dobra(mapeia(l, x => x * 2), 0, (a, x, i) => a + x)')
    expect(formata(parseExpr(t))).toBe(t)
  })
  it('validaAst: parâmetros inválidos, repetidos, vazios, demais', () => {
    const v = (x: unknown) => validaAst(x).map((e) => `${e.caminho}: ${e.mensagem}`)
    expect(v({ fn: ['x'], corpo: { var: 'x' } })).toEqual([])
    expect(v({ fn: [], corpo: { var: 'x' } })[0]).toContain('1 a 3')
    expect(v({ fn: ['a', 'b', 'c', 'd'], corpo: { var: 'a' } })[0]).toContain('1 a 3')
    expect(v({ fn: ['x', 'x'], corpo: { var: 'x' } })[0]).toContain('repetidos')
    expect(v({ fn: ['__proto__'], corpo: { lit: 1 } })[0]).toContain('nome de parâmetro inválido')
    expect(v({ fn: ['true'], corpo: { lit: 1 } })[0]).toContain('nome de parâmetro inválido')
    expect(v({ fn: ['x'] })).toEqual(["/corpo: a forma 'fn' precisa de 'corpo'"])
  })
})

describe('validação estática dos combinadores', () => {
  it('função anônima fora de combinador, em posição errada ou com parâmetros demais é erro', () => {
    expect(problemas('tamanho(x => x)')[0]).toContain('função anônima só pode ser argumento de um combinador')
    expect(problemas('mapeia(l, 5)', ['l'])[0]).toContain('o argumento 2 de \'mapeia\' deve ser uma função anônima')
    expect(problemas('mapeia(x => x, l)', ['l']).join('|')).toMatch(/o argumento 2.*deve ser uma função|só pode ser argumento/)
    expect(problemas('mapeia(l, (a, b, c) => a)', ['l'])[0]).toContain('aceita até 2 parâmetro(s), declarou 3')
    expect(problemas('ordena(l, (a, b) => a)', ['l'])[0]).toContain('aceita até 1 parâmetro(s)')
    expect(problemas('mapeia(l)', ['l'])[0]).toContain("'mapeia' recebe 2 argumentos")
    expect(problemas('mapeia(l, x => x, 3)', ['l'])[0]).toContain("'mapeia' recebe 2 argumentos")
    expect(() => parseExpr('mapeia(l, x => y => x)')).toThrow() // função que devolve função não existe
  })
  it('o corpo enxerga os parâmetros e o escopo de fora; variável desconhecida ganha "quis dizer" com os parâmetros', () => {
    expect(problemas('mapeia(l, x => x + k)', ['l', 'k'])).toEqual([])
    expect(problemas('mapeia(l, produto => produto.n + kk)', ['l', 'k'])[0]).toMatch(/'kk' não existe.*quis dizer 'k'/)
    expect(problemas('mapeia(l, produto => prodto.n)', ['l'])[0]).toMatch(/'prodto' não existe.*quis dizer 'produto'/)
    expect(problemas('mapeia(l, x => 1)', [])[0]).toContain("'l' não existe") // `l` não está no escopo
    expect(problemas('x')[0]).toContain("'x' não existe") // o parâmetro não vaza para fora do corpo
    expect(problemas('concat(mapeia(l, x => x), [x])', ['l'])[0]).toContain("'x' não existe")
  })
  it('analisa(): variáveis livres excluem os parâmetros; o modelo de dependências do runtime idem', () => {
    const e = parseExpr('mapeia(estado.itens, p => p.preco * taxa + estado.n)')
    expect([...analisa(e).variaveis].sort()).toEqual(['estado', 'taxa'])
    const deps = new Set<string>(); depsExpr(e, deps)
    expect([...deps].sort()).toEqual(['estado.itens', 'estado.n', 'taxa'])
    const d2 = new Set<string>(); depsExpr(parseExpr('mapeia(l, estado => estado.n)'), d2)
    expect([...d2]).toEqual(['l']) // o parâmetro `estado` sombreia o `estado` global dentro do corpo
  })
})

describe('avaliação: fechamentos, sombreamento, índices', () => {
  it('captura o escopo de fora e cada nível enxerga os parâmetros dos de fora', () => {
    expect(ev('mapeia(l, x => x + k)', { l: [1, 2], k: 10 })).toEqual([11, 12])
    expect(ev('mapeia(l, x => mapeia(m, y => x * 10 + y))', { l: [1, 2], m: [3, 4] })).toEqual([[13, 14], [23, 24]])
    expect(ev('mapeia(l, x => mapeia(m, x => x))', { l: [1, 2], m: [7] })).toEqual([[7], [7]]) // o interno sombreia
    expect(ev('mapeia(l, (x, i) => i * 10 + x)', { l: [5, 6, 7] })).toEqual([5, 16, 27])
    expect(ev('mapeia(l, (x, i) => i)', { l: ['a'], i: 99 })).toEqual([0]) // o parâmetro vence a variável de fora
    expect(ev('mapeia(l, x => i)', { l: [1], i: 99 })).toEqual([99])
  })
  it('combinadores sobre não-listas são ausentes; função anônima fora de lugar não tem valor', () => {
    for (const c of ['mapeia', 'filtra', 'todos', 'algum', 'acha', 'ordena', 'agrupa']) expect(ev(`${c}(5, x => x)`), c).toBeUndefined()
    expect(ev('dobra(5, 0, (a, x) => a)')).toBeUndefined()
    expect(avalia({ t: 'fn', params: ['x'], corpo: { t: 'lit', v: 1, pos: 0 }, pos: 0 } as Expr, {}, FUNCOES_PADRAO)).toBeUndefined()
  })
  it('composição: pipeline típico de loja (filtra → ordena → mapeia → junta; soma com dobra)', () => {
    const itens = [{ n: 'c', p: 30, ok: true }, { n: 'a', p: 10, ok: true }, { n: 'b', p: 20, ok: false }, { n: 'd', p: 5, ok: true }]
    expect(ev('junta(mapeia(ordena(filtra(itens, i => i.ok), i => i.p), i => maiusculas(i.n)), "|")', { itens })).toBe('D|A|C')
    expect(ev('dobra(filtra(itens, i => i.ok), 0, (s, i) => s + i.p)', { itens })).toBe(45)
    expect(ev('tamanho(agrupa(itens, i => i.ok))', { itens })).toBe(2)
  })
  it('ordena é estável e total (chaves de tipos misturados nunca quebram a ordem)', () => {
    const l = [{ k: 1, n: 'a' }, { k: 1, n: 'b' }, { k: 0, n: 'c' }, { k: 1, n: 'd' }]
    expect(ev('mapeia(ordena(l, x => x.k), x => x.n)', { l })).toEqual(['c', 'a', 'b', 'd'])
    expect(ev('ordena(l, x => x)', { l: ['b', 2, null, true, 'a', 1, false] })).toEqual([1, 2, 'a', 'b', false, true, null])
  })
  it('agrupa com chave "__proto__" cria propriedade própria e NÃO polui o protótipo', () => {
    const r = ev('agrupa(["__proto__", "x"], s => s)') as Record<string, unknown>
    expect(Object.keys(r).sort()).toEqual(['__proto__', 'x'])
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(ev('agrupa(["__proto__"], s => s).__proto__')).toBeUndefined() // e leitura continua bloqueada
  })
})

describe('orçamento de passos e limite de lista: sempre termina, sem estourar memória', () => {
  it('laços aninhados enormes esgotam o orçamento e dão ausente, rápido', () => {
    const e = parseExpr('mapeia(intervalo(1000), a => mapeia(intervalo(1000), b => mapeia(intervalo(1000), c => a + b + c)))')
    const t0 = performance.now()
    const r = avaliaMedindo(e, {}, FUNCOES_PADRAO)
    expect(r.esgotou).toBe(true)
    expect(r.valor).toBeUndefined()
    expect(performance.now() - t0).toBeLessThan(2000)
  })
  it('o mesmo programa com orçamento folgado e pequeno termina com o valor e conta os passos', () => {
    const e = parseExpr('soma(mapeia(intervalo(10), x => x * x))')
    const r = avaliaMedindo(e, {}, FUNCOES_PADRAO)
    expect(r).toMatchObject({ valor: 285, esgotou: false })
    expect(r.passos).toBeGreaterThan(30); expect(r.passos).toBeLessThan(100)
    expect(avaliaMedindo(e, {}, FUNCOES_PADRAO, 20)).toMatchObject({ esgotou: true })
  })
  it('crescimento exponencial por concat é cortado pelo limite de lista (100 000 itens), não por falta de memória', () => {
    // 40 dobras de `acc ++ acc` seriam 3·2^40 itens; a expressão é minúscula
    const e = parseExpr('tamanho(dobra(intervalo(40), l, (acc, x) => concat(acc, acc)))')
    const t0 = performance.now()
    expect(avalia(e, { l: [1, 2, 3] }, FUNCOES_PADRAO)).toBe(0) // o concat que passa do limite é ausente; ausente tem tamanho 0
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(ev('tamanho(dobra(intervalo(10), l, (acc, x) => concat(acc, acc)))', { l: [1, 2, 3] })).toBe(3 * 1024)
    expect(ev('concat(l, l)', { l: [1, 2] })).toEqual([1, 2, 1, 2])
    expect(ev('intervalo(100001)')).toBeUndefined(); expect(ev('tamanho(intervalo(100000))')).toBe(100000)
  })
  it('um combinador sobre dado real grande (1000 itens × 3 etapas) cabe folgado no orçamento', () => {
    const itens = Array.from({ length: 1000 }, (_, i) => ({ id: i, p: i % 7, n: `i${i}` }))
    const r = avaliaMedindo(parseExpr('tamanho(mapeia(ordena(filtra(itens, i => i.p > 2), i => i.p), i => i.n))'), { itens }, FUNCOES_PADRAO)
    expect(r.esgotou).toBe(false); expect(r.valor).toBe(itens.filter((i) => i.p > 2).length)
  })
})
