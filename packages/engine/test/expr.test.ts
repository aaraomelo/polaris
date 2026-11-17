import { describe, expect, it } from 'vitest'
import { ExprErro, FUNCOES_PADRAO, analisa, avalia, parseExpr, validaExpr, verdadeiro, LIMITES_EXPR } from '../src/index'

const ev = (src: string, escopo: Record<string, unknown> = {}) => avalia(parseExpr(src), escopo, FUNCOES_PADRAO)
const erro = (src: string): ExprErro => {
  try { parseExpr(src) } catch (e) { return e as ExprErro }
  throw new Error(`esperava erro em: ${src}`)
}
const esc = { produto: { nome: 'Pão', preco: 12.5, tags: ['a', 'b'], estoque: 0, imagem: null }, itens: [10, 20, 30], loja: { ativa: true }, n: 3, vazio: '' }

describe('literais e aritmética', () => {
  it.each([
    ['1 + 2 * 3', 7], ['(1 + 2) * 3', 9], ['10 / 4', 2.5], ['10 % 3', 1], ['-n + 5', 2], ['2 - -3', 5], ['1.5 * 2', 3],
    ["'a' + 'b'", 'ab'], ['"x" + n', 'x3'], ['n + "x"', '3x'], ["'Olá ' + produto.nome", 'Olá Pão'], ['true', true], ['null', null],
  ])('%s = %j', (src, esperado) => expect(ev(src, esc)).toEqual(esperado))

  it('operações inválidas dão undefined, nunca NaN nem exceção', () => {
    for (const s of ['1 / 0', '5 % 0', '"a" - 1', 'null * 2', 'produto * 2', 'nada + 1', '-"x"', '0 / 0']) expect(ev(s, esc), s).toBeUndefined()
  })

  it('ausente em concatenação vira vazio', () => {
    expect(ev("'Olá ' + nada", esc)).toBe('Olá ')
  })
})

describe('comparação, lógica e condicional', () => {
  it.each([
    ['n > 2', true], ['n >= 3', true], ['n < 3', false], ["'a' < 'b'", true], ['n == 3', true], ["n == '3'", false], ['n != 4', true],
    ['null == nada', true], ['nada == null', true], ['0 == null', false], ['produto == produto', false], // objetos não são comparáveis por valor
    ["'a' < 1", false], ['nada > 1', false],
  ])('%s = %j', (src, esperado) => expect(ev(src, esc)).toBe(esperado))

  it('&& e || devolvem o operando (permitem valor padrão)', () => {
    expect(ev("produto.nome || 'x'", esc)).toBe('Pão')
    expect(ev("vazio || 'padrão'", esc)).toBe('padrão')
    expect(ev("loja.ativa && produto.nome", esc)).toBe('Pão')
    expect(ev("produto.estoque && 'tem'", esc)).toBe(0)
  })

  it('?? só troca null/undefined (0 e "" ficam)', () => {
    expect(ev("produto.estoque ?? 9", esc)).toBe(0)
    expect(ev("vazio ?? 'x'", esc)).toBe('')
    expect(ev("produto.imagem ?? 'sem'", esc)).toBe('sem')
    expect(ev("nada ?? nada2 ?? 'fim'", esc)).toBe('fim')
  })

  it('curto-circuito: o lado direito não é avaliado', () => {
    let chamadas = 0
    const f = { ...FUNCOES_PADRAO, efeito: { min: 0, max: 0, fn: () => ++chamadas } }
    avalia(parseExpr('false && efeito()'), {}, f)
    avalia(parseExpr('true || efeito()'), {}, f)
    avalia(parseExpr('1 ?? efeito()'), {}, f)
    avalia(parseExpr('true ? 1 : efeito()'), {}, f)
    expect(chamadas).toBe(0)
  })

  it('condicional aninhada associa à direita; ! usa a verdade', () => {
    expect(ev("n > 5 ? 'g' : n > 2 ? 'm' : 'p'", esc)).toBe('m')
    expect(ev('!itens', esc)).toBe(false)
    expect(ev('!nada', esc)).toBe(true)
    expect(ev('!!produto.estoque', esc)).toBe(false)
  })

  it('verdadeiro(): vazio, zero, null e [] são falsos', () => {
    for (const v of [0, '', null, undefined, false, [], NaN]) expect(verdadeiro(v)).toBe(false)
    for (const v of [1, 'a', [0], {}, true, -1]) expect(verdadeiro(v)).toBe(true)
  })
})

describe('acesso a dados (seguro e tolerante)', () => {
  it('campo, índice, length, lista literal', () => {
    expect(ev('produto.preco', esc)).toBe(12.5)
    expect(ev('itens[1]', esc)).toBe(20)
    expect(ev("produto['nome']", esc)).toBe('Pão')
    expect(ev('itens.length', esc)).toBe(3)
    expect(ev('produto.nome.length', esc)).toBe(3)
    expect(ev('[1, n, "x"]', esc)).toEqual([1, 3, 'x'])
    expect(ev('itens[n - 2]', esc)).toBe(20)
  })

  it('ausência propaga sem erro, em qualquer profundidade', () => {
    for (const s of ['nada', 'nada.x.y', 'produto.imagem.url', 'itens[99]', 'itens[-1]', 'itens[1.5]', "itens['a']", 'produto.tags[5].x', 'n.x', 'n[0]']) expect(ev(s, esc), s).toBeUndefined()
  })

  it('só lê campos próprios: nada de protótipo', () => {
    for (const s of ['produto.__proto__', 'produto.constructor', 'produto.prototype', "produto['__proto__']", "produto['constructor']", 'produto.toString', 'produto.hasOwnProperty', 'itens.map', 'itens.constructor', 'n.constructor', 'nome.constructor']) {
      expect(ev(s, { ...esc, nome: 'x' }), s).toBeUndefined()
    }
    expect(ev('toString', {})).toBeUndefined()
    expect(ev('constructor', {})).toBeUndefined()
    expect(ev('__proto__', {})).toBeUndefined()
  })

  it('chaves perigosas vindas de JSON não confiável (JSON.parse cria __proto__ como chave própria)', () => {
    const dado = JSON.parse('{"a":{"__proto__":{"x":1},"constructor":{"y":2},"prototype":3,"ok":4},"__proto__":{"z":5},"constructor":6}')
    expect(Object.prototype.hasOwnProperty.call(dado.a, '__proto__')).toBe(true) // a premissa do teste
    for (const s of ['a.__proto__', 'a.constructor', 'a.prototype', "a['__proto__']", '__proto__', 'constructor', '__proto__.z']) expect(ev(s, dado), s).toBeUndefined()
    expect(ev('a.ok', dado)).toBe(4)
  })

  it('não é possível chegar a Function/eval por nenhum caminho', () => {
    for (const s of ['constructor.constructor("return 1")()', 'produto.constructor.constructor', 'this', 'globalThis', 'process', 'eval("1")', 'Function("x")']) {
      const r = (() => { try { return ev(s, esc) } catch (e) { return e instanceof ExprErro ? 'erro-de-parse' : 'VAZOU' } })()
      expect(r, s).not.toBe('VAZOU')
      expect(typeof r === 'function', s).toBe(false)
    }
    expect(ev('eval("1")', esc)).toBeUndefined() // função desconhecida em runtime: undefined
  })
})

describe('funções e formatadores', () => {
  it.each([
    ['tamanho(itens)', 3], ["tamanho('abc')", 3], ['tamanho(produto)', 5], ['tamanho(nada)', 0],
    ["maiusculas('ab')", 'AB'], ["minusculas('AB')", 'ab'], ["aparar('  x ')", 'x'],
    ["contem('abc', 'b')", true], ['contem(itens, 20)', true], ['contem(itens, 21)', false], ["contem(nada, 'x')", false],
    ["comeca('abc', 'a')", true], ["termina('abc', 'c')", true], ['junta(produto.tags)', 'a, b'], ["junta(produto.tags, '-')", 'a-b'],
    ['arredonda(2.456, 2)', 2.46], ['arredonda(2.5)', 3], ['piso(2.9)', 2], ['teto(2.1)', 3], ['absoluto(-3)', 3],
    ['minimo(3, 1, 2)', 1], ['maximo(3, 1, 2)', 3], ['minimo(1, "x")', undefined],
    ["padrao(nada, 'z')", 'z'], ["padrao('', 'z')", 'z'], ["padrao(0, 'z')", 0],
    ['texto(12)', '12'], ['texto(nada)', ''],
  ])('%s = %j', (src, esperado) => expect(ev(src, esc)).toEqual(esperado))

  it('formatadores pt-BR', () => {
    expect(ev('brl(1234.5)', {})).toBe('R$ 1.234,50')
    expect(ev('brl("12.5")', {})).toBe('R$ 12,50')
    expect(ev('brl(nada)', {})).toBe('')
    expect(ev('numero(1234567.891, 2)', {})).toBe('1.234.567,89')
    expect(ev('pct(0.256, 1)', {})).toBe('25,6%')
    expect(ev("data('2026-06-08')", {})).toBe('08/06/2026')
    expect(ev("data('2026-06-08T02:00:00Z')", {})).toBe('07/06/2026') // fuso fixo America/Sao_Paulo
    expect(ev("dataHora('2026-06-08T15:30:00Z')", {})).toMatch(/08\/06\/2026,? 12:30/)
    expect(ev("data('lixo')", {})).toBe('')
  })

  it('formatadores com Intl reaproveitado dão EXATAMENTE a saída do toLocaleString (a otimização não muda o resultado)', () => {
    let seed = 5
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const valores = [0, -0, 1, -1, 0.005, 1234.5, 1e9, -9876543.219, 1e21, 123456789.987654321, ...Array.from({ length: 300 }, () => (rnd() - 0.5) * 10 ** Math.floor(rnd() * 12))]
    for (const v of valores) {
      expect(ev('brl(v)', { v }), `brl ${v}`).toBe(v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      for (const c of [0, 1, 2, 5]) {
        expect(ev(`numero(v, ${c})`, { v }), `numero ${v}/${c}`).toBe(v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c }))
        expect(ev(`pct(v, ${c})`, { v }), `pct ${v}/${c}`).toBe((v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c }) + '%')
      }
    }
    for (const d of ['2026-06-08', '2020-02-29', '1999-12-31']) expect(ev('data(d)', { d })).toBe(new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' }))
    for (const d of ['2026-06-08T02:00:00Z', '2026-12-31T23:59:59Z', '2026-01-01T00:00:00Z']) {
      expect(ev('data(d)', { d })).toBe(new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
      expect(ev('dataHora(d)', { d })).toBe(new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }))
    }
  })

  it('pipe é açúcar para chamada com o valor como 1º argumento', () => {
    expect(ev('produto.preco | brl', esc)).toBe('R$ 12,50')
    expect(ev('produto.preco | arredonda(0) | texto', esc)).toBe('13')
    expect(ev("produto.nome | maiusculas | contem('Ã')", esc)).toBe(true)
    expect(ev('n > 2 ? produto.preco : 0 | brl', esc)).toBe('R$ 12,50') // pipe tem a menor precedência: formata o resultado inteiro
  })

  it('função chamada com aridade errada ou desconhecida devolve undefined', () => {
    expect(ev('tamanho()', esc)).toBeUndefined()
    expect(ev('tamanho(1, 2)', esc)).toBeUndefined()
    expect(ev('naoexiste(1)', esc)).toBeUndefined()
  })

  it('uma função que lança não derruba a avaliação', () => {
    const f = { boom: { min: 0, max: 0, fn: () => { throw new Error('x') } } }
    expect(avalia(parseExpr('boom()'), {}, f)).toBeUndefined()
  })
})

describe('erros de sintaxe: posição e dica', () => {
  it.each([
    ['1 +', /esperado um valor, encontrado o fim/, 3],
    ['a b', /sobrou 'b'/, 2],
    ['(1 + 2', /esperado '\)'/, 6],
    ['1 + 2)', /sobrou '\)'/, 5],
    ['foo(1,', /esperado um valor/, 6],
    ["'abc", /sem fechar aspas/, 0],
    ['a.', /depois de '\.' vem o nome de um campo/, 2],
    ['a | ', /nome de um formatador/, 4],
    ['a.b(1)', /só é possível chamar funções pelo nome/, 3],
    ['@', /caractere inesperado '@'/, 0],
    ['a ? b', /esperado ':'/, 5],
    ['[1, 2', /esperado '\]'/, 5],
    ["'a\\q'", /escape inválido/, 2],
    ['', /vazia/, 0],
    ['   ', /vazia/, 0],
  ])('%j', (src, re, pos) => {
    const e = erro(src)
    expect(e).toBeInstanceOf(ExprErro)
    expect(e.message).toMatch(re)
    expect(e.pos).toBe(pos)
  })

  it('o erro de parêntese sobrando explica', () => {
    expect(erro('1)').dica).toContain("sem '('")
  })
})

describe('limites contra expressões patológicas', () => {
  it('comprimento', () => {
    expect(erro('1+'.repeat(LIMITES_EXPR.comprimento) + '1').message).toMatch(/longa demais/)
  })
  it('profundidade de aninhamento', () => {
    expect(erro('('.repeat(60) + '1' + ')'.repeat(60)).message).toMatch(/aninhada demais/)
    expect(erro('!'.repeat(60) + 'a').message).toMatch(/aninhada demais/)
    expect(erro('a ? '.repeat(40) + '1' + ' : 2'.repeat(40)).message).toMatch(/aninhada demais/)
  })
  it('número de nós', () => {
    expect(erro(Array.from({ length: 300 }, (_, i) => `a${i}`).join(' + ')).message).toMatch(/grande demais/)
  })
  it('dentro dos limites passa (o limite é de 32 níveis, contado uma vez por nível)', () => {
    expect(() => parseExpr('('.repeat(30) + '1' + ')'.repeat(30))).not.toThrow()
    expect(() => parseExpr('!'.repeat(30) + 'a')).not.toThrow()
    expect(erro('('.repeat(33) + '1' + ')'.repeat(33)).message).toMatch(/aninhada demais/)
  })
})

describe('análise estática', () => {
  it('variáveis livres e chamadas', () => {
    const a = analisa(parseExpr('a.b > c ? tamanho(d) : e[f] | brl'))
    expect([...a.variaveis].sort()).toEqual(['a', 'c', 'd', 'e', 'f'])
    expect(a.chamadas.map((c) => c.fn)).toEqual(['brl', 'tamanho'])
  })
  it('variável fora do escopo: sugere e lista', () => {
    const p = validaExpr(parseExpr('produtu.nome'), ['produto', 'params'])
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ regra: 'variavel', pos: 0, dica: "quis dizer 'produto'?" })
    expect(validaExpr(parseExpr('xyz'), ['produto'])[0]!.dica).toContain('variáveis disponíveis: produto')
    expect(validaExpr(parseExpr('xyz'), [])[0]!.dica).toContain('não há variáveis')
  })
  it('função desconhecida e aridade', () => {
    expect(validaExpr(parseExpr('tamnho(x)'), ['x'])[0]).toMatchObject({ regra: 'funcao', dica: "quis dizer 'tamanho'?" })
    expect(validaExpr(parseExpr('tamanho(x, 1)'), ['x'])[0]).toMatchObject({ regra: 'aridade' })
    expect(validaExpr(parseExpr('x | arredonda(1, 2)'), ['x'])[0]!.mensagem).toContain('1 a 2')
  })
  it('expressão correta não tem problemas', () => {
    expect(validaExpr(parseExpr("produto.preco | brl"), ['produto'])).toEqual([])
  })
})

describe('robustez (fuzz determinístico)', () => {
  // gerador pseudoaleatório com semente fixa: o teste é reproduzível
  let s = 12345
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!
  const pedacos = ['a', 'b.c', 'n', '1', '2.5', "'x'", '"y"', '+', '-', '*', '/', '%', '==', '!=', '<', '>=', '&&', '||', '??', '?', ':', '!', '|', '.', ',', '(', ')', '[', ']', 'brl', 'tamanho(', 'null', 'true', ' ', '@', '\\', "'", '{', '}']
  const escopo = { a: { x: 1 }, b: { c: [1, 2] }, n: 4 }

  it('parse só lança ExprErro; avalia nunca lança', () => {
    let parseados = 0
    for (let i = 0; i < 4000; i++) {
      const src = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pick(pedacos)).join(pick(['', ' ']))
      let ast
      try {
        ast = parseExpr(src)
      } catch (e) {
        expect(e, src).toBeInstanceOf(ExprErro)
        continue
      }
      parseados++
      expect(() => avalia(ast, escopo, FUNCOES_PADRAO), src).not.toThrow()
    }
    expect(parseados).toBeGreaterThan(100) // o fuzz realmente exercitou o avaliador
  })
})
