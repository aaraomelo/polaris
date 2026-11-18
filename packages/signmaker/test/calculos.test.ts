import { describe, expect, it } from 'vitest'
import { analisaCondicao, avalia, calcula, layoutCartaz } from '../src'

describe('funções decimais exatas (as do legado, sem Number)', () => {
  it('diferença, diferença percentual (piso), percentual, desconto, parcela (piso em centavos), arredonda', () => {
    expect(calcula('diferenca', ['12.90', '9.99'])).toBe('2.91'); expect(calcula('diferenca', ['0.30', '0.10'])).toBe('0.20') // 0,3 − 0,1 em ponto flutuante daria 0,19999…
    expect(calcula('diferencaPercentual', ['12.90', '9.99'])).toBe('22%'); expect(calcula('diferencaPercentual', ['100', '66.67'])).toBe('33%'); expect(calcula('diferencaPercentual', ['0', '5'])).toBe('0%')
    expect(calcula('percentual', ['200', '150'])).toBe('25.00'); expect(calcula('percentual', ['3', '2'])).toBe('33.33')
    expect(calcula('desconto', ['100.00', '10'])).toBe('90.00'); expect(calcula('desconto', ['9.99', '15'])).toBe('8.49'); expect(calcula('desconto', ['0.05', '50'])).toBe('0.03') // meio para cima
    expect(calcula('parcela', ['100', '3'])).toBe('33.33'); expect(calcula('parcela', ['10', '3'])).toBe('3.33'); expect(calcula('parcela', ['50', '0'])).toBe('50.00')
    expect(calcula('arredonda', ['2.5'])).toBe('3'); expect(calcula('arredonda', ['2.49'])).toBe('2')
  })
  it('precisão além de um double e números negativos; argumento que não é número devolve null', () => {
    expect(calcula('diferenca', ['12345678901234.99', '0.01'])).toBe('12345678901234.98'); expect(calcula('diferenca', ['1', '2.5'])).toBe('-1.50'); expect(calcula('diferencaPercentual', ['10', '20'])).toBe('-100%')
    expect(calcula('diferenca', ['abc', '1'])).toBeNull(); expect(calcula('arredonda', [''])).toBeNull(); expect(calcula('diferenca', [undefined, 1])).toBeNull()
  })
})

describe('condições (gramática fechada)', () => {
  const d = { a: { b: 'double', n: 3, ok: true, vazio: '' }, preco: { tem: false } }
  it('simples, negação, igualdade, desigualdade e "em"', () => {
    const t = (e: string) => avalia(analisaCondicao(e), d)
    expect([t('a.ok'), t('!a.ok'), t('a.vazio'), t('!a.vazio'), t('preco.tem'), t('a.inexistente')]).toEqual([true, false, false, true, false, false])
    expect([t('a.b == "double"'), t("a.b == 'single'"), t('a.b != "single"'), t('a.n == 3'), t('a.ok == true'), t('a.b em ["x", "double"]'), t('a.b em ["x"]'), t('a.inexistente em ["x"]'), t('a.inexistente != "x"')]).toEqual([true, false, true, true, true, true, false, false, true])
  })
  it('recusa o que não está na gramática (nada de expressões, chamadas, protótipo)', () => {
    for (const ruim of ['a.b == c.d', 'a.b === "x"', 'a.b && a.c', 'a.b == "x" || 1', 'f(x)', 'a..b', '', 'a.b em []', 'a.b == "' + 'x'.repeat(200) + '"']) expect(() => avalia(analisaCondicao(ruim), d), ruim).toThrow()
    expect(avalia(analisaCondicao('__proto__.x == "1"'), d)).toBe(false); expect(avalia(analisaCondicao('constructor.name != "x"'), d)).toBe(true) // protótipo nunca é lido
  })
})

const spec = (extra: object = {}, elementos: object[] = []) => ({
  tamanho: 'A5', orientacao: 'paisagem', fonte: { familia: 'Montserrat', peso: 'negrito' }, dados: { preco: { tipo: 'json' }, produto: { tipo: 'json' } },
  calculos: { desc: { funcao: 'diferencaPercentual', args: ['preco.de', 'preco.por'] }, parc: { funcao: 'parcela', args: ['preco.por', 'preco.n'], padrao: '0.00' } },
  elementos: [{ tipo: 'texto', id: 't', texto: 'DESCONTO DE {calculo.desc}', caixa: { topo: 0, esquerda: 0, largura: 1, altura: 0.3 } }, ...elementos], ...extra,
})
const textos = (s: object, dados: unknown) => (layoutCartaz(s as never, dados).paginas[0]!.ops.filter((o) => o.tipo === 'texto') as Array<{ texto: string; cor: number[] }>).map((o) => o.texto).join(' ')

describe('calculos, cores e tamanhos no cartaz', () => {
  const dados = { preco: { de: '12.90', por: '9.99', n: '3' }, produto: { nome: 'x', layout: 'MONO' } }
  it('o valor calculado entra no texto por {calculo.nome}', () => { expect(textos(spec(), dados)).toBe('DESCONTO DE 22%') })
  it('argumento ausente: usa `padrao`; sem padrão é erro (nunca sai peça com buraco)', () => {
    expect(textos(spec({}, [{ tipo: 'texto', id: 'p', texto: '{calculo.parc}', caixa: { topo: 0.5, esquerda: 0, largura: 1, altura: 0.2 } }]), { ...dados, preco: { de: '12.90', por: '9.99', n: 'abc' } })).toContain('0.00')
    expect(() => layoutCartaz(spec() as never, { ...dados, preco: { de: 'x', por: '9.99', n: '1' } })).toThrow(/não são números/)
  })
  it('validação: função desconhecida, aridade errada, dado não declarado, `calculo` sem calculos', () => {
    const erros = (s: object) => { try { layoutCartaz(s as never, dados); return '' } catch (e) { return (e as Error).message } }
    expect(erros(spec({ calculos: { x: { funcao: 'eval', args: ['preco.de'] } } }))).toMatch(/função desconhecida/)
    expect(erros(spec({ calculos: { x: { funcao: 'diferenca', args: ['preco.de'] } } }))).toMatch(/recebe 2 argumento/)
    expect(erros(spec({ calculos: { x: { funcao: 'arredonda', args: ['zz.de'] } } }))).toMatch(/não declarado/)
    expect(erros({ ...spec(), calculos: undefined })).toMatch(/não declarado/)
  })
  it('cores condicionais: a primeira condição verdadeira vence; sem nenhuma, vale `cor`', () => {
    const s = () => spec({}, [{ tipo: 'texto', id: 'c', texto: 'cor', caixa: { topo: 0.5, esquerda: 0, largura: 1, altura: 0.2 }, cor: [1, 1, 1], cores: [{ se: 'produto.layout == "MONO"', cor: [9, 9, 9] }, { se: 'produto.layout != "X"', cor: [8, 8, 8] }] }])
    const cor = (l: string) => (layoutCartaz(s() as never, { ...dados, produto: { nome: 'x', layout: l } }).paginas[0]!.ops.filter((o) => o.tipo === 'texto').pop() as { cor: number[] }).cor
    expect([cor('MONO'), cor('OUTRO'), cor('X')]).toEqual([[9, 9, 9], [8, 8, 8], [1, 1, 1]])
  })
  it('tamanhos: o mesmo layout serve a vários tamanhos; o padrão e o pedido precisam estar na lista', () => {
    const s = spec({ tamanhos: ['A5', 'A6'] }); expect(layoutCartaz(s as never, dados, { tamanho: 'A6' }).largura).toBeCloseTo(148 * 72 / 25.4, 1)
    expect(() => layoutCartaz(s as never, dados, { tamanho: 'A4' })).toThrow(/não está em tamanhos/)
  })
})
