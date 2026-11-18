import { describe, expect, it } from 'vitest'
import { LIMITES_LOTE, geraLote, htmlDe, layoutLote, pdfDe } from '../src'
import { DADOS_ETIQUETA, DADOS_OFERTA, DADOS_PRECO, NO_ETIQUETA, NO_OFERTA, NO_PRECO } from './exemplos'
import { PRONTO, palavrasGiradas, diferenca, doChrome, doPdf, junta, pixelOk, pior, usaNavegador } from './paridade-comum'

const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const itens = () => [
  { no: NO_OFERTA, dados: DADOS_OFERTA, quantidade: 2 },
  { no: NO_PRECO, dados: DADOS_PRECO, tamanho: 'A6' },
  { no: NO_ETIQUETA, dados: DADOS_ETIQUETA, quantidade: 3, tamanho: 'A4' },
]

describe('lote', () => {
  it('uma página por cópia, na ordem dos itens, cada uma no seu tamanho', () => {
    const l = layoutLote(itens()); expect(l.paginas).toHaveLength(6)
    expect(l.paginas.map((p) => `${Math.round(p.largura)}x${Math.round(p.altura)}`)).toEqual(['595x420', '595x420', '420x298', '842x595', '842x595', '842x595'].map((x, i) => (i === 2 ? '420x298' : x))) // A5 paisagem ×2, A6 paisagem, A4 paisagem ×3
    expect(l.titulo).toBe('Lote de 6 páginas'); expect(l.largura).toBe(l.paginas[0]!.largura)
  })
  it('as cópias são independentes (mexer numa não mexe nas outras) e idênticas entre si', () => {
    const l = layoutLote([{ no: NO_OFERTA, dados: DADOS_OFERTA, quantidade: 2 }]); expect(l.paginas[0]).toEqual(l.paginas[1]); expect(l.paginas[0]).not.toBe(l.paginas[1])
    ;(l.paginas[0]!.ops[0] as { x: number }).x = 999; expect((l.paginas[1]!.ops[0] as { x: number }).x).not.toBe(999)
  })
  it('`semFundo` tira só a imagem de fundo; a cor fica', () => {
    const no = { kind: 'cartaz', id: 'f', spec: { ...NO_OFERTA.spec, fundo: { cor: [1, 2, 3], imagem: PNG_1X1 } } }
    const tipos = (sem: boolean) => layoutLote([{ no, dados: DADOS_OFERTA, semFundo: sem }]).paginas[0]!.ops.filter((o) => o.tipo === 'imagem' || (o.tipo === 'ret' && o.cor.join() === '1,2,3')).map((o) => o.tipo)
    expect(tipos(false)).toEqual(['ret', 'imagem']); expect(tipos(true)).toEqual(['ret'])
  })
  it('fail-closed e com o item no erro: vazio, quantidade ruim, kind errado, dado faltando, tamanho fora de `tamanhos`, limites', () => {
    const e = (it: unknown) => { try { layoutLote(it as never); return '' } catch (x) { return (x as Error).message } }
    expect(e([])).toMatch(/sem itens/); expect(e([{ no: NO_OFERTA, dados: DADOS_OFERTA, quantidade: 0 }])).toMatch(/item 1: quantidade/); expect(e([{ no: NO_OFERTA, dados: DADOS_OFERTA, quantidade: 1.5 }])).toMatch(/inteiro/)
    expect(e([{ no: { kind: 'pagina', spec: {} }, dados: {} }])).toMatch(/kind=cartaz/); expect(e([{ no: NO_OFERTA, dados: DADOS_OFERTA }, { no: NO_OFERTA, dados: {} }])).toMatch(/item 2: .*dado obrigatório/)
    expect(e([{ no: { kind: 'cartaz', spec: { ...NO_OFERTA.spec, tamanhos: ['A5'] } }, dados: DADOS_OFERTA, tamanho: 'A4' }])).toMatch(/item 1: .*não está em tamanhos/)
    expect(e(Array.from({ length: LIMITES_LOTE.itens + 1 }, () => ({ no: NO_OFERTA, dados: DADOS_OFERTA })))).toMatch(/itens/); expect(e([{ no: NO_OFERTA, dados: DADOS_OFERTA, quantidade: 200 }, { no: NO_OFERTA, dados: DADOS_OFERTA, quantidade: 200 }, { no: NO_OFERTA, dados: DADOS_OFERTA, quantidade: 101 }])).toMatch(/passa de 500/)
  })
  it('avisos de cada peça vêm com o número do item', () => {
    const no = { kind: 'cartaz', spec: { ...NO_OFERTA.spec, dados: {}, elementos: [{ tipo: 'texto', texto: 'texto enorme que não cabe de jeito nenhum aqui', caixa: { topo: 0, esquerda: 0, largura: 0.05, altura: 0.01 }, tamanho: { min: 20 } }] } }
    expect(layoutLote([{ no: NO_OFERTA, dados: DADOS_OFERTA }, { no, dados: {} }]).avisos[0]).toMatch(/^item 2: .*não cabe/)
  })
  it('HTML: uma @page nomeada por tamanho quando os tamanhos diferem (e a simples quando não); PDF com uma página por cópia e tamanhos próprios', async () => {
    const r = await geraLote(itens(), { agora: new Date(0) }); expect(r.html).toContain('@page t0'); expect(r.html).toContain('@page t2'); expect(r.html.match(/<section class="pagina"/g)).toHaveLength(6)
    expect(htmlDe(layoutLote([{ no: NO_OFERTA, dados: DADOS_OFERTA, quantidade: 2 }]))).toMatch(/@page\{size:595\.276pt 419\.528pt;margin:0\}/)
    const { PDFDocument } = await import('pdf-lib'), doc = await PDFDocument.load(r.pdf); expect(doc.getPageCount()).toBe(6); expect(Math.round(doc.getPage(2).getWidth())).toBe(420); expect(Math.round(doc.getPage(3).getWidth())).toBe(842)
    const b = await geraLote(itens(), { agora: new Date(0) }); expect(Buffer.from(b.pdf).equals(Buffer.from(r.pdf))).toBe(true) // determinístico
  })
})

describe.skipIf(!PRONTO)('paridade do lote (Chrome × PDF)', () => {
  usaNavegador()
  it('todas as páginas, de tamanhos diferentes, batem palavra a palavra e por pixel', async () => {
    const l = layoutLote(itens()), c = await doChrome(htmlDe(l)), p = doPdf(await pdfDe(l, new Date(0)), palavrasGiradas(l))
    expect(c.imgs.length).toBe(6); expect(p.imgs.length).toBe(6)
    expect(pior(junta(c.palavras), junta(p.palavras))).toBeLessThanOrEqual(1)
    for (let i = 0; i < 6; i++) expect(pixelOk(diferenca(c.imgs[i]!, p.imgs[i]!)), `página ${i + 1}`).toBe(true)
  })
})
