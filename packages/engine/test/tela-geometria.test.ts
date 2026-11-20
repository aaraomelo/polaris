import { describe, expect, it } from 'vitest'
import { ALCAS, colocaCentrada, move, redimensiona, TAMANHO_MIN, type Caixa } from '../src/tela/geometria'

const c: Caixa = { topo: 0.2, esquerda: 0.2, largura: 0.3, altura: 0.2 }
describe('tela: geometria', () => {
  it('mover: desloca e cai na grade; nunca sai da moldura', () => {
    expect(move(c, 0.1, 0.05, 0.05).caixa).toEqual({ ...c, esquerda: 0.3, topo: 0.25 })
    expect(move(c, 5, 5, 0.005).caixa).toEqual({ ...c, esquerda: 0.7, topo: 0.8 }); expect(move(c, -5, -5, 0.005).caixa).toEqual({ ...c, esquerda: 0, topo: 0 })
  })
  it('mover: prende na borda de outra caixa e na linha central, e informa a guia', () => {
    const outra: Caixa = { topo: 0.6, esquerda: 0.55, largura: 0.2, altura: 0.1 }
    const r = move(c, 0.347, 0.0, 0.005, [outra]); expect(r.caixa.esquerda).toBeCloseTo(0.55, 6); expect(r.guias).toContainEqual({ eixo: 'x', em: 0.55 }) // a borda esquerda cola na da outra
    const m = move({ ...c, largura: 0.4 }, 0.1003, 0, 0.005, []); expect(m.caixa.esquerda + 0.2).toBeCloseTo(0.5, 6); expect(m.guias).toContainEqual({ eixo: 'x', em: 0.5 }) // o centro cola na linha central
    expect(move(c, 0.0004, 0, 0.005, [], 0).guias).toEqual([]) // sem limiar, só a grade
  })
  it('redimensionar: cada alça muda só as suas bordas; respeita o mínimo e a moldura', () => {
    expect(redimensiona(c, 'e', 0.1, 0.5, 0.05).caixa).toEqual({ ...c, largura: 0.4 }); expect(redimensiona(c, 's', 0.5, 0.1, 0.05).caixa).toEqual({ ...c, altura: 0.3 })
    expect(redimensiona(c, 'w', 0.1, 0, 0.05).caixa).toEqual({ ...c, esquerda: 0.3, largura: 0.2 }); expect(redimensiona(c, 'n', 0, -0.1, 0.05).caixa).toEqual({ ...c, topo: 0.1, altura: 0.3 })
    expect(redimensiona(c, 'se', 0.1, 0.1, 0.05).caixa).toEqual({ esquerda: 0.2, topo: 0.2, largura: 0.4, altura: 0.3 })
    expect(redimensiona(c, 'e', -5, 0, 0.005).caixa.largura).toBe(TAMANHO_MIN); expect(redimensiona(c, 'w', 5, 0, 0.005).caixa).toMatchObject({ largura: TAMANHO_MIN, esquerda: 0.48 })
    expect(redimensiona(c, 'se', 5, 5, 0.005).caixa).toEqual({ esquerda: 0.2, topo: 0.2, largura: 0.8, altura: 0.8 }); expect(redimensiona(c, 'nw', -5, -5, 0.005).caixa).toEqual({ esquerda: 0, topo: 0, largura: 0.5, altura: 0.4 })
  })
  it('propriedade: qualquer mover ou redimensionar devolve uma caixa dentro da moldura e com tamanho mínimo', () => {
    let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < 2000; i++) {
      const x: Caixa = { esquerda: rnd() * 0.8, topo: rnd() * 0.8, largura: TAMANHO_MIN + rnd() * 0.2, altura: TAMANHO_MIN + rnd() * 0.2 }, dx = (rnd() - 0.5) * 3, dy = (rnd() - 0.5) * 3, outras = [{ esquerda: rnd(), topo: rnd(), largura: 0.1, altura: 0.1 }]
      const ok = (k: Caixa, min: number) => { expect(k.esquerda).toBeGreaterThanOrEqual(0); expect(k.topo).toBeGreaterThanOrEqual(0); expect(k.esquerda + k.largura).toBeLessThanOrEqual(1 + 1e-4); expect(k.topo + k.altura).toBeLessThanOrEqual(1 + 1e-4); expect(k.largura).toBeGreaterThanOrEqual(min - 1e-4); expect(k.altura).toBeGreaterThanOrEqual(min - 1e-4) }
      ok(move(x, dx, dy, 0.005, outras).caixa, x.largura < x.altura ? x.largura : x.altura); ok(redimensiona(x, ALCAS[i % 8]!, dx, dy, 0.005, outras).caixa, TAMANHO_MIN)
    }
  })
  it('soltar do menu: o centro vai ao ponto, dentro da moldura e na grade', () => {
    expect(colocaCentrada(0.5, 0.5, 0.4, 0.2, 0.05)).toEqual({ esquerda: 0.3, topo: 0.4, largura: 0.4, altura: 0.2 }); expect(colocaCentrada(0, 0, 0.4, 0.2, 0.005)).toMatchObject({ esquerda: 0, topo: 0 }); expect(colocaCentrada(1, 1, 0.4, 0.2, 0.005)).toMatchObject({ esquerda: 0.6, topo: 0.8 })
  })
})
