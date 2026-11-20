import { describe, expect, it } from 'vitest'
import { atributosDaTela, caixasDe, passoDe, proporcaoDe } from '../src/tela/atributos'

describe('midia/tela: atributos', () => {
  it('proporção e passo: valores válidos passam; o resto vira o padrão', () => {
    expect(proporcaoDe({ proporcao: 0.7071 })).toBe(0.7071); for (const v of [0, -1, 21, NaN, Infinity, '2', null, undefined]) expect(proporcaoDe({ proporcao: v })).toBe(1)
    expect(passoDe({ passo: 0.01 })).toBe(0.01); for (const v of [0, 0.0001, 0.5, '0.1', NaN]) expect(passoDe({ passo: v })).toBe(0.005)
  })
  it('caixas: id seguro (texto ou número), rótulo cortado, frações limitadas, lixo descartado, no máximo 200', () => {
    const r = caixasDe({ caixas: [{ id: 'a', rotulo: 'x'.repeat(300), topo: 9, esquerda: -9, largura: -1, altura: 'x', rotacao: 999, atual: true }, { id: 7 }, { id: 'b c' }, { id: '' }, { id: '<x>' }, 5, null, [], { rotulo: 'sem id' }] })
    expect(r.map((c) => c.id)).toEqual(['a', '7']); expect(r[0]).toMatchObject({ topo: 2, esquerda: -1, largura: 0, altura: 0.1, rotacao: 360, atual: true }); expect(r[0]!.rotulo.length).toBe(120); expect(r[1]!.rotulo).toBe('7')
    expect(caixasDe({ caixas: Array.from({ length: 500 }, (_, i) => ({ id: `c${i}` })) })).toHaveLength(200); for (const v of [undefined, null, 'x', {}, 5]) expect(caixasDe({ caixas: v })).toEqual([])
  })
  it('atributos: marca da ilha, passo, estilo de proporção; as caixas só aparecem se houver', () => {
    const a = atributosDaTela({ proporcao: 2, caixas: [{ id: 'a' }] }); expect(a['data-polaris-tela']).toBe(''); expect(a['data-passo']).toBe('0.005'); expect(a.style).toBe('aspect-ratio:2;position:relative;width:100%;--proporcao:2'); expect(JSON.parse(a['data-polaris-caixas']!)).toHaveLength(1)
    expect(atributosDaTela({})).not.toHaveProperty('data-polaris-caixas')
  })
})
