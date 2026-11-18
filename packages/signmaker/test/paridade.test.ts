import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { htmlDe, layoutCartaz, pdfDe, type Layout } from '../src'
import { DADOS_VALIDADE, NO_VALIDADE, DADOS_PRECO, NO_PRECO, DADOS_ETIQUETA, DADOS_LONGO, DADOS_OFERTA, NO_ETIQUETA, NO_OFERTA, SPEC_VARIADO } from './exemplos'
import { PRONTO, pixelOk, diferenca, doChrome, doPdf, junta, palavrasGiradas, pior, tmp, usaNavegador } from './paridade-comum'

usaNavegador()
const CASOS: Array<[string, Record<string, any>, unknown]> = [
  ['oferta A5 paisagem', NO_OFERTA.spec, DADOS_OFERTA],
  ['oferta A4 retrato', { ...NO_OFERTA.spec, tamanho: 'A4', orientacao: 'retrato' }, DADOS_OFERTA],
  ['oferta A6 com nome longo', { ...NO_OFERTA.spec, tamanho: 'A6' }, DADOS_LONGO],
  ['oferta A7 sem "de"', { ...NO_OFERTA.spec, tamanho: 'A7', orientacao: 'retrato' }, { ...DADOS_OFERTA, preco: { de: '', por: '0.99' } }],
  ['etiqueta A6: EAN-13 e QR code', NO_ETIQUETA.spec, DADOS_ETIQUETA],
  ['etiqueta A4 retrato', { ...NO_ETIQUETA.spec, tamanho: 'A4', orientacao: 'retrato' }, DADOS_ETIQUETA],
  ['códigos girados em 90°', { ...NO_ETIQUETA.spec, elementos: NO_ETIQUETA.spec.elementos.map((e: any) => (e.tipo === 'texto' ? e : { ...e, rotacao: 90 })) }, DADOS_ETIQUETA],
  ['preço: reais, centavos altos, unidade e preço antigo riscado', NO_PRECO.spec, DADOS_PRECO],
  ['preço A4 retrato com milhar', { ...NO_PRECO.spec, tamanho: 'A4', orientacao: 'retrato' }, { ...DADOS_PRECO, preco: { de: '1999.9', por: '1499.99' } }],
  ['preço girado em 90° (sem texto por perto)', { ...NO_PRECO.spec, elementos: NO_PRECO.spec.elementos.filter((e: any) => e.tipo === 'preco').map((e: any) => ({ ...e, rotacao: 90 })) }, DADOS_PRECO],
  ['preço antigo girado em 20°', { ...NO_PRECO.spec, elementos: NO_PRECO.spec.elementos.map((e: any) => (e.id === 'antigo' ? { ...e, rotacao: 20 } : e)) }, DADOS_PRECO],
  ['validade preenchida', NO_VALIDADE.spec, DADOS_VALIDADE],
  ['validade em branco, A4 retrato', { ...NO_VALIDADE.spec, tamanho: 'A4', orientacao: 'retrato' }, { produto: { nome: 'Iogurte', validade: '' } }],
  ['validade girada em 90° (sem texto por perto)', { ...NO_VALIDADE.spec, elementos: NO_VALIDADE.spec.elementos.filter((e: any) => e.tipo === 'validade').map((e: any) => ({ ...e, rotacao: 90 })) }, DADOS_VALIDADE],
  ['variado: girado, translúcido, arredondado, alinhamentos, Roboto', SPEC_VARIADO, { nome: 'Promoção da Semana' }],
]

it.runIf(!PRONTO && Boolean(process.env.CI))('CI: Chrome e poppler (pdftoppm, pdftotext) precisam estar instalados', () => { throw new Error('Chrome ou poppler ausentes: a paridade HTML × PDF do cartaz não pôde ser verificada') })
describe.skipIf(!PRONTO)('paridade HTML × PDF do cartaz', () => {
  for (const [nome, spec, dados] of CASOS) {
    it(`${nome}: mesmas palavras nas mesmas posições (±1 pt) e mesmos pixels`, async () => {
      const l = layoutCartaz(spec, dados), html = htmlDe(l), pdf = await pdfDe(l, new Date(0))
      const c = await doChrome(html), p = doPdf(pdf, palavrasGiradas(l))
      if (process.env.PARIDADE_SALVA) { writeFileSync(join(process.env.PARIDADE_SALVA, `${nome.replace(/\W+/g, '-')}-chrome.png`), c.imgs[0]!); writeFileSync(join(process.env.PARIDADE_SALVA, `${nome.replace(/\W+/g, '-')}-pdf.png`), p.imgs[0]!) }
      expect(c.imgs.length).toBe(1); expect(p.imgs.length).toBe(1); if (l.paginas[0]!.ops.some((o) => o.tipo === 'texto' && o.graus === 0)) expect(c.palavras.length).toBeGreaterThan(0) // sem texto reto, só o pixel vale
            expect(pior(junta(c.palavras), junta(p.palavras))).toBeLessThanOrEqual(1)
      const d = diferenca(c.imgs[0]!, p.imgs[0]!); expect(pixelOk(d), JSON.stringify(d)).toBe(true)
    })
  }

  it('o detector enxerga defeitos: 1,5 pt de deslocamento, cor trocada, texto trocado e giro diferente são reprovados', async () => {
    const l = layoutCartaz(SPEC_VARIADO, { nome: 'Promoção da Semana' }), p = doPdf(await pdfDe(l, new Date(0)), palavrasGiradas(l))
    const mutado = (f: (t: Layout) => void) => { const m = structuredClone(l); f(m); return m }
    const desloca = mutado((m) => { for (const o of m.paginas[0]!.ops) if (o.tipo === 'texto') o.x += 1.5 })
    const cor = mutado((m) => { for (const o of m.paginas[0]!.ops) if (o.tipo === 'caminho') o.cor = [0, 0, 0] })
    const txt = mutado((m) => { const o = m.paginas[0]!.ops.find((x) => x.tipo === 'texto' && x.graus === 0); if (o?.tipo === 'texto') o.texto = 'XXXX' })
    const gira = mutado((m) => { for (const o of m.paginas[0]!.ops) if (o.tipo === 'texto' && o.graus) o.graus += 3 })
    expect(pior((await doChrome(htmlDe(l))).palavras, p.palavras)).toBeLessThanOrEqual(1)
    expect(pior((await doChrome(htmlDe(desloca))).palavras, p.palavras)).toBeGreaterThan(1)
    const dc = diferenca((await doChrome(htmlDe(cor))).imgs[0]!, p.imgs[0]!); expect(pixelOk(dc)).toBe(false)
    expect(pior((await doChrome(htmlDe(txt))).palavras, p.palavras)).toBe(Infinity)
    const dg = diferenca((await doChrome(htmlDe(gira))).imgs[0]!, p.imgs[0]!); expect(dg.medio > 0.6 || dg.ruins >= 0.0005).toBe(true) // girar 3° também precisa ser visto
  })

  it('o PDF embarca as fontes usadas e o HTML as declara', async () => {
    const l = layoutCartaz(SPEC_VARIADO, { nome: 'x' }), f = join(tmp, 'f.pdf'); writeFileSync(f, await pdfDe(l, new Date(0)))
    const fontes = execFileSync('pdffonts', [f], { encoding: 'utf8' }); expect(fontes).toMatch(/Montserrat.*yes/); expect(fontes).toMatch(/Roboto.*yes/)
    expect(htmlDe(l)).toContain('Sign-Montserrat')
  })
})
