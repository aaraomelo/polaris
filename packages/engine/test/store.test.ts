import { describe, expect, it } from 'vitest'
import { reduz, type Store } from '../src/index'

const inicial = (): Store => ({ estado: { termo: 'a', pagina: 1 }, dados: { prods: [1] }, status: { prods: 'ok' }, erros: {} })
const congela = <T,>(o: T): T => { if (o && typeof o === 'object') { Object.values(o).forEach(congela); Object.freeze(o) } return o }

describe('store: reducer imutável', () => {
  it('nunca muta o store anterior (funciona com tudo congelado)', () => {
    const s = congela(inicial())
    expect(() => {
      let x = reduz(s, { t: 'estado', nome: 'termo', valor: 'b' })
      x = reduz(x, { t: 'carregando', nome: 'prods' })
      x = reduz(x, { t: 'erro', nome: 'prods', erro: 'x' })
      reduz(x, { t: 'dado', nome: 'prods', valor: [2] })
    }).not.toThrow()
    expect(s).toEqual(inicial())
  })

  it('compartilhamento estrutural: só a fatia alterada ganha nova referência', () => {
    const s = inicial()
    const a = reduz(s, { t: 'estado', nome: 'termo', valor: 'b' })
    expect(a.estado).not.toBe(s.estado)
    expect(a.dados).toBe(s.dados)
    expect(a.status).toBe(s.status)
    expect(a.erros).toBe(s.erros)
    const b = reduz(s, { t: 'carregando', nome: 'prods' })
    expect(b.status).not.toBe(s.status)
    expect(b.estado).toBe(s.estado)
    expect(b.dados).toBe(s.dados)
    const c = reduz(s, { t: 'dado', nome: 'prods', valor: [9] })
    expect(c.estado).toBe(s.estado)
    expect(c.dados).not.toBe(s.dados)
  })

  it('um valor intocado dentro da fatia mantém a referência (base para re-render localizado)', () => {
    const s = inicial()
    const lista = s.dados.prods
    const a = reduz(s, { t: 'dado', nome: 'outro', valor: 1 })
    expect(a.dados.prods).toBe(lista)
  })

  it('transições de status e erro', () => {
    let s = reduz(inicial(), { t: 'carregando', nome: 'prods' })
    expect(s.status.prods).toBe('carregando')
    s = reduz(s, { t: 'erro', nome: 'prods', erro: 'falhou' })
    expect(s.status.prods).toBe('erro')
    expect(s.erros.prods).toBe('falhou')
    s = reduz(s, { t: 'dado', nome: 'prods', valor: [7] })
    expect(s.status.prods).toBe('ok')
    expect(s.dados.prods).toEqual([7])
    expect('prods' in s.erros).toBe(false) // sucesso limpa o erro anterior
  })

  it('erro de uma variável não afeta o erro de outra', () => {
    let s = reduz(inicial(), { t: 'erro', nome: 'a', erro: 'ea' })
    s = reduz(s, { t: 'erro', nome: 'b', erro: 'eb' })
    s = reduz(s, { t: 'dado', nome: 'a', valor: 1 })
    expect(s.erros).toEqual({ b: 'eb' })
  })
})
