import { describe, expect, it } from 'vitest'
import { ALCAS, colocaCentrada, move, redimensiona, redimensionaGirada, redimensionaLocal, TAMANHO_MIN, type Caixa } from '../src/tela/geometria'

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

describe('tela: redimensionar caixa girada', () => {
  const gira = (px: number, py: number, ox: number, oy: number, graus: number): [number, number] => { const a = (graus * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a), dx = px - ox, dy = py - oy; return [ox + dx * co + dy * si, oy - dx * si + dy * co] }
  /** os 4 cantos da caixa na tela (espaço da peça: altura 1, largura prop), girada em torno do meio da borda esquerda */
  const cantos = (c: Caixa, graus: number, prop: number) => { const x = c.esquerda * prop, y = c.topo, w = c.largura * prop, h = c.altura, o: [number, number] = [x, y + h / 2]; return { nw: gira(x, y, o[0], o[1], graus), ne: gira(x + w, y, o[0], o[1], graus), sw: gira(x, y + h, o[0], o[1], graus), se: gira(x + w, y + h, o[0], o[1], graus) } }
  const oposto: Record<string, Array<'nw' | 'ne' | 'sw' | 'se'>> = { se: ['nw'], nw: ['se'], ne: ['sw'], sw: ['ne'], e: ['nw', 'sw'], w: ['ne', 'se'], s: ['nw', 'ne'], n: ['sw', 'se'] }
  const base: Caixa = { esquerda: 0.3, topo: 0.4, largura: 0.4, altura: 0.15 }
  it('sem giro, é o mesmo que redimensionar (em qualquer proporção)', () => {
    for (const alca of ALCAS) for (const prop of [1, 1.4189, 0.7071]) {
      const g = redimensionaGirada(base, alca, 0.0613, -0.0377, 0, prop, 0.005).caixa, n = redimensiona(base, alca, 0.0613, -0.0377, 0.005).caixa
      for (const k of ['esquerda', 'topo', 'largura', 'altura'] as const) expect(g[k], `${alca} ${prop} ${k}`).toBeCloseTo(n[k], 2)
    }
  })
  it('o lado oposto à alça fica PARADO na tela, em qualquer ângulo, alça e proporção', () => {
    let s = 11; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < 800; i++) {
      const graus = Math.round((rnd() * 360 - 180) * 4) / 4, prop = 0.5 + rnd() * 1.5, alca = ALCAS[i % 8]!, dx = (rnd() - 0.5) * 0.3, dy = (rnd() - 0.5) * 0.3
      const c: Caixa = { esquerda: 0.1 + rnd() * 0.3, topo: 0.1 + rnd() * 0.3, largura: 0.2 + rnd() * 0.3, altura: 0.1 + rnd() * 0.2 }
      const antes = cantos(c, graus, prop), depois = cantos(redimensionaGirada(c, alca, dx, dy, graus, prop, 0.0005).caixa, graus, prop)
      for (const k of oposto[alca]!) { expect(Math.abs(depois[k][0] - antes[k][0]), `${alca} ${graus} ${k}`).toBeLessThan(0.006); expect(Math.abs(depois[k][1] - antes[k][1]), `${alca} ${graus} ${k}`).toBeLessThan(0.006) }
    }
  })
  it('em 90°, puxar a alça direita na vertical da tela muda a LARGURA da caixa (o eixo dela é vertical); respeita o mínimo', () => {
    const g = redimensionaGirada(base, 'e', 0, -0.1, 90, 1, 0.005).caixa; expect(g.largura).toBeCloseTo(0.5, 2); expect(g.altura).toBeCloseTo(0.15, 3); expect(g.esquerda).toBeCloseTo(0.3, 3)
    expect(redimensionaGirada(base, 'e', 0, 5, 90, 1, 0.005).caixa.largura).toBeCloseTo(TAMANHO_MIN, 3); expect(redimensionaGirada(base, 's', 0, -5, 37, 1.4, 0.005).caixa.altura).toBeCloseTo(TAMANHO_MIN, 3)
  })
  it('redimensionaLocal (teclado): mais largo é ao longo da caixa e o pivô não anda quando se mexe na direita', () => {
    const g = redimensionaLocal(base, 'e', 0.01, 0, 60, 1.4189, 0.001).caixa; expect(g.largura).toBeCloseTo(0.4 + 0.01 / 1.4189, 3); expect(g.esquerda).toBeCloseTo(0.3, 3); expect(g.topo).toBeCloseTo(0.4, 3)
  })
})
