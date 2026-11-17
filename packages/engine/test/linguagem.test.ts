import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { geraDocFuncoes } from '../src/expr/docs'
import { ORDEM_SUPERIOR } from '../src/expr/ordem-superior'
import { FUNCOES_PADRAO, OPERADORES, avalia, deAst, formata, paraAst, parseExpr, semPos, validaAst, verdadeiro, type Ast, type Expr } from '../src/expr/index'
import { REGISTRO, type Gerador } from '../src/expr/registro'

let seed = 31
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const ri = (n: number) => Math.floor(rnd() * n)
const pick = <T,>(xs: readonly T[]): T => xs[ri(xs.length)]!

describe('registro: a documentação é a fonte e não mente', () => {
  it('toda função padrão está documentada, e todo documentado como função existe', () => {
    const doc = REGISTRO.filter((d) => d.tipo === 'funcao').map((d) => d.nome).sort()
    expect(doc).toEqual(Object.keys(FUNCOES_PADRAO).sort())
    for (const k of Object.keys(ORDEM_SUPERIOR)) expect(FUNCOES_PADRAO[k]!.os, k).toBe(ORDEM_SUPERIOR[k])
  })
  it('todo operador do AST está documentado (e vice-versa); as formas também', () => {
    expect(REGISTRO.filter((d) => d.tipo === 'operador').map((d) => d.nome).sort()).toEqual([...OPERADORES].sort())
    expect(REGISTRO.filter((d) => d.tipo === 'forma').map((d) => d.nome).sort()).toEqual(['campo', 'fn', 'indice', 'lista', 'lit', 'se', 'var'])
  })
  it('nomes únicos, descrição e ao menos um exemplo em todas as entradas', () => {
    expect(new Set(REGISTRO.map((d) => d.nome)).size).toBe(REGISTRO.length)
    for (const d of REGISTRO) { expect(d.descricao.length, d.nome).toBeGreaterThan(10); expect(d.exemplos.length, d.nome).toBeGreaterThan(0) }
  })
  it('TODOS os exemplos executam e dão o resultado documentado', () => {
    for (const d of REGISTRO) for (const ex of d.exemplos) {
      const r = avalia(parseExpr(ex.expr), ex.esc ?? {}, FUNCOES_PADRAO)
      if (ex.indefinido) expect(r, `${d.nome}: ${ex.expr}`).toBeUndefined()
      else expect(r, `${d.nome}: ${ex.expr}`).toEqual(ex.saida)
    }
  })

  const GERA: Record<Gerador, () => unknown> = {
    texto: () => Array.from({ length: ri(8) }, () => pick(['a', 'B', ' ', 'ç', '日', '😀', '1', '\t', '-', 'ß', 'ǅ'])).join(''),
    numero: () => pick([0, 1, -1, 0.5, -0.5, 1e6, -1e6, 1e-6, 123.456, -78.9, rnd() * 200 - 100, Math.round(rnd() * 100), 1.005, 0.285]),
    inteiro: () => ri(41) - 20,
    escalar: () => pick([null, true, false, 0, 1, -3, 2.5, '', 'a', 'texto', ' x ', 7]),
    lista: () => Array.from({ length: ri(7) }, () => ri(9) - 3),
    listas: () => Array.from({ length: ri(4) }, () => (rnd() < 0.8 ? Array.from({ length: ri(4) }, () => ri(5)) : ri(5))),
    racional: () => {
      const dig = (n: number) => Array.from({ length: 1 + ri(n) }, () => ri(10)).join('')
      const sinal = () => (rnd() < 0.4 ? '-' : '')
      switch (ri(6)) {
        case 0: return `${sinal()}${dig(3)}`
        case 1: return `${sinal()}${dig(4)}.${dig(4)}`
        case 2: return `${sinal()}${dig(3)}/${1 + ri(40)}`
        case 3: return `${sinal()}${dig(30)}`
        case 4: return `${sinal()}${dig(2)}e${ri(8) - 3}`
        default: return ri(2001) - 1000
      }
    },
    decimal: () => `${rnd() < 0.4 ? '-' : ''}${ri(100000)}.${String(ri(10000)).padStart(1 + ri(4), '0').slice(-4)}`.replace(/\.$/, ''),
    json: () => { const f = (p: number): unknown => (p <= 0 || rnd() < 0.3 ? pick([null, true, 0, 1, -2.5, 'x', '']) : rnd() < 0.45 ? Array.from({ length: ri(4) }, () => f(p - 1)) : Object.fromEntries(Array.from({ length: ri(4) }, () => [pick(['a', 'b', 'k', 'v', 'ç']), f(p - 1)]))); return f(3) },
    indice: () => ri(6),
    objeto: () => Object.fromEntries(Array.from({ length: ri(4) }, () => [pick(['a', 'b', 'c', 'k-1', '__proto__', 'ç']), pick([0, 1, 'x', null, true])])),
    qualquer: () => pick([null, undefined, true, false, 0, 1, -2, 3.5, '', 'a', [], [0], {}, { a: 1 }]),
  }
  it('LEIS: cada propriedade declarada vale para 400 entradas aleatórias de cada tipo', () => {
    let total = 0
    for (const d of REGISTRO) for (const lei of d.leis ?? []) {
      const ast = parseExpr(lei.expr)
      for (let i = 0; i < 400; i++) {
        const esc: Record<string, unknown> = {}
        for (const [v, g] of Object.entries(lei.gera)) esc[v] = GERA[g]()
        const r = avalia(ast, esc, FUNCOES_PADRAO)
        if (r !== true) throw new Error(`lei violada em ${d.nome}: ${lei.expr}\n  com ${JSON.stringify(esc)} → ${JSON.stringify(r)}`)
        total++
      }
    }
    expect(total).toBeGreaterThan(10000)
  })
  it('as NÃO-leis são reais: a soma de floats NÃO é associativa (e o registro avisa)', () => {
    expect(avalia(parseExpr('(a + b) + c == a + (b + c)'), { a: 0.1, b: 0.2, c: 0.3 }, FUNCOES_PADRAO)).toBe(false)
    expect(REGISTRO.find((d) => d.nome === '+')!.naoLeis!.join(' ')).toContain('NÃO é associativa')
  })
})

// ---- AST canônico ----------------------------------------------------------

const NUMEROS = [0, 1, 7, 42, 0.5, 3.14159, 123456789.123, 1e21, 1e-7, 5e-324, 1.7976931348623157e308, 2 ** 53, 0.1 + 0.2]
const TEXTOS = ['', 'a', 'olá', 'a"b', "a'b", 'a\\b', 'l1\nl2', 't\tt', '\r', '${x}', '</script>', '日😀', '\u0000', ' ', 'true', ' x ']
const VARS = ['a', 'b', 'x1', '_u', '$s', 'estado', 'props', 'tamanho', 'e', 'E3']
const CAMPOS = ['nome', 'length', 'true', 'e', 'a1', '$']
const FNS = ['tamanho', 'brl', 'junta', 'naoexiste', 'f', 'texto']
const BINS = ['??', '||', '&&', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%'] as const

function geraExpr(prof: number): Expr {
  const pos = 0
  if (prof <= 0 || rnd() < 0.2) {
    const k = ri(5)
    if (k === 0) return { t: 'lit', v: pick(NUMEROS), pos }
    if (k === 1) return { t: 'lit', v: pick(TEXTOS), pos }
    if (k === 2) return { t: 'lit', v: pick([true, false, null]), pos }
    return { t: 'var', nome: pick(VARS), pos }
  }
  switch (ri(8)) {
    case 0: return { t: 'bin', op: pick(BINS), a: geraExpr(prof - 1), b: geraExpr(prof - 1), pos }
    case 1: return { t: 'un', op: pick(['!', '-'] as const), x: geraExpr(prof - 1), pos }
    case 2: return { t: 'cond', c: geraExpr(prof - 1), a: geraExpr(prof - 1), b: geraExpr(prof - 1), pos }
    case 3: return { t: 'mem', obj: geraExpr(prof - 1), nome: pick(CAMPOS), pos }
    case 4: return { t: 'idx', obj: geraExpr(prof - 1), idx: geraExpr(prof - 1), pos }
    case 5: return { t: 'call', fn: pick(FNS), args: Array.from({ length: ri(4) }, () => geraExpr(prof - 1)), pos }
    case 6: return { t: 'lista', itens: Array.from({ length: ri(4) }, () => geraExpr(prof - 1)), pos }
    default: return { t: 'bin', op: pick(BINS), a: geraExpr(prof - 1), b: geraExpr(prof - 1), pos }
  }
}

describe('AST canônico em JSON ≡ texto ≡ Expr', () => {
  it('FUZZ: Expr → texto canônico → Expr é a identidade (precedência, associatividade, escapes, números)', () => {
    for (let i = 0; i < 6000; i++) {
      const e = geraExpr(1 + ri(5))
      const txt = formata(e)
      let volta: Expr
      try { volta = parseExpr(txt) } catch (err) { throw new Error(`não leu de volta: ${txt}\n${(err as Error).message}`) }
      expect(semPos(volta), txt).toEqual(semPos(e))
    }
  })
  it('FUZZ: Expr → AST JSON → validação → Expr é a identidade, e o JSON sobrevive a stringify/parse', () => {
    for (let i = 0; i < 4000; i++) {
      const e = geraExpr(1 + ri(5))
      const ast = paraAst(e)
      const viaJson = JSON.parse(JSON.stringify(ast)) as Ast
      expect(validaAst(viaJson), JSON.stringify(ast)).toEqual([])
      const r = deAst(viaJson)
      expect(r.ok).toBe(true)
      if (r.ok) expect(semPos(r.expr)).toEqual(semPos(e))
    }
  })
  it('texto → AST → texto é ponto fixo: reescrever o canônico não muda mais nada', () => {
    for (let i = 0; i < 2000; i++) {
      const t1 = formata(geraExpr(1 + ri(5)))
      expect(formata(parseExpr(t1))).toBe(t1)
    }
  })
  it('os três caminhos AVALIAM igual (texto, Expr, AST) em escopos aleatórios', () => {
    const esc = { a: 3, b: 'x', x1: [1, 2], _u: { nome: 'n' }, $s: null, estado: { n: 1 }, props: { p: 2 }, tamanho: 4, e: 0, E3: '' }
    for (let i = 0; i < 3000; i++) {
      const e = geraExpr(1 + ri(4))
      const via = deAst(JSON.parse(JSON.stringify(paraAst(e))))
      if (!via.ok) throw new Error('inválido')
      const v1 = avalia(e, esc, FUNCOES_PADRAO), v2 = avalia(via.expr, esc, FUNCOES_PADRAO), v3 = avalia(parseExpr(formata(e)), esc, FUNCOES_PADRAO)
      expect(v2).toEqual(v1); expect(v3).toEqual(v1)
    }
  })
  it('o texto canônico é de UMA linha (quebra e tab viram escapes)', () => {
    expect(formata(parseExpr('"a\\nb\\tc"'))).toBe('"a\\nb\\tc"')
    expect(formata({ t: 'lit', v: 'x\ny', pos: 0 })).not.toContain('\n')
  })
  it('exemplos conhecidos do texto canônico', () => {
    for (const [src, canon] of [
      ['a-(b-c)', 'a - (b - c)'], ['(a-b)-c', 'a - b - c'], ['a*(b+c)', 'a * (b + c)'], ['x|brl', 'brl(x)'], ['x | numero(2)', 'numero(x, 2)'],
      ['(a?b:c)?d:e', '(a ? b : c) ? d : e'], ['a?b:c?d:e', 'a ? b : c ? d : e'], ['-(a+b)', '-(a + b)'], ['!(!a)', '!!a'], ['(a+b).c', '(a + b).c'],
      ["'it\\'s'", '"it\'s"'], ['a[1+1]', 'a[1 + 1]'], ['1e3', '1000'], ['0.5', '0.5'], ['2.5e-7', '2.5e-7'],
    ] as const) expect(formata(parseExpr(src)), src).toBe(canon)
  })

  it('validação: erros com caminho JSON, dica "quis dizer" e TODOS os problemas de uma vez', () => {
    const v = (x: unknown) => validaAst(x).map((e) => `${e.caminho}: ${e.mensagem}${e.dica ? ` [${e.dica}]` : ''}`)
    expect(v({ lit: 1 })).toEqual([])
    expect(v(5)[0]).toContain('é um objeto')
    expect(v({ vr: 'x' })[0]).toMatch(/sem forma conhecida.*quis dizer 'var'/)
    expect(v({ var: 'x', lit: 1 })[0]).toContain('ambíguo')
    expect(v({ chama: 'f', arg: [] }).join('|')).toMatch(/'arg' não existe.*quis dizer 'args'/)
    expect(v({ chama: 'f' })).toEqual(['/args: a forma \'chama\' precisa de \'args\''])
    expect(v({ lit: -5 })[0]).toMatch(/negativo.*"neg"/)
    expect(v({ lit: Infinity })[0]).toContain('finito')
    expect(v({ lit: [1] })[0]).toContain('listas e objetos')
    expect(v({ var: 'true' })[0]).toContain('nome de variável inválido')
    expect(v({ var: 'a-b' })[0]).toContain('nome de variável inválido')
    expect(v({ campo: 'a-b', de: { var: 'x' } })[0]).toMatch(/nome de campo inválido.*indice/)
    expect(v({ chama: '+', args: [{ lit: 1 }] })[0]).toContain("'+' recebe exatamente 2")
    expect(v({ chama: 'neg', args: [] })[0]).toContain("'neg' recebe exatamente 1")
    expect(v({ chama: 'f', args: [{ lit: 1 }, { zzz: 1 }, { var: '9' }] }).map((s) => s.split(':')[0])).toEqual(['/args/1', '/args/2/var'])
    expect(v({ se: { var: 'c' }, entao: { lit: 1 } })).toEqual(["/senao: a forma 'se' precisa de 'senao'"])
    expect(v({ lista: 'x' })[0]).toContain('array')
    // limites
    let fundo: unknown = { lit: 1 }
    for (let i = 0; i < 40; i++) fundo = { chama: 'f', args: [fundo] }
    expect(v(fundo).some((s) => s.includes('aninhada demais'))).toBe(true)
    expect(v({ lista: Array.from({ length: 600 }, () => ({ lit: 1 })) }).some((s) => s.includes('grande demais'))).toBe(true)
  })

  it('o lexer lê notação científica sem quebrar o que já existia', () => {
    const n = (s: string) => (parseExpr(s) as { v: number }).v
    expect(n('1e3')).toBe(1000); expect(n('2.5e-7')).toBe(2.5e-7); expect(n('1E+2')).toBe(100); expect(n('5e-324')).toBe(5e-324)
    expect(() => parseExpr('1e999')).toThrow(/grande demais/)
    expect(() => parseExpr('3em')).toThrow() // `e` sem dígitos não é expoente: continua erro de sintaxe
    expect(() => parseExpr('1e')).toThrow(/sobrou/) // `1` seguido de `e` sem operador: erro de sintaxe
  })
})

describe('docs/funcoes.md', () => {
  it('o arquivo commitado é exatamente o gerado do registro (rode `pnpm docs:funcoes` se mudar o registro)', () => {
    const arquivo = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'funcoes.md'), 'utf8')
    expect(arquivo).toBe(geraDocFuncoes())
  })
})
