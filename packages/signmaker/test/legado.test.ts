import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { criaValidador } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { converteConfiguracao, htmlDe, layoutCartaz, pdfDe } from '../src'
import { PRONTO, pixelOk, diferenca, doChrome, doPdf, junta, palavrasGiradas, pior, usaNavegador } from './paridade-comum'

const LEGADO = process.env.LEGADO_BANNER_DIR ?? join(process.cwd(), '../../../easysync-banner-app')
const CONFIG = join(LEGADO, 'src/store/banner/configurations')
const TEM = existsSync(CONFIG)
const valida = criaValidador()
const le = (cliente: string) => Object.fromEntries(['globals', 'modifiers', 'complements', 'geometries'].map((k) => [k, JSON.parse(readFileSync(join(CONFIG, cliente, `${k}.json`), 'utf8'))]))

/** dados de exemplo no modelo novo: dinheiro em DECIMAL (o legado usava centavos inteiros) */
export const DADOS_LEGADO = {
  model: { dynamic: 'AV', size: 'A4', orientation: 'landscape', layout: 'OFERTA', campaign: '' },
  product: { type: 'normal', code: '123456', primary: 'ARROZ TIPO 1 CAMIL 5KG', secondary: 'Pacote com 5 quilos', unit: 'KG', duplicity: 'single', validity: '15/03/2027' },
  price: { qrcode: 'http://tools.easysync.com.br', barcode: '7891000100103', price: '12.90', promotional: '9.99', min: '8.00', offer: '10.50', hasExpiration: true, hasQrcode: true, hasBarcode: true, expirationStart: '01/03/2027', expirationEnd: '15/03/2027', discount: '10', installments: '3', releases: ['', 'NO CARTÃO - SEM JUROS', 'DESCONTO PARA PAGAMENTO À VISTA', 'Consulte os vendedores. *', 'COMPRE ON-LINE', '10% DE DESCONTO PARA PAGAMENTO À VISTA', 'LEVE 3 UNIDADES E PAGUE 2'] },
}

describe.skipIf(!TEM)('conversão das configurações do legado', () => {
  for (const cliente of ['curio', 'goiana', 'saojorge']) {
    it(`${cliente}: todo layout vira nó válido no schema e gera layout com dados de exemplo`, () => {
      const { nos, relatorio } = converteConfiguracao(le(cliente), cliente)
      expect(nos.length).toBeGreaterThanOrEqual(5)
      const problemas: string[] = []
      for (const c of nos) {
        const r = valida(c.no); if (!r.ok) { problemas.push(`${c.id}: ${JSON.stringify(r.erros.slice(0, 2))}`); continue }
        try { layoutCartaz(c.no.spec, DADOS_LEGADO) } catch (e) { problemas.push(`${c.id}: ${(e as Error).message.slice(0, 160)}`) }
      }
      if (process.env.DBG) console.log(JSON.stringify({ cliente, n: nos.length, problemas: problemas.map((p) => p.slice(0, 200)), nao: relatorio.naoConvertidos }))
      expect(problemas).toEqual([])
    })
  }
})

/** TODOS os layouts convertidos, em cada tamanho que servem, saem iguais em HTML e PDF no Chrome (palavras ≤ 1 pt e pixels) */
describe.skipIf(!TEM || !PRONTO)('paridade dos layouts convertidos do legado', () => {
  usaNavegador()
  for (const cliente of ['curio', 'goiana', 'saojorge']) {
    it(`${cliente}: HTML ≡ PDF em todas as geometrias`, async () => {
      const { nos } = converteConfiguracao(le(cliente), cliente), falhas: string[] = []
      for (const c of nos) {
        for (const tam of c.no.spec.tamanhos as string[]) {
          const l = layoutCartaz(c.no.spec, DADOS_LEGADO, { tamanho: tam }), pdf = await pdfDe(l, new Date(0)), ch = await doChrome(htmlDe(l)), p = doPdf(pdf, palavrasGiradas(l))
          if (process.env.PARIDADE_SALVA) { writeFileSync(`${process.env.PARIDADE_SALVA}/${c.id}-${tam}-chrome.png`, ch.imgs[0]!); writeFileSync(`${process.env.PARIDADE_SALVA}/${c.id}-${tam}-pdf.png`, p.imgs[0]!) }
          const w = pior(junta(ch.palavras), junta(p.palavras)), d = diferenca(ch.imgs[0]!, p.imgs[0]!)
          if (!(w <= 1 && pixelOk(d))) falhas.push(`${c.id} ${tam}: palavras ${w}, pixel ${d.medio.toFixed(2)}/${(d.ruins * 100).toFixed(2)}%`)
        }
      }
      expect(falhas).toEqual([])
    }, 300_000)
  }
})
