import { criaValidador } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { converteConfiguracao, layoutCartaz } from '../src'

// Um config pequeno no formato do legado (sem depender do repositório dele): exercita cada tradução.
const CFG = {
  globals: { fontFamily: 'Montserrat', fontWeight: 'bold' },
  modifiers: [{ type: 'grande', width: 0.8, height: 0.2 }],
  complements: [{ type: 'primary', textAlign: 'center', alignItems: 'center' }, { type: 'priceLabel', text: 'DE: R$' }],
  geometries: [
    { dynamic: 'DP', sizes: ['A4', 'A5', 'EP21'], orientation: 'landscape', children: [
      { type: 'primary', text: '{product.primary}', width: 0.9, height: 0.15, top: 0.05, left: 0.05 },
      { type: 'priceLabel', width: 0.2, height: 0.08, top: 0.3, left: 0.05 },
      { type: 'price', elementType: 'price', variant: 'primaryOld', text: '{price.price}', width: 0.3, height: 0.12, top: 0.3, left: 0.3, margin: 'auto auto auto 0', color: [90, 90, 90], params: ['{product.unit}', 'bold'] },
      { type: 'discountBanner', text: { value: 'DESCONTO DE {value}', params: [{ type: 'value', args: ['price.price', 'price.promotional'], function: 'differencePercent' }] }, top: 0.5, left: 0, width: 1, height: 0.08, alignItems: 'center', justifyContent: 'center' },
      { type: 'installmentPrice', modifiers: 'grande', top: 0.6, left: 0.1, text: { value: 'EM {n}X DE R$ {p}', params: [{ type: 'n', args: 'price.installments' }, { type: 'p', args: ['price.promotional', 'price.installments'], function: 'installment' }] } },
      { type: 'barcode', elementType: 'barcode', text: '{price.barcode}', code: '{product.code}', width: 0.2, height: 0.15, top: 0.8, left: 0.05, properties: [{ type: 'visibility', key: 'price.hasBarcode' }] },
      { type: 'qrcode', elementType: 'qrcode', text: '{price.qrcode}', size: 0.1, top: 0.8, right: 0.05, properties: [{ type: 'visibility', key: 'product.duplicity', value: 'double' }] },
      { type: 'validity', elementType: 'validity', text: '{product.validity}', width: 0.5, height: 0.06, top: 0.93, left: 0.3 },
      { type: 'unit', text: '$pow(M2) e {product.unit}', width: 0.2, height: 0.05, top: 0.7, left: 0.7, color: [255, 0, 0], properties: [{ type: 'color', key: 'model.layout', value: ['MONO'], properties: { color: [0, 0, 0] } }] },
      { type: 'sem-caixa', text: 'x' },
    ] },
    { dynamic: 'AV', sizes: ['EP21'], orientation: 'landscape', children: [{ type: 'primary', text: 'x', width: 1, height: 1, top: 0, left: 0 }] },
  ],
}
const DADOS = { model: { layout: 'MONO' }, product: { primary: 'ARROZ 5KG', unit: 'KG', code: '123', duplicity: 'double', validity: '15/03/2027' }, price: { price: '12.90', promotional: '9.99', installments: '3', barcode: '7891000100103', qrcode: 'http://x.com', hasBarcode: true } }

describe('conversor do legado (sintético)', () => {
  const { nos, relatorio } = converteConfiguracao(CFG, 'teste'), no = nos[0]!.no, spec = no.spec, el = (id: string) => spec.elementos.find((e: any) => e.id === id)
  it('gera um nó por layout com suporte, válido no schema e que calcula layout; EP21 sozinho é avisado e pulado', () => {
    expect(nos.map((n) => n.id)).toEqual(['teste.dp.paisagem']); expect(spec.tamanhos).toEqual(['A4', 'A5']); expect(spec.orientacao).toBe('paisagem')
    expect(criaValidador()(no).ok).toBe(true); expect(() => layoutCartaz(spec, DADOS)).not.toThrow()
    expect(relatorio.avisos.join()).toMatch(/EP21/); expect(relatorio.naoConvertidos.join()).toMatch(/sem-caixa|semCaixa/)
  })
  it('resolve globals, complements e modifiers como o legado (alinhamento do complemento, tamanho do modificador)', () => {
    expect(el('primary')).toMatchObject({ tipo: 'texto', alinhaH: 'centro', alinhaV: 'meio', fonte: { familia: 'Montserrat', peso: 'negrito' } })
    expect(el('priceLabel').texto).toBe('DE: R$'); expect(el('installmentPrice').caixa).toMatchObject({ largura: 0.8, altura: 0.2 })
  })
  it('preço antigo: riscado, centavos do mesmo tamanho, unidade e alinhamento pela margem', () => {
    expect(el('price')).toMatchObject({ tipo: 'preco', valor: '{price.price}', riscado: { espessura: 2 }, centavos: { escala: 1, posicao: 'base' }, alinhaH: 'esquerda', cor: [90, 90, 90], unidade: { texto: '{product.unit}' } })
  })
  it('funções viram `calculos` (decimal exato) e o texto os referencia; sem função só troca o caminho', () => {
    expect(spec.calculos.discountBannerValue).toEqual({ funcao: 'diferencaPercentual', args: ['price.price', 'price.promotional'] }); expect(el('discountBanner').texto).toBe('DESCONTO DE {calculo.discountBannerValue}')
    expect(spec.calculos.installmentPriceP).toMatchObject({ funcao: 'parcela' }); expect(el('installmentPrice').texto).toBe('EM {price.installments}X DE R$ {calculo.installmentPriceP | num:2}')
    expect(layoutCartaz(spec, DADOS).paginas[0]!.ops.some((o) => o.tipo === 'texto' && o.texto === 'DESCONTO DE 22%')).toBe(true)
  })
  it('barras, QR (quadrado em pt: a altura é proporcional à orientação), validade, visibilidade e cor condicional', () => {
    expect(el('barcode')).toMatchObject({ tipo: 'codigoBarras', valor: '{price.barcode}', rotulo: '{product.code}', se: 'price.hasBarcode' })
    expect(el('qrcode')).toMatchObject({ tipo: 'qrcode', se: 'product.duplicity == "double"', caixa: { direita: 0.05, largura: 0.1 } }); expect(el('qrcode').caixa.altura).toBeCloseTo(0.1 * 297 / 210, 3)
    expect(el('validity')).toMatchObject({ tipo: 'validade', data: '{product.validity}' })
    expect(el('unit')).toMatchObject({ texto: 'm² e {product.unit}', cor: [255, 0, 0], cores: [{ se: 'model.layout == "MONO"', cor: [0, 0, 0] }] })
    const cor = (layout: string) => (layoutCartaz(spec, { ...DADOS, model: { layout } }).paginas[0]!.ops.filter((o) => o.tipo === 'texto' && o.texto.startsWith('m²')).pop() as { cor: number[] }).cor
    expect([cor('MONO'), cor('OUTRO')]).toEqual([[0, 0, 0], [255, 0, 0]])
  })
  it('os dados usados viram `dados` do nó (e `calculo` não)', () => { expect(Object.keys(spec.dados).sort()).toEqual(['model', 'price', 'product']) })
})
