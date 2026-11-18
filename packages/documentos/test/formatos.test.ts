import { describe, expect, it } from 'vitest'
import { brl, cpfcnpj, data, datahora, num } from '../src/formatos'
import { interpola } from '../src/interpola'

describe('formatos exatos', () => {
  it('dinheiro: arredonda meio para cima em módulo, por decimal exato', () => {
    expect([brl('0.105'), brl('0.104'), brl('0.995'), brl('1.005'), brl(0.1 + 0.2), brl('-0.005'), brl('-0.004')]).toEqual(['R$ 0,11', 'R$ 0,10', 'R$ 1,00', 'R$ 1,01', 'R$ 0,30', '-R$ 0,01', 'R$ 0,00'])
    expect(brl('1234567.891')).toBe('R$ 1.234.567,89'); expect(brl('12345678901234567890.12')).toBe('R$ 12.345.678.901.234.567.890,12'); expect(brl(7)).toBe('R$ 7,00')
  })
  it('dinheiro/número inválidos saem vazios (nunca "NaN" nem "R$ 0,00" de mentira)', () => {
    for (const v of ['abc', '', '1e3', 'NaN', null, undefined, {}, NaN, Infinity, '1,5']) { expect(brl(v)).toBe(''); expect(num(v)).toBe('') }
  })
  it('número: casas e milhares', () => { expect([num('2.5'), num('1.5', 3), num('1234.5678', 2), num('1000000'), num('-1234.5', 1)]).toEqual(['3', '1,500', '1.234,57', '1.000.000', '-1.234,5']) })
  it('data pura não sofre fuso; data inexistente sai vazia', () => { expect([data('2026-06-08'), data('2026-02-30'), data('2026-13-01'), data('lixo'), data(5)]).toEqual(['08/06/2026', '', '', '', '']) })
  it('instante → Brasília (UTC−3), com Z, com offset e sem zona', () => {
    expect(datahora('2026-06-08T14:30:00Z')).toBe('08/06/2026 11:30')
    expect(datahora('2026-06-08T01:00:00Z')).toBe('07/06/2026 22:00') // vira o dia para trás
    expect(datahora('2026-06-08T17:05:00-03:00')).toBe('08/06/2026 17:05')
    expect(datahora('2026-06-08T17:05:00+05:30')).toBe('08/06/2026 08:35')
    expect(datahora('2026-06-08T17:05:00')).toBe('08/06/2026 17:05') // sem zona = já é hora local
    expect(datahora('2026-06-08T23:30:00-03:00')).toBe('08/06/2026 23:30')
  })
  it('cpf/cnpj', () => { expect([cpfcnpj('12345678909'), cpfcnpj('12345678000195'), cpfcnpj('123'), cpfcnpj(null)]).toEqual(['123.456.789-09', '12.345.678/0001-95', '123', '']) })
  it('trunc e upper/lower em pt-BR', () => {
    expect(interpola('{a | trunc:5}|{a | upper}|{b | lower}', { a: 'ação rápida', b: 'ÇÃO' })).toBe('ação…|AÇÃO RÁPIDA|ção')
    expect(interpola('{a | trunc:50}', { a: 'curto' })).toBe('curto')
  })
  it('sem filtro: número e booleano viram texto; objeto e lista viram vazio (não "[object Object]")', () => { expect(interpola('{a}|{b}|{c}|{d}|{e}', { a: 3, b: true, c: {}, d: [1], e: null })).toBe('3|sim|||') })
})
