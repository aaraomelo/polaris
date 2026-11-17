import { describe, expect, it } from 'vitest'
import { confereValor, resolveArgs } from '../src/index'

describe('confereValor', () => {
  it.each([
    ['texto', 'a', true], ['texto', 1, false],
    ['inteiro', 3, true], ['inteiro', 3.5, false], ['inteiro', '7', true], ['inteiro', 'x', false], ['inteiro', '', false], ['inteiro', Infinity, false],
    ['decimal', 1.5, true], ['decimal', '1.5', true], ['dinheiro', '12.50', true], ['dinheiro', NaN, false],
    ['booleano', true, true], ['booleano', 'false', true], ['booleano', 'sim', false], ['booleano', 1, false],
    ['data', '2026-06-08', true], ['data', '2026-13-45', false], ['data', '08/06/2026', false],
    ['dataHora', '2026-06-08T10:00:00Z', true], ['dataHora', '2026-06-08', false],
    ['uuid', '11111111-1111-1111-1111-111111111111', true], ['uuid', 'nao-e-uuid', false],
    ['json', { qualquer: [1] }, true], ['json', 'x', true],
  ])('%s ← %j: %s', (tipo, valor, ok) => expect(confereValor({ tipo }, valor).ok).toBe(ok))

  it('DINHEIRO é texto decimal exato: nunca vira float ("49.90" fica "49.90"; 1.005 não é arredondado)', () => {
    expect(confereValor({ tipo: 'dinheiro' }, '49.90')).toEqual({ ok: true, valor: '49.90' })
    expect(confereValor({ tipo: 'dinheiro' }, ' 1.005 ')).toEqual({ ok: true, valor: '1.005' })
    expect(confereValor({ tipo: 'dinheiro' }, 49.9)).toEqual({ ok: true, valor: '49.9' })
    expect(confereValor({ tipo: 'dinheiro' }, '9007199254740993.00').ok).toBe(false) // 16 inteiros: além do que o banco guarda
    for (const v of ['1e3', '1,5', '', 'R$ 1', '1.23456', 1e21, Infinity, '-', '.5']) expect(confereValor({ tipo: 'dinheiro' }, v).ok, String(v)).toBe(false)
    expect(confereValor({ tipo: 'dinheiro', lista: true }, ['1.10', 2])).toEqual({ ok: true, valor: ['1.10', '2'] })
  })

  it('normaliza texto numérico (parâmetros de URL chegam como texto)', () => {
    expect(confereValor({ tipo: 'inteiro' }, '7')).toEqual({ ok: true, valor: 7 })
    expect(confereValor({ tipo: 'booleano' }, 'true')).toEqual({ ok: true, valor: true })
  })

  it('listas: todos os itens precisam servir; json aceita qualquer coisa', () => {
    expect(confereValor({ tipo: 'inteiro', lista: true }, [1, '2', 3])).toEqual({ ok: true, valor: [1, 2, 3] })
    expect(confereValor({ tipo: 'inteiro', lista: true }, [1, 'x'])).toMatchObject({ ok: false, esperado: 'lista de inteiro' })
    expect(confereValor({ tipo: 'inteiro', lista: true }, 3)).toMatchObject({ ok: false })
    expect(confereValor({ tipo: 'json', lista: true }, { a: 1 }).ok).toBe(true)
  })

  it('tipo desconhecido nunca passa', () => {
    expect(confereValor({ tipo: 'banana' }, 'x').ok).toBe(false)
  })
})

describe('resolveArgs', () => {
  const par = { q: { tipo: 'texto' }, pagina: { tipo: 'inteiro', padrao: 1 }, id: { tipo: 'uuid', obrigatorio: true } }
  const U = '11111111-1111-1111-1111-111111111111'

  it('aplica padrão, normaliza e devolve só o que a fonte declara', () => {
    expect(resolveArgs(par, { id: U, pagina: '3' })).toEqual({ ok: true, args: { id: U, pagina: 3 } })
    expect(resolveArgs(par, { id: U })).toEqual({ ok: true, args: { id: U, pagina: 1 } })
  })

  it('null conta como ausente (usa padrão / acusa obrigatório)', () => {
    expect(resolveArgs(par, { id: U, pagina: null })).toEqual({ ok: true, args: { id: U, pagina: 1 } })
    const r = resolveArgs(par, { id: null })
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.erros[0]!.mensagem).toContain("obrigatório 'id'")
  })

  it('acumula todos os erros: desconhecido, obrigatório e tipo', () => {
    const r = resolveArgs(par, { x: 1, pagina: 'abc' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erros.map((e) => e.arg).sort()).toEqual(['id', 'pagina', 'x'])
  })

  it('sem parâmetros declarados, qualquer argumento é recusado (a fonte não aceita nada)', () => {
    expect(resolveArgs({}, {}).ok).toBe(true)
    expect(resolveArgs({}, { a: 1 }).ok).toBe(false)
  })

  it('não confunde nomes do protótipo com parâmetros', () => {
    expect(resolveArgs({}, { toString: 1 }).ok).toBe(false)
    expect(resolveArgs({ q: { tipo: 'texto' } }, JSON.parse('{"__proto__": 1}')).ok).toBe(false)
  })
})
